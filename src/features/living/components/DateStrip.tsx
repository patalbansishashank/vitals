/**
 * <DateStrip> (COMPONENTS §13.8): the week on Today, Food and Train, as a plain card: the week's dates in the head with
 * small ‹ › keys, then seven day keys ("Mon 5"). The selected day is pressed; today's key is signal yellow. No glyphs
 * or dots: what a day holds (logged, paused, preview, outside the plan) is in each key's accessible name and tooltip.
 */
import { useRef, type KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Faceplate, IconKey, cx } from '@/components';
import { addDays } from '@/living/dates';
import type { LocalDate } from '@/living';
import type { DayGlance } from '../data/types';
import { dayOfMonth, fmtDateRange, fmtDay, quietWord, weekdayKey } from '../format';

export interface DateStripProps {
  days: readonly DayGlance[];
  selected: LocalDate;
  today: LocalDate;
  onSelect: (date: LocalDate) => void;
  /** Move a whole week (‹ ›). */
  onWeek: (delta: -1 | 1) => void;
  quiet?: boolean;
  label?: string;
}

function dayLabel(d: DayGlance, today: LocalDate, quiet: boolean): string {
  const parts = [fmtDay(d.date)];
  if (d.date === today) parts.push('today');
  if (!d.inPlan) parts.push('outside the plan');
  else if (d.paused) parts.push('paused');
  else if (d.assumed) parts.push('filled in as planned');
  if (d.score && d.date <= today) {
    const s = d.score.score;
    parts.push(quiet ? `adherence ${quietWord(s)}` : s === null ? 'not enough logged' : `adherence ${d.score.final ? '' : 'so far '}${Math.round(s)}`);
  }
  if (d.date > today) parts.push('preview');
  return parts.join(', ');
}

export function DateStrip({ days, selected, today, onSelect, onWeek, quiet = false, label = 'Day' }: DateStripProps) {
  const refs = useRef(new Map<LocalDate, HTMLButtonElement>());
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = days[i + delta];
    if (next) {
      onSelect(next.date);
      refs.current.get(next.date)?.focus();
    } else {
      // past the edge: select the neighbouring day; the strip re-centres on the selected date's week
      onSelect(addDays(days[i]!.date, delta));
    }
  };
  const first = days[0]?.date;
  const last = days[days.length - 1]?.date;
  return (
    <Faceplate
      className="lv-datestrip"
      title={first && last ? fmtDateRange(first, last) : label}
      titleAs="h2"
      aria-label={`${label}: week`}
      actions={
        <span className="lv-datestrip__nav">
          <IconKey icon={ChevronLeft} label="Previous week" size="sm" variant="quiet" onClick={() => onWeek(-1)} />
          <IconKey icon={ChevronRight} label="Next week" size="sm" variant="quiet" onClick={() => onWeek(1)} />
        </span>
      }
    >
      <div className="lv-datestrip__days" role="radiogroup" aria-label={label}>
        {days.map((d, i) => {
          const isToday = d.date === today;
          const isSel = d.date === selected;
          const name = dayLabel(d, today, quiet);
          return (
            <button
              key={d.date}
              ref={(el) => {
                if (el) refs.current.set(d.date, el);
                else refs.current.delete(d.date);
              }}
              type="button"
              role="radio"
              aria-checked={isSel}
              aria-label={name}
              title={name}
              tabIndex={isSel ? 0 : -1}
              className={cx('lv-daykey', isToday && 'is-today', isSel && 'is-selected', d.paused && 'is-paused', !d.inPlan && 'is-outside')}
              onClick={() => onSelect(d.date)}
              onKeyDown={(e) => onKey(e, i)}
            >
              <span className="lv-daykey__wd" aria-hidden="true">
                {weekdayKey(d.date)}
              </span>{' '}
              <span className="lv-daykey__num lm-num" aria-hidden="true">
                {dayOfMonth(d.date)}
              </span>
            </button>
          );
        })}
      </div>
    </Faceplate>
  );
}
