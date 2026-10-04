// @vitest-environment node
/**
 * Golden tests: warning day ranges (coordinator ruling, blocker round 2026-10-01). A warning run's reported range is the
 * set of days whose own inputs/state triggered it — for rolling-window rules the days of the window that produced the
 * mean or trend (from day 0; the mean stays "averaged over the last 7 days"), for fast-related rules the fast's own days
 * (from its first zero-intake hour) plus the stated aftermath (the refeed days). Before: W-M03 on a days-0-13 block read
 * 5-15, W-E05 after a 120-h fast on days 7-12 read 19-26, W-E03/W-E04 never flagged the first 3-6 days. Real engine.
 */
import { compileSchedule } from '../../core/compileSchedule';
import { runEngine } from '../../core/loop';
import { resolveProfile } from '../../core/resolveProfile';
import type { DayTemplate, PersonProfile, Schedule, SimWarning } from '../../types';

vi.setConfig({ testTimeout: 120_000 });

const rp = resolveProfile({ schemaVersion: 1, body: { sex: 'male', ageYears: 34, heightCm: 178, weightKg: 88 }, habits: { sessionsPerWeek: 0 }, startDate: '2026-10-05' } as PersonProfile);
const P = (id: string, pct: number, protPctE: number, fatPctE?: number): DayTemplate => ({
  id,
  label: id,
  energy: { kind: 'pctMaintenance', pct },
  macros: {
    protein: { unit: 'pctEnergy', value: protPctE },
    carbs: fatPctE === undefined ? { unit: 'pctEnergy', value: 45 } : { unit: 'remainder' },
    fat: fatPctE === undefined ? { unit: 'remainder' } : { unit: 'pctEnergy', value: fatPctE },
  },
  meals: { count: 3, window: { startH: 8, lengthH: 11 } },
});
function warnings(days: number, programs: DayTemplate[], use: (d: number) => number, events: Schedule['events'] = []): SimWarning[] {
  const s: Schedule = { schemaVersion: 1, startDate: '2026-10-05', horizonDays: days, programs, days: Array.from({ length: days }, (_, d) => ({ program: use(d) })), events };
  return runEngine(rp, compileSchedule(s, rp), { record: 'daily', collectWarnings: true }).warnings;
}
const runs = (w: SimWarning[], id: string): [number, number][] => w.filter((x) => x.id === id).map((x) => [x.startDay, x.endDay]);

describe('rolling 7-day rules: the block that produced the mean, from day 0', () => {
  it('14-day high-protein block (45 %E, days 0-13, then 16 %E): W-M03 and W-M04 read days 0-13 (were 4-15 / 3-16)', () => {
    const w = warnings(28, [P('high', 100, 45, 15), P('usual', 100, 16)], (d) => (d < 14 ? 0 : 1));
    expect(runs(w, 'W-M03')).toEqual([[0, 13]]);
    expect(runs(w, 'W-M04')).toEqual([[0, 13]]);
  });
  it('14-day low-protein, low-fat block: W-M01 and W-M06 read days 0-13 (were 3-16 / 5-14)', () => {
    const w = warnings(28, [P('low', 100, 5, 8), P('usual', 100, 16)], (d) => (d < 14 ? 0 : 1));
    expect(runs(w, 'W-M01')).toEqual([[0, 13]]);
    expect(runs(w, 'W-M06')).toEqual([[0, 13]]);
  });
  it('deficit from day 0 (60 % for 28 d): W-E03 from day 0 (was day 4), the loss-rate rule W-E05 from day 0 (was 9)', () => {
    const w = warnings(28, [P('deficit', 60, 30)], () => 0);
    expect(runs(w, 'W-E03')).toEqual([[0, 27]]);
    expect(runs(w, 'W-E05')[0]![0]).toBe(0);
  });
  it('deficit from day 0 (45 %): W-E04, W-E01 and W-M02 from day 0; no W-E03 caution run under the danger run', () => {
    const w = warnings(28, [P('deficit', 45, 30)], () => 0);
    expect(runs(w, 'W-E04')).toEqual([[0, 27]]);
    expect(runs(w, 'W-E01')).toEqual([[0, 27]]);
    expect(runs(w, 'W-M02')).toEqual([[0, 27]]);
    expect(runs(w, 'W-E03')).toEqual([]);
  });
  it('a deficit block days 0-13 then maintenance: the deficit rules end on day 13, not with the 7-day mean', () => {
    const w = warnings(28, [P('deficit', 60, 30), P('usual', 100, 16)], (d) => (d < 14 ? 0 : 1));
    for (const id of ['W-E03', 'W-E04', 'W-E01', 'W-13-ALPERT']) for (const [, end] of runs(w, id)) expect(end, id).toBeLessThanOrEqual(13);
    expect(runs(w, 'W-E03')[0]![0]).toBe(0);
  });
});

describe('fast-related rules: the fast\'s own days plus the stated aftermath', () => {
  // 120 h meal to meal from the day-7 19:00 dinner to day 12 19:00, planned refeed ramp (4 days from day 12)
  const w = warnings(35, [P('usual', 100, 16)], () => 0, [{ kind: 'fast', startDay: 7, startH: 19, durationH: 120, refeed: 'auto' }]);
  it('W-F04 and W-F11 read days 7-12 (were 8-12 / 9-12)', () => {
    expect(runs(w, 'W-F04')).toEqual([[7, 12]]);
    expect(runs(w, 'W-F11')).toEqual([[7, 12]]);
  });
  it('the loss-rate rule is attributed to the fast and its refeed days (was 18-28, entirely after the fast)', () => {
    for (const [start, end] of runs(w, 'W-E05')) {
      expect(start).toBeGreaterThanOrEqual(7);
      expect(end).toBeLessThanOrEqual(15);
    }
    for (const x of w) if (!x.id.startsWith('W-U')) expect(x.startDay, x.id).toBeGreaterThanOrEqual(7);
  });
  it('a "72 h" fast reads 72 h in every W-F peak value (the UI prints "A {peak} h fast"); never 71', () => {
    const w72 = warnings(14, [P('usual', 100, 16)], () => 0, [{ kind: 'fast', startDay: 2, startH: 19, durationH: 72 }]);
    const tier = w72.filter((x) => /^W-F0[1-5]$/.test(x.id));
    expect(tier.map((x) => [x.id, x.startDay, x.endDay, x.peakValue])).toEqual([['W-F03', 2, 5, 72]]);
    for (const x of w72.filter((y) => y.id.startsWith('W-F'))) {
      expect(x.peakValue, x.id).not.toBe(71);
      expect(x.message, x.id).not.toMatch(/\b71\b/);
    }
  });
});
