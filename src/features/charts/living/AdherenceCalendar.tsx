/* ==========================================================================
   <AdherenceCalendar> (CHART_SPEC §7.9) — a month of adherence: each in-plan
   day is a key with its date and a 16 px AdherenceDial glyph when scored.
   Unscored past days: hollow dot (unknown, never "failed"). Assumed days
   (filled in as planned): dashed outline, not scored. Paused days: struck.
   Future days: the number only, faint. Out-of-plan days stay blank. Today
   carries the yellow indicator dot. Arrow keys move through the grid
   (roving tab stop); Enter / click → onSelect(date).
   ========================================================================== */
import { memo, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Engraved } from '@/components';
import { AdherenceDial } from './AdherenceDial';
import { dateLabel, isoAddDays, isoDaysBetween, isoWeekday, monthTitle, quietScoreWord } from './trend';
import type { CalendarDay } from './types';
import './living-charts.css';

export type CalendarCellState = 'scored' | 'unscored' | 'assumed' | 'paused' | 'today' | 'future' | 'blank';

export interface CalendarCell {
  date: string;
  dayOfMonth: number;
  info: CalendarDay | null;
  state: CalendarCellState;
  isToday: boolean;
}

/** How a day is drawn. Paused and assumed win over a score (neither is ever scored). */
export function calendarCellState(info: CalendarDay | null, date: string, today: string): CalendarCellState {
  if (!info || !info.inPlan) return 'blank';
  if (info.paused) return 'paused';
  if (info.assumed) return 'assumed';
  if (info.score !== null && Number.isFinite(info.score)) return 'scored';
  const rel = isoDaysBetween(today, date);
  if (rel > 0) return 'future';
  if (rel === 0) return 'today';
  return 'unscored';
}

/** The month as weeks of 7 cells (null = padding before day 1 / after the last day). */
export function calendarWeeks(month: string, days: readonly CalendarDay[], today: string, weekStart: 'mon' | 'sun' = 'mon'): Array<Array<CalendarCell | null>> {
  const first = `${month}-01`;
  const [y, m] = [Number(month.slice(0, 4)), Number(month.slice(5, 7))];
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const n = isoDaysBetween(first, next);
  const byDate = new Map(days.map((d) => [d.date, d] as const));
  const lead = weekStart === 'mon' ? isoWeekday(first) : (isoWeekday(first) + 1) % 7;
  const cells: Array<CalendarCell | null> = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= n; d++) {
    const date = isoAddDays(first, d - 1);
    const info = byDate.get(date) ?? null;
    cells.push({ date, dayOfMonth: d, info, state: calendarCellState(info, date, today), isToday: date === today });
  }
  while (cells.length % 7) cells.push(null);
  const weeks: Array<Array<CalendarCell | null>> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** "Tue 14 Oct, adherence 84" · "…, filled in as planned, not scored" · quiet: "…, adherence mostly". */
export function calendarDayLabel(cell: CalendarCell, opts: { quiet?: boolean } = {}): string {
  const score = cell.info?.score ?? null;
  let body: string;
  switch (cell.state) {
    case 'scored':
      body = opts.quiet ? `adherence ${quietScoreWord(score)}` : `adherence ${Math.round(score ?? 0)}`;
      if (cell.info?.final === false) body += ' so far';
      break;
    case 'assumed':
      body = 'filled in as planned, not scored';
      break;
    case 'paused':
      body = 'paused';
      break;
    case 'unscored':
      body = 'not enough logged, not scored';
      break;
    case 'today':
      body = 'not scored yet';
      break;
    case 'future':
      body = 'coming up';
      break;
    default:
      body = 'not in the plan';
  }
  return `${dateLabel(cell.date)}, ${body}${cell.isToday ? ', today' : ''}`;
}

const WEEKDAYS = [
  { short: 'mon', long: 'Monday' },
  { short: 'tue', long: 'Tuesday' },
  { short: 'wed', long: 'Wednesday' },
  { short: 'thu', long: 'Thursday' },
  { short: 'fri', long: 'Friday' },
  { short: 'sat', long: 'Saturday' },
  { short: 'sun', long: 'Sunday' },
] as const;

const STEP: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

export interface AdherenceCalendarProps {
  /** "2026-10". */
  month: string;
  days: readonly CalendarDay[];
  /** ISO date of today (from the app clock). */
  today: string;
  onSelect?: (date: string) => void;
  /** The day currently open (outlined in ink). */
  selected?: string;
  /** Quiet mode: day labels use words ("adherence mostly"); the glyphs stay (they carry no number). */
  quiet?: boolean;
  weekStart?: 'mon' | 'sun';
  /** Visible caption above the grid; default the month, engraved ("october 2026"). `false` hides it. */
  caption?: ReactNode | false;
  /** Accessible name of the grid; default "Adherence, October 2026". */
  label?: string;
  className?: string;
}

const HOLLOW = (
  <svg width="16" height="16" viewBox="0 0 16 16">
    <circle className="lmc-cal__hollow" cx="8" cy="8" r="3" />
  </svg>
);
const STRIKE = (
  <svg width="16" height="16" viewBox="0 0 16 16">
    <line className="lmc-cal__strike" x1="2.5" y1="13.5" x2="13.5" y2="2.5" />
  </svg>
);

export const AdherenceCalendar = memo(function AdherenceCalendar({
  month,
  days,
  today,
  onSelect,
  selected,
  quiet = false,
  weekStart = 'mon',
  caption,
  label,
  className,
}: AdherenceCalendarProps) {
  const weeks = useMemo(() => calendarWeeks(month, days, today, weekStart), [month, days, today, weekStart]);
  const enabled = useMemo(() => weeks.flat().filter((c): c is CalendarCell => !!c && c.state !== 'blank').map((c) => c.date), [weeks]);
  const [focusDate, setFocusDate] = useState<string | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const has = (d: string | null | undefined): d is string => !!d && enabled.includes(d);
  const lastPast = [...enabled].reverse().find((d) => isoDaysBetween(today, d) <= 0);
  const tabDate = has(focusDate) ? focusDate : has(selected) ? selected : has(today) ? today : (lastPast ?? enabled[0] ?? null);
  const title = monthTitle(month);
  const wd = weekStart === 'mon' ? WEEKDAYS : [WEEKDAYS[6], ...WEEKDAYS.slice(0, 6)];

  const seek = (from: string, step: number): string | null => {
    let d = from;
    for (let k = 0; k < 42; k++) {
      d = isoAddDays(d, step);
      if (!d.startsWith(month)) return null;
      if (enabled.includes(d)) return d;
    }
    return null;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, date: string) => {
    const step = STEP[e.key];
    let target: string | null;
    if (step !== undefined) target = seek(date, step);
    else if (e.key === 'Home') target = enabled[0] ?? null;
    else if (e.key === 'End') target = enabled[enabled.length - 1] ?? null;
    else return;
    e.preventDefault();
    if (!target) return;
    setFocusDate(target);
    buttons.current.get(target)?.focus();
  };

  return (
    <div className={['lmc-cal', className].filter(Boolean).join(' ')} data-quiet={quiet ? 'true' : undefined}>
      {caption !== false ? <div className="lmc-cal__caption">{caption ?? <Engraved>{title.toLowerCase()}</Engraved>}</div> : null}
      <div role="grid" aria-label={label ?? `Adherence, ${title}`} aria-readonly="true" className="lmc-cal__grid">
        <div role="row" className="lmc-cal__row">
          {wd.map((w) => (
            <div key={w.short} role="columnheader" aria-label={w.long} className="lmc-cal__wd">
              <span className="lm-eng" aria-hidden="true">
                {w.short}
              </span>
            </div>
          ))}
        </div>
        {weeks.map((week, r) => (
          <div key={r} role="row" className="lmc-cal__row">
            {week.map((c, k) => {
              const isSel = !!c && c.date === selected;
              return (
                <div key={c?.date ?? `pad${r}-${k}`} role="gridcell" className="lmc-cal__cell" aria-selected={selected !== undefined && c && c.state !== 'blank' ? isSel : undefined}>
                  {c && c.state !== 'blank' ? (
                    <button
                      type="button"
                      ref={(el) => {
                        if (el) buttons.current.set(c.date, el);
                        else buttons.current.delete(c.date);
                      }}
                      className={`lmc-cal__day lmc-cal__day--${c.state}`}
                      data-state={c.state}
                      data-today={c.isToday ? 'true' : undefined}
                      data-selected={isSel ? 'true' : undefined}
                      aria-label={calendarDayLabel(c, { quiet })}
                      aria-current={c.isToday ? 'date' : undefined}
                      tabIndex={c.date === tabDate ? 0 : -1}
                      onClick={() => onSelect?.(c.date)}
                      onFocus={() => setFocusDate(c.date)}
                      onKeyDown={(e) => onKeyDown(e, c.date)}
                    >
                      <span className="lmc-cal__num" aria-hidden="true">
                        {c.dayOfMonth}
                      </span>
                      <span className="lmc-cal__mark" aria-hidden="true">
                        {c.state === 'scored' && c.info ? (
                          <AdherenceDial size="glyph" items={c.info.items ?? []} score={c.info.score} final={c.info.final ?? true} />
                        ) : c.state === 'unscored' ? (
                          HOLLOW
                        ) : c.state === 'paused' ? (
                          STRIKE
                        ) : null}
                      </span>
                      {c.isToday ? <span className="lmc-cal__now" aria-hidden="true" /> : null}
                    </button>
                  ) : c ? (
                    <span className="lmc-cal__blank" aria-hidden="true" />
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
});
