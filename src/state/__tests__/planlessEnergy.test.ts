/**
 * Energy by kind without a plan (0.6.3, Today in Planning mode): `loadTodayEnergySteps` runs the habitual day from Your
 * body through the same chain as a plan's today (`todayActual` → one engine day → `energyToday`). No plan figure; without
 * the body basics there is no run and the model says why. The engine run is stubbed here (its own tests cover the math);
 * what is checked is what it is asked to run and how its hours are read.
 */
import { freshState } from '@/commands/__tests__/harness';
import { mintWriteToken } from '@/store';
import { addDays, localToInstant } from '@/living';
import type { EnergyHour } from '@/living/sensors/energyDay';
import type { DayTemplate, Schedule } from '@/engine';
import { loadTodayEnergySteps } from '../livingActivity';
import { selectBodyValues, useProfileStore } from '../profileStore';
import { buildPersonProfile } from '@/features/body/model';
import { resolveProfile } from '@/engine/core/resolveProfile';
import { getDocumentStore } from '../runtime';
import { withSystemWrite } from '../scope';
import { useSettingsStore } from '../settingsStore';

const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/** 24 hours from `dayStart`, `kcal` each (rmr 60 %, neat 25 % with half of it steps, tef 10 %, exercise 5 %). */
function hours(dayStart: number, kcal = 100): EnergyHour[] {
  return Array.from({ length: 24 }, (_, k) => ({ start: dayStart + k * 3_600_000, rmr: 0.6 * kcal, tef: 0.1 * kcal, neat: 0.25 * kcal, stepsEnergy: 0.125 * kcal, exerciseEnergy: 0.05 * kcal, tdee: kcal }));
}

interface Call {
  kind: string;
  profile: { body?: { heightCm?: number; weightKg?: number; ageYears?: number; sex?: string } };
  schedule: Schedule;
  todayIdx: number;
  dayStart: number;
}

async function load(nowMs: number) {
  const calls: Call[] = [];
  const model = await loadTodayEnergySteps({
    now: () => nowMs,
    runHours: async (kind, profile, schedule, todayIdx, dayStart) => {
      calls.push({ kind, profile: profile as Call['profile'], schedule: schedule as Schedule, todayIdx, dayStart });
      return hours(dayStart);
    },
  });
  return { model, calls };
}

describe('energy by kind without a plan (0.6.3)', () => {
  beforeEach(() => freshState({ cleared: true }));

  it('runs the habitual day from Your body: one engine day, so far and likely by bedtime, no plan figure', async () => {
    withSystemWrite(() => useProfileStore.setState({ sex: 'male', ageYears: 38, heightCm: 180, weightKg: 92, setup: 'done' }));
    const { currentDay } = await import('@/commands');
    const now = Date.now();
    const today = currentDay(now);
    const { model, calls } = await load(now);

    expect(model).not.toBeNull();
    expect(model!.planless).toBe(true);
    expect(model!.energyMissing).toBeNull();
    // one run, of today only, on the person's own body, its hour 0 at local midnight
    expect(calls).toHaveLength(1);
    const c = calls[0]!;
    expect(c.kind).toBe('realised');
    expect(c.todayIdx).toBe(0);
    expect(c.dayStart).toBe(Date.parse(localToInstant(today, 0, tz)));
    expect(c.profile.body).toMatchObject({ heightCm: 180, weightKg: 92, ageYears: 38, sex: 'male' });
    expect(c.schedule).toMatchObject({ startDate: today, horizonDays: 1, days: [{ program: 0 }] });
    const t: DayTemplate = c.schedule.programs[0]!;
    // the habitual day at maintenance, with no implicit training: only what was approved or logged is exercise
    const maintenance = resolveProfile(buildPersonProfile(selectBodyValues(useProfileStore.getState()))).tdee0Kcal;
    expect(t.energy.kind).toBe('kcal');
    expect(t.energy.kind === 'kcal' ? t.energy.kcal : 0).toBeCloseTo(maintenance, -1);
    expect(t.habitualTraining).toBe(false);
    expect(t.exercise ?? []).toEqual([]);
    // the habitual steps as the named prior of the day (nothing observed here)
    expect(model!.steps.rxSteps).toBeGreaterThan(0);
    expect(model!.steps.goal.source).not.toBe('plan');

    // the figures are the run's: likely by bedtime = the day's total; so far = the hours before now
    const e = model!.energy!;
    expect(e.byBedtime).toBeCloseTo(2400, 6);
    expect(e.soFar).toBeGreaterThanOrEqual(0);
    expect(e.soFar).toBeLessThanOrEqual(e.byBedtime);
    expect(e.plan).toBeNull();
    expect(e.planActive).toBeNull();
  });

  it('the real engine: the habitual day’s total is the person’s maintenance, give or take the day’s own steps', async () => {
    withSystemWrite(() => useProfileStore.setState({ sex: 'male', ageYears: 38, heightCm: 180, weightKg: 92, setup: 'done' }));
    const kinds: EnergyHour[][] = [];
    const model = await loadTodayEnergySteps({
      runHours: async (_kind, profile, schedule, todayIdx, dayStart) => {
        // the engine itself (the harness's simulation client is a stand-in that returns no hours)
        const { simulate } = await import('@/engine');
        const { hoursFromRun } = await import('@/living/sensors/energyDay');
        const r = simulate(profile as Parameters<typeof simulate>[0], schedule as Schedule, { record: 'full', series: ['rmr', 'tef', 'neat', 'stepsEnergy', 'exerciseEnergy', 'tdee'] });
        const h = hoursFromRun(r.hourly as never, todayIdx * 24, 24, dayStart);
        kinds.push(h);
        return h;
      },
    });
    const maintenance = resolveProfile(buildPersonProfile(selectBodyValues(useProfileStore.getState()))).tdee0Kcal;
    const e = model!.energy!;
    expect(e.byBedtime).toBeGreaterThan(0.75 * maintenance);
    expect(e.byBedtime).toBeLessThan(1.25 * maintenance);
    // every kind is there: resting energy every hour, food digestion, movement
    const day = kinds[0]!;
    expect(day.every((h) => h.rmr > 0)).toBe(true);
    expect(day.reduce((a, h) => a + h.tef, 0)).toBeGreaterThan(0);
    expect(day.reduce((a, h) => a + h.neat, 0)).toBeGreaterThan(0);
  });

  it('without the body basics there is no run, and the model says what is missing', async () => {
    const { model, calls } = await load(Date.now());
    expect(calls).toHaveLength(0);
    expect(model!.planless).toBe(true);
    expect(model!.energyMissing).toBe('profile');
    expect(model!.energy).toBeNull();
  });

  it('quiet mode: no energy at all (no calorie talk), the steps stay', async () => {
    withSystemWrite(() => useProfileStore.setState({ sex: 'female', ageYears: 35, heightCm: 165, weightKg: 62, setup: 'done' }));
    withSystemWrite(() => useSettingsStore.setState({ quietMode: true, quietModeSet: true }));
    const { model, calls } = await load(Date.now());
    expect(calls).toHaveLength(0);
    expect(model!.energy).toBeNull();
    expect(model!.steps.goal.value).toBeGreaterThan(0);
  });

  it('an ended plan is no plan: the habitual day again', async () => {
    withSystemWrite(() => useProfileStore.setState({ sex: 'female', ageYears: 35, heightCm: 165, weightKg: 62, setup: 'done' }));
    const store = getDocumentStore();
    await store.ready;
    const { currentDay } = await import('@/commands');
    const startDate = addDays(currentDay(), -30);
    const id = '01JABCDEFGHJKMNPQRSTVWXY77';
    const profile = { schemaVersion: 1 as const, body: { sex: 'female' as const, ageYears: 35, heightCm: 165, weightKg: 62 }, startDate };
    const prog = { id: 'A', label: 'day', energy: { kind: 'kcal' as const, kcal: 1900 }, macros: { protein: { unit: 'g' as const, value: 120 }, carbs: { unit: 'g' as const, value: 180 }, fat: { unit: 'remainder' as const } }, steps: 9000 };
    await store.transact(mintWriteToken('migration', { label: 'seed' }), async (tx) => {
      await tx.put('plans', { _id: id, name: 'P', rung: 'medium', origin: { kind: 'planner', requestHash: 'h', runAt: `${startDate}T06:00:00.000Z` }, status: 'ended', startDate, plannedEndDate: addDays(startDate, 14), request: { profile, goals: [], horizonDays: 14 }, baselineProfile: profile, headVersion: 1, pauses: [], intentions: {}, policy: { checkInWeekday: 0, autoApplyLoadLowering: true }, createdAt: `${startDate}T06:00:00.000Z` });
      await tx.append('planVersions', { _id: `${id}:v1`, planId: id, version: 1, parent: null, status: 'adopted', reason: 'start', effectiveFromDay: 0, schedule: { schemaVersion: 1, startDate, horizonDays: 14, programs: [prog], days: Array.from({ length: 14 }, () => ({ program: 0 })) }, genome: null, sessions: {}, sensitivities: { planVersion: 'v', itemWeights: {}, intentByItem: {} }, forecast: { fromDay: 0, asPrescribed: {}, realistic: {}, goals: [], warnings: [] }, explanation: [], provenance: { engineVersion: 'e', registryHash: 'r', catalogueVersion: 'c' }, createdBy: { kind: 'system' }, createdAt: `${startDate}T06:00:00.000Z` });
      await tx.put('activePlan', { _id: 'me', planId: id, since: startDate });
    });
    const { model, calls } = await load(Date.now());
    expect(model!.planless).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.schedule.horizonDays).toBe(1);
  });
});
