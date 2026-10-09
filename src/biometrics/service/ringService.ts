/**
 * The ring service (SUITE_SPEC §15.2): auto-connect, the lease, history since the last read, live heart rate, spot
 * checks. Tier H: no DOM; everything platform-specific comes in through `RingServicePorts` (`./ports.ts`), so the
 * state machine runs the same over the fake connector in tests and over the real transports in the app.
 *
 * One entry per known ring (a `bioSources` document with `deviceType: 'ring'` and `ble.driver`). The entry owns the
 * open session, the reconnect backoff, the lease heartbeat and the periodic sync; screens read `rings()`.
 */
import { ANDROID_RECONNECT, reconnectDelayMs, type RingEvent, type SpotKind } from '../../../packages/rings/src/types';
import type { BleLink } from '@/biometrics/core/ble/types';
import type { Instant } from '@/biometrics/core/types';
import type { SourceBody } from '@/biometrics/store/docIndex';
import { familyIdentity, knownRingLabel, macOf, parseRingKey, ringKeyFromId } from './identity';
import { buildRingBatch, foldStatus } from './ingest';
import { claimPatch, heartbeatPatch, leaseView, preferPatch, preferredHere, releasePatch, staleAt, takeoverFor, takeoverPatch, type LeaseView } from './lease';
import { RingLinkError, type RingAvailability, type RingLinkSession, type RingLocalState, type RingScanHit, type RingServicePorts } from './ports';
import {
  FREE_GRACE_MS, LEASE_HEARTBEAT_MS, RELEASE_AFTER_ATTEMPTS, STABLE_LINK_MS, SYNC_EVERY_MS, TAKEOVER_PAUSE_MS, TAKEOVER_RETRY_MS,
  type CheckMetric, type RingCandidate, type RingService, type RingServiceErrorCode, type RingStatus, type RingSyncReport,
} from './types';

/** Between two tries while a takeover frees the ring. */
export const TAKEOVER_STEP_MS = 5_000;
/** A holder that has not let go by then may be gone (app killed, lease still fresh): try the radio; the ring decides. */
export const TAKEOVER_FORCE_MS = 20_000;
/**
 * One connect attempt that has not settled by then (the platform never answered) is given up and retried. Not Lumen's
 * 30 s `RingBLEClient.CONNECT_TIMEOUT_MS`: that times Android's bare `connectGatt`, while a desktop attempt is a 15 s
 * look for the ring plus BlueZ's 40 s connect try (the idle ring advertises only every 20–40 s). At 30 s the owner's
 * relaunch and every reconnect after a drop were cut off before BlueZ reached the ring ("needs attention" 30 s in).
 */
export const CONNECT_ATTEMPT_MS = 45_000;
/** The first retry after a drop or a failed attempt: Lumen's `ReconnectBackoff.DELAYS[0]`. */
export const FIRST_RETRY_MS = ANDROID_RECONNECT.delaysMs[0]!;
export const ANOTHER_APP = 'Your ring may be connected to another app or phone. Close it there, then try again.';

const MESSAGES: Record<RingServiceErrorCode, string> = {
  not_found: ANOTHER_APP,
  refused: 'The ring refused the connection. Keep it close and try again.',
  unsupported_firmware: 'This ring’s firmware isn’t supported yet, so Vitals can’t read its history.',
  bond_required: 'Pair the ring when your device asks, then try again.',
  disconnected: 'The ring disconnected. Keep it close; Vitals will reconnect.',
  bluetooth_off: 'Turn Bluetooth on to reach your ring.',
  permission_needed: 'Vitals needs the Nearby devices permission to find your ring. Allow it in Android settings for Vitals.',
  failed: 'Could not connect to the ring. Try again.',
};
const EXTRA: Partial<Record<string, string>> = { no_reading: 'The ring gave no reading. Keep it on your finger and try again.', off_finger: 'Put the ring on your finger, then try again.' };

export function errorOf(e: unknown): { code: RingServiceErrorCode; message: string } {
  const c = e instanceof RingLinkError ? e.code : 'failed';
  const code: RingServiceErrorCode = c === 'cancelled' || c === 'unsupported' || c === 'no_reading' || c === 'off_finger' ? 'failed' : c;
  return { code, message: c === 'cancelled' ? 'Stopped.' : (EXTRA[c] ?? MESSAGES[code]) };
}

interface Entry {
  ringKey: string;
  driverId: string;
  status: RingStatus;
  local: RingLocalState;
  session?: RingLinkSession;
  offDrop?: () => void;
  attempt: number;
  /** The GATT status of the last failure, when the platform gave one: it picks the next retry's delay. */
  gattStatus?: number;
  cancelRetry?: () => void;
  cancelHeartbeat?: () => void;
  cancelPeriodic?: () => void;
  /** Resets the reconnect ladder once the link has stayed up `STABLE_LINK_MS` (R4). */
  cancelStable?: () => void;
  /** Re-checks a held lease when it would go stale (R2, R5). */
  cancelStaleWatch?: () => void;
  /** When this device started waiting on a free lease (R6); undefined once the grace was served or the lease was taken. */
  graceAt?: number;
  cancelGrace?: () => void;
  /** Ends a takeover pause (12 h) on its own. */
  cancelPauseEnd?: () => void;
  /** The attempt in flight is the service's own (auto-connect), not the person's tap: a held lease aborts it (R2). */
  auto?: boolean;
  /** This link's claim is written: from here a fresh lease naming another device means theirs won the merge (R1). */
  claimed?: boolean;
  /** When the open link came up. */
  upAt?: number;
  /** Links in a row that were taken away within `STABLE_LINK_MS` of coming up: two mean another central wants the ring (R4). */
  shortDrops: number;
  /** Failed auto attempts in a row (not drops): `RELEASE_AFTER_ATTEMPTS` of them let go of the lease (R1). */
  failsInRow: number;
  /** The ring gave a battery level at connect: a later read that gives none means the ring stopped answering. */
  batteryKnown?: boolean;
  connecting?: Promise<void>;
  syncing?: Promise<RingSyncReport>;
  liveWatchers: number;
  liveAbort?: AbortController;
  /** Settles when the live heart-rate loop has ended (its command released on the ring). */
  liveDone?: Promise<void>;
  checkAbort?: AbortController;
  /** A spot check is running (one command at a time on a ring). */
  checking?: Promise<unknown>;
  connectAbort?: AbortController;
  abort?: AbortController;
  /** A read left for later because live heart rate came first (see `LIVE_FIRST_MS`). */
  readDue?: boolean;
}

/**
 * A link that came back by itself while someone watches live heart rate, within this long of the last good read, gets
 * live heart rate back at once; the read waits until the watching ends (or the periodic read). The ring does one thing
 * at a time, and on the desktop a read takes about 40 s: reading first left the heart rate blank that long after each
 * drop (the owner's ring and PC lose the link every few minutes: BlueZ "Connection timeout").
 */
export const LIVE_FIRST_MS = 10 * 60_000;

const isRingSource = (s: SourceBody): boolean => s.deviceType === 'ring' && typeof s.ble?.driver === 'string';
const SPOT: Record<CheckMetric, SpotKind> = { hr: 'hr', spo2: 'spo2', hrv: 'hrv', skin_temp: 'temperature' };
const statusOf = (err: unknown): number | undefined => (err instanceof RingLinkError ? err.gattStatus : undefined);

export function createRingService(ports: RingServicePorts): RingService {
  const { connector, store, local, sync, clock } = ports;
  const shell = ports.shell ?? {};
  const producer = ports.producer ?? { name: 'vitals-ring', version: '1' };
  const entries = new Map<string, Entry>();
  const listeners = new Set<(rings: RingStatus[]) => void>();
  const candidates = new Map<string, RingScanHit>();
  let avail: RingAvailability = 'unsupported';
  let availKnown = false;
  let started: Promise<void> | null = null;
  /** The person's scan / pairing is under way: the service's own connects wait (MINOR 10, MAJOR 3 of the review). */
  let scanning = false;
  let pairing = false;
  let offStore: (() => void) | undefined;
  const offShell: Array<() => void> = [];

  const nowIso = (): Instant => new Date(clock.now()).toISOString();
  const me = () => {
    const v = sync.view();
    return { deviceId: v.deviceId, deviceLabel: v.deviceLabel, platform: ports.platform };
  };
  const syncOn = (): boolean => sync.view().syncOn;
  const wait = (ms: number): Promise<void> => new Promise((r) => clock.setTimeout(r, ms));

  const rings = (): RingStatus[] => [...entries.values()].map((e) => ({ ...e.status }));
  const publish = (): void => {
    const snap = rings();
    for (const l of [...listeners]) l(snap);
  };
  const set = (e: Entry, patch: Partial<RingStatus>): void => {
    e.status = { ...e.status, ...patch };
    for (const k of Object.keys(patch) as Array<keyof RingStatus>) if (patch[k] === undefined) delete e.status[k];
    publish();
  };
  const paused = (e: Entry): boolean => e.local.paused === true || (e.local.pausedUntil !== undefined && Date.parse(e.local.pausedUntil) > clock.now());
  const view = (e: Entry): LeaseView => leaseView(store.lease(e.ringKey), me().deviceId, clock.now(), syncOn());
  const saveLocal = async (e: Entry, patch: Partial<RingLocalState>): Promise<void> => {
    e.local = { ...e.local, ...patch };
    for (const k of Object.keys(patch) as Array<keyof RingLocalState>) if (patch[k] === undefined) delete e.local[k];
    await local.set(e.ringKey, e.local);
  };
  const anyConnected = (): boolean => [...entries.values()].some((x) => x.session);
  /** A shell call never throws into the service, sync or async. */
  const quiet = (call: () => void | Promise<void> | undefined): void => {
    try {
      void Promise.resolve(call()).catch(() => undefined);
    } catch {
      /* the shell's own failure */
    }
  };
  const keepAlive = (): void => quiet(() => shell.keepAlive?.(anyConnected(), 'Ring connected'));

  // ---------------------------------------------------------------- entries

  function statusFromSource(e: Entry, s: SourceBody | undefined): void {
    const b = s?.ble;
    if (!b) return;
    set(e, {
      ...(b.firmware !== undefined ? { firmware: b.firmware } : {}),
      ...(b.battery !== undefined && !e.session ? { battery: b.battery } : {}),
      ...(b.charging !== undefined && !e.session ? { charging: b.charging } : {}),
      ...(b.lastSyncAt !== undefined ? { lastSyncAt: b.lastSyncAt } : {}),
      lastSyncBy: b.lastSyncBy !== undefined && b.lastSyncBy !== me().deviceLabel ? b.lastSyncBy : undefined,
    });
  }

  const pendingEntries = new Map<string, Promise<Entry>>();
  function entryFor(ringKey: string, driverId: string): Promise<Entry> {
    const have = entries.get(ringKey);
    if (have) return Promise.resolve(have);
    const pending = pendingEntries.get(ringKey);
    if (pending) return pending;
    const p = buildEntry(ringKey, driverId).finally(() => pendingEntries.delete(ringKey));
    pendingEntries.set(ringKey, p);
    return p;
  }
  async function buildEntry(ringKey: string, driverId: string): Promise<Entry> {
    const fam = familyIdentity(driverId, connector.driverInfo(driverId));
    const checks = connector.driverInfo(driverId)?.checks;
    const e: Entry = { ringKey, driverId, status: { ringKey, label: fam.label, state: 'idle', ...(checks?.length ? { caps: { checks } } : {}) }, local: (await local.get(ringKey)) ?? { cursor: {} }, attempt: 0, shortDrops: 0, failsInRow: 0, liveWatchers: 0 };
    entries.set(ringKey, e);
    statusFromSource(e, store.source(ringKey));
    if (paused(e)) {
      set(e, { paused: true });
      armPauseEnd(e);
    }
    return e;
  }

  /** Rings another device added since the last look. */
  async function adoptNewSources(): Promise<Entry[]> {
    const fresh: Entry[] = [];
    for (const s of store.sources()) {
      if (!isRingSource(s) || entries.has(s.sourceKey)) continue;
      fresh.push(await entryFor(s.sourceKey, s.ble!.driver));
    }
    return fresh;
  }

  // ---------------------------------------------------------------- connect, drop, retry

  /** Another device holds the ring: show it, stop this device's own tries, and look again when the lease would go stale. */
  function showElsewhere(e: Entry, holder: Extract<LeaseView, { kind: 'held' }>['holder'], extra: Partial<RingStatus> = {}): void {
    e.cancelRetry?.();
    e.cancelRetry = undefined;
    e.cancelGrace?.();
    e.cancelGrace = undefined;
    e.graceAt = undefined;
    set(e, { state: 'elsewhere', heldBy: holder, error: undefined, ...extra });
    armStaleWatch(e);
  }

  /** While another device holds the ring, this device looks again only when that lease would go stale (R2, R5). */
  function armStaleWatch(e: Entry): void {
    e.cancelStaleWatch?.();
    e.cancelStaleWatch = undefined;
    const at = staleAt(store.lease(e.ringKey));
    if (!Number.isFinite(at)) return;
    e.cancelStaleWatch = clock.setTimeout(() => {
      e.cancelStaleWatch = undefined;
      void autoConnect(e);
    }, Math.max(1, at - clock.now()));
  }

  /** The lease as this device sees it while it has no link: `elsewhere` behind a fresh lease, idle (and its turn) otherwise. */
  function reflectLease(e: Entry): void {
    if (e.session) return;
    const v = view(e);
    if (v.kind === 'held') {
      if (e.status.state !== 'elsewhere' || e.status.heldBy?.deviceId !== v.holder.deviceId) showElsewhere(e, v.holder);
      else armStaleWatch(e);
      return;
    }
    e.cancelStaleWatch?.();
    e.cancelStaleWatch = undefined;
    if (e.status.state === 'elsewhere') {
      set(e, { state: 'idle', heldBy: undefined });
      // the holder let go, or its lease went stale: this device's turn (through the grace of R6)
      if (!paused(e) && !e.connecting) void autoConnect(e);
    }
  }

  function clearTimers(e: Entry): void {
    e.cancelRetry?.();
    e.cancelHeartbeat?.();
    e.cancelPeriodic?.();
    e.cancelStable?.();
    e.cancelRetry = e.cancelHeartbeat = e.cancelPeriodic = e.cancelStable = undefined;
  }

  /** The timers of an entry without a link (grace, stale watch, pause end): for stop, Forget and a fresh start. */
  function clearIdleTimers(e: Entry): void {
    e.cancelGrace?.();
    e.cancelStaleWatch?.();
    e.cancelPauseEnd?.();
    e.cancelGrace = e.cancelStaleWatch = e.cancelPauseEnd = undefined;
    e.graceAt = undefined;
  }

  async function closeSession(e: Entry, release: boolean): Promise<void> {
    const s = e.session;
    clearTimers(e);
    e.cancelGrace?.();
    e.cancelGrace = undefined;
    e.graceAt = undefined;
    e.cancelStaleWatch?.();
    e.cancelStaleWatch = undefined;
    e.liveAbort?.abort();
    e.liveAbort = undefined;
    e.connectAbort?.abort();
    e.connectAbort = undefined;
    e.abort?.abort();
    e.abort = undefined;
    e.offDrop?.();
    e.offDrop = undefined;
    e.session = undefined;
    e.claimed = undefined;
    if (s) await s.close().catch(() => undefined);
    if (release && syncOn() && view(e).kind === 'mine') await store.patchLease(e.ringKey, releasePatch()).catch(() => undefined);
    keepAlive();
  }

  /** A takeover pause ends on its own after 12 h: try again then. */
  function armPauseEnd(e: Entry): void {
    const until = e.local.pausedUntil ? Date.parse(e.local.pausedUntil) : NaN;
    if (!Number.isFinite(until) || until <= clock.now() || e.local.paused) return;
    e.cancelPauseEnd?.();
    e.cancelPauseEnd = clock.setTimeout(() => {
      e.cancelPauseEnd = undefined;
      void autoConnect(e);
    }, until - clock.now() + 1);
  }

  function scheduleRetry(e: Entry): void {
    e.cancelRetry?.();
    e.cancelRetry = undefined;
    // Lumen's `ReconnectBackoff.nextDelay`: 5, 15, 30, 60, 120, 300 s (5 s twice after GATT 133/22/62), reset when a
    // link comes up. After 257 Bluetooth coming back on reconnects; Android also gives 257 with Bluetooth on, so the
    // slowest step stays as a net
    const backoff = reconnectDelayMs(ANDROID_RECONNECT, e.attempt, e.gattStatus);
    const delay = backoff === null ? ANDROID_RECONNECT.delaysMs[ANDROID_RECONNECT.delaysMs.length - 1]! : backoff;
    e.attempt = Math.min(e.attempt + 1, ANDROID_RECONNECT.delaysMs.length);
    e.cancelRetry = clock.setTimeout(() => {
      e.cancelRetry = undefined;
      void autoConnect(e);
    }, delay);
  }

  function onDropped(e: Entry): void {
    if (!e.session) return;
    const short = e.upAt !== undefined && clock.now() - e.upAt < STABLE_LINK_MS;
    void (async () => {
      // the lease stays: the holder keeps the ring through a drop and retries (R1); it lets go once the retries fail.
      // A platform that cannot reopen the link on its own (the web) never retries, so it lets go at once.
      await closeSession(e, !canReopen(e));
      e.gattStatus = undefined;
      if (paused(e)) return set(e, { state: 'idle', paused: true, error: undefined, liveHr: undefined, syncProgress: undefined });
      const v = view(e);
      // another device's fresh claim: the ring is theirs now, no retry (R4)
      if (v.kind === 'held') return showElsewhere(e, v.holder, { liveHr: undefined, syncProgress: undefined });
      set(e, { state: 'error', error: errorOf(new RingLinkError('disconnected')), liveHr: undefined, syncProgress: undefined });
      if (!canReopen(e)) return;
      // one early drop climbs the ladder like any drop (Android drops a fresh link now and then); two links in a row
      // taken away within a minute of coming up mean another central wants the ring: wait the slowest step rather than
      // fight (the person's Connect, coming back to the app or Bluetooth coming on start over)
      e.shortDrops = short ? e.shortDrops + 1 : 0;
      if (e.shortDrops >= 2) e.attempt = ANDROID_RECONNECT.delaysMs.length - 1;
      scheduleRetry(e);
    })();
  }

  /**
   * Lumen's foreground check (`reconnectIfNeeded`): a link the OS kept while the ring stopped answering (Doze, a ring
   * that left) is found with one small read and reopened, instead of waiting for the 30-minute read to fail. The probe
   * is one command on the ring (registered as `checking`, so a read or live heart rate waits for it); a ring that gave
   * a battery level at connect and gives none now is silent; "busy" means another command got there first: alive.
   */
  async function probeLink(e: Entry): Promise<void> {
    const s = e.session;
    if (!s || e.syncing || e.checking || e.connecting) return;
    const run = (async (): Promise<boolean> => {
      await stopLive(e);
      if (e.session !== s || e.syncing) return true;
      try {
        const level = await s.battery();
        return level !== undefined || !e.batteryKnown;
      } catch (err) {
        const code = (err as { code?: unknown } | undefined)?.code;
        return code === 'busy' || code === 'cancelled';
      }
    })();
    e.checking = run;
    const alive = await run.finally(() => {
      if (e.checking === run) e.checking = undefined;
    });
    if (e.session !== s) return;
    if (alive) resumeLive(e, s);
    else onDropped(e);
  }

  /** Rejects with `err` when `p` has not settled within CONNECT_ATTEMPT_MS; a late value goes to `late`. */
  function bounded<T>(p: Promise<T>, err: () => Error, late: (v: T) => void): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let over = false;
      const cancel = clock.setTimeout(() => {
        over = true;
        reject(err());
      }, CONNECT_ATTEMPT_MS);
      p.then(
        (v) => {
          cancel();
          if (over) late(v);
          else resolve(v);
        },
        (x: unknown) => {
          cancel();
          reject(x);
        },
      );
    });
  }

  /** The ring's `bioSources` document: made once the ring is identified, so a ring that connected once survives a restart. */
  async function ensureRingSource(e: Entry, firmware: string): Promise<void> {
    const fam = familyIdentity(e.driverId, connector.driverInfo(e.driverId));
    const parsed = parseRingKey(e.ringKey);
    await store.ensureSource(e.ringKey, { driverId: e.driverId, label: fam.label, streams: connector.driverInfo(e.driverId)?.streams ?? [], channel: parsed?.legacy ? `ble:${parsed.family}` : e.ringKey, maker: fam.maker, model: fam.model, firmware });
  }

  /** A link that can be opened again without a gesture (Android, desktop; not the web). */
  const canReopen = (e: Entry): boolean => !!connector.reconnect && !!e.local.platformId;

  async function onConnected(e: Entry, session: RingLinkSession, o: { auto?: boolean; full?: boolean; signal?: AbortSignal; onProgress?: (p: number, stage: string) => void }): Promise<RingSyncReport> {
    const keyFamily = parseRingKey(e.ringKey)?.family;
    const actualFamily = familyIdentity(session.identity.driverId).family;
    if (keyFamily && familyIdentity(keyFamily).family !== actualFamily) {
      await session.close().catch(() => undefined);
      throw new RingLinkError('failed', 'This ring identifies as a different family. Add it again from the Ring page.');
    }
    if (e.driverId !== session.identity.driverId) {
      e.driverId = session.identity.driverId;
      const fam = familyIdentity(e.driverId, connector.driverInfo(e.driverId));
      const checks = connector.driverInfo(e.driverId)?.checks;
      set(e, { label: fam.label, caps: checks?.length ? { checks } : undefined });
    }
    if (o.auto && syncOn()) {
      // the claim of another device landed while this attempt ran: the ring is theirs (R2); no claim, no retry
      const v = view(e);
      if (v.kind === 'held') {
        await session.close().catch(() => undefined);
        throw new RingLinkError('cancelled', 'another device holds the ring');
      }
    }
    e.session = session;
    e.failsInRow = 0;
    e.cancelRetry?.();
    e.cancelRetry = undefined;
    e.cancelGrace?.();
    e.cancelGrace = undefined;
    e.graceAt = undefined;
    e.cancelStaleWatch?.();
    e.cancelStaleWatch = undefined;
    // Lumen resets its backoff on CONNECTED; here only once the link has stayed up (or a read completed): a link that
    // another central takes away seconds after it came up keeps climbing the ladder, so two devices never bounce the
    // ring every 5 s (R4)
    e.upAt = clock.now();
    e.cancelStable?.();
    e.cancelStable = clock.setTimeout(() => {
      e.cancelStable = undefined;
      if (e.session !== session) return;
      e.attempt = 0;
      e.gattStatus = undefined;
      e.shortDrops = 0;
    }, STABLE_LINK_MS);
    e.abort = new AbortController();
    e.offDrop = session.onDisconnected(() => onDropped(e));
    let info: Awaited<ReturnType<RingLinkSession['info']>>;
    try {
      if (session.platformId && session.platformId !== e.local.platformId) await saveLocal(e, { platformId: session.platformId });
      info = await bounded(session.info(), () => new RingLinkError('failed'), () => undefined);
      e.batteryKnown = info.battery !== undefined;
      await ensureRingSource(e, info.firmware);
      if (syncOn()) {
        await store.patchLease(e.ringKey, claimPatch(me(), nowIso(), e.ringKey));
        e.claimed = true;
      }
    } catch (err) {
      // a store or link failure before the first sync: let the link go so the caller shows the error and retries
      await closeSession(e, false);
      throw err;
    }
    set(e, { state: 'connected', error: undefined, heldBy: undefined, paused: false, firmware: info.firmware, ...(info.battery !== undefined ? { battery: info.battery } : {}), ...(info.charging !== undefined ? { charging: info.charging } : {}) });
    if (syncOn()) {
      const beat = (): void => {
        e.cancelHeartbeat = clock.setTimeout(() => {
          if (e.session !== session) return;
          const v = view(e);
          if (v.kind === 'held') {
            // another device holds a fresh lease (it took the ring while this one could not see sync): let go
            void closeSession(e, false).then(() => showElsewhere(e, v.holder, { liveHr: undefined, syncProgress: undefined }));
            return;
          }
          // the lease may have been lost (a merge, a stale clean-up): claim it again rather than only heartbeat
          void store.patchLease(e.ringKey, v.kind === 'mine' ? heartbeatPatch(nowIso()) : claimPatch(me(), nowIso(), e.ringKey)).catch(() => undefined);
          beat();
        }, LEASE_HEARTBEAT_MS);
      };
      beat();
    }
    keepAlive();
    // live heart rate starts after the first read (runSync resumes it): one command at a time on a ring
    const periodic = (): void => {
      e.cancelPeriodic = clock.setTimeout(() => {
        if (e.session !== session) return;
        void runSync(e, {}).catch(() => undefined).then(() => {
          if (e.session === session) periodic();
        });
      }, SYNC_EVERY_MS);
    };
    const lastRead = e.status.lastSyncAt ? Date.parse(e.status.lastSyncAt) : NaN;
    if (o.auto && e.liveWatchers > 0 && Number.isFinite(lastRead) && clock.now() - lastRead < LIVE_FIRST_MS) {
      e.readDue = true;
      periodic();
      startLive(e);
      return { sourceKey: e.ringKey, driver: e.driverId, firmware: info.firmware, battery: info.battery ?? null, records: 0, samples: 0, duplicates: 0, days: null, warnings: [], scored: 0 };
    }
    try {
      return await runSync(e, o);
    } finally {
      if (e.session === session) periodic();
    }
  }

  /** One attempt; a failure sets the error and, when `auto`, arms the backoff. */
  async function connectWith(e: Entry, open: (signal: AbortSignal) => Promise<RingLinkSession>, o: { auto?: boolean; full?: boolean; signal?: AbortSignal; onProgress?: (p: number, stage: string) => void }): Promise<RingSyncReport> {
    while (e.connecting) await e.connecting;
    if (e.session) return runSync(e, o);
    const ac = new AbortController();
    e.connectAbort = ac;
    e.auto = o.auto === true;
    o.signal?.addEventListener('abort', () => ac.abort(), { once: true });
    set(e, { state: 'connecting', error: undefined });
    let done!: () => void;
    e.connecting = new Promise<void>((r) => (done = r));
    try {
      // an attempt the platform never answers is given up: abort it, and close a link that comes up too late
      const session = await bounded(
        open(ac.signal),
        () => {
          ac.abort();
          return new RingLinkError('not_found');
        },
        (late) => void late.close().catch(() => undefined),
      );
      e.connecting = undefined;
      e.auto = undefined;
      done();
      if (ac.signal.aborted) {
        // Disconnect was pressed while the link came up: let it go again
        await session.close().catch(() => undefined);
        throw new RingLinkError('cancelled');
      }
      if (e.connectAbort === ac) e.connectAbort = undefined;
      return await onConnected(e, session, o);
    } catch (err) {
      if (e.connectAbort === ac) e.connectAbort = undefined;
      e.connecting = undefined;
      e.auto = undefined;
      done();
      if (!e.session) {
        e.gattStatus = statusOf(err);
        const v = view(e);
        if (paused(e)) set(e, { state: 'idle', paused: true, error: undefined });
        else if (v.kind === 'held') showElsewhere(e, v.holder); // a fresh lease explains it: no retry, theirs
        else {
          set(e, { state: 'error', error: errorOf(err) });
          // a failed read may have armed the retry already
          if (o.auto && !e.cancelRetry) scheduleRetry(e);
          // a holder that cannot reach its ring lets go of the lease, so another device may try (R1)
          if (o.auto && ++e.failsInRow >= RELEASE_AFTER_ATTEMPTS && v.kind === 'mine') await store.patchLease(e.ringKey, releasePatch()).catch(() => undefined);
        }
      }
      throw err;
    }
  }

  async function autoConnect(e: Entry): Promise<void> {
    // a retry that fires after Forget or stop must not bring the ring back
    if (!started || entries.get(e.ringKey) !== e) return;
    if (e.session || e.connecting) return;
    // the person is adding a ring: the service's own connects (and their scans) wait until that is over
    if (scanning || pairing) return;
    if (paused(e)) return set(e, { state: 'idle', paused: true });
    if (avail !== 'ready') return set(e, { state: avail });
    const v = view(e);
    if (v.kind === 'held') return showElsewhere(e, v.holder);
    e.cancelStaleWatch?.();
    e.cancelStaleWatch = undefined;
    const platformId = e.local.platformId;
    if (!connector.reconnect || !platformId) return set(e, { state: 'idle', heldBy: undefined });
    // a free or stale lease goes to the preferred device first (the phone, or the one the person chose); every other
    // device waits once and looks at the lease again before it tries (R6). No lease document at all means no device
    // has ever held this ring: nothing to wait for.
    const lease = store.lease(e.ringKey);
    if (v.kind !== 'mine' && syncOn() && lease && !preferredHere(lease, me().deviceId, ports.platform)) {
      if (e.graceAt === undefined) {
        e.graceAt = clock.now();
        e.cancelGrace?.();
        e.cancelGrace = clock.setTimeout(() => {
          e.cancelGrace = undefined;
          void autoConnect(e);
        }, FREE_GRACE_MS);
        if (e.status.state === 'elsewhere' || e.status.state === 'idle') set(e, { state: 'idle', heldBy: undefined });
        return;
      }
      if (clock.now() - e.graceAt < FREE_GRACE_MS) return; // the grace timer calls again
    }
    await connectWith(e, (signal) => connector.reconnect!(platformId, e.driverId, signal), { auto: true }).catch(() => undefined);
  }

  async function autoConnectAll(): Promise<void> {
    await adoptNewSources();
    await Promise.all([...entries.values()].map((e) => autoConnect(e)));
  }

  // ---------------------------------------------------------------- sync

  async function runSync(e: Entry, o: { full?: boolean; signal?: AbortSignal; onProgress?: (p: number, stage: string) => void }): Promise<RingSyncReport> {
    if (e.syncing) return e.syncing;
    const session = e.session;
    if (!session) throw new RingLinkError('disconnected');
    const job = (async (): Promise<RingSyncReport> => {
      const ac = new AbortController();
      const onAbort = (): void => ac.abort();
      e.abort?.signal.addEventListener('abort', onAbort, { once: true });
      o.signal?.addEventListener('abort', onAbort, { once: true });
      const progress = (p: number, stage: string): void => {
        set(e, { syncProgress: p });
        o.onProgress?.(p, stage);
      };
      try {
        set(e, { state: 'syncing', syncProgress: 0, error: undefined });
        // one command at a time on a ring: a spot check finishes and live heart rate pauses during the read
        if (e.checking) await e.checking.catch(() => undefined);
        await stopLive(e);
        const info = await session.info();
        const cursor = o.full ? {} : { ...e.local.cursor };
        const events: RingEvent[] = [];
        for await (const ev of session.sync(cursor, (p) => progress(0.6 * p, 'reading'), ac.signal)) events.push(ev);
        const folded = foldStatus(events, cursor, info.clockOffsetS);
        const unsupported = folded.errors.find((x) => x.startsWith('unsupported_firmware'));
        if (unsupported && !events.some((x) => x.type !== 'status' && x.type !== 'progress')) throw new RingLinkError('unsupported_firmware');
        const nowMs = clock.now();
        const batch = buildRingBatch(events, { ringKey: e.ringKey, driverId: e.driverId, firmware: info.firmware, clockOffsetS: folded.clockOffsetS, tz: clock.tz(), tzOffsetS: tzOffsetAt(nowMs, clock.tz()), nowMs, producer });
        await ensureRingSource(e, info.firmware);
        const rep = await store.ingest(batch, { ringKey: e.ringKey, signal: ac.signal, progress: (p, stage) => progress(0.6 + 0.4 * p, stage) });
        await saveLocal(e, { cursor: folded.cursor });
        const battery = folded.battery ?? info.battery;
        const at = nowIso();
        await store.patchSource(e.ringKey, {
          deviceType: 'ring',
          ble: { driver: e.driverId, ...(session.identity.ringId ? { ringId: session.identity.ringId } : {}), ...(macOf(session.platformId) ? { address: macOf(session.platformId) } : {}), firmware: info.firmware, ...(battery !== undefined ? { battery } : {}), lastSyncAt: at, lastSyncBy: me().deviceLabel, clockOffsetS: folded.clockOffsetS },
        });
        e.attempt = 0;
        e.gattStatus = undefined;
        e.readDue = false;
        set(e, { state: 'connected', syncProgress: undefined, lastSyncAt: at, lastSyncBy: undefined, firmware: info.firmware, ...(battery !== undefined ? { battery } : {}), ...(folded.charging !== undefined ? { charging: folded.charging } : {}) });
        return { ...rep, sourceKey: e.ringKey, driver: e.driverId, firmware: info.firmware, battery: battery ?? null, warnings: [...folded.errors.filter((x) => !x.startsWith('unsupported_firmware')), ...rep.warnings].slice(0, 50) };
      } catch (err) {
        const code = err instanceof RingLinkError ? err.code : 'failed';
        if (e.session === session && code !== 'cancelled' && code !== 'unsupported_firmware' && canReopen(e)) {
          // the link may be stale (the OS kept it, the ring stopped answering): let it go and reconnect from scratch,
          // keeping the lease (R1)
          await closeSession(e, false);
          // Disconnect may have been pressed while the link closed; another device may hold the ring now
          const v = view(e);
          if (paused(e)) set(e, { state: 'idle', paused: true, error: undefined, syncProgress: undefined, liveHr: undefined });
          else if (v.kind === 'held') showElsewhere(e, v.holder, { syncProgress: undefined, liveHr: undefined });
          else {
            set(e, { state: 'error', syncProgress: undefined, error: errorOf(err), liveHr: undefined });
            e.gattStatus = statusOf(err);
            scheduleRetry(e);
          }
        } else if (e.session) set(e, { state: 'error', syncProgress: undefined, error: errorOf(err) });
        throw err;
      } finally {
        e.abort?.signal.removeEventListener('abort', onAbort);
        o.signal?.removeEventListener('abort', onAbort);
        e.syncing = undefined;
        resumeLive(e, session);
      }
    })();
    e.syncing = job;
    return job;
  }

  // ---------------------------------------------------------------- live heart rate

  /** Wait before the one retry of live heart rate that failed (the ring busy or saying no). */
  const LIVE_RETRY_MS = 3_000;

  /** `retried`: this start is the one retry after a failure; a reading clears it. */
  function startLive(e: Entry, retried = false): void {
    const s = e.session;
    if (!s?.liveHeartRate || e.liveAbort) return;
    // one command at a time on a ring: live heart rate waits for a history read or a spot check to finish
    const busy = e.syncing ?? e.checking;
    if (busy) {
      void busy.catch(() => undefined).then(() => {
        // a job that ended before runSync stored it leaves itself behind: it is over, so not a reason to wait again
        if (e.syncing === busy) e.syncing = undefined;
        if (e.checking === busy) e.checking = undefined;
        if (e.liveWatchers > 0 && e.session === s) startLive(e, retried);
      });
      return;
    }
    const ac = new AbortController();
    e.liveAbort = ac;
    e.liveDone = (async () => {
      let failure: { code: string } | undefined;
      try {
        for await (const r of s.liveHeartRate!(ac.signal)) {
          if (ac.signal.aborted) break;
          retried = false;
          set(e, { liveHr: { bpm: r.bpm, at: new Date(r.t).toISOString() } });
        }
      } catch (err) {
        const code = (err as { code?: unknown } | undefined)?.code;
        failure = { code: typeof code === 'string' ? code : 'failed' };
      } finally {
        if (e.liveAbort === ac) e.liveAbort = undefined;
        set(e, { liveHr: undefined });
      }
      if (!failure || ac.signal.aborted) return;
      // the link itself is fine (a drop has its own path), so the ring's state stays; the code only, never packet bytes
      console.warn('Vitals: live heart rate stopped', failure.code);
      // the ring was busy or said no: one more try a little later, while someone still watches on this link
      if (retried || failure.code === 'disconnected' || failure.code === 'closed') return;
      clock.setTimeout(() => {
        if (e.liveWatchers > 0 && e.session === s) startLive(e, true);
      }, LIVE_RETRY_MS);
    })();
  }

  /** Ends live heart rate and waits until its command is released on the ring. */
  async function stopLive(e: Entry): Promise<void> {
    e.liveAbort?.abort();
    e.liveAbort = undefined;
    await e.liveDone?.catch(() => undefined);
  }

  /** Live heart rate again after a read or a check, while someone watches and the link is the same. */
  function resumeLive(e: Entry, s: RingLinkSession): void {
    if (e.liveWatchers > 0 && e.session === s && !e.syncing && !e.checking) startLive(e);
  }

  // ---------------------------------------------------------------- store changes (sync brought something)

  async function onStoreChange(): Promise<void> {
    for (const fresh of await adoptNewSources()) void autoConnect(fresh);
    for (const e of entries.values()) {
      const src = store.source(e.ringKey);
      if (src && src.deviceType === undefined && src.ble === undefined) {
        // forgotten on another device
        await closeSession(e, true);
        entries.delete(e.ringKey);
        publish();
        continue;
      }
      statusFromSource(e, src);
      const t = takeoverFor(store.lease(e.ringKey), me().deviceId, clock.now());
      if (t) {
        // "Connect here instead" on another device, while this one holds the lease: with the link up or down (its
        // retries would re-claim over the taker) let go, release, pause here for 12 h, tell the person
        await closeSession(e, true);
        e.cancelRetry?.();
        e.cancelRetry = undefined;
        await saveLocal(e, { pausedUntil: new Date(clock.now() + TAKEOVER_PAUSE_MS).toISOString() });
        armPauseEnd(e);
        set(e, { state: 'idle', paused: true, error: undefined, liveHr: undefined, syncProgress: undefined });
        quiet(() => shell.notify?.({ kind: 'ring_disconnected', title: 'Ring connected elsewhere', text: `Your ${e.status.label} is now connected to ${t.deviceLabel}.` }));
        continue;
      }
      const v = view(e);
      if (e.session && e.claimed && v.kind === 'held') {
        // another device's fresh claim won the merge while this link is open: the ring is theirs, within one sync
        // round rather than at the next heartbeat (R1)
        await closeSession(e, false);
        showElsewhere(e, v.holder, { liveHr: undefined, syncProgress: undefined });
        continue;
      }
      // a fresh lease that lands while this device's own attempt is in flight ends that attempt (R2)
      if (e.connecting && e.auto && v.kind === 'held') e.connectAbort?.abort();
      reflectLease(e);
    }
  }

  // ---------------------------------------------------------------- the service

  /**
   * The ring's source key. A ring this device identifies (serial or address) whose key is already a source: that key.
   * Otherwise the person's existing ring that matches by stored `ble.ringId` or `ble.address`, else their single ring
   * of this family and model (the browser rule; a failed serial read on Android gives `mac:` once and `serial:` later, which must
   * not open a second source). Only `pair` may create a new source; elsewhere an unknown ring is refused.
   */
  function resolveRingKey(session: RingLinkSession, chosen?: string, mayCreate = false): string {
    const id = session.identity;
    if (chosen) {
      const keyFamily = parseRingKey(chosen)?.family;
      if (keyFamily && familyIdentity(keyFamily).family !== familyIdentity(id.driverId).family) throw new RingLinkError('failed', 'This ring identifies as a different family. Add it again from the Ring page.');
      return chosen;
    }
    const fam = familyIdentity(id.driverId);
    const own = id.ringId ? ringKeyFromId(id.driverId, id.ringId, id.model) : undefined;
    if (own && store.source(own)) return own;
    const mac = macOf(session.platformId);
    const same = store.sources().filter((s) => isRingSource(s) && parseRingKey(s.sourceKey)?.family === fam.family);
    const byId = same.filter((s) => (id.ringId && s.ble?.ringId === id.ringId) || (mac && s.ble?.address === mac));
    if (byId.length === 1) return byId[0]!.sourceKey;
    // else the single ring of this family that may be this one; a ring that is surely another one: both gave a serial and they differ, or both gave an address and they differ
    const serialOf = (s: SourceBody): string | undefined => [s.ble?.ringId, parseRingKey(s.sourceKey)?.ringId].find((r) => r?.startsWith('serial:'));
    const macOfSource = (s: SourceBody): string | undefined =>
      s.ble?.address ?? [s.ble?.ringId, parseRingKey(s.sourceKey)?.ringId].find((r) => r?.startsWith('mac:'))?.slice(4);
    const other = (s: SourceBody): boolean =>
      (!!id.ringId?.startsWith('serial:') && serialOf(s) !== undefined && serialOf(s) !== id.ringId) ||
      (mac !== undefined && macOfSource(s) !== undefined && macOfSource(s)!.toLowerCase() !== mac.toLowerCase());
    const matchingModel = same.filter((s) => {
      const model = parseRingKey(s.sourceKey)?.model;
      return !id.model || !model || model === id.model;
    });
    const maybe = matchingModel.filter((s) => !other(s));
    // Unknown legacy models need a choice; only one explicitly matching model can be an automatic alias.
    if (matchingModel.length === 1 && maybe.length === 1 && id.model && parseRingKey(maybe[0]!.sourceKey)?.model === id.model) return maybe[0]!.sourceKey;
    if (maybe.length > 0) throw new RingLinkError('failed', 'Which ring is this? Choose it from the list first.');
    if (own && mayCreate) return own;
    if (own) throw new RingLinkError('failed', 'This ring is not set up yet. Add it from the Ring page first.');
    throw new RingLinkError('failed', 'This browser cannot tell which ring this is. Connect it once from the Vitals app on your phone or computer.');
  }

  /** The pairing list, as `scan` yields it. */
  async function* scanHits(signal: AbortSignal): AsyncIterable<RingCandidate> {
    for await (const hit of connector.scan(signal)) {
      candidates.set(hit.candidateId, hit);
      const fam = hit.driverId === 'unidentified' ? undefined : familyIdentity(hit.driverId, connector.driverInfo(hit.driverId));
      const same = store.sources().filter((s) => isRingSource(s) && (!fam || parseRingKey(s.sourceKey)?.family === fam.family));
      const c: RingCandidate = { candidateId: hit.candidateId, driverId: hit.driverId, label: fam?.label ?? 'Ring', known: same.length > 0, ...(hit.rssi !== undefined ? { rssi: hit.rssi } : {}) };
      if (!fam) c.known = false;
      if (same.length > 1) c.matches = same.map((s) => ({ ringKey: s.sourceKey, ...(s.ble?.lastSyncBy ? { lastSyncBy: s.ble.lastSyncBy } : {}), ...(s.ble?.lastSyncAt ? { lastSyncAt: s.ble.lastSyncAt } : {}) }));
      const tail = hit.candidateId.replace(/[^0-9a-f]/gi, '').slice(-4).toLowerCase();
      if (hit.platformId && tail.length === 4) c.idTail = tail;
      yield c;
    }
  }

  const service: RingService = {
    start() {
      if (started) return started;
      started = (async () => {
        try {
          await store.ready();
          avail = await connector.available().catch(() => 'unsupported' as const);
        } finally {
          // answered even when the store fails to open, so the Ring page never waits on the check for ever
          availKnown = true;
          publish();
        }
        for (const s of store.sources()) if (isRingSource(s)) await entryFor(s.sourceKey, s.ble!.driver);
        // a ring source labelled before the label table kept the ring's advertised name: store the table's label once
        for (const s of store.sources()) {
          const label = isRingSource(s) ? knownRingLabel(s.ble!.driver) : undefined;
          if (label && s.label !== label) await store.patchSource(s.sourceKey, { label }).catch(() => undefined);
        }
        for (const e of entries.values()) reflectLease(e);
        offStore = store.subscribe(() => void onStoreChange());
        if (shell.onResume)
          offShell.push(
            shell.onResume(() => {
              // back from Android settings: a permission granted there must clear "allow nearby devices"
              if (avail !== 'ready')
                void connector
                  .available()
                  .catch(() => 'unsupported' as const)
                  .then((a) => {
                    if (a === avail) return;
                    avail = a;
                    publish();
                  });
              // Lumen's foreground rules: the ladder starts over (the person is here), and an open link is checked
              for (const e of entries.values()) {
                e.shortDrops = 0;
                if (e.session) void probeLink(e);
                else {
                  e.attempt = 0;
                  e.gattStatus = undefined;
                }
              }
              void autoConnectAll();
            }),
          );
        if (shell.onBluetoothState)
          offShell.push(
            shell.onBluetoothState((on) => {
              if (!on) {
                avail = 'bluetooth_off';
                publish();
                for (const e of entries.values()) void closeSession(e, true).then(() => set(e, { state: 'bluetooth_off' }));
                return;
              }
              // "on" from the shell: the connector still decides whether this platform can reach a ring
              void connector
                .available()
                .catch(() => 'unsupported' as const)
                .then((a) => {
                  avail = a;
                  publish();
                  // Lumen resets its ladder when Bluetooth comes back on
                  for (const e of entries.values()) {
                    e.attempt = 0;
                    e.gattStatus = undefined;
                    e.shortDrops = 0;
                  }
                  if (a === 'ready') void autoConnectAll();
                });
            }),
          );
        await autoConnectAll();
      })();
      return started;
    },
    async stop() {
      offStore?.();
      offStore = undefined;
      for (const off of offShell.splice(0)) off();
      for (const e of entries.values()) {
        await closeSession(e, true);
        clearIdleTimers(e);
      }
      started = null;
    },
    rings,
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    availability: () => avail,
    availabilityKnown: () => availKnown,
    async *scan(signal) {
      candidates.clear();
      // the service's own reconnects (and the scans inside them) stay out of the person's scan
      scanning = true;
      try {
        yield* scanHits(signal);
      } finally {
        scanning = false;
        if (!pairing) void autoConnectAll();
      }
    },
    async pair(candidateId, ringKey) {
      const hit = candidates.get(candidateId);
      if (!hit) throw new RingLinkError('not_found', 'That ring is no longer in the list. Scan again.');
      pairing = true;
      const heldBack: Entry[] = [];
      let paired: Entry | undefined;
      try {
        // the person's connect wins over the service's own attempt at the same ring (Lumen: one connect at a time),
        // and its retries wait until the pairing is over
        for (const x of entries.values())
          if (hit.platformId !== undefined && x.local.platformId === hit.platformId) {
            if (x.connecting && x.auto) {
              x.connectAbort?.abort();
              await x.connecting;
            }
            x.cancelRetry?.();
            x.cancelRetry = undefined;
            x.cancelGrace?.();
            x.cancelGrace = undefined;
            heldBack.push(x);
          }
        const session = await connector.connect(hit, new AbortController().signal);
        let key: string;
        try {
          key = resolveRingKey(session, ringKey, true);
        } catch (err) {
          await session.close().catch(() => undefined);
          throw err;
        }
        const e = await entryFor(key, session.identity.driverId);
        paired = e;
        await saveLocal(e, { paused: undefined, pausedUntil: undefined });
        e.shortDrops = 0;
        const known = store.source(key) !== undefined;
        await closeSession(e, false);
        await connectWith(e, async () => session, { full: !known });
        return { ...e.status };
      } finally {
        pairing = false;
        // a ring this pairing held back (and the paired one when the pairing failed) goes back on its ladder; the rest
        // get the turn the pairing may have cost them
        for (const x of entries.values()) {
          if (x.session || x.connecting || x.cancelRetry || paused(x)) continue;
          if (x === paired || heldBack.includes(x)) scheduleRetry(x);
          else void autoConnect(x);
        }
      }
    },
    async connectHere(ringKey) {
      const e = entries.get(ringKey);
      if (!e) throw new RingLinkError('not_found', 'No such ring.');
      await saveLocal(e, { paused: undefined, pausedUntil: undefined });
      set(e, { paused: false });
      e.shortDrops = 0;
      const platformId = e.local.platformId;
      const open = connector.reconnect && platformId ? (signal: AbortSignal) => connector.reconnect!(platformId, e.driverId, signal) : undefined;
      if (e.session) {
        const st = e.status.state;
        if (st === 'connected' || st === 'syncing' || st === 'connecting') return;
        // an open link whose read failed: Connect must do something, so read again, or reconnect where the platform can
        if (!open) return void (await runSync(e, {}).catch(() => undefined));
        await closeSession(e, true);
      }
      e.cancelGrace?.();
      e.cancelGrace = undefined;
      e.cancelStaleWatch?.();
      e.cancelStaleWatch = undefined;
      let v = view(e);
      // the lease first (R3): the person chose this device, so it gets the head start from now on (only a device that
      // can reconnect on its own: a browser cannot use a head start); a holder, alive or silent, is told to let go
      const patch = { ...(open ? preferPatch(me(), nowIso()) : {}), ...(v.kind === 'held' || v.kind === 'stale' ? takeoverPatch(me(), nowIso()) : {}) };
      if (syncOn() && Object.keys(patch).length > 0) await store.patchLease(ringKey, patch);
      if (!open) return set(e, { state: 'idle', heldBy: undefined }); // the web: the Ring page's Connect opens the chooser
      const t0 = clock.now();
      const until = t0 + TAKEOVER_RETRY_MS;
      set(e, { state: 'searching', error: undefined, heldBy: undefined });
      for (;;) {
        if (paused(e)) return; // Disconnect was pressed meanwhile
        v = view(e);
        if (v.kind !== 'held' || clock.now() - t0 >= TAKEOVER_FORCE_MS) {
          try {
            await connectWith(e, open, {});
            return;
          } catch {
            /* the link may still be busy: try again below */
          }
        }
        if (clock.now() >= until) {
          v = view(e);
          if (v.kind === 'held') return showElsewhere(e, v.holder);
          return set(e, { state: 'error', error: errorOf(new RingLinkError('not_found')) });
        }
        set(e, { state: 'searching', error: undefined });
        await wait(TAKEOVER_STEP_MS);
      }
    },
    async syncNow(ringKey) {
      const e = entries.get(ringKey);
      if (!e) throw new RingLinkError('not_found', 'No such ring.');
      if (e.session) {
        await runSync(e, {});
        return;
      }
      const platformId = e.local.platformId;
      if (!connector.reconnect || !platformId) throw new RingLinkError('not_found', 'Connect the ring first.');
      await saveLocal(e, { paused: undefined, pausedUntil: undefined });
      e.shortDrops = 0;
      await connectWith(e, (signal) => connector.reconnect!(platformId, e.driverId, signal), {});
    },
    async checkNow(ringKey, metric) {
      const e = entries.get(ringKey);
      const s = e?.session;
      if (!e || !s) throw new RingLinkError('disconnected', 'Connect the ring first.');
      if (!s.spot) throw new RingLinkError('unsupported', 'This ring cannot take a reading on demand.');
      e.checkAbort?.abort();
      if (e.checking) await e.checking.catch(() => undefined);
      const ac = new AbortController();
      e.checkAbort = ac;
      e.abort?.signal.addEventListener('abort', () => ac.abort(), { once: true });
      // one command at a time on a ring: a running read finishes first, live heart rate pauses for the check
      const run = (async () => {
        if (e.syncing) await e.syncing.catch(() => undefined);
        if (ac.signal.aborted) throw new RingLinkError('cancelled');
        await stopLive(e);
        return s.spot!(SPOT[metric], ac.signal);
      })();
      e.checking = run;
      try {
        const r = await run;
        const at = new Date(r.t).toISOString();
        if (metric === 'hr') set(e, { liveHr: { bpm: r.value, at } });
        return { value: r.value, unit: r.unit, at };
      } finally {
        if (e.checkAbort === ac) e.checkAbort = undefined;
        if (e.checking === run) e.checking = undefined;
        resumeLive(e, s);
      }
    },
    async stopCheck(ringKey) {
      const e = entries.get(ringKey);
      e?.checkAbort?.abort();
      if (e) e.checkAbort = undefined;
    },
    watchLiveHeartRate(ringKey) {
      const e = entries.get(ringKey);
      if (!e) return () => undefined;
      e.liveWatchers++;
      if (e.session) startLive(e);
      let done = false;
      return () => {
        if (done) return;
        done = true;
        e.liveWatchers--;
        if (e.liveWatchers === 0) {
          e.liveAbort?.abort();
          e.liveAbort = undefined;
          // the read live heart rate went before
          if (e.readDue && e.session) void runSync(e, {}).catch(() => undefined);
        }
      };
    },
    async disconnect(ringKey) {
      const e = entries.get(ringKey);
      if (!e) return;
      await closeSession(e, true);
      await saveLocal(e, { paused: true });
      set(e, { state: 'idle', paused: true, error: undefined, liveHr: undefined, syncProgress: undefined, heldBy: undefined });
    },
    async forget(ringKey) {
      const e = entries.get(ringKey);
      if (e) {
        await closeSession(e, true);
        clearIdleTimers(e);
        entries.delete(ringKey);
      }
      await store.patchSource(ringKey, { ble: null, deviceType: null });
      await local.remove(ringKey);
      publish();
    },
    async syncLink(link: BleLink, driverId, o = {}) {
      if (!connector.adopt) throw new RingLinkError('unsupported', 'This platform connects rings on its own; use the Ring page.');
      const session = await connector.adopt(link, driverId, o.signal ?? new AbortController().signal);
      let key: string;
      try {
        // `create`: the person chose this ring to add it (bio.deviceConnect), as `pair` does
        key = resolveRingKey(session, o.ringKey, o.create === true);
      } catch (err) {
        await session.close().catch(() => undefined);
        throw err;
      }
      const e = await entryFor(key, session.identity.driverId);
      await saveLocal(e, { paused: undefined, pausedUntil: undefined });
      const known = store.source(key) !== undefined;
      await closeSession(e, false);
      return connectWith(e, async () => session, { full: !known, signal: o.signal, onProgress: o.onProgress });
    },
  };
  return service;
}

/** UTC offset (s, east positive) of `tz` at `ms`; 0 for an unknown zone. */
export function tzOffsetAt(ms: number, tz: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms));
    const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const local = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    return Math.round((local - Math.floor(ms / 1000) * 1000) / 1000);
  } catch {
    return 0;
  }
}
