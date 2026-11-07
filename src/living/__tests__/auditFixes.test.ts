// @vitest-environment node
/**
 * Regression tests of the energy-core audit fixes in the pure living code (impl-audit claude-core F7, F8, F13; codex-core
 * #10, #12, #16). Scenarios from the auditors' scratch tests.
 */
import { describe, expect, it } from 'vitest';
import { todayActual } from '../todayReplay';
import { planGaugeImport, type GaugeImportInput } from '../gaugeImport';
import { estimateFor, movingMinutes } from '../activityCandidates';
import { heartPoints, minutePoints } from '../sensors/heartPoints';
import type { LogEntry } from '../types';

const TZ = 'Asia/Kolkata';

describe('F7 / Codex #10: a morning gap after a covered night is unknown, not zero', () => {
  const nowMs = Date.parse('2026-10-21T12:00:00+05:30');
  const head = { id: 'R', label: 'rest', energy: { kind: 'kcal', kcal: 2100 }, macros: {}, steps: 8000, sleep: { bedH: 23, wakeH: 7 } } as never;
  const rx = { sessions: [], steps: 8000, sleep: { bedH: 23, wakeH: 7 } } as never;
  // the ring saw the night (00:00-07:10: 430 covered minutes, zeros) and nothing from 07:10 to noon
  const steps = { id: 's1', date: '2026-10-21', tz: TZ, at: '', kind: 'steps', steps: 200, scope: 'totalDay', source: { by: 'device', app: 'gauge', sources: ['ring'] }, fusion: { version: 'steps-fuse/1', located: 200, headlinePolicy: 'located', coverage: { ringMin: 430, phoneMin: 0, eitherMin: 430, unknownMin: 1010 } } } as unknown as LogEntry;
  const sleep = { id: 'n1', date: '2026-10-21', tz: TZ, at: '', kind: 'sleep', bedAt: '2026-10-20T23:00:00+05:30', wakeAt: '2026-10-21T07:00:00+05:30', source: { by: 'device', app: 'gauge' } } as unknown as LogEntry;

  it('with the recorded night, the uncovered morning gets the plan-share prior', () => {
    const t = todayActual({ date: '2026-10-21', prescription: rx, headTemplate: head, entries: [steps, sleep], nowMs, tz: TZ });
    // 07:00-12:00 = 300 awake min, 10 of them covered (07:00-07:10): 290/960 uncovered
    expect(t.steps.uncoveredAwakeFrac).toBeCloseTo(290 / 960, 6);
    expect(t.steps.prior).toBeCloseTo(8000 * (660 / 960 + 290 / 960), 3);
  });

  it('Codex #10 scenario: 16,000 steps, coverage only overnight, 100 observed → 16,100', () => {
    const night = { ...(steps as object), steps: 100, fusion: { version: 'steps-fuse/1', located: 100, headlinePolicy: 'located', coverage: { ringMin: 420, phoneMin: 0, eitherMin: 420, unknownMin: 1020 } } } as unknown as LogEntry;
    const t = todayActual({ date: '2026-10-21', prescription: { sessions: [], steps: 16000, sleep: { bedH: 23, wakeH: 7 } } as never, headTemplate: head, entries: [night, sleep], nowMs, tz: TZ });
    expect(t.steps.total).toBe(16100);
  });

  it('without a recorded night the coverage is not moved (it may be the morning)', () => {
    const t = todayActual({ date: '2026-10-21', prescription: rx, headTemplate: head, entries: [steps], nowMs, tz: TZ });
    expect(t.steps.uncoveredAwakeFrac).toBe(0);
  });
});

describe('F8 / Codex #3: pauses are excluded from the estimate and the duration', () => {
  const person = { massKg: 80, ageY: 40, sex: 'male' as const, rmrKcalPerDay: 1800 };
  const w = { start: 0, end: 60 * 60_000 };
  it('a 60-min walk with 40 min paused books 20 moving minutes (106.4 kcal, not 319.2)', () => {
    const a = estimateFor({ exerciseId: 'walk', window: w, person, keytelEnabled: true })!;
    const b = estimateFor({ exerciseId: 'walk', window: w, person, keytelEnabled: true, pauses: [{ start: 10 * 60_000, end: 50 * 60_000 }] })!;
    expect(a.booked.grossKcal).toBeCloseTo(319.2, 1);
    expect(b.booked.grossKcal).toBeCloseTo(106.4, 1);
    expect(b.durationMin).toBeCloseTo(20, 9);
  });
  it('overlapping pauses count once; pauses outside the window not at all', () => {
    expect(movingMinutes(w, [{ start: 0, end: 20 * 60_000 }, { start: 10 * 60_000, end: 30 * 60_000 }, { start: 70 * 60_000, end: 80 * 60_000 }])).toBeCloseTo(30, 9);
  });
});

describe('Codex #12: a fractional bout earns fractional Heart Points', () => {
  it('a 30-s moderate minute earns 0.5, not 1', () => {
    expect(minutePoints({ start: 0, seconds: 30, asleep: false, activity: { met: 4, gait: 'walk' }, cadence: null }, 180).points).toBeCloseTo(0.5, 9);
    expect(heartPoints({ ageY: 40, minutes: [{ start: 0, asleep: false, activity: { met: 4 }, cadence: null }] }).points).toBe(1);
  });
  it('the bout estimate clips the last partial minute and leaves pauses out', () => {
    const person = { massKg: 80, ageY: 40, sex: 'male' as const, rmrKcalPerDay: 1800 };
    const half = estimateFor({ exerciseId: 'walk_brisk', window: { start: 0, end: 30_000 }, person, keytelEnabled: false })!;
    const paused = estimateFor({ exerciseId: 'walk_brisk', window: { start: 0, end: 10 * 60_000 }, person, keytelEnabled: false, pauses: [{ start: 0, end: 5 * 60_000 }] })!;
    const full = estimateFor({ exerciseId: 'walk_brisk', window: { start: 0, end: 10 * 60_000 }, person, keytelEnabled: false })!;
    expect(half.heartPoints).toBeCloseTo(0.5, 9);
    expect(paused.heartPoints).toBeCloseTo(full.heartPoints! / 2, 9);
  });
});

describe('F13: a night that started before 19:00 is kept on its wake day', () => {
  it('the server dates it by its start (the day before); Vitals takes it on the app day of the wake', () => {
    const input: GaugeImportInput = { entries: [], steps: [], sleep: [{ wakingDate: '2026-10-19', start: '2026-10-19T18:30:00+05:30', end: '2026-10-20T05:00:00+05:30', asleepMinutes: 560 }], tz: TZ, today: '2026-10-20', now: '2026-10-20T12:00:00.000Z' };
    const p = planGaugeImport(input);
    expect(p.create.map((c) => [c.stream, c.entry.date])).toEqual([['sleep', '2026-10-20']]);
  });
});

describe('Codex #16: a supported zero replaces an older count', () => {
  it('a correction from 1,000 steps to a covered 0 supersedes the old entry; a bare 0 writes nothing', () => {
    const base = { tz: TZ, today: '2026-10-20', now: '2026-10-20T12:00:00.000Z', sleep: [] };
    const fusion = (steps: number) => ({ version: 'steps-fuse/1', located: steps, headlinePolicy: 'located' as const, coverage: { ringMin: 600, phoneMin: 0, eitherMin: 600, unknownMin: 840 } });
    const first = planGaugeImport({ ...base, entries: [], steps: [{ date: '2026-10-18', steps: 1000, fusion: fusion(1000) }] });
    const entries = first.create.map((c) => ({ ...c.entry, id: c.id }) as LogEntry);
    const fixed = planGaugeImport({ ...base, entries, steps: [{ date: '2026-10-18', steps: 0, fusion: fusion(0) }] });
    expect(fixed.create).toHaveLength(1);
    expect(fixed.create[0]!.entry).toMatchObject({ kind: 'steps', steps: 0, supersedes: entries[0]!.id });
    expect(planGaugeImport({ ...base, entries, steps: [{ date: '2026-10-18', steps: 0 }] }).create).toEqual([]);
  });
});
