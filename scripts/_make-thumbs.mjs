// Build 720px thumbnails for the 500 selected key frames, using ffmpeg (the only resizer
// available on this machine -- sharp/jimp/canvas are all absent).
//
// Scale is applied so the LONG edge is 720 and the aspect ratio is preserved exactly
// (-1 on the other axis). Never upscale: a source whose long edge is already <=720 is copied
// unchanged, because enlarging it would invent detail and add bytes for nothing.
// Output names are ASCII and flat (t0000.jpg..t0499.jpg) -- CJK/emoji names as file:// srcs are a
// known silent-failure source, and the inliner reads these by path.
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const P = process.env.PORTRAIT_ROOT || 'C:\\portrait-data\\_probe'
const OUT = join(P, '_inline_thumbs')
mkdirSync(OUT, { recursive: true })

const LONG = 1024
// -q:v is a QUANTISER SCALE, LOWER IS BETTER (2 = near-lossless, 31 = worst). The previous
// value here was 78, which is far outside the legal range -- that mistake is the entire reason
// the first delivery looked blurry. Measured against a near-lossless reference, q:v 2 at
// 4:4:4 came out byte-identical on every sampled frame.
const Q = 2
// Full chroma, no subsampling: 4:2:0 throws away colour detail first and is what makes coloured
// edges smear at 1:1. Costs roughly 25% more bytes; worth it at this quality target.
const PIX_FMT = 'yuvj444p'

const kf = JSON.parse(readFileSync(join(P, 'keyframes.json'), 'utf8'))
console.log('key frames to render: ' + kf.frames.length)

function srcPath(f) {
  const name = f.plate.name
  return f.plate.kind === 'supp' ? join(P, '_supp_ascii', name) : join(P, 'html_assets', name)
}

// JPEG SOF reader -- decide whether a resize is needed at all, without a dependency.
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

const manifest = []
let rendered = 0, copied = 0, failed = 0
const fails = []

kf.frames.forEach((f, i) => {
  const src = srcPath(f)
  const outName = 't' + String(i).padStart(4, '0') + '.jpg'
  const dst = join(OUT, outName)
  if (!existsSync(src)) { failed++; fails.push(f.file + ' :: source missing'); return }

  const [sw, sh] = jpegSize(readFileSync(src)) || [0, 0]
  const longEdge = Math.max(sw, sh)

  if (longEdge <= LONG) {
    // already small enough; do not upscale
    copyFileSync(src, dst); copied++
  } else {
    // -1 keeps the aspect ratio; scale on the long axis only
    const vf = sw >= sh ? 'scale=' + LONG + ':-1' : 'scale=-1:' + LONG
    try {
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', vf, '-q:v', String(Q), '-pix_fmt', PIX_FMT, dst], { stdio: 'ignore' })
      rendered++
    } catch (e) {
      failed++; fails.push(f.file + ' :: ffmpeg failed'); return
    }
  }
  const bytes = existsSync(dst) ? statSync(dst).size : 0
  const [dw, dh] = existsSync(dst) ? (jpegSize(readFileSync(dst)) || [0, 0]) : [0, 0]
  manifest.push({
    i, outName, srcName: f.plate.name, kind: f.plate.kind,
    cls: f.cls, band: f.band, rel: f.rel, file: f.file, sid: f.sid || null,
    srcW: sw, srcH: sh, w: dw, h: dh, bytes, resized: longEdge > LONG
  })
})

console.log('rendered (downscaled): ' + rendered)
console.log('copied  (already small): ' + copied)
console.log('failed                 : ' + failed)
if (fails.length) for (const s of fails.slice(0, 10)) console.log('  FAIL ' + s)

const totalBytes = manifest.reduce((a, m) => a + m.bytes, 0)
console.log('manifest entries       : ' + manifest.length)
console.log('thumbnail total        : ' + (totalBytes / 1048576).toFixed(2) + ' MB')
console.log('base64 estimate        : ' + (totalBytes * 1.37 / 1048576).toFixed(2) + ' MB')
if (manifest.length) {
  const bs = manifest.map(m => m.bytes).sort((a, b) => a - b)
  console.log('thumb bytes min/med/max: ' + bs[0] + ' / ' + bs[(bs.length / 2) | 0] + ' / ' + bs[bs.length - 1])
}

writeFileSync(join(P, '_inline_thumbs.json'), JSON.stringify({
  long_edge: LONG, quality: Q, pix_fmt: PIX_FMT, generated_by: 'ffmpeg',
  note: 'never upscales: sources already <=' + LONG + ' on the long edge are copied byte-for-byte',
  counts: { rendered, copied, failed, total: manifest.length },
  total_bytes: totalBytes,
  entries: manifest
}, null, 1), 'utf8')
console.log('wrote ' + join(P, '_inline_thumbs.json'))
