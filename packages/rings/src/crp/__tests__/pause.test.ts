// @vitest-environment node
/**
 * A history frame is 152 bytes, eight notifications on the default MTU. The quiet timer must never end a read while a
 * frame is half in: the read keeps waiting through a pause longer than the settle, and a frame that really stops short
 * ends as `partial:<stream>` with the stream's cursor left where it was (the J-Style release blocker of 2026-10-04).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openRingSession } from '../../session';
import { FakePeripheral } from '../../testing';
import { fromHex, type RingEvent } from '../../types';
import { crp } from '../family';
import { QUIET_MS, SILENCE_MAX_MS, type CrpState } from '../protocol';

const FIX = join(__dirname, '../../../../..', 'qa/fixtures/rings/crp');
type Step = { expectWrite?: string; prefix?: boolean; notify?: string[] };
const sessions = (JSON.parse(readFileSync(join(FIX, 'sessions.json'), 'utf8')) as { sessions: Array<{ name: string; steps: Step[] }> }).sessions;
const steps = (prefix: string): Step[] => sessions.find((s) => s.name.startsWith(prefix))!.steps.filter((s) => s.expectWrite !== undefined);
const handshake = steps('connect handshake').slice(0, 13).map((s) => ({ expect: s.prefix ? { prefix: s.expectWrite! } : s.expectWrite!, reply: s.notify }));
const [f0, f1] = steps('history: HR walks two frames');
const chunks = (hex: string): Uint8Array[] => {
  const b = fromHex(hex);
  return Array.from({ length: Math.ceil(b.length / 20) }, (_, i) => b.subarray(i * 20, i * 20 + 20));
};
const QUIET = 30;
const fast = { timers: { quietMs: QUIET, stallMs: 200 }, clock: { now: () => Date.parse('2026-07-24T12:00:00Z'), tzOffsetS: () => 0 } };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const hr = (evs: RingEvent[]): number[] => evs.flatMap((e) => (e.type === 'sample' && e.stream === 'hr' ? [e.value] : []));
const status = (evs: RingEvent[], key: string): unknown[] => evs.flatMap((e) => (e.type === 'status' && e.key === key ? [e.value] : []));
const READ = { op: 'history_hr', params: { day: 0, frameIndex: 0, stream: 'hr', prev: 'd:2026-07-23' } };

describe('CRP history read across a mid-frame pause', () => {
  it('keeps waiting through a pause longer than the settle and gets the whole frame, then walks on', async () => {
    const parts = chunks(f0!.notify![0]!);
    const fake = new FakePeripheral([...handshake, { expect: f0!.expectWrite!, reply: parts.slice(0, 3) }, { expect: f1!.expectWrite!, reply: f1!.notify }]);
    const s = await openRingSession(crp, fake, fast);
    const evs: RingEvent[] = [];
    const read = (async () => {
      for await (const e of s.runtime.exchange(READ)) evs.push(e);
    })();
    await sleep(QUIET * 2.5); // silent for 2.5 settle periods mid-frame, then the ring goes on
    for (const p of parts.slice(3)) fake.notify(p);
    await read;
    expect(hr(evs)).toEqual([61, 77]);
    expect(status(evs, 'error')).toEqual([]);
    expect(status(evs, 'cursor')).toEqual(['d:2026-07-23']);
    expect(fake.remaining).toBe(0);
    expect(fake.errors).toEqual([]);
    await s.close();
  });

  it('a frame that stays short ends as a partial read: error reported, cursor not moved', async () => {
    const parts = chunks(f0!.notify![0]!);
    const fake = new FakePeripheral([...handshake, { expect: f0!.expectWrite!, reply: parts.slice(0, 3) }]);
    const s = await openRingSession(crp, fake, fast);
    const evs: RingEvent[] = [];
    const t0 = Date.now();
    for await (const e of s.runtime.exchange(READ)) evs.push(e);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(QUIET * (Math.ceil(SILENCE_MAX_MS / QUIET_MS) - 1));
    expect(hr(evs)).toEqual([]);
    expect(evs.filter((e) => e.type === 'status')).toEqual([{ type: 'status', key: 'error', value: 'partial:hr', stream: 'hr' }]);
    expect((s.runtime.state as CrpState).cursors.hr).toBe('d:2026-07-23');
    expect(fake.writes).toHaveLength(14); // no follow-up: frame 0 never completed
    await s.close();
  });
});
