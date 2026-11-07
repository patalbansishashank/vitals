// @vitest-environment node
/**
 * W0-core provider contracts (2026-10-18): registry hash and distribution validation (D4-03/C7), recorder status sidecar
 * and anchors (C6/D7-02), run metadata (contracts, causal resolution, named approximations; D2-01) and the initial-state
 * fingerprint certificates bind (D4-03). Same inputs, versions and seed in every comparison.
 */
import { CONTRACT_FINGERPRINT } from '@/lib/bodyContracts';
import { buildModelParams, distributionIssues, validateParamDefs } from '../paramsRegistry';
import { defineModule } from '../moduleKit';
import { Recorder } from '../recorder';
import { initialStateFingerprint, runEngine } from '../loop';
import { compileSchedule } from '../compileSchedule';
import { resolveProfile } from '../resolveProfile';
import { MODULES } from '../moduleRegistry';
import { ENGINE_VERSION } from '../defaults';
import { N_SERIES, SERIES_INDEX } from '../../types/metrics';
import type { AnyEngineModule } from '../../types/module';
import type { ParamDef, ParamDistributionMeta } from '../../types/params';
import type { DayTemplate } from '../../types/schedule';
import { MAN, PROGRAM_B, repeatSchedule } from './fixtures';

const base: ParamDef = { id: 'energy.k', value: 0.2, unit: '1', low: 0.1, high: 0.4, grade: 'C', source: 'test', dossier: 't' };
const meta = (m: Partial<ParamDistributionMeta> = {}): ParamDistributionMeta => ({
  uncertaintyKind: 'parameterSensitivity',
  bounds: 'support',
  nominal: 'mode',
  basis: 'engineering prior',
  version: 1,
  ...m,
});
const mod = (params: ParamDef[]): AnyEngineModule =>
  defineModule<object>({ id: 'energy', specSection: 't', dossiers: 't', params, reads: [], writes: [], records: [], init: () => ({}) }) as unknown as AnyEngineModule;

describe('D4-03/C7 parameter registry: distribution semantics', () => {
  it('the registry hash covers the contract fingerprint, the draw kind and the distribution metadata', () => {
    const a = buildModelParams([mod([base])]).registryHash;
    const b = buildModelParams([mod([{ ...base, distribution: meta() }])]).registryHash;
    const c = buildModelParams([mod([{ ...base, distribution: meta({ version: 2 }) }])]).registryHash;
    const d = buildModelParams([mod([{ ...base, draw: 'uniform' }])]).registryHash;
    expect(new Set([a, b, c, d]).size).toBe(4);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    expect(buildModelParams([mod([base])]).registryHash).toBe(a); // deterministic
    expect(ENGINE_VERSION).toBe('1.5.0-reaudit');
  });

  it('declared metadata must agree with the draw the sampler performs', () => {
    expect(distributionIssues({ ...base, distribution: meta() })).toEqual([]);
    expect(distributionIssues({ ...base, distribution: meta({ nominal: 'designPoint', uncertaintyKind: 'heuristic' }) })).toEqual([]);
    expect(distributionIssues({ ...base, distribution: meta({ bounds: 'quantiles' }) })[0]).toMatch(/quantiles/);
    expect(distributionIssues({ ...base, draw: 'uniform', distribution: meta() })[0]).toMatch(/no mode/);
    expect(distributionIssues({ ...base, distribution: meta({ nominal: 'median' }) })[0]).toMatch(/median/); // 0.1–0.2–0.4 is skewed
    expect(distributionIssues({ ...base, value: 0.25, distribution: meta({ nominal: 'median' }) })).toEqual([]);
    expect(distributionIssues({ ...base, low: 0.2, high: 0.2, distribution: meta() })[0]).toMatch(/fixed parameter/);
    expect(distributionIssues({ ...base, distribution: meta({ uncertaintyKind: 'calibratedPrediction' }) })[0]).toMatch(/empirical/);
    expect(validateParamDefs([mod([{ ...base, distribution: meta({ version: 0 }) }])]).map((i) => i.problem)).toEqual(['distribution.version must be a positive integer']);
  });

  it('every production parameter definition passes (no relabelled predictive intervals)', () => {
    expect(validateParamDefs(MODULES)).toEqual([]);
  });
});

describe('C6/D7-02 recorder status sidecar and measured anchors', () => {
  it('refuses non-finite anchors, keeps the anchored t = 0 value through later writes, and only worsens statuses', () => {
    const enabled = new Uint8Array(N_SERIES).fill(1);
    const r = new Recorder(2, 'daily', enabled);
    const i = SERIES_INDEX.ldl;
    expect(r.anchorInitial(i, Number.NaN)).toBe(false);
    expect(r.anchorInitial(i, 8.02)).toBe(true);
    r.captureInitial(); // a later t = 0 capture cannot replace the measurement
    expect(r.export(['ldl']).initial.ldl).toBe(8.02);
    r.setStatus(i, { status: 'outOfDomain', reasonCode: 'x' });
    r.setStatus(i, { status: 'estimated', reasonCode: 'y' });
    expect(r.statusOf(i)?.status).toBe('outOfDomain');
  });

  it('closes statuses over output dependencies even when the upstream output was not requested', () => {
    const r = new Recorder(2, 'daily', new Uint8Array(N_SERIES).fill(1));
    r.setStatus(SERIES_INDEX.leanTissue, { status: 'unavailable', reasonCode: 'leanPartitionUnsupported' });
    const st = r.exportStatus(['fatMass', 'bodyFatPct', 'sbp'])!;
    // A1-013: the induced status names its root and keeps the root's reason and uncertainty kind
    expect(st.fatMass).toEqual({ status: 'scenario', reasonCode: 'dependsOn:leanTissue', inducedBy: 'leanTissue', rootReason: 'leanPartitionUnsupported', uncertaintyKind: 'scenario' });
    expect(st.bodyFatPct?.status).toBe('scenario');
    expect(st.sbp?.status).toBe('scenario'); // through fatMass
    expect(st).not.toHaveProperty('leanTissue');
    expect(new Recorder(1, 'daily', new Uint8Array(N_SERIES)).exportStatus(['fatMass'])).toBeUndefined();
  });
});

describe('D2-01/C7 run metadata', () => {
  const p = resolveProfile(MAN);

  it('carries the contract fingerprint and the named legacy routing approximation', () => {
    const r = runEngine(p, compileSchedule(repeatSchedule(7, [0, 1]), p), { record: 'none' });
    expect(r.meta.contracts).toBe(CONTRACT_FINGERPRINT);
    expect(r.meta.assumptions).toContain('legacyRollingIntakeRouting');
    expect(r.meta.resolution).toBeUndefined(); // a purely prospective schedule claims no observed resolution
  });

  it('a replayed observed day makes the run daily-resolution (never a within-day causal claim)', () => {
    const obs: DayTemplate = { ...PROGRAM_B, observed: { coverage: { energy: 'complete' }, resolution: 'eventPrefix' } };
    const r = runEngine(p, compileSchedule(repeatSchedule(5, [1, 0, 0, 0, 0], [PROGRAM_B, obs]), p), { record: 'none' });
    expect(r.meta.resolution).toBe('daily');
    const sc: DayTemplate = { ...PROGRAM_B, observed: { coverage: { energy: 'partial' }, resolution: 'scenario' } };
    const r2 = runEngine(p, compileSchedule(repeatSchedule(5, [1, 2, 0, 0, 0], [PROGRAM_B, obs, sc]), p), { record: 'none' });
    expect(r2.meta.resolution).toBe('scenario');
  });
});

describe('D4-03 initial-state fingerprint (certificate binding)', () => {
  const p = resolveProfile(MAN);
  const cs = compileSchedule(repeatSchedule(14, [0, 1]), p);

  it('is deterministic and changes with profile, parameters, burn-in, history or restored snapshot', () => {
    const f = initialStateFingerprint(p, cs);
    expect(initialStateFingerprint(p, cs)).toBe(f);
    const q = resolveProfile({ ...MAN, body: { ...MAN.body, weightKg: 83 } });
    expect(initialStateFingerprint(q, cs)).not.toBe(f);
    const v = Float64Array.from(buildModelParams(MODULES).values);
    v[0] = v[0]! * 1.01;
    expect(initialStateFingerprint(p, cs, { paramOverrides: v })).not.toBe(f);
    expect(initialStateFingerprint(p, cs, { burnInDays: 7 })).not.toBe(f);
    expect(initialStateFingerprint(p, { ...cs, realised: { historyHash: 'abc', asOf: '2026-10-18T00:00:00Z', contractVersion: 1, throughDay: 3 } })).not.toBe(f);
  });
});
