/* ==========================================================================
   <TrendLane> (CHART_SPEC §7.8) — the weight trend against the plan's
   forecast, the hero of every "is it working?" question (Today, Progress,
   check-in). SVG secondary chart, Ember, r071 skin: a dotted dim grid, the
   trend as one smooth 2 px line in the metric's hue (ivory on a card with a
   glow) ending in a glowing dot at today, the forecast as a hue gradient
   band whose p10 / p90 edges stay long-dashed (never the wash alone) with the
   median hairline, as-prescribed band (1 px short-dashed stone outline, only
   when the data carries it), goal line, raw weigh-ins (dim dots; flagged =
   hollow, never removed), event hairlines, the stone now-hand, crosshair. A
   trend with no forecast gets the soft area under it. Gaps stay gaps (NaN
   breaks the line). Y hugs the data (the goal never stretches it: a goal off
   the scale takes an edge label) with a printed tick column; quiet mode =
   shape only. The plot is one tab stop (role="img" + summary). The table twin
   is the card's: `trendTwin(data)` goes in the (i) panel and the card's `T`
   key opens it; without a card (`tableTwin`, the default) the chart keeps its
   own Table key and `T`. Never red or green.
   C2/C6 (D5-02, D5-05): a forecast band is drawn (and named in the legend)
   only when its version holds one — a band with no finite edge is absent,
   never an empty "Forecast"; the goal-date bracket is a plain range, never
   "likely".
   ========================================================================== */
import { memo, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Download } from 'lucide-react';
import { Engraved, Key, TwinKey, useReveal } from '@/components';
import { downloadText } from '../components/DataTable';
import { useElementWidth } from '../core/hooks';
import { decimalsForStep, formatNumber } from '../lib/format';
import { chartHue, EndDot, SkinGradients, usePulseAfterReveal, type ChartHue } from './skin';
import {
  cellText,
  engravedPx,
  lastTrendDay,
  placeLabels,
  rangeText,
  smoothAreaPath,
  smoothBandPath,
  smoothLinePath,
  trendLayout,
  trendPointParts,
  trendReadoutText,
  trendSummary,
  trendTableCSV,
  trendTableRows,
  type GoalBracket,
  type TrendSize,
} from './trend';
import type { TrendLaneData } from './types';

const hasFinite = (xs: readonly number[] | undefined): boolean => !!xs && xs.some((x) => Number.isFinite(x));

/**
 * The lane as drawn (C2/C6): a band whose edges hold no finite value (an unavailable realistic forecast, filled with
 * gaps) is dropped, and the goal-date label loses a leading "likely" (a range, not a probability claim).
 */
export function shownTrendData(data: TrendLaneData): TrendLaneData {
  let out = data;
  if (data.realistic && !(hasFinite(data.realistic.p10) && hasFinite(data.realistic.p90))) {
    const { realistic: _r, ...rest } = out;
    void _r;
    out = rest;
  }
  if (data.asPrescribed && !(hasFinite(data.asPrescribed.p10) && hasFinite(data.asPrescribed.p90))) {
    const { asPrescribed: _a, ...rest } = out;
    void _a;
    out = rest;
  }
  if (data.goalDateRange && /^likely\s+/i.test(data.goalDateRange.label)) out = { ...out, goalDateRange: { ...data.goalDateRange, label: data.goalDateRange.label.replace(/^likely\s+/i, '') } };
  return out;
}
import './living-charts.css';

export interface TrendLaneProps {
  data: TrendLaneData;
  /** today 64–96 px (default 88) · progress 240 (180 under 640 px wide) · checkin 160. Default progress. */
  size?: TrendSize;
  /** Overrides the size's height (today is clamped to 64–96). */
  height?: number;
  /** Quiet mode: shape only — no y numerals, no unit, no weights in the readout, summary or crosshair. */
  quiet?: boolean;
  /**
   * The line above the plot. Default: the trend now, "83.1 kg" (quiet: "Going down"). Pass your own node ("83.1 kg ·
   * −2.4 kg since 2 Oct"), or `false` to hide it.
   */
  readout?: ReactNode | false;
  /** A short label above the readout (sentence case). Usually left out: the card title names the chart. */
  title?: string;
  className?: string;
  /**
   * r068 L14: the table twin's state held by the card, whose head draws the Table key (`id` names the table for the
   * key's aria-controls). Without it the chart keeps its own state and draws the key beside its legend.
   */
  table?: { open: boolean; onToggle: () => void; id: string };
  /**
   * r071: the metric's hue, a category (`body`, the default) or a domain, read through `categoryColor` / `domainColor`
   * and set as `--lmc-hue`. It tints the band, the area, the end dot's halo and (off a card with a glow) the line.
   */
  hue?: ChartHue;
  /** The legend row above the plot (default true). A card turns it off: the band names itself, the rest is in its (i). */
  legend?: boolean;
  /**
   * The chart's own Table key, table and `T` key (default true). A card that hosts the twin in its (i) panel passes
   * false, puts `trendTwin(data)` in `InfoSpec.twin` and lets its own `T` open the panel.
   */
  tableTwin?: boolean;
  /** The end dot pulses twice after the first view (default: on the big chart only). */
  pulse?: boolean;
  /** False renders the final frame at once (the first-view wipe and the pulse are skipped). */
  animate?: boolean;
}

/* ------------------------------------------------------- shared helpers */

/** Day crosshair shared by the living charts: pointer hover / tap, ←/→ (⇧ ×7), Home/End, Esc clears. */
export function useDayCrosshair(days: number, home: number) {
  const [day, setDay] = useState<number | null>(null);
  const clampDay = (d: number) => Math.max(0, Math.min(days - 1, d));
  return {
    day: day === null ? null : clampDay(day),
    onKeyDown(e: KeyboardEvent<HTMLElement>): void {
      const cur = day ?? home;
      let next: number;
      switch (e.key) {
        case 'ArrowLeft':
          next = cur - (e.shiftKey ? 7 : 1);
          break;
        case 'ArrowRight':
          next = cur + (e.shiftKey ? 7 : 1);
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = days - 1;
          break;
        case 'Escape':
          if (day !== null) {
            e.preventDefault();
            setDay(null);
          }
          return;
        default:
          return;
      }
      e.preventDefault();
      setDay(clampDay(next));
    },
    onFocus: () => setDay((d) => d ?? clampDay(home)),
    onBlur: () => setDay(null),
    onPointer(e: PointerEvent<HTMLElement>, dayAt: (x: number) => number): void {
      const r = e.currentTarget.getBoundingClientRect();
      setDay(clampDay(dayAt(e.clientX - r.left)));
    },
    onPointerLeave(e: PointerEvent<HTMLElement>): void {
      // touch keeps the crosshair where it was tapped; the mouse lets go unless the chart has keyboard focus
      if (e.pointerType === 'mouse' && e.currentTarget !== document.activeElement) setDay(null);
    },
  };
}

/** The crosshair readout mirrored to a polite live region, 400 ms after the last move (CHART_SPEC §5.1). */
export function useDebouncedText(text: string, ms = 400): string {
  const [out, setOut] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setOut(text), ms);
    return () => clearTimeout(id);
  }, [text, ms]);
  return out;
}

export interface TwinTableProps {
  id: string;
  /** Accessible name of the scroll region ("Weight trend table"). */
  title: string;
  caption: string;
  rows: number;
  fileName: string;
  csv: () => string;
  children: ReactNode;
}

/** Table-twin shell for the living charts: row count, CSV download, a scrollable table with sticky header. */
export function TwinTable({ id, title, caption, rows, fileName, csv, children }: TwinTableProps) {
  return (
    <div className="lmc-twin" id={id}>
      <div className="lmc-twin__bar">
        <span>{rows === 1 ? '1 day' : `${rows} days`}</span>
        <span className="lmc-twin__grow" />
        <Key size="sm" variant="outlined" icon={Download} onClick={() => downloadText(csv(), fileName)}>
          Download CSV
        </Key>
      </div>
      <div className="lmc-twin__wrap" tabIndex={0} role="region" aria-label={title}>
        <table className="lmc-twin__table">
          <caption className="lm-sr">{caption}</caption>
          {children}
        </table>
      </div>
    </div>
  );
}

/** Goal-date bracket on the x-axis; clipped ends and out-of-window ranges get an arrow. */
function Bracket({ b, rowY, px0, px1 }: { b: GoalBracket; rowY: number; px0: number; px1: number }) {
  const arrow = (x: number, y: number, dir: 1 | -1) => `M${x - 5 * dir},${y - 3}L${x},${y}L${x - 5 * dir},${y + 3}`;
  if (b.outside) {
    const right = b.outside === 'after';
    const y = rowY - 4;
    return (
      <g data-mark="goal-date" className="lmc-tl__bracket">
        <path className="lmc-tl__arrow" d={arrow(right ? px1 : px0, y, right ? 1 : -1)} />
        <text className="lmc-lv-eng" x={right ? px1 - 9 : px0 + 9} y={rowY} textAnchor={right ? 'end' : 'start'}>
          {b.label}
        </text>
      </g>
    );
  }
  const y = Math.round(rowY) + 0.5;
  const w = engravedPx(b.label);
  const room = { right: px1 - b.x1 - 6, left: b.x0 - px0 - 6 };
  const place: { x: number; anchor: 'start' | 'end' | 'middle' } =
    room.right >= w ? { x: b.x1 + 6, anchor: 'start' } : room.left >= w ? { x: b.x0 - 6, anchor: 'end' } : { x: (b.x0 + b.x1) / 2, anchor: 'middle' };
  return (
    <g data-mark="goal-date" className="lmc-tl__bracket">
      <line className="lmc-tl__bar" x1={b.x0} x2={b.x1} y1={y} y2={y} />
      {b.clipLeft ? <path className="lmc-tl__arrow" d={arrow(b.x0, y, -1)} /> : <line className="lmc-tl__bar" x1={b.x0 + 0.5} x2={b.x0 + 0.5} y1={y - 4} y2={y} />}
      {b.clipRight ? <path className="lmc-tl__arrow" d={arrow(b.x1, y, 1)} /> : <line className="lmc-tl__bar" x1={b.x1 - 0.5} x2={b.x1 - 0.5} y1={y - 4} y2={y} />}
      <text className="lmc-lv-eng lmc-lv-halo" x={place.x} y={y + 4} textAnchor={place.anchor}>
        {b.label}
      </text>
    </g>
  );
}

/* ------------------------------------------------------------ component */

export const TrendLane = memo(function TrendLane({
  data: given,
  size = 'progress',
  height,
  quiet = false,
  readout,
  title,
  className,
  table,
  hue = 'body',
  legend = true,
  tableTwin = true,
  pulse,
  animate = true,
}: TrendLaneProps) {
  const data = useMemo(() => shownTrendData(given), [given]);
  const rootRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(rootRef) || 640;
  const L = useMemo(() => trendLayout(data, size, width, { height, quiet }), [data, size, width, height, quiet]);
  const summary = useMemo(() => trendSummary(data, { quiet }), [data, quiet]);
  const [ownTable, setOwnTable] = useState(false);
  // r068 L14: a card may hold the Table key in its own head and pass the state in (`table`)
  const showTable = table ? table.open : ownTable;
  const setShowTable = (u: (s: boolean) => boolean) => (table ? table.onToggle() : setOwnTable(u));
  const tableOpen = tableTwin && showTable && !quiet;
  const [revealRef, pending] = useReveal<HTMLDivElement>({ animate });
  const hero = pulse ?? size === 'progress';
  const pulsing = usePulseAfterReveal(pending, hero, animate);
  const rows = useMemo(() => (tableOpen ? trendTableRows(data) : []), [tableOpen, data]);
  const hasEvents = rows.some((r) => r.event);
  const cross = useDayCrosshair(data.days, data.todayIndex ?? lastTrendDay(data));
  const point = cross.day !== null ? trendPointParts(data, cross.day, quiet) : null;
  const announce = useDebouncedText(point ? `${point.date}: ${point.parts.join(', ')}` : '');
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const { X, Y, px0, px1, py0, py1, slot } = L;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (tableTwin && !quiet && (e.key === 't' || e.key === 'T') && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      setShowTable((s) => !s);
      return;
    }
    cross.onKeyDown(e);
  };

  const dec = decimalsForStep(L.ticks.step);
  const goal = data.goal;
  const goalText = goal ? (quiet ? 'goal' : goal.label) : '';
  const gy = goal ? Math.round(Y(goal.value)) + 0.5 : 0;
  const events = (data.events ?? [])
    .filter((e) => (e.endDay ?? e.day) >= 0 && e.day < data.days)
    .map((e) => {
      const a = Math.max(px0, X(e.day) - slot / 2);
      const b = Math.min(px1, X(e.endDay ?? e.day) + slot / 2);
      return { ...e, a, b, x: e.kind === 'pause' ? a : Math.round(X(e.day)) + 0.5 };
    });
  const placed = placeLabels(
    events.map((e) => ({ x: e.x, text: e.label })),
    px0 + 2,
    px1 + 6,
  );
  const pauses = events.map((e, k) => ({ e, p: placed[k]! })).filter(({ e }) => e.kind === 'pause');
  const markers = events.map((e, k) => ({ e, p: placed[k]! })).filter(({ e }) => e.kind !== 'pause');
  const dots = data.weighIns.filter((w) => w.day >= 0 && w.day < data.days && Number.isFinite(w.value));
  const now = data.todayIndex !== null && data.todayIndex >= 0 && data.todayIndex < data.days ? X(data.todayIndex) : null;
  // the goal label is right-aligned, but never under the now-hand
  const goalX = now !== null && now > px1 - engravedPx(goalText) - 8 ? Math.min(px1 - 2, now - 6) : px1 - 2;
  const xh = cross.day !== null ? X(cross.day) : null;
  const xhTrend = cross.day !== null ? (data.trend[cross.day] ?? NaN) : NaN;
  const clipId = `${uid}-clip`;
  const hatchId = `${uid}-hatch`;
  const xhairId = `${uid}-xh`;
  const tableId = table ? table.id : `${uid}-table`;
  const hasFlagged = dots.some((w) => w.flagged);
  const unit = data.unit;
  // the visible table key lives on the big chart only (or in the card's head); T toggles the twin everywhere
  const tableKey = tableTwin && !quiet && size === 'progress' && !table;
  // the end of the line: the latest finite trend value at or before today. The dot marks the estimate, not a certainty.
  const endDay = lastTrendDay(data);
  const endV = data.trend[endDay] ?? NaN;
  const end = Number.isFinite(endV) ? { x: X(endDay), y: Y(endV) } : null;
  const trendD = useMemo(() => smoothLinePath(data.trend, X, Y), [data.trend, X, Y]);
  const bandD = data.realistic ? smoothBandPath(data.realistic.p10, data.realistic.p90, X, Y) : '';
  const areaD = !data.realistic ? smoothAreaPath(data.trend, X, Y, py1) : '';
  const bandWord = !legend && size === 'progress' && data.realistic && !quiet ? 'Forecast' : '';
  const lastBand = (() => {
    if (!data.realistic) return null;
    for (let i = data.days - 1; i >= 0; i--) {
      const hi = data.realistic.p90[i] ?? NaN;
      const lo = data.realistic.p10[i] ?? NaN;
      if (Number.isFinite(hi) && Number.isFinite(lo)) return { x: X(i), hi: Y(hi), lo: Y(lo) };
    }
    return null;
  })();

  return (
    <div
      ref={rootRef}
      className={['lmc-tl', 'lmc-skin', className].filter(Boolean).join(' ')}
      data-size={size}
      data-quiet={quiet ? 'true' : undefined}
      data-reveal={pending ? 'pending' : undefined}
      style={{ '--lmc-hue': chartHue(hue) } as CSSProperties}
    >
      {title || readout !== false ? (
        <div className="lmc-tl__head">
          <div className="lmc-tl__lead">
            {title ? (
              <Engraved as="p" className="lmc-tl__title">
                {title}
              </Engraved>
            ) : null}
            {readout !== false ? <p className="lmc-tl__readout">{readout ?? trendReadoutText(data, quiet)}</p> : null}
          </div>
        </div>
      ) : null}

      {/* r068 PR2: the gold line and the dots need no legend (the summary names them); only the marks that do are listed,
          on one row with the Table key (r068 PR1, PR6: the same TwinKey as every other card) */}
      {legend && size !== 'today' && (hasFlagged || data.realistic || data.asPrescribed || goal || tableKey) ? (
        <div className="lmc-tl__meta">
        <ul className="lmc-lv-legend">
          {hasFlagged ? (
            <li>
              <svg width="10" height="10" aria-hidden="true">
                <circle className="lmc-tl__dot lmc-tl__dot--flagged" cx="5" cy="5" r="2.5" />
              </svg>
              Unusual, kept
            </li>
          ) : null}
          {data.realistic ? (
            <li>
              {/* the swatch draws what the plot draws: the wash between two dashed edges, the median through it */}
              <svg width="20" height="10" aria-hidden="true">
                <rect className="lmc-tl__band" x="1" y="1" width="18" height="8" />
                <line className="lmc-tl__bound" x1="1" x2="19" y1="1" y2="1" />
                <line className="lmc-tl__bound" x1="1" x2="19" y1="9" y2="9" />
                {data.realistic.p50 ? <line className="lmc-tl__p50" x1="1" x2="19" y1="5" y2="5" /> : null}
              </svg>
              Forecast
            </li>
          ) : null}
          {data.asPrescribed ? (
            <li>
              <svg width="16" height="10" aria-hidden="true">
                <rect className="lmc-tl__presc" x="1.5" y="1.5" width="13" height="7" fill="none" />
              </svg>
              If followed fully
            </li>
          ) : null}
          {goal ? (
            <li>
              <svg width="16" height="10" aria-hidden="true">
                <line className="lmc-tl__goal" x1="1" x2="15" y1="5.5" y2="5.5" />
              </svg>
              Goal
            </li>
          ) : null}
        </ul>
        {tableKey ? <TwinKey open={showTable} onToggle={() => setShowTable((s) => !s)} controls={tableId} /> : null}
        </div>
      ) : null}

      <div
        ref={revealRef}
        className="lmc-tl__plot"
        role="img"
        aria-label={summary}
        tabIndex={0}
        style={{ height: L.height }}
        onKeyDown={onKeyDown}
        onFocus={cross.onFocus}
        onBlur={cross.onBlur}
        onPointerDown={(e) => cross.onPointer(e, L.dayAt)}
        onPointerMove={(e) => cross.onPointer(e, L.dayAt)}
        onPointerLeave={cross.onPointerLeave}
      >
        <svg className="lmc-lv-svg" width={width} height={L.height} aria-hidden="true" focusable="false">
          <defs>
            <clipPath id={clipId}>
              <rect x={px0} y={py0 - 4} width={px1 - px0} height={py1 - py0 + 8} />
            </clipPath>
            <pattern id={hatchId} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line className="lmc-lv-hatch" x1="0" y1="0" x2="0" y2="5" />
            </pattern>
            <SkinGradients id={uid} />
            {/* the crosshair hairline fades out at both ends */}
            <linearGradient id={xhairId} gradientUnits="userSpaceOnUse" x1="0" y1={py0} x2="0" y2={py1}>
              <stop className="lmc-xh lmc-xh--end" offset="0" />
              <stop className="lmc-xh" offset="0.14" />
              <stop className="lmc-xh" offset="0.86" />
              <stop className="lmc-xh lmc-xh--end" offset="1" />
            </linearGradient>
          </defs>

          {/* 1 · pauses (hatched spans) */}
          {pauses.map(({ e, p }, k) => (
            <g key={`p${k}`} data-mark="pause">
              <rect x={e.a} y={py0} width={Math.max(0, e.b - e.a)} height={py1 - py0} fill={`url(#${hatchId})`} />
              <line className="lmc-tl__event" x1={Math.round(e.a) + 0.5} x2={Math.round(e.a) + 0.5} y1={py0 - 12} y2={py0} />
              {p.show ? (
                <text className="lmc-lv-eng" x={p.x} y={py0 - 5} textAnchor={p.anchor}>
                  {e.label}
                </text>
              ) : null}
            </g>
          ))}

          {/* 2 · grid + printed tick column */}
          {L.ticks.ticks.map((t) => {
            const y = Math.round(Y(t)) + 0.5;
            return (
              <g key={t}>
                <line className="lmc-lv-grid" x1={px0} x2={px1} y1={y} y2={y} />
                {!quiet ? (
                  <text data-mark="y-tick" className="lmc-lv-tick" x={px0 - 5} y={y} textAnchor="end" dominantBaseline="central">
                    {formatNumber(t, dec)}
                  </text>
                ) : null}
              </g>
            );
          })}
          {/* the Progress card's readout carries the unit (r068 PR2): no "kg" over its top tick */}
          {!quiet && size !== 'progress' ? (
            <text data-mark="y-unit" className="lmc-lv-tick" x={px0 - 5} y={py0 - 5} textAnchor="end">
              {unit}
            </text>
          ) : null}
          <line className="lmc-lv-axis" x1={px0} x2={px1} y1={py1 + 0.5} y2={py1 + 0.5} />

          {/* today: a dotted stone hand under the data (the trend and its end dot sit on it) */}
          {now !== null ? (
            <g data-mark="now" className="lmc-tl__now">
              <line x1={now} x2={now} y1={py0 - 2} y2={py1} />
            </g>
          ) : null}

          {/* the data wipes in left to right on the first view (one clip reveal of the whole group, end dot included) */}
          <g className="lmc-draw">
            <g clipPath={`url(#${clipId})`}>
              {/* 3 · forecasts: the wash says "range", the dashed edges say where it ends (never the wash alone) */}
              {data.realistic ? (
                <>
                  <path data-mark="realistic" className="lmc-tl__band" fill={`url(#${uid}-band)`} d={bandD} />
                  <g data-mark="realistic-bounds">
                    <path data-bound="p90" className="lmc-tl__bound" d={smoothLinePath(data.realistic.p90, X, Y)} />
                    <path data-bound="p10" className="lmc-tl__bound" d={smoothLinePath(data.realistic.p10, X, Y)} />
                  </g>
                </>
              ) : null}
              {data.realistic?.p50 ? <path data-mark="realistic-p50" className="lmc-tl__p50" d={smoothLinePath(data.realistic.p50, X, Y)} /> : null}
              {areaD ? <path data-mark="area" className="lmc-tl__area" fill={`url(#${uid}-area)`} d={areaD} /> : null}
              {data.asPrescribed ? (
                <g data-mark="as-prescribed">
                  <path className="lmc-tl__presc" d={smoothLinePath(data.asPrescribed.p10, X, Y)} />
                  <path className="lmc-tl__presc" d={smoothLinePath(data.asPrescribed.p90, X, Y)} />
                </g>
              ) : null}
              {/* 4 · goal */}
              {goal && L.domain.goal === 'inside' ? <line data-mark="goal" className="lmc-tl__goal" x1={px0} x2={px1} y1={gy} y2={gy} /> : null}
              {/* 5 · weigh-ins, then the trend on top */}
              {dots.map((w, k) =>
                w.flagged ? (
                  <circle key={k} data-mark="weigh-in" data-flagged="true" className="lmc-tl__dot lmc-tl__dot--flagged" cx={X(w.day)} cy={Y(w.value)} r={2.5} />
                ) : (
                  <circle key={k} data-mark="weigh-in" className="lmc-tl__dot" cx={X(w.day)} cy={Y(w.value)} r={2} />
                ),
              )}
              <path data-mark="trend" className="lmc-tl__trend" d={trendD} />
            </g>
            {end ? <EndDot x={end.x} y={end.y} r={hero ? 5 : 3.5} pulse={pulsing} /> : null}
          </g>

          {/* the one word the band needs: it names itself (the legend row is off on a card) */}
          {bandWord && lastBand ? (
            <text data-mark="band-word" className="lmc-lv-eng lmc-lv-halo lmc-tl__bandword" x={px1 - 4} y={lastBand.hi - 6 < py0 + 9 ? lastBand.lo + 13 : lastBand.hi - 6} textAnchor="end">
              {bandWord}
            </text>
          ) : null}

          {/* goal label (inside) or edge label (outside the hugged domain) */}
          {goal && L.domain.goal === 'inside' ? (
            <text className="lmc-lv-eng lmc-lv-halo" x={goalX} y={gy - 4 < py0 + 10 ? gy + 12 : gy - 4} textAnchor="end">
              {goalText}
            </text>
          ) : null}
          {/* a goal beyond the hugged scale: an edge label on the open side (a falling trend leaves the lower left free) */}
          {goal && (L.domain.goal === 'above' || L.domain.goal === 'below') ? (
            <text data-mark="goal-edge" className="lmc-lv-eng lmc-lv-halo" x={px0 + 4} y={L.domain.goal === 'below' ? py1 - 4 : py0 + 11} textAnchor="start">
              {`${goalText} ${L.domain.goal === 'below' ? '↓' : '↑'}`}
            </text>
          ) : null}

          {/* 7 · version / reset markers */}
          {markers.map(({ e, p }, k) => (
            <g key={`m${k}`} data-mark={e.kind}>
              <line className="lmc-tl__event" x1={e.x} x2={e.x} y1={py0 - 12} y2={py1} />
              {p.show ? (
                <text className="lmc-lv-eng" x={p.x} y={py0 - 5} textAnchor={p.anchor}>
                  {e.label}
                </text>
              ) : null}
            </g>
          ))}

          {/* 8 · crosshair: a hairline that fades at both ends, and a dot with a halo on the trend */}
          {xh !== null ? (
            <g data-mark="crosshair">
              <line className="lmc-tl__xhair" x1={xh} x2={xh} y1={py0} y2={py1} stroke={`url(#${xhairId})`} />
              {Number.isFinite(xhTrend) ? (
                <>
                  <circle className="lmc-tl__xhalo" cx={xh} cy={Y(xhTrend)} r={10} />
                  <circle className="lmc-tl__xdot" cx={xh} cy={Y(xhTrend)} r={4} />
                </>
              ) : null}
            </g>
          ) : null}

          {/* x-axis: dates, then the goal-date bracket */}
          {L.xTicks.map((t) => (
            <g key={t.day}>
              <text data-mark="x-tick" className="lmc-lv-tick" x={t.x} y={L.xRowY} textAnchor={t.anchor}>
                {t.label}
              </text>
            </g>
          ))}
          {L.bracket ? <Bracket b={L.bracket} rowY={L.bracketRowY ?? L.xRowY} px0={px0} px1={px1} /> : null}
        </svg>
        {point && xh !== null ? (
          <div className="lmc-lv-tip" data-dock={size === 'today' ? 'true' : undefined} data-side={xh > width / 2 ? 'left' : 'right'} style={size === 'today' ? undefined : { left: xh }} aria-hidden="true">
            <b>{point.date}</b>
            {point.parts.map((p) => (
              <span key={p}>{p}</span>
            ))}
          </div>
        ) : null}
      </div>
      <p className="lm-sr" aria-live="polite">
        {announce}
      </p>

      {tableOpen ? (
        <TwinTable
          id={tableId}
          title="Weight trend table"
          caption="Weight by day: your weigh-in, the filtered trend, the range the forecast expected at your adherence, and events."
          rows={rows.length}
          fileName="weight-trend.csv"
          csv={() => trendTableCSV(rows, unit, data.decimals)}
        >
          {/* r068 L15: short heads and one-line dates ("Fri 2", the month on its first row and the 1st), so every row is
              one line on a phone; the Event column only when a day has one */}
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">
                Scale<small>{unit}</small>
              </th>
              <th scope="col">
                Trend<small>{unit}</small>
              </th>
              <th scope="col">
                Forecast<small>{unit}</small>
              </th>
              {hasEvents ? <th scope="col">Event</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.day} data-today={r.isToday ? 'true' : undefined}>
                <th scope="row" className="lmc-twin__date">
                  {i === 0 || r.date.endsWith('-01') ? r.label : r.label.replace(/ [A-Z][a-z]{2}$/, '')}
                  {r.isToday ? <small> · today</small> : null}
                </th>
                <td>
                  {cellText(r.weighIn, data.decimals)}
                  {r.flagged ? <small> unusual, kept</small> : null}
                </td>
                <td>{cellText(r.trend, data.decimals)}</td>
                <td>{rangeText(r.expectedLo, r.expectedHi, data.decimals)}</td>
                {hasEvents ? <td>{r.event || '—'}</td> : null}
              </tr>
            ))}
          </tbody>
        </TwinTable>
      ) : null}
    </div>
  );
});
