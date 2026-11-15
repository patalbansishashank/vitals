import {
  daySteps,
  dayStepsHeadline,
  importedStepsLineage,
  ownStepsEntry,
  publishedPlanSteps,
  stepsForecast,
  stepsStateWord,
  PLAN_STEPS_FRESH_MS,
  STEP_WORDS,
  type PlanSteps,
} from '../stepsHeadline';

const day = '2026-11-15';
const stepsDay = (
  headline: number,
  o: { eitherMin?: number; ringDailyTotal?: number | null; headlinePolicy?: 'atLeast' | 'located' } = {},
) => ({
  headline,
  headlinePolicy: o.headlinePolicy ?? ('atLeast' as const),
  ringDailyTotal: o.ringDailyTotal ?? null,
  coverage: { ringMin: 0, phoneMin: 0, eitherMin: o.eitherMin ?? 600, unknownMin: 0 },
});
const local = (ringSteps: number) => ({ today: { date: day, ringSteps, ringStepsAt: null } }) as never;
/** Today's plan steps model: an entry so far, the plan's 10 000 and half the awake day ahead. */
const plan = (fusedSoFar: number | null, lineages: readonly string[], o: Partial<PlanSteps> = {}): PlanSteps => {
  const rxSteps = 10_000;
  const remainingAwakeFrac = 0.5;
  const prior = fusedSoFar === null ? rxSteps : rxSteps * remainingAwakeFrac;
  return {
    fusedSoFar,
    lineages,
    headlinePolicy: 'atLeast',
    rxSteps,
    remainingAwakeFrac,
    prior,
    total: fusedSoFar === null ? prior : fusedSoFar + prior,
    ...o,
  };
};

describe('one steps headline for Today and Ring', () => {
  it('a past day, or today without a plan entry, is the Ring pipeline as it always was', () => {
    expect(dayStepsHeadline({ date: day, isToday: false, stepsDay: stepsDay(9100), plan: plan(8000, ['user']) })?.value).toBe(9100);
    expect(dayStepsHeadline({ date: day, isToday: false, fused: 7200, ringSteps: 7000 })?.value).toBe(7200);
    expect(dayStepsHeadline({ date: day, isToday: false, ringSteps: 7000 })).toEqual({ value: 7000, lineage: 'ring' });
    expect(dayStepsHeadline({ date: day, isToday: true, stepsDay: stepsDay(6400), plan: plan(null, []) })?.value).toBe(6400);
    expect(dayStepsHeadline({ date: day, isToday: true, stepsDay: stepsDay(6400), local: local(7300), ringSteps: 6400 })).toEqual({
      value: 7300,
      lineage: 'fused',
      provisional: true,
    });
  });

  it('on today the plan entry is the count, never swapped for the server headline it is not the same count as', () => {
    // the person's own entry (or the Coach's log)
    expect(daySteps({ date: day, isToday: true, stepsDay: stepsDay(6400), plan: plan(3000, ['user']) })).toMatchObject({
      headline: { value: 3000 },
      own: true,
    });
    // an import under "Placed in time", or with small-hours steps booked to yesterday: the plan's count stands
    expect(dayStepsHeadline({ date: day, isToday: true, stepsDay: stepsDay(9000), plan: plan(7500, ['ring:band'], { headlinePolicy: 'located' }) })?.value).toBe(7500);
    expect(dayStepsHeadline({ date: day, isToday: true, stepsDay: stepsDay(6400), plan: plan(5100, ['ring:band', 'phone:pedometer']) })?.value).toBe(5100);
  });

  it('this phone’s newer ring steps go on top of an imported entry only', () => {
    const input = { date: day, isToday: true, stepsDay: stepsDay(6400, { ringDailyTotal: 6000 }), local: local(6300) };
    expect(dayStepsHeadline({ ...input, plan: plan(6400, ['ring:band']) })).toEqual({ value: 6700, lineage: 'fused', provisional: true });
    expect(dayStepsHeadline({ ...input, plan: plan(3000, ['user']) })).toEqual({ value: 3000, lineage: 'fused' });
    expect(dayStepsHeadline({ ...input, plan: plan(6100, ['ring:band'], { headlinePolicy: 'located' }) })?.value).toBe(6100);
    // the server's ring total unknown: nothing to measure the phone's lead against
    expect(dayStepsHeadline({ date: day, isToday: true, local: local(6300), plan: plan(6400, ['ring:band']) })?.value).toBe(6400);
  });

  it('an import that located no steps is still the import, not the person’s entry', () => {
    expect(ownStepsEntry([])).toBe(false);
    expect(ownStepsEntry(['user'])).toBe(true);
    expect(ownStepsEntry(['ai'])).toBe(true);
    expect(ownStepsEntry(['device'])).toBe(false);
    const r = daySteps({ date: day, isToday: true, stepsDay: stepsDay(0, { ringDailyTotal: 0 }), local: local(350), plan: plan(0, []) });
    expect(r).toMatchObject({ headline: { value: 350, provisional: true }, own: false });
  });

  it('nothing observed is no reading, never zero; the counted minutes are the last resort', () => {
    expect(dayStepsHeadline({ date: day, isToday: false, stepsDay: stepsDay(0, { eitherMin: 0 }) })).toBeNull();
    expect(dayStepsHeadline({ date: day, isToday: false, stepsDay: stepsDay(0, { eitherMin: 0 }), counted: 120 })?.value).toBe(120);
    expect(dayStepsHeadline({ date: day, isToday: true })).toBeNull();
  });

  it('the forecast is the model’s own total with an entry, and only the share still ahead without one', () => {
    expect(stepsForecast(4000, plan(4000, ['ring']))).toBe(9000);
    // moved by the phone's newer steps
    expect(stepsForecast(4300, plan(4000, ['ring']))).toBe(9300);
    // no entry: the prior covers the whole awake day, so it is not added to a reading on top
    expect(stepsForecast(6400, plan(null, []))).toBe(11_400);
    expect(stepsForecast(null, plan(4000, ['ring']))).toBeNull();
    expect(stepsForecast(4000, plan(4000, ['ring'], { rxSteps: null, prior: 0 }))).toBeNull();
    expect(daySteps({ date: day, isToday: false, stepsDay: stepsDay(4000), plan: plan(4000, ['ring']) }).likely).toBeNull();
  });

  it('Movement uses Today’s published model while it is fresh; past that only the person’s own entry', () => {
    const now = Date.parse('2026-11-15T14:00:00Z');
    const imported = { date: day, plan: plan(5100, ['ring']), at: now - 60_000 };
    expect(publishedPlanSteps(imported, day, now)).toBe(imported.plan);
    expect(publishedPlanSteps(imported, '2026-11-14', now)).toBeNull();
    expect(publishedPlanSteps({ ...imported, at: now - PLAN_STEPS_FRESH_MS - 1 }, day, now)).toBeNull();
    const own = { date: day, plan: plan(3000, ['user']), at: now - 3 * 3_600_000 };
    expect(publishedPlanSteps(own, day, now)).toBe(own.plan);
    expect(publishedPlanSteps(null, day, now)).toBeNull();
  });

  it('the same state words on both screens, with no digit', () => {
    expect(stepsStateWord(null, 10_000, { isToday: true })).toBe(STEP_WORDS.none);
    expect(STEP_WORDS.none).toBe('No reading');
    expect(stepsStateWord(10_000, 10_000, { isToday: false })).toBe('Goal met');
    expect(stepsStateWord(4000, 10_000, { isToday: false })).toBe('Short of the goal');
    expect(stepsStateWord(4000, 10_000, { isToday: true })).toBe('Building');
    expect(stepsStateWord(4000, 10_000, { isToday: true, likely: 11_000 })).toBe('On course');
    expect(stepsStateWord(4000, 10_000, { isToday: true, likely: 8000 })).toBe('Likely under');
  });

  it('tells the ring import from the person’s own entry by its lineages', () => {
    expect(importedStepsLineage(['ring:band', 'phone:pedometer'])).toBe(true);
    expect(importedStepsLineage(['ring'])).toBe(true);
    expect(importedStepsLineage(['hc-other'])).toBe(true);
    expect(importedStepsLineage(['user'])).toBe(false);
    expect(importedStepsLineage(['ai'])).toBe(false);
  });
});
