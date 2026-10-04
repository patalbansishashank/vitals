import { beforeEach, describe, expect, it } from 'vitest';
import { compileSchedule } from '@/engine';
import {
  SCENARIOS_KEY,
  isScenarioState,
  mergeScenarioStates,
  resetScheduleStore,
  useScheduleStore,
} from '@/state/scheduleStore';
import { calendarGrid, linearRange, rectRange } from '../lib/calendar';
import { dayTemplate } from '../lib/ops';
import { A, B, F, RP, schedule } from './fixtures';
import { withSystemWrite } from '@/state/scope';

const S = () => useScheduleStore.getState();
const sched = (sid: string) => S().scenarios.find((s) => s.id === sid)!.schedule;

function newScenario(days = 28, pattern = [0]): string {
  return S().createScenario({ name: 'Test', schedule: schedule(days, pattern) });
}

beforeEach(() => {
  localStorage.clear();
  resetScheduleStore('2026-09-30');
});

describe('initial state', () => {
  it('starts with a painted 12-week starter scenario beginning the next Monday', () => {
    const st = S();
    expect(st.scenarios).toHaveLength(1);
    const sc = st.scenarios[0]!;
    expect(sc.started).toBe(true);
    expect(sc.schedule.startDate).toBe('2026-10-05');
    expect(sc.schedule.horizonDays).toBe(84);
    expect(sc.schedule.days).toHaveLength(84);
    // one moderate-deficit program on every day, training as usual (R-DETRAIN part 2)
    expect(sc.schedule.programs.map((p) => p.id)).toEqual(['A']);
    expect(sc.schedule.programs[0]!.habitualTraining).toBe(true);
    // the stored schedule is exactly what the compiler consumes
    const c = compileSchedule(sc.schedule, RP);
    expect(c.nDays).toBe(84);
    expect(c.notes.filter((n) => n.code === 'macrosExceedEnergy')).toHaveLength(0);
  });
});

describe('painting and selection', () => {
  it('paints days and replaces overrides; one stroke is one undo step', () => {
    const sid = newScenario();
    S().paintDays(sid, [1], 1, { coalesce: 'stroke:1' });
    S().paintDays(sid, [2, 3], 1, { coalesce: 'stroke:1' });
    S().seal(sid);
    expect(
      sched(sid)
        .days.slice(0, 5)
        .map((d) => d.program),
    ).toEqual([0, 1, 1, 1, 0]);
    expect(S().history[sid]!.past).toHaveLength(1);
    S().undo(sid);
    expect(
      sched(sid)
        .days.slice(0, 5)
        .map((d) => d.program),
    ).toEqual([0, 0, 0, 0, 0]);
    S().redo(sid);
    expect(
      sched(sid)
        .days.slice(0, 5)
        .map((d) => d.program),
    ).toEqual([0, 1, 1, 1, 0]);
  });

  it('a new stroke after seal is a separate undo step', () => {
    const sid = newScenario();
    S().paintDays(sid, [1], 1, { coalesce: 'k' });
    S().seal(sid);
    S().paintDays(sid, [2], 1, { coalesce: 'k' });
    S().seal(sid);
    expect(S().history[sid]!.past).toHaveLength(2);
  });

  it('linear ranges wrap rows; rectangular ranges pick weekday columns', () => {
    const g = calendarGrid('2026-10-05', 28);
    expect(linearRange(5, 9)).toEqual([5, 6, 7, 8, 9]);
    // Thursday (col 3) of weeks 1–3
    expect(rectRange(g, 3, 17)).toEqual([3, 10, 17]);
    // Wed–Fri of weeks 1–2
    expect(rectRange(g, 2, 11)).toEqual([2, 3, 4, 9, 10, 11]);
    // a Wednesday start leaves two blank slots in row 1
    const g2 = calendarGrid('2026-10-07', 14);
    expect(g2.offset).toBe(2);
    expect(g2.rows).toBe(3);
  });

  it('clear repaints with the default program A', () => {
    const sid = newScenario(14, [1]);
    S().clearDays(sid, [0, 1]);
    expect(
      sched(sid)
        .days.slice(0, 3)
        .map((d) => d.program),
    ).toEqual([0, 0, 1]);
  });
});

describe('weeks, patterns, shifts', () => {
  it('copies a week and pastes it to other weeks', () => {
    const sid = newScenario(28);
    S().applyPattern(sid, [0, 1, 0, 1, 0, 2, 1], 0, 6);
    S().copyWeek(sid, 0);
    S().pasteWeeks(sid, [2, 3]);
    const days = sched(sid).days.map((d) => d.program);
    expect(days.slice(14, 21)).toEqual([0, 1, 0, 1, 0, 2, 1]);
    expect(days.slice(21, 28)).toEqual([0, 1, 0, 1, 0, 2, 1]);
    expect(days.slice(7, 14)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('repeats a weekly pattern aligned to weekdays ("A A B A A C fast")', () => {
    // start on a Wednesday: the 7-long pattern is Monday-first, so day 0 takes the Wednesday slot
    const sid = S().createScenario({ schedule: schedule(21, [0], [A, B, F], '2026-10-07') });
    S().applyPattern(sid, [0, 0, 1, 0, 0, 2, 2]);
    const days = sched(sid).days.map((d) => d.program);
    expect(days.slice(0, 5)).toEqual([1, 0, 0, 2, 2]); // Wed Thu Fri Sat Sun
    expect(days.slice(5, 12)).toEqual([0, 0, 1, 0, 0, 2, 2]); // next Mon…Sun
  });

  it('repeat to end copies one week over every later week', () => {
    const sid = newScenario(28);
    S().applyPattern(sid, [0, 1, 1, 1, 1, 1, 1], 0, 6);
    S().repeatWeekToEnd(sid, 0);
    expect(
      sched(sid)
        .days.map((d) => d.program)
        .filter((p) => p === 0),
    ).toHaveLength(4);
  });

  it('shift rotates the selected run without losing days', () => {
    const sid = newScenario(14);
    S().paintDays(sid, [2, 3], 1);
    S().shiftDays(sid, [2, 3], 2);
    expect(
      sched(sid)
        .days.slice(0, 7)
        .map((d) => d.program),
    ).toEqual([0, 0, 0, 0, 1, 1, 0]);
  });

  it('insert and delete week keep the day map dense and move fasts', () => {
    const sid = newScenario(21);
    S().addFast(sid, { startDay: 15, startH: 20, durationH: 36 });
    S().insertWeek(sid, 1);
    expect(sched(sid).horizonDays).toBe(28);
    expect(sched(sid).days).toHaveLength(28);
    expect(sched(sid).events![0]!.startDay).toBe(22);
    S().deleteWeek(sid, 0);
    expect(sched(sid).horizonDays).toBe(21);
    expect(sched(sid).events![0]!.startDay).toBe(15);
  });

  it('extends the horizon by repeating the last week and shortening keeps undo', () => {
    const sid = newScenario(14);
    S().applyPattern(sid, [0, 1, 2, 0, 1, 2, 1], 7, 13);
    S().setHorizon(sid, 28);
    const days = sched(sid).days.map((d) => d.program);
    expect(days.slice(14, 21)).toEqual(days.slice(7, 14));
    S().setHorizon(sid, 7);
    expect(sched(sid).days).toHaveLength(7);
    S().undo(sid);
    expect(sched(sid).days).toHaveLength(28);
  });
});

describe('multi-day fasts', () => {
  it('inserts an hour-exact 72 h fast across a week boundary', () => {
    const sid = newScenario(28);
    // Sat 20:00 of week 1 (day 5) → Tue 20:00 of week 2
    S().addFast(sid, { startDay: 5, startH: 20, durationH: 72, electrolytes: true, refeed: 'auto' });
    const s = sched(sid);
    expect(s.events).toEqual([
      { kind: 'fast', startDay: 5, startH: 20, durationH: 72, electrolytes: true, refeed: 'auto' },
    ]);
    const c = compileSchedule(s, RP);
    // startH is the last intake and durationH meal to meal: zero intake covers the hours in between
    expect(c.fastSpans[0]!.startHour).toBeGreaterThanOrEqual(5 * 24 + 20);
    expect(c.fastSpans[0]!.endHour).toBeLessThanOrEqual(5 * 24 + 20 + 72);
    expect(c.fastSpans[0]!.endHour - c.fastSpans[0]!.startHour).toBeGreaterThanOrEqual(70);
    expect(c.days[6]!.zeroIntake).toBe(true); // Sunday
    expect(c.days[7]!.zeroIntake).toBe(true); // Monday, next week
    expect(c.days[8]!.zeroIntake).toBe(false); // Tuesday: fast ends 20:00, meals before move out
    // graded refeed after > 48 h (HC-F3)
    expect(c.days[9]!.energyKcal).toBeLessThan(c.days[12]!.energyKcal);
  });

  it('updates and removes a fast event', () => {
    const sid = newScenario(14);
    S().addFast(sid, { startDay: 2, startH: 20, durationH: 36 });
    S().updateFast(sid, 0, { durationH: 48 });
    expect(sched(sid).events![0]!.durationH).toBe(48);
    S().removeFast(sid, 0);
    expect(sched(sid).events).toBeUndefined();
  });
});

describe('per-day override ("this day only")', () => {
  it('stores only the changed fields and compiles the merged template', () => {
    const sid = newScenario(14);
    S().editDays(sid, [3], (t) => ({ ...t, energy: { kind: 'pctMaintenance', pct: 100 } }));
    const s = sched(sid);
    expect(s.days[3]!.override).toEqual({ energy: { kind: 'pctMaintenance', pct: 100 } });
    expect(s.days[4]!.override).toBeUndefined();
    expect(dayTemplate(s, 3).energy).toEqual({ kind: 'pctMaintenance', pct: 100 });
    const c = compileSchedule(s, RP);
    // % resolve against the day's maintenance reference at the planned activity (R-MAINT; habitual without the field)
    const ref = (d: number) => (Number.isFinite(c.days[d]!.maintenanceKcal) ? c.days[d]!.maintenanceKcal : RP.tdee0Kcal);
    expect(c.days[3]!.energyKcal).toBeCloseTo(ref(3), 0);
    expect(c.days[4]!.energyKcal).toBeCloseTo(0.85 * ref(4), 0);
    // editing back to the program's value removes the override
    S().editDays(sid, [3], (t) => ({ ...t, energy: A.energy }));
    expect(sched(sid).days[3]!.override).toBeUndefined();
  });

  it('reset override', () => {
    const sid = newScenario(7);
    S().editDays(sid, [1, 2], (t) => ({ ...t, steps: 12000 }));
    S().resetOverrides(sid, [1]);
    expect(sched(sid).days[1]!.override).toBeUndefined();
    expect(sched(sid).days[2]!.override).toEqual({ steps: 12000 });
  });
});

describe('programs', () => {
  it('adds presets with the next free letter and deletes with replacement (no holes)', () => {
    const sid = newScenario(7, [0, 1, 2]);
    const i = S().addProgram(sid, 'refeed');
    expect(i).toBe(3);
    expect(sched(sid).programs[3]!.id).toBe('D');
    S().paintDays(sid, [6], 3);
    S().deleteProgram(sid, 1, 3); // B's days take D, which shifts to index 2
    const s = sched(sid);
    expect(s.programs.map((p) => p.id)).toEqual(['A', 'C', 'D']);
    expect(s.days.map((d) => d.program)).toEqual([0, 2, 1, 0, 2, 1, 2]);
    expect(s.days.every((d) => d.program >= 0 && d.program < s.programs.length)).toBe(true);
  });

  it('never deletes the last program', () => {
    const sid = S().createScenario({ schedule: schedule(7, [0], [A]) });
    S().deleteProgram(sid, 0, 0);
    expect(sched(sid).programs).toHaveLength(1);
  });
});

describe('scenarios and persistence', () => {
  it('duplicates, renames, deletes; one active', () => {
    const sid = newScenario();
    const dup = S().duplicateScenario(sid)!;
    expect(S().activeId).toBe(dup);
    S().renameScenario(dup, '  Spring cut  ');
    expect(S().scenarios.find((s) => s.id === dup)!.name).toBe('Spring cut');
    S().deleteScenario(dup);
    expect(S().scenarios.some((s) => s.id === dup)).toBe(false);
    expect(S().activeId).not.toBe(dup);
  });

  it('round-trips through localStorage (versioned; history is session-only)', async () => {
    const sid = newScenario(14, [0, 1]);
    S().addFast(sid, { startDay: 3, startH: 20, durationH: 36, refeed: 'auto' });
    const saved = localStorage.getItem(SCENARIOS_KEY)!;
    const raw = JSON.parse(saved);
    expect(raw.version).toBe(2);
    expect(raw.state.history).toBeUndefined();
    expect(isScenarioState(raw.state)).toBe(true);
    const before = S().scenarios;
    withSystemWrite(() => useScheduleStore.setState({ scenarios: [], activeId: null })); // (persists the empty state)
    localStorage.setItem(SCENARIOS_KEY, saved);
    await useScheduleStore.persist.rehydrate();
    expect(S().scenarios).toEqual(before);
    expect(S().activeId).toBe(sid);
    expect(S().history).toEqual({});
  });

  it('rejects damaged imports and merges by renaming clashes', () => {
    expect(isScenarioState({ scenarios: [{ id: 'x', name: 'x', schedule: { schemaVersion: 1 } }] })).toBe(
      false,
    );
    const sc = S().scenarios[0]!;
    const merged = mergeScenarioStates({ scenarios: [sc], activeId: sc.id }, { scenarios: [sc] }) as {
      scenarios: Array<{ id: string; name: string }>;
    };
    expect(merged.scenarios).toHaveLength(2);
    expect(merged.scenarios[1]!.id).not.toBe(sc.id);
    expect(merged.scenarios[1]!.name).toMatch(/\(imported\)$/);
  });

  it('ensureScenario creates an empty (starter-picker) scenario when none exist', () => {
    withSystemWrite(() => useScheduleStore.setState({ scenarios: [], activeId: null }));
    const id = S().ensureScenario();
    expect(S().scenarios.find((s) => s.id === id)!.started).toBe(false);
    S().applyStarter(id, 'weeklyFast6');
    const sc = S().scenarios.find((s) => s.id === id)!;
    expect(sc.started).toBe(true);
    expect(sc.schedule.horizonDays).toBe(42);
    // one water-only Sunday per week
    const c = compileSchedule(sc.schedule, RP);
    expect(c.days.filter((d) => d.zeroIntake)).toHaveLength(6);
  });
});

void B;
