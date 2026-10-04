import { describe, expect, it } from 'vitest';
import {
  catalogueDoseLine,
  convertDose,
  defaultDose,
  doseUnits,
  emptySection,
  newRow,
  presetState,
  removeRow,
  setRowDose,
  setRowState,
  supplementBriefing,
  supplementGrade,
  supplementPlannerInputs,
  suggestible,
  timeOfDayOfClock,
  toSectionV2,
  toggleTime,
  upsertRow,
  validateDose,
  SUPPLEMENT_STATES,
  type SupplementRow,
  type SupplementsSectionV2,
} from '.';

const creatine = (o: Partial<SupplementRow> = {}): SupplementRow => ({ supplementId: 'creatine_monohydrate', state: 'taking', dose: 5, unit: 'g', timesOfDay: ['morning'], ...o });
const sec = (stance: SupplementsSectionV2['stance'], rows: SupplementRow[] = []): SupplementsSectionV2 => ({ _v: 2, stance, rows });

describe('migration v1 → v2', () => {
  it('maps the old "I already take some" answer (open + taking[]) to stance taking with taking rows', () => {
    const v2 = toSectionV2({ stance: 'open', taking: [{ supplementId: 'creatine_monohydrate', dose: 5, unit: 'g', clockH: 8 }, { supplementId: 'whey_protein', dose: 25, unit: 'g protein', clockH: 19 }] });
    expect(v2).toEqual({
      _v: 2,
      stance: 'taking',
      rows: [
        { supplementId: 'creatine_monohydrate', state: 'taking', dose: 5, unit: 'g', timesOfDay: ['morning'] },
        { supplementId: 'whey_protein', state: 'taking', dose: 25, unit: 'g', timesOfDay: ['evening'] },
      ],
    });
  });
  it('keeps open (no list) and food first', () => {
    expect(toSectionV2({ stance: 'open', taking: [] })).toEqual(sec('open'));
    expect(toSectionV2({ stance: 'food_first', taking: [] })).toEqual(sec('food_first'));
  });
  it('clock hour boundaries: < 11 morning, < 16 midday, < 21 evening, else night', () => {
    expect([0, 10.9, 11, 15.9, 16, 20.9, 21, 23.5, 24].map(timeOfDayOfClock)).toEqual(['morning', 'morning', 'midday', 'midday', 'evening', 'evening', 'night', 'night', 'morning']);
  });
  it('an entry without a clock hour has no time; malformed entries are dropped; garbage reads as unanswered', () => {
    expect(toSectionV2({ stance: 'open', taking: [{ supplementId: 'psyllium', dose: 5, unit: 'g' }, { dose: 1 }] })?.rows).toEqual([{ supplementId: 'psyllium', state: 'taking', dose: 5, unit: 'g', timesOfDay: [] }]);
    expect(toSectionV2(null)).toBeNull();
    expect(toSectionV2('x')).toBeNull();
    expect(toSectionV2({ _v: 2, stance: 'nope', rows: [] })).toBeNull();
  });
  it('reads v2 as is, cleaning rows (unknown state → unknown, times in order)', () => {
    const v = toSectionV2({ _v: 2, stance: 'onHand', rows: [{ supplementId: null, text: ' ashwagandha gummies ', state: 'weird', timesOfDay: ['night', 'morning', 'noon'] }] });
    expect(v).toEqual(sec('onHand', [{ supplementId: null, text: 'ashwagandha gummies', state: 'unknown', timesOfDay: ['morning', 'night'] }]));
  });
});

describe('state transitions', () => {
  it('every state reaches every other state; taking fills a missing dose, other states keep dose and times', () => {
    for (const from of SUPPLEMENT_STATES)
      for (const to of SUPPLEMENT_STATES) {
        const r = setRowState(creatine({ state: from }), to);
        expect(r.state).toBe(to);
        expect(r.dose).toBe(5);
        expect(r.timesOfDay).toEqual(['morning']);
      }
    const bare: SupplementRow = { supplementId: 'creatine_monohydrate', state: 'onHand', timesOfDay: [] };
    expect(setRowState(bare, 'taking')).toMatchObject({ dose: 3, unit: 'g', state: 'taking' });
  });
  it('since is set on entering taking (when a date is given) and dropped on leaving', () => {
    const t = setRowState(creatine({ state: 'onHand' }), 'taking', '2026-10-02');
    expect(t.since).toBe('2026-10-02');
    expect(setRowState(t, 'onHand').since).toBeUndefined();
    expect(setRowState(t, 'taking')).toBe(t);
  });
  it('new rows preset their state from the stance and their dose from the catalogue', () => {
    expect(presetState('onHand')).toBe('onHand');
    expect(presetState('taking')).toBe('taking');
    expect(newRow({ supplementId: 'whey' }, 'onHand')).toEqual({ supplementId: 'whey_protein', state: 'onHand', dose: 25, unit: 'g', timesOfDay: [] });
    expect(newRow({ supplementId: 'caffeine' }, 'taking')).toEqual({ supplementId: 'caffeine', state: 'taking', unit: 'mg', timesOfDay: [] });
    expect(newRow({ text: 'shilajit' }, 'taking')).toEqual({ supplementId: null, text: 'shilajit', state: 'taking', unit: 'g', timesOfDay: [] });
  });
  it('time toggles keep the day order; dose edits keep a valid unit', () => {
    let r = creatine({ timesOfDay: [] });
    r = toggleTime(toggleTime(toggleTime(r, 'night'), 'morning'), 'midday');
    expect(r.timesOfDay).toEqual(['morning', 'midday', 'night']);
    expect(toggleTime(r, 'midday').timesOfDay).toEqual(['morning', 'night']);
    expect(setRowDose(r, 2, 'IU').unit).toBe('g');
    expect(setRowDose(r, 1, 'scoop')).toMatchObject({ dose: 1, unit: 'scoop' });
    expect(setRowDose(r, undefined).dose).toBeUndefined();
  });
  it('upsert replaces by catalogue id or typed text; remove deletes', () => {
    let s = upsertRow(emptySection('taking'), creatine());
    s = upsertRow(s, creatine({ dose: 3 }));
    s = upsertRow(s, { supplementId: null, text: 'Shilajit', state: 'onHand', timesOfDay: [] });
    s = upsertRow(s, { supplementId: null, text: 'shilajit', state: 'notForMe', timesOfDay: [] });
    expect(s.rows.map((r) => [r.supplementId ?? r.text, r.state, r.dose])).toEqual([
      ['creatine_monohydrate', 'taking', 3],
      ['shilajit', 'notForMe', undefined],
    ]);
    expect(removeRow(s, { supplementId: 'creatine_monohydrate' }).rows).toHaveLength(1);
  });
});

describe('dose validation (units per catalogue)', () => {
  it('units come from the catalogue unit plus the forms the item is sold in', () => {
    expect(doseUnits('creatine_monohydrate')).toEqual(['g', 'scoop']);
    expect(doseUnits('whey_protein')).toEqual(['g', 'scoop']);
    expect(doseUnits('caffeine')).toEqual(['mg', 'tablet']);
    expect(doseUnits('vitamin_d3')).toEqual(['IU', 'µg', 'tablet', 'capsule']);
    expect(doseUnits('dietary_nitrate')).toEqual(['mmol', 'ml']);
    expect(doseUnits(null)).toContain('capsule');
    expect(defaultDose('sodium_bicarbonate')).toEqual({ unit: 'g' });
    expect(catalogueDoseLine('creatine_monohydrate')).toBe('3–5 g a day');
  });
  it('taking needs an amount and a time; on hand needs neither', () => {
    expect(validateDose(creatine()).ok).toBe(true);
    expect(validateDose(creatine({ dose: undefined })).issues.map((i) => i.code)).toEqual(['noDose']);
    expect(validateDose(creatine({ timesOfDay: [] })).issues.map((i) => i.code)).toEqual(['noTime']);
    expect(validateDose(creatine({ state: 'onHand', dose: undefined, timesOfDay: [] })).ok).toBe(true);
    expect(validateDose(creatine({ state: 'notForMe', timesOfDay: [] })).ok).toBe(true);
  });
  it('rejects zero, negative, implausible amounts and a unit the item is not sold in', () => {
    expect(validateDose(creatine({ dose: 0 })).issues[0]!.code).toBe('notPositive');
    expect(validateDose(creatine({ dose: -2 })).issues[0]!.code).toBe('notPositive');
    expect(validateDose(creatine({ dose: 900 })).issues[0]!.code).toBe('tooLarge');
    expect(validateDose(creatine({ unit: 'IU' })).issues[0]!.code).toBe('unit');
    expect(validateDose(creatine({ unit: 'mg', dose: 5000 })).issues[0]!.code).toBe('unit');
  });
  it('above the upper limit is a warning, not an error; the daily amount counts every time of day', () => {
    const d = (dose: number, unit: string, times: SupplementRow['timesOfDay']) => validateDose({ supplementId: 'vitamin_d3', state: 'taking', dose, unit, timesOfDay: times });
    expect(d(2000, 'IU', ['morning']).issues).toEqual([]);
    const two = d(2500, 'IU', ['morning', 'night']);
    expect(two.ok).toBe(true);
    expect(two.issues).toEqual([expect.objectContaining({ kind: 'warning', code: 'aboveUpperLimit' })]);
    expect(d(125, 'µg', ['morning']).issues[0]?.code).toBe('aboveUpperLimit');
    expect(convertDose(100, 'µg', 'IU', 'vitamin_d3')).toBe(4000);
    expect(convertDose(1, 'g', 'mg')).toBe(1000);
    expect(convertDose(1, 'scoop', 'g')).toBeNull();
  });
});

describe('planner inputs per state', () => {
  it('open with no rows is exactly the v1 request (creatine)', () => {
    expect(supplementPlannerInputs(sec('open'))).toEqual({ optInLevers: ['creatine'], excludedLevers: [], habitual: [], onHand: [] });
    expect(supplementPlannerInputs(sec('food_first')).optInLevers).toEqual([]);
    expect(supplementPlannerInputs(null).optInLevers).toEqual([]);
  });
  it('taking: consented and habitual', () => {
    const p = supplementPlannerInputs(sec('taking', [creatine(), { supplementId: 'omega3_epa_dha', state: 'taking', dose: 1, unit: 'g', timesOfDay: ['evening'] }]));
    expect(p).toEqual({ optInLevers: ['creatine', 'omega3'], excludedLevers: [], habitual: ['L7', 'L8'], onHand: [] });
  });
  it('onHand: consented, no purchase', () => {
    const p = supplementPlannerInputs(sec('onHand', [creatine({ state: 'onHand' }), { supplementId: 'psyllium', state: 'onHand', timesOfDay: [] }]));
    expect(p).toEqual({ optInLevers: ['creatine', 'fibre'], excludedLevers: [], habitual: [], onHand: ['L7', 'L9'] });
  });
  it('notForMe: refused even when the stance is open', () => {
    const p = supplementPlannerInputs(sec('open', [creatine({ state: 'notForMe' })]));
    expect(p).toEqual({ optInLevers: [], excludedLevers: ['L7'], habitual: [], onHand: [] });
  });
  it('unknown rows and display-only items do not change the request', () => {
    expect(supplementPlannerInputs(sec('open', [creatine({ state: 'unknown' }), { supplementId: 'whey_protein', state: 'taking', dose: 25, unit: 'g', timesOfDay: ['morning'] }]))).toEqual({ optInLevers: ['creatine'], excludedLevers: [], habitual: [], onHand: [] });
  });
  it('cards are suggested only for the open stance and never for an item already listed', () => {
    expect(suggestible(sec('open', [creatine({ state: 'notForMe' })]))).toEqual({ allowed: true, skip: new Set(['creatine_monohydrate']) });
    expect(suggestible(sec('taking')).allowed).toBe(false);
  });
});

describe('Coach briefing fields', () => {
  it('carries taking with dose, on hand (suggest before buying) and not for me (never suggest)', () => {
    const b = supplementBriefing(
      sec('taking', [creatine({ timesOfDay: ['morning', 'night'] }), { supplementId: 'whey_protein', state: 'onHand', dose: 25, unit: 'g', timesOfDay: [] }, { supplementId: 'caffeine', state: 'notForMe', timesOfDay: [] }, { supplementId: null, text: 'shilajit', state: 'onHand', timesOfDay: [] }]),
    );
    expect(b.taking).toEqual(['Creatine monohydrate (5 g · morning, night)']);
    expect(b.onHand).toEqual(['Whey protein', 'shilajit']);
    expect(b.notForMe).toEqual(['Caffeine']);
    expect(b.text).toContain('suggest using these before anything that must be bought');
    expect(b.text).toContain('never suggest');
    expect(b.lines).toHaveLength(3);
    expect(supplementBriefing(null).text).toBeNull();
  });
  it('the evidence badge is the best grade with an effect', () => {
    expect(supplementGrade('creatine_monohydrate')).toMatch(/^[A-D]$/);
    expect(supplementGrade(null)).toBeNull();
  });
});
