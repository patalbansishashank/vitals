/* ==========================================================================
   <ScoreHistory> (CHART_SPEC §7.10) — a body-signal score over time: nightly
   values as faint dots, the 7-day mean as a 2 px line in the category hue,
   the personal normal range as an achromatic band, version changes as
   engraved vertical lines ("v1.3 from 20 Oct"), a new device as a dashed
   join of the mean line with an engraved mark, and an optional dashed
   "compare with v1.2" line. Printed y ticks; the plot is one tab stop with a
   summary; a "table" key toggles the table twin. Vendor values never share
   this axis.
   ========================================================================== */
import { memo, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Engraved, Key } from '@/components';
import { useElementWidth } from '../core/hooks';
import { decimalsForStep, formatNumber } from '../lib/format';
import {
  bandPath,
  cellText,
  lastMeanDay,
  linePath,
  linePathWithBreaks,
  placeLabels,
  rangeText,
  scoreLayout,
  scorePointParts,
  scoreSummary,
  scoreTableCSV,
  scoreTableRows,
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
  /** Engraved label above the plot, lowercase ("hrv status · last 8 weeks"). */
  title?: string;
  className?: string;
}

const HUE: Record<ScoreHistoryData['category'], string> = {
  recovery: 'var(--lm-cat-recovery)',
  performance: 'var(--lm-cat-performance)',
  cardio: 'var(--lm-cat-cardio)',
};

export const ScoreHistory = memo(function ScoreHistory({ data, height, label = 'Score', title, className }: ScoreHistoryProps) {
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
  const breaks = (data.deviceChanges ?? []).map((d) => d.day).filter((d) => d > 0 && d < data.days);
  const mean = linePathWithBreaks(data.mean7, breaks, X, Y);
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
  const tableId = `${uid}-table`;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.key === 't' || e.key === 'T') && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      setShowTable((s) => !s);
      return;
    }
    cross.onKeyDown(e);
  };

  return (
    <div ref={rootRef} className={['lmc-sh', className].filter(Boolean).join(' ')} style={{ '--lmc-sh-hue': hue } as CSSProperties}>
      <div className="lmc-tl__head">
        <div className="lmc-tl__lead">
          {title ? (
            <Engraved as="p" className="lmc-tl__title">
              {title}
            </Engraved>
          ) : null}
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
              nights
            </li>
            {data.normal ? (
              <li>
                <svg width="16" height="10" aria-hidden="true">
                  <rect className="lmc-sh__normal" x="1" y="1" width="14" height="8" />
                </svg>
                your normal range
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
        </div>
        <Key size="sm" variant="quiet" pressed={showTable} aria-controls={showTable ? tableId : undefined} onClick={() => setShowTable((s) => !s)}>
          table
        </Key>
      </div>

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
          </defs>
          {L.ticks.ticks.map((t) => {
            const y = Math.round(Y(t)) + 0.5;
            return (
              <g key={t}>
                <line className="lmc-lv-grid" x1={px0} x2={px1} y1={y} y2={y} />
                <line className="lmc-lv-tickmark" x1={px0 - 3} x2={px0} y1={y} y2={y} />
                <text data-mark="y-tick" className="lmc-lv-tick" x={px0 - 5} y={y} textAnchor="end" dominantBaseline="central">
                  {formatNumber(t, dec)}
                </text>
              </g>
            );
          })}
          <text className="lmc-lv-tick" x={px0 - 5} y={py0 - 5} textAnchor="end">
            {data.unit}
          </text>
          <line className="lmc-lv-axis" x1={px0} x2={px1} y1={py1 + 0.5} y2={py1 + 0.5} />

          <g clipPath={`url(#${clipId})`}>
            {data.normal ? <path data-mark="normal" className="lmc-sh__normal" d={bandPath(data.normal.lo, data.normal.hi, X, Y)} /> : null}
            {data.nightly.map((v, i) =>
              Number.isFinite(v) ? <circle key={i} data-mark="night" className="lmc-sh__night" cx={X(i)} cy={Y(v)} r={2} /> : null,
            )}
            {data.compare ? <path data-mark="compare" className="lmc-sh__compare" d={linePath(data.compare.values, X, Y)} /> : null}
            <path data-mark="mean" className="lmc-sh__mean" d={mean.solid} />
            {mean.joins.map((j, k) => (
              <line key={k} data-mark="device-join" className="lmc-sh__join" x1={j.x1} y1={j.y1} x2={j.x2} y2={j.y2} />
            ))}
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
              <line className="lmc-lv-xhair" x1={xh} x2={xh} y1={py0} y2={py1} />
              {Number.isFinite(xhMean) ? <circle className="lmc-sh__xdot" cx={xh} cy={Y(xhMean)} r={4} /> : null}
            </g>
          ) : null}

          {L.xTicks.map((t) => (
            <g key={t.day}>
              <line className="lmc-lv-tickmark" x1={Math.round(t.x) + 0.5} x2={Math.round(t.x) + 0.5} y1={py1 + 1} y2={py1 + 4} />
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
          caption={`${label} by night: the night's value, the 7-day mean, your normal range, and notes.`}
          rows={rows.length}
          fileName="score-history.csv"
          csv={() => scoreTableCSV(rows, data)}
        >
          <thead>
            <tr>
              <th scope="col">date</th>
              <th scope="col">
                night<small>{data.unit}</small>
              </th>
              <th scope="col">
                7-day mean<small>{data.unit}</small>
              </th>
              <th scope="col">
                normal range<small>{data.unit}</small>
              </th>
              {data.compare ? (
                <th scope="col">
                  {data.compare.label}
                  <small>{data.unit}</small>
                </th>
              ) : null}
              <th scope="col">note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.day}>
                <th scope="row">{r.label}</th>
                <td>{cellText(r.night, data.decimals)}</td>
                <td>{cellText(r.mean, data.decimals)}</td>
                <td>{rangeText(r.normalLo, r.normalHi, data.decimals)}</td>
                {data.compare ? <td>{cellText(r.compare, data.decimals)}</td> : null}
                <td>{r.note || '—'}</td>
              </tr>
            ))}
          </tbody>
        </TwinTable>
      ) : null}
    </div>
  );
});
