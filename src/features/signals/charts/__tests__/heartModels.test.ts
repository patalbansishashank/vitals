import { describe, expect, it } from 'vitest';
import type { DailyRecord, ResolvedDay } from '@/biometrics/core/types';
import { periodWindow } from '../../models';
import {
  GAP_FLOOR_MS,
  dayAggregates,
  dayBounds,
  downsampleFor,
  gapMs,
  hrDayModel,
  hugDomain,
  lineSegments,
  m4,
  mean7,
  monthAggregates,
  niceTicks,
  normalOf,
  spo2Slots,
  tempNormal,
  tempSlots,
  zoneSegments,
} from '../heartModels';
import { zoneModel } from '../zones';

const MIN = 60_000;
const prov = { channel: 'file:canonical' as const, recording_method: 'automatic' as const, modality: 'sensed' as const, ingested_at: '2026-10-01T00:00:00Z' };

function day(date: string, fields: Partial<DailyRecord> = {}): ResolvedDay {
  return {
    localDate: date, sleeps: [], workouts: [], spots: [], sourceByMetric: {}, tierByMetric: {}, basisByMetric: {}, corrections: [],
    daily: { kind: 'daily', record_id: date, version: 1, time: { tz_offset_s: 0, local_date: date }, provenance: prov, quality: { validation: 'measured', confidence: null, flags: [] }, ...fields },
  };
}

describe('zone segments (§7.4.2)', () => {
  const z = zoneModel({ maxHr: 200 })!; // lower bounds 100, 120, 140, 160, 180

  it('splits exactly at a boundary crossing, interpolating the time', () => {
    const segs = zoneSegments([{ t: 0, v: 110 }, { t: 10 * MIN, v: 130 }], z);
    expect(segs.map((s) => s.zone)).toEqual([1, 2]);
    // 110 → 130 crosses 120 halfway
    expect(segs[0]!.points[segs[0]!.points.length - 1]).toEqual({ t: 5 * MIN, v: 120 });
    expect(segs[1]!.points[0]).toEqual({ t: 5 * MIN, v: 120 });
  });

  it('crosses several boundaries in one step, up and down', () => {
    const up = zoneSegments([{ t: 0, v: 95 }, { t: 100, v: 145 }], z);
    expect(up.map((s) => s.zone)).toEqual([0, 1, 2, 3]);
    expect(up.slice(0, -1).map((s) => s.points[s.points.length - 1]!.v)).toEqual([100, 120, 140]);
    const down = zoneSegments([{ t: 0, v: 165 }, { t: 100, v: 115 }], z);
    expect(down.map((s) => s.zone)).toEqual([4, 3, 2, 1]);
    expect(down.slice(0, -1).map((s) => s.points[s.points.length - 1]!.v)).toEqual([160, 140, 120]);
  });

  it('keeps one segment while the zone holds; no zones → one plain segment', () => {
    expect(zoneSegments([{ t: 0, v: 121 }, { t: 1, v: 125 }, { t: 2, v: 139 }], z)).toHaveLength(1);
    const plain = zoneSegments([{ t: 0, v: 60 }, { t: 1, v: 170 }], null);
    expect(plain).toEqual([{ zone: null, points: [{ t: 0, v: 60 }, { t: 1, v: 170 }] }]);
  });

  it('lineSegments breaks runs at gaps', () => {
    const pts = [0, 5, 10, 60, 65].map((m) => ({ t: m * MIN, v: 70 }));
    expect(lineSegments(pts, z, gapMs(pts))).toHaveLength(2);
  });
});

describe('gap rule (§7.2)', () => {
  it('max(3 × median interval, 20 min)', () => {
    const every5 = [0, 5, 10, 15].map((m) => ({ t: m * MIN, v: 1 }));
    expect(gapMs(every5)).toBe(GAP_FLOOR_MS);
    const every10 = [0, 10, 20, 30].map((m) => ({ t: m * MIN, v: 1 }));
    expect(gapMs(every10)).toBe(30 * MIN);
    expect(gapMs([])).toBe(GAP_FLOOR_MS);
  });
});

describe('M4 downsampling', () => {
  it('keeps first, lowest, highest and last per pixel column', () => {
    const pts = Array.from({ length: 1000 }, (_, i) => ({ t: i * 1000, v: i === 437 ? 190 : i === 612 ? 30 : 60 + (i % 7) }));
    const out = m4(pts, 0, 999_000, 10);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.some((p) => p.v === 190)).toBe(true);
    expect(out.some((p) => p.v === 30)).toBe(true);
    expect(out[0]).toEqual(pts[0]);
    expect(out[out.length - 1]).toEqual(pts[999]);
    // time order is kept
    expect(out.every((p, i) => i === 0 || p.t > out[i - 1]!.t)).toBe(true);
  });

  it('only when there are more than two samples per column', () => {
    const pts = Array.from({ length: 50 }, (_, i) => ({ t: i, v: i }));
    expect(downsampleFor(pts, 0, 49, 30)).toBe(pts);
    expect(downsampleFor(pts, 0, 49, 20).length).toBeLessThan(50);
  });
});

describe('the day', () => {
  it('lowest, highest, readings; cut at now', () => {
    const pts = [{ t: 0, v: 70 }, { t: 10, v: 52 }, { t: 20, v: 140 }, { t: 30, v: 180 }];
    const m = hrDayModel(pts, { from: 0, to: 100, resting: 55, now: 25 });
    expect(m.readings).toBe(3);
    expect(m.lowest).toEqual({ t: 10, v: 52 });
    expect(m.highest).toEqual({ t: 20, v: 140 });
    expect(m.resting).toBe(55);
  });

  it('y domain hugs p10–p90, always includes resting and never cuts a reading off', () => {
    const vals = Array.from({ length: 100 }, (_, i) => 70 + (i % 10));
    const [lo, hi] = hugDomain(vals, [48]);
    expect(lo).toBeLessThan(48);
    expect(hi).toBeGreaterThanOrEqual(79);
    const [lo2, hi2] = hugDomain([...vals, 165], [60]);
    expect(hi2).toBeGreaterThan(165);
    expect(lo2).toBeLessThan(60);
  });

  it('nice ticks inside the domain, 2 or 3', () => {
    const t = niceTicks(51, 99, 3);
    expect(t.length).toBeGreaterThanOrEqual(2);
    expect(t.length).toBeLessThanOrEqual(3);
    expect(t.every((v) => v >= 51 && v <= 99)).toBe(true);
  });

  it('day bounds are local midnight to the next local midnight', () => {
    const b = dayBounds('2026-10-04');
    expect(new Date(b.from).getHours()).toBe(0);
    expect(new Date(b.to).getHours()).toBe(0);
    expect(b.to - b.from).toBeGreaterThanOrEqual(23 * 3_600_000);
  });

  it('on the day the clocks change each midnight sits at its own offset: 23 h in spring, 25 h in autumn', () => {
    const tz = process.env.TZ;
    process.env.TZ = 'Europe/London';
    try {
      // the runtime honours a TZ change only on some platforms; when it does, the lengths follow the clock
      if (new Date(2026, 6, 1).getTimezoneOffset() === -60) {
        const spring = dayBounds('2026-03-29'), autumn = dayBounds('2026-10-25');
        expect(spring.to - spring.from).toBe(23 * 3_600_000);
        expect(autumn.to - autumn.from).toBe(25 * 3_600_000);
        // the day starts at local midnight, not an hour early (noon's offset is not midnight's on this day)
        expect(new Date(spring.from).getHours()).toBe(0);
        expect(spring.from).toBe(Date.parse('2026-03-29T00:00:00Z'));
      }
      const plain = dayBounds('2026-10-04');
      expect(plain.to - plain.from).toBe(24 * 3_600_000);
    } finally {
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
  });
});

describe('per day, per month, nights', () => {
  const w = periodWindow('week', '2026-10-01', '2026-10-03'); // Mon 28 Sep – Sun 4 Oct, today Sat 3 Oct

  it('per-day aggregates: record figures, sample fallback, missing and future kept apart', () => {
    const days = [day('2026-09-28', { resting_hr_bpm: 58, hr_min_bpm: 50, hr_max_bpm: 150 }), day('2026-09-30', {})];
    const t = dayBounds('2026-09-30').from;
    const pts = [{ t: t + 60 * MIN, v: 61 }, { t: t + 90 * MIN, v: 99 }];
    const a = dayAggregates(w.slots, days, pts);
    expect(a.map((d) => d.recorded)).toEqual([true, false, true, false, false, false, false]);
    expect(a[0]).toMatchObject({ resting: 58, lowest: 50, highest: 150, readings: null });
    expect(a[2]).toMatchObject({ resting: null, lowest: 61, highest: 99, readings: 2 });
    expect(a[5]!.future).toBe(false);
    expect(a[6]!.future).toBe(true);
  });

  it('monthly points use recorded days only', () => {
    const y = periodWindow('year', '2026-10-03', '2026-10-03');
    const ms = monthAggregates(y.slots, [day('2026-09-01', { resting_hr_bpm: 60, hr_min_bpm: 50 }), day('2026-09-02', { resting_hr_bpm: 56, hr_max_bpm: 170 }), day('2026-09-03', { steps: 10 })]);
    expect(ms[8]).toMatchObject({ resting: 58, lowest: 50, highest: 170, days: 2, recorded: true });
    expect(ms[7]!.recorded).toBe(false);
    expect(ms[11]!.future).toBe(true);
  });

  it('7-day mean: recorded nights only, at least three, none on a missing night', () => {
    const m = mean7([60, null, 62, 64, null, 66, 58], [null, null, null, null, 61, 59]);
    expect(m[0]).toBeCloseTo(60);
    expect(Number.isNaN(m[1]!)).toBe(true);
    expect(m[2]).toBeCloseTo((61 + 59 + 60 + 62) / 4);
  });

  it('normal: forming under 14 nights', () => {
    expect(normalOf([50, 52, 54])!.forming).toBe(true);
    const n = normalOf(Array.from({ length: 14 }, (_, i) => 40 + i))!;
    expect(n.forming).toBe(false);
    expect(n.mean).toBeCloseTo(46.5);
    expect(n.lo).toBeLessThan(n.mean);
    expect(normalOf([null, undefined])).toBeNull();
  });

  it('blood oxygen per night and skin temperature as change from normal', () => {
    const days = [day('2026-09-28', { spo2_avg_pct: 96, spo2_min_pct: 91, skin_temp_c: 34.6 }), day('2026-09-29', { skin_temp_c: 34.1 })];
    const s = spo2Slots(w, days);
    expect(s[0]).toMatchObject({ avg: 96, lowest: 91, recorded: true });
    expect(s[1]!.recorded).toBe(false);
    const hist = Array.from({ length: 14 }, (_, i) => day(`2026-09-${String(10 + i).padStart(2, '0')}`, { skin_temp_c: 34.3 }));
    const n = tempNormal(hist)!;
    expect(n).toMatchObject({ basis: 'absolute', value: 34.3, forming: false });
    const t = tempSlots(w, days, n);
    expect(t[0]!.dev).toBeCloseTo(0.3);
    expect(t[1]!.dev).toBeCloseTo(-0.2);
    expect(t[2]).toMatchObject({ recorded: false, dev: null });
    // forming normal: no deviation, the night still counts as recorded
    const f = tempSlots(w, days, tempNormal(days));
    expect(f[0]).toMatchObject({ recorded: true, dev: null, abs: 34.6 });
  });
});
