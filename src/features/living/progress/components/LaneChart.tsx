/**
 * <LaneChart>: one small chart lane for Progress's activity cards (energy SPEC §V4.6; DATAVIZ chrome), in the r071 chart
 * skin shared with TrendLane and ScoreHistory (`src/features/charts/living/skin.tsx`): a dotted dim grid, bars with 4 px
 * rounded tops (the highlighted one in its hue, the rest dim), a smooth line in the hue (ivory on a card with a glow, if
 * it is the focal one) with the soft area under it and a glowing dot at its end, a likely-range band as a hue gradient,
 * dots in their own hue. Index-based: one slot per day or week. A null is a gap and a line never bridges it. Reference
 * lines (Heart Points 150 and 300, a steps goal) carry their words at the right end; a plan goal is a dotted gold line, a
 * default goal a dashed one (dashed only for provisional, DATAVIZ §0). A usual band (a baseline ± its spread) is a quiet
 * wash with its word.
 *
 * The SVG is one image with a sentence (`summary`); the numbers are in the card's table twin. It can be scrubbed (pointer,
 * touch, ←/→, Home/End: `onScrub` moves the card's hero to that slot) and it can be quiet (no y numerals and no reference
 * words, dates stay).
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { cx, tidyCeil, useReveal, vizNiceStep } from '@/components';
import { EndDot, SkinGradients, usePulseAfterReveal } from '@/features/charts/living/skin';
import { smoothAreaPath, smoothLinePath } from '@/features/charts/living/trend';
import { useDayCrosshair, useDebouncedText } from '@/features/charts/living/TrendLane';
import './laneChart.css';

export interface LaneSeries {
  id: string;
  kind: 'bars' | 'line' | 'dots' | 'band';
  /** bars, line, dots. */
  values?: ReadonlyArray<number | null>;
  /** band. */
  lo?: ReadonlyArray<number | null>;
  hi?: ReadonlyArray<number | null>;
  /** A token colour ('var(--lm-cat-cardio)'). */
  hue: string;
  /** bars: slots drawn as a dashed outline only (a partial week, an "at least" day). */
  outline?: ReadonlyArray<boolean>;
  /** bars: the slot drawn in the full hue (`'last'`, an index) while the rest are dim; null or unset: every bar in the full hue. */
  highlight?: number | 'last' | null;
  /** line: the focal line (ivory on a card with a glow); default the first line of the lane. */
  focal?: boolean;
  /** line: a soft hue gradient under it (a single series with no band). */
  area?: boolean;
  /** line: a glowing dot at its last value ('pulse': it pulses twice after the first view; 'static': it does not). */
  endDot?: 'pulse' | 'static' | false;
}

export interface LaneRef {
  value: number;
  /** "150", "Goal 9 000". */
  label: string;
  /** goal: a dotted gold line; default: a dashed gold default goal; ref: a strong hairline. */
  kind: 'goal' | 'default' | 'ref';
}

export interface LaneChartProps {
  /** The image's sentence (what the lane shows, start, end, the reference lines). */
  summary: string;
  count: number;
  /** One label per slot or null (drawn under the slot). */
  xLabels: ReadonlyArray<string | null>;
  series: readonly LaneSeries[];
  refs?: readonly LaneRef[];
  usual?: { lo: number; hi: number; label: string; hue: string } | null;
  /** Default [0 for bars else the data's low end, tidy top]. */
  domain?: [number, number];
  yFormat: (v: number) => string;
  height?: number;
  className?: string;
  /**
   * r068 L13: the reference lines are the y axis's only printed ticks (0 and each reference value, at the axis), with no
   * label of their own inside the plot, so a chart never prints both "200 · 400" and "150 · 300".
   */
  refTicks?: boolean;
  /** Quiet mode: no y numerals and no reference words (the lines stay); the x labels are dates and stay. */
  quiet?: boolean;
  /** Pointer, touch and the keys move through the slots; `null` when it lets go. The card's hero follows. */
  onScrub?: (slot: number | null) => void;
  /** What the polite live region says for a slot after the scrubbing pauses ("Fri 30 Oct, 7 605 steps"). */
  scrubText?: (slot: number) => string;
  /** False renders the final frame at once (no first-view wipe or grow, no pulse). */
  animate?: boolean;
}

const PAD_L = 34;
const PAD_L_QUIET = 6;
const PAD_R = 4;
const PAD_T = 8;
const PAD_B = 18;

function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const x = el.getBoundingClientRect().width;
      if (x > 0) setW(Math.round(x));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

const finite = (x: number | null | undefined): x is number => typeof x === 'number' && Number.isFinite(x);

/** The y domain: bars start at 0; other lanes at a tidy step under their low end. The top clears every reference line. */
export function laneDomain(series: readonly LaneSeries[], refs: readonly LaneRef[] = [], usual?: { lo: number; hi: number } | null): [number, number] {
  const xs: number[] = [];
  for (const s of series) for (const v of [...(s.values ?? []), ...(s.lo ?? []), ...(s.hi ?? [])]) if (finite(v)) xs.push(v);
  for (const r of refs) xs.push(r.value);
  if (usual) xs.push(usual.lo, usual.hi);
  if (xs.length === 0) return [0, 1];
  const hi = Math.max(...xs);
  const bars = series.some((s) => s.kind === 'bars');
  if (bars) return [0, tidyCeil(hi * 1.08)];
  const lo = Math.min(...xs);
  const step = vizNiceStep(Math.max(1, (hi - lo) / 3));
  const d0 = Math.floor((lo - step * 0.25) / step) * step;
  const d1 = Math.ceil((hi + step * 0.25) / step) * step;
  return [Math.max(0, d0), d1 > d0 ? d1 : d0 + step];
}

/** Three or four printed ticks inside the domain. */
export function laneTicks([d0, d1]: [number, number]): number[] {
  const step = vizNiceStep((d1 - d0) / 3);
  const out: number[] = [];
  for (let v = Math.ceil(d0 / step) * step; v <= d1 + 1e-9; v += step) out.push(Number(v.toPrecision(8)));
  return out;
}

/** Runs of consecutive slots where `ok(i)` holds. */
function runs(n: number, ok: (i: number) => boolean): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let s = -1;
  for (let i = 0; i <= n; i++) {
    if (i < n && ok(i)) {
      if (s < 0) s = i;
    } else if (s >= 0) {
      out.push([s, i - 1]);
      s = -1;
    }
  }
  return out;
}

/** Drop x labels that would collide (11 px mono caps, about 7.5 px a character), keeping the last one. */
export function thinLabels(labels: ReadonlyArray<string | null>, slotPx: number): Array<string | null> {
  const out: Array<string | null> = labels.map(() => null);
  let lastX = Infinity;
  for (let i = labels.length - 1; i >= 0; i--) {
    const l = labels[i];
    if (!l) continue;
    const w = l.length * 7.5 + 8;
    if (lastX - i * slotPx >= w || lastX === Infinity) {
      out[i] = l;
      lastX = i * slotPx;
    }
  }
  return out;
}

/** A bar's path: square at the baseline, `r` rounded at the top (`r` never more than half the width or the height). */
export function barPath(x: number, y: number, w: number, base: number, r: number): string {
  const h = Math.max(1, base - y);
  const k = Math.max(0, Math.min(r, w / 2, h));
  const x1 = x + w;
  const top = base - h;
  return `M${x.toFixed(1)},${base.toFixed(1)}V${(top + k).toFixed(1)}Q${x.toFixed(1)},${top.toFixed(1)} ${(x + k).toFixed(1)},${top.toFixed(1)}H${(x1 - k).toFixed(1)}Q${x1.toFixed(1)},${top.toFixed(1)} ${x1.toFixed(1)},${(top + k).toFixed(1)}V${base.toFixed(1)}Z`;
}

/** Which slot is the highlighted one of a bar series (`'last'` is the last finite one). */
export function highlightIndex(s: Pick<LaneSeries, 'values' | 'highlight'>): number | null {
  if (s.highlight === undefined || s.highlight === null) return null;
  if (s.highlight !== 'last') return s.highlight;
  const v = s.values ?? [];
  for (let i = v.length - 1; i >= 0; i--) if (finite(v[i])) return i;
  return null;
}

export function LaneChart({
  summary,
  count,
  xLabels,
  series,
  refs = [],
  usual = null,
  domain,
  yFormat,
  height = 132,
  className,
  refTicks = false,
  quiet = false,
  onScrub,
  scrubText,
  animate = true,
}: LaneChartProps) {
  const [ref, width] = useWidth(320);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [revealRef, pending] = useReveal<HTMLDivElement>({ animate });
  const padL = quiet ? PAD_L_QUIET : PAD_L;
  const [d0, d1] = domain ?? laneDomain(series, refs, usual);
  const plotW = Math.max(40, width - padL - PAD_R);
  const plotH = height - PAD_T - PAD_B;
  const slot = plotW / Math.max(1, count);
  const cx0 = (i: number) => padL + slot * (i + 0.5);
  const y = (v: number) => PAD_T + plotH - ((Math.min(d1, Math.max(d0, v)) - d0) / (d1 - d0 || 1)) * plotH;
  const byRefs = refTicks && refs.length > 0;
  const ticks = byRefs ? [d0, ...refs.map((r) => r.value).filter((v) => v > d0 && v <= d1)].sort((a, b) => a - b) : laneTicks([d0, d1]);
  const barW = Math.max(2, Math.min(24, slot * 0.72));
  const base = y(d0);
  const shown = thinLabels(xLabels, slot);
  const focalId = series.find((s) => s.kind === 'line' && s.focal)?.id ?? series.find((s) => s.kind === 'line')?.id;
  const pulseWanted = series.some((s) => s.kind === 'line' && s.endDot === 'pulse');
  const pulsing = usePulseAfterReveal(pending, pulseWanted, animate);

  // scrubbing: the same crosshair as the other living charts (pointer, touch, ←/→, Home/End, Esc)
  const scrub = Boolean(onScrub);
  const cross = useDayCrosshair(count, count - 1);
  const slotDay = scrub ? cross.day : null;
  useEffect(() => {
    onScrub?.(slotDay);
    // the card's callback is not a dependency: a new function each render must not re-announce the same slot
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotDay]);
  const announce = useDebouncedText(slotDay !== null && scrubText ? scrubText(slotDay) : '');
  const dayAt = (px: number) => Math.round((px - padL) / slot - 0.5);

  return (
    <div
      ref={ref}
      className={cx('lv-lane', 'lmc-skin', className)}
      data-quiet={quiet ? 'true' : undefined}
      data-reveal={pending ? 'pending' : undefined}
    >
      <div
        ref={revealRef}
        className="lv-lane__plot"
        tabIndex={scrub ? 0 : undefined}
        onKeyDown={scrub ? (e: KeyboardEvent<HTMLElement>) => cross.onKeyDown(e) : undefined}
        onFocus={scrub ? cross.onFocus : undefined}
        onBlur={scrub ? cross.onBlur : undefined}
        onPointerDown={scrub ? (e) => cross.onPointer(e, dayAt) : undefined}
        onPointerMove={scrub ? (e) => cross.onPointer(e, dayAt) : undefined}
        onPointerLeave={scrub ? cross.onPointerLeave : undefined}
        data-scrub={scrub ? '' : undefined}
      >
        <svg className="lmc-lv-svg lv-lane__svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={summary}>
          <defs>
            {series.map((s) => (s.kind === 'line' || s.kind === 'band' ? <SkinGradients key={s.id} id={`${uid}-${s.id}`} hue={s.hue} /> : null))}
          </defs>

          {/* grid and printed ticks (a quiet lane prints none: the lines stay) */}
          {ticks.map((t) => (
            <g key={t}>
              <line className="lmc-lv-grid" x1={padL} x2={padL + plotW} y1={Math.round(y(t)) + 0.5} y2={Math.round(y(t)) + 0.5} />
              {quiet ? null : (
                <text className="lmc-lv-tick" x={padL - 6} y={y(t) + 3.5} textAnchor="end" aria-hidden="true">
                  {yFormat(t)}
                </text>
              )}
            </g>
          ))}
          <line className="lmc-lv-axis" x1={padL} x2={padL + plotW} y1={Math.round(base) + 0.5} y2={Math.round(base) + 0.5} />

          {usual ? (
            <g className="lv-lane__usual">
              <rect x={padL} width={plotW} y={y(usual.hi)} height={Math.max(1, y(usual.lo) - y(usual.hi))} style={{ fill: usual.hue }} />
              <text className="lmc-lv-eng lmc-lv-halo" x={padL + 4} y={y(usual.hi) - 3} aria-hidden="true">
                {usual.label}
              </text>
            </g>
          ) : null}

          {slotDay !== null ? <line className="lv-lane__scrub" x1={cx0(slotDay)} x2={cx0(slotDay)} y1={PAD_T} y2={base} /> : null}

          {/* the data wipes in (lines, bands, areas, dots) or grows from the baseline (bars) on the first view */}
          <g className="lmc-draw">
            {series.map((s) => {
              if (s.kind === 'band' && s.lo && s.hi) {
                const ok = (i: number) => finite(s.lo![i]) && finite(s.hi![i]);
                return (
                  <g key={s.id} data-series={s.id}>
                    {runs(count, ok).map(([a, b]) => {
                      const top = Array.from({ length: b - a + 1 }, (_, k) => `${cx0(a + k)},${y(s.hi![a + k]!)}`);
                      const bot = Array.from({ length: b - a + 1 }, (_, k) => `${cx0(b - k)},${y(s.lo![b - k]!)}`);
                      if (a === b) return <rect key={a} x={cx0(a) - 2} width={4} y={y(s.hi![a]!)} height={Math.max(1, y(s.lo![a]!) - y(s.hi![a]!))} className="lv-lane__band" fill={`url(#${uid}-${s.id}-band)`} />;
                      return <polygon key={a} points={[...top, ...bot].join(' ')} className="lv-lane__band" fill={`url(#${uid}-${s.id}-band)`} />;
                    })}
                  </g>
                );
              }
              const vals = s.values ?? [];
              if (s.kind === 'bars') {
                const hi = highlightIndex(s);
                return (
                  <g key={s.id} data-series={s.id} className="lv-lane__bars" style={{ '--lmc-hue': s.hue } as CSSProperties}>
                    {vals.map((v, i) =>
                      finite(v) ? (
                        <path
                          key={i}
                          className="lv-lane__bar"
                          data-outline={s.outline?.[i] || undefined}
                          data-dim={hi !== null && hi !== i ? '' : undefined}
                          data-on={hi === i ? '' : undefined}
                          d={barPath(cx0(i) - barW / 2, Math.min(y(v), base - 1), barW, base, 4)}
                          style={{ '--lmc-i': i } as CSSProperties}
                        />
                      ) : null,
                    )}
                  </g>
                );
              }
              if (s.kind === 'line') {
                const focal = s.id === focalId;
                const pts = vals.map((v) => (finite(v) ? v : NaN));
                const last = (() => {
                  for (let i = pts.length - 1; i >= 0; i--) if (finite(pts[i])) return i;
                  return -1;
                })();
                return (
                  <g key={s.id} data-series={s.id} data-focal={focal ? '' : undefined} style={{ '--lmc-hue': s.hue } as CSSProperties}>
                    {s.area ? <path className="lv-lane__area" fill={`url(#${uid}-${s.id}-area)`} d={smoothAreaPath(pts, cx0, y, base)} /> : null}
                    <path className="lv-lane__line" data-focal={focal ? '' : undefined} d={smoothLinePath(pts, cx0, y)} />
                    {s.endDot && last >= 0 ? <EndDot x={cx0(last)} y={y(pts[last]!)} r={s.endDot === 'pulse' ? 5 : 3.5} pulse={s.endDot === 'pulse' && pulsing} /> : null}
                  </g>
                );
              }
              return (
                <g key={s.id} data-series={s.id} style={{ '--lmc-hue': s.hue } as CSSProperties}>
                  {vals.map((v, i) => (finite(v) ? <circle key={i} className="lv-lane__dot" cx={cx0(i)} cy={y(v)} r={2.5} /> : null))}
                </g>
              );
            })}
          </g>

          {refs.map((r) => (
            <g key={`${r.kind}:${r.value}`} className="lv-lane__ref" data-kind={r.kind}>
              <line x1={padL} x2={padL + plotW} y1={Math.round(y(r.value)) + 0.5} y2={Math.round(y(r.value)) + 0.5} />
              {byRefs || quiet ? null : (
                <text className="lmc-lv-eng lmc-lv-halo" x={padL + plotW - 2} y={y(r.value) - 4} textAnchor="end" aria-hidden="true">
                  {r.label}
                </text>
              )}
            </g>
          ))}

          {shown.map((l, i) =>
            l ? (
              <text key={i} className="lmc-lv-tick" x={cx0(i)} y={height - 4} textAnchor={i === 0 && count > 12 ? 'start' : i === count - 1 && count > 12 ? 'end' : 'middle'} aria-hidden="true">
                {l}
              </text>
            ) : null,
          )}
        </svg>
      </div>
      {scrub ? (
        <p className="lm-sr" aria-live="polite">
          {announce}
        </p>
      ) : null}
    </div>
  );
}
