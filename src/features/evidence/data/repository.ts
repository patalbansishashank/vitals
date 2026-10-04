/**
 * The Evidence library's data source: lazy topic chunks, a per-session cache,
 * mechanism-id resolution across topics and the incrementally built search index.
 * One shared instance (`evidenceRepository`) serves the library screen, the Explain
 * drawer and any other feature, so a topic is fetched and indexed once.
 */
import { EVIDENCE_TOPICS, type EvidenceTopicEntry } from '@/content/evidence';
import type { EvidenceTopic, Mechanism, Myth, Reference } from '@/content/evidence/schema';
import { outcomeMetrics } from '../metricLabels';
import { SearchIndex } from './search';

export interface ResolvedMechanism {
  mechanism: Mechanism;
  topic: EvidenceTopic;
  /** Position in the topic (for previous / next). */
  index: number;
}

export interface EvidenceSnapshot {
  /** Increments whenever a topic loads or fails. */
  version: number;
  loaded: number;
  total: number;
  /** Slugs of topics whose chunk failed to load. */
  failed: readonly string[];
  /** Every topic has either loaded or failed. */
  settled: boolean;
  /** Every topic loaded. */
  complete: boolean;
  index: SearchIndex;
}

/** The two-digit dossier prefix every mechanism and claim id carries ("04-liver-…" → "04"). */
export function dossierOf(id: string): string | null {
  const m = /^(\d{2})-/.exec(id);
  return m ? m[1]! : null;
}

type Idle = (cb: () => void) => void;
const whenIdle: Idle = (cb) => {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
    .requestIdleCallback;
  if (typeof ric === 'function') ric(cb, { timeout: 600 });
  else setTimeout(cb, 120);
};

export class EvidenceRepository {
  readonly entries: readonly EvidenceTopicEntry[];
  private readonly topics = new Map<string, EvidenceTopic>();
  private readonly pending = new Map<string, Promise<EvidenceTopic>>();
  private readonly errors = new Map<string, unknown>();
  private readonly mechanisms = new Map<string, ResolvedMechanism>();
  private readonly myths = new Map<string, { myth: Myth; topic: EvidenceTopic }>();
  private readonly listeners = new Set<() => void>();
  private readonly index = new SearchIndex();
  private snapshot: EvidenceSnapshot;
  private allPromise: Promise<void> | null = null;

  constructor(
    entries: readonly EvidenceTopicEntry[] = EVIDENCE_TOPICS,
    options: { indexMetrics?: boolean } = {},
  ) {
    this.entries = entries;
    if (options.indexMetrics !== false) this.index.addMetrics(outcomeMetrics());
    this.snapshot = this.makeSnapshot(0);
  }

  /* ---- subscription (useSyncExternalStore) ---- */

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): EvidenceSnapshot => this.snapshot;

  private makeSnapshot(version: number): EvidenceSnapshot {
    const failed = [...this.errors.keys()];
    const loaded = this.topics.size;
    const total = this.entries.length;
    return {
      version,
      loaded,
      total,
      failed,
      settled: loaded + failed.length >= total,
      complete: loaded >= total,
      index: this.index,
    };
  }

  private emit(): void {
    this.snapshot = this.makeSnapshot(this.snapshot.version + 1);
    for (const l of [...this.listeners]) l();
  }

  /* ---- entries ---- */

  entryBySlug(slug: string): EvidenceTopicEntry | undefined {
    return this.entries.find((e) => e.slug === slug);
  }

  entryByDossier(dossier: string): EvidenceTopicEntry | undefined {
    return this.entries.find((e) => e.dossier === dossier);
  }

  private rank(slug: string): number {
    return this.entries.findIndex((e) => e.slug === slug);
  }

  /* ---- topics ---- */

  getTopic(slug: string): EvidenceTopic | undefined {
    return this.topics.get(slug);
  }

  topicError(slug: string): unknown {
    return this.errors.get(slug);
  }

  /** Loaded topics in registry order. */
  loadedTopics(): EvidenceTopic[] {
    return this.entries.map((e) => this.topics.get(e.slug)).filter((t): t is EvidenceTopic => Boolean(t));
  }

  /** Load (or return the cached) topic. Rejects when the chunk fails; a later call retries. */
  loadTopic(slug: string): Promise<EvidenceTopic> {
    const have = this.topics.get(slug);
    if (have) return Promise.resolve(have);
    const inflight = this.pending.get(slug);
    if (inflight) return inflight;
    const entry = this.entryBySlug(slug);
    if (!entry) return Promise.reject(new Error(`Unknown evidence topic "${slug}"`));
    const p = entry
      .load()
      .then(({ default: topic }) => {
        this.accept(entry, topic);
        return topic;
      })
      .catch((error: unknown) => {
        this.pending.delete(slug);
        this.errors.set(slug, error);
        this.emit();
        throw error;
      });
    this.pending.set(slug, p);
    if (this.errors.delete(slug)) this.emit();
    return p;
  }

  private accept(entry: EvidenceTopicEntry, topic: EvidenceTopic): void {
    this.pending.delete(entry.slug);
    this.errors.delete(entry.slug);
    this.topics.set(entry.slug, topic);
    topic.mechanisms.forEach((mechanism, index) => {
      if (!this.mechanisms.has(mechanism.id)) this.mechanisms.set(mechanism.id, { mechanism, topic, index });
    });
    for (const myth of topic.myths) if (!this.myths.has(myth.id)) this.myths.set(myth.id, { myth, topic });
    this.index.addTopic(topic, this.rank(entry.slug));
    this.emit();
  }

  /**
   * Load every topic in the background, a couple at a time, yielding to the main
   * thread between chunks. Resolves when all have loaded or failed (never rejects).
   */
  loadAll(concurrency = 2): Promise<void> {
    if (this.allPromise) return this.allPromise;
    const queue = this.entries.filter((e) => !this.topics.has(e.slug)).map((e) => e.slug);
    const worker = async (): Promise<void> => {
      for (let slug = queue.shift(); slug !== undefined; slug = queue.shift()) {
        await this.loadTopic(slug).catch(() => undefined);
        await new Promise<void>((r) => setTimeout(r, 0));
      }
    };
    this.allPromise = Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker)).then(() => {
      this.allPromise = null;
    });
    return this.allPromise;
  }

  /** Schedule `loadAll` for an idle moment after first paint. */
  loadAllWhenIdle(): void {
    if (this.snapshot.complete || this.allPromise) return;
    whenIdle(() => void this.loadAll());
  }

  /** Retry topics whose chunk failed. */
  retryFailed(): Promise<void> {
    const failed = [...this.errors.keys()];
    return Promise.all(failed.map((s) => this.loadTopic(s).catch(() => undefined))).then(() => undefined);
  }

  /* ---- mechanisms ---- */

  /** Synchronous lookup among loaded topics. */
  getMechanism(id: string): ResolvedMechanism | undefined {
    return this.mechanisms.get(id);
  }

  getMyth(id: string): { myth: Myth; topic: EvidenceTopic } | undefined {
    return this.myths.get(id);
  }

  /**
   * Resolve a mechanism id to its content: load the topic its dossier prefix names;
   * if the id is not there (or has no prefix), load every topic and look again.
   * Resolves `null` when no topic has it; rejects only when the owning topic failed to load.
   */
  async resolveMechanism(id: string): Promise<ResolvedMechanism | null> {
    const known = this.mechanisms.get(id);
    if (known) return known;
    const dossier = dossierOf(id);
    const entry = dossier ? this.entryByDossier(dossier) : undefined;
    if (entry) {
      await this.loadTopic(entry.slug);
      const found = this.mechanisms.get(id);
      if (found) return found;
    }
    await this.loadAll();
    return this.mechanisms.get(id) ?? null;
  }

  /** Loaded mechanisms that list `metricId` in `relatedMetricIds`, in library order. */
  mechanismsForMetric(metricId: string): ResolvedMechanism[] {
    const out: ResolvedMechanism[] = [];
    for (const topic of this.loadedTopics()) {
      topic.mechanisms.forEach((mechanism, index) => {
        if (mechanism.relatedMetricIds.includes(metricId)) out.push({ mechanism, topic, index });
      });
    }
    return out;
  }

  /** Loaded mechanisms that list `paramId` in `relatedParamIds`, in library order. */
  mechanismsForParam(paramId: string): ResolvedMechanism[] {
    const out: ResolvedMechanism[] = [];
    for (const topic of this.loadedTopics()) {
      topic.mechanisms.forEach((mechanism, index) => {
        if (mechanism.relatedParamIds?.includes(paramId)) out.push({ mechanism, topic, index });
      });
    }
    return out;
  }

  /** Look up a reference of a topic by id. */
  static reference(topic: EvidenceTopic, refId: string): Reference | undefined {
    return topic.references.find((r) => r.id === refId);
  }
}

/** The app-wide repository over the registry in `src/content/evidence`. */
export const evidenceRepository = new EvidenceRepository(EVIDENCE_TOPICS);
