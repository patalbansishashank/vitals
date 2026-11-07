// @vitest-environment node
/**
 * Re-audit W0/W1 physiology regressions (package F07): ketone source provenance (A1-064), the D-BHB interval operator
 * (A1-060), observation identity in the ketone correction (A1-061), the public bhbEndpoint / reproductiveConcern outputs
 * (A1-058), the reproductive-concern known-day window (A1-056), the shared hunger-rating calibration provider (A1-054),
 * observed sleep totals and quality in the recovery state (A1-053) and the energy module's intake-knowledge seeds
 * (A1-013). Composition's surplus-blend containment (A1-039) is tested in composition/composition.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { simulate } from '../../simulate';
import { MI } from '../../types/metrics';
import type { AnyEngineModule } from '../../types/module';
import type { DayInput } from '../../types/inputs';
import type { PersonProfile } from '../../types/profile';
import type { SimulationResult } from '../../types/result';
import { ketonesModule, ketoneSourceShares, ketoneSourceStatus, type KetoneSourceShares } from './index';
import { fitKetoneCorrection, predictKetoneReading, type KetoneCalibrationPair, type KetoneModelPath, type KetoneObservation } from './observation';
import { kitPerson, kitSchedule, neutral, program, runKit } from './integration/engineKit';
import { hormonesModule, isKnownConcernDay, REPRO_CONCERN_CODE, type HormonesState } from '../hormones/index';
import { Scenario } from '../hormones/scenario';
import { calibrateHungerPairs, calibrateHungerRatings, hungerBaselineForecast, hungerForecast, HUNGER_CALIBRATION_VERSION, type HungerRating } from '../appetite/ratingCalibration';
import { moderatorsModule, moderatorsOutputStatuses, type ModeratorsState } from '../moderators/index';
import { makeCtx, miniRun, person } from '../moderators/testkit';
import { habitualDay } from '../../core/compileSchedule';
import {
  CARB_FAT_DEPENDENT_SERIES,
  carbFatAllocationUnknown,
  ENERGY_INTAKE_ASSUMPTIONS,
  energyModule,
  INTAKE_KNOWLEDGE_ASSUMPTIONS,
  intakeKnowledgeAssumptionFromDays,
  PROTEIN_DEPENDENT_SERIES,
  proteinIntakeUnknown,
  proteinIsLowerBound,
} from '../energy/index';
import { EnergyRig, MAN02_INPUT, MEAL_HOURS } from '../energy/testRig';
import { NUTRIENT_UNKNOWN_BIT } from '../../types/inputs';
import { resolveProfile } from '../../core/resolveProfile';

// =====================================================================================================================
// A1-064 ketone source status: only explicit knowledge certifies a displayed tagged source
// =====================================================================================================================

describe('A1-064 ketone source status needs explicit formulation and dose knowledge', () => {
  const mixed: KetoneSourceShares = { hepaticOther: 0.5, hepaticMct: 0.2, ingestedDBhb: 0.3 };
  it('omitted argument, omitted fields and explicit false stay Unknown; only both explicit true reads Mixed', () => {
    expect(ketoneSourceStatus(mixed)).toBe('unknown');
    expect(ketoneSourceStatus(mixed, {})).toBe('unknown');
    expect(ketoneSourceStatus(mixed, { ingestedFormulation: true })).toBe('unknown');
    expect(ketoneSourceStatus(mixed, { mctDose: true })).toBe('unknown');
    expect(ketoneSourceStatus(mixed, { ingestedFormulation: false, mctDose: false })).toBe('unknown');
    expect(ketoneSourceStatus(mixed, { ingestedFormulation: true, mctDose: false })).toBe('unknown');
    expect(ketoneSourceStatus(mixed, { ingestedFormulation: false, mctDose: true })).toBe('unknown');
    expect(ketoneSourceStatus(mixed, { ingestedFormulation: true, mctDose: true })).toBe('mixed');
  });
  it('an unresolved source history stays Unknown whatever the tags say; shares under the 1 % display rule need nothing', () => {
    expect(ketoneSourceStatus(mixed, { ingestedFormulation: true, mctDose: true, sourceHistory: 'unknown' })).toBe('unknown');
    expect(ketoneSourceStatus({ hepaticOther: 1, hepaticMct: 0, ingestedDBhb: 0 }, { sourceHistory: 'unknown' })).toBe('unknown');
    expect(ketoneSourceStatus({ hepaticOther: 0.695, hepaticMct: 0.005, ingestedDBhb: 0.3 }, { ingestedFormulation: true })).toBe('mixed');
    expect(ketoneSourceStatus({ hepaticOther: 0.995, hepaticMct: 0.005, ingestedDBhb: 0 })).toBe('hepatic');
    expect(ketoneSourceStatus({ hepaticOther: 0, hepaticMct: 0, ingestedDBhb: 1 }, { ingestedFormulation: true })).toBe('ingested');
  });
  it('status only: the share math is unchanged', () => {
    expect(ketoneSourceShares(2, 1, 0.5)).toEqual({ hepaticOther: 0.25, hepaticMct: 0.25, ingestedDBhb: 0.5 });
  });
});

// =====================================================================================================================
// A1-060 interval operator = extrema of the instant point reconstruction inside the interval
// =====================================================================================================================

describe('A1-060 D-BHB interval range uses the instant operator inside its own span', () => {
  const ramp: KetoneModelPath = { initial: 0.2, endpoint: [0.2, 2.2], hourlyMean: [0.2, 1.2] };
  const blood = (time: KetoneObservation['time']): KetoneObservation => ({ id: 'o', value: 1, unit: 'mmol/L', specimen: 'capillaryBlood', analyte: 'dBhb', time, meter: 'm', context: 'ester' });
  const at = (path: KetoneModelPath, hour: number): number => predictKetoneReading(blood({ kind: 'instant', hour }), path).predicted!;
  const range = (path: KetoneModelPath, fromHour: number, toHour: number) => predictKetoneReading(blood({ kind: 'interval', fromHour, toHour }), path);

  it('a fractional interval across a steep ester rise is [point(from), point(to)], never the endpoint after the interval', () => {
    const r = range(ramp, 1.25, 1.75);
    expect(r.status).toBe('untimed');
    expect(r.range![0]).toBeCloseTo(0.7, 12);
    expect(r.range![1]).toBeCloseTo(1.7, 12);
    expect(r.range![0]).toBeCloseTo(at(ramp, 1.25), 12);
    expect(r.range![1]).toBeCloseTo(at(ramp, 1.75), 12);
    expect(r.approximation).toBe('hourEndLinear');
  });
  it('an interval starting at an integer time ≥ 1 includes its starting value; near t0 and at the horizon', () => {
    expect(range(ramp, 1, 1.5).range).toEqual([0.2, at(ramp, 1.5)]);
    const p0: KetoneModelPath = { initial: 0, endpoint: [1, 3], hourlyMean: [0.5, 2] };
    expect(range(p0, 0.25, 0.75).range).toEqual([0.25, 0.75]);
    expect(range(p0, 0, 0.5).range).toEqual([0, 0.5]);
    expect(range(p0, 1.5, 2).range).toEqual([2, 3]);
  });
  it('without the t = 0 value a span touching hour 0 uses the hour-mean fallback consistently (labelled approximation)', () => {
    const r = range({ endpoint: [1, 3], hourlyMean: [0.5, 2] }, 0.25, 1.75);
    expect(r.approximation).toBe('hourMeanMidpoint');
    expect(r.range).toEqual([0.5, 2]);
    expect(range({ hourlyMean: [0.5, 2] }, 0.5, 1.5).range).toEqual([0.5, 2]);
  });
  it('a zero-length interval is its single reconstructed point', () => {
    const r = range(ramp, 1.5, 1.5);
    expect(r.status).toBe('untimed');
    expect(r.range).toEqual([at(ramp, 1.5), at(ramp, 1.5)]);
  });
  it('reversed, NaN, Infinity, negative and beyond-horizon spans abstain (outsidePath)', () => {
    for (const [a, b] of [
      [1.75, 1.25],
      [Number.NaN, 1],
      [0.5, Number.NaN],
      [0, Number.POSITIVE_INFINITY],
      [Number.NEGATIVE_INFINITY, 1],
      [-0.5, 1],
      [1, 2.5],
    ] as const) {
      expect(range(ramp, a, b).status, `${a}..${b}`).toBe('outsidePath');
    }
    expect(predictKetoneReading(blood({ kind: 'unknown', day: 3 }), ramp).status).toBe('outsidePath');
  });
  it('a missing or non-finite interior value is never skipped into a full-coverage range', () => {
    const holed: KetoneModelPath = { initial: 0.3, endpoint: [0.3, Number.NaN, 0.4, 0.5], hourlyMean: [0.3, 0.3, 0.35, 0.45] };
    expect(range(holed, 0.5, 3.5).status).toBe('outsidePath');
    expect(range(holed, 2.2, 3.8).status).toBe('outsidePath'); // (2, 3) interpolates from the missing value at t = 2
    expect(range(holed, 3.1, 3.9).range).toEqual([at(holed, 3.1), at(holed, 3.9)]); // a span clear of the hole is fine
    const meanHole: KetoneModelPath = { hourlyMean: [0.3, Number.NaN, 0.4] };
    expect(range(meanHole, 0.6, 2.4).status).toBe('outsidePath');
  });
  it('whole day and random spans: the range contains every point inside the span and its bounds are attained inside it', () => {
    const n = 48;
    const mean = Float64Array.from({ length: n }, (_, h) => 0.3 + 2 * Math.exp(-((h - 20) ** 2) / 8) + 0.1 * Math.sin(h));
    const end = Float64Array.from({ length: n }, (_, h) => 0.3 + 2.4 * Math.exp(-((h + 0.5 - 20) ** 2) / 6) + 0.1 * Math.cos(h));
    const paths: KetoneModelPath[] = [{ initial: 0.3, endpoint: end, hourlyMean: mean }, { hourlyMean: mean }];
    let seed = 7;
    const rnd = (): number => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (const path of paths) {
      const spans: Array<[number, number]> = [[0, 24], [24, 48]];
      for (let i = 0; i < 60; i++) {
        const a = rnd() * n;
        spans.push([a, Math.min(n, a + rnd() * 9)]);
      }
      for (const [a, b] of spans) {
        const r = range(path, a, b);
        expect(r.status).toBe('untimed');
        const [lo, hi] = r.range!;
        let attainedLo = false;
        let attainedHi = false;
        const check = (t: number): void => {
          const v = at(path, t);
          expect(v).toBeGreaterThanOrEqual(lo - 1e-12);
          expect(v).toBeLessThanOrEqual(hi + 1e-12);
          if (Math.abs(v - lo) < 1e-12) attainedLo = true;
          if (Math.abs(v - hi) < 1e-12) attainedHi = true;
        };
        for (let j = 0; j <= 400; j++) check(a + ((b - a) * j) / 400);
        for (let t = Math.ceil(a); t <= b; t++) check(t);
        for (let t = Math.ceil(a - 0.5) + 0.5; t <= b; t++) check(t);
        expect(attainedLo && attainedHi, `${a}..${b}`).toBe(true);
      }
    }
    const day = predictKetoneReading(blood({ kind: 'unknown', day: 0 }), paths[0]!);
    expect(day.range).toEqual(range(paths[0]!, 0, 24).range);
  });
});

// =====================================================================================================================
// A1-061 a stable observation id counts once in the ketone correction
// =====================================================================================================================

describe('A1-061 ketone correction canonicalizes observation identity', () => {
  const flat: KetoneModelPath = { hourlyMean: new Float64Array(48).fill(1), endpoint: new Float64Array(48).fill(1), initial: 1 };
  const obs = (id: string, hour: number, value: number, extra: Partial<KetoneObservation> = {}): KetoneObservation => ({ id, value, unit: 'mmol/L', specimen: 'capillaryBlood', analyte: 'dBhb', time: { kind: 'instant', hour }, meter: 'm1', context: 'fasting', ...extra });
  const pair = (o: KetoneObservation): KetoneCalibrationPair => ({ observation: o, prediction: predictKetoneReading(o, flat) });
  const strip = (cs: ReturnType<typeof fitKetoneCorrection>) => cs.map((c) => ({ ...c }));

  it('one fingerstick alone, duplicated 2 or 10 times or permuted, stays insufficient with n = 1', () => {
    const one = pair(obs('single', 5, 1.6));
    for (const k of [1, 2, 10]) {
      const [c] = fitKetoneCorrection(Array.from({ length: k }, () => one));
      expect(c).toEqual({ key: 'capillaryBlood|dBhb|m1', status: 'insufficient', n: 1, coverage: 'unvalidated' });
    }
    const other = pair(obs('urine', 6, 3, { specimen: 'urine' }));
    expect(strip(fitKetoneCorrection([one, other, one, one]))).toEqual(strip(fitKetoneCorrection([other, one])));
  });
  it('two distinct ids may estimate; duplicating either leaves n, logScale, SE and status bit-identical', () => {
    const a = pair(obs('a', 5, 1.2));
    const b = pair(obs('b', 9, 1.3));
    const base = fitKetoneCorrection([a, b]);
    expect(base[0]!.status).toBe('estimated');
    expect(base[0]!.n).toBe(2);
    for (const variant of [[a, a, b], [b, a, b, b, a], [b, a]]) expect(fitKetoneCorrection(variant)).toEqual(base);
  });
  it('duplication cannot hide or create a context discrepancy', () => {
    const list = [obs('a', 5, 2.0, { context: 'ketogenicDiet' }), obs('b', 9, 2.05, { context: 'ketogenicDiet' }), obs('c', 30, 0.5), obs('d', 31, 0.52)].map(pair);
    const base = fitKetoneCorrection(list);
    expect(base[0]!.status).toBe('discrepant');
    expect(fitKetoneCorrection([...list, list[2]!, list[2]!, list[0]!].reverse())).toEqual(base);
  });
  it('one id with different payloads is an identity conflict with no scale, whatever the order; raw records are untouched', () => {
    const v1 = pair(obs('x', 5, 1.6));
    const v2 = pair(obs('x', 5, 1.9));
    const c = pair(obs('c', 9, 1.4));
    const d = pair(obs('d', 12, 1.5));
    const input = [v1, c, v2, d];
    const frozen = structuredClone(input);
    const r1 = fitKetoneCorrection(input);
    const r2 = fitKetoneCorrection([d, v2, c, v1]);
    expect(r1).toEqual(r2);
    expect(r1).toEqual([{ key: 'capillaryBlood|dBhb|m1', status: 'identityConflict', n: 2, conflictIds: ['x'], coverage: 'unvalidated' }]);
    expect(r1[0]!.logScale).toBeUndefined();
    expect(input).toEqual(frozen);
    // a revision that moves the reading to another meter flags both keys, never counts the id twice
    const moved = fitKetoneCorrection([v1, pair(obs('x', 5, 1.6, { meter: 'm2' })), c, d]);
    expect(moved.map((x) => [x.key, x.status])).toEqual([
      ['capillaryBlood|dBhb|m1', 'identityConflict'],
      ['capillaryBlood|dBhb|m2', 'identityConflict'],
    ]);
  });
});

// =====================================================================================================================
// A1-058 public bhbEndpoint and reproductiveConcern outputs
// =====================================================================================================================

describe('A1-058 the W1 endpoint and concern outputs are typed, recorded public results', () => {
  const MAN = kitPerson({ sex: 'male', ageYears: 35, heightCm: 178, weightKg: 78, bodyFatPct: 16 });
  const esterSchedule = () => {
    const base = program('base', 100, neutral('male'));
    const supp = program('supp', 100, neutral('male'), { substances: { exogenousKetones: [{ clockH: 6, gBhb: 25, form: 'ester' as const }] } });
    return kitSchedule(4, [base, supp], (d) => (d === 2 ? 1 : 0));
  };

  it('both providers declare the registered records (a missing registry entry would not compile)', () => {
    expect(ketonesModule.records).toContain('bhbEndpoint');
    expect(ketonesModule.records).toContain('bhb');
    expect(hormonesModule.records).toContain('reproductiveConcern');
    expect(hormonesModule.records).toContain('menstrualRisk');
    expect(MI.bhbEndpoint).toBeGreaterThanOrEqual(0);
    expect(MI.reproductiveConcern).toBeGreaterThanOrEqual(0);
  });

  it('an ester spike: bhbEndpoint exists, differs from the hour mean in the rise, equals the producer endpoint, and feeds the instant operator', () => {
    const run = runKit(MAN, esterSchedule());
    const end = run.result.hourly.bhbEndpoint!;
    const mean = run.result.hourly.bhb!;
    expect(end).toBeDefined();
    expect(mean).toBeDefined();
    let maxDiff = 0;
    for (let h = 48; h < 60; h++) {
      expect(end[h]!).toBeCloseTo(run.probe.bhbEnd[h]!, 5); // producer state at the end of hour h (time h + 1)
      maxDiff = Math.max(maxDiff, Math.abs(end[h]! - mean[h]!));
    }
    expect(maxDiff).toBeGreaterThan(0.2);
    const path: KetoneModelPath = { hourlyMean: mean, endpoint: end, initial: run.result.initial.bhbEndpoint! };
    const h = 54;
    const p = predictKetoneReading({ id: 'f', value: 2, unit: 'mmol/L', specimen: 'capillaryBlood', analyte: 'dBhb', time: { kind: 'instant', hour: h + 1 } }, path);
    expect(p.status).toBe('comparable');
    expect(p.approximation).toBe('hourEndLinear');
    expect(p.predicted).toBe(end[h]);
  });

  it('series masks never change physiology, old ids stay readable, and the payload survives worker structured cloning', () => {
    const profile = MAN;
    const sched = esterSchedule();
    const full = simulate(profile, sched, { record: 'full', burnInDays: 14 });
    const onlyEnd = simulate(profile, sched, { record: 'full', burnInDays: 14, series: ['bhbEndpoint'] });
    const onlyMean = simulate(profile, sched, { record: 'full', burnInDays: 14, series: ['bhb'] });
    expect(Array.from(onlyEnd.hourly.bhbEndpoint!)).toEqual(Array.from(full.hourly.bhbEndpoint!));
    expect(Array.from(onlyMean.hourly.bhb!)).toEqual(Array.from(full.hourly.bhb!));
    expect(full.daily.bhb).toBeDefined();
    const cloned = structuredClone(full) as SimulationResult;
    expect(Array.from(cloned.hourly.bhbEndpoint!)).toEqual(Array.from(full.hourly.bhbEndpoint!));
    expect(Array.from(cloned.daily.bhbEndpoint!)).toEqual(Array.from(full.daily.bhbEndpoint!));
  });

  it('a missed-period profile carries Review in the public result before a full energy-history window; codes are categorical', () => {
    const woman: PersonProfile = {
      schemaVersion: 1,
      body: { sex: 'female', ageYears: 27, heightCm: 165, weightKg: 62 },
      cycle: { tracking: true, contraception: 'none', recentChange: 'missedPeriods' },
      menopause: 'pre',
      startDate: '2026-10-05',
    };
    const sched = kitSchedule(10, [program('base', 100, neutral('female'))], () => 0);
    const r = simulate(woman, sched, { record: 'daily', burnInDays: 14 });
    const codes = Array.from(r.daily.reproductiveConcern!);
    expect(codes).toEqual(new Array(10).fill(REPRO_CONCERN_CODE.review));
    expect(r.daily.menstrualRisk).toBeDefined(); // legacy research history stays readable
    const ok: PersonProfile = { ...woman, cycle: { tracking: true, contraception: 'none' } };
    const r2 = simulate(ok, sched, { record: 'daily', burnInDays: 14 });
    // prescribed future days are not known history: insufficient, never reassurance
    expect(Array.from(r2.daily.reproductiveConcern!)).toEqual(new Array(10).fill(REPRO_CONCERN_CODE.insufficientHistory));
    expect((structuredClone(r) as SimulationResult).daily.reproductiveConcern![3]).toBe(REPRO_CONCERN_CODE.review);
  });
});

// =====================================================================================================================
// A1-056 reproductive concern: calendar-aligned known-day mask
// =====================================================================================================================

describe('A1-056 the concern status counts known realised days in its calendar window', () => {
  const WOMAN: PersonProfile = {
    schemaVersion: 1,
    body: { sex: 'female', ageYears: 27, heightCm: 165, weightKg: 62 },
    cycle: { tracking: true, contraception: 'none' },
    menopause: 'pre',
  };
  const woman = (cycle: PersonProfile['cycle'] = WOMAN.cycle) =>
    Scenario.of({ ...WOMAN, ...(cycle ? { cycle } : {}) }, { weightKg: 62, fm0Kg: 17, ffm0Kg: 45, tdee0Kcal: 2100, habitualProteinG: 75, habitualFibreG: 18 });
  const COVERED = { energy: 'complete', exercise: 'complete' } as const;
  const known = (s: Scenario, on: boolean): void => {
    if (on) s.dr.day.coverage = { ...COVERED };
    else delete s.dr.day.coverage;
  };
  const hs = (s: Scenario): HormonesState => s.dr.hs;

  it('84 unknown days at maintenance and 84 prescribed days beyond the realised prefix stay insufficient, knownCount 0', () => {
    const u = woman();
    u.days(84, { eiFrac: 1 });
    expect(hs(u).menKnownN).toBe(0);
    expect(hs(u).concernCode).toBe(REPRO_CONCERN_CODE.insufficientHistory);
    const future = woman();
    future.dr.hk.realisedThroughDay = 0; // the schedule's realised prefix ends before day 0: every day is a prescription
    known(future, true);
    future.days(84, { eiFrac: 1 });
    expect(hs(future).menKnownN).toBe(0);
    expect(hs(future).concernCode).toBe(REPRO_CONCERN_CODE.insufficientHistory);
  });

  it('83 known + 1 unknown cannot reassure; 84 known covered days can (and a known deficit reads Concern)', () => {
    const a = woman();
    known(a, true);
    a.days(83, { eiFrac: 1 });
    known(a, false);
    a.day({ eiFrac: 1 });
    expect(hs(a).menKnownN).toBe(83);
    expect(hs(a).concernCode).toBe(REPRO_CONCERN_CODE.insufficientHistory);
    const b = woman();
    known(b, true);
    b.days(84, { eiFrac: 1 });
    expect(hs(b).menKnownN).toBe(84);
    expect(hs(b).concernCode).toBe(REPRO_CONCERN_CODE.noModelConcern);
    const c = woman();
    known(c, true);
    c.days(84, { eiFrac: 0.75, carbShareE: 0.5 });
    expect(hs(c).concernCode).toBe(REPRO_CONCERN_CODE.concern);
  });

  it('after a complete window, evicting a known day for an unknown one lowers the count (never saturates)', () => {
    const s = woman();
    known(s, true);
    s.days(90, { eiFrac: 1 });
    expect(hs(s).menKnownN).toBe(84);
    known(s, false);
    s.day({ eiFrac: 1 });
    expect(hs(s).menKnownN).toBe(83);
    expect(hs(s).concernCode).toBe(REPRO_CONCERN_CODE.insufficientHistory);
    let sum = 0;
    let n = 0;
    for (let i = 0; i < hs(s).menKnown.length; i++) {
      if (hs(s).menKnown[i] === 1) {
        sum += hs(s).menRing[i]!;
        n++;
      }
    }
    expect(n).toBe(hs(s).menKnownN);
    expect(hs(s).menKnownSum).toBeCloseTo(sum, 9);
  });

  it('observed cycle changes read Review with incomplete history; contraception stays not applicable', () => {
    const m = woman({ tracking: true, contraception: 'none', recentChange: 'missedPeriods' });
    m.days(5, { eiFrac: 1 });
    expect(hs(m).concernCode).toBe(REPRO_CONCERN_CODE.review);
    const n = woman({ tracking: true, contraception: 'none', recentChange: 'newIrregularity' });
    n.days(5, { eiFrac: 1 });
    expect(hs(n).concernCode).toBe(REPRO_CONCERN_CODE.review);
    const oc = woman({ tracking: true, contraception: 'combinedOral' });
    known(oc, true);
    oc.days(90, { eiFrac: 0.7 });
    expect(hs(oc).concernCode).toBe(REPRO_CONCERN_CODE.notApplicable);
  });

  it('the mask selects the interpretation only: every day stays in the endocrine physiology', () => {
    const a = woman();
    const b = woman();
    known(b, true);
    for (let d = 0; d < 30; d++) {
      a.day({ eiFrac: 0.8 });
      b.day({ eiFrac: 0.8 });
    }
    expect(hs(b).leptinRel).toBe(hs(a).leptinRel);
    expect(hs(b).t3Rel).toBe(hs(a).t3Rel);
    expect(hs(b).menSum).toBe(hs(a).menSum);
    expect(hs(b).reproRisk).toBe(hs(a).reproRisk);
  });

  it('known-day rule: channel coverage and realised-prefix membership, not a blanket resolution test', () => {
    const day = (coverage: DayInput['coverage'], extra: Partial<DayInput> = {}) => ({ energyKcal: 2000, coverage, ...extra }) as DayInput;
    expect(isKnownConcernDay(day({ energy: 'complete', exercise: 'complete' }, { resolution: 'scenario' }), 3, Number.NaN, -0.1)).toBe(true);
    expect(isKnownConcernDay(day({ energy: 'confirmedZero', exercise: 'confirmedZero' }), 3, 10, -1)).toBe(true);
    for (const c of ['partial', 'unknown', 'asPlannedEstimate'] as const) {
      expect(isKnownConcernDay(day({ energy: c, exercise: 'complete' }), 3, 10, 0), c).toBe(false);
      expect(isKnownConcernDay(day({ energy: 'complete', exercise: c }), 3, 10, 0), c).toBe(false);
    }
    expect(isKnownConcernDay(day(undefined), 3, Number.NaN, 0)).toBe(false);
    expect(isKnownConcernDay(day({ energy: 'complete', exercise: 'complete' }), 10, 10, 0)).toBe(false);
    expect(isKnownConcernDay(day({ energy: 'complete', exercise: 'complete' }), -1, Number.NaN, 0)).toBe(false);
    expect(isKnownConcernDay(day({ energy: 'complete', exercise: 'complete' }, { energyKcal: Number.NaN }), 3, Number.NaN, 0)).toBe(false);
  });

  it('snapshot resume equals the uninterrupted run (mask, count, sum, status)', () => {
    const plan = (d: number): { on: boolean; ei: number } => ({ on: d % 7 !== 3, ei: d < 60 ? 0.8 : 1 });
    const full = woman();
    for (let d = 0; d < 130; d++) {
      known(full, plan(d).on);
      full.day({ eiFrac: plan(d).ei });
    }
    const head = woman();
    for (let d = 0; d < 50; d++) {
      known(head, plan(d).on);
      head.day({ eiFrac: plan(d).ei });
    }
    const snap = structuredClone(head.dr.hs);
    const tail = woman();
    const dst = tail.dr.hs as unknown as Record<string, unknown>;
    for (const [key, v] of Object.entries(snap)) {
      const d = dst[key];
      if (ArrayBuffer.isView(v) && ArrayBuffer.isView(d)) (d as Float64Array).set(v as Float64Array);
      else dst[key] = v;
    }
    tail.fm = head.fm;
    tail.ffm = head.ffm;
    tail.lastMealH = head.lastMealH;
    tail.hourIndex = head.hourIndex;
    tail.dr.clock.day = head.dr.clock.day;
    for (let d = 50; d < 130; d++) {
      known(tail, plan(d).on);
      tail.day({ eiFrac: plan(d).ei });
    }
    expect(Array.from(hs(tail).menKnown)).toEqual(Array.from(hs(full).menKnown));
    expect(hs(tail).menKnownN).toBe(hs(full).menKnownN);
    expect(hs(tail).menKnownSum).toBe(hs(full).menKnownSum);
    expect(hs(tail).concernCode).toBe(hs(full).concernCode);
  });
});

// =====================================================================================================================
// A1-054 one shared hunger-rating calibration provider
// =====================================================================================================================

describe('A1-054 shared hunger calibration: fixed clock, whole later days, honest baseline comparison', () => {
  const HPI = Float64Array.from({ length: 40 }, (_, d) => 10 + 5 * d);

  it('ten untimed ratings never form a synthetic clock bucket: insufficient, the ratings stay counted observations', () => {
    const rs: HungerRating[] = Array.from({ length: 10 }, (_, d) => ({ day: d, hunger: 5 }));
    const c = calibrateHungerRatings(rs, HPI);
    expect(c.status).toBe('insufficient');
    expect(c.reasonCode).toBe('untimedRatingsOnly');
    expect(c.clockH).toBeNull();
    expect(c.excluded.untimed).toBe(10);
    expect(c.n).toBe(0);
    expect(hungerForecast(50, c).status).toBe('exploratory');
    expect(calibrateHungerPairs(rs.map((r) => ({ day: r.day, rating: r.hunger!, index: HPI[r.day]! })))).toEqual(c);
  });

  it('a frozen later block where the personal mean is exact and the HPI mapping misses by > 2 points is not informative', () => {
    const rs: HungerRating[] = [
      ...Array.from({ length: 7 }, (_, d) => ({ day: d, clockH: 9, hunger: 2 + 0.5 * d })),
      ...[7, 8, 9].map((d) => ({ day: d, clockH: 9, hunger: 3.5 })),
    ];
    const c = calibrateHungerRatings(rs, HPI, { heldOutFromDay: 7 });
    expect(c.evaluation).toBe('frozenBlock');
    expect(c.status).toBe('notInformative');
    expect(c.baselineMae).toBe(0);
    expect(c.heldOutMae!).toBeGreaterThan(2);
    expect(c.nHeldOut).toBe(3);
    expect(c.nHeldOutDays).toBe(3);
    expect(c.trainingCutoffDay).toBe(6);
    expect(c.version).toBe(HUNGER_CALIBRATION_VERSION);
    expect(c.clockH).toBe(9);
    // the HPI forecast is withheld, the person's mean stays available as a labelled baseline
    expect(hungerForecast(60, c).status).toBe('exploratory');
    const base = hungerBaselineForecast(c);
    expect(base.status).toBe('estimated');
    expect(base.value).toBe(3.5);
    expect(base.reasonCode).toBe('personalMeanBaseline');
    // the live (pair-shaped) caller gets the same eligibility, errors and status
    const live = calibrateHungerPairs(rs.map((r) => ({ day: r.day, rating: r.hunger!, index: HPI[r.day]!, ratedAtClockH: r.clockH! })), { heldOutFromDay: 7 });
    expect(live).toEqual(c);
  });

  it('all ratings of a later day are held out together: no same-day leakage between training and test', () => {
    // days 0..2 train; day 3 has two ratings (9 and 1): both are predicted from days 0..2 only, so |p − 9| + |p − 1| = 8
    const rs: HungerRating[] = [
      { day: 0, clockH: 9, hunger: 3 },
      { day: 1, clockH: 9.5, hunger: 4 },
      { day: 2, clockH: 9.2, hunger: 5 },
      { day: 3, clockH: 9.1, hunger: 9 },
      { day: 3, clockH: 9.7, hunger: 1 },
    ];
    const c = calibrateHungerRatings(rs, HPI);
    expect(c.evaluation).toBe('forwardChaining');
    expect(c.nHeldOut).toBe(2);
    expect(c.nHeldOutDays).toBe(1);
    expect(c.heldOutMae).toBeCloseTo(4, 12);
    const swapped = calibrateHungerRatings([rs[0]!, rs[1]!, rs[2]!, rs[4]!, rs[3]!], HPI);
    expect(swapped.heldOutMae).toBe(c.heldOutMae);
    expect(swapped.heldOutRmse).toBe(c.heldOutRmse);
  });

  it('eligibility: hunger in [0, 10], integer day, explicit clock in [0, 24); fullness/craving counted apart', () => {
    const rs: HungerRating[] = [
      { day: 0, clockH: 24, hunger: 5 },
      { day: 0, clockH: -1, hunger: 5 },
      { day: 1.5, clockH: 9, hunger: 5 },
      { day: 2, clockH: 9, hunger: 11 },
      { day: 3, clockH: 9, fullness: 6, craving: 2 },
      { day: 4, clockH: null, hunger: 4 },
    ];
    const c = calibrateHungerRatings(rs, HPI);
    expect(c.excluded).toEqual({ otherTime: 0, untimed: 1, invalid: 4 });
    expect(c.fullnessN).toBe(1);
    expect(c.cravingN).toBe(1);
    expect(c.status).toBe('insufficient');
  });

  it('an informative fit forecasts a conditional residual band with unvalidated coverage', () => {
    const rs: HungerRating[] = Array.from({ length: 30 }, (_, d) => ({ day: d, clockH: 8, hunger: Math.min(10, 1 + 0.06 * HPI[d]! + (d % 2 ? 0.3 : -0.3)) }));
    const c = calibrateHungerRatings(rs, HPI);
    expect(c.status).toBe('calibrated');
    expect(c.coverage).toBe('unvalidated');
    const f = hungerForecast(50, c);
    expect(f.uncertaintyKind).toBe('conditionalResidual');
    expect(f.coverageStatus).toBe('unvalidated');
    expect(c.trainingCutoffDay).toBe(29);
  });
});

// =====================================================================================================================
// A1-053 observed sleep: known total, separate main timing, entered quality only
// =====================================================================================================================

describe('A1-053 the recovery state reads the observed total and entered quality', () => {
  const mods = [moderatorsModule] as unknown as readonly AnyEngineModule[];
  type Ctx = ReturnType<typeof makeCtx>;
  const nightDay = (profile: Ctx['profile'], sleepH: number, patch: Partial<DayInput> = {}): DayInput => {
    const d = habitualDay(profile);
    d.sleepHours = sleepH;
    d.sleepWakeH = (d.sleepBedH + sleepH) % 24;
    Object.assign(d, patch);
    return d;
  };
  const debts = (days: DayInput[], p: PersonProfile = person(), init?: NonNullable<Ctx['schedule']['initialSleep']>) => {
    const base = makeCtx(mods, p);
    const ctx: Ctx = init ? { ...base, schedule: { ...base.schedule, initialSleep: init } } : base;
    const dF: number[] = [];
    const run = miniRun(mods, ctx, days.map((day, i) => ({ clockDay: i, day })), {
      beforeHour: (_c, h, bus) => {
        if (h === 0) dF.push(bus.sleepDebtFastH);
      },
    });
    return { dF, s: run.S[0] as ModeratorsState };
  };
  const ctx0 = makeCtx(mods, person());
  const E1 = 1 - Math.exp(-1);
  /** Entered quality codes (the `sleepQuality` code): 0 poor, 1 fair, 2 good. */
  const POOR = 0;
  const FAIR = 1;
  const GOOD = 2;
  const observed = (ep: NonNullable<DayInput['sleepEndingToday']>): DayInput => nightDay(ctx0.profile, 8, { sleepSource: 'observed', sleepEndingToday: ep });

  it('5 h main + 1 h nap: the debt reads the 6 h total, the main episode keeps its 01:00–06:00 timing', () => {
    const ep = { bedClockH: 1, wakeClockH: 6, hours: 5, totalAsleepHours: 6, qualityStatus: 'unrated' as const };
    const r = debts([nightDay(ctx0.profile, 8), observed(ep)]);
    expect(r.dF[1]).toBeCloseTo((7 - 6) * E1, 12);
    expect(r.s.lastNightObserved).toBe(0); // tonight's planned night is carried after endOfDay
    // a legacy episode without a total uses its main duration
    const legacy = debts([nightDay(ctx0.profile, 8), observed({ bedClockH: 1, wakeClockH: 6, hours: 5 })]);
    expect(legacy.dF[1]).toBeCloseTo(2 * E1, 12);
  });

  it('an observed unrated night clears an inherited planned poor flag; entered poor counts; fair/good are not poor', () => {
    const plannedPoor = nightDay(ctx0.profile, 8, { sleepQuality: 0 });
    const unrated = debts([plannedPoor, observed({ bedClockH: -1, wakeClockH: 7, hours: 8, qualityStatus: 'unrated' })]);
    expect(unrated.dF[1]).toBe(0);
    const poor = debts([nightDay(ctx0.profile, 8), observed({ bedClockH: -1, wakeClockH: 7, hours: 8, quality: POOR, qualityStatus: 'rated' })]);
    expect(poor.dF[1]).toBeCloseTo(0.75 * E1, 12);
    for (const quality of [FAIR, GOOD]) {
      expect(debts([plannedPoor, observed({ bedClockH: -1, wakeClockH: 7, hours: 8, quality, qualityStatus: 'rated' })]).dF[1]).toBe(0);
    }
  });

  it('day zero: poor / good / absent quality and the known total behave exactly as the same observation on a waking day', () => {
    const habPoor = person({ habits: { typicalSteps: 7000, sessionsPerWeek: 0, sleepQuality: 'poor' } });
    for (const p of [person(), habPoor]) {
      const ctx = makeCtx(mods, p);
      const plain = nightDay(ctx.profile, 8);
      for (const quality of [POOR, GOOD, undefined]) {
        const init = { bedClockH: 0, sleepHours: 7, ...(quality !== undefined ? { quality, qualityStatus: 'rated' as const } : { qualityStatus: 'unrated' as const }) };
        const viaInit = debts([plain], p, init);
        const ep = { bedClockH: 0, wakeClockH: 7, hours: 7, ...(quality !== undefined ? { quality, qualityStatus: 'rated' as const } : { qualityStatus: 'unrated' as const }) };
        const viaEpisode = debts([nightDay(ctx.profile, 8, { sleepSource: 'observed', sleepEndingToday: ep })], p);
        expect(viaInit.dF[0], `${String(quality)}`).toBe(viaEpisode.dF[0]);
      }
      // the 7 h poor night on day 0 reaches the poor-quality branch (equivalent-deficit prior 0.75 h) from the same prior debt
      const poorInit = debts([plain], p, { bedClockH: 0, sleepHours: 7, quality: POOR });
      const goodInit = debts([plain], p, { bedClockH: 0, sleepHours: 7, quality: GOOD });
      expect(poorInit.dF[0]).toBeGreaterThan(goodInit.dF[0]!);
    }
    const first = debts([nightDay(ctx0.profile, 8)], person(), { bedClockH: 0, sleepHours: 7, quality: POOR });
    expect(first.dF[0]).toBeCloseTo(0.75 * E1, 12);
    const total = debts([nightDay(ctx0.profile, 8)], person(), { bedClockH: 1, sleepHours: 5, totalAsleepHours: 6 });
    expect(total.dF[0]).toBeCloseTo((7 - 6) * E1, 12);
  });

  it('a nap-only partial record keeps its known dose as a named scenario from that day', () => {
    const r = debts([nightDay(ctx0.profile, 8), observed({ bedClockH: 14, wakeClockH: 15, hours: 1, totalAsleepHours: 1, coverage: 'partial' }), nightDay(ctx0.profile, 8)]);
    expect(r.dF[1]).toBeCloseTo(Math.min(4, 7 - 1) * E1, 12);
    expect(r.s.partialSleepFromDay).toBe(1);
    expect(moderatorsOutputStatuses(r.s)).toEqual([{ series: expect.arrayContaining(['hunger', 'insulinSensitivity', 'mps']), status: 'scenario', reasonCode: 'partialSleepKnownDoseOnly', uncertaintyKind: 'scenario', fromDay: 1 }]);
    expect(moderatorsOutputStatuses(debts([nightDay(ctx0.profile, 8)]).s)).toEqual([]);
  });

  it('snapshot continuation equals the uninterrupted exposure; heuristics never subtract from logged hours', () => {
    const days = [
      nightDay(ctx0.profile, 6),
      observed({ bedClockH: 1, wakeClockH: 6, hours: 5, totalAsleepHours: 6.5 }),
      nightDay(ctx0.profile, 5, { caffeineMg: 400, alcoholG: 60 }),
      observed({ bedClockH: 0, wakeClockH: 7, hours: 7, quality: POOR }),
      nightDay(ctx0.profile, 8),
    ];
    const full = debts(days);
    const k = moderatorsModule.prepare(ctx0);
    const head = miniRun(mods, ctx0, days.slice(0, 2).map((day, i) => ({ clockDay: i, day })));
    const snap = structuredClone(head.S[0] as ModeratorsState);
    const bus = head.bus;
    const clock = { day: 0, hourOfDay: 0, hourIndex: 0, weekday: 0 };
    const dF: number[] = [];
    for (let i = 2; i < days.length; i++) {
      clock.day = i;
      moderatorsModule.startDay(snap, k, bus, days[i]!, clock);
      dF.push(bus.sleepDebtFastH);
      moderatorsModule.endOfDay(snap, k, bus, days[i]!, clock);
    }
    expect(dF).toEqual(full.dF.slice(2));
    expect(full.dF[1]).toBeGreaterThan(0); // 6.5 h logged total → 0.5 h deficit, no caffeine/alcohol decrement
  });
});

// =====================================================================================================================
// A1-013 energy intake-knowledge seeds
// =====================================================================================================================

describe('A1-013 unknown macronutrient allocation seeds conditional substrate and partition outputs', () => {
  const B = NUTRIENT_UNKNOWN_BIT;
  const calorieOnly = { energyKcal: 2100, proteinG: 0, carbG: 0, fatG: 0, unallocatedKcal: 2100, energyStatus: 'energyOnly', nutrientUnknownMask: B.protein | B.carbohydrate | B.fat } as const;
  const knownProtein = { energyKcal: 600, proteinG: 30, carbG: 0, fatG: 0, unallocatedKcal: 480, energyStatus: 'energyOnly', nutrientUnknownMask: B.carbohydrate | B.fat } as const;
  const reconciled = { energyKcal: 2000, proteinG: 100, carbG: 250, fatG: 63, unallocatedKcal: 30, energyStatus: 'consistent', nutrientUnknownMask: 0 } as const;

  it('calorie-only: carbohydrate/fat and protein unknown, whatever the energy-balance sign', () => {
    for (const kcal of [1500, 2100, 3500]) {
      const d = { ...calorieOnly, energyKcal: kcal, unallocatedKcal: kcal } as unknown as DayInput;
      expect(carbFatAllocationUnknown(d)).toBe(true);
      expect(proteinIntakeUnknown(d)).toBe(true);
      expect(proteinIsLowerBound(d)).toBe(true);
    }
  });

  it('600 kcal with 30 g known protein: protein stays known (no lower bound), carbohydrate/fat are unknown', () => {
    const d = knownProtein as unknown as DayInput;
    expect(proteinIsLowerBound(d)).toBe(false);
    expect(proteinIntakeUnknown(d)).toBe(false);
    expect(carbFatAllocationUnknown(d)).toBe(true);
    // a realised partial protein channel still makes the total a lower bound
    expect(proteinIsLowerBound({ ...d, coverage: { protein: 'partial' } })).toBe(true);
  });

  it('complete macros with a source-specific energy-factor reconciliation acquire no absent-macro status', () => {
    const d = reconciled as unknown as DayInput;
    expect(carbFatAllocationUnknown(d)).toBe(false);
    expect(proteinIntakeUnknown(d)).toBe(false);
    expect(proteinIsLowerBound(d)).toBe(false);
    expect(carbFatAllocationUnknown({ ...d, coverage: { carbohydrate: 'complete', fat: 'complete' }, nutrientUnknownMask: B.carbohydrate } as DayInput)).toBe(false);
    expect(carbFatAllocationUnknown({ ...d, coverage: { carbohydrate: 'partial' } } as DayInput)).toBe(true);
  });

  it('seeds name the substrate, tissue and marker paths; first affected day is found over the whole horizon', () => {
    for (const id of ['glucose', 'insulin', 'glycogenTotal', 'bhb', 'bhbEndpoint', 'waterWeight', 'fatMass', 'leanTissue', 'scaleWeight', 'bodyFatPct', 'nitrogenBalance', 'fatArms', 'muscleArms'] as const) {
      expect(CARB_FAT_DEPENDENT_SERIES, id).toContain(id);
    }
    for (const id of ['rmr', 'leanTissue', 'fatMass', 'nitrogenBalance', 'mps', 'muscleLegs'] as const) expect(PROTEIN_DEPENDENT_SERIES, id).toContain(id);
    expect(PROTEIN_DEPENDENT_SERIES).not.toContain('glucose');
    for (const a of Object.values(INTAKE_KNOWLEDGE_ASSUMPTIONS)) expect(a.uncertaintyKind).toBe('scenario');
    for (const a of Object.values(ENERGY_INTAKE_ASSUMPTIONS)) for (const id of a.series) expect(energyModule.records).toContain(id);
    const days = [reconciled, reconciled, knownProtein, calorieOnly, reconciled].map((d) => d as unknown as DayInput);
    expect(intakeKnowledgeAssumptionFromDays(days)).toEqual({ carbFatAllocationUnknown: 2, proteinIntakeUnknown: 3 });
    expect(intakeKnowledgeAssumptionFromDays([reconciled as unknown as DayInput])).toEqual({});
  });

  it('known protein of an energy-only meal drives protein turnover like a known day; the energy ledger keeps every kcal', () => {
    const rig = new EnergyRig(resolveProfile(MAN02_INPUT));
    rig.burnIn(7);
    const before = rig.s.pEffG;
    const day = {
      day: rig.day,
      ...knownProtein,
      mctG: 0,
      fibreG: 0,
      alcoholG: 0,
      caffeineMg: rig.profile.habits.habitualCaffeineMg,
      sleepHours: 8,
      sleepBedH: 23,
      sleepWakeH: 7,
      zeroIntake: false,
      maintenanceKcal: Number.NaN,
    } as unknown as DayInput;
    rig.clock.day = rig.day;
    energyModule.startDay(rig.s, rig.k, rig.bus, day, rig.clock);
    let ei = 0;
    for (let h = 0; h < 24; h++) {
      rig.clock.hourOfDay = h;
      rig.clock.hourIndex = rig.clock.day * 24 + h;
      rig.hour.hourOfDay = h;
      rig.hour.day = rig.day;
      rig.hour.hourIndex = rig.clock.hourIndex;
      rig.hour.asleep = h < 7 || h >= 23 ? 1 : 0;
      rig.bus.eAbsKcalH = (MEAL_HOURS as readonly number[]).includes(h) ? 600 / MEAL_HOURS.length : 0;
      rig.bus.alcOxGH = 0;
      energyModule.stepHour(rig.s, rig.k, rig.bus, rig.hour, day, rig.clock);
      ei += rig.bus.eAbsKcalH;
    }
    energyModule.endOfDay(rig.s, rig.k, rig.bus, day, rig.clock);
    expect(ei).toBeCloseTo(600, 9);
    expect(rig.s.proteinLowerBound).toBe(0);
    expect(rig.s.pEffG).toBeCloseTo(30 + (before - 30) * rig.k.fP, 9);
    expect(rig.s.alphaUnalloc).toBe(rig.k.tefHabMixNoProtein);
  });
});
