/**
 * The meal sheet's selected answer is read from what was logged: As planned only for an "As planned" log or food within
 * the plan's energy tolerance (±5 %, at least ±75 kcal), Partly for less, Skipped for a skipped row, nothing otherwise.
 */
import { mealMarkOf, withinPlan, type MealLogRead } from '../mealMark';

const read = (over: Partial<MealLogRead>): MealLogRead => ({ status: 'empty', words: [], hasFood: false, loggedKcal: 0, plannedKcal: 1000, recipe: null, ...over });

describe('withinPlan', () => {
  it('uses the adherence energy tolerance: ±5 %, at least ±75 kcal', () => {
    expect(withinPlan(1075, 1000)).toBe(true);
    expect(withinPlan(924, 1000)).toBe(false);
    expect(withinPlan(2100, 2000)).toBe(true);
    expect(withinPlan(1890, 2000)).toBe(false);
    expect(withinPlan(500, 0)).toBe(false);
  });
});

describe('mealMarkOf', () => {
  it('nothing logged: the row’s own answer, else nothing', () => {
    expect(mealMarkOf(read({ status: 'empty' }))).toBeNull();
    expect(mealMarkOf(read({ status: 'skipped' }))).toBe('skipped');
    expect(mealMarkOf(read({ status: 'partial' }))).toBe('partly');
    // the day marked as planned, nothing typed
    expect(mealMarkOf(read({ status: 'done' }))).toBe('asPlanned');
    // filled in for the person: not their answer
    expect(mealMarkOf(read({ status: 'assumed' }))).toBeNull();
  });

  it('a logged entry with no row status is read by its amount, never taken as "as planned"', () => {
    expect(mealMarkOf(read({ hasFood: true, words: ['dal, rice'], loggedKcal: 430 }))).toBe('partly');
    expect(mealMarkOf(read({ hasFood: true, words: ['dal, rice'], loggedKcal: 980 }))).toBe('asPlanned');
    // more than the plan: neither answer fits
    expect(mealMarkOf(read({ hasFood: true, words: ['dal, rice'], loggedKcal: 1400 }))).toBeNull();
    // no energy known: unknown
    expect(mealMarkOf(read({ hasFood: true, words: ['dal, rice'], loggedKcal: 0 }))).toBeNull();
  });

  it('a "done" row whose food is below the plan is Partly, and food logged over a skipped row is read by amount', () => {
    expect(mealMarkOf(read({ status: 'done', hasFood: true, words: ['dal, rice, curd'], loggedKcal: 640, plannedKcal: 1332 }))).toBe('partly');
    expect(mealMarkOf(read({ status: 'skipped', hasFood: true, words: ['toast'], loggedKcal: 990 }))).toBe('asPlanned');
  });

  it('an "As planned" log is As planned, also with food added on top', () => {
    expect(mealMarkOf(read({ status: 'done', hasFood: true, words: ['as planned'], loggedKcal: 1000 }))).toBe('asPlanned');
    expect(mealMarkOf(read({ status: 'done', hasFood: true, words: ['As planned', 'biscuits'], loggedKcal: 1250 }))).toBe('asPlanned');
    // no numbers on the entry (quiet or unknown): the words still say how it was logged
    expect(mealMarkOf(read({ hasFood: true, words: ['as planned'] }))).toBe('asPlanned');
  });

  it('one serving of the accepted recipe is "as planned" even when its numbers differ from the slot’s', () => {
    const recipe = { dish: 'Rajma chawal', energyKcal: 880 };
    expect(mealMarkOf(read({ hasFood: true, words: ['Rajma chawal'], loggedKcal: 880, recipe }))).toBe('asPlanned');
    expect(mealMarkOf(read({ hasFood: true, words: ['rice bowl'], loggedKcal: 870, recipe }))).toBe('asPlanned');
    expect(mealMarkOf(read({ hasFood: true, words: ['rice bowl'], loggedKcal: 500, recipe }))).toBe('partly');
  });
});
