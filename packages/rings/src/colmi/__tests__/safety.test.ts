// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { OP, civilDay, frame16 } from '../commands';
import { decodeHistory, decodeNormal, toRingEvents } from '../decoder';
import { colmi } from '../family';
import type { ColmiState } from '../protocol';

const NOW = Date.parse('2026-10-25T12:00:00Z');
const zone = { tz: 'Europe/Berlin', tzOffsetS: 3600, nowMs: NOW };

function assertPlausible(events: ReturnType<typeof toRingEvents>): void {
  for (const e of events) {
    if (e.type === 'sample') {
      expect(e.t).toBeLessThanOrEqual(NOW);
      if (e.stream === 'hr') expect(e.value).toBeGreaterThanOrEqual(25);
      if (e.stream === 'hr') expect(e.value).toBeLessThanOrEqual(250);
      if (e.stream === 'spo2') expect(e.value).toBeGreaterThanOrEqual(70);
      if (e.stream === 'spo2') expect(e.value).toBeLessThanOrEqual(100);
    }
    if (e.type === 'dailyTotal' || e.type === 'activityBucket') expect(e.steps).toBeGreaterThanOrEqual(0);
    if (e.type === 'sleepEpochs') {
      expect(e.stages.length).toBeLessThanOrEqual(1440);
      expect(e.start + e.stages.length * e.epochS * 1000).toBeLessThanOrEqual(NOW);
    }
  }
}

describe('Colmi malformed history safety', () => {
  it('anchors quarter-hour activity to Kotlin wall time after the autumn clock change', () => {
    const frame = frame16([OP.SYNC_ACTIVITY, 0x26, 0x10, 0x25, 12, 0, 0, 0, 0, 9, 0, 0, 0]);
    const decoded = decodeHistory(frame, { day: civilDay(2026, 10, 25), ...zone, slotMinutes: null });
    expect(decoded).toEqual([{ kotlin: 'ActivityBucket', steps: 9, distanceMeters: 0, t: Date.parse('2026-10-25T02:00:00Z') }]);
  });

  it('retains the Kotlin decoder activity window but does not publish its future bucket', () => {
    const frame = frame16([OP.SYNC_ACTIVITY, 0x26, 0x10, 0x25, 56, 0, 0, 0, 0, 9, 0, 0, 0]);
    const decoded = decodeHistory(frame, { day: civilDay(2026, 10, 25), ...zone, slotMinutes: null });
    expect(decoded).toHaveLength(1); // local 14:00 is 13:00Z, within Kotlin's +1 h window
    expect(toRingEvents(decoded, '', zone)).toEqual([]);
  });

  it('keeps RingEventBridge quarter-hour step and distance caps', () => {
    const valid = { kotlin: 'ActivityBucket' as const, steps: 5_000, distanceMeters: 6_000, t: NOW };
    expect(toRingEvents([valid], '', zone)).toHaveLength(1);
    expect(toRingEvents([{ ...valid, steps: 5_001 }], '', zone)).toEqual([]);
    expect(toRingEvents([{ ...valid, distanceMeters: 6_001 }], '', zone)).toEqual([]);
  });

  it('stamps live packets at receive time while a midnight history page stays on its requested day', () => {
    const started = Date.parse('2026-07-24T23:59:00Z');
    const later = Date.parse('2026-07-25T00:01:00Z');
    const first = colmi.protocol.ingest(frame16([OP.MANUAL_HEART_RATE, 1, 0, 75]), { ...colmi.protocol.initialState(), nowMs: started } as ColmiState, undefined, started);
    const second = colmi.protocol.ingest(frame16([OP.MANUAL_HEART_RATE, 1, 0, 76]), first.state, undefined, later);
    expect(first.events[0]).toMatchObject({ type: 'sample', t: started, value: 75 });
    expect(second.events[0]).toMatchObject({ type: 'sample', t: later, value: 76 });
    const begun = colmi.protocol.begin!({ op: 'history', params: { stage: 'hr', lastDay: 0, nowMs: started, tzOffsetS: 0 } }, colmi.protocol.initialState());
    const page = colmi.protocol.ingest(frame16([OP.SYNC_HEART_RATE, 1, 0, 0, 0, 0, 75]), begun.state, undefined, later);
    expect(page.events[0]).toMatchObject({ type: 'sample', t: Date.parse('2026-07-24T00:00:00Z'), value: 75 });
    expect((page.state as ColmiState).nowMs).toBe(started);
  });

  it('preserves raw Kotlin decoder values but drops impossible HR, oxygen and future samples at the public boundary', () => {
    const day = civilDay(2026, 10, 25);
    const hr = decodeHistory(frame16([OP.SYNC_HEART_RATE, 1, 0, 0, 0, 0, 255]), { day, ...zone, slotMinutes: 5 });
    expect(hr.some((d) => d.kotlin === 'HistoryMeasurement' && d.value === 255)).toBe(true);
    expect(toRingEvents(hr, '', zone)).toEqual([]);
    expect(toRingEvents([{ kotlin: 'HistoryMeasurement', kind_field: 'SPO2', value: 50, t: NOW }], '', zone)).toEqual([]);
    expect(toRingEvents([{ kotlin: 'HistoryMeasurement', kind_field: 'HEART_RATE', value: 75, t: NOW + 10 * 60_000 }], '', zone)).toEqual([]);
  });

  it('random valid and truncated notifications never throw or publish impossible values', () => {
    let seed = 0x7c01a;
    const next = (): number => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) >>> 24);
    let state = { ...colmi.protocol.initialState(), ...zone } as ColmiState;
    const day = civilDay(2026, 10, 25);
    for (let i = 0; i < 1000; i++) {
      const content = Uint8Array.from({ length: 15 }, next);
      content[0] = [OP.SYNC_HEART_RATE, OP.SYNC_STRESS, OP.SYNC_HRV, OP.SYNC_ACTIVITY, OP.MANUAL_HEART_RATE, OP.NOTIFICATION][i % 6]!;
      const frame = frame16([...content]);
      const cut = i % 17;
      const bytes = cut === 16 ? frame : frame.subarray(0, cut);
      const result = colmi.protocol.ingest(bytes, state);
      state = result.state as ColmiState;
      assertPlausible(result.events);
      const decoded = decodeHistory(frame, { day, ...zone, slotMinutes: 5 });
      assertPlausible(toRingEvents(decoded, '', zone));
      assertPlausible(toRingEvents(decodeNormal(frame, NOW), '', zone));
    }
  });
});
