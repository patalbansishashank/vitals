/**
 * Progress › Log (living-mode.md §8.2 item 6): a month calendar — a dot per logged day, a dial glyph when the day was
 * scored — and the day list with each entry's source. Tapping a day opens it on Today (backfill). A day edited on two
 * devices shows the "edited on two devices" row with two resolve keys. Gaps read "not logged", never "failed".
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Chip, Faceplate, Section } from '@/components';
import { AdherenceDial } from '@/features/charts/living/AdherenceDial';
import { addDays, compareDates } from '@/living/dates';
import type { LocalDate } from '@/living';
import type { ActivePlan } from '../../activePlan';
import { SourceChip, sourceLabel } from '../../components/Estimate';
import { LogConflict } from '../../components/LogConflict';
import type { HistoryDay } from '../../data/types';
import { useLiving } from '../../data/source';
import { dayOfMonth, fmtDay, quietWord, weekdayKey } from '../../format';
import { dialItemsOf } from '../../model/adherence';
import { livingPaths } from '../../paths';
import { MonthNav } from '../components/MonthNav';
import { PROGRESS_COPY as C } from '../copy';
import { monthDates, monthLead, monthOf } from '../model';

const WEEK = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'] as const;

export interface LogSectionProps {
  plan: ActivePlan | null;
  today: LocalDate;
  quiet: boolean;
}

export function LogSection({ plan, today, quiet }: LogSectionProps) {
  if (!plan) {
    return (
      <Faceplate id="log" title={C.faces.log} className="lv-prog-face">
        <p className="lv-prog-state">{C.noPlanLog}</p>
      </Faceplate>
    );
  }
  return <PlanLog plan={plan} today={today} quiet={quiet} />;
}

function dayText(d: HistoryDay | undefined, quiet: boolean): string {
  if (!d) return C.notLogged;
  if (d.score?.score !== null && d.score?.score !== undefined) {
    const n = quiet ? quietWord(d.score.score) : String(Math.round(d.score.score));
    return `${C.scoredWord} ${n}${d.final ? '' : ` · ${C.soFar}`}`;
  }
  return d.entries.length ? C.logged : C.notLogged;
}

function PlanLog({ plan, today, quiet }: { plan: ActivePlan; today: LocalDate; quiet: boolean }) {
  const lastDay = compareDates(addDays(plan.plannedEndDate, -1), today) < 0 ? addDays(plan.plannedEndDate, -1) : today;
  const firstMonth = monthOf(plan.startDate);
  const lastMonth = monthOf(lastDay);
  const [month, setMonth] = useState(lastMonth);
  const dates = useMemo(() => monthDates(month), [month]);
  const from = dates[0]!;
  const to = dates[dates.length - 1]!;
  const history = useLiving((s) => s.history(from, to), [from, to]);
  const byDate = useMemo(() => new Map(history.map((d) => [d.date, d] as const)), [history]);
  const lead = monthLead(month);
  const inRange = (d: LocalDate) => compareDates(d, plan.startDate) >= 0 && compareDates(d, lastDay) <= 0;

  return (
    <Faceplate id="log" title={C.faces.log} className="lv-prog-face">
      <Section label={C.logCalendar}>
        <MonthNav month={month} first={firstMonth} last={lastMonth} onMonth={setMonth} />
        <table className="lv-prog-cal">
          <caption className="lm-sr">{C.logCalendar}</caption>
          <thead>
            <tr>
              {WEEK.map((d) => (
                <th key={d} scope="col" className="lm-eng">
                  {weekdayKey(d)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
          {Array.from({ length: Math.ceil((lead + dates.length) / 7) }, (_, w) => (
            <tr key={w}>
              {Array.from({ length: 7 }, (_, c) => {
                const i = w * 7 + c - lead;
                const date = dates[i];
                if (!date) return <td key={c} className="lv-prog-cal__cell" data-empty="true" />;
                const day = byDate.get(date);
                const scored = day?.score?.score !== null && day?.score?.score !== undefined;
                const logged = !!day && (scored || day.entries.length > 0);
                const glyph = scored ? (
                  <AdherenceDial items={dialItemsOf(day!.score)} score={day!.score!.score} size="glyph" final={day!.final} />
                ) : logged ? (
                  <span className="lv-prog-cal__dot" aria-hidden="true" />
                ) : (
                  <span className="lv-prog-cal__none" aria-hidden="true" />
                );
                const label = `${fmtDay(date)}, ${dayText(day, quiet)}`;
                return (
                  <td key={c} className="lv-prog-cal__cell" data-today={date === today || undefined} data-paused={day?.paused || undefined} data-assumed={day?.assumed || undefined}>
                    {inRange(date) ? (
                      <Link to={livingPaths.today(date)} className="lv-prog-cal__key" aria-label={label}>
                        <span className="lv-prog-cal__num" aria-hidden="true">
                          {dayOfMonth(date)}
                        </span>
                        {glyph}
                      </Link>
                    ) : (
                      <span className="lv-prog-cal__key" data-outside="true">
                        <span className="lv-prog-cal__num">{dayOfMonth(date)}</span>
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
          </tbody>
        </table>
      </Section>

      <Section label={C.logList}>
        {history.length === 0 ? <p className="lv-prog-state">{C.emptyMonth}</p> : null}
        <ol className="lv-prog-days">
          {history.map((d) => (
            <li key={d.date} className="lv-prog-day">
              <div className="lv-prog-day__head">
                <Link to={livingPaths.today(d.date)} className="lv-prog-day__date" aria-label={C.openDay(fmtDay(d.date))}>
                  {fmtDay(d.date)}
                </Link>
                <span className="lv-prog-day__score">{dayText(d, quiet)}</span>
                {d.assumed ? <Chip className="lv-source is-assumed">{C.assumed}</Chip> : null}
                {d.paused ? <Chip>{C.paused}</Chip> : null}
              </div>
              {d.entries.length ? (
                <ul className="lv-prog-day__entries">
                  {d.entries.map((e) => (
                    <li key={e.id}>
                      <span>{e.label}</span> <SourceChip source={{ label: sourceLabel(e.source) }} />
                      {e.conflict ? <Chip>{e.conflict.versions.length} versions</Chip> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              {d.conflicts?.map((conflict) => <LogConflict key={conflict.parentId} conflict={conflict} quiet={quiet} />)}
            </li>
          ))}
        </ol>
      </Section>
    </Faceplate>
  );
}
