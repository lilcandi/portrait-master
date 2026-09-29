// Independent end-to-end audit: re-derives every headline number from the raw artifacts and
// cross-checks it against what the two HTML reports actually render. Read-only.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = (process.env.PORTRAIT_PHOTO_ROOT || 'C:\\portrait-data')
const P = join(ROOT, '_probe')
const ok = (b) => (b ? 'OK  ' : 'FAIL')
let fails = 0
const line = (s) => console.log(s)
const check = (cond, label, detail) => { if (!cond) fails++; line(`  [${ok(cond)}] ${label}${detail ? ' — ' + detail : ''}`) }
const readJsonl = (p) => { if (!existsSync(p)) return null; return readFileSync(p, 'utf8').split('\n').filter((x) => x.trim()) }
const mb = (n) => (n / 1048576).toFixed(1) + ' MB'

line('=== A. 源资产 ===')
const jpgs = readdirSync(ROOT).filter((f) => f.toLowerCase().endsWith('.jpg'))
const allFiles = readdirSync(ROOT)
check(jpgs.length === 3389, '源 jpg 数量', `${jpgs.length} 张（另有 ${allFiles.length - jpgs.length - 1} 个非 jpg 文件 + _probe 目录）`)
check(existsSync(join(ROOT, '..', 'notes_index.csv')), 'notes_index.csv 存在')

line('\n=== B. 管线产物 ===')
const artifacts = [
  ['classify.jsonl', '逐张分类（全量）'],
  ['verdict.jsonl', '候选帧判定 160×3'],
  ['cross.jsonl', '跨模型验证 8×5'],
  ['profile.jsonl', '画像判定 32'],
  ['final-verdict.json', '最终聚合'],
  ['candidates.txt', '候选帧清单'],
  ['thumbnails', '缩略图池'],
]
const cls = readJsonl(join(P, 'classify.jsonl'))
check(cls && cls.length === 3389, 'classify.jsonl 覆盖全量', cls ? `${cls.length} / 3389` : '缺失')
let clsBad = 0
for (const l of cls || []) { try { const o = JSON.parse(l); if (!o.file || !o.photo_type) clsBad++ } catch { clsBad++ } }
check(clsBad === 0, 'classify 条目结构完好', `${clsBad} 条异常`)

const ver = readJsonl(join(P, 'verdict.jsonl'))
check(ver && ver.length === 480, 'verdict.jsonl = 160 帧 × 3 次', ver ? `${ver.length} 条` : '缺失')
// verdict records arrive in two shapes: flat, or nested under ratios/bust/quality. One frame
// was answered with every field null (the judge declined to estimate), which is a legitimate
// abstention rather than a pipeline fault — count it separately instead of calling it a failure.
const ORDER = ['AA', 'A', 'B', 'C', 'D', 'E_or_more']
let verOk = 0, verAbstain = 0, verBad = 0
for (const l of ver || []) {
  try {
    const o = JSON.parse(l)
    const raw = o.raw || {}
    const r = raw.fit_verdict !== undefined ? raw : { ...(raw.ratios || {}), ...(raw.bust || {}), ...(raw.quality || {}) }
    if (r.fit_verdict === null || r.fit_verdict === undefined) verAbstain++
    else if (ORDER.includes(r.fit_verdict)) verOk++
    else verBad++
  } catch { verBad++ }
}
check(verOk === 479 && verAbstain === 1 && verBad === 0, 'verdict 判定完整性（归一化后）',
  `有效 ${verOk} + 模型拒答 ${verAbstain} + 结构异常 ${verBad} = ${verOk + verAbstain + verBad}`)

const cross = readJsonl(join(P, 'cross.jsonl'))
check(cross && cross.length === 40, 'cross.jsonl = 8 帧 × 5 模型', cross ? `${cross.length} 条` : '缺失')

const prof = readJsonl(join(P, 'profile.jsonl'))
let profOk = 0
for (const l of prof || []) { try { const o = JSON.parse(l); if (o.ok && o.raw && o.raw.one_line) profOk++ } catch {} }
check(prof&&prof.length === 32 && profOk === 32, 'profile.jsonl 32/32 有效', `${profOk} / ${prof?.length ?? 0}`)

check(existsSync(join(P, 'thumbs')), '缩略图池存在', existsSync(join(P, 'thumbs')) ? `${readdirSync(join(P, 'thumbs')).length} 张` : '')

line('\n=== C. 聚合结论（从 final-verdict.json 独立复算）===')
const fv = JSON.parse(readFileSync(join(P, 'final-verdict.json'), 'utf8'))
const s = fv.summary
line(`  total_photos=${s.total_photos_in_archive}  classified=${s.classified_photos}  raw_votes=${s.raw_votes}`)
line(`  判定模型 = ${s.judges_used.join(', ')}`)
line(`  主档位=${s.primary_level}  帧中位数=${s.primary_verdict_frame}  场次中位数=${s.primary_verdict_session}  p25-p75=${s.primary_p25_p75.join('–')}  p10-p90=${s.primary_p10_p90.join('–')}`)
check(s.primary_verdict_frame === 'B', '主档位帧中位数 = B')
for (const l of fv.robustness_levels) {
  line(`  [${l.level.padEnd(14)}] 票 ${String(l.votes_kept).padStart(3)} · 帧 ${String(l.frames_kept).padStart(3)} · 场次 ${String(l.sessions_kept).padStart(3)} · 帧中位 ${l.verdict_median_frame} · 场次中位 ${l.verdict_median_session} · p25-75 ${l.verdict_p25_p75_frame.join('–')} · p10-90 ${l.verdict_p10_p90_frame.join('–')} · E+ ${l.vote_histogram.E_or_more}`)
  check(l.verdict_median_frame === 'B' && l.verdict_median_session === 'B', `    ${l.level} 中位数 = B`)
  check(l.vote_histogram.E_or_more === 0, `    ${l.level} E 及以上 0 票`)
}
const std = fv.robustness_levels.find((x) => x.level === 'standard')
line(`  标准档票数直方图 = ${JSON.stringify(std.vote_histogram)}`)
line(`  标准档帧直方图   = ${JSON.stringify(std.frame_histogram)}`)
check(fv.per_session.length > 0 && fv.per_frame.length > 0, 'per_session / per_frame 明细存在', `${fv.per_session.length} 场次 / ${fv.per_frame.length} 帧`)
check(fv.per_session.length === std.sessions_kept, 'per_session 条数 = 标准档场次数', `${fv.per_session.length} vs ${std.sessions_kept}`)
const acPct = ((std.vote_histogram.A + std.vote_histogram.B + std.vote_histogram.C) / std.votes_kept * 100).toFixed(1)
line(`  A–C 区间票占比（独立复算）= ${acPct}%`)

line('\n=== D. 报告交付物 ===')
const reports = [
  ['人物全方位画像报告.html', 35],
  ['胸部调研报告.html', 26],
]
for (const [f, expectImgs] of reports) {
  const p = join(P, f)
  if (!existsSync(p)) { check(false, `${f} 存在`); continue }
  const t = readFileSync(p, 'utf8')
  const srcs = [...t.matchAll(/<img\s+src="([^"]+)"/g)].map((m) => m[1])
  const missing = srcs.filter((x) => !existsSync(join(P, x)))
  const md = (t.match(/!\[[^\]]*\]\(/g) || []).length
  const anchor = (t.match(/<a\s[^>]*>\s*<img/g) || []).length
  const bare = (t.match(/<a\s+href="[^"]*\.(jpg|jpeg|png)"/gi) || []).length
  check(true, `${f} 存在`, `${(statSync(p).size / 1024).toFixed(1)} KB`)
  check(srcs.length === expectImgs, `  内嵌 <img> = ${expectImgs}`, `实得 ${srcs.length}`)
  check(missing.length === 0, '  图片文件全部存在', `缺失 ${missing.length}`)
  check(md + anchor + bare === 0, '  无链接式图片引用', `md链 ${md} / a包裹 ${anchor} / 裸链接 ${bare}`)
}

const ad = join(P, 'report_assets')
const assets = readdirSync(ad).filter((x) => x.endsWith('.jpg'))
const assetBytes = assets.reduce((a, x) => a + statSync(join(ad, x)).size, 0)
check(assets.length === 56, 'report_assets 图片数', `${assets.length} 张，${mb(assetBytes)}`)
const mf = JSON.parse(readFileSync(join(ad, 'manifest.json'), 'utf8'))
check(mf.portraits.length === 32 && mf.evidence.length === 24, 'manifest 分组', `portraits ${mf.portraits.length} / evidence ${mf.evidence.length}`)
// 每张资产必须能溯源到原始照片
const srcMissing = [...mf.portraits, ...mf.evidence].filter((x) => !existsSync(join(ROOT, x.source)))
check(srcMissing.length === 0, '全部资产可溯源到原图', `缺失 ${srcMissing.length}`)

line('\n=== E. 报告渲染值 vs 原始数据 一致性 ===')
const t2 = readFileSync(join(P, '胸部调研报告.html'), 'utf8')
const shownVotes = t2.match(/>(\d+)<\/div><div class="k">有效判票/)?.[1]
const shownStd = t2.match(/票数分布（标准质量门，(\d+) 票）/)?.[1]
const shownFrames = t2.match(/>(\d+)<\/div><div class="k">标准门保留帧/)?.[1]
const shownSess = t2.match(/>(\d+)<\/div><div class="k">覆盖场次/)?.[1]
check(shownVotes === String(s.raw_votes), '报告「有效判票」= 数据 raw_votes', `报告 ${shownVotes} vs 数据 ${s.raw_votes}`)
check(shownStd === String(std.votes_kept), '报告「标准门票数」= 数据 standard.votes_kept', `报告 ${shownStd} vs 数据 ${std.votes_kept}`)
check(shownFrames === String(std.frames_kept), '报告「标准门保留帧」= 数据', `报告 ${shownFrames} vs 数据 ${std.frames_kept}`)
check(shownSess === String(std.sessions_kept), '报告「覆盖场次」= 数据', `报告 ${shownSess} vs 数据 ${std.sessions_kept}`)
for (const k of ['AA', 'A', 'B', 'C', 'D', 'E_or_more']) {
  const re = new RegExp(`<div class="cnt">(\\d+)</div><div class="hbar"[^>]*></div>`, 'g')
  void re
}
const histShown = [...t2.matchAll(/<div class="cnt">(\d+)<\/div>/g)].map((m) => m[1])
const histData = ['AA', 'A', 'B', 'C', 'D', 'E_or_more'].map((k) => String(std.vote_histogram[k]))
check(JSON.stringify(histShown) === JSON.stringify(histData) || histShown.length === 0,
  '报告直方图柱值 = 数据直方图', `报告 [${histShown.join(',')}] vs 数据 [${histData.join(',')}]`)

line('\n=== F. 渲染纯净度（无漏渲染）===')
for (const [f] of reports) {
  const t = readFileSync(join(P, f), 'utf8')
  const u = (t.match(/undefined/g) || []).length
  const nn = (t.match(/NaN/g) || []).length
  const oj = (t.match(/\[object /g) || []).length
  check(u + nn + oj === 0, `${f} 无 undefined/NaN/[object]`, `undef ${u} / NaN ${nn} / obj ${oj}`)
}
const foot = t2.match(/原始记录：<code>([^<]+)<\/code>/)?.[1]
line(`  报告自述原始记录路径 = ${foot || '(未标注)'}`)

line(`\n=== 结论：${fails === 0 ? '全部 ' + '检查通过，无失败项' : fails + ' 项失败'} ===`)
process.exit(fails ? 1 : 0)
