import { useEffect, useState } from 'react';
import { useReducedMotion } from './hooks';

let locks = 0;
/** Tell the smooth scroller (src/app/motion.ts) the page is locked or free again. */
function announce(locked: boolean): void {
  if (typeof window.CustomEvent === 'function') window.dispatchEvent(new CustomEvent('vitals:scroll-lock', { detail: locked }));
}
/** Lock page scroll while a modal surface is open (reference-counted). */
export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    locks += 1;
    if (locks === 1) {
      root.style.overflow = 'hidden';
      announce(true);
    }
    return () => {
      locks -= 1;
      if (locks === 0) {
        root.style.overflow = '';
        announce(false);
      }
    };
  }, [active]);
}

/** The exit of a surface under reduced motion: the 100 ms cross-fade components.css draws instead of the slide (AUDIT §4.2). */
export const REDUCED_EXIT_MS = 100;

/**
 * Keep a surface mounted through its exit transition. Returns [mounted, phase]:
 * phase is 'open' while shown and 'closed' during the exit, then it unmounts. Under reduced motion the exit is
 * `reducedExitMs` (default 0: an instant cut; the overlays that cross-fade pass `REDUCED_EXIT_MS`).
 */
export function usePresence(open: boolean, exitMs: number, reducedExitMs = 0): [boolean, 'open' | 'closed'] {
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(open);
  const [phase, setPhase] = useState<'open' | 'closed'>(open ? 'open' : 'closed');
  // derive during render: opening mounts immediately
  if (open && !mounted) setMounted(true);
  if (open && phase !== 'open') setPhase('open');
  if (!open && mounted && phase !== 'closed') setPhase('closed');
  useEffect(() => {
    if (open || !mounted) return;
    const t = window.setTimeout(() => setMounted(false), reduced ? reducedExitMs : exitMs);
    return () => window.clearTimeout(t);
  }, [open, mounted, exitMs, reducedExitMs, reduced]);
  return [mounted, phase];
}
