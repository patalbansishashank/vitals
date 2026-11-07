/* ==========================================================================
   Canvas drawing primitives for the annotation layers (CHART_SPEC §6).
   All coordinates are CANVAS pixels (CSS px × DPR) unless stated.
   Every helper saves/restores context state: uPlot caches ctx styles.
   ========================================================================== */
import type { MarkerShape } from '../catalogue';
import { decimalsForStep, formatNumber } from '../lib/format';
import type { TickSet } from '../lib/ticks';
import type { ChartEvent, Phase } from '../types';
import { canvasFont, type ChartTheme, getThemeSnapshot, withAlpha } from './theme';

export interface PlotBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface DrawArgs {
  ctx: CanvasRenderingContext2D;
  theme: ChartTheme;
  dpr: number;
  /** Plot area (canvas px). */
  box: PlotBox;
  /** Full canvas size (canvas px). */
  canvasW: number;
  canvasH: number;
  x0: number;
  x1: number;
  yMin: number;
  yMax: number;
  x: (t: number) => number;
  y: (v: number) => number;
}

export const crisp = (v: number, dpr: number): number => Math.round(v) + (Math.round(dpr) % 2 ? 0.5 : 0);

export function clipToPlot(a: DrawArgs, extraTop = 0, extraBottom = 0): void {
  a.ctx.beginPath();
  a.ctx.rect(a.box.left, a.box.top - extraTop, a.box.width, a.box.height + extraTop + extraBottom);
  a.ctx.clip();
}

/** Layer 1: alternate block tint + 1 px block boundaries, full canvas height. */
export function drawPhaseBands(a: DrawArgs, phases: readonly Phase[] | undefined, opts: { tint?: boolean } = {}): void {
  if (!phases?.length) return;
  const { ctx } = a;
  ctx.save();
  ctx.beginPath();
  ctx.rect(a.box.left, 0, a.box.width, a.canvasH);
  ctx.clip();
  phases.forEach((p, k) => {
    if (p.endDay <= a.x0 || p.startDay >= a.x1) return;
    const l = a.x(p.startDay);
    const r = a.x(p.endDay);
    if (opts.tint !== false && k % 2 === 1) {
      ctx.fillStyle = a.theme.phaseAlt;
      ctx.fillRect(l, 0, r - l, a.canvasH);
    }
    if (p.startDay > a.x0 && k > 0) {
      ctx.fillStyle = a.theme.line;
      ctx.fillRect(Math.round(l), 0, Math.max(1, Math.round(a.dpr)), a.canvasH);
    }
  });
  ctx.restore();
}

/**
 * Layer 2 (r071 skin): horizontal gridlines at the ticks, dotted (1 px dots 3 px apart) and dim (ink at `--lmc-grid-a`).
 * A grid is decoration, not text and not a data mark, so it may sit under 3:1; thresholds, targets and the zero line
 * are drawn by their own helpers and stay solid.
 */
export function drawGrid(a: DrawArgs, ticks: readonly number[], color?: string): void {
  const { ctx } = a;
  const lw = Math.max(1, Math.round(a.dpr));
  ctx.save();
  ctx.strokeStyle = color ?? a.theme.gridDot;
  ctx.lineWidth = lw;
  ctx.lineCap = 'butt';
  ctx.setLineDash([lw, 3 * lw]);
  ctx.beginPath();
  for (const t of ticks) {
    const yy = crisp(a.y(t), a.dpr);
    ctx.moveTo(a.box.left, yy);
    ctx.lineTo(a.box.left + a.box.width, yy);
  }
  ctx.stroke();
  ctx.restore();
}

/** Horizontal emphasised line (zero line / baseline). */
export function drawHLine(a: DrawArgs, v: number, color: string, widthCss = 1): void {
  if (v < a.yMin || v > a.yMax) return;
  const { ctx } = a;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, Math.round(widthCss * a.dpr));
  const yy = crisp(a.y(v), a.dpr);
  ctx.beginPath();
  ctx.moveTo(a.box.left, yy);
  ctx.lineTo(a.box.left + a.box.width, yy);
  ctx.stroke();
  ctx.restore();
}

export interface YAxisOptions {
  /**
   * The tick column's width class (CSS px): below 40 the default format compacts thousands ("2k"). It decides the
   * label text only; the column itself is the plot's left padding, sized to the widest label (see `yAxisWidth`).
   */
  colCss: number;
  format?: (v: number, step: number) => string;
  step: number;
  /** Printed tick mark length (CSS px). */
  tickCss?: number;
  /** Keep labels inside the canvas vertically. */
  clampLabels?: boolean;
}

/** Tick label size (CSS px) and the space between a label's right edge and the data area: tick, gap, spine. */
export const Y_LABEL_PX = 11;
const Y_TICK_PX = 4;
const Y_GAP_PX = 3;
const Y_SPINE_PX = 1;

/** The labels `drawYAxis` prints for these ticks (one per tick, same order). */
export function yAxisLabels(ticks: readonly number[], o: Pick<YAxisOptions, 'colCss' | 'format' | 'step'>): string[] {
  const fmt = o.format ?? ((v: number, step: number) => formatTick(v, step, o.colCss));
  return ticks.map((t) => fmt(t, o.step));
}

/** The labels a model prints for a tick set over the domain [lo, hi] (ticks outside it are not drawn). */
export function yAxisLabelsIn(t: TickSet, lo: number, hi: number, o: Pick<YAxisOptions, 'colCss' | 'format'>): string[] {
  const eps = Math.abs(hi - lo) * 1e-6;
  return yAxisLabels(
    t.ticks.filter((v) => v >= Math.min(lo, hi) - eps && v <= Math.max(lo, hi) + eps),
    { ...o, step: t.step },
  );
}

let measureCtx: CanvasRenderingContext2D | null | undefined;
const widthCache = new Map<string, number>();

/** Forget measured label widths (the chart font changed or finished loading). */
export function resetLabelWidths(): void {
  widthCache.clear();
}

/** Width (CSS px) of a tick label in the canvas tick font; an estimate where there is no 2D canvas. */
export function labelWidth(text: string, theme: ChartTheme = getThemeSnapshot()): number {
  const font = canvasFont(theme, Y_LABEL_PX);
  const key = `${font}|${text}`;
  const hit = widthCache.get(key);
  if (hit !== undefined) return hit;
  if (measureCtx === undefined) {
    try {
      measureCtx = typeof document === 'undefined' ? null : (document.createElement('canvas').getContext('2d') ?? null);
    } catch {
      measureCtx = null;
    }
  }
  let w: number;
  if (measureCtx && typeof measureCtx.measureText === 'function') {
    measureCtx.font = font;
    w = measureCtx.measureText(text).width;
  } else w = text.length * Y_LABEL_PX * 0.62;
  if (!Number.isFinite(w)) w = text.length * Y_LABEL_PX * 0.62;
  if (widthCache.size > 4000) widthCache.clear();
  widthCache.set(key, w);
  return w;
}

/**
 * The tick column (CSS px, from its left edge to the data area) that shows these labels whole: the widest label plus
 * the gap, the printed tick and the spine. Callers add their outer inset.
 */
export function yAxisWidth(labels: readonly string[], theme?: ChartTheme): number {
  let w = 0;
  for (const l of labels) w = Math.max(w, labelWidth(l, theme));
  return w > 0 ? w + Y_GAP_PX + Y_TICK_PX + Y_SPINE_PX : 0;
}

/**
 * Y tick labels in the tick column, right-aligned against the printed ticks at the data edge. The column is the plot's
 * left padding; charts size it with `yAxisWidth` so no label runs past the canvas edge.
 */
export function drawYAxis(a: DrawArgs, ticks: readonly number[], o: YAxisOptions): void {
  const { ctx, dpr } = a;
  const tick = (o.tickCss ?? Y_TICK_PX) * dpr;
  const labels = yAxisLabels(ticks, o);
  ctx.save();
  ctx.font = canvasFont(a.theme, Y_LABEL_PX * dpr);
  ctx.fillStyle = a.theme.ink3;
  ctx.strokeStyle = a.theme.ink3;
  ctx.lineWidth = Math.max(1, Math.round(dpr));
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const half = 5.5 * dpr;
  // printed scale: a hairline spine at the data edge with ticks protruding into the tick column
  const sx = crisp(a.box.left - Y_SPINE_PX * dpr, dpr);
  ctx.strokeStyle = a.theme.axis;
  ctx.beginPath();
  ctx.moveTo(sx, a.box.top);
  ctx.lineTo(sx, a.box.top + a.box.height);
  ctx.stroke();
  ctx.strokeStyle = a.theme.ink3;
  ctx.beginPath();
  ticks.forEach((t, k) => {
    const yy = a.y(t);
    if (yy < a.box.top - 1 || yy > a.box.top + a.box.height + 1) return;
    const cy = crisp(yy, dpr);
    ctx.moveTo(sx - tick, cy);
    ctx.lineTo(sx, cy);
    const ly = o.clampLabels === false ? yy : Math.min(a.canvasH - half, Math.max(half, yy));
    ctx.fillText(labels[k]!, sx - tick - Y_GAP_PX * dpr, ly);
  });
  ctx.stroke();
  ctx.restore();
}

/**
 * Tick label: plain nice numbers; in narrow tick columns (< 40 px) thousands are
 * compacted ("2k", "−1.5k") so labels never clip. Readouts keep full numbers.
 */
export function formatTick(v: number, step: number, colCss = 40): string {
  if (colCss < 40 && Math.abs(v) >= 1000) {
    const k = v / 1000;
    return formatNumber(k, Number.isInteger(k) ? 0 : 1) + 'k';
  }
  return formatNumber(v, decimalsForStep(step));
}

/** Closed band path between lo and hi over [i0, i1]; NaNs split the band. */
export function drawBand(
  a: DrawArgs,
  xs: ArrayLike<number>,
  lo: ArrayLike<number>,
  hi: ArrayLike<number>,
  i0: number,
  i1: number,
  fill: string | CanvasPattern,
): void {
  const { ctx } = a;
  ctx.save();
  clipToPlot(a);
  ctx.fillStyle = fill;
  let start = -1;
  const flush = (end: number) => {
    if (start < 0 || end < start) return;
    ctx.beginPath();
    ctx.moveTo(a.x(xs[start]!), a.y(hi[start]!));
    for (let i = start + 1; i <= end; i++) ctx.lineTo(a.x(xs[i]!), a.y(hi[i]!));
    for (let i = end; i >= start; i--) ctx.lineTo(a.x(xs[i]!), a.y(lo[i]!));
    ctx.closePath();
    ctx.fill();
    start = -1;
  };
  for (let i = i0; i <= i1; i++) {
    const ok = Number.isFinite(lo[i]!) && Number.isFinite(hi[i]!);
    if (ok && start < 0) start = i;
    if (!ok) flush(i - 1);
  }
  flush(i1);
  ctx.restore();
}

/** Layer 4: solid 1 px ink-3 threshold lines with right-aligned 11 px labels (zones never tinted). */
export function drawThresholds(
  a: DrawArgs,
  thresholds: ReadonlyArray<{ value: number; label: string }> | undefined,
  opts: { labels?: boolean; format?: (v: number) => string } = {},
): void {
  if (!thresholds?.length) return;
  const { ctx, dpr } = a;
  ctx.save();
  clipToPlot(a, 0, 0);
  ctx.strokeStyle = withAlpha(a.theme.ink3, 0.8);
  ctx.lineWidth = Math.max(1, Math.round(dpr));
  ctx.font = canvasFont(a.theme, 11 * dpr);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  for (const t of thresholds) {
    if (t.value < a.yMin || t.value > a.yMax) continue;
    const yy = crisp(a.y(t.value), dpr);
    ctx.beginPath();
    ctx.moveTo(a.box.left, yy);
    ctx.lineTo(a.box.left + a.box.width, yy);
    ctx.stroke();
    if (opts.labels !== false) {
      const text = `${opts.format ? opts.format(t.value) : t.value} · ${t.label}`;
      const room = yy - a.box.top;
      const ty = room > 13 * dpr ? yy - 3 * dpr : yy + 13 * dpr;
      haloText(a, text, a.box.left + a.box.width - 4 * dpr, ty, a.theme.ink3);
    }
  }
  ctx.restore();
}

/** Reference range: faint achromatic band + hairline edges + label (never a hue). */
export function drawReference(a: DrawArgs, ref: { lo: number; hi: number; label?: string } | undefined, labels = true): void {
  if (!ref) return;
  const { ctx, dpr } = a;
  const top = a.y(Math.min(a.yMax, ref.hi));
  const bot = a.y(Math.max(a.yMin, ref.lo));
  if (bot <= top) return;
  ctx.save();
  clipToPlot(a);
  ctx.fillStyle = withAlpha(a.theme.ink, a.theme.dark ? 0.05 : 0.04);
  ctx.fillRect(a.box.left, top, a.box.width, bot - top);
  if (labels && ref.label) {
    ctx.font = canvasFont(a.theme, 11 * dpr);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    if (bot - top > 13 * dpr) haloText(a, ref.label, a.box.left + 6 * dpr, top + 2 * dpr, a.theme.ink3, 'left');
  }
  ctx.restore();
}

/** Text with a surface-coloured halo so it never sits illegibly on marks. */
export function haloText(a: DrawArgs, text: string, x: number, y: number, color: string, align: CanvasTextAlign = 'right'): void {
  const { ctx, dpr } = a;
  ctx.save();
  ctx.textAlign = align;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = a.theme.face;
  ctx.lineWidth = 3 * dpr;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** Layer 7: safety events add a 1 px vertical severity line through every lane at 30 % opacity. */
export function drawSeverityLines(a: DrawArgs, events: readonly ChartEvent[] | undefined): void {
  if (!events?.length) return;
  const { ctx, dpr } = a;
  ctx.save();
  ctx.globalAlpha = 0.3;
  for (const e of events) {
    if (!e.severity || e.severity === 'info') continue;
    const t = e.day + (e.hour != null ? e.hour / 24 : 0.5);
    if (t < a.x0 || t > a.x1) continue;
    ctx.fillStyle = e.severity === 'danger' ? a.theme.severity.danger : a.theme.severity.caution;
    ctx.fillRect(Math.round(a.x(t)), 0, Math.max(1, Math.round(dpr)), a.canvasH);
  }
  ctx.restore();
}

/* ------------------------------------------------------- r071 chart skin */

/** Radius (CSS px) of an end dot: the focused lane's, and every other lane's small static one. */
export const END_DOT_R = { focus: 5, lane: 3.5 } as const;

export interface EndDotOptions {
  /** `focus` r 5, `lane` r 3.5 (the default), or a radius in CSS px (the overlay and comparison markers are 4). */
  size?: 'focus' | 'lane' | number;
  /** The mark's shape: a series' marker identity (overlay) or a circle. */
  shape?: MarkerShape;
  /** False: the dot and its ring only (the start marker). Default true; it also needs `theme.glow`. */
  glow?: boolean;
}

/**
 * The end of a line (AUDIT §1.4 "GlowLine"): the hue fill, a 2 px surface ring (`--lm-chart-ring`) and, when the theme
 * allows a glow, a flat halo disc (hue at 18 %, spread 6 px) and a soft glow (hue at 45 %, blur 12 px) on a dot of
 * r 4 or more. The glow is the shadow of the ring disc, so the dot's own pixels stay crisp, and it is one `shadowBlur`
 * draw per mark inside save()/restore(): never on the line. Forced colours, high contrast and reduced motion draw the dot
 * and its ring only.
 */
export function drawEndDot(a: DrawArgs, cx: number, cy: number, hue: string, o: EndDotOptions = {}): void {
  const { ctx, dpr, theme } = a;
  const size = o.size ?? 'lane';
  const radius = typeof size === 'number' ? size : END_DOT_R[size];
  const big = radius >= 4;
  const r = radius * dpr;
  const shape = o.shape ?? 'circle';
  ctx.save();
  if (theme.glow && o.glow !== false) {
    const d = theme.dot;
    if (big) {
      ctx.fillStyle = withAlpha(hue, d.haloAlpha);
      ctx.beginPath();
      ctx.arc(cx, cy, r + d.haloSpread * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowColor = withAlpha(hue, big ? d.glowAlpha : d.glowAlpha * 0.8);
    ctx.shadowBlur = (big ? d.glowBlur : d.glowBlur * 0.6) * dpr;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }
  ctx.fillStyle = theme.ring;
  ctx.beginPath();
  markerPath(ctx, shape, cx, cy, r + 2 * dpr);
  ctx.fill();
  ctx.shadowColor = 'rgba(0,0,0,0)';
  ctx.shadowBlur = 0;
  ctx.fillStyle = hue;
  ctx.beginPath();
  markerPath(ctx, shape, cx, cy, r);
  ctx.fill();
  ctx.restore();
}

const gradientCache = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasGradient>>();
/** A context holds at most this many gradients (a few lanes' worth at a few scales); a full cache starts over. */
export const GRADIENT_CACHE_MAX = 48;

/**
 * A vertical gradient of `hue`, `alpha` at canvas y `top` fading to 0 at `bottom`, built once per (ctx, hue, alpha, top,
 * bottom) the way `hatch()` keeps its patterns, so a redraw that did not move the lane (a crosshair frame, a pan on a
 * fixed scale) allocates nothing. Rows are rounded to whole canvas px. Null where the colour cannot fade (a system
 * colour under forced colours).
 */
export function areaGradient(ctx: CanvasRenderingContext2D, hue: string, alpha: number, top: number, bottom: number): CanvasGradient | null {
  const from = withAlpha(hue, alpha);
  if (from === hue) return null;
  const y0 = Math.round(top);
  const y1 = Math.max(y0 + 1, Math.round(bottom));
  const key = `${hue}|${alpha}|${y0}|${y1}`;
  let m = gradientCache.get(ctx);
  if (!m) {
    m = new Map();
    gradientCache.set(ctx, m);
  }
  const hit = m.get(key);
  if (hit) return hit;
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, from);
  g.addColorStop(1, withAlpha(hue, 0));
  if (m.size >= GRADIENT_CACHE_MAX) m.clear();
  m.set(key, g);
  return g;
}

/**
 * Layer 3 (r071 skin): the area of a single series that has no likely-range band: the hue at `theme.areaTop` (0.26) at
 * the series' highest visible point, 0 at the plot's baseline, under the line (the band does that job where there is
 * one). Gaps stay gaps: a run ends at a non-finite value. Returns false when nothing was drawn (forced colours, no
 * finite run of two points).
 */
export function drawAreaGradient(a: DrawArgs, xs: ArrayLike<number>, vs: ArrayLike<number>, i0: number, i1: number, hue: string, o: { alpha?: number } = {}): boolean {
  if (a.theme.forced) return false;
  const { ctx } = a;
  const base = a.box.top + a.box.height;
  let topY = Infinity;
  for (let i = Math.max(0, i0); i <= i1 && i < vs.length; i++) {
    const v = vs[i]!;
    if (!Number.isFinite(v)) continue;
    const y = a.y(v);
    if (y < topY) topY = y;
  }
  if (!Number.isFinite(topY)) return false;
  const g = areaGradient(ctx, hue, o.alpha ?? a.theme.areaTop, Math.min(topY, base - 1), base);
  if (!g) return false;
  ctx.save();
  clipToPlot(a);
  ctx.fillStyle = g;
  let drew = false;
  let start = -1;
  const flush = (end: number) => {
    if (start < 0 || end <= start) {
      start = -1;
      return;
    }
    ctx.beginPath();
    ctx.moveTo(a.x(xs[start]!), base);
    for (let i = start; i <= end; i++) ctx.lineTo(a.x(xs[i]!), a.y(vs[i]!));
    ctx.lineTo(a.x(xs[end]!), base);
    ctx.closePath();
    ctx.fill();
    drew = true;
    start = -1;
  };
  const last = Math.min(i1, vs.length - 1, xs.length - 1);
  for (let i = Math.max(0, i0); i <= last; i++) {
    if (Number.isFinite(vs[i]!) && Number.isFinite(xs[i]!)) {
      if (start < 0) start = i;
    } else flush(i - 1);
  }
  flush(last);
  ctx.restore();
  return drew;
}

/**
 * The last finite point of a series whose time is inside [x0, x1] (the line's end for this view), or null. `xs` is sorted
 * ascending; binary search, so a long hourly track costs a few steps.
 */
export function lastPointIn(xs: ArrayLike<number>, ys: ArrayLike<number | null>, x0: number, x1: number): { i: number; t: number; v: number } | null {
  let lo = 0;
  let hi = xs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (xs[mid]! <= x1 + 1e-9) lo = mid;
    else hi = mid - 1;
  }
  for (let i = Math.min(lo, xs.length - 1); i >= 0; i--) {
    const t = xs[i]!;
    if (t < x0 - 1e-9) return null;
    const v = ys[i];
    if (v != null && Number.isFinite(v) && t <= x1 + 1e-9) return { i, t, v };
  }
  return null;
}

/** Filled marker (≥ 8 px) with a 2 px surface ring. Size is the CSS diameter. */
export function drawMarker(a: DrawArgs, shape: MarkerShape, cx: number, cy: number, sizeCss: number, fill: string): void {
  const { ctx, dpr } = a;
  const r = (sizeCss / 2) * dpr;
  ctx.save();
  ctx.beginPath();
  markerPath(ctx, shape, cx, cy, r);
  ctx.lineWidth = 2 * dpr;
  ctx.strokeStyle = a.theme.ring;
  ctx.stroke();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();
}

export function markerPath(ctx: CanvasRenderingContext2D | Path2D, shape: MarkerShape, cx: number, cy: number, r: number): void {
  if (shape === 'square') {
    ctx.rect(cx - r * 0.9, cy - r * 0.9, r * 1.8, r * 1.8);
  } else if (shape === 'triangle') {
    ctx.moveTo(cx, cy - r * 1.1);
    ctx.lineTo(cx + r * 1.05, cy + r * 0.75);
    ctx.lineTo(cx - r * 1.05, cy + r * 0.75);
    ctx.closePath();
  } else {
    ctx.moveTo(cx + r, cy);
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
  }
}

/** Column with a 4 px rounded top and a square base (dataviz mark spec). */
export function columnPath(ctx: CanvasRenderingContext2D, x: number, yTop: number, w: number, yBase: number, radius: number): void {
  const h = yBase - yTop;
  if (h <= 0 || w <= 0) return;
  const r = Math.min(radius, w / 2, h);
  ctx.moveTo(x, yBase);
  ctx.lineTo(x, yTop + r);
  if (r > 0) ctx.arcTo(x, yTop, x + r, yTop, r);
  ctx.lineTo(x + w - r, yTop);
  if (r > 0) ctx.arcTo(x + w, yTop, x + w, yTop + r, r);
  ctx.lineTo(x + w, yBase);
  ctx.closePath();
}

/* --------------------------------------------------------------- textures */

const patternCache = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasPattern | null>>();

/** 45° / 135° hatch (1 px lines, 5 px pitch) for bands and stacked segments when textures are on. */
export function hatch(ctx: CanvasRenderingContext2D, color: string, angle: 45 | 135, dpr: number, dense = false): CanvasPattern | string {
  let m = patternCache.get(ctx);
  if (!m) {
    m = new Map();
    patternCache.set(ctx, m);
  }
  const key = `${color}|${angle}|${dpr}|${dense}`;
  if (m.has(key)) return m.get(key) ?? color;
  let pat: CanvasPattern | null = null;
  try {
    const pitch = Math.round((dense ? 3 : 5) * dpr);
    const c = document.createElement('canvas');
    c.width = pitch;
    c.height = pitch;
    const g = c.getContext('2d');
    if (g) {
      g.strokeStyle = color;
      g.lineWidth = Math.max(1, dpr);
      g.beginPath();
      if (angle === 45) {
        g.moveTo(0, pitch);
        g.lineTo(pitch, 0);
        g.moveTo(-1, 1);
        g.lineTo(1, -1);
        g.moveTo(pitch - 1, pitch + 1);
        g.lineTo(pitch + 1, pitch - 1);
      } else {
        g.moveTo(0, 0);
        g.lineTo(pitch, pitch);
        g.moveTo(pitch - 1, -1);
        g.lineTo(pitch + 1, 1);
        g.moveTo(-1, pitch - 1);
        g.lineTo(1, pitch + 1);
      }
      g.stroke();
      pat = ctx.createPattern(c, 'repeat');
    }
  } catch {
    pat = null;
  }
  m.set(key, pat);
  return pat ?? color;
}
