// @vitest-environment node
/**
 * WP-M2 acceptance targets (MODEL_SPEC §1.3 "Validation", §11.3): 07 §4.1 t95; 03 V6 Trommelen appearance;
 * 04 §4.16 Taylor and §4.17 Acheson checks; 15 V1-V3 (fibre/nut ME, module path), V9-V10 (alcohol), V13 (caffeine
 * residual), V14-V15 (creatine). The module is driven directly (other modules are stubs).
 */
import { MF, MEAL_FIELDS } from '../index';
import { makeHarness, WOMAN_65, type Harness } from './harness';

/** Gut energy left in meal slot 0. */
const gut = (H: Harness, slot = 0) => H.s.meals[slot * MEAL_FIELDS + MF.GUT]!;

/** Excursion above today's fasting baseline, mmol/L. */
function glucoseExcursion(H: Harness): number {
  const tpa = Math.min(H.s.hoursPostAbsorptive, H.k.fastGlcTable.length - 1);
  return H.bus.glucoseMmolL - H.s.glcFastToday * H.k.fastGlcTable[tpa]!;
}

/** 700-kcal mixed meal: 30 g protein, 90 g carbohydrate (70 glucose-eq + 20 fructose), 23.56 g fat, 4 g fibre. */
const MIXED_700 = { proteinG: 30, carbG: 90, glucoseEqG: 70, fructoseG: 20, fatG: 23.555555555555557, fibreG: 4, glycaemicIndex: 55, timeToPeakH: 1 };

describe('07 §4.1 gastric emptying and the absorptive state', () => {
  it('a 700-kcal mixed meal stays absorptive 4.6 h (t95) ± 0.5 h', () => {
    const H = makeHarness();
    H.eat(MIXED_700);
    const e0 = 4 * 30 + 4 * 90 + 9 * 23.555555555555557 + 2 * 4;
    expect(e0).toBeCloseTo(700, 9);
    const V = H.k.gutKge;
    const K = H.k.gutKGE;
    const target = 0.05 * e0;
    let prev = e0;
    let t95 = NaN;
    let fedHours = 0;
    for (let h = 0; h < 12; h++) {
      H.step();
      fedHours += H.bus.fedState;
      const now = gut(H);
      if (Number.isNaN(t95) && now <= target) {
        // exact crossing time inside this hour from the module's state at the start of the hour
        const within = (prev - target + K * Math.log(prev / target)) / V;
        t95 = h + (h === 0 ? H.k.gutLag : 0) + within;
      }
      prev = now;
    }
    expect(Math.abs(t95 - 4.6)).toBeLessThanOrEqual(0.5);
    expect(fedHours).toBe(5); // hour means ≥ 30 kcal/h: 08:00-13:00
  });

  it('reproduces the scintigraphy fit: 255-kcal meal retention 69/24/0.9 % at 1/2/4 h (observed 69/24/1.2)', () => {
    const H2 = makeHarness();
    H2.eat({ proteinG: 0, carbG: 0, fatG: 0, fibreG: 127.5 }); // 255 kcal gut energy (fibre is only a carrier here)
    const r: number[] = [];
    for (let h = 0; h < 4; h++) {
      H2.step();
      r.push(gut(H2) / 255);
    }
    expect(Math.abs(r[0]! - 0.69)).toBeLessThan(0.03);
    expect(Math.abs(r[1]! - 0.24)).toBeLessThan(0.03);
    expect(Math.abs(r[3]! - 0.009)).toBeLessThan(0.01);
  });

  it('fat appears at the meal fat share of the emptied energy and totals the meal fat', () => {
    const H = makeHarness();
    H.eat({ ...MIXED_700, mctG: 5 });
    let fat = 0;
    let mct = 0;
    for (let h = 0; h < 24; h++) {
      H.step();
      fat += H.bus.raFatGH;
      mct += H.bus.raMctGH;
      if (h === 0) expect(H.bus.raFatGH / H.bus.absFluxKcalH).toBeCloseTo(23.555555555555557 / 700, 12);
    }
    expect(fat).toBeCloseTo(23.555555555555557, 6);
    expect(mct).toBeCloseTo(5, 6);
  });
});

describe('03 V6 — Trommelen 2023 plasma appearance of dietary protein (±7 points)', () => {
  const appearance = (grams: number) => {
    const H = makeHarness();
    H.eat({ proteinG: grams, proteinSpeed: 1.0, proteinQMeal: 1.06 });
    let cum = 0;
    const at: number[] = [];
    for (let h = 1; h <= 12; h++) {
      H.step();
      cum += H.bus.raProtGH;
      if (h === 4 || h === 8 || h === 12) at.push((100 * H.k.protFsys * cum) / grams);
    }
    return at;
  };
  it('25 g milk protein: 51/62/66 % at 4/8/12 h', () => {
    const a = appearance(25);
    [51, 62, 66].forEach((obs, i) => expect(Math.abs(a[i]! - obs)).toBeLessThanOrEqual(7));
  });
  it('100 g milk protein: 26/44/53 % at 4/8/12 h', () => {
    const a = appearance(100);
    [26, 44, 53].forEach((obs, i) => expect(Math.abs(a[i]! - obs)).toBeLessThanOrEqual(7));
  });
  it('the systemic AA signal A_lag scales with Q_meal and all protein is digested', () => {
    const run = (q: number) => {
      const H = makeHarness();
      H.eat({ proteinG: 40, proteinSpeed: 1.6, proteinQMeal: q });
      let peak = 0;
      let dig = 0;
      for (let h = 0; h < 60; h++) {
        H.step();
        peak = Math.max(peak, H.bus.raAaQGH);
        dig += H.bus.raProtGH;
      }
      return { peak, dig, end: H.bus.raAaQGH };
    };
    const whey = run(1.15);
    const ref = run(1.0);
    expect(whey.peak / ref.peak).toBeCloseTo(1.15, 12);
    expect(whey.dig).toBeCloseTo(40, 6);
    expect(whey.end).toBeLessThan(1e-6);
  });
});

describe('04 §4.16-4.17 glucose and insulin excursion checks', () => {
  it('Taylor 1996: 139 g glucose + 29 g protein + 17 g fat (liquid, 08:00) → peak Δ 3.6 vs observed 3.4 ± 1.0 mmol/L', () => {
    const H = makeHarness(undefined, { startHourOfDay: 8 });
    H.eat({ carbG: 139, glucoseEqG: 139, proteinG: 29, fatG: 17, glycaemicIndex: 100, timeToPeakH: 0.5 });
    let peak = 0;
    for (let h = 0; h < 8; h++) {
      H.step();
      peak = Math.max(peak, glucoseExcursion(H));
    }
    expect(peak).toBeCloseTo(3.62, 1);
    expect(Math.abs(peak - 3.4)).toBeLessThanOrEqual(1.0);
  });

  it('Acheson 1982: 479 g starch meal → insulin peak ≈154 vs observed 139 µU/mL (± 40 %)', () => {
    const H = makeHarness();
    H.eat({ carbG: 479, glucoseEqG: 479, glycaemicIndex: 100, timeToPeakH: 1.5 });
    let peak = 0;
    for (let h = 0; h < 12; h++) {
      H.step();
      peak = Math.max(peak, H.bus.insulinUuMl);
    }
    expect(Math.abs(peak - 139) / 139).toBeLessThanOrEqual(0.4);
    // the amplitude itself is the dossier's 154 (slot 0)
    expect(H.s.meals[MF.IAMP]!).toBeCloseTo(153.7, 1);
  });

  it('75 g OGTT → insulin excursion ≈ 50 µU/mL above fasting (04 §4.17 fit point)', () => {
    const H = makeHarness();
    H.eat({ carbG: 75, glucoseEqG: 75, glycaemicIndex: 100, timeToPeakH: 0.5 });
    let peak = 0;
    for (let h = 0; h < 6; h++) {
      H.step();
      peak = Math.max(peak, H.bus.insulinUuMl);
    }
    // hour-midpoint sampling of y·e^{1−y} with t_p + 0.25 = 0.75 h: first midpoint y = 0.667 → 0.94 of the peak
    expect(peak - H.s.insFastToday).toBeGreaterThan(0.9 * 50);
    expect(peak - H.s.insFastToday).toBeLessThanOrEqual(50 + 1e-9);
  });
});

describe('15 §4.10 alcohol (V9, V10)', () => {
  /** Resting fat-oxidation suppression implied by the spec's fuel rule (MODEL_SPEC §1.6 step 4: fat ox is the residual of
   *  EE_np = teePre − 7·alcOx; at rest f_C,pa = 0.45, 04 §4.10). */
  const suppression = (rmrKcalH: number, alcOxGH: number) => {
    const fC = 0.45;
    const base = ((1 - fC) * rmrKcalH) / 9.4;
    const withAlc = ((1 - fC) * Math.max(0, rmrKcalH - 7 * alcOxGH)) / 9.4;
    return 1 - withAlc / base;
  };

  it('V9 Siler 1999 (24 g ethanol, men): fat oxidation −60 to −85 % during clearance; clears at k_ox·BW', () => {
    const H = makeHarness();
    H.eat({ alcoholG: 24 });
    const rmrH = H.profile.rmr0Kcal / 24;
    let hours = 0;
    let supSum = 0;
    let ox = 0;
    for (let h = 0; h < 10; h++) {
      H.step();
      ox += H.bus.alcOxGH;
      if (H.bus.alcOxGH > 0) {
        hours++;
        supSum += suppression(rmrH, H.bus.alcOxGH);
      }
    }
    expect(ox).toBeCloseTo(24, 9);
    expect(hours).toBe(3); // 8 g/h for an 80-kg man
    const mean = supSum / hours;
    expect(mean).toBeGreaterThanOrEqual(0.6);
    expect(mean).toBeLessThanOrEqual(0.85);
    expect(H.bus.etohPoolG).toBe(0);
  });

  it('V9 women (k_ox 0.085 g/kg/h) stays inside the band', () => {
    const H = makeHarness(WOMAN_65);
    H.eat({ alcoholG: 24 });
    H.step();
    expect(H.bus.alcOxGH).toBeCloseTo(0.085 * 65, 9);
    const sup = suppression(H.profile.rmr0Kcal / 24, H.bus.alcOxGH);
    expect(sup).toBeGreaterThanOrEqual(0.6);
    expect(sup).toBeLessThanOrEqual(0.85);
  });

  it('V10 Suter 1992 (96 g/d added in the daytime): all oxidised within the day, 672 kcal appear, dFatOx −400 to −480 kcal/d', () => {
    const H = makeHarness(undefined, { startHourOfDay: 0 });
    let ox = 0;
    let eAlc = 0;
    for (let h = 0; h < 24; h++) {
      if (h === 8 || h === 12 || h === 16 || h === 20) H.eat({ alcoholG: 24 });
      H.step();
      ox += H.bus.alcOxGH;
      eAlc += H.bus.eAbsKcalH; // only alcohol is eaten
    }
    expect(ox).toBeCloseTo(96, 9);
    expect(eAlc).toBeCloseTo(672, 6);
    const phi = 0.66; // 15 §4.10 partition of displaced oxidation onto fat (Suter [98])
    const dFatOx = -phi * Math.min(eAlc, 1290); // 24-h fat oxidation base ≈ 49.4 g / 0.36 ≈ 137 g ≈ 1,290 kcal
    expect(dFatOx).toBeLessThanOrEqual(-400);
    expect(dFatOx).toBeGreaterThanOrEqual(-480);
  });

  it('V11 hand-off: 1.5 g/kg alcohol keeps etohPoolG > 0 beyond the 8-h post-exercise window muscle uses', () => {
    const H = makeHarness();
    H.eat({ alcoholG: 1.5 * 80 });
    H.idle(8);
    expect(H.bus.etohPoolG).toBeGreaterThan(0);
  });
});

describe('15 §4.11 caffeine (V13)', () => {
  const residualAt = (dose: number, hoursBeforeBed: number) => {
    const H = makeHarness(undefined, { startHourOfDay: 6 });
    H.eat({ caffeineMg: dose });
    const L: number[] = [dose];
    for (let n = 1; n <= 16; n++) {
      H.step();
      L.push(H.bus.caffeineLoadMg); // load n hours after the dose
    }
    const lo = Math.floor(hoursBeforeBed);
    const fr = hoursBeforeBed - lo;
    return Math.exp(Math.log(L[lo]!) + fr * (Math.log(L[lo + 1]!) - Math.log(L[lo]!)));
  };
  it('Gardiner 2023 cut-offs: 107 mg at 8.8 h → 35 mg; 217.5 mg at 13.2 h → 40 mg (t½ 5.4 h, R* ≈ 37 mg)', () => {
    expect(residualAt(107, 8.8)).toBeCloseTo(35, 0);
    expect(residualAt(217.5, 13.2)).toBeCloseTo(40, 0);
  });
  it('combined oral contraceptive lengthens t½ ×1.47', () => {
    const H = makeHarness({ ...WOMAN_65, cycle: { tracking: false, contraception: 'combinedOral' } });
    H.eat({ caffeineMg: 100 });
    H.step();
    expect(H.bus.caffeineLoadMg).toBeCloseTo(100 * Math.pow(2, -1 / (5.4 * 1.47)), 9);
  });
  it('smoking shortens t½ ×0.56 (Joeres 1988), stacking with the contraceptive multiplier', () => {
    const H = makeHarness({ ...WOMAN_65, habits: { smoker: true } });
    H.eat({ caffeineMg: 100 });
    H.step();
    expect(H.bus.caffeineLoadMg).toBeCloseTo(100 * Math.pow(2, -1 / (5.4 * 0.56)), 9);
    const B = makeHarness({ ...WOMAN_65, habits: { smoker: true }, cycle: { tracking: false, contraception: 'combinedOral' } });
    B.eat({ caffeineMg: 100 });
    B.step();
    expect(B.bus.caffeineLoadMg).toBeCloseTo(100 * Math.pow(2, -1 / (5.4 * 1.47 * 0.56)), 9);
  });
});

describe('15 §4.12 creatine (V14, V15) through the module', () => {
  it('V14: 20 g/d × 6 d → x 0.19-0.20; V15: 25 g/d × 7 d → W_Cr 0.5-1.0 kg; then 5 g/d to day 28 → 0.7-1.2 kg', () => {
    const H = makeHarness(undefined, { startHourOfDay: 0 });
    H.day.creatineG = 20;
    H.idle(24 * 6);
    const x6 = H.bus.creatineSatFrac * H.k.crXMax;
    expect(x6).toBeGreaterThanOrEqual(0.19);
    expect(x6).toBeLessThanOrEqual(0.2);

    const P = makeHarness(undefined, { startHourOfDay: 0 });
    P.day.creatineG = 25;
    P.idle(24 * 7);
    const w7 = 0.9 * P.bus.creatineSatFrac; // water module: W_Cr = 0.9 kg · creatineSatFrac (spec §1.10)
    expect(w7).toBeGreaterThanOrEqual(0.5);
    expect(w7).toBeLessThanOrEqual(1.0);
    P.day.creatineG = 5;
    P.idle(24 * 21);
    const w28 = 0.9 * P.bus.creatineSatFrac;
    expect(w28).toBeGreaterThanOrEqual(0.7);
    expect(w28).toBeLessThanOrEqual(1.2);
  });

  it('loading flag = 0.3 g/kg/d; non-responder range lowers saturation to ×0.25', () => {
    const H = makeHarness(undefined, { startHourOfDay: 0 });
    H.day.creatineG = 5;
    H.day.creatineLoading = true;
    H.idle(24);
    const R = makeHarness(undefined, { startHourOfDay: 0 });
    R.day.creatineG = 24; // 0.3 × 80 kg
    R.idle(24);
    expect(H.s.creatineX).toBeCloseTo(R.s.creatineX, 12);
    const N = makeHarness(undefined, { startHourOfDay: 0, overrides: { 'intake.crResponder': 0.25 } });
    N.day.creatineG = 20;
    N.idle(24 * 30);
    expect(N.bus.creatineSatFrac).toBeCloseTo(0.25, 2);
  });
});

describe('15 V1-V3 through the module (fibre EMA and daily ME correction)', () => {
  it('V1: at steady 40 g vs 21 g fibre on 2,550 kcal the module corrects −30 to −90 kcal/d relative', () => {
    const run = (fibre: number) => {
      const H = makeHarness(undefined, { startHourOfDay: 0 });
      H.day.energyKcal = 2550;
      H.day.fibreG = fibre;
      H.idle(24 * 30);
      H.step(); // startDay of day 30 reads the settled F_eff
      return { fEff: H.s.fibreEffG, dme: H.s.dmeKcalD };
    };
    const hi = run(40);
    const lo = run(21);
    expect(hi.fEff).toBeCloseTo(40, 2);
    expect(lo.fEff).toBeCloseTo(21, 2);
    const d = hi.dme - lo.dme;
    expect(d).toBeLessThanOrEqual(-30);
    expect(d).toBeGreaterThanOrEqual(-90);
  });

  it('V3: 84 g whole raw almonds → −120 to −140 kcal/d; nut fibre excluded from F_eff', () => {
    const H = makeHarness(undefined, { startHourOfDay: 0 });
    H.day.energyKcal = 2400;
    H.day.fibreG = 8 * 2.4 + 0.11 * 84; // typical density + the almonds' own fibre
    H.day.nutsG = 84;
    H.day.nutDelta = 0.25;
    H.idle(24 * 30);
    H.step();
    expect(H.s.fibreEffG).toBeCloseTo(8 * 2.4, 2);
    expect(H.s.dmeKcalD).toBeLessThanOrEqual(-120);
    expect(H.s.dmeKcalD).toBeGreaterThanOrEqual(-140);
  });

  it('F_eff follows a fibre step with τ_F = 3 d', () => {
    const H = makeHarness(undefined, { startHourOfDay: 0 });
    H.day.fibreG = 16;
    H.idle(24 * 20);
    const f0 = H.s.fibreEffG;
    expect(f0).toBeCloseTo(16, 1);
    H.day.fibreG = 40;
    H.idle(24 * 3);
    expect(H.s.fibreEffG).toBeCloseTo(40 + (f0 - 40) * Math.exp(-1), 9);
  });
});
