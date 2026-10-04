/**
 * Rescoring job (tier H): recomputes score history for new def versions or changed inputs, newest 90 days first,
 * interruptible via AbortSignal. Results go to `store.putScore`; old versions stay in the cache next to new ones.
 */
import { addDays, daysBetween } from '../core/scores/util';
import { computeDay, latestVersions, planRescore, priorWindow, scoreOrder } from '../core/scores/rescore';
import type { BioStream, Instant, LocalDate, ScoreDef, ScoreInput, ScoreProfile, ScoreResult } from '../core/types';
import { RAW_STREAMS } from '../core/types';
import type { BioStore } from '../store/types';
import { buildScoreInput } from './scoreInput';

export interface RescoreOpts {
  defs: readonly ScoreDef[];
  from: LocalDate;
  to: LocalDate;
  now: Instant;
  build: string;
  tz?: string;
  profile?: ScoreProfile;
  signal?: AbortSignal;
  onProgress?: (p: { done: number; total: number; written: number; skipped: number }) => void;
  /** 'missing' computes only absent (id@version, date) pairs; 'verify' (default) recomputes all and writes only changed inputsHash. */
  mode?: 'missing' | 'verify';
  /** Days of raw series loaded per day (default 2). */
  seriesDays?: number;
}

export interface RescoreReport {
  planned: number;
  computed: number;
  written: number;
  /** computed but identical inputsHash and status already cached: not rewritten */
  skipped: number;
  aborted: boolean;
  /** Days left unscored this run because their input could not be read (a synced chunk whose bytes are not
   * reachable yet); the other days are scored. The caller tries these again later. */
  unavailable?: LocalDate[];
}

function rawStreamsOf(defs: readonly ScoreDef[]): BioStream[] {
  const out = new Set<BioStream>();
  for (const d of defs) for (const i of d.inputs) if ((RAW_STREAMS as readonly string[]).includes(i.stream)) out.add(i.stream as BioStream);
  return [...out];
}

export async function rescoreHistory(store: BioStore, o: RescoreOpts): Promise<RescoreReport> {
  const tz = o.tz ?? 'UTC';
  const defs = [...o.defs];
  const ordered = scoreOrder(defs);
  const streams = rawStreamsOf(defs);
  const latest = latestVersions(defs);

  // Days that have any data in range are the scoring days.
  const recs = await store.records({ from: o.from, to: o.to });
  const dates = [...new Set(recs.map((r) => r.record.time.local_date))].filter((d) => d >= o.from && d <= o.to).sort();
  const cached = await store.scores({ from: o.from, to: o.to });
  const tasks = planRescore(ordered, cached, dates, { today: o.to, verify: (o.mode ?? 'verify') === 'verify' });
  const cachedByKey = new Map(cached.map((r) => [`${r.scoreId}@${r.version}|${r.scope.localDate}`, r]));

  // In-memory results of this job by id@version|date, so dependents (e.g. load.ewma) see freshly computed priors
  // even for dates the plan has not reached yet.
  const memo = new Map<string, ScoreResult[]>();
  const key = (d: ScoreDef, date: LocalDate) => `${d.scoreId}@${d.version}|${date}`;
  const rep: RescoreReport = { planned: tasks.length, computed: 0, written: 0, skipped: 0, aborted: false };
  const depDefs = (def: ScoreDef): ScoreDef[] => (def.dependsOn ?? []).map((id) => latest.get(id)).filter((x): x is ScoreDef => !!x);

  const dayResults = new Map<LocalDate, Promise<void>>();
  const ensureDay = (date: LocalDate): Promise<void> => {
    let p = dayResults.get(date);
    if (!p) {
      p = (async () => {
        // Build the input once per (day, def) group; earlier days first so dependents find their priors.
        const results = await computeDate(date);
        for (const r of results) memo.set(`${r.scoreId}@${r.version}|${date}`, [r]);
      })();
      dayResults.set(date, p);
    }
    return p;
  };

  const needsPriors = ordered.some((d) => (d.dependsOn ?? []).length > 0);
  const priorDates = (date: LocalDate) => dates.filter((d) => d < date && daysBetween(d, date) <= 90);

  async function computeDate(date: LocalDate): Promise<ScoreResult[]> {
    // Dependencies' history first (ascending), so `prior` is complete whatever order the plan visits dates in.
    if (needsPriors) for (const d of priorDates(date)) await ensureDay(d).catch(() => undefined);
    const base: ScoreInput = await buildScoreInput(store, {
      localDate: date, tz, ...(o.profile ? { profile: o.profile } : {}), computedAt: o.now, build: o.build,
      streams, seriesDays: o.seriesDays ?? 2,
    });
    const results = computeDay(defs, (def) => {
      const prior: Record<string, ScoreResult[]> = {};
      for (const dep of depDefs(def)) {
        const hist: ScoreResult[] = [];
        for (const d of priorDates(date)) for (const r of memo.get(key(dep, d)) ?? []) hist.push(r);
        prior[dep.scoreId] = priorWindow(hist, addDays(date, -1));
      }
      return { ...base, prior };
    });
    // a corrected day's scores name the correction among their sources (SUITE_SPEC §14.6)
    const corrected = base.days.find((d) => d.localDate === date)?.corrections.map((c) => c.correctionId) ?? [];
    return corrected.length ? results.map((r) => ({ ...r, sourceIds: [...new Set([...r.sourceIds, ...corrected])] })) : results;
  }

  const wantedDates = [...new Set(tasks.map((t) => t.localDate))];
  const wanted = new Set(tasks.map((t) => `${t.scoreId}@${t.version}|${t.localDate}`));
  let done = 0;
  for (const date of wantedDates) {
    if (o.signal?.aborted) { rep.aborted = true; break; }
    try {
      await ensureDay(date);
    } catch {
      // one unreadable day (bytes still on their way from the sync server) must not cost every other day its scores
      (rep.unavailable ??= []).push(date);
      done++;
      continue;
    }
    for (const d of ordered) {
      const k = key(d, date);
      if (!wanted.has(k)) continue;
      const r = memo.get(k)?.[0];
      if (!r) continue;
      rep.computed++;
      const c = cachedByKey.get(k);
      if (c && c.inputsHash === r.inputsHash && c.status === r.status && c.value === r.value && c.sourceIds.join('\u0000') === r.sourceIds.join('\u0000')) rep.skipped++;
      else {
        await store.putScore(r);
        rep.written++;
      }
    }
    done++;
    o.onProgress?.({ done, total: wantedDates.length, written: rep.written, skipped: rep.skipped });
  }
  return rep;
}
