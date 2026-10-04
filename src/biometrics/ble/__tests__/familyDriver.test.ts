import { describe, expect, it } from 'vitest';
import { RING_FAMILIES, jstyle2301 } from '@vitals/rings';
import type { BleLink, RingDecodedEvent } from '@/biometrics/core/ble/types';
import { HISTORY_CATALOG, command } from '@vitals/rings/jstyle2301/commands';
import { RecordedLink, type RecordedStep } from '../fakeLink';
import { familyDriver, jstyle2301Driver } from '../drivers';
import { BLE_DRIVERS, driverFor, getDriver } from '../registry';
import { BleSessionError, type SessionClock } from '../session';

const clock: SessionClock = { now: () => Date.UTC(2026, 8, 16, 10), tzOffsetS: () => 0 };
const opts = { clock, timers: { quietMs: 5, stallMs: 20 } };
const bcd = (v: number): number => (Math.floor(v / 10) << 4) | v % 10;
/** One 0x55 heart-rate record at 2026-09-<day> <h>:<min> UTC. */
const hrRec = (bpm: number, day: number, h: number, min: number): Uint8Array => Uint8Array.of(0x55, 0, 0, ...[26, 9, day, h, min, 0].map(bcd), bpm);
/** One 26-byte 0x51 day total for 2026-09-15: steps, distance (10 m units), kcal (×100). */
const dayTotal = Uint8Array.of(0x51, 0, bcd(26), bcd(9), bcd(15), 0xe1, 0x10, 0, 0, 0, 0, 0, 0, 30, 0, 0, 0, 0x10, 0x27, 0, 0, 0, 0, 0, 0, 0);
const v0525: RecordedStep[] = [
  { expect: command(0x27), reply: [Uint8Array.of(0x27, 0, 5, 2, 5)] },
  { expect: command(0x13), reply: [Uint8Array.of(0x13, 88)] },
];
const collect = async (it: AsyncIterable<RingDecodedEvent>): Promise<RingDecodedEvent[]> => {
  const out: RingDecodedEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
};
const never = new AbortController().signal;

describe('family drivers', () => {
  it('take the family\'s filters (service and maker marker, never a name), GATT map and label; keep the stored id and maker', () => {
    const { filters, optionalServices } = jstyle2301Driver.requestOptions;
    expect(filters).toEqual(jstyle2301.scan.requestFilters);
    expect(filters.some((f) => f.name !== undefined || f.namePrefix !== undefined)).toBe(false);
    expect(optionalServices).toEqual(expect.arrayContaining([...jstyle2301.scan.optionalServices, jstyle2301.gatt.service]));
    expect(jstyle2301Driver).toMatchObject({ id: 'jstyle2301', family: 'J-Style 2301', label: jstyle2301.label, streams: [...jstyle2301.streams] });
    expect(jstyle2301Driver.gatt).toEqual({ service: jstyle2301.gatt.service, write: jstyle2301.gatt.write, notify: jstyle2301.gatt.notify[0]!.characteristic });
    // a Colmi family keeps the id people's sources already carry; a family with none uses its own id and maker
    expect(familyDriver({ ...jstyle2301, id: 'colmi', maker: 'Colmi' })).toMatchObject({ id: 'colmi-r02', family: 'Colmi R02 (QRing)' });
    expect(familyDriver({ ...jstyle2301, id: 'crp', maker: 'CRP' })).toMatchObject({ id: 'crp', family: 'CRP' });
  });

  it('registry: one driver per family, J-Style first, stored ids resolve, J-Style is never matched by name', () => {
    expect(BLE_DRIVERS[0]).toBe(jstyle2301Driver);
    for (const f of RING_FAMILIES) expect(BLE_DRIVERS.filter((d) => d.label === f.label)).toHaveLength(1);
    expect(getDriver('jstyle2301')).toBe(jstyle2301Driver);
    expect(getDriver('colmi-r02')?.family).toBe('Colmi R02 (QRing)');
    expect(driverFor('Ring 2301')).toBeUndefined();
  });

  it('old protocol shape frames, decodes and plans like the family', () => {
    const p = jstyle2301Driver.protocol;
    expect(p.frame({ op: 'battery' })).toEqual([command(0x13)]);
    const st = p.begin!({ op: 'battery' }, p.initialState()).state;
    const r = p.ingest(Uint8Array.of(0x13, 64), st);
    expect(r.events).toEqual([{ type: 'status', key: 'battery', value: 64 }]);
    expect(r.done).toBe(true);
    expect(p.planSync({}).map((c) => c.params?.opcode)).toEqual(HISTORY_CATALOG.map((s) => s.opcode));
  });
});

describe('J-Style 2301 over the family session', () => {
  it('V0789: the battery the ring holds back before the passcode is asked for once, after it, in the handshake', async () => {
    const link = new RecordedLink([
      { expect: command(0x27), reply: [Uint8Array.of(0x27, 0, 7, 8, 9)] },
      { expect: { prefix: '3c' }, reply: [Uint8Array.of(0x3c, 1)] },
      { expect: command(0x13), reply: [Uint8Array.of(0x13, 77)] },
    ]);
    const s = await jstyle2301Driver.open(link, opts);
    expect(await s.info()).toEqual({ firmware: 'V0789', battery: 77, clockOffsetS: 0 });
    expect(link.writes.map((w) => w[0])).toEqual([0x27, 0x3c, 0x13]);
    expect(link.remaining).toBe(0);
    expect(link.errors).toEqual([]);
    await s.close();
    expect(link.connected).toBe(false);
  });

  it('V0525 answers the battery in the handshake: no second request', async () => {
    const link = new RecordedLink(v0525);
    const s = await jstyle2301Driver.open(link, opts);
    expect(await s.info()).toEqual({ firmware: 'V0525', battery: 88, clockOffsetS: 0 });
    expect(link.writes.map((w) => w[0])).toEqual([0x27, 0x13]);
    await s.close();
  });

  it('sync preserves day totals, cursors and clock drift while excluding future samples', async () => {
    const reply = (op: number): Uint8Array[] =>
      op === 0x55 ? [new Uint8Array([...hrRec(61, 16, 9, 1), ...hrRec(62, 16, 10, 10)]), Uint8Array.of(0x55, 0xff)]
      : op === 0x51 ? [dayTotal, Uint8Array.of(0x51, 0xff)]
      : [Uint8Array.of(op, 0xff)];
    const link = new RecordedLink([...v0525, ...HISTORY_CATALOG.map((s) => ({ expect: command(s.opcode, 0), reply: reply(s.opcode) }))]);
    const s = await jstyle2301Driver.open(link, opts);
    const progress: number[] = [];
    const evs = await collect(s.sync({}, (p) => progress.push(p), never));
    expect(link.errors).toEqual([]);
    expect(link.remaining).toBe(0);
    expect(new Set(evs.map((e) => e.type))).toEqual(new Set(['vendor', 'status', 'sample']));
    expect(evs.filter((e) => e.type === 'sample').map((e) => (e.type === 'sample' ? [e.stream, e.value, e.origin] : []))).toEqual([['hr', 61, 'history']]);
    expect(evs).toContainEqual({ type: 'vendor', key: 'daily_steps', t: Date.UTC(2026, 8, 15), value: 4321, unit: 'count' });
    expect(evs).toContainEqual({ type: 'status', key: 'clock_offset_s', value: 600, stream: 'hr' });
    const cursors = evs.filter((e) => e.type === 'status' && e.key === 'cursor');
    expect(cursors.map((e) => e.type === 'status' && e.stream)).toEqual(HISTORY_CATALOG.map((h) => h.stream));
    expect(cursors.every((e) => e.type === 'status' && typeof e.value === 'string' && e.value.startsWith('j1|'))).toBe(true);
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(1);
    await s.close();
  });

  it('readHistory takes the old (stream, since) arguments', async () => {
    // 0x54 was never read under this cursor, so it goes first
    const link = new RecordedLink([...v0525, { expect: command(0x54, 0), reply: [Uint8Array.of(0x54, 0xff)] }, { expect: command(0x55, 0), reply: [hrRec(70, 16, 9, 30), Uint8Array.of(0x55, 0xff)] }]);
    const s = await jstyle2301Driver.open(link, opts);
    const evs = await collect(s.readHistory('hr', 'j1|55.3.1789550000.more', never));
    expect(evs.filter((e) => e.type === 'sample')).toHaveLength(1);
    const last = evs.filter((e) => e.type === 'status' && e.key === 'cursor').at(-1);
    expect(last?.type === 'status' && String(last.value)).toMatch(/^j1\|54\.4\.\.end\|55\.4\.\d+\.end$/);
    expect(link.errors).toEqual([]);
    await s.close();
  });

  it('unknown firmware: history is blocked, info says why, and nothing more is asked of the ring', async () => {
    const link = new RecordedLink([{ expect: command(0x27), reply: [Uint8Array.of(0x27, 1, 2, 3, 4)] }, { expect: command(0x13) }]);
    const s = await jstyle2301Driver.open(link, opts);
    expect(await s.info()).toEqual({ firmware: 'V1234', clockOffsetS: 0, historyBlocked: 'unsupported_firmware:V1234' });
    expect(await collect(s.sync({}, () => {}, never))).toEqual([{ type: 'status', key: 'error', value: 'unsupported_firmware:V1234' }]);
    expect(link.writes.map((w) => w[0])).toEqual([0x27, 0x13]);
  });

  it('a link without a drop signal or reads still opens and closes', async () => {
    const rec = new RecordedLink(v0525);
    // every real link has a platform id (the identity never comes from the name)
    const plain: BleLink & { deviceId: string } = {
      deviceName: 'Plain',
      deviceId: 'plain-link',
      write: (s, c, b) => rec.write(s, c, b),
      subscribe: (s, c, cb) => rec.subscribe(s, c, cb),
      disconnect: () => rec.disconnect(),
    };
    const s = await jstyle2301Driver.open(plain, opts);
    expect((await s.info()).battery).toBe(88);
    await s.close();
    expect(rec.connected).toBe(false);
  });
});

describe('errors keep their codes as BleSessionError', () => {
  const expectBle = async (p: Promise<unknown>, code: string): Promise<void> => {
    const e = await p.then(() => undefined, (x: unknown) => x);
    expect(e).toBeInstanceOf(BleSessionError);
    expect((e as BleSessionError).code).toBe(code);
  };

  it('a refused passcode is auth_rejected and the link is let go', async () => {
    const link = new RecordedLink([{ expect: command(0x27), reply: [Uint8Array.of(0x27, 0, 7, 8, 9)] }, { expect: { prefix: '3c' }, reply: [Uint8Array.of(0x3c, 0)] }]);
    await expectBle(jstyle2301Driver.open(link, opts), 'auth_rejected');
    expect(link.writes.map((w) => w[0])).toEqual([0x27, 0x3c]);
    expect(link.connected).toBe(false);
  });

  it('a link that cannot subscribe is transport', async () => {
    class NoNotify extends RecordedLink {
      override async subscribe(): Promise<() => void> {
        throw new Error('notifications refused');
      }
    }
    const link = new NoNotify(v0525);
    await expectBle(jstyle2301Driver.open(link, opts), 'transport');
    expect(link.connected).toBe(false);
  });

  it('a drop mid-sync is disconnected, an aborted sync is aborted, a closed session is closed', async () => {
    const link = new RecordedLink([...v0525, { expect: command(0x51, 0), disconnectAfter: true }]);
    const s = await jstyle2301Driver.open(link, opts);
    await expectBle(collect(s.sync({}, () => {}, never)), 'disconnected');
    const ac = new AbortController();
    ac.abort();
    await expectBle(collect(s.sync({}, () => {}, ac.signal)), 'aborted');
    await s.close();
    await expectBle(collect(s.sync({}, () => {}, never)), 'closed');
    await expectBle(s.battery(), 'closed');
  });
});
