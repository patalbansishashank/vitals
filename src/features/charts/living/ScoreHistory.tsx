/* ==========================================================================
   <ScoreHistory> (CHART_SPEC §7.10) — a body-signal score over time: nightly
   values as faint dots, the 7-day mean as a smooth 2 px line in the category
   hue (ivory on a card with a glow) ending in a glowing dot, the personal
   normal range as an achromatic band (a reference, never a hue), version
   changes as engraved vertical lines ("v1.3 from 20 Oct"), a new device as a
   dashed join of the mean line with an engraved mark, and an optional dashed
   "compare with v1.2" line. With no normal range the soft area runs under the
   mean. Printed y ticks over a dotted dim grid; the plot is one tab stop with
   a summary; a "Table" key toggles the table twin (a card hosts
   `scoreTwin(data)` in its (i) instead and passes `tableKey={false}`).
   Vendor values never share this axis.
   ========================================================================== */
import { memo, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Engraved, TwinKey, useReveal } from '@/components';
import { useElementWidth } from '../core/hooks';
import { decimalsForStep, formatNumber } from '../lib/format';
import { EndDot, SkinGradients, usePulseAfterReveal } from './skin';
import {
  bandPath,
  cellText,
  lastMeanDay,
  placeLabels,
  rangeText,
  scoreLayout,
  scorePointParts,
  scoreSummary,
  scoreTableCSV,
  scoreTableRows,
  smoothAreaPath,
  smoothLinePath,
  smoothLinePathWithBreaks,
} from './trend';
import { TwinTable, useDayCrosshair, useDebouncedText } from './TrendLane';
import type { ScoreHistoryData } from './types';
import './living-charts.css';

export interface ScoreHistoryProps {
  data: ScoreHistoryData;
  /** Default 200 (160 under 640 px wide). */
  height?: number;
  /** Metric name for the summary and the table ("Heart-rate variability"). */
  label?: string;
  /** A short label above the plot, sentence case ("HRV status · last 8 weeks"). */
  title?: string;
  /** (r068 SC3) The series key above the plot (default true). Off where one key serves a grid of charts. */
  legend?: boolean;
  /** (r068 G07) The chart's own name in its head row, before the key and beside the Table key. */
  lead?: ReactNode;
  /** (r068 final) The chart's own Table key (default true). Off in a grid of charts where one Table serves the section. */
  tableKey?: boolean;
  /** The end dot pulses twice after the first view (default off: only a hero chart pulses). */
  pulse?: boolean;
  /** False renders the final frame at once (no first-view wipe, no pulse). */
  animate?: boolean;
  className?: string;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const HUE: Record<ScoreHistoryData['category'], string> = {
  recovery: 'var(--lm-cat-recovery)',
  performance: 'var(--lm-cat-performance)',
  cardio: 'var(--lm-cat-cardio)',
};

export const ScoreHistory = memo(function ScoreHistory({ data, height, label = 'Score', title, legend = true, lead, tableKey = true, pulse = false, animate = true, className }: ScoreHistoryProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(rootRef) || 640;
  const L = useMemo(() => scoreLayout(data, width, { height }), [data, width, height]);
  const summary = useMemo(() => scoreSummary(data, label), [data, label]);
  const [showTable, setShowTable] = useState(false);
  const rows = useMemo(() => (showTable ? scoreTableRows(data) : []), [showTable, data]);
  const last = lastMeanDay(data);
  const cross = useDayCrosshair(data.days, last >= 0 ? last : data.days - 1);
  const point = cross.day !== null ? scorePointParts(data, cross.day) : null;
  const announce = useDebouncedText(point ? `${point.date}: ${point.parts.join(', ')}` : '');
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const { X, Y, px0, px1, py0, py1 } = L;
  const hue = HUE[data.category];
  const dec = decimalsForStep(L.ticks.step);
  const [revealRef, pending] = useReveal<HTMLDivElement>({ animate });
  const pulsing = usePulseAfterReveal(pending, pulse, animate);
  const breaks = (data.deviceChanges ?? []).map((d) => d.day).filter((d) => d > 0 && d < data.days);
  const mean = smoothLinePathWithBreaks(data.mean7, breaks, X, Y);
  const areaD = !data.normal ? smoothAreaPath(data.mean7, X, Y, py1) : '';
  const end = last >= 0 ? { x: X(last), y: Y(data.mean7[last]!) } : null;
  const marks = (list: Array<{ day: number; label: string }> = []) =>
    list.filter((v) => v.day >= 0 && v.day < data.days).map((v) => ({ ...v, x: Math.round(X(v.day)) + 0.5 }));
  const versions = marks(data.versions);
  const devices = marks(data.deviceChanges);
  const vPlaced = placeLabels(
    versions.map((v) => ({ x: v.x, text: v.label })),
    px0 + 2,
    px1 + 6,
  );
  const dPlaced = placeLabels(
    devices.map((v) => ({ x: v.x, text: v.label })),
    px0 + 2,
    px1 + 6,
  );
  const xh = cross.day !== null ? X(cross.day) : null;
  const xhMean = cross.day !== null ? (data.mean7[cross.day] ?? NaN) : NaN;
  const clipId = `${uid}-clip`;
  const xhairId = `${uid}-xh`;
  const tableId = `${uid}-table`;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (tableKey && (e.key === 't' || e.key === 'T') && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      setShowTable((s) => !s);
      return;
    }
    cross.onKeyDown(e);
  };

  return (
    <div ref={rootRef} className={['lmc-sh', 'lmc-skin', className].filter(Boolean).join(' ')} data-reveal={pending ? 'pending' : undefined} style={{ '--lmc-sh-hue': hue } as CSSProperties}>
      <div className="lmc-tl__head">
        <div className="lmc-tl__lead">
          {lead}
          {title ? (
            <Engraved as="p" className="lmc-tl__title">
              {title}
            </Engraved>
          ) : null}
          {legend ? (
          <ul className="lmc-lv-legend" data-inline="true">
            <li>
              <svg width="16" height="10" aria-hidden="true">
                <line className="lmc-sh__mean" x1="1" x2="15" y1="5" y2="5" />
              </svg>
              7-day mean
            </li>
            <li>
              <svg width="10" height="10" aria-hidden="true">
                <circle className="lmc-sh__night" cx="5" cy="5" r="2" />
              </svg>
              {cap(data.point?.many ?? 'nights')}
            </li>
            {data.normal ? (
              <li>
                <svg width="16" height="10" aria-hidden="true">
                  <rect className="lmc-sh__normal" x="1" y="1" width="14" height="8" />
                </svg>
                Your normal range
              </li>
            ) : null}
            {data.compare ? (
              <li>
                <svg width="16" height="10" aria-hidden="true">
                  <line className="lmc-sh__compare" x1="1" x2="15" y1="5" y2="5" />
                </svg>
                {data.compare.label}
              </li>
            ) : null}
          </ul>
          ) : null}
        </div>
        {/* (r068 G07 / final) the one Table key of every chart: the outlined TwinKey every other card uses */}
        {tableKey ? <TwinKey open={showTable} controls={tableId} onToggle={() => setShowTable((s) => !s)} /> : null}
      </div>

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
            <SkinGradients id={uid} />
            <linearGradient id={xhairId} gradientUnits="userSpaceOnUse" x1="0" y1={py0} x2="0" y2={py1}>
              <stop className="lmc-xh lmc-xh--end" offset="0" />
              <stop className="lmc-xh" offset="0.14" />
              <stop className="lmc-xh" offset="0.86" />
              <stop className="lmc-xh lmc-xh--end" offset="1" />
            </linearGradient>
          </defs>
          {L.ticks.ticks.map((t) => {
            const y = Math.round(Y(t)) + 0.5;
            return (
              <g key={t}>
                <line className="lmc-lv-grid" x1={px0} x2={px1} y1={y} y2={y} />
                <line className="lmc-lv-tickmark" x1={px0 - 3} x2={px0} y1={y} y2={y} />
                <text data-mark="y-tick" className="lmc-lv-tick" x={px0 - 5} y={y} textAnchor="end" dominantBaseline="central">
                  {data.format ? data.format.text(t) : formatNumber(t, dec)}
                </text>
              </g>
            );
          })}
          <line className="lmc-lv-axis" x1={px0} x2={px1} y1={py1 + 0.5} y2={py1 + 0.5} />

          <g className="lmc-draw">
            <g clipPath={`url(#${clipId})`}>
              {data.normal ? <path data-mark="normal" className="lmc-sh__normal" d={bandPath(data.normal.lo, data.normal.hi, X, Y)} /> : null}
              {areaD ? <path data-mark="area" className="lmc-sh__area" fill={`url(#${uid}-area)`} d={areaD} /> : null}
              {data.nightly.map((v, i) =>
                Number.isFinite(v) ? <circle key={i} data-mark="night" className="lmc-sh__night" cx={X(i)} cy={Y(v)} r={2} /> : null,
              )}
              {data.compare ? <path data-mark="compare" className="lmc-sh__compare" d={smoothLinePath(data.compare.values, X, Y)} /> : null}
              <path data-mark="mean" className="lmc-sh__mean" d={mean.solid} />
              {mean.joins.map((j, k) => (
                <line key={k} data-mark="device-join" className="lmc-sh__join" x1={j.x1} y1={j.y1} x2={j.x2} y2={j.y2} />
              ))}
            </g>
            {end ? <EndDot x={end.x} y={end.y} r={pulse ? 5 : 4} pulse={pulsing} /> : null}
          </g>

          {versions.map((v, k) => (
            <g key={`v${k}`} data-mark="version">
              <line className="lmc-tl__event" x1={v.x} x2={v.x} y1={py0 - 12} y2={py1} />
              {vPlaced[k]!.show ? (
                <text className="lmc-lv-eng" x={vPlaced[k]!.x} y={py0 - 5} textAnchor={vPlaced[k]!.anchor}>
                  {v.label}
                </text>
              ) : null}
            </g>
          ))}
          {devices.map((d, k) => (
            <g key={`d${k}`} data-mark="device">
              <line className="lmc-tl__event" x1={d.x} x2={d.x} y1={py1 - 6} y2={py1} />
              {dPlaced[k]!.show ? (
                <text className="lmc-lv-eng lmc-lv-halo" x={dPlaced[k]!.x} y={py1 - 4} textAnchor={dPlaced[k]!.anchor}>
                  {d.label}
                </text>
              ) : null}
            </g>
          ))}

          {xh !== null ? (
            <g data-mark="crosshair">
              <line className="lmc-sh__xhair" x1={xh} x2={xh} y1={py0} y2={py1} stroke={`url(#${xhairId})`} />
              {Number.isFinite(xhMean) ? (
                <>
                  <circle className="lmc-sh__xhalo" cx={xh} cy={Y(xhMean)} r={10} />
                  <circle className="lmc-sh__xdot" cx={xh} cy={Y(xhMean)} r={4} />
                </>
              ) : null}
            </g>
          ) : null}

          {L.xTicks.map((t) => (
            <g key={t.day}>
              {/* (r068) no x tick marks: they ran into the top of their date labels */}
              <text data-mark="x-tick" className="lmc-lv-tick" x={t.x} y={L.xRowY} textAnchor={t.anchor}>
                {t.label}
              </text>
            </g>
          ))}
        </svg>
        {point && xh !== null ? (
          <div className="lmc-lv-tip" data-side={xh > width / 2 ? 'left' : 'right'} style={{ left: xh }} aria-hidden="true">
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

      {showTable ? (
        <TwinTable
          id={tableId}
          title={`${label} table`}
          caption={`${label} by ${data.point?.one ?? 'night'}: the ${data.point?.one ?? 'night'}'s value, the 7-day mean, your normal range, and notes.`}
          rows={rows.length}
          fileName="score-history.csv"
          csv={() => scoreTableCSV(rows, data)}
        >
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">
                {cap(data.point?.one ?? 'night')}
                <small>{data.unit}</small>
              </th>
              <th scope="col">
                7-day mean<small>{data.unit}</small>
              </th>
              <th scope="col">
                Normal range<small>{data.unit}</small>
              </th>
              {data.compare ? (
                <th scope="col">
                  {data.compare.label}
                  <small>{data.unit}</small>
                </th>
              ) : null}
              <th scope="col">Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.day}>
                <th scope="row">{r.label}</th>
                <td>{cellText(r.night, data.decimals, data.format?.text)}</td>
                <td>{cellText(r.mean, data.decimals, data.format?.text)}</td>
                <td>{rangeText(r.normalLo, r.normalHi, data.decimals, data.format?.text)}</td>
                {data.compare ? <td>{cellText(r.compare, data.decimals, data.format?.text)}</td> : null}
                <td>{r.note || '—'}</td>
              </tr>
            ))}
          </tbody>
        </TwinTable>
      ) : null}
    </div>
  );
});
