// Build the exposure/face report page. Self-contained HTML, base64-inlined thumbs.
// Renders from expose-items.json. Hard-fails rather than shipping a partial page.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const P = process.env.PORTRAIT_ROOT || 'C:\\portrait-data\\_probe'
const src = JSON.parse(readFileSync(join(P, 'expose-items.json'), 'utf8'))
const items = src.items

if (!Array.isArray(items) || items.length !== 500) {
  console.log('FATAL: expose-items.json must hold exactly 500 items, got ' + (items?.length))
  process.exit(1)
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// ---- thumbnail lookup: <file> -> absolute path on disk
const inline = JSON.parse(readFileSync(join(P, '_inline_thumbs.json'), 'utf8'))
// _inline_thumbs.json maps keyframe plates; we need the plus_thumbs originals here.
const MIME = 'image/jpeg'
function thumbPath(it) {
  // plate is "html_assets/plus_thumbs/pNNNN.jpg"
  const rel = it.plate.replace(/^html_assets\//, '')
  return join(P, 'html_assets', rel)
}

const missing = []
const rows = []
for (const it of items) {
  const fp = thumbPath(it)
  if (!existsSync(fp)) { missing.push(it.file); continue }
  const b64 = readFileSync(fp).toString('base64')
  rows.push({ it, uri: 'data:' + MIME + ';base64,' + b64 })
}
if (missing.length) {
  console.log('FATAL: ' + missing.length + ' thumbs missing on disk; first 5:')
  for (const m of missing.slice(0, 5)) console.log('  ' + m)
  process.exit(1)
}
if (rows.length !== 500) {
  console.log('FATAL: inlined ' + rows.length + ' != 500')
  process.exit(1)
}

const GARMENT_CN = { lingerie: '内衣', bikini: '比基尼', swimsuit: '泳装', tube_top: '抹胸',
  camisole: '吊带背心', tank_top: '背心', none: '无外着', sportswear: '运动装', other: '其他',
  dress: '连衣裙', t_shirt: 'T 恤', shirt: '衬衫', knitwear: '针织', jacket: '外套', unclear: '不明' }
const COVER_CN = { head_to_toe: '全身', head_to_knee: '到大腿', head_to_hip: '到臀', waist_up: '腰部以上',
  chest_up: '胸部以上', closeup: '特写', unknown: '未标注', full_body: '全身' }
const PTYPE_CN = { portrait: '肖像', half_body: '半身', full_body: '全身', scenery: '风景', other: '其他' }
const ANGLE_CN = { front: '正面', three_quarter: '三分侧', side: '侧面', top_down: '俯拍', back: '背面', unknown: '未标注' }
const cn = (m, k) => m[k] ?? String(k ?? '—')

// ---- one sentence per frame: derived ONLY from that frame's own recorded fields.
function line(it) {
  const bits = []
  bits.push('衣着为' + cn(GARMENT_CN, it.outerwear))
  bits.push(it.tight_fit ? '紧身贴合' : '非紧身')
  if (it.band != null) {
    bits.push('判读档位 ' + it.band + (it.votes ? '（票 ' + [].concat(it.votes).join('/') + '）' : '') +
      (it.reliability != null ? '，可靠度 ' + Number(it.reliability).toFixed(2) : ''))
  } else {
    bits.push('该帧未经 plus 判读，无档位结论')
  }
  bits.push('取景' + cn(COVER_CN, it.frame_coverage) + '／' + cn(ANGLE_CN, it.angle))
  return bits.join('，')
}

const tiles = rows.map(({ it, uri }) => {
  const faceTag = it.face_score >= 2 ? '面部向' : (it.face_score >= 1 ? '面部中' : '面部弱')
  return '<figure class="tile">' +
    '<div class="head"><span class="rank">#' + it.rank + '</span>' +
    '<span class="tag ' + (it.face_score >= 2 ? 'hi' : it.face_score >= 1 ? 'mid' : 'lo') + '">' + faceTag + '</span>' +
    (it.band != null ? '<span class="band">' + esc(it.band) + '</span>' : '<span class="band none">—</span>') +
    '</div>' +
    '<img src="' + uri + '" alt="' + esc(it.file) + '" loading="lazy" onclick="zoom(this)">' +
    '<figcaption>' + esc(line(it)) + '</figcaption>' +
    '<div class="fn">' + esc(it.file) + '</div>' +
    '</figure>'
}).join('\n')

// ---- histograms over the picks
const hist = (f) => { const m = {}; for (const it of items) { const k = String(f(it)); m[k] = (m[k] || 0) + 1 } return Object.entries(m).sort((a, b) => b[1] - a[1]) }
const tbl = (rowsArr, label) => '<table><caption>' + label + '</caption><tbody>' +
  rowsArr.map(([k, v]) => '<tr><td>' + esc(k) + '</td><td class="n">' + v + '</td></tr>').join('') + '</tbody></table>'

const withVerdict = items.filter((it) => it.band != null).length
const faceG2 = items.filter((it) => it.face_score >= 2).length
const faceG1 = items.filter((it) => it.face_score >= 1).length
const t45 = items.filter((it) => it.garment_tier >= 4).length

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>胸部特征 + 面部特征 重点图 · 500 张</title>
<style>
  :root { --ink:#1a1a1c; --mid:#5b5b66; --line:#e3e3e8; --bg:#fbfbfc; --accent:#8a2b3c; }
  * { box-sizing:border-box; }
  body { margin:0; padding:0 0 4rem; background:var(--bg); color:var(--ink);
         font:15px/1.7 -apple-system,"Segoe UI","Noto Sans CJK SC","Microsoft YaHei",sans-serif; }
  .wrap { max-width:1180px; margin:0 auto; padding:0 1.2rem; }
  header { padding:3rem 0 1.6rem; border-bottom:3px solid var(--ink); margin-bottom:2rem; }
  h1 { margin:0 0 .6rem; font-size:1.9rem; letter-spacing:-.01em; }
  .sub { color:var(--mid); font-size:.95rem; }
  h2 { font-size:1.15rem; margin:2.6rem 0 .9rem; padding-bottom:.4rem; border-bottom:1px solid var(--line); }
  table { border-collapse:collapse; width:100%; max-width:460px; margin:.4rem 0 1rem; font-size:.88rem; }
  caption { text-align:left; color:var(--mid); padding:.2rem 0 .4rem; font-size:.85rem; }
  td { padding:.25rem .5rem; border-bottom:1px solid var(--line); }
  td.n { text-align:right; font-variant-numeric:tabular-nums; color:var(--mid); width:5rem; }
  .cols { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:0 2rem; }
  .note { background:#fff6f7; border-left:3px solid var(--accent); padding:.9rem 1.1rem; margin:1.2rem 0; font-size:.9rem; }
  .note b { color:var(--accent); }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(232px,1fr)); gap:1rem; margin-top:1rem; }
  figure.tile { margin:0; background:#fff; border:1px solid var(--line); border-radius:6px; overflow:hidden; display:flex; flex-direction:column; }
  .head { display:flex; align-items:center; gap:.4rem; padding:.45rem .6rem; border-bottom:1px solid var(--line); font-size:.78rem; }
  .rank { font-weight:700; font-variant-numeric:tabular-nums; }
  .tag { padding:.1rem .4rem; border-radius:3px; font-size:.72rem; background:#eee; color:#444; }
  .tag.hi { background:#8a2b3c; color:#fff; }
  .tag.mid { background:#d9b3ba; color:#3a1218; }
  .tag.lo { background:#e8e8ec; color:#777; }
  .band { margin-left:auto; font-weight:700; color:var(--accent); }
  .band.none { color:#bbb; font-weight:400; }
  figure.tile img { width:100%; height:auto; display:block; cursor:zoom-in; background:#f2f2f4; }
  figcaption { padding:.5rem .6rem; font-size:.78rem; color:var(--mid); flex:1; }
  .fn { padding:.3rem .6rem .5rem; font-size:.68rem; color:#a0a0aa; word-break:break-all; border-top:1px solid #f2f2f4; }
  footer { margin-top:3rem; padding-top:1.2rem; border-top:1px solid var(--line); color:var(--mid); font-size:.85rem; }
</style>
</head>
<body>
<div class="wrap">
<header>
  <h1>胸部特征 + 面部特征 重点图</h1>
  <div class="sub">500 张 · 严口径筛选 · 排序含面部维度加分 · 全部图片 base64 内嵌，本页不依赖任何文件夹</div>
</header>

<h2>筛选口径</h2>
<div class="note">
  <b>数据里没有「暴露度」字段，也没有「面部」字段。</b> 两个维度都是代理指标，下面是完整定义，请按代理的含义理解本页，不要理解成直接的暴露度或人脸检测结果。
</div>
<div class="cols">
  <div>
    <table><caption>胸部维度（硬条件，四条全满足）</caption><tbody>
      <tr><td><code>person_count = 1</code></td><td class="n">单人</td></tr>
      <tr><td><code>chest_region_visible = true</code></td><td class="n">区域可见</td></tr>
      <tr><td><code>breast_outline_readable = true</code></td><td class="n">轮廓可读</td></tr>
      <tr><td><code>chest_region_obstruction = none</code></td><td class="n">无遮挡</td></tr>
      <tr><td>满足以上四条的全池</td><td class="n">759</td></tr>
      <tr><td>本页取</td><td class="n">500</td></tr>
    </tbody></table>
  </div>
  <div>
    <table><caption>面部维度（排序加分项，<b>不做过滤</b>）</caption><tbody>
      <tr><td><code>photo_type = portrait</code></td><td class="n">+2</td></tr>
      <tr><td><code>photo_type = half_body</code></td><td class="n">+1</td></tr>
      <tr><td><code>frame_coverage</code> 为胸部以上/特写</td><td class="n">+1</td></tr>
      <tr><td><code>frame_coverage</code> 为腰部以上/到臀</td><td class="n">+1</td></tr>
      <tr><td>得分 ≥1 的帧</td><td class="n">${faceG1} / 500</td></tr>
      <tr><td>得分 ≥2 的帧</td><td class="n">${faceG2} / 500</td></tr>
    </tbody></table>
  </div>
</div>

<h2>这一批的构成</h2>
<div class="cols">
  ${tbl(hist((it) => cn(GARMENT_CN, it.outerwear)), '衣着类别')}
  ${tbl(hist((it) => cn(COVER_CN, it.frame_coverage)), '取景范围')}
  ${tbl(hist((it) => cn(PTYPE_CN, it.photo_type)), '照片类型')}
  ${tbl(hist((it) => cn(ANGLE_CN, it.angle)), '拍摄角度')}
  <div>
    <table><caption>判读结论覆盖</caption><tbody>
      <tr><td>有 plus 档位结论</td><td class="n">${withVerdict} / 500</td></tr>
      <tr><td>无判读结论（仅画像字段）</td><td class="n">${500 - withVerdict} / 500</td></tr>
      <tr><td>衣着属暴露类（tier ≥4）</td><td class="n">${t45} / 500</td></tr>
    </tbody></table>
  </div>
</div>

<h2>排序规则（可复核）</h2>
<p>依次比较，前者相同才看后者，最后以文件名为唯一决胜键，因此同样的输入必然得到同样的顺序：</p>
<table><tbody>
  <tr><td>① 衣着暴露档次</td><td class="n">降序</td></tr>
  <tr><td>② 面部维度得分</td><td class="n">降序</td></tr>
  <tr><td>③ 拍摄角度（正面 &gt; 三分侧 &gt; 其他）</td><td class="n">降序</td></tr>
  <tr><td>④ 是否紧身</td><td class="n">降序</td></tr>
  <tr><td>⑤ 文件名</td><td class="n">升序</td></tr>
</tbody></table>
<div class="note">
  衣着暴露档次的定义：内衣／比基尼／泳装／抹胸 = 5；吊带背心／背心／无外着 = 4；运动装／其他 = 3；
  连衣裙／T 恤／衬衫／针织 = 2；外套／不明 = 0。<br>
  <b>注意连衣裙（dress）刻意只给 2 分。</b> 它是个「不讲剪裁」的标签——高领长袖连衣裙和细吊带裙共用同一个值，
  所以它不能压过真正低开口的品类。本页 500 张里连衣裙有 261 张，那是语料里这个类别本身占比就高
  （全语料 1,025 帧），<b>不是把它当成了暴露</b>。
</div>

<h2>500 张重点图</h2>
<div class="grid">
${tiles}
</div>

<footer>
  <p><b>我没有目视查看过这些照片。</b> 本页所有筛选、排序、档位与文字，都来自判读模型输出的结构化字段与脚本断言；
  我本人没有图像输入能力，无法核实画面实际内容。</p>
  <p>「胸部维度」是遮挡与轮廓的可读性条件，<b>不等于暴露程度的直接测量</b>；「面部维度」是取景类型的代理，
  <b>不等于人脸检测或面部清晰度评估</b>。缺 <code>face</code> 相关字段是全量语料的共同限制，非本页选择所致。</p>
  <p>有档位结论的 ${withVerdict} 帧来自 plus 通道的强迫选择判读；其余 ${500 - withVerdict} 帧未经该判读，
  图注中如实写作「无档位结论」，未作任何填充。</p>
</footer>
</div>
<script>
function zoom(img){ var w = window.open('', '_blank'); if(!w) return;
  w.document.write('<!DOCTYPE html><title>'+img.alt+'</title><body style="margin:0;background:#111;display:flex;align-items:center;justify-content:center;min-height:100vh"><img src="'+img.src+'" style="max-width:100%;max-height:100vh"></body>');
  w.document.close(); }
</script>
</body>
</html>
`

const OUT = join(P, '胸部特征 + 面部特征 重点图 500 张.html')
writeFileSync(OUT, html, 'utf8')

// ---- self-containment gates
const leftover = []
const markup = html.replace(/<script[\s\S]*?<\/script>/g, '')
if (/<img[^>]+src\s*=\s*"(?!data:)/i.test(markup)) leftover.push('img src external')
if (/<link[^>]+href\s*=\s*"(?!data:)/i.test(markup)) leftover.push('link href')
if (/<script[^>]+src\s*=/i.test(html)) leftover.push('script src')
if (/url\(\s*['"]?(?!data:)/i.test(markup)) leftover.push('css url()')
if (leftover.length) console.log('WARN leftover external refs: ' + leftover.join(', '))

console.log('tiles rendered   ' + rows.length)
console.log('totalInline      ' + (html.match(/src="data:/g) || []).length)
console.log('wrote            ' + OUT)
console.log('size             ' + (readFileSync(OUT).length / 1048576).toFixed(2) + ' MB')
