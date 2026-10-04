// @vitest-environment node
/**
 * Validation targets of the wellbeing module: 19 §7 V1-V12 (V8 menstrual risk belongs to hormones, V13 RHR/HRV is not
 * in the v1 catalogue) and 13 §4.10. Each scenario drives the module directly with hand-built bus values.
 */
import { inductionDaysToFraction, tte75 } from '../index';
import { MAN, WOMAN, makeHarness, type Harness } from './harness';
import type { PersonProfile } from '../../../types/profile';

/** Set the bus body composition so that FM/(FM+FFM) = bf % at the given tissue mass. */
function setBody(h: Harness, massKg: number, bfPct: number): void {
  h.bus.fatMassKg = (massKg * bfPct) / 100;
  h.bus.ffmActKg = massKg - h.bus.fatMassKg;
  h.bus.labileWaterKg = 0;
}

const bodyBus = (massKg: number, bfPct: number) => ({
  fatMassKg: (massKg * bfPct) / 100,
  ffmActKg: massKg - (massKg * bfPct) / 100,
  labileWaterKg: 0,
});

describe('19 V1 Bergström 1967: glycogen-limited time to exhaustion at 75 % VO2max', () => {
  const cases: [number, number][] = [
    [0.63, 56.9],
    [1.75, 113.6],
    [3.31, 166.5],
  ];
  it.each(cases)('TTE_75(G = %f g/100 g ww) within ±10 min of %f min', (g, published) => {
    expect(Math.abs(tte75(g, 36.8, 41.6) - published)).toBeLessThanOrEqual(10);
  });

  it('module: endurance capacity index follows the TTE regression of the daily-mean muscle glycogen concentration', () => {
    const h = makeHarness(MAN);
    const g0 = h.s.gConc0; // baseline concentration latched in burn-in, g/100 g ww
    expect(g0).toBeCloseTo(1.73, 6);
    const smm = h.bus.skeletalMuscleKg;
    for (const [g, published] of cases) {
      h.bus.muscleGlycogenG = g * 10 * smm;
      h.run({}, 1);
      const tte = (h.s.enduranceIdx / 100) * tte75(g0, 36.8, 41.6);
      expect(Math.abs(tte - published)).toBeLessThanOrEqual(10);
      expect(h.s.enduranceIdx).toBeCloseTo((100 * tte75(g, 36.8, 41.6)) / tte75(g0, 36.8, 41.6), 6);
    }
  });
});

describe('19 V2 Burke 2017: LCHF economy penalty ≈ 8 pp gap (±3), dO2cost 5-6.5 % at I_rel ≥ 0.7', () => {
  it('full fat adaptation at the 75 % VO2max reference lowers the sustainable speed by 6.1 %', () => {
    const h = makeHarness(MAN);
    h.bus.ketoAdaptFast = 1;
    h.run({}, 1);
    const penaltyPct = 100 - h.s.enduranceIdx;
    expect(penaltyPct).toBeCloseTo(100 * (1 - 1 / 1.065), 6);
    expect(Math.abs(penaltyPct - 8)).toBeLessThanOrEqual(3);
    expect(h.k.do2Cost).toBeGreaterThanOrEqual(0.05);
    expect(h.k.do2Cost).toBeLessThanOrEqual(0.065);
  });
});

describe('19 V3 Burke 2021: A_econ ≥ 0.8 within 6 d of LCHF, ≤ 0.2 within 6 d of returning to HCHO (±3 pp)', () => {
  it('A_econ follows the fat-adaptation state up and recovers with τ_econ = 3 d', () => {
    const h = makeHarness(MAN);
    let ok = false;
    for (let d = 1; d <= 6; d++) {
      h.bus.ketoAdaptFast = Math.min(0.9, 0.18 * d); // hand-built A_fat ramp (ketones owns the real kinetics)
      h.run({ carb: 30 }, 1);
      if (h.s.aEcon >= 0.8) ok = true;
    }
    expect(ok).toBe(true);
    expect(h.s.aEcon).toBeGreaterThanOrEqual(0.8);
    h.bus.ketoAdaptFast = 0; // HCHO restored
    h.run({}, 6);
    expect(h.s.aEcon).toBeLessThanOrEqual(0.2 + 0.03);
    expect(h.s.aEcon).toBeCloseTo(0.9 * Math.exp(-2), 6);
  });
});

describe('19 V4 Shaw 2019: economy penalty gated by intensity (qualitative)', () => {
  it('gI = 0 at 55 % VO2max and 1 at 75 % VO2max', () => {
    const h = makeHarness(MAN);
    // the module's reference intensity is 75 %: gI(0.75) = 1; the gate function itself is tested in equations.test.ts
    expect(h.k.giRef).toBe(1);
    const lo = makeHarness(MAN, { overrides: { 'wellbeing.econRefIntensity': 0.55 } });
    expect(lo.k.giRef).toBe(0);
  });
});

describe('19 V5 CALERIE-2 bone (Villareal 2016): −10 % weight over 1 y then stable → hip BMD −1.5 to −2.0 % ± 0.7 at 24 mo', () => {
  it('hip BMD change after 24 months (mAge 1, mRT 1, no exercise-created deficit)', () => {
    const w: PersonProfile = { schemaVersion: 1, body: { sex: 'female', ageYears: 38, heightCm: 165, weightKg: 70 }, startDate: '2026-10-05' };
    const h = makeHarness(w);
    const fm0 = h.bus.fatMassKg;
    const ffm = h.profile.ffm0Kg;
    const days = 730;
    for (let d = 0; d < days; d++) {
      // −7 kg of fat over the first 365 d (10 % of 70 kg), then stable
      h.bus.fatMassKg = fm0 - 7 * Math.min(1, (d + 1) / 365);
      h.bus.ffmActKg = ffm;
      h.run({ ei: h.base.ei * 0.78 }, 1);
    }
    expect(h.s.bmdHipPct).toBeGreaterThanOrEqual(-2.7);
    expect(h.s.bmdHipPct).toBeLessThanOrEqual(-0.8);
    expect(h.s.bmdHipPct).toBeCloseTo(-2.0, 0); // target −k_h·10 = −2.0, τ_loss 120 d
  });
});

describe('19 V6 Villareal 2006: CR (−10.7 %) vs exercise-induced (−8.4 %) weight loss over 1 y', () => {
  function armAtOneYear(lossPct: number, ei: number, eee: number): number {
    const p: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 57, heightCm: 178, weightKg: 82 }, startDate: '2026-10-05' };
    const h = makeHarness(p);
    const fm0 = h.bus.fatMassKg;
    const mass0 = fm0 + h.bus.ffmActKg;
    for (let d = 0; d < 365; d++) {
      h.bus.fatMassKg = fm0 - (mass0 * lossPct) / 100 * ((d + 1) / 365);
      h.run({ ei: ei * h.base.ei, eee, exMin: eee > 0 ? 60 : 0 }, 1);
    }
    return h.s.bmdHipPct;
  }
  it('CR arm: −2 to −2.5 % ± 1 pp; exercise arm (mSrc 0.25): ≈ −0.5 % ± 1 pp', () => {
    const cr = armAtOneYear(10.7, 0.75, 0);
    const ex = armAtOneYear(8.4, 1.0, 550);
    expect(cr).toBeGreaterThanOrEqual(-3.5);
    expect(cr).toBeLessThanOrEqual(-1.0);
    expect(ex).toBeGreaterThanOrEqual(-1.5);
    expect(ex).toBeLessThanOrEqual(0.5);
    expect(ex).toBeGreaterThan(cr); // exercise-induced loss spares bone
    // steady targets (τ-free): −0.2·10.7 = −2.14 and −0.2·0.25·8.4 = −0.42
  });
});

describe('19 V7 Papageorgiou 2018: P1NP after 3-5 d at EA 15', () => {
  function womanAtEa(ea: number, eeeKcalKgFfm: number): Harness {
    const h = makeHarness(WOMAN);
    const ffm = h.profile.ffm0Kg;
    h.base.ei = (ea + eeeKcalKgFfm) * ffm;
    h.base.eee = eeeKcalKgFfm * ffm;
    return h;
  }
  it('steady state: 0.83 ± 0.05 (diet-created LEA) and 0.915 (exercise-created LEA)', () => {
    const diet = womanAtEa(15, 0);
    diet.run({ ei: 15 * diet.profile.ffm0Kg, eee: 0 }, 90);
    expect(diet.s.p1np).toBeGreaterThanOrEqual(0.78);
    expect(diet.s.p1np).toBeLessThanOrEqual(0.88);
    expect(diet.s.p1np).toBeCloseTo(0.83, 2);
    const ffm = diet.profile.ffm0Kg;
    const exer = makeHarness(WOMAN);
    exer.run({ ei: 45 * ffm, eee: 30 * ffm }, 90);
    expect(exer.s.p1np).toBeGreaterThanOrEqual(0.865);
    expect(exer.s.p1np).toBeLessThanOrEqual(0.965);
    expect(exer.s.p1np).toBeCloseTo(0.915, 2);
    expect(exer.s.p1np).toBeGreaterThan(diet.s.p1np);
  });

  // KNOWN MISS (reported): 19 §4.2(a) chains two smoothers (EA_s τ 3 d, then P1NP τ_b 2 d), so the state cannot reach the
  // 3-5-day values of the experiment: measured 0.93 at day 3 and 0.89 at day 5 (band 0.78-0.88 is entered on day 6).
  it.fails('dynamic: P1NP_rel is within 0.83 ± 0.05 at day 5 of a step to EA 15 (diet-created)', () => {
    const h = makeHarness(WOMAN);
    h.run({ ei: 15 * h.profile.ffm0Kg, eee: 0 }, 5);
    expect(h.s.p1np).toBeGreaterThanOrEqual(0.78);
    expect(h.s.p1np).toBeLessThanOrEqual(0.88);
  });

  it('CTX rises to 1.15 at EA 15 only after the P1NP fall (NTX responds at deeper deficit)', () => {
    const h = makeHarness(WOMAN);
    h.run({ ei: 15 * h.profile.ffm0Kg, eee: 0 }, 90);
    expect(h.s.ctx).toBeCloseTo(1.15, 2);
  });
});

describe('19 V9 Murphy & Koehler 2022 / Longland 2016: strength preserved in a ≈ 500 kcal/d deficit with RT', () => {
  it('M_EA = 1.0 while EA_c ≥ 30 (habitual man, −500 kcal/d, ≈ 100 kcal/d net RT energy)', () => {
    const h = makeHarness(MAN);
    h.run({ ei: h.base.ei - 500, eee: 103, exMin: 60, rtSets: 12 }, 120);
    expect(h.s.eaC).toBeGreaterThanOrEqual(30);
    expect(h.s.mEa).toBe(1);
    expect(h.bus.strengthEaMult).toBe(1);
  });
});

describe('19 V10 Nindl 2007: 8-week Ranger course, EA_c ≈ 10-20, BF 14.7 % → M_EA ≈ 0.80-0.90 (±7 pp)', () => {
  function m56(ea: number): number {
    const h = makeHarness(MAN, { bus: bodyBus(80, 14.7) });
    const ffm = h.bus.ffmActKg;
    h.run({ ei: ea * ffm, eee: 0 }, 56);
    return h.s.mEa;
  }
  it.each([10, 15, 20])('EA %f kcal/kg FFM/d for 56 d', (ea) => {
    const m = m56(ea);
    expect(m).toBeGreaterThanOrEqual(0.73);
    expect(m).toBeLessThanOrEqual(0.97);
  });
  it('deeper availability gives a larger penalty (monotone) and the 14-d EA_c window delays the fall', () => {
    expect(m56(10)).toBeLessThan(m56(15));
    expect(m56(15)).toBeLessThan(m56(20));
    expect(m56(10)).toBeGreaterThanOrEqual(0.805); // target 1 − 0.15·1.3 = 0.805
  });
});

describe('19 V11 Rossow 2013 (qualitative): 6-month contest preparation and 6-month recovery', () => {
  it('tier reaches red in late preparation (EA_c < 15, BF < 10 %, loss > 1 %BW/wk) and returns to green ≥ 6 months after; M_EA ≥ 85 % at 6 months', () => {
    const h = makeHarness(MAN, { bus: bodyBus(80, 14.8) });
    let mass = 80;
    const ffm0 = h.bus.ffmActKg;
    // 20 weeks of moderate preparation: EA ≈ 25, BF 14.8 → 8 %, loss ≈ 0.5 %BW/wk
    for (let d = 0; d < 140; d++) {
      mass = 80 * (1 - 0.005 * (d / 7));
      setBody(h, mass, 14.8 - 6.8 * (d / 140));
      h.run({ ei: 25 * h.bus.ffmActKg, eee: 0 }, 1);
    }
    expect(h.s.moodTier).toBeLessThanOrEqual(1);
    // last 4 weeks: EA ≈ 12 (Pardue: 1 724 kcal), loss 1.1 %BW/wk, BF 8 → 4.5 %
    const massStart = mass;
    let sawRed = false;
    for (let d = 0; d < 28; d++) {
      mass = massStart * (1 - 0.011 * ((d + 1) / 7));
      setBody(h, mass, 8 - 3.5 * ((d + 1) / 28));
      h.run({ ei: 12 * h.bus.ffmActKg + 0, eee: 0 }, 1);
      if (h.s.moodTier === 2) sawRed = true;
    }
    expect(h.s.eaC).toBeLessThan(15);
    expect(sawRed).toBe(true);
    expect(h.s.mEa).toBeLessThan(0.95);
    const mEaAtContest = h.s.mEa;
    // recovery: intake back to maintenance, weight and fat regained over 6 months
    let green = -1;
    for (let d = 0; d < 180; d++) {
      const f = (d + 1) / 180;
      setBody(h, mass + (80 - mass) * f, 4.5 + (14.6 - 4.5) * f);
      h.bus.ffmActKg = Math.max(h.bus.ffmActKg, ffm0 * 0.99);
      h.run({ ei: 45 * h.bus.ffmActKg, eee: 0 }, 1);
      if (green < 0 && h.s.moodTier === 0) green = d;
    }
    expect(green).toBeGreaterThanOrEqual(0);
    expect(h.s.moodTier).toBe(0);
    expect(h.s.mEa).toBeGreaterThanOrEqual(0.85);
    expect(h.s.mEa).toBeGreaterThan(mEaAtContest);
  });
});

describe('19 V12 CALERIE-2 QoL (qualitative): 25 % CR for 2 y at EA_c ≥ 30 and BF above the leanness gate stays green', () => {
  it('mood tier 0 on every one of 730 days', () => {
    const p: PersonProfile = { schemaVersion: 1, body: { sex: 'female', ageYears: 38, heightCm: 165, weightKg: 68 }, startDate: '2026-10-05' };
    const h = makeHarness(p);
    const fm0 = h.bus.fatMassKg;
    const ffm = h.profile.ffm0Kg;
    let worst = 0;
    let minEaC = 999;
    for (let d = 0; d < 730; d++) {
      h.bus.fatMassKg = fm0 - 5.2 * Math.min(1, (d + 1) / 365); // −7.6 kg over 2 y, mostly year 1
      h.bus.ffmActKg = ffm;
      h.run({ ei: h.base.ei * 0.75 }, 1);
      worst = Math.max(worst, h.s.moodTier);
      minEaC = Math.min(minEaC, h.s.eaC);
    }
    expect(minEaC).toBeGreaterThanOrEqual(30);
    expect(worst).toBe(0);
    expect(h.s.mEa).toBe(1);
  });
});

describe('13 §4.10 keto-induction symptoms (Φ_ind)', () => {
  it('Φ peaks at Φ_max on Δt = τ_p = 2.5 d, with Φ_max = relative carbohydrate drop × (1 − 0.3·[Na ≥ 2 g/d])', () => {
    const h = makeHarness(MAN);
    const cPrev = h.base.carb;
    let peak = 0;
    let peakDay = -1;
    for (let d = 0; d < 20; d++) {
      h.run({ carb: 30, sodiumMg: 1500 }, 1);
      if (h.s.ketoInduction > peak) {
        peak = h.s.ketoInduction;
        peakDay = d;
      }
    }
    expect(h.s.phiMax).toBeCloseTo((cPrev - 30) / cPrev, 6);
    // τ_p = 2.5 d lies between the daily samples Δt = 2 and 3 d; Φ(3) = 0.982·Φ_max is the larger (x·e^{1−x}: 0.977 vs 0.982)
    expect(peakDay).toBe(3);
    expect(peak).toBeCloseTo(h.s.phiMax * 1.2 * Math.exp(-0.2), 9);
    expect(peak).toBeGreaterThan(0.97 * h.s.phiMax);
    expect(h.bus.ketoInduction).toBe(h.s.ketoInduction);
  });

  it('sodium ≥ 2 g/d mitigates Φ_max by 30 % (grade D)', () => {
    const a = makeHarness(MAN);
    a.run({ carb: 30, sodiumMg: 1500 }, 1);
    const b = makeHarness(MAN);
    b.run({ carb: 30, sodiumMg: 2500 }, 1);
    expect(b.s.phiMax / a.s.phiMax).toBeCloseTo(0.7, 10);
  });

  it('heavy tail: a latent quantile above 0.75 selects τ_p = 6 d (25 % of ensemble draws); nominal is 2.5 d', () => {
    const nominal = makeHarness(MAN);
    const heavy = makeHarness(MAN, { overrides: { 'wellbeing.ketoHeavyTailQuantile': 0.9 } });
    expect(nominal.k.ketoTau).toBe(2.5);
    expect(heavy.k.ketoTau).toBe(6);
    let peakDay = -1;
    let peak = 0;
    for (let d = 0; d < 30; d++) {
      heavy.run({ carb: 30 }, 1);
      if (heavy.s.ketoInduction > peak) {
        peak = heavy.s.ketoInduction;
        peakDay = d;
      }
    }
    expect(peakDay).toBe(6);
  });

  it('fast days and habitual very-low-carbohydrate eaters do not trigger induction', () => {
    const fast = makeHarness(MAN);
    fast.run({ fast: true, ei: 0, carb: 0, fat: 0, fibre: 0 }, 3);
    expect(fast.s.ketoInduction).toBe(0);
    expect(fast.s.inLowCarb).toBe(0);
    const keto = makeHarness({ ...MAN, habits: { habitualCarbPctEnergy: 5 } });
    keto.run({ carb: 30 }, 10);
    expect(keto.s.ketoInduction).toBe(0);
  });

  it('a carbohydrate refeed re-triggers a smaller Φ_max scaled by the refeed depth', () => {
    const h = makeHarness(MAN);
    h.run({ carb: 30, sodiumMg: 1500 }, 21); // first induction resolved
    const first = h.s.phiMax;
    h.run({ carb: 250, sodiumMg: 1500 }, 1); // refeed day (regime flag resets)
    h.run({ carb: 30, sodiumMg: 1500 }, 1);
    expect(h.s.phiMax).toBeGreaterThan(0);
    expect(h.s.phiMax).toBeLessThan(first);
    expect(h.s.ketoStartDay).toBe(h.dayIdx - 1);
  });

  // KNOWN MISS (reported): with τ_p = 2.5 d the dossier equation is still at 81 % of its peak on day 4.5 and falls to half
  // its peak only after 6.7 d, so "resolution" cannot occur at the Bostock median of 4.5 d under any definition of
  // resolution that needs the symptoms to be below their peak by more than 19 %. A τ_p of ≈ 1.7 d would be needed.
  it.fails('median induction resolution (fall to half of the peak) is 4.5 d ± 1 d', () => {
    const t = inductionDaysToFraction(0.5, 2.5); // 6.7 d
    expect(Math.abs(t - 4.5)).toBeLessThanOrEqual(1);
  });
});
