// @vitest-environment node
/**
 * CRP sessions (`qa/fixtures/rings/crp/sessions.json`) over the fake peripheral and the session runner: the reroute rule,
 * the connect handshake, history walks, spot runs and the steps push. The fixtures keep Lumen's fire-and-forget order
 * (`order: kotlin-fifo`); this port waits for each read, so where the fixture says so writes are matched by content:
 * the fake is scripted in the port's order from the fixture's own steps, and the write multiset must equal the fixture's.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openRingSession } from '../../session';
import { FakePeripheral, type FakeStep } from '../../testing';
import { ANDROID_RECONNECT, DEFAULT_PRIORITY, toHex, type Advertisement, type RingEvent, type SyncCursor } from '../../types';
import { CRP_STEPS_NOTIFY, setTime } from '../commands';
import { crp, crpAfterDiscovery, matchCrp } from '../family';

const FIX = join(__dirname, '../../../../..', 'qa/fixtures/rings/crp');
interface Step { expectWrite?: string; prefix?: boolean; notify?: string[]; notifyChar?: string; delayMs?: number; atMs?: number }
interface Session {
  name: string;
  advertisement?: Advertisement;
  services?: string[];
  expectFamily?: string;
  expectSubscribe?: string[];
  context?: { nowMs: number; tzOffsetS: number };
  steps: Step[];
}
const sessions = (JSON.parse(readFileSync(join(FIX, 'sessions.json'), 'utf8')) as { sessions: Session[] }).sessions;
const session = (prefix: string): Session => {
  const s = sessions.find((x) => x.name.startsWith(prefix));
  if (!s) throw new Error(`no fixture session ${prefix}`);
  return s;
};

const NOW = 1_784_894_400_000; // 2026-07-24T12:00:00Z, the fixtures' clock
const clock = { now: () => NOW, tzOffsetS: () => 0 };
const timers = { quietMs: 30, stallMs: 80 };
const BATTERY = { '0000180f-0000-1000-8000-00805f9b34fb/00002a19-0000-1000-8000-00805f9b34fb': '55' };
/** Fixture delays are real ring seconds; replayed at 1/1000 so a 48 s SpO2 wait takes 48 ms. */
const toStep = (s: Step): FakeStep => ({
  expect: s.prefix ? { prefix: s.expectWrite! } : s.expectWrite!,
  reply: s.notify,
  channel: s.notifyChar,
  delayMs: s.delayMs ? s.delayMs / 1000 : undefined,
});
const writing = (s: Session): Step[] => s.steps.filter((x) => x.expectWrite !== undefined);
const HANDSHAKE = writing(session('connect handshake')).slice(0, 13);
const SET_TIME = toHex(setTime(NOW, 0));
const written = (fake: FakePeripheral, from = 0): string[] => fake.writes.slice(from).map(toHex);
/** The fixture's writes with the set_time prefix filled in from the clock. */
const fixtureWrites = (steps: Step[]): string[] => steps.map((x) => (x.prefix ? SET_TIME : x.expectWrite!));
/** Fixture steps reordered to the port's write order (each looked up by its frame; every step used once). */
function inOrder(steps: Step[], order: string[]): FakeStep[] {
  const pool = [...steps];
  return order.map((hex) => {
    const i = pool.findIndex((s) => (s.prefix ? hex.startsWith(s.expectWrite!) : s.expectWrite === hex));
    if (i < 0) throw new Error(`port writes ${hex}, which the fixture does not`);
    return toStep(pool.splice(i, 1)[0]!);
  });
}
const open = async (extra: FakeStep[] = [], opts: { name?: string; services?: string[] } = {}) => {
  const fake = new FakePeripheral([...HANDSHAKE.map(toStep), ...extra], { address: 'AA:BB:CC:DD:EE:03', reads: BATTERY, ...opts });
  return { fake, ring: await openRingSession(crp, fake, { timers, clock, spotCeilingMs: { hr: 30, spo2: 60 } }) };
};
const collect = async (it: AsyncIterable<RingEvent>): Promise<RingEvent[]> => {
  const out: RingEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
};
const statuses = (evs: RingEvent[], key: string): Array<[string | number, string | undefined]> =>
  evs.flatMap((e) => (e.type === 'status' && e.key === key ? [[e.value, e.stream] as [string | number, string | undefined]] : []));
const hex4 = (cmd: number, day: number, f: number): string => toHex(Uint8Array.of(0xfd, 0xda, 0x10, 0x08, 0x02, cmd, day, f));
const sleepQ = (day: number): string => toHex(Uint8Array.of(0xfd, 0xda, 0x10, 0x07, 0x02, 0x0e, day));
const YESTERDAY = 'd:2026-07-23';
const TIMING_AT_YESTERDAY: SyncCursor = { hr: YESTERDAY, spo2: YESTERDAY, hrv: YESTERDAY, 'vendor:stress': YESTERDAY, skin_temp: YESTERDAY };

describe('CRP recognition and the reroute rule', () => {
  it('SMART_RING with no service is not claimed at scan; fdda without a Colmi UART reroutes to CRP after connecting', () => {
    const s = session('reroute: advertised as SMART_RING');
    expect(matchCrp(s.advertisement!)).toBe(false);
    expect(crpAfterDiscovery(s.services!)).toBe(true);
    // The session subscribes fdd3 first (the handshake gate); 2a37 is left out on purpose.
    expect(crp.gatt.notify.map((n) => n.characteristic)).toEqual([s.expectSubscribe![1], s.expectSubscribe![0], s.expectSubscribe![2]]);
  });

  it('fdda next to a Colmi UART stays Colmi; fdda next to 56ff goes CRP, as the Kotlin does', () => {
    expect(crpAfterDiscovery(session('no reroute: fdda next to the Colmi').services!)).toBe(false);
    expect(crpAfterDiscovery(session('no reroute: fdda next to the jring').services!)).toBe(true);
    expect(crpAfterDiscovery(['0000180f-0000-1000-8000-00805f9b34fb'])).toBe(false);
    expect(crpAfterDiscovery(['0000FDDA-0000-1000-8000-00805F9B34FB'])).toBe(true);
  });

  it('scan match: an R100 name or the fdda service; R100 with a space is another family', () => {
    const ad = session('scan match: an R100').advertisement!;
    expect(matchCrp(ad)).toBe(true);
    expect(crp.modelFromAdvertisement?.(ad)).toBe('R100');
    expect(matchCrp({ name: 'R100', serviceUuids: [], manufacturerData: [] })).toBe(true);
    expect(matchCrp({ name: 'R100 1A2B', serviceUuids: [], manufacturerData: [] })).toBe(false);
    expect(matchCrp({ name: 'SMART_RING', serviceUuids: ['0000fdda-0000-1000-8000-00805f9b34fb'], manufacturerData: [] })).toBe(true);
    expect(crp.scan.optionalServices).toContain('0000fdda-0000-1000-8000-00805f9b34fb');
    expect(crp.scan.requestFilters).toEqual([{ services: ['0000fdda-0000-1000-8000-00805f9b34fb'] }, { namePrefix: 'R100' }]);
  });

  it('family values: Android reconnect, default link priority, tier C, decoder tag', () => {
    expect(crp.reconnect).toBe(ANDROID_RECONNECT);
    expect(crp.priority).toEqual(DEFAULT_PRIORITY);
    expect(crp.tier).toBe('C');
    expect(crp.decoderTag('MOY-R1K3-2.1.6')).toBe('crp/MOY-R1K3-2.1.6@1');
  });
});

describe('CRP connect', () => {
  it('rerouted ring: the handshake writes in Lumen order and fills HandshakeInfo', async () => {
    const s = session('reroute: advertised as SMART_RING');
    const fake = new FakePeripheral(writing(s).map(toStep), { name: 'SMART_RING', address: 'AA:BB:CC:DD:EE:03', reads: BATTERY, services: s.services });
    const ring = await openRingSession(crp, fake, { timers, clock });
    expect(ring.info()).toEqual({ firmware: 'MOY-R1K3-2.1.6', battery: 85, model: 'R11', clockOffsetS: 0 });
    expect(ring.identity).toEqual({ family: 'crp', model: 'R11', ringId: 'mac:aa:bb:cc:dd:ee:03', basis: 'mac' });
    expect(written(fake)).toEqual(fixtureWrites(writing(s)));
    expect(fake.errors).toEqual([]);
    expect(fake.remaining).toBe(0);
    await ring.close();
  });

  it('an R100 by name; no 3/3 reply falls back to the 2a26 string; a profile is pushed after set_time', async () => {
    const steps: FakeStep[] = [
      { expect: { prefix: 'fd da 10 0b 01 01' } },
      { expect: 'fd da 10 0b 01 00 b4 4b 1e 01 4d' },
      { expect: 'fd da 10 06 03 03' },
      ...HANDSHAKE.slice(2).map(toStep),
    ];
    const fake = new FakePeripheral(steps, { name: 'R100_1A2B', reads: { ...BATTERY, '0000180a-0000-1000-8000-00805f9b34fb/00002a26-0000-1000-8000-00805f9b34fb': '4d4f592d52324533' } });
    const ring = await openRingSession(crp, fake, { timers, clock, profile: { metric: true, sex: 'male', ageYears: 30, heightCm: 180, weightKg: 75 } });
    expect(ring.info()).toMatchObject({ firmware: 'MOY-R2E3', model: 'R100' });
    expect(fake.errors).toEqual([]);
    expect(fake.remaining).toBe(0);
    await ring.close();
  });

  it('first sync after connect: every vital walks its frames, sleep backfills six nights, cursors per stream', async () => {
    const s = session('connect handshake');
    const order = [
      hex4(0x0f, 0, 0), hex4(0x0f, 0, 1), hex4(0x11, 0, 0), hex4(0x11, 0, 1),
      hex4(0x10, 0, 0), hex4(0x10, 0, 1), hex4(0x10, 0, 2), hex4(0x10, 0, 3),
      hex4(0x2f, 0, 0), hex4(0x2f, 0, 1), hex4(0x16, 0, 0), hex4(0x16, 0, 1), hex4(0x16, 0, 2), hex4(0x16, 0, 3),
      sleepQ(6), sleepQ(5), sleepQ(4), sleepQ(3), sleepQ(2), sleepQ(1), sleepQ(0),
    ];
    const { fake, ring } = await open(inOrder(writing(s).slice(13), order));
    const evs = await collect(ring.sync(TIMING_AT_YESTERDAY, () => {}, new AbortController().signal));
    expect(written(fake).slice().sort()).toEqual(fixtureWrites(writing(s)).slice().sort());
    expect(fake.errors).toEqual([]);
    expect(fake.remaining).toBe(0);
    const hr = evs.filter((e) => e.type === 'sample' && e.stream === 'hr');
    expect(hr).toEqual([
      { type: 'sample', stream: 'hr', t: Date.parse('2026-07-24T00:10:00Z'), value: 61, unit: 'bpm', origin: 'history' },
      { type: 'sample', stream: 'hr', t: Date.parse('2026-07-24T02:30:00Z'), value: 77, unit: 'bpm', origin: 'history' },
    ]);
    expect(evs.filter((e) => e.type === 'sample' && e.origin === 'history').map((e) => e.type === 'sample' && e.stream).sort()).toEqual(['hr', 'hr', 'hrv', 'skin_temp']);
    const night = evs.find((e) => e.type === 'sleepEpochs');
    expect(night && night.type === 'sleepEpochs' && { start: night.start, n: night.stages.length }).toEqual({ start: Date.parse('2026-07-23T23:10:00Z'), n: 440 });
    expect(statuses(evs, 'error')).toEqual([]);
    const cursors = statuses(evs, 'cursor');
    for (const st of ['hr', 'spo2', 'hrv', 'vendor:stress', 'skin_temp']) expect(cursors.filter((c) => c[1] === st)).toEqual([[YESTERDAY, st]]);
    // Empty nights (no reply) are finished days too; the cursor walks up to yesterday, today stays open.
    expect(cursors.filter((c) => c[1] === 'sleep_stage').map((c) => c[0])).toEqual(['d:2026-07-18', 'd:2026-07-19', 'd:2026-07-20', 'd:2026-07-21', 'd:2026-07-22', YESTERDAY, YESTERDAY]);
    expect(evs.filter((e) => e.type === 'progress').at(-1)).toEqual({ type: 'progress', stage: 'sleep_stage', done: true });
    await ring.close();
  });

  it('a later pass on the same connection: clock and profile again, then today only (Lumen\'s second runStartup)', async () => {
    const s = session('second poll pass');
    const { fake, ring } = await open(writing(s).map(toStep));
    await ring.runtime.run({ op: 'set_time' });
    await ring.runtime.run({ op: 'set_user_info', params: { heightCm: 180, weightKg: 75, ageYears: 30, gender: 1, strideCm: 77 } });
    const evs = await collect(ring.sync({ ...TIMING_AT_YESTERDAY, sleep_stage: YESTERDAY }, () => {}, new AbortController().signal));
    expect(written(fake, 13)).toEqual(fixtureWrites(writing(s)));
    expect(fake.errors).toEqual([]);
    expect(statuses(evs, 'error')).toEqual([]);
    expect(statuses(evs, 'cursor')).toHaveLength(6);
    await ring.close();
  });
});

describe('CRP history walks', () => {
  const walk = async (prefix: string, op: string, stream: string) => {
    const s = session(prefix);
    const { fake, ring } = await open(writing(s).map(toStep));
    const evs = await collect(ring.runtime.exchange({ op, params: { day: 0, frameIndex: 0, stream, prev: YESTERDAY } }));
    await new Promise((r) => setTimeout(r, 40)); // nothing more may be written after the last frame
    expect(written(fake, 13)).toEqual(fixtureWrites(writing(s)));
    expect(fake.errors).toEqual([]);
    expect(fake.remaining).toBe(0);
    await ring.close();
    return evs;
  };

  it('HR walks two frames, then the cursor', async () => {
    const evs = await walk('history: HR walks two frames', 'history_hr', 'hr');
    expect(evs.filter((e) => e.type === 'sample').map((e) => e.type === 'sample' && [e.value, e.t])).toEqual([
      [61, Date.parse('2026-07-24T00:10:00Z')], [77, Date.parse('2026-07-24T02:30:00Z')],
    ]);
    expect(statuses(evs, 'cursor')).toEqual([[YESTERDAY, 'hr']]);
  });

  it('HRV walks four frames', async () => {
    const evs = await walk('history: HRV walks four frames', 'history_hrv', 'hrv');
    expect(statuses(evs, 'cursor')).toEqual([[YESTERDAY, 'hrv']]);
  });

  it('temperature walks four frames like HRV', async () => {
    const evs = await walk('history: temperature walks four', 'history_temp', 'skin_temp');
    expect(evs.filter((e) => e.type === 'sample').map((e) => e.type === 'sample' && [e.stream, e.value])).toEqual([['skin_temp', 36.3]]);
  });

  it('a next frame that never comes: one follow-up only, then partial and no cursor', async () => {
    const s = session('history: a repeated frame');
    const { fake, ring } = await open(writing(s).map(toStep));
    const evs = await collect(ring.runtime.exchange({ op: 'history_hr', params: { day: 0, frameIndex: 0, stream: 'hr' } }));
    expect(written(fake, 13)).toEqual(fixtureWrites(writing(s)));
    expect(statuses(evs, 'error')).toEqual([['partial:hr', 'hr']]);
    expect(statuses(evs, 'cursor')).toEqual([]);
    await ring.close();
  });

  it('the follow-up guard is keyed on the day', async () => {
    const s = session('history: the follow-up guard');
    const w = writing(s);
    const { fake, ring } = await open(inOrder(w, [w[0]!, w[2]!, w[1]!, w[3]!].map((x) => x.expectWrite!)));
    const a = await collect(ring.runtime.exchange({ op: 'history_hr', params: { day: 0, frameIndex: 0, stream: 'hr' } }));
    const b = await collect(ring.runtime.exchange({ op: 'history_hr', params: { day: 1, frameIndex: 0, stream: 'hr' } }));
    expect(written(fake, 13).sort()).toEqual(fixtureWrites(w).sort());
    expect(fake.errors).toEqual([]);
    expect([...statuses(a, 'error'), ...statuses(b, 'error')]).toEqual([['partial:hr', 'hr'], ['partial:hr', 'hr']]);
    await ring.close();
  });
});

describe('CRP spot and live', () => {
  const spot = async (prefix: string, kind: 'hr' | 'spo2') => {
    const s = session(prefix);
    const { fake, ring } = await open(writing(s).map(toStep));
    const evs = await collect(ring.spot(kind, new AbortController().signal));
    expect(written(fake, 13)).toEqual(fixtureWrites(writing(s)));
    expect(fake.errors).toEqual([]);
    expect(fake.remaining).toBe(0);
    await ring.close();
    return evs;
  };

  it('spot SpO2: one value, then the stop at once', async () => {
    expect(await spot('spot SpO2: one value', 'spo2')).toEqual([{ type: 'sample', stream: 'spo2', t: NOW, value: 96, unit: 'pct', origin: 'spot' }]);
  });

  it('spot SpO2: FF is no reading; the run goes to its ceiling', async () => {
    expect(await spot('spot SpO2: no reading', 'spo2')).toEqual([]);
  });

  it('spot SpO2: off the finger ends the run as not worn', async () => {
    expect(await spot('spot SpO2: ring not worn', 'spo2')).toEqual([{ type: 'status', key: 'error', value: 'not_worn' }]);
  });

  it('spot HR: start, reply, stop at the window', async () => {
    expect(await spot('spot HR', 'hr')).toEqual([{ type: 'sample', stream: 'hr', t: NOW, value: 72, unit: 'bpm', origin: 'spot' }]);
  });

  it('live HR writes 1/9 start and 1/9 stop', async () => {
    const { fake, ring } = await open([{ expect: 'fd da 10 07 01 09 01', reply: ['fd da 10 07 01 09 46'] }, { expect: 'fd da 10 07 01 09 00' }]);
    const ac = new AbortController();
    const evs: RingEvent[] = [];
    for await (const e of ring.liveHeartRate(ac.signal)) {
      evs.push(e);
      ac.abort();
    }
    expect(evs).toEqual([{ type: 'sample', stream: 'hr', t: NOW, value: 70, unit: 'bpm', origin: 'live' }]);
    expect(fake.remaining).toBe(0);
    await ring.close();
  });

  it('the fdd1 steps push needs no command', async () => {
    const s = session('steps push on fdd1');
    const { fake, ring } = await open();
    const pushed: RingEvent[] = [];
    ring.on((e) => e.type !== 'disconnected' && pushed.push(e));
    fake.notify(s.steps[0]!.notify![0]!, CRP_STEPS_NOTIFY);
    expect(pushed).toEqual([{ type: 'dailyTotal', localDay: Date.parse('2026-07-24T00:00:00Z'), steps: 1000, distanceM: 500, kcal: 42 }]);
    await ring.close();
  });
});
