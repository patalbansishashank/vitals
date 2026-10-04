/**
 * Progress › Adherence (living-mode.md §8.2 item 3; CHART_SPEC §7.9; docs/SUITE_SPEC.md §3.7): the 7- and 28-day
 * readouts with "steady" or an arrow and the coverage line, the month calendar of dial glyphs (tap → that day), the
 * per-block bars with the costliest item named, and what the plan has learned. Never a streak. Quiet mode: words.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Engraved, Faceplate, Readout, Section } from '@/components';
import { AdherenceCalendar } from '@/features/charts/living/AdherenceCalendar';
import { BlockBars } from '@/features/charts/living/BlockBars';
import type { BlockBar, CalendarDay } from '@/features/charts/living/types';
import { addDays, compareDates } from '@/living/dates';
import type { LocalDate } from '@/living';
import type { ActivePlan } from '../../activePlan';
import { useLiving } from '../../data/source';
import { quietWord } from '../../format';
import { dialItemsOf } from '../../model/adherence';
import { livingPaths } from '../../paths';
import { MonthNav } from '../components/MonthNav';
import { PROGRESS_COPY as C } from '../copy';
import { monthDates, monthOf } from '../model';

export interface AdherenceSectionProps {
  plan: ActivePlan;
  today: LocalDate;
  quiet: boolean;
}

export function AdherenceSection({ plan, today, quiet }: AdherenceSectionProps) {
  const navigate = useNavigate();
  const summary = useLiving((s) => s.adherence(today), [today]);
  const lastDay = compareDates(addDays(plan.plannedEndDate, -1), today) < 0 ? addDays(plan.plannedEndDate, -1) : today;
  const firstMonth = monthOf(plan.startDate);
  const lastMonth = monthOf(lastDay);
  const [month, setMonth] = useState(lastMonth);
  const dates = useMemo(() => monthDates(month), [month]);
  const glances = useLiving((s) => s.days(dates), [dates]);
  const days = useMemo(
    () =>
      glances.map(
        (g): CalendarDay => ({
          date: g.date,
          inPlan: g.inPlan,
          score: g.score?.score ?? null,
          items: dialItemsOf(g.score),
          ...(g.assumed ? { assumed: true } : {}),
          ...(g.paused ? { paused: true } : {}),
          ...(g.score ? { final: g.score.final } : {}),
        }),
      ),
    [glances],
  );
  const bars = useMemo(() => summary.blocks.map((b): BlockBar => ({ id: b.type, label: b.label, mean: b.mean, n: b.n })), [summary.blocks]);
  const arrow = summary.arrow ? C.arrows[summary.arrow] : null;

  return (
    <Faceplate id="adherence" title={C.faces.adherence} caption={C.logged7(summary.daysLogged7)} className="lv-prog-face">
      <div className="lv-prog-adh__readouts">
        {quiet ? (
          <>
            <p className="lv-prog-word">
              <Engraved>{C.last7}</Engraved>
              <span>{quietWord(summary.a7)}</span>
              {arrow ? <span className="lv-prog-word__aside">{arrow}</span> : null}
            </p>
            <p className="lv-prog-word">
              <Engraved>{C.last28}</Engraved>
              <span>{quietWord(summary.a28)}</span>
              <span className="lv-prog-word__aside">{C.scored(summary.scored28)}</span>
            </p>
          </>
        ) : (
          <>
            <Readout label={C.last7} value={summary.a7} decimals={0} size="md" caption={arrow ?? undefined} unknownCaption={quietWord(null)} />
            <Readout label={C.last28} value={summary.a28} decimals={0} size="md" caption={C.scored(summary.scored28)} unknownCaption={quietWord(null)} />
          </>
        )}
      </div>

      <Section label={C.calendarTitle}>
        <MonthNav month={month} first={firstMonth} last={lastMonth} onMonth={setMonth} />
        <AdherenceCalendar month={month} days={days} today={today} quiet={quiet} caption={false} onSelect={(date) => navigate(livingPaths.today(date))} />
      </Section>

      <Section label={C.blocksCaption}>
        <BlockBars bars={bars} {...(summary.costliest ? { costliest: summary.costliest } : {})} quiet={quiet} />
      </Section>

      {summary.learned.length ? (
        <Section label={C.learnedTitle}>
          <ul className="lv-prog-list">
            {summary.learned.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Section>
      ) : null}
    </Faceplate>
  );
}
