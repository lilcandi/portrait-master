// Which source file backs each pick, and is a resizer available?
// The page references html_assets/<name>; the real pixels live there. 451 picks map to
// plus_thumbs/pNNNN.jpg and 49 to _supp_ascii/sNNNN.jpg. Check both resolve, check dimensions
// from the JPEG SOF header (no external dep, same approach link-plus-plates.mjs uses), and probe
// whether sharp/jimp exist -- if not, re-encoding has to go through a browser canvas or ffmpeg.
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const P = process.env.PORTRAIT_ROOT || 'C:\\portrait-data\\_probe'
const out = (k, v) => console.log(String(k).padEnd(30) + ' ' + v)

const kf = JSON.parse(readFileSync(join(P, 'keyframes.json'), 'utf8'))
out('keyframes', kf.frames.length)

// JPEG SOF reader: walk the markers, return [w,h]. Read-only, no dependency.
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

const paths = kf.frames.map(f => {
  const name = f.plate.name
  if (f.plate.kind === 'supp') return join(P, '_supp_ascii', name)
  return join(P, 'html_assets', name)
})

let ok = 0, miss = 0
const dims = {}
for (const p of paths) {
  if (!existsSync(p)) { miss++; continue }
  ok++
  const [w, h] = jpegSize(readFileSync(p)) || [0, 0]
  const k = w + 'x' + h
  dims[k] = (dims[k] || 0) + 1
}
out('source files resolvable', ok + ' ok / ' + miss + ' missing')
out('distinct dimensions', Object.keys(dims).length)
const top = Object.entries(dims).sort((a, b) => b[1] - a[1]).slice(0, 8)
for (const [k, v] of top) out('  dim ' + k, v)

// resizer availability
const has = (m) => { try { return require.resolve(m) ? true : false } catch { return false } }
const probe = ['sharp', 'jimp', 'canvas']
for (const m of probe) {
  let found = false
  try { await import(m); found = true } catch { found = false }
  out('module ' + m, found ? 'AVAILABLE' : 'not installed')
}

// ffmpeg / magick on PATH?
import { execFileSync } from 'node:child_process'
for (const exe of ['ffmpeg', 'magick', 'convert']) {
  try { execFileSync(exe, ['-version'], { stdio: 'ignore' }); out('exe ' + exe, 'AVAILABLE') }
  catch { out('exe ' + exe, 'not on PATH') }
}
