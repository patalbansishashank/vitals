// @vitest-environment node
/**
 * Every session of `qa/fixtures/rings/ycbt/sessions.json` replayed through `openRingSession` over a scripted ring.
 *
 * Fixture ops map onto the session API: `runStartup` = open (the handshake is Lumen's startup batch) then `sync`;
 * `refresh` = `sync`; `history`/`syncVitalsHistory`/`syncSleepNow` = one `history` exchange; `historyCancel` = abort, then
 * the `historyCancel` command; `engineReset` and `reconnect` = a new session; `liveMeasurement` = `spot()` when the
 * fixture is a spot run, else a single command. Lumen's fixtures assume its FIFO batch order; where this port's order
 * differs (it waits for the `02 00`/`02 01` replies and reads types granted late in another order), the set of writes
 * is asserted instead, and `DEVIATIONS` says why.
 */
import { describe, expect, it } from 'vitest';
import { openRingSession } from '../../session';
import { RingError, toHex, type RingCommand, type RingEvent, type RingSession, type SessionRuntime } from '../../types';
import { frameLogical, topologyFailure } from '../commands';
import { ycbt } from '../family';
import { planYcbtSync, type YcbtState } from '../protocol';
import { checkEvents, fixture, kotlinOf, type Expected } from './helpers';
import { ScriptedRing, type PoolEntry } from './ring';

interface Step {
  send?: RingCommand;
  expectWrite?: string;
  expectWrites?: string[];
  notify?: string[];
  expectEvents?: Expected[];
  match?: string;
  expectNoWrite?: boolean;
  timer?: string;
  afterMs?: number;
  reconnect?: string;
  gatt?: Array<{ characteristic: string; localEnabled?: boolean; hasCccd?: boolean }>;
  expectTopologyFailure?: { contains: string } | null;
}
interface Session { name: string; context: { layer: string; kind?: 'hr' | 'spo2' }; steps: Step[] }

const sessions = fixture<{ sessions: Session[] }>('sessions.json').sessions;
const NOW = Date.parse('2026-07-06T12:34:14Z');
const opts = { timers: { quietMs: 30, stallMs: 80 }, clock: { now: () => NOW, tzOffsetS: () => 0 }, profile: { metric: true, sex: 'other' as const, ageYears: 25, heightCm: 175, weightKg: 70 } };
const DEVICE_INFO = '02 00 1e 00 a3 00 12 01 00 64 00 01 00 03 00 00 00 00 01 00 00 00 01 00 00 00 00 00 ef 10';
const CANNED = { '02 00 08 00 47 43 6f ec': [DEVICE_INFO], '02 01 08 00 47 46 9b 16': [toHex(frameLogical([2, 1, ...new Array<number>(14).fill(0)]))] };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Where this port and Lumen's test differ on purpose: `order: 'set'` compares the writes as a multiset. */
const DEVIATIONS: Record<string, { order?: 'set'; unused?: string[]; note: string }> = {
  'connect: subscription gate, post-subscription handshake, startup with a SupportFunction reply (R10M profile)': {
    order: 'set', note: 'the port waits for the bitmap, so 01 20 joins the monitor batch and the granted types are read in catalog order',
  },
  'support bitmap appends only declared optional history': { order: 'set', note: 'a late grant is read right after the type in flight, not at the end of the walk' },
  'repeated support bitmap does not duplicate optional history': { order: 'set', note: 'as above' },
  'refresh uses the complete capability-filtered history catalog': { order: 'set', note: 'as above' },
  'late HRV capability requeues body data and combined history sources': {
    unused: ['05 33 06 00 d6 0e', '05 09 06 00 b2 0c'], note: 'a grant while idle switches the monitor on; the next sync reads the new types (asserted below)',
  },
  'warm pass omits configuration but preserves supported whole-type history requests': {
    order: 'set', note: 'a later sync is Lumen\'s refresh (03 09 first, none after the walk); the reset is a new session, whose walk ends with it',
  },
  'full refresh requests live status before sport history': { order: 'set', note: 'the first sync after the handshake is the startup walk (03 09 after it)' },
  'connectionDidEnd abandons the in flight history transfer': {
    order: 'set', note: 'a refresh while a walk runs is a busy error here, not a lone 03 09; each startup walk ends with its own 03 09',
  },
  'append preserves the active transfer and adds new types once': {
    unused: ['05 04 06 00 e3 4e'], note: 'the session API cannot add types to a running read; appends come only from a late bitmap',
  },
};

async function replay(s: Session): Promise<{ ring: ScriptedRing; events: RingEvent[]; busy: number; first?: RingSession & { runtime: SessionRuntime } }> {
  const pool: PoolEntry[] = s.steps.flatMap((st) =>
    st.expectWrite ? [{ hex: st.expectWrite, replies: st.notify ?? [], used: false }] : (st.expectWrites ?? []).map((hex) => ({ hex, replies: [], used: false })),
  );
  const startup = s.steps.some((st) => st.send?.op === 'runStartup') || s.name.startsWith('connect:');
  const ring = new ScriptedRing(pool, 'R10M 1A2B');
  const events: RingEvent[] = [];
  const running: Array<Promise<void>> = [];
  let busy = 0;
  let ac = new AbortController();
  let sess: (RingSession & { runtime: SessionRuntime }) | undefined;
  let first: typeof sess;
  let spot: Promise<void> | undefined;
  const bg = (it: () => AsyncIterable<RingEvent>): Promise<void> => {
    const p = (async () => {
      try {
        for await (const e of it()) events.push(e);
      } catch (e) {
        if (e instanceof RingError && e.code === 'busy') busy++;
        else if (!(e instanceof RingError && (e.code === 'aborted' || e.code === 'closed'))) throw e;
      }
    })();
    running.push(p);
    return p;
  };
  const open = async (): Promise<RingSession & { runtime: SessionRuntime }> => {
    if (sess) return sess;
    ring.connected = true;
    ring.prelude = startup ? 'post-subscription' : 'all';
    ring.canned = CANNED;
    sess = await openRingSession(ycbt, ring, opts);
    ring.prelude = 'none';
    first ??= sess;
    events.push(...sess.handshakeEvents);
    sess.on((e) => e.type !== 'disconnected' && events.push(e));
    return sess;
  };
  const drop = async (): Promise<void> => {
    ac.abort();
    await Promise.all(running.splice(0));
    await sess?.close();
    sess = undefined;
    ac = new AbortController();
  };
  const seen = new Map<string, number>();
  /** Waits until every write the fixture expects up to this step has been made (repeated frames counted). */
  const waitWrites = async (hexes: string[]): Promise<void> => {
    for (const h of hexes) seen.set(h, (seen.get(h) ?? 0) + 1);
    const ok = (): boolean => hexes.every((h) => ring.scripted.filter((x) => x === h).length >= seen.get(h)!);
    for (let i = 0; i < 300 && !ok(); i++) await sleep(3);
  };
  const history = (types: string): Promise<void> => bg(() => sess!.runtime.exchange({ op: 'history', params: { types } }, ac.signal));

  if (s.context.layer === 'gate') return { ring, events, busy };
  for (const st of s.steps) {
    if (st.reconnect) await drop();
    const op = st.send?.op;
    await sleep(5);
    if (op) await open();
    const p = st.send?.params ?? {};
    switch (op) {
      case 'runStartup':
      case 'refresh':
        void bg(() => sess!.sync({}, () => {}, ac.signal));
        break;
      case 'history':
      case 'historyAppend':
        void history(String(p.types));
        break;
      case 'syncVitalsHistory':
        void history('heart,all');
        break;
      case 'syncSleepNow':
      case 'querySleep':
        void history('sleep');
        break;
      case 'historyCancel':
        ac.abort();
        await Promise.all(running.splice(0));
        ac = new AbortController();
        await sess!.runtime.run({ op: 'historyCancel' });
        break;
      case 'engineReset':
        await drop();
        break;
      case 'liveMeasurement':
        if (s.context.kind && p.enable) spot = bg(() => sess!.spot(s.context.kind!, ac.signal));
        else if (s.context.kind && spot) await spot;
        else await sess!.runtime.run(st.send!);
        break;
    }
    await waitWrites(st.expectWrite ? [st.expectWrite] : (st.expectWrites ?? []));
    if (st.timer) await sleep(150); // the port's watchdog runs on the session timers (quiet 30 ms, stall 80 ms)
    if (st.notify && !st.expectWrite) {
      await open();
      for (const n of st.notify) ring.notify(n);
    }
    if (st.expectNoWrite) {
      const before = ring.writes.length - ring.ambient.length;
      await sleep(st.timer ? 120 : 40);
      expect(ring.writes.length - ring.ambient.length, `${s.name}: nothing written`).toBe(before);
    }
  }
  for (let i = 0; i < 400 && ring.unused.length && !DEVIATIONS[s.name]?.unused; i++) await sleep(3);
  await sleep(DEVIATIONS[s.name]?.unused ? 250 : 20);
  const last = sess;
  await drop();
  return { ring, events, busy, first: first ?? last };
}

describe('YCBT sessions over the scripted ring', () => {
  it('has the 47 sessions', () => expect(sessions.length).toBe(47));

  for (const s of sessions) {
    it(s.name, async () => {
      if (s.context.layer === 'gate') {
        // Lumen's `SubscriptionSetupGate`: both indication channels or no connection.
        const gatt = s.steps.find((x) => x.gatt)!;
        const failure = topologyFailure(gatt.gatt!);
        if (gatt.expectTopologyFailure) expect(failure).toContain(gatt.expectTopologyFailure.contains);
        else expect(failure).toBeNull();
        return;
      }
      const dev = DEVIATIONS[s.name];
      const { ring, events, first, busy } = await replay(s);
      // A second start while a read runs writes nothing: here it is the session's busy error.
      if (/reentrant|ignored while a transfer/.test(s.name)) expect(busy).toBeGreaterThan(0);
      expect(ring.errors, 'unexpected writes').toEqual([]);
      expect(ring.unused, 'fixture writes never made').toEqual(dev?.unused ?? []);
      const fixtureOrder = ring.pool.filter((p) => p.used).map((p) => p.hex);
      if (dev?.order === 'set') expect([...ring.scripted].sort()).toEqual([...fixtureOrder].sort());
      else expect(ring.scripted).toEqual(fixtureOrder);
      const shaped = events.map(kotlinOf).filter((e): e is Expected => e !== null);
      for (const st of s.steps) if (st.expectEvents?.length) checkEvents(shaped, st.expectEvents, 'contains', s.name);
      const rejected = s.steps.flatMap((st) => st.expectEvents ?? []).filter((e) => e.kotlin === 'MeasurementRejected' && !e.absent).length;
      expect(shaped.filter((e) => e.kotlin === 'MeasurementRejected').length, 'refusals paired once').toBe(rejected);
      if (s.name.startsWith('connect:')) expect(first!.info()).toEqual({ firmware: '1.18', battery: 100, model: 'R10M', clockOffsetS: 0 });
      if (dev?.unused && s.name.startsWith('late HRV')) {
        const st = first!.runtime.state as YcbtState;
        expect(planYcbtSync({}, st).filter((c) => c.op === 'history').map((c) => c.params?.types)).toEqual(['sport', 'sleep', 'heart', 'all', 'body_data']);
      }
    }, 10_000);
  }
});
