// @vitest-environment node
import type { DayTemplate, PersonProfile, Schedule } from '@/engine';
import type { PlanOption, PlannerRequest } from '@/engine/planner/domain/types';
import { startPlanFromOption, RUNG_OF_OPTION } from '@/features/planner/startPlan';
import { freezeGoalTargets, startFromScenario } from '../start';
import { anchorsFromRecords, blockStartsOf, contentHash, hardReanchorReason, stableStringify, weighInsFor } from '../assimilate';
import type { ConfirmedStateRecord, LogEntry, MeasurementEntry } from '../types';

const MAN: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 40, heightCm: 180, weightKg: 90 }, startDate: '2026-10-05' };
const A: DayTemplate = { id: 'A', label: 'train', energy: { kind: 'kcal', kcal: 2000 }, macros: { protein: { unit: 'g', value: 160 }, carbs: { unit: 'g', value: 200 }, fat: { unit: 'remainder' } } };
const SCHED: Schedule = { schemaVersion: 1, startDate: '2026-10-05', horizonDays: 56, programs: [A], days: Array.from({ length: 56 }, () => ({ program: 0 })), blocks: [{ name: 'a', startDay: 0, endDay: 28 }, { name: 'b', startDay: 28, endDay: 56 }] };
const request: PlannerRequest = { profile: MAN, goals: [{ metric: 'scaleWeight', direction: 'target', target: -6, targetKind: 'change' }, { metric: 'leanTissue', direction: 'maximise' }], horizonDays: 56 };
const band = new Float32Array(57).map((_, k) => 90 - 0.1 * k);
const option = {
  id: 'B', name: 'B', schedule: SCHED, simulation: { meta: { registryHash: 'reg', engineVersion: 'eng' }, daily: {} },
  scorecard: [{ goal: 0, metric: 'scaleWeight', start: 90, value: 84.4, band: { p10: 84, p50: 84.4, p90: 85, pTargetMet: 0.6 } }, { goal: 1, metric: 'leanTissue', start: 55, value: 55.2, band: null }],
  bands: { draws: 16, series: { scaleWeight: { p10: band.map((x) => x - 1), p50: band, p90: band.map((x) => x + 1) } } },
  safetyNotes: [], safetyItems: [{ text: 'Keep protein high.', severity: 'info' }], explanation: ['Medium plan.'],
} as unknown as PlanOption;

describe('start this plan', () => {
  const ctx = { planId: 'p9', now: '2026-10-01T09:00:00.000Z', today: '2026-10-01', createdBy: { kind: 'user' as const }, versions: { engineVersion: 'e', registryHash: 'r', catalogueVersion: 'c' } };

  it('starts a Simulator scenario as a custom plan: scenario origin, name, anchored schedule, frozen goals', () => {
    const out = startFromScenario(ctx, { id: 'sc1', rev: 'r7', name: 'My cut', schedule: SCHED }, MAN, request.goals, { startDate: '2026-10-05', startValues: new Map([[0, 90]]) });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.plan).toMatchObject({ id: 'p9', name: 'My cut', rung: 'custom', status: 'scheduled', startDate: '2026-10-05', origin: { kind: 'scenario', scenarioId: 'sc1', scenarioRev: 'r7' } });
    expect(out.plan.request.goals[0]).toMatchObject({ target: 84, targetKind: 'absolute' });
    expect(out.version).toMatchObject({ version: 1, reason: 'start', genome: null });
    expect(out.version.schedule.startDate).toBe('2026-10-05');
    expect(out.anchorNotes).toEqual([]);
    expect(startFromScenario(ctx, { id: 'sc1', rev: 'r7', name: 'x', schedule: SCHED }, MAN, [], { startDate: '2026-11-30' })).toMatchObject({ ok: false });
  });

  it('freezes change targets as absolute values from the start values', () => {
    expect(freezeGoalTargets(request.goals, new Map([[0, 90]]))[0]).toMatchObject({ target: 84, targetKind: 'absolute' });
    expect(freezeGoalTargets(request.goals, new Map())[0]).toMatchObject({ target: -6, targetKind: 'change' });
  });

  it('builds the plan and version 1 from a planner option (default start tomorrow, anchored, forecast by plan day)', () => {
    const out = startPlanFromOption(ctx, option, request, null);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(RUNG_OF_OPTION.B).toBe('medium');
    expect(out.plan).toMatchObject({ id: 'p9', rung: 'medium', status: 'scheduled', startDate: '2026-10-02', plannedEndDate: '2026-11-27', headVersion: 1 });
    expect(out.plan.request.goals[0]).toMatchObject({ target: 84, targetKind: 'absolute' });
    expect(out.plan.baselineProfile.startDate).toBe('2026-10-02');
    expect(out.version).toMatchObject({ version: 1, status: 'adopted', reason: 'start', effectiveFromDay: 0 });
    // 2026-10-02 is a Friday: four days of week 1 are skipped (the forecast index moves with them)
    expect(out.anchorNotes[0]).toMatch(/skips the first 4 days/);
    expect(out.version.forecast.fromDay).toBe(-4);
    expect(out.version.forecast.asPrescribed.scaleWeight!.p50[0]).toBeCloseTo(89.9, 5);
    expect(out.version.forecast.warnings[0]!.text).toBe('Keep protein high.');
    expect(Object.values(out.version.sensitivities.itemWeights).every((w) => w > 0)).toBe(true);
  });

  it('refuses a start date beyond 28 days', () => {
    expect(startPlanFromOption(ctx, option, request, null, { startDate: '2026-11-15' }).ok).toBe(false);
  });
});

describe('estimation-loop rules', () => {
  const plan = { startDate: '2026-10-05' };
  const src = { by: 'user' as const, method: 'typed' as const };

  it('weigh-ins: standardisation by context, ×4 noise for 4 days after an event or a block start, assumed entries ignored', () => {
    const ms: MeasurementEntry[] = [
      { id: 'a', date: '2026-10-06', metric: 'weightKg', value: 90, source: src },
      { id: 'b', date: '2026-10-07', metric: 'weightKg', value: 90.4, context: 'evening', source: src },
      { id: 'c', date: '2026-10-08', metric: 'weightKg', value: 90, source: src, assumed: true },
      { id: 'd', date: '2026-11-03', metric: 'weightKg', value: 88, source: src },
    ];
    const ev: LogEntry[] = [{ id: 'e', date: '2026-10-07', tz: 'UTC', source: src, kind: 'event', event: 'creatineStart' } as LogEntry];
    const w = weighInsFor(plan, ms, [{ date: '2026-10-09', weights: [{ kg: 89.8, context: 'morning', source: 'scale' }] }], ev, blockStartsOf(SCHED));
    expect(w.map((x) => [x.day, x.standardised, x.rMult])).toEqual([[1, true, 1], [2, false, 4], [4, true, 4], [29, true, 4]]);
  });

  it('hard re-anchor reasons in priority order', () => {
    const base = { today: '2026-10-20', plan, entries: [] as LogEntry[], measurements: [] as MeasurementEntry[], blockStarts: [28], lastRecordEngine: { engineVersion: 'e', registryHash: 'r' }, currentEngine: { engineVersion: 'e', registryHash: 'r' }, lastWeighInBefore: '2026-10-19', longFastEnded: false };
    expect(hardReanchorReason(base)).toBeNull();
    expect(hardReanchorReason({ ...base, currentEngine: { engineVersion: 'e2', registryHash: 'r' } })).toBe('engineVersion');
    expect(hardReanchorReason({ ...base, measurements: [{ id: 'x', date: '2026-10-20', metric: 'bodyFatPct', value: 22, method: 'dxa', source: src }] })).toBe('dxa');
    expect(hardReanchorReason({ ...base, lastWeighInBefore: '2026-10-01', measurements: [{ id: 'y', date: '2026-10-20', metric: 'weightKg', value: 88, source: src }] })).toBe('weighInGap');
    const ill = ['2026-10-17', '2026-10-18', '2026-10-19'].map((date, k) => ({ id: `i${k}`, date, tz: 'UTC', source: src, kind: 'event', event: 'illness' }) as LogEntry);
    expect(hardReanchorReason({ ...base, entries: ill })).toBe('illness');
    expect(hardReanchorReason({ ...base, longFastEnded: true })).toBe('longFastEnd');
    expect(hardReanchorReason({ ...base, today: '2026-11-02' })).toBe('newBlock');
  });

  it('records → anchors and δ steps (latest record per day wins); stable hashing', () => {
    const rec = (day: number, kcal: number, fatFrac?: number): ConfirmedStateRecord => ({
      planId: 'p', anchorDate: '', anchorDay: day, trendWeight: { kg: 89, sd: 0.2 }, energyBiasKcal: { mean: kcal, sd: 100 },
      residualSplit: { tissueMassKg: 88 + day / 100, residualKg: 0, fatKg: 0, leanKg: 0, source: fatFrac ? 'dxa' : 'engine', ...(fatFrac ? { fatFrac } : {}) },
      inputsHash: '', engine: { engineVersion: 'e', registryHash: 'r' }, trigger: 'weekly',
    });
    const { anchors, offsets } = anchorsFromRecords([rec(14, 0), rec(21, -80), rec(28, -80, 0.24), rec(21, -90)]);
    expect(anchors.map((a) => a.day)).toEqual([14, 21, 28]);
    expect(anchors[2]!.split).toEqual({ fatFrac: 0.24 });
    expect(offsets).toEqual([{ fromDay: 21, kcal: -90 }, { fromDay: 28, kcal: -80 }]);
    expect(stableStringify({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe('{"a":[1,{"c":3,"d":2}],"b":1}');
    expect(contentHash({ a: 1, b: 2 })).toBe(contentHash({ b: 2, a: 1 }));
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }));
  });
});
