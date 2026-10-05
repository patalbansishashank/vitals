import { flattenStages, isoAt, sleepMetrics, type StageSeg } from './importKit';
import type { BioRecord, LocalDate, QualityFlag, SleepRecord, SleepStageInterval } from './types';

/**
 * Pieces of one source this close together are one night: a ring hands its night over in packets, and a packet can start
 * a few minutes after the previous one ended. Lumen Health's rule for the same rings (its `SleepSegmentation`): a gap of
 * an hour or more starts a new session, anything shorter stays in the night.
 */
export const NIGHT_GAP_MS = 60 * 60_000;

/** Fields `sleepMetrics` derives from the stages; a stitched night recomputes all of them. */
const DERIVED: readonly (keyof SleepRecord)[] = ['in_bed_s', 'asleep_s', 'awake_s', 'light_s', 'deep_s', 'rem_s', 'unknown_s', 'latency_s', 'waso_s', 'awakenings', 'efficiency_pct'];

interface Piece<T> {
  entry: T;
  rec: SleepRecord;
  start: number;
  end: number;
  provisional: boolean;
}

/** Where pieces overlap, the better read wins: a complete one over a provisional one, then the later read (version). */
const better = (a: Piece<unknown>, b: Piece<unknown>): number =>
  Number(!a.provisional) - Number(!b.provisional) || a.rec.version - b.rec.version || b.rec.record_id.localeCompare(a.rec.record_id);

/**
 * A partial history read can start halfway through a night and thus have a different content id. Keep immutable
 * deliveries for sync, but expose only maximal sleep coverage per source: a contained provisional session is an older
 * view of its containing session. Complete sessions and disjoint naps remain separate. Resolve before date filtering
 * because a tail read before midnight can have a different wake date from the finished night.
 *
 * Then the pieces of one night are stitched: staged sessions of one source less than `NIGHT_GAP_MS` apart become one
 * session (the ring's packets of a night, read in one go with a short gap between them, or relayed by Lumen one packet
 * per message). Overlapping minutes come from the better read; the totals are recomputed from the joined stages; the
 * night keeps the id of its earliest piece. Where pieces were stitched, `is_main` is recomputed for that source (the
 * longest time asleep per wake date), since the stored flags were set piece by piece.
 */
export function reconcileSleep<T extends { sourceKey: string; record: BioRecord }>(records: readonly T[]): T[] {
  const bySource = new Map<string, Array<Piece<T>>>();
  for (const entry of records) {
    const r = entry.record;
    if (r.kind !== 'sleep') continue;
    const start = Date.parse(r.time.start ?? '');
    const end = Date.parse(r.time.end ?? '');
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const group = bySource.get(entry.sourceKey) ?? [];
    group.push({ entry, rec: r, start, end, provisional: r.quality.flags.includes('provisional_stages') });
    bySource.set(entry.sourceKey, group);
  }
  const superseded = new Set<T>();
  for (const group of bySource.values()) {
    group.sort((a, b) => a.start - b.start || b.end - a.end || Number(a.provisional) - Number(b.provisional)
      || b.entry.record.version - a.entry.record.version || a.entry.record.record_id.localeCompare(b.entry.record.record_id));
    let furthestEnd = -Infinity;
    for (const { entry, end, provisional } of group) {
      if (provisional && end <= furthestEnd) superseded.add(entry);
      furthestEnd = Math.max(furthestEnd, end);
    }
  }

  const replaced = new Map<T, T>();
  for (const group of bySource.values()) {
    // only the latest version of each record id shapes a night or takes part in the main-night choice
    const latest = new Map<string, Piece<T>>();
    const versions = new Map<string, Array<Piece<T>>>();
    for (const p of group) {
      const id = p.rec.record_id;
      versions.set(id, [...(versions.get(id) ?? []), p]);
      const cur = latest.get(id);
      if (!cur || p.rec.version > cur.rec.version) latest.set(id, p);
    }
    const pieces = group.filter((p) => latest.get(p.rec.record_id) === p && !superseded.has(p.entry) && stitchable(p.rec));
    let stitched = false;
    for (const night of nights(pieces)) {
      if (night.length < 2) continue;
      const first = night[0]!;
      replaced.set(first.entry, { ...first.entry, record: stitchedOnce(night, first) });
      for (const p of night) for (const v of versions.get(p.rec.record_id)!) if (v !== first) superseded.add(v.entry);
      stitched = true;
    }
    if (stitched) remain(pieces.filter((p) => !superseded.has(p.entry)), replaced);
  }
  return records.filter((entry) => !superseded.has(entry)).map((entry) => replaced.get(entry) ?? entry);
}

/** A session with stages and times, not an entry by hand: only these are stitched. */
function stitchable(r: SleepRecord): boolean {
  return (r.stages?.length ?? 0) > 0 && r.provenance.channel !== 'manual';
}

/** Groups pieces (sorted by start) into nights: a gap of `NIGHT_GAP_MS` or more starts the next one. */
function nights<T>(pieces: ReadonlyArray<Piece<T>>): Array<Array<Piece<T>>> {
  const out: Array<Array<Piece<T>>> = [];
  let end = -Infinity;
  for (const p of pieces) {
    if (out.length === 0 || p.start - end >= NIGHT_GAP_MS) out.push([]);
    out[out.length - 1]!.push(p);
    end = Math.max(end, p.end);
  }
  return out;
}

/** A stage as instants, with the stored interval it stands for (reused as it is when the night keeps it whole). */
type Own = StageSeg & { src?: SleepStageInterval };
/** Parsed stages per stored record object: the index keeps its records, so a night is parsed once per session. */
const parsed = new WeakMap<SleepRecord, { of: SleepRecord['stages']; segs: Own[] }>();

/** A piece's stages as instants: as stored when they are in order and do not overlap (ring and Lumen nights), else
 * through `flattenStages` (quadratic in the stages, so only when needed). */
function ownStages(r: SleepRecord): Own[] {
  const hit = parsed.get(r);
  if (hit && hit.of === r.stages) return hit.segs;
  let segs: Own[] = (r.stages ?? []).map((src) => ({ s: Date.parse(src.start), e: Date.parse(src.end), stage: src.stage, src }));
  for (let i = 0; i < segs.length; i++) if (!(segs[i]!.e > segs[i]!.s) || (i > 0 && segs[i]!.s < segs[i - 1]!.e)) {
    segs = flattenStages(segs);
    break;
  }
  parsed.set(r, { of: r.stages, segs });
  return segs;
}

/** Stitched nights by their earliest stored piece, kept while the same stored pieces make the night: after a change
 * of the store only the nights it touched are stitched again. Readers never mutate records (the stores clone). */
const nightsOf = new WeakMap<SleepRecord, { pieces: SleepRecord[]; night: SleepRecord }>();

function stitchedOnce<T>(pieces: ReadonlyArray<Piece<T>>, base: Piece<T>): SleepRecord {
  const hit = nightsOf.get(base.rec);
  if (hit && hit.pieces.length === pieces.length && hit.pieces.every((r, i) => r === pieces[i]!.rec)) return hit.night;
  const night = stitch(pieces, base);
  nightsOf.set(base.rec, { pieces: pieces.map((p) => p.rec), night });
  return night;
}

/** One session from the pieces of a night (distinct record ids, latest version each); `base`, the earliest, gives the id. */
function stitch<T>(pieces: ReadonlyArray<Piece<T>>, base: Piece<T>): SleepRecord {
  type Seg = Own & { by: Piece<T> };
  const changes = new Map<number, { add: Seg[]; remove: Seg[] }>();
  const at = (t: number) => {
    let c = changes.get(t);
    if (!c) changes.set(t, (c = { add: [], remove: [] }));
    return c;
  };
  for (const p of pieces) {
    for (const g of ownStages(p.rec)) {
      const seg: Seg = { ...g, by: p };
      at(g.s).add.push(seg);
      at(g.e).remove.push(seg);
    }
  }
  const times = [...changes.keys()].sort((a, b) => a - b);
  const active = new Set<Seg>();
  // `from`: the one stored stage a run comes from (null once it joins two), so a whole one is reused, not re-formatted
  const flat: Array<StageSeg & { from: Seg | null }> = [];
  for (let i = 0; i + 1 < times.length; i++) {
    const t = times[i]!;
    const c = changes.get(t)!;
    for (const s of c.remove) active.delete(s);
    for (const s of c.add) active.add(s);
    let win: Seg | undefined;
    for (const s of active) if (!win || better(s.by, win.by) > 0) win = s;
    if (!win) continue;
    const last = flat[flat.length - 1];
    if (last && last.e === t && last.stage === win.stage) {
      last.e = times[i + 1]!;
      if (last.from !== win) last.from = null;
    } else flat.push({ s: t, e: times[i + 1]!, stage: win.stage, from: win });
  }
  const stages = flat.map((g): SleepStageInterval => (g.from?.src && g.from.s === g.s && g.from.e === g.e ? g.from.src : { start: isoAt(g.s), end: isoAt(g.e), stage: g.stage }));

  const wake = pieces.reduce((a, b) => (b.end > a.end || (b.end === a.end && better(b, a) > 0) ? b : a));
  const longest = pieces.reduce((a, b) => (b.rec.asleep_s > a.rec.asleep_s ? b : a));
  const flags = [...new Set(pieces.flatMap((p) => p.rec.quality.flags))].sort() as QualityFlag[];
  const rec: Record<string, unknown> = { ...base.rec };
  for (const f of DERIVED) delete rec[f];
  // they describe one piece only
  delete rec.raw_codes_chunk;
  delete rec.night;
  const quality = { ...base.rec.quality };
  delete quality.vendor_state;
  return {
    ...(rec as unknown as SleepRecord),
    version: Math.max(...pieces.map((p) => p.rec.version)),
    time: {
      ...base.rec.time,
      start: isoAt(Math.min(...pieces.map((p) => p.start))),
      end: isoAt(wake.end),
      tz_offset_s: wake.rec.time.tz_offset_s,
      local_date: wake.rec.time.local_date,
    },
    provenance: { ...base.rec.provenance, ingested_at: pieces.reduce((m, p) => (p.rec.provenance.ingested_at > m ? p.rec.provenance.ingested_at : m), '') },
    quality: { ...quality, flags },
    ...sleepMetrics(flat),
    stages,
    ...(longest.rec.night ? { night: longest.rec.night } : {}),
  };
}

/** `is_main` per wake date among a source's sessions after stitching: the longest time asleep (ties: earlier start). */
function remain<T extends { sourceKey: string; record: BioRecord }>(pieces: ReadonlyArray<Piece<T>>, replaced: Map<T, T>): void {
  const now = pieces.map((p) => ({ entry: p.entry, rec: (replaced.get(p.entry) ?? p.entry).record as SleepRecord }));
  const best = new Map<LocalDate, SleepRecord>();
  for (const { rec } of now) {
    const b = best.get(rec.time.local_date);
    if (!b || rec.asleep_s > b.asleep_s || (rec.asleep_s === b.asleep_s && (rec.time.start ?? '') < (b.time.start ?? ''))) best.set(rec.time.local_date, rec);
  }
  for (const { entry, rec } of now) {
    const main = best.get(rec.time.local_date) === rec && rec.asleep_s > 0;
    if (rec.is_main === main) continue;
    replaced.set(entry, { ...(replaced.get(entry) ?? entry), record: { ...rec, is_main: main } });
  }
}
