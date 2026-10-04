/**
 * Checkpoints of a planner run (PLANNER_V2_SPEC §4.9): plain data (typed arrays as number[]) that `runPlanner` hands
 * to `config.checkpoint.save` at every race round, every stage end and every `everyEU` inside the CMA-driven loops, and
 * that `config.checkpoint.resume` continues from. A resumed run is bitwise identical to an uninterrupted one: the
 * checkpoint carries every record the run still refers to (with its evaluation output), RNG and CMA-ES states of the
 * jobs in flight, goal scales and floors, archive elites, the conflict history, the convergence curve and the keys of
 * every evaluation made so far — the evaluation cache itself is not stored; a resumed run re-evaluates a known key
 * deterministically and charges it 0 EU (as the uninterrupted run's cache hit did).
 *
 * The data may contain NaN and ±Infinity (margins, keys): structured clone (IndexedDB) keeps them; for JSON use
 * `encodeCheckpoint` / `decodeCheckpoint`.
 */
import type { BipopState, CmaEsState, IpopState } from './cmaes';
import type { GoalSystemState } from './goals';
import type { LadderCollapse } from './ladder';
import type { ConvergencePoint, EvalOutput } from './types';

export const CHECKPOINT_VERSION = 2;

export interface SerializedOutput {
  goals: number[];
  margins: number[];
  regulariser: number;
  descriptors: number[];
  features?: number[];
  cost?: number;
  aborted?: { day: number; constraint: number; magnitude: number };
}

export interface SerializedRecord {
  id: number;
  structure: number;
  x: number[];
  box: number;
  draw: number;
  stage: string;
  out: SerializedOutput;
}

/** A CMA-ES job (`runCma`) in flight: restart wrapper state and bookkeeping. */
export interface JobData {
  label: string;
  kind: 'ipop' | 'bipop';
  state: IpopState | BipopState;
  used: number;
  reqs: number;
  bestId: number | null;
}

/** Race phase (S1) progress. */
export interface RaceData {
  step: 'start' | 'round' | 'done';
  round: number;
  continueRound: number;
  stale: number;
  /** Best record of the race so far (stage-1 key), for the tier X "continue" stopping rule. */
  bestId: number | null;
  alive: number[];
  budgetPer: number;
  /** Per alive structure (same order): EU and requests used in the current round. */
  used: number[];
  reqs: number[];
  /** Per alive structure: CMA-ES instance state (null: none / stopped). */
  inst: Array<CmaEsState | null>;
  /** Instance started in this round (σ₀ restart) — kept across rounds when still running. */
  roundStarted: boolean;
  /** Per structure index: tracker record ids (best, best per goal, best per D tercile). */
  track: Array<[number, number | null, Array<number | null>, Array<number | null>]>;
}

export interface StagesData {
  k: number;
  incumbentId: number | null;
  starts: Array<{ id: number; sigma: number; share: number }> | null;
  s: number;
  budget: number;
  bestIds: number[];
  job: JobData | null;
}

export interface AnchorsData {
  k: number;
  /** Cumulative EU at which the anchors stop (planned share + their part of the race's unused EU). */
  end: number;
  /** Current anchor run: start record, budget and objective scale (fixed when it started). */
  cur?: { id: number; budget: number; scale: number };
  job: JobData | null;
}

export interface QdData {
  budget: number;
  round: number;
  used: number;
  reqs: number;
  nextAlt: number;
  altEvery: number;
  emitters: Array<{ structure: number; restarts: number; es: CmaEsState } | null>;
}

export interface RungWorkData {
  thr: number[];
  warmId: number | null;
  candIds: number[];
}

export interface LadderData {
  step: 'start' | 'easy' | 'medium' | 'done';
  budget: number;
  hardId: number | null;
  gH: number;
  DH: number;
  gMin: number;
  easy: RungWorkData | null;
  medium: RungWorkData | null;
  collapsed: LadderCollapse[];
  job: JobData | null;
}

export interface RunStateData {
  eu: number;
  requests: number;
  cacheHits: number;
  nextId: number;
  stageEU: Record<string, number>;
  goals: GoalSystemState;
  records: SerializedRecord[];
  cacheKeys: string[];
  hist: number[];
  histRows: number;
  earlyIds: number[];
  anchorIds: Array<number | null>;
  leastInfeasibleId: number | null;
  anySafe: boolean;
  incumbentIds: number[];
  groupPool: Array<[string, Array<number | null>]>;
  archive: { activeDims: number[]; elites: Array<number | null>; reserve: Array<number | null> } | null;
  survivors: number[];
  survivorBestIds: number[];
  raceRounds: Array<{ budgetPerStructure: number; survivors: string[] }>;
  ladder: LadderData | null;
  curve: ConvergencePoint[];
  lastProgressEU: number;
  lastCurveEU: number;
  lastCheckpointEU: number;
  wallMs: number;
  /** Phase-local progress of the phase in flight (null at a phase boundary). */
  phaseData: RaceData | AnchorsData | StagesData | QdData | LadderData | null;
}

export interface PlannerCheckpointData {
  version: number;
  /** Fingerprint of the problem and configuration; a resume with a different fingerprint is refused (fresh run). */
  fingerprint: string;
  /** Where it was taken (stage name and step), for display and logs. */
  label: string;
  /** Index of the phase to continue (0 = S0 … 5 = ladder). */
  phase: number;
  euUsed: number;
  state: RunStateData;
}

export function serializeOutput(o: EvalOutput): SerializedOutput {
  const s: SerializedOutput = {
    goals: Array.from(o.goals),
    margins: Array.from(o.margins),
    regulariser: o.regulariser,
    descriptors: Array.from(o.descriptors),
  };
  if (o.features) s.features = Array.from(o.features);
  if (o.cost !== undefined) s.cost = o.cost;
  if (o.aborted) s.aborted = { ...o.aborted };
  return s;
}

export function deserializeOutput(s: SerializedOutput): EvalOutput {
  const o: EvalOutput = {
    goals: Float64Array.from(s.goals),
    margins: Float64Array.from(s.margins),
    regulariser: s.regulariser,
    descriptors: Float64Array.from(s.descriptors),
  };
  if (s.features) o.features = Float64Array.from(s.features);
  if (s.cost !== undefined) o.cost = s.cost;
  if (s.aborted) o.aborted = { ...s.aborted };
  return o;
}

const NONFINITE = '$n';

/** JSON encoding that keeps NaN and ±Infinity (as {"$n": "NaN" | "Infinity" | "-Infinity"}). */
export function encodeCheckpoint(cp: PlannerCheckpointData): string {
  return JSON.stringify(cp, (_k, v: unknown) =>
    typeof v === 'number' && !Number.isFinite(v) ? { [NONFINITE]: String(v) } : v,
  );
}

export function decodeCheckpoint(json: string): PlannerCheckpointData {
  return JSON.parse(json, (_k, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const keys = Object.keys(v);
      if (keys.length === 1 && keys[0] === NONFINITE) return Number((v as Record<string, string>)[NONFINITE]);
    }
    return v;
  }) as PlannerCheckpointData;
}
