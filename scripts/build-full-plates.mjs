// Full-image plates: every argument figure rendered UNCROPPED at full width, one per row.
//
// WHAT THIS REPLACES AND WHY
//
// The argument figures so far were built for density: crop_NN.jpg was a 30%-62% height band cut out
// of a frame, and pair/sheet images packed many frames into one canvas. That is the right shape for a
// claim that says "look at these twelve frames", and the wrong shape for a claim that says "look at
// THIS frame". The user's request -- every image, uncropped, shown directly -- is the second kind.
//
// So this script produces a new asset class rather than resizing the old one:
//
//   full_NNN.jpg   one archive frame, complete, no crop, longest edge 1600px, q88
//
// Frames are chosen to cover the argument, not to be pretty: every session that carries a verdict,
// every garment family, and the frames that moved the median. Each plate records the original
// pixel dimensions and the source filename, so "is anything cut off?" is answerable by inspection
// instead of by trust.
//
// Honest limitation, stated here because it affects how the output should be read: this session's
// model declares no image input. The plates are verified by sharp metadata (dimensions, aspect ratio
// preserved against the source, byte size) and by an explicit crop-ratio check. Nobody has looked at
// them. The user should.
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = (process.env.PORTRAIT_PHOTO_ROOT || 'C:\\portrait-data')
const P = join(ROOT, '_probe')
const OUT = join(P, 'html_assets')
// sharp resolves only from the web profile's node_modules; the parent path does not exist.
const DSH_HOME = process.env.DSH_HOME || 'C:/<YOUR_HOME>/.dsh'
const sharp = (await import('file:///' + DSH_HOME + '/profiles/web/node_modules/sharp/dist/index.mjs')).default

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true })

const verdict = JSON.parse(readFileSync(join(P, 'final-verdict.json'), 'utf8'))
const layers = JSON.parse(readFileSync(join(P, 'garment-layers.json'), 'utf8'))
const assets = JSON.parse(readFileSync(join(P, 'html-assets.json'), 'utf8'))
// The curated portrait list lives inside report_assets, not at the _probe root -- verified by
// diag-manifests.mjs rather than assumed. Its element fields are
// file,w,h,kb,source,date,theme,photo_type,garment,angle,coverage,obstruction,caption
const manifest = JSON.parse(readFileSync(join(P, 'report_assets', 'manifest.json'), 'utf8'))

// Ordinal mapping used throughout the study; kept here so plate captions can name the shift.
const ORDER = ['AA', 'A', 'B', 'C', 'D', 'E_or_more']
const num = l => ORDER.indexOf(l)

const perFrame = verdict.per_frame || []
const byFile = new Map(perFrame.map(f => [f.file, f]))

// ---------------------------------------------------------------- frame selection
// Coverage beats volume: a plate is only worth its 300 KB if it carries a distinct claim. These
// buckets are deliberately overlapping -- a frame can be both "the highest-confidence read" and
// "from a swimwear session", and dropping it from either bucket would lose one of the two points.
const picks = []
const seen = new Set()
const add = (file, why) => {
  if (!file || seen.has(file)) return
  if (!existsSync(join(ROOT, file))) return
  seen.add(file)
  picks.push({ file, why })
}

// 1. the frames that drove the headline: highest-confidence frame per verdict level
for (const lvl of ['AA', 'A', 'B', 'C', 'D']) {
  const cands = perFrame.filter(f => f.median === lvl).sort((a, b) => (b.reliability || 0) - (a.reliability || 0))
  for (const c of cands.slice(0, 3)) add(c.file, `判定 ${lvl} 档的最高可靠度帧（可靠度 ${c.reliability}）`)
}

// 2. one frame from each of the busiest sessions, so the plates are not all from one trip
const sessCount = new Map()
for (const f of perFrame) {
  const key = String(f.file).split('_').slice(0, 2).join('_')
  sessCount.set(key, (sessCount.get(key) || 0) + 1)
}
const topSessions = [...sessCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18)
for (const [s, n] of topSessions) {
  const f = perFrame.filter(x => String(x.file).startsWith(s)).sort((a, b) => (b.reliability || 0) - (a.reliability || 0))[0]
  add(f && f.file, `场次 ${s} 的代表帧（该场次 ${n} 帧入判）`)
}

// 3. one frame per garment family, so the layering claim has a face
if (layers && layers.per_frame) {
  const famOf = new Map(layers.per_frame.map(x => [x.file, x.family]))
  const want = ['skin_tight', 'clingy', 'moderate', 'loose']
  for (const fam of want) {
    const cands = perFrame.filter(f => famOf.get(f.file) === fam).sort((a, b) => (b.reliability || 0) - (a.reliability || 0))
    for (const c of cands.slice(0, 4)) add(c.file, `衣着族 ${fam} 举证帧（判定 ${c.median}，可靠度 ${c.reliability}）`)
  }
}

// 4. the paired sessions -- same session, tight against loose, which is the study's decisive test
for (const ps of (layers.paired_sessions || [])) {
  for (const f of (ps.frames || [])) add(f.file || f, `场次内配对：${ps.session}（贴身 vs 宽松差 ${ps.diff} 档）`)
}

// 5. portrait evidence frames already curated for the reports
for (const p of (manifest.portraits || [])) add(p.file || p.source, `人物画像代表帧：${p.garment || ''} / ${p.coverage || ''}`)

// 6. the report's own crop sources, uncropped -- these are the frames the crops were cut from,
//    so a reader can confirm the crop did not flatter the frame
for (const c of (assets.picks || [])) {
  const src = c.file || c.source || c.outName
  if (src) add(src, `论证裁切图的原始帧（未裁切版本）`)
}

console.log('candidate frames: ' + picks.length)

// ---------------------------------------------------------------- render
//
// ASPECT RATIO IS THE WHOLE POINT OF THIS SCRIPT, so it is both computed correctly and enforced.
//
// The first version of this file called resize({width:1600, height:1600, fit:'contain'}). That passed
// a SQUARE bounding box to sharp, which letterboxes the image to fill it -- every one of the 23 plates
// came out 1600x1600 with black bars, and the aspect-ratio check (which I had written to catch crops)
// fired on all 23 with arDelta up to 0.78. The check was right; my resize call was wrong.
//
// The correct expression of "longest edge 1600, keep the original shape, never add bars" is to scale
// the actual dimensions yourself and pass the exact target. A drift above 0.001 now FAILS the build
// rather than printing a number nobody reads.
const FULL_EDGE = 1600
const AR_TOLERANCE = 0.001
const made = []
const failed = []
let skipped = 0

for (const { file, why } of picks) {
  const src = join(ROOT, file)
  const outName = 'full_' + String(made.length).padStart(3, '0') + '.jpg'
  const dst = join(OUT, outName)
  try {
    const meta = await sharp(src).metadata()
    const scale = Math.min(1, FULL_EDGE / Math.max(meta.width, meta.height))   // shrink only, never enlarge
    const tw = Math.max(1, Math.round(meta.width * scale))
    const th = Math.max(1, Math.round(meta.height * scale))

    await sharp(src)
      .resize({ width: tw, height: th, fit: 'fill' })   // exact target, no bounding-box letterboxing
      .jpeg({ quality: 88, mozjpeg: true, chromaSubsampling: '4:4:4' })
      .toFile(dst)

    const om = await sharp(dst).metadata()
    const srcAR = meta.width / meta.height
    const outAR = om.width / om.height
    const arDelta = Math.abs(srcAR - outAR) / srcAR

    if (arDelta > AR_TOLERANCE) {
      failed.push({ file, srcAR: Number(srcAR.toFixed(4)), outAR: Number(outAR.toFixed(4)), arDelta: Number(arDelta.toFixed(4)) })
      continue
    }

    made.push({
      outName, file, why,
      srcW: meta.width, srcH: meta.height,
      outW: om.width, outH: om.height,
      kb: Math.round(statSync(dst).size / 1024),
      arDelta: Number(arDelta.toFixed(6)),
      scaled: Number(scale.toFixed(4)),
      median: (byFile.get(file) || {}).median || null,
      reliability: (byFile.get(file) || {}).reliability || null,
    })
  } catch (e) {
    skipped++
    if (skipped <= 5) console.log('  skip ' + file + ': ' + e.message)
  }
}

writeFileSync(join(P, 'full-plates.json'), JSON.stringify({
  made, FULL_EDGE, AR_TOLERANCE,
  source: 'uncropped, aspect-ratio preserving, no letterboxing',
}, null, 2), 'utf8')

const totalKB = made.reduce((a, b) => a + b.kb, 0)
const maxDelta = made.reduce((a, b) => Math.max(a, b.arDelta), 0)
console.log('')
console.log('=== full plates (uncropped, aspect-preserving) ===')
console.log('  written        : ' + made.length + (skipped ? '  (skipped ' + skipped + ')' : ''))
console.log('  payload        : ' + (totalKB / 1024).toFixed(2) + ' MB')
console.log('  longest edge   : ' + FULL_EDGE + 'px, q88, no crop, no letterboxing')
console.log('  max aspect drift from source: ' + maxDelta + '  (tolerance ' + AR_TOLERANCE + ')')
console.log('  plates where aspect ratio moved beyond tolerance: ' + failed.length)
for (const f of failed.slice(0, 10)) console.log('    ! ' + f.file + '  srcAR ' + f.srcAR + ' -> outAR ' + f.outAR)
const edge = made.filter(m => m.outW === FULL_EDGE || m.outH === FULL_EDGE).length
console.log('  plates at the 1600 budget: ' + edge + ', smaller originals untouched: ' + (made.length - edge))

if (failed.length) {
  console.log('')
  console.log('BUILD FAILED: ' + failed.length + ' plate(s) changed aspect ratio, so they are not ' +
    'uncropped representations of the source. Not writing a manifest that claims otherwise.')
  process.exit(1)
}
