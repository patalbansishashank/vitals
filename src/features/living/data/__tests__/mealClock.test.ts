/**
 * The manual meal logger's clock on the real engine (C1/D5-05): the logger's clock is a default (the slot's planned
 * clock, the current hour, noon for another day) unless the person stated it. A default reaches the command as no clock,
 * so the stored occurrence stays date-only (a backdated meal never ends a fast at a guessed noon) while the replay still
 * places the meal at that default hour; a stated clock is the meal's exact occurrence.
 */
import { freshState } from '@/commands/__tests__/harness';
import { settleCommits } from '@/commands';
import { getDocumentStore } from '@/state/runtime';
import { bodyOf } from '@/store';
import { addDays, type LogEntry } from '@/living';
import { currentDay, systemClock } from '../../clock';
import { createCommandLivingActions } from '../commands';
import { createDocumentLivingSource } from '../documents';
import { seedPlanDocs } from '../../__tests__/seedPlanDocs';

type Meal = Extract<LogEntry, { kind: 'meal' }>;
const meals = (): Meal[] => getDocumentStore().peekAll<LogEntry>('dailyLogs').map((d) => ({ ...bodyOf<LogEntry>(d), id: d._id })).filter((e): e is Meal => e.kind === 'meal');

describe('the manual meal logger’s clock (C1/D5-05)', () => {
  it('a default clock is no occurrence (date-only, replayed at that hour); a stated clock is exact', async () => {
    freshState({ cleared: true });
    const today = currentDay(systemClock);
    await seedPlanDocs({ startDate: addDays(today, -3) });
    const actions = createCommandLivingActions(createDocumentLivingSource());
    const yesterday = addDays(today, -1);
    expect((await actions.logMeal(yesterday, { clockH: 12, components: [{ name: 'thali', energyKcal: 600, proteinG: 30 }] })).ok).toBe(true);
    await settleCommits();
    const backdated = meals().find((m) => m.date === yesterday)!;
    expect(backdated.occurrence).toMatchObject({ precision: 'dateOnly', date: yesterday });
    expect(backdated.clockH).toBe(12);
    expect((await actions.logMeal(yesterday, { clockH: 19.5, clockStated: true, components: [{ name: 'soup', energyKcal: 250 }] })).ok).toBe(true);
    await settleCommits();
    const stated = meals().find((m) => m.date === yesterday && m.clockH === 19.5)!;
    expect(stated.occurrence?.precision).toBe('exact');
  });
});
