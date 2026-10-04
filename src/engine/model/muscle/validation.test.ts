// @vitest-environment node
/**
 * Validation targets of WP-M8 (MODEL_SPEC §1.9 / §9.2 row 09: dossier 09 §7 #1-14, strength after R-STR, habituation,
 * Sardeli retention, acute MPS kernel; review M13 Murphy re-verification with composition's real partition).
 * The muscle module is driven directly (harness); deficit targets book lean tissue with composition's pure partition
 * functions (`CompositionProxy`, no adaptive thermogenesis, fixed deficit). Targets that cannot be met here stay as
 * `it.fails` with their numbers (WP_BRIEF); the full-engine values of the same targets (real composition, energy, activity,
 * e = 0 at the model's own TEE) are quoted where they differ — MODEL_SPEC §1.9 target table (R-RT revised).
 */
import { describe, expect, it } from 'vitest';
import {
  MuscleSim,
  compileWeek,
  person,
  program,
  runDeficit,
  runRt,
  rtWeek,
  zeroCrossing,
  type PersonOpts,
} from './__tests__/harness';

const YOUNG_MAN: PersonOpts = { age: 25, sex: 'male', heightCm: 178, weightKg: 75 };
/** Benito 2020 mean duration of FFM studies: 10.4 wk. */
const BENITO_DAYS = 73;

describe('09 #1 Benito 2020 — RT not in deficit, 10.4 wk (e = 0, review m21)', () => {
  it('untrained young man: +1.49 kg ± 0.4', () => {
    const g = runRt(YOUNG_MAN, BENITO_DAYS, 4, 3, 1.4).gain();
    expect(Math.abs(g - 1.49)).toBeLessThanOrEqual(0.4); // model 1.61 kg (full engine at e = 0: 1.37)
  });
  it('trained (TS₀ 0.45): +0.99 kg ± 0.4', () => {
    const p: PersonOpts = { ...YOUNG_MAN, trainingYears: 1.272, trainingHistory: '1to3y' };
    const sim = runRt(p, 0, 4, 3, 1.4);
    expect(new MuscleSim(person(p)).s.ts).toBeCloseTo(0.45, 2);
    const g = runRt(p, BENITO_DAYS, 4, 3, 1.4).gain();
    expect(sim.s.currentlyTraining).toBe(1);
    expect(Math.abs(g - 0.99)).toBeLessThanOrEqual(0.4); // model 1.02 kg (full engine: 0.94)
  });
});

describe('09 #2 Morton 2018 — protein supplementation, 13 wk', () => {
  const ctrl = (): number => runRt(YOUNG_MAN, 91, 4, 3, 1.4).gain();
  const supp = (): number => runRt(YOUNG_MAN, 91, 4, 3, 1.8).gain();
  it('supplement effect (1.4 → 1.8 g/kg) inside Morton 95 % CI +0.30 kg (0.09-0.52)', () => {
    const d = supp() - ctrl();
    expect(d).toBeGreaterThanOrEqual(0.09); // model +0.31 kg
    expect(d).toBeLessThanOrEqual(0.52);
  });
  // R-RT revised (09 f_P per kg body mass): model 1.15 (full engine at e = 0: 1.16); was 1.07 with 03 f_Pgain per kg FFM.
  it('ratio supplemented/control 1.27 ± 0.15', () => {
    expect(Math.abs(supp() / ctrl() - 1.27)).toBeLessThanOrEqual(0.15);
  });
});

describe('09 #3 Peterson 2011 — older adults (65.5 y), 20.5 wk, V 8, P 1.1 g/kg, 50:50 sex', () => {
  const run = (): { m: number; f: number } => {
    const m = runRt({ age: 65.5, sex: 'male', heightCm: 178, weightKg: 75 }, 144, 8 / 3, 3, 1.1).gain();
    const f = runRt({ age: 65.5, sex: 'female', heightCm: 165, weightKg: 60 }, 144, 8 / 3, 3, 1.1).gain();
    return { m, f };
  };
  it('direction: men gain more than women; both gain', () => {
    const { m, f } = run();
    expect(f).toBeGreaterThan(0);
    expect(m).toBeGreaterThan(f);
  });
  // R-RT revised: 09 f_P(1.1) = 0.65 → model mean +1.28 kg (M 1.59, F 0.98; full engine 0.94, sex-unspecified 0.92);
  // with 03 f_Pgain per kg FFM (q 1.47-1.71 → f 0.80-0.87) it was +1.61 kg (miss).
  it('mean LBM gain +1.1 kg ± 0.4 (0.7-1.5)', () => {
    const { m, f } = run();
    expect(Math.abs((m + f) / 2 - 1.1)).toBeLessThanOrEqual(0.4);
  });
});

describe('09 #4 Murphy & Koehler 2022 — RT with vs without deficit, 12 wk (review M13, R-PROT2)', () => {
  const grid = [0, 250, 400, 500, 600, 700, 750, 1000];
  const p: PersonOpts = { age: 25, sex: 'male', heightCm: 178, weightKg: 80, bodyFatPct: 22 };
  const runs = grid.map((D) => runDeficit(p, 84, 4, 3, 1.3, D));
  it('composition partition (03 RT-stripped + R_RT + A_r): net ΔLT crosses zero between 500 and 700 kcal/d', () => {
    const net = runs.map((r) => r.comp.lean);
    // net ΔLT kg (ρ_max 0.5): 0 → +1.60, 250 → +0.98, 400 → +0.59, 500 → +0.29, 600 → −0.01, 700 → −0.32, 1000 → −0.83
    for (let i = 1; i < net.length; i++) expect(net[i]!).toBeLessThan(net[i - 1]!);
    const z = zeroCrossing(grid, net);
    expect(z).toBeGreaterThanOrEqual(500); // model ≈ 596 kcal/d (ρ_max 0.5, R-PROT2 fallback applied for the full engine)
    expect(z).toBeLessThanOrEqual(700);
  });
  it("Murphy's own deficit definition (fat-mass loss × 9 441 kcal/kg / days): crossing 500-700 kcal/d", () => {
    // Murphy & Koehler estimated each study's deficit from the fat-mass change (Stronger by Science summary of the full
    // text); the full engine (adaptive thermogenesis on) gives 604 kcal/d on this axis vs 789 kcal/d prescribed.
    const ed = runs.map((r) => (-r.comp.fat * 9441) / 84);
    const z = zeroCrossing(ed, runs.map((r) => r.comp.lean)); // model ≈ 586 kcal/d
    expect(z).toBeGreaterThanOrEqual(500);
    expect(z).toBeLessThanOrEqual(700);
  });
  it("09's own calibration basis (protein-free Forbes partition): zero crossing 500-700 kcal/d", () => {
    const z = zeroCrossing(grid, runs.map((r) => r.forbes.lean)); // model ≈ 511 kcal/d
    expect(z).toBeGreaterThanOrEqual(500);
    expect(z).toBeLessThanOrEqual(700);
  });
  it('RT accretion itself falls monotonically with the deficit and stays ≥ 0', () => {
    const g = runs.map((r) => r.sim.gain());
    for (let i = 1; i < g.length; i++) expect(g[i]!).toBeLessThanOrEqual(g[i - 1]! + 1e-12);
    expect(g[g.length - 1]!).toBeGreaterThanOrEqual(0);
  });
});

describe('09 #5 Longland 2016 — 4 wk, −40 %, RT + HIIT 6 d/wk, 2.4 vs 1.2 g/kg (FM₀ 25 kg)', () => {
  const p: PersonOpts = { age: 23, sex: 'male', heightCm: 180, weightKg: 90, bodyFatPct: 27.8 };
  const tdee = new MuscleSim(person(p)).profile.tdee0Kcal;
  const pro = runDeficit(p, 28, 2, 6, 2.4, 0.4 * tdee).comp.lean;
  const con = runDeficit(p, 28, 2, 6, 1.2, 0.4 * tdee).comp.lean;
  it('direction: PRO > CON lean (model +0.08 vs −0.24 kg; full engine, WP-V fixture: −0.27 vs −0.36 kg lean mass)', () => {
    expect(pro).toBeGreaterThan(con);
    expect(pro).toBeGreaterThan(0);
  });
  // KNOWN MISS (K, MODEL_SPEC §1.9): observed +1.2 ± 1.0 vs +0.1 ± 1.0 kg; model difference 0.31 kg (−0.79 kg); full engine 0.09 kg
  // (ρ_max 0.5 — the R-PROT2 fallback trades Longland's magnitude for Murphy's crossing).
  it.fails('magnitude: PRO − CON = 1.1 kg ± 0.3', () => {
    expect(Math.abs(pro - con - 1.1)).toBeLessThanOrEqual(0.3);
  });
});

describe('09 #6 Garthe 2011 — elite athletes, 4 RT/wk, −19 % (8.5 wk) vs −30 % (5.3 wk)', () => {
  const p: PersonOpts = { age: 22, sex: 'male', heightCm: 178, weightKg: 72, bodyFatPct: 12, trainingYears: 3, trainingHistory: '1to3y' };
  const tdee = new MuscleSim(person(p)).profile.tdee0Kcal;
  const slow = runDeficit(p, 60, 3, 4, 1.6, 0.19 * tdee);
  const fast = runDeficit(p, 37, 3, 4, 1.6, 0.3 * tdee);
  const pct = (r: typeof slow): number => (100 * r.comp.lean) / r.sim.profile.ffm0Kg;
  it('direction: slow loss preserves more lean than fast (model −0.30 % vs −0.69 %; full engine +0.10 points)', () => {
    expect(pct(slow)).toBeGreaterThan(pct(fast));
  });
  // KNOWN MISS (K): observed LBM +2.1 ± 0.4 % (slow) vs −0.2 ± 0.7 % (fast); slow arm under-predicted by ≈ 2.4 points (model −0.30 %).
  it.fails('magnitude: slow arm +2.1 % ± 0.7', () => {
    expect(Math.abs(pct(slow) - 2.1)).toBeLessThanOrEqual(0.7);
  });
});

describe('09 #7 Villareal 2017 — obese older adults, 6 mo, −9 % BW, RT vs aerobic', () => {
  const p: PersonOpts = { age: 70, sex: 'male', heightCm: 170, weightKg: 100, bodyFatPct: 40 };
  const D = 550;
  const rt = runDeficit(p, 182, 3, 3, 1.0, D);
  const aer = runDeficit(p, 182, 0, 0, 1.0, D, 0.4);
  it('scenario loses ≈ 9 % body weight and RT preserves more lean than aerobic', () => {
    const dBw = rt.comp.lean + rt.comp.fat;
    expect(dBw).toBeLessThan(-7);
    expect(dBw).toBeGreaterThan(-11);
    expect(rt.comp.lean).toBeGreaterThan(aer.comp.lean);
  });
  // KNOWN MISS (harness): RT arm ΔLT −0.11 kg, aerobic −1.84 kg (ratio 0.06; ΔBW −10.5 kg) vs observed −1.0 vs −2.7 kg (ratio
  // 0.37; 09 tolerance ±0.8 kg). R-RT revised (09 f_P(1.0) = 0.58) moved the RT arm from +0.13 kg; the full engine (WP-V fixture,
  // 70-y woman 95 kg) gives −0.23 kg (inside ±0.8) — the rest is R_RT 0.75 on composition's leaner deficit partition (aerobic
  // arm −1.3 kg in the full engine is composition's).
  it.fails('RT arm −1.0 kg ± 0.8 and ratio RT/aerobic 0.37 ± 0.2', () => {
    expect(Math.abs(rt.comp.lean + 1.0)).toBeLessThanOrEqual(0.8);
    expect(Math.abs(rt.comp.lean / aer.comp.lean - 0.37)).toBeLessThanOrEqual(0.2);
  });
});

describe('09 #8 Ballor & Poehlman 1994 — diet vs diet + exercise (≈ −10 kg)', () => {
  it('R_RT 0.75 at V ≥ V_R → catabolic FFM share ×0.25 (within ×0.25-0.5)', () => {
    const r = runDeficit({ age: 40, sex: 'male', heightCm: 178, weightKg: 95, bodyFatPct: 32 }, 7, 4, 3, 1.0, 1000);
    expect(r.sim.bus.rtRetentionFrac).toBeCloseTo(0.75, 12);
    const f = 1 - r.sim.bus.rtRetentionFrac;
    expect(f).toBeGreaterThanOrEqual(0.25);
    expect(f).toBeLessThanOrEqual(0.5);
  });
  it('FFM share of weight lost with RT is ≤ half of diet-only (obs 11-13 % vs 24-28 %)', () => {
    const p: PersonOpts = { age: 40, sex: 'male', heightCm: 178, weightKg: 95, bodyFatPct: 32 };
    const ex = runDeficit(p, 84, 4, 3, 1.0, 1000);
    const diet = runDeficit(p, 84, 0, 0, 1.0, 1000);
    const share = (r: typeof ex): number => r.comp.lean / (r.comp.lean + r.comp.fat);
    expect(diet.comp.lean + diet.comp.fat).toBeLessThan(-8);
    expect(share(ex)).toBeLessThanOrEqual(0.5 * share(diet));
  });
});

describe('Sardeli 2018 — RT prevents CR-induced lean loss in obese elderly (6 RCTs, 12-24 wk)', () => {
  const p: PersonOpts = { age: 68, sex: 'male', heightCm: 168, weightKg: 95, bodyFatPct: 40 };
  const rt = runDeficit(p, 126, 3, 3, 1.0, 500);
  const cr = runDeficit(p, 126, 0, 0, 1.0, 500);
  it('mechanism: R_RT of a 3×/wk programme at 68 y lies in the registry range around Sardeli R ≈ 0.9; RT arm keeps lean', () => {
    expect(rt.sim.bus.rtRetentionFrac).toBeGreaterThanOrEqual(0.5);
    expect(rt.sim.bus.rtRetentionFrac).toBeLessThanOrEqual(0.95);
    expect(cr.comp.lean).toBeLessThan(0);
    expect(1 - rt.comp.lean / cr.comp.lean).toBeGreaterThanOrEqual(0.9); // model 1.03 (Sardeli 93.5 % prevented)
  });
  // KNOWN MISS (harness): RT − CR lean difference 1.35 kg (RT +0.03, CR −1.31) vs Sardeli 0.82 kg (95 % CI 0.36-1.27); was
  // 1.52 kg with 03 f_Pgain per kg FFM. Full engine (adaptive thermogenesis, real partition): 1.00 kg (RT +0.03, CR −0.98), inside.
  it.fails('RT − CR lean difference inside the 95 % CI 0.36-1.27 kg', () => {
    const diff = rt.comp.lean - cr.comp.lean;
    expect(diff).toBeGreaterThanOrEqual(0.36);
    expect(diff).toBeLessThanOrEqual(1.27);
  });
});

describe('09 #9 Helms 2023 — trained, 8 wk, maintenance vs +5 % vs +15 %', () => {
  it('no meaningful surplus effect on training-attributable lean (≤ 6 % difference)', () => {
    // TS₀ ≈ 0.6 (2 y), the status implied by 09's model row 0.81 / 0.83 / 0.86 kg (bonus 0.15·(1 − TS))
    const p: PersonOpts = { age: 25, sex: 'male', heightCm: 178, weightKg: 80, trainingYears: 2, trainingHistory: '1to3y' };
    const g = [0, 0.05, 0.15].map((e) => runRt(p, 56, 4, 3, 1.8, e).gain());
    expect(g[0]!).toBeGreaterThan(0);
    expect(g[2]! / g[0]!).toBeLessThanOrEqual(1.06);
    expect(g[1]!).toBeGreaterThanOrEqual(g[0]!);
    expect(g[2]!).toBeGreaterThanOrEqual(g[1]!);
  });
});

describe('09 #10 Schoenfeld 2019 — trained men, 8 wk, low vs high volume', () => {
  it('high/low ratios ≈ 09 model 2.7 (arms 30 vs 6) and 2.4 (legs 45 vs 9) ± 15 %, below the observed 5.0/3.7', () => {
    const p: PersonOpts = { age: 23, sex: 'male', heightCm: 178, weightKg: 82, trainingYears: 4, trainingHistory: 'gt3y' };
    const d = (v: number, r: number): number => {
      const sim = runRt(p, 56, v / 3, 3, 1.8);
      return sim.s.mAcc[r]! - sim.s.mAcc0[r]!;
    };
    const arms = d(30, 3) / d(6, 3); // model 2.72
    const legs = d(45, 6) / d(9, 6); // model 2.46
    expect(Math.abs(arms / 2.7 - 1)).toBeLessThanOrEqual(0.15);
    expect(Math.abs(legs / 2.4 - 1)).toBeLessThanOrEqual(0.15);
    expect(arms).toBeLessThan(5.0);
    expect(legs).toBeLessThan(3.7);
  });
});

describe('09 #11 Damas 2016 / Seynnes 2007 — early swelling vs true growth (novice, V 10)', () => {
  const sim = new MuscleSim(person(YOUNG_MAN));
  const week = rtWeek(sim, 10 / 3, 3, 1.6);
  const w: number[] = [];
  const g: number[] = [];
  const h: number[] = [];
  g[0] = sim.s.mAcc[6]! / sim.s.gPot[6]!;
  sim.run(70, week, undefined, (d) => {
    w[d + 1] = sim.s.wR[6]!; // quadriceps
    g[d + 1] = sim.s.mAcc[6]! / sim.s.gPot[6]!;
    h[d + 1] = sim.s.hR[6]!;
  });
  it('swelling W ≈ 2.2 / 1.6 / 0.4 % at d 14 / 21 / 42 (± 0.6 point); d 7 1.2-3.0 % (09 prints 2.4 % with V = 10 from day 0, here the 7-day set window is still filling: 1.7 %)', () => {
    const target: [number, number][] = [[14, 0.022], [21, 0.016], [42, 0.004]];
    for (const [d, v] of target) expect(Math.abs(w[d]! - v)).toBeLessThanOrEqual(0.006);
    expect(w[7]!).toBeGreaterThanOrEqual(0.012);
    expect(w[7]!).toBeLessThanOrEqual(0.03);
  });
  it('Damas 2016: apparent CSA +2.7 % ± 1 at week 3, mostly swelling', () => {
    const trueRel = ((g[21]! - g[0]!) * sim.s.gPot[6]!) / (sim.k.w[6]! * sim.profile.body.skeletalMuscleKg);
    const apparent = (1 + w[21]!) * (1 + trueRel) - 1;
    expect(Math.abs(apparent - 0.027)).toBeLessThanOrEqual(0.01);
    expect(w[21]!).toBeGreaterThan(0.5 * apparent);
  });
  it('oedema ≈ 0 by week 8 and swelling dominates the apparent change at week 3', () => {
    expect(w[56]!).toBeLessThan(0.005);
    // true relative growth of the quadriceps at week 3: ΔM_acc,quads / (w_quads · SM₀)
    const trueRel = ((g[21]! - g[0]!) * sim.s.gPot[6]!) / (sim.k.w[6]! * sim.profile.body.skeletalMuscleKg);
    expect(w[21]!).toBeGreaterThan(trueRel);
  });
  it('habituation H ≈ 0.40 / 0.65 / 0.79 / 0.96 at d 7 / 14 / 21 / 42 (± 0.02; exact daily exponentials)', () => {
    const target: [number, number][] = [[7, 0.4], [14, 0.65], [21, 0.79], [42, 0.96]];
    for (const [d, v] of target) expect(Math.abs(h[d]! - v)).toBeLessThanOrEqual(0.02);
  });
});

describe('09 #12 Ogasawara 2011/2013, Psilander 2019 — breaks and detraining', () => {
  const trainThenStop = (stopDays: number): { gained: number; lost: number; nPeak: number; nEnd: number } => {
    const sim = new MuscleSim(person(YOUNG_MAN));
    const train = rtWeek(sim, 4, 3, 1.6);
    const rest = compileWeek(sim.profile, [program('B', { proteinGkg: 1.6 })], [0]);
    sim.run(70, train);
    const gained = sim.gain();
    const nPeak = sim.s.nNeural;
    sim.run(stopDays, rest);
    return { gained, lost: gained - sim.gain(), nPeak, nEnd: sim.s.nNeural };
  };
  it('3-week break: ≤ 2 % of the training gain lost (model ≈ 0 %)', () => {
    const r = trainThenStop(21);
    expect(r.lost / r.gained).toBeLessThanOrEqual(0.02);
  });
  it('20 weeks of detraining: 82 % ± 10 of the gain lost (MT back towards baseline)', () => {
    const r = trainThenStop(140);
    expect(Math.abs(r.lost / r.gained - 0.82)).toBeLessThanOrEqual(0.1);
  });
  it('neural strength component largely retained after 20 wk (Psilander "~60 %")', () => {
    const r = trainThenStop(140);
    expect(r.nEnd / r.nPeak).toBeGreaterThan(0.5);
    expect(r.nEnd / r.nPeak).toBeLessThan(0.7);
  });
});

describe('09 #13 Bickel 2011 — maintenance dose after 16 wk of training, 32 wk', () => {
  const run = (age: number, maintSets: number): { before: number; after: number } => {
    const sim = new MuscleSim(person({ ...YOUNG_MAN, age }));
    sim.run(112, rtWeek(sim, 9, 3, 1.4)); // 27 sets/wk
    const before = sim.gain();
    sim.run(224, rtWeek(sim, maintSets, 1, 1.4));
    return { before, after: sim.gain() };
  };
  it('young (25 y): 1/9 dose (3 sets/wk) and 1/3 dose (9 sets/wk) preserve the gain', () => {
    for (const v of [3, 9]) {
      const r = run(25, v);
      expect(r.after).toBeGreaterThanOrEqual(r.before);
    }
  });
  it('older (65 y): 3 sets/wk loses, 9 sets/wk preserves', () => {
    const lo = run(65, 3);
    const hi = run(65, 9);
    expect(lo.after).toBeLessThan(lo.before);
    expect(hi.after).toBeGreaterThanOrEqual(hi.before);
  });
});

describe('09 #14 McDonald / Aragon-Helms heuristics (grade D) — optimal training, man 1.78 m, 25 y', () => {
  it('year 1-4 gains within the heuristic ranges or ±10 % of the dossier model (10.8-11.2 / 4.5 / 1.9 / 0.8 kg)', () => {
    const sim = new MuscleSim(person(YOUNG_MAN));
    const week = rtWeek(sim, 5, 4, 2.0); // V 20, P ≥ 1.6, e = +0.10
    const yr: number[] = [];
    let prev = 0;
    for (let y = 0; y < 4; y++) {
      sim.run(365, week, (_d, bus) => void (bus.energyBalanceFrac = 0.1));
      yr.push(sim.gain() - prev);
      prev = sim.gain();
    }
    // model 11.01 / 4.49 / 1.93 / 0.86 kg
    const ok = (v: number, lo: number, hi: number, model: number): boolean => (v >= lo && v <= hi) || Math.abs(v / model - 1) <= 0.1;
    expect(ok(yr[0]!, 9, 11, 11.0)).toBe(true);
    expect(ok(yr[1]!, 4.5, 5.5, 4.5)).toBe(true);
    expect(ok(yr[2]!, 2.3, 2.7, 1.9)).toBe(true);
    expect(ok(yr[3]!, 0.9, 1.4, 0.8)).toBe(true);
    expect(sim.s.ts).toBeLessThan(0.98);
  });
});

describe('09 §4.14 strength after R-STR — novice, 12 wk, V 12, heavy loads, F 2', () => {
  it('strength index +23 % ± 4 (inside 19-27 %) measured after 3 rest days', () => {
    const sim = new MuscleSim(person(YOUNG_MAN));
    const sm0 = sim.bus.skeletalMuscleKg;
    const train = rtWeek(sim, 6, 2, 1.6, 85);
    const rest = compileWeek(sim.profile, [program('B', { proteinGkg: 1.6 })], [0]);
    // composition emulation: SM follows 0.7·(Σ A_r − Σ D_r) (review M10 split) with a one-day lag
    const follow = (): void => void (sim.bus.skeletalMuscleKg += 0.7 * sim.bus.rtAccretionKgD);
    sim.run(84, train, undefined, follow);
    sim.run(3, rest, undefined, follow);
    const gain = sim.strength() - 100; // model ≈ +21.5 %
    expect(sim.bus.skeletalMuscleKg / sm0).toBeGreaterThan(1.03);
    expect(Math.abs(gain - 23)).toBeLessThanOrEqual(4);
    expect(gain).toBeGreaterThanOrEqual(19);
    expect(gain).toBeLessThanOrEqual(27);
  });
});

describe('09 §7 acute target / 03 §4.12 — post-exercise MPS (fasted), ± 20 %-points', () => {
  /** All 9 regions, 20 sets to 0 RIR in one hour (08:00 of day 1; I_b ≈ 0.99), no food; returns the hourly MPS index. */
  const mpsAfterBout = (p: PersonOpts): number[] => {
    const sim = new MuscleSim(person(p));
    const fast = program('F', { proteinGkg: 0, meals: 1 });
    const days = compileWeek(sim.profile, [fast], [0, 0, 0, 0]);
    const series: number[] = [];
    for (let d = 0; d < 4; d++) {
      sim.runDay(days[d]!, (h, hour, bus) => {
        bus.raAaQGH = 0;
        if (d === 1 && h === 8) {
          hour.rtSetsByRegion.fill(20);
          hour.rtSetsTotal = 180;
          hour.rtRir = 0;
          hour.rtLoadPct1RM = 75;
          hour.rtToFailure = 0;
        }
      });
      for (let h = 0; h < 24; h++) series.push(sim.mpsHours[h]!);
    }
    return series;
  };
  it('untrained (Phillips 1997): +112 % at 3 h, +65 % at 24 h, +34 % at 48 h', () => {
    const s = mpsAfterBout(YOUNG_MAN);
    const at = (dt: number): number => s[24 + 8 + dt]! - 100; // bout in hour 8 of day 1; index at the hour midpoint
    expect(Math.abs(at(3) - 112)).toBeLessThanOrEqual(20);
    expect(Math.abs(at(24) - 65)).toBeLessThanOrEqual(20);
    expect(Math.abs(at(48) - 34)).toBeLessThanOrEqual(20);
  });
  it('trained, habituated (Tang 2008): back to rest by 28 h (within 20 points)', () => {
    const s = mpsAfterBout({ ...YOUNG_MAN, trainingYears: 4, trainingHistory: 'gt3y' });
    expect(s[24 + 8 + 28]! - 100).toBeLessThanOrEqual(20);
    expect(s[24 + 8 + 3]! - 100).toBeGreaterThan(50);
  });
});
