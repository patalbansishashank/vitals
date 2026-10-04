/**
 * Pure helpers shared by the file importers and `mapEventsToBatch` (tier P: no clock, no Intl, no IO).
 * Time zones are handled as fixed offsets (seconds east of UTC) taken from the source data.
 */
import { recordId } from './hash';
import type { BioChannel, BioProvenance, BioQuality, QualityFlag, SleepRecord, SleepStageInterval, SleepStageName } from './types';

/** 'YYYY-MM-DD' of an instant at a fixed UTC offset. */
export function localDateAt(epochMs: number, offsetS: number): string {
  return new Date(epochMs + offsetS * 1000).toISOString().slice(0, 10);
}

/** ISO-8601 UTC, ms precision. */
export const isoAt = (epochMs: number): string => new Date(epochMs).toISOString();

/** '+0100' | '-05:30' | '+01' | 'Z' -> seconds east of UTC; null when unparseable. */
export function parseOffset(s: string): number | null {
  if (s === 'Z' || s === 'z') return 0;
  const m = /^([+-])(\d{2}):?(\d{2})?$/.exec(s);
  if (!m) return null;
  const v = Number(m[2]) * 3600 + Number(m[3] ?? 0) * 60;
  return m[1] === '-' ? -v : v;
}

export interface ParsedStamp {
  /** epoch ms UTC */
  t: number;
  /** seconds east of UTC as written in the string */
  offsetS: number;
  /** 'YYYY-MM-DD' as written (local) */
  localDate: string;
  /** true when the string carried no time part (date only) or the time is exactly 00:00:00 */
  midnight: boolean;
}

const STAMP = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?\s*(Z|[+-]\d{2}:?\d{2}|[+-]\d{2})?$/;

/** Parses 'YYYY-MM-DD HH:MM:SS ±HHMM' (Apple, Health Auto Export) and ISO-8601 with offset or Z. A string without an
 * offset is read at `fallbackOffsetS`. Returns null when it does not match. */
export function parseStamp(s: string, fallbackOffsetS = 0): ParsedStamp | null {
  const m = STAMP.exec(s.trim());
  if (!m) return null;
  const off = m[8] ? parseOffset(m[8]) : fallbackOffsetS;
  if (off === null) return null;
  const hh = Number(m[4] ?? 0);
  const mi = Number(m[5] ?? 0);
  const ss = Number(m[6] ?? 0);
  const ms = m[7] ? Math.round(Number(`0.${m[7]}`) * 1000) : 0;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hh, mi, ss, ms) - off * 1000;
  if (!Number.isFinite(t)) return null;
  return { t, offsetS: off, localDate: `${m[1]}-${m[2]}-${m[3]}`, midnight: hh === 0 && mi === 0 && ss === 0 && ms === 0 };
}

export function qualityOf(validation: BioQuality['validation'], flags: QualityFlag[] = [], extra: Partial<BioQuality> = {}): BioQuality {
  return { validation, confidence: null, flags: [...new Set(flags)].sort(), ...extra };
}

export function provenanceOf(
  channel: BioChannel,
  ingestedAt: string,
  p: Partial<Omit<BioProvenance, 'channel' | 'ingested_at'>> = {},
): BioProvenance {
  return { channel, recording_method: 'automatic', modality: 'sensed', ...p, ingested_at: ingestedAt };
}

// ---------------------------------------------------------------- sleep derivation

export interface StageSeg {
  /** epoch ms */
  s: number;
  e: number;
  stage: SleepStageName;
}

/** Higher wins where intervals from one source overlap (e.g. Apple InBed under AsleepCore). */
const PRIORITY: Record<SleepStageName, number> = {
  rem: 6, deep: 6, light: 6, asleep_unspecified: 5, awake: 4, out_of_bed: 3, awake_in_bed: 2, unknown: 1,
};
const ASLEEP: ReadonlySet<SleepStageName> = new Set(['rem', 'deep', 'light', 'asleep_unspecified']);
const WAKE: ReadonlySet<SleepStageName> = new Set(['awake', 'awake_in_bed', 'out_of_bed']);

export const isAsleepStage = (s: SleepStageName): boolean => ASLEEP.has(s);

/** Resolves overlaps (highest-priority stage wins), sorts, and merges adjacent equal stages. Gaps stay gaps. */
export function flattenStages(segs: StageSeg[]): StageSeg[] {
  const valid = segs.filter((g) => g.e > g.s);
  if (valid.length === 0) return [];
  const cuts = [...new Set(valid.flatMap((g) => [g.s, g.e]))].sort((a, b) => a - b);
  const out: StageSeg[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const a = cuts[i]!;
    const b = cuts[i + 1]!;
    let best: StageSeg | null = null;
    for (const g of valid) {
      if (g.s <= a && g.e >= b && (best === null || PRIORITY[g.stage] > PRIORITY[best.stage])) best = g;
    }
    if (!best) continue;
    const last = out[out.length - 1];
    if (last && last.e === a && last.stage === best.stage) last.e = b;
    else out.push({ s: a, e: b, stage: best.stage });
  }
  return out;
}

export interface SleepMetrics {
  in_bed_s: number;
  asleep_s: number;
  awake_s: number;
  light_s: number;
  deep_s: number;
  rem_s: number;
  unknown_s: number;
  latency_s?: number;
  waso_s: number;
  awakenings: number;
  efficiency_pct?: number;
}

const sec = (ms: number): number => Math.round(ms / 1000);

/** Session metrics from a flattened timeline. in_bed = time covered by any interval; awake = awake + awake_in_bed +
 * out_of_bed; waso = wake time between first and last asleep interval; latency only when the session opens awake;
 * awakenings = wake runs between first and last asleep interval. */
export function sleepMetrics(flat: StageSeg[]): SleepMetrics {
  let inBed = 0, asleep = 0, awake = 0, light = 0, deep = 0, rem = 0, unknown = 0;
  for (const g of flat) {
    const d = g.e - g.s;
    inBed += d;
    if (isAsleepStage(g.stage)) asleep += d;
    else if (WAKE.has(g.stage)) awake += d;
    else unknown += d;
    if (g.stage === 'light') light += d;
    else if (g.stage === 'deep') deep += d;
    else if (g.stage === 'rem') rem += d;
  }
  const first = flat.findIndex((g) => isAsleepStage(g.stage));
  let lastIdx = -1;
  for (let i = flat.length - 1; i >= 0; i--) if (isAsleepStage(flat[i]!.stage)) { lastIdx = i; break; }
  let waso = 0, awakenings = 0;
  let run = false;
  if (first >= 0) {
    for (let i = first; i <= lastIdx; i++) {
      const g = flat[i]!;
      if (WAKE.has(g.stage)) {
        waso += g.e - g.s;
        if (!run) awakenings++;
        run = true;
      } else if (isAsleepStage(g.stage)) run = false;
    }
  }
  const m: SleepMetrics = {
    in_bed_s: sec(inBed), asleep_s: sec(asleep), awake_s: sec(awake), light_s: sec(light), deep_s: sec(deep), rem_s: sec(rem),
    unknown_s: sec(unknown), waso_s: sec(waso), awakenings,
  };
  if (first > 0 && flat[0] && WAKE.has(flat[0].stage)) m.latency_s = sec(flat[first]!.s - flat[0].s);
  if (inBed > 0) m.efficiency_pct = Math.round((asleep / inBed) * 1000) / 10;
  return m;
}

export function toIntervals(flat: StageSeg[]): SleepStageInterval[] {
  return flat.map((g) => ({ start: isoAt(g.s), end: isoAt(g.e), stage: g.stage }));
}

/** Groups segments into sessions: a new session starts when a segment begins more than `gapMs` after the running end.
 * Input need not be sorted. */
export function splitSessions(segs: StageSeg[], gapMs: number): StageSeg[][] {
  const sorted = [...segs].sort((a, b) => a.s - b.s || a.e - b.e);
  const out: StageSeg[][] = [];
  let cur: StageSeg[] = [];
  let end = -Infinity;
  for (const g of sorted) {
    if (cur.length > 0 && g.s - end > gapMs) {
      out.push(cur);
      cur = [];
      end = -Infinity;
    }
    cur.push(g);
    end = Math.max(end, g.e);
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

/** One sleep record from a (possibly unflattened) session. `sourceKey` scopes the record id; `nativeId` (when the source
 * has one) makes the id independent of the interval boundaries. wake date = local date of the last interval end. */
export function buildSleepRecord(o: {
  segs: StageSeg[];
  offsetS: number;
  sourceKey: string;
  nativeId?: string;
  provenance: BioProvenance;
  quality: BioQuality;
  isMain: boolean;
  version?: number;
}): SleepRecord | null {
  const flat = flattenStages(o.segs);
  if (flat.length === 0) return null;
  const start = flat[0]!.s;
  const end = flat[flat.length - 1]!.e;
  const m = sleepMetrics(flat);
  const rec: SleepRecord = {
    kind: 'sleep',
    record_id: recordId({ source: o.sourceKey, nativeId: o.nativeId, kind: 'sleep', metric: 'session', start: isoAt(start) }),
    version: o.version ?? 1,
    time: { start: isoAt(start), end: isoAt(end), tz_offset_s: o.offsetS, local_date: localDateAt(end, o.offsetS) },
    provenance: o.nativeId ? { ...o.provenance, native_id: o.nativeId } : o.provenance,
    quality: o.quality,
    is_main: o.isMain,
    ...m,
    stages: toIntervals(flat),
  };
  return rec;
}
