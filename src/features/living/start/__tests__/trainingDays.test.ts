import { dispatch, dispatchSync, outputOf } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { buildPersonProfile } from '@/features/body/model';
import { selectBodyValues, useProfileStore } from '@/state/profileStore';
import { useScheduleStore } from '@/state/scheduleStore';
import type { PersonProfile } from '@/engine';
import type { Weekday } from '@/living';
import { habitualWeekdays, trainingWeekdays } from '../StartPlanSheet';

// Q1B-B-09: a scenario whose days are "training as usual" for someone who doesn't train started as "training on mon…sun".
describe('start sheet training days', () => {
  beforeEach(() => freshState({ cleared: true }));

  async function schedule() {
    const id = outputOf(dispatchSync('scenario.ensureActive', {}))!.scenarioId;
    await dispatch('scenario.applyStarter', { id, starter: 'maintenance8' });
    return useScheduleStore.getState().scenarios.find((s) => s.id === id)!.schedule;
  }

  it('"training as usual" days count only on the weekdays the habitual week trains', async () => {
    const painted = await schedule();
    // every day "training as usual", no sessions of its own (a scenario with 0 lifts)
    const s = { ...painted, programs: painted.programs.map((p) => ({ ...p, exercise: [], habitualTraining: true })), days: painted.days.map((d) => ({ program: d.program })) };
    expect(trainingWeekdays(s, new Set())).toEqual([]);
    expect(trainingWeekdays(s, new Set<Weekday>([0, 2, 4]))).toEqual([0, 2, 4]);
  });

  it('no habitual sessions → no habitual training weekdays; three a week → three weekdays', () => {
    const base = buildPersonProfile(selectBodyValues(useProfileStore.getState()));
    const withSessions = (n: number): PersonProfile => ({ ...base, habits: { ...base.habits, sessionsPerWeek: n } });
    expect([...habitualWeekdays(withSessions(0))]).toEqual([]);
    expect(habitualWeekdays(withSessions(3)).size).toBe(3);
  });
});
