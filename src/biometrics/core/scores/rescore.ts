/**
 * Rescoring plan and per-day execution (SUITE_SPEC §4.4 "Rescoring"). Tier P.
 * A new def version, or changed inputs, means (scoreId@version, date) pairs to compute; the most recent 90 days go
 * first; old versions are never deleted and stay side by side in the cache.
 */
import type { LocalDate, ScoreDef, ScoreInput, ScoreResult } from '../types';
import { addDays, daysBetween, withheld } from './util';

export const RECENT_FIRST_DAYS = 90;

/** Compares semver-like strings numerically (1.10.0 > 1.9.0). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split(/[.+-]/).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** Highest version per scoreId. */
export function latestVersions(defs: readonly ScoreDef[]): Map<string, ScoreDef> {
  const out = new Map<string, ScoreDef>();
  for (const d of defs) {
    const cur = out.get(d.scoreId);
    if (!cur || compareVersions(d.version, cur.version) > 0) out.set(d.scoreId, d);
  }
  return out;
}

/** Topological order by `dependsOn` (ids; dependencies absent from `defs` are ignored). Ties keep input order. Throws on a cycle. */
export function scoreOrder(defs: readonly ScoreDef[]): ScoreDef[] {
  const ids = new Set(defs.map((d) => d.scoreId));
  const deps = (d: ScoreDef) => (d.dependsOn ?? []).filter((x) => ids.has(x) && x !== d.scoreId);
  const placed = new Set<string>();
  const out: ScoreDef[] = [];
  let rest = [...defs];
  while (rest.length) {
    const ready = rest.filter((d) => deps(d).every((x) => placed.has(x)));
    if (!ready.length) throw new Error(`score dependency cycle among: ${rest.map((d) => d.scoreId).join(', ')}`);
    // Place every version of an id together once its dependencies are placed.
    for (const d of ready) out.push(d);
    for (const d of ready) placed.add(d.scoreId);
    const readySet = new Set(ready);
    rest = rest.filter((d) => !readySet.has(d));
  }
  return out;
}

export interface RescoreTask {
  scoreId: string;
  version: string;
  localDate: LocalDate;
  reason: 'missing' | 'new_version' | 'verify';
}

export interface PlanOpts {
  /** Reference date for "most recent 90 days first". Default: the latest date given. */
  today?: LocalDate;
  /** Also re-run pairs that are cached (to detect changed inputs through `inputsHash`). Default false. */
  verify?: boolean;
  /** Dates whose raw inputs are known to have changed (records/chunks upserted): cached pairs on them are re-run. */
  dirtyDates?: ReadonlySet<LocalDate>;
}

/**
 * Pairs to compute: every (def, date) with no cached result of that exact id@version is `missing`
 * (`new_version` when other versions of the id are cached, i.e. a version bump); cached pairs are included only for
 * dirty dates or `verify`. Order: dates within `today − 90` newest first, then older dates newest first;
 * per date in dependency order.
 */
export function planRescore(defs: readonly ScoreDef[], cached: readonly ScoreResult[], dates: readonly LocalDate[], opts: PlanOpts = {}): RescoreTask[] {
  const have = new Set<string>();
  const idsCached = new Set<string>();
  for (const r of cached) {
    have.add(`${r.scoreId}@${r.version}|${r.scope.localDate}`);
    idsCached.add(r.scoreId);
  }
  const uniq = [...new Set(dates)].sort().reverse();
  const today = opts.today ?? uniq[0];
  const recent = today === undefined ? [] : uniq.filter((d) => daysBetween(d, today) < RECENT_FIRST_DAYS);
  const older = uniq.filter((d) => !recent.includes(d));
  const ordered = scoreOrder(defs);
  const tasks: RescoreTask[] = [];
  for (const date of [...recent, ...older]) {
    for (const d of ordered) {
      const isCached = have.has(`${d.scoreId}@${d.version}|${date}`);
      if (!isCached) tasks.push({ scoreId: d.scoreId, version: d.version, localDate: date, reason: idsCached.has(d.scoreId) ? 'new_version' : 'missing' });
      else if (opts.verify || opts.dirtyDates?.has(date)) tasks.push({ scoreId: d.scoreId, version: d.version, localDate: date, reason: 'verify' });
    }
  }
  return tasks;
}

/** Latest-version results of `id` strictly before `date`, ascending, for `prior`. */
export function priorWindow(results: readonly ScoreResult[], beforeOrOn: LocalDate, days = 90): ScoreResult[] {
  const from = addDays(beforeOrOn, -days);
  return results.filter((r) => r.scope.localDate >= from && r.scope.localDate <= beforeOrOn).sort((a, b) => (a.scope.localDate < b.scope.localDate ? -1 : a.scope.localDate > b.scope.localDate ? 1 : 0));
}

/**
 * Runs `defs` for one day in dependency order. `inputFor(def)` supplies the base ScoreInput (series, days, history prior);
 * results of earlier defs in this call are appended to `prior[scoreId]` for later ones. A throwing def yields a
 * withheld result with the error as the reason, so one bad score never aborts the day.
 */
export function computeDay(defs: readonly ScoreDef[], inputFor: (def: ScoreDef) => ScoreInput): ScoreResult[] {
  const out: ScoreResult[] = [];
  const todays: Record<string, ScoreResult> = {};
  const latest = latestVersions(defs);
  for (const def of scoreOrder(defs)) {
    const base = inputFor(def);
    const prior: Record<string, ScoreResult[]> = { ...base.prior };
    for (const dep of def.dependsOn ?? []) {
      const t = todays[dep];
      if (t && !(prior[dep] ?? []).some((r) => r.scope.localDate === t.scope.localDate && r.scope.workoutId === t.scope.workoutId && r.version === t.version)) {
        prior[dep] = [...(prior[dep] ?? []), t];
      }
    }
    const input: ScoreInput = { ...base, prior };
    let r: ScoreResult;
    try {
      r = def.compute(input);
    } catch (e) {
      r = withheld(def.scoreId, def.version, input, `error: ${e instanceof Error ? e.message : String(e)}`);
    }
    out.push(r);
    // Dependents see the latest version of each id.
    if (latest.get(def.scoreId) === def) todays[def.scoreId] = r;
  }
  return out;
}
