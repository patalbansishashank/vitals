/**
 * The YCBT `Protocol`: framing, the ingest state machine and the sync planner. Tier P (no timers, no I/O; the session
 * runs the timers and calls `timeout`). Port of Lumen's `YCBTDriver.kt` (reassembly, `04 xx` acknowledgements, the
 * `03 2f` reply FIFO, the capability gate), `YCBTHistoryTransfer.kt` (whole-type history transfers) and the history
 * planning of `YCBTSyncEngine.kt`.
 *
 * History: one `history` command per type (catalog order, filtered by capability). Each writes `05 qq`, takes the
 * header, the data frames (records may straddle frames) and the terminal `05 80`; byte count and CRC good → `05 80 00`,
 * decode, next queued type; bad → `05 80 04` and ask again once. Types the bitmap grants mid-read are appended to the
 * read in flight, as `YCBTHistoryTransfer.append` does. Every pass reads everything the ring holds: there is no day
 * selector, so the cursor (`d:YYYY-MM-DD`, the local day of the last complete read) never shortens a transfer.
 *
 * Timers: 10 s without any frame after a request skips the type (Kotlin's watchdog, no acknowledgement). Once the
 * header has arrived the ring owes data frames, so a quiet timer never ends that transfer at once: it keeps waiting up
 * to 30 s of silence in all, then reports `status:error partial:<stream>`, skips the type and leaves its cursor alone.
 * (The Kotlin skipped after 10 s of silence, or 30 s after the request even while frames flowed; that absolute cap is
 * not kept: the protocol has no clock while frames arrive, and cutting a flowing transfer would lose data.)
 */
import type { BioStream } from '../../../../src/biometrics/core/types';
import { fromHex, type CommandPlan, type IngestResult, type OutboundFrame, type Protocol, type ProtocolState, type RingCommand, type RingEvent, type SyncCursor } from '../types';
import {
  ALL_ON_DEFAULT, APP, DEV, GET, GROUP, HEALTH, HISTORY_CATALOG, MODE, VARIANTS, YCBT_STREAM, assemble, chipSchemeRequest, crc16, deviceInfoRequest,
  deviceNameRequest, devControlAck, effectiveCapabilities, enableLiveStatus, findDevice, frameLogical, historyBlockAck, historyRequest, historyType,
  language, liveMeasurement, monitorCommands, refusal, setTime, supportFunctionRequest, supportedHistory, units, userConfigRequest, userInfo,
  validateFrame, wallClock,
  type AssemblerBuffers, type Capability, type HistoryType, type HistoryTypeName, type MonitorSettings, type YcbtVariant, type ZoneContext,
} from './commands';
import { decodeFrame, decodeHistory, toRingEvents, type YcbtDecoded } from './decoder';

/** Reply wait for `02 00` / `02 01` (engineering value: the Kotlin queues them and never waits). */
export const REPLY_MS = 3_000;
/** `YCBTHistoryTransfer.inactivitySeconds`: no frame this long after a request skips the type. */
export const STALL_MS = 10_000;
/**
 * Silence after the last frame of a running transfer before the protocol is asked what to do. Each quiet period only
 * counts towards SILENCE_MAX_MS (engineering value; the Kotlin re-arms one 10 s inactivity timer per frame instead).
 */
export const QUIET_MS = 5_000;
/** Longest total silence a transfer that owes data may sit through (the Kotlin's 30 s cap per type, reused). */
export const SILENCE_MAX_MS = 30_000;
/** Wait for the `06 00` totals after the walk-closing `03 09` (engineering value; the reply is not in any Kotlin test). */
export const LIVE_STATUS_WAIT_MS = 1_500;
/** `YCBTHistoryTransfer` buffer caps. */
export const DEFAULT_BUFFER_CAP = 64 * 1024;
export const MAX_BUFFER_CAP = 512 * 1024;
/** `PendingMeasurementReplies.MAX_PENDING`. */
export const MAX_PENDING = 8;

interface HistoryRead {
  kind: 'history';
  current: HistoryTypeName | null;
  /** 'sent' = asked, no header yet; 'receiving' = the header came, the ring owes data. */
  phase: 'sent' | 'receiving';
  queue: HistoryTypeName[];
  buffer: number[];
  cap: number;
  retried: boolean;
  /** Silence counted by quiet timers since the last frame of this type. */
  silentMs: number;
  /** Report `progress { stage: 'history', done: true }` when this read ends (the last read of a walk). */
  finish: boolean;
}

type Inflight =
  | { kind: 'reply'; type: number; cmd: number; op: string }
  | HistoryRead
  /** A spot (`03 2f 01 m`): ends on `04 0e` for its mode or a refusal of its start. */
  | { kind: 'spot'; mode: number; live: boolean }
  /** The walk-closing `03 09`: waits briefly for the `06 00` totals, then reports the walk finished. */
  | { kind: 'liveStatus'; finish: boolean };

export interface YcbtState extends ProtocolState {
  variant: YcbtVariant;
  /** Effective capabilities: the variant baseline plus what the bitmap granted (reset on every connection). */
  caps: Capability[];
  firmware: string | null;
  battery: number | null;
  nowMs: number;
  tzOffsetS: number;
  /** IANA zone when a command carried one (`params.tz`); ring times then use per-record DST, as the Kotlin does. */
  tz: string | null;
  buffers: AssemblerBuffers;
  /** `03 2f` writes awaiting their reply: the started mode, or null for a stop. */
  pending: Array<number | null>;
  /** Query keys the ring refused with `fb`/`fc` on this connection. */
  unsupported: number[];
  /** The handshake's monitor batch went out; later grants send their own monitor commands. */
  configured: boolean;
  /** The first walk on this connection ran (`requestActivityAfterStartupHistory` has fired). */
  startupDone: boolean;
  /** Types planned for the current walk, and those already asked for (for appends). */
  walk: HistoryTypeName[];
  walkStarted: HistoryTypeName[];
  inflight: Inflight | null;
}

export interface YcbtOptions {
  /** The five background monitors; Lumen's default is every one on, every 5 minutes (sent as 30). */
  monitors?: MonitorSettings;
}

const num = (c: RingCommand, k: string, d = 0): number => (typeof c.params?.[k] === 'number' ? (c.params[k] as number) : d);
const str = (c: RingCommand, k: string, d = ''): string => (typeof c.params?.[k] === 'string' ? (c.params[k] as string) : d);
const bool = (c: RingCommand, k: string, d: boolean): boolean => (typeof c.params?.[k] === 'boolean' ? (c.params[k] as boolean) : d);
const list = (s: string): string[] => s.split(',').map((x) => x.trim()).filter(Boolean);
const toHexStr = (b: readonly number[]): string => b.map((x) => x.toString(16).padStart(2, '0')).join(' ');
const zoneOf = (st: YcbtState): ZoneContext => ({ tz: st.tz ?? undefined, tzOffsetS: st.tzOffsetS });

export function initialYcbtState(variant: YcbtVariant = 'r10m'): YcbtState {
  return {
    variant, caps: [...VARIANTS[variant].baseline], firmware: null, battery: null, nowMs: 0, tzOffsetS: 0, tz: null, buffers: {}, pending: [],
    unsupported: [], configured: false, startupDone: false, walk: [], walkStarted: [], inflight: null,
  };
}

/** The local day of `nowMs` as `d:YYYY-MM-DD`: the cursor a stream gets when a read of it completes. */
export function dayCursor(st: Pick<YcbtState, 'nowMs' | 'tzOffsetS' | 'tz'>): string {
  return `d:${wallClock(st.nowMs, { tz: st.tz ?? undefined, tzOffsetS: st.tzOffsetS }).toISOString().slice(0, 10)}`;
}

// ---------------------------------------------------------------- framing

const VARIANT_BY_PROFILE: Record<string, YcbtVariant> = { ycbt: 'r10m', r10m: 'r10m', tk5: 'tk5', colmi_smart_health: 'smarthealth', smarthealth: 'smarthealth' };

/** `YCBTEncoder.startupSequence`: the connect configuration batch, in Lumen's order. */
export function startupSequence(variant: YcbtVariant, caps: readonly Capability[], s: MonitorSettings, profile: Parameters<typeof userInfo>[0] | null, metric: boolean, is24Hour = true, languageCode = 0): number[][] {
  const v = VARIANTS[variant];
  const seq: number[][] = [deviceInfoRequest(), supportFunctionRequest()];
  if (v.queryChipScheme) seq.push(chipSchemeRequest());
  seq.push(userConfigRequest(), language(languageCode), units(metric, is24Hour), ...monitorCommands(s, caps, v.bpMonitor));
  if (profile) seq.push(userInfo(profile));
  seq.push(enableLiveStatus());
  return seq;
}

const profileFrom = (c: RingCommand): Parameters<typeof userInfo>[0] => ({
  heightCm: num(c, 'heightCm', 175), weightKg: num(c, 'weightKg', 70), male: str(c, 'sex') === 'male', ageYears: num(c, 'ageYears', 25),
});

function monitorSettingsFrom(c: RingCommand, d: MonitorSettings): MonitorSettings {
  return {
    hrEnabled: bool(c, 'hrEnabled', d.hrEnabled), hrIntervalMinutes: num(c, 'hrIntervalMinutes', d.hrIntervalMinutes), spo2Enabled: bool(c, 'spo2Enabled', d.spo2Enabled),
    hrvEnabled: bool(c, 'hrvEnabled', d.hrvEnabled), temperatureEnabled: bool(c, 'temperatureEnabled', d.temperatureEnabled),
  };
}

/** Logical bytes of one command (several for the batch ops). */
export function logicalFor(cmd: RingCommand, st: YcbtState, monitors: MonitorSettings = ALL_ON_DEFAULT): number[][] {
  const zone: ZoneContext = { tz: str(cmd, 'tz') || st.tz || undefined, tzOffsetS: num(cmd, 'tzOffsetS', st.tzOffsetS) };
  const at = (): number => (str(cmd, 'instant') ? Date.parse(str(cmd, 'instant')) : num(cmd, 'nowMs', st.nowMs));
  switch (cmd.op) {
    case 'frame':
      return [Array.from(fromHex(str(cmd, 'logical')))];
    case 'setTime':
      return [setTime(at(), zone)];
    case 'getDeviceName':
      return [deviceNameRequest()];
    case 'postSubscriptionHandshake':
      return [deviceNameRequest(), setTime(at(), zone)];
    case 'deviceInfo':
    case 'battery':
      return [deviceInfoRequest()];
    case 'supportFunction':
      return [supportFunctionRequest()];
    case 'chipScheme':
      return [chipSchemeRequest()];
    case 'userConfig':
      return [userConfigRequest()];
    case 'language':
      return [language(num(cmd, 'code'))];
    case 'units':
      return [units(bool(cmd, 'metric', true), bool(cmd, 'is24Hour', true))];
    case 'setUserInfo':
      return [userInfo(profileFrom(cmd))];
    case 'monitors':
      return monitorCommands(monitors, st.caps, VARIANTS[st.variant].bpMonitor);
    case 'monitorCommands':
      return monitorCommands(monitorSettingsFrom(cmd, monitors), list(str(cmd, 'capabilities')) as Capability[], bool(cmd, 'supportsBloodPressureMonitor', false));
    case 'startupSequence': {
      const variant = VARIANT_BY_PROFILE[str(cmd, 'profile', 'ycbt')] ?? 'r10m';
      return startupSequence(variant, VARIANTS[variant].baseline, monitorSettingsFrom(cmd, monitors), profileFrom(cmd), bool(cmd, 'metric', true), bool(cmd, 'is24Hour', true), num(cmd, 'languageCode'));
    }
    case 'enableLiveStatus':
      return [enableLiveStatus()];
    case 'findDevice':
      return [findDevice()];
    case 'liveMeasurement':
      return [liveMeasurement(bool(cmd, 'enable', true), num(cmd, 'mode'))];
    case 'historyRequest':
      return list(str(cmd, 'type')).map((t) => historyRequest(historyType(t)!.queryKey));
    case 'history': {
      // Framed after `begin`, which picked the first type still readable (none = nothing to write).
      const h = st.inflight?.kind === 'history' ? st.inflight.current : null;
      return h ? [historyRequest(historyType(h)!.queryKey)] : [];
    }
    case 'historyBlockAck':
      return [historyBlockAck(num(cmd, 'status'))];
    case 'devControlAck':
      return [devControlAck(num(cmd, 'key'))];
    case 'ack':
      // One op for both acknowledgements, so the session keeps the quiet timer running: `04 kk 00` or `05 80 ss`.
      return [typeof cmd.params?.key === 'number' ? devControlAck(num(cmd, 'key')) : historyBlockAck(num(cmd, 'status'))];
    case 'historyCancel':
      return [];
  }
  throw new RangeError(`ycbt: unknown command ${cmd.op}`);
}

// ---------------------------------------------------------------- planner (`YCBTSyncEngine`)

/**
 * The history walk for one sync, in catalog order filtered by capability and by what the ring refused. The first sync
 * on a connection is the startup walk (the handshake already sent `03 09`): history, then `03 09` once more, because
 * some R10M firmware only pushes today's steps the second time. Later syncs are Lumen's `refresh`: `03 09` first.
 * The last read reports the walk finished, also when there is nothing left to read (Lumen stays silent then).
 */
export function planYcbtSync(_cursor: SyncCursor, state: ProtocolState): RingCommand[] {
  const st = state as YcbtState;
  const types = supportedHistory(st.caps).filter((t) => !st.unsupported.includes(t.queryKey));
  const walk = types.map((t) => t.name).join(',');
  const reads: RingCommand[] = types.map((t, i) => ({
    op: 'history',
    params: { types: t.name, stream: t.streams[0]!, streams: t.streams.join(','), walk, walkStart: i === 0, finish: i === types.length - 1 },
  }));
  if (reads.length === 0) reads.push({ op: 'history', params: { types: '', walk: '', walkStart: true, finish: true } });
  if (!st.startupDone) return [...reads, { op: 'enableLiveStatus', params: { after: 'startup' } }];
  return [{ op: 'enableLiveStatus' }, ...reads];
}

// ---------------------------------------------------------------- history transfer (`YCBTHistoryTransfer`)

interface Step {
  st: YcbtState;
  /** Lumen's events and ready `RingEvent`s (cursors, errors), in the order they happened. */
  events: Array<YcbtDecoded | { ring: RingEvent }>;
  send: RingCommand[];
  done: boolean;
}

const request = (t: HistoryTypeName): RingCommand => ({ op: 'historyRequest', params: { type: t } });

/** Next queued type, or the end of this read. */
function advance(s: Step, h: HistoryRead): void {
  const [next, ...queue] = h.queue;
  if (next === undefined) {
    s.st = { ...s.st, inflight: null };
    s.done = true;
    if (h.finish) s.events.push({ kotlin: 'HistorySyncFinished' });
    return;
  }
  s.st = { ...s.st, walkStarted: [...s.st.walkStarted, next], inflight: { ...h, current: next, queue, phase: 'sent', buffer: [], cap: DEFAULT_BUFFER_CAP, retried: false, silentMs: 0 } };
  s.send.push(request(next));
}

function retryOrSkip(s: Step, h: HistoryRead, t: HistoryType): void {
  if (h.retried) return advance(s, h);
  s.st = { ...s.st, inflight: { ...h, retried: true, buffer: [], phase: 'sent', silentMs: 0 } };
  s.send.push(request(t.name));
}

function cursorEvents(st: YcbtState, t: HistoryType): Array<{ ring: RingEvent }> {
  const value = dayCursor(st);
  return t.streams.map((stream) => ({ ring: { type: 'status', key: 'cursor', value, stream: stream as BioStream } }));
}

/** Flushes a step's events as `RingEvent`s, dropping values of a kind the ring has not been granted. */
function flush(s: Step, origin: 'live' | 'spot'): RingEvent[] {
  return s.events.splice(0).flatMap((d) => ('ring' in d ? [d.ring] : supported(d, s.st.caps) ? toRingEvents(d, zoneOf(s.st), s.st.firmware ?? '', origin) : []));
}

function handleHealth(s: Step, cmd: number, payload: Uint8Array): void {
  const h = s.st.inflight;
  if (!h || h.kind !== 'history' || h.current === null) return; // idle, cancelled or finished: ignore
  const t = historyType(h.current)!;
  const refused = refusal(payload);
  if (refused) {
    if (refused.permanent && !s.st.unsupported.includes(t.queryKey)) s.st = { ...s.st, unsupported: [...s.st.unsupported, t.queryKey] };
    return advance(s, h);
  }
  if (cmd === t.queryKey) {
    // Header: u16 records, u16 packets, 2 unknown, u32 total bytes (an estimate, only sizes the buffer). Shorter = no data.
    if (payload.length < HEALTH.HEADER_LEN) {
      s.events.push(...cursorEvents(s.st, t));
      return advance(s, h);
    }
    const total = (payload[6]! | (payload[7]! << 8) | (payload[8]! << 16) | (payload[9]! << 24)) >>> 0;
    s.st = { ...s.st, inflight: { ...h, buffer: [], cap: Math.min(total, MAX_BUFFER_CAP), phase: 'receiving', silentMs: 0 } };
    s.events.push({ kotlin: 'HistorySyncProgress', stage: `Syncing ${t.label}…`, type: t.name });
    return;
  }
  if (cmd === t.dataKey) {
    // Data that would overflow the cap is dropped (the terminal's byte count then fails and the type is asked again).
    const buffer = h.buffer.length + payload.length <= h.cap ? [...h.buffer, ...payload] : h.buffer;
    s.st = { ...s.st, inflight: { ...h, buffer, silentMs: 0 } };
    return;
  }
  if (cmd !== HEALTH.TERMINAL) return;
  if (h.phase === 'sent' && h.buffer.length === 0) return; // a stale terminal from an earlier request
  if (payload.length < HEALTH.TERMINAL_LEN) return advance(s, h);
  // The packet counts are never checked: the ring packs whole records and sends more packets than its header said.
  const bytes = payload[2]! | (payload[3]! << 8);
  const crc = payload[4]! | (payload[5]! << 8);
  if (bytes !== h.buffer.length || crc16(h.buffer) !== crc) {
    s.send.push({ op: 'ack', params: { status: HEALTH.ACK_CRC_FAILURE } });
    return retryOrSkip(s, h, t);
  }
  s.send.push({ op: 'ack', params: { status: HEALTH.ACK_ACCEPTED } });
  s.events.push(...decodeHistory(Uint8Array.from(h.buffer), t.name, zoneOf(s.st)));
  s.events.push(...cursorEvents(s.st, t));
  advance(s, h);
}

// ---------------------------------------------------------------- capability gate and growth (`YCBTDriver`, `YCBTSyncEngine.handle`)

/** `YCBTDriver.isSupported`: values of a kind the ring has not been granted are dropped. */
function supported(d: YcbtDecoded, caps: readonly Capability[]): boolean {
  switch (d.kotlin) {
    case 'BloodPressureSample': return caps.includes('BLOOD_PRESSURE');
    case 'BloodSugarSample': return caps.includes('BLOOD_SUGAR');
    case 'HrvSample': return caps.includes('HRV');
    case 'TemperatureSample': return caps.includes('TEMPERATURE');
    case 'HistoryMeasurement':
      switch (d.kind_field) {
        case 'BLOOD_SUGAR': return caps.includes('BLOOD_SUGAR');
        case 'HRV': return caps.includes('HRV');
        case 'STRESS': return caps.includes('STRESS');
        case 'FATIGUE': return caps.includes('FATIGUE');
        case 'TEMPERATURE': return caps.includes('TEMPERATURE');
        default: return true; // HR, SpO2, respiratory rate and VO2max always pass
      }
    default: return true;
  }
}

/** A bitmap arrived: widen the capabilities, switch on the new monitors, append the newly readable history. */
function grow(s: Step, claimed: Capability[], monitors: MonitorSettings): void {
  const before = s.st.caps;
  const caps = effectiveCapabilities(s.st.variant, claimed);
  const added = caps.filter((c) => !before.includes(c));
  s.st = { ...s.st, caps };
  if (!added.length) return;
  if (s.st.configured) for (const m of monitorCommands(monitors, added, VARIANTS[s.st.variant].bpMonitor)) s.send.push({ op: 'frame', params: { logical: toHexStr(m) } });
  const h = s.st.inflight;
  if (!h || h.kind !== 'history') return; // an idle grant is read by the next sync (the planner sees the new capabilities)
  const prev = supportedHistory(before).map((t) => t.name);
  const fresh = supportedHistory(caps).map((t) => t.name).filter((n) => !prev.includes(n));
  // `ALL` carries optional fields too: read it again when BP, HRV, temperature or sugar arrives after its pass.
  if (added.some((c) => c === 'BLOOD_PRESSURE' || c === 'HRV' || c === 'TEMPERATURE' || c === 'BLOOD_SUGAR')) fresh.push('all');
  const add = [...new Set(fresh)].filter((n) => {
    const t = historyType(n)!;
    const plannedLater = s.st.walk.includes(n) && !s.st.walkStarted.includes(n);
    return !s.st.unsupported.includes(t.queryKey) && n !== h.current && !h.queue.includes(n) && !plannedLater;
  });
  if (!add.length) return;
  const order = HISTORY_CATALOG.map((t) => t.name);
  add.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  s.st = { ...s.st, walk: [...s.st.walk, ...add.filter((n) => !s.st.walk.includes(n))], inflight: { ...h, queue: [...h.queue, ...add] } };
}

// ---------------------------------------------------------------- the protocol

export function createYcbtProtocol(opts: YcbtOptions = {}): Protocol {
  const monitors = opts.monitors ?? ALL_ON_DEFAULT;
  return {
    initialState: (): YcbtState => initialYcbtState(),

    frame: (cmd, state): OutboundFrame[] => logicalFor(cmd, state as YcbtState, monitors).map((l) => ({ bytes: frameLogical(l) })),

    planSync: planYcbtSync,

    begin(cmd, state): CommandPlan {
      let st = state as YcbtState;
      st = { ...st, nowMs: num(cmd, 'nowMs', st.nowMs), tzOffsetS: num(cmd, 'tzOffsetS', st.tzOffsetS), tz: str(cmd, 'tz') || st.tz };
      // A new connection (`connectionDidStart`): the variant decides the baseline; everything learned before is dropped.
      const variant = str(cmd, 'variant');
      if (variant === 'r10m' || variant === 'tk5' || variant === 'smarthealth') st = { ...initialYcbtState(variant), nowMs: st.nowMs, tzOffsetS: st.tzOffsetS, tz: st.tz };
      switch (cmd.op) {
        case 'deviceInfo':
        case 'battery':
          return { state: { ...st, inflight: { kind: 'reply', type: GROUP.GET, cmd: GET.DEVICE_INFO, op: cmd.op } }, expectReply: true, stallMs: REPLY_MS };
        case 'supportFunction':
          return { state: { ...st, inflight: { kind: 'reply', type: GROUP.GET, cmd: GET.SUPPORT_FUNCTION, op: cmd.op } }, expectReply: true, stallMs: REPLY_MS };
        case 'monitors':
          return { state: { ...st, configured: true }, expectReply: false };
        case 'history': {
          const types = list(str(cmd, 'types')).filter((n) => historyType(n) && !st.unsupported.includes(historyType(n)!.queryKey)) as HistoryTypeName[];
          if (bool(cmd, 'walkStart', true)) st = { ...st, walk: list(str(cmd, 'walk', str(cmd, 'types'))) as HistoryTypeName[], walkStarted: [] };
          const [current = null, ...queue] = types;
          const read: HistoryRead = { kind: 'history', current, phase: 'sent', queue, buffer: [], cap: DEFAULT_BUFFER_CAP, retried: false, silentMs: 0, finish: bool(cmd, 'finish', true) };
          if (current) st = { ...st, walkStarted: [...st.walkStarted, current] };
          // Nothing readable: no write; the 1 ms stall reports the walk finished at once.
          return { state: { ...st, inflight: read }, expectReply: true, quietMs: QUIET_MS, stallMs: current ? STALL_MS : 1 };
        }
        case 'historyCancel':
          return { state: { ...st, inflight: st.inflight?.kind === 'history' ? null : st.inflight }, expectReply: false };
        case 'liveMeasurement': {
          const enable = bool(cmd, 'enable', true);
          const mode = num(cmd, 'mode');
          // `noteLiveMeasurementCommand`: every `03 2f` joins the reply FIFO (a start with its mode, a stop with null).
          const pending = [...st.pending, enable ? mode : null].slice(-MAX_PENDING);
          const inflight: Inflight | null = enable ? { kind: 'spot', mode, live: bool(cmd, 'live', false) } : st.inflight?.kind === 'spot' ? null : st.inflight;
          return { state: { ...st, pending, inflight }, expectReply: false };
        }
        case 'enableLiveStatus': {
          if (str(cmd, 'after') === 'startup') st = { ...st, startupDone: true };
          if (!bool(cmd, 'finish', false)) return { state: st, expectReply: false };
          return { state: { ...st, inflight: { kind: 'liveStatus', finish: true } }, expectReply: true, stallMs: LIVE_STATUS_WAIT_MS };
        }
      }
      return { state: st, expectReply: false };
    },

    ingest(bytes, state, channel): IngestResult {
      const s: Step = { st: state as YcbtState, events: [], send: [], done: false };
      const asm = assemble(s.st.buffers, bytes, channel ?? YCBT_STREAM);
      s.st = { ...s.st, buffers: asm.buffers };
      const out: RingEvent[] = [];
      const ctx = { tz: s.st.tz ?? undefined, tzOffsetS: s.st.tzOffsetS, nowMs: s.st.nowMs };
      for (const raw of asm.frames) {
        const f = validateFrame(raw);
        let origin: 'live' | 'spot' = 'live';
        if (!f) {
          s.events.push({ kotlin: 'Unknown', commandId: raw[0] ?? 0 });
        } else if (f.type === GROUP.HEALTH) {
          handleHealth(s, f.cmd, f.payload);
        } else {
          let startedMode: number | null = null;
          if (f.type === GROUP.DEV_CONTROL) {
            origin = 'spot';
            if (!refusal(f.payload)) s.send.push({ op: 'ack', params: { key: f.cmd } }); // every 04 push but a refusal
          }
          if (f.type === GROUP.APP_CONTROL && f.cmd === APP.LIVE_MEASUREMENT) {
            startedMode = s.st.pending[0] ?? null;
            s.st = { ...s.st, pending: s.st.pending.slice(1) };
          }
          const decoded = decodeFrame(f, ctx, startedMode);
          // A real `04 13` value proves that mode's start worked: drop the first pending start of that mode only.
          if (f.type === GROUP.DEV_CONTROL && f.cmd === DEV.MEASUREMENT_STATUS && decoded.some((d) => d.kotlin !== 'CommandAck')) {
            const i = s.st.pending.indexOf(f.payload[0]!);
            if (i >= 0) s.st = { ...s.st, pending: s.st.pending.filter((_, k) => k !== i) };
          }
          for (const d of decoded) {
            // (state first, so a bitmap in this frame already gates the frame's own values, as `updateCapabilities` does)
            if (d.kotlin === 'Status' && d.firmware !== null) s.st = { ...s.st, firmware: d.firmware };
            if (d.kotlin === 'Battery') s.st = { ...s.st, battery: d.percent };
            if (d.kotlin === 'SupportFunctions') grow(s, d.capabilities, monitors);
            const fl = s.st.inflight;
            if (fl?.kind === 'spot') {
              // The ring ends a spot with `04 0e`; for BP and HRV a success carries no value, so only a failure ends early.
              if (d.kotlin === 'MeasurementComplete' && d.mode === fl.mode && !fl.live && (!d.success || (fl.mode !== MODE.BLOOD_PRESSURE && fl.mode !== MODE.HRV))) s.done = true;
              if (d.kotlin === 'MeasurementRejected' && d.mode === fl.mode) s.done = true;
              if (s.done) s.st = { ...s.st, inflight: null };
            }
          }
          s.events.push(...decoded);
          const fl = s.st.inflight;
          if (fl?.kind === 'reply' && f.type === fl.type && f.cmd === fl.cmd) {
            s.st = { ...s.st, inflight: null };
            s.done = true;
          }
          if (fl?.kind === 'liveStatus' && f.type === GROUP.REAL && f.cmd === 0x00) {
            s.st = { ...s.st, inflight: null };
            s.done = true;
            if (fl.finish) s.events.push({ kotlin: 'HistorySyncFinished' });
          }
        }
        out.push(...flush(s, origin));
      }
      return { events: out, state: s.st, send: s.send.length ? s.send : undefined, done: s.done || undefined };
    },

    timeout(state, kind): IngestResult {
      const st = state as YcbtState;
      const fl = st.inflight;
      if (!fl) return { events: [], state: st, done: true };
      if (fl.kind === 'reply') return { events: [{ type: 'status', key: 'error', value: `timeout:${fl.op}` }], state: { ...st, inflight: null }, done: true };
      if (fl.kind === 'liveStatus') return { events: fl.finish ? [{ type: 'progress', stage: 'history', done: true }] : [], state: { ...st, inflight: null }, done: true };
      if (fl.kind === 'spot') return { events: [], state: { ...st, inflight: null }, done: true };
      const s: Step = { st, events: [], send: [], done: false };
      if (fl.current === null) {
        advance(s, fl);
      } else {
        const stream = historyType(fl.current)!.streams[0] as BioStream;
        if (kind === 'quiet' && fl.phase === 'receiving') {
          // The header came and the ring owes data: a pause is not the end. Keep waiting up to SILENCE_MAX_MS in all.
          const silentMs = fl.silentMs + QUIET_MS;
          if (silentMs < SILENCE_MAX_MS) return { events: [], state: { ...st, inflight: { ...fl, silentMs } }, done: false };
          s.events.push({ ring: { type: 'status', key: 'error', value: `partial:${stream}`, stream } });
        } else {
          s.events.push({ ring: { type: 'status', key: 'error', value: `stall:${stream}`, stream } });
        }
        advance(s, fl); // skip without an acknowledgement and without a cursor, as the Kotlin watchdog does
      }
      return { events: flush(s, 'live'), state: s.st, send: s.send.length ? s.send : undefined, done: s.done };
    },

    redactOutbound: (frame) => frame,
  };
}

export const ycbtProtocol: Protocol = createYcbtProtocol();
