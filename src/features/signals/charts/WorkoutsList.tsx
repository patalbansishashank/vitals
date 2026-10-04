/**
 * Workouts list (ring-pages.md §7.5.4): rows grouped by day under an engraved day header ("Tue 30 Sep"); each row the
 * type word, start time, duration, average heart rate, distance if any, a 64 px time-in-zones mini bar and where it came
 * from ("from your ring" / "logged by hand"). A row opens the workout sheet. Empty: "No workouts in this period." and
 * **Log an activity** (Train's log). Year: workouts per month as columns (`WorkoutsPerMonth`).
 *
 * Heart-rate samples for the mini bars are read once per day group (one `bio.series` read per day that has workouts,
 * only when effort zones are known), never per row and never for the whole period (raw reads are capped).
 */
import { useId, useMemo } from 'react';
import { Engraved, KeyLink } from '@/components';
import { fmtDay } from '@/features/living/format';
import type { LocalDate } from '@/living';
import { useSeries } from '../data';
import { clockAt } from './ringData';
import { workoutTypeWord } from './copy';
import { ZoneBar } from './ZoneBar';
import type { ZoneModel } from './zones';
import { DayColumns, type ColumnSlot } from './DayColumns';
import {
  datesTouched,
  groupByDay,
  workoutZoneMinutes,
  type MonthActivity,
  type WorkoutItem,
} from './activityModels';
import { ACTIVITY_COPY as C, fmtDuration, withUnit } from './copyActivity';
import './activity.css';

export interface WorkoutsListProps {
  items: readonly WorkoutItem[];
  /** null: no age set (no zones, no mini bars, no heart-rate read for them). */
  zones: ZoneModel | null;
  onOpen: (w: WorkoutItem) => void;
  /** Train's log ("Log an activity"). */
  logHref: string;
}

export function WorkoutsList({ items, zones, onOpen, logHref }: WorkoutsListProps) {
  const groups = useMemo(() => groupByDay(items), [items]);
  if (!groups.length) {
    return (
      <div className="ac-wempty">
        <p>{C.noWorkouts}</p>
        <KeyLink to={logHref} size="sm">
          {C.logActivity}
        </KeyLink>
      </div>
    );
  }
  return (
    <div className="ac-wlist">
      {groups.map((g) => (
        <DayGroup key={g.date} date={g.date} items={g.items} zones={zones} onOpen={onOpen} />
      ))}
    </div>
  );
}

function DayGroup({
  date,
  items,
  zones,
  onOpen,
}: {
  date: LocalDate;
  items: readonly WorkoutItem[];
  zones: ZoneModel | null;
  onOpen: (w: WorkoutItem) => void;
}) {
  const from = Math.min(...items.map((w) => w.start));
  const to = Math.max(...items.map((w) => w.end));
  const dates = useMemo(() => datesTouched(from, to), [from, to]);
  // one read for the whole day group, only when zones can be drawn
  const hr = useSeries('hr', zones ? from : null, zones ? to : null, zones ? dates : []);
  const headId = useId();
  return (
    <section className="ac-wday" aria-labelledby={headId}>
      <Engraved as="p" className="ac-wday__head" id={headId}>
        {fmtDay(date)}
      </Engraved>
      <ul className="ac-wrows">
        {items.map((w) => {
          const minutes = hr.status === 'ready' && !hr.stale ? workoutZoneMinutes(hr.points, w, zones) : null;
          return (
            <li key={w.id}>
              <WorkoutRow w={w} minutes={minutes} onOpen={onOpen} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function WorkoutRow({
  w,
  minutes,
  onOpen,
}: {
  w: WorkoutItem;
  minutes: number[] | null;
  onOpen: (w: WorkoutItem) => void;
}) {
  const type = workoutTypeWord(w.type);
  const at = clockAt(w.start, w.offsetS);
  const duration = fmtDuration(w.durationS);
  const extra = [
    w.avgHr !== null ? `average ${C.avgBpm(w.avgHr)}` : null,
    w.distanceM !== null ? withUnit(w.distanceM / 1000, 'km', 2) : null,
    C.source[w.source],
  ].filter((x): x is string => x !== null);
  const showZones = minutes !== null && minutes.slice(1).some((m) => m > 0);
  return (
    <button
      type="button"
      className="ac-wrow"
      data-workout={w.id}
      aria-label={C.workoutRowName(type, at, duration, extra)}
      onClick={() => onOpen(w)}
    >
      <span className="ac-wrow__main">
        <span className="ac-wrow__type">{type}</span>
        <span className="ac-wrow__meta lm-num">
          <span>{at}</span>
          <span>{duration}</span>
          {w.avgHr !== null ? <span>{C.avgBpm(w.avgHr)}</span> : null}
          {w.distanceM !== null ? <span>{withUnit(w.distanceM / 1000, 'km', 2)}</span> : null}
        </span>
      </span>
      <span className="ac-wrow__side">
        {showZones ? (
          <span className="ac-wrow__zones" data-minutes={minutes!.join(',')} aria-hidden="true">
            <ZoneBar mini minutes={minutes!} />
          </span>
        ) : null}
        <span className="ac-wrow__src">{C.source[w.source]}</span>
      </span>
    </button>
  );
}

/** Year: workouts per month as columns (a month with no record at all is missing, not zero). */
export function WorkoutsPerMonth({
  months,
  selected,
  height,
  onDrill,
}: {
  months: readonly MonthActivity[];
  selected: LocalDate;
  height: number;
  onDrill: (monthStart: LocalDate) => void;
}) {
  const slots: ColumnSlot[] = months.map((m) => ({
    start: m.start,
    value: m.future ? null : m.workouts,
    future: m.future,
  }));
  const past = months.filter((m) => !m.future);
  const total = past.reduce((n, m) => n + (m.workouts ?? 0), 0);
  const recorded = past.filter((m) => m.workouts !== null).length;
  const empty = !past.some((m) => (m.workouts ?? 0) > 0);
  return (
    <DayColumns
      title={C.workoutsPerMonth}
      period="year"
      slots={slots}
      selected={selected}
      height={height}
      header={<span>{C.workoutCount(total)}</span>}
      summary={C.columnsSummary(
        C.workoutsPerMonth,
        selected.slice(0, 4),
        recorded,
        past.length,
        C.workoutCount(total),
      )}
      emptyLine={empty ? C.emptyWorkoutsYear : null}
      valueText={(v) => C.workoutCount(v)}
      tableHead={[C.monthCols.month, C.monthCols.workouts]}
      emptyMax={4}
      onDrill={(s) => onDrill(s.start)}
    />
  );
}
