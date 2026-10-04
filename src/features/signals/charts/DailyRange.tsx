/**
 * Heart rate per day (ring-pages.md §7.4.5) and the slot frame the per-night charts share. One slot per day of the
 * period (week, month) or per month (year). Per slot a 2 px range line from lowest to highest (hue at 50 %), the dot
 * (resting heart rate, or a monthly mean) as an 8 px dot with a surface ring, and a 2 px line through the dots that
 * breaks at missing slots. A missing slot draws the dashed stub; a future slot draws nothing. Slot crosshair
 * (`useSlotCrosshair`); tap or Enter drills down (week, month → that day; year → that month).
 */
import { memo, useRef, type ReactNode } from 'react';
import { formatNumber } from '@/components/lib/format';
import { useElementWidth } from '@/features/charts/core/hooks';
import { dayOfMonth } from '@/features/living/format';
import { weekdayOf } from '@/living/dates';
import type { LocalDate } from '@/living';
import type { PeriodWindow } from '../models';
import { niceTicks } from './heartModels';
import { CHART_DRILL_HELP, ChartShell, MissingStub, useChartSizes, useSlotCrosshair } from './kit';
import './heart.css';

/* ------------------------------------------------------------------------------------------------ slot frame */

const WEEKDAY_LETTER = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export interface SlotTick {
  i: number;
  lines: string[];
}

/** §7.3.4 ticks: week "M / 29" (weekday letter over date); month 1, 8, 15, 22, 29 plus the chosen date; year months. */
export function slotTicks(w: PeriodWindow, slotW: number): SlotTick[] {
  if (w.kind === 'week') return w.slots.map((s, i) => ({ i, lines: [WEEKDAY_LETTER[weekdayOf(s.start)]!, String(dayOfMonth(s.start))] }));
  if (w.kind === 'year') return w.slots.map((s, i) => ({ i, lines: [slotW >= 26 ? MONTH_SHORT[Number(s.start.slice(5, 7)) - 1]! : MONTH_SHORT[Number(s.start.slice(5, 7)) - 1]!.charAt(0)] }));
  return w.slots
    .map((s, i) => ({ i, d: dayOfMonth(s.start), anchor: s.start === w.anchor }))
    .filter((x) => [1, 8, 15, 22, 29].includes(x.d) || x.anchor)
    .map((x) => ({ i: x.i, lines: [String(x.d)] }));
}

export interface SlotGeometry {
  width: number;
  height: number;
  padL: number;
  right: number;
  top: number;
  bottom: number;
  slotW: number;
  /** Column width: min(24, slot × 0.72). */
  colW: number;
  /** Centre of slot i. */
  X: (i: number) => number;
  Y: (v: number) => number;
}

export interface SlotChartProps {
  window: PeriodWindow;
  /** One entry per slot of the window. */
  slots: ReadonlyArray<{ future: boolean; recorded: boolean; readout: string }>;
  domain: [number, number];
  yTicks: readonly number[];
  yFormat?: (v: number) => string;
  /** Unit printed over the tick column. */
  unit: string;
  hue: 'cardio' | 'recovery';
  /** Where missing stubs sit (default: the baseline at the bottom). */
  stubY?: (g: SlotGeometry) => number;
  /** Marks behind the grid (bands). */
  under?: (g: SlotGeometry) => ReactNode;
  /** The data marks. */
  marks: (g: SlotGeometry) => ReactNode;
  title: string;
  header?: ReactNode;
  summary: string;
  height: number;
  status?: 'loading' | 'ready' | 'failed';
  stale?: boolean;
  onRetry?: () => void;
  emptyLine?: string | null;
  table?: ReactNode;
  footer?: ReactNode;
  /** Tap or Enter on a slot (drill down); future slots never drill. */
  onDrill?: (index: number) => void;
}

/** The shared frame of the per-slot charts: ticks, grid, missing stubs, slot crosshair, readout, drill-down. */
export function SlotChart(p: SlotChartProps) {
  const sizes = useChartSizes();
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref, 320) || 320;
  const n = p.window.slots.length;
  const padL = sizes.tickCol;
  // a transient tiny measurement (a full-page capture resizing the viewport) must not give negative sizes
  const right = Math.max(padL + 20, width - 4);
  const slotW = (right - padL) / Math.max(1, n);
  const ticks = slotTicks(p.window, slotW);
  const twoLine = p.window.kind === 'week';
  const top = 14;
  const bottom = p.height - (twoLine ? 30 : 18);
  const [lo, hi] = p.domain;
  const g: SlotGeometry = {
    width,
    height: p.height,
    padL,
    right,
    top,
    bottom,
    slotW,
    colW: Math.max(2, Math.min(24, slotW * 0.72)),
    X: (i) => padL + (i + 0.5) * slotW,
    Y: (v) => top + (1 - (v - lo) / (hi - lo || 1)) * (bottom - top),
  };
  const anchorIdx = p.window.slots.findIndex((s) => s.start <= p.window.anchor && p.window.anchor < s.end);
  const lastPast = p.slots.reduce((acc, s, i) => (s.future ? acc : i), 0);
  const home = anchorIdx >= 0 && !p.slots[anchorIdx]!.future ? anchorIdx : lastPast;
  // the crosshair stops at today: a slot after today has nothing to read (it is not "no data")
  const cross = useSlotCrosshair(lastPast + 1, home);
  const slotAt = (x: number) => Math.floor((x - padL) / slotW);
  const drill = (i: number) => {
    if (p.onDrill && !p.slots[i]?.future) p.onDrill(i);
  };
  const sel = cross.slot;
  const readout = sel !== null ? (p.slots[sel]?.readout ?? null) : null;
  const fmt = p.yFormat ?? ((v: number) => formatNumber(v));
  const stubY = p.stubY ? p.stubY(g) : bottom;
  const xh = sel !== null ? g.X(sel) : null;
  return (
    <div ref={ref} className="hr-chart" data-hr-hue={p.hue}>
      <ChartShell
        title={p.title}
        header={p.header}
        summary={p.summary}
        readout={readout}
        height={p.height}
        status={p.status ?? 'ready'}
        stale={!!p.stale}
        emptyLine={p.emptyLine ?? null}
        {...(p.onRetry ? { onRetry: p.onRetry } : {})}
        table={p.table}
        footer={p.footer}
      >
        <div
          className="hr-plot"
          role="img"
          aria-label={p.summary}
          aria-description={CHART_DRILL_HELP}
          tabIndex={0}
          onKeyDown={(e) => cross.onKeyDown(e, drill)}
          onFocus={cross.onFocus}
          onBlur={cross.onBlur}
          onPointerDown={(e) => cross.onPointerDown(e)}
          onPointerMove={(e) => cross.onPointerMove(e, slotAt)}
          onPointerUp={(e) => cross.onPointerUp(e, slotAt, drill)}
          onPointerLeave={(e) => cross.onPointerLeave(e)}
        >
          <svg className="sg-svg" width={width} height={p.height} viewBox={`0 0 ${width} ${p.height}`} aria-hidden="true" focusable="false">
            {sel !== null ? <rect className="hr-slot-sel" x={padL + sel * slotW} y={top} width={slotW} height={bottom - top} /> : null}
            {p.under?.(g)}
            {p.yTicks.map((v) => (
              <g key={`y${v}`}>
                <line className="sg-grid" x1={padL} x2={right} y1={Math.round(g.Y(v)) + 0.5} y2={Math.round(g.Y(v)) + 0.5} />
                <text className="sg-tick" x={padL - 5} y={g.Y(v)} textAnchor="end" dominantBaseline="central">
                  {fmt(v)}
                </text>
              </g>
            ))}
            <text className="sg-tick" x={padL - 5} y={9} textAnchor="end">
              {p.unit}
            </text>
            <line className="sg-axis" x1={padL} x2={right} y1={bottom + 0.5} y2={bottom + 0.5} />
            {ticks.map((t) => (
              <text key={`x${t.i}`} className="sg-tick" x={g.X(t.i)} y={bottom + 13} textAnchor="middle" data-current={p.window.slots[t.i]?.current ? 'true' : undefined}>
                {t.lines.map((l, k) => (
                  <tspan key={k} x={g.X(t.i)} dy={k === 0 ? 0 : 12}>
                    {l}
                  </tspan>
                ))}
              </text>
            ))}
            {p.slots.map((s, i) =>
              !s.future && !s.recorded ? <MissingStub key={`m${i}`} x={g.X(i) - g.colW / 2} width={g.colW} baseline={stubY} label={s.readout} /> : null,
            )}
            {p.marks(g)}
            {xh !== null ? <line className="sg-crosshair" data-mark="crosshair" x1={xh} x2={xh} y1={top} y2={bottom} /> : null}
          </svg>
          {readout && xh !== null ? (
            <div className="hr-tip" data-side={xh > width / 2 ? 'left' : 'right'} style={{ left: xh }} aria-hidden="true">
              {readout}
            </div>
          ) : null}
        </div>
      </ChartShell>
    </div>
  );
}

/** Domain hugging the values (+10 % padding); `fallback` when there are none (the frame and axes still draw). */
export function hugSlots(values: ReadonlyArray<number | null | undefined>, fallback: [number, number], minPad = 1): [number, number] {
  const xs = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (!xs.length) return fallback;
  let lo = Math.min(...xs), hi = Math.max(...xs);
  const pad = Math.max((hi - lo) * 0.1, minPad);
  lo -= pad;
  hi += pad;
  return [lo, hi];
}

/* ------------------------------------------------------------------------------------------------ DailyRange */

export interface RangeDatum {
  /** Slot start (date, or the month's first date). */
  start: LocalDate;
  future: boolean;
  /** The slot has a record (otherwise, unless future, the missing stub). */
  recorded: boolean;
  /** The dot (resting heart rate, or a monthly mean); null = none. */
  dot: number | null;
  /** Range line lowest → highest; null = none. */
  lo: number | null;
  hi: number | null;
  /** Crosshair readout for the slot ("Tue 30 Sep · resting 58 bpm · 48–162 bpm"). */
  readout: string;
}

export interface DailyRangeProps {
  window: PeriodWindow;
  data: readonly RangeDatum[];
  hue?: 'cardio' | 'recovery';
  unit: string;
  decimals?: number;
  /** The person's normal range as a band behind (hue at band alpha; `ink` as ScoreHistory draws it). */
  normal?: { lo: number; hi: number } | null;
  normalTone?: 'hue' | 'ink';
  /** Domain when nothing is recorded. */
  emptyDomain?: [number, number];
  title: string;
  header?: ReactNode;
  summary: string;
  height: number;
  status?: 'loading' | 'ready' | 'failed';
  stale?: boolean;
  onRetry?: () => void;
  emptyLine?: string | null;
  table?: ReactNode;
  footer?: ReactNode;
  onDrill?: (index: number) => void;
}

export const DailyRange = memo(function DailyRange({ data, hue = 'cardio', decimals = 0, normal, normalTone = 'hue', emptyDomain = [40, 100], ...rest }: DailyRangeProps) {
  const vals = data.flatMap((d) => [d.dot, d.lo, d.hi]);
  const domain = hugSlots(normal ? [...vals, normal.lo, normal.hi] : vals, emptyDomain, decimals ? 0.5 : 1);
  const yTicks = niceTicks(domain[0], domain[1], 3);
  // the line through the dots breaks at every slot without a dot
  const runs: number[][] = [];
  let cur: number[] = [];
  data.forEach((d, i) => {
    if (d.dot !== null && !d.future) cur.push(i);
    else if (cur.length) {
      runs.push(cur);
      cur = [];
    }
  });
  if (cur.length) runs.push(cur);
  return (
    <SlotChart
      {...rest}
      hue={hue}
      slots={data}
      domain={domain}
      yTicks={yTicks}
      yFormat={(v) => formatNumber(v, decimals && yTicks.some((t) => !Number.isInteger(t)) ? decimals : 0)}
      under={(g) => (normal ? <rect className="hr-normal" data-mark="normal" data-tone={normalTone} x={g.padL} y={g.Y(normal.hi)} width={g.right - g.padL} height={Math.max(1, g.Y(normal.lo) - g.Y(normal.hi))} /> : null)}
      marks={(g) => (
        <>
          {data.map((d, i) =>
            d.lo !== null && d.hi !== null && !d.future ? (
              <line key={`r${i}`} className="hr-range" data-mark="range" x1={g.X(i)} x2={g.X(i)} y1={g.Y(d.lo)} y2={g.Y(d.hi)} />
            ) : null,
          )}
          {runs.map((r) =>
            r.length > 1 ? <polyline key={`l${r[0]}`} className="hr-path" data-mark="dot-line" points={r.map((i) => `${g.X(i).toFixed(1)},${g.Y(data[i]!.dot!).toFixed(1)}`).join(' ')} /> : null,
          )}
          {data.map((d, i) => (d.dot !== null && !d.future ? <circle key={`d${i}`} className="hr-dot" data-mark="dot" cx={g.X(i)} cy={g.Y(d.dot)} r={4} /> : null))}
        </>
      )}
    />
  );
});
