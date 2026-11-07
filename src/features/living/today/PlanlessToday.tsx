/**
 * Today without a plan (0.6.3; Planning mode): Today is home in every mode, so without a running plan it shows what the
 * app already knows about the day, from the person's server and the activities, and the one way to a plan.
 *
 *   header      "Today" · the long date (no plan day) · the one ⋯ (global items on phones)
 *   main        No plan running (Find a plan · Simulate one) · last night's sleep
 *               (the Ring overview's Sleep card) · the day's steps (its Activity card: fused, against the goal)
 *   side        the ring glance (Day score, heart rate with Measure, the first monitored signals) · Activity (the energy
 *               note, Heart Points this week, today's activities) · short videos
 *
 * Every ring card is the Ring section's own component and opens its page there. Where they would be, one quiet line
 * says why there are none (the server can't be reached, the device isn't connected, Gauge hasn't sent anything). Phones:
 * one column in that order; ≥ 1024: the two columns. Quiet mode: the shared cards drop their numbers as they do on the
 * Ring section; this file adds only words.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { livingPaths } from '../paths';
import { CalendarDays } from 'lucide-react';
import { CardHead, GradientCard, KeyLink, Page, useMediaQuery, MQ } from '@/components';
import { TopBar } from '@/app/shell';
import { useQuietMode, useEnergyUnit } from '@/state/settingsStore';
import type { LocalDate } from '@/living';
import { addDays } from '@/living/dates';
import type { ReviewRow } from '@/living/activityCandidates';
import { MoveFromGauge, RingTodayNote, useRingTodayState } from '@/features/ring';
import { clockHourOf, useLivingClock } from '../clock';
import { useLiving } from '../data/source';
import { TODAY_COPY } from '../copy';
import { fmtLongDay, weekOf } from '../format';
import { useActivityData } from '../activity/data';
import { ActivitySheet } from '../activity/ActivitySheet';
import { todayCardRegistry } from './cards/registry';
import { useTodayCards } from './cards/useTodayCards';
import { TodayCards } from './cards/TodayCards';
import type { TodayCardCtx } from './cards/types';
import { useRecordActivity } from './useRecordActivity';
import { LogActivitySheet } from './components/LogActivitySheet';
import { DateControl } from '../components/DateControl';
import { dayPeriod } from '../period';

/** The words of Today without a plan (no digits: they read the same in quiet mode). */
export const PLANLESS_COPY = {
  noPlan: 'No plan running',
  noPlanBody: 'Find a plan that fits your goals, or try one in the simulator first.',
  findPlan: 'Find a plan',
  simulate: 'Simulate a plan',
} as const;

export function PlanlessToday({ today, date = today }: { today: LocalDate; date?: LocalDate }) {
  const navigate = useNavigate();
  const isToday = date === today;
  const clock = useLivingClock();
  const lg = useMediaQuery(MQ.lg);
  const quiet = useQuietMode().on;
  const ring = useRingTodayState();
  const activity = useActivityData();
  const activityView = activity.useToday(date, isToday);
  // the activity model over the week so far (Heart Points count Monday on; (r070) activities are counted automatically)
  const monday = weekOf(date)[0]!;
  const reviewFrom = monday < addDays(date, -6) ? monday : addDays(date, -6);
  const review = activity.useReview(reviewFrom, date);
  const [editing, setEditing] = useState<ReviewRow | null>(null);

  const eu = useEnergyUnit();
  const trend = useLiving((s) => s.trend(addDays(date, -13), date), [date]);
  const cards = useTodayCards(todayCardRegistry, date <= today);
  const recorder = useRecordActivity({ isToday, recent: review.decided.map((r) => r.exerciseId) });
  const [logging, setLogging] = useState(false);
  const ctx: TodayCardCtx = {
    date,
    today,
    isToday,
    plan: null,
    planless: true,
    state: date > today ? 'future' : date < today ? 'past' : 'active',
    view: null,
    trend,
    review,
    rows: [],
    nowH: isToday ? clockHourOf(clock) : null,
    nowMs: clock.now().getTime(),
    quiet,
    lg,
    eu,
    ring,
    activityView,
    openActivity: setEditing,
    record: { can: recorder.can, open: recorder.open },
    log: { can: date <= today, open: () => setLogging(true) },
  };
  const hero = (
    <GradientCard
      as="section"
      domain="plan"
      size="hero"
      className="lv-noplan"
      aria-label={PLANLESS_COPY.noPlan}
      head={
        <CardHead
          icon={CalendarDays}
          title={PLANLESS_COPY.noPlan}
          info={{ body: PLANLESS_COPY.noPlanBody }}
        />
      }
    >
      <p className="lv-noplan__body">{PLANLESS_COPY.noPlanBody}</p>
      <div className="lv-noplan__keys">
        <KeyLink to="/plan" variant="primary" arrow>
          {PLANLESS_COPY.findPlan}
        </KeyLink>
        <KeyLink to="/simulate" variant="text">
          {PLANLESS_COPY.simulate}
        </KeyLink>
      </div>
    </GradientCard>
  );
  return (
    <>
      <TopBar
        title={TODAY_COPY.title}
        subtitle={fmtLongDay(date)}
        menu={[
          ...(date <= today ? [{ id: 'edit-cards', label: cards.editing ? 'Done editing cards' : 'Edit cards', onSelect: cards.toggleEditing }] : []),
          {
            id: 'record-activity',
            label: 'Record an activity',
            onSelect: recorder.open,
            disabled: !recorder.can,
          },
          {
            id: 'log-activity',
            label: 'Log an activity',
            disabled: date > today,
            onSelect: () => setLogging(true),
          },
        ]}
      />
      <Page className="lv-today" data-plan="none">
        <MoveFromGauge />
        <DateControl
          value={dayPeriod(date)}
          today={today}
          onChange={(p) => navigate(p.from === today ? livingPaths.today() : livingPaths.today(p.from))}
        />
        <TodayCards ctx={ctx} cards={cards} hero={hero} />
        <RingTodayNote state={ring} />
      </Page>
      {recorder.sheet}
      {logging ? (
        <LogActivitySheet date={date} today={today} quiet={quiet} onClose={() => setLogging(false)} />
      ) : null}
      <ActivitySheet
        row={editing}
        onClose={() => setEditing(null)}
        quiet={quiet}
        recent={[...new Set(review.decided.map((r) => r.exerciseId))]}
        planned={[]}
      />
    </>
  );
}
