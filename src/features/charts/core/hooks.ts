/* ==========================================================================
   React glue: stores, theme, element size, visibility, controller.
   ========================================================================== */
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Store } from '../lib/store';
import { ChartController, type ControllerOptions } from './controller';
import { resetLabelWidths, yAxisWidth } from './draw';
import type { PlotModel } from './plotEngine';
import { type ChartTheme, getServerThemeSnapshot, getThemeSnapshot, subscribeTheme } from './theme';

/** Re-render when a store changes (use only for small chrome, never per lane). */
export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/** Resolved chart colours; re-renders on theme change only. */
export function useChartTheme(): ChartTheme {
  return useSyncExternalStore(subscribeTheme, getThemeSnapshot, getServerThemeSnapshot);
}

/** Content-box width of an element (ResizeObserver; window resize fallback). */
export function useElementWidth(ref: RefObject<HTMLElement | null>, fallback = 960): number {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setW(Math.round(el.getBoundingClientRect().width) || el.clientWidth || fallback);
    if (typeof ResizeObserver === 'undefined') {
      const id = requestAnimationFrame(read);
      window.addEventListener('resize', read);
      return () => {
        cancelAnimationFrame(id);
        window.removeEventListener('resize', read);
      };
    }
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      setW(Math.round(cr?.width ?? 0) || fallback);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, fallback]);
  return w;
}

/**
 * Whether an element is within the viewport ± one screen (lane virtualisation,
 * CHART_SPEC §4.7 / §8.3). Always true where IntersectionObserver is missing.
 */
export function useInView(ref: RefObject<HTMLElement | null>, margin = '100% 0px'): boolean {
  const [inView, setInView] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => setInView(entries.some((e) => e.isIntersecting)), { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, margin]);
  return inView;
}

/** One controller per chart frame; follows `days`; animation length follows the theme. */
export function useChartController(
  days: number,
  opts: ControllerOptions & { controller?: ChartController } = {},
): ChartController {
  const [own] = useState(() => opts.controller ?? new ChartController(days, opts));
  const ctl = opts.controller ?? own;
  const theme = useChartTheme();
  useEffect(() => {
    ctl.setDays(days);
  }, [ctl, days]);
  useEffect(() => {
    ctl.durationMs = theme.reducedMotion ? 0 : theme.durSlow;
  }, [ctl, theme]);
  useEffect(() => () => own.destroy(), [own]);
  return ctl;
}

/** Registers (or, with null, drops) a plot's model with the chart's shared tick column. Stable across renders. */
export type AxisRegister = (id: string, model: PlotModel | null) => void;

/** A narrower widest label shrinks the column only past this slack (CSS px), so zooming does not jitter the plots. */
const AXIS_SHRINK_SLACK = 4;

/**
 * The shared y tick column of a chart whose plots stack on one time axis: the widest tick label (measured in the
 * canvas tick font) over every registered plot's labels for the current view, plus the gap, tick and spine. Plots
 * register their model from a layout effect, so the first paint already has the column; it is measured again when
 * a model changes, the view zooms or pans, or the chart font loads. Grows at once, shrinks past a small slack.
 * Returns 0 until something with labels registers.
 */
export function useAxisGutter(controller: ChartController): { width: number; register: AxisRegister } {
  const models = useRef(new Map<string, PlotModel>());
  const current = useRef(0);
  const [width, setWidth] = useState(0);
  const measure = useCallback(() => {
    const view = controller.view.get();
    let need = 0;
    for (const m of models.current.values()) {
      const labels = m.yLabels?.(view);
      if (labels?.length) need = Math.max(need, yAxisWidth(labels));
    }
    const next = Math.ceil(need);
    const cur = current.current;
    if (next > cur || next < cur - AXIS_SHRINK_SLACK) {
      current.current = next;
      setWidth(next);
    }
  }, [controller]);
  const frame = useRef(0);
  const schedule = useCallback(() => {
    if (typeof requestAnimationFrame === 'undefined') {
      measure();
      return;
    }
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      measure();
    });
  }, [measure]);
  const register = useCallback<AxisRegister>(
    (id, model) => {
      if (model) models.current.set(id, model);
      else models.current.delete(id);
      schedule();
    },
    [schedule],
  );
  // children's layout effects (the plots registering) run before this one: measure before the first paint
  useLayoutEffect(() => {
    measure();
  }, [measure]);
  useEffect(() => {
    const offView = controller.view.subscribe(schedule);
    const offTheme = subscribeTheme(() => {
      resetLabelWidths();
      schedule();
    });
    return () => {
      offView();
      offTheme();
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [controller, schedule]);
  return { width, register };
}

/** Registers a plot's model with the chart's tick column (`useAxisGutter`) while it is mounted. */
export function useAxisModel(register: AxisRegister | undefined, id: string, model: PlotModel | null): void {
  useLayoutEffect(() => {
    if (!register) return;
    register(id, model);
    return () => register(id, null);
  }, [register, id, model]);
}
