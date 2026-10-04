/**
 * The Body signals period bar (design/screens/ring-pages.md §6.2, §7.1): a key bank day · week · month · year (radio
 * semantics), then ‹ label › and a "today" key. Switching period keeps the anchor date; ‹ › step to the canonical start
 * of the neighbouring period; › stops at the period containing today, ‹ at the period of the first record; "today"
 * shows when the tab's reference day is not in view. The label opens a month calendar ("Go to date"): days with
 * readings carry a 4 px ink dot, days after today cannot be picked, arrow keys move, Enter or Space picks.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { IconKey, Key, KeyBank, Popover } from '@/components';
import { addDays, weekdayOf } from '@/living/dates';
import type { LocalDate } from '@/living';
import { SIGNALS_PAGE_COPY as C } from './copyPage';
import {
  calendarWeeks,
  canGoEarlier,
  canGoLater,
  containsDate,
  monthStart,
  monthText,
  nextMonthStart,
  PERIOD_KINDS,
  periodLabel,
  prevMonthStart,
  shiftPeriod,
  type DateStyle,
  type PeriodKind,
  type PeriodWindow,
  type SignalsTab,
} from './models';

export interface PeriodBarProps {
  tab: SignalsTab;
  window: PeriodWindow;
  today: LocalDate;
  /** The tab's reference day: where "today" goes. */
  referenceDay: LocalDate;
  /** First date with any record (‹ stops at its period); null when nothing is stored. */
  firstDate: LocalDate | null;
  /** Dates with any record (the calendar's dots). */
  datesWithData: ReadonlySet<LocalDate>;
  dateStyle?: DateStyle;
  onPeriod: (period: PeriodKind) => void;
  /** A new anchor date; null = the tab's reference day. */
  onDate: (date: LocalDate | null) => void;
}

export function PeriodBar({ tab, window: w, today, referenceDay, firstDate, datesWithData, dateStyle = 'day-month', onPeriod, onDate }: PeriodBarProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const label = periodLabel(tab, w, today, dateStyle);
  const earlier = canGoEarlier(w, firstDate);
  const later = canGoLater(w, today);
  const showToday = !containsDate(w, referenceDay);
  const pick = (d: LocalDate) => {
    setOpen(false);
    anchorRef.current?.focus();
    onDate(d);
  };

  return (
    <div className="sp-period">
      <KeyBank<PeriodKind>
        className="sp-period__kinds"
        label={C.periodLabel}
        value={w.kind}
        onChange={onPeriod}
        options={PERIOD_KINDS.map((p) => ({ value: p, label: C.periods[p] }))}
      />
      <div className="sp-period__nav" role="group" aria-label={C.navLabel}>
        <IconKey
          className="sp-period__step"
          icon={ChevronLeft}
          label={C.earlier(w.kind)}
          {...(earlier ? { onClick: () => onDate(shiftPeriod(w.kind, w.anchor, -1)) } : { disabledReason: C.earlierBlocked })}
        />
        <Key
          ref={anchorRef}
          className="sp-period__label"
          variant="quiet"
          trailingIcon={ChevronDown}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {label}
        </Key>
        <IconKey
          className="sp-period__step"
          icon={ChevronRight}
          label={C.later(w.kind)}
          {...(later ? { onClick: () => onDate(shiftPeriod(w.kind, w.anchor, 1)) } : { disabledReason: C.laterBlocked })}
        />
        {showToday ? (
          <Key className="sp-period__today" variant="quiet" aria-label={C.todayName(tab)} onClick={() => onDate(null)}>
            {C.today}
          </Key>
        ) : null}
      </div>
      <Popover open={open} onOpenChange={setOpen} anchorRef={anchorRef} label={C.goToDate} autoFocus={false} className="sp-cal-pop">
        <MonthCalendar value={w.anchor} today={today} datesWithData={datesWithData} onPick={pick} />
      </Popover>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ calendar */

/** "Sunday 4 October 2026". */
const fullDay = (d: LocalDate) => `${C.weekdaysLong[weekdayOf(d)]} ${Number(d.slice(8, 10))} ${monthText(d)}`;

export interface MonthCalendarProps {
  /** The selected date (the period's anchor). */
  value: LocalDate;
  today: LocalDate;
  datesWithData: ReadonlySet<LocalDate>;
  onPick: (date: LocalDate) => void;
}

/** A month grid, Monday first. Arrow keys move a day or a week, Home/End to the week's ends, Page Up/Down a month. */
export function MonthCalendar({ value, today, datesWithData, onPick }: MonthCalendarProps) {
  const start = value > today ? today : value;
  const [month, setMonth] = useState(monthStart(start));
  const [focus, setFocus] = useState<LocalDate>(start);
  const grid = useRef<HTMLTableElement>(null);
  const moved = useRef(true); // focus the day on open
  const titleId = useId();
  const monthId = useId();

  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    grid.current?.querySelector<HTMLButtonElement>(`button[data-date="${focus}"]`)?.focus({ preventScroll: true });
  }, [focus, month]);

  const goTo = (d: LocalDate) => {
    const next = d > today ? today : d;
    moved.current = true;
    setFocus(next);
    setMonth(monthStart(next));
  };

  const showMonth = (m: LocalDate) => {
    setMonth(m);
    // keep the focusable day inside the shown month, never after today
    const inMonth = monthStart(focus) === m ? focus : m;
    setFocus(inMonth > today ? today : inMonth);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTableElement>) => {
    const step: Record<string, () => LocalDate> = {
      ArrowLeft: () => addDays(focus, -1),
      ArrowRight: () => addDays(focus, 1),
      ArrowUp: () => addDays(focus, -7),
      ArrowDown: () => addDays(focus, 7),
      Home: () => addDays(focus, -weekdayOf(focus)),
      End: () => addDays(focus, 6 - weekdayOf(focus)),
      PageUp: () => {
        const p = prevMonthStart(focus);
        return addDays(p, Math.min(Number(focus.slice(8, 10)), daysIn(p)) - 1);
      },
      PageDown: () => {
        const n = nextMonthStart(focus);
        return addDays(n, Math.min(Number(focus.slice(8, 10)), daysIn(n)) - 1);
      },
    };
    const f = step[e.key];
    if (!f) return;
    e.preventDefault();
    goTo(f());
  };

  const nextMonth = nextMonthStart(month);
  return (
    <div className="sp-cal" role="group" aria-labelledby={titleId}>
      <h2 className="sp-cal__title lm-eng" id={titleId}>
        {C.goToDate}
      </h2>
      <div className="sp-cal__head">
        <IconKey size="sm" icon={ChevronLeft} label={C.prevMonth} onClick={() => showMonth(prevMonthStart(month))} />
        <span className="sp-cal__month" id={monthId} aria-live="polite">
          {monthText(month)}
        </span>
        <IconKey
          size="sm"
          icon={ChevronRight}
          label={C.nextMonth}
          {...(nextMonth <= today ? { onClick: () => showMonth(nextMonth) } : { disabledReason: C.laterBlocked })}
        />
      </div>
      <table ref={grid} role="grid" aria-labelledby={monthId} className="sp-cal__grid" onKeyDown={onKeyDown}>
        <thead>
          <tr>
            {C.weekdays.map((d, i) => (
              <th key={d} scope="col" abbr={C.weekdaysLong[i]}>
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {calendarWeeks(month).map((week) => (
            <tr key={week[0]}>
              {week.map((d) => {
                if (monthStart(d) !== month) return <td key={d} role="gridcell" />;
                const future = d > today;
                const has = datesWithData.has(d);
                return (
                  <td key={d} role="gridcell" aria-selected={d === value}>
                    <button
                      type="button"
                      className="sp-cal__day"
                      data-date={d}
                      data-selected={d === value || undefined}
                      data-today={d === today || undefined}
                      tabIndex={d === focus ? 0 : -1}
                      disabled={future}
                      aria-current={d === today ? 'date' : undefined}
                      aria-label={`${fullDay(d)}, ${future ? C.future : has ? C.hasData : C.noData}`}
                      onClick={() => onPick(d)}
                      onFocus={() => setFocus(d)}
                    >
                      <span aria-hidden="true">{Number(d.slice(8, 10))}</span>
                      {has && !future ? <span className="sp-cal__dot" aria-hidden="true" /> : null}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="sp-cal__hint">{C.calendarHint}</p>
    </div>
  );
}

function daysIn(monthFirst: LocalDate): number {
  return Number(addDays(nextMonthStart(monthFirst), -1).slice(8, 10));
}
