// @vitest-environment node
/**
 * J-Style 2301 family through the library: fixture replay (`qa/fixtures/rings/jstyle2301`) over the fake peripheral and the
 * session runner; scan match; encode vectors; record ids identical across two devices.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ringRecords } from '../../records';
import { openRingSession } from '../../session';
import { fakeFromSession, type FixtureSession, type SessionsFixture } from '../../testing';
import { RingError, fromHex, toHex, type Advertisement, type RingEvent } from '../../types';
import { OP } from '../commands';
import { jstyle2301, matchJ2301 } from '../family';

const REPO = join(__dirname, '../../../../..');
const FIX = join(REPO, 'qa/fixtures/rings/jstyle2301');
const json = <T,>(f: string): T => JSON.parse(readFileSync(join(FIX, f), 'utf8')) as T;
const sessions = json<SessionsFixture>('sessions.json');
const session = (prefix: string): FixtureSession => {
  const s = sessions.sessions.find((x) => x.name.startsWith(prefix));
  if (!s) throw new Error(`no fixture session ${prefix}`);
  return s;
};
const fast = { timers: { quietMs: 30, stallMs: 80 }, clock: { now: () => Date.parse('2026-09-16T10:00:00Z'), tzOffsetS: () => 0 } };
const collect = async (it: AsyncIterable<RingEvent>): Promise<RingEvent[]> => {
  const out: RingEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
};

describe('J-Style 2301 scan match', () => {
  it('claims the service or the 0x1234 marker ending 23 01, never a name', () => {
    const vectors = json<{ vectors: Array<{ advertisement: { name?: string; serviceUuids: string[]; manufacturerData: string[] }; match: boolean }> }>('scan.json').vectors;
    for (const v of vectors) {
      const ad: Advertisement = { name: v.advertisement.name, serviceUuids: v.advertisement.serviceUuids, manufacturerData: v.advertisement.manufacturerData.map(fromHex) };
      expect(matchJ2301(ad), v.advertisement.name).toBe(v.match);
    }
    expect(matchJ2301({ serviceUuids: ['0000fff0-0000-1000-8000-00805f9b34fb'], manufacturerData: [] })).toBe(true);
    expect(matchJ2301({ serviceUuids: ['FFF0'], manufacturerData: [] })).toBe(true);
    expect(matchJ2301({ name: 'Smart Ring', serviceUuids: [], manufacturerData: [fromHex('34 12 44 23 02')] })).toBe(false);
  });
});

describe('J-Style 2301 encode vectors', () => {
  it('frames every Kotlin command byte-exact and redacts the auth frame', () => {
    const { vectors } = json<{ vectors: Array<{ name: string; command: { op: string; params?: Record<string, number | string | boolean> }; frame: string; redacted?: string }> }>('encode.json');
    expect(vectors.length).toBeGreaterThan(20);
    const st = jstyle2301.protocol.initialState();
    for (const v of vectors) {
      const frames = jstyle2301.protocol.frame(v.command, st);
      expect(frames.length, v.name).toBe(1);
      expect(toHex(frames[0]!.bytes), v.name).toBe(v.frame);
      if (v.redacted) expect(toHex(jstyle2301.protocol.redactOutbound(frames[0]!.bytes))).toBe(v.redacted);
    }
  });
});

describe('J-Style 2301 sessions over the fake peripheral', () => {
  it('V0525: battery and firmware, then one heart-rate page with a cursor', async () => {
    const fake = fakeFromSession(session('v0525 handshake'), { address: 'AA:BB:CC:DD:EE:01' });
    fake.script({ expect: { prefix: '54 00' }, reply: ['54 ff'] }); // 'hr' also reads workout heart rate (0x54): an empty archive
    const s = await openRingSession(jstyle2301, fake, fast);
    expect(s.info().firmware).toBe('V0525');
    expect(s.info().battery).toBeTypeOf('number');
    expect(s.identity).toEqual({ family: 'jstyle2301', model: '2301', ringId: 'mac:aa:bb:cc:dd:ee:01', basis: 'mac' });
    const evs = await collect(s.readHistory('hr', {}, new AbortController().signal));
    const hr = evs.filter((e) => e.type === 'sample' && e.stream === 'hr');
    expect(hr.length).toBeGreaterThan(0);
    const cursor = evs.find((e) => e.type === 'status' && e.key === 'cursor');
    expect(cursor && cursor.type === 'status' && String(cursor.value).startsWith('j1|55.')).toBe(true);
    expect(fake.errors).toEqual([]);
    await s.close();
  });

  it('V0789: sends the built-in passcode on its own, the ring accepts, history flows', async () => {
    const fake = fakeFromSession(session('v0789 handshake, auth accepted'));
    fake.script({ expect: { prefix: '54 00' }, reply: ['54 ff'] });
    const s = await openRingSession(jstyle2301, fake, fast);
    expect(s.info().firmware).toBe('V0789');
    const auth = fake.writes.find((w) => w[0] === OP.AUTHENTICATE)!;
    expect(auth.length).toBe(16);
    // The diagnostic copy keeps the opcode and nothing of the credential.
    const red = fake.redactedWrites(jstyle2301.protocol).find((w) => w[0] === OP.AUTHENTICATE)!;
    expect(toHex(red)).toBe('3c 00 00 00 00 00 00 00 00 00 00 00 00 00 00 3c');
    const evs = await collect(s.readHistory('hr', {}, new AbortController().signal));
    expect(evs.some((e) => e.type === 'sample' && e.stream === 'hr')).toBe(true);
    expect(fake.errors).toEqual([]);
    await s.close();
  });

  it('V0789: a refused passcode is an auth_rejected error and nothing else is written', async () => {
    const fake = fakeFromSession(session('v0789 auth rejected'));
    await expect(openRingSession(jstyle2301, fake, fast)).rejects.toMatchObject({ name: 'RingError', code: 'auth_rejected' });
    expect(fake.writes.map((w) => w[0])).toEqual([OP.INFO_FIRMWARE, OP.AUTHENTICATE]);
    expect(fake.connected).toBe(false);
  });

  it('a 50-packet page asks for the mode-2 continuation when the budget allows', async () => {
    const fake = fakeFromSession(session('v0525 page of 50 packets'));
    const s = await openRingSession(jstyle2301, fake, fast);
    const evs: RingEvent[] = [];
    for await (const e of s.runtime.exchange({ op: 'history', params: { opcode: 0x55, stream: 'hr', pageLimit: 2, seq: 1 } })) evs.push(e);
    expect(fake.writes.filter((w) => w[0] === 0x55).map((w) => w[1])).toEqual([0, 2]);
    expect(evs.filter((e) => e.type === 'sample').length).toBeGreaterThan(50);
    expect(fake.errors).toEqual([]);
    await s.close();
  });

  it('one-page budget: the 50th packet closes the stream and the plan moves on', async () => {
    const fake = fakeFromSession(session('v0525 one-page budget'));
    const s = await openRingSession(jstyle2301, fake, fast);
    const seen: string[] = [];
    const evs = await collect(s.sync({}, (p) => seen.push(`${p.stage ?? ''}:${p.fraction.toFixed(2)}`), new AbortController().signal));
    expect(fake.writes.filter((w) => w[0] === 0x55).map((w) => w[1])).toEqual([0]);
    expect(evs.filter((e) => e.type === 'progress').length).toBe(8);
    expect(seen[seen.length - 1]).toMatch(/:1\.00$/);
    await s.close();
  });

  it('spot heart rate: prepare, 500 ms, start, readings, stop both', async () => {
    const fake = fakeFromSession(session('v0525 spot heart rate'));
    const s = await openRingSession(jstyle2301, fake, fast);
    const ac = new AbortController();
    const got: RingEvent[] = [];
    for await (const e of s.spot('hr', ac.signal)) {
      got.push(e);
      if (got.filter((x) => x.type === 'sample').length >= 2) ac.abort();
    }
    expect(got.some((e) => e.type === 'sample' && e.stream === 'hr' && e.origin === 'spot')).toBe(true);
    expect(fake.writes.slice(2).map((w) => toHex(w.subarray(0, 3)))).toEqual(['09 01 00', '28 02 01', '28 02 00', '09 00 00']);
    expect(fake.remaining).toBe(0);
    expect(fake.errors).toEqual([]);
    await s.close();
  }, 10_000);

  it('a dropped link surfaces as a disconnected error', async () => {
    const fake = fakeFromSession(session('v0525 handshake'));
    const s = await openRingSession(jstyle2301, fake, fast);
    const seen: string[] = [];
    s.on((e) => seen.push(e.type));
    fake.drop('out of range');
    await expect(s.battery()).rejects.toMatchObject({ code: 'disconnected' });
    expect(seen).toContain('disconnected');
    expect(() => {
      throw new RingError('x', 'busy');
    }).toThrow(RingError);
  });
});

describe('records from two devices', () => {
  it('the same page read by a phone and a PC gives the same record ids', async () => {
    const read = async (id: string, address: string | undefined): Promise<ReturnType<typeof ringRecords>> => {
      const fake = fakeFromSession(session('v0525 handshake'), { id, address, reads: { '0000180a-0000-1000-8000-00805f9b34fb/00002a25-0000-1000-8000-00805f9b34fb': '53 4e 30 30 37' } });
      fake.script({ expect: { prefix: '54 00' }, reply: ['54 ff'] });
      const s = await openRingSession(jstyle2301, fake, fast);
      const evs = await collect(s.readHistory('hr', {}, new AbortController().signal));
      await s.close();
      return ringRecords(evs, {
        identity: s.identity, family: jstyle2301, firmware: s.info().firmware, tz: 'Asia/Kolkata', tzOffsetS: 19_800,
        receivedS: 1_789_552_800, ingestedAt: '2026-09-16T10:00:00.000Z', producer: { name: 'test', version: '0' },
      });
    };
    const phone = await read('phone-device-id', 'AA:BB:CC:DD:EE:01');
    const pc = await read('chromium-opaque-id', undefined);
    expect(phone.records.length).toBeGreaterThan(0);
    expect(phone.records.map((r) => r.record_id)).toEqual(pc.records.map((r) => r.record_id));
    expect(phone.records[0]!.provenance.channel).toBe('ble:jstyle2301/2301/serial:SN007');
  });
});
