/**
 * Reference in-memory implementation of `BioStore` over a `BlobStore` (tier H). Used by tests, the importer pipeline's
 * unit tests and as the conformance oracle for E4/E11-backed stores. Values handed out are structured clones so callers
 * cannot mutate stored state, like a real persistent store.
 */
import { chunkIdFor, chunkKeyString, chunkStats, contentHashOf, decodeChunk, encodeChunk, mergeSamples, sampleKey } from '../core/chunks';
import type { BioChunkManifest, BioCorrection, BioRecord, BioSourceDoc, BioStream, ChunkKey, DecisionLogEntry, LocalDate, RawSample, ScoreResult } from '../core/types';
import type { BioStore, BlobStore, ChunkQuery, RecordQuery } from './types';
import { reconcileSleep } from '../core/reconcileSleep';

/** In-memory `BlobStore`. The caller-supplied `aadId` is used as the chunk id (E11 derives ids with an HMAC instead;
 * the BioStore passes `chunkIdFor(...)` as the aadId). */
export class InMemoryBlobStore implements BlobStore {
  private readonly blobs = new Map<string, { bytes: Uint8Array; purpose: 'bio' | 'photo'; localDate?: LocalDate }>();
  /** chunk ids evicted from the local cache (they would be refetched from the sync endpoint in production). */
  readonly evicted = new Set<string>();

  put(bytes: Uint8Array, meta: { purpose: 'bio' | 'photo'; aadId: string }): Promise<{ chunkId: string; bytes: number }> {
    this.blobs.set(meta.aadId, { bytes: bytes.slice(), purpose: meta.purpose });
    this.evicted.delete(meta.aadId);
    return Promise.resolve({ chunkId: meta.aadId, bytes: bytes.length });
  }

  get(chunkId: string): Promise<Uint8Array> {
    const b = this.blobs.get(chunkId);
    if (!b) return Promise.reject(new Error(this.evicted.has(chunkId) ? `blob ${chunkId} not local` : `blob ${chunkId} not found`));
    return Promise.resolve(b.bytes.slice());
  }

  hasLocal(chunkId: string): Promise<boolean> {
    return Promise.resolve(this.blobs.has(chunkId));
  }

  discard(chunkId: string): Promise<void> {
    this.blobs.delete(chunkId);
    return Promise.resolve();
  }

  /** Chunk ids held (tests). */
  ids(): string[] {
    return [...this.blobs.keys()];
  }

  /** Records the local date of a blob so `evictLocal` can age it out (the port's `put` carries no date). */
  setLocalDate(chunkId: string, localDate: LocalDate): void {
    const b = this.blobs.get(chunkId);
    if (b) b.localDate = localDate;
  }

  evictLocal(olderThan: LocalDate, purpose: 'bio' | 'photo'): Promise<number> {
    let n = 0;
    for (const [id, b] of [...this.blobs]) {
      if (b.purpose === purpose && b.localDate !== undefined && b.localDate < olderThan) {
        this.blobs.delete(id);
        this.evicted.add(id);
        n++;
      }
    }
    return Promise.resolve(n);
  }

  get size(): number {
    return this.blobs.size;
  }
}

const clone = <T>(x: T): T => structuredClone(x);

export function scoreKey(r: Pick<ScoreResult, 'scoreId' | 'version' | 'scope'>): string {
  const s = r.scope;
  return `${r.scoreId}@${r.version}|${s.kind}:${s.localDate}${s.workoutId ? `:${s.workoutId}` : ''}`;
}

export class InMemoryBioStore implements BioStore {
  private readonly recs = new Map<string, { sourceKey: string; record: BioRecord }>(); // `${id}@${version}`
  private readonly latest = new Map<string, number>(); // record_id -> highest version
  private readonly manifestList: BioChunkManifest[] = [];
  private readonly superseded = new Set<string>();
  private readonly tombs = new Map<string, Set<string>>(); // `${source}\0${stream}` -> sampleKey set
  private readonly sourceDocs = new Map<string, BioSourceDoc>();
  private readonly scoreMap = new Map<string, ScoreResult>();
  private readonly log: DecisionLogEntry[] = [];

  constructor(readonly blobs: InMemoryBlobStore = new InMemoryBlobStore()) {}

  // ------------------------------------------------------------ records

  putRecord(rec: BioRecord, sourceKey: string): Promise<'inserted' | 'duplicate' | 'stale'> {
    const hi = this.latest.get(rec.record_id);
    if (hi !== undefined && rec.version < hi) return Promise.resolve('stale');
    const k = `${rec.record_id}@${rec.version}`;
    if (this.recs.has(k)) return Promise.resolve('duplicate');
    this.recs.set(k, { sourceKey, record: clone(rec) });
    this.latest.set(rec.record_id, rec.version);
    return Promise.resolve('inserted');
  }

  records(q: RecordQuery = {}): Promise<Array<{ sourceKey: string; record: BioRecord }>> {
    const kinds = q.kind === undefined ? null : new Set(Array.isArray(q.kind) ? q.kind : [q.kind]);
    const out: Array<{ sourceKey: string; record: BioRecord }> = [];
    for (const e of this.recs.values()) {
      const r = e.record;
      if (this.latest.get(r.record_id) !== r.version) continue;
      out.push(e);
    }
    const when = (r: BioRecord): string => r.time.start ?? r.time.at ?? '';
    out.sort((a, b) => a.record.time.local_date.localeCompare(b.record.time.local_date) || when(a.record).localeCompare(when(b.record)) || a.record.record_id.localeCompare(b.record.record_id));
    return Promise.resolve(reconcileSleep(out).filter(({ sourceKey, record: r }) =>
      (!kinds || kinds.has(r.kind)) && (q.sourceKey === undefined || sourceKey === q.sourceKey)
      && (q.from === undefined || r.time.local_date >= q.from) && (q.to === undefined || r.time.local_date <= q.to),
    ).map((e) => clone(e)));
  }

  // ------------------------------------------------------------ chunks

  private current(match: (m: BioChunkManifest) => boolean): BioChunkManifest[] {
    return this.manifestList.filter((m) => !this.superseded.has(m.chunkId) && match(m));
  }

  private tombSet(sourceKey: string, stream: BioStream): Set<string> {
    return this.tombs.get(`${sourceKey}\u0000${stream}`) ?? new Set();
  }

  private async load(m: BioChunkManifest): Promise<RawSample[]> {
    return decodeChunk(await this.blobs.get(m.chunkId)).samples;
  }

  private tombList(sourceKey: string, stream: BioStream): Array<{ origin: RawSample['origin']; t: number }> {
    return [...this.tombSet(sourceKey, stream)].map((k) => {
      const i = k.indexOf('|');
      return { origin: k.slice(0, i) as RawSample['origin'], t: Number(k.slice(i + 1)) };
    });
  }

  private async write(key: ChunkKey, samples: RawSample[], tz: number, prev: BioChunkManifest | undefined, opts: { decoder?: string; createdAt: string }): Promise<BioChunkManifest | null> {
    // the merged chunk replaces the previous one (manifest and bytes); one device only, so nothing waits for an upload
    // (the document store keeps the replaced manifest, marked, until the merged bytes are on the relay)
    if (prev) {
      for (let i = this.manifestList.length - 1; i >= 0; i--) if (this.manifestList[i]!.chunkId === prev.chunkId) this.manifestList.splice(i, 1);
      await this.blobs.discard(prev.chunkId);
    }
    if (samples.length === 0) return null;
    const bytes = encodeChunk(samples, tz, key.stream);
    const contentHash = contentHashOf(bytes);
    const chunkId = chunkIdFor(key, contentHash);
    await this.blobs.put(bytes, { purpose: 'bio', aadId: chunkId });
    this.blobs.setLocalDate(chunkId, key.local_date);
    const st = chunkStats(samples);
    const m: BioChunkManifest = {
      chunkId, sourceKey: key.sourceKey, stream: key.stream, local_date: key.local_date, ...(key.hourStartUtc ? { hourStartUtc: key.hourStartUtc } : {}),
      n: st.n, min: st.min, max: st.max, bytes: bytes.length, contentHash, schemaVersion: 1, ...(opts.decoder ? { decoder: opts.decoder } : {}), createdAt: opts.createdAt,
      ...(prev ? { supersedes: prev.chunkId } : {}),
    };
    for (let i = this.manifestList.length - 1; i >= 0; i--) if (this.manifestList[i]!.chunkId === chunkId) this.manifestList.splice(i, 1);
    this.manifestList.push(m);
    this.superseded.delete(chunkId);
    return m;
  }

  async putSamples(
    key: ChunkKey, samples: RawSample[], opts: { tz_offset_s: number; decoder?: string; createdAt: string },
  ): Promise<{ manifest: BioChunkManifest | null; added: number; duplicates: number }> {
    const ks = chunkKeyString(key);
    const mine = this.current((m) => chunkKeyString(m) === ks)[0];
    // chunks of the same source/stream/day under another key (whole-day vs hour split): dedupe against them too
    const siblings = this.current((m) => m.sourceKey === key.sourceKey && m.stream === key.stream && m.local_date === key.local_date && chunkKeyString(m) !== ks);
    const known = new Set<string>();
    for (const m of siblings) for (const s of await this.load(m)) known.add(sampleKey(s.origin, s.t));
    let sibDup = 0;
    const fresh = samples.filter((s) => {
      if (known.has(sampleKey(s.origin, s.t))) {
        sibDup++;
        return false;
      }
      return true;
    });
    const existing = mine ? await this.load(mine) : [];
    // a new batch replaces a stored value at the same (origin, t) (counted as a duplicate), as the document store does
    const merged = mergeSamples(existing, fresh, this.tombList(key.sourceKey, key.stream), { prefer: 'incoming' });
    if (merged.added + merged.replaced === 0) return { manifest: null, added: 0, duplicates: merged.duplicates + sibDup };
    const manifest = await this.write(key, merged.samples, opts.tz_offset_s, mine, opts);
    return { manifest: manifest ? clone(manifest) : null, added: merged.added, duplicates: merged.duplicates + merged.replaced + sibDup };
  }

  manifests(q: ChunkQuery = {}): Promise<BioChunkManifest[]> {
    const out = this.manifestList.filter((m) => {
      if (!q.includeSuperseded && this.superseded.has(m.chunkId)) return false;
      if (q.sourceKey !== undefined && m.sourceKey !== q.sourceKey) return false;
      if (q.stream !== undefined && m.stream !== q.stream) return false;
      if (q.from !== undefined && m.local_date < q.from) return false;
      if (q.to !== undefined && m.local_date > q.to) return false;
      return true;
    });
    out.sort((a, b) => a.local_date.localeCompare(b.local_date) || a.sourceKey.localeCompare(b.sourceKey) || (a.hourStartUtc ?? '').localeCompare(b.hourStartUtc ?? ''));
    return Promise.resolve(out.map(clone));
  }

  async samples(q: { sourceKey?: string; stream: BioStream; from: LocalDate; to: LocalDate }): Promise<Array<RawSample & { sourceKey: string }>> {
    const ms = this.current((m) => m.stream === q.stream && m.local_date >= q.from && m.local_date <= q.to && (q.sourceKey === undefined || m.sourceKey === q.sourceKey));
    const seen = new Set<string>();
    const out: Array<RawSample & { sourceKey: string }> = [];
    for (const m of ms) {
      const dead = this.tombSet(m.sourceKey, m.stream);
      for (const s of await this.load(m)) {
        const k = `${m.sourceKey}\u0000${sampleKey(s.origin, s.t)}`;
        if (seen.has(k) || dead.has(sampleKey(s.origin, s.t))) continue;
        seen.add(k);
        out.push({ ...s, sourceKey: m.sourceKey });
      }
    }
    return out.sort((a, b) => a.t - b.t);
  }

  async tombstone(sourceKey: string, stream: BioStream, ids: Array<{ origin: RawSample['origin']; t: number }>): Promise<void> {
    const id = `${sourceKey}\u0000${stream}`;
    const set = this.tombs.get(id) ?? new Set<string>();
    for (const i of ids) set.add(sampleKey(i.origin, i.t));
    this.tombs.set(id, set);
    // rewrite affected chunks so deleted samples are gone from storage too
    for (const m of this.current((x) => x.sourceKey === sourceKey && x.stream === stream)) {
      const all = await this.load(m);
      const kept = all.filter((s) => !set.has(sampleKey(s.origin, s.t)));
      if (kept.length === all.length) continue;
      const key: ChunkKey = { sourceKey, stream, local_date: m.local_date, ...(m.hourStartUtc ? { hourStartUtc: m.hourStartUtc } : {}) };
      const tz = decodeChunk(await this.blobs.get(m.chunkId)).header.tz_offset_s;
      await this.write(key, kept, tz, m, { ...(m.decoder ? { decoder: m.decoder } : {}), createdAt: m.createdAt });
    }
  }

  // ------------------------------------------------------------ sources, scores, decisions

  getSource(sourceKey: string): Promise<BioSourceDoc | null> {
    const d = this.sourceDocs.get(sourceKey);
    return Promise.resolve(d ? clone(d) : null);
  }

  putSource(doc: BioSourceDoc): Promise<void> {
    // retired priority fields are never stored (SUITE_SPEC §14.6), as in the document-store adapter
    const { priority: _p, priorityByMetric: _pm, ...rest } = doc;
    void _p;
    void _pm;
    this.sourceDocs.set(doc.sourceKey, clone(rest));
    return Promise.resolve();
  }

  sources(): Promise<BioSourceDoc[]> {
    const rank: Record<string, number> = { A: 0, B: 1, C: 2 };
    return Promise.resolve([...this.sourceDocs.values()].sort((a, b) => (rank[a.tier] ?? 3) - (rank[b.tier] ?? 3) || a.sourceKey.localeCompare(b.sourceKey)).map(clone));
  }

  putScore(r: ScoreResult): Promise<void> {
    this.scoreMap.set(scoreKey(r), clone(r));
    return Promise.resolve();
  }

  scores(q: { scoreId?: string; version?: string; from?: LocalDate; to?: LocalDate }): Promise<ScoreResult[]> {
    const out = [...this.scoreMap.values()].filter(
      (r) => (q.scoreId === undefined || r.scoreId === q.scoreId) && (q.version === undefined || r.version === q.version)
        && (q.from === undefined || r.scope.localDate >= q.from) && (q.to === undefined || r.scope.localDate <= q.to),
    );
    out.sort((a, b) => a.scope.localDate.localeCompare(b.scope.localDate) || a.scoreId.localeCompare(b.scoreId) || a.version.localeCompare(b.version, undefined, { numeric: true }));
    return Promise.resolve(out.map(clone));
  }

  appendDecision(e: DecisionLogEntry): Promise<void> {
    this.log.push(clone(e));
    return Promise.resolve();
  }

  decisions(): Promise<DecisionLogEntry[]> {
    return Promise.resolve(this.log.map(clone));
  }

  /** Corrections by key. Only tests (standing in for the `biometrics.*` commands) call `setCorrection`; ingest never does. */
  private readonly correctionMap = new Map<string, BioCorrection>();

  setCorrection(c: BioCorrection | null, key?: string): void {
    if (c) this.correctionMap.set(c.key, clone(c));
    else if (key) this.correctionMap.delete(key);
  }

  corrections(): Promise<BioCorrection[]> {
    return Promise.resolve([...this.correctionMap.values()].filter((c) => !c.clearedAt).sort((a, b) => a.key.localeCompare(b.key)).map(clone));
  }
}
