/**
 * 0.6.3 FX5 (cross-verification M18 / M10) through the import: Gauge's route-derived GPS speed reaches the speed estimator
 * with its lineage (one speed source per activity; outdoor cycling never reads speed, energy SPEC V2.4(3); the same
 * coverage gate as Health Connect speed), the ring's sport windows feed the detector's telemetry branch without
 * re-offering a recorded workout, and Health Connect's resting HR stands in (labelled) only while the ring's sleeping low
 * is not ready.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDocumentStore } from '@/state/runtime';
import { dispatch, settleCommits, type CommandResult } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { useProfileStore } from '@/state/profileStore';
import { addDays, localToInstant } from '@/living';
import type { ActivityCandidateDoc } from '@/living/activityCandidates';
import { activityInput, type ActivityImportInput } from '@/state/gaugeImport';
import { adaptBaselines, restingProxyOf, type GaugeApi } from '@/net/gauge';
import { evidenceWords } from '@/features/living/activity/model';
import { readCandidates } from '../activity';

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const TODAY = '2026-10-21';
const Y = addDays(TODAY, -1);
const SYS = { actor: { kind: 'system' as const, id: 'gauge-import' } };
const ms = (date: string, h: number) => Date.parse(localToInstant(date, h, TZ));
const out = <T,>(r: CommandResult): T => {
  if (!r.ok || !('output' in r)) throw new Error(JSON.stringify(r));
  return r.output as T;
};

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(ms(TODAY, 12)));
});
afterAll(() => {
  vi.useRealTimers();
});
async function fresh(): Promise<void> {
  freshState({ cleared: true });
  await getDocumentStore().ready;
  const p = useProfileStore.getState();
  p.setAge(35);
  p.setHeight(175);
  p.setWeight(70);
}
beforeEach(fresh);

// a Gauge GPS session 18:00-18:30 yesterday in a 2-hour minute grid from 17:00
const first = ms(Y, 17);
const N = 120;
const session = (type: string) => ({ id: `w-${type}`, revision: 'g1', start: ms(Y, 18), end: ms(Y, 18.5), type });
const inRun = <T,>(v: T, otherwise: T, from = 60, to = 90) => Array.from({ length: N }, (_, k) => (k >= from && k < to ? v : otherwise));
const day = (extra: Partial<ActivityImportInput['minutes'][number]> = {}): ActivityImportInput['minutes'][number] => ({
  first,
  steps: inRun<number | null>(110, 0),
  hrBpm: Array.from({ length: N }, () => null),
  hrSupportedS: Array.from({ length: N }, () => null),
  ...extra,
});
const gps = (mps: number, from = 60, to = 90) => ({ gpsSpeedMps: inRun<number | null>(mps, null, from, to), gpsSpeedAccepted: inRun(true, false, from, to) });

async function importOnce(input: Record<string, unknown>): Promise<ActivityCandidateDoc[]> {
  out(await dispatch('activity.fromGauge', { gaugeSessions: [], hcSessions: [], ...input }, SYS));
  await settleCommits();
  return [...(await readCandidates()).byKey.values()] as ActivityCandidateDoc[];
}

describe('Gauge GPS speed reaches the speed estimator', () => {
  it('the probe: a GPS walk at 1.4 m/s over all its moving time is estimated by speed, from Gauge GPS', async () => {
    const [c] = await importOnce({ gaugeSessions: [session('walk')], minutes: [day(gps(1.4))] });
    expect(c!.suggested.exerciseId).toBe('walk');
    expect(c!.estimate!.booked).toMatchObject({ estimator: 'speedGrade', domainFlags: expect.arrayContaining(['gpsMovingSpeed']) });
    expect(c!.estimate!.evidence?.speed).toMatchObject({ source: 'gaugeGps', used: true, kmh: 5.04, gradePct: null, coverage: 1 });
    // the candidate keeps the GPS minutes, so an edit re-estimates from them
    expect(c!.evidence?.gpsSpeedMps?.filter((v) => v !== null)).toHaveLength(30);
    expect(evidenceWords(c!.estimate!.evidence).method).toMatch(/^from Phone GPS speed/);
  });

  it('GPS speed needs the same coverage as Health Connect speed (measuredMinCoverage)', async () => {
    const [c] = await importOnce({ gaugeSessions: [session('walk')], minutes: [day(gps(1.4, 60, 70))] });
    expect(c!.estimate!.booked.estimator).not.toBe('speedGrade');
    expect(c!.estimate!.evidence?.speed).toMatchObject({ source: 'gaugeGps', used: false, reason: 'speedCoverageLow' });
  });

  it('outdoor cycling from GPS speed is never eligible (V2.4(3))', async () => {
    const [c] = await importOnce({ gaugeSessions: [session('cycle')], minutes: [day(gps(6))] });
    expect(c!.suggested.exerciseId).toBe('cycle_outdoor');
    expect(c!.estimate!.booked.estimator).not.toBe('speedGrade');
    expect(c!.estimate!.evidence?.speed).toMatchObject({ source: 'gaugeGps', used: false });
    expect(['speedNotEligibleForType', 'notGait']).toContain(c!.estimate!.evidence!.speed!.reason);
  });

  it('with Gauge GPS and Health Connect speed both present, one source is booked (GPS), never a blend', async () => {
    const [gpsOnly] = await importOnce({ gaugeSessions: [session('walk')], minutes: [day(gps(1.4))] });
    await fresh();
    const [both] = await importOnce({ gaugeSessions: [session('walk')], minutes: [day({ ...gps(1.4), speedMps: inRun<number | null>(2.2, null), speedAccepted: inRun(true, false) })] });
    expect(both!.estimate!.evidence?.speed).toMatchObject({ source: 'gaugeGps', used: true, kmh: 5.04 });
    expect(both!.estimate!.booked.grossKcal).toBe(gpsOnly!.estimate!.booked.grossKcal);
    expect(both!.estimate!.booked.domainFlags).not.toContain('hcSpeed');
  });

  it('GPS too thin but Health Connect speed covering the activity: Health Connect is used', async () => {
    const [c] = await importOnce({ gaugeSessions: [session('walk')], minutes: [day({ ...gps(1.4, 60, 65), speedMps: inRun<number | null>(1.5, null), speedAccepted: inRun(true, false) })] });
    expect(c!.estimate!.evidence?.speed).toMatchObject({ source: 'healthConnect', used: true, kmh: 5.4 });
    expect(c!.estimate!.booked.domainFlags).toContain('hcSpeed');
  });

  it('a GPS minute the server did not accept never reaches the estimator', async () => {
    const [c] = await importOnce({ gaugeSessions: [session('walk')], minutes: [day({ gpsSpeedMps: inRun<number | null>(1.4, null), gpsSpeedAccepted: inRun(false, false) })] });
    expect(c!.estimate!.evidence?.speed).toMatchObject({ source: 'gaugeGps', used: false, reason: 'speedNotAccepted', kmh: null });
  });
});

describe('the ring\'s sport windows feed the detector\'s telemetry branch', () => {
  it('a window on its own becomes a ring telemetry candidate (medium confidence, type to review)', async () => {
    const docs = await importOnce({ telemetry: [{ id: 'sport:1', revision: 'r1', start: ms(Y, 20), end: ms(Y, 20.25) }], minutes: [day({ steps: Array.from({ length: N }, () => null) })] });
    const tele = docs.find((d) => d.refs.includes('ring:sport:1'));
    expect(tele).toBeDefined();
    expect(tele!.sources[0]).toMatchObject({ source: 'ringTelemetry', confidence: 'medium' });
    expect(tele!.suggested.needsReview).toBe(true);
  });
});

describe('activityInput: GPS minutes, sport windows and the resting-HR fallback', () => {
  const start = localToInstant(TODAY, 4, TZ);
  const timeline = {
    start, steps: { selected: [10, 20, 30, 40] }, hr: { bpm: [null, null, null, null], supportedS: [null, null, null, null] }, sleep: { stage: [null, null, null, null] }, hc: null,
    gps: { speedMps: [1.4, 13.5, null, 200], accepted: [true, false, false, true], session: ['w', 'w', null, 'w'] },
  };
  const workouts = {
    sessions: [{ id: 'w-bike', type: 'gym', start: new Date(ms(TODAY, 8)).toISOString(), end: new Date(ms(TODAY, 8.5)).toISOString(), updatedAt: '2026-10-21T03:00:00Z' }],
    sportWindows: [
      { id: 'sport:in', revision: 'a', start: new Date(ms(TODAY, 8.1)).toISOString(), end: new Date(ms(TODAY, 8.4)).toISOString(), points: 100, workoutId: 'w-bike' },
      { id: 'sport:alone', revision: 'b', start: new Date(ms(TODAY, 18)).toISOString(), end: new Date(ms(TODAY, 18.2)).toISOString(), points: 60, workoutId: null },
    ],
  };
  const baselines = (ringReady: boolean) =>
    adaptBaselines({
      date: TODAY, usualOnset: null, usualWake: null, usualMidpoint: null,
      sleepLowHr: { medianBpm: 52, s: 3, n: ringReady ? 10 : 3, spanDays: ringReady ? 12 : 3, ready: ringReady },
      hrvBaseline: null, tempBaseline: null, learning: { nights: 3, needed: 7, learning: true },
      restingHrFallback: ringReady ? null : { source: 'healthConnect', origins: ['com.example.watch'], medianBpm: 58, s: 3, n: 9, spanDays: 12, ready: true, label: 'Resting HR from Health Connect' },
    });
  const api = (ringReady: boolean) => ({ timeline: async (date: string) => (date === TODAY ? timeline : null), workouts: async () => workouts, baselines: async () => baselines(ringReady) }) as unknown as GaugeApi;

  it('the timeline\'s GPS speed arrives per minute with its quality (out of range and unaccepted minutes are not accepted)', async () => {
    const input = (await activityInput(api(true), Y, TODAY, TODAY))!;
    const m = input.minutes.find((x) => x.first === Date.parse(start))!;
    expect(m.gpsSpeedMps).toEqual([1.4, 13.5, null, null]);
    expect(m.gpsSpeedAccepted).toEqual([true, false, false, false]);
  });

  it('only the sport window outside every Gauge workout reaches the detector', async () => {
    const input = (await activityInput(api(true), Y, TODAY, TODAY))!;
    expect(input.telemetry).toEqual([{ id: 'sport:alone', revision: 'b', start: ms(TODAY, 18), end: ms(TODAY, 18.2) }]);
  });

  it('the ring\'s sleeping low wins when ready; otherwise Health Connect\'s resting HR, labelled', async () => {
    const ring = (await activityInput(api(true), Y, TODAY, TODAY))!;
    expect(ring).toMatchObject({ sleepingLowHr: 52 });
    expect(ring.sleepingLowHrSource).toBeUndefined();
    const hc = (await activityInput(api(false), Y, TODAY, TODAY))!;
    expect(hc).toMatchObject({ sleepingLowHr: 58, sleepingLowHrSource: 'healthConnect' });
    expect(restingProxyOf(baselines(false))).toEqual({ bpm: 58, source: 'healthConnect' });
    // a fallback that is not ready stands for nothing
    expect(restingProxyOf({ ...baselines(false), restingHrFallback: { ...baselines(false).restingHrFallback!, ready: false } })).toBeNull();
  });

  it('the candidate keeps where its sleeping low came from', async () => {
    const docs = await importOnce({ gaugeSessions: [session('walk')], minutes: [day()], sleepingLowHr: 58, sleepingLowHrSource: 'healthConnect' });
    expect(docs[0]).toMatchObject({ sleepingLowHr: 58, sleepingLowHrSource: 'healthConnect' });
  });
});

describe('a night from Health Connect keeps its lineage in the sleep log', () => {
  it('the Health Connect night carries hc-other:<origin>; the ring\'s night carries none', async () => {
    const { planGaugeImport } = await import('@/living/gaugeImport');
    const plan = planGaugeImport({
      entries: [], steps: [], tz: 'Asia/Kolkata', today: '2026-10-21', now: '2026-10-21T12:00:00.000Z',
      sleep: [
        { wakingDate: '2026-10-20', start: '2026-10-19T17:30:00.000Z', end: '2026-10-19T23:30:00.000Z', asleepMinutes: 340 },
        { wakingDate: '2026-10-21', start: '2026-10-20T17:30:00.000Z', end: '2026-10-21T00:30:00.000Z', asleepMinutes: 390, origin: 'com.example.watch' },
      ],
    });
    const nights = plan.create.filter((c) => c.stream === 'sleep').map((c) => c.entry as unknown as { date: string; source: { sources?: string[] } });
    expect(nights.find((e) => e.date === '2026-10-21')!.source.sources).toEqual(['hc-other:com.example.watch']);
    expect(nights.find((e) => e.date === '2026-10-20')!.source.sources).toBeUndefined();
  });
});
