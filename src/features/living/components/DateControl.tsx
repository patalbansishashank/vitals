/**
 * <DateControl> (r069 U2): the one date selector of every dated page. It replaces the week strip and its ‹ › keys
 * (owner: "only the current date should be shown"): one full-width row in the card material that reads the selection
 * ("Today · Thu 29 Oct", "This week · 26 Oct–1 Nov", "September 2026") and opens the calendar.
 *
 * The calendar is Gauge's history date picker (`LumenCalendar` in the Lumen Health app: a compact month without an
 * empty sixth week, the month's name as a key that zooms out to months and then years, ‹ › beside it, narrow weekday
 * letters, 48 px day targets) drawn in Vitals' own material: the selected day or span is the gold tile, today's date is
 * gold, a day that holds data carries a small dot in the tab's hue (`domain`). Above it, on pages of scores and
 * metrics, the period bank (Day · Week · Month · Year · Range). A bottom sheet on phones (title · ✕), a popover under
 * the control from 1024 px. Its styles are `dateControl.css`, beside this file (r071).
 *
 * Every pick applies at once, so the sheet commits nothing of its own: a day, a week, a month or a year closes it; a
 * range takes its first and last day; the period bank re-reads the page behind the open calendar (the week, month or
 * year around what is shown) so a second tap picks another one; "Today" ("This week", …) goes back and closes.
 */
import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { Icon, IconKey, Key, KeyBank, MQ, Popover, Sheet, cx, useMediaQuery, type DomainName } from '@/components';
import { addDays, weekdayOf } from '@/living/dates';
import type { LocalDate } from '@/living';
import { fmtDay, fmtMonth } from '../format';
import './dateControl.css';
import {
  DAY_ONLY,
  PERIOD_KINDS,
  dayPeriod,
  monthEnd,
  monthOf,
  monthStart,
  monthWeeks,
  overlaps,
  periodAround,
  periodEnd,
  periodOf,
  periodWords,
  rangePeriod,
  shiftMonth,
  type Period,
  type PeriodKind,
} from '../period';

/** Which days hold data, for the month on screen (a hook: it may read a loader). Null while unknown. */
export type DateMarks = (from: LocalDate, to: LocalDate) => ReadonlySet<string> | null;

export interface DateControlProps {
  /** What the page shows. */
  value: Period;
  /** A pick: the page puts it in its address (or state) and passes it back as `value`. */
  onChange: (next: Period) => void;
  /** Today, from the page's clock. */
  today: LocalDate;
  /** Periods the page can show, in the bank's order (default Day only: no bank). */
  periods?: readonly PeriodKind[];
  /** Earliest day that can be picked (default none). */
  min?: LocalDate;
  /** Latest day that can be picked (default none: a plan's days ahead open as a preview; measured pages pass today). */
  max?: LocalDate;
  /** Marks days that hold data; called only while the calendar is open. */
  useMarks?: DateMarks;
  /** The calendar's name ("Day", "Dates"); default "Choose a day" with Day only, else "Choose dates". */
  title?: string;
  /** The tab's hue (r071): the calendar icon and the dots of days that hold data wear this domain's colour (stone without one). */
  domain?: DomainName;
  className?: string;
}

const KIND_LABEL: Record<PeriodKind, string> = { day: 'Day', week: 'Week', month: 'Month', year: 'Year', range: 'Range' };
const BACK_LABEL: Record<PeriodKind, string> = { day: 'Today', week: 'This week', month: 'This month', year: 'This year', range: 'Today' };
const WEEKDAYS = [
  ['M', 'Monday'],
  ['T', 'Tuesday'],
  ['W', 'Wednesday'],
  ['T', 'Thursday'],
  ['F', 'Friday'],
  ['S', 'Saturday'],
  ['S', 'Sunday'],
] as const;
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const YEARS_PER_PAGE = 12;

export function DateControl({ value, onChange, today, periods = DAY_ONLY, min, max, useMarks, title, domain, className }: DateControlProps) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const lg = useMediaQuery(MQ.lg);
  const words = periodWords(value, today);
  const name = title ?? (periods.length > 1 ? 'Choose dates' : 'Choose a day');
  const close = () => setOpen(false);
  const picker = (
    <PeriodPicker
      value={value}
      today={today}
      periods={periods}
      min={min ?? null}
      max={max ?? null}
      useMarks={useMarks}
      domain={domain}
      onChange={onChange}
      onDone={(p) => {
        onChange(p);
        close();
        anchor.current?.focus({ preventScroll: true });
      }}
    />
  );
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={cx('lv-datectl', className)}
        data-domain={domain}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${words.text}, ${name.toLowerCase()}`}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon icon={CalendarDays} size={18} className="lv-datectl__icon" />
        <span className="lv-datectl__text">
          {words.lead ? (
            <>
              <span className="lv-datectl__lead">{words.lead}</span>
              <span className="lv-datectl__dot">·</span>
            </>
          ) : null}
          <span className="lv-datectl__detail lm-num">{words.detail}</span>
        </span>
        <Icon icon={ChevronDown} size={18} className="lv-datectl__chev" />
      </button>
      {lg ? (
        <Popover open={open} onOpenChange={setOpen} anchorRef={anchor} label={name} className="lv-cal-pop" placement="bottom-start">
          {picker}
        </Popover>
      ) : (
        <Sheet open={open} onClose={close} title={name} className="lv-cal-sheet">
          {picker}
        </Sheet>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------

type Zoom = 'days' | 'months' | 'years';
const baseZoom = (k: PeriodKind): Zoom => (k === 'month' ? 'months' : k === 'year' ? 'years' : 'days');

export interface PeriodPickerProps {
  value: Period;
  today: LocalDate;
  periods: readonly PeriodKind[];
  min: LocalDate | null;
  max: LocalDate | null;
  useMarks?: DateMarks;
  /** The tab's hue for the data dots (`data-domain` on the calendar). */
  domain?: DomainName;
  /** The bank's change, applied with the calendar left open. */
  onChange: (p: Period) => void;
  /** A finished pick: apply and close. */
  onDone: (p: Period) => void;
}

const noMarks: DateMarks = () => null;

/** The calendar's body: the period bank, the selection line, the month (or months, or years) and its keys. */
export function PeriodPicker({ value, today, periods, min, max, useMarks, domain, onChange, onDone }: PeriodPickerProps) {
  const offered = PERIOD_KINDS.filter((k) => periods.includes(k));
  const [kind, setKind] = useState<PeriodKind>(offered.includes(value.kind) ? value.kind : (offered[0] ?? 'day'));
  // the day the page's period is "about": a day itself, else its last day so far (never past the bounds)
  const focusOf = (p: Period): LocalDate => {
    let d = p.kind === 'day' ? p.from : periodEnd(p, max ?? today);
    if (max && d > max) d = max;
    if (min && d < min) d = min;
    return d;
  };
  const [zoom, setZoom] = useState<Zoom>(baseZoom(kind));
  const [month, setMonth] = useState(() => monthOf(focusOf(value)));
  // a page of years ends on the latest year there is, or on the year shown when that is long ago
  const lastYear = (y: number) => {
    const last = Number((max ?? today).slice(0, 4));
    return y > last - YEARS_PER_PAGE && y <= last ? last : y;
  };
  const [yearsEnd, setYearsEnd] = useState(() => lastYear(Number(focusOf(value).slice(0, 4))));
  const [rangeStart, setRangeStart] = useState<LocalDate | null>(null);
  const year = Number(month.slice(0, 4));

  const weeks = useMemo(() => monthWeeks(month), [month]);
  const marks = (useMarks ?? noMarks)(monthStart(month), monthEnd(month));

  const pickKind = (k: PeriodKind) => {
    setKind(k);
    setZoom(baseZoom(k));
    setRangeStart(null);
    const at = focusOf(value);
    setMonth(monthOf(at));
    setYearsEnd(lastYear(Number(at.slice(0, 4))));
    // the page behind shows the new period at once (a range waits for its two days)
    if (k !== 'range' && k !== value.kind) onChange(periodAround(k, at));
  };

  const back = () => onDone(kind === 'range' ? dayPeriod(today) : periodOf(kind, today));

  const pickDay = (d: LocalDate) => {
    if (kind === 'week') return onDone(periodOf('week', d));
    if (kind === 'range') {
      if (!rangeStart) return setRangeStart(d);
      return onDone(rangePeriod(rangeStart, d));
    }
    onDone(dayPeriod(d));
  };

  // what the grid draws as selected: the half-picked range's first day, or the page's period when it is of this kind
  const shown: Period | null = rangeStart ? dayPeriod(rangeStart) : kind === value.kind ? value : null;

  const line = kind === 'range' ? (rangeStart ? `${fmtDay(rangeStart)} – tap the last day` : value.kind === 'range' ? periodWords(value, today).text : 'Tap the first day') : periodWords(value, today).text;

  // ---- the head row of the grid: its name (a key that zooms out), Today, ‹ ›
  let headName: ReactNode;
  let prev: { label: string; go: () => void; ok: boolean };
  let next: { label: string; go: () => void; ok: boolean };
  if (zoom === 'days') {
    headName = `${fmtMonth(month)} ${year}`;
    prev = { label: 'Previous month', go: () => setMonth(shiftMonth(month, -1)), ok: overlaps(monthStart(shiftMonth(month, -1)), monthEnd(shiftMonth(month, -1)), min, max) };
    next = { label: 'Next month', go: () => setMonth(shiftMonth(month, 1)), ok: overlaps(monthStart(shiftMonth(month, 1)), monthEnd(shiftMonth(month, 1)), min, max) };
  } else if (zoom === 'months') {
    headName = String(year);
    prev = { label: 'Previous year', go: () => setMonth(shiftMonth(month, -12)), ok: overlaps(`${year - 1}-01-01`, `${year - 1}-12-31`, min, max) };
    next = { label: 'Next year', go: () => setMonth(shiftMonth(month, 12)), ok: overlaps(`${year + 1}-01-01`, `${year + 1}-12-31`, min, max) };
  } else {
    const first = yearsEnd - YEARS_PER_PAGE + 1;
    headName = `${first}–${yearsEnd}`;
    prev = { label: 'Earlier years', go: () => setYearsEnd(yearsEnd - YEARS_PER_PAGE), ok: overlaps(`${first - YEARS_PER_PAGE}-01-01`, `${first - 1}-12-31`, min, max) };
    next = { label: 'Later years', go: () => setYearsEnd(yearsEnd + YEARS_PER_PAGE), ok: overlaps(`${yearsEnd + 1}-01-01`, `${yearsEnd + YEARS_PER_PAGE}-12-31`, min, max) };
  }
  const canZoomOut = zoom !== 'years';
  const zoomOut = () => {
    if (zoom === 'days') setZoom('months');
    else if (zoom === 'months') {
      setYearsEnd(lastYear(year));
      setZoom('years');
    }
  };

  return (
    <div className="lv-cal" data-domain={domain}>
      {offered.length > 1 ? <KeyBank label="Period" options={offered.map((k) => ({ value: k, label: KIND_LABEL[k] }))} value={kind} onChange={pickKind} className="lv-cal__bank" /> : null}
      {/* what is shown (the control under the sheet is covered on a phone), or the range's next step; a Day-only
          calendar needs neither: its control reads the day and the grid marks it */}
      {offered.length > 1 ? (
        <p className="lv-cal__line lm-num" aria-live="polite">
          {line}
        </p>
      ) : null}
      <div className="lv-cal__head">
        {canZoomOut ? (
          <button type="button" className="lv-cal__name" aria-label={`${headName}, choose ${zoom === 'days' ? 'a month' : 'a year'}`} onClick={zoomOut}>
            <span className="lm-num">{headName}</span>
            <Icon icon={ChevronDown} size={16} className="lv-cal__namechev" />
          </button>
        ) : (
          <span className="lv-cal__name is-static lm-num">{headName}</span>
        )}
        <Key variant="outlined" size="sm" className="lv-cal__back" onClick={back}>
          {BACK_LABEL[kind]}
        </Key>
        <span className="lv-cal__nav">
          <IconKey icon={ChevronLeft} label={prev.label} size="sm" disabled={!prev.ok} onClick={prev.go} />
          <IconKey icon={ChevronRight} label={next.label} size="sm" disabled={!next.ok} onClick={next.go} />
        </span>
      </div>
      {zoom === 'days' ? (
        <DayGrid
          weeks={weeks}
          month={month}
          kind={kind}
          shown={shown}
          today={today}
          min={min}
          max={max}
          marks={marks}
          onPick={pickDay}
          onMonth={setMonth}
        />
      ) : zoom === 'months' ? (
        <TileGrid
          label={`Months of ${year}`}
          tiles={MONTHS_SHORT.map((m, i) => {
            const mm = `${year}-${String(i + 1).padStart(2, '0')}`;
            const sel = kind === 'month' ? value.kind === 'month' && monthOf(value.from) === mm : mm === month;
            return { id: mm, text: m, name: `${fmtMonth(mm)} ${year}`, selected: sel, current: mm === monthOf(today), disabled: !overlaps(monthStart(mm), monthEnd(mm), min, max) };
          })}
          onPick={(mm) => {
            if (kind === 'month') return onDone(periodOf('month', monthStart(mm)));
            setMonth(mm);
            setZoom('days');
          }}
        />
      ) : (
        <TileGrid
          label="Years"
          tiles={Array.from({ length: YEARS_PER_PAGE }, (_, i) => {
            const y = yearsEnd - YEARS_PER_PAGE + 1 + i;
            const sel = kind === 'year' ? value.kind === 'year' && Number(value.from.slice(0, 4)) === y : y === year;
            return { id: String(y), text: String(y), name: String(y), selected: sel, current: String(y) === today.slice(0, 4), disabled: !overlaps(`${y}-01-01`, `${y}-12-31`, min, max) };
          })}
          onPick={(y) => {
            if (kind === 'year') return onDone(periodOf('year', `${y}-01-01`));
            setMonth(`${y}-${month.slice(5, 7)}`);
            setZoom('months');
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------

const STEP: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

function DayGrid({
  weeks,
  month,
  kind,
  shown,
  today,
  min,
  max,
  marks,
  onPick,
  onMonth,
}: {
  weeks: Array<Array<LocalDate | null>>;
  month: string;
  kind: PeriodKind;
  shown: Period | null;
  today: LocalDate;
  min: LocalDate | null;
  max: LocalDate | null;
  marks: ReadonlySet<string> | null;
  onPick: (d: LocalDate) => void;
  onMonth: (m: string) => void;
}) {
  const buttons = useRef(new Map<LocalDate, HTMLButtonElement>());
  const [focusDate, setFocusDate] = useState<LocalDate | null>(null);
  const follow = useRef<LocalDate | null>(null);
  const ok = (d: LocalDate) => (min === null || d >= min) && (max === null || d <= max);
  const days = weeks.flat().filter((d): d is LocalDate => !!d);
  const enabled = days.filter(ok);
  const has = (d: LocalDate | null | undefined): d is LocalDate => !!d && enabled.includes(d);
  const tabDate = has(focusDate) ? focusDate : shown && has(shown.to) ? shown.to : shown && has(shown.from) ? shown.from : has(today) ? today : (enabled[enabled.length - 1] ?? null);

  // a key that left the month: the grid turns to the new month and focus follows the day there
  useLayoutEffect(() => {
    const want = follow.current;
    if (!want) return;
    const el = buttons.current.get(want);
    if (el) {
      follow.current = null;
      el.focus();
    }
  }, [month]);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, d: LocalDate) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    let target: LocalDate;
    if (STEP[e.key] !== undefined) target = addDays(d, STEP[e.key]!);
    else if (e.key === 'Home') target = addDays(d, -weekdayOf(d));
    else if (e.key === 'End') target = addDays(d, 6 - weekdayOf(d));
    else if (e.key === 'PageUp' || e.key === 'PageDown') {
      const m = shiftMonth(monthOf(d), e.key === 'PageUp' ? -1 : 1);
      const day = Math.min(Number(d.slice(8, 10)), Number(monthEnd(m).slice(8, 10)));
      target = `${m}-${String(day).padStart(2, '0')}`;
    } else return;
    e.preventDefault();
    if (!ok(target)) return;
    setFocusDate(target);
    if (monthOf(target) !== month) {
      follow.current = target;
      onMonth(monthOf(target));
    } else buttons.current.get(target)?.focus();
  };

  const inShown = (d: LocalDate) => !!shown && d >= shown.from && d <= shown.to;

  return (
    <div role="grid" aria-label={`${fmtMonth(month)} ${month.slice(0, 4)}`} className="lv-cal__grid" data-kind={kind}>
      <div role="row" className="lv-cal__row">
        {WEEKDAYS.map(([short, long]) => (
          <div key={long} role="columnheader" aria-label={long} className="lv-cal__wd">
            <span aria-hidden="true">{short}</span>
          </div>
        ))}
      </div>
      {weeks.map((week, r) => (
        <div key={r} role="row" className="lv-cal__row">
          {week.map((d, c) => {
            if (!d) return <div key={`pad${r}-${c}`} role="gridcell" className="lv-cal__cell" />;
            const sel = inShown(d);
            const prevIn = sel && c > 0 && week[c - 1] !== null && inShown(week[c - 1]!);
            const nextIn = sel && c < 6 && week[c + 1] !== null && inShown(week[c + 1]!);
            const usable = ok(d);
            const marked = !!marks?.has(d);
            const name = [fmtDay(d), d === today ? 'today' : null, marked ? 'has data' : null].filter(Boolean).join(', ');
            return (
              <div
                key={d}
                role="gridcell"
                className={cx('lv-cal__cell', sel && 'is-sel', sel && !prevIn && 'is-start', sel && !nextIn && 'is-end')}
                aria-selected={sel}
              >
                <button
                  type="button"
                  ref={(el) => {
                    if (el) buttons.current.set(d, el);
                    else buttons.current.delete(d);
                  }}
                  className={cx('lv-cal__day', d === today && 'is-today', marked && 'has-data')}
                  aria-label={name}
                  aria-current={d === today ? 'date' : undefined}
                  disabled={!usable}
                  tabIndex={d === tabDate ? 0 : -1}
                  onClick={() => onPick(d)}
                  onFocus={() => setFocusDate(d)}
                  onKeyDown={(e) => onKeyDown(e, d)}
                >
                  <span className="lv-cal__num lm-num">{Number(d.slice(8, 10))}</span>
                </button>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

interface Tile {
  id: string;
  text: string;
  name: string;
  selected: boolean;
  current: boolean;
  disabled: boolean;
}

/** A 3-column grid of months or years: the selected one the gold tile, the current one in gold. */
function TileGrid({ label, tiles, onPick }: { label: string; tiles: readonly Tile[]; onPick: (id: string) => void }) {
  return (
    <div role="group" aria-label={label} className="lv-cal__tiles">
      {tiles.map((t) => (
        <button
          key={t.id}
          type="button"
          className={cx('lv-cal__tile', t.selected && 'is-sel', t.current && 'is-today')}
          aria-label={t.name}
          aria-pressed={t.selected}
          aria-current={t.current ? 'date' : undefined}
          disabled={t.disabled}
          onClick={() => onPick(t.id)}
        >
          <span className="lm-num">{t.text}</span>
        </button>
      ))}
    </div>
  );
}
