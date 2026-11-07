/**
 * (r069 sync) Gauge's local data meets the server's: the newest "sent" time, the queue while the snapshot is recent, and
 * today's steps with the ring's newer total, superseded once the server has it and never added to it.
 */
import { describe, expect, it } from 'vitest';
import type { GaugeLocalSnapshot } from '@/platform/gaugeLocal';
import { LOCAL_FRESH_MS, lastSentOf, waitingOf, withLocalSteps } from '../localFill';
import { sentText } from '../model';

const snap = (o: { pending?: number; lastSentAt?: string | null; ringSteps?: number | null; date?: string } = {}): GaugeLocalSnapshot => ({
  schema: 1, at: '2026-10-29T12:00:00.000Z', app: '2.8.7',
  upload: { paired: true, pending: o.pending ?? 0, lastSentAt: o.lastSentAt ?? null, lastError: null, lastErrorAt: null, retryAt: null, needsRepair: false },
  today: { date: o.date ?? '2026-10-29', ringSteps: o.ringSteps === undefined ? 6000 : o.ringSteps, ringStepsAt: '2026-10-29T11:58:00.000Z' },
});
const NOW = Date.parse('2026-10-29T12:00:00.000Z');

describe('local fill', () => {
  it('"Phone sent" is the newest of the server, the pulse and Gauge itself', () => {
    const pulse = { token: 'b.1.1', boot: 'b', uploads: 1, data: 1, lastUploadAt: '2026-10-29T11:50:00.000Z', dataAt: null };
    expect(lastSentOf('2026-10-29T11:40:00Z', { pulse: null, local: null })).toBe('2026-10-29T11:40:00Z');
    expect(lastSentOf('2026-10-29T11:40:00Z', { pulse, local: null })).toBe('2026-10-29T11:50:00.000Z');
    expect(lastSentOf('2026-10-29T11:40:00Z', { pulse, local: snap({ lastSentAt: '2026-10-29T11:55:00.000Z' }) })).toBe('2026-10-29T11:55:00.000Z');
    expect(lastSentOf(null, { pulse: null, local: null })).toBeNull();
  });

  it('the queue on the phone counts only while the snapshot is recent', () => {
    expect(waitingOf({ local: snap({ pending: 12 }), localAt: NOW - 1000 }, NOW)).toBe(12);
    expect(waitingOf({ local: snap({ pending: 12 }), localAt: NOW - LOCAL_FRESH_MS - 1 }, NOW)).toBe(0);
    expect(waitingOf({ local: null, localAt: null }, NOW)).toBe(0);
  });

  it('today\'s steps take the ring\'s newer total until the server has it, never summed, never under located', () => {
    const fused = { value: 5200, lineage: 'fused' as const };
    const day = { ringDailyTotal: 5000, headlinePolicy: 'atLeast' as const };
    // the phone's ring total is ahead of the server's: the D3 rule with the newer total, marked
    expect(withLocalSteps(fused, { date: '2026-10-29', local: snap({ ringSteps: 6000 }), stepsDay: day })).toEqual({ value: 6000, lineage: 'fused', provisional: true });
    // the upload landed: the server's ring total reached the phone's, its headline stands
    expect(withLocalSteps({ value: 6400, lineage: 'fused' }, { date: '2026-10-29', local: snap({ ringSteps: 6000 }), stepsDay: { ...day, ringDailyTotal: 6000 } })).toEqual({ value: 6400, lineage: 'fused' });
    // the server's headline is already higher (phone steps fused in): kept
    expect(withLocalSteps({ value: 7000, lineage: 'fused' }, { date: '2026-10-29', local: snap({ ringSteps: 6000 }), stepsDay: day })).toEqual({ value: 7000, lineage: 'fused' });
    expect(withLocalSteps(fused, { date: '2026-10-29', local: snap({ ringSteps: 6000 }), stepsDay: { ...day, headlinePolicy: 'located' } })).toBe(fused);
    expect(withLocalSteps(fused, { date: '2026-10-28', local: snap({ ringSteps: 6000 }), stepsDay: day })).toBe(fused);
    expect(withLocalSteps(fused, { date: '2026-10-29', local: snap({ ringSteps: null }), stepsDay: day })).toBe(fused);
    // nothing on the server yet for today
    expect(withLocalSteps(null, { date: '2026-10-29', local: snap({ ringSteps: 300 }), stepsDay: null })).toEqual({ value: 300, lineage: 'ring', provisional: true });
  });

  it('says when Phone sent on the clock, and what still waits', () => {
    const at = (h: number, m: number, dayOffset = 0) => new Date(2026, 9, 29 + dayOffset, h, m).getTime();
    const now = at(17, 30);
    expect(sentText(new Date(at(17, 16)).toISOString(), now)).toBe('Phone sent 17:16');
    expect(sentText(new Date(at(23, 10, -1)).toISOString(), now)).toBe('Phone sent yesterday 23:10');
    expect(sentText(new Date(at(9, 0, -3)).toISOString(), now)).toBe('Phone sent 3 days ago');
    expect(sentText(null, now)).toBe('The phone has not sent yet');
    expect(sentText(new Date(at(16, 40)).toISOString(), now, 37)).toBe('Phone sent 16:40 · 37 waiting on the phone');
  });
});
