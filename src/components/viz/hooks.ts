import { useEffect, useRef, useState, type RefObject } from 'react';
import { useIsoLayoutEffect } from '../lib/hooks';

/** Width of an element in CSS px, followed with a ResizeObserver. `fallback` before the first measure (and in jsdom). */
export function useWidth<T extends HTMLElement>(fallback: number): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setWidth(Math.round(w));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/**
 * The element's fractional left offset in CSS px and the device pixel ratio, so marks can snap to device pixels.
 * A strip that starts at x.25 on the page would otherwise render 1.5 px ticks alternately thick and thin.
 */
export function usePixelGrid<T extends HTMLElement>(ref: RefObject<T | null>): { originX: number; dpr: number } {
  const [grid, setGrid] = useState({ originX: 0, dpr: 1 });
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof window === 'undefined') return;
    const read = () => {
      const originX = el.getBoundingClientRect().left;
      const dpr = window.devicePixelRatio || 1;
      setGrid((g) => (g.originX === originX && g.dpr === dpr ? g : { originX, dpr }));
    };
    read();
    window.addEventListener('resize', read);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(read);
    ro?.observe(document.documentElement);
    return () => {
      window.removeEventListener('resize', read);
      ro?.disconnect();
    };
  }, []);
  return grid;
}

/** `text`, 400 ms after the last change, for a polite live region (the LiveReadout pattern). Empty on first render. */
export function useDebounced(text: string, ms = 400): string {
  const [out, setOut] = useState('');
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const id = setTimeout(() => setOut(text), ms);
    return () => clearTimeout(id);
  }, [text, ms]);
  return out;
}
