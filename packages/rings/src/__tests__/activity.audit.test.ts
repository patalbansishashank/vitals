// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { frame16 } from '../colmi/commands';
import { decodeNormal, toRingEvents as colmiEvents } from '../colmi/decoder';
import { CRP_STEPS_NOTIFY } from '../crp/commands';
import { decodeCrp, toCrpRingEvents } from '../crp/decoder';
import { createJ2301Protocol, toRingEvents as jstyleEvents } from '../jstyle2301/protocol';

const NOW = Date.UTC(2026, 9, 4, 12);
const clock = { nowMs: NOW, tzOffsetS: 0, firmware: '' };

describe('C-RINGX aggregate validity', () => {
  it('rejects impossible Colmi daily distances and battery percentages at the public boundary', () => {
    const raw = decodeNormal(frame16([0x73, 0x12, 0, 3, 232, 255, 255, 255, 255, 255, 255]), NOW);
    expect(raw).toMatchObject([{ kotlin: 'ActivityUpdate', steps: 1000, distanceMeters: 16_777_215 }]);
    expect(colmiEvents(raw, '', clock)).toEqual([]);
    expect(colmiEvents([{ kotlin: 'Battery', percent: 255 }], '', clock)).toEqual([]);
  });

  it('rejects impossible CRP daily totals while preserving raw packet parity', () => {
    const raw = decodeCrp(Uint8Array.of(232, 3, 0, 255, 255, 255, 255, 255, 255), CRP_STEPS_NOTIFY, clock);
    expect(raw).toMatchObject([{ kotlin: 'ActivityUpdate', steps: 1000, distanceMeters: 16_777_215 }]);
    expect(toCrpRingEvents(raw, clock)).toEqual([]);
  });

  it('does not publish all-ones J-Style activity counters as daily measurements', () => {
    const frame = new Uint8Array(26);
    frame.set([0x51, 0, 0x26, 0x10, 0x04]);
    frame.fill(255, 5, 9);
    frame.fill(255, 13, 21);
    const p = createJ2301Protocol();
    const state = p.begin!({ op: 'history', params: { opcode: 0x51, ...clock } }, p.initialState()).state;
    const events = p.ingest(frame, state, undefined, NOW).events;
    expect(events.some((e) => e.type === 'dailyTotal')).toBe(false);
    expect(events.filter((e) => e.type === 'vendor' && e.key.startsWith('daily_'))).toEqual([]);
  });

  it('only promotes firmware-interpreted active minutes, leaving unknown raw units opaque', () => {
    const vendor = (key: string, value: number) => ({ type: 'vendor' as const, key, value, t: NOW, unit: 's' });
    const unknown = jstyleEvents([vendor('daily_steps', 100), vendor('exercise_duration_raw', 3600)]);
    expect(unknown.find((e) => e.type === 'dailyTotal')).toEqual({ type: 'dailyTotal', localDay: NOW, steps: 100 });
    const known = jstyleEvents([vendor('active_minutes', 60)]);
    expect(known.find((e) => e.type === 'dailyTotal')).toMatchObject({ activeS: 3600 });
  });

  it('applies the remaining Kotlin bridge ranges to Colmi history and CRP stress', () => {
    expect(colmiEvents([
      { kotlin: 'HistoryMeasurement', kind_field: 'HEART_RATE', value: 225, t: NOW },
      { kotlin: 'HistoryMeasurement', kind_field: 'HRV', value: 301, t: NOW },
      { kotlin: 'HistoryMeasurement', kind_field: 'BLOOD_PRESSURE_DIASTOLIC', value: 160, t: NOW },
      { kotlin: 'StressSample', value: 255, t: NOW },
      { kotlin: 'TemperatureSample', celsius: 46, t: NOW },
    ], '', clock)).toEqual([]);
    expect(toCrpRingEvents([{ kotlin: 'StressSample', value: 255, t: NOW }], clock)).toEqual([]);
    expect(toCrpRingEvents([{ kotlin: 'TemperatureSample', celsius: 50, t: NOW }], clock)).toEqual([]);
  });
});
