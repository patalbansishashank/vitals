/**
 * Progress › Log (living-mode.md §8.2 items 3 and 6): the month calendar — a dial glyph on scored days, a dot on days
 * logged but not scored, a hollow ring on past days with nothing logged — and under it the selected day only: its score
 * or state, what was logged, and one row that opens it on Today (backfill). Tapping a day in the calendar selects it;
 * the month opens on today (or its last day in the plan). "Logged" means the same here and in the Adherence card: any
 * log, mark or weigh-in that day. A day edited on two devices shows a "Changed on two devices · Review" key that opens
 * the sheet to resolve it.
 */
import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { CalendarDays, ChevronRight } from 'lucide-react';
import { CardFoot, Key, MonoMeta } from '@/components';
import { ProgressCard } from '../components/ProgressCard';
import { topicHref } from '@/features/evidence/links';
import { AdherenceDial } from '@/features/charts/living/AdherenceDial';
import { AdherenceCalendar } from '@/features/charts/living/AdherenceCalendar';
import type { CalendarDay } from '@/features/charts/living/types';
import { addDays, compareDates } from '@/living/dates';
import type { LocalDate } from '@/living';
import type { ActivePlan } from '../../activePlan';
import { ConflictSheet } from '../../components/LogConflict';
import { TODAY_COPY } from '../../copy';
import type { DayGlance, HistoryDay } from '../../data/types';
import { useLiving } from '../../data/source';
import { fmtDay, fmtMonth, quietWord } from '../../format';
import { dialItemsOf } from '../../model/adherence';
import { livingPaths } from '../../paths';
import { MonthNav } from '../components/MonthNav';
import { PROGRESS_COPY as C } from '../copy';
import { monthDates, monthOf } from '../model';

export interface LogSectionProps {
  plan: ActivePlan;
  today: LocalDate;
  quiet: boolean;
}

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The day a month opens on: the last day shown (today, or the plan's last day) in its month, else the month's last day. */
export function defaultLogDay(month: string, lastDay: LocalDate): LocalDate {
  if (monthOf(lastDay) === month) return lastDay;
  const dates = monthDates(month);
  return compareDates(`${month}-01`, lastDay) > 0 ? dates[0]! : dates[dates.length - 1]!;
}

/** What the selected day says at the end of its row: its score ("54 %", "… · so far"), or its state. */
export function logDayStatus(
  glance: DayGlance,
  day: HistoryDay | undefined,
  today: LocalDate,
  quiet: boolean,
): string {
  if (glance.paused) return C.paused;
  if (glance.assumed || day?.assumed) return C.assumed;
  const score = day?.score ?? glance.score;
  const s = score?.score;
  if (s !== null && s !== undefined && Number.isFinite(s)) {
    const n = quiet ? sentence(quietWord(s)) : C.percent(Math.round(s));
    const final = day ? day.final : (score?.final ?? true);
    return final ? n : `${n} · ${C.soFar}`;
  }
  if (compareDates(glance.date, today) > 0) return C.comingUp;
  return glance.logged || (day?.entries.length ?? 0) > 0 ? C.logged : C.notLogged;
}

export function LogSection({ plan, today, quiet }: LogSectionProps) {
  const lastDay =
    compareDates(addDays(plan.plannedEndDate, -1), today) < 0 ? addDays(plan.plannedEndDate, -1) : today;
  const firstMonth = monthOf(plan.startDate);
  const lastMonth = monthOf(lastDay);
  const [month, setMonth] = useState(lastMonth);
  const [picked, setPicked] = useState<LocalDate | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const dates = useMemo(() => monthDates(month), [month]);
  const selected = picked && monthOf(picked) === month ? picked : defaultLogDay(month, lastDay);
  const glances = useLiving((s) => s.days(dates), [dates]);
  const history = useLiving((s) => s.history(selected, selected), [selected]);
  const days = useMemo(
    () =>
      glances.map((g): CalendarDay => ({
        date: g.date,
        inPlan: g.inPlan && compareDates(g.date, lastDay) <= 0,
        score: g.score?.score ?? null,
        items: dialItemsOf(g.score),
        ...(g.logged ? { logged: true } : {}),
        ...(g.assumed ? { assumed: true } : {}),
        ...(g.paused ? { paused: true } : {}),
        ...(g.score ? { final: g.score.final } : {}),
      })),
    [glances, lastDay],
  );
  const glance = glances.find((g) => g.date === selected);
  const day = history.find((d) => d.date === selected);
  const entries = day?.entries.length ? sentence(day.entries.map((e) => e.label).join(' · ')) : null;
  const status = glance?.inPlan ? logDayStatus(glance, day, today, quiet) : null;
  const weighed = useLiving((s) => (s.trend(selected, selected)?.weighIns.length ?? 0) > 0, [selected]);
  const detail = quiet
    ? day?.entries.length
      ? 'Logged'
      : weighed
        ? C.weighInOnly
        : null
    : (entries ?? (weighed ? C.weighInOnly : null));
  const detailId = useId();
  const monthName = `${fmtMonth(month)} ${month.slice(0, 4)}`;

  const onMonth = (m: string) => {
    setMonth(m);
    setPicked(null);
  };

  return (
    <ProgressCard
      id="log"
      title={C.faces.log}
      icon={CalendarDays}
      domain="plan"
      info={{
        title: 'Reading the log',
        body: "Each circle shows how much of that day's plan you completed: the brighter, the more. A small dot means something was logged but not scored; a hollow ring, nothing logged; a dashed ring was filled in as planned; a struck-through day was paused. Tap a day to select it, then open that day.",
        source: { kind: 'logged' },
        range: 'Completion over recorded items only; an unlogged day is unknown.',
        evidence: { to: topicHref('tracking-replanning'), label: 'Tracking and replanning' },
      }}
      foot={
        <CardFoot state={{ word: status ?? C.notLogged }} right={status !== null ? 'Open day' : undefined} />
      }
    >
      <MonthNav month={month} first={firstMonth} last={lastMonth} onMonth={onMonth} />
      {!quiet ? (
        <MonoMeta>
          {days.filter((d) => d.logged).length} of {days.filter((d) => d.inPlan).length} days logged
        </MonoMeta>
      ) : null}
      <AdherenceCalendar
        month={month}
        days={days}
        today={today}
        quiet={quiet}
        caption={false}
        label={C.calendarLabel(monthName)}
        selected={selected}
        onSelect={setPicked}
      />

      {/* the selected day only — the calendar already shows the month */}
      <div className="lv-prog-sel" aria-live="polite">
        {glance?.score ? (
          <AdherenceDial
            items={dialItemsOf(glance.score).map((item) => (quiet ? { ...item, detail: item.label } : item))}
            score={glance.score.score}
            final={day?.final ?? glance.score.final}
            size="sm"
            quietWord={quiet ? quietWord(glance.score.score) : undefined}
          />
        ) : null}
        {status !== null ? (
          <>
            <Link
              to={livingPaths.today(selected)}
              className="lv-prog-sel__open"
              aria-label={C.openDay(fmtDay(selected))}
              aria-describedby={detailId}
            >
              {/* r068 L27: the status beside the date; what was logged under it (or "Weigh-in only"), never an empty line */}
              <span className="lv-prog-sel__main">
                <span className="lv-prog-sel__line">
                  <span className="lv-prog-sel__date">{fmtDay(selected)}</span>
                  <span id={detailId} className="lv-prog-sel__status">
                    {status}
                    {detail ? <span className="lm-sr">{` · ${detail}`}</span> : null}
                  </span>
                </span>
                {detail ? (
                  <span className="lv-prog-sel__entries" aria-hidden="true">
                    {detail}
                  </span>
                ) : null}
              </span>
              <ChevronRight className="lv-prog-sel__chev" size={18} aria-hidden="true" />
            </Link>
            {day?.conflicts?.length ? (
              <Key
                size="sm"
                variant="text"
                className="lv-prog-sel__conflict"
                onClick={() => setReviewing(true)}
              >
                {`${TODAY_COPY.conflict.sheetTitle} · ${TODAY_COPY.conflict.review}`}
              </Key>
            ) : null}
          </>
        ) : null}
      </div>
      {/* the selected day's forks, read live so a resolved one leaves the sheet */}
      <ConflictSheet
        open={reviewing}
        onClose={() => setReviewing(false)}
        conflicts={(reviewing ? day?.conflicts : undefined) ?? []}
        quiet={quiet}
      />
    </ProgressCard>
  );
}
