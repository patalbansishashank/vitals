/**
 * CRP (`fdda`-profile) decoder: frame reassembly and every reply Lumen decodes. Tier P.
 * Port of Lumen's `CRPDecoder.kt` (`CRPFrameAssembler`, `CRPDecoder`) and the `fdd3` routing in `CRPDriver.ingest`.
 * Golden vectors: `qa/fixtures/rings/crp/decode.json`.
 *
 * Two steps, like the Kotlin: `decodeCrp` gives Kotlin-shaped events (`kotlin` = the Kotlin class name, field names as
 * the Kotlin) so the fixtures compare one to one; `toCrpRingEvents` maps them onto `RingEvent`s (crp.md, "Mapping").
 * Times are epoch ms. The ring sends no absolute time: every history time is laid out from the phone's local midnight
 * of (today − day) in the session's zone (`tz`, else the fixed offset `tzOffsetS`), like the Kotlin's
 * `LocalDate.minusDays(n).atStartOfDay(zone)`; slots within a daylight-saving day count elapsed minutes from that
 * midnight (UNVERIFIED how the ring counts them).
 */
import type { RingEvent, SleepStage } from '../types';
import { GROUP, CMD, HEADER_SIZE, MAX_HISTORY_DAY, frameLength, isFrameStart, timingByCmd } from './commands';
import { zoneDayIndex, zoneMidnightMs } from '../zone';
import { plausibleAggregate } from '../plausibility';

export type CrpStage = 'AWAKE' | 'LIGHT' | 'DEEP' | 'REM' | 'UNKNOWN';
export type CrpKind = 'HEART_RATE' | 'SPO2' | 'HRV' | 'STRESS' | 'TEMPERATURE';

export type CrpDecoded =
  | { kotlin: 'ActivityUpdate'; t: number; steps: number; distanceMeters: number; calories: number }
  | { kotlin: 'HeartRateSample'; t: number; bpm: number }
  | { kotlin: 'HrvSample'; t: number; value: number }
  | { kotlin: 'Spo2Result'; t: number; value: number }
  | { kotlin: 'StressSample'; t: number; value: number }
  | { kotlin: 'TemperatureSample'; t: number; celsius: number }
  | { kotlin: 'WearingStatus'; t: number; worn: boolean }
  | { kotlin: 'FirmwareRevision'; version: string }
  | { kotlin: 'SupportFunctions'; capabilities: string[] }
  /** `commandId` is Lumen's lossy `(group << 4) | (cmd & 0x0f)`; `group` and `cmd` keep the whole opcode. */
  | { kotlin: 'CommandAck'; commandId: number; group: number; cmd: number }
  | { kotlin: 'HistoryMeasurement'; kind: CrpKind; value: number; t: number }
  | { kotlin: 'TimingHistoryFrame'; cmd: number; day: number; frameIndex: number }
  | { kotlin: 'SleepTimeline'; t: number; stages: CrpStage[]; rawCodes: number[]; dayIndex: number }
  | { kotlin: 'FramePending'; startsFrame: boolean };

export interface CrpDecodeContext {
  /** Command clock anchors history day indexes. */
  nowMs: number;
  /** Notification arrival clock stamps live measurements and bounds future history. */
  receivedMs?: number;
  /** IANA zone (per-day daylight-saving offset); absent = the fixed `tzOffsetS`. */
  tz?: string;
  tzOffsetS: number;
}

// ---------------------------------------------------------------- reassembly (`CRPFrameAssembler`)

/** Assembler state: plain and serialisable (bytes as numbers). A new connection starts from `EMPTY_ASSEMBLY`. */
export interface CrpAssembly {
  buf: number[];
  expected: number;
}

export const EMPTY_ASSEMBLY: CrpAssembly = { buf: [], expected: 0 };

/**
 * `CRPFrameAssembler.append`: an `FD DA` chunk starts a new frame (dropping any partial one); a chunk with no frame in
 * progress is dropped; bytes past the declared length are cut off, not kept for the next frame.
 */
export function assemble(asm: CrpAssembly, chunk: Uint8Array): { asm: CrpAssembly; frame: Uint8Array | null } {
  if (chunk.length === 0) return { asm, frame: null };
  let { buf, expected } = asm;
  if (isFrameStart(chunk)) {
    expected = frameLength(chunk);
    buf = [];
  }
  if (expected <= 0) return { asm: { buf: [], expected: 0 }, frame: null };
  buf = [...buf, ...chunk];
  if (buf.length >= expected) return { asm: EMPTY_ASSEMBLY, frame: Uint8Array.from(buf.slice(0, expected)) };
  return { asm: { buf, expected }, frame: null };
}

// ---------------------------------------------------------------- decoding (`CRPDecoder`)

const MAX_SLEEP_MINUTES = 24 * 60;
/** An awake run this long splits a night into separate sessions (`SESSION_GAP_MINUTES`). */
const SESSION_GAP_MINUTES = 60;
const SLOT_MS = 5 * 60_000;

const ack = (group: number, cmd: number): CrpDecoded => ({ kotlin: 'CommandAck', commandId: ((group << 4) | (cmd & 0x0f)) & 0xff, group, cmd });
const le3 = (b: Uint8Array, o: number): number => b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16);

/** `CRPDriver.ingest` + `CRPDecoder.decode` for a whole frame or an `fdd1` push; `channel` is the notifying UUID. */
export function decodeCrp(data: Uint8Array, channel: string, ctx: CrpDecodeContext): CrpDecoded[] {
  if (channel.toLowerCase().includes('fdd1')) return decodeCurrentSteps(data, ctx.receivedMs ?? ctx.nowMs);
  if (isFrameStart(data)) return decodeFramedReply(data, ctx);
  return [];
}

/** `decodeCurrentSteps`: little-endian u24 triples (steps, distance m, kcal); missing ones are 0; bytes past 9 ignored. */
function decodeCurrentSteps(data: Uint8Array, nowMs: number): CrpDecoded[] {
  if (data.length === 0 || data.length % 3 !== 0) return [];
  return [{
    kotlin: 'ActivityUpdate', t: nowMs, steps: le3(data, 0),
    distanceMeters: data.length >= 6 ? le3(data, 3) : 0, calories: data.length >= 9 ? le3(data, 6) : 0,
  }];
}

function decodeFramedReply(frame: Uint8Array, ctx: CrpDecodeContext): CrpDecoded[] {
  if (frame.length < HEADER_SIZE) return [];
  const group = frame[4]!;
  const cmd = frame[5]!;
  const payload = frame.subarray(HEADER_SIZE);
  if (group === GROUP.DEVICE) return decodeVitalResult(cmd, payload, ctx.receivedMs ?? ctx.nowMs);
  if (group === GROUP.HISTORY) {
    if (cmd === CMD.HISTORY_SLEEP) return decodeSleep(payload, ctx);
    if (cmd === CMD.QUERY_SUPPORT_SPO2_TYPE) return decodeSpo2Support(payload);
    return decodeTimingHistory(cmd, payload, ctx) ?? [ack(group, cmd)];
  }
  if (group === GROUP.POWER) {
    if (cmd === CMD.WEAR_STATE && payload.length > 0) return [{ kotlin: 'WearingStatus', t: ctx.receivedMs ?? ctx.nowMs, worn: payload[0] !== 0 }];
    if (cmd === CMD.QUERY_FIRMWARE) {
      const fw = decodeFirmwareVersion(payload);
      if (fw !== null) return [{ kotlin: 'FirmwareRevision', version: fw }];
    }
  }
  // Everything else (group 7 included) is an acknowledgement (`decodeGomoreResponse` and the fallthroughs).
  return [ack(group, cmd)];
}

/** `decodeVitalResult`: group-1 spot / live results with the vendor's plausible bands; other group-1 replies are acks. */
function decodeVitalResult(cmd: number, payload: Uint8Array, t: number): CrpDecoded[] {
  if (payload.length === 0) return [ack(GROUP.DEVICE, cmd)];
  const v = payload[0]!;
  switch (cmd) {
    case CMD.MEASURE_HR:
      return v >= 40 && v <= 200 ? [{ kotlin: 'HeartRateSample', t, bpm: v }] : [];
    case CMD.MEASURE_HRV:
      return v >= 20 && v <= 200 ? [{ kotlin: 'HrvSample', t, value: v }] : [];
    case CMD.MEASURE_SPO2:
      return v >= 70 && v <= 100 ? [{ kotlin: 'Spo2Result', t, value: v }] : []; // FF = no reading
    case CMD.MEASURE_STRESS:
      return v <= 100 ? [{ kotlin: 'StressSample', t, value: v }] : [];
    case CMD.MEASURE_TEMP: {
      if (payload.length < 2) return [];
      const raw = v | (payload[1]! << 8);
      // Kotlin `raw / 10.0` in 28.0..50.0.
      return raw >= 280 && raw <= 500 ? [{ kotlin: 'TemperatureSample', t, celsius: raw / 10 }] : [];
    }
  }
  return [ack(GROUP.DEVICE, cmd)];
}

/** `decodeFirmwareVersion`: strict UTF-8, trimmed of whitespace and NUL; empty or still holding a control char = null. */
function decodeFirmwareVersion(payload: Uint8Array): string | null {
  let raw: string;
  try {
    raw = new TextDecoder('utf-8', { fatal: true }).decode(payload);
  } catch {
    return null;
  }
  const trimmed = raw.replace(/^[\s\0]+|[\s\0]+$/g, '');
  if (!trimmed) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f]/.test(trimmed)) return null; // Kotlin `Char.isISOControl`
  return trimmed;
}

/** `decodeSpO2Support`: 1 (sleep SpO2) or 2 (timed SpO2) claim support; 0 and anything else grant nothing. */
function decodeSpo2Support(payload: Uint8Array): CrpDecoded[] {
  if (payload.length === 0) return [ack(GROUP.HISTORY, CMD.QUERY_SUPPORT_SPO2_TYPE)];
  const type = payload[0]!;
  return [{ kotlin: 'SupportFunctions', capabilities: type === 1 || type === 2 ? ['SPO2', 'MANUAL_SPO2'] : [] }];
}

const TIMING_BANDS: Record<number, { kind: CrpKind; min: number; max: number; scale: number }> = {
  [CMD.HISTORY_HR]: { kind: 'HEART_RATE', min: 40, max: 200, scale: 1 },
  // History SpO2 keeps the vendor's 1..100 (spot is 70..100); open question 4, kept as the Kotlin.
  [CMD.HISTORY_SPO2]: { kind: 'SPO2', min: 1, max: 100, scale: 1 },
  [CMD.HISTORY_HRV]: { kind: 'HRV', min: 1, max: 300, scale: 1 },
  [CMD.HISTORY_STRESS]: { kind: 'STRESS', min: 1, max: 100, scale: 1 },
  [CMD.HISTORY_TEMP]: { kind: 'TEMPERATURE', min: 280, max: 500, scale: 10 },
};

/**
 * `decodeTimingHistory`: `[day][frameIndex]` + slots of 5 min (144 one-byte or 72 two-byte slots per frame). Slot `s` of
 * frame `f` is at local midnight of (today − day) + (f × slotsPerFrame + s) × 5 min. 0 and out-of-band values are empty
 * slots. Every frame ends with its `TimingHistoryFrame` marker (it drives the next-frame pull). Null = not a timing cmd.
 */
function decodeTimingHistory(cmd: number, payload: Uint8Array, ctx: CrpDecodeContext): CrpDecoded[] | null {
  const band = TIMING_BANDS[cmd];
  const vital = timingByCmd(cmd);
  if (!band || !vital) return null;
  if (payload.length < 2) return [];
  const day = payload[0]!;
  const frameIndex = payload[1]!;
  if (day > MAX_HISTORY_DAY) return [ack(GROUP.HISTORY, cmd)];
  const midnight = zoneMidnightMs(zoneDayIndex(ctx.nowMs, ctx) - day, ctx);
  const step = vital.twoByte ? 2 : 1;
  const perFrame = vital.twoByte ? 72 : 144;
  // A frame outside this vital's daily range cannot be part of the history walk.
  if (frameIndex > vital.terminalFrame || payload.length > 2 + perFrame * step) return [ack(GROUP.HISTORY, cmd)];
  const out: CrpDecoded[] = [];
  for (let i = 2, slot = 0; i + step - 1 < payload.length; i += step, slot++) {
    const v = vital.twoByte ? payload[i]! | (payload[i + 1]! << 8) : payload[i]!;
    if (v < band.min || v > band.max) continue;
    out.push({ kotlin: 'HistoryMeasurement', kind: band.kind, value: v / band.scale, t: midnight + (frameIndex * perFrame + slot) * SLOT_MS });
  }
  out.push({ kotlin: 'TimingHistoryFrame', cmd, day, frameIndex });
  return out;
}

const STAGE_OF = (state: number): CrpStage => (state === 0 ? 'AWAKE' : state === 1 ? 'LIGHT' : state === 2 ? 'DEEP' : state === 3 ? 'REM' : 'UNKNOWN');

/**
 * `decodeSleep`: `[dayIndex]` + N × `[state][hour][minute]`, each record "from hh:mm the sleep is in `state`". dayIndex is
 * the wake day (today − dayIndex); a first record later in the day than the last means the night began the evening
 * before (UNVERIFIED on hardware: Lumen inferred it from one post-midnight capture). An awake run of 60 min or more
 * splits sessions and belongs to neither; a session with no sleep minute is dropped.
 */
function decodeSleep(payload: Uint8Array, ctx: CrpDecodeContext): CrpDecoded[] {
  if (payload.length < 4 || payload.length % 3 !== 1) return [];
  const dayIndex = payload[0]!;
  if (dayIndex > MAX_HISTORY_DAY) return [];
  const transitions: Array<{ elapsed: number; state: number }> = [];
  let firstMin = -1;
  let lastMin = 0;
  let elapsed = 0;
  let prevH = 0;
  let prevM = 0;
  for (let off = 1; off + 2 < payload.length; off += 3) {
    const state = payload[off]!;
    const h = payload[off + 1]!;
    const m = payload[off + 2]!;
    if (h > 23 || m > 59) continue;
    if (transitions.length === 0) {
      firstMin = h * 60 + m;
      lastMin = firstMin;
      transitions.push({ elapsed: 0, state });
    } else {
      // `sleepSegmentMinutes`: wraps past midnight; a skipped record leaves the previous kept time as it was.
      const dur = ((prevH > h ? h + 24 : h) - prevH) * 60 + m - prevM;
      if (dur < 0 || dur > MAX_SLEEP_MINUTES) continue;
      elapsed += dur;
      lastMin = h * 60 + m;
      transitions.push({ elapsed, state });
    }
    prevH = h;
    prevM = m;
  }
  if (transitions.length < 2) return [];
  const startOffset = firstMin > lastMin ? firstMin - 1440 : firstMin;
  const anchor = zoneMidnightMs(zoneDayIndex(ctx.nowMs, ctx) - dayIndex, ctx) + startOffset * 60_000;
  const out: CrpDecoded[] = [];
  let stages: CrpStage[] = [];
  let codes: number[] = [];
  let boutStart = 0;
  const emit = (): void => {
    if (stages.some((s) => s !== 'AWAKE')) out.push({ kotlin: 'SleepTimeline', t: anchor + boutStart * 60_000, stages, rawCodes: codes, dayIndex });
  };
  for (let i = 0; i < transitions.length - 1; i++) {
    const seg = transitions[i]!;
    const dur = transitions[i + 1]!.elapsed - seg.elapsed;
    if (dur <= 0) continue;
    const stage = STAGE_OF(seg.state);
    if (stage === 'AWAKE' && dur >= SESSION_GAP_MINUTES) {
      emit();
      stages = [];
      codes = [];
      continue;
    }
    if (stages.length === 0) boutStart = seg.elapsed;
    for (let k = 0; k < dur; k++) {
      stages.push(stage);
      codes.push(seg.state);
    }
  }
  emit();
  return out;
}

// ---------------------------------------------------------------- mapping onto RingEvent (crp.md, "Mapping to RingEvent")

const LOWER: Record<CrpStage, SleepStage> = { AWAKE: 'awake', LIGHT: 'light', DEEP: 'deep', REM: 'rem', UNKNOWN: 'unknown' };

export interface CrpMapContext extends CrpDecodeContext {
  firmware: string;
}

/**
 * Kotlin events → `RingEvent`s. Live values carry origin `live` (the session retags them `spot` during a spot run).
 * `TimingHistoryFrame` and `FramePending` give no event (they drive protocol state). A night is `complete` when its wake
 * day is before today (Lumen never set the flag; a past wake day cannot change any more).
 */
export function toCrpRingEvents(decoded: readonly CrpDecoded[], ctx: CrpMapContext): RingEvent[] {
  const out: RingEvent[] = [];
  const bound = ctx.receivedMs ?? ctx.nowMs;
  const plausibleTime = (t: number): boolean => Number.isFinite(t) && (bound <= 0 || t <= bound);
  for (const d of decoded) {
    switch (d.kotlin) {
      case 'ActivityUpdate':
        // Running totals for today, not a bucket; `localDay` = epoch ms of that local midnight (records.ts).
        out.push({ type: 'dailyTotal', localDay: zoneMidnightMs(zoneDayIndex(d.t, ctx), ctx), steps: d.steps, distanceM: d.distanceMeters, kcal: d.calories });
        break;
      case 'HeartRateSample':
        out.push({ type: 'sample', stream: 'hr', t: d.t, value: d.bpm, unit: 'bpm', origin: 'live' });
        break;
      case 'HrvSample':
        out.push({ type: 'sample', stream: 'hrv', t: d.t, value: d.value, unit: 'ms', origin: 'live' });
        break;
      case 'Spo2Result':
        out.push({ type: 'sample', stream: 'spo2', t: d.t, value: d.value, unit: 'pct', origin: 'live' });
        break;
      case 'StressSample':
        if (d.value >= 1 && d.value <= 100) out.push({ type: 'vendor', key: 'stress', t: d.t, value: d.value, unit: 'score', origin: 'live' });
        break;
      case 'TemperatureSample':
        if (d.celsius >= 30 && d.celsius <= 45) out.push({ type: 'sample', stream: 'skin_temp', t: d.t, value: d.celsius, unit: 'degC', origin: 'live' });
        break;
      case 'HistoryMeasurement':
        if (!plausibleTime(d.t) || (d.kind === 'SPO2' && (d.value < 70 || d.value > 100)) || (d.kind === 'TEMPERATURE' && (d.value < 30 || d.value > 45))) break;
        if (d.kind === 'STRESS') {
          if (d.value >= 1 && d.value <= 100) out.push({ type: 'vendor', key: 'stress', t: d.t, value: d.value, unit: 'score', origin: 'history' });
        } else {
          const m = { HEART_RATE: ['hr', 'bpm'], SPO2: ['spo2', 'pct'], HRV: ['hrv', 'ms'], TEMPERATURE: ['skin_temp', 'degC'] } as const;
          const [stream, unit] = m[d.kind];
          out.push({ type: 'sample', stream, t: d.t, value: d.value, unit, origin: 'history' });
        }
        break;
      case 'SleepTimeline':
        if (d.stages.length <= 1440 && plausibleTime(d.t + d.stages.length * 60_000)) out.push({ type: 'sleepEpochs', start: d.t, epochS: 60, stages: d.stages.map((s) => LOWER[s]), rawCodes: d.rawCodes, firmware: ctx.firmware, complete: d.dayIndex >= 1 });
        break;
      case 'WearingStatus':
        // No `worn` status key: off the finger is reported as an error (open question 3); worn needs no event.
        if (!d.worn) out.push({ type: 'status', key: 'error', value: 'not_worn' });
        break;
      case 'FirmwareRevision':
        out.push({ type: 'status', key: 'firmware', value: d.version });
        break;
      case 'SupportFunctions':
        // Informational only: Lumen never drops SpO2 because of it.
        out.push({ type: 'status', key: 'capabilities', value: d.capabilities.includes('SPO2') ? 'spo2' : '' });
        break;
      case 'CommandAck':
        out.push({ type: 'status', key: 'ack', value: `crp:${d.group}/${d.cmd}` });
        break;
      case 'TimingHistoryFrame':
      case 'FramePending':
        break;
    }
  }
  return out.filter(plausibleAggregate);
}
