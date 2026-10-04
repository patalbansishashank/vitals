/**
 * Fakes for the ring service tests: a scripted connector (one fake ring reachable by several platform ids), a clock
 * with hand-driven timers, an in-memory store shared between "devices" (each device is one service instance with its
 * own device-local state and deviceId), and a sync view. No hardware, no timers of the host.
 */
import type { BioBatch, BioStream } from '@/biometrics/core/types';
import type { SourceBody } from '@/biometrics/store/docIndex';
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
  connectAttempts: Array<{ at: number; platformId: string }> = [];
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
    this.connectAttempts.push({ at: clock.now(), platformId });
    if (this.refuse) throw new RingLinkError(this.refuse);
    if (this.held) throw new RingLinkError('not_found', 'the ring is connected to another central');
    const s = new FakeSession(this, platformId);
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
  private livePush: ((v: { bpm: number; t: number } | null) => void) | null = null;
  constructor(
    readonly ring: FakeRing,
    platformId: string,
  ) {
    this.platformId = platformId;
    this.identity = { driverId: ring.driverId, family: ring.driverId, maker: 'J-Style', model: '2301', ...(ring.ringId ? { ringId: ring.ringId } : {}) };
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
    for (const l of this.dropListeners) l();
  }
  async close(): Promise<void> {
    this.closed = true;
    if (this.ring.held === this) this.ring.held = null;
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
  const c: RingConnector = {
    available: async () => o.availability ?? 'ready',
    async *scan() {
      for (const r of o.rings) {
        const pid = [...r.platformIds][0]!;
        yield { candidateId: pid, driverId: r.driverId, platformId: pid, rssi: -60 };
      }
    },
    async connect(hit) {
      const r = find(hit.candidateId);
      if (!r) throw new RingLinkError('not_found');
      return r.open(hit.candidateId, o.clock);
    },
    adopt: async (_link, driverId) => {
      const r = o.rings.find((x) => x.driverId === driverId);
      if (!r) throw new RingLinkError('not_found');
      return r.open('web:opaque', o.clock);
    },
    driverInfo: (driverId) => (driverId === 'jstyle2301' ? { label: 'J-Style 2301', maker: 'J-Style', model: '2301', streams: ['hr', 'steps'] as BioStream[], checks: ['hr', 'spo2'] } : undefined),
  };
  if (o.canReconnect !== false)
    c.reconnect = async (platformId) => {
      const r = find(platformId);
      if (!r) throw new RingLinkError('not_found');
      return r.open(platformId, o.clock);
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

/** One "server": every device's service reads and writes the same documents and sees every change at once. */
export class SharedStore {
  readonly sources = new Map<string, SourceBody>();
  readonly leases = new Map<string, RingLeaseBody>();
  readonly batches: BioBatch[] = [];
  readonly leaseWrites: Array<{ ringKey: string; patch: Partial<RingLeaseBody> }> = [];
  readonly sourcePatches: Array<{ ringKey: string; patch: Record<string, unknown> }> = [];
  private listeners = new Set<() => void>();
  private notify(): void {
    for (const l of [...this.listeners]) l();
  }
  addRingSource(ringKey: string, driver: string, extra: Partial<SourceBody> = {}): void {
    this.sources.set(ringKey, { sourceKey: ringKey, label: 'J-Style 2301', tier: 'C', priority: 0, policies: [], baselineEpochs: [], deviceType: 'ring', ble: { driver }, ...extra });
  }
  port(): RingStorePort {
    const seed = (ringKey: string, label = 'J-Style 2301'): SourceBody => ({ sourceKey: ringKey, label, tier: 'C', priority: 0, policies: [], baselineEpochs: [] });
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
        this.sources.set(ringKey, { ...seed(ringKey, p.label), deviceType: 'ring', ble: { driver: p.driverId } });
        this.notify();
      },
      patchSource: async (ringKey, patch) => {
        this.sourcePatches.push({ ringKey, patch });
        const cur = (this.sources.get(ringKey) ?? seed(ringKey)) as unknown as Record<string, unknown>;
        this.sources.set(ringKey, mergePatch(cur, patch) as unknown as SourceBody);
        this.notify();
      },
      lease: (ringKey) => this.leases.get(ringKey),
      patchLease: async (ringKey, patch) => {
        this.leaseWrites.push({ ringKey, patch });
        const cur = (this.leases.get(ringKey) ?? { kind: 'ringLease', ringKey, holder: null, heartbeatAt: null, takeover: null }) as unknown as Record<string, unknown>;
        // field-level LWW as `bioSources` merges: a top-level field is replaced whole, null included
        this.leases.set(ringKey, { ...cur, ...patch } as unknown as RingLeaseBody);
        this.notify();
      },
      subscribe: (cb) => {
        this.listeners.add(cb);
        return () => this.listeners.delete(cb);
      },
    };
  }
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

/** A device: ports for one service instance over the shared store. */
export function devicePorts(o: { store: SharedStore; clock: FakeClock; rings: FakeRing[]; deviceId: string; label: string; syncOn?: boolean; canReconnect?: boolean; local?: MemoryLocal; shell?: RingServicePorts['shell'] }): RingServicePorts & { local: MemoryLocal } {
  const local = o.local ?? new MemoryLocal({ [RING_KEY]: { cursor: {}, platformId: [...o.rings[0]!.platformIds][0] } });
  return {
    connector: fakeConnector({ rings: o.rings, clock: o.clock, canReconnect: o.canReconnect }),
    store: o.store.port(),
    local,
    sync: syncPort(o.deviceId, o.label, o.syncOn ?? true),
    clock: o.clock,
    shell: o.shell,
    platform: 'android',
    producer: { name: 'vitals-ring', version: '1' },
  };
}
