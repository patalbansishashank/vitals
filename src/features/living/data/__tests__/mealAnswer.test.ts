/**
 * A meal's answer (As planned · Partly · Skipped) is one change for that meal only, on the real engine (documents and the
 * command bus, as in the app) and on the stand-in alike:
 * - LIVING-01: a typed partial meal answered "As planned" reads the plan, not the plan on top (430 → 1 332, never
 *   1 762); asking again with what was read before changes nothing; one serving of an accepted recipe is one entry;
 *   Undo restores the typed meal and all of its parts; a refused answer leaves the meal as it was.
 * - LIVING-02: Partly or Skipped on a blank meal is kept for that slot (it survives a fresh read), invents no food, and
 *   leaves the other meals open; Undo restores the answer before; the whole-day mark still answers every meal.
 */
import { freshState } from '@/commands/__tests__/harness';
import { defineCommand, getCommand, settleCommits } from '@/commands';
import { addDays, type LocalDate, type TodayView } from '@/living';
import { currentDay, fixedClock, systemClock } from '../../clock';
import { slotEntries } from '../../food/slots';
import { todayRows } from '../../today/model';
import type { LivingActions, MealServing } from '../actions';
import { createCommandLivingActions } from '../commands';
import { createDocumentLivingSource } from '../documents';
import { FIXTURE_TODAY, fixturePlan } from '../fixtures';
import type { LivingDataSource } from '../source';
import { createStubLiving, fixedPlanControl } from '../stub';
import { seedPlanDocs } from '../../__tests__/seedPlanDocs';

interface World {
  date: LocalDate;
  source: LivingDataSource;
  actions: LivingActions;
  /** Wait for writes to reach the read side. */
  settle(): Promise<void>;
  /** A second reader over the same data (a reload). */
  reread(): LivingDataSource;
}

async function engine(): Promise<World> {
  freshState({ cleared: true });
  const date = currentDay(systemClock);
  // a plan a few days old: two quiet weeks would put Today in minimal mode, which shows no meal rows
  await seedPlanDocs({ startDate: addDays(date, -3) });
  const source = createDocumentLivingSource();
  return { date, source, actions: createCommandLivingActions(source), settle: () => settleCommits(), reread: () => createDocumentLivingSource() };
}

async function standIn(): Promise<World> {
  const stub = createStubLiving({ clock: fixedClock(`${FIXTURE_TODAY}T13:00:00`), plan: fixedPlanControl(fixturePlan(FIXTURE_TODAY)) });
  return { date: FIXTURE_TODAY, source: stub.source, actions: stub.actions, settle: async () => undefined, reread: () => stub.source };
}

const view = (w: World): TodayView => w.source.today(w.date)!;
const meals = (w: World) => view(w).prescription!.meals;
const kcalIn = (v: TodayView, slot: string) => slotEntries(v, slot).reduce((sum, e) => sum + (e.energyKcal?.value ?? 0), 0);
const statusOf = (v: TodayView, slot: string) => todayRows(v).find((r) => r.id === `meal:${slot}`)?.status;
const mealCount = (v: TodayView) => v.logged.entries.filter((e) => e.kind === 'meal').length;
const replacesOf = (w: World, slot: string) => slotEntries(view(w), slot).map((e) => e.id);

/** A typed meal of `kcal` for the slot (what the manual logger writes): two parts, so a restore must bring both. */
async function typed(w: World, slot: string, clockH: number, kcal: number): Promise<void> {
  const o = await w.actions.logMeal(w.date, {
    slot,
    clockH,
    components: [
      { name: 'poha', energyKcal: kcal - 130, proteinG: 8, carbG: 50, fatG: 10 },
      { name: 'chai', energyKcal: 130, proteinG: 4, carbG: 15, fatG: 5 },
    ],
  });
  expect(o.ok).toBe(true);
  await w.settle();
}

describe.each([
  ['the real engine', engine],
  ['the stand-in', standIn],
] as const)('a meal’s answer on %s', (_name, make) => {
  it('"As planned" over a typed partial meal reads the plan, not both; again changes nothing; Undo restores the typed meal', async () => {
    const w = await make();
    const [first] = meals(w);
    const slot = first!.slot;
    await typed(w, slot, first!.clockH, 430);
    expect(kcalIn(view(w), slot)).toBeCloseTo(430, 0);
    const before = replacesOf(w, slot);
    expect(before).toHaveLength(1);

    const o = await w.actions.answerMeal(w.date, { slot, mark: 'asPlanned', replaces: before });
    expect(o).toMatchObject({ ok: true });
    await w.settle();
    expect(kcalIn(view(w), slot)).toBeCloseTo(first!.energyKcal, 0);
    expect(slotEntries(view(w), slot)).toHaveLength(1);
    expect(statusOf(view(w), slot)).toBe('done');

    // the same answer made from the old read (a second tap, a stale screen) is refused and adds nothing
    expect((await w.actions.answerMeal(w.date, { slot, mark: 'asPlanned', replaces: before })).ok).toBe(false);
    await w.settle();
    expect(kcalIn(view(w), slot)).toBeCloseTo(first!.energyKcal, 0);
    expect(mealCount(view(w))).toBe(1);

    expect((await o.undo!()).ok).toBe(true);
    await w.settle();
    const restored = slotEntries(view(w), slot);
    expect(restored).toHaveLength(1);
    expect(restored[0]!.label).toBe('poha, chai');
    expect(kcalIn(view(w), slot)).toBeCloseTo(430, 0);
    expect(statusOf(view(w), slot)).toBe('partial');
  }, 30_000);

  it('"As planned" by an accepted recipe logs exactly one serving of it', async () => {
    const w = await make();
    const [first] = meals(w);
    const serving: MealServing = { name: 'Rajma chawal', energyKcal: 880, proteinG: 32, carbG: 120, fatG: 24 };
    await typed(w, first!.slot, first!.clockH, 430);
    const o = await w.actions.answerMeal(w.date, { slot: first!.slot, mark: 'asPlanned', replaces: replacesOf(w, first!.slot), serving });
    expect(o.ok).toBe(true);
    await w.settle();
    const now = slotEntries(view(w), first!.slot);
    expect(now).toHaveLength(1);
    expect(now[0]!.label).toBe('Rajma chawal');
    expect(now[0]!.energyKcal?.value).toBeCloseTo(880, 0);
  }, 30_000);

  it('a stale answer is refused whole: the meal keeps its food and no answer is kept', async () => {
    const w = await make();
    const [first] = meals(w);
    await typed(w, first!.slot, first!.clockH, 430);
    // the screen read the meal before this food was logged
    expect((await w.actions.answerMeal(w.date, { slot: first!.slot, mark: 'skipped', replaces: [] })).ok).toBe(false);
    await w.settle();
    expect(kcalIn(view(w), first!.slot)).toBeCloseTo(430, 0);
    expect(view(w).marks?.meals).toBeUndefined();
  }, 30_000);

  it('Partly on a blank meal is that meal’s alone, survives a fresh read, logs no food; Undo restores it', async () => {
    const w = await make();
    const [first, , last] = meals(w);
    const o = await w.actions.answerMeal(w.date, { slot: first!.slot, mark: 'partly', replaces: [] });
    expect(o.ok).toBe(true);
    await w.settle();
    for (const v of [view(w), w.reread().today(w.date)!]) {
      expect(v.marks?.meals).toEqual({ [first!.slot]: 'partly' });
      expect(statusOf(v, first!.slot)).toBe('partial');
      expect(statusOf(v, last!.slot)).toBe('empty');
      expect(v.checklist.find((c) => c.id === `meal:${last!.slot}`)?.done).toBe(false);
      expect(mealCount(v)).toBe(0);
      expect(v.logged.totals.energyKcal.value).toBe(0);
    }
    expect((await o.undo!()).ok).toBe(true);
    await w.settle();
    expect(view(w).marks?.meals).toBeUndefined();
    expect(statusOf(view(w), first!.slot)).toBe('empty');
  }, 30_000);

  it('Skipped over food skips that meal only; Undo brings the food and the answer before back', async () => {
    const w = await make();
    const [first, second] = meals(w);
    await w.actions.answerMeal(w.date, { slot: second!.slot, mark: 'partly', replaces: [] });
    await w.settle();
    await typed(w, first!.slot, first!.clockH, 430);
    const o = await w.actions.answerMeal(w.date, { slot: first!.slot, mark: 'skipped', replaces: replacesOf(w, first!.slot) });
    expect(o.ok).toBe(true);
    await w.settle();
    expect(statusOf(view(w), first!.slot)).toBe('skipped');
    expect(statusOf(view(w), second!.slot)).toBe('partial');
    expect(mealCount(view(w))).toBe(0);
    expect((await o.undo!()).ok).toBe(true);
    await w.settle();
    expect(kcalIn(view(w), first!.slot)).toBeCloseTo(430, 0);
    expect(view(w).marks?.meals).toEqual({ [second!.slot]: 'partly' });
  }, 30_000);

  it('the whole-day mark still answers every meal; a meal’s own answer stays its own', async () => {
    const w = await make();
    const [first, second] = meals(w);
    await w.actions.answerMeal(w.date, { slot: first!.slot, mark: 'skipped', replaces: [] });
    await w.settle();
    expect((await w.actions.markDay(w.date, 'asPlanned')).ok).toBe(true);
    await w.settle();
    expect(statusOf(view(w), first!.slot)).toBe('skipped');
    expect(statusOf(view(w), second!.slot)).toBe('done');
  }, 30_000);
});

describe('a meal’s answer on the real engine: a failure after the old food is removed', () => {
  it('rolls the whole answer back, so the typed meal is still there', async () => {
    const w = await engine();
    const [first] = meals(w);
    await typed(w, first!.slot, first!.clockH, 430);
    const real = getCommand('log.meal')!;
    defineCommand({ ...real, execute: () => Promise.reject(new Error('food table unavailable')) });
    try {
      expect((await w.actions.answerMeal(w.date, { slot: first!.slot, mark: 'asPlanned', replaces: replacesOf(w, first!.slot) })).ok).toBe(false);
    } finally {
      defineCommand(real);
    }
    await w.settle();
    expect(slotEntries(view(w), first!.slot).map((e) => e.label)).toEqual(['poha, chai']);
    expect(kcalIn(view(w), first!.slot)).toBeCloseTo(430, 0);
  }, 30_000);
});
