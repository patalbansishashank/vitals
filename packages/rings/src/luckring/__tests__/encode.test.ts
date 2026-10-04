// @vitest-environment node
/**
 * Encode vectors from `qa/fixtures/rings/luckring/encode.json`, byte-exact through `protocol.frame`, plus the seq
 * bookkeeping `begin` does (one rolling encoder seq, a separate pager seq, ACKs echo the ring's seq).
 */
import { describe, expect, it } from 'vitest';
import { toHex, type RingCommand } from '../../types';
import { continuationPages, mixInfoDecode, startupBundleBytes, DEFAULT_PROFILE } from '../commands';
import { createLuckRingProtocol, initialLuckRingState, type LuckRingState } from '../protocol';
import { fixture } from './helpers';

interface EncodeVector {
  name: string;
  command: RingCommand;
  seq: number;
  payload: string;
  packets: string[];
}
const { vectors } = fixture<{ vectors: EncodeVector[] }>('encode.json');
const protocol = createLuckRingProtocol();
const hex = (cmd: RingCommand, st: LuckRingState): string[] => protocol.frame(cmd, st).map((f) => toHex(f.bytes));

describe('LuckRing encode vectors', () => {
  it.each(vectors.map((v) => [v.name, v] as const))('%s', (_n, v) => {
    const st: LuckRingState = { ...initialLuckRingState(), seq: v.seq };
    const out = hex(v.command, st);
    expect(out).toEqual(v.packets);
    expect(out.every((p) => p.split(' ').length === 20)).toBe(true);
  });

  it('every frame is head + ceil((len - 10) / 19) continuations', () => {
    expect([0, 10, 11, 25, 29, 30, 67, 79].map(continuationPages)).toEqual([0, 0, 1, 1, 1, 2, 3, 4]);
  });

  it('the connect bundle walks back as the seven properties in vendor order', () => {
    const b = startupBundleBytes(DEFAULT_PROFILE, 10_000, 1_700_000_000_000, 0);
    expect(b.length).toBe(67);
    expect(b[0]! | (b[1]! << 8)).toBe(65);
    expect(mixInfoDecode(b).map((p) => p.type)).toEqual([102, 104, 124, 103, 109, 111, 120]);
  });
});

describe('LuckRing sequence numbers', () => {
  const run = (st: LuckRingState, cmd: RingCommand, nowMs: number): { st: LuckRingState; out: string[] } => {
    const c = { ...cmd, params: { nowMs, tzOffsetS: 0, ...cmd.params } };
    const plan = protocol.begin!(c, st);
    const next = plan.state as LuckRingState;
    return { st: next, out: hex(c, next) };
  };

  it('begin takes the next encoder seq per frame (the Kotlin toggle test order, 0..5)', () => {
    const toggles = vectors.filter((v) => v.name.startsWith('real time toggle layouts'));
    let st = initialLuckRingState();
    toggles.forEach((v, i) => {
      const r = run(st, v.command, 1_000 + i);
      expect(r.out).toEqual(v.packets);
      st = r.st;
    });
    expect(st.seq).toBe(6);
  });

  it('the pager keeps its own seq from 0, the encoder seq is untouched', () => {
    let st: LuckRingState = { ...initialLuckRingState(), seq: 5 };
    const a = run(st, { op: 'history', params: { dataType: 5, stream: 'steps' } }, 1);
    expect(a.out).toEqual(['00 01 00 00 03 05 00 00 00 00 00 00 00 00 00 00 00 00 00 00']);
    st = a.st;
    const b = run(st, { op: 'history', params: { dataType: 6, stream: 'sleep_stage' } }, 2);
    expect(b.out).toEqual(['00 01 00 01 03 06 00 00 00 00 00 00 00 00 00 00 00 00 00 00']);
    expect(b.st.seq).toBe(5);
    expect(b.st.pagerSeq).toBe(2);
  });

  it('an ACK echoes the ring seq and devType and takes no encoder seq', () => {
    const r = run({ ...initialLuckRingState(), seq: 9 }, { op: 'ack', params: { dataType: 3, seq: 5, devType: 2 } }, 1);
    expect(r.out).toEqual(['00 02 00 05 04 03 00 00 01 00 01 00 00 00 00 00 00 00 00 00']);
    expect(r.st.seq).toBe(9);
    expect(protocol.begin!({ op: 'ack', params: { dataType: 3, seq: 5, devType: 2 } }, initialLuckRingState()).expectReply).toBe(false);
  });

  it('the seq wraps at 256', () => {
    const r = run({ ...initialLuckRingState(), seq: 255 }, { op: 'findDevice' }, 1);
    expect(r.out[0]!.split(' ')[3]).toBe('ff');
    expect(r.st.seq).toBe(0);
  });

  it('settings and toggles are fire and forget; history waits 1500 ms settle / 6000 ms stall', () => {
    const st = initialLuckRingState();
    expect(protocol.begin!({ op: 'startupBundle' }, st).expectReply).toBe(false);
    expect(protocol.begin!({ op: 'realHeartRate', params: { on: true } }, st).expectReply).toBe(false);
    expect(protocol.begin!({ op: 'history', params: { dataType: 8 } }, st)).toMatchObject({ expectReply: true, quietMs: 1500, stallMs: 6000 });
    expect(protocol.begin!({ op: 'battery' }, st)).toMatchObject({ expectReply: true });
  });

  it('redactOutbound is the identity (no credential frame)', () => {
    const b = Uint8Array.from([0, 1, 2]);
    expect(protocol.redactOutbound(b)).toBe(b);
  });
});
