// L-REV2 diagnostic: what the ingest validator does to the series records `biometrics.ringFold` builds from the old
// Lumen source's chunks (src/commands/bio/fold.ts moveSource). Read-only: builds the records in memory and runs
// `validateBatch` on them; nothing is written. Prints counts, record ids and validator messages (digits masked) only.
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { guardNetwork, makeRedactor } from './lib.mjs';

process.removeAllListeners('warning');
const dir = process.env.L_REV2_COPY;
if (!dir) throw new Error('L_REV2_COPY is required');
guardNetwork(null);
const { installPolyfills } = await import('@evolu/common/polyfills');
installPolyfills();
const { openPersonProgram } = await import('../../../packages/companion/src/home/personProgram.ts');
const person = JSON.parse(readFileSync(join(dir, 'person.json'), 'utf8'));
const secret = new Uint8Array(readFileSync(join(dir, 'owner.key')));
const program = await openPersonProgram({ personId: basename(dir), dir, timeZone: person.timeZone, deviceId: person.deviceId, relayUrl: null, instance: 'L-REV2-diag' }, secret);
try {
  const { bioIndex, openBioStore, readOnlyWriter } = await import('../../../src/commands/bio/store.ts');
  const policy = await import('../../../src/biometrics/core/policy.ts');
  const source = await import('../../../src/biometrics/core/source.ts');
  const { parseRingKey } = await import('../../../src/biometrics/service/identity.ts');
  const { recordId } = await import('../../../src/biometrics/core/hash.ts');
  const { validateBatch, SERIES_RANGE } = await import('../../../src/biometrics/core/validate.ts');
  const { tzOffsetSeconds } = await import('../../../src/biometrics/importers/util.ts');
  const { BIO_SCHEMA } = await import('../../../src/biometrics/core/types.ts');
  const names = makeRedactor({ LUMEN_SOURCE_KEY: source.LUMEN_SOURCE_KEY, channelOfSourceKey: policy.channelOfSourceKey, parseRingKey });
  const ix = await bioIndex();
  const store = await openBioStore({ writer: readOnlyWriter });
  const from = ix.sources().find((s) => names(s.sourceKey) === 'lumen-old')?.sourceKey;
  if (!from) throw new Error('no lumen-old source in this copy');
  const to = source.LUMEN_SOURCE_KEY;
  const now = new Date().toISOString();
  const days = new Map();
  for (const c of ix.chunks.values()) if (c.sourceKey === from) days.set(`${c.stream}\u0000${c.local_date}`, { stream: c.stream, date: c.local_date });
  const records = [];
  const perStream = {};
  for (const { stream, date } of days.values()) {
    const samples = await store.samples({ sourceKey: from, stream, from: date, to: date });
    if (samples.length === 0) continue;
    const t0 = samples[0].t;
    const start = new Date(t0).toISOString();
    const hasQ = samples.some((s) => s.quality);
    const range = SERIES_RANGE[stream];
    const st = (perStream[stream] ??= { days: 0, samples: 0, belowMin: 0, aboveMax: 0, zero: 0, nonFinite: 0 });
    st.days++;
    st.samples += samples.length;
    for (const s of samples) {
      if (!Number.isFinite(s.value)) st.nonFinite++;
      else if (s.value === 0) st.zero++;
      if (range && Number.isFinite(s.value) && s.value < range[0]) st.belowMin++;
      if (range && Number.isFinite(s.value) && s.value > range[1]) st.aboveMax++;
    }
    // exactly what fold.ts moveSource builds (unit 'unit' included)
    records.push({
      kind: 'series', record_id: recordId({ source: to, kind: 'series', metric: stream, start }), version: 1,
      time: { start, tz_offset_s: tzOffsetSeconds(t0, person.timeZone), local_date: date },
      provenance: { channel: 'file:lumen_cloudevents', recording_method: 'automatic', modality: 'sensed', ingested_at: now, device: { type: 'ring', manufacturer: '', model: source.LUMEN_DEVICE_MODEL, tier: 'C' } },
      quality: { validation: 'measured', confidence: null, flags: [] }, metric: stream, unit: 'unit', aggregation: 'sample', sampling: { mode: 'continuous', device_tier: 'C' },
      t_offset_s: samples.map((s) => (s.t - t0) / 1000), values: samples.map((s) => s.value), ...(hasQ ? { quality_mask: samples.map((s) => s.quality ?? 0) } : {}),
    });
  }
  const chk = validateBatch({ schema: BIO_SCHEMA, producer: { name: 'vitals-ring-fold', version: '1' }, exported_at: now, tz: person.timeZone, records });
  const mask = (s) => s.replace(/[A-Za-z0-9_-]{20,}/g, '<id>').replace(/\d+/g, '#');
  console.log(`old-source series records built: ${records.length} (one per stream and day)`);
  console.log(`per stream (samples in the old chunks; range = validator plausibility bounds):`);
  for (const [s, v] of Object.entries(perStream)) console.log(`  ${s}: days=${v.days} samples=${v.samples} belowMin=${v.belowMin} aboveMax=${v.aboveMax} zero=${v.zero} nonFinite=${v.nonFinite} range=${JSON.stringify(SERIES_RANGE[s] ?? null)}`);
  console.log(`validateBatch: kept ${chk.batch?.records.length ?? 0} records, rejected ${chk.rejected.length}, warnings ${chk.warnings.length}`);
  const rej = new Map();
  for (const r of chk.rejected) rej.set(mask(r), (rej.get(mask(r)) ?? 0) + 1);
  for (const [m, n] of rej) console.log(`  rejected x${n}: ${m}`);
  const warn = new Map();
  for (const w of chk.warnings) warn.set(mask(w), (warn.get(mask(w)) ?? 0) + 1);
  for (const [m, n] of warn) console.log(`  warning x${n}: ${m}`);
  const keptSamples = {};
  for (const r of chk.batch?.records ?? []) keptSamples[r.metric] = (keptSamples[r.metric] ?? 0) + r.values.length;
  console.log(`samples surviving validation per stream: ${JSON.stringify(keptSamples)}`);
  // the same records with the canonical unit instead of 'unit'
  const { CANONICAL_UNIT } = await import('../../../src/biometrics/core/validate.ts');
  const fixed = validateBatch({ schema: BIO_SCHEMA, producer: { name: 'vitals-ring-fold', version: '1' }, exported_at: now, tz: person.timeZone, records: records.map((r) => ({ ...r, unit: CANONICAL_UNIT[r.metric] ?? 'count' })) });
  const fixedSamples = {};
  for (const r of fixed.batch?.records ?? []) fixedSamples[r.metric] = (fixedSamples[r.metric] ?? 0) + r.values.length;
  console.log(`with unit = CANONICAL_UNIT[stream]: kept ${fixed.batch?.records.length ?? 0} records, rejected ${fixed.rejected.length}, warnings ${fixed.warnings.length}; samples per stream ${JSON.stringify(fixedSamples)}`);
} finally {
  await program.close();
}
process.exit(0);
