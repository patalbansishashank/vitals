/* ==========================================================================
   <RangeScale> (r071, AUDIT §5.2 and V8): one reading on a bounded scale, with the person's own usual range. It
   replaces LevelTrack, RangeBands, LevelBar (dead), ArcRuler's straight form, the meter variant of EquivalenceMeter
   and the evidence ParamCard range. The data shape is "a value against a range", so the picture is a printed scale:
   41 ticks, the ticks inside the usual range lit in the domain hue, a 3 px ivory marker at the value. The usual band
   is static; the marker drops in with one damped overshoot.

   - `usual` lights the ticks of the person's own range. `bands` are the state words (info, ok, caution, danger): they
     are always a mark AND a word, never the colour of the marker (which stays ivory). With `ticks="bands"` each band
     edge is a long tick and each band is named under the scale, when its word fits.
   - Stale keeps the last reading with its age and the gold dot (the marker turns hollow); calibrating draws dashed
     ticks and says "Building baseline"; none has no marker.
   - Quiet: no numerals; the words of the bands (or "within your usual range") stand in. The marker stays.
   - role="meter" with the one sentence as its value text; the ticks and the labels are decoration for assistive
     technology (the sentence says all of it).
   ========================================================================== */
import { useCallback, useRef, type CSSProperties } from 'react';
import { cx } from '../lib/cx';
import { formatNumber } from '../lib/format';
import { useInView } from '@/app/motion';
import type { Domain } from '../domain';
import { clamp, isNum, speak } from './geometry';
import { useWidth } from './hooks';
import { InlineTwin, twinFileName, type TwinData } from './twin';
import './viz-base.css';
import './scale.css';

export type RangeSeverity = 'info' | 'ok' | 'caution' | 'danger';

export interface RangeBand {
  /** Lower edge, inclusive. A band runs to the next band's `from` (the last to `max`). −Infinity is fine for the first. */
  from: number;
  /** "Calm", "Elevated": always shown with the mark, never the colour alone. */
  word: string;
  severity: RangeSeverity;
}

export type RangeState = 'normal' | 'stale' | 'calibrating' | 'none';

export interface RangeScaleProps {
  /** "HRV" */
  label: string;
  value: number | null;
  min: number;
  max: number;
  /** Ascending by `from`. */
  bands?: ReadonlyArray<RangeBand>;
  /** The person's usual range: its ticks are lit in the domain hue. */
  usual?: readonly [number, number];
  /** "ms" */
  unit?: string;
  /** The unit as spoken ("milliseconds"); default `unit`. */
  spokenUnit?: string;
  decimals?: number;
  /** Override the card's domain colours for this picture. */
  hue?: Domain;
  /** `bands`: long ticks at the band edges and the band words under them. A number: that many ticks. Default 41 (17 inline). */
  ticks?: 'bands' | number;
  /** The words at the two ends ("WARM", "6500 K"); hidden when quiet and they carry a digit. */
  endLabels?: readonly [string, string];
  /** `inline` is the 96 px glyph of a list row, no labels; `full` fills the width. */
  size?: 'inline' | 'full';
  state?: RangeState;
  /** "3 h ago": shown with the gold dot when stale (hidden when quiet). */
  ageText?: string;
  quiet?: boolean;
  animate?: boolean;
  /** Draw the "Table" key and the table twin under the scale. */
  twin?: boolean;
  className?: string;
}

/* ------------------------------------------------------------------ pure model */

export interface ScaleTick {
  i: number;
  value: number;
  /** viewBox x. */
  x: number;
  major: boolean;
  /** Inside the usual range. */
  usual: boolean;
  /** On a band edge (`ticks="bands"`). */
  edge: boolean;
}

export interface ScaleModel {
  /** The viewBox. */
  w: number;
  h: number;
  ticks: ScaleTick[];
  /** The marker's viewBox x, or null when there is no reading. */
  marker: number | null;
  /** The value was outside [min, max] and the marker sits at the end. */
  clamped: 'below' | 'above' | null;
  /** The band holding the value. */
  band: RangeBand | null;
  /** Where the value sits against the usual range. */
  position: 'within' | 'below' | 'above' | null;
  /** Each band's centre and width as a share of the scale, for the words under it. */
  spans: Array<{ band: RangeBand; centre: number; width: number }>;
}

const FULL = { w: 300, h: 28, minorTop: 8, majorTop: 2, bottom: 24 } as const;
const INLINE = { w: 96, h: 12, minorTop: 4, majorTop: 1, bottom: 10 } as const;
const PAD = 2;

/** The band holding `v` (the last whose `from` is at or below it; the first when below them all). */
export function bandAt(bands: ReadonlyArray<RangeBand> | undefined, v: number): RangeBand | null {
  if (!bands?.length) return null;
  let b: RangeBand = bands[0]!;
  for (const x of bands) if (v >= x.from) b = x;
  return b;
}

/** The scale's ticks, marker and bands in viewBox units. Pure. */
export function scaleModel(p: Pick<RangeScaleProps, 'value' | 'min' | 'max' | 'bands' | 'usual' | 'ticks' | 'size' | 'state'>): ScaleModel {
  const g = p.size === 'inline' ? INLINE : FULL;
  const span = Math.max(1e-9, p.max - p.min);
  const n = Math.max(2, Math.round(typeof p.ticks === 'number' ? p.ticks : g === INLINE ? 17 : 41));
  const every = n >= 21 ? 5 : n >= 9 ? 4 : 2;
  const xOf = (v: number) => PAD + clamp((v - p.min) / span, 0, 1) * (g.w - 2 * PAD);
  const edges = p.ticks === 'bands' ? new Set((p.bands ?? []).map((b) => b.from).filter((f) => Number.isFinite(f) && f > p.min && f < p.max)) : new Set<number>();
  const ticks: ScaleTick[] = Array.from({ length: n }, (_, i) => {
    const value = p.min + (i / (n - 1)) * span;
    return { i, value, x: PAD + (i / (n - 1)) * (g.w - 2 * PAD), major: i % every === 0, usual: Boolean(p.usual) && value >= p.usual![0] - 1e-9 && value <= p.usual![1] + 1e-9 && p.state !== 'calibrating', edge: false };
  });
  // a band edge is a long tick of its own, at the edge's exact place
  const edgeTicks: ScaleTick[] = [...edges].map((v) => ({ i: -1, value: v, x: xOf(v), major: true, usual: false, edge: true }));
  const has = isNum(p.value) && p.state !== 'none';
  const v = has ? (p.value as number) : null;
  const clamped = v === null ? null : v < p.min ? 'below' : v > p.max ? 'above' : null;
  const band = v === null ? null : bandAt(p.bands, v);
  const position = v === null || !p.usual ? null : v < p.usual[0] ? 'below' : v > p.usual[1] ? 'above' : 'within';
  const bands = p.bands ?? [];
  const spans = bands.map((b, i) => {
    const a = clamp(Number.isFinite(b.from) ? b.from : p.min, p.min, p.max);
    const z = clamp(i + 1 < bands.length ? bands[i + 1]!.from : p.max, p.min, p.max);
    return { band: b, centre: (xOf(a) + xOf(z)) / 2 / g.w, width: (z - a) / span };
  });
  return { w: g.w, h: g.h, ticks: [...ticks, ...edgeTicks], marker: v === null ? null : xOf(v), clamped, band, position, spans };
}

/* ------------------------------------------------------------------ words */

type SpokenInput = Pick<RangeScaleProps, 'label' | 'value' | 'min' | 'max' | 'bands' | 'usual' | 'unit' | 'spokenUnit' | 'decimals' | 'state' | 'ageText' | 'quiet'>;

const POSITION_WORD = { within: 'within your usual range', below: 'below your usual range', above: 'above your usual range' } as const;

/**
 * "HRV 48 milliseconds, balanced, your usual range 38 to 62". Stale adds "stale, 3 h ago"; calibrating says it is
 * building the baseline; none says there is no reading. Quiet: the words only ("HRV, balanced, within your usual
 * range"), never a digit. Pure.
 */
export function spokenRange(p: SpokenInput): string {
  const f = (v: number) => formatNumber(v, p.decimals ?? 0);
  const unit = p.spokenUnit ?? p.unit;
  if (p.state === 'none' || !isNum(p.value)) return `${p.label}: no reading`;
  const m = scaleModel({ ...p, ticks: undefined, size: 'full' });
  if (p.state === 'calibrating') return p.quiet ? `${p.label}: building your baseline` : speak(`${p.label} ${f(p.value)}${unit ? ` ${unit}` : ''}, building your baseline`);
  const stale = p.state === 'stale' ? (p.quiet || !p.ageText ? ', stale' : `, stale, ${p.ageText}`) : '';
  if (p.quiet) {
    const words = [m.band?.word.toLowerCase(), m.position ? POSITION_WORD[m.position] : null].filter(Boolean);
    const third = (p.value - p.min) / Math.max(1e-9, p.max - p.min);
    const where = !words.length ? (third < 1 / 3 ? 'in the lower part of the scale' : third > 2 / 3 ? 'in the upper part of the scale' : 'in the middle of the scale') : '';
    return `${p.label}, ${[...words, where].filter(Boolean).join(', ')}${stale}`;
  }
  const parts = [`${p.label} ${f(p.value)}${unit ? ` ${unit}` : ''}`];
  if (m.band) parts.push(m.band.word.toLowerCase());
  if (p.usual) parts.push(`your usual range ${f(p.usual[0])} to ${f(p.usual[1])}`);
  return speak(`${parts.join(', ')}${stale}`);
}

/** The Table twin: the reading, its usual range, the scale and each band's edge. Pure. */
export function rangeTwin(p: SpokenInput): TwinData {
  const f = (v: number) => formatNumber(v, p.decimals ?? 0);
  const u = p.unit ? ` ${p.unit}` : '';
  const rows: Array<Array<string | number>> = [['Reading', isNum(p.value) ? `${f(p.value)}${u}` : '—']];
  const m = scaleModel({ ...p, ticks: undefined, size: 'full' });
  if (m.band) rows.push(['State', m.band.word]);
  if (p.usual) rows.push(['Usual range', `${f(p.usual[0])}–${f(p.usual[1])}${u}`]);
  rows.push(['Scale', `${f(p.min)}–${f(p.max)}${u}`]);
  for (const b of p.bands ?? []) rows.push([b.word, Number.isFinite(b.from) ? `from ${f(b.from)}${u}` : 'below the first edge']);
  return { title: `${p.label} table`, caption: spokenRange(p), head: ['Measure', 'Value'], rows, fileName: twinFileName(p.label), rowNoun: ['row', 'rows'] };
}

/* ------------------------------------------------------------------ component */

const hasDigit = (s: string) => /\d/.test(s);

export function RangeScale(props: RangeScaleProps) {
  const { label, value, min, max, hue, endLabels, size = 'full', state = 'normal', ageText, quiet = false, animate = true, twin = false, className } = props;
  const [widthRef, width] = useWidth<HTMLDivElement>(300);
  const revealRef = useRef<HTMLDivElement | null>(null);
  const inView = useInView(revealRef);
  const pending = animate && !inView;
  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      widthRef.current = el;
      revealRef.current = el;
    },
    [widthRef, revealRef],
  );
  const m = scaleModel(props);
  const spoken = spokenRange(props);
  const stale = state === 'stale';
  const inline = size === 'inline';
  const showWords = !inline && props.ticks === 'bands' && m.spans.length > 0;
  // each band's word sits under its band when every one fits; otherwise the current band is named once, under the scale
  const wordsAll = showWords && m.spans.every((s) => s.width * width >= s.band.word.length * 7.8 + 22);
  const wordsCurrent = showWords && !wordsAll && m.band && (state === 'normal' || state === 'stale') ? m.band : null;
  const ends = !inline && endLabels ? endLabels.map((s) => (quiet && hasDigit(s) ? '' : s)) : [];
  const hasEnds = ends.some(Boolean);
  const mid = inline ? null : state === 'calibrating' ? 'Building baseline' : state === 'none' ? 'No reading' : stale && ageText && !(quiet && hasDigit(ageText)) ? ageText : null;
  const numeric = !quiet && isNum(value) && state !== 'none';
  const root = size === 'inline' ? 'inline' : 'full';

  return (
    <div
      ref={setRef}
      className={cx('lmz lmz-scale', className)}
      data-size={root}
      data-state={state}
      data-hue={hue}
      data-reveal={pending ? 'pending' : undefined}
      data-clamped={m.clamped ?? undefined}
    >
      <div
        className="lmz-scale__plot"
        role="meter"
        aria-label={label}
        aria-valuemin={numeric ? min : undefined}
        aria-valuemax={numeric ? max : undefined}
        aria-valuenow={numeric ? (value as number) : undefined}
        aria-valuetext={spoken}
      >
        <svg
          className="lmz-scale__svg"
          viewBox={`0 0 ${m.w} ${m.h}`}
          width={inline ? m.w : undefined}
          height={inline ? m.h : undefined}
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          {m.ticks.map((t) => {
            const g = inline ? INLINE : FULL;
            return (
              <line
                key={`${t.i}-${t.value}`}
                className="lmz-scale__t"
                data-major={t.major || undefined}
                data-in={t.usual || undefined}
                data-edge={t.edge || undefined}
                style={{ '--i': Math.max(0, t.i) } as CSSProperties}
                x1={t.x}
                x2={t.x}
                y1={t.major ? g.majorTop : g.minorTop}
                y2={g.bottom}
              />
            );
          })}
          {m.marker !== null ? <rect className="lmz-scale__marker" data-hollow={stale || undefined} x={m.marker - 1.5} y={0} width={3} height={m.h} rx={1.5} /> : null}
        </svg>
        {inline && stale ? <i className="lmz-scale__stale" aria-hidden="true" /> : null}
      </div>
      {wordsAll ? (
        <div className="lmz-scale__bands" aria-hidden="true">
          {m.spans.map((s) => (
            <span key={`${s.band.from}-${s.band.word}`} className="lmz-scale__band" data-severity={s.band.severity} data-current={s.band === m.band || undefined} style={{ left: `${s.centre * 100}%` }}>
              <i className="lmz-scale__mark" />
              <span className="lm-mono" data-size="sm" data-tone={s.band === m.band ? 'ink' : 'muted'}>
                {s.band.word}
              </span>
            </span>
          ))}
        </div>
      ) : null}
      {hasEnds || mid || wordsCurrent ? (
        <div className="lmz-scale__labels" data-solo={hasEnds ? undefined : ''} aria-hidden="true">
          {hasEnds ? (
            <span className="lm-mono" data-size="sm" data-tone="ink">
              {ends[0] ?? ''}
            </span>
          ) : null}
          {mid ? (
            <span className="lm-mono lmz-scale__mid" data-size="sm">
              {stale ? <i className="lmz-scale__stale" /> : null}
              {mid}
            </span>
          ) : wordsCurrent ? (
            <span className="lmz-scale__band lmz-scale__band--solo" data-severity={wordsCurrent.severity} data-current="">
              <i className="lmz-scale__mark" />
              <span className="lm-mono" data-size="sm" data-tone="ink">
                {wordsCurrent.word}
              </span>
            </span>
          ) : hasEnds ? (
            <span />
          ) : null}
          {hasEnds ? (
            <span className="lm-mono" data-size="sm" data-tone="ink">
              {ends[1] ?? ''}
            </span>
          ) : null}
        </div>
      ) : null}
      {twin && state !== 'none' && !quiet ? <InlineTwin data={rangeTwin(props)} /> : null}
    </div>
  );
}
