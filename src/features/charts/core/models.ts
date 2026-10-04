/* ==========================================================================
   Plot models: what each lane type draws (CHART_SPEC §4.2, §6 layers 1–7).
   A model is pure description + draw hooks; PlotEngine runs it.
   ========================================================================== */
import { KJ_PER_KCAL } from '@/components';
import { encodingsFor, laneKindOf } from '../catalogue';
import { m4 } from '../lib/downsample';
import { energyUnitOf } from '../lib/intake';
import { decimalsForStep, formatNumber, formatSigned } from '../lib/format';
import { baselineOf, laneDomain, type ResTrack, trackAt } from '../lib/series';
import { niceTicksInside } from '../lib/ticks';
import { visibleIndexRange } from '../lib/time';
import type { ChartEvent, ChartSeries, Phase, Resolution } from '../types';
import type { ViewState } from './controller';
import {
  drawBand,
  drawGrid,
  drawHLine,
  drawMarker,
  drawPhaseBands,
  drawReference,
  drawSeverityLines,
  drawThresholds,
  drawYAxis,
  type DrawArgs,
  haloText,
  hatch,
} from './draw';
import type { PlotData, PlotModel } from './plotEngine';
import { canvasFont, type ChartTheme, inkOn, withAlpha } from './theme';

export type LaneMode = 'lane' | 'strip' | 'focus';

/* ------------------------------------------------------- resolved tracks */

export interface Resolved {
  x: ArrayLike<number>;
  v: ArrayLike<number>;
  lo?: ArrayLike<number>;
  hi?: ArrayLike<number>;
  i0: number;
  i1: number;
  res: Resolution;
  decimated: boolean;
}

const fullData = new WeakMap<ResTrack, PlotData>();

/**
 * The samples to draw for a series in a view: the full track when it fits, M4-decimated
 * over the visible range when it has more than 2 × plot-width samples (CHART_SPEC §8.3).
 */
export function makeResolver(s: ChartSeries) {
  let last: { key: string; r: Resolved; data: PlotData } | null = null;
  return (view: ViewState, plotW: number): { r: Resolved; data: PlotData } => {
    const tr = trackAt(s, view.res);
    const n = tr.values.length;
    const [i0, i1] = visibleIndexRange(view.x0, view.x1, tr.res, n, 1);
    if (i1 - i0 + 1 <= 2 * plotW) {
      let data = fullData.get(tr);
      if (!data) {
        data = { x: tr.x, ys: [tr.values] };
        fullData.set(tr, data);
      }
      return { r: { x: tr.x, v: tr.values, lo: tr.lo, hi: tr.hi, i0, i1, res: tr.res, decimated: false }, data };
    }
    const key = `${tr.res}|${view.x0.toFixed(5)}|${view.x1.toFixed(5)}|${Math.round(plotW)}`;
    if (last && last.key === key) return last;
    const band = tr.lo && tr.hi ? { lo: tr.lo, hi: tr.hi } : undefined;
    const dec = m4(tr.x, tr.values, i0, i1, view.x0, view.x1, plotW, band);
    const r: Resolved = { x: dec.x, v: dec.y, lo: dec.lo, hi: dec.hi, i0: 0, i1: dec.x.length - 1, res: tr.res, decimated: true };
    last = { key, r, data: { x: dec.x, ys: [dec.y] } };
    return last;
  };
}

/* ------------------------------------------------------------ line lanes */

export interface LineLaneOptions {
  mode: LaneMode;
  tickColCss: number;
  fromZero?: boolean;
  phases?: readonly Phase[];
  events?: readonly ChartEvent[];
  textures?: boolean;
  /** Show threshold labels (lanes ≥ 60 px). */
  thresholdLabels?: boolean;
}

function bandFill(a: DrawArgs, color: string, textures: boolean | undefined, alphaScale = 1): string | CanvasPattern {
  if (textures || a.theme.forced) return hatch(a.ctx, color, 45, a.dpr);
  return withAlpha(color, a.theme.bandAlpha * alphaScale);
}

function yTicks(kind: string, mode: LaneMode, lo: number, hi: number) {
  if (kind === 'index') return mode === 'focus' ? { ticks: [0, 25, 50, 75, 100], step: 25 } : { ticks: [0, 50, 100], step: 50 };
  return niceTicksInside(lo, hi, mode === 'focus' ? { min: 4, max: 6 } : { min: 2, max: 3 });
}

export function lineLaneModel(s: ChartSeries, o: LineLaneOptions): PlotModel {
  const kind = laneKindOf(s);
  const resolve = makeResolver(s);
  const strip = o.mode === 'strip';
  const rangeOnly = kind === 'range-only';
  const color = (t: ChartTheme) => t.cat[s.category];
  let cached: { view: ViewState; plotW: number; r: Resolved } | null = null;
  const current = (view: ViewState, plotW: number) => {
    if (!cached || cached.view !== view || cached.plotW !== plotW) cached = { view, plotW, r: resolve(view, plotW).r };
    return cached.r;
  };
  let lastPlotW = 600;
  return {
    lines: [
      {
        color,
        width: strip ? 1.5 : rangeOnly ? 1 : 2,
        alpha: (t) => (strip ? t.dimAlpha * 1.6 : rangeOnly ? 0.5 : 1),
      },
    ],
    data(view, plotW) {
      lastPlotW = plotW;
      return resolve(view, plotW).data;
    },
    domain(view) {
      const tr = trackAt(s, view.res);
      return laneDomain(s, tr, view.x0, view.x1, { fromZero: o.fromZero });
    },
    under(a, view) {
      drawPhaseBands(a, o.phases);
      if (strip) return;
      const t = yTicks(kind, o.mode, a.yMin, a.yMax);
      drawGrid(a, t.ticks);
      if (kind === 'index' && o.mode !== 'focus') drawHLine(a, 50, a.theme.grid);
      drawReference(a, s.reference, o.mode !== 'strip');
      const r = current(view, lastPlotW);
      if (r.lo && r.hi) drawBand(a, r.x, r.lo, r.hi, r.i0, r.i1, bandFill(a, a.theme.cat[s.category], o.textures));
      if (a.yMin < 0 && a.yMax > 0) drawHLine(a, 0, a.theme.axis);
      drawThresholds(a, s.thresholds, { labels: o.thresholdLabels !== false });
      drawYAxis(a, t.ticks, { colCss: o.tickColCss, step: t.step });
    },
    over(a, view) {
      drawSeverityLines(a, o.events);
      if (strip) return;
      const col = a.theme.cat[s.category];
      const b0 = baselineOf(s);
      if (view.x0 <= 0.5 && Number.isFinite(b0)) drawMarker(a, 'circle', a.x(0), a.y(b0), 8, col);
      if (o.mode === 'focus') focusPointLabels(a, current(view, lastPlotW), s);
      if (rangeOnly) {
        a.ctx.font = canvasFont(a.theme, 11 * a.dpr, { stretch: 'condensed' });
        a.ctx.textBaseline = 'top';
        haloText(a, 'direction only', a.box.left + a.box.width - 4 * a.dpr, a.box.top + 2 * a.dpr, a.theme.ink3);
      }
    },
  };
}

/** Start / end / min / max point labels for the focused lane (CHART_SPEC §5.4). */
function focusPointLabels(a: DrawArgs, r: Resolved, s: ChartSeries): void {
  const d = s.format.decimals;
  let iMin = -1;
  let iMax = -1;
  let iFirst = -1;
  let iLast = -1;
  for (let i = r.i0; i <= r.i1; i++) {
    const t = r.x[i]!;
    if (t < a.x0 || t > a.x1) continue;
    const v = r.v[i]!;
    if (!Number.isFinite(v)) continue;
    if (iFirst < 0) iFirst = i;
    iLast = i;
    if (iMin < 0 || v < r.v[iMin]!) iMin = i;
    if (iMax < 0 || v > r.v[iMax]!) iMax = i;
  }
  if (iFirst < 0) return;
  const col = a.theme.cat[s.category];
  const { ctx, dpr } = a;
  ctx.font = canvasFont(a.theme, 11 * dpr, { weight: 600 });
  const placed: Array<[number, number]> = [];
  const put = (i: number, where: 'above' | 'below', align: CanvasTextAlign) => {
    const px = a.x(r.x[i]!);
    const py = a.y(r.v[i]!);
    if (placed.some(([x, y]) => Math.abs(x - px) < 40 * dpr && Math.abs(y - py) < 14 * dpr)) return;
    placed.push([px, py]);
    drawMarker(a, 'circle', px, py, 7, col);
    ctx.textBaseline = where === 'above' ? 'bottom' : 'top';
    const ty = where === 'above' ? py - 6 * dpr : py + 6 * dpr;
    const tx = align === 'left' ? px + 6 * dpr : align === 'right' ? px - 6 * dpr : px;
    haloText(a, formatNumber(r.v[i]!, d), tx, Math.max(a.box.top + 11 * dpr, Math.min(a.box.top + a.box.height, ty)), a.theme.ink, align);
  };
  put(iMax, 'above', 'center');
  put(iMin, 'below', 'center');
  put(iFirst, r.v[iFirst]! >= r.v[iMin]! + (r.v[iMax]! - r.v[iMin]!) / 2 ? 'below' : 'above', 'left');
  put(iLast, r.v[iLast]! >= r.v[iMin]! + (r.v[iMax]! - r.v[iMin]!) / 2 ? 'below' : 'above', 'right');
}

/* -------------------------------------------------------- stacked area */

export interface StackedOptions {
  mode: LaneMode;
  tickColCss: number;
  phases?: readonly Phase[];
  events?: readonly ChartEvent[];
  textures?: boolean;
  /** Direct labels at the right end (focus / standalone). */
  labels?: boolean;
}

const stackCache = new WeakMap<ChartSeries, { cum: Float32Array[]; total: Float32Array }>();
export function stackOf(s: ChartSeries) {
  const hit = stackCache.get(s);
  if (hit) return hit;
  const comps = s.stack?.components ?? [];
  const n = s.daily.values.length;
  const cum: Float32Array[] = [];
  let acc = new Float32Array(n);
  for (const c of comps) {
    const next = new Float32Array(n);
    for (let i = 0; i < n; i++) next[i] = acc[i]! + (c.daily[i] ?? 0);
    cum.push(next);
    acc = next;
  }
  const out = { cum, total: comps.length ? acc : s.daily.values };
  stackCache.set(s, out);
  return out;
}

export function stackedAreaModel(s: ChartSeries, o: StackedOptions): PlotModel {
  const strip = o.mode === 'strip';
  const { cum, total } = stackOf(s);
  const cf = s.stack?.counterfactual?.daily;
  const daily = trackAt(s, 'daily');
  const data: PlotData = { x: daily.x, ys: cf && !strip ? [total, cf] : [total] };
  return {
    lines: [
      { color: (t) => (strip ? t.cat.energy : t.ink), width: strip ? 1.5 : 1.5, alpha: (t) => (strip ? t.dimAlpha * 1.6 : 1) },
      ...(cf && !strip ? [{ color: (t: ChartTheme) => t.ink3, width: 1 }] : []),
    ],
    data: () => data,
    domain(view) {
      return laneDomain(s, daily, view.x0, view.x1);
    },
    under(a, view) {
      drawPhaseBands(a, o.phases);
      if (strip) return;
      const t = niceTicksInside(a.yMin, a.yMax, o.mode === 'focus' ? { min: 4, max: 6 } : { min: 2, max: 3 });
      drawGrid(a, t.ticks);
      const [i0, i1] = visibleIndexRange(view.x0, view.x1, 'daily', daily.x.length, 1);
      const { ctx, dpr } = a;
      ctx.save();
      ctx.beginPath();
      ctx.rect(a.box.left, a.box.top, a.box.width, a.box.height);
      ctx.clip();
      let prev: Float32Array | null = null;
      cum.forEach((c, k) => {
        const colr = a.theme.energyRamp[Math.min(3, k)]!;
        ctx.beginPath();
        ctx.moveTo(a.x(daily.x[i0]!), a.y(c[i0]!));
        for (let i = i0 + 1; i <= i1; i++) ctx.lineTo(a.x(daily.x[i]!), a.y(c[i]!));
        for (let i = i1; i >= i0; i--) ctx.lineTo(a.x(daily.x[i]!), a.y(prev ? prev[i]! : 0));
        ctx.closePath();
        ctx.fillStyle = o.textures || a.theme.forced ? hatch(ctx, colr, k % 2 ? 135 : 45, dpr, k > 1) : colr;
        ctx.fill();
        prev = c;
      });
      // 1 px surface-colour separators between layers
      ctx.strokeStyle = a.theme.face;
      ctx.lineWidth = Math.max(1, Math.round(dpr));
      for (let k = 0; k < cum.length - 1; k++) {
        const c = cum[k]!;
        ctx.beginPath();
        ctx.moveTo(a.x(daily.x[i0]!), a.y(c[i0]!));
        for (let i = i0 + 1; i <= i1; i++) ctx.lineTo(a.x(daily.x[i]!), a.y(c[i]!));
        ctx.stroke();
      }
      ctx.restore();
      drawYAxis(a, t.ticks, { colCss: o.tickColCss, step: t.step });
    },
    over(a, view) {
      drawSeverityLines(a, o.events);
      if (strip || !o.labels) return;
      const [, i1] = visibleIndexRange(view.x0, view.x1, 'daily', daily.x.length, 0);
      const { ctx, dpr } = a;
      ctx.font = canvasFont(a.theme, 11 * dpr, { weight: 500 });
      const comps = s.stack?.components ?? [];
      const xr = a.box.left + a.box.width - 6 * dpr;
      const boxes: Array<[number, number]> = [];
      const free = (top: number, bot: number) => boxes.every(([t, b]) => bot < t - 2 * dpr || top > b + 2 * dpr);
      if (cf) {
        // the stack arrives in its display unit (kcal/d or kJ/d); label the gap in the same unit
        const eu = energyUnitOf(s.unit);
        const step = eu === 'kJ' ? 10 : 1;
        const diff = cf[i1]! - total[i1]!;
        if (Math.abs(diff) >= 20 * (eu === 'kJ' ? KJ_PER_KCAL : 1)) {
          const yTop = Math.min(a.y(cf[i1]!), a.y(total[i1]!));
          const base = yTop - 4 * dpr;
          ctx.textBaseline = 'alphabetic';
          haloText(a, `adaptation ${formatSigned(Math.round(-diff / step) * step, 0)} ${eu}`, xr, base, a.theme.ink2);
          boxes.push([base - 11 * dpr, base + 2 * dpr]);
        }
      }
      ctx.textBaseline = 'middle';
      for (let k = cum.length - 1; k >= 0; k--) {
        const c = cum[k]!;
        const top = a.y(c[i1]!);
        const bot = a.y(k ? cum[k - 1]![i1]! : 0);
        if (bot - top < 14 * dpr) continue;
        const mid = (top + bot) / 2;
        if (!free(mid - 7 * dpr, mid + 7 * dpr)) continue;
        boxes.push([mid - 7 * dpr, mid + 7 * dpr]);
        const fill = a.theme.energyRamp[Math.min(3, k)]!;
        haloTextOn(a, comps[k]?.label ?? '', xr, mid, inkOn(fill, a.theme), false);
      }
    },
  };
}

function haloTextOn(a: DrawArgs, text: string, x: number, y: number, color: string, halo: boolean) {
  if (halo) {
    haloText(a, text, x, y, color);
    return;
  }
  a.ctx.save();
  a.ctx.textAlign = 'right';
  a.ctx.fillStyle = color;
  a.ctx.fillText(text, x, y);
  a.ctx.restore();
}

/* --------------------------------------------------------------- overlay */

export interface OverlaySeriesState {
  isolate: string | null;
  hidden: ReadonlySet<string>;
}

export interface OverlayOptions {
  tickColCss: number;
  phases?: readonly Phase[];
  events?: readonly ChartEvent[];
  state: OverlaySeriesState;
  smooth: boolean;
}

export interface OverlayResolved {
  x: Float64Array;
  values: Float32Array[];
}

/** One x grid for every overlay series (daily-only series are interpolated onto finer grids). */
export function overlayGrid(series: readonly ChartSeries[], res: Resolution, smooth: boolean, days: number, resolveTrack: (s: ChartSeries, res: Resolution, smooth: boolean) => { x: Float64Array; values: Float32Array } | null): OverlayResolved {
  const spd = res === 'daily' ? 1 : res === '6h' ? 4 : 24;
  const n = days * spd;
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = (i + 0.5) / spd;
  const values = series.map((s) => {
    const tr = resolveTrack(s, res, smooth);
    const out = new Float32Array(n).fill(NaN);
    if (!tr) return out;
    if (tr.x.length === n) return tr.values;
    // linear interpolation of the coarser track onto the grid
    const m = tr.x.length;
    let j = 0;
    for (let i = 0; i < n; i++) {
      const t = x[i]!;
      while (j < m - 2 && tr.x[j + 1]! < t) j++;
      const ta = tr.x[j]!;
      const tb = tr.x[Math.min(m - 1, j + 1)]!;
      const va = tr.values[j]!;
      const vb = tr.values[Math.min(m - 1, j + 1)]!;
      out[i] = t <= ta ? va : t >= tb ? vb : va + ((vb - va) * (t - ta)) / (tb - ta);
    }
    return out;
  });
  return { x, values };
}

export function overlayModel(
  series: readonly ChartSeries[],
  grid: (view: ViewState) => OverlayResolved,
  o: OverlayOptions,
): PlotModel {
  const enc = encodingsFor(series);
  const shown = series.filter((s) => !o.state.hidden.has(s.id));
  const cache = new WeakMap<OverlayResolved, PlotData>();
  const dataFor = (view: ViewState) => {
    const g = grid(view);
    let d = cache.get(g);
    if (!d) {
      d = { x: g.x, ys: shown.map((s) => g.values[series.indexOf(s)]!) };
      cache.set(g, d);
    }
    return { g, d };
  };
  return {
    lines: shown.map((s) => ({
      color: (t: ChartTheme) => t.cat[s.category],
      width: 2,
      dash: enc.get(s.id)?.dash,
      alpha: (t: ChartTheme) => (o.state.isolate && o.state.isolate !== s.id ? t.dimAlpha : 1),
    })),
    data: (view) => dataFor(view).d,
    domain(view) {
      const { g } = dataFor(view);
      let lo = 0;
      let hi = 0;
      const [i0, i1] = visibleIndexRange(view.x0, view.x1, view.res, g.x.length, 0);
      for (const s of shown) {
        const v = g.values[series.indexOf(s)]!;
        for (let i = i0; i <= i1; i++) {
          const y = v[i]!;
          if (!Number.isFinite(y)) continue;
          if (y < lo) lo = y;
          if (y > hi) hi = y;
        }
      }
      const pad = Math.max(1, (hi - lo) * 0.08);
      return [lo - pad, hi + pad];
    },
    under(a) {
      drawPhaseBands(a, o.phases);
      const t = niceTicksInside(a.yMin, a.yMax, { min: 4, max: 8 });
      drawGrid(a, t.ticks.filter((v) => v !== 0));
      drawHLine(a, 0, a.theme.dark ? a.theme.ink3 : a.theme.axis, 1);
      drawYAxis(a, t.ticks, {
        colCss: o.tickColCss,
        step: t.step,
        format: (v, st) => (v === 0 ? '0' : formatSigned(v, decimalsForStep(st))),
      });
    },
    over(a, view) {
      drawSeverityLines(a, o.events);
      const { g } = dataFor(view);
      const [, i1] = visibleIndexRange(view.x0, view.x1, view.res, g.x.length, 0);
      for (const s of shown) {
        const v = g.values[series.indexOf(s)]![i1]!;
        if (!Number.isFinite(v)) continue;
        const e = enc.get(s.id)!;
        const dim = o.state.isolate && o.state.isolate !== s.id;
        a.ctx.save();
        a.ctx.globalAlpha = dim ? a.theme.dimAlpha : 1;
        drawMarker(a, e.marker, a.x(g.x[i1]!), a.y(v), 8, a.theme.cat[s.category]);
        a.ctx.restore();
      }
    },
  };
}
