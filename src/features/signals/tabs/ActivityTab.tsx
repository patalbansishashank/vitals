/**
 * Body signals › Activity (ring-pages.md §7.5; faceplate order §6.5–6.8):
 *   day         goal meters → steps by hour → workouts that day → numbers
 *   week, month steps per day → active minutes per day → workouts list → numbers
 *   year        steps per month → workouts per month → numbers
 * Data: resolved days (`useDays`), step samples for the hour columns and heart-rate samples for workouts (`useSeries`),
 * goals from Plan (`useSignalsPerson().goals`; never invented), effort zones from age (`zoneModel`). Missing is never
 * zero; averages use recorded days only and say so; the future draws nothing; every period header states coverage.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Engraved, Faceplate, Key, Readout } from '@/components';
import { useLivingClock } from '@/features/living/clock';
import { livingPaths } from '@/features/living/paths';
import { fmtDay, fmtMonth } from '@/features/living/format';
import { addDays } from '@/living/dates';
import type { LocalDate } from '@/living';
import { useDays, useSeries, useSignalsPerson, type SignalsPerson } from '../data';
import { coverageText, daysUpTo, periodLabel } from '../models';
import { TwinTable, useChartSizes } from '../charts/kit';
import { GoalMeter } from '../charts/GoalMeter';
import { HourBars } from '../charts/HourBars';
import { DayColumns, slotName, type ColumnSlot } from '../charts/DayColumns';
import { WorkoutsList, WorkoutsPerMonth } from '../charts/WorkoutsList';
import { WorkoutSheet } from '../charts/WorkoutSheet';
import { zoneModel, type ZoneModel } from '../charts/zones';
import {
  activeMinOf,
  activityDays,
  goalCount,
  localDayBounds,
  monthlyActivity,
  recordedAverage,
  sleepBands,
  stepsByHour,
  workoutItems,
  type WorkoutItem,
} from '../charts/activityModels';
import { ACTIVITY_COPY as C, withUnit } from '../charts/copyActivity';
import '../charts/activity.css';
import type { TabProps } from './types';

const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const LOG_HREF = livingPaths.train(undefined, 'session');

export function ActivityTab(props: TabProps) {
  const person = useSignalsPerson();
  const zones = useMemo(() => zoneModel(person), [person]);
  const { window: w } = props;
  if (w.kind === 'day') return <DayView {...props} person={person} zones={zones} />;
  if (w.kind === 'year') return <YearView {...props} person={person} />;
  return <SpanView {...props} person={person} zones={zones} />;
}

interface ViewProps extends TabProps {
  person: SignalsPerson;
}

/* ------------------------------------------------------------------------------------------------ day */

function DayView({ window: w, today, person, zones }: ViewProps & { zones: ZoneModel | null }) {
  const date = w.start;
  const clock = useLivingClock();
  const now = clock.now().getTime();
  const days = useDays(date, addDays(date, 1));
  const bounds = useMemo(() => localDayBounds(date), [date]);
  const { day, bands, workouts } = useMemo(() => {
    const thisDay = days.find((d) => d.localDate === date);
    const tonight = days.find((d) => d.localDate === addDays(date, 1));
    return {
      day: thisDay,
      // sleep that ended this morning and sleep that started tonight, clipped to the day
      bands: sleepBands([...(thisDay?.sleeps ?? []), ...(tonight?.sleeps ?? [])], bounds.start, bounds.end),
      workouts: workoutItems(thisDay ? [thisDay] : []),
    };
  }, [days, date, bounds]);
  const daily = day?.daily;
  const dates = useMemo(() => [date], [date]);
  const series = useSeries('steps', bounds.start, bounds.end - 1, dates);
  const hours = stepsByHour(series.points, date, now);
  const past = hours.filter((h) => !h.future);
  const recordedHours = past.filter((h) => h.steps !== null);
  const hourTotal = recordedHours.reduce((s, h) => s + h.steps!, 0);

  // the resolved daily value wins (a correction shows as corrected); the hour samples only fill a day with no total
  const steps = finite(daily?.steps) ?? (recordedHours.length ? hourTotal : null);
  const activeMin = activeMinOf(daily);
  const activeKcal = finite(daily?.active_kcal);
  const distanceM = finite(daily?.distance_m);
  const missing = date === today ? C.noDataToday : C.noDataDay;
  const goals = person.goals;
  const [open, setOpen] = useState<WorkoutItem | null>(null);

  const emptyLine =
    series.status === 'ready' && !recordedHours.length
      ? steps !== null
        ? C.noHourly
        : date === today
          ? C.noStepsToday
          : C.noStepsDay
      : null;

  return (
    <div className="ac-tab" data-period="day">
      <Faceplate className="ac-face" data-face="goals">
        <Engraved as="p" className="ac-face__title">
          {C.goals}
        </Engraved>
        <div className="ac-meters">
          <GoalMeter
            label={C.meter.steps}
            value={steps}
            goal={goals.steps}
            unit={C.unit.steps}
            missingText={missing}
          />
          <GoalMeter
            label={C.meter.activeMin}
            value={activeMin}
            goal={goals.activeMin}
            unit={C.unit.min}
            missingText={missing}
          />
          <GoalMeter
            label={C.meter.activeKcal}
            value={activeKcal}
            goal={goals.activeKcal}
            unit={C.unit.kcal}
            missingText={missing}
          />
        </div>
      </Faceplate>
      <Faceplate className="ac-face" data-face="hours">
        <HourBars
          hours={hours}
          bands={bands}
          header={<span>{C.dayLine(steps, distanceM, activeKcal)}</span>}
          summary={C.hourSummary(
            fmtDay(date),
            hourTotal,
            recordedHours.length,
            past.length - recordedHours.length,
          )}
          status={series.status}
          stale={series.stale}
          onRetry={series.retry}
          emptyLine={emptyLine}
        />
      </Faceplate>
      <Faceplate className="ac-face" data-face="workouts">
        <Engraved as="p" className="ac-face__title">
          {C.workouts}
        </Engraved>
        <WorkoutsList items={workouts} zones={zones} onOpen={setOpen} logHref={LOG_HREF} />
      </Faceplate>
      <Numbers
        items={[
          { id: 'steps', label: C.strip.steps, value: steps, unit: C.unit.steps },
          {
            id: 'distance',
            label: C.strip.distance,
            value: distanceM !== null ? distanceM / 1000 : null,
            unit: C.unit.km,
            decimals: 1,
          },
          { id: 'active-kcal', label: C.strip.activeKcal, value: activeKcal, unit: C.unit.kcal },
          { id: 'active-min', label: C.strip.activeMin, value: activeMin, unit: C.unit.min },
          { id: 'workouts', label: C.strip.workouts, value: day ? workouts.length : null },
        ]}
      />
      <WorkoutSheet
        item={open}
        onClose={() => setOpen(null)}
        zones={zones}
        restingBpm={finite(daily?.resting_hr_bpm) ?? undefined}
      />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ week, month */

function SpanView({ window: w, today, onDrill, person, zones }: ViewProps & { zones: ZoneModel | null }) {
  const sizes = useChartSizes();
  const period = w.kind === 'month' ? 'month' : 'week';
  const days = useDays(w.start, w.last);
  const adays = useMemo(() => activityDays(days, w.slots), [days, w.slots]);
  const pastDays = adays.filter((d) => !d.future);
  const elapsed = daysUpTo(w, today);
  const goals = person.goals;
  const range = periodLabel('activity', w, today);
  const [open, setOpen] = useState<WorkoutItem | null>(null);
  const workouts = useMemo(() => workoutItems(days), [days]);

  const steps = recordedAverage(pastDays.map((d) => d.steps));
  const active = recordedAverage(pastDays.map((d) => d.activeMin));
  const kcal = recordedAverage(pastDays.map((d) => d.activeKcal));
  const dist = recordedAverage(pastDays.map((d) => d.distanceM));
  const stepsGoal = goalCount(adays, (d) => d.steps, goals.steps, today);
  const activeGoal = goalCount(adays, (d) => d.activeMin, goals.activeMin, today);
  const stepsAvgText =
    steps.avg !== null ? C.avgOnRecorded(withUnit(Math.round(steps.avg), C.unit.steps), steps.n) : null;
  const activeAvgText =
    active.avg !== null ? C.avgOnRecorded(withUnit(Math.round(active.avg), C.unit.min), active.n) : null;
  const drill = (s: ColumnSlot) => onDrill('day', s.start);
  const restingOf = (date: LocalDate) =>
    finite(days.find((d) => d.localDate === date)?.daily?.resting_hr_bpm) ?? undefined;

  return (
    <div className="ac-tab" data-period={period}>
      <Faceplate className="ac-face" data-face="steps">
        <DayColumns
          title={C.stepsPerDay}
          period={period}
          slots={adays.map((d) => ({ start: d.date, value: d.steps, future: d.future }))}
          selected={w.anchor}
          goal={goals.steps}
          height={sizes.main}
          header={
            <HeadLine
              parts={[
                stepsAvgText ?? C.noData,
                goals.steps ? C.atGoal(stepsGoal.at, stepsGoal.recorded, stepsGoal.elapsed) : null,
                coverageText(steps.n, elapsed, 'days'),
              ]}
            />
          }
          summary={C.columnsSummary(C.stepsPerDay, range, steps.n, elapsed, stepsAvgText)}
          emptyLine={steps.n === 0 ? C.emptySteps(period) : null}
          valueText={(v) => withUnit(v, C.unit.steps)}
          tableHead={[C.dayCols.date, C.dayCols.steps]}
          emptyMax={10_000}
          onDrill={drill}
        />
      </Faceplate>
      <div className="ac-pair">
        <Faceplate className="ac-face" data-face="active">
          <DayColumns
            title={C.activeMinPerDay}
            period={period}
            slots={adays.map((d) => ({ start: d.date, value: d.activeMin, future: d.future }))}
            selected={w.anchor}
            goal={goals.activeMin}
            height={sizes.secondary}
            header={
              <HeadLine
                parts={[
                  activeAvgText ?? C.noData,
                  goals.activeMin ? C.atGoal(activeGoal.at, activeGoal.recorded, activeGoal.elapsed) : null,
                  coverageText(active.n, elapsed, 'days'),
                ]}
              />
            }
            summary={C.columnsSummary(C.activeMinPerDay, range, active.n, elapsed, activeAvgText)}
            emptyLine={active.n === 0 ? C.emptyActiveMin(period) : null}
            valueText={(v) => withUnit(v, C.unit.min)}
            tableHead={[C.dayCols.date, C.dayCols.activeMin]}
            emptyMax={60}
            onDrill={drill}
          />
        </Faceplate>
        <Faceplate className="ac-face" data-face="workouts">
          <Engraved as="p" className="ac-face__title">
            {C.workouts}
          </Engraved>
          <WorkoutsList items={workouts} zones={zones} onOpen={setOpen} logHref={LOG_HREF} />
        </Faceplate>
      </div>
      <Numbers
        caption={steps.n ? C.onRecordedDays(steps.n) : undefined}
        items={[
          { id: 'steps', label: C.stripAvg.steps, value: round(steps.avg), unit: C.unit.steps },
          {
            id: 'distance',
            label: C.stripAvg.distance,
            value: dist.avg !== null ? dist.avg / 1000 : null,
            unit: C.unit.km,
            decimals: 1,
          },
          { id: 'active-kcal', label: C.stripAvg.activeKcal, value: round(kcal.avg), unit: C.unit.kcal },
          { id: 'active-min', label: C.stripAvg.activeMin, value: round(active.avg), unit: C.unit.min },
          { id: 'workouts', label: C.stripAvg.workouts, value: days.length ? workouts.length : null },
        ]}
        table={{
          caption: C.numbers,
          head: [
            C.dayCols.date,
            C.dayCols.steps,
            C.dayCols.activeMin,
            C.dayCols.activeKcal,
            C.dayCols.distance,
            C.dayCols.workouts,
          ],
          rows: pastDays.map((d) => [
            fmtDay(d.date),
            d.steps === null ? C.noData : withUnit(d.steps, C.unit.steps),
            d.activeMin === null ? C.noData : withUnit(d.activeMin, C.unit.min),
            d.activeKcal === null ? C.noData : withUnit(d.activeKcal, C.unit.kcal),
            d.distanceM === null ? C.noData : withUnit(d.distanceM / 1000, C.unit.km, 1),
            d.any ? String(d.workouts) : C.noData,
          ]),
        }}
      />
      <WorkoutSheet
        item={open}
        onClose={() => setOpen(null)}
        zones={zones}
        restingBpm={open ? restingOf(open.date) : undefined}
      />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ year */

function YearView({ window: w, today, onDrill, person }: ViewProps) {
  const sizes = useChartSizes();
  const days = useDays(w.start, w.last);
  const months = useMemo(() => monthlyActivity(days, w.slots, today), [days, w.slots, today]);
  const pastDays = useMemo(() => days.filter((d) => d.localDate <= today), [days, today]);
  const elapsed = daysUpTo(w, today);
  const goals = person.goals;
  const steps = recordedAverage(pastDays.map((d) => finite(d.daily?.steps)));
  const active = recordedAverage(pastDays.map((d) => activeMinOf(d.daily)));
  const kcal = recordedAverage(pastDays.map((d) => finite(d.daily?.active_kcal)));
  const dist = recordedAverage(pastDays.map((d) => finite(d.daily?.distance_m)));
  const workoutsTotal = pastDays.reduce((n, d) => n + d.workouts.length, 0);
  const stepsAvgText =
    steps.avg !== null ? C.avgOnRecorded(withUnit(Math.round(steps.avg), C.unit.steps), steps.n) : null;
  const monthName = (start: LocalDate) => `${fmtMonth(start)} ${start.slice(0, 4)}`;

  const slots: ColumnSlot[] = months.map((m) => ({
    start: m.start,
    value: m.future ? null : m.avgSteps !== null ? Math.round(m.avgSteps) : null,
    future: m.future,
    coverage: m.future ? undefined : C.coverageNumerals(m.recorded, m.days),
    readout: C.monthReadout(
      monthName(m.start),
      m.avgSteps !== null ? withUnit(Math.round(m.avgSteps), C.unit.steps) : null,
      m.recorded,
      m.days,
    ),
  }));

  return (
    <div className="ac-tab" data-period="year">
      <Faceplate className="ac-face" data-face="steps">
        <DayColumns
          title={C.stepsPerMonth}
          period="year"
          slots={slots}
          selected={w.anchor}
          goal={goals.steps}
          height={sizes.main}
          header={<HeadLine parts={[stepsAvgText ?? C.noData, coverageText(steps.n, elapsed, 'days')]} />}
          summary={C.columnsSummary(
            C.stepsPerMonth,
            periodLabel('activity', w, today),
            steps.n,
            elapsed,
            stepsAvgText,
          )}
          emptyLine={steps.n === 0 ? C.emptySteps('year') : null}
          valueText={(v) => withUnit(v, C.unit.steps)}
          tableHead={[C.monthCols.month, C.monthCols.avgSteps, C.monthCols.recorded]}
          emptyMax={10_000}
          onDrill={(s) => onDrill('month', s.start)}
        />
      </Faceplate>
      <Faceplate className="ac-face" data-face="workouts">
        <WorkoutsPerMonth
          months={months}
          selected={w.anchor}
          height={sizes.secondary}
          onDrill={(start) => onDrill('month', start)}
        />
      </Faceplate>
      <Numbers
        caption={steps.n ? C.onRecordedDays(steps.n) : undefined}
        items={[
          { id: 'steps', label: C.stripAvg.steps, value: round(steps.avg), unit: C.unit.steps },
          {
            id: 'distance',
            label: C.stripAvg.distance,
            value: dist.avg !== null ? dist.avg / 1000 : null,
            unit: C.unit.km,
            decimals: 1,
          },
          { id: 'active-kcal', label: C.stripAvg.activeKcal, value: round(kcal.avg), unit: C.unit.kcal },
          { id: 'active-min', label: C.stripAvg.activeMin, value: round(active.avg), unit: C.unit.min },
          { id: 'workouts', label: C.stripAvg.workouts, value: pastDays.length ? workoutsTotal : null },
        ]}
        table={{
          caption: C.numbers,
          head: [
            C.monthCols.month,
            C.monthCols.recorded,
            C.monthCols.avgSteps,
            C.monthCols.avgActiveMin,
            C.monthCols.workouts,
          ],
          rows: months
            .filter((m) => !m.future)
            .map((m) => [
              slotName('year', m.start),
              C.coverageNumerals(m.recorded, m.days),
              m.avgSteps === null ? C.noData : withUnit(Math.round(m.avgSteps), C.unit.steps),
              m.avgActiveMin === null ? C.noData : withUnit(Math.round(m.avgActiveMin), C.unit.min),
              m.workouts === null ? C.noData : String(m.workouts),
            ]),
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ shared */

const round = (v: number | null): number | null => (v === null ? null : Math.round(v));

function HeadLine({ parts }: { parts: ReadonlyArray<string | null> }) {
  const shown = parts.filter((p): p is string => Boolean(p));
  return (
    <span className="ac-head">
      {shown.map((p, i) => (
        <span key={p}>
          {i ? ' · ' : ''}
          {p}
        </span>
      ))}
    </span>
  );
}

interface NumberItem {
  id: string;
  label: string;
  value: number | null;
  unit?: string;
  decimals?: number;
}

/** The numbers faceplate (§6.2): readouts 2 / 4 / one row per width, and a table of every slot behind the "table" key. */
function Numbers({
  items,
  caption,
  table,
}: {
  items: readonly NumberItem[];
  caption?: string;
  table?: { caption: string; head: readonly string[]; rows: ReadonlyArray<ReadonlyArray<ReactNode>> };
}) {
  const [show, setShow] = useState(false);
  return (
    <Faceplate className="ac-face" data-face="numbers" aria-label={C.numbersLabel}>
      <div className="ac-face__headrow">
        <Engraved as="p" className="ac-face__title">
          {C.numbers}
        </Engraved>
        {caption ? <span className="ac-face__caption">{caption}</span> : null}
      </div>
      <div className="ac-strip">
        {items.map((it) => (
          <div key={it.id} className="ac-strip__item" data-item={it.id}>
            <Readout
              size="sm"
              label={it.label}
              value={it.value}
              unit={it.unit}
              decimals={it.decimals ?? 0}
              unknownCaption={C.noData}
            />
          </div>
        ))}
      </div>
      {table && table.rows.length ? (
        <>
          <div className="sg-chart__tablebar">
            <Key size="sm" variant="quiet" aria-expanded={show} onClick={() => setShow((v) => !v)}>
              {show ? C.hideTable : C.table}
            </Key>
          </div>
          {show ? <TwinTable caption={table.caption} head={table.head} rows={table.rows} /> : null}
        </>
      ) : null}
    </Faceplate>
  );
}
