// @vitest-environment node
/**
 * Colmi sessions (`sessions.json`) replayed over the fake peripheral and the session runner: the three handshakes, the
 * cold and warm history walks, one HR day, one steps day, sleep on its own and inside the walk, interval-temperature
 * paging, live heart rate with the real-time fallback, spot HR and SpO2.
 */
import { describe, expect, it } from 'vitest';
import { openRingSession } from '../../session';
import { fromHex, toHex, type RingEvent } from '../../types';
import { COLMI_UUIDS } from '../commands';
import { colmi, createColmiFamily, seededSettings, type ColmiMeasurementSettings } from '../family';
import { decodeCursor, type ColmiState } from '../protocol';
import { ColmiFake, HISTORY_START, collect, fixedClock, handshakeSteps, kotlinEvents, sameAsKotlin, session, toFake, type ColmiStep } from './helpers';

const CLOCK = { nowMs: 1784282400000, tzOffsetS: 7200 };
const fast = { timers: { quietMs: 30, stallMs: 80 }, clock: fixedClock(CLOCK) };
const FIRMWARE = 'R02_1.00.00_000000';
const reads = { [`${COLMI_UUIDS.deviceInfo}/${COLMI_UUIDS.firmwareRevision}`]: toHex(new TextEncoder().encode(FIRMWARE)) };
const signal = (): AbortSignal => new AbortController().signal;
const hex = (ws: Uint8Array[]): string[] => ws.map(toHex);
const expectedWrites = (steps: ColmiStep[]): string[] => steps.map((s) => s.expectWrite);
const expectKotlin = (evs: RingEvent[], expected: Array<Record<string, unknown>>): void => {
  const got = kotlinEvents(evs);
  expect(got.length, JSON.stringify(got)).toBe(expected.length);
  expected.forEach((e, i) => expect(sameAsKotlin(got[i], e)).toBeNull());
};
const errors = (evs: RingEvent[]): string[] => evs.flatMap((e) => (e.type === 'status' && e.key === 'error' ? [String(e.value)] : []));

/** A connected Colmi ring after the cold handshake (optionally with a different 0x3C reply). */
async function connected(name = 'R02_1A2B', support?: string) {
  const steps = handshakeSteps('handshake-cold-battery').map((s) => (support && s.expectWrite.startsWith('3c') ? { ...s, notify: [support] } : s));
  const fake = new ColmiFake(steps.map(toFake), { name, reads, address: 'AA:BB:CC:DD:EE:02' });
  const s = await openRingSession(colmi, fake, fast);
  return { fake, s, after: fake.writes.length };
}

describe('Colmi handshake', () => {
  it('cold, ring reports HR on and temperature on: writes in the Kotlin order, seeds from the replies', async () => {
    const fx = session('handshake-cold-battery');
    const fake = new ColmiFake(handshakeSteps(fx.name).map(toFake), { name: 'R02_1A2B', reads, address: 'AA:BB:CC:DD:EE:02' });
    const s = await openRingSession(colmi, fake, fast);
    expect(s.info()).toEqual({ firmware: FIRMWARE, battery: 84, model: 'R02', clockOffsetS: 0 });
    expect(s.identity).toEqual({ family: 'colmi', model: 'R02', ringId: 'mac:aa:bb:cc:dd:ee:02', basis: 'mac' });
    expect(hex(fake.writes)).toEqual(expectedWrites(handshakeSteps(fx.name)));
    expect(seededSettings(s.runtime.state as ColmiState)).toEqual(fx.expectSeededSettings);
    expect(fake.errors).toEqual([]);
    expect(fake.remaining).toBe(0);
    await s.close();
  });

  it('cold, ring has HR off: all-day HR switched on at the ring interval, last', async () => {
    const fx = session('handshake-cold-hr-disabled');
    const steps = handshakeSteps(fx.name);
    expect(steps[steps.length - 1]!.expectWrite.startsWith('16 02 01 3c')).toBe(true);
    const fake = new ColmiFake(steps.map(toFake), { name: 'R02_1A2B', reads });
    const s = await openRingSession(colmi, fake, fast);
    expect(hex(fake.writes)).toEqual(expectedWrites(steps));
    expect(seededSettings(s.runtime.state as ColmiState)).toEqual(fx.expectSeededSettings);
    expect(fake.errors).toEqual([]);
    expect(fake.remaining).toBe(0);
    await s.close();
  });

  it('saved settings and profile: written as saved, the ring replies change nothing', async () => {
    const fx = session('handshake-persisted-settings-and-profile');
    const settings = fx.state!.measurementSettings as unknown as ColmiMeasurementSettings;
    const p = fx.state!.profile!;
    const profile = { metric: p.metric as boolean, sex: p.sex as 'female', ageYears: p.ageYears as number, heightCm: p.heightCm as number, weightKg: p.weightKg as number };
    const fake = new ColmiFake(handshakeSteps(fx.name).map(toFake), { name: 'R03_0001', reads });
    const s = await openRingSession(createColmiFamily({ settings }), fake, { ...fast, profile });
    expect(hex(fake.writes)).toEqual(expectedWrites(handshakeSteps(fx.name)));
    expect(s.info().model).toBe('R03');
    expect(fake.errors).toEqual([]);
    expect(fake.remaining).toBe(0);
    await s.close();
  });

  it('asks for a bond only for the models the Kotlin bonds', async () => {
    const bit = '3c 00 08 00 00 00 00 00 00 00 00 00 00 00 00 44';
    const r09 = await connected('R09_9D07', bit);
    expect((r09.s.runtime.state as ColmiState).bondRequested).toBe(true);
    await r09.s.close();
    const r10 = await connected('COLMI R10_1A2B', bit);
    expect((r10.s.runtime.state as ColmiState)).toMatchObject({ bondRequested: false, supportsBlePair: true });
    await r10.s.close();
  });

  it('a ring that answers none of the reads still connects (the Kotlin never waits for them)', async () => {
    const steps = handshakeSteps('handshake-cold-battery').map((s) => ({ ...s, notify: [] }));
    const fake = new ColmiFake(steps.map(toFake), { name: 'R02_1A2B' });
    const s = await openRingSession(colmi, fake, fast);
    expect(s.info()).toEqual({ firmware: '', battery: undefined, model: 'R02', clockOffsetS: 0 });
    expect(fake.errors).toEqual([]);
    await s.close();
  });
});

describe('Colmi history walk', () => {
  it('cold walk: every stage in the Kotlin order, big data on the V2 command channel, a cursor per stream', async () => {
    const { fake, s, after } = await connected();
    const fx = session('history-walk-empty-cold');
    fake.script(...fx.steps.map(toFake));
    const progress: string[] = [];
    const evs = await collect(s.sync({}, (p) => progress.push(p.stage ?? ''), signal()));
    expect(hex(fake.writes.slice(after))).toEqual(expectedWrites(fx.steps));
    fake.targets.slice(after).forEach((t, i) => {
      const bigData = fake.writes[after + i]![0] === 0xbc;
      expect(t).toEqual(bigData ? { service: COLMI_UUIDS.serviceV2, characteristic: COLMI_UUIDS.command } : { service: COLMI_UUIDS.serviceV1, characteristic: COLMI_UUIDS.write });
    });
    expect(errors(evs)).toEqual([]);
    const cursors = evs.flatMap((e) => (e.type === 'status' && e.key === 'cursor' ? [`${e.stream}=${decodeCursor(String(e.value))}`] : []));
    expect(cursors).toEqual(['steps', 'hr', 'vendor:stress', 'spo2', 'sleep_stage', 'hrv', 'skin_temp'].map((x) => `${x}=2026-07-17`));
    expect(evs.filter((e) => e.type === 'progress').at(-1)).toEqual({ type: 'progress', stage: 'skin_temp', done: true });
    expect(fake.errors).toEqual([]);
    expect(fake.remaining).toBe(0);

    // The same connection again: the Kotlin's warm pass reads today only.
    const warm = session('history-walk-empty-warm-today-only');
    const mark = fake.writes.length;
    fake.script(...warm.steps.map(toFake));
    const evs2 = await collect(s.sync({}, () => {}, signal()));
    expect(hex(fake.writes.slice(mark))).toEqual(expectedWrites(warm.steps));
    expect(errors(evs2)).toEqual([]);
    expect(fake.errors).toEqual([]);
    expect(fake.remaining).toBe(0);
    await s.close();
  });

  it('one HR day of three packets on the local grid, then the next day is asked', async () => {
    const { fake, s, after } = await connected();
    const fx = session('hr-log-day-read');
    fake.script(...fx.steps.map(toFake));
    const steps = await collect(s.readHistory('steps', {}, signal()));
    expect(errors(steps)).toEqual([]);
    const hr = await collect(s.readHistory('hr', {}, signal()));
    expectKotlin(hr, fx.steps.find((x) => x.expectEvents)!.expectEvents!);
    // The fixture ends after the day-1 request: the stall ends the stage without a cursor, as the Kotlin watchdog does.
    expect(errors(hr)).toEqual(['stall:hr']);
    expect(hr.some((e) => e.type === 'status' && e.key === 'cursor')).toBe(false);
    expect(hex(fake.writes.slice(after))).toEqual(expectedWrites(fx.steps));
    expect(fake.errors).toEqual([]);
    expect(fake.remaining).toBe(0);
    await s.close();
  });

  it('one steps day: header, two quarter-hour buckets, the last packet ends the day', async () => {
    const { fake, s } = await connected();
    const fx = session('steps-day-read');
    fake.script(...fx.steps.map(toFake));
    const evs = await collect(s.readHistory('steps', {}, signal()));
    expectKotlin(evs, fx.steps[0]!.expectEvents!);
    expect(errors(evs)).toEqual(['stall:steps']);
    expect(fake.errors).toEqual([]);
    expect(fake.remaining).toBe(0);
    await s.close();
  });

  it('sleep inside the walk: the completion moves on to HRV', async () => {
    const { fake, s, after } = await connected();
    const fx = session('sleep-in-pipeline');
    fake.script(...fx.steps.map(toFake));
    const evs: RingEvent[] = [];
    for (const stream of ['steps', 'hr', 'vendor:stress', 'spo2', 'sleep_stage', 'hrv'] as const) evs.push(...(await collect(s.readHistory(stream, {}, signal()))));
    expectKotlin(evs, fx.steps.find((x) => x.expectEvents)!.expectEvents!);
    expect(evs.find((e) => e.type === 'sleepEpochs')).toMatchObject({ epochS: 60, firmware: FIRMWARE, complete: false });
    expect(errors(evs)).toEqual(['stall:hrv']);
    expect(hex(fake.writes.slice(after))).toEqual(expectedWrites(fx.steps));
    expect(fake.errors).toEqual([]);
    await s.close();
  });

  it('sleep on its own: done on the sleep transfer; the nap that follows arrives as an idle event', async () => {
    const { fake, s } = await connected();
    const fx = session('sleep-standalone');
    fake.script(...fx.steps.map(toFake));
    const idle: RingEvent[] = [];
    s.on((e) => {
      if (e.type !== 'disconnected') idle.push(e);
    });
    const evs: RingEvent[] = [];
    for await (const e of s.runtime.exchange({ op: 'sleepNow' })) evs.push(e);
    await new Promise((r) => setTimeout(r, 10));
    expectKotlin([...evs, ...idle], fx.steps[0]!.expectEvents!);
    expect(errors(evs)).toEqual([]);
    expect(fake.errors).toEqual([]);
    expect(fake.remaining).toBe(0);
    await s.close();
  });

  it('interval temperature: pages a day while the index advances, then days 1..6, then done', async () => {
    const { fake, s, after } = await connected('R02_1A2B', '3c 00 00 00 00 00 00 00 00 80 00 00 00 00 00 bc');
    const fx = session('interval-temperature-paging');
    fake.script(...fx.steps.map(toFake));
    const evs = await collect(s.sync({}, () => {}, signal()));
    expect(hex(fake.writes.slice(after))).toEqual(expectedWrites(fx.steps));
    expectKotlin(evs, fx.steps.flatMap((x) => x.expectEvents ?? []));
    expect(errors(evs)).toEqual([]);
    expect(evs.filter((e) => e.type === 'progress').at(-1)).toEqual({ type: 'progress', stage: 'skin_temp', done: true });
    expect(fake.errors).toEqual([]);
    expect(fake.remaining).toBe(0);
    await s.close();
  });
});

describe('Colmi live and spot measurements', () => {
  /** Runs one stream until `n` samples, then aborts (the stop command is written on the way out). */
  const take = async (it: (sig: AbortSignal) => AsyncIterable<RingEvent>, n: number): Promise<RingEvent[]> => {
    const ac = new AbortController();
    const got: RingEvent[] = [];
    const timer = setTimeout(() => ac.abort(), 500);
    for await (const e of it(ac.signal)) {
      got.push(e);
      if (got.filter((x) => x.type === 'sample').length >= n) ac.abort();
    }
    clearTimeout(timer);
    return got;
  };

  it('a ring that refuses 0x1E: falls over to the 0x69 stream, stops with the last bpm, never probes again', async () => {
    const { fake, s, after } = await connected();
    const fx = session('live-hr-realtime-rejected-fallback');
    // The Kotlin stops the second session the same way; the fixture ends before it.
    fake.script(...fx.steps.map(toFake), { expect: fromHex('6a 01 4a 00 00 00 00 00 00 00 00 00 00 00 00 b5') });
    const first = await take((sig) => s.liveHeartRate(sig), 2);
    expectKotlin(first, [...fx.steps[0]!.expectEvents!, ...fx.steps[1]!.expectEvents!]);
    expect(first.filter((e) => e.type === 'sample').every((e) => e.type === 'sample' && e.origin === 'live')).toBe(true);
    await take((sig) => s.liveHeartRate(sig), 1);
    expect(hex(fake.writes.slice(after))).toEqual([...expectedWrites(fx.steps), '6a 01 4a 00 00 00 00 00 00 00 00 00 00 00 00 b5']);
    expect(fake.errors).toEqual([]);
    expect(fake.remaining).toBe(0);
    await s.close();
  });

  it('a ring that accepts 0x1E: 1e 01 … 1e 02', async () => {
    const { fake, s, after } = await connected();
    const fx = session('live-hr-realtime-accepted');
    const steps = fx.steps.filter((x) => x.afterMs === undefined); // the 20 s keepalive needs a timer the contract lacks
    fake.script(...steps.map(toFake));
    const evs = await take((sig) => s.liveHeartRate(sig), 1);
    expectKotlin(evs, fx.steps[0]!.expectEvents!);
    expect(hex(fake.writes.slice(after))).toEqual(expectedWrites(steps));
    expect(fake.errors).toEqual([]);
    await s.close();
  });

  it('spot heart rate: 69 01, readings as spot samples, 6a 01 <last bpm> 00', async () => {
    const { fake, s, after } = await connected();
    const fx = session('spot-hr');
    fake.script(...fx.steps.map(toFake));
    const evs = await take((sig) => s.spot('hr', sig), 1);
    expectKotlin(evs, fx.steps[0]!.expectEvents!);
    expect(evs.find((e) => e.type === 'sample')).toMatchObject({ stream: 'hr', value: 72, origin: 'spot' });
    expect(hex(fake.writes.slice(after))).toEqual(expectedWrites(fx.steps));
    expect(fake.errors).toEqual([]);
    await s.close();
  });

  it('spot SpO2: 69 03 25, warm-up frames yield nothing, 6a 03 00 00', async () => {
    const { fake, s, after } = await connected();
    const fx = session('spot-spo2');
    fake.script(...fx.steps.map(toFake));
    const evs = await take((sig) => s.spot('spo2', sig), 1);
    expectKotlin(evs, fx.steps[0]!.expectEvents!);
    expect(evs.find((e) => e.type === 'sample')).toMatchObject({ stream: 'spo2', value: 97, unit: 'pct', origin: 'spot' });
    expect(hex(fake.writes.slice(after))).toEqual(expectedWrites(fx.steps));
    expect(fake.errors).toEqual([]);
    await s.close();
  });

  it('sport session frames: start and stop bytes, 0x78 bpm as a workout-stream sample', () => {
    const fx = session('sport-session-cycle');
    const st = colmi.protocol.initialState();
    expect(toHex(colmi.protocol.frame({ op: 'phoneSport', params: { status: 1, activityType: 'cycle' } }, st)[0]!.bytes)).toBe(fx.steps[0]!.expectWrite);
    expect(toHex(colmi.protocol.frame({ op: 'phoneSport', params: { status: 4, activityType: 'cycle' } }, st)[0]!.bytes)).toBe(fx.steps[1]!.expectWrite);
    const evs = fx.steps[0]!.notify!.flatMap((n) => colmi.protocol.ingest(fromHex(n), { ...st, nowMs: CLOCK.nowMs }, COLMI_UUIDS.notify).events);
    expect(evs).toEqual([{ type: 'sample', stream: 'hr', t: CLOCK.nowMs, value: 120, unit: 'bpm', origin: 'workout_stream' }]);
  });

  it('the history start the Kotlin queues last in its handshake is the first write of a sync', () => {
    expect(toHex(colmi.protocol.frame({ op: 'history', params: { stage: 'activity' } }, colmi.protocol.initialState())[0]!.bytes)).toBe(HISTORY_START);
  });
});
