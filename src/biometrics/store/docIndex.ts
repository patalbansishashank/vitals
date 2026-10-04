/**
 * Synchronous index over the biometrics documents of a `DocumentStore` (tier H, no React): `bioRecords` (IMM,
 * `${record_id}@${version}` → the canonical record plus its `sourceKey`), `bioChunks` (BLOB manifests; a superseded one
 * carries `superseded: true` and `replacedBy`), `bioSources` (`BioSourceDoc` plus `tombstones` and device fields; `policy:me` holds the
 * person's stream policies), `bioScores` (DER `ScoreResult`s) and `decisionLog` (APP).
 *
 * Built once from the store's cache when it is ready, then kept current from the change feed (local commits, sync
 * merges), so every reader — the `BioStore` adapter (./docStore.ts), the living plan's observation adapter, the score
 * screens — shares one copy. `sharedBioIndex(store)` returns the index of a store (one per store instance).
 */
import type { CollectionId, Doc, StoreChange } from '@/store';
import { PERSON_POLICY_ID } from '../core/effective';
import { sourceKeyOf } from '../core/source';
import type { BioChunkManifest, BioCorrection, BioRecord, BioSourceDoc, BioStream, DecisionLogEntry, DeviceType, LocalDate, ScoreResult, StreamPolicy } from '../core/types';

/** The part of `DocumentStore` the index reads. */
export interface BioDocSource {
  readonly ready: Promise<void>;
  peekAll<T>(col: CollectionId, options?: { includeDeleted?: boolean }): Doc<T>[];
  subscribe(listener: (change: StoreChange) => void): () => void;
}

export const BIO_COLLECTIONS = ['bioRecords', 'bioChunks', 'bioSources', 'bioScores', 'decisionLog', 'bioCorrections'] as const satisfies readonly CollectionId[];
export type BioCollection = (typeof BIO_COLLECTIONS)[number];
const BIO_SET: ReadonlySet<string> = new Set(BIO_COLLECTIONS);
export const isBioCollection = (col: string): col is BioCollection => BIO_SET.has(col);

/** Stored body of a `bioRecords` document. */
export type RecordBody = BioRecord & { sourceKey: string };
/** Stored body of a `bioChunks` document. A replaced chunk stays, marked, until its replacement's bytes are on the relay
 * (`DocBioStore.pruneSuperseded`); `replacedBy` names the chunk that holds its samples now. */
export type ManifestBody = BioChunkManifest & { superseded?: boolean; replacedBy?: string; supersededAt?: string };
/** Bluetooth state kept on a device source. */
export interface BleSourceState {
  driver: string;
  /** Page cursors per stream (`status:cursor` events). */
  cursor: Partial<Record<BioStream, string>>;
  firmware?: string;
  battery?: number;
  lastSyncAt?: string;
  /** Ring clock minus phone clock at the last sync, seconds. */
  clockOffsetS?: number;
}
/** Stored body of a `bioSources` source document (beyond `BioSourceDoc`). */
export type SourceBody = BioSourceDoc & {
  /** Per stream: deleted sample keys `${origin}|${t}` (§4.2), so a re-sync never resurrects them. */
  tombstones?: Record<string, string[]>;
  deviceType?: DeviceType;
  ble?: BleSourceState;
  createdAt?: string;
};
/** Stored body of `bioSources/policy:me`. */
export interface PersonPolicyBody {
  kind: 'personPolicy';
  policies: StreamPolicy[];
  updatedAt?: string;
}

const META = ['_id', '_col', '_schema', '_rev', '_device', '_created', '_updated', '_deleted'];
function body<T>(d: Doc<unknown>): T {
  const out: Record<string, unknown> = { ...(d as unknown as Record<string, unknown>) };
  for (const k of META) delete out[k];
  return out as T;
}

/** `${scoreId}@${version}|${kind}:${localDate}[:workoutId]` — the `bioScores` id (same as the in-memory store's key). */
export function scoreDocId(r: Pick<ScoreResult, 'scoreId' | 'version' | 'scope'>): string {
  const s = r.scope;
  return `${r.scoreId}@${r.version}|${s.kind}:${s.localDate}${s.workoutId ? `:${s.workoutId}` : ''}`;
}

export const recordDocId = (r: Pick<BioRecord, 'record_id' | 'version'>): string => `${r.record_id}@${r.version}`;
export const dayKey = (sourceKey: string, stream: string, localDate: LocalDate): string => `${sourceKey}\u0000${stream}\u0000${localDate}`;

export interface IndexedRecord {
  docId: string;
  sourceKey: string;
  record: BioRecord;
}

export class BioDocIndex {
  private loaded = false;
  private rev = 0;
  private readonly listeners = new Set<() => void>();
  private readonly off: () => void;

  /** docId → record (every stored version). */
  readonly recDocs = new Map<string, IndexedRecord>();
  /** record_id → docIds of its versions. */
  private readonly versions = new Map<string, Set<string>>();
  /** record_id → the newest version's docId. */
  readonly latest = new Map<string, string>();
  /** local date → record_ids whose newest version falls on it. */
  private readonly byDate = new Map<LocalDate, Set<string>>();
  private sortedDates: LocalDate[] | null = null;
  /** First device type seen per source (for labels). */
  readonly deviceTypes = new Map<string, DeviceType>();

  readonly chunks = new Map<string, ManifestBody>();
  /** dayKey → chunkIds (current and superseded). */
  readonly chunksByDay = new Map<string, Set<string>>();

  readonly sourceDocs = new Map<string, SourceBody>();
  personPolicies: StreamPolicy[] = [];

  readonly scoreDocs = new Map<string, ScoreResult>();
  readonly decisionDocs = new Map<string, DecisionLogEntry>();
  /** `bioCorrections`: key → correction (cleared ones included; readers skip `clearedAt`). */
  readonly correctionDocs = new Map<string, BioCorrection>();

  constructor(private readonly store: BioDocSource) {
    this.off = store.subscribe((c) => {
      if (!isBioCollection(c.col)) return;
      if (!this.loaded) return; // the initial build reads the cache, which already holds this change
      this.apply(c.col, c.id, c.doc && !(c.doc as { _deleted?: true })._deleted ? c.doc : null);
      this.bump();
    });
    void store.ready.then(
      () => this.build(),
      () => undefined,
    );
  }

  /** Resolves once the index holds the store's documents. */
  get ready(): Promise<void> {
    return this.store.ready.then(() => {
      if (!this.loaded) this.build();
    });
  }

  get isLoaded(): boolean {
    return this.loaded;
  }

  /** Bumps on every change to a biometrics collection. */
  revision(): number {
    return this.rev;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  dispose(): void {
    this.off();
    this.listeners.clear();
  }

  private bump(): void {
    this.rev++;
    for (const l of this.listeners) {
      try {
        l();
      } catch (e) {
        console.error(e);
      }
    }
  }

  private build(): void {
    if (this.loaded) return;
    for (const col of BIO_COLLECTIONS) for (const d of this.store.peekAll<unknown>(col)) this.apply(col, d._id, d);
    this.loaded = true;
    this.bump();
  }

  // ------------------------------------------------------------------------------------- apply one change

  private apply(col: BioCollection, id: string, doc: Doc<unknown> | null): void {
    switch (col) {
      case 'bioRecords':
        return this.applyRecord(id, doc ? body<RecordBody>(doc) : null);
      case 'bioChunks':
        return this.applyChunk(id, doc ? body<ManifestBody>(doc) : null);
      case 'bioSources':
        if (id === PERSON_POLICY_ID) {
          this.personPolicies = doc ? [...(body<PersonPolicyBody>(doc).policies ?? [])] : [];
          return;
        }
        if (doc) this.sourceDocs.set(id, body<SourceBody>(doc));
        else this.sourceDocs.delete(id);
        return;
      case 'bioScores':
        if (doc) this.scoreDocs.set(id, body<ScoreResult>(doc));
        else this.scoreDocs.delete(id);
        return;
      case 'decisionLog':
        if (doc) this.decisionDocs.set(id, body<DecisionLogEntry>(doc));
        else this.decisionDocs.delete(id);
        return;
      case 'bioCorrections':
        if (doc) this.correctionDocs.set(id, body<BioCorrection>(doc));
        else this.correctionDocs.delete(id);
        return;
    }
  }

  private dateSet(d: LocalDate): Set<string> {
    let s = this.byDate.get(d);
    if (!s) {
      this.byDate.set(d, (s = new Set()));
      this.sortedDates = null;
    }
    return s;
  }

  private applyRecord(docId: string, b: RecordBody | null): void {
    const prev = this.recDocs.get(docId);
    const rid = b?.record_id ?? prev?.record.record_id;
    if (!rid) return;
    const oldLatest = this.latest.get(rid);
    const oldDate = oldLatest ? this.recDocs.get(oldLatest)?.record.time.local_date : undefined;
    if (oldDate) this.byDate.get(oldDate)?.delete(rid);
    if (b) {
      const { sourceKey, ...record } = b;
      const sk = sourceKey ?? sourceKeyOf(record.provenance);
      this.recDocs.set(docId, { docId, sourceKey: sk, record: record as BioRecord });
      let vs = this.versions.get(rid);
      if (!vs) this.versions.set(rid, (vs = new Set()));
      vs.add(docId);
      const t = record.provenance?.device?.type;
      if (t && !this.deviceTypes.has(sk)) this.deviceTypes.set(sk, t);
    } else {
      this.recDocs.delete(docId);
      this.versions.get(rid)?.delete(docId);
    }
    // newest version of this record_id
    let best: IndexedRecord | null = null;
    for (const v of this.versions.get(rid) ?? []) {
      const e = this.recDocs.get(v);
      if (e && (!best || e.record.version > best.record.version)) best = e;
    }
    if (best) {
      this.latest.set(rid, best.docId);
      this.dateSet(best.record.time.local_date).add(rid);
    } else {
      this.latest.delete(rid);
      this.versions.delete(rid);
    }
  }

  private applyChunk(chunkId: string, b: ManifestBody | null): void {
    const prev = this.chunks.get(chunkId);
    if (prev) this.chunksByDay.get(dayKey(prev.sourceKey, prev.stream, prev.local_date))?.delete(chunkId);
    if (!b) {
      this.chunks.delete(chunkId);
      return;
    }
    this.chunks.set(chunkId, b);
    const k = dayKey(b.sourceKey, b.stream, b.local_date);
    let s = this.chunksByDay.get(k);
    if (!s) this.chunksByDay.set(k, (s = new Set()));
    s.add(chunkId);
  }

  // ------------------------------------------------------------------------------------- reads (no cloning)

  /** Dates that have records, ascending. */
  dates(): LocalDate[] {
    if (!this.sortedDates) this.sortedDates = [...this.byDate.entries()].filter(([, s]) => s.size > 0).map(([d]) => d).sort();
    return this.sortedDates;
  }

  /** Newest version of every record on dates in [from, to] (inclusive; open ends allowed). Not cloned: do not mutate. */
  latestRecords(from?: LocalDate, to?: LocalDate): IndexedRecord[] {
    const out: IndexedRecord[] = [];
    for (const d of this.dates()) {
      if (from !== undefined && d < from) continue;
      if (to !== undefined && d > to) break;
      for (const rid of this.byDate.get(d) ?? []) {
        const e = this.recDocs.get(this.latest.get(rid)!);
        if (e) out.push(e);
      }
    }
    return out;
  }

  /** Doc ids of every stored version of a record id. */
  versionsOf(recordId: string): Iterable<string> {
    return this.versions.get(recordId) ?? [];
  }

  /** Highest stored version of a record id. */
  latestVersion(recordId: string): number | undefined {
    const id = this.latest.get(recordId);
    return id ? this.recDocs.get(id)?.record.version : undefined;
  }

  /** Real sources (not the person's policy document), as stored. */
  sources(): SourceBody[] {
    return [...this.sourceDocs.values()].filter((s) => typeof s.label === 'string' && typeof s.sourceKey === 'string');
  }

  /** Active corrections (not cleared), by key. */
  corrections(): BioCorrection[] {
    return [...this.correctionDocs.values()].filter((c) => !c.clearedAt).sort((a, b) => a.key.localeCompare(b.key));
  }

  /** The stored correction for a key, cleared or not. */
  correction(key: string): BioCorrection | undefined {
    return this.correctionDocs.get(key);
  }

  source(sourceKey: string): SourceBody | undefined {
    const s = this.sourceDocs.get(sourceKey);
    return s && typeof s.label === 'string' ? s : undefined;
  }

  scores(): Iterable<ScoreResult> {
    return this.scoreDocs.values();
  }

  /** Decision log, oldest first. */
  decisions(): DecisionLogEntry[] {
    return [...this.decisionDocs.entries()].sort(([a, x], [b, y]) => x.at.localeCompare(y.at) || a.localeCompare(b)).map(([, e]) => e);
  }

  /** True when no biometric data has been brought in yet (no records, chunks or sources). */
  isEmpty(): boolean {
    return this.latest.size === 0 && this.chunks.size === 0 && this.sources().length === 0;
  }
}

const shared = new WeakMap<object, BioDocIndex>();

/** The one index of a store (created on first use). */
export function sharedBioIndex(store: BioDocSource): BioDocIndex {
  let ix = shared.get(store);
  if (!ix) shared.set(store, (ix = new BioDocIndex(store)));
  return ix;
}
