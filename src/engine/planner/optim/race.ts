/**
 * Structure race (PLANNER_V2_SPEC §4.5, R6 §3.1 P2): successive halving over the enumerated structures on the stage-1
 * key. Pure helpers: the per-structure budget of a round and the survivor selection with the diversity guard. The
 * pipeline runs the rounds (probes or interleaved CMA-ES instances) and calls these between rounds.
 */
import type { Key } from './cmaes';
import { compareKeys } from './cmaes';

/** η: one in η structures survives a round (§4.5). */
export const RACE_ETA = 3;

/**
 * Per-structure EU of the current round for an η-geometric schedule: the remaining race budget is split over the
 * remaining rounds in proportion to n_i·η^i (n_i = planned survivors of round i), so every round costs about the same.
 */
export function raceRoundBudget(remaining: number, nNow: number, roundsLeft: number, eta = RACE_ETA): number {
  if (nNow <= 0 || roundsLeft <= 0 || remaining <= 0) return 0;
  let w = 0;
  let n = nNow;
  for (let i = 0; i < roundsLeft; i++) {
    w += n * eta ** i;
    n = Math.ceil(n / eta);
  }
  return Math.floor((remaining * 1) / w);
}

/** One structure's standing after a round. */
export interface RaceEntry {
  structure: number;
  /** Stage-1 key of the structure's best record (null: never evaluated → last). */
  key: Key | null;
  /** Goal classes the structure serves (`PlannerProblem.structureTags`), if any. */
  tags?: readonly string[];
  /** Per goal: key of the structure's best record for that goal alone (v_S, −f_k); used without tags. */
  goalKeys?: readonly (Key | null)[];
  /** Per D tercile (ladder problems): stage-1 key of the structure's best record with D in that tercile. */
  tercileKeys?: readonly (Key | null)[];
}

export interface SurvivorOptions {
  eta?: number;
  /** Structures kept per goal class present (tags) or per goal (no tags). Default 2. */
  perClass?: number;
  /** Keep the best structure of every occupied D tercile (ladder problems). */
  terciles?: boolean;
}

const cmpEntry = (a: RaceEntry, b: RaceEntry): number => {
  if (a.key && b.key) return compareKeys(a.key, b.key) || a.structure - b.structure;
  if (a.key) return -1;
  if (b.key) return 1;
  return a.structure - b.structure;
};

/**
 * Survivors of a round: the top ⌈n/η⌉ by the stage-1 key, plus the diversity guard — ≥ `perClass` structures of every
 * goal class present (by `tags`; without tags: the best `perClass` structures of every goal by that goal alone) and the
 * best structure of every occupied D tercile. Returned in structure order (the interleaving order of the next round).
 */
export function raceSurvivors(entries: readonly RaceEntry[], opts: SurvivorOptions = {}): number[] {
  const eta = opts.eta ?? RACE_ETA;
  const per = opts.perClass ?? 2;
  const ranked = [...entries].sort(cmpEntry);
  const keep = new Set<number>();
  const top = Math.ceil(ranked.length / eta);
  for (let i = 0; i < top; i++) keep.add(ranked[i]!.structure);
  const tagged = ranked.some((e) => (e.tags?.length ?? 0) > 0);
  if (tagged) {
    const tags = [...new Set(ranked.flatMap((e) => e.tags ?? []))].sort();
    for (const t of tags) {
      let n = ranked.filter((e) => keep.has(e.structure) && e.tags?.includes(t)).length;
      for (const e of ranked) {
        if (n >= per) break;
        if (!keep.has(e.structure) && e.tags?.includes(t)) {
          keep.add(e.structure);
          n++;
        }
      }
    }
  } else {
    const K = Math.max(0, ...ranked.map((e) => e.goalKeys?.length ?? 0));
    for (let k = 0; k < K; k++) {
      const byGoal = ranked
        .filter((e) => e.goalKeys?.[k])
        .sort((a, b) => compareKeys(a.goalKeys![k]!, b.goalKeys![k]!) || a.structure - b.structure);
      for (let i = 0; i < Math.min(per, byGoal.length); i++) keep.add(byGoal[i]!.structure);
    }
  }
  if (opts.terciles) {
    for (let t = 0; t < 3; t++) {
      let best: RaceEntry | null = null;
      for (const e of ranked) {
        const k = e.tercileKeys?.[t];
        if (!k) continue;
        if (!best || compareKeys(k, best.tercileKeys![t]!) < 0) best = e;
      }
      if (best) keep.add(best.structure);
    }
  }
  return [...keep].sort((a, b) => a - b);
}

/** D tercile of a difficulty value (0: [0, ⅓), 1: [⅓, ⅔), 2: [⅔, 1]). */
export function dTercile(D: number): number {
  if (!(D >= 1 / 3)) return 0;
  return D < 2 / 3 ? 1 : 2;
}
