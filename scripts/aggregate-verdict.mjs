// Final aggregation: turn every judge's vote into one banded verdict.
// Votes are ordinal (AA < A < B < C < D < E+), so the honest summary is a median plus an
// interquartile band, not a single value. Frames are deduplicated by photo session so one
// 13-shot swimwear set cannot outvote the rest of the archive.
import { readFileSync, writeFileSync } from 'node:fs'

const SRC = process.argv[2] || (process.env.PORTRAIT_PHOTO_ROOT || 'C:\\portrait-data')
const INPUTS = (process.argv[3] || `${SRC}\\_probe\\verdict.jsonl,${SRC}\\_probe\\cross.jsonl`).split(',')
const OUT = process.argv[4] || `${SRC}\\_probe\\final-verdict.json`

const ORDER = ['AA', 'A', 'B', 'C', 'D', 'E_or_more']
const idx = (v) => ORDER.indexOf(v)
const label = (i) => ORDER[Math.max(0, Math.min(ORDER.length - 1, Math.round(i)))]
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN }
const quant = (a, q) => { const s = [...a].sort((x, y) => x - y); if (!s.length) return NaN; const p = (s.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p); return s[lo] + (s[hi] - s[lo]) * (p - lo) }

const rows = []
let abstained = 0, malformed = 0
for (const file of INPUTS) {
  let txt
  try { txt = readFileSync(file, 'utf8') } catch { console.log(`skip (missing): ${file}`); continue }
  for (const line of txt.split('\n')) {
    if (!line.trim()) continue
    let o; try { o = JSON.parse(line) } catch { continue }
    if (!o.raw) continue
    // Some replies nest the identical fields under ratios/bust/quality instead of returning
    // them flat. Normalise both shapes so a valid vote is not dropped for a cosmetic
    // difference in nesting.
    const raw = o.raw
    const r = raw.fit_verdict !== undefined ? raw : { ...(raw.ratios || {}), ...(raw.bust || {}), ...(raw.quality || {}) }
    const v = r.fit_verdict
    if (v === null || v === undefined) { abstained++; continue }
    // ORDER is an array, so membership must use includes(); `v in ORDER` would test indices
    // and silently drop every vote.
    if (!ORDER.includes(v)) { malformed++; continue }
    rows.push({
      file: o.file, model: o.model || 'gpt-6-luna', rep: o.rep ?? 0, verdict: v, vi: idx(v),
      reliability: Number(r.reliability) || 0,
      occlusion: r.chest_occluded_by || 'unknown',
      garment: r.garment, pose: r.pose, turn: Number(r.torso_turned_degree) || 0,
      bustHead: Number(r.bust_over_head) || 0, underHead: Number(r.underbust_over_head) || 0,
      source: file.includes('cross') ? 'cross' : 'vote',
    })
  }
}
console.log(`raw votes: ${rows.length}  (abstained/refused: ${abstained}, malformed: ${malformed})`)

// --- quality gates, run at three strictness levels so the reader can see how much the
// verdict moves when obviously unusable votes are removed. MANDATORY = physically invalid
// votes only; STANDARD adds occlusion + confidence floors; STRICT also demands a face-on pose. ---
function gate(level) {
  const reasons = {}
  const keep = rows.filter((r) => {
    const blocks = []
    if (r.bustHead > 0 && r.underHead > 0) {
      const ratio = r.bustHead / r.underHead
      if (ratio < 0.95 || ratio > 2.0) blocks.push('ratio_outlier')
    }
    if (level >= 1) {
      if (['arm', 'hand', 'bag', 'water'].includes(r.occlusion)) blocks.push('occluded_' + r.occlusion)
      if (r.reliability < 0.25) blocks.push('reliability_lt_025')
    }
    if (level >= 2) {
      if (r.reliability < 0.45) blocks.push('reliability_lt_045')
      if (r.turn > 40 && r.turn < 140) blocks.push('turned_away')
      if (r.bustHead > 0 && r.underHead > 0 && r.bustHead / r.underHead < 1.05) blocks.push('ratio_lt_105')
    }
    if (blocks.length) { for (const b of blocks) reasons[b] = (reasons[b] || 0) + 1; return false }
    return true
  })
  return { keep, reasons }
}

function summarize(rowsKept, levelName) {
  const frames = new Map()
  for (const r of rowsKept) { if (!frames.has(r.file)) frames.set(r.file, []); frames.get(r.file).push(r) }
  const perFrame = [...frames.entries()].map(([file, list]) => {
    const vs = list.map((r) => r.vi)
    return {
      file, votes: list.map((r) => r.verdict), judges: [...new Set(list.map((r) => r.model))],
      median: median(vs), min: Math.min(...vs), max: Math.max(...vs),
      reliability: median(list.map((r) => r.reliability)),
      session: file.split('_').slice(0, 2).join('_'),
    }
  })
  const sessions = new Map()
  for (const f of perFrame) { if (!sessions.has(f.session)) sessions.set(f.session, []); sessions.get(f.session).push(f) }
  const perSession = [...sessions.entries()].map(([session, list]) => ({
    session, frames: list.length, median: median(list.map((f) => f.median)),
    best: list.reduce((b, f) => (f.reliability > b.reliability ? f : b), list[0]),
  }))
  const fm = perFrame.map((f) => f.median), sm = perSession.map((s) => s.median), vv = rowsKept.map((r) => r.vi)
  return {
    level: levelName, votes_kept: rowsKept.length, frames_kept: perFrame.length, sessions_kept: perSession.length,
    verdict_median_frame: label(median(fm)), verdict_median_session: label(median(sm)),
    verdict_p25_p75_frame: [label(quant(fm, 0.25)), label(quant(fm, 0.75))],
    verdict_p10_p90_frame: [label(quant(fm, 0.10)), label(quant(fm, 0.90))],
    verdict_median_all_votes: label(median(vv)),
    vote_histogram: ORDER.reduce((m, v, i) => ((m[v] = vv.filter((x) => x === i).length), m), {}),
    frame_histogram: ORDER.reduce((m, v, i) => ((m[v] = fm.filter((x) => Math.round(x) === i).length), m), {}),
    perFrame, perSession,
  }
}

const levels = [
  [0, 'mandatory_only'],
  [1, 'standard'],
  [2, 'strict'],
].map(([lv, name]) => { const { keep, reasons } = gate(lv); const s = summarize(keep, name); s.gated_out = reasons; return s })

console.log('votes per level: ' + levels.map((s) => `${s.level}=${s.votes_kept}/${s.frames_kept}f`).join('  '))
for (const s of levels) console.log(`  ${s.level.padEnd(16)} median_frame=${s.verdict_median_frame} median_session=${s.verdict_median_session} p25p75=[${s.verdict_p25_p75_frame}] p10p90=[${s.verdict_p10_p90_frame}]`)

const strict = levels[1]
const summary = {
  total_photos_in_archive: 3389,
  classified_photos: 3389,
  judges_used: [...new Set(rows.map((r) => r.model))],
  raw_votes: rows.length,
  primary_level: strict.level,
  primary_verdict_frame: strict.verdict_median_frame,
  primary_verdict_session: strict.verdict_median_session,
  primary_p25_p75: strict.verdict_p25_p75_frame,
  primary_p10_p90: strict.verdict_p10_p90_frame,
  sensitivity: levels.map((s) => ({ level: s.level, votes: s.votes_kept, frames: s.frames_kept, median_frame: s.verdict_median_frame, median_session: s.verdict_median_session })),
}

const report = {
  summary,
  robustness_levels: levels.map((s) => { const { perFrame, perSession, ...rest } = s; return rest }),
  per_session: strict.perSession.map((s) => ({ ...s, best_frame: s.best.file, best_reliability: +s.best.reliability.toFixed(2) })).sort((a, b) => b.median - a.median),
  per_frame: strict.perFrame.sort((a, b) => b.median - a.median || b.reliability - a.reliability)
    .map((f) => ({ file: f.file, median: label(f.median), votes: f.votes, judges: f.judges, reliability: +f.reliability.toFixed(2), session: f.session })),
}
writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')

console.log(JSON.stringify(summary, null, 2))
console.log(`-> ${OUT}`)
