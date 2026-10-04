/**
 * A day line chart (E29, moved from Progress): heart rate with resting marked, overnight blood oxygen and skin
 * temperature. Breaks at gaps (`runsOf`), never interpolates across missing readings.
 *
 * Body signals additions (ring-pages.md §7.4.4), all optional so the score details keep their look:
 * - `change`: tier C change from the person's normal — values are drawn minus `change.normal` around a 1 px
 *   `--lm-chart-axis` zero line labelled "your normal"; the absolute value appears only in the table.
 * - `band`: the person's normal range behind the line (hue at band alpha).
 * - `interactive`: the plot is one tab stop with a sample crosshair (←/→, ⇧ seven, Home/End, pointer, touch drag)
 *   and a "table" key with the table twin.
 * - `note` replaces the line under the plot; `height` the plot height.
 */
import { memo, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Engraved, Key } from '@/components';
import { formatSigned, THIN_SPACE } from '@/components/lib/format';
import { useElementWidth } from '@/features/charts/core/hooks';
import { useDebouncedText } from '@/features/charts/living/TrendLane';
import { RING_COPY as C } from './copy';
import { HEART_COPY as H } from './copyHeart';
import { SHELL_COPY, TwinTable, useSlotCrosshair } from './kit';
import { clockAt, nf, runsOf, type SeriesPoint } from './ringData';
import './ring.css';
import './heart.css';

export interface DayLineProps {
  points: readonly SeriesPoint[];
  from: number;
  to: number;
  offsetS: number;
  unit: string;
  decimals?: number;
  /** Engraved label above the plot. */
  title: string;
  /** Horizontal reference (resting heart rate). */
  reference?: { value: number; label: string };
  hue: 'cardio' | 'recovery';
  empty: string;
  status?: 'loading' | 'ready' | 'failed';
  /** Change from the person's normal (same unit as the points): drawn as value − normal around a "your normal" line. */
  change?: { normal: number };
  /** The person's normal range as a band (absolute mode). */
  band?: { lo: number; hi: number };
  /** Crosshair + table twin. */
  interactive?: boolean;
  /** Replaces the default line under the plot. */
  note?: string;
  height?: number;
}

export const DayLine = memo(function DayLine({
  points, from, to, offsetS, unit, decimals = 0, title, reference, hue, empty, status = 'ready', change, band, interactive, note, height,
}: DayLineProps) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref, 320) || 320;
  const cross = useSlotCrosshair(points.length, points.length - 1);
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();
  const sel = interactive ? cross.slot : null;
  const signed = (v: number) => formatSigned(v, decimals);
  const shown = (p: SeriesPoint) => (change ? p.v - change.normal : p.v);
  const readout =
    sel !== null && points[sel]
      ? `${clockAt(points[sel]!.t, offsetS)} · ${change ? H.fromNormal(signed(shown(points[sel]!)), unit) : `${nf(points[sel]!.v, decimals)}${THIN_SPACE}${unit}`}`
      : '';
  const live = useDebouncedText(readout);
  const state = status === 'failed' ? C.failed : !points.length ? (status === 'loading' ? C.loading : empty) : null;
  if (state !== null) {
    // the same root element (with the width ref) as the chart, so the width is measured once data arrives; Body
    // signals keeps the chart's title over its state line
    return (
      <div ref={ref} className="lv-ring-day" data-hue={hue} data-state={status === 'failed' ? 'failed' : status}>
        {interactive ? (
          <Engraved as="p" className="lv-ring-title">
            {title}
          </Engraved>
        ) : null}
        <p className="lv-prog-state">{state}</p>
      </div>
    );
  }
  const h = height ?? 160, padL = 40, padR = 8, padT = 10, padB = 22;
  const vals = points.map(shown).concat(reference ? [reference.value] : []).concat(change ? [0] : []).concat(band && !change ? [band.lo, band.hi] : []);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.1;
  lo -= pad; hi += pad;
  const X = (t: number) => padL + ((t - from) / (to - from)) * (width - padL - padR);
  const Y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (h - padT - padB);
  const gaps = points.slice(1).map((p, i) => p.t - points[i]!.t).sort((a, b) => a - b);
  const median = gaps.length ? gaps[Math.floor(gaps.length / 2)]! : 0;
  const runs = runsOf(points, Math.max(3 * median, 20 * 60_000));
  const ticksY = change ? [lo + pad, 0, hi - pad].filter((v, i, a) => a.findIndex((x) => Math.abs(x - v) < (hi - lo) * 0.15) === i) : [lo + pad, (lo + hi) / 2, hi - pad];
  const hourStep = to - from > 16 * 3_600_000 ? 4 : 2;
  const hours: number[] = [];
  const first = Math.ceil((from + offsetS * 1000) / (hourStep * 3_600_000)) * hourStep * 3_600_000 - offsetS * 1000;
  for (let t = first; t <= to; t += hourStep * 3_600_000) hours.push(t);
  const minP = points.reduce((a, b) => (b.v < a.v ? b : a)), maxP = points.reduce((a, b) => (b.v > a.v ? b : a));
  const valueText = (p: SeriesPoint) => (change ? `${signed(shown(p))} ${unit}` : `${nf(p.v, decimals)} ${unit}`);
  const summary = `${title}: ${C.readings(points.length)} from ${clockAt(points[0]!.t, offsetS)} to ${clockAt(points[points.length - 1]!.t, offsetS)}, lowest ${valueText(minP)} at ${clockAt(minP.t, offsetS)}, highest ${valueText(maxP)} at ${clockAt(maxP.t, offsetS)}${change ? `, ${H.tier}` : ''}${reference ? `, ${reference.label}` : ''}.`;
  const defaultNote = change
    ? `${C.readings(points.length)} · ${signed(shown(minP))} to ${signed(shown(maxP))} ${unit}`
    : `${C.readings(points.length)} · ${nf(minP.v, decimals)}–${nf(maxP.v, decimals)} ${unit}`;
  const slotAt = (x: number) => {
    // nearest sample by x
    let best = 0, d = Infinity;
    for (let i = 0; i < points.length; i++) {
      const dx = Math.abs(X(points[i]!.t) - x);
      if (dx < d) { d = dx; best = i; }
    }
    return best;
  };
  const xh = sel !== null && points[sel] ? X(points[sel]!.t) : null;
  return (
    <div ref={ref} className="lv-ring-day" data-hue={hue}>
      <Engraved as="p" className="lv-ring-title">
        {title}
      </Engraved>
      <div
        className="hr-dl-plot"
        {...(interactive
          ? {
              role: 'img',
              'aria-label': summary,
              tabIndex: 0,
              onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => cross.onKeyDown(e),
              onFocus: cross.onFocus,
              onBlur: cross.onBlur,
              onPointerDown: (e: PointerEvent<HTMLDivElement>) => cross.onPointerDown(e),
              onPointerMove: (e: PointerEvent<HTMLDivElement>) => cross.onPointerMove(e, slotAt),
              onPointerUp: (e: PointerEvent<HTMLDivElement>) => cross.onPointerUp(e, slotAt),
              onPointerLeave: (e: PointerEvent<HTMLDivElement>) => cross.onPointerLeave(e),
            }
          : {})}
      >
        <svg
          className="lv-ring-svg"
          width={width}
          height={h}
          viewBox={`0 0 ${width} ${h}`}
          {...(interactive ? { 'aria-hidden': true, focusable: 'false' } : { role: 'img', 'aria-label': summary })}
        >
          {band && !change ? (
            <rect className="hr-dl-band" data-mark="normal" x={padL} y={Y(band.hi)} width={Math.max(0, width - padL - padR)} height={Math.max(1, Y(band.lo) - Y(band.hi))} />
          ) : null}
          {ticksY.map((v) => (
            <g key={v}>
              <line className="lv-ring-grid" x1={padL} x2={width - padR} y1={Y(v)} y2={Y(v)} />
              <text className="lv-ring-tick" x={padL - 4} y={Y(v) + 3} textAnchor="end">
                {change ? (Math.abs(v) < 1e-9 ? '0' : signed(v)) : nf(v, decimals)}
              </text>
            </g>
          ))}
          {change ? (
            <g data-mark="zero">
              <line className="hr-zero" x1={padL} x2={width - padR} y1={Math.round(Y(0)) + 0.5} y2={Math.round(Y(0)) + 0.5} />
              <text className="hr-zero-label hr-halo" x={width - padR - 2} y={Y(0) - 4} textAnchor="end">
                {H.yourNormal}
              </text>
            </g>
          ) : null}
          {reference ? (
            <g className="lv-ring-ref">
              <line x1={padL} x2={width - padR} y1={Y(reference.value)} y2={Y(reference.value)} />
              <text x={width - padR - 2} y={Y(reference.value) - 4} textAnchor="end">
                {reference.label}
              </text>
            </g>
          ) : null}
          {runs.map((r) =>
            r.length > 1 ? (
              <polyline key={r[0]!.t} className="lv-ring-line" points={r.map((p) => `${X(p.t).toFixed(1)},${Y(shown(p)).toFixed(1)}`).join(' ')} />
            ) : (
              <circle key={r[0]!.t} className="lv-ring-dot" cx={X(r[0]!.t)} cy={Y(shown(r[0]!))} r={2.5} />
            ),
          )}
          {hours.map((t) => (
            <text key={t} className="lv-ring-tick" x={X(t)} y={h - 6} textAnchor="middle">
              {clockAt(t, offsetS)}
            </text>
          ))}
          {xh !== null ? (
            <g data-mark="crosshair">
              <line className="sg-crosshair" x1={xh} x2={xh} y1={padT} y2={h - padB} />
              <circle className="hr-dl-xdot" cx={xh} cy={Y(shown(points[sel!]!))} r={4} />
            </g>
          ) : null}
        </svg>
        {interactive && readout && xh !== null ? (
          <div className="hr-tip" data-side={xh > width / 2 ? 'left' : 'right'} style={{ left: xh }} aria-hidden="true">
            {readout}
          </div>
        ) : null}
      </div>
      <p className="lv-ring-note">
        {note ?? defaultNote}
        {runs.length > 1 ? ` · ${C.gapNote}` : ''}
      </p>
      {interactive ? (
        <>
          <div className="hr-dl-tablebar">
            <Key size="sm" variant="quiet" aria-expanded={showTable} aria-controls={tableId} onClick={() => setShowTable((v) => !v)}>
              {showTable ? SHELL_COPY.hideTable : SHELL_COPY.table}
            </Key>
          </div>
          {showTable ? (
            <div id={tableId}>
              <TwinTable
                caption={title}
                head={change ? H.tempTableCols(unit) : H.nightTableCols(unit)}
                rows={points.map((p) => (change ? [clockAt(p.t, offsetS), nf(p.v, decimals), signed(shown(p))] : [clockAt(p.t, offsetS), nf(p.v, decimals)]))}
              />
            </div>
          ) : null}
          <p className="lm-sr" aria-live="polite">
            {live}
          </p>
        </>
      ) : null}
    </div>
  );
});
