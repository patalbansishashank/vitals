/**
 * Module-level tests of `composition` driven directly with hand-built bus/day values (WP_BRIEF): energy conservation
 * (O-4 at module level), regime selection, fasting branch, explicit lean terms, SM split, N balance, overshoot memory,
 * regional/VAT, burn-in re-anchoring, properties (steady state, zero intake, bounds, determinism).
 */
import { describe, expect, it } from 'vitest';
import { compositionModule, REGIME_DEFICIT, REGIME_SURPLUS, REGIME_VLI, initialLeanTissue } from './index';
import { flatFlux, makeRig, mealFlux, PERSON_MAN, runDay, setIntake, type Rig } from './testHarness';
import { overshootGamma } from './partition';
import type { PersonProfile } from '../../types/profile';

const effF = 9441 + 179;
const effL = 1816 + 229;

function daysOf(r: Rig, n: number, flux: Parameters<typeof runDay>[1]) {
  let maxHour = 0;
  let maxDay = 0;
  for (let i = 0; i < n; i++) {
    const fm0 = r.s.fmKg;
    const lt0 = r.s.ltKg;
    const { sumS, sumDep, maxHourResid } = runDay(r, flux);
    maxHour = Math.max(maxHour, maxHourResid);
    // daily identity: EI − TEE(= teePre + dnl + deposition) − ΔE_gly − ketone = ρF·ΔFM + ρL·ΔLT
    const lhs = sumS - sumDep;
    const rhs = 9441 * (r.s.fmKg - fm0) + 1816 * (r.s.ltKg - lt0);
    maxDay = Math.max(maxDay, Math.abs(lhs - rhs));
  }
  return { maxHour, maxDay };
}

describe('O-4 energy conservation (module level)', () => {
  it('surplus, deficit, meal-shaped flux, explicit RT/age terms: hourly 1e-6 kcal, daily 1 kcal', () => {
    const r = makeRig({ ...PERSON_MAN, body: { ...PERSON_MAN.body, ageYears: 62 } });
    r.bus.rtAccretionKgD = 0.004;
    r.bus.rtVolumeWb = 8;
    r.bus.rtDoseFrac = 8 / 8.4; // V_R(62 y) = 8.4 sets/wk (09 §4.8)
    r.bus.rtRetentionFrac = 0.5;
    setIntake(r, 3200, 150);
    const a = daysOf(r, 10, mealFlux(3200, 2600));
    setIntake(r, 1800, 150);
    const b = daysOf(r, 20, mealFlux(1800, 2600));
    expect(Math.max(a.maxHour, b.maxHour)).toBeLessThan(1e-6);
    expect(Math.max(a.maxDay, b.maxDay)).toBeLessThan(1);
  });

  it('fasting branch with glycogen, ketone loss and DNL terms, then repletion: identities hold', () => {
    const r = makeRig();
    setIntake(r, 0, 0, 0);
    const fastFlux = flatFlux(0, 2400, (_h, bus) => {
      bus.fastActive = 1;
      bus.fastProtOxGH = 3.6;
      bus.ketoneLossKcalH = 1.5;
      bus.glycogenChangeKcalH = -6;
    });
    const a = daysOf(r, 7, fastFlux);
    setIntake(r, 2600, 120);
    const refeed = flatFlux(2600, 2500, (_h, bus) => {
      bus.fastActive = 0;
      bus.fastProtOxGH = 0;
      bus.fastRepletionGH = 1.0;
      bus.dnlHeatKcalH = 2;
      bus.glycogenChangeKcalH = 5;
    });
    const b = daysOf(r, 3, refeed);
    expect(Math.max(a.maxHour, b.maxHour)).toBeLessThan(1e-6);
    expect(Math.max(a.maxDay, b.maxDay)).toBeLessThan(1);
  });

  it('η is signed: a day whose hourly storage and mobilisation cancel books no net deposition cost (review B2)', () => {
    const r = makeRig();
    setIntake(r, 2600, 100);
    r.bus.tdeeEstKcalD = 2600;
    const fm0 = r.s.fmKg;
    const lt0 = r.s.ltKg;
    const { sumDep } = runDay(r, mealFlux(2600, 2600));
    expect(Math.abs(sumDep)).toBeLessThan(1e-9);
    expect(Math.abs(r.s.fmKg - fm0)).toBeLessThan(1e-12);
    expect(Math.abs(r.s.ltKg - lt0)).toBeLessThan(1e-12);
  });
});

describe('day plan: regime selection and energy-balance signals', () => {
  it('u and EB7 (trailing 7-day boxcar mean of the planned balance) from the planned intake vs TEE estimate', () => {
    const r = makeRig();
    r.bus.tdeeEstKcalD = 2500;
    setIntake(r, 2000, 120);
    compositionModule.startDay(r.s, r.k, r.bus, r.day, r.clock);
    expect(r.bus.energyBalanceFrac).toBeCloseTo(-0.2, 12);
    expect(r.bus.energyBalance7KcalD).toBeCloseTo(-500 / 7, 9);
    expect(r.s.regime).toBe(REGIME_DEFICIT);
    for (let i = 0; i < 6; i++) compositionModule.startDay(r.s, r.k, r.bus, r.day, r.clock);
    expect(r.bus.energyBalance7KcalD).toBeCloseTo(-500, 9);
    compositionModule.startDay(r.s, r.k, r.bus, r.day, r.clock);
    expect(r.bus.energyBalance7KcalD).toBeCloseTo(-500, 9); // window full: stays at the plan
  });

  it('EB7 is constant over a weekly-periodic plan (training/rest days), so p_E does not oscillate (review m20)', () => {
    const r = makeRig();
    const tee = [2800, 2500, 2800, 2500, 2800, 2500, 2500];
    setIntake(r, 2629, 120);
    const pE: number[] = [];
    const eb7: number[] = [];
    for (let d = 0; d < 28; d++) {
      r.bus.tdeeEstKcalD = tee[d % 7]!;
      compositionModule.startDay(r.s, r.k, r.bus, r.day, r.clock);
      if (d >= 7) {
        pE.push(r.s.pE);
        eb7.push(r.s.eb7);
      }
    }
    expect(Math.max(...eb7) - Math.min(...eb7)).toBeLessThan(1e-9);
    expect(Math.max(...pE) - Math.min(...pE)).toBeLessThan(1e-12);
  });

  it('surplus regime when EB7 ≥ 0; p_E from 11 r_L once EB7 ≥ W, blended with the 03 share over |EB7| < W (review m20)', () => {
    const r = makeRig();
    r.bus.tdeeEstKcalD = 2500;
    setIntake(r, 3000, 120);
    compositionModule.startDay(r.s, r.k, r.bus, r.day, r.clock);
    expect(r.s.regime).toBe(REGIME_SURPLUS);
    const w1 = 0.5 - 500 / 7 / (2 * r.k.partBlendKcalD);
    expect(r.s.pE).toBeCloseTo(w1 * r.s.pDef + (1 - w1) * r.s.pSur, 12);
    for (let i = 0; i < 6; i++) compositionModule.startDay(r.s, r.k, r.bus, r.day, r.clock);
    expect(r.s.eb7).toBeGreaterThan(r.k.partBlendKcalD);
    expect(r.s.rL).toBeGreaterThan(0.2);
    expect(r.s.pE).toBeCloseTo((r.s.rL * effL) / (effF + r.s.rL * effL), 12);
  });

  it('very-low-intake branch: EI < 30 % TEE, q < 0.3 g/kg FFM, protein ≥ 5 g', () => {
    const r = makeRig();
    r.bus.tdeeEstKcalD = 2500;
    setIntake(r, 400, 10, 80);
    compositionModule.startDay(r.s, r.k, r.bus, r.day, r.clock);
    expect(r.s.regime).toBe(REGIME_VLI);
    expect(r.s.vliLeanKgD).toBeLessThan(0);
    // protein < 5 g → not this branch (20's criteria); protein high → not this branch
    setIntake(r, 400, 2, 80);
    compositionModule.startDay(r.s, r.k, r.bus, r.day, r.clock);
    expect(r.s.regime).not.toBe(REGIME_VLI);
    setIntake(r, 400, 60, 30);
    compositionModule.startDay(r.s, r.k, r.bus, r.day, r.clock);
    expect(r.s.regime).not.toBe(REGIME_VLI);
  });

  it('VLI lean loss follows 03 §4.13: faster early, slower later; N balance ≈ −(Pox·FFM − 0.3·P)/6.25', () => {
    const r = makeRig();
    r.bus.tdeeEstKcalD = 2500;
    setIntake(r, 400, 10, 80);
    runDay(r, flatFlux(400, 2500));
    const n1 = r.s.nBalanceG;
    for (let i = 0; i < 9; i++) runDay(r, flatFlux(400, 2500));
    const n10 = r.s.nBalanceG;
    expect(n1).toBeLessThan(0);
    expect(n10).toBeGreaterThan(n1);
    const ffm = r.s.ffm0Kg;
    // day-1 N at t_f = 0 with 80 g carbohydrate sparing: Pox_0·(1 − 0.3·0.8) = 0.684 g/kg FFM
    expect(n1).toBeCloseTo(-(0.9 * (1 - 0.3 * 0.8) * ffm - 0.3 * 10) / 6.25, 1);
  });

  it('q excludes labile-pool repletion protein (24·fastRepletionGH, review M2)', () => {
    const r = makeRig();
    r.bus.tdeeEstKcalD = 2500;
    setIntake(r, 2000, 120);
    compositionModule.startDay(r.s, r.k, r.bus, r.day, r.clock);
    const pNo = r.s.pCat;
    const r2 = makeRig();
    r2.bus.tdeeEstKcalD = 2500;
    r2.bus.fastRepletionGH = 2; // 48 g/d
    setIntake(r2, 2000, 120);
    compositionModule.startDay(r2.s, r2.k, r2.bus, r2.day, r2.clock);
    expect(r2.s.pCat).toBeGreaterThan(pNo);
  });
});

describe('deficit partition in the module', () => {
  function deficitRun(proteinG: number, opts: { rtRet?: number; sleep?: number; aerobic?: number } = {}) {
    const r = makeRig();
    r.bus.tdeeEstKcalD = 2600;
    r.bus.rtRetentionFrac = opts.rtRet ?? 0;
    r.bus.partitionSleepShift = opts.sleep ?? 0;
    r.bus.aerobicIdx = opts.aerobic ?? 0;
    setIntake(r, 1600, proteinG);
    const lt0 = r.s.ltKg;
    const fm0 = r.s.fmKg;
    for (let i = 0; i < 28; i++) runDay(r, mealFlux(1600, 2600));
    return { dLT: r.s.ltKg - lt0, dFM: r.s.fmKg - fm0, r };
  }

  it('O-2 direction (Longland CON vs PRO, same energy): higher protein retains more lean tissue', () => {
    const con = deficitRun(96); // 1.2 g/kg
    const pro = deficitRun(192); // 2.4 g/kg
    expect(pro.dLT).toBeGreaterThan(con.dLT);
    expect(pro.dFM).toBeLessThan(con.dFM); // same energy → more of it from fat
  });

  it('RT retention (09 R_RT) scales the catabolic lean loss by (1 − R_RT)', () => {
    const a = deficitRun(120);
    const b = deficitRun(120, { rtRet: 0.75 });
    expect(b.dLT / a.dLT).toBeGreaterThan(0.2);
    expect(b.dLT / a.dLT).toBeLessThan(0.3);
  });

  it('sleep debt raises the lean share; aerobic activity lowers it', () => {
    const a = deficitRun(120);
    expect(deficitRun(120, { sleep: 0.09 }).dLT).toBeLessThan(a.dLT);
    expect(deficitRun(120, { aerobic: 1 }).dLT).toBeGreaterThan(a.dLT);
  });
});

describe('fasting branch per hour (review M7)', () => {
  it('fasting hours: ΔLT = −protOx·(1 + h_P)/1000 each hour; fat takes the residual at ρF + ηF', () => {
    const r = makeRig();
    setIntake(r, 0, 0, 0);
    r.bus.tdeeEstKcalD = 2400;
    const lt0 = r.s.ltKg;
    const fm0 = r.s.fmKg;
    runDay(r, flatFlux(0, 2400, (_h, bus) => {
      bus.fastActive = 1;
      bus.fastProtOxGH = 3.5;
    }));
    const dLt = -(3.5 * 24 * 2.6) / 1000;
    expect(r.s.ltKg - lt0).toBeCloseTo(dLt, 10);
    expect(r.s.fmKg - fm0).toBeCloseTo((-2400 - effL * dLt) / effF, 9);
    expect(r.s.fastProteinLostKg).toBeCloseTo(-dLt, 10);
  });

  it('mixed day: fraction branch in non-fasting hours, fasting branch in fasting hours', () => {
    const r = makeRig();
    r.bus.tdeeEstKcalD = 2400;
    setIntake(r, 1200, 80);
    const lt0 = r.s.ltKg;
    runDay(r, (h, bus) => {
      const fastH = h < 12;
      bus.fastActive = fastH ? 1 : 0;
      bus.fastProtOxGH = fastH ? 3 : 0;
      bus.eAbsKcalH = fastH ? 0 : 100;
      bus.teePreKcalH = 100;
      bus.dnlHeatKcalH = 0;
      bus.ketoneLossKcalH = 0;
      bus.glycogenChangeKcalH = 0;
    });
    // 12 fasting hours → −3·12·2.6 g; fed hours have S′ = 0 → no fraction change
    expect(r.s.ltKg - lt0).toBeCloseTo(-(3 * 12 * 2.6) / 1000, 10);
  });

  it('refeeding repletion is an explicit hourly lean gain fastRepletionGH·(1 + h_P)/1000 costing ρL + ηL', () => {
    const r = makeRig();
    r.bus.tdeeEstKcalD = 2400;
    setIntake(r, 2400, 120);
    r.s.fastProteinLostKg = 0.3;
    const lt0 = r.s.ltKg;
    runDay(r, flatFlux(2400, 2400, (_h, bus) => {
      bus.fastRepletionGH = 1.5;
    }));
    // S = 0: explicit repletion 1.5·24·2.6 g; fraction branch takes p_E of the negative S′ it leaves behind
    const rep = (1.5 * 24 * 2.6) / 1000;
    const sPrimeDay = -effL * rep;
    const expected = rep + (r.s.pE * sPrimeDay) / effL;
    expect(r.s.ltKg - lt0).toBeCloseTo(expected, 9);
    expect(r.s.fastProteinLostKg).toBeCloseTo(0.3 - rep, 10);
  });
});

describe('explicit lean terms, SM split, N balance, lean rate', () => {
  it('RT accretion enters LT 1:1 and SM at 0.7 (review M10); age drift −0.4 g/d at 65 y', () => {
    const r = makeRig({ ...PERSON_MAN, body: { ...PERSON_MAN.body, ageYears: 65 } });
    r.bus.ageYears = 65;
    r.bus.tdeeEstKcalD = 2400;
    r.bus.rtAccretionKgD = 0.01;
    setIntake(r, 2400, 120);
    const lt0 = r.s.ltKg;
    const sm0 = r.s.smKg;
    runDay(r, flatFlux(2400, 2400));
    const extra = 0.01 - 0.0004;
    const sPrime = -effL * extra; // explicit terms paid from S = 0
    const dLt = extra + (r.s.pE * sPrime) / effL;
    expect(r.s.ltKg - lt0).toBeCloseTo(dLt, 10);
    expect(r.s.smKg - sm0).toBeCloseTo(0.7 * 0.01 + 0.5 * (dLt - 0.01), 10);
    expect(r.s.nBalanceG).toBeCloseTo((dLt * 1000 * (1 / 2.6)) / 6.25, 8);
    expect(r.bus.leanRateKgD).toBeCloseTo(dLt, 10);
  });

  it('RT volume offsets the age drift: × (1 − 0.8·rtDoseFrac), rtDoseFrac = min(1, V_wb/V_R(age)) from muscle', () => {
    const r = makeRig({ ...PERSON_MAN, body: { ...PERSON_MAN.body, ageYears: 65 } });
    r.bus.ageYears = 65;
    r.bus.rtVolumeWb = 20;
    r.bus.rtDoseFrac = 1;
    setIntake(r, 2400, 120);
    compositionModule.startDay(r.s, r.k, r.bus, r.day, r.clock);
    expect(r.s.leanExtraKgD).toBeCloseTo(-0.0004 * 0.2, 12);
  });
});

describe('overshoot memory (11 §4.12)', () => {
  /** Lean man (10 % BF): 50 % deficit at 1 g/kg until 35 % fat depletion, then +800 kcal/d until FFM is restored. */
  function cycle(memory: boolean, skipEb7Lag: boolean) {
    const person: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 25, heightCm: 180, weightKg: 70 }, startDate: '2026-10-05' };
    const r = makeRig(person, { profile: { fm0Kg: 7, ffm0Kg: 63 } });
    const fmPre = r.s.fmKg;
    const ffmPre = r.s.ffm0Kg;
    r.bus.tdeeEstKcalD = 2600;
    setIntake(r, 1300, 70);
    let days = 0;
    while (r.s.depletionFrac < 0.35 && days < 400) {
      runDay(r, flatFlux(1300, 2600));
      days++;
    }
    const lostW = fmPre + ffmPre - r.bus.tissueMassKg;
    const res = { pmSS: r.s.pmSS, valid: r.s.osValid, dMax: r.s.depletionMax };
    if (!memory) r.s.osValid = 0;
    if (skipEb7Lag) {
      r.s.eb7Ring.fill(0); // isolate the regain rule from the EB7 regime lag
      r.s.eb7 = 0;
    }
    r.bus.tdeeEstKcalD = 2400;
    setIntake(r, 3200, 110);
    let guard = 0;
    let rLFirst = Number.NaN;
    while (r.bus.ffmActKg < ffmPre && guard < 800) {
      runDay(r, flatFlux(3200, 2400));
      if (Number.isNaN(rLFirst) && r.s.regime === REGIME_SURPLUS) rLFirst = r.s.rL;
      guard++;
    }
    return { r, overshoot: r.s.fmKg - fmPre, lostW, rLFirst, ...res };
  }

  it('Jacquet at module level: with the regain in the surplus regime, overshoot ≈ (γ − 1)·ΔW (±25 %)', () => {
    const a = cycle(true, true);
    expect(a.valid).toBe(1);
    expect(a.dMax).toBeGreaterThanOrEqual(0.3); // r = 1
    expect(a.pmSS).toBeGreaterThan(0.2);
    const gamma = overshootGamma(a.r.k, a.r.s.pctFatPre, 1);
    const pRF = a.pmSS / gamma;
    expect(a.rLFirst).toBeCloseTo(pRF / (1 - pRF), 2);
    const jacquet = (gamma - 1) * a.lostW;
    expect(Math.abs(a.overshoot - jacquet)).toBeLessThanOrEqual(0.25 * jacquet);
    expect(a.r.s.osValid).toBe(0); // deactivated once FFM is restored
  });

  it('full engine rule incl. the EB7 regime lag: overshoot is positive (reported, calibration item)', () => {
    const a = cycle(true, false);
    expect(a.overshoot).toBeGreaterThan(0);
  });

  it('memory ties the regain partition to the loss partition (P_RF = Pm_SS/γ) instead of the generic 11 rule', () => {
    const withMem = cycle(true, true);
    const noMem = cycle(false, true);
    // generic 11 r_L for a lean regainer is fat-heavier than 03's loss partition: without the memory the overshoot is larger
    expect(noMem.rLFirst).toBeLessThan(withMem.rLFirst);
    expect(noMem.overshoot).toBeGreaterThan(withMem.overshoot);
  });
});

describe('regional depots, VAT and waist (14 M7-M8 via the body module)', () => {
  function lossRun(regional: boolean) {
    const r = makeRig(PERSON_MAN, { regional });
    r.bus.tdeeEstKcalD = 2600;
    setIntake(r, 1800, 130);
    const vat0 = r.s.vatKg;
    const fm0 = r.s.fmKg;
    const waist0 = r.s.waistCm;
    for (let i = 0; i < 84; i++) runDay(r, flatFlux(1800, 2600));
    return { r, vat0, fm0, waist0 };
  }

  it('Σ regional fat = FM and log-log VAT slope ≈ 1.3 (14 V5: 1.29-1.34 → k in 1.2-1.4)', () => {
    const { r, vat0, fm0 } = lossRun(true);
    const f = r.s.regional.fat;
    expect(f.headKg + f.armsKg + f.legsKg + f.trunkSatKg + f.vatKg).toBeCloseTo(r.s.fmKg, 9);
    const k = Math.log(r.s.vatKg / vat0) / Math.log(r.s.fmKg / fm0);
    expect(k).toBeGreaterThan(1.2);
    expect(k).toBeLessThan(1.4);
    expect(r.bus.vatKg).toBe(r.s.vatKg);
  });

  it('allocation-free VAT fallback (regional off) follows the same allometry', () => {
    const on = lossRun(true);
    const off = lossRun(false);
    expect(off.r.s.vatKg).toBeCloseTo(on.r.s.vatKg, 1);
  });

  it('waist falls with fat loss (ψ = 0.83 hysteresis inside circumferencesFor)', () => {
    const { r, waist0 } = lossRun(true);
    expect(r.s.waistCm).toBeLessThan(waist0 - 2);
  });

  it('SM regional split keeps Σ = SM', () => {
    const { r } = lossRun(true);
    const m = r.s.regional.muscle;
    expect(m.armsKg + m.legsKg + m.trunkKg).toBeCloseTo(r.s.smKg, 9);
  });
});

describe('initialisation and burn-in', () => {
  it('t = 0: FM/FFM from the profile; LT0 = FFM0 − (1 + h)·G0/1000 (review m6)', () => {
    const r = makeRig();
    expect(r.bus.fatMassKg).toBe(r.profile.fm0Kg);
    expect(r.bus.ffmActKg).toBeCloseTo(r.profile.ffm0Kg, 12);
    expect(r.bus.tissueMassKg).toBeCloseTo(r.profile.fm0Kg + r.profile.ffm0Kg, 12);
    expect(r.s.lt0Kg).toBeCloseTo(r.profile.ffm0Kg - (4 * r.profile.body.glycogen.totalG) / 1000, 9);
    expect(initialLeanTissue(r.k, r.profile.ffm0Kg)).toBe(r.s.lt0Kg);
  });

  it('end of burn-in (day −1) re-anchors slow states to the entered body (review B3c)', () => {
    const r = makeRig();
    r.clock.day = -3;
    r.bus.tdeeEstKcalD = 2400;
    setIntake(r, 3000, 100);
    for (let i = 0; i < 3; i++) runDay(r, flatFlux(3000, 2400));
    expect(r.clock.day).toBe(0);
    expect(r.s.fmKg).toBe(r.profile.fm0Kg);
    expect(r.bus.tissueMassKg).toBeCloseTo(r.profile.fm0Kg + r.profile.ffm0Kg, 12);
    expect(r.s.fastProteinLostKg).toBe(0);
    expect(r.s.eb7).toBeGreaterThan(0); // fast state kept
  });
});

describe('properties', () => {
  it('maintenance for 30 simulated days stays steady (meal-shaped hours, age < 45)', () => {
    const r = makeRig();
    r.bus.tdeeEstKcalD = 2600;
    setIntake(r, 2600, 110);
    const fm0 = r.s.fmKg;
    const lt0 = r.s.ltKg;
    const sm0 = r.s.smKg;
    for (let i = 0; i < 30; i++) runDay(r, mealFlux(2600, 2600));
    expect(Math.abs(r.s.fmKg - fm0)).toBeLessThan(1e-9);
    expect(Math.abs(r.s.ltKg - lt0)).toBeLessThan(1e-9);
    expect(Math.abs(r.s.smKg - sm0)).toBeLessThan(1e-9);
  });

  it('zero intake for 21 days (fasting overlay): finite, monotone FM and LT, conservation holds', () => {
    const r = makeRig();
    setIntake(r, 0, 0, 0);
    r.bus.tdeeEstKcalD = 2300;
    let prevFm = r.s.fmKg;
    let prevLt = r.s.ltKg;
    for (let d = 0; d < 21; d++) {
      const { maxHourResid } = runDay(r, flatFlux(0, 2300 - 20 * d, (_h, bus) => {
        bus.fastActive = 1;
        bus.fastProtOxGH = 3.8 - 0.06 * d;
        bus.ketoneLossKcalH = 1.5;
      }));
      expect(maxHourResid).toBeLessThan(1e-6);
      expect(Number.isFinite(r.s.fmKg) && Number.isFinite(r.s.ltKg) && Number.isFinite(r.s.smKg)).toBe(true);
      expect(r.s.fmKg).toBeLessThan(prevFm);
      expect(r.s.ltKg).toBeLessThan(prevLt);
      prevFm = r.s.fmKg;
      prevLt = r.s.ltKg;
    }
  });

  it('zero intake without the fasting overlay (stub fasting) for 21 days stays finite and bounded', () => {
    const r = makeRig();
    setIntake(r, 0, 0, 0);
    r.bus.tdeeEstKcalD = 2300;
    for (let d = 0; d < 21; d++) runDay(r, flatFlux(0, 2300));
    expect(Number.isFinite(r.s.fmKg) && Number.isFinite(r.s.ltKg)).toBe(true);
    expect(r.s.fmKg).toBeGreaterThan(0);
    expect(r.s.ltKg).toBeGreaterThan(0);
  });

  it('smooth fat floor (review M9): a lean user in a 40-day fast never crosses FM_min, energy still conserved', () => {
    const person: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 25, heightCm: 180, weightKg: 70 }, startDate: '2026-10-05' };
    const r = makeRig(person, { profile: { fm0Kg: 5.6, ffm0Kg: 64.4 } });
    setIntake(r, 0, 0, 0);
    let maxResid = 0;
    let firstFloorDay = -1;
    for (let d = 0; d < 40; d++) {
      const { maxHourResid } = runDay(r, flatFlux(0, 2200, (_h, bus) => {
        bus.fastActive = 1;
        bus.fastProtOxGH = 2.6;
      }));
      maxResid = Math.max(maxResid, maxHourResid);
      expect(r.s.fmKg).toBeGreaterThan(r.s.fmMinKg);
      if (firstFloorDay < 0 && r.bus.fatFloorActive > 0) firstFloorDay = d;
    }
    expect(r.s.fmMinKg).toBeCloseTo(0.02 * 70, 9);
    expect(maxResid).toBeLessThan(1e-6);
    // the floor is reported through `fatFloorActive` = 1 − g (review M9); safety owns W-01-FATFLOOR and every safetyFlag
    expect(firstFloorDay).toBeGreaterThan(0);
    const g = (r.s.fmKg - r.s.fmMinKg) / r.k.fmFloorRampKg;
    expect(r.bus.fatFloorActive).toBeCloseTo(1 - Math.min(1, Math.max(0, g)), 2);
    expect(r.events.filter((e) => e[0] === 'safetyFlag')).toEqual([]);
    expect(r.s.fmKg).toBeLessThan(r.s.fmMinKg + 0.5);
  });

  it('bounds under an absurd 365-day deficit: FM ≥ 0, LT ≥ guard, no NaN', () => {
    const r = makeRig();
    setIntake(r, 500, 30);
    r.bus.tdeeEstKcalD = 3000;
    for (let d = 0; d < 365; d++) runDay(r, flatFlux(500, 3000));
    expect(r.s.fmKg).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(r.s.ltKg)).toBe(true);
    expect(r.s.ltKg).toBeGreaterThan(0);
  });

  it('determinism: identical inputs → bit-identical states', () => {
    const run = () => {
      const r = makeRig();
      r.bus.tdeeEstKcalD = 2600;
      setIntake(r, 2000, 140);
      for (let i = 0; i < 20; i++) runDay(r, mealFlux(2000, 2600));
      setIntake(r, 3000, 140);
      for (let i = 0; i < 20; i++) runDay(r, mealFlux(3000, 2600));
      return [r.s.fmKg, r.s.ltKg, r.s.smKg, r.s.vatKg, r.s.waistCm];
    };
    expect(run()).toEqual(run());
  });

  it('state survives structuredClone (snapshot contract)', () => {
    const r = makeRig();
    const c = structuredClone(r.s);
    expect(c.fmKg).toBe(r.s.fmKg);
    expect(c.regional.fat.vatKg).toBe(r.s.regional.fat.vatKg);
  });
});
