/**
 * (r069 sync) Gauge's local data meets the server's: the newest "sent" time, the queue while the snapshot is recent, and
 * today's steps with the ring's newer total, superseded once the server has it and never added to it.
 */
import { describe, expect, it } from 'vitest';
import type { GaugeLocalSnapshot } from '@/platform/gaugeLocal';
import { LOCAL_FRESH_MS, lastSentOf, stepsUpdatedAt, waitingOf, withLocalHeartPoint, withLocalHeartRate, withLocalSteps } from '../localFill';
import { sentText } from '../model';
import type { GaugeDaily } from '../types';

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

  it('"Updated" is the time of the phone\'s ring count only while that count is the total shown', () => {
    const local = snap({ ringSteps: 6000 });
    const phoneAt = Date.parse('2026-10-29T11:58:00.000Z');
    const serverAt = Date.parse('2026-10-29T11:40:00.000Z');
    const day = { ringDailyTotal: 5000, headlinePolicy: 'atLeast' as const, headline: 5200 };
    expect(stepsUpdatedAt(serverAt, { date: '2026-10-29', local, stepsDay: day })).toBe(phoneAt);
    // the server's timeline is already past the phone's write: its time stands
    expect(stepsUpdatedAt(phoneAt + 60_000, { date: '2026-10-29', local, stepsDay: day })).toBe(phoneAt + 60_000);
    // the upload landed, the server's own total is higher, the day is placed in time, another day, no local time
    expect(stepsUpdatedAt(serverAt, { date: '2026-10-29', local, stepsDay: { ...day, ringDailyTotal: 6000 } })).toBe(serverAt);
    expect(stepsUpdatedAt(serverAt, { date: '2026-10-29', local, stepsDay: { ...day, headline: 7000 } })).toBe(serverAt);
    expect(stepsUpdatedAt(serverAt, { date: '2026-10-29', local, stepsDay: { ...day, headlinePolicy: 'located' } })).toBe(serverAt);
    expect(stepsUpdatedAt(serverAt, { date: '2026-10-28', local, stepsDay: day })).toBe(serverAt);
    expect(stepsUpdatedAt(serverAt, { date: '2026-10-29', local: { ...local, today: { ...local.today!, ringStepsAt: null } }, stepsDay: day })).toBe(serverAt);
    expect(stepsUpdatedAt(serverAt, { date: '2026-10-29', local: null, stepsDay: day })).toBe(serverAt);
    // nothing counted on the server yet today
    expect(stepsUpdatedAt(null, { date: '2026-10-29', local, stepsDay: null })).toBe(phoneAt);
  });

  it('the latest heart rate is the phone\'s reading only while it is newer than the server\'s, and nothing else changes', () => {
    // local clock times, so the day of a reading is the same in any zone the suite runs in
    const at = (h: number, m: number, d = 29) => new Date(2026, 9, d, h, m).toISOString();
    const hr = { unit: 'bpm', count: 40, mean: 68, min: 51, max: 122, latest: { at: at(11, 40), value: 64 }, medianGapS: 300 };
    const empty: GaugeDaily = {
      date: '2026-10-29', source: 'lumen_health', timeZone: 'UTC', installations: [],
      freshness: { lastUploadAt: null, lastReadingAt: null, minutesSinceLastUpload: null, minutesSinceLastReading: null },
    };
    const daily: GaugeDaily = { ...empty, metrics: { hr, spo2: { unit: '%', count: 3, mean: 97, min: 96, max: 98, latest: { at: at(9, 0), value: 97 } } } };
    const fresh = withLocalHeartRate(daily, { date: '2026-10-29', latestHr: { bpm: 71, at: at(11, 58) } })!;
    expect(fresh.metrics!.hr).toEqual({ ...hr, latest: { at: at(11, 58), value: 71, provisional: true } });
    // the server's own figures and every other metric are the same objects, and the server's answer is not written to
    expect(fresh.metrics!.spo2).toBe(daily.metrics!.spo2);
    expect(daily.metrics!.hr).toBe(hr);
    expect(hr.latest).toEqual({ at: at(11, 40), value: 64 });
    // the server answered with this reading, or a newer one: its summary stands, untouched
    expect(withLocalHeartRate(daily, { date: '2026-10-29', latestHr: { bpm: 64, at: at(11, 40) } })).toBe(daily);
    expect(withLocalHeartRate(daily, { date: '2026-10-29', latestHr: { bpm: 90, at: at(11, 10) } })).toBe(daily);
    // the phone stamps a live reading to the millisecond and the server answers in whole seconds: still that reading
    const live = (plusMs: number) => new Date(Date.parse(at(11, 40)) + plusMs).toISOString();
    expect(withLocalHeartRate(daily, { date: '2026-10-29', latestHr: { bpm: 64, at: live(412) } })).toBe(daily);
    expect(withLocalHeartRate(daily, { date: '2026-10-29', latestHr: { bpm: 64, at: live(999) } })).toBe(daily);
    // the next second is a newer reading
    expect(withLocalHeartRate(daily, { date: '2026-10-29', latestHr: { bpm: 66, at: live(1000) } })!.metrics!.hr).toMatchObject({ latest: { at: live(1000), value: 66, provisional: true } });
    // a reading of another day says nothing about this one; nor does no reading, or a time that is not one
    expect(withLocalHeartRate(daily, { date: '2026-10-29', latestHr: { bpm: 71, at: at(0, 5, 30) } })).toBe(daily);
    expect(withLocalHeartRate(daily, { date: '2026-10-28', latestHr: { bpm: 71, at: at(11, 58) } })).toBe(daily);
    expect(withLocalHeartRate(daily, { date: '2026-10-29', latestHr: null })).toBe(daily);
    expect(withLocalHeartRate(daily, { date: '2026-10-29', latestHr: { bpm: 71, at: 'soon' } })).toBe(daily);
    // the server's answer is still what the screen waits for
    expect(withLocalHeartRate(null, { date: '2026-10-29', latestHr: { bpm: 71, at: at(11, 58) } })).toBeNull();
    // the day's first reading: shown, with no figure made up around it
    const first = withLocalHeartRate(empty, { date: '2026-10-29', latestHr: { bpm: 58, at: at(0, 20) } })!;
    expect(first).toEqual({ ...empty, metrics: { hr: first.metrics!.hr } });
    expect(first.metrics!.hr).toEqual({ unit: 'bpm', count: 0, mean: null, min: null, max: null, latest: { at: at(0, 20), value: 58, provisional: true } });
  });

  it('a day\'s heart-rate series ends with the phone\'s reading only while it is newer than the server\'s last point', () => {
    const at = (h: number, m: number, plusMs = 0) => new Date(new Date(2026, 9, 29, h, m).getTime() + plusMs).toISOString();
    // the server's points carry whole seconds and its own offset; a point without a value is still a time it answered for
    const serverAt = (h: number, m: number) => at(h, m).replace(/\.\d{3}Z$/, '+00:00');
    const points = [
      { at: serverAt(11, 20), value: 61, provenance: 'ring' },
      { at: serverAt(11, 40), value: 64, provenance: 'ring' },
      { at: serverAt(11, 30), value: null, provenance: 'ring' },
    ];
    const before = structuredClone(points);
    const filled = withLocalHeartPoint(points, { bpm: 71, at: at(11, 58, 412) });
    expect(filled).toEqual([...points, { at: at(11, 58, 412), value: 71, provenance: null, provisional: true }]);
    // the server's points are the same objects, in the order they came, and its answer is not written to
    expect(filled.slice(0, 3).every((p, i) => p === points[i])).toBe(true);
    expect(points).toEqual(before);
    // the server answered with this reading (its time lost the milliseconds on the way), or a newer one
    expect(withLocalHeartPoint(points, { bpm: 64, at: at(11, 40, 412) })).toBe(points);
    expect(withLocalHeartPoint(points, { bpm: 90, at: at(11, 10) })).toBe(points);
    // no reading, or a time that is not one
    expect(withLocalHeartPoint(points, null)).toBe(points);
    expect(withLocalHeartPoint(points, { bpm: 71, at: 'soon' })).toBe(points);
    // the day's first reading
    expect(withLocalHeartPoint([], { bpm: 58, at: at(0, 20) })).toEqual([{ at: at(0, 20), value: 58, provenance: null, provisional: true }]);
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
