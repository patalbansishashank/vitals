/**
 * Planner store actions (importable only from `src/commands/**`): goal-set ops (`goals.edit`) and the optimiser run
 * lifecycle (`planner.find` job). Goal rules live here so every entry point agrees: at most `MAX_PLANNER_GOALS` goals,
 * no duplicate metrics, horizon 28–183 days.
 */
import type { PlannerProgressInfo, PlannerRequest, PlannerResult, Strictness } from '@/engine/planner/domain/types';
import { usePlannerStore } from '../plannerStore';
import {
  EMPTY_RUN,
  MAX_PLANNER_GOALS,
  PLANNER_HORIZON_MAX,
  PLANNER_HORIZON_MIN,
  appendTraces,
  clamp,
  foundSlots,
  pickPlannerValues,
  type AddGoalOutcome,
  type ConstraintDraft,
  type GoalDraft,
  type PlannerValues,
  type SuggestedRecord,
} from './plannerModel';
import { pickSuggested } from './plannerModel';

/** SUITE_SPEC §1.9 `GoalOp` (absolute ops: replaying yields the same state). */
export type GoalOp =
  | { op: 'add'; goal: Omit<GoalDraft, 'key'> & { key?: string } }
  | { op: 'remove'; key: string }
  | { op: 'move'; from: number; to: number }
  | { op: 'update'; key: string; patch: Partial<Omit<GoalDraft, 'key' | 'metric'>> }
  | { op: 'setHorizon'; days: number }
  | { op: 'setStartDate'; date: string | null }
  | { op: 'setLimits'; patch: Partial<ConstraintDraft> }
  | { op: 'resetLimits' }
  | { op: 'setStrictness'; value: Strictness }
  | { op: 'setSuggested'; record: SuggestedRecord | null };

export type GoalOpOutcome = AddGoalOutcome | 'applied' | 'unchanged' | 'not-found';

let keySeq = 0;
const newKey = (metric: string) => `${metric}-${Date.now().toString(36)}-${(keySeq++).toString(36)}`;

/** Apply goal ops in order; returns one outcome per op. */
export function applyGoalOps(ops: readonly GoalOp[]): GoalOpOutcome[] {
  const out: GoalOpOutcome[] = [];
  for (const op of ops) {
    const s = usePlannerStore.getState();
    switch (op.op) {
      case 'add': {
        if (s.goals.some((g) => g.metric === op.goal.metric)) out.push('duplicate');
        else if (s.goals.length >= MAX_PLANNER_GOALS) out.push('full');
        else {
          const goal: GoalDraft = { ...op.goal, key: op.goal.key ?? newKey(op.goal.metric) };
          usePlannerStore.setState({ goals: [...s.goals, goal] });
          out.push('added');
        }
        break;
      }
      case 'remove': {
        if (!s.goals.some((g) => g.key === op.key)) out.push('not-found');
        else {
          usePlannerStore.setState({ goals: s.goals.filter((g) => g.key !== op.key) });
          out.push('applied');
        }
        break;
      }
      case 'move': {
        const n = s.goals.length;
        const target = clamp(op.to, 0, n - 1);
        if (op.from < 0 || op.from >= n || target === op.from) out.push('unchanged');
        else {
          const next = s.goals.slice();
          const [moved] = next.splice(op.from, 1);
          next.splice(target, 0, moved!);
          usePlannerStore.setState({ goals: next });
          out.push('applied');
        }
        break;
      }
      case 'update': {
        if (!s.goals.some((g) => g.key === op.key)) out.push('not-found');
        else {
          usePlannerStore.setState({ goals: s.goals.map((g) => (g.key === op.key ? { ...g, ...op.patch } : g)) });
          out.push('applied');
        }
        break;
      }
      case 'setHorizon':
        usePlannerStore.setState({ horizonDays: clamp(Math.round(op.days), PLANNER_HORIZON_MIN, PLANNER_HORIZON_MAX) });
        out.push('applied');
        break;
      case 'setStartDate':
        usePlannerStore.setState({ startDate: op.date });
        out.push('applied');
        break;
      case 'setLimits':
        usePlannerStore.setState({ constraints: { ...s.constraints, ...op.patch } });
        out.push('applied');
        break;
      case 'resetLimits':
        usePlannerStore.setState({ constraints: {} });
        out.push('applied');
        break;
      case 'setStrictness':
        usePlannerStore.setState({ strictness: op.value });
        out.push('applied');
        break;
      case 'setSuggested':
        usePlannerStore.setState({ suggested: op.record === null ? null : pickSuggested(op.record) });
        out.push('applied');
        break;
    }
  }
  return out;
}

export function goalSet(): PlannerValues {
  return pickPlannerValues(usePlannerStore.getState());
}

/* ---------------------------------------------------------------- run lifecycle (planner.find job) */

export function runStarted(hash: string, request: PlannerRequest, at: number): void {
  usePlannerStore.setState({
    run: { ...EMPTY_RUN, status: 'running', requestHash: hash, request, startedAt: at },
    lastRequestHash: hash,
    lastRunAt: new Date().toISOString(),
  });
}

export function runProgress(p: PlannerProgressInfo): void {
  usePlannerStore.setState((s) => {
    if (s.run.status !== 'running' && s.run.status !== 'stopping') return s;
    const traces = appendTraces(s.run.traces, p);
    const found = foundSlots(s.run.found, p);
    const stages = s.run.stages[s.run.stages.length - 1] === p.stage ? s.run.stages : [...s.run.stages, p.stage];
    return { run: { ...s.run, progress: p, traces, found, stages } };
  });
}

export function runStopping(): void {
  usePlannerStore.setState((s) => (s.run.status === 'running' ? { run: { ...s.run, status: 'stopping', stoppedByUser: true } } : s));
}

export function runFinished(result: PlannerResult, at: number): void {
  usePlannerStore.setState((s) => ({ run: { ...s.run, status: 'done', result, endedAt: at, error: null } }));
}

export function runFailed(message: string, at: number): void {
  usePlannerStore.setState((s) => ({ run: { ...s.run, status: 'failed', error: message, endedAt: at } }));
}

export function runCancelled(at: number): void {
  usePlannerStore.setState((s) => ({ run: { ...s.run, status: 'cancelled', endedAt: at } }));
}

export function clearRun(): void {
  usePlannerStore.setState({ run: EMPTY_RUN });
}

export function runState() {
  return usePlannerStore.getState().run;
}
