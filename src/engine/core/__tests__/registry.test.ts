// @vitest-environment node
import { buildModelParams, sampleParams, validateParamDefs, withOverrides, param, quantilesToParams, variableParamCount } from '../paramsRegistry';
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
