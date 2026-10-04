/* ==========================================================================
   ChartController — the shared state of one chart frame: target zoom (for the
   toolbar), displayed window (animated, per frame), resolution and cursor.
   Lanes subscribe imperatively; React only re-renders small chrome.
   ========================================================================== */
import { createStore, shallowEqual, type Store } from '../lib/store';
import { resolutionForSpan, snapT, stepT } from '../lib/time';
import { initialZoom, zoomReducer, type ZoomAction, type ZoomState } from '../lib/zoom';
import type { Resolution } from '../types';

export interface ViewState {
  x0: number;
  x1: number;
  /** Resolution in use (swaps after a zoom animation ends). */
  res: Resolution;
  animating: boolean;
}

export type CursorSource = 'pointer' | 'touch' | 'keyboard' | 'program';

export interface CursorState {
  /** Snapped time in days, or null when no crosshair is shown. */
  t: number | null;
  pinned: boolean;
  source: CursorSource | null;
}

export interface ControllerOptions {
  /** Initial window in days (default: whole horizon). */
  window?: [number, number];
  /** Force a resolution; `auto` follows CHART_SPEC §5.2. */
  resolution?: Resolution | 'auto';
  minSpan?: number;
}

const easeOut = (k: number) => (k >= 1 ? 1 : 1 - Math.pow(2, -10 * k));

export class ChartController {
  days: number;
  readonly zoom: Store<ZoomState>;
  readonly view: Store<ViewState>;
  readonly cursor: Store<CursorState>;
  /** Last pointer position over the chart body (CSS px), for placing the floating readout. */
  readonly pointer: Store<{ x: number; y: number } | null>;
  private resMode: Resolution | 'auto';
  private anim = 0;
  /** Zoom animation duration (ms); 0 under reduced motion. Updated from the theme. */
  durationMs = 320;

  constructor(days: number, opts: ControllerOptions = {}) {
    this.days = days;
    this.resMode = opts.resolution ?? 'auto';
    let z = initialZoom(days, opts.minSpan ?? 0.5);
    if (opts.window) z = zoomReducer(z, { type: 'set', x0: opts.window[0], x1: opts.window[1] });
    this.zoom = createStore(z);
    this.view = createStore<ViewState>({ x0: z.x0, x1: z.x1, res: this.resFor(z.x1 - z.x0), animating: false }, shallowEqual);
    this.cursor = createStore<CursorState>({ t: null, pinned: false, source: null }, shallowEqual);
    this.pointer = createStore<{ x: number; y: number } | null>(null);
  }

  resFor(span: number): Resolution {
    return this.resMode === 'auto' ? resolutionForSpan(span) : this.resMode;
  }

  setResolutionMode(mode: Resolution | 'auto'): void {
    this.resMode = mode;
    const v = this.view.get();
    this.view.set({ ...v, res: this.resFor(v.x1 - v.x0) });
  }

  get resolutionMode(): Resolution | 'auto' {
    return this.resMode;
  }

  /** Apply a zoom action; animated for discrete jumps (presets, brush), immediate for wheel/pan. */
  dispatch(action: ZoomAction, opts: { animate?: boolean } = {}): void {
    const prev = this.zoom.get();
    const next = zoomReducer(prev, action);
    if (next === prev) return;
    this.zoom.set(next);
    const animate = opts.animate ?? (action.type === 'preset' || action.type === 'brush' || action.type === 'step' || action.type === 'reset' || action.type === 'panWindow');
    this.animateTo(next.x0, next.x1, animate && this.durationMs > 0);
  }

  setDays(days: number): void {
    if (days === this.days) return;
    this.days = days;
    cancelFrame(this.anim);
    const z = zoomReducer(this.zoom.get(), { type: 'days', days });
    this.zoom.set(z);
    this.view.set({ x0: z.x0, x1: z.x1, res: this.resFor(z.x1 - z.x0), animating: false });
    const c = this.cursor.get();
    if (c.t != null && c.t > days) this.cursor.set({ t: null, pinned: false, source: null });
  }

  private animateTo(x0: number, x1: number, animate: boolean): void {
    cancelFrame(this.anim);
    const from = this.view.get();
    const finalRes = this.resFor(x1 - x0);
    if (!animate) {
      this.view.set({ x0, x1, res: finalRes, animating: false });
      this.resnapCursor();
      return;
    }
    const t0 = now();
    const dur = this.durationMs;
    const step = () => {
      const k = Math.min(1, (now() - t0) / dur);
      const e = easeOut(k);
      if (k >= 1) {
        this.view.set({ x0, x1, res: finalRes, animating: false });
        this.resnapCursor();
        return;
      }
      this.view.set({ x0: from.x0 + (x0 - from.x0) * e, x1: from.x1 + (x1 - from.x1) * e, res: from.res, animating: true });
      this.anim = requestFrame(step);
    };
    this.view.set({ ...from, animating: true });
    this.anim = requestFrame(step);
  }

  private resnapCursor() {
    const c = this.cursor.get();
    if (c.t == null) return;
    const v = this.view.get();
    const t = Math.min(v.x1 - 1e-6, Math.max(v.x0, c.t));
    this.cursor.set({ ...c, t: snapT(t, v.res, this.days) });
  }

  /** Move the crosshair to t (snapped). Ignored while pinned unless `force`. */
  setCursor(t: number | null, source: CursorSource, opts: { force?: boolean; pin?: boolean } = {}): void {
    const c = this.cursor.get();
    if (c.pinned && !opts.force && opts.pin === undefined) return;
    if (t == null) {
      this.cursor.set({ t: null, pinned: false, source });
      return;
    }
    const v = this.view.get();
    const snapped = snapT(Math.min(this.days - 1e-6, Math.max(0, t)), v.res, this.days);
    this.cursor.set({ t: snapped, pinned: opts.pin ?? c.pinned, source });
  }

  /** Keyboard stepping by whole samples; keeps the cursor inside the window by panning. */
  stepCursor(steps: number): void {
    const v = this.view.get();
    const c = this.cursor.get();
    const t0 = c.t ?? (v.x0 + v.x1) / 2;
    const t = stepT(t0, v.res, steps, this.days);
    this.cursor.set({ t, pinned: c.pinned, source: 'keyboard' });
    if (t < v.x0 || t > v.x1) {
      const span = v.x1 - v.x0;
      this.dispatch({ type: 'set', x0: t - span / 2, x1: t + span / 2 }, { animate: false });
    }
  }

  jumpCursor(t: number): void {
    const v = this.view.get();
    this.cursor.set({ t: snapT(t, v.res, this.days), pinned: this.cursor.get().pinned, source: 'keyboard' });
    if (t < v.x0 || t > v.x1) {
      const span = v.x1 - v.x0;
      this.dispatch({ type: 'set', x0: t - span / 2, x1: t + span / 2 });
    }
  }

  pin(pinned: boolean): void {
    const c = this.cursor.get();
    this.cursor.set({ ...c, pinned: pinned && c.t != null });
  }

  destroy(): void {
    cancelFrame(this.anim);
  }
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const requestFrame = (fn: () => void): number =>
  typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame(fn) : (setTimeout(fn, 16) as unknown as number);
const cancelFrame = (id: number) => {
  if (!id) return;
  if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(id);
  else clearTimeout(id);
};
