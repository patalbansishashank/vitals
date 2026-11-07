/**
 * Lumen's date target (lumen.md §7, the period control's centre): a 48 px target with 10 px corners holding an 18 px
 * calendar icon (ink-3) and the date as a body-m label at 500 ("Sun 18 Oct", or "Wed 30 Sep · 21:00" with a time).
 * Tapping it opens the platform's own picker: a native date input lies transparent over the whole target, so none of
 * the browser's field (dd/mm/yyyy, its glyph) ever shows. Put it inside a <Field>, which gives it its label and error.
 */
import { useRef, type KeyboardEvent } from 'react';
import { Calendar } from 'lucide-react';
import { Icon, useField } from '@/components';
import { isLocalDate } from '@/living/dates';
import { DATE_COPY } from '../copy';
import { fmtDay } from '../format';

export interface DateTargetProps {
  /** `date`: "YYYY-MM-DD"; `datetime-local`: "YYYY-MM-DDTHH:mm" (local wall time). */
  type?: 'date' | 'datetime-local';
  value: string;
  /** Every change the picker makes, including "" when a keyboard clears it. */
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  className?: string;
}

/** What the target reads: "Sun 18 Oct", "Wed 30 Sep · 21:00", or the prompt when there is no date. */
export function dateTargetText(type: 'date' | 'datetime-local', value: string): string {
  const day = value.slice(0, 10);
  if (!isLocalDate(day)) return type === 'date' ? DATE_COPY.chooseDate : DATE_COPY.chooseDateTime;
  if (type === 'date') return fmtDay(day);
  const time = /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})/.exec(value)?.[1];
  return time ? `${fmtDay(day)} · ${time}` : fmtDay(day);
}

export function DateTarget({ type = 'date', value, onChange, min, max, className }: DateTargetProps) {
  const field = useField();
  const input = useRef<HTMLInputElement>(null);
  const open = () => {
    try {
      input.current?.showPicker?.();
    } catch {
      /* no user gesture, or no picker API: the native control still opens on its own */
    }
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  };
  return (
    <div className={className ? `lv-date ${className}` : 'lv-date'} data-invalid={field?.invalid || undefined}>
      <Icon icon={Calendar} size={18} className="lv-date__icon" />
      <span className="lv-date__text lm-num" aria-hidden="true">
        {dateTargetText(type, value)}
      </span>
      <input
        ref={input}
        id={field?.id}
        type={type}
        className="lv-date__input"
        value={value}
        min={min}
        max={max}
        aria-invalid={field?.invalid || undefined}
        aria-describedby={field?.describedBy}
        disabled={field?.disabled}
        onClick={open}
        onKeyDown={onKeyDown}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
    </div>
  );
}
