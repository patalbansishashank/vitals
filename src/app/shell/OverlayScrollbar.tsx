import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { scrollPageTo } from '@/app/motion';
import { detectPlatform } from '@/platform/detect';

/** Desktop pointers in a window wide enough for it; touch and narrow windows show no scrollbar at all (base.css). */
const QUERY = '(hover: hover) and (pointer: fine) and (min-width: 48rem)';
const IDLE_MS = 900;
const EDGE_PX = 28;
const MIN_THUMB = 32;

function useWanted(): boolean {
  const [on, setOn] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && detectPlatform() !== 'android' && window.matchMedia(QUERY).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function' || detectPlatform() === 'android') return;
    const m = window.matchMedia(QUERY);
    const on = () => setOn(m.matches);
    m.addEventListener?.('change', on);
    return () => m.removeEventListener?.('change', on);
  }, []);
  return on;
}

/**
 * The page's scrollbar on desktop (r068 U7): the root's native bar is hidden (base.css) because Chromium paints its
 * track as a flat black strip beside the backdrop; this draws a thin thumb in the theme's ink over the page instead,
 * with no track. It shows while the page scrolls or the pointer comes near the right edge, widens under the pointer
 * and can be dragged. Decorative for assistive tech: the page scrolls as ever by keys, wheel and touchpad.
 */
export function OverlayScrollbar() {
  const wanted = useWanted();
  const rail = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);
  const [active, setActive] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!wanted) return;
    const doc = document.documentElement;
    let frame = 0;
    let idle = 0;
    let near = false;
    const geometry = () => {
      const view = window.innerHeight;
      const total = doc.scrollHeight;
      const track = rail.current?.clientHeight || view - 8;
      const size = Math.max(MIN_THUMB, Math.round((track * view) / Math.max(total, 1)));
      return { view, total, track, size, max: Math.max(total - view, 0) };
    };
    const paint = () => {
      frame = 0;
      const g = geometry();
      const can = g.max > 1;
      setScrollable(can);
      const t = thumb.current;
      if (!t || !can) return;
      const y = ((g.track - g.size) * Math.min(window.scrollY, g.max)) / g.max;
      t.style.height = `${g.size}px`;
      t.style.transform = `translateY(${y}px)`;
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(paint);
    };
    const wake = () => {
      setActive(true);
      window.clearTimeout(idle);
      idle = window.setTimeout(() => {
        if (!near) setActive(false);
      }, IDLE_MS);
    };
    const onScroll = () => {
      schedule();
      wake();
    };
    const onMove = (e: PointerEvent) => {
      const isNear = window.innerWidth - e.clientX <= EDGE_PX;
      if (isNear === near) return;
      near = isNear;
      if (near) setActive(true);
      else wake();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', schedule);
    window.addEventListener('pointermove', onMove, { passive: true });
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    ro?.observe(document.body);
    paint();
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('pointermove', onMove);
      ro?.disconnect();
      window.cancelAnimationFrame(frame);
      window.clearTimeout(idle);
    };
  }, [wanted]);

  if (!wanted) return null;

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const doc = document.documentElement;
    const startY = e.clientY;
    const startScroll = window.scrollY;
    const track = rail.current?.clientHeight ?? window.innerHeight;
    const size = el.offsetHeight;
    const max = Math.max(doc.scrollHeight - window.innerHeight, 0);
    const ratio = max / Math.max(track - size, 1);
    setDragging(true);
    const move = (ev: PointerEvent) => scrollPageTo(startScroll + (ev.clientY - startY) * ratio, { immediate: true });
    const up = () => {
      setDragging(false);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  return (
    <div ref={rail} className="lm-oscroll" aria-hidden="true" hidden={!scrollable} data-active={active || dragging || undefined} data-dragging={dragging || undefined}>
      <div ref={thumb} className="lm-oscroll__thumb" onPointerDown={onPointerDown} />
    </div>
  );
}
