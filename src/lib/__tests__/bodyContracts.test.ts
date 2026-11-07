// @vitest-environment node
/**
 * Binding contracts C1–C7 (`src/lib/bodyContracts.ts`): provider/consumer fixtures for the shared vocabulary. Each block
 * names the contract and the review IDs whose acceptance tests it carries for this package's contribution.
 */
import { describe, expect, it } from 'vitest';
import {
  CONTRACT_FINGERPRINT,
  CONTRACT_VERSIONS,
  LEGACY_BAND_META,
  SAFETY_AUDIT_ENSEMBLE,
  activeExposureFromServing,
  availableCarbohydrate,
  bandMetaFor,
  buildEnergyLedger,
  certificateAuthorizes,
  certificateFingerprint,
  closeStatuses,
  combineConstraintStatuses,
  contentHash,
  conventionEnergyKcal,
  convertActiveAmount,
  convertMass,
  NITRATE_ION_MG_PER_MMOL,
  VITAMIN_D_IU_PER_UG,
  dayIntakeCoverage,
  evaluateBound,
  exactOccurrence,
  dateOnlyOccurrence,
  exerciseIncrementalKcal,
  exerciseNetAboveRestKcal,
  exposureCalibrationEligible,
  iidZeroFailureLowerBound,
  ingredientEdibleMassG,
  inlineStatusText,
  interpretSurplusCap,
  intersectConstraints,
  intervalOccurrence,
  isConcerningUnresolved,
  isDerivedCurrent,
  jointSafetyScreen,
  normalizeSubstanceDose,
  normalizedMarginScore,
  occurrenceBoundsMs,
  per100FromBatch,
  realisedHistoryHash,
  recipeBatchNutrient,
  requiredJointPasses,
  residualEnergyEnvelope,
  searchOutcomeFromLegacy,
  stableStringify,
  stampDerived,
  statusValue,
  unknownOccurrence,
  weakestResolution,
  worstStatus,
  zeroCalorieFastInterruption,
  formatRange,
  type CertificateInputs,
  type ConstraintDef,
  type ConstraintEvaluation,
  type RealisedHistory,
  type SafetyCertificate,
} from '../bodyContracts';
import { GOAL_CAPABILITY, METRIC_IDS, SERIES, isProductionGoalEligible, type MetricId } from '@/engine/types/metrics';

const NBSP = ' ';

/* ================================================================================================================= C7 */

describe('C7 versions and stable hashing', () => {
  it('canonical JSON ignores key order, drops undefined and never emits NaN/Infinity as null', () => {
    expect(stableStringify({ b: 1, a: [1, undefined, 2], c: undefined })).toBe(stableStringify({ a: [1, null, 2], b: 1 }));
    const s = stableStringify({ x: Number.NaN, y: Number.POSITIVE_INFINITY, z: -0 });
    expect(s).toBe('{"x":{"$num":"NaN"},"y":{"$num":"Infinity"},"z":0}');
    expect(stableStringify(new Float32Array([1, 2]))).toBe('[1,2]');
    expect(() => {
      const o: Record<string, unknown> = {};
      o.self = o;
      stableStringify(o);
    }).toThrow(/cyclic/);
  });

  it('content hash is deterministic, order-independent and sensitive to values', () => {
    expect(contentHash({ a: 1, b: [2, 3] })).toBe(contentHash({ b: [2, 3], a: 1 }));
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }));
    expect(contentHash({ a: Number.NaN })).not.toBe(contentHash({ a: null }));
    expect(contentHash('x')).toMatch(/^[0-9a-f]{16}$/);
    expect(CONTRACT_FINGERPRINT).toBe(contentHash(CONTRACT_VERSIONS));
  });

  it('a legacy (unstamped) derived artifact is never current; a stamp is current only for the same versions and inputs', () => {
    expect(isDerivedCurrent(undefined)).toBe(false);
    expect(isDerivedCurrent({ contracts: 'old' })).toBe(false);
    const st = stampDerived({ engineVersion: 'e1', inputsHash: 'h1', versions: { realisedHistory: CONTRACT_VERSIONS.realisedHistory } });
    expect(isDerivedCurrent(st, { engineVersion: 'e1', inputsHash: 'h1' })).toBe(true);
    expect(isDerivedCurrent(st, { engineVersion: 'e2' })).toBe(false);
    expect(isDerivedCurrent(st, { inputsHash: 'h2' })).toBe(false);
    expect(isDerivedCurrent(st, { versions: { realisedHistory: CONTRACT_VERSIONS.realisedHistory + 1 } })).toBe(false);
  });

  it('exercise ledger terms: net above own rest and incremental cost stay labelled and unclamped (D3-07)', () => {
    expect(exerciseNetAboveRestKcal(500, 1440, 60)).toBe(440);
    expect(exerciseNetAboveRestKcal(10, 1440, 60)).toBe(0);
    expect(exerciseIncrementalKcal(440, 500)).toBe(-60);
    expect(exerciseIncrementalKcal(440, null)).toBeNull();
    expect(exerciseNetAboveRestKcal(Number.NaN, 1440, 60)).toBeNull();
  });
});

/* ================================================================================================================= C1 */

describe('C1 coverage, occurrence and substance boundary (D5-01, D5-05)', () => {
  it('day completeness needs an explicit attestation: meal count or a per-meal flag never makes a complete day', () => {
    // three snacks / three planned meals logged, no day statement
    expect(dayIntakeCoverage({ quantifiedIntakeEvents: 3 })).toBe('partial');
    // one 500 kcal breakfast
    expect(dayIntakeCoverage({ quantifiedIntakeEvents: 1 })).toBe('partial');
    expect(dayIntakeCoverage({ quantifiedIntakeEvents: 0, asPlannedTaps: 2 })).toBe('asPlannedEstimate');
    expect(dayIntakeCoverage({ quantifiedIntakeEvents: 0 })).toBe('unknown');
    expect(dayIntakeCoverage({ attestation: 'complete', quantifiedIntakeEvents: 4 })).toBe('complete');
    expect(dayIntakeCoverage({ attestation: 'complete', quantifiedIntakeEvents: 0 })).toBe('unknown');
    // "No intake" is a confirmed zero, never Skipped; a logged meal contradicts it and leaves partial evidence
    expect(dayIntakeCoverage({ attestation: 'none', quantifiedIntakeEvents: 0 })).toBe('confirmedZero');
    expect(dayIntakeCoverage({ attestation: 'none', quantifiedIntakeEvents: 1 })).toBe('partial');
  });

  it('exposure-conditional calibration needs quantitative coverage; as-planned or imputed inputs never qualify', () => {
    expect(exposureCalibrationEligible('partial')).toBe(false);
    expect(exposureCalibrationEligible('asPlannedEstimate')).toBe(false);
    expect(exposureCalibrationEligible('unknown')).toBe(false);
    expect(exposureCalibrationEligible('confirmedZero')).toBe(true);
    expect(exposureCalibrationEligible('complete', ['reported', 'label'])).toBe(true);
    expect(exposureCalibrationEligible('complete', ['reported', 'asPlanned'])).toBe(false);
    expect(exposureCalibrationEligible('complete', ['legacyUnknown'])).toBe(false);
  });

  it('occurrence keeps exact, interval, date-only and unknown apart (no guessed clock)', () => {
    const e = exactOccurrence('2026-10-18T22:00:00+02:00', { tz: 'Europe/Berlin' });
    expect(occurrenceBoundsMs(e)).toEqual({ startMs: Date.parse('2026-10-18T20:00:00Z'), endMs: Date.parse('2026-10-18T20:00:00Z') });
    const i = intervalOccurrence('2026-10-25T02:00:00+02:00', '2026-10-25T03:00:00+01:00', { dstAmbiguous: true });
    expect(occurrenceBoundsMs(i)?.endMs).toBeGreaterThan(occurrenceBoundsMs(i)!.startMs);
    expect(occurrenceBoundsMs(dateOnlyOccurrence('2026-10-18', 'appDay'))).toBeNull();
    expect(occurrenceBoundsMs(unknownOccurrence())).toBeNull();
    expect(occurrenceBoundsMs(intervalOccurrence('2026-10-18T10:00:00Z', '2026-10-18T09:00:00Z'))).toBeNull();
  });

  it('substance units: creatine/BHB g and mg normalise, alcohol drinks use the 14 g convention, illegal pairs are refused', () => {
    expect(normalizeSubstanceDose('creatine', 5000, 'mg')).toMatchObject({ ok: true, value: 5, unit: 'g', original: { amount: 5000, unit: 'mg' } });
    expect(normalizeSubstanceDose('creatine', 5, 'g')).toMatchObject({ ok: true, value: 5, unit: 'g' });
    expect(normalizeSubstanceDose('exogenousKetones', 12000, 'mg')).toMatchObject({ ok: true, value: 12, unit: 'g' });
    expect(normalizeSubstanceDose('alcohol', 2, 'drinks')).toEqual({ ok: true, value: 28, unit: 'g', original: { amount: 2, unit: 'drinks' }, convention: 'ethanol14gPerDrink' });
    expect(normalizeSubstanceDose('caffeine', 0.2, 'g')).toMatchObject({ ok: true, value: 200, unit: 'mg' });
    expect(normalizeSubstanceDose('alcohol', 14000, 'mg')).toMatchObject({ ok: false, reason: 'unitNotAllowed' });
    expect(normalizeSubstanceDose('caffeine', 1, 'drinks')).toMatchObject({ ok: false, reason: 'unitNotAllowed' });
    expect(normalizeSubstanceDose('creatine', 3, 'drinks')).toMatchObject({ ok: false, reason: 'unitNotAllowed' });
    expect(normalizeSubstanceDose('creatine', -1, 'g')).toMatchObject({ ok: false, reason: 'notFiniteNonNegative' });
  });
});

/* ================================================================================================================= C2 */

describe('C2 realised history primitives (D2-01, D5-05)', () => {
  it('causal resolution propagates the weakest dependency', () => {
    expect(weakestResolution('eventPrefix', 'daily')).toBe('daily');
    expect(weakestResolution('daily', 'scenario', 'eventPrefix')).toBe('scenario');
    expect(weakestResolution()).toBe('eventPrefix');
  });

  it('a verified positive-energy event at a known instant terminates a zero-calorie clock; weak evidence only bounds it', () => {
    const at = exactOccurrence('2026-10-19T12:00:00Z');
    expect(zeroCalorieFastInterruption({ energyKcal: 30, occurrence: at })).toBe('terminates');
    expect(zeroCalorieFastInterruption({ energyKcal: null, occurrence: at })).toBe('bounded');
    expect(zeroCalorieFastInterruption({ energyKcal: 600, occurrence: dateOnlyOccurrence('2026-10-19', 'appDay') })).toBe('bounded');
    expect(zeroCalorieFastInterruption({ energyKcal: 0, occurrence: at })).toBe('none');
  });

  it('the history hash is a stable content hash that ignores its own field', () => {
    const h: Omit<RealisedHistory, 'contentHash'> = {
      kind: 'vitals.realisedHistory',
      contractVersion: CONTRACT_VERSIONS.observation,
      reducerVersion: CONTRACT_VERSIONS.realisedHistory,
      anchor: { anchorDate: '2026-10-12', anchorDay: 7, stateHash: 's', profileHash: 'p' },
      asOf: '2026-10-19T08:00:00Z',
      days: [{ date: '2026-10-12', planDay: 7, coverage: { energy: 'partial' }, observedEventIds: ['m1'], remainders: [], assumptionIds: [], resolution: 'daily' }],
      events: [],
      fasts: [],
      assumptions: [],
      uncertaintyGroups: [],
    };
    const a = realisedHistoryHash(h);
    expect(realisedHistoryHash({ ...h, contentHash: 'anything' })).toBe(a);
    expect(realisedHistoryHash({ ...h, asOf: '2026-10-19T09:00:00Z' })).not.toBe(a);
  });
});

/* ================================================================================================================= C3 */

describe('C3 exposure ledger (D6-01, D6-02, D6-03, D6-04, D7-04)', () => {
  it('carbohydrate basis: fibre is subtracted exactly once and only when the basis includes it', () => {
    expect(availableCarbohydrate({ reportedG: 30, basis: 'totalByDifference', fibreG: 8 })).toEqual({ availableG: 22, status: 'resolved' });
    expect(availableCarbohydrate({ reportedG: 30, basis: 'legacyTotalByDifference', fibreG: 8 })).toEqual({ availableG: 22, status: 'resolved' });
    expect(availableCarbohydrate({ reportedG: 22, basis: 'available', fibreG: 8 })).toEqual({ availableG: 22, status: 'resolved' });
    expect(availableCarbohydrate({ reportedG: 30, basis: 'totalByDifference', fibreG: null })).toMatchObject({ availableG: null, status: 'unresolved', reason: 'fibreNeeded' });
    expect(availableCarbohydrate({ reportedG: 30, basis: 'unknown', fibreG: 3 })).toMatchObject({ availableG: null, status: 'unresolved' });
    expect(availableCarbohydrate({ reportedG: 30, basis: 'monosaccharideEquivalent', fibreG: 3 })).toMatchObject({ status: 'unresolved' });
  });

  it('convention ME counts MCT inside fat and ethanol once; unknown macros give no number, not zero energy', () => {
    const m = { proteinG: 10, carbAvailableG: 20, fatG: 10, mctG: 4, fibreG: 5, ethanolG: 14 };
    expect(conventionEnergyKcal(m)).toBeCloseTo(4 * 10 + 4 * 20 + 9 * 6 + 8.3 * 4 + 2 * 5 + 7 * 14, 9);
    expect(conventionEnergyKcal({ ...m, mctG: undefined })).toBe(4 * 10 + 4 * 20 + 9 * 10 + 2 * 5 + 7 * 14);
    expect(conventionEnergyKcal({ ...m, mctG: 12 })).toBeNull();
    expect(conventionEnergyKcal({ ...m, carbAvailableG: null })).toBeNull();
    // a source-specific factor replaces (never stacks with) the general one
    expect(conventionEnergyKcal({ ...m, mctG: undefined }, { protein: 3.5 })).toBe(3.5 * 10 + 4 * 20 + 9 * 10 + 2 * 5 + 7 * 14);
  });

  it('a 600 kcal / 30 g protein meal keeps all 600 kcal with unknown carbohydrate and fat (energy-only, not zero)', () => {
    const led = buildEnergyLedger({ reportedMEKcal: 600, macros: { proteinG: 30, carbAvailableG: null, fatG: null, fibreG: 0, ethanolG: 0 } });
    expect(led).toMatchObject({ reportedMEKcal: 600, reconciledMEKcal: 600, conventionMEKcal: null, status: 'energyOnly', method: 'reported', boundary: 'reportedME' });
    expect(led.macroMask).toEqual({ protein: 'known', carbohydrate: 'unknown', fat: 'unknown', fibre: 'known', ethanol: 'known' });
    // the restricted C/F family: endpoints are conditional algebra, not probability bounds, and q has no default
    const env = residualEnergyEnvelope(600, { proteinG: 30, carbAvailableG: null, fatG: null, fibreG: 0, ethanolG: 0 });
    expect(env.status).toBe('family');
    if (env.status !== 'family') throw new Error('family expected');
    expect(env.residualKcal).toBe(480);
    expect(env.carbOnlyG).toBe(120);
    expect(env.fatOnlyG).toBeCloseTo(53.3333, 3);
    const half = env.split(0.5);
    expect(4 * half.carbAvailableG + 9 * half.fatG).toBeCloseTo(480, 9);
  });

  it('known macros exceeding the reported energy are a source conflict; complete records keep their residual', () => {
    expect(buildEnergyLedger({ reportedMEKcal: 100, macros: { proteinG: 30, carbAvailableG: null, fatG: null, fibreG: 0, ethanolG: 0 } }).status).toBe('conflict');
    const full = buildEnergyLedger({ reportedMEKcal: 410, macros: { proteinG: 25, carbAvailableG: 40, fatG: 15, fibreG: 5, ethanolG: 0 } });
    expect(full).toMatchObject({ status: 'consistent', residualKcal: 410 - (100 + 160 + 135 + 10) });
    expect(buildEnergyLedger({ reportedMEKcal: 500, macros: { proteinG: 25, carbAvailableG: 40, fatG: 15, fibreG: 5, ethanolG: 0 }, conflictToleranceKcal: 30 }).status).toBe('conflict');
    expect(buildEnergyLedger({ macros: { proteinG: null, carbAvailableG: null, fatG: null, fibreG: null, ethanolG: null } })).toMatchObject({ reconciledMEKcal: null, status: 'energyUnknown' });
    expect(residualEnergyEnvelope(300, { proteinG: null, carbAvailableG: null, fatG: 10, fibreG: 0, ethanolG: 0 }).status).toBe('notUnique');
    expect(residualEnergyEnvelope(400, { proteinG: 25, carbAvailableG: 40, fatG: null, fibreG: 0, ethanolG: 0 })).toMatchObject({ status: 'unique', fatG: (400 - 260) / 9 });
  });

  it('product actives: dose = recorded/serving × active, elemental and salt bases kept apart, unknown potency stays unknown', () => {
    const mg = { servingAmount: 1, servingUnit: 'tablet', actives: [{ ingredient: 'magnesium' as const, amount: 200, unit: 'mg', basis: 'elemental' as const }] };
    expect(activeExposureFromServing({ amount: 2, unit: 'tablet' }, mg)).toEqual([expect.objectContaining({ id: 'magnesium', value: 400, unit: 'mg', form: 'elemental', coverage: 'complete' })]);
    const unknownPotency = { ...mg, actives: [{ ...mg.actives[0]!, amount: null }] };
    expect(activeExposureFromServing({ amount: 2, unit: 'tablet' }, unknownPotency)[0]).toMatchObject({ value: null, coverage: 'unknown', reason: 'potencyUnknown' });
    const citrate = { ...mg, actives: [{ ...mg.actives[0]!, amount: 1000, basis: 'compound' as const }] };
    expect(activeExposureFromServing({ amount: 1, unit: 'tablet' }, citrate)[0]).toMatchObject({ value: null, reason: 'basisNotConvertible' });
    const salt = { servingAmount: 1, servingUnit: 'sachet', actives: [{ ingredient: 'sodium' as const, amount: 1, unit: 'g', basis: 'sodiumChloride' as const }] };
    expect(activeExposureFromServing({ amount: 1, unit: 'sachet' }, salt)[0]!.value).toBeCloseTo(393.4, 0);
    const powder = { servingAmount: 30, servingUnit: 'g', actives: [{ ingredient: 'protein' as const, amount: 24, unit: 'g', basis: 'protein' as const }] };
    expect(activeExposureFromServing({ amount: 45, unit: 'g' }, powder)[0]).toMatchObject({ value: 36, unit: 'g' });
    expect(activeExposureFromServing({ amount: 2, unit: 'scoop' }, powder)[0]).toMatchObject({ value: null, reason: 'servingIncompatible' });
    expect(convertMass(1, 'mg', 'µg')).toBe(1000);
    expect(convertMass(1, 'capsule', 'g')).toBeNull();
  });

  it('A1-026: one ingredient-aware converter: dietary vitamin D IU → µg at 40 IU/µg, nitrate-ion mass → mmol at 62.0 mg/mmol', () => {
    // 10 capsules × 1000 IU labelled D3 per day → 250 µg/day, the same as an equivalent 250 µg label
    const d3Iu = { servingAmount: 1, servingUnit: 'capsule', actives: [{ ingredient: 'vitD' as const, amount: 1000, unit: 'IU', basis: 'asLabelled' as const }] };
    const d3Ug = { ...d3Iu, actives: [{ ...d3Iu.actives[0]!, amount: 25, unit: 'µg' }] };
    const iu = activeExposureFromServing({ amount: 10, unit: 'capsule' }, d3Iu)[0]!;
    const ug = activeExposureFromServing({ amount: 10, unit: 'capsule' }, d3Ug)[0]!;
    expect(iu).toMatchObject({ id: 'vitD', value: 250, unit: 'ug', coverage: 'complete', convention: 'vitaminD40IuPerUg', original: { value: 1000, unit: 'IU', basis: 'asLabelled' } });
    expect(ug.value).toBe(250);
    expect(convertActiveAmount('vitD', 400, 'I.U.')).toMatchObject({ value: 10, unit: 'ug' });
    expect(VITAMIN_D_IU_PER_UG).toBe(40);
    // the known 250 µg/day lower bound keeps the known violation of the existing 100 µg adult UL; other incomplete bounds stay unchecked
    expect(evaluateBound({ comparator: 'cap', value: 100 }, { lower: 250, upper: null }).status).toBe('violation');
    expect(evaluateBound({ comparator: 'cap', value: 100 }, { lower: 50, upper: null }).status).toBe('unchecked');
    // IU of any other active is never converted generically
    expect(convertActiveAmount('b12', 1000, 'IU')).toEqual({ value: null, reason: 'unitIncompatible' });
    expect(convertActiveAmount('vitARae', 3000, 'IU')).toEqual({ value: null, reason: 'unitIncompatible' });

    // nitrate ion: 620 mg → 10 mmol under the declared 62.0 convention; g/mg/µg/mmol labels agree
    expect(NITRATE_ION_MG_PER_MMOL).toBe(62);
    const nitrate = (amount: number, unit: string) => ({ servingAmount: 1, servingUnit: 'shot', actives: [{ ingredient: 'nitrate' as const, amount, unit, basis: 'nitrate' as const }] });
    const mmol = (amount: number, unit: string) => activeExposureFromServing({ amount: 1, unit: 'shot' }, nitrate(amount, unit))[0]!;
    expect(mmol(620, 'mg')).toMatchObject({ value: 10, unit: 'mmol', form: 'nitrateIon', convention: 'nitrateIon62mgPerMmol', original: { value: 620, unit: 'mg', basis: 'nitrate' } });
    expect(mmol(0.62, 'g').value).toBeCloseTo(10, 12);
    expect(mmol(620_000, 'µg').value).toBeCloseTo(10, 12);
    expect(mmol(10, 'mmol').value).toBe(10);
    // PubChem precision 62.005 g/mol: 620.05 mg is 10 mmol within label tolerance under the rounded convention
    expect(mmol(620.05, 'mg').value).toBeCloseTo(10, 2);

    // unknown capsule potency and an unresolved nitrate salt mass stay valid unknown records, never zero or safe
    const unknownPotency = { ...d3Iu, actives: [{ ...d3Iu.actives[0]!, amount: null }] };
    expect(activeExposureFromServing({ amount: 10, unit: 'capsule' }, unknownPotency)[0]).toMatchObject({ value: null, coverage: 'unknown', reason: 'potencyUnknown' });
    const salt = { servingAmount: 1, servingUnit: 'scoop', actives: [{ ingredient: 'nitrate' as const, amount: 1000, unit: 'mg', basis: 'compound' as const }] };
    expect(activeExposureFromServing({ amount: 1, unit: 'scoop' }, salt)[0]).toMatchObject({ value: null, coverage: 'unknown', reason: 'basisNotConvertible' });
    // a nitrate mass without the ion basis is not converted (no stoichiometry is guessed)
    const asLabelled = { ...salt, actives: [{ ...salt.actives[0]!, basis: 'asLabelled' as const }] };
    expect(activeExposureFromServing({ amount: 1, unit: 'scoop' }, asLabelled)[0]).toMatchObject({ value: null, reason: 'unitIncompatible' });
    // the ion basis never applies to another identity; chloride salts still convert only to their own cation
    expect(convertActiveAmount('sodium', 1, 'g', 'nitrate')).toEqual({ value: null, reason: 'basisNotConvertible' });
    expect(convertActiveAmount('potassium', 1, 'g', 'sodiumChloride')).toEqual({ value: null, reason: 'basisNotConvertible' });
    expect(convertActiveAmount('sodium', 1, 'g', 'sodiumChloride').value).toBeCloseTo(393.4, 0);
    expect(convertActiveAmount('vitD', -1, 'IU')).toEqual({ value: null, reason: 'notFiniteNonNegative' });
    expect(CONTRACT_VERSIONS.exposure).toBe(3);
  });

  it('recipes: refuse converts once, unknown composition stays unknown, no density without a final edible mass', () => {
    expect(ingredientEdibleMassG(500, 'asPurchased', 0.8)).toEqual({ edibleG: 400, legacy: false });
    expect(ingredientEdibleMassG(500, 'asPurchased')).toEqual({ edibleG: null, legacy: false });
    expect(ingredientEdibleMassG(500, 'legacyUnknown')).toEqual({ edibleG: 500, legacy: true });
    const batch = recipeBatchNutrient([{ edibleG: 400, per100: 20 }, { edibleG: 100, per100: 10, retention: 0.5 }], 3, 1);
    expect(batch).toEqual({ value: 80 + 5 + 3 - 1, knownSum: 87, unknownIngredients: 0 });
    expect(recipeBatchNutrient([{ edibleG: 400, per100: 20 }, { edibleG: 100, per100: null }])).toMatchObject({ value: null, knownSum: 80, unknownIngredients: 1 });
    expect(per100FromBatch(87, 840)).toBeCloseTo(10.357, 3);
    expect(per100FromBatch(87, undefined)).toBeNull();
    expect(per100FromBatch(null, 840)).toBeNull();
  });
});

/* ================================================================================================================= C5 */

const lock = (over: Partial<ConstraintDef> & Pick<ConstraintDef, 'id' | 'value'>): ConstraintDef => ({
  quantity: 'fatPctEnergy',
  unit: '%E',
  comparator: 'cap',
  basis: 'notApplicable',
  scope: 'total',
  window: { kind: 'day' },
  applicability: 'applicable',
  mandatory: true,
  source: { kind: 'marker', ref: over.id },
  policyVersion: CONTRACT_VERSIONS.constraintPolicy,
  ...over,
});

function permutations<T>(xs: readonly T[]): T[][] {
  if (xs.length <= 1) return [xs.slice()];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
}

describe('C5 constraints, joint screen and certificates (D4-01, D4-02, D4-03)', () => {
  it('duplicate caps intersect by minimum and floors by maximum in every order', () => {
    const defs = [
      lock({ id: 'fat-cap', value: 30 }),
      lock({ id: 'fat-cap-2', value: 15, mandatory: false, source: { kind: 'user' } }),
      lock({ id: 'fat-cap-3', value: 25 }),
      lock({ id: 'carb-floor', quantity: 'carbPerDay', unit: 'g/d', comparator: 'floor', value: 50 }),
      lock({ id: 'carb-floor-2', quantity: 'carbPerDay', unit: 'g/d', comparator: 'floor', value: 80 }),
    ];
    const ref = intersectConstraints(defs);
    for (const p of permutations(defs)) expect(intersectConstraints(p)).toEqual(ref);
    const fat = ref.merged.find((d) => d.quantity === 'fatPctEnergy')!;
    expect(fat.value).toBe(15);
    // the strictest bound implies the looser mandatory ones, so it carries their mandatory status
    expect(fat.mandatory).toBe(true);
    expect(ref.merged.find((d) => d.quantity === 'carbPerDay')!.value).toBe(80);
    expect(ref.conflicts).toEqual([]);
  });

  it('empty intersections are conflicts; unknown units, non-finite values and bad windows are rejected', () => {
    const r = intersectConstraints([
      lock({ id: 'protein-cap', quantity: 'proteinPerKg', unit: 'g/kg/d', basis: 'reference', value: 0.8 }),
      lock({ id: 'protein-floor', quantity: 'proteinPerKg', unit: 'g/kg/d', basis: 'reference', comparator: 'floor', value: 1.2 }),
      lock({ id: 'bad-unit', unit: 'g/d', value: 10 }),
      lock({ id: 'nan', value: Number.NaN }),
      lock({ id: 'roll', window: { kind: 'rolling', days: 0 }, value: 20 }),
    ]);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]).toMatchObject({ cap: { value: 0.8 }, floor: { value: 1.2 } });
    expect(r.rejected.map((x) => x.reason).sort()).toEqual(['nonFiniteValue', 'rollingWindowDays', 'unitMismatch']);
    // different bases or windows are different bounds (never merged)
    const w = intersectConstraints([lock({ id: 'a', value: 30 }), lock({ id: 'b', value: 20, window: { kind: 'rolling', days: 7 } })]);
    expect(w.merged).toHaveLength(2);
  });

  it('bounds use the monotonic partial-exposure rules; unresolved applicability is unchecked', () => {
    const cap = { comparator: 'cap' as const, value: 300 };
    expect(evaluateBound(cap, { lower: 320, upper: null }).status).toBe('violation');
    expect(evaluateBound(cap, { lower: 100, upper: 250 })).toEqual({ status: 'pass', margin: 50 });
    expect(evaluateBound(cap, { lower: 100, upper: null }).status).toBe('unchecked');
    const floor = { comparator: 'floor' as const, value: 50 };
    expect(evaluateBound(floor, { lower: 60, upper: null }).status).toBe('pass');
    expect(evaluateBound(floor, { lower: 0, upper: 40 }).status).toBe('violation');
    expect(evaluateBound(floor, { lower: 10, upper: null }).status).toBe('unchecked');
    expect(evaluateBound(cap, { lower: 0, upper: 0 }, 'unresolved').status).toBe('unchecked');
    expect(evaluateBound(cap, { lower: 0, upper: 0 }, 'notApplicable').status).toBe('notApplicable');
  });

  it('empty evaluations are not safe; a known violation survives unchecked others; unsupported mandatory bounds are unchecked', () => {
    const ev = (over: Partial<ConstraintEvaluation>): ConstraintEvaluation => ({ constraintId: 'x', key: 'k', status: 'pass', capability: 'enforced', mandatory: true, margin: 1, unit: '%E', ...over });
    expect(combineConstraintStatuses([])).toBe('unchecked');
    expect(combineConstraintStatuses([ev({ status: 'violation' }), ev({ status: 'unchecked' })])).toBe('violation');
    expect(combineConstraintStatuses([ev({ capability: 'unsupported', status: 'unchecked' })])).toBe('unchecked');
    expect(combineConstraintStatuses([ev({}), ev({ mandatory: false, capability: 'unsupported', status: 'unchecked' })])).toBe('verified');
    expect(combineConstraintStatuses([ev({ capability: 'satisfiedByConstruction' })])).toBe('verified');
  });

  it('surplus-cap is percent OF maintenance: 110 is 110 %, 90 is a conflict at 90 % (never 190 %), ambiguous imports need review', () => {
    expect(interpretSurplusCap({ value: 110, origin: 'generatedMarker' })).toEqual({ status: 'ok', pctOfMaintenance: 110 });
    expect(interpretSurplusCap({ value: 90, unit: '% of maintenance', origin: 'user' })).toEqual({ status: 'conflict', pctOfMaintenance: 90, reason: 'belowMaintenanceConflictsNoDeficitPolicy' });
    expect(interpretSurplusCap({ value: 90, origin: 'imported' })).toEqual({ status: 'review', reason: 'ambiguousUnit' });
    expect(interpretSurplusCap({ value: 10, unit: '%', origin: 'imported' })).toEqual({ status: 'review', reason: 'ambiguousUnit' });
    expect(interpretSurplusCap({ value: Number.NaN, origin: 'generatedMarker' })).toEqual({ status: 'review', reason: 'nonFinite' });
  });

  it('joint screen: 14/16 fails and 15/16 passes at alpha 0.1, disjoint per-constraint failures cannot pass', () => {
    expect(requiredJointPasses(16)).toBe(15);
    expect(requiredJointPasses(10)).toBe(9);
    expect(requiredJointPasses(0)).toBe(Number.POSITIVE_INFINITY);
    const member = (a: number, b: number) => ({ protein: a, kcal: b });
    const m15 = [...Array.from({ length: 15 }, () => member(1, 1)), member(-0.1, 1)];
    expect(jointSafetyScreen(m15, ['protein', 'kcal'])).toMatchObject({ status: 'pass', passes: 15, required: 15, failedMembers: [15] });
    // each constraint alone passes 15/16 (marginal P10s positive), but the failures fall on different members
    const disjoint = [...Array.from({ length: 14 }, () => member(1, 1)), member(-1, 1), member(1, -1)];
    expect(jointSafetyScreen(disjoint, ['protein', 'kcal'])).toMatchObject({ status: 'fail', passes: 14, reasonCode: 'belowRequired' });
  });

  it('joint screen: no members, a missing required margin or unresolved applicability is Unchecked; a known violation fails', () => {
    expect(jointSafetyScreen([], ['a'])).toMatchObject({ status: 'unchecked', reasonCode: 'noMembers' });
    expect(jointSafetyScreen([{ a: 1 }, { a: Number.NaN }], ['a'])).toMatchObject({ status: 'unchecked', reasonCode: 'missingMargin', missing: ['a'] });
    expect(jointSafetyScreen([{ a: 1 }, { b: 1 }], ['a'])).toMatchObject({ status: 'unchecked', missing: ['a'] });
    expect(jointSafetyScreen([{ a: 1 }], ['a'], { applicabilityUnresolved: true })).toMatchObject({ status: 'unchecked', reasonCode: 'unresolvedApplicability' });
    expect(jointSafetyScreen([{ a: 1 }], ['a'], { knownViolation: true })).toMatchObject({ status: 'fail', reasonCode: 'knownViolation' });
    expect(SAFETY_AUDIT_ENSEMBLE).toEqual({ S: 16, M: 32, L: 64, X: 128 });
  });

  it('IID zero-failure bound applies only as declared: 0.05^(1/N)', () => {
    expect(iidZeroFailureLowerBound(16)).toBeCloseTo(0.829, 3);
    expect(iidZeroFailureLowerBound(29)).toBeCloseTo(0.902, 3);
    expect(iidZeroFailureLowerBound(0)).toBeNull();
  });

  it('scalar margin ranking needs declared positive same-unit scales; permuting units does not change the joint verdict', () => {
    expect(normalizedMarginScore({ protein: 10, kcal: 100 }, { protein: 20, kcal: 400 })).toBe(0.25);
    expect(normalizedMarginScore({ protein: 10, kcal: 100 }, { protein: 20 })).toBeNull();
    expect(normalizedMarginScore({ protein: 10 }, { protein: 0 })).toBeNull();
    const members = Array.from({ length: 16 }, (_, i) => ({ g: i === 3 ? -2 : 5, kcal: 100 }));
    const scaled = members.map((m) => ({ g: m.g * 1000, kcal: m.kcal / 4.184 }));
    expect(jointSafetyScreen(scaled, ['g', 'kcal']).status).toBe(jointSafetyScreen(members, ['g', 'kcal']).status);
  });

  it('a certificate authorizes only the exact fingerprint it was issued for; any input change invalidates it', () => {
    const inputs: CertificateInputs = {
      schedule: { days: [1, 2] },
      initialStateHash: 's0',
      profile: { w: 80 },
      screening: { flags: [] },
      constraints: [lock({ id: 'fat-cap', value: 30 })],
      versions: { engine: 'e', registry: 'r', policy: 1, contracts: CONTRACT_FINGERPRINT },
      requiredMargins: ['b', 'a'],
      drawProtocol: { stream: 'safetyAudit', M: 16, seed: 7, method: 'lhs' },
    };
    const fp = certificateFingerprint(inputs);
    expect(certificateFingerprint({ ...inputs, requiredMargins: ['a', 'b'] })).toBe(fp);
    expect(certificateFingerprint({ ...inputs, schedule: { days: [1, 3] } })).not.toBe(fp);
    expect(certificateFingerprint({ ...inputs, constraints: [lock({ id: 'fat-cap', value: 25 })] })).not.toBe(fp);
    expect(certificateFingerprint({ ...inputs, symptoms: [{ id: 's1' }] })).not.toBe(fp);
    const cert: SafetyCertificate = {
      kind: 'vitals.safetyCertificate',
      version: CONTRACT_VERSIONS.safetyCertificate,
      fingerprint: fp,
      episodeId: 'ep1',
      attempt: 1,
      status: 'verified',
      audit: jointSafetyScreen(Array.from({ length: 16 }, () => ({ a: 1 })), ['a']),
      constraintStatus: 'verified',
      createdAt: '2026-10-18T10:00:00Z',
    };
    expect(certificateAuthorizes(cert, fp)).toBe(true);
    expect(certificateAuthorizes(cert, certificateFingerprint({ ...inputs, initialStateHash: 's1' }))).toBe(false);
    expect(certificateAuthorizes({ ...cert, status: 'failed' }, fp)).toBe(false);
    expect(certificateAuthorizes({ ...cert, version: 0 }, fp)).toBe(false);
    expect(certificateAuthorizes(null, fp)).toBe(false);
  });

  it('only unresolved concerning exertional symptoms suspend exercise progression (D4-02)', () => {
    const s = (category: Parameters<typeof isConcerningUnresolved>[0]['category'], status: Parameters<typeof isConcerningUnresolved>[0]['status']) => ({ id: 'x', category, status, reportedAt: '2026-10-18T10:00:00Z', source: 'user' as const });
    expect(isConcerningUnresolved(s('exertionalChestDiscomfort', 'new'))).toBe(true);
    expect(isConcerningUnresolved(s('syncopeOrPresyncope', 'reviewNeeded'))).toBe(true);
    expect(isConcerningUnresolved(s('exertionalChestDiscomfort', 'resolved'))).toBe(false);
    expect(isConcerningUnresolved(s('musculoskeletal', 'new'))).toBe(false);
    // unknown/prefer-not is unresolved applicability (ask), not a diagnosed symptom
    expect(isConcerningUnresolved(s('disproportionateBreathlessness', 'unknown'))).toBe(false);
  });
});

/* ================================================================================================================= C6 */

describe('C6 status values, propagation and goal capability (D2-02, D2-06, D2-07, D2-08, D4-05, D4-08, D7-07, D8-02, D8-08, D8-09)', () => {
  it('status values never carry NaN/Infinity and only claim calibrated coverage when validated', () => {
    expect(statusValue({ status: 'estimated', value: Number.NaN, unit: 'kg' })).toMatchObject({ status: 'unknown', reasonCode: 'nonFiniteDropped' });
    expect(statusValue({ status: 'estimated', range: [74, 71], unit: 'kg' })).toMatchObject({ range: [71, 74], uncertaintyKind: 'parameterSensitivity', coverageStatus: 'unvalidated' });
    expect(statusValue({ status: 'estimated', range: [71, 74], unit: 'kg', uncertaintyKind: 'calibratedPrediction', coverageStatus: 'heldOutValidated' }).coverageStatus).toBe('heldOutValidated');
    expect(statusValue({ status: 'estimated', range: [71, 74], unit: 'kg', coverageStatus: 'heldOutValidated' }).coverageStatus).toBe('unvalidated');
    expect(statusValue({ status: 'observed', value: 500, unit: 'kcal' })).toMatchObject({ uncertaintyKind: 'none', coverageStatus: 'notApplicable' });
    expect(JSON.stringify(statusValue({ status: 'estimated', value: Number.POSITIVE_INFINITY, unit: 'kg' }))).not.toMatch(/null|Infinity|NaN/);
  });

  it('inline readouts: a unit-bearing range, the exact observed value, or a short status word', () => {
    expect(formatRange([71, 74], 'kg')).toBe(`71–74${NBSP}kg`);
    expect(formatRange([-1.5, 2664], 'kcal', 1)).toBe(`−1.5–2${NBSP}664.0${NBSP}kcal`);
    expect(inlineStatusText(statusValue({ status: 'estimated', range: [88.4, 89], unit: 'kg' }), 1)).toBe(`88.4–89.0${NBSP}kg`);
    expect(inlineStatusText(statusValue({ status: 'observed', value: 500, unit: 'kcal' }))).toBe(`500${NBSP}kcal`);
    expect(inlineStatusText(statusValue({ status: 'estimated', value: 72.3, unit: 'kg' }))).toBe('Estimated');
    expect(inlineStatusText(statusValue({ status: 'unavailable', value: 3, unit: 'mmol/L' }))).toBe('Unsupported');
    expect(inlineStatusText(statusValue({ status: 'notFound', unit: '' }))).toBe('Not found');
    expect(inlineStatusText(statusValue({ status: 'unchecked', unit: '' }))).toBe('Unchecked');
  });

  it('an unsupported lean partition propagates to fat, fat fraction, scale and downstream marker claims, not to independent outputs', () => {
    const closed = closeStatuses({ leanTissue: 'unavailable', hunger: 'estimated' });
    for (const id of ['fatMass', 'bodyFatPct', 'scaleWeight', 'ldl', 'apoB', 'liverFat', 'fastingGlucose']) expect(closed[id], id).toBe('scenario');
    expect(closed.hunger).toBe('estimated');
    expect(closeStatuses({ fatMass: 'modelLimit' }).waist).toBe('modelLimit');
    expect(closeStatuses({ fatMass: 'unchecked' }).waist).toBeUndefined();
    expect(worstStatus('observed', 'scenario', 'estimated')).toBe('scenario');
  });

  it('legacy feasibility statuses map to finite-search outcomes; unattainable is not impossible without a stored proof', () => {
    expect(searchOutcomeFromLegacy('unattainable')).toEqual({ outcome: 'notFoundWithinBudget', legacy: true });
    expect(searchOutcomeFromLegacy('unattainable', ['W-proof-1'])).toEqual({ outcome: 'provenPolicyConflict', proofIds: ['W-proof-1'], legacy: true });
    expect(searchOutcomeFromLegacy('attainable').outcome).toBe('foundUnderModel');
  });

  it('band metadata: zero draws export no band; ensembles are sensitivity ranges; legacy bands keep unvalidated semantics', () => {
    expect(bandMetaFor('draws', 0)).toMatchObject({ method: 'none', uncertaintyKind: 'none', coverage: 'notApplicable' });
    expect(bandMetaFor('draws', 32, 'deltaRebasedOnNominal')).toMatchObject({ method: 'draws', uncertaintyKind: 'parameterSensitivity', coverage: 'unvalidated', draws: 32, nominalInQuantiles: false });
    expect(bandMetaFor('fallback', 0)).toMatchObject({ method: 'fallback', uncertaintyKind: 'heuristic', draws: 0 });
    expect(LEGACY_BAND_META).toMatchObject({ uncertaintyKind: 'parameterSensitivity', coverage: 'unvalidated', version: 0 });
  });

  it('every metric has a capability; unvalidated proxies are not production goals; independently supported goals remain', () => {
    expect(Object.keys(GOAL_CAPABILITY).sort()).toEqual([...METRIC_IDS].sort());
    for (const id of ['autophagyIdx', 'ketoAdaptation', 'adherence', 'igf1', 'apoB', 'enduranceCapacity', 'micronutrientScore'] as MetricId[]) {
      expect(GOAL_CAPABILITY[id].availability, id).toBe('unavailable');
      expect(isProductionGoalEligible(id), id).toBe(false);
    }
    for (const id of ['scaleWeight', 'fatMass', 'leanTissue', 'bodyFatPct', 'strength', 'ldl', 'hunger'] as MetricId[]) expect(isProductionGoalEligible(id), id).toBe(true);
    // goal 'none' metrics are never eligible, whatever their capability
    for (const d of SERIES) if (d.kind === 'metric' && d.goal === 'none') expect(isProductionGoalEligible(d.id), d.id).toBe(false);
    // non-monotone quantities need a target/band
    expect(GOAL_CAPABILITY.sbp.satiation).toBe('required');
    expect(GOAL_CAPABILITY.glucose.satiation).toBe('required');
    expect(GOAL_CAPABILITY.bodyFatPct.operator).toBe('tissueFatFraction');
    expect(isProductionGoalEligible('notAMetric')).toBe(false);
  });
});
