/* ==========================================================================
   <StateStrip> (DATAVIZ P5, SPEC A.3.2, restyled r071): states over a day or a
   span on one pill track. Segments sit 2 px apart, never narrower than 3 px; tiny
   neighbours merge into one "Mixed". Ordinal states take the --lm-state-1..4
   ramp (from the recovery hue), the top one also hatched at 45°; category
   mode is Today's day (eating window, fast, sessions, sleep). A span with
   no reading is a dotted outline, never filled and never bridged; the
   future is the bare well; now is a 2 px tick. One tab stop: left
   and right step through the segments and read each.

   r071: `hue` gives the ordinal ramp four lightness steps of a domain hue
   (the default ramp is unchanged); `stateHues` gives each category its
   domain; `labels` says the state word inside every segment wide enough for
   it (a taller 24 px track; the legend shrinks to the states no word fits in,
   so nothing is ever colour alone); the strip
   wipes in on first view and the now tick pulses twice, then stops
   (`animate`; final markup identical); the legend is mono caps.
   ========================================================================== */
import { useCallback, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { cx } from '../lib/cx';
import { useInView } from '@/app/motion';
import type { Domain } from '../domain';
import { clockText, durationText, isNum, lowerFirst } from './geometry';
import { useWidth } from './hooks';
import { TwinKey, TwinTable, toCSV } from './TwinTable';
import './viz.css';

export interface StateSegment {
  from: number;
  to: number;
  /** Index into `stateLabels`; null is "no reading". */
  state: number | null;
  /** Spoken and tooltip words, when the state word is not enough. */
  text?: string;
}

export interface StateStripProps {
  label: string;
  from: number;
  to: number;
  now?: number | null;
  segments: StateSegment[];
  /** At most 6. Ordinal states use --lm-state-1..4, the top one hatched. */
  stateLabels: string[];
  ticks?: 'day' | 'span';
  /** "2 h 25 min elevated or high" */
  summary?: string;
  mode?: 'ordinal' | 'category';
  state?: 'normal' | 'loading';
  quiet?: boolean;
  tz?: string;
  /** Show the "Table" key and its twin (default true). */
  twin?: boolean;
  /** (r071) Ordinal mode: the ramp is four lightness steps of this domain hue (stress recovery, zones heart). Default: the dusk ramp. */
  hue?: Domain;
  /** (r071) Category mode: the domain each state wears, by state index (Today: sleep, fast = energy, eating = food, training = steps). */
  stateHues?: ReadonlyArray<Domain | undefined>;
  /** (r071) The state word inside every segment wide enough for it, on a taller track; the legend lists only the states no word fits in. */
  labels?: boolean;
  /** (r071) Wipe in on first view and pulse the now tick twice (default true); false and reduced motion draw the final frame. */
  animate?: boolean;
  className?: string;
}

export const MIN_SEG_PX = 3;
export const SEG_GAP_PX = 2;
export const MAX_STATES = 6;
const MIXED = -1;

export type DrawnKind = 'state' | 'none' | 'mixed';

export interface DrawnSegment {
  kind: DrawnKind;
  state: number | null;
  from: number;
  to: number;
  x: number;
  w: number;
  text?: string;
  /** Category mode: after now, the plan rather than what happened. */
  planned?: boolean;
}

/** The ramp step (1..4) of ordinal state `i` of `n`. */
export const rampStep = (i: number, n: number): number => (n <= 1 ? 1 : Math.round((i / (n - 1)) * 3) + 1);

/**
 * Clipped, sorted segments with "no reading" filling every uncovered span up to now. Pure. Ordinal states stop at now;
 * category mode (a plan day) runs to the end, and its parts after now are `planned` (gaps there stay the bare track).
 * Segments do not overlap: one that starts inside an earlier one loses the overlap.
 */
export function stateTimeline(p: Pick<StateStripProps, 'from' | 'to' | 'now' | 'segments' | 'mode'>): Array<StateSegment & { planned?: boolean }> {
  const nowAt = isNum(p.now) ? Math.min(p.to, Math.max(p.from, p.now)) : p.to;
  const category = p.mode === 'category';
  const end = category ? p.to : nowAt;
  const segs = p.segments
    .map((s) => ({ ...s, from: Math.max(p.from, s.from), to: Math.min(end, s.to) }))
    .filter((s) => s.to > s.from)
    .sort((a, b) => a.from - b.from);
  const out: Array<StateSegment & { planned?: boolean }> = [];
  let cur = p.from;
  const push = (s: StateSegment) => {
    if (category && s.to > nowAt && s.from < nowAt) {
      out.push({ ...s, to: nowAt });
      out.push({ ...s, from: nowAt, planned: true });
    } else out.push(category && s.from >= nowAt ? { ...s, planned: true } : s);
  };
  for (const s of segs) {
    const start = Math.max(s.from, cur);
    if (start > cur && cur < nowAt) out.push({ from: cur, to: Math.min(start, nowAt), state: null });
    if (s.to > start) push({ ...s, from: start });
    cur = Math.max(cur, s.to);
  }
  if (nowAt > cur) out.push({ from: cur, to: nowAt, state: null });
  return out;
}

/** Segments in px for a track `width` wide: tiny neighbours merge into "Mixed", the rest grow to 3 px. Pure. */
export function stateSegments(p: Pick<StateStripProps, 'from' | 'to' | 'now' | 'segments' | 'mode'> & { width: number }): DrawnSegment[] {
  const span = Math.max(1, p.to - p.from);
  const px = (t: number) => ((t - p.from) / span) * p.width;
  const timeline = stateTimeline(p).map<DrawnSegment>((s) => ({
    kind: s.state === null ? 'none' : 'state',
    state: s.state,
    from: s.from,
    to: s.to,
    x: px(s.from),
    w: px(s.to) - px(s.from),
    ...(s.text ? { text: s.text } : {}),
    ...(s.planned ? { planned: true } : {}),
  }));
  const out: DrawnSegment[] = [];
  for (let i = 0; i < timeline.length; i++) {
    const s = timeline[i]!;
    if (s.kind === 'state' && s.w < MIN_SEG_PX) {
      let j = i;
      while (j + 1 < timeline.length && timeline[j + 1]!.kind === 'state' && timeline[j + 1]!.w < MIN_SEG_PX && timeline[j + 1]!.from === timeline[j]!.to) j++;
      if (j > i) {
        const last = timeline[j]!;
        out.push({ kind: 'mixed', state: MIXED, from: s.from, to: last.to, x: s.x, w: Math.max(MIN_SEG_PX, last.x + last.w - s.x) });
        i = j;
        continue;
      }
    }
    out.push(s.w < MIN_SEG_PX ? { ...s, w: MIN_SEG_PX } : s);
  }
  return out;
}

const wordOf = (s: Pick<DrawnSegment, 'kind' | 'state' | 'text'>, labels: readonly string[]): string =>
  s.text ?? (s.kind === 'none' ? 'No reading' : s.kind === 'mixed' ? 'Mixed' : (labels[s.state ?? 0] ?? 'Unknown'));

/** "Elevated 11:15 to 12:40, 85 min". Quiet: the word only. */
export function segmentText(s: Pick<DrawnSegment, 'kind' | 'state' | 'text' | 'from' | 'to'>, labels: readonly string[], tz?: string, quiet = false): string {
  const w = wordOf(s, labels);
  if (quiet) return w;
  return `${w} ${clockText(s.from, tz)} to ${clockText(s.to, tz)}, ${durationText((s.to - s.from) / 60000)}`;
}

/** "Stress today: calm 02:20 to 10:50, elevated 11:15 to 12:40, high 13:00 to 14:10; no readings after 14:10". */
export function spokenStrip(p: Pick<StateStripProps, 'label' | 'from' | 'to' | 'now' | 'segments' | 'stateLabels' | 'tz' | 'quiet' | 'state' | 'mode'>): string {
  if (p.state === 'loading') return `${p.label}: loading`;
  const tl = stateTimeline(p);
  const lastReading = [...tl].reverse().find((s) => s.state !== null);
  if (!lastReading) return `${p.label}: no readings`;
  const body = p.mode === 'category' ? tl.filter((s) => s.state !== null) : tl.filter((s) => s.to <= lastReading.to);
  const words = body.map((s) => {
    const w = s.state === null ? 'no readings' : lowerFirst(s.text ?? p.stateLabels[s.state] ?? 'unknown');
    const planned = 'planned' in s && s.planned ? ', planned' : '';
    return p.quiet ? `${w}${planned}` : `${w} ${clockText(s.from, p.tz)} to ${clockText(s.to, p.tz)}${planned}`;
  });
  const quietWords = p.quiet ? [...new Set(words)] : words;
  const end = isNum(p.now) ? Math.min(p.to, p.now) : p.to;
  const tail = p.mode !== 'category' && lastReading.to < end ? `; no readings after ${p.quiet ? 'that' : clockText(lastReading.to, p.tz)}` : '';
  return `${p.label}: ${quietWords.join(', ')}${tail}`;
}

function Swatch({ fill, hatched = false }: { fill: Record<string, number | boolean | string>; hatched?: boolean }) {
  return (
    <svg className="lmv-legend__sw" width={8} height={8} aria-hidden="true">
      <rect x={0.5} y={0.5} width={7} height={7} rx={1.5} {...fill} />
      {hatched ? <line x1={0} y1={8} x2={8} y2={0} /> : null}
    </svg>
  );
}

/** Where the track sits in the svg: the plain strip is a 10 px pill, a labelled one a 24 px pill with room for words. */
const GEO = {
  plain: { h: 22, y: 6, th: 10, nowY: 2, nowH: 18 },
  labelled: { h: 44, y: 10, th: 24, nowY: 6, nowH: 32 },
} as const;
/** A conservative advance of one mono-caps letter (12 px Geist Mono with its tracking), and the room a word keeps either side. */
const LETTER_PX = 8.2;
const LABEL_PAD_PX = 10;

/** A drawn segment's box in px: its extent less the 2 px gap to each neighbour (none at the track's ends). */
function boxOf(s: Pick<DrawnSegment, 'x' | 'w'>, width: number): { x: number; w: number } {
  const x = s.x + (s.x > 0.5 ? SEG_GAP_PX / 2 : 0);
  const right = s.x + s.w >= width - 0.5 ? 0 : SEG_GAP_PX / 2;
  return { x, w: Math.max(1, s.x + s.w - right - x) };
}
/** Whether a state word fits inside a segment of `w` px with room either side. */
const wordFitsIn = (word: string, w: number): boolean => word !== '' && w - 2 * LABEL_PAD_PX >= word.length * LETTER_PX;

export function StateStrip(props: StateStripProps) {
  const { label, from, to, now, stateLabels, ticks = 'day', summary, mode = 'ordinal', state = 'normal', quiet = false, tz, twin = true, hue, stateHues, labels: showLabels = false, animate = true, className } = props;
  const [measureRef, width] = useWidth<HTMLDivElement>(288);
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
  const labels = stateLabels.slice(0, MAX_STATES);
  const geo = showLabels ? GEO.labelled : GEO.plain;
  const drawn = useMemo(() => (state === 'loading' ? [] : stateSegments({ ...props, width })), [props, width, state]);
  const n = labels.length;
  const spoken = spokenStrip(props);
  const nowX = isNum(now) && now >= from && now <= to ? ((now - from) / Math.max(1, to - from)) * width : null;
  const tickTimes = [0, 0.25, 0.5, 0.75, 1].map((f) => from + f * (to - from));
  const tickText = (t: number, i: number) => (ticks === 'day' ? `${String(i * 6).padStart(2, '0')}:00` : clockText(t, tz));
  const present = [...new Set(drawn.filter((s) => s.kind === 'state').map((s) => s.state!))].sort((a, b) => a - b);
  /** The word a state segment would carry. */
  const wordOfSeg = (s: DrawnSegment) => (s.kind === 'state' ? (labels[s.state ?? 0] ?? s.text ?? '') : '');
  const labelled = (s: DrawnSegment) => showLabels && s.kind === 'state' && wordFitsIn(wordOfSeg(s), boxOf(s, width).w);
  // a labelled strip keeps a key only for what its words do not name: a state no word fit in, then Mixed and No reading
  const keyed = showLabels ? present.filter((st) => !drawn.some((s) => s.kind === 'state' && s.state === st && labelled(s))) : present;
  const hasNone = drawn.some((s) => s.kind === 'none');
  const hasMixed = drawn.some((s) => s.kind === 'mixed');
  /** The domain a category state wears, when the caller named one. */
  const hueOf = (state: number | null): Domain | undefined => (mode === 'category' && state !== null ? stateHues?.[state] : undefined);
  const fillOf = (s: DrawnSegment) =>
    s.kind === 'mixed'
      ? { 'data-mixed': true }
      : mode === 'category'
        ? { 'data-cat': (s.state ?? 0) % 6, ...(hueOf(s.state) ? { 'data-hue': hueOf(s.state)! } : {}) }
        : { 'data-step': rampStep(s.state ?? 0, n), 'data-i': s.state ?? 0 };
  const top = (s: DrawnSegment) => mode === 'ordinal' && s.kind === 'state' && s.state === n - 1 && n > 1;
  const activeSeg = active !== null ? drawn[active] : undefined;
  const lastDrawn = drawn[drawn.length - 1];
  // the bare well is the future (and the whole track while loading); the past shows the card between segments
  const trackFrom = mode === 'category' && nowX !== null ? nowX : lastDrawn ? Math.min(width, lastDrawn.x + lastDrawn.w + SEG_GAP_PX) : 0;
  const timeline = useMemo(() => stateTimeline(props), [props]);
  const hatch = `${id}-hatch`;
  const clip = `${id}-clip`;

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
    const x = e.clientX - r.left;
    const i = drawn.findIndex((s) => x >= s.x - 1 && x <= s.x + s.w + 1);
    setActive(i >= 0 ? i : null);
  };

  return (
    <div
      ref={setRoot}
      className={cx('lmv lmv-strip', className)}
      data-mode={mode}
      data-state={state}
      data-hue={hue}
      data-labels={showLabels || undefined}
      data-reveal={pending ? 'pending' : undefined}
      aria-busy={state === 'loading' || undefined}
    >
      {summary || twin ? (
        <div className="lmv-strip__head">
          {summary ? <span className="lmv-strip__summary">{quiet ? '' : summary}</span> : <span />}
          {twin && state !== 'loading' && !quiet ? <TwinKey open={table} onToggle={() => setTable((o) => !o)} controls={`${id}-twin`} /> : null}
        </div>
      ) : null}
      <div
        className="lmv-strip__plot"
        role="img"
        aria-label={spoken}
        tabIndex={state === 'loading' ? undefined : 0}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse') setActive(null);
        }}
      >
        <svg className="lmv-strip__svg" width={width} height={geo.h} aria-hidden="true">
          <defs>
            <clipPath id={clip}>
              <rect x={0} y={geo.y} width={width} height={geo.th} rx={geo.th / 2} />
            </clipPath>
            <pattern id={hatch} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="4" className="lmv-strip__hatchline" />
            </pattern>
          </defs>
          <g clipPath={`url(#${clip})`}>
            {trackFrom < width ? <rect className="lmv-strip__track" x={trackFrom} y={geo.y} width={width - trackFrom} height={geo.th} /> : null}
            {drawn.map((s, i) => {
              const { x, w } = boxOf(s, width);
              if (s.kind === 'none')
                return <rect key={i} className="lmv-strip__none" x={x + 0.5} y={geo.y + 0.5} width={Math.max(0, w - 1)} height={geo.th - 1} rx={(geo.th - 1) / 2} data-active={active === i || undefined} />;
              const word = wordOfSeg(s);
              const wordFits = labelled(s);
              return (
                <g key={i} data-active={active === i || undefined} data-planned={s.planned || undefined} className="lmv-strip__seg">
                  {/* (r069 U1) a planned stretch is drawn 0.5 px inside its box, so its 1 px edge in the hue sits wholly inside the track */}
                  {s.planned ? <rect x={x + 0.5} y={geo.y + 0.5} width={Math.max(0, w - 1)} height={geo.th - 1} rx={Math.min(geo.th / 2 - 0.5, Math.max(0, w - 1) / 2)} {...fillOf(s)} /> : <rect x={x} y={geo.y} width={w} height={geo.th} {...fillOf(s)} />}
                  {top(s) && !wordFits ? <rect x={x} y={geo.y} width={w} height={geo.th} fill={`url(#${hatch})`} /> : null}
                  {wordFits ? (
                    <text className="lmv-strip__label lm-mono" x={x + w / 2} y={geo.y + geo.th / 2} textAnchor="middle" dominantBaseline="central" {...fillOf(s)}>
                      {word}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </g>
          {activeSeg ? <rect className="lmv-strip__focus" x={activeSeg.x} y={geo.y - 2.5} width={activeSeg.w} height={geo.th + 5} rx={(geo.th + 5) / 2} /> : null}
          {nowX !== null ? <rect className="lmv-strip__now" x={Math.min(width - 2, Math.max(0, nowX - 1))} y={geo.nowY} width={2} height={geo.nowH} rx={1} /> : null}
        </svg>
        {activeSeg ? (
          <div className="lmv-strip__tip" style={{ left: `${Math.min(Math.max(activeSeg.x + activeSeg.w / 2, 70), width - 70)}px` }} aria-hidden="true">
            {segmentText(activeSeg, labels, tz, quiet)}
          </div>
        ) : null}
        {quiet ? null : (
          <div className="lmv-strip__ticks" aria-hidden="true">
            {tickTimes.map((t, i) => (
              <span key={i} className="lm-mono" style={{ left: `${(i / 4) * 100}%` }} data-edge={i === 0 ? 'start' : i === 4 ? 'end' : undefined}>
                {tickText(t, i)}
              </span>
            ))}
          </div>
        )}
      </div>
      <span className="lm-sr" aria-live="polite">
        {activeSeg ? segmentText(activeSeg, labels, tz, quiet) : ''}
      </span>
      {state !== 'loading' && (keyed.length || hasNone || hasMixed) ? (
        <ul className="lmv-legend" aria-label={`${label} states`}>
          {keyed.map((s) => (
            <li key={s} className="lm-mono">
              <Swatch fill={mode === 'category' ? { 'data-cat': s % 6, ...(hueOf(s) ? { 'data-hue': hueOf(s)! } : {}) } : { 'data-step': rampStep(s, n), 'data-i': s }} hatched={mode === 'ordinal' && s === n - 1 && n > 1} />
              {labels[s]}
            </li>
          ))}
          {hasMixed ? (
            <li className="lm-mono">
              <Swatch fill={{ 'data-mixed': true }} />
              Mixed
            </li>
          ) : null}
          {hasNone ? (
            <li className="lm-mono">
              <Swatch fill={{ 'data-none': true }} />
              No reading
            </li>
          ) : null}
        </ul>
      ) : null}
      {table ? (
        <TwinTable
          id={`${id}-twin`}
          title={`${label} table`}
          caption={spoken}
          rows={timeline.length}
          rowNoun={['span', 'spans']}
          fileName={`vitals-${label.toLowerCase().replace(/\s+/g, '-')}.csv`}
          csv={() => toCSV([['state', 'from', 'to', 'minutes'], ...timeline.map((s) => [wordOf({ kind: s.state === null ? 'none' : 'state', state: s.state, ...(s.text ? { text: s.text } : {}) }, labels), clockText(s.from, tz), clockText(s.to, tz), Math.round((s.to - s.from) / 60000)])])}
        >
          <thead>
            <tr>
              <th scope="col">State</th>
              <th scope="col">From</th>
              <th scope="col">To</th>
              <th scope="col">Length</th>
            </tr>
          </thead>
          <tbody>
            {timeline.map((s, i) => (
              <tr key={i}>
                <th scope="row">{wordOf({ kind: s.state === null ? 'none' : 'state', state: s.state, ...(s.text ? { text: s.text } : {}) }, labels)}</th>
                <td>{clockText(s.from, tz)}</td>
                <td>{clockText(s.to, tz)}</td>
                <td>{durationText((s.to - s.from) / 60000)}</td>
              </tr>
            ))}
          </tbody>
        </TwinTable>
      ) : null}
    </div>
  );
}
