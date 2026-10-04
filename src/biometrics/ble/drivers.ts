/**
 * Concrete BLE drivers. Tier H.
 *
 * Every `@vitals/rings` family becomes a driver through `familyDriver`: its scan filters, GATT map and handshake run in
 * `openRingSession`, and the session is handed back in the old `BleSession` shape (events widened with `toDecodedEvents`,
 * `RingError` as `BleSessionError`), so `bio.deviceConnect` / `bio.deviceSync` and stored driver ids work as before.
 * Colmi still runs on the old session runner (`./session`) until its family lands in `RING_FAMILIES`.
 */
import {
  RingError, jstyle2301, openRingSession, toDecodedEvents,
  type FamilyId, type IngestResult as RingIngestResult, type Protocol, type RingEvent, type RingFamily, type RingSession,
} from '@vitals/rings';
import type { BleDriver, BleLink, BleProtocol, BleSession, IngestResult, ProtocolState, RingCommand, RingDecodedEvent } from '@/biometrics/core/ble/types';
import { COLMI_UUIDS, createColmiProtocol, type ColmiState } from '@/biometrics/core/ble/colmi/protocol';
import { BleSessionError, openSession, type HandshakeInfo, type SessionOptions, type SessionRuntime } from './session';
import { familiesQuery, linkTransport } from './transports/rings';
import { queryOf, type RingLink } from './transports/types';

/** `credential` overrides a driver's built-in passcode (tests only; no screen offers it). */
export type DriverOpenOptions = { credential?: string; signal?: AbortSignal } & Omit<SessionOptions, 'handshake' | 'signal'>;
/** A `BleDriver` whose `open` also accepts session options (clock, timers). */
export type VitalsBleDriver = Omit<BleDriver, 'open'> & { open(link: BleLink, opts?: DriverOpenOptions): Promise<BleSession> };

/** Ids and maker names already stored in people's sources (`ble.driver`, source labels): a family keeps them. */
const STORED: Partial<Record<FamilyId, { id: string; family: string }>> = {
  jstyle2301: { id: 'jstyle2301', family: 'J-Style 2301' },
  colmi: { id: 'colmi-r02', family: 'Colmi R02 (QRing)' },
};

/** `RingError` as the `BleSessionError` exec.ts turns into plain words; the codes are the same. */
const bleError = (e: unknown): unknown => (e instanceof RingError ? new BleSessionError(e.message, e.code, e) : e);

/** The session needs a drop signal; a link without one simply never reports a drop. */
function ringLinkOf(link: BleLink): RingLink {
  if (typeof (link as Partial<RingLink>).onDisconnect === 'function') return link as RingLink;
  return {
    write: (s, c, bytes, o) => link.write(s, c, bytes, o),
    subscribe: (s, c, cb) => link.subscribe(s, c, cb),
    ...(link.read ? { read: (s, c) => link.read!(s, c) } : {}),
    get mtu() {
      return link.mtu;
    },
    get deviceName() {
      return link.deviceName;
    },
    onDisconnect: () => () => {},
    disconnect: () => link.disconnect(),
  };
}

async function* decoded(events: AsyncIterable<RingEvent>): AsyncGenerator<RingDecodedEvent> {
  try {
    // `progress` and `dailyTotal` have no old shape; the vendor `daily_*` values behind a J-Style day total still pass.
    for await (const e of events) yield* toDecodedEvents([e]);
  } catch (e) {
    throw bleError(e);
  }
}

async function openFamily(family: RingFamily, link: BleLink, opts: DriverOpenOptions): Promise<BleSession> {
  const { signal, credential, clock, timers, replyMs } = opts;
  let ring: RingSession;
  try {
    ring = await openRingSession(family, linkTransport(ringLinkOf(link)), { signal, credential, clock, timers, replyMs });
  } catch (e) {
    await link.disconnect().catch(() => {});
    throw bleError(e);
  }
  // V0789 answers the battery request only after the passcode, so the handshake's own request comes back empty there.
  if (ring.info().battery === undefined && !ring.info().historyBlocked) await ring.battery().catch(() => undefined);
  return {
    async info() {
      const { firmware, battery, clockOffsetS, historyBlocked } = ring.info();
      return { firmware, battery, clockOffsetS, ...(historyBlocked ? { historyBlocked } : {}) };
    },
    battery: () => ring.battery().catch((e: unknown) => Promise.reject(bleError(e))),
    sync: (cursor, onProgress, sig) => decoded(ring.sync(cursor, (p) => onProgress(p.fraction), sig)),
    readHistory: (stream, since, sig) => decoded(ring.readHistory(stream, since === undefined ? {} : { [stream]: since }, sig)),
    close: () => ring.close(),
  };
}

/**
 * A family's protocol in the old `BleProtocol` shape, for code that still reads `driver.protocol`. It frames against the
 * initial state on the default write channel, which is exact for the J-Style family; `open` never uses it.
 */
export function bleProtocolOf(p: Protocol): BleProtocol {
  const widen = (r: RingIngestResult): IngestResult => ({ ...r, events: toDecodedEvents(r.events) });
  return {
    initialState: () => p.initialState(),
    frame: (cmd) => p.frame(cmd, p.initialState()).map((f) => f.bytes),
    ingest: (bytes, state) => widen(p.ingest(bytes, state)),
    planSync: (cursor) => p.planSync(cursor, p.initialState()),
    ...(p.begin ? { begin: (cmd: RingCommand, state: ProtocolState) => p.begin!(cmd, state) } : {}),
    ...(p.timeout ? { timeout: (state: ProtocolState, kind: 'quiet' | 'stall') => widen(p.timeout!(state, kind)) } : {}),
  };
}

/** A driver over a `@vitals/rings` family: the family's own filters (services and maker markers, never a retail name). */
export function familyDriver(family: RingFamily, stored = STORED[family.id]): VitalsBleDriver {
  const { gatt } = family;
  const main = gatt.notify[0];
  return {
    id: stored?.id ?? family.id,
    family: stored?.family ?? family.maker ?? family.label,
    label: family.label,
    streams: [...family.streams],
    requestOptions: queryOf(familiesQuery([family])),
    ...(main && (main.service ?? gatt.service) === gatt.service ? { gatt: { service: gatt.service, write: gatt.write, notify: main.characteristic } } : {}),
    protocol: bleProtocolOf(family.protocol),
    open: (link, opts = {}) => openFamily(family, link, opts),
  };
}

/** J-Style 2301 (V0525, V0789): the passcode V0789 needs is built into the family, so connecting asks for nothing. */
export const jstyle2301Driver: VitalsBleDriver = familyDriver(jstyle2301);

/**
 * Colmi handshake [tahnok client.py + README "set the clock"]: set the ring clock to UTC, read battery and the HR-log
 * setting, and read the firmware string from the standard Device Information service when the link can read.
 * Setting the clock is the only write that changes ring state; the HR-log setting is reported, never changed here.
 */
export async function colmiHandshake(rt: SessionRuntime, signal?: AbortSignal): Promise<HandshakeInfo> {
  await rt.run({ op: 'setTime' }, signal);
  await rt.run({ op: 'battery' }, signal);
  await rt.run({ op: 'hrLogSettings' }, signal);
  let firmware = '';
  if (rt.link.read) {
    try {
      firmware = new TextDecoder().decode(await rt.link.read(COLMI_UUIDS.deviceInfo, COLMI_UUIDS.firmwareRevision)).replace(/\0+$/, '');
    } catch {
      firmware = '';
    }
  }
  const st = rt.state as ColmiState;
  return { firmware, battery: st.battery ?? undefined, clockOffsetS: 0 };
}

/** Old-runner Colmi driver; `registry.ts` drops it once `RING_FAMILIES` has a Colmi family (which keeps the id). */
export const colmiDriver: VitalsBleDriver = {
  id: 'colmi-r02',
  family: 'Colmi R02 (QRing)',
  label: 'Colmi R02 / R06 / R10 ring',
  streams: ['hr', 'steps'],
  // Names like 'R02_341C' [tahnok README]; models listed as compatible there: R02, R06, R10.
  requestOptions: {
    filters: [{ namePrefix: 'R02_' }, { namePrefix: 'R06_' }, { namePrefix: 'R10_' }, { services: [COLMI_UUIDS.service] }],
    optionalServices: [COLMI_UUIDS.service, COLMI_UUIDS.deviceInfo],
  },
  gatt: { service: COLMI_UUIDS.service, write: COLMI_UUIDS.write, notify: COLMI_UUIDS.notify },
  protocol: createColmiProtocol(),
  open(link, opts: DriverOpenOptions = {}) {
    const { credential: _c, signal, ...rest } = opts;
    return openSession(colmiDriver, link, { ...rest, signal, handshake: (rt) => colmiHandshake(rt, signal) });
  },
};
