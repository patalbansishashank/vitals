// @vitest-environment node
/** Unit tests of each wellbeing equation against worked numbers from dossiers 19 §4.1-4.5 and 13 §4.10. */
import {
  RING_CAP,
  ageMultiplier,
  bmdTarget,
  ctxTarget,
  eaTier,
  econFactor,
  energyAvailability,
  exerciseShare,
  inductionDaysToFraction,
  intensityGate,
  leanGate,
  massFactor,
  p1npTarget,
  phiInd,
  phiMaxFor,
  ringMean,
  ringPush,
  ringSlope,
  srcFactor,
  strengthPenalty,
  tte75,
} from '../index';

describe('19 §4.1 energy availability', () => {
  it('EA = (EI − EEE)/FFM in kcal per kg FFM', () => {
    expect(energyAvailability(2400, 400, 60, -5, 70)).toBeCloseTo(33.3333, 4);
    expect(energyAvailability(2700, 0, 60, -5, 70)).toBeCloseTo(45, 10);
  });
  it('zero-intake days give −EEE/FFM clipped at −5 (19 §5 row 20); the upper clip is 70', () => {
    expect(energyAvailability(0, 150, 60, -5, 70)).toBe(-2.5);
    expect(energyAvailability(0, 600, 60, -5, 70)).toBe(-5);
    expect(energyAvailability(6000, 0, 60, -5, 70)).toBe(70);
  });
  it('divides by at least 1 kg of FFM (never NaN/Infinity)', () => {
    expect(Number.isFinite(energyAvailability(2000, 0, 0, -5, 70))).toBe(true);
  });
  it('tier limits 45 / 30 / 15', () => {
    expect([50, 45, 44.9, 30, 29.9, 15, 14.9].map((x) => eaTier(x, 45, 30, 15))).toEqual([0, 0, 1, 1, 2, 2, 3]);
  });
  it('exercise share of the availability decrement (Papageorgiou 2018 designs)', () => {
    // diet-created LEA: EI = 15·FFM, no exercise → share 0; exercise-created LEA: EEE = 30 kcal/kg FFM, EI = 45·FFM → 1
    expect(exerciseShare(0, 15, 45)).toBe(0);
    expect(exerciseShare(30, 15, 45)).toBe(1);
    expect(exerciseShare(15, 15, 45)).toBeCloseTo(0.5, 12);
    expect(exerciseShare(10, 45, 45)).toBe(0); // no decrement, no share
    expect(exerciseShare(50, 15, 45)).toBe(1); // clipped
  });
});

describe('19 §4.2(a) bone turnover targets', () => {
  it('P1NP falls 17 % at EA 15 (diet-created, women) — Papageorgiou 2018', () => {
    expect(p1npTarget(15, 0.17, 45, 30, 1.3, 1, 1)).toBeCloseTo(0.83, 12);
  });
  it('exercise-created LEA halves the response: srcF = 1 − 0.5·f_EEE → P1NP 0.915', () => {
    expect(srcFactor(1, 0.5)).toBe(0.5);
    expect(srcFactor(0, 0.5)).toBe(1);
    expect(p1npTarget(15, 0.17, 45, 30, 1.3, 1, srcFactor(1, 0.5))).toBeCloseTo(0.915, 12);
  });
  it('men respond with half weight (sexF 0.5)', () => {
    expect(p1npTarget(15, 0.17, 45, 30, 1.3, 0.5, 1)).toBeCloseTo(0.915, 12);
    expect(ctxTarget(15, 0.15, 20, 5, 1.3, 0.5)).toBeCloseTo(1.075, 12);
  });
  it('no effect at EA ≥ 45; ramp capped at 1.3 for very low EA', () => {
    expect(p1npTarget(45, 0.17, 45, 30, 1.3, 1, 1)).toBe(1);
    expect(p1npTarget(70, 0.17, 45, 30, 1.3, 1, 1)).toBe(1);
    expect(p1npTarget(-5, 0.17, 45, 30, 1.3, 1, 1)).toBeCloseTo(1 - 0.17 * 1.3, 12);
  });
  it('CTX rises only below EA 20 (NTX rises only at EA 10, Ihle 2004): +15 % at EA 15, cap 1.3 ramp', () => {
    expect(ctxTarget(20, 0.15, 20, 5, 1.3, 1)).toBe(1);
    expect(ctxTarget(30, 0.15, 20, 5, 1.3, 1)).toBe(1);
    expect(ctxTarget(15, 0.15, 20, 5, 1.3, 1)).toBeCloseTo(1.15, 12);
    expect(ctxTarget(10, 0.15, 20, 5, 1.3, 1)).toBeCloseTo(1 + 0.15 * 1.3, 12);
  });
});

describe('19 §4.2(b) BMD', () => {
  it('hip target = −k_h·mAge·mRT·mCa·mSrc·WL_pct: CALERIE-2 (WL 10 %, all modifiers 1) → −2.0 %', () => {
    expect(bmdTarget(0.2, 1, 1, 1, 1, 10)).toBeCloseTo(-2, 12);
  });
  it('exercise-created loss (mSrc 0.25, Villareal 2006 −8.4 %) → −0.42 %', () => {
    expect(bmdTarget(0.2, 1, 1, 1, 0.25, 8.4)).toBeCloseTo(-0.42, 12);
  });
  it('postmenopausal, low calcium, no RT protection: multipliers compound', () => {
    expect(bmdTarget(0.2, 1.5, 1, 1.5, 1, 10)).toBeCloseTo(-4.5, 12);
  });
  it('progressive RT (ρ_RT 0.35) reduces the loss to 65 %', () => {
    expect(bmdTarget(0.2, 1, 1 - 0.35, 1, 1, 10)).toBeCloseTo(-1.3, 12);
  });
  it('mAge: 1.0 premenopausal < 65 y, 1.5 for ≥ 65 y or postmenopausal, midpoint for perimenopause', () => {
    expect(ageMultiplier(30, 0, 65, 1.5)).toBe(1);
    expect(ageMultiplier(52, 0, 65, 1.5)).toBe(1);
    expect(ageMultiplier(65, 0, 65, 1.5)).toBe(1.5);
    expect(ageMultiplier(45, 2, 65, 1.5)).toBe(1.5);
    expect(ageMultiplier(49, 1, 65, 1.5)).toBe(1.25);
  });
});

describe('19 §4.3 strength penalty', () => {
  it('anchor: EA_c 15 ⇒ −15 % (a_strength 0.15, fully lean)', () => {
    expect(strengthPenalty(0.15, 15, 30, 15, 1.3, 1)).toBeCloseTo(0.15, 12);
  });
  it('no penalty at EA_c ≥ 30 (moderate deficit with RT: Murphy & Koehler 2022, Longland 2016)', () => {
    expect(strengthPenalty(0.15, 30, 30, 15, 1.3, 1)).toBe(0);
    expect(strengthPenalty(0.15, 45, 30, 15, 1.3, 1)).toBe(0);
  });
  it('linear between and capped at 1.3 ramp units', () => {
    expect(strengthPenalty(0.15, 22.5, 30, 15, 1.3, 1)).toBeCloseTo(0.075, 12);
    expect(strengthPenalty(0.15, 10, 30, 15, 1.3, 1)).toBeCloseTo(0.195, 12);
    expect(strengthPenalty(0.15, -5, 30, 15, 1.3, 1)).toBeCloseTo(0.195, 12);
  });
  it('leanness gate: 1 up to 18 % (M) / 28 % (F), linear to 0.3 at 30 % / 40 %', () => {
    expect(leanGate(12, 18, 30, 0.3)).toBe(1);
    expect(leanGate(18, 18, 30, 0.3)).toBe(1);
    expect(leanGate(24, 18, 30, 0.3)).toBeCloseTo(0.65, 12);
    expect(leanGate(30, 18, 30, 0.3)).toBe(0.3);
    expect(leanGate(45, 18, 30, 0.3)).toBe(0.3);
    expect(leanGate(34, 28, 40, 0.3)).toBeCloseTo(0.65, 12);
    expect(strengthPenalty(0.15, 15, 30, 15, 1.3, 0.3)).toBeCloseTo(0.045, 12);
  });
});

describe('19 §4.4 endurance', () => {
  it('Bergström regression TTE = 36.8 + 41.6·G', () => {
    expect(tte75(1.75, 36.8, 41.6)).toBeCloseTo(109.6, 10);
    expect(tte75(0, 36.8, 41.6)).toBeCloseTo(36.8, 10);
  });
  it('intensity gate: 0 at ≤ 60 % VO2max, 1 at ≥ 70 % (Shaw 2019)', () => {
    expect([0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.9].map((x) => intensityGate(x, 0.6, 0.7))).toEqual([0, 0, 0, 0.5, 1, 1, 1].map((v) => expect.closeTo(v, 12)));
  });
  it('economy factor 1/(1 + 0.065·A_econ)', () => {
    expect(econFactor(1, 0.065)).toBeCloseTo(1 / 1.065, 12);
    expect(econFactor(0, 0.065)).toBe(1);
  });
  it('mass effect reproduces Cureton 1978: +5 % inert mass ≈ −2.4 mL/kg/min at a 50 mL/kg/min baseline', () => {
    const f = massFactor(80, 4, 1);
    expect(f).toBeCloseTo(80 / 84, 12);
    expect(50 * (f - 1)).toBeCloseTo(-2.4, 1);
  });
  it('mass factor falls with exponent 0.79 (uphill cycling, Swain 1994) and rises when inert mass is lost', () => {
    expect(massFactor(80, 4, 0.79)).toBeCloseTo(Math.pow(80 / 84, 0.79), 12);
    expect(massFactor(80, -4, 1)).toBeGreaterThan(1);
  });
});

describe('13 §4.10 keto-induction Φ_ind', () => {
  it('peaks at Φ_max when Δt = τ_p', () => {
    expect(phiInd(2.5, 0.8, 2.5)).toBeCloseTo(0.8, 12);
    expect(phiInd(1, 1, 2.5)).toBeCloseTo(0.4 * Math.exp(0.6), 12);
    expect(phiInd(5, 1, 2.5)).toBeCloseTo(2 * Math.exp(-1), 12);
  });
  it('is zero before the trigger and for Φ_max = 0', () => {
    expect(phiInd(0, 1, 2.5)).toBe(0);
    expect(phiInd(-1, 1, 2.5)).toBe(0);
    expect(phiInd(3, 0, 2.5)).toBe(0);
  });
  it('Φ_max = relative carbohydrate drop × (1 − 0.3·[Na ≥ 2 g/d])', () => {
    expect(phiMaxFor(250, 30, 1500, 2000, 0.3)).toBeCloseTo(0.88, 12);
    expect(phiMaxFor(250, 30, 2000, 2000, 0.3)).toBeCloseTo(0.616, 12);
    expect(phiMaxFor(250, 300, 1500, 2000, 0.3)).toBe(0);
    expect(phiMaxFor(0, 0, 1500, 2000, 0.3)).toBe(0);
  });
  it('time to fall to half of the peak is ≈ 6.7 d for τ_p = 2.5 d and ≈ 16 d for the heavy tail τ_p = 6 d', () => {
    expect(inductionDaysToFraction(0.5, 2.5)).toBeCloseTo(6.7, 1);
    expect(inductionDaysToFraction(0.5, 6)).toBeCloseTo(16.1, 1);
  });
});

describe('daily rings', () => {
  it('mean and OLS slope of the newest n entries', () => {
    const ring = new Float64Array(RING_CAP);
    let head = 0;
    for (let i = 1; i <= 40; i++) head = ringPush(ring, head, 2 * i + 5); // wraps the ring
    expect(ringMean(ring, head, 14)).toBeCloseTo(2 * 33.5 + 5, 12); // entries 27..40
    expect(ringSlope(ring, head, 14, (14 * (14 * 14 - 1)) / 12)).toBeCloseTo(2, 12);
    expect(ringMean(ring, head, 1)).toBe(85);
  });
});
