/* ==========================================================================
   Plan comparison multiples (CHART_SPEC §7.1) and the 24 h day lanes (§7.2).
   ========================================================================== */
import { decimalsForStep, formatNumber } from '../lib/format';
import { baselineOf, samplePositions, trackAt } from '../lib/series';
import { niceTicksInside } from '../lib/ticks';
import { visibleIndexRange } from '../lib/time';
import type { ChartSeries, DayWindow, ExerciseSession, PlanId } from '../types';
import { drawBand, drawGrid, drawMarker, drawYAxis, type DrawArgs, haloText, crisp } from './draw';
import type { PlotData, PlotModel } from './plotEngine';
import { canvasFont, type ChartTheme, withAlpha } from './theme';

export interface ComparePlan {
  id: PlanId;
  series: ChartSeries;
}

export interface CompareOptions {
  tickColCss: number;
  selected?: PlanId;
  target?: { value: number; label: string };
  isolate?: PlanId | null;
}

export function compareModel(plans: readonly ComparePlan[], o: CompareOptions): PlotModel {
  const first = plans[0]!.series;
  const x = samplePositions('daily', first.daily.values.length);
  const data: PlotData = { x, ys: plans.map((p) => p.series.daily.values) };
  return {
    lines: plans.map((p) => ({
      color: (t: ChartTheme) => t.plan[p.id],
      width: o.selected === p.id ? 2.5 : 2,
      alpha: (t: ChartTheme) => (o.isolate && o.isolate !== p.id ? t.dimAlpha : 1),
    })),
    data: () => data,
    domain(view) {
      const [i0, i1] = visibleIndexRange(view.x0, view.x1, 'daily', x.length, 0);
      let lo = Infinity;
      let hi = -Infinity;
      for (const p of plans) {
        const b = p.series.daily.band;
        for (let i = i0; i <= i1; i++) {
          const v = p.series.daily.values[i]!;
          lo = Math.min(lo, b ? b.lo[i]! : v, v);
          hi = Math.max(hi, b ? b.hi[i]! : v, v);
        }
        lo = Math.min(lo, baselineOf(p.series));
        hi = Math.max(hi, baselineOf(p.series));
      }
      if (o.target) {
        lo = Math.min(lo, o.target.value);
        hi = Math.max(hi, o.target.value);
      }
      if (first.unit === 'index') return [Math.max(0, lo - 5), Math.min(100, hi + 5)];
      const pad = (hi - lo || 1) * 0.1;
      return [lo - pad, hi + pad];
    },
    under(a, view) {
      const t = niceTicksInside(a.yMin, a.yMax, { min: 2, max: 4 });
      drawGrid(a, t.ticks);
      const [i0, i1] = visibleIndexRange(view.x0, view.x1, 'daily', x.length, 1);
      for (const p of plans) {
        const b = p.series.daily.band;
        if (!b) continue;
        const dim = o.isolate && o.isolate !== p.id;
        drawBand(a, x, b.lo, b.hi, i0, i1, withAlpha(a.theme.plan[p.id], a.theme.bandAlpha * (dim ? 0.2 : 0.5)));
      }
      if (o.target) {
        const { ctx, dpr } = a;
        ctx.save();
        ctx.strokeStyle = a.theme.ink;
        ctx.lineWidth = Math.max(1, Math.round(dpr));
        const yy = crisp(a.y(o.target.value), dpr);
        ctx.beginPath();
        ctx.moveTo(a.box.left, yy);
        ctx.lineTo(a.box.left + a.box.width, yy);
        ctx.stroke();
        ctx.font = canvasFont(a.theme, 12 * dpr, { weight: 500 });
        const above = yy - a.box.top > 16 * dpr;
        ctx.textBaseline = above ? 'bottom' : 'top';
        haloText(a, o.target.label, a.box.left + 6 * dpr, above ? yy - 3 * dpr : yy + 3 * dpr, a.theme.ink2, 'left');
        ctx.restore();
      }
      drawYAxis(a, t.ticks, { colCss: o.tickColCss, step: t.step, format: (v, st) => formatNumber(v, Math.max(decimalsForStep(st), 0)) });
    },
    over(a, view) {
      const b0 = baselineOf(first);
      if (view.x0 <= 0.5) drawMarker(a, 'circle', a.x(0), a.y(b0), 8, a.theme.ink);
      const [, i1] = visibleIndexRange(view.x0, view.x1, 'daily', x.length, 0);
      for (const p of plans) {
        const v = p.series.daily.values[i1]!;
        a.ctx.save();
        a.ctx.globalAlpha = o.isolate && o.isolate !== p.id ? a.theme.dimAlpha : 1;
        drawMarker(a, 'circle', a.x(x[i1]!), a.y(v), 8, a.theme.plan[p.id]);
        a.ctx.restore();
      }
    },
  };
}

/* ----------------------------------------------------------- 24 h lanes */

export interface DayLine {
  series: ChartSeries;
  dash?: readonly number[];
}

export interface DayContext {
  day: number;
  eating?: DayWindow[];
  sleep?: DayWindow[];
  sessions?: ExerciseSession[];
}

export interface DayLaneOptions {
  tickColCss: number;
  ctx: DayContext;
  /** Portion after this time (days) is faded to 40 % (next-day carry-over). */
  fadeFrom: number;
}

/** Background bands of the day view: eating window, sleep, training. */
export function drawDayBands(a: DrawArgs, c: DayContext): void {
  const { ctx } = a;
  ctx.save();
  ctx.beginPath();
  ctx.rect(a.box.left, 0, a.box.width, a.canvasH);
  ctx.clip();
  const band = (w: { day: number; startHour: number; endHour: number }, color: string) => {
    const l = a.x(w.day + w.startHour / 24);
    const r = a.x(w.day + w.endHour / 24);
    if (r < a.box.left || l > a.box.left + a.box.width) return;
    ctx.fillStyle = color;
    ctx.fillRect(l, 0, r - l, a.canvasH);
  };
  for (const w of c.sleep ?? []) if (w.day >= c.day - 1 && w.day <= c.day + 1) band(w, withAlpha(a.theme.cat.recovery, 0.1));
  for (const w of c.eating ?? []) if (w.day >= c.day - 1 && w.day <= c.day + 1) band(w, withAlpha(a.theme.ink, a.theme.dark ? 0.06 : 0.05));
  for (const s of c.sessions ?? [])
    if (s.day >= c.day - 1 && s.day <= c.day + 1 && s.type !== 'walk')
      band({ day: s.day, startHour: s.startHour, endHour: s.startHour + s.durationMin / 60 }, withAlpha(a.theme.cat.performance, 0.12));
  ctx.restore();
}

export function fadeAfter(a: DrawArgs, from: number): void {
  if (from >= a.x1) return;
  const l = Math.max(a.box.left, a.x(from));
  a.ctx.save();
  a.ctx.fillStyle = withAlpha(a.theme.face.startsWith('#') ? a.theme.face : '#ffffff', 0.6);
  a.ctx.fillRect(l, 0, a.box.left + a.box.width - l + 1, a.canvasH);
  a.ctx.restore();
}

export function dayLaneModel(lines: readonly DayLine[], o: DayLaneOptions): PlotModel {
  const first = lines[0]!.series;
  const tr = trackAt(first, 'hourly');
  const data: PlotData = { x: tr.x, ys: lines.map((l) => trackAt(l.series, 'hourly').values) };
  const isIndex = first.unit === 'index';
  return {
    lines: lines.map((l) => ({ color: (t: ChartTheme) => t.cat[l.series.category], width: 2, dash: l.dash })),
    data: () => data,
    domain(view) {
      if (isIndex) return [0, 100];
      let lo = Infinity;
      let hi = -Infinity;
      const [i0, i1] = visibleIndexRange(view.x0, view.x1, 'hourly', tr.x.length, 0);
      for (const l of lines) {
        const t2 = trackAt(l.series, 'hourly');
        for (let i = i0; i <= i1; i++) {
          const v = t2.values[i]!;
          lo = Math.min(lo, t2.lo ? t2.lo[i]! : v, v);
          hi = Math.max(hi, t2.hi ? t2.hi[i]! : v, v);
        }
      }
      for (const th of first.thresholds ?? []) if (th.value <= hi * 1.6 && th.value >= lo) hi = Math.max(hi, th.value);
      const pad = (hi - lo || 1) * 0.1;
      const lo2 = first.domain === 'zero' ? 0 : lo - pad;
      return [lo2, hi + pad];
    },
    under(a, view) {
      drawDayBands(a, o.ctx);
      const t = isIndex ? { ticks: [0, 50, 100], step: 50 } : niceTicksInside(a.yMin, a.yMax, { min: 2, max: 3 });
      drawGrid(a, t.ticks);
      const t2 = trackAt(first, 'hourly');
      const [i0, i1] = visibleIndexRange(view.x0, view.x1, 'hourly', t2.x.length, 1);
      if (t2.lo && t2.hi) drawBand(a, t2.x, t2.lo, t2.hi, i0, i1, withAlpha(a.theme.cat[first.category], a.theme.bandAlpha));
      for (const th of first.thresholds ?? []) {
        if (th.value < a.yMin || th.value > a.yMax) continue;
        const yy = crisp(a.y(th.value), a.dpr);
        a.ctx.save();
        a.ctx.strokeStyle = withAlpha(a.theme.ink3, 0.8);
        a.ctx.lineWidth = Math.max(1, Math.round(a.dpr));
        a.ctx.beginPath();
        a.ctx.moveTo(a.box.left, yy);
        a.ctx.lineTo(a.box.left + a.box.width, yy);
        a.ctx.stroke();
        a.ctx.restore();
      }
      drawYAxis(a, t.ticks, { colCss: o.tickColCss, step: t.step });
    },
    over(a) {
      fadeAfter(a, o.fadeFrom);
    },
  };
}
