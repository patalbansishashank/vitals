// @vitest-environment node
import { buildModelParams, drawKindOf, sampleParams, validateParamDefs, withOverrides, param, quantilesToParams, variableParamCount } from '../paramsRegistry';
import { MODULES } from '../moduleRegistry';
import { bandMetaFor } from '@/lib/bodyContracts';
import { defineModule } from '../moduleKit';
import { mmRemaining, gamma2Mass, gamma2HourMean, lambertW0 } from '../math';
import { runEngine } from '../loop';
import { compileSchedule } from '../compileSchedule';
import { resolveProfile } from '../resolveProfile';
import { MI } from '../../types/metrics';
import type { AnyEngineModule } from '../../types/module';
import type { ParamDef } from '../../types/params';
import { MAN, repeatSchedule } from './fixtures';

const P: ParamDef[] = [
  { id: 'energy.betaAT', value: 0.14, unit: '1', low: 0.05, high: 0.4, grade: 'B', source: 'Hall 2011 PMID 21872751', dossier: '02 §4.8' },
  { id: 'energy.tauOff', value: 14, unit: 'd', low: 14, high: 42, grade: 'C', source: '02', dossier: '02 §4.8', status: 'proposed-fit', draw: 'logTri' },
  { id: 'energy.fixed', value: 4.184, unit: 'kJ/kcal', low: 4.184, high: 4.184, grade: 'A', source: 'definition', dossier: '—' },
];
const fake = defineModule<object>({ id: 'energy', specSection: 't', dossiers: 't', params: P, reads: [], writes: [], records: [], init: () => ({}) }) as unknown as AnyEngineModule;

describe('parameter registry', () => {
  it('builds ModelParams in module order and validates definitions', () => {
    const mp = buildModelParams([fake]);
    expect(Array.from(mp.values)).toEqual([0.14, 14, 4.184]);
    expect(param(mp, 'energy.tauOff')).toBe(14);
    expect(validateParamDefs([fake])).toEqual([]);
    const bad = defineModule<object>({ id: 'fuel', specSection: 't', dossiers: 't', params: [{ ...P[0]!, id: 'energy.x', value: 1 }], reads: [], writes: [], records: [], init: () => ({}) }) as unknown as AnyEngineModule;
    const issues = validateParamDefs([bad]);
    expect(issues.map((i) => i.problem)).toEqual(expect.arrayContaining(['id must start with "fuel."', 'requires low ≤ value ≤ high']));
  });

  it('Latin-hypercube draws are deterministic, bounded and stratified; fixed params never vary', () => {
    const a = sampleParams(P, { count: 20, seed: 42 });
    const b = sampleParams(P, { count: 20, seed: 42 });
    expect(a.map((v) => Array.from(v))).toEqual(b.map((v) => Array.from(v)));
    for (const v of a) {
      expect(v[0]!).toBeGreaterThanOrEqual(0.05);
      expect(v[0]!).toBeLessThanOrEqual(0.4);
      expect(v[1]!).toBeGreaterThanOrEqual(14);
      expect(v[2]).toBe(4.184);
    }
    // one draw per stratum of the CDF for the first parameter
    const u = a.map((v) => v[0]!).sort((x, y) => x - y);
    expect(new Set(u.map((x) => Math.min(19, Math.floor(triCdf(x, 0.05, 0.14, 0.4) * 20)))).size).toBe(20);
    expect(() => withOverrides(buildModelParams([fake]), new Float64Array(2))).toThrow();
  });

  it('maps planner ensemble quantiles onto parameter vectors (MODEL_SPEC §8.1, §10.1)', () => {
    const U: ParamDef = { id: 'energy.u1', value: 0.5, unit: '1', low: 0, high: 1, grade: 'D', source: 'latent quantile', dossier: '06 §4.17', draw: 'uniform' };
    const defs = [...P, U];
    expect(variableParamCount(defs)).toBe(3);
    const mid = quantilesToParams(defs, [0.5, 0.5, 0.25]);
    expect(mid[2]).toBe(4.184); // fixed parameter keeps its value and consumes no quantile
    expect(mid[3]).toBeCloseTo(0.25, 12); // uniform: low + q·(high − low)
    expect(triCdf(mid[0]!, 0.05, 0.14, 0.4)).toBeCloseTo(0.5, 9);
    const lo = quantilesToParams(defs, [0, 0, 0]);
    expect(lo[0]).toBeCloseTo(0.05, 12);
    expect(lo[1]).toBeCloseTo(14, 9);
    const draws = sampleParams(defs, { count: 8, seed: 3 });
    for (const v of draws) {
      expect(v[3]!).toBeGreaterThanOrEqual(0);
      expect(v[3]!).toBeLessThanOrEqual(1);
    }
  });
});

function triCdf(x: number, a: number, c: number, b: number): number {
  return x <= c ? ((x - a) ** 2) / ((b - a) * (c - a)) : 1 - ((b - x) ** 2) / ((b - a) * (b - c));
}

describe('numerical helpers', () => {
  it('Michaelis–Menten emptying matches a fine Euler reference', () => {
    let e = 700;
    for (let i = 0; i < 100000; i++) e -= (270 * e) / (150 + e) * (1 / 100000);
    expect(mmRemaining(700, 270, 150, 1)).toBeCloseTo(e, 3);
    expect(lambertW0(Math.E)).toBeCloseTo(1, 12);
  });
  it('gamma(2) kernel mass integrates to 1 and hour means agree with the mass', () => {
    expect(gamma2Mass(0, 1000, 0.75)).toBeCloseTo(1, 9);
    expect(gamma2HourMean(2, 3, 1)).toBeCloseTo(gamma2Mass(2, 3, 1), 12);
  });
});

describe('recorder aggregation', () => {
  it('aggregates hourly series by the catalogue rule (sum, mean, wake, end)', () => {
    const probe = defineModule<{ h: number }>({
      id: 'energy', specSection: 't', dossiers: 't', params: [], reads: [], writes: [], records: ['tdee', 'autophagyIdx'],
      init: () => ({ h: 0 }),
      stepHour: (s, _k, _b, hour) => {
        s.h = hour.hourOfDay;
      },
      recordHour: (s, _k, _b, out) => {
        out[MI.tdee] = 100; // agg 'sum' → 2400
        out[MI.autophagyIdx] = s.h; // agg 'mean' → 11.5
        out[MI.scaleWeight] = s.h; // agg 'wake' → the state at the 07:00 wake time = the value recorded for hour 6
        out[MI.glycogenTotal] = s.h; // agg 'end' → 23
      },
    }) as unknown as AnyEngineModule;
    const p = resolveProfile(MAN);
    const r = runEngine(p, compileSchedule(repeatSchedule(2, [1]), p), { burnInDays: 0 }, [probe]);
    expect(r.daily.tdee![0]).toBe(2400);
    expect(r.daily.autophagyIdx![0]).toBeCloseTo(11.5, 6);
    expect(r.daily.scaleWeight![1]).toBe(6);
    // the t = 0 value of a wake-hour series is day 0's wake-hour value (morning anchor)
    expect(r.initial.scaleWeight).toBe(6);
    expect(r.daily.glycogenTotal![1]).toBe(23);
    expect(r.hourly.autophagyIdx![30]).toBe(6);
  });
});

// ---------------------------------------------------------------- D8-02: draw semantics, structural modes, correlation

describe('D8-02 draw semantics', () => {
  const selector = (draw: ParamDef['draw']): ParamDef => ({
    id: 'energy.tailQuantile',
    value: 0.5,
    unit: '1',
    low: 0,
    high: 1,
    grade: 'C',
    source: 'design mixture',
    dossier: '13 §4.10',
    draw,
    distribution: { uncertaintyKind: 'heuristic', bounds: 'support', nominal: 'designPoint', basis: 'design mixture fraction', version: 1, label: 'designPrior' },
  });
  /** Share of draws in the designed heavy-tail region u > 1 − 0.25 (the module's selector rule). */
  const tailShare = (draw: ParamDef['draw'], n: number, method: 'lhs' | 'independent' = 'lhs'): number => {
    const v = sampleParams([selector(draw)], { count: n, seed: 7, method });
    return v.filter((x) => x[0]! > 0.75).length / n;
  };

  it('a uniform latent selector gives the designed 25 % mixture; a triangular one only 12.5 % (counter-fixture)', () => {
    // fine LHS grid: exactly one draw per 1/n stratum → the designed mass, not a population incidence
    expect(tailShare('uniform', 4000)).toBeCloseTo(0.25, 3);
    // independent uniforms: binomial SD ≈ 0.003 at n = 20 000 (4 SD tolerance)
    expect(Math.abs(tailShare('uniform', 20000, 'independent') - 0.25)).toBeLessThan(0.012);
    // triangular(0, .5, 1): P(U > .75) = .125 — the bug the uniform draw fixes
    expect(tailShare('tri', 4000)).toBeCloseTo(0.125, 2);
    // the nominal run sits at the design point: the ordinary branch
    expect(buildModelParams([defineModule<object>({ id: 'energy', specSection: 't', dossiers: 't', params: [selector('uniform')], reads: [], writes: [], records: [], init: () => ({}) }) as unknown as AnyEngineModule]).values[0]).toBe(0.5);
  });

  it('declared support is the support of the draw, not its P10/P90 (known triangular fixture)', () => {
    const tri = P[0]!; // triangular(0.05, 0.14, 0.4)
    const v = sampleParams([tri], { count: 2000, seed: 11 }).map((x) => x[0]!).sort((a, b) => a - b);
    expect(v[0]!).toBeGreaterThanOrEqual(0.05);
    expect(v[v.length - 1]!).toBeLessThanOrEqual(0.4);
    // empirical P10/P90 lie strictly inside the support and match the analytic triangular quantiles
    const q = (p: number) => v[Math.floor(p * (v.length - 1))]!;
    const triInv = (u: number, a: number, c: number, b: number) => (u < (c - a) / (b - a) ? a + Math.sqrt(u * (b - a) * (c - a)) : b - Math.sqrt((1 - u) * (b - a) * (b - c)));
    expect(q(0.1)).toBeCloseTo(triInv(0.1, 0.05, 0.14, 0.4), 2);
    expect(q(0.9)).toBeCloseTo(triInv(0.9, 0.05, 0.14, 0.4), 2);
    expect(q(0.1)).toBeGreaterThan(0.05 + 0.02);
    expect(q(0.9)).toBeLessThan(0.4 - 0.05);
    // metadata that calls the support "quantiles" is rejected
    const mislabelled: ParamDef = { ...tri, distribution: { uncertaintyKind: 'parameterSensitivity', bounds: 'quantiles', nominal: 'mode', basis: 'between-study range', version: 1 } };
    expect(validateParamDefs([moduleOf([mislabelled])]).map((i) => i.problem).join(';')).toMatch(/quantiles/);
  });

  it('changing the draw kind, distribution metadata or correlation group changes the registry fingerprint', () => {
    const h = (defs: ParamDef[]) => buildModelParams([moduleOf(defs)]).registryHash;
    const base = h([selector('uniform')]);
    expect(h([selector('tri')])).not.toBe(base);
    const meta = selector('uniform').distribution!;
    expect(h([{ ...selector('uniform'), distribution: { ...meta, version: 2 } }])).not.toBe(base);
    expect(h([{ ...selector('uniform'), distribution: { ...meta, correlationGroup: 'g1' } }])).not.toBe(base);
    expect(h([selector('uniform')])).toBe(base);
  });

  it('no draw or band claims calibrated predictive coverage without an independent outcome evaluation', () => {
    const claim: ParamDef = { ...P[0]!, distribution: { uncertaintyKind: 'calibratedPrediction', bounds: 'support', nominal: 'mode', basis: 'fitted to the same trajectories', version: 1 } };
    expect(validateParamDefs([moduleOf([claim])]).map((i) => i.problem).join(';')).toMatch(/empirical/);
    for (const m of ['draws', 'fallback', 'none'] as const) for (const n of [0, 1, 32]) expect(bandMetaFor(m, n).coverage).not.toBe('heldOutValidated');
  });

  it('a uniform design-point selector is a latent quantile on [0, 1] with nominal 0.5', () => {
    const offGrid: ParamDef = { ...selector('uniform'), low: 0.1 };
    expect(validateParamDefs([moduleOf([offGrid])]).map((i) => i.problem).join(';')).toMatch(/latent quantile/);
    expect(validateParamDefs([moduleOf([selector('uniform')])])).toEqual([]);
  });

  it('a correlation group shares one latent quantile per member; ungrouped draws are unchanged', () => {
    const g = (id: string, low: number, value: number, high: number): ParamDef => ({
      id, value, unit: '1', low, high, grade: 'C', source: 's', dossier: 'd',
      distribution: { uncertaintyKind: 'parameterSensitivity', bounds: 'support', nominal: 'mode', basis: 'between-study range', version: 1, correlationGroup: 'pair' },
    });
    const a = g('energy.a', 0, 0.5, 1);
    const b = g('energy.b', 10, 20, 40);
    const draws = sampleParams([a, P[0]!, b], { count: 64, seed: 5 });
    for (const v of draws) expect(triCdf(v[2]!, 10, 20, 40)).toBeCloseTo(triCdf(v[0]!, 0, 0.5, 1), 9);
    // the ungrouped parameter draws exactly as it did without the group declaration
    const plain = sampleParams([{ ...a, distribution: undefined }, P[0]!], { count: 64, seed: 5 });
    expect(draws.map((v) => v[1])).toEqual(plain.map((v) => v[1]));
    // planner quantile rows keep their dimension; the second member follows the first
    const row = quantilesToParams([a, b], [0.3, 0.9]);
    expect(triCdf(row[1]!, 10, 20, 40)).toBeCloseTo(0.3, 9);
    expect(variableParamCount([a, b])).toBe(2);
  });
});

describe('D8-02 production registry: the keto-induction tail selector', () => {
  it('draws the latent quantile uniformly, so the designed 25 % heavy branch is selected by 25 % of LHS members (no manual q)', () => {
    const { defs, index } = buildModelParams(MODULES);
    const i = index.get('wellbeing.ketoHeavyTailQuantile')!;
    const frac = defs[index.get('wellbeing.ketoHeavyTailFraction')!]!.value;
    expect(drawKindOf(defs[i]!)).toBe('uniform');
    expect(defs[i]!.value).toBe(0.5); // nominal design point: the ordinary branch
    const v = sampleParams(defs, { count: 400, seed: 12 });
    expect(v.filter((x) => x[i]! > 1 - frac).length / 400).toBeCloseTo(frac, 9);
  });
});

function moduleOf(params: ParamDef[]): AnyEngineModule {
  return defineModule<object>({ id: 'energy', specSection: 't', dossiers: 't', params, reads: [], writes: [], records: [], init: () => ({}) }) as unknown as AnyEngineModule;
}
