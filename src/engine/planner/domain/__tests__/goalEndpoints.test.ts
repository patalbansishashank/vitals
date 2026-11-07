// @vitest-environment node
/**
 * D4-05: goal endpoints. A body-fat goal is judged on the tissue fat fraction 100·FM/(FM + FFM_act) of the composition
 * binding (reference glycogen and its water inside FFM_act, never FM + leanTissue), so labile water or glycogen never
 * improve it; a missing required output is unavailable — excluded from the objective and shown Unavailable, never zero or
 * success; glycaemia and blood pressure need a target (no open-ended minimisation, no invented target); a research index
 * cannot promote fasting; ordinary goals still plan without labs.
 */
import { describe, expect, it } from 'vitest';
import { CURRENT_TISSUE_FAT_ENDPOINT } from '@/lib/bodyContracts';
import { profileCompositionTissue, tissueReferenceFfmKg } from '../../../model/composition';
import type { SimulationResult } from '../../../types/result';
import { objectiveShapeIssue, PLANNER_CAPABILITY_VERSION, TARGET_BAND_REQUIRED } from '../capabilities';
import { compileRequest, type PlanningContext } from '../context';
import { goalRequiredSeries, goalSeries, goalValue, goalValueStatus, missingGoalIndices, type GoalBinding } from '../goalSpecs';
import { goalSeriesIds } from '../sensitivities';
import { MAN_95, WOMAN_62, request } from './personas';

const N = 28;
const ctxBf: PlanningContext = compileRequest(request(MAN_95, [{ metric: 'bodyFatPct', direction: 'target', target: 22, endpointSemantics: CURRENT_TISSUE_FAT_ENDPOINT }]));
const bind: GoalBinding = { metric: 'bodyFatPct', functional: 'end', useTissueMass: false };

/** A run with the given end-of-day fat mass and lean tissue (kg) and arbitrary labile water / glycogen / wake BF series. */
function sim(fm: (d: number) => number, lt: (d: number) => number, labile: (d: number) => number = () => 0, fm0 = fm(0), lt0 = lt(0)): SimulationResult {
  const arr = (f: (d: number) => number) => Float32Array.from({ length: N }, (_, d) => f(d));
  return {
    initial: { fatMass: fm0, leanTissue: lt0, waterWeight: labile(0), glycogenTotal: 400 + 100 * labile(0), bodyFatPct: 30 + labile(0) },
    daily: {
      fatMass: arr(fm),
      leanTissue: arr(lt),
      waterWeight: arr(labile),
      glycogenTotal: arr((d) => 400 + 100 * labile(d)),
      // the wake scale-BF series (FM / scale) moves with water: a different operator the objective must ignore
      bodyFatPct: arr((d) => (100 * fm(d)) / (fm(d) + lt(d) + 8 + labile(d))),
    },
    meta: { nDays: N },
    safety: { tissueMassKg: arr((d) => fm(d) + lt(d) + tissueReferenceFfmKg(ctxBf.rp)!) },
  } as unknown as SimulationResult;
}

describe('D4-05 tissue fat fraction objective', () => {
  const ref = tissueReferenceFfmKg(ctxBf.rp)!;

  it('body-fat goals read the composition binding: 100·FM/(FM + LT + referenceFfm), reference glycogen/water included', () => {
    expect(ref).toBeGreaterThan(0);
    const t = profileCompositionTissue(ctxBf.rp)!;
    const s = sim(() => t.fatMassKg, () => t.leanTissueKg);
    const y = goalSeries(s, bind, ctxBf)!;
    expect(y[0]).toBeCloseTo(t.tissueFatPct!, 4);
    expect(y[0]).toBeCloseTo((100 * t.fatMassKg) / (t.fatMassKg + t.leanTissueKg + ref), 4);
    // never FM / (FM + leanTissue)
    expect(Math.abs(y[0]! - (100 * t.fatMassKg) / (t.fatMassKg + t.leanTissueKg))).toBeGreaterThan(0.05);
    expect(goalRequiredSeries('bodyFatPct')).toEqual(['fatMass', 'leanTissue']);
  });

  it('at fixed fat and lean tissue, changing labile water and glycogen never improves the objective', () => {
    const fm = (d: number) => 28 - 0.05 * d;
    const lt = () => 55;
    const dry = goalValue(sim(fm, lt, () => 0), bind, ctxBf);
    const wet = goalValue(sim(fm, lt, (d) => 1.5 * Math.sin(d)), bind, ctxBf);
    const depleted = goalValue(sim(fm, lt, () => -2), bind, ctxBf);
    expect(wet).toBeCloseTo(dry, 6);
    expect(depleted).toBeCloseTo(dry, 6);
  });

  it('a lower tissue fraction needs less fat at the same lean tissue (the objective moves with tissue only)', () => {
    const lean = goalValue(sim((d) => 28 - 0.2 * d, () => 55), bind, ctxBf);
    const flat = goalValue(sim(() => 28, () => 55), bind, ctxBf);
    expect(lean).toBeLessThan(flat);
  });

  it('forward runs (ForwardModel / replan) record the required outputs of a body-fat goal', () => {
    expect(goalSeriesIds(ctxBf)).toEqual(expect.arrayContaining(['bodyFatPct', 'fatMass', 'leanTissue']));
  });

  it('the planner-side capability rules are versioned', () => {
    expect(PLANNER_CAPABILITY_VERSION).toBe(3);
  });
});

describe('D4-05 missing outputs are unavailable, never zero or success', () => {
  const ctxMin = compileRequest(request(MAN_95, [{ metric: 'fatMass', direction: 'minimise' }, { metric: 'hunger', direction: 'minimise' }]));
  const b: GoalBinding[] = ctxMin.goals.map((g) => ({ metric: g.metric, functional: g.functional, useTissueMass: g.useTissueMass }));

  it('a missing goal series returns Unavailable with a non-favourable compatibility value (not the ideal 0 of a minimisation)', () => {
    const s = { initial: { fatMass: 30 }, daily: { fatMass: Float32Array.from({ length: N }, () => 30) }, meta: { nDays: N }, safety: {} } as unknown as SimulationResult;
    const hunger = goalValueStatus(s, b[1]!, ctxMin);
    expect(hunger.available).toBe(false);
    expect(hunger.reasonCode).toBe('missingOutput');
    expect(missingGoalIndices(s, b, ctxMin)).toEqual([1]);
    const fat = goalValueStatus(s, b[0]!, ctxMin);
    expect(fat).toMatchObject({ available: true, reasonCode: 'ok' });
  });

  it('a non-finite output is unavailable too; a missing lean-tissue series makes a body-fat goal unavailable', () => {
    const s = sim(() => Number.NaN, () => 55);
    expect(goalValueStatus(s, bind, ctxBf).available).toBe(false);
    const noLean = { initial: { fatMass: 28 }, daily: { fatMass: Float32Array.from({ length: N }, () => 28) }, meta: { nDays: N }, safety: {} } as unknown as SimulationResult;
    expect(goalValueStatus(noLean, bind, ctxBf)).toMatchObject({ available: false, reasonCode: 'missingOutput' });
  });
});

describe('D4-05 objective shape: target/band for glycaemia and blood pressure', () => {
  it('open-ended minimisation of glucose, fasting glucose or systolic pressure does not compile; a target does', () => {
    expect([...TARGET_BAND_REQUIRED].sort()).toEqual(['bhb', 'fastingGlucose', 'glucose', 'glycogenTotal', 'sbp']);
    for (const metric of ['glucose', 'fastingGlucose', 'sbp'] as const) {
      expect(objectiveShapeIssue({ metric, direction: 'minimise' })).toBe('needsTargetBand');
      const ctx = compileRequest(request(MAN_95, [{ metric, direction: 'minimise' }, { metric: 'fatMass', direction: 'minimise' }]));
      expect(ctx.goals.map((g) => g.metric)).toEqual(['fatMass']);
      expect(ctx.goalReviews?.some((r) => r.metric === metric && r.reasonCode === 'needsTargetBand')).toBe(true);
      expect(ctx.problems).toEqual([]); // unresolved intent remains Review while the supported fat-loss goal can run
    }
    expect(objectiveShapeIssue({ metric: 'sbp', direction: 'target', target: 125 })).toBeNull();
    expect(objectiveShapeIssue({ metric: 'ldl', direction: 'minimise' })).toBeNull();
  });

  it('a research index cannot be a goal, so it cannot promote fasting', () => {
    const ctx = compileRequest(request(MAN_95, [{ metric: 'autophagyIdx', direction: 'maximise' }], { safety: { optIns: { fastingTier: 'T3' } } }));
    expect(ctx.goals).toEqual([]);
    expect(ctx.fastingRelevant).toBe(false);
    expect(ctx.problems.length).toBeGreaterThan(0);
  });

  it('a healthy user without labs can still plan fat loss, maintenance and strength', () => {
    for (const goals of [
      [{ metric: 'fatMass' as const, direction: 'minimise' as const }],
      [{ metric: 'fatMass' as const, direction: 'target' as const, target: 0, targetKind: 'change' as const }],
      [{ metric: 'strength' as const, direction: 'maximise' as const }, { metric: 'leanTissue' as const, direction: 'maximise' as const }],
    ]) {
      const ctx = compileRequest(request(WOMAN_62, goals));
      expect(ctx.problems).toEqual([]);
      expect(ctx.goals.length).toBe(goals.length);
    }
  });
});
