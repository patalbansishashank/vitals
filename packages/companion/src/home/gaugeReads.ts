/**
 * The Gauge reads, kept (r087; review S1, S2, S4): `GET /v1/gauge/*` and the `gauge_*` tools on `/mcp` answer from
 * memory while nothing they read has been written, and the reads that do run take turns with the rest of the server.
 *
 * Until now every read ran the whole derivation on the main thread, a matching `If-None-Match` included: one screen of
 * the phone asks for some 55 days of timeline in a row, each half a second of SQL and JSON, and `/health`, uploads and
 * the pulse waited behind all of them.
 *
 * - An answer is kept under its tool, its arguments, the zone it resolved to and the algorithm versions, with what it
 *   read (`./readScope.ts`: the windows of observed and support time, the detection tables, or everything) and the
 *   parts of the person's stored fusion context it used. A write drops only the answers whose windows it touches
 *   (`StoreChange`, `./lumenStore.ts`): today's upload leaves a past day's timeline standing. A changed part of the
 *   fusion context drops the answers that used that part. Another process writing the file drops them all.
 * - A kept answer is the uncached one byte for byte. Its provenance is the only part that moves without a write to
 *   what it read (the clock's `minutesSince…`, and `lastUploadAt` with every upload): it is stamped again on every
 *   answer from the installations as they are now, and the ETag is hashed again only when they changed.
 * - `etag` answers a kept answer's ETag without any SQL, so a poll with a matching `If-None-Match` is a 304 at once.
 * - Reads that are not kept run one at a time from a queue, each after the event loop has had a turn (and a pause in
 *   proportion to the read before it), so a burst of heavy reads cannot hold `/health`, an upload or the pulse for
 *   longer than one read. The same read asked again while it waits joins the one in the queue. A read nobody waits for
 *   any more (every caller hung up) is skipped.
 * - Kept beside the answers, under the same rules: the parts of derivations several answers share (`DerivedMemo`: the
 *   step-evidence rows of each UTC day, so a month of fused steps asked again after an upload reads today's rows only,
 *   and the timelines of those days take theirs from the same rows).
 * - Bounded by entries and by bytes (an answer counts as four times its JSON, a kept part by its records or rows); the
 *   least recently used go first.
 * - Warmed again (when `rewarmAfterMs` is set): a write that drops an answer a client asked for in the last 6 hours
 *   (the 24 reads each person asked most recently are remembered) leads, once no write has followed for that long, to
 *   the same read being derived again with nobody waiting, so the phone's next request is answered from memory. These
 *   run from the same queue, one at a time and behind every client's read; a client asking for one of them takes it
 *   over (and when that client hangs up before its turn, the read is warmed after all). Nothing is warmed after a write
 *   that drops everything, for a released store, or when the fusion context the dropped answer used has changed. The
 *   reads warmed after one burst of writes may take 6 seconds of derivation together: once they have, the rest are left
 *   to their next request, so a long list of heavy reads cannot hold the thread after every upload. A failure is one
 *   log line.
 *
 * A worker thread with its own read-only connection would also keep one long read from holding the loop. It is not
 * done here: the server's sources run through Node's type stripping and the worker would need its own entry file in
 * the packed build and a copy of every answer across the thread boundary. The queue bounds the wait to one read.
 */
import { createHash } from 'node:crypto';
import type { ToolResultEnvelope } from '../toolManifest.ts';
import { DETECTOR } from './detect/detect.ts';
import { DAY_METRICS_VERSION } from './dayMetrics.ts';
import { contextFor, type StoredFusionContext } from './fusionContext.ts';
import { rowsCharged, withDerivedMemo, type DerivedMemo } from './gaugeDerive.ts';
import { GPS_MOTION_VERSION } from './gpsMotion.ts';
import { HR_SUPPORT_VERSION } from './hrSupport.ts';
import type { LumenStore, StoreChange } from './lumenStore.ts';
import { BAD_ZONE, LUMEN_TOOLS, readFailure, runTool, stampAgain, validZone, zoneFor, type LumenToolSet, type ProvenanceStamp, type UsedContext } from './lumenTools.ts';
import { windowsMeet, withReadDeps, type ReadDeps } from './readScope.ts';
import { SLEEP_METRICS_VERSION } from './sleepMetrics.ts';
import { FUSION_REVISION, FUSION_VERSION } from './stepFusion.ts';
import { rejected } from '../toolManifest.ts';

/** Kept answers and fusions together: at most this many, and this many bytes (as counted here). */
export const READS_MAX_ENTRIES = 4000;
export const READS_MAX_BYTES = 96 * 1024 * 1024;
/** What a kept answer is counted as, per character of its JSON (measured: its objects take about four times that). */
const ANSWER_BYTES_PER_CHAR = 4;
/** The pause before the next queued read, as a share of the read before it, between these bounds (ms). */
const PAUSE_SHARE = 0.05;
const PAUSE_MIN_MS = 1;
const PAUSE_MAX_MS = 25;
/** A dropped answer is derived again only when a client asked for it within this long, */
export const REWARM_ASKED_MS = 6 * 3_600_000;
/** only for this many reads per person (the most recently asked), */
export const REWARM_MAX_KEYS = 24;
/** and this long after the last write (the server's setting; `rewarmAfterMs`). */
export const REWARM_AFTER_MS = 5000;
/**
 * What the reads warmed after one burst of writes may take together (ms of derivation): no read is started once they
 * took more. Measured on the home server: the four reads of the phone's first screen take 3.7 s.
 */
export const REWARM_ROUND_MS = 6000;

/** Every algorithm version an answer can depend on: part of each key, so new code never answers from an old result. */
const VERSIONS = [FUSION_VERSION, FUSION_REVISION, HR_SUPPORT_VERSION, SLEEP_METRICS_VERSION, DAY_METRICS_VERSION, GPS_MOTION_VERSION, DETECTOR].join(',');

const CLOCK_FIELDS = new Set(['minutesSinceLastUpload', 'minutesSinceLastReading']);
/** An answer's JSON without its `minutesSince…` counters (they move with the clock, not with the data). */
const settled = (body: unknown) => JSON.stringify(body, (k, v: unknown) => (CLOCK_FIELDS.has(k) ? undefined : v));
const tagOf = (json: string) => `W/"${createHash('sha256').update(json).digest('base64url').slice(0, 27)}"`;
/** The weak ETag of a Gauge answer. */
export const gaugeEtag = (body: unknown) => tagOf(settled(body));

/** The arguments as one string whatever order their keys came in. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

export interface GaugeAnswer {
  envelope: ToolResultEnvelope;
  /** The ETag of an ok answer; null for a rejection. */
  etag: string | null;
  /** The person's newest upload (ISO), for `Last-Modified`. */
  lastUpload: string | null;
  /** `hit`: answered from memory. `miss`: derived now. `joined`: another caller's read of the same thing. */
  cache: 'hit' | 'miss' | 'joined';
  /** Rows the derivation read (0 for a hit) and the SQL statements it ran. */
  rows: number;
  sql: number;
  /** How long the derivation held the thread (0 for a hit). */
  tookMs: number;
}

export interface GaugeReadsStats {
  hits: number;
  misses: number;
  joined: number;
  skipped: number;
  dropped: number;
  evicted: number;
  /** Answers derived again after a write, with nobody waiting. */
  rewarmed: number;
  entries: number;
  bytes: number;
  queued: number;
  /** Reads queued to be derived again with nobody waiting (behind every queued one). */
  warming: number;
}

export interface GaugeReads {
  /**
   * The ETag (and newest upload) of the answer kept for this read, or null when none stands. Never opens a store and
   * never runs SQL over the person's data: the route answers a matching `If-None-Match` from it.
   */
  etag(personId: string, timeZone: string, tool: string, args: Record<string, unknown>): { etag: string; lastUpload: string | null } | null;
  /** The answer: from memory, or derived in its turn. `alive` says whether the caller still waits (default: always). */
  read(personId: string, timeZone: string, tool: string, args: Record<string, unknown>, o?: { alive?: () => boolean }): Promise<GaugeAnswer>;
  /** The person's `gauge_*` tools answering through `read`. */
  toolsFor(personId: string, timeZone: string): LumenToolSet;
  /** True while anything is kept for a store: closing it now would make the person's next reads cold. */
  holds(store: LumenStore): boolean;
  /** Forgets everything kept for a store (it is being closed). */
  release(store: LumenStore): void;
  stats(): GaugeReadsStats;
  close(): void;
}

export interface GaugeReadsOptions {
  /** The person's store, opened if it exists (null when Gauge never uploaded). */
  store: (personId: string) => LumenStore | null;
  /** The person's store only when it is already open. */
  opened: (personId: string) => LumenStore | null;
  fusion: (personId: string) => StoredFusionContext | null;
  now?: () => number;
  maxEntries?: number;
  maxBytes?: number;
  /** Derive the answers a write dropped again, this long (ms) after the last write. Not set: never. */
  rewarmAfterMs?: number;
  /** What the reads warmed after one burst of writes may take together (ms). Not set: `REWARM_ROUND_MS`. */
  rewarmRoundMs?: number;
  /** One line per answer that could not be derived again (the tool and the error's code, never the data). */
  log?: (line: string) => void;
}

interface Kept {
  store: LumenStore;
  deps: ReadDeps;
  bytes: number;
  /** An answer, a resolved zone, or a part of a derivation (`DerivedMemo`). */
  answer?: { envelope: ToolResultEnvelope; stamp: ProvenanceStamp; usedContext: UsedContext[]; tz: string; etag: string; rosterRev: number; /** The read (its queue key) that derived or last asked for it. */ req: string };
  zone?: string | null;
  part?: { value: unknown };
}

interface Job {
  run: () => GaugeAnswer;
  alive: Array<() => boolean>;
  waiters: Array<(a: GaugeAnswer) => void>;
  /** Set while nobody waits for it (an answer warmed again): its tool, and whether it is still to be derived. */
  warm: { tool: string; due: () => boolean } | null;
  /** The read as its store remembers it (null when reads are not warmed again). */
  asked: { store: LumenStore; t: Asked } | null;
}

/** A read a client asked for: what is needed to derive it again, when, and (once a write dropped its answer) the fusion context that answer used. */
interface Asked {
  personId: string;
  timeZone: string;
  tool: string;
  args: Record<string, unknown>;
  at: number;
  dropped: UsedContext[] | null;
}

/** A store seen: its number (part of every key), its change subscription, and the reads to warm again after a write. */
interface Seen {
  n: number;
  off: () => void;
  /** Least recently asked first. */
  asked: Map<string, Asked>;
  timer: ReturnType<typeof setTimeout> | null;
  /** How long the reads warmed since the last write took together (ms). */
  spentMs: number;
}

/** What a read that could not run answers (the tools' own "try again" rejection). */
const unread = (e: unknown = null): GaugeAnswer => ({ envelope: readFailure(e), etag: null, lastUpload: null, cache: 'miss', rows: 0, sql: 0, tookMs: 0 });
const lastUploadOf = (store: LumenStore) => store.installations().map((i) => i.lastIngestAt).filter((x): x is string => Boolean(x)).sort().at(-1) ?? null;
const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const turn = () => new Promise<void>((r) => setImmediate(r));

export function createGaugeReads(o: GaugeReadsOptions): GaugeReads {
  const now = o.now ?? Date.now;
  const maxEntries = o.maxEntries ?? READS_MAX_ENTRIES;
  const maxBytes = o.maxBytes ?? READS_MAX_BYTES;
  const roundMs = o.rewarmRoundMs ?? REWARM_ROUND_MS;
  /** Least recently used first (a Map keeps insertion order; a use moves the entry to the end). */
  const kept = new Map<string, Kept>();
  let bytes = 0;
  const stats = { hits: 0, misses: 0, joined: 0, skipped: 0, dropped: 0, evicted: 0, rewarmed: 0 };
  const stores = new Map<LumenStore, Seen>();
  let storeSeq = 0;
  let closed = false;
  // the queue: clients' reads, and behind them all the answers warmed again
  const queue: string[] = [];
  const warm: string[] = [];
  const jobs = new Map<string, Job>();

  const remove = (key: string) => {
    const e = kept.get(key);
    if (!e) return;
    kept.delete(key);
    bytes -= e.bytes;
  };
  /** Takes a store's reads out of the line of those to be warmed again; `forget`: and they are left to their next request. */
  const unwarm = (s: Seen, forget: boolean) => {
    for (let i = warm.length - 1; i >= 0; i--) {
      const key = warm[i]!;
      if (!key.startsWith(`${s.n}|`)) continue;
      warm.splice(i, 1);
      const t = jobs.get(key)?.asked?.t;
      if (forget && t) t.dropped = null;
      jobs.delete(key);
    }
  };
  /** Stops what was to be warmed again for a store (the timer, the reads still queued); `forget`: and what was dropped. */
  const halt = (s: Seen, forget: boolean) => {
    if (s.timer) clearTimeout(s.timer);
    s.timer = null;
    unwarm(s, false);
    if (forget) for (const t of s.asked.values()) t.dropped = null;
  };
  /** The store's dropped reads are queued to be warmed again once `rewarmAfterMs` have passed. */
  const arm = (store: LumenStore, s: Seen) => {
    s.timer = setTimeout(() => rewarm(store, s), o.rewarmAfterMs);
    s.timer.unref();
  };
  const changed = (store: LumenStore, c: StoreChange) => {
    const s = stores.get(store);
    for (const [key, e] of kept) {
      if (e.store !== store) continue;
      if (c.everything || (c.detections && e.deps.detections) || (c.ranges.length > 0 && (e.deps.all || windowsMeet(e.deps.ranges, c.ranges)))) {
        const t = e.answer ? s?.asked.get(e.answer.req) : undefined;
        if (t) t.dropped = e.answer!.usedContext;
        remove(key);
        stats.dropped++;
      }
    }
    if (!s) return;
    // nothing is warmed again after a write that can change any answer (a pairing, dedupe, a wide deletion, another process)
    if (c.everything) return halt(s, true);
    if (o.rewarmAfterMs === undefined || ![...s.asked.values()].some((t) => t.dropped)) return;
    // a burst of uploads is one round: it starts (again) this long after the last write
    halt(s, false);
    s.spentMs = 0;
    arm(store, s);
  };
  const numberOf = (store: LumenStore): number => {
    let s = stores.get(store);
    if (!s) stores.set(store, (s = { n: ++storeSeq, off: store.onChange((c) => changed(store, c)), asked: new Map(), timer: null, spentMs: 0 }));
    return s.n;
  };
  const get = (key: string): Kept | undefined => {
    const e = kept.get(key);
    if (!e) return undefined;
    kept.delete(key);
    kept.set(key, e);
    return e;
  };
  const put = (key: string, e: Kept) => {
    remove(key);
    // one entry never takes more than half the room: it would push everything else out
    if (e.bytes > maxBytes / 2) return;
    kept.set(key, e);
    bytes += e.bytes;
    for (const k of kept.keys()) {
      if (kept.size <= maxEntries && bytes <= maxBytes) break;
      remove(k);
      stats.evicted++;
    }
  };

  /** The parts of derivations kept for `store` (each UTC day's step-evidence rows, shared by the reads that fuse them). */
  const memoOf = (store: LumenStore): DerivedMemo => {
    const prefix = `${numberOf(store)}|part|${VERSIONS}|`;
    return {
      get: (s, key) => {
        const e = s === store ? get(prefix + key) : undefined;
        return e?.part ? { value: e.part.value, deps: e.deps } : undefined;
      },
      set: (s, key, entry, weight) => {
        if (s === store) put(prefix + key, { store, deps: entry.deps, bytes: weight, part: { value: entry.value } });
      },
    };
  };

  /** The zone a read uses (`zoneFor`), kept when it came from the stored readings; undefined when it must be resolved. */
  const zoneKey = (store: LumenStore, personTz: string, args: Record<string, unknown>) => `${numberOf(store)}|zone|${personTz}|${canonical([args.date ?? null, args.from ?? null, args.to ?? null])}`;
  const knownZone = (store: LumenStore, personTz: string, args: Record<string, unknown>): string | null | undefined => {
    if (args.tz !== undefined && args.tz !== null && args.tz !== '') return validZone(args.tz);
    const e = get(zoneKey(store, personTz, args));
    return e ? e.zone : undefined;
  };
  const resolveZone = (store: LumenStore, personTz: string, args: Record<string, unknown>): string | null => {
    const known = knownZone(store, personTz, args);
    if (known !== undefined) return known;
    const { value, deps } = withReadDeps(() => zoneFor(store, args, personTz));
    put(zoneKey(store, personTz, args), { store, deps, bytes: 256, zone: value });
    return value;
  };

  const answerKey = (store: LumenStore, tool: string, args: Record<string, unknown>, tz: string) =>
    `${numberOf(store)}|answer|${VERSIONS}|${tool}|${tz}|${createHash('sha256').update(canonical(args)).digest('base64url')}`;

  /** The kept answer of a read while it stands: nothing it read was written, and the fusion context it used is the same. */
  const standing = (store: LumenStore, personId: string, tool: string, args: Record<string, unknown>, tz: string): { key: string; e: Kept & { answer: NonNullable<Kept['answer']> } } | null => {
    const key = answerKey(store, tool, args, tz);
    const e = get(key);
    if (!e?.answer) return null;
    const fusion = e.answer.usedContext.length ? o.fusion(personId) : null;
    if (e.answer.usedContext.some((u) => contextFor(fusion, u.loMs, u.hiMs).contextKey !== u.key)) {
      remove(key);
      stats.dropped++;
      return null;
    }
    return { key, e: e as Kept & { answer: NonNullable<Kept['answer']> } };
  };

  /** The kept answer as it reads now: stamped again, its ETag hashed again only when the installations changed. */
  const serve = (store: LumenStore, a: NonNullable<Kept['answer']>): { envelope: ToolResultEnvelope; etag: string } => {
    const envelope = stampAgain(a.envelope, a.stamp, store.installations(), a.tz, now());
    const rev = store.rosterRevision();
    if (rev !== a.rosterRev) {
      a.envelope = envelope;
      a.etag = gaugeEtag(envelope);
      a.rosterRev = rev;
    }
    return { envelope, etag: a.etag };
  };

  const hit = (store: LumenStore, a: NonNullable<Kept['answer']>): GaugeAnswer => {
    stats.hits++;
    return { ...serve(store, a), lastUpload: lastUploadOf(store), cache: 'hit', rows: 0, sql: 0, tookMs: 0 };
  };

  /** Derives the answer now (synchronous) and keeps it when it can be kept. */
  const derive = (store: LumenStore | null, personId: string, personTz: string, tool: string, args: Record<string, unknown>): GaugeAnswer => {
    const started = performance.now();
    const rows0 = rowsCharged();
    const sql0 = store?.sqlReads() ?? 0;
    const done = (envelope: ToolResultEnvelope, etag: string | null): GaugeAnswer => ({
      envelope, etag, lastUpload: store ? lastUploadOf(store) : null, cache: 'miss', rows: rowsCharged() - rows0, sql: (store?.sqlReads() ?? 0) - sql0, tookMs: performance.now() - started,
    });
    stats.misses++;
    try {
      const tz = store ? resolveZone(store, personTz, args) : zoneFor(null, args, personTz);
      if (tz === null) return done(rejected('invalid_input', BAD_ZONE), null);
      const fusion = o.fusion(personId);
      const at = now();
      if (!store) {
        const { envelope } = runTool(tool, args, { store, tz, now: at, fusion });
        return done(envelope, envelope.ok ? gaugeEtag(envelope) : null);
      }
      // the zone had to be resolved again, but the answer in that zone may still stand
      const still = standing(store, personId, tool, args, tz);
      if (still) {
        stats.misses--;
        return hit(store, still.e.answer);
      }
      // the parts this read derives are kept only when it answers: a read refused for its length (the row budget) must
      // not fill the memory with the rows it got through and push standing answers out
      const parts = new Map<string, { entry: { value: unknown; deps: ReadDeps }; weight: number }>();
      const shared = memoOf(store);
      const staged: DerivedMemo = {
        get: (s, key) => (s === store ? parts.get(key)?.entry : undefined) ?? shared.get(s, key),
        set: (s, key, entry, weight) => {
          if (s === store) parts.set(key, { entry, weight });
        },
      };
      const { value, deps } = withReadDeps(() => withDerivedMemo(staged, () => runTool(tool, args, { store, tz, now: at, fusion })));
      const { envelope, stamp, usedContext } = value;
      if (!envelope.ok) return done(envelope, null);
      for (const [key, p] of parts) shared.set(store, key, p.entry, p.weight);
      const json = settled(envelope);
      const etag = tagOf(json);
      if (stamp) put(answerKey(store, tool, args, tz), { store, deps, bytes: ANSWER_BYTES_PER_CHAR * json.length, answer: { envelope, stamp, usedContext, tz, etag, rosterRev: store.rosterRevision(), req: readKey(store, personTz, tool, args) } });
      return done(envelope, etag);
    } catch (e) {
      return done(readFailure(e), null);
    }
  };

  const readKey = (store: LumenStore, timeZone: string, tool: string, args: Record<string, unknown>) => `${numberOf(store)}|${timeZone}|${tool}|${createHash('sha256').update(canonical(args)).digest('base64url')}`;
  /** The read's answer from memory, if one stands (asked again when a queued read's turn comes: the store may have been written, by another process too). */
  const fromMemory = (store: LumenStore, key: string, personId: string, timeZone: string, tool: string, args: Record<string, unknown>): GaugeAnswer | null => {
    store.foreignWrites();
    const tz = knownZone(store, timeZone, args);
    const s = tz ? standing(store, personId, tool, args, tz) : null;
    if (!s) return null;
    s.e.answer.req = key;
    return hit(store, s.e.answer);
  };

  /**
   * A client asked for this read: it is one of the person's reads to warm again after a write (a warmed read never
   * counts). That its answer was dropped stays noted until the answer stands again: the client may hang up before its
   * read's turn.
   */
  const ask = (store: LumenStore, key: string, personId: string, timeZone: string, tool: string, args: Record<string, unknown>): Asked | null => {
    const s = stores.get(store);
    if (!s || o.rewarmAfterMs === undefined) return null;
    const t: Asked = s.asked.get(key) ?? { personId, timeZone, tool, args: structuredClone(args), at: 0, dropped: null };
    t.at = now();
    s.asked.delete(key);
    s.asked.set(key, t);
    if (s.asked.size > REWARM_MAX_KEYS) s.asked.delete(s.asked.keys().next().value!);
    return t;
  };

  /** Queues the reads whose answers were dropped since they were asked, the most recently asked first, behind every client's read. */
  const rewarm = (store: LumenStore, s: Seen) => {
    s.timer = null;
    if (closed || stores.get(store) !== s) return;
    const at = now();
    for (const [key, t] of [...s.asked].reverse()) {
      if (at - t.at > REWARM_ASKED_MS) {
        s.asked.delete(key);
        continue;
      }
      // (a client's read of the same thing is already queued: it derives it)
      if (!t.dropped || jobs.has(key)) continue;
      const due = (): boolean => {
        const used = t.dropped;
        t.dropped = null;
        // never for a store that was released since, after another process wrote, or under another fusion context than
        // the dropped answer used (the client then sends its own, and asks)
        if (!used || s.asked.get(key) !== t || stores.get(store) !== s || store.foreignWrites()) return false;
        const fusion = used.length ? o.fusion(t.personId) : null;
        return used.every((u) => contextFor(fusion, u.loMs, u.hiMs).contextKey === u.key);
      };
      jobs.set(key, { run: () => fromMemory(store, key, t.personId, t.timeZone, t.tool, t.args) ?? derive(store, t.personId, t.timeZone, t.tool, t.args), alive: [], waiters: [], warm: { tool: t.tool, due }, asked: { store, t } });
      warm.push(key);
    }
    void drain();
  };

  // --- the queue: one read at a time, the loop first
  let draining = false;
  const drain = async (): Promise<void> => {
    if (draining) return;
    draining = true;
    let lastMs = 0;
    try {
      while ((queue.length || warm.length) && !closed) {
        // whatever arrived meanwhile (a health check, an upload, a poll) goes first
        await turn();
        if (lastMs > 0) await pause(Math.min(PAUSE_MAX_MS, Math.max(PAUSE_MIN_MS, Math.round(lastMs * PAUSE_SHARE))));
        // closed while it waited: `close` has already answered everyone
        // a client's read always before an answer nobody waits for
        const key = queue.length ? queue.shift() : warm.shift();
        const job = key === undefined ? undefined : jobs.get(key);
        if (key === undefined || !job) continue;
        jobs.delete(key);
        let a: GaugeAnswer;
        const s = job.asked ? stores.get(job.asked.store) : undefined;
        if (job.warm) {
          lastMs = 0;
          // the reads warmed since the last write took their time: this one and the rest wait for their next request
          if (s && job.asked && s.spentMs > roundMs) {
            job.asked.t.dropped = null;
            unwarm(s, true);
            continue;
          }
          try {
            if (!job.warm.due()) continue;
            a = job.run();
          } catch (e) {
            a = unread(e);
          }
          lastMs = a.tookMs;
          if (s) s.spentMs += a.tookMs;
          if (a.envelope.ok) stats.rewarmed++;
          else o.log?.(`gauge: ${job.warm.tool} could not be derived again after a write (${a.envelope.error?.code ?? 'error'})`);
          continue;
        }
        if (job.alive.every((f) => !f())) {
          stats.skipped++;
          lastMs = 0;
          a = unread();
          // its client hung up, and the answer a write dropped is still missing: it is warmed like the others
          if (s && !s.timer && job.asked?.t.dropped && s.asked.get(key) === job.asked.t) arm(job.asked.store, s);
        } else {
          try {
            a = job.run();
          } catch (e) {
            a = unread(e);
          }
          lastMs = a.tookMs;
          // derived for its client (or found standing)
          if (job.asked) job.asked.t.dropped = null;
        }
        job.waiters.forEach((w, i) => w(i === 0 ? a : { ...a, cache: a.cache === 'miss' ? 'joined' : a.cache, rows: 0, sql: 0, tookMs: 0 }));
      }
    } finally {
      draining = false;
    }
  };

  const reads: GaugeReads = {
    etag(personId, timeZone, tool, args) {
      const store = o.opened(personId);
      if (!store || store.foreignWrites()) return null;
      const tz = knownZone(store, timeZone, args);
      if (!tz) return null;
      const s = standing(store, personId, tool, args, tz);
      if (!s) return null;
      // a poll that is answered here never reaches `read`: it is a client asking all the same
      s.e.answer.req = readKey(store, timeZone, tool, args);
      const t = ask(store, s.e.answer.req, personId, timeZone, tool, args);
      if (t) t.dropped = null;
      return { etag: serve(store, s.e.answer).etag, lastUpload: lastUploadOf(store) };
    },
    read(personId, timeZone, tool, args, opt = {}) {
      if (closed) return Promise.resolve(unread());
      let store: LumenStore | null;
      try {
        store = o.store(personId);
      } catch (e) {
        return Promise.resolve(unread(e));
      }
      // a person without a store has nothing to read: the empty answer is immediate
      if (!store) return Promise.resolve(derive(null, personId, timeZone, tool, args));
      const st = store;
      const key = readKey(st, timeZone, tool, args);
      const t = ask(st, key, personId, timeZone, tool, args);
      const ready = fromMemory(st, key, personId, timeZone, tool, args);
      if (ready) {
        if (t) t.dropped = null;
        return Promise.resolve(ready);
      }
      return new Promise<GaugeAnswer>((resolve) => {
        let job = jobs.get(key);
        if (job?.warm) {
          // it was about to be warmed again: the same derivation, now this client's read, in the clients' queue
          job.warm = null;
          warm.splice(warm.indexOf(key), 1);
          queue.push(key);
        } else if (job) stats.joined++;
        else {
          // the store may have been written (or the same answer kept by another read) while this one waited
          jobs.set(key, (job = { run: () => fromMemory(st, key, personId, timeZone, tool, args) ?? derive(st, personId, timeZone, tool, args), alive: [], waiters: [], warm: null, asked: null }));
          queue.push(key);
        }
        if (t) job.asked = { store: st, t };
        job.alive.push(opt.alive ?? (() => true));
        job.waiters.push(resolve);
        void drain();
      });
    },
    toolsFor: (personId, timeZone) => ({
      tools: () => [...LUMEN_TOOLS],
      call: async (name, args) => (await reads.read(personId, timeZone, name, args)).envelope,
    }),
    holds(store) {
      if (!stores.has(store)) return false;
      for (const e of kept.values()) if (e.store === store) return true;
      return false;
    },
    release(store) {
      const s = stores.get(store);
      if (!s) return;
      halt(s, true);
      s.off();
      stores.delete(store);
      for (const [key, e] of kept) if (e.store === store) remove(key);
    },
    stats: () => ({ ...stats, entries: kept.size, bytes, queued: queue.length, warming: warm.length }),
    close() {
      closed = true;
      for (const s of stores.values()) {
        halt(s, true);
        s.off();
      }
      stores.clear();
      kept.clear();
      bytes = 0;
      // nobody is left waiting on a read that will never run
      for (const key of queue.splice(0)) {
        const job = jobs.get(key);
        jobs.delete(key);
        job?.waiters.forEach((w) => w(unread()));
      }
    },
  };
  return reads;
}
