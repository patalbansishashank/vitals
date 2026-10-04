/* ==========================================================================
   Canvas drawing primitives for the annotation layers (CHART_SPEC §6).
   All coordinates are CANVAS pixels (CSS px × DPR) unless stated.
   Every helper saves/restores context state: uPlot caches ctx styles.
   ========================================================================== */
import type { MarkerShape } from '../catalogue';
import { decimalsForStep, formatNumber } from '../lib/format';
import type { ChartEvent, Phase } from '../types';
import { canvasFont, type ChartTheme, withAlpha } from './theme';

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

/** Layer 2: 1 px solid gridlines at the ticks. */
export function drawGrid(a: DrawArgs, ticks: readonly number[], color?: string): void {
  const { ctx } = a;
  ctx.save();
  ctx.strokeStyle = color ?? a.theme.grid;
  ctx.lineWidth = Math.max(1, Math.round(a.dpr));
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
  /** Width of the tick column (CSS px) to the left of the plot. */
  colCss: number;
  format?: (v: number, step: number) => string;
  step: number;
  /** Printed tick mark length (CSS px). */
  tickCss?: number;
  /** Keep labels inside the canvas vertically. */
  clampLabels?: boolean;
}

/** Y tick labels in the tick column, right-aligned 5 px from the data area, with printed ticks. */
export function drawYAxis(a: DrawArgs, ticks: readonly number[], o: YAxisOptions): void {
  const { ctx, dpr } = a;
  const tick = (o.tickCss ?? 4) * dpr;
  const fmt = o.format ?? ((v: number, step: number) => formatTick(v, step, o.colCss));
  ctx.save();
  ctx.font = canvasFont(a.theme, 11 * dpr, { stretch: 'condensed' });
  ctx.fillStyle = a.theme.ink3;
  ctx.strokeStyle = a.theme.ink3;
  ctx.lineWidth = Math.max(1, Math.round(dpr));
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const half = 5.5 * dpr;
  // printed scale: a hairline spine at the data edge with ticks protruding into the tick column
  const sx = crisp(a.box.left - dpr, dpr);
  ctx.strokeStyle = a.theme.axis;
  ctx.beginPath();
  ctx.moveTo(sx, a.box.top);
  ctx.lineTo(sx, a.box.top + a.box.height);
  ctx.stroke();
  ctx.strokeStyle = a.theme.ink3;
  ctx.beginPath();
  for (const t of ticks) {
    const yy = a.y(t);
    if (yy < a.box.top - 1 || yy > a.box.top + a.box.height + 1) continue;
    const cy = crisp(yy, dpr);
    ctx.moveTo(sx - tick, cy);
    ctx.lineTo(sx, cy);
    const ly = o.clampLabels === false ? yy : Math.min(a.canvasH - half, Math.max(half, yy));
    ctx.fillText(fmt(t, o.step), sx - tick - 3 * dpr, ly);
  }
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
  ctx.font = canvasFont(a.theme, 11 * dpr, { stretch: 'condensed' });
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
    ctx.font = canvasFont(a.theme, 11 * dpr, { stretch: 'condensed' });
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
