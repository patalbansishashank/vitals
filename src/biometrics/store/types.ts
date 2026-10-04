/**
 * Biometrics persistence port (tier H). E11's blob client and E4's DocStore back it in production
 * (collections `bioRecords` IMM, `bioChunks` BLOB manifests, `bioSources`, `bioScores` DER, `decisionLog` APP);
 * `InMemoryBioStore` (./memory.ts) is the reference implementation for tests and the conformance oracle.
 */
import type {
  BioChunkManifest, BioCorrection, BioRecord, BioRecordKind, BioSourceDoc, BioStream, ChunkKey, DecisionLogEntry, LocalDate, RawSample, ScoreResult,
} from '../core/types';

/** Same method names and shapes as SUITE_SPEC §2.4 `BlobStore` (E4 interface, E11 engine). */
export interface BlobStore {
  put(bytes: Uint8Array, meta: { purpose: 'bio' | 'photo'; aadId: string }): Promise<{ chunkId: string; bytes: number }>;
  get(chunkId: string): Promise<Uint8Array>;
  hasLocal(chunkId: string): Promise<boolean>;
  evictLocal(olderThan: LocalDate, purpose: 'bio' | 'photo'): Promise<number>;
  discard?(chunkId: string): Promise<void>;
  localChunks?(purpose: 'bio' | 'photo'): Promise<Array<{ chunkId: string; storedAt: string }>>;
}

export interface RecordQuery {
  kind?: BioRecordKind | BioRecordKind[];
  /** inclusive local dates */
  from?: LocalDate;
  to?: LocalDate;
  sourceKey?: string;
}

export interface ChunkQuery {
  sourceKey?: string;
  stream?: BioStream;
  from?: LocalDate;
  to?: LocalDate;
  /** include manifests marked superseded (older builds kept them; a merged chunk now removes the one it replaces) */
  includeSuperseded?: boolean;
}

export interface BioStore {
  /** IMM by `${record_id}@${version}`. 'duplicate' when that exact id+version exists; 'stale' when a higher version exists. */
  putRecord(rec: BioRecord, sourceKey: string): Promise<'inserted' | 'duplicate' | 'stale'>;
  /** Latest version of each record_id matching the query, ascending by local date then start. */
  records(q?: RecordQuery): Promise<Array<{ sourceKey: string; record: BioRecord }>>;

  /** Merges samples into the chunk for `key` (identity `(origin, t)`; tombstoned samples dropped). Returns the manifest
   * written (superseding the previous one) or null when nothing new was added. */
  putSamples(key: ChunkKey, samples: RawSample[], opts: { tz_offset_s: number; decoder?: string; createdAt: string }): Promise<{ manifest: BioChunkManifest | null; added: number; duplicates: number }>;
  manifests(q?: ChunkQuery): Promise<BioChunkManifest[]>;
  /** Samples of the current (non-superseded) chunks, ascending by t. */
  samples(q: { sourceKey?: string; stream: BioStream; from: LocalDate; to: LocalDate }): Promise<Array<RawSample & { sourceKey: string }>>;
  /** Per-source tombstones (user deletions) so a re-sync never resurrects them. */
  tombstone(sourceKey: string, stream: BioStream, ids: Array<{ origin: RawSample['origin']; t: number }>): Promise<void>;

  getSource(sourceKey: string): Promise<BioSourceDoc | null>;
  putSource(doc: BioSourceDoc): Promise<void>;
  sources(): Promise<BioSourceDoc[]>;

  /** DER cache keyed `${scoreId}@${version}|${scope.kind}:${scope.localDate}[:workoutId]`; versions coexist. */
  putScore(r: ScoreResult): Promise<void>;
  scores(q: { scoreId?: string; version?: string; from?: LocalDate; to?: LocalDate }): Promise<ScoreResult[]>;

  appendDecision(e: DecisionLogEntry): Promise<void>;
  decisions(): Promise<DecisionLogEntry[]>;

  /** The person's active corrections (SUITE_SPEC §14.6; `bioCorrections`). Read-only here: only the `biometrics.*`
   * commands write them, never ingest, so a re-import or a replayed message can never replace one. */
  corrections(): Promise<BioCorrection[]>;
}
