/**
 * r069 D4: the day Energy page reads a past day through `loadDayEnergy`: without a plan, Today's planless chain on that
 * date (Your body's person, the habitual day of that weekday, the day's own entries as the whole actual day), one engine
 * day whose hour 0 is that date's local midnight; the day's done sessions are its bouts (the treadmill desk logged by hand
 * holds its own minutes). Without the body basics there is no run and it says why; today and later are Today's run, not
 * this one; quiet mode runs nothing. The engine run is stubbed (its own tests cover the math).
 */
import { freshState } from '@/commands/__tests__/harness';
import { mintWriteToken } from '@/store';
import { addDays, localToInstant } from '@/living';
import type { EnergyHour } from '@/living/sensors/energyDay';
import type { Schedule } from '@/engine';
import { clearDayEnergyRuns, kindsOfHours, loadDayEnergy, loadPeriodEnergy } from '../livingActivity';
import { useProfileStore } from '../profileStore';
import { getDocumentStore } from '../runtime';
import { withSystemWrite } from '../scope';
import { useSettingsStore } from '../settingsStore';

const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const hours = (dayStart: number): EnergyHour[] =>
  Array.from({ length: 24 }, (_, k) => ({
    start: dayStart + k * 3_600_000,
    rmr: 60,
    tef: 10,
    neat: 25,
    stepsEnergy: 12,
    exerciseEnergy: 5,
    tdee: 100,
  }));

async function seedDesk(date: string): Promise<void> {
  const store = getDocumentStore();
  await store.ready;
  const start = localToInstant(date as never, 15.05, tz);
  const end = new Date(Date.parse(start) + 30 * 60_000).toISOString();
  await store.transact(mintWriteToken('migration', { label: 'seed' }), async (tx) => {
    await tx.append('dailyLogs', {
      _id: '01JABCDEFGHJKMNPQRSTVWXYD1',
      date,
      tz,
      at: end,
      recordedAt: end,
      kind: 'session',
      status: 'done',
      startH: 15.05,
      durationMin: 30,
      performed: [{ exerciseId: 'treadmill_desk_slow', minutes: 30 }],
      stimulus: {},
      engine: [
        {
          kind: 'cardio',
          modality: 'walk',
          startH: 15.05,
          durationMin: 30,
          met: 2.8,
          sessionId: 'desk',
          boutId: 'desk',
        },
      ],
      cost: {
        grossKcal: 113,
        ownRestKcal: 35,
        netAboveRestKcal: 78,
        displacedLifestyleKcal: 7,
        incrementalKcal: 71,
        method: 'compendiumMet',
        source: 'estimated',
        envelope: { lo: 79, hi: 147 },
      },
      physicalBoutId: 'desk',
      source: { by: 'user', method: 'typed' },
      occurrence: {
        precision: 'interval',
        interval: { start, end },
        dateMeaning: 'appDay',
        source: 'user',
        tz,
        date,
      },
    });
  });
}

describe('r069 D4: a past day’s energy', () => {
  beforeEach(() => {
    freshState({ cleared: true });
    clearDayEnergyRuns();
  });

  it('no plan: the habitual day of that date on Your body, its hour 0 at local midnight, the hand log as a bout', async () => {
    withSystemWrite(() =>
      useProfileStore.setState({ sex: 'male', ageYears: 28, heightCm: 166, weightKg: 75.5, setup: 'done' }),
    );
    const { currentDay } = await import('@/commands');
    const today = currentDay(Date.now());
    const date = addDays(today, -2);
    await seedDesk(date);
    const calls: Array<{ schedule: Schedule; idx: number; dayStart: number }> = [];
    const r = await loadDayEnergy(date, {
      runHours: async (_k, _p, schedule, idx, dayStart) => {
        calls.push({ schedule: schedule as Schedule, idx, dayStart });
        return hours(dayStart);
      },
    });
    expect(r).not.toBeNull();
    expect(r!.basis).toBe('body');
    expect(r!.energyBasis).toEqual({ weightKg: 75.5, formula: 'Mifflin–St Jeor' });
    expect(r!.missing).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.schedule).toMatchObject({ startDate: date, horizonDays: 1 });
    expect(calls[0]!.idx).toBe(0);
    expect(calls[0]!.dayStart).toBe(Date.parse(localToInstant(date as never, 0, tz)));
    expect(calls[0]!.schedule.programs[0]!.habitualTraining).toBe(false);
    expect(r!.hours).toHaveLength(24);
    // the treadmill desk logged by hand holds its own 30 minutes
    expect(r!.bouts).toHaveLength(1);
    expect(r!.bouts[0]!.window.end - r!.bouts[0]!.window.start).toBe(30 * 60_000);
    expect(r!.bouts[0]!.window.start).toBe(Date.parse(localToInstant(date as never, 15.05, tz)));
  });

  it('without the body basics there is no run, and it says why; today is not this loader’s; quiet runs nothing', async () => {
    const { currentDay } = await import('@/commands');
    const today = currentDay(Date.now());
    let ran = 0;
    const runHours = async (_k: string, _p: unknown, _s: unknown, _i: number, d: number) => {
      ran++;
      return hours(d);
    };
    const r = await loadDayEnergy(addDays(today, -1), { runHours });
    expect(r).toMatchObject({ hours: null, missing: 'profile', basis: 'body' });
    expect(await loadDayEnergy(today, { runHours })).toBeNull();
    withSystemWrite(() =>
      useProfileStore.setState({ sex: 'male', ageYears: 28, heightCm: 166, weightKg: 75.5, setup: 'done' }),
    );
    withSystemWrite(() => useSettingsStore.setState({ quietMode: true, quietModeSet: true }));
    expect(await loadDayEnergy(addDays(today, -1), { runHours })).toMatchObject({
      hours: null,
      missing: null,
    });
    expect(ran).toBe(0);
  });

  it('a period: each past day from the run its day view reads (once), today left to Today’s run', async () => {
    withSystemWrite(() =>
      useProfileStore.setState({ sex: 'male', ageYears: 28, heightCm: 166, weightKg: 75.5, setup: 'done' }),
    );
    const { currentDay } = await import('@/commands');
    const today = currentDay(Date.now());
    const dates = [addDays(today, -3), addDays(today, -2), addDays(today, -1), today];
    await seedDesk(dates[1]!);
    let runs = 0;
    const runHours = async (_k: string, _p: unknown, schedule: unknown, _i: number, dayStart: number) => {
      runs++;
      // a day with an activity burns more: its template carries the session
      const busy =
        JSON.stringify(schedule).includes('treadmill') || JSON.stringify(schedule).includes('"exercise":[{');
      return hours(dayStart).map((h) => ({ ...h, tdee: busy ? 110 : 100, exerciseEnergy: busy ? 15 : 5 }));
    };
    const r = await loadPeriodEnergy(dates, { runHours });
    expect(r.missing).toBeNull();
    expect(r.days.map((d) => d.date)).toEqual(dates.slice(0, 3));
    expect(runs).toBe(3);
    expect(r.days.every((d) => d.kcal !== null && d.kinds !== null)).toBe(true);
    // the kinds add up to the day
    for (const d of r.days)
      expect(Object.values(d.kinds!).reduce((a, b) => a + b, 0)).toBeCloseTo(d.kcal!, 6);
    for (const d of r.days) {
      expect(Object.values(d.components!).reduce((a, b) => a + b, 0)).toBeCloseTo(d.kcal!, 6);
      expect(d.energyBasis).toEqual({ weightKg: 75.5, formula: 'Mifflin–St Jeor' });
      expect(d.envelope!.lo).toBeLessThan(d.kcal!);
      expect(d.envelope!.hi).toBeGreaterThan(d.kcal!);
    }
    // the day view reads the very same run (no new run, the same total)
    const one = await loadDayEnergy(dates[1]!, { runHours });
    expect(runs).toBe(3);
    expect(one!.hours!.reduce((a, h) => a + h.tdee, 0)).toBe(r.days[1]!.kcal);
    expect(kindsOfHours(one!.hours!)).toEqual(r.days[1]!.kinds);
  });
});
