// @vitest-environment node
/**
 * Algorithm v2 (PLANNER_V2_SPEC §1.2-1.3, §4): plan ladder on a planted front, structure race, holdout ensemble,
 * convergence curve, tier X checkpoint / resume (bitwise) and determinism across worker counts for ladder runs.
 */
import { decodeCheckpoint, encodeCheckpoint } from './checkpoint';
import type { PlannerConfig, PlannerProgress, PlannerResult } from './pipeline';
import { createLocalEvaluator, createPooledEvaluator, runPlanner } from './pipeline';
import type { ToyPlanner, ToyStructure } from './toys';
import { ladderToy, needleToy, regimesToy } from './toys';
import type { ConvergencePoint, EvalOutput, Evaluator } from './types';

const base: Partial<PlannerConfig> = { cvtSamples: 2000 };

function run(toy: ToyPlanner, cfg: Partial<PlannerConfig> = {}, evaluator?: Evaluator): Promise<PlannerResult<ToyStructure>> {
  return runPlanner(toy.problem, evaluator ?? createLocalEvaluator(toy.model, toy.problem.structures), {
    seed: 'v2',
    ...base,
    ...cfg,
  });
}

const num = (v: number) => (Number.isFinite(v) ? v : String(v));
/** Bitwise fingerprint of everything a caller reads (options, rungs, ladder, floors, accounting, curve). */
function fingerprint(r: PlannerResult<ToyStructure>): string {
  return JSON.stringify(
    {
      options: r.options.map((o) => [
        o.label,
        o.rung,
        o.D,
        o.structureIndex,
        Array.from(o.x),
        Array.from(o.desirability),
        o.robust ? Array.from(o.robust.robustD) : null,
        o.robustSelection ? Array.from(o.robustSelection.robustD) : null,
        o.ablations.map((a) => [a.label, Array.from(a.deltaD)]),
      ]),
      ladder: r.ladder ? { c: r.ladder.collapsed, k: r.ladder.checks, s: r.ladder.staircase.map((p) => [p.D, p.d1, p.g, p.structure, Array.from(p.x)]) } : null,
      floors: r.goals.floorsPhysical,
      scales: r.goals.scales,
      eu: r.provenance.euUsed,
      requests: r.provenance.requests,
      hits: r.provenance.cacheHits,
      stageEU: r.provenance.stageEU,
      curve: r.convergence,
      race: r.race,
      archive: r.archive,
      kappa: Array.from(r.conflicts.kappa),
      gap: r.holdoutGap,
      quanta: r.quanta,
      anchors: r.anchors.map((a) => (a ? [a.structure, Array.from(a.x), a.f] : null)),
    },
    (_k, v: unknown) => (typeof v === 'number' ? num(v) : v),
  );
}

function scrambledPool(inner: Evaluator, workers: number, chunk: number): Evaluator {
  return createPooledEvaluator(
    Array.from({ length: workers }, (_, w) => async (batch) => {
      const spins = (w * 7 + batch.length * 13 + batch[0]!.structure) % 5;
      for (let i = 0; i < spins; i++) await Promise.resolve();
      return (await inner.evaluate(batch)) as EvalOutput[];
    }),
    chunk,
  );
}

describe('plan ladder on a planted attainment-difficulty front (§1.2-1.3)', () => {
  it('Hard / Medium / Easy are ordered, distinct, and sit where the planted front puts them', async () => {
    const r = await run(ladderToy(), { tier: 'S' });
    const L = r.ladder!;
    expect(L.collapsed).toEqual([]);
    expect(r.options.map((o) => o.rung)).toEqual(['hard', 'medium', 'easy']);
    const [H, M, E] = [L.rungs.hard!, L.rungs.medium!, L.rungs.easy!];
    // Easy: the least effort that keeps half of Hard's goal 1 — on F(e) = 1 − (1 − e)², e ≈ 1 − √0.5 ≈ 0.29
    expect(E.D!).toBeGreaterThan(0.22);
    expect(E.D!).toBeLessThan(0.36);
    expect(E.desirability[0]!).toBeGreaterThanOrEqual(0.5 * H.desirability[0]! - 1e-9);
    // Medium: the knee of F between Easy and Hard (≈ 0.62 on the planted front)
    expect(M.D!).toBeGreaterThan(0.5);
    expect(M.D!).toBeLessThan(0.75);
    expect(H.D!).toBeGreaterThan(0.75);
    // distinctness checks (§1.3) and their report
    expect(L.checks.ordered).toBe(true);
    expect(L.checks.dHM).toBeGreaterThanOrEqual(0.15);
    expect(L.checks.dME).toBeGreaterThanOrEqual(0.15);
    expect(L.checks.gowerMin).toBeGreaterThanOrEqual(0.2);
    expect(H.desirability[0]!).toBeGreaterThanOrEqual(M.desirability[0]!);
    expect(M.desirability[0]!).toBeGreaterThanOrEqual(E.desirability[0]!);
    for (const o of [M, E]) {
      expect(o.distanceToChosen).toBeGreaterThanOrEqual(0.2);
      expect(o.robust!.draws).toBe(32);
      expect(o.robustSelection!.draws).toBe(16);
      expect(Array.from(o.costVsA)).toEqual(Array.from(H.desirability, (v, k) => v - o.desirability[k]!));
    }
    // the staircase is F(D̄): increasing in D and d̃₁, and close to the planted front
    const st = L.staircase;
    expect(st.length).toBeGreaterThan(5);
    for (let i = 1; i < st.length; i++) {
      expect(st[i]!.D).toBeGreaterThanOrEqual(st[i - 1]!.D);
      expect(st[i]!.d1).toBeGreaterThan(st[i - 1]!.d1);
    }
    // ladder runs leave the Ideal share to the caller
    // the dedicated Easy search (§12.2) is granted its EU on top of the total
    expect(r.provenance.budgetEU).toBe(3000 + (r.ladder!.easySearch?.grantEU ?? 0));
    expect(r.provenance.euUsed).toBeLessThanOrEqual(r.provenance.budgetEU);
  });

  it('a degenerate front collapses to Hard only, with reason codes; Hard below the minimal change collapses too', async () => {
    const r = await run(ladderToy({ degenerate: true }), { tier: 'S' });
    expect(r.options.map((o) => o.rung)).toEqual(['hard']);
    const reasons = Object.fromEntries(r.ladder!.collapsed.map((c) => [c.rung, c.reason]));
    expect(reasons).toEqual({ medium: 'tooClose', easy: 'tooClose' });
    for (const c of r.ladder!.collapsed) expect(Number.isFinite(c.detail.dGap!)).toBe(true);
    // goal 1's minimal meaningful change above anything reachable: Easy = Hard
    const toy = ladderToy();
    const tiny = { ...toy, problem: { ...toy.problem, ladder: { gMinMetric: 10 } } };
    const b = await run(tiny, { tier: 'S', ensembleSize: 0 });
    expect(b.options.map((o) => o.rung)).toEqual(['hard']);
    expect(b.ladder!.collapsed.map((c) => [c.rung, c.reason]).sort()).toEqual([
      ['easy', 'belowMinimal'],
      ['medium', 'belowMinimal'],
    ]);
  });

  it('streams provisional rungs (never throttled when they change) and a convergence curve', async () => {
    const events: PlannerProgress[] = [];
    const streamed: ConvergencePoint[] = [];
    let clock = 0;
    const r = await run(ladderToy(), {
      tier: 'S',
      onProgress: (p) => events.push(p),
      onConvergence: (p) => streamed.push(p),
      now: () => (clock += 5),
    });
    const firstHard = events.findIndex((e) => e.rungs?.hard);
    const firstEasy = events.findIndex((e) => e.rungs?.easy);
    expect(firstHard).toBeGreaterThanOrEqual(0);
    expect(firstEasy).toBeGreaterThanOrEqual(firstHard);
    // provisional Hard from the end of stage 1; Easy as soon as an archive plan meets its constraints (long before S5)
    expect(events[firstHard]!.stage).toBe('S3.1');
    expect(events[firstEasy]!.stage.startsWith('S3')).toBe(true);
    expect(events[firstEasy]!.rungs!.easy!.D).toBeLessThan(events[firstEasy]!.rungs!.hard!.D);
    // the curve: every ~2 % of the budget and every stage end, EU non-decreasing, streamed as recorded
    const c = r.convergence;
    expect(c.length).toBeGreaterThan(20);
    expect(streamed).toEqual(c);
    for (let i = 1; i < c.length; i++) expect(c[i]!.eu).toBeGreaterThanOrEqual(c[i - 1]!.eu);
    for (const s of ['S1', 'S3', 'S4', 'S4.ladder', 'S6']) expect(c.some((p) => p.stage === s)).toBe(true);
    expect(c[c.length - 1]!.hvLadder).toBeGreaterThan(0.4);
    expect(c[c.length - 1]!.wallMs).toBeGreaterThan(0);
    expect(c[c.length - 1]!.keyHard).toHaveLength(3);
  });
});

describe('Medium band search (PLN-06)', () => {
  // a rung D gap of 0.28 (Medium's own gap too, §12.8) leaves a narrow band between Easy (≈ 0.29) and Hard (≈ 0.86) that the knee Medium misses
  const toy0 = ladderToy();
  const toy: ToyPlanner = { ...toy0, problem: { ...toy0.problem, ladder: { gMinMetric: 0.05, minDGap: 0.28, mediumMinDGap: 0.28, mediumMinGower: 0.2 } } };
  const rungs = (r: PlannerResult<ToyStructure>) => r.options.map((o) => [o.rung, o.structureIndex, Array.from(o.x), o.D]);

  it('finds a distinct Medium in the band when the ladder dropped it, without moving Hard or Easy', async () => {
    const cfg = { seed: 's3', tier: 'S' as const, totalEU: 3000 };
    const off = await run(toy, { ...cfg, mediumBand: false });
    expect(off.ladder!.rungs.medium).toBeNull();
    expect(off.ladder!.collapsed.map((c) => [c.rung, c.reason])).toEqual([['medium', 'tooClose']]);
    const on = await run(toy, cfg);
    const L = on.ladder!;
    expect(L.mediumBand).toMatchObject({ accepted: true, dropped: { rung: 'medium', reason: 'tooClose' } });
    expect(L.collapsed).toEqual([]);
    const M = L.rungs.medium!;
    expect(M.D!).toBeGreaterThanOrEqual(L.mediumBand!.lo);
    expect(M.D!).toBeLessThanOrEqual(L.mediumBand!.hi);
    // the ladder's own thresholds, unchanged
    expect(L.checks.dHM).toBeGreaterThanOrEqual(0.28 - 1e-9);
    expect(L.checks.dME).toBeGreaterThanOrEqual(0.28 - 1e-9);
    expect(L.checks.gowerMin).toBeGreaterThanOrEqual(0.2 - 1e-9);
    expect(L.checks.ordered).toBe(true);
    expect([L.rungs.hard!.structureIndex, Array.from(L.rungs.hard!.x)]).toEqual([off.ladder!.rungs.hard!.structureIndex, Array.from(off.ladder!.rungs.hard!.x)]);
    expect([L.rungs.easy!.structureIndex, Array.from(L.rungs.easy!.x)]).toEqual([off.ladder!.rungs.easy!.structureIndex, Array.from(off.ladder!.rungs.easy!.x)]);
    // its EU comes on top of the total and is reported
    expect(L.mediumBand!.eu).toBeGreaterThan(0);
    expect(on.provenance.stageEU['S5.band']).toBeGreaterThan(0);
    expect(on.provenance.budgetEU).toBe(3000 + L.mediumBand!.grantEU + (L.easySearch?.grantEU ?? 0));
    expect(fingerprint(await run(toy, cfg))).toBe(fingerprint(on));
  }, 60_000);

  it('on a small run: either a distinct Medium, or the dropped state and its reason kept unchanged', async () => {
    // (before batch 02 the band search had ≈ 0.5 × the ladder share here and found nothing; it now gets at least the
    // Easy search's budget, and on this seed finds a distinct Medium)
    const cfg = { seed: 'v2', tier: 'S' as const, totalEU: 700 };
    const off = await run(toy, { ...cfg, mediumBand: false });
    const on = await run(toy, cfg);
    expect(on.ladder!.mediumBand!.eu).toBeGreaterThan(0);
    if (on.ladder!.mediumBand!.accepted) {
      expect(on.ladder!.collapsed).toEqual([]);
      expect(on.ladder!.checks.dHM).toBeGreaterThanOrEqual(0.28 - 1e-9);
      expect(on.ladder!.checks.dME).toBeGreaterThanOrEqual(0.28 - 1e-9);
      expect(on.ladder!.checks.ordered).toBe(true);
      expect(rungs(on).filter((r) => r[0] !== 'medium')).toEqual(rungs(off));
      expect(on.provenance.budgetEU).toBe(700 + on.ladder!.mediumBand!.grantEU + (on.ladder!.easySearch?.grantEU ?? 0));
      return;
    }
    expect(on.ladder!.collapsed).toEqual(off.ladder!.collapsed);
    expect(rungs(on)).toEqual(rungs(off));
    expect(on.provenance.budgetEU).toBe(700 + on.ladder!.mediumBand!.eu + (on.ladder!.easySearch?.grantEU ?? 0));
  }, 60_000);
});

describe('budget adherence (§4.8)', () => {
  it('never spends more than the run budget, however small; ladder runs spend the whole total', async () => {
    for (const total of [60, 150, 300, 700])
      for (const [toy, ens] of [
        [ladderToy(), 3],
        [ladderToy({ structures: 6 }), 16],
        [regimesToy({ spread: 0.2 }), 16],
        [needleToy(), 0],
      ] as const) {
        const r = await run(toy, { seed: `b${total}`, tier: 'S', totalEU: total, ensembleSize: ens, holdoutSize: ens ? 8 : 0 });
        expect([total, r.provenance.euUsed <= r.provenance.budgetEU]).toEqual([total, true]);
        // a Medium band search (PLN-06) is granted its EU on top of the total and reports it
        expect(r.provenance.budgetEU).toBe(total + (r.ladder?.mediumBand?.grantEU ?? 0) + (r.ladder?.easySearch?.grantEU ?? 0));
      }
    const toy = ladderToy();
    const all = await run({ ...toy, problem: { ...toy.problem, ladder: { gMinMetric: 0.05, reserveIdeal: false } } }, { tier: 'S' });
    expect(all.provenance.budgetEU).toBe(3000 + (all.ladder!.easySearch?.grantEU ?? 0));
    expect(all.provenance.euUsed).toBeLessThanOrEqual(3000);
  }, 120_000);
});

describe('structure race (§4.5)', () => {
  it('needle in a structure: the structure whose peak only search reveals survives every round and wins', async () => {
    let found = 0;
    for (const seed of ['n1', 'n2', 'n3', 'n4', 'n5', 'n6']) {
      const r = await run(needleToy(), { seed, tier: 'M', ensembleSize: 0 });
      const rounds = r.race.rounds;
      expect(rounds.length).toBe(3);
      // successive halving: survivors shrink, per-structure budgets grow ×η
      for (let i = 1; i < rounds.length; i++) {
        expect(rounds[i]!.survivors.length).toBeLessThanOrEqual(rounds[i - 1]!.survivors.length);
        expect(rounds[i]!.budgetPerStructure).toBeGreaterThan(2 * rounds[i - 1]!.budgetPerStructure);
      }
      if (rounds.every((x) => x.survivors.includes('s17')) && r.options[0]!.structure.id === 's17') found++;
    }
    // v1's screening shortlist finds it on 2 of these 6 seeds (README v2)
    expect(found).toBeGreaterThanOrEqual(5);
  }, 120_000);
});

describe('robust selection and holdout (§4.7)', () => {
  it('reports every robust number from the holdout ensemble and the selection-minus-holdout gap per goal', async () => {
    // problems without a ladder opt in to the holdout (ladder problems get TIER_HOLDOUT by default)
    const r = await run(regimesToy({ spread: 0.2 }), { tier: 'S', holdoutSize: 32 });
    const a = r.options[0]!;
    expect(a.robust!.draws).toBe(32);
    expect(a.robustSelection!.draws).toBe(16);
    expect(a.robust).not.toBe(a.robustSelection);
    expect(r.holdoutGap).toHaveLength(3);
    r.holdoutGap.forEach((g, k) => expect(g).toBeCloseTo(a.robustSelection!.goals[k]!.dMean - a.robust!.goals[k]!.dMean, 12));
    expect(r.holdoutGap.some((g) => g !== 0)).toBe(true);
    // decision stability is read on the holdout draws
    for (const o of r.options.slice(1)) expect(o.aBeatsThisShare).not.toBeNull();
    // no holdout without an ensemble, nor by default without a ladder (robust = the selection summary, v1 behaviour)
    const none = await run(regimesToy({ spread: 0.2 }), { tier: 'S', ensembleSize: 0, holdoutSize: 32 });
    expect(none.holdoutGap).toEqual([]);
    expect(none.options[0]!.robust).toBeNull();
    const v1 = await run(regimesToy({ spread: 0.2 }), { tier: 'S' });
    expect(v1.holdoutGap).toEqual([]);
    expect(v1.options[0]!.robust).toBe(v1.options[0]!.robustSelection);
    // a budget too small for the full holdout reports the draws it could pay for (never more than the run budget)
    const tight = await run(ladderToy(), { tier: 'S', totalEU: 400, ensembleSize: 3 });
    expect(tight.provenance.euUsed).toBeLessThanOrEqual(tight.provenance.budgetEU);
  });
});

describe('tier X checkpoint / resume and determinism (§4.9-4.11)', () => {
  const xCfg: Partial<PlannerConfig> = {
    seed: 'x',
    tier: 'X',
    totalEU: 6000,
    ensembleSize: 8,
    holdoutSize: 8,
    race: { roundEU: [20, 60, 180] },
  };

  it('X-short: a run resumed from any checkpoint is bitwise identical to the uninterrupted run', async () => {
    const toy = ladderToy({ structures: 6 });
    const saved: string[] = [];
    const ref = await run(toy, { ...xCfg, checkpoint: { save: (cp) => void saved.push(encodeCheckpoint(cp)), everyEU: 250 } });
    // checkpoints change nothing
    expect(fingerprint(await run(toy, xCfg))).toBe(fingerprint(ref));
    // race rounds 20 → 60 → 180 EU per survivor, then a "continue" round over the top structures
    expect(ref.race.rounds.map((x) => x.budgetPerStructure).slice(0, 3)).toEqual([20, 60, 180]);
    expect(ref.race.rounds.length).toBeGreaterThan(3);
    expect(saved.length).toBeGreaterThan(15);
    const labels = saved.map((s) => decodeCheckpoint(s).label);
    for (const l of ['S0', 'S1/screen', 'S1/round2', 'S1', 'S3.1', 'S4', 'S4.ladder']) expect(labels).toContain(l);
    const want = fingerprint(ref);
    for (const s of saved) {
      const cp = decodeCheckpoint(s);
      const r = await run(toy, { ...xCfg, checkpoint: { save: () => {}, resume: cp } });
      expect(r.provenance.resumedFrom).toBe(cp.label);
      expect(fingerprint(r)).toBe(want);
    }
    // a checkpoint of another request is refused (fresh run)
    const other = await run(toy, { ...xCfg, seed: 'other', checkpoint: { save: () => {}, resume: decodeCheckpoint(saved[5]!) } });
    expect(other.provenance.resumedFrom).toBe('refused');
  }, 300_000);

  it('ladder and X-short results are bitwise identical for worker counts / chunk sizes 1, 4, 8 (scrambled order)', async () => {
    for (const [toy, cfg] of [
      [ladderToy(), { tier: 'S' }],
      [ladderToy({ structures: 6 }), xCfg],
    ] as const) {
      const local = createLocalEvaluator(toy.model, toy.problem.structures);
      const ref = fingerprint(await run(toy, cfg, local));
      for (const [w, chunk] of [
        [1, 1],
        [4, 4],
        [8, 3],
      ] as const)
        expect(fingerprint(await run(toy, cfg, scrambledPool(local, w, chunk)))).toBe(ref);
    }
  }, 120_000);
});
