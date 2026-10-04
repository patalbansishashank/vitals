/**
 * Dossier 02 §7 validation targets V1-V10 — energy parts (MODEL_SPEC §1.5 "Validation", §9.2 row 02; level U).
 * The energy module is driven directly: body-mass trajectories, exercise and step energy (activity) and GNG (fuel) are
 * imposed from the cited studies, so each test checks only this module's expenditure response. Scenario assumptions
 * that are not in the dossier are marked ASSUMPTION. Targets the engine cannot meet stay as `it.fails` (reported).
 */
import { describe, expect, it } from 'vitest';
import { resolveProfile } from '../../core/resolveProfile';
import type { PersonProfile, ResolvedProfile } from '../../types/profile';
import { EnergyRig, makeParams, mean, profileWith, type DayPlan, type HourDrive } from './testRig';

const person = (sex: 'male' | 'female', age: number, heightCm: number, weightKg: number, steps = 7000): PersonProfile => ({
  schemaVersion: 1,
  body: { sex, ageYears: age, heightCm, weightKg },
  habits: { typicalSteps: steps, sessionsPerWeek: 0 },
  startDate: '2026-01-05',
});

/** Plan at `kcal` with P/C/F energy shares; fibre (2 kcal/g) is taken out of the carbohydrate share. */
function planPct(kcal: number, p: number, c: number, f: number, fibreG = 0): DayPlan {
  return { proteinG: (p * kcal) / 4, carbG: (c * kcal - 2 * fibreG) / 4, fatG: (f * kcal) / 9, fibreG };
}

/** Linear mass change over `days` (then held): ΔFFM_act and ΔFM in kg; also sets the signed deposition cost. */
function massRamp(rp: ResolvedProfile, days: number, dFfm: number, dFm: number): HourDrive {
  const perH = (179 * dFm + 229 * dFfm) / (days * 24);
  return (bus, d) => {
    const f = Math.min(1, (d + 1) / days);
    bus.ffmActKg = rp.ffm0Kg + dFfm * f;
    bus.fatMassKg = rp.fm0Kg + dFm * f;
    bus.tissueMassKg = bus.ffmActKg + bus.fatMassKg;
    bus.depositionCostKcalH = d < days ? perH : 0;
  };
}

const log = (name: string, v: Record<string, number>): void => {
  console.info(`[02 ${name}] ${Object.entries(v).map(([k, x]) => `${k}=${x.toFixed(1)}`).join(' ')}`);
};

describe('02 V1 — Levine 1999 overfeeding +1000 kcal/d × 56 d (ΔTEE +350-550 ± 150)', () => {
  it('ΔTEE over the last week is within 200-700 kcal/d', () => {
    const rp = resolveProfile(person('male', 30, 175, 70));
    const rig = new EnergyRig(rp);
    rig.burnIn(14);
    const e = rp.tdee0Kcal + 1000;
    // Levine 20/40/40 %E P/F/C; fibre at the habitual density. ASSUMPTION: +4.7 kg with the Bray 15 %-protein lean
    // share (2.87/6.05 = 47 %): ΔFFM +2.2, ΔFM +2.5 kg.
    const r = rig.runDays(56, planPct(e, 0.2, 0.4, 0.4, (rp.habitualFibreG * e) / rp.tdee0Kcal), massRamp(rp, 56, 2.2, 2.5));
    const dTee = mean(r.slice(49).map((x) => x.tdee)) - rp.tdee0Kcal;
    log('V1', { dTee });
    expect(dTee).toBeGreaterThan(350 - 150);
    expect(dTee).toBeLessThan(550 + 150);
  });
});

describe('02 V2 — Bray 2012 protein overfeeding +954 kcal/d × 56 d (REE ≈ 0/+160/+227 ± 60; R-BRAY)', () => {
  const arms: [number, number, number, number][] = [
    // protein %E, ΔFFM, ΔFM, observed ΔREE
    [0.05, 0.0, 3.16, 0],
    [0.15, 2.87, 3.18, 160],
    [0.25, 3.18, 3.33, 227],
  ];
  for (const [pPct, dFfm, dFm, target] of arms) {
    it(`${pPct * 100} %E protein: ΔREE within ±60 of ${target}`, () => {
      const rp = resolveProfile(person('male', 25, 178, 75));
      const rig = new EnergyRig(rp);
      rig.burnIn(14);
      const e = rp.tdee0Kcal + 954;
      const fat = 0.35;
      const r = rig.runDays(56, planPct(e, pPct, 1 - pPct - fat, fat), massRamp(rp, 56, dFfm, dFm));
      const dRee = r[55]!.rmr - rp.rmr0Kcal;
      log(`V2 ${pPct * 100}%`, { dRee });
      expect(Math.abs(dRee - target)).toBeLessThanOrEqual(60);
    });
  }
});

describe('02 V3 — Hall 2016 isocaloric ketogenic diet (ΔTEE −30 to +100)', () => {
  const run = (gngCost: number, dGngGPerD: number): number => {
    const base = resolveProfile(person('male', 35, 180, 90));
    const rp = profileWith(person('male', 35, 180, 90), {
      rmr0: base.rmr0Kcal, tdee0: base.tdee0Kcal, pPct: 0.15, cPct: 0.5, fPct: 0.35, ffm0: base.ffm0Kg, fm0: base.fm0Kg,
    });
    const rig = new EnergyRig(rp, makeParams({ 'energy.gngCost': gngCost }));
    const gng = (extra: number): HourDrive => (bus) => {
      bus.gngGH = 5 + extra / 24;
    };
    rig.burnIn(14, gng(0));
    const e = rp.tdee0Kcal;
    const bd = rig.runDays(28, planPct(e, 0.15, 0.5, 0.35), gng(0));
    const kd = rig.runDays(28, planPct(e, 0.15, 0.05, 0.8), gng(dGngGPerD));
    return mean(kd.slice(21).map((x) => x.tdee)) - mean(bd.slice(21).map((x) => x.tdee));
  };
  // Ruling on review M5 set gngCost to 0: only the TEF loss (−0.0225·EI ≈ −60 kcal/d) remains, below the −30 bound.
  it.fails('default parameters (gngCost 0): ΔTEE ≥ −30 — KNOWN MISS after ruling M5', () => {
    const d = run(0, 70);
    log('V3 default', { dTee: d });
    expect(d).toBeGreaterThanOrEqual(-30);
    expect(d).toBeLessThanOrEqual(100);
  });
  it('registry-high gngCost 0.2 with ΔGNG +70 g/d (02 §4.10 illustrative, UNVERIFIED) meets the target', () => {
    const d = run(0.2, 70);
    log('V3 gngCost 0.2', { dTee: d });
    expect(d).toBeGreaterThanOrEqual(-30);
    expect(d).toBeLessThanOrEqual(100);
  });
});

describe('02 V4 — CALERIE-1 25 % CR × 6 months (AT_R + ΔTEF −60 to −200; AT_R + AT_N −100 to −350)', () => {
  const run = () => {
    // CALERIE-1: BMI 27.8, age 36.8 — the MODEL_SPEC MAN reference (35 y, 180 cm, 90 kg = BMI 27.8)
    const rp = resolveProfile(person('male', 35, 180, 90));
    const rig = new EnergyRig(rp);
    rig.burnIn(14);
    const hab = rig.habitualPlan();
    const cr: DayPlan = { proteinG: hab.proteinG * 0.75, carbG: hab.carbG * 0.75, fatG: hab.fatG * 0.75, fibreG: (hab.fibreG ?? 0) * 0.75 };
    // −10.4 % weight; ASSUMPTION: 25 % of the loss as FFM
    const r = rig.runDays(182, cr, massRamp(rp, 182, -0.25 * 9.36, -0.75 * 9.36));
    const m6 = r[181]!;
    const dTef = m6.tef - rig.s.tef0;
    return { rp, atR: m6.atR, atTot: m6.atR + m6.atN, atRdTef: m6.atR + dTef };
  };
  it('AT_R + ΔTEF within −60 to −200 kcal/d at M6', () => {
    const v = run();
    log('V4', { tdee0: v.rp.tdee0Kcal, atRdTef: v.atRdTef, atTot: v.atTot });
    expect(v.atRdTef).toBeLessThanOrEqual(-60);
    expect(v.atRdTef).toBeGreaterThanOrEqual(-200);
  });
  // β_AT 0.14 × ΔEI (−25 % of EI0) reaches −100 only for EI0 ≥ 2 857 kcal/d; the MAN fixture has TDEE0 ≈ 2 650.
  // Integration decision (A1, 2026-09-30): kept as K (−92 kcal/d). β_AT 0.16 (inside [0.05, 0.40]) gives −106 here and keeps
  // V5 in band (W9 AT_R ≈ −94) but moves the engine off the Hall 2011 value the O-1 BWP oracle uses; the full-engine
  // CALERIE-1 row (validation 02-V4) measures −73 with the same cause.
  it.fails('AT_R + AT_N within −100 to −350 kcal/d at M6 — KNOWN MISS (≈ −93 for TDEE0 ≈ 2 650)', () => {
    const v = run();
    expect(v.atTot).toBeLessThanOrEqual(-100);
    expect(v.atTot).toBeGreaterThanOrEqual(-350);
  });
});

describe('02 V5 — Martins 2020: 1000 kcal/d × 8 wk then 4 wk at maintenance', () => {
  it('AT_R −60 to −120 at W9 and ≥ 40 % smaller at W13', () => {
    const rp = resolveProfile(person('female', 40, 168, 100));
    const rig = new EnergyRig(rp);
    rig.burnIn(14);
    const hab = rig.habitualPlan();
    const f = 1000 / rp.tdee0Kcal;
    const vled: DayPlan = { proteinG: hab.proteinG * f, carbG: hab.carbG * f, fatG: hab.fatG * f, fibreG: (hab.fibreG ?? 0) * f };
    // −14 kg; ASSUMPTION: 25 % FFM
    const ramp = massRamp(rp, 56, -3.5, -10.5);
    const r1 = rig.runDays(56, vled, ramp);
    const w9 = r1[55]!.atR;
    // stabilisation: intake = the engine's current maintenance (the 'current' energy reference), re-read every day
    for (let i = 0; i < 28; i++) {
      const m = rig.bus.maintenanceKcalD / rp.tdee0Kcal;
      rig.runDay({ proteinG: hab.proteinG * m, carbG: hab.carbG * m, fatG: hab.fatG * m, fibreG: (hab.fibreG ?? 0) * m }, ramp);
    }
    const w13 = rig.s.atR;
    log('V5', { w9, w13, ratio: w13 / w9 });
    expect(w9).toBeLessThanOrEqual(-60);
    expect(w9).toBeGreaterThanOrEqual(-120);
    expect(Math.abs(w13)).toBeLessThanOrEqual(0.6 * Math.abs(w9));
  });
});

describe('02 V6 — Biggest Loser wk 30 (AT_R + C_comp −300 to −650)', () => {
  const run = () => {
    const rp = resolveProfile(person('male', 35, 175, 150, 5000)); // BMI 49
    const rig = new EnergyRig(rp);
    rig.burnIn(14);
    const hab = rig.habitualPlan();
    const f = 1300 / rp.tdee0Kcal; // ASSUMPTION: ≈ 1 300 kcal/d on the ranch (not in the dossier)
    const plan: DayPlan = { proteinG: hab.proteinG * f, carbG: hab.carbG * f, fatG: hab.fatG * f, fibreG: (hab.fibreG ?? 0) * f };
    const ramp = massRamp(rp, 210, -0.17 * 57, -0.83 * 57); // −38 % weight, 17 % of the loss FFM (Johannsen 2012)
    const r = rig.runDays(210, plan, (bus, d, h) => {
      ramp(bus, d, h);
      bus.exEEKcalH = h >= 9 && h < 17 ? (8 * bus.tissueMassKg) / 8 : 0; // +8 kcal/kg/d vigorous activity (02 V6)
    });
    return r[209]!;
  };
  // R-COMP caps the metabolic compensation at −5 % RMR (≈ −100 kcal/d here) and β_AT gives AT_R ≈ −120.
  // Integration decision (A1, 2026-09-30): K by ruling R-COMP (sum −223 vs −300…−650); no in-range retune reaches −300
  // without lifting the ruled cap.
  it.fails('AT_R + C_comp within −300 to −650 kcal/d — KNOWN MISS under R-COMP (cap −5 % RMR)', () => {
    const w30 = run();
    log('V6', { atR: w30.atR, comp: w30.comp, sum: w30.atR + w30.comp });
    expect(w30.atR + w30.comp).toBeLessThanOrEqual(-300);
    expect(w30.atR + w30.comp).toBeGreaterThanOrEqual(-650);
  });
  it('without compensation the model under-predicts (documents Hall 2022)', () => {
    const w30 = run();
    expect(w30.atR).toBeGreaterThan(-300);
    expect(w30.comp).toBeLessThan(0);
  });
});

describe('02 V7 — MATADOR vs continuous vs ICECAP (direction, Q)', () => {
  const atAtEndOfEr = (erDays: number, balDays: number, nErDays: number): number => {
    const rp = resolveProfile(person('male', 39, 178, 110));
    const rig = new EnergyRig(rp);
    rig.burnIn(14);
    const hab = rig.habitualPlan();
    const scaled = (f: number): DayPlan => ({ proteinG: hab.proteinG * f, carbG: hab.carbG * f, fatG: hab.fatG * f, fibreG: (hab.fibreG ?? 0) * f });
    let er = 0;
    let atR = 0;
    while (er < nErDays) {
      for (let i = 0; i < erDays && er < nErDays; i++, er++) atR = rig.runDay(scaled(0.67)).atR;
      if (er >= nErDays) break;
      const m = rig.bus.maintenanceKcalD / rp.tdee0Kcal; // 'blockStart' reference for the balance block
      for (let i = 0; i < balDays; i++) rig.runDay(scaled(m));
    }
    return atR;
  };
  it('intermittent 2:2 ends ER with a smaller resting AT than continuous; 3:1 lies in between', () => {
    const con = atAtEndOfEr(112, 0, 112);
    const matador = atAtEndOfEr(14, 14, 112);
    const icecap = atAtEndOfEr(21, 7, 84);
    const con84 = atAtEndOfEr(84, 0, 84);
    log('V7', { con, matador, icecap, con84 });
    expect(Math.abs(matador)).toBeLessThan(Math.abs(con));
    expect(Math.abs(icecap)).toBeLessThanOrEqual(Math.abs(con84));
    expect(Math.abs(icecap) / Math.abs(con84)).toBeGreaterThan(Math.abs(matador) / Math.abs(con));
  });
});

describe('02 V8 — Leibel 1995 weight-reduced maintenance (K: documented known-miss)', () => {
  it.fails('AT beyond composition ≤ −6 kcal/kg FFM/d at −10 % weight maintained (engine ≈ −1)', () => {
    const rp = resolveProfile(person('male', 35, 180, 90));
    const rig = new EnergyRig(rp);
    rig.burnIn(14);
    const hab = rig.habitualPlan();
    const f = (rp.tdee0Kcal - 350) / rp.tdee0Kcal; // ΔEI ≈ −350 kcal/d at weight-reduced maintenance (02 §7.8)
    const r = rig.runDays(120, { proteinG: hab.proteinG * f, carbG: hab.carbG * f, fatG: hab.fatG * f, fibreG: (hab.fibreG ?? 0) * f });
    const perFfm = (r[119]!.atR + r[119]!.atN) / rp.ffm0Kg;
    log('V8', { perFfm });
    expect(perFfm).toBeLessThanOrEqual(-6);
  });
});

describe('02 V9 — Ohkawara 2011 +20 615 steps/d (+588 kcal/d ± 15 %)', () => {
  it('step energy above the lifestyle baseline passes into TEE without double counting', () => {
    const rp = resolveProfile(person('male', 30, 170, 64.5, 8973));
    const rig = new EnergyRig(rp);
    rig.burnIn(14);
    const base = rig.runDay(rig.habitualPlan()).tdee;
    // activity's 10 §4.1.4 step cost (0.44 kcal/kg/1000 steps) for the extra steps, spread over waking hours
    const extra = (0.44 / 1000) * 64.5 * 20615;
    const d = rig.runDay(rig.habitualPlan(), (bus, _d, h) => {
      bus.stepsExtraKcalH = h >= 7 && h < 23 ? extra / 16 : 0;
    });
    log('V9', { dTee: d.tdee - base });
    expect(Math.abs(d.tdee - base - 588)).toBeLessThanOrEqual(0.15 * 588);
  });
});

describe('02 V10 — Mikkelsen 2000 isoenergetic +17.5 %E protein for carbohydrate, day 4 (+80-120 kcal/d)', () => {
  const run = (kP?: number): number => {
    const base = resolveProfile(person('male', 25, 180, 75));
    // 24-h EE 12.6 MJ (+492 kJ = +3.9 %) → EI0 ≈ 3 015 kcal/d; control diet 12/59/29 %E P/C/F
    const rp = profileWith(person('male', 25, 180, 75), {
      rmr0: base.rmr0Kcal, tdee0: 3015, pPct: 0.12, cPct: 0.59, fPct: 0.29, ffm0: base.ffm0Kg, fm0: base.fm0Kg,
    });
    const rig = new EnergyRig(rp, makeParams(kP === undefined ? {} : { 'energy.kP': kP }));
    rig.burnIn(14);
    const ctrl = rig.runDay(planPct(3015, 0.12, 0.59, 0.29)).tdee;
    const r = rig.runDays(4, planPct(3015, 0.295, 0.415, 0.29));
    return r[3]!.tdee - ctrl;
  };
  // ΔTEF = 0.175 × 528 = 92 kcal/d plus k_P 0.6 × 132 g × (1 − e^{−2}) ≈ 68 → ≈ 160; the dossier's own k_P fit to this
  // study is 0.31 (02 §4.5). The dossier's "+80-120" range is inconsistent with its default k_P 0.6.
  // Integration decision (A1, 2026-09-30): kept as K (+161). k_P 0.3 (registry low) gives +127 — still outside — and pulls
  // V2's 25 %-protein REE (+197, target 227 ± 60) toward its lower edge; not retuned.
  it.fails('default k_P 0.6: ΔTEE within +80-120 kcal/d — KNOWN MISS', () => {
    const d = run();
    log('V10', { dTee: d });
    expect(d).toBeGreaterThanOrEqual(80);
    expect(d).toBeLessThanOrEqual(120);
  });
  it('TEF alone reproduces ≥ 80 kcal/d (the target lower bound) and k_P at its low 0.3 lands near the upper bound', () => {
    const d0 = run(0);
    const dLow = run(0.3);
    log('V10 kP0/kP0.3', { d0, dLow });
    expect(d0).toBeGreaterThanOrEqual(80);
    expect(dLow).toBeLessThan(140);
  });
});
