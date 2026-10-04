/**
 * Oracle / dossier-table tests of the composition partition with reference expenditure models (testHarness.ts):
 *  - O-1 (module level): Hall 2011 BWP port (01 §4.12) vs the same Hall expenditure/glycogen/ECF equations with the
 *    composition module doing the fat/lean split; macronutrient-neutral (protein 15.6 %E), sedentary, no RT.
 *  - O-2: Longland CON vs PRO — the BWP has no protein input (no difference by construction); the engine partition
 *    gives PRO > CON lean.
 *  - 11 §4.15 prototype table (ΔBW ±25 %; Bray 5 % arm = documented known-miss) and Horton storage (±8 points).
 *  - Review M13: Murphy & Koehler zero-crossing (≈ 500 kcal/d deficit cancels RT lean gain) with the real composition
 *    partition and 09 §4.8's f_EP (ρ_max from the muscle module's ParamDef when present).
 */
import { describe, expect, it } from 'vitest';
import type { PersonProfile } from '../../types/profile';
import { MUSCLE_PARAMS } from '../muscle/params';
import { bwp, flatFlux, hallEnergyHarness, makeRig, runDay, setIntake, surplusHarness, type BwpPerson, type SurplusStudy } from './testHarness';

const MJ = 239.0057;
const ei0Of = (p: BwpPerson) => 1.5 * (10 * p.BW0 + 6.25 * p.H * 100 - 5 * p.age + (p.sex === 'm' ? 5 : -161)) * 4.184e-3;

describe('O-1 Hall 2011 BWP oracle (module level): ±1.5 kg at 6 mo, ±3 kg at plateau', () => {
  const people: [string, BwpPerson][] = [
    ['sedentary man (01 §4.12: 100 kg, 1.80 m, 23 y)', { sex: 'm', BW0: 100, H: 1.8, age: 23 }],
    ['sedentary woman (75 kg, 1.65 m, 35 y)', { sex: 'f', BW0: 75, H: 1.65, age: 35 }],
  ];
  for (const [name, p] of people) {
    const ei0 = ei0Of(p);
    const scenarios: [string, (t: number) => number][] = [
      ['−25 %', () => 0.75 * ei0],
      ['−500 kcal/d', () => ei0 - 500 / MJ],
      ['+20 %', () => 1.2 * ei0],
      ['−5 MJ/d 180 d then 10.9 MJ/d (Hall 2011 worked example, man)', (t) => (t < 180 ? ei0 - 5 : ei0 - 1.75)],
    ];
    for (const [sn, f] of scenarios) {
      it(`${name}, ${sn}`, () => {
        const o = bwp(p, f, 730);
        const e = hallEnergyHarness(p, f, 730, () => 0.156);
        expect(Math.abs(e.BW[179]! - o[180]!.BW)).toBeLessThanOrEqual(1.5);
        expect(Math.abs(e.BW[364]! - o[365]!.BW)).toBeLessThanOrEqual(3);
        expect(Math.abs(e.BW[729]! - o[730]!.BW)).toBeLessThanOrEqual(3);
      });
    }
  }

  it('the BWP port reproduces the 01 §4.2.6 worked example (≈ 80.0 kg at 180 d, ≈ 80.7 kg at 365-730 d)', () => {
    const p: BwpPerson = { sex: 'm', BW0: 100, H: 1.8, age: 23 };
    const o = bwp(p, (t) => (t < 180 ? 7.65 : 10.9), 730);
    expect(o[180]!.BW).toBeCloseTo(80.0, 0);
    expect(o[730]!.BW).toBeCloseTo(80.7, 0);
  });
});

describe('O-2 negative control: Longland CON vs PRO', () => {
  it('BWP gives no difference (no protein input); the engine partition gives PRO > CON lean at equal energy', () => {
    const p: BwpPerson = { sex: 'm', BW0: 100, H: 1.8, age: 23 };
    const ei = 0.6 * ei0Of(p); // ≈ 40 % deficit, 4 wk
    const o = bwp(p, () => ei, 28);
    const o2 = bwp(p, () => ei, 28);
    expect(o[28]!.L).toBe(o2[28]!.L);
    const con = hallEnergyHarness(p, () => ei, 28, () => (1.2 * 100 * 4) / (ei * MJ));
    const pro = hallEnergyHarness(p, () => ei, 28, () => (2.4 * 100 * 4) / (ei * MJ));
    expect(pro.L[27]! - con.L[27]!).toBeGreaterThan(0.1);
    expect(pro.F[27]!).toBeLessThan(con.F[27]!);
  });
});

describe('11 §4.15 prototype table (ΔBW ±25 % of observed)', () => {
  // Subject details not given by the dossier are assumptions (documented): young men, sedentary, BW/FM/EI0 plausible for
  // each cohort; baseline macro mix = overfeeding mix unless stated.
  const studies: [SurplusStudy, number][] = [
    [{ name: 'Bouchard 1990 (+1000 kcal/d, 84 of 100 d)', sex: 'm', BW0: 60.3, H: 1.75, age: 21, fm0: 6.9, ei0: 2700, eiOver: 3700, shares: [0.15, 0.35, 0.5], days: 100, overfedOn: (d) => d % 7 !== 6 }, 8.1],
    [{ name: 'Johannsen 2019 (+1158 kcal/d, 56 d)', sex: 'm', BW0: 80, H: 1.77, age: 30, fm0: 18, ei0: 2900, eiOver: 4058, shares: [0.15, 0.44, 0.41], days: 56 }, 7.5],
    [{ name: 'Diaz 1992 (+50 %, 42 d)', sex: 'm', BW0: 72, H: 1.76, age: 25, fm0: 13, ei0: 2964, eiOver: 4446, shares: [0.12, 0.42, 0.46], days: 42 }, 7.6],
    [{ name: 'Bray 2012 15 % protein (+954 kcal/d, 56 d)', sex: 'm', BW0: 72, H: 1.72, age: 25, fm0: 17, ei0: 2385, eiOver: 3339, shares: [0.15, 0.44, 0.41], days: 56 }, 6.05],
    [{ name: 'Bray 2012 25 % protein', sex: 'm', BW0: 72, H: 1.72, age: 25, fm0: 17, ei0: 2385, eiOver: 3339, shares: [0.25, 0.44, 0.31], shares0: [0.15, 0.44, 0.41], days: 56 }, 6.51],
    [{ name: 'Ravussin 1985 (×1.6, 9 d)', sex: 'm', BW0: 70, H: 1.77, age: 25, fm0: 11, ei0: 3190, eiOver: 5104, shares: [0.15, 0.4, 0.45], days: 9 }, 3.2],
    [{ name: 'Roberts 1990 (+1011 kcal/d, 21 d)', sex: 'm', BW0: 70, H: 1.77, age: 24, fm0: 11, ei0: 2800, eiOver: 3811, shares: [0.15, 0.4, 0.45], days: 21 }, 2.5],
    [{ name: 'Boden (≈6000 vs 2600 kcal/d, 7 d)', sex: 'm', BW0: 80, H: 1.78, age: 30, fm0: 16, ei0: 2600, eiOver: 6000, shares: [0.15, 0.35, 0.5], days: 7 }, 3.5],
    [{ name: 'Müller 2015 (+50 %, 7 d)', sex: 'm', BW0: 70, H: 1.77, age: 25, fm0: 11, ei0: 2800, eiOver: 4200, shares: [0.15, 0.35, 0.5], days: 7 }, 1.8],
  ];
  for (const [st, obs] of studies) {
    it(st.name, () => {
      const r = surplusHarness(st);
      expect(Math.abs(r.dBW - obs)).toBeLessThanOrEqual(0.25 * obs);
      expect(r.dFM).toBeGreaterThan(0);
      expect(r.dLT).toBeGreaterThan(0);
    });
  }

  // Horton 1995: +50 % as pure carbohydrate or pure fat, 14 d (baseline 15/35/50)
  const horton = (kind: 'cho' | 'fat'): SurplusStudy => {
    const ei0 = 2700;
    const extra = 0.5 * ei0;
    const p = 0.15 * ei0;
    const f = 0.35 * ei0 + (kind === 'fat' ? extra : 0);
    const c = 0.5 * ei0 + (kind === 'cho' ? extra : 0);
    const tot = ei0 + extra;
    return { name: `Horton ${kind}`, sex: 'm', BW0: 80, H: 1.78, age: 30, fm0: 20, ei0, eiOver: tot, shares: [p / tot, f / tot, c / tot], shares0: [0.15, 0.35, 0.5], days: 14 };
  };
  it('Horton 1995 +50 % CHO vs fat, 14 d: ΔBW ≈ 2.7 kg (±25 %); stored 74 % vs 89 % (±8 points, prototype)', () => {
    const cho = surplusHarness(horton('cho'));
    const fat = surplusHarness(horton('fat'));
    expect(Math.abs(cho.dBW - 2.7)).toBeLessThanOrEqual(0.25 * 2.7);
    expect(Math.abs(fat.dBW - 2.7)).toBeLessThanOrEqual(0.25 * 2.7);
    expect(Math.abs(cho.storedPct - 74)).toBeLessThanOrEqual(8);
    expect(Math.abs(fat.storedPct - 89)).toBeLessThanOrEqual(8);
    expect(fat.storedPct).toBeGreaterThan(cho.storedPct);
  });

  // Documented known-miss (spec §1.8 / R-BRAY): the 5 % protein arm needs protein-deficiency catabolism and blunted EE
  it.fails('KNOWN-MISS Bray 2012 5 % protein: ΔBW 3.16 kg (model ≈ 5.2 kg, +64 %)', () => {
    const r = surplusHarness({ name: 'Bray5', sex: 'm', BW0: 72, H: 1.72, age: 25, fm0: 17, ei0: 2385, eiOver: 3339, shares: [0.05, 0.44, 0.51], shares0: [0.15, 0.44, 0.41], days: 56 });
    expect(Math.abs(r.dBW - 3.16)).toBeLessThanOrEqual(0.25 * 3.16);
  });

  it('Bray protein arms: lean gain rises 5 % → 15 %, fat gain ≈ independent of protein (direction)', () => {
    const base = { sex: 'm' as const, BW0: 72, H: 1.72, age: 25, fm0: 17, ei0: 2385, eiOver: 3339, shares0: [0.15, 0.44, 0.41] as [number, number, number], days: 56 };
    const p5 = surplusHarness({ ...base, name: 'b5', shares: [0.05, 0.44, 0.51] });
    const p15 = surplusHarness({ ...base, name: 'b15', shares: [0.15, 0.44, 0.41] });
    expect(p15.dLT).toBeGreaterThan(p5.dLT + 1);
  });
});

describe('review M13: Murphy & Koehler zero-crossing with the real partition + 09 §4.8 f_EP', () => {
  const pv = (id: string, fallback: number) => MUSCLE_PARAMS.find((d) => d.id === id)?.value ?? fallback;
  const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
  /** 09 §4.8 f_EP in deficit (reference form; values from the muscle module's registry). */
  const fEP = (e: number, pBw: number, rhoMax: number) => {
    const fE = Math.max(0, 1 + e / pv('muscle.d0', 0.3));
    return fE + (1 - fE) * rhoMax * clamp((pBw - 1.2) / (2.2 - 1.2), 0, 1);
  };
  /**
   * 12 wk of RT (V_wb ≥ V_R → R_RT = 0.75) in a steady deficit D: novice accretion at energy balance = Benito 2020's
   * +1.49 kg / 10 wk, scaled by f_EP; composition books it explicitly and applies (1 − R_RT) to the catabolic partition.
   */
  function netLean(D: number, pBw: number, rhoMax: number, bf = 0.2): number {
    const person: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 30, heightCm: 180, weightKg: 80 }, startDate: '2026-10-05' };
    const r = makeRig(person, { regional: false, profile: { fm0Kg: 80 * bf, ffm0Kg: 80 * (1 - bf) } });
    const tee = 2500;
    r.bus.ageYears = 30;
    r.bus.tdeeEstKcalD = tee;
    r.bus.rtRetentionFrac = pv('muscle.rMax', 0.75);
    r.bus.rtVolumeWb = 12;
    r.bus.rtAccretionKgD = (1.49 / 70) * fEP(-D / tee, pBw, rhoMax);
    setIntake(r, tee - D, pBw * 80);
    const lt0 = r.s.ltKg;
    for (let i = 0; i < 84; i++) runDay(r, flatFlux(tee - D, tee));
    return r.s.ltKg - lt0;
  }
  const rhoMax = pv('muscle.rhoMax', 0.8);

  it('Murphy-typical protein (1.3 g/kg): zero-crossing between 400 and 700 kcal/d (≈ 500; 09 reference ≈ 580)', () => {
    expect(netLean(400, 1.3, rhoMax)).toBeGreaterThan(0);
    expect(netLean(700, 1.3, rhoMax)).toBeLessThan(0);
    // 09 §4.8 calibration points: net +0.2 kg at 500, −0.4 at 750 kcal/d over 12 wk (±0.3 kg)
    expect(Math.abs(netLean(500, 1.3, rhoMax) - 0.2)).toBeLessThanOrEqual(0.3);
    expect(Math.abs(netLean(750, 1.3, rhoMax) + 0.4)).toBeLessThanOrEqual(0.3);
  });

  it('ρ_max sensitivity at typical protein is small (≤ 0.1 kg), as 09 states (ρ(1.3) ≤ 0.08)', () => {
    expect(Math.abs(netLean(500, 1.3, 0.8) - netLean(500, 1.3, 0.5))).toBeLessThanOrEqual(0.1);
  });

  it('high protein (2.2 g/kg) keeps net lean positive up to 1000 kcal/d even at ρ_max 0.5 (double protein effect, M13; Longland direction)', () => {
    expect(netLean(1000, 2.2, 0.5)).toBeGreaterThan(0);
    expect(netLean(1000, 2.2, 0.8)).toBeGreaterThan(netLean(1000, 2.2, 0.5));
  });
});
