// @vitest-environment node
/**
 * A history read must survive a pause longer than its quiet timer while the ring still owes packets (the J-Style ring
 * paused mid-page on real hardware and lost data), and a read that really stops short must end as partial with no
 * cursor, never silently.
 */
import { describe, expect, it } from 'vitest';
import { openRingSession } from '../../session';
import type { RingEvent } from '../../types';
import { COLMI_UUIDS } from '../commands';
import { colmi } from '../family';
import { SILENCE_MAX_MS, WATCHDOG_MS } from '../protocol';
import { ColmiFake, fixedClock, handshakeSteps, toFake } from './helpers';

const QUIET = 50;
const fast = { timers: { quietMs: QUIET, stallMs: 400 }, clock: fixedClock({ nowMs: 1784282400000, tzOffsetS: 7200 }) };
const HR_DAY0 = '15 80 70 59 6a 00 00 00 00 00 00 00 00 00 00 c8';
const P0 = (count: number): string => `15 00 ${count.toString(16).padStart(2, '0')} 05 00 00 00 00 00 00 00 00 00 00 00 ${(0x1a + count).toString(16).padStart(2, '0')}`;
const P1 = '15 01 80 70 59 6a 46 47 00 00 00 00 00 00 00 56';
const P2 = '15 02 48 49 4a 00 00 00 00 00 00 00 00 00 00 f2';
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const samples = (evs: RingEvent[]): number => evs.filter((e) => e.type === 'sample' && e.stream === 'hr').length;
const errors = (evs: RingEvent[]): string[] => evs.flatMap((e) => (e.type === 'status' && e.key === 'error' ? [String(e.value)] : []));
const cursor = (evs: RingEvent[]): boolean => evs.some((e) => e.type === 'status' && e.key === 'cursor');

async function hrDay(reply: string[]) {
  const fake = new ColmiFake([...handshakeSteps('handshake-cold-battery').map(toFake), { expect: HR_DAY0, reply }], { name: 'R02_1A2B' });
  const s = await openRingSession(colmi, fake, fast);
  const evs: RingEvent[] = [];
  const read = (async () => {
    for await (const e of s.runtime.exchange({ op: 'history', params: { stage: 'hr', stream: 'hr', lastDay: 0 } })) evs.push(e);
  })();
  return { fake, s, evs, read };
}

describe('Colmi history read across a pause', () => {
  it('keeps waiting through a pause longer than the quiet timer while the day owes packets', async () => {
    const { fake, s, evs, read } = await hrDay([P0(3), P1]);
    await sleep(QUIET * 1.5); // one quiet period passes with packet 2 still owed
    fake.notify(P2, COLMI_UUIDS.notify);
    await read;
    expect(samples(evs)).toBe(5);
    expect(errors(evs)).toEqual([]);
    expect(cursor(evs)).toBe(true);
    await s.close();
  });

  it('a day that stays short ends as partial: error reported, no cursor', async () => {
    const t0 = Date.now();
    const { s, evs, read } = await hrDay([P0(3), P1]);
    await read;
    const periods = Math.ceil(SILENCE_MAX_MS / WATCHDOG_MS);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(QUIET * (periods - 1));
    expect(samples(evs)).toBe(2);
    expect(errors(evs)).toEqual(['partial:hr']);
    expect(cursor(evs)).toBe(false);
    await s.close();
  });

  it('a day whose announced packets are all in ends on the quiet timer (HR count 2, which the Kotlin never ends)', async () => {
    const { s, evs, read } = await hrDay([P0(2), P1]);
    await read;
    expect(samples(evs)).toBe(2);
    expect(errors(evs)).toEqual([]);
    expect(cursor(evs)).toBe(true);
    await s.close();
  });

  it('a big-data transfer survives a pause between chunks', async () => {
    const fake = new ColmiFake(
      [...handshakeSteps('handshake-cold-battery').map(toFake), { expect: 'bc 27 02 00 81 80 ff 01', reply: ['bc 27 0b 00 00 00 01 00 08'], channel: COLMI_UUIDS.bigData }],
      { name: 'R02_1A2B' },
    );
    const s = await openRingSession(colmi, fake, fast);
    const evs: RingEvent[] = [];
    const read = (async () => {
      for await (const e of s.runtime.exchange({ op: 'history', params: { stage: 'sleep', stream: 'sleep_stage' } })) evs.push(e);
    })();
    await sleep(QUIET * 1.5);
    fake.notify('e0 01 1c 02 03 1e 04 1e', COLMI_UUIDS.bigData);
    await read;
    expect(evs.find((e) => e.type === 'sleepEpochs')).toMatchObject({ stages: expect.arrayContaining(['deep', 'rem']) });
    expect(errors(evs)).toEqual([]);
    expect(cursor(evs)).toBe(true);
    await s.close();
  });
});
