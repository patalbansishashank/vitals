/**
 * Workout sheet (ring-pages.md §7.5.4): a bottom sheet on phones, a panel from the right on desktop (`ResponsivePanel`).
 * Title "Run · Tue 30 Sep · 18:05 – 18:43"; the readouts (duration, distance, average and highest heart rate, active
 * energy) two per row; heart rate during the workout as the zone-coloured line (x = minutes from the start); time in zones as the
 * labelled stacked bar; the source line; **Correct**. No map, no splits.
 *
 * Correct: the existing correction flow covers sleep, steps and weight only (no workout target), so the key opens
 * Settings › Devices, where the workout's source is managed.
 */
import { useId, useMemo } from 'react';
import { KeyLink, Readout, ResponsivePanel, type ReadoutStripItem } from '@/components';
import { paths } from '@/app/paths';
import { fmtDay } from '@/features/living/format';
import { useSeries } from '../data';
import { clockAt } from './ringData';
import { workoutTypeWord } from './copy';
import { ZoneLine } from './ZoneLine';
import { ZoneBar } from './ZoneBar';
import type { ZoneModel } from './zones';
import { useChartSizes } from './kit';
import { datesTouched, hrStats, samplesIn, workoutZoneMinutes, type WorkoutItem } from './activityModels';
import { ACTIVITY_COPY as C, fmtDuration } from './copyActivity';
import './activity.css';

export interface WorkoutSheetProps {
  /** null = closed. */
  item: WorkoutItem | null;
  onClose: () => void;
  zones: ZoneModel | null;
  /** The day's resting heart rate, if known (marked on the line). */
  restingBpm?: number;
}

export function workoutSheetTitle(w: WorkoutItem): string {
  return C.sheetTitle(
    workoutTypeWord(w.type),
    fmtDay(w.date),
    clockAt(w.start, w.offsetS),
    clockAt(w.end, w.offsetS),
  );
}

export function WorkoutSheet({ item, onClose, zones, restingBpm }: WorkoutSheetProps) {
  return (
    <ResponsivePanel
      open={item !== null}
      onClose={onClose}
      title={item ? workoutSheetTitle(item) : ''}
      defaultDetent="full"
      className="ac-sheet"
    >
      {item ? <SheetBody key={item.id} w={item} zones={zones} restingBpm={restingBpm} /> : null}
    </ResponsivePanel>
  );
}

function SheetBody({
  w,
  zones,
  restingBpm,
}: {
  w: WorkoutItem;
  zones: ZoneModel | null;
  restingBpm?: number;
}) {
  const sizes = useChartSizes();
  const hintId = useId();
  const dates = useMemo(() => datesTouched(w.start, w.end), [w.start, w.end]);
  const hr = useSeries('hr', w.start, w.end, dates);
  const inside = useMemo(() => samplesIn(hr.points, w.start, w.end), [hr.points, w.start, w.end]);
  const stats = hr.status === 'ready' ? hrStats(inside) : null;
  const avgHr = w.avgHr ?? stats?.avg ?? null;
  const maxHr = w.maxHr ?? stats?.max ?? null;
  const minutes = hr.status === 'ready' ? workoutZoneMinutes(inside, w, zones) : null;
  const R = C.sheetReadouts;
  const items: ReadoutStripItem[] = [
    { id: 'duration', label: R.duration, value: w.durationS, format: fmtDuration },
    {
      id: 'distance',
      label: R.distance,
      value: w.distanceM !== null ? w.distanceM / 1000 : null,
      decimals: 2,
      unit: C.unit.km,
      unknownCaption: C.notRecorded,
    },
    {
      id: 'avg-hr',
      label: R.avgHr,
      value: avgHr,
      decimals: 0,
      unit: C.unit.bpm,
      unknownCaption: C.notRecorded,
    },
    {
      id: 'max-hr',
      label: R.maxHr,
      value: maxHr,
      decimals: 0,
      unit: C.unit.bpm,
      unknownCaption: C.notRecorded,
    },
    {
      id: 'active-kcal',
      label: R.activeKcal,
      value: w.activeKcal,
      decimals: 0,
      unit: C.unit.kcal,
      unknownCaption: C.notRecorded,
    },
  ];
  return (
    <div className="ac-sheet__body">
      {/* the readout strip as a 2-column grid (§6.4: 2 per row on a phone; the desktop panel is phone-wide too) */}
      <div className="ac-strip" data-cols="2" role="group" aria-label={C.sheetStripLabel}>
        {items.map(({ id, ...it }) => (
          <div key={id} className="ac-strip__item" data-item={id}>
            <Readout size="sm" {...it} />
          </div>
        ))}
      </div>
      <div className="ac-sheet__hr" data-points={inside.length}>
        <ZoneLine
          points={inside}
          from={w.start}
          to={w.end}
          offsetS={w.offsetS}
          zones={zones}
          restingBpm={restingBpm}
          axis="minutes"
          height={sizes.secondary}
          title={C.hrDuring}
          status={hr.status}
          stale={hr.stale}
          onRetry={hr.retry}
          emptyLine={hr.status === 'ready' && !inside.length ? C.hrDuringEmpty : undefined}
        />
      </div>
      {minutes && minutes.slice(1).some((m) => m > 0) ? (
        <div className="ac-sheet__zones" data-minutes={minutes.join(',')}>
          <ZoneBar minutes={minutes} />
        </div>
      ) : null}
      <p className="ac-sheet__source">{C.sourceLine(w.source)}</p>
      <div className="ac-sheet__correct">
        <KeyLink to={paths.settings('devices')} size="sm" variant="quiet" aria-describedby={hintId}>
          {C.correct}
        </KeyLink>
        <span id={hintId} className="ac-sheet__hint">
          {C.correctWhere}
        </span>
      </div>
    </div>
  );
}
