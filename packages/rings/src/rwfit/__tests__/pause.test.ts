// @vitest-environment node
/**
 * A history reply that pauses mid-body must not be cut by the quiet or stall timer (the J-Style release blocker of
 * 2026-10-04): the read keeps waiting up to `SILENCE_MAX_MS` of silence in all, and a body that really stays short ends as
 * `status:error partial:<stream>` with no cursor, never silently.
 */
import { describe, expect, it } from 'vitest';
import { openRingSession } from '../../session';
import { FakePeripheral, type FakeStep } from '../../testing';
import { fromHex, toHex, uuid16, type RingEvent } from '../../types';
import { JL, jlFrame, jlHistoryTriple, xorChecksum } from '../codec';
import { rwfit } from '../family';
import { HISTORY_STALL_MS, QUIET_MS, SILENCE_MAX_MS } from '../protocol';
import { collect, utc } from './helpers';

const QUIET = 30;
const STALL = 80;
let notificationNow = utc.now();
const opts = { timers: { quietMs: QUIET, stallMs: STALL }, clock: { now: () => notificationNow, tzOffsetS: utc.tzOffsetS } };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const hrSamples = (evs: RingEvent[]): number => evs.filter((e) => e.type === 'sample' && e.stream === 'hr').length;
const statuses = (evs: RingEvent[], key: string): string[] => evs.flatMap((e) => (e.type === 'status' && e.key === key ? [String(e.value)] : []));

// ---------------------------------------------------------------- JL: one multi-packet body, header packet then raw continuations

const JL_SERVICES = [uuid16(0xa00a), uuid16(0xae00)];
const jlHandshake: FakeStep[] = [{ expect: toHex(jlFrame(JL.DEVICE_INFO)) }, { expect: { prefix: 'ab 01 00 09' } }, { expect: toHex(jlFrame(JL.BATTERY)) }];
/** Five heart-rate records 30 s apart (6 bytes each, epoch-2000 local seconds) in one `05 03 10` frame, cut into 20-byte packets. */
const body = Uint8Array.from([0, 1, 2, 3, 4].flatMap((i) => [0x2e, 0x45, 0xa1, 0x40 + i * 30, 60 + i, 0]));
const frame = jlFrame(jlHistoryTriple(0x03), body);
const packets = [frame.subarray(0, 20), frame.subarray(20)].map((p) => toHex(p));
const HR_READ = { op: 'history', params: { type: 'heart_rate', stream: 'hr', nowMs: utc.now() + 5 * 60_000 } };

describe('RWfit JL history read across a mid-body pause', () => {
  it('keeps waiting through a pause longer than the quiet timer and decodes the whole body', async () => {
    notificationNow = utc.now();
    const fake = new FakePeripheral([...jlHandshake, { expect: toHex(jlFrame(jlHistoryTriple(0x03))), reply: [packets[0]!] }], { services: JL_SERVICES });
    const s = await openRingSession(rwfit, fake, opts);
    notificationNow = utc.now() + 5 * 60_000;
    fake.script({ expect: 'ab 11 00 03 3d 11 05 03 10' }); // the ACK of the completed frame
    const read = collect(s.runtime.exchange(HR_READ));
    await sleep(QUIET * 4); // silent for several quiet periods, then the rest of the body
    fake.notify(packets[1]!);
    const evs = await read;
    expect(hrSamples(evs)).toBe(5);
    expect(statuses(evs, 'error')).toEqual([]);
    expect(statuses(evs, 'cursor')).toEqual([`rw1:${0x2e45a140 + 4 * 30 + 946_684_800}`]);
    expect(fake.errors).toEqual([]);
    expect(fake.remaining).toBe(0);
    await s.close();
  });

  it('a body that stays short ends as a partial read: error reported, no cursor', async () => {
    notificationNow = utc.now();
    const fake = new FakePeripheral([...jlHandshake, { expect: toHex(jlFrame(jlHistoryTriple(0x03))), reply: [packets[0]!] }], { services: JL_SERVICES });
    const s = await openRingSession(rwfit, fake, opts);
    notificationNow = utc.now() + 5 * 60_000;
    const t0 = Date.now();
    const evs = await collect(s.runtime.exchange({ ...HR_READ, params: { ...HR_READ.params, 'prev:hr': 'rw1:100' } }));
    expect(Date.now() - t0).toBeGreaterThanOrEqual(QUIET * (Math.ceil(SILENCE_MAX_MS / QUIET_MS) - 1));
    expect(hrSamples(evs)).toBe(0);
    expect(statuses(evs, 'error')).toEqual(['partial:hr']);
    expect(statuses(evs, 'cursor')).toEqual([]);
    await s.close();
  });
});

// ---------------------------------------------------------------- legacy: a two-chunk frame, each chunk ACKed

/** One chunk of a legacy multi-packet frame: flags bit 3, chunk length and XOR, then total and 1-based index. */
const chunk = (cmd: number, serial: number, total: number, index: number, data: Uint8Array): string =>
  toHex(Uint8Array.from([0x7e, 0x01, cmd, 0x08, data.length, serial >> 8, serial & 0xff, xorChecksum(data), 0, total, 0, index, ...data]));
const legacyHandshake: FakeStep[] = [{ expect: '7e 01 00 00 00 00 01 00' }, { expect: { prefix: '7e 01 21' } }, { expect: '7e 01 01 00 00 00 03 00' }];
const hrPayload = fromHex('66 b2 e4 c0 00 02 66 b2 e4 fc 48 66 b2 e5 38 58');

describe('RWfit legacy history read across a pause between chunks', () => {
  it('a pause longer than the stall timer after a chunk ACK does not end the read', async () => {
    notificationNow = utc.now();
    const fake = new FakePeripheral(
      [
        ...legacyHandshake,
        { expect: '7e 01 a3 00 00 00 04 00', reply: [chunk(0xa3, 1, 2, 1, hrPayload.subarray(0, 8))] },
        { expect: { prefix: '7e 01 ff 00 04 00 05' } },
      ],
      { services: [uuid16(0xa00a)] },
    );
    const s = await openRingSession(rwfit, fake, opts);
    notificationNow = utc.now() + 5 * 60_000;
    fake.script({ expect: { prefix: '7e 01 ff 00 04 00 06' } });
    const read = collect(s.runtime.exchange(HR_READ));
    // Longer than one stall, shorter than the bounded silence (the stall step counts HISTORY_STALL_MS against it).
    expect(HISTORY_STALL_MS * 2).toBeLessThanOrEqual(SILENCE_MAX_MS);
    await sleep(STALL + 40);
    fake.notify(chunk(0xa3, 2, 2, 2, hrPayload.subarray(8)));
    const evs = await read;
    expect(hrSamples(evs)).toBe(2);
    expect(statuses(evs, 'error')).toEqual([]);
    expect(statuses(evs, 'cursor')).toEqual(['rw1:1723000120']);
    expect(fake.errors).toEqual([]);
    expect(fake.remaining).toBe(0);
    await s.close();
  });
});
