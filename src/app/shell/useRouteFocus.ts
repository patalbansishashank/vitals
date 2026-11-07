import { useRef, type RefObject } from 'react';
import { useIsoLayoutEffect } from '@/components/lib/hooks';

/** Hand off keyboard focus when a route's title arrives, without polling every frame while a lazy page loads. */
export function useRouteFocus(main: RefObject<HTMLElement | null>, contextSlot: HTMLElement | null, pathname: string): void {
  const lastPath = useRef(pathname);
  const previousTitle = useRef<{ element: HTMLElement; text: string | null } | null>(null);

  useIsoLayoutEffect(() => {
    const navigating = lastPath.current !== pathname;
    lastPath.current = pathname;
    const old = previousTitle.current;
    const findTitle = () => contextSlot?.querySelector<HTMLElement>('h1') ?? main.current?.querySelector<HTMLElement>('h1') ?? null;
    const focusAtNavigation = document.activeElement;
    let frame = 0;
    let timeout = 0;
    let observer: MutationObserver | undefined;
    let finished = false;
    const stop = () => {
      finished = true;
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
    const cleanup = () => {
      stop();
      observer?.disconnect();
    };
    const settle = (expired = false) => {
      if (finished) return;
      const active = document.activeElement;
      // A newer interaction in the page or an overlay wins over the pending title handoff.
      if (
        navigating &&
        active instanceof HTMLElement &&
        active !== focusAtNavigation &&
        active !== document.body &&
        (contextSlot?.contains(active) || main.current?.contains(active) || active.closest('.lm-sidepanel, .lm-sheet, dialog, [role="dialog"]'))
      ) {
        stop();
        return;
      }
      const title = findTitle();
      if (!expired && (!title || (navigating && title === old?.element && title.textContent === old.text))) return;
      if (title) previousTitle.current = { element: title, text: title.textContent };
      if (navigating) {
        if (title?.isConnected) {
          title.tabIndex = -1;
          title.focus({ preventScroll: true });
        } else main.current?.focus({ preventScroll: true });
      }
      stop();
    };
    const schedule = () => {
      if (finished || frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        settle();
      });
    };
    if (typeof MutationObserver === 'function' && main.current) {
      observer = new MutationObserver((records) => {
        // Count-up digits and chart updates are unrelated to the heading. They must not restart a frame loop.
        const containsTitle = (node: Node) => node instanceof Element && (node.matches('h1') || node.querySelector('h1'));
        if (
          records.some(
            (record) =>
              (record.target instanceof Element ? record.target : record.target.parentElement)?.closest('h1') ||
              Array.from(record.addedNodes).some(containsTitle) ||
              Array.from(record.removedNodes).some(containsTitle),
          )
        ) {
          if (finished) {
            // A lazy page can replace the shell's initial heading after entry, without changing the route.
            const title = findTitle();
            if (title) previousTitle.current = { element: title, text: title.textContent };
          } else schedule();
        }
      });
      observer.observe(main.current, { childList: true, subtree: true, characterData: true });
    }
    // Initial entry establishes the previous title without taking focus. A committed new title needs just one frame.
    if (!navigating && findTitle()) {
      settle();
      return cleanup;
    }
    timeout = window.setTimeout(() => settle(true), 1000);
    schedule();
    return cleanup;
    // Only route changes hand off focus; query-string view state and slot registration must not take it.
  }, [pathname]);
}
