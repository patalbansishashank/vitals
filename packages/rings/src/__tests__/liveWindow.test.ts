// @vitest-environment node
/**
 * Live heart rate with a timed measurement (R5-01): the J-Style 2301 streams heart rate on 0x09 only while a 0x28
 * heart-rate measurement runs, so the session writes realtime on, then the measurement, and starts the measurement
 * again at the end of each window until the caller stops; stopping reverses both. Synthetic values only.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { jstyle2301 } from '../jstyle2301/family';
import { openRingSession } from '../session';
import { fakeFromSession, type SessionsFixture } from '../testing';
import type { RingEvent, RingFamily } from '../types';
import { sleep, waitUntil } from '../luckring/__tests__/helpers';

const REPO = join(__dirname, '../../../..');
const sessions = JSON.parse(readFileSync(join(REPO, 'qa/fixtures/rings/jstyle2301/sessions.json'), 'utf8')) as SessionsFixture;
/** The handshake only (firmware, battery); later writes are recorded, not answered. */
const handshake = () => {
  const s = sessions.sessions.find((x) => x.name.startsWith('v0525 handshake'))!;
  return { ...s, steps: s.steps.filter((x) => x.expectWrite?.startsWith('27') || x.expectWrite?.startsWith('13')) };
};
const head = (b: Uint8Array): string => Array.from(b.subarray(0, 3), (x) => x.toString(16).padStart(2, '0')).join(' ');
const livePacket = (bpm: number): Uint8Array => {
  const p = new Uint8Array(22);
  p[0] = 0x09;
  p[21] = bpm;
  return p;
};
const shortWindow = (windowMs: number): RingFamily => ({ ...jstyle2301, liveHeartRate: { ...jstyle2301.liveHeartRate!, measure: { ...jstyle2301.liveHeartRate!.measure!, gapMs: 20, windowMs } } });

describe('J-Style live heart rate: a timed measurement inside the realtime stream', () => {
  it('the family runs the manual heart-rate measurement for live heart rate', () => {
    const live = jstyle2301.liveHeartRate!;
    expect(live.start).toEqual({ op: 'realtimeSteps', params: { enable: true } });
    expect(live.measure).toMatchObject({ start: { op: 'hrMeasure', params: { start: true } }, stop: { op: 'hrMeasure', params: { start: false } }, gapMs: 500 });
    expect(live.measure!.windowMs).toBeGreaterThan(0);
  });

  it('writes realtime on, the measurement, starts it again each window, and on stop ends both; samples flow throughout', async () => {
    const fake = fakeFromSession(handshake());
    const session = await openRingSession(shortWindow(150), fake, { timers: { quietMs: 30, stallMs: 80 } });
    const after = fake.writes.length;
    const ac = new AbortController();
    const got: RingEvent[] = [];
    const run = (async () => {
      for await (const ev of session.liveHeartRate(ac.signal)) got.push(ev);
    })();
    const pusher = setInterval(() => fake.notify(livePacket(62)), 10);
    try {
      await waitUntil(() => fake.writes.slice(after).filter((w) => head(w) === '28 02 01').length >= 3, 3_000, 'three measurement windows');
      ac.abort();
      await run;
      const ops = fake.writes.slice(after).map(head);
      expect(ops.slice(0, 6)).toEqual(['09 01 00', '28 02 01', '28 02 00', '09 00 00', '09 01 00', '28 02 01']);
      expect(ops.slice(-2)).toEqual(['28 02 00', '09 00 00']);
      expect(got.some((e) => e.type === 'sample' && e.stream === 'hr' && e.value === 62 && e.origin === 'live')).toBe(true);
      // stopped: nothing starts again
      const n = fake.writes.length;
      await sleep(250);
      expect(fake.writes.length).toBe(n);
      // the lock is free for the next command
      const next = (async () => {
        for await (const _ of session.liveHeartRate(new AbortController().signal)) break;
      })();
      fake.notify(livePacket(63));
      await sleep(60);
      fake.notify(livePacket(63));
      await next;
    } finally {
      clearInterval(pusher);
      await session.close();
    }
  });

  it('a link that drops ends the loop instead of starting again', async () => {
    const fake = fakeFromSession(handshake());
    const session = await openRingSession(shortWindow(80), fake, { timers: { quietMs: 30, stallMs: 80 } });
    const after = fake.writes.length;
    const run = (async () => {
      for await (const _ of session.liveHeartRate(new AbortController().signal)) void _;
    })().catch((e: unknown) => e);
    await waitUntil(() => fake.writes.length > after + 1, 1_000, 'measurement started');
    fake.drop('test');
    await run;
    const n = fake.writes.length;
    await sleep(200);
    expect(fake.writes.length).toBe(n);
    await session.close();
  });
});
