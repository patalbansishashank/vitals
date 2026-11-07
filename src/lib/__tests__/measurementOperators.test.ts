// @vitest-environment node
/**
 * C4 measurement operators (`src/lib/measurementOperators.ts`): observables are compared only through operators, member
 * paths are transformed before quantiles, covariance is kept in differences, and lab quantities keep their kind.
 * Fixtures for D1-03, D1-06, D2-08, D4-05, D5-02, D5-03, D5-04, D5-07, D7-02, D7-06, D7-09.
 */
import { describe, expect, it } from 'vitest';
import {
  BALANCE_CORRECTION_BOUNDS,
  OPERATOR_TAGS,
  TISSUE_FAT_FRACTION_OPERATOR,
  TREND_FILTER_DEFAULTS,
  WATER_ADJUSTED_WAKE_OPERATOR,
  SCALE_WAKE_OPERATOR,
  applyOperator,
  boundBalanceCorrection,
  bpEpisodeStatus,
  bpSessionCoverage,
  comparability,
  dependentObservationGroups,
  differenceVariance,
  empiricalQuantiles,
  fastingSampleEligibility,
  fatMassObservation,
  gfrQuantityFromUnit,
  homaIr,
  indexGfr,
  jointDifferences,
  ketoneOperatorFor,
  legacyMeasurementContext,
  mostellerBsaM2,
  pairedFastingEligibility,
  trendObservationSdKg,
  trendProcessNoise,
  type BloodPressureEpisode,
  type ModelPath,
} from '../measurementOperators';

/** A constant model path from a name → value table (same value at every hour). */
const path = (v: Record<string, number>): ModelPath => ({ value: (name) => (name in v ? v[name]! : null) });

describe('operator tags and comparability', () => {
  it('scale, water-adjusted and legacy trend weight are not interchangeable although all are kg', () => {
    expect(comparability('scaleWake', 'waterAdjustedWake')).toEqual({ ok: false, reason: 'observableDiffers' });
    expect(comparability('legacyTrendWeight', 'scaleWake')).toEqual({ ok: false, reason: 'observableDiffers' });
    expect(comparability('legacyTrendWeight', 'waterAdjustedWake')).toEqual({ ok: true });
    expect(comparability('dxaBodyFat', 'biaBodyFat')).toEqual({ ok: false, reason: 'observableDiffers' });
    expect(comparability('tissueFatFraction', 'scaleBodyFatWake')).toEqual({ ok: false, reason: 'observableDiffers' });
    expect(comparability('egfrIndexed', 'gfrAbsolute').ok).toBe(false);
    expect(comparability('gfrAbsolute', 'creatinineClearance')).toEqual({ ok: false, reason: 'observableDiffers' });
    expect(comparability('bhbEndpoint', 'bhbHourlyMean').ok).toBe(false);
    expect(OPERATOR_TAGS.legacyTrendWeight.legacy).toBe(true);
  });

  it('legacy measurement context: only morning-fasted is standardized; absent stays unknown', () => {
    expect(legacyMeasurementContext('morningFasted')).toBe('standardized');
    expect(legacyMeasurementContext('evening')).toBe('unstandardized');
    expect(legacyMeasurementContext(undefined)).toBe('unknown');
    expect(legacyMeasurementContext('unknown')).toBe('unknown');
  });

  it('parent-derived observations group with their source (Navy with its girths), independent scans stay separate', () => {
    const obs = [
      { observationId: 'girth1', parents: [] },
      { observationId: 'navy1', parents: ['girth1'] },
      { observationId: 'rfm1', parents: ['girth1'] },
      { observationId: 'dxa1', parents: [] },
    ];
    const groups = dependentObservationGroups(obs).map((g) => g.map((o) => o.observationId));
    expect(groups).toEqual([['dxa1'], ['girth1', 'navy1', 'rfm1']]);
  });
});

describe('operators over member paths (D5-02, C6)', () => {
  it('water-adjusted mass is the same-path scale minus labile water; a pure water/creatine shift is not tissue drift', () => {
    const before = path({ scaleWeightKg: 80, labileWaterKg: 0.4 });
    const afterWaterShift = path({ scaleWeightKg: 81.2, labileWaterKg: 1.6 });
    expect(WATER_ADJUSTED_WAKE_OPERATOR.apply(before, 7)).toBeCloseTo(79.6, 9);
    expect(WATER_ADJUSTED_WAKE_OPERATOR.apply(afterWaterShift, 7)).toBeCloseTo(79.6, 9);
    expect(SCALE_WAKE_OPERATOR.apply(afterWaterShift, 7)).toBe(81.2);
    expect(WATER_ADJUSTED_WAKE_OPERATOR.apply(path({ scaleWeightKg: 80 }), 7)).toBeNull();
  });

  it('tissue fat fraction is 100·FM/(FM + FFM_act) at one sample', () => {
    expect(TISSUE_FAT_FRACTION_OPERATOR.apply(path({ fatMassKg: 20, ffmActKg: 60 }), 0)).toBe(25);
    expect(TISSUE_FAT_FRACTION_OPERATOR.apply(path({ fatMassKg: 0, ffmActKg: 0 }), 0)).toBeNull();
  });

  it('joint differences precede quantiles: correlated members differ from subtracting percentile endpoints', () => {
    // scale and water share a member-level component (correlated), so scale − water is tight per member
    const members = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => path({ scaleWeightKg: 80 + 0.3 * k, labileWaterKg: 0.3 * k + 0.02 * (k % 3) }));
    const predicted = applyOperator(WATER_ADJUSTED_WAKE_OPERATOR, members, 0);
    const d = jointDifferences(79.9, predicted);
    const q = empiricalQuantiles(d)!;
    // endpoint subtraction: P90(scale) − P10(water) style mixing exaggerates the spread
    const scaleQ = empiricalQuantiles(applyOperator(SCALE_WAKE_OPERATOR, members, 0) as number[])!;
    const waterQ = empiricalQuantiles(members.map((m) => m.value('labileWaterKg', 0)!))!;
    const endpointWidth = scaleQ[2]! - waterQ[0]! - (scaleQ[0]! - waterQ[2]!);
    expect(q[2]! - q[0]!).toBeLessThan(endpointWidth / 10);
    expect(empiricalQuantiles([])).toBeNull();
    expect(jointDifferences(Number.NaN, [1, 2])).toEqual([]);
  });

  it('Var(A − B) keeps the covariance and refuses inconsistent inputs', () => {
    expect(differenceVariance(0.25, 0.16, 0.1)).toBeCloseTo(0.21, 12);
    expect(differenceVariance(0.25, 0.16, 0)).toBeCloseTo(0.41, 12);
    expect(differenceVariance(0.01, 0.01, 0.5)).toBeNull();
    expect(differenceVariance(Number.NaN, 0.1, 0)).toBeNull();
  });
});

describe('trend filter and correction defaults (C4, D5-03, D5-04)', () => {
  it('unknown context uses the unstandardized observation SD; process noise scales with mass/75', () => {
    expect(trendObservationSdKg(75, 'standardized')).toBeCloseTo(75 * TREND_FILTER_DEFAULTS.relObsSdStandardized, 12);
    expect(trendObservationSdKg(75, 'unknown')).toBeCloseTo(75 * 0.0065, 12);
    expect(trendObservationSdKg(0, 'unknown')).toBeNull();
    const q = trendProcessNoise(150)!;
    expect(q.qWKg).toBeCloseTo(0.06, 12);
    expect(q.qRKgPerDay).toBeCloseTo(0.01, 12);
  });

  it('balance correction: ±300 kcal/day and at most 100 kcal/day change per decision, saturation reported', () => {
    expect(BALANCE_CORRECTION_BOUNDS).toMatchObject({ maxAbsKcalPerDay: 300, maxStepKcalPerDecision: 100 });
    expect(boundBalanceCorrection(250, 0)).toEqual({ appliedKcal: 100, saturated: false, stepLimited: true });
    expect(boundBalanceCorrection(120, 100)).toEqual({ appliedKcal: 120, saturated: false, stepLimited: false });
    expect(boundBalanceCorrection(450, 250)).toEqual({ appliedKcal: 300, saturated: true, stepLimited: true });
    expect(boundBalanceCorrection(-80, 0)).toEqual({ appliedKcal: -80, saturated: false, stepLimited: false });
    expect(boundBalanceCorrection(Number.NaN, 0)).toBeNull();
  });
});

describe('body composition, blood pressure and ketones (D1-03, D4-05, D5-07, D2-08)', () => {
  it('scan fat mass is preferred; percent converts only with a measured scan mass; otherwise percent-only operator', () => {
    expect(fatMassObservation({ method: 'dxa', bodyFatPct: 24, scanFatMassKg: 19.1, scanMassKg: 80 })).toEqual({ kind: 'fatMassKg', valueKg: 19.1, operator: 'dxaFatMass' });
    expect(fatMassObservation({ method: 'dxa', bodyFatPct: 24, scanMassKg: 80 })).toEqual({ kind: 'fatMassKg', valueKg: 19.2, operator: 'dxaFatMass' });
    expect(fatMassObservation({ method: 'bia', bodyFatPct: 24, scanMassKg: 80 })).toEqual({ kind: 'fatMassKg', valueKg: 19.2, operator: 'deviceFatMass' });
    expect(fatMassObservation({ method: 'bia', bodyFatPct: 24 })).toEqual({ kind: 'percentOnly', pct: 24, operator: 'biaBodyFat' });
    expect(fatMassObservation({ method: 'unknown', bodyFatPct: 24 })).toEqual({ kind: 'percentOnly', pct: 24, operator: 'scaleBodyFatWake' });
    expect(fatMassObservation({ method: 'dxa', bodyFatPct: 140 })).toBeNull();
  });

  it('a BP episode is paired with two readings at distinct instants; sporadic readings stay valid but incomplete', () => {
    const ep = (id: string, day: string, tod: BloodPressureEpisode['timeOfDay'], n = 2): BloodPressureEpisode => ({
      episodeId: id,
      timeOfDay: tod,
      readings: Array.from({ length: n }, (_, i) => ({ sbpMmHg: 128 + i, dbpMmHg: 82, occurredAt: `${day}T0${tod === 'morning' ? 7 : 8}:0${i}:00+05:30` })),
    });
    expect(bpEpisodeStatus(ep('a', '2026-10-18', 'morning'))).toBe('paired');
    expect(bpEpisodeStatus(ep('b', '2026-10-18', 'morning', 1))).toBe('incompleteProtocol');
    const days = ['2026-10-15', '2026-10-16', '2026-10-17'];
    const eps = days.flatMap((d) => [ep(`m${d}`, d, 'morning'), ep(`e${d}`, d, 'evening')]);
    expect(bpSessionCoverage(eps)).toEqual({ protocolDays: 3, minimumMet: true, preferredMet: false });
    expect(bpSessionCoverage([ep('x', '2026-10-15', 'morning')])).toEqual({ protocolDays: 0, minimumMet: false, preferredMet: false });
  });

  it('only blood D-BHB maps to the endpoint operator; urine and breath are never converted', () => {
    expect(ketoneOperatorFor('capillaryBlood')).toBe('bhbEndpoint');
    expect(ketoneOperatorFor('urine')).toBeNull();
    expect(ketoneOperatorFor('breath')).toBeNull();
    expect(ketoneOperatorFor(undefined)).toBeNull();
  });
});

describe('kidney quantities and lab samples (D7-02, D7-06, D7-09)', () => {
  it('bare mL/min is indexing-unconfirmed; /1.73 m² is indexed eGFR', () => {
    expect(gfrQuantityFromUnit('mL/min/1.73m²')).toBe('egfrIndexed');
    expect(gfrQuantityFromUnit('mL/min/1.73 m2')).toBe('egfrIndexed');
    expect(gfrQuantityFromUnit('mL/min')).toBe('indexingUnconfirmed');
    expect(gfrQuantityFromUnit(undefined)).toBe('indexingUnconfirmed');
  });

  it('confirmed absolute GFR re-indexes with sample-date anthropometry: 70 mL/min at BSA 2.2 m² → 55.045', () => {
    expect(mostellerBsaM2(176, 99)).toBeCloseTo(2.2, 12);
    const r = indexGfr({ valueMlMin: 70, quantity: 'gfrAbsolute', sampleDate: '2026-10-01', heightCm: 176, weightKg: 99, anthropometryDate: '2026-10-01' });
    expect(r.status).toBe('converted');
    if (r.status === 'converted') {
      expect(r.indexedMlMin173).toBeCloseTo(55.04545, 5);
      expect(r).toMatchObject({ absoluteMlMin: 70, bsaMethod: 'mosteller', anthropometry: { date: '2026-10-01' } });
    }
    expect(indexGfr({ valueMlMin: 70, quantity: 'indexingUnconfirmed', sampleDate: '2026-10-01' })).toEqual({ status: 'refused', reason: 'indexingUnconfirmed' });
    expect(indexGfr({ valueMlMin: 70, quantity: 'creatinineClearance', sampleDate: '2026-10-01' })).toEqual({ status: 'refused', reason: 'creatinineClearanceNotGfr' });
    expect(indexGfr({ valueMlMin: 70, quantity: 'gfrAbsolute', sampleDate: '2026-10-01' })).toEqual({ status: 'refused', reason: 'anthropometryMissing' });
    expect(indexGfr({ valueMlMin: 70, quantity: 'gfrAbsolute', sampleDate: '2026-10-01', heightCm: 176, weightKg: 99, anthropometryDate: '2026-06-01' })).toEqual({ status: 'refused', reason: 'anthropometryNotSampleDate' });
  });

  it('fasting eligibility: ≥ 8 h or an explicit fasting status; unknown stays unknown', () => {
    expect(fastingSampleEligibility({ date: '2026-10-01', fastingHours: 10 })).toBe('eligible');
    expect(fastingSampleEligibility({ date: '2026-10-01', fastingHours: 5 })).toBe('notFasting');
    expect(fastingSampleEligibility({ date: '2026-10-01', fastingStatus: 'fasting' })).toBe('eligible');
    expect(fastingSampleEligibility({ date: '2026-10-01' })).toBe('unknown');
  });

  it('HOMA-IR only from a same-draw (or confirmed) fasting pair without exogenous insulin', () => {
    const g = { sampleId: 'd1', date: '2026-10-01', fastingHours: 10 };
    const i = { sampleId: 'd1', date: '2026-10-01', fastingHours: 10 };
    const ok = pairedFastingEligibility(g, i);
    expect(ok).toEqual({ eligible: true, reasons: [] });
    expect(homaIr(5, 9, ok)).toBeCloseTo(2, 12);
    // same calendar date alone is not a pair
    const sameDate = pairedFastingEligibility({ date: '2026-10-01', fastingHours: 10 }, { date: '2026-10-01', fastingHours: 10 });
    expect(sameDate.reasons).toEqual(['pairingUnknown']);
    expect(homaIr(5, 9, sameDate)).toBeNull();
    expect(pairedFastingEligibility({ ...g, sampleId: 'g7', confirmedPairWith: 'i9' }, { ...i, sampleId: 'i9' }).eligible).toBe(true);
    expect(pairedFastingEligibility({ ...g }, { ...i, fastingHours: undefined }).reasons).toEqual(['fastingUnknown']);
    expect(pairedFastingEligibility({ ...g, exogenousInsulin: true }, i).reasons).toEqual(['exogenousInsulin']);
  });
});
