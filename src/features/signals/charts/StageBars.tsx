/**
 * Stacked stage bars (design/screens/ring-pages.md §7.3.4) and their year mode (§7.3.6).
 *
 * week / month: one column per night (wake date), stacked bottom → top deep, light, REM, unknown (hatched); awake is
 * not sleep and is not stacked (readout and table only). A missing night is a dashed stub, a provisional night is at
 * 60 %, future nights draw nothing. y is hours asleep up to the next whole hour of max(longest, goal) × 1.1.
 * year: twelve monthly columns of the average asleep per recorded night, split by the stage shares of nights with stage
 * data, with "recorded/days" numerals under each column; tap or Enter on a column drills down (day / month).
 */
import { useRef } from 'react';
import { useElementWidth } from '@/features/charts/core/hooks';
import { fmtDay, fmtMonth } from '@/features/living/format';
import { weekdayOf } from '@/living/dates';
import type { LocalDate } from '@/living';
import { coverageText, type PeriodKind } from '../models';
import { RING_COPY } from './copy';
import { SLEEP_COPY as S, clockRange, durShort } from './copySleep';
import { ChartShell, HatchDefs, MissingStub, TwinTable, useChartSizes, useSlotCrosshair } from './kit';
import { useHatchId } from './NightStages';
import { clockAt } from './ringData';
import { STACK_STAGES, sharePercents, yCeiling, type MonthColumn, type NightColumn, type SleepNight, type SleepStats, type StageMinutes } from './sleepModels';
import './sleep.css';

const WD_LETTER = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;
const MONTH_LETTER = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'] as const;

/* ------------------------------------------------------------------------------------------------ shared axis */

export interface SlotTicksProps {
  kind: 'week' | 'month' | 'year';
  /** Slot keys (dates; month starts in year mode). */
  keys: readonly LocalDate[];
  anchor: LocalDate;
  xAt: (i: number) => number;
  /** Baseline of the first tick line. */
  y: number;
  /** Year: "21/31" under each month (null for future months). */
  coverage?: ReadonlyArray<string | null>;
}

/** x ticks: week "M / 29", month 1, 8, 15, 22, 29 plus the selected date, year month initials (+ coverage). */
export function SlotTicks({ kind, keys, anchor, xAt, y, coverage }: SlotTicksProps) {
  return (
    <g className="sl-ticks" aria-hidden="true">
      {keys.map((d, i) => {
        if (kind === 'week') {
          return (
            <g key={d}>
              <text className="sg-tick" x={xAt(i)} y={y} textAnchor="middle">
                {WD_LETTER[weekdayOf(d)]}
              </text>
              <text className="sg-tick" x={xAt(i)} y={y + 12} textAnchor="middle">
                {Number(d.slice(8, 10))}
              </text>
            </g>
          );
        }
        if (kind === 'month') {
          const n = Number(d.slice(8, 10));
          const regular = n % 7 === 1;
          const selected = d === anchor && !regular && ![-2, -1, 1, 2].some((k) => (n + k) % 7 === 1 && n + k >= 1);
          if (!regular && !selected) return null;
          return (
            <text key={d} className="sg-tick" data-selected={selected || d === anchor ? 'true' : undefined} x={xAt(i)} y={y} textAnchor="middle">
              {n}
            </text>
          );
        }
        return (
          <g key={d}>
            <text className="sg-tick" x={xAt(i)} y={y} textAnchor="middle">
              {MONTH_LETTER[Number(d.slice(5, 7)) - 1]}
            </text>
            {coverage?.[i] ? (
              <text className="sg-tick sl-cov" x={xAt(i)} y={y + 12} textAnchor="middle">
                {coverage[i]}
              </text>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

/* ------------------------------------------------------------------------------------------------ text */

const stageParts = (m: StageMinutes) => STACK_STAGES.map((k) => S.stageDur(RING_COPY.stage[k], durShort(m[k])));

/** "Night to Tue 30 Sep · 7 h 05 asleep · deep 1 h 10 · … · awake 25 min · in bed 23:52 – 07:22". */
export function nightReadout(date: LocalDate, n: SleepNight | null): string {
  const head = S.nightTo(fmtDay(date));
  if (!n) return `${head} · ${S.noData}`;
  // without classified stages only "unknown" is known; deep, light and REM are not 0, so they are left out
  const parts = [head, S.asleepDur(durShort(n.asleepMin)), ...(n.hasStages ? stageParts(n.stack) : [S.stageDur(RING_COPY.stage.unknown, durShort(n.stack.unknown))])];
  if (n.awakeMin !== null) parts.push(S.stageDur(RING_COPY.stage.awake, durShort(n.awakeMin)));
  if (n.bed !== null && n.wake !== null) parts.push(S.inBed(clockAt(n.bed, n.offsetS), clockAt(n.wake, n.offsetS)));
  if (n.provisional) parts.push(S.stillChanging);
  return parts.join(' · ');
}

const monthName = (start: LocalDate) => `${fmtMonth(start)} ${start.slice(0, 4)}`;

function monthReadout(m: MonthColumn): string {
  if (!m.recorded) return `${monthName(m.start)} · ${S.noData}`;
  const parts = [monthName(m.start), S.avgAsleepDur(durShort(m.avgAsleepMin!)), S.nightsOf(m.recorded, m.days)];
  if (m.stats.avgStageMin) parts.push(...stageParts(m.stats.avgStageMin));
  return parts.join(' · ');
}

/** Header readouts (§7.3.4): coverage, average asleep over recorded nights, stage shares over nights with stages. */
export function StatsHeader({ stats }: { stats: SleepStats }) {
  const pct = stats.shares ? sharePercents(stats.shares) : null;
  return (
    <span className="sl-head">
      <span>{coverageText(stats.recorded, stats.slots, 'nights')}</span>
      {stats.avgAsleepMin !== null ? <span>{S.avgAsleep(durShort(stats.avgAsleepMin), stats.recorded)}</span> : null}
      {pct ? (
        <span>{S.shares(STACK_STAGES.map((k) => S.share(RING_COPY.stage[k], pct[k])).join(' · '), stats.stagedNights)}</span>
      ) : stats.recorded ? (
        <span>{S.noStagesYet}</span>
      ) : null}
    </span>
  );
}

/* ------------------------------------------------------------------------------------------------ chart */

interface Col {
  key: LocalDate;
  future: boolean;
  missing: boolean;
  stack: StageMinutes | null;
  provisional: boolean;
  readout: string;
}

export interface StageBarsProps {
  kind: 'week' | 'month' | 'year';
  anchor: LocalDate;
  /** week / month. */
  nights?: readonly NightColumn[];
  /** year. */
  months?: readonly MonthColumn[];
  /** Sleep goal (hours) from Plan; absent = no line. */
  goalH?: number;
  stats: SleepStats;
  onDrill: (period: PeriodKind, date: LocalDate) => void;
}

/** Stack segments bottom → top (zero stages skipped), with a 2 px surface gap between segments; at least 1 px each. */
function stackGeometry(stack: StageMinutes, base: number, pxPerMin: number): Array<{ k: (typeof STACK_STAGES)[number]; y: number; h: number }> {
  const out: Array<{ k: (typeof STACK_STAGES)[number]; y: number; h: number }> = [];
  let yb = base;
  for (const k of STACK_STAGES) {
    if (!(stack[k] > 0)) continue;
    const top = yb - stack[k] * pxPerMin;
    const bottom = yb - (out.length ? 2 : 0);
    const h = Math.max(1, bottom - top);
    out.push({ k, y: bottom - h, h });
    yb = top;
  }
  return out;
}

/** A rect with only its top corners rounded. */
function topRounded(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

export function StageBars({ kind, anchor, nights = [], months = [], goalH, stats, onDrill }: StageBarsProps) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref, 320) || 320;
  const sizes = useChartSizes();
  const hatchId = useHatchId();
  const year = kind === 'year';

  const cols: Col[] = year
    ? months.map((m) => ({ key: m.start, future: m.future, missing: !m.future && !m.recorded, stack: m.stack, provisional: m.provisional, readout: monthReadout(m) }))
    : nights.map((c) => ({
        key: c.date, future: c.future, missing: !c.future && !c.night, stack: c.night?.stack ?? null, provisional: !!c.night?.provisional, readout: nightReadout(c.date, c.night),
      }));
  const longest = year ? Math.max(0, ...months.map((m) => m.avgAsleepMin ?? 0)) : Math.max(0, ...nights.map((c) => c.night?.asleepMin ?? 0));
  const { ceilingH, ticksH } = yCeiling(longest, goalH);

  const h = sizes.main;
  const padL = sizes.tickCol, padR = 8, padT = 14, padB = kind === 'month' ? 18 : 30;
  const plotW = Math.max(40, width - padL - padR), plotH = h - padT - padB;
  const base = padT + plotH;
  const Y = (min: number) => padT + plotH * (1 - min / (ceilingH * 60));
  const n = Math.max(1, cols.length);
  const slotW = plotW / n;
  const colW = Math.min(24, slotW * 0.72);
  const cx = (i: number) => padL + slotW * (i + 0.5);

  const past = cols.filter((c) => !c.future).length;
  const anchorIdx = cols.findIndex((c) => c.key === anchor || (year && c.key.slice(0, 7) === anchor.slice(0, 7)));
  const home = anchorIdx >= 0 && anchorIdx < past ? anchorIdx : Math.max(0, past - 1);
  const ch = useSlotCrosshair(past, home);
  const slotAt = (x: number) => Math.floor((x - padL) / slotW);
  const drill = (i: number) => {
    const c = cols[i];
    if (c && !c.future) onDrill(year ? 'month' : 'day', c.key);
  };
  const cur = ch.slot === null ? null : (cols[ch.slot] ?? null);

  const title = year ? S.title.barsYear : S.title.bars;
  const pct = stats.shares ? sharePercents(stats.shares) : null;
  const summary = [
    title,
    coverageText(stats.recorded, stats.slots, 'nights'),
    stats.avgAsleepMin !== null ? S.avgAsleep(durShort(stats.avgAsleepMin), stats.recorded) : S.empty[kind],
    pct ? S.shares(STACK_STAGES.map((k) => S.share(RING_COPY.stage[k], pct[k])).join(', '), stats.stagedNights) : null,
    goalH ? S.goal(goalH) : null,
  ]
    .filter(Boolean)
    .join('; ');

  const table = year ? (
    <TwinTable
      caption={S.tableYear}
      head={[S.col.month, S.col.nights, S.col.avgAsleep, S.col.deep, S.col.light, S.col.rem, S.col.unknown]}
      rows={months
        .filter((m) => !m.future)
        .map((m) => {
          const a = m.stats.avgStageMin;
          return [
            monthName(m.start),
            S.nightsOf(m.recorded, m.days),
            m.avgAsleepMin === null ? S.noData : durShort(m.avgAsleepMin),
            ...STACK_STAGES.map((k) => (a ? durShort(a[k]) : m.recorded ? S.noStagesYet : '')),
          ];
        })}
    />
  ) : (
    <TwinTable
      caption={S.tableBars}
      head={[S.col.date, S.col.asleep, S.col.deep, S.col.light, S.col.rem, S.col.unknown, S.col.awake, S.col.bed, S.col.up]}
      rows={nights.filter((c) => !c.future).map((c) => nightRow(c.date, c.night))}
    />
  );

  return (
    <div ref={ref} className="sl-bars">
      <ChartShell
        title={title}
        header={<StatsHeader stats={stats} />}
        summary={summary}
        readout={cur?.readout ?? null}
        height={h + 18}
        emptyLine={stats.recorded === 0 ? S.empty[kind] : null}
        table={table}
      >
        <p className="sl-readout" aria-hidden="true">
          {cur?.readout ?? ' '}
        </p>
        <div
          className="sl-plot"
          role="img"
          aria-label={summary}
          tabIndex={past ? 0 : undefined}
          onKeyDown={(e) => ch.onKeyDown(e, drill)}
          onFocus={past ? ch.onFocus : undefined}
          onBlur={ch.onBlur}
          onPointerDown={ch.onPointerDown}
          onPointerMove={(e) => ch.onPointerMove(e, slotAt)}
          onPointerUp={(e) => ch.onPointerUp(e, slotAt, drill)}
          onPointerLeave={ch.onPointerLeave}
        >
          <svg className="sg-svg sl-svg" width={width} height={h} viewBox={`0 0 ${width} ${h}`} aria-hidden="true" focusable="false">
            <HatchDefs id={hatchId} />
            {ticksH.map((t) => (
              <g key={t}>
                <line className={t === 0 ? 'sg-axis' : 'sg-grid'} x1={padL} x2={padL + plotW} y1={Y(t * 60)} y2={Y(t * 60)} />
                <text className="sg-tick" x={padL - 5} y={Y(t * 60) + 3.5} textAnchor="end">
                  {S.hours(t)}
                </text>
              </g>
            ))}
            {cols.map((c, i) => {
              if (c.future) return null;
              const x = cx(i) - colW / 2;
              if (c.missing || !c.stack) return <MissingStub key={c.key} x={x} width={colW} baseline={base} label={c.readout} />;
              const segs = stackGeometry(c.stack, base, plotH / (ceilingH * 60));
              return (
                <g key={c.key} className="sl-col" data-date={c.key} data-provisional={c.provisional ? 'true' : undefined} opacity={c.provisional ? 0.6 : undefined}>
                  {segs.map((s, j) => {
                    const fill = s.k === 'unknown' ? { fill: `url(#${hatchId})` } : undefined;
                    return j === segs.length - 1 ? (
                      <path key={s.k} className="sl-seg" data-stage={s.k} d={topRounded(x, s.y, colW, s.h, 4)} style={fill} />
                    ) : (
                      <rect key={s.k} className="sl-seg" data-stage={s.k} x={x} y={s.y} width={colW} height={s.h} style={fill} />
                    );
                  })}
                </g>
              );
            })}
            {goalH ? (
              <g className="sl-goal">
                <line className="sg-goal" x1={padL} x2={padL + plotW} y1={Y(goalH * 60)} y2={Y(goalH * 60)} />
                <text className="sg-goal-label" x={padL + plotW} y={Y(goalH * 60) - 3} textAnchor="end">
                  {S.goal(goalH)}
                </text>
              </g>
            ) : null}
            <SlotTicks
              kind={kind}
              keys={cols.map((c) => c.key)}
              anchor={anchor}
              xAt={cx}
              y={base + 13}
              coverage={year ? months.map((m) => (m.future ? null : `${m.recorded}/${m.days}`)) : undefined}
            />
            {ch.slot !== null ? <line className="sg-crosshair" x1={cx(ch.slot)} x2={cx(ch.slot)} y1={padT} y2={base} /> : null}
          </svg>
        </div>
      </ChartShell>
    </div>
  );
}

/** Table row of one night (§7.3.4): date, asleep, deep, light, REM, unknown, awake, bed, up. */
export function nightRow(date: LocalDate, n: SleepNight | null): string[] {
  if (!n) return [fmtDay(date), S.noData, '', '', '', '', '', '', ''];
  const timed = n.bed !== null && n.wake !== null;
  return [
    n.provisional ? `${fmtDay(date)} ${S.stillChangingTable}` : fmtDay(date),
    durShort(n.asleepMin),
    ...STACK_STAGES.map((k) => (n.hasStages || k === 'unknown' ? durShort(n.stack[k]) : S.noData)),
    n.awakeMin === null ? S.noData : durShort(n.awakeMin),
    timed ? clockAt(n.bed!, n.offsetS) : S.noData,
    timed ? clockAt(n.wake!, n.offsetS) : S.noData,
  ];
}

/** Bed and wake of a night as "23:40 – 07:05" (null without times). */
export const bedWakeText = (n: SleepNight): string | null =>
  n.bed !== null && n.wake !== null ? clockRange(clockAt(n.bed, n.offsetS), clockAt(n.wake, n.offsetS)) : null;
