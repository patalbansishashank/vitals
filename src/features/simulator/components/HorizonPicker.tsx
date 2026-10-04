/**
 * Horizon picker (COMPONENTS §4): months bank + start date + "ends …" caption. Extending repeats the last week
 * ("Weeks 13–16 repeat week 12 · Undo"); shortening keeps the removed days in undo ("14 days removed · Restore").
 */
import { useId, useRef } from 'react';
import { CalendarDays } from 'lucide-react';
import { Icon, KeyBank, toast } from '@/components';
import {
  addDaysISO,
  formatDateShort,
  formatHorizon,
  HORIZON_MONTHS,
  monthsForDays,
  WEEKS_FOR_MONTHS,
} from '../lib/calendar';
import type { Schedule } from '@/engine';
import { editSchedule, undoSchedule } from '../commands';

export function HorizonPicker({
  sid,
  schedule,
  compact = false,
}: {
  sid: string;
  schedule: Schedule;
  compact?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
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
    <div className="sim-horizon" data-compact={compact || undefined}>
      <KeyBank
        size="sm"
        label="Horizon in months"
        options={HORIZON_MONTHS.map((m) => ({ value: String(m), label: m === 1 ? '1 mo' : String(m) }))}
        value={cur ? String(cur) : undefined}
        onChange={(v) => setDays(WEEKS_FOR_MONTHS[Number(v) as keyof typeof WEEKS_FOR_MONTHS] * 7)}
      />
      <span className="sim-horizon__start">
        <span className="lm-eng">{formatHorizon(schedule.horizonDays)} ·</span>
        <label className="sim-horizon__datebtn" htmlFor={id}>
          <span className="sim-horizon__datetext">{formatDateShort(schedule.startDate)}</span>
          <Icon icon={CalendarDays} size={16} />
          <input
            ref={input}
            id={id}
            type="date"
            className="sim-horizon__date"
            value={schedule.startDate}
            aria-label={`Start date, ${formatDateShort(schedule.startDate)}`}
            onClick={() => {
              try {
                input.current?.showPicker?.();
              } catch {
                /* not allowed without a gesture: the native control still opens */
              }
            }}
            onChange={(e) => {
              const v = e.currentTarget.value;
              if (/^\d{4}-\d{2}-\d{2}$/.test(v)) editSchedule(sid, [{ op: 'setStartDate', date: v }]);
            }}
          />
        </label>
        <span className="lm-eng sim-horizon__end">→ {formatDateShort(end)}</span>
      </span>
    </div>
  );
}
