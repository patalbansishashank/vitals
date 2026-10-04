// @vitest-environment node
import type { DayTemplate, PersonProfile, Schedule } from '@/engine';
import type { PlannerRequest, PlannerResult } from '@/engine/planner/domain/types';
import { driftCauses, driftGoal, hysteresisState, rawDriftState, goalDateRangeText } from '../drift';
import {
  adoptionPolicy,
  applyEnergyNudge,
  buildReplanRequest,
  checkReplan,
  energyNudge,
  evaluateTriggers,
  legacyPlannerPort,
  missedInARow,
  pickReplan,
  scheduleDiff,
  toActivePlanRecord,
  versionFromReplan,
  type TriggerInputs,
} from '../replan';
import type { ConfirmedState, ItemOutcome, LoggedDay } from '../plannerContract';
import type { PlanDoc, PlanVersionDoc } from '../types';
import { DEFAULT_ITEM_WEIGHTS } from '../prescription';

describe('drift (§3.8)', () => {
  const band = { p10: 84, p50: 85, p90: 86 };
  it('raw state against the 80 % band, by goal direction', () => {
    expect(rawDriftState(83.5, band, 'down')).toBe('ahead');
    expect(rawDriftState(86.5, band, 'down')).toBe('behind');
    expect(rawDriftState(85.2, band, 'down')).toBe('onTrack');
    expect(rawDriftState(86.5, band, 'up')).toBe('ahead');
  });

  it('hysteresis: one check-in outside keeps "on track"; two in a row change it; flapping never does', () => {
    expect(hysteresisState(['behind']).state).toBe('onTrack');
    expect(hysteresisState(['behind', 'behind'])).toEqual({ state: 'behind', checkInsOutside: 2 });
    expect(hysteresisState(['behind', 'onTrack', 'behind', 'onTrack']).state).toBe('onTrack');
    expect(hysteresisState(['behind', 'behind', 'onTrack']).state).toBe('behind');
    expect(hysteresisState(['behind', 'behind', 'onTrack', 'onTrack']).state).toBe('onTrack');
  });

  it('goal date moves only at ≥ 3 days and after two check-ins outside; causes name the main driver; no red words', () => {
    const one = driftGoal({ goal: 0, metric: 'scaleWeight', target: 80, better: 'down', trend: { value: 86.6, sd: 0.2 }, band, previous: [], goalDate: { before: '2026-12-20', after: '2026-12-29', range: ['2026-12-22', '2027-01-05'] } });
    expect(one.state).toBe('onTrack');
    expect(one.goalDate.shiftDays).toBeNull();
    const two = driftGoal({
      goal: 0, metric: 'scaleWeight', target: 80, better: 'down', trend: { value: 86.6, sd: 0.2 }, band, previous: ['behind'],
      goalDate: { before: '2026-12-20', after: '2026-12-29', range: ['2026-12-22', '2027-01-05'] },
      causes: { days: 84, intakeExcessKcal: 0, deltaKcal: 120, rhoKcalPerKg: 7000 },
    });
    expect(two.state).toBe('behind');
    expect(two.goalDate.shiftDays).toBe(9);
    expect(two.causes[0]!.cause).toBe('expenditure');
    expect(two.action).toBe('replan');
    expect(two.text).toMatch(/120 kcal a day less than assumed/);
    const lapse = driftGoal({ goal: 0, metric: 'scaleWeight', target: 80, better: 'down', trend: { value: 86.6, sd: 0.2 }, band, previous: ['behind'], causes: { days: 28, intakeExcessKcal: 350, deltaKcal: 0, rhoKcalPerKg: 7000 } });
    expect(lapse.action).toBe('easeOptions');
    for (const t of [one.text, two.text, lapse.text]) expect(t).not.toMatch(/fail|bad|red|§/i);
    const small = driftGoal({ goal: 0, metric: 'scaleWeight', target: 80, better: 'down', trend: { value: 86.6, sd: 0.2 }, band, previous: ['behind'], goalDate: { before: '2026-12-20', after: '2026-12-22', range: null } });
    expect(small.goalDate.shiftDays).toBeNull();
  });

  it('cause shares sum to 1; ranges wider than two weeks round to weeks', () => {
    const c = driftCauses(1.0, { days: 14, intakeExcessKcal: 200, deltaKcal: 100, rhoKcalPerKg: 7000 });
    expect(c.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 12);
    expect(goalDateRangeText(['2026-12-01', '2026-12-25'])).toMatchObject({ roundedToWeeks: true, to: '2026-12-22' });
  });
});

// ------------------------------------------------------------------------------------------- re-plan
const MAN: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 40, heightCm: 180, weightKg: 90 }, startDate: '2026-10-05' };
const A: DayTemplate = { id: 'A', label: 'train', energy: { kind: 'kcal', kcal: 2000 }, macros: { protein: { unit: 'g', value: 160 }, carbs: { unit: 'g', value: 200 }, fat: { unit: 'remainder' } }, exercise: [{ kind: 'resistance', startH: 18, setsByRegion: { quads: 6 } }] };
const B: DayTemplate = { ...A, id: 'B', label: 'rest', energy: { kind: 'kcal', kcal: 1800 }, exercise: [] };
const head: Schedule = { schemaVersion: 1, startDate: '2026-10-05', horizonDays: 28, programs: [A, B], days: Array.from({ length: 28 }, (_, d) => ({ program: d % 2 })) };
const plan: PlanDoc & { id: string } = {
  id: 'p1', name: 'Hard plan', rung: 'hard', origin: { kind: 'planner', requestHash: 'h', runAt: '2026-10-01T10:00:00.000Z' }, status: 'active',
  startDate: '2026-10-05', plannedEndDate: '2026-11-02', request: { profile: MAN, goals: [{ metric: 'scaleWeight', direction: 'target', target: 84, targetKind: 'absolute' }], horizonDays: 28 },
  baselineProfile: MAN, headVersion: 1, pauses: [], intentions: {}, policy: { checkInWeekday: 0, autoApplyLoadLowering: true }, createdAt: '2026-10-01T10:00:00.000Z',
};
const headV: PlanVersionDoc = {
  planId: 'p1', version: 1, parent: null, status: 'adopted', reason: 'start', effectiveFromDay: 0, schedule: head, genome: null, sessions: {},
  sensitivities: { planVersion: 'p1@1', itemWeights: { ...DEFAULT_ITEM_WEIGHTS }, intentByItem: {} },
  forecast: { fromDay: 0, asPrescribed: {}, realistic: {}, goals: [{ metric: 'scaleWeight', endP50: 85, dateRange: null }], warnings: [] }, explanation: [],
  provenance: { engineVersion: 'e', registryHash: 'r', catalogueVersion: 'c' }, createdBy: { kind: 'system' }, createdAt: '2026-10-01T10:00:00.000Z',
};
const outcome = (type: ItemOutcome['type'], status: ItemOutcome['status']): ItemOutcome => ({ itemId: type, type, status, credit: status === 'done' ? 1 : status === 'skipped' ? 0 : null });
const quiet: TriggerInputs = { today: '2026-10-20', closedDay: null, checkInConfirmed: false, declared: [], recent: [], a7: 90, scored7: 6, outOfBandDays: 0, requestChanged: false, safetyBindsInDays: null };

describe('re-plan triggers (PLANNER_V2 §7.5)', () => {
  it('nothing fires on a quiet day (small rate changes are never a trigger)', () => {
    expect(evaluateTriggers(quiet)).toEqual([]);
    expect(pickReplan(quiet)).toBeNull();
  });

  it('each row of the table', () => {
    const departed = evaluateTriggers({ ...quiet, closedDay: { date: '2026-10-19', items: [outcome('rtSession', 'skipped')] } });
    expect(departed[0]).toMatchObject({ kind: 'light', trigger: 'nudge' });
    expect(evaluateTriggers({ ...quiet, closedDay: { date: '2026-10-19', items: [], energy: { target: 2000, actual: 2150 } } })).toEqual([]);
    expect(evaluateTriggers({ ...quiet, closedDay: { date: '2026-10-19', items: [], energy: { target: 2000, actual: 2300 } } })[0]!.kind).toBe('light');
    expect(evaluateTriggers({ ...quiet, checkInConfirmed: true })[0]).toMatchObject({ kind: 'weekly', trigger: 'checkin' });
    expect(evaluateTriggers({ ...quiet, checkInConfirmed: true, outOfBandDays: 3 })[0]).toMatchObject({ kind: 'weekly', full: true });
    expect(evaluateTriggers({ ...quiet, declared: [{ kind: 'noTraining', from: '2026-10-21', to: '2026-10-23' }] })[0]).toMatchObject({ kind: 'event', trigger: 'absence' });
    expect(evaluateTriggers({ ...quiet, a7: 65, scored7: 4 })[0]).toMatchObject({ kind: 'event', trigger: 'lowAdherence' });
    expect(evaluateTriggers({ ...quiet, a7: 65, scored7: 3 })).toEqual([]);
    expect(evaluateTriggers({ ...quiet, requestChanged: true })[0]).toMatchObject({ kind: 'event', trigger: 'requestChange' });
    const safety = evaluateTriggers({ ...quiet, safetyBindsInDays: 5, checkInConfirmed: true });
    expect(safety[0]).toMatchObject({ trigger: 'safetyAhead', bypassLock: true });
  });

  it('≥ 3 consecutive missed items of one type (unknown items neither count nor break the run)', () => {
    const recent = [
      { date: '2026-10-15', items: [outcome('rtSession', 'done')] },
      { date: '2026-10-16', items: [outcome('rtSession', 'skipped')] },
      { date: '2026-10-17', items: [outcome('rtSession', 'unknown')] },
      { date: '2026-10-18', items: [outcome('rtSession', 'skipped')] },
      { date: '2026-10-19', items: [outcome('rtSession', 'skipped')] },
    ];
    expect(missedInARow(recent, 'rtSession')).toBe(3);
    expect(evaluateTriggers({ ...quiet, recent })[0]).toMatchObject({ kind: 'event', trigger: 'missedBlocks' });
  });
});

describe('energy nudge (light)', () => {
  it('overshoot only, ≤ 10 % of a day in total, over the next 1-3 days, never today', () => {
    expect(energyNudge('2026-10-20', 2000, 1500, 100)).toEqual([]);
    const n = energyNudge('2026-10-20', 2000, 2900, 100);
    expect(n.map((x) => x.date)).toEqual(['2026-10-21', '2026-10-22', '2026-10-23']);
    expect(n.reduce((s, x) => s + x.deltaKcal, 0)).toBeCloseTo(-200, 9);
    const small = energyNudge('2026-10-20', 2000, 2160, 100, 2);
    expect(small.reduce((s, x) => s + x.deltaKcal, 0)).toBeCloseTo(-60, 9);
    const s2 = applyEnergyNudge(head, '2026-10-05', n, () => 2000);
    expect(s2.days[16]!.override!.energy).toEqual({ kind: 'kcal', kcal: 2000 - 200 / 3 });
    const chk = checkReplan(head, s2, 15, 'light');
    expect(adoptionPolicy(chk, { kind: 'light', nudgeOnly: true, autoApplyLoadLowering: true, status: 'ok' })).toBe('adopt');
  });
});

describe('request builder, stability checks and adoption policy', () => {
  const state: ConfirmedState = { anchorDate: '2026-10-12', snapshot: { key: 'k', moduleIds: [], states: [], bus: new Float64Array(0), prevBedH: 23, prevSleepH: 8, t0WeightErrKg: 0, day: 7 }, energyBiasKcal: { mean: -50, sd: 90 }, trendWeight: { kg: 87.2, sd: 0.15 } };
  const logs: LoggedDay[] = ['2026-10-10', '2026-10-13', '2026-10-19', '2026-10-20'].map((date) => ({ date, inputs: A, items: [], coverage: 1 }));

  it('sends the logs since the anchor (before today), the plan record and revealed adherence', () => {
    const req = buildReplanRequest({ decision: { kind: 'weekly', trigger: 'checkin', reason: '' }, today: '2026-10-20', plan, head: headV, state, logs, adherence: [{ type: 'rtSession', a: 6, b: 4, opportunities: 5 }] });
    expect(req.logs.map((l) => l.date)).toEqual(['2026-10-13', '2026-10-19']);
    expect(req.plan).toMatchObject({ planId: 'p1', version: 1, kind: 'hard', startDate: '2026-10-05', endDate: '2026-11-02' });
    expect(req.plan.request.goals[0]!.targetKind).toBe('absolute');
    expect(toActivePlanRecord({ ...plan, rung: 'custom' }, headV).genome).toEqual([]);
  });

  it('past days are immutable; today and tomorrow are locked unless safety; churn limits; load direction', () => {
    const lighter: Schedule = { ...head, days: head.days.map((d, k) => (k >= 20 ? { program: 1 } : d)) };
    const c1 = checkReplan(head, lighter, 15, 'weekly');
    expect(c1.violations).toEqual([]);
    expect(c1.lowersLoad).toBe(false); // rest days have less energy: a deeper deficit is not lower load
    const moreFood: Schedule = { ...head, days: head.days.map((d, k) => (k >= 20 ? { ...d, override: { energy: { kind: 'kcal' as const, kcal: 2050 } } } : d)) };
    const c2 = checkReplan(head, moreFood, 15, 'weekly');
    expect(c2.lowersLoad).toBe(true);
    expect(adoptionPolicy(c2, { kind: 'weekly', autoApplyLoadLowering: true, status: 'ok' })).toBe('adopt');
    expect(adoptionPolicy(c2, { kind: 'weekly', autoApplyLoadLowering: false, status: 'ok' })).toBe('propose');
    expect(adoptionPolicy(c2, { kind: 'weekly', autoApplyLoadLowering: true, status: 'ok', rungChanged: true })).toBe('propose');
    const past: Schedule = { ...head, days: head.days.map((d, k) => (k === 3 ? { program: 1 - d.program } : d)) };
    const c3 = checkReplan(head, past, 15, 'weekly');
    expect(c3.violations.some((v) => v.startsWith('past day'))).toBe(true);
    expect(adoptionPolicy(c3, { kind: 'weekly', autoApplyLoadLowering: true, status: 'ok' })).toBe('reject');
    const lock: Schedule = { ...head, days: head.days.map((d, k) => (k === 15 ? { ...d, override: { energy: { kind: 'kcal' as const, kcal: 2100 } } } : d)) };
    expect(checkReplan(head, lock, 15, 'weekly').violations).toContain('lock window day 15 changed');
    expect(checkReplan(head, lock, 15, 'event', { bypassLock: true }).violations).toEqual([]);
    const fast: Schedule = { ...head, events: [{ kind: 'fast', startDay: 18, startH: 20, durationH: 36 }] };
    const c4 = checkReplan(head, fast, 15, 'weekly');
    expect(c4.addsFast).toBe(true);
    expect(c4.violations.join(' ')).toMatch(/new fast/);
    expect(adoptionPolicy(c4, { kind: 'weekly', autoApplyLoadLowering: true, status: 'ok' })).toBe('propose');
    const churn: Schedule = { ...head, days: head.days.map((d, k) => (k >= 17 && k < 22 ? { ...d, override: { energy: { kind: 'kcal' as const, kcal: 2600 } } } : d)) };
    expect(checkReplan(head, churn, 15, 'weekly').violations).toContain('next-7-day mean energy moved by more than 10 %');
    expect(scheduleDiff(head, moreFood, '2026-10-05', 15, 22, 'x').map((d) => [d.date, d.field])).toEqual([['2026-10-25', 'energy'], ['2026-10-26', 'energy']]);
  });
});

describe('legacy planner adapter (TODO E6)', () => {
  it('re-plans the remaining horizon from today, keeps the past and the lock window, returns a proposal and a version', async () => {
    let seen: PlannerRequest | null = null;
    const newProg: DayTemplate = { ...A, id: 'N', label: 'new', energy: { kind: 'kcal', kcal: 2100 } };
    const fake = async (req: PlannerRequest): Promise<PlannerResult> => {
      seen = req;
      const sched: Schedule = { schemaVersion: 1, startDate: req.startDate!, horizonDays: req.horizonDays, programs: [newProg], days: Array.from({ length: req.horizonDays }, () => ({ program: 0 })) };
      const opt = { id: 'A', schedule: sched, scorecard: [{ goal: 0, metric: 'scaleWeight', value: 84.5, band: null }], explanation: ['new plan'] };
      return { status: 'ok', complete: true, stoppedAt: null, options: [opt, opt, opt], feasibility: [], relations: [], noSafePlanReasons: [], message: null, stubModules: [], provenance: { seed: 's', tier: 'S', budgetEU: 1, euUsed: 1, registryHash: 'r', engineVersion: 'e', libraryVersion: 1, structures: 1 } } as unknown as PlannerResult;
    };
    const port = legacyPlannerPort(fake);
    const state: ConfirmedState = { anchorDate: '2026-10-19', snapshot: { key: 'k', moduleIds: [], states: [], bus: new Float64Array(0), prevBedH: 23, prevSleepH: 8, t0WeightErrKg: 0 }, energyBiasKcal: { mean: 0, sd: 150 }, trendWeight: { kg: 87.24, sd: 0.15 } };
    const req = buildReplanRequest({ decision: { kind: 'event', trigger: 'absence', reason: '' }, today: '2026-10-20', plan, head: headV, state, logs: [], adherence: [] });
    const res = await port.replan(req);
    expect(seen!.startDate).toBe('2026-10-20');
    expect(seen!.profile.body.weightKg).toBe(87.2);
    expect(seen!.horizonDays).toBe(28);
    expect(res.status).toBe('proposal');
    const chk = checkReplan(head, res.plan.schedule, 15, 'event');
    expect(chk.violations.filter((v) => v.startsWith('past') || v.startsWith('lock'))).toEqual([]);
    expect(res.diff[0]!.date).toBe('2026-10-22');
    const v = versionFromReplan({ result: res, plan, head: headV, today: '2026-10-20', reason: 'event', adoption: 'propose', createdBy: { kind: 'system' }, createdAt: '2026-10-20T08:00:00.000Z' });
    expect(v).toMatchObject({ version: 2, parent: 1, status: 'proposed', effectiveFromDay: 15, reason: 'event' });
    expect(v.forecast.goals[0]).toMatchObject({ metric: 'scaleWeight', endP50: 84.5 });
  });
});
