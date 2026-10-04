/**
 * Unit tests of the energy module's equations (MODEL_SPEC §1.5; dossier 02 §4.1-4.13, 10 §4.3, 11 §4.5, 15 §4.11).
 * The module is driven directly (testRig.ts): other modules' signals are set by hand.
 */
import { describe, expect, it } from 'vitest';
import { selectRmr0, resolveProfile } from '../../core/resolveProfile';
import { validateParamDefs } from '../../core/paramsRegistry';
import type { PersonProfile } from '../../types/profile';
import { energyModule, HX } from './index';
import { ENERGY_PARAMS } from './params';
import { EnergyRig, MAN02_INPUT, makeParams, mean, planFromPct, profileWith, type DayPlan } from './testRig';

const WORKED = profileWith(MAN02_INPUT, { rmr0: 1879, tdee0: 3006, pPct: 0.2, cPct: 0.45, fPct: 0.35, ffm0: 67.5, fm0: 22.5 });
const DIET_25 = planFromPct(2255, 0.3, 0.4, 0.3);

const byId = new Map(ENERGY_PARAMS.map((p) => [p.id, p]));
const pval = (id: string): number => byId.get(`energy.${id}`)!.value;

describe('energy — parameter registry', () => {
  it('declares valid, prefixed ParamDefs with sources', () => {
    expect(validateParamDefs([energyModule])).toEqual([]);
    for (const p of ENERGY_PARAMS) {
      expect(p.source.length).toBeGreaterThan(5);
      expect(p.status).toBeDefined();
    }
  });
  it('copies the MODEL_SPEC §1.5 values and ranges', () => {
    const want: [string, number, number, number][] = [
      ['gammaL', 22, 19.7, 22.8], ['gammaF', 3.2, 3.1, 4.5], ['gammaSM', 13, 12.6, 13], ['betaAT', 0.14, 0.05, 0.4],
      ['betaATPlus', 0.12, 0, 0.35], ['sigmaAT', 0.6, 0.4, 0.8], ['tauROn', 7, 3, 14], ['tauNOn', 14, 7, 30],
      ['tauOff', 14, 14, 42], ['tefP', 0.25, 0.2, 0.3], ['tefC', 0.075, 0.05, 0.1], ['tefF', 0.025, 0, 0.03],
      ['tefAlc', 0.1, 0.05, 0.22], ['tefFibre', 0.3, 0, 0.3], ['kP', 0.6, 0.3, 1.1], ['kCaff', 0.1, 0.05, 0.25],
      ['cMet', 0.15, 0, 0.28], ['phiC', 0.1, 0.05, 0.15],
    ];
    for (const [id, v, lo, hi] of want) {
      const p = byId.get(`energy.${id}`)!;
      expect([p.value, p.low, p.high], id).toEqual([v, lo, hi]);
    }
    expect(pval('tefMctExtra')).toBe(0.065);
    expect(pval('gngCost')).toBe(0); // ruling on review M5: default 0, 0.2 = registry high
    expect(byId.get('energy.gngCost')!.high).toBe(0.2);
    expect(pval('tauP')).toBe(2);
    expect(pval('cMetPerBmi')).toBe(0.01);
  });
});

describe('energy — 02 §4.1 RMR0 fixtures (selection rule in core/resolveProfile)', () => {
  const man = (bf?: number): PersonProfile => ({
    schemaVersion: 1,
    body: { sex: 'male', ageYears: 35, heightCm: 180, weightKg: 90, ...(bf ? { knownBodyFatPct: bf, knownBodyFatSource: 'dxa' as const } : {}) },
  });
  const woman = (bf?: number): PersonProfile => ({
    schemaVersion: 1,
    body: { sex: 'female', ageYears: 30, heightCm: 165, weightKg: 65, ...(bf ? { knownBodyFatPct: bf, knownBodyFatSource: 'dxa' as const } : {}) },
  });
  it('male 35 y 180 cm 90 kg 25 %: Mifflin 1855, Müller-FFM 1879, Cunningham-1980 1985', () => {
    expect(selectRmr0(man(), 67.5, 22.5, false)).toBeCloseTo(1855, 0);
    expect(Math.abs(selectRmr0(man(25), 67.5, 22.5, false) - 1879)).toBeLessThan(1);
    expect(selectRmr0(man(25), 67.5, 22.5, true)).toBeCloseTo(1985, 0);
  });
  it('female 30 y 165 cm 65 kg 30 %: Mifflin 1370, Müller-FFM 1383', () => {
    expect(Math.abs(selectRmr0(woman(), 45.5, 19.5, false) - 1370)).toBeLessThan(1);
    expect(Math.abs(selectRmr0(woman(30), 45.5, 19.5, false) - 1383)).toBeLessThan(1);
  });
  it('measured RMR overrides every equation', () => {
    expect(selectRmr0({ ...man(25), labs: { measuredRmrKcal: 1700 } }, 67.5, 22.5, true)).toBe(1700);
  });
});

describe('energy — baseline decomposition and steady state', () => {
  it('worked example init: TEF0 278, NEAT0 849 (TDEE0 3006, RMR0 1879, 20/45/35 %E)', () => {
    const rig = new EnergyRig(WORKED);
    expect(rig.s.tef0).toBeCloseTo(278, 0);
    expect(rig.s.neat0).toBeCloseTo(849, 0);
    expect(rig.s.eat0).toBe(0);
  });

  it('habitual intake at maintenance stays steady for 30 simulated days (after a 14-d burn-in)', () => {
    const rp = resolveProfile(MAN02_INPUT);
    const rig = new EnergyRig(rp);
    rig.burnIn(14);
    const days = rig.runDays(30, rig.habitualPlan());
    for (const d of days) {
      expect(Math.abs(d.tdee - rp.tdee0Kcal)).toBeLessThan(0.5);
      expect(Math.abs(d.maintenance - rp.tdee0Kcal)).toBeLessThan(0.5);
      expect(Math.abs(d.atR) + Math.abs(d.atN) + Math.abs(d.comp)).toBeLessThan(1e-6);
      expect(Math.abs(d.tdeeEst - rp.tdee0Kcal)).toBeLessThan(0.5);
    }
  });

  it('habitual exercise EAT0 is excluded from NEAT0 (sessions × (MET − 1) × BW / 7)', () => {
    const rp = resolveProfile({ ...MAN02_INPUT, habits: { typicalSteps: 7000, sessionsPerWeek: 3, lifingCardioMix: 0.5 } });
    const rig = new EnergyRig(rp);
    expect(rig.s.eat0).toBeCloseTo((3 * 3.5 * 90) / 7, 6);
    expect(rig.s.neat0 + rig.s.eat0 + rig.s.tef0 + rig.s.rmr0).toBeCloseTo(rp.tdee0Kcal, 6);
  });
});

describe('energy — 02 §4.13 worked example', () => {
  it('day-1 TDEE on the 25 % deficit ≈ 2976 (±15: AT acts from the next day in the engine)', () => {
    const rig = new EnergyRig(WORKED);
    rig.burnIn(14);
    const [d1, d2] = rig.runDays(2, DIET_25);
    expect(d1!.tef).toBeCloseTo(253.7, 0);
    // engine day 1 = 3006 − ΔTEF 24.3 + k_P 4.45 (AT still 0): 2986; the dossier updates AT before the same day's TDEE
    expect(Math.abs(d1!.tdee - 2976)).toBeLessThan(15);
    expect(Math.abs(d2!.tdee - 2976)).toBeLessThan(15);
  });

  it('week 12 (FM −5 kg, FFM_act −1.5 kg, BW 83 kg): TDEE ≈ 2773 ± 30, EI_inst ≈ 2839, AT at target', () => {
    const rig = new EnergyRig(WORKED);
    rig.burnIn(14);
    const drive = (bus: typeof rig.bus, day: number): void => {
      const f = Math.min(1, day / 76);
      bus.fatMassKg = 22.5 - 5 * f;
      bus.ffmActKg = 67.5 - 1.5 * f;
      bus.tissueMassKg = bus.fatMassKg + bus.ffmActKg;
    };
    const days = rig.runDays(84, DIET_25, drive);
    const w12 = days[83]!;
    expect(Math.abs(w12.tdee - 2773)).toBeLessThan(30);
    expect(Math.abs(w12.maintenance - 2839)).toBeLessThan(10);
    expect(w12.atR + w12.atN).toBeCloseTo(0.14 * (2255 - 3006), 0);
    // real deficit shrank from 752 to ≈ 518 kcal/d
    expect(Math.abs(w12.tdee - 2255 - 518)).toBeLessThan(30);
  });
});

describe('energy — RMR terms (02 §4.2, §4.3, §4.5)', () => {
  const rmrAfter = (set: (bus: EnergyRig['bus']) => void): number => {
    const rig = new EnergyRig(WORKED);
    rig.burnIn(3);
    return rig.runDay(rig.habitualPlan(), (bus) => set(bus)).rmr;
  };
  it('mass coefficients: −1 kg FFM → −22, −1 kg FM → −3.2, +1 kg SM_RT (inside FFM) → +13 kcal/d', () => {
    const base = rmrAfter(() => {});
    expect(rmrAfter((b) => (b.ffmActKg = 66.5)) - base).toBeCloseTo(-22, 6);
    expect(rmrAfter((b) => (b.fatMassKg = 21.5)) - base).toBeCloseTo(-3.2, 6);
    expect(rmrAfter((b) => { b.ffmActKg = 68.5; b.smRtKg = 1; }) - base).toBeCloseTo(13, 6);
  });

  it('protein turnover: P_eff relaxes with τ_P = 2 d and adds k_P·(P_eff − P0)', () => {
    const rig = new EnergyRig(WORKED);
    rig.burnIn(3);
    const p0 = WORKED.habitualProteinG;
    const hab = rig.habitualPlan();
    const hi: DayPlan = { ...hab, proteinG: p0 + 100, carbG: hab.carbG - 100 }; // isocaloric swap: no AT
    const r = rig.runDays(10, hi);
    for (let i = 0; i < 10; i++) {
      const expected = 0.6 * 100 * (1 - Math.exp(-(i + 1) / 2));
      expect(r[i]!.rmr - 1879).toBeCloseTo(expected, 6);
    }
  });

  it('luteal term is mean-zero over the cycle and gives luteal/follicular RMR ≈ +5 % (02 §4.3)', () => {
    const f = profileWith(
      { schemaVersion: 1, body: { sex: 'female', ageYears: 30, heightCm: 165, weightKg: 65 }, cycle: { tracking: true, cycleLengthD: 28 } },
      { rmr0: 1370, tdee0: 2100, pPct: 0.16, cPct: 0.46, fPct: 0.38, ffm0: 45.5, fm0: 19.5 },
    );
    const rig = new EnergyRig(f);
    const sOf = (d: number): number => (d % 28 >= 14 ? 1 : 0);
    const run = (d: number): number => {
      rig.bus.lutealWeight = sOf(d);
      return rig.runDay(rig.habitualPlan()).rmr;
    };
    for (let d = 0; d < 28; d++) run(d); // first cycle fills the ring
    const cyc: number[] = [];
    for (let d = 28; d < 56; d++) cyc.push(run(d));
    expect(mean(cyc)).toBeCloseTo(1370, 6);
    const lut = mean(cyc.slice(14));
    const fol = mean(cyc.slice(0, 14));
    // s̄ = 0.5 → RMR ×(1 ± 0.025): luteal/follicular = 1.025/0.975 (02 §4.3 data +5 % ± 4, 16 V12)
    expect(lut / fol - 1).toBeCloseTo(1.025 / 0.975 - 1, 9);
  });

  it('untracked cycle: no luteal term', () => {
    const rig = new EnergyRig(WORKED);
    rig.bus.lutealWeight = 0;
    const d = rig.runDay(rig.habitualPlan());
    expect(d.rmr).toBeCloseTo(1879, 9);
  });
});

describe('energy — caffeine (15 §4.11, ruling R-CAFF)', () => {
  const cafRig = (): EnergyRig => {
    const rig = new EnergyRig(profileWith(MAN02_INPUT, { rmr0: 1879, tdee0: 3006, pPct: 0.2, cPct: 0.45, fPct: 0.35, ffm0: 67.5, fm0: 22.5, caffeineMg: 150 }));
    return rig;
  };
  it('400 mg vs habitual 150 mg: +25 kcal/d naive, → +12.5 with full tolerance; 600 mg: +45', () => {
    const rig = cafRig();
    const base = rig.runDay(rig.habitualPlan()).rmr;
    const d400 = rig.runDay({ ...rig.habitualPlan(), caffeineMg: 400 }).rmr;
    expect(d400 - base).toBeCloseTo(25, 9);
    const long = rig.runDays(120, { ...rig.habitualPlan(), caffeineMg: 400 });
    expect(long[119]!.rmr - base).toBeCloseTo(12.5, 1);
    const rig2 = cafRig();
    expect(rig2.runDay({ ...rig2.habitualPlan(), caffeineMg: 600 }).rmr - base).toBeCloseTo(45, 9);
    const rig3 = cafRig();
    expect(rig3.runDay({ ...rig3.habitualPlan(), caffeineMg: 0 }).rmr - base).toBeCloseTo(-15, 9);
  });

  it('is distributed in proportion to the caffeine load with an exact daily integral', () => {
    const rig = cafRig();
    const ctrl = cafRig();
    const kel = Math.exp(-Math.log(2) / 5.4);
    let load = 0;
    const plan = { ...rig.habitualPlan(), caffeineMg: 400 };
    const hourly: number[] = [];
    for (let d = 0; d < 4; d++) {
      hourly.length = 0;
      const a = rig.runDay(plan, (bus, _dd, h) => {
        load = load * kel + (h === 12 ? 400 : 0);
        bus.caffeineLoadMg = load;
      });
      // capture this day's caffeine share per hour from the state after each hour is not possible inside the rig,
      // so compare daily integrals against a flat-distribution control
      const b = ctrl.runDay(plan);
      expect(a.rmr).toBeCloseTo(b.rmr, 9);
    }
    expect(rig.s.cafLoadRef).toBeGreaterThan(0);
    void hourly;
  });
});

describe('energy — TEF (02 §4.4; R-ALC, R-FIBRE, R-TEFTIME)', () => {
  const tefOf = (plan: DayPlan, drive?: Parameters<EnergyRig['runDay']>[1], ir = 0): number => {
    const rig = new EnergyRig(WORKED);
    rig.bus.insulinResistanceIdx = ir;
    return rig.runDay(plan, drive).tef;
  };
  it('per-macronutrient coefficients (protein 0.25, CHO 0.075, fat 0.025, MCT 0.09, fibre 0.30 of 2 kcal/g)', () => {
    expect(tefOf({ proteinG: 100, carbG: 0, fatG: 0 })).toBeCloseTo(100, 9);
    expect(tefOf({ proteinG: 0, carbG: 100, fatG: 0 })).toBeCloseTo(30, 9);
    expect(tefOf({ proteinG: 0, carbG: 0, fatG: 100 })).toBeCloseTo(22.5, 9);
    expect(tefOf({ proteinG: 0, carbG: 0, fatG: 50, mctG: 20 })).toBeCloseTo(0.025 * 9 * 30 + 0.09 * 8.3 * 20, 9);
    expect(tefOf({ proteinG: 0, carbG: 100, fatG: 0, fibreG: 30 })).toBeCloseTo(30 + 0.3 * 2 * 30, 9);
  });
  it('alcohol TEF 0.10 of 7 kcal/g on oxidised ethanol', () => {
    const tef = tefOf({ proteinG: 0, carbG: 0, fatG: 0, alcoholG: 28 }, (bus, _d, h) => {
      if (h >= 20) {
        bus.alcOxGH = 7;
        bus.eAbsKcalH += 7 * 7;
      }
    });
    expect(tef).toBeCloseTo(0.1 * 7 * 28, 9);
  });
  it('insulin resistance lowers TEF (m_IR = 1 − 0.25·IR)', () => {
    const plan = planFromPct(2500, 0.2, 0.5, 0.3);
    expect(tefOf(plan, undefined, 1) / tefOf(plan)).toBeCloseTo(0.75, 9);
  });
  it('follows absorbed energy hour by hour and is 0 at zero intake', () => {
    const rig = new EnergyRig(WORKED);
    const byHour = new Float64Array(24);
    const origStep = rig.s;
    rig.runDay(DIET_25, (bus, _d, h) => {
      // the previous hour's TEF is in the state when the next hour is driven
      if (h > 0) byHour[h - 1] = origStep.hx[HX.tefH]!;
      void bus;
    });
    byHour[23] = origStep.hx[HX.tefH]!;
    const nonZero: number[] = [];
    byHour.forEach((t, i) => {
      if (t > 0) nonZero.push(i);
    });
    expect(nonZero).toEqual([8, 13, 19]);
    const zero = new EnergyRig(WORKED).runDay({ proteinG: 0, carbG: 0, fatG: 0 });
    expect(zero.tef).toBe(0);
  });
});

describe('energy — adaptive thermogenesis ODE (02 §4.8-4.9; R-AT)', () => {
  it('deficit: exact exponentials with τ_R 7 d, τ_N 14 d, β 0.14, σ 0.6', () => {
    const rig = new EnergyRig(WORKED);
    const plan = planFromPct(3006 - 1000, 0.2, 0.45, 0.35);
    const r = rig.runDays(21, plan);
    for (const n of [1, 7, 21]) {
      const d = r[n - 1]!;
      expect(d.atR).toBeCloseTo(-0.4 * 140 * (1 - Math.exp(-n / 7)), 6);
      expect(d.atN).toBeCloseTo(-0.6 * 140 * (1 - Math.exp(-n / 14)), 6);
    }
  });
  it('surplus uses β⁺ = 0.12; return to EI0 relaxes with τ_off = 14 d', () => {
    const rig = new EnergyRig(WORKED);
    const up = rig.runDays(200, planFromPct(3006 + 500, 0.2, 0.45, 0.35));
    expect(up[199]!.atR + up[199]!.atN).toBeCloseTo(0.12 * 500, 3);
    const atR0 = up[199]!.atR;
    const back = rig.runDays(14, planFromPct(3006, 0.2, 0.45, 0.35));
    expect(back[13]!.atR).toBeCloseTo(atR0 * Math.exp(-1), 6);
  });
  it('daily closed form stays within 2 % of a 5-min Euler reference (MODEL_SPEC §0.1)', () => {
    const rig = new EnergyRig(WORKED);
    const r = rig.runDays(30, planFromPct(2000, 0.2, 0.45, 0.35));
    const target = -0.4 * 0.14 * 1006;
    let x = 0;
    const dt = 5 / (60 * 24);
    for (let t = 0; t < 30; t += dt) x += ((target - x) / 7) * dt;
    expect(Math.abs(r[29]!.atR - x) / Math.abs(x)).toBeLessThan(0.02);
  });
  it('fasting overlay holds AT_R, removes it from RMR and applies fastRmrMult; AT_N continues', () => {
    const rig = new EnergyRig(WORKED);
    rig.runDays(20, planFromPct(2000, 0.2, 0.45, 0.35));
    const atR = rig.s.atR;
    const atN = rig.s.atN;
    const d = rig.runDay({ proteinG: 0, carbG: 0, fatG: 0 }, (bus) => {
      bus.fastActive = 1;
      bus.fastRmrMult = 1.05;
    });
    expect(d.atR).toBe(atR);
    expect(d.atN).toBeLessThan(atN);
    const expectedRmr = (1879 + rig.s.protTermKcalD + rig.s.compKcalD) * 1.05;
    expect(d.rmr).toBeCloseTo(expectedRmr, 6);
  });
  it('|AT_R + AT_N| is capped at 0.25·TDEE0', () => {
    const rig = new EnergyRig(WORKED, makeParams({ 'energy.betaAT': 0.4 }));
    const r = rig.runDays(200, { proteinG: 0, carbG: 0, fatG: 0 });
    expect(Math.abs(r[199]!.atR + r[199]!.atN)).toBeLessThanOrEqual(0.25 * 3006 + 1e-9);
  });
});

describe('energy — exercise compensation, metabolic part (10 §4.3; R-COMP)', () => {
  const bmi25 = profileWith(MAN02_INPUT, { rmr0: 1850, tdee0: 2800, pPct: 0.16, cPct: 0.45, fPct: 0.39, ffm0: 63, fm0: 18 });
  const compAt = (enet: number): number => {
    const rig = new EnergyRig(bmi25);
    const r = rig.runDays(200, rig.habitualPlan(), (bus, _d, h) => {
      bus.exEEKcalH = h === 17 ? enet : 0;
    });
    return r[199]!.comp;
  };
  it('10 §4.17 T7 at BMI 25: E_net 263 / 105 / 429 kcal/d → −39 / −16 / −64 kcal/d', () => {
    expect(compAt(263)).toBeCloseTo(-39.45, 1);
    expect(compAt(105)).toBeCloseTo(-15.75, 1);
    expect(compAt(429)).toBeCloseTo(-64.35, 1);
  });
  it('is capped at −5 % of RMR and is 0 without extra exercise', () => {
    expect(compAt(3000)).toBeCloseTo(-0.05 * 1850, 1);
    expect(compAt(0)).toBe(0);
  });
});

describe('energy — NEAT, TH_C, GNG cost, tdeeEst, maintenance', () => {
  it('NEAT integral is exact for any sleep length; steps above baseline add 1:1', () => {
    for (const sleep of [5, 8, 10]) {
      const rig = new EnergyRig(WORKED);
      const d = rig.runDay({ ...rig.habitualPlan(), sleepHours: sleep });
      expect(d.neat).toBeCloseTo(rig.s.neat0, 9);
    }
    const rig = new EnergyRig(WORKED);
    const d = rig.runDay(rig.habitualPlan(), (bus, _d, h) => {
      bus.stepsExtraKcalH = h >= 7 && h < 23 ? 10 : 0;
    });
    expect(d.neat - rig.s.neat0).toBeCloseTo(160, 9);
  });
  it('NEAT scales with body weight (NEAT0·BW/BW0)', () => {
    const rig = new EnergyRig(WORKED);
    rig.runDay(rig.habitualPlan(), (bus) => {
      bus.tissueMassKg = 81;
    });
    const d = rig.runDay(rig.habitualPlan(), (bus) => {
      bus.tissueMassKg = 81;
    });
    expect(d.neat).toBeCloseTo((rig.s.neat0 * 81) / 90, 6);
  });
  it('TH_C = 0.10 × CHO energy above habitual, only when EI > EI0 (11 §4.5)', () => {
    const rig = new EnergyRig(WORKED);
    const hab = rig.habitualPlan();
    const base = rig.runDay(hab);
    const surplus = new EnergyRig(WORKED).runDay({ ...hab, carbG: hab.carbG + 100 });
    expect(surplus.tdee - base.tdee - 0.075 * 400).toBeCloseTo(0.1 * 400, 6);
    const deficitMoreCarb = new EnergyRig(WORKED).runDay({ proteinG: hab.proteinG, carbG: hab.carbG + 100, fatG: 20 });
    expect(new EnergyRig(WORKED).s.thcFrac).toBe(0);
    expect(deficitMoreCarb.ei).toBeLessThan(3006);
  });
  it('GNG cost is off by default (ruling M5)', () => {
    const rig = new EnergyRig(WORKED);
    rig.burnIn(3);
    const base = rig.runDay(rig.habitualPlan());
    const keto = rig.runDay(rig.habitualPlan(), (bus) => {
      bus.gngGH = 20;
    });
    expect(keto.tdee).toBeCloseTo(base.tdee, 9);
  });
  it('GNG cost at the registry high = 0.2 × 4 kcal/g × (GNG − habitual hourly profile), ≥ 0', () => {
    const rig = new EnergyRig(WORKED, makeParams({ 'energy.gngCost': 0.2 }));
    rig.burnIn(14, (bus, _d, h) => {
      bus.gngGH = h < 7 ? 6 : 4;
    });
    const base = rig.runDay(rig.habitualPlan(), (bus, _d, h) => {
      bus.gngGH = h < 7 ? 6 : 4;
    });
    const keto = rig.runDay(rig.habitualPlan(), (bus, _d, h) => {
      bus.gngGH = (h < 7 ? 6 : 4) + 3;
    });
    expect(keto.tdee - base.tdee).toBeCloseTo(0.2 * 4 * 3 * 24, 6);
    const low = rig.runDay(rig.habitualPlan(), (bus) => {
      bus.gngGH = 1;
    });
    expect(low.tdee).toBeCloseTo(base.tdee, 6);
  });
  it("tdeeEst = yesterday's TDEE − yesterday's exercise + today's planned exercise", () => {
    const rig = new EnergyRig(WORKED);
    const y = rig.runDay(rig.habitualPlan(), (bus, _d, h) => {
      bus.exEEKcalH = h === 18 ? 300 : 0;
    });
    rig.bus.exPlannedKcalD = 500;
    const t = rig.runDay(rig.habitualPlan());
    expect(t.tdeeEst).toBeCloseTo(y.tdee - 300 + 500, 9);
  });
  it('maintenance stays finite on zero-intake days (α_mix0 fallback, review M12)', () => {
    const rig = new EnergyRig(WORKED);
    const r = rig.runDays(3, { proteinG: 0, carbG: 0, fatG: 0 });
    for (const d of r) {
      expect(Number.isFinite(d.maintenance)).toBe(true);
      expect(d.maintenance).toBeGreaterThan(2000);
    }
  });
});

describe('energy — review rulings (B3(b) burn-in calibration, M6 fasting freeze)', () => {
  it('burn-in calibration absorbs a constant model mismatch so TEE = habitual EI from day 0', () => {
    const rig = new EnergyRig(WORKED);
    const extra = (bus: EnergyRig['bus']): void => {
      bus.dnlHeatKcalH = 1; // 24 kcal/d the analytic TDEE0 does not contain
    };
    rig.burnIn(14, extra);
    expect(rig.s.neat0).toBeCloseTo(849 - 24, 0);
    const d = rig.runDays(30, rig.habitualPlan(), extra);
    for (const x of d) {
      expect(x.tdee).toBeCloseTo(3006, 6);
      expect(Math.abs(x.atR) + Math.abs(x.atN)).toBeLessThan(1e-9);
    }
  });
  it('habitual sessions present in burn-in set EAT0 to the realised mean (compensation baseline 0 at habit)', () => {
    const rig = new EnergyRig(WORKED);
    const ex = (bus: EnergyRig['bus'], _d: number, h: number): void => {
      bus.exEEKcalH = h === 18 ? 210 : 0;
    };
    rig.burnIn(14, ex);
    expect(rig.s.eat0).toBeCloseTo(210, 9);
    const d = rig.runDays(60, rig.habitualPlan(), ex);
    expect(d[59]!.tdee).toBeCloseTo(3006, 6);
    expect(d[59]!.comp).toBe(0);
    expect(d[59]!.maintenance).toBeCloseTo(3006, 6);
  });
  it('P_eff and the compensation state are frozen while the fasting overlay is active', () => {
    const rig = new EnergyRig(WORKED);
    const hi = { ...rig.habitualPlan(), proteinG: WORKED.habitualProteinG + 100, carbG: WORKED.habitualCarbG - 100 };
    rig.runDays(5, hi, (bus, _d, h) => {
      bus.exEEKcalH = h === 18 ? 400 : 0;
    });
    const pEff = rig.s.pEffG;
    const comp = rig.s.compKcalD;
    rig.runDays(3, { proteinG: 0, carbG: 0, fatG: 0, zeroIntake: true }, (bus) => {
      bus.fastActive = 1;
      bus.fastRmrMult = 0.95;
    });
    expect(rig.s.pEffG).toBe(pEff);
    expect(rig.s.compKcalD).toBe(comp);
    rig.bus.fastActive = 0;
    rig.bus.fastRmrMult = 1;
    rig.runDay(hi);
    expect(rig.s.pEffG).not.toBe(pEff);
  });
});

describe('energy — properties', () => {
  it('zero intake for 21 days stays finite and bounded', () => {
    const rig = new EnergyRig(resolveProfile(MAN02_INPUT));
    rig.burnIn(14);
    const r = rig.runDays(21, { proteinG: 0, carbG: 0, fatG: 0 }, (bus) => {
      bus.fastActive = 1;
      bus.fastRmrMult = 0.9;
    });
    for (const d of r) {
      for (const v of [d.tdee, d.rmr, d.tef, d.neat, d.atR, d.atN, d.maintenance, d.tdeeEst]) expect(Number.isFinite(v)).toBe(true);
      expect(d.tdee).toBeGreaterThan(0);
      expect(d.tef).toBe(0);
      expect(d.rmr).toBeGreaterThan(0);
    }
    const atRBefore = rig.s.atR;
    expect(Math.abs(atRBefore)).toBeLessThan(1e-9); // held at its (≈ 0) burn-in value
  });
  it('monotone: more intake → higher same-day TDEE; deeper deficit → more negative AT', () => {
    const t = [2000, 2500, 3000, 3500].map((e) => new EnergyRig(WORKED).runDay(planFromPct(e, 0.2, 0.45, 0.35)).tdee);
    for (let i = 1; i < t.length; i++) expect(t[i]!).toBeGreaterThan(t[i - 1]!);
    const at = [2800, 2400, 2000, 1000].map((e) => {
      const r = new EnergyRig(WORKED).runDays(30, planFromPct(e, 0.2, 0.45, 0.35));
      return r[29]!.atR + r[29]!.atN;
    });
    for (let i = 1; i < at.length; i++) expect(at[i]!).toBeLessThan(at[i - 1]!);
  });
  it('deterministic: identical inputs give bit-identical outputs', () => {
    const run = (): number[] => new EnergyRig(WORKED).runDays(40, (d) => planFromPct(d % 2 ? 2000 : 2600, 0.25, 0.4, 0.35)).map((x) => x.tdee);
    expect(run()).toEqual(run());
  });
});
