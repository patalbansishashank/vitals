/**
 * D4-04 — calendar energy-availability exposure (every day counts, fasts included; unknown is incomplete, never zero; the
 * legacy eating-day statistic keeps its own name; 30 is a policy reference, nothing is decided from it alone) and D4-05 —
 * goal monitoring beyond weight (paired blood-pressure episodes with measurement time, protocol status and preserved
 * readings; a BP-only plan is monitored without weigh-ins or a weight goal).
 */
import { describe, expect, it } from 'vitest';
import type { PersonProfile, Schedule } from '@/engine';
import {
  addDays,
  bpEpisodes,
  calendarEnergyAvailability,
  dailyEa,
  DEFAULT_ITEM_WEIGHTS,
  EA_POLICY_REFERENCE,
  eatingDayEa,
  monitorGoals,
  projectLiving,
  type DayStatusDoc,
  type EaLedgerDay,
  type LogEntry,
  type MeasurementEntry,
  type PlanDoc,
  type PlanVersionDoc,
} from '@/living';

const day = (date: string, ei: number | null, coverage: EaLedgerDay['eiCoverage'], eee: number | null, ffm: number | null, fastDay = false): EaLedgerDay => ({ date, eiKcal: ei, eiCoverage: coverage, eeeNetKcal: eee, exerciseCoverage: eee === null ? 'unknown' : 'complete', exerciseScope: 'actualDay', ffmKg: ffm, ffmBasis: ffm === null ? 'unknown' : 'model', fastDay });

describe('calendar energy availability (D4-04)', () => {
  it('regression: 60 kg FFM, four 2700/250 days and three zero-intake fast days → eating-day 40.83, calendar 23.33', () => {
    const ledger = [
      day('2026-10-01', 2700, 'complete', 250, 60), day('2026-10-02', 0, 'confirmedZero', 0, 60, true), day('2026-10-03', 2700, 'complete', 250, 60),
      day('2026-10-04', 0, 'confirmedZero', 0, 60, true), day('2026-10-05', 2700, 'complete', 250, 60), day('2026-10-06', 0, 'confirmedZero', 0, 60, true), day('2026-10-07', 2700, 'complete', 250, 60),
    ];
    const c7 = calendarEnergyAvailability(ledger, '2026-10-07', 7);
    expect(c7.ea.value).toBeCloseTo(23.333, 3);
    expect(c7.numeratorKcal).toBeCloseTo(9800, 9);
    expect(c7.ffmKgDays).toBeCloseTo(420, 9);
    expect(c7.ea.unit).toBe('kcal/kg FFM/day');
    expect(c7.ea.status).toBe('scenario'); // a model FFM: never a measured exposure
    expect(eatingDayEa(ledger, '2026-10-07', 7).value).toBeCloseTo(40.833, 3);
    // the planned fast days stay in the calendar window (their exposure is never deleted)
    expect(c7.days).toBe(7);
    expect(c7.belowReferenceDays).toBe(3);
  });

  it('hand calculation with changing FFM and negative EA: FFM-weighted, unclipped', () => {
    const ledger = [day('2026-10-01', 2000, 'complete', 500, 50), day('2026-10-02', 0, 'confirmedZero', 400, 52, true)];
    expect(dailyEa(ledger[1]!)).toBeCloseTo(-400 / 52, 12);
    const c = calendarEnergyAvailability(ledger, '2026-10-02', 7);
    expect(c.ea.value).toBeCloseTo((1500 - 400) / (50 + 52), 12);
    // day 1 sits exactly at the reference (not below it)
    expect(c.longestBelowReferenceRun).toBe(1);
  });

  it('missing intake is incomplete, never zero or reassuring; partial logs give only a lower bound', () => {
    const unknown = calendarEnergyAvailability([day('2026-10-01', 2400, 'complete', 0, 60), day('2026-10-02', null, 'unknown', 0, 60)], '2026-10-02', 7);
    expect(unknown.ea.status).toBe('partial');
    expect(unknown.ea.value).toBeUndefined();
    expect(unknown.lowerBound).toBeUndefined();
    expect(unknown.covered).toBe(1);
    const partial = calendarEnergyAvailability([day('2026-10-01', 2400, 'complete', 0, 60), day('2026-10-02', 600, 'partial', 0, 60)], '2026-10-02', 7);
    expect(partial.ea.status).toBe('partial');
    expect(partial.lowerBound).toBeCloseTo(3000 / 120, 12);
    // an unknown session cost is incomplete too
    expect(dailyEa(day('2026-10-03', 2000, 'complete', null, 60))).toBeNull();
  });

  it('30 is a disclosed precautionary policy reference, not a safe/unsafe boundary', () => {
    expect(EA_POLICY_REFERENCE).toEqual({ value: 30, unit: 'kcal/kg FFM/day', basis: 'precautionaryPolicy' });
  });
});

const source = { by: 'user' as const, method: 'typed' as const };
const bp = (id: string, metric: 'sbpMmHg' | 'dbpMmHg', value: number, date: string, extra: Partial<MeasurementEntry> = {}): MeasurementEntry => ({ id, date, metric, value, source, recordedAt: `${date}T20:00:00.000Z`, ...extra });

describe('blood-pressure episodes (D4-05)', () => {
  it('pairs one sitting atomically with its measurement time; legacy and unpaired readings stay valid with their protocol status', () => {
    const ms = [
      bp('s1', 'sbpMmHg', 132, '2026-10-05', { episodeId: 'e1', occurrence: { precision: 'exact', at: '2026-10-05T07:10:00.000Z', dateMeaning: 'appDay', source: 'user' }, setting: 'home', restMin: 5, timeOfDay: 'morning' }),
      bp('d1', 'dbpMmHg', 84, '2026-10-05', { episodeId: 'e1' }),
      bp('s2', 'sbpMmHg', 128, '2026-10-06', { episodeId: 'e2', repeats: [126], repeatsEncoding: 'primaryPlusAdditional' }),
      bp('legacy', 'sbpMmHg', 140, '2026-10-01'),
    ];
    const eps = bpEpisodes(ms);
    expect(eps.map((e) => [e.id, e.protocol])).toEqual([['id:legacy', 'protocolUnknown'], ['ep:e1', 'paired'], ['ep:e2', 'incompleteProtocol']]);
    const e1 = eps.find((e) => e.id === 'ep:e1')!;
    expect(e1).toMatchObject({ sbp: 132, dbp: 84, occurredAt: '2026-10-05T07:10:00.000Z', recordedAt: '2026-10-05T20:00:00.000Z', setting: 'home', restMin: 5, timeOfDay: 'morning' });
    // repeats are kept as individual readings for safety review
    expect(eps.find((e) => e.id === 'ep:e2')!.readings.sbp).toEqual([128, 126]);
  });

  it('deduplicates a reading recorded twice, follows edits and retractions', () => {
    const ms = [
      bp('s1', 'sbpMmHg', 150, '2026-10-05', { episodeId: 'e1' }),
      { ...bp('s1b', 'sbpMmHg', 135, '2026-10-05', { episodeId: 'e1' }), supersedes: 's1' },
      bp('d1', 'dbpMmHg', 85, '2026-10-05', { episodeId: 'e1' }),
      bp('x', 'sbpMmHg', 170, '2026-10-06'),
      { ...bp('r', 'sbpMmHg', 0, '2026-10-06'), kind: 'retract', target: 'x' } as unknown as MeasurementEntry,
    ];
    const eps = bpEpisodes(ms);
    expect(eps).toHaveLength(1);
    expect(eps[0]).toMatchObject({ sbp: 135, dbp: 85, protocol: 'paired' });
  });
});

const MACROS = { protein: { unit: 'g' as const, value: 120 }, carbs: { unit: 'g' as const, value: 200 }, fat: { unit: 'remainder' as const } };
const START = '2026-09-28';
const PERSON: PersonProfile = { schemaVersion: 1, body: { sex: 'female', ageYears: 52, heightCm: 165, weightKg: 70 }, startDate: START };
const SCHEDULE: Schedule = { schemaVersion: 1, startDate: START, horizonDays: 28, programs: [{ id: 'A', label: 'day', energy: { kind: 'kcal', kcal: 1900 }, macros: MACROS }], days: Array.from({ length: 28 }, () => ({ program: 0 })) };

describe('a blood-pressure-only plan is monitored without weigh-ins or a weight goal (D4-05)', () => {
  it('projects observed BP rows with counts and the latest paired sitting; no drift needed', () => {
    const plan: PlanDoc & { id: string } = {
      id: '01JABCDEFGHJKMNPQRSTVWXYZ6', name: 'BP', rung: 'custom', origin: { kind: 'scenario', scenarioId: 's', scenarioRev: '1' }, status: 'active',
      startDate: START, plannedEndDate: addDays(START, 28), request: { profile: PERSON, goals: [{ metric: 'sbp', direction: 'target', target: 125 }], horizonDays: 28 }, baselineProfile: PERSON, headVersion: 1,
      pauses: [], intentions: {}, policy: { checkInWeekday: 0, autoApplyLoadLowering: true }, createdAt: `${START}T08:00:00.000Z`,
    };
    const version: PlanVersionDoc = {
      planId: plan.id, version: 1, parent: null, status: 'adopted', reason: 'start', effectiveFromDay: 0, schedule: SCHEDULE, genome: null, sessions: {},
      sensitivities: { planVersion: 'v1', itemWeights: { ...DEFAULT_ITEM_WEIGHTS }, intentByItem: {} }, forecast: { fromDay: 0, asPrescribed: {}, realistic: {}, goals: [], warnings: [] }, explanation: [],
      provenance: { engineVersion: 'e', registryHash: 'r', catalogueVersion: 'c' }, createdBy: { kind: 'system' }, createdAt: `${START}T08:00:00.000Z`,
    };
    const measurements = [
      bp('s1', 'sbpMmHg', 138, '2026-10-01', { episodeId: 'a' }), bp('d1', 'dbpMmHg', 88, '2026-10-01', { episodeId: 'a' }),
      bp('s2', 'sbpMmHg', 131, '2026-10-08', { episodeId: 'b' }), bp('d2', 'dbpMmHg', 83, '2026-10-08', { episodeId: 'b' }),
    ];
    const p = projectLiving({ docs: { plan, versions: [version], dayStatus: [], entries: [], measurements, records: [] }, today: '2026-10-10', tz: 'UTC', now: '2026-10-10T12:00:00.000Z', skipAssimilation: true });
    expect(p.drift).toBeNull();
    expect(p.monitoring).toHaveLength(1);
    expect(p.monitoring[0]).toMatchObject({ metric: 'sbp', measurement: 'sbpMmHg', unit: 'mmHg', status: 'observed', forecast: 'observedOnly', target: 125, readings: 2, days: 2, change: -7 });
    expect(p.monitoring[0]!.bp).toMatchObject({ episodes: 2, paired: 2, latest: { sbp: 131, dbp: 83, date: '2026-10-08' } });
    // the exposure ledger covers every elapsed day; unlogged intake is incomplete, never zero
    expect(p.energyExposure?.ledger).toHaveLength(12);
    expect(p.energyExposure?.calendar7.ea.status).toBe('partial');
  });

  it('a goal without a logged observable gets an unknown row, never a zero', () => {
    const rows = monitorGoals({ startDate: START, request: { profile: PERSON, goals: [{ metric: 'waist', direction: 'minimise' }], horizonDays: 28 } }, [], '2026-10-10');
    expect(rows[0]).toMatchObject({ status: 'unknown', readings: 0, latest: null, change: null });
  });
});

describe('EA never decides alone (D4-04)', () => {
  const plan: PlanDoc & { id: string } = {
    id: '01JABCDEFGHJKMNPQRSTVWXYZ8', name: 'EA', rung: 'custom', origin: { kind: 'scenario', scenarioId: 's', scenarioRev: '1' }, status: 'active',
    startDate: START, plannedEndDate: addDays(START, 28), request: { profile: PERSON, goals: [], horizonDays: 28 }, baselineProfile: PERSON, headVersion: 1,
    pauses: [], intentions: {}, policy: { checkInWeekday: 6, autoApplyLoadLowering: true }, createdAt: `${START}T08:00:00.000Z`,
  };
  const version: PlanVersionDoc = {
    planId: plan.id, version: 1, parent: null, status: 'adopted', reason: 'start', effectiveFromDay: 0, schedule: SCHEDULE, genome: null, sessions: {},
    sensitivities: { planVersion: 'v1', itemWeights: { ...DEFAULT_ITEM_WEIGHTS }, intentByItem: {} }, forecast: { fromDay: 0, asPrescribed: {}, realistic: {}, goals: [], warnings: [] }, explanation: [],
    provenance: { engineVersion: 'e', registryHash: 'r', catalogueVersion: 'c' }, createdBy: { kind: 'system' }, createdAt: `${START}T08:00:00.000Z`,
  };
  const est = (value: number) => ({ value, sd: 0 });
  const meal = (id: string, date: string, kcal: number) => ({ id, date, tz: 'UTC', kind: 'meal', clockH: 13, components: [], totals: { energyKcal: est(kcal), proteinG: est(120), carbG: est(300), fatG: est(100) }, source }) as unknown as LogEntry;
  const project = (entries: LogEntry[], dayStatus: DayStatusDoc[]) =>
    projectLiving({ docs: { plan, versions: [version], dayStatus, entries, measurements: [], records: [] }, today: '2026-10-01', tz: 'UTC', now: '2026-10-01T12:00:00.000Z', skipAssimilation: true });

  it('a flagged concern stays a Review even when the day’s EA reads above the policy reference', () => {
    const concern = { id: 'c1', date: '2026-09-30', tz: 'UTC', kind: 'subjective', concerns: ['menstrualChange'], source } as unknown as LogEntry;
    const p = project([meal('m1', '2026-09-30', 3000), concern], [{ date: '2026-09-30', intake: 'complete' }]);
    // (A1-057) no session log proves no amount: exercise is unknown, so only the no-extra-exercise upper bound exists
    const read = p.energyAvailability!.read;
    expect(read.ea.status).toBe('unknown');
    expect(read.upperBound!).toBeGreaterThan(EA_POLICY_REFERENCE.value);
    expect(p.today.notices.some((n) => n.id === 'wellbeingReview')).toBe(true);
  });

  it('a confirmed zero-intake day reads as low EA, adds no review and removes nothing from the plan', () => {
    const p = project([], [{ date: '2026-09-30', intake: 'none' }]);
    // EA ≤ (0 − 0)/FFM whatever unlogged exercise happened: the upper bound is already below the reference
    expect(p.energyAvailability!.read.upperBound!).toBeLessThan(EA_POLICY_REFERENCE.value);
    expect(p.today.notices.filter((n) => n.kind === 'safety' || n.id === 'wellbeingReview')).toEqual([]);
    expect(p.today.prescription?.energyKcal).toBeCloseTo(1900, 6);
  });
});
