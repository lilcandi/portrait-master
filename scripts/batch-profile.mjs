// Profile pass: one structured read per representative frame.
// Judges only stable, non-sensitive visual presentation facts (hair, build, styling, scene, vibe).
// Uses the 512px thumbnails: this pass needs composition, not resolution.
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = process.argv[2] || (process.env.PORTRAIT_PHOTO_ROOT || 'C:\\portrait-data')
const OUT = process.argv[4] || join(SRC, '_probe', 'profile.jsonl')
const CONC = Number(process.argv[5] || 3)
const KEY = process.env.CMC_API_KEY
if (!KEY) { console.error('CMC_API_KEY missing'); process.exit(1) }

const manifest = JSON.parse(readFileSync(join(SRC, '_probe', 'report_assets', 'manifest.json'), 'utf8'))
const targets = manifest.portraits.map((p) => p.source).filter(Boolean)
console.log(`profile targets: ${targets.length} conc=${CONC}`)

const PROMPT = `You are cataloguing a lifestyle photo archive. Look at this single photo and return STRICT JSON only — no prose, no markdown fence.

Assess only outward presentation, never identity, age, ethnicity, or attractiveness.

Return exactly these keys:
{
  "hair_length": "buzzed|short|shoulder|mid_back|waist|very_long",
  "hair_color": "black|dark_brown|brown|light_brown|blonde|red|colored",
  "hair_style": "straight|wavy|curly|ponytail|bun|half_up|braided|tied_back",
  "body_build": "petite|slim|athletic|average|curvy|plus",
  "height_impression": "petite_under155|short_155_162|average_163_170|tall_over170",
  "style_tags": ["3 to 5 short tags, e.g. resort, French chic, sporty, sweet-cool, minimalist, vintage, streetwear, knitwear-soft, holiday"],
  "scene": "beach|pool|city_street|cafe_indoor|mountain|snow|park_garden|studio_plain|hotel_room|scenic_view|forest|other",
  "season_hint": "spring|summer|autumn|winter",
  "vibe": "2 to 4 Chinese characters describing the overall bearing, e.g. 清新, 明快, 慵懒, 优雅, 冷冽, 元气",
  "distinctive_visual_features": "short phrase about styling or look, or none",
  "one_line": "one plain sentence in Chinese describing what this frame shows"
}

Rules:
- Judge only what is visible. If a detail cannot be seen (hair cropped out, body hidden), use "unknown".
- style_tags must be present tense descriptors of the outfit and setting, not judgements.
- Output JSON only.`

function extractJSON(t) {
  if (!t) return null
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : t
  const s = body.indexOf('{'), e = body.lastIndexOf('}')
  if (s < 0 || e < 0) return null
  try { return JSON.parse(body.slice(s, e + 1)) } catch { return null }
}

const done = new Set()
if (existsSync(OUT)) {
  for (const l of readFileSync(OUT, 'utf8').split('\n')) {
    if (!l.trim()) continue
    try { done.add(JSON.parse(l).file) } catch {}
  }
}
const queue = targets.filter((f) => !done.has(f))
console.log(`queued=${queue.length} (already done ${targets.length - queue.length})`)

let ok = 0, bad = 0, err = 0, n = 0
const t0 = Date.now()
async function worker() {
  while (queue.length) {
    const file = queue.shift()
    if (!file) break
    const thumb = join(SRC, '_probe', 'thumbs', file)
    if (!existsSync(thumb)) { err++; appendFileSync(OUT, JSON.stringify({ file, ok: false, err: 'thumb missing' }) + '\n'); continue }
    const b64 = readFileSync(thumb).toString('base64')
    try {
      const res = await fetch('https://api.commandcode.ai/provider/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
        body: JSON.stringify({
          model: 'gpt-6-luna', temperature: 0.2, max_tokens: 4000,
          messages: [{ role: 'user', content: [
            { type: 'text', text: PROMPT },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } },
          ] }],
        }),
      })
      const j = await res.json()
      const content = j.choices?.[0]?.message?.content
      const parsed = extractJSON(content)
      if (parsed && parsed.one_line) {
        ok++
        appendFileSync(OUT, JSON.stringify({ file, ok: true, raw: parsed }) + '\n')
      } else {
        bad++
        appendFileSync(OUT, JSON.stringify({ file, ok: false, err: 'unparsed', snippet: String(content).slice(0, 200) }) + '\n')
      }
    } catch (e) { err++; appendFileSync(OUT, JSON.stringify({ file, ok: false, err: String(e).slice(0, 200) }) + '\n') }
    n++
    if (n % 5 === 0) console.log(`progress ${n}/${targets.length - done.size} ok=${ok} bad=${bad} err=${err} eta=${(((targets.length - done.size - n) / (n / ((Date.now() - t0) / 1000) || 1)) / 60).toFixed(1)}min`)
  }
}
await Promise.all(Array.from({ length: CONC }, worker))
console.log(`DONE ok=${ok} bad=${bad} err=${err} in ${((Date.now() - t0) / 60000).toFixed(1)}min -> ${OUT}`)
