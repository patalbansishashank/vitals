// @vitest-environment node
/** 15 §4.9 rule table: worked numbers for the density projection, flags, patterns and the score. */
import {
  driReferences,
  evaluateMicro,
  FLAG_AMBER,
  FLAG_GREEN,
  FLAG_RED,
  FLAG_YELLOW,
  interpretNutrientIntake,
  MICRO_IDX,
  N_FLAGS,
  summariseKnownNutrient,
  TRACKED_IDX,
  type KnownNutrientSummary,
} from '../index';
import { FLAG_EFA, FLAG_FAT_SOL, FLAG_FIBRE, FLAG_IODINE } from '../microTables';
import { GOAL_CAPABILITY, isProductionGoalEligible } from '../../../types/metrics';
import type { DayExposureSummary } from '../../../types/inputs';
import type { ChannelCoverageMap } from '@/lib/bodyContracts';
import type { PersonProfile } from '../../../types/profile';
import { WOMAN, MAN, makeHarness, type Harness } from './harness';

interface Inputs {
  e?: number;
  carb?: number;
  fat?: number;
  fibre?: number;
  quality?: number;
  lowFatMeals?: number;
  efaLowDays?: number;
  endHrEma?: number;
}

/** Evaluate the rule table for a profile and hand-set 7-d EMAs (no dynamics involved). */
function evalFor(profile: PersonProfile, i: Inputs = {}) {
  const h = makeHarness(profile, { noBurnIn: true });
  const s = h.s;
  s.energyEma7 = i.e ?? 2000;
  s.carbEma7 = i.carb ?? 250;
  s.fatEma7 = i.fat ?? 80;
  s.fibreEma7 = i.fibre ?? 16;
  s.foodQuality = i.quality ?? 2;
  s.lowFatMealsEma7 = i.lowFatMeals ?? 0;
  s.efaLowDays = i.efaLowDays ?? 0;
  s.endHrEma = i.endHrEma ?? 0;
  evaluateMicro(h.k, s);
  return s;
}
const flag = (s: ReturnType<typeof evalFor>, key: keyof typeof MICRO_IDX): number => s.flags[MICRO_IDX[key]]!;

describe('15 §4.9 density projection and flags', () => {
  it('default omnivore woman, 2 000 kcal, quality 2: D RED, E AMBER, fibre AMBER, Mg/Ca YELLOW → score 88', () => {
    const s = evalFor(WOMAN);
    expect(flag(s, 'vitD')).toBe(FLAG_RED); // 2.2·2/10 = 0.44
    expect(flag(s, 'vitE')).toBe(FLAG_AMBER); // 4.7·2/12 = 0.783
    expect(s.flags[FLAG_FIBRE]).toBe(FLAG_AMBER); // 8 g/1000 kcal < 14
    expect(flag(s, 'mg')).toBe(FLAG_YELLOW); // 308/265 = 1.16
    expect(flag(s, 'ca')).toBe(FLAG_YELLOW); // 888/800 = 1.11
    for (const k of ['vitA', 'zn', 'vitC', 'folate', 'thiamin', 'iron', 'b12', 'vitK'] as const) expect(flag(s, k)).toBe(FLAG_GREEN);
    expect(s.nRed).toBe(1);
    expect(s.nAmber).toBe(2);
    expect(s.microScore).toBe(88);
    expect(s.caPatternMg).toBeCloseTo(888, 6);
  });

  it('default omnivore man (higher EARs): Mg AMBER 0.88, D RED, E AMBER, fibre AMBER → score 85', () => {
    const s = evalFor(MAN);
    expect(flag(s, 'mg')).toBe(FLAG_AMBER); // 308/350
    expect(flag(s, 'vitK')).toBe(FLAG_YELLOW); // 128/120 = 1.07
    expect(s.nRed).toBe(1);
    expect(s.nAmber).toBe(3);
    expect(s.microScore).toBe(85);
  });

  it('intake is density × E/1000: halving energy halves the projected calcium', () => {
    const a = evalFor(WOMAN, { e: 2000 }).caPatternMg;
    const b = evalFor(WOMAN, { e: 1000 }).caPatternMg;
    expect(b / a).toBeCloseTo(0.5, 12);
  });

  it('a typical-density diet at ≤ ~1 700 kcal is short on Mg and Ca (15 §4.9 reading of the table)', () => {
    const s = evalFor(WOMAN, { e: 1650 });
    expect(flag(s, 'mg')).toBe(FLAG_AMBER); // 254/265 = 0.96
    expect(flag(s, 'ca')).toBe(FLAG_AMBER); // 733/800 = 0.92
  });

  it('flags never improve as energy falls (monotone in E)', () => {
    let prevScore = 101;
    for (const e of [3000, 2500, 2000, 1500, 1200, 800, 400, 0]) {
      const sc = evalFor(WOMAN, { e }).microScore;
      expect(sc).toBeLessThanOrEqual(prevScore);
      prevScore = sc;
    }
    expect(evalFor(WOMAN, { e: 0 }).nRed).toBeGreaterThanOrEqual(12);
  });

  it('score is 100 − 6·#RED − 3·#AMBER, clamped to [0, 100], for every energy level', () => {
    for (const e of [0, 500, 1000, 1500, 2000, 3500]) {
      const s = evalFor(WOMAN, { e });
      expect(s.microScore).toBe(Math.max(0, 100 - 6 * s.nRed - 3 * s.nAmber));
      let red = 0;
      let amber = 0;
      for (let i = 0; i < N_FLAGS; i++) {
        if (s.flags[i] === FLAG_RED) red++;
        else if (s.flags[i] === FLAG_AMBER) amber++;
      }
      expect([red, amber]).toEqual([s.nRed, s.nAmber]);
    }
  });
});

describe('15 §4.9 pattern modifiers', () => {
  it('carbohydrate < 100 g/d at quality 1-2: C ×0.6, Mg ×0.8, Ca ×0.9 turn AMBER at 1 800 kcal', () => {
    const lc = evalFor(WOMAN, { e: 1800, carb: 50 });
    const mixed = evalFor(WOMAN, { e: 1800, carb: 200 });
    expect(flag(lc, 'vitC')).toBe(FLAG_AMBER); // 50·0.6·1.8 = 54 / 60 = 0.90
    expect(flag(lc, 'mg')).toBe(FLAG_AMBER); // 154·0.8·1.8 = 221.8 / 265 = 0.84
    expect(flag(lc, 'ca')).toBe(FLAG_AMBER); // 444·0.9·1.8 = 719 / 800 = 0.90
    expect(flag(mixed, 'vitC')).toBe(FLAG_GREEN);
    expect(lc.caPatternMg / mixed.caPatternMg).toBeCloseTo(0.9, 12);
  });

  it('the low-carbohydrate trigger is also < 25 % of energy', () => {
    const s = evalFor(WOMAN, { e: 2400, carb: 120 }); // 4·120/2400 = 20 % → pattern applies although c ≥ 100 g
    expect(s.caPatternMg).toBeCloseTo(444 * 0.9 * 2.4, 6);
  });

  it('food quality 3 removes the carbohydrate pattern and lifts Mg/Ca/E/D (15 §4.9 QMULT)', () => {
    const s = evalFor(WOMAN, { e: 1800, carb: 50, quality: 3 });
    expect(s.caPatternMg).toBeCloseTo(444 * 1.2 * 1.8, 6); // ×1.2, no ×0.9
    expect(flag(s, 'vitC')).toBe(FLAG_GREEN); // 50·1.35·1.8 = 121.5
    expect(flag(s, 'vitE')).toBe(FLAG_YELLOW); // 4.7·1.5·1.8 = 12.7 / 12 = 1.06 (AMBER at quality 2)
  });

  it('quality 1 (refined) scales Mg, A, C, folate, K by 0.8 but leaves Ca, Zn, thiamin, iron unchanged', () => {
    const q1 = evalFor(WOMAN, { quality: 1 });
    const q2 = evalFor(WOMAN, { quality: 2 });
    expect(q1.caPatternMg).toBeCloseTo(q2.caPatternMg, 9);
    expect(flag(q1, 'mg')).toBe(FLAG_AMBER); // 154·0.8·2 = 246 / 265 = 0.93
    expect(flag(q1, 'vitA')).toBe(FLAG_YELLOW); // 563/500 = 1.13
  });

  it('vegan: B12 ×0.1 RED, Ca ×0.75 AMBER, D ×0.8, iodine AMBER, iron EAR ×1.8 with the iron_risk escalation (stated menstruation)', () => {
    const vegan: PersonProfile = { ...WOMAN, habits: { dietAnimalLevel: 'vegan' }, cycle: { tracking: false, menstruating: 'yes' } };
    const s = evalFor(vegan);
    expect(flag(s, 'b12')).toBe(FLAG_RED); // 2.6·0.1·2 = 0.52 / 2
    expect(flag(s, 'ca')).toBe(FLAG_AMBER); // 666 / 800 = 0.83
    expect(flag(s, 'zn')).toBe(FLAG_YELLOW); // 5.3·0.8·2 = 8.5 / 6.8 = 1.25
    expect(flag(s, 'vitD')).toBe(FLAG_RED);
    expect(s.flags[FLAG_IODINE]).toBe(FLAG_AMBER);
    expect(flag(s, 'iron')).toBe(FLAG_AMBER); // R = 15.4/(8.1·1.8) = 1.06 YELLOW, escalated by iron_risk (menstruating, vegan)
    expect(s.microScore).toBe(100 - 6 * s.nRed - 3 * s.nAmber);
  });

  it('D8-08: menstruation is never inferred from female sex or age — an unstated status does not escalate iron', () => {
    const vegan: PersonProfile = { ...WOMAN, habits: { dietAnimalLevel: 'vegan' } };
    expect(makeHarness(vegan, { noBurnIn: true }).k.menstruating).toBe(-1);
    expect(flag(evalFor(vegan), 'iron')).toBe(FLAG_YELLOW); // R = 1.06, no menstrual-loss escalation without a stated status
  });

  it('vegetarian: B12 ×0.5 (2.6 µg at 2 000 kcal is still 1.3 EAR) and Zn ×0.85 (1.32 EAR)', () => {
    const veg: PersonProfile = { ...WOMAN, habits: { dietAnimalLevel: 'vegetarian' } };
    const s = evalFor(veg);
    expect(flag(s, 'b12')).toBe(FLAG_GREEN); // 2.6·0.5·2 = 2.6 / 2 = 1.3
    expect(flag(s, 'zn')).toBe(FLAG_GREEN); // 5.3·0.85·2 = 9.0 / 6.8 = 1.32
    expect(flag(evalFor(veg, { e: 1800 }), 'zn')).toBe(FLAG_YELLOW); // 8.1 / 6.8 = 1.19
  });

  it('D8-08: a multivitamin of unknown composition grants no fictitious calcium, iodine, iron, B12 or vitamin D credit', () => {
    const plain = evalFor({ ...WOMAN, habits: { dietAnimalLevel: 'vegan' } });
    const mvm = evalFor({ ...WOMAN, habits: { dietAnimalLevel: 'vegan', multivitamin: true } });
    expect(Array.from(mvm.flags)).toEqual(Array.from(plain.flags));
    expect(flag(mvm, 'b12')).toBe(FLAG_RED);
    expect(flag(mvm, 'vitD')).toBe(FLAG_RED);
    expect(mvm.flags[FLAG_IODINE]).toBe(FLAG_AMBER); // vegan pattern prompt stands: no known iodine dose
    expect(mvm.caPatternMg).toBeCloseTo(444 * 0.75 * 2, 6); // no 0.4·1.2·EAR mineral credit
    expect(mvm.microScore).toBe(plain.microScore);
  });
});

describe('15 §4.9 sex, menopause and add-on flags', () => {
  it('non-menstruating women (post-menopause or a stated "no") use the men\'s iron EAR (RDA 8 mg): the menstruating amber disappears', () => {
    const menstruating: PersonProfile = { ...WOMAN, cycle: { tracking: false, menstruating: 'yes' } };
    const pre = evalFor(menstruating, { e: 1200 });
    const post = evalFor({ ...WOMAN, menopause: 'post' }, { e: 1200 });
    const statedNo = evalFor({ ...WOMAN, cycle: { tracking: false, menstruating: 'no' } }, { e: 1200 });
    expect(flag(pre, 'iron')).toBe(FLAG_AMBER); // 7.7·1.2 = 9.2 / 8.1 = 1.14 YELLOW → escalated: menstruating, E < 1500
    expect(flag(post, 'iron')).toBe(FLAG_GREEN); // 9.2 / 6 = 1.54
    expect(flag(statedNo, 'iron')).toBe(FLAG_GREEN);
    expect(flag(evalFor(WOMAN, { e: 1200 }), 'iron')).toBe(FLAG_YELLOW); // unstated: age-group EAR, no escalation
  });

  it('iron_risk (stated menstruation): AMBER, RED with endurance training ≥ 5 h/wk; a multivitamin does not lift it', () => {
    const w: PersonProfile = { ...WOMAN, cycle: { tracking: false, menstruating: 'yes' } };
    const a = evalFor(w, { e: 1400, endHrEma: 0 });
    const b = evalFor(w, { e: 1400, endHrEma: 1 }); // 7 h/wk
    expect(flag(a, 'iron')).toBe(FLAG_AMBER);
    expect(flag(b, 'iron')).toBe(FLAG_RED);
    expect(flag(evalFor({ ...w, habits: { multivitamin: true } }, { e: 1400 }), 'iron')).toBe(FLAG_AMBER);
  });

  it('fibre: AMBER below 14 g/1000 kcal, YELLOW below 25 g/d, else GREEN', () => {
    expect(evalFor(WOMAN, { e: 2000, fibre: 24 }).flags[FLAG_FIBRE]).toBe(FLAG_AMBER);
    expect(evalFor(WOMAN, { e: 1500, fibre: 21 }).flags[FLAG_FIBRE]).toBe(FLAG_YELLOW);
    expect(evalFor(WOMAN, { e: 2000, fibre: 30 }).flags[FLAG_FIBRE]).toBe(FLAG_GREEN);
  });

  it('EFA: AMBER below 20 g fat/d, RED after > 28 days below 15 g/d', () => {
    expect(evalFor(WOMAN, { fat: 18 }).flags[FLAG_EFA]).toBe(FLAG_AMBER);
    expect(evalFor(WOMAN, { fat: 10, efaLowDays: 29 }).flags[FLAG_EFA]).toBe(FLAG_RED);
    expect(evalFor(WOMAN, { fat: 10, efaLowDays: 10 }).flags[FLAG_EFA]).toBe(FLAG_AMBER);
    expect(evalFor(WOMAN, { fat: 60 }).flags[FLAG_EFA]).toBe(FLAG_GREEN);
  });

  it('FAT_SOL_ABSORPTION: RED when most meals carry < 5 g fat', () => {
    expect(evalFor(WOMAN, { lowFatMeals: 0.6 }).flags[FLAG_FAT_SOL]).toBe(FLAG_RED);
    expect(evalFor(WOMAN, { lowFatMeals: 0.3 }).flags[FLAG_FAT_SOL]).toBe(FLAG_GREEN);
  });
});

describe('15 V17 (A TO Z, Gardner 2010): the rule engine flags ≥ 60 % of the reported new inadequacies at quality 2', () => {
  it('Atkins / LEARN / Ornish (women): amber or red for the reported nutrients', () => {
    // [energy, carbohydrate g, nutrients that moved into inadequacy]
    const arms: [number, number, (keyof typeof MICRO_IDX)[]][] = [
      [1373, (0.17 * 1373) / 4, ['thiamin', 'folate', 'vitC', 'iron', 'mg']], // Atkins
      [1478, (0.49 * 1478) / 4, ['vitE', 'thiamin', 'mg']], // LEARN
      [1412, (0.63 * 1412) / 4, ['vitE', 'b12', 'zn']], // Ornish
    ];
    let hit = 0;
    let total = 0;
    for (const [e, carb, nutrients] of arms) {
      const s = evalFor(WOMAN, { e, carb, quality: 2 });
      for (const n of nutrients) {
        total++;
        if (flag(s, n) >= FLAG_AMBER) hit++;
      }
    }
    expect(total).toBe(11);
    expect(hit / total).toBeGreaterThanOrEqual(0.6); // measured 7/11 = 0.64 (iron, LEARN thiamin, Ornish B12/Zn are food-pattern effects the density rule cannot see)
  });
});

// ------------------------------------------------------------------------------------------------ D8-08 known exposure

/** Run `n` days with a realised coverage map and the given known calcium (and other) ledger entries. */
function runLogged(h: Harness, n: number, exposure: Record<string, DayExposureSummary> | undefined, coverage: ChannelCoverageMap | undefined): void {
  if (coverage) h.day.coverage = coverage;
  else delete h.day.coverage;
  if (exposure) h.day.exposure = exposure;
  else delete h.day.exposure;
  h.run({}, n);
}
const ca = (knownSum: number, coverage: DayExposureSummary['coverage'] = 'complete'): Record<string, DayExposureSummary> => ({ calcium: { knownSum, unit: 'mg', coverage } });
const LOGGED: ChannelCoverageMap = { energy: 'complete', exercise: 'complete', micronutrients: 'complete' };
const summary = (h: Harness, id: keyof typeof TRACKED_IDX): KnownNutrientSummary =>
  summariseKnownNutrient(h.s.nutKnownRing, h.s.nutCovRing, TRACKED_IDX[id], h.s.nutIdx, h.s.nutDays, h.k.nutWindow);

describe('D8-08 known nutrient exposure from the shared ledger', () => {
  it('same energy and macros with different known food nutrients yield different known intake; the pattern prior is unchanged', () => {
    const a = makeHarness(WOMAN);
    const b = makeHarness(WOMAN);
    runLogged(a, 5, ca(600), LOGGED);
    runLogged(b, 5, ca(1100), LOGGED);
    expect(a.s.caKnownMeanMg).toBeCloseTo(600, 9);
    expect(b.s.caKnownMeanMg).toBeCloseTo(1100, 9);
    expect(a.s.caCompleteDays).toBe(5);
    expect(a.s.caPatternMg).toBeCloseTo(b.s.caPatternMg, 9); // the density estimate itself never sees actual grams
    // …but it never overrides them: the calcium prompt follows the known amount (600 / 800 EAR AMBER, 1100 GREEN)
    expect(a.s.flags[MICRO_IDX.ca]).toBe(FLAG_AMBER);
    expect(b.s.flags[MICRO_IDX.ca]).toBe(FLAG_GREEN);
    expect(a.s.microScore).toBeLessThan(b.s.microScore);
  });

  it('total intake = food + supplement actives of the same identity, converted by mass to the canonical unit', () => {
    const h = makeHarness(WOMAN);
    runLogged(h, 3, {
      calcium: { knownSum: 700, unit: 'mg', coverage: 'complete' },
      'active:calcium': { knownSum: 500, unit: 'mg', coverage: 'complete' },
      vitD: { knownSum: 4, unit: 'ug', coverage: 'complete' },
      'active:vitD': { knownSum: 0.025, unit: 'mg', coverage: 'complete' }, // 25 µg (1 000 IU) as the compiler writes it, in mg
    }, LOGGED);
    expect(h.s.caKnownMeanMg).toBeCloseTo(1200, 9);
    expect(summary(h, 'vitD').meanComplete).toBeCloseTo(29, 9);
    // a supplement known while food is unanalysed is a lower bound, never complete intake
    const s = makeHarness(WOMAN);
    runLogged(s, 2, { 'active:iron': { knownSum: 18, unit: 'mg', coverage: 'complete' } }, LOGGED);
    expect(summary(s, 'iron')).toMatchObject({ completeDays: 0, partialDays: 2, lowerBoundMean: 18 });
    // an active in a non-mass basis is an unknown contribution: it neither credits nor completes the day
    const m = makeHarness(WOMAN);
    runLogged(m, 2, { calcium: { knownSum: 800, unit: 'mg', coverage: 'complete' }, 'active:calcium': { knownSum: 3, unit: 'mmol', coverage: 'complete' } }, LOGGED);
    expect(summary(m, 'calcium')).toMatchObject({ completeDays: 0, partialDays: 2, lowerBoundMean: 800 });
    // an explicit known zero from both sources stays a known zero
    const z = makeHarness(WOMAN);
    runLogged(z, 1, { calcium: { knownSum: 0, unit: 'mg', coverage: 'confirmedZero' }, 'active:calcium': { knownSum: 0, unit: 'mg', coverage: 'confirmedZero' } }, LOGGED);
    expect(summary(z, 'calcium')).toMatchObject({ completeDays: 1, meanComplete: 0 });
    // a planned supplement without planned food amounts is not planned total intake
    const p = makeHarness(WOMAN);
    runLogged(p, 2, { 'active:calcium': { knownSum: 500, unit: 'mg', coverage: 'complete' } }, undefined);
    expect(summary(p, 'calcium')).toMatchObject({ plannedDays: 0, plannedMean: null });
  });

  it('pattern priors never override known logged amounts: iron risk and the vegan iodine prompt yield to known intake', () => {
    const veganWoman: PersonProfile = { ...WOMAN, habits: { dietAnimalLevel: 'vegan' }, cycle: { tracking: false, menstruating: 'yes' } };
    const pattern = makeHarness(veganWoman);
    runLogged(pattern, 5, {}, LOGGED); // nothing analysed: the pattern prompts stand
    expect(pattern.s.flags[MICRO_IDX.iron]).toBeGreaterThanOrEqual(FLAG_AMBER);
    expect(pattern.s.flags[FLAG_IODINE]).toBe(FLAG_AMBER);
    const known = makeHarness(veganWoman);
    runLogged(known, 5, { iron: { knownSum: 30, unit: 'mg', coverage: 'complete' }, iodine: { knownSum: 160, unit: 'ug', coverage: 'complete' } }, LOGGED);
    expect(known.s.flags[MICRO_IDX.iron]).toBe(FLAG_GREEN); // 30 mg vs the vegetarian-adjusted EAR 8.1 × 1.8 = 14.6 mg
    expect(known.s.flags[FLAG_IODINE]).toBe(FLAG_GREEN); // 160 µg vs EAR 95 µg
    const partial = makeHarness(veganWoman);
    runLogged(partial, 5, { iodine: { knownSum: 160, unit: 'ug', coverage: 'partial' } }, { ...LOGGED, micronutrients: 'partial' });
    expect(partial.s.flags[FLAG_IODINE]).toBe(FLAG_AMBER); // a partial lower bound does not clear the prompt
  });

  it('a missing nutrient is unknown, not zero; a confirmed zero stays a known zero', () => {
    const h = makeHarness(WOMAN);
    runLogged(h, 3, {}, LOGGED); // logged day, calcium not analysed
    const s0 = summary(h, 'calcium');
    expect(s0.completeDays).toBe(0);
    expect(s0.meanComplete).toBeNull();
    expect(interpretNutrientIntake(s0, driReferences('calcium', { sex: 'female', ageYears: 30, menstruating: 'unknown' })).position).toBe('unknown');
    const z = makeHarness(WOMAN);
    runLogged(z, 2, ca(0, 'confirmedZero'), LOGGED);
    expect(summary(z, 'calcium').meanComplete).toBe(0);
    expect(summary(z, 'calcium').completeDays).toBe(2);
  });

  it('planned days are scenario inputs, never observed intake; burn-in days are not counted', () => {
    const h = makeHarness(WOMAN);
    expect(h.s.nutDays).toBe(0); // 14 burn-in days pushed nothing
    runLogged(h, 4, ca(1000), undefined); // prescription (no realised coverage map)
    const sm = summary(h, 'calcium');
    expect(sm.completeDays).toBe(0);
    expect(sm.plannedDays).toBe(4);
    expect(sm.plannedMean).toBe(1000);
    expect(h.s.caCompleteDays).toBe(0);
  });

  it('a partial record is a lower bound: it can prove a UL exceeded, never clear it, and never scores 100 % coverage', () => {
    const refs = driReferences('calcium', { sex: 'female', ageYears: 30, menstruating: 'unknown' });
    const lo = makeHarness(WOMAN);
    runLogged(lo, 6, ca(900, 'partial'), { ...LOGGED, energy: 'partial' });
    const sLo = summary(lo, 'calcium');
    expect(sLo.partialDays).toBe(6);
    expect(sLo.coverageFraction).toBe(0);
    const iLo = interpretNutrientIntake(sLo, refs);
    expect(iLo.position).toBe('partialLowerBound');
    expect(iLo.ul).toBe('unchecked');
    const hi = makeHarness(WOMAN);
    runLogged(hi, 3, ca(2700, 'partial'), { ...LOGGED, energy: 'partial' });
    expect(interpretNutrientIntake(summary(hi, 'calcium'), refs).ul).toBe('aboveUl');
    const mixed = makeHarness(WOMAN);
    runLogged(mixed, 3, ca(1000), LOGGED);
    runLogged(mixed, 1, ca(300, 'partial'), { ...LOGGED, energy: 'partial' });
    expect(summary(mixed, 'calcium').coverageFraction).toBeLessThan(1);
  });

  it('the observed mean is positioned against EAR/RDA without a probability or deficiency verdict', () => {
    const refs = driReferences('calcium', { sex: 'female', ageYears: 30, menstruating: 'unknown' });
    const at = (x: number) => interpretNutrientIntake({ windowDays: 7, completeDays: 7, partialDays: 0, plannedDays: 0, meanComplete: x, lowerBoundMean: x, plannedMean: null, coverageFraction: 1 }, refs);
    expect(at(700).position).toBe('belowEar');
    expect(at(900).position).toBe('betweenEarAndRda');
    expect(at(1100).position).toBe('atOrAboveRda');
    expect(at(2600).ul).toBe('aboveUl');
    for (const x of [700, 900, 1100]) expect(JSON.stringify(at(x))).not.toMatch(/probab|deficien|risk/i);
  });

  it('below an AI is "adequacy undetermined", never an EAR-type inadequacy probability', () => {
    const refs = driReferences('ala', { sex: 'female', ageYears: 30, menstruating: 'unknown' });
    expect(refs.ai?.value).toBe(1.1);
    expect(refs.ear).toBeUndefined();
    const r = interpretNutrientIntake({ windowDays: 7, completeDays: 7, partialDays: 0, plannedDays: 0, meanComplete: 0.8, lowerBoundMean: 0.8, plannedMean: null, coverageFraction: 1 }, refs);
    expect(r.position).toBe('belowAiUndetermined');
    expect(r.reasonCode).toBe('belowAiAdequacyUndetermined');
    expect(Object.keys(r).some((k) => /prob/i.test(k))).toBe(false);
  });
});

describe('D8-08 essential fatty acids: known ALA/LA intake, not total fat, when available', () => {
  const efa = (ala: number | null, la: number | null): number => {
    const h = makeHarness(WOMAN);
    const exposure: Record<string, DayExposureSummary> = {};
    if (ala !== null) exposure.ala = { knownSum: ala, unit: 'g', coverage: 'complete' };
    if (la !== null) exposure.linoleic = { knownSum: la, unit: 'g', coverage: 'complete' };
    runLogged(h, 32, exposure, LOGGED);
    // a very low-fat month (fat < 15 g/d for > 28 days): the legacy proxy alone would say RED
    h.s.fatEma7 = 10;
    h.s.efaLowDays = 31;
    evaluateMicro(h.k, h.s);
    return h.s.flags[FLAG_EFA]!;
  };
  it('below the AI the adequacy is undetermined (YELLOW at most); at or above both AIs no prompt; unknown keeps the pattern prompt', () => {
    expect(efa(0.5, 5)).toBe(FLAG_YELLOW);
    expect(efa(1.5, 13)).toBe(FLAG_GREEN);
    expect(efa(null, null)).toBe(FLAG_RED);
    expect(efa(1.5, null)).toBe(FLAG_RED); // one of the two unknown: no known-EFA statement
  });
});

describe('D8-08 DRI references: type, life stage, unit, form and scope', () => {
  const W = (ageYears: number, menstruating: 'yes' | 'no' | 'unknown' = 'unknown') => ({ sex: 'female' as const, ageYears, menstruating });
  it('calcium by life stage (NASEM 2011): women 51-70 EAR 1000 / RDA 1200 / UL 2000; men 51-70 RDA 1000', () => {
    const w = driReferences('calcium', W(55));
    expect([w.ear?.value, w.rda?.value, w.ul?.value, w.ul?.scope, w.ul?.unit]).toEqual([1000, 1200, 2000, 'totalIntake', 'mg']);
    expect(driReferences('calcium', { sex: 'male', ageYears: 55, menstruating: 'no' }).rda?.value).toBe(1000);
    expect(driReferences('calcium', W(30)).ul?.value).toBe(2500);
  });

  it('supplement-form scopes: Mg UL supplemental only, folate UL synthetic folic acid, vitamin A UL preformed retinol', () => {
    expect(driReferences('magnesium', W(40)).ul).toMatchObject({ value: 350, scope: 'supplementalOnly' });
    expect(driReferences('folateDfe', W(40)).ul).toMatchObject({ value: 1000, scope: 'syntheticFolicAcid' });
    expect(driReferences('vitARae', W(40)).ul).toMatchObject({ value: 3000, scope: 'preformedRetinol' });
    // a total-intake ledger amount cannot be judged against a supplemental-only UL
    const r = interpretNutrientIntake({ windowDays: 7, completeDays: 7, partialDays: 0, plannedDays: 0, meanComplete: 500, lowerBoundMean: 500, plannedMean: null, coverageFraction: 1 }, driReferences('magnesium', W(40)));
    expect(r.ul).toBe('scopeMismatch');
  });

  it('iron references follow STATED menstrual status only; unknown status leaves applicability unresolved', () => {
    expect(driReferences('iron', W(30)).applicability).toBe('unresolved');
    expect(driReferences('iron', W(30)).reasonCode).toBe('menstrualStatusUnknown');
    const yes = driReferences('iron', W(30, 'yes'));
    expect([yes.ear?.value, yes.rda?.value, yes.applicability]).toEqual([8.1, 18, 'applicable']);
    const noYoung = driReferences('iron', W(35, 'no'));
    expect([noYoung.ear?.value, noYoung.applicability, noYoung.reasonCode]).toEqual([5, 'unresolved', 'statusOutsideAgeBand']);
    const post = driReferences('iron', W(60, 'no'));
    expect([post.ear?.value, post.rda?.value, post.applicability]).toEqual([5, 8, 'applicable']);
    expect(driReferences('calcium', { sex: 'unspecified', ageYears: 40, menstruating: 'unknown' }).applicability).toBe('unresolved');
    expect(driReferences('calcium', W(17)).applicability).toBe('unresolved');
  });
});

describe('D8-08 legacy micronutrientScore objective', () => {
  it('is not an optimisable goal (fabricated precision); the score stays a display heuristic', () => {
    expect(GOAL_CAPABILITY.micronutrientScore.availability).toBe('unavailable');
    expect(isProductionGoalEligible('micronutrientScore')).toBe(false);
  });
});
