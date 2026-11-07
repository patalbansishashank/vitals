/**
 * Horizon picker (COMPONENTS §4): the shared months bank and start-date chip (HorizonField, also on the Planner) over
 * the scenario's schedule. Extending repeats the last week ("Weeks 13–16 repeat the last week · Undo"); shortening
 * keeps the removed days in undo ("14 days removed · Restore").
 */
import { toast } from '@/components';
import { HorizonField } from '@/features/components/HorizonField';
import { addDaysISO, formatDateShort, HORIZON_MONTHS, monthsForDays, WEEKS_FOR_MONTHS } from '../lib/calendar';
import type { Schedule } from '@/engine';
import { editSchedule, undoSchedule } from '../commands';

export function HorizonPicker({ sid, schedule }: { sid: string; schedule: Schedule }) {
  const cur = monthsForDays(schedule.horizonDays);
  const end = addDaysISO(schedule.startDate, schedule.horizonDays - 1);
  const setDays = (days: number) => {
    const before = schedule.horizonDays;
    if (days === before) return;
    editSchedule(sid, [{ op: 'setHorizon', days }]);
    const undo = { label: days < before ? 'Restore' : 'Undo', onClick: () => undoSchedule(sid) };
    if (days < before) toast(`${before - days} days removed`, { action: undo });
    else
      toast(`Weeks ${Math.floor(before / 7) + 1}–${Math.ceil(days / 7)} repeat the last week`, {
        action: undo,
      });
  };
  return (
    <HorizonField
      label="Horizon in months"
      months={HORIZON_MONTHS}
      value={cur ?? undefined}
      onMonths={(m) => setDays(WEEKS_FOR_MONTHS[m as keyof typeof WEEKS_FOR_MONTHS] * 7)}
      startDate={schedule.startDate}
      endDate={end}
      formatDate={formatDateShort}
      onStartDate={(date) => editSchedule(sid, [{ op: 'setStartDate', date }])}
    />
  );
}
