/**
 * D5-08 — behaviour prediction without equating utility credit with physiology: descriptive credit and coverage stay useful
 * for partial days; same-day opportunities are one cluster; completion probabilities come from observed outcomes, never from
 * the Beta mean, and there is no 0.5 switch; scenarios preserve event doses; seeded paths replay; the ensemble simulates
 * each path before averaging (E[f(D)] ≠ f(E[D])); held-out weeks are scored against a simple baseline, never causally.
 */
import { describe, expect, it } from 'vitest';
import type { Schedule } from '@/engine';
import {
  applyBehaviorPath,
  BEHAVIOR_FORECAST_VERSION,
  BEHAVIOUR_CREDIT_SEMANTICS,
  behaviorForecastMeta,
  behaviorPathSeed,
  clusterSameDay,
  completionEvidence,
  completionProbabilities,
  ensembleOutcome,
  expectedCreditFor,
  medianPartialFastH,
  opportunitiesOf,
  prospectiveCompletionScore,
  revealedAdherence,
  sampleBehaviorPaths,
  scoreDay,
  templateOfDay,
  type CompletionProbabilities,
  type CreditObservation,
  type OutcomeObservation,
  type PrescribedItem,
} from '@/living';

const MACROS = { protein: { unit: 'g' as const, value: 120 }, carbs: { unit: 'g' as const, value: 200 }, fat: { unit: 'remainder' as const } };
const START = '2026-09-28';
const ex = { kind: 'resistance' as const, startH: 18, durationMin: 60, volume: 'moderate' as const };
const SCHEDULE: Schedule = {
  schemaVersion: 1, startDate: START, horizonDays: 14,
  programs: [
    { id: 'A', label: 'train', energy: { kind: 'kcal', kcal: 2000 }, macros: MACROS, exercise: [ex] },
    { id: 'B', label: 'rest', energy: { kind: 'kcal', kcal: 1800 }, macros: MACROS },
  ],
  days: Array.from({ length: 14 }, (_, d) => ({ program: d % 2 })),
  events: [{ kind: 'fast', startDay: 3, startH: 20, durationH: 36 }, { kind: 'fast', startDay: 10, startH: 20, durationH: 36 }],
};

describe('semantics and versions (C7)', () => {
  it('the Beta posterior is a heuristic utility summary, never a completion probability; forecasts are versioned heuristics', () => {
    expect(BEHAVIOUR_CREDIT_SEMANTICS).toMatchObject({ estimand: 'utilityCredit', completionProbability: false, interval: 'heuristic', calibration: 'heuristic' });
    expect(behaviorForecastMeta('pathEnsemble', { seed: 7, paths: 16 })).toEqual({ algorithm: 'pathEnsemble', version: BEHAVIOR_FORECAST_VERSION, seed: 7, paths: 16, calibration: 'heuristic' });
  });
});

describe('descriptive credit and coverage', () => {
  it('stay useful for missing and partial days (unknown items drop out, never failures)', () => {
    const items: PrescribedItem[] = [
      { itemId: 'energy', type: 'energy', weight: 0.5, target: {} },
      { itemId: 'rt', type: 'rtSession', weight: 0.3, target: {} },
      { itemId: 'steps', type: 'steps', weight: 0.2, target: {} },
    ];
    const s = scoreDay(items, [{ itemId: 'energy', credit: 1, why: '' }, { itemId: 'rt', credit: 0.5, why: '' }], { final: true });
    expect(s.coverage).toBeCloseTo(0.8, 12);
    expect(s.score).toBeCloseTo((100 * (0.5 + 0.15)) / 0.8, 9);
    expect(s.items.find((i) => i.itemId === 'steps')?.credit).toBeNull();
  });
});

describe('same-day opportunities are one cluster', () => {
  it('two sessions on one day enter once (opportunities count days)', () => {
    const obs: CreditObservation[] = [
      { date: '2026-10-01', type: 'rtSession', credit: 1 },
      { date: '2026-10-01', type: 'rtSession', credit: 0 },
      { date: '2026-10-02', type: 'rtSession', credit: 1 },
    ];
    expect(clusterSameDay(obs)).toEqual([{ date: '2026-10-01', type: 'rtSession', credit: 0.5 }, { date: '2026-10-02', type: 'rtSession', credit: 1 }]);
    const b = revealedAdherence(obs, '2026-10-02').find((x) => x.type === 'rtSession' && x.weekday === undefined)!;
    expect(b.opportunities).toBe(2);
    const e = completionEvidence(obs.map((o) => ({ date: o.date, type: o.type, status: o.credit === 1 ? 'done' : 'skipped' })), '2026-10-02');
    expect(e[0]).toMatchObject({ days: 2, done: 1, partial: 1, skipped: 0 });
  });
});

describe('completion probability is not the utility mean (no 0.5 switch)', () => {
  const statuses = (n: number, status: OutcomeObservation['status']): OutcomeObservation[] => Array.from({ length: n }, (_, k) => ({ date: `2026-10-${String(1 + k).padStart(2, '0')}`, type: 'fast', status }));

  it('changing the credits of partial outcomes moves the Beta mean, not the completion probabilities', () => {
    const low: CreditObservation[] = statuses(6, 'partial').map((o) => ({ date: o.date, type: 'fast', credit: 0.2 }));
    const high: CreditObservation[] = low.map((o) => ({ ...o, credit: 0.9 }));
    expect(expectedCreditFor(revealedAdherence(low, '2026-10-06'), 'fast')).not.toBeCloseTo(expectedCreditFor(revealedAdherence(high, '2026-10-06'), 'fast'), 2);
    const ev = completionEvidence(statuses(6, 'partial'), '2026-10-06');
    const p = completionProbabilities(ev, 'fast')!;
    expect(p.basis).toBe('observedOutcomes');
    expect(p.partial).toBeGreaterThan(p.done);
    expect(p.done + p.partial + p.skipped).toBeCloseTo(1, 12);
    expect(completionProbabilities([], 'fast')).toBeNull();
  });

  it('the share of paths keeping a fast moves continuously with p(done): no all-or-nothing switch at 0.5', () => {
    const opps = opportunitiesOf(SCHEDULE, 0).filter((o) => o.type === 'fast');
    const kept = (done: number): number => {
      const prob: CompletionProbabilities = { done, partial: 0, skipped: 1 - done, basis: 'observedOutcomes', effectiveDays: 10 };
      const paths = sampleBehaviorPaths({ opportunities: opps, scenario: 'plausibleExecution', probabilities: () => prob, planId: 'p', version: 1, paths: 64 });
      return paths.flatMap((p) => Object.values(p.outcomes)).filter((o) => o === 'done').length / (paths.length * opps.length);
    };
    const a = kept(0.45);
    const b = kept(0.55);
    expect(a).toBeGreaterThan(0.2);
    expect(b).toBeLessThan(0.85);
    expect(Math.abs(b - a)).toBeLessThan(0.35);
    expect(kept(0.05)).toBeLessThan(a);
    expect(kept(0.95)).toBeGreaterThan(b);
  });
});

describe('scenarios preserve event doses; seeded paths replay', () => {
  const opps = opportunitiesOf(SCHEDULE, 0);
  it('as prescribed keeps every dose; missing data replays the habitual baseline; nothing before fromDay changes', () => {
    const [asRx] = sampleBehaviorPaths({ opportunities: opps, scenario: 'asPrescribed', probabilities: () => null, planId: 'p', version: 1 });
    expect(applyBehaviorPath(SCHEDULE, asRx!, 0)).toEqual({ ...SCHEDULE, days: SCHEDULE.days.map((d) => ({ ...d })), events: SCHEDULE.events });
    const [missing] = sampleBehaviorPaths({ opportunities: opps, scenario: 'missingData', probabilities: () => null, planId: 'p', version: 1 });
    const m = applyBehaviorPath(SCHEDULE, missing!, 4);
    expect(m.events).toEqual([SCHEDULE.events![0]]); // the day-3 fast is before fromDay
    expect(templateOfDay(m, 2).exercise).toEqual([ex]);
    expect(templateOfDay(m, 4).exercise).toEqual([]);
  });

  it('a partial fast ends at the person’s median observed partial fast, else the overnight gap — never a credit-scaled fast', () => {
    const path = { index: 0, seed: 1, outcomes: { '3:fast': 'partial' as const, '10:fast': 'partial' as const }, assumptions: [] };
    expect(applyBehaviorPath(SCHEDULE, path, 0, { partialFastH: medianPartialFastH([14, 18, 20]) }).events!.map((e) => e.durationH)).toEqual([18, 18]);
    expect(applyBehaviorPath(SCHEDULE, path, 0).events!.map((e) => e.durationH)).toEqual([12, 12]);
  });

  it('seeds derive from plan, version and path index: the same inputs replay exactly, a new version reshuffles', () => {
    const prob: CompletionProbabilities = { done: 0.6, partial: 0.2, skipped: 0.2, basis: 'observedOutcomes', effectiveDays: 8 };
    const run = (version: number) => sampleBehaviorPaths({ opportunities: opps, scenario: 'plausibleExecution', probabilities: () => prob, planId: 'p', version, paths: 8 });
    expect(run(1)).toEqual(run(1));
    expect(run(1).map((p) => p.seed)).not.toEqual(run(2).map((p) => p.seed));
    expect(behaviorPathSeed('p', 1, 3)).toBe(behaviorPathSeed('p', 1, 3));
  });

  it('a type without evidence replays as prescribed, and says so', () => {
    const paths = sampleBehaviorPaths({ opportunities: opps, scenario: 'plausibleExecution', probabilities: (t) => (t === 'fast' ? null : { done: 1, partial: 0, skipped: 0, basis: 'observedOutcomes', effectiveDays: 3 }), planId: 'p', version: 1, paths: 4 });
    expect(paths.every((p) => p.outcomes['3:fast'] === 'done' && p.assumptions.includes('noEvidence:fast:asPrescribed'))).toBe(true);
  });
});

describe('the ensemble simulates before summarising (E[f(D)] ≠ f(E[D]))', () => {
  it('averages simulated outcomes of whole paths, not a fractional mean dose', () => {
    const opps = opportunitiesOf(SCHEDULE, 0).filter((o) => o.type === 'fast');
    const prob: CompletionProbabilities = { done: 0.5, partial: 0, skipped: 0.5, basis: 'observedOutcomes', effectiveDays: 10 };
    const paths = sampleBehaviorPaths({ opportunities: opps, scenario: 'plausibleExecution', probabilities: () => prob, planId: 'p', version: 1, paths: 64 });
    // a nonlinear "model": the outcome responds to the square of the fasting hours of a path
    const fastH = (s: Schedule) => (s.events ?? []).reduce((a, e) => a + e.durationH, 0);
    const f = (h: number) => (h / 36) ** 2;
    const summary = ensembleOutcome(paths, (p) => [f(fastH(applyBehaviorPath(SCHEDULE, p, 0)))], 'plausibleExecution');
    const meanDose = paths.reduce((a, p) => a + fastH(applyBehaviorPath(SCHEDULE, p, 0)), 0) / paths.length;
    expect(summary.mean[0]).not.toBeCloseTo(f(meanDose), 2);
    expect(summary.meta).toMatchObject({ algorithm: 'pathEnsemble', calibration: 'heuristic', paths: 64 });
    expect(summary.p10[0]!).toBeLessThanOrEqual(summary.p50[0]!);
    expect(summary.p50[0]!).toBeLessThanOrEqual(summary.p90[0]!);
  });

  it('skips non-finite path values instead of averaging them as zero', () => {
    const paths = [0, 1, 2].map((index) => ({ index, seed: index, outcomes: {}, assumptions: [] }));
    const s = ensembleOutcome(paths, (p) => [p.index === 1 ? Number.NaN : 10], 'plausibleExecution');
    expect(s.mean[0]).toBe(10);
  });
});

describe('prospective scoring on held-out weeks (predictive only)', () => {
  it('fits on earlier weeks, scores the later ones with a proper score and bias against the as-prescribed baseline', () => {
    const train: OutcomeObservation[] = Array.from({ length: 14 }, (_, k) => ({ date: `2026-10-${String(1 + k).padStart(2, '0')}`, type: 'rtSession', status: k % 2 === 0 ? 'done' : 'skipped' }));
    const test: OutcomeObservation[] = Array.from({ length: 7 }, (_, k) => ({ date: `2026-10-${String(15 + k).padStart(2, '0')}`, type: 'rtSession', status: k % 2 === 0 ? 'done' : 'skipped' }));
    const r = prospectiveCompletionScore([...train, ...test], '2026-10-15');
    expect(r.causal).toBe(false);
    expect(r.heldOutDays).toBe(7);
    expect(r.brier).not.toBeNull();
    expect(r.brier!).toBeLessThan(r.baselineBrier!);
    expect(Math.abs(r.bias!)).toBeLessThan(0.2);
  });
});
