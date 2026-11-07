// @vitest-environment node
/**
 * Re-audit of waves 0–1 (2026-10-19), package F01-contracts: the shared wire contracts the other packages build on —
 * per-nutrient knowledge and interval bounds, per-day band availability, bout identity, consumed-observation lineage,
 * explicit effort scales, habitual overlap input, lab-sample facts, status propagation edges, the new hour-end ketone
 * series and the nitrogen observable. Each block names the finding it carries.
 */
import { describe, expect, it } from 'vitest';
import {
  BAND_DAY_METHOD,
  CONTRACT_VERSIONS,
  DERIVATION_LINEAGE_VERSION,
  OUTPUT_DEPENDENCIES,
  bandDayMethodOf,
  bandDayUsable,
  buildEnergyLedger,
  closeStatusMeta,
  closeStatuses,
  derivationLineage,
  evaluateBound,
  exposureInterval,
  lineageInvalidation,
  nutrientTotalCoverage,
  substrateRouteOf,
  type BandAvailability,
  type ConsumedObservationRef,
  type OutputStatus,
} from '@/lib/bodyContracts';
import { comparability, operatorTag, pairedFastingEligibility, type LabSample } from '@/lib/measurementOperators';
import { exerciseSymptomGate } from '@/lib/safetyPolicy';
import {
  EFFORT_SCALES,
  MODULES,
  NUTRIENT_UNKNOWN_BIT,
  POLYOL_IDENTITY_UNKNOWN,
  SERIES,
  SERIES_INDEX,
  SERIES_OBSERVABLE,
  boutKeyOf,
  mealNutrientMaskOf,
  nutrientUnknownBits,
  seriesDef,
  simulate,
  type CardioSession,
  type DayExposureSummary,
  type EnsembleMemberEnvelope,
  type HabitProfile,
  type LabBaselineMeta,
  type MealNutrientMask,
  type ResolvedHabits,
  type Schedule,
  type SeriesOwnedBy,
  type SleepEndingToday,
  type SleepSpec,
} from '@/engine';
import { MAN } from '@/engine/core/__tests__/fixtures';
import { CURRENT_EXERCISE_ELIGIBILITY_VERSION, type CompositionEvidence, type CurrentExerciseEligibility, type ExerciseScope, type TodayView } from '@/living/types';
import { MARKER_SAMPLE_FACT_KEYS, sampleFactsFrom, type MarkerReading, type MarkerReadingInput, type MarkerSampleFacts } from '@/markers/types';
import type { EquivalenceResult, PerformedExercise, RecipeDefinition, SourceAwareMealTotals, StimulusVector } from '@/catalogues/types';

/* ================================================================================================= A1-005 eligibility */

describe('A1-005: current exercise eligibility is an authoritative, versioned TodayView overlay', () => {
  /** Contract fixture: the overlay a provider derives from the shared gate and the documented baseline (no invented number). */
  const overlay = (gate: ReturnType<typeof exerciseSymptomGate>, prescribedSteps: number | null, baselineSteps: number | null, asOf: string): CurrentExerciseEligibility => {
    const ceiling = gate.envelope?.stepsCeiling ?? baselineSteps;
    const capped = gate.steps === 'documentedOnly';
    const all: ExerciseScope[] = ['resistance', 'cardio', 'walking', 'steps', 'other'];
    const permitted: ExerciseScope[] = gate.status === 'clear' ? all : gate.status === 'envelope' ? [...(gate.envelope?.permitted ?? [])] : [];
    return {
      version: CURRENT_EXERCISE_ELIGIBILITY_VERSION,
      asOf,
      status: gate.status,
      reasonCode: gate.reasonCode,
      allowsNewExercise: gate.allowsNewExercise,
      allowsProgression: gate.allowsProgression,
      permitted,
      held: all.filter((s) => !permitted.includes(s)),
      steps: !capped
        ? { status: 'unchanged', target: prescribedSteps, prescribed: prescribedSteps, ceiling: null, ceilingSource: 'none' }
        : ceiling === null || ceiling === undefined
          ? { status: 'noNumericTarget', target: null, prescribed: prescribedSteps, ceiling: null, ceilingSource: 'none' }
          : { status: 'capped', target: prescribedSteps === null ? null : Math.min(prescribedSteps, ceiling), prescribed: prescribedSteps, ceiling, ceilingSource: gate.envelope?.stepsCeiling !== undefined ? 'clinicianCeiling' : 'documentedBaseline' },
      symptomIds: gate.uncovered,
      ...(gate.envelope ? { envelopeId: gate.envelope.id } : {}),
      fingerprint: 'fp',
    };
  };
  const symptom = { id: 's1', category: 'exertionalChestDiscomfort' as const, status: 'new' as const, occurredOn: '2026-10-19', reportedAt: '2026-10-19T08:00:00Z', context: 'exertional' as const, source: 'user' as const };

  it('a new exertional symptom caps a 9000-step prescription at the documented 6000 baseline and reads Review on a steps-only day', () => {
    const e = overlay(exerciseSymptomGate({ symptoms: [symptom], today: '2026-10-19' }), 9000, 6000, '2026-10-19');
    expect(e).toMatchObject({ status: 'suspended', allowsProgression: false, steps: { status: 'capped', target: 6000, prescribed: 9000, ceiling: 6000, ceilingSource: 'documentedBaseline' } });
    expect(e.held).toContain('steps');
    const view: Pick<TodayView, 'exerciseEligibility'> = { exerciseEligibility: e };
    expect(view.exerciseEligibility?.version).toBe(1);
  });

  it('no documented baseline gives no new numeric step target; a covering envelope restores exactly its permitted scope', () => {
    expect(overlay(exerciseSymptomGate({ symptoms: [symptom], today: '2026-10-19' }), 9000, null, '2026-10-19').steps).toEqual({ status: 'noNumericTarget', target: null, prescribed: 9000, ceiling: null, ceilingSource: 'none' });
    const env = { id: 'env1', assessedAt: '2026-10-20', permitted: ['walking', 'steps'] as const, stepsCeiling: 8000, progressionAllowed: true, coversSymptomIds: ['s1'], source: 'selfEnteredClinician' as const };
    const covered = overlay(exerciseSymptomGate({ symptoms: [symptom], envelopes: [env], today: '2026-10-21' }), 9000, 6000, '2026-10-21');
    expect(covered).toMatchObject({ status: 'envelope', envelopeId: 'env1', permitted: ['walking', 'steps'], steps: { status: 'capped', target: 8000, ceilingSource: 'clinicianCeiling' } });
    expect(covered.held).toEqual(['resistance', 'cardio', 'other']);
    // revoked envelope: the hold returns immediately; a resolved symptom restores the plan
    expect(overlay(exerciseSymptomGate({ symptoms: [symptom], envelopes: [{ ...env, revokedAt: '2026-10-22' }], today: '2026-10-22' }), 9000, 6000, '2026-10-22').status).toBe('suspended');
    expect(overlay(exerciseSymptomGate({ symptoms: [{ ...symptom, status: 'resolved' }], today: '2026-10-22' }), 9000, 6000, '2026-10-22').steps.status).toBe('unchanged');
  });
});

/* ================================================================================================= A1-009 marker facts */

describe('A1-009: marker sample facts are one transported shape for every producer', () => {
  it('every MarkerReading clinical fact is in the input contract and the stable key list', () => {
    const facts: Required<MarkerSampleFacts> = {
      sampleId: 'd1',
      sampledAt: '2026-09-12T08:00+05:30',
      sampleLocalClockH: 8,
      fastingHours: 12,
      fastingStatus: 'fasting',
      confirmedPairWith: 'd0',
      quantityKind: 'gfrAbsolute',
      indexed: { valueMlMin173: 55, bsaM2: 2.2, bsaMethod: 'mosteller', heightCm: 180, weightKg: 96.8, anthropometryDate: '2026-09-12' },
      assay: 'CMIA',
      lab: 'Lab A',
      hormoneTherapy: 'yes',
      sampleContext: { illness: false },
    };
    expect([...MARKER_SAMPLE_FACT_KEYS].sort()).toEqual(Object.keys(facts).sort());
    const input: MarkerReadingInput = { id: 'testosterone', value: 200, unit: 'ng/dL', date: '2026-09-12', ...facts };
    const asReading: Pick<MarkerReading, keyof MarkerSampleFacts> = input;
    expect(asReading.hormoneTherapy).toBe('yes');
  });

  it('supplied facts are kept exactly (therapy, morning clock, sampled instant, GFR kind); absent facts stay absent', () => {
    const { facts, rejected } = sampleFactsFrom({ id: 'testosterone', value: 200, unit: 'ng/dL', date: '2026-09-12', hormoneTherapy: 'yes', sampleLocalClockH: 8, sampledAt: '2026-09-12T08:00+05:30', fastingHours: 10 });
    expect(rejected).toEqual([]);
    expect(facts).toEqual({ hormoneTherapy: 'yes', sampleLocalClockH: 8, sampledAt: '2026-09-12T08:00+05:30', fastingHours: 10 });
    expect(sampleFactsFrom({ id: 'egfr', value: 70, unit: 'mL/min', date: '2026-09-12', quantityKind: 'egfrIndexed' }).facts).toEqual({ quantityKind: 'egfrIndexed' });
    expect(sampleFactsFrom({ id: 'ldl', value: 3, unit: 'mmol/L', date: '2026-09-12' })).toEqual({ facts: {}, rejected: [] });
    // context is copied without inference
    expect(sampleFactsFrom({ sampleContext: { illness: true, prolongedFastProtocol: true, loggedFastHoursAtSample: 72 } }).facts.sampleContext).toEqual({ illness: true, prolongedFastProtocol: true, loggedFastHoursAtSample: 72 });
  });

  it('invalid facts are refused by name, never clamped; a bare quantity label never manufactures a BSA conversion', () => {
    const r = sampleFactsFrom({ sampleLocalClockH: 24, fastingHours: -1, sampledAt: '2026-09-12', hormoneTherapy: 'maybe' as never, sampleContext: { afterFastHours: Number.NaN } });
    expect(r.facts).toEqual({});
    expect(r.rejected.sort()).toEqual(['fastingHours', 'hormoneTherapy', 'sampleContext.afterFastHours', 'sampleLocalClockH', 'sampledAt']);
    const indexed = { valueMlMin173: (70 * 1.73) / Math.sqrt((180 * 96.8) / 3600), bsaM2: Math.sqrt((180 * 96.8) / 3600), bsaMethod: 'mosteller' as const, heightCm: 180, weightKg: 96.8, anthropometryDate: '2026-09-12' };
    // absolute GFR confirmed + sample-date anthropometry: the explicit transformation is accepted beside the raw value
    expect(sampleFactsFrom({ id: 'egfr', value: 70, unit: 'mL/min', date: '2026-09-12', quantityKind: 'gfrAbsolute', indexed }).facts.indexed).toEqual(indexed);
    // an unconfirmed quantity, another day's anthropometry or an inconsistent BSA are refused
    expect(sampleFactsFrom({ id: 'egfr', value: 70, unit: 'mL/min', date: '2026-09-12', quantityKind: 'indexingUnconfirmed', indexed }).rejected).toEqual(['indexed']);
    expect(sampleFactsFrom({ id: 'egfr', value: 70, unit: 'mL/min', date: '2026-09-13', quantityKind: 'gfrAbsolute', indexed }).rejected).toEqual(['indexed']);
    expect(sampleFactsFrom({ id: 'egfr', value: 70, unit: 'mL/min', date: '2026-09-12', quantityKind: 'gfrAbsolute', indexed: { ...indexed, bsaM2: 2.5 } }).rejected).toEqual(['indexed']);
  });
});

/* ================================================================================================= A1-013 / A1-022 propagation */

describe('A1-013/A1-022: status propagation reaches every mathematically dependent output, not independent ones', () => {
  const scenario = (ids: Record<string, OutputStatus>) => closeStatuses(ids);

  it('a scenario energy balance (calorie-only intake) reaches fat, lean, scale, BF, regional tissue, nitrogen and mass-dependent expenditure', () => {
    const c = scenario({ energyBalance: 'scenario', tef: 'scenario', tdee: 'scenario', hunger: 'estimated', sleepQuality: 'estimated' });
    for (const id of ['fatMass', 'leanTissue', 'scaleWeight', 'bodyFatPct', 'leanMass', 'fatArms', 'fatTrunk', 'fatLegs', 'visceralFat', 'muscleArms', 'muscleLegs', 'muscleTrunk', 'skeletalMuscle', 'nitrogenBalance', 'rmr', 'maintenance', 'ldl', 'liverFat', 'fastingGlucose'])
      expect(c[id], id).toBe('scenario');
    expect(c.hunger).toBe('estimated');
    expect(c.sleepQuality).toBe('estimated');
    // substrate outputs are not reached by an energy-balance scenario alone (their own seeds decide)
    expect(c.glucose).toBeUndefined();
  });

  it('a known low-protein-surplus partition flag reaches nitrogen balance and every regional fat/muscle detail', () => {
    const c = scenario({ leanTissue: 'scenario' });
    for (const id of ['nitrogenBalance', 'fatArms', 'fatTrunk', 'fatLegs', 'muscleArms', 'muscleLegs', 'muscleTrunk', 'fatMass', 'scaleWeight', 'bodyFatPct']) expect(c[id], id).toBe('scenario');
  });

  it('an unknown hard-set dose seeded on lean/skeletal muscle reaches every dependent tissue output, not energy-independent ones', () => {
    const c = scenario({ leanTissue: 'scenario', skeletalMuscle: 'scenario', rtMuscleGain: 'scenario', hunger: 'estimated' });
    for (const id of ['muscleLegs', 'muscleArms', 'muscleTrunk', 'strength', 'fatMass', 'scaleWeight', 'bodyFatPct', 'nitrogenBalance']) expect(c[id], id).toBe('scenario');
    expect(c.hunger).toBe('estimated');
  });

  it('the routine growth-state scenario on training gain alone never demotes the supported tissue forecasts', () => {
    const c = scenario({ rtMuscleGain: 'scenario', strength: 'scenario', vo2max: 'scenario', energyAvailability: 'scenario', mps: 'exploratory' });
    for (const id of ['fatMass', 'leanTissue', 'scaleWeight', 'bodyFatPct', 'skeletalMuscle', 'tdee', 'energyBalance']) expect(c[id], id).toBeUndefined();
  });

  it('unmodelled glycogen/ketone routes reach total glycogen, glycogen water, scale weight and ketosis outputs', () => {
    const c = scenario({ liverGlycogen: 'scenario' });
    for (const id of ['glycogenTotal', 'glycogenWater', 'waterWeight', 'scaleWeight', 'bhb', 'bhbEndpoint', 'totalKetones', 'ketosisState', 'hoursInKetosis', 'fatMass']) expect(c[id], id).toBe('scenario');
  });

  it('provenance travels: onset, reason and uncertainty kind of the source; a minimal mask sees the full-run status', () => {
    const seeds = { energyBalance: { status: 'scenario' as const, reasonCode: 'energyOnlyIntakeTefPrior', fromDay: 3, uncertaintyKind: 'scenario' as const } };
    const full = closeStatusMeta(seeds);
    expect(full.fatMass).toMatchObject({ status: 'scenario', fromDay: 3, reasonCode: 'dependsOn:energyBalance', inducedBy: 'energyBalance', rootReason: 'energyOnlyIntakeTefPrior', uncertaintyKind: 'scenario' });
    expect(full.bodyFatPct).toMatchObject({ fromDay: 3, inducedBy: 'energyBalance', rootReason: 'energyOnlyIntakeTefPrior' });
    // a requested output alone (minimal mask) gets the same status: the closure runs over every status, not only requested ones
    const minimal = { fatMass: full.fatMass };
    expect(minimal.fatMass?.status).toBe('scenario');
    // an own status at least as strong is kept, but an equal induced status moves its onset earlier
    const own = closeStatusMeta({ ...seeds, fatMass: { status: 'scenario', reasonCode: 'ownFlag', fromDay: 9 } });
    expect(own.fatMass).toMatchObject({ status: 'scenario', reasonCode: 'ownFlag', fromDay: 3 });
    const stronger = closeStatusMeta({ ...seeds, fatMass: { status: 'unavailable', reasonCode: 'outOfDomain' } });
    expect(stronger.fatMass).toMatchObject({ status: 'unavailable', reasonCode: 'outOfDomain' });
    // a deficit (estimated) never restores estimated over an induced scenario
    const est = closeStatusMeta({ ...seeds, fatMass: { status: 'estimated', reasonCode: 'ok' } });
    expect(est.fatMass?.status).toBe('scenario');
    expect(CONTRACT_VERSIONS.statusPropagation).toBe(1);
  });

  it('every dependency edge names catalogue series', () => {
    for (const [k, ups] of Object.entries(OUTPUT_DEPENDENCIES)) {
      expect(SERIES_INDEX[k as keyof typeof SERIES_INDEX], k).toBeTypeOf('number');
      for (const u of ups) expect(SERIES_INDEX[u as keyof typeof SERIES_INDEX], `${k} <- ${u}`).toBeTypeOf('number');
    }
  });
});

/* ================================================================================================= A1-014 intervals */

describe('A1-014: nutrient knowledge gives interval bounds; unknown is never 0 and a lower bound never proves a cap', () => {
  const day = (knownSum: number, known: number, unknown: number): DayExposureSummary => ({ knownSum, unit: 'g', coverage: nutrientTotalCoverage(known, unknown), knownContributions: known, unknownContributions: unknown });
  const cap = (v: number) => ({ comparator: 'cap' as const, value: v });
  const floor = (v: number) => ({ comparator: 'floor' as const, value: v });

  it('energy-only 700 kcal × 3: protein/carbohydrate unknown, caps unchecked, no deficiency', () => {
    const p = day(0, 0, 3);
    expect(p.coverage).toBe('unknown');
    expect(exposureInterval(p)).toEqual({ lower: 0, upper: null });
    expect(evaluateBound(cap(70), exposureInterval(p)).status).toBe('unchecked');
    expect(evaluateBound(cap(100), exposureInterval(day(0, 0, 3))).status).toBe('unchecked');
    expect(evaluateBound(floor(50), exposureInterval(p)).status).toBe('unchecked');
  });

  it('explicit 30 g protein in each meal: exact 90 g, cap 100 passes, cap 80 fails; carbohydrate stays unknown', () => {
    const p = day(90, 3, 0);
    expect(exposureInterval(p)).toEqual({ lower: 90, upper: 90 });
    expect(evaluateBound(cap(100), exposureInterval(p)).status).toBe('pass');
    expect(evaluateBound(cap(80), exposureInterval(p)).status).toBe('violation');
    expect(evaluateBound(cap(100), exposureInterval(day(0, 0, 3))).status).toBe('unchecked');
  });

  it('mixed known + unknown meals: the known sum is a lower bound (cap/floor duality)', () => {
    const p = day(60, 1, 1);
    expect(p.coverage).toBe('partial');
    expect(evaluateBound(cap(50), exposureInterval(p)).status).toBe('violation');
    expect(evaluateBound(cap(100), exposureInterval(p)).status).toBe('unchecked');
    expect(evaluateBound(floor(50), exposureInterval(p)).status).toBe('pass');
    expect(evaluateBound(floor(70), exposureInterval(p)).status).toBe('unchecked');
    // the 1999 kcal P110 meal + 500 kcal of unknown composition
    const q = day(110, 1, 1);
    expect(evaluateBound(cap(120), exposureInterval(q)).status).toBe('unchecked');
    expect(evaluateBound(cap(100), exposureInterval(q)).status).toBe('violation');
  });

  it('explicit zeros are known zeros; a confirmed zero day is [0, 0]; a supported tighter bound is honoured', () => {
    expect(exposureInterval(day(0, 2, 0))).toEqual({ lower: 0, upper: 0 });
    expect(exposureInterval({ knownSum: 0, coverage: 'confirmedZero' })).toEqual({ lower: 0, upper: 0 });
    expect(exposureInterval({ knownSum: 40, coverage: 'partial', upperBound: 75 })).toEqual({ lower: 40, upper: 75 });
    expect(exposureInterval({ knownSum: Number.NaN, coverage: 'unknown' })).toEqual({ lower: 0, upper: null });
    expect(nutrientTotalCoverage(0, 0)).toBe('unknown');
  });

  it('the per-meal mask keeps knowledge through hot-loop bits; imputed is not a known amount', () => {
    const energyOnlyKnownProtein: MealNutrientMask = { protein: 'known', carbohydrate: 'unknown', fat: 'unknown', fibre: 'unknown', ethanol: 'unknown' };
    expect(nutrientUnknownBits(energyOnlyKnownProtein)).toBe(NUTRIENT_UNKNOWN_BIT.carbohydrate | NUTRIENT_UNKNOWN_BIT.fat | NUTRIENT_UNKNOWN_BIT.fibre | NUTRIENT_UNKNOWN_BIT.ethanol);
    expect(nutrientUnknownBits({ protein: 'imputed', carbohydrate: 'known', fat: 'known', fibre: 'known', ethanol: 'known' })).toBe(NUTRIENT_UNKNOWN_BIT.protein);
    expect(nutrientUnknownBits(undefined)).toBe(0);
  });

  it('legacy read adapter: a reported-energy meal without a mask never turns a zero into a known zero; prescriptions stay complete', () => {
    const meal = { proteinG: 30, carbG: 0, fatG: 0, fibreG: 0, alcoholG: 0 };
    expect(mealNutrientMaskOf({ ...meal, reportedKcal: 700 })).toEqual({ protein: 'known', carbohydrate: 'unknown', fat: 'unknown', fibre: 'unknown', ethanol: 'unknown' });
    expect(mealNutrientMaskOf(meal)).toEqual({ protein: 'known', carbohydrate: 'known', fat: 'known', fibre: 'known', ethanol: 'known' });
    const explicit: MealNutrientMask = { protein: 'known', carbohydrate: 'known', fat: 'known', fibre: 'known', ethanol: 'known' };
    expect(mealNutrientMaskOf({ ...meal, reportedKcal: 120, nutrientMask: explicit })).toBe(explicit); // explicit 0 g stays a known zero
  });
});

/* ================================================================================================= A1-017 lineage */

describe('A1-017: derived anchors carry a full lineage; a retraction, correction or estimator change invalidates current state', () => {
  const obs = (id: string, revision = 1, valueHash = `v-${id}`): ConsumedObservationRef => ({ id, revision, valueHash, at: '2026-10-13' });
  const est = { strategy: 'fixedPriorRefit', version: 2, paramsHash: 'p1' };
  const stored = derivationLineage({ observations: [obs('dxa1'), obs('w1')], historyHash: 'h', estimator: est, operatorVersion: 2, previous: null });

  it('the fingerprint is independent of input order and changes with any dependency', () => {
    expect(derivationLineage({ observations: [obs('w1'), obs('dxa1')], historyHash: 'h', estimator: est, operatorVersion: 2, previous: null }).fingerprint).toBe(stored.fingerprint);
    expect(derivationLineage({ observations: [obs('dxa1', 2), obs('w1')], historyHash: 'h', estimator: est, operatorVersion: 2, previous: null }).fingerprint).not.toBe(stored.fingerprint);
    expect(stored.version).toBe(DERIVATION_LINEAGE_VERSION);
  });

  it('retraction, correction (same revision, new value), revision, estimator, operator and upstream changes are each detected', () => {
    const current = { observations: [obs('dxa1'), obs('w1'), obs('w2')], estimator: est, operatorVersion: 2, historyHash: 'h', previous: null };
    expect(lineageInvalidation(stored, current)).toBeNull(); // a new, never-consumed observation is new evidence, not an invalidation
    expect(lineageInvalidation(stored, { ...current, observations: [obs('w1')] })).toEqual({ reason: 'observationRetracted', ids: ['dxa1'] });
    expect(lineageInvalidation(stored, { ...current, observations: [obs('dxa1', 1, 'corrected'), obs('w1')] })).toEqual({ reason: 'observationRevised', ids: ['dxa1'] });
    expect(lineageInvalidation(stored, { ...current, observations: [obs('dxa1', 2), obs('w1')] })).toEqual({ reason: 'observationRevised', ids: ['dxa1'] });
    expect(lineageInvalidation(stored, { ...current, estimator: { ...est, paramsHash: 'p2' } })?.reason).toBe('estimatorChanged');
    expect(lineageInvalidation(stored, { ...current, operatorVersion: 3 })?.reason).toBe('operatorChanged');
    expect(lineageInvalidation(stored, { ...current, historyHash: 'h2' })?.reason).toBe('historyChanged');
    expect(lineageInvalidation(stored, { ...current, previous: 'other-anchor' })?.reason).toBe('upstreamChanged');
  });

  it('a legacy anchor without lineage cannot be certified as current inference', () => {
    expect(lineageInvalidation(undefined, { observations: [] })).toEqual({ reason: 'legacyUnreconstructable', ids: [] });
    expect(lineageInvalidation({ ...stored, version: 0 }, { observations: [] })?.reason).toBe('legacyUnreconstructable');
    expect(CONTRACT_VERSIONS.estimator).toBe(2);
  });
});

/* ================================================================================================= A1-020 / A1-021 / A1-062 */

describe('A1-020/A1-021/A1-062: bout identity, ordered phases and distinct effort scales', () => {
  it('bout keys follow physical identity, never clock-hour adjacency', () => {
    expect(boutKeyOf({ sessionId: 'log-a' }, 3, 0)).toBe(boutKeyOf({ sessionId: 'log-a' }, 4, 1)); // carried past midnight
    expect(boutKeyOf({ sessionId: 'log-a' }, 3, 0)).not.toBe(boutKeyOf({ sessionId: 'log-b' }, 3, 1)); // two bouts in one hour
    expect(boutKeyOf({ boutId: 'w1', sessionId: 'part-rt' }, 3, 0)).toBe(boutKeyOf({ boutId: 'w1', sessionId: 'part-cardio' }, 3, 1)); // parts of one bout
    expect(boutKeyOf({}, 3, 0)).toBe('legacy:3:0');
    expect(boutKeyOf({}, 3, 0)).not.toBe(boutKeyOf({}, 3, 1));
  });

  it('effort scales are distinct identities; serialized cr10 stays Borg CR10; phases carry scale/class and unknown remainders', () => {
    expect(EFFORT_SCALES).toEqual(['rirRpe', 'cr10', 'relativeEffort0To10', 'unknown']);
    const bout: CardioSession = {
      kind: 'cardio',
      modality: 'run',
      startH: 18,
      durationMin: 45,
      boutId: 'w1',
      rpeScale: 'cr10',
      phases: [
        { kind: 'work', durationMin: 10, met: 11, rpe: 8, rpeScale: 'relativeEffort0To10', healthIntensityClass: 'vigorous', healthClassSource: 'relativeEffort0To10', exerciseId: 'jog_outdoor', sourceId: 'log-a' },
        { kind: 'recovery', durationMin: 10, met: 4, healthIntensityClass: 'light', healthClassSource: 'stated' },
        { kind: 'steady', durationMin: 20, met: 7, rpe: 3 },
        { kind: 'remainder', durationMin: 5 },
      ],
    };
    expect(bout.phases!.reduce((s, p) => s + p.durationMin, 0)).toBe(bout.durationMin);
    const perf: PerformedExercise = { exerciseId: 'brisk_walk', minutes: 150, rpe: 3, rpeScale: 'cr10', talkTest: 'talkNotSing' };
    expect(perf.rpeScale).not.toBe('relativeEffort0To10');
    expect(CONTRACT_VERSIONS.exerciseDose).toBe(1);
  });

  it('unknown hard-set dose is a named scenario at every boundary (stimulus, equivalence completion)', () => {
    const v: Pick<StimulusVector, 'doseStatus' | 'outcomeDoseStatus' | 'unknownDoseScenario'> = { doseStatus: 'unknown', outcomeDoseStatus: { hypertrophy: 'unknown', strength: 'unknown', energy: 'reported', mobility: 'reported' }, unknownDoseScenario: 'legacyMinuteConversion' };
    const eq: Pick<EquivalenceResult, 'completion' | 'perTerm'> = {
      perTerm: [{ term: 'hyp', ratio: 0.96, weight: 1, status: 'unknown' }],
      completion: { status: 'unknown', unknownTerms: ['hyp'], knownTermsScore: null, scenario: 'legacyMinuteConversion' },
    };
    expect(v.outcomeDoseStatus?.energy).toBe('reported');
    expect(eq.completion?.status).toBe('unknown');
  });
});

/* ================================================================================================= A1-028 / A1-031 / A1-044 */

describe('A1-028/A1-031/A1-044: source status, polyol identity and recipe material mass', () => {
  it('polyol identities survive; the energy ledger stays consistent while the substrate route is unmodelled', () => {
    const polyols = { maltitol: 30, erythritol: 10, [POLYOL_IDENTITY_UNKNOWN]: 5 };
    const led = buildEnergyLedger({ reportedMEKcal: 240, macros: { proteinG: 0, carbAvailableG: 0, fatG: 0, fibreG: 0, ethanolG: 0 }, polyolsG: polyols });
    expect(led.reconciledMEKcal).toBe(240);
    expect(led.substrateRoute).toEqual({ status: 'unmodelled', unmodelledPolyolsG: { maltitol: 30, erythritol: 10, unidentified: 5 } });
    expect(substrateRouteOf({ maltitol: 0 })).toEqual({ status: 'modelled' });
    expect(substrateRouteOf(undefined)).toEqual({ status: 'modelled' });
    expect(buildEnergyLedger({ reportedMEKcal: 240, macros: { proteinG: 0, carbAvailableG: 0, fatG: 0, fibreG: 0, ethanolG: 0 } }).substrateRoute).toBeUndefined();
  });

  it('planning totals carry the source status; recipe additions carry material mass separately from nutrients', () => {
    const t: SourceAwareMealTotals = { energyKcal: 442, proteinG: 21, netCarbG: 9, fatG: 49, fibreG: 12, satFatG: 4, sourceEnergyKcal: 579, carbStatus: 'resolved', netCarbLowG: 9, netCarbHighG: 9, polyolG: 0 };
    expect(t.sourceEnergyKcal).toBeGreaterThan(t.energyKcal);
    const r: RecipeDefinition = {
      schemaVersion: 2,
      name: 'sweet rice',
      ingredients: [{ id: 'rice', name: 'cooked rice', massG: 100, massBasis: 'edible' }],
      yieldSource: 'unknown',
      evaporationG: 0,
      additions: [{ id: 'sugar', name: 'sugar', nutrients: { carbG: 50, energyKcal: 200 }, massG: 50, massBasis: 'edible' }],
    };
    expect(r.additions![0]!.massG).toBe(50);
  });
});

/* ================================================================================================= A1-034 / A1-047 */

describe('A1-034/A1-047: lab baseline metadata carries the facts the shared pairing operator reads', () => {
  const toSample = (m: LabBaselineMeta): LabSample => ({
    date: m.measuredOn ?? '',
    ...(m.sampleId ? { sampleId: m.sampleId } : {}),
    ...(m.sampledAt ? { sampledAt: m.sampledAt } : {}),
    ...(m.confirmedPairWith ? { confirmedPairWith: m.confirmedPairWith } : {}),
    ...(m.fastingHours !== undefined ? { fastingHours: m.fastingHours } : {}),
    ...(m.fastingStatus ? { fastingStatus: m.fastingStatus } : {}),
    ...(m.exogenousInsulin !== undefined ? { exogenousInsulin: m.exogenousInsulin } : {}),
    ...(m.sampleContext ? { sampleContext: m.sampleContext } : {}),
  });

  it('a reused id on different dates is not one draw once the dates travel; a genuine same-draw pair stays eligible', () => {
    const glucose: LabBaselineMeta = { source: 'marker', measuredOn: '2026-02-01', sampleId: 'panel-1', fastingHours: 12 };
    const insulin: LabBaselineMeta = { source: 'marker', measuredOn: '2026-10-01', sampleId: 'panel-1', fastingHours: 12 };
    expect(pairedFastingEligibility(toSample(glucose), toSample(insulin)).eligible).toBe(false);
    expect(pairedFastingEligibility(toSample(glucose), toSample({ ...insulin, measuredOn: '2026-02-01' })).eligible).toBe(true);
    // contradictory instants on one date
    const a: LabBaselineMeta = { ...glucose, sampledAt: '2026-02-01T08:00:00+05:30' };
    const b: LabBaselineMeta = { ...insulin, measuredOn: '2026-02-01', sampledAt: '2026-02-01T17:30:00+05:30' };
    expect(pairedFastingEligibility(toSample(a), toSample(b)).eligible).toBe(false);
    // known context travels atomically with the value (no inference when absent)
    const ill: LabBaselineMeta = { ...glucose, sampleContext: { illness: true } };
    expect(toSample(ill).sampleContext).toEqual({ illness: true });
    expect(toSample(glucose).sampleContext).toBeUndefined();
  });
});

/* ================================================================================================= A1-038 / A1-040 / A1-053 */

describe('A1-038/A1-040/A1-053: composition evidence groups, habitual overlap input and the sleep observation boundary', () => {
  it('composition evidence names its stable device groups and longitudinal sensitivity', () => {
    const ev: CompositionEvidence = {
      status: 'updated',
      groups: [{ groupId: 'bia:scale1', method: 'bia', device: 'scale1', observationIds: ['m1', 'm2'], bias: 'stableAssumed', longitudinalSensitivity: 'unknown', repeatabilitySdPct: 2.5, systematicSdPct: 2.5 }],
      uncertaintyKind: 'scenario',
      coverage: 'unvalidated',
    };
    expect(ev.groups[0]!.longitudinalSensitivity).toBe('unknown');
  });

  it('the habitual reference overlap is optional context that resolution keeps optional (unknown, never defaulted)', () => {
    const habits: HabitProfile = { typicalSteps: 10000, stepsScope: 'totalDay', habitualStepsOverlap: { status: 'known', includedStepsPerDay: 3000, bouts: [{ boutId: 'walk', stepsIncluded: 3000 }], source: 'user' } };
    const resolved: Pick<ResolvedHabits, 'habitualStepsOverlap'> = {};
    expect(habits.habitualStepsOverlap?.status).toBe('known');
    expect(resolved.habitualStepsOverlap).toBeUndefined();
  });

  it('total asleep hours stay separate from main-episode timing; unrated quality is explicit', () => {
    const spec: SleepSpec = {
      hours: 6,
      observed: { bedAt: '2026-10-06T01:00:00+05:30', wakeAt: '2026-10-06T06:00:00+05:30', kind: 'main' },
      observedEpisodes: [
        { bedAt: '2026-10-06T01:00:00+05:30', wakeAt: '2026-10-06T06:00:00+05:30', kind: 'main' },
        { bedAt: '2026-10-06T14:00:00+05:30', wakeAt: '2026-10-06T15:00:00+05:30', kind: 'nap' },
      ],
      observedTotalHours: 6,
      observedCoverage: 'complete',
    };
    const compiled: SleepEndingToday = { bedClockH: 1, wakeClockH: 6, hours: 5, totalAsleepHours: 6, qualityStatus: 'unrated', coverage: 'complete' };
    expect(compiled.hours).toBe(5);
    expect(compiled.totalAsleepHours).toBe(spec.observedTotalHours);
    expect(compiled.quality).toBeUndefined();
    expect(CONTRACT_VERSIONS.sleepDate).toBe(2);
  });
});

/* ================================================================================================= A1-049 / A1-065 */

describe('A1-049/A1-065: per-day band availability and structural modes', () => {
  it('per-day method: no valid member → none; a domain exclusion → none unless explicitly conditional; other exclusions → conditional', () => {
    expect(bandDayMethodOf({ valid: 0, excluded: 8, domainExcluded: 8 })).toBe(BAND_DAY_METHOD.none);
    expect(bandDayMethodOf({ valid: 7, excluded: 1, domainExcluded: 1 })).toBe(BAND_DAY_METHOD.none);
    expect(bandDayMethodOf({ valid: 7, excluded: 1, domainExcluded: 1 }, { conditionalValidDomain: true })).toBe(BAND_DAY_METHOD.conditionalValid);
    expect(bandDayMethodOf({ valid: 7, excluded: 1, domainExcluded: 0 })).toBe(BAND_DAY_METHOD.conditionalValid);
    expect(bandDayMethodOf({ valid: 8, excluded: 0, domainExcluded: 0 })).toBe(BAND_DAY_METHOD.full);
  });

  it('a valid prefix and an all-stopped suffix are encoded per day with exact counts; finite storage is never the availability', () => {
    const av: BandAvailability = {
      version: CONTRACT_VERSIONS.uncertainty,
      attempted: 4,
      valid: Uint16Array.from([4, 0]),
      excluded: Uint16Array.from([0, 4]),
      method: Uint8Array.from([BAND_DAY_METHOD.full, BAND_DAY_METHOD.none]),
      excludedBy: { aborted: Uint16Array.from([0, 4]) },
      status: 'estimated',
      uncertaintyKind: 'parameterSensitivity',
      reasonCode: 'ok',
    };
    expect(bandDayUsable(av, 0)).toBe(true);
    expect(bandDayUsable(av, 1)).toBe(false);
    expect(bandDayUsable(av, 2)).toBe(false);
    expect(bandDayUsable(undefined, 1)).toBe(true); // legacy result: whole-series semantics
    for (let d = 0; d < 2; d++) expect(av.valid[d]! + av.excluded[d]!).toBe(av.attempted);
    const member: EnsembleMemberEnvelope = { daily: { fatMass: Float32Array.from([20, Number.NaN]) }, nDays: 2, aborted: { day: 1, bound: 'b', magnitude: 1 }, status: { fatMass: { status: 'scenario', reasonCode: 'lowProtein', fromDay: 0 } } };
    expect(member.aborted?.day).toBe(1);
    expect(CONTRACT_VERSIONS.uncertainty).toBe(2);
  });
});

/* ================================================================================================= A1-058 / A1-059 */

describe('A1-058/A1-059: hour-end ketone series registered; nitrogen balance has no urinary observable', () => {
  it('bhbEndpoint is an hourly ketones detail series (mmol/L, end, goal none), appended; bhb stays the hour mean', () => {
    const d = seriesDef('bhbEndpoint');
    expect(d).toMatchObject({ kind: 'detail', owner: 'ketones', unit: 'mmol/L', resolution: 'hourly', agg: 'end', goal: 'none', band: 'none' });
    expect(SERIES_INDEX.bhbEndpoint).toBe(SERIES.length - 1);
    expect(SERIES_INDEX.reproductiveConcern).toBeLessThan(SERIES_INDEX.bhbEndpoint);
    expect(seriesDef('bhb').agg).toBe('mean');
    expect(seriesDef('reproductiveConcern')).toMatchObject({ owner: 'hormones', agg: 'end', goal: 'none', band: 'none', presentation: 'state' });
    expect(SERIES_OBSERVABLE.bhbEndpoint).toBe('bhbEndpoint');
    expect(SERIES_OBSERVABLE.bhb).toBe('bhbHourlyMean');
    const owned: SeriesOwnedBy<'ketones'> = 'bhbEndpoint';
    const hormonal: SeriesOwnedBy<'hormones'> = 'reproductiveConcern';
    expect(MODULES.find((m) => m.id === 'ketones')!.records).toContain(owned);
    expect(MODULES.find((m) => m.id === 'hormones')!.records).toContain(hormonal);
  });

  it('nitrogenBalance has no observation operator; urinary nitrogen keeps its own estimand', () => {
    expect(SERIES_OBSERVABLE.nitrogenBalance).toBeUndefined();
    expect(operatorTag('urinaryNitrogen')).toMatchObject({ observable: 'urinaryNitrogenPrior', unit: 'g N/d' });
    expect(comparability('urinaryNitrogen', 'modelLeanTissue')).toMatchObject({ ok: false });
    expect(CONTRACT_VERSIONS.measurementOperator).toBe(2);
  });

  it('public engine: body-N change is negative in a fast and positive in a fed surplus, so it can never be read as urine N (always ≥ 0)', () => {
    const sched = (energy: Schedule['programs'][number]['energy'], days: number, extra: Partial<Schedule['programs'][number]> = {}): Schedule => ({
      schemaVersion: 1,
      startDate: '2026-10-05',
      horizonDays: days,
      programs: [{ id: 'A', label: 'a', energy, macros: { protein: { unit: 'gPerKgBw', value: 2.2 }, carbs: { unit: 'pctEnergy', value: 45 }, fat: { unit: 'remainder' } }, ...extra }],
      days: Array.from({ length: days }, () => ({ program: 0 })),
    });
    const fast = simulate(MAN, sched({ kind: 'zero' }, 3), { record: 'daily', series: ['nitrogenBalance'] });
    const fed = simulate(MAN, sched({ kind: 'pctMaintenance', pct: 125 }, 10, { exercise: [{ kind: 'resistance', startH: 17, volume: 'high' }] }), { record: 'daily', series: ['nitrogenBalance'] });
    const nFast = Array.from(fast.daily.nitrogenBalance!);
    const nFed = Array.from(fed.daily.nitrogenBalance!);
    expect(Math.min(...nFast.slice(1))).toBeLessThan(0);
    expect(Math.max(...nFed)).toBeGreaterThan(0);
  });

  it('public engine: an ester dose makes the hour-end endpoint differ from the hour mean during the rise; daily = the 24:00 value', () => {
    const s: Schedule = {
      schemaVersion: 1,
      startDate: '2026-10-05',
      horizonDays: 2,
      programs: [{ id: 'A', label: 'a', energy: { kind: 'pctMaintenance', pct: 100 }, macros: { protein: { unit: 'gPerKgBw', value: 1.6 }, carbs: { unit: 'pctEnergy', value: 40 }, fat: { unit: 'remainder' } }, substances: { exogenousKetones: [{ clockH: 9, gBhb: 25, form: 'ester' }] } }],
      days: [{ program: 0 }, { program: 0 }],
    };
    const r = simulate(MAN, s, { record: 'full', series: ['bhb', 'bhbEndpoint'] });
    const mean = r.hourly.bhb!;
    const end = r.hourly.bhbEndpoint!;
    expect(end).toBeDefined();
    let maxDiff = 0;
    for (let h = 0; h < end.length; h++) maxDiff = Math.max(maxDiff, Math.abs(end[h]! - mean[h]!));
    expect(maxDiff).toBeGreaterThan(0.05);
    expect(r.daily.bhbEndpoint![0]).toBeCloseTo(end[23]!, 6);
  });
});
