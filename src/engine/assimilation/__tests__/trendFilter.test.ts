// @vitest-environment node
import { mulberry32 } from '../../core/math';
import { validateParamDefs } from '../../core/paramsRegistry';
import type { AnyEngineModule } from '../../types/module';
import { CONTRACT_VERSIONS, statusValue } from '@/lib/bodyContracts';
import { BALANCE_CORRECTION_BOUNDS, TREND_FILTER_DEFAULTS } from '@/lib/measurementOperators';
import { ASSIMILATION_DEFAULTS, ASSIMILATION_PARAMS, assimilationParams, assimilationParamsHash, estimatorIdentity, type AssimilationParams } from '../params';
import {
  boundedTransientSdKg, countWeighIns, estimateDowOffsets, ewmaDisplay, mergeSameDay, observationVarianceKg2, runTrendFilter, smoothTrend, weighInContext, type WeighInObs,
} from '../trendFilter';
import { estimateEnergyBias, fitReplayResidual, linearBalanceMeasurement, mixDensity, mixDensityInfo, weightedSlope, type BiasWindowPoint } from '../energyBias';
import { gaussianScores, type GaussianForecast } from './forecastScores';

/** Deterministic standard normal (Box–Muller on mulberry32). */
function normals(seed: number): () => number {
  const u = mulberry32(seed);
  return () => Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u());
}

/** Linear loss with noise: truth w_d = w0 + rate·d; scale = truth + water + noise; ~80 % of days weighed. */
function synthetic(seed: number, days = 56, w0 = 82, rate = -0.08, sd = 0.41, water = (d: number) => 0.3 * Math.sin(d / 3)) {
  const z = normals(seed);
  const keep = mulberry32(seed + 1);
  const obs: WeighInObs[] = [];
  for (let d = 0; d < days; d++) {
    const noise = z() * sd;
    if (keep() < 0.8 || d === 0) obs.push({ day: d, scaleKg: w0 + rate * d + water(d) + noise, waterKg: water(d) });
  }
  return { obs, truth: (d: number) => w0 + rate * d };
}

describe('assimilation parameters', () => {
  it('are valid ParamDefs (prefix, bounds, sources) with grades, never drawn', () => {
    const fake = [{ id: 'assimilation', params: ASSIMILATION_PARAMS }] as unknown as AnyEngineModule[];
    expect(validateParamDefs(fake)).toEqual([]);
    for (const p of ASSIMILATION_PARAMS) {
      expect(['A', 'B', 'C', 'D']).toContain(p.grade);
      expect(p.draw).toBe('fixed');
    }
    expect(ASSIMILATION_DEFAULTS.sigmaRel).toBe(0.005);
    expect(ASSIMILATION_DEFAULTS.qW).toBe(0.03);
    expect(ASSIMILATION_DEFAULTS.qR).toBe(0.005);
    expect(ASSIMILATION_DEFAULTS.biasPriorSdKcal).toBe(150);
  });

  it('are the C4 contract defaults, labelled provisional engineering or policy values, never "verified" noise (D5-04)', () => {
    expect(ASSIMILATION_DEFAULTS.sigmaRel).toBe(TREND_FILTER_DEFAULTS.relObsSdStandardized);
    expect(ASSIMILATION_DEFAULTS.sigmaRelUnstd).toBe(TREND_FILTER_DEFAULTS.relObsSdUnstandardized);
    expect(ASSIMILATION_DEFAULTS.qW).toBe(TREND_FILTER_DEFAULTS.qWKgPerDay);
    expect(ASSIMILATION_DEFAULTS.qR).toBe(TREND_FILTER_DEFAULTS.qRKgPerDayPerDay);
    expect(ASSIMILATION_DEFAULTS.refMassKg).toBe(TREND_FILTER_DEFAULTS.referenceMassKg);
    expect(ASSIMILATION_DEFAULTS.biasClampKcal).toBe(BALANCE_CORRECTION_BOUNDS.maxAbsKcalPerDay);
    expect(ASSIMILATION_DEFAULTS.biasMaxStepKcal).toBe(BALANCE_CORRECTION_BOUNDS.maxStepKcalPerDecision);
    const byId = new Map(ASSIMILATION_PARAMS.map((p) => [p.id, p]));
    for (const id of ['sigmaRel', 'sigmaRelUnstd', 'qW', 'qR', 'dxaSdPct', 'biaSdPct', 'modelBfSdPct']) expect(byId.get(`assimilation.${id}`)!.status).not.toBe('verified');
    for (const p of ASSIMILATION_PARAMS) expect(['engineeringDefault', 'policy']).toContain(p.distribution?.label);
    expect(byId.get('assimilation.biasClampKcal')!.distribution!.label).toBe('policy');
    // SD units, not variances: daily state/rate increments
    expect(byId.get('assimilation.qW')!.unit).toMatch(/SD of the daily weight-state increment/);
    expect(byId.get('assimilation.qR')!.unit).toMatch(/SD of the daily rate-state increment/);
    // the AI prior bump is retired (0), its id kept for old links
    expect(ASSIMILATION_DEFAULTS.biasAiSdBumpKcal).toBe(0);
  });

  it('carry an estimator identity whose hash changes with any parameter (C7)', () => {
    const id = estimatorIdentity();
    expect(id).toEqual({ strategy: 'fixedPriorRefit', version: CONTRACT_VERSIONS.estimator, paramsHash: assimilationParamsHash(), windowDays: 20 });
    expect(assimilationParamsHash(assimilationParams())).toBe(id.paramsHash);
    expect(assimilationParamsHash(assimilationParams({ biasWindowDays: 28 }))).not.toBe(id.paramsHash);
    expect(assimilationParamsHash(assimilationParams({ qW: 0.04 }))).not.toBe(id.paramsHash);
  });

  it('overrides are clamped into [low, high]', () => {
    expect(assimilationParams({ sigmaRel: 0.02 }).sigmaRel).toBe(0.008);
    expect(assimilationParams({ qW: 0.04 }).qW).toBe(0.04);
  });
});

describe('local-linear-trend filter', () => {
  it('recovers the trend within 2 SD and the rate sign on synthetic loss (several seeds)', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { obs, truth } = synthetic(seed);
      const res = runTrendFilter(obs);
      const last = res.points[res.points.length - 1]!;
      expect(Math.abs(last.w - truth(last.day))).toBeLessThan(2.5 * last.wSd);
      expect(last.r).toBeLessThan(0);
      expect(Math.abs(last.r - -0.08)).toBeLessThan(3 * last.rSd);
    }
  });

  it('removes the engine water terms (the trend does not follow the water wave)', () => {
    const { obs, truth } = synthetic(7, 56, 82, -0.05, 0.05, (d) => 1.2 * Math.sin(d / 2));
    const sm = smoothTrend(runTrendFilter(obs));
    for (const p of sm.slice(10)) expect(Math.abs(p.w - truth(p.day))).toBeLessThan(0.25);
  });

  it('is deterministic and produces one point per day, predicting through gaps with growing SD', () => {
    const { obs } = synthetic(11, 30);
    const a = runTrendFilter(obs, { untilDay: 40 });
    const b = runTrendFilter(obs, { untilDay: 40 });
    expect(JSON.stringify(a.points)).toBe(JSON.stringify(b.points));
    expect(a.points).toHaveLength(41);
    const tail = a.points.slice(30);
    for (let i = 1; i < tail.length; i++) expect(tail[i]!.wSd).toBeGreaterThan(tail[i - 1]!.wSd);
  });

  it('flags an unusual weigh-in (inflated noise), never deletes it, and the trend barely moves', () => {
    const { obs } = synthetic(3, 30);
    const spikeDay = obs[Math.floor(obs.length * 0.7)]!.day;
    const spiked = obs.map((o) => (o.day === spikeDay ? { ...o, scaleKg: o.scaleKg + 3 } : o));
    const plain = runTrendFilter(obs);
    const res = runTrendFilter(spiked);
    expect(res.flaggedDays).toContain(spikeDay);
    const p = res.points.find((x) => x.day === spikeDay)!;
    expect(p.observed).toBe(true);
    expect(p.flagged).toBe(true);
    const q = plain.points.find((x) => x.day === spikeDay)!;
    expect(Math.abs(p.w - q.w)).toBeLessThan(0.15);
  });

  it('declared events inflate R (smaller gain)', () => {
    const { obs } = synthetic(5, 20);
    const bump = obs.map((o) => (o.day === 15 ? { ...o, scaleKg: o.scaleKg + 1 } : o));
    const ev = bump.map((o) => (o.day === 15 ? { ...o, rMult: 4 } : o));
    const a = runTrendFilter(bump).points.find((p) => p.day === 15)!;
    const b = runTrendFilter(ev).points.find((p) => p.day === 15)!;
    expect(b.w).toBeLessThan(a.w);
  });

  it('resets the trend SD to 1 kg after ≥ 14 days without a weigh-in', () => {
    const obs: WeighInObs[] = [];
    for (let d = 0; d < 10; d++) obs.push({ day: d, scaleKg: 80 });
    obs.push({ day: 30, scaleKg: 78 });
    const res = runTrendFilter(obs);
    const p = res.points.find((x) => x.day === 30)!;
    expect(p.reset).toBe(true);
    // with prior SD ≥ 1 kg the jump is mostly accepted
    expect(p.w).toBeLessThan(78.6);
  });

  it('starts from a confirmed prior when given', () => {
    const res = runTrendFilter([{ day: 11, scaleKg: 80.2 }], { prior: { day: 10, w: 80, wSd: 0.1, r: -0.05, rSd: 0.01 } });
    expect(res.points[0]!.day).toBe(11);
    expect(res.points[0]!.w).toBeGreaterThan(79.95);
    expect(res.points[0]!.w).toBeLessThan(80.1);
  });

  it('merges same-day weigh-ins and counts windows', () => {
    const m = mergeSameDay([{ day: 1, scaleKg: 80 }, { day: 1, scaleKg: 81 }, { day: 0, scaleKg: 79 }]);
    expect(m.map((o) => [o.day, o.scaleKg])).toEqual([[0, 79], [1, 80.5]]);
    expect(countWeighIns([1, 2, 3, 3, 9], 9, 7)).toBe(2);
  });
});

describe('observation model of a weigh-in (C4, D5-04, D1-06, D6-06)', () => {
  it('unknown context is never standardised: it uses the unstandardised noise; the legacy flag still maps', () => {
    expect(weighInContext({})).toBe('unknown');
    expect(weighInContext({ standardised: true })).toBe('standardized');
    expect(weighInContext({ standardised: false })).toBe('unstandardized');
    expect(weighInContext({ context: 'unknown', standardised: true })).toBe('unknown');
    const w = 80;
    expect(observationVarianceKg2({ day: 0, scaleKg: w }, w).rKg2).toBeCloseTo((0.0065 * w) ** 2, 12);
    expect(observationVarianceKg2({ day: 0, scaleKg: w, context: 'standardized' }, w).rKg2).toBeCloseTo((0.005 * w) ** 2, 12);
    const res = runTrendFilter([{ day: 0, scaleKg: 80 }, { day: 1, scaleKg: 80, context: 'standardized' }, { day: 2, scaleKg: 80, context: 'unstandardized' }]);
    expect(res.meta.contexts).toEqual({ standardized: 1, unstandardized: 1, unknown: 1 });
    // same-morning repeats keep the weakest context and are not averaged down
    const merged = mergeSameDay([{ day: 3, scaleKg: 80, context: 'standardized' }, { day: 3, scaleKg: 80.4 }]);
    expect(merged[0]!.context).toBe('unknown');
    expect(observationVarianceKg2(merged[0]!, 80).rKg2).toBeCloseTo((0.0065 * 80) ** 2, 12);
  });

  it('scale − model water: Var = Var(S) + Var(W) − 2Cov(S, W); an impossible covariance is rejected, never clamped', () => {
    const w = 80;
    const rs = (0.005 * w) ** 2;
    const o = { day: 0, scaleKg: w, context: 'standardized' as const };
    expect(observationVarianceKg2({ ...o, waterSdKg: 0.3 }, w).rKg2).toBeCloseTo(rs + 0.09, 12);
    expect(observationVarianceKg2({ ...o, waterSdKg: 0.3, waterCovKg2: 0.02 }, w).rKg2).toBeCloseTo(rs + 0.09 - 0.04, 12);
    const bad = observationVarianceKg2({ ...o, waterSdKg: 0.3, waterCovKg2: 1 }, w);
    expect(bad.covarianceRejected).toBe(true);
    expect(bad.rKg2).toBeCloseTo(rs + 0.09, 12);
    // without a supplied water variance every SD is conditional on the model water term, and says so
    const { obs } = synthetic(2, 20);
    const m = runTrendFilter(obs).meta;
    expect(m.waterUncertainty).toBe('notModelled');
    expect(m.uncertaintyKind).toBe('conditionalResidual');
    expect(m.coverage).toBe('unvalidated');
    expect(m.version).toBe(CONTRACT_VERSIONS.estimator);
    expect(runTrendFilter(obs.map((x) => ({ ...x, waterSdKg: 0.2 }))).meta.waterUncertainty).toBe('supplied');
  });

  it('a positive-semidefinite increase of the evidence covariance never increases its information', () => {
    const { obs } = synthetic(4, 40);
    const plain = runTrendFilter(obs);
    const wider = runTrendFilter(obs.map((x, k) => ({ ...x, waterSdKg: 0.1 + 0.05 * (k % 3), transientSdKg: 0.05 })));
    for (let k = 0; k < plain.points.length; k++) {
      expect(wider.points[k]!.wSd).toBeGreaterThanOrEqual(plain.points[k]!.wSd - 1e-12);
      expect(wider.points[k]!.rSd).toBeGreaterThanOrEqual(plain.points[k]!.rSd - 1e-12);
    }
  });

  it('an unknown cycle amplitude keeps transient variance (never zero) and the trend does not follow the transient', () => {
    expect(boundedTransientSdKg(0.2)).toBeCloseTo(0.1, 12);
    expect(boundedTransientSdKg(Number.NaN)).toBeNull();
    const cycle = (d: number) => 0.4 * Math.sin((2 * Math.PI * d) / 28); // an unmodelled transient: not in the model water
    const obs: WeighInObs[] = Array.from({ length: 84 }, (_, d) => ({ day: d, scaleKg: 80 - 0.03 * d + cycle(d), context: 'standardized' as const }));
    const sd = boundedTransientSdKg(0.8)!;
    const plain = smoothTrend(runTrendFilter(obs));
    const withT = runTrendFilter(obs.map((x) => ({ ...x, transientSdKg: sd })));
    expect(withT.meta.transient).toBe('supplied');
    const sm = smoothTrend(withT);
    const err = (pts: typeof sm) => Math.max(...pts.slice(14).map((p) => Math.abs(p.w - (80 - 0.03 * p.day))));
    expect(err(sm)).toBeLessThan(err(plain));
    // its variance is part of every observation (never shrunk to zero)
    expect(observationVarianceKg2({ day: 0, scaleKg: 80, context: 'standardized', transientSdKg: sd }, 80).rKg2).toBeGreaterThan(sd * sd);
  });

  it('a shared device bias never averages down; a device change widens the level by both bias variances', () => {
    const z = normals(21);
    const same: WeighInObs[] = Array.from({ length: 60 }, (_, d) => ({ day: d, scaleKg: 80 + 0.4 * z(), device: 'A', systematicSdKg: 0.3 }));
    const res = runTrendFilter(same);
    expect(res.meta.systematicSdKg).toBe(0.3);
    expect(res.points[res.points.length - 1]!.wSd).toBeLessThan(0.3); // the relative trend tightens, the level floor stays
    const switched = same.map((o) => (o.day >= 30 ? { ...o, device: 'B' } : o));
    const sw = runTrendFilter(switched);
    const p30 = sw.points.find((p) => p.day === 30)!;
    expect(p30.deviceChange).toBe(true);
    expect(sw.meta.deviceChanges).toBe(1);
    expect(p30.wSd).toBeGreaterThan(res.points.find((p) => p.day === 30)!.wSd);
  });
});

describe('day-of-week offset and display line', () => {
  it('needs 6 weeks, then finds a weekend bump (sum zero)', () => {
    const z = normals(9);
    const make = (days: number): WeighInObs[] =>
      Array.from({ length: days }, (_, d) => ({ day: d, scaleKg: 80 - 0.03 * d + ((d % 7) >= 5 ? 0.6 : -0.24) + 0.2 * z() }));
    expect(estimateDowOffsets(make(30), 0)).toBeNull();
    const off = estimateDowOffsets(make(70), 0)!;
    expect(off).toHaveLength(7);
    expect(Math.abs(off.reduce((a, b) => a + b, 0))).toBeLessThan(1e-9);
    expect(off[5]!).toBeGreaterThan(0.3);
    expect(off[6]!).toBeGreaterThan(0.3);
    expect(off[2]!).toBeLessThan(0);
  });

  it('EWMA α = 0.1 interpolates gaps for display and is flat on a flat series', () => {
    const flat = ewmaDisplay([{ day: 0, scaleKg: 80 }, { day: 5, scaleKg: 80 }]);
    expect(flat).toHaveLength(6);
    expect(flat.every((p) => p.kg === 80)).toBe(true);
    const step = ewmaDisplay([{ day: 0, scaleKg: 80 }, { day: 1, scaleKg: 81 }]);
    expect(step[1]!.kg).toBeCloseTo(80.1, 10);
  });
});

describe('balance correction δ (D5-03, D5-04)', () => {
  const pts = (slope: number, n = 20) => Array.from({ length: n }, (_, d) => ({ day: d, y: 80 + slope * d, engineKg: 80 - 0.05 * d }));
  const base = { rhoKcalPerKg: 7000, sigmaKg: 0.4, deltaApplied: 0, previous: { mean: 0, sd: 150 }, intakeDaysWeek1: 6, intakeDaysWeek2: 5 };

  it('measures ρ·slope(y − E) + slope(A), precision-weighted with the fixed prior and bounded by the controller', () => {
    // observed loses 0.02 kg/d less than the engine → +140 kcal/d measured
    const e = estimateEnergyBias({ ...base, points: pts(-0.03) });
    expect(e.updated).toBe(true);
    expect(e.measurement!.value).toBeCloseTo(140, 6);
    expect(e.measurement!.method).toBe('linearAppliedHistory');
    expect(e.mean).toBeGreaterThan(0);
    expect(e.mean).toBeLessThan(140);
    expect(e.sd).toBeLessThan(150);
    const big = estimateEnergyBias({ ...base, points: pts(0.05), sigmaKg: 0.05 });
    expect(big.mean).toBe(100);
    expect(big.reason).toBe('clampedStep');
    const capped = estimateEnergyBias({ ...base, points: pts(0.05), sigmaKg: 0.05, previous: { mean: 280, sd: 50 } });
    expect(capped.mean).toBe(300);
    expect(capped.reason).toBe('clampedValue');
    expect(capped.saturated).toBe(true);
  });

  it('keeps the previous value when gated (weigh-ins, calibration-eligible intake days)', () => {
    expect(estimateEnergyBias({ ...base, points: pts(-0.03, 9), previous: { mean: 40, sd: 120 } })).toMatchObject({ mean: 40, updated: false, reason: 'fewWeighIns' });
    expect(estimateEnergyBias({ ...base, points: pts(-0.03), intakeDaysWeek2: 3 })).toMatchObject({ updated: false, reason: 'fewIntakeDays' });
  });

  it('true δ = 0 is recovered when the applied offset changes 0 → 100 mid-window (the old reading was 53.7594)', () => {
    const rho = 7000;
    // the replay carried +100 kcal/d from day 10 that the person never had: ρ(y − E) = −A + c
    const A = (t: number) => 100 * Math.max(0, t - 10);
    const window: BiasWindowPoint[] = Array.from({ length: 20 }, (_, t) => ({ day: t, y: 80, engineKg: 80 + A(t) / rho, appliedCumKcal: A(t) }));
    const now = linearBalanceMeasurement(window, rho, 0.4, 100)!;
    expect(now.value).toBeCloseTo(0, 9);
    const old = linearBalanceMeasurement(window.map(({ appliedCumKcal: _a, ...p }) => p), rho, 0.4, 100)!;
    expect(old.value).toBeCloseTo(53.7594, 4);
  });

  it('constant application reduces to the analytic law; random weekly steps with sign changes recover δ exactly', () => {
    const rho = 8000;
    const window: BiasWindowPoint[] = Array.from({ length: 20 }, (_, t) => ({ day: t, y: 80 + 0.01 * t, engineKg: 80 }));
    const lin = linearBalanceMeasurement(window, rho, 0.4, 150)!;
    expect(lin.value).toBeCloseTo(0.01 * rho + 150, 9);
    const u = mulberry32(5);
    for (let trial = 0; trial < 25; trial++) {
      const truth = (u() - 0.5) * 600;
      const r = 6000 + 3000 * u();
      const steps = [0, 1, 2].map(() => Math.round((u() - 0.5) * 400));
      const applied = (d: number) => steps[Math.min(2, Math.floor(d / 7))]!;
      let A = 0;
      const pts2: BiasWindowPoint[] = [];
      for (let t = 0; t < 21; t++) {
        // linear constant-density system: ρ·d(y − E)/dt = δ_true − δ_applied(t); y − E accumulates the gap
        pts2.push({ day: t, y: 80 + (truth * t - A) / r, engineKg: 80, appliedCumKcal: A });
        A += applied(t);
      }
      expect(linearBalanceMeasurement(pts2, r, 0.4, steps[2]!)!.value).toBeCloseTo(truth, 6);
    }
  });

  it('refits each decision from the fixed prior: overlapping windows are recomputation, never compounding evidence', () => {
    const first = estimateEnergyBias({ ...base, points: pts(-0.03) });
    const second = estimateEnergyBias({ ...base, points: pts(-0.03), previous: { mean: first.mean, sd: first.sd } });
    expect(second.requestedKcal).toBeCloseTo(first.requestedKcal!, 12);
    expect(second.sd).toBeCloseTo(first.sd, 12);
    expect(first.strategy).toBe('fixedPriorRefit');
  });

  it('a source label never changes the weight of the residual (the AI prior bump is retired)', () => {
    const a = estimateEnergyBias({ ...base, points: pts(-0.03) });
    const b = estimateEnergyBias({ ...base, points: pts(-0.03), aiEnergyShare: 0.95 });
    expect(b).toEqual(a);
  });

  it('a positive-semidefinite increase of observation variance never increases the information of the same residual', () => {
    const z = normals(3);
    const v = Array.from({ length: 20 }, (_, k) => 0.02 * k + 0.3 * z());
    const s = Array.from({ length: 20 }, (_, k) => k / 7000);
    const vars = Array.from({ length: 20 }, () => 0.16);
    const m0 = fitReplayResidual(v, s, vars)!;
    for (let trial = 0; trial < 10; trial++) {
      const more = vars.map((x, k) => x + (k % (trial + 2) === 0 ? 0.1 * (trial + 1) : 0));
      expect(fitReplayResidual(v, s, more)!.se).toBeGreaterThanOrEqual(m0.se - 1e-9);
    }
    const p = pts(-0.03);
    const l0 = linearBalanceMeasurement(p, 7000, 0.4, 0)!;
    const l1 = linearBalanceMeasurement(p.map((x, k) => ({ ...x, varKg2: 0.16 + (k % 2) * 0.2 })), 7000, 0.4, 0)!;
    expect(l1.se).toBeGreaterThanOrEqual(l0.se);
  });

  it('bounds keep the unconstrained estimate separate and say so: requested, applied, saturation, conditional SD', () => {
    const e = estimateEnergyBias({ ...base, points: pts(0.05), sigmaKg: 0.05, previous: { mean: 280, sd: 50 } });
    expect(e.requestedKcal!).toBeGreaterThan(300);
    expect(e.mean).toBe(300);
    expect(e.posterior!.mean).toBe(e.requestedKcal);
    expect(e.sd).toBe(e.posterior!.sd);
    expect(e.uncertaintyKind).toBe('conditionalResidual');
    expect(e.coverage).toBe('unvalidated');
    // the step counts from the value in force at the start of the weekly period, not from the last retry
    const retry = estimateEnergyBias({ ...base, points: pts(0.05), sigmaKg: 0.05, previous: { mean: 100, sd: 50 }, stepReferenceKcal: 0 });
    expect(retry.mean).toBe(100);
    expect(retry.stepLimited).toBe(true);
  });

  it('a robust pass inflates (never deletes) a gross residual', () => {
    const v = Array.from({ length: 20 }, (_, k) => 0.01 * k);
    v[12] = v[12]! + 5;
    const s = Array.from({ length: 20 }, (_, k) => k / 7000);
    const m = fitReplayResidual(v, s, Array.from({ length: 20 }, () => 0.04))!;
    expect(m.downweighted).toBe(1);
    expect(m.n).toBe(20);
    const plain = weightedSlope(s, v, Array.from({ length: 20 }, () => 25)).slope;
    expect(Math.abs(m.value - 70)).toBeLessThan(Math.abs(plain - 70) / 3);
  });

  it('mix density follows the engine mix; recomposition falls back to Forbes and says so (no manufactured density)', () => {
    expect(mixDensity(-1, 0, 20)).toBeCloseTo(9620, 6);
    const forbes = mixDensity(0.01, 0.01, 25);
    expect(forbes).toBeGreaterThan(6000);
    expect(forbes).toBeLessThan(8000);
    expect(mixDensityInfo(-1, 0.95, 20).source).toBe('forbesFallback');
    expect(mixDensityInfo(-1, 0, 20).source).toBe('windowMix');
  });
});

describe('uncertainty of the trend under correlated and off-model errors (D5-04): reported, never claimed calibrated', () => {
  it('reports empirical coverage, width, bias and MAE of the ±1.28 SD band; the band stays labelled unvalidated', () => {
    const scenarios: Record<string, (d: number, z: () => number) => number> = {
      iid: (_d, z) => 0.4 * z(),
      correlatedFluid: (() => { let e = 0; return (_d: number, z: () => number) => (e = 0.8 * e + 0.25 * z()); })(),
      cycle: (d, z) => 0.3 * Math.sin((2 * Math.PI * d) / 28) + 0.3 * z(),
      creatineStep: (d, z) => (d >= 30 ? 1.0 : 0) + 0.3 * z(),
      illness: (d, z) => (d >= 40 && d < 46 ? -1.5 : 0) + 0.3 * z(),
      deviceChange: (d, z) => (d >= 35 ? 0.6 : 0) + 0.3 * z(),
      gap: (_d, z) => 0.3 * z(),
    };
    /** Shape of the series beyond its error: a 16-day gap without weigh-ins, a scale swap with a declared device bias SD. */
    const shape: Record<string, (d: number) => Partial<WeighInObs> | null> = {
      gap: (d) => (d >= 20 && d < 36 ? null : {}),
      deviceChange: (d) => ({ device: d >= 35 ? 'scaleB' : 'scaleA', systematicSdKg: 0.5 }),
    };
    const report: Record<string, { coverage: number; width: number; bias: number; mae: number }> = {};
    for (const [name, err] of Object.entries(scenarios)) {
      const z = normals(name.length * 7);
      const obs: WeighInObs[] = [];
      for (let d = 0; d < 70; d++) {
        const scaleKg = 85 - 0.05 * d + err(d, z);
        const extra = shape[name] ? shape[name]!(d) : {};
        if (extra) obs.push({ day: d, scaleKg, ...extra });
      }
      const res = runTrendFilter(obs);
      if (name === 'gap') expect(res.meta.resets).toBe(1);
      if (name === 'deviceChange') expect(res.meta.deviceChanges).toBe(1);
      let hit = 0;
      let width = 0;
      let bias = 0;
      let mae = 0;
      const pts = res.points.slice(14);
      for (const p of pts) {
        const truth = 85 - 0.05 * p.day;
        if (Math.abs(p.w - truth) <= 1.28 * p.wSd) hit++;
        width += 2.56 * p.wSd;
        bias += p.w - truth;
        mae += Math.abs(p.w - truth);
      }
      report[name] = { coverage: hit / pts.length, width: width / pts.length, bias: bias / pts.length, mae: mae / pts.length };
      expect(res.meta.coverage).toBe('unvalidated');
      expect(res.meta.uncertaintyKind).toBe('conditionalResidual');
    }
    for (const r of Object.values(report)) for (const v of Object.values(r)) expect(Number.isFinite(v)).toBe(true);
    // an off-model step (creatine water) is not absorbed silently: the band misses it more often than under iid noise
    expect(report.creatineStep!.mae).toBeGreaterThan(report.iid!.mae);
  });
});

// ------------------------------------------------------------------------------------------- D5-08 calibration fixture
/**
 * D5-08 (assimilation contribution): partial manual weighing stays useful, repeated same-morning readings are one day of
 * evidence, and personal calibration fits only a small noise set on training weeks, freezes it and scores untouched future
 * weeks against simple baselines with proper scores. A score on one block is a report: the band keeps its
 * 'conditionalResidual' / 'unvalidated' labels, and nothing in it attributes the residual to a cause.
 */
describe('partial weighing, clustered same-day evidence and prospective scoring of the trend filter (D5-08)', () => {
  it('same-morning repeats are one day of evidence: the posterior equals one reading at their mean (no pseudo-replication)', () => {
    const { obs } = synthetic(13, 30);
    const d = obs[Math.floor(obs.length / 2)]!.day;
    const m = obs.find((o) => o.day === d)!;
    const repeats = [-0.6, -0.3, 0.3, 0.6].map((x) => ({ ...m, scaleKg: m.scaleKg + x }));
    const one = runTrendFilter(obs);
    const five = runTrendFilter([...obs, ...repeats]);
    expect(five.points).toHaveLength(one.points.length);
    for (let k = 0; k < one.points.length; k++) {
      const a = one.points[k]!;
      const b = five.points[k]!;
      // the variance is that of one day (σ_rel is day-to-day variability), so the SDs are identical, not divided by 5
      expect(b.wSd).toBe(a.wSd);
      expect(b.rSd).toBe(a.rSd);
      expect(b.w).toBeCloseTo(a.w, 9);
      expect(b.r).toBeCloseTo(a.r, 9);
    }
    // contexts and the check-in gate count days, never readings
    expect(five.meta.contexts).toEqual(one.meta.contexts);
    expect(countWeighIns([...obs, ...repeats].map((o) => o.day), d, 1)).toBe(1);
  });

  it('partial weighing (one reading a week) still gives a finite daily trend; no reading is mandated', () => {
    const weekly: WeighInObs[] = Array.from({ length: 9 }, (_, k) => ({ day: 7 * k, scaleKg: 86 - 0.4 * k + (k % 2 === 0 ? 0.2 : -0.2) }));
    const res = runTrendFilter(weekly);
    expect(res.points).toHaveLength(57);
    for (const p of res.points) for (const v of [p.w, p.wSd, p.r, p.rSd]) expect(Number.isFinite(v)).toBe(true);
    for (let k = 1; k < res.points.length; k++) {
      const p = res.points[k]!;
      const q = res.points[k - 1]!;
      // uncertainty grows on days without a reading and shrinks at each reading
      if (p.observed) expect(p.wSd).toBeLessThan(q.wSd);
      else expect(p.wSd).toBeGreaterThan(q.wSd);
    }
    expect(res.points[res.points.length - 1]!.r).toBeLessThan(0);
    // below the weekly decision gate the display trend continues; the decision simply waits
    expect(countWeighIns(weekly.map((o) => o.day), 56, 7)).toBeLessThan(ASSIMILATION_DEFAULTS.checkInMin7);
    // with a confirmed prior and no new readings the filter predicts forward with growing SD
    const quiet = runTrendFilter([], { prior: { day: 56, w: 82.8, wSd: 0.3, r: -0.05, rSd: 0.02 }, untilDay: 70 });
    expect(quiet.points.map((p) => p.day)).toEqual(Array.from({ length: 14 }, (_, k) => 57 + k));
    expect(quiet.points.every((p) => !p.observed && Number.isFinite(p.w))).toBe(true);
    for (let k = 1; k < quiet.points.length; k++) expect(quiet.points[k]!.wSd).toBeGreaterThan(quiet.points[k - 1]!.wSd);
    expect(runTrendFilter([]).points).toEqual([]);
  });

  it('the filter is causal: appending future weeks changes no filtered past point (held-out data never leaks into a fit)', () => {
    const { obs } = synthetic(17, 84);
    const train = obs.filter((o) => o.day < 56);
    const a = runTrendFilter(train);
    const b = runTrendFilter(obs);
    expect(b.points.slice(0, a.points.length)).toEqual(a.points);
  });

  /** A trending series with off-model correlated fluid; deterministic per seed. */
  function trending(seed: number, days = 84, w0 = 84, rate = -0.06): WeighInObs[] {
    const z = normals(seed);
    const keep = mulberry32(seed + 1);
    let fluid = 0;
    const obs: WeighInObs[] = [];
    for (let d = 0; d < days; d++) {
      fluid = 0.7 * fluid + 0.2 * z();
      const y = w0 + rate * d + fluid + 0.3 * z();
      if (keep() < 0.85 || d === 0) obs.push({ day: d, scaleKg: y, observationId: `y${d}` });
    }
    return obs;
  }

  /** Prequential (one-step-ahead) Gaussian forecasts of each reading on or after `fromDay`, before its update. */
  function oneStepAhead(obs: readonly WeighInObs[], prm: AssimilationParams, fromDay: number): GaussianForecast[] {
    const merged = mergeSameDay(obs);
    const byDay = new Map(merged.map((o) => [o.day, o] as const));
    const res = runTrendFilter(merged, { params: prm });
    const out: GaussianForecast[] = [];
    res.points.forEach((p, i) => {
      if (!p.observed || p.day < fromDay) return;
      const o = byDay.get(p.day)!;
      const mu = res.internals.xp[2 * i]!;
      out.push({ y: o.scaleKg - (o.waterKg ?? 0), mu, sd: Math.sqrt(res.internals.pp[3 * i]! + observationVarianceKg2(o, mu, prm).rKg2) });
    });
    return out;
  }

  /** Fit q_w on the training weeks only (a small grid inside its declared bounds), freeze it, score the future weeks. */
  function prospective(obs: readonly WeighInObs[], trainEnd: number) {
    const def = ASSIMILATION_PARAMS.find((p) => p.id === 'assimilation.qW')!;
    const grid = [0.02, 0.03, 0.04, 0.05].filter((q) => q >= def.low && q <= def.high);
    const train = obs.filter((o) => o.day < trainEnd);
    const test = mergeSameDay(obs.filter((o) => o.day >= trainEnd));
    const fits = grid.map((qW) => ({ qW, nlpd: gaussianScores(oneStepAhead(train, assimilationParams({ qW }), 14))!.nlpd }));
    const best = fits.reduce((a, b) => (b.nlpd < a.nlpd ? b : a));
    const frozen = assimilationParams({ qW: best.qW });
    const last = test[test.length - 1]!.day;
    const fit = runTrendFilter(train, { params: frozen, untilDay: last });
    const byDay = new Map(fit.points.map((p) => [p.day, p] as const));
    const model: GaussianForecast[] = test.map((o) => {
      const p = byDay.get(o.day)!;
      return { y: o.scaleKg, mu: p.w, sd: Math.sqrt(p.wSd ** 2 + observationVarianceKg2(o, p.w, frozen).rKg2) };
    });
    // baselines: last training reading as a random walk, and the display EWMA carried forward with its residual SD
    const tm = mergeSameDay(train);
    let num = 0;
    let den = 0;
    for (let k = 1; k < tm.length; k++) {
      num += (tm[k]!.scaleKg - tm[k - 1]!.scaleKg) ** 2;
      den += tm[k]!.day - tm[k - 1]!.day;
    }
    const lastTrain = tm[tm.length - 1]!;
    const lastValue: GaussianForecast[] = test.map((o) => ({ y: o.scaleKg, mu: lastTrain.scaleKg, sd: Math.sqrt((num / den) * (o.day - lastTrain.day)) }));
    const line = ewmaDisplay(train);
    const ewmaByDay = new Map(line.map((x) => [x.day, x.kg] as const));
    const resid = tm.filter((o) => o.day >= 14).map((o) => o.scaleKg - ewmaByDay.get(o.day)!);
    const ewmaSd = Math.sqrt(resid.reduce((s, r) => s + r * r, 0) / resid.length);
    const ewma: GaussianForecast[] = test.map((o) => ({ y: o.scaleKg, mu: line[line.length - 1]!.kg, sd: ewmaSd }));
    return {
      fits,
      qW: best.qW,
      bounds: [def.low, def.high] as const,
      meta: fit.meta,
      scores: { model: gaussianScores(model)!, lastValue: gaussianScores(lastValue)!, ewma: gaussianScores(ewma)! },
    };
  }

  it('a small noise set chosen on training weeks is frozen and scored on untouched future weeks against simple baselines', () => {
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
    const reports = seeds.map((seed) => ({ seed, nTest: mergeSameDay(trending(seed).filter((o) => o.day >= 56)).length, r: prospective(trending(seed), 56) }));
    for (const { nTest, r } of reports) {
      expect(r.qW).toBeGreaterThanOrEqual(r.bounds[0]);
      expect(r.qW).toBeLessThanOrEqual(r.bounds[1]);
      expect(r.fits.map((f) => f.qW)).toContain(r.qW);
      for (const sc of Object.values(r.scores)) {
        expect(sc.n).toBe(nTest);
        for (const v of Object.values(sc)) expect(Number.isFinite(v)).toBe(true);
      }
      // one held-out block leaves the labels unchanged: a conditional band is never relabelled calibrated
      expect(r.meta.uncertaintyKind).toBe('conditionalResidual');
      expect(r.meta.coverage).toBe('unvalidated');
      // the report holds scores only: no share of the residual is attributed to intake, expenditure or adherence
      for (const k of Object.keys(r.scores.model)) expect(k).not.toMatch(/cause|share|adherence|expenditure|intake/i);
    }
    // a single block can favour a trend-blind baseline; across blocks of a trending series the local linear trend wins
    const total = (k: 'model' | 'lastValue' | 'ewma', f: 'mae' | 'intervalScore') => reports.reduce((s, x) => s + x.r.scores[k][f], 0);
    expect(total('model', 'mae')).toBeLessThan(total('lastValue', 'mae'));
    expect(total('model', 'mae')).toBeLessThan(total('ewma', 'mae'));
    expect(total('model', 'intervalScore')).toBeLessThan(total('lastValue', 'intervalScore'));
    expect(total('model', 'intervalScore')).toBeLessThan(total('ewma', 'intervalScore'));
    // same input, seed and version → the same report (reproducible)
    expect(prospective(trending(3), 56)).toEqual(reports[2]!.r);
    const band = statusValue({ status: 'estimated', range: [81.2, 82.9], unit: 'kg', uncertaintyKind: reports[0]!.r.meta.uncertaintyKind, coverageStatus: 'heldOutValidated' });
    expect(band.coverageStatus).toBe('unvalidated');
  });
});
