// 14 days of canonical vitals.biometrics/1: daily (RHR, HRV rmssd, steps, SpO2, skin temp, vendor scores), main sleep with stages, night HR series.
import fs from 'node:fs';
const prov = { channel: 'file:canonical', source_app: 'QA Ring', recording_method: 'automatic', modality: 'sensed', ingested_at: '2026-10-01T08:00:00.000Z', device: { type: 'ring', manufacturer: 'Acme', model: 'R1', tier: 'B' } };
const q = (v = 'measured') => ({ validation: v, confidence: null, flags: [] });
const recs = [];
const day0 = Date.UTC(2026, 8, 17); // 17 Sep .. 30 Sep
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
for (let i = 0; i < 14; i++) {
  const d = new Date(day0 + i * 864e5).toISOString().slice(0, 10);
  const prev = new Date(day0 + (i - 1) * 864e5).toISOString().slice(0, 10);
  const bedMs = Date.parse(`${prev}T22:45:00Z`) + Math.round(rnd() * 40) * 60e3;
  const asleep = Math.round((6.3 + rnd() * 1.6) * 3600);
  const stages = []; let t = bedMs + 10 * 60e3; const cyc = ['light', 'deep', 'light', 'rem'];
  let k = 0; while (t < bedMs + 10 * 60e3 + asleep * 1000) { const len = [25, 20, 20, 25][k % 4] * 60e3; stages.push({ start: new Date(t).toISOString(), end: new Date(t + len).toISOString(), stage: cyc[k % 4] }); t += len; k++; }
  const wake = t;
  recs.push({ kind: 'sleep', record_id: `qa-sleep-${d}`, version: 1, time: { start: new Date(bedMs).toISOString(), end: new Date(wake).toISOString(), tz_offset_s: 0, local_date: d }, provenance: prov, quality: q(), is_main: true, in_bed_s: Math.round((wake - bedMs) / 1000), asleep_s: asleep, latency_s: 600, stages, night: { hr_min_bpm: 50 + Math.round(rnd() * 4), hrv: { metric: 'rmssd', value_ms: 38 + Math.round(rnd() * 12) } } });
  const hr = []; for (let m = 0; m < (wake - bedMs) / 60e3; m += 5) hr.push(Math.round(52 + 6 * Math.sin(m / 60) + rnd() * 4));
  recs.push({ kind: 'series', record_id: `qa-hr-${d}`, version: 1, time: { start: new Date(bedMs).toISOString(), tz_offset_s: 0, local_date: d }, provenance: prov, quality: q(), metric: 'hr', unit: 'bpm', aggregation: 'sample', interval_s: 300, sampling: { mode: 'periodic', nominal_interval_s: 300 }, context: 'sleep', values: hr });
  recs.push({ kind: 'daily', record_id: `qa-daily-${d}`, version: 1, time: { tz_offset_s: 0, local_date: d }, provenance: prov, quality: q(), steps: 6000 + Math.round(rnd() * 5000), resting_hr_bpm: 53 + Math.round(rnd() * 4), hrv: { metric: 'rmssd', value_ms: 38 + Math.round(rnd() * 12), window: 'night' }, spo2_avg_pct: 96 + Math.round(rnd() * 2), skin_temp_delta_c: Math.round((rnd() - 0.5) * 40) / 100, resp_rate_brpm: 14 + Math.round(rnd() * 2), vendor: { readiness: 60 + Math.round(rnd() * 30), sleep: 65 + Math.round(rnd() * 25), stress: { value: 30 + Math.round(rnd() * 30), scale: '0-100' } } });
}
const batch = { schema: 'vitals.biometrics/1', producer: { name: 'qa-liv', version: '1' }, exported_at: '2026-10-01T08:00:00.000Z', tz: 'UTC', records: recs };
fs.writeFileSync('qa/fixtures/q1b-b/bio14.json', JSON.stringify(batch));
console.log(recs.length, 'records');
