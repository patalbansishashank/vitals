/**
 * The canvas half of the r071 chart skin (AUDIT §1.4 "Charts: visual layer"): the dotted dim grid, the end dot with its
 * ring and glow, the area gradient and its per-context cache, the last point of a line, the models that use them
 * (focused width, area only where there is no band, end dot, isolated overlay series, the balance ramp) and the theme
 * switches that turn the glow off. A recording 2D context stands in for the canvas.
 */
import './setupDom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChartSeries } from '../types';
import { overlayModel, lineLaneModel, stackedAreaModel } from '../core/models';
import { energyModel } from '../core/inputModels';
import {
  areaGradient,
  drawAreaGradient,
  drawEndDot,
  drawGrid,
  END_DOT_R,
  GRADIENT_CACHE_MAX,
  lastPointIn,
  type DrawArgs,
} from '../core/draw';
import type { ViewState } from '../core/controller';
import { readChartTheme, THEME_DEFAULTS, withAlpha, type ChartTheme } from '../core/theme';
import { makeChartData } from '../fixtures';

type Call = [string, ...unknown[]];

/** A 2D context that records every call and every property write; createLinearGradient hands out fresh stubs. */
function recorder() {
  const calls: Call[] = [];
  const gradients: Array<{ args: unknown[]; stops: Array<[number, string]> }> = [];
  const state: Record<string | symbol, unknown> = { canvas: { width: 1400, height: 240 } };
  const ctx = new Proxy(state, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'createLinearGradient')
        return (...args: unknown[]) => {
          const g = { args, stops: [] as Array<[number, string]>, addColorStop: (o: number, c: string) => g.stops.push([o, c]) };
          gradients.push(g);
          calls.push(['createLinearGradient', ...args]);
          return g;
        };
      if (prop === 'measureText') return (t: string) => ({ width: t.length * 6 });
      if (prop === 'createPattern') return () => ({});
      return (...args: unknown[]) => {
        calls.push([String(prop), ...args]);
      };
    },
    set(target, prop, value) {
      target[prop] = value;
      calls.push([`set:${String(prop)}`, value]);
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  const named = (name: string) => calls.filter((c) => c[0] === name);
  return { ctx, calls, gradients, named };
}

const VIEW: ViewState = { x0: 0, x1: 84, res: 'daily', animating: false };

function args(ctx: CanvasRenderingContext2D, theme: ChartTheme, over: Partial<DrawArgs> = {}): DrawArgs {
  const box = { left: 80, top: 16, width: 1200, height: 200 };
  const [x0, x1, yMin, yMax] = [0, 84, 0, 100];
  return {
    ctx,
    theme,
    dpr: 2,
    box,
    canvasW: 1400,
    canvasH: 240,
    x0,
    x1,
    yMin,
    yMax,
    x: (t) => box.left + ((t - x0) / (x1 - x0)) * box.width,
    y: (v) => box.top + (1 - (v - yMin) / (yMax - yMin)) * box.height,
    ...over,
  };
}

const theme = (over: Partial<ChartTheme> = {}): ChartTheme => ({ ...readChartTheme(), ...over });

afterEach(() => vi.restoreAllMocks());

describe('drawGrid: dotted and dim', () => {
  it('strokes 1 css px dots 3 px apart in the theme ink at the grid alpha, at every tick', () => {
    const { ctx, calls, named } = recorder();
    const t = theme();
    drawGrid(args(ctx, t), [20, 60]);
    expect(named('setLineDash')[0]![1]).toEqual([2, 6]); // dpr 2: 1 css px on, 3 css px off
    expect(calls.find((c) => c[0] === 'set:strokeStyle')![1]).toBe(t.gridDot);
    expect(t.gridDot).toBe(withAlpha(THEME_DEFAULTS['--lm-ink']!, Number(THEME_DEFAULTS['--lmc-grid-a'])));
    expect(named('set:lineWidth')[0]![1]).toBe(2);
    expect(named('lineTo')).toHaveLength(2);
    expect(named('stroke')).toHaveLength(1);
  });
  it('a caller colour wins (the baseline helpers stay solid and theirs)', () => {
    const { ctx, calls } = recorder();
    drawGrid(args(ctx, theme()), [50], '#123456');
    expect(calls.find((c) => c[0] === 'set:strokeStyle')![1]).toBe('#123456');
  });
});

describe('drawEndDot: ring, halo, glow', () => {
  const arcs = (named: (n: string) => Call[]) => named('arc').map((c) => c[3] as number);
  const fills = (calls: Call[]) => calls.filter((c) => c[0] === 'set:fillStyle').map((c) => c[1]);

  it('a lane dot is r 3.5 with a 2 px ring under it and a soft glow, no halo disc', () => {
    const { ctx, calls, named } = recorder();
    const t = theme({ glow: true });
    drawEndDot(args(ctx, t), 100, 50, '#5695E0', { size: 'lane' });
    expect(arcs(named)).toEqual([(END_DOT_R.lane + 2) * 2, END_DOT_R.lane * 2]);
    expect(fills(calls)).toEqual([t.ring, '#5695E0']);
    const blur = calls.find((c) => c[0] === 'set:shadowBlur' && (c[1] as number) > 0);
    expect(blur![1]).toBeCloseTo(t.dot.glowBlur * 0.6 * 2, 6);
    // the glow is one shadow, switched off again before the dot itself is drawn
    expect(calls.filter((c) => c[0] === 'set:shadowBlur').pop()![1]).toBe(0);
  });

  it('a focused dot is r 5: a halo disc 6 px past it at 18 %, then the ring, then the dot', () => {
    const { ctx, calls, named } = recorder();
    const t = theme({ glow: true });
    drawEndDot(args(ctx, t), 100, 50, '#E26B1B', { size: 'focus' });
    expect(arcs(named)).toEqual([(END_DOT_R.focus + t.dot.haloSpread) * 2, (END_DOT_R.focus + 2) * 2, END_DOT_R.focus * 2]);
    expect(fills(calls)).toEqual([withAlpha('#E26B1B', t.dot.haloAlpha), t.ring, '#E26B1B']);
    expect(calls.find((c) => c[0] === 'set:shadowColor')![1]).toBe(withAlpha('#E26B1B', t.dot.glowAlpha));
  });

  it('draws the dot and its ring only when the theme has no glow (forced colours, more contrast, reduced motion)', () => {
    const { ctx, calls, named } = recorder();
    drawEndDot(args(ctx, theme({ glow: false })), 100, 50, '#5695E0', { size: 'focus' });
    expect(arcs(named)).toEqual([(END_DOT_R.focus + 2) * 2, END_DOT_R.focus * 2]);
    expect(calls.some((c) => c[0] === 'set:shadowBlur' && (c[1] as number) > 0)).toBe(false);
  });

  it('glow: false (the start dot) skips the glow even when the theme has one', () => {
    const { ctx, calls } = recorder();
    drawEndDot(args(ctx, theme({ glow: true })), 100, 50, '#5695E0', { size: 'lane', glow: false });
    expect(calls.some((c) => c[0] === 'set:shadowBlur' && (c[1] as number) > 0)).toBe(false);
  });

  it('keeps a series marker shape (overlay identity is never colour alone) and takes a radius in px', () => {
    const { ctx, named } = recorder();
    drawEndDot(args(ctx, theme({ glow: false })), 100, 50, '#5695E0', { size: 4, shape: 'square' });
    expect(named('arc')).toHaveLength(0);
    expect(named('rect')).toHaveLength(2);
    const [ring, dot] = named('rect');
    expect(ring![3] as number).toBeCloseTo((4 + 2) * 2 * 1.8, 6);
    expect(dot![3] as number).toBeCloseTo(4 * 2 * 1.8, 6);
  });
});

describe('areaGradient: one gradient per (context, colour, alpha, top, bottom)', () => {
  it('builds once for the same key and again for a different one', () => {
    const { ctx, gradients } = recorder();
    const a = areaGradient(ctx, '#5695E0', 0.26, 40, 400);
    const b = areaGradient(ctx, '#5695E0', 0.26, 40, 400);
    expect(b).toBe(a);
    expect(gradients).toHaveLength(1);
    expect(areaGradient(ctx, '#5695E0', 0.26, 60, 400)).not.toBe(a);
    expect(areaGradient(ctx, '#E26B1B', 0.26, 40, 400)).not.toBe(a);
    expect(areaGradient(ctx, '#5695E0', 0.2, 40, 400)).not.toBe(a);
    expect(gradients).toHaveLength(4);
  });
  it('rounds rows to whole canvas px, so a sub-pixel change reuses the gradient', () => {
    const { ctx, gradients } = recorder();
    const a = areaGradient(ctx, '#5695E0', 0.26, 40.2, 400.1);
    expect(areaGradient(ctx, '#5695E0', 0.26, 39.8, 399.9)).toBe(a);
    expect(gradients).toHaveLength(1);
  });
  it('fades the hue from the alpha at the top to nothing at the bottom', () => {
    const { ctx, gradients } = recorder();
    areaGradient(ctx, '#5695E0', 0.26, 40, 400);
    expect(gradients[0]!.args).toEqual([0, 40, 0, 400]);
    expect(gradients[0]!.stops).toEqual([
      [0, 'rgba(86,149,224,0.26)'],
      [1, 'rgba(86,149,224,0)'],
    ]);
  });
  it('keeps one cache per context and starts over when one fills up', () => {
    const one = recorder();
    const two = recorder();
    areaGradient(one.ctx, '#5695E0', 0.26, 40, 400);
    areaGradient(two.ctx, '#5695E0', 0.26, 40, 400);
    expect(one.gradients).toHaveLength(1);
    expect(two.gradients).toHaveLength(1);
    for (let i = 0; i < GRADIENT_CACHE_MAX + 2; i++) areaGradient(one.ctx, '#5695E0', 0.26, 40 + i, 500);
    const before = one.gradients.length;
    areaGradient(one.ctx, '#5695E0', 0.26, 40, 400); // evicted when the cache filled
    expect(one.gradients.length).toBe(before + 1);
  });
  it('is null for a colour that cannot fade (a system colour under forced colours)', () => {
    const { ctx, gradients } = recorder();
    expect(areaGradient(ctx, 'CanvasText', 0.26, 40, 400)).toBeNull();
    expect(gradients).toHaveLength(0);
  });
});

describe('drawAreaGradient', () => {
  const xs = Float64Array.from({ length: 10 }, (_, i) => i * 8);
  const vs = (...v: number[]) => Float32Array.from(v);

  it('fills under the line down to the plot baseline with the gradient, and clips to the plot', () => {
    const { ctx, calls, named } = recorder();
    const a = args(ctx, theme());
    expect(drawAreaGradient(a, xs, vs(10, 20, 30, 40, 50, 60, 70, 80, 90, 95), 0, 9, '#5695E0')).toBe(true);
    expect(named('fill')).toHaveLength(1);
    const base = a.box.top + a.box.height;
    expect(named('moveTo')[0]![2]).toBe(base);
    expect(named('lineTo').pop()![2]).toBe(base);
    expect(calls.some((c) => c[0] === 'clip')).toBe(true);
    // the gradient starts at the series' highest point (95) and ends at the baseline
    expect(calls.find((c) => c[0] === 'createLinearGradient')!.slice(1)).toEqual([0, Math.round(a.y(95)), 0, base]);
  });
  it('a gap ends a run: two runs, two fills, and a lone point draws nothing', () => {
    const { ctx, named } = recorder();
    const a = args(ctx, theme());
    expect(drawAreaGradient(a, xs, vs(10, 20, 30, Number.NaN, 50, 60, 70, Number.NaN, 90, Number.NaN), 0, 9, '#5695E0')).toBe(true);
    expect(named('fill')).toHaveLength(2);
  });
  it('draws nothing for an empty series, or under forced colours', () => {
    const { ctx, named } = recorder();
    expect(drawAreaGradient(args(ctx, theme()), xs, vs(...Array(10).fill(Number.NaN)), 0, 9, '#5695E0')).toBe(false);
    expect(drawAreaGradient(args(ctx, theme({ forced: true })), xs, vs(1, 2, 3, 4, 5, 6, 7, 8, 9, 10), 0, 9, '#5695E0')).toBe(false);
    expect(named('fill')).toHaveLength(0);
  });
});

describe('lastPointIn', () => {
  const xs = [0.5, 1.5, 2.5, 3.5, 4.5];
  it('is the last finite sample at or before the window end', () => {
    expect(lastPointIn(xs, [1, 2, 3, 4, 5], 0, 5)).toEqual({ i: 4, t: 4.5, v: 5 });
    expect(lastPointIn(xs, [1, 2, 3, 4, 5], 0, 3)).toEqual({ i: 2, t: 2.5, v: 3 });
  });
  it('steps back over gaps and nulls, and never leaves the window', () => {
    expect(lastPointIn(xs, [1, 2, 3, Number.NaN, null], 0, 5)).toEqual({ i: 2, t: 2.5, v: 3 });
    expect(lastPointIn(xs, [1, 2, 3, Number.NaN, null], 2.9, 5)).toBeNull();
    expect(lastPointIn(xs, [Number.NaN, Number.NaN, Number.NaN, Number.NaN, Number.NaN], 0, 5)).toBeNull();
    expect(lastPointIn([], [], 0, 5)).toBeNull();
  });
});

describe('the models wear the skin', () => {
  const data = makeChartData({ days: 84 });
  const series = (id: string): ChartSeries => data.series.find((s) => s.id === id)!;
  const noBand = (s: ChartSeries): ChartSeries => ({ ...s, daily: { ...s.daily, band: undefined } });
  const lane = (s: ChartSeries, mode: 'lane' | 'strip' | 'focus') => lineLaneModel(s, { mode, tickColCss: 32 });
  const run = (model: ReturnType<typeof lineLaneModel>, hook: 'under' | 'over', t = theme()) => {
    const r = recorder();
    model.data(VIEW, 600);
    const [yMin, yMax] = model.domain(VIEW);
    model[hook]!(args(r.ctx, t, { yMin, yMax, y: (v) => 16 + (1 - (v - yMin) / (yMax - yMin)) * 200 }), VIEW);
    return r;
  };

  it('a line is 2 px, 2.5 px in the focused lane, 1.5 px in a strip', () => {
    const s = series('fat_mass');
    expect(lane(s, 'lane').lines[0]!.width).toBe(2);
    expect(lane(s, 'focus').lines[0]!.width).toBe(2.5);
    expect(lane(s, 'strip').lines[0]!.width).toBe(1.5);
  });

  it('draws the area only for a single series with no likely range', () => {
    const banded = run(lane(series('fat_mass'), 'lane'), 'under');
    expect(banded.gradients).toHaveLength(0);
    const open = run(lane(noBand(series('fat_mass')), 'lane'), 'under');
    expect(open.gradients).toHaveLength(1);
    expect(open.gradients[0]!.stops[0]![1]).toBe(withAlpha(theme().cat.body, theme().areaTop));
    // a strip is a sparkline and the two-line rhythm lanes keep their faint trace: no area
    expect(run(lane(noBand(series('fat_mass')), 'strip'), 'under').gradients).toHaveLength(0);
    expect(run(lane(noBand(series('glucose')), 'lane'), 'under').gradients).toHaveLength(0);
  });

  it('ends a lane in a dot at the last sample: small in a lane, the focused size in focus, none in a strip', () => {
    const t = theme({ glow: false });
    const s = series('fat_mass');
    const r = (END_DOT_R.lane + 2) * 2;
    expect(run(lane(s, 'lane'), 'over', t).named('arc').map((c) => c[3])).toContain(r); // the start dot and the end dot
    expect(run(lane(s, 'lane'), 'over', t).named('arc').filter((c) => c[3] === END_DOT_R.lane * 2)).toHaveLength(2);
    const focus = run(lane(s, 'focus'), 'over', t).named('arc').map((c) => c[3]);
    expect(focus).toContain(END_DOT_R.focus * 2);
    expect(run(lane(s, 'strip'), 'over', t).named('arc')).toHaveLength(0);
    const end = lane(s, 'lane').endPoint!(VIEW)!;
    expect(end.t).toBeCloseTo(83.5, 6);
    expect(end.v).toBeCloseTo(s.daily.values[83]!, 5);
  });

  it('ends a zoomed lane at the last sample inside the window, and a gap at the end walks back', () => {
    const s = series('fat_mass');
    const m = lane(s, 'lane');
    m.data({ ...VIEW, x1: 40 }, 600);
    const end = m.endPoint!({ ...VIEW, x0: 20, x1: 40 })!;
    expect(end.t).toBeLessThanOrEqual(40);
    expect(end.t).toBeGreaterThan(39);
    const tail = { ...s, daily: { ...s.daily, values: Float32Array.from(s.daily.values, (v, i) => (i > 80 ? Number.NaN : v)) } };
    const m2 = lane(tail, 'lane');
    m2.data(VIEW, 600);
    expect(m2.endPoint!(VIEW)!.t).toBeCloseTo(80.5, 6);
  });

  it('the stacked TDEE lane ends its total line in an ivory dot', () => {
    const tdee = series('tdee');
    const m = stackedAreaModel(tdee, { mode: 'lane', tickColCss: 32 });
    const r = recorder();
    const t = theme({ glow: false });
    m.over!(args(r.ctx, t), VIEW);
    expect(r.calls.filter((c) => c[0] === 'set:fillStyle').map((c) => c[1])).toContain(t.ink);
    expect(m.endPoint!(VIEW)!.t).toBeCloseTo(83.5, 6);
  });

  it('the isolated overlay series is the focused one: 2.5 px, the others 2 px', () => {
    const picked = ['fat_mass', 'lean_mass', 'scale_weight'].map(series);
    const grid = () => ({ x: new Float64Array(84), values: picked.map(() => new Float32Array(84)) });
    const mk = (isolate: string | null) => overlayModel(picked, grid, { tickColCss: 32, state: { isolate, hidden: new Set() }, smooth: false });
    expect(mk(null).lines.map((l) => l.width)).toEqual([2, 2, 2]);
    expect(mk('lean_mass').lines.map((l) => l.width)).toEqual([2, 2.5, 2]);
  });

  it('colours the energy balance lane from the r071 balance ramp, six deficit steps and four surplus', () => {
    const t = theme();
    expect(t.deficit).toHaveLength(6);
    expect(t.surplus).toHaveLength(4);
    expect(t.deficit[5]).toBe(THEME_DEFAULTS['--lm-balance-deficit-6']);
    const m = energyModel(data.intake!, { tickColCss: 32 });
    const r = recorder();
    m.data(VIEW, 600);
    const [yMin, yMax] = m.domain(VIEW);
    m.under!(args(r.ctx, t, { yMin, yMax }), VIEW);
    const used = r.calls.filter((c) => c[0] === 'set:fillStyle').map((c) => c[1]);
    expect(used.some((c) => t.deficit.includes(c as string))).toBe(true);
    // none of the r068 warm steps is left in the lane
    for (const old of ['#28251C', '#322E20', '#3D3724', '#484028', '#2D221F', '#3A2924', '#473129', '#56382E']) expect(used).not.toContain(old);
  });
});

describe('the theme switches the glow off', () => {
  const stub = (on: string[]) =>
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (q: string) => ({ matches: on.includes(q), media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }) as MediaQueryList,
    );

  it('has a glow by default, with the dot numbers from the tokens', () => {
    const t = readChartTheme();
    expect(t.glow).toBe(true);
    expect(t.dot).toEqual({ haloAlpha: 0.18, haloSpread: 6, glowAlpha: 0.45, glowBlur: 12 });
    expect(t.areaTop).toBe(0.26);
  });
  it.each([
    ['forced colours', '(forced-colors: active)'],
    ['reduced motion', '(prefers-reduced-motion: reduce)'],
    ['more contrast', '(prefers-contrast: more)'],
  ])('has none under %s', (_n, query) => {
    stub([query]);
    expect(readChartTheme().glow).toBe(false);
  });
  it('has none under html[data-contrast=more] either, and forced colours draw the grid in GrayText', () => {
    document.documentElement.setAttribute('data-contrast', 'more');
    try {
      const t = readChartTheme();
      expect(t.highContrast).toBe(true);
      expect(t.glow).toBe(false);
    } finally {
      document.documentElement.removeAttribute('data-contrast');
    }
    stub(['(forced-colors: active)']);
    expect(readChartTheme().gridDot).toBe('GrayText');
  });
});
