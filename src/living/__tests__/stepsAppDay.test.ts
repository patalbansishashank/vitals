// @vitest-environment node
/**
 * Audit F12: fused steps arrive as calendar days, the rest of the app (sessions, the engine's day) uses app days with the
 * rollover. The adapter moves the located steps of the small hours onto their app day; totals are aggregated, never
 * stretched (energy SPEC §1.1), including on DST days.
 */
import { describe, expect, it } from 'vitest';
import { appDayStepsOf, type FusedDay, type FusedInterval } from '../stepsAppDay';
import { localToInstant } from '../dates';
import { todayActual } from '../todayReplay';
import { planGaugeImport } from '../gaugeImport';
import type { LogEntry } from '../types';

const IST = 'Asia/Kolkata';
const iv = (start: string, end: string, steps: number, lineage = 'ring'): FusedInterval => ({ start, end, steps, lineage });
const at = (date: string, h: number, tz = IST) => localToInstant(date, h, tz);
const day = (date: string, located: number, over: Partial<FusedDay> = {}): FusedDay => ({ date, located, headline: located, headlinePolicy: 'located', coverage: { ringMin: 600, phoneMin: 60, eitherMin: 620, unknownMin: 820 }, ...over });

describe('F12: the small hours belong to the app day before', () => {
  // a 30-min walk at 01:00 on the 21st (still the 20th in the app) and a morning walk on the 21st
  const intervals = [
    iv(at('2026-10-20', 9), at('2026-10-20', 10), 6000, 'ring'),
    iv(at('2026-10-21', 1), at('2026-10-21', 1.5), 2000, 'phone'),
    iv(at('2026-10-21', 9), at('2026-10-21', 10), 5000, 'ring'),
  ];
  const days = [day('2026-10-20', 6000), day('2026-10-21', 7000)];

  it('the walk at 01:00 counts on the 20th, not the 21st; the two days keep their sum', () => {
    const out = appDayStepsOf({ intervals, days, tz: IST, rolloverH: 4 });
    expect(out.map((d) => [d.date, d.located, d.headline])).toEqual([
      ['2026-10-20', 8000, 8000],
      ['2026-10-21', 5000, 5000],
    ]);
    expect(out[0]!.located + out[1]!.located).toBe(13000);
    expect(out[0]).toMatchObject({ movedIn: 2000, movedOut: 0, lineages: ['phone', 'ring'] });
    expect(out[1]).toMatchObject({ movedIn: 0, movedOut: 2000, lineages: ['ring'] });
  });

  it('the observed minutes move with their steps; the ring total and residual stay on their calendar day', () => {
    const d = [day('2026-10-20', 6000), day('2026-10-21', 7000, { ringDailyTotal: 6000, ringResidual: 1000 })];
    const out = appDayStepsOf({ intervals, days: d, tz: IST, rolloverH: 4 });
    expect(out[0]!.coverage).toEqual({ ringMin: 600, phoneMin: 90, eitherMin: 650, unknownMin: 820 });
    expect(out[1]!.coverage).toEqual({ ringMin: 600, phoneMin: 30, eitherMin: 590, unknownMin: 820 });
    expect(out[1]).toMatchObject({ ringDailyTotal: 6000, ringResidual: 1000 });
  });

  it('rollover boundary: 03:59 is the day before, 04:00 is the day itself', () => {
    const ivs = [iv(at('2026-10-21', 3 + 59 / 60), at('2026-10-21', 4), 100), iv(at('2026-10-21', 4), at('2026-10-21', 4 + 1 / 60), 50)];
    const out = appDayStepsOf({ intervals: ivs, days: [day('2026-10-20', 0), day('2026-10-21', 150)], tz: IST, rolloverH: 4 });
    expect(out.map((d) => d.located)).toEqual([100, 50]);
  });

  it('just after midnight moves, just before midnight stays', () => {
    const ivs = [iv(at('2026-10-20', 23 + 59 / 60), at('2026-10-21', 0), 70), iv(at('2026-10-21', 0), at('2026-10-21', 1 / 60), 30)];
    const out = appDayStepsOf({ intervals: ivs, days: [day('2026-10-20', 70), day('2026-10-21', 30)], tz: IST, rolloverH: 4 });
    expect(out.map((d) => d.located)).toEqual([100, 0]);
  });

  it('a rollover at midnight (0) moves nothing; a later rollover moves more', () => {
    expect(appDayStepsOf({ intervals, days, tz: IST, rolloverH: 0 }).map((d) => d.located)).toEqual([6000, 7000]);
    const late = [...intervals, iv(at('2026-10-21', 5), at('2026-10-21', 5.5), 300)];
    expect(appDayStepsOf({ intervals: late, days: [day('2026-10-20', 6000), day('2026-10-21', 7300)], tz: IST, rolloverH: 6 }).map((d) => d.located)).toEqual([8300, 5000]);
  });

  it("'atLeast': the ring's larger daily total keeps its unlocated part on its calendar day", () => {
    const d = [day('2026-10-20', 6000, { headline: 9000, headlinePolicy: 'atLeast' }), day('2026-10-21', 7000, { headline: 7000, headlinePolicy: 'atLeast' })];
    const out = appDayStepsOf({ intervals, days: d, tz: IST, rolloverH: 4 });
    expect(out.map((x) => [x.located, x.headline, x.headlinePolicy])).toEqual([
      [8000, 11000, 'atLeast'],
      [5000, 5000, 'atLeast'],
    ]);
  });

  it('the last day takes the small hours of a calendar day the read had only for its intervals', () => {
    const out = appDayStepsOf({ intervals: [iv(at('2026-10-21', 2), at('2026-10-21', 2.5), 900)], days: [day('2026-10-20', 4000)], tz: IST, rolloverH: 4 });
    expect(out).toHaveLength(1);
    expect(out[0]!.located).toBe(4900);
  });
});

describe('F12 on DST days (America/New_York): aggregated by the wall clock, never stretched', () => {
  const NY = 'America/New_York';
  it('spring forward (2026-03-08, 02:00 → 03:00): 01:30 and 03:30 are the 7th; 04:30 is the 8th', () => {
    const a = Date.parse('2026-03-08T06:30:00Z'); // 01:30 EST
    const b = Date.parse('2026-03-08T07:30:00Z'); // 03:30 EDT
    const c = Date.parse('2026-03-08T08:30:00Z'); // 04:30 EDT
    const m = (t: number) => new Date(t).toISOString();
    const ivs = [iv(m(a), m(a + 600_000), 100), iv(m(b), m(b + 600_000), 200), iv(m(c), m(c + 600_000), 400)];
    const out = appDayStepsOf({ intervals: ivs, days: [day('2026-03-07', 1000), day('2026-03-08', 700)], tz: NY, rolloverH: 4 });
    expect(out.map((d) => d.located)).toEqual([1300, 400]);
    expect(out[0]!.located + out[1]!.located).toBe(1700);
  });

  it('fall back (2026-11-01): both 01:30s (EDT then EST) are the 31st; 04:30 EST is the 1st', () => {
    const first = Date.parse('2026-11-01T05:30:00Z'); // 01:30 EDT
    const second = Date.parse('2026-11-01T06:30:00Z'); // 01:30 EST
    const four = Date.parse('2026-11-01T09:30:00Z'); // 04:30 EST
    const m = (t: number) => new Date(t).toISOString();
    const ivs = [iv(m(first), m(first + 600_000), 10), iv(m(second), m(second + 600_000), 20), iv(m(four), m(four + 600_000), 40)];
    const out = appDayStepsOf({ intervals: ivs, days: [day('2026-10-31', 500), day('2026-11-01', 70)], tz: NY, rolloverH: 4 });
    expect(out.map((d) => d.located)).toEqual([530, 40]);
  });
});

describe('F12: the import writes fused days as app days', () => {
  it('a fused steps entry says it is an app day (with its rollover); a ring-only total stays a calendar day', () => {
    const plan = planGaugeImport({
      today: '2026-10-21',
      now: '2026-10-21T12:00:00.000Z',
      tz: IST,
      rolloverH: 4,
      entries: [],
      steps: [
        { date: '2026-10-20', steps: 8000, fusion: { version: 'steps-fuse/1', located: 8000, headlinePolicy: 'located' }, sources: ['ring'] },
        { date: '2026-10-21', steps: 300 },
      ],
      sleep: [],
    } as never);
    const occ = (d: string) => (plan.create.find((c) => c.entry.date === d)!.entry as { occurrence?: { dateMeaning: string; rolloverH?: number } }).occurrence;
    expect(occ('2026-10-20')).toMatchObject({ dateMeaning: 'appDay', rolloverH: 4 });
    expect(occ('2026-10-21')).toMatchObject({ dateMeaning: 'calendarLocal' });
  });

  it("today's night coverage of an app day starts at the rollover (its small hours went to the day before)", () => {
    const nowMs = Date.parse('2026-10-21T12:00:00+05:30');
    const head = { id: 'R', label: 'rest', energy: { kind: 'kcal', kcal: 2100 }, macros: {}, steps: 8000, sleep: { bedH: 23, wakeH: 7 } } as never;
    const rx = { sessions: [], steps: 8000, sleep: { bedH: 23, wakeH: 7 } } as never;
    // the ring saw 04:00-07:10 of the app day (190 covered minutes: the night from the rollover, then 10 awake minutes)
    const steps = { id: 's1', date: '2026-10-21', tz: IST, at: '', kind: 'steps', steps: 200, scope: 'totalDay', source: { by: 'device', app: 'gauge', sources: ['ring'] }, occurrence: { precision: 'dateOnly', date: '2026-10-21', dateMeaning: 'appDay', rolloverH: 4, source: 'device' }, fusion: { version: 'steps-fuse/1', located: 200, headlinePolicy: 'located', coverage: { ringMin: 190, phoneMin: 0, eitherMin: 190, unknownMin: 1250 } } } as unknown as LogEntry;
    const sleep = { id: 'n1', date: '2026-10-21', tz: IST, at: '', kind: 'sleep', bedAt: '2026-10-20T23:00:00+05:30', wakeAt: '2026-10-21T07:00:00+05:30', source: { by: 'device', app: 'gauge' } } as unknown as LogEntry;
    const t = todayActual({ date: '2026-10-21', prescription: rx, headTemplate: head, entries: [steps, sleep], nowMs, tz: IST, rolloverH: 4 });
    // 180 night minutes (04:00-07:00), so 10 awake minutes covered: 290 of the 960 awake minutes uncovered
    expect(t.steps.uncoveredAwakeFrac).toBeCloseTo(290 / 960, 6);
  });
});
