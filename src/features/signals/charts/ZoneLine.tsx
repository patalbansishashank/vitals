/**
 * Heart rate as a zone-coloured line (ring-pages.md §7.4.2), over a day (`axis: 'clock'`) or a workout window
 * (`axis: 'minutes'`). A 2 px line split exactly at zone boundaries, broken at gaps (§7.2), spot checks as 8 px dots,
 * resting heart rate as a 1 px ink line, zone boundaries inside the y domain as labelled grid lines, sleep and
 * workouts as context bands behind, the now-hand on today. Crosshair per CHART_SPEC §5.1 (5-minute steps on a day,
 * 1-minute steps on a workout); table twin: time, bpm, zone. No age → a plain cardio line and the "Add your age" line.
 */
import { memo, useMemo, useRef, type ReactNode } from 'react';
import { MQ, useMediaQuery } from '@/components';
import { formatNumber } from '@/components/lib/format';
import { useElementWidth } from '@/features/charts/core/hooks';
import { HEART_COPY as C } from './copyHeart';
import { downsampleFor, hrDayModel, hugDomain, lineSegments, niceTicks } from './heartModels';
import { ChartShell, TwinTable, useChartSizes, useSlotCrosshair } from './kit';
import { clockAt, type SeriesPoint } from './ringData';
import { ZoneBar } from './ZoneBar';
import { timeInZones, zoneLabel, zoneOf, type ZoneModel } from './zones';
import './heart.css';

export interface ZoneLineProps {
  points: readonly SeriesPoint[];
  /** Window [from, to] in ms. */
  from: number;
  to: number;
  /** Seconds east of UTC for clock labels. */
  offsetS: number;
  /** null = no age set: plain cardio line and the "Add your age" line. */
  zones: ZoneModel | null;
  restingBpm?: number;
  /** Spot checks as dots. */
  spots?: readonly SeriesPoint[];
  /** Context bands (asleep, workouts). */
  bands?: ReadonlyArray<{ from: number; to: number; kind: 'sleep' | 'workout'; label: string }>;
  /** x ticks as clock time (day) or minutes from start (workout). */
  axis: 'clock' | 'minutes';
  /** ms of "now" when the window contains it (draws the now-hand, data ends there). */
  now?: number;
  height: number;
  title: string;
  status?: 'loading' | 'ready' | 'failed';
  stale?: boolean;
  onRetry?: () => void;
  emptyLine?: string;
  /** Header readouts resting · lowest · highest · readings (default: on for the clock axis). */
  showReadouts?: boolean;
  /** The time-in-zones bar under the chart, when any zone time > 0 (default: on for the clock axis). */
  showZoneBar?: boolean;
  /** Extra header content (a coverage line). */
  header?: ReactNode;
  /** Extra lines under the chart. */
  footer?: ReactNode;
}

const PAD_R = 4;
const PAD_T = 14;
const PAD_B = 20;
const MIN = 60_000;
const HOUR = 3_600_000;

const bpmText = (v: number) => formatNumber(Math.round(v));

/** Nearest sample to `t` within `tol` ms (binary search over time-sorted samples). */
function nearest(points: readonly SeriesPoint[], t: number, tol: number): SeriesPoint | null {
  if (!points.length) return null;
  let lo = 0, hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.t < t) lo = mid;
    else hi = mid;
  }
  const a = points[lo]!, b = points[hi]!;
  const best = Math.abs(a.t - t) <= Math.abs(b.t - t) ? a : b;
  return Math.abs(best.t - t) <= tol ? best : null;
}

function xTicks(axis: 'clock' | 'minutes', from: number, to: number, offsetS: number, plotW: number, wide: boolean): Array<{ t: number; label: string }> {
  const out: Array<{ t: number; label: string }> = [];
  if (axis === 'clock') {
    const step = (wide ? 2 : 4) * HOUR;
    for (let t = from; t < to - HOUR / 2; t += step) out.push({ t, label: clockAt(t, offsetS).slice(0, 2) });
    out.push({ t: to, label: '24' });
    return out;
  }
  const span = (to - from) / MIN;
  const step = [5, 10, 15, 30, 60].find((s) => span / s + 1 <= Math.max(2, plotW / 36)) ?? 60;
  for (let m = 0; m <= span + 1e-9; m += step) out.push({ t: from + m * MIN, label: String(m) });
  return out;
}

export const ZoneLine = memo(function ZoneLine(props: ZoneLineProps) {
  const { points, from, to, offsetS, zones, restingBpm, spots = [], bands = [], axis, now, height, title, status = 'ready', stale, onRetry, emptyLine } = props;
  const showReadouts = props.showReadouts ?? axis === 'clock';
  const showZoneBar = props.showZoneBar ?? axis === 'clock';
  const wide = useMediaQuery(MQ.md);
  const sizes = useChartSizes();
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref, 320) || 320;
  const nowIn = now !== undefined && now >= from && now < to ? now : undefined;
  const end = nowIn ?? to;

  const model = useMemo(() => hrDayModel(points, { from, to, resting: restingBpm ?? null, ...(nowIn !== undefined ? { now: nowIn } : {}) }), [points, from, to, restingBpm, nowIn]);
  const spotPts = useMemo(() => spots.filter((p) => p.t >= from && p.t <= end && Number.isFinite(p.v)), [spots, from, end]);

  const padL = sizes.tickCol;
  const plotW = Math.max(10, width - padL - PAD_R);
  const plotH = Math.max(20, height - PAD_T - PAD_B);
  const X = (t: number) => padL + ((t - from) / (to - from)) * plotW;
  const [lo, hi] = useMemo(() => hugDomain(model.points.map((p) => p.v), [model.resting, ...spotPts.map((p) => p.v)]), [model, spotPts]);
  const Y = (v: number) => PAD_T + (1 - (v - lo) / (hi - lo)) * plotH;
  const yTicks = niceTicks(lo, hi, 3);

  const drawn = useMemo(() => downsampleFor(model.points, from, to, plotW), [model.points, from, to, plotW]);
  const runs = useMemo(() => lineSegments(drawn, zones, model.gapMs), [drawn, zones, model.gapMs]);
  const minutes = useMemo(() => (zones ? timeInZones(model.points, zones, model.gapMs) : null), [zones, model]);
  const anyZoneTime = !!minutes && minutes.slice(1).some((m) => m > 0);

  // crosshair: 5-minute steps on a day, 1-minute steps on a workout
  const step = axis === 'clock' ? 5 * MIN : MIN;
  const count = Math.max(1, Math.floor((end - from) / step) + 1);
  const lastT = model.points.length ? model.points[model.points.length - 1]!.t : spotPts.length ? spotPts[spotPts.length - 1]!.t : end;
  const cross = useSlotCrosshair(count, Math.max(0, Math.min(count - 1, Math.round((lastT - from) / step))));
  const slotAt = (x: number) => Math.round((((x - padL) / plotW) * (to - from)) / step);
  const at = cross.slot !== null ? from + cross.slot * step : null;
  const tol = Math.max(step, model.gapMs / 2);
  const hitSeries = at !== null ? nearest(model.points, at, tol) : null;
  const hitSpot = at !== null ? nearest(spotPts, at, step) : null;
  const hit = hitSpot && (!hitSeries || Math.abs(hitSpot.t - at!) < Math.abs(hitSeries.t - at!)) ? hitSpot : hitSeries;
  const timeText = (t: number) => (axis === 'clock' ? clockAt(t, offsetS) : `${Math.round((t - from) / MIN)} ${C.minutesFromStart}`);
  const readout =
    at === null
      ? null
      : hit
        ? [timeText(hit.t), C.bpm(bpmText(hit.v)), ...(zones ? [zoneLabel(zoneOf(hit.v, zones))] : []), ...(hit === hitSpot ? [C.spotCheck] : [])].join(' · ')
        : C.at(timeText(at), C.noReading);
  const xh = at === null ? null : X(hit ? hit.t : at);

  const empty = model.points.length === 0 && spotPts.length === 0;
  const summary = empty
    ? C.daySummaryEmpty
    : C.daySummary([
        C.readings(formatNumber(model.readings), model.readings),
        ...(model.points.length ? [`from ${clockAt(model.points[0]!.t, offsetS)} to ${clockAt(lastT, offsetS)}`] : []),
        ...(model.lowest ? [C.lowest(bpmText(model.lowest.v), clockAt(model.lowest.t, offsetS))] : []),
        ...(model.highest ? [C.highest(bpmText(model.highest.v), clockAt(model.highest.t, offsetS))] : []),
        ...(model.resting !== null ? [C.resting(bpmText(model.resting))] : []),
        ...(spotPts.length ? [`${spotPts.length} ${C.spotCheck}${spotPts.length === 1 ? '' : 's'}`] : []),
        ...(anyZoneTime && minutes ? [minutes.slice(1).map((m, i) => (m > 0 ? `zone ${i + 1} ${C.min(m)}` : null)).filter(Boolean).join(', ')] : []),
      ]);

  const readouts = showReadouts
    ? empty
      ? C.noData
      : [
          model.resting !== null ? C.resting(bpmText(model.resting)) : null,
          model.lowest ? C.lowest(bpmText(model.lowest.v), clockAt(model.lowest.t, offsetS)) : null,
          model.highest ? C.highest(bpmText(model.highest.v), clockAt(model.highest.t, offsetS)) : null,
          C.readings(formatNumber(model.readings), model.readings),
        ]
          .filter(Boolean)
          .join(' · ')
    : null;

  const table = useMemo(() => {
    const rows = [
      ...model.points.map((p) => ({ t: p.t, v: p.v, spot: false })),
      ...spotPts.map((p) => ({ t: p.t, v: p.v, spot: true })),
    ].sort((a, b) => a.t - b.t);
    return (
      <TwinTable
        caption={title}
        head={C.dayTableCols}
        rows={rows.map((r) => [
          r.spot ? `${timeText(r.t)} · ${C.spotCheck}` : timeText(r.t),
          bpmText(r.v),
          zones ? zoneLabel(zoneOf(r.v, zones)) : '—',
        ])}
      />
    );
    // timeText depends on axis, from and offsetS only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.points, spotPts, zones, title, axis, from, offsetS]);

  // labels on the right edge: resting wins over a zone boundary that sits too close
  const restY = model.resting !== null ? Y(model.resting) : null;
  const edges = zones
    ? zones.lower
        .map((bpm, i) => ({ zone: i + 1, bpm, y: Y(bpm) }))
        .filter((e) => e.bpm > lo && e.bpm < hi)
        .map((e) => ({ ...e, labelled: restY === null || Math.abs(e.y - restY) >= 12 }))
    : [];
  const right = padL + plotW;
  const ticks = xTicks(axis, from, to, offsetS, plotW, wide);
  const header =
    readouts || props.header ? (
      <>
        {props.header}
        {props.header && readouts ? <br /> : null}
        {readouts ? <span data-readouts="true">{readouts}</span> : null}
      </>
    ) : undefined;
  const footer = (
    <>
      {!zones ? <p className="hr-noage">{C.noAge}</p> : null}
      {showZoneBar && anyZoneTime && minutes ? <ZoneBar minutes={minutes} /> : null}
      {props.footer}
    </>
  );

  return (
    <div ref={ref} className="hr-chart" data-axis={axis}>
      <ChartShell
        title={title}
        header={header}
        summary={summary}
        readout={readout}
        height={height}
        status={status}
        stale={!!stale}
        emptyLine={empty ? (emptyLine ?? C.hrDayEmpty) : null}
        {...(onRetry ? { onRetry } : {})}
        table={empty ? undefined : table}
        footer={footer}
      >
        <div
          className="hr-plot"
          role="img"
          aria-label={summary}
          tabIndex={0}
          onKeyDown={(e) => cross.onKeyDown(e)}
          onFocus={cross.onFocus}
          onBlur={cross.onBlur}
          onPointerDown={(e) => cross.onPointerDown(e)}
          onPointerMove={(e) => cross.onPointerMove(e, slotAt)}
          onPointerUp={(e) => cross.onPointerUp(e, slotAt)}
          onPointerLeave={(e) => cross.onPointerLeave(e)}
        >
          <svg className="sg-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
            {/* 1. context bands */}
            {bands.map((b, i) => {
              const x0 = X(Math.max(from, b.from)), x1 = X(Math.min(to, b.to));
              if (!(x1 > x0)) return null;
              return (
                <g key={`b${i}`} data-band={b.kind}>
                  <rect className="hr-band" data-kind={b.kind} x={x0} y={PAD_T} width={x1 - x0} height={plotH} />
                  {x1 - x0 >= b.label.length * 6 + 6 ? (
                    <text className="hr-band-label" x={x0 + 3} y={PAD_T + 11}>
                      {b.label}
                    </text>
                  ) : null}
                </g>
              );
            })}
            {/* 2. grid, ticks, axis */}
            {yTicks.map((v) => (
              <g key={`y${v}`}>
                <line className="sg-grid" x1={padL} x2={right} y1={Math.round(Y(v)) + 0.5} y2={Math.round(Y(v)) + 0.5} />
                <text className="sg-tick" x={padL - 5} y={Y(v)} textAnchor="end" dominantBaseline="central">
                  {formatNumber(v)}
                </text>
              </g>
            ))}
            <text className="sg-tick" x={padL - 5} y={9} textAnchor="end">
              bpm
            </text>
            {edges.map((e) => (
              <g key={`z${e.zone}`} data-zone-edge={e.zone}>
                <line className="sg-grid" x1={padL} x2={right} y1={Math.round(e.y) + 0.5} y2={Math.round(e.y) + 0.5} />
                {e.labelled ? (
                  <text className="hr-edge-label hr-halo" x={right - 2} y={e.y - 3} textAnchor="end">
                    {C.zoneEdge(e.zone, e.bpm)}
                  </text>
                ) : null}
              </g>
            ))}
            <line className="sg-axis" x1={padL} x2={right} y1={PAD_T + plotH + 0.5} y2={PAD_T + plotH + 0.5} />
            {ticks.map((k) => (
              <text key={`x${k.t}`} className="sg-tick" x={X(k.t)} y={height - 5} textAnchor={k.t === from ? 'start' : k.t >= to ? 'end' : 'middle'}>
                {k.label}
              </text>
            ))}
            {axis === 'minutes' ? (
              <text className="sg-tick" x={padL - 5} y={height - 5} textAnchor="end">
                {C.minutesFromStart}
              </text>
            ) : null}
            {/* 4. resting heart rate */}
            {restY !== null ? (
              <g data-mark="resting">
                <line className="hr-rest" x1={padL} x2={right} y1={Math.round(restY) + 0.5} y2={Math.round(restY) + 0.5} />
                <text className="hr-rest-label hr-halo" x={right - 2} y={restY - 4} textAnchor="end">
                  {C.restingLine(Math.round(model.resting!))}
                </text>
              </g>
            ) : null}
            {/* 5. the line, segmented by zone, broken at gaps */}
            {runs.map((segs, r) =>
              segs.map((s, k) =>
                s.points.length > 1 ? (
                  <polyline
                    key={`r${r}s${k}`}
                    className="hr-line"
                    data-run={r}
                    data-zone={s.zone === null ? 'plain' : s.zone}
                    points={s.points.map((p) => `${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ')}
                  />
                ) : segs.length === 1 ? (
                  <circle key={`r${r}s${k}`} className="hr-mark" data-run={r} data-zone={s.zone === null ? 'plain' : s.zone} cx={X(s.points[0]!.t)} cy={Y(s.points[0]!.v)} r={2} strokeWidth={0} />
                ) : null,
              ),
            )}
            {/* 6. spot checks */}
            {spotPts.map((p) => (
              <circle key={`s${p.t}`} className="hr-mark" data-mark="spot" data-zone={zones ? zoneOf(p.v, zones) : 'plain'} cx={X(p.t)} cy={Y(p.v)} r={4} />
            ))}
            {/* now-hand */}
            {nowIn !== undefined ? <line className="sg-nowhand" data-mark="now" x1={X(nowIn)} x2={X(nowIn)} y1={PAD_T} y2={PAD_T + plotH} /> : null}
            {/* 8. crosshair */}
            {xh !== null ? (
              <g data-mark="crosshair">
                <line className="sg-crosshair" x1={xh} x2={xh} y1={PAD_T} y2={PAD_T + plotH} />
                {hit ? <circle className="hr-mark" data-zone={zones ? zoneOf(hit.v, zones) : 'plain'} cx={xh} cy={Y(hit.v)} r={4} /> : null}
              </g>
            ) : null}
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
});
