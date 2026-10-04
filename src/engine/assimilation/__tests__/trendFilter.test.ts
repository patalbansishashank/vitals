// @vitest-environment node
import { mulberry32 } from '../../core/math';
import { validateParamDefs } from '../../core/paramsRegistry';
import type { AnyEngineModule } from '../../types/module';
import { ASSIMILATION_DEFAULTS, ASSIMILATION_PARAMS, assimilationParams } from '../params';
import { countWeighIns, estimateDowOffsets, ewmaDisplay, mergeSameDay, runTrendFilter, smoothTrend, type WeighInObs } from '../trendFilter';
import { estimateEnergyBias, mixDensity } from '../energyBias';

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

describe('energy-balance bias', () => {
  const pts = (slope: number, n = 20) => Array.from({ length: n }, (_, d) => ({ day: d, y: 80 + slope * d, engineKg: 80 - 0.05 * d }));
  const base = { rhoKcalPerKg: 7000, sigmaKg: 0.4, deltaApplied: 0, previous: { mean: 0, sd: 150 }, intakeDaysWeek1: 6, intakeDaysWeek2: 5 };

  it('measures (r_obs − r_engine)·ρ + δ_applied, precision-weighted with the prior and step-capped', () => {
    // observed loses 0.02 kg/d less than the engine → +140 kcal/d measured
    const e = estimateEnergyBias({ ...base, points: pts(-0.03) });
    expect(e.updated).toBe(true);
    expect(e.measurement!.value).toBeCloseTo(140, 6);
    expect(e.mean).toBeGreaterThan(0);
    expect(e.mean).toBeLessThan(140);
    expect(e.sd).toBeLessThan(150);
    const big = estimateEnergyBias({ ...base, points: pts(0.05), sigmaKg: 0.05 });
    expect(big.mean).toBe(100);
    expect(big.reason).toBe('clampedStep');
    const capped = estimateEnergyBias({ ...base, points: pts(0.05), sigmaKg: 0.05, previous: { mean: 280, sd: 50 } });
    expect(capped.mean).toBe(300);
    expect(capped.reason).toBe('clampedValue');
  });

  it('keeps the previous value when gated (weigh-ins, logged intake days)', () => {
    expect(estimateEnergyBias({ ...base, points: pts(-0.03, 9), previous: { mean: 40, sd: 120 } })).toMatchObject({ mean: 40, updated: false, reason: 'fewWeighIns' });
    expect(estimateEnergyBias({ ...base, points: pts(-0.03), intakeDaysWeek2: 3 })).toMatchObject({ updated: false, reason: 'fewIntakeDays' });
  });

  it('widens the prior when most logged energy was AI-estimated', () => {
    const a = estimateEnergyBias({ ...base, points: pts(-0.03) });
    const b = estimateEnergyBias({ ...base, points: pts(-0.03), aiEnergyShare: 0.8 });
    expect(b.sd).toBeGreaterThan(a.sd);
    expect(b.mean).toBeGreaterThan(a.mean);
  });

  it('mix density follows the engine mix, with a Forbes fallback for small changes', () => {
    expect(mixDensity(-1, 0, 20)).toBeCloseTo(9620, 6);
    const forbes = mixDensity(0.01, 0.01, 25);
    expect(forbes).toBeGreaterThan(6000);
    expect(forbes).toBeLessThan(8000);
  });
});
