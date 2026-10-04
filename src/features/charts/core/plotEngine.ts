/* ==========================================================================
   PlotEngine — owns one uPlot instance (CHART_SPEC §10) used as a DPR-aware
   canvas renderer: uPlot builds and strokes line paths; our hooks paint the
   annotation layers under/over them. uPlot's cursor, legend and axes are off:
   the chart frame owns interaction (one crosshair for every lane).
   Plain class (not a hook) so per-frame work never touches React.
   ========================================================================== */
import uPlot from 'uplot';
import type { ChartController, ViewState } from './controller';
import type { DrawArgs, PlotBox } from './draw';
import { type ChartTheme, getThemeSnapshot, subscribeTheme } from './theme';

export interface PlotLine {
  color: (t: ChartTheme) => string;
  width: number;
  dash?: readonly number[];
  alpha?: (t: ChartTheme) => number;
}

export interface PlotData {
  x: ArrayLike<number>;
  /** One array per line (same length as x). */
  ys: ArrayLike<number | null>[];
}

export interface PlotModel {
  lines: PlotLine[];
  data(view: ViewState, plotWidthCss: number): PlotData;
  domain(view: ViewState): [number, number];
  under?(a: DrawArgs, view: ViewState): void;
  over?(a: DrawArgs, view: ViewState): void;
}

export interface PlotPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PlotApi {
  view(): ViewState;
  domain(): [number, number];
  /** CSS px relative to the plot host. */
  cssX(t: number): number;
  cssY(v: number): number;
  box(): PlotBox;
  redraw(): void;
}

export interface PlotProps {
  model: PlotModel;
  width: number;
  height: number;
  padding: PlotPadding;
  active: boolean;
  animateDomain: boolean;
}

const nanToNull = new WeakMap<object, (number | null)[]>();
/** uPlot treats null (not NaN) as a gap. Typed arrays holding NaN are converted once. */
function gapsAware(a: ArrayLike<number | null>): ArrayLike<number | null> {
  if (!(a instanceof Float32Array || a instanceof Float64Array)) return a;
  const hit = nanToNull.get(a);
  if (hit) return hit;
  let hasNaN = false;
  for (let i = 0; i < a.length; i++)
    if (Number.isNaN(a[i])) {
      hasNaN = true;
      break;
    }
  if (!hasNaN) return a;
  const out = Array.from(a, (v) => (Number.isNaN(v) ? null : v));
  nanToNull.set(a, out);
  return out;
}

function aligned(d: PlotData, lines: number): uPlot.AlignedData {
  const ys = d.ys.map(gapsAware);
  while (ys.length < Math.max(1, lines)) ys.push(new Array<number | null>(d.x.length).fill(null));
  return [d.x as number[], ...(ys as number[][])];
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class PlotEngine {
  private u: uPlot | null = null;
  private props: PlotProps | null = null;
  private view: ViewState;
  private dom: [number, number] = [0, 1];
  private data: PlotData | null = null;
  private tween = 0;
  private dirty = false;
  private builtFor: PlotModel | null = null;
  private unsubs: Array<() => void> = [];
  readonly api: PlotApi;

  constructor(
    private host: HTMLElement,
    private controller: ChartController,
  ) {
    this.view = controller.view.get();
    this.unsubs.push(
      controller.view.subscribe((v) => {
        this.view = v;
        if (!this.u || !this.props?.active) {
          this.dirty = true;
          return;
        }
        this.apply(false);
      }),
      subscribeTheme(() => this.onTheme()),
    );
    this.api = {
      view: () => this.view,
      domain: () => this.dom,
      cssX: (t) => {
        const p = this.props;
        if (!p) return 0;
        const w = p.width - p.padding.left - p.padding.right;
        return p.padding.left + ((t - this.view.x0) / (this.view.x1 - this.view.x0 || 1)) * w;
      },
      cssY: (val) => {
        const p = this.props;
        if (!p) return 0;
        const h = p.height - p.padding.top - p.padding.bottom;
        return p.padding.top + (1 - (val - this.dom[0]) / (this.dom[1] - this.dom[0] || 1)) * h;
      },
      box: () => {
        const p = this.props;
        if (!p) return { left: 0, top: 0, width: 0, height: 0 };
        return {
          left: p.padding.left,
          top: p.padding.top,
          width: p.width - p.padding.left - p.padding.right,
          height: p.height - p.padding.top - p.padding.bottom,
        };
      },
      redraw: () => this.u?.redraw(false),
    };
  }

  /** Apply new props: rebuilds on model change, resizes on size change, catches up after virtualisation. */
  update(next: PlotProps): void {
    const prev = this.props;
    this.props = next;
    if (!next.active || next.width <= 0) return;
    if (!this.u || this.builtFor !== next.model) {
      this.build(prev?.model !== next.model && !!this.u);
      return;
    }
    if (prev && (prev.width !== next.width || prev.height !== next.height)) {
      this.u.setSize({ width: next.width, height: next.height });
      this.apply(true);
      return;
    }
    if (this.dirty) this.apply(true);
  }

  destroy(): void {
    cancelAnimationFrame(this.tween);
    this.unsubs.forEach((f) => f());
    this.unsubs = [];
    this.u?.destroy();
    this.u = null;
  }

  private plotWidth(): number {
    const p = this.props!;
    return Math.max(1, p.width - p.padding.left - p.padding.right);
  }

  private build(carryDomain: boolean): void {
    const p = this.props!;
    const model = p.model;
    this.view = this.controller.view.get();
    const data = model.data(this.view, this.plotWidth());
    this.data = data;
    const target = model.domain(this.view);
    const animate = carryDomain && p.animateDomain;
    if (!animate) this.dom = target;
    const dpr = uPlot.pxRatio > 0 ? uPlot.pxRatio : 1;
    const theme = getThemeSnapshot;
    const layer = (u: uPlot, which: 'under' | 'over') => {
      const fn = which === 'under' ? model.under : model.over;
      if (!fn) return;
      const v = this.view;
      const [yMin, yMax] = this.dom;
      const b = u.bbox;
      const a: DrawArgs = {
        ctx: u.ctx,
        theme: theme(),
        dpr: uPlot.pxRatio || 1,
        box: { left: b.left, top: b.top, width: b.width, height: b.height },
        canvasW: u.ctx.canvas.width,
        canvasH: u.ctx.canvas.height,
        x0: v.x0,
        x1: v.x1,
        yMin,
        yMax,
        x: (t) => b.left + ((t - v.x0) / (v.x1 - v.x0 || 1)) * b.width,
        y: (val) => b.top + (1 - (val - yMin) / (yMax - yMin || 1)) * b.height,
      };
      u.ctx.save();
      try {
        fn.call(model, a, v);
      } finally {
        u.ctx.restore();
      }
    };
    const opts: uPlot.Options = {
      width: p.width,
      height: p.height,
      padding: [p.padding.top, p.padding.right, p.padding.bottom, p.padding.left],
      legend: { show: false },
      cursor: { show: false, x: false, y: false, points: { show: false }, drag: { x: false, y: false } },
      select: { show: false, left: 0, top: 0, width: 0, height: 0 },
      scales: {
        x: { time: false, auto: false, range: () => [this.view.x0, this.view.x1] },
        y: { auto: false, range: () => [this.dom[0], this.dom[1]] },
      },
      axes: [{ show: false }, { show: false }],
      series: [
        {},
        ...(model.lines.length
          ? model.lines.map<uPlot.Series>((l) => ({
              stroke: () => l.color(theme()),
              width: l.width,
              dash: l.dash?.length ? l.dash.map((d) => d * dpr) : undefined,
              cap: l.dash?.length ? 'round' : undefined,
              alpha: l.alpha ? l.alpha(theme()) : 1,
              points: { show: false },
              spanGaps: false,
            }))
          : [{ show: false, points: { show: false } }]),
      ],
      hooks: {
        drawClear: [(u) => layer(u, 'under')],
        draw: [(u) => layer(u, 'over')],
      },
    };
    this.u?.destroy();
    const u = new uPlot(opts, aligned(data, model.lines.length), this.host);
    u.root.setAttribute('aria-hidden', 'true');
    this.u = u;
    this.builtFor = model;
    u.batch(() => {
      u.setScale('x', { min: this.view.x0, max: this.view.x1 });
      u.setScale('y', { min: this.dom[0], max: this.dom[1] });
    });
    this.dirty = false;
    if (animate) this.tweenTo(target);
  }

  private apply(force: boolean): void {
    const u = this.u;
    const p = this.props;
    if (!u || !p) return;
    const data = p.model.data(this.view, this.plotWidth());
    const target = p.model.domain(this.view);
    cancelAnimationFrame(this.tween);
    this.dom = target;
    u.batch(() => {
      if (force || data !== this.data) {
        this.data = data;
        u.setData(aligned(data, p.model.lines.length), false);
      }
      u.setScale('x', { min: this.view.x0, max: this.view.x1 });
      u.setScale('y', { min: target[0], max: target[1] });
    });
    this.dirty = false;
  }

  private tweenTo(target: [number, number]): void {
    const from = this.dom;
    const theme = getThemeSnapshot();
    const dur = theme.reducedMotion ? 0 : theme.durSlow;
    const same = Math.abs(from[0] - target[0]) < 1e-12 && Math.abs(from[1] - target[1]) < 1e-12;
    if (!dur || same || typeof requestAnimationFrame === 'undefined') {
      this.dom = target;
      this.u?.setScale('y', { min: target[0], max: target[1] });
      return;
    }
    const t0 = now();
    const step = () => {
      const k = Math.min(1, (now() - t0) / dur);
      const e = 1 - Math.pow(2, -10 * k);
      this.dom = [from[0] + (target[0] - from[0]) * e, from[1] + (target[1] - from[1]) * e];
      this.u?.setScale('y', { min: this.dom[0], max: this.dom[1] });
      if (k < 1) this.tween = requestAnimationFrame(step);
    };
    this.tween = requestAnimationFrame(step);
  }

  private onTheme(): void {
    const u = this.u;
    const p = this.props;
    if (!u || !p) return;
    const t = getThemeSnapshot();
    p.model.lines.forEach((l, i) => {
      const s = u.series[i + 1];
      if (s && l.alpha) s.alpha = l.alpha(t);
    });
    u.redraw(false);
  }
}
