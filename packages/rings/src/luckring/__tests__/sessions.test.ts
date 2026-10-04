// @vitest-environment node
/**
 * Every session in `qa/fixtures/rings/luckring/sessions.json`, replayed over `openRingSession` with scaled timers.
 *
 * Differences from the Kotlin, by design: the handshake waits for the device info / battery / settings-sync replies
 * (Android never waits), so the ring's replies and their ACKs land before the first history request instead of after
 * it; the pager is the session's `sync`, so a second start while one runs is a `busy` refusal and cancel is an abort.
 */
import { describe, expect, it } from 'vitest';
import { openRingSession } from '../../session';
import { fakeFromSession, FakePeripheral, type FixtureSession } from '../../testing';
import { fromHex, toHex, type RingCommand, type RingEvent } from '../../types';
import { luckring } from '../family';
import { createLuckRingProtocol, HISTORY_CATALOG, type LuckRingState } from '../protocol';
import { RecordingFake, expectKotlin, fixedClock, kotlinEvents, replayPager, session, sleep, waitUntil } from './helpers';

const timers = { quietMs: 30, stallMs: 80 };
const opts = { timers, clock: fixedClock() };
const HANDSHAKE_PACKETS = 8;

async function collect(it: AsyncIterable<RingEvent>): Promise<RingEvent[]> {
  const out: RingEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe('LuckRing connect handshake', () => {
  it('cold, no ring replies: the nine packets in the Kotlin order; a silent ring does not fail the connect', async () => {
    const fx = session('connect handshake, cold');
    const fake = fakeFromSession(fx as unknown as FixtureSession, { frameLength: 20, name: 'TK18_AA11' });
    const s = await openRingSession(luckring, fake, opts);
    expect(s.info()).toEqual({ firmware: '', battery: undefined, model: 'TK18', clockOffsetS: 0 });
    expect(fake.remaining).toBe(1); // the history request is the sync's
    const evs = await collect(s.readHistory('steps', {}, new AbortController().signal));
    expect(fake.errors).toEqual([]);
    expect(fake.remaining).toBe(0);
    expect(fake.writes.map(toHex)).toEqual(fx.steps.flatMap((x) => (x.expectWrite ? [x.expectWrite] : [])));
    // Nothing answered type 5: the read advances (Kotlin stall) and records the day it synced.
    expect(evs).toContainEqual({ type: 'status', key: 'cursor', value: 'lr1:2023-11-14', stream: 'steps' });
    expect(s.identity).toMatchObject({ family: 'luckring', model: 'TK18' });
    await s.close();
  });

  it('with ring replies: firmware and battery in the info, every reply SEND acked, the bundle ACK never acked back', async () => {
    const fx = session('connect handshake with ring replies');
    const hs = fx.steps.filter((x) => x.expectWrite && !x.notify);
    const replies = fx.steps.filter((x) => x.notify);
    const req9 = hs[HANDSHAKE_PACKETS - 1]!;
    const fake = new FakePeripheral(
      [
        ...hs.slice(0, HANDSHAKE_PACKETS).map((x) => ({ expect: x.expectWrite!, reply: x === req9 ? replies.flatMap((r) => r.notify!) : [] })),
        ...replies.filter((r) => r.expectWrite).map((r) => ({ expect: r.expectWrite! })),
        { expect: hs[HANDSHAKE_PACKETS]!.expectWrite! },
      ],
      { name: 'TK18' },
    );
    const s = await openRingSession(luckring, fake, opts);
    expect(s.info()).toEqual({ firmware: '1.2.3.4.5', battery: 85, model: 'TK18', clockOffsetS: 0 });
    expect(fake.errors).toEqual([]);
    expect(fake.remaining).toBe(1);
    // ACK of 110 decoded (CommandAck) but not acked; the three replies acked in arrival order.
    expect(fake.writes.slice(HANDSHAKE_PACKETS).map(toHex)).toEqual(replies.flatMap((r) => (r.expectWrite ? [r.expectWrite] : [])));
    await collect(s.readHistory('steps', {}, new AbortController().signal));
    expect(fake.remaining).toBe(0);
    expect(fake.errors).toEqual([]);
    await s.close();
  });

  it('the profile rides in the bundle when the caller has one', async () => {
    const fake = new RecordingFake([], { name: 'TK18' });
    const s = await openRingSession(luckring, fake, { ...opts, profile: { metric: true, sex: 'male', ageYears: 30, heightCm: 175, weightKg: 70 } });
    expect(toHex(fake.writes[0]!)).toBe('00 01 03 00 01 6e 00 00 43 00 41 00 07 0c 00 66 00 00 00 00');
    expect(toHex(fake.writes[1]!)).toBe('01 00 1e af 46 00 0c 00 68 00 f1 53 65 00 00 00 00 00 08 00');
    await s.close();
  });
});

describe('LuckRing history pager sessions', () => {
  async function open(): Promise<{ s: Awaited<ReturnType<typeof openRingSession>>; fake: RecordingFake }> {
    const fake = new RecordingFake([], { name: 'TK18' });
    const s = await openRingSession(luckring, fake, opts);
    expect(fake.writes.length).toBe(HANDSHAKE_PACKETS);
    return { s, fake };
  }

  for (const name of [
    'history sync: sequential advance on data settle',
    'history sync: unsupported type is skipped on stall',
    'history sync: re-entrant start is ignored while running',
    'history sync: cancel stops the pass',
    'history sync: full catalog with production timers',
  ]) {
    it(name, async () => {
      const { s, fake } = await open();
      const out = await replayPager(session(name).steps, { rt: s.runtime, fake, base: HANDSHAKE_PACKETS });
      // Every type that ended on its timers recorded its cursor; nothing was left partial.
      expect(out.events.filter((e) => e.type === 'status' && e.key === 'error')).toEqual([]);
      await s.close();
    });
  }

  it('the session plan is the Kotlin catalog, and sync ends with progress done and a cursor per stream', async () => {
    const fx = session('history sync: full catalog');
    const { s, fake } = await open();
    const plan = luckring.protocol.planSync({}, s.runtime.state);
    expect(plan.map((c) => c.params?.dataType)).toEqual(fx.steps[0]!.do!.start);
    const evs = await collect(s.sync({}, () => {}, new AbortController().signal));
    expect(fake.writes.slice(HANDSHAKE_PACKETS).map(toHex)).toEqual(fx.steps.flatMap((x) => (x.expectWrite && !x.notify ? [x.expectWrite] : [])));
    const cursors = evs.filter((e) => e.type === 'status' && e.key === 'cursor').map((e) => (e.type === 'status' ? e.stream : ''));
    expect(cursors).toEqual(HISTORY_CATALOG.map((c) => c.stream));
    expect(evs.filter((e) => e.type === 'progress').map((e) => (e.type === 'progress' ? e.stage : ''))).toEqual(HISTORY_CATALOG.map((c) => c.stream));
    expect(evs[evs.length - 1]).toEqual({ type: 'progress', stage: 'vendor:stress', done: true });
    await s.close();
  });

  it('warm pass: a second start is refused, then battery and settings sync first, encoder seq at 5, pager seq at 1', async () => {
    const fx = session('warm pass');
    const { s, fake } = await open();
    const first = fx.steps.slice(0, 1 + HANDSHAKE_PACKETS + 1);
    expect(fake.writes.map(toHex)).toEqual(first.flatMap((x) => (x.expectWrite ? [x.expectWrite] : [])).slice(0, HANDSHAKE_PACKETS));
    const ac = new AbortController();
    const one = collect(s.sync({}, () => {}, ac.signal)).catch((e: unknown) => e);
    await waitUntil(() => fake.writes.length === HANDSHAKE_PACKETS + 1);
    expect(toHex(fake.writes[HANDSHAKE_PACKETS]!)).toBe(first[first.length - 1]!.expectWrite);
    // A pass already in flight wins.
    await expect(collect(s.sync({}, () => {}, new AbortController().signal))).rejects.toMatchObject({ code: 'busy' });
    await sleep(20);
    expect(fake.writes.length).toBe(HANDSHAKE_PACKETS + 1);
    ac.abort();
    expect(await one).toMatchObject({ code: 'aborted' });
    const warm = fx.steps.slice(first.length).flatMap((x) => (x.expectWrite ? [x.expectWrite] : []));
    const ac2 = new AbortController();
    const two = collect(s.sync({}, () => {}, ac2.signal)).catch(() => undefined);
    await waitUntil(() => fake.writes.length === HANDSHAKE_PACKETS + 1 + warm.length);
    expect(fake.writes.slice(HANDSHAKE_PACKETS + 1).map(toHex)).toEqual(warm);
    ac2.abort();
    await two;
    await s.close();
    // engineReset: a new connection is a new session and a cold handshake again.
    const again = new RecordingFake([], { name: 'TK18' });
    await (await openRingSession(luckring, again, opts)).close();
    expect(again.writes.map(toHex)).toEqual(fake.writes.slice(0, HANDSHAKE_PACKETS).map(toHex));
  });
});

describe('LuckRing live heart rate and spot SpO2', () => {
  const fx = session('live heart rate and spot SpO2');
  const COMMANDS: Record<string, RingCommand> = {
    startHeartRate: luckring.liveHeartRate!.start,
    stopHeartRate: luckring.liveHeartRate!.stop,
    startSpO2: luckring.spot!.spo2 as RingCommand,
    stopSpO2: luckring.spotStop!.spo2 as RingCommand,
  };

  it('replays the fixture on a fresh encoder: toggles, SEND_NO_ACK samples never acked, empty envelope ends it', () => {
    const protocol = createLuckRingProtocol();
    let st = protocol.initialState() as LuckRingState;
    let pending: string[] = [];
    fx.steps.forEach((step, i) => {
      if (step.do) {
        const c = { ...COMMANDS[Object.keys(step.do)[0]!]!, params: { ...COMMANDS[Object.keys(step.do)[0]!]!.params, nowMs: i, tzOffsetS: 0 } };
        const plan = protocol.begin!(c, st);
        st = plan.state as LuckRingState;
        pending = protocol.frame(c, st).map((f) => toHex(f.bytes));
      }
      if (step.expectWrite) expect(pending.shift()).toBe(step.expectWrite);
      if (step.notify) {
        const evs: RingEvent[] = [];
        for (const n of step.notify) {
          const r = protocol.ingest(fromHex(n), st);
          st = r.state as LuckRingState;
          evs.push(...r.events);
          if (step.expectNoWrite) expect(r.send).toBeUndefined();
          const complete = kotlinEvents(r.events).some((k) => k.kotlin === 'HeartRateComplete' || k.kotlin === 'Spo2Complete');
          expect(r.done === true).toBe(complete);
        }
        expectKotlin(evs, step.expectEvents!);
      }
    });
  });

  it('a session stream: start, live samples, the empty envelope ends it, the stop goes out', async () => {
    const fake = new RecordingFake([], { name: 'TK18' });
    const s = await openRingSession(luckring, fake, opts);
    const evs: RingEvent[] = [];
    const run = (async () => {
      for await (const e of s.liveHeartRate(new AbortController().signal)) evs.push(e);
    })();
    await waitUntil(() => fake.writes.length === HANDSHAKE_PACKETS + 1);
    const hr = fx.steps.filter((x) => x.notify).slice(0, 2);
    for (const step of hr) fake.notify(step.notify![0]!);
    await run;
    expectKotlin(evs, hr.flatMap((x) => x.expectEvents!));
    expect(evs[0]).toMatchObject({ origin: 'live' });
    // The toggles of a stream are written without `begin`, so they use the next free encoder seq (5) and keep it.
    const tail = fake.writes.slice(HANDSHAKE_PACKETS).map(toHex);
    expect(tail).toEqual(['00 01 00 05 01 18 00 00 01 00 01 00 00 00 00 00 00 00 00 00', '00 01 00 05 01 18 00 00 01 00 00 00 00 00 00 00 00 00 00 00']);
    await s.close();
  });

  it('spot SpO2 readings are spot samples and the stop is written', async () => {
    const fake = new RecordingFake([], { name: 'TK18' });
    const s = await openRingSession(luckring, fake, opts);
    const evs: RingEvent[] = [];
    const run = (async () => {
      for await (const e of s.spot('spo2', new AbortController().signal)) evs.push(e);
    })();
    await waitUntil(() => fake.writes.length === HANDSHAKE_PACKETS + 1);
    for (const step of fx.steps.filter((x) => x.notify).slice(2)) fake.notify(step.notify![0]!);
    await run;
    expect(evs[0]).toMatchObject({ type: 'sample', stream: 'spo2', value: 97, origin: 'spot', t: 1_700_000_040_000 });
    expect(toHex(fake.writes[fake.writes.length - 1]!)).toBe('00 01 00 05 01 14 00 00 05 00 00 00 00 00 00 00 00 00 00 00');
    await s.close();
  });
});
