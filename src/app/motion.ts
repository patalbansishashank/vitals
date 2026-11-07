/*
 * Motion (r068 U9): Lenis smooth scrolling on desktop pointers and GSAP entrances for cards and page changes. Subtle on
 * purpose: one short rise-and-fade when a screen opens, nothing while you read.
 *
 * Where it runs
 * - Lenis: only on a fine, hovering pointer (a mouse or trackpad) in the website and the desktop app; never on touch,
 *   never in the Android app, never under reduced motion (the OS setting, or Settings › Appearance › Motion).
 * - GSAP: the same reduced-motion rule; on every device otherwise. It animates transform and opacity only and clears
 *   them when done, so nothing stays on the compositor and no layout is touched while scrolling.
 * - Both load lazily (dynamic imports), and nothing loads in jsdom or a browser without matchMedia / rAF / animation
 *   frames, so tests and old engines never see them.
 *
 * For page fixers
 * - `usePageEntrance(ref, key)`: AppShell already calls it for every page change; cards (`.lm-face`, `.lm-material`)
 *   and anything marked `data-enter` rise into place, staggered, the ones in view only.
 * - `useEnter(ref, deps)`: the same entrance for a region whose content swaps without a page change (a tab panel, a
 *   sheet's step, a chart's view). It animates the region's cards and `data-enter` children when `deps` change.
 * - `enter(elements, { y, stagger, delay })`: imperative form.
 * - `data-motion="none"` on an element (or an ancestor) keeps it out of every entrance.
 * - `scrollPageTo(y, { immediate })`: scroll the page through Lenis when it runs (so the smoothing and the overlay
 *   scrollbar agree), else natively.
 *
 * The pictures' motion hooks (r071, AUDIT §4): `useInView`, `useCountUp`, `useSweep`, `useDrawIn`, `useGrow`, `usePulse`
 * and `useFlip`, below the entrance. The shipped pictures (src/components/viz) reveal through CSS states keyed on
 * `data-reveal="pending"`, which `useInView` drives; `useCountUp` counts HeroNumber, `useFlip` slides CardGrid and
 * CardLibrary; `useSweep`, `useDrawIn`, `useGrow` and `usePulse` are for a picture that needs a JS-driven value (the gallery's
 * motion demo uses all of them). The rules they share:
 * - state, not decoration: every one has a still, FINAL frame that is the real content, and `motionAllowed()` false
 *   (jsdom, `prefers-reduced-motion`, Settings › Motion "reduce") means every hook returns that final state at once, so
 *   a test, a screenshot and a person who asked for less all see the content;
 * - they animate `transform`, `opacity`, `clip-path`, SVG `stroke-dashoffset` and the registered `--lm-glow-k`, never a
 *   layout property and never a gradient; simple reveals use the Web Animations API, so a picture works without GSAP;
 * - they start when the picture is 20 % in view, once per mount (`useInView`); a value that changes after a log
 *   re-animates from the old value to the new, not from zero;
 * - durations are the tokens' (tokens.css §16; `MOTION` below mirrors them and tokens.test pins both), and everything
 *   tears down on unmount.
 */
import { useCallback, useEffect, useRef, useState, type DependencyList, type RefObject } from 'react';
import { useIsoLayoutEffect } from '@/components/lib/hooks';
import type Lenis from 'lenis';
import type { gsap as GsapNs } from 'gsap';
import { detectPlatform } from '@/platform/detect';

type Gsap = typeof GsapNs;

const ENTER_SELECTOR = '.lm-face, .lm-material, [data-enter]';
const MAX_ANIMATED = 14;

function hasDom(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function isJsdom(): boolean {
  return typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
}

function mq(query: string): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
}

/** Motion may run: a real browser, and neither the OS nor the person asked for less (`data-motion` on <html>). */
export function motionAllowed(): boolean {
  if (!hasDom() || isJsdom()) return false;
  if (typeof window.requestAnimationFrame !== 'function' || typeof window.matchMedia !== 'function') return false;
  const pref = document.documentElement.dataset.motion;
  if (pref === 'reduce') return false;
  if (pref === 'full') return true;
  return !mq('(prefers-reduced-motion: reduce)');
}

/** Smooth scrolling may run: motion allowed, a fine hovering pointer, not the Android app. */
export function smoothScrollAllowed(): boolean {
  return motionAllowed() && detectPlatform() !== 'android' && mq('(hover: hover) and (pointer: fine)') && !mq('(pointer: coarse)');
}

// ---- GSAP ------------------------------------------------------------------------------------------------------

let gsapRef: Gsap | null = null;
let gsapLoading: Promise<Gsap | null> | null = null;

/** Load GSAP once (idle-time preload from `initMotion`); resolves null where motion cannot run. */
export function loadGsap(): Promise<Gsap | null> {
  if (gsapRef) return Promise.resolve(gsapRef);
  if (!motionAllowed()) return Promise.resolve(null);
  gsapLoading ??= import('gsap')
    .then((m) => {
      gsapRef = m.gsap ?? (m.default as unknown as Gsap);
      return gsapRef;
    })
    .catch(() => null);
  return gsapLoading;
}

export interface EnterOptions {
  /** Rise distance in px (default 10). */
  y?: number;
  /** Seconds between items (default 0.035). */
  stagger?: number;
  /** Seconds before the first (default 0). */
  delay?: number;
}

/**
 * A short rise-and-fade (opacity 0 → 1, y → 0 over 420 ms, expo-like ease-out) for the given elements, the ones in
 * the viewport only, at most 14. A no-op while GSAP is not loaded yet or motion is not allowed: elements then simply
 * show, so an entrance can never hide content.
 */
export function enter(targets: Iterable<Element> | ArrayLike<Element>, opts: EnterOptions = {}): void {
  const g = gsapRef;
  if (!g || !motionAllowed()) return;
  const vh = window.innerHeight || 0;
  const els = Array.from(targets as ArrayLike<Element>).filter((el) => {
    if (!(el instanceof HTMLElement) || !el.isConnected || el.closest('[data-motion="none"]')) return false;
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < vh && r.width > 0;
  });
  if (els.length === 0) return;
  const list = els.slice(0, MAX_ANIMATED);
  g.killTweensOf(list);
  g.fromTo(
    list,
    { opacity: 0, y: opts.y ?? 10 },
    {
      opacity: 1,
      y: 0,
      duration: 0.42,
      ease: 'power3.out',
      delay: opts.delay ?? 0,
      stagger: opts.stagger ?? 0.035,
      overwrite: 'auto',
      clearProps: 'opacity,transform',
    },
  );
}

/** Outermost matches only: a card's own inner `data-enter` children ride with the card. */
function topLevel(nodes: Element[]): Element[] {
  const set = new Set(nodes);
  return nodes.filter((n) => {
    for (let p = n.parentElement; p; p = p.parentElement) if (set.has(p)) return false;
    return true;
  });
}

function collect(root: Element): Element[] {
  return topLevel(Array.from(root.querySelectorAll(ENTER_SELECTOR)));
}

/**
 * The page entrance (AppShell): when `key` changes (the pathname), the cards in view rise into place. Cards that a lazy
 * screen mounts a moment later are caught too: a MutationObserver watches the column for ~1 s, and its callback runs
 * before the browser paints, so a card never flashes in before its entrance.
 */
export function usePageEntrance(ref: RefObject<HTMLElement | null>, key: string): void {
  useIsoLayoutEffect(() => {
    const root = ref.current;
    if (!root || !motionAllowed() || !gsapRef || typeof MutationObserver !== 'function') return;
    const seen = new WeakSet<Element>();
    const run = (els: Element[]) => {
      const fresh = els.filter((e) => !seen.has(e));
      fresh.forEach((e) => seen.add(e));
      if (fresh.length) enter(fresh);
    };
    run(collect(root));
    const mo = new MutationObserver((records) => {
      const added: Element[] = [];
      for (const r of records)
        r.addedNodes.forEach((n) => {
          if (!(n instanceof Element)) return;
          if (n.matches(ENTER_SELECTOR)) added.push(n);
          added.push(...Array.from(n.querySelectorAll(ENTER_SELECTOR)));
        });
      if (added.length) run(topLevel(added));
    });
    mo.observe(root, { childList: true, subtree: true });
    const stop = window.setTimeout(() => mo.disconnect(), 1000);
    return () => {
      window.clearTimeout(stop);
      mo.disconnect();
    };
  }, [key]);
}

/** The entrance for a region whose content swaps in place (a tab panel, a step): runs when `deps` change, not on mount. */
export function useEnter(ref: RefObject<HTMLElement | null>, deps: DependencyList): void {
  const first = useRef(true);
  useIsoLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const root = ref.current;
    if (!root) return;
    const els = collect(root);
    enter(els.length ? els : Array.from(root.children));
  }, deps);
}

// ---- picture motion (r071) -------------------------------------------------------------------------------------

/** The picture motion tokens, in ms (tokens.css §16: --lm-dur-count … --lm-stagger-bar). tokens.test.ts pins them equal. */
export const MOTION = {
  count: 1100,
  countUpdate: 400,
  draw: 1200,
  glow: 900,
  bars: 700,
  fill: 900,
  staggerTick: 14,
  staggerBar: 60,
  pulseCycles: 2,
  /** One pulse of the live mark: 2.4 s, twice, then still (4.8 s: under WCAG 2.2.2's five seconds). */
  pulse: 2400,
  /** The cross-fade a state change gets under reduced motion instead of a move (AUDIT §4.2 rule 6). */
  reducedFade: 100,
  flip: 280,
} as const;

/** `--lm-ease-out`, expo-out: the default curve of every picture. */
export const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
/** `--lm-ease-needle`: the one damped overshoot (a dock thumb, a settling needle, a FLIP). */
export const EASE_NEEDLE = 'cubic-bezier(0.34, 1.36, 0.64, 1)';

/** Expo-out as a function of progress 0–1 (the same shape as `EASE_OUT`; the count-up and the sweep use it). */
const easeOutExpo = (t: number): number => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);
const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** The Web Animations API is there (not in jsdom, not in an old WebView). */
function canAnimate(el: Element | null | undefined): el is HTMLElement | SVGElement {
  return !!el && typeof (el as HTMLElement).animate === 'function';
}

export interface InViewOptions {
  /** Stay true after the first time (default true: a picture animates once per mount). */
  once?: boolean;
  /** How much of the element must show (default 0.2). */
  threshold?: number;
}

/**
 * True once `ref`'s element is `threshold` (20 %) in view. Where motion cannot run (jsdom, reduced motion, no
 * IntersectionObserver) it is true from the first render: the picture starts in its final state and nothing ever waits
 * for a scroll. Pass the result to the other hooks' `start`.
 */
export function useInView(ref: RefObject<Element | null>, { once = true, threshold = 0.2 }: InViewOptions = {}): boolean {
  const [seen, setSeen] = useState(() => !motionAllowed() || typeof IntersectionObserver !== 'function');
  useEffect(() => {
    if (!motionAllowed() || typeof IntersectionObserver !== 'function') return;
    const el = ref.current;
    if (!el || (seen && once)) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setSeen(true);
            if (once) io.disconnect();
          } else if (!once) setSeen(false);
        }
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, once, threshold, seen]);
  return seen;
}

interface TweenOptions {
  /** Where the first run starts (default 0). */
  from?: number;
  /** ms of the first run (default `MOTION.count`). */
  duration?: number;
  /** ms of a later run, from the old value to the new (default `MOTION.countUpdate`). */
  updateDuration?: number;
  /** Hold at `from` until true (the picture is in view). Default true. */
  start?: boolean;
  ease?: (t: number) => number;
  /** ms for a run that travels `delta` (overrides `duration` and `updateDuration`; the sweep takes a fixed time per tick). */
  length?: (delta: number) => number;
}

/**
 * A number tweened to `target` with requestAnimationFrame. Returns `target` itself where motion cannot run. The first
 * run goes from `from` (0) to `target`; a later change goes from what is shown to the new `target` in the shorter
 * update duration, so a logged meal moves a total instead of replaying it.
 */
function useTween(target: number | null | undefined, { from = 0, duration = MOTION.count, updateDuration = MOTION.countUpdate, start = true, ease = easeOutExpo, length: lengthOf }: TweenOptions): number | null {
  const goal = target ?? null;
  const allowed = motionAllowed();
  const [shown, setShown] = useState<number>(from);
  const shownRef = useRef(from);
  const first = useRef(true);
  useEffect(() => {
    if (goal === null || !start || !motionAllowed()) return;
    const origin = first.current ? from : shownRef.current;
    const length = lengthOf ? lengthOf(goal - origin) : first.current ? duration : updateDuration;
    first.current = false;
    const t0 = now();
    let raf = 0;
    const tick = () => {
      const p = origin === goal || length <= 0 ? 1 : clamp01((now() - t0) / length);
      const v = p >= 1 ? goal : origin + (goal - origin) * ease(p);
      shownRef.current = v;
      setShown(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [goal, start, from, duration, updateDuration, ease, lengthOf]);
  // where motion cannot run (or there is nothing to show) the final state is derived at once: no tween state, no frame
  return goal === null ? null : allowed ? shown : goal;
}

export interface CountUpOptions {
  /**
   * The final string (`"1,096"`), accepted so the call shape of AUDIT §4.5 compiles. The hook lays nothing out: reserve
   * its width yourself (a `min-width` in `ch` of this string) so the unit beside the number never moves while the digits
   * change.
   */
  reserve?: string;
  /** Where the first count starts (default 0). */
  from?: number;
  /** ms of the first count (default 1100, `--lm-dur-count`). */
  duration?: number;
  /** ms of a count from the old value to a new one (default 400). */
  updateDuration?: number;
  /** Hold at `from` until true (the card is in view: `useInView`). Default true. */
  start?: boolean;
}

/**
 * A number counting up (HeroNumber): 0 → `value` in 1100 ms, expo-out, when it first starts; from what is shown to the new
 * value in 400 ms when `value` changes. Returns `value` unchanged (the final state) where motion cannot run. Round or
 * format what it returns yourself, and reserve the final string's width so the unit beside it never moves while the
 * digits change; give the element an `aria-label` with the final value and mark the animating digits `aria-hidden`.
 */
export function useCountUp(value: number | null | undefined, opts: CountUpOptions = {}): number | null {
  return useTween(value, opts);
}

export interface SweepOptions {
  /** ms between two ticks lighting (default 14, `--lm-stagger-tick`: 72 ticks take about a second). */
  stagger?: number;
  /** Hold unlit until true. Default true. */
  start?: boolean;
}

/**
 * How many of `count` ticks are lit while a gauge sweeps (RadialTicks, a tick row): they light one after another at
 * `stagger` ms each, clockwise, up to `count`; a later change re-sweeps from the old count to the new one only.
 * Returns `count` itself where motion cannot run.
 */
export function useSweep(count: number, { stagger = MOTION.staggerTick, start = true }: SweepOptions = {}): number {
  const length = useCallback((delta: number) => Math.abs(delta) * stagger, [stagger]);
  const ticks = useTween(count, { start, length, ease: clamp01 });
  return Math.round(ticks ?? count);
}

export interface DrawInOptions {
  /** `clip` (default) reveals the element left to right with a clip-path; `dash` draws an SVG path by its stroke. */
  mode?: 'clip' | 'dash';
  /** ms (default 1200, `--lm-dur-draw`). */
  duration?: number;
  /** ms before it starts (default 120). */
  delay?: number;
  /** Hold until true (in view). Default true. */
  start?: boolean;
}

/**
 * A line draws itself left to right (GlowLine, the hypnogram's wipe): a clip reveal of `ref`'s element (the whole
 * element, so an end dot placed inside it appears with the line), or `mode: 'dash'` on an SVG path (stroke-dashoffset).
 * A Web Animation with `fill: backwards`, so before it starts the element is hidden and after it ends the element is
 * exactly its still frame. No-op where motion cannot run. The glow, the area and the forecast of a card come in after
 * the line: give them their own `useDrawIn` with a later `delay`.
 */
export function useDrawIn(ref: RefObject<Element | null>, { mode = 'clip', duration = MOTION.draw, delay = 120, start = true }: DrawInOptions = {}): void {
  useEffect(() => {
    const el = ref.current;
    if (!start || !motionAllowed() || !canAnimate(el)) return;
    let length = 0;
    if (mode === 'dash') {
      const path = el as unknown as SVGGeometryElement;
      if (typeof path.getTotalLength !== 'function') return;
      length = path.getTotalLength();
    }
    const frames: Keyframe[] =
      mode === 'dash'
        ? [{ strokeDasharray: `${length}`, strokeDashoffset: `${length}` }, { strokeDasharray: `${length}`, strokeDashoffset: '0' }]
        : [{ clipPath: 'inset(-8px 100% -8px 0)' }, { clipPath: 'inset(-8px -8px -8px 0)' }];
    const anim = el.animate(frames, { duration, delay, easing: EASE_OUT, fill: 'backwards' });
    return () => anim.cancel();
  }, [ref, mode, duration, delay, start]);
}

export interface GrowOptions {
  /** Which children grow (default every direct child). */
  selector?: string;
  /** `y` grows up from the baseline (bars; default), `x` grows from the left (a segment of a stacked bar). */
  axis?: 'y' | 'x';
  /** ms between two children (default 60, `--lm-stagger-bar`). */
  stagger?: number;
  /** ms each takes (default 700, `--lm-dur-bars`). */
  duration?: number;
  /** Hold until true (in view). Default true. */
  start?: boolean;
}

/**
 * Bars grow from their baseline, one after another (HighlightBars, StackBar): each child of `ref`'s element scales from 0
 * to 1 on its own axis with its origin at the baseline (transform only, no layout), staggered. A Web Animation with
 * `fill: backwards`: the still frame is the real bar. No-op where motion cannot run.
 */
export function useGrow(ref: RefObject<Element | null>, { selector, axis = 'y', stagger = MOTION.staggerBar, duration = MOTION.bars, start = true }: GrowOptions = {}): void {
  useEffect(() => {
    const root = ref.current;
    if (!start || !motionAllowed() || !root) return;
    const kids = Array.from(selector ? root.querySelectorAll(selector) : root.children).filter(canAnimate);
    const origin = axis === 'y' ? 'bottom center' : 'left center';
    const from = axis === 'y' ? 'scaleY(0)' : 'scaleX(0)';
    const anims = kids.map((el, i) => el.animate([{ transformOrigin: origin, transform: from }, { transformOrigin: origin, transform: 'none' }], { duration, delay: i * stagger, easing: EASE_OUT, fill: 'backwards' }));
    return () => anims.forEach((a) => a.cancel());
  }, [ref, selector, axis, stagger, duration, start]);
}

/**
 * Whether a live mark is pulsing: true for `times` pulses (default 2, `--lm-pulse-cycles`, 2.4 s each) from the first
 * render, then false for good. Put it in `data-pulse` on a `.lm-live` mark (components.css draws its two rings); a live
 * mark never pulses for longer than 4.8 s (WCAG 2.2.2) and never under reduced motion, where the dot just stays. A mark
 * that must pulse again (a new reading arrived) remounts with a new `key`.
 */
export function usePulse(times: number = MOTION.pulseCycles): boolean {
  const [finished, setFinished] = useState(false);
  useEffect(() => {
    if (!motionAllowed() || times <= 0) return;
    const stop = window.setTimeout(() => setFinished(true), times * MOTION.pulse);
    return () => window.clearTimeout(stop);
  }, [times]);
  return motionAllowed() && times > 0 && !finished;
}

export interface FlipOptions {
  /** Which children move (default `[data-flip]`; the attribute's value is the child's identity). */
  selector?: string;
  /** ms (default 280, on the one damped overshoot). */
  duration?: number;
}

/**
 * A child's layout place and size, in px, relative to the element that holds them (so a page scroll is never a move), and
 * the translation it was carrying when it was measured (its own slide still running), which a new slide starts from.
 */
interface FlipBox {
  x: number;
  y: number;
  w: number;
  h: number;
  sx: number;
  sy: number;
}

const flipIdentity = (el: HTMLElement): Element | string => el.dataset.flip || el;

function flipItems(root: HTMLElement, selector: string): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(selector));
}

/** The translation a child is carrying right now (its own FLIP or entrance still running), so a measure sees its layout place. */
function flipShift(el: HTMLElement): { dx: number; dy: number } {
  if (typeof DOMMatrixReadOnly !== 'function') return { dx: 0, dy: 0 };
  const t = getComputedStyle(el).transform;
  if (!t || t === 'none') return { dx: 0, dy: 0 };
  try {
    const m = new DOMMatrixReadOnly(t);
    return { dx: m.m41, dy: m.m42 };
  } catch {
    return { dx: 0, dy: 0 };
  }
}

function flipPlaces(root: HTMLElement, items: HTMLElement[]): Map<Element | string, FlipBox> {
  const base = root.getBoundingClientRect();
  const out = new Map<Element | string, FlipBox>();
  for (const el of items) {
    const r = el.getBoundingClientRect();
    const { dx, dy } = flipShift(el);
    out.set(flipIdentity(el), { x: r.left - base.left - dx, y: r.top - base.top - dy, w: r.width, h: r.height, sx: dx, sy: dy });
  }
  return out;
}

/**
 * FLIP: when `key` changes (a card was added, removed, moved or resized), the children of `ref`'s element slide from where
 * they were to where they are, instead of jumping (CardGrid, the library's list). Children are matched by the value of
 * `data-flip` (else by element), measured in a layout effect after each change; a child that is new does not slide.
 * Places are measured against `ref`'s element, so scrolling the page between two changes is not read as a move, and they
 * are re-measured when the element or a child is resized (a card that grew, a window that narrowed) so the next change
 * starts from where the children really are. No-op where motion cannot run: they simply sit in their new places. Under
 * reduced motion the caller may `fadeCue` an added card instead.
 */
export function useFlip(ref: RefObject<HTMLElement | null>, key: unknown, { selector = '[data-flip]', duration = MOTION.flip }: FlipOptions = {}): void {
  const before = useRef(new Map<Element | string, FlipBox>());
  useIsoLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const items = flipItems(root, selector);
    const after = flipPlaces(root, items);
    if (motionAllowed() && before.current.size > 0) {
      for (const el of items) {
        const was = before.current.get(flipIdentity(el));
        const is = after.get(flipIdentity(el));
        if (!was || !is) continue;
        const dx = was.x - is.x;
        const dy = was.y - is.y;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(was.w - is.w) < 1 && Math.abs(was.h - is.h) < 1) continue;
        if (!canAnimate(el)) continue;
        // from where it was last seen: its old place, plus the slide it was still carrying (a drag moves a row again before it settles)
        el.animate([{ transform: `translate(${dx + is.sx}px, ${dy + is.sy}px)` }, { transform: 'none' }], { duration, easing: EASE_NEEDLE });
      }
    }
    before.current = after;
  }, [key]);
  useEffect(() => {
    const root = ref.current;
    if (!root || !motionAllowed() || typeof ResizeObserver !== 'function') return;
    let raf = 0;
    let initial = true;
    const refresh = () => {
      // an observer reports once when it starts: that is the layout the effect above has just measured
      if (initial) {
        initial = false;
        return;
      }
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        before.current = flipPlaces(root, flipItems(root, selector));
      });
    };
    const ro = new ResizeObserver(refresh);
    ro.observe(root);
    for (const el of flipItems(root, selector)) ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [ref, selector, key]);
}

/**
 * The cue a state change gets under reduced motion instead of a move: a 100 ms cross-fade of `el` (a card that was just
 * added, a tick that just filled). Does nothing when motion is allowed (the caller's own animation is the cue) or where
 * the Web Animations API is missing.
 */
export function fadeCue(el: Element | null | undefined): void {
  if (!hasDom() || isJsdom() || motionAllowed() || !canAnimate(el)) return;
  el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: MOTION.reducedFade, easing: 'linear' });
}

// ---- Lenis -----------------------------------------------------------------------------------------------------

let lenis: Lenis | null = null;
let lenisFrame = 0;

/** Lenis only needs a clock during a glide. Reading a still page must not keep a 60 Hz loop alive. */
function tickLenis(time: number): void {
  lenisFrame = 0;
  if (!lenis) return;
  lenis.raf(time);
  if (lenis.isScrolling === 'smooth') lenisFrame = window.requestAnimationFrame(tickLenis);
}

function wakeLenis(): void {
  if (!lenis || lenisFrame) return;
  // Reset the clock before a new gesture: time spent reading must not advance its first frame by seconds.
  lenis.raf(now());
  lenisFrame = window.requestAnimationFrame(tickLenis);
}

/** The running Lenis instance, or null (touch, Android, reduced motion, tests). */
export function getLenis(): Lenis | null {
  return lenis;
}

/** Scroll the page to `y`, through Lenis when it runs so its smoothing and the native position agree. */
export function scrollPageTo(y: number, opts: { immediate?: boolean } = {}): void {
  if (lenis) {
    if (!opts.immediate) wakeLenis();
    lenis.scrollTo(y, { immediate: opts.immediate ?? false, force: true });
  } else window.scrollTo({ top: y, behavior: opts.immediate ? 'instant' : 'auto' });
}

/** After a programmatic scroll (route change, scroll restoration): drop any glide still under way. */
export function syncSmoothScroll(): void {
  if (lenis) lenis.scrollTo(window.scrollY, { immediate: true, force: true });
}

/** Overlays lock the page (useScrollLock): Lenis stops with them. */
function onScrollLock(e: Event): void {
  if (!lenis) return;
  if ((e as CustomEvent<boolean>).detail) lenis.stop();
  else lenis.start();
}

async function startLenis(): Promise<void> {
  if (lenis || !smoothScrollAllowed()) return;
  const { default: LenisCtor } = await import('lenis');
  if (lenis || !smoothScrollAllowed()) return;
  lenis = new LenisCtor({
    autoRaf: false,
    lerp: 0.16,
    smoothWheel: true,
    syncTouch: false,
    // a sheet, a side panel, a menu or any scrollable box under the pointer scrolls itself, natively
    allowNestedScroll: true,
    prevent: (node: HTMLElement) =>
      document.documentElement.style.overflow === 'hidden' || !!node.closest?.('dialog, [role="dialog"], [role="listbox"], [role="menu"], .lm-sheet, .lm-sidepanel, .lm-popover'),
  });
  // Emitted before Lenis processes a wheel gesture; the queued frame sees its new target.
  lenis.on('virtual-scroll', wakeLenis);
  if (document.documentElement.style.overflow === 'hidden') lenis.stop();
}

function stopLenis(): void {
  window.cancelAnimationFrame(lenisFrame);
  lenisFrame = 0;
  lenis?.destroy();
  lenis = null;
}

let initialised = false;

/**
 * Boot (main.tsx): marks the platform on <html> (`data-platform`, read by base.css), starts Lenis where it may run and
 * follows changes to the pointer and the motion preference, and preloads GSAP when the browser is idle.
 */
export function initMotion(): void {
  if (initialised || !hasDom()) return;
  initialised = true;
  document.documentElement.dataset.platform = detectPlatform();
  if (isJsdom() || typeof window.matchMedia !== 'function') return;
  window.addEventListener('vitals:scroll-lock', onScrollLock);
  const update = () => {
    if (smoothScrollAllowed()) void startLenis();
    else stopLenis();
    if (motionAllowed()) void loadGsap();
  };
  for (const q of ['(prefers-reduced-motion: reduce)', '(hover: hover) and (pointer: fine)', '(pointer: coarse)']) window.matchMedia(q).addEventListener?.('change', update);
  // Settings › Appearance › Motion writes data-motion on <html> (src/app/theme.ts)
  if (typeof MutationObserver === 'function') new MutationObserver(update).observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
  if (idle) idle(update);
  else window.setTimeout(update, 200);
}
