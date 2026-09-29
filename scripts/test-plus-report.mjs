// test-plus-report.mjs -- plus 页面的活 DOM 验收。
//
// 与图集页测试的差别：图集页的核心断言是「点裁切图打开未裁切原图」；
// 本页的核心断言是「页面上的每个数字都能在 plus-verdict.json 里找到出处」——
// 因为这一页存在的全部意义就是给出一个可比对的量化差异，数字错了页面就是空话。
import { spawn } from 'node:child_process'
import { writeFileSync, existsSync, readFileSync } from 'node:fs'

const P = process.env.PORTRAIT_ROOT || 'C:\\portrait-data\\_probe'
const FILE = P + '\\plus 全量检测报告.html'
const PORT = 9361
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].find(p => existsSync(p))
if (!CHROME) { console.log('chrome not found'); process.exit(1) }
if (!existsSync(FILE)) { console.log('FATAL: page not generated yet: ' + FILE); process.exit(1) }

const sleep = ms => new Promise(r => setTimeout(r, ms))
const out = []
let fails = 0
const say = (ok, label, detail) => {
  if (!ok) fails++
  out.push((ok ? '  PASS  ' : '  FAIL  ') + label + (detail !== undefined ? '  [' + detail + ']' : ''))
}

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=' + PORT, '--window-size=1440,900',
  '--allow-file-access-from-files', '--user-data-dir=' + P + '\\.chrome-plus',
  'about:blank',
], { stdio: 'ignore' })

let ws, id = 0
const pending = new Map()
const exceptions = []
const consoleErrors = []

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const mid = ++id
    pending.set(mid, { resolve, reject })
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
}
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description))
  return r.result.value
}
function attach() {
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id)
      pending.delete(m.id)
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
    }
    if (m.method === 'Runtime.exceptionThrown') exceptions.push((m.params.exceptionDetails && m.params.exceptionDetails.text) || 'unknown')
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors.push(m.params.args.map(a => a.value || a.description || '').join(' '))
    }
  })
}

try {
  let info = null
  for (let i = 0; i < 60; i++) {
    try { info = await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json(); break } catch { await sleep(250) }
  }
  if (!info) throw new Error('chrome did not expose /json/version')

  ws = new WebSocket(info.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
  attach()

  const targets = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json()
  const page = targets.find(t => t.type === 'page')
  if (!page || !page.webSocketDebuggerUrl) throw new Error('no page target')
  if (page.webSocketDebuggerUrl !== info.webSocketDebuggerUrl) {
    try { ws.close() } catch {}
    ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
    attach()
  }

  await send('Runtime.enable')
  await send('Page.enable')
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') })
  await sleep(3000)

  out.push('=== plus 全量检测报告.html live-DOM acceptance ===')

  // ---- 1. wiring（与图集页同一套回归项：上一次查看器就是死在这里）----
  const total = await evaluate(`document.querySelectorAll('img').length`)
  // 内容图 = 全部 img 去掉查看器自己的 #fz-img。上一版这里写的是 total - 1，假设查看器的舞台图
  // 一定已经存在，于是打印出 "11 of 10" 这种自相矛盾的分母——断言本身没错，是报文在骗人。
  const contentImgs = await evaluate(`[].slice.call(document.querySelectorAll('img')).filter(function(i){ return i.id !== 'fz-img'; }).length`)
  const wired = await evaluate(`document.querySelectorAll('img.fz-img').length`)
  const declared = await evaluate(`document.documentElement.getAttribute('data-fz-wired')`)
  const unwired = await evaluate(`[].slice.call(document.querySelectorAll('img')).filter(function(i){ return !i.classList.contains('fz-img') && i.id !== 'fz-img'; }).map(function(i){ return i.getAttribute('src'); })`)
  say(total > 5, 'images present in the live DOM', total + ' imgs (' + contentImgs + ' content)')
  say(unwired.length === 0 && wired === contentImgs, 'every content image is wired for zoom', unwired.length ? unwired.slice(0,4).join(' | ') : wired + ' of ' + contentImgs)
  say(String(declared) === String(wired), 'data-fz-wired agrees with the wired count', declared + ' vs ' + wired)
  const stageBefore = await evaluate(`document.querySelectorAll('#fz-img').length`)
  say(stageBefore === 0, 'viewer stage image absent before first use (overlay built lazily)', stageBefore)

  // ---- 2. 图片角色：全部小图，且三种角色计数自洽 ----
  const roles = await evaluate(`(function(){
    var r = { tiles: document.querySelectorAll('.tiles figure img').length,
              details: document.querySelectorAll('figure.detail img').length,
              total: 0 };
    r.total = r.tiles + r.details;
    return r;
  })()`)
  say(roles.total > 0, 'figures rendered in role classes', JSON.stringify(roles))
  // Two plate families back this page: the 150 curated frames as uncropped originals, every other
  // judged frame as a 1024px-wide copy. If the second family ever vanishes the page still renders
  // and still passes every wiring check -- it just stops illustrating the full run, which is the
  // whole point of this report. So count both families from the live DOM.
  const fam = await evaluate(`(function(){
    var ims = [].slice.call(document.querySelectorAll('img')).filter(function(i){ return i.id !== 'fz-img'; });
    var r = { plus: 0, big: 0, other: [] };
    for (var i = 0; i < ims.length; i++) {
      var s = ims[i].getAttribute('src') || '';
      if (s.indexOf('html_assets/plus_thumbs/') === 0) r.plus++;
      else if (s.indexOf('html_assets/big_') === 0) r.big++;
      else r.other.push(s);
    }
    return r;
  })()`)
  say(fam.plus > 0, 'plus-channel plates are on the page (the full run is illustrated)', fam.plus + ' plus_thumbs, ' + fam.big + ' originals')
  say(fam.other.length === 0, 'every content image comes from html_assets', fam.other.slice(0,4).join(' | ') || '0 unexpected sources')
  say(roles.total === contentImgs, 'role-class count matches the content-image count', roles.total + ' in roles vs ' + contentImgs + ' content imgs')

  // ---- 3. 无特大图：任何一张内容图的渲染高度都不得超过 600px ----
  const big = await evaluate(`(function(){
    var ims = [].slice.call(document.querySelectorAll('img')).filter(function(i){ return i.id !== 'fz-img'; });
    var bad = [];
    for (var i = 0; i < ims.length; i++) {
      var h = ims[i].getBoundingClientRect().height;
      if (h > 600) bad.push((ims[i].getAttribute('src')||'').split('/').pop() + '=' + Math.round(h) + 'px');
    }
    return bad;
  })()`)
  say(big.length === 0, 'no figure exceeds 600px tall on the page (the small-image rule)', big.length ? big.slice(0,5).join(' | ') : '0 oversized')

  // ---- 4. 接线之外的实质：点击一张图，覆盖层必须显示同一张图且解码成功 ----
  const click1 = await evaluate(`(function(){
    var im = document.querySelector('.tiles figure img') || document.querySelector('figure.detail img');
    if (!im) return null;
    var fig = im.closest('figure');
    var figCaption = fig ? (fig.querySelector('figcaption')||{}).textContent : '';
    im.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, clientX:40, clientY:40, pointerId:1, isPrimary:true}));
    im.dispatchEvent(new PointerEvent('pointerup',   {bubbles:true, clientX:40, clientY:40, pointerId:1, isPrimary:true}));
    im.click();
    return new Promise(function(res){ setTimeout(function(){
      var root = document.getElementById('fz-root');
      var st = document.getElementById('fz-img');
      res({ src: im.getAttribute('src'), figCap: (figCaption||'').slice(0,40),
            root: !!root,
            visible: root ? (root.style.display !== 'none' && getComputedStyle(root).display !== 'none') : false,
            stageSrc: st ? st.getAttribute('src') : null,
            natural: st ? (st.naturalWidth + 'x' + st.naturalHeight) : null,
            decoded: st ? (st.complete && st.naturalWidth > 0) : false,
            cap: (document.getElementById('fz-cap')||{}).textContent,
            pct: (document.getElementById('fz-pct')||{}).textContent,
            count: (document.getElementById('fz-count')||{}).textContent,
            locked: document.documentElement.style.overflow });
    }, 1400); });
  })()`)
  say(!!click1, 'clicking a figure produces a measurable overlay state')
  if (click1) {
    say(click1.visible, 'the overlay opened on click', 'visible=' + click1.visible)
    say(click1.decoded, 'the enlarged image decoded', click1.natural)
    say(!!(click1.stageSrc && click1.stageSrc.indexOf(click1.src) >= 0), 'the overlay shows the same image that was clicked', (click1.src||'') + ' -> ' + click1.stageSrc)
    say(!!click1.cap, 'the overlay carries a caption', JSON.stringify((click1.cap||'').slice(0,60)))
    say(!!click1.pct, 'the overlay shows a zoom percentage', click1.pct)
    say(!!click1.count, 'the overlay shows an n / total counter', JSON.stringify(click1.count))
    say(click1.locked === 'hidden', 'page scroll locked while open', click1.locked)
  }

  // ---- 5. 键盘：切换 + 关闭 + 恢复滚动 ----
  const stepped = await evaluate(`(function(){
    var before = (document.getElementById('fz-img')||{}).getAttribute('src');
    document.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true}));
    return new Promise(function(res){ setTimeout(function(){
      var after = (document.getElementById('fz-img')||{}).getAttribute('src');
      document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
      setTimeout(function(){
        var root = document.getElementById('fz-root');
        res({ before: before, after: after,
              closed: root ? (root.style.display === 'none' || getComputedStyle(root).display === 'none') : true,
              restored: document.documentElement.style.overflow });
      }, 600);
    }, 700); });
  })()`)
  say(!!stepped && stepped.before !== stepped.after, 'ArrowRight moves to another image', stepped && (stepped.before + ' -> ' + stepped.after))
  say(!!stepped && stepped.closed, 'Escape closes the overlay')
  say(!!stepped && stepped.restored !== 'hidden', 'scroll restored after close', stepped && JSON.stringify(stepped.restored))

  // ---- 6. 本页存在的意义：页面上的数字必须与 plus-verdict.json 对得上 ----
  const plus = JSON.parse(readFileSync(P + '\\plus-verdict.json', 'utf8'))
  const curated = JSON.parse(readFileSync(P + '\\final-verdict.json', 'utf8'))
  const ps = plus.robustness_levels.find(l => l.level === 'standard') || plus.robustness_levels[0]
  const cs = curated.robustness_levels.find(l => l.level === 'standard') || curated.robustness_levels[0]
  const pageText = await evaluate(`document.body.innerText.replace(/\\s+/g,' ')`)
  // 页面用 toLocaleString() 渲染大数（2,700）。必须先去掉千位分隔符再比对，否则断言会把一个
  // 完全正确的页面判成失败——这个假失败上一轮真的发生过。
  const pageDigits = pageText.replace(/,/g, '')
  say(pageDigits.includes(String(plus.summary.frames_judged)), 'page shows the plus frame count', plus.summary.frames_judged)
  say(pageDigits.includes(String(plus.summary.raw_votes)), 'page shows the plus vote count', plus.summary.raw_votes)
  say(pageText.includes(ps.verdict_median_frame), 'page shows the plus standard median', ps.verdict_median_frame)
  say(pageText.includes(cs.verdict_median_frame), 'page shows the curated standard median alongside it', cs.verdict_median_frame)
  // 共有一致率：页面自己算的那个数必须等于用两个 JSON 独立算出的数
  const pF = new Map(plus.per_frame.map(f => [f.file, f.median]))
  const ORDERP = ['AA','A','B','C','D','E_or_more']
  const sharedFiles = plus.per_frame.map(f=>f.file).filter(f => curated.per_frame.some(c => c.file === f))
  const agree = sharedFiles.filter(f => {
    const a = pF.get(f), b = curated.per_frame.find(c=>c.file===f).median
    return a === b
  }).length
  say(pageText.includes(String(sharedFiles.length)), 'page shows the shared-frame count computed independently', sharedFiles.length)
  say(pageText.includes(agree + ' / ' + sharedFiles.length) || pageText.includes(agree + '/' + sharedFiles.length) || pageText.includes(String(Math.round(100*agree/sharedFiles.length))),
      'page agreement rate matches an independent recomputation from the two JSON files',
      agree + '/' + sharedFiles.length + ' = ' + (100*agree/sharedFiles.length).toFixed(1) + '%')

  // ---- 7. 资产与错误 ----
  const broken = await evaluate(`[].slice.call(document.querySelectorAll('img')).filter(function(i){ return i.complete && i.naturalWidth === 0; }).map(function(i){ return i.getAttribute('src'); })`)
  say(broken.length === 0, 'no image failed to load', broken.length ? broken.join(' | ') : '0 broken')
  say(exceptions.length === 0, 'no page exceptions during the run', exceptions.length ? exceptions.join(' | ') : 'none')
  say(consoleErrors.length === 0, 'no console errors', consoleErrors.length ? consoleErrors.join(' | ') : 'none')

} catch (e) {
  fails++
  out.push('  FAIL  harness error: ' + e.message)
} finally {
  try { ws && ws.close() } catch {}
  try { chrome.kill() } catch {}
}

out.push('')
out.push(fails === 0 ? 'RESULT: all checks passed (' + out.filter(l => l.includes('PASS')).length + ' assertions)' : 'RESULT: ' + fails + ' FAILED')
writeFileSync(P + '\\test-plus.txt', out.join('\n'), 'utf8')
console.log(fails === 0 ? 'all checks passed' : fails + ' failed')
