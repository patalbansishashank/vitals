/* ==========================================================================
   <TrendLane> (CHART_SPEC §7.8) — the weight trend against the plan's
   forecast, the hero of every "is it working?" question (Today, Progress,
   check-in). SVG secondary chart. Marks bottom → top: pause hatch, realistic
   band (filled) + median hairline, as-prescribed band (1 px dashed outline),
   goal line, raw weigh-ins (faint dots; flagged = hollow, never removed),
   filtered trend (2 px), event hairlines, the yellow now-hand, crosshair.
   Y hugs the data with a printed tick column; quiet mode = shape only.
   The plot is one tab stop (role="img" + summary); a "table" key toggles the
   table twin with CSV. Never red or green.
   ========================================================================== */
import { memo, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Download } from 'lucide-react';
import { Engraved, Key } from '@/components';
import { downloadText } from '../components/DataTable';
import { useElementWidth } from '../core/hooks';
import { decimalsForStep, formatNumber } from '../lib/format';
import {
  bandPath,
  cellText,
  engravedPx,
  lastTrendDay,
  linePath,
  placeLabels,
  rangeText,
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
   * The line above the plot. Default: "trend 83.1 kg (±0.3) · expected today 82.8–83.6" (quiet: "trend going down").
   * Pass your own node to add the drift word ("… · on track"), or `false` to hide it.
   */
  readout?: ReactNode | false;
  /** Engraved label above the readout, lowercase ("weight trend"). */
  title?: string;
  className?: string;
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
        <Key size="sm" variant="quiet" icon={Download} onClick={() => downloadText(csv(), fileName)}>
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

export const TrendLane = memo(function TrendLane({ data, size = 'progress', height, quiet = false, readout, title, className }: TrendLaneProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(rootRef) || 640;
  const L = useMemo(() => trendLayout(data, size, width, { height, quiet }), [data, size, width, height, quiet]);
  const summary = useMemo(() => trendSummary(data, { quiet }), [data, quiet]);
  const [showTable, setShowTable] = useState(false);
  const tableOpen = showTable && !quiet;
  const rows = useMemo(() => (tableOpen ? trendTableRows(data) : []), [tableOpen, data]);
  const cross = useDayCrosshair(data.days, data.todayIndex ?? lastTrendDay(data));
  const point = cross.day !== null ? trendPointParts(data, cross.day, quiet) : null;
  const announce = useDebouncedText(point ? `${point.date}: ${point.parts.join(', ')}` : '');
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const { X, Y, px0, px1, py0, py1, slot } = L;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!quiet && (e.key === 't' || e.key === 'T') && !e.metaKey && !e.ctrlKey && !e.altKey) {
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
  const tableId = `${uid}-table`;
  const hasFlagged = dots.some((w) => w.flagged);
  const unit = data.unit;

  return (
    <div ref={rootRef} className={['lmc-tl', className].filter(Boolean).join(' ')} data-size={size} data-quiet={quiet ? 'true' : undefined}>
      {title || readout !== false || !quiet ? (
        <div className="lmc-tl__head">
          <div className="lmc-tl__lead">
            {title ? (
              <Engraved as="p" className="lmc-tl__title">
                {title}
              </Engraved>
            ) : null}
            {readout !== false ? <p className="lmc-tl__readout">{readout ?? trendReadoutText(data, quiet)}</p> : null}
          </div>
          {!quiet ? (
            <Key size="sm" variant="quiet" pressed={showTable} aria-controls={tableOpen ? tableId : undefined} onClick={() => setShowTable((s) => !s)}>
              table
            </Key>
          ) : null}
        </div>
      ) : null}

      {size !== 'today' ? (
        <ul className="lmc-lv-legend">
          <li>
            <svg width="16" height="10" aria-hidden="true">
              <line className="lmc-tl__trend" x1="1" x2="15" y1="5" y2="5" />
            </svg>
            trend
          </li>
          <li>
            <svg width="10" height="10" aria-hidden="true">
              <circle className="lmc-tl__dot" cx="5" cy="5" r="2" />
            </svg>
            weigh-ins
          </li>
          {hasFlagged ? (
            <li>
              <svg width="10" height="10" aria-hidden="true">
                <circle className="lmc-tl__dot lmc-tl__dot--flagged" cx="5" cy="5" r="2.5" />
              </svg>
              unusual, kept
            </li>
          ) : null}
          {data.realistic ? (
            <li>
              <svg width="16" height="10" aria-hidden="true">
                <rect className="lmc-tl__band" x="1" y="1" width="14" height="8" />
              </svg>
              likely, at your adherence
            </li>
          ) : null}
          {data.asPrescribed ? (
            <li>
              <svg width="16" height="10" aria-hidden="true">
                <rect className="lmc-tl__presc" x="1.5" y="1.5" width="13" height="7" fill="none" />
              </svg>
              as prescribed
            </li>
          ) : null}
          {goal ? (
            <li>
              <svg width="16" height="10" aria-hidden="true">
                <line className="lmc-tl__goal" x1="1" x2="15" y1="5.5" y2="5.5" />
              </svg>
              goal
            </li>
          ) : null}
        </ul>
      ) : null}

      <div
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
                  <>
                    <line className="lmc-lv-tickmark" x1={px0 - 3} x2={px0} y1={y} y2={y} />
                    <text data-mark="y-tick" className="lmc-lv-tick" x={px0 - 5} y={y} textAnchor="end" dominantBaseline="central">
                      {formatNumber(t, dec)}
                    </text>
                  </>
                ) : null}
              </g>
            );
          })}
          {!quiet ? (
            <text data-mark="y-unit" className="lmc-lv-tick" x={px0 - 5} y={py0 - 5} textAnchor="end">
              {unit}
            </text>
          ) : null}
          <line className="lmc-lv-axis" x1={px0} x2={px1} y1={py1 + 0.5} y2={py1 + 0.5} />

          <g clipPath={`url(#${clipId})`}>
            {/* 3 · forecasts */}
            {data.realistic ? <path data-mark="realistic" className="lmc-tl__band" d={bandPath(data.realistic.p10, data.realistic.p90, X, Y)} /> : null}
            {data.realistic?.p50 ? <path data-mark="realistic-p50" className="lmc-tl__p50" d={linePath(data.realistic.p50, X, Y)} /> : null}
            {data.asPrescribed ? (
              <g data-mark="as-prescribed">
                <path className="lmc-tl__presc" d={linePath(data.asPrescribed.p10, X, Y)} />
                <path className="lmc-tl__presc" d={linePath(data.asPrescribed.p90, X, Y)} />
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
            <path data-mark="trend" className="lmc-tl__trend" d={linePath(data.trend, X, Y)} />
          </g>

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

          {/* today: the yellow now-hand with its counterweight (the only yellow) */}
          {now !== null ? (
            <g data-mark="now" className="lmc-tl__now">
              <line x1={now} x2={now} y1={py0 - 2} y2={py1} />
              <circle cx={now} cy={py1} r={3} />
            </g>
          ) : null}

          {/* 8 · crosshair */}
          {xh !== null ? (
            <g data-mark="crosshair">
              <line className="lmc-lv-xhair" x1={xh} x2={xh} y1={py0} y2={py1} />
              {Number.isFinite(xhTrend) ? <circle className="lmc-tl__xdot" cx={xh} cy={Y(xhTrend)} r={4} /> : null}
            </g>
          ) : null}

          {/* x-axis: dates, then the goal-date bracket */}
          {L.xTicks.map((t) => (
            <g key={t.day}>
              <line className="lmc-lv-tickmark" x1={Math.round(t.x) + 0.5} x2={Math.round(t.x) + 0.5} y1={py1 + 1} y2={py1 + 4} />
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
          <thead>
            <tr>
              <th scope="col">date</th>
              <th scope="col">
                weigh-in<small>{unit}</small>
              </th>
              <th scope="col">
                trend<small>{unit}</small>
              </th>
              <th scope="col">
                expected range<small>{unit}</small>
              </th>
              <th scope="col">event</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.day} data-today={r.isToday ? 'true' : undefined}>
                <th scope="row">
                  {r.label}
                  {r.isToday ? <small> · today</small> : null}
                </th>
                <td>
                  {cellText(r.weighIn, data.decimals)}
                  {r.flagged ? <small> unusual, kept</small> : null}
                </td>
                <td>{cellText(r.trend, data.decimals)}</td>
                <td>{rangeText(r.expectedLo, r.expectedHi, data.decimals)}</td>
                <td>{r.event || '—'}</td>
              </tr>
            ))}
          </tbody>
        </TwinTable>
      ) : null}
    </div>
  );
});
