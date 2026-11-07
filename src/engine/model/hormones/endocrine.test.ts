// @vitest-environment node
/**
 * D2-07 (contracts C4/C6): endocrine outputs are exploratory relative mechanisms, never laboratory predictions; absolute
 * free T only from measured TT/SHBG with documented albumin; the menstrual output is a qualitative concern status that
 * needs known history, keeps eligibility and yields to observed cycle changes; IGF-1 has no goal benefit; hormones never
 * drive energy expenditure.
 */
import { describe, expect, it } from 'vitest';
import type { PersonProfile } from '../../types/profile';
import { GOAL_CAPABILITY, isProductionGoalEligible } from '../../types/metrics';
import { MODULES } from '../../core/moduleRegistry';
import {
  ALBUMIN_G_PER_MOL,
  conditionalFreeTestosterone,
  endocrineLabPrediction,
  HORMONES_OUTPUT_CONTRACT,
  HORMONES_PARAMS,
  REPRO_CONCERN_CODE,
  reproductiveConcernStatus,
  reproductiveEligibility,
  type ReproductiveConcernInput,
} from './index';
import { Scenario } from './scenario';

const WOMAN: PersonProfile = {
  schemaVersion: 1,
  body: { sex: 'female', ageYears: 27, heightCm: 165, weightKg: 62 },
  cycle: { tracking: true, contraception: 'none' },
  menopause: 'pre',
};
const woman = (cycle: PersonProfile['cycle'] = WOMAN.cycle) =>
  Scenario.of({ ...WOMAN, ...(cycle ? { cycle } : {}) }, { weightKg: 62, fm0Kg: 17, ffm0Kg: 45, tdee0Kcal: 2100, habitualProteinG: 75, habitualFibreG: 18 });

describe('laboratory values vs model states', () => {
  it('no quantitative analyte prediction: a dated baseline assay alone does not authorise one (abstain, unknown ≠ healthy)', () => {
    for (const a of ['leptin', 't3', 'cortisol', 'testosterone', 'igf1'] as const) {
      expect(endocrineLabPrediction(a).status).toBe('unavailable');
      const withBaseline = endocrineLabPrediction(a, { value: 15, unit: 'nmol/L', measuredOn: '2026-10-01' });
      expect(withBaseline.status).toBe('unavailable');
      expect(withBaseline.value).toBeUndefined();
      expect(withBaseline.reasonCode).toBe('noValidatedResponseModel');
    }
    for (const o of Object.values(HORMONES_OUTPUT_CONTRACT.relativeOutputs)) {
      expect(o.labPrediction).toBe(false);
      expect(o.status).toBe('exploratory');
    }
  });
  it('T3/cortisol/leptin constants are direction priors, never counted as personal analyte validation', () => {
    for (const p of HORMONES_PARAMS) {
      expect(p.distribution, p.id).toBeDefined();
      expect(p.distribution!.uncertaintyKind, p.id).not.toBe('calibratedPrediction');
    }
    const t3 = HORMONES_PARAMS.find((p) => p.id === 'hormones.t3EnergyCoef')!;
    expect(t3.distribution!.basis).toMatch(/not an expected laboratory value/);
  });
});

describe('absolute free testosterone only from measured inputs (Vermeulen, conditional)', () => {
  it('abstains without measured total T, measured SHBG or a documented albumin', () => {
    expect(conditionalFreeTestosterone({}).reasonCode).toBe('totalTNotMeasured');
    expect(conditionalFreeTestosterone({ totalTNmolL: 17 }).reasonCode).toBe('shbgNotMeasured');
    expect(conditionalFreeTestosterone({ totalTNmolL: 17, shbgNmolL: 35 }).reasonCode).toBe('albuminUndocumented');
    expect(conditionalFreeTestosterone({ totalTNmolL: 17, shbgNmolL: 35 }).status).toBe('unavailable');
  });
  it('with measured inputs the value satisfies the binding mass balance and lands in the usual 1-3 % free fraction', () => {
    const tt = 17;
    const shbg = 35;
    const albGL = 43;
    const r = conditionalFreeTestosterone({ totalTNmolL: tt, shbgNmolL: shbg, albumin: { gL: albGL, source: 'measured' } });
    expect(r.status).toBe('estimated');
    expect(r.unit).toBe('pmol/L');
    const ft = r.value! * 1e-12; // mol/L
    const ttM = tt * 1e-9;
    const shbgM = shbg * 1e-9;
    const alb = albGL / ALBUMIN_G_PER_MOL;
    // TT = FT·(1 + K_alb·Alb) + SHBG-bound, SHBG-bound = K·FT·SHBG_free, SHBG_free = SHBG − bound
    const n = 1 + 3.6e4 * alb;
    const bound = ttM - ft * n;
    const residual = bound - (1e9 * ft * (shbgM - bound));
    expect(Math.abs(residual) / ttM).toBeLessThan(1e-9);
    expect(ft / ttM).toBeGreaterThan(0.01);
    expect(ft / ttM).toBeLessThan(0.03);
    const assumed = conditionalFreeTestosterone({ totalTNmolL: tt, shbgNmolL: shbg, albumin: { gL: albGL, source: 'documentedAssumption' } });
    expect(assumed.reasonCode).toBe('conditionalVermeulenAssumedAlbumin');
  });
  it('the internal free-T state stays internal: assumed TT0/SHBG0/albumin are labelled assumptions, no recorder reads it', () => {
    expect(HORMONES_OUTPUT_CONTRACT.freeTestosterone.state).toBe('internalAssumedInputs');
    for (const id of ['hormones.tt0NmolL', 'hormones.shbg0NmolL', 'hormones.albuminMolL']) {
      expect(HORMONES_PARAMS.find((p) => p.id === id)!.distribution!.label).toBe('engineeringDefault');
    }
  });
});

describe('energy/reproductive concern status (no per-cycle probability)', () => {
  const base: ReproductiveConcernInput = { eligibility: 'eligible', knownDays: 84, windowDays: 84, meanDeficitPct: 5, concernAtPct: 15 };
  it('missing history is unknown, never reassurance (not 84 zero-deficit days)', () => {
    expect(reproductiveConcernStatus({ ...base, knownDays: 10, meanDeficitPct: 0 })).toBe('insufficientHistory');
    expect(reproductiveConcernStatus(base)).toBe('noModelConcern');
    expect(reproductiveConcernStatus({ ...base, meanDeficitPct: 20 })).toBe('concern');
  });
  it('observed cycle changes override any model reassurance', () => {
    expect(reproductiveConcernStatus({ ...base, recentChange: 'missedPeriods' })).toBe('review');
    expect(reproductiveConcernStatus({ ...base, recentChange: 'newIrregularity', meanDeficitPct: 0 })).toBe('review');
  });
  it('contraception/menopause/men are not applicable; unconfirmed cycles never read as no concern', () => {
    expect(reproductiveEligibility({ sex: 'female', menopause: 'pre', hormonalContraception: true })).toBe('notApplicable');
    expect(reproductiveEligibility({ sex: 'female', menopause: 'post', hormonalContraception: false })).toBe('notApplicable');
    expect(reproductiveEligibility({ sex: 'male', menopause: 'pre', hormonalContraception: false })).toBe('notApplicable');
    expect(reproductiveEligibility({ sex: 'female', menopause: 'pre', hormonalContraception: false, menstruating: 'no' })).toBe('notApplicable');
    expect(reproductiveEligibility({ sex: 'female', menopause: 'pre', hormonalContraception: false })).toBe('unknown');
    expect(reproductiveEligibility({ sex: 'female', menopause: 'peri', hormonalContraception: false, menstruating: 'yes' })).toBe('unknown');
    expect(reproductiveEligibility({ sex: 'unspecified', menopause: 'pre', hormonalContraception: false })).toBe('unknown');
    expect(reproductiveEligibility({ sex: 'female', menopause: 'pre', hormonalContraception: false, cycleTracking: true })).toBe('eligible');
    expect(reproductiveConcernStatus({ ...base, eligibility: 'unknown' })).toBe('unknownEligibility');
    expect(reproductiveConcernStatus({ ...base, eligibility: 'unknown', meanDeficitPct: 25 })).toBe('concern');
    expect(reproductiveConcernStatus({ ...base, eligibility: 'notApplicable', recentChange: 'missedPeriods' })).toBe('notApplicable');
  });
  it('in the module: insufficient history early, concern after a full window of deficit, legacy value unchanged', () => {
    const f = woman();
    f.days(10, { eiFrac: 0.75, carbShareE: 0.5, logged: true });
    expect(f.dr.hs.concernCode).toBe(REPRO_CONCERN_CODE.insufficientHistory);
    const legacyEarly = f.dr.hs.reproRisk;
    expect(legacyEarly).toBeGreaterThan(0); // deprecated research value still computed for compatibility
    f.days(80, { eiFrac: 0.75, carbShareE: 0.5, logged: true });
    expect(f.dr.hs.concernCode).toBe(REPRO_CONCERN_CODE.concern);
    const g = woman();
    g.days(90, { eiFrac: 1, carbShareE: 0.5, logged: true });
    expect(g.dr.hs.concernCode).toBe(REPRO_CONCERN_CODE.noModelConcern);
    // A1-056: prescribed (unlogged) days are never known history, however long the deficit lasts
    const rx = woman();
    rx.days(90, { eiFrac: 0.75, carbShareE: 0.5 });
    expect(rx.dr.hs.concernCode).toBe(REPRO_CONCERN_CODE.insufficientHistory);
    const oc = woman({ tracking: true, contraception: 'combinedOral' });
    oc.days(90, { eiFrac: 0.7 });
    expect(oc.dr.hs.concernCode).toBe(REPRO_CONCERN_CODE.notApplicable);
    const missed = woman({ tracking: true, contraception: 'none', recentChange: 'missedPeriods' });
    missed.days(90, { eiFrac: 1, carbShareE: 0.5 });
    expect(missed.dr.hs.concernCode).toBe(REPRO_CONCERN_CODE.review);
  });
});

describe('IGF-1 and energy coupling', () => {
  it('IGF-1 earns no goal benefit and the protein response range includes the null response', () => {
    expect(GOAL_CAPABILITY.igf1.availability).toBe('unavailable');
    expect(isProductionGoalEligible('igf1')).toBe(false);
    const slope = HORMONES_PARAMS.find((p) => p.id === 'hormones.igfProtSlope')!;
    expect(slope.low).toBe(0);
    expect(slope.distribution!.uncertaintyKind).toBe('scenario');
    expect(HORMONES_PARAMS.find((p) => p.id === 'hormones.igfProtRatioMax')!.value).toBe(1); // cap kept, no symmetric slope
  });
  it('no doubled adaptive thermogenesis: nothing the hormones module writes is read by energy, and safety never reads a hormone state', () => {
    const hormones = MODULES.find((m) => m.id === 'hormones')!;
    const energy = MODULES.find((m) => m.id === 'energy')!;
    const safety = MODULES.find((m) => m.id === 'safety')!;
    for (const w of hormones.writes) {
      expect(energy.reads, w).not.toContain(w);
      expect(safety.reads, w).not.toContain(w);
    }
    expect(HORMONES_OUTPUT_CONTRACT.drivesEnergyExpenditure).toBe(false);
  });
});
