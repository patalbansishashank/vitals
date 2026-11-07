/** Baseline-anchored nutrition comparisons. Saving a diagnostic never starts or approves a living plan. */
import { contentHash } from '@/lib/bodyContracts';
import type { PlannerRequest } from '@/engine/planner/domain/types';
import type { BaselineImprovementResult } from '@/engine/planner/domain/baselineImprovement';
import * as sched from '@/state/internal/schedule';
import { defineCommand, fail } from '../registry';
import { T } from '../schema';
import { ALL, UNDO } from './_shared';
import type { CommandContext } from '../types';

export type ImprovementReport = Omit<BaselineImprovementResult, 'candidates'> & {
  candidates: Array<Omit<BaselineImprovementResult['candidates'][number], 'schedule'>>;
};
export interface ImprovementRunView {
  runId: string;
  sourceScenarioId: string;
  sourceName: string;
  sourceProvenance: string | null;
  requestHash: string;
  report: ImprovementReport;
}
interface FrozenRun {
  view: ImprovementRunView;
  result: BaselineImprovementResult;
  sourceHash: string;
  contextHash: string;
}
const runs = new Map<string, FrozenRun>();
const MAX_RUNS = 8;

function prepared(ctx: CommandContext): { request: PlannerRequest; hash: string } {
  const current = ctx.ports.planner?.prepare();
  if (!current) fail('precondition_failed', 'Set up a fat-loss goal and body profile before comparing this routine.');
  return { request: structuredClone(current.request) as PlannerRequest, hash: current.hash };
}
function contextHash(request: PlannerRequest): string {
  // Include goals and every practical/clinical limit as well as physiology. A result is never silently copied after
  // its decision context changed, even if the same body and source schedule remain selected.
  return contentHash(request);
}
function summarize(result: BaselineImprovementResult): ImprovementReport {
  return { ...result, candidates: result.candidates.map(({ schedule: _schedule, ...candidate }) => {
    void _schedule;
    return candidate;
  }) };
}
function needRun(runId: string): FrozenRun {
  return runs.get(runId) ?? fail('not_found', 'That comparison is no longer available. Run the comparison again.');
}

const RunView = T.As<ImprovementRunView>(T.Object({
  runId: T.String(),
  sourceScenarioId: T.String(),
  sourceName: T.String(),
  sourceProvenance: T.Nullable(T.String()),
  requestHash: T.String(),
  report: T.OpenObject(),
}));

export const plannerImproveCurrent = defineCommand({
  id: 'planner.improveCurrent',
  version: 1,
  title: 'Compare changes to this routine',
  description: 'Freeze an existing fixed-calorie routine and compare a declared, bounded nutrition family: protein, meal timing and lifting/rest-day carbohydrate and energy distribution. Nutrition-only cases preserve all exercise; optional concrete whole-body training cases change RT on the same weekdays. Steps, cardio, sleep and weekly calories remain fixed. Reports matched-control effects, paired baseline differences and policy failures. Model analysis only; no adoption approval or personal guarantee.',
  input: T.Object({
    scenarioId: T.String({ minLength: 1 }),
    maxMuscleLossPct: T.Optional(T.NumberEnum([2, 5])),
    draws: T.Optional(T.NumberEnum([16, 32])),
    includeTrainingChanges: T.Optional(T.Boolean()),
  }),
  output: RunView,
  perm: 'read',
  surfaces: ALL,
  undo: UNDO.none,
  idempotency: 'natural',
  longRunning: { kind: 'job', softTimeoutMs: 25_000 },
  sideEffects: ['engine'],
  safety: ['screeningReady'],
  preconditions: ['scenarioExists', 'markerReask'],
  execute: (ctx, input) => {
    const sc = sched.scenarioById(input.scenarioId) ?? fail('not_found', 'That source scenario does not exist.');
    const source = structuredClone(sc);
    const current = prepared(ctx);
    const request: PlannerRequest = {
      ...current.request,
      startDate: source.schedule.startDate,
      horizonDays: source.schedule.horizonDays,
      ...(input.maxMuscleLossPct === undefined ? {} : { constraints: {
        ...current.request.constraints,
        muscleRetention: { ...current.request.constraints?.muscleRetention, maxLossPct: input.maxMuscleLossPct },
      } }),
    };
    const runId = ctx.newId();
    const stop = new AbortController();
    const sourceHash = contentHash(source.schedule);
    const requestHash = contentHash({ request, sourceHash });
    const frozenContext = contextHash(current.request);
    return ctx.jobs.start('whatIf', async (job) => {
      const { searchBaselineImprovement } = await import('@/engine/planner/domain/baselineImprovement');
      const result = await searchBaselineImprovement({
        request,
        baseline: source.schedule,
        // Stable across 2%/5% checks and retries: changing the allowed loss must not fish a new parameter sample.
        seed: 'baseline-improvement/v1',
        auditMembers: input.draws ?? 32,
        includeTrainingChanges: input.includeTrainingChanges ?? true,
        signal: stop.signal,
        onProgress: p => job.progress(p.total ? p.completed / p.total : 0, 'paired-comparison', p),
      });
      const view: ImprovementRunView = { runId, sourceScenarioId: source.id, sourceName: source.name, sourceProvenance: source.provenance ?? null, requestHash, report: summarize(result) };
      if (stop.signal.aborted) throw new DOMException('Comparison cancelled', 'AbortError');
      runs.set(runId, { view: structuredClone(view), result: structuredClone(result), sourceHash, contextHash: frozenContext });
      while (runs.size > MAX_RUNS) runs.delete(runs.keys().next().value!);
      return view;
    }, { onCancel: () => stop.abort() });
  },
});

export const plannerImprovementResult = defineCommand({
  id: 'planner.improvementResult',
  version: 1,
  title: 'Read a routine comparison',
  description: 'Read the baseline-anchored report, candidate IDs, paired deltas and policy failures from a finished comparison. Exact candidate prescriptions remain frozen for planner.openImprovement.',
  input: T.Object({ runId: T.String({ minLength: 1 }) }),
  output: RunView,
  perm: 'read',
  surfaces: ALL,
  excludedReason: { ui: 'the comparison panel reads its completed command result' },
  undo: UNDO.none,
  idempotency: 'none',
  sideEffects: [],
  execute: (_ctx, input) => structuredClone(needRun(input.runId).view),
});

export const plannerOpenImprovement = defineCommand({
  id: 'planner.openImprovement',
  version: 1,
  title: 'Open a compared routine in Simulator',
  description: 'Copy an exact frozen comparison candidate into Simulator, preserving the source routine. Every copy is explicitly marked Diagnostic. This never starts or approves a living plan. Re-run if body inputs, screening, equipment, goals, limits or the source schedule changed.',
  input: T.Object({ runId: T.String({ minLength: 1 }), candidateId: T.String({ minLength: 1 }), name: T.Optional(T.String({ minLength: 1, maxLength: 60 })), activate: T.Optional(T.Boolean()) }),
  output: T.Object({ scenarioId: T.String(), diagnostic: T.Boolean(), sourceScenarioId: T.String() }),
  perm: 'write',
  impact: 'low',
  surfaces: ALL,
  undo: UNDO.TS,
  idempotency: 'key',
  sideEffects: ['docs'],
  execute: (ctx, input) => {
    const run = needRun(input.runId);
    const source = sched.scenarioById(run.view.sourceScenarioId);
    if (!source || contentHash(source.schedule) !== run.sourceHash || contextHash(prepared(ctx).request) !== run.contextHash)
      fail('conflict', 'The body, screening, equipment, goals, limits or source routine changed. Run the comparison again before copying a candidate.');
    const candidate = run.result.candidates.find(c => c.id === input.candidateId) ?? fail('not_found', 'That comparison candidate does not exist.');
    // This analysis issues no adoption/safety certificate, even when its sampled model checks pass.
    const diagnostic = true;
    const name = input.name ?? `${diagnostic ? 'Diagnostic' : 'Compared routine'} - ${candidate.id}`;
    const scenarioId = sched.createScenario({
      name: name.slice(0, 60),
      schedule: structuredClone(candidate.schedule),
      activate: input.activate ?? false,
      started: false,
      provenance: `${diagnostic ? 'Diagnostic, policy not cleared' : 'Model comparison'}; source ${run.view.sourceScenarioId}; candidate ${candidate.id}`.slice(0, 120),
    });
    return { scenarioId, diagnostic, sourceScenarioId: run.view.sourceScenarioId };
  },
});

declare module '../types' {
  interface CommandMap {
    'planner.improveCurrent': typeof plannerImproveCurrent;
    'planner.improvementResult': typeof plannerImprovementResult;
    'planner.openImprovement': typeof plannerOpenImprovement;
  }
}
