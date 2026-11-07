/**
 * The store side of the Gauge derivations (energy SPEC §S2): reads the person's `lumen.db` through S1's read helpers
 * (`readIntervals`, `readMetricSamples`: overlap, stable order, every page) and feeds the pure algorithms
 * (`./stepFusion.ts`, `./hrSupport.ts`, `./sleepMetrics.ts`, `./baselines.ts`, `./dayMetrics.ts`, `./timeline.ts`).
 *
 * - Physiological derivations never run on truncated input: every helper pages until the last page.
 * - Each derivation notes the event ids it read in an `Inputs`; `inputsHash` hashes them (an event id names one
 *   revision) with the algorithm versions, so a revision or a deletion changes the hash, and the route's ETag with it.
 * - Ring step evidence: the `ring_steps` minute detail (native support) wins over legacy `activity_bucket` rows for the
 *   same minutes. A legacy row's duration is unknown, so it is never placed in fusion: it stays readable as the ring's
 *   bucket sums (`gauge_activity`) and as `legacyRingSteps`, and the ring's daily total covers it as unlocated evidence.
 */
import { createHash } from 'node:crypto';
import { computeBaselines, type NightSummary } from './baselines.ts';
import { declaredCadenceS, median, supportSegments, type Sample } from './hrSupport.ts';
import { LEGACY_SUPPORT } from './lumenMigrate.ts';
import type { HcRecordType, IntervalRow, LumenStore, MetricSample, Page, SpanCategory } from './lumenStore.ts';
import { dayBounds, localDate, offsetMinutes, zonedMs } from './lumenTools.ts';
import { sleepMetrics, type SleepMetrics, type Stage } from './sleepMetrics.ts';
import type { HcStream } from './timeline.ts';
import { fusedDays, fuseSteps, type FusedDay, type FusionContext, type FusionResult, type StepRecord, type StepSupport } from './stepFusion.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MIN = 60_000;
const PAGE = 10_000;
const MAX_PAGES = 500;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The event ids a derivation read (each id is one revision of one record). */
export class Inputs {
  private readonly ids = new Set<string>();
  add(id: string): void {
    this.ids.add(id);
  }
  addAll(rows: Iterable<{ id: string }>): void {
    for (const r of rows) this.ids.add(r.id);
  }
  get size(): number {
    return this.ids.size;
  }
  /** `sha256:<32 hex>` over the sorted ids and the algorithm versions. */
  hash(versions: readonly string[]): string {
    const h = createHash('sha256').update(JSON.stringify([...versions].sort()));
    for (const id of [...this.ids].sort()) h.update(`\n${id}`);
    return `sha256:${h.digest('hex').slice(0, 32)}`;
  }
}

/**
 * The most rows one tool call may read through `readAll` (r063 SRV): better-sqlite3 has no statement timeout or progress
 * handler, and every read runs on the server's main thread, so a call that would read more is refused (the caller asks
 * for a shorter range) instead of stalling every other request. About a second of work on the OCI ARM box; a 90-day
 * range of minute data fits.
 */
export const READ_BUDGET_ROWS = 300_000;

/** A tool call would read more than `READ_BUDGET_ROWS` rows: the tools answer `invalid_input` (narrow the range). */
export class ReadBudgetError extends Error {
  constructor() {
    super('That range holds too many readings to derive from at once; ask for a shorter range.');
    this.name = 'ReadBudgetError';
  }
}

let budget: { left: number } | null = null;

/** Runs `f` with a fresh row budget (`lumenToolSet` wraps each tool call in one; nested calls share the outer budget). */
export function withReadBudget<T>(f: () => T, rows = READ_BUDGET_ROWS): T {
  if (budget) return f();
  budget = { left: rows };
  try {
    return f();
  } finally {
    budget = null;
  }
}

/**
 * (r063 FX2, final review sR13/aR17) Counts `n` rows (or expanded payload entries) a derivation read outside `readAll`
 * against the call's budget: every synchronous read of a tool call is inside it, not only the paged helpers.
 */
export function chargeReadBudget(n: number): void {
  if (!budget || !(n > 0)) return;
  budget.left -= n;
  if (budget.left < 0) throw new ReadBudgetError();
}

/** Every page of a read helper (an error rather than a silent cut past 5 million rows, or past the call's row budget). */
export function readAll<T>(read: (cursor: string | null) => Page<T>): T[] {
  const out: T[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < MAX_PAGES; i++) {
    const p = read(cursor);
    chargeReadBudget(p.rows.length);
    out.push(...p.rows);
    if (!p.next) return out;
    cursor = p.next;
  }
  throw new Error('Too many rows to derive from; narrow the range.');
}

export const intervalsAll = (store: LumenStore, category: SpanCategory, fromMs: number, toMs: number, o: { recordType?: HcRecordType } = {}): IntervalRow[] =>
  readAll((cursor) => store.readIntervals(category, fromMs, toMs, { cursor, limit: PAGE, ...(o.recordType ? { recordType: o.recordType } : {}) }));

export const samplesAll = (store: LumenStore, kind: string, fromMs: number, toMs: number): MetricSample[] =>
  readAll((cursor) => store.readMetricSamples(kind, fromMs, toMs, { cursor, limit: PAGE }));

/** A metric's readings in `[fromMs, toMs)` as samples with their declared cadence (`cadence_s`, or the workout stream's 10 s). */
export function metricSamples(store: LumenStore, kind: string, fromMs: number, toMs: number, inputs: Inputs): Sample[] {
  const rows = samplesAll(store, kind, fromMs, toMs);
  inputs.addAll(rows);
  // (r063 FX2 sR13/aR17) the declared cadences of the CURRENT readings only (the rows just read, never their older
  // versions), counted in the call's row budget; nothing to look up without readings
  const cad = rows.length === 0 ? [] : store.all<{ id: string; c: number | null }>(
    `SELECT id, json_extract(data, '$.cadence_s') AS c FROM current_events WHERE category IN (?, ?) AND observed_ms >= ? AND observed_ms < ? AND json_extract(data, '$.cadence_s') IS NOT NULL`,
    `metrics/${kind}`, `vendor/${kind.replace(/^vendor\./, '')}`, fromMs, toMs);
  chargeReadBudget(cad.length);
  const declared = new Map(cad.map((r) => [r.id, r.c]));
  return rows.filter((r) => num(r.value) !== null).map((r) => ({ tMs: r.tMs, value: r.value!, cadenceS: declaredCadenceS(r.provenance, declared.get(r.id)), id: r.id }));
}

/** Local clock minutes since midnight. */
export const localMinutes = (ms: number, tz: string) => (((ms + offsetMinutes(ms, tz) * MIN) % DAY) + DAY) % DAY / MIN;

export const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function datesBetween(fromDate: string, toDate: string): string[] {
  const out: string[] = [];
  for (let d = fromDate; d <= toDate && out.length < 1000; d = addDays(d, 1)) out.push(d);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Steps

export interface RingBucket {
  id: string;
  startMs: number;
  /** Null for a legacy row (unknown duration). */
  endMs: number | null;
  steps: number;
  distanceM: number;
  installationId: string;
  support: string;
}

export interface StepEvidence {
  records: StepRecord[];
  /** Native ring detail and the legacy rows no native row shadows: the ring's buckets as `gauge_activity` sums them. */
  ringBuckets: RingBucket[];
  zeroWindows: Array<{ lineage: 'phone'; source: string; startMs: number; endMs: number }>;
  /** `detector`: what the interval declared about its step detector (absent before Gauge 2.8.1). */
  phoneAcquisition: Array<{ startMs: number; endMs: number; state: string; detector?: 'registered' | 'unregistered' }>;
}

const phoneSupport = (s: unknown): StepSupport => (s === 'minute' ? 'minute' : 'counterSpan');

/**
 * (r063 A9, r063/GAUGE-CONTRACT.md item 2) What a Gauge 2.8.1+ `listening` interval declares about its step detector:
 * `registered` (`observed_zero: true`, i.e. `detector: "registered"`), `unregistered` (`detector` `absent` or `failed`,
 * `observed_zero: false`), or null when it declares nothing (before 2.8.1, or another state).
 */
export function detectorOf(data: Record<string, unknown>): 'registered' | 'unregistered' | null {
  if (data.observed_zero === true || data.detector === 'registered') return 'registered';
  if (data.observed_zero === false || data.detector === 'absent' || data.detector === 'failed') return 'unregistered';
  return null;
}
/**
 * (r068 walk) The phone's detector-timed minutes at the counter's count. Gauge (before 2.8.5) cut each counter delta Δ
 * (`parent_steps`) at wall-clock minutes and gave each piece the step detector's events in it, whenever the detector's
 * count sat within `max(3, 10 %)` of Δ. On the owner's phone the counter reports about once a second (Δ 1–4) while the
 * detector gives about one event a second, so a span of Δ = 2 went up as 1 step: the evening walk of 2026-10-28 read
 * 2,615 phone steps where the counter's deltas add up to 4,181 (and the ring's best minutes read 94–96 a minute, as the
 * counter's do; the detector's never passed 61).
 *
 * The pieces of one span are found again: the same boot and `parent_steps`, each piece starting where the one before
 * ended (`m_start_ns` = its `m_end_ns`, `start` = its `end`) on a wall-clock minute. A span read whole (its first piece
 * does not start on a minute, its last does not end on one: a cut always falls on a minute) gets Δ shared over its pieces
 * by the detector's events (largest remainder; by time when the detector gave none). Gauge 2.8.5 sends the shares
 * itself, so its spans already add up to Δ and nothing changes; a span cut by the read stays as sent (its rest is outside
 * the read, so at most a few steps on a span that long). Returns the new count by event id, only where it changes.
 */
export function counterScaledPhoneSteps(rows: ReadonlyArray<Pick<IntervalRow, 'id' | 'startMs' | 'endMs' | 'support' | 'data'>>): Map<string, number> {
  const out = new Map<string, number>();
  const nsKey = (v: unknown): string | null => {
    if (typeof v === 'string' && /^\d{1,20}$/.test(v)) return BigInt(v).toString();
    if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return String(v);
    return null;
  };
  interface Piece { id: string; startMs: number; endMs: number; steps: number; parent: number; boot: string; a: string; b: string; an: bigint }
  const pieces: Piece[] = [];
  for (const r of rows) {
    const d = r.data;
    const steps = num(d.steps);
    const parent = num(d.parent_steps);
    const a = nsKey(d.m_start_ns);
    const b = nsKey(d.m_end_ns);
    if (d.timing !== 'detector' || r.support !== 'minute' || r.endMs === null || steps === null || steps < 0 || parent === null || parent < 0 ||
      !Number.isInteger(parent) || typeof d.boot_id !== 'string' || a === null || b === null) continue;
    pieces.push({ id: r.id, startMs: r.startMs, endMs: r.endMs, steps, parent, boot: d.boot_id, a, b, an: BigInt(a) });
  }
  pieces.sort((p, q) => (p.boot < q.boot ? -1 : p.boot > q.boot ? 1 : p.an < q.an ? -1 : p.an > q.an ? 1 : p.startMs - q.startMs || (p.id < q.id ? -1 : 1)));
  const onMinute = (t: number) => t % MIN === 0;
  const share = (span: Piece[]) => {
    const delta = span[0]!.parent;
    const heard = span.reduce((n, p) => n + p.steps, 0);
    if (heard === delta) return;
    if (onMinute(span[0]!.startMs) || onMinute(span.at(-1)!.endMs)) return; // cut by the read
    const w = heard > 0 ? span.map((p) => p.steps) : span.map((p) => p.endMs - p.startMs);
    const W = w.reduce((n, x) => n + x, 0);
    if (!(W > 0)) return;
    const raw = w.map((x) => (delta * x) / W);
    const got = raw.map(Math.floor);
    let left = delta - got.reduce((n, x) => n + x, 0);
    const order = raw.map((_x, k) => k).sort((i, j) => raw[j]! - got[j]! - (raw[i]! - got[i]!) || i - j);
    for (const k of order) {
      if (left <= 0) break;
      got[k]!++;
      left--;
    }
    span.forEach((p, k) => {
      if (got[k] !== p.steps) out.set(p.id, got[k]!);
    });
  };
  let span: Piece[] = [];
  for (const p of pieces) {
    const prev = span.at(-1);
    if (prev && prev.boot === p.boot && prev.b === p.a && prev.endMs === p.startMs && onMinute(p.startMs) && prev.parent === p.parent) span.push(p);
    else {
      if (span.length) share(span);
      span = [p];
    }
  }
  if (span.length) share(span);
  return out;
}

const ringSupport = (s: string | null): StepSupport => (s === 'minute' || s === 'tenMinuteFallback' || s === 'quarterHour' ? s : 'span');

export function stepEvidence(store: LumenStore, fromMs: number, toMs: number, inputs: Inputs): StepEvidence {
  const ring = intervalsAll(store, 'activity/buckets', fromMs, toMs);
  const phone = intervalsAll(store, 'activity/phone_steps', fromMs, toMs);
  const hc = intervalsAll(store, 'hc/record', fromMs, toMs, { recordType: 'Steps' });
  const acq = intervalsAll(store, 'phone/acquisition', fromMs, toMs);
  inputs.addAll(ring);
  inputs.addAll(phone);
  inputs.addAll(hc);
  inputs.addAll(acq);
  const records: StepRecord[] = [];
  const native = ring.filter((r) => r.support !== LEGACY_SUPPORT && r.endMs !== null);
  const nativeSpans = native.map((r) => [r.startMs, r.endMs!] as const).sort((a, b) => a[0] - b[0]);
  // a legacy row whose start lies in native detail is the same minutes, read twice
  const shadowed = (t: number) => {
    let lo = 0;
    let hi = nativeSpans.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (nativeSpans[m]![0] <= t) lo = m + 1;
      else hi = m;
    }
    for (let k = lo - 1; k >= 0 && k >= lo - 64; k--) if (nativeSpans[k]![1] > t) return true;
    return false;
  };
  const ringBuckets: RingBucket[] = [];
  for (const r of ring) {
    const steps = num(r.data.steps) ?? 0;
    const bucket = { id: r.id, startMs: r.startMs, endMs: r.endMs, steps, distanceM: num(r.data.distance_m) ?? 0, installationId: r.installationId, support: r.support ?? LEGACY_SUPPORT };
    if (r.support === LEGACY_SUPPORT || r.endMs === null) {
      if (!shadowed(r.startMs)) ringBuckets.push(bucket);
      continue;
    }
    ringBuckets.push(bucket);
    const source = `ring:${typeof r.data.device_key === 'string' ? r.data.device_key : `installation:${r.installationId}`}`;
    records.push({ id: r.id, upstreamId: `${source}|${r.startMs}|${r.endMs}`, rev: r.receivedMs, lineage: 'ring', source, startMs: r.startMs, endMs: r.endMs, steps, support: ringSupport(r.support) });
  }
  // (r070) the phone's records and Health Connect's are keyed by the record (a boot and a counter timestamp; the record id),
  // not by the installation that sent them: the Gauge engine in the Vitals app and the standalone Gauge app on one phone
  // upload the same records, and they are one. (`lumenState.ts` `scopeOf` already keeps one current version of each.)
  // (r068 walk) detector-timed minutes at the counter's count (uploads before Gauge 2.8.5)
  const counted = counterScaledPhoneSteps(phone);
  for (const r of phone) {
    if (r.endMs === null) continue;
    records.push({ id: r.id, upstreamId: `phone|${r.subject}`, rev: r.receivedMs, lineage: 'phone', source: 'phone:counter', sourceRank: 0, startMs: r.startMs, endMs: r.endMs, steps: counted.get(r.id) ?? num(r.data.steps) ?? 0, support: phoneSupport(r.support) });
  }
  for (const r of hc) {
    if (r.endMs === null || r.endMs <= r.startMs) continue;
    const p = isObj(r.data.payload) ? r.data.payload : {};
    const origin = typeof r.data.origin_package === 'string' ? r.data.origin_package : 'unknown';
    const lineage = r.lineage ?? 'unknown';
    const minute = r.endMs - r.startMs <= MIN && Math.floor(r.startMs / MIN) === Math.floor((r.endMs - 1) / MIN);
    records.push({
      id: r.id, upstreamId: `hc|${r.subject}`, rev: r.revMs ?? r.receivedMs, lineage, source: `hc:${origin}`, sourceRank: lineage === 'phone' ? 1 : 0,
      startMs: r.startMs, endMs: r.endMs, steps: num(p.count) ?? 0, support: minute ? 'minute' : 'span',
    });
  }
  const listening = acq.filter((a) => a.endMs !== null && a.support === 'listening');
  const phoneAcquisition = acq.filter((a) => a.endMs !== null).map((a) => ({ startMs: a.startMs, endMs: a.endMs!, state: a.support ?? 'unknown', ...(detectorOf(a.data) !== null ? { detector: detectorOf(a.data)! } : {}) }));
  const detector = phone.filter((r) => r.data.timing === 'detector' && r.endMs !== null);
  // (r063 A9, GAUGE-CONTRACT item 2) observed zeros: a listening window with `observed_zero: true` (the step detector
  // registered, Gauge 2.8.1) is observed whole, a stationary hour with no step record too; any other listening window
  // (detector absent or failed, or before 2.8.1) keeps the earlier rule: only when a detector-timed record overlaps it.
  // Fusion then subtracts every phone record (any timing, counter spans included): the minutes left are observed zeros,
  // computed at read time, so records that arrive minutes after the interval closed still remove their minutes.
  const zeroWindows = listening.filter((a) => detectorOf(a.data) === 'registered' || detector.some((r) => r.startMs < a.endMs! && r.endMs! > a.startMs)).map((a) => ({ lineage: 'phone' as const, source: 'phone:counter', startMs: a.startMs, endMs: a.endMs! }));
  return { records, ringBuckets, zeroWindows, phoneAcquisition };
}

export interface RingDaily {
  id: string;
  installationId: string;
  date: string;
  observedMs: number;
  steps: number | null;
  distanceM: number | null;
  caloriesKcal: number | null;
  activeMinutes: number | null;
}

/** The ring's daily totals by local date: the latest authoritative revision (latest observed, then received, then ingest), not the max. */
export function ringDaily(store: LumenStore, fromMs: number, toMs: number, tz: string, inputs: Inputs): Map<string, RingDaily> {
  const rows = store.all<{ id: string; installation_id: string; observed_ms: number; received_ms: number; seq: number; steps: number | null; distance_m: number | null; calories_kcal: number | null; active_minutes: number | null }>(
    'SELECT id, installation_id, observed_ms, received_ms, seq, steps, distance_m, calories_kcal, active_minutes FROM daily_activity WHERE observed_ms >= ? AND observed_ms < ? ORDER BY observed_ms, received_ms, seq', fromMs, toMs);
  chargeReadBudget(rows.length);
  inputs.addAll(rows);
  const out = new Map<string, RingDaily>();
  for (const r of rows) out.set(localDate(r.observed_ms, tz), {
    id: r.id, installationId: r.installation_id, date: localDate(r.observed_ms, tz), observedMs: r.observed_ms,
    steps: num(r.steps), distanceM: num(r.distance_m), caloriesKcal: num(r.calories_kcal), activeMinutes: num(r.active_minutes),
  });
  return out;
}

/** A coverage report is never observed before the last day it covers, less this slack (P: clock and zone differences). */
const COVERAGE_REPORT_SLACK_MS = 2 * DAY;

/**
 * The local dates whose ring step detail GA reported complete (`state/sync` coverage of `activity_detail`).
 * (r063 FX2, final review sR13/aR17) Windowed: with `window`, only reports that can cover a date from `window.fromDate`
 * on are read (a report about a day is observed on or after it, so `observed_ms` from that day's start less a slack
 * bounds the read on its index), and the rows count in the call's row budget.
 */
export function ringDetailCompleteDates(store: LumenStore, inputs: Inputs, window?: { fromDate: string; fromMs: number }): Set<string> {
  const rows = window
    ? store.all<{ id: string; data: string }>("SELECT id, data FROM visible_events WHERE category = 'state/sync' AND observed_ms >= ? AND type = 'health.sync.coverage'", window.fromMs - COVERAGE_REPORT_SLACK_MS)
    : store.all<{ id: string; data: string }>("SELECT id, data FROM visible_events WHERE category = 'state/sync' AND type = 'health.sync.coverage'");
  chargeReadBudget(rows.length);
  const out = new Set<string>();
  for (const r of rows) {
    let d: unknown;
    try {
      d = JSON.parse(r.data);
    } catch {
      continue;
    }
    if (!isObj(d) || d.stream !== 'activity_detail' || d.complete !== true || typeof d.fromDay !== 'string' || typeof d.toDay !== 'string') continue;
    if (window && d.toDay < window.fromDate) continue;
    inputs.add(r.id);
    for (const date of datesBetween(window && d.fromDay < window.fromDate ? window.fromDate : d.fromDay, d.toDay)) out.add(date);
  }
  return out;
}

/**
 * (r068) When the ring's step detail was last read, per local date: a complete `activity_detail` coverage report observed
 * in `fromMs`..`toMs` freshens the date it reached (its `to`, never after it was observed). A sync that found no new steps
 * still means the day's steps are current as of then ("Updated" must not freeze at the last minute with steps).
 */
export function ringDetailReadAt(store: LumenStore, inputs: Inputs, fromMs: number, toMs: number, tz: string): Map<string, number> {
  const rows = store.all<{ id: string; observed_ms: number; data: string }>("SELECT id, observed_ms, data FROM visible_events WHERE category = 'state/sync' AND type = 'health.sync.coverage' AND observed_ms >= ? AND observed_ms <= ?", fromMs, toMs);
  chargeReadBudget(rows.length);
  const out = new Map<string, number>();
  for (const r of rows) {
    let d: unknown;
    try {
      d = JSON.parse(r.data);
    } catch {
      continue;
    }
    if (!isObj(d) || d.stream !== 'activity_detail' || d.complete !== true || typeof d.to !== 'string') continue;
    const reached = Date.parse(d.to);
    if (!Number.isFinite(reached)) continue;
    const at = Math.min(r.observed_ms, reached);
    if (at < fromMs) continue;
    inputs.add(r.id);
    const date = localDate(at, tz);
    out.set(date, Math.max(out.get(date) ?? 0, at));
  }
  return out;
}

export interface FusedRange {
  /** Over the whole read, which can reach past the asked days (`fromMs`..`toMs`); report only units that overlap them. */
  fusion: FusionResult;
  days: FusedDay[];
  evidence: StepEvidence;
  daily: Map<string, RingDaily>;
  complete: Set<string>;
  fromMs: number;
  toMs: number;
}

/** (r063 FX2) The instant of local hour `h` (may be fractional) on `date` in `tz`, by the wall clock (DST-safe). */
export function localHourMs(date: string, h: number, tz: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m || !(h >= 0 && h < 24)) return null;
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  const ss = Math.round(((h - hh) * 60 - mm) * 60);
  return zonedMs(Number(m[1]), Number(m[2]), Number(m[3]), hh, mm, ss, tz);
}

/** Minutes of evidence read on each side of the asked range, so minute rules (sole sustained gait) see their context (P). */
export const FUSE_CONTEXT_MS = 10 * MIN;
/** How far the read grows past the asked range to take in a whole connected component (P; past it, a chain is cut). */
export const FUSE_MAX_WIDEN_MS = 2 * DAY;
const FUSE_MAX_PASSES = 8;

/**
 * Fusion over the local dates `fromDate`..`toDate` and their day values (`ctx`: the caller's activity context,
 * corrections and preference; zero windows and day breaks are added here).
 *
 * A day's totals never depend on where the query starts (energy F6): the evidence is read wider than the asked days, by
 * `FUSE_CONTEXT_MS`, then on until no record crosses the read edge (every component whole, up to `FUSE_MAX_WIDEN_MS`).
 * Each unit still belongs to the day of its last instant; only the asked days are reported, and the evidence's ring
 * buckets and acquisition windows are the asked range's.
 */
export function fuseRange(store: LumenStore, tz: string, fromDate: string, toDate: string, inputs: Inputs, ctx: Omit<FusionContext, 'zeroWindows' | 'breaks'> = {}): FusedRange {
  const dates = datesBetween(fromDate, toDate);
  const bounds = dates.map((d) => dayBounds(d, tz)!);
  const fromMs = bounds[0]![0];
  const toMs = bounds.at(-1)![1];
  const floor = fromMs - FUSE_MAX_WIDEN_MS;
  const ceil = toMs + FUSE_MAX_WIDEN_MS;
  let lo = fromMs - FUSE_CONTEXT_MS;
  let hi = toMs + FUSE_CONTEXT_MS;
  let wide = stepEvidence(store, lo, hi, inputs);
  for (let pass = 0; pass < FUSE_MAX_PASSES; pass++) {
    let nlo = lo;
    let nhi = hi;
    for (const r of wide.records) {
      if (r.startMs < nlo) nlo = r.startMs;
      if (r.endMs > nhi) nhi = r.endMs;
    }
    nlo = Math.max(floor, nlo);
    nhi = Math.min(ceil, nhi);
    if (nlo >= lo && nhi <= hi) break;
    lo = Math.min(lo, nlo);
    hi = Math.max(hi, nhi);
    wide = stepEvidence(store, lo, hi, inputs);
  }
  // the day starts across the whole read, so merged intervals never cross a local midnight; (r063 FX2 sR08/aR03) nor the
  // person's rollover, so every merged interval lies in one app day too
  const readDates = datesBetween(localDate(lo, tz), localDate(hi - 1, tz));
  const breaks = readDates.map((d) => dayBounds(d, tz)![0]);
  const rollovers = typeof ctx.rolloverH === 'number' && ctx.rolloverH > 0 && ctx.rolloverH < 24 ? readDates.map((d) => localHourMs(d, ctx.rolloverH!, tz)).filter((t): t is number => t !== null) : [];
  const fusion = fuseSteps(wide.records, { ...ctx, zeroWindows: wide.zeroWindows, breaks: [...breaks, ...rollovers, toMs] });
  const evidence: StepEvidence = {
    ...wide,
    ringBuckets: wide.ringBuckets.filter((b) => b.startMs < toMs && (b.endMs ?? b.startMs + 1) > fromMs),
    phoneAcquisition: wide.phoneAcquisition.filter((a) => a.startMs < toMs && a.endMs > fromMs),
  };
  const daily = ringDaily(store, fromMs, toMs, tz, inputs);
  const complete = ringDetailCompleteDates(store, inputs, { fromDate, fromMs });
  const days = fusedDays(fusion, dates.map((date, i) => ({ date, startMs: bounds[i]![0], endMs: bounds[i]![1], ringDailyTotal: daily.get(date)?.steps ?? null, ringDetailComplete: complete.has(date) })));
  return { fusion, days, evidence, daily, complete, fromMs, toMs };
}

// ---------------------------------------------------------------------------------------------------------------
// Health Connect sample streams (r063 S16)

const HC_SAMPLE_FIELD = { HeartRate: 'bpm', Speed: 'mps', Power: 'w' } as const;
/** (P) A record's samples declare their own cadence when at least this share of the gaps is within twice the median. */
const REGULAR_SHARE = 0.8;
const OWN_ORIGIN = 'com.pulseloop';

/**
 * The record's sampling cadence (s) from its own spacing: at least 3 samples, a median gap of at most 60 s, and at least
 * 80 % of the gaps within twice it (P). Null when irregular: such samples stand for no time (`hr-support/1`).
 */
export function inferredCadenceS(times: readonly number[]): number | null {
  const t = [...new Set(times)].sort((a, b) => a - b);
  if (t.length < 3) return null;
  const gaps = t.slice(1).map((x, i) => (x - t[i]!) / 1000);
  const g = median(gaps)!;
  if (!(g > 0) || g > 60) return null;
  return gaps.filter((x) => x <= 2 * g).length >= REGULAR_SHARE * gaps.length ? Math.max(1, Math.round(g)) : null;
}

/**
 * One Health Connect sample stream (`HeartRate`, `Speed` or `Power`) of `[fromMs, toMs)` by origin, Gauge's own exports
 * left out, each origin with its lineage and readings; HeartRate also with its `hr-support/1` segments where a record's
 * cadence could be inferred (`cuts`: instants a support never crosses).
 */
export function hcStreams(store: LumenStore, type: keyof typeof HC_SAMPLE_FIELD, fromMs: number, toMs: number, inputs: Inputs, cuts: readonly number[] = []): HcStream[] {
  const rows = intervalsAll(store, 'hc/record', fromMs, toMs, { recordType: type });
  const field = HC_SAMPLE_FIELD[type];
  const by = new Map<string, { lineage: string | null; samples: Sample[]; inferred: boolean; records: number; methods: Set<unknown> }>();
  for (const r of rows) {
    const origin = typeof r.data.origin_package === 'string' ? r.data.origin_package : 'unknown';
    if (origin === OWN_ORIGIN) continue;
    const p = isObj(r.data.payload) ? r.data.payload : {};
    const raw = Array.isArray(p.samples) ? p.samples : [];
    const xs = raw.flatMap((x) => {
      if (!isObj(x) || typeof x.t !== 'string') return [];
      const tMs = Date.parse(x.t);
      const v = num(x[field]);
      return Number.isFinite(tMs) && v !== null && v >= 0 ? [{ tMs, value: v }] : [];
    });
    if (!xs.length) continue;
    inputs.add(r.id);
    const source = `hc:${origin}`;
    const cad = type === 'HeartRate' ? inferredCadenceS(xs.map((x) => x.tMs)) : null;
    const cur = by.get(source) ?? { lineage: r.lineage, samples: [], inferred: false, records: 0, methods: new Set() };
    cur.records++;
    cur.inferred ||= cad !== null;
    cur.methods.add(r.data.recording_method ?? null);
    for (const x of xs) cur.samples.push({ tMs: x.tMs, value: x.value, cadenceS: cad, id: r.id });
    by.set(source, cur);
  }
  return [...by.entries()].map(([source, v]) => ({
    source, lineage: v.lineage, records: v.records, recordingMethod: v.methods.size === 1 ? [...v.methods][0] : [...v.methods],
    readings: v.samples.filter((x) => x.tMs >= fromMs && x.tMs < toMs).map((x) => ({ tMs: x.tMs, value: x.value })),
    ...(type === 'HeartRate' ? { cadence: v.inferred ? 'inferred' as const : 'none' as const, segments: supportSegments(v.samples, fromMs, toMs, cuts) } : {}),
  }));
}

// ---------------------------------------------------------------------------------------------------------------
// Workouts

export interface Workout {
  eventId: string;
  sessionId: string;
  installationId: string;
  receivedMs: number;
  startMs: number;
  endMs: number;
  data: Record<string, unknown>;
}

/** The current workouts overlapping `[fromMs, toMs)` (not "started in range"). */
export function workoutsOverlapping(store: LumenStore, fromMs: number, toMs: number, inputs: Inputs): Workout[] {
  const rows = intervalsAll(store, 'activity/session', fromMs, toMs);
  inputs.addAll(rows);
  return rows.filter((r) => r.endMs !== null).map((r) => ({ eventId: r.id, sessionId: r.subject, installationId: r.installationId, receivedMs: r.receivedMs, startMs: r.startMs, endMs: r.endMs!, data: r.data }));
}

// ---------------------------------------------------------------------------------------------------------------
// Sleep

export const SLEEP_STAGES = ['deep', 'light', 'rem', 'awake', 'unknown'] as const;
/** A bout's minute stage: the ring's five, or (0.6.3 FX5) Health Connect's generic "sleeping" (asleep, stage not named). */
export type BoutStage = (typeof SLEEP_STAGES)[number] | 'asleepUnspecified';
/** A gap this long between two sleep minutes ends a run of them (the night's parts and naps start as runs). */
const SESSION_GAP_MS = 60 * MIN;
const EVENING_HOUR = 19;
/**
 * (r071) The longest wake break inside one night: the ring ends a record while the person is up and starts a new one once
 * sleep resumes, so a night with a break of an hour or more arrives as two runs; up to this long they are one night.
 */
export const NIGHT_BREAK_MAX_MS = 3 * HOUR;
/**
 * (r071) The night window of a wake break, local: from `BREAK_FROM_HOUR` in the evening to `NIGHT_END_HOUR` next morning. A
 * break joins its two runs only when it lies inside it, so a doze before bed (19:30 to 20:30, then bed at 23:00) stays a nap.
 */
const BREAK_FROM_HOUR = 21;
const NIGHT_END_HOUR = 12;

/** The day of waking a sleep minute belongs to: from 19:00 local it counts toward the next day (Gauge's rule). */
export function wakingDate(ms: number, tz: string): string {
  const w = new Date(ms + offsetMinutes(ms, tz) * MIN);
  if (w.getUTCHours() >= EVENING_HOUR) w.setUTCDate(w.getUTCDate() + 1);
  return w.toISOString().slice(0, 10);
}

/** A stretch of minutes no packet covers inside a night, between two of its parts. */
export interface NightBreak {
  startMs: number;
  endMs: number;
}

/** One run of sleep minutes with the wake breaks of the night joined into it. */
export interface NightRun {
  startMs: number;
  endMs: number;
  breaks: NightBreak[];
}

/** Is `ms` inside the night window of a wake break (21:00 to 12:00, local)? */
const inNightWindow = (ms: number, tz: string): boolean => {
  const h = localMinutes(ms, tz) / 60;
  return h >= BREAK_FROM_HOUR || h < NIGHT_END_HOUR;
};

/**
 * (r071) The sorted minute stamps `ts` cut into nights. A gap of an hour or more ends a run (a part of a night is
 * contiguous). Neighbouring runs are then one night when the break between them is at most `NIGHT_BREAK_MAX_MS` (3 h),
 * lies inside the night window (21:00 to 12:00, local) and both belong to one waking day (the 19:00 rule on their
 * starts). The break stays no data in the night's minutes and is listed in `breaks`; a run that is not of that night (a
 * daytime nap, an evening doze, one more than 3 h away) stays a run of its own. Pure.
 */
export function nightRuns(ts: readonly number[], tz: string): NightRun[] {
  const runs: Array<{ startMs: number; endMs: number }> = [];
  let start = -1;
  let last = -1;
  for (const t of ts) {
    if (start >= 0 && t - (last + MIN) >= SESSION_GAP_MS) {
      runs.push({ startMs: start, endMs: last + MIN });
      start = -1;
    }
    if (start < 0) start = t;
    last = t;
  }
  if (start >= 0) runs.push({ startMs: start, endMs: last + MIN });
  const out: NightRun[] = [];
  for (const r of runs) {
    const cur = out.at(-1);
    if (cur && r.startMs - cur.endMs <= NIGHT_BREAK_MAX_MS && inNightWindow(cur.endMs, tz) && inNightWindow(r.startMs, tz) && wakingDate(cur.startMs, tz) === wakingDate(r.startMs, tz)) {
      cur.breaks.push({ startMs: cur.endMs, endMs: r.startMs });
      cur.endMs = r.endMs;
    } else out.push({ startMs: r.startMs, endMs: r.endMs, breaks: [] });
  }
  return out;
}

/**
 * (r071) The stretches a bout was slept in: its recorded window without its wake breaks (a break is time awake, so a
 * reading in it is an awake reading). A bout without a break is one stretch, its whole window.
 */
export function sleepParts(b: Pick<Bout, 'startMs' | 'endMs' | 'breaks'>): Array<{ startMs: number; endMs: number }> {
  const out: Array<{ startMs: number; endMs: number }> = [];
  let from = b.startMs;
  for (const k of b.breaks ?? []) {
    if (k.startMs > from) out.push({ startMs: from, endMs: k.startMs });
    from = k.endMs;
  }
  out.push({ startMs: from, endMs: b.endMs });
  return out;
}

export interface Bout {
  wakingDate: string;
  startMs: number;
  endMs: number;
  /** Per minute of `[startMs, endMs)`; null where no packet covers the minute. */
  stages: Array<BoutStage | null>;
  nativeEpochS: number | null;
  firmware: string[];
  installs: Set<string>;
  /**
   * The primary bout of its waking day (the most known-asleep minutes); the others are naps. (r071) A night with a wake
   * break (`breaks`) is one bout: the asleep minutes of its parts add up and the break counts as awake after sleep onset.
   */
  primary: boolean;
  /** (r071) The wake breaks between the parts of this night (minutes no packet covers; at most 3 h each), oldest first. */
  breaks?: NightBreak[];
  metrics?: SleepMetrics;
  /**
   * (0.6.3 FX5) Where the night came from: the ring (absent on older callers: the ring), or Health Connect's SleepSession
   * of one origin (`origin`, its package) for a waking day the ring has no sleep for.
   */
  source?: 'ring' | 'healthConnect';
  origin?: string;
}

export interface SleepRead {
  bouts: Bout[];
  /** Every minute a packet covers (the later packet's stage wins). */
  minutes: Map<number, string>;
}

/**
 * The ring's sleep minutes from packets observed in `[loMs, hiMs)`, cut into bouts at gaps of an hour or more, except
 * that the parts of one night (a wake break of up to 3 h inside the night window) stay one bout (`nightRuns`).
 */
export function sleepRead(store: LumenStore, tz: string, loMs: number, hiMs: number, inputs: Inputs): SleepRead {
  // Gauge's `time` is its `observed_at`: the order of versions is when Gauge received them, then ingest order
  const rows = store.all<{ id: string; installation_id: string; observed_ms: number; stages: string | null; interval_minutes: number | null; native_epoch_s: number | null; firmware: string | null }>(
    'SELECT id, installation_id, observed_ms, stages, interval_minutes, native_epoch_s, firmware FROM sleep_timeline WHERE observed_ms >= ? AND observed_ms < ? ORDER BY received_ms, ingested_ms, seq', loMs, hiMs);
  chargeReadBudget(rows.length);
  const minutes = new Map<number, string>();
  const meta = new Map<number, { install: string; epoch: number | null; firmware: string | null }>();
  for (const r of rows) {
    let stages: unknown;
    try {
      stages = JSON.parse(r.stages ?? '[]');
    } catch {
      continue;
    }
    if (!Array.isArray(stages)) continue;
    inputs.add(r.id);
    const step = Math.max(1, Math.min(60, num(r.interval_minutes) ?? 1));
    // (r063 FX2 sR13) the packet's expanded minutes count in the budget too
    chargeReadBudget(stages.length * step);
    // the ring stamps a packet at any second: its minutes go on the one minute grid
    const start = Math.round(r.observed_ms / MIN) * MIN;
    const m = { install: r.installation_id, epoch: num(r.native_epoch_s), firmware: r.firmware };
    stages.forEach((s, i) => {
      const stage = typeof s === 'string' && (SLEEP_STAGES as readonly string[]).includes(s) ? s : 'unknown';
      for (let k = 0; k < step; k++) {
        minutes.set(start + (i * step + k) * MIN, stage);
        meta.set(start + (i * step + k) * MIN, m);
      }
    });
  }
  const sorted = [...minutes.keys()].sort((a, b) => a - b);
  const bouts: Bout[] = [];
  // (r071) a night is one bout: its parts, with the wake breaks of up to 3 h between them (`nightRuns`)
  for (const { startMs, endMs, breaks } of nightRuns(sorted, tz)) {
    const stages: Bout['stages'] = [];
    const installs = new Set<string>();
    const epochs = new Set<number>();
    const firmware = new Set<string>();
    for (let t = startMs; t < endMs; t += MIN) {
      stages.push((minutes.get(t) as Bout['stages'][number]) ?? null);
      const m = meta.get(t);
      if (m) {
        installs.add(m.install);
        if (m.epoch !== null) epochs.add(m.epoch);
        if (m.firmware) firmware.add(m.firmware);
      }
    }
    bouts.push({ wakingDate: wakingDate(startMs, tz), startMs, endMs, stages, nativeEpochS: epochs.size ? Math.max(...epochs) : null, firmware: [...firmware].sort(), installs, primary: false, ...(breaks.length ? { breaks } : {}) });
  }
  for (const b of bouts) b.source = 'ring';
  // (0.6.3 FX5) Health Connect sleep only for the waking days the ring has none for (one origin a night, never both)
  bouts.push(...hcSleepBouts(store, tz, loMs, hiMs, inputs, minutes, new Set(bouts.map((b) => b.wakingDate))));
  bouts.sort((a, b) => a.startMs - b.startMs);
  // the primary bout of each waking day: the most known-asleep minutes (the earliest on a tie)
  const asleep = (b: Bout) => b.stages.filter((s) => s === 'deep' || s === 'light' || s === 'rem' || s === 'asleepUnspecified').length;
  const byDay = new Map<string, Bout>();
  for (const b of bouts) {
    const cur = byDay.get(b.wakingDate);
    if (!cur || asleep(b) > asleep(cur)) byDay.set(b.wakingDate, b);
  }
  for (const b of byDay.values()) b.primary = true;
  return { bouts, minutes };
}

/** Health Connect's sleep stage names (Gauge's capture) on the bout stages. */
const HC_STAGE: Record<string, BoutStage> = { awake: 'awake', awake_in_bed: 'awake', out_of_bed: 'awake', light: 'light', deep: 'deep', rem: 'rem', sleeping: 'asleepUnspecified', unknown: 'unknown' };

/**
 * (0.6.3 FX5, cross-verification M18) Health Connect SleepSession records starting in `[loMs, hiMs)` as bouts, only for
 * waking days without ring sleep (`ringDays`) and never over a minute the ring covers: the ring stays the source of
 * every night it saw. Gauge's own exports are left out (they are the ring's nights again). One origin per waking day:
 * the one with the most asleep minutes, then the most minutes, then by name. A record's stages give its minutes
 * (between stages: no data); a record without stages is `unknown` throughout (asleep is not assumed). The bouts' minutes
 * join `minutes`, so the timeline's sleep stages follow the same choice.
 */
export function hcSleepBouts(store: LumenStore, tz: string, loMs: number, hiMs: number, inputs: Inputs, minutes: Map<number, string>, ringDays: ReadonlySet<string>): Bout[] {
  const rows = intervalsAll(store, 'hc/record', loMs, hiMs, { recordType: 'SleepSession' });
  type Rec = { id: string; origin: string; install: string; rev: number; wakingDate: string; stages: Map<number, BoutStage> };
  const recs: Rec[] = [];
  for (const r of rows) {
    if (r.endMs === null || !(r.endMs > r.startMs) || r.startMs < loMs || r.startMs >= hiMs) continue;
    const origin = typeof r.data.origin_package === 'string' ? r.data.origin_package : 'unknown';
    if (origin === OWN_ORIGIN) continue;
    const a = Math.round(r.startMs / MIN) * MIN;
    const b = Math.max(a + MIN, Math.round(r.endMs / MIN) * MIN);
    chargeReadBudget((b - a) / MIN);
    const wd = wakingDate(a, tz);
    if (ringDays.has(wd)) continue;
    const p = isObj(r.data.payload) ? r.data.payload : {};
    const list = Array.isArray(p.stages) ? p.stages : [];
    const st = new Map<number, BoutStage>();
    if (list.length === 0) for (let t = a; t < b; t += MIN) st.set(t, 'unknown');
    for (const x of list) {
      if (!isObj(x)) continue;
      const s = typeof x.start === 'string' ? Date.parse(x.start) : Number.NaN;
      const e = typeof x.end === 'string' ? Date.parse(x.end) : Number.NaN;
      if (!Number.isFinite(s) || !(e > s)) continue;
      const stage = HC_STAGE[typeof x.stage === 'string' ? x.stage : 'unknown'] ?? 'unknown';
      for (let t = Math.max(a, Math.round(s / MIN) * MIN); t < Math.min(b, Math.round(e / MIN) * MIN); t += MIN) st.set(t, stage);
    }
    // a minute the ring covers keeps the ring's night: the whole record stands aside
    if ([...st.keys()].some((t) => minutes.has(t))) continue;
    if (!st.size) continue;
    inputs.add(r.id);
    recs.push({ id: r.id, origin, install: r.installationId, rev: r.revMs ?? r.observedMs, wakingDate: wd, stages: st });
  }
  const isAsleep = (x: BoutStage) => x === 'deep' || x === 'light' || x === 'rem' || x === 'asleepUnspecified';
  const byDay = new Map<string, Map<string, Rec[]>>();
  for (const r of recs) {
    const d = byDay.get(r.wakingDate) ?? new Map<string, Rec[]>();
    d.set(r.origin, [...(d.get(r.origin) ?? []), r]);
    byDay.set(r.wakingDate, d);
  }
  const out: Bout[] = [];
  for (const [, origins] of [...byDay.entries()].sort((x, y) => x[0].localeCompare(y[0]))) {
    const score = (rs: Rec[]) => {
      const m = new Map<number, BoutStage>();
      for (const r of rs) for (const [t, v] of r.stages) m.set(t, v);
      return { asleep: [...m.values()].filter(isAsleep).length, all: m.size };
    };
    const [origin, rs] = [...origins.entries()].sort((x, y) => {
      const a = score(x[1]);
      const b = score(y[1]);
      return b.asleep - a.asleep || b.all - a.all || x[0].localeCompare(y[0]);
    })[0]!;
    // the origin's minutes (a later revision wins a shared minute), cut into bouts at the ring's hour gap; (r071) the parts
    // of one night (a wake break of up to 3 h inside the night window) stay one bout, as the ring's do
    const m = new Map<number, { stage: BoutStage; install: string }>();
    for (const r of [...rs].sort((x, y) => x.rev - y.rev || x.id.localeCompare(y.id))) for (const [t, v] of r.stages) m.set(t, { stage: v, install: r.install });
    const ts = [...m.keys()].sort((x, y) => x - y);
    for (const { startMs, endMs, breaks } of nightRuns(ts, tz)) {
      // a part that falls on a waking day the ring has sleep for stays out (the ring's day)
      if (ringDays.has(wakingDate(startMs, tz))) continue;
      const stages: Bout['stages'] = [];
      const installs = new Set<string>();
      for (let t = startMs; t < endMs; t += MIN) {
        const v = m.get(t);
        stages.push(v ? v.stage : null);
        if (v) {
          installs.add(v.install);
          minutes.set(t, v.stage);
        }
      }
      out.push({ wakingDate: wakingDate(startMs, tz), startMs, endMs, stages, nativeEpochS: null, firmware: [], installs, primary: false, source: 'healthConnect', origin, ...(breaks.length ? { breaks } : {}) });
    }
  }
  return out;
}

/** The sleep bouts of the waking dates `fromDate`..`toDate`. */
export function sleepBouts(store: LumenStore, tz: string, fromDate: string, toDate: string, inputs: Inputs): Bout[] {
  const lo = dayBounds(fromDate, tz)![0] - DAY;
  const hi = dayBounds(toDate, tz)![1];
  return sleepRead(store, tz, lo, hi, inputs).bouts.filter((b) => b.wakingDate >= fromDate && b.wakingDate <= toDate);
}

/** Attaches `sleep-metrics/1` to each bout, reading heart rate, HRV, temperature and SpO2 once for all of them. */
export function withMetrics(store: LumenStore, bouts: Bout[], inputs: Inputs): Bout[] {
  if (!bouts.length) return bouts;
  const lo = Math.min(...bouts.map((b) => b.startMs)) - HOUR;
  const hi = Math.max(...bouts.map((b) => b.endMs)) + HOUR;
  const hr = metricSamples(store, 'hr', lo, hi, inputs);
  const hrv = metricSamples(store, 'hrv', lo, hi, inputs);
  const temp = metricSamples(store, 'temp', lo, hi, inputs);
  const spo2 = metricSamples(store, 'spo2', lo, hi, inputs);
  const near = (xs: Sample[], b: Bout) => xs.filter((s) => s.tMs >= b.startMs - HOUR && s.tMs < b.endMs + HOUR);
  for (const b of bouts) {
    b.metrics = sleepMetrics({
      startMs: b.startMs, endMs: b.endMs, stages: b.stages as Array<Stage | null>, nativeEpochS: b.nativeEpochS,
      hr: near(hr, b), hrv: near(hrv, b), temp: near(temp, b), spo2: near(spo2, b), firmware: b.firmware,
      ...(b.breaks?.length ? { breaks: b.breaks } : {}),
    });
  }
  return bouts;
}

/** A primary bout as the baselines read it. */
export function nightSummary(b: Bout, tz: string): NightSummary {
  const m = b.metrics!;
  return {
    wakingDate: b.wakingDate, onsetMin: m.onsetMs === null ? null : localMinutes(m.onsetMs, tz), wakeMin: m.finalWakeMs === null ? null : localMinutes(m.finalWakeMs, tz),
    midpointMin: m.midpointMs === null ? null : localMinutes(m.midpointMs, tz), tstLowerMin: m.tstLowerMin,
    nightlyLowHr: m.nightlyLowHrP10?.bpm ?? null, hrvMs: m.hrvNightlyMs?.ms ?? null, skinTempC: m.skinTempNightC?.c ?? null,
  };
}

/** The baselines of a waking date: the 28 prior nights (that night excluded), plus that night for ΔT. */
export function baselinesFor(store: LumenStore, tz: string, date: string, inputs: Inputs) {
  const bouts = withMetrics(store, sleepBouts(store, tz, addDays(date, -28), date, inputs).filter((b) => b.primary), inputs);
  const nights = bouts.filter((b) => b.wakingDate < date).map((b) => nightSummary(b, tz));
  const tonight = bouts.find((b) => b.wakingDate === date);
  return { baselines: computeBaselines(date, nights, tonight ? nightSummary(tonight, tz) : null), bouts };
}

// ---------------------------------------------------------------------------------------------------------------
// (0.6.3 FX5, cross-verification M18) Health Connect fallbacks: resting HR and daily distance, used only where the
// ring has none, one origin a day, Gauge's own exports left out, with their lineage.

/** The days and gates of the resting-HR fallback (the sleeping-low baseline's: 14 days, 7 days over a 6-day span). */
const RHR_DAYS = 14;
const RHR_DAYS_NEEDED = 7;
const RHR_SPAN_NEEDED = 6;
const RHR_S_FLOOR = 3;

export interface HcRestingHrFallback {
  source: 'healthConnect';
  /** The origins (packages) whose days it used. */
  origins: string[];
  medianBpm: number | null;
  s: number | null;
  n: number;
  spanDays: number;
  ready: boolean;
  label: string;
}

/**
 * Health Connect RestingHeartRate over the 14 local days before `date` (that day excluded, as the baselines do): per day
 * one origin (the most records that day, then by name) and its median; the median of the days, s = max(IQR/1.349, 3 bpm).
 * Ready with 7 days over a 6-day span. Only the baselines route calls it, and only when the ring's sleeping low is not ready.
 */
export function hcRestingHr(store: LumenStore, tz: string, date: string, inputs: Inputs): HcRestingHrFallback {
  const lo = dayBounds(addDays(date, -RHR_DAYS), tz)![0];
  const hi = dayBounds(date, tz)![0];
  const rows = intervalsAll(store, 'hc/record', lo, hi, { recordType: 'RestingHeartRate' });
  const byDay = new Map<string, Map<string, Array<{ id: string; bpm: number }>>>();
  for (const r of rows) {
    if (r.startMs < lo || r.startMs >= hi) continue;
    const origin = typeof r.data.origin_package === 'string' ? r.data.origin_package : 'unknown';
    if (origin === OWN_ORIGIN) continue;
    const p = isObj(r.data.payload) ? r.data.payload : {};
    const bpm = num(p.bpm);
    if (bpm === null || bpm < 25 || bpm > 140) continue;
    const d = localDate(r.startMs, tz);
    const day = byDay.get(d) ?? new Map<string, Array<{ id: string; bpm: number }>>();
    day.set(origin, [...(day.get(origin) ?? []), { id: r.id, bpm }]);
    byDay.set(d, day);
  }
  const values: Array<{ date: string; bpm: number }> = [];
  const origins = new Set<string>();
  for (const [d, day] of [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const [origin, xs] = [...day.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))[0]!;
    for (const x of xs) inputs.add(x.id);
    origins.add(origin);
    values.push({ date: d, bpm: median(xs.map((x) => x.bpm))! });
  }
  const bpms = values.map((v) => v.bpm);
  const med = median(bpms);
  const q = (p: number) => {
    const s = [...bpms].sort((a, b) => a - b);
    const k = (s.length - 1) * p;
    const f = Math.floor(k);
    return s.length ? s[f]! + (s[Math.min(f + 1, s.length - 1)]! - s[f]!) * (k - f) : 0;
  };
  const dayN = (x: string) => Date.parse(`${x}T00:00:00Z`) / DAY;
  const span = values.length ? Math.round(dayN(values.at(-1)!.date) - dayN(values[0]!.date)) : 0;
  return {
    source: 'healthConnect', origins: [...origins].sort(),
    medianBpm: med === null ? null : Math.round(med * 10) / 10,
    s: bpms.length ? Math.round(Math.max((q(0.75) - q(0.25)) / 1.349, RHR_S_FLOOR) * 10) / 10 : null,
    n: values.length, spanDays: span, ready: values.length >= RHR_DAYS_NEEDED && span >= RHR_SPAN_NEEDED,
    label: 'Resting HR from Health Connect (the ring\'s sleeping low is not ready)',
  };
}

export interface HcDayDistance {
  date: string;
  m: number;
  origin: string;
  records: number;
}

/**
 * Health Connect Distance per local day of `[fromMs, toMs)` for the given `dates` only (the days the ring has no distance
 * for): a record across midnight is split by time; per day one origin (the most recorded time that day, then by name),
 * never a sum over origins (two apps writing the same walk would count it twice).
 */
export function hcDailyDistance(store: LumenStore, tz: string, fromMs: number, toMs: number, dates: ReadonlySet<string>, inputs: Inputs): Map<string, HcDayDistance> {
  const out = new Map<string, HcDayDistance>();
  if (!dates.size) return out;
  const rows = intervalsAll(store, 'hc/record', fromMs, toMs, { recordType: 'Distance' });
  const acc = new Map<string, Map<string, { m: number; ms: number; ids: string[] }>>();
  for (const r of rows) {
    const origin = typeof r.data.origin_package === 'string' ? r.data.origin_package : 'unknown';
    if (origin === OWN_ORIGIN || r.endMs === null || !(r.endMs > r.startMs)) continue;
    const p = isObj(r.data.payload) ? r.data.payload : {};
    const m = num(p.m);
    if (m === null || m < 0) continue;
    const len = r.endMs - r.startMs;
    // the record's parts on each local day it touches (inside the read window)
    let t = Math.max(r.startMs, fromMs);
    const end = Math.min(r.endMs, toMs);
    while (t < end) {
      const d = localDate(t, tz);
      const dayEnd = Math.min(end, dayBounds(d, tz)?.[1] ?? end);
      if (!(dayEnd > t)) break;
      if (dates.has(d)) {
        const day = acc.get(d) ?? new Map<string, { m: number; ms: number; ids: string[] }>();
        const cur = day.get(origin) ?? { m: 0, ms: 0, ids: [] };
        cur.m += (m * (dayEnd - t)) / len;
        cur.ms += dayEnd - t;
        cur.ids.push(r.id);
        day.set(origin, cur);
        acc.set(d, day);
      }
      t = dayEnd;
    }
  }
  for (const [d, day] of acc) {
    const [origin, v] = [...day.entries()].sort((a, b) => b[1].ms - a[1].ms || a[0].localeCompare(b[0]))[0]!;
    for (const id of v.ids) inputs.add(id);
    out.set(d, { date: d, m: v.m, origin, records: new Set(v.ids).size });
  }
  return out;
}
