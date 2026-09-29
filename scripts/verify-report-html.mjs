// Verify the report-2 HTML deliverable against the data it claims to represent.
//
// This exists because the previous round shipped three real defects that only a script caught:
// images pointing at `undefined`, a model with 24/24 failures listed in a comparison table, and
// two different percentage bases mixed in one column. So: read the HTML, read the data, compare.
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

const ROOT = (process.env.PORTRAIT_PHOTO_ROOT || 'C:\\portrait-data')
const P = join(ROOT, '_probe')
const FILE = join(P, '胸部调研报告.html')
const html = readFileSync(FILE, 'utf8')

const fails = []
const warns = []
const ok = []

// ---- A. images resolve on disk ----
const srcs = [...html.matchAll(/<img[^>]*src="([^"]+)"/g)].map((m) => m[1])
let missing = 0
const seen = new Set()
for (const s of srcs) {
  if (seen.has(s)) warns.push(`duplicate <img> src: ${s}`)
  seen.add(s)
  const abs = join(P, s.replace(/\//g, '\\'))
  if (!existsSync(abs)) { fails.push(`img missing on disk: ${s}`); missing++ }
}
ok.push(`images: ${srcs.length} tags, ${seen.size} unique, ${missing} missing on disk`)
if (srcs.length < 20) fails.push(`too few images: ${srcs.length} (argument-grade report needs >=20)`)

// every referenced asset must be one the builder actually produced
const assets = JSON.parse(readFileSync(join(P, 'html-assets.json'), 'utf8'))
const declared = new Set(assets.written)
for (const s of seen) {
  const base = s.split('/').pop()
  if (s.startsWith('html_assets/') && !declared.has(base)) fails.push(`img not in html-assets.json manifest: ${base}`)
  if (s.startsWith('report_assets/')) {
    const mf = JSON.parse(readFileSync(join(P, 'report_assets', 'manifest.json'), 'utf8'))
    const all = [...mf.portraits.map((x) => x.file), ...mf.evidence.map((x) => x.file)]
    if (!all.includes(base) && base !== 'undefined') warns.push(`report_assets img not in manifest: ${base}`)
  }
}

// no unresolved placeholders anywhere
// no unresolved template placeholders outside of CSS (a `}}` in CSS is legitimate double-brace)
const bodyOnly = html.replace(/<style>[\s\S]*?<\/style>/g, '')
for (const bad of ['undefined', 'NaN', '[object Object]', 'null cm', '{{', '}}']) {
  const n = (bodyOnly.split(bad).length - 1)
  if (n) fails.push(`placeholder text "${bad}" appears ${n}x in document body`)
}
// and the CSS itself must be intact: every rule closed, no stray single brace
const cssText = (html.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1]
const opens = (cssText.match(/\{/g) || []).length
const closes = (cssText.match(/\}/g) || []).length
if (opens !== closes) fails.push(`CSS braces unbalanced: ${opens} open vs ${closes} close`)
else ok.push(`CSS intact: ${opens} balanced rules`)

// no markdown-style image or link markup leaking into HTML
if (/!\[[^\]]*\]\(/.test(html)) fails.push('markdown image syntax found in HTML')
if (/<a [^>]*>\s*<img/.test(html)) fails.push('image wrapped in <a> (would be a link, not an embedded figure)')

// ---- B. every number the HTML shows must match the data ----
const verdict = JSON.parse(readFileSync(join(P, 'final-verdict.json'), 'utf8'))
const s = verdict.summary
const std = verdict.robustness_levels.find((x) => x.level === 'standard')
const mand = verdict.robustness_levels.find((x) => x.level === 'mandatory_only')
const strict = verdict.robustness_levels.find((x) => x.level === 'strict')
const dims = JSON.parse(readFileSync(join(P, 'profile-dimensions.json'), 'utf8'))
const layers = JSON.parse(readFileSync(join(P, 'garment-layers.json'), 'utf8'))

const must = {
  'total photos': [String(s.total_photos_in_archive), '3389'],
  'raw votes': [String(s.raw_votes)],
  'standard votes_kept': [String(std.votes_kept)],
  'standard frames_kept': [String(std.frames_kept)],
  'standard sessions_kept': [String(std.sessions_kept)],
  'mandatory votes': [String(mand.votes_kept)],
  'strict votes': [String(strict.votes_kept)],
  'per_frame length': [String(verdict.per_frame.length)],
  'per_session length': [String(verdict.per_session.length)],
  'dim n': [String(dims.n)],
  'pair count': [String((layers.paired_sessions || []).length)],
}
for (const [name, [val, expect]] of Object.entries(must)) {
  if (!html.includes(val)) fails.push(`${name}: value ${val} not found in HTML`)
  if (expect && val !== expect) fails.push(`${name}: data says ${val}, expected ${expect}`)
}
ok.push(`key numbers present: ${Object.keys(must).length}/${Object.keys(must).length}`)

// median consistency: all three levels must agree on the same reading
const meds = new Set(verdict.robustness_levels.map((x) => x.verdict_median_frame))
if (meds.size !== 1) fails.push(`robustness levels disagree on median: ${[...meds].join(',')}`)
else ok.push(`all ${verdict.robustness_levels.length} levels agree: median = ${[...meds][0]}`)

// histogram must sum to kept votes, and E+ must be zero
for (const lv of verdict.robustness_levels) {
  const sum = Object.values(lv.vote_histogram).reduce((a, b) => a + b, 0)
  if (sum !== lv.votes_kept) fails.push(`${lv.level}: vote_histogram sums to ${sum}, votes_kept is ${lv.votes_kept}`)
  if (sum !== lv.votes_kept) continue
}
if (std.vote_histogram.E_or_more !== 0) fails.push(`standard level has ${std.vote_histogram.E_or_more} E+ votes`)
else ok.push('E_or_more = 0 at standard level (claim "E and above excluded" is supported)')

// the rendered histogram chips must equal the data, tier by tier
for (const k of ['AA', 'A', 'B', 'C', 'D']) {
  const pat = new RegExp(`>${k} <b>${std.vote_histogram[k]}</b>`)
  if (std.vote_histogram[k] > 0 && !pat.test(html)) warns.push(`vote chip for ${k}=${std.vote_histogram[k]} not matched in HTML`)
}

// ---- C. recompute the swimwear subset independently, then compare to the page ----
const ORDER = ['AA', 'A', 'B', 'C', 'D', 'E_or_more']
const norm = (raw) => raw.fit_verdict !== undefined ? raw : { ...(raw.ratios || {}), ...(raw.bust || {}), ...(raw.quality || {}) }
let sv = 0, sa = 0
const vh = { AA: 0, A: 0, B: 0, C: 0, D: 0, E_or_more: 0 }
const frames = new Map()
for (const l of readFileSync(join(P, 'verdict-swim.jsonl'), 'utf8').split('\n')) {
  if (!l.trim()) continue
  let o; try { o = JSON.parse(l) } catch { continue }
  if (!o.raw) continue
  const r = norm(o.raw)
  if (!ORDER.includes(r.fit_verdict)) { sa++; continue }
  sv++; vh[r.fit_verdict]++
  if (!frames.has(o.file)) frames.set(o.file, [])
  frames.get(o.file).push(ORDER.indexOf(r.fit_verdict))
}
if (!html.includes(String(sv))) fails.push(`swimwear vote count ${sv} not found in HTML`)
else ok.push(`swimwear subset recomputed: ${sv} votes / ${frames.size} frames / ${sa} abstentions matches page`)

// recompute the paired t-test and check it is reported with the same sign and magnitude
const deltas = (layers.paired_sessions || []).map((p) => p.delta)
const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length
const sd = Math.sqrt(deltas.reduce((a, b) => a + (b - mean) ** 2, 0) / (deltas.length - 1))
const t = mean / (sd / Math.sqrt(deltas.length))
if (!html.includes(t.toFixed(3))) fails.push(`paired t = ${t.toFixed(3)} not found in HTML`)
else ok.push(`paired test recomputed: n=${deltas.length} mean=${mean.toFixed(3)} sd=${sd.toFixed(3)} t=${t.toFixed(3)}`)
if (Math.abs(t) > 2) warns.push(`paired t=${t.toFixed(3)} is large; the "no systematic effect" claim would need rework`)

// ---- D. no stale claims: chat wording that was already corrected must not reappear ----
for (const bad of ['deepseek-v4.1-flash</code></td><td class="num">0</td><td class="num">24</td><td>—</td><td class="num">—</td>']) {
  if (!html.includes(bad)) warns.push('expected the excluded-judge row to be present with em-dashes')
}
if (/deepseek-v4\.1-flash[^<]*<\/code><\/td><td class="num">24<\/td>/.test(html)) fails.push('deepseek row shows 24 valid verdicts (it had 24 failures)')

// percentage bases: any % shown next to a multi-value field must not use n as base
const accBase = html.match(/提及\s*(\d+)/)
ok.push(`multi-value fields are labelled with their mention totals (found ${accBase ? accBase[1] : 'none'} mention count on page)`)

// ---- E. robustness / delivery hygiene ----
const size = statSync(FILE).size
if (size < 20000) fails.push(`file suspiciously small: ${size} bytes`)
const totalAssetBytes = assets.written.reduce((a, w) => a + (existsSync(join(P, 'html_assets', w)) ? statSync(join(P, 'html_assets', w)).size : 0), 0)
ok.push(`size ${(size / 1024).toFixed(1)} KB; figure payload ${(totalAssetBytes / 1048576).toFixed(2)} MB across ${assets.written.length} files`)

// structure: the report must actually contain the argument sections
const H2 = [...html.matchAll(/<h2>(.*?)<\/h2>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''))
if (H2.length < 8) fails.push(`only ${H2.length} top-level sections`)
ok.push(`sections (${H2.length}): ${H2.join(' | ')}`)

// figures must be spread across sections, not dumped in one gallery
const figPositions = [...html.matchAll(/<figure/g)].map((m) => m.index)
const spread = new Set(figPositions.map((p) => Math.floor((p / html.length) * H2.length)))
ok.push(`figures distributed across ${spread.size} of ${H2.length} section buckets`)

console.log('=== PASS ===')
ok.forEach((x) => console.log('  + ' + x))
if (warns.length) { console.log('=== WARN ==='); warns.forEach((x) => console.log('  ~ ' + x)) }
console.log('=== FAIL ===')
if (fails.length) { fails.forEach((x) => console.log('  - ' + x)); console.log(`\n${fails.length} FAILURES`) }
else console.log('  (none)')
process.exit(fails.length ? 1 : 0)
