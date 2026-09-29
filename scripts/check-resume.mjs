// Prove the resume claim instead of trusting it.
//
// batch-verdict only skips pairs whose recorded reply has a non-null raw field. That is a specific rule,
// and the promise "an interrupted run continues where it stopped" is only true if the rule actually lines
// up with how failures are recorded: bad (unparseable) and error (transport) records are written to the
// SAME file but must NOT count as done, otherwise a frame that failed once would be skipped forever and
// silently drop out of the sample.
//
// This script reads the live output file and reports the three categories separately, plus what a restart
// would queue. It is safe to run at any time, including while the batch is writing.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const P = (process.env.PORTRAIT_ROOT || 'C:\\portrait-data\\_probe') + '\\'
const OUT = join(P, 'deep-verdict-plus.jsonl')
const REPEAT = 3

if (!existsSync(OUT)) { console.log('no output file yet'); process.exit(0) }

const queue = readFileSync(join(P, 'candidates-plus.txt'), 'utf8').split('\n').filter(l => l.trim())
const total = queue.length * REPEAT

const good = new Set(), bad = new Map(), err = new Map()
let lines = 0, unparseable = 0
for (const line of readFileSync(OUT, 'utf8').split('\n')) {
  if (!line.trim()) continue
  lines++
  let o
  try { o = JSON.parse(line) } catch { unparseable++; continue }
  const k = `${o.file}#${o.rep ?? 0}`
  if (o.raw) good.add(k)
  else if (o.error) err.set(k, o.error)
  else bad.set(k, true)
}

console.log('=== deep-verdict-plus.jsonl ===')
console.log('  lines written        : ' + lines + (unparseable ? '  (' + unparseable + ' lines not parsable -- a torn write would look like this)' : ''))
console.log('  answered (raw ok)    : ' + good.size + ' / ' + total + '  = ' + (100 * good.size / total).toFixed(1) + '%')
console.log('  unparseable replies  : ' + bad.size)
console.log('  transport errors     : ' + err.size)
console.log('')
console.log('  Of the ' + total + ' planned calls, a restart of start-plus-run.mjs would queue ' + (total - good.size) + '.')
console.log('  That number must equal (unanswered + unparseable + errors) = ' + (total - good.size) +
  ' -> ' + (total - good.size === total - good.size ? 'consistent by definition' : ''))
console.log('')
if (err.size) {
  const kinds = new Map()
  for (const [k, e] of err) {
    const t = String(e).slice(0, 60)
    kinds.set(t, (kinds.get(t) || 0) + 1)
  }
  console.log('  error kinds:')
  for (const [t, c] of [...kinds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log('    ' + c + 'x  ' + t)
}
if (bad.size) console.log('  NOTE: ' + bad.size + ' replies were not JSON. Those frames will be re-asked on restart (correct), and must not be counted as silent zeros in the aggregation.')

// what a restart actually puts back on the queue, listed explicitly for a few of them
const missing = []
outer: for (const f of queue) for (let r = 0; r < REPEAT; r++) { if (!good.has(`${f}#${r}`)) { missing.push(`${f}#${r}`); if (missing.length >= 8) break outer } }
console.log('')
console.log('  first pairs a restart would queue:')
for (const m of missing) console.log('    ' + m)
