/**
 * V3 state side (energy SPEC §V3.6, V4 hooks): the Gauge import reads the fused `/steps` headline with its lineages and
 * hands workouts, Health Connect sessions and recent minute timelines to `activity.fromGauge`; the review-sheet and
 * today's energy-and-steps models read what the commands wrote.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { GaugeApi, GaugeSteps } from '@/net/gauge';
import { dispatch, settleCommits } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { mintWriteToken } from '@/store';
import { addDays, DEFAULT_ITEM_WEIGHTS, localToInstant, type PlanDoc, type PlanVersionDoc } from '@/living';
import { getDocumentStore } from '../runtime';
import { activityInput, dayHrExact, fusedStepsDays, runGaugeImport } from '../gaugeImport';
import { loadTodayEnergySteps, reviewSheetNow } from '../livingActivity';

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

describe('fused steps rows', () => {
  it('take the D3 headline, the fused day and the lineages of that date', () => {
    const fused: GaugeSteps = {
      fusionVersion: 'steps-fuse/1',
      intervals: [
        { start: localToInstant('2026-10-20', 8, TZ), end: localToInstant('2026-10-20', 9, TZ), steps: 4000, source: 'phone', lineage: 'phone', support: 'minute', selectionReason: 'soleSustainedGait', alternatives: [] },
        { start: localToInstant('2026-10-20', 12, TZ), end: localToInstant('2026-10-20', 13, TZ), steps: 3000, source: 'ring', lineage: 'ring', support: 'minute', selectionReason: 'preference', alternatives: [] },
      ],
      days: [{ date: '2026-10-20', located: 7000, ringDailyTotal: 8000, ringResidual: 1000, headline: 8000, headlinePolicy: 'atLeast', coverage: { ringMin: 600, phoneMin: 60, eitherMin: 620, unknownMin: 820 } }],
    } as unknown as GaugeSteps;
    expect(fusedStepsDays(fused, TZ)).toEqual([
      { date: '2026-10-20', steps: 8000, fusion: { version: 'steps-fuse/1', located: 7000, headlinePolicy: 'atLeast', ringDailyTotal: 8000, ringResidual: 1000, coverage: { ringMin: 600, phoneMin: 60, eitherMin: 620, unknownMin: 820 }, spans: [{ start: localToInstant('2026-10-20', 8, TZ), end: localToInstant('2026-10-20', 9, TZ) }, { start: localToInstant('2026-10-20', 12, TZ), end: localToInstant('2026-10-20', 13, TZ) }] }, sources: ['phone', 'ring'] },
    ]);
  });
});

describe('activity input', () => {
  it('maps workouts, Health Connect sessions of other apps and the recent minute timelines', async () => {
    const start = localToInstant('2026-10-20', 7, TZ);
    const end = localToInstant('2026-10-20', 7.5, TZ);
    const api = {
      workouts: async () => ({ sessions: [{ id: 'w1', date: '2026-10-20', start, end, type: 'walk', source: 'gauge', durationS: 1800, distanceM: 2400, kcal: 150, avgHr: null, maxHr: null, zones: null, steps: null, route: null, updatedAt: 'u1', pauses: [{ start, end: localToInstant('2026-10-20', 7.1, TZ) }] }] }),
      hc: async () => ({ records: [
        { id: 'h1', recordType: 'ExerciseSession', originPackage: 'com.strava', originIsDeviceNative: false, lastModified: 'm1', start, end, payload: { exercise_type: 79, route_state: 'available' } },
        { id: 'h2', recordType: 'ExerciseSession', originPackage: 'com.pulseloop', originIsDeviceNative: false, lastModified: 'm1', start, end, payload: { exercise_type: 79 } },
      ] }),
      timeline: async (date: string) => (date === '2026-10-21' ? { start: localToInstant(date, 4, TZ), steps: { selected: [10, null] }, hr: { bpm: [80, null], supportedS: [60, null] }, sleep: { stage: ['deep', null] } } : null),
    } as unknown as GaugeApi;
    const input = (await activityInput(api, '2026-10-19', '2026-10-21', '2026-10-21'))!;
    expect(input.gaugeSessions).toEqual([{ id: 'w1', revision: 'u1', start: Date.parse(start), end: Date.parse(end), type: 'walk', kcal: 150, distanceM: 2400, pauses: [{ start: Date.parse(start), end: Date.parse(localToInstant('2026-10-20', 7.1, TZ)) }] }]);
    expect(input.hcSessions).toEqual([{ id: 'h1', revision: 'm1', start: Date.parse(start), end: Date.parse(end), exerciseType: 79, originPackage: 'com.strava', hasRoute: true }]);
    expect(input.minutes).toEqual([{ first: Date.parse(localToInstant('2026-10-21', 4, TZ)), steps: [10, null], hrBpm: [80, null], hrSupportedS: [60, null], asleep: [true, false] }]);
  });
});

describe('Health Connect deletions (r063)', () => {
  it('hands the sessions Health Connect deleted (`/v1/gauge/hc` deleted) to activity.fromGauge as hc:<id> refs, once each', async () => {
    const start = localToInstant('2026-10-20', 7, TZ);
    const end = localToInstant('2026-10-20', 7.5, TZ);
    const api = {
      hc: async () => ({ records: [], deleted: [
        { id: 'h9', recordType: 'ExerciseSession', start, end, deletedAt: end }, { id: 'h9', recordType: 'ExerciseSession', start, end, deletedAt: end }, { id: '' }, null,
      ] }),
    } as unknown as GaugeApi;
    const input = (await activityInput(api, '2026-10-19', '2026-10-21', '2026-10-21'))!;
    expect(input.deletedRefs).toEqual(['hc:h9']);
    // an older server sends no deleted list: nothing is withdrawn
    const old = { hc: async () => ({ records: [] }) } as unknown as GaugeApi;
    expect((await activityInput(old, '2026-10-19', '2026-10-21', '2026-10-21'))!).not.toHaveProperty('deletedRefs');
  });
});

describe('exact HR readings for the activity import (Codex #11)', () => {
  const first = Date.parse('2026-10-21T00:00:00Z');
  // a day of 4 minutes: minutes 1 and 2 have supported HR
  const timeline = { start: new Date(first).toISOString(), steps: { selected: [null, 90, 95, null] }, hr: { bpm: [null, 120, 150, null], supportedS: [null, 60, 60, null] }, sleep: { stage: [null, null, null, null] } };
  const reading = (sec: number, bpm: number) => ({ t: first + sec * 1000, bpm, cadenceS: 10, nextT: first + (sec + 10) * 1000, start: first + (sec - 5) * 1000, end: first + (sec + 5) * 1000 });

  it('reads the span of the supported minutes (and a minute either side), clipped to the day; each reading keeps its own interval', async () => {
    const asked: Array<[string, string]> = [];
    const api = {
      hrIntervals: async (from: string, to: string) => {
        asked.push([from, to]);
        return { from, to, intervals: [reading(65, 110), reading(75, 170), reading(239, 100)], count: 3, supportedS: 30, truncated: false };
      },
    } as unknown as GaugeApi;
    const exact = await dayHrExact(api, timeline as never, first, { cached: false });
    expect(asked).toEqual([[new Date(first).toISOString(), new Date(first + 4 * 60_000).toISOString()]]);
    // the last reading's support (234–244 s) is clipped at the day's end (240 s); (r063 FX2) minute 2, which the answer
    // has no reading in, keeps its minute mean (one source-resolved rule: supported HR is never erased)
    expect(exact).toEqual([{ start: first + 60_000, end: first + 70_000, bpm: 110 }, { start: first + 70_000, end: first + 80_000, bpm: 170 }, { start: first + 120_000, end: first + 180_000, bpm: 150 }, { start: first + 234_000, end: first + 240_000, bpm: 100 }]);
  });

  it('null (minute means) without the route, after a failed or truncated read, or when the day has no supported HR', async () => {
    expect(await dayHrExact({} as GaugeApi, timeline as never, first, { cached: false })).toBeNull();
    const truncated = { hrIntervals: async () => ({ intervals: [reading(65, 110)], truncated: true }) } as unknown as GaugeApi;
    expect(await dayHrExact(truncated, timeline as never, first, { cached: false })).toBeNull();
    const failing = { hrIntervals: async () => { throw new Error('offline'); } } as unknown as GaugeApi;
    expect(await dayHrExact(failing, timeline as never, first, { cached: false })).toBeNull();
    let called = false;
    const none = { hrIntervals: async () => { called = true; return null; } } as unknown as GaugeApi;
    expect(await dayHrExact(none, { ...timeline, hr: { bpm: [null, null, null, null], supportedS: [0, 0, null, 0] } } as never, first, { cached: false })).toBeNull();
    expect(called).toBe(false);
  });

  it('(r063 FX2 sR06/aR06) a day with Health Connect minutes keeps Gauge\'s exact readings and the HC minute means', async () => {
    const mixed = { ...timeline, hr: { bpm: [null, 120, 150, null], supportedS: [null, 60, 60, null], source: [null, 'gauge', 'hc:com.example', null] } };
    const asked: Array<[string, string]> = [];
    const api = { hrIntervals: async (from: string, to: string) => { asked.push([from, to]); return { from, to, intervals: [reading(65, 110), reading(75, 170)], count: 2, supportedS: 20, truncated: false }; } } as unknown as GaugeApi;
    const exact = await dayHrExact(api, mixed as never, first, { cached: false });
    // only the Gauge minute's span is asked for; the HC minute stays its mean (never replaced by Gauge's empty answer)
    expect(asked).toEqual([[new Date(first).toISOString(), new Date(first + 3 * 60_000).toISOString()]]);
    expect(exact).toEqual([{ start: first + 60_000, end: first + 70_000, bpm: 110 }, { start: first + 70_000, end: first + 80_000, bpm: 170 }, { start: first + 120_000, end: first + 180_000, bpm: 150 }]);
  });

  it('activityInput hands the exact readings to activity.fromGauge with the day they belong to', async () => {
    const today = '2026-10-21';
    const api = {
      workouts: async () => ({ sessions: [] }),
      timeline: async (date: string) => (date === today ? { ...timeline, start: localToInstant(today, 0, TZ) } : null),
      hrIntervals: async (from: string, to: string) => ({ from, to, intervals: [{ ...reading(65, 110), t: Date.parse(localToInstant(today, 0, TZ)) + 65_000, start: Date.parse(localToInstant(today, 0, TZ)) + 60_000, end: Date.parse(localToInstant(today, 0, TZ)) + 70_000, nextT: null }], count: 1, supportedS: 10, truncated: false }),
    } as unknown as GaugeApi;
    const input = (await activityInput(api, today, today, today))!;
    const d0 = Date.parse(localToInstant(today, 0, TZ));
    expect(input.minutes).toEqual([{ first: d0, steps: [null, 90, 95, null], hrBpm: [null, 120, 150, null], hrSupportedS: [null, 60, 60, null], asleep: [false, false, false, false], hrExact: [{ start: d0 + 60_000, end: d0 + 70_000, bpm: 110 }, { start: d0 + 120_000, end: d0 + 180_000, bpm: 150 }] }]);
  });
});

describe('the import run and the V4 models', () => {
  beforeEach(async () => {
    freshState({ cleared: true });
  });

  it('runs the activity import after the steps and sleep, and the review sheet shows the result', async () => {
    const today = addDays(new Date().toISOString().slice(0, 10), 0);
    const y = addDays(today, -1);
    const start = localToInstant(y, 7, TZ);
    const end = localToInstant(y, 7.75, TZ);
    const api = {
      activity: async () => ({ days: [] }),
      sleep: async () => ({ sessions: [] }),
      workouts: async () => ({ sessions: [{ id: 'w1', date: y, start, end, type: 'walk', source: 'gauge', durationS: 2700, distanceM: null, kcal: 180, avgHr: null, maxHr: null, zones: null, steps: null, route: null, updatedAt: 'u1' }] }),
      status: () => ({ lastOkAt: null, problem: null }),
    } as unknown as GaugeApi;
    const m = new Map<string, string>();
    const storage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    const r = await runGaugeImport({
      api,
      enabled: () => true,
      today: () => today,
      now: () => Date.now(),
      storage,
      importer: async () => ({ created: [], skipped: [] }),
      activityImporter: async (input) => {
        const x = await dispatch('activity.fromGauge', input, { actor: { kind: 'system', id: 'gauge-import' } });
        await settleCommits();
        return x.ok && 'output' in x ? (x.output as { created: unknown[]; updated: unknown[] }) : null;
      },
    });
    expect(r).toMatchObject({ ran: true, activities: { created: 1, updated: 0 } });
    const sheet = reviewSheetNow({ from: y, to: y });
    expect(sheet.rows).toHaveLength(1);
    expect(sheet.rows[0]).toMatchObject({ exerciseId: 'walk', minutes: 45, status: 'pending' });
    expect(sheet.strip?.count).toBe(1);
  });

  it('today’s energy and steps come from the realised today run, with the steps prior named', async () => {
    const store = getDocumentStore();
    await store.ready;
    const today = new Date().toISOString().slice(0, 10);
    const startDate = addDays(today, -3);
    const profile = { schemaVersion: 1 as const, body: { sex: 'female' as const, ageYears: 35, heightCm: 165, weightKg: 62 }, startDate };
    const day = { id: 'A', label: 'day', energy: { kind: 'kcal' as const, kcal: 1900 }, macros: { protein: { unit: 'g' as const, value: 120 }, carbs: { unit: 'g' as const, value: 180 }, fat: { unit: 'remainder' as const } }, steps: 9000, sleep: { bedH: 23, wakeH: 7 } };
    const plan: PlanDoc = { name: 'P', rung: 'medium', origin: { kind: 'planner', requestHash: 'h', runAt: `${startDate}T06:00:00.000Z` }, status: 'active', startDate, plannedEndDate: addDays(startDate, 14), request: { profile, goals: [], horizonDays: 14 }, baselineProfile: profile, headVersion: 1, pauses: [], intentions: {}, policy: { checkInWeekday: 0, autoApplyLoadLowering: true }, createdAt: `${startDate}T06:00:00.000Z` };
    const version: PlanVersionDoc = { planId: '01JABCDEFGHJKMNPQRSTVWXY44', version: 1, parent: null, status: 'adopted', reason: 'start', effectiveFromDay: 0, schedule: { schemaVersion: 1, startDate, horizonDays: 14, programs: [day], days: Array.from({ length: 14 }, () => ({ program: 0 })) }, genome: null, sessions: {}, sensitivities: { planVersion: 'v', itemWeights: { ...DEFAULT_ITEM_WEIGHTS }, intentByItem: {} }, forecast: { fromDay: 0, asPrescribed: {}, realistic: {}, goals: [], warnings: [] }, explanation: [], provenance: { engineVersion: 'e', registryHash: 'r', catalogueVersion: 'c' }, createdBy: { kind: 'system' }, createdAt: `${startDate}T06:00:00.000Z` };
    await store.transact(mintWriteToken('migration', { label: 'seed' }), async (tx) => {
      await tx.put('plans', { ...plan, _id: '01JABCDEFGHJKMNPQRSTVWXY44' });
      await tx.append('planVersions', { ...version, _id: '01JABCDEFGHJKMNPQRSTVWXY44:v1' });
      await tx.put('activePlan', { _id: 'me', planId: '01JABCDEFGHJKMNPQRSTVWXY44', since: startDate });
    });
    const hours = (kcal: number) => Array.from({ length: 24 }, (_, h) => ({ start: h * 3_600_000, rmr: 50, tef: 8, neat: 20, stepsEnergy: 2, exerciseEnergy: 0, tdee: kcal }));
    const kinds: string[] = [];
    const m = await loadTodayEnergySteps({ runHours: async (kind) => (kinds.push(kind), hours(kind === 'realised' ? 90 : 80)) });
    expect(kinds.sort()).toEqual(['plan', 'realised']);
    expect(m).not.toBeNull();
    expect(m!.energy).toMatchObject({ byBedtime: 24 * 90, plan: 24 * 80, label: 'estimated' });
    expect(m!.steps).toMatchObject({ rxSteps: 9000, goal: { value: 9000, source: 'plan' } });
    expect(m!.steps.fusedSoFar).toBeNull();
  });
});

describe('Health Connect weight (D13)', () => {
  beforeEach(() => {
    freshState({ cleared: true });
  });

  it('lands as a device measurement once; the person’s own weigh-in of that day wins', async () => {
    const y = addDays(new Date().toISOString().slice(0, 10), -2);
    const SYS = { actor: { kind: 'system' as const, id: 'gauge-import' } };
    const w = { id: 'hcw-1', at: localToInstant(y, 7, TZ), kg: 81.2, origin: 'com.withings' };
    const r1 = await dispatch('log.fromGauge', { steps: [], sleep: [], weights: [w] }, SYS);
    await settleCommits();
    expect(r1.ok && 'output' in r1 ? (r1.output as { weights: { created: string[] } }).weights.created : null).toHaveLength(1);
    const r2 = await dispatch('log.fromGauge', { steps: [], sleep: [], weights: [w] }, SYS);
    await settleCommits();
    expect(r2.ok && 'output' in r2 ? (r2.output as { weights: { skipped: Array<{ reason: string }> } }).weights.skipped : null).toEqual([{ id: 'hcw-1', reason: 'unchanged' }]);
    await dispatch('log.measurement', { metric: 'weightKg', value: 80.5, date: addDays(y, -1) });
    await settleCommits();
    const r3 = await dispatch('log.fromGauge', { steps: [], sleep: [], weights: [{ ...w, id: 'hcw-2', at: localToInstant(addDays(y, -1), 7, TZ) }] }, SYS);
    expect(r3.ok && 'output' in r3 ? (r3.output as { weights: { skipped: Array<{ reason: string }> } }).weights.skipped : null).toEqual([{ id: 'hcw-2', reason: 'userEntry' }]);
    const m = getDocumentStore().peekAll<{ metric: string; source: { by: string } }>('measurements');
    expect(m.filter((x) => x.source.by === 'device')).toHaveLength(1);
  });
});
