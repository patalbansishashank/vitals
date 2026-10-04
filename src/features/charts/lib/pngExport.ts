/* ==========================================================================
   PNG export of the channel stack (CHART_SPEC §11 "export"): a print-quality
   figure drawn from the chart data — not a screenshot of the DOM (lanes off
   screen have no canvas), so every chosen lane is included. Canvas → Blob →
   download; no dependency.

   Layout (CSS px, drawn at `scale`×): title + date range; the schedule blocks
   row; one lane per metric with its name, unit and end value in a left gutter,
   printed y ticks, the likely-range band and the line in the metric's category
   hue; a shared time axis; the disclaimer. Uses the live theme (light or dark).
   ========================================================================== */
import type { ChartTheme } from '../core/theme';
import { canvasFont, withAlpha } from '../core/theme';
import type { ChartSeries, Phase, Resolution, TimeBase } from '../types';
import { formatDay, formatNumber, weekOf } from './format';
import { trackAt } from './series';
import { niceTicksInside } from './ticks';
import { indexAt, visibleIndexRange } from './time';

export interface PngExportInput {
  time: TimeBase;
  series: readonly ChartSeries[];
  phases?: readonly Phase[];
  /** Window in days (defaults to the whole horizon). */
  x0?: number;
  x1?: number;
  title: string;
  subtitle?: string;
  disclaimer: string;
  theme: ChartTheme;
  /** Figure width in CSS px (default 1200) and pixel ratio (default 2). */
  width?: number;
  scale?: number;
}

const GUTTER = 200;
const PAD = 24;
const LANE_H = 92;
const LANE_GAP = 10;
const PHASE_H = 24;
const AXIS_H = 26;

/** Resolution for the export: hourly detail for windows of a week or less, else daily. */
function resFor(span: number): Resolution {
  return span <= 7 ? 'hourly' : 'daily';
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > maxW && line) {
      out.push(line);
      line = w;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

/** Draw the figure; returns the canvas (not attached to the document). */
export function renderChartPng(input: PngExportInput): HTMLCanvasElement {
  const { time, theme: t } = input;
  const W = input.width ?? 1200;
  const S = input.scale ?? 2;
  const x0 = Math.max(0, input.x0 ?? 0);
  const x1 = Math.min(time.days, input.x1 ?? time.days);
  const res = resFor(x1 - x0);
  const series = input.series.filter((s) => s.kind !== 'stacked-area' || s.daily.values.length > 0);

  const measure = document.createElement('canvas').getContext('2d');
  const discLines = measure ? ((measure.font = canvasFont(t, 11)), wrapLines(measure, input.disclaimer, W - 2 * PAD)) : [input.disclaimer];
  const headerH = input.subtitle ? 52 : 34;
  const H = PAD + headerH + PHASE_H + 8 + series.length * (LANE_H + LANE_GAP) + AXIS_H + 12 + discLines.length * 15 + PAD;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(W * S);
  canvas.height = Math.round(H * S);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.scale(S, S);
  ctx.fillStyle = t.face;
  ctx.fillRect(0, 0, W, H);

  const left = PAD + GUTTER;
  const right = W - PAD;
  const plotW = right - left;
  const X = (d: number) => left + ((d - x0) / Math.max(1e-9, x1 - x0)) * plotW;

  // header
  let y = PAD;
  ctx.fillStyle = t.ink;
  ctx.textBaseline = 'top';
  ctx.font = canvasFont(t, 18, { weight: 600 });
  ctx.fillText(input.title, PAD, y);
  if (input.subtitle) {
    ctx.fillStyle = t.ink2;
    ctx.font = canvasFont(t, 13);
    ctx.fillText(input.subtitle, PAD, y + 26);
  }
  y += headerH;

  // schedule blocks
  ctx.font = canvasFont(t, 11);
  ctx.fillStyle = t.ink2;
  ctx.textBaseline = 'middle';
  ctx.fillText('schedule blocks', PAD, y + PHASE_H / 2);
  (input.phases ?? []).forEach((p, k) => {
    const a = Math.max(p.startDay, x0);
    const b = Math.min(p.endDay, x1);
    if (a >= b) return;
    const l = X(a);
    const r = X(b);
    if (k % 2 === 1) {
      ctx.fillStyle = t.phaseAlt;
      ctx.fillRect(l, y, r - l, PHASE_H);
    }
    ctx.strokeStyle = t.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(l) + 0.5, y);
    ctx.lineTo(Math.round(l) + 0.5, y + PHASE_H);
    ctx.stroke();
    const full = p.balance && p.balance !== p.label ? `${p.label} · ${p.balance}` : p.label;
    const text = [full, p.label, p.shortLabel ?? '', p.letter ?? ''].find((s) => s && ctx.measureText(s).width <= r - l - 10) ?? '';
    if (text) {
      ctx.fillStyle = t.ink;
      ctx.fillText(text, l + 5, y + PHASE_H / 2);
    }
  });
  y += PHASE_H + 8;

  // lanes
  for (const s of series) {
    const tr = trackAt(s, res);
    const [i0, i1] = visibleIndexRange(x0, x1, tr.res, tr.values.length, 0);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = i0; i <= i1; i++) {
      const v = tr.values[i]!;
      if (Number.isFinite(v)) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
      if (tr.lo && Number.isFinite(tr.lo[i]!)) lo = Math.min(lo, tr.lo[i]!);
      if (tr.hi && Number.isFinite(tr.hi[i]!)) hi = Math.max(hi, tr.hi[i]!);
    }
    if (!Number.isFinite(lo)) {
      lo = 0;
      hi = 1;
    }
    if (s.kind === 'index') {
      lo = Math.max(0, lo - 5);
      hi = Math.min(100, hi + 5);
    }
    const pad = (hi - lo || Math.abs(hi) || 1) * 0.1;
    lo -= pad;
    hi += pad;
    const top = y;
    const Y = (v: number) => top + 6 + (1 - (v - lo) / (hi - lo)) * (LANE_H - 12);
    const colour = t.cat[s.category];

    // plot surface + ticks
    ctx.strokeStyle = t.line;
    ctx.strokeRect(left + 0.5, top + 0.5, plotW - 1, LANE_H - 1);
    const ticks = niceTicksInside(lo, hi, { min: 2, max: 3 });
    const td = Math.max(0, Math.min(3, Math.ceil(-Math.log10(ticks.step || 1))));
    ctx.font = canvasFont(t, 10.5, { stretch: 'condensed' });
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    for (const v of ticks.ticks) {
      const yy = Math.round(Y(v)) + 0.5;
      ctx.strokeStyle = t.grid;
      ctx.beginPath();
      ctx.moveTo(left, yy);
      ctx.lineTo(right, yy);
      ctx.stroke();
      ctx.fillStyle = t.ink3;
      ctx.fillText(formatNumber(v, td), left - 6, yy);
    }
    ctx.textAlign = 'left';

    // likely range + line
    if (tr.lo && tr.hi) {
      ctx.fillStyle = withAlpha(colour, t.bandAlpha * 1.4);
      ctx.beginPath();
      let started = false;
      for (let i = i0; i <= i1; i++) {
        const v = tr.hi[i]!;
        if (!Number.isFinite(v)) continue;
        const xx = X(tr.x[i]!);
        if (!started) ctx.moveTo(xx, Y(v));
        else ctx.lineTo(xx, Y(v));
        started = true;
      }
      for (let i = i1; i >= i0; i--) {
        const v = tr.lo[i]!;
        if (Number.isFinite(v)) ctx.lineTo(X(tr.x[i]!), Y(v));
      }
      ctx.closePath();
      if (started) ctx.fill();
    }
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1.75;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let pen = false;
    for (let i = i0; i <= i1; i++) {
      const v = tr.values[i]!;
      if (!Number.isFinite(v)) {
        pen = false;
        continue;
      }
      const xx = X(tr.x[i]!);
      if (!pen) ctx.moveTo(xx, Y(v));
      else ctx.lineTo(xx, Y(v));
      pen = true;
    }
    ctx.stroke();
    ctx.lineWidth = 1;

    // gutter: swatch, name, unit, end value
    ctx.fillStyle = colour;
    ctx.fillRect(PAD, top + 10, 10, 3);
    ctx.fillStyle = t.ink;
    ctx.textBaseline = 'top';
    ctx.font = canvasFont(t, 13, { weight: 600 });
    const nameLines = wrapLines(ctx, s.label, GUTTER - 64).slice(0, 2);
    nameLines.forEach((line, k) => ctx.fillText(line, PAD + 16, top + 4 + k * 16));
    ctx.font = canvasFont(t, 11);
    ctx.fillStyle = t.ink2;
    ctx.fillText(`${s.unit} · grade ${s.grade}`, PAD + 16, top + 6 + nameLines.length * 16);
    const endI = indexAt(x1 - 1e-6, tr.res, tr.values.length);
    const endV = tr.values[Math.min(i1, endI)]!;
    if (Number.isFinite(endV)) {
      ctx.font = canvasFont(t, 15, { weight: 500, stretch: 'wide' });
      ctx.fillStyle = t.ink;
      ctx.fillText(formatNumber(endV, s.format.decimals), PAD + 16, top + 26 + nameLines.length * 16);
    }
    y += LANE_H + LANE_GAP;
  }

  // time axis
  ctx.strokeStyle = t.axis;
  ctx.beginPath();
  ctx.moveTo(left, y + 0.5);
  ctx.lineTo(right, y + 0.5);
  ctx.stroke();
  ctx.font = canvasFont(t, 11, { stretch: 'condensed' });
  ctx.fillStyle = t.ink2;
  ctx.textBaseline = 'top';
  const span = x1 - x0;
  const stepDays = span <= 3 ? 0.25 : span <= 14 ? 1 : span <= 70 ? 7 : span <= 200 ? 14 : 28;
  for (let d = Math.ceil(x0 / stepDays) * stepDays; d <= x1 + 1e-9; d += stepDays) {
    const xx = Math.round(X(d)) + 0.5;
    ctx.strokeStyle = t.axis;
    ctx.beginPath();
    ctx.moveTo(xx, y);
    ctx.lineTo(xx, y + 5);
    ctx.stroke();
    const label = stepDays < 1 ? `${formatDay(time, d, 'short')} ${String(Math.round((d % 1) * 24)).padStart(2, '0')}:00` : stepDays >= 7 ? `wk ${weekOf(d)}` : formatDay(time, d, 'short');
    const w = ctx.measureText(label).width;
    if (xx - w / 2 >= left - 4 && xx + w / 2 <= right + 4) ctx.fillText(label, xx - w / 2, y + 8);
  }
  y += AXIS_H + 12;

  // disclaimer (never omitted: the figure may travel without the page)
  ctx.font = canvasFont(t, 11);
  ctx.fillStyle = t.ink2;
  discLines.forEach((line, k) => ctx.fillText(line, PAD, y + k * 15));
  return canvas;
}

/** Render and download as `fileName` (PNG). Resolves false when the browser cannot encode the canvas. */
export function downloadChartPng(input: PngExportInput, fileName = 'vitals-projection.png'): Promise<boolean> {
  const canvas = renderChartPng(input);
  return new Promise((resolve) => {
    if (typeof canvas.toBlob !== 'function') return resolve(false);
    canvas.toBlob((blob) => {
      if (!blob) return resolve(false);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      resolve(true);
    }, 'image/png');
  });
}
