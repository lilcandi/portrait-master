// Unattended finisher for the plus channel.
//
// The judging pass is ~4.5 hours over 9729 model calls. Everything downstream of it is already
// written and has been exercised against simulated input and against a curated-data regression that
// reproduces the official numbers exactly; the only thing missing is the real data.
//
// This script exists so the chain does not depend on a human -- or an agent session -- still being
// awake when the judging pass ends. It died once already under a shell job cleanup, so that failure
// is guarded explicitly here.
//
//   phase 1  wait until deep-verdict-plus.jsonl holds frames * repeats answered calls, restarting the
//            judging pass when the file goes stale (a stall, not a crash: the file simply stops growing)
//   phase 2  run aggregate-plus -> compare-plus -> gen-plus-report -> test-plus-report in order,
//            stopping at the first non-zero exit so a broken step cannot be papered over
//
// STATUS_ONLY=1 prints the current accounting and exits without touching anything.
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync, existsSync, appendFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const P = (process.env.PORTRAIT_ROOT || 'C:\\portrait-data\\_probe') + '\\'
const OUT = join(P, 'deep-verdict-plus.jsonl')
const QUEUE = join(P, 'candidates-plus.txt')
const LOG = join(P, 'finish-plus.log')
const REPEAT = Number(process.env.PLUS_REPEAT || 3)
const STALL_SECONDS = Number(process.env.STALL_SECONDS || 900)
const MAX_WAIT_SECONDS = Number(process.env.MAX_WAIT_SECONDS || 8 * 3600)
const POLL_SECONDS = Number(process.env.POLL_SECONDS || 60)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function log(msg) {
  const line = '[' + new Date().toISOString() + '] ' + msg
  console.log(line)
  try { appendFileSync(LOG, line + '\n') } catch {}
}

// Accounting copied from start-plus-run.mjs on purpose: a call counts as answered only when its raw
// reply parsed. Parse failures and transport errors stay queued, otherwise a frame that failed once
// would silently drop out of the population instead of being retried.
function accounting() {
  const frames = readFileSync(QUEUE, 'utf8').split('\n').filter((l) => l.trim()).length
  const done = new Set()
  let lines = 0
  let bad = 0
  if (existsSync(OUT)) {
    for (const line of readFileSync(OUT, 'utf8').split('\n')) {
      if (!line.trim()) continue
      lines++
      try {
        const o = JSON.parse(line)
        if (o.raw) done.add(`${o.file}#${o.rep ?? 0}`)
        else bad++
      } catch { bad++ }
    }
  }
  const total = frames * REPEAT
  return { frames, total, answered: done.size, lines, bad, remaining: total - done.size }
}

// A stale file is not proof the judging pass died: the provider can simply be slow. Restarting a live
// run would put two writers on the same output and re-bill thousands of calls, so the process table
// decides, not the file age.
//
// The filter must name something only the real judging child carries. An earlier version matched
// 'batch-verdict\.mjs', which is not unique: any node process that merely *mentions* the script name
// -- the harness runner executing a probe command, for instance -- matches too, and that error is
// biased towards "alive", i.e. towards never restarting. 'candidates-plus.txt' appears only in the
// judging child's own arguments. The pids are returned so the decision is auditable in the log; the
// liveness signal used to be invisible, so a broken probe would have looked exactly like a health run.
function judgingProbe() {
  try {
    const r = spawnSync('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
      "(@(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'candidates-plus\\.txt' })) | ForEach-Object { $_.ProcessId }",
    ], { encoding: 'utf8', timeout: 30000 })
    if (r.status !== 0) return { ok: false, pids: [] }
    const pids = (r.stdout || '').split(/\s+/).filter(s => /^\d+$/.test(s))
    return { ok: true, pids }
  } catch {
    return { ok: false, pids: [] }
  }
}
// Failing towards "alive" is the safe direction: one missed restart costs hours, one spurious
// restart costs thousands of duplicate calls.
const judgingAlive = (probe) => !probe.ok || probe.pids.length > 0

function relaunch() {
  // detached + unref so the judging pass outlives this finisher and the shell job that started it
  const child = spawn(process.execPath, [join(P, 'start-plus-run.mjs')], {
    cwd: P,
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
  log('relaunched judging pass (file went stale); supervisor pid ' + child.pid)
}

const a = accounting()
log(`plus channel: frames=${a.frames} total_calls=${a.total} answered=${a.answered} remaining=${a.remaining} lines=${a.lines} unparsed_or_error=${a.bad}`)

if (process.env.STATUS_ONLY === '1') {
  log('STATUS_ONLY=1: nothing was started or changed')
  process.exit(0)
}

// ---------------------------------------------------------------- phase 1: wait for the judging pass
if (a.remaining > 0) {
  const started = Date.now()
  let lastRelaunch = 0
  for (;;) {
    await sleep(POLL_SECONDS * 1000)
    const b = accounting()
    const ageSec = existsSync(OUT) ? (Date.now() - statSync(OUT).mtimeMs) / 1000 : Infinity
    const waitedMin = ((Date.now() - started) / 1000 / 60).toFixed(1)
    // Probe every poll, not only when the file goes stale. The liveness signal has to be visible in
    // the log while everything is healthy too, otherwise a probe that answered "alive" unconditionally
    // would be indistinguishable from a run that is genuinely fine.
    const probe = judgingProbe()
    const alive = judgingAlive(probe)
    log(`waiting ${waitedMin}min: answered=${b.answered}/${b.total} remaining=${b.remaining} file_age=${Math.round(ageSec)}s judging=${probe.ok ? (probe.pids.join(',') || 'none') : 'probe FAILED (assumed alive)'}`)
    if (b.remaining <= 0) break

    // Only restart when the file has not moved for STALL_SECONDS, and never twice inside that same
    // window -- otherwise a slow provider minute would spawn a second judging pass on the same output.
    const sinceRelaunch = (Date.now() - lastRelaunch) / 1000
    if (ageSec > STALL_SECONDS && sinceRelaunch > STALL_SECONDS) {
      if (alive) {
        log(`file stale ${Math.round(ageSec)}s but ${probe.pids.length} judging process(es) alive [${probe.pids.join(',')}]; not restarting (avoids double-billing)`)
      } else {
        relaunch()
      }
      // throttle the next check either way, so a hung provider is re-examined at most every STALL_SECONDS
      lastRelaunch = Date.now()
    }
    if ((Date.now() - started) / 1000 > MAX_WAIT_SECONDS) {
      log('FATAL: waited longer than MAX_WAIT_SECONDS without the judging pass finishing')
      process.exit(1)
    }
  }
} else {
  log('judging pass already complete; going straight to the chain')
}

// ------------------------------------------------------- phase 2: aggregate, compare, render, verify
const STEPS = [
  ['aggregate-plus.mjs', 'aggregate the plus votes into plus-verdict.json'],
  ['compare-plus.mjs', 'quantify the sampling gap against the curated channel'],
  ['compare-plus-by-year.mjs', 'stratify that gap by year, so it is not an era artefact'],
  ['link-plus-plates.mjs', 'give the page a figure for every judged frame, not just the curated 150'],
  ['gen-plus-report.mjs', 'render the plus report page'],
  ['test-plus-report.mjs', 'live-DOM behavioural assertions on that page'],
]

for (const [script, what] of STEPS) {
  log('STEP ' + script + ' -- ' + what)
  const r = spawnSync(process.execPath, [join(P, script)], {
    cwd: P,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
  const out = (((r.stdout || '') + (r.stderr || '')).trim())
  if (out) {
    for (const l of out.split('\n')) {
      console.log('    ' + l)
      try { appendFileSync(LOG, '    ' + l + '\n') } catch {}
    }
  }
  log('  ' + script + ' exit=' + r.status)
  if (r.status !== 0) {
    log('FATAL: ' + script + ' exited ' + r.status + ' -- stopping so a broken step is not papered over')
    process.exit(1)
  }
}

log('DONE: plus channel finished end to end')
