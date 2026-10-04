/* ==========================================================================
   React glue: stores, theme, element size, visibility, controller.
   ========================================================================== */
import { type RefObject, useEffect, useState, useSyncExternalStore } from 'react';
import type { Store } from '../lib/store';
import { ChartController, type ControllerOptions } from './controller';
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
