/**
 * Planner v2 → v1 views (docs/PLANNER_V2_SPEC.md §9.6). `planRegimes` and the stores/commands that still hold the v1
 * `PlannerResult` get the ladder as options in rung order with FIXED ids (hard 'A', medium 'B', easy 'C', so a collapsed
 * Medium leaves options [A, C]); the v2 result rides along as `v2` for the ladder UI. Removed in 0.3.0.
 */
import type { GoalScore, PlanOption, PlannerProgressInfo, PlannerProgressV2, PlannerResult, PlannerResultV2, RungId, RungPlan } from './types';
import { RUNG_IDS } from './types';

/** Fixed v1 id of each rung (matches the living plan's `RUNG_OF_OPTION`). */
export const V1_ID: Readonly<Record<RungId, PlanOption['id']>> = { hard: 'A', medium: 'B', easy: 'C' };
export const RUNG_OF_V1_ID: Readonly<Record<PlanOption['id'], RungId>> = { A: 'hard', B: 'medium', C: 'easy' };

/** v1 option of a rung (A-relative fields from the Hard-relative ones). */
export function toV1Option(r: RungPlan): PlanOption {
  const { kind, summary: _summary, genome: _genome, hardBeatsThisShare, scorecard, sessions: _sessions, ...rest } = r;
  return {
    ...rest,
    id: V1_ID[kind],
    name: rest.name || r.summary.title,
    scorecard: scorecard.map(({ costVsHard, ...s }) => ({ ...s, costVsA: costVsHard }) as GoalScore),
    aBeatsThisShare: hardBeatsThisShare,
  };
}

/** The v1 result view of a v2 result (options = present rungs, Hard first), with the v2 result attached. */
export function toV1Result(v2: PlannerResultV2): PlannerResult {
  const options = RUNG_IDS.flatMap((k) => (v2.rungs[k] ? [toV1Option(v2.rungs[k]!)] : []));
  const { tier, plannerVersion: _v, holdoutGap: _g, difficultyWeights: _w, checkpointKey: _c, ...prov } = v2.provenance;
  return {
    status: v2.status,
    complete: v2.complete,
    stoppedAt: v2.stoppedAt,
    options,
    feasibility: v2.feasibility,
    relations: v2.relations,
    noSafePlanReasons: v2.noSafePlanReasons,
    message: v2.message,
    stubModules: v2.stubModules,
    fasting: v2.fasting,
    provenance: { ...prov, tier },
    v2,
  };
}

/** The v1 progress view of a v2 progress event (provisional rungs in rung order), with the v2 event attached. */
export function toV1Progress(p: PlannerProgressV2): PlannerProgressInfo {
  const provisional = RUNG_IDS.flatMap((k) => {
    const r = p.provisional[k];
    return r ? [{ structureId: r.structureId, name: r.title, percentOfAchievable: r.percentOfAchievable, schedule: r.schedule }] : [];
  });
  return { stage: p.stage, fraction: p.fraction, euUsed: p.euUsed, euBudget: p.euBudget, provisional, score: p.score, optionsChanged: p.changed, v2: p };
}
