// @vitest-environment node
/**
 * Unit tests of the fasting module (MODEL_SPEC §1.4; dossier 20 §4.2-4.5, §4.9, §4B). The module is driven directly with
 * hand-built bus values (other modules are written in parallel). Integrated validation targets: fasting.validation.test.ts.
 */
import { checkWiring } from '../../core/moduleRegistry';
import { validateParamDefs } from '../../core/paramsRegistry';
import {
  aSnsFrac,
  bhbRefMmolL,
  carbFactor,
  fastingModule,
  ketFactor,
  nPeakPerKgFfm,
  oedemaAmplitudeL,
  oedemaClosedFormL,
  phiAT,
  prLateFrac,
  riseFactor,
  sparingTarget,
  urinaryNGd,
} from './index';
import { makeRig, mealAt, type FastPerson } from './testkit';

/** 20 Table A1 lean man: 75 kg, 15 % BF, FM 11.3, FFM 63.8, TEE0 2633; habitual protein ≈ 1.3 g/kg, carbs 50 %E. */
const LEAN_MAN: FastPerson = {
  ffm0Kg: 63.8,
  fm0Kg: 11.3,
  tdee0Kcal: 2633,
  habitualProteinG: 100,
  habitualCarbG: 330,
};
const K = makeRig(LEAN_MAN).k;

describe('fasting — registry and wiring', () => {
  it('declares valid ParamDefs (prefix, low ≤ value ≤ high, source, §)', () => {
    expect(validateParamDefs([fastingModule])).toEqual([]);
    for (const p of fastingModule.params) expect(p.dossier).toMatch(/§/);
  });
  it('has no wiring issues and reads/writes exactly the §4 signals', () => {
    const issues = checkWiring().issues.filter((i) => i.module === 'fasting');
    expect(issues).toEqual([]);
    expect([...fastingModule.writes].sort()).toEqual([
      'fastActive',
      'fastHoursH',
      'fastOedemaL',
      'fastProtOxGH',
      'fastRepletionGH',
      'fastRmrMult',
    ]);
  });
});

describe('fasting — equations vs dossier worked numbers', () => {
  it('φ_AT = clamp(0.25 − 0.004·BF%, 0.05, 0.22): 0.19 (15 %), 0.15 (25 %), 0.07 (45 %) (20 §4.2)', () => {
    expect(phiAT(K, 15)).toBeCloseTo(0.19, 10);
    expect(phiAT(K, 25)).toBeCloseTo(0.15, 10);
    expect(phiAT(K, 45)).toBeCloseTo(0.07, 10);
    expect(phiAT(K, 3)).toBeCloseTo(0.22, 10);
    expect(phiAT(K, 60)).toBeCloseTo(0.05, 10);
  });
  it('A_SNS peaks at a_SNS on day t_p and is gone by ~day 7 (20 §4.2)', () => {
    expect(aSnsFrac(K, 0)).toBe(0);
    expect(aSnsFrac(K, 2)).toBeCloseTo(0.05, 12);
    expect(aSnsFrac(K, 1)).toBeLessThan(0.05);
    expect(aSnsFrac(K, 3)).toBeLessThan(0.05);
    expect(aSnsFrac(K, 7)).toBeCloseTo(0.05 * 3.5 * Math.exp(-2.5), 12);
    expect(aSnsFrac(K, 14)).toBeLessThan(0.002);
  });
  it('n_pk: 0.25 (FM ≤ 10 kg) → 0.19 (FM ≥ 50 kg) g N/kg FFM/d (20 §4.4.2)', () => {
    expect(nPeakPerKgFfm(K, 8)).toBeCloseTo(0.25, 12);
    expect(nPeakPerKgFfm(K, 30)).toBeCloseTo(0.22, 12);
    expect(nPeakPerKgFfm(K, 60)).toBeCloseTo(0.19, 12);
  });
  it('pr_late = 0.04 + 0.22·e^(−BF%/15): 0.08 (25 %), 0.05 (45 %) (20 §4.4.2 table)', () => {
    expect(prLateFrac(K, 25)).toBeCloseTo(0.08, 2);
    expect(prLateFrac(K, 45)).toBeCloseTo(0.05, 2);
    // the table's lean entries (0.19 at 8 %, 0.13 at 15 %) are off the printed formula (0.169, 0.121): the formula is used
    expect(prLateFrac(K, 8)).toBeCloseTo(0.04 + 0.22 * Math.exp(-8 / 15), 12);
    expect(prLateFrac(K, 15)).toBeCloseTo(0.121, 3);
  });
  it('S* = clamp((BHB − 0.5)/3.5, 0, 1), NaN-safe', () => {
    expect(sparingTarget(K, 0.1)).toBe(0);
    expect(sparingTarget(K, 2.25)).toBeCloseTo(0.5, 12);
    expect(sparingTarget(K, 6)).toBe(1);
    expect(sparingTarget(K, Number.NaN)).toBe(0);
  });
  it('rise, C_carb and K_ket modifiers (20 §4.4.2, §4.4.4)', () => {
    expect(riseFactor(K, 0)).toBeCloseTo(0.8, 12);
    expect(riseFactor(K, 1.25)).toBeCloseTo(0.9, 12);
    expect(riseFactor(K, 5)).toBe(1);
    expect(carbFactor(K, 0)).toBe(1);
    expect(carbFactor(K, 50)).toBeCloseTo(0.775, 12);
    expect(carbFactor(K, 300)).toBeCloseTo(0.55, 12);
    expect(ketFactor(K, 0)).toBe(1);
    expect(ketFactor(K, 0.75)).toBeCloseTo(0.85, 12);
    expect(ketFactor(K, 3)).toBeCloseTo(0.7, 12);
  });
  it('urinary N: early phase = FFM·n_pk·rise; late phase = pr_late·TEE/29.4 (20 §4.4.2)', () => {
    // lean man day 3, S_N = 0: 63.8 × n_pk(11.3 kg) = 63.8 × 0.24805 = 15.83 g N/d (Table 4.4.3 day 3: 15.3 with S_N ≈ 0.07)
    const early = 63.8 * (0.25 - 0.06 * (1.3 / 40));
    expect(urinaryNGd(K, 63.8, 11.3, 15, 2354, 0, 3, 0, 0)).toBeCloseTo(early, 10);
    // fully adapted: 0.121 × 1836 / 29.375 = 7.56 g N/d (Levanzin-type late floor 7-10 g/d)
    const late = urinaryNGd(K, 60, 8, 15, 1836, 1, 21, 0, 0);
    expect(late).toBeCloseTo((prLateFrac(K, 15) * 1836) / 29.375, 10);
    expect(late).toBeGreaterThan(7);
    expect(late).toBeLessThan(8);
    // obese woman (FM 45, BF 45 %, FFM 55) late floor ≈ 3 g N/d (Göschke week 4: 3.0 ± 1.5)
    const obLate = urinaryNGd(K, 53, 42, 44, 1895, 1, 28, 0, 0);
    expect(obLate).toBeGreaterThan(2.5);
    expect(obLate).toBeLessThan(4.0);
    // carbohydrate and exogenous ketones spare N multiplicatively
    expect(urinaryNGd(K, 63.8, 11.3, 15, 2354, 0, 3, 50, 0)).toBeCloseTo(early * 0.775, 10);
    expect(urinaryNGd(K, 63.8, 11.3, 15, 2354, 0, 3, 0, 1.5)).toBeCloseTo(early * 0.7, 10);
  });
  it('refeeding oedema amplitude min(2, 0.08·(days − 3)) and closed form (20 §4.5.2)', () => {
    expect(oedemaAmplitudeL(K, 3)).toBe(0);
    expect(oedemaAmplitudeL(K, 7)).toBeCloseTo(0.32, 12);
    expect(oedemaAmplitudeL(K, 21)).toBeCloseTo(1.44, 12);
    expect(oedemaAmplitudeL(K, 40)).toBe(2);
    expect(oedemaClosedFormL(1, 0, 2, 10)).toBe(0);
    expect(oedemaClosedFormL(1, 2, 2, 10)).toBeCloseTo((1 - Math.exp(-1)) * Math.exp(-0.2), 12);
  });
  it('BHB_ref reproduces the dossier values (20 §4.3.4, lean and obese woman)', () => {
    const t = [24, 36, 48, 72, 120, 168, 240, 336, 504];
    const lean = [0.3, 0.72, 1.42, 2.67, 3.56, 4.15, 4.78, 5.3, 5.73];
    const obese = [0.21, 0.46, 0.88, 1.68, 2.31, 2.79, 3.36, 3.9, 4.48];
    t.forEach((h, i) => {
      expect(bhbRefMmolL(K, h, 15)).toBeCloseTo(lean[i]!, 2);
      expect(bhbRefMmolL(K, h, 45)).toBeCloseTo(obese[i]!, 2);
    });
    // modified fast with 60 g/d carbohydrate: × 0.6
    expect(bhbRefMmolL(K, 168, 15, 60)).toBeCloseTo(0.6 * bhbRefMmolL(K, 168, 15), 12);
  });
});

/** Drive the rig with habitual meals for `days` days. */
function eatDays(
  rig: ReturnType<typeof makeRig>,
  days: number,
  kcalD = 2633,
  proteinD = 100,
  carbD = 330,
): void {
  for (let h = 0; h < days * 24; h++) {
    const [kc, p, c] = mealAt((rig.clock.hourIndex + 1) % 24, kcalD, proteinD, carbD);
    rig.step(kc, p, c);
  }
}

describe('fasting — module behaviour (hand-built bus)', () => {
  it('habitual eating at maintenance: overlay never active, outputs neutral for 30 days (steady state)', () => {
    const rig = makeRig(LEAN_MAN);
    for (let h = 0; h < 30 * 24; h++) {
      const [kc, p, c] = mealAt(h % 24, 2633, 100, 330);
      rig.step(kc, p, c);
      expect(rig.bus.fastActive).toBe(0);
      expect(rig.bus.fastRmrMult).toBe(1);
      expect(rig.bus.fastProtOxGH).toBe(0);
      expect(rig.bus.fastRepletionGH).toBe(0);
      expect(rig.bus.fastOedemaL).toBe(0);
    }
    expect(rig.s.kcal24).toBeCloseTo(2633, 6);
    expect(rig.s.sAT).toBe(0);
    expect(rig.s.sN).toBe(0);
  });

  it('planned span ≥ 24 h activates from its first hour; tFast counts; fastStart/fastEnd events (§7.1)', () => {
    const rig = makeRig(LEAN_MAN, { fastSpans: [{ startHour: 44, endHour: 44 + 48, electrolytes: true }] });
    eatDays(rig, 1); // hours 0-23
    for (let h = 24; h < 44; h++) {
      const [kc, p, c] = mealAt(h % 24, 2633, 100, 330);
      rig.step(kc, p, c);
    }
    expect(rig.bus.fastActive).toBe(0);
    rig.step(0, 0, 0, 1); // hour 44 (20:00), last meal at 19:00
    expect(rig.bus.fastActive).toBe(1);
    expect(rig.bus.fastHoursH).toBe(1);
    for (let h = 45; h < 92; h++) rig.step(0, 0, 0, 1);
    expect(rig.bus.fastHoursH).toBe(48);
    rig.step(900, 35, 110, 0); // refeed meal at hour 92
    expect(rig.bus.fastActive).toBe(0);
    expect(rig.bus.fastHoursH).toBe(0);
    expect(rig.s.lastFastDays).toBeCloseTo(2, 12);
    expect(rig.events.list).toEqual([
      { type: 'fastStart', hour: 44, value: 1 },
      { type: 'fastEnd', hour: 92, value: 48 },
    ]);
  });

  it('planned span < 24 h does not activate the overlay (review M7) but still emits events', () => {
    const rig = makeRig(LEAN_MAN, { fastSpans: [{ startHour: 20, endHour: 36, electrolytes: true }] });
    for (let h = 0; h < 20; h++) {
      const [kc, p, c] = mealAt(h % 24, 2633, 100, 330);
      rig.step(kc, p, c);
    }
    for (let h = 20; h < 36; h++) {
      rig.step(0, 0, 0, 1);
      expect(rig.bus.fastActive).toBe(0);
      expect(rig.bus.fastProtOxGH).toBe(0);
    }
    rig.step(900, 35, 110, 0);
    expect(rig.events.list.map((e) => e.type)).toEqual(['fastStart', 'fastEnd']);
  });

  it('a 24-h dinner-to-dinner fast (23-h zero-intake span, mealToMealH 24) activates the overlay (ruling 18:10, A2)', () => {
    const rig = makeRig(LEAN_MAN, { fastSpans: [{ startHour: 21, endHour: 44, electrolytes: true, mealToMealH: 24 }] });
    for (let h = 0; h < 21; h++) {
      const [kc, p, c] = mealAt(h % 24, 2633, 100, 330);
      rig.step(kc, p, c);
    }
    let active = 0;
    for (let h = 21; h < 44; h++) {
      rig.step(0, 0, 0, 1);
      active += rig.bus.fastActive;
    }
    expect(active).toBe(23);
    expect(rig.bus.fastProtOxGH).toBeGreaterThan(0);
  });

  it('no events during burn-in (clock.day < 0)', () => {
    const rig = makeRig(LEAN_MAN, { startHour: -48 });
    for (let h = 0; h < 30; h++) rig.step(0, 0, 0, 1);
    expect(rig.events.list).toEqual([]);
  });

  it('unplanned zero intake activates once the 24-h sums fall below the criteria; tFast counts from the last intake (20 §2)', () => {
    const rig = makeRig(LEAN_MAN);
    eatDays(rig, 2); // last meal at hour 43 (19:00 of day 1)
    let startHour = -1;
    for (let h = 48; h < 48 + 40; h++) {
      rig.step(0, 0, 0, 0);
      if (startHour < 0 && rig.bus.fastActive === 1) startHour = h;
    }
    expect(startHour).toBe(43 + 24); // the 19:00 meal leaves the 24-h window at hour 67
    // back-dated: at activation the clock equals the hours since the last intake event
    expect(rig.s.tFastH).toBe(87 - 43);
  });

  it('a modified fast (≈ 250 kcal, 45 g CHO, no protein) runs the overlay with C_carb sparing (pre-fast carbs excluded)', () => {
    const mod = makeRig(LEAN_MAN);
    const water = makeRig(LEAN_MAN);
    eatDays(mod, 1);
    eatDays(water, 1);
    let modStart = -1;
    for (let h = 24; h < 24 + 6 * 24; h++) {
      const hod = h % 24;
      const soup = hod === 12 || hod === 18;
      mod.step(soup ? 125 : 0, 0, soup ? 22.5 : 0, 0);
      water.step(0, 0, 0, 0);
      if (modStart < 0 && mod.bus.fastActive === 1) {
        modStart = h;
        // pre-fast meals still in the 24-h window do not count as fast carbohydrate (20 §4.4.4)
        expect(mod.s.carbFast24).toBeLessThan(mod.s.carb24);
      }
    }
    expect(mod.bus.fastActive).toBe(1);
    expect(mod.s.carb24).toBeCloseTo(45, 9);
    expect(mod.s.carbFast24).toBeCloseTo(45, 9);
    // both have S_N = 0 and rise = 1 by day 6: the ratio is exactly C_carb(45 g) = 1 − 0.45·0.45
    expect(mod.s.uNGd / water.s.uNGd).toBeCloseTo(carbFactor(mod.k, 45), 12);
    expect(carbFactor(mod.k, 45)).toBeCloseTo(0.7975, 12);
  });

  it('protein ≥ 5 g in 24 h leaves the branch (PSMF/VLED are 03/13), unless a planned span ≥ 24 h covers it', () => {
    const rig = makeRig(LEAN_MAN);
    eatDays(rig, 1);
    for (let h = 0; h < 72; h++) rig.step(h % 24 === 12 ? 60 : 0, h % 24 === 12 ? 15 : 0, 0, 0);
    expect(rig.bus.fastActive).toBe(0);
  });

  it('s_AT: 0 until t_lag, then exact first-order rise with τ_AT; hour-mean multiplier; off with τ_AT,off', () => {
    const rig = makeRig(LEAN_MAN, { fastSpans: [{ startHour: 0, endHour: 30 * 24, electrolytes: true }] });
    let atLag = -1;
    for (let h = 0; h < 21 * 24; h++) {
      rig.step(0, 0, 0, 1);
      if (h === 2 * 24 - 1) atLag = rig.s.sAT;
    }
    expect(atLag).toBe(0);
    // 21 d: s_AT = 1 − e^{−(21 − 2)/9} (start at mid-hour after t_lag: error ≤ 1 h)
    expect(rig.s.sAT).toBeCloseTo(1 - Math.exp(-(21 - 2) / 9), 2);
    const phi = phiAT(rig.k, 15);
    expect(rig.bus.fastRmrMult).toBeLessThan(1 - phi * 0.85);
    // refeed (intake every hour, so the overlay ends at once): s_AT decays with τ 4 d; < 0.05 after 3 weeks (20 §4B.3)
    const s0 = rig.s.sAT;
    rig.step(900, 35, 110, 0);
    const s1 = rig.s.sAT;
    expect(rig.bus.fastActive).toBe(0);
    expect(s1).toBeCloseTo(s0 * Math.exp(-1 / 96), 12);
    for (let h = 1; h < 4 * 24; h++) rig.step(2633 / 24, 100 / 24, 330 / 24, 0);
    expect(rig.s.sAT).toBeCloseTo(s0 * Math.exp(-1), 10);
    eatDays(rig, 17);
    expect(rig.s.sAT).toBeLessThan(0.05);
    eatDays(rig, 120);
    expect(rig.s.sAT).toBe(0);
    expect(rig.bus.fastRmrMult).toBe(1);
  });

  it('S_N relaxes toward S*(BHB) with τ_N 8 d on; 3 d off after a carbohydrate refeed, 7 d after a low-carb refeed', () => {
    const up = makeRig(LEAN_MAN, { fastSpans: [{ startHour: 0, endHour: 40 * 24, electrolytes: true }] });
    up.bus.bhbMmolL = 4.0; // S* = 1
    up.bus.bhbEndoMmolL = 4.0;
    for (let h = 0; h < 8 * 24; h++) up.step(0, 0, 0, 1);
    expect(up.s.sN).toBeCloseTo(1 - Math.exp(-1), 10);
    const hi = makeRig(LEAN_MAN);
    const lo = makeRig(LEAN_MAN);
    // one day of each diet first, so the rolling 24-h carbohydrate reflects the refeed (≥ 50 g vs < 50 g)
    const feed = (days: number): void => {
      for (let h = 0; h < days * 24; h++) {
        const [kc, p, c] = mealAt(h % 24, 2633, 100, 330);
        hi.step(kc, p, c);
        const [kl, pl, cl] = mealAt(h % 24, 2633, 140, 30);
        lo.step(kl, pl, cl);
      }
    };
    feed(1);
    hi.s.sN = 0.8;
    lo.s.sN = 0.8;
    feed(3);
    expect(hi.s.sN).toBeCloseTo(0.8 * Math.exp(-1), 10);
    expect(lo.s.sN).toBeCloseTo(0.8 * Math.exp(-3 / 7), 10);
  });

  it('labile pool fills to L_max·FFM0 and is repleted only on adequate refeeding with τ_rep 2 d (20 §4.9)', () => {
    const rig = makeRig(LEAN_MAN, { fastSpans: [{ startHour: 0, endHour: 72, electrolytes: true }] });
    for (let h = 0; h < 72; h++) rig.step(0, 0, 0, 1);
    const cap = 0.75 * 63.8;
    expect(rig.s.dLabG).toBeCloseTo(cap, 10);
    expect(rig.s.protOxCumG).toBeGreaterThan(cap);
    // low-protein refeed (0.5 g/kg): no repletion
    const low = structuredClone(rig.s);
    for (let h = 0; h < 48; h++) {
      const [kc, p, c] = mealAt(h % 24, 2633, 37, 400);
      rig.step(kc, p, c);
      expect(rig.bus.fastRepletionGH).toBe(0);
    }
    expect(rig.s.dLabG).toBe(low.dLabG);
    // adequate refeed (maintenance, 1.33 g/kg): repletion once the 24-h sums qualify; exact exponential τ 2 d
    let rep = 0;
    let firstRepHour = -1;
    for (let h = 0; h < 10 * 24; h++) {
      const [kc, p, c] = mealAt(h % 24, 2633, 100, 330);
      rig.step(kc, p, c);
      if (firstRepHour < 0 && rig.bus.fastRepletionGH > 0) firstRepHour = h;
      rep += rig.bus.fastRepletionGH;
    }
    expect(firstRepHour).toBeGreaterThanOrEqual(0);
    expect(rep + rig.s.dLabG).toBeCloseTo(cap, 9); // mass conserved
    expect(rig.s.dLabG / cap).toBeLessThan(Math.exp(-(10 * 24 - firstRepHour - 1) / 48) * 1.0001);
  });

  it('refeeding oedema after a 7-d fast follows A·(1 − e^(−t/2))·e^(−t/10) exactly; ×0.3 for a low-carb refeed; none ≤ 3 d', () => {
    const run = (carbD: number, fastDays: number): number[] => {
      const rig = makeRig(LEAN_MAN, {
        fastSpans: [{ startHour: 0, endHour: fastDays * 24, electrolytes: true }],
      });
      for (let h = 0; h < fastDays * 24; h++) rig.step(0, 0, 0, 1);
      const e: number[] = [];
      for (let h = 0; h < 20 * 24; h++) {
        // first refeed hour: a meal that ends the overlay; then intake every hour. The oedema factor uses the day's carbs.
        if (h === 0) rig.step(900, 35, Math.min(110, carbD), 0, 3000, carbD);
        else rig.step(2633 / 24, 100 / 24, carbD / 24, 0, 3000, carbD);
        e.push(rig.bus.fastOedemaL);
      }
      expect(rig.s.lastFastDays).toBe(fastDays);
      return e;
    };
    const e = run(330, 7);
    const A = 0.08 * 4;
    for (const hr of [24, 48, 72, 120, 240, 479]) {
      // hour index hr: the oedema reached after (hr + 1) h of refeeding, the first refeed hour being the fast's end
      expect(e[hr]!).toBeCloseTo(oedemaClosedFormL(A, (hr + 1) / 24, 2, 10), 9);
    }
    expect(Math.max(...e)).toBeGreaterThan(0.15);
    const eLow = run(30, 7);
    expect(eLow[120]!).toBeCloseTo(0.3 * e[120]!, 9);
    const e3 = run(330, 3);
    expect(Math.max(...e3)).toBe(0);
  });

  it('keeps working when maintenance or TDEE are NaN (energy zero-intake guard, review M12)', () => {
    const rig = makeRig(LEAN_MAN, { fastSpans: [{ startHour: 0, endHour: 5 * 24, electrolytes: true }] });
    rig.bus.maintenanceKcalD = Number.NaN;
    rig.bus.tdeeEstKcalD = Number.NaN;
    for (let h = 0; h < 5 * 24; h++) rig.step(0, 0, 0, 1);
    expect(Number.isFinite(rig.bus.fastProtOxGH)).toBe(true);
    expect(rig.bus.fastProtOxGH).toBeGreaterThan(0);
  });
});

/** 5-min Euler reference of S_N and cumulative N for a 7-d fast with a BHB ramp (O-10 style, §0.1: ≤ 2 % state). */
describe('fasting — hourly closed forms vs 5-min Euler reference (§0.1, O-10)', () => {
  it('S_N, s_AT and cumulative protein oxidised stay within 2 % over 7 and 21 days', () => {
    for (const days of [7, 21]) {
      const rig = makeRig(LEAN_MAN, {
        fastSpans: [{ startHour: 0, endHour: days * 24, electrolytes: true }],
      });
      const k = rig.k;
      let sN = 0;
      let sAT = 0;
      let cum = 0;
      const dt = 5 / 60 / 24; // d
      for (let h = 0; h < days * 24; h++) {
        const bhb = bhbRefMmolL(k, h + 0.5, 15);
        rig.bus.bhbMmolL = bhbRefMmolL(k, h, 15); // module sees previous-hour BHB
        rig.bus.bhbEndoMmolL = rig.bus.bhbMmolL;
        rig.step(0, 0, 0, 1);
        for (let q = 0; q < 12; q++) {
          const t = (h + (q + 0.5) / 12) / 24;
          const sStar = sparingTarget(k, bhb);
          sN += (dt * (sStar - sN)) / (sStar >= sN ? 8 : 7);
          sAT += (dt * ((t > 2 ? 1 : 0) - sAT)) / (t > 2 ? 9 : 4);
          const n = urinaryNGd(k, 63.8, 11.3, 15, 2633, sN, t, 0, 0);
          cum += n * 6.25 * dt;
        }
      }
      expect(Math.abs(rig.s.sN - sN) / sN).toBeLessThan(0.02);
      expect(Math.abs(rig.s.sAT - sAT) / sAT).toBeLessThan(0.02);
      expect(Math.abs(rig.s.protOxCumG - cum) / cum).toBeLessThan(0.02);
    }
  });
});

describe('fasting — properties', () => {
  it('zero intake for 21 and 28 days stays finite and bounded (O-6)', () => {
    for (const days of [21, 28]) {
      const rig = makeRig(LEAN_MAN, {
        fastSpans: [{ startHour: 0, endHour: days * 24, electrolytes: true }],
        checks: true,
      });
      let prev = Infinity;
      for (let h = 0; h < days * 24; h++) {
        rig.bus.bhbMmolL = bhbRefMmolL(rig.k, h, 15);
        rig.bus.bhbEndoMmolL = rig.bus.bhbMmolL;
        rig.step(0, 0, 0, 1);
        const b = rig.bus;
        for (const v of [
          b.fastRmrMult,
          b.fastProtOxGH,
          b.fastRepletionGH,
          b.fastOedemaL,
          rig.s.sN,
          rig.s.sAT,
          rig.s.dLabG,
        ])
          expect(Number.isFinite(v)).toBe(true);
        expect(b.fastRmrMult).toBeGreaterThan(0.7);
        expect(b.fastRmrMult).toBeLessThan(1.2);
        expect(b.fastProtOxGH).toBeGreaterThanOrEqual(0);
        expect(rig.s.dLabG).toBeLessThanOrEqual(0.75 * 63.8 + 1e-12);
        // after the day-3 peak, N falls monotonically (fixed FFM/FM on this bus)
        if (h > 4 * 24) {
          expect(b.fastProtOxGH).toBeLessThanOrEqual(prev + 1e-12);
        }
        prev = b.fastProtOxGH;
      }
    }
  });

  it('N is monotone in its drivers: ↑ FFM, ↓ fat mass, ↓ carbohydrate, ↓ exogenous BHB', () => {
    const base = urinaryNGd(K, 60, 15, 20, 2400, 0.3, 4, 0, 0);
    expect(urinaryNGd(K, 65, 15, 20, 2400, 0.3, 4, 0, 0)).toBeGreaterThan(base);
    expect(urinaryNGd(K, 60, 35, 20, 2400, 0.3, 4, 0, 0)).toBeLessThan(base);
    expect(urinaryNGd(K, 60, 15, 20, 2400, 0.3, 4, 40, 0)).toBeLessThan(base);
    expect(urinaryNGd(K, 60, 15, 20, 2400, 0.3, 4, 0, 1)).toBeLessThan(base);
    // more sparing lowers N while late < early
    expect(urinaryNGd(K, 60, 15, 20, 2400, 0.6, 4, 0, 0)).toBeLessThan(base);
  });

  it('is deterministic (bit-identical repeated runs)', () => {
    const run = (): number[] => {
      const rig = makeRig(LEAN_MAN, { fastSpans: [{ startHour: 30, endHour: 30 + 96, electrolytes: true }] });
      const out: number[] = [];
      for (let h = 0; h < 10 * 24; h++) {
        const inFast = h >= 30 && h < 126;
        rig.bus.bhbMmolL = inFast ? bhbRefMmolL(rig.k, h - 30, 15) : 0.1;
        const [kc, p, c] = inFast ? [0, 0, 0] : mealAt(h % 24, 2633, 100, 330);
        rig.step(kc, p, c, inFast ? 1 : 0);
        out.push(rig.bus.fastRmrMult, rig.bus.fastProtOxGH, rig.bus.fastRepletionGH, rig.bus.fastOedemaL);
      }
      return out;
    };
    expect(run()).toEqual(run());
  });
});
