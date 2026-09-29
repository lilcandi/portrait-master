// Read-only verification of the exposure report page.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const P = process.env.PORTRAIT_ROOT || 'C:\\portrait-data\\_probe'
const OUT = join(P, '胸部特征 + 面部特征 重点图 500 张.html')
const html = readFileSync(OUT, 'utf8')

const out = []
const say = (k, v) => out.push(String(k).padEnd(32) + ' ' + v)

say('bytes', Buffer.byteLength(html))
say('doctype', /^<!DOCTYPE html>/i.test(html.trim()))
say('</html> present', /<\/html>\s*$/.test(html.trim()))

const tiles = html.match(/<figure class="tile">/g) || []
say('tiles (figure.tile)', tiles.length)
const ranks = html.match(/<span class="rank">#(\d+)<\/span>/g) || []
say('rank labels', ranks.length)
const rankNums = ranks.map((s) => Number(s.match(/#(\d+)/)[1]))
say('rank count/unique', rankNums.length + ' / ' + new Set(rankNums).size)
const complete = (() => { for (let i = 1; i <= 500; i++) if (!rankNums.includes(i)) return false; return true })()
say('ranks 1..500 complete', complete)
const caps = html.match(/<figcaption>/g) || []
say('caption lines', caps.length)

// payload decode
const uris = html.match(/src="data:image\/jpeg;base64,([^"]*)"/g) || []
say('data: URIs', uris.length)
let empty = 0, bad = 0, badsig = 0, minB = Infinity, maxB = 0, sumB = 0
for (const u of uris) {
  const b64 = u.replace(/^src="data:image\/jpeg;base64,/, '').replace(/"$/, '')
  if (!b64) { empty++; continue }
  let buf
  try { buf = Buffer.from(b64, 'base64') } catch { bad++; continue }
  if (!buf.length) { bad++; continue }
  const jpg = buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF && buf[buf.length - 2] === 0xFF && buf[buf.length - 1] === 0xD9
  if (!jpg) badsig++
  minB = Math.min(minB, buf.length); maxB = Math.max(maxB, buf.length); sumB += buf.length
}
say('empty payloads', empty)
say('invalid base64', bad)
say('bad/truncated sig', badsig)
say('img bytes min/med/max', uris.length ? [Math.round(minB / 1024), Math.round(sumB / uris.length / 1024), Math.round(maxB / 1024)].join(' / ') + ' KB' : 'n/a')

// external refs: strip <script> first so JS string literals are not counted
const markup = html.replace(/<script[\s\S]*?<\/script>/g, '')
say('external refs (markup)', (markup.match(/<img[^>]+src\s*=\s*"(?!data:)/gi) || []).length +
  (markup.match(/<link[^>]+href/gi) || []).length + (markup.match(/url\((?!"?data:)/gi) || []).length)
say('click handler inline src', /img\.src/.test(html))
say('no image-input disclosure', /我没有目视查看过这些照片/.test(html))

// prose honesty checks
say('states no headline exposure field', /数据里没有「暴露度」字段/.test(html))
say('states dress caveat', /连衣裙（dress）刻意只给 2 分/.test(html))
say('states face is proxy not detection', /不等于人脸检测/.test(html))
say('states unjudged frames unfilled', /未作任何填充/.test(html))

say('VERDICT', (empty === 0 && bad === 0 && badsig === 0 && uris.length === 500) ? 'all payloads decode as real images' : 'PROBLEM')
console.log(out.join('\n'))
