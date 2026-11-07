/** Disposable server snapshots, never credentials, import watermarks or live device state. */
export const GAUGE_CACHE_DB = 'vitals-gauge-cache';
export const GAUGE_CACHE_SCHEMA = 1;
export const GAUGE_CACHE_MAX_AGE_MS = 7 * 86_400_000;
export const GAUGE_CACHE_MAX_BYTES = 8 * 1024 * 1024;
export const GAUGE_CACHE_MAX_ENTRIES = 192;
const MAX_ENTRY_BYTES = 512 * 1024;

export interface GaugeCacheEntry {
  id: string;
  scope: string;
  schema: number;
  savedAt: number;
  bytes: number;
  context: string | null;
  data: Record<string, unknown>;
  etag: string | null;
  lastModified: string | null;
}
type CacheIndex = Pick<GaugeCacheEntry, 'id' | 'scope' | 'schema' | 'savedAt' | 'bytes'>;

export interface GaugeCacheStore {
  get(scope: string, key: string, now: number): Promise<GaugeCacheEntry | null>;
  put(scope: string, key: string, value: Omit<GaugeCacheEntry, 'id' | 'scope' | 'schema' | 'bytes'>): Promise<void>;
  clear(scope: string): Promise<void>;
  retain(scope: string): Promise<void>;
}

/** Recent query windows only; retain the full server answer without slicing or recomputing numbers. */
export function persistGaugeQuery(key: string, now: number): boolean {
  const u = new URL(key, 'https://cache.invalid');
  if (!/^\/v1\/gauge\/(availability|daily|sleep|activity|scores|short-video|workouts|steps|timeline|baselines|series|hr-intervals)$/.test(u.pathname)) return false;
  if (u.searchParams.has('cursor')) return false; // a cursor is revision-specific, never durable
  if (u.pathname.endsWith('/availability')) return true;
  const start = u.searchParams.get('date') ?? u.searchParams.get('from');
  const end = u.searchParams.get('date') ?? u.searchParams.get('to');
  if (!start || !end) return false;
  const from = Date.parse(start), to = Date.parse(end);
  // One day of margin accommodates device zones and sleep windows that cross midnight.
  return Number.isFinite(from) && Number.isFinite(to) && from <= to && from >= now - 8 * 86_400_000 && to <= now + 2 * 86_400_000 && to - from <= 8 * 86_400_000;
}


/** Reject structurally damaged snapshots before they reach a screen. Network adapters still own numeric meaning. */
export function gaugeSnapshotShape(key: string, data: Record<string, unknown>): boolean {
  const route = new URL(key, 'https://cache.invalid').pathname.split('/').at(-1);
  const object = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v);
  switch (route) {
    case 'availability': return Array.isArray(data.categories) && Array.isArray(data.metricKinds);
    case 'daily': return typeof data.date === 'string' && (data.activity == null || object(data.activity));
    case 'sleep': case 'workouts': return Array.isArray(data.sessions);
    case 'activity': case 'short-video': return Array.isArray(data.days);
    case 'scores': return object(data.scores);
    case 'steps': return Array.isArray(data.days) && Array.isArray(data.intervals);
    case 'timeline': return typeof data.date === 'string' && object(data.steps) && object(data.hr) && object(data.sleep);
    case 'baselines': return object(data.learning);
    case 'series': return Array.isArray(data.points);
    case 'hr-intervals': return Array.isArray(data.intervals);
    default: return false;
  }
}

function validIndex(e: CacheIndex, now: number): boolean {
  return e.schema === GAUGE_CACHE_SCHEMA && typeof e.id === 'string' && typeof e.scope === 'string'
    && Number.isFinite(e.savedAt) && e.savedAt <= now + 60_000 && now - e.savedAt <= GAUGE_CACHE_MAX_AGE_MS
    && Number.isFinite(e.bytes) && e.bytes > 0 && e.bytes <= MAX_ENTRY_BYTES;
}
export function validGaugeCacheEntry(value: unknown, now: number): value is GaugeCacheEntry {
  if (!value || typeof value !== 'object') return false;
  const e = value as GaugeCacheEntry;
  return validIndex(e, now) && (e.context === null || typeof e.context === 'string')
    && (e.etag === null || typeof e.etag === 'string') && (e.lastModified === null || typeof e.lastModified === 'string')
    && !!e.data && typeof e.data === 'object' && !Array.isArray(e.data);
}

/** IDB is optional (private mode/quota/corruption): cache failure can never fail a server read. */
export function createGaugeCacheStore(): GaugeCacheStore {
  let opening: Promise<IDBDatabase | null> | null = null;
  const open = (): Promise<IDBDatabase | null> => {
    if (opening) return opening;
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    opening = new Promise((resolve) => {
      try {
        const request = indexedDB.open(GAUGE_CACHE_DB, GAUGE_CACHE_SCHEMA);
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; resolve(null); }, 250);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains('snapshots')) request.result.createObjectStore('snapshots', { keyPath: 'id' });
          if (!request.result.objectStoreNames.contains('entries')) request.result.createObjectStore('entries', { keyPath: 'id' });
        };
        request.onsuccess = () => {
          clearTimeout(timer);
          if (timedOut) { request.result.close(); return; }
          request.result.onversionchange = () => { request.result.close(); opening = null; };
          resolve(request.result);
        };
        request.onerror = request.onblocked = () => { timedOut = true; clearTimeout(timer); resolve(null); };
      } catch { resolve(null); }
    });
    return opening;
  };
  const mutate = async (change: (store: IDBObjectStore, index: IDBObjectStore, entries: CacheIndex[]) => void): Promise<void> => {
    const db = await open();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(['snapshots', 'entries'], 'readwrite');
        tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
        const store = tx.objectStore('snapshots');
        // Eviction scans small metadata only, never clones megabytes of health arrays for each write.
        const index = tx.objectStore('entries');
        const all = index.getAll();
        all.onsuccess = () => { try { change(store, index, all.result); } catch { tx.abort(); } };
      } catch { resolve(); }
    });
  };
  return {
    async get(scope, key, now) {
      const db = await open();
      if (!db) return null;
      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), 250);
        const finish = (entry: GaugeCacheEntry | null) => { clearTimeout(timer); resolve(entry); };
        try {
          const tx = db.transaction('snapshots', 'readonly');
          const req = tx.objectStore('snapshots').get(JSON.stringify([scope, key]));
          req.onsuccess = () => finish(validGaugeCacheEntry(req.result, now) && req.result.scope === scope ? req.result : null);
          req.onerror = tx.onabort = () => finish(null);
        } catch { finish(null); }
      });
    },
    async put(scope, key, value) {
      const entry: GaugeCacheEntry = { ...value, id: JSON.stringify([scope, key]), scope, schema: GAUGE_CACHE_SCHEMA, bytes: 0 };
      try { entry.bytes = new TextEncoder().encode(JSON.stringify(entry)).byteLength + 8; } catch { return; }
      const bytes = entry.bytes;
      if (bytes > MAX_ENTRY_BYTES) return;
      await mutate((store, index, entries) => {
        const kept = entries.filter((e) => {
          const id = e.id;
          if (!validIndex(e, value.savedAt)) { store.delete(id); index.delete(id); return false; }
          return e.id !== entry.id;
        }).sort((a, b) => b.savedAt - a.savedAt);
        let total = bytes, count = 1;
        for (const e of kept) {
          total += e.bytes;
          if (++count > GAUGE_CACHE_MAX_ENTRIES || total > GAUGE_CACHE_MAX_BYTES) { store.delete(e.id); index.delete(e.id); }
        }
        store.put(entry);
        index.put({ id: entry.id, scope, schema: entry.schema, savedAt: entry.savedAt, bytes });
      });
    },
    clear: (scope) => mutate((store, index, entries) => { for (const e of entries) if (e.scope === scope) { store.delete(e.id); index.delete(e.id); } }),
    retain: (scope) => mutate((store, index, entries) => { for (const e of entries) if (e.scope !== scope) { store.delete(e.id); index.delete(e.id); } }),
  };
}

export const gaugeCacheStore = createGaugeCacheStore();
