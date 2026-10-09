/**
 * Fakes for the ring service tests: a scripted connector (one fake ring reachable by several platform ids), a clock
 * with hand-driven timers, an in-memory store shared between "devices" (each device is one service instance with its
 * own device-local state and deviceId), and a sync view. No hardware, no timers of the host.
 */
import type { BioBatch, BioStream } from '@/biometrics/core/types';
import type { SourceBody } from '@/biometrics/store/docIndex';
import type { Platform } from '@/platform';
import type { RingEvent } from '../../../../packages/rings/src/types';
import {
  RingLinkError,
  type RingClockPort, type RingConnector, type RingLinkSession, type RingLocalPort, type RingLocalState, type RingServicePorts, type RingStorePort, type RingSyncPort, type SyncCursor,
} from '../ports';
import type { RingLeaseBody, RingSyncReport } from '../types';

// ---------------------------------------------------------------- clock

export class FakeClock implements RingClockPort {
  private t: number;
  private timers: Array<{ at: number; fn: () => void; id: number }> = [];
  private seq = 0;
  constructor(startIso = '2026-10-04T08:00:00.000Z') {
    this.t = Date.parse(startIso);
  }
  now(): number {
    return this.t;
  }
  tz(): string {
    return 'UTC';
  }
  setTimeout(fn: () => void, ms: number): () => void {
    const id = ++this.seq;
    this.timers.push({ at: this.t + Math.max(0, ms), fn, id });
    return () => {
      this.timers = this.timers.filter((x) => x.id !== id);
    };
  }
  /** Moves time forward, running due timers in order and letting promises settle between them. */
  async advance(ms: number): Promise<void> {
    const end = this.t + ms;
    const due = (): { at: number; fn: () => void; id: number } | undefined => this.timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
    const run = (next: { at: number; fn: () => void; id: number }): void => {
      this.timers = this.timers.filter((x) => x !== next);
      this.t = Math.max(this.t, next.at);
      next.fn();
    };
    // pending promise chains may still arm timers: let them settle before each look
    for (let next = (await settle(), due()); next; next = (await settle(), due())) run(next);
    this.t = end;
    await settle();
  }
}

export async function settle(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise<void>((r) => setTimeout(r, 0));
}

/** One order over connect attempts and lease writes, so a test can tell which came first within the same instant. */
let order = 0;
const nextOrder = (): number => ++order;

// ---------------------------------------------------------------- the fake ring and its sessions

export interface FakeRingOptions {
  driverId?: string;
  ringId?: string;
  firmware?: string;
  battery?: number;
  /** Events every `sync` yields (cursor events included). */
  history?: RingEvent[];
  /** Platform ids this ring answers to (a MAC, an opaque web id, a Capacitor address). */
  platformIds?: string[];
}

export class FakeRing {
  readonly driverId: string;
  readonly ringId: string | undefined;
  firmware: string;
  battery: number;
  history: RingEvent[];
  platformIds: Set<string>;
  /** The one open session (a ring allows one central). */
  held: FakeSession | null = null;
  /** When set, every connect fails with this code. */
  refuse: RingLinkError['code'] | null = null;
  /** When set, `sync` waits on it before yielding (a test drops the ring mid-read). */
  gate: Promise<void> | null = null;
  /** The next `sync` fails once. */
  failSyncOnce = false;
  /** `seq` orders an attempt against lease writes (`SharedStore.leaseWrites`) made at the same instant. */
  connectAttempts: Array<{ at: number; platformId: string; seq: number }> = [];
  /**
   * A second central while one is connected: 'refuse' (the default) fails it with `not_found`; 'kick' gives the ring to
   * the newest central, dropping the one connected (its disconnect listeners fire), as some rings do.
   */
  onSecondCentral: 'refuse' | 'kick' = 'refuse';
  /** Every link the ring dropped for a newer central ('kick'), by platform id. */
  kicks: Array<{ at: number; from: string; to: string }> = [];
  /**
   * A connect comes up only after this much FakeClock time (the idle ring advertises every 20–40 s). Unset: at once, as
   * before. An abort of the connector's signal ends the wait with `cancelled`.
   */
  connectDelayMs?: number;
  /** The next connect fails once with this code (and GATT status), then clears. */
  failOnce?: { code: RingLinkError['code']; gattStatus?: number };
  /**
   * A history read takes this much FakeClock time (a desktop read takes about 40 s); unset: at once. The read ends with
   * `disconnected` when the link drops meanwhile, `cancelled` when its signal aborts.
   */
  readMs?: number;
  constructor(o: FakeRingOptions = {}) {
    this.driverId = o.driverId ?? 'jstyle2301';
    this.ringId = o.ringId ?? 'mac:aa:bb:cc:dd:ee:01';
    this.firmware = o.firmware ?? 'V0525';
    this.battery = o.battery ?? 77;
    this.history = o.history ?? [
      { type: 'sample', stream: 'hr', t: Date.parse('2026-10-04T07:00:00Z'), value: 61, unit: 'bpm', origin: 'history' },
      { type: 'status', key: 'cursor', value: 'j1|55.1', stream: 'hr' },
    ];
    this.platformIds = new Set(o.platformIds ?? ['aa:bb:cc:dd:ee:01']);
  }
  open(platformId: string, clock: RingClockPort): FakeSession {
    this.reach(platformId, clock);
    return this.accept(platformId, clock);
  }
  /** `open` on a ring that answers only after `connectDelayMs` (what `fakeConnector` uses when it is set). */
  openLater(platformId: string, clock: RingClockPort, signal?: AbortSignal): Promise<FakeSession> {
    try {
      this.reach(platformId, clock);
    } catch (err) {
      return Promise.reject(err);
    }
    return new Promise<FakeSession>((resolve, reject) => {
      if (signal?.aborted) return reject(new RingLinkError('cancelled'));
      let cancel = (): void => undefined;
      const onAbort = (): void => {
        cancel();
        reject(new RingLinkError('cancelled'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      cancel = clock.setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        try {
          resolve(this.accept(platformId, clock));
        } catch (err) {
          reject(err);
        }
      }, this.connectDelayMs ?? 0);
    });
  }
  /** An attempt reaches the radio: recorded; `refuse` and `failOnce` answer at once. */
  private reach(platformId: string, clock: RingClockPort): void {
    this.connectAttempts.push({ at: clock.now(), platformId, seq: nextOrder() });
    if (this.refuse) throw new RingLinkError(this.refuse);
    const f = this.failOnce;
    if (f) {
      this.failOnce = undefined;
      const err = new RingLinkError(f.code);
      if (f.gattStatus !== undefined) err.gattStatus = f.gattStatus;
      throw err;
    }
  }
  /** The link comes up: a second central is refused, or ('kick') takes the ring from the one connected. */
  private accept(platformId: string, clock: RingClockPort): FakeSession {
    if (this.held) {
      if (this.onSecondCentral !== 'kick') throw new RingLinkError('not_found', 'the ring is connected to another central');
      const old = this.held;
      this.kicks.push({ at: clock.now(), from: old.platformId, to: platformId });
      old.drop();
    }
    const s = new FakeSession(this, platformId, clock);
    this.held = s;
    return s;
  }
}

export class FakeSession implements RingLinkSession {
  readonly identity;
  readonly platformId: string;
  closed = false;
  syncCalls: SyncCursor[] = [];
  liveActive = false;
  spotCalls: string[] = [];
  /** The command the ring is running now: a real ring answers one at a time and refuses a second. */
  running: string | null = null;
  /** Every refused overlap (a test asserts none). */
  overlaps: string[] = [];
  private claim(name: string): void {
    if (this.running) {
      this.overlaps.push(`${name} during ${this.running}`);
      throw new RingLinkError('failed', 'another command is running on this ring');
    }
    this.running = name;
  }
  private release(name: string): void {
    if (this.running === name) this.running = null;
  }
  private dropListeners = new Set<() => void>();
  /** Waits (a timed read) that end when the link goes down. */
  private closeWaiters = new Set<() => void>();
  private livePush: ((v: { bpm: number; t: number } | null) => void) | null = null;
  constructor(
    readonly ring: FakeRing,
    platformId: string,
    private readonly clock?: RingClockPort,
  ) {
    this.platformId = platformId;
    this.identity = { driverId: ring.driverId, family: ring.driverId, maker: 'J-Style', model: '2301', ...(ring.ringId ? { ringId: ring.ringId } : {}) };
  }
  /** `ms` of FakeClock time; `disconnected` when the link goes down meanwhile, `cancelled` when `signal` aborts. */
  private pause(ms: number, signal: AbortSignal): Promise<void> {
    const clock = this.clock;
    if (!clock) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      if (this.closed) return reject(new RingLinkError('disconnected'));
      if (signal.aborted) return reject(new RingLinkError('cancelled'));
      let cancel = (): void => undefined;
      const end = (err?: RingLinkError): void => {
        cancel();
        this.closeWaiters.delete(onClose);
        signal.removeEventListener('abort', onAbort);
        if (err) reject(err);
        else resolve();
      };
      const onClose = (): void => end(new RingLinkError('disconnected'));
      const onAbort = (): void => end(new RingLinkError('cancelled'));
      this.closeWaiters.add(onClose);
      signal.addEventListener('abort', onAbort, { once: true });
      cancel = clock.setTimeout(() => end(), ms);
    });
  }
  private wakeWaiters(): void {
    for (const w of [...this.closeWaiters]) w();
  }
  async info() {
    return { firmware: this.ring.firmware, battery: this.ring.battery, clockOffsetS: 0 };
  }
  async battery() {
    return this.ring.battery;
  }
  async *sync(cursor: SyncCursor, onProgress: (p: number) => void, signal: AbortSignal): AsyncIterable<RingEvent> {
    this.syncCalls.push({ ...cursor });
    this.claim('sync');
    try {
      if (this.ring.failSyncOnce) {
        this.ring.failSyncOnce = false;
        throw new RingLinkError('failed');
      }
      if (this.ring.gate) await this.ring.gate;
      if (this.ring.readMs) await this.pause(this.ring.readMs, signal);
      onProgress(0);
      for (const e of this.ring.history) {
        if (signal.aborted) throw new RingLinkError('cancelled');
        yield e;
      }
      onProgress(1);
    } finally {
      this.release('sync');
    }
  }
  async *liveHeartRate(signal: AbortSignal): AsyncIterable<{ bpm: number; t: number }> {
    this.claim('live');
    this.liveActive = true;
    try {
      for (;;) {
        const v = await new Promise<{ bpm: number; t: number } | null>((r) => {
          this.livePush = r;
          signal.addEventListener('abort', () => r(null), { once: true });
        });
        if (v === null || signal.aborted) return;
        yield v;
      }
    } finally {
      this.liveActive = false;
      this.livePush = null;
      this.release('live');
    }
  }
  /** Test: the ring pushes a live reading. */
  pushLive(bpm: number, t: number): void {
    this.livePush?.({ bpm, t });
  }
  async spot(kind: string) {
    this.spotCalls.push(kind);
    this.claim('spot');
    await Promise.resolve();
    this.release('spot');
    return { value: kind === 'hr' ? 64 : 97, unit: kind === 'hr' ? 'bpm' : 'pct', t: Date.parse('2026-10-04T08:05:00Z') };
  }
  onDisconnected(cb: () => void): () => void {
    this.dropListeners.add(cb);
    return () => this.dropListeners.delete(cb);
  }
  /** Test: the ring drops the link. */
  drop(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.ring.held === this) this.ring.held = null;
    this.wakeWaiters();
    for (const l of this.dropListeners) l();
  }
  async close(): Promise<void> {
    this.closed = true;
    if (this.ring.held === this) this.ring.held = null;
    this.wakeWaiters();
  }
}

export interface FakeConnectorOptions {
  rings: FakeRing[];
  clock: RingClockPort;
  /** Platform can reconnect without a gesture (Android, desktop); false = the web. */
  canReconnect?: boolean;
  availability?: 'ready' | 'unsupported' | 'bluetooth_off' | 'permission_needed';
}

export function fakeConnector(o: FakeConnectorOptions): RingConnector {
  const find = (platformId: string): FakeRing | undefined => o.rings.find((r) => r.platformIds.has(platformId));
  // at once (synchronously, as before) unless the ring advertises slowly
  const open = (r: FakeRing, platformId: string, signal?: AbortSignal): FakeSession | Promise<FakeSession> => (r.connectDelayMs ? r.openLater(platformId, o.clock, signal) : r.open(platformId, o.clock));
  const c: RingConnector = {
    available: async () => o.availability ?? 'ready',
    async *scan() {
      for (const r of o.rings) {
        const pid = [...r.platformIds][0]!;
        yield { candidateId: pid, driverId: r.driverId, platformId: pid, rssi: -60 };
      }
    },
    async connect(hit, signal) {
      const r = find(hit.candidateId);
      if (!r) throw new RingLinkError('not_found');
      return open(r, hit.candidateId, signal);
    },
    adopt: async (_link, driverId, signal) => {
      const r = o.rings.find((x) => x.driverId === driverId);
      if (!r) throw new RingLinkError('not_found');
      return open(r, 'web:opaque', signal);
    },
    driverInfo: (driverId) => (driverId === 'jstyle2301' ? { label: 'J-Style 2301', maker: 'J-Style', model: '2301', streams: ['hr', 'steps'] as BioStream[], checks: ['hr', 'spo2'] } : undefined),
  };
  if (o.canReconnect !== false)
    c.reconnect = async (platformId, _driverId, signal) => {
      const r = find(platformId);
      if (!r) throw new RingLinkError('not_found');
      return open(r, platformId, signal);
    };
  return c;
}

// ---------------------------------------------------------------- store shared between devices

function mergePatch(target: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out = { ...target };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = mergePatch((out[k] as Record<string, unknown>) ?? {}, v as Record<string, unknown>);
    else out[k] = v;
  }
  return out;
}

/** One write through a port, as the server applied it (what a lagged view replays). */
export interface StoreWrite {
  seq: number;
  /** The port that wrote it: a lagged view sees its own writes at once. */
  origin: object | undefined;
  kind: 'lease' | 'source';
  key: string;
  before: unknown;
  after: unknown;
  /** The same write over another value of the document (a lagged view's own write over what it still sees). */
  apply: (cur: unknown) => unknown;
}

const seedSource = (ringKey: string, label = 'J-Style 2301'): SourceBody => ({ sourceKey: ringKey, label, tier: 'C', priority: 0, policies: [], baselineEpochs: [] });
// field-level LWW as `bioSources` merges: a top-level field is replaced whole, null included
const leaseAfter = (cur: unknown, ringKey: string, patch: Partial<RingLeaseBody>): RingLeaseBody =>
  ({ ...((cur ?? { kind: 'ringLease', ringKey, holder: null, heartbeatAt: null, takeover: null }) as Record<string, unknown>), ...patch }) as unknown as RingLeaseBody;
const sourceAfter = (cur: unknown, ringKey: string, patch: Record<string, unknown>): SourceBody => mergePatch((cur ?? seedSource(ringKey)) as Record<string, unknown>, patch) as unknown as SourceBody;

/** One "server": every device's service reads and writes the same documents and sees every change at once. */
export class SharedStore {
  readonly sources = new Map<string, SourceBody>();
  readonly leases = new Map<string, RingLeaseBody>();
  readonly batches: BioBatch[] = [];
  /** `seq` orders a write against `FakeRing.connectAttempts`; `at` and `by` are set when the port knows its clock and device. */
  readonly leaseWrites: Array<{ ringKey: string; patch: Partial<RingLeaseBody>; seq?: number; at?: number; by?: string }> = [];
  readonly sourcePatches: Array<{ ringKey: string; patch: Record<string, unknown> }> = [];
  private listeners = new Set<() => void>();
  private feed = new Set<(w: StoreWrite) => void>();
  private notify(): void {
    for (const l of [...this.listeners]) l();
  }
  private wrote(w: StoreWrite): void {
    for (const f of [...this.feed]) f(w);
  }
  /** Every write through a port, after the store applied it (lagged views: `laggedStorePort`). */
  onWrite(cb: (w: StoreWrite) => void): () => void {
    this.feed.add(cb);
    return () => this.feed.delete(cb);
  }
  addRingSource(ringKey: string, driver: string, extra: Partial<SourceBody> = {}): void {
    this.sources.set(ringKey, { sourceKey: ringKey, label: 'J-Style 2301', tier: 'C', priority: 0, policies: [], baselineEpochs: [], deviceType: 'ring', ble: { driver }, ...extra });
  }
  /** `by` / `clock` label this port's lease writes; `origin` marks its writes for a lagged view. */
  port(o: { by?: string; clock?: RingClockPort; origin?: object } = {}): RingStorePort {
    return {
      ready: async () => undefined,
      sources: () => [...this.sources.values()],
      source: (k) => this.sources.get(k),
      ingest: async (batch): Promise<RingSyncReport> => {
        this.batches.push(batch);
        return { sourceKey: '', driver: '', firmware: '', battery: null, records: batch.records.length, samples: 0, duplicates: 0, days: null, warnings: [], scored: 0 };
      },
      ensureSource: async (ringKey, p) => {
        if (this.sources.has(ringKey)) return;
        const after: SourceBody = { ...seedSource(ringKey, p.label), deviceType: 'ring', ble: { driver: p.driverId } };
        this.sources.set(ringKey, after);
        this.wrote({ seq: nextOrder(), origin: o.origin, kind: 'source', key: ringKey, before: undefined, after, apply: (cur) => cur ?? after });
        this.notify();
      },
      patchSource: async (ringKey, patch) => {
        this.sourcePatches.push({ ringKey, patch });
        const before = this.sources.get(ringKey);
        const after = sourceAfter(before, ringKey, patch);
        this.sources.set(ringKey, after);
        this.wrote({ seq: nextOrder(), origin: o.origin, kind: 'source', key: ringKey, before, after, apply: (cur) => sourceAfter(cur, ringKey, patch) });
        this.notify();
      },
      lease: (ringKey) => this.leases.get(ringKey),
      patchLease: async (ringKey, patch) => {
        const seq = nextOrder();
        this.leaseWrites.push({ ringKey, patch, seq, ...(o.clock ? { at: o.clock.now() } : {}), ...(o.by ? { by: o.by } : {}) });
        const before = this.leases.get(ringKey);
        const after = leaseAfter(before, ringKey, patch);
        this.leases.set(ringKey, after);
        this.wrote({ seq, origin: o.origin, kind: 'lease', key: ringKey, before, after, apply: (cur) => leaseAfter(cur, ringKey, patch) });
        this.notify();
      },
      subscribe: (cb) => {
        this.listeners.add(cb);
        return () => this.listeners.delete(cb);
      },
    };
  }
}

/**
 * One device's view of the shared store over a sync that takes `lagMs` (FakeClock time, `clock` is the device's): its
 * own writes are seen here at once, every other device's write (and a test's write through `store.port()`) only `lagMs`
 * later, when `subscribe` callbacks fire. The store's own maps stay the server's truth. A document a test sets by hand
 * on `store.leases` / `store.sources` (not through a port) is seen at once.
 */
export function laggedStorePort(store: SharedStore, clock: FakeClock, lagMs: number, by?: string): RingStorePort {
  const origin = {};
  const inner = store.port({ by, clock, origin });
  type Kind = StoreWrite['kind'];
  const server: Record<Kind, Map<string, unknown>> = { lease: store.leases, source: store.sources };
  // documents another device changed lately, as this device still sees them; absent: the server's value
  const seen: Record<Kind, Map<string, unknown>> = { lease: new Map(), source: new Map() };
  const pending: Record<Kind, Map<string, number>> = { lease: new Map(), source: new Map() };
  const own: StoreWrite[] = [];
  const listeners = new Set<() => void>();
  const fire = (): void => {
    for (const l of [...listeners]) l();
  };
  const view = (kind: Kind, key: string): unknown => (seen[kind].has(key) ? seen[kind].get(key) : server[kind].get(key));
  store.onWrite((w) => {
    const m = seen[w.kind];
    if (w.origin === origin) {
      own.push(w);
      if (m.has(w.key)) m.set(w.key, w.apply(m.get(w.key)));
      return;
    }
    if (!m.has(w.key)) m.set(w.key, w.before);
    const n = pending[w.kind];
    n.set(w.key, (n.get(w.key) ?? 0) + 1);
    clock.setTimeout(() => {
      const left = (n.get(w.key) ?? 1) - 1;
      if (left === 0) {
        // caught up: the server's value (every foreign write arrived, own writes are in it)
        n.delete(w.key);
        m.delete(w.key);
      } else {
        n.set(w.key, left);
        let v = w.after;
        for (const x of own) if (x.kind === w.kind && x.key === w.key && x.seq > w.seq) v = x.apply(v);
        m.set(w.key, v);
      }
      fire();
    }, lagMs);
  });
  return {
    ready: () => inner.ready(),
    sources: () => [...new Set([...store.sources.keys(), ...seen.source.keys()])].map((k) => view('source', k) as SourceBody | undefined).filter((s): s is SourceBody => s !== undefined),
    source: (k) => view('source', k) as SourceBody | undefined,
    ingest: (batch, ctx) => inner.ingest(batch, ctx),
    ensureSource: async (ringKey, p) => {
      if (view('source', ringKey) !== undefined) return;
      await inner.ensureSource(ringKey, p);
      // the server had it already (another device's, not here yet): this device sees the one it made now
      if (seen.source.has(ringKey) && seen.source.get(ringKey) === undefined) seen.source.set(ringKey, store.sources.get(ringKey));
      fire();
    },
    patchSource: async (ringKey, patch) => {
      await inner.patchSource(ringKey, patch);
      fire();
    },
    lease: (k) => view('lease', k) as RingLeaseBody | undefined,
    patchLease: async (ringKey, patch) => {
      await inner.patchLease(ringKey, patch);
      fire();
    },
    subscribe: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

export class MemoryLocal implements RingLocalPort {
  readonly docs = new Map<string, RingLocalState>();
  constructor(seed: Record<string, RingLocalState> = {}) {
    for (const [k, v] of Object.entries(seed)) this.docs.set(k, v);
  }
  async get(k: string) {
    const v = this.docs.get(k);
    return v ? structuredClone(v) : undefined;
  }
  async set(k: string, v: RingLocalState) {
    this.docs.set(k, structuredClone(v));
  }
  async remove(k: string) {
    this.docs.delete(k);
  }
}

export function syncPort(deviceId: string, deviceLabel: string, syncOn = true): RingSyncPort {
  return { view: () => ({ deviceId, deviceLabel, syncOn }) };
}

export const RING_KEY = 'ble:jstyle2301/2301/mac:aa:bb:cc:dd:ee:01';

/**
 * A device: ports for one service instance over the shared store. `platform` defaults to 'android'; `lagMs` gives the
 * device a lagged view of the store (`laggedStorePort`); `platformId` is the ring's id on this device (default: the
 * ring's first) when `local` is not given.
 */
export function devicePorts(o: { store: SharedStore; clock: FakeClock; rings: FakeRing[]; deviceId: string; label: string; syncOn?: boolean; canReconnect?: boolean; local?: MemoryLocal; shell?: RingServicePorts['shell']; platform?: Platform; lagMs?: number; platformId?: string }): RingServicePorts & { local: MemoryLocal } {
  const local = o.local ?? new MemoryLocal({ [RING_KEY]: { cursor: {}, platformId: o.platformId ?? [...o.rings[0]!.platformIds][0] } });
  return {
    connector: fakeConnector({ rings: o.rings, clock: o.clock, canReconnect: o.canReconnect }),
    store: o.lagMs ? laggedStorePort(o.store, o.clock, o.lagMs, o.deviceId) : o.store.port({ by: o.deviceId, clock: o.clock }),
    local,
    sync: syncPort(o.deviceId, o.label, o.syncOn ?? true),
    clock: o.clock,
    shell: o.shell,
    platform: o.platform ?? 'android',
    producer: { name: 'vitals-ring', version: '1' },
  };
}
