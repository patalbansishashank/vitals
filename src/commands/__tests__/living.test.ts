/**
 * The living-plan wiring around E5's executors: ports installed, prescriptions frozen at rollover, daily
 * assimilation after logs (with the trend kept in `derived`), and that no living-plan command is a stub any more.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { PersonProfile } from '@/engine';
import { DEFAULT_ITEM_WEIGHTS, type PlanDoc, type PlanVersionDoc } from '@/living';
import { mintWriteToken } from '@/store';
import { getDocumentStore } from '@/state/runtime';
import { currentDay, dispatch, getCommand, getPorts, runAssimilation, runRollover, settleCommits } from '..';
import { freshState } from './harness';

const PLAN_ID = '01JABCDEFGHJKMNPQRSTVWXYZ0';
const MAN: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 40, heightCm: 180, weightKg: 90 }, startDate: '2026-09-28' };
const NOW = Date.parse('2026-10-01T12:00:00.000Z');

async function seedPlan() {
  const plan: PlanDoc = {
    name: 'Medium plan', rung: 'medium', origin: { kind: 'planner', requestHash: 'h', runAt: '2026-09-27T10:00:00.000Z' }, status: 'active',
    startDate: '2026-09-28', plannedEndDate: '2026-10-26', request: { profile: MAN, goals: [], horizonDays: 28 }, baselineProfile: MAN, headVersion: 1,
    pauses: [], intentions: {}, policy: { checkInWeekday: 0, autoApplyLoadLowering: true }, createdAt: '2026-09-27T10:00:00.000Z',
  } as unknown as PlanDoc;
  const day = { id: 'A', label: 'day', energy: { kind: 'kcal' as const, kcal: 2000 }, macros: { protein: { unit: 'g' as const, value: 150 }, carbs: { unit: 'g' as const, value: 200 }, fat: { unit: 'remainder' as const } }, steps: 8000 };
  const version = {
    planId: PLAN_ID, version: 1, parent: null, status: 'adopted', reason: 'start', effectiveFromDay: 0,
    schedule: { schemaVersion: 1, startDate: '2026-09-28', horizonDays: 28, programs: [day], days: Array.from({ length: 28 }, () => ({ program: 0 })) },
    genome: null, sessions: {}, sensitivities: { planVersion: 'v1', itemWeights: { ...DEFAULT_ITEM_WEIGHTS }, intentByItem: {} },
    forecast: { fromDay: 0, asPrescribed: {}, realistic: {}, goals: [], warnings: [] }, explanation: [],
    provenance: { engineVersion: 'e', registryHash: 'r', catalogueVersion: 'c' }, createdBy: { kind: 'system' }, createdAt: '2026-09-27T10:00:00.000Z',
  } as unknown as PlanVersionDoc;
  const store = getDocumentStore();
  await store.ready;
  await store.transact(mintWriteToken('migration', { label: 'test seed' }), async (tx) => {
    await tx.put('plans', { ...plan, _id: PLAN_ID });
    await tx.append('planVersions', { ...version, _id: `${PLAN_ID}:v1` });
    await tx.put('activePlan', { _id: 'me', planId: PLAN_ID, since: '2026-09-28' });
  });
}

beforeEach(() => {
  freshState({ cleared: true });
});

describe('living-plan wiring', () => {
  it('installs the planner, session-compiler and observation ports', () => {
    const living = getPorts().living!;
    expect(typeof living.planner.replan).toBe('function');
    expect(typeof living.sessionCompiler).toBe('function');
    expect(living.observations.observations('2026-10-01', '2026-10-02')).toEqual([]);
  });

  it('implements every living-plan command (the adaptation commands are E5b’s; log.meal, log.session and log.bulk E9b’s)', () => {
    for (const id of ['plan.replan', 'plan.declareEvent', 'plan.shift', 'plan.editDay', 'plan.swapExercise', 'today.get', 'plan.start', 'plan.replace', 'plan.checkIn', 'log.measurement', 'log.fromBiometrics']) expect(getCommand(id)?.notImplemented, id).toBeUndefined();
  });

  it('rolls the day over at 04:00 local time', () => {
    expect(currentDay(Date.parse('2026-10-01T03:59:00Z'), 'UTC')).toBe('2026-09-30');
    expect(currentDay(Date.parse('2026-10-01T04:00:00Z'), 'UTC')).toBe('2026-10-01');
  });

  it('freezes each plan day up to today, once', async () => {
    await seedPlan();
    const today = currentDay(NOW);
    const frozen = await runRollover(NOW);
    expect(frozen[0]).toBe('2026-09-28');
    expect(frozen[frozen.length - 1]).toBe(today);
    const s = getDocumentStore().peek<{ prescribed: { planId: string; energyKcal: number } }>('dayStatus', `day:${today}`);
    expect(s?.prescribed.planId).toBe(PLAN_ID);
    expect(s?.prescribed.energyKcal).toBeCloseTo(2000, 0);
    expect(await runRollover(NOW)).toEqual([]);
  });

  it('assimilates after a weigh-in and keeps the trend in derived', async () => {
    await seedPlan();
    await dispatch('log.measurement', { metric: 'weightKg', value: 89.6, context: 'morningFasted', date: '2026-09-29' });
    await dispatch('log.measurement', { metric: 'weightKg', value: 89.4, context: 'morningFasted', date: '2026-09-30' });
    await settleCommits();
    const out = await runAssimilation(NOW);
    expect(out).not.toBeNull();
    const t = getDocumentStore().peek<{ planId: string; trendToday: { kg: number } | null }>('derived', `trend:${PLAN_ID}`);
    expect(t?.planId).toBe(PLAN_ID);
    expect(t?.trendToday?.kg).toBeGreaterThan(85);
  }, 20_000);

  it('log.fromBiometrics logs a day’s steps, sleep and workouts from opted-in streams once, and leaves the person’s entries alone', async () => {
    const DAY = '2026-09-30';
    const RING = 'file:canonical:ring';
    const prov = { channel: 'file:canonical', recording_method: 'automatic', modality: 'sensed', ingested_at: '2026-09-30T20:00:00.000Z', device: { type: 'ring', tier: 'B' } };
    const q = { validation: 'measured', confidence: null, flags: [] };
    const on = (stream: string) => ({ stream, imported: true, coach: 'hidden', engine: true, scores: true });
    const records = [
      { kind: 'daily', record_id: 'd-0930', version: 1, time: { tz_offset_s: 0, local_date: DAY }, provenance: prov, quality: q, steps: 9400 },
      { kind: 'sleep', record_id: 's-0930', version: 1, time: { start: '2026-09-29T23:00:00.000Z', end: '2026-09-30T06:45:00.000Z', tz_offset_s: 0, local_date: '2026-09-29' }, provenance: prov, quality: q, is_main: true, asleep_s: 7 * 3600 },
      { kind: 'workout', record_id: 'w-0930', version: 1, time: { start: '2026-09-30T18:00:00.000Z', tz_offset_s: 0, local_date: DAY }, provenance: prov, quality: q, exercise_type: 'cycling', active_duration_s: 3600, active_kcal: 520 },
    ];
    const store = getDocumentStore();
    await store.ready;
    await store.transact(mintWriteToken('migration', { label: 'test seed' }), async (tx) => {
      await tx.put('bioSources', { _id: RING, sourceKey: RING, label: 'Ring', tier: 'B', priority: 1, policies: [], baselineEpochs: [] });
      await tx.put('bioSources', { _id: 'policy:me', kind: 'personPolicy', policies: [on('steps'), on('sleep_sessions'), { ...on('workouts'), engine: false }] });
      for (const r of records) await tx.put('bioRecords', { ...r, sourceKey: RING, _id: `${r.record_id}@1` });
    });
    const run = async () => {
      const r = await dispatch('log.fromBiometrics', { date: DAY });
      if (!r.ok || !('output' in r)) throw new Error(JSON.stringify(r));
      return r.output as { created: Array<{ entryId: string; kind: string; steps?: number; wakeAt?: string; exerciseType?: string }>; skipped: Array<{ stream: string; reason: string }>; notOptedIn: string[] };
    };
    const deviceEntries = () => store.peekAll<{ date: string; kind: string; source: { by: string } }>('dailyLogs').filter((d) => d.source.by === 'device');

    const first = await run();
    expect(first.created.map((c) => c.kind)).toEqual(['steps', 'sleep']);
    expect(first.created[0]!.steps).toBe(9400);
    expect(first.notOptedIn).toEqual(['workouts']);
    await settleCommits();
    expect(deviceEntries().map((d) => [d.date, d.kind])).toEqual([[DAY, 'steps'], [DAY, 'sleep']]);

    // re-running writes nothing new
    const again = await run();
    expect(again.created).toEqual([]);
    expect(again.skipped.map((s) => s.reason)).toEqual(['unchanged', 'unchanged']);

    // undo = retract: the removed steps entry is not brought back
    expect((await dispatch('log.retract', { entryId: first.created[0]!.entryId })).ok).toBe(true);
    await settleCommits();
    expect((await run()).skipped.find((s) => s.stream === 'steps')?.reason).toBe('removed');

    // steps the person types win over the device
    expect((await dispatch('log.steps', { date: DAY, steps: 10000 })).ok).toBe(true);
    await settleCommits();
    expect((await run()).skipped.find((s) => s.stream === 'steps')?.reason).toBe('userEntry');

    // the workouts stream turned on → the ride is logged with its type, duration and energy
    await store.transact(mintWriteToken('migration', { label: 'policy' }), async (tx) => {
      await tx.put('bioSources', { _id: 'policy:me', kind: 'personPolicy', policies: [on('steps'), on('sleep_sessions'), on('workouts')] });
    });
    const ride = await run();
    expect(ride.created.map((c) => c.kind)).toEqual(['session']);
    expect(ride.created[0]).toMatchObject({ exerciseType: 'cycling', durationMin: 60, activeKcal: 520 });
    expect(ride.notOptedIn).toEqual([]);
  });
});
