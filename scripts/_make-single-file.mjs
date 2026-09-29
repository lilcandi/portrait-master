// Build the self-contained single-file page.
//
// Two jobs, in this order:
//   1. Replace the page's figures with the 500 selected key frames (the old page showed 39).
//   2. Inline every image the page actually uses as a base64 data: URI, so the result opens by
//      double-click with no folder beside it.
//
// Design decisions that matter:
//   - Only images ACTUALLY REFERENCED get inlined. Nothing from html_assets/ is swept in "in case".
//     The old 39-image page keeps working: its images are inlined too, from the same source dirs.
//   - The final check is a HARD FAIL. If any external reference survives (img src=path, <link href>,
//     <script src>, url() to a file), the script exits non-zero and writes NO output file. Shipping
//     a file that looks standalone but still needs a folder is the exact failure this must prevent.
//   - Caption source is the judged data, never the plate: plates carry no median/reliability.
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'

const P = process.env.PORTRAIT_ROOT || 'C:\\portrait-data\\_probe'
const SRC_HTML = join(P, 'plus 全量检测报告.html')
const OUT_HTML = join(P, 'plus 全量检测报告 · 单文件版.html')
const log = (k, v) => console.log(String(k).padEnd(32) + ' ' + v)

const ORDER = ['AA', 'A', 'B', 'C', 'D', 'E_or_more']
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// ---------- load ----------
let html = readFileSync(SRC_HTML, 'utf8')
const kf = JSON.parse(readFileSync(join(P, 'keyframes.json'), 'utf8'))
const thumbs = JSON.parse(readFileSync(join(P, '_inline_thumbs.json'), 'utf8'))
const byIndex = new Map(thumbs.entries.map(e => [e.i, e]))

const plus = JSON.parse(readFileSync(join(P, 'plus-verdict.json'), 'utf8'))
const cur = JSON.parse(readFileSync(join(P, 'final-verdict.json'), 'utf8'))
const app = JSON.parse(readFileSync(join(P, 'supp-appendix.json'), 'utf8'))
const pF = new Map(plus.per_frame.map(f => [f.file, f]))
const cF = new Map(cur.per_frame.map(f => [f.file, f]))
const appBySid = new Map(app.per_frame.map(f => [f.sid, f]))

// thumbnail file -> data URI, computed once per file (500 distinct files, so caching is honest)
const uriCache = new Map()
function dataUri(outName) {
  if (uriCache.has(outName)) return uriCache.get(outName)
  const p = join(P, '_inline_thumbs', outName)
  if (!existsSync(p)) { uriCache.set(outName, null); return null }
  const b64 = readFileSync(p).toString('base64')
  const uri = 'data:image/jpeg;base64,' + b64
  uriCache.set(outName, uri)
  return uri
}

// ---------- caption text from the judged data ----------
function caption(e) {
  if (e.cls === 'appendix_readable') {
    // A DIFFERENT judge, on a non-random tail slice. The label must say so, or a reader will
    // merge these with the main-channel numbers.
    const a = appBySid.get(e.sid)
    return '附录 · 另一判定通道 · ' + esc(e.band) + (e.rel !== undefined ? ' · 可靠度 ' + e.rel : '')
      + (a ? '　遮蔽：' + esc(a.chest_occluded_by || '—') : '')
  }
  const f = pF.get(e.file)
  const votes = f && Array.isArray(f.votes) ? f.votes.join('/') : ''
  const un = votes && new Set(f.votes).size === 1
  return esc(e.band) + ' · 可靠度 ' + (e.rel !== undefined ? e.rel : '—')
    + (votes ? '　三票 ' + esc(votes) + (un ? '（全一致）' : '') : '')
}

const CLS_LABEL = {
  band_A: 'A 档', band_B: 'B 档', band_C: 'C 档',
  extreme_AA: 'AA 档（全取）', extreme_D: 'D 档（全取）', extreme_E_or_more: 'E_or_more 档（全取）',
  disagree: '两口径判差 ≥1 档', agree_unanimous: '两口径一致且三票全同',
  appendix_readable: '附录可读帧（另一判定通道）'
}

// Kind label: the page mixes 1024-wide copies and uncropped originals, and the caption has to say
// which one a reader is looking at. plate.kind is authoritative; `source` is not (it was a constant).
function kindLine(e) {
  if (e.kind === 'supp') return '附录帧 · 长边 1024 缩略'
  if (e.kind === 'orig') return '未裁切原图 · 长边 1024 缩略'
  return '1024 宽副本 · 长边 1024 缩略'
}

function figure(e) {
  const uri = dataUri(e.outName)
  if (!uri) return ''
  return '<figure class="tile">'
    + '<img src="' + uri + '" width="' + e.w + '" height="' + e.h + '" loading="lazy" decoding="async" alt="' + esc(e.file) + '">'
    + '<figcaption><b class="lv">' + caption(e) + '</b><br><span class="dim">' + kindLine(e) + '</span></figcaption>'
    + '</figure>'
}

// ---------- build the new figure section ----------
const frames = kf.frames.map((f, i) => ({ ...f, ...(byIndex.get(i) || {}) }))
const usable = frames.filter(f => byIndex.has(f.i))
log('key frames', usable.length)
if (usable.length !== kf.frames.length) {
  console.error('FATAL: ' + (kf.frames.length - usable.length) + ' key frames have no rendered thumbnail')
  process.exit(1)
}

const groups = Object.keys(CLS_LABEL).filter(c => usable.some(f => f.cls === c))
let gallery = ''
for (const cls of groups) {
  const items = usable.filter(f => f.cls === cls)
  gallery += '<h3>' + esc(CLS_LABEL[cls]) + '　<span class="dim small">' + items.length + ' 张</span></h3>'
  gallery += '<p class="dim small">' + esc(ruleNote(cls)) + '</p>'
  gallery += '<div class="tiles">' + items.map(figure).join('') + '</div>'
}

function ruleNote(cls) {
  switch (cls) {
    case 'band_A': return '按可靠度降序取足额，其余按固定步长跨取，使图区不是同一档位的重复样本。'
    case 'band_B': return '同 A 档取法。'
    case 'band_C': return '同 A 档取法；C 档全局仅 110 帧，可选取面较窄。'
    case 'extreme_AA': return 'AA 档全部 23 帧一次放入，未做挑选——其可靠度全部低于 0.5，图注已逐张标明。'
    case 'extreme_D': return 'D 档全局仅 2 帧，全部放入。'
    case 'extreme_E_or_more': return 'E_or_more 档全局仅 1 帧，可靠度低于 0.5。最高档的可信样本极少，本图区不构成对最高档的证据支持。'
    case 'disagree': return '全量口径与精选口径判定相差 ≥1 档的全部 40 帧（相差 ≥2 档的仅 1 帧，不足以成区）。'
    case 'agree_unanimous': return '两口径同档、且三次投票完全相同，两类条件同时成立的仅 4 帧。'
    case 'appendix_readable': return '附录 378 帧中判定者认为躯干剪影可读的全部 49 帧。提醒：这 49 帧来自另一判定通道（换措辞提示词）、且尾部 85% 为 9/11 月外套季，其数值不与正文口径合并。'
    default: return ''
  }
}

// ---------- splice the gallery into the page ----------
// Inserted as a new section before the appendix so the appendix stays the last thing a reader sees.
// Numbered 08 and the appendix renumbered to 09: a 07·5 half-number would not match the page's own
// convention, and the section count assertion downstream counts <h2>, not labels.
const anchor = '<h2>08　附录'
if (!html.includes(anchor)) {
  console.error('FATAL: cannot find the appendix heading to anchor the gallery before')
  process.exit(1)
}
const SECTION = '<h2>08　重点图 500 张</h2>'
  + '<p>下面是本轮判读里最能说明问题的 <b>' + usable.length + ' 帧</b>，按类别分组。'
  + '每一张都标出它的判定档位、可靠度与三次投票，以及它属于哪一类；'
  + '本页所有图片都按长边 1024px（原图尺寸）近乎无损编码，点开可放大。</p>'
  + '<p class="dim small">选图规则：<b>按证据强度分配，不按档位平均</b>。'
  + '中间三档（A/B/C）供给充足，按可靠度优先取足额；'
  + '稀疏档位（AA 23 帧、D 2 帧、E_or_more 1 帧）<b>全部放入、不补齐</b>，其低可靠度在图注里逐张标明；'
  + '两口径判差的 40 帧与两口径一致的 4 帧各成一类。'
  + '清单见 <code>keyframes.json</code>。</p>'
  + gallery
html = html.replace(anchor, SECTION + '<h2>09　附录')
if (!html.includes('<h2>09　附录')) {
  console.error('FATAL: appendix was not renumbered to 09')
  process.exit(1)
}

// The original prose told the reader the images come from the html_assets folder. That was true of
// the multi-file page and is FALSE here, where every image is embedded. Leaving it would be a false
// statement about this very file.
const IMG_NOTE_FROM = '<p><b>图片说明。</b>本页图片取自 <code>html_assets/</code>，'
const IMG_NOTE_TO = '<p><b>图片说明。</b>本页是<b>单文件自包含版</b>：文中 ' + usable.length + ' 张重点图与其余全部配图都已以 base64 直接内嵌在这个 .html 里，'
  + '不依赖任何外部文件夹，双击即可打开。图片按长边 1024px（即原图尺寸）近乎无损编码，保持原始宽高比、未裁切、未放大；'
  + '两套来源（1024 宽等比副本、未裁切原图）在图注中逐张标明：'
if (html.includes(IMG_NOTE_FROM)) {
  html = html.replace(IMG_NOTE_FROM, IMG_NOTE_TO)
  console.log('rewrote the image-source note for the single-file build')
} else {
  console.error('FATAL: could not find the image-source note to correct')
  process.exit(1)
}

// ---------- inline every image the page now references ----------
// Thumbnails are already in _inline_thumbs; the 39 original figures point at html_assets. Both
// families get inlined here, so the output has no external pixels regardless of which one it is.
// Two different counts, and they must be reported as two different things:
//   - replacements: images this regex pass rewrote from a path to a data: URI
//   - alreadyInline: gallery figures that already held a data: URI when spliced in
// Reporting only the first as "inlined" understated the total by 500 and read like a bug.
let replacements = 0, fromAsset = 0, alreadyInline = 0
const missing = []

alreadyInline = (html.match(/<img[^>]+src="data:/g) || []).length

html = html.replace(/<img([^>]*?)src="(?!data:)([^"]+)"([^>]*?)>/g, (whole, pre, src, post) => {
  const name = src.split('/').pop()
  // 1) a rendered thumbnail with this name?
  let uri = dataUri(name)
  if (uri) { replacements++; return '<img' + pre + 'src="' + uri + '"' + post + '>' }
  // 2) otherwise read the original asset and inline that
  const ap = join(P, src.replace(/\//g, '\\'))
  if (!existsSync(ap)) { missing.push(src); return whole }
  const b64 = readFileSync(ap).toString('base64')
  uri = (src.toLowerCase().endsWith('.png') ? 'data:image/png;base64,' : 'data:image/jpeg;base64,') + b64
  uriCache.set(name, uri)
  replacements++; fromAsset++
  return '<img' + pre + 'src="' + uri + '"' + post + '>'
})

const totalInline = (html.match(/<img[^>]+src="data:/g) || []).length
log('img src=data: total', totalInline + '  = ' + alreadyInline + ' gallery + ' + replacements + ' rewritten (' + fromAsset + ' from assets)')
if (totalInline !== alreadyInline + replacements) {
  console.error('FATAL: inline accounting does not balance')
  process.exit(1)
}
if (missing.length) {
  console.error('FATAL: ' + missing.length + ' referenced images could not be read: ' + missing.slice(0, 5).join(', '))
  process.exit(1)
}

// ---------- hard self-containment gate ----------
const leftovers = []
for (const m of html.matchAll(/<img[^>]+src="([^"]+)"/g)) if (!m[1].startsWith('data:')) leftovers.push('img ' + m[1].slice(0, 60))
for (const m of html.matchAll(/<link[^>]+href="([^"]+)"/g)) if (!/^https?:/.test(m[1])) leftovers.push('link ' + m[1])
for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) leftovers.push('script ' + m[1])
for (const m of html.matchAll(/url\((?!"?data:)([^)]+)\)/g)) leftovers.push('css url ' + m[1])
const assetMentions = (html.match(/html_assets\//g) || []).length

log('leftover external refs', leftovers.length)
if (leftovers.length) for (const l of leftovers.slice(0, 8)) console.log('  LEFT ' + l)
log('literal "html_assets/" mentions', assetMentions)
if (leftovers.length) {
  console.error('FATAL: not self-contained -- refusing to write the output file')
  process.exit(1)
}

const imgCount = (html.match(/<img[^>]+src="data:/g) || []).length
log('final img count', imgCount)

writeFileSync(OUT_HTML, html, 'utf8')
log('wrote', OUT_HTML)
log('size on disk', (statSync(OUT_HTML).size / 1048576).toFixed(2) + ' MB')
