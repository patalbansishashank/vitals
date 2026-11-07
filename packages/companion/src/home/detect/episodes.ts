/**
 * Detection episodes persisted in `lumen.db` (schema version 5, r065 autodetect CONTRACT §2): identity assigned once and
 * revised, `open` / `final` / `withdrawn`, a store-wide change sequence for the route's cursor, and the queue of time
 * ranges to (re)detect that ingest fills in its own transaction.
 *
 * Reconciliation (`reconcile`, pure): every detected episode of a processed range is matched to a stored one of a
 * compatible family (gait, cycle; `other` matches either) that it overlaps, the largest overlap first (then a live one
 * before a withdrawn one, then the oldest): the match keeps its id, and its revision moves only when something public
 * changed. An unmatched detection gets a new id (a ULID at its start); an unmatched stored episode of the range is
 * withdrawn (revision + 1); a withdrawn one that matches again comes back under its id. So earlier uploads that move a
 * start, late evidence, a merge (the oldest id stays, the other is withdrawn) and a split (the larger part keeps the id)
 * never mint a second identity for the same movement.
 */
import { createHash, randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import { DETECT_CONFIG, DETECTOR, type DetectedEpisode, type DetectLabel, type Family, type Level } from './detect.ts';

/** The public episode, as `gauge_detections` answers it (times ISO UTC). */
export interface EpisodeDoc {
  id: string;
  revision: number;
  detector: typeof DETECTOR;
  config: string;
  start: string;
  end: string;
  moving: Array<{ start: string; end: string }>;
  state: 'open' | 'final' | 'withdrawn';
  label: DetectLabel;
  alternatives: DetectLabel[];
  existence: number;
  typeScore: number;
  level: Level;
  reasons: string[];
  coverage: { phone: number; ring: number; hr: number; ar: number; gps: number };
  evidenceHash: string;
  recordingRefs: string[];
}

export interface StoredEpisode {
  id: string;
  revision: number;
  changeSeq: number;
  state: EpisodeDoc['state'];
  family: Family;
  startMs: number;
  endMs: number;
  label: DetectLabel;
  doc: EpisodeDoc;
  createdMs: number;
  updatedMs: number;
}

export type EpisodeWrite = Omit<StoredEpisode, 'changeSeq'>;

/** No episode is longer (detect/2 drops longer ones): an overlap read looks back this far on the start index. */
export const MAX_EPISODE_MS = 12 * 3_600_000;

// --- ids: ULID (Crockford base32, 48-bit time + 80 bits)

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function ulid(timeMs: number, random: Buffer = randomBytes(10)): string {
  let t = Math.max(0, Math.floor(timeMs));
  let time = '';
  for (let i = 0; i < 10; i++) {
    time = B32[t % 32]! + time;
    t = Math.floor(t / 32);
  }
  let bits = 0n;
  for (const b of random.subarray(0, 10)) bits = (bits << 8n) | BigInt(b);
  let rand = '';
  for (let i = 0; i < 16; i++) {
    rand = B32[Number(bits & 31n)]! + rand;
    bits >>= 5n;
  }
  return time + rand;
}

const iso = (ms: number) => new Date(ms).toISOString();

export function docOf(id: string, revision: number, d: DetectedEpisode): EpisodeDoc {
  return {
    id, revision, detector: DETECTOR, config: DETECT_CONFIG, start: iso(d.startMs), end: iso(d.endMs),
    moving: d.moving.map((x) => ({ start: iso(x.startMs), end: iso(x.endMs) })), state: d.state, label: d.label, alternatives: d.alternatives,
    existence: d.existence, typeScore: d.typeScore, level: d.level, reasons: d.reasons, coverage: d.coverage, evidenceHash: d.evidenceHash, recordingRefs: d.recordingRefs,
  };
}

/** Everything public but the identity and the revision (what a revision is about). */
const content = (d: EpisodeDoc) => JSON.stringify({ ...d, id: undefined, revision: undefined });
const compatible = (a: Family, b: Family) => a === b || a === 'other' || b === 'other';
const overlapMs = (a: { startMs: number; endMs: number }, b: { startMs: number; endMs: number }) => Math.max(0, Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs));

/**
 * The writes that bring the stored episodes of a processed range (`stored`: every episode, withdrawn too, that overlaps
 * the range or a detection in it) to `detected`. `newId` mints an id for an unmatched detection.
 */
export function reconcile(stored: readonly StoredEpisode[], detected: readonly DetectedEpisode[], o: { nowMs: number; newId: (d: DetectedEpisode, k: number) => string }): EpisodeWrite[] {
  const pairs: Array<{ d: number; s: number; ov: number }> = [];
  detected.forEach((d, di) => stored.forEach((s, si) => {
    const ov = overlapMs(d, s);
    if (ov > 0 && compatible(d.family, s.family)) pairs.push({ d: di, s: si, ov });
  }));
  pairs.sort((x, y) => y.ov - x.ov || (stored[x.s]!.state === 'withdrawn' ? 1 : 0) - (stored[y.s]!.state === 'withdrawn' ? 1 : 0) ||
    stored[x.s]!.createdMs - stored[y.s]!.createdMs || (stored[x.s]!.id < stored[y.s]!.id ? -1 : 1) || x.d - y.d);
  const dOf = new Map<number, number>();
  const sUsed = new Set<number>();
  for (const p of pairs) {
    if (dOf.has(p.d) || sUsed.has(p.s)) continue;
    dOf.set(p.d, p.s);
    sUsed.add(p.s);
  }
  const writes: EpisodeWrite[] = [];
  detected.forEach((d, di) => {
    const si = dOf.get(di);
    if (si === undefined) {
      const id = o.newId(d, di);
      writes.push({ id, revision: 1, state: d.state, family: d.family, startMs: d.startMs, endMs: d.endMs, label: d.label, doc: docOf(id, 1, d), createdMs: o.nowMs, updatedMs: o.nowMs });
      return;
    }
    const s = stored[si]!;
    const next = docOf(s.id, s.revision, d);
    if (content(next) === content(s.doc)) return;
    const revision = s.revision + 1;
    writes.push({ id: s.id, revision, state: d.state, family: d.family, startMs: d.startMs, endMs: d.endMs, label: d.label, doc: { ...next, revision }, createdMs: s.createdMs, updatedMs: o.nowMs });
  });
  stored.forEach((s, si) => {
    if (sUsed.has(si) || s.state === 'withdrawn') return;
    const revision = s.revision + 1;
    writes.push({ ...s, revision, state: 'withdrawn', doc: { ...s.doc, revision, state: 'withdrawn' }, updatedMs: o.nowMs });
  });
  return writes;
}

/** A deterministic id for a new detection: its start, and a hash of what found it and when. */
export const episodeId = (d: DetectedEpisode, k: number, nowMs: number) =>
  ulid(d.startMs, createHash('sha256').update(`${d.family}|${d.startMs}|${d.endMs}|${nowMs}|${k}`).digest().subarray(0, 10));

// --- the store

export interface QueuedRange {
  id: number;
  fromMs: number;
  toMs: number;
}

export interface DetectionPage {
  rows: StoredEpisode[];
  /** The last change sequence this page covered (the next cursor); the store's newest when nothing matched. */
  lastSeq: number;
  more: boolean;
}

export interface DetectionStore {
  /** Queues ranges to (re)detect (call inside the caller's write transaction). */
  enqueue(ranges: ReadonlyArray<readonly [number, number]>, nowMs: number): void;
  queue(): QueuedRange[];
  /** Removes the queued ranges up to this id (the ones a run read). */
  dequeue(maxId: number): void;
  /** Every episode (withdrawn too) overlapping `[loMs, hiMs)`. */
  overlapping(loMs: number, hiMs: number): StoredEpisode[];
  /** Writes in one transaction, each with the next change sequence. */
  apply(writes: readonly EpisodeWrite[]): void;
  /** Changes after `afterSeq` in sequence order, optionally only those overlapping `[fromMs, toMs]`. */
  page(o: { afterSeq: number; fromMs?: number | null; toMs?: number | null; limit: number }): DetectionPage;
  /** This file's cursor epoch: a restored or recreated table gets a new one (the client resyncs). */
  epoch(): string;
  maxSeq(): number;
  /** The newest instant detection has processed (null before the first run). */
  processedMs(): number | null;
  noteRun(o: { processedMs: number; suppressed: Record<string, number> }): void;
  diagnostics(): { queued: number; open: number; final: number; withdrawn: number; suppressed: Record<string, number>; lastRunAt: string | null };
}

const PAGE_SCAN = 1000;
const MAX_SCAN = 20_000;
const META_EPOCH = 'detect_epoch';
const META_PROCESSED = 'detect_processed_ms';
const META_SUPPRESSED = 'detect_suppressed';
const META_RUN = 'detect_last_run_ms';

interface Row { id: string; revision: number; change_seq: number; state: string; family: string; start_ms: number; end_ms: number; label: string; doc: string; created_ms: number; updated_ms: number }
const rowOf = (r: Row): StoredEpisode => ({
  id: r.id, revision: r.revision, changeSeq: r.change_seq, state: r.state as StoredEpisode['state'], family: r.family as Family, startMs: r.start_ms, endMs: r.end_ms,
  label: r.label as DetectLabel, doc: JSON.parse(r.doc) as EpisodeDoc, createdMs: r.created_ms, updatedMs: r.updated_ms,
});

export function createDetectionStore(db: Database.Database): DetectionStore {
  const meta = db.prepare<[string], { value: unknown }>('SELECT value FROM lumen_meta WHERE key = ?');
  const put = db.prepare('INSERT INTO lumen_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value');
  const q = {
    enqueue: db.prepare('INSERT INTO detection_queue (from_ms, to_ms, queued_ms) VALUES (?, ?, ?)'),
    queue: db.prepare<[], { id: number; from_ms: number; to_ms: number }>('SELECT id, from_ms, to_ms FROM detection_queue ORDER BY id LIMIT 10000'),
    dequeue: db.prepare('DELETE FROM detection_queue WHERE id <= ?'),
    queued: db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM detection_queue'),
    overlapping: db.prepare<[number, number, number], Row>('SELECT * FROM detection_episodes WHERE start_ms >= ? AND start_ms < ? AND end_ms > ? ORDER BY start_ms, id'),
    upsert: db.prepare(`INSERT INTO detection_episodes (id, revision, change_seq, state, family, start_ms, end_ms, label, doc, created_ms, updated_ms)
      VALUES (@id, @revision, @change_seq, @state, @family, @start_ms, @end_ms, @label, @doc, @created_ms, @updated_ms)
      ON CONFLICT (id) DO UPDATE SET revision = excluded.revision, change_seq = excluded.change_seq, state = excluded.state, family = excluded.family,
        start_ms = excluded.start_ms, end_ms = excluded.end_ms, label = excluded.label, doc = excluded.doc, updated_ms = excluded.updated_ms`),
    maxSeq: db.prepare<[], { m: number | null }>('SELECT MAX(change_seq) AS m FROM detection_episodes'),
    page: db.prepare<[number, number], Row>('SELECT * FROM detection_episodes WHERE change_seq > ? ORDER BY change_seq LIMIT ?'),
    counts: db.prepare<[], { state: string; n: number }>('SELECT state, COUNT(*) AS n FROM detection_episodes GROUP BY state'),
  };
  const maxSeq = () => q.maxSeq.get()?.m ?? 0;
  const applyTx = db.transaction((writes: readonly EpisodeWrite[]) => {
    let seq = maxSeq();
    for (const w of writes) {
      q.upsert.run({ id: w.id, revision: w.revision, change_seq: ++seq, state: w.state, family: w.family, start_ms: w.startMs, end_ms: w.endMs, label: w.label,
        doc: JSON.stringify({ ...w.doc, id: w.id, revision: w.revision, state: w.state }), created_ms: w.createdMs, updated_ms: w.updatedMs });
    }
  });
  return {
    enqueue(ranges, nowMs) {
      for (const [a, b] of ranges) if (b > a) q.enqueue.run(a, b, nowMs);
    },
    queue: () => q.queue.all().map((r) => ({ id: r.id, fromMs: r.from_ms, toMs: r.to_ms })),
    dequeue(maxId) {
      q.dequeue.run(maxId);
    },
    overlapping: (lo, hi) => q.overlapping.all(lo - MAX_EPISODE_MS, hi, lo).map(rowOf),
    apply(writes) {
      if (writes.length) applyTx.immediate(writes);
    },
    page({ afterSeq, fromMs = null, toMs = null, limit }) {
      // a window filter reads on in sequence order (a bounded scan), so the cursor still advances past what it skipped
      const rows: StoredEpisode[] = [];
      let last = afterSeq;
      let more = false;
      let scanned = 0;
      outer: for (;;) {
        const chunk = q.page.all(last, PAGE_SCAN);
        for (const r of chunk) {
          if (rows.length === limit || scanned === MAX_SCAN) {
            more = true;
            break outer;
          }
          scanned++;
          last = r.change_seq;
          if ((fromMs === null || r.end_ms > fromMs) && (toMs === null || r.start_ms <= toMs)) rows.push(rowOf(r));
        }
        if (chunk.length < PAGE_SCAN) break;
      }
      if (!more && last === afterSeq) last = Math.max(afterSeq, maxSeq());
      return { rows, lastSeq: last, more };
    },
    epoch() {
      const v = meta.get(META_EPOCH)?.value;
      if (typeof v === 'string' && v) return v;
      const e = randomBytes(6).toString('hex');
      put.run(META_EPOCH, e);
      return e;
    },
    maxSeq,
    processedMs() {
      const v = meta.get(META_PROCESSED)?.value;
      return typeof v === 'number' ? v : null;
    },
    noteRun({ processedMs, suppressed }) {
      const cur = meta.get(META_PROCESSED)?.value;
      put.run(META_PROCESSED, typeof cur === 'number' ? Math.max(cur, processedMs) : processedMs);
      put.run(META_SUPPRESSED, JSON.stringify(suppressed));
      put.run(META_RUN, Date.now());
    },
    diagnostics() {
      const counts = Object.fromEntries(q.counts.all().map((r) => [r.state, r.n])) as Record<string, number>;
      let suppressed: Record<string, number> = {};
      try {
        const v = meta.get(META_SUPPRESSED)?.value;
        if (typeof v === 'string') suppressed = JSON.parse(v) as Record<string, number>;
      } catch {
        suppressed = {};
      }
      const run = meta.get(META_RUN)?.value;
      return { queued: q.queued.get()?.n ?? 0, open: counts.open ?? 0, final: counts.final ?? 0, withdrawn: counts.withdrawn ?? 0, suppressed, lastRunAt: typeof run === 'number' ? iso(run) : null };
    },
  };
}
