// Read-only probe: what fields actually exist for (a) chest exposure / visibility
// and (b) face visibility. Does NOT judge anything. Prints raw structure only.
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const P = process.env.PORTRAIT_ROOT || 'C:\\portrait-data\\_probe'
const lines = (f) => readFileSync(join(P, f), 'utf8').split('\n').filter((s) => s.trim())
const show = (label, v) => console.log(label.padEnd(34), v)

// ---- 1. expose-set.txt : what is it?
const ex = join(P, 'expose-set.txt')
if (existsSync(ex)) {
  const raw = readFileSync(ex, 'utf8').split('\n').filter((s) => s.trim())
  show('expose-set.txt lines', raw.length)
  show('  head[0]', JSON.stringify(raw[0]).slice(0, 200))
  show('  head[1]', JSON.stringify(raw[1]).slice(0, 200))
  let j = 0
  for (const l of raw) { try { JSON.parse(l); j++ } catch {} }
  show('  parseable as JSON', j + ' / ' + raw.length)
  if (j > 0) {
    const o = JSON.parse(raw.find((l) => { try { JSON.parse(l); return true } catch { return false } }))
    show('  keys', JSON.stringify(Object.keys(o)))
    show('  sample', JSON.stringify(o).slice(0, 500))
  }
}

// ---- 2. classify.jsonl : per-frame image-derived fields
const cl = lines('classify.jsonl').map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
show('classify.jsonl rows', cl.length)
const ck = new Set()
for (const r of cl) for (const k of Object.keys(r)) ck.add(k)
show('classify.jsonl all keys', JSON.stringify([...ck].sort()))

// ---- 3. profile2.jsonl / profile.jsonl : shape / pose / visibility
for (const f of ['profile2.jsonl', 'profile.jsonl', 'deep-verdict-plus.jsonl', 'final-verdict.json']) {
  if (!existsSync(join(P, f))) continue
  try {
    const rs = lines(f).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
    show(f + ' rows', rs.length)
    if (rs[0]) {
      show('  keys', JSON.stringify(Object.keys(rs[0]).sort()))
      show('  sample', JSON.stringify(rs[0]).slice(0, 400))
    }
  } catch (e) { show(f, 'ERR ' + e.message) }
}

// ---- 4. any field name anywhere mentioning face / exposure / neckline / skin
const WANT = /face|chest|cleav|expos|neck|skin|bare|shoulder_visible|visible|framing|crop|portrait|bust_visible/i
const hits = new Map()
for (const f of ['classify.jsonl', 'profile2.jsonl', 'deep-verdict-plus.jsonl', 'verdict.jsonl', 'final-verdict.json', 'verdict-swim.jsonl']) {
  if (!existsSync(join(P, f))) continue
  for (const l of lines(f)) {
    let o; try { o = JSON.parse(l) } catch { continue }
    for (const k of Object.keys(o)) if (WANT.test(k)) hits.set(k, (hits.get(k) || 0) + 1)
  }
}
show('field names matching face/exposure', JSON.stringify([...hits.entries()].sort((a, b) => b[1] - a[1])))
