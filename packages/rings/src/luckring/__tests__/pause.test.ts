// @vitest-environment node
/**
 * A history read must survive a pause longer than its settle timer while a multi-packet frame is still open (the
 * J-Style ring paused mid-page on real hardware and lost data), and a frame that never completes must end the read as
 * partial with no cursor, never silently.
 */
import { describe, expect, it } from 'vitest';
import { openRingSession } from '../../session';
import type { RingEvent } from '../../types';
import { luckring } from '../family';
import { SETTLE_MS, SILENCE_MAX_MS } from '../protocol';
import { RecordingFake, fixedClock, sleep, waitUntil } from './helpers';

const QUIET = 30;
const fast = { timers: { quietMs: QUIET, stallMs: 80 }, clock: fixedClock() };
// Heart-rate history (8) in two packets: head (2 records announced) and its continuation.
const HEAD = '00 01 01 03 01 08 00 00 0d 00 02 00 02 00 f1 53 65 48 3c f1';
const CONT = '01 53 65 4b 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00';
const ACK = '00 01 00 03 04 08 00 00 01 00 01 00 00 00 00 00 00 00 00 00';
const samples = (evs: RingEvent[]): number => evs.filter((e) => e.type === 'sample' && e.stream === 'hr').length;
const errors = (evs: RingEvent[]): string[] => evs.flatMap((e) => (e.type === 'status' && e.key === 'error' ? [String(e.value)] : []));
const cursor = (evs: RingEvent[]): boolean => evs.some((e) => e.type === 'status' && e.key === 'cursor');

async function hrRead() {
  const fake = new RecordingFake([], { name: 'TK18' });
  const s = await openRingSession(luckring, fake, fast);
  const base = fake.writes.length;
  const evs: RingEvent[] = [];
  const read = (async () => {
    for await (const e of s.runtime.exchange({ op: 'history', params: { dataType: 8, stream: 'hr', stage: 'hr' } })) evs.push(e);
  })();
  await waitUntil(() => fake.writes.length > base);
  fake.notify(HEAD);
  return { fake, s, evs, read, base };
}

describe('LuckRing history read across a pause', () => {
  it('keeps waiting through a pause longer than the settle timer while a frame is open', async () => {
    const { fake, s, evs, read, base } = await hrRead();
    await sleep(QUIET * 3); // three settle periods pass with the continuation still owed
    fake.notify(CONT);
    await read;
    expect(samples(evs)).toBe(2);
    expect(errors(evs)).toEqual([]);
    expect(cursor(evs)).toBe(true);
    expect(fake.writes.slice(base + 1).map((w) => Array.from(w, (x) => x.toString(16).padStart(2, '0')).join(' '))).toEqual([ACK]);
    await s.close();
  });

  it('a frame that never completes ends the read as partial: error reported, no cursor, no ACK', async () => {
    const t0 = Date.now();
    const { fake, s, evs, read, base } = await hrRead();
    await read;
    const periods = Math.ceil(SILENCE_MAX_MS / SETTLE_MS);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(QUIET * (periods - 1));
    expect(samples(evs)).toBe(0);
    expect(errors(evs)).toEqual(['partial:hr']);
    expect(cursor(evs)).toBe(false);
    expect(fake.writes.length).toBe(base + 1);
    expect(s.runtime.state.partial).toBeNull();
    await s.close();
  });

  it('a whole frame then silence ends on the timers with a cursor (the Kotlin settle)', async () => {
    const { fake, s, evs, read } = await hrRead();
    fake.notify(CONT);
    await read;
    expect(samples(evs)).toBe(2);
    expect(errors(evs)).toEqual([]);
    expect(cursor(evs)).toBe(true);
    await s.close();
  });
});
