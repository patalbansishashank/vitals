/** Equivalence credit: R3 worked examples, owner's daily-score example, properties, meals, unknown-item resolution. */
import { describe, expect, it } from 'vitest';
import {
  createCatalogue,
  createFoodTable,
  draftToRecord,
  intentFor,
  mealTotals,
  nutrientEquivalence,
  resolveUnknown,
  resolveUnknownEquipment,
  resolveUnknownSync,
  sessionEquivalence,
  stimulusEquivalence,
  validateDraft,
  validateExercise,
  vectorOf,
  type ExerciseDraft,
  type ExerciseResolver,
  type PerformedExercise,
} from '@/catalogues';
import { FOOD_FIXTURE, SEED_CATALOGUE as C, SEED_EXERCISES, SEED_INPUT } from '@/content/catalogues';
import { leak } from '@/content/evidence/__tests__/leakScan';
import { CTX, lcg } from './helpers';

const DB_BENCH: PerformedExercise = { exerciseId: 'db_bench_press', setCount: 3, reps: 10, rir: 2 };

describe('R3 §5.4 worked examples', () => {
  it('1: dand 3 × 25 for DB bench 3 × 10 with hypertrophy intent → full credit (S ≈ 0.92)', () => {
    const r = sessionEquivalence([DB_BENCH], [{ exerciseId: 'dand', setCount: 3, reps: 25, rir: 2 }], C, CTX, intentFor('muscle'));
    expect(r.score).toBeCloseTo(0.92, 1);
    expect(r.perTerm.find((t) => t.term === 'str')!.ratio).toBeCloseTo(0.8 * (0.65 / 0.85), 6);
    expect(r.perTerm.find((t) => t.term === 'kcal')!.ratio).toBe(1);
    expect(r).toMatchObject({ band: 'full', parity: true, credit: 1, shortfall: [] });
  });

  it('2: 20 min mudgar for a 20 min treadmill run with VO2max intent → different stimulus (S ≈ 0.47)', () => {
    const r = sessionEquivalence([{ exerciseId: 'treadmill_run', minutes: 20 }], [{ exerciseId: 'mudgar_two_hand', minutes: 20 }], C, CTX, intentFor('vo2max'));
    expect(r.perTerm.find((t) => t.term === 'card')!.ratio).toBeCloseTo(1 / 3, 6);
    expect(r.perTerm.find((t) => t.term === 'kcal')!.ratio).toBeCloseTo(0.78, 2);
    expect(r.score).toBeCloseTo(0.47, 2);
    expect(r.band).toBe('different');
    expect(r.credit).toBeCloseTo(r.score, 12);
    expect(r.alsoTrained).toEqual(expect.arrayContaining(['shoulders', 'upperBack', 'core']));
    expect(r.shortfall[0]!.term).toBe('card');
  });

  it('3: baithak 3 × 50 at RIR 5 for back squat 3 × 8 at 75 % → partial, with the set and effort fixes', () => {
    const r = sessionEquivalence([{ exerciseId: 'bb_back_squat', setCount: 3, reps: 8, pct1RM: 75 }], [{ exerciseId: 'baithak', setCount: 3, reps: 50, rir: 5 }], C, CTX, intentFor('muscle'));
    expect(r.band).toBe('partial');
    expect(r.perTerm.find((t) => t.term === 'str')!.ratio).toBeCloseTo(0.61, 2);
    expect(r.shortfall[0]!.term).toBe('hyp');
    expect(r.shortfall[0]!.text).toMatch(/add \d+ sets?/);
    expect(r.shortfall[0]!.text).toMatch(/closer to failure/);
  });
});

describe('owner example: daily score by equivalence (SUITE_SPEC §3.7)', () => {
  // E5 computes 100·Σ w_i c_i / Σ w_i; the session credit is stimulusEquivalence(...).credit
  const dayScore = (items: Array<{ w: number; c: number }>): number => (100 * items.reduce((a, i) => a + i.w * i.c, 0)) / items.reduce((a, i) => a + i.w, 0);
  const prescribed: PerformedExercise[] = [DB_BENCH, { exerciseId: 'goblet_squat', setCount: 3, reps: 12, rir: 2 }];
  const others = [{ w: 0.3, c: 1 }, { w: 0.2, c: 1 }, { w: 0.3, c: 1 }];

  it('done in full → 100; skipped session (weight 0.2) → 80; a same-stimulus swap → 100', () => {
    const full = sessionEquivalence(prescribed, prescribed, C, CTX).credit;
    expect(full).toBe(1);
    expect(dayScore([...others, { w: 0.2, c: full }])).toBeCloseTo(100, 9);
    expect(dayScore([...others, { w: 0.2, c: 0 }])).toBeCloseTo(80, 9);
    const swap = sessionEquivalence(prescribed, [{ exerciseId: 'push_up', setCount: 3, reps: 12, rir: 2 }, { exerciseId: 'sandbag_squat', setCount: 3, reps: 10, rir: 2 }], C, CTX);
    expect(swap.parity).toBe(true);
    expect(dayScore([...others, { w: 0.2, c: swap.credit }])).toBeCloseTo(100, 9);
  });

  it('a lighter session scores partially with a doable fix', () => {
    const r = sessionEquivalence([DB_BENCH], [{ ...DB_BENCH, setCount: 2 }], C, CTX, intentFor('muscle'));
    expect(r.band).toBe('partial');
    expect(r.shortfall[0]!.text).toBe('Chest work is short: add 1 set.');
  });
});

describe('properties of stimulusEquivalence', () => {
  const rand = lcg(7);
  const rt = SEED_EXERCISES.filter((e) => (e.defaultDose.sets ?? 0) > 0 && e.defaultDose.reps !== undefined && e.loadType !== 'mobility');
  const intents = [intentFor('muscle'), intentFor('strength'), intentFor('fatLoss'), intentFor('vo2max')];

  it('identity → 1; score and credit in [0, 1]; over-delivery capped; fewer sets never score higher', () => {
    for (let i = 0; i < 60; i++) {
      const a = rt[Math.floor(rand() * rt.length)]!;
      const b = rt[Math.floor(rand() * rt.length)]!;
      const alpha = intents[i % intents.length]!;
      const n = 2 + Math.floor(rand() * 3);
      const pre = vectorOf([{ exerciseId: a.id, setCount: n }], C, CTX);
      expect(stimulusEquivalence(pre, pre, alpha).score).toBeCloseTo(1, 12);
      const doubled = vectorOf([{ exerciseId: a.id, setCount: 2 * n }], C, CTX);
      expect(stimulusEquivalence(pre, doubled, alpha).score).toBeCloseTo(1, 12);
      const r = stimulusEquivalence(pre, vectorOf([{ exerciseId: b.id, setCount: n }], C, CTX), alpha);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
      expect(r.credit).toBeGreaterThanOrEqual(r.score);
      const fewer = stimulusEquivalence(pre, vectorOf([{ exerciseId: b.id, setCount: n - 1 }], C, CTX), alpha);
      expect(fewer.score).toBeLessThanOrEqual(r.score + 1e-12);
    }
  });

  it('nothing is ever rejected: an unrelated log still gets credit for what it trains', () => {
    const r = sessionEquivalence([DB_BENCH], [{ exerciseId: 'brisk_walk', minutes: 30 }], C, CTX, intentFor('fatLoss'));
    expect(r.band).toBe('different');
    expect(r.credit).toBeGreaterThan(0);
  });

  it('shortfall copy is plain language (no internal references, never "speculative")', () => {
    for (let i = 0; i < 40; i++) {
      const a = SEED_EXERCISES[Math.floor(rand() * SEED_EXERCISES.length)]!;
      const b = SEED_EXERCISES[Math.floor(rand() * SEED_EXERCISES.length)]!;
      const r = sessionEquivalence([{ exerciseId: a.id }], [{ exerciseId: b.id }], C, CTX);
      for (const s of r.shortfall) {
        expect(leak(s.text), s.text).toBeNull();
        expect(s.text).not.toMatch(/speculative/i);
        expect(s.text).toMatch(/\.$/);
      }
    }
  });
});

describe('nutrientEquivalence (meals vs targets)', () => {
  const table = createFoodTable(FOOD_FIXTURE, 'fixture');
  const dalRice = mealTotals([{ foodId: 'lentils_cooked', grams: 200 }, { foodId: 'rice_white_cooked', grams: 150 }, { foodId: 'ghee', grams: 5 }], table);
  const targets = { energyKcal: dalRice.energyKcal, proteinG: dalRice.proteinG, netCarbG: dalRice.netCarbG, fatG: dalRice.fatG, fibreG: dalRice.fibreG };

  it('a different dish with the same nutrients fulfils the meal', () => {
    const choleRice = mealTotals([{ foodId: 'chickpeas_cooked', grams: 200 }, { foodId: 'rice_white_cooked', grams: 150 }], table);
    const r = nutrientEquivalence(targets, choleRice);
    expect(r.parity).toBe(true);
    expect(r.credit).toBe(1);
  });

  it('protein short by 18 g → partial with a plain fix; overshooting protein scores 1', () => {
    const short = nutrientEquivalence({ ...targets, proteinG: dalRice.proteinG + 18 }, dalRice);
    expect(short.perNutrient.find((p) => p.nutrient === 'proteinG')!.score).toBeLessThan(1);
    expect(short.shortfall[0]!.text).toBe('Protein short by 18 g.');
    const over = nutrientEquivalence({ proteinG: 20 }, { ...dalRice, proteinG: 40 });
    expect(over.score).toBe(1);
  });

  it('energy within ±5 % or ±75 kcal is full; the low-carb ceiling is target + 5 g', () => {
    expect(nutrientEquivalence({ energyKcal: 600 }, { ...dalRice, energyKcal: 670 }).score).toBe(1);
    expect(nutrientEquivalence({ energyKcal: 600 }, { ...dalRice, energyKcal: 700 }).score).toBeLessThan(1);
    expect(nutrientEquivalence({ netCarbG: 20, lowCarbDay: true }, { ...dalRice, netCarbG: 24 }).score).toBe(1);
    const over = nutrientEquivalence({ netCarbG: 20, lowCarbDay: true }, { ...dalRice, netCarbG: 40 });
    expect(over.score).toBeLessThan(1);
    expect(over.shortfall[0]!.text).toMatch(/low-carb ceiling by 15 g/);
  });

  it('score is in [0, 1] and monotone in the distance from target', () => {
    let prev = 1;
    for (const p of [30, 25, 20, 15, 10, 5, 0]) {
      const s = nutrientEquivalence({ proteinG: 30 }, { ...dalRice, proteinG: p }).score;
      expect(s).toBeLessThanOrEqual(prev + 1e-12);
      expect(s).toBeGreaterThanOrEqual(0);
      prev = s;
    }
  });
});

describe('unknown exercises and the user catalogue', () => {
  it('exact names and aliases resolve to the catalogue', () => {
    const d = resolveUnknownSync('bethak', undefined, C);
    expect(d).toMatchObject({ resolvedBy: 'catalogue', basedOn: 'baithak', confidence: 1 });
  });

  it('free text resolves by mechanism: "wooden wheel curls" → elbow flexion with an odd object', () => {
    const d = resolveUnknownSync('wooden wheel curls', 'curls holding a cart wheel', C);
    expect(d.resolvedBy).toBe('heuristic');
    expect(d.pattern).toBe('elbowFlexion');
    expect(d.loadType).toBe('odd-object');
    expect(d.regions.arms).toBe(1);
    expect(validateDraft(d)).toEqual([]);
    expect(resolveUnknownSync('rowing machine intervals', undefined, C)).toMatchObject({ pattern: 'row', loadType: 'cardio' });
    expect(resolveUnknownSync('morning jog in the park', undefined, C)).toMatchObject({ cardioModality: 'run' });
  });

  it('a pluggable resolver (the AI) is used when it returns a valid draft; failures fall back', async () => {
    const draft: ExerciseDraft = { ...resolveUnknownSync('gada swing', undefined, C), name: 'Mace 360 with a log', resolvedBy: 'heuristic', confidence: 0.8 };
    const ai: ExerciseResolver = { id: 'mock-ai', resolve: async () => draft };
    expect((await resolveUnknown('mace 360 with a log', undefined, { catalogue: C, resolver: ai })).resolvedBy).toBe('ai');
    const bad: ExerciseResolver = { id: 'bad', resolve: () => ({ ...draft, metGross: -1 }) };
    expect((await resolveUnknown('mace 360 with a log', undefined, { catalogue: C, resolver: bad })).resolvedBy).toBe('heuristic');
    const throws: ExerciseResolver = { id: 'down', resolve: () => Promise.reject(new Error('offline')) };
    expect((await resolveUnknown('mace 360 with a log', undefined, { catalogue: C, resolver: throws })).resolvedBy).toBe('heuristic');
    expect((await resolveUnknown('dand', undefined, { catalogue: C, resolver: ai })).resolvedBy).toBe('catalogue');
  });

  it('a resolved item joins the user catalogue as a mapped, D-certainty record and is credited, never rejected', () => {
    const rec = draftToRecord(resolveUnknownSync('wooden wheel curls', undefined, C), { id: 'user.wheel_curl' });
    expect(rec).toMatchObject({ status: 'mapped', certainty: 'D', origin: 'ai-resolved' });
    const user = createCatalogue(SEED_INPUT, { exercises: [rec], equipment: [resolveUnknownEquipment('cart wheel', C, { id: 'user.wheel', patterns: ['elbowFlexion'], loadKg: 12 })] });
    expect(validateExercise(rec, { equipment: new Set(user.equipment.map((q) => q.id)), sources: new Set(Object.keys(user.sources)) })).toEqual([]);
    expect(user.exercise('user.wheel_curl')).toBeDefined();
    expect(user.version).not.toBe(C.version);
    const r = sessionEquivalence([{ exerciseId: 'db_curl', setCount: 3, reps: 12, rir: 2 }], [{ exerciseId: 'user.wheel_curl', setCount: 3, reps: 12, rir: 2 }], user, CTX, intentFor('muscle'));
    expect(r.credit).toBeGreaterThan(0.6);
    expect(vectorOf([{ exerciseId: 'user.wheel_curl' }], user, CTX).tauSd).toBeGreaterThan(vectorOf([{ exerciseId: 'db_curl' }], user, CTX).tauSd ?? 0);
  });

  it('user entries win over seed entries with the same id; known equipment names resolve to the seed', () => {
    const edited = { ...C.exercise('dand')!, name: 'Dand (my version)', origin: 'user' as const };
    expect(createCatalogue(SEED_INPUT, { exercises: [edited] }).exercise('dand')!.name).toBe('Dand (my version)');
    expect(resolveUnknownEquipment('mugdar', C, { id: 'x' }).id).toBe('mudgar_heavy');
  });
});

describe('validateDraft bounds (V1e-12)', () => {
  const base = (): ExerciseDraft => resolveUnknownSync('wooden wheel curls', 'curls holding a cart wheel', C);

  it('every seed-based heuristic draft still passes', () => {
    for (const e of SEED_EXERCISES) {
      const d = resolveUnknownSync(`${e.name} variation zz`, undefined, C);
      expect(validateDraft(d)).toEqual([]);
    }
    expect(validateDraft(base())).toEqual([]);
  });

  it('rejects absurd or negative dose values, non-whole sets and reps', () => {
    const bad = (dose: ExerciseDraft['defaultDose']) => validateDraft({ ...base(), defaultDose: { ...base().defaultDose, ...dose } });
    expect(bad({ sets: 1e9 })).toContain('defaultDose.sets must be a whole number in [1, 20]');
    expect(bad({ sets: 2.5 })).toContain('defaultDose.sets must be a whole number in [1, 20]');
    expect(bad({ reps: -5 })).toContain('defaultDose.reps must be a whole number in [1, 200]');
    expect(bad({ restSec: -1 })).toContain('defaultDose.restSec must be in [0, 900]');
    expect(bad({ durationMin: 10_000 })).toContain('defaultDose.durationMin must be in [1, 600]');
    expect(bad({ sets: 20, reps: 200, restSec: 0 })).toEqual([]);
  });

  it('needs at least one region for strength work and caps metGross at 20', () => {
    expect(validateDraft({ ...base(), regions: {} })).toContain('regions is empty');
    expect(validateDraft({ ...base(), regions: {}, loadType: 'cardio', hybridCardioShare: 1 })).not.toContain('regions is empty');
    expect(validateDraft({ ...base(), metGross: 24.9 })).toContain('metGross must be in [1, 20]');
    expect(validateDraft({ ...base(), metGross: 20 })).toEqual([]);
  });
});
