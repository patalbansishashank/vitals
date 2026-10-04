// @vitest-environment node
/** 15 §4.9 rule table: worked numbers for the density projection, flags, patterns and the score. */
import { evaluateMicro, FLAG_AMBER, FLAG_GREEN, FLAG_RED, FLAG_YELLOW, MICRO_IDX, N_FLAGS } from '../index';
import { FLAG_EFA, FLAG_FAT_SOL, FLAG_FIBRE, FLAG_IODINE } from '../microTables';
import type { PersonProfile } from '../../../types/profile';
import { WOMAN, MAN, makeHarness } from './harness';

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
    expect(s.caIntakeMg).toBeCloseTo(888, 6);
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
    const a = evalFor(WOMAN, { e: 2000 }).caIntakeMg;
    const b = evalFor(WOMAN, { e: 1000 }).caIntakeMg;
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
    expect(lc.caIntakeMg / mixed.caIntakeMg).toBeCloseTo(0.9, 12);
  });

  it('the low-carbohydrate trigger is also < 25 % of energy', () => {
    const s = evalFor(WOMAN, { e: 2400, carb: 120 }); // 4·120/2400 = 20 % → pattern applies although c ≥ 100 g
    expect(s.caIntakeMg).toBeCloseTo(444 * 0.9 * 2.4, 6);
  });

  it('food quality 3 removes the carbohydrate pattern and lifts Mg/Ca/E/D (15 §4.9 QMULT)', () => {
    const s = evalFor(WOMAN, { e: 1800, carb: 50, quality: 3 });
    expect(s.caIntakeMg).toBeCloseTo(444 * 1.2 * 1.8, 6); // ×1.2, no ×0.9
    expect(flag(s, 'vitC')).toBe(FLAG_GREEN); // 50·1.35·1.8 = 121.5
    expect(flag(s, 'vitE')).toBe(FLAG_YELLOW); // 4.7·1.5·1.8 = 12.7 / 12 = 1.06 (AMBER at quality 2)
  });

  it('quality 1 (refined) scales Mg, A, C, folate, K by 0.8 but leaves Ca, Zn, thiamin, iron unchanged', () => {
    const q1 = evalFor(WOMAN, { quality: 1 });
    const q2 = evalFor(WOMAN, { quality: 2 });
    expect(q1.caIntakeMg).toBeCloseTo(q2.caIntakeMg, 9);
    expect(flag(q1, 'mg')).toBe(FLAG_AMBER); // 154·0.8·2 = 246 / 265 = 0.93
    expect(flag(q1, 'vitA')).toBe(FLAG_YELLOW); // 563/500 = 1.13
  });

  it('vegan: B12 ×0.1 RED, Ca ×0.75 AMBER, D ×0.8, iodine AMBER, iron EAR ×1.8 with the iron_risk escalation', () => {
    const vegan: PersonProfile = { ...WOMAN, habits: { dietAnimalLevel: 'vegan' } };
    const s = evalFor(vegan);
    expect(flag(s, 'b12')).toBe(FLAG_RED); // 2.6·0.1·2 = 0.52 / 2
    expect(flag(s, 'ca')).toBe(FLAG_AMBER); // 666 / 800 = 0.83
    expect(flag(s, 'zn')).toBe(FLAG_YELLOW); // 5.3·0.8·2 = 8.5 / 6.8 = 1.25
    expect(flag(s, 'vitD')).toBe(FLAG_RED);
    expect(s.flags[FLAG_IODINE]).toBe(FLAG_AMBER);
    expect(flag(s, 'iron')).toBe(FLAG_AMBER); // R = 15.4/(8.1·1.8) = 1.06 YELLOW, escalated by iron_risk (menstruating, vegan, no supplement)
    expect(s.microScore).toBe(100 - 6 * s.nRed - 3 * s.nAmber);
  });

  it('vegetarian: B12 ×0.5 (2.6 µg at 2 000 kcal is still 1.3 EAR) and Zn ×0.85 (1.32 EAR)', () => {
    const veg: PersonProfile = { ...WOMAN, habits: { dietAnimalLevel: 'vegetarian' } };
    const s = evalFor(veg);
    expect(flag(s, 'b12')).toBe(FLAG_GREEN); // 2.6·0.5·2 = 2.6 / 2 = 1.3
    expect(flag(s, 'zn')).toBe(FLAG_GREEN); // 5.3·0.85·2 = 9.0 / 6.8 = 1.32
    expect(flag(evalFor(veg, { e: 1800 }), 'zn')).toBe(FLAG_YELLOW); // 8.1 / 6.8 = 1.19
  });

  it('multivitamin adds 100 % of the vitamin RDA (1.2 EAR) and 40 % of the Mg/Ca RDA: vegan D and B12 leave RED', () => {
    const vegan: PersonProfile = { ...WOMAN, habits: { dietAnimalLevel: 'vegan', multivitamin: true } };
    const s = evalFor(vegan);
    expect(flag(s, 'b12')).toBe(FLAG_GREEN); // 0.52 + 1.2·2 = 2.92 / 2
    expect(flag(s, 'vitD')).toBe(FLAG_GREEN); // 3.52 + 12 = 15.5 / 10
    expect(s.flags[FLAG_IODINE]).toBe(FLAG_GREEN);
    expect(s.caIntakeMg).toBeCloseTo(444 * 0.75 * 2 + 0.4 * 1.2 * 800, 6);
    expect(s.microScore).toBeGreaterThan(evalFor({ ...WOMAN, habits: { dietAnimalLevel: 'vegan' } }).microScore);
  });
});

describe('15 §4.9 sex, menopause and add-on flags', () => {
  it('postmenopausal women use the men\'s iron EAR (RDA 8 mg): the premenopausal amber disappears', () => {
    const pre = evalFor(WOMAN, { e: 1200 });
    const post = evalFor({ ...WOMAN, menopause: 'post' }, { e: 1200 });
    expect(flag(pre, 'iron')).toBe(FLAG_AMBER); // 7.7·1.2 = 9.2 / 8.1 = 1.14 YELLOW → escalated: menstruating, E < 1500, no supplement
    expect(flag(post, 'iron')).toBe(FLAG_GREEN); // 9.2 / 6 = 1.54
  });

  it('iron_risk: AMBER, RED with endurance training ≥ 5 h/wk', () => {
    const a = evalFor(WOMAN, { e: 1400, endHrEma: 0 });
    const b = evalFor(WOMAN, { e: 1400, endHrEma: 1 }); // 7 h/wk
    expect(flag(a, 'iron')).toBe(FLAG_AMBER);
    expect(flag(b, 'iron')).toBe(FLAG_RED);
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
