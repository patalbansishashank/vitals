// @vitest-environment node
/**
 * Decode vectors from `qa/fixtures/rings/luckring/decode.json`: the 20-byte packets go through `protocol.ingest` (or
 * the assembler for the `assembler` layer) and the mapped `RingEvent`s are checked against the Kotlin events (subset)
 * and the full derived output; ACK writes come back as `send` and are framed byte-exact.
 */
import { describe, expect, it } from 'vitest';
import { fromHex, toHex, type RingCommand, type RingEvent } from '../../types';
import { cmdName, type LogicalFrame } from '../commands';
import { assemble, decodeFrame, type PartialFrame } from '../decoder';
import { createLuckRingProtocol, type LuckRingState } from '../protocol';
import { expectKotlin, fixture, type Kotlin } from './helpers';

interface DecodeVector {
  name: string;
  context: { layer: 'decoder' | 'driver' | 'assembler'; cmdType?: string };
  bytes?: string;
  bytesSequence?: string[];
  events?: Kotlin[];
  derived?: Kotlin[];
  writes?: string[];
  perPacket?: Array<{ events: Kotlin[]; writes: string[] }>;
  frames?: Array<{ cmdType: string; dataType: number; seq: number; devType: number; payload: string } | null>;
}
const { vectors } = fixture<{ vectors: DecodeVector[] }>('decode.json');
const protocol = createLuckRingProtocol();
const packetsOf = (v: DecodeVector): string[] => v.bytesSequence ?? (v.bytes ? [v.bytes] : []);
const framed = (send: RingCommand[] | undefined, st: LuckRingState): string[] => (send ?? []).flatMap((c) => protocol.frame(c, st).map((f) => toHex(f.bytes)));

function feed(v: DecodeVector): { events: RingEvent[]; writes: string[]; per: Array<{ events: RingEvent[]; writes: string[] }> } {
  let st = protocol.initialState() as LuckRingState;
  const events: RingEvent[] = [];
  const writes: string[] = [];
  const per: Array<{ events: RingEvent[]; writes: string[] }> = [];
  for (const p of packetsOf(v)) {
    const r = protocol.ingest(fromHex(p), st);
    st = r.state as LuckRingState;
    const w = framed(r.send, st);
    per.push({ events: r.events, writes: w });
    events.push(...r.events);
    writes.push(...w);
  }
  return { events, writes, per };
}

describe('LuckRing decode vectors', () => {
  const decoders = vectors.filter((v) => v.context.layer !== 'assembler');
  it.each(decoders.map((v) => [v.name, v] as const))('%s', (_n, v) => {
    const r = feed(v);
    if (v.events) expectKotlin(r.events, v.events);
    if (v.derived) expectKotlin(r.events, v.derived);
    // ACK before decode: every device SEND is acknowledged, nothing else (writes are asserted wherever the fixture has them).
    const expectedWrites = v.writes ?? (v.context.cmdType === 'SEND' ? undefined : []);
    if (expectedWrites) expect(r.writes).toEqual(expectedWrites);
    if (v.perPacket) {
      v.perPacket.forEach((pp, i) => {
        expect(r.per[i]!.writes).toEqual(pp.writes);
        const count = pp.events[0]?.count;
        expect(r.per[i]!.events.length).toBe(typeof count === 'number' ? count : pp.events.length);
      });
    }
  });

  it('a device SEND is acked once the frame is whole, echoing seq and devType', () => {
    const v = vectors.find((x) => x.name === 'battery')!;
    expect(feed(v).writes).toEqual(['00 01 00 00 04 03 00 00 01 00 01 00 00 00 00 00 00 00 00 00']);
  });
});

describe('LuckRing assembler vectors', () => {
  const asm = vectors.filter((v) => v.context.layer === 'assembler');
  it.each(asm.map((v) => [v.name, v] as const))('%s', (_n, v) => {
    let partial: PartialFrame | null = null;
    packetsOf(v).forEach((p, i) => {
      const r = assemble(partial, fromHex(p));
      partial = r.partial;
      const want = v.frames![i];
      const got = r.frame && { cmdType: cmdName(r.frame.cmdType), dataType: r.frame.dataType, seq: r.frame.seq, devType: r.frame.devType, payload: toHex(Uint8Array.from(r.frame.payload)) };
      expect(got).toEqual(want);
    });
  });

  it('a notification shorter than 20 bytes is ignored and keeps the open frame', () => {
    const head = assemble(null, fromHex('00 01 01 03 01 2f 00 00 19 00 01 02 03 04 05 06 07 08 09 0a'));
    const short = assemble(head.partial, fromHex('01 0b 0c'));
    expect(short.frame).toBeNull();
    expect(short.partial).toEqual(head.partial);
  });

  it('a jumped page drops the open frame', () => {
    const head = assemble(null, fromHex('00 01 02 03 01 2f 00 00 1e 00 01 02 03 04 05 06 07 08 09 0a'));
    expect(assemble(head.partial, fromHex('02 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00'))).toEqual({ partial: null, frame: null });
  });
});

describe('LuckRing decoder mapping', () => {
  const frame = (dataType: number, payload: number[], cmdType = 1): LogicalFrame => ({ cmdType, dataType, payload, seq: 0, devType: 1 });
  const rec = (t: number, ...v: number[]): number[] => [t & 0xff, (t >>> 8) & 0xff, (t >>> 16) & 0xff, (t >>> 24) & 0xff, ...v];
  const env = (...recs: number[][]): number[] => [0, 0, recs.length, ...recs.flat()];

  it('timestamps leave as epoch ms with the contract units and origins', () => {
    expect(decodeFrame(frame(8, env(rec(1_700_000_000, 72))), { firmware: '' })).toEqual([
      { type: 'sample', stream: 'hr', t: 1_700_000_000_000, value: 72, unit: 'bpm', origin: 'history' },
    ]);
    expect(decodeFrame(frame(40, env(rec(1_700_000_000, 97))), { firmware: '' })[0]).toMatchObject({ stream: 'spo2', unit: 'pct' });
    expect(decodeFrame(frame(47, env(rec(1_700_000_000, 0x6d, 0x01, 0, 0))), { firmware: '' })[0]).toMatchObject({ stream: 'skin_temp', unit: 'degC', value: 36.5 });
    expect(decodeFrame(frame(41, env(rec(1_700_000_000, 120, 80))), { firmware: '' })).toEqual([
      { type: 'vendor', key: 'bp_sys', t: 1_700_000_000_000, value: 120, unit: 'mmHg', origin: 'history' },
      { type: 'vendor', key: 'bp_dia', t: 1_700_000_000_000, value: 80, unit: 'mmHg', origin: 'history' },
    ]);
    expect(decodeFrame(frame(53, env(rec(1_700_000_000, 30))), { firmware: '' })[0]).toMatchObject({ type: 'vendor', key: 'stress', unit: 'score', origin: 'history' });
    expect(decodeFrame(frame(17, env(rec(1_700_000_000, 140))), { firmware: '' })[0]).toMatchObject({ stream: 'hr', origin: 'workout_stream' });
  });

  it('an activity record is a 60 s bucket (the Kotlin ignores the duration field) with distance in metres and no kcal', () => {
    const r = [...rec(1_700_000_000), 0xd2, 0x04, 0, 0, 0x88, 0x13, 0, 0, 0x2c, 0x01, 0, 0, 0x58, 0x02, 0, 0];
    expect(decodeFrame(frame(5, env(r)), { firmware: '' })).toEqual([{ type: 'activityBucket', start: 1_700_000_000_000, durS: 60, steps: 1234, distanceM: 5000 }]);
  });

  it('sleep: per-minute stages with raw codes, the ring firmware, complete only when a wake entry closed it', () => {
    const page = (entries: Array<[number, number]>): number[] => {
      const slots = entries.flatMap(([type, t]) => [type, t & 0xff, (t >>> 8) & 0xff, (t >>> 16) & 0xff, (t >>> 24) & 0xff]);
      return [entries.length, ...slots, ...new Array<number>(75 - slots.length).fill(0)];
    };
    const base = 1_700_000_000;
    const woke = decodeFrame(frame(6, [0, 0, 1, ...page([[1, base], [2, base + 120], [4, base + 300]])]), { firmware: '1.2.3.4.5' });
    expect(woke).toEqual([
      { type: 'sleepEpochs', start: base * 1000, epochS: 60, stages: ['light', 'light', 'deep', 'deep', 'deep'], rawCodes: [1, 1, 2, 2, 2], firmware: '1.2.3.4.5', complete: true },
    ]);
    const open = decodeFrame(frame(6, [0, 0, 1, ...page([[1, base], [3, base + 120], [2, base + 240]])]), { firmware: '' });
    expect(open).toMatchObject([{ complete: false, rawCodes: [1, 1, 3, 3] }]);
  });
});
