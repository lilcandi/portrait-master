// Start the plus judging run in the background, with the key loaded from the credentials file inside
// Node rather than through the shell -- PowerShell re-encodes non-ASCII arguments through GBK here, and
// a corrupted key or filename would fail in a way that looks like a provider problem.
//
// The run is resumable by construction: batch-verdict reads any existing OUTJSONL at startup and only
// queues (file, rep) pairs whose raw reply is missing. So an interrupted run is restarted by running
// this same script again; already-answered frames are skipped rather than re-billed.
import { spawn } from 'node:child_process'
import { readFileSync, existsSync, appendFileSync, writeFileSync, createWriteStream } from 'node:fs'
import { join } from 'node:path'

const P = (process.env.PORTRAIT_ROOT || 'C:\\portrait-data\\_probe') + '\\'
const CRED = (process.env.DSH_HOME || 'C:\\<YOUR_HOME>\\.dsh') + '\\.credentials.yaml'
const OUT = join(P, 'deep-verdict-plus.jsonl')
const LOG = join(P, 'plus-run.log')

// Resolve the key the same way the credentials file actually stores it.
//
// History, because the old code here was wrong in a way that silently killed whole runs: this used to
// grep a flat "^\s*CMC_API_KEY:" line. That line still exists but now holds a 3-character placeholder
// ("0.."), so the length guard below rejected it and the judge exited instantly -- which looked like a
// crash but was a config mismatch. Verified 2026-09-29: refs.COMMANDCODE_API_KEY (92 chars) returns
// HTTP 200 from this endpoint and accepts gpt-6-luna, while CMC_API_KEY / record.secret / record.token
// all return 401. So prefer COMMANDCODE_API_KEY, and accept a real CMC_API_KEY if one is ever restored.
const credLines = readFileSync(CRED, 'utf8').split('\n')
const refValue = (name) => {
  const l = credLines.find(x => new RegExp('^\\s*' + name + ':').test(x))
  return l ? l.replace(new RegExp('^\\s*' + name + ':\\s*'), '').trim().replace(/^["']|["']$/g, '') : ''
}
let KEY = process.env.CMC_API_KEY || ''
let keySource = 'env CMC_API_KEY'
if (KEY.length < 40) {
  for (const name of ['COMMANDCODE_API_KEY', 'CMC_API_KEY']) {
    const v = refValue(name)
    if (v.length >= 40) { KEY = v; keySource = 'refs.' + name; break }
  }
}
if (KEY.length < 40) {
  console.log('FATAL: no usable API key (env CMC_API_KEY, refs.COMMANDCODE_API_KEY, refs.CMC_API_KEY all absent or too short)')
  process.exit(1)
}

const CONC = Number(process.env.PLUS_CONC || 6)
const REPEAT = Number(process.env.PLUS_REPEAT || 3)
const MODEL = process.env.VIS_MODEL || 'gpt-6-luna'

// count what still has to be done, so the run reports its own scale before billing anything
const queue = readFileSync(join(P, 'candidates-plus.txt'), 'utf8').split('\n').filter(l => l.trim())
const done = new Set()
if (existsSync(OUT)) {
  for (const line of readFileSync(OUT, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try { const o = JSON.parse(line); if (o.raw) done.add(`${o.file}#${o.rep ?? 0}`) } catch {}
  }
}
const remaining = queue.length * REPEAT - done.size

console.log('=== plus judging run ===')
console.log('  frames          : ' + queue.length)
console.log('  repeats         : ' + REPEAT + '  (temperature 0 on the first, 0.5 on the rest -- same method as the curated run)')
console.log('  model           : ' + MODEL)
console.log('  key             : ' + keySource + ' (len ' + KEY.length + ')')
console.log('  concurrency     : ' + CONC)
console.log('  already answered: ' + done.size)
console.log('  calls remaining : ' + remaining)
console.log('  output          : deep-verdict-plus.jsonl')
console.log('')

const args = ['batch-verdict.mjs', (process.env.PORTRAIT_PHOTO_ROOT || 'C:\\portrait-data'), join(P, 'blurb_plus'), join(P, 'candidates-plus.txt'), OUT, String(CONC), String(REPEAT)]
const child = spawn(process.execPath, args, {
  cwd: P,
  env: { ...process.env, CMC_API_KEY: KEY, VIS_MODEL: MODEL },
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: false,
})
const log = createWriteStream(LOG, { flags: 'a' })
log.write('\n===== start ' + new Date().toISOString() + ' frames=' + queue.length + ' remaining=' + remaining + ' conc=' + CONC + ' =====\n')
child.stdout.on('data', d => { log.write(d); process.stdout.write(d) })
child.stderr.on('data', d => { log.write('[stderr] ' + d); process.stdout.write('[stderr] ' + d) })
child.on('exit', (code, sig) => {
  log.write('===== exit code=' + code + ' signal=' + sig + ' at ' + new Date().toISOString() + ' =====\n')
  log.end()
  console.log('child exited code=' + code + ' signal=' + sig)
})
// detached:false + no unref keeps this parent alive as the run's supervisor, so its stdout stays attached
console.log('supervisor pid ' + process.pid + ' -> child pid ' + child.pid + ', logging to plus-run.log')
