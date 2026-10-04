// @vitest-environment node
import type { DayTemplate, PersonProfile, Schedule } from '@/engine';
import { addDays, daysBetween, instantToLocal, localToInstant, nextWeekday, weekdayOf, isLocalDate } from '../dates';
import { anchorSchedule, habitualTemplateFor, isAllowedStartDate, openProposals, pausedDaySet, planDay, resumeSchedule, startDateChoices, versionInForce } from '../calendar';
import { activateIfDue, canDiscard, canTransition, completeIfDue, endPlan, pausePlan, resolveLivePlans, resumePlan, safetyPause } from '../lifecycle';
import type { PlanDoc } from '../types';

const A: DayTemplate = { id: 'A', label: 'train', energy: { kind: 'pctMaintenance', pct: 80 }, macros: { protein: { unit: 'g', value: 150 }, carbs: { unit: 'g', value: 180 }, fat: { unit: 'remainder' } } };
const B: DayTemplate = { ...A, id: 'B', label: 'rest', energy: { kind: 'pctMaintenance', pct: 75 } };
const C: DayTemplate = { ...A, id: 'C', label: 'refeed', energy: { kind: 'pctMaintenance', pct: 100 } };

/** 28-day plan starting Monday 2026-10-05; programs by weekday 0..6 = A B A B A C B; blocks of 14; fasts on day 1 and 9. */
function plan28(): Schedule {
  const wk = [0, 1, 0, 1, 0, 2, 1];
  return {
    schemaVersion: 1, startDate: '2026-10-05', horizonDays: 28, programs: [A, B, C],
    days: Array.from({ length: 28 }, (_, d) => ({ program: wk[d % 7]! })),
    blocks: [{ name: 'one', startDay: 0, endDay: 14 }, { name: 'two', startDay: 14, endDay: 28 }],
    events: [{ kind: 'fast', startDay: 1, startH: 20, durationH: 24 }, { kind: 'fast', startDay: 9, startH: 20, durationH: 24 }],
  };
}

const MAN: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 40, heightCm: 180, weightKg: 90 }, habits: { sessionsPerWeek: 3 }, startDate: '2026-10-05' };

function planDoc(over: Partial<PlanDoc> = {}): PlanDoc & { id: string } {
  return {
    id: 'p1', name: 'Hard plan', rung: 'hard', origin: { kind: 'planner', requestHash: 'h', runAt: '2026-10-01T10:00:00.000Z' },
    status: 'active', startDate: '2026-10-05', plannedEndDate: '2026-11-02', request: { profile: MAN, goals: [], horizonDays: 28 },
    baselineProfile: MAN, headVersion: 1, pauses: [], intentions: {}, policy: { checkInWeekday: 0, autoApplyLoadLowering: true },
    createdAt: '2026-10-01T10:00:00.000Z', ...over,
  };
}

describe('dates', () => {
  it('weekday (Monday = 0), arithmetic, validation', () => {
    expect(weekdayOf('2026-10-05')).toBe(0);
    expect(weekdayOf('2026-10-11')).toBe(6);
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(daysBetween('2026-10-05', '2026-11-02')).toBe(28);
    expect(nextWeekday('2026-10-05', 0)).toBe('2026-10-12');
    expect(nextWeekday('2026-10-07', 0)).toBe('2026-10-12');
    expect(isLocalDate('2026-02-30')).toBe(false);
    expect(isLocalDate('2026-02-28')).toBe(true);
  });

  it('instants ↔ local clock in an explicit zone (incl. a DST change)', () => {
    expect(instantToLocal('2026-10-05T14:30:00.000Z', 'Asia/Kolkata')).toEqual({ date: '2026-10-05', clockH: 20 });
    expect(localToInstant('2026-10-05', 20, 'Asia/Kolkata')).toBe('2026-10-05T14:30:00.000Z');
    expect(localToInstant('2026-03-29', 12, 'Europe/Berlin')).toBe('2026-03-29T10:00:00.000Z');
    expect(localToInstant('2026-03-28', 12, 'Europe/Berlin')).toBe('2026-03-28T11:00:00.000Z');
  });
});

describe('anchorSchedule (§3.2)', () => {
  it('same weekday: only the date changes', () => {
    const a = anchorSchedule(plan28(), '2026-10-12');
    expect(a.skippedDays).toBe(0);
    expect(a.schedule.startDate).toBe('2026-10-12');
    expect(a.schedule.days).toEqual(plan28().days);
  });

  it('a Wednesday start skips 2 days of week 1, keeps weekdays aligned, restores the horizon, shifts blocks and fasts', () => {
    const s = plan28();
    const a = anchorSchedule(s, '2026-10-07');
    expect(a.skippedDays).toBe(2);
    expect(a.schedule.horizonDays).toBe(28);
    expect(a.schedule.days).toHaveLength(28);
    // every new day keeps the program of the same weekday
    for (let d = 0; d < 28; d++) {
      const wdNew = (weekdayOf('2026-10-07') + d) % 7;
      const sameWeekdayOld = s.days.findIndex((_, k) => (weekdayOf('2026-10-05') + k) % 7 === wdNew);
      expect(a.schedule.days[d]!.program).toBe(s.days[sameWeekdayOld]!.program);
    }
    expect(a.schedule.blocks).toEqual([{ name: 'one', startDay: 0, endDay: 12 }, { name: 'two', startDay: 12, endDay: 28 }]);
    expect(a.droppedFasts.map((f) => f.startDay)).toEqual([1]);
    expect(a.schedule.events!.map((f) => f.startDay)).toEqual([7]);
    expect(a.notices[0]).toMatch(/skips the first 2 days/);
    expect(a.notices.join(' ')).not.toMatch(/§|WP|R11/);
  });

  it('start-date choices: today, tomorrow (default), next Monday, ≤ 28 days ahead', () => {
    const c = startDateChoices('2026-10-01');
    expect(c).toMatchObject({ today: '2026-10-01', tomorrow: '2026-10-02', nextMonday: '2026-10-05', latest: '2026-10-29', default: '2026-10-02' });
    expect(isAllowedStartDate('2026-10-01', '2026-10-29')).toBe(true);
    expect(isAllowedStartDate('2026-10-01', '2026-10-30')).toBe(false);
    expect(isAllowedStartDate('2026-10-01', '2026-09-30')).toBe(false);
  });
});

describe('calendar: plan days, version in force, pause and resume', () => {
  it('the version in force is the adopted one with the largest effectiveFromDay ≤ day', () => {
    const vs = [
      { version: 1, status: 'adopted' as const, effectiveFromDay: 0 },
      { version: 2, status: 'proposed' as const, effectiveFromDay: 5 },
      { version: 3, status: 'adopted' as const, effectiveFromDay: 10 },
      { version: 4, status: 'rejected' as const, effectiveFromDay: 12 },
    ];
    expect(versionInForce(vs, 4)!.version).toBe(1);
    expect(versionInForce(vs, 7)!.version).toBe(1);
    expect(versionInForce(vs, 15)!.version).toBe(3);
    expect(planDay(planDoc(), '2026-10-04')).toBe(-1);
  });

  it('resume: days from R are the parent days from P; blocks and fasts shift; horizon grows by R − P', () => {
    const s = plan28();
    const { schedule, shiftDays } = resumeSchedule(s, 8, 11);
    expect(shiftDays).toBe(3);
    expect(schedule.horizonDays).toBe(31);
    for (let d = 11; d < 31; d++) expect(schedule.days[d]!.program).toBe(s.days[d - 3]!.program);
    for (let d = 0; d < 8; d++) expect(schedule.days[d]!.program).toBe(s.days[d]!.program);
    expect(schedule.events!.map((e) => e.startDay)).toEqual([1, 12]);
    expect(schedule.blocks).toEqual([{ name: 'one', startDay: 0, endDay: 17 }, { name: 'two', startDay: 17, endDay: 31 }]);
  });

  it('paused days and the habitual prescription (100 % of maintenance, habitual training)', () => {
    const p = planDoc({ pauses: [{ from: '2026-10-10', to: '2026-10-12' }, { from: '2026-10-20', to: null }] });
    expect([...pausedDaySet(p, '2026-10-22')]).toEqual([5, 6, 15, 16]);
    const t = habitualTemplateFor(MAN, 2);
    expect(t.habitualTraining).toBe(true);
    expect(t.exercise).toBeUndefined();
  });
});

describe('lifecycle (§3.1)', () => {
  it('allowed transitions', () => {
    expect(canTransition('draft', 'start')).toBe(true);
    expect(canTransition('ended', 'resume')).toBe(false);
    expect(canTransition('paused', 'pause')).toBe(false);
  });

  it('scheduled → active on the start date; pause → resume moves the end date; end closes open pauses', () => {
    const sched = planDoc({ status: 'scheduled' });
    expect(activateIfDue(sched, '2026-10-04').ok).toBe(false);
    const act = activateIfDue(sched, '2026-10-05');
    expect(act.ok && act.plan.status).toBe('active');
    const paused = pausePlan(planDoc(), '2026-10-10', 'travel');
    expect(paused.ok).toBe(true);
    if (!paused.ok) return;
    const resumed = resumePlan(paused.plan, '2026-10-13');
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.plan.plannedEndDate).toBe('2026-11-05');
    expect(resumed.shift).toEqual({ P: 5, R: 8 });
    const p2 = pausePlan(resumed.plan, '2026-10-20');
    const ended = endPlan(p2.ok ? p2.plan : resumed.plan, '2026-10-22T08:00:00.000Z', '2026-10-22', 'abandoned');
    expect(ended.ok && ended.plan.pauses.every((p) => p.to !== null)).toBe(true);
    expect(ended.ok && ended.plan.status).toBe('ended');
  });

  it('a safety pause is resumed only by the person; completion at the first open after the planned end', () => {
    const sp = safetyPause(planDoc(), '2026-10-10');
    expect(sp.ok).toBe(true);
    if (!sp.ok) return;
    expect(resumePlan(sp.plan, '2026-10-11', 'ai').ok).toBe(false);
    expect(resumePlan(sp.plan, '2026-10-11', 'user').ok).toBe(true);
    expect(completeIfDue(planDoc(), '2026-11-01', 'x').ok).toBe(false);
    const done = completeIfDue(planDoc(), '2026-11-03', '2026-11-03T07:00:00.000Z');
    expect(done.ok && done.plan.ended).toMatchObject({ reason: 'completed', date: '2026-11-02' });
  });

  it('discard only within 24 h and without logs; sync keeps the newer live plan and ends the other as replaced', () => {
    expect(canDiscard(planDoc(), '2026-10-02T09:00:00.000Z', false).ok).toBe(true);
    expect(canDiscard(planDoc(), '2026-10-02T11:00:00.000Z', false).ok).toBe(false);
    expect(canDiscard(planDoc(), '2026-10-01T11:00:00.000Z', true).ok).toBe(false);
    const older = planDoc({ id: 'a', createdAt: '2026-10-01T10:00:00.000Z' } as Partial<PlanDoc>) as PlanDoc & { id: string };
    const newer = { ...planDoc({ createdAt: '2026-10-02T10:00:00.000Z' }), id: 'b' };
    const r = resolveLivePlans([{ ...older, id: 'a' }, newer], '2026-10-03T00:00:00.000Z', '2026-10-03');
    expect(r.winner!.id).toBe('b');
    expect(r.replaced.map((p) => [p.id, p.ended?.reason])).toEqual([['a', 'replaced']]);
  });
});

describe('openProposals', () => {
  it('drops a proposal once a decision version names it as parent', () => {
    const v = (version: number, status: 'proposed' | 'adopted' | 'rejected', parent: number | null) => ({ version, status, parent });
    expect(openProposals([v(1, 'adopted', null), v(2, 'proposed', 1)]).map((x) => x.version)).toEqual([2]);
    expect(openProposals([v(1, 'adopted', null), v(2, 'proposed', 1), v(3, 'adopted', 2)])).toEqual([]);
    expect(openProposals([v(1, 'adopted', null), v(2, 'proposed', 1), v(3, 'rejected', 2), v(4, 'proposed', 1)]).map((x) => x.version)).toEqual([4]);
  });
});
