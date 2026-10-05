/**
 * Columns per day (week, month) or per month (year) in the performance hue (ring-pages.md §7.5.3, geometry of §7.3.4):
 * week ticks are the weekday letter over the date, month ticks the dates 1, 8, 15, 22, 29 plus the selected date, year
 * ticks the month with coverage numerals ("21/31") under each column. The goal is a 1 px ink line labelled
 * "goal 8 000"; a slot with no record is a missing stub; a future slot draws nothing; tap or Enter on a slot drills down
 * (day for a date, month for a year slot). Used for steps per day, active minutes per day, steps per month and
 * workouts per month. Table twin: the slot, its value ("no data" when missing), and coverage for year.
 */
import { useRef, type ReactNode } from 'react';
import { useElementWidth } from '@/features/charts/core/hooks';
import { fmtDay, fmtMonth } from '@/features/living/format';
import { weekdayOf } from '@/living/dates';
import type { LocalDate } from '@/living';
import { CHART_DRILL_HELP, ChartShell, MissingStub, TwinTable, lineLabelSpot, useSlotCrosshair, type ChartStatus, type MarkBox } from './kit';
import { columnPath, columnScale, compactTick } from './activityModels';
import { ACTIVITY_COPY as C } from './copyActivity';
import './activity.css';

export interface ColumnSlot {
  /** The slot's first date (a day; for year the month's first date). */
  start: LocalDate;
  /** null = no record (missing stub). */
  value: number | null;
  /** After today: nothing drawn, not listed in the table. */
  future: boolean;
  /** Year: coverage numerals under the column ("21/31"). */
  coverage?: string;
  /** Crosshair readout / table override (e.g. "October 2026 · average 7 210 steps on 21 of 31 days"). */
  readout?: string;
}

export interface DayColumnsProps {
  /** Engraved title ("steps per day"). */
  title: string;
  period: 'week' | 'month' | 'year';
  slots: readonly ColumnSlot[];
  /** The anchor date: month ticks add it, the crosshair starts there. */
  selected: LocalDate;
  goal?: number;
  height: number;
  header?: ReactNode;
  summary: string;
  emptyLine?: string | null;
  /** Text of a value ("7 420 steps", "34 min"). */
  valueText: (v: number) => string;
  /** Table head: [slot, value] or [slot, value, coverage]. */
  tableHead: readonly string[];
  /** Ceiling when nothing is recorded (the frame and axes stay). */
  emptyMax: number;
  /** Tap or Enter on a past slot. */
  onDrill?: (slot: ColumnSlot) => void;
  status?: ChartStatus;
  stale?: boolean;
}

const LETTER = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;
const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;
const dayNum = (d: LocalDate) => Number(d.slice(8, 10));
const monthIdx = (d: LocalDate) => Number(d.slice(5, 7)) - 1;

/** "Tue 30 Sep" for a day slot, "October 2026" for a month slot. */
export function slotName(period: DayColumnsProps['period'], start: LocalDate): string {
  return period === 'year' ? `${fmtMonth(start)} ${start.slice(0, 4)}` : fmtDay(start);
}

export function DayColumns({
  title,
  period,
  slots,
  selected,
  goal,
  height,
  header,
  summary,
  emptyLine,
  valueText,
  tableHead,
  emptyMax,
  onDrill,
  status = 'ready',
  stale,
}: DayColumnsProps) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref, 320) || 320;
  const tickCol = width < 480 ? 26 : 32;
  const padL = tickCol,
    padR = 4,
    padT = 14;
  const padB = period === 'month' ? 18 : 30;
  const plotW = Math.max(slots.length * 4, width - padL - padR);
  const slot = plotW / Math.max(1, slots.length);
  const bw = Math.min(24, slot * 0.72);
  const base = height - padB;
  const known = slots.filter((s) => !s.future && s.value !== null).map((s) => s.value!);
  const g = goal !== undefined && goal > 0 ? goal : undefined;
  const { max, ticks } = columnScale(Math.max(0, ...known), g, 3, emptyMax);
  const Y = (v: number) => padT + (1 - v / max) * (base - padT);
  const xOf = (i: number) => padL + i * slot;
  // the goal label takes the first spot beside its line that no column covers (J6-06); about 6 px per 11 px character
  const goalText = g !== undefined ? C.goalTick(g) : '';
  const columns: MarkBox[] = slots.flatMap((s, i) => {
    if (s.future || s.value === null || s.value <= 0) return [];
    const x0 = xOf(i) + (slot - bw) / 2;
    return [{ x0, x1: x0 + bw, top: Math.min(base - 1, Y(s.value)), bottom: base }];
  });
  const goalSpot = g !== undefined ? lineLabelSpot(Y(g), { left: padL, right: width - padR, top: padT, bottom: base }, columns, goalText.length * 6 + 6) : null;
  const selIdx = slots.findIndex(
    (s, i) => selected >= s.start && selected < (slots[i + 1]?.start ?? '9999-12-31'),
  );
  const lastPast = slots.reduce((n, s, i) => (s.future ? n : i), 0);
  const cross = useSlotCrosshair(slots.length, selIdx >= 0 && !slots[selIdx]!.future ? selIdx : lastPast);
  const slotAt = (x: number) => Math.floor((x - padL) / slot);

  const lineOf = (s: ColumnSlot): string =>
    s.readout ?? `${slotName(period, s.start)} · ${s.value === null ? C.noData : valueText(s.value)}`;
  const sel = cross.slot !== null ? slots[cross.slot] : undefined;
  const readout = sel ? (sel.future ? slotName(period, sel.start) : lineOf(sel)) : null;
  const drill = (i: number) => {
    const s = slots[i];
    if (s && !s.future && onDrill) onDrill(s);
  };

  // month ticks: 1, 8, 15, 22, 29 and the selected date (neighbours of the selected date step aside)
  const monthTicks = new Set<number>();
  if (period === 'month') {
    const selDay = selIdx >= 0 ? selIdx : -1;
    for (const i of [0, 7, 14, 21, 28])
      if (i < slots.length && (selDay < 0 || Math.abs(i - selDay) > 2 || i === selDay)) monthTicks.add(i);
    if (selDay >= 0) monthTicks.add(selDay);
  }
  const monthLabel = (i: number) =>
    slot >= 34 ? MONTH_SHORT[monthIdx(slots[i]!.start)] : MONTH_SHORT[monthIdx(slots[i]!.start)]!.charAt(0);

  const table = (
    <TwinTable
      caption={title}
      head={tableHead}
      rows={slots
        .filter((s) => !s.future)
        .map((s) => {
          const row: ReactNode[] = [
            slotName(period, s.start),
            s.value === null ? C.noData : valueText(s.value),
          ];
          if (tableHead.length > 2) row.push(s.coverage ?? '');
          return row;
        })}
    />
  );

  return (
    <div ref={ref} className="ac-chart">
      <ChartShell
        title={title}
        header={header}
        summary={summary}
        readout={readout}
        height={height + 18}
        status={status}
        stale={stale}
        emptyLine={emptyLine}
        table={table}
      >
        <p className="ac-xline" aria-hidden="true">
          {readout ?? '\u00a0'}
        </p>
        <div
          className="ac-plotarea"
          role="img"
          aria-label={summary}
          aria-description={CHART_DRILL_HELP}
          tabIndex={0}
          onKeyDown={(e) => cross.onKeyDown(e, drill)}
          onFocus={cross.onFocus}
          onBlur={cross.onBlur}
          onPointerDown={cross.onPointerDown}
          onPointerMove={(e) => cross.onPointerMove(e, slotAt)}
          onPointerUp={(e) => cross.onPointerUp(e, slotAt, drill)}
          onPointerLeave={cross.onPointerLeave}
        >
          <svg
            className="sg-svg"
            data-period={period}
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            aria-hidden="true"
            focusable="false"
          >
            {ticks.map((v) => (
              <g key={v}>
                <line
                  className="sg-grid"
                  x1={padL}
                  x2={width - padR}
                  y1={Math.round(Y(v)) + 0.5}
                  y2={Math.round(Y(v)) + 0.5}
                />
                <text className="sg-tick" x={padL - 4} y={Y(v) + 4} textAnchor="end">
                  {compactTick(v)}
                </text>
              </g>
            ))}
            {slots.map((s, i) => {
              if (s.future) return null;
              const x = xOf(i) + (slot - bw) / 2;
              if (s.value === null)
                return <MissingStub key={s.start} x={x} width={bw} baseline={base} label={lineOf(s)} />;
              if (s.value <= 0) return null;
              const top = Math.min(base - 1, Y(s.value));
              return (
                <path key={s.start} className="ac-col" data-slot={s.start} d={columnPath(x, top, bw, base)}>
                  <title>{lineOf(s)}</title>
                </path>
              );
            })}
            <line className="sg-axis" x1={padL} x2={width - padR} y1={base + 0.5} y2={base + 0.5} />
            {g !== undefined && goalSpot ? (
              <g className="ac-goal" data-goal={g}>
                <line
                  className="sg-goal"
                  x1={padL}
                  x2={width - padR}
                  y1={Math.round(Y(g)) + 0.5}
                  y2={Math.round(Y(g)) + 0.5}
                />
                <text className="sg-goal-label" x={goalSpot.x} y={goalSpot.y} textAnchor={goalSpot.anchor}>
                  {goalText}
                </text>
              </g>
            ) : null}
            {slots.map((s, i) => {
              const cx = xOf(i) + slot / 2;
              const isSel = i === selIdx && period !== 'year';
              if (period === 'week') {
                return (
                  <g key={s.start} className="ac-xtick" data-selected={isSel || undefined}>
                    <text className="sg-tick" x={cx} y={base + 13} textAnchor="middle">
                      {LETTER[weekdayOf(s.start)]}
                    </text>
                    <text className="sg-tick" x={cx} y={base + 26} textAnchor="middle">
                      {dayNum(s.start)}
                    </text>
                  </g>
                );
              }
              if (period === 'month') {
                return monthTicks.has(i) ? (
                  <text
                    key={s.start}
                    className="sg-tick ac-xtick"
                    data-selected={isSel || undefined}
                    x={cx}
                    y={base + 13}
                    textAnchor="middle"
                  >
                    {dayNum(s.start)}
                  </text>
                ) : null;
              }
              return (
                <g key={s.start} className="ac-xtick">
                  <text className="sg-tick" x={cx} y={base + 13} textAnchor="middle">
                    {monthLabel(i)}
                  </text>
                  {s.coverage && !s.future ? (
                    <text
                      className="sg-tick ac-cov"
                      data-coverage={s.coverage}
                      x={cx}
                      y={base + 26}
                      textAnchor="middle"
                    >
                      {s.coverage}
                    </text>
                  ) : null}
                </g>
              );
            })}
            {cross.slot !== null ? (
              <line
                className="sg-crosshair"
                x1={xOf(cross.slot) + slot / 2}
                x2={xOf(cross.slot) + slot / 2}
                y1={padT - 6}
                y2={base}
              />
            ) : null}
          </svg>
        </div>
      </ChartShell>
    </div>
  );
}
