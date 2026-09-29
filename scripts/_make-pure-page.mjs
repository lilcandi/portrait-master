// Render the pure-conclusions page from pure-items.json.
//
// What this page is: 1000 person frames, reliability descending, one short claim under each.
// No analysis sections, no methodology prose, no appendix tables. The user asked for conclusions
// only -- the deliverable is the ranked list, not the argument for it.
//
// The claim under each tile is DERIVED from that frame's own record (median / votes / spread /
// reliability), never a stock sentence. A claim that could be printed under any frame is not a
// claim. The four shapes below cover every case the data actually contains.
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const P = process.env.PORTRAIT_ROOT || 'C:\\portrait-data\\_probe'
const OUT = join(P, '_pure')
const SRC = join(OUT, 'pure-items.json')
const DST = join(P, '照片判读 · 结论速览 1000 张.html')

const data = JSON.parse(readFileSync(SRC, 'utf8'))
const items = data.items
if (!Array.isArray(items) || items.length !== 1000) {
  console.error('FATAL: expected 1000 items, got ' + (items ? items.length : 'none'))
  process.exit(1)
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null)

// Ordinal order, largest cup first. Declared here because claim() reads it and claim() runs
// while the tiles are being built, well before the histogram section.
const ORDER = ['AA', 'A', 'B', 'C', 'D', 'E_or_more']

// ---------- the claim line ----------
// One sentence, derived from THIS frame's own record. The variety has to come from the data,
// not from decorative phrasing: writing 40 stock sentences and rotating them would still be
// boilerplate. What the data actually distinguishes is:
//   - how many votes exist at all (1, 2 or 3) -- a 1-vote frame is much weaker than a 3-vote one
//   - whether they agree, and if not, by how many levels
//   - how sure the judge was (reliability), which spans 0.43-0.82 in this set
//   - whether a minority vote reached a HIGHER band than the median (an upward split), which
//     reads differently from a downward one
// Each branch below therefore states a different fact, and the numbers are the frame's own.
const up = (band, other) => ORDER.indexOf(other) < ORDER.indexOf(band) // smaller index = bigger cup

function claim(it) {
  const votes = Array.isArray(it.votes) ? it.votes : []
  const n = votes.length
  const rel = num(it.reliability)
  const spread = num(it.spread)
  const band = it.median
  const r = rel === null ? '—' : rel.toFixed(2)
  const voteStr = votes.join('/')

  // count split into by-band tallies, so the sentence can say what the dissent was
  const tally = {}
  for (const v of votes) tally[v] = (tally[v] || 0) + 1
  const others = Object.keys(tally).filter(v => v !== band)
  const higher = others.filter(v => up(band, v))
  const lower = others.filter(v => !up(band, v))

  if (!n) {
    // No votes recorded at all. Say so plainly; do not dress it up.
    if (rel !== null && rel >= 0.6) return '无逐票记录，仅给出档位 ' + band + '，可靠度 ' + r
    return '无逐票记录，档位 ' + band + '，可靠度仅 ' + r
  }

  if (n < 3) {
    // PARTIAL VOTING -- must never read like a unanimous triple, which is the strongest shape.
    const agreed = new Set(votes).size === 1
    if (agreed) {
      return '仅 ' + n + ' 票且均为 ' + band + '，票数不全，可靠度 ' + r + '，证据强度弱于三票一致的帧'
    }
    return '仅 ' + n + ' 票（' + voteStr + '），票数不全即存在分歧，可靠度 ' + r
  }

  // n === 3
  if (others.length === 0) {
    // unanimous triple -- the strongest shape in the data. Split by reliability band so that
    // the top and bottom of this group are not described in identical words.
    const tier = rel === null ? 'unknown' : rel >= 0.75 ? 'top' : rel >= 0.65 ? 'high' : rel >= 0.55 ? 'mid' : 'low'
    switch (tier) {
      case 'top':   return '三票全为 ' + band + '，可靠度 ' + r + '（0.75 以上），本页证据最硬的一类'
      case 'high':  return '三票全为 ' + band + '，可靠度 ' + r + '，三票一致且判读把握较高'
      case 'mid':   return '三票全为 ' + band + '，可靠度 ' + r + '，票齐一致、把握中等'
      case 'low':   return '三票全为 ' + band + '，可靠度仅 ' + r + '，票虽齐而判读依据偏弱'
      default:      return '三票全为 ' + band + '，可靠度未记录'
    }
  }

  // split vote among 3. 2-1 is the common case; 1-1-1 is the fully split one.
  if (others.length === 2) {
    if (spread !== null && spread >= 2) {
      return '三票分歧 ' + voteStr + '，中位取 ' + band + '，跨 ' + spread + ' 级，属明显两可，可靠度 ' + r
    }
    return '三票分歧 ' + voteStr + '，中位取 ' + band + '，三票各不同，可靠度 ' + r
  }

  const minority = others[0]
  // Name the dissent once. The vote string already shows it; restating "少数票判 X" after it
  // reads as if X were listed twice. Say what the dissent MEANS instead.
  const relation = higher.includes(minority)
    ? '少数票认为应该更大（' + minority + '）'
    : '少数票认为应该更小（' + minority + '）'
  if (spread !== null && spread >= 2) {
    return '三票 ' + voteStr + '，中位取 ' + band + '，' + relation + '，相差 ' + spread + ' 级，属两可'
  }
  return '三票 ' + voteStr + '，中位取 ' + band + '，' + relation + '，仅差一级，可靠度 ' + r
}

// ---------- thumbnails -> data URIs ----------
const TH = join(OUT, 'th')
const cache = new Map()
function uri(outName) {
  if (cache.has(outName)) return cache.get(outName)
  const p = join(TH, outName)
  if (!existsSync(p)) { cache.set(outName, null); return null }
  const u = 'data:image/jpeg;base64,' + readFileSync(p).toString('base64')
  cache.set(outName, u)
  return u
}

let missing = 0
const tiles = []
for (const it of items) {
  const u = uri(it.outName)
  if (!u) { missing++; continue }
  const w = num(it.w) || 0
  const h = num(it.h) || 0
  const rel = num(it.reliability)
  // A reliability bar makes the ranking visible at a glance without adding a wall of numbers.
  const pct = rel === null ? 0 : Math.max(0, Math.min(100, (rel - 0.2) / 0.65 * 100))
  tiles.push(
    '<figure class="tile">'
    + '<div class="rank">#' + it.rank + '</div>'
    + '<img src="' + u + '"' + (w && h ? ' width="' + w + '" height="' + h + '"' : '') + ' loading="lazy" decoding="async" alt="' + esc(it.file) + '">'
    + '<figcaption>'
    + '<div class="band b-' + esc(it.median) + '">' + esc(it.median) + '</div>'
    + '<div class="claim">' + esc(claim(it)) + '</div>'
    + '<div class="relbar"><i style="width:' + pct.toFixed(1) + '%"></i></div>'
    + '<div class="src">' + esc(it.file) + '</div>'
    + '</figcaption>'
    + '</figure>'
  )
}
if (missing) {
  console.error('FATAL: ' + missing + ' tiles have no rendered thumbnail')
  process.exit(1)
}
console.log('tiles rendered: ' + tiles.length)

// ---------- distribution lines (counts only, no analysis) ----------
const hist = {}
for (const it of items) hist[it.median] = (hist[it.median] || 0) + 1
const unan = items.filter(it => Array.isArray(it.votes) && new Set(it.votes).size === 1).length
const rels = items.map(it => num(it.reliability)).filter(x => x !== null)
const relMin = Math.min(...rels), relMax = Math.max(...rels)
const histLine = ORDER.filter(b => hist[b]).map(b => '<span class="chip b-' + b + '">' + b + ' ' + hist[b] + '</span>').join(' ')

const HTML = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>照片判读 · 结论速览 1000 张</title>
<style>
:root{
  --bg:#0a0e16;--panel:#111827;--line:#1e293b;--fg:#e6edf7;--dim:#8ea0bd;
  --aa:#f472b6;--a:#60a5fa;--b:#34d399;--c:#fbbf24;--d:#fb923c;--e:#ef4444;
}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--fg);margin:0;
  font:15px/1.6 "Segoe UI","Microsoft YaHei",system-ui,-apple-system,sans-serif}
header{padding:32px 28px 20px;border-bottom:1px solid var(--line)}
h1{font-size:24px;margin:0 0 10px;letter-spacing:.5px}
.lead{color:var(--dim);font-size:14px;max-width:900px;margin:0 0 14px}
.summary{display:flex;gap:10px;flex-wrap:wrap;align-items:center;font-size:13px;color:var(--dim)}
.chip{padding:3px 10px;border-radius:999px;border:1px solid var(--line);font-weight:600}
.b-AA{color:var(--aa)}.b-A{color:var(--a)}.b-B{color:var(--b)}
.b-C{color:var(--c)}.b-D{color:var(--d)}.b-E_or_more{color:var(--e)}
main{padding:24px 28px 60px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}
.tile{margin:0;background:var(--panel);border:1px solid var(--line);border-radius:12px;
  padding:8px;position:relative;display:flex;flex-direction:column}
.tile img{display:block;width:100%;height:auto;border-radius:8px;background:#000;cursor:zoom-in}
.rank{position:absolute;top:14px;left:14px;background:rgba(10,14,22,.82);border:1px solid var(--line);
  color:var(--dim);font-size:11px;font-weight:700;padding:2px 7px;border-radius:6px;z-index:2}
figcaption{padding:9px 3px 3px;display:flex;flex-direction:column;gap:5px}
.band{font-size:17px;font-weight:800;letter-spacing:1px;line-height:1}
.claim{font-size:12.5px;color:#cfe0f5;line-height:1.5}
.relbar{height:3px;background:#1b2537;border-radius:2px;overflow:hidden}
.relbar i{display:block;height:100%;background:linear-gradient(90deg,#2563eb,#22d3ee)}
.src{font-size:10.5px;color:#5c6c86;word-break:break-all;line-height:1.35}
footer{padding:0 28px 40px;color:#5c6c86;font-size:12px;max-width:900px}
a{color:#7dd3fc}
</style></head><body>
<header>
  <h1>照片判读 · 结论速览 1000 张</h1>
  <p class="lead">1000 张有人像的照片，按<b>判读可靠度从高到低</b>排列，最可靠的在最前。每张图下只有一句结论；
  排序键是可靠度，并列时三次投票越一致越靠前。</p>
  <div class="summary">
    <span>共 <b>1000</b> 张</span>
    <span>可靠度 <b>${relMin.toFixed(2)}–${relMax.toFixed(2)}</b></span>
    <span>三票全一致 <b>${unan}</b> 张</span>
    <span>档位分布：${histLine}</span>
  </div>
</header>
<main><div class="grid">${tiles.join('')}</div></main>
<footer>
  图长边 1024px、q:v 2 近乎无损编码，全部 base64 内嵌于本文件，双击即可打开，不依赖任何文件夹。点图可放大。<br>
  判读基于照片中的躯干剪影比例，三次独立投票取中位；可靠度是判读者自评的判读把握，不是对照片真实度的评分。<br>
  说明：本页只列结论与排序，不展开分析与口径讨论。<b>我没有目视查看过这些照片</b>，所有档位与语句均来自判读模型输出字段与脚本断言。
</footer>
<script>
document.querySelectorAll('.tile img').forEach(function(im){
  im.addEventListener('click',function(){
    var v=window.open('','_blank');
    if(!v)return;
    v.document.write('<body style="margin:0;background:#000;display:grid;place-items:center;min-height:100vh">'
      +'<img src="'+im.src+'" style="max-width:96vw;max-height:96vh">');
  });
});
</script>
</body></html>`

writeFileSync(DST, HTML, 'utf8')
const sz = statSync(DST).size
console.log('wrote ' + DST)
console.log('size: ' + (sz / 1048576).toFixed(2) + ' MB')
