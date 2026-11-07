// @vitest-environment node
/**
 * The energy SPEC §S2 E2E fixture day (`./gaugeV2Fixture.ts`) through the `gauge_*` tools: a treadmill walk with the
 * ring blind, an air bike with heart rate only, a GPS walk, and a Health Connect Fit walk that duplicates the phone. It
 * also writes (or, once written, checks) the §2.2 response fixtures in `packages/companion/fixtures/gauge-v2/`, which
 * Vitals reads and never edits. Regenerate them after a deliberate change with `UPDATE_GAUGE_FIXTURES=1`.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deletion, INSTALL } from './lumenFixtures.ts';
import { openLumenStore, type LumenStore } from './lumenStore.ts';
import { lumenToolSet, type LumenToolSet } from './lumenTools.ts';
import { FIXTURE_DATE, FIXTURE_NOW, FIXTURE_TZ, fixtureDay, ist } from './gaugeV2Fixture.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- answers are read field by field
type Json = Record<string, any>;

const FIXTURES = fileURLToPath(new URL('../../fixtures/gauge-v2/', import.meta.url));
let dir: string;
let store: LumenStore;
let tools: LumenToolSet;
const run = async (name: string, args: Record<string, unknown> = {}) => (await tools.call(name, args)) as unknown as { ok: boolean; summary: string; data: Json; error?: { code: string } };

beforeAll(() => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'gauge-v2-'));
  store = openLumenStore(join(dir, 'lumen.db'));
  store.noteInstallation(INSTALL, { deviceName: 'Pixel 8', appVersion: '2.9.0', pairedAt: '2026-10-01T00:00:00.000Z' });
  const r = store.ingest(INSTALL, fixtureDay(), FIXTURE_NOW);
  expect(r.rejected).toEqual([]);
  tools = lumenToolSet(() => store, FIXTURE_TZ, () => FIXTURE_NOW);
});
afterAll(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const at = (hhmm: string) => `${FIXTURE_DATE}T${hhmm}:00+05:30`;

describe('the fixture day: steps-fuse/1 through gauge_steps', () => {
  it('the treadmill walk is the phone\'s (sole sustained gait), the GPS walk the ring\'s (preference), the stroll the phone\'s alone', async () => {
    const r = await run('gauge_steps', { from: FIXTURE_DATE, to: FIXTURE_DATE });
    expect(r.ok).toBe(true);
    const iv = r.data.intervals as Json[];
    const covering = (t: string) => iv.find((u) => u.start <= at(t) && at(t) < u.end)!;
    expect(covering('07:10')).toMatchObject({ lineage: 'phone', selectionReason: 'soleSustainedGait', disagreement: true, start: at('07:00'), end: at('07:30'), steps: 3000 });
    expect(covering('07:10').alternatives).toEqual([{ source: 'ring:0123456789abcdef', lineage: 'ring', steps: 36, support: 'minute' }]);
    expect(covering('17:10')).toMatchObject({ lineage: 'ring', selectionReason: 'preference', start: at('17:00'), end: at('17:40'), steps: 4400 });
    expect(covering('17:10').disagreement).toBeUndefined();
    // Fit's copy of the phone's walk is the phone lineage: reported, never counted
    expect(covering('17:10').alternatives).toContainEqual({ source: 'hc:com.google.android.apps.fitness', lineage: 'phone', steps: 4150, support: 'span', sameLineage: true });
    expect(covering('12:05')).toMatchObject({ lineage: 'phone', selectionReason: 'soleObserved' });
    // the air bike: no step detail, the listening phone saw no steps (observed zeros)
    expect(covering('08:10')).toMatchObject({ lineage: 'phone', steps: 0, selectionReason: 'soleObserved' });
    expect(covering('03:00')).toBeUndefined();
    const [day] = r.data.days as Json[];
    expect(day).toEqual({
      date: FIXTURE_DATE, located: 8750, ringDailyTotal: 9000, ringResidual: 9000 - 4436, phoneDailyTotal: 3000 + 1350 + 4200,
      headline: 9000, headlinePolicy: 'atLeast', resolved: false, headlineLabel: 'At least: includes ring steps not placed in time',
      coverage: { ringMin: 235, phoneMin: 750, eitherMin: 750, unknownMin: 690 },
    });
    expect(r.data).toMatchObject({ fusionVersion: 'steps-fuse/1', inputsHash: expect.stringMatching(/^sha256:[0-9a-f]{32}$/) });
  });

  it('gauge_activity carries the fused headline beside the ring\'s own latest total and bucket sums', async () => {
    const r = await run('gauge_activity', { from: FIXTURE_DATE, to: FIXTURE_DATE });
    expect(r.data.days).toEqual([expect.objectContaining({ date: FIXTURE_DATE, steps: 9000, bucketSteps: 4436, fusedHeadline: 9000, fusedHeadlinePolicy: 'atLeast', fusedLocated: 8750, fusionVersion: 'steps-fuse/1' })]);
    expect(r.data.units.caloriesKcal).toMatch(/Phone estimate \(method/);
  });

  it('a range over 62 days is refused; the dates must parse', async () => {
    expect((await run('gauge_steps', { from: '2026-01-01', to: '2026-03-31' })).error?.code).toBe('invalid_input');
    expect((await run('gauge_steps', { from: 'today', to: FIXTURE_DATE })).error?.code).toBe('invalid_input');
  });
});

describe('the fixture day: workouts, daily values, timeline, baselines, Health Connect', () => {
  it('gauge_workouts: overlap, pauses, the kcal method and basis', async () => {
    const r = await run('gauge_workouts', { from: `${FIXTURE_DATE}T08:05`, to: `${FIXTURE_DATE}T08:06` });
    // the air bike started before the range: an overlap query still finds it
    expect(r.data.sessions.map((s: Json) => s.id)).toEqual(['w-airbike']);
    expect(r.data.sessions[0]).toMatchObject({ pauses: [{ start: at('08:10'), end: at('08:11') }], movingS: 1140, kcalMethod: 'hr', kcalVersion: 'gauge-hr/1', energyBasis: 'gross', zonesVersion: 'gauge-220-age-5min', kcalLabel: 'Phone estimate (method hr)' });
    const all = await run('gauge_workouts', { from: FIXTURE_DATE, to: FIXTURE_DATE });
    expect(all.data.totals).toEqual({ count: 3, durationS: 1800 + 1140 + 2400, distanceM: 5400, kcal: 550, sessions: 3, overlapping: 0 });
  });

  it('gauge_daily_summary: the highest held reading (the 190 spike dropped), non-exercise and workout HR, the ring\'s step goal, median gaps', async () => {
    const r = await run('gauge_daily_summary', { date: FIXTURE_DATE });
    expect(r.data.derived).toMatchObject({
      version: 'day-metrics/1',
      peakHr: { bpm: 172, source: 'workout:w-airbike', lowerBound: true, label: 'Highest reading' },
      avgWorkoutHr: { bpm: Math.round(((112 * 1800 + 151 * 1140 + 104 * 2400) / 5340) * 10) / 10, workoutS: 5340 },
      ringStepGoal: 8000,
    });
    expect(r.data.derived.nonExerciseHr).toMatchObject({ median: expect.any(Number), n: expect.any(Number) });
    expect(r.data.derived.nonExerciseHr.n).toBeGreaterThanOrEqual(5);
    expect(r.data.activity).toMatchObject({ steps: 9000, fusedHeadline: 9000, ringStepGoal: 8000 });
    expect(r.data.metrics.stress.medianGapS).toBe(1800);
    expect(r.data.metrics.hr.medianGapS).toBe(900);
    expect(r.data.sleep).toHaveLength(1);
    expect(r.data.sleep[0].metrics).toMatchObject({ tstLowerMin: 323, onset: '2026-10-19T23:12:00+05:30' });
  });

  it('gauge_timeline: 1440 minutes, fused and per-source steps, sampled HR, stages, sessions, acquisition and stress', async () => {
    const r = await run('gauge_timeline', { date: FIXTURE_DATE });
    const t = r.data;
    const i = (hhmm: string) => (ist(hhmm) - ist('00:00')) / 60_000;
    expect(t.minutes).toBe(1440);
    for (const k of ['selected', 'source', 'ring', 'phone']) expect(t.steps[k]).toHaveLength(1440);
    expect([t.steps.selected[i('07:10')], t.steps.source[i('07:10')], t.steps.ring[i('07:10')], t.steps.phone[i('07:10')]]).toEqual([100, 'phone', expect.any(Number), 100]);
    expect([t.steps.selected[i('17:10')], t.steps.source[i('17:10')]]).toEqual([110, 'ring']);
    expect([t.steps.selected[i('03:00')], t.steps.source[i('03:00')], t.steps.ring[i('03:00')], t.steps.phone[i('03:00')]]).toEqual([null, null, null, null]);
    expect(t.steps.phone[i('08:10')]).toBe(0);
    expect(t.hr.bpm.every((x: number | null) => x === null)).toBe(true); // no declared cadence
    expect(t.hr.sampledBpm[i('15:00')]).toBe(190);
    expect(t.sleep.stage[i('00:30')]).toBe('deep');
    expect(t.sleep.stage[i('12:00')]).toBeNull();
    expect(t.sessions.map((s: Json) => s.id)).toEqual(['w-treadmill', 'w-airbike', 'w-walk']);
    expect(t.hcExercise).toEqual([{ id: 'fit-walk', start: at('17:00'), end: at('17:40'), exerciseType: 'walking', exerciseTypeCode: 79, title: 'Evening walk', origin: 'com.google.android.apps.fitness', originPackage: 'com.google.android.apps.fitness', lineage: 'phone' }]);
    expect([t.acquisition.phone[i('06:30')], t.acquisition.phone[i('19:00')], t.acquisition.ring[i('06:45')], t.acquisition.ring[i('08:10')]]).toEqual(['listening', null, 'observed', null]);
    expect(t.stress.readings).toHaveLength(32);
    expect(t.stress.medianGapS).toBe(1800);
  });

  it('gauge_baselines: eight prior nights, the fixture night excluded; usual onset, sleeping low HR, HRV, temperature', async () => {
    const r = await run('gauge_baselines', { date: FIXTURE_DATE });
    expect(r.data.learning).toEqual({ nights: 8, needed: 7, learning: false });
    expect(r.data.usualOnset).toMatchObject({ n: 8, ready: true });
    expect(r.data.sleepLowHr).toMatchObject({ n: 8, spanDays: 7, ready: true });
    expect(r.data.hrvBaseline).toMatchObject({ n: 8, ready: true });
    expect(r.data.tempBaseline).toMatchObject({ n: 8, ready: true, deltaC: expect.any(Number) });
    expect(r.data.sampledIdleHr.label).toMatch(/not a resting heart rate/);
    const early = await run('gauge_baselines', { date: '2026-10-16' });
    expect(early.data.learning).toEqual({ nights: 4, needed: 7, learning: true });
    expect(early.summary).toMatch(/learning \(night 4 of 7\)/);
  });

  it('gauge_hc: records by type with origin and lineage, in pages', async () => {
    const r = await run('gauge_hc', { type: 'Steps', from: FIXTURE_DATE, to: FIXTURE_DATE });
    expect(r.data.records).toEqual([expect.objectContaining({ id: 'fit-walk-steps', recordType: 'Steps', origin: 'com.google.android.apps.fitness', deviceNative: false, originPackage: 'com.google.android.apps.fitness', originIsDeviceNative: false, lineage: 'phone', payload: { count: 4150 } })]);
    expect((await run('gauge_hc', { type: 'Nope', from: FIXTURE_DATE, to: FIXTURE_DATE })).error?.code).toBe('invalid_input');
    const p1 = await run('gauge_hc', { type: 'ExerciseSession', from: '2026-10-01', to: FIXTURE_DATE, limit: 1 });
    expect(p1.data).toMatchObject({ next: null, records: [expect.objectContaining({ id: 'fit-walk' })] });
  });
});

describe('inputsHash', () => {
  it('a deletion of a source row changes the hash of every derivation that read it, and only those', async () => {
    const before = await Promise.all([run('gauge_steps', { from: FIXTURE_DATE, to: FIXTURE_DATE }), run('gauge_sleep', { from: FIXTURE_DATE, to: FIXTURE_DATE })]);
    const again = await run('gauge_steps', { from: FIXTURE_DATE, to: FIXTURE_DATE });
    expect(again.data.inputsHash).toBe(before[0].data.inputsHash);
    // the person deletes the stroll's phone steps (12:00–12:15) in Gauge
    store.ingest(INSTALL, [deletion('2026-10-20T18:05:00Z', { category: 'activity/phone_steps', from: '2026-10-20T06:30:00Z', to: '2026-10-20T06:46:00Z' }, { receivedAt: '2026-10-20T18:05:00Z' })], FIXTURE_NOW + 60_000);
    const after = await Promise.all([run('gauge_steps', { from: FIXTURE_DATE, to: FIXTURE_DATE }), run('gauge_sleep', { from: FIXTURE_DATE, to: FIXTURE_DATE })]);
    expect(after[0].data.inputsHash).not.toBe(before[0].data.inputsHash);
    expect(after[0].data.days[0].located).toBe(8750 - 1350);
    expect(after[1].data.inputsHash).toBe(before[1].data.inputsHash);
  });
});

// --- the §2.2 response fixtures Vitals reads (written by this test; checked once written)

describe('fixtures/gauge-v2', () => {
  const CASES: Array<[string, string, Record<string, unknown>]> = [
    ['steps', 'gauge_steps', { from: FIXTURE_DATE, to: FIXTURE_DATE }],
    ['timeline', 'gauge_timeline', { date: FIXTURE_DATE }],
    ['activity', 'gauge_activity', { from: FIXTURE_DATE, to: FIXTURE_DATE }],
    ['workouts', 'gauge_workouts', { from: FIXTURE_DATE, to: FIXTURE_DATE }],
    ['sleep', 'gauge_sleep', { from: FIXTURE_DATE, to: FIXTURE_DATE }],
    ['baselines', 'gauge_baselines', { date: FIXTURE_DATE }],
    ['daily', 'gauge_daily_summary', { date: FIXTURE_DATE }],
    ['series', 'gauge_metric_series', { kind: 'stress', from: FIXTURE_DATE, to: FIXTURE_DATE, limit: 20 }],
    ['hc', 'gauge_hc', { type: 'Steps', from: FIXTURE_DATE, to: FIXTURE_DATE }],
    ['scores', 'gauge_scores', { from: FIXTURE_DATE, to: FIXTURE_DATE }],
  ];
  it('every §2.2 route has a fixture of the fixture day, and the server still answers it exactly', async () => {
    // a fresh store: the deletion above is not part of the fixture day
    const d = mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'gauge-v2-fx-'));
    const s = openLumenStore(join(d, 'lumen.db'));
    try {
      s.noteInstallation(INSTALL, { deviceName: 'Pixel 8', appVersion: '2.9.0', pairedAt: '2026-10-01T00:00:00.000Z' });
      s.ingest(INSTALL, fixtureDay(), FIXTURE_NOW);
      const t = lumenToolSet(() => s, FIXTURE_TZ, () => FIXTURE_NOW);
      mkdirSync(FIXTURES, { recursive: true });
      for (const [name, tool, args] of CASES) {
        const envelope = await t.call(tool, args);
        expect(envelope.ok, name).toBe(true);
        const file = join(FIXTURES, `${name}.json`);
        const body = { route: `/v1/gauge/${name === 'daily' ? 'daily' : name}`, tool, args, timeZone: FIXTURE_TZ, envelope };
        if (process.env.UPDATE_GAUGE_FIXTURES || !existsSync(file)) writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
        expect(JSON.parse(readFileSync(file, 'utf8')), name).toEqual(JSON.parse(JSON.stringify(body)));
      }
    } finally {
      s.close();
      rmSync(d, { recursive: true, force: true });
    }
  });
});
