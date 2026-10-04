/* ==========================================================================
   Inputs lane (CHART_SPEC §4.4, §7.4) and the energy-vs-maintenance lane.
   ========================================================================== */
import { toEnergyUnit, type EnergyUnitChoice } from '@/components';
import { DAY_VIEW_AT_OR_BELOW, KCAL_PER_GRAM, MACRO_ORDER } from '../catalogue';

import { energyStep, intakeEnergy } from '../lib/intake';
import { samplePositions } from '../lib/series';
import { niceTicksInside } from '../lib/ticks';
import { visibleIndexRange } from '../lib/time';
import type { ChartEvent, IntakeContext, MacroKey, Phase } from '../types';
import type { ViewState } from './controller';
import {
  columnPath,
  crisp,
  drawGrid,
  drawHLine,
  drawPhaseBands,
  drawSeverityLines,
  drawYAxis,
  type DrawArgs,
  formatTick,
  haloText,
  hatch,
  markerPath,
} from './draw';
import type { PlotData, PlotModel } from './plotEngine';
import { canvasFont, withAlpha } from './theme';

/** Stack mode: energy (in `energyUnit`; the id stays 'kcal'), grams, or % of energy. */
export type InputsMode = 'kcal' | 'grams' | 'pct';

export interface InputsOptions {
  mode: InputsMode;
  /** Show fibre (≈ 2 kcal/g) in the energy stack. */
  detail: boolean;
  /** Display unit of the energy stack, maintenance line and meal columns (Settings › energy; default kcal). */
  energyUnit?: EnergyUnitChoice;
  tickColCss: number;
  phases?: readonly Phase[];
  events?: readonly ChartEvent[];
  textures?: boolean;
}

/** Bottom padding reserved for exercise ticks under the bars (CSS px). */
export const INPUTS_TICK_ROW = 14;

const TEXTURE: Record<MacroKey, { angle: 45 | 135; dense: boolean } | null> = {
  protein: null,
  netCarbs: { angle: 45, dense: false },
  fibre: { angle: 135, dense: false },
  fat: { angle: 45, dense: true },
  alcohol: { angle: 135, dense: true },
};

export function stackKeys(detail: boolean): MacroKey[] {
  return MACRO_ORDER.filter((k) => detail || k !== 'fibre');
}

export const isMealView = (view: ViewState): boolean => view.x1 - view.x0 <= DAY_VIEW_AT_OR_BELOW + 1e-6;

export function inputsModel(intake: IntakeContext, o: InputsOptions): PlotModel {
  const days = intake.maintenance.length;
  const x = samplePositions('daily', days);
  const unit = o.energyUnit ?? 'kcal';
  // energy in the display unit (kcal or kJ); % and grams modes are unit-free
  const kc = intakeEnergy(intake, unit);
  const maint = kc.maintenance;
  const ef = toEnergyUnit(1, unit);
  const keys = stackKeys(o.detail);
  const groupKeys: MacroKey[] = o.detail ? ['protein', 'netCarbs', 'fibre', 'fat', 'alcohol'] : ['protein', 'netCarbs', 'fat'];
  const data: PlotData = { x, ys: [] };
  const mealEnergy = (m: NonNullable<IntakeContext['meals']>[number]) =>
    keys.reduce((acc, k) => acc + m.grams[k] * KCAL_PER_GRAM[k], 0) * ef;

  const fill = (a: DrawArgs, k: MacroKey) => {
    const c = a.theme.macro[k];
    const tx = TEXTURE[k];
    return (o.textures || a.theme.forced) && tx ? hatch(a.ctx, c, tx.angle, a.dpr, tx.dense) : c;
  };

  return {
    lines: [],
    data: () => data,
    domain(view) {
      if (isMealView(view)) {
        let mx = 0;
        for (const m of intake.meals ?? []) if (m.day + m.startHour / 24 >= view.x0 - 1 && m.day <= view.x1) mx = Math.max(mx, mealEnergy(m));
        return [0, Math.max(200 * ef, mx * 1.2)];
      }
      if (o.mode === 'pct') return [0, 100];
      const [i0, i1] = visibleIndexRange(view.x0, view.x1, 'daily', days, 0);
      let mx = 0;
      for (let i = i0; i <= i1; i++) {
        if (o.mode === 'kcal') mx = Math.max(mx, o.detail ? kc.totalWithFibre[i]! : kc.total[i]!, maint[i]!);
        else for (const k of groupKeys) mx = Math.max(mx, intake.grams[k][i]!);
      }
      return [0, Math.max(1, mx * 1.1)];
    },
    under(a, view) {
      drawPhaseBands(a, o.phases);
      const t = o.mode === 'pct' && !isMealView(view) ? { ticks: [0, 50, 100], step: 50 } : niceTicksInside(a.yMin, a.yMax, { min: 2, max: 3 });
      drawGrid(a, t.ticks.filter((v) => v !== 0));
      drawHLine(a, 0, a.theme.axis);
      const { ctx, dpr } = a;
      const base = a.y(0);
      ctx.save();
      ctx.beginPath();
      ctx.rect(a.box.left, a.box.top - 2 * dpr, a.box.width, a.box.height + 2 * dpr);
      ctx.clip();
      if (isMealView(view)) drawMeals(a, view);
      else if (o.mode === 'grams') drawGrouped(a, view, base);
      else drawStacked(a, view, base);
      ctx.restore();
      drawYAxis(a, t.ticks, { colCss: o.tickColCss, step: t.step, format: (v, st) => (o.mode === 'pct' ? `${v}` : formatTick(v, st, o.tickColCss)) });
    },
    over(a, view) {
      drawSeverityLines(a, o.events);
      if (!isMealView(view)) {
        drawExerciseRow(a, view);
        if (o.mode === 'kcal') drawMaintenance(a, view);
      }
    },
  };

  function slotPx(a: DrawArgs, view: ViewState) {
    return a.box.width / (view.x1 - view.x0 || 1);
  }

  function drawStacked(a: DrawArgs, view: ViewState, base: number) {
    const { ctx, dpr } = a;
    const slot = slotPx(a, view);
    const bw = Math.min(24 * dpr, slot * 0.72);
    const gap = 2 * dpr;
    const [i0, i1] = visibleIndexRange(view.x0, view.x1, 'daily', days, 1);
    const pct = o.mode === 'pct';
    if (bw < 3 * dpr) {
      // stepped stacked area when columns would be thinner than 3 px
      let prev: number[] | null = null;
      for (const k of keys) {
        const tops: number[] = [];
        ctx.beginPath();
        for (let i = i0; i <= i1; i++) {
          const tot = o.detail ? kc.totalWithFibre[i]! : kc.total[i]!;
          const v = pct ? (tot > 0 ? (kc.byMacro[k][i]! / tot) * 100 : 0) : kc.byMacro[k][i]!;
          tops.push((prev ? prev[i - i0]! : 0) + v);
        }
        ctx.moveTo(a.x(i0), a.y(tops[0]!));
        for (let i = i0; i <= i1; i++) {
          const yy = a.y(tops[i - i0]!);
          ctx.lineTo(a.x(i), yy);
          ctx.lineTo(a.x(i + 1), yy);
        }
        for (let i = i1; i >= i0; i--) {
          const yy = a.y(prev ? prev[i - i0]! : 0);
          ctx.lineTo(a.x(i + 1), yy);
          ctx.lineTo(a.x(i), yy);
        }
        ctx.closePath();
        ctx.fillStyle = fill(a, k);
        ctx.fill();
        prev = tops;
      }
      return;
    }
    const r = bw >= 6 * dpr ? 4 * dpr : 0;
    for (let i = i0; i <= i1; i++) {
      const cx = a.x(x[i]!);
      const left = cx - bw / 2;
      const tot = o.detail ? kc.totalWithFibre[i]! : kc.total[i]!;
      if (tot <= 0) {
        // fast day: a short ink tick on the baseline reads as "0 kcal", not as missing data
        ctx.fillStyle = a.theme.ink;
        ctx.fillRect(Math.round(cx - dpr), base - 5 * dpr, 2 * dpr, 5 * dpr);
        continue;
      }
      let yb = base;
      const segs = keys.filter((k) => kc.byMacro[k][i]! > 0);
      segs.forEach((k, j) => {
        const v = pct ? (kc.byMacro[k][i]! / tot) * 100 : kc.byMacro[k][i]!;
        const h = base - a.y(v) + (a.y(0) - base);
        const top = yb - h;
        const segBase = j === 0 ? yb : yb - gap;
        if (segBase - top <= 0.5) {
          yb = top;
          return;
        }
        ctx.beginPath();
        if (j === segs.length - 1) columnPath(ctx, left, top, bw, segBase, r);
        else ctx.rect(left, top, bw, segBase - top);
        ctx.fillStyle = fill(a, k);
        ctx.fill();
        yb = top;
      });
    }
  }

  function drawGrouped(a: DrawArgs, view: ViewState, base: number) {
    const { ctx, dpr } = a;
    const slot = slotPx(a, view);
    const n = groupKeys.length;
    const gap = Math.min(2 * dpr, slot * 0.05);
    const cw = Math.max(1, Math.min(8 * dpr, (slot * 0.72 - gap * (n - 1)) / n));
    const [i0, i1] = visibleIndexRange(view.x0, view.x1, 'daily', days, 1);
    for (let i = i0; i <= i1; i++) {
      const cx = a.x(x[i]!);
      const left0 = cx - (n * cw + (n - 1) * gap) / 2;
      groupKeys.forEach((k, j) => {
        const v = intake.grams[k][i]!;
        if (v <= 0) return;
        ctx.beginPath();
        columnPath(ctx, left0 + j * (cw + gap), a.y(v), cw, base, cw >= 6 * dpr ? 3 * dpr : 0);
        ctx.fillStyle = fill(a, k);
        ctx.fill();
      });
    }
    // weekly average per macro: 1 px ink step line
    ctx.strokeStyle = a.theme.ink;
    ctx.lineWidth = Math.max(1, Math.round(dpr));
    for (const k of groupKeys) {
      ctx.beginPath();
      for (let w = Math.floor(i0 / 7); w * 7 <= i1; w++) {
        let s = 0;
        let c = 0;
        for (let i = w * 7; i < Math.min(days, w * 7 + 7); i++) {
          s += intake.grams[k][i]!;
          c++;
        }
        if (!c) continue;
        const yy = crisp(a.y(s / c), dpr);
        ctx.moveTo(a.x(w * 7), yy);
        ctx.lineTo(a.x(Math.min(days, w * 7 + 7)), yy);
      }
      ctx.stroke();
    }
  }

  function drawMeals(a: DrawArgs, view: ViewState) {
    const { ctx, dpr } = a;
    const base = a.y(0);
    const gap = 2 * dpr;
    for (const m of intake.meals ?? []) {
      const t0 = m.day + m.startHour / 24;
      const dur = Math.max(15, m.durationMin) / 1440;
      if (t0 + dur < view.x0 || t0 > view.x1) continue;
      const left = a.x(t0);
      const w = Math.max(3 * dpr, a.x(t0 + dur) - left);
      let yb = base;
      const segs = keys.filter((k) => m.grams[k] > 0);
      segs.forEach((k, j) => {
        const v = m.grams[k] * KCAL_PER_GRAM[k] * ef;
        const top = yb - (base - a.y(v));
        const segBase = j === 0 ? yb : yb - gap;
        if (segBase - top > 0.5) {
          ctx.beginPath();
          if (j === segs.length - 1) columnPath(ctx, left, top, w, segBase, Math.min(4 * dpr, w / 2));
          else ctx.rect(left, top, w, segBase - top);
          ctx.fillStyle = fill(a, k);
          ctx.fill();
        }
        yb = top;
      });
    }
  }

  function drawExerciseRow(a: DrawArgs, view: ViewState) {
    const { ctx, dpr } = a;
    const rowTop = a.box.top + a.box.height + 3 * dpr;
    const rowBot = rowTop + (INPUTS_TICK_ROW - 3) * dpr;
    const slot = slotPx(a, view);
    const perf = a.theme.cat.performance;
    ctx.save();
    ctx.beginPath();
    ctx.rect(a.box.left, rowTop - dpr, a.box.width, rowBot - rowTop + 2 * dpr);
    ctx.clip();
    if (intake.steps && slot >= 2 * dpr) {
      ctx.fillStyle = withAlpha(perf, 0.4);
      const [i0, i1] = visibleIndexRange(view.x0, view.x1, 'daily', days, 1);
      const w = Math.max(dpr, Math.min(6 * dpr, slot * 0.35));
      for (let i = i0; i <= i1; i++) {
        const st = intake.steps[i]!;
        if (st < 10000) continue;
        const h = Math.min(6, (st / 20000) * 6) * dpr;
        ctx.fillRect(a.x(x[i]!) + slot * 0.18, rowBot - h, w, h);
      }
    }
    const size = 5 * dpr;
    for (const s of intake.exercise ?? []) {
      if (s.type === 'walk') continue;
      const t = s.day + 0.5;
      if (t < view.x0 - 1 || t > view.x1 + 1) continue;
      const cx = a.x(t) - (slot >= 10 * dpr ? slot * 0.12 : 0);
      const cy = rowTop + 4 * dpr;
      ctx.beginPath();
      markerPath(ctx, s.type === 'resistance' ? 'square' : 'triangle', cx, cy, size / 2);
      ctx.fillStyle = perf;
      ctx.fill();
    }
    ctx.restore();
  }

  function drawMaintenance(a: DrawArgs, view: ViewState) {
    const { ctx, dpr } = a;
    const [i0, i1] = visibleIndexRange(view.x0, view.x1, 'daily', days, 1);
    ctx.save();
    ctx.beginPath();
    ctx.rect(a.box.left, a.box.top - 2 * dpr, a.box.width, a.box.height + 4 * dpr);
    ctx.clip();
    ctx.strokeStyle = a.theme.ink;
    ctx.lineWidth = 1.5 * dpr;
    ctx.lineJoin = 'miter';
    ctx.beginPath();
    for (let i = i0; i <= i1; i++) {
      const yy = a.y(maint[i]!);
      if (i === i0) ctx.moveTo(a.x(i), yy);
      else ctx.lineTo(a.x(i), yy);
      ctx.lineTo(a.x(i + 1), yy);
    }
    ctx.stroke();
    ctx.restore();

    // "maintenance" label at the right end, never over the step line (REVIEW_FINDINGS 8)
    ctx.save();
    ctx.font = canvasFont(a.theme, 11 * dpr, { stretch: 'condensed', weight: 500 });
    const text = 'maintenance';
    const w = ctx.measureText(text).width;
    const right = a.box.left + a.box.width - 4 * dpr;
    const left = right - w;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = Math.max(i0, Math.floor(view.x0)); i <= i1; i++) {
      const xl = a.x(i);
      const xr = a.x(i + 1);
      if (xr < left - 2 * dpr || xl > right + 2 * dpr) continue;
      const yy = a.y(maint[i]!);
      minY = Math.min(minY, yy);
      maxY = Math.max(maxY, yy);
    }
    if (Number.isFinite(minY)) {
      const above = minY - 4 * dpr;
      ctx.textBaseline = 'alphabetic';
      if (above - 9 * dpr >= a.box.top - 2 * dpr) haloText(a, text, right, above, a.theme.ink2);
      else {
        ctx.textBaseline = 'top';
        haloText(a, text, right, maxY + 4 * dpr, a.theme.ink2);
      }
    }
    ctx.restore();
  }
}

/* ---------------------------------------------------------- energy lane */

export interface EnergyOptions {
  tickColCss: number;
  /** Display unit of the balance columns and axis (Settings › energy; default kcal). */
  energyUnit?: EnergyUnitChoice;
  phases?: readonly Phase[];
  events?: readonly ChartEvent[];
  textures?: boolean;
}

export function energyModel(intake: IntakeContext, o: EnergyOptions): PlotModel {
  const days = intake.maintenance.length;
  const x = samplePositions('daily', days);
  const unit = o.energyUnit ?? 'kcal';
  const kc = intakeEnergy(intake, unit);
  const bal = kc.balance;
  const ef = toEnergyUnit(1, unit);
  const data: PlotData = { x, ys: [] };
  return {
    lines: [],
    data: () => data,
    domain(view) {
      const [i0, i1] = visibleIndexRange(view.x0, view.x1, 'daily', days, 0);
      let lo = 0;
      let hi = 0;
      for (let i = i0; i <= i1; i++) {
        lo = Math.min(lo, bal[i]!);
        hi = Math.max(hi, bal[i]!);
      }
      const pad = Math.max(50 * ef, (hi - lo) * 0.1);
      return [lo - (lo < 0 ? pad : 0), hi + (hi > 0 ? pad : pad / 2)];
    },
    under(a, view) {
      drawPhaseBands(a, o.phases);
      const t = niceTicksInside(a.yMin, a.yMax, { min: 2, max: 3 });
      drawGrid(a, t.ticks.filter((v) => v !== 0));
      const { ctx, dpr } = a;
      const slot = a.box.width / (view.x1 - view.x0 || 1);
      const bw = Math.max(dpr, Math.min(24 * dpr, slot * 0.72));
      const zero = a.y(0);
      const [i0, i1] = visibleIndexRange(view.x0, view.x1, 'daily', days, 1);
      ctx.save();
      ctx.beginPath();
      ctx.rect(a.box.left, a.box.top, a.box.width, a.box.height);
      ctx.clip();
      for (let i = i0; i <= i1; i++) {
        const frac = kc.maintenance[i]! > 0 ? kc.total[i]! / kc.maintenance[i]! : 1;
        const st = energyStep(frac);
        const col =
          st.side === 'fast'
            ? a.theme.energyFast
            : st.side === 'neutral'
              ? a.theme.axis
              : (st.side === 'deficit' ? a.theme.deficit : a.theme.surplus)[Math.max(0, st.step - 1)]!;
        const v = bal[i]!;
        const yv = a.y(v);
        const left = a.x(x[i]!) - bw / 2;
        const r = bw >= 6 * dpr ? 3 * dpr : 0;
        ctx.beginPath();
        if (v >= 0) columnPath(ctx, left, yv, bw, zero, r);
        else {
          // mirrored column: rounded end at the bottom
          ctx.save();
          ctx.translate(0, zero * 2);
          ctx.scale(1, -1);
          columnPath(ctx, left, zero * 2 - yv, bw, zero, r);
          ctx.restore();
        }
        if (st.side === 'fast' && a.theme.dark) {
          // dark: fast days get their own texture; white stays reserved for selection (REVIEW_FINDINGS 4)
          ctx.fillStyle = a.theme.deficit[3];
          ctx.fill();
          ctx.fillStyle = hatch(ctx, a.theme.ink2, 45, dpr, true);
        } else ctx.fillStyle = (o.textures || a.theme.forced) && st.side !== 'neutral' ? hatch(ctx, col, st.side === 'deficit' ? 45 : 135, dpr, st.step > 2) : col;
        ctx.fill();
      }
      ctx.restore();
      drawHLine(a, 0, a.theme.dark ? a.theme.ink3 : a.theme.edge, 1);
      drawYAxis(a, t.ticks, { colCss: o.tickColCss, step: t.step, format: (v, st) => (v === 0 ? '0' : (v > 0 ? '+' : '') + formatTick(v, st, o.tickColCss)) });
    },
    over(a) {
      drawSeverityLines(a, o.events);
    },
  };
}
