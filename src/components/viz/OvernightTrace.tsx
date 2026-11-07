/* ==========================================================================
   <OvernightTrace> (DATAVIZ P6, SPEC A.3.2; r064 VIZ): a night series from
   onset to wake. A smoothed 1.75 px line in the cardio hue (`smoothSeries`:
   bucket medians, a rolling median, a light Gaussian; a monotone cubic
   through them) over a faint interquartile band, broken at every real gap
   and never bridged; no per-reading dots, except dots alone when the night is
   sparse. Three grid lines with labels on the left (r068), five clock labels. The
   low point is a gold dashed time tick with a gold dot where it meets the
   line, labelled "Lowest 49 · 09:55" (the reported lowest bin, not the
   smoothed line's value; Claude UI P3-11). Awake blocks are faint hatched
   columns behind the line. The trend word heads it ("Rising", "Slight
   rise"). role="img" with one sentence from the RAW readings, plus the table
   twin and CSV of the RAW readings. Smoothing is display only.
   ========================================================================== */
import { useId, useMemo, useState } from 'react';
import { cx } from '../lib/cx';
import { formatNumber } from '../lib/format';
import { MQ, useMediaQuery } from '../lib/hooks';
import { clockText, isNum, niceStep } from './geometry';
import { useWidth } from './hooks';
import { bandPath, dataKey, displayDomain, monotonePath, smoothSeries, smoothingFor, type SmoothPoint } from './smooth';
import { TwinKey, TwinTable, toCSV } from './TwinTable';
import './viz.css';

export type TrendWord = 'Steady' | 'Rising' | 'Falling';
export type TrendMagnitude = 'Slight' | 'Moderate' | 'Strong';
export type OvernightTraceState = 'normal' | 'sparse' | 'empty' | 'learning';

export interface TracePoint {
  t: number;
  v: number;
}

export interface OvernightTraceProps {
  /** "Heart rate" */
  label: string;
  /** "bpm" */
  unit: string;
  /** Onset and wake (ms). */
  from: number;
  to: number;
  points: TracePoint[];
  /** The line breaks past this gap; default three usual steps, as DayLine does. */
  gapMs?: number;
  awake?: Array<{ from: number; to: number }>;
  low?: TracePoint | null;
  trend?: { word: TrendWord; magnitude?: TrendMagnitude } | null;
  state?: OvernightTraceState;
  tz?: string;
  quiet?: boolean;
  /** Decimals of the values (0 for heart rate, 1 for skin temperature). */
  decimals?: number;
  /** Show the "Table" key and its twin (default true). */
  twin?: boolean;
  /** (r068 S04) The trend word in the head row (default true); off where the card's caption says it. */
  trendInHead?: boolean;
  /** (r068 S05) The low mark's clock time in its label (default true); off where a fact beside the trace gives the time. */
  lowTime?: boolean;
  className?: string;
}

export const DOTS_AT_MOST = 60;
// (r068 S04) the value labels on the left, as on every other chart
const PAD = { top: 20, right: 6, bottom: 22, left: 30 };

/** Median spacing of consecutive points (ms), 0 with fewer than two. */
export function medianStep(points: readonly TracePoint[]): number {
  const d: number[] = [];
  for (let i = 1; i < points.length; i++) d.push(points[i]!.t - points[i - 1]!.t);
  if (d.length === 0) return 0;
  d.sort((a, b) => a - b);
  return d[Math.floor(d.length / 2)]!;
}

/** Runs of points with no gap over `gapMs` between neighbours. A gap is never bridged. */
export function traceRuns(points: readonly TracePoint[], gapMs: number): TracePoint[][] {
  const runs: TracePoint[][] = [];
  let run: TracePoint[] = [];
  for (const p of points) {
    const prev = run[run.length - 1];
    if (prev && p.t - prev.t > gapMs) {
      runs.push(run);
      run = [];
    }
    run.push(p);
  }
  if (run.length) runs.push(run);
  return runs;
}

/** Three grid values, evenly spaced on a 1 / 2 / 5 step, that cover the data. */
export function traceTicks(lo: number, hi: number): [number, number, number] {
  let step = niceStep(Math.max(hi - lo, 1e-6) / 2);
  for (let guard = 0; guard < 8; guard++) {
    const a = Math.floor(lo / step) * step;
    if (a + 2 * step >= hi - 1e-9) return [a, a + step, a + 2 * step];
    step = niceStep(step * 1.01);
  }
  return [lo, (lo + hi) / 2, hi];
}

export interface TraceModel {
  sparse: boolean;
  empty: boolean;
  runs: TracePoint[][];
  ticks: [number, number, number];
  dots: boolean;
  first: TracePoint | null;
  last: TracePoint | null;
}

export function traceModel(p: Pick<OvernightTraceProps, 'points' | 'gapMs' | 'state' | 'from' | 'to'>): TraceModel {
  const pts = p.points.filter((x) => isNum(x.v) && x.t >= p.from && x.t <= p.to).sort((a, b) => a.t - b.t);
  const empty = p.state === 'empty' || pts.length === 0;
  const sparse = !empty && (p.state === 'sparse' || pts.length < 2);
  const gap = p.gapMs ?? Math.max(1, medianStep(pts) * 3);
  const vs = pts.map((x) => x.v);
  const ticks = empty ? ([0, 1, 2] as [number, number, number]) : traceTicks(Math.min(...vs), Math.max(...vs));
  return {
    sparse,
    empty,
    runs: sparse ? pts.map((x) => [x]) : traceRuns(pts, gap),
    ticks,
    // (r064) the smoothed line carries no per-reading dots; a sparse night is dots alone
    dots: sparse,
    first: pts[0] ?? null,
    last: pts[pts.length - 1] ?? null,
  };
}

/**
 * The drawn line (DISPLAY ONLY): runs of smoothed points for a plot `plotW` px wide. The bucket fits the zoom (about one
 * per 4 px, never finer than the sampling step); the line breaks past `gapMs` (default the wider of three usual steps
 * and 2.5 buckets), so a gap is never bridged. Pure.
 */
export function traceSmooth(p: Pick<OvernightTraceProps, 'points' | 'gapMs' | 'from' | 'to'>, plotW: number): SmoothPoint[][] {
  const pts = p.points.filter((x) => isNum(x.v) && x.t >= p.from && x.t <= p.to).sort((a, b) => a.t - b.t);
  if (pts.length < 2) return [];
  const step = medianStep(pts);
  const o = smoothingFor({ span: p.to - p.from, px: plotW, step });
  return smoothSeries(pts, { bucket: o.bucket, gap: p.gapMs ?? o.gap });
}

const SLOPE: Record<TrendWord, string> = { Steady: 'steady', Rising: 'rising', Falling: 'falling' };
const ADVERB: Record<TrendMagnitude, string> = { Slight: ' slightly', Moderate: '', Strong: ' strongly' };

/** "Slight rise", "Strong fall"; none for Steady. */
export function magnitudeText(t: NonNullable<OvernightTraceProps['trend']>): string | null {
  if (t.word === 'Steady' || !t.magnitude) return null;
  return `${t.magnitude} ${t.word === 'Rising' ? 'rise' : 'fall'}`;
}

/** "rising slightly toward morning", "steady through the night". */
export function trendPhrase(t: NonNullable<OvernightTraceProps['trend']>): string {
  if (t.word === 'Steady') return 'steady through the night';
  return `${SLOPE[t.word]}${t.magnitude ? ADVERB[t.magnitude] : ''} toward morning`;
}

/** "Heart rate overnight, 02:25 to 11:15: starts at 69, lowest of 49 at 09:55, ends at 59, rising slightly toward morning; 96 readings". */
export function spokenTrace(p: Pick<OvernightTraceProps, 'label' | 'from' | 'to' | 'points' | 'low' | 'trend' | 'state' | 'tz' | 'quiet' | 'decimals' | 'gapMs'>): string {
  const m = traceModel(p);
  const head = p.quiet ? `${p.label} overnight` : `${p.label} overnight, ${clockText(p.from, p.tz)} to ${clockText(p.to, p.tz)}`;
  if (m.empty) return `${head}: no night recorded`;
  const n = p.points.length;
  const count = `${n === 1 ? '1 reading' : `${n} readings`}`;
  if (m.sparse) return `${head}: too few readings overnight${p.quiet ? '' : `; ${count}`}`;
  const f = (v: number) => formatNumber(v, p.decimals ?? 0);
  const parts: string[] = [];
  if (!p.quiet && m.first) parts.push(`starts at ${f(m.first.v)}`);
  if (p.low && !p.quiet) parts.push(`lowest of ${f(p.low.v)} at ${clockText(p.low.t, p.tz)}`);
  if (!p.quiet && m.last) parts.push(`ends at ${f(m.last.v)}`);
  if (p.trend) parts.push(trendPhrase(p.trend));
  return `${head}${parts.length ? `: ${parts.join(', ')}` : ''}${p.quiet ? '' : `; ${count}`}`;
}

/**
 * (r068 S04) The x labels: onset and wake at the ends, round hours between (every two hours, every hour on a short
 * night), none within 105 minutes of an end so the labels never crowd on a phone. Pure.
 */
export function overnightClocks(from: number, to: number): number[] {
  const H = 3_600_000;
  const step = to - from > 5 * H ? 2 : 1;
  const d = new Date(from);
  d.setMinutes(0, 0, 0);
  let t = d.getTime() + H;
  const mid: number[] = [];
  for (; t < to; t += H) {
    const hour = new Date(t).getHours();
    if (hour % step === 0 && t - from >= 1.75 * H && to - t >= 1.75 * H) mid.push(t);
  }
  return [from, ...mid, to];
}

export function OvernightTrace(props: OvernightTraceProps) {
  const { label, unit, from, to, points, awake = [], low, trend, state = 'normal', tz, quiet = false, decimals = 0, twin = true, trendInHead = true, lowTime = true, className } = props;
  const [ref, width] = useWidth<HTMLDivElement>(320);
  const md = useMediaQuery(MQ.md);
  const [table, setTable] = useState(false);
  const id = useId();
  const hatch = `${id}-hatch`;
  const m = traceModel(props);
  const H = md ? 180 : 160;
  const plotW = Math.max(200, width) - PAD.right - PAD.left;
  const key = dataKey(points.flatMap((p) => [p.t, p.v]));
  // memoised on the content (callers may rebuild `points` each render)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const smooth = useMemo(() => (m.sparse || m.empty ? [] : traceSmooth({ points, from, to, ...(props.gapMs !== undefined ? { gapMs: props.gapMs } : {}) }, plotW)), [key, from, to, props.gapMs, plotW, m.sparse, m.empty]);
  const W = Math.max(200, width);
  const x0 = PAD.left;
  const x1 = W - PAD.right;
  const y0 = H - PAD.bottom;
  const y1 = PAD.top;
  const span = Math.max(1, to - from);
  // the grid fits the drawn line and its band (a lone spike no longer sets the scale; the table keeps it)
  const dom = smooth.length ? displayDomain(smooth, points.filter((x) => x.t >= from && x.t <= to).map((x) => x.v)) : null;
  const ticks: [number, number, number] = dom ? traceTicks(dom[0], dom[1]) : m.ticks;
  const [tLo, , tHi] = ticks;
  const X = (t: number) => x0 + ((t - from) / span) * (x1 - x0);
  const Y = (v: number) => y0 - ((v - tLo) / Math.max(1e-9, tHi - tLo)) * (y0 - y1);
  const f = (v: number) => formatNumber(v, decimals);
  const spoken = spokenTrace(props);
  const showLow = !m.sparse && !m.empty && low && isNum(low.v);
  const trendShown = trendInHead && !m.sparse && !m.empty && trend;
  const mag = trend ? magnitudeText(trend) : null;
  const clocks = overnightClocks(from, to);
  const lowLabel = showLow ? (quiet ? 'Lowest' : lowTime ? `Lowest ${f(low.v)} · ${clockText(low.t, tz)}` : `Lowest ${f(low.v)}`) : '';
  // (r068 S04) the hatched columns are named: a key in the head row
  const awakeShown = !m.empty && awake.some((a) => Math.min(to, a.to) > Math.max(from, a.from));
  const lowX = showLow ? X(low.t) : 0;
  // the gold dot sits where the low's time meets the smoothed line (the reported value is the label's)
  const lowOnLine = showLow ? smooth.flat().reduce<SmoothPoint | null>((a, q) => (!a || Math.abs(q.t - low.t) < Math.abs(a.t - low.t) ? q : a), null) : null;
  const lowY = lowOnLine ? Y(lowOnLine.v) : showLow ? Y(low.v) : 0;
  const lowAnchor = lowX > x1 - 50 ? 'end' : lowX < x0 + 50 ? 'start' : 'middle';
  return (
    <div ref={ref} className={cx('lmv lmv-trace', className)} data-state={m.empty ? 'empty' : m.sparse ? 'sparse' : state}>
      <div className="lmv-trace__head">
        {trendShown ? (
          <div className="lmv-trace__trend">
            <span className="lmv-trace__word">{trend.word}</span>
            {mag ? <span className="lmv-trace__mag">{mag}</span> : null}
          </div>
        ) : m.sparse ? (
          <div className="lmv-trace__trend">
            <span className="lmv-trace__note">Too few readings overnight</span>
          </div>
        ) : awakeShown ? null : (
          <span />
        )}
        {awakeShown ? (
          <span className="lmv-trace__key" aria-hidden="true">
            <svg width="12" height="12">
              <rect x="0.5" y="0.5" width="11" height="11" rx="2" className="lmv-trace__awake" fill={`url(#${hatch})`} />
            </svg>
            Awake
          </span>
        ) : null}
        {twin && !m.empty && !quiet ? <TwinKey open={table} onToggle={() => setTable((o) => !o)} controls={`${id}-twin`} /> : null}
      </div>
      {m.empty ? (
        <p className="lmv-empty" role="img" aria-label={spoken}>
          No night recorded
        </p>
      ) : (
        <svg className="lmv-trace__svg lmc-lv-svg" width="100%" height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={spoken}>
          <defs>
            <pattern id={hatch} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" className="lmc-lv-hatch" />
            </pattern>
          </defs>
          {awake.map((a, i) => {
            const ax = X(Math.max(from, a.from));
            const bx = X(Math.min(to, a.to));
            return bx > ax ? <rect key={i} className="lmv-trace__awake" x={ax} y={y1 - 6} width={bx - ax} height={y0 - y1 + 6} fill={`url(#${hatch})`} data-mark="awake" /> : null;
          })}
          {ticks.map((v, i) => (
            <g key={i}>
              <line className="lmc-lv-grid" x1={x0} x2={x1} y1={Math.round(Y(v)) + 0.5} y2={Math.round(Y(v)) + 0.5} />
              {quiet ? null : (
                <text className="lmc-lv-tick" x={x0 - 6} y={Y(v) + 4} textAnchor="end">
                  {f(v)}
                </text>
              )}
            </g>
          ))}
          {smooth.map((run, i) =>
            run.length > 1 ? (
              <path
                key={`b${i}`}
                className="lmv-trace__band"
                d={bandPath(
                  run.map((q) => [X(q.t), Y(q.hi)] as const),
                  run.map((q) => [X(q.t), Y(q.lo)] as const),
                )}
              />
            ) : null,
          )}
          {smooth.map((run, i) =>
            run.length > 1 ? (
              <path key={i} className="lmv-trace__line" d={monotonePath(run.map((q) => [X(q.t), Y(q.v)] as const))} />
            ) : (
              <circle key={i} className="lmv-trace__dot" cx={X(run[0]!.t)} cy={Y(run[0]!.v)} r={2} />
            ),
          )}
          {m.dots ? m.runs.flat().map((p, i) => <circle key={i} className="lmv-trace__dot" data-sparse={m.sparse || undefined} cx={X(p.t)} cy={Y(p.v)} r={2.5} />) : null}
          {showLow ? (
            <g data-mark="low">
              <line className="lmv-trace__lowtick" x1={lowX} x2={lowX} y1={y1 - 4} y2={y0} />
              <circle className="lmv-trace__low" cx={lowX} cy={lowY} r={4.5} />
              <text className="lmc-lv-eng lmc-lv-halo lmv-trace__lowtext" x={lowX} y={y1 - 8} textAnchor={lowAnchor}>
                {lowLabel}
              </text>
            </g>
          ) : null}
          {clocks.map((t, i) => (
            <text key={i} className="lmc-lv-tick" x={X(t)} y={H - 4} textAnchor={i === 0 ? 'start' : i === clocks.length - 1 ? 'end' : 'middle'}>
              {quiet ? (i === 0 ? 'Onset' : i === clocks.length - 1 ? 'Wake' : '') : clockText(t, tz)}
            </text>
          ))}
        </svg>
      )}
      {table && !m.empty ? (
        <TwinTable
          id={`${id}-twin`}
          title={`${label} overnight table`}
          caption={spoken}
          rows={points.length}
          rowNoun={['reading', 'readings']}
          fileName={`vitals-${label.toLowerCase().replace(/\s+/g, '-')}-overnight.csv`}
          csv={() => toCSV([['time', `${label} (${unit})`], ...points.map((p) => [clockText(p.t, tz), f(p.v)])])}
        >
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">
                {label}
                <small>{unit}</small>
              </th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.t} data-today={low && p.t === low.t ? 'true' : undefined}>
                <th scope="row">{clockText(p.t, tz)}</th>
                <td>{f(p.v)}</td>
              </tr>
            ))}
          </tbody>
        </TwinTable>
      ) : null}
    </div>
  );
}
