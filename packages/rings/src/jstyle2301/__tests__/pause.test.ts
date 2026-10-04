// @vitest-environment node
/**
 * The real ring pauses for more than the 1.2 s settle in the middle of a 50-packet history page (desktop runs 2026-10-04:
 * 3 of 6 reads lost the rest of the page). A read must survive such a pause, and a read that really stops short must be
 * reported as partial with its cursor left where it was, never dropped silently.
 */
import { describe, expect, it } from 'vitest';
import { openRingSession } from '../../session';
import { FakePeripheral } from '../../testing';
import { toHex, type RingEvent } from '../../types';
import { jstyle2301 } from '../family';
import { SETTLE_MS, SILENCE_MAX_MS, decodeCursor } from '../protocol';

const bcd = (v: number): number => (Math.floor(v / 10) << 4) | v % 10;
/** One 0x55 heart-rate record: `55 00 00 YY MM DD hh mm ss bpm` (2026-09-14 12:34:ss). */
const hr = (i: number, bpm = 60 + (i % 20)): string => toHex(Uint8Array.of(0x55, 0, 0, bcd(26), bcd(9), bcd(14), bcd(12), bcd(Math.floor(i / 60)), bcd(i % 60), bpm));
const QUIET = 30;
const fast = { timers: { quietMs: QUIET, stallMs: 200 }, clock: { now: () => Date.parse('2026-09-16T10:00:00Z'), tzOffsetS: () => 0 } };
const handshake = [
  { expect: { prefix: '27' }, reply: ['27 00 05 02 05 00 00 00 00 00 00 00 00 00 00 33'] },
  { expect: { prefix: '13' }, reply: ['13 50 00 00 00 00 00 00 00 00 00 00 00 00 00 63'] },
];
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const samples = (evs: RingEvent[]): number => evs.filter((e) => e.type === 'sample' && e.stream === 'hr').length;
const cursorOf = (evs: RingEvent[]): string => {
  const c = evs.find((e) => e.type === 'status' && e.key === 'cursor');
  return c && c.type === 'status' ? String(c.value) : '';
};

describe('J-Style history read across a mid-page pause', () => {
  it('keeps waiting through a pause longer than the settle and gets the whole page', async () => {
    const first = Array.from({ length: 20 }, (_, i) => hr(i));
    const rest = [...Array.from({ length: 29 }, (_, i) => hr(20 + i)), '55 ff'];
    const fake = new FakePeripheral([...handshake, { expect: { prefix: '55 00' }, reply: first }]);
    const s = await openRingSession(jstyle2301, fake, fast);
    const evs: RingEvent[] = [];
    const read = (async () => {
      for await (const e of s.runtime.exchange({ op: 'history', params: { opcode: 0x55, stream: 'hr', seq: 3, pageLimit: 2 } })) evs.push(e);
    })();
    await sleep(QUIET * 4); // the ring falls silent for several settle periods, then goes on
    for (const p of rest) fake.notify(p);
    await read;
    expect(samples(evs)).toBe(49);
    expect(evs.some((e) => e.type === 'status' && e.key === 'error')).toBe(false);
    expect(decodeCursor(cursorOf(evs))[0x55]).toMatchObject({ seq: 3, flag: 'end' });
    await s.close();
  });

  it('a page that stays short ends as a partial read: error reported, cursor round not advanced', async () => {
    const fake = new FakePeripheral([...handshake, { expect: { prefix: '55 00' }, reply: Array.from({ length: 7 }, (_, i) => hr(i)) }]);
    const s = await openRingSession(jstyle2301, fake, fast);
    const prev = 'j1|55.2.1757800000.more';
    const evs: RingEvent[] = [];
    const t0 = Date.now();
    for await (const e of s.runtime.exchange({ op: 'history', params: { opcode: 0x55, stream: 'hr', seq: 3, pageLimit: 1, prev } })) evs.push(e);
    const waits = Math.ceil(SILENCE_MAX_MS / SETTLE_MS);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(QUIET * (waits - 1));
    expect(samples(evs)).toBe(7);
    const err = evs.find((e) => e.type === 'status' && e.key === 'error');
    expect(err && err.type === 'status' ? String(err.value) : '').toBe('partial:hr:7/50');
    // The refresh round stays at 2, so the planner reads heart rate first next time; the newest time seen is kept.
    expect(decodeCursor(cursorOf(evs))[0x55]).toMatchObject({ seq: 2, flag: 'more' });
    await s.close();
  });

  it('a full page followed by silence still ends on the settle, as before', async () => {
    const page = Array.from({ length: 50 }, (_, i) => hr(i));
    const fake = new FakePeripheral([...handshake, { expect: { prefix: '55 00' }, reply: page }, { expect: { prefix: '55 02' }, reply: [] }]);
    const s = await openRingSession(jstyle2301, fake, fast);
    const evs: RingEvent[] = [];
    for await (const e of s.runtime.exchange({ op: 'history', params: { opcode: 0x55, stream: 'hr', seq: 1, pageLimit: 2 } })) evs.push(e);
    expect(samples(evs)).toBe(50);
    // The continuation page got nothing: that is a stall on an empty page, reported, and the cursor keeps what was read.
    expect(evs.some((e) => e.type === 'status' && e.key === 'error' && String(e.value).startsWith('stall:'))).toBe(true);
    expect(decodeCursor(cursorOf(evs))[0x55]).toMatchObject({ seq: 1, flag: 'more' });
    await s.close();
  });
});
