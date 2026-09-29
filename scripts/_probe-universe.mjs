// Read-only probe #3: assess coverage for a "chest most exposed + face most visible" ranking.
// Counts candidate universes. Judges nothing.
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const P = process.env.PORTRAIT_ROOT || 'C:\\portrait-data\\_probe'
const lines = (f) => readFileSync(join(P, f), 'utf8').split('\n').filter((s) => s.trim())
const cl = lines('classify.jsonl').map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
const plus = JSON.parse(readFileSync(join(P, 'plus-verdict.json'), 'utf8'))
const plates = JSON.parse(readFileSync(join(P, 'plus-plates.json'), 'utf8'))
const plateByFile = new Map(plates.made.map((m) => [m.file, 'html_assets/' + m.outName]))
const pF = new Map(plus.per_frame.map((x) => [x.file, x]))

const hasPlate = (f) => plateByFile.has(f)
const multi = (r) => r.person_count > 1

// Universe A: single-person, chest region visible
const A = cl.filter((r) => r.person_count === 1 && r.chest_region_visible === true)
// Universe B: single-person, breast outline readable
const B = cl.filter((r) => r.person_count === 1 && r.breast_outline_readable === true)
// Universe C: "exposed-ish" = none or non-concealing obstruction + outline readable
const C = cl.filter((r) => r.person_count === 1 && r.breast_outline_readable === true &&
  ['none', 'hair', 'arm', 'hand', 'prop', 'bag', 'water', 'shadow'].includes(r.chest_region_obstruction))
// Universe D: exposed garment families
const EXPOSE_GARMENT = new Set(['tank_top', 'camisole', 'tube_top', 'swimsuit', 'bikini', 'lingerie', 'none', 'dress'])
const D = cl.filter((r) => r.person_count === 1 && EXPOSE_GARMENT.has(r.outerwear) && r.chest_region_visible === true)
// Universe E: tight_fit + readable
const E = cl.filter((r) => r.person_count === 1 && r.tight_fit === true && r.breast_outline_readable === true)
// Universe F: chest_up / closeup framing (face AND chest in frame)
const F = cl.filter((r) => ['chest_up', 'closeup', 'waist_up'].includes(r.frame_coverage) && r.person_count === 1)

const report = (name, arr) => {
  const withPlate = arr.filter((r) => hasPlate(r.file)).length
  const inPlus = arr.filter((r) => pF.has(r.file)).length
  console.log(name.padEnd(46) + ' n=' + String(arr.length).padStart(5) +
    '  withPlate=' + String(withPlate).padStart(5) + '  inPlusPerFrame=' + String(inPlus).padStart(5))
}
report('A single + chest_region_visible', A)
report('B single + breast_outline_readable', B)
report('C single + readable + non-clothing obstruction', C)
report('D single + exposed garment family', D)
report('E single + tight_fit + readable', E)
report('F single + torso/closeup framing', F)

// Intersections that would best match the ask
const inter = (a, b) => a.filter((r) => b.includes(r))
const AB = A.filter((r) => r.breast_outline_readable === true)
console.log('\nA ∩ readable                       n=' + AB.length)
console.log('A ∩ readable ∧ obstruction-none    n=' + A.filter((r) => r.breast_outline_readable && r.chest_region_obstruction === 'none').length)
console.log('A ∩ readable ∧ tight_fit           n=' + A.filter((r) => r.breast_outline_readable && r.tight_fit).length)
console.log('A ∩ readable ∧ exposed garment     n=' + A.filter((r) => r.breast_outline_readable && EXPOSE_GARMENT.has(r.outerwear)).length)
console.log('A ∩ readable ∧ angle=front         n=' + A.filter((r) => r.breast_outline_readable && r.angle === 'front').length)
console.log('A ∩ readable ∧ front ∧ tight       n=' + A.filter((r) => r.breast_outline_readable && r.angle === 'front' && r.tight_fit).length)

// face-candidate proxy: frame_coverage that includes the head + photo_type portrait/half_body
const facey = cl.filter((r) => r.person_count === 1 && ['portrait', 'half_body'].includes(r.photo_type) && ['head_to_hip', 'waist_up', 'chest_up', 'closeup', 'head_to_knee'].includes(r.frame_coverage))
console.log('\nface-candidate proxy (portrait/half + head-ward framing) n=' + facey.length)
const combined = A.filter((r) => r.breast_outline_readable &&
  ['portrait', 'half_body'].includes(r.photo_type))
console.log('A ∩ readable ∧ (portrait|half_body)  n=' + combined.length)
console.log('  of which with plate            n=' + combined.filter((r) => hasPlate(r.file)).length)

// how many multi-person frames exist at all (for the "all person images" scope question)
console.log('\nmulti-person frames            n=' + cl.filter((r) => r.person_count > 1).length)
console.log('person_count===0               n=' + cl.filter((r) => r.person_count === 0).length)
console.log('total classify rows            n=' + cl.length)
console.log('plus corpus (per_frame)        n=' + plus.per_frame.length)
console.log('plates made                    n=' + plates.made.length)
