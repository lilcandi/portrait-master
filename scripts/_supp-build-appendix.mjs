import { readFileSync, writeFileSync } from 'fs';
const P = process.env.PORTRAIT_ROOT || 'C:\\portrait-data\\_probe';
const rows = readFileSync(P + '\\_supp-results.jsonl', 'utf8')
  .split('\n').map(s => s.trim()).filter(Boolean).map(s => JSON.parse(s));
const units = JSON.parse(readFileSync(P + '\\_supp-units.json', 'utf8'));
const uList = Array.isArray(units) ? units : (units.units || []);
const bySid = new Map(uList.map(u => [u.sid, u]));

const readable = rows.filter(r => r.fit_verdict !== 'unclear');
const relValues = readable.map(r => r.reliability);
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;

const bands = {};
for (const r of rows) bands[r.fit_verdict] = (bands[r.fit_verdict] || 0) + 1;
const rbands = {};
for (const r of readable) rbands[r.fit_verdict] = (rbands[r.fit_verdict] || 0) + 1;

const perFrame = rows.map(r => {
  const u = bySid.get(r.sid) || {};
  return {
    sid: r.sid,
    file: u.file || null,
    reps: u.reps || [],
    verdict: r.fit_verdict,
    band: r.fit_verdict === 'unclear' ? null : r.fit_verdict,
    reliability: r.reliability,
    garment: r.garment,
    pose: r.pose,
    torso_turned_degree: r.torso_turned_degree,
    chest_occluded_by: r.chest_occluded_by,
    shoulder_over_head: r.shoulder_over_head,
    bust_over_head: r.bust_over_head,
    underbust_over_head: r.underbust_over_head,
    waist_over_head: r.waist_over_head,
    hip_over_head: r.hip_over_head,
    bust_projection: r.bust_projection,
    bust_larger_than_waist: r.bust_larger_than_waist,
    underbust_creases_visible: r.underbust_creases_visible,
    bust_still_projects_when_side: r.bust_still_projects_when_side,
    note: r.note
  };
}).sort((a, b) => parseInt(a.sid.slice(1), 10) - parseInt(b.sid.slice(1), 10));

const garmentHist = {};
for (const r of rows) garmentHist[r.garment] = (garmentHist[r.garment] || 0) + 1;
const occHist = {};
for (const r of rows) occHist[r.chest_occluded_by] = (occHist[r.chest_occluded_by] || 0) + 1;

const missingFiles = perFrame.filter(f => !f.file).length;

const out = {
  generated_from: '_supp-results.jsonl',
  frames: perFrame.length,
  note: 'Supplementary appendix. Judged under a reworded prompt after an explicit refusal on frames s0097-s0108. Contributes to NO headline number.',
  counts: {
    frames: rows.length,
    readable: readable.length,
    unclear: rows.length - readable.length,
    readable_pct: +(100 * readable.length / rows.length).toFixed(1),
    missing_file_links: missingFiles
  },
  band_histogram_all: bands,
  band_histogram_readable: rbands,
  reliability: {
    all_min: Math.min(...rows.map(r => r.reliability)),
    all_max: Math.max(...rows.map(r => r.reliability)),
    all_mean: +mean(rows.map(r => r.reliability)).toFixed(3),
    readable_min: relValues.length ? Math.min(...relValues) : null,
    readable_max: relValues.length ? Math.max(...relValues) : null,
    readable_mean: relValues.length ? +mean(relValues).toFixed(3) : null
  },
  garment_histogram: garmentHist,
  occlusion_histogram: occHist,
  per_frame: perFrame
};

writeFileSync(P + '\\supp-appendix.json', JSON.stringify(out, null, 1), 'utf8');
console.log('frames=' + out.counts.frames + ' readable=' + out.counts.readable + ' unclear=' + out.counts.unclear + ' pct=' + out.counts.readable_pct);
console.log('missing_file_links=' + missingFiles);
console.log('bands_all=' + JSON.stringify(bands) + ' bands_readable=' + JSON.stringify(rbands));
console.log('wrote supp-appendix.json');
