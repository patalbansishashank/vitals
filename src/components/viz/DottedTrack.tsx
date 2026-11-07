/* ==========================================================================
   <DottedTrack> (r071, AUDIT §5.2, RESEARCH §4.6): progress toward a goal, one number, as a row of dots with a thumb.
   8 px pitch, 1.7 px dots, lit dots ivory (or the domain's solid when `hue` is given: protein green), the unlit
   remainder --lm-unlit, a 14 px ivory thumb with a 3 px ring in the card's colour. The lit width is snapped to whole
   dots from the measured width (no CSS round()), so it is the same in every engine and in jsdom (fallback 288 px).

   It replaces TickStrip rows and DotFill: eaten kcal and protein, sleep, steps, a plan's day N of M. The name and the
   value text belong to the card's own row ("Protein ... 32 / 150 G"); this draws the dots, and its `valueText` and
   `goalText` are the words of the text alternative.

   Past the goal the fill laps: the first lap stays ivory and a second lap lights again from the start in the ink tint
   (neutral, never rose), and the thumb passes the notch. A `limit` has no celebratory end: its words say "over the
   limit". Null is unknown: no thumb, no fill, and `valueText` says why ("Nothing logged yet"). Quiet drops every digit
   and still fills to the ratio. First view fills the dots left to right (clip-path) and the thumb follows; later changes
   move from the old value to the new.
   ========================================================================== */
import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import { formatNumber } from '../lib/format';
import { useInView } from '@/app/motion';
import type { Domain } from '../domain';
import { MonoMeta } from '../MonoMeta';
import { clamp, goalPhrase, isNum, ratioWord, reachedPhrase, speak, stripOf, type GoalKind } from './geometry';
import { useWidth } from './hooks';
import { InlineTwin, twinFileName, type TwinData } from './twin';
import './viz-base.css';
import './track.css';

export type TrackGoalKind = GoalKind;
export type TrackState = 'normal' | 'provisional' | 'unknown' | 'loading';

export interface TrackMark {
  /** In the track's domain units (plan days 0..84). */
  at: number;
  /** A MonoMeta word under the track. */
  label?: string;
  /** `ink` ivory (default) · `hue` the domain solid · `caution` gold. */
  tone?: 'ink' | 'hue' | 'caution';
}

export interface DottedTrackProps {
  /** The text alternative's name: "Protein". */
  label: string;
  /** Null is unknown, never zero. */
  value: number | null;
  /** The track's end. A `floor` is "at least", a `limit` has no celebratory end. */
  goal?: number | null;
  goalKind?: TrackGoalKind;
  /** The unit, for the words of a band or a planned position ("12 days"). */
  unit?: string;
  /** The visible value: "32 g", "750 kcal". Words for an unknown ("Nothing logged yet"). */
  valueText: string;
  /** The visible goal: "of 150 g", "150 g". */
  goalText?: string;
  /** The domain the track spans (plan days 0..84). Default from 0 to the goal. */
  from?: number;
  to?: number;
  /** Exactly this many dots across the width (default one per 8 px). `ticks.count` is the same. */
  dots?: number;
  /** `majorEvery`: every Nth dot is larger (week marks on a plan track). */
  ticks?: { count?: number; majorEvery?: number };
  /** Knots, plan versions, thresholds: a tick on the track, a MonoMeta word under it. */
  marks?: TrackMark[];
  /** The likely range, in domain units: a faint capsule behind the dots. */
  band?: [number, number];
  /** The planned position, in domain units: a hollow ring on the track. */
  ghost?: number;
  /** "WARM" ... "6500K": MonoMeta under each end. */
  endLabels?: [string, string];
  /** The lit dots wear this domain's solid instead of ivory. The thumb stays ivory. */
  hue?: Domain;
  /** A second tone for the first `valueB` of the value (bought versus at home), drawn from the start. */
  litB?: Domain;
  valueB?: number | null;
  /** The thumb (default true); never drawn for an unknown. */
  thumb?: boolean;
  state?: TrackState;
  /** Quiet mode: no digit in the DOM or aria; the fill still follows the ratio. */
  quiet?: boolean;
  quietWord?: string;
  /** First view fills the dots (default true). False renders the final frame at once. `sweep` is its AUDIT name. */
  animate?: boolean;
  sweep?: boolean;
  /** `true` draws a "Table" key and the table under the track; a node is drawn as given. */
  twin?: boolean | ReactNode;
  className?: string;
}

/** Dot pitch, dot radius, track height and thumb size, in px (RESEARCH §5: --lm-dot-pitch, --lm-dot-r, --lm-thumb). */
export const TRACK_PITCH = 8;
export const TRACK_DOT_R = 1.7;
export const TRACK_H = 16;
/** The second lap's dots are larger, so it reads as more without relying on its tint. */
export const TRACK_LAP_R = 2.5;
export const TRACK_THUMB = 14;
const MIN_PITCH = 4;

/** Dots for a track `width` px wide: one per 8 px (at least 8), or exactly `dots`, never closer than 4 px. */
export function trackColumns(width: number, dots?: number): number {
  if (isNum(dots) && dots >= 2) return Math.max(2, Math.min(Math.round(dots), Math.floor(width / MIN_PITCH)));
  return Math.max(8, Math.floor(width / TRACK_PITCH));
}

export interface TrackMarkModel {
  /** px from the start of the dots. */
  x: number;
  label?: string;
  tone: 'ink' | 'hue' | 'caution';
  /** Where its word aligns, so it never leaves the track. */
  align: 'start' | 'mid' | 'end';
}

export interface TrackModel {
  columns: number;
  pitch: number;
  /** Width of the dots in px (columns × pitch). */
  span: number;
  from: number;
  to: number;
  known: boolean;
  /** (value − from) / (to − from), uncapped; 0 when unknown. */
  ratio: number;
  /** The value is past the end of the track: the second lap is drawn. */
  lapped: boolean;
  litCols: number;
  lapCols: number;
  bCols: number;
  litPx: number;
  lapPx: number;
  bPx: number;
  /** Centre of the thumb, px. */
  thumbPx: number;
  goalX: number | null;
  ghostX: number | null;
  bandX: [number, number] | null;
  marks: TrackMarkModel[];
  majorEvery: number | null;
}

type ModelProps = Pick<DottedTrackProps, 'value' | 'goal' | 'from' | 'to' | 'dots' | 'ticks' | 'valueB' | 'marks' | 'band' | 'ghost' | 'state'>;

/** Pure layout of the dots for a track `width` px wide. The lit width is snapped down to whole dots. */
export function trackModel(p: ModelProps & { width?: number }): TrackModel {
  const width = Math.max(40, p.width ?? 288);
  const requested = p.dots ?? p.ticks?.count;
  const columns = trackColumns(width, requested);
  const pitch = isNum(requested) && requested >= 2 ? width / columns : TRACK_PITCH;
  const span = columns * pitch;
  const goal = isNum(p.goal) && p.goal > 0 ? p.goal : null;
  const from = p.from ?? 0;
  const to = isNum(p.to) && p.to > from ? p.to : (goal ?? (isNum(p.value) ? Math.max(p.value, 1) * 1.25 : from + 1));
  const known = isNum(p.value) && p.state !== 'unknown' && p.state !== 'loading';
  const dom = to - from;
  const ratio = known ? Math.max(0, ((p.value as number) - from) / dom) : 0;
  const lapped = ratio > 1;
  const cols = (r: number) => Math.floor(clamp(r, 0, 1) * columns + 1e-9);
  const litCols = cols(ratio);
  const lapCols = lapped ? cols(ratio - 1) : 0;
  const bCols = known && isNum(p.valueB) ? Math.min(litCols, cols((p.valueB - from) / dom)) : 0;
  // the thumb sits in the slot after the last lit dot; full it rests on the last dot; a second lap puts it on the lap
  const thumbCol = lapped ? Math.min(lapCols, columns - 1) : ratio >= 1 ? columns - 1 : Math.min(litCols, columns - 1);
  const px = (v: number) => clamp((v - from) / dom, 0, 1) * span;
  return {
    columns,
    pitch,
    span,
    from,
    to,
    known,
    ratio,
    lapped,
    litCols,
    lapCols,
    bCols,
    litPx: litCols * pitch,
    lapPx: lapCols * pitch,
    bPx: bCols * pitch,
    thumbPx: (thumbCol + 0.5) * pitch,
    goalX: goal !== null && goal > from ? px(goal) : null,
    ghostX: isNum(p.ghost) ? px(p.ghost) : null,
    bandX: p.band && p.band[1] > p.band[0] ? [px(p.band[0]), px(p.band[1])] : null,
    marks: (p.marks ?? []).map((k) => {
      const x = px(k.at);
      return { x, label: k.label, tone: k.tone ?? 'ink', align: x < 28 ? 'start' : x > span - 28 ? 'end' : 'mid' };
    }),
    majorEvery: p.ticks?.majorEvery && p.ticks.majorEvery > 0 ? Math.round(p.ticks.majorEvery) : null,
  };
}

const at = (p: Pick<DottedTrackProps, 'unit'>, v: number): string => `${formatNumber(v, Number.isInteger(v) ? 0 : 1)}${p.unit ? ` ${p.unit}` : ''}`;

/**
 * "Protein: 32 g, at least 150 g". A goal reached or passed is said plainly ("goal reached", "past the goal", "over the
 * limit" for a limit); the planned position and the likely range follow. Quiet: words only. Unknown: the caller's words
 * ("Nothing logged yet"), or "no value yet" when quiet.
 */
export function spokenTrack(p: ModelProps & Pick<DottedTrackProps, 'label' | 'goalKind' | 'valueText' | 'goalText' | 'quiet' | 'quietWord' | 'unit'>): string {
  const state = p.state ?? 'normal';
  if (state === 'loading') return `${p.label}, loading`;
  const m = trackModel(p);
  if (!m.known) return speak(`${p.label}, ${p.quiet || !p.valueText ? 'no value yet' : p.valueText}`);
  if (p.quiet) return speak(`${p.label}, ${p.quietWord ?? ratioWord(m.ratio)}`);
  const kind = p.goalKind ?? 'target';
  const goal = isNum(p.goal) && p.goal > 0 ? p.goal : null;
  const bits = [p.valueText];
  if (p.goalText) bits.push(goalPhrase(kind, p.goalText));
  const reached = goal ? reachedPhrase(kind, (p.value as number) / goal) : null;
  if (reached) bits.push(reached);
  if (isNum(p.ghost)) bits.push(`planned ${at(p, p.ghost)}`);
  if (p.band && p.band[1] > p.band[0]) bits.push(`likely ${at(p, p.band[0])} to ${at(p, p.band[1])}`);
  if (state === 'provisional') bits.push('provisional');
  return speak(`${p.label}: ${bits.join(', ')}`);
}

/** The table twin of the track: value, goal, share, and the planned position and range when drawn. */
export function trackTwin(p: ModelProps & Pick<DottedTrackProps, 'label' | 'goalKind' | 'valueText' | 'goalText' | 'quiet' | 'quietWord' | 'unit'>): TwinData {
  const m = trackModel(p);
  const kind = p.goalKind ?? 'target';
  const goal = isNum(p.goal) && p.goal > 0 ? p.goal : null;
  const rows: Array<[string, string]> = [['Value', m.known ? p.valueText : (p.valueText || '—')]];
  if (p.goalText) rows.push([kind === 'floor' ? 'At least' : kind === 'limit' ? 'Limit' : 'Goal', stripOf(p.goalText)]);
  if (m.known && goal) rows.push(['Share of goal', `${formatNumber(Math.round(((p.value as number) / goal) * 100))}\u00a0%`]);
  if (isNum(p.ghost)) rows.push(['Planned', at(p, p.ghost)]);
  if (p.band && p.band[1] > p.band[0]) rows.push(['Likely range', `${at(p, p.band[0])} to ${at(p, p.band[1])}`]);
  return { title: `${p.label} table`, caption: spokenTrack(p), head: ['Measure', 'Value'], rows, fileName: twinFileName(p.label), rowNoun: ['row', 'rows'] };
}

const px = (n: number): string => `${Number(n.toFixed(2))}px`;

export function DottedTrack(props: DottedTrackProps) {
  const { label, state = 'normal', quiet = false, hue, litB, thumb = true, animate, sweep, endLabels, twin, className } = props;
  const enabled = animate ?? sweep ?? true;
  const ref = useRef<HTMLDivElement | null>(null);
  const inView = useInView(ref);
  const pending = enabled && !inView;
  const [barRef, width] = useWidth<HTMLDivElement>(288);
  const m = trackModel({ ...props, width });
  const spoken = spokenTrack(props);
  // after the first view, a change moves quicker (CSS reads data-live)
  const [live, setLive] = useState(false);
  if (!pending && !live) setLive(true);

  const loading = state === 'loading';
  const unknown = !loading && !m.known;
  const layer = (name: 'unlit' | 'lit' | 'b' | 'lap', hueName?: Domain) => (
    <svg className="lmz-track__layer" data-layer={name} data-hue={hueName} width={m.span} height={TRACK_H} aria-hidden="true" focusable="false">
      {Array.from({ length: m.columns }, (_, c) => (
        <circle key={c} cx={(c + 0.5) * m.pitch} cy={TRACK_H / 2} r={name === 'lap' ? TRACK_LAP_R : m.majorEvery && c % m.majorEvery === 0 ? 2.6 : TRACK_DOT_R} />
      ))}
    </svg>
  );
  const showFill = m.known && !loading;
  const barStyle = {
    '--span': px(m.span),
    '--lit': px(m.litPx),
    '--lap': px(m.lapPx),
    '--litb': px(m.bPx),
    '--thumb': px(m.thumbPx),
    '--thumb0': px(m.pitch / 2),
  } as CSSProperties;
  const labelled = m.marks.filter((k) => k.label);

  return (
    <div
      ref={ref}
      className={cx('lmz lmz-track', className)}
      data-reveal={pending ? 'pending' : undefined}
      data-live={live || undefined}
      data-hue={hue}
      data-state={state}
      data-kind={props.goalKind ?? 'target'}
      data-over={m.lapped || undefined}
      data-unknown={unknown || undefined}
    >
      <div
        className="lmz-track__meter"
        role="meter"
        aria-label={label}
        // quiet: words only, to assistive technology too
        aria-valuemin={quiet || !showFill ? undefined : m.from}
        aria-valuemax={quiet || !showFill ? undefined : m.to}
        aria-valuenow={quiet || !showFill ? undefined : clamp(props.value as number, m.from, m.to)}
        aria-valuetext={spoken}
        aria-busy={loading || undefined}
      >
        <div ref={barRef} className="lmz-track__bar" style={barStyle}>
          {m.bandX ? <span className="lmz-track__band" style={{ transform: `translateX(${px(m.bandX[0])})`, width: px(m.bandX[1] - m.bandX[0]) }} /> : null}
          {layer('unlit')}
          {showFill ? layer('lit') : null}
          {showFill && m.bCols > 0 ? layer('b', litB) : null}
          {showFill && m.lapped ? layer('lap') : null}
          {m.goalX !== null ? <span className="lmz-track__notch" style={{ transform: `translateX(${px(Math.min(m.goalX, m.span - 1))})` }} /> : null}
          {m.marks.map((k, i) => (
            <span key={i} className="lmz-track__mark" data-tone={k.tone} style={{ transform: `translateX(${px(k.x)})` }} />
          ))}
          {m.ghostX !== null ? <span className="lmz-track__ghost" style={{ transform: `translateX(${px(m.ghostX)})` }} /> : null}
          {thumb && showFill ? <span className="lmz-track__thumb" /> : null}
        </div>
      </div>
      {labelled.length ? (
        <div className="lmz-track__marks" aria-hidden="true" style={{ width: px(m.span) }}>
          {labelled.map((k, i) => (
            <MonoMeta key={i} size="sm" className="lmz-track__marklabel" data-align={k.align} style={{ '--x': px(k.x) } as CSSProperties}>
              {k.label}
            </MonoMeta>
          ))}
        </div>
      ) : null}
      {endLabels ? (
        <div className="lmz-track__ends" aria-hidden="true">
          <MonoMeta size="sm">{endLabels[0]}</MonoMeta>
          <MonoMeta size="sm">{endLabels[1]}</MonoMeta>
        </div>
      ) : null}
      {twin === true ? quiet ? null : <InlineTwin data={trackTwin(props)} /> : twin === false || twin == null ? null : twin}
    </div>
  );
}
