/* ==========================================================================
   Interaction model (CHART_SPEC §5.1–5.2), attached imperatively:
   - pointer hover → crosshair; click pins/unpins; double-click resets zoom
   - Ctrl/⌘ + wheel or trackpad pinch → zoom around the pointer (plain wheel scrolls)
   - ⇧-drag → pan
   - touch: horizontal intent (> 8 px, |dx| > |dy|) scrubs, vertical scrolls the
     page; lift pins; tap pins; double-tap resets; two fingers pinch/pan
   - keyboard: ←/→ sample, ⇧ ×7, Home/End, PgUp/PgDn events, +/− zoom,
     Enter pins, T table, F focus, Esc exits focus / unpins
   ========================================================================== */
import { clamp } from '../lib/time';
import type { ChartController } from './controller';

export interface DataArea {
  /** Left edge of the data area relative to the element (CSS px). */
  left: number;
  width: number;
}

export interface InteractionOptions {
  controller: ChartController;
  area: () => DataArea;
  /** Event times in days, sorted, for PgUp/PgDn. */
  eventTimes?: () => number[];
  onCommand?: (cmd: 'table' | 'focus' | 'escape') => boolean | void;
}

interface Pt {
  id: number;
  type: string;
  x: number;
  y: number;
  sx: number;
  sy: number;
  t0: number;
}

const INTENT_PX = 8;

export function attachInteractions(el: HTMLElement, o: InteractionOptions): () => void {
  const ctl = o.controller;
  const pts = new Map<number, Pt>();
  let scrubbing = false;
  let abandoned = false;
  let panStart: { x: number; x0: number; x1: number } | null = null;
  let pinch: { d0: number; mid0: number; tMid: number; span0: number } | null = null;
  let lastTap = { t: 0, x: 0, y: 0 };
  let moved = false;
  let raf = 0;
  let pending: { x: number; y: number; type: string } | null = null;

  const rel = (e: { clientX: number; clientY: number }) => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const tAt = (x: number) => {
    const a = o.area();
    const v = ctl.view.get();
    return v.x0 + ((x - a.left) / (a.width || 1)) * (v.x1 - v.x0);
  };
  const inArea = (x: number) => {
    const a = o.area();
    return x >= a.left - 2 && x <= a.left + a.width + 2;
  };
  const ignore = (target: EventTarget | null) =>
    target instanceof Element && !!target.closest('[data-no-crosshair], button, a, input, select, [role="menu"]');

  const flushHover = () => {
    raf = 0;
    if (!pending) return;
    const { x, y, type } = pending;
    pending = null;
    ctl.pointer.set({ x, y });
    if (!inArea(x)) return;
    ctl.setCursor(clamp(tAt(x), 0, ctl.days), type === 'touch' ? 'touch' : 'pointer', { force: type === 'touch' });
  };
  const schedule = (x: number, y: number, type: string) => {
    pending = { x, y, type };
    if (!raf) raf = typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame(flushHover) : (flushHover(), 0);
  };

  const onDown = (e: PointerEvent) => {
    if (ignore(e.target)) return;
    const p = rel(e);
    pts.set(e.pointerId, { id: e.pointerId, type: e.pointerType, x: p.x, y: p.y, sx: p.x, sy: p.y, t0: e.timeStamp });
    moved = false;
    if (e.pointerType === 'mouse') {
      if (e.shiftKey && e.button === 0) {
        const v = ctl.view.get();
        panStart = { x: p.x, x0: v.x0, x1: v.x1 };
        el.setPointerCapture?.(e.pointerId);
        e.preventDefault();
      }
      return;
    }
    // touch / pen
    if (pts.size === 2) {
      const [a, b] = Array.from(pts.values()) as [Pt, Pt];
      const v = ctl.view.get();
      const mid = (a.x + b.x) / 2;
      pinch = { d0: Math.max(20, Math.abs(a.x - b.x)), mid0: mid, tMid: tAt(mid), span0: v.x1 - v.x0 };
      scrubbing = false;
    } else {
      scrubbing = false;
      abandoned = false;
    }
  };

  const onMove = (e: PointerEvent) => {
    const p = rel(e);
    const pt = pts.get(e.pointerId);
    if (pt) {
      pt.x = p.x;
      pt.y = p.y;
      if (Math.abs(p.x - pt.sx) > 3 || Math.abs(p.y - pt.sy) > 3) moved = true;
    }
    if (e.pointerType === 'mouse') {
      if (panStart) {
        const a = o.area();
        const span = panStart.x1 - panStart.x0;
        const dt = ((p.x - panStart.x) / (a.width || 1)) * span;
        ctl.dispatch({ type: 'set', x0: panStart.x0 - dt, x1: panStart.x1 - dt }, { animate: false });
        return;
      }
      if (ignore(e.target)) return;
      schedule(p.x, p.y, 'mouse');
      return;
    }
    if (!pt) return;
    if (pinch && pts.size >= 2) {
      const [a, b] = Array.from(pts.values()) as [Pt, Pt];
      const area = o.area();
      const d = Math.max(20, Math.abs(a.x - b.x));
      const span = clamp(pinch.span0 * (pinch.d0 / d), 0.5, ctl.days);
      const mid = (a.x + b.x) / 2;
      const x0 = pinch.tMid - ((mid - area.left) / (area.width || 1)) * span;
      ctl.dispatch({ type: 'set', x0, x1: x0 + span }, { animate: false });
      e.preventDefault();
      return;
    }
    if (abandoned) return;
    if (!scrubbing) {
      const dx = Math.abs(p.x - pt.sx);
      const dy = Math.abs(p.y - pt.sy);
      if (dx > INTENT_PX && dx > dy) scrubbing = true;
      else if (dy > INTENT_PX) {
        abandoned = true; // vertical intent: the page scrolls
        return;
      } else return;
    }
    e.preventDefault();
    schedule(p.x, p.y, 'touch');
  };

  const onUp = (e: PointerEvent) => {
    const pt = pts.get(e.pointerId);
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (e.pointerType === 'mouse') {
      if (panStart) {
        panStart = null;
        el.releasePointerCapture?.(e.pointerId);
      }
      return;
    }
    if (!pt || ignore(e.target)) return;
    if (scrubbing) {
      ctl.pin(true); // lift = the crosshair stays
      scrubbing = false;
      return;
    }
    if (abandoned || moved) return;
    const p = rel(e);
    // tap: double-tap resets the zoom, single tap pins the crosshair there
    if (e.timeStamp - lastTap.t < 320 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 28) {
      ctl.dispatch({ type: 'reset' });
      lastTap = { t: 0, x: 0, y: 0 };
      return;
    }
    lastTap = { t: e.timeStamp, x: p.x, y: p.y };
    if (inArea(p.x)) {
      ctl.pointer.set({ x: p.x, y: p.y });
      ctl.setCursor(tAt(p.x), 'touch', { pin: true });
    }
  };

  const onCancel = (e: PointerEvent) => {
    pts.delete(e.pointerId);
    pinch = null;
    scrubbing = false;
    panStart = null;
  };

  const onLeave = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    ctl.pointer.set(null);
    if (!ctl.cursor.get().pinned) ctl.setCursor(null, 'pointer');
  };

  const onClick = (e: MouseEvent) => {
    if (ignore(e.target) || moved || e.shiftKey) return;
    if ((e as PointerEvent).pointerType && (e as PointerEvent).pointerType !== 'mouse') return;
    const p = rel(e);
    if (!inArea(p.x)) return;
    const c = ctl.cursor.get();
    if (c.pinned) ctl.setCursor(tAt(p.x), 'pointer', { force: true, pin: false });
    else ctl.setCursor(tAt(p.x), 'pointer', { force: true, pin: true });
  };

  const onDbl = (e: MouseEvent) => {
    if (ignore(e.target)) return;
    ctl.dispatch({ type: 'reset' });
  };

  const onWheel = (e: WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return; // plain wheel scrolls the page, never hijacked
    e.preventDefault();
    const p = rel(e);
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    const factor = Math.exp(clamp(dy, -120, 120) * 0.006);
    ctl.dispatch({ type: 'zoomAt', factor, anchor: tAt(p.x) }, { animate: false });
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.target !== el) return;
    const v = ctl.view.get();
    const c = ctl.cursor.get();
    const step = e.shiftKey ? 7 : 1;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowLeft': {
        e.preventDefault();
        if (c.t == null) ctl.setCursor(e.key === 'ArrowRight' ? v.x0 : v.x1 - 1e-6, 'keyboard', { force: true });
        else ctl.stepCursor(e.key === 'ArrowRight' ? step : -step);
        return;
      }
      case 'Home':
        e.preventDefault();
        ctl.jumpCursor(0);
        return;
      case 'End':
        e.preventDefault();
        ctl.jumpCursor(ctl.days - 1e-6);
        return;
      case 'PageUp':
      case 'PageDown': {
        const times = o.eventTimes?.() ?? [];
        if (!times.length) return;
        e.preventDefault();
        const cur = c.t ?? (e.key === 'PageDown' ? -1 : ctl.days + 1);
        const next =
          e.key === 'PageDown' ? times.find((t) => t > cur + 1e-6) : [...times].reverse().find((t) => t < cur - 1e-6);
        if (next != null) ctl.jumpCursor(next);
        return;
      }
      case '+':
      case '=':
        e.preventDefault();
        ctl.dispatch({ type: 'step', dir: 1, centre: c.t ?? undefined });
        return;
      case '-':
      case '_':
        e.preventDefault();
        ctl.dispatch({ type: 'step', dir: -1, centre: c.t ?? undefined });
        return;
      case 'Enter':
      case ' ':
        if (c.t == null) return;
        e.preventDefault();
        ctl.pin(!c.pinned);
        return;
      case 't':
      case 'T':
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (o.onCommand?.('table') !== false) e.preventDefault();
        return;
      case 'f':
      case 'F':
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (o.onCommand?.('focus') !== false) e.preventDefault();
        return;
      case 'Escape':
        if (o.onCommand?.('escape') === true) {
          e.preventDefault();
          return;
        }
        if (c.pinned || c.t != null) {
          e.preventDefault();
          ctl.setCursor(null, 'keyboard', { force: true });
        }
        return;
      default:
    }
  };

  const onFocusIn = (e: FocusEvent) => {
    if (e.target !== el) return;
    if (ctl.cursor.get().t == null) {
      const v = ctl.view.get();
      ctl.setCursor(v.x1 - 1e-6, 'keyboard', { force: true });
    }
  };

  const onDocDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    if (el.contains(e.target as Node)) return;
    const c = ctl.cursor.get();
    if (c.pinned && c.source === 'touch') ctl.setCursor(null, 'touch', { force: true }); // tap elsewhere unpins
  };

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove, { passive: false });
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onCancel);
  el.addEventListener('pointerleave', onLeave);
  el.addEventListener('click', onClick);
  el.addEventListener('dblclick', onDbl);
  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('keydown', onKey);
  el.addEventListener('focusin', onFocusIn);
  document.addEventListener('pointerdown', onDocDown, true);
  return () => {
    if (raf && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(raf);
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onCancel);
    el.removeEventListener('pointerleave', onLeave);
    el.removeEventListener('click', onClick);
    el.removeEventListener('dblclick', onDbl);
    el.removeEventListener('wheel', onWheel);
    el.removeEventListener('keydown', onKey);
    el.removeEventListener('focusin', onFocusIn);
    document.removeEventListener('pointerdown', onDocDown, true);
  };
}

/* ---------------------------------------------------------------- ruler */

export interface RulerOptions {
  controller: ChartController;
  /** Data area of the ruler (full horizon when zoomed = minimap). */
  area: () => DataArea;
  /** Whether the ruler currently shows the full horizon (minimap). */
  isMinimap: () => boolean;
  onBrush?: (a: number, b: number | null) => void;
}

/**
 * Time ruler: drag = brush a range to zoom; drag the window frame (minimap) = pan;
 * double-click a week = zoom to that week; double-tap = zoom in one level.
 */
export function attachRuler(el: HTMLElement, o: RulerOptions): () => void {
  const ctl = o.controller;
  let drag: { mode: 'brush' | 'frame'; sx: number; t0: number; x0: number; x1: number; id: number; moved: boolean } | null = null;
  let lastTap = 0;
  const rel = (e: PointerEvent | MouseEvent) => e.clientX - el.getBoundingClientRect().left;
  const range = () => {
    const v = ctl.view.get();
    return o.isMinimap() ? { a: 0, b: ctl.days } : { a: v.x0, b: v.x1 };
  };
  const tAt = (x: number) => {
    const ar = o.area();
    const r = range();
    return clamp(r.a + ((x - ar.left) / (ar.width || 1)) * (r.b - r.a), 0, ctl.days);
  };

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const x = rel(e);
    const t = tAt(x);
    const v = ctl.view.get();
    const inFrame = o.isMinimap() && t >= v.x0 && t <= v.x1;
    drag = { mode: inFrame ? 'frame' : 'brush', sx: x, t0: t, x0: v.x0, x1: v.x1, id: e.pointerId, moved: false };
    el.setPointerCapture?.(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  };
  const onMove = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const x = rel(e);
    if (Math.abs(x - drag.sx) > 4) drag.moved = true;
    if (!drag.moved) return;
    const t = tAt(x);
    if (drag.mode === 'frame') {
      const dt = t - drag.t0;
      ctl.dispatch({ type: 'set', x0: drag.x0 + dt, x1: drag.x1 + dt }, { animate: false });
    } else o.onBrush?.(drag.t0, t);
    e.stopPropagation();
  };
  const onUp = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    el.releasePointerCapture?.(e.pointerId);
    o.onBrush?.(0, null);
    e.stopPropagation();
    if (d.mode === 'brush' && d.moved) {
      const t = tAt(rel(e));
      if (Math.abs(t - d.t0) > 0.05) ctl.dispatch({ type: 'brush', a: d.t0, b: t });
      return;
    }
    if (!d.moved && e.pointerType !== 'mouse') {
      if (e.timeStamp - lastTap < 320) {
        ctl.dispatch({ type: 'step', dir: 1, centre: d.t0 });
        lastTap = 0;
      } else lastTap = e.timeStamp;
    }
  };
  const onDbl = (e: MouseEvent) => {
    const t = tAt(rel(e));
    const wk = Math.floor(t / 7) * 7;
    ctl.dispatch({ type: 'set', x0: wk, x1: Math.min(ctl.days, wk + 7) });
    e.stopPropagation();
  };
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('dblclick', onDbl);
  return () => {
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onUp);
    el.removeEventListener('dblclick', onDbl);
  };
}
