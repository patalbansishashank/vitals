// @vitest-environment node
/** Train for a "training as usual" plan (starter scenario): the usual sessions show on their weekdays, rest on the others. */
import { SEED_CATALOGUE } from '@/content/catalogues';
import type { DayTemplate, PersonProfile, Schedule } from '@/engine';
import { DEFAULT_ITEM_WEIGHTS, addDays, freezePrescription, type PlanDoc, type PlanVersionDoc, type TodayView } from '@/living';
import { STUB_STIMULUS_CONTEXT, STUB_TRAINING_PROFILE } from '../../data/fixtures';
import { sessionModels, weekRows, type TrainSetup } from '../session';

const setup: TrainSetup = { profile: STUB_TRAINING_PROFILE, ctx: STUB_STIMULUS_CONTEXT, catalogue: SEED_CATALOGUE };
const START = '2026-10-05'; // a Monday
const PROFILE: PersonProfile = { schemaVersion: 1, body: { sex: 'female', ageYears: 35, heightCm: 165, weightKg: 70 }, habits: { sessionsPerWeek: 2 }, startDate: START };
const USUAL: DayTemplate = { id: 'U', label: 'moderate deficit', energy: { kind: 'pctMaintenance', pct: 80 },
  macros: { protein: { unit: 'g', value: 130 }, carbs: { unit: 'g', value: 150 }, fat: { unit: 'remainder' } }, meals: { count: 3 }, habitualTraining: true,
};
const SCHED: Schedule = { schemaVersion: 1, startDate: START, horizonDays: 14, programs: [USUAL], days: Array.from({ length: 14 }, () => ({ program: 0 })) };
const plan: PlanDoc & { id: string } = {
  id: 'p1', name: 'Moderate deficit', rung: 'medium', origin: { kind: 'planner', requestHash: 'h', runAt: '2026-10-01T10:00:00.000Z' },
  status: 'active', startDate: START, plannedEndDate: addDays(START, 14), request: { profile: PROFILE, goals: [], horizonDays: 14 },
  baselineProfile: PROFILE, headVersion: 1, pauses: [], intentions: {}, policy: { checkInWeekday: 0, autoApplyLoadLowering: true }, createdAt: '2026-10-01T10:00:00.000Z',
};
const version: PlanVersionDoc = {
  planId: 'p1', version: 1, parent: null, status: 'adopted', reason: 'start', effectiveFromDay: 0, schedule: SCHED, genome: null,
  sessions: {}, sensitivities: { planVersion: 'p1@1', itemWeights: { ...DEFAULT_ITEM_WEIGHTS }, intentByItem: {} },
  forecast: { fromDay: 0, asPrescribed: {}, realistic: {}, goals: [], warnings: [] }, explanation: [],
  provenance: { engineVersion: 'x', registryHash: 'y', catalogueVersion: 'z' }, createdBy: { kind: 'system' }, createdAt: '2026-10-01T10:00:00.000Z',
};

describe('Train: training as usual', () => {
  it('session models and the week list show the usual sessions on two weekdays and rest on five', () => {
    const dates = Array.from({ length: 7 }, (_, d) => addDays(START, d));
    const rxs = dates.map((date) => freezePrescription({ plan, version, date, tz: 'UTC' }));
    const models = rxs.map((rx, k) => sessionModels(rx, dates[k]!, setup));
    expect(models.filter((m) => m.length === 1)).toHaveLength(2);
    expect(models.filter((m) => m.length === 0)).toHaveLength(5);
    for (const m of models.flat()) {
      expect(m.composedHere).toBe(true);
      expect(m.minutes).toBeGreaterThan(0);
    }
    const views = rxs.map((rx) => ({ prescription: rx, logged: { items: [] } }) as unknown as TodayView);
    const rows = weekRows(dates, views, START, setup);
    expect(rows.filter((r) => r.rest)).toHaveLength(5);
    const trained = rows.filter((r) => !r.rest);
    expect(trained).toHaveLength(2);
    expect(trained.map((r) => dates.indexOf(r.date))).toEqual(models.map((m, d) => (m.length > 0 ? d : -1)).filter((d) => d >= 0));
    for (const r of trained) expect(r.sessions[0]!.minutes).toBe(models[dates.indexOf(r.date)]![0]!.minutes);
  });
});
