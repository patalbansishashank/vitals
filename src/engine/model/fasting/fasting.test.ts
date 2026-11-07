// @vitest-environment node
/**
 * Unit tests of the fasting module (MODEL_SPEC §1.4; dossier 20 §4.2-4.5, §4.9, §4B). The module is driven directly with
 * hand-built bus values (other modules are written in parallel). Integrated validation targets: fasting.validation.test.ts.
 */
import { checkWiring } from '../../core/moduleRegistry';
import { validateParamDefs } from '../../core/paramsRegistry';
import { SIGNAL_META } from '../../types/signals';
import {
  aSnsFrac,
  bhbRefMmolL,
  carbFactor,
  FASTING_DAILY_NATIVE,
  FASTING_PARAMS,
  FASTING_ROUTING,
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
import { makeRig, mealAt, type FastPerson, type FastingRig } from './testkit';

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

  it('a planned 48-h span does not activate the overlay (D2-01): observed intake routes it, events stay policy metadata (§7.1)', () => {
    const rig = makeRig(LEAN_MAN, { fastSpans: [{ startHour: 44, endHour: 44 + 48, electrolytes: true }] });
    eatDays(rig, 1); // hours 0-23
    for (let h = 24; h < 44; h++) {
      const [kc, p, c] = mealAt(h % 24, 2633, 100, 330);
      rig.step(kc, p, c);
    }
    expect(rig.bus.fastActive).toBe(0);
    rig.step(0, 0, 0, 1); // hour 44 (20:00), last meal at 19:00 (hour 43): planned label, but the 24-h window is full
    expect(rig.bus.fastActive).toBe(0);
    expect(rig.bus.fastHoursH).toBe(0);
    let firstActive = -1;
    for (let h = 45; h < 92; h++) {
      rig.step(0, 0, 0, 1);
      if (firstActive < 0 && rig.bus.fastActive === 1) firstActive = h;
    }
    // the 19:00 meal leaves the 24-h window at hour 67; the clock is back-dated to that meal (20 §2)
    expect(firstActive).toBe(43 + 24);
    expect(rig.bus.fastHoursH).toBe(48);
    rig.step(900, 35, 110, 0); // refeed meal at hour 92
    expect(rig.bus.fastActive).toBe(0);
    expect(rig.bus.fastHoursH).toBe(0);
    expect(rig.s.lastFastDays).toBeCloseTo(2, 12);
    expect(rig.events.list).toEqual([
      { type: 'fastStart', hour: 44, value: 0 },
      { type: 'fastEnd', hour: 92, value: 48 },
    ]);
  });

  it('a planned 16-h span does not activate the overlay but still emits events', () => {
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

  it('a 24-h dinner-to-dinner fast (23-h span, mealToMealH 24) is routed by observed intake only (D2-01)', () => {
    const rig = makeRig(LEAN_MAN, { fastSpans: [{ startHour: 21, endHour: 44, electrolytes: true, mealToMealH: 24 }] });
    for (let h = 0; h < 21; h++) {
      const [kc, p, c] = mealAt(h % 24, 2633, 100, 330);
      rig.step(kc, p, c);
    }
    const activeHours: number[] = [];
    for (let h = 21; h < 44; h++) {
      rig.step(0, 0, 0, 1);
      if (rig.bus.fastActive === 1) activeHours.push(h);
    }
    // the 19:00 dinner (hour 19) leaves the rolling 24-h window at hour 43: only that hour satisfies the criteria
    expect(activeHours).toEqual([43]);
    expect(rig.bus.fastHoursH).toBe(24);
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

  it('protein ≥ 5 g in 24 h leaves the branch (PSMF/VLED are 03/13), also under a planned 72-h fast label (D2-01)', () => {
    for (const planned of [0, 1]) {
      const rig = makeRig(LEAN_MAN, planned ? { fastSpans: [{ startHour: 24, endHour: 96, electrolytes: true }] } : {});
      eatDays(rig, 1);
      for (let h = 0; h < 72; h++) {
        rig.step(h % 24 === 12 ? 60 : 0, h % 24 === 12 ? 15 : 0, 0, planned);
        expect(rig.bus.fastActive).toBe(0);
      }
    }
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
      let firstActive = -1;
      for (let h = 0; h < days * 24; h++) {
        const bhb = bhbRefMmolL(k, h + 0.5, 15);
        rig.bus.bhbMmolL = bhbRefMmolL(k, h, 15); // module sees previous-hour BHB
        rig.bus.bhbEndoMmolL = rig.bus.bhbMmolL;
        rig.step(0, 0, 0, 1);
        // the overlay starts once the habitual day has left the rolling 24-h window (D2-01); N accrues from then on
        const on = rig.bus.fastActive === 1;
        if (on && firstActive < 0) firstActive = h;
        for (let q = 0; q < 12; q++) {
          const t = (h + (q + 0.5) / 12) / 24;
          const sStar = sparingTarget(k, bhb);
          sN += (dt * (sStar - sN)) / (sStar >= sN ? 8 : 7);
          sAT += (dt * ((t > 2 ? 1 : 0) - sAT)) / (t > 2 ? 9 : 4);
          const n = urinaryNGd(k, 63.8, 11.3, 15, 2633, sN, t, 0, 0);
          if (on) cum += n * 6.25 * dt;
        }
      }
      // modified-fast criteria met after 23 zero-intake hours; the clock is back-dated to t = 0 (no intake since)
      expect(firstActive).toBe(22);
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

// ================================================================== D2-01: observed-history routing (causal boundary C2)

/** Every physiological output and state of the overlay after the current hour (the policy events are excluded). */
function physiology(rig: FastingRig): number[] {
  const b = rig.bus;
  const s = rig.s;
  return [
    b.fastActive,
    b.fastHoursH,
    b.fastRmrMult,
    b.fastProtOxGH,
    b.fastRepletionGH,
    b.fastOedemaL,
    s.sAT,
    s.sN,
    s.dLabG,
    s.eOedL,
    s.oedPendingL,
    s.lastFastDays,
    s.hoursSinceIntakeH,
    s.uNGd,
    s.kcal24,
    s.protein24,
    s.carb24,
    s.carbFast24,
  ];
}

type Span = { startHour: number; endHour: number; electrolytes: boolean; mealToMealH?: number };
/** Realised intake of one hour: kcal, protein g, carbohydrate g, day sodium mg, day carbohydrate g. */
type Intake = (h: number) => [number, number, number, number, number];

/** Drive a rig with the same realised intake under the given fast metadata; returns per-hour physiology and the rig. */
function replay(hours: number, intake: Intake, spans: Span[], bhb?: (h: number) => number): { series: number[][]; rig: FastingRig } {
  const rig = makeRig(LEAN_MAN, { fastSpans: spans });
  const series: number[][] = [];
  for (let h = 0; h < hours; h++) {
    if (bhb) {
      rig.bus.bhbMmolL = bhb(h);
      rig.bus.bhbEndoMmolL = rig.bus.bhbMmolL;
    }
    const planned = spans.some((sp) => h >= sp.startHour && h < sp.endHour) ? 1 : 0;
    const [kc, p, c, na, dayC] = intake(h);
    rig.step(kc, p, c, planned, na, dayC);
    series.push(physiology(rig));
  }
  return { series, rig };
}

describe('fasting — D2-01 future fast metadata has no physiological effect', () => {
  // realised history: habitual days, dinner at 19:00 (hour 43), zero intake hours 44-91, refeed meal at hour 92, habitual after
  const FAST_FROM = 44;
  const FAST_TO = 92;
  const intake: Intake = (h) => {
    if (h >= FAST_FROM && h < FAST_TO) return [0, 0, 0, 3000, 0];
    if (h === FAST_TO) return [900, 35, 110, 3000, 300];
    const [kc, p, c] = mealAt(h % 24, 2633, 100, 330);
    return [kc, p, c, 3000, 330];
  };
  // BHB as the ketones module would see it over this history (fasting physiology also reads it): same in every variant
  const bhb = (h: number): number => (h >= FAST_FROM && h < FAST_TO ? bhbRefMmolL(K, h - FAST_FROM, 15) : 0.1);
  const HOURS = 8 * 24;
  const variants: Record<string, Span[]> = {
    none: [],
    'dinner-to-dinner 24 h (23-h span)': [{ startHour: FAST_FROM, endHour: FAST_FROM + 23, electrolytes: true, mealToMealH: 24 }],
    '24 h': [{ startHour: FAST_FROM, endHour: FAST_FROM + 24, electrolytes: true, mealToMealH: 25 }],
    '48 h': [{ startHour: FAST_FROM, endHour: FAST_TO, electrolytes: true, mealToMealH: 49 }],
    // a planned 72-h fast the person interrupted with the refeed at hour 92: the label still runs to hour 116
    'interrupted 72 h': [{ startHour: FAST_FROM, endHour: FAST_FROM + 72, electrolytes: true, mealToMealH: 73 }],
  };
  const base = replay(HOURS, intake, variants.none!, bhb);

  it.each(Object.keys(variants).filter((v) => v !== 'none'))(
    'identical realised intake under a "%s" label gives a bit-identical physiological history',
    (name) => {
      const run = replay(HOURS, intake, variants[name]!, bhb);
      expect(run.series).toEqual(base.series);
    },
  );

  it('the overlay starts when the last meal leaves the observed 24-h window, whatever the label', () => {
    const first = base.series.findIndex((x) => x[0] === 1);
    expect(first).toBe(43 + 24);
    expect(base.series[first]![1]).toBe(24); // back-dated to the 19:00 dinner (20 §2)
    expect(base.series[FAST_TO - 1]![1]).toBe(FAST_TO - 1 - 43);
  });

  it('planned metadata survives as policy events only (label and duration preserved, no physiology)', () => {
    expect(base.rig.events.list).toEqual([]);
    const r48 = replay(HOURS, intake, variants['48 h']!, bhb);
    expect(r48.rig.events.list).toEqual([
      { type: 'fastStart', hour: FAST_FROM, value: 0 },
      { type: 'fastEnd', hour: FAST_TO, value: 48 },
    ]);
    const rInt = replay(HOURS, intake, variants['interrupted 72 h']!, bhb);
    expect(rInt.rig.events.list.at(-1)).toEqual({ type: 'fastEnd', hour: FAST_FROM + 72, value: 72 });
  });

  it('the activation parameter is gone; the remaining criteria are labelled legacy routing thresholds', () => {
    expect(FASTING_PARAMS.some((p) => p.id === 'fasting.plannedMinSpanH')).toBe(false);
    for (const id of ['fastKcalFrac', 'fastProteinMaxG', 'fastCarbMaxG', 'modKcalFrac']) {
      const p = FASTING_PARAMS.find((x) => x.id === `fasting.${id}`)!;
      expect(p.low).toBe(p.value);
      expect(p.high).toBe(p.value);
      expect(p.distribution?.label).toBe('engineeringDefault');
      expect(p.distribution?.uncertaintyKind).toBe('heuristic');
      expect(p.note).toMatch(/D2-01/);
    }
    expect(FASTING_ROUTING.status).toBe('approximation');
    expect(FASTING_ROUTING.policyOnly).toContain('CompiledSchedule.fastSpans');
    expect(SIGNAL_META.fastActive?.status).toBe('approximation');
  });
});

describe('fasting — D2-01 observed prefix, censoring and daily-native inputs', () => {
  // a 5-day water-only fast from t = 0 (habitual ring before it), refeed day = day 5 (hours 120-143)
  const REFEED = 120;
  const NOON = REFEED + 12;
  /** Same refeed breakfast; the rest of the refeed day differs (low-carb, salt-free vs carbohydrate and salt). */
  const refeedDay =
    (rest: 'low' | 'high'): Intake =>
    (h) => {
      const na = rest === 'low' ? 1000 : 3500;
      const dayC = rest === 'low' ? 40 : 250;
      if (h < REFEED) return [0, 0, 0, 3000, 0];
      if (h < REFEED + 24) {
        if (h === REFEED) return [600, 25, 15, na, dayC];
        if (h < NOON) return [0, 0, 0, na, dayC];
        if (h === NOON + 1) return rest === 'low' ? [900, 60, 10, na, dayC] : [1100, 40, 120, na, dayC];
        if (h === NOON + 7) return rest === 'low' ? [900, 60, 15, na, dayC] : [1100, 40, 115, na, dayC];
        return [0, 0, 0, na, dayC];
      }
      const [kc, p, c] = mealAt(h % 24, 2633, 100, 330);
      return [kc, p, c, 3000, 330];
    };
  const low = replay(REFEED + 24, refeedDay('low'), []);
  const high = replay(REFEED + 24, refeedDay('high'), []);
  /** Indices into `physiology()` of the observed-event quantities: overlay flag, clocks, N/protein, pools, completed fast. */
  const OBSERVED_IDX = [0, 1, 2, 3, 4, 6, 7, 8, 11, 12, 13, 14, 15, 16, 17];
  const pick = (row: number[]): number[] => OBSERVED_IDX.map((i) => row[i]!);

  it('a later meal the same day leaves earlier event values and the intake-event clock unchanged', () => {
    for (let h = 0; h <= NOON; h++) expect(pick(low.series[h]!), `hour ${h}`).toEqual(pick(high.series[h]!));
    expect(low.series[REFEED]![11]).toBeCloseTo(5, 12); // the completed 5-day fast, observed at its end
    expect(low.series[REFEED]![12]).toBe(0); // the breakfast ended the intake-event clock in its own hour
  });

  it('the daily-native refeed-oedema estimate may change with the completed day and is declared daily', () => {
    // 20 §4.5.2 gate on the whole refeed day: salt-free/low-carbohydrate day × 0.3 even before those meals happen
    expect(low.series[NOON]![5]).toBeGreaterThan(0);
    expect(low.series[NOON]![5]).toBeCloseTo(0.3 * high.series[NOON]![5]!, 9);
    expect(FASTING_DAILY_NATIVE).toEqual([{ signal: 'fastOedemaL', dayInputs: ['sodiumMg', 'carbG'], resolution: 'daily' }]);
    for (const d of FASTING_DAILY_NATIVE) expect(fastingModule.writes).toContain(d.signal);
  });

  // Stronger event-prefix challenge (D2-01 research item, C2): F(state, exposure ≤ t) for every output. The refeed gate
  // still reads the completed day, so this stays an explicit open item until the causal event-time refactor is fitted.
  it.fails('UNRESOLVED: refeed oedema before the later meals is invariant to what is eaten after them', () => {
    for (let h = REFEED; h <= NOON; h++) expect(low.series[h]![5]).toBe(high.series[h]![5]);
  });

  it('a running fast is censored at now; ingestion ends the intake-event clock in its hour; alternatives never rewrite it', () => {
    const NOW = 74; // observed through hour 73: dinner at hour 43, zero intake since
    const observed: Intake = (h) => {
      if (h < 44) {
        const [kc, p, c] = mealAt(h % 24, 2633, 100, 330);
        return [kc, p, c, 3000, 330];
      }
      return [0, 0, 0, 3000, 0];
    };
    // the day containing NOW (hours 72-95) carries each alternative's own day totals, also in its observed hours 72-73
    const continuation = (alt: 'continue' | 'imputedMeal' | 'coffee'): Intake => (h) => {
      const dayC = h >= 72 ? (alt === 'imputedMeal' ? 80 : alt === 'coffee' ? 4 : 0) : 0;
      if (h < NOW) return [...observed(h).slice(0, 3), 3000, h < 44 ? 330 : dayC] as [number, number, number, number, number];
      if (alt === 'imputedMeal' && h === NOW + 2) return [700, 30, 80, 3000, dayC];
      if (alt === 'coffee' && h === NOW) return [60, 3, 4, 3000, dayC];
      return [0, 0, 0, 3000, dayC];
    };
    const censored = replay(NOW, observed, [{ startHour: 44, endHour: 44 + 48, electrolytes: true, mealToMealH: 49 }]);
    const at = censored.series[NOW - 1]!;
    expect(at[1]).toBe(NOW - 1 - 43); // elapsed hours since the last intake, not the intended 48 h
    expect(at[12]).toBe(NOW - 1 - 43);
    expect(at[11]).toBe(0); // no completed fast is reported for a running one
    const runs = (['continue', 'imputedMeal', 'coffee'] as const).map((alt) => ({
      alt,
      run: replay(NOW + 24, continuation(alt), [{ startHour: 44, endHour: 44 + 48, electrolytes: true, mealToMealH: 49 }]),
    }));
    for (const { run } of runs) expect(run.series.slice(0, NOW)).toEqual(censored.series);
    const coffee = runs.find((r) => r.alt === 'coffee')!.run.series;
    const meal = runs.find((r) => r.alt === 'imputedMeal')!.run.series;
    // 60 kcal is an intake event (> 50 kcal tolerance): the intake-event clock ends in that hour, while the legacy
    // routing (24-h sums still below the criteria) keeps the physiological overlay running: two separate quantities
    expect(coffee[NOW]![12]).toBe(0);
    expect(coffee[NOW]![0]).toBe(1);
    expect(meal[NOW + 2]![12]).toBe(0);
    expect(meal[NOW + 2]![0]).toBe(0);
    expect(meal[NOW + 2]![11]).toBeCloseTo((NOW + 2 - 44) / 24, 12); // zero-intake hours 44-75
  });

  it('an observed-day status closes to daily through the declared daily-native inputs (provider fixture)', async () => {
    const { weakestResolution } = await import('@/lib/bodyContracts');
    expect(weakestResolution('eventPrefix', ...FASTING_DAILY_NATIVE.map((d) => d.resolution))).toBe('daily');
  });
});
