import { useEffect, useState } from 'react';
import { useReducedMotion } from './hooks';

let locks = 0;
/** Lock page scroll while a modal surface is open (reference-counted). */
export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    locks += 1;
    if (locks === 1) root.style.overflow = 'hidden';
    return () => {
      locks -= 1;
      if (locks === 0) root.style.overflow = '';
    };
  }, [active]);
}

/**
 * Keep a surface mounted through its exit transition. Returns [mounted, phase]:
 * phase is 'open' while shown and 'closed' during the exit, then it unmounts.
 */
export function usePresence(open: boolean, exitMs: number): [boolean, 'open' | 'closed'] {
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(open);
  const [phase, setPhase] = useState<'open' | 'closed'>(open ? 'open' : 'closed');
  // derive during render: opening mounts immediately
  if (open && !mounted) setMounted(true);
  if (open && phase !== 'open') setPhase('open');
  if (!open && mounted && phase !== 'closed') setPhase('closed');
  useEffect(() => {
    if (open || !mounted) return;
    const t = window.setTimeout(() => setMounted(false), reduced ? 0 : exitMs);
    return () => window.clearTimeout(t);
  }, [open, mounted, exitMs, reduced]);
  return [mounted, phase];
}
