// @vitest-environment node
/**
 * Session wait rules (RINGS-01, RINGS-07, RINGS-08): a push that is not part of the read keeps the stall wait, a quiet
 * timer with nothing of the read in hand never ends a history read as complete, a command has an overall ceiling that
 * steady pushes cannot hold open, and a family's keepalive is written on its interval while the session is open.
 */
import { describe, expect, it } from 'vitest';
import { RecordingFake, fixedClock, sleep, waitUntil } from '../luckring/__tests__/helpers';
import { luckring } from '../luckring/family';
import { STALL_MS, SETTLE_MS, type LuckRingState } from '../luckring/protocol';
import { jstyle2301 } from '../jstyle2301/family';
import { decodeCursor } from '../jstyle2301/protocol';
import { jring } from '../jring/family';
import { JRING_KEEPALIVE_MS, jringKeepalive } from '../jring/commands';
import { openRingSession } from '../session';
import { FakePeripheral } from '../testing';
import type { IngestResult, Protocol, RingEvent, RingFamily } from '../types';

const errors = (evs: RingEvent[]): string[] => evs.flatMap((e) => (e.type === 'status' && e.key === 'error' ? [String(e.value)] : []));
const cursors = (evs: RingEvent[]): string[] => evs.flatMap((e) => (e.type === 'status' && e.key === 'cursor' ? [String(e.value)] : []));

/** A bare family: every packet counts as the reply, the stall timer ends the command, op `ping` writes `aa`. */
function stubFamily(extra: Partial<RingFamily> = {}): RingFamily {
  const protocol: Protocol = {
    initialState: () => ({}),
    frame: (cmd) => [{ bytes: Uint8Array.of(cmd.op === 'ping' ? 0xaa : 0x01) }],
    ingest: (_b, state): IngestResult => ({ events: [{ type: 'status', key: 'ack', value: 'push' }], state }),
    planSync: () => [],
    begin: (_c, state) => ({ state, expectReply: true, quietMs: 40, stallMs: 400 }),
    timeout: (state): IngestResult => ({ events: [], state, done: true }),
    redactOutbound: (f) => f,
  };
  return {
    id: 'jring', label: 'Stub ring', models: [], streams: [], tier: 'C',
    scan: { requestFilters: [], optionalServices: [], match: () => false },
    gatt: { service: 'svc', write: 'w', notify: [{ characteristic: 'n', mode: 'notify' }] },
    protocol,
    handshake: async () => ({ firmware: '', clockOffsetS: 0 }),
    decoderTag: () => 'stub@1',
    ...extra,
  } as RingFamily;
}

describe('LuckRing: pushes outside the read', () => {
  // Heart-rate history (8) in two packets, and an unsolicited battery SEND (85 %).
  const HEAD = '00 01 01 03 01 08 00 00 0d 00 02 00 02 00 f1 53 65 48 3c f1';
  const CONT = '01 53 65 4b 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00';
  const BATTERY = '00 01 00 00 01 03 00 00 02 00 55 01 00 00 00 00 00 00 00 00';

  it('a battery push during a history read keeps the stall budget: frames after the settle time are still read', async () => {
    const fake = new RecordingFake([], { name: 'TK18' });
    const s = await openRingSession(luckring, fake, { timers: { quietMs: 30, stallMs: 400 }, clock: fixedClock() });
    const base = fake.writes.length;
    const evs: RingEvent[] = [];
    let ended = false;
    const read = (async () => {
      for await (const e of s.runtime.exchange({ op: 'history', params: { dataType: 8, stream: 'hr', stage: 'hr' } })) evs.push(e);
      ended = true;
    })();
    await waitUntil(() => fake.writes.length > base);
    fake.notify(BATTERY);
    await sleep(120); // four settle periods: the read must still be open
    expect(ended).toBe(false);
    fake.notify(HEAD);
    fake.notify(CONT);
    await read;
    expect(evs.filter((e) => e.type === 'sample' && e.stream === 'hr')).toHaveLength(2);
    expect(cursors(evs)).toHaveLength(1);
    await s.close();
  });

  it('a quiet timeout with no frame of the type in hand is stall time, never a cursor for nothing', () => {
    const p = luckring.protocol;
    let st = p.begin!({ op: 'history', params: { dataType: 8, stream: 'hr', nowMs: 1_700_000_000_000, tzOffsetS: 0 } }, p.initialState()).state;
    let quiets = 0;
    for (;;) {
      const r = p.timeout!(st, 'quiet');
      st = r.state;
      quiets++;
      if (r.done) {
        // The stall budget is spent: the read ends as the stall path always did (an unsupported type answers nothing).
        expect(quiets).toBe(Math.ceil(STALL_MS / SETTLE_MS));
        break;
      }
      expect(r.events).toEqual([]);
      expect((st as LuckRingState).inflight).toMatchObject({ kind: 'history', frames: 0 });
    }
  });
});

describe('the per-command ceiling', () => {
  it('ends a command that steady pushes would keep open, as a stall', async () => {
    const fake = new RecordingFake();
    const s = await openRingSession(stubFamily(), fake, { timers: { maxMs: 150 } });
    let pushing = true;
    void (async () => {
      while (pushing) {
        fake.notify('01');
        await sleep(10); // well inside the 40 ms quiet timer
      }
    })();
    const t0 = Date.now();
    const evs = await s.runtime.run({ op: 'read' });
    const took = Date.now() - t0;
    pushing = false;
    expect(evs.length).toBeGreaterThan(3);
    expect(took).toBeGreaterThanOrEqual(140);
    expect(took).toBeLessThan(400);
    await s.close();
  });
});

describe('J-Style: a read that got nothing keeps its refresh round', () => {
  const handshake = [
    { expect: { prefix: '27' }, reply: ['27 00 05 02 05 00 00 00 00 00 00 00 00 00 00 33'] },
    { expect: { prefix: '13' }, reply: ['13 50 00 00 00 00 00 00 00 00 00 00 00 00 00 63'] },
  ];
  const clock = { now: () => Date.parse('2026-09-16T10:00:00Z'), tzOffsetS: () => 0 };
  const cmd = { op: 'history', params: { opcode: 0x55, stream: 'hr', seq: 3, pageLimit: 1, prev: 'j1|55.2.1757800000.more' } };

  it('stall with zero packets: stall reported, round stays at 2', async () => {
    const fake = new FakePeripheral([...handshake, { expect: { prefix: '55 00' } }]);
    const s = await openRingSession(jstyle2301, fake, { timers: { quietMs: 30, stallMs: 60 }, clock });
    const evs = await s.runtime.run(cmd);
    expect(errors(evs)).toContain('stall:hr');
    expect(decodeCursor(cursors(evs)[0])[0x55]).toMatchObject({ seq: 2 });
    await s.close();
  });

  it('quiet with zero packets: round stays at 2', async () => {
    const fake = new FakePeripheral(handshake);
    const s = await openRingSession(jstyle2301, fake, { clock });
    const p = jstyle2301.protocol;
    const st = p.begin!({ ...cmd, params: { ...cmd.params, nowMs: clock.now(), tzOffsetS: 0 } }, s.runtime.state).state;
    const r = p.timeout!(st, 'quiet');
    expect(r.done).toBe(true);
    expect(errors(r.events)).not.toContain('stall:hr');
    expect(decodeCursor(cursors(r.events)[0])[0x55]).toMatchObject({ seq: 2 });
    await s.close();
  });
});

describe('keepalive', () => {
  it('Jring declares its 15 s keepalive', () => {
    expect(jring.keepalive).toEqual({ command: jringKeepalive, intervalMs: JRING_KEEPALIVE_MS });
  });

  it('is written every interval while open, also during a command in flight, and stops on close', async () => {
    const fake = new RecordingFake();
    const s = await openRingSession(stubFamily({ keepalive: { command: { op: 'ping' }, intervalMs: 25 } }), fake, { timers: { stallMs: 200 } });
    const pings = (): number => fake.writes.filter((w) => w[0] === 0xaa).length;
    await s.runtime.run({ op: 'read' }); // 200 ms of waiting: the keepalive is not held back by the busy command
    expect(pings()).toBeGreaterThanOrEqual(4);
    await sleep(80);
    await s.close();
    const closed = pings();
    await sleep(80);
    expect(pings()).toBe(closed);
  });

  it('families without one write nothing on their own', async () => {
    const fake = new RecordingFake();
    const s = await openRingSession(stubFamily(), fake);
    await sleep(60);
    expect(fake.writes).toEqual([]);
    await s.close();
  });
});
