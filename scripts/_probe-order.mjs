// Read-only: how many frames in the strict pool per garment tier, and what the page
// would look like under different key orders. No picks written.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const P = process.env.PORTRAIT_ROOT || 'C:\\portrait-data\\_probe'
const lines = (f) => readFileSync(join(P, f), 'utf8').split('\n').filter((s) => s.trim())
const cl = lines('classify.jsonl').map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)

const pool = cl.filter((r) => r.person_count === 1 && r.chest_region_visible === true &&
  r.breast_outline_readable === true && r.chest_region_obstruction === 'none')

const TIER = new Map([['lingerie', 5], ['bikini', 5], ['swimsuit', 5], ['tube_top', 5],
  ['camisole', 4], ['tank_top', 4], ['none', 4],
  ['sportswear', 3], ['other', 3], ['dress', 2], ['t_shirt', 2], ['shirt', 2], ['knitwear', 2],
  ['jacket', 0], ['unclear', 0]])

const tierHist = {}
for (const r of pool) { const t = TIER.get(r.outerwear) ?? 0; tierHist[t] = (tierHist[t] || 0) + 1 }
console.log('strict pool by tier  ' + JSON.stringify(Object.entries(tierHist).sort((a, b) => b[0] - a[0])))
console.log('pool size            ' + pool.length)

// tier 4+5 supply: is it enough to lead the page?
const t45 = pool.filter((r) => (TIER.get(r.outerwear) ?? 0) >= 4)
console.log('tier>=4 supply       ' + t45.length + '  ' + JSON.stringify(
  (() => { const m = {}; for (const r of t45) m[r.outerwear] = (m[r.outerwear] || 0) + 1; return Object.entries(m).sort((a, b) => b[1] - a[1]) })()))

// what if tight_fit is demoted below garment tier within the whole sort?
const faceScore = (r) => (r.photo_type === 'portrait' ? 2 : r.photo_type === 'half_body' ? 1 : 0) +
  (['chest_up', 'closeup'].includes(r.frame_coverage) ? 1 : ['waist_up', 'head_to_hip'].includes(r.frame_coverage) ? 1 : 0)
const angleScore = (r) => (r.angle === 'front' ? 2 : r.angle === 'three_quarter' ? 1 : 0)

const variants = {
  'A garment,tight,face,angle': (x, y) => ((TIER.get(y.outerwear) ?? 0) - (TIER.get(x.outerwear) ?? 0)) || ((y.tight_fit === true ? 1 : 0) - (x.tight_fit === true ? 1 : 0)) || (faceScore(y) - faceScore(x)) || (angleScore(y) - angleScore(x)) || String(x.file).localeCompare(String(y.file)),
  'B garment,face,angle,tight': (x, y) => ((TIER.get(y.outerwear) ?? 0) - (TIER.get(x.outerwear) ?? 0)) || (faceScore(y) - faceScore(x)) || (angleScore(y) - angleScore(x)) || ((y.tight_fit === true ? 1 : 0) - (x.tight_fit === true ? 1 : 0)) || String(x.file).localeCompare(String(y.file)),
  'C face,garment,angle,tight': (x, y) => (faceScore(y) - faceScore(x)) || ((TIER.get(y.outerwear) ?? 0) - (TIER.get(x.outerwear) ?? 0)) || (angleScore(y) - angleScore(x)) || String(x.file).localeCompare(String(y.file)),
}

for (const [name, cmp] of Object.entries(variants)) {
  const s = [...pool].sort(cmp).slice(0, 500)
  const g = {}; for (const r of s) g[r.outerwear] = (g[r.outerwear] || 0) + 1
  const f = {}; for (const r of s) { const k = String(faceScore(r)); f[k] = (f[k] || 0) + 1 }
  const t = {}; for (const r of s) { const k = String(TIER.get(r.outerwear) ?? 0); t[k] = (t[k] || 0) + 1 }
  console.log('\n-- ' + name)
  console.log('   tiers    ' + JSON.stringify(Object.entries(t).sort((a, b) => b[0] - a[0])))
  console.log('   garment  ' + JSON.stringify(Object.entries(g).sort((a, b) => b[1] - a[1]).slice(0, 6)))
  console.log('   face>=2  ' + s.filter((r) => faceScore(r) >= 2).length + '   face>=1 ' + s.filter((r) => faceScore(r) >= 1).length)
  console.log('   front    ' + s.filter((r) => r.angle === 'front').length)
}
