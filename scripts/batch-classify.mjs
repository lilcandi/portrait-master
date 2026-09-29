// Stage 1: coarse visual classification over the whole album.
// One vision call per thumbnail -> strict JSON verdict. Resumable via JSONL results file.
// SLICE=start:end confines this worker to a fraction of the remaining queue, so several
// workers can share the album without sending the same frame twice.
import { readdir, readFile, appendFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const SRC = process.argv[2] || (process.env.PORTRAIT_PHOTO_ROOT || 'C:\\portrait-data')
const THUMBS = process.argv[3] || path.join(SRC, '_probe', 'thumbs')
const OUTJSONL = process.argv[4] || path.join(SRC, '_probe', 'classify.jsonl')
const CONC = Number(process.argv[5] || 6)
const LIMIT = Number(process.argv[6] || 0)
const SLICE = process.env.SLICE || '0:1'
const MODEL = process.env.VIS_MODEL || 'gpt-6-luna'
const BASE = 'https://api.commandcode.ai/provider/v1'
const KEY = process.env.CMC_API_KEY

const SYS = `You are a photo-archive annotator. Reply with ONE JSON object only, no prose, no code fences.
Schema (all keys required):
{"photo_type":"portrait|full_body|half_body|detail|scenery|food|object|other",
"person_count":0,
"angle":"front|three_quarter|side|back|top_down|unknown",
"frame_coverage":"head_to_toe|head_to_hip|head_to_knee|chest_up|waist_up|closeup|unknown",
"outerwear":"none|swimsuit|bikini|tank_top|camisole|tube_top|t_shirt|shirt|dress|knitwear|jacket|sportswear|lingerie|other|unclear",
"tight_fit":true,
"chest_region_visible":true,
"chest_region_obstruction":"none|hair|arm|hand|bag|prop|water|shadow|clothing_fold|other",
"breast_outline_readable":true,
"body_lean":"upright|leaning_forward|leaning_back|twisted|crouching|lying|in_water|unknown",
"camera_distance":"close|medium|far|unknown",
"measurable":true,
"confidence":0.0,
"note":"<=12 words"}`
const USER = 'Annotate this archive frame. measurable = the chest region is visible AND its outline is readable enough for a rough body-proportion estimate.'

const files = (await readdir(THUMBS)).filter((f) => f.toLowerCase().endsWith('.jpg')).sort()
const done = new Set()
if (existsSync(OUTJSONL)) {
  for (const line of readFileSync(OUTJSONL, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try { done.add(JSON.parse(line).file) } catch {}
  }
}
let queue = files.filter((f) => !done.has(f))
if (LIMIT > 0) queue = queue.slice(0, LIMIT)
const [sFrom, sTo] = SLICE.split(':').map(Number)
const s0 = Math.floor(queue.length * (sFrom || 0))
const s1 = Math.floor(queue.length * (sTo ?? 1))
queue = queue.slice(s0, s1)
console.log(`total=${files.length} done=${done.size} slice=${SLICE} queueing=${queue.length} model=${MODEL} conc=${CONC}`)

const t0 = Date.now()
let ok = 0, bad = 0, err = 0, pt = 0, ct = 0

function parseJson(s) {
  const m = String(s).match(/\{[\s\S]*\}/)
  if (!m) return null
  try { return JSON.parse(m[0]) } catch { return null }
}

async function one(f) {
  const b64 = (await readFile(path.join(THUMBS, f))).toString('base64')
  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: SYS },
      { role: 'user', content: [{ type: 'text', text: USER }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } }] },
    ],
    max_tokens: 3000, // gpt-6-luna is a reasoning model: it burns ~240 reasoning tokens before the JSON
    temperature: 0,
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120000),
      })
      const j = await r.json().catch(() => null)
      if (!j || !j.choices) { err++; return }
      pt += j.usage?.prompt_tokens || 0; ct += j.usage?.completion_tokens || 0
      const parsed = parseJson(j.choices[0]?.message?.content || '')
      if (parsed) { ok++; await appendFile(OUTJSONL, JSON.stringify({ file: f, ...parsed }) + '\n') }
      else { bad++; await appendFile(OUTJSONL, JSON.stringify({ file: f, raw: String(j.choices[0]?.message?.content || '').slice(0, 200) }) + '\n') }
      return
    } catch (e) {
      if (attempt === 3) { err++; await appendFile(OUTJSONL, JSON.stringify({ file: f, error: String(e?.message || e) }) + '\n') }
      else await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)))
    }
  }
}

let idx = 0, lastReport = Date.now()
await Promise.all(Array.from({ length: CONC }, async () => {
  while (idx < queue.length) {
    const f = queue[idx++]
    await one(f)
    if (Date.now() - lastReport > 20000) {
      lastReport = Date.now()
      const el = (Date.now() - t0) / 1000
      const n = ok + bad + err
      console.log(`progress ${n}/${queue.length} ok=${ok} bad=${bad} err=${err} ${(n / el).toFixed(2)}/s eta=${((queue.length - n) / Math.max(n / el, 0.01) / 60).toFixed(1)}min tokens=${pt + ct}`)
    }
  }
}))

console.log(`DONE ok=${ok} bad=${bad} err=${err} in ${((Date.now() - t0) / 1000 / 60).toFixed(1)}min prompt_tokens=${pt} completion_tokens=${ct}`)
