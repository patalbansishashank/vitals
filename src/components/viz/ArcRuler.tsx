/* ==========================================================================
   <ArcRuler> (DATAVIZ P4, SPEC A.3.2): the dial. A 120° sweep of radius 150
   whose scale slides under a fixed 2 px gold needle at the apex: ±12 units
   in view (5° a unit), minor ticks each unit, majors each 5 with upright
   numerals in pale stone, band edges longer and carrying the band's word.
   The value sits above in headline, the state word under the needle with
   its 6 px mark. The scale settles with one damped overshoot (420 ms),
   instantly under reduced motion. `straight` is the tile form under 288 px:
   the scale-slider well, read-only, the tape sliding under the needle.
   ========================================================================== */
import { useEffect, useRef, useState } from 'react';
import { cx } from '../lib/cx';
import { formatNumber } from '../lib/format';
import { useReducedMotion } from '../lib/hooks';
import type { Severity } from '../Notice';
import { DEG, clamp, isNum, lowerFirst, niceStep, polar, speak } from './geometry';
import { useDebounced, useWidth } from './hooks';
import { ReadingAge } from './marks';
import './viz.css';

export interface ArcBand {
  /** Inclusive lower edge (−Infinity for the first band). */
  from: number;
  word: string;
  severity: Severity;
}

export type ArcRulerState = 'normal' | 'stale' | 'calibrating' | 'none';

export interface ArcRulerProps {
  label: string;
  value: number | null;
  /** "/ 100", "ms", "°C" */
  unit?: string;
  /** "Ring index, not validated" */
  scaleNote?: string;
  bands?: ArcBand[];
  /** Personal metrics: centre = baseline, ±1 SD labelled. */
  center?: number;
  spread?: number;
  /** Units each side of the needle (default 12). */
  window?: number;
  /** The scale's ends (default 0..100 with bands, else open). */
  min?: number;
  max?: number;
  /** The state word when there are no bands ("Below baseline"). */
  wordText?: string;
  /** Severity of `wordText`. */
  wordSeverity?: Severity;
  decimals?: number;
  variant?: 'arc' | 'straight';
  size?: 'hero' | 'tile';
  state?: ArcRulerState;
  /** "3 h ago" */
  ageText?: string;
  quiet?: boolean;
  /** (r068 SG5) Words on the scale (band edges, "Usual", "±1 SD"; default true). Off: plain edge ticks, the words left to the page. */
  edgeWords?: boolean;
  className?: string;
}

export const ARC_R = 150;
export const ARC_SWEEP = 60 * DEG; // each side
const VB_W = 300;
const APEX = 30;
const CY = APEX + ARC_R;
const NEEDLE = 72;

/** The band holding `v`. */
export function bandOf(bands: readonly ArcBand[] | undefined, v: number): ArcBand | null {
  if (!bands?.length) return null;
  let b: ArcBand | null = null;
  for (const x of bands) if (v >= x.from) b = x;
  return b ?? bands[0]!;
}

export interface ArcTick {
  u: number;
  /** Angle from the apex (rad), negative left. */
  a: number;
  major: boolean;
  /** A band edge or a personal mark carrying a word. */
  word?: string;
  /** (r068 SG5) The usual value's mark, drawn as a gold notch (edgeWords off). */
  usual?: boolean;
  opacity: number;
}

/** The visible ticks for the scale at `at` (the displayed value). Pure. */
export function arcTicks(p: Pick<ArcRulerProps, 'bands' | 'center' | 'spread' | 'window' | 'min' | 'max' | 'state' | 'quiet' | 'edgeWords'> & { at: number }): ArcTick[] {
  const win = p.window ?? 12;
  const minor = niceStep(win / 12);
  const major = minor * 5;
  const lo = p.min ?? (p.bands?.length ? 0 : -Infinity);
  const hi = p.max ?? (p.bands?.length ? 100 : Infinity);
  const marks = new Map<number, string>();
  // (r068 SG5) edgeWords off: band edges and ±1 SD are ordinary ticks (a long bright tick with no word read as an
  // unexplained mark); only the usual value stays marked, as one labelled gold notch
  const plain = p.edgeWords === false;
  if (p.state !== 'calibrating') {
    if (!plain) for (const b of p.bands ?? []) if (Number.isFinite(b.from)) marks.set(b.from, b.word);
    if (!p.bands?.length && isNum(p.center)) {
      marks.set(p.center, 'Usual');
      // (r063 FX3) quiet: "±1 SD" is a figure; the usual mark stays
      if (isNum(p.spread) && p.spread > 0 && !p.quiet && !plain) {
        marks.set(p.center - p.spread, '−1 SD');
        marks.set(p.center + p.spread, '+1 SD');
      }
    }
  }
  const out: ArcTick[] = [];
  const first = Math.ceil((p.at - win - minor) / minor) * minor;
  for (let u = first; u <= p.at + win + minor + 1e-9; u += minor) {
    const uu = Number(u.toFixed(6));
    if (uu < lo - 1e-9 || uu > hi + 1e-9) continue;
    const a = ((uu - p.at) / win) * ARC_SWEEP;
    if (Math.abs(a) > ARC_SWEEP + 1e-9) continue;
    const edge = Math.abs(a) / ARC_SWEEP;
    out.push({ u: uu, a, major: Math.abs(uu / major - Math.round(uu / major)) < 1e-6, opacity: Number((1 - 0.65 * edge ** 3).toFixed(3)) });
  }
  for (const [at, word] of marks) {
    const a = ((at - p.at) / win) * ARC_SWEEP;
    if (Math.abs(a) <= ARC_SWEEP && at >= lo && at <= hi) {
      const hit = out.find((t) => Math.abs(t.u - at) < 1e-6);
      const usual = plain ? { usual: true } : {};
      if (hit) Object.assign(hit, { word }, usual);
      else out.push({ u: at, a, major: false, word, opacity: 1, ...usual });
    }
  }
  return out.sort((x, y) => x.a - y.a);
}

/** "of 100" for "/ 100"; else the unit itself. */
const spokenUnit = (unit?: string): string => (unit ? (unit.trim().startsWith('/') ? `of ${unit.replace('/', '').trim()}` : unit) : '');

/** The state words of the reading: the band's, or `wordText`. */
export function arcWord(p: Pick<ArcRulerProps, 'value' | 'bands' | 'wordText' | 'wordSeverity' | 'state'>): { word: string; severity: Severity } | null {
  if (p.state === 'calibrating') return { word: p.wordText ?? 'Building baseline', severity: 'info' };
  if (!isNum(p.value) || p.state === 'none') return null;
  const b = p.state === 'normal' || p.state === 'stale' || p.state === undefined ? bandOf(p.bands, p.value) : null;
  if (b) return { word: b.word, severity: b.severity };
  return p.wordText ? { word: p.wordText, severity: p.wordSeverity ?? 'info' } : null;
}

/** "Stress 89 of 100, high". */
export function spokenArc(p: Pick<ArcRulerProps, 'label' | 'value' | 'unit' | 'bands' | 'wordText' | 'wordSeverity' | 'state' | 'quiet' | 'decimals' | 'ageText'>): string {
  if (p.state === 'none' || !isNum(p.value)) return `${p.label}, no reading`;
  const w = arcWord(p);
  const value = p.quiet ? '' : ` ${formatNumber(p.value, p.decimals ?? 0)}${p.unit ? ` ${spokenUnit(p.unit)}` : ''}`;
  // quiet: no age digits either ("18 h ago" is a number); stale stays a word
  const tail = [w ? lowerFirst(w.word) : null, p.state === 'stale' ? `stale${p.ageText && !p.quiet ? `, ${p.ageText}` : ''}` : null].filter(Boolean).join(', ');
  return speak(`${p.label}${value}${tail ? `, ${tail}` : ''}`);
}

/* ------------------------------------------------------------- the tween */

/** cubic-bezier(x1, y1, x2, y2) as a function of time 0..1 (Newton on x). */
export function bezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const X = (s: number) => ((ax * s + bx) * s + cx) * s;
  const dX = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
  return (t: number) => {
    let s = t;
    for (let i = 0; i < 8; i++) {
      const d = dX(s);
      if (Math.abs(d) < 1e-6) break;
      s -= (X(s) - t) / d;
    }
    return ((ay * s + by) * s + cy) * s;
  };
}

const NEEDLE_EASE = bezier(0.34, 1.36, 0.64, 1);
export const NEEDLE_MS = 420;

/** The displayed value: it settles on `target` with one damped overshoot, or jumps under reduced motion. */
function useSettle(target: number, reduced: boolean): number {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (reduced || typeof requestAnimationFrame === 'undefined') {
      from.current = target;
      return;
    }
    const start = from.current;
    if (start === target) return;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / NEEDLE_MS);
      const v = start + (target - start) * NEEDLE_EASE(k);
      from.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, reduced]);
  return reduced ? target : shown;
}

/* ------------------------------------------------------------- component */

export function ArcRuler(props: ArcRulerProps) {
  const { label, value, unit, scaleNote, variant = 'arc', size = 'hero', state = 'normal', ageText, quiet = false, decimals = 0, className } = props;
  const reduced = useReducedMotion();
  const rest = isNum(value) && state !== 'none' ? value : (props.center ?? (isNum(props.min) && isNum(props.max) ? (props.min + props.max) / 2 : props.bands?.length ? 50 : 0));
  const at = useSettle(rest, reduced);
  const spoken = spokenArc(props);
  const announced = useDebounced(spoken);
  const word = arcWord(props);
  const ticks = arcTicks({ ...props, at });
  const f = (v: number) => formatNumber(v, decimals);
  const showNums = !quiet && size === 'hero';
  const head = (
    <div className="lmv-arc__value" aria-hidden="true">
      {quiet ? null : (
        <>
          <span className="lmv-arc__num">{isNum(value) && state !== 'none' ? f(value) : '—'}</span>
          {unit && isNum(value) && state !== 'none' ? <span className="lmv-unit">{unit.startsWith('/') ? ` ${unit}` : ` ${unit}`}</span> : null}
        </>
      )}
    </div>
  );
  const foot = (
    <div className="lmv-arc__foot" aria-hidden="true">
      {word ? (
        state === 'calibrating' ? (
          <span className="lm-chip lmv-chip" data-kind="provisional">
            {word.word}
          </span>
        ) : (
          <span className="lmv-arc__word" data-severity={word.severity}>
            <span className="lmv-mark" />
            {word.word}
          </span>
        )
      ) : null}
      {(state === 'stale' || state === 'none') && ageText ? <ReadingAge ageText={ageText} stale={state === 'stale'} /> : null}
    </div>
  );
  return (
    <div
      className={cx('lmv lmv-arc', className)}
      data-variant={variant}
      data-size={size}
      data-state={state}
      role="meter"
      aria-label={label}
      // quiet: words only, to assistive technology too (Claude UI P1-1)
      aria-valuemin={quiet ? undefined : (props.min ?? (props.bands?.length ? 0 : undefined))}
      aria-valuemax={quiet ? undefined : (props.max ?? (props.bands?.length ? 100 : undefined))}
      aria-valuenow={!quiet && isNum(value) && state !== 'none' ? value : undefined}
      aria-valuetext={spoken}
    >
      {head}
      {variant === 'straight' ? <StraightScale ticks={ticks} at={at} showNums={!quiet} f={f} window={props.window ?? 12} /> : <ArcScale ticks={ticks} showNums={showNums} f={f} at={at} size={size} />}
      {foot}
      {scaleNote && size === 'hero' ? <p className="lmv-note lmv-arc__note">{scaleNote}</p> : null}
      <span className="lm-sr" aria-live="polite">
        {announced}
      </span>
    </div>
  );
}

function ArcScale({ ticks, showNums, f, at, size }: { ticks: ArcTick[]; showNums: boolean; f: (v: number) => string; at: number; size: 'hero' | 'tile' }) {
  const cx0 = VB_W / 2;
  const H = size === 'hero' ? 128 : 112;
  return (
    <svg className="lmv-arc__svg lmc-lv-svg" viewBox={`0 0 ${VB_W} ${H}`} aria-hidden="true">
      {ticks.map((t) => {
        const len = t.word ? 18 : t.major ? 12 : 6;
        const [xa, ya] = polar(cx0, CY, ARC_R, t.a);
        const [xb, yb] = polar(cx0, CY, ARC_R - len, t.a);
        const [xn, yn] = polar(cx0, CY, ARC_R - 28, t.a);
        const [xw, yw] = polar(cx0, CY, ARC_R + 9, t.a);
        const nearNeedle = Math.abs(t.u - at) < 1.6 * (ticks[1] ? Math.abs(ticks[1].u - ticks[0]!.u) : 1);
        return (
          <g key={`${t.u}-${t.word ?? ''}`} style={{ opacity: t.opacity }}>
            <line className="lmv-arc__tick" data-major={t.major || undefined} data-edge={t.word ? true : undefined} data-usual={t.usual || undefined} x1={xa} y1={ya} x2={xb} y2={yb} />
            {showNums && t.major && !nearNeedle ? (
              <text className="lmv-arc__numeral" x={xn} y={yn + 4} textAnchor="middle">
                {f(t.u)}
              </text>
            ) : null}
            {/* the usual notch keeps its word close to the needle too, on the side away from it */}
            {t.word && size === 'hero' && Math.abs(t.a) > (t.usual ? 2 : 8) * DEG ? (
              <text className="lmc-lv-eng lmv-arc__edge" data-usual={t.usual || undefined} x={t.usual && t.a < 0 ? xw - 4 : xw + 4} y={yw - 1} textAnchor={t.usual && t.a < 0 ? 'end' : 'start'}>
                {t.word}
              </text>
            ) : null}
          </g>
        );
      })}
      <line className="lmv-arc__needle" x1={cx0} x2={cx0} y1={APEX - 18} y2={APEX - 18 + NEEDLE} />
    </svg>
  );
}

function StraightScale({ ticks, at, showNums, f, window: win }: { ticks: ArcTick[]; at: number; showNums: boolean; f: (v: number) => string; window: number }) {
  const [ref, width] = useWidth<HTMLDivElement>(240);
  const x = (u: number) => clamp(width / 2 + ((u - at) / win) * (width / 2), 0, width);
  return (
    <div ref={ref} className="lm-scale lmv-arc__straight" aria-hidden="true">
      <div className="lm-scale__well">
        <div className="lm-scale__ticks">
          <svg>
            {ticks.map((t) => (
              <line key={`${t.u}-${t.word ?? ''}`} x1={x(t.u)} x2={x(t.u)} y1={t.word ? 4 : t.major ? 10 : 16} y2={28} data-major={t.major || t.word ? 'true' : undefined} />
            ))}
          </svg>
        </div>
        <div className="lm-scale__needle" style={{ left: '50%' }} />
      </div>
      {showNums ? (
        <div className="lm-scale__nums">
          {ticks
            .filter((t) => t.major && x(t.u) > 10 && x(t.u) < width - 10)
            .map((t) => (
              <span key={t.u} style={{ left: `${x(t.u)}px` }}>
                {f(t.u)}
              </span>
            ))}
        </div>
      ) : null}
    </div>
  );
}
