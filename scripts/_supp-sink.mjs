// Verdict sink for the supplementary judge. Each batch of results is appended here as it comes back,
// so the judgments live on disk rather than only in the conversation. Strict validation on the way in:
// missing keys, off-enum values, or a missing sid are rejected with a reason so nothing silently
// degrades into a placeholder the way AA-as-"can't tell" did.
import { readFileSync, appendFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const P = (process.env.PORTRAIT_ROOT || 'C:\\portrait-data\\_probe') + '\\'
const SINK = path.join(P, '_supp-results.jsonl')

const ENUM = {
  bust_projection: ['flat', 'slight', 'moderate', 'pronounced'],
  bust_larger_than_waist: ['near_equal', 'slightly_larger', 'clearly_larger', 'much_larger'],
  underbust_creases_visible: ['none', 'faint', 'clear', 'deep'],
  bust_still_projects_when_side: ['no', 'slightly', 'clearly', 'strongly'],
  fit_verdict: ['AA', 'A', 'B', 'C', 'D', 'E_or_more', 'unclear'],
  garment: ['swimsuit', 'bikini', 'tank_top', 'camisole', 'tube_top', 't_shirt', 'dress', 'knitwear', 'loose_top', 'other', 'unclear'],
  pose: ['standing_front', 'standing_three_quarter', 'standing_side', 'sitting', 'leaning', 'crouching', 'in_water', 'walking'],
  chest_occluded_by: ['none', 'hair', 'arm', 'hand', 'bag', 'water', 'shadow', 'clothing', 'other'],
}
const NUM = ['shoulder_over_head', 'bust_over_head', 'underbust_over_head', 'waist_over_head', 'hip_over_head', 'torso_turned_degree', 'reliability']
const REQ = ['sid', ...NUM, ...Object.keys(ENUM), 'note']

export function validate(o) {
  const problems = []
  for (const k of REQ) if (!(k in o)) problems.push('missing:' + k)
  for (const [k, allowed] of Object.entries(ENUM)) if (k in o && !allowed.includes(o[k])) problems.push('off-enum ' + k + '=' + JSON.stringify(o[k]))
  for (const k of NUM) if (k in o && typeof o[k] !== 'number') problems.push('not-number ' + k + '=' + JSON.stringify(o[k]))
  if ('bust_over_head' in o && 'underbust_over_head' in o && o.bust_over_head < o.underbust_over_head) problems.push('bust<underbust')
  // Anatomical ordering the ratios must satisfy when the silhouette is actually being read: the chest
  // cannot silhouette wider than the shoulders. Applied only where a torso reading was claimed, because
  // unreadable frames legitimately carry zeros and must not be turned away for arithmetic.
  const readable = o.reliability >= 0.1 && o.fit_verdict !== 'unclear'
  if (readable && 'shoulder_over_head' in o && 'bust_over_head' in o && o.bust_over_head > o.shoulder_over_head) {
    problems.push('bust>shoulder ' + o.bust_over_head + '>' + o.shoulder_over_head)
  }
  return problems
}

// CLI: node _supp-sink.mjs <jsonfile-with-array>
//      node _supp-sink.mjs --replace <jsonfile-with-array>
//
// This sink is append-only, so feeding the same batch file twice would silently double those rows.
// The check below makes a re-run of an already-sunk sid a rejection instead of a second copy: after the
// s0109..s0120 re-run duplicated nine frames, the cost of an idempotency guard is obviously lower than
// the cost of a silently doubled appendix.
//
// --replace exists for the one case the guard cannot express: a row that was sunk under an older, weaker
// validator and is now known to violate a rule added since. It rewrites a matching sid in place instead of
// appending, so a correction cannot inflate the row count. It is opt-in because a silent overwrite of a
// judgment is exactly the kind of quiet data loss the rest of this file is built to prevent.
const argv = process.argv.slice(2)
const replaceMode = argv.includes('--replace')
const arg = argv.find((a) => a !== '--replace')
if (!arg) {
  const n = existsSync(SINK) ? readFileSync(SINK, 'utf8').split('\n').filter(Boolean).length : 0
  console.log('sink rows = ' + n)
  process.exit(0)
}

const already = new Set()
if (existsSync(SINK)) {
  for (const line of readFileSync(SINK, 'utf8').split('\n')) {
    if (!line) continue
    try { already.add(JSON.parse(line).sid) } catch { /* a malformed line cannot reserve an sid */ }
  }
}

const incoming = JSON.parse(readFileSync(arg, 'utf8'))
let okN = 0
const rejected = []
const replaced = []
for (const o of incoming) {
  const problems = validate(o)
  if (problems.length) { rejected.push({ sid: o && o.sid, problems }); continue }
  if (o && already.has(o.sid)) {
    if (!replaceMode) { rejected.push({ sid: o.sid, problems: ['already-sunk'] }); continue }
    const lines = readFileSync(SINK, 'utf8').split('\n').filter(Boolean)
    const next = lines.map((line) => (JSON.parse(line).sid === o.sid ? JSON.stringify({ judge: 'ds-flash-v4.1', ...o }) : line))
    writeFileSync(SINK, next.join('\n') + '\n')
    replaced.push(o.sid)
    okN++
    continue
  }
  appendFileSync(SINK, JSON.stringify({ judge: 'ds-flash-v4.1', ...o }) + '\n')
  already.add(o.sid)
  okN++
}
const n = readFileSync(SINK, 'utf8').split('\n').filter(Boolean).length
console.log(`accepted=${okN} rejected=${rejected.length} replaced=${replaced.length} sink_total=${n}`)
if (replaced.length) console.log('  REPLACED ' + replaced.join(','))
for (const r of rejected.slice(0, 10)) console.log('  REJECT ' + r.sid + ' :: ' + r.problems.join('; '))
