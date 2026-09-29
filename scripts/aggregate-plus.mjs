// Plus-channel aggregation: the SAME gate rules as aggregate-verdict.mjs, applied to the all-person vote
// set instead of the curated one. The point of the exercise is the comparison, so the rules must not be
// re-tuned here -- if the plus run used softer or harder thresholds, any difference between the two
// verdicts could be the threshold rather than the population.
//
// One thing genuinely differs and must be stated rather than smoothed over: the input set. aggregate-verdict
// reads whatever is on the command line, and the curated run paired a 160-frame hand-picked candidate list
// with votes from two files (verdict.jsonl + cross.jsonl). This run has one file and one candidate list of
// 3243 frames that were never filtered by the curator. So this script takes the input paths as arguments
// and prints the four numbers that make the comparison honest:
//   - how many frames entered, and how many survived each gate level
//   - the median at each level, so a shrinking sample can be seen to move or not move
//   - what got gated out and why, so a verdict driven by the gates is visible as such
import { readFileSync, writeFileSync } from 'node:fs'

const P = (process.env.PORTRAIT_ROOT || 'C:\\portrait-data\\_probe') + '\\'
const INPUTS = (process.env.PLUS_INPUTS || `${P}deep-verdict-plus.jsonl`).split(',')
const OUT = process.env.PLUS_OUT || `${P}plus-verdict.json`

const ORDER = ['AA', 'A', 'B', 'C', 'D', 'E_or_more']
const idx = (v) => ORDER.indexOf(v)
const label = (i) => ORDER[Math.max(0, Math.min(ORDER.length - 1, Math.round(i)))]
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN }
const quant = (a, q) => { const s = [...a].sort((x, y) => x - y); if (!s.length) return NaN; const p = (s.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p); return s[lo] + (s[hi] - s[lo]) * (p - lo) }

const rows = []
let abstained = 0, malformed = 0, badRaw = 0
for (const file of INPUTS) {
  let txt
  try { txt = readFileSync(file, 'utf8') } catch { console.log('skip (missing): ' + file); continue }
  for (const line of txt.split('\n')) {
    if (!line.trim()) continue
    let o; try { o = JSON.parse(line) } catch { continue }
    if (!o.raw) { if (!o.raw) badRaw++; continue }
    const raw = o.raw
    const r = raw.fit_verdict !== undefined ? raw : { ...(raw.ratios || {}), ...(raw.bust || {}), ...(raw.quality || {}) }
    const v = r.fit_verdict
    if (v === null || v === undefined) { abstained++; continue }
    if (!ORDER.includes(v)) { malformed++; continue }
    rows.push({
      file: o.file, model: o.model || 'gpt-6-luna', rep: o.rep ?? 0, verdict: v, vi: idx(v),
      reliability: Number(r.reliability) || 0,
      occlusion: r.chest_occluded_by || 'unknown',
      garment: r.garment, pose: r.pose, turn: Number(r.torso_turned_degree) || 0,
      bustHead: Number(r.bust_over_head) || 0, underHead: Number(r.underbust_over_head) || 0,
      projection: r.bust_projection, largerThanWaist: r.bust_larger_than_waist,
      creases: r.underbust_creases_visible, sideProject: r.bust_still_projects_when_side,
    })
  }
}
console.log('raw votes: ' + rows.length + '  (records without a usable raw reply: ' + badRaw + ', abstained: ' + abstained + ', malformed verdict: ' + malformed + ')')

// identical gate rules to the curated aggregation
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
    const modes = {}; for (const v of list.map(r => r.verdict)) modes[v] = (modes[v] || 0) + 1
    const top = Object.entries(modes).sort((a, b) => b[1] - a[1])
    return {
      file, votes: list.map((r) => r.verdict), judges: [...new Set(list.map((r) => r.model))],
      median: median(vs), min: Math.min(...vs), max: Math.max(...vs),
      spread: Math.max(...vs) - Math.min(...vs),
      unanimous: new Set(list.map(r => r.verdict)).size === 1,
      mode: top[0][0], mode_share: +(top[0][1] / list.length).toFixed(2),
      reliability: median(list.map((r) => r.reliability)),
      session: file.split('_').slice(0, 2).join('_'),
      garment: list[0].garment, occlusion: list[0].occlusion, pose: list[0].pose,
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
    unanimous_frames: perFrame.filter(f => f.unanimous).length,
    mean_spread: perFrame.length ? +(perFrame.reduce((a, f) => a + f.spread, 0) / perFrame.length).toFixed(2) : 0,
    perFrame, perSession,
  }
}

const levels = [[0, 'mandatory_only'], [1, 'standard'], [2, 'strict']].map(([lv, name]) => {
  const { keep, reasons } = gate(lv); const s = summarize(keep, name); s.gated_out = reasons; return s
})

console.log('votes per level: ' + levels.map((s) => s.level + '=' + s.votes_kept + '/' + s.frames_kept + 'f').join('  '))
for (const s of levels) console.log('  ' + s.level.padEnd(16) + ' median_frame=' + s.verdict_median_frame + ' median_session=' + s.verdict_median_session + ' p25p75=[' + s.verdict_p25_p75_frame + '] p10p90=[' + s.verdict_p10_p90_frame + ']')
for (const s of levels) console.log('  ' + s.level.padEnd(16) + ' unanimous frames ' + s.unanimous_frames + '/' + s.frames_kept + '  mean vote spread ' + s.mean_spread)

const strict = levels[1]
const summary = {
  channel: 'plus_all_person',
  frames_judged: [...new Set(rows.map(r => r.file))].length,
  judges_used: [...new Set(rows.map((r) => r.model))],
  raw_votes: rows.length,
  primary_level: strict.level,
  primary_verdict_frame: strict.verdict_median_frame,
  primary_verdict_session: strict.verdict_median_session,
  primary_p25_p75: strict.verdict_p25_p75_frame,
  primary_p10_p90: strict.verdict_p10_p90_frame,
  sensitivity: levels.map((s) => ({ level: s.level, votes: s.votes_kept, frames: s.frames_kept, median_frame: s.verdict_median_frame, median_session: s.verdict_median_session })),
}
// The histograms must be carried EXPLICITLY, not as a side effect of `...rest`. compare-plus.mjs
// and gen-plus-report.mjs both read `frame_histogram` / `vote_histogram`; if they ever arrive
// undefined, section 06 of the comparison prints "undefined" and the distribution table renders
// zeros -- a silent wrong answer rather than a crash. Pin them here and verify below.
const REQUIRED_LEVEL_KEYS = ['level', 'votes_kept', 'frames_kept', 'sessions_kept', 'verdict_median_frame',
  'verdict_median_session', 'verdict_p25_p75_frame', 'verdict_p10_p90_frame', 'vote_histogram',
  'frame_histogram', 'unanimous_frames', 'mean_spread', 'gated_out']
for (const s of levels) {
  for (const k of REQUIRED_LEVEL_KEYS) {
    if (!(k in s) || s[k] === undefined) {
      console.error(`FATAL: level "${s.level}" is missing required field "${k}" -- downstream consumers would render it as undefined/0.`)
      process.exit(1)
    }
  }
  for (const h of ['vote_histogram', 'frame_histogram']) {
    const sum = ORDER.reduce((a, v) => a + (s[h][v] || 0), 0)
    const expect = h === 'vote_histogram' ? s.votes_kept : s.frames_kept
    if (sum !== expect) {
      console.error(`FATAL: ${s.level}.${h} sums to ${sum} but should equal ${expect}.`)
      process.exit(1)
    }
  }
}

const report = {
  summary,
  robustness_levels: levels.map((s) => { const { perFrame, perSession, ...rest } = s; return rest }),
  per_session: strict.perSession.map((s) => ({ ...s, best_frame: s.best.file, best_reliability: +s.best.reliability.toFixed(2) })).sort((a, b) => b.median - a.median),
  per_frame: strict.perFrame.sort((a, b) => b.median - a.median || b.reliability - a.reliability)
    .map((f) => ({ file: f.file, median: label(f.median), votes: f.votes, judges: f.judges, reliability: +f.reliability.toFixed(2), session: f.session, reliability_spread: f.spread })),
}
writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')
console.log(JSON.stringify(summary, null, 2))
console.log('-> ' + OUT)
