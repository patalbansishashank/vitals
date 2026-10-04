/**
 * <DateStrip> (COMPONENTS §13.8): a week as seven day keys — the instrument's date dial on Today, Food and Train.
 * Today = pressed key + yellow dot; another selected date = 2 px ink ring; past days carry the 16 px adherence glyph,
 * future days a hollow dot; paused days are struck; the plan's first and last days carry a bracket.
 */
import { useRef, type KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { IconKey, cx } from '@/components';
import { AdherenceDial } from '@/features/charts/living/AdherenceDial';
import { addDays } from '@/living/dates';
import type { LocalDate } from '@/living';
import type { DayGlance } from '../data/types';
import { dayOfMonth, fmtDay, quietWord, weekdayKey } from '../format';
import { dialItemsOf } from '../model/adherence';

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
  return (
    <div className="lv-datestrip">
      <IconKey icon={ChevronLeft} label="Previous week" size="sm" variant="quiet" onClick={() => onWeek(-1)} />
      <div className="lv-datestrip__days" role="radiogroup" aria-label={label}>
        {days.map((d, i) => {
          const isToday = d.date === today;
          const isSel = d.date === selected;
          const past = d.date <= today;
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
              aria-label={dayLabel(d, today, quiet)}
              tabIndex={isSel ? 0 : -1}
              className={cx('lv-daykey', isToday && 'is-today', isSel && 'is-selected', d.paused && 'is-paused', !d.inPlan && 'is-outside', d.isStart && 'is-start', d.isEnd && 'is-end', d.assumed && 'is-assumed')}
              onClick={() => onSelect(d.date)}
              onKeyDown={(e) => onKey(e, i)}
            >
              <span className="lv-daykey__wd" aria-hidden="true">
                {weekdayKey(d.date)}
              </span>
              <span className="lv-daykey__num lm-num" aria-hidden="true">
                {dayOfMonth(d.date)}
              </span>
              <span className="lv-daykey__glyph" aria-hidden="true">
                {past && d.inPlan && d.score ? (
                  <AdherenceDial size="glyph" items={dialItemsOf(d.score)} score={d.score.score} final={d.score.final} label="" />
                ) : d.inPlan ? (
                  <span className="lv-daykey__dot" />
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
      <IconKey icon={ChevronRight} label="Next week" size="sm" variant="quiet" onClick={() => onWeek(1)} />
    </div>
  );
}
