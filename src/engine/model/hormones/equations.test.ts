// @vitest-environment node
/**
 * Unit tests of the hormones equations against worked numbers from the dossiers (12 §4.0-4.7, 08 §4.12, 19 §4.9).
 */
import {
  carbShortfall,
  balanceTeeRing,
  cortisolEnergyTerm,
  deficitPhi,
  energyStatusU,
  igfFastingTarget,
  igfTp,
  ketosisK,
  leptinAcuteTarget,
  leptinSufficiency,
  pLpd,
  rt3Target,
  t3fTarget,
  vermeulenFreeT,
} from './equations';

describe('hormones equations (12 §4.0 drivers)', () => {
  it('φ(u) saturates with the dossier scales', () => {
    expect(deficitPhi(0, 0.2)).toBe(0);
    expect(deficitPhi(0.3, 0.2)).toBe(0);
    expect(deficitPhi(-1, 0.2)).toBeCloseTo(1 - Math.exp(-5), 12);
    expect(deficitPhi(-0.3, 0.3)).toBeCloseTo(1 - Math.exp(-1), 12);
  });

  it('carbohydrate shortfall DC = max(0, 1 − carb/knee), bounded to [0, 1]', () => {
    expect(carbShortfall(75, 150)).toBeCloseTo(0.5, 12);
    expect(carbShortfall(200, 150)).toBe(0);
    expect(carbShortfall(0, 50)).toBe(1);
    expect(carbShortfall(-5, 50)).toBe(1);
  });

  it('ketosis intensity K: 0.5 at 0.3 mM and 0.72 at 0.48 mM (12 §4.0)', () => {
    expect(ketosisK(0.3, 0.3)).toBeCloseTo(0.5, 12);
    expect(ketosisK(0.48, 0.3)).toBeCloseTo(0.72, 2);
    expect(ketosisK(0, 0.3)).toBe(0);
  });

  it('leptin sufficiency S_L is 0.5 at L50 and monotone', () => {
    expect(leptinSufficiency(1, 1, 3)).toBeCloseTo(0.5, 12);
    expect(leptinSufficiency(2.5, 2.5, 3)).toBeCloseTo(0.5, 12);
    expect(leptinSufficiency(0.5, 1, 3)).toBeLessThan(leptinSufficiency(0.6, 1, 3));
    expect(leptinSufficiency(0, 1, 3)).toBe(0);
  });
});

describe('leptin (12 §4.1)', () => {
  it('baseline L0 = a·FM0^b reproduces the Kennedy 1997 anchors within 5 %', () => {
    const men = (fm: number) => 0.21 * Math.pow(fm, 1.14);
    const women = (fm: number) => 0.22 * Math.pow(fm, 1.36);
    // 12 §4.1(a): men 20 %BF/80 kg 4.95, 30 %BF/90 kg 8.97; women 30 %BF/70 kg 13.97, 40 %BF/85 kg 26.9 ng/mL
    expect(men(16) / 4.95).toBeCloseTo(1, 1);
    expect(Math.abs(men(27) / 8.97 - 1)).toBeLessThan(0.05);
    expect(Math.abs(women(21) / 13.97 - 1)).toBeLessThan(0.05);
    expect(Math.abs(women(34) / 26.9 - 1)).toBeLessThan(0.05);
  });

  it('acute factor A*: deficit and surplus branches', () => {
    // women, total fast: 1 − 0.55·(1 − e^{−5})
    expect(leptinAcuteTarget(-1, deficitPhi(-1, 0.2), 0.55, 1, 0, 0, 0, 0.5, 0.15, 1.5)).toBeCloseTo(1 - 0.55 * (1 - Math.exp(-5)), 12);
    // +30 % all-carbohydrate surplus: 1 + 0.3·1
    expect(leptinAcuteTarget(0.3, 0, 0.35, 1, 1, 0, 0, 0.5, 0.15, 1.5)).toBeCloseTo(1.3, 12);
    // cap 1.5
    expect(leptinAcuteTarget(1, 0, 0.35, 1, 1, 0, 0, 0.5, 0.15, 1.5)).toBe(1.5);
    // fat surplus weighs 0.15 (Dirlewanger: fat overfeeding → no significant change)
    expect(leptinAcuteTarget(0.3, 0, 0.35, 1, 0, 0, 1, 0.5, 0.15, 1.5)).toBeCloseTo(1.045, 12);
  });
});

describe('thyroid (12 §4.3, ruling R-T3)', () => {
  const T = (u: number, carb: number) => t3fTarget(u, deficitPhi(u, 0.3), carbShortfall(carb, 50), 0.22, 0.22, 0.1, 0.3);
  it('carbohydrate ≥ 50 g/d removes the carbohydrate term (Spaulding 1976)', () => {
    expect(T(0, 50)).toBe(1);
    expect(T(0, 200)).toBe(1);
    expect(T(0, 0)).toBeCloseTo(0.78, 12);
  });
  it('total fast target 1 − 0.22·φ_E − 0.22', () => {
    expect(T(-1, 0)).toBeCloseTo(1 - 0.22 * (1 - Math.exp(-1 / 0.3)) - 0.22, 12);
  });
  it('surplus: +10 % at u ≥ 0.3 and continuous at u = 0', () => {
    expect(T(0.3, 300)).toBeCloseTo(1.1, 12);
    expect(T(0.6, 300)).toBeCloseTo(1.1, 12);
    expect(Math.abs(T(1e-9, 0) - T(0, 0))).toBeLessThan(1e-8);
  });
  it('rT3 target rises only for |u| > 0.7 and with carbohydrate shortfall', () => {
    expect(rt3Target(-0.5, 0, 0.6, 0.7, 0.3, 0.15)).toBe(1);
    expect(rt3Target(-1, 1, 0.6, 0.7, 0.3, 0.15)).toBeCloseTo(1.75, 12);
  });
});

describe('cortisol (12 §4.4)', () => {
  const er = (u: number, n: number) => cortisolEnergyTerm(u, n, 0.05, 0.5, 0.6, 0.4, 0.08, 0.25, 28);
  it('ΔER* worked values', () => {
    expect(er(-1, 0)).toBeCloseTo(0.58, 12);
    expect(er(-0.25, 0)).toBeCloseTo(0.08, 12);
    expect(er(-0.04, 0)).toBe(0);
    expect(er(-1, 28)).toBeCloseTo(0.58 * Math.exp(-1), 12);
  });
});

describe('testosterone: Vermeulen free T (12 §4.5)', () => {
  it('satisfies the mass balance TT = N·FT + SHBG·K·FT/(1 + K·FT)', () => {
    const tt = 17e-9;
    const shbg = 35e-9;
    const ft = vermeulenFreeT(tt, shbg, 6.2e-4, 3.6e4, 1e9);
    const n = 1 + 3.6e4 * 6.2e-4;
    const back = n * ft + (shbg * 1e9 * ft) / (1 + 1e9 * ft);
    expect(Math.abs(back / tt - 1)).toBeLessThan(1e-9);
    // typical adult free T lies inside 12's 50-700 pmol/L range
    expect(ft * 1e12).toBeGreaterThan(50);
    expect(ft * 1e12).toBeLessThan(700);
  });
  it('free T falls when SHBG rises at equal total T', () => {
    expect(vermeulenFreeT(17e-9, 50e-9, 6.2e-4, 3.6e4, 1e9)).toBeLessThan(vermeulenFreeT(17e-9, 35e-9, 6.2e-4, 3.6e4, 1e9));
  });
});

describe('menstrual-disturbance risk P_LPD (19 §4.9, V8 anchors)', () => {
  const P = (men: number) => pLpd(men, 15, 0.2, 0.1, 0.9);
  it('reproduces 19 §4.9 predicted values 0.10 / 0.20 / 0.80 / 0.90', () => {
    expect(P(0)).toBeCloseTo(0.1, 12);
    expect(P(8)).toBeCloseTo(0.198, 3);
    expect(P(22)).toBeCloseTo(0.802, 3);
    expect(P(42)).toBeCloseTo(0.9, 12);
  });
});

describe('IGF-1 (08 §4.12)', () => {
  it('protein factor TP: 1.67 → 0.95 g/kg gives 0.78 (Fontana 2008)', () => {
    expect(igfTp(0.95, 0.306, 1.67, 0.5, 1) / igfTp(1.67, 0.306, 1.67, 0.5, 1)).toBeCloseTo(0.78, 2);
    expect(igfTp(3, 0.306, 1.67, 0.5, 1)).toBe(1);
    expect(igfTp(0, 0.306, 1.67, 0.5, 1)).toBe(0.5);
  });
  it('fasting target: ≈ 1 before the lag, 0.625 at the lag, → A∞ after', () => {
    expect(igfFastingTarget(12, 30, 3, 0.25)).toBeGreaterThan(0.99);
    expect(igfFastingTarget(30, 30, 3, 0.25)).toBeCloseTo(0.625, 12);
    expect(igfFastingTarget(120, 30, 3, 0.25)).toBeCloseTo(0.25, 6);
  });
});

describe('energy-status driver u = EI/T̄ − 1 (MODEL_SPEC §1.11: 7-day mean expenditure)', () => {
  it('a flat intake against a weekly training pattern in the TDEE estimate gives a constant u (no training-day deficits)', () => {
    const tee = new Float64Array(7).fill(2400);
    const ei = new Float64Array(7).fill(2400);
    // 3 sessions/wk: +280 kcal on training days, −210 on rest days (weekly mean 2400)
    const teeOf = (d: number) => 2400 + ([0, 2, 4].includes(d % 7) ? 280 : -210);
    const us: number[] = [];
    for (let d = 0; d < 28; d++) us.push(energyStatusU(tee, ei, d % 7, teeOf(d), 2400));
    for (const u of us.slice(7)) expect(Math.abs(u)).toBeLessThan(1e-12);
    // the raw daily u would alternate −0.10 / +0.10
    expect((2400 - teeOf(0)) / teeOf(0)).toBeLessThan(-0.1);
  });
  it('intake enters day by day: a zero-intake day is u = −1; a surplus is clamped at +1', () => {
    const tee = new Float64Array(7).fill(2000);
    const ei = new Float64Array(7).fill(2000);
    expect(energyStatusU(tee, ei, 0, 2000, 0)).toBe(-1);
    expect(energyStatusU(tee, ei, 1, 2000, 5000)).toBe(1);
    expect(energyStatusU(tee, ei, 2, 2000, 1500)).toBeCloseTo(-0.25, 12);
  });
  it('balanceTeeRing shifts the burn-in expenditure to the burn-in intake (NEAT0 calibration, §3.4) keeping the pattern', () => {
    const tee = Float64Array.from([2450, 2300, 2450, 2300, 2450, 2300, 2300]);
    const ei = new Float64Array(7).fill(2331);
    balanceTeeRing(tee, ei);
    let sum = 0;
    for (const x of tee) sum += x;
    expect(sum / 7).toBeCloseTo(2331, 9);
    expect(tee[0]! - tee[1]!).toBeCloseTo(150, 9);
  });
});
