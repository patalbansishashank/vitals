/**
 * Document-backed `BioStore` (tier H, no React): E10's port over E4's document collections and the app's
 * `BlobStore` (SUITE_SPEC §2.3, §2.4, §4.2). `InMemoryBioStore` (./memory.ts) is its conformance oracle
 * (./__tests__/conformance.ts runs the same suite against both).
 *
 * - `bioRecords` (IMM) `${record_id}@${version}` → the record plus `sourceKey`; `bioChunks` (BLOB) chunkId → manifest
 *   (`superseded: true, replacedBy` once a merged chunk replaces it, removed by `pruneSuperseded`; the bytes live in the
 *   blob store under the chunkId the blob store returns); `bioSources` (LWW-F) sourceKey → `BioSourceDoc` plus `tombstones` per stream; `bioScores` (DER);
 *   `decisionLog` (APP, ULID ids).
 * - Reads come from the shared `BioDocIndex` (./docIndex.ts) plus this session's own writes (an overlay), so a reader
 *   always sees what it wrote.
 * - Chunks: one value per (source, origin, t). Live chunks are read newest first (`createdAt` desc, then `chunkId`), so
 *   the newest write wins and every replica shows the same value; a new batch replaces a stored value at the same
 *   (origin, t). A write folds every live chunk of its key (siblings two devices wrote offline) into one. A chunk
 *   whose bytes are on neither this device nor the relay yet is skipped: what it replaced is read instead and
 *   `readSamples` reports `partial: true`.
 * - Writes are buffered and flushed in batches (`batchSize`, default 400 ops; E11 measured batched writes about 4×
 *   faster) through a `BioDocWriter`: the command's transaction (`ctx.docs`) for commands, a derive transaction for
 *   jobs. Call `flush()` when done.
 */
import { applyMergePatch, ulid, type BlobStore } from '@/store';
import { chunkIdFor, chunkKeyString, chunkStats, contentHashOf, decodeChunk, encodeChunk, mergeSamples, sampleKey } from '../core/chunks';
import { PERSON_POLICY_ID } from '../core/effective';
import { compareVersions } from '../core/scores/rescore';
import type { BioChunkManifest, BioCorrection, BioRecord, BioSourceDoc, BioStream, ChunkKey, DecisionLogEntry, LocalDate, RawSample, ScoreResult, StreamPolicy } from '../core/types';
import { dayKey, recordDocId, scoreDocId, type BioCollection, type BioDocIndex, type ManifestBody, type PersonPolicyBody, type RecordBody, type SourceBody } from './docIndex';
import type { BioStore, ChunkQuery, RecordQuery } from './types';

export type BioDocOp =
  | { kind: 'put'; col: BioCollection; id: string; body: Record<string, unknown> }
  | { kind: 'append'; col: BioCollection; id: string; body: Record<string, unknown> }
  /** RFC 7396 merge patch of top-level fields. */
  | { kind: 'patch'; col: BioCollection; id: string; patch: Record<string, unknown> }
  /** Soft delete. */
  | { kind: 'remove'; col: BioCollection; id: string };

export interface BioDocWriter {
  /** Writes the ops together (one transaction). */
  write(ops: readonly BioDocOp[]): Promise<void>;
  /** True when the ops are in the store once `write` resolves (a derive transaction); false when they join a buffered
   * command transaction committed after the executor returns (this session keeps seeing them through its overlay). */
  readonly durable: boolean;
}

/** The blob store, plus (chunk store) whether the relay holds a chunk. */
export type BioBlobStore = BlobStore & { hasRemote?(chunkId: string): Promise<boolean> };

export interface DocBioStoreOptions {
  index: BioDocIndex;
  blobs: BioBlobStore;
  writer: BioDocWriter;
  /** Ops buffered before an automatic flush (default 400). */
  batchSize?: number;
}

/** Extra fields this adapter keeps on a source document (stripped from `BioSourceDoc` reads). */
const SOURCE_EXTRAS = ['tombstones', 'deviceType', 'ble', 'createdAt'] as const;

type Body = Record<string, unknown>;
/** A local blob without a manifest is kept this long (its manifest may still be on the way into the index). */
const ORPHAN_AGE_MS = 60 * 60 * 1000;
/** A replaced manifest is removed once its replacement's bytes are on the relay, or after this long anyway. */
const SUPERSEDED_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const clone = <T>(x: T): T => structuredClone(x);

function asSourceDoc(b: SourceBody): BioSourceDoc {
  const out: Record<string, unknown> = { ...b };
  for (const k of SOURCE_EXTRAS) delete out[k];
  return clone(out) as unknown as BioSourceDoc;
}

function asManifest(b: ManifestBody): BioChunkManifest {
  const { superseded: _s, replacedBy: _r, supersededAt: _a, ...m } = b;
  void _s;
  void _r;
  void _a;
  return clone(m);
}

/** Ids a manifest replaced (one string in older builds). */
const supersedesOf = (m: BioChunkManifest): string[] => (m.supersedes === undefined ? [] : Array.isArray(m.supersedes) ? m.supersedes : [m.supersedes]);
/** Read order of chunks: newest write first, then chunkId (the same on every replica: both travel in the manifest). */
const newestFirst = (a: BioChunkManifest, b: BioChunkManifest): number => b.createdAt.localeCompare(a.createdAt) || a.chunkId.localeCompare(b.chunkId);

type SampleQuery = { sourceKey?: string; stream: BioStream; from: LocalDate; to: LocalDate };

const isRealSource = (b: Body | null | undefined): b is Body & SourceBody => !!b && typeof b.label === 'string' && typeof b.sourceKey === 'string';
const TIER_RANK: Record<string, number> = { A: 0, B: 1, C: 2 };

export class DocBioStore implements BioStore {
  private readonly index: BioDocIndex;
  private readonly blobs: BioBlobStore;
  private readonly writer: BioDocWriter;
  private readonly batchSize: number;
  /** This session's writes not yet visible in the index: col → id → body (null = removed). */
  private readonly overlay = new Map<BioCollection, Map<string, Body | null>>();
  private pending: BioDocOp[] = [];
  private flushing: Promise<void> = Promise.resolve();
  /** Blobs of replaced chunks, dropped from the blob store once the removal of their manifest is durable. */
  private discards: string[] = [];
  /** Ops written through this store (tests, reports). */
  written = 0;

  constructor(o: DocBioStoreOptions) {
    this.index = o.index;
    this.blobs = o.blobs;
    this.writer = o.writer;
    this.batchSize = Math.max(1, o.batchSize ?? 400);
  }

  // ------------------------------------------------------------------------------------- overlay plumbing

  private ov(col: BioCollection): Map<string, Body | null> {
    let m = this.overlay.get(col);
    if (!m) this.overlay.set(col, (m = new Map()));
    return m;
  }

  /** The stored body as the index holds it (no overlay). */
  private baseBody(col: BioCollection, id: string): Body | null {
    const ix = this.index;
    switch (col) {
      case 'bioRecords': {
        const e = ix.recDocs.get(id);
        return e ? ({ ...e.record, sourceKey: e.sourceKey } as unknown as Body) : null;
      }
      case 'bioChunks':
        return (ix.chunks.get(id) as unknown as Body) ?? null;
      case 'bioSources':
        if (id === PERSON_POLICY_ID) return ix.personPolicies.length ? ({ kind: 'personPolicy', policies: ix.personPolicies } satisfies PersonPolicyBody as unknown as Body) : null;
        return (ix.sourceDocs.get(id) as unknown as Body) ?? null;
      case 'bioScores':
        return (ix.scoreDocs.get(id) as unknown as Body) ?? null;
      case 'decisionLog':
        return (ix.decisionDocs.get(id) as unknown as Body) ?? null;
      case 'bioCorrections':
        return (ix.correctionDocs.get(id) as unknown as Body) ?? null;
    }
  }

  /** Current body: this session's write, else the store's. */
  private body(col: BioCollection, id: string): Body | null {
    const o = this.overlay.get(col);
    if (o?.has(id)) return o.get(id) ?? null;
    return this.baseBody(col, id);
  }

  private async queue(op: BioDocOp): Promise<void> {
    const after = op.kind === 'remove' ? null : op.kind === 'patch' ? applyMergePatch(this.body(op.col, op.id) ?? {}, op.patch) : op.body;
    this.ov(op.col).set(op.id, after === null ? null : clone(after));
    this.pending.push(op);
    if (this.pending.length >= this.batchSize) await this.flush();
  }

  /** Writes every buffered op (one transaction). Safe to call repeatedly. */
  flush(): Promise<void> {
    const run = async (): Promise<void> => {
      if (this.pending.length === 0) return;
      const ops = this.pending;
      this.pending = [];
      const discards = this.discards;
      this.discards = [];
      await this.writer.write(ops);
      this.written += ops.length;
      if (this.writer.durable) {
        // the store (and so the index, through its change feed) now holds them
        for (const op of ops) this.overlay.get(op.col)?.delete(op.id);
        // a replaced chunk's bytes go too (a command transaction may still roll back: those wait for `pruneSuperseded`)
        if (this.blobs.discard) for (const id of discards) await this.blobs.discard(id).catch(() => undefined);
      }
    };
    const p = this.flushing.then(run, run);
    this.flushing = p.catch(() => undefined);
    return p;
  }

  /** Ops waiting for `flush()`. */
  get pendingOps(): number {
    return this.pending.length;
  }

  private async ready(): Promise<void> {
    await this.index.ready;
  }

  // ------------------------------------------------------------------------------------- records

  /** Newest version of a record id, across the store and this session. */
  private latestOf(recordId: string): { docId: string; sourceKey: string; record: BioRecord } | null {
    let best: { docId: string; sourceKey: string; record: BioRecord } | null = null;
    const consider = (docId: string, b: Body | null) => {
      if (!b) return;
      const rec = b as unknown as RecordBody;
      if (rec.record_id !== recordId) return;
      if (!best || rec.version > best.record.version) {
        const { sourceKey, ...record } = rec;
        best = { docId, sourceKey, record: record as BioRecord };
      }
    };
    const o = this.overlay.get('bioRecords');
    for (const docId of this.index.versionsOf(recordId)) if (!o?.has(docId)) consider(docId, this.baseBody('bioRecords', docId));
    if (o) for (const [docId, b] of o) consider(docId, b);
    return best;
  }

  async putRecord(rec: BioRecord, sourceKey: string): Promise<'inserted' | 'duplicate' | 'stale'> {
    await this.ready();
    const hi = this.latestOf(rec.record_id)?.record.version;
    if (hi !== undefined && rec.version < hi) return 'stale';
    const id = recordDocId(rec);
    if (this.body('bioRecords', id)) return 'duplicate';
    // `put` (not `append`): IMM allows a put when the id is new or was soft-deleted (a re-import after a deletion)
    await this.queue({ kind: 'put', col: 'bioRecords', id, body: { ...(clone(rec) as unknown as Body), sourceKey } });
    return 'inserted';
  }

  async records(q: RecordQuery = {}): Promise<Array<{ sourceKey: string; record: BioRecord }>> {
    await this.ready();
    const kinds = q.kind === undefined ? null : new Set(Array.isArray(q.kind) ? q.kind : [q.kind]);
    const o = this.overlay.get('bioRecords');
    const rids = new Set<string>();
    for (const e of this.index.latestRecords(q.from, q.to)) rids.add(e.record.record_id);
    if (o) for (const [docId, b] of o) rids.add(b ? (b as unknown as RecordBody).record_id : (this.index.recDocs.get(docId)?.record.record_id ?? ''));
    const out: Array<{ sourceKey: string; record: BioRecord }> = [];
    for (const rid of rids) {
      if (!rid) continue;
      const e = o ? this.latestOf(rid) : (() => {
        const id = this.index.latest.get(rid);
        const x = id ? this.index.recDocs.get(id) : undefined;
        return x ? { docId: x.docId, sourceKey: x.sourceKey, record: x.record } : null;
      })();
      if (!e) continue;
      const r = e.record;
      if (kinds && !kinds.has(r.kind)) continue;
      if (q.sourceKey !== undefined && e.sourceKey !== q.sourceKey) continue;
      if (q.from !== undefined && r.time.local_date < q.from) continue;
      if (q.to !== undefined && r.time.local_date > q.to) continue;
      out.push({ sourceKey: e.sourceKey, record: r });
    }
    const when = (r: BioRecord): string => r.time.start ?? r.time.at ?? '';
    out.sort((a, b) => a.record.time.local_date.localeCompare(b.record.time.local_date) || when(a.record).localeCompare(when(b.record)) || a.record.record_id.localeCompare(b.record.record_id));
    return out.map((e) => clone(e));
  }

  /** Soft-deletes every stored version of the given record ids (`bio.deleteSource`, undo of a manual value). */
  async removeRecords(recordIds: Iterable<string>): Promise<number> {
    await this.ready();
    let n = 0;
    const o = this.overlay.get('bioRecords');
    for (const rid of recordIds) {
      const ids = new Set(this.index.versionsOf(rid));
      if (o) for (const [docId, b] of o) if (b && (b as unknown as RecordBody).record_id === rid) ids.add(docId);
      for (const id of ids) {
        if (!this.body('bioRecords', id)) continue;
        await this.queue({ kind: 'remove', col: 'bioRecords', id });
        n++;
      }
    }
    return n;
  }

  // ------------------------------------------------------------------------------------- chunks

  /** Current (or every) manifest, merged with this session's writes. */
  private allManifests(): ManifestBody[] {
    const o = this.overlay.get('bioChunks');
    const out: ManifestBody[] = [];
    for (const [id, m] of this.index.chunks) if (!o?.has(id)) out.push(m);
    if (o) for (const b of o.values()) if (b) out.push(b as unknown as ManifestBody);
    return out;
  }

  /** Live manifests of one source/stream/day (`superseded`: the replaced ones instead). */
  private manifestsOfDay(sourceKey: string, stream: string, localDate: LocalDate, superseded = false): ManifestBody[] {
    const o = this.overlay.get('bioChunks');
    const out: ManifestBody[] = [];
    for (const id of this.index.chunksByDay.get(dayKey(sourceKey, stream, localDate)) ?? []) {
      if (o?.has(id)) continue;
      const m = this.index.chunks.get(id);
      if (m && !!m.superseded === superseded) out.push(m);
    }
    if (o) for (const b of o.values()) {
      const m = b as unknown as ManifestBody | null;
      if (m && !!m.superseded === superseded && m.sourceKey === sourceKey && m.stream === stream && m.local_date === localDate) out.push(m);
    }
    return out;
  }

  private tombSet(sourceKey: string, stream: BioStream): Set<string> {
    const b = this.body('bioSources', sourceKey) as SourceBody | null;
    return new Set(b?.tombstones?.[stream] ?? []);
  }

  /** The samples of a chunk; null when its bytes are on neither this device nor the relay (`strict`: throws). */
  private async load(m: BioChunkManifest, strict = false): Promise<RawSample[] | null> {
    try {
      return decodeChunk(await this.blobs.get(m.chunkId)).samples;
    } catch (e) {
      // replaced by another session meanwhile (its bytes are gone with its manifest): the newer chunk holds the samples
      if (!this.body('bioChunks', m.chunkId)) return [];
      if (strict) throw e;
      return null;
    }
  }

  private async write(key: ChunkKey, samples: RawSample[], tz: number, prev: readonly ManifestBody[], opts: { decoder?: string; createdAt: string }): Promise<BioChunkManifest | null> {
    if (samples.length === 0) {
      // nothing left (every sample deleted): the replaced chunks go now, manifest and bytes
      for (const p of prev) {
        await this.queue({ kind: 'remove', col: 'bioChunks', id: p.chunkId });
        this.discards.push(p.chunkId);
      }
      return null;
    }
    const bytes = encodeChunk(samples, tz, key.stream);
    const contentHash = contentHashOf(bytes);
    const { chunkId } = await this.blobs.put(bytes, { purpose: 'bio', aadId: chunkIdFor(key, contentHash) });
    // A replaced chunk whose bytes are on the relay stays, marked, until the merged bytes are there too
    // (`pruneSuperseded`): a replica that gets this manifest before those bytes reads the old chunk meanwhile. One whose
    // bytes are not (still waiting for upload, or no relay) is no use to anyone else: it goes now, and what it had
    // replaced points at the new chunk instead. This device has the merged bytes, so its own old copies go either way.
    const marked = this.manifestsOfDay(key.sourceKey, key.stream, key.local_date, true);
    const keep: string[] = [];
    const drop: string[] = [];
    for (const p of prev) {
      if (p.chunkId === chunkId) continue;
      if (await this.onRelay(p.chunkId)) keep.push(p.chunkId);
      else {
        drop.push(p.chunkId);
        for (const q of marked) if (q.replacedBy === p.chunkId) keep.push(q.chunkId);
      }
    }
    const supersedes = [...drop, ...keep];
    const st = chunkStats(samples);
    const m: BioChunkManifest = {
      chunkId, sourceKey: key.sourceKey, stream: key.stream, local_date: key.local_date, ...(key.hourStartUtc ? { hourStartUtc: key.hourStartUtc } : {}),
      n: st.n, min: st.min, max: st.max, bytes: bytes.length, contentHash, schemaVersion: 1, ...(opts.decoder ? { decoder: opts.decoder } : {}), createdAt: opts.createdAt,
      ...(supersedes.length ? { supersedes: supersedes.length === 1 ? supersedes[0]! : supersedes } : {}),
    };
    await this.queue({ kind: 'put', col: 'bioChunks', id: chunkId, body: m as unknown as Body });
    const at = new Date().toISOString();
    for (const id of keep) {
      await this.queue({ kind: 'patch', col: 'bioChunks', id, patch: { superseded: true, replacedBy: chunkId, supersededAt: at } });
      this.discards.push(id);
    }
    for (const id of drop) {
      await this.queue({ kind: 'remove', col: 'bioChunks', id });
      this.discards.push(id);
    }
    // older marked copies of this day whose replacement has reached the relay are no longer needed
    for (const q of marked) {
      if (keep.includes(q.chunkId) || !(await this.replacementOnRelay(q))) continue;
      await this.queue({ kind: 'remove', col: 'bioChunks', id: q.chunkId });
      this.discards.push(q.chunkId);
    }
    return m;
  }

  async putSamples(
    key: ChunkKey, samples: RawSample[], opts: { tz_offset_s: number; decoder?: string; createdAt: string },
  ): Promise<{ manifest: BioChunkManifest | null; added: number; duplicates: number }> {
    await this.ready();
    const ks = chunkKeyString(key);
    // every live chunk of this key (two devices that wrote the day offline leave siblings: this write folds them into
    // one), newest first so the newest value wins per (origin, t). Chunks of the same source/stream/day under another
    // key (whole-day vs hour split): dedupe against them. A chunk whose bytes are not here yet stays live, untouched.
    const mine: ManifestBody[] = [];
    let existing: RawSample[] = [];
    const known = new Set<string>();
    for (const m of this.manifestsOfDay(key.sourceKey, key.stream, key.local_date).sort(newestFirst)) {
      const got = await this.load(m);
      if (!got) continue;
      if (chunkKeyString(m) !== ks) for (const s of got) known.add(sampleKey(s.origin, s.t));
      else {
        mine.push(m);
        existing = mine.length === 1 ? got : mergeSamples(existing, got).samples;
      }
    }
    let sibDup = 0;
    const fresh = samples.filter((s) => {
      if (known.has(sampleKey(s.origin, s.t))) {
        sibDup++;
        return false;
      }
      return true;
    });
    const tombs = [...this.tombSet(key.sourceKey, key.stream)].map((k) => {
      const i = k.indexOf('|');
      return { origin: k.slice(0, i) as RawSample['origin'], t: Number(k.slice(i + 1)) };
    });
    // a new batch replaces a stored value at the same (origin, t) (counted as a duplicate: the sample was known)
    const merged = mergeSamples(existing, fresh, tombs, { prefer: 'incoming' });
    if (merged.added + merged.replaced === 0) return { manifest: null, added: 0, duplicates: merged.duplicates + sibDup };
    const manifest = await this.write(key, merged.samples, opts.tz_offset_s, mine, opts);
    return { manifest: manifest ? clone(manifest) : null, added: merged.added, duplicates: merged.duplicates + merged.replaced + sibDup };
  }

  async manifests(q: ChunkQuery = {}): Promise<BioChunkManifest[]> {
    await this.ready();
    const out = this.allManifests().filter((m) => {
      if (!q.includeSuperseded && m.superseded) return false;
      if (q.sourceKey !== undefined && m.sourceKey !== q.sourceKey) return false;
      if (q.stream !== undefined && m.stream !== q.stream) return false;
      if (q.from !== undefined && m.local_date < q.from) return false;
      if (q.to !== undefined && m.local_date > q.to) return false;
      return true;
    });
    out.sort((a, b) => a.local_date.localeCompare(b.local_date) || a.sourceKey.localeCompare(b.sourceKey) || (a.hourStartUtc ?? '').localeCompare(b.hourStartUtc ?? '') || a.stream.localeCompare(b.stream) || a.createdAt.localeCompare(b.createdAt));
    return out.map(asManifest);
  }

  async samples(q: SampleQuery): Promise<Array<RawSample & { sourceKey: string }>> {
    return (await this.readSamples(q)).samples;
  }

  /**
   * `samples()` plus `partial: true` when a live chunk's bytes are on neither this device nor the relay yet (its upload
   * is still on the way): that chunk is skipped and the chunks it replaced are read while their manifests are still
   * here. `strict` throws instead.
   */
  async readSamples(q: SampleQuery & { strict?: boolean }): Promise<{ samples: Array<RawSample & { sourceKey: string }>; partial: boolean }> {
    await this.ready();
    const live = this.allManifests().filter((m) => !m.superseded && m.stream === q.stream && m.local_date >= q.from && m.local_date <= q.to && (q.sourceKey === undefined || m.sourceKey === q.sourceKey));
    const read: Array<{ m: BioChunkManifest; samples: RawSample[] }> = [];
    const tried = new Set<string>();
    let partial = false;
    const visit = async (m: ManifestBody): Promise<void> => {
      if (tried.has(m.chunkId)) return;
      tried.add(m.chunkId);
      const got = await this.load(m, q.strict);
      if (got) return void read.push({ m, samples: got });
      partial = true;
      for (const id of supersedesOf(m)) {
        const p = this.body('bioChunks', id) as ManifestBody | null;
        if (p) await visit(p);
      }
    };
    for (const m of live) await visit(m);
    // newest chunk first: its value wins for one (source, origin, t) on every replica
    read.sort((a, b) => newestFirst(a.m, b.m));
    const seen = new Set<string>();
    const out: Array<RawSample & { sourceKey: string }> = [];
    const dead = new Map<string, Set<string>>();
    for (const { m, samples } of read) {
      let d = dead.get(m.sourceKey);
      if (!d) dead.set(m.sourceKey, (d = this.tombSet(m.sourceKey, m.stream)));
      for (const s of samples) {
        const sk = sampleKey(s.origin, s.t);
        const k = `${m.sourceKey}\u0000${sk}`;
        if (seen.has(k) || d.has(sk)) continue;
        seen.add(k);
        out.push({ ...s, sourceKey: m.sourceKey });
      }
    }
    return { samples: out.sort((a, b) => a.t - b.t), partial };
  }

  async tombstone(sourceKey: string, stream: BioStream, ids: Array<{ origin: RawSample['origin']; t: number }>): Promise<void> {
    await this.ready();
    const set = this.tombSet(sourceKey, stream);
    for (const i of ids) set.add(sampleKey(i.origin, i.t));
    await this.queue({ kind: 'patch', col: 'bioSources', id: sourceKey, patch: { sourceKey, tombstones: { [stream]: [...set].sort() } } });
    // rewrite affected chunks so deleted samples are gone from storage too
    for (const m of this.allManifests().filter((x) => !x.superseded && x.sourceKey === sourceKey && x.stream === stream)) {
      // bytes not here yet: readers drop the deleted samples through the tombstones; the rewrite waits for a later write
      const bytes = await this.blobs.get(m.chunkId).catch(() => null);
      if (!bytes) continue;
      const decoded = decodeChunk(bytes);
      const kept = decoded.samples.filter((s) => !set.has(sampleKey(s.origin, s.t)));
      if (kept.length === decoded.samples.length) continue;
      const key: ChunkKey = { sourceKey, stream, local_date: m.local_date, ...(m.hourStartUtc ? { hourStartUtc: m.hourStartUtc } : {}) };
      await this.write(key, kept, decoded.header.tz_offset_s, [m], { ...(m.decoder ? { decoder: m.decoder } : {}), createdAt: m.createdAt });
    }
  }

  /**
   * Removes superseded manifests and drops their bytes: one with `replacedBy` once the replacement's bytes are on the
   * relay (or after 7 days), one an older build marked at once. Then drops local bio blobs that no manifest names
   * (replaced on another device, or by a command that rolled back) once they are an hour old. Needs a durable writer;
   * returns what it removed.
   */
  async pruneSuperseded(o: { now?: number } = {}): Promise<{ manifests: number; blobs: number }> {
    await this.ready();
    if (!this.writer.durable) return { manifests: 0, blobs: 0 };
    const now = o.now ?? Date.now();
    let manifests = 0;
    for (const m of this.allManifests()) {
      if (!m.superseded) continue;
      if (m.replacedBy && !(Date.parse(m.supersededAt ?? '') < now - SUPERSEDED_KEEP_MS) && !(await this.replacementOnRelay(m))) continue;
      await this.queue({ kind: 'remove', col: 'bioChunks', id: m.chunkId });
      this.discards.push(m.chunkId);
      manifests++;
    }
    await this.flush();
    let blobs = 0;
    if (this.blobs.discard && this.blobs.localChunks) {
      const named = new Set(this.allManifests().map((m) => m.chunkId));
      const cutoff = now - ORPHAN_AGE_MS;
      for (const c of await this.blobs.localChunks('bio')) {
        if (named.has(c.chunkId) || !(Date.parse(c.storedAt) < cutoff)) continue;
        await this.blobs.discard(c.chunkId).catch(() => undefined);
        blobs++;
      }
    }
    return { manifests, blobs };
  }

  /** True when the relay holds a chunk's bytes (false when the blob store cannot tell: no relay). */
  private async onRelay(chunkId: string): Promise<boolean> {
    return (await this.blobs.hasRemote?.(chunkId).catch(() => false)) ?? false;
  }

  /** True when a superseded manifest is no longer needed: its replacement's bytes are on the relay, or the replacement
   * is gone as well (deleted, or pruned after its own replacement landed). */
  private async replacementOnRelay(m: ManifestBody): Promise<boolean> {
    if (!m.replacedBy || !this.body('bioChunks', m.replacedBy)) return true;
    return this.onRelay(m.replacedBy);
  }

  /** Marks every current manifest of a source superseded (its chunks are no longer read; `bio.deleteSource`). */
  async dropChunks(sourceKey: string): Promise<number> {
    await this.ready();
    let n = 0;
    for (const m of this.allManifests()) {
      if (m.sourceKey !== sourceKey) continue;
      await this.queue({ kind: 'remove', col: 'bioChunks', id: m.chunkId });
      n++;
    }
    return n;
  }

  // ------------------------------------------------------------------------------------- sources

  async getSource(sourceKey: string): Promise<BioSourceDoc | null> {
    await this.ready();
    const b = this.body('bioSources', sourceKey);
    return isRealSource(b) ? asSourceDoc(b) : null;
  }

  /** The stored source document with this adapter's extra fields (tombstones, device state). */
  async getSourceBody(sourceKey: string): Promise<SourceBody | null> {
    await this.ready();
    const b = this.body('bioSources', sourceKey);
    return isRealSource(b) ? clone(b) : null;
  }

  async putSource(doc: BioSourceDoc): Promise<void> {
    await this.ready();
    // a merge patch keeps this adapter's own fields (tombstones, device state) and replaces the policy list whole; the
    // retired priority fields are removed on every write (SUITE_SPEC §14.6 "No priority lists")
    const { priority: _p, priorityByMetric: _pm, ...rest } = doc;
    void _p;
    void _pm;
    await this.queue({ kind: 'patch', col: 'bioSources', id: doc.sourceKey, patch: { ...clone(rest), priority: null, priorityByMetric: null } as unknown as Body });
  }

  /** Patch extra fields of a source (device state, device type). */
  async patchSource(sourceKey: string, patch: Partial<SourceBody>): Promise<void> {
    await this.ready();
    await this.queue({ kind: 'patch', col: 'bioSources', id: sourceKey, patch: clone(patch) as unknown as Body });
  }

  /** Removes a source document (soft delete). */
  async removeSource(sourceKey: string): Promise<void> {
    await this.ready();
    if (this.body('bioSources', sourceKey)) await this.queue({ kind: 'remove', col: 'bioSources', id: sourceKey });
  }

  async sources(): Promise<BioSourceDoc[]> {
    await this.ready();
    const o = this.overlay.get('bioSources');
    const all: SourceBody[] = [];
    for (const [id, b] of this.index.sourceDocs) if (!o?.has(id) && isRealSource(b as unknown as Body)) all.push(b);
    if (o) for (const b of o.values()) if (isRealSource(b)) all.push(b);
    return all.sort((a, b) => (TIER_RANK[a.tier] ?? 3) - (TIER_RANK[b.tier] ?? 3) || a.sourceKey.localeCompare(b.sourceKey)).map(asSourceDoc);
  }

  /** The person's stream policies (`bioSources/policy:me`). */
  async personPolicies(): Promise<StreamPolicy[]> {
    await this.ready();
    const b = this.body('bioSources', PERSON_POLICY_ID) as PersonPolicyBody | null;
    return clone(b?.policies ?? []);
  }

  async putPersonPolicies(policies: readonly StreamPolicy[], at: string): Promise<void> {
    await this.ready();
    await this.queue({ kind: 'put', col: 'bioSources', id: PERSON_POLICY_ID, body: { kind: 'personPolicy', policies: clone([...policies]), updatedAt: at } });
  }

  // ------------------------------------------------------------------------------------- scores and decisions

  async putScore(r: ScoreResult): Promise<void> {
    await this.ready();
    await this.queue({ kind: 'put', col: 'bioScores', id: scoreDocId(r), body: clone(r) as unknown as Body });
  }

  async scores(q: { scoreId?: string; version?: string; from?: LocalDate; to?: LocalDate }): Promise<ScoreResult[]> {
    await this.ready();
    const o = this.overlay.get('bioScores');
    const all: Array<[string, ScoreResult]> = [];
    for (const [id, r] of this.index.scoreDocs) if (!o?.has(id)) all.push([id, r]);
    if (o) for (const [id, b] of o) if (b) all.push([id, b as unknown as ScoreResult]);
    const out = all.filter(
      ([, r]) => (q.scoreId === undefined || r.scoreId === q.scoreId) && (q.version === undefined || r.version === q.version)
        && (q.from === undefined || r.scope.localDate >= q.from) && (q.to === undefined || r.scope.localDate <= q.to),
    );
    out.sort(([ia, a], [ib, b]) => a.scope.localDate.localeCompare(b.scope.localDate) || a.scoreId.localeCompare(b.scoreId) || compareVersions(a.version, b.version) || ia.localeCompare(ib));
    return out.map(([, r]) => clone(r));
  }

  /** Removes cached score results (DER; `bio.deleteSource` drops what the source fed so they rebuild). */
  async removeScores(ids: Iterable<string>): Promise<void> {
    await this.ready();
    for (const id of ids) if (this.body('bioScores', id)) await this.queue({ kind: 'remove', col: 'bioScores', id });
  }

  async appendDecision(e: DecisionLogEntry): Promise<void> {
    await this.ready();
    await this.queue({ kind: 'append', col: 'decisionLog', id: ulid(), body: clone(e) as unknown as Body });
  }

  async corrections(): Promise<BioCorrection[]> {
    await this.ready();
    const o = this.overlay.get('bioCorrections');
    const all: BioCorrection[] = [];
    for (const [id, c] of this.index.correctionDocs) if (!o?.has(id)) all.push(c);
    if (o) for (const b of o.values()) if (b) all.push(b as unknown as BioCorrection);
    return all.filter((c) => !c.clearedAt).sort((a, b) => a.key.localeCompare(b.key)).map(clone);
  }

  async decisions(): Promise<DecisionLogEntry[]> {
    await this.ready();
    const o = this.overlay.get('decisionLog');
    const all: Array<[string, DecisionLogEntry]> = [];
    for (const [id, e] of this.index.decisionDocs) if (!o?.has(id)) all.push([id, e]);
    if (o) for (const [id, b] of o) if (b) all.push([id, b as unknown as DecisionLogEntry]);
    all.sort(([ia, a], [ib, b]) => a.at.localeCompare(b.at) || ia.localeCompare(ib));
    return all.map(([, e]) => clone(e));
  }
}
