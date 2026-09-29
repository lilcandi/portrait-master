// Two remaining checks before this can be called done.
//   1. What is the one surviving literal "html_assets/" mention, and is it a dependency?
//   2. Does the file actually decode as a page -- 539 base64 images in one document is heavy enough
//      that "well-formed text" is not the same as "a browser can read it".
// Read-only.
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'

const P = process.env.PORTRAIT_ROOT || 'C:\\portrait-data\\_probe'
const OUT = join(P, 'plus 全量检测报告 · 单文件版.html')
const log = (k, v) => console.log(String(k).padEnd(36) + ' ' + v)

const html = readFileSync(OUT, 'utf8')
log('bytes', html.length)

// --- 1. the surviving mention ---
const idx = html.indexOf('html_assets/')
if (idx < 0) log('html_assets/ mention', 'none')
else {
  log('html_assets/ at offset', idx)
  log('  context', JSON.stringify(html.slice(Math.max(0, idx - 120), idx + 120)))
  // is it inside an attribute that would be fetched, or inside prose/code text?
  const before = html.slice(0, idx)
  const lastLt = before.lastIndexOf('<')
  const lastGt = before.lastIndexOf('>')
  log('  inside a tag?', lastLt > lastGt ? 'YES (could be a dependency)' : 'NO (prose or code text)')
}

// --- 2. structural soundness ---
log('<html> present', /<html[\s>]/i.test(html))
log('</html> present', /<\/html>/i.test(html))
log('doctype present', /^<!DOCTYPE html>/i.test(html))
log('h2 sections', (html.match(/<h2[\s>]/g) || []).length)
log('figure count', (html.match(/<figure/g) || []).length)
log('data: URIs', (html.match(/src="data:/g) || []).length)

// base64 payload integrity: every data: URI must be valid base64 with a JPEG/PNG signature.
// A truncated or corrupted payload would render as a broken image, which the page cannot show
// in text form -- so check the bytes themselves.
let checked = 0, badSig = 0, badB64 = 0, empty = 0
const uriRe = /src="data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)"/g
let m
while ((m = uriRe.exec(html)) !== null) {
  checked++
  const b = m[2]
  if (!b.length) { empty++; continue }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b)) badB64++
  const head = Buffer.from(b.slice(0, 16), 'base64')
  const jpegOk = head[0] === 0xFF && head[1] === 0xD8 && head[2] === 0xFF
  const pngOk = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4E && head[3] === 0x47
  if (!(jpegOk || pngOk)) badSig++
  // tail must carry the JPEG EOI marker, or the payload is cut short
  if (jpegOk) {
    const tail = Buffer.from(b.slice(-8), 'base64')
    const lastTwo = tail.slice(-2)
    if (!(lastTwo[0] === 0xFF && lastTwo[1] === 0xD9)) {
      // tolerate padding: decode the whole thing and look for the final marker
      const all = Buffer.from(b, 'base64')
      if (!(all[all.length - 2] === 0xFF && all[all.length - 1] === 0xD9)) badSig++
    }
  }
}
log('data: URIs matched', checked)
log('  empty payloads', empty)
log('  invalid base64', badB64)
log('  bad/truncated signature', badSig)
log('VERDICT', (checked > 500 && empty === 0 && badB64 === 0 && badSig === 0) ? 'all payloads decode as real images' : 'SOMETHING IS WRONG')
