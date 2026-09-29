// Verify the pure-conclusions page. Read-only with respect to the page; decodes every embedded
// payload so a truncated or empty base64 blob cannot pass as an image.
import { readFileSync, existsSync, statSync } from 'node:fs'
const P = process.env.PORTRAIT_ROOT || 'C:\\portrait-data\\_probe'
const F = P + '\\照片判读 · 结论速览 1000 张.html'
const log = (k, v) => console.log(String(k).padEnd(30) + ' ' + v)

if (!existsSync(F)) { console.log('FATAL: file missing'); process.exit(1) }
const html = readFileSync(F, 'utf8')
log('bytes', statSync(F).size)
log('doctype', /^<!DOCTYPE html>/i.test(html))
log('<html> present', html.includes('<html'))
log('</html> present', html.includes('</html>'))

// structure
log('tiles (figure.tile)', (html.match(/<figure class="tile">/g) || []).length)
log('rank labels', (html.match(/<div class="rank">#\d+<\/div>/g) || []).length)
log('claim lines', (html.match(/<div class="claim">/g) || []).length)

// every rank 1..1000 present exactly once
const ranks = []
for (const m of html.matchAll(/<div class="rank">#(\d+)<\/div>/g)) ranks.push(Number(m[1]))
const uniq = new Set(ranks)
log('rank count/unique', ranks.length + ' / ' + uniq.size)
let rankOk = true
for (let i = 1; i <= 1000; i++) if (!uniq.has(i)) { rankOk = false; console.log('  MISSING rank #' + i) }
log('ranks 1..1000 complete', rankOk)

// payloads
const uris = html.match(/src="data:image\/[a-z]+;base64,([^"]*)"/g) || []
log('data: URIs', uris.length)
let empty = 0, bad = 0, badSig = 0
for (const m of uris) {
  const b64 = /base64,([^"]*)/.exec(m)[1]
  if (!b64) { empty++; continue }
  let buf
  try { buf = Buffer.from(b64, 'base64') } catch { bad++; continue }
  if (!buf.length) { empty++; continue }
  const isJpg = buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47
  if (!isJpg && !isPng) { badSig++; continue }
  if (isJpg && !(buf[buf.length - 2] === 0xFF && buf[buf.length - 1] === 0xD9)) badSig++
}
log('empty payloads', empty)
log('invalid base64', bad)
log('bad/truncated signature', badSig)

// external refs -- but EXCLUDE the click-handler string literal, which is JS source that resolves
// to the already-inline data: URI at runtime. Scanning it as markup produced a false positive.
const ext = []
const htmlNoScript = html.replace(/<script[\s\S]*?<\/script>/g, '')
for (const m of htmlNoScript.matchAll(/<img[^>]+src="([^"]+)"/g)) if (!m[1].startsWith('data:')) ext.push('img ' + m[1].slice(0, 50))
for (const m of htmlNoScript.matchAll(/<link[^>]+href="([^"]+)"/g)) if (!/^https?:/.test(m[1])) ext.push('link ' + m[1])
for (const m of htmlNoScript.matchAll(/<script[^>]+src="([^"]+)"/g)) ext.push('script ' + m[1])
for (const m of htmlNoScript.matchAll(/url\((?!"?data:)([^)]+)\)/g)) ext.push('css url ' + m[1])
log('external refs (markup)', ext.length)
if (ext.length) console.log('  ' + ext.slice(0, 8).join(', '))
// assert the click handler really does use the inlined source
const handlerUsesInline = /<img src="'\+im\.src\+'"/.test(html)
log('click handler uses inline src', handlerUsesInline)

// claims must not be identical boilerplate
const claims = []
for (const m of html.matchAll(/<div class="claim">([^<]*)<\/div>/g)) claims.push(m[1])
const distinct = new Set(claims)
log('distinct claims', distinct.size + ' / ' + claims.length)

const verdict = (empty === 0 && bad === 0 && badSig === 0 && ext.length === 0 && rankOk && distinct.size > 1)
  ? 'all payloads decode as real images' : 'PROBLEMS FOUND'
log('VERDICT', verdict)
