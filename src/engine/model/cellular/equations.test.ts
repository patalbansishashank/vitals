// @vitest-environment node
/**
 * Unit tests of each cellular equation against worked numbers from dossier 08 (§4.3-4.11) — the module is driven
 * directly with hand-built bus values (no other module needed).
 */
import { cellularModule, calibrateB0, asiLabel, ASI_BANDS } from './index';
import { makeRig, stepOnce, type Rig, type RigOptions } from './testkit';

/** Post-absorptive fasting state on the bus with the module's own references (F_glyc = 0, insulin at basal, BHB 0.1). */
function fasting(rig: Rig, hFast: number): void {
  rig.bus.hoursSinceMealH = hFast;
  rig.bus.liverGlycogenG = rig.s.liverRef12G;
  rig.bus.bhbEndoMmolL = 0.1;
  rig.bus.insulinBasalUuMl = rig.s.insBasalUuMl;
  rig.bus.insulinUuMl = rig.s.insBasalUuMl;
  rig.bus.raAaQGH = 0;
  rig.bus.muscleGlycogenRel = 1;
  rig.bus.ffmActKg = 60;
  rig.bus.mpsStimWb = 0;
  rig.bus.exMinutesH = 0;
  rig.bus.exIntensityFrac = 0;
  rig.hour.exMin = 0;
  rig.hour.exModality = 0;
  rig.hour.rtSetsTotal = 0;
}

/** Fresh rig at fasting state; basal insulin 7 (intake's `insulinBasalUuMl`), references pinned to (liver 60 g, BHB 0.1), B0 calibrated. */
function rigAt(hFast: number, opts: RigOptions = {}): Rig {
  const rig = makeRig(opts);
  rig.s.insBasalUuMl = 7;
  rig.s.liverRef12G = 60;
  rig.s.invLiverRef12 = 1 / 60;
  rig.s.bhbRef12MmolL = 0.1;
  rig.s.b0 = calibrateB0(rig.k, 0.1);
  rig.s.calibrated = 1;
  fasting(rig, hFast);
  return rig;
}

function exercise(rig: Rig, minutes: number, intensity: number, modality = 2): void {
  rig.bus.exMinutesH = minutes;
  rig.bus.exIntensityFrac = intensity;
  rig.hour.exMin = minutes;
  rig.hour.exModality = modality;
}

const HILL = (x: number, k: number, n = 1.5): number => x ** n / (k ** n + x ** n);
const step = (rig: Rig, t = 0): void => stepOnce(rig, t);

describe('suppression S (08 §4.3-4.4)', () => {
  it('S_aa is a Hill in the leucine fold: 0.5 at EC50_L, dL^1.5/(dL^1.5 + 0.5^1.5) elsewhere', () => {
    // dL = raAaQGH/(0.10 g/kg FFM/h × 60 kg FFM) = raAaQGH/6
    const a = rigAt(1);
    a.bus.raAaQGH = 3; // dL 0.5
    step(a);
    expect(a.s.leucineFold).toBeCloseTo(0.5, 12);
    expect(a.s.sAa).toBeCloseTo(0.5, 12);
    const b = rigAt(1);
    b.bus.raAaQGH = 6; // dL 1
    step(b);
    expect(b.s.sAa).toBeCloseTo(HILL(1, 0.5), 12);
    expect(b.s.sAa).toBeCloseTo(0.738796, 5);
    const c = rigAt(1);
    c.bus.raAaQGH = 0;
    step(c);
    expect(c.s.sAa).toBe(0);
  });

  it('the leucine fold scales with fat-free mass (x = raAaQGH/FFM, as muscle §4.7B)', () => {
    const a = rigAt(1);
    a.bus.raAaQGH = 6;
    a.bus.ffmActKg = 60;
    step(a);
    const b = rigAt(1);
    b.bus.raAaQGH = 6;
    b.bus.ffmActKg = 30;
    step(b);
    expect(b.s.leucineFold).toBeCloseTo(2 * a.s.leucineFold, 12);
  });

  it('S_ins is a Hill in the insulin rise above intake\'s basal insulin (insulinBasalUuMl): 0.5 at EC50_I = 5 µU/mL', () => {
    const a = rigAt(1);
    a.bus.insulinUuMl = 12; // basal 7 → dI 5
    step(a);
    expect(a.s.sIns).toBeCloseTo(0.5, 12);
    const b = rigAt(1);
    b.bus.insulinUuMl = 17; // dI 10
    step(b);
    expect(b.s.sIns).toBeCloseTo(HILL(10, 5), 12);
    // a person with higher basal (insulin resistant) is not suppressed by their own fasting level
    const c = rigAt(1);
    c.bus.insulinBasalUuMl = 15;
    c.bus.insulinUuMl = 15;
    step(c);
    expect(c.s.sIns).toBe(0);
    expect(c.s.insBasalUuMl).toBe(15);
    // dI follows the basal of THIS hour (it falls with liver glycogen in a fast, 05 §4.17): 12 above a basal of 4 → HILL(8)
    const e = rigAt(1);
    e.bus.insulinBasalUuMl = 4;
    e.bus.insulinUuMl = 12;
    step(e);
    expect(e.s.sIns).toBeCloseTo(HILL(8, 5), 12);
    // a non-finite basal keeps the last finite one (never NaN)
    e.bus.insulinBasalUuMl = Number.NaN;
    e.bus.insulinUuMl = 9;
    step(e, 1);
    expect(e.s.sIns).toBeCloseTo(HILL(5, 5), 12);
    // sub-basal insulin (deep fast) never adds suppression
    const d = rigAt(1);
    d.bus.insulinUuMl = 2;
    step(d);
    expect(d.s.sIns).toBe(0);
  });

  it('combines S = 1 − (1 − 0.6·S_aa)(1 − 0.75·S_ins) (max 0.86 with these weights)', () => {
    const rig = rigAt(1);
    rig.bus.raAaQGH = 6;
    rig.bus.insulinUuMl = 17;
    step(rig);
    const sa = HILL(1, 0.5);
    const si = HILL(10, 5);
    expect(rig.s.sNut).toBeCloseTo(1 - (1 - 0.6 * sa) * (1 - 0.75 * si), 12);
    expect(rig.s.sNut).toBeCloseTo(0.75176, 4);
    const sat = rigAt(1);
    sat.bus.raAaQGH = 1e6;
    sat.bus.insulinUuMl = 1e6;
    step(sat);
    expect(sat.s.sNut).toBeCloseTo(1 - 0.4 * 0.25, 6);
  });
});

describe('fasting depth F (08 §4.5)', () => {
  it('F_clock = h^nh/(h^nh + h50^nh): 0.5 at h50, 48²/(48² + h50²) at 48 h (nh 2; h50 60 h since 2026-09-30)', () => {
    const h50 = Math.sqrt(makeRig().k.h50Pow);
    expect(h50).toBeCloseTo(60, 12);
    const a = rigAt(h50);
    step(a);
    expect(a.s.fClock).toBeCloseTo(0.5, 12);
    const b = rigAt(48);
    step(b);
    expect(b.s.fClock).toBeCloseTo(2304 / (2304 + h50 * h50), 12);
    const c = rigAt(0);
    step(c);
    expect(c.s.fClock).toBe(0);
  });

  it('F_glyc = clamp01(1 − G_L/G_L,12h): 0 while liver glycogen ≥ its 12 h value', () => {
    const rig = rigAt(20);
    rig.bus.liverGlycogenG = 30;
    step(rig);
    expect(rig.s.fGlyc).toBeCloseTo(0.5, 12);
    rig.bus.liverGlycogenG = 80;
    step(rig, 1);
    expect(rig.s.fGlyc).toBe(0);
    rig.bus.liverGlycogenG = 0;
    step(rig, 2);
    expect(rig.s.fGlyc).toBe(1);
  });

  it('F_ket = b²/(b² + 1.5²) of ENDOGENOUS BHB: 0.5 at 1.5 mM, 0.8 at 3 mM', () => {
    const a = rigAt(20);
    a.bus.bhbEndoMmolL = 1.5;
    step(a);
    expect(a.s.fKet).toBeCloseTo(0.5, 12);
    const b = rigAt(20);
    b.bus.bhbEndoMmolL = 3;
    step(b);
    expect(b.s.fKet).toBeCloseTo(0.8, 12);
  });

  it('F = 0.6·F_clock + 0.2·F_glyc + 0.2·F_ket (weights renormalised to sum 1)', () => {
    const rig = rigAt(48);
    rig.bus.liverGlycogenG = 30;
    rig.bus.bhbEndoMmolL = 1.5;
    step(rig);
    expect(rig.s.fDepth).toBeCloseTo(0.6 * (2304 / (2304 + rig.k.h50Pow)) + 0.2 * 0.5 + 0.2 * 0.5, 12);
    const w = makeRig({ params: { 'cellular.wClock': 0.9, 'cellular.wGlyc': 0.3, 'cellular.wKet': 0.3 } }).k;
    expect(w.wClock + w.wGlyc + w.wKet).toBeCloseTo(1, 12);
    expect(w.wClock).toBeCloseTo(0.9 / 1.5, 12);
  });
});

describe('ASI combination and B0 calibration (08 §4.10)', () => {
  it('reproduces the dossier clock-only fallback: B0 = 0.203 and the clock-only anchor values with h50 48 h', () => {
    const rig = rigAt(12, { params: { 'cellular.wClock': 1, 'cellular.wGlyc': 0, 'cellular.wKet': 0, 'cellular.h50': 48 } });
    rig.s.b0 = calibrateB0(rig.k, 0.1);
    expect(rig.s.b0).toBeCloseTo(0.2031, 3);
    const expected: Record<number, number> = { 12: 25, 24: 36.2, 36: 49.0, 48: 60.2, 72: 75.5, 96: 84.2, 120: 89.4, 168: 94.2 };
    for (const [h, v] of Object.entries(expected)) {
      const r = rigAt(+h, { params: { 'cellular.wClock': 1, 'cellular.wGlyc': 0, 'cellular.wKet': 0, 'cellular.h50': 48 } });
      r.s.b0 = calibrateB0(r.k, 0.1);
      step(r);
      expect(r.s.asi, `hFast ${h}`).toBeCloseTo(v, 0);
    }
  });

  it('ASI = 100(1 − S)(B0 + (1 − B0)F) with no exercise and no chronic term', () => {
    const rig = rigAt(30);
    rig.bus.raAaQGH = 3;
    rig.bus.insulinUuMl = 12;
    rig.bus.liverGlycogenG = 30;
    rig.bus.bhbEndoMmolL = 0.75;
    step(rig);
    const S = 1 - (1 - 0.6 * 0.5) * (1 - 0.75 * 0.5);
    const F = 0.6 * (900 / (900 + rig.k.h50Pow)) + 0.2 * 0.5 + 0.2 * (0.5625 / (0.5625 + 2.25));
    expect(rig.s.asi).toBeCloseTo(100 * (1 - S) * (rig.s.b0 + (1 - rig.s.b0) * F), 9);
  });

  it('ASI at hFast = 12 h on the reference state is exactly 25 (definition), for any h50, nh, K_bhb, weights', () => {
    const cases: Record<string, number>[] = [{}, { 'cellular.h50': 24 }, { 'cellular.h50': 96 }, { 'cellular.nh': 3 }, { 'cellular.kBhb': 1 }, { 'cellular.wClock': 0.3 }];
    for (const params of cases) {
      const rig = rigAt(12, { params });
      step(rig);
      expect(rig.s.asi).toBeCloseTo(25, 9);
    }
  });

  it('calibrates B0 against a keto-habitual 12 h BHB so that the person\'s own 12 h post-absorptive value is 25', () => {
    const rig = rigAt(12);
    rig.s.bhbRef12MmolL = 0.8;
    rig.s.b0 = calibrateB0(rig.k, 0.8);
    rig.bus.bhbEndoMmolL = 0.8;
    step(rig);
    expect(rig.s.asi).toBeCloseTo(25, 9);
    expect(rig.s.b0).toBeLessThan(calibrateB0(rig.k, 0.1));
  });

  it('clamps to 0-100', () => {
    const rig = rigAt(1000);
    rig.bus.bhbEndoMmolL = 8;
    rig.bus.liverGlycogenG = 0;
    rig.s.asiCr = 8;
    rig.s.xOld = 5;
    step(rig);
    expect(rig.s.asi).toBe(100);
    const fed = rigAt(0);
    fed.bus.raAaQGH = 1e6;
    fed.bus.insulinUuMl = 1e6;
    step(fed);
    expect(fed.s.asi).toBeGreaterThanOrEqual(0);
    expect(fed.s.asi).toBeLessThan(15);
  });
});

describe('exercise pulse (08 §4.8)', () => {
  const bump = (rig0: Rig, rig1: Rig): number => rig1.s.asi - rig0.s.asi;

  it('a hard 60-min bout (≥ 80 % VO2max, untrained) adds A_ex = 15 points at bout end, half-life ≈ 2 h', () => {
    const base = rigAt(14);
    step(base);
    const ex = rigAt(14);
    exercise(ex, 60, 0.85);
    step(ex);
    expect(ex.s.xEx).toBeCloseTo(1, 12);
    expect(bump(base, ex)).toBeCloseTo(15, 9);
    // after the bout: exp(−t/3 h)
    fasting(ex, 15);
    step(ex, 1);
    expect(ex.s.xEx).toBeCloseTo(Math.exp(-1 / 3), 12);
    fasting(ex, 16);
    step(ex, 2);
    expect(ex.s.xEx).toBeCloseTo(Math.exp(-2 / 3), 12);
    expect(Math.log(2) * 3).toBeCloseTo(2.08, 2); // half-life of the pulse
  });

  it('intensity ramp fI = clamp01((I − 0.40)/(0.80 − 0.40)): 50 % → 0.25, 65 % → 0.625, ≥ 80 % → 1, ≤ 40 % → 0', () => {
    for (const [I, fI] of [[0.4, 0], [0.5, 0.25], [0.65, 0.625], [0.8, 1], [0.95, 1], [0.3, 0]] as const) {
      const rig = rigAt(14);
      exercise(rig, 60, I);
      step(rig);
      expect(rig.s.xEx, `I ${I}`).toBeCloseTo(fI, 12);
    }
  });

  it('duration factor fD = min(1.5, sqrt(min/60)): 120 min → 1.414, ≥ 135 min → 1.5 (consecutive hours are one bout, amplitude held)', () => {
    const rig = rigAt(14);
    exercise(rig, 60, 0.8);
    step(rig, 0);
    expect(rig.s.xEx).toBeCloseTo(1, 12);
    fasting(rig, 15);
    exercise(rig, 60, 0.8);
    step(rig, 1);
    expect(rig.s.xEx).toBeCloseTo(Math.SQRT2, 12); // held, not decayed
    fasting(rig, 16);
    exercise(rig, 60, 0.8);
    step(rig, 2); // 180 min: sqrt(3) = 1.73 → fD capped at 1.5
    expect(rig.s.xEx).toBeCloseTo(1.5, 12);
    fasting(rig, 17);
    exercise(rig, 60, 0.8);
    step(rig, 3);
    expect(rig.s.xEx).toBeCloseTo(1.5, 12);
    // the index uses min(1.5, xEx) × A_ex
    const base = rigAt(17);
    step(base);
    expect(rig.s.asi - base.s.asi).toBeCloseTo(22.5, 9);
  });

  it('a partial-hour bout is centred in the hour: 30 min at 80 % ≈ 15·√0.5·exp(−30/360) at hour end', () => {
    const rig = rigAt(14);
    exercise(rig, 30, 0.8);
    step(rig);
    expect(rig.s.xEx).toBeCloseTo(Math.sqrt(0.5) * Math.exp(-30 / 360), 12);
  });

  it('training status damps the pulse: recreational 0.75, endurance-trained 0.5', () => {
    const rec = rigAt(14, { profile: { schemaVersion: 1, body: { sex: 'male', ageYears: 35, heightCm: 178, weightKg: 82 }, habits: { trainingHistory: 'lt1y', sessionsPerWeek: 2 } } });
    exercise(rec, 60, 0.85);
    step(rec);
    expect(rec.s.xEx).toBeCloseTo(0.75, 12);
    const end = rigAt(14, { profile: { schemaVersion: 1, body: { sex: 'male', ageYears: 35, heightCm: 178, weightKg: 82 }, habits: { trainingHistory: 'gt3y', sessionsPerWeek: 5, lifingCardioMix: 0.7 } } });
    exercise(end, 60, 0.85);
    step(end);
    expect(end.s.xEx).toBeCloseTo(0.5, 12);
  });

  it('resistance exercise: 0.5·min(1, sets/15) (× 0.7 trained); never an endurance pulse', () => {
    const rig = rigAt(14);
    rig.hour.rtSetsTotal = 15;
    exercise(rig, 60, 0.9, 0); // RT hour: modality 0
    step(rig);
    expect(rig.s.xEx).toBeCloseTo(0.5, 12);
    const half = rigAt(14);
    half.hour.rtSetsTotal = 7.5;
    step(half);
    expect(half.s.xEx).toBeCloseTo(0.25, 12);
    const trained = rigAt(14, { profile: { schemaVersion: 1, body: { sex: 'male', ageYears: 35, heightCm: 178, weightKg: 82 }, habits: { trainingHistory: 'gt3y' } } });
    trained.hour.rtSetsTotal = 20;
    step(trained);
    expect(trained.s.xEx).toBeCloseTo(0.35, 12);
  });

  it('no fed/fasted synergy: the same pulse adds the same points in the fasted and the fed state (08 §4.8, ×1.0)', () => {
    const fedBase = rigAt(1);
    fedBase.bus.raAaQGH = 6;
    fedBase.bus.insulinUuMl = 17;
    step(fedBase);
    const fedEx = rigAt(1);
    fedEx.bus.raAaQGH = 6;
    fedEx.bus.insulinUuMl = 17;
    exercise(fedEx, 60, 0.85);
    step(fedEx);
    expect(fedEx.s.asi - fedBase.s.asi).toBeCloseTo(15, 9);
  });

  it('the muscle view uses A_ex_m = 25 with the same pulse', () => {
    const base = rigAt(14);
    step(base);
    const ex = rigAt(14);
    exercise(ex, 60, 0.85);
    step(ex);
    expect(ex.s.asiMuscle - base.s.asiMuscle).toBeCloseTo(25, 9);
  });

  it('caps the pulse sum at min(1.5, xEx)', () => {
    const rig = rigAt(14);
    rig.s.xOld = 3;
    step(rig);
    const base = rigAt(14);
    step(base);
    expect(rig.s.asi - base.s.asi).toBeCloseTo(22.5, 9);
  });
});

describe('chronic restriction (08 §4.9)', () => {
  const endDay = (rig: Rig, u: number, day: number): void => {
    rig.bus.energyBalanceFrac = u;
    stepOnce(rig, day * 24 + 23);
  };

  it('cDef relaxes toward the deficit fraction with τ = 7 d: 0.3·(1 − e^{−1}) after 7 days at −30 %; asi_CR = 3·cDef/0.25', () => {
    const rig = rigAt(14);
    for (let d = 0; d < 7; d++) endDay(rig, -0.3, d);
    expect(rig.s.cDef).toBeCloseTo(0.3 * (1 - Math.exp(-1)), 9);
    expect(rig.s.asiCr).toBeCloseTo((3 * rig.s.cDef) / 0.25, 9);
    expect(rig.s.asiCr).toBeCloseTo(2.2757, 3);
  });

  it('a fast day (u = −1) moves cDef by 1 − e^{−1/7}; a long fast saturates asi_CR at A_CR = 3; surplus decays it', () => {
    const rig = rigAt(14);
    endDay(rig, -1, 0);
    expect(rig.s.cDef).toBeCloseTo(1 - Math.exp(-1 / 7), 12);
    expect(rig.s.asiCr).toBeCloseTo(1.5974, 3);
    for (let d = 1; d < 40; d++) endDay(rig, -1, d);
    expect(rig.s.asiCr).toBeCloseTo(3, 6);
    for (let d = 40; d < 100; d++) endDay(rig, 0.2, d);
    expect(rig.s.cDef).toBeLessThan(1e-3);
    expect(rig.s.asiCr).toBeLessThan(0.02);
  });

  it('uses the dossier form 1 − intake/maintenance when the day\'s energy and maintenanceKcalD are known (not the exercise-inflated balance)', () => {
    const rig = rigAt(14);
    rig.bus.maintenanceKcalD = 2000;
    (rig.day as { energyKcal: number }).energyKcal = 1400; // 70 % of maintenance
    rig.bus.energyBalanceFrac = -0.45; // e.g. a big exercise day: must NOT be used
    for (let d = 0; d < 7; d++) stepOnce(rig, d * 24 + 23);
    expect(rig.s.cDef).toBeCloseTo(0.3 * (1 - Math.exp(-1)), 9);
    (rig.day as { energyKcal: number }).energyKcal = 0; // fast day
    stepOnce(rig, 7 * 24 + 23);
    expect(rig.s.cDef).toBeCloseTo(1 + (0.3 * (1 - Math.exp(-1)) - 1) * Math.exp(-1 / 7), 9);
    (rig.day as { energyKcal: number }).energyKcal = 2600; // surplus: target 0
    const before = rig.s.cDef;
    stepOnce(rig, 8 * 24 + 23);
    expect(rig.s.cDef).toBeCloseTo(before * Math.exp(-1 / 7), 9);
  });

  it('the chronic term is added to the ASI (small by design: a CR-only arm stays within ~4 points)', () => {
    const rig = rigAt(14);
    step(rig);
    const a0 = rig.s.asi;
    rig.s.asiCr = 3;
    step(rig, 1);
    expect(rig.s.asi - a0).toBeCloseTo(3, 9);
  });
});

describe('ASI does not respond to any compound (ruling R-ASI): exogenous ketones cannot raise it', () => {
  it('ignores the meter BHB / total ketones that include exogenous ketones; only bhbEndoMmolL enters', () => {
    const base = rigAt(14);
    step(base);
    const exo = rigAt(14);
    exo.bus.bhbMmolL = 6; // ketone ester on top of endogenous 0.1
    exo.bus.tkbMmolL = 7;
    step(exo);
    expect(exo.s.asi).toBe(base.s.asi);
    expect(exo.s.asiMuscle).toBe(base.s.asiMuscle);
    expect(exo.s.mtor).toBe(base.s.mtor);
    const endo = rigAt(14);
    endo.bus.bhbEndoMmolL = 3;
    step(endo);
    expect(endo.s.asi).toBeGreaterThan(base.s.asi + 5);
  });

  it('also ignores non-nutrient intake signals: fat absorption, MCT, caffeine, alcohol', () => {
    const base = rigAt(14);
    step(base);
    const x = rigAt(14);
    x.bus.raFatGH = 20;
    x.bus.raMctGH = 15;
    x.bus.exoKetoneMmolH = 30;
    x.bus.caffeineLoadMg = 400;
    x.bus.alcOxGH = 8;
    step(x);
    expect(x.s.asi).toBe(base.s.asi);
  });
});

describe('mTORC1 index (08 §4.11)', () => {
  const p48 = { 'cellular.h50': 48 };

  it('12 h post-absorptive baseline = 100·0.2·(1 − 0.65·F_clock) ≈ 19-20', () => {
    const rig = rigAt(12, { params: p48 });
    step(rig);
    expect(rig.s.mtor).toBeCloseTo(100 * 0.2 * (1 - 0.65 * (144 / 2448)), 9);
    expect(rig.s.mtor).toBeCloseTo(19.235, 2);
  });

  it('acute term mAcute = S_aa(0.77 + 0.23·S_ins): S_aa 0.5 alone → 50.3; saturated S_aa and S_ins → 100·(mBase + …)', () => {
    const rig = rigAt(12, { params: p48 });
    rig.bus.raAaQGH = 3;
    step(rig);
    const mBase = 0.2 * (1 - 0.65 * (144 / 2448));
    expect(rig.s.mtor).toBeCloseTo(100 * (mBase + (1 - mBase) * 0.5 * 0.77), 9);
    const both = rigAt(12, { params: p48 });
    both.bus.raAaQGH = 1e6;
    both.bus.insulinUuMl = 1e6;
    step(both);
    expect(both.s.mtor).toBeCloseTo(100, 3);
  });

  it('resistance-exercise sensitisation (1 + 0.3·mpsStimWb) raises the acute response and clamps at 100', () => {
    const a = rigAt(12, { params: p48 });
    a.bus.raAaQGH = 3;
    step(a);
    const b = rigAt(12, { params: p48 });
    b.bus.raAaQGH = 3;
    b.bus.mpsStimWb = 1;
    step(b);
    expect(b.s.mtor).toBeGreaterThan(a.s.mtor);
    const mBase = 0.2 * (1 - 0.65 * (144 / 2448));
    expect(b.s.mtor).toBeCloseTo(100 * (mBase + (1 - mBase) * 0.385 * 1.3), 9);
    // with no acute drive the stimulation term is inert (fasting baseline only)
    const c = rigAt(12, { params: p48 });
    c.bus.mpsStimWb = 1.6;
    step(c);
    expect(c.s.mtor).toBeCloseTo(100 * mBase, 9);
  });

  it('72 h baseline falls to ≈ 0.57 × its 12 h value (mTOR Ser2448 −40-50 % [Vendelbo 2014])', () => {
    const a = rigAt(12, { params: p48 });
    step(a);
    const b = rigAt(72, { params: p48 });
    step(b);
    expect(b.s.mtor / a.s.mtor).toBeCloseTo((1 - 0.65 * (5184 / 7488)) / (1 - 0.65 * (144 / 2448)), 9);
    expect(b.s.mtor / a.s.mtor).toBeGreaterThan(0.5);
    expect(b.s.mtor / a.s.mtor).toBeLessThan(0.65);
  });
});

describe('AMPK index (08 §4.6)', () => {
  it('rest = 20 (20 × (1 − f_fast·F_clock) at 12 h ≈ 19.7)', () => {
    const rig = rigAt(12);
    step(rig);
    expect(rig.s.ampk).toBeCloseTo(100 * 0.2 * (1 - rig.k.fFast * rig.s.fClock), 9);
    expect(rig.s.ampk).toBeGreaterThan(19.5);
  });

  it('V2 (Wojtaszewski 2000): 60 min at 75 % VO2max → ≥ 3× rest at bout end, ≤ 1.3× at 50 %, ≤ 1.2× rest 3 h later', () => {
    const rest = rigAt(12);
    step(rest);
    const hi = rigAt(12);
    exercise(hi, 60, 0.75);
    step(hi);
    expect(hi.s.ampk / rest.s.ampk).toBeGreaterThanOrEqual(3.0);
    expect(hi.s.ampk).toBeCloseTo(100 * (0.2 * (1 - hi.k.fFast * hi.s.fClock) + 0.5), 9); // 3.5× rest
    const lo = rigAt(12);
    exercise(lo, 90, 0.5);
    step(lo);
    expect(lo.s.ampk / rest.s.ampk).toBeLessThanOrEqual(1.3);
    // reversed by 3 h
    for (let h = 1; h <= 3; h++) {
      fasting(hi, 12 + h);
      step(hi, h);
    }
    const rest3 = rigAt(15);
    step(rest3);
    expect(hi.s.ampk / rest3.s.ampk).toBeLessThanOrEqual(1.2);
    expect(hi.s.ampkPulse).toBeCloseTo(Math.exp(-3), 12);
  });

  it('threshold ramp fI_ampk = clamp((I − 0.55)/(0.75 − 0.55), 0, 1.3)', () => {
    for (const [I, f] of [[0.55, 0], [0.65, 0.5], [0.75, 1], [0.9, 1.3], [1.0, 1.3]] as const) {
      const rig = rigAt(12);
      exercise(rig, 60, I);
      step(rig);
      expect(rig.s.ampkPulse, `I ${I}`).toBeCloseTo(f, 12);
    }
  });

  it('glycogen-depleted muscle raises resting AMPK (+45-60 %): rel 0.35 ≈ 160/462 → 1.48× rest', () => {
    const rest = rigAt(12);
    step(rest);
    const dep = rigAt(12);
    dep.bus.muscleGlycogenRel = 160 / 462;
    step(dep);
    const dGly = ((1 - 160 / 462) * 462) / (462 - 150);
    expect(dep.s.ampk).toBeCloseTo(100 * 0.2 * (1 + 0.5 * dGly) * (1 - dep.k.fFast * dep.s.fClock), 9);
    expect(dep.s.ampk / rest.s.ampk).toBeGreaterThan(1.4);
    expect(dep.s.ampk / rest.s.ampk).toBeLessThan(1.6);
    const sup = rigAt(12);
    sup.bus.muscleGlycogenRel = 1.3; // supercompensated: no effect (no negative dGly)
    step(sup);
    expect(sup.s.ampk).toBe(rest.s.ampk);
  });

  it('fasting is not an AMPK activator: the index falls with F_clock (f_fast 0.2)', () => {
    const a = rigAt(12);
    step(a);
    const b = rigAt(96);
    step(b);
    expect(b.s.ampk).toBeLessThan(a.s.ampk);
    expect(b.s.ampk).toBeGreaterThan(15);
  });

  it('a resistance session counts as fI_ampk = 0.6·min(1, sets/15)', () => {
    const rig = rigAt(12);
    rig.hour.rtSetsTotal = 15;
    step(rig);
    expect(rig.s.ampkPulse).toBeCloseTo(0.6, 12);
    expect(rig.s.ampk).toBeGreaterThan(45);
  });
});

describe('labels and registry', () => {
  it('maps the ASI to the UI labels of 08 §4.10', () => {
    expect(asiLabel(5)).toBe('fed — suppressed');
    expect(asiLabel(25)).toBe('post-absorptive (baseline)');
    expect(asiLabel(40)).toBe('extended/short fast');
    expect(asiLabel(60)).toBe('prolonged fast');
    expect(asiLabel(90)).toBe('multi-day fast');
    expect(ASI_BANDS).toHaveLength(5);
  });

  it('wiring (core/moduleRegistry checkWiring semantics): writes only asiIdx, which it owns; every declared read lists cellular as a reader', async () => {
    // the semantics are checked against SIGNAL_DEFS directly (importing the registry would pull every module into this test)
    const { SIGNAL_DEFS } = await import('../../types/signals');
    const m = cellularModule;
    expect(m.writes).toEqual(['asiIdx']);
    for (const w of m.writes) expect(SIGNAL_DEFS.find((x) => x.name === w)?.writer, w).toBe('cellular');
    for (const r of m.reads) {
      const d = SIGNAL_DEFS.find((x) => x.name === r);
      expect(d, r).toBeDefined();
      expect(d!.readers as readonly string[], r).toContain('cellular');
    }
    // reads the basal insulin of intake (08 §4.4 dI); the fed-state flags are not needed (hFast carries the clock)
    expect(m.reads).toContain('insulinBasalUuMl');
    expect(m.reads).not.toContain('absFluxKcalH');
    expect(m.reads).not.toContain('fedState');
    expect(m.records).toEqual(['autophagyIdx', 'mtorIdx', 'ampkIdx']);
  });
});
