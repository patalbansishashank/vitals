import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';

/** useLayoutEffect in the browser, no-op warning-free elsewhere. */
export const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * Controlled/uncontrolled state in one hook. When `controlled` is defined the
 * component is controlled and `setValue` only calls `onChange`.
 */
export function useControllableState<T>(
  controlled: T | undefined,
  defaultValue: T,
  onChange?: (value: T) => void,
): [T, (next: T) => void] {
  const [inner, setInner] = useState<T>(defaultValue);
  const isControlled = controlled !== undefined;
  const value = isControlled ? controlled : inner;
  const onChangeRef = useRef(onChange);
  useIsoLayoutEffect(() => {
    onChangeRef.current = onChange;
  });
  const setValue = useCallback(
    (next: T) => {
      if (!isControlled) setInner(next);
      onChangeRef.current?.(next);
    },
    [isControlled],
  );
  return [value, setValue];
}

function subscribeMedia(query: string, cb: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const mql = window.matchMedia(query);
  mql.addEventListener('change', cb);
  return () => mql.removeEventListener('change', cb);
}

function readMedia(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(query).matches;
}

/** Subscribe to a media query. Returns false where matchMedia is unavailable (tests). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => subscribeMedia(query, cb),
    () => readMedia(query),
    () => false,
  );
}

/** Breakpoints mirrored from tokens.css §17 (media queries cannot read vars). */
export const MQ = {
  md: '(min-width: 48rem)',
  lg: '(min-width: 64rem)',
  xl: '(min-width: 80rem)',
  finePointer: '(pointer: fine)',
  coarsePointer: '(pointer: coarse)',
} as const;

function readReducedMotion(): boolean {
  if (typeof document === 'undefined') return false;
  const attr = document.documentElement.getAttribute('data-motion');
  if (attr === 'reduce') return true;
  if (attr === 'full') return false;
  return readMedia('(prefers-reduced-motion: reduce)');
}

function subscribeReducedMotion(cb: () => void): () => void {
  if (typeof document === 'undefined') return () => {};
  const off = subscribeMedia('(prefers-reduced-motion: reduce)', cb);
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
  return () => {
    off();
    mo.disconnect();
  };
}

/**
 * True when motion should be reduced: the settings override on <html data-motion>
 * wins, otherwise the OS preference.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, readReducedMotion, () => false);
}

/** Latest-value ref for callbacks used inside long-lived listeners. */
export function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  useIsoLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

/**
 * Press-and-hold repeat (Stepper): fires once on press, then after 400 ms at
 * 12/s, and at 30/s once the key has been held for 2 s (COMPONENTS §3).
 * Keyboard activation (click with detail 0) fires once per press.
 */
export function usePressAndHold(action: () => void, disabled = false) {
  const actionRef = useLatest(action);
  const timers = useRef<{ delay?: number; tick?: number; start: number }>({ start: 0 });

  const stop = useCallback(() => {
    const t = timers.current;
    if (t.delay) window.clearTimeout(t.delay);
    if (t.tick) window.clearTimeout(t.tick);
    t.delay = undefined;
    t.tick = undefined;
  }, []);

  useEffect(() => stop, [stop]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (disabled || e.button !== 0) return;
      stop();
      actionRef.current();
      const t = timers.current;
      t.start = performance.now();
      const loop = () => {
        actionRef.current();
        const held = performance.now() - t.start;
        t.tick = window.setTimeout(loop, held > 2000 ? 1000 / 30 : 1000 / 12);
      };
      t.delay = window.setTimeout(loop, 400);
    },
    [actionRef, disabled, stop],
  );

  const onClick = useCallback(
    (e: ReactMouseEvent) => {
      // Pointer presses already fired on pointerdown; only keyboard clicks (detail 0) act here.
      if (disabled || e.detail !== 0) return;
      actionRef.current();
    },
    [actionRef, disabled],
  );

  return { onPointerDown, onPointerUp: stop, onPointerLeave: stop, onPointerCancel: stop, onClick, onBlur: stop };
}
