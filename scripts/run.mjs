// The generator's stdout is silently dropped by this environment's shell pipeline. Every build and
// probe from here on must therefore capture output inside Node and write it to a file, then read the
// file with the read tool. This wrapper is that capture step, reusable for any script.
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const P = (process.env.PORTRAIT_ROOT || 'C:/portrait-data/_probe') + '/'
const script = process.argv[2] || 'gen-gallery-report.mjs'
const logName = process.argv[3] || 'build-report.txt'

const r = spawnSync(process.execPath, [P + script], {
  cwd: P, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024,
})

const report = [
  '=== node ' + script + ' ===',
  'status: ' + r.status,
  'signal: ' + r.signal,
  'error : ' + (r.error ? r.error.message : 'none'),
  'stdout bytes: ' + (r.stdout ? r.stdout.length : 0),
  'stderr bytes: ' + (r.stderr ? r.stderr.length : 0),
  '',
  '===== STDOUT =====',
  r.stdout || '(empty)',
  '===== STDERR =====',
  r.stderr || '(empty)',
  '===== END =====',
].join('\n')

writeFileSync(P + logName, report, 'utf8')
// keep the shell line short: the environment truncates or drops longer node output anyway
console.log('status ' + r.status + ' -> ' + logName)
if (r.status !== 0) process.exitCode = r.status
