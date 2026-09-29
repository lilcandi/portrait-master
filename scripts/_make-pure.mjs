// Pure-conclusions page: 1000 person frames, strongest evidence first, one short claim each.
//
// Design constraints from the user, verbatim intent:
//   - conclusions only, no long analysis
//   - ordered by the most reliable images first
//   - ONE short claim per image
//   - must contain 1000 frames of people
//
// Sorting is reliability descending across the WHOLE judged corpus (plus.summary.frames_judged),
// not just the primary-gate survivors: the user asked for 1000 images and the gate survivors on
// their own cannot reach 1000.
//
// Two things this page must never do:
//   1. Print an A/B/C label with nothing behind it. Every claim is derived from the frame's own
//      votes/reliability, and the derivation is visible in the claim text.
//   2. Mix the appendix channel in silently. The tail frames were judged by a DIFFERENT judge
//      under a reworded prompt; if any of them land in the top 1000 they must be labelled as such.
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const P = process.env.PORTRAIT_ROOT || 'C:\\portrait-data\\_probe'
const OUT = join(P, '_pure')
mkdirSync(OUT, { recursive: true })

const N = 1000

const plus = JSON.parse(readFileSync(join(P, 'plus-verdict.json'), 'utf8'))
const plates = JSON.parse(readFileSync(join(P, 'plus-plates.json'), 'utf8'))

// Everything the plus pass judged, whether or not it survived the primary gate.
const judged = plus.per_frame
console.log('judged frames available: ' + judged.length)
console.log('primary-gate survivors : ' + (plus.per_frame.length ? judged.filter(f => f.reliability >= 0.45).length : 0))

// --- plate lookup: map judged frame -> an image on disk ------------------------
// plus-plates.json shape (verified by reading the file, not guessed):
//   { source, note, count, made: [ { i, file, outName: "plus_thumbs/pNNNN.jpg", w, h } ] }
// made[] has 3243 entries, one per judged person frame, so the lookup is by `file`.
const plateByFile = new Map()
for (const p of (plates.made || [])) {
  if (p && p.file) plateByFile.set(p.file, p)
}
console.log('plate entries           : ' + plateByFile.size)

const ORD = ['AA', 'A', 'B', 'C', 'D', 'E_or_more']

// reliability descending is the user's chosen sort. Ties broken by stricter agreement first
// (a 3/3 unanimous frame is stronger evidence than a split one at the same reliability score),
// then by file name so the order is deterministic and re-runnable.
const ranked = judged
  .filter(f => f && typeof f.reliability === 'number' && Number.isFinite(f.reliability))
  .slice()
  .sort((a, b) => {
    if (b.reliability !== a.reliability) return b.reliability - a.reliability
    const ua = Array.isArray(a.votes) ? new Set(a.votes).size : 9
    const ub = Array.isArray(b.votes) ? new Set(b.votes).size : 9
    if (ua !== ub) return ua - ub
    return String(a.file).localeCompare(String(b.file))
  })

console.log('ranked (finite rel)     : ' + ranked.length)

const picked = ranked.slice(0, N)
if (picked.length < N) {
  console.error('FATAL: only ' + picked.length + ' frames have a finite reliability; cannot build ' + N)
  process.exit(1)
}
console.log('picked                  : ' + picked.length)
console.log('rel range of picks      : ' + picked[picked.length - 1].reliability.toFixed(3) + ' .. ' + picked[0].reliability.toFixed(3))

// distribution sanity: what does the top-1000 look like
const bandHist = {}
for (const f of picked) bandHist[f.median] = (bandHist[f.median] || 0) + 1
console.log('band histogram of picks : ' + JSON.stringify(bandHist))

const unan = picked.filter(f => Array.isArray(f.votes) && new Set(f.votes).size === 1).length
console.log('unanimous (3/3) in picks: ' + unan)

// --- render thumbnails at the SAME settings as the delivered report -----------
// 1024 long edge, q:v 2, full chroma. Reusing the previous mistake (q:v 78, 4:2:0) here would
// make this page blurry for exactly the reason the user complained about.
const LONG = 1024, Q = 2, PIX_FMT = 'yuvj444p'
const TH = join(OUT, 'th')
mkdirSync(TH, { recursive: true })

function jpegSize(buf) {
  let i = 2
  while (i < buf.length - 9) {
    if (buf[i] !== 0xFF) { i++; continue }
    const m = buf[i + 1]
    if (m === 0xD8 || m === 0xD9 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue }
    const len = buf.readUInt16BE(i + 2)
    if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
      return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)]
    }
    i += 2 + len
  }
  return null
}

const suppOk = existsSync(join(P, '_supp_ascii'))
let rendered = 0, copied = 0, failed = 0
const fails = []
const items = []

// Where the plus plates actually live, verified by listing the dir once rather than assuming.
const PLUS_THUMBS = join(P, 'html_assets', 'plus_thumbs')
if (!existsSync(PLUS_THUMBS)) {
  console.error('FATAL: plus_thumbs dir not found at ' + PLUS_THUMBS)
  process.exit(1)
}

picked.forEach((f, i) => {
  const pl = plateByFile.get(f.file)
  let src = null
  if (pl && pl.outName) {
    // outName is "plus_thumbs/pNNNN.jpg"; resolve under html_assets/
    const cand = join(P, 'html_assets', pl.outName.replace(/\//g, '\\'))
    if (existsSync(cand)) src = cand
  }
  if (!src) { failed++; fails.push(f.file + ' :: no plate on disk'); return }

  const outName = 'p' + String(i).padStart(4, '0') + '.jpg'
  const dst = join(TH, outName)
  let w = 0, h = 0
  try {
    const [sw, sh] = jpegSize(readFileSync(src)) || [0, 0]
    const longEdge = Math.max(sw, sh)
    if (longEdge <= LONG) {
      copyFileSync(src, dst)
      copied++
      w = sw; h = sh
    } else {
      const vf = sw >= sh ? 'scale=' + LONG + ':-1' : 'scale=-1:' + LONG
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', vf, '-q:v', String(Q), '-pix_fmt', PIX_FMT, dst], { stdio: 'ignore' })
      rendered++
      const [dw, dh] = jpegSize(readFileSync(dst)) || [0, 0]
      w = dw; h = dh
    }
  } catch (e) {
    failed++; fails.push(f.file + ' :: ' + String(e.message || e).slice(0, 80)); return
  }
  if (!existsSync(dst)) { failed++; fails.push(f.file + ' :: output missing'); return }

  items.push({
    rank: i + 1, file: f.file, median: f.median, votes: f.votes || [],
    reliability: f.reliability, spread: f.reliability_spread,
    judges: f.judges || 0, session: f.session || null,
    outName, w, h, bytes: statSync(dst).size
  })
})

console.log('rendered                : ' + rendered)
console.log('copied                  : ' + copied)
console.log('failed                  : ' + failed)
if (fails.length) for (const s of fails.slice(0, 10)) console.log('  FAIL ' + s)
console.log('items                   : ' + items.length)

const totalBytes = items.reduce((a, m) => a + m.bytes, 0)
console.log('thumb total             : ' + (totalBytes / 1048576).toFixed(2) + ' MB')
console.log('base64 estimate         : ' + (totalBytes * 1.37 / 1048576).toFixed(2) + ' MB')

writeFileSync(join(OUT, 'pure-items.json'), JSON.stringify({
  generated_by: '_make-pure.mjs', n: items.length, long_edge: LONG, quality: Q, pix_fmt: PIX_FMT,
  sort: 'reliability desc, then fewer distinct votes, then file name',
  source: 'plus.per_frame (all judged person frames)',
  total_bytes: totalBytes, items
}, null, 1), 'utf8')
console.log('wrote ' + join(OUT, 'pure-items.json'))
