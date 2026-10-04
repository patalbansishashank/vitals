// @vitest-environment node
/**
 * Unit tests of the intake closed forms against the dossiers' worked numbers (04 §4.16-4.17, 07 §4.4.3/§4.7.1,
 * 15 §4.2/§4.12) and against core/math reference solutions.
 */
import { mmRemaining } from '../../../core/math';
import { creatineStep, fastingGlucoseRef, fibreMeCorrection, glucoseAmplitude, insulinAmplitude, mClock, mmStep, mmTailStep } from '../kinetics';
import { eulerMM } from './harness';

const out = new Float64Array(2);
const step = (e0: number, v: number, km: number, dt: number): number => {
  mmStep(e0, Math.log(e0), v, km, dt, out);
  return out[0]!;
};

// nominal 04 §4.16 constants
const A50 = 2.8;
const KL = 80;
const amp = (lEff: number, p = 0, f = 0, visc = 0, sMusPow = 1, kL = KL): number =>
  glucoseAmplitude(lEff, p, f, visc, sMusPow, A50, kL, 0.006, 50, 0.0025, 30, 0.035, 12, 4.5);

describe('mmStep — exact Michaelis–Menten step in log space', () => {
  it('matches the Lambert-W solution (core/math.mmRemaining) to 1e-10 relative', () => {
    for (const e0 of [0.001, 0.5, 5, 25, 100, 255, 700, 2000]) {
      for (const [v, km] of [[11, 20], [8.8, 20], [270, 150], [17.6, 25]] as const) {
        for (const dt of [0.25, 0.5, 1]) {
          const ref = mmRemaining(e0, v, km, dt);
          const got = step(e0, v, km, dt);
          expect(Math.abs(got - ref)).toBeLessThanOrEqual(1e-10 * Math.max(1, ref));
          expect(Number.isFinite(out[1]!) || got === 0).toBe(true);
        }
      }
    }
  });

  it('first-order tail step (E ≤ 0.05·K, no transcendental call) matches Lambert W to 2e-5 relative', () => {
    for (const e0 of [1e-4, 0.01, 0.1, 0.5, 1.0]) {
      for (const v of [8.8, 11, 17.6, 22]) {
        mmTailStep(e0, Math.log(e0), -v / 20, Math.exp(-v / 20), 20, out);
        const ref = mmRemaining(e0, v, 20, 1);
        expect(Math.abs(out[0]! - ref) / ref).toBeLessThan(2e-5);
        expect(Math.abs(Math.exp(out[1]!) - out[0]!) / out[0]!).toBeLessThan(2e-5);
      }
    }
    for (const e0 of [0.1, 1, 5, 7.5]) {
      mmTailStep(e0, Math.log(e0), -270 / 150, Math.exp(-270 / 150), 150, out);
      const ref = mmRemaining(e0, 270, 150, 1);
      expect(Math.abs(out[0]! - ref) / ref).toBeLessThan(2e-5);
    }
  });

  it('keeps the log companion consistent and never overshoots below zero', () => {
    let e = 700;
    let u = Math.log(e);
    for (let h = 0; h < 30; h++) {
      mmStep(e, u, 270, 150, 1, out);
      expect(out[0]!).toBeGreaterThanOrEqual(0);
      expect(out[0]!).toBeLessThanOrEqual(e);
      if (out[0]! > 0) expect(Math.abs(Math.exp(out[1]!) - out[0]!)).toBeLessThan(1e-12 * Math.max(1, out[0]!));
      e = out[0]!;
      u = out[1]!;
    }
    expect(e).toBeLessThan(1e-6);
    mmStep(0, -Infinity, 270, 150, 1, out);
    expect(out[0]).toBe(0);
  });

  it('stays within 2 % of a 5-min Euler reference on the 07 §4.1 and 03 §4.7A test meals (MODEL_SPEC §0.1)', () => {
    // gut energy, 700 kcal (07 t95 case): within 2 % of the meal; the residual is the Euler reference's own
    // discretisation error (it shrinks toward the exact value as the Euler step shrinks)
    let e = 700;
    for (let h = 1; h <= 6; h++) {
      e = step(e, 270, 150, 1);
      const ref = eulerMM(700, 270, 150, h);
      expect(Math.abs(e - ref) / 700).toBeLessThan(0.02);
      const fine = eulerMM(700, 270, 150, h, 1 / 3600);
      expect(Math.abs(e - fine)).toBeLessThan(Math.abs(e - ref) + 1e-9);
      expect(Math.abs(e - fine) / 700).toBeLessThan(5e-4);
    }
    // protein 25 g and 100 g, Vmax 11, Km 20 (4/8/12 h digested fractions)
    for (const p0 of [25, 100]) {
      let g = p0;
      for (let h = 1; h <= 12; h++) {
        g = step(g, 11, 20, 1);
        const ref = eulerMM(p0, 11, 20, h);
        expect(Math.abs((p0 - g) - (p0 - ref)) / (p0 - ref)).toBeLessThan(0.02);
      }
    }
  });
});

describe('04 §4.16 glucose amplitude', () => {
  it('Taylor 1996 check: 139 g glucose + 29 g protein + 17 g fat → Δ 3.6 mmol/L (observed 3.4 ± 1.0)', () => {
    const a = amp(139, 29, 17);
    expect(a).toBeCloseTo(3.62, 1);
    expect(Math.abs(a - 3.4)).toBeLessThanOrEqual(1.0);
  });

  it('Lee & Wolever dose steps +68 % (25→50 g) and +38 % (50→100 g): exact with the fitted K (106 / 61), nominal K_L 80 within 8 points', () => {
    expect(amp(50, 0, 0, 0, 1, 106) / amp(25, 0, 0, 0, 1, 106)).toBeCloseTo(1.68, 2);
    expect(amp(100, 0, 0, 0, 1, 61) / amp(50, 0, 0, 0, 1, 61)).toBeCloseTo(1.38, 2);
    const r1 = amp(50) / amp(25);
    const r2 = amp(100) / amp(50);
    expect(Math.abs(r1 - 1.68)).toBeLessThan(0.08); // 1.615
    expect(Math.abs(r2 - 1.38)).toBeLessThan(0.08); // 1.444
  });

  it('protein and fat lower the excursion (M_PF), viscous fibre lowers it (M_fib), S_mus raises it, cap 4.5', () => {
    expect(amp(50, 30)).toBeLessThan(amp(50));
    expect(amp(50, 0, 20)).toBeLessThan(amp(50));
    expect(amp(50, 30) / amp(50)).toBeCloseTo(1 - 0.18, 10);
    expect(amp(50, 0, 0, 4) / amp(50)).toBeCloseTo(1 - 0.14, 10);
    expect(amp(50, 0, 0, 0, Math.pow(0.5, -0.5))).toBeGreaterThan(amp(50));
    expect(amp(1000)).toBe(4.5);
    expect(amp(0)).toBe(0);
    // monotone in load
    let prev = 0;
    for (let l = 5; l <= 300; l += 5) {
      const a = amp(l);
      expect(a).toBeGreaterThanOrEqual(prev);
      prev = a;
    }
  });
});

describe('04 §4.17 insulin amplitude', () => {
  it('fits: 75 g → ≈ 50 µU/mL; 479 g → 154 (observed peak 139 ± 40 %)', () => {
    expect(insulinAmplitude(75, 0, 1, 250, 300, 0.6)).toBeCloseTo(50, 6);
    const b = insulinAmplitude(479, 0, 1, 250, 300, 0.6);
    expect(b).toBeCloseTo(153.7, 1);
    expect(Math.abs(b - 139) / 139).toBeLessThanOrEqual(0.4);
  });

  it('protein adds b_P per gram; insulin resistance (S_mus < 1) raises it', () => {
    expect(insulinAmplitude(0, 40, 1, 250, 300, 0.6)).toBeCloseTo(24, 10);
    expect(insulinAmplitude(50, 0, Math.pow(0.5, -0.7), 250, 300, 0.6)).toBeGreaterThan(insulinAmplitude(50, 0, 1, 250, 300, 0.6));
  });
});

describe('07 §4.7.1 mClock and §4.4.3 fasting glucose reference', () => {
  it('mClock: 08:00 1.00, 13:00 1.07, 20:00 1.17, 22:00 1.20 (reference 08:00)', () => {
    expect(mClock(8, 8, 0.0142, 14)).toBeCloseTo(1.0, 3);
    expect(mClock(13, 8, 0.0142, 14)).toBeCloseTo(1.071, 3);
    expect(mClock(20, 8, 0.0142, 14)).toBeCloseTo(1.17, 2);
    expect(mClock(22, 8, 0.0142, 14)).toBeCloseTo(1.199, 3);
    expect(mClock(2, 8, 0.0142, 14)).toBeCloseTo(1.199, 3); // after midnight = late
  });

  it('reference glucose: 12 h 4.83, 24 h 4.7, 48 h 4.2, 72 h 3.7 (07 Table A model column)', () => {
    const g = (t: number) => fastingGlucoseRef(t, 3.5, 1.4, 48, 12);
    expect(g(12)).toBeCloseTo(4.83, 2);
    expect(g(24)).toBeCloseTo(4.7, 1);
    expect(g(48)).toBeCloseTo(4.2, 1);
    expect(g(72)).toBeCloseTo(3.67, 2);
    expect(g(120)).toBeCloseTo(3.5, 1);
  });
});

describe('15 §4.2 fibre / nut ME corrections (V1-V3 and worked examples)', () => {
  const kNet = 5.0 - 4.2 + 2.0; // k_F − GE_fib + c_f
  const dme = (f: number, e: number) => fibreMeCorrection(f, e, kNet, 8, 0.06, 0.03);

  it('k_net = 2.8 kcal/g at the 2 kcal/g engine credit', () => {
    expect(kNet).toBeCloseTo(2.8, 12);
  });

  it('worked examples: −55 / −70 / −50 / +45 kcal/d', () => {
    expect(dme(40, 2550)).toBeCloseTo(-55, 0);
    expect(dme(45, 2500)).toBeCloseTo(-70, 0);
    expect(dme(30, 1500)).toBeCloseTo(-50.4, 1);
    expect(dme(0, 2000)).toBeCloseTo(44.8, 1);
    expect(dme(200, 2000)).toBe(-0.06 * 2000); // lower cap
    expect(dme(20, 0)).toBe(0);
  });

  it('V1 Karl 2017: fibre 21 → 40 g/d at 2,550 kcal: dME −30 to −90 kcal/d and faecal energy +60 to +130 kcal/d', () => {
    const d = dme(40, 2550) - dme(21, 2550);
    expect(d).toBeLessThanOrEqual(-30);
    expect(d).toBeGreaterThanOrEqual(-90);
    const fe = 5.0 * (40 - 21); // FE = FE0 + k_F·F_eff (physical faecal energy)
    expect(fe).toBeGreaterThanOrEqual(60);
    expect(fe).toBeLessThanOrEqual(130);
  });

  it('V2 Corbin 2023: faecal energy +60 to +170 kcal/d for a 20-25 g fibre difference', () => {
    for (const df of [20, 25]) {
      const fe = 5.0 * df;
      expect(fe).toBeGreaterThanOrEqual(60);
      expect(fe).toBeLessThanOrEqual(170);
    }
  });

  it('V3 Novotny 2012: 84 g/d whole raw almonds → dME_nut −120 to −140 kcal/d', () => {
    const dNut = -0.25 * 84 * 6.1;
    expect(dNut).toBeLessThanOrEqual(-120);
    expect(dNut).toBeGreaterThanOrEqual(-140);
  });
});

describe('15 §4.12 creatine kinetics (V14)', () => {
  const run = (x0: number, dose: number, days: number): number => {
    let x = x0;
    for (let d = 0; d < days; d++) x = creatineStep(x, dose, 0.2, 2.5, 30, 1.5, 15, 10, 1);
    return x;
  };
  it('20 g/d × 6 d → x = 0.19-0.20', () => {
    const x = run(0, 20, 6);
    expect(x).toBeGreaterThanOrEqual(0.19);
    expect(x).toBeLessThanOrEqual(0.2);
  });
  it('3 g/d × 28 d → x ≈ 0.19 (τ_up 10 d)', () => {
    expect(run(0, 3, 28)).toBeCloseTo(0.19, 2);
  });
  it('30 d after stopping from saturation → x < 0.02', () => {
    expect(run(0.2, 0, 30)).toBeLessThan(0.02);
  });
  it('dose below 2.5 g/d gives a proportionally lower target; bounds hold', () => {
    const x = run(0, 1.25, 200);
    expect(x).toBeCloseTo(0.1, 3);
    for (const d of [0, 1, 3, 5, 20, 50]) {
      const y = run(0, d, 100);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(0.2 + 1e-12);
    }
  });
});
