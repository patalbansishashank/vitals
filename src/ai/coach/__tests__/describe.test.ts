import { describe, expect, it } from 'vitest';
import { logCard, proposalCard } from '../cards';
import { describeInput } from '../describe';

const AT = '2026-10-02T09:00:00';
const TODAY = '2026-10-02';
/** A camelCase word (`setHorizon`, `startDate`) or a JSON brace: neither may reach a card. */
const RAW = /\b[a-z]+[A-Z][A-Za-z]*\b|[{}"]/;

const texts = (items: Array<{ label: string; before: string | null; after: string | null }>) => items.flatMap((i) => [i.label, i.before ?? '', i.after ?? '']);
const expectPlain = (items: Array<{ label: string; before: string | null; after: string | null }>) => {
  expect(items.length).toBeGreaterThan(0);
  for (const t of texts(items)) expect(t).not.toMatch(RAW);
};

const GOAL_OPS = [
  { op: 'add', goal: { key: 'fatMass', metric: 'fatMass', mode: 'lose', amount: 6, strength: 'must', functional: 'end' } },
  { op: 'remove', key: 'leanTissue' },
  { op: 'move', from: 1, to: 0 },
  { op: 'update', key: 'fatMass', patch: { mode: 'lose', amount: 4, strength: 'should', functional: 'mean' } },
  { op: 'setHorizon', days: 90 },
  { op: 'setStartDate', date: '2026-10-05' },
  { op: 'setStartDate', date: null },
  {
    op: 'setLimits',
    patch: { trainingDays: [3, 4], trainingWeekdays: [0, 2, 4], trainingTimeH: 18, maxSessionMin: 60, cardioDays: [1, 2], cardioModality: 'cycling', earliestH: 8, latestH: 20, mealsPerDay: [2, 3], steps: [8000, 10000], longestFastH: 24, prefersFasting: true, excluded: ['refeedDay'], proteinFloor: 1.6, carbFloorG: 50, sleepFixed: true, hungerTolerance: 'low', someNewLimit: 1 },
  },
  { op: 'resetLimits' },
  { op: 'setStrictness', value: 'balanced' },
  { op: 'setSuggested', record: { suggestion: {}, at: AT, provenance: { source: 'rule', version: 'v1' }, goalKeys: ['fatMass'] } },
  { op: 'setSuggested', record: null },
  { op: 'someFutureOp', fooBar: 1 },
];

const PLAN_INPUTS: Record<string, unknown> = {
  'plan.start': { source: { rung: 'hard' }, startDate: TODAY, name: 'Coach: hard', intentions: { weighInClockH: 7, trainingWeekdays: [0, 3], missedSessionPlan: 'nextDay' }, checkInWeekday: 0 },
  'plan.replace': { source: { scenarioId: 's1' }, startDate: '2026-10-05', reason: 'replaced' },
  'plan.end': { reason: 'completed', note: 'done' },
  'plan.pause': { from: TODAY, until: '2026-10-09', reason: 'holiday' },
  'plan.resume': { from: TODAY },
  'plan.declareEvent': { kind: 'socialMeal', from: '2026-10-04', to: '2026-10-04', extraCarbG: 150 },
  'plan.shift': { from: '2026-10-03', days: 3, mode: 'noTraining', absorb: { date: '2026-10-04', extraKcal: 600 }, replanRest: true },
  'plan.editDay': { date: '2026-10-06', patch: { energyKcal: 1800, exercise: [] }, scope: 'weekday' },
  'plan.replan': { reason: 'travel', tier: 'M' },
  'plan.swapExercise': { date: TODAY, slotKey: 'a1', from: 'barbell-back-squat', to: 'legPress', everyWeek: true },
};

describe('Coach change cards in plain words (Q4-13)', () => {
  it('a goal and its time frame read as one sentence', () => {
    const card = logCard('c1', 'Edit the goal set', { ops: [GOAL_OPS[0], { op: 'setHorizon', days: 90 }] }, null, { createdAt: AT, state: 'applied', commandId: 'goals.edit' });
    expect(card.items).toEqual([{ label: 'goal', before: null, after: 'Lose 6 kg of fat in 90 days (a must)' }]);
  });

  it('every goals.edit op renders without op or field names', () => {
    for (const op of GOAL_OPS) expectPlain(describeInput('goals.edit', { ops: [op] }, TODAY));
    expect(describeInput('goals.edit', { ops: [{ op: 'setHorizon', days: 90 }] }, TODAY)[0]!.after).toBe('Plan over 90 days');
    expect(describeInput('goals.edit', { ops: [{ op: 'remove', key: 'fatMass' }] }, TODAY)[0]!.after).toBe('Remove the fat goal');
  });

  it('the plan.start proposal says which plan starts when', () => {
    const card = proposalCard('c2', 'Start a plan', PLAN_INPUTS['plan.start'], null, { createdAt: AT, commandId: 'plan.start' });
    expect(card.items[0]).toEqual({ label: 'plan', before: null, after: 'Start the Hard plan today' });
    expect(card.items.map((i) => i.after)).not.toContain('Coach: hard');
    expect(describeInput('plan.start', { source: { rung: 'easy' }, startDate: '2026-10-05' }, TODAY)[0]!.after).toBe('Start the Easy plan on 5 Oct');
  });

  it('every plan command the Coach uses renders without field names or ids', () => {
    for (const [id, input] of Object.entries(PLAN_INPUTS)) {
      const items = describeInput(id, input, TODAY);
      expectPlain(items);
      for (const t of texts(items)) expect(t).not.toMatch(/\bs1\b|a1|rung|scenario id|slot/);
    }
    expect(describeInput('plan.swapExercise', PLAN_INPUTS['plan.swapExercise'], TODAY)[0]!.after).toBe('Swap barbell back squat for leg press every week from today');
  });

  it('unknown commands fall back to plain rows, not JSON or ids', () => {
    const items = describeInput('log.somethingNew', { idempotencyKey: 'k', attachmentId: 'a', clockH: 7, nested: { innerValue: 2 }, list: '{"a":1}' }, TODAY);
    expectPlain(items);
    expect(items.map((i) => i.label)).toEqual(['clock h', 'nested', 'list']);
  });

  it('proposal diff rows read the JSON values the re-plan stores', () => {
    const card = proposalCard('c3', 'Re-plan', {}, { diff: [{ date: '2026-10-05', field: 'energy', before: '{"kcal":1800}', after: '{"kcal":1600}' }] }, { createdAt: AT, commandId: 'plan.replan' });
    expectPlain(card.items);
    expect(card.items[0]).toEqual({ label: '5 Oct · energy', before: 'kcal 1800', after: 'kcal 1600' });
  });
});
