// @vitest-environment node
/**
 * The rule context (SUITE_SPEC §13.5.3): sex not given takes the more cautious value of every sex-specific threshold,
 * and the one builder (`markerRuleContext`) fills the fields the app holds (supplements, medicines, diet kind, plan
 * start) so the rules gated on them fire; what it cannot fill stays unresolved.
 */
import { describe, expect, it } from 'vitest';
import type { PersonProfile } from '@/engine/types/profile';
import { markerContextFields, markerRuleContext } from '../context';
import { isStale, readingFromInput } from '../doc';
import { evaluateMarkers, ruleContextFrom } from '../rules';
import type { MarkerReadingInput, MarkersDoc, RuleContext } from '../types';

const TODAY = '2026-10-02';
const DATE = '2026-09-12';

const doc = (inputs: MarkerReadingInput[]): MarkersDoc => ({
  _schema: 1,
  readings: inputs.map((i) => readingFromInput(i, 'manual', `${DATE}T09:00:00Z`)),
  displayOnly: [],
  context: {},
  chapter: 'manual',
});
const ctxOf = (sex: RuleContext['sex']): RuleContext => ({ sex, today: TODAY, defaultDeficitCapPct: 25 });
const fired = (d: MarkersDoc, c: RuleContext): string[] => evaluateMarkers(d, c).notes.map((n) => n.rule);

describe('sex not given: the more cautious threshold', () => {
  it('Hb low uses the higher WHO cut-off (13 g/dL)', () => {
    const d = doc([{ id: 'hb', value: 12.5, unit: 'g/dL', date: DATE }]);
    expect(fired(d, ctxOf('female'))).not.toContain('W-L-HB-1');
    expect(fired(d, ctxOf('male'))).toContain('W-L-HB-1');
    expect(fired(d, ctxOf('unknown'))).toContain('W-L-HB-1');
  });

  it('ALT uses the lower healthy limit (25 U/L) and the message names it', () => {
    const d = doc([{ id: 'alt', value: 28, unit: 'U/L', date: DATE }]);
    expect(fired(d, ctxOf('male'))).not.toContain('W-L-ALT-1');
    const ev = evaluateMarkers(d, ctxOf('unknown'));
    const note = ev.notes.find((n) => n.rule === 'W-L-ALT-1');
    expect(note?.text).toContain('healthy limit of 25 U/L');
  });

  it('a sex-specific cap takes the lower value (alcohol 20 g a day)', () => {
    const d = doc([{ id: 'alt', value: 40, unit: 'U/L', date: DATE }]);
    const lock = (sex: RuleContext['sex']) => evaluateMarkers(d, ctxOf(sex)).safety.plannerLocks.find((l) => l.id === 'alcohol-cap')?.value;
    expect(lock('male')).toBe(30);
    expect(lock('female')).toBe(20);
    expect(lock('unknown')).toBe(20);
    expect(evaluateMarkers(d, ctxOf('unknown')).notes.find((n) => n.rule === 'W-L-ALT-2')?.text).toContain('alcohol to 20 g a day');
  });

  it('a rule limited to one sex applies (HDL 45 mg/dL: the women\'s threshold fires)', () => {
    const d = doc([{ id: 'hdl', value: 45, unit: 'mg/dL', date: DATE }]);
    expect(fired(d, ctxOf('male'))).not.toContain('W-L-HDL-2');
    expect(fired(d, ctxOf('unknown'))).toContain('W-L-HDL-2');
  });

  it('the profile builder gives unknown for "prefer not to say" and for no sex', () => {
    const body = { sex: 'female', ageYears: 40, heightCm: 170, weightKg: 70 } as unknown as PersonProfile['body'];
    expect(ruleContextFrom({ body, sexUnspecified: true }, TODAY).sex).toBe('unknown');
    expect(ruleContextFrom(undefined, TODAY).sex).toBe('unknown');
    expect(ruleContextFrom({ body }, TODAY).sex).toBe('female');
  });
});

describe('markerRuleContext fills what the app holds', () => {
  const LOW_FERRITIN = doc([{ id: 'ferritin', value: 20, unit: 'ng/mL', date: DATE }]);
  const TSH = doc([{ id: 'tsh', value: 12, unit: 'µIU/mL', date: DATE }]);

  it('a supplement-gated rule fires when calcium is taken, and stays unresolved when supplements are unanswered', () => {
    const none = evaluateMarkers(LOW_FERRITIN, markerRuleContext({}, TODAY));
    expect(none.notes.map((n) => n.rule)).not.toContain('W-L-FERRITIN-5');
    expect(none.unresolved).toContainEqual({ rule: 'W-L-FERRITIN-5', field: 'supplements.calcium' });

    const taking = markerRuleContext({ supplements: { rows: [{ supplementId: 'calcium', state: 'taking' }] } }, TODAY);
    expect(evaluateMarkers(LOW_FERRITIN, taking).notes.map((n) => n.rule)).toContain('W-L-FERRITIN-5');

    const atHome = markerRuleContext({ supplements: { rows: [{ supplementId: 'calcium', state: 'onHand' }] } }, TODAY);
    const ev = evaluateMarkers(LOW_FERRITIN, atHome);
    expect(ev.notes.map((n) => n.rule)).not.toContain('W-L-FERRITIN-5');
    expect(ev.unresolved.map((u) => u.rule)).not.toContain('W-L-FERRITIN-5');
  });

  it('free-text rows count by name; a row marked "not sure" leaves the field unknown', () => {
    expect(markerContextFields({ supplements: { rows: [{ supplementId: null, text: 'Calcium + D3', state: 'taking' }] } })['supplements.calcium']).toBe(true);
    expect(markerContextFields({ supplements: { rows: [{ supplementId: 'ashwagandha', state: 'unknown' }] } })).not.toHaveProperty('supplements.ashwagandha');
    expect(markerContextFields({ supplements: { rows: [] } })['supplements.ashwagandha']).toBe(false);
  });

  it('medication-gated rules fire from the screening medicines answer', () => {
    const thyroid = markerRuleContext({ medications: { answer: 'yes', items: ['thyroid'] } }, TODAY);
    const ids = fired(TSH, thyroid);
    expect(ids).toContain('W-L-TSH-3');
    expect(ids).not.toContain('W-L-TSH-2');

    const noMeds = markerRuleContext({ medications: { answer: 'no' } }, TODAY);
    expect(fired(TSH, noMeds)).toContain('W-L-TSH-2');
    expect(evaluateMarkers(TSH, noMeds).safety.plannerLocks.find((l) => l.id === 'max-fast')?.value).toBe(24);

    const undisclosed = evaluateMarkers(TSH, markerRuleContext({ medications: { answer: 'prefer-not' } }, TODAY));
    expect(undisclosed.unresolved).toContainEqual({ rule: 'W-L-TSH-2', field: 'conditions.thyroidTreated' });
    expect(markerContextFields({ medications: { answer: 'yes', items: ['other'] } })).not.toHaveProperty('conditions.thyroidTreated');
  });

  it('diet kind and the started plan are passed; plan levers it cannot read stay unresolved', () => {
    const c = markerRuleContext({ dietKind: 'vegetarian', plan: { status: 'active', startDate: '2026-09-01' } }, TODAY);
    expect(c.fields?.['diet.pattern']).toBe('vegetarian');
    expect(c.dietChangeDate).toBe('2026-09-01');
    expect(c.fields).not.toHaveProperty('plan.aerobic_load');
    expect(markerRuleContext({ plan: { status: 'scheduled', startDate: '2026-10-09' } }, TODAY).dietChangeDate).toBeUndefined();
    const b12 = doc([{ id: 'b12', value: 250, unit: 'pg/mL', date: DATE }]);
    expect(fired(b12, c)).toContain('W-L-B12-4');
  });

  it('diet change date: only a plan with a different diet pattern moves it; the first plan counts (§13.5)', () => {
    const plan = (startDate: string, dietPattern?: string) => ({ status: 'active', startDate, dietPattern });
    // First plan ever: its start is the change.
    expect(markerRuleContext({ plan: plan('2026-09-01', 'vegan') }, TODAY).dietChangeDate).toBe('2026-09-01');
    // Same pattern as the plan before: the earlier start stays.
    const same = markerRuleContext({ plan: plan('2026-09-01', 'vegan'), earlierPlans: [{ startDate: '2026-03-01', dietPattern: 'vegan' }] }, TODAY);
    expect(same.dietChangeDate).toBe('2026-03-01');
    // Different pattern: the new start.
    const diff = markerRuleContext({ plan: plan('2026-09-01', 'vegan'), earlierPlans: [{ startDate: '2026-03-01', dietPattern: 'omnivore' }] }, TODAY);
    expect(diff.dietChangeDate).toBe('2026-09-01');
    // The latest run only: omnivore, then vegan, vegan → the first vegan start. Unset counts as omnivore.
    const run = [{ startDate: '2025-01-01' }, { startDate: '2026-05-01', dietPattern: 'vegan' }, { startDate: '2026-01-01', dietPattern: 'vegan' }];
    expect(markerRuleContext({ plan: plan('2026-09-01', 'vegan'), earlierPlans: run }, TODAY).dietChangeDate).toBe('2026-01-01');
    expect(markerRuleContext({ plan: plan('2026-09-01'), earlierPlans: [{ startDate: '2026-02-01', dietPattern: 'omnivore' }] }, TODAY).dietChangeDate).toBe('2026-02-01');
  });

  it('a lipid reading 3+ months old stays live across a re-plan with the same diet pattern', () => {
    const ldl = { ...doc([{ id: 'ldl', value: 4.5, unit: 'mmol/L', date: '2026-04-01' }]).readings[0]! };
    const today = '2026-09-15';
    const same = markerRuleContext({ plan: { status: 'active', startDate: '2026-09-01' }, earlierPlans: [{ startDate: '2026-02-01' }] }, today);
    const diff = markerRuleContext({ plan: { status: 'active', startDate: '2026-09-01', dietPattern: 'vegan' }, earlierPlans: [{ startDate: '2026-02-01' }] }, today);
    expect(isStale(ldl, today, same.dietChangeDate)).toBe(false);
    expect(isStale(ldl, today, diff.dietChangeDate)).toBe(true);
  });
});
