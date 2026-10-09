// @vitest-environment node
/**
 * "Training as usual" (DayTemplate.habitualTraining, the starter scenario's plan): the profile's habitual sessions are
 * prescribed sessions on the weekdays the habitual week trains, so Train and Today show them, while the day's energy stays
 * exactly what the engine counted (no double count), and days frozen before the fix get them re-derived on read.
 */
import type { DayTemplate, PersonProfile, Schedule } from '@/engine';
import { habitualSessionsFor } from '@/engine/core/compileSchedule';
import { resolveProfile } from '@/engine/core/resolveProfile';
import { freezePrescription, DEFAULT_ITEM_WEIGHTS, withUsualSessions } from '../prescription';
import { toLoggedDay, type LoggedDayInput } from '../loggedDay';
import { catalogueEquivalence } from '../equivalence';
import { projectLiving } from '../projection';
import { addDays, localToInstant } from '../dates';
import type { DayStatusDoc, LogEntry, PlanDoc, PlanVersionDoc, PrescribedDaySnapshot } from '../types';

const TZ = 'Asia/Kolkata';
const START = '2026-10-05'; // a Monday
const PROFILE: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 40, heightCm: 180, weightKg: 90 }, habits: { sessionsPerWeek: 2 }, startDate: START };
const USUAL: DayTemplate = {
  id: 'U', label: 'moderate deficit', energy: { kind: 'pctMaintenance', pct: 80 },
  macros: { protein: { unit: 'g', value: 160 }, carbs: { unit: 'g', value: 200 }, fat: { unit: 'remainder' } },
  meals: { count: 3, window: { startH: 9, lengthH: 10 } }, habitualTraining: true,
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

const habitualDays = (): number[] => [0, 1, 2, 3, 4, 5, 6].filter((wd) => habitualSessionsFor(resolveProfile(PROFILE), wd).length > 0);
const rx = (date: string): PrescribedDaySnapshot => freezePrescription({ plan, version, date, tz: TZ });
/** The same day as the code before the fix froze it: no usual sessions, no items for them. */
function frozenBeforeFix(r: PrescribedDaySnapshot): PrescribedDaySnapshot {
  const ids = new Set(r.sessions.filter((s) => s.usual).map((s) => `${s.kind === 'resistance' ? 'rtSession' : 'cardioSession'}:${s.slotKey}`));
  const items = r.items.filter((it) => !ids.has(it.itemId));
  const sum = items.reduce((a, it) => a + it.weight, 0);
  return { ...r, sessions: r.sessions.filter((s) => !s.usual), items: items.map((it) => ({ ...it, weight: it.weight / sum })) };
}
const logged = (prescription: PrescribedDaySnapshot, date: string, entries: LogEntry[] = []): LoggedDayInput => ({
  date, planStart: START, tz: TZ, prescription, entries, expected: () => 0.75, equivalence: catalogueEquivalence, final: true,
});
const sessionLog = (date: string, itemId: string): LogEntry =>
  ({
    id: `s-${itemId}`, date, tz: TZ, at: localToInstant(date, 19, TZ), source: { by: 'user', method: 'typed' }, kind: 'session', itemId, status: 'done', startH: 18, durationMin: 45,
    stimulus: { effectiveSetsByRegion: { quads: 4 }, pattern: 'squat', loadClass: 'moderate', netKcal: 120, mem: 0, hiMinutes: 0, mobilityMinutes: {} },
  }) as unknown as LogEntry;

describe('training as usual: prescribed sessions (starter scenario plan)', () => {
  it('the profile trains twice a week: sessions on those weekdays (0 = Monday), rest on the others', () => {
    const train = habitualDays();
    expect(train).toHaveLength(2);
    for (let d = 0; d < 7; d++) {
      const r = rx(addDays(START, d));
      if (train.includes(d)) {
        expect(r.sessions).toHaveLength(1);
        expect(r.sessions[0]).toMatchObject({ usual: true, slotKey: `${d}:u0`, concrete: null });
        expect(r.items.some((it) => it.itemId === `${r.sessions[0]!.kind === 'resistance' ? 'rtSession' : 'cardioSession'}:${d}:u0`)).toBe(true);
      } else expect(r.sessions).toHaveLength(0);
      expect(r.items.reduce((a, it) => a + it.weight, 0)).toBeCloseTo(1, 12);
    }
  });

  it('energy is unchanged: the prescription and an unlogged day keep the engine habitual training, never twice', () => {
    for (const d of habitualDays()) {
      const date = addDays(START, d);
      const now = rx(date);
      const before = frozenBeforeFix(now);
      expect(now.energyKcal).toBe(before.energyKcal);
      const a = toLoggedDay(logged(now, date)).loggedDay.inputs;
      const b = toLoggedDay(logged(before, date)).loggedDay.inputs;
      expect(a.habitualTraining).toBe(true);
      expect(a.exercise).toEqual([]);
      expect(a).toEqual(b);
      // something else logged (a free session): the usual session is dropped as before, not added on top
      const free = [sessionLog(date, 'free:1')];
      const c = toLoggedDay(logged(now, date, free)).loggedDay.inputs;
      const e = toLoggedDay(logged(before, date, free)).loggedDay.inputs;
      expect(c.exercise).toEqual(e.exercise);
      expect(c.habitualTraining).toBe(false);
    }
  });

  it('logging the usual session counts it once and credits its item', () => {
    const d = habitualDays()[0]!;
    const date = addDays(START, d);
    const r = rx(date);
    const s = r.sessions[0]!;
    const itemId = `${s.kind === 'resistance' ? 'rtSession' : 'cardioSession'}:${s.slotKey}`;
    const out = toLoggedDay(logged(r, date, [sessionLog(date, itemId)]));
    expect(out.loggedDay.inputs.habitualTraining).toBe(false);
    expect(out.loggedDay.inputs.exercise).toHaveLength(1);
    expect(out.loggedDay.items.find((it) => it.itemId === itemId)?.credit).toBeGreaterThan(0);
  });

  it('a day frozen before the fix gets its usual sessions on read (Today checklist), logs and targets kept', () => {
    const d = habitualDays()[0]!;
    const date = addDays(START, d);
    const fresh = rx(date);
    const old = frozenBeforeFix(fresh);
    expect(old.sessions).toHaveLength(0);
    const up = withUsualSessions(old, PROFILE, date, () => rx(date));
    expect(up.sessions.map((s) => s.slotKey)).toEqual(fresh.sessions.map((s) => s.slotKey));
    expect(up.items.map((it) => it.itemId).sort()).toEqual(fresh.items.map((it) => it.itemId).sort());
    expect(up.items.reduce((a, it) => a + it.weight, 0)).toBeCloseTo(1, 12);
    expect(up.energyKcal).toBe(old.energyKcal);
    expect(withUsualSessions(up, PROFILE, date, () => rx(date))).toBe(up); // idempotent
    const rest = [0, 1, 2, 3, 4, 5, 6].find((x) => !habitualDays().includes(x))!;
    const restOld = frozenBeforeFix(rx(addDays(START, rest)));
    expect(withUsualSessions(restOld, PROFILE, addDays(START, rest), () => { throw new Error('not re-frozen on a rest day'); })).toBe(restOld);

    // the owner's case: the plan is running, today was frozen at rollover by the old code
    const status: DayStatusDoc = { date, planId: plan.id, planDay: d, prescribed: old } as unknown as DayStatusDoc;
    const p = projectLiving({
      docs: { plan, versions: [version], dayStatus: [status], entries: [], measurements: [], records: [] },
      today: date, tz: TZ, now: localToInstant(date, 10, TZ), skipAssimilation: true,
    });
    const day = p.days.find((x) => x.date === date)!;
    expect(day.frozen).toBe(true);
    expect(day.prescription.sessions).toHaveLength(1);
    expect(day.result.loggedDay.inputs.habitualTraining).toBe(true);
    expect(day.result.loggedDay.inputs.exercise).toEqual([]);
    expect(p.today.prescription?.sessions).toHaveLength(1);
    expect(p.today.checklist.some((c) => c.kind === 'session')).toBe(true);
  });
});
