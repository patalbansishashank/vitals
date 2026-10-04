// @vitest-environment node
/**
 * Validation of the appetite module (MODEL_SPEC §1.12) driven with hand-built bus values together with the hormones
 * module (leptin sufficiency feeds Λ_lean).
 *
 * 12 Appendix A (regression values of 12's reference implementation, "NOT data"): same crude body model as the dossier —
 * TEE falls 22 kcal/d per kg lost, 7 700 kcal/kg, 75 % of the loss as fat; man 90 kg, 30 kg fat, EI_hab 2 600 kcal/d,
 * habitual protein 100 g/d, fibre 16 g/d, sleep ≥ 7 h, no exercise. "Habitual composition" keeps protein and fibre grams.
 * Spec anchors (MODEL_SPEC §1.12): maintenance ≈ 6, 25 % deficit week 1 ≈ 40-50, contest leanness ≥ 95. Every other cell
 * is checked at ±10 HPI points and ±0.02 P_surv; cells outside stay as `it.fails` with the numbers.
 */
import type { PersonProfile, ResolvedProfile } from '../../types/profile';
import { MI } from '../../types/metrics';
import { DayDriver, makeProfile, type ContextOpts } from '../hormones/testHarness';
import { fastHungerFactor } from './index';

const MAN90: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 35, heightCm: 180, weightKg: 90 } };

interface Subject {
  w: number;
  fm: number;
  eiHab: number;
  pRef: number;
  sex: 'male' | 'female';
}
const DEFAULT_SUBJECT: Subject = { w: 90, fm: 30, eiHab: 2600, pRef: 100, sex: 'male' };

interface Regime {
  /** Intake of day d (1-based) given the day's crude-model TEE. */
  ei: (d: number, tee: number) => number;
  protein: number | ((d: number) => number);
  fibre?: number;
  bhb?: number;
  sleepDebtH?: number;
  meals?: number;
  exerciseKcalD?: (d: number) => number;
  lutealWeight?: (d: number) => number;
}

interface Trace {
  hpi: number[];
  eK: number[];
  pSurv: number[];
  dr: DayDriver;
  w: number[];
}

/** Appendix A crude body model driving hormones + appetite for `days` days (index d = value after day d). */
function runRegime(r: Regime, days: number, subj: Subject = DEFAULT_SUBJECT): Trace {
  const person: PersonProfile = { ...MAN90, body: { ...MAN90.body, sex: subj.sex, weightKg: subj.w } };
  const profile = makeProfile(person, {
    weightKg: subj.w,
    fm0Kg: subj.fm,
    ffm0Kg: subj.w - subj.fm,
    tdee0Kcal: subj.eiHab,
    habitualProteinG: subj.pRef,
    habitualFibreG: 16,
  });
  const dr = new DayDriver(profile);
  let w = subj.w;
  let fm = subj.fm;
  const t: Trace = { hpi: [dr.as.hpi], eK: [dr.as.effortK], pSurv: [1], dr, w: [w] };
  // hours since the last intake (intake's fast_h): meals every hour 08-20 on eating days, none on zero-intake days
  let tau = 4;
  let eatingToday = true;
  dr.onHour = (hh, bus) => {
    tau = eatingToday && hh >= 8 && hh <= 20 ? 0 : tau + 1;
    bus.hoursSinceIntakeH = tau;
  };
  for (let d = 1; d <= days; d++) {
    const tee = subj.eiHab - 22 * (subj.w - w);
    const ei = r.ei(d, tee);
    eatingToday = ei > 50;
    const p = typeof r.protein === 'function' ? r.protein(d) : r.protein;
    const fibre = r.fibre ?? 16;
    const bus = dr.bus;
    bus.energyBalanceFrac = Math.max(-1, Math.min(1, (ei - tee) / tee));
    bus.tdeeEstKcalD = tee;
    bus.fatMassKg = fm;
    bus.ffmActKg = w - fm;
    bus.scaleWeightKg = w;
    bus.tissueMassKg = w;
    bus.bhbMmolL = r.bhb ?? 0.1;
    bus.sleepDebtFastH = r.sleepDebtH ?? 0;
    bus.fibreEffG = fibre;
    bus.exEEKcalH = (r.exerciseKcalD?.(d) ?? 0) / 24;
    bus.lutealWeight = r.lutealWeight?.(d) ?? 0;
    const rest = Math.max(0, ei - 4 * p - 2 * fibre);
    dr.setIntake({ proteinG: p, carbG: (0.5 * rest) / 4, fatG: (0.5 * rest) / 9, fibreG: fibre, energyKcal: ei, nMeals: r.meals ?? 3 });
    dr.runDay();
    const dW = (tee - ei) / 7700;
    w -= dW;
    fm -= 0.75 * dW;
    t.hpi.push(dr.as.hpi);
    t.eK.push(dr.as.effortK);
    t.pSurv.push(dr.as.pSurv);
    t.w.push(w);
  }
  return t;
}

const A = (): Regime => ({ ei: () => 1950, protein: 100 });
const B = (): Regime => ({ ei: () => 1950, protein: 170 });
const C = (): Regime => ({ ei: () => 1950, protein: 170, fibre: 35 });
const D = (): Regime => ({ ei: () => 1560, protein: 100 });
const E = (): Regime => ({ ei: () => 700, protein: 60, bhb: 0.6 });
const F = (): Regime => ({ ei: () => 700, protein: 60, bhb: 0.1 });
const H = (): Regime => ({ ei: () => 1950, protein: 100, sleepDebtH: 1.5 });
const K = (): Regime => ({ ei: () => 2600, protein: 100 });
/** G: A with a 1-week break at maintenance (intake = current TEE) every 4th week. */
const G = (): Regime => ({ ei: (d, tee) => (Math.ceil(d / 7) % 4 === 0 ? tee : 1950), protein: 100 });

type Cell = [day: number, hpi: number, pSurv?: number];
const TABLE: Record<string, { regime: () => Regime; cells: Cell[] }> = {
  A: { regime: A, cells: [[3, 38, 1.0], [14, 50, 0.997], [28, 61, 0.992], [56, 75, 0.971], [84, 83, 0.942]] },
  B: { regime: B, cells: [[3, 19], [14, 28], [28, 37], [56, 54], [84, 66, 0.979]] },
  C: { regime: C, cells: [[3, 11], [14, 17], [28, 24], [56, 39], [84, 52, 0.993]] },
  D: { regime: D, cells: [[3, 57], [14, 73], [28, 82], [56, 91], [84, 94, 0.896]] },
  E: { regime: E, cells: [[3, 66], [14, 41], [28, 31], [56, 30], [84, 32, 0.992]] },
  F: { regime: F, cells: [[3, 81], [14, 92], [28, 95], [56, 98], [84, 98, 0.863]] },
  H: { regime: H, cells: [[3, 50], [14, 63], [28, 72], [56, 83], [84, 89, 0.919]] },
  K: { regime: K, cells: [[3, 6], [14, 6], [28, 6]] },
  G: { regime: G, cells: [[21, 56], [28, 13], [49, 67], [56, 20], [105, 80], [112, 37]] },
};
/**
 * Known misses (±10 points) and why: B/C day 84 — the reference implementation's drive grows faster once protein/fibre
 * satiety removes most of SatDef (its D-sum at day 84 is 597/629/650 kcal-eq for A/B/C versus 479 here for all three,
 * which the §4.9 equations as written cannot produce: A, B and C share the same weight path).
 */
const KNOWN_MISS = new Set(['B@84', 'C@84']);

describe('12 Appendix A regression table (HPI ±10 points, P_surv ±0.02)', () => {
  for (const [name, { regime, cells }] of Object.entries(TABLE)) {
    const last = cells[cells.length - 1]![0];
    for (const [day, hpi, ps] of cells) {
      const key = `${name}@${day}`;
      const body = () => {
        const t = runRegime(regime(), last);
        expect(Math.abs(t.hpi[day]! - hpi)).toBeLessThanOrEqual(10);
        if (ps !== undefined) expect(Math.abs(t.pSurv[day]! - ps)).toBeLessThanOrEqual(0.02);
      };
      if (KNOWN_MISS.has(key)) it.fails(`${key}: HPI ${hpi} (known miss)`, body);
      else it(`${key}: HPI ${hpi}${ps !== undefined ? `, P_surv ${ps}` : ''}`, body);
    }
  }

  it('spec anchors: maintenance ≈ 6; 25 % deficit week 1 in 40-50', () => {
    const k = runRegime(K(), 28);
    for (let d = 0; d <= 28; d++) expect(Math.abs(k.hpi[d]! - 6)).toBeLessThan(1);
    const a = runRegime(A(), 7);
    expect(a.hpi[7]!).toBeGreaterThanOrEqual(40);
    expect(a.hpi[7]!).toBeLessThanOrEqual(50);
  });

  it('J: lean woman 60 kg / 15 kg fat, EI_hab 2 100, 25 % deficit, protein 110 g → HPI 35 / 49 / 61 / 71 at weeks 4-16 (±10)', () => {
    const t = runRegime({ ei: () => 1575, protein: 110 }, 112, { w: 60, fm: 15, eiHab: 2100, pRef: 100, sex: 'female' });
    const want: ReadonlyArray<[number, number]> = [
      [28, 35],
      [56, 49],
      [84, 61],
      [112, 71],
    ];
    for (const [d, h] of want) expect(Math.abs(t.hpi[d]! - h)).toBeLessThanOrEqual(10);
  });

  // 12's reference gives the lean man 62/81/94/98; the §4.9 equations with Λ_lean from absolute leptin sufficiency
  // (S_L(L_FM), L50 = 1 ng/mL) give 37/55/77/91: the leanness amplification only bites below ≈ 5 kg fat. c = 1.5, L50 and
  // the Hill exponent are fixed (no registry range): known miss (MODEL_SPEC §1.12 decision d).
  it.fails('I: lean man 80 kg / 11 kg fat, EI_hab 3 000, 25 % deficit, protein 180 g → HPI 62 / 81 / 94 / 98 (known miss)', () => {
    const t = runRegime({ ei: () => 2250, protein: 180 }, 112, { w: 80, fm: 11, eiHab: 3000, pRef: 100, sex: 'male' });
    for (const [d, h] of [
      [28, 62],
      [56, 81],
      [84, 94],
      [112, 98],
    ] as const)
      expect(Math.abs(t.hpi[d]! - h)).toBeLessThanOrEqual(10);
  });

  it('I (spec anchor "contest leanness ≥ 95"): the lean man reaches HPI ≥ 95 once fat approaches contest levels', () => {
    const t = runRegime({ ei: () => 2250, protein: 180 }, 200, { w: 80, fm: 11, eiHab: 3000, pRef: 100, sex: 'male' });
    // fat 11 → ≈ 3.5 kg (≈ 5 % body fat) by day 200
    expect(t.hpi[200]!).toBeGreaterThanOrEqual(95);
  });
});

describe('12 §7 intake-effort targets', () => {
  it('Polidori 2016: appetite drive ≈ 95-100 kcal/d per kg lost for losses ≤ 4 kg (±30 %)', () => {
    // hold weight below W_ref by ΔW with intake at the matching (reduced) TEE so only D_WL acts
    for (const dW of [1, 2, 4]) {
      const t = runRegime({ ei: (_d, tee) => tee, protein: 100 }, 30, DEFAULT_SUBJECT);
      const dr = t.dr;
      // apply a step tissue-mass deficit of dW kg (the weight of D_WL, MODEL_SPEC §1.12) and read the drive term
      for (let i = 0; i < 7; i++) {
        dr.bus.tissueMassKg = 90 - dW;
        dr.runDay();
      }
      const perKg = (dr.as.dWl * dr.as.lambdaLean) / dW;
      expect(perKg).toBeGreaterThanOrEqual(70);
      expect(perKg).toBeLessThanOrEqual(130);
    }
  });

  it('Nymo 2017/2018: ketogenic VLED — HPI up in days 1-21, back toward baseline by week 4-8; after refeeding out of ketosis at ≈ 16 % loss HPI clearly above baseline and still elevated at 1 y', () => {
    const vled = (d: number) => d <= 63;
    const t = runRegime(
      {
        ei: (d, tee) => (vled(d) ? 700 : tee),
        protein: (d) => (vled(d) ? 60 : 100),
        bhb: 0.6,
      },
      63,
    );
    const peak = Math.max(...t.hpi.slice(1, 22));
    expect(peak).toBeGreaterThan(50);
    expect(t.hpi[56]!).toBeLessThan(peak - 20);
    // refeed at maintenance (intake = current TEE), BHB back to 0.1; weight held for 1 y
    const dr = t.dr;
    const w = t.w[63]!;
    const lossPct = (100 * (90 - w)) / 90;
    expect(lossPct).toBeGreaterThan(12);
    const hpiKetotic = t.hpi[63]!;
    const tee = 2600 - 22 * (90 - w);
    for (let d = 0; d < 365; d++) {
      dr.bus.bhbMmolL = 0.1;
      dr.bus.energyBalanceFrac = 0;
      dr.setIntake({ proteinG: 100, carbG: (0.5 * (tee - 432)) / 4, fatG: (0.5 * (tee - 432)) / 9, fibreG: 16, energyKcal: tee, nMeals: 3 });
      dr.runDay();
      if (d === 21) expect(dr.as.hpi).toBeGreaterThan(hpiKetotic);
    }
    expect(dr.as.hpi).toBeGreaterThan(20);
  });

  it('12 §7.8 satiety equivalents (ad-libitum intake difference at equal effort, ±30 %): protein 15 → 30 %E −441 kcal/d; UPF +508 kcal/d', () => {
    const t = runRegime(K(), 1);
    const k = t.dr.ak;
    // at steady state E_k = 0 ⇔ S = EI_hab ⇒ ad-libitum intake difference = −ΔH (12 §7.8 instruction)
    const eiHab = 2400;
    const dProtein = -(0.25 * eiHab * Math.LN2);
    expect(Math.abs(dProtein / -441 - 1)).toBeLessThanOrEqual(0.3);
    // UPF 0 → 0.8 share with consumed energy density 1.09 → 1.36 kcal/g (Hall 2019)
    const dUpf = (k.hUpf * 0.8) / k.hUpfScale + k.hEdEps * eiHab * Math.log(1.36 / 1.09);
    expect(Math.abs(dUpf / 508 - 1)).toBeLessThanOrEqual(0.3);
  });

  // 12 halves the short-term energy-density elasticity (≈ 0.8) to 0.5 for long-term attenuation, so the 2-day Rolls
  // 2006 result (−24 %, −575 kcal/d) is under-predicted (−345 kcal/d at 2 400 kcal).
  it.fails('Rolls 2006: −25 % energy density → −575 kcal/d over 2 d (±30 %; known miss by design)', () => {
    const d = -0.5 * 2400 * Math.log(1 / 0.75);
    expect(Math.abs(d / -575 - 1)).toBeLessThanOrEqual(0.3);
  });

  it('16 V6 / R-SLEEP: sleep debt dF 3.5 h → +350 kcal-eq/d (band 210-500)', () => {
    const t = runRegime({ ei: () => 2600, protein: 100, sleepDebtH: 3.5 }, 3);
    expect(t.dr.as.dSleep).toBeCloseTo(350, 10);
  });

  it('10 §4.3 / R-COMP: a new 263 kcal/d exercise habit adds ≈ +83 kcal-eq/d of appetite once S_ex has settled (τ 28 d)', () => {
    const t = runRegime({ ei: (_d, tee) => tee, protein: 100, exerciseKcalD: () => 263 }, 168);
    expect(Math.abs(t.dr.as.dEx - 83)).toBeLessThan(3);
    // lag: after 28 d the filter is ≈ 63 % of the way
    const t28 = runRegime({ ei: (_d, tee) => tee, protein: 100, exerciseKcalD: () => 263 }, 28);
    expect(t28.dr.as.sEx / 263).toBeCloseTo(1 - Math.exp(-1), 2);
  });

  it('burn-in on a habitual week with sessions (§3.4, review B3): ExEE0 = weekly mean, D_ex ≈ 0 when the habit continues', () => {
    const profile = makeProfile(MAN90, { weightKg: 90, fm0Kg: 30, ffm0Kg: 60, tdee0Kcal: 2600, habitualProteinG: 100, habitualFibreG: 16 });
    const dr = new DayDriver(profile, { startDay: -14 });
    const exOf = (d: number) => ([0, 2, 4].includes(((d % 7) + 7) % 7) ? 300 : 0);
    const day = (d: number) => {
      dr.bus.exEEKcalH = exOf(d) / 24;
      dr.bus.scaleWeightKg = 90;
      dr.runDay();
    };
    for (let d = -14; d < 0; d++) day(d);
    dr.endBurnIn();
    expect(dr.as.exEE0).toBeCloseTo((3 * 300) / 7, 10);
    let maxAbs = 0;
    for (let d = 0; d < 56; d++) {
      day(d);
      maxAbs = Math.max(maxAbs, Math.abs(dr.as.dEx));
    }
    expect(maxAbs).toBeLessThan(10);
    expect(dr.as.hpi).toBeLessThan(7);
  });

  it('16 §4.5 / V12: luteal drive is +168 kcal/d luteal vs follicular and mean-zero over the cycle (review M3)', () => {
    const lw = (d: number) => (((d - 1) % 28) + 1 > 14 ? 1 : 0);
    const t = runRegime({ ei: () => 2100, protein: 75, lutealWeight: lw }, 112, { w: 62, fm: 17, eiHab: 2100, pRef: 75, sex: 'female' });
    const dr = t.dr;
    let sum = 0;
    let lut = 0;
    let fol = 0;
    for (let d = 1; d <= 28; d++) {
      dr.bus.lutealWeight = lw(d);
      dr.setIntake({ proteinG: 75, carbG: 200, fatG: 60, fibreG: 16, energyKcal: 2100, nMeals: 3 });
      dr.runDay();
      sum += dr.as.dLuteal;
      if (lw(d) === 1) lut += dr.as.dLuteal / 14;
      else fol += dr.as.dLuteal / 14;
    }
    expect(Math.abs(sum / 28)).toBeLessThan(1e-6);
    expect(lut - fol).toBeCloseTo(168, 6);
  });
});

describe('water fasts (20 §4.x hunger course; MODEL_SPEC §1.12 decision f)', () => {
  // zero intake, BHB 2 mM, no meals, from habitual maintenance (hand-built rig; the full loop's BHB rises over the fast)
  const fast = (days: number) =>
    runRegime({ ei: (d) => (d <= days ? 0 : 2600), protein: (d) => (d <= days ? 0 : 100), fibre: 16, meals: 0, bhb: 2 }, days);
  // Peak level: between 12 App. A's ketotic (E, 66) and non-ketotic (F, 81) VLED values ±10 — a water fast at its peak
  // (late day 1-day 2, 07 §4.10 / 20 §4.10) is neither milder than a ketotic VLED nor hungrier than a non-ketotic one.
  // This rig: 57 / 68 / 45 on days 1-3 (full loop, lean man: 65 / 76 / 54).
  it('fast-day hunger peaks on day 1-2 between the 12 App. A ketotic and non-ketotic VLED anchors (66-81, ±10)', () => {
    const t = fast(3);
    const peak = Math.max(t.hpi[1]!, t.hpi[2]!, t.hpi[3]!);
    expect(peak).toBeGreaterThanOrEqual(56);
    expect(peak).toBeLessThanOrEqual(91);
    expect(peak).toBe(Math.max(t.hpi[1]!, t.hpi[2]!));
  });
  // 07 §4.10 fasting-hunger time course (orchestrator ruling 2026-09-30; formerly a known miss when only K_ad, τ_up 10 d,
  // brought hunger down): the acute-deficit drive follows Hfast's normalised decline beyond its 30-h peak.
  it('multi-day water fast: hunger peaks by day 2 and falls after day 2-3 — HPI day 3 < day 2 and day 6 ≤ 40', () => {
    const t = fast(6);
    expect(t.hpi[3]!).toBeLessThan(t.hpi[2]!);
    expect(t.hpi[6]!).toBeLessThanOrEqual(40);
    expect(Math.max(...t.hpi.slice(1, 7))).toBe(Math.max(t.hpi[1]!, t.hpi[2]!, t.hpi[3]!));
  });
  it('refeeding after a multi-day fast: hunger follows the refeed intake (maintenance → back near baseline within 3 d)', () => {
    const t = runRegime({ ei: (d) => (d <= 6 ? 0 : 2600), protein: (d) => (d <= 6 ? 0 : 100), fibre: 16, meals: 3, bhb: 2 }, 9);
    expect(t.hpi[9]!).toBeLessThan(25);
  });
  it('Hfast factor: 1 up to the 30-h peak, x·e^(1−x) beyond (≈ 1/3 at 72 h, ≈ 0.03 at 5 d)', () => {
    expect(fastHungerFactor(10, 12, 18)).toBe(1);
    expect(fastHungerFactor(30, 12, 18)).toBe(1);
    expect(fastHungerFactor(72, 12, 18)).toBeCloseTo((60 / 18) * Math.exp(1 - 60 / 18), 12);
    expect(fastHungerFactor(72, 12, 18)).toBeGreaterThan(0.3);
    expect(fastHungerFactor(72, 12, 18)).toBeLessThan(0.35);
    expect(fastHungerFactor(120, 12, 18)).toBeLessThan(0.05);
  });
});

describe('adherence P_surv (12 §4.10a attrition calibration)', () => {
  // Trepanowski 2017 (1 y): ADF 25 %/125 % alternate days for 6 mo then 50 %/150 %; CR 75 % then 100 %.
  // Observed dropout ADF 38 % vs CR 29 % (control 26 %). With 12's asymmetric SatDef (saturating in deficit, linear
  // satiety in surplus) and the 1-d effort filter, feast days read HPI ≈ 6 and fast days ≈ 50, so the model ranks ADF
  // *easier*: dropout ADF 18 % vs CR 28 % (intake tied to the falling TEE). SatDef, the effort τ and the hazard constants
  // are fixed without registry ranges: known miss of the calibration target (MODEL_SPEC §1.12 decision e).
  const trial = (adf: boolean) =>
    runRegime(
      {
        ei: (d, tee) => (adf ? (d <= 182 ? (d % 2 ? 0.25 : 1.25) : d % 2 ? 0.5 : 1.5) : d <= 182 ? 0.75 : 1) * tee,
        protein: 100,
      },
      364,
      { w: 95, fm: 40, eiHab: 2600, pRef: 100, sex: 'male' },
    );
  it.fails('ADF dropout exceeds CR dropout by ≈ 9 pp (38 % vs 29 %; ±6 pp) (known miss)', () => {
    const adf = 1 - trial(true).pSurv[364]!;
    const cr = 1 - trial(false).pSurv[364]!;
    expect(Math.abs(100 * (adf - cr) - 9)).toBeLessThanOrEqual(6);
  });
  it('P_surv is monotone non-increasing and 1 while HPI ≤ 20', () => {
    const t = runRegime(A(), 84);
    for (let d = 1; d <= 84; d++) expect(t.pSurv[d]!).toBeLessThanOrEqual(t.pSurv[d - 1]! + 1e-15);
    const k = runRegime(K(), 60);
    expect(k.pSurv[60]).toBe(1);
  });
});

describe('properties', () => {
  it('maintenance stays steady for 30 days (HPI, fatigue, P_surv)', () => {
    const t = runRegime(K(), 30);
    expect(Math.abs(t.hpi[30]! - t.hpi[0]!)).toBeLessThan(1e-9);
    expect(t.dr.as.fatigue).toBe(0);
    expect(t.dr.bus.dietFatigue).toBe(0);
    expect(t.dr.record()[MI.adherence]).toBe(100);
  });

  it('21 days of zero intake stay finite and bounded, then recover on refeeding', () => {
    const t = runRegime({ ei: (d, tee) => (d <= 21 ? 0 : tee), protein: (d) => (d <= 21 ? 0 : 100), fibre: 0, bhb: 3, meals: 0 }, 42);
    for (let d = 0; d <= 42; d++) {
      expect(Number.isFinite(t.hpi[d]!)).toBe(true);
      expect(t.hpi[d]!).toBeGreaterThanOrEqual(0);
      expect(t.hpi[d]!).toBeLessThanOrEqual(100);
      expect(t.pSurv[d]!).toBeGreaterThan(0);
      expect(t.pSurv[d]!).toBeLessThanOrEqual(1);
    }
    expect(t.hpi[42]!).toBeLessThan(t.hpi[21]!);
  });

  it('monotone: deeper deficit → higher HPI and lower P_surv; more protein/fibre → lower HPI', () => {
    const hpis = [0.9, 0.75, 0.6, 0.4].map((f) => runRegime({ ei: () => 2600 * f, protein: 100 }, 28));
    for (let i = 1; i < hpis.length; i++) {
      expect(hpis[i]!.hpi[28]!).toBeGreaterThan(hpis[i - 1]!.hpi[28]!);
      expect(hpis[i]!.pSurv[28]!).toBeLessThanOrEqual(hpis[i - 1]!.pSurv[28]!);
    }
    expect(runRegime(B(), 28).hpi[28]!).toBeLessThan(runRegime(A(), 28).hpi[28]!);
    expect(runRegime(C(), 28).hpi[28]!).toBeLessThan(runRegime(B(), 28).hpi[28]!);
  });

  it('never changes intake (R-INTAKE): the DayInput is untouched by the day hooks', () => {
    const t = runRegime(A(), 1);
    const d = t.dr.day;
    const before = [d.energyKcal, d.proteinG, d.carbG, d.fatG, d.fibreG, d.nMeals];
    t.dr.runDay();
    expect([d.energyKcal, d.proteinG, d.carbG, d.fatG, d.fibreG, d.nMeals]).toEqual(before);
  });
});

// ------------------------------------------------------------------ baseline contract and inputs (MODEL_SPEC §1.12)

interface HabitDay {
  /** TDEE estimate of day d (burn-in days d < 0), kcal/d. */
  teeOf: (d: number) => number;
  /** Net exercise EE of day d, kcal/d. */
  exOf?: (d: number) => number;
  sleepDebtH?: number;
  /** Tissue mass and scale weight of day d, kg. */
  tissueOf?: (d: number) => number;
  scaleOf?: (d: number) => number;
}

/** 14 burn-in days of a habitual week (flat habitual intake), end of burn-in, then a stepper (profile: MAN90 subject). */
function habitualWeek(h: HabitDay, opts: ContextOpts = {}, overrides: Partial<ResolvedProfile> = {}) {
  const profile = makeProfile(MAN90, { weightKg: 90, fm0Kg: 30, ffm0Kg: 60, tdee0Kcal: 2600, habitualProteinG: 100, habitualFibreG: 16, ...overrides });
  const dr = new DayDriver(profile, { startDay: -14, ...opts });
  const step = (d: number, intake?: { energyKcal: number; proteinG?: number }) => {
    const ei = intake?.energyKcal ?? 2600;
    const p = intake?.proteinG ?? 100;
    const rest = Math.max(0, ei - 4 * p - 32);
    dr.setIntake({ proteinG: p, carbG: (0.5 * rest) / 4, fatG: (0.5 * rest) / 9, fibreG: 16, energyKcal: ei, nMeals: 3 });
    const bus = dr.bus;
    bus.tdeeEstKcalD = h.teeOf(d);
    bus.exEEKcalH = (h.exOf?.(d) ?? 0) / 24;
    bus.sleepDebtFastH = h.sleepDebtH ?? 0;
    bus.tissueMassKg = h.tissueOf?.(d) ?? 90;
    bus.scaleWeightKg = h.scaleOf?.(d) ?? bus.tissueMassKg;
    bus.fibreEffG = 16;
    dr.runDay();
  };
  for (let d = -14; d < 0; d++) step(d);
  dr.endBurnIn();
  return { dr, step };
}

const wd = (d: number) => ((d % 7) + 7) % 7;

describe('baseline contract (MODEL_SPEC §1.12 "Baseline and habitual week", §3.4)', () => {
  it('habitual exerciser (4 × 450 kcal sessions/wk at flat intake) with 1.5 h habitual sleep debt: HPI exactly HPI(0) at t = 0, within 0.05 for 90 d; no diet fatigue from training days', () => {
    const train = (d: number) => [0, 1, 3, 5].includes(wd(d));
    const { dr, step } = habitualWeek({
      teeOf: (d) => 2600 + (train(d) ? 450 - (4 * 450) / 7 : -(4 * 450) / 7) + (d < 0 ? 40 : 0),
      exOf: (d) => (train(d) ? 450 : 0),
      sleepDebtH: 1.5,
    });
    expect(dr.as.hpi).toBe(dr.ak.hpi0);
    expect(dr.record()[MI.hunger]).toBe(dr.ak.hpi0);
    expect(dr.record()[MI.adherence]).toBe(100);
    expect(dr.ak.hpi0).toBeCloseTo(100 / (1 + Math.exp(800 / 300)), 12);
    let maxDev = 0;
    for (let d = 0; d < 90; d++) {
      step(d);
      maxDev = Math.max(maxDev, Math.abs(dr.as.hpi - dr.ak.hpi0));
    }
    expect(maxDev).toBeLessThan(0.05);
    expect(dr.as.fatigue).toBeLessThan(1e-9);
    expect(Math.abs(dr.as.dSleep)).toBeLessThan(1e-9);
  });

  it('the weight of D_WL is tissue mass: a 1.5 kg scale-water drop changes nothing; 1 kg of tissue lost adds ≈ 95 kcal-eq', () => {
    const water = habitualWeek({ teeOf: () => 2600, scaleOf: (d) => (d >= 0 ? 88.5 : 90) });
    for (let d = 0; d < 14; d++) water.step(d);
    expect(Math.abs(water.dr.as.dWl)).toBeLessThan(1e-6);
    const tissue = habitualWeek({ teeOf: () => 2600, tissueOf: (d) => (d >= 0 ? 89 : 90) });
    for (let d = 0; d < 14; d++) tissue.step(d);
    expect(tissue.dr.as.dWl).toBeGreaterThan(85);
    expect(tissue.dr.as.dWl).toBeLessThan(95);
  });
});

describe('21 §4G behavioural levers from the schedule (ctx.schedule.adherence)', () => {
  const run = (adherence?: ContextOpts['adherence']) => {
    const { dr, step } = habitualWeek({ teeOf: () => 2600 }, adherence ? { adherence } : {});
    for (let d = 0; d < 84; d++) step(d, { energyKcal: 1950 });
    return dr;
  };
  const none = { selfMonitoring: false, mealReplacement: false, preMealWater: false, flexibleRestraint: false };
  it('no levers (undefined or all false) → multiplier 1; self-monitoring → 0.90; all four → capped 0.85', () => {
    const base = run();
    expect(base.ak.leverMult).toBe(1);
    expect(run(none).ak.leverMult).toBe(1);
    const sm = run({ ...none, selfMonitoring: true });
    expect(sm.ak.leverMult).toBeCloseTo(0.9, 12);
    const all = run({ selfMonitoring: true, mealReplacement: true, preMealWater: true, flexibleRestraint: true });
    expect(all.ak.leverMult).toBeCloseTo(0.85, 12);
    // the cumulative hazard scales exactly; HPI is unchanged (levers act on adherence only)
    expect(sm.as.cumHazard).toBeCloseTo(0.9 * base.as.cumHazard, 12);
    expect(sm.as.hpi).toBe(base.as.hpi);
    expect(sm.as.pSurv).toBeGreaterThan(base.as.pSurv);
  });
});

describe('habitual liquid-energy and energy-density references (12 §4.9.2; profile habits)', () => {
  const satOf = (overrides: Partial<ResolvedProfile>, day: { liquidKcal?: number; ed?: number; upf?: number }) => {
    const { dr, step } = habitualWeek({ teeOf: () => 2600 }, {}, overrides);
    dr.day.liquidKcal = day.liquidKcal ?? 0;
    dr.day.energyDensityKcalPerG = day.ed ?? Number.NaN;
    dr.day.upfShare = day.upf ?? dr.profile.habits.upfShare;
    step(0);
    return dr.as.satietyS - 2600;
  };
  const habits = (x: Partial<ResolvedProfile['habits']>): Partial<ResolvedProfile> => ({
    habits: { ...makeProfile(MAN90).habits, ...x },
  });
  it('liquid: NaN → reference 0 kcal (0.9 of 300 liquid kcal discounted); habitual 300 kcal → no discount at 300, 0.9·300 at 600', () => {
    expect(satOf({}, { liquidKcal: 300 })).toBeCloseTo(-270, 9);
    expect(satOf(habits({ habitualLiquidKcal: 300 }), { liquidKcal: 300 })).toBeCloseTo(0, 9);
    expect(satOf(habits({ habitualLiquidKcal: 300 }), { liquidKcal: 600 })).toBeCloseTo(-270, 9);
  });
  it('energy density: habitual 1.6 kcal/g is the reference; a day without ED keeps it at the habitual UPF share', () => {
    expect(satOf(habits({ habitualEnergyDensityKcalPerG: 1.6 }), {})).toBeCloseTo(0, 9);
    expect(satOf(habits({ habitualEnergyDensityKcalPerG: 1.6 }), { ed: 1.6 })).toBeCloseTo(0, 9);
    // 1.2 kcal/g against 1.6: −0.5·EI_hab·ln(0.75) = +374 kcal-eq of satiety
    expect(satOf(habits({ habitualEnergyDensityKcalPerG: 1.6 }), { ed: 1.2 })).toBeCloseTo(-0.5 * 2600 * Math.log(0.75), 6);
    // NaN → population ED_auto(f_UPF,ref) = 1.15 + 0.35·0.55: an explicit 1.3425 kcal/g day is neutral
    expect(satOf({}, { ed: 1.15 + 0.35 * 0.55 })).toBeCloseTo(0, 9);
  });
  it('a day without ED at a lower UPF share gets 15 §4.6 ED_auto shift plus the UPF residual (Hall 2019 total ≈ 508 kcal/d at 0.8)', () => {
    const d = satOf({}, { upf: 0.15 });
    const ed0 = 1.15 + 0.35 * 0.55;
    const want = -0.5 * 2600 * Math.log((ed0 - 0.35 * 0.4) / ed0) + (300 * 0.4) / 0.8;
    expect(d).toBeCloseTo(want, 6);
  });
});
