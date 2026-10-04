/** Assembles a `ScoreInput` for one date from a `BioStore` (tier H: reads the store; the scores themselves stay pure). */
import { addDays } from '../core/scores/util';
import { resolveDays } from '../core/resolve';
import { policyOf, policyStreamOf } from '../core/source';
import type { BioStream, DeviceTier, Instant, LocalDate, ScoreInput, ScoreProfile, ScoreResult } from '../core/types';
import { RAW_STREAMS } from '../core/types';
import type { BioStore } from '../store/types';

export interface ScoreInputOpts {
  localDate: LocalDate;
  tz: string;
  profile?: ScoreProfile;
  computedAt: Instant;
  build: string;
  /** Days of resolved daily history before `localDate` (default 90). */
  historyDays?: number;
  /** Days of raw series before `localDate` (default 2: covers last night). */
  seriesDays?: number;
  /** Raw streams to load (default: none, since series are large; scores name what they need). */
  streams?: readonly BioStream[];
  /** Scores whose earlier results the target depends on. */
  priorScoreIds?: readonly string[];
  /** Exclude sources whose StreamPolicy for the data says scores:false (default true). A source with no entry for a stream is included. */
  respectPolicies?: boolean;
}

export async function buildScoreInput(store: BioStore, o: ScoreInputOpts): Promise<ScoreInput> {
  const from = addDays(o.localDate, -(o.historyDays ?? 90));
  const respect = o.respectPolicies ?? true;
  const sources = await store.sources();
  const doc = new Map(sources.map((s) => [s.sourceKey, s]));
  const allowed = (sourceKey: string, stream: Parameters<typeof policyOf>[1]): boolean => {
    if (!respect) return true;
    const p = policyOf(doc.get(sourceKey)?.policies, stream);
    return p === undefined ? true : p.scores;
  };

  const recs = (await store.records({ from, to: o.localDate })).filter((r) => allowed(r.sourceKey, policyStreamOf(r.record)));
  const days = resolveDays(recs, sources, { from, to: o.localDate }, await store.corrections());

  const series: ScoreInput['series'] = {};
  const sFrom = addDays(o.localDate, -(o.seriesDays ?? 2));
  for (const stream of o.streams ?? []) {
    if (!(RAW_STREAMS as readonly string[]).includes(stream) && !stream.startsWith('vendor:')) continue;
    const samples = await store.samples({ stream, from: sFrom, to: o.localDate });
    const rows = samples
      .filter((s) => allowed(s.sourceKey, stream))
      .map((s) => ({ t: s.t, value: s.value, tier: (doc.get(s.sourceKey)?.tier ?? 'C') as DeviceTier, sourceKey: s.sourceKey }));
    if (rows.length > 0) series[stream] = rows;
  }

  const prior: Record<string, ScoreResult[]> = {};
  for (const id of o.priorScoreIds ?? []) {
    // latest version per scope date, ascending, strictly before the day being scored's end
    const rs = await store.scores({ scoreId: id, from, to: o.localDate });
    const latest = new Map<string, ScoreResult>();
    for (const r of rs) {
      const k = `${r.scope.kind}:${r.scope.localDate}:${r.scope.workoutId ?? ''}`;
      const prev = latest.get(k);
      if (!prev || r.version.localeCompare(prev.version, undefined, { numeric: true }) > 0) latest.set(k, r);
    }
    prior[id] = [...latest.values()].sort((a, b) => a.scope.localDate.localeCompare(b.scope.localDate));
  }

  return {
    localDate: o.localDate,
    tz: o.tz,
    profile: o.profile ?? {},
    days,
    series,
    workouts: days.flatMap((d) => d.workouts),
    prior,
    computedAt: o.computedAt,
    build: o.build,
  };
}
