// @vitest-environment node
/**
 * r071: a night the ring recorded in two parts reaches the log as one night. The server used to send the longer part as
 * the night and the other as a nap, so Vitals logged 188 min for 2026-10-30 (the second part: 03:13 to 06:30) while the
 * night was 393 min (22:11 to 06:30, up for 69 min between the parts). The server now sends one session for the night; the
 * import writes it under the wake date it already uses, replacing the partial entry, and drops an early part imported alone.
 */
import { describe, expect, it } from 'vitest';
import { planGaugeImport, type GaugeSleepEpisode } from '../gaugeImport';
import { observedSleep } from '../loggedDay';
import { projectEntries } from '../logs';
import type { LogEntry } from '../types';

const TZ = 'Asia/Kolkata';
const TODAY = '2026-10-30';
/** 14:00 in Kolkata. */
const NOW = '2026-10-30T08:30:00.000Z';

// the owner's nights as `gauge_sleep` sent them (and now sends them) on 2026-10-30
const night29: GaugeSleepEpisode = { wakingDate: '2026-10-29', start: '2026-10-28T21:56:00+05:30', end: '2026-10-29T06:04:00+05:30', asleepMinutes: 366 };
const part1: GaugeSleepEpisode = { wakingDate: '2026-10-30', start: '2026-10-29T22:11:00+05:30', end: '2026-10-30T02:04:00+05:30', asleepMinutes: 205 };
const part2: GaugeSleepEpisode = { wakingDate: '2026-10-30', start: '2026-10-30T03:13:00+05:30', end: '2026-10-30T06:30:00+05:30', asleepMinutes: 188 };
const whole: GaugeSleepEpisode = { wakingDate: '2026-10-30', start: part1.start, end: part2.end, asleepMinutes: 393 };

type SleepEntry = Extract<LogEntry, { kind: 'sleep' }>;

/** Apply a plan like `log.fromGauge` does: append each create under its id. */
function run(entries: LogEntry[], sleep: GaugeSleepEpisode[], now = NOW) {
  const plan = planGaugeImport({ entries, steps: [], sleep, tz: TZ, today: TODAY, now });
  const next = [...entries];
  for (const c of plan.create) if (!next.some((e) => e.id === c.id)) next.push({ ...c.entry, id: c.id } as LogEntry);
  return { entries: next, plan };
}
const inForce = (entries: LogEntry[], date: string) => projectEntries(entries).filter((e): e is SleepEntry => e.kind === 'sleep' && e.date === date);

describe('r071: a night in two parts is one log entry', () => {
  it('the probe: as two sessions the log got the second part (188 min) for the night and the first part nowhere', () => {
    const { entries } = run([], [night29, part1, part2]);
    expect(inForce(entries, '2026-10-30')).toMatchObject([{ bedAt: new Date(part2.start).toISOString(), asleepMin: 188 }]);
    // the first part wakes at 02:04 (the app day before): it lost the 29th to that morning's night
    expect(inForce(entries, '2026-10-29')).toMatchObject([{ asleepMin: 366 }]);
    expect(observedSleep(inForce(entries, '2026-10-30'))!.hours).toBeCloseTo(188 / 60, 5);
  });

  it('as one session the entry is the whole night, 22:11 to 06:30 with 393 min asleep, dated by its wake', () => {
    const { entries, plan } = run([], [night29, whole]);
    expect(plan.create.map((c) => c.key)).toEqual(['gauge:sleep:2026-10-29', 'gauge:sleep:2026-10-30']);
    const n = inForce(entries, '2026-10-30');
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ date: '2026-10-30', bedAt: new Date(whole.start).toISOString(), wakeAt: new Date(whole.end).toISOString(), asleepMin: 393, episodeKind: 'main' });
    // the day's sleep is the minutes asleep in both parts: the break in the middle is not counted
    expect(observedSleep(n)!.hours).toBeCloseTo(393 / 60, 5);
    expect(observedSleep(n)!.main).toMatchObject({ bedAt: new Date(whole.start).toISOString(), wakeAt: new Date(whole.end).toISOString() });
    // the 29th keeps its own night
    expect(inForce(entries, '2026-10-29')).toMatchObject([{ asleepMin: 366 }]);
  });

  it('it replaces the 188 min entry already in the log (the same key, superseded); a re-run writes nothing', () => {
    const before = run([], [night29, part1, part2]);
    const old = inForce(before.entries, '2026-10-30')[0]!;
    const { entries, plan } = run(before.entries, [night29, whole]);
    expect(plan.create).toHaveLength(1);
    expect(plan.create[0]!.entry).toMatchObject({ kind: 'sleep', date: '2026-10-30', supersedes: old.id, asleepMin: 393 });
    const now = inForce(entries, '2026-10-30');
    expect(now).toHaveLength(1);
    expect(now[0]).toMatchObject({ asleepMin: 393 });
    expect(observedSleep(now)!.hours).toBeCloseTo(393 / 60, 5);
    expect(run(entries, [night29, whole]).plan.create).toEqual([]);
  });

  it('a first part imported on its own is retracted when the whole night arrives', () => {
    // 03:10: the first part ended over an hour ago and nothing else of that day is in the log
    const early = run([], [part1], '2026-10-29T21:40:00.000Z');
    expect(inForce(early.entries, '2026-10-29')).toMatchObject([{ asleepMin: 205 }]);
    const later = run(early.entries, [whole]);
    expect(later.plan.create.map((c) => [c.entry.kind, c.entry.date])).toEqual([['sleep', '2026-10-30'], ['retract', '2026-10-29']]);
    expect(inForce(later.entries, '2026-10-29')).toEqual([]);
    expect(inForce(later.entries, '2026-10-30')).toMatchObject([{ asleepMin: 393 }]);
  });

  it('a real nap stays a nap: only the night is imported', () => {
    const nap: GaugeSleepEpisode = { wakingDate: '2026-10-30', start: '2026-10-30T14:00:00+05:30', end: '2026-10-30T14:38:00+05:30', asleepMinutes: 38 };
    const { entries } = run([], [whole, nap], '2026-10-30T10:30:00.000Z');
    expect(inForce(entries, '2026-10-30')).toMatchObject([{ asleepMin: 393 }]);
  });
});
