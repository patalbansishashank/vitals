// @vitest-environment node
/**
 * r063 FX2 (final review): a single surviving moving interval is replayed where it moved (sR07/aR08), and fused steps
 * crossing the person's rollover land on the right app day, counts and coverage by one contract (sR08/aR03).
 */
import { describe, expect, it } from 'vitest';
import { localToInstant } from '../dates';
import { estimateFor, sessionEntryOf } from '../activityCandidates';
import { appDayStepsOf, type FusedDay, type FusedInterval } from '../stepsAppDay';
import type { LogEntry } from '../types';

const TZ = 'Asia/Kolkata';
type Session = Extract<LogEntry, { kind: 'session' }>;
const STIM = { effectiveSetsByRegion: {}, pattern: 'gait', loadClass: 'light', netKcal: 0, mem: 0, hiMinutes: 0, mobilityMinutes: {} } as unknown as Session['stimulus'];
const PERSON = { massKg: 80, ageY: 40, sex: 'male' as const, rmrKcalPerDay: 1800 };

describe('sR07/aR08: one surviving moving interval is repositioned', () => {
  const date = '2026-10-21';
  const at = (h: number) => Date.parse(localToInstant(date, h, TZ));
  const window = { start: at(10), end: at(11) };
  const book = (pauses: Array<{ start: number; end: number }>) => {
    const estimate = estimateFor({ exerciseId: 'walk_brisk', window, person: PERSON, keytelEnabled: false, pauses })!;
    const candidate = { key: 'gauge:w1', sourceRevision: 'r1', estimateRevision: 'e1', measures: { steps: null }, refs: ['gauge:w1'], pauses, window } as unknown as Parameters<typeof sessionEntryOf>[0]['candidate'];
    return sessionEntryOf({ candidate, decision: { exerciseId: 'walk_brisk', startAt: new Date(window.start).toISOString(), endAt: new Date(window.end).toISOString() }, estimate: estimate as never, decidedRevision: 'r1', stimulus: STIM, catalogueVersion: 'c', edited: false, tz: TZ, now: '2026-10-21T08:00:00.000Z' }).entry as Session;
  };

  it('the probe: 10:00-11:00 paused until 10:50 replays its ten moving minutes at 10:50, not 10:00', () => {
    const e = book([{ start: at(10), end: at(10 + 50 / 60) }]);
    expect(e.durationMin).toBeCloseTo(10, 9);
    expect(e.engine!.map((x) => [x.startH, x.durationMin])).toEqual([[expect.closeTo(10 + 50 / 60, 9), expect.closeTo(10, 9)]]);
  });

  it('paused from 10:40 to the end: the moving 40 minutes stay at 10:00', () => {
    const e = book([{ start: at(10 + 40 / 60), end: at(11) }]);
    expect(e.engine!.map((x) => [x.startH, x.durationMin])).toEqual([[expect.closeTo(10, 9), expect.closeTo(40, 9)]]);
  });
});

describe('sR08/aR03: fused steps across the rollover', () => {
  const iv = (start: string, end: string, steps: number, lineage = 'phone'): FusedInterval => ({ start, end, steps, lineage });
  const at = (date: string, h: number) => localToInstant(date, h, TZ);
  const day = (date: string, located: number, cov: Partial<NonNullable<FusedDay['coverage']>> = {}): FusedDay => ({ date, located, headline: located, headlinePolicy: 'located', coverage: { ringMin: 0, phoneMin: 0, eitherMin: 0, unknownMin: 0, ...cov } });

  it('the probe: a 200-step phone span 23:50-00:10 (counted by the server on the 21st, by its end) moves to the 20th with its coverage', () => {
    // the server places the span's count on the day of its last instant (the 21st) and clips its coverage at midnight
    const span = iv(at('2026-10-20', 23 + 50 / 60), at('2026-10-21', 10 / 60), 200);
    const out = appDayStepsOf({ intervals: [span], days: [day('2026-10-20', 0, { phoneMin: 10, eitherMin: 10 }), day('2026-10-21', 200, { phoneMin: 10, eitherMin: 10 })], tz: TZ, rolloverH: 4 });
    expect(out.map((d) => [d.date, d.located])).toEqual([['2026-10-20', 200], ['2026-10-21', 0]]);
    expect(out.map((d) => d.coverage!.eitherMin)).toEqual([20, 0]);
    expect(out.map((d) => d.coverage!.phoneMin)).toEqual([20, 0]);
    expect(out[0]!.spans).toEqual([{ start: new Date(span.start).toISOString(), end: new Date(span.end).toISOString() }]);
  });

  it('intervals the server split at the rollover land on their own app days (3,000 each side of 04:00)', () => {
    const ivs = [iv(at('2026-10-21', 3.5), at('2026-10-21', 4), 3000, 'ring'), iv(at('2026-10-21', 4), at('2026-10-21', 4.5), 3000, 'ring')];
    const out = appDayStepsOf({ intervals: ivs, days: [day('2026-10-20', 0), day('2026-10-21', 6000, { ringMin: 60, eitherMin: 60 })], tz: TZ, rolloverH: 4 });
    expect(out.map((d) => d.located)).toEqual([3000, 3000]);
    expect(out.map((d) => d.coverage!.ringMin)).toEqual([30, 30]);
  });

  it('an indivisible coarse span across the rollover keeps the server\'s day for its count; its coverage is split by time', () => {
    // 03:00-05:00: the count stays where the server put it (its end, app day 21st); 60 of its minutes move to the 20th
    const span = iv(at('2026-10-21', 3), at('2026-10-21', 5), 1200);
    const out = appDayStepsOf({ intervals: [span], days: [day('2026-10-20', 0), day('2026-10-21', 1200, { phoneMin: 120, eitherMin: 120 })], tz: TZ, rolloverH: 4 });
    expect(out.map((d) => d.located)).toEqual([0, 1200]);
    expect(out.map((d) => d.coverage!.eitherMin)).toEqual([60, 60]);
    // each app day's spans are clipped at the rollover
    expect(out[0]!.spans).toEqual([{ start: new Date(at('2026-10-21', 3)).toISOString(), end: new Date(at('2026-10-21', 4)).toISOString() }]);
    expect(out[1]!.spans).toEqual([{ start: new Date(at('2026-10-21', 4)).toISOString(), end: new Date(at('2026-10-21', 5)).toISOString() }]);
  });
});
