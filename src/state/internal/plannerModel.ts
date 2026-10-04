/**
 * Planner goal-set model (pure): goals, horizon, limits (overrides only), strictness, the run state shape and the
 * progress reducers. Shared by the projection (`../plannerStore.ts`), the `goals.*` / `planner.*` commands and the
 * document mapping (`goals/me`).
 */
import type { CardioModality } from '@/engine/types/schedule';
import type { MetricId } from '@/engine/types/metrics';
import type { PlannerProgressInfo, PlannerRequest, PlannerResult, Strictness, Weekday } from '@/engine/planner/domain/types';
import type { GoalSuggestion } from '@/engine/planner/domain/suggestGoals';

export const PLANNER_KEY = 'vitals.planner';
export const PLANNER_VERSION = 1;
/** Dossier 18: at most six ranked goals. */
export const MAX_PLANNER_GOALS = 6;
/** Dossier 18 / MODEL_SPEC §10: horizon 28–183 days. */
export const PLANNER_HORIZON_MIN = 28;
export const PLANNER_HORIZON_MAX = 183;
export const DEFAULT_HORIZON_DAYS = 112;

/**
 * How the user phrased a goal (planner-goals.md §6 goal types). Maps to the engine's direction:
 * lose/keep/gain → target change (or maximise with an aspiration for lean tissue), raise → maximise,
 * lower → minimise, reach → absolute target.
 */
export type GoalMode = 'lose' | 'keep' | 'gain' | 'raise' | 'lower' | 'reach';
/** Priority strength (planner-goals.md §6): must = hard floor-like, should = default tolerance, nice = tie-breaker. */
export type GoalStrength = 'must' | 'should' | 'nice';

export interface GoalDraft {
  /** Stable key for list rendering and reordering (not the metric: the metric is unique anyway, but keys survive edits). */
  key: string;
  metric: MetricId;
  mode: GoalMode;
  /** Magnitude in metric units (kg, cm, % points, mmol/L…); the sign comes from the mode. null = no target. */
  amount: number | null;
  strength: GoalStrength;
  /** Engine functional override: 'end' (last week) or 'mean' (over the horizon). null = engine default. */
  functional: 'end' | 'mean' | null;
}

/** Longest single stretch without food the user accepts (planner-goals.md §6 "longest fast I'd do"). */
export type LongestFast = 12 | 16 | 20 | 24 | 48 | 72;
export type HungerTolerance = 'low' | 'medium' | 'high';

/** Practical limits (planner-goals.md §6, dossier 18 §3). Stored as overrides; see `effectiveConstraints`. */
export interface ConstraintDraft {
  /** Resistance-training days a week, [min, max], 0–6 (the engine always keeps a rest day). */
  trainingDays: [number, number];
  /** Weekdays on which training may happen (0 = Monday). */
  trainingWeekdays: Weekday[];
  /** Usual training time, clock hour. */
  trainingTimeH: number;
  /** Longest session, min. */
  maxSessionMin: number;
  /** Cardio days a week, [min, max]. */
  cardioDays: [number, number];
  cardioModality: CardioModality;
  /** Earliest first meal and latest last meal, clock hours. */
  earliestH: number;
  latestH: number;
  mealsPerDay: [number, number];
  steps: [number, number];
  longestFastH: LongestFast;
  /** I'd like fasting to be part of the plan (dossier 20 §4C). */
  prefersFasting: boolean;
  /** Lever / block ids the user refuses (engine registry ids, e.g. 'refeedDay', 'L7', 'B2'). */
  excluded: string[];
  /** Protein floor, g per kg reference weight; null = the evidence minimum. */
  proteinFloor: number | null;
  /** Net-carbohydrate floor, g/day (0 = none). */
  carbFloorG: number;
  /** Keep sleep as it is (no sleep-extension lever). */
  sleepFixed: boolean;
  hungerTolerance: HungerTolerance;
}

export type RunStatus = 'idle' | 'running' | 'stopping' | 'done' | 'failed' | 'cancelled';

/** Convergence traces for the optimiser progress chart: best score (0–1) per progress tick per slot. */
export interface RunTraces {
  /** Provisional scores per slot (rank-weighted "% of achievable"; the fallback when the engine sends no score). */
  A: number[];
  B: number[];
  C: number[];
  /** The engine's own utility of the current best plan (`PlannerProgressInfo.score`), one entry per scored tick. */
  best: number[];
}

/** A provisional option as soon as a progress event carries it (A first, B/C after the diversity stage). */
export interface FoundSlot {
  name: string;
  /** "% of achievable" per goal, in rank order. */
  percentOfAchievable: number[];
}

export interface PlannerRunState {
  status: RunStatus;
  /** Hash of the request this run (or result) belongs to. */
  requestHash: string | null;
  /** The request, kept for rendering (units, start date, profile for prescriptions). */
  request: PlannerRequest | null;
  /** performance.now()-style wall clock (ms) when the run started / ended. */
  startedAt: number | null;
  endedAt: number | null;
  progress: PlannerProgressInfo | null;
  traces: RunTraces;
  /** Latest provisional option per slot (A, B, C); kept when a later event carries fewer. */
  found: [FoundSlot | null, FoundSlot | null, FoundSlot | null];
  /** Stages seen, in order (for the stage line and "stages skipped" copy). */
  stages: string[];
  /** The user pressed Stop: the result keeps what was found (`result.complete === false`). */
  stoppedByUser: boolean;
  result: PlannerResult | null;
  error: string | null;
}

export interface PlannerValues {
  goals: GoalDraft[];
  horizonDays: number;
  /** ISO date of day 0; null = next Monday (resolved by the feature). */
  startDate: string | null;
  /** Only the limits the user changed; the rest come from Habits. */
  constraints: Partial<ConstraintDraft>;
  strictness: Strictness;
  lastRequestHash: string | null;
  lastRunAt: string | null;
  /** The last goal suggestion the person applied (`goals.suggested`, SUITE_SPEC §13.4); null when none. */
  suggested: SuggestedRecord | null;
}

/**
 * `goals/me.suggested`: the suggestion the person applied with its provenance, so the ladder can say "based on your
 * answers". `goalKeys` are the goals it added (they carry the "suggested" tag until edited).
 */
export interface SuggestedRecord {
  suggestion: GoalSuggestion;
  at: string;
  provenance: { source: 'rule' | 'ai'; version: string };
  goalKeys: string[];
}

export type AddGoalOutcome = 'added' | 'full' | 'duplicate';

export interface PlannerActions {
  addGoal: (goal: GoalDraft) => AddGoalOutcome;
  removeGoal: (key: string) => void;
  /** Move a goal from one rank index to another (0-based). */
  moveGoal: (from: number, to: number) => void;
  updateGoal: (key: string, patch: Partial<Omit<GoalDraft, 'key' | 'metric'>>) => void;
  setHorizonDays: (days: number) => void;
  setStartDate: (iso: string | null) => void;
  setConstraints: (patch: Partial<ConstraintDraft>) => void;
  resetConstraints: () => void;
  setStrictness: (s: Strictness) => void;
  /** Run lifecycle (driven by src/features/planner/run.ts). */
  runStarted: (hash: string, request: PlannerRequest, at: number) => void;
  runProgress: (p: PlannerProgressInfo) => void;
  runStopping: () => void;
  runFinished: (result: PlannerResult, at: number) => void;
  runFailed: (message: string, at: number) => void;
  runCancelled: (at: number) => void;
  /** Forget the in-memory result (e.g. body reset). */
  clearRun: () => void;
}

export type PlannerState = PlannerValues & PlannerActions & { run: PlannerRunState };

export const EMPTY_RUN: PlannerRunState = {
  status: 'idle',
  requestHash: null,
  request: null,
  startedAt: null,
  endedAt: null,
  progress: null,
  traces: { A: [], B: [], C: [], best: [] },
  found: [null, null, null],
  stages: [],
  stoppedByUser: false,
  result: null,
  error: null,
};

export const DEFAULT_PLANNER: PlannerValues = {
  goals: [],
  horizonDays: DEFAULT_HORIZON_DAYS,
  startDate: null,
  constraints: {},
  strictness: 'balanced',
  lastRequestHash: null,
  lastRunAt: null,
  suggested: null,
};

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/* --------------------------------------------------------------------------------------------- validation */

export const MODES: readonly GoalMode[] = ['lose', 'keep', 'gain', 'raise', 'lower', 'reach'];
export const STRENGTHS: readonly GoalStrength[] = ['must', 'should', 'nice'];

export function isGoalDraft(x: unknown): x is GoalDraft {
  if (!x || typeof x !== 'object') return false;
  const g = x as Record<string, unknown>;
  return (
    typeof g.key === 'string' &&
    typeof g.metric === 'string' &&
    MODES.includes(g.mode as GoalMode) &&
    (g.amount === null || (typeof g.amount === 'number' && Number.isFinite(g.amount))) &&
    STRENGTHS.includes(g.strength as GoalStrength) &&
    (g.functional === null || g.functional === 'end' || g.functional === 'mean')
  );
}

/** Keep only well-formed goals, unique metrics, at most six. */
export function sanitizeGoals(list: unknown): GoalDraft[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: GoalDraft[] = [];
  for (const g of list) {
    if (!isGoalDraft(g) || seen.has(g.metric)) continue;
    seen.add(g.metric);
    out.push({ key: g.key, metric: g.metric, mode: g.mode, amount: g.amount, strength: g.strength, functional: g.functional });
    if (out.length === MAX_PLANNER_GOALS) break;
  }
  return out;
}

/** Accepts anything shaped like the persisted planner state (import validation). */
export function isPlannerState(x: unknown): boolean {
  if (!x || typeof x !== 'object') return false;
  const s = x as Record<string, unknown>;
  if (!Array.isArray(s.goals) || !s.goals.every(isGoalDraft)) return false;
  if (s.horizonDays !== undefined && typeof s.horizonDays !== 'number') return false;
  if (s.constraints !== undefined && (typeof s.constraints !== 'object' || s.constraints === null)) return false;
  return true;
}

/** Persisted values from anything (defaults fill the gaps). */
export function pickPlannerValues(raw: unknown): PlannerValues {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof PlannerValues, unknown>>;
  const horizon = typeof s.horizonDays === 'number' && Number.isFinite(s.horizonDays) ? Math.round(s.horizonDays) : DEFAULT_HORIZON_DAYS;
  return {
    goals: sanitizeGoals(s.goals),
    horizonDays: clamp(horizon, PLANNER_HORIZON_MIN, PLANNER_HORIZON_MAX),
    startDate: typeof s.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.startDate) ? s.startDate : null,
    constraints: s.constraints && typeof s.constraints === 'object' ? { ...(s.constraints as Partial<ConstraintDraft>) } : {},
    strictness: s.strictness === 'strict' || s.strictness === 'flexible' ? s.strictness : 'balanced',
    lastRequestHash: typeof s.lastRequestHash === 'string' ? s.lastRequestHash : null,
    lastRunAt: typeof s.lastRunAt === 'string' ? s.lastRunAt : null,
    suggested: pickSuggested(s.suggested),
  };
}

/** A stored `suggested` record, or null when it is missing or malformed. */
export function pickSuggested(raw: unknown): SuggestedRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const p = r.provenance as Record<string, unknown> | undefined;
  const sug = r.suggestion as Record<string, unknown> | undefined;
  if (typeof r.at !== 'string' || !p || (p.source !== 'rule' && p.source !== 'ai') || typeof p.version !== 'string') return null;
  if (!sug || typeof sug !== 'object' || !Array.isArray(sug.goals)) return null;
  const keys = Array.isArray(r.goalKeys) ? r.goalKeys.filter((k): k is string => typeof k === 'string') : [];
  return { suggestion: sug as unknown as GoalSuggestion, at: r.at, provenance: { source: p.source, version: p.version }, goalKeys: keys };
}

/** Merge-mode import: keep this device's goals when it has any, else take the incoming ones. */
export function mergePlannerStates(current: unknown, incoming: unknown): PlannerValues {
  const cur = pickPlannerValues(current);
  const inc = pickPlannerValues(incoming);
  return cur.goals.length > 0 ? cur : inc;
}


/**
 * Score of a provisional option for the convergence chart: rank-weighted mean of "% of achievable" (weights 1, ½, ¼ …),
 * 0–1. Reassurance only (CHART_SPEC §7.6); the real ranking is lexicographic.
 */
export function provisionalScore(percentOfAchievable: readonly number[]): number {
  let num = 0;
  let den = 0;
  percentOfAchievable.forEach((p, i) => {
    if (!Number.isFinite(p)) return;
    const w = 1 / 2 ** i;
    num += w * clamp(p, 0, 110);
    den += w;
  });
  return den > 0 ? num / den / 100 : 0;
}

const SLOTS = ['A', 'B', 'C'] as const;

export function foundSlots(prev: PlannerRunState['found'], p: PlannerProgressInfo): PlannerRunState['found'] {
  if (!p.provisional?.length) return prev;
  const next = prev.slice() as PlannerRunState['found'];
  p.provisional.slice(0, 3).forEach((o, i) => {
    next[i] = { name: o.name, percentOfAchievable: [...o.percentOfAchievable] };
  });
  return next;
}

export function appendTraces(prev: RunTraces, p: PlannerProgressInfo): RunTraces {
  const scored = typeof p.score === 'number' && Number.isFinite(p.score);
  if (!p.provisional?.length && !scored) return prev;
  const next: RunTraces = { A: prev.A.slice(), B: prev.B.slice(), C: prev.C.slice(), best: scored ? [...prev.best, p.score as number] : prev.best };
  if (!p.provisional?.length) return next;
  const tick = Math.max(prev.A.length, prev.B.length, prev.C.length);
  SLOTS.forEach((slot, i) => {
    const opt = p.provisional[i];
    if (!opt) return;
    const score = provisionalScore(opt.percentOfAchievable);
    const arr = next[slot];
    // A slot that appears late starts level with its first score, so every trace spans the same ticks.
    while (arr.length < tick) arr.push(score);
    arr.push(score);
  });
  return next;
}

/** True when a finished result exists for a request other than `currentHash` (inputs, body or safety changed). */
export function isPlannerResultStale(run: PlannerRunState, currentHash: string | null): boolean {
  return run.result !== null && currentHash !== null && run.requestHash !== currentHash;
}

