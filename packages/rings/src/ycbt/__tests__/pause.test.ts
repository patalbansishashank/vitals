// @vitest-environment node
/**
 * A history transfer that pauses after its header must not end silently: the ring owes data frames. The read keeps
 * waiting through quiet periods (up to SILENCE_MAX_MS of silence in all) and, if the rest never comes, ends with
 * `status:error partial:<stream>`, no acknowledgement and no cursor for that stream, then moves to the next type.
 */
import { describe, expect, it } from 'vitest';
import { openRingSession } from '../../session';
import { toHex, type RingEvent } from '../../types';
import { crc16, frameLogical } from '../commands';
import { ycbt } from '../family';
import { QUIET_MS, SILENCE_MAX_MS } from '../protocol';
import { ScriptedRing } from './ring';

const QUIET = 30;
const START_NOW = Date.parse('2026-07-06T12:34:14Z');
let notificationNow = START_NOW;
const opts = { timers: { quietMs: QUIET, stallMs: 200 }, clock: { now: () => notificationNow, tzOffsetS: () => 0 } };
const f = (...b: number[]): string => toHex(frameLogical(b));
const REC1 = [0x1c, 0xf0, 0xde, 0x31, 0x00, 0x47];
const REC2 = [0x1a, 0xfe, 0xde, 0x31, 0x00, 0x42];
const crc = crc16([...REC1, ...REC2]);
const HEADER = '05 06 10 00 02 00 01 00 00 00 0c 00 00 00 fe 41'; // 2 records, 12 bytes
const DATA1 = f(0x05, 0x15, ...REC1);
const DATA2 = f(0x05, 0x15, ...REC2);
const TERMINAL = f(0x05, 0x80, 2, 0, 12, 0, crc & 0xff, crc >> 8);
const ACK = f(0x05, 0x80, 0x00);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const hr = (evs: RingEvent[]): number[] => evs.flatMap((e) => (e.type === 'sample' && e.stream === 'hr' ? [e.value] : []));
const status = (evs: RingEvent[], key: string): string[] => evs.flatMap((e) => (e.type === 'status' && e.key === key ? [`${e.stream ?? ''}=${e.value}`] : []));

async function open(pool: Array<{ hex: string; replies: string[] }>): Promise<{ ring: ScriptedRing; s: Awaited<ReturnType<typeof openRingSession>> }> {
  notificationNow = START_NOW;
  const ring = new ScriptedRing(pool.map((p) => ({ ...p, used: false })), 'R10M 1A2B');
  ring.prelude = 'all';
  const s = await openRingSession(ycbt, ring, opts);
  ring.prelude = 'none';
  return { ring, s };
}

describe('YCBT history read across a pause after the header', () => {
  it('waits through several quiet periods and gets the whole type', async () => {
    expect(SILENCE_MAX_MS / QUIET_MS).toBeGreaterThanOrEqual(6);
    const { ring, s } = await open([{ hex: '05 06 06 00 83 20', replies: [HEADER, DATA1] }, { hex: ACK, replies: [] }]);
    notificationNow = Date.parse('2026-07-07T00:34:14Z');
    const evs: RingEvent[] = [];
    const read = (async () => {
      // The captured records are late evening; use a synthetic host clock after those samples.
      for await (const e of s.runtime.exchange({ op: 'history', params: { types: 'heart', nowMs: START_NOW } })) evs.push(e);
    })();
    await sleep(QUIET * 3.3); // silent for more than three quiet periods, then the ring goes on
    ring.notify(DATA2);
    ring.notify(TERMINAL);
    await read;
    expect(hr(evs)).toEqual([71, 66]);
    expect(status(evs, 'error')).toEqual([]);
    expect(status(evs, 'cursor')).toEqual(['hr=d:2026-07-06']);
    expect(ring.scripted).toEqual(['05 06 06 00 83 20', ACK]);
    expect(ring.errors).toEqual([]);
    await s.close();
  });

  it('a transfer that stays short ends as partial: error, no acknowledgement, no cursor, next type asked', async () => {
    const { ring, s } = await open([{ hex: '05 06 06 00 83 20', replies: [HEADER, DATA1] }, { hex: '05 09 06 00 b2 0c', replies: ['05 09 07 00 00 bc 44'] }]);
    const t0 = Date.now();
    const evs: RingEvent[] = [];
    for await (const e of s.runtime.exchange({ op: 'history', params: { types: 'heart,all' } })) evs.push(e);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(QUIET * (SILENCE_MAX_MS / QUIET_MS - 1));
    expect(hr(evs)).toEqual([]); // nothing half-decoded
    expect(status(evs, 'error')).toEqual(['hr=partial:hr']);
    expect(status(evs, 'cursor').some((c) => c.startsWith('hr='))).toBe(false);
    expect(status(evs, 'cursor')).toContain('spo2=d:2026-07-06'); // the next type completed normally
    expect(ring.writes.some((w) => w.startsWith('05 80'))).toBe(false);
    expect(ring.scripted).toEqual(['05 06 06 00 83 20', '05 09 06 00 b2 0c']);
    expect(evs.some((e) => e.type === 'progress' && e.stage === 'history' && e.done)).toBe(true);
    await s.close();
  });

  it('no header at all is a stall: reported, skipped, no cursor', async () => {
    const { ring, s } = await open([{ hex: '05 06 06 00 83 20', replies: [] }]);
    const evs: RingEvent[] = [];
    for await (const e of s.runtime.exchange({ op: 'history', params: { types: 'heart' } })) evs.push(e);
    expect(status(evs, 'error')).toEqual(['hr=stall:hr']);
    expect(status(evs, 'cursor')).toEqual([]);
    expect(ring.errors).toEqual([]);
    await s.close();
  });
});
