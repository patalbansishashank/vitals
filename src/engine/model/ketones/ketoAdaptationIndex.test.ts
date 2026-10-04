// @vitest-environment node
/**
 * Keto-adaptation shown to users (release check 2026-10-01; MODEL_SPEC §6): the `ketoAdaptation` metric is a labelled
 * combined index 50·(A_f + A_s) of dossier 05 §4.11's two states — fast fat-oxidation adaptation (days, `ketoAdaptFast`) and
 * slow ketone-kinetics adaptation (weeks, `ketoAdaptSlow`) — instead of the fast component alone (94 % by day 7). Real engine.
 */
import { compileSchedule } from '../../core/compileSchedule';
import { runEngine } from '../../core/loop';
import { resolveProfile } from '../../core/resolveProfile';
import { seriesDef } from '../../types/metrics';
import type { PersonProfile, Schedule } from '../../types';

vi.setConfig({ testTimeout: 120_000 });

const rp = resolveProfile({ schemaVersion: 1, body: { sex: 'male', ageYears: 34, heightCm: 178, weightKg: 88 }, habits: { sessionsPerWeek: 0 }, startDate: '2026-10-05' } as PersonProfile);
const keto = (pct: number, days: number, fastH?: number): Schedule => ({
  schemaVersion: 1,
  startDate: '2026-10-05',
  horizonDays: days,
  programs: [{ id: 'k', label: 'k', energy: { kind: 'pctMaintenance', pct }, macros: { protein: { unit: 'gPerKgBw', value: 1.6 }, carbs: { unit: 'g', value: fastH ? 200 : 25 }, fat: { unit: 'remainder' } } }],
  days: Array.from({ length: days }, () => ({ program: 0 })),
  ...(fastH ? { events: [{ kind: 'fast' as const, startDay: 0, startH: 19, durationH: fastH }] } : {}),
});
const daily = (s: Schedule) => runEngine(rp, compileSchedule(s, rp), { record: 'daily' }).daily;

describe('keto-adaptation index = 50·(fast + slow), both components recorded', () => {
  it('catalogue: labelled combined index, components are detail series owned by ketones', () => {
    expect(seriesDef('ketoAdaptation').label).toBe('Keto-adaptation index');
    expect(seriesDef('ketoAdaptation').description).toMatch(/each counted half/);
    expect(seriesDef('ketoAdaptFast').kind).toBe('detail');
    expect(seriesDef('ketoAdaptSlow').kind).toBe('detail');
  });

  it('ketogenic diet at maintenance: the fast half completes in a week (≥ 90 %), the index keeps rising over weeks', () => {
    const d = daily(keto(100, 42));
    for (let i = 0; i < 42; i++) expect(d.ketoAdaptation![i]!).toBeCloseTo(0.5 * (d.ketoAdaptFast![i]! + d.ketoAdaptSlow![i]!), 3);
    expect(d.ketoAdaptFast![7]!).toBeGreaterThanOrEqual(90);
    expect(d.ketoAdaptation![7]!).toBeLessThan(55); // was 94-96 with the fast component alone
    expect(d.ketoAdaptation![28]! - d.ketoAdaptation![7]!).toBeGreaterThanOrEqual(3); // weeks, via the slow state
    expect(d.ketoAdaptSlow![28]!).toBeLessThan(20); // 05 §4.11.2: A_s stays small at eucaloric TKB ≈ 1 mM
  });

  it('a 5-day fast drives the slow state (ketones > 2 mM): index above 65 % by day 5', () => {
    const d = daily(keto(100, 8, 120));
    expect(d.ketoAdaptSlow![5]!).toBeGreaterThan(40);
    expect(d.ketoAdaptation![5]!).toBeGreaterThan(65);
  });
});
