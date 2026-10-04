// @vitest-environment node
/**
 * Validation targets of WP-M12 (MODEL_SPEC §1.14, §9.2): 06 §7 V1-V14, 04 §7 insulin-sensitivity targets (§4.18-4.19),
 * 13 §4.8 / V6 (Jansen OGTT recovery slope), 20 §4.7 (fasting urate). The module is driven directly with hand-built
 * signals taken from each trial's own description (fat mass / energy balance / BHB of the trial); the trial diets are the
 * dossiers' macro descriptions, unspecified fat classes keep the habitual composition.
 *
 * A target the module misses stays here as `it.fails` with the measured number in the comment (never loosened); the
 * tolerance of each `it` is the dossier's own unless a comment says a tolerance was not stated.
 */
import { buildModelParams, sampleParams } from '../../core/paramsRegistry';
import { cardiometabolicModule } from './index';
import { dietDay, makeRig, MAN_PROFILE, RIG_FAT_SHARE, run, spotBhb, WOMAN_PROFILE, type Rig } from './testkit';

const near = (a: number, b: number, tol: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);
const within = (x: number, target: number, rel: number) => expect(Math.abs(x - target)).toBeLessThanOrEqual(Math.abs(target) * rel);

const man = (age: number, bmi: number, cm = 178) => ({ ...MAN_PROFILE, body: { sex: 'male' as const, ageYears: age, heightCm: cm, weightKg: bmi * (cm / 100) ** 2 } });
const woman = (age: number, bmi: number, cm = 165) => ({ ...WOMAN_PROFILE, body: { sex: 'female' as const, ageYears: age, heightCm: cm, weightKg: bmi * (cm / 100) ** 2 } });
/** Fat mass after losing `kg` of body weight (the module converts back with its fat share of weight change). */
const fmAfterLoss = (rig: Rig, kg: number) => rig.fm0 - RIG_FAT_SHARE * kg;
/** Hand-built weight-loss trajectory: 60 % of the loss in week 1, the rest linearly (fasting/VLCD/CR shape). */
const frontLoaded = (d: number, n: number) => (d < 7 ? (0.6 * (d + 1)) / 7 : Math.min(1, 0.6 + (0.4 * (d - 6)) / (n - 7)));

// ------------------------------------------------------------------------------------------------------------------
describe('06 V1 Mensink 2016 exchange coefficients', () => {
  it('10 %E SFA → cis-PUFA (60 d): LDL −0.55 mmol/L, HDL −0.05, TG −0.10, TC −0.64 within ±25 %', () => {
    const rig = makeRig({ labs: { ldlMmolL: 112 / 38.67, tgMmolL: 1.2 } });
    const h = rig.k.hab;
    const r = run(rig, 60, () => ({ day: dietDay(rig, { sfaPct: h.sfaTotPct - 10, pufaPct: h.pufaPct + 10 }) }))[59]!;
    const dLdl = (r.ldl - rig.k.ldl0) / 38.67;
    const dHdl = (r.hdl - rig.k.hdl0) / 38.67;
    const dTg = (r.tg - rig.k.tg0) / 88.57;
    within(dLdl, -0.55, 0.25);
    within(dHdl, -0.05, 0.25);
    within(dTg, -0.1, 0.25);
    within(dLdl + dHdl + dTg / 2.2, -0.64, 0.25); // TC = LDL + HDL + TG/2.2 (mmol/L)
  });
  it('10 %E carbohydrate → SFA: LDL +0.36, HDL +0.11, TG −0.12 mmol/L within ±25 %', () => {
    const rig = makeRig({ labs: { ldlMmolL: 112 / 38.67, tgMmolL: 1.2 } });
    const h = rig.k.hab;
    const r = run(rig, 60, () => ({ day: dietDay(rig, { sfaPct: h.sfaTotPct + 10 }) }))[59]!;
    within((r.ldl - rig.k.ldl0) / 38.67, 0.36, 0.25);
    within((r.hdl - rig.k.hdl0) / 38.67, 0.11, 0.25);
    within((r.tg - rig.k.tg0) / 88.57, -0.12, 0.25);
  });
  it('the response is complete within the 3-5 week trials (τ 7 d) and reverses symmetrically', () => {
    const rig = makeRig({ labs: { ldlMmolL: 112 / 38.67 } });
    const h = rig.k.hab;
    const on = run(rig, 35, () => ({ day: dietDay(rig, { sfaPct: h.sfaTotPct + 8 }) }));
    const full = on[34]!.ldl - rig.k.ldl0;
    expect(on[20]!.ldl - rig.k.ldl0).toBeGreaterThan(0.94 * full); // 95 % by 3 weeks (06 §4.2.4)
    const off = run(rig, 35, () => ({}));
    expect(off[34]!.ldl - rig.k.ldl0).toBeLessThan(0.02 * full);
  });
});

describe('06 V2 dietary cholesterol (Clarke 1997, Weggemans 2001)', () => {
  it('+200 mg/d for ~1 month: TC +0.11-0.13 mmol/L, LDL +0.10 mmol/L within ±30 %', () => {
    const rig = makeRig();
    const r = run(rig, 30, () => ({ day: dietDay(rig, { cholesterolMg: rig.k.chol0Mg + 200 }) }))[29]!;
    const dLdl = (r.ldl - rig.k.ldl0) / 38.67;
    const dHdl = (r.hdl - rig.k.hdl0) / 38.67;
    within(dLdl, 0.1, 0.3);
    within(dLdl + dHdl, 0.12, 0.3);
  });
});

describe('06 V3 Skulas-Ray 2011 omega-3 (men, TG 150-500 mg/dL)', () => {
  it('3.4 g/d EPA+DHA for 8 weeks: TG 237 → 173 mg/dL (−27 %) within ±8 points; LDL/HDL unchanged', () => {
    const rig = makeRig({ labs: { tgMmolL: 237 / 88.57 } });
    const r = run(rig, 56, () => ({ day: dietDay(rig, { omega3G: 3.4 }) }))[55]!;
    near(r.tg / 237 - 1, -0.27, 0.08);
    expect(Math.abs(r.ldl - rig.k.ldl0)).toBeLessThan(0.1 * rig.k.ldl0);
  });
  it('0.85 g/d has no effect (|Δ| < 8 points)', () => {
    const rig = makeRig({ labs: { tgMmolL: 237 / 88.57 } });
    const r = run(rig, 56, () => ({ day: dietDay(rig, { omega3G: 0.85 }) }))[55]!;
    expect(Math.abs(r.tg / 237 - 1)).toBeLessThan(0.08);
  });
});

describe('06 V4 Browning 2011 (NAFLD BMI 35, 2 weeks 1 200-1 500 kcal vs < 20 g carbohydrate/d)', () => {
  const scenario = (kgLoss: number, bhb: number, carbG: number) => {
    const rig = makeRig({ profile: man(40, 35), labs: { liverFatPct: 12 } });
    const r = run(rig, 14, (d) => ({ u: -0.5, bhb: spotBhb(bhb), fmKg: fmAfterLoss(rig, kgLoss * frontLoaded(d, 14)), day: dietDay(rig, { kcal: 1350, carbG }) }));
    return r[13]!.liver / 12 - 1;
  };
  it('calorie restriction: IHTG −28 % ± 10 points', () => near(scenario(4.0, 0.3, 180), -0.28, 0.1));
  it('low carbohydrate (ketotic): IHTG −55 % ± 10 points', () => near(scenario(4.6, 2.0, 20), -0.55, 0.1));
  it('the ketogenic advantage at equal weight loss is positive (Δ ≈ −27 points, ratio 0.63 in the dossier)', () => {
    expect(scenario(4.6, 2.0, 20)).toBeLessThan(scenario(4.6, 0.3, 180) - 0.12);
  });
});

describe('06 V5 Mardinoglu 2018 (NAFLD, IHTG 16 %, isocaloric < 30 g carbohydrate, 14 d)', () => {
  const rig = () => makeRig({ profile: man(40, 35), labs: { liverFatPct: 16 } });
  const scenario = () => {
    const r0 = rig();
    const bw = r0.ctx.profile.weightKg;
    return run(r0, 14, (d) => ({ u: 0, bhb: spotBhb(1.5), fmKg: fmAfterLoss(r0, 0.018 * bw * frontLoaded(d, 14)), day: dietDay(r0, { carbG: 25 }) }));
  };
  it('the fall is significant already at day 1 (sign) and continues', () => {
    const r = scenario();
    expect(r[0]!.liver).toBeLessThan(16);
    expect(r[13]!.liver).toBeLessThan(r[0]!.liver);
  });
  // MISS: measured −28.7 % (11.41 %) vs −43.8 % ± 10 points. The dossier's f_cr = exp(−0.40) with τ_down 12 d reaches only 69 %
  // of its steady state (−0.535 ln incl. the −1.8 % weight term) after 14 d. Not loosened; see the report (calibration item).
  it.fails('IHTG −43.8 % ± 10 points at day 14', () => near(scenario()[13]!.liver / 16 - 1, -0.438, 0.1));
  it('returns toward baseline after resuming the usual diet (τ up 21 d, hysteresis-free)', () => {
    const r0 = rig();
    const bw = r0.ctx.profile.weightKg;
    run(r0, 14, (d) => ({ u: 0, bhb: spotBhb(1.5), fmKg: fmAfterLoss(r0, 0.018 * bw * frontLoaded(d, 14)), day: dietDay(r0, { carbG: 25 }) }));
    const after = run(r0, 60, () => ({ u: 0, bhb: spotBhb(0.1), fmKg: fmAfterLoss(r0, 0.018 * bw) }));
    expect(after[59]!.liver).toBeGreaterThan(0.85 * 16 * 0.93); // back within ~15 % of the pre-diet level after 2 months
  });
});

describe('06 §4.9 weight-loss liver fat: −40 % at 7 % loss ± 15 points (Kirk 2009, ≈ 11 weeks, BMI 36)', () => {
  const kirk = (bhb: number, carbG: number) => {
    const rig = makeRig({ profile: man(45, 36), labs: { liverFatPct: 10 } });
    const kg = 0.07 * rig.ctx.profile.weightKg;
    const r = run(rig, 77, (d) => ({ u: -0.25, bhb: spotBhb(bhb), fmKg: fmAfterLoss(rig, (kg * (d + 1)) / 77), day: dietDay(rig, { kcal: rig.k.hab.energyKcal * 0.75, carbG }) }));
    return r[76]!.liver / 10 - 1;
  };
  it('hypocaloric high-carbohydrate arm: IHTG −44.5 % (observed) within the spec band −40 ± 15 points', () => {
    near(kirk(0.2, 220), -0.4, 0.15);
    near(kirk(0.2, 220), -0.445, 0.15);
  });
  // MISS (informational, dossier flags the sustained ketogenic advantage as uncertain): Kirk's low-carbohydrate arm lost 38 % at 11 weeks
  // (equal to the high-carbohydrate arm); the model keeps the −0.40 ln ketosis term and predicts ≈ −60 %.
  it.fails('low-carbohydrate arm at 11 weeks: IHTG −38 % ± 15 points (no sustained ketogenic advantage in Kirk 2009)', () => near(kirk(1.5, 40), -0.38, 0.15));
});

describe('MODEL_SPEC §1.14 "Hall 2016 KD LDL": isocaloric switch to 5 %E carbohydrate for 4 weeks in overweight men (BMI 25-35)', () => {
  // The dossiers give no numeric LDL target for Hall 2016 (13 V1 is a weight/N-balance target); the check is qualitative: the mean
  // response of overweight men is modest and far below the lean-adult response (06 §4.3: mean effects in mixed populations +5…+16 mg/dL).
  const ketoSwitch = (bmi: number) => {
    const rig = makeRig({ profile: man(35, bmi) });
    const r = run(rig, 28, (d) => ({ u: 0, bhb: spotBhb(1.2), fmKg: fmAfterLoss(rig, (2.2 * (d + 1)) / 28), day: dietDay(rig, { proteinPct: 16, carbPct: 5, sfaPct: 28, mufaPct: 32, pufaPct: 9 }) }))[27]!;
    return r.ldl - rig.k.ldl0;
  };
  it('BMI 30: LDL change is positive but modest (< 45 mg/dL) and at least 15 mg/dL below the BMI-22 response', () => {
    const over = ketoSwitch(30);
    expect(over).toBeGreaterThan(0);
    expect(over).toBeLessThan(45);
    expect(over).toBeLessThan(ketoSwitch(22) - 15);
  });
});

describe('06 V6 Lim 2011 (T2D BMI 33.6, 600 kcal/d × 8 weeks, −15.3 kg)', () => {
  const rig = () => makeRig({ profile: { ...MAN_PROFILE, body: { sex: 'male', ageYears: 50, heightCm: 168, weightKg: 95 } }, labs: { fastingGlucoseMmolL: 9.2, tgMmolL: 2.4, liverFatPct: 12.8 } });
  const traj = (d: number) => (d < 7 ? 3.9 * ((d + 1) / 7) : 3.9 + (11.4 * (d - 6)) / 49);
  const scenario = () => {
    const r0 = rig();
    return run(r0, 56, (d) => ({ u: -0.75, bhb: spotBhb(1.0), fmKg: fmAfterLoss(r0, traj(d)), day: dietDay(r0, { kcal: 600 }) }));
  };
  it('liver fat: −30 % in week 1 and 12.8 → 2.9 % at 8 weeks within ±20 %', () => {
    const r = scenario();
    within(r[6]!.liver, 12.8 * 0.7, 0.2);
    within(r[55]!.liver, 2.9, 0.2);
  });
  // MISS: measured 8.22 mmol/L at week 1 (target 5.9 ± 20 %). The dossier's acute term −0.3·(FPG0 − 100)·(D − 0.2)/0.5 caps the
  // acute fall at ≈ −22 mg/dL for FPG0 166 mg/dL; "normalised within 1 week" needs ≈ −60. Dossier-internal inconsistency.
  it.fails('fasting glucose 9.2 → 5.9 mmol/L by week 1 (±20 %)', () => within(scenario()[6]!.fpg / 18.02, 5.9, 0.2));
  // MISS: measured 1.61 mmol/L (target 1.2 ± 20 %); the acute amplitude ln TG −0.6·(D − 0.2) with τ 5 d gives −33 % by week 1, not −50 %.
  it.fails('triglycerides 2.4 → 1.2 mmol/L in week 1 (±20 %)', () => within(scenario()[6]!.tg / 88.57, 1.2, 0.2));
  it('the direction and ordering of the week-1 changes match (FPG ↓, TG ↓, liver ↓; all still falling at week 8)', () => {
    const r = scenario();
    expect(r[6]!.fpg).toBeLessThan(9.2 * 18.02);
    expect(r[6]!.tg).toBeLessThan(2.4 * 88.57);
    expect(r[55]!.fpg).toBeLessThan(r[6]!.fpg);
    expect(r[55]!.tg).toBeLessThan(r[6]!.tg);
  });
});

describe('06 V7 overfeeding: liver fat by macronutrient type (Luukkonen 2018, Rosqvist 2014/2019)', () => {
  const overfeed = (cls: 'sfa' | 'mufa' | 'pufa' | 'sugar', kcal: number, gainKg: number, days: number) => {
    const rig = makeRig({ profile: man(40, 31), labs: { liverFatPct: 4.7 } });
    const h = rig.k.hab;
    const E = h.energyKcal + kcal;
    const o: Parameters<typeof dietDay>[1] = { kcal: E, keepGrams: true };
    if (cls === 'sfa') o.sfaPct = (((h.sfaTotPct / 100) * h.energyKcal + kcal) / E) * 100;
    if (cls === 'mufa') o.mufaPct = (((h.mufaPct / 100) * h.energyKcal + kcal) / E) * 100;
    if (cls === 'pufa') o.pufaPct = (((h.pufaPct / 100) * h.energyKcal + kcal) / E) * 100;
    if (cls === 'sugar') {
      o.sugarsG = ((h.sugarPct / 100) * h.energyKcal + kcal) / 4;
      o.carbG = rig.hab.carbG + kcal / 4;
    }
    const r = run(rig, days, (d) => ({ u: 0.3, eb7: 0.8 * kcal, fmKg: rig.fm0 + RIG_FAT_SHARE * gainKg * ((d + 1) / days), day: dietDay(rig, o) }));
    return r[days - 1]!.liver / 4.7 - 1;
  };
  it('+1 000 kcal/d for 3 weeks: SFA +55 %, unsaturated +15 %, simple sugars +33 % within ±15 points', () => {
    near(overfeed('sfa', 1000, 1.4, 21), 0.55, 0.15);
    near(overfeed('mufa', 1000, 0.9, 21), 0.15, 0.15);
    near(overfeed('sugar', 1000, 1.4, 21), 0.33, 0.15);
  });
  it('ordering SFA > sugars > unsaturated > n-6 PUFA (LIPOGAIN: PUFA ≈ 0 at equal weight gain)', () => {
    const sfa = overfeed('sfa', 750, 2.0, 56);
    const sug = overfeed('sugar', 750, 2.0, 56);
    const mufa = overfeed('mufa', 750, 2.0, 56);
    const pufa = overfeed('pufa', 750, 2.0, 56);
    expect(sfa).toBeGreaterThan(sug);
    expect(sug).toBeGreaterThan(mufa);
    expect(mufa).toBeGreaterThan(pufa);
    near(pufa, 0, 0.03);
  });
  // MISS: measured +68.5 % (SFA, +2.31 kg over 8 weeks; target +50 % ± 15 points). k_SFA = 28 is the middle of the dossier's
  // 20-37 range; LIPOGAIN-2 alone implies k ≈ 20 (≈ +48 %). Inside the registry range [20, 37]; nominal not changed.
  it.fails('8-week SFA overfeeding (+2.31 kg): liver fat +50 % ± 15 points (Rosqvist 2019)', () => near(overfeed('sfa', 750, 2.31, 56), 0.5, 0.15));
});

describe('06 V8 Magkos 2016 (obese BMI 40, weight-stable after 5.1 / 10.8 / 16.4 % loss)', () => {
  const labs = { tgMmolL: 153 / 88.57, liverFatPct: 8.5, crpMgL: 4.7, ldlMmolL: 115 / 38.67, hdlMmolL: 43 / 38.67, fastingGlucoseMmolL: 92.7 / 18.02 };
  const at = (pct: number) => {
    const rig = makeRig({ profile: man(45, 40, 175), labs });
    const kg = (pct / 100) * rig.ctx.profile.weightKg;
    const r = run(rig, 56 + 84, (d) => ({ u: d < 56 ? -0.2 : 0, bhb: spotBhb(0.2), fmKg: fmAfterLoss(rig, kg * (d < 56 ? (d + 1) / 56 : 1)) }));
    return r[r.length - 1]!;
  };
  const steps: [number, number, number, number][] = [
    [5.1, 7.4, 130, 4.7],
    [10.8, 4.1, 110, 5.5],
    [16.4, 3.0, 97, 3.1],
  ];
  it('triglycerides 153 → 130 / 110 / 97 mg/dL within ±15 %', () => {
    for (const [p, , tg] of steps) within(at(p).tg, tg, 0.15);
  });
  it('liver fat 8.5 → 4.1 % at 10.8 % loss within ±15 %', () => within(at(10.8).liver, 4.1, 0.15));
  // MISS: 5.1 % step measured 5.80 % (target 7.4 % ± 15 %; the dossier's f_wl = exp(−0.075·%WL) over-predicts the first step, its own
  // calibration table lists 0.72-0.59-0.44 vs observed 0.87-0.48) and 16.4 % step 2.49 % (target 3.0 % ± 15 %, dossier: 0.29 vs 0.35).
  it.fails('liver fat 8.5 → 7.4 % at 5.1 % loss within ±15 %', () => within(at(5.1).liver, 7.4, 0.15));
  it.fails('liver fat 8.5 → 3.0 % at 16.4 % loss within ±15 %', () => within(at(16.4).liver, 3.0, 0.15));
  it('hs-CRP: threshold rule gives no meaningful fall at 5 %, and a fall at 16 % (correct sign only at 16 %)', () => {
    expect(at(5.1).crpRel).toBeGreaterThan(0.9);
    expect(at(16.4).crpRel * 4.7).toBeLessThan(4.7);
    expect(at(16.4).crpRel).toBeLessThan(at(5.1).crpRel);
  });
  it('LDL, HDL and fasting glucose stay ≈ unchanged (within ±15 % of baseline)', () => {
    for (const [p] of steps) {
      const e = at(p);
      within(e.ldl, 115, 0.15);
      within(e.hdl, 43, 0.15);
      within(e.fpg, 92.7, 0.15);
    }
  });
});

describe('06 V9 blood pressure: DASH and sodium (Appel 1997, Sacks 2001, Juraschek 2017)', () => {
  const dash = (sbp0: number, days: number) => {
    const rig = makeRig({ labs: { sbpMmHg: sbp0 } });
    return run(rig, days, () => ({ day: dietDay(rig, { foodQuality: 3 }) }))[days - 1]!.sbp - sbp0;
  };
  it('DASH 8 weeks: −5.5 mmHg (mean baseline SBP 131), hypertensives −11.4, normotensives −3.5, within ±1.5 mmHg', () => {
    near(dash(131, 56), -5.5, 1.5);
    near(dash(150, 56), -11.4, 1.5);
    near(dash(120, 56), -3.5, 1.5);
  });
  it('most of the DASH effect is present after week 1 (−4.4 of −5.5 mmHg; ±1.5)', () => near(dash(131, 7), -4.4, 1.5));
  const sodium = (sbp0: number, days: number) => {
    const rig = makeRig({ profile: { ...MAN_PROFILE, habits: { habitualSodiumG: 3.45 } }, labs: { sbpMmHg: sbp0 } });
    return run(rig, days, () => ({ day: dietDay(rig, { sodiumG: 1.15 }) }))[days - 1]!.sbp - sbp0;
  };
  it('sodium 150 → 50 mmol/d (control diet) keeps falling through week 4 (no plateau; weekly slope < 0 at day 28)', () => {
    const rig = makeRig({ profile: { ...MAN_PROFILE, habits: { habitualSodiumG: 3.45 } }, labs: { sbpMmHg: 145 } });
    const r = run(rig, 35, () => ({ day: dietDay(rig, { sodiumG: 1.15 }) }));
    expect(r[34]!.sbp).toBeLessThan(r[27]!.sbp - 0.2);
  });
  it('sodium 150 → 50 mmol/d in hypertensive-range baseline (SBP0 145): steady-state −5.5 mmHg (target −6.7 ± 1.5)', () => {
    near(sodium(145, 150), -6.7, 1.5);
  });
  // MISS: at the Sacks-trial mean baseline SBP (≈ 135 mmHg) the dossier slope β_Na = 1.0 + 1.8·sigmoid gives −4.4 mmHg steady-state
  // (−3.3 after 30 d) vs −6.7 ± 1.5. The dossier's population slope (1.9 mmHg/g at 135) is below Sacks' observed 2.9 mmHg/g.
  it.fails('sodium 150 → 50 mmol/d at mean trial baseline SBP 135: −6.7 mmHg ± 1.5', () => near(sodium(135, 150), -6.7, 1.5));
});

describe('06 V10 HbA1c kinetics (Tahara 1995)', () => {
  it('HbA1c half-time = 34.6 d ± 10 (τ 50 d)', () => {
    const { k } = makeRig();
    const halfTime = -Math.LN2 / Math.log(k.fA1c);
    near(halfTime, 34.6, 1.0);
  });
  it('a sustained fasting-glucose fall of 12 mg/dL moves HbA1c by −0.54 % (eAG factor 1.3) at steady state', () => {
    const rig = makeRig();
    rig.s.fpgWeight = -12;
    // hold the FPG state by resetting it each day (its own τ 30 d would otherwise decay to the weight target of 0)
    const days = 400;
    for (let d = 0; d < days; d++) {
      rig.s.fpgWeight = -12;
      run(rig, 1, () => ({}));
    }
    near(rig.s.a1cDelta, -0.54, 0.03);
  });
});

describe('06 V11 LDL response depends on BMI (Buren 2021, Retterstol 2018, Petersen 2026)', () => {
  it('(a) lean young women, ketogenic 4 weeks: LDL ≈ +70 mg/dL (model within ±30 %), increases in every ensemble member', () => {
    const rig = makeRig({ profile: woman(27, 22) });
    const r = run(rig, 28, (d) => ({ u: -0.02, bhb: spotBhb(1.5), fmKg: fmAfterLoss(rig, (3 * (d + 1)) / 28), day: dietDay(rig, { proteinPct: 19, carbPct: 4, sfaPct: 30, mufaPct: 28, pufaPct: 10 }) }))[27]!;
    within(r.ldl - rig.k.ldl0, 70, 0.3);
    const base = buildModelParams([cardiometabolicModule as never]);
    const draws = sampleParams(base.defs, { count: 40, seed: 5 });
    for (const v of draws) {
      const params: Record<string, number> = {};
      base.defs.forEach((d, i) => (params[d.id.replace('cardiometabolic.', '')] = v[i]!));
      const g = makeRig({ profile: woman(27, 22), params });
      const e = run(g, 28, (d) => ({ u: -0.02, bhb: spotBhb(1.5), fmKg: fmAfterLoss(g, (3 * (d + 1)) / 28), day: dietDay(g, { proteinPct: 19, carbPct: 4, sfaPct: 30, mufaPct: 28, pufaPct: 10 }) }))[27]!;
      expect(e.ldl).toBeGreaterThan(g.k.ldl0); // 17/17 increased
    }
  });
  const retterstol = (params: Record<string, number> = {}) => {
    const rig = makeRig({ profile: man(25, 23), params });
    const r = run(rig, 21, () => ({ u: 0, bhb: spotBhb(1.5), day: dietDay(rig, { proteinPct: 18, carbG: 20, sfaPct: 25, mufaPct: 25, pufaPct: 10 }) }))[20]!;
    return { dl: r.ldl - rig.k.ldl0, pct: r.ldl / rig.k.ldl0 - 1 };
  };
  it('(b) normal-weight adults < 20 g carbohydrate for 3 weeks: LDL +35 mg/dL (+44 %) — sign and order of magnitude', () => {
    const r = retterstol();
    expect(r.dl).toBeGreaterThan(0.5 * 35);
    expect(r.dl).toBeLessThan(2 * 35);
    near(r.pct, 0.44, 0.15);
  });
  it('(b) heavy tail: the parameter ensemble (200 draws) has a median near +44 % and its 99th percentile reaches the observed +107 %', () => {
    const base = buildModelParams([cardiometabolicModule as never]);
    const draws = sampleParams(base.defs, { count: 200, seed: 11 });
    const pct: number[] = [];
    for (const v of draws) {
      const params: Record<string, number> = {};
      base.defs.forEach((d, i) => (params[d.id.replace('cardiometabolic.', '')] = v[i]!));
      pct.push(retterstol(params).pct * 100);
    }
    pct.sort((a, b) => a - b);
    const q = (p: number) => pct[Math.floor(p * (pct.length - 1))]!;
    near(q(0.5), 44, 10);
    expect(q(0.99)).toBeGreaterThanOrEqual(107);
    expect(q(0.01)).toBeLessThanOrEqual(25);
    expect(q(0.9)).toBeGreaterThan(q(0.1) + 30); // the spread is wide (individual +5 … +107 %)
  });
  const petersen = () => {
    const rig = makeRig({ profile: man(50, 39, 172), labs: { ldlMmolL: 115 / 38.67 } });
    const kg = 0.105 * rig.ctx.profile.weightKg;
    const r = run(rig, 84, (d) => ({ u: -0.25, bhb: spotBhb(1.5), fmKg: fmAfterLoss(rig, (kg * (d + 1)) / 84), day: dietDay(rig, { proteinPct: 20, carbPct: 8, sfaPct: 23, mufaPct: 30, pufaPct: 10 }) }))[83]!;
    return { dl: r.ldl - 115, dApoB: r.apoB - rig.k.apoB0 };
  };
  it('(c) BMI 39 keto during ~10.5 % weight loss: the LEM term vanishes and ApoB falls (−6 mg/dL observed)', () => {
    const p = petersen();
    expect(p.dApoB).toBeLessThan(0);
    near(p.dApoB, -6, 4);
    expect(p.dl).toBeLessThan(retterstol().dl - 30); // the response collapses with BMI (order of magnitude difference vs lean)
  });
  // MISS: measured +2.7 mg/dL (observed −10 mg/dL, "the engine must flip sign with BMI"). Mensink SFA +23 %E (+16 mg/dL) is only
  // partly offset by MUFA/protein (−7) and the −0.6 mg/dL/kg weight term (−7); the model drops from +61 (lean) to ≈ +3 but does not
  // go negative. Dossier-internal (its fit list quotes −10 as reproduced by the same terms).
  it.fails('(c) BMI 39 keto: LDL −10 mg/dL (sign flips vs the lean result)', () => expect(petersen().dl).toBeLessThan(0));
});

describe('06 V12 DIETFITS 12 months (healthy low-fat 48/29/21 vs low-carbohydrate 30/45/23 %E carbohydrate/fat/protein)', () => {
  const arm = (carb: number, fat: number, prot: number, kg: number) => {
    const rig = makeRig({ profile: man(45, 33) });
    const sh = [0.32, 0.34, 0.23];
    const r = run(rig, 365, (d) => {
      const loss = d < 180 ? (1.4 * kg * (d + 1)) / 180 : 1.4 * kg - (0.4 * kg * (d - 179)) / 185;
      return { u: d < 180 ? -0.12 : 0.03, bhb: spotBhb(0.2), fmKg: fmAfterLoss(rig, loss), day: dietDay(rig, { proteinPct: prot, carbPct: carb, sfaPct: fat * sh[0]!, mufaPct: fat * sh[1]!, pufaPct: fat * sh[2]! }) };
    })[364]!;
    return { ldl: r.ldl - rig.k.ldl0, tg: r.tg - rig.k.tg0, hdl: r.hdl - rig.k.hdl0, sbp: r.sbp - rig.k.sbp0 };
  };
  const LF = () => arm(48, 29, 21, 5.3);
  const LC = () => arm(30, 45, 23, 6.0);
  it('TG −10 vs −28 mg/dL and HDL +0.4 vs +2.6 within ±4 mg/dL; the LC advantage in TG and HDL has the right sign', () => {
    const lf = LF();
    const lc = LC();
    near(lf.tg, -10, 4);
    near(lc.tg, -28, 4);
    near(lf.hdl, 0.4, 4);
    near(lc.hdl, 2.6, 4);
    expect(lc.tg).toBeLessThan(lf.tg);
    expect(lc.hdl).toBeGreaterThan(lf.hdl);
  });
  // MISS (both arms): LDL measured −6.5 (LF) and −5.1 (LC) mg/dL vs observed −2.1 and +3.6 (±4). The model puts both arms on the same
  // weight term (−0.6/kg ⇒ −3.6) and the SFA/protein exchange terms nearly cancel for LC; the observed low-carbohydrate LDL penalty
  // (+5.7 vs LF) is only +1.4 in the model because unspecified fat classes keep the habitual mix in this test (healthy LC diets are
  // MUFA-rich). Reported, not tuned.
  it.fails('LDL −2.1 (LF) within ±4 mg/dL', () => near(LF().ldl, -2.1, 4));
  it.fails('LDL +3.6 (LC) within ±4 mg/dL', () => near(LC().ldl, 3.6, 4));
  // MISS: SBP −6.2 / −8.0 vs −3.2 / −3.7 (±1 mmHg): the dossier's −1.05 mmHg/kg (Neter, RCTs of weight loss ≥ 6-12 months, mean −5.1 kg)
  // is steeper than the DIETFITS outcome (−0.6 mmHg/kg).
  it.fails('SBP −3.2 (LF) and −3.7 (LC) within ±1 mmHg', () => {
    near(LF().sbp, -3.2, 1);
    near(LC().sbp, -3.7, 1);
  });
});

describe('06 V13 / 20 V7 fasting urate (Grundler 2024; Dai 2024, Ogłodek 2021)', () => {
  // dossier 20 §4.3.4 water-only BHB reference (mmol/L) by day, lean adult
  const bhbRef = [0.3, 1.6, 2.5, 3.5, 4.0, 4.4, 4.6, 4.8, 5.0, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 6.0, 6.0, 6.0, 6.1];
  const fast = () => {
    const rig = makeRig();
    const zero = { energyKcal: 0, proteinG: 0, carbG: 0, fatG: 0, fibreG: 0, sugarsG: 0, fructoseG: 0, satFatG: 0, mufaG: 0, pufaG: 0, viscousFibreG: 0, omega3G: 0, alcoholG: 0 };
    const r = run(rig, 21, (d) => ({ u: -1, bhb: bhbRef[d]!, carb24: 0, fmKg: rig.fm0 - 0.13 * (d + 1), day: zero }));
    return { r, rig };
  };
  it('fasting 4-21 days: uric acid rises by +100 (low ketonuria) … +200 µmol/L (high) = +1.7 … +3.4 mg/dL, ± 40 %', () => {
    const { r, rig } = fast();
    for (const d of [6, 10, 20]) {
      const dUa = r[d]!.ua - rig.k.ua0;
      expect(dUa).toBeGreaterThan(1.7 * 0.6);
      expect(dUa).toBeLessThan(3.4 * 1.4);
    }
  });
  it('urate falls back within days after refeeding (τ 7 d down) and never goes negative', () => {
    const { rig } = fast();
    const after = run(rig, 14, () => ({ bhb: 0.2 }));
    expect(after[13]!.ua).toBeLessThan(rig.k.ua0 + 1.0);
    expect(after[13]!.ua).toBeGreaterThan(rig.k.ua0 - 1.0);
  });
  // MISS (20 §4.7 target): ×1.31 at day 8 and ×1.57 at day 21 vs ×2.2 ± 0.4. The 06 slope (+0.6 mg/dL per mM BHB, cap 4) matches
  // Grundler's +1.7-3.4 mg/dL but 20's Dai/Ogłodek cohorts rose by ≈ +8 mg/dL (0.38 → 0.85 mmol/L). MODEL_SPEC §1.14 step 7: the
  // 20 figure is a validation target, not an extra term — recorded as a known miss.
  it.fails('20 §4.7 / V7: uric acid ×2.2 ± 0.4 at day 8 of a water-only fast', () => {
    const { r } = fast();
    near(r[7]!.uaRel, 2.2, 0.4);
  });
});

describe('06 V14 per-kg coefficients (Neter 2003, Dattilo 1992)', () => {
  const lose10 = () => {
    const rig = makeRig({ profile: man(45, 28) });
    const r = run(rig, 260, (d) => ({ u: d < 40 ? -0.2 : 0, fmKg: fmAfterLoss(rig, 10 * (d < 40 ? (d + 1) / 40 : 1)) }));
    return { r, rig };
  };
  it('SBP −1.05 mmHg per kg lost (−10.5 for 10 kg, ±30 %)', () => {
    const { r, rig } = lose10();
    within(r[259]!.sbp - rig.k.sbp0, -10.5, 0.3);
  });
  it('HDL falls while actively losing (−0.27 mg/dL per kg) and rises above baseline once stable (+0.35 per kg)', () => {
    const { r, rig } = lose10();
    expect(r[30]!.hdl).toBeLessThan(rig.k.hdl0); // active phase
    near(r[259]!.hdl - rig.k.hdl0, 0.35 * 10, 3.5 * 0.3);
  });
  it('LDL −0.6 mg/dL per kg, TG −1.5 %/kg, urate −0.06 mg/dL per kg, FPG −b mg/dL per kg (0.5-3.5)', () => {
    const { r, rig } = lose10();
    within(r[259]!.ldl - rig.k.ldl0, -6, 0.3);
    within(r[259]!.tg / rig.k.tg0 - 1, Math.exp(-0.15) - 1, 0.3);
    within(r[259]!.ua - rig.k.ua0, -0.6, 0.3);
    const b = -(r[259]!.fpg - rig.k.fpg0) / 10;
    expect(b).toBeGreaterThanOrEqual(0.5);
    expect(b).toBeLessThanOrEqual(3.5);
  });
  it('weight regain reverses the components with the same time constants (hysteresis-free)', () => {
    const rig = makeRig({ profile: man(45, 28) });
    run(rig, 120, (d) => ({ u: d < 40 ? -0.2 : 0, fmKg: fmAfterLoss(rig, 10 * (d < 40 ? (d + 1) / 40 : 1)) }));
    const back = run(rig, 200, () => ({ fmKg: rig.fm0 }));
    near(back[199]!.sbp, rig.k.sbp0, 0.6);
    near(back[199]!.hdl, rig.k.hdl0, 0.6);
  });
});

// ------------------------------------------------------------------------------------------------------------------
describe('04 §4.18 insulin-sensitivity targets', () => {
  it('48 h at −1 000 kcal/d raises hepatic sensitivity and leaves muscle sensitivity ~unchanged (Kirk 2009)', () => {
    const rig = makeRig();
    const h0 = rig.s.sHep;
    const m0 = rig.s.sMus;
    const r = run(rig, 2, () => ({ u: -0.4, day: dietDay(rig, { kcal: rig.k.hab.energyKcal - 1000 }) }));
    expect(r[1]!.sHep / h0 - 1).toBeGreaterThan(0.05);
    expect(Math.abs(r[1]!.sMus / m0 - 1)).toBeLessThan(0.02);
  });
  it('one 4-h night lowers whole-body sensitivity by 25 % through F_sleep = siSleepMult (steady multiplier 0.75)', () => {
    const rig = makeRig();
    const si0 = rig.s.outSensitivity;
    const r = run(rig, 25, () => ({ sleepMult: 0.75 }));
    near(r[24]!.si / si0, 0.75, 0.01);
  });
  it('steps cut from 10 501 to 1 344/d: muscle sensitivity −17 % at steady state (Krogh-Madsen), ≈ −13 % after the 2-week lag chain (±40 %)', () => {
    const profile = { ...MAN_PROFILE, habits: { typicalSteps: 10501 } };
    const rig = makeRig({ profile });
    const m0 = rig.s.sMus;
    const r = run(rig, 90, () => ({ day: dietDay(rig, { steps: 1344 }) }));
    near(r[89]!.sMus / m0 - 1, -0.17, 0.005);
    const rig2 = makeRig({ profile });
    const m2 = rig2.s.sMus;
    const two = run(rig2, 14, () => ({ day: dietDay(rig2, { steps: 1344 }) }));
    within(two[13]!.sMus / m2 - 1, -0.17, 0.4);
  });
  it('acute exercise: insulin action is raised at 48 h and gone by 5 days (Mikines 1988)', () => {
    const rig = makeRig();
    const bout = [{ atH: 17, minutes: 60, intensity: 0.65 }];
    const d0 = run(rig, 1, () => ({ bouts: bout }));
    void d0;
    const f24 = rig.s.fExAcute;
    const after = run(rig, 5, () => ({}));
    void after;
    expect(f24).toBeGreaterThan(1.15);
    // states at the ends of day 2 (≈ 31 h after the session) and day 6 (≈ 127 h)
    const rig2 = makeRig();
    run(rig2, 1, () => ({ bouts: bout }));
    run(rig2, 2, () => ({}));
    const at48h = rig2.s.fExAcute; // end of day 3 = 55 h after the bout
    run(rig2, 3, () => ({}));
    const at5d = rig2.s.fExAcute; // end of day 6 = 127 h after the bout
    expect(at48h).toBeGreaterThan(1.02);
    expect(at5d).toBeLessThan(1.005 + 0.01);
    expect(at5d).toBeLessThan(at48h);
  });
  it('sedentary → the lagged 7-d step factor takes weeks; a habitual exerciser who keeps the routine shows no spurious change', () => {
    const p = { ...MAN_PROFILE, habits: { sessionsPerWeek: 4, lifingCardioMix: 1 } };
    const rig = makeRig({ profile: p });
    const si0 = rig.s.outSensitivity;
    const bout = [{ atH: 17, minutes: 60, met: 5 }];
    const r = run(rig, 56, (d) => ({ bouts: d % 7 < 4 ? bout : [] }));
    const mean = r.slice(42).reduce((a, x) => a + x.si, 0) / 14; // the acute pulse saw-tooths within the week
    near(mean / si0, 1, 0.05);
    // stopping the routine lowers sensitivity below baseline (detraining)
    const rig2 = makeRig({ profile: p });
    const s2 = rig2.s.outSensitivity;
    const stop = run(rig2, 56, () => ({}));
    expect(stop[55]!.si).toBeLessThan(s2);
  });
});

describe('04 §4.19 / 13 §4.8 carbohydrate tolerance T_C and the Jansen OGTT recovery (V6)', () => {
  it('3 days of very low carbohydrate lower T_C and raise the OGTT excess (Numao 2012); it reverses over days-weeks', () => {
    const rig = makeRig({ profile: { ...MAN_PROFILE } });
    const lc = run(rig, 3, () => ({ carb24: 20, day: dietDay(rig, { carbG: 20 }) }));
    expect(lc[2]!.ogtt).toBeGreaterThan(0.3);
    expect(lc[2]!.tc).toBeLessThan(0.8);
    const back = run(rig, 7, () => ({}));
    expect(back[6]!.ogtt).toBeLessThan(lc[2]!.ogtt);
  });
  it('13 V6: after a 15 % weight-loss very-low-carbohydrate run-in, 10 weeks at 57 %E carbohydrate: 2-h OGTT excess falls −0.07 … −0.10 mmol/L/wk over weeks 2-9 (±0.05)', () => {
    const rig = makeRig({ profile: { ...MAN_PROFILE, habits: { habitualCarbPctEnergy: 3 } } });
    expect(rig.s.tolerance).toBe(0); // fully carbohydrate-intolerant at the switch
    const r = run(rig, 70, () => ({ carb24: 350, day: dietDay(rig, { carbPct: 57 }) }));
    const slope = (r[62]!.ogtt - r[13]!.ogtt) / 7;
    near(slope, -0.085, 0.065); // target −0.07…−0.10 ± 0.05 ⇒ [−0.15, −0.02]
    expect(slope).toBeLessThan(-0.02);
    // weeks 2-9: the decline is monotone and the abnormal-OGTT flag clears once T_C > 0.9 (1 − T_C < 0.1)
    for (let d = 14; d < 62; d++) expect(r[d + 1]!.ogtt).toBeLessThan(r[d]!.ogtt);
    expect(r[69]!.tc).toBeGreaterThan(0.9);
  });
  it('staying on very low carbohydrate keeps the OGTT excess at its full value (VLC group: 10/16 stay abnormal)', () => {
    const rig = makeRig({ profile: { ...MAN_PROFILE, habits: { habitualCarbPctEnergy: 3 } } });
    const r = run(rig, 70, () => ({ carb24: 20, day: dietDay(rig, { carbG: 20 }) }));
    near(r[69]!.ogtt, r[13]!.ogtt, 0.01);
    expect(r[69]!.ogtt).toBeGreaterThan(1.9);
  });
});
