/** Ring › Activity: the day, its 30 days, and the activities that count. */
import { useState } from 'react';
import { Link } from 'react-router';
import { Activity, Bike, ChevronLeft, ChevronRight, Dumbbell, Flame, Footprints, Waves } from 'lucide-react';
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
import { fmtDay } from '@/features/living/format';
import type { LocalDate } from '@/living';
import { useEnergyUnit, useQuietMode } from '@/state/settingsStore';
import { wallIso, type RingActivity } from '../activities';
import { useRingActivities } from '../useActivities';
import { RING_COPY as C } from '../copy';
import { useActivity } from '../data';
import { useRingDay } from '../day';
import { clockOf, shiftDate } from '../model';
import { energyPath, ringPaths } from '../paths';
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

// ---------------------------------------------------------------------------------------------------------------

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
      <EnergyBurnedLink date={date} />
      <ActivitiesCard key={date} date={date} />
    </Stack>
  );
}

export function EnergyBurnedLink({ date, query }: { date: string; query?: string }) {
  return (
    <GradientCard
      as="section"
      domain="energy"
      size="slim"
      head={
        <CardHead
          as="h2"
          icon={Flame}
          title="Energy burned"
          info={{
            title: 'Energy burned',
            body: 'The Energy page shows your estimated total burned and the components the model uses, with daily history and a date selector. Its total can differ from the ring’s own energy estimate.',
            source: { kind: 'estimate', words: 'Vitals energy model' },
          }}
        />
      }
      foot={
        <CardFoot
          link={{ to: query ? `${energyPath()}?${query}` : energyPath(date), label: 'View energy' }}
        />
      }
    />
  );
}

/** Days per page of the activity history. */
export const ACTIVITY_PAGE_DAYS = 30;

/** (r068 A04) Rows shown before "Show all". */
export const ACTIVITY_ROWS_SHOWN = 6;

/** (r068 A03) The activity's name without its catalogue alternative ("Jogging / running" → "Jogging"). */
function shortName(exerciseId: string): string {
  return activityName(exerciseId).split(' / ')[0]!;
}

/**
 * (0.6.3 S25/A14) The activities that count, from the canonical collection (approved and edited device bouts, Health
 * Connect sessions, the person's own logs), a page of 30 days at a time with Earlier / Later; the Gauge session behind
 * one opens its detail. (r068 A04) The first rows, then "Show all".
 */
export function ActivitiesCard({ date }: { date: string }) {
  // the page starts at the selected day (the card is keyed by it)
  const [until, setUntil] = useState(date);
  const [all, setAll] = useState(false);
  const from = shiftDate(until, -(ACTIVITY_PAGE_DAYS - 1));
  const acts = useRingActivities(from, until);
  const quiet = useQuietMode().on;
  const n = acts.approved.length;
  const latest = until >= date;
  const page = (to: string) => {
    setUntil(to);
    setAll(false);
  };
  const span = `${fmtDay(from as LocalDate)} to ${fmtDay(until as LocalDate)}`;
  const shown = all ? acts.approved : acts.approved.slice(0, ACTIVITY_ROWS_SHOWN);
  // (r068 A04) one bank of keys at the list's foot, all the same outlined key: the earlier 30 days, the rest of these
  // (while some are folded away) and the later 30 days (only when there are later days to show)
  return (
    <GradientCard
      as="section"
      domain="steps"
      head={<CardHead as="h2" icon={Dumbbell} title={C.workouts} info={workoutsInfo} />}
      foot={
        <CardFoot state={quiet ? undefined : { word: C.countedCount(n) }} right={span}>
          {' '}
          <div className="rga-pages" role="group" aria-label={C.workoutsPages}>
            <Key
              variant="text"
              size="sm"
              icon={ChevronLeft}
              onClick={() => page(shiftDate(until, -ACTIVITY_PAGE_DAYS))}
            >
              {C.earlier}
            </Key>
            {n > shown.length ? (
              <Key variant="text" size="sm" onClick={() => setAll(true)}>
                {C.showAll(n)}
              </Key>
            ) : null}
            {latest ? null : (
              <Key
                variant="text"
                size="sm"
                trailingIcon={ChevronRight}
                onClick={() =>
                  page(
                    shiftDate(until, ACTIVITY_PAGE_DAYS) > date ? date : shiftDate(until, ACTIVITY_PAGE_DAYS),
                  )
                }
              >
                {C.later}
              </Key>
            )}
          </div>
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
          <p className="rg-none">{quiet ? C.noActivitiesQuiet : C.noActivities}</p>
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
