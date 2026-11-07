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

/** The opener's address, kept so that focus can still come back near it when the element itself is replaced. */
interface Opener {
  el: HTMLElement;
  id: string;
  parent: HTMLElement | null;
}

function openerOf(el: Element | null): Opener | null {
  if (!(el instanceof HTMLElement) || el === document.body || el === document.documentElement) return null;
  return { el, id: el.id, parent: el.parentElement };
}

/** One open overlay: what to give focus back to, where it is, what it was handed, and its restore waiting to fire. */
interface Entry {
  opener: Opener | null;
  root: HTMLElement | null;
  inherited: Opener | null;
  pending: ReturnType<typeof setTimeout> | null;
}

/** The overlays that are open right now, oldest first. */
const open: Entry[] = [];

/** How long a restore keeps trying while the page is still inert behind a closing dialog (ms). Time, not frames: a 120 Hz phone paints 40 frames in 333 ms, less than a sheet's exit. */
const RESTORE_WINDOW = 1500;

/** An opener that can take focus now: still in the page, and not inside an overlay that is closing or closed. */
function usable(o: Opener | null): o is Opener {
  return !!o && o.el.isConnected && !o.el.closest('dialog:not([open]), [data-state="closed"]');
}

/** The element that took an opener's place when the opener itself was replaced while the overlay was open (same id, else the first tabbable in its old parent). */
function replacement(o: Opener | null): Opener | null {
  if (!o || o.el.isConnected) return null;
  const byId = o.id ? document.getElementById(o.id) : null;
  if (byId) return openerOf(byId);
  const near = o.parent?.isConnected ? getTabbables(o.parent)[0] : undefined;
  return near ? openerOf(near) : null;
}

/** Focus is nowhere useful: on <body>, or still inside an overlay that is closing or closed. */
function adrift(): boolean {
  const a = document.activeElement;
  return !a || a === document.body || a === document.documentElement || !!a.closest('dialog:not([open]), [data-state="closed"]');
}

/**
 * Give focus back to `target`, unless focus already lives somewhere useful: a host that places focus itself when its
 * overlay closes ("keeping it returns focus to its row", "focus goes to the program that takes its days") wins over the
 * automatic restore, which only fills the gap. A modal <dialog> keeps the page inert until it is closed or removed, and
 * an exit animation keeps it modal for 320 ms, so the first tries fail: retry every frame for `RESTORE_WINDOW` ms.
 */
function restoreFocus(target: Opener): void {
  const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const until = clock() + RESTORE_WINDOW;
  const attempt = () => {
    if (!adrift()) return;
    const el = target.el.isConnected ? target.el : replacement(target)?.el;
    if (!el) return;
    el.focus({ preventScroll: true });
    if (document.activeElement === el) return;
    if (clock() < until && typeof requestAnimationFrame === 'function') requestAnimationFrame(attempt);
  };
  attempt();
}

/**
 * An overlay has closed. Focus goes to its opener (or what replaced it, or the opener of an overlay that closed into
 * this one). Not while ANOTHER overlay is open and the target lies outside it: that is an overlay that closed as the
 * next one opened (a program's sheet whose "Edit all days" opens the day editor), and taking focus then would steal it
 * from the one on screen. The target is handed to the overlay that is open now, which gives focus there when IT closes,
 * even though its own opener (a key inside the first sheet) is gone with it. A dialog opened from inside a sheet has its
 * opener inside the open sheet, so it restores at once.
 */
function release(e: Entry): void {
  const own = usable(e.opener) ? e.opener : replacement(e.opener);
  const heir = own ?? (usable(e.inherited) ? e.inherited : null);
  if (!heir) return;
  const top = open[open.length - 1];
  if (top && !(top.root && top.root.contains(heir.el))) {
    top.inherited ??= heir;
    return;
  }
  restoreFocus(heir);
}

/**
 * Remember the focused element when `active` turns on; give it back when `active` turns off (or the host unmounts while
 * it is on). Pass the overlay's element as `rootRef` so a nested overlay can tell where focus may go. Three things the
 * first version got wrong, each of which left focus on <body> after a phone Sheet closed (audit r071 B P1-1):
 * - the opener is captured ONCE per opening, in a layout effect (the overlay's own layout effect calls showModal(),
 *   which moves focus into the dialog, so this must run first). React StrictMode (development) runs every effect twice
 *   on mount, and the second capture used to find focus already inside the dialog and overwrite the opener with it;
 * - the retry after `active` turns off was capped at 40 frames: 333 ms at 120 Hz, shorter than the sheet's 320 ms exit
 *   plus its removal, so it gave up before the page stopped being inert. It is a time window now;
 * - a host that closes by unmounting the overlay (`{sheet && <Sheet open …>}`) never rendered `open={false}`: the
 *   cleanup still runs on unmount, and the restore is scheduled outside the component's life.
 * The restore is scheduled from the cleanup and cancelled if the effect sets up again at once (StrictMode's simulated
 * remount), so it never steals focus from an overlay that is just opening.
 */
export function useRestoreFocus(active: boolean, rootRef?: { readonly current: HTMLElement | null }): void {
  const entry = useRef<Entry>({ opener: null, root: null, inherited: null, pending: null });
  const captured = useRef(false);
  useIsoLayoutEffect(() => {
    if (!active) {
      captured.current = false;
      return;
    }
    if (captured.current) return;
    captured.current = true;
    entry.current.opener = openerOf(document.activeElement);
    entry.current.root = rootRef?.current ?? null;
    entry.current.inherited = null;
  }, [active, rootRef]);
  useEffect(() => {
    if (!active) return;
    const e = entry.current;
    if (e.pending !== null) {
      clearTimeout(e.pending);
      e.pending = null;
    }
    open.push(e);
    return () => {
      const at = open.indexOf(e);
      if (at >= 0) open.splice(at, 1);
      e.pending = setTimeout(() => {
        e.pending = null;
        release(e);
      }, 0);
    };
  }, [active]);
}
