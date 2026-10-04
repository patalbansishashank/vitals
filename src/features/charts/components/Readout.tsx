/* ==========================================================================
   Crosshair readout (COMPONENTS §7): floating panel beside the crosshair on
   pointer devices, docked rail above the chart on touch / narrow layouts.
   Pre-built DOM; the cursor only swaps textContent (CHART_SPEC §8.3).
   Mirrored to a polite live region, debounced 400 ms (CHART_SPEC §5.1).
   ========================================================================== */
import { memo, useEffect, useRef } from 'react';
import type { ChartController } from '../core/controller';
import type { DataArea } from '../core/interaction';
import { formatClock } from '../lib/format';
import type { Store } from '../lib/store';
import { describeSample } from '../lib/time';
import type { ChartEvent, Phase, Resolution, TimeBase } from '../types';
import { eventTime } from './TimeRows';
import { setData } from '../core/dom';

export interface ReadoutValue {
  value: string;
  unit: string;
  /** "Fat mass · 20.7–22.1" */
  detail: string;
  /** Spoken form for the live region. */
  spoken: string;
}

export interface ReadoutRow {
  id: string;
  /** Short name for the docked rail ("fat"). */
  short: string;
  color: string;
  shape?: 'line' | 'square';
  value: (t: number, res: Resolution) => ReadoutValue;
}

export interface CrosshairReadoutProps {
  controller: ChartController;
  time: TimeBase;
  phases?: readonly Phase[];
  events?: readonly ChartEvent[];
  rows: readonly ReadoutRow[];
  mode: 'float' | 'dock';
  /** Rows currently in view (only those are listed when there are many). */
  visible?: Store<ReadonlySet<string>>;
  area: () => DataArea;
  bodyWidth: number;
  /** Shown in the dock before the first scrub. */
  hint?: string;
}

const MANY = 14;

function phaseAt(phases: readonly Phase[] | undefined, t: number): Phase | undefined {
  return phases?.find((p) => t >= p.startDay && t < p.endDay);
}

function eventsAt(events: readonly ChartEvent[] | undefined, t: number, res: Resolution): ChartEvent[] {
  if (!events) return [];
  const b = res === 'daily' ? 1 : res === '6h' ? 0.25 : 1 / 24;
  const i = Math.floor(t / b);
  return events.filter((e) => Math.floor(eventTime(e) / b) === i || (res === 'daily' && e.day === Math.floor(t)));
}

export const CrosshairReadout = memo(function CrosshairReadout(p: CrosshairReadoutProps) {
  const { controller, rows, mode } = p;
  const rootRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLElement>(null);
  const phaseRef = useRef<HTMLSpanElement>(null);
  const evRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, { row: HTMLElement; b: HTMLElement; unit: HTMLElement; span: HTMLElement }>());
  const propsRef = useRef(p);
  useEffect(() => {
    propsRef.current = p;
  });

  useEffect(() => {
    const size = { w: 240, h: 200, parentH: 600 };
    let lastT: number | null = null;
    let lastRes = '';
    const place = () => {
      const q = propsRef.current;
      const root = rootRef.current;
      if (!root || q.mode !== 'float' || root.dataset.on !== 'true') return;
      const c = controller.cursor.get();
      if (c.t == null) return;
      const a = q.area();
      const v = controller.view.get();
      const x = a.left + ((c.t - v.x0) / (v.x1 - v.x0 || 1)) * a.width;
      const ptr = controller.pointer.get();
      let left = x + 18;
      if (left + size.w > q.bodyWidth - 8) left = x - size.w - 18;
      const y = ptr ? ptr.y - size.h / 2 : 64;
      const top = Math.max(56, Math.min(y, size.parentH - size.h - 34));
      // transform only: no layout read here (sizes come from the ResizeObserver below)
      root.style.transform = `translate(${Math.max(4, left).toFixed(0)}px, ${top.toFixed(0)}px)`;
    };
    const update = () => {
      const q = propsRef.current;
      const root = rootRef.current;
      if (!root) return;
      const c = controller.cursor.get();
      const v = controller.view.get();
      const on = c.t != null && c.t >= v.x0 && c.t <= v.x1;
      const show = q.mode === 'float' ? on && (c.source === 'pointer' || c.source === 'keyboard' || c.pinned) && c.source !== 'touch' : on;
      setData(root, 'on', String(show));
      if (!show) {
        lastT = null;
        return;
      }
      const t = c.t!;
      // content only changes when the snapped sample (or resolution) changes
      if (t !== lastT || v.res !== lastRes) {
        lastT = t;
        lastRes = v.res;
        if (headRef.current) headRef.current.textContent = describeSample(q.time, t, v.res);
        const ph = phaseAt(q.phases, t);
        if (phaseRef.current) phaseRef.current.textContent = ph ? ph.label : '';
        const vis = q.visible?.get();
        const many = q.rows.length > MANY;
        for (const r of q.rows) {
          const el = rowRefs.current.get(r.id);
          if (!el) continue;
          const shown = !many || !vis || vis.has(r.id);
          const disp = shown ? '' : 'none';
          if (el.row.style.display !== disp) el.row.style.display = disp;
          if (!shown) continue;
          const val = r.value(t, v.res);
          el.b.textContent = val.value;
          el.unit.textContent = val.unit;
          if (q.mode === 'float') el.span.textContent = val.detail;
        }
        const evs = eventsAt(q.events, t, v.res);
        if (evRef.current)
          evRef.current.textContent = evs.map((e) => (e.hour != null && v.res !== 'daily' ? `${e.label} · ${formatClock(e.hour)}` : e.label)).join(' · ');
      }
      place();
    };
    let ro: ResizeObserver | undefined;
    const root = rootRef.current;
    if (root && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        size.w = root.offsetWidth || size.w;
        size.h = root.offsetHeight || size.h;
        size.parentH = root.parentElement?.clientHeight ?? size.parentH;
        place();
      });
      ro.observe(root);
      if (root.parentElement) ro.observe(root.parentElement);
    }
    update();
    const u = [controller.cursor.subscribe(update), controller.view.subscribe(update), controller.pointer.subscribe(place)];
    const vis = p.visible?.subscribe(() => {
      lastT = null;
      update();
    });
    return () => {
      ro?.disconnect();
      u.forEach((f) => f());
      vis?.();
    };
    // rows / mode changes re-render the DOM; the subscription reads the latest props
  }, [controller, p.visible, rows, mode]);

  const register = (id: string) => (el: HTMLElement | null) => {
    if (!el) {
      rowRefs.current.delete(id);
      return;
    }
    rowRefs.current.set(id, {
      row: el,
      b: el.querySelector('[data-v]') as HTMLElement,
      unit: el.querySelector('[data-u]') as HTMLElement,
      span: el.querySelector('[data-d]') as HTMLElement,
    });
  };

  if (mode === 'dock') {
    return (
      <div className="lmc-dock" data-no-crosshair="" aria-hidden="true">
        <div ref={rootRef} data-on="false" className="lmc-dock__inner">
          {p.hint ? (
            <div className="lmc-dock__hint">
              <b>Tap and drag across the chart</b> {p.hint}
            </div>
          ) : null}
          <div>
            <b ref={headRef} /> <span ref={phaseRef} />
          </div>
          <div className="lmc-dock__vals">
            {rows.map((r) => (
              <span key={r.id} ref={register(r.id)}>
                <i data-shape={r.shape} style={{ background: r.color }} />
                {r.short} <b data-v="" />
                <small data-u="" />
                <small data-d="" hidden />
              </span>
            ))}
          </div>
          <div ref={evRef} className="lmc-readout__ev" />
        </div>
      </div>
    );
  }
  return (
    <div ref={rootRef} className="lmc-readout" data-on="false" aria-hidden="true">
      <div className="lmc-readout__head">
        <b ref={headRef} />
        <span ref={phaseRef} />
      </div>
      {rows.map((r) => (
        <div key={r.id} className="lmc-readout__row" ref={register(r.id)}>
          <i data-shape={r.shape} style={{ background: r.color }} />
          <b>
            <span data-v="" />
            <span className="lmc-unit" data-u="" />
          </b>
          <span data-d="" />
        </div>
      ))}
      <div ref={evRef} className="lmc-readout__ev" />
    </div>
  );
});

/* ------------------------------------------------------------ live region */

export interface LiveReadoutProps {
  controller: ChartController;
  time: TimeBase;
  rows: readonly ReadoutRow[];
  visible?: Store<ReadonlySet<string>>;
  max?: number;
}

/** Polite live region mirroring the readout, debounced 400 ms. */
export function LiveReadout({ controller, time, rows, visible, max = 6 }: LiveReadoutProps) {
  const ref = useRef<HTMLDivElement>(null);
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  });
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const speak = () => {
      const c = controller.cursor.get();
      const el = ref.current;
      if (!el) return;
      if (c.t == null) {
        el.textContent = '';
        return;
      }
      const v = controller.view.get();
      const vis = visible?.get();
      const list = rowsRef.current.filter((r) => !vis || rowsRef.current.length <= MANY || vis.has(r.id));
      const parts = list.slice(0, max).map((r) => r.value(c.t!, v.res).spoken);
      const more = list.length - Math.min(max, list.length);
      el.textContent = `${describeSample(time, c.t, v.res).replace(/·/g, ',')}. ${parts.join('. ')}${more > 0 ? `. And ${more} more; press T for the data table.` : '.'}${c.pinned ? ' Pinned.' : ''}`;
    };
    const unsub = controller.cursor.subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(speak, 400);
    });
    return () => {
      clearTimeout(timer);
      unsub();
    };
  }, [controller, time, visible, max]);
  return <div ref={ref} className="lmc-sr" aria-live="polite" aria-atomic="true" />;
}
