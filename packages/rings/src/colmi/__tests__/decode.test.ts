// @vitest-environment node
/**
 * Colmi decode vectors (`decode.json`): every vector through the decoder the Kotlin test names, compared with the full
 * Kotlin output (`derivedEvents`); reassembly and history vectors through `protocol.ingest`, compared as `RingEvent`s.
 */
import { describe, expect, it } from 'vitest';
import { fromHex, type RingEvent } from '../../types';
import { BIG, COLMI_UUIDS, OP, civilDay, isValidFrame, localMidnightMs } from '../commands';
import {
  decodeAutoHrPrefRead, decodeBigData, decodeDeviceSupport, decodeHistory, decodeIntervalTemperature, decodeNormal, decodeTempPrefRead, toRingEvents,
  type ColmiDecoded,
} from '../decoder';
import { colmi } from '../family';
import type { ColmiState } from '../protocol';
import { fixture, kotlinEvents, sameAsKotlin } from './helpers';

type K = Record<string, unknown>;
interface DecodeVector {
  name: string;
  decoder: string;
  context?: { nowMs?: number; day?: string; todayLocal?: string; syncDayLocal?: string; tzOffsetS?: number; sampleOffset?: number; daysAgo?: number; stage?: string };
  bytes?: string;
  bytesSequence?: string[];
  valid?: boolean;
  events: K[];
  derivedEvents?: K[];
  derivedEventsAfterEachChunk?: K[][];
  result?: null;
}

const { vectors } = fixture<{ vectors: DecodeVector[] }>('decode.json');
const byDecoder = (d: string): DecodeVector[] => vectors.filter((v) => v.decoder === d);
const dayOf = (iso: string): number => civilDay(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), Number(iso.slice(8, 10)));
/** Noon of a local day, as epoch ms: "now" for decoders that anchor on today. */
const noonOf = (iso: string, tz: number): number => localMidnightMs(dayOf(iso), tz) + 12 * 3_600_000;

const STAGE: Record<number, string> = { 2: 'LIGHT', 3: 'DEEP', 4: 'REM', 5: 'AWAKE' };
/** Decoder output in the fixtures' Kotlin shape (`t` for the timestamp, sleep run-length encoded). */
function kotlinShape(d: ColmiDecoded): K {
  if (d.kotlin === 'SleepTimeline') {
    const runs: Array<{ stage: string; minutes: number }> = [];
    for (const c of d.codes) {
      const name = STAGE[c] ?? 'UNKNOWN';
      const last = runs[runs.length - 1];
      if (last && last.stage === name) last.minutes++;
      else runs.push({ stage: name, minutes: 1 });
    }
    return { kotlin: d.kotlin, t: d.t, stagesRunLength: runs, stageCount: d.codes.length };
  }
  return { ...d };
}

function expectSame(actual: K[], expected: K[], name: string): void {
  expect(actual.length, `${name}: ${JSON.stringify(actual)}`).toBe(expected.length);
  expected.forEach((e, i) => expect(sameAsKotlin(actual[i], e), name).toBeNull());
}

describe('Colmi decode vectors', () => {
  it('covers every vector', () => {
    expect(vectors.length).toBe(57);
  });

  it('ColmiPacket.validating', () => {
    for (const v of byDecoder('ColmiPacket.validating')) expect(isValidFrame(fromHex(v.bytes!)), v.name).toBe(v.valid);
  });

  it('decodeNormal: live frames, battery, notifications, refusals', () => {
    const vs = byDecoder('ColmiDecoder.decodeNormal');
    expect(vs.length).toBe(24);
    for (const v of vs) expectSame(decodeNormal(fromHex(v.bytes!), v.context!.nowMs!).map(kotlinShape), v.derivedEvents!, v.name);
  });

  it('decodeHistory: HRV packet 1 and activity slots on the local grid', () => {
    for (const v of byDecoder('ColmiDecoder.decodeHistory')) {
      const c = v.context!;
      const out = decodeHistory(fromHex(v.bytes!), { day: dayOf(c.day!), tzOffsetS: c.tzOffsetS!, nowMs: c.nowMs!, slotMinutes: null });
      expectSame(out.map(kotlinShape), v.derivedEvents!, v.name);
    }
  });

  it('handshake replies: HR pref, temperature pref, device support', () => {
    for (const v of byDecoder('ColmiDecoder.decodeAutoHRPrefRead')) {
      const r = decodeAutoHrPrefRead(fromHex(v.bytes!));
      const e = v.derivedEvents![0];
      expect(r, v.name).toEqual(e ? { enabled: e.enabled, intervalMinutes: e.intervalMinutes } : null);
    }
    for (const v of byDecoder('ColmiDecoder.decodeTempPrefRead')) {
      const e = v.derivedEvents![0];
      expect(decodeTempPrefRead(fromHex(v.bytes!)), v.name).toBe(e ? e.value : null);
    }
    for (const v of byDecoder('ColmiDecoder.decodeDeviceSupport')) {
      const e = v.derivedEvents![0];
      expect(decodeDeviceSupport(fromHex(v.bytes!)), v.name).toEqual(e ? { supportsBlePair: e.supportsBlePair, supportsIntervalTemp: e.supportsIntervalTemp } : null);
    }
  });

  it('decodeBigData and decodeIntervalTemperature on the local day grid', () => {
    for (const v of byDecoder('ColmiDecoder.decodeBigData')) {
      const tz = v.context!.tzOffsetS!;
      expectSame(decodeBigData(fromHex(v.bytes!), { nowMs: noonOf(v.context!.todayLocal!, tz), tzOffsetS: tz }).map(kotlinShape), v.derivedEvents!, v.name);
    }
    for (const v of byDecoder('ColmiDecoder.decodeIntervalTemperature')) {
      const tz = v.context!.tzOffsetS!;
      const out = decodeIntervalTemperature(fromHex(v.bytes!), v.context!.sampleOffset!, { nowMs: noonOf(v.context!.todayLocal!, tz), tzOffsetS: tz });
      expectSame(out.map(kotlinShape), v.derivedEvents!, v.name);
    }
  });

  it('big-data reassembly through protocol.ingest on the V2 channel', () => {
    for (const v of byDecoder('ColmiDriver.ingest (big-data reassembly)')) {
      const tz = v.context!.tzOffsetS!;
      let st: ColmiState = { ...(colmi.protocol.initialState() as ColmiState), nowMs: noonOf(v.context!.todayLocal!, tz), tzOffsetS: tz };
      v.bytesSequence!.forEach((chunk, i) => {
        const r = colmi.protocol.ingest(fromHex(chunk), st, COLMI_UUIDS.bigData);
        st = r.state as ColmiState;
        expectSame(kotlinEvents(r.events), v.derivedEventsAfterEachChunk![i]!, `${v.name} chunk ${i}`);
      });
      expect(st.bigData, v.name).toBeNull();
    }
  });

  it('a garbage HR echo keeps the samples on the requested day (history stage through the protocol)', () => {
    const [v] = byDecoder('ColmiSyncEngine.handleHistoryFrame');
    const c = v!.context!;
    let st = colmi.protocol.begin!({ op: 'history', params: { stage: 'hr', stream: 'hr', lastDay: 0, nowMs: c.nowMs!, tzOffsetS: c.tzOffsetS! } }, colmi.protocol.initialState()).state;
    const evs: RingEvent[] = [];
    for (const chunk of v!.bytesSequence!) {
      const r = colmi.protocol.ingest(fromHex(chunk), st, COLMI_UUIDS.notify);
      st = r.state;
      evs.push(...r.events);
    }
    expectSame(kotlinEvents(evs), v!.derivedEventsAfterEachChunk!.flat(), v!.name);
  });
});

describe('Colmi days across a daylight-saving change (Europe/Berlin, clocks back on 2026-10-25)', () => {
  const tz = 'Europe/Berlin';
  const day = dayOf('2026-10-24');
  /** One valid 16-byte frame: content, zero padding, byte-sum checksum. */
  const frame = (content: number[]): Uint8Array => {
    const b = [...content, ...Array<number>(15 - content.length).fill(0)];
    return Uint8Array.from([...b, b.reduce((s, x) => s + x, 0) & 0xff]);
  };
  // Read on 10-24 at noon (+02:00) and on 10-26 at noon (+01:00).
  const on24 = { nowMs: Date.parse('2026-10-24T10:00:00Z'), tzOffsetS: 7200, tz };
  const on26 = { nowMs: Date.parse('2026-10-26T11:00:00Z'), tzOffsetS: 3600, tz };

  it('a day-log slot of 10-24 lands on the same instant whether read on 10-24 or on 10-26', () => {
    const hr = frame([OP.SYNC_HEART_RATE, 0x01, 0, 0, 0, 0, 60, 61]);
    const read = (ctx: typeof on24) => decodeHistory(hr, { day, slotMinutes: null, ...ctx }).map((d) => (d as { t: number }).t);
    expect(read(on24)).toEqual([Date.parse('2026-10-23T22:00:00Z'), Date.parse('2026-10-23T22:05:00Z')]);
    expect(read(on26)).toEqual(read(on24));
  });

  it('SpO2 hours are wall-clock hours of their own day, a 25-hour day included', () => {
    // Block "2 days ago" read on 10-26 = 10-24; block "1 day ago" = 10-25, the 25-hour day. Hour 5 has (96, 98).
    const block = (daysAgo: number): number[] => [daysAgo, ...Array.from({ length: 24 }, (_, h) => (h === 5 ? [96, 98] : [0, 0])).flat()];
    const payload = [...block(2), ...block(1)];
    const big = Uint8Array.from([OP.BIG_DATA_V2, BIG.SPO2, payload.length & 0xff, payload.length >> 8, 0, 0, ...payload]);
    expect(decodeBigData(big, on26).map((d) => (d as { t: number }).t)).toEqual([Date.parse('2026-10-24T03:00:00Z'), Date.parse('2026-10-25T04:00:00Z')]);
    const today = Uint8Array.from([OP.BIG_DATA_V2, BIG.SPO2, 49, 0, 0, 0, ...block(0)]);
    expect(decodeBigData(today, on24).map((d) => (d as { t: number }).t)).toEqual([Date.parse('2026-10-24T03:00:00Z')]);
  });

  it('a long-lived link that crossed midnight reads yesterday again (sync at 23:40, next at 00:10)', () => {
    const P = colmi.protocol;
    const at = (iso: string) => ({ nowMs: Date.parse(iso), tzOffsetS: 7200 });
    const empty = frame([OP.SYNC_HEART_RATE, 0xff]); // a day with no samples: the day ends here
    // 23:40 local on 07-17: a full HR walk completes on this connection.
    let st = P.begin!({ op: 'history', params: { stage: 'hr', stream: 'hr', lastDay: 0, ...at('2026-07-17T21:40:00Z') } }, P.initialState()).state;
    st = P.ingest(empty, st, COLMI_UUIDS.notify).state;
    const planned = P.planSync({}, st).find((c) => c.params?.stage === 'hr')!;
    // Again before midnight: today only.
    expect(P.begin!({ ...planned, params: { ...planned.params, ...at('2026-07-17T21:50:00Z') } }, st).state).toMatchObject({ inflight: { lastDay: 0 } });
    // 00:10 on 07-18: day 0 first, then day 1 as the follow-up.
    const next = P.begin!({ ...planned, params: { ...planned.params, ...at('2026-07-17T22:10:00Z') } }, st).state;
    expect(next).toMatchObject({ inflight: { kind: 'history', stage: 'hr', daysAgo: 0, lastDay: 1 } });
    expect(P.ingest(empty, next, COLMI_UUIDS.notify).send).toEqual([{ op: 'syncHeartRate', params: { daysAgo: 1, ...at('2026-07-17T22:10:00Z') } }]);
  });
});

describe('Colmi RingEvent mapping', () => {
  const now = Date.parse('2026-07-17T10:00:00Z');
  const ingest = (hex: string, state = colmi.protocol.initialState()) => colmi.protocol.ingest(fromHex(hex), { ...state, nowMs: now, tzOffsetS: 7200 }, COLMI_UUIDS.notify);

  it('battery, live and spot readings, live activity as a day total', () => {
    expect(ingest('03 54 01 00 00 00 00 00 00 00 00 00 00 00 00 58').events).toEqual([{ type: 'status', key: 'battery', value: 84 }]);
    expect(ingest('1e 00 4b 00 00 00 00 00 00 00 00 00 00 00 00 69').events).toEqual([{ type: 'sample', stream: 'hr', t: now, value: 75, unit: 'bpm', origin: 'live' }]);
    expect(ingest('78 00 01 00 05 84 00 01 2c 00 00 64 00 00 00 93').events).toEqual([{ type: 'sample', stream: 'hr', t: now, value: 132, unit: 'bpm', origin: 'workout_stream' }]);
    const spo2 = ingest('69 03 00 61 00 00 00 00 00 00 00 00 00 00 00 cd');
    expect(spo2.events).toEqual([{ type: 'sample', stream: 'spo2', t: now, value: 97, unit: 'pct', origin: 'spot' }]);
    // Local midnight of 2026-07-17 at +02:00.
    expect(ingest('73 12 00 01 f4 01 e0 78 00 01 2c 00 00 00 00 00').events).toEqual([
      { type: 'dailyTotal', localDay: Date.parse('2026-07-16T22:00:00Z'), steps: 500, distanceM: 300, kcal: 123 },
    ]);
  });

  it('a ring-side end of a measurement ends a spot or live stream, never a history read', () => {
    const r = ingest('69 01 01 00 00 00 00 00 00 00 00 00 00 00 00 6b');
    expect(r.events).toEqual([{ type: 'status', key: 'error', value: 'no_reading' }]);
    expect(r.done).toBe(true);
    const busy = colmi.protocol.begin!({ op: 'history', params: { stage: 'hr', stream: 'hr', nowMs: now, tzOffsetS: 7200 } }, colmi.protocol.initialState()).state;
    expect(colmi.protocol.ingest(fromHex('69 01 01 00 00 00 00 00 00 00 00 00 00 00 00 6b'), busy, COLMI_UUIDS.notify).done).toBeUndefined();
  });

  it('a history read left in flight by an aborted sync does not gate a later spot or live run', () => {
    const stale = colmi.protocol.begin!({ op: 'history', params: { stage: 'hr', stream: 'hr', nowMs: now, tzOffsetS: 7200 } }, colmi.protocol.initialState()).state;
    const spot = colmi.protocol.begin!({ op: 'manualHeartRate', params: { enable: true, nowMs: now, tzOffsetS: 7200 } }, stale).state;
    expect((spot as ColmiState).inflight).toBeNull();
    expect(ingest('69 01 01 00 00 00 00 00 00 00 00 00 00 00 00 6b', spot).done).toBe(true);
    const live = colmi.protocol.begin!({ op: 'realtimeHeartRate', params: { enable: true, nowMs: now, tzOffsetS: 7200 } }, stale).state;
    expect(ingest('9e ee 00 00 00 00 00 00 00 00 00 00 00 00 00 8c', live).send).toEqual([{ op: 'manualHeartRate', params: { enable: true } }]);
  });

  it('9e moves live heart rate onto the 0x69 stream once, and remembers it', () => {
    const r = ingest('9e ee 00 00 00 00 00 00 00 00 00 00 00 00 00 8c');
    expect(r.send).toEqual([{ op: 'manualHeartRate', params: { enable: true } }]);
    expect((r.state as ColmiState).realtimeRejected).toBe(true);
    expect(ingest('9e ee 00 00 00 00 00 00 00 00 00 00 00 00 00 8c', r.state).send).toBeUndefined();
  });

  it('device support: capabilities always, a bond request only for allowlisted models', () => {
    const bit = '3c 00 08 00 00 00 00 00 00 80 00 00 00 00 00 c4';
    const r10 = ingest(bit, { ...colmi.protocol.initialState(), model: 'R10', bondAllowed: false });
    expect(r10.events).toEqual([{ type: 'status', key: 'capabilities', value: 'ble_pair,interval_temp' }]);
    const r09 = ingest(bit, { ...colmi.protocol.initialState(), model: 'R09', bondAllowed: true });
    expect(r09.events).toContainEqual({ type: 'status', key: 'bond_requested', value: 'R09' });
    expect(r09.state).toMatchObject({ bondRequested: true, supportsBlePair: true, supportsIntervalTemp: true });
  });

  it('sleep keeps the vendor codes and never claims the night closed', () => {
    const out = toRingEvents([{ kotlin: 'SleepTimeline', t: 0, codes: [2, 3, 4, 5, 9] }], 'RT09');
    expect(out).toEqual([{ type: 'sleepEpochs', start: 0, epochS: 60, stages: ['light', 'deep', 'rem', 'awake', 'unknown'], rawCodes: [2, 3, 4, 5, 9], firmware: 'RT09', complete: false }]);
  });
});
