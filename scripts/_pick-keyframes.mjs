// Fix the two defects in the picker's class accounting, and size the budgets arithmetically.
//
// Defect 1: class passes ran in an order where the generic band passes (A/B/C) claimed frames that
// the narrow, meaning-bearing passes (disagree / agree_unanimous) needed. A class defined by "these
// two channels disagreed" must be filled FIRST, or it silently shrinks when an earlier budget rises.
// Fix: order the passes narrowest-first, and record which class claimed each frame.
//
// Defect 2: the total overshot because budgets were raised by eye without summing the classes that
// have fixed, exhaustive sizes. Fix: derive the middle budget from the fixed classes, so the total
// hits the target by arithmetic rather than by iteration.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = process.env.PORTRAIT_ROOT || 'C:\\portrait-data\\_probe'
const TARGET = 500

const ORDER = ['AA', 'A', 'B', 'C', 'D', 'E_or_more']
const idx = (v) => ORDER.indexOf(v)

const plus = JSON.parse(readFileSync(join(P, 'plus-verdict.json'), 'utf8'))
const cur = JSON.parse(readFileSync(join(P, 'final-verdict.json'), 'utf8'))
const app = JSON.parse(readFileSync(join(P, 'supp-appendix.json'), 'utf8'))
const plates = JSON.parse(readFileSync(join(P, 'plus-plates.json'), 'utf8'))
const gallery = JSON.parse(readFileSync(join(P, 'big-gallery.json'), 'utf8'))

const cF = new Map(cur.per_frame.map(f => [f.file, f]))
const plusPlate = new Map(plates.made.map(m => [m.file, m]))
const bigPlate = new Map(gallery.made.map(m => [m.file, m]))

const unanimity = (f) => { const v = Array.isArray(f.votes) ? f.votes : []; return v.length ? v.length - new Set(v).size : -1 }
const rank = (a, b) =>
  (b.reliability || 0) - (a.reliability || 0) ||
  unanimity(a) - unanimity(b) ||
  String(a.file).localeCompare(String(b.file))

function plateFor(file) {
  const pp = plusPlate.get(file)
  if (pp) return { kind: 'plus', name: pp.outName, w: pp.outW || pp.w, h: pp.outH || pp.h }
  const bp = bigPlate.get(file)
  if (bp) return { kind: 'orig', name: bp.outName, w: bp.outW || bp.w, h: bp.outH || bp.h, srcW: bp.srcW, srcH: bp.srcH }
  return null
}

const picked = []
const seen = new Map()   // file -> class that claimed it (for the audit)

function take(f, cls) {
  if (!f || seen.has(f.file)) return false
  const pl = plateFor(f.file)
  if (!pl) return false
  seen.set(f.file, cls)
  picked.push({ file: f.file, cls, band: f.median || f.verdict || 'unclear', rel: f.reliability, plate: pl })
  return true
}

// ---- pass 1: narrow, meaning-bearing classes FIRST so nothing drains them ----
const shared = plus.per_frame.filter(f => cF.has(f.file))
let nDis = 0, nAgr = 0
for (const f of shared.filter(f => Math.abs(idx(f.median) - idx(cF.get(f.file).median)) >= 1).sort(rank)) { if (take(f, 'disagree')) nDis++ }
for (const f of shared.filter(f => idx(f.median) === idx(cF.get(f.file).median) && unanimity(f) === 0).sort(rank)) { if (take(f, 'agree_unanimous')) nAgr++ }

// ---- pass 2: the sparse extremes, IN FULL ----
let nEx = 0
for (const lv of ['E_or_more', 'D', 'AA']) {
  for (const f of plus.per_frame.filter(x => x.median === lv).sort(rank)) { if (take(f, 'extreme_' + lv)) nEx++ }
}

// ---- pass 3: appendix readable frames, different judge, IN FULL ----
const units = JSON.parse(readFileSync(join(P, '_supp-units.json'), 'utf8'))
const unitBySid = new Map(units.map(u => [u.sid, u]))
let nApp = 0
for (const f of app.per_frame.filter(x => x.verdict !== 'unclear').sort((a, b) => (b.reliability || 0) - (a.reliability || 0))) {
  const u = unitBySid.get(f.sid); if (!u) continue
  if (seen.has(f.file)) continue
  seen.set(f.file, 'appendix_readable')
  picked.push({
    file: f.file, cls: 'appendix_readable', band: f.verdict, rel: f.reliability, sid: f.sid,
    plate: { kind: 'supp', name: 's' + String(f.sid).replace(/[^0-9]/g, '').padStart(4, '0') + '.jpg' }
  })
  nApp++
}

// ---- pass 4: size the middle budget from what is already fixed ----
const fixed = picked.length
const mid = Math.max(0, TARGET - fixed)
// split the middle by each band's real supply, weighted toward the denser bands, then correct
// the rounding so the three parts sum exactly to `mid`
const supply = { A: 0, B: 0, C: 0 }
for (const lv of ['A', 'B', 'C']) supply[lv] = plus.per_frame.filter(x => x.median === lv && !seen.has(x.file)).length
const supTotal = supply.A + supply.B + supply.C
const BUDGET = { A: 0, B: 0, C: 0 }
{
  const rawA = mid * (supply.A / supTotal), rawB = mid * (supply.B / supTotal)
  BUDGET.A = Math.floor(rawA); BUDGET.B = Math.floor(rawB); BUDGET.C = Math.floor(mid * (supply.C / supTotal))
  let rem = mid - (BUDGET.A + BUDGET.B + BUDGET.C)
  // hand the remainder back to whichever band has the most unused supply
  const order = ['A', 'B', 'C'].sort((x, y) => supply[y] - supply[x])
  let i = 0
  while (rem > 0) { BUDGET[order[i % 3]]++; rem--; i++ }
}

for (const lv of ['A', 'B', 'C']) {
  const pool = plus.per_frame.filter(x => x.median === lv && !seen.has(x.file)).sort(rank)
  const strong = pool.filter(f => (f.reliability || 0) >= 0.6)
  const rest = pool.filter(f => (f.reliability || 0) < 0.6)
  let n = 0
  for (const f of strong) { if (n >= BUDGET[lv]) break; if (take(f, 'band_' + lv)) n++ }
  const need = BUDGET[lv] - n
  if (need > 0 && rest.length) {
    const step = Math.max(1, Math.floor(rest.length / need))
    for (let i = 0; i < rest.length && n < BUDGET[lv]; i += step) { if (take(rest[i], 'band_' + lv)) n++ }
  }
}

// ---- audit ----
const byCls = {}
for (const p of picked) byCls[p.cls] = (byCls[p.cls] || 0) + 1
const byKind = {}
for (const p of picked) byKind[p.plate.kind] = (byKind[p.plate.kind] || 0) + 1

console.log('target                    ' + TARGET)
console.log('fixed classes (exhaustive) ' + fixed + '  = disagree ' + nDis + ' + agree ' + nAgr + ' + extremes ' + nEx + ' + appendix ' + nApp)
console.log('supply A/B/C              ' + supply.A + '/' + supply.B + '/' + supply.C)
console.log('budget A/B/C              ' + BUDGET.A + '/' + BUDGET.B + '/' + BUDGET.C + '  (sum ' + (BUDGET.A + BUDGET.B + BUDGET.C) + ')')
console.log('picked total              ' + picked.length)
for (const k of Object.keys(byCls).sort()) console.log('  ' + k.padEnd(22) + ' ' + byCls[k])
console.log('plate kinds               ' + JSON.stringify(byKind))
console.log('picks without a plate     ' + picked.filter(p => !p.plate).length)

// a class must never be smaller than its exhaustive size -- this is the check that was missing
if (nDis !== shared.filter(f => Math.abs(idx(f.median) - idx(cF.get(f.file).median)) >= 1 && plateFor(f.file)).length) {
  console.log('WARN: disagree class is not exhaustive -- an earlier pass drained it')
}

writeFileSync(join(P, 'keyframes.json'), JSON.stringify({
  generated_from: { plus: 'plus-verdict.json', curated: 'final-verdict.json', appendix: 'supp-appendix.json' },
  headline_unaffected: 'This selection feeds figures only. It adds and changes no number on the page.',
  rules: {
    order: 'narrow meaning-bearing classes are filled BEFORE the generic band passes, so a budget rise cannot drain them',
    extremes: 'AA/D/E_or_more taken IN FULL, reliability printed with each, never padded to fill a grid',
    middle: 'A/B/C share the remaining budget in proportion to their real supply ' + JSON.stringify(BUDGET),
    disagree: 'two-channel difference >=1 band, exhaustive at ' + nDis + ' (diff>=2 has only 1 frame)',
    agree: 'two-channel agreement AND all three votes identical, exhaustive at ' + nAgr,
    appendix: 'appendix readable frames, taken in full at ' + nApp + ', labelled as a different judge'
  },
  counts_by_class: byCls,
  counts_by_plate_kind: byKind,
  frames: picked
}, null, 1), 'utf8')
console.log('wrote ' + join(P, 'keyframes.json'))
