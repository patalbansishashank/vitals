/**
 * The manual logger ("I ate something else", "Add more", "Add food") as one flow both meal pages share: the meal sheet
 * opens it on Today and on Food, and Food's "Add food" opens it for food outside the meals. It offers yesterday's meals
 * as one-tap recents, logs through `LivingActions.logMeal` with the toast and its Undo, and, with an AI provider, hands
 * the Coach what was typed with the meal and the date.
 */
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { toast } from '@/components';
import { addDays, compareDates } from '@/living/dates';
import type { LocalDate } from '@/living';
import { clockHourOf, useLivingClock, useToday } from '../clock';
import { useLivingActions, type ManualMealInput } from '../data/actions';
import { useLiving } from '../data/source';
import { livingPaths } from '../paths';
import { ManualLogger } from './components/ManualLogger';
import { FOOD_COPY } from './copy';
import { useRecipeProvider, type MealSlotTarget } from './recipes';
import { useCoachAvailable, useCoachOnServer } from '../coach/availability';
import { groupEntries, slotTargets } from './slots';

const T = FOOD_COPY.toasts;

export interface MealLogger {
  /** Opens the logger for a meal, or for food outside the meals (null). */
  open(target: MealSlotTarget | null): void;
  /** The logger itself, while it is open (render it once on the page). */
  element: ReactNode;
}

export function useMealLogger({ date, quiet, screen }: { date: LocalDate; quiet: boolean; screen: 'today' | 'food' }): MealLogger {
  const actions = useLivingActions();
  const navigate = useNavigate();
  const clock = useLivingClock();
  const today = useToday();
  const provider = useRecipeProvider();
  // paired: the Coach on the server takes the message (recipes are off there)
  const onServer = useCoachOnServer();
  const coachUp = useCoachAvailable();
  const coachOnServer = onServer && coachUp;
  const [logger, setLogger] = useState<{ target: MealSlotTarget | null; clockH: number; n: number } | null>(null);
  const rx = useLiving((s) => s.today(date)?.prescription ?? null, [date]);
  const yesterday = useLiving((s) => s.today(addDays(date, -1)), [date]);

  const open = (target: MealSlotTarget | null) => {
    const h = compareDates(date, today) === 0 ? clockHourOf(clock) : 12;
    setLogger((l) => ({ target, clockH: target?.clockH ?? h, n: (l?.n ?? 0) + 1 }));
  };

  if (!logger) return { open, element: null };

  const yesterdayGrouped = groupEntries((yesterday?.logged.entries ?? []).filter((e) => e.kind === 'meal'), slotTargets(yesterday?.prescription ?? null));
  const target = logger.target;

  const log = async (input: ManualMealInput): Promise<boolean> => {
    const name = input.slot ? (slotTargets(rx).find((s) => s.slot === input.slot)?.name ?? input.slot) : null;
    // recents and "same as yesterday" are yesterday's entries: relog them from that day
    const o = await actions.logMeal(date, input.relog ? { ...input, relog: { ...input.relog, date: input.relog.date ?? addDays(date, -1) } } : input);
    if (!o.ok) {
      toast(o.message ?? T.notSaved);
      return false;
    }
    const undo = o.undo;
    toast(name ? T.logged(name) : T.loggedOther, undo ? { action: { label: T.undo, onClick: () => void undo() } } : {});
    return true;
  };

  // what was typed goes into the Coach's composer to finish; the meal and the date go with the message
  const toCoach = (text: string) => {
    setLogger(null);
    navigate(livingPaths.coach(), { state: { draft: { text, prefill: true, context: { date, screen, ...(target ? { slot: target.slot, slotName: target.name } : {}) } } } });
  };

  return {
    open,
    element: (
      <ManualLogger
        key={logger.n}
        open
        onClose={() => setLogger(null)}
        target={target}
        clockH={logger.clockH}
        sameSlotYesterday={target ? (yesterdayGrouped.bySlot.get(target.slot) ?? []) : []}
        recents={target ? [] : [...yesterdayGrouped.bySlot.values()].flat().concat(yesterdayGrouped.other)}
        quiet={quiet}
        onLog={log}
        {...(provider.available || coachOnServer ? { onCoach: toCoach } : {})}
      />
    ),
  };
}
