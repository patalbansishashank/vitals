// @vitest-environment node
/**
 * Jring sessions (`qa/fixtures/rings/jring/sessions.json`) replayed over the fake peripheral and the session runner:
 * the connect order, the ring-driven bind, history passes, live and spot runs, keepalive, clock re-push, profile, forget.
 * Every session after the first opens with the same handshake (`HANDSHAKE`) and asserts only the writes after it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openRingSession } from '../../session';
import { FakePeripheral, stepFromFixture, type FakeStep, type FixtureSession, type FixtureStep } from '../../testing';
import { toHex, type RingEvent } from '../../types';
import { jringForget, jringKeepalive, jringResyncTime } from '../commands';
import { JRING_DEFAULT_APP_ID, createJringFamily, jring } from '../family';
import type { JringState } from '../protocol';

const FIX = join(__dirname, '../../../../..', 'qa/fixtures/rings/jring');
type Step = FixtureStep & { notifyUnsolicited?: string[]; expectEvents?: Array<Record<string, unknown>>; readReply?: string; expectRead?: string; do?: unknown };
type Session = Omit<FixtureSession, 'steps'> & { context: { nowMs: number; tzOffsetS: number }; expectHandshake?: Record<string, unknown>; steps: Step[] };
const sessions = (JSON.parse(readFileSync(join(FIX, 'sessions.json'), 'utf8')) as { sessions: Session[] }).sessions;
const session = (prefix: string): Session => {
  const s = sessions.find((x) => x.name.startsWith(prefix));
  if (!s) throw new Error(`no fixture session ${prefix}`);
  return s;
};

/** The fixtures leave out 0x48 (no app id configured); this family does the same. */
const noAppId = createJringFamily({ appId: null });
const BATTERY_READ = { '0000180f-0000-1000-8000-00805f9b34fb/00002a19-0000-1000-8000-00805f9b34fb': '55' };
const HANDSHAKE: FakeStep[] = [
  { expect: { prefix: '0c' }, reply: ['0c 8a 00 11 22 33 44 55 66 3a 00 2a 00 00 00 00 00 00 00 00'] },
  { expect: { prefix: '01' } },
  { expect: { prefix: '21 65 6e 2d 55 53' } },
  { expect: { prefix: '02 99 b8 5a' } },
  { expect: { prefix: '19 00 00 17 3b 01 1e 01' } },
  { expect: { prefix: '20' } },
];
const writesOf = (s: Session): string[] => s.steps.filter((x) => x.expectWrite !== undefined).map((x) => x.expectWrite!);
const fixtureSteps = (s: Pick<Session, 'steps'>): FakeStep[] => s.steps.map((x) => stepFromFixture(x, 20)).filter((x): x is FakeStep => x !== undefined);
const clockOf = (s: Session): { now: () => number; tzOffsetS: () => number } => ({ now: () => s.context.nowMs, tzOffsetS: () => s.context.tzOffsetS });
const timers = { quietMs: 30, stallMs: 80 };
const after = (fake: FakePeripheral, n = HANDSHAKE.length): string[] => fake.writes.slice(n).map(toHex);
const strip = (e: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(e).filter(([k]) => !['note', 'proposed', 'tolerance'].includes(k)));
const collect = async (it: AsyncIterable<RingEvent>, stop?: (seen: RingEvent[]) => boolean, ac?: AbortController): Promise<RingEvent[]> => {
  const out: RingEvent[] = [];
  for await (const e of it) {
    out.push(e);
    if (stop?.(out)) ac?.abort();
  }
  return out;
};
const settle = async (fake: FakePeripheral): Promise<void> => {
  for (let i = 0; i < 50 && fake.remaining > 0; i++) await new Promise((r) => setTimeout(r, 5));
};
/** Opens a session on a fake scripted with the handshake, then the given session's steps. */
const open = async (s: Session): Promise<{ fake: FakePeripheral; ring: Awaited<ReturnType<typeof openRingSession>> }> => {
  const fake = new FakePeripheral([...HANDSHAKE, ...fixtureSteps(s)], { address: 'AA:BB:CC:DD:EE:02', reads: BATTERY_READ });
  let now = s.context.nowMs;
  const ring = await openRingSession(noAppId, fake, { timers, clock: { now: () => now, tzOffsetS: () => s.context.tzOffsetS } });
  if (s.name.startsWith('live heart rate') || s.name.startsWith('spot heart rate')) now += 3_600_000;
  return { fake, ring };
};

describe('Jring connect', () => {
  it('runs runStartup in Kotlin order and fills HandshakeInfo from 0x0C and the 2a19 read', async () => {
    const s = session('connect handshake');
    const fake = new FakePeripheral(fixtureSteps(s), { address: 'AA:BB:CC:DD:EE:02', reads: BATTERY_READ });
    const ring = await openRingSession(noAppId, fake, { timers, clock: clockOf(s) });
    expect(ring.info()).toEqual({ firmware: '003A002AV138', battery: 85, serial: '11:22:33:44:55:66', model: 'SMART_RING', clockOffsetS: 0 });
    // Identity is the 0x0C address, the same on every platform (Chromium never sees the Bluetooth address).
    expect(ring.identity).toEqual({ family: 'jring', model: 'SMART_RING', ringId: 'serial:11:22:33:44:55:66', basis: 'serial' });
    const pushed: RingEvent[] = [];
    ring.on((e) => e.type !== 'disconnected' && pushed.push(e));
    const unsolicited = s.steps.find((x) => x.notifyUnsolicited)!;
    for (const p of unsolicited.notifyUnsolicited!) fake.notify(p);
    // Fixture `localDay` is a proposal (the UTC midnight of the local date); records.ts wants the instant of the local
    // midnight, which in UTC-8 is 08:00Z. Port notes in docs/jring.md.
    expect(pushed).toEqual([{ type: 'dailyTotal', localDay: 1_699_948_800_000, steps: 1234, distanceM: 900, kcal: 45 }]);
    // The history tail of runStartup is the first sync: 10 03 then 16 00 (both silent here, dropped without a word).
    const evs = await collect(ring.sync({}, () => {}, new AbortController().signal));
    expect(evs.filter((e) => e.type === 'status')).toEqual([]);
    expect(fake.writes.map(toHex)).toEqual(writesOf(s));
    expect(fake.errors).toEqual([]);
    expect(fake.remaining).toBe(0);
    await ring.close();
  });

  it('the default family sends its app id first, and the person profile after the default one', async () => {
    const s = session('connect handshake');
    const steps = fixtureSteps(s);
    const appId = toHex(jring.protocol.frame({ op: 'appId', params: { appId: JRING_DEFAULT_APP_ID } }, {})[0]!.bytes);
    expect(appId.startsWith('48 56 54 30')).toBe(true);
    const profile = session('profile push');
    const fake = new FakePeripheral([{ expect: appId }, ...steps.slice(0, 6), ...fixtureSteps(profile)], { reads: BATTERY_READ });
    const ring = await openRingSession(jring, fake, {
      timers, clock: clockOf(s), profile: { metric: true, sex: 'male', ageYears: 30, heightCm: 180, weightKg: 75 },
    });
    expect(fake.writes.map((w) => toHex(w.subarray(0, 1)))).toEqual(['48', '0c', '01', '21', '02', '19', '20', '02']);
    expect(toHex(fake.writes[7]!)).toBe(writesOf(profile)[0]);
    expect(fake.errors).toEqual([]);
    expect(fake.remaining).toBe(0);
    await ring.close();
  });

  it('a ring that never answers 0x0C still connects, with the 2a26 firmware string', async () => {
    const fake = new FakePeripheral([{ expect: { prefix: '0c' } }, ...HANDSHAKE.slice(1)], {
      reads: { ...BATTERY_READ, '0000180a-0000-1000-8000-00805f9b34fb/00002a26-0000-1000-8000-00805f9b34fb': '52 31 2e 30 00' },
    });
    const ring = await openRingSession(noAppId, fake, { timers, clock: clockOf(session('connect handshake')) });
    expect(ring.info()).toMatchObject({ firmware: 'R1.0', battery: 85, serial: undefined });
    expect(fake.errors).toEqual([]);
    await ring.close();
  });

  it('answers a ring-driven bind: INIT → APP_START, ACK → SUCCESS', async () => {
    const s = session('ring-driven bind');
    const { fake, ring } = await open(s);
    for (const p of s.steps[0]!.notifyUnsolicited!) fake.notify(p);
    await settle(fake);
    expect(after(fake)).toEqual(writesOf(s));
    expect(fake.errors).toEqual([]);
    await ring.close();
  });
});

describe('Jring history', () => {
  it('first pass: 3 days of activity and sleep, then the heart-rate history to 16 ff', async () => {
    const s = session('history read, first pass');
    const { fake, ring } = await open(s);
    const evs = await collect(ring.sync({}, () => {}, new AbortController().signal));
    expect(after(fake)).toEqual(writesOf(s));
    for (const step of s.steps.filter((x) => x.expectEvents)) {
      for (const want of step.expectEvents!.map(strip)) expect(evs, JSON.stringify(want)).toContainEqual(expect.objectContaining(want));
    }
    const sleeps = evs.filter((e) => e.type === 'sleepEpochs');
    expect(sleeps).toHaveLength(2);
    expect(sleeps.every((e) => e.type === 'sleepEpochs' && e.firmware === '003A002AV138')).toBe(true);
    // The synthetic 0x10/0x11 packets stop 14 h before "now": the read waits out the 12 s silence, then says partial.
    const errors = evs.filter((e) => e.type === 'status' && e.key === 'error').map((e) => e.type === 'status' && e.value);
    expect(errors).toEqual(['partial:sleep_stage:3', 'partial:steps:3']);
    // Heart rate ended on 16 ff: its cursor moves to the newest reading.
    expect(evs).toContainEqual({ type: 'status', key: 'cursor', value: 'jr1:1699948860', stream: 'hr' });
    expect(evs.filter((e) => e.type === 'status' && e.key === 'cursor')).toHaveLength(1);
    expect(fake.errors).toEqual([]);
    await ring.close();
  });

  it('a later pass on the same connection asks for 1 day', async () => {
    const s = session('history read, later pass');
    const fake = new FakePeripheral([...HANDSHAKE, { expect: { prefix: '10 03' } }, { expect: { prefix: '16 00' }, reply: [`16 ff${' 00'.repeat(18)}`] }, ...fixtureSteps(s)], { reads: BATTERY_READ });
    const ring = await openRingSession(noAppId, fake, { timers, clock: clockOf(s) });
    await collect(ring.sync({}, () => {}, new AbortController().signal));
    const evs = await collect(ring.sync({}, () => {}, new AbortController().signal));
    expect(after(fake, HANDSHAKE.length + 2)).toEqual(writesOf(s));
    expect(evs).toContainEqual({ type: 'progress', stage: 'hr_history', done: true });
    expect(fake.errors).toEqual([]);
    expect(fake.remaining).toBe(0);
    await ring.close();
  });
});

describe('Jring live and spot', () => {
  it('live heart rate: 14 b4, samples (a zero ring time is dropped), stop 15 then 19', async () => {
    const s = session('live heart rate');
    const { fake, ring } = await open(s);
    const ac = new AbortController();
    const evs = await collect(ring.liveHeartRate(ac.signal), (seen) => seen.length >= 3, ac);
    expect(evs).toEqual(s.steps[1]!.expectEvents!.map(strip));
    expect(after(fake)).toEqual(writesOf(s));
    expect(fake.remaining).toBe(0);
    expect(fake.errors).toEqual([]);
    await ring.close();
  });

  it('spot heart rate rides 0x14 with origin spot and stops with the 19 re-arm', async () => {
    const s = session('spot heart rate');
    const { fake, ring } = await open(s);
    const ac = new AbortController();
    const evs = await collect(ring.spot('hr', ac.signal), (seen) => seen.some((e) => e.type === 'sample'), ac);
    expect(evs).toEqual(s.steps[1]!.expectEvents!.map(strip));
    expect(after(fake)).toEqual(writesOf(s));
    expect(fake.errors).toEqual([]);
    await ring.close();
  });

  it('combined run (spot stress): one 0x24 packet ends it, then 23 00', async () => {
    const s = session('spot measurement: combined');
    const { fake, ring } = await open(s);
    const evs = await collect(ring.spot('stress', new AbortController().signal));
    const want = s.steps[1]!.expectEvents!;
    expect(evs).toHaveLength(want.length);
    want.forEach((w, i) => {
      const { value, ...rest } = strip(w);
      expect(evs[i]).toMatchObject(rest);
      expect((evs[i] as { value: number }).value).toBeCloseTo(value as number, 3);
    });
    expect(after(fake)).toEqual(writesOf(s));
    expect(fake.remaining).toBe(0);
    await ring.close();
  });

  it('spot SpO2 reads the SpO2 out of the 0x24 reply', async () => {
    const s = session('spot SpO2');
    const { fake, ring } = await open(s);
    const evs = await collect(ring.spot('spo2', new AbortController().signal));
    expect(evs).toEqual(s.steps[1]!.expectEvents!.map(strip));
    expect(after(fake)).toEqual(writesOf(s));
    expect(fake.remaining).toBe(0);
    await ring.close();
  });

  it('a 0x27 / 0x28 before any reading ends the run as no_reading', async () => {
    const s = session('spot heart rate');
    const { fake, ring } = await open({ ...s, steps: [] });
    fake.script({ expect: { prefix: '14 b4' }, reply: [`27${' 00'.repeat(19)}`] }, { expect: { prefix: '15' } }, { expect: { prefix: '19' } });
    expect(await collect(ring.spot('hr', new AbortController().signal))).toEqual([{ type: 'status', key: 'error', value: 'no_reading' }]);
    fake.script({ expect: { prefix: '23 02' }, reply: [`28${' 00'.repeat(19)}`] }, { expect: { prefix: '23 00' } });
    expect(await collect(ring.spot('spo2', new AbortController().signal))).toEqual([{ type: 'status', key: 'error', value: 'no_reading' }]);
    expect(fake.remaining).toBe(0);
    expect(fake.errors).toEqual([]);
    await ring.close();
  });
});

describe('Jring housekeeping', () => {
  it('keepalive: 3a, no reply awaited (the service runs the 15 s timer)', async () => {
    const s = session('keepalive');
    const { fake, ring } = await open(s);
    await ring.runtime.run(jringKeepalive);
    await ring.runtime.run(jringKeepalive);
    expect(after(fake)).toEqual(writesOf(s));
    await ring.close();
  });

  it('clock re-push latches the new offset after a timezone change', async () => {
    const s = session('clock re-push');
    let now = s.context.nowMs;
    let tz = s.context.tzOffsetS;
    const fake = new FakePeripheral([...HANDSHAKE, ...fixtureSteps(s)], { reads: BATTERY_READ });
    const ring = await openRingSession(noAppId, fake, { timers, clock: { now: () => now, tzOffsetS: () => tz } });
    await ring.runtime.run(jringResyncTime);
    const jump = s.steps.find((x) => 'setContext' in x) as unknown as { setContext: { nowMs: number; tzOffsetS: number } };
    now = jump.setContext.nowMs;
    tz = jump.setContext.tzOffsetS;
    await ring.runtime.run(jringResyncTime);
    expect(after(fake)).toEqual(writesOf(s));
    expect((ring.runtime.state as JringState).clockOffsetS).toBe(-25_200);
    await ring.close();
  });

  it('profile push writes 0x02 with the person values', async () => {
    const s = session('profile push');
    const { fake, ring } = await open(s);
    await ring.runtime.run(s.steps[0]!.do as unknown as { op: string; params: Record<string, number | boolean> });
    expect(after(fake)).toEqual(writesOf(s));
    await ring.close();
  });

  it('forget: 4b 05 waits for UNBOND_ACK', async () => {
    const s = session('forget');
    const { fake, ring } = await open(s);
    expect(await ring.runtime.run(jringForget)).toEqual([{ type: 'status', key: 'ack', value: 'unbound' }]);
    expect(after(fake)).toEqual(writesOf(s));
    await ring.close();
  });
});
