import { readFileSync } from 'fs';
const P = process.env.PORTRAIT_ROOT || 'C:\\portrait-data\\_probe';
const rows = readFileSync(P + '\\_supp-results.jsonl', 'utf8')
  .split('\n').map(s => s.trim()).filter(Boolean).map(s => JSON.parse(s));

const sids = rows.map(r => r.sid);
const nums = sids.map(s => parseInt(s.slice(1), 10)).sort((a, b) => a - b);
const dupes = nums.filter((v, i) => i > 0 && v === nums[i - 1]);
const missing = [];
for (let i = 1; i <= 378; i++) if (!nums.includes(i)) missing.push(i);
console.log('rows=' + rows.length + ' unique=' + new Set(nums).size);
console.log('range=' + nums[0] + '..' + nums[nums.length - 1] + ' gaps=' + missing.length + (missing.length ? ' :: ' + missing.join(',') : '') + ' dupes=' + dupes.length + (dupes.length ? ' :: ' + dupes.join(',') : ''));

const vc = {};
for (const r of rows) vc[r.fit_verdict] = (vc[r.fit_verdict] || 0) + 1;
console.log('fit_verdict=' + JSON.stringify(vc));

const readable = rows.filter(r => r.fit_verdict !== 'unclear');
console.log('readable=' + readable.length + ' unclear=' + (rows.length - readable.length) + ' readable_pct=' + (100 * readable.length / rows.length).toFixed(1));
const rvc = {};
for (const r of readable) rvc[r.fit_verdict] = (rvc[r.fit_verdict] || 0) + 1;
console.log('readable_bands=' + JSON.stringify(rvc));

const rel = rows.map(r => r.reliability);
console.log('reliability min=' + Math.min(...rel) + ' max=' + Math.max(...rel) + ' mean=' + (rel.reduce((a, b) => a + b, 0) / rel.length).toFixed(3));
const rrel = readable.map(r => r.reliability);
if (rrel.length) console.log('readable_rel min=' + Math.min(...rrel) + ' max=' + Math.max(...rrel) + ' mean=' + (rrel.reduce((a, b) => a + b, 0) / rrel.length).toFixed(3));

const gc = {};
for (const r of rows) gc[r.garment] = (gc[r.garment] || 0) + 1;
console.log('garment=' + JSON.stringify(gc));

const oc = {};
for (const r of rows) oc[r.chest_occluded_by] = (oc[r.chest_occluded_by] || 0) + 1;
console.log('occluded_by=' + JSON.stringify(oc));

// ordering violations among readable rows
const bad = readable.filter(r => r.shoulder_over_head < r.bust_over_head || r.bust_over_head < r.underbust_over_head);
console.log('readable_ordering_violations=' + bad.length + (bad.length ? ' :: ' + bad.map(r => r.sid).join(',') : ''));

// per-band sid lists of readable rows, in chunks of 100 for legibility
const byNum = new Map(rows.map(r => [r.sid, r]));
const buckets = [[1, 96], [97, 192], [193, 300], [301, 378]];
for (const [a, b] of buckets) {
  const seg = [];
  for (let i = a; i <= b; i++) {
    const sid = 's' + String(i).padStart(4, '0');
    const r = byNum.get(sid);
    if (r) seg.push(r.fit_verdict === 'unclear' ? '.' : r.fit_verdict);
  }
  const rd = seg.filter(c => c !== '.').length;
  console.log('range ' + a + '-' + b + ' readable=' + rd + '/' + seg.length + ' :: ' + seg.join(''));
}
