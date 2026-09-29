// The comparison that the plus run exists to make: how much does the curated frame selection move the
// verdict?
//
// The naive version of this question ("plus median vs curated median") is nearly meaningless on its own,
// because the two runs judge different frame sets and the same judge on a different population can move
// for reasons that have nothing to do with selection bias. So this script decomposes the difference:
//
//   1. the two headline medians, side by side, at all three gate levels
//   2. the OVERLAP: frames judged by both runs, compared vote by vote. On a shared frame, a difference can
//      only come from the pipeline, never from selection -- so this isolates pipeline noise from the
//      selection effect.
//   3. plus-only frames: the verdict distribution on the frames the curator never picked. If these sit
//      lower than the shared ones, the curated pick was optimistic (it chose readable frames); if higher,
//      it was conservative.
//   4. the frame-legibility split inside the plus run: the classifier's own breast_outline_readable flag
//      partitions the frames into "the silhouette is legible" and "it is not". Comparing the verdict across
//      that split measures how much of the plus reading is carried by frames that arguably cannot support
//      a reading at all.
//
// Everything here is computed from the two verdict JSONs and classify.jsonl; nothing is assumed about
// what the numbers will turn out to be, and any input that is missing is reported rather than skipped
// silently.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const P = (process.env.PORTRAIT_ROOT || 'C:\\portrait-data\\_probe') + '\\'
const ORDER = ['AA', 'A', 'B', 'C', 'D', 'E_or_more']
const idx = (v) => ORDER.indexOf(v)
const label = (i) => ORDER[Math.max(0, Math.min(ORDER.length - 1, Math.round(i)))]
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN }
const quant = (a, q) => { const s = [...a].sort((x, y) => x - y); if (!s.length) return NaN; const p = (s.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p); return s[lo] + (s[hi] - s[lo]) * (p - lo) }
const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN

const out = []

// ---------- inputs ----------
const plusPath = join(P, 'plus-verdict.json')
const curatedPath = join(P, 'final-verdict.json')
if (!existsSync(plusPath)) { console.log('FATAL: ' + plusPath + ' missing -- the plus run has not been aggregated yet'); process.exit(1) }

const plus = JSON.parse(readFileSync(plusPath, 'utf8'))
const curated = existsSync(curatedPath) ? JSON.parse(readFileSync(curatedPath, 'utf8')) : null
const cls = new Map()
for (const line of readFileSync(join(P, 'classify.jsonl'), 'utf8').split('\n')) {
  if (!line.trim()) continue
  const r = JSON.parse(line); cls.set(r.file, r)
}

// ---------- 1. headline ----------
out.push('=== 1. the two channels, side by side ===')
out.push('  curated channel (hand-picked candidates)')
if (curated) {
  for (const s of curated.robustness_levels) out.push('    ' + String(s.level).padEnd(16) + 'frames ' + String(s.frames_kept).padStart(5) + '  votes ' + String(s.votes_kept).padStart(5) + '  median_frame ' + s.verdict_median_frame + '  p25p75 [' + s.verdict_p25_p75_frame + ']')
} else out.push('    (final-verdict.json not found)')
out.push('  plus channel (every frame with a person)')
for (const s of plus.robustness_levels) out.push('    ' + String(s.level).padEnd(16) + 'frames ' + String(s.frames_kept).padStart(5) + '  votes ' + String(s.votes_kept).padStart(5) + '  median_frame ' + s.verdict_median_frame + '  p25p75 [' + s.verdict_p25_p75_frame + ']')

// ---------- frame-level maps ----------
const byFile = (rep) => {
  const m = new Map()
  for (const f of rep.per_frame) m.set(f.file, { median: idx(f.median), label: f.median, votes: f.votes, reliability: f.reliability })
  return m
}
const pF = byFile(plus)
const cF = curated ? byFile(curated) : new Map()

// ---------- 2. overlap ----------
out.push('')
out.push('=== 2. frames both channels judged (pipeline noise, no selection effect) ===')
const shared = [...pF.keys()].filter(f => cF.has(f))
out.push('  shared frames: ' + shared.length)
if (shared.length) {
  const diffs = shared.map(f => pF.get(f).median - cF.get(f).median)
  const agree = diffs.filter(d => d === 0).length
  const higher = diffs.filter(d => d > 0).length, lower = diffs.filter(d => d < 0).length
  out.push('  same median: ' + agree + '/' + shared.length + '  (' + (100 * agree / shared.length).toFixed(1) + '%)')
  out.push('  plus higher: ' + higher + '   plus lower: ' + lower + '   mean signed difference: ' + mean(diffs).toFixed(3) + ' levels')
  out.push('  mean absolute difference: ' + mean(diffs.map(Math.abs)).toFixed(3) + ' levels  (= repeat-to-repeat noise of the same method)')
  const big = shared.filter(f => Math.abs(pF.get(f).median - cF.get(f).median) >= 2)
  out.push('  frames differing by 2+ levels: ' + big.length)
  for (const f of big.slice(0, 8)) out.push('    ' + f.slice(0, 52).padEnd(53) + ' curated ' + cF.get(f).label + ' [' + cF.get(f).votes.join(',') + ']  plus ' + pF.get(f).label + ' [' + pF.get(f).votes.join(',') + ']')
}
// also: how do the two runs' VERDICT DISTRIBUTIONS compare on the shared frames
if (shared.length) {
  const mkHist = (get) => ORDER.reduce((m, v, i) => ((m[v] = shared.filter(f => Math.round(get(f).median) === i).length), m), {})
  out.push('  shared-frame median histogram  curated: ' + JSON.stringify(mkHist(f => cF.get(f))))
  out.push('  shared-frame median histogram    plus : ' + JSON.stringify(mkHist(f => pF.get(f))))
}

// ---------- 3. plus-only frames ----------
out.push('')
out.push('=== 3. the frames the curator never picked (plus only) ===')
const onlyPlus = [...pF.keys()].filter(f => !cF.has(f))
out.push('  plus-only frames: ' + onlyPlus.length)
if (onlyPlus.length) {
  const sharedMed = shared.map(f => pF.get(f).median)
  const onlyMed = onlyPlus.map(f => pF.get(f).median)
  out.push('  median on shared frames     : ' + label(median(sharedMed)) + '  (mean level ' + mean(sharedMed).toFixed(3) + ')')
  out.push('  median on plus-only frames  : ' + label(median(onlyMed)) + '  (mean level ' + mean(onlyMed).toFixed(3) + ')')
  out.push('  mean difference (plus-only minus shared): ' + (mean(onlyMed) - mean(sharedMed)).toFixed(3) + ' levels')
  out.push('  -> a negative number means the frames the curator left out read SMALLER, i.e. the curated pick was optimistic')
  out.push('  plus-only median histogram: ' + JSON.stringify(ORDER.reduce((m, v, i) => ((m[v] = onlyMed.filter(x => Math.round(x) === i).length), m), {})))
}

// ---------- 4. legibility split inside the plus run ----------
out.push('')
out.push('=== 4. inside the plus run: does the classifier say the silhouette is legible? ===')
const legible = [], illegible = [], unknown = []
for (const [f, v] of pF) {
  const c = cls.get(f)
  if (!c) unknown.push(f)
  else if (c.breast_outline_readable === true) legible.push(v)
  else illegible.push(v)
}
const stat = (name, arr) => {
  if (!arr.length) { out.push('  ' + name.padEnd(28) + ' (none)'); return }
  const med = arr.map(x => x.median)
  out.push('  ' + name.padEnd(28) + 'frames ' + String(arr.length).padStart(5) +
    '  median_frame ' + label(median(med)) + '  mean level ' + mean(med).toFixed(3) +
    '  p25p75 [' + label(quant(med, 0.25)) + ',' + label(quant(med, 0.75)) + ']' +
    '  median reliability ' + median(arr.map(x => x.reliability)).toFixed(2))
}
stat('breast_outline_readable', legible)
stat('not readable', illegible)
if (unknown.length) out.push('  frames with no classify row: ' + unknown.length)
if (legible.length && illegible.length) {
  const d = mean(legible.map(x => x.median)) - mean(illegible.map(x => x.median))
  out.push('  mean difference (legible minus not): ' + d.toFixed(3) + ' levels')
  out.push('  -> this is the size of the gap between frames that can carry a reading and frames that cannot.')
}

// ---------- 5. what the verdict rests on ----------
out.push('')
out.push('=== 5. where the plus verdict comes from at each gate level ===')
for (const s of plus.robustness_levels) {
  out.push('  ' + s.level + ': ' + s.frames_kept + ' frames, median ' + s.verdict_median_frame + ', unanimous ' + s.unanimous_frames + '/' + s.frames_kept + ', mean vote spread ' + s.mean_spread)
  if (s.gated_out && Object.keys(s.gated_out).length) out.push('      gated out: ' + Object.entries(s.gated_out).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + '=' + v).join('  '))
}
out.push('')
out.push('=== 6. histogram comparison at the primary (standard) level ===')
const ps = plus.robustness_levels.find(s => s.level === 'standard')
const cs = curated ? curated.robustness_levels.find(s => s.level === 'standard') : null
out.push('  plus    frame histogram: ' + JSON.stringify(ps.frame_histogram))
if (cs) out.push('  curated frame histogram: ' + JSON.stringify(cs.frame_histogram))
out.push('  plus    vote  histogram: ' + JSON.stringify(ps.vote_histogram))
if (cs) out.push('  curated vote  histogram: ' + JSON.stringify(cs.vote_histogram))

const text = out.join('\n')
console.log(text)
writeFileSync(join(P, 'plus-vs-curated.txt'), text, 'utf8')
writeFileSync(join(P, 'plus-vs-curated.md'), '# plus 口径 vs curated 口径\n\n```\n' + text + '\n```\n', 'utf8')
console.log('')
console.log('-> plus-vs-curated.txt / .md')
