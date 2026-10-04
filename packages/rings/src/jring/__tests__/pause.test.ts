// @vitest-environment node
/**
 * The J-Style lesson applied to Jring: a history read must survive a pause longer than the quiet window while packets are
 * still due, and a read that really stops short ends as `partial:<stream>` with its cursor left where it was. The bound is
 * Kotlin's 12 s stall (`HISTORY_STALL_MS`), counted in `QUIET_MS` steps.
 */
import { describe, expect, it } from 'vitest';
import { openRingSession } from '../../session';
import { FakePeripheral, type FakeStep } from '../../testing';
import { toHex, type RingEvent } from '../../types';
import { createJringFamily } from '../family';
import { HISTORY_STALL_MS, QUIET_MS } from '../protocol';

const family = createJringFamily({ appId: null });
const QUIET = 30;
const NOW_MS = 1_700_000_000_000; // 2023-11-14T22:13:20Z, UTC
const fast = { timers: { quietMs: QUIET, stallMs: 200 }, clock: { now: () => NOW_MS, tzOffsetS: () => 0 } };
const HANDSHAKE: FakeStep[] = ['0c', '01', '21', '02', '19', '20'].map((p) => ({ expect: { prefix: p } }));
const le32 = (v: number): number[] => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
const packet = (...b: number[]): string => toHex(Uint8Array.from({ length: 20 }, (_, i) => b[i] ?? 0));
/** One 0x16 a0 block: two readings (70 and 72 bpm) at `tS` and `tS` + 60. */
const hrBlock = (tS: number): string => packet(0x16, 0xa0, ...le32(tS), 0, 0, 70, 70, 70, 70, 70, 70, 72, 72, 72, 72, 72, 72);
const hrEnd = packet(0x16, 0xff);
const activity = (tS: number): string => packet(0x10, ...le32(tS), 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const errors = (evs: RingEvent[]): string[] => evs.flatMap((e) => (e.type === 'status' && e.key === 'error' ? [String(e.value)] : []));
const cursors = (evs: RingEvent[]): RingEvent[] => evs.filter((e) => e.type === 'status' && e.key === 'cursor');
const hrSamples = (evs: RingEvent[]): number => evs.filter((e) => e.type === 'sample' && e.stream === 'hr').length;

describe('Jring history read across a pause', () => {
  it('0x16 keeps waiting through a pause longer than the quiet window and gets everything to 16 ff', async () => {
    const t0 = NOW_MS / 1000 - 3_600;
    const fake = new FakePeripheral([...HANDSHAKE, { expect: { prefix: '16 00' }, reply: [hrBlock(t0), hrBlock(t0 + 120)] }]);
    const ring = await openRingSession(family, fake, fast);
    const evs: RingEvent[] = [];
    const read = (async () => {
      for await (const e of ring.runtime.exchange({ op: 'historyMeasurementQuery', params: { stream: 'hr' } })) evs.push(e);
    })();
    await sleep(QUIET * 2.5); // silent for two quiet windows, less than the 12 s bound
    fake.notify(hrBlock(t0 + 240));
    fake.notify(hrEnd);
    await read;
    expect(hrSamples(evs)).toBe(6);
    expect(errors(evs)).toEqual([]);
    expect(cursors(evs)).toEqual([{ type: 'status', key: 'cursor', value: `jr1:${t0 + 300}`, stream: 'hr' }]);
    await ring.close();
  });

  it('0x16 that never sends 16 ff ends as partial after the 12 s bound; no cursor moves', async () => {
    const t0 = NOW_MS / 1000 - 3_600;
    const fake = new FakePeripheral([...HANDSHAKE, { expect: { prefix: '16 00' }, reply: [hrBlock(t0)] }]);
    const ring = await openRingSession(family, fake, fast);
    const evs: RingEvent[] = [];
    const started = Date.now();
    for await (const e of ring.runtime.exchange({ op: 'historyMeasurementQuery', params: { stream: 'hr', prevHr: 'jr1:1699990000' } })) evs.push(e);
    expect(Date.now() - started).toBeGreaterThanOrEqual(QUIET * (Math.ceil(HISTORY_STALL_MS / QUIET_MS) - 1));
    expect(hrSamples(evs)).toBe(2);
    expect(errors(evs)).toEqual(['partial:hr:1']);
    expect(cursors(evs)).toEqual([]);
    await ring.close();
  });

  it('0x10 that has reached the ring-local now ends on the quiet window, cursors advanced', async () => {
    const slot = Math.floor(NOW_MS / 1000 / 900) * 900; // the running 15-minute slot
    const fake = new FakePeripheral([...HANDSHAKE, { expect: { prefix: '10 03' }, reply: [activity(slot - 900), activity(slot)] }]);
    const ring = await openRingSession(family, fake, fast);
    const evs: RingEvent[] = [];
    const started = Date.now();
    for await (const e of ring.runtime.exchange({ op: 'historyQuery', params: { days: 3, stream: 'sleep_stage' } })) evs.push(e);
    expect(Date.now() - started).toBeLessThan(QUIET * 3);
    expect(evs.filter((e) => e.type === 'activityBucket')).toHaveLength(30);
    expect(errors(evs)).toEqual([]);
    expect(cursors(evs)).toEqual([{ type: 'status', key: 'cursor', value: `jr1:${slot + 14 * 60}`, stream: 'steps' }]);
    await ring.close();
  });

  it('0x10 short of now keeps waiting through a pause, then completes when the rest arrives', async () => {
    const slot = Math.floor(NOW_MS / 1000 / 900) * 900;
    const fake = new FakePeripheral([...HANDSHAKE, { expect: { prefix: '10 03' }, reply: [activity(slot - 1800)] }]);
    const ring = await openRingSession(family, fake, fast);
    const evs: RingEvent[] = [];
    const read = (async () => {
      for await (const e of ring.runtime.exchange({ op: 'historyQuery', params: { days: 3, stream: 'sleep_stage' } })) evs.push(e);
    })();
    await sleep(QUIET * 2.5);
    fake.notify(activity(slot - 900));
    fake.notify(activity(slot));
    await read;
    expect(evs.filter((e) => e.type === 'activityBucket')).toHaveLength(45);
    expect(errors(evs)).toEqual([]);
    await ring.close();
  });
});

describe('Jring ring clock at a non-zero offset (+05:30)', () => {
  // The time sync writes UTC + offset, so every ring time is local wall-clock; 0x10 must come back as UTC like 0x11/0x16, and
  // "caught up" must compare it with the UTC now (all session fixtures used to run at offset 0, which hid a mismatch).
  // 0x14 at the same offsets: verify.test.ts, "JringClock rule".
  const OFF = 19_800;
  const ist = { ...fast, clock: { now: () => NOW_MS, tzOffsetS: () => OFF } };
  const slot = Math.floor(NOW_MS / 1000 / 900) * 900;

  it('0x10 buckets have the offset taken off, and a read at the true now ends on the quiet window', async () => {
    const fake = new FakePeripheral([...HANDSHAKE, { expect: { prefix: '10 03' }, reply: [activity(slot - 900 + OFF), activity(slot + OFF)] }]);
    const ring = await openRingSession(family, fake, ist);
    const evs: RingEvent[] = [];
    const started = Date.now();
    for await (const e of ring.runtime.exchange({ op: 'historyQuery', params: { days: 3, stream: 'sleep_stage' } })) evs.push(e);
    expect(Date.now() - started).toBeLessThan(QUIET * 3);
    const starts = evs.flatMap((e) => (e.type === 'activityBucket' ? [e.start] : []));
    expect(starts[0]).toBe((slot - 900) * 1000);
    expect(starts.at(-1)).toBe((slot + 14 * 60) * 1000);
    expect(errors(evs)).toEqual([]);
    expect(cursors(evs)).toEqual([{ type: 'status', key: 'cursor', value: `jr1:${slot + 14 * 60}`, stream: 'steps' }]);
    await ring.close();
  });

  it('0x10 stamped with the UTC now (5 h 30 min behind in ring time) is not caught up: partial, no cursor', async () => {
    const fake = new FakePeripheral([...HANDSHAKE, { expect: { prefix: '10 03' }, reply: [activity(slot)] }]);
    const ring = await openRingSession(family, fake, ist);
    const evs: RingEvent[] = [];
    for await (const e of ring.runtime.exchange({ op: 'historyQuery', params: { days: 3, stream: 'sleep_stage' } })) evs.push(e);
    expect(evs.flatMap((e) => (e.type === 'activityBucket' ? [e.start] : []))[0]).toBe((slot - OFF) * 1000);
    expect(errors(evs)).toEqual(['partial:sleep_stage:1', 'partial:steps:1']);
    expect(cursors(evs)).toEqual([]);
    await ring.close();
  });

});

describe('Jring history read and packets that are not part of it', () => {
  const battery = packet(0x0b, 85, 0);

  it('a stray push right after the write does not end a read that has not started answering (quiet = stall time)', async () => {
    const slot = Math.floor(NOW_MS / 1000 / 900) * 900;
    const fake = new FakePeripheral([...HANDSHAKE, { expect: { prefix: '10 03' }, reply: [battery] }]);
    const ring = await openRingSession(family, fake, fast);
    const evs: RingEvent[] = [];
    const read = (async () => {
      for await (const e of ring.runtime.exchange({ op: 'historyQuery', params: { days: 3, stream: 'sleep_stage' } })) evs.push(e);
    })();
    await sleep(QUIET * 2.5); // two quiet windows with no packet of the read
    fake.notify(activity(slot - 900));
    fake.notify(activity(slot));
    await read;
    expect(evs.filter((e) => e.type === 'activityBucket')).toHaveLength(30);
    expect(errors(evs)).toEqual([]);
    expect(cursors(evs)).toEqual([{ type: 'status', key: 'cursor', value: `jr1:${slot + 14 * 60}`, stream: 'steps' }]);
    await ring.close();
  });

  it('a stray push and then nothing ends silently only after the 12 s bound', async () => {
    const fake = new FakePeripheral([...HANDSHAKE, { expect: { prefix: '16 00' }, reply: [battery] }]);
    const ring = await openRingSession(family, fake, fast);
    const evs: RingEvent[] = [];
    const started = Date.now();
    for await (const e of ring.runtime.exchange({ op: 'historyMeasurementQuery', params: { stream: 'hr' } })) evs.push(e);
    expect(Date.now() - started).toBeGreaterThanOrEqual(QUIET * (Math.ceil(HISTORY_STALL_MS / QUIET_MS) - 1));
    expect(errors(evs)).toEqual([]);
    expect(cursors(evs)).toEqual([]);
    await ring.close();
  });

  it('0x27, 0x28 and 0x24 during a history read are decoded but do not end it (no false no_reading)', async () => {
    const t0 = NOW_MS / 1000 - 3_600;
    const combined = packet(0x24, 72, 0, 0, 98); // a spot-shaped result: HR 72 and SpO2 98
    const fake = new FakePeripheral([...HANDSHAKE, { expect: { prefix: '16 00' }, reply: [hrBlock(t0), packet(0x27), packet(0x28), combined, hrBlock(t0 + 120), hrEnd] }]);
    const ring = await openRingSession(family, fake, fast);
    const evs: RingEvent[] = [];
    for await (const e of ring.runtime.exchange({ op: 'historyMeasurementQuery', params: { stream: 'hr' } })) evs.push(e);
    expect(evs.filter((e) => e.type === 'sample' && e.stream === 'hr' && e.origin === 'history')).toHaveLength(4);
    expect(errors(evs)).toEqual([]);
    expect(cursors(evs)).toEqual([{ type: 'status', key: 'cursor', value: `jr1:${t0 + 180}`, stream: 'hr' }]);
    await ring.close();
  });
});
