// @vitest-environment node
/**
 * D7-04 active-ingredient exposure: label serving arithmetic and chemical forms, schedules that keep their dose-day
 * amount, aggregation across products, upper-limit scope (supplement-only vs total intake) with unknown potency never a
 * pass, and observed taking versus on-hand stock for the planner baseline.
 */
import { describe, expect, it } from 'vitest';
import { SEED_SUPPLEMENTS } from '@/content/catalogues/supplements';
import { activeExposureFromServing, convertMass } from '@/lib/bodyContracts';
import { validateDose } from './dose';
import { UPPER_LIMITS, aggregateActives, isDoseDay, occasionActives, rowActives, rowExposureStatuses, upperLimitAssessment } from './exposure';
import { habitualCreatine, plannedCreatineG } from '@/engine/planner/domain/decode';
import { plannerHabitualActives, supplementPlannerInputs } from './planner';
import type { SupplementProduct, SupplementRow, SupplementsSectionV2 } from './types';

const row = (o: Partial<SupplementRow> & Pick<SupplementRow, 'supplementId'>): SupplementRow => ({ state: 'taking', timesOfDay: ['morning'], ...o });
const ADULT = { ageYears: 40 };
const fishOil: SupplementProduct = { servingAmount: 1, servingUnit: 'capsule', actives: [{ ingredient: 'epaDha', amount: 500, unit: 'mg', basis: 'epaDha' }], source: 'label' };

describe('label serving arithmetic and forms', () => {
  it('2 capsules × 500 mg EPA+DHA = 1 g/day only with the known label; capsules without one are potency unknown, never zero', () => {
    const labelled = rowActives(row({ supplementId: 'omega3_epa_dha', dose: 2, unit: 'capsule', product: fishOil }));
    expect(labelled).toHaveLength(1);
    expect(labelled[0]).toMatchObject({ ingredient: 'epaDha', unit: 'g', provenance: 'label' });
    expect(labelled[0]!.dailyAverage).toBeCloseTo(1, 12);
    const bare = rowActives(row({ supplementId: 'omega3_epa_dha', dose: 2, unit: 'capsule' }));
    expect(bare[0]).toMatchObject({ ingredient: 'epaDha', value: null, dailyAverage: null, reason: 'potencyUnknown' });
    // the catalogue's own unit names the active (g EPA+DHA): that amount counts
    expect(rowActives(row({ supplementId: 'omega3_epa_dha', dose: 1, unit: 'g' }))[0]!.dailyAverage).toBe(1);
  });

  it('sodium from sodium chloride by stoichiometry (≈ 393.4 mg/g), only for a known NaCl basis', () => {
    const salt: SupplementProduct = { servingAmount: 1, servingUnit: 'g', actives: [{ ingredient: 'sodium', amount: 1, unit: 'g', basis: 'sodiumChloride' }] };
    const a = occasionActives(row({ supplementId: 'electrolytes_sweat_lowcarb', dose: 1, unit: 'g', product: salt }));
    expect(a[0]!.value).toBeCloseTo((1000 * 22.98977) / 58.44277, 6);
    expect(a[0]!.value).toBeCloseTo(393.4, 1);
  });

  it('elemental vs compound mass, nitrate mmol vs salt mass, protein vs powder stay distinct', () => {
    const citrate: SupplementProduct = { servingAmount: 1, servingUnit: 'tablet', actives: [{ ingredient: 'magnesium', amount: 1000, unit: 'mg', basis: 'compound' }] };
    expect(occasionActives(row({ supplementId: 'magnesium', dose: 1, unit: 'tablet', product: citrate }))[0]).toMatchObject({ value: null, reason: 'basisNotConvertible' });
    const elemental: SupplementProduct = { servingAmount: 1, servingUnit: 'tablet', actives: [{ ingredient: 'magnesium', amount: 200, unit: 'mg', basis: 'elemental' }] };
    expect(occasionActives(row({ supplementId: 'magnesium', dose: 1, unit: 'tablet', product: elemental }))[0]).toMatchObject({ value: 200, form: 'elemental' });
    const beet: SupplementProduct = { servingAmount: 70, servingUnit: 'ml', actives: [{ ingredient: 'nitrate', amount: 6.4, unit: 'mmol', basis: 'nitrate' }] };
    expect(occasionActives(row({ supplementId: 'dietary_nitrate', dose: 70, unit: 'ml', product: beet }))[0]!.value).toBeCloseTo(6.4, 12);
    // a nitrate-ION mass converts at the declared 62.0 mg/mmol (A1-026); a nitrate salt/compound mass never does
    const nitrateMg: SupplementProduct = { servingAmount: 70, servingUnit: 'ml', actives: [{ ingredient: 'nitrate', amount: 400, unit: 'mg', basis: 'nitrate' }] };
    expect(occasionActives(row({ supplementId: 'dietary_nitrate', dose: 70, unit: 'ml', product: nitrateMg }))[0]!.value).toBeCloseTo(400 / 62, 9);
    const nitrateSalt: SupplementProduct = { servingAmount: 1, servingUnit: 'capsule', actives: [{ ingredient: 'nitrate', amount: 500, unit: 'mg', basis: 'compound' }] };
    expect(occasionActives(row({ supplementId: 'dietary_nitrate', dose: 1, unit: 'capsule', product: nitrateSalt }))[0]).toMatchObject({ value: null, reason: 'basisNotConvertible' });
    const powder: SupplementProduct = { servingAmount: 1, servingUnit: 'scoop', actives: [{ ingredient: 'protein', amount: 30, unit: 'g', basis: 'powderMass' }] };
    expect(occasionActives(row({ supplementId: 'whey_protein', dose: 1, unit: 'scoop', product: powder }))[0]!.value).toBeNull();
    const protein: SupplementProduct = { servingAmount: 1, servingUnit: 'scoop', actives: [{ ingredient: 'protein', amount: 24, unit: 'g', basis: 'protein' }] };
    expect(occasionActives(row({ supplementId: 'whey_protein', dose: 1, unit: 'scoop', product: protein }))[0]!.value).toBe(24);
    // a scoop without the exact label has no universal potency
    expect(occasionActives(row({ supplementId: 'whey_protein', dose: 1, unit: 'scoop' }))[0]).toMatchObject({ value: null, reason: 'potencyUnknown' });
  });

  it('vitamin D: 40 IU = 1 µg; calcium "mg" without a form only bounds the elemental mass from above', () => {
    expect(occasionActives(row({ supplementId: 'vitamin_d3', dose: 1000, unit: 'IU' }))[0]!.value).toBeCloseTo(25, 12);
    expect(convertMass(25, 'ug', 'mg')).toBeCloseTo(0.025, 12);
    expect(occasionActives(row({ supplementId: 'calcium', dose: 1250, unit: 'mg' }))[0]).toMatchObject({ value: null, upperBound: 1250, reason: 'basisUnknown' });
  });
});

describe('schedules keep their dose-day amount', () => {
  it('weekly vitamin D does not become daily: dose day, weekly total and average side by side', () => {
    const weekly = rowActives(row({ supplementId: 'vitamin_d3', dose: 20000, unit: 'IU', schedule: { kind: 'weekly', daysOfWeek: [6] } }))[0]!;
    expect(weekly.recurrence).toBe('weekly');
    expect(weekly.peakDay).toBeCloseTo(500, 9);
    expect(weekly.weeklyTotal).toBeCloseTo(500, 9);
    expect(weekly.dailyAverage).toBeCloseTo(500 / 7, 9);
    expect(isDoseDay(row({ supplementId: 'vitamin_d3', schedule: { kind: 'weekly', daysOfWeek: [6] } }), '2026-10-18')).toBe(true); // a Sunday
    expect(isDoseDay(row({ supplementId: 'vitamin_d3', schedule: { kind: 'weekly', daysOfWeek: [6] } }), '2026-10-19')).toBe(false);
  });

  it('alternate-day iron keeps its 60 mg dose day; the dates follow the start', () => {
    const r = row({ supplementId: 'iron', dose: 60, unit: 'mg', schedule: { kind: 'alternateDay', from: '2026-10-01' } });
    const a = rowActives(r)[0]!;
    expect([a.peakDay, a.dailyAverage]).toEqual([60, 30]);
    expect(['2026-10-01', '2026-10-02', '2026-10-03'].map((d) => isDoseDay(r, d))).toEqual([true, false, true]);
    expect(isDoseDay(row({ supplementId: 'iron', schedule: { kind: 'alternateDay' } }), '2026-10-02')).toBeNull();
  });

  it('legacy rows read as the app always did (every day at their times), labelled as that assumption', () => {
    const a = rowActives(row({ supplementId: 'magnesium', dose: 150, unit: 'mg', timesOfDay: ['morning', 'night'] }))[0]!;
    expect(a).toMatchObject({ recurrence: 'assumedDaily', perOccasion: 150, peakDay: 300, dailyAverage: 300 });
    expect(rowActives(row({ supplementId: 'magnesium', dose: 150, unit: 'mg', schedule: { kind: 'asNeeded' } }))[0]).toMatchObject({ peakDay: 150, dailyAverage: null });
  });
});

describe('upper-limit scope and status (unknown is never a pass)', () => {
  it('10 vitamin D capsules / 10 magnesium tablets without a label: unchecked, not no-issues and not a known exceedance', () => {
    const s = rowExposureStatuses([row({ supplementId: 'vitamin_d3', dose: 10, unit: 'capsule' }), row({ supplementId: 'magnesium', dose: 10, unit: 'tablet' })], ADULT);
    expect(s.map((x) => [x.supplementId, x.doseKnown, x.safetyCheck])).toEqual([
      ['vitamin_d3', false, 'unchecked'],
      ['magnesium', false, 'unchecked'],
    ]);
    expect(s[1]!.reasons).toContain('potencyUnknown');
  });

  it('magnesium counts supplements only (food excluded); calcium and vitamin D count total intake', () => {
    const mg = aggregateActives([row({ supplementId: 'magnesium', dose: 300, unit: 'mg' })]);
    expect(upperLimitAssessment(mg, { ...ADULT, food: { magnesium: { value: 600 } } })[0]).toMatchObject({ status: 'passed' });
    expect(upperLimitAssessment(aggregateActives([row({ supplementId: 'magnesium', dose: 400, unit: 'mg' })]), ADULT)[0]).toMatchObject({ status: 'violation', reasons: ['aboveLimit'] });
    const ca: SupplementProduct = { servingAmount: 1, servingUnit: 'tablet', actives: [{ ingredient: 'calcium', amount: 500, unit: 'mg', basis: 'elemental' }] };
    const calcium = aggregateActives([row({ supplementId: 'calcium', dose: 2, unit: 'tablet', product: ca })]);
    expect(upperLimitAssessment(calcium, ADULT)[0]).toMatchObject({ status: 'unchecked', reasons: ['foodIntakeUnknown'] });
    expect(upperLimitAssessment(calcium, { ...ADULT, food: { calcium: { value: 900 } } })[0]!.status).toBe('passed');
    expect(upperLimitAssessment(calcium, { ...ADULT, food: { calcium: { value: 1600 } } })[0]!.status).toBe('violation');
    // a known supplement total above a total-intake limit proves a violation even with food unknown
    const bigD = aggregateActives([row({ supplementId: 'vitamin_d3', dose: 5000, unit: 'IU' })]);
    expect(upperLimitAssessment(bigD, ADULT)[0]).toMatchObject({ status: 'violation', reasons: ['aboveLimitFromKnownPart'] });
  });

  it('weekly vitamin D and alternate-day iron cannot pass on their daily average alone (regimen review)', () => {
    const d = upperLimitAssessment(aggregateActives([row({ supplementId: 'vitamin_d3', dose: 20000, unit: 'IU', schedule: { kind: 'weekly', daysOfWeek: [6] } })]), { ...ADULT, food: { vitD: { value: 5 } } })[0]!;
    expect(d.dailyAverage).toBeLessThan(100);
    expect(d).toMatchObject({ status: 'unchecked' });
    expect(d.reasons).toContain('intermittentRegimenReview');
    const fe = upperLimitAssessment(aggregateActives([row({ supplementId: 'iron', dose: 60, unit: 'mg', schedule: { kind: 'alternateDay', from: '2026-10-01' } })]), { ...ADULT, food: { iron: { value: 10 } } })[0]!;
    expect(fe.status).toBe('unchecked');
    expect(fe.reasons).toContain('intermittentRegimenReview');
    // a weekly megadose above the limit even on average is a violation (not cleared by dividing by seven)
    expect(upperLimitAssessment(aggregateActives([row({ supplementId: 'vitamin_d3', dose: 50000, unit: 'IU', schedule: { kind: 'weekly', daysOfWeek: [0] } })]), ADULT)[0]!.status).toBe('violation');
  });

  it('two products sharing an ingredient aggregate in its canonical unit; an unknown one keeps the known part as a lower bound', () => {
    const elec: SupplementProduct = { servingAmount: 1, servingUnit: 'sachet', actives: [{ ingredient: 'sodium', amount: 1, unit: 'g', basis: 'elemental' }, { ingredient: 'magnesium', amount: 100, unit: 'mg', basis: 'elemental' }] };
    const rows = [row({ supplementId: 'magnesium', dose: 200, unit: 'mg' }), row({ supplementId: 'electrolytes_fasting', dose: 1, unit: 'sachet', product: elec })];
    const mg = aggregateActives(rows).find((e) => e.ingredient === 'magnesium')!;
    expect(mg.dailyAverage).toBe(300);
    expect(mg.contributors).toHaveLength(2);
    const withUnknown = aggregateActives([...rows, row({ supplementId: 'multivitamin_low_energy', dose: 1, unit: 'tablet' })]).find((e) => e.ingredient === 'magnesium')!;
    expect(withUnknown).toMatchObject({ dailyAverage: null, dailyAverageLowerBound: 300 });
    expect(upperLimitAssessment([withUnknown], ADULT)[0]!.status).toBe('unchecked');
  });

  it('an unknown or child age leaves the adult reference unresolved (unchecked)', () => {
    const mg = aggregateActives([row({ supplementId: 'magnesium', dose: 100, unit: 'mg' })]);
    expect(upperLimitAssessment(mg)[0]).toMatchObject({ status: 'unchecked', reasons: ['ageUnresolved'] });
    expect(upperLimitAssessment(mg, { ageYears: 15 })[0]!.status).toBe('unchecked');
  });

  it('the references are the catalogue’s own upper limits (no new numbers)', () => {
    for (const u of UPPER_LIMITS) {
      const rec = SEED_SUPPLEMENTS.find((s) => s.id === u.supplementId)!;
      const lim = rec.dose.upperLimit!;
      const inUnit = u.ingredient === 'vitD' ? lim.amount / 40 : convertMass(lim.amount, lim.unit, u.unit);
      expect(inUnit, u.supplementId).toBeCloseTo(u.amount, 9);
    }
  });

  it('dose validity and the safety check are separate; the dose editor warns on a dose day above the limit', () => {
    expect(validateDose(row({ supplementId: 'vitamin_d3', dose: 10, unit: 'capsule' })).ok).toBe(true);
    const weekly = validateDose(row({ supplementId: 'vitamin_d3', dose: 20000, unit: 'IU', schedule: { kind: 'weekly', daysOfWeek: [6] } }));
    expect(weekly.issues.map((i) => i.code)).toEqual(['doseDayAboveLimit']);
    const daily = validateDose(row({ supplementId: 'vitamin_d3', dose: 5000, unit: 'IU' }));
    expect(daily.issues.map((i) => i.code)).toEqual(['aboveUpperLimit']);
  });
});

describe('observed taking vs on-hand stock and continuation', () => {
  const sec = (rows: SupplementRow[]): SupplementsSectionV2 => ({ _v: 2, stance: 'taking', rows });

  it('an existing 5 g/day creatine is baseline exposure with no new loading; on hand has no physiological exposure', () => {
    const taking = supplementPlannerInputs(sec([row({ supplementId: 'creatine_monohydrate', dose: 5, unit: 'g', since: '2026-01-01' })]));
    expect(taking.habitual).toEqual(['L7']);
    expect(taking.habitualActives).toEqual([
      {
        lever: 'L7',
        family: 'creatine',
        supplementId: 'creatine_monohydrate',
        active: { ingredient: 'creatine', unit: 'g', perOccasion: 5, peakDay: 5, dailyAverage: 5, weeklyTotal: 35, provenance: 'catalogueUnit' },
        product: { amount: 5, unit: 'g' },
        recurrence: 'assumedDaily',
        since: '2026-01-01',
        continuation: 'asTaken',
      },
    ]);
    const onHand = supplementPlannerInputs(sec([row({ supplementId: 'creatine_monohydrate', state: 'onHand', dose: 5, unit: 'g' })]));
    expect(onHand.onHand).toEqual(['L7']);
    expect(onHand.habitualActives).toEqual([]);
    expect(aggregateActives([row({ supplementId: 'creatine_monohydrate', state: 'onHand', dose: 5, unit: 'g' })])).toEqual([]);
  });

  it('a clinician-stopped product stays in the observed history but is not continued; unknown potency stays unknown', () => {
    const stopped = supplementPlannerInputs(sec([row({ supplementId: 'omega3_epa_dha', dose: 2, unit: 'capsule', clinicianStop: { on: '2026-09-01' } })]));
    expect(stopped.excludedLevers).toEqual(['L8']);
    expect(stopped.optInLevers).toEqual([]);
    expect(stopped.habitualActives).toHaveLength(1);
    expect(stopped.habitualActives[0]).toMatchObject({ continuation: 'stopped', active: { ingredient: 'epaDha', dailyAverage: null } });
  });
});

describe('planner request round trip (D7-04: habitual exposure is baseline; a plan charges only increments)', () => {
  const sec = (rows: SupplementRow[]): SupplementsSectionV2 => ({ _v: 2, stance: 'taking', rows });
  const req = (rows: SupplementRow[]) => plannerHabitualActives(supplementPlannerInputs(sec(rows)).habitualActives);

  it('an existing 5 g/day creatine reaches the planner as daily baseline: a 5 g lever adds no increment (no new loading/water)', () => {
    const h = req([row({ supplementId: 'creatine_monohydrate', dose: 5, unit: 'g' })]);
    expect(h).toEqual([{ active: 'creatine', gPerDay: 5, schedule: 'daily', state: 'taking' }]);
    const hab = habitualCreatine(h);
    expect(hab).toEqual({ continuedGPerDay: 5, unchecked: false });
    expect(plannedCreatineG(hab, 5, true, 10)).toEqual({ totalG: 5, incrementG: 0 });
    expect(plannedCreatineG(hab, 0, true, 10)).toEqual({ totalG: 5, incrementG: 0 });
  });

  it('on hand has no physiological baseline (empty), while the same consent stands', () => {
    const p = supplementPlannerInputs(sec([row({ supplementId: 'creatine_monohydrate', state: 'onHand', dose: 5, unit: 'g' })]));
    expect(p.optInLevers).toEqual(['creatine']);
    expect(plannerHabitualActives(p.habitualActives)).toEqual([]);
    expect(habitualCreatine(plannerHabitualActives(p.habitualActives)).continuedGPerDay).toBe(0);
  });

  it('unknown potency (scoops without a label) and a weekly regimen stay unchecked, never a numeric baseline', () => {
    expect(req([row({ supplementId: 'creatine_monohydrate', dose: 1, unit: 'scoop' })])).toEqual([{ active: 'creatine', gPerDay: null, schedule: 'daily', state: 'taking' }]);
    expect(habitualCreatine(req([row({ supplementId: 'creatine_monohydrate', dose: 1, unit: 'scoop' })]))).toEqual({ continuedGPerDay: 0, unchecked: true });
    const weekly = req([row({ supplementId: 'creatine_monohydrate', dose: 5, unit: 'g', schedule: { kind: 'weekly', daysOfWeek: [0, 3] } })]);
    expect(weekly[0]).toMatchObject({ schedule: 'weekly' });
    expect(habitualCreatine(weekly)).toEqual({ continuedGPerDay: 0, unchecked: true });
  });

  it('a clinician stop keeps the history (stopped) and the plan never continues it', () => {
    const h = req([row({ supplementId: 'creatine_monohydrate', dose: 5, unit: 'g', clinicianStop: { on: '2026-09-01' } })]);
    expect(h).toEqual([{ active: 'creatine', gPerDay: 5, schedule: 'daily', state: 'stopped', clinicianStop: true }]);
    expect(habitualCreatine(h).continuedGPerDay).toBe(0);
  });

  it('the request field is deterministic (same rows, same JSON) for a stable request hash', () => {
    const rows = [row({ supplementId: 'omega3_epa_dha', dose: 1, unit: 'g' }), row({ supplementId: 'creatine_monohydrate', dose: 3, unit: 'g' })];
    expect(JSON.stringify(req(rows))).toBe(JSON.stringify(req([...rows].reverse())));
  });
});

describe('ingredient-aware label conversions (A1-026)', () => {
  const d3 = (amount: number, unit: string): SupplementProduct => ({ servingAmount: 1, servingUnit: 'capsule', actives: [{ ingredient: 'vitD', amount, unit, basis: 'asLabelled' }], source: 'label' });
  const nitrate = (amount: number, unit: string, basis: 'nitrate' | 'compound' = 'nitrate'): SupplementProduct => ({ servingAmount: 1, servingUnit: 'shot', actives: [{ ingredient: 'nitrate', amount, unit, basis }], source: 'label' });

  it('10 × 1000 IU labelled D3 is 250 µg/day, a known exceedance of the existing adult UL, like the equivalent µg label', () => {
    const iu = aggregateActives([row({ supplementId: 'vitamin_d3', dose: 10, unit: 'capsule', product: d3(1000, 'IU') })]);
    const ug = aggregateActives([row({ supplementId: 'vitamin_d3', dose: 10, unit: 'capsule', product: d3(25, 'µg') })]);
    expect(iu[0]).toMatchObject({ ingredient: 'vitD', unit: 'ug' });
    expect(iu[0]!.dailyAverage).toBeCloseTo(250, 9);
    expect(ug[0]!.dailyAverage).toBeCloseTo(iu[0]!.dailyAverage!, 9);
    // food vitamin D unknown: the supplemental lower bound alone proves the exceedance (other constraints stay unchecked)
    expect(upperLimitAssessment(iu, ADULT)[0]).toMatchObject({ status: 'violation', reasons: ['aboveLimitFromKnownPart'] });
    expect(upperLimitAssessment(ug, ADULT)[0]!.status).toBe('violation');
    // the label as printed and the named convention stay with the converted value
    const x = activeExposureFromServing({ amount: 10, unit: 'capsule' }, d3(1000, 'IU'))[0]!;
    expect(x).toMatchObject({ value: 250, unit: 'ug', original: { value: 1000, unit: 'IU' }, convention: 'vitaminD40IuPerUg' });
  });

  it('IU converts for vitamin D only, never for another vitamin', () => {
    const vitA: SupplementProduct = { servingAmount: 1, servingUnit: 'capsule', actives: [{ ingredient: 'vitARae', amount: 5000, unit: 'IU', basis: 'asLabelled' }] };
    expect(activeExposureFromServing({ amount: 1, unit: 'capsule' }, vitA)[0]).toMatchObject({ value: null, reason: 'unitIncompatible' });
  });

  it('620 mg nitrate ion is 10 mmol under the declared 62.0 mg/mmol; g, mg, µg and mmol labels agree', () => {
    const one = (p: SupplementProduct) => occasionActives(row({ supplementId: 'dietary_nitrate', dose: 1, unit: 'shot', product: p }))[0]!.value;
    expect(one(nitrate(620, 'mg'))).toBeCloseTo(10, 12);
    expect(one(nitrate(0.62, 'g'))).toBeCloseTo(10, 12);
    expect(one(nitrate(620000, 'µg'))).toBeCloseTo(10, 9);
    expect(one(nitrate(10, 'mmol'))).toBe(10);
    // PubChem precision (62.005 g/mol) is within label rounding of the declared convention
    expect(one(nitrate(620.05, 'mg'))).toBeCloseTo(10, 2);
    expect(activeExposureFromServing({ amount: 1, unit: 'shot' }, nitrate(620, 'mg'))[0]).toMatchObject({ convention: 'nitrateIon62mgPerMmol', original: { value: 620, unit: 'mg' } });
  });

  it('unknown capsule potency and an unresolved nitrate salt mass stay valid unknown records, never safe or zero', () => {
    const unknownPotency: SupplementProduct = { servingAmount: 1, servingUnit: 'capsule', actives: [{ ingredient: 'vitD', amount: null, unit: 'IU', basis: 'asLabelled' }] };
    const d = aggregateActives([row({ supplementId: 'vitamin_d3', dose: 10, unit: 'capsule', product: unknownPotency })]);
    expect(d[0]!.dailyAverage).toBeNull();
    expect(upperLimitAssessment(d, ADULT)[0]!.status).toBe('unchecked');
    const salt = occasionActives(row({ supplementId: 'dietary_nitrate', dose: 1, unit: 'shot', product: nitrate(500, 'mg', 'compound') }))[0]!;
    expect(salt).toMatchObject({ value: null, reason: 'basisNotConvertible' });
  });
});
