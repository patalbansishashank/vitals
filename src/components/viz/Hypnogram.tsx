/* ==========================================================================
   <Hypnogram> (r064 VIZ, restyled r071): the night on four levels, Awake on
   top, then REM, Light, Deep, as Oura, Apple and Fitbit draw it. Each stage
   run is a flat rounded block (10-12 px) in its stage hue on its level; a
   hairline with rounded elbows steps between levels. A long stretch with no
   stage is one quiet hatched band and the line breaks there; it is never drawn
   as a stage.

   DISPLAY ONLY smoothing (`smoothStages`): Mixed takes its neighbours' stage,
   short holes are bridged, runs under a minimum fold into a neighbour. The
   spoken sentence, the table and the CSV read the RAW spans (Mixed and No
   stage included); any totals beside the chart are the caller's raw
   numbers. The row labels (mono caps, a swatch by each word) are the legend;
   "No stage" joins them only when a long gap is drawn. One tab stop: left
   and right step through the drawn runs.

   r071: `legend` draws the stage totals under the chart (name in mono caps,
   duration in sans, from the RAW totals); `hatch` overlays a 45 degree texture
   per stage (the chartPatterns setting: never colour alone); `sessions` draws
   a night recorded in parts on one shared time axis (the gap between parts is
   the hatched No stage band); the blocks wipe in left to right on first view
   (`animate`, final markup identical).
   ========================================================================== */
import { useCallback, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import { useInView } from '@/app/motion';
import { clockText, durationText, lowerFirst } from './geometry';
import { useWidth } from './hooks';
import { dataKey, smoothStages, stageTimeline, stageTotals, STAGE_SMOOTHING, type RawStageSpan, type StageSpan } from './smooth';
import { TwinKey, TwinTable, toCSV } from './TwinTable';
import './viz.css';

export const HYPNO_STAGES = ['Awake', 'REM', 'Light', 'Deep'] as const;
/**
 * (r069) A stretch the device gave no stage for: minutes no record covers, or a code it did not name. Never "No reading":
 * a sleep stage is not a reading, and the owner found that word meaningless on the night's rows.
 */
export const NO_STAGE = 'No stage';
const STAGE_KEYS = ['awake', 'rem', 'light', 'deep'] as const;
/** The legend's order: by depth, as the prototype reads it (deep first). */
const LEGEND_ORDER = [3, 2, 1, 0] as const;

/** One recording of a night recorded in parts (split sleep): its own window and its own raw spans. */
export interface HypnogramSession {
  from: number;
  to: number;
  segments: readonly RawStageSpan[];
}

export interface HypnogramProps {
  /** "Sleep stages" */
  label: string;
  /** The window drawn (ms). Given with `segments`, or left out when `sessions` is given (then the sessions' extent). */
  from?: number;
  to?: number;
  /** RAW spans: 0 Awake, 1 REM, 2 Light, 3 Deep, 'mixed', or null for no stage (unrecorded or unnamed). */
  segments?: readonly RawStageSpan[];
  /**
   * (r071) A night recorded in parts, drawn on one shared time axis: each part keeps its own raw spans and the stretch
   * between two parts is the hatched No stage band. Wins over `segments`.
   */
  sessions?: ReadonlyArray<HypnogramSession>;
  height?: number;
  quiet?: boolean;
  tz?: string;
  /** Show the "Table" key and its twin (default true). */
  twin?: boolean;
  /** (r068 G07) The chart's name at the start of the key row, beside the Table key (a page can lift that row above the plot). */
  head?: ReactNode;
  /** (r071) The stage totals under the chart: name in mono caps, duration in sans; 2 x 2 on a phone, 4 across from 1024. */
  legend?: boolean;
  /** (r071) A 45 degree texture on the blocks (deep dense, light open, REM mirrored): the chartPatterns setting. */
  hatch?: boolean;
  /** (r071) Wipe the blocks in on first view (default true); false and reduced motion draw the final frame at once. */
  animate?: boolean;
  className?: string;
}

const LEFT = 58;
const RIGHT = 4;
const TOP = 8;
const MIN_BAR_PX = 4;
const EMPTY: readonly RawStageSpan[] = [];

/** The word of a raw state. */
export const rawStageWord = (s: RawStageSpan['state']): string => (s === null ? NO_STAGE : s === 'mixed' ? 'Mixed' : (HYPNO_STAGES[s] ?? 'Unknown'));

/**
 * The window of a night recorded in parts: from the first start to the last end, with every part's raw spans clipped to
 * its own window (a hole inside a part is "no stage"; the stretch between parts is left uncovered, so the timeline
 * fills it as one "no stage" span). Pure.
 */
export function sessionsWindow(sessions: ReadonlyArray<HypnogramSession>): { from: number; to: number; segments: RawStageSpan[] } {
  if (!sessions.length) return { from: 0, to: 0, segments: [] };
  return {
    from: Math.min(...sessions.map((s) => s.from)),
    to: Math.max(...sessions.map((s) => s.to)),
    segments: sessions.flatMap((s) => stageTimeline(s.segments, s.from, s.to)),
  };
}

/**
 * The drawn runs for a plot `plotW` px wide (DISPLAY ONLY): the shortest run is the larger of 4 min and 4 px, so a phone
 * never draws slivers. Pure.
 */
export function hypnoRuns(p: { from: number; to: number; segments: readonly RawStageSpan[] }, plotW: number): StageSpan[] {
  const pxMs = (p.to - p.from) / Math.max(1, plotW);
  return smoothStages(p.segments, { from: p.from, to: p.to, minMs: Math.max(STAGE_SMOOTHING.minMs, MIN_BAR_PX * pxMs) });
}

/**
 * "Sleep stages, 23:02 to 08:44: awake 29 min, REM 1 h 36, light 4 h 15, deep 2 h 11; mixed 6 min; no stage 56 min".
 * From the RAW spans. Quiet: the stages in words, no clock and no figures.
 */
export function spokenHypnogram(p: { label: string; from: number; to: number; segments: readonly RawStageSpan[]; tz?: string; quiet?: boolean }): string {
  const tot = stageTotals(p.segments, p.from, p.to);
  const stages = HYPNO_STAGES.map((w, i) => ({ w: w === 'REM' ? w : lowerFirst(w), min: tot.get(i) ?? 0 })).filter((s) => s.min >= 0.5);
  if (!stages.length) return `${p.label}: no stages recorded`;
  const mixed = tot.get('mixed') ?? 0;
  const none = tot.get('none') ?? 0;
  if (p.quiet) {
    const ws = stages.map((s) => s.w);
    const list = ws.length > 1 ? `${ws.slice(0, -1).join(', ')} and ${ws[ws.length - 1]}` : ws[0]!;
    return `${p.label}: ${list} through the night${none >= 0.5 ? ', with a stretch with no stage' : ''}`;
  }
  const extra = [mixed >= 0.5 ? `mixed ${durationText(mixed)}` : '', none >= 0.5 ? `no stage ${durationText(none)}` : ''].filter(Boolean);
  return `${p.label}, ${clockText(p.from, p.tz)} to ${clockText(p.to, p.tz)}: ${stages.map((s) => `${s.w} ${durationText(s.min)}`).join(', ')}${extra.length ? `; ${extra.join('; ')}` : ''}`;
}

/** Whole-hour ticks from `from` to `to`, every hour, second or third hour so labels sit at least 44 px apart. */
function hourTicks(from: number, to: number, plotW: number, tz?: string): Array<{ t: number; text: string }> {
  const [h, m] = clockText(from, tz).split(':').map(Number) as [number, number];
  const first = from + ((60 - m) % 60) * 60_000 - (from % 60_000);
  const perHour = plotW / Math.max(1, (to - from) / 3_600_000);
  const every = perHour >= 44 ? 1 : perHour >= 22 ? 2 : 3;
  const out: Array<{ t: number; text: string }> = [];
  for (let k = 0, t = first; t <= to; k++, t += 3_600_000) {
    const hh = (h + (m === 0 ? 0 : 1) + k) % 24;
    if (hh % every === 0) out.push({ t, text: `${String(hh).padStart(2, '0')}:00` });
  }
  return out;
}

/** The stepped line through the runs' levels with rounded elbows; it breaks at every gap. */
function stepPath(runs: readonly StageSpan[], X: (t: number) => number, Y: (s: number) => number): string {
  let d = '';
  let open = false;
  for (let i = 0; i < runs.length; i++) {
    const s = runs[i]!;
    if (s.state === null) {
      open = false;
      continue;
    }
    const y = Y(s.state);
    const x0 = X(s.from);
    const x1 = X(s.to);
    const next = runs[i + 1];
    if (!open) {
      d += `M${x0.toFixed(1)},${y.toFixed(1)}`;
      open = true;
    }
    if (next && next.state !== null && next.from === s.to) {
      const y2 = Y(next.state);
      const r = Math.min(5, Math.abs(y2 - y) / 2, (x1 - x0) / 2, (X(next.to) - x1) / 2);
      const dir = y2 > y ? 1 : -1;
      d += `L${(x1 - r).toFixed(1)},${y.toFixed(1)}Q${x1.toFixed(1)},${y.toFixed(1)} ${x1.toFixed(1)},${(y + dir * r).toFixed(1)}`;
      d += `L${x1.toFixed(1)},${(y2 - dir * r).toFixed(1)}Q${x1.toFixed(1)},${y2.toFixed(1)} ${(x1 + r).toFixed(1)},${y2.toFixed(1)}`;
    } else {
      d += `L${x1.toFixed(1)},${y.toFixed(1)}`;
      open = false;
    }
  }
  return d;
}

const encode = (s: RawStageSpan['state']): number => (s === null ? -2 : s === 'mixed' ? -1 : s);

export function Hypnogram(props: HypnogramProps) {
  const { label, height = 132, quiet = false, tz, twin = true, head, legend = false, hatch = false, animate = true, sessions, className } = props;
  const [measureRef, width] = useWidth<HTMLDivElement>(320);
  const revealRef = useRef<HTMLDivElement | null>(null);
  const inView = useInView(revealRef);
  const pending = animate && !inView;
  // one callback ref gives the same root to the width follower and the reveal observer
  const setRoot = useCallback(
    (el: HTMLDivElement | null) => {
      measureRef.current = el;
      revealRef.current = el;
    },
    [measureRef, revealRef],
  );
  const id = useId();
  const [active, setActive] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  // a night in parts is merged once, keyed on its content (callers rebuild the arrays on every render)
  const partsKey = sessions ? dataKey(sessions.flatMap((s) => [s.from, s.to, ...s.segments.flatMap((x) => [x.from, x.to, encode(x.state)])])) : '';
  /* eslint-disable react-hooks/exhaustive-deps */
  const merged = useMemo(() => (sessions ? sessionsWindow(sessions) : null), [partsKey]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const from = props.from ?? merged?.from ?? 0;
  const to = props.to ?? merged?.to ?? 0;
  const segments = merged ? merged.segments : (props.segments ?? EMPTY);
  const plotW = Math.max(40, width - LEFT - RIGHT);
  // smoothing is memoised on the data and the plot width (a night of minute epochs is a few hundred spans)
  // keyed on the content: callers rebuild `segments` from the session on every render
  const key = dataKey(segments.flatMap((s) => [s.from, s.to, encode(s.state)]));
  /* eslint-disable react-hooks/exhaustive-deps */
  const runs = useMemo(() => hypnoRuns({ from, to, segments }, plotW), [from, to, key, plotW]);
  const timeline = useMemo(() => stageTimeline(segments, from, to), [key, from, to]);
  const spoken = useMemo(() => spokenHypnogram({ label, from, to, segments, tz, quiet }), [label, from, to, key, tz, quiet]);
  const totals = useMemo(() => (legend ? stageTotals(segments, from, to) : null), [legend, key, from, to]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const bottom = quiet ? 6 : 20;
  const rowH = (height - TOP - bottom) / 4;
  const barH = Math.max(10, Math.min(12, rowH * 0.5));
  const span = Math.max(1, to - from);
  const X = (t: number) => LEFT + ((t - from) / span) * plotW;
  const Y = (s: number) => TOP + (s + 0.5) * rowH;
  const plotBottom = TOP + 4 * rowH;
  const gaps = runs.filter((s) => s.state === null);
  const drawn = runs;
  const activeRun = active !== null ? drawn[active] : undefined;
  const ticks = quiet ? [] : hourTicks(from, to, plotW, tz);
  const hatchId = `${id}-hatch`;
  const textureId = (stage: number) => `${id}-tex-${STAGE_KEYS[stage]}`;
  const runText = (s: StageSpan) => {
    const w = s.state === null ? NO_STAGE : HYPNO_STAGES[s.state]!;
    return quiet ? w : `${w} ${clockText(s.from, tz)} to ${clockText(s.to, tz)}, ${durationText((s.to - s.from) / 60_000)}`;
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!drawn.length) return;
    const last = drawn.length - 1;
    let next: number;
    if (e.key === 'ArrowRight') next = active === null ? 0 : Math.min(last, active + 1);
    else if (e.key === 'ArrowLeft') next = active === null ? last : Math.max(0, active - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    else if (e.key === 'Escape') {
      setActive(null);
      return;
    } else return;
    e.preventDefault();
    setActive(next);
  };
  const onPointer = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = from + ((e.clientX - r.left - LEFT) / plotW) * span;
    const i = drawn.findIndex((s) => t >= s.from && t < s.to);
    setActive(i >= 0 ? i : null);
  };

  return (
    <div ref={setRoot} className={cx('lmv lmv-hyp', className)} data-reveal={pending ? 'pending' : undefined} data-hatch={hatch || undefined}>
      <div
        className="lmv-hyp__plot"
        role="img"
        aria-label={spoken}
        tabIndex={0}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse') setActive(null);
        }}
      >
        <svg className="lmv-hyp__svg lmc-lv-svg" width={width} height={height} aria-hidden="true">
          <defs>
            <pattern id={hatchId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" className="lmc-lv-hatch" />
            </pattern>
            {hatch ? (
              <>
                <pattern id={textureId(3)} width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <line x1="0" y1="0" x2="0" y2="3" className="lmv-hyp__hatchline" />
                </pattern>
                <pattern id={textureId(2)} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <line x1="0" y1="0" x2="0" y2="6" className="lmv-hyp__hatchline" />
                </pattern>
                <pattern id={textureId(1)} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
                  <line x1="0" y1="0" x2="0" y2="4" className="lmv-hyp__hatchline" />
                </pattern>
              </>
            ) : null}
          </defs>
          {HYPNO_STAGES.map((w, i) => (
            <g key={w} data-row={STAGE_KEYS[i]}>
              <line className="lmv-hyp__guide" x1={LEFT} x2={LEFT + plotW} y1={Math.round(Y(i)) + 0.5} y2={Math.round(Y(i)) + 0.5} />
              <circle className="lmv-hyp__sw" data-stage={STAGE_KEYS[i]} cx={4} cy={Y(i)} r={3} />
              <text className="lmc-lv-tick lmv-hyp__row lm-mono" x={12} y={Y(i)} dominantBaseline="central">
                {w}
              </text>
            </g>
          ))}
          {gaps.map((g, i) => (
            <g key={i} data-mark="gap">
              <rect className="lmv-hyp__gap" x={X(g.from)} y={TOP} width={Math.max(1, X(g.to) - X(g.from))} height={plotBottom - TOP} rx={4} fill={`url(#${hatchId})`} />
            </g>
          ))}
          <path className="lmv-hyp__step" d={stepPath(runs, X, Y)} />
          {runs.map((s, i) => {
            if (s.state === null) return null;
            const x = X(s.from);
            const w = Math.max(1, X(s.to) - x);
            const y = Y(s.state) - barH / 2;
            const rx = Math.min(3.5, w / 2);
            return (
              <g key={i} className="lmv-hyp__run" style={{ '--lmv-t': Math.min(1, Math.max(0, (s.from - from) / span)).toFixed(3) } as CSSProperties}>
                <rect className="lmv-hyp__bar" data-stage={STAGE_KEYS[s.state]} data-active={active === i || undefined} x={x} y={y} width={w} height={barH} rx={rx} />
                {hatch && s.state !== 0 ? <rect className="lmv-hyp__tex" x={x} y={y} width={w} height={barH} rx={rx} fill={`url(#${textureId(s.state)})`} /> : null}
              </g>
            );
          })}
          {activeRun ? (
            <rect className="lmv-hyp__focus" x={X(activeRun.from) - 1.5} y={activeRun.state === null ? TOP - 1.5 : Y(activeRun.state) - barH / 2 - 2.5} width={X(activeRun.to) - X(activeRun.from) + 3} height={activeRun.state === null ? plotBottom - TOP + 3 : barH + 5} rx={activeRun.state === null ? 5 : 4} />
          ) : null}
          {ticks.map((t) => (
            <text key={t.t} className="lmc-lv-tick lmv-hyp__tick lm-mono" x={X(t.t)} y={height - 4} textAnchor="middle">
              {t.text}
            </text>
          ))}
        </svg>
        {activeRun ? (
          <div className="lmv-hyp__tip" style={{ left: `${Math.min(Math.max((X(activeRun.from) + X(activeRun.to)) / 2, 80), width - 80)}px` }} aria-hidden="true">
            {runText(activeRun)}
          </div>
        ) : null}
      </div>
      <span className="lm-sr" aria-live="polite">
        {activeRun ? runText(activeRun) : ''}
      </span>
      {legend ? (
        <ul className="lmv-hyp__legend" aria-hidden="true">
          {LEGEND_ORDER.map((i) => (
            <li key={i}>
              <span className="lmv-hyp__lname lm-mono">
                <i className="lmv-hyp__lsw" data-stage={STAGE_KEYS[i]} />
                {HYPNO_STAGES[i]}
              </span>
              {quiet ? null : <b className="lmv-hyp__lval">{durationText(totals?.get(i) ?? 0)}</b>}
            </li>
          ))}
        </ul>
      ) : null}
      {gaps.length || (twin && !quiet) || head ? (
        <div className="lmv-hyp__foot">
          {head}
          {gaps.length ? (
            <ul className="lmv-legend" aria-label={`${label} key`}>
              <li className="lm-mono">
                <svg className="lmv-legend__sw" width={10} height={10} aria-hidden="true">
                  <rect x={0.5} y={0.5} width={9} height={9} rx={2} className="lmv-hyp__gapsw" fill={`url(#${hatchId})`} />
                </svg>
                {NO_STAGE}
              </li>
            </ul>
          ) : head ? null : (
            <span />
          )}
          {twin && !quiet ? <TwinKey open={table} onToggle={() => setTable((o) => !o)} controls={`${id}-twin`} /> : null}
        </div>
      ) : null}
      {table ? (
        <TwinTable
          id={`${id}-twin`}
          title={`${label} table`}
          caption={spoken}
          rows={timeline.length}
          rowNoun={['span', 'spans']}
          fileName={`vitals-${label.toLowerCase().replace(/\s+/g, '-')}.csv`}
          csv={() => toCSV([['stage', 'from', 'to', 'minutes'], ...timeline.map((s) => [rawStageWord(s.state), clockText(s.from, tz), clockText(s.to, tz), Math.round((s.to - s.from) / 60_000)])])}
        >
          <thead>
            <tr>
              <th scope="col">Stage</th>
              <th scope="col">From</th>
              <th scope="col">To</th>
              <th scope="col">Length</th>
            </tr>
          </thead>
          <tbody>
            {timeline.map((s, i) => (
              <tr key={i}>
                <th scope="row">{rawStageWord(s.state)}</th>
                <td>{clockText(s.from, tz)}</td>
                <td>{clockText(s.to, tz)}</td>
                <td>{durationText((s.to - s.from) / 60_000)}</td>
              </tr>
            ))}
          </tbody>
        </TwinTable>
      ) : null}
    </div>
  );
}
