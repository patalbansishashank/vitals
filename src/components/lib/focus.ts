import { useEffect, useRef } from 'react';
import { useIsoLayoutEffect } from './hooks';

const TABBABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

/** Keyboard-reachable elements inside `root`, in DOM order. Layout-free so it also works in jsdom. */
export function getTabbables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter((el) => {
    if (el.tabIndex < 0) return false;
    if (el.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
    if (el instanceof HTMLInputElement && el.type === 'radio' && !el.checked) {
      // only the checked radio of a group is in the tab order
      const group = el.name ? root.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(el.name)}"]`) : [];
      if (Array.from(group).some((r) => r.checked)) return false;
    }
    return true;
  });
}

/**
 * Keep Tab / Shift+Tab inside `ref` while `active`. Native modal <dialog>
 * already makes the page inert; this adds wrap-around (and covers browsers or
 * test DOMs without showModal).
 */
export function useFocusTrap(ref: { readonly current: HTMLElement | null }, active: boolean): void {
  useEffect(() => {
    const root = ref.current;
    if (!active || !root) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = getTabbables(root);
      if (items.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const current = document.activeElement as HTMLElement | null;
      const inside = current ? root.contains(current) : false;
      if (e.shiftKey && (current === first || !inside || current === root)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (current === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    root.addEventListener('keydown', onKey);
    return () => root.removeEventListener('keydown', onKey);
  }, [ref, active]);
}

/** Remember the focused element when `active` turns on; restore it when it turns off. */
export function useRestoreFocus(active: boolean): void {
  // Capture in a layout effect: the overlay's own layout effect calls showModal(), which moves focus into the dialog
  // before passive effects run. Restore in the passive cleanup (after the focus trap lets go); the dialog stays modal
  // (page inert) through its exit animation, so retry each frame for a short while until the opener takes focus.
  const opener = useRef<HTMLElement | null>(null);
  useIsoLayoutEffect(() => {
    if (active) opener.current = document.activeElement as HTMLElement | null;
  }, [active]);
  useEffect(() => {
    if (!active) return;
    const previous = opener.current;
    return () => {
      if (!previous || typeof previous.focus !== 'function') return;
      let tries = 0;
      const attempt = () => {
        if (!previous.isConnected) return;
        previous.focus({ preventScroll: true });
        if (document.activeElement !== previous && ++tries < 40 && typeof requestAnimationFrame === 'function') requestAnimationFrame(attempt);
      };
      attempt();
    };
  }, [active]);
}
