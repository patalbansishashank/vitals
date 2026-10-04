/* ==========================================================================
   Shared chrome for stacked views: body interactions, the crosshair hairline
   through all lanes, and the playhead sweep (the one authored motion).
   ========================================================================== */
import { type RefObject, useEffect, useRef } from 'react';
import type { ChartController } from '../core/controller';
import { attachInteractions, type DataArea } from '../core/interaction';
import { setData } from '../core/dom';

export function useBodyInteractions(
  bodyRef: RefObject<HTMLElement | null>,
  controller: ChartController,
  area: DataArea,
  eventTimes: readonly number[],
  onCommand?: (cmd: 'table' | 'focus' | 'escape') => boolean | void,
): void {
  const areaRef = useRef(area);
  const timesRef = useRef(eventTimes);
  const cmdRef = useRef(onCommand);
  useEffect(() => {
    areaRef.current = area;
    timesRef.current = eventTimes;
    cmdRef.current = onCommand;
  });
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    return attachInteractions(el, {
      controller,
      area: () => areaRef.current,
      eventTimes: () => [...timesRef.current],
      onCommand: (cmd) => cmdRef.current?.(cmd),
    });
  }, [bodyRef, controller]);
}

/** 1 px crosshair through every lane, snapped to the current sample. */
export function Crosshair({ controller, area }: { controller: ChartController; area: DataArea }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const upd = () => {
      const el = ref.current;
      if (!el) return;
      const c = controller.cursor.get();
      const v = controller.view.get();
      if (c.t == null || c.t < v.x0 || c.t > v.x1) {
        setData(el, 'on', 'false');
        return;
      }
      const x = area.left + ((c.t - v.x0) / (v.x1 - v.x0 || 1)) * area.width;
      el.style.transform = `translateX(${Math.round(x)}px)`;
      setData(el, 'on', 'true');
      setData(el, 'pinned', String(c.pinned));
    };
    upd();
    const a = controller.cursor.subscribe(upd);
    const b = controller.view.subscribe(upd);
    return () => {
      a();
      b();
    };
  }, [controller, area]);
  return <div ref={ref} className="lmc-xhair" data-on="false" aria-hidden="true" />;
}

/** Yellow playhead sweeps left → right once (700 ms, expo-out) when `sweepKey` changes. */
export function Sweep({ controller, area, sweepKey }: { controller: ChartController; area: DataArea; sweepKey?: string | number }) {
  const ref = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  const areaRef = useRef(area);
  useEffect(() => {
    areaRef.current = area;
  });
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const el = ref.current;
    if (!el || sweepKey === undefined || controller.durationMs === 0 || typeof requestAnimationFrame === 'undefined') return;
    const a = areaRef.current;
    const t0 = performance.now();
    let id = 0;
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / 700);
      const e = 1 - Math.pow(2, -10 * k);
      el.style.transform = `translateX(${(a.left + e * a.width).toFixed(1)}px)`;
      el.style.opacity = k < 1 ? '1' : '0';
      if (k < 1) id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [sweepKey, controller]);
  return <div ref={ref} className="lmc-sweep" aria-hidden="true" />;
}
