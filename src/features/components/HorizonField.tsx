/**
 * The horizon control the Simulator and the Planner share (COMPONENTS §4; planning audit #33): a months bank
 * ("1 mo … 6 mo") and one date chip ("19 Oct → 7 Feb") over the native date input, which opens the platform date
 * picker for the start. Presentational: each screen keeps its own store, length rules and feedback.
 */
import { useId, useRef } from 'react';
import { CalendarDays } from 'lucide-react';
import { Icon, KeyBank } from '@/components';
import './horizon.css';

export interface HorizonFieldProps {
  /** The bank's accessible name. */
  label: string;
  /** The month presets, in order. */
  months: readonly number[];
  /** The preset the horizon matches, or undefined (another length: no segment lit). */
  value: number | undefined;
  onMonths: (months: number) => void;
  /** ISO start and (inclusive) end dates. */
  startDate: string;
  endDate: string;
  /** "19 Oct". */
  formatDate: (iso: string) => string;
  /** Called with a valid ISO date only. */
  onStartDate: (iso: string) => void;
  disabled?: boolean;
  className?: string;
}

export function HorizonField({ label, months, value, onMonths, startDate, endDate, formatDate, onStartDate, disabled, className }: HorizonFieldProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className={className ? `lm-horizon ${className}` : 'lm-horizon'}>
      <KeyBank
        size="sm"
        label={label}
        value={value === undefined ? undefined : String(value)}
        onChange={(v) => onMonths(Number(v))}
        options={months.map((m) => ({ value: String(m), label: `${m} mo`, disabled }))}
      />
      <label className="lm-horizon__date" htmlFor={id} data-disabled={disabled || undefined}>
        <Icon icon={CalendarDays} size={16} />
        <span className="lm-meta">{`${formatDate(startDate)} → ${formatDate(endDate)}`}</span>
        <input
          ref={input}
          id={id}
          type="date"
          className="lm-horizon__input"
          value={startDate}
          disabled={disabled}
          aria-label={`Start date, ${formatDate(startDate)}`}
          onClick={() => {
            try {
              input.current?.showPicker?.();
            } catch {
              /* not allowed without a gesture: the native control still opens */
            }
          }}
          onChange={(e) => {
            const v = e.currentTarget.value;
            if (/^\d{4}-\d{2}-\d{2}$/.test(v)) onStartDate(v);
          }}
        />
      </label>
    </div>
  );
}
