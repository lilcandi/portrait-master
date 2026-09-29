// Stage 2 (final method): relative silhouette ratios + a forced-choice verdict.
//
// What the three failed passes taught: a vision model cannot count pixels and cannot recover an
// absolute scale from a monocular photo, so any "measure the width in cm" pipeline produces noise
// dressed as precision. What it CAN do reliably is compare two widths in the SAME frame.
//
// So this pass asks only for head-relative ratios (the image scale cancels) plus one forced-choice
// answer about the bust silhouette. Every frame then votes, and the vote is weighted by how
// self-consistent the frame was across repeats.
import { readFile, appendFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const SRC = process.argv[2] || (process.env.PORTRAIT_PHOTO_ROOT || 'C:\\portrait-data')
const BLURB = process.argv[3] || path.join(SRC, '_probe', 'blurb')
const CAND = process.argv[4] || path.join(SRC, '_probe', 'candidates.txt')
const OUTJSONL = process.argv[5] || path.join(SRC, '_probe', 'deep-verdict.jsonl')
const CONC = Number(process.argv[6] || 4)
const REPEAT = Number(process.argv[7] || 3)
const MODEL = process.env.VIS_MODEL || 'gpt-6-luna'
const KEY = process.env.CMC_API_KEY

const SYS = `You are a garment-fit analyst. Answer with ONE JSON object, no prose, no code fences.

Part 1 - ratios. All values are widths of the SUBJECT'S SILHOUETTE (include the clothing) divided by
the width of the subject's own head (head = the widest point of the skull, ear to ear):
{"head_ref":1.0,
"shoulder_over_head":0.0,
"bust_over_head":0.0,
"underbust_over_head":0.0,
"waist_over_head":0.0,
"hip_over_head":0.0}

Part 2 - forced choice about the bust silhouette. Pick exactly one option per key.
{"bust_projection":"flat|slight|moderate|pronounced",
"bust_larger_than_waist":"near_equal|slightly_larger|clearly_larger|much_larger",
"underbust_creases_visible":"none|faint|clear|deep",
"bust_still_projects_when_side":"no|slightly|clearly|strongly",
"fit_verdict":"AA|A|B|C|D|E_or_more"}

Part 3 - quality.
{"garment":"swimsuit|bikini|tank_top|camisole|tube_top|t_shirt|dress|knitwear|loose_top|other|unclear",
"pose":"standing_front|standing_three_quarter|standing_side|sitting|leaning|crouching|in_water|walking",
"torso_turned_degree":0,
"chest_occluded_by":"none|hair|arm|hand|bag|water|shadow|clothing|other",
"reliability":0.0,
"note":"<=10 words"}

Rules you must self-check:
 - The ratios are relative to the head in the SAME photo, so distance does not matter. A typical adult
   female has shoulder_over_head near 2.5 and waist_over_head near 1.6-1.9, regardless of the photo.
 - bust_over_head must be >= underbust_over_head.
 - fit_verdict is your best guess of the bra cup that would fit this figure, based on breast volume
   relative to the ribcage, NOT on the size of the chest in the image.
 - reliability (0-1) = how confident you are that the torso silhouette is readable in this frame.`

const files = readFileSync(CAND, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)
const ORDINAL = new Set(['AA', 'A', 'B', 'C', 'D', 'E_or_more'])
const done = new Set()
if (existsSync(OUTJSONL)) {
  for (const line of readFileSync(OUTJSONL, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      const o = JSON.parse(line)
      // A row only counts as answered if it yields a USABLE verdict. A truthy raw is not enough: on
      // 2026-09-29 an audit found 87 such rows (27 missing fit_verdict, 57 null, 3 off-enum) that were
      // silently skipped as "done" while contributing nothing to any histogram. Requeueing them costs
      // 87 calls; leaving them in place costs a silent 1% hole in the aggregate.
      if (o.raw && ORDINAL.has(o.raw.fit_verdict)) done.add(`${o.file}#${o.rep ?? 0}`)
    } catch {}
  }
}
const queue = []
for (const f of files) for (let r = 0; r < REPEAT; r++) if (!done.has(`${f}#${r}`)) queue.push({ f, r })
console.log(`candidates=${files.length} repeat=${REPEAT} queueing=${queue.length} model=${MODEL} conc=${CONC}`)

const t0 = Date.now()
let ok = 0, bad = 0, err = 0
let idx = 0
const parseJson = (s) => { const m = String(s).match(/\{[\s\S]*\}/); if (!m) return null; try { return JSON.parse(m[0]) } catch { return null } }

async function one(job) {
  const { f, r } = job
  const src = path.join(BLURB, f)
  if (!existsSync(src)) { err++; return }
  try {
    const b64 = (await readFile(src)).toString('base64')
    const body = {
      model: MODEL,
      messages: [
        { role: 'system', content: SYS },
        { role: 'user', content: [{ type: 'text', text: 'Analyse this frame. Ratios are relative to the head width in the same photo.' }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } }] },
      ],
      max_tokens: 4000,
      temperature: r === 0 ? 0 : 0.5,
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch('https://api.commandcode.ai/provider/v1/chat/completions', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(180000),
        })
        const j = await res.json().catch(() => null)
        const content = j?.choices?.[0]?.message?.content || ''
        const parsed = parseJson(content)
        if (parsed) { ok++; await appendFile(OUTJSONL, JSON.stringify({ file: f, rep: r, raw: parsed }) + '\n') }
        else {
          // Record WHY it failed instead of just that it did. A bare raw:null row is undiagnosable: on
          // 2026-09-29 a contiguous block of 1133 calls returned unparseable content and the cause could
          // not be recovered because the body was discarded here. Keep a truncated copy of the actual
          // reply, the finish reason, and the http status -- that is what separates "model refused" from
          // "content truncated by max_tokens" from "provider returned an error object".
          bad++
          await appendFile(OUTJSONL, JSON.stringify({
            file: f, rep: r, raw: null,
            diag: {
              http: res.status,
              finish: j?.choices?.[0]?.finish_reason ?? null,
              content_len: String(content).length,
              content_head: String(content).slice(0, 600),
              err_obj: j?.error ? JSON.stringify(j.error).slice(0, 300) : null,
            },
          }) + '\n')
        }
        return
      } catch (e) {
        if (attempt === 3) { err++; await appendFile(OUTJSONL, JSON.stringify({ file: f, rep: r, error: String(e?.message || e) }) + '\n') }
        else await new Promise((res2) => setTimeout(res2, 2000 * (attempt + 1)))
      }
    }
  } catch (e) { err++; console.log('ERR', f, e?.message) }
}

let lastReport = Date.now()
await Promise.all(Array.from({ length: CONC }, async () => {
  while (idx < queue.length) {
    await one(queue[idx++])
    if (Date.now() - lastReport > 15000) {
      lastReport = Date.now()
      const el = (Date.now() - t0) / 1000, n = ok + bad + err
      console.log(`progress ${n}/${queue.length} ok=${ok} bad=${bad} err=${err} ${(n / el).toFixed(2)}/s eta=${((queue.length - n) / Math.max(n / el, 0.01) / 60).toFixed(1)}min`)
    }
  }
}))
console.log(`DONE ok=${ok} bad=${bad} err=${err} in ${((Date.now() - t0) / 1000 / 60).toFixed(1)}min`)
