// @vitest-environment node
/** RWfit encode vectors (`encode.json`) byte-exact through `protocol.frame`, plus the checksum vectors. */
import { describe, expect, it } from 'vitest';
import { fromHex, toHex, type RingCommand } from '../../types';
import { crc16Arc, legacyFrame, nextSerial, xorChecksum, type Framing } from '../codec';
import { frameRWfit, initialRWfitState, rwfitProtocol, type RWfitState } from '../protocol';
import { fixture } from './helpers';

interface Vector {
  name: string;
  framing: Framing;
  command: { op: string; params?: Record<string, string | number | boolean> };
  frame?: string;
  frames?: string[];
}
const enc = fixture<{
  vectors: Vector[];
  checksums: { xor: Array<{ bytes: string; value: string }>; crc16arc: Array<{ bytes?: string; ascii?: string; value: string }> };
}>('encode.json');

const stateFor = (framing: Framing): RWfitState => ({ ...initialRWfitState(), framing });
const STARTUP_CLOCK = { nowMs: 1_723_000_000_000, tzOffsetS: 0 };

/** The connect burst as the session drives it: handshake ops, then the first sync command, each through `begin`. */
function startup(framing: Framing): string[] {
  const p = rwfitProtocol;
  let st = p.begin!({ op: 'selectFraming', params: { framing } }, p.initialState()).state;
  const out: string[] = [];
  const cmds: RingCommand[] = [{ op: 'deviceInfo' }, { op: 'timeSync' }, { op: 'battery' }, p.planSync({}, st)[0]!];
  for (const c of cmds) {
    const cmd = { ...c, params: { ...STARTUP_CLOCK, ...c.params } };
    st = p.begin!(cmd, st).state;
    out.push(...p.frame(cmd, st).map((f) => toHex(f.bytes)));
  }
  return out;
}

describe('rwfit encode vectors', () => {
  for (const v of enc.vectors) {
    it(v.name, () => {
      const { op, params = {} } = v.command;
      if (op === 'startup') return expect(startup(v.framing)).toEqual(v.frames);
      if (op === 'raw' && typeof params.repeat === 'number') {
        // Codec level: a fresh counter starts at 1 and steps once per frame.
        const out: string[] = [];
        let serial = 0;
        for (let i = 0; i < params.repeat; i++) out.push(toHex(legacyFrame(Number(params.cmd), fromHex(String(params.payload)), (serial = nextSerial(serial)))));
        return expect(out).toEqual(v.frames);
      }
      const frames = frameRWfit({ op, params }, stateFor(v.framing)).map((f) => toHex(f.bytes));
      expect(frames).toEqual(v.frames ?? [v.frame]);
    });
  }

  it('serials wrap from 65535 to 1', () => {
    expect(nextSerial(65_535)).toBe(1);
    expect(toHex(legacyFrame(0x00, new Uint8Array(0), nextSerial(65_535)))).toBe('7e 01 00 00 00 00 01 00');
  });

  it('legacy has no realtime measure and JL no unbind', () => {
    expect(() => frameRWfit({ op: 'realtimeMeasure', params: { kind: 'heart_rate', enable: true } }, stateFor('legacy'))).toThrow(RangeError);
    expect(frameRWfit({ op: 'unbind' }, stateFor('jl'))).toEqual([]);
  });

  it('an unclaimed legacy stream writes nothing and takes no serial', () => {
    const st = { ...stateFor('legacy'), claimed: ['heart_rate' as const], serial: 4 };
    const p = rwfitProtocol;
    const skip = p.begin!({ op: 'history', params: { type: 'steps', ifClaimed: true } }, st);
    expect(skip.expectReply).toBe(false);
    expect((skip.state as RWfitState).serial).toBe(4);
    expect(p.frame({ op: 'history', params: { type: 'steps', ifClaimed: true } }, skip.state)).toEqual([]);
    const take = p.begin!({ op: 'history', params: { type: 'heart_rate', ifClaimed: true } }, st);
    expect(take.expectReply).toBe(true);
    expect(p.frame({ op: 'history', params: { type: 'heart_rate', ifClaimed: true } }, take.state).map((f) => toHex(f.bytes))).toEqual(['7e 01 a3 00 00 00 05 00']);
  });
});

describe('rwfit checksums', () => {
  for (const c of enc.checksums.xor) it(`xor ${c.bytes}`, () => expect(xorChecksum(fromHex(c.bytes))).toBe(Number(c.value)));
  for (const c of enc.checksums.crc16arc) {
    it(`crc16/arc ${c.ascii ?? (c.bytes || '(empty)')}`, () => {
      const bytes = c.ascii !== undefined ? new TextEncoder().encode(c.ascii) : fromHex(c.bytes ?? '');
      expect(crc16Arc(bytes)).toBe(Number(c.value));
    });
  }
});
