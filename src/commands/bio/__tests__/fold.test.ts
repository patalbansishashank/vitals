/**
 * One ring = one source (SUITE_SPEC §15.2): `biometrics.ringFold` folds the Lumen source into the person's one J-Style
 * 2301 ring source, moves a Lumen source under an old key into the one Lumen key, and never duplicates a record or a
 * sample. Keys and labels never carry an advertised name.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { batch, daily, hrSeries, prov } from '@/biometrics/core/__tests__/factory';
import { RING_FOLD_ID } from '@/biometrics/core/policy';
import { LUMEN_SOURCE_KEY } from '@/biometrics/core/source';
import type { BioProvenance } from '@/biometrics/core/types';
import { createMemoryBlobStore, setBlobStore } from '@/state/blobStore';
import { dispatch, getCommand, settleCommits, type CommandResult } from '../..';
import { SYSTEM_ACTOR } from '../../types';
import { freshState } from '../../__tests__/harness';
import { ingestRingBatch } from '../exec';
import { bioIndex, deriveWriter, openBioStore } from '../store';
import { resetBioRuntime } from '../runtime';

const RING = 'ble:jstyle2301/2301/mac:aa:bb:cc:dd:ee:07';
const RING2 = 'ble:jstyle2301/2301/serial:B2';
const ADV = 'ADV-NAME 77';

const lumenProv = (): BioProvenance => prov({ channel: 'file:lumen_cloudevents', device: { type: 'ring', manufacturer: 'J-Style', model: 'J-Style 2301', tier: 'C' } });
const ringProv = (key = RING): BioProvenance => prov({ channel: key as BioProvenance['channel'], device: { type: 'ring', manufacturer: 'J-Style', model: '2301', tier: 'C' } });

function out<T>(r: CommandResult): T {
  if (!r.ok || !('output' in r)) throw new Error(`command failed: ${JSON.stringify(r)}`);
  return r.output as T;
}
// the ring's history is periodic samples, whether the driver reads them (origin `history`) or Lumen relays them (`import`
// under the Lumen key; `history` once filed under the ring key)
const ingest = (p: BioProvenance, date: string) =>
  ingestRingBatch(batch([daily(`night-${date}`, date, { steps: 9000, resting_hr_bpm: 55 }, p), hrSeries(`hr-${date}`, `${date}T01:00:00.000Z`, [60, 61, 62], 60, p, { sampling: { mode: 'periodic' } })]), {
    ringKey: p.channel,
    signal: new AbortController().signal,
    progress: () => {},
  });
const fold = async () => {
  const r = out<{ ran: boolean; moved: Array<{ from: string; to: string }>; lumen: string | null; ambiguous: boolean }>(await dispatch('biometrics.ringFold', {}, { actor: SYSTEM_ACTOR }));
  await settleCommits();
  return r;
};
const sourceKeys = async () => out<{ sources: Array<{ sourceKey: string; label: string }> }>(await dispatch('bio.sources', {})).sources.map((s) => s.sourceKey).sort();
const stored = async (date: string) => {
  const ix = await bioIndex();
  const store = await openBioStore({ writer: deriveWriter() });
  const recs = [...ix.recDocs.values()].filter((e) => e.record.time.local_date === date).map((e) => `${e.sourceKey} ${e.record.record_id}`);
  const samples = (await store.samples({ stream: 'hr', from: date, to: date })).map((s) => `${s.sourceKey} ${s.t}`);
  return { recs: recs.sort(), samples: samples.sort() };
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-04T12:00:00.000Z'));
  freshState({ cleared: true });
  setBlobStore(createMemoryBlobStore());
  resetBioRuntime();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('biometrics.ringFold', () => {
  it('is a system-only migration the app runs itself', async () => {
    expect(getCommand('biometrics.ringFold')?.surfaces).toEqual(['ui']);
    const r = await dispatch('biometrics.ringFold', {});
    expect(r.ok).toBe(false);
  });

  it('ring paired after Lumen data: one ring source, the night and each sample once, new Lumen data on the ring', async () => {
    await ingest(lumenProv(), '2026-10-03');
    expect(await fold()).toMatchObject({ ran: false, lumen: null, ambiguous: false });
    expect(await sourceKeys()).toEqual([LUMEN_SOURCE_KEY]);
    // the same night read over Bluetooth (same record ids: the driver shares Lumen's namespace)
    await ingest(ringProv(), '2026-10-03');
    expect(await sourceKeys()).toEqual([RING, LUMEN_SOURCE_KEY].sort());
    const r = await fold();
    expect(r).toMatchObject({ ran: true, lumen: RING, moved: [{ from: LUMEN_SOURCE_KEY, to: RING }] });
    expect(await sourceKeys()).toEqual([RING]);
    expect(await stored('2026-10-03')).toEqual({
      recs: [`${RING} night-2026-10-03`],
      samples: [0, 60_000, 120_000].map((d) => `${RING} ${Date.parse('2026-10-03T01:00:00.000Z') + d}`),
    });
    expect((await bioIndex()).sourceDocs.get(RING_FOLD_ID)).toMatchObject({ lumen: RING });
    // a second run changes nothing
    expect(await fold()).toMatchObject({ ran: false, moved: [] });
    // Lumen data arriving after the fold lands on the ring
    await ingest(lumenProv(), '2026-10-04');
    expect(await sourceKeys()).toEqual([RING]);
    expect((await stored('2026-10-04')).recs).toEqual([`${RING} night-2026-10-04`]);
    expect((await stored('2026-10-04')).samples).toHaveLength(3);
  });

  it('Lumen data after the ring: folded on the next run, no duplicates', async () => {
    await ingest(ringProv(), '2026-10-03');
    expect(await fold()).toMatchObject({ ran: true, lumen: RING, moved: [] });
    // from now on Lumen records file under the ring key straight away
    await ingest(lumenProv(), '2026-10-03');
    expect(await sourceKeys()).toEqual([RING]);
    expect(await stored('2026-10-03')).toMatchObject({ recs: [`${RING} night-2026-10-03`] });
    expect((await stored('2026-10-03')).samples).toHaveLength(3);
  });

  it('two J-Style 2301 rings: no fold, Lumen stays its own source', async () => {
    await ingest(ringProv(), '2026-10-03');
    await ingest(ringProv(RING2), '2026-10-02');
    await ingest(lumenProv(), '2026-10-01');
    expect(await fold()).toMatchObject({ ran: false, lumen: null, ambiguous: true, moved: [] });
    expect(await sourceKeys()).toEqual([RING, RING2, LUMEN_SOURCE_KEY].sort());
  });

  it('records and samples only the old source held survive the move, origin and quality kept', async () => {
    const oldKey = `file:lumen_cloudevents|:old-model`;
    const store = await openBioStore({ writer: deriveWriter() });
    const p = prov({ channel: 'file:lumen_cloudevents', device: { type: 'ring', manufacturer: '', model: 'old model', tier: 'C' } });
    await store.putRecord(daily('night-2026-09-20', '2026-09-20', { steps: 4000 }, p), oldKey);
    const t0 = Date.parse('2026-09-20T01:00:00.000Z');
    for (const stream of ['hr', 'spo2', 'skin_temp'] as const) {
      await store.putSamples({ sourceKey: oldKey, stream, local_date: '2026-09-20' }, [{ t: t0, value: 60, origin: 'import', quality: 2 }, { t: t0 + 60_000, value: 61, origin: 'import' }], { tz_offset_s: 0, createdAt: '2026-09-20T02:00:00.000Z' });
    }
    await store.putSource({ sourceKey: oldKey, label: 'old', tier: 'C', policies: [], baselineEpochs: [] });
    await store.flush();
    // the canonical source holds another day only
    await ingest(lumenProv(), '2026-10-03');
    expect(await fold()).toMatchObject({ ran: true, moved: [{ from: oldKey, to: LUMEN_SOURCE_KEY }] });
    expect(await sourceKeys()).toEqual([LUMEN_SOURCE_KEY]);
    expect((await stored('2026-09-20')).recs).toEqual([`${LUMEN_SOURCE_KEY} night-2026-09-20`]);
    const after = await openBioStore({ writer: deriveWriter() });
    for (const stream of ['hr', 'spo2', 'skin_temp'] as const) {
      const got = await after.samples({ stream, from: '2026-09-20', to: '2026-09-20' });
      expect(got.map((s) => [s.sourceKey, s.t, s.value, s.origin, s.quality ?? 0]), stream).toEqual([[LUMEN_SOURCE_KEY, t0, 60, 'import', 2], [LUMEN_SOURCE_KEY, t0 + 60_000, 61, 'import', 0]]);
    }
    expect((await after.manifests({ sourceKey: oldKey })).length).toBe(0);
    // the Lumen source then folds into a ring: samples keep their time and become the ring's history
    await ingest(ringProv(), '2026-10-04');
    expect(await fold()).toMatchObject({ ran: true, lumen: RING });
    const hr = await (await openBioStore({ writer: deriveWriter() })).samples({ stream: 'hr', from: '2026-09-20', to: '2026-09-20' });
    expect(hr.map((s) => [s.sourceKey, s.t, s.origin])).toEqual([[RING, t0, 'history'], [RING, t0 + 60_000, 'history']]);
  });

  it('keeps every stored version of a record: old source v1 and v3, target v2, in any order', async () => {
    const oldKey = `file:lumen_cloudevents|:old-model`;
    const store = await openBioStore({ writer: deriveWriter() });
    const p = prov({ channel: 'file:lumen_cloudevents', device: { type: 'ring', manufacturer: '', model: 'old model', tier: 'C' } });
    const at = (v: number, steps: number, pp: BioProvenance) => ({ ...daily('night-2026-09-21', '2026-09-21', { steps }, pp), version: v });
    // the old source holds v1 and v3, the canonical source v2 of the same record (stored in version order, as the
    // store accepts them); a version check during the move would drop v1 (below v3 and v2) or v3 (if moved after v1)
    await store.putRecord(at(1, 1000, p), oldKey);
    await store.putRecord(at(2, 2000, lumenProv()), LUMEN_SOURCE_KEY);
    await store.putRecord(at(3, 3000, p), oldKey);
    // another record: the canonical source's version is below the old source's, which must win after the move
    await store.putRecord({ ...daily('night-2026-09-22', '2026-09-22', { steps: 100 }, lumenProv()), version: 5 }, LUMEN_SOURCE_KEY);
    await store.putRecord({ ...daily('night-2026-09-22', '2026-09-22', { steps: 900 }, p), version: 9 }, oldKey);
    await store.putSource({ sourceKey: oldKey, label: 'old', tier: 'C', policies: [], baselineEpochs: [] });
    await store.putSource({ sourceKey: LUMEN_SOURCE_KEY, label: 'lumen', tier: 'C', policies: [], baselineEpochs: [] });
    await store.flush();
    const docs = async () => [...(await bioIndex()).recDocs.values()].map((e) => `${e.sourceKey} ${e.docId}`).sort();
    expect(await docs()).toHaveLength(5);
    expect(await fold()).toMatchObject({ ran: true, moved: [{ from: oldKey, to: LUMEN_SOURCE_KEY }] });
    const ixRef = await bioIndex();
    expect(await docs()).toEqual([`${LUMEN_SOURCE_KEY} night-2026-09-21@1`, `${LUMEN_SOURCE_KEY} night-2026-09-21@2`, `${LUMEN_SOURCE_KEY} night-2026-09-21@3`, `${LUMEN_SOURCE_KEY} night-2026-09-22@5`, `${LUMEN_SOURCE_KEY} night-2026-09-22@9`]);
    expect(ixRef.latestVersion('night-2026-09-21')).toBe(3);
    expect(ixRef.latestVersion('night-2026-09-22')).toBe(9);
    const recs = await (await openBioStore({ writer: deriveWriter() })).records({ from: '2026-09-21', to: '2026-09-22' });
    expect(recs.map((r) => [r.record.record_id, r.record.version, (r.record as { steps?: number }).steps])).toEqual([['night-2026-09-21', 3, 3000], ['night-2026-09-22', 9, 900]]);
  });

  it('Lumen data under a key whose source document is gone is folded too', async () => {
    await ingest(ringProv(), '2026-10-03');
    expect(await fold()).toMatchObject({ ran: true, lumen: RING });
    // the server filed a night under the Lumen key while the removal of that source was still on its way
    const store = await openBioStore({ writer: deriveWriter() });
    await store.putRecord(daily('night-2026-10-02', '2026-10-02', { steps: 7000 }, lumenProv()), LUMEN_SOURCE_KEY);
    await store.putSamples({ sourceKey: LUMEN_SOURCE_KEY, stream: 'hr', local_date: '2026-10-02' }, [{ t: Date.parse('2026-10-02T01:00:00.000Z'), value: 58, origin: 'history' }], { tz_offset_s: 0, createdAt: '2026-10-02T02:00:00.000Z' });
    await store.flush();
    expect(await sourceKeys()).toEqual([RING]);
    expect(await fold()).toMatchObject({ ran: true, moved: [{ from: LUMEN_SOURCE_KEY, to: RING }] });
    expect(await stored('2026-10-02')).toEqual({ recs: [`${RING} night-2026-10-02`], samples: [`${RING} ${Date.parse('2026-10-02T01:00:00.000Z')}`] });
    expect(await fold()).toMatchObject({ ran: false, moved: [] });
  });

  it('a Lumen source under an old key that carried an advertised name moves into the one Lumen key', async () => {
    const oldKey = `file:lumen_cloudevents|:${ADV.toLowerCase().replace(/\s+/g, '_')}-jstyle-2301`;
    const store = await openBioStore({ writer: deriveWriter() });
    const p = prov({ channel: 'file:lumen_cloudevents', device: { type: 'ring', manufacturer: '', model: `${ADV} J-Style 2301`, tier: 'C' } });
    await store.putRecord(daily('night-2026-10-03', '2026-10-03', { steps: 9000 }, p), oldKey);
    await store.putSamples({ sourceKey: oldKey, stream: 'hr', local_date: '2026-10-03' }, [{ t: Date.parse('2026-10-03T01:00:00.000Z'), value: 60, origin: 'import' }], { tz_offset_s: 0, createdAt: '2026-10-03T02:00:00.000Z' });
    await store.putSource({ sourceKey: oldKey, label: `${ADV} J-Style 2301`, tier: 'C', policies: [], baselineEpochs: [] });
    await store.flush();
    // the canonical Lumen source already holds the same night
    await ingest(lumenProv(), '2026-10-03');
    expect(await fold()).toMatchObject({ ran: true, moved: [{ from: oldKey, to: LUMEN_SOURCE_KEY }], lumen: null });
    expect(await sourceKeys()).toEqual([LUMEN_SOURCE_KEY]);
    const got = await stored('2026-10-03');
    expect(got.recs).toEqual([`${LUMEN_SOURCE_KEY} night-2026-10-03`]);
    expect(got.samples).toHaveLength(3);
    expect(JSON.stringify([...(await bioIndex()).sourceDocs.entries()])).not.toMatch(/adv-name|ADV-NAME/);
  });
});
