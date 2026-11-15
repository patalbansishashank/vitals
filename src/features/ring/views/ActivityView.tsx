/** Activity › Movement on one day: the day's steps, the 30 days up to it, and the day's activities that count. */
import { useState } from 'react';
import { Link } from 'react-router';
import { Activity, Bike, ChevronLeft, ChevronRight, Dumbbell, Footprints, Waves } from 'lucide-react';
import {
  CardFoot,
  CardHead,
  ChartTwin,
  GradientCard,
  HighlightBars,
  Icon,
  Key,
  MonoMeta,
  Stack,
  barsTwin,
  clockText,
  formatEnergy,
  formatNumber,
} from '@/components';
import { activityName } from '@/features/living/activity/model';
import { fmtDateRange, fmtDay } from '@/features/living/format';
import type { LocalDate } from '@/living';
import { daysBetween } from '@/living/dates';
import { useEnergyUnit, useQuietMode } from '@/state/settingsStore';
import { wallIso, type RingActivity } from '../activities';
import { useRingActivities } from '../useActivities';
import { RING_COPY as C } from '../copy';
import { useActivity } from '../data';
import { useRingDay } from '../day';
import { clockOf, shiftDate } from '../model';
import { ringPaths } from '../paths';
import { partOfDay } from '../quiet';
import { ActivityLane, ActivityLegend } from '@/features/living/activity/ActivityLane';
import { STEPS_DAY_WORDS } from '@/features/living/activity/StepsDayChart';
import { useStepsDay } from '../stepsDay';
import { WhenReady, useUnitPrefs } from '../components/parts';
import { useNow } from '../useGauge';
import { StepsHistoryCard, kSteps } from './StepsHistoryCard';
import { movementFacts, movementInfo, workoutsInfo } from './activityInfo';
import './activity.css';
import { MovementBody, stepsUpdatedCaption } from './Movement';

export function ActivityView({ date, today }: { date: string; today: string }) {
  const dayQ = useActivity(date, date);
  const day = useRingDay(date);
  const prefs = useUnitPrefs();
  const energyUnit = useEnergyUnit();
  const now = useNow();
  const quiet = useQuietMode().on;
  const stepsDay = useStepsDay(date);
  const updated = stepsUpdatedCaption(
    date === today ? stepsDay.updatedAt : null,
    dayQ.data?.days[0]?.lastUpdate ?? null,
    quiet,
    now,
  );
  const chart = {
    name: 'Steps through the day',
    dates: stepsDay.bins.map((b) => clockText(b.start)),
    values: stepsDay.bins.map((b) => b.steps),
    unit: 'steps',
    format: kSteps,
    highlight:
      date === today ? stepsDay.bins.findIndex((b) => b.start <= now && b.start + 15 * 60_000 > now) : -1,
  };
  const from = stepsDay.bins[0]?.start ?? 0;
  const to = from + stepsDay.bins.length * 15 * 60_000;
  const twin = !quiet && stepsDay.ready ? <ChartTwin data={barsTwin(chart)} /> : undefined;
  return (
    <Stack>
      <GradientCard
        as="section"
        domain="steps"
        head={
          <CardHead
            as="h2"
            icon={Footprints}
            title={C.movement}
            info={movementInfo(quiet, undefined, twin, movementFacts(day, prefs.units, energyUnit))}
          />
        }
      >
        <div className="rg-blocks">
          <WhenReady q={day.q}>{() => <MovementBody date={date} day={day} updated={updated} />}</WhenReady>
          {stepsDay.ready ? (
            quiet ? (
              <p className="rg-none">{STEPS_DAY_WORDS.quiet}</p>
            ) : (
              <div className="rga-daychart">
                {chart.values.some((v) => v !== null) ? (
                  <MonoMeta>
                    {formatNumber(Math.max(0, ...chart.values.map((v) => v ?? 0)), 0)} steps per 15 min
                  </MonoMeta>
                ) : (
                  <MonoMeta>No reading</MonoMeta>
                )}
                <HighlightBars
                  {...chart}
                  hue="steps"
                  height={120}
                  showAxis={false}
                  spoken={(i) =>
                    `${chart.dates[i]}, ${chart.values[i] === null ? 'no reading' : `${formatNumber(chart.values[i]!, 0)} steps`}`
                  }
                />
                <MonoMeta className="rga-timeaxis">
                  <span>00</span>
                  <span>12</span>
                  <span>24</span>
                </MonoMeta>
                <ActivityLane marks={stepsDay.marks} from={from} to={to} />
                <ActivityLegend marks={stepsDay.marks} quiet={false} />
              </div>
            )
          ) : (
            <WhenReady q={dayQ}>{() => <p className="rg-none">{C.noActivity}</p>}</WhenReady>
          )}
        </div>
      </GradientCard>
      <StepsHistoryCard from={shiftDate(date, -29)} end={date} />
      <ActivitiesCard key={date} from={date} end={date} />
    </Stack>
  );
}

/** Days per page of the activity list, once a selection is too long for one page. */
export const ACTIVITY_PAGE_DAYS = 30;

/** The longest selection the list shows whole: a calendar month, so no month leaves its first day on a page of its own. */
export const ACTIVITY_WHOLE_DAYS = 31;

/** (r068 A04) Rows shown before "Show all". */
export const ACTIVITY_ROWS_SHOWN = 6;

/** (r068 A03) The activity's name without its catalogue alternative ("Jogging / running" → "Jogging"). */
function shortName(exerciseId: string): string {
  return activityName(exerciseId).split(' / ')[0]!;
}

/**
 * (0.6.3 S25/A14) The activities that count from `from` to `end`, out of the canonical collection (approved and edited
 * device bouts, Health Connect sessions, the person's own logs); the Gauge session behind one opens its detail. The
 * list covers what the date control selects: a day lists that day, a week or a month lists all of it. Anything longer
 * is read a page of 30 days at a time, newest first, with Earlier / Later inside it, so a year is never asked for at
 * once. (r068 A04) The first rows, then "Show all". Key the card by its span: a new selection starts on its newest page.
 */
export function ActivitiesCard({ from, end }: { from: string; end: string }) {
  const [until, setUntil] = useState(end);
  const [all, setAll] = useState(false);
  const whole = daysBetween(from as LocalDate, end as LocalDate) + 1 <= ACTIVITY_WHOLE_DAYS;
  const firstOfPage = shiftDate(until, -(ACTIVITY_PAGE_DAYS - 1));
  const pageFrom = !whole && firstOfPage > from ? firstOfPage : from;
  const acts = useRingActivities(pageFrom, until);
  const quiet = useQuietMode().on;
  const n = acts.approved.length;
  const oneDay = from === end;
  const earlier = pageFrom > from;
  const later = until < end;
  const page = (to: string) => {
    setUntil(to);
    setAll(false);
  };
  const shown = all ? acts.approved : acts.approved.slice(0, ACTIVITY_ROWS_SHOWN);
  const showAll = n > shown.length ? { label: C.showAll(n), onClick: () => setAll(true) } : undefined;
  const none = quiet ? C.noActivitiesQuiet : oneDay ? C.dayNoActivities : pageFrom === firstOfPage ? C.noActivities : C.periodNoActivities;
  return (
    <GradientCard
      as="section"
      domain="steps"
      head={<CardHead as="h2" icon={Dumbbell} title={C.workouts} info={workoutsInfo} />}
      foot={
        // the date control above names a single day: the foot repeats only a span; an empty list says so in its one line
        <CardFoot
          state={quiet || n === 0 ? undefined : { word: C.countedCount(n) }}
          right={oneDay ? undefined : fmtDateRange(pageFrom as LocalDate, until as LocalDate)}
          link={earlier || later ? undefined : showAll}
        >
          {earlier || later ? (
            // (r068 A04) one bank of keys at the list's foot, all the same key: the earlier 30 days, the rest of
            // these (while some are folded away) and the later 30 days
            <div className="rga-pages" role="group" aria-label={C.workoutsPages}>
              {earlier ? (
                <Key variant="text" size="sm" icon={ChevronLeft} onClick={() => page(shiftDate(pageFrom, -1))}>
                  {C.earlier}
                </Key>
              ) : null}
              {showAll ? (
                <Key variant="text" size="sm" onClick={showAll.onClick}>
                  {showAll.label}
                </Key>
              ) : null}
              {later ? (
                <Key
                  variant="text"
                  size="sm"
                  trailingIcon={ChevronRight}
                  onClick={() => page(shiftDate(until, ACTIVITY_PAGE_DAYS) > end ? end : shiftDate(until, ACTIVITY_PAGE_DAYS))}
                >
                  {C.later}
                </Key>
              ) : null}
            </div>
          ) : null}
        </CardFoot>
      }
    >
      <div className="rg-blocks">
        {n ? (
          <ul className="rg-rows">
            {shown.map((a) => (
              <ActivityRow key={a.id} a={a} tz={acts.tz} />
            ))}
          </ul>
        ) : (
          <p className="rg-none">{none}</p>
        )}
      </div>
    </GradientCard>
  );
}

export function ActivityRow({ a, tz }: { a: RingActivity; tz: string }) {
  const quiet = useQuietMode().on;
  const eu = useEnergyUnit();
  const name = a.exerciseId ? shortName(a.exerciseId) : C.activityWord;
  // (0.6.3 INT) quiet mode: the part of the day, never a clock time (dates stay, as on every date strip)
  const when = a.window
    ? `${fmtDay(a.date as LocalDate)} · ${quiet ? partOfDay(wallIso(a.window.start, tz)) : clockOf(wallIso(a.window.start, tz))}`
    : fmtDay(a.date as LocalDate);
  // (r068 A03) the source only when it is not the ring (nearly everything here is)
  const others = a.sources.filter((s) => s !== 'ring');
  const source = others.length ? (others.includes('healthConnect') ? 'Health Connect' : 'Logged') : null;
  const facts = [when, source].filter(Boolean).join(' · ');
  const body = (
    <>
      <span className="rga-activityrow__icon">
        <Icon
          icon={
            a.exerciseId?.includes('cycl')
              ? Bike
              : a.exerciseId?.includes('swim')
                ? Waves
                : a.exerciseId?.includes('walk') || a.exerciseId?.includes('run')
                  ? Footprints
                  : Activity
          }
          size={20}
        />
      </span>
      <span className="rg-row__main">
        <span className="rg-row__label">{name}</span>
        <MonoMeta>{facts}</MonoMeta>
      </span>
      {quiet ? (
        <span />
      ) : (
        <span className="rg-row__value">
          {a.durationMin !== null ? (
            <span className="rga-activityrow__duration">
              {formatNumber(a.durationMin, 0)}
              <span className="lm-unit">min</span>
            </span>
          ) : null}
          {a.grossKcal !== null ? (
            <MonoMeta>
              {formatEnergy(a.grossKcal, eu, { withUnit: false })} {eu}
              {a.status === 'pending' ? ` ${C.estimatedWord}` : ''}
            </MonoMeta>
          ) : null}
        </span>
      )}
    </>
  );
  const gaugeId = a.gaugeIds[0];
  return (
    <li>
      {gaugeId ? (
        <Link
          className="rg-row rga-activityrow"
          to={ringPaths.workout(gaugeId, a.date, a.status === 'approved' ? a.id : undefined)}
        >
          {body}
          <Icon icon={ChevronRight} size={18} className="rg-row__chev" />
        </Link>
      ) : (
        <div className="rg-row rga-activityrow">
          {body}
          <span />
        </div>
      )}
    </li>
  );
}
