/**
 * W1-training catalogue contributions: D3-02 capacity-conserving strength assignment, D3-03 guideline minutes and interval
 * phases, D3-07 one bout ledger, D3-09 field/outcome provenance.
 */
import { describe, expect, it } from 'vitest';
import {
  aggregateStimulus,
  catalogueParam,
  intentFor,
  resolveDose,
  sessionEquivalence,
  stimulusEquivalence,
  toEngineDose,
  vectorOf,
  weeklyDose,
  type ExerciseRecord,
  type StimulusVector,
  type StrengthWork,
} from '@/catalogues';
import { EQUIVALENCE_SCORING_VERSION, strengthAssignment, transferOf } from '@/catalogues/equivalence';
import { healthClassFromTalkTest } from '@/catalogues/stimulus';
import { boutCost, KCAL_PER_KG_H_PER_MET } from '@/engine/core/exerciseCost';
import { SEED_CATALOGUE as C } from '@/content/catalogues';
import { CTX, lcg } from './helpers';

const ex = (id: string): ExerciseRecord => {
  const e = C.exercise(id);
  if (!e) throw new Error(id);
  return e;
};
const STR = { hyp: 0, str: 1, card: 0, kcal: 0, mob: 0 };
const work = (o: Partial<StrengthWork> & Pick<StrengthWork, 'sets'>): StrengthWork => ({ pattern: 'squat', implement: 'bar', loadPct: 85, exerciseId: 'bb_back_squat', ...o });
const vec = (strength: StrengthWork[]): StimulusVector => ({ effectiveSetsByRegion: {}, pattern: 'squat', loadClass: 'heavy', netKcal: 0, mem: 0, hiMinutes: 0, mobilityMinutes: {}, strength });

describe('D3-02 capacity-constrained strength assignment', () => {
  it('pure strength intent, the same task: 1 vs 10 sets → 0.1, 0 vs 10 → 0, 10 vs 10 → 1', () => {
    const pre = vec([work({ sets: 10 })]);
    expect(stimulusEquivalence(pre, vec([work({ sets: 1 })]), STR).score).toBeCloseTo(0.1, 12);
    expect(stimulusEquivalence(pre, vec([]), STR).score).toBe(0);
    expect(stimulusEquivalence(pre, vec([work({ sets: 0 })]), STR).score).toBe(0);
    expect(stimulusEquivalence(pre, vec([work({ sets: 10 })]), STR).score).toBeCloseTo(1, 12);
    // an empty prescription leaves the term out (absent, not 0 or 1 by accident)
    expect(strengthAssignment([], [work({ sets: 3 })])).toMatchObject({ present: false, ratio: 1 });
  });

  it('one performed group cannot complete two prescribed groups; no capacity is used twice', () => {
    // two identical prescribed groups of 3: the old per-prescription maximum credited 3 performed sets twice (ratio 1)
    const a = strengthAssignment([work({ sets: 3 }), work({ sets: 3 })], [work({ sets: 3 })]);
    expect(a.ratio).toBeCloseTo(0.5, 12);
    expect(a.allocations.reduce((s, x) => s + x.sets, 0)).toBeCloseTo(3, 12);
    // squat + bench prescribed, squat performed: the squat sets go where they count most (not also to the bench)
    const b = strengthAssignment([work({ sets: 3 }), work({ sets: 3, pattern: 'horizontalPush', exerciseId: 'bb_bench_press' })], [work({ sets: 3 })]);
    expect(b.ratio).toBeCloseTo(0.5, 12);
    expect(b.remaining).toEqual([0, 3]);
    expect(b.transfer).toBe('exact');
  });

  it('solves the greedy counterexample optimally (1 + 0.2 greedy vs 0.8 + 0.8 optimal)', () => {
    // performed A matches prescribed A exactly (1) and B by neighbour pattern (0.5 → here same pattern 0.8); performed X
    // matches A at 0.8 and B only at the "other" heuristic
    const preA = work({ sets: 1, exerciseId: 'bb_back_squat' });
    const preB = work({ sets: 1, exerciseId: 'bb_front_squat' });
    const logA = work({ sets: 1, exerciseId: 'bb_back_squat' });
    const logX = work({ sets: 1, exerciseId: 'leg_press', implement: 'machine' });
    const a = strengthAssignment([preA, preB], [logA, logX]);
    // optimum: logA → preA (1) + logX → preB (0.8), or logA → preB (0.8) + logX → preA (0.8); best is 1.8
    expect(a.matched).toBeCloseTo(1.8, 12);
    expect(a.ratio).toBeCloseTo(0.9, 12);
    // greedy-by-best-pair loses here: X→A (1) then Y→B (0.8·0.65) = 1.52; the optimum X→B (0.8) + Y→A (0.8) = 1.6
    const A = work({ sets: 1, exerciseId: 'a', loadPct: 50 });
    const B = work({ sets: 1, exerciseId: 'b', loadPct: 85 });
    const X = work({ sets: 1, exerciseId: 'a', loadPct: 85 });
    const Y = work({ sets: 1, exerciseId: 'y', loadPct: 50 });
    const g = strengthAssignment([A, B], [X, Y]);
    expect(g.matched).toBeCloseTo(1.6, 12);
    expect(g.allocations.map((x) => [x.log, x.pre])).toEqual([[1, 0], [0, 1]]);
    expect(strengthAssignment([B, A], [Y, X]).matched).toBeCloseTo(1.6, 12); // order-stable
  });

  it('identity, permutation and duplicate-splitting invariance; scores bounded in [0, 1]', () => {
    const rand = lcg(11);
    const pats: StrengthWork['pattern'][] = ['squat', 'hinge', 'horizontalPush', 'verticalPull', 'lunge'];
    const impls: StrengthWork['implement'][] = ['bar', 'handheld', 'machine', 'bodyweight'];
    const pick = <T>(a: readonly T[]): T => a[Math.floor(rand() * a.length)]!;
    const gen = (n: number): StrengthWork[] =>
      Array.from({ length: n }, () => ({ pattern: pick(pats), implement: pick(impls), sets: 1 + Math.floor(rand() * 4), loadPct: 40 + Math.floor(rand() * 55), exerciseId: `e${Math.floor(rand() * 4)}` }));
    for (let t = 0; t < 40; t++) {
      const pre = gen(1 + Math.floor(rand() * 4));
      const log = gen(Math.floor(rand() * 5));
      const r = strengthAssignment(pre, log).ratio;
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
      expect(strengthAssignment(pre, pre).ratio).toBeCloseTo(1, 12);
      expect(strengthAssignment([...pre].reverse(), [...log].reverse()).ratio).toBeCloseTo(r, 12);
      const split = log.flatMap((l) => (l.sets >= 2 ? [{ ...l, sets: l.sets / 2 }, { ...l, sets: l.sets / 2 }] : [l]));
      expect(strengthAssignment(pre, split).ratio).toBeCloseTo(r, 12);
      // fewer performed sets never score higher
      const fewer = log.map((l) => ({ ...l, sets: l.sets * 0.5 }));
      expect(strengthAssignment(pre, fewer).ratio).toBeLessThanOrEqual(r + 1e-12);
    }
  });

  it('exact same task needs identity, implement and compatible ROM; pattern + implement alone is a heuristic', () => {
    expect(transferOf(work({ sets: 1 }), work({ sets: 1 }))).toEqual({ c: 1, basis: 'sameTask' });
    // identified different exercises, same pattern and implement: related task, heuristic credit (not 1)
    expect(transferOf(work({ sets: 1, exerciseId: 'bb_front_squat' }), work({ sets: 1 }))).toEqual({ c: catalogueParam('cSamePattern'), basis: 'heuristic' });
    // same exercise, different implement class: not the exact task
    expect(transferOf(work({ sets: 1, implement: 'handheld' }), work({ sets: 1 })).basis).toBe('heuristic');
    // different ROM when both are known
    expect(transferOf(work({ sets: 1, rom: 'partial' }), work({ sets: 1, rom: 'full' })).basis).toBe('heuristic');
    // legacy stored work without identity keeps the old pattern/implement rule, labelled as legacy
    const legacy = { pattern: 'squat' as const, implement: 'bar' as const, sets: 1, loadPct: 85 };
    expect(transferOf(legacy, legacy)).toEqual({ c: catalogueParam('cSamePatternSameImplement'), basis: 'legacyHeuristic' });
    // declared task: two catalogue entries of the same swing task, same implement → exact
    const swing = vectorOf([{ exerciseId: 'kb_swing', setCount: 6, reps: 15, rpe: 8 }], C, CTX);
    const emom = vectorOf([{ exerciseId: 'kb_swing_emom', rounds: 6, reps: 15, rpe: 8 }], C, CTX);
    const a = strengthAssignment(swing.strength ?? [], emom.strength ?? []);
    expect(a.transfer).toBe('exact');
  });

  it('the stimulus vector carries identity, task and ROM; scoring never changes the simulated dose', () => {
    const doses = [resolveDose(ex('rdl'), { exerciseId: 'rdl', setCount: 3, reps: 8, rir: 2 }, CTX)];
    const v = aggregateStimulus(doses);
    expect(v.strength![0]).toMatchObject({ exerciseId: 'rdl', rom: 'lengthened' });
    const before = JSON.stringify(toEngineDose(doses, 18));
    sessionEquivalence([{ exerciseId: 'bb_deadlift', setCount: 3 }], [{ exerciseId: 'rdl', setCount: 3, reps: 8, rir: 2 }], C, CTX, intentFor('strength'));
    expect(JSON.stringify(toEngineDose(doses, 18))).toBe(before);
    expect(strengthAssignment([], []).version).toBe(EQUIVALENCE_SCORING_VERSION);
  });

  it('the result carries its scoring version and the set allocation behind S_str (what remains, transfer basis)', () => {
    const pre = vec([work({ sets: 3 }), work({ sets: 3, pattern: 'horizontalPush', exerciseId: 'bb_bench_press' })]);
    const r = stimulusEquivalence(pre, vec([work({ sets: 2 })]), STR);
    expect(r.scoringVersion).toBe(EQUIVALENCE_SCORING_VERSION);
    expect(r.strengthAssignment).toMatchObject({ present: true, prescribedSets: 6, performedSets: 2, remaining: [1, 3], transfer: 'exact' });
    expect(r.strengthAssignment!.allocations).toEqual([{ log: 0, pre: 0, sets: 2, credit: 1, basis: 'sameTask' }]);
    expect(r.score).toBeCloseTo(2 / 6, 12);
    // no strength prescription: the term and its allocation are absent
    expect(stimulusEquivalence(vec([]), vec([work({ sets: 2 })]), STR).strengthAssignment).toBeUndefined();
  });
});

describe('D3-03 guideline minutes, intervals and RPE scales', () => {
  const walk = (o: Record<string, unknown>) => vectorOf([{ exerciseId: 'brisk_walk', ...o }], C, CTX);

  it('75 stated vigorous minutes = 150 equivalent = 150 moderate minutes; the adult lower reference is met', () => {
    const vig = weeklyDose([vectorOf([{ exerciseId: 'jog_outdoor', minutes: 75, healthIntensityClass: 'vigorous' }], C, CTX)]);
    expect(vig.healthEquivalentMin).toBe(150);
    expect(vig.aerobicReference).toBe('met');
    const mod = weeklyDose([walk({ minutes: 150, healthIntensityClass: 'moderate' })]);
    expect(mod.healthEquivalentMin).toBe(150);
    expect(mod.aerobicReference).toBe('met');
    // the fitness MEM index is a separate number, never relabelled as guideline minutes
    expect(mod.mem).not.toBe(mod.healthEquivalentMin);
  });

  it('no 10-minute bout minimum: three 5-minute moderate bouts count 15 minutes', () => {
    const w = weeklyDose([0, 1, 2].map(() => walk({ minutes: 5, healthIntensityClass: 'moderate' })));
    expect(w.healthModerateMin).toBe(15);
  });

  it('an unknown class is not zero: minutes stay unknown with a range, the reference is unknown when the range spans it', () => {
    const w = weeklyDose([walk({ minutes: 100 })]);
    expect(w.healthEquivalentMin).toBeNull();
    expect(w.healthEquivalentRange[0]).toBe(0);
    expect(w.healthEquivalentRange[1]).toBeCloseTo(200, 9);
    expect(w.aerobicReference).toBe('unknown');
    expect(weeklyDose([walk({ minutes: 100, healthIntensityClass: 'moderate' })], { ageYears: 15 }).aerobicReference).toBe('notApplicable');
  });

  it('talk test (moderate talks but cannot sing; vigorous only a few words) and generic relative effort classify; CR10 alone does not', () => {
    expect(healthClassFromTalkTest('talkNotSing')).toBe('moderate');
    expect(healthClassFromTalkTest('fewWords')).toBe('vigorous');
    expect(healthClassFromTalkTest('fullSentences')).toBe('unknown');
    const generic = walk({ minutes: 30, rpe: 7, rpeScale: 'relativeEffort0To10' });
    expect(generic.healthVigorousMin).toBeCloseTo(30, 9);
    // A1-062: Borg CR10 has other anchors — its number alone never becomes guideline minutes (unknown, not zero)
    const cr10 = walk({ minutes: 30, rpe: 7, rpeScale: 'cr10' });
    expect(cr10.healthVigorousMin).toBeNull();
  });

  it('changing the VO2max prior alone never changes stated guideline minutes', () => {
    const a = vectorOf([{ exerciseId: 'brisk_walk', minutes: 40, healthIntensityClass: 'moderate' }], C, { ...CTX, vo2max: 30 });
    const b = vectorOf([{ exerciseId: 'brisk_walk', minutes: 40, healthIntensityClass: 'moderate' }], C, { ...CTX, vo2max: 55 });
    expect(a.healthModerateMin).toBe(b.healthModerateMin);
    expect(a.healthVigorousMin).toBe(b.healthVigorousMin);
  });

  it('HIIT 10 × 1 min work / 1 min recovery: 10 hard minutes, energy = Σ phases (recovery is not work intensity)', () => {
    const intervals = Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? { kind: 'work' as const, durationMin: 1, met: 12 } : { kind: 'recovery' as const, durationMin: 1, met: 4 }));
    const d = resolveDose(ex('bike_hiit'), { exerciseId: 'bike_hiit', minutes: 20, intervals }, CTX);
    expect(d.cardio!.hiMinutes).toBeCloseTo(10, 9);
    expect(d.energy.intensitySource).toBe('phases');
    expect(d.energy.grossKcal).toBeCloseTo((10 * 12 + 10 * 4) * ((3.5 * 80 * 5) / 1000), 9);
    // the engine session carries the same phases (so it integrates the same energy)
    const eng = toEngineDose([d], 18);
    expect(eng.cardio[0]!.phases).toHaveLength(20);
    expect(eng.cardio[0]!.phases![1]).toMatchObject({ kind: 'recovery', met: 4 });
    // CR-10-only bout: a broad scenario band, never a precise %VO2max
    const rpeOnly = resolveDose(ex('spin_class'), { exerciseId: 'spin_class', minutes: 30, rpe: 6, rpeScale: 'cr10' }, CTX);
    expect(rpeOnly.energy.intensitySource).toBe('rpeScenario');
    expect(rpeOnly.energy.netHigh - rpeOnly.energy.netLow).toBeGreaterThan(0.2 * rpeOnly.energy.netKcal);
  });

  it('a CR-10 or unspecified RPE is never read as resistance RIR; the RIR-RPE scale is', () => {
    const at = (o: Record<string, unknown>) => resolveDose(ex('db_bench_press'), { exerciseId: 'db_bench_press', setCount: 3, reps: 8, ...o }, CTX).groups[0]!;
    const cr10 = at({ rpe: 6, rpeScale: 'cr10' });
    expect(cr10.rir).toBe(2); // the item's default, not 10 − 6 = 4
    expect(cr10.provenance?.rir).toBe('default');
    expect(at({ rpe: 6 }).provenance?.rir).toBe('default'); // legacy unknown scale
    const rirRpe = at({ rpe: 6, rpeScale: 'rirRpe' });
    expect(rirRpe.rir).toBe(4);
    expect(rirRpe.provenance?.rir).toBe('inferred');
  });
});

describe('D3-07 one bout ledger in the catalogue', () => {
  it('catalogue net above own rest equals the shared resolver (and so the engine) across body mass and RMR', () => {
    for (const [bw, rmr] of [[55, 1250], [80, 1800], [120, 2400]] as const) {
      const ctx = { bodyMassKg: bw, vo2max: 40, heightM: 1.75, rmrKcalPerDay: rmr };
      const d = resolveDose(ex('treadmill_run'), { exerciseId: 'treadmill_run', minutes: 30 }, ctx);
      const ref = boutCost({ grossKcal: 9.3 * KCAL_PER_KG_H_PER_MET * bw * 0.5, durationMin: 30, rmrKcalPerDay: rmr, displacedFracOfRmr: 0.2, method: 'compendiumMet', source: 'estimated' });
      expect(d.energy.netKcal).toBeCloseTo(ref.netAboveRestKcal, 9);
      expect(d.energy.cost).toMatchObject({ restBasis: 'personalRmr' });
      expect(d.energy.cost.incrementalKcal!).toBeCloseTo(ref.incrementalKcal!, 9);
    }
    // without an RMR the standard 1 MET is own rest (the published-equation convention, labelled)
    const std = resolveDose(ex('treadmill_run'), { exerciseId: 'treadmill_run', minutes: 20 }, CTX);
    expect(std.energy.cost.restBasis).toBe('standardMet');
    expect(std.energy.netKcal).toBeCloseTo(232.4, 1);
  });

  it('a personal resting intercept does not inherit the published equation validation (domain says so)', () => {
    const pub = resolveDose(ex('brisk_walk'), { exerciseId: 'brisk_walk', minutes: 30, speedKmh: 5 }, CTX);
    const own = resolveDose(ex('brisk_walk'), { exerciseId: 'brisk_walk', minutes: 30, speedKmh: 5 }, { ...CTX, rmrKcalPerDay: 1700 });
    expect(pub.energy.cost.domain).toBe('Ludlow & Weyand 2016 level walking');
    expect(own.energy.cost.domain).toMatch(/modelled intercept/);
  });

  it('labelled ledger terms on the stimulus vector (gross, own rest, net, displaced, incremental)', () => {
    const v = vectorOf([{ exerciseId: 'brisk_walk', minutes: 30 }, { exerciseId: 'db_bench_press', setCount: 3 }], C, { ...CTX, rmrKcalPerDay: 1750 });
    expect(v.cost).toBeDefined();
    expect(v.cost!.netAboveRestKcal).toBeCloseTo(v.netKcal, 9);
    expect(v.cost!.grossKcal).toBeGreaterThan(v.cost!.netAboveRestKcal);
  });

  it('session steps inside a total-day count travel to the engine cardio session', () => {
    const d = resolveDose(ex('brisk_walk'), { exerciseId: 'brisk_walk', minutes: 30, stepsIncluded: 3300 }, CTX);
    expect(toEngineDose([d], 8).cardio[0]!.stepsIncluded).toBe(3300);
  });
});

describe('D3-09 field and outcome provenance', () => {
  it('a minutes-only flow keeps energy, mobility and skill credit; its muscle dose is unknown, never known hard sets', () => {
    const d = resolveDose(ex('mallakhamb_pole'), { exerciseId: 'mallakhamb_pole', minutes: 25 }, CTX);
    expect(d.doseStatus).toBe('unknown');
    expect(d.evidence.muscleDose).toBe('unknown');
    expect(d.energy.netKcal).toBeGreaterThan(0);
    expect(d.sets).toBeGreaterThan(0); // the legacy 1 set / 2.5 min scenario stays (not a biological zero)
    for (const g of d.groups) expect(g.provenance?.sets).toBe('unknown'); // the engine groups say so too (assumed)
    expect(aggregateStimulus([d]).doseStatus).toBe('unknown');
    const flow = resolveDose(ex('surya_namaskar'), { exerciseId: 'surya_namaskar', rounds: 12 }, CTX);
    expect(flow.doseStatus).toBe('unknown');
    expect(Object.values(flow.mobilityMinutes).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });

  it('the optional count of genuinely challenging bouts replaces the scenario; an easy effort gives no hard sets', () => {
    const hard = resolveDose(ex('mallakhamb_pole'), { exerciseId: 'mallakhamb_pole', minutes: 25, hardBouts: 4, effort: 'hard' }, CTX);
    expect(hard.sets).toBe(4);
    expect(hard.doseStatus).toBe('reported');
    expect(hard.groups[0]!.provenance?.sets).toBe('reported');
    const max = resolveDose(ex('mallakhamb_pole'), { exerciseId: 'mallakhamb_pole', minutes: 25, hardBouts: 4, effort: 'maximal' }, CTX);
    expect(max.groups[0]!.rir).toBe(0);
    const easy = resolveDose(ex('mallakhamb_pole'), { exerciseId: 'mallakhamb_pole', minutes: 25, hardBouts: 4, effort: 'light' }, CTX);
    expect(easy.sets).toBe(0);
    expect(easy.energy.netKcal).toBeCloseTo(hard.energy.netKcal, 9); // energy credit unchanged
  });

  it('missing effort never forces failure: the default RIR is used and labelled default', () => {
    const g = resolveDose(ex('goblet_squat'), { exerciseId: 'goblet_squat', setCount: 3, reps: 10 }, CTX).groups[0]!;
    expect(g.rir).toBe(2);
    expect(g.provenance?.rir).toBe('default');
    const failed = resolveDose(ex('goblet_squat'), { exerciseId: 'goblet_squat', setCount: 3, reps: 10, stopReason: 'failure' }, CTX).groups[0]!;
    expect(failed.rir).toBe(0);
    const skill = resolveDose(ex('goblet_squat'), { exerciseId: 'goblet_squat', setCount: 3, reps: 10, stopReason: 'skill' }, CTX).groups[0]!;
    expect(skill.provenance?.rir).toBe('default'); // a skill-limited stop says nothing about proximity to failure
  });

  it('high-repetition and ballistic loads are out of the reps → %1RM domain: load unknown, raw reps and RIR kept', () => {
    const hi = resolveDose(ex('baithak'), { exerciseId: 'baithak', setCount: 3, reps: 50, rir: 5 }, CTX).groups[0]!;
    expect(hi.provenance?.load).toBe('unknown');
    expect(hi.reps).toBe(50);
    expect(hi.rir).toBe(5);
    const inDomain = resolveDose(ex('db_bench_press'), { exerciseId: 'db_bench_press', setCount: 3, reps: 8, rir: 2 }, CTX).groups[0]!;
    expect(inDomain.provenance?.load).toBe('inferred');
    const swing = resolveDose(ex('kb_swing'), { exerciseId: 'kb_swing', setCount: 4, reps: 15 }, CTX).groups[0]!;
    expect(swing.provenance?.load).toBe('unknown');
  });

  it('a hold keeps its hold time and isometric contraction, with no invented dynamic %1RM', () => {
    const d = resolveDose(ex('plank'), { exerciseId: 'plank', sets: [{ holdSec: 45 }, { holdSec: 50 }] }, CTX);
    const g = d.groups[0]!;
    expect(g.contraction).toBe('isometric');
    expect(g.holdSec).toBe(45);
    expect(g.provenance?.load).toBe('unknown');
    expect(g.rir).toBeUndefined();
    expect(d.evidence.load).toBe('unknown');
  });

  it('outcome evidence is independent: an equation-measured energy with an unknown muscle dose', () => {
    const d = resolveDose(ex('treadmill_run'), { exerciseId: 'treadmill_run', minutes: 30, speedKmh: 10 }, CTX);
    expect(d.evidence.energy).toBe('equation');
    expect(d.evidence.muscleDose).not.toBe('reported');
  });

  it('qualitative task descriptors for swaps (no efficacy multipliers)', () => {
    expect(ex('rdl').rom).toBe('lengthened');
    expect(ex('bb_back_squat').jointActions).toEqual(['kneeExtension', 'hipExtension']);
    expect(ex('kb_swing').velocity).toBe('explosive');
    expect(ex('kb_swing').task).toBe(ex('kb_swing_emom').task);
    // descriptors change nothing in the dose
    const a = resolveDose(ex('rdl'), { exerciseId: 'rdl', setCount: 3, reps: 8, rir: 2 }, CTX);
    const b = resolveDose({ ...ex('rdl'), rom: undefined, jointActions: undefined }, { exerciseId: 'rdl', setCount: 3, reps: 8, rir: 2 }, CTX);
    expect(a.effectiveSetsByRegion).toEqual(b.effectiveSetsByRegion);
  });
});
