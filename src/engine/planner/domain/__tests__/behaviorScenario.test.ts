// @vitest-environment node
/**
 * D5-08 (planner contribution): utility credit is not p(done). The realistic curve is a plausible-execution scenario:
 * dose items at their heuristic credit, and each planned fast kept or skipped whole on one deterministic seeded path with
 * a completion probability from observed fast outcomes (same-day items clustered) or an explicit assumption — never the
 * Beta mean, never a 0.5 switch over every fast, never a partially scaled fast.
 */
import { describe, expect, it } from 'vitest';
import { resolveProfile } from '../../../core/resolveProfile';
import type { DayTemplate, Schedule } from '../../../types/schedule';
import type { BlockAdherence, LoggedDay } from '../replanTypes';
import {
  ASSUMED_FAST_COMPLETION,
  BEHAVIOR_FORECAST,
  behaviorPathU,
  behaviorSeed,
  creditSchedule,
  dayTemplate,
  fastCompletionScenario,
  fastOutcomeCounts,
  fastPathKeeper,
  realisticSchedule,
  scaleDay,
} from '../sensitivities';
import { MAN_95 } from './personas';

const rp = resolveProfile({ ...MAN_95, startDate: '2026-10-05' });
const eat: DayTemplate = { id: 'E', label: 'E', energy: { kind: 'pctMaintenance', pct: 80 }, macros: { protein: { unit: 'g', value: 150 }, carbs: { unit: 'g', value: 200 }, fat: { unit: 'remainder' } } };
const zero: DayTemplate = { id: 'Z', label: 'Z', energy: { kind: 'zero' }, macros: { protein: { unit: 'g', value: 0 }, carbs: { unit: 'g', value: 0 }, fat: { unit: 'remainder' } } };
/** 140 days, a zero day every other day (70 fast opportunities). */
const S: Schedule = { schemaVersion: 1, startDate: '2026-10-05', horizonDays: 140, programs: [eat, zero], days: Array.from({ length: 140 }, (_, d) => ({ program: d % 2 })) };
const zeroDays = (s: Schedule) => Array.from({ length: s.horizonDays }, (_, d) => d).filter((d) => d % 2 === 1);
const keptShare = (s: Schedule) => zeroDays(s).filter((d) => dayTemplate(s, d).energy.kind === 'zero').length / zeroDays(s).length;
const adherence = (fastMean: number): BlockAdherence[] => [{ type: 'fast', a: 10 * fastMean, b: 10 * (1 - fastMean), opportunities: 20 }];
const log = (statuses: Array<'done' | 'partial' | 'skipped' | 'unknown'>): Pick<LoggedDay, 'items'> => ({ items: statuses.map((status, i) => ({ itemId: `fast${i}`, type: 'fast', status, credit: null })) });

describe('D5-08 behaviour scenarios', () => {
  it('a utility-credit mean never becomes the completion probability or a 0.5 switch over every fast', () => {
    for (const mean of [0.1, 0.45, 0.55, 0.9]) {
      const s = realisticSchedule(S, 0, adherence(mean), rp);
      // without observed outcomes the explicit assumption holds: the planned routine happens, whatever the Beta mean
      expect(keptShare(s)).toBe(ASSUMED_FAST_COMPLETION);
    }
    expect(fastCompletionScenario()).toEqual({ p: 1, source: 'assumed', days: 0 });
  });

  it('observed fast outcomes give the completion probability; one day is one observation (same-day items clustered)', () => {
    const counts = fastOutcomeCounts([log(['done']), log(['done', 'done']), log(['skipped']), log(['done', 'skipped']), log(['unknown']), log([])]);
    expect(counts).toEqual({ done: 2, partial: 1, skipped: 1 });
    expect(fastCompletionScenario(counts)).toEqual({ p: 3 / 6, source: 'observed', days: 4 });
    // fewer than the minimum resolved days: the assumption, not a fitted probability
    expect(fastCompletionScenario({ done: 1, partial: 0, skipped: 1 }).source).toBe('assumed');
  });

  it('plausible execution states a fixed full-dose assumption independent of utility and historical completion summaries', () => {
    const counts = { done: 2, partial: 1, skipped: 5 };
    const a = realisticSchedule(S, 0, adherence(0.9), rp, { fastOutcomes: counts });
    const b = realisticSchedule(S, 0, adherence(0.1), rp, { fastOutcomes: counts });
    expect(a).toEqual(S);
    expect(b).toEqual(S);
    const omitted = realisticSchedule(S, 0, adherence(0.9), rp, { scenario: 'missingData' });
    expect(keptShare(omitted)).toBe(0);
    for (const d of zeroDays(omitted)) expect(dayTemplate(omitted, d).energy).toEqual({ kind: 'kcal', kcal: rp.tdee0Kcal });
  });

  it('the path mixture is continuous in p: averaged over paths the kept share converges to p (finite paths are stepwise)', () => {
    const seed = behaviorSeed(S);
    for (const p of [0.2, 0.5, 0.8]) {
      let kept = 0;
      const paths = 40;
      for (let path = 0; path < paths; path++) {
        const keep = fastPathKeeper(seed, p, path);
        for (let i = 0; i < 70; i++) if (keep(i)) kept++;
      }
      expect(Math.abs(kept / (paths * 70) - p)).toBeLessThan(0.03);
    }
    expect(behaviorPathU(seed, 0, 3)).toBe(behaviorPathU(seed, 0, 3));
    expect(behaviorSeed(S, 2)).not.toBe(behaviorSeed(S, 1));
  });

  it('the omission scenario skips every fast whole; the default keeps fasts unless their credit is 0', () => {
    const omit = creditSchedule(S, 0, S.horizonDays, () => 0, rp, () => false);
    expect(keptShare(omit)).toBe(0);
    const partial = creditSchedule(S, 0, S.horizonDays, () => 0.3, rp);
    expect(keptShare(partial)).toBe(1);
    expect(scaleDay(zero, () => 0.3, rp)).toBe(zero);
    expect(scaleDay(zero, () => 0.3, rp, false).energy).toEqual({ kind: 'pctMaintenance', pct: 100 });
  });

  it('fast events use the same explicit full-dose and missing-input scenarios', () => {
    const withEvents: Schedule = { ...S, programs: [eat], days: S.days.map(() => ({ program: 0 })), events: Array.from({ length: 20 }, (_, i) => ({ kind: 'fast' as const, startDay: 7 * i, startH: 20, durationH: 36, electrolytes: true })) };
    const kept = realisticSchedule(withEvents, 0, adherence(0.2), rp).events!.length;
    expect(kept).toBe(20);
    const observed = realisticSchedule(withEvents, 0, adherence(0.2), rp, { fastOutcomes: { done: 0, partial: 0, skipped: 10 } }).events!.length;
    expect(observed).toBe(20);
    const omitted = realisticSchedule(withEvents, 0, adherence(0.2), rp, { scenario: 'missingData' });
    expect(omitted.events).toEqual([]);
    expect(BEHAVIOR_FORECAST).toMatchObject({ algorithm: 'plausibleExecution', calibration: 'heuristic' });
  });
});
