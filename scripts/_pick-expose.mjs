// Pick ~500 frames: strict chest criterion (obstruction=none AND breast_outline_readable)
// with a face-visibility score as a RANKING BOOST (not a filter).
// Writes expose-items.json. Read-only w.r.t. all source data.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = process.env.PORTRAIT_ROOT || 'C:\\portrait-data\\_probe'
const lines = (f) => readFileSync(join(P, f), 'utf8').split('\n').filter((s) => s.trim())
const cl = lines('classify.jsonl').map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
const plus = JSON.parse(readFileSync(join(P, 'plus-verdict.json'), 'utf8'))
const plates = JSON.parse(readFileSync(join(P, 'plus-plates.json'), 'utf8'))
const plateByFile = new Map(plates.made.map((m) => [m.file, 'html_assets/' + m.outName]))
const pF = new Map(plus.per_frame.map((x) => [x.file, x]))

const TARGET = 500

// ---- STRICT chest pool (user's choice #1)
const pool = cl.filter((r) =>
  r.person_count === 1 &&
  r.chest_region_visible === true &&
  r.breast_outline_readable === true &&
  r.chest_region_obstruction === 'none')

// ---- garment tiers: how much of the chest the garment itself can hide.
// Tier is about GARMENT CUT, not about how common the category is. 'dress' is a
// CUT-AGNOSTIC label (a turtleneck dress and a slip dress share it), so it must NOT
// outrank actual low-cut cuts. It sits with the covered tops.
const GARMENT_TIER = new Map([
  ['lingerie', 5], ['bikini', 5], ['swimsuit', 5], ['tube_top', 5],
  ['camisole', 4], ['tank_top', 4], ['none', 4],
  ['sportswear', 3], ['other', 3], ['dress', 2],
  ['t_shirt', 2], ['shirt', 2], ['knitwear', 2],
  ['jacket', 0], ['unclear', 0],
])

// ---- face-visibility proxy score (0..3). Filter: NONE. Ranking boost only.
function faceScore(r) {
  let s = 0
  if (r.photo_type === 'portrait') s += 2
  else if (r.photo_type === 'half_body') s += 1
  if (['chest_up', 'closeup'].includes(r.frame_coverage)) s += 1
  else if (['waist_up', 'head_to_hip'].includes(r.frame_coverage)) s += 1
  return s
}

// ---- angle: front is the cleanest read of the chest region
function angleScore(r) {
  if (r.angle === 'front') return 2
  if (r.angle === 'three_quarter') return 1
  if (r.angle === 'side') return 0
  return 0
}

for (const r of pool) {
  r._g = GARMENT_TIER.get(r.outerwear) ?? 0
  r._f = faceScore(r)
  r._a = angleScore(r)
  r._tight = r.tight_fit === true ? 1 : 0
}

// ---- ranking: exposure first (garment tier), then FACE, then angle, then tightness.
// Measured: within the strict pool, tight_fit as the 2nd key pushes face>=2 down to 153;
// as the 4th key it is 203 at essentially the same garment mix. Deterministic: the
// last key is the filename, so the order is a total order.
pool.sort((x, y) =>
  (y._g - x._g) || (y._f - x._f) || (y._a - x._a) || (y._tight - x._tight) ||
  String(x.file).localeCompare(String(y.file)))

const picked = pool.slice(0, TARGET)

// ---- guards
const noPlate = picked.filter((r) => !plateByFile.has(r.file))
if (noPlate.length) {
  console.log('FATAL: ' + noPlate.length + ' picked frames have no plate')
  for (const r of noPlate.slice(0, 5)) console.log('  ' + r.file)
  process.exit(1)
}
if (picked.length !== TARGET) {
  console.log('FATAL: pool ' + pool.length + ' < target ' + TARGET)
  process.exit(1)
}

const hist = (arr, f) => {
  const m = {}
  for (const r of arr) { const k = String(f(r)); m[k] = (m[k] || 0) + 1 }
  return Object.entries(m).sort((a, b) => b[1] - a[1])
}

console.log('strict pool            ' + pool.length)
console.log('picked                 ' + picked.length)
console.log('garment tiers in picks ' + JSON.stringify(hist(picked, (r) => r._g)))
console.log('face score in picks    ' + JSON.stringify(hist(picked, (r) => r._f)))
console.log('angle in picks         ' + JSON.stringify(hist(picked, (r) => r.angle)))
console.log('photo_type in picks    ' + JSON.stringify(hist(picked, (r) => r.photo_type)))
console.log('frame_coverage in picks' + JSON.stringify(hist(picked, (r) => r.frame_coverage)))
console.log('outerwear in picks     ' + JSON.stringify(hist(picked, (r) => r.outerwear)))
console.log('tight_fit in picks     ' + JSON.stringify(hist(picked, (r) => String(r.tight_fit))))
console.log('face score >=1         ' + picked.filter((r) => r._f >= 1).length)
console.log('face score >=2         ' + picked.filter((r) => r._f >= 2).length)
console.log('has plus verdict       ' + picked.filter((r) => pF.has(r.file)).length)

// ---- items for the page
const items = picked.map((r, i) => {
  const pf = pF.get(r.file)
  return {
    rank: i + 1,
    file: r.file,
    plate: plateByFile.get(r.file),      // html_assets/plus_thumbs/pNNNN.jpg
    outerwear: r.outerwear,
    garment_tier: r._g,
    tight_fit: r.tight_fit === true,
    obstruction: r.chest_region_obstruction,
    chest_visible: r.chest_region_visible,
    outline_readable: r.breast_outline_readable,
    photo_type: r.photo_type,
    frame_coverage: r.frame_coverage,
    angle: r.angle,
    camera_distance: r.camera_distance,
    face_score: r._f,
    // plus-channel verdict, when this frame was judged there
    band: pf ? pf.median : null,
    votes: pf ? pf.votes : null,
    reliability: pf ? pf.reliability : null,
    note: r.note ?? null,
  }
})

writeFileSync(join(P, 'expose-items.json'),
  JSON.stringify({ generated_from: 'classify.jsonl + plus-verdict.json + plus-plates.json',
    rule: { chest: 'person_count=1 AND chest_region_visible=true AND breast_outline_readable=true AND chest_region_obstruction=none',
      ranking: 'garment_tier desc, tight_fit desc, face_score desc, angle desc, file asc',
      face: 'ranking boost only, never a filter' },
    pool: pool.length, count: items.length, items }, null, 2))
console.log('\nwrote expose-items.json  count=' + items.length)
