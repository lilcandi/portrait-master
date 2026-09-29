// Give the plus report page a figure source it can actually use for every frame it judges.
//
// The page's existing plates are the 150 curated frames (html_assets/big_NNNN.jpg, uncropped 1600px
// long edge). The plus channel judges 3243 frames, and only 10 of 134 sampled plus frames overlap
// that set -- so every "highest reliability" or "only plus judged this" picker was selecting frames
// with no image behind them, and section 03's whole point (showing frames the curated channel never
// looked at) was structurally unillustratable.
//
// blurb_plus/ already holds all 3243 frames as aspect-preserving, uncropped, 1024px-wide copies,
// keyed by the same album filenames as big-gallery.json. This script exposes them under ASCII names
// (html_assets/plus_thumbs/pNNNN.jpg) because emoji/CJK filenames used directly as a file:// src is
// exactly the kind of thing that fails silently, and writes a manifest so the mapping is explicit.
//
// It reads each plate's real pixel size out of its own JPEG SOF header rather than trusting a
// remembered number: no manifest from the blurb build survives, and classify.jsonl carries no
// dimensions. Hardlinks keep this free; the fallback copy only runs if linking is unavailable.
import { readdirSync, writeFileSync, existsSync, mkdirSync, linkSync, copyFileSync, openSync, readSync, closeSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const P = dirname(fileURLToPath(import.meta.url))
const SRC = join(P, 'blurb_plus')
const DST = join(P, 'html_assets', 'plus_thumbs')
const MANIFEST = join(P, 'plus-plates.json')

if (!existsSync(SRC)) {
  console.error('FATAL: ' + SRC + ' does not exist -- run gen-blurb-plus.mjs first')
  process.exit(1)
}
mkdirSync(DST, { recursive: true })

// JPEG baseline/progressive frame header: SOF0..SOF15 except DHT(C4), JPG(C8), DAC(CC).
// Only the first bytes of the file are needed; SOF sits before the scan.
function jpegSize(path) {
  const fd = openSync(path, 'r')
  let buf
  try {
    buf = Buffer.alloc(65536)
    const n = readSync(fd, buf, 0, buf.length, 0)
    buf = buf.subarray(0, n)
  } finally { closeSync(fd) }
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null
  let i = 2
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue }
    const m = buf[i + 1]
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue }
    if (m === 0xd9 || m === 0xda) break
    const len = buf.readUInt16BE(i + 2)
    if (len < 2) return null
    const isSOF = m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc
    if (isSOF) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }
    i += 2 + len
  }
  return null
}

const files = readdirSync(SRC).filter(n => /\.jpe?g$/i.test(n)).sort()

const made = []
let linked = 0, copied = 0, skipped = 0
for (let i = 0; i < files.length; i++) {
  const file = files[i]
  const outName = 'plus_thumbs/p' + String(i + 1).padStart(4, '0') + '.jpg'
  const from = join(SRC, file)
  const to = join(P, 'html_assets', outName)
  const dim = jpegSize(from)
  if (!dim || !dim.w || !dim.h) {
    console.error('FATAL: cannot read pixel size from ' + file)
    process.exit(1)
  }
  if (existsSync(to)) {
    skipped++
  } else {
    try { linkSync(from, to); linked++ }
    catch { copyFileSync(from, to); copied++ }
  }
  made.push({ i: i + 1, file, outName, w: dim.w, h: dim.h })
}

if (!made.length) {
  console.error('FATAL: blurb_plus is empty')
  process.exit(1)
}
writeFileSync(MANIFEST, JSON.stringify({
  source: 'blurb_plus',
  note: 'aspect-preserving uncropped copies, width 1024 (native width when narrower); not upscaled',
  count: made.length,
  made,
}, null, 1))

const w1024 = made.filter(m => m.w === 1024).length
const dist = {}
for (const m of made) dist[m.w] = (dist[m.w] || 0) + 1
console.log('=== plus plates ===')
console.log('  source            : blurb_plus (' + files.length + ' frames)')
console.log('  linked/copied/skip: ' + linked + ' / ' + copied + ' / ' + skipped)
console.log('  manifest          : ' + MANIFEST)
console.log('  width 1024        : ' + w1024 + ' of ' + made.length)
console.log('  other widths      : ' + Object.entries(dist).filter(([w]) => Number(w) !== 1024).map(([w, n]) => w + ':' + n).join(' ') || 'none')
console.log('  sample            : ' + made[0].outName + ' <- ' + made[0].file + '  ' + made[0].w + 'x' + made[0].h)
