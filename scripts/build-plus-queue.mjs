// Queue builder for the plus run.
//
// The curated run judged 160 frames chosen from the album. This run judges every frame the classifier
// says contains a person, which is 3243 frames -- so the two runs answer different questions and the gap
// between their answers is exactly the thing worth reporting: how much does the curated selection bias
// the result?
//
// The queue file is generated rather than assumed, for the same reason the earlier scripts were fixed:
// deep-verdict.jsonl does not exist (it was gone from disk), candidates.txt holds only the 160 curated
// frames, and 3023 of the 3243 person frames had no blurb at all. Writing the list here means the run's
// input is inspectable, and the same list can be handed to the resumable judge unchanged.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const P = (process.env.PORTRAIT_ROOT || 'C:\\portrait-data\\_probe') + '\\'
const OUT = join(P, 'candidates-plus.txt')
const BLURB = join(P, 'blurb_plus')

const rows = readFileSync(join(P, 'classify.jsonl'), 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l))
const persons = rows.filter(r => Number(r.person_count) >= 1)

// Every requested frame must have a blurb, otherwise batch-verdict silently counts it as an error and the
// frame simply never votes. The blurb set was verified complete (3243/3243) before this ran; the assertion
// stays because the failure mode is invisible.
const missing = persons.filter(r => !existsSync(join(BLURB, r.file)))
if (missing.length) {
  console.log('MISSING BLURBS: ' + missing.length)
  missing.slice(0, 10).forEach(m => console.log('  ' + m.file))
  process.exit(1)
}

const files = persons.map(r => r.file)
writeFileSync(OUT, files.join('\n') + '\n')

const byType = new Map(), byRead = { true: 0, false: 0 }
for (const r of persons) {
  byType.set(r.photo_type, (byType.get(r.photo_type) || 0) + 1)
  byRead[String(Boolean(r.breast_outline_readable))]++
}

console.log('=== plus queue ===')
console.log('  album frames classified        : ' + rows.length)
console.log('  frames with a person           : ' + persons.length)
console.log('  written to                     : candidates-plus.txt')
console.log('  judged calls (x3 repeats)      : ' + (files.length * 3))
console.log('  photo_type: ' + [...byType.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ':' + v).join('  '))
console.log('  breast_outline_readable true/false: ' + byRead.true + ' / ' + byRead.false)
console.log('')
console.log('  Note on scope: the run covers every person frame, but the frames where the chest silhouette')
console.log('  is legible are the ' + byRead.true + ' with breast_outline_readable=true. Votes from the remaining ' + byRead.false + '')
console.log('  are still collected -- they are what makes an all-person reading possible at all, and their')
console.log('  low reliability is carried into the aggregation rather than silently dropped.')
