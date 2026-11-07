/**
 * Phase 0C consumer × provider check of the food day (C1/C3; D5-01, D6-02), on the real engine (documents and the
 * command bus, as in the app) and on the stand-in alike:
 *  - a typed energy-only meal keeps its energy exactly (no macro closure invents grams, no rescaling);
 *  - logged food alone is Partial; only the person's day report makes it Complete or a confirmed zero;
 *  - the report survives a fresh read (reload/replay) unchanged, answering again changes nothing, Undo restores
 *    "no statement" (absent), never a negative.
 */
import { freshState } from '@/commands/__tests__/harness';
import { settleCommits } from '@/commands';
import { addDays, type LocalDate, type TodayView } from '@/living';
import { currentDay, fixedClock, systemClock } from '../../clock';
import type { LivingActions } from '../../data/actions';
import { createCommandLivingActions } from '../../data/commands';
import { createDocumentLivingSource } from '../../data/documents';
import { FIXTURE_TODAY, fixturePlan } from '../../data/fixtures';
import type { LivingDataSource } from '../../data/source';
import { createStubLiving, fixedPlanControl } from '../../data/stub';
import { seedPlanDocs } from '../../__tests__/seedPlanDocs';
import { dayFoodStatus } from './TargetsFace';

interface World {
  date: LocalDate;
  source: LivingDataSource;
  actions: LivingActions;
  settle(): Promise<void>;
  reread(): LivingDataSource;
}

async function engine(): Promise<World> {
  freshState({ cleared: true });
  const date = currentDay(systemClock);
  await seedPlanDocs({ startDate: addDays(date, -3) });
  const source = createDocumentLivingSource();
  return { date, source, actions: createCommandLivingActions(source), settle: () => settleCommits(), reread: () => createDocumentLivingSource() };
}

async function standIn(): Promise<World> {
  const stub = createStubLiving({ clock: fixedClock(`${FIXTURE_TODAY}T13:00:00`), plan: fixedPlanControl(fixturePlan(FIXTURE_TODAY)) });
  return { date: FIXTURE_TODAY, source: stub.source, actions: stub.actions, settle: async () => undefined, reread: () => stub.source };
}

const view = (s: LivingDataSource, date: LocalDate): TodayView => s.today(date)!;
const mealsLogged = (v: TodayView) => v.logged.entries.filter((e) => e.kind === 'meal').length;
const status = (v: TodayView) => dayFoodStatus(mealsLogged(v) > 0, v.intake);

describe.each([
  ['the real engine', engine],
  ['the stand-in', standIn],
] as const)('the food day on %s (D5-01, D6-02)', (_name, make) => {
  it('a typed energy-only meal stays exactly as typed and reads Partial until the day report says Complete', async () => {
    const w = await make();
    expect(status(view(w.source, w.date))).toBe('Not logged');
    const o = await w.actions.logMeal(w.date, { clockH: 12.5, components: [{ name: 'thali', energyKcal: 600 }] });
    expect(o.ok).toBe(true);
    await w.settle();
    const v = view(w.source, w.date);
    expect(v.logged.totals.energyKcal.value).toBeCloseTo(600, 6);
    expect(status(v)).toBe('Partial');
    if (v.coverage) expect(v.coverage.energy).not.toBe('complete');
    if (!w.actions.confirmDayIntake) return;

    const r = await w.actions.confirmDayIntake(w.date, 'complete');
    expect(r.ok).toBe(true);
    await w.settle();
    for (const read of [view(w.source, w.date), view(w.reread(), w.date)]) {
      expect(read.intake).toBe('complete');
      expect(status(read)).toBe('Complete');
      // the realised history's energy channel follows the report (the stand-in carries no coverage)
      if (read.coverage) expect(read.coverage.energy).toBe('complete');
      // the report never rescales what was logged
      expect(read.logged.totals.energyKcal.value).toBeCloseTo(600, 6);
    }

    // answering again changes nothing; one meal, the same report
    expect((await w.actions.confirmDayIntake(w.date, 'complete')).ok).toBe(true);
    await w.settle();
    const again = view(w.reread(), w.date);
    expect(again.intake).toBe('complete');
    expect(mealsLogged(again)).toBe(1);
  }, 30_000);

  it('"No intake" is a confirmed zero only when nothing was logged; Undo restores no statement (never a negative)', async () => {
    const w = await make();
    if (!w.actions.confirmDayIntake) return;
    const r = await w.actions.confirmDayIntake(w.date, 'none');
    expect(r.ok).toBe(true);
    await w.settle();
    expect(status(view(w.reread(), w.date))).toBe('No intake');
    if (r.undo) {
      expect((await r.undo()).ok).toBe(true);
      await w.settle();
      const back = view(w.reread(), w.date);
      expect(back.intake).toBeUndefined();
      expect(status(back)).toBe('Not logged');
    }
    // with food logged, a "none" report cannot make the day a confirmed zero: the logged food stays and reads Partial
    await w.actions.confirmDayIntake(w.date, 'none');
    await w.actions.logMeal(w.date, { clockH: 9, components: [{ name: 'chai', energyKcal: 90 }] });
    await w.settle();
    expect(status(view(w.reread(), w.date))).toBe('Partial');
  }, 30_000);
});
