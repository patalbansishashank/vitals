/**
 * `biometrics.ringFold` re-ids what the v0.5.0 fold left under the ring key with Lumen's ids: every record under a §15.2
 * ring key carries the key's own content id, so a night or day read over Bluetooth and relayed by Lumen is one record.
 * Every stored version is kept (readers end on the most complete, daily fields merged across versions), a second run
 * changes nothing, a person without a ring keeps Lumen's ids, and a log entry made under the old id still names its
 * source.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { daily, prov, sleep } from '@/biometrics/core/__tests__/factory';
import { contentRecordId, dailyRecordId, LUMEN_SOURCE, sleepRecordId, sleepVersion, workoutRecordId } from '@/biometrics/core/recordIds';
import { LUMEN_SOURCE_KEY } from '@/biometrics/core/source';
import type { BioProvenance, StreamPolicy, WorkoutRecord } from '@/biometrics/core/types';
import type { LogEntry } from '@/living';
import { createMemoryBlobStore, setBlobStore } from '@/state/blobStore';
import { dispatch, settleCommits, type CommandResult } from '../..';
import { SYSTEM_ACTOR } from '../../types';
import { freshState } from '../../__tests__/harness';
import { coachHiddenEntryIds } from '../observations';
import { bioIndex, deriveWriter, openBioStore } from '../store';
import { resetBioRuntime } from '../runtime';

const RING = 'ble:jstyle2301/2301/mac:aa:bb:cc:dd:ee:07';
const ringProv = (): BioProvenance => prov({ channel: RING as BioProvenance['channel'], device: { type: 'ring', manufacturer: 'J-Style', model: '2301', tier: 'C' }, source_app: 'Vitals' });
/** A Lumen record as the v0.5.0 fold re-provenanced it: the ring's channel and device, Lumen's own marks kept. */
const lumenUnderRing = (): BioProvenance => ({ ...ringProv(), source_app: 'Lumen', decoder: 'lumen-cloudevents/1' });
const lumenProv = (): BioProvenance => prov({ channel: 'file:lumen_cloudevents', device: { type: 'ring', manufacturer: '', model: 'J-Style 2301', tier: 'C' }, source_app: 'Lumen' });

const RING_READ = Date.parse('2026-10-02T08:00:00Z') / 1000;
const LUMEN_READ = Date.parse('2026-10-02T09:00:00Z') / 1000;
const nightId = (source: string, start: string) => sleepRecordId({ source, start });
const dayId = (source: string, date: string) => dailyRecordId({ source, metric: 'activity', localDate: date });
const workout = (id: string, start: string, p: BioProvenance, f: Partial<WorkoutRecord> = {}): WorkoutRecord => ({
  kind: 'workout', record_id: id, version: 1, time: { start, end: new Date(Date.parse(start) + 45 * 60_000).toISOString(), tz_offset_s: 0, local_date: start.slice(0, 10) },
  provenance: p, quality: { validation: 'measured', confidence: null, flags: [] }, exercise_type: 'running', active_duration_s: 45 * 60, ...f,
});
const policy = (stream: StreamPolicy['stream'], coach: StreamPolicy['coach']): StreamPolicy => ({ stream, imported: true, coach, engine: true, scores: true });

function out<T>(r: CommandResult): T {
  if (!r.ok || !('output' in r)) throw new Error(`command failed: ${JSON.stringify(r)}`);
  return r.output as T;
}
const fold = async () => {
  const r = out<{ ran: boolean; moved: Array<{ from: string; to: string }>; lumen: string | null }>(await dispatch('biometrics.ringFold', {}, { actor: SYSTEM_ACTOR }));
  await settleCommits();
  return r;
};
/** Every stored document: `source id@version steps|asleep`, sorted. */
const docs = async () =>
  [...(await bioIndex()).recDocs.values()].map((e) => `${e.sourceKey} ${e.docId} ${e.record.kind === 'daily' ? e.record.steps : e.record.kind === 'sleep' ? e.record.asleep_s : ''}`).sort();
/** What readers see per record id: `[id, version, steps|asleep]`, sorted by id. */
const latest = async (from: string, to: string) =>
  (await (await openBioStore({ writer: deriveWriter() })).records({ from, to }))
    .map((r) => [r.record.record_id, r.record.version, r.record.kind === 'daily' ? r.record.steps : r.record.kind === 'sleep' ? r.record.asleep_s : null] as const)
    .sort((a, b) => a[0].localeCompare(b[0]));
const byId = <T extends readonly [string, ...unknown[]]>(rows: T[]) => [...rows].sort((a, b) => a[0].localeCompare(b[0]));
const ringSource = async () => {
  const store = await openBioStore({ writer: deriveWriter() });
  await store.putSource({ sourceKey: RING, label: 'J-Style 2301', tier: 'C', policies: [], baselineEpochs: ['2026-10-01'] });
  return store;
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

describe('biometrics.ringFold re-ids Lumen records under the ring key', () => {
  it('as the v0.5.0 fold left them: one record per night and day, every version kept, a second run changes nothing', async () => {
    const store = await ringSource();
    const p = lumenUnderRing();
    // night 1: the ring read it provisional, Lumen relayed it complete (the higher version)
    const n1 = '2026-10-01T22:00:00.000Z';
    await store.putRecord({ ...sleep(nightId(RING, n1), '2026-10-02', 6 * 3600, true, ringProv(), n1), version: sleepVersion(false, RING_READ), quality: { validation: 'measured', confidence: 'low', flags: ['provisional_stages'] } }, RING);
    await store.putRecord({ ...sleep(nightId(LUMEN_SOURCE, n1), '2026-10-02', 7 * 3600, true, p, n1), version: sleepVersion(true, LUMEN_READ) }, RING);
    // day 1: the ring's day total (version by read time) beats Lumen's received-time version
    await store.putRecord(daily(dayId(RING, '2026-10-02'), '2026-10-02', { steps: 8000 }, ringProv(), sleepVersion(true, RING_READ)), RING);
    await store.putRecord(daily(dayId(LUMEN_SOURCE, '2026-10-02'), '2026-10-02', { steps: 7900 }, p, LUMEN_READ), RING);
    // night 2: Lumen only (no ring twin)
    const n2 = '2026-10-02T22:00:00.000Z';
    await store.putRecord({ ...sleep(nightId(LUMEN_SOURCE, n2), '2026-10-03', 5 * 3600, true, p, n2), version: sleepVersion(true, LUMEN_READ + 86_400) }, RING);
    // day 3: both at the same version (a collision) with different bodies: the moved one goes in at the next version
    await store.putRecord(daily(dayId(RING, '2026-10-03'), '2026-10-03', { steps: 100 }, ringProv(), 5), RING);
    await store.putRecord(daily(dayId(LUMEN_SOURCE, '2026-10-03'), '2026-10-03', { steps: 200 }, p, 5), RING);
    // the ring's own records are never re-id'd (only Lumen's are hashed): one with a foreign id stays as it is
    await store.putRecord(daily('foreign-id', '2026-10-04', { steps: 50 }, ringProv(), 7), RING);
    await store.flush();
    expect(await docs()).toHaveLength(8);

    expect(await fold()).toMatchObject({ ran: true, moved: [], lumen: RING });
    expect(await docs()).toEqual([
      `${RING} ${nightId(RING, n1)}@${sleepVersion(false, RING_READ)} ${6 * 3600}`,
      `${RING} ${nightId(RING, n1)}@${sleepVersion(true, LUMEN_READ)} ${7 * 3600}`,
      `${RING} ${nightId(RING, n2)}@${sleepVersion(true, LUMEN_READ + 86_400)} ${5 * 3600}`,
      `${RING} ${dayId(RING, '2026-10-02')}@${LUMEN_READ} 7900`,
      `${RING} ${dayId(RING, '2026-10-02')}@${sleepVersion(true, RING_READ)} 8000`,
      `${RING} ${dayId(RING, '2026-10-03')}@5 100`,
      `${RING} ${dayId(RING, '2026-10-03')}@6 200`,
      `${RING} foreign-id@7 50`,
    ].sort());
    expect(await latest('2026-10-02', '2026-10-04')).toEqual(byId([
      [nightId(RING, n1), sleepVersion(true, LUMEN_READ), 7 * 3600] as const,
      [dayId(RING, '2026-10-02'), sleepVersion(true, RING_READ), 8000] as const,
      [nightId(RING, n2), sleepVersion(true, LUMEN_READ + 86_400), 5 * 3600] as const,
      [dayId(RING, '2026-10-03'), 6, 200] as const,
      ['foreign-id', 7, 50] as const,
    ]));
    const after = await docs();
    expect(await fold()).toMatchObject({ ran: false, moved: [] });
    expect(await docs()).toEqual(after);
  });

  it('a collision with an identical record keeps the stored document only; a different one keeps its fields at the next version', async () => {
    const store = await ringSource();
    // identical apart from provenance: the moved document goes
    await store.putRecord(daily(dayId(RING, '2026-10-03'), '2026-10-03', { steps: 100 }, ringProv(), 5), RING);
    await store.putRecord(daily(dayId(LUMEN_SOURCE, '2026-10-03'), '2026-10-03', { steps: 100 }, lumenUnderRing(), 5), RING);
    // the same steps, other fields: the moved document is kept at the next version, and readers see every field
    await store.putRecord(daily(dayId(RING, '2026-10-04'), '2026-10-04', { steps: 100, distance_m: 70 }, ringProv(), 5), RING);
    await store.putRecord(daily(dayId(LUMEN_SOURCE, '2026-10-04'), '2026-10-04', { steps: 100, active_min: { light: 0, moderate: 30, vigorous: 0 } }, lumenUnderRing(), 5), RING);
    await store.flush();
    expect(await fold()).toMatchObject({ ran: true });
    expect(await docs()).toEqual([`${RING} ${dayId(RING, '2026-10-03')}@5 100`, `${RING} ${dayId(RING, '2026-10-04')}@5 100`, `${RING} ${dayId(RING, '2026-10-04')}@6 100`].sort());
    const read = await (await openBioStore({ writer: deriveWriter() })).records({ from: '2026-10-03', to: '2026-10-04' });
    expect(read.map((r) => r.record)).toMatchObject([
      { record_id: dayId(RING, '2026-10-03'), version: 5, steps: 100 },
      { record_id: dayId(RING, '2026-10-04'), version: 6, steps: 100, distance_m: 70, active_min: { light: 0, moderate: 30, vigorous: 0 } },
    ]);
  });

  it('the document store keeps every later snapshot of a field the newest version lacks, and reads the newest of them', async () => {
    const store = await ringSource();
    const id = dayId(RING, '2026-10-02');
    const at = (hhmm: string) => Math.round(Date.parse(`2026-10-02T${hhmm}:00Z`) / 1000);
    expect(await store.putRecord(daily(id, '2026-10-02', { steps: 8000 }, ringProv(), sleepVersion(true, at('10:00'))), RING)).toBe('inserted');
    expect(await store.putRecord(daily(id, '2026-10-02', { steps: 4000, active_min: { light: 0, moderate: 5, vigorous: 0 } }, lumenUnderRing(), at('09:00')), RING)).toBe('inserted');
    const late = daily(id, '2026-10-02', { steps: 7900, active_min: { light: 0, moderate: 70, vigorous: 0 } }, lumenUnderRing(), at('22:00'));
    expect(await store.putRecord(late, RING)).toBe('inserted');
    // the same snapshot again is not kept twice (the store's contract: a lower version already stored reads `stale`)
    expect(await store.putRecord(late, RING)).toBe('stale');
    // a snapshot older than the one readers take the field from is stale
    expect(await store.putRecord(daily(id, '2026-10-02', { steps: 6000, active_min: { light: 0, moderate: 45, vigorous: 0 } }, lumenUnderRing(), at('15:00')), RING)).toBe('stale');
    await store.flush();
    const read = (await (await openBioStore({ writer: deriveWriter() })).records({ from: '2026-10-02', to: '2026-10-02' })).map((r) => r.record);
    expect(read).toMatchObject([{ record_id: id, version: sleepVersion(true, at('10:00')), steps: 8000, active_min: { light: 0, moderate: 70, vigorous: 0 } }]);
    expect((await (await openBioStore({ writer: deriveWriter() })).records({ from: '2026-10-02', to: '2026-10-02' })).length).toBe(1);
  });

  it('a person without a ring keeps Lumen ids', async () => {
    const store = await openBioStore({ writer: deriveWriter() });
    const n1 = '2026-10-01T22:00:00.000Z';
    await store.putRecord({ ...sleep(nightId(LUMEN_SOURCE, n1), '2026-10-02', 6 * 3600, true, lumenProv(), n1), version: sleepVersion(true, LUMEN_READ) }, LUMEN_SOURCE_KEY);
    await store.putRecord(daily(dayId(LUMEN_SOURCE, '2026-10-02'), '2026-10-02', { steps: 7900 }, lumenProv(), LUMEN_READ), LUMEN_SOURCE_KEY);
    await store.putSource({ sourceKey: LUMEN_SOURCE_KEY, label: 'Lumen', tier: 'C', policies: [], baselineEpochs: ['2026-10-01'] });
    await store.flush();
    const before = await docs();
    expect(await fold()).toMatchObject({ ran: false, moved: [], lumen: null });
    expect(await docs()).toEqual(before);
  });
});

describe('a device log entry made under the old id', () => {
  it('follows the ring source’s Coach setting, not the person’s', async () => {
    const store = await ringSource();
    await store.putSource({ sourceKey: RING, label: 'J-Style 2301', tier: 'C', policies: [policy('workouts', 'hidden')], baselineEpochs: ['2026-10-01'] });
    await store.putPersonPolicies([policy('workouts', 'daily+series')], '2026-10-01T00:00:00.000Z');
    const start = '2026-10-02T17:30:00.000Z';
    const w = workout('tmp', start, lumenUnderRing());
    const ringId = contentRecordId(w, RING);
    const lumenId = workoutRecordId({ source: LUMEN_SOURCE, start });
    expect(ringId).not.toBe(lumenId);
    await store.putRecord({ ...w, record_id: ringId }, RING);
    await store.flush();
    const entryOf = (id: string, recordId: string): LogEntry => ({
      id, date: '2026-10-02', tz: 'UTC', source: { by: 'device', method: 'biometrics', bioRecordId: recordId, deviceKey: `2026-10-02:workouts:${recordId}` },
      kind: 'session', status: 'done', startH: 17.5, durationMin: 45, performed: [], bioWorkoutId: recordId, catalogueVersion: 'device',
      stimulus: { effectiveSetsByRegion: {}, pattern: 'locomotion', loadClass: 'light', netKcal: 0, mem: 45, hiMinutes: 0, mobilityMinutes: {} },
      workout: { exerciseType: 'running', kind: 'cardio' },
    } as unknown as LogEntry);
    const hidden = coachHiddenEntryIds(await bioIndex(), [entryOf('E-old', lumenId), entryOf('E-new', ringId)]);
    expect([...hidden].sort()).toEqual(['E-new', 'E-old']);
  });
});
