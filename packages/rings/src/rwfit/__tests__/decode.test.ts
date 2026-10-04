// @vitest-environment node
/**
 * RWfit decode vectors (`decode.json`): codec-level items, legacy payloads, JL history bodies and whole notifications
 * through `protocol.ingest` with the ACKs it asks for. Timestamps: fixture epoch seconds, `RingEvent` epoch ms (UTC).
 */
import { describe, expect, it } from 'vitest';
import { fromHex, toHex, type RingEvent } from '../../types';
import { decodeJl, decodeLegacy, type Framing, type JlInbound, type LegacyInbound, type LegacyParts, type JlPending } from '../codec';
import { decodeJlHistory, decodeLegacyPayload, decodeSyncManifest, pendingStreams } from '../decoder';
import { frameRWfit, initialRWfitState, rwfitProtocol, type RWfitState } from '../protocol';
import { fixture, kotlinEvents, sameAsKotlin } from './helpers';

interface Vector {
  name: string;
  framing: Framing;
  context: { layer: string; cmd?: string; triple?: string; resetBeforePacket?: number[]; tzCorrectionS?: number };
  bytes?: string;
  bytesSequence?: string[];
  events: Array<Record<string, unknown>>;
  eventsPerPacket?: Array<Array<Record<string, unknown>>>;
  writes?: string[];
  frame?: string;
}
const vectors = fixture<{ vectors: Vector[] }>('decode.json').vectors;
const byLayer = (l: string): Vector[] => vectors.filter((v) => v.context.layer === l);
const hex = (n: number): string => `0x${n.toString(16).padStart(2, '0')}`;
const CTX = { tzOffsetS: 0, firmware: 'legacy' };

function expectKotlin(evs: RingEvent[], expected: Array<Record<string, unknown>>): void {
  const got = kotlinEvents(evs);
  expect(got.length, JSON.stringify(got)).toBe(expected.length);
  expected.forEach((e, i) => expect(sameAsKotlin(got[i], e)).toBeNull());
}

// ---------------------------------------------------------------- codec

const legacyItem = (i: LegacyInbound): Record<string, unknown> => {
  switch (i.kind) {
    case 'ackNeeded':
      return { kotlin: 'RWfitLegacyInbound.AckNeeded', cmd: hex(i.cmd), serial: i.serial };
    case 'checksumFailed':
      return { kotlin: 'RWfitLegacyInbound.ChecksumFailed', cmd: hex(i.cmd), serial: i.serial };
    case 'deviceAck':
      return { kotlin: 'RWfitLegacyInbound.DeviceAck', cmd: hex(i.cmd), serial: i.serial, status: hex(i.status) };
    case 'frame':
      return { kotlin: 'RWfitLegacyInbound.Frame', cmd: hex(i.cmd), payload: toHex(i.payload) };
  }
};
const jlItem = (i: JlInbound): Record<string, unknown> =>
  i.kind === 'frame'
    ? { kotlin: 'RWfitJLInbound.Frame', flag: hex(i.flag), triple: toHex(Uint8Array.from(i.triple)), payload: toHex(i.payload), isAck: i.isAck }
    : { kotlin: 'RWfitJLInbound.ChecksumFailed', triple: toHex(Uint8Array.from(i.triple)) };

describe('rwfit codec vectors', () => {
  for (const v of byLayer('codec')) {
    it(v.name, () => {
      const packets = v.bytesSequence ?? [v.bytes!];
      let parts: LegacyParts = {};
      let pending: JlPending | null = null;
      const per: Array<Array<Record<string, unknown>>> = [];
      packets.forEach((p, i) => {
        if (v.context.resetBeforePacket?.includes(i)) {
          parts = {};
          pending = null;
        }
        if (v.framing === 'legacy') {
          const r = decodeLegacy(fromHex(p), parts);
          parts = r.parts;
          per.push(r.items.map(legacyItem));
        } else {
          const r = decodeJl(fromHex(p), pending);
          pending = r.pending;
          per.push(r.items.map(jlItem));
        }
      });
      if (v.eventsPerPacket) expect(per).toEqual(v.eventsPerPacket);
      expect(per.flat()).toEqual(v.events);
    });
  }
});

// ---------------------------------------------------------------- payloads

describe('rwfit legacy payload vectors', () => {
  for (const v of byLayer('legacy-payload')) {
    it(v.name, () => {
      const cmd = Number(v.context.cmd);
      const payload = fromHex(v.bytes!);
      const first = v.events[0];
      if (cmd === 0xa0) {
        const m = decodeSyncManifest(payload);
        if (!first) return expect(m).toBeNull();
        if (first.kotlin === 'RWfitDecoder.SyncManifest.pendingStreams') return expect(pendingStreams(m!).map((s) => s.toUpperCase())).toEqual(first.streams);
        const { kotlin: _k, ...fields } = first;
        return expect(m).toMatchObject(fields);
      }
      expectKotlin(decodeLegacyPayload(cmd, payload, CTX).events, v.events);
      // End to end: the same payload in a legacy frame through ingest decodes the same way and is ACKed.
      const r = rwfitProtocol.ingest(fromHex(v.frame!), initialRWfitState());
      expectKotlin(r.events, v.events);
      expect(r.send?.[0]?.op).toBe('appAck');
    });
  }

  it('legacy sleep keeps the vendor stage byte per minute', () => {
    const v = byLayer('legacy-payload').find((x) => x.name.startsWith('sleep history expands'))!;
    const ev = decodeLegacyPayload(0xa2, fromHex(v.bytes!), CTX).events[0]!;
    expect(ev).toMatchObject({ type: 'sleepEpochs', epochS: 60, complete: true, firmware: 'legacy' });
    if (ev.type === 'sleepEpochs') expect([ev.rawCodes[0], ev.rawCodes[30], ev.rawCodes[50]]).toEqual([1, 2, 3]);
  });

  it('legacy battery also reports charging', () => {
    const evs = decodeLegacyPayload(0x01, fromHex('01 01 2a'), CTX).events;
    expect(evs).toEqual([{ type: 'status', key: 'battery', value: 42 }, { type: 'status', key: 'charging', value: 1 }]);
  });

  it('legacy ring time subtracts the stamped offset (UTC+2: raw local seconds − 7200)', () => {
    const evs = decodeLegacyPayload(0xa3, fromHex('66 b2 e4 c0 00 01 66 b2 e4 c0 48'), { tzOffsetS: 7200, firmware: 'legacy' }).events;
    expect(evs[0]).toMatchObject({ type: 'sample', stream: 'hr', t: (0x66b2e4c0 - 7200) * 1000, value: 72, unit: 'bpm', origin: 'history' });
  });
});

describe('rwfit JL history payload vectors', () => {
  for (const v of byLayer('jl-history-payload')) {
    it(v.name, () => {
      const key = fromHex(v.context.triple!)[1]!;
      const evs = decodeJlHistory(key, fromHex(v.bytes!), { tzOffsetS: 0, firmware: 'jl' }) ?? [];
      expectKotlin(evs, v.events);
      const r = rwfitProtocol.ingest(fromHex(v.frame!), { ...initialRWfitState(), framing: 'jl' });
      // The public event bridge rejects an implausibly large activity bucket; the raw codec still matches Kotlin bytes.
      const publicEvents = v.name.startsWith('steps decodes 16-byte') ? v.events.slice(1) : v.events;
      expectKotlin(r.events, publicEvents);
      expect(r.send).toEqual([{ op: 'appAck', params: { triple: v.context.triple } }]);
    });
  }

  it('JL steps carry the bucket width from the record gap and kcal = raw / 10', () => {
    const v = byLayer('jl-history-payload').find((x) => x.name.startsWith('steps decodes 16-byte'))!;
    const evs = decodeJlHistory(0x02, fromHex(v.bytes!), { tzOffsetS: 0, firmware: 'jl' })!;
    expect(evs).toEqual([
      { type: 'activityBucket', start: 1_723_000_000_000, durS: 3600, steps: 8421, distanceM: 12400, kcal: 310 },
      { type: 'activityBucket', start: 1_723_007_200_000, durS: 3600, steps: 1234, distanceM: 200, kcal: 45 },
    ]);
    // The zero-step record in between still bounds the buckets (3600 s apart); a lone record has no neighbour: 60 s.
    expect(decodeJlHistory(0x02, fromHex('00 00 00 00 00 00 00 01 00 00 00 00 00 00 00 00'), { tzOffsetS: 0, firmware: 'jl' })).toMatchObject([{ durS: 60 }]);
  });

  it('JL units: temperature degC, SpO2 pct, HRV ms, blood sugar mg/dL, stress vendor units', () => {
    const one = (key: number, body: string): RingEvent => decodeJlHistory(key, fromHex(body), { tzOffsetS: 0, firmware: 'jl' })![0]!;
    expect(one(0x08, '2e 45 a1 40 01 6d')).toMatchObject({ type: 'sample', stream: 'skin_temp', value: 36.5, unit: 'degC' });
    expect(one(0x09, '2e 45 a1 40 61 00')).toMatchObject({ type: 'sample', stream: 'spo2', value: 97, unit: 'pct' });
    expect(one(0x0a, '2e 45 a1 40 2a 00')).toMatchObject({ type: 'sample', stream: 'hrv', value: 42, unit: 'ms' });
    expect(one(0x0d, '2e 45 a1 40 21 00')).toMatchObject({ type: 'vendor', key: 'stress', value: 33, unit: 'vendor_units' });
    expect(one(0x10, '2e 45 a1 40 00 38')).toMatchObject({ type: 'vendor', key: 'blood_glucose_estimate', unit: 'mg/dL' });
    // JL time: epoch-2000 local seconds minus the offset now.
    expect(one(0x03, '00 00 00 00 48 00')).toMatchObject({ t: 946_684_800_000 });
    expect(decodeJlHistory(0x03, fromHex('00 00 00 00 48 00'), { tzOffsetS: 3600, firmware: 'jl' })![0]).toMatchObject({ t: (946_684_800 - 3600) * 1000 });
  });
});

// ---------------------------------------------------------------- driver (whole notifications, ACKs written back)

describe('rwfit driver vectors through ingest', () => {
  for (const v of byLayer('driver')) {
    it(v.name, () => {
      let st: RWfitState = { ...initialRWfitState(), framing: v.framing };
      // "reconnect clears the cascade": the first link wrote 6 frames; a fresh link holds no cascade (the serial counter
      // survives in the Kotlin; here the test carries it over to check the ACK serial).
      if (v.name === 'reconnect clears the cascade') st = { ...st, serial: 6 };
      const r = rwfitProtocol.ingest(fromHex(v.bytes!), st);
      expectKotlin(r.events, v.events);
      const writes = (r.send ?? []).flatMap((c) => frameRWfit(c, r.state)).map((f) => toHex(f.bytes));
      expect(writes).toEqual(v.writes);
      expect(r.done).toBeUndefined();
    });
  }

  it('a refused command (device ACK status ≠ 0) is reported, not ACKed', () => {
    const r = rwfitProtocol.ingest(fromHex('7e 01 fe 00 04 00 01 25 00 05 21 01'), initialRWfitState());
    expect(r.send).toBeUndefined();
    expect(r.events).toEqual([{ type: 'status', key: 'error', value: 'refused:0x21:1' }]);
  });
});
