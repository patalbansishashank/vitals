import { useEffect, useLayoutEffect, useRef, useState, type AnimationEvent, type CSSProperties, type ReactNode } from 'react';
import { useReducedMotion } from '../lib/hooks';
import { RingMark } from './RingMark';
import './brand.css';

/** Milliseconds from navigation start. index.html's start screen and public/brand/launch.css run the same clock. */
export const launchTiming = {
  /** Mark size on the start screen and the overlay, in px. */
  markPx: 88,
  /** Only pages younger than this get the overlay; later, the app shows at once. */
  continueUntilMs: 600,
  /** Overlay fade, started the moment the app is in the document (brand.css `lm-launch-fade` uses the same value). */
  fadeMs: 150,
  /** Gone by this whatever happens. */
  hardLimitMs: 1000,
} as const;

/** True when index.html's pre-JS start screen is (still) in the document, i.e. this is a cold load of the page. */
export const hadStartScreen = (): boolean => typeof document !== 'undefined' && document.querySelector('.vitals-launch') !== null;

/**
 * False only when the browser can tell that the start screen has not reached the screen yet: its ring animation is
 * still pending (an animation leaves `pending` in the first frame that renders it). Then the app simply replaces it and
 * there is nothing to hand over. Paint timing is no use here: Chromium files `first-contentful-paint` tens of ms after
 * the paint. Without the Web Animations API, or with a still mark, it counts as painted.
 */
export const startScreenPainted = (): boolean => {
  const ring = typeof document === 'undefined' ? null : document.querySelector('.vitals-launch__ring');
  if (!ring || typeof ring.getAnimations !== 'function') return true;
  const running = ring.getAnimations();
  return running.length === 0 || running.some((a) => !a.pending);
};

const sinceNavigation = (): number => Math.round(performance.now());

/**
 * Seamless hand-over from the pre-JS start screen. Mounted once at the app root around the app, which it renders
 * unchanged and interactive at once. The app is ready when this mounts (it commits together with its children), so
 * the overlay never waits for the draw-on: when the start screen was on screen and the page is still young, the same
 * mark (its animation shifted back by the elapsed time, so the ring carries on from where the static screen was) is
 * put over the app already fading, and unmounts after `fadeMs`. Older pages, a start screen that was never painted,
 * background tabs and reduced motion get nothing. It never delays the app.
 */
export function LaunchScreen({ children }: { children?: ReactNode }) {
  // Read before React commits: the commit replaces #root's children, taking the static screen with it. A page opened
  // in a background tab gets nothing: its timers are throttled, so the overlay could outlive the 1 s limit.
  const [elapsed] = useState(() =>
    hadStartScreen() && document.visibilityState !== 'hidden' && startScreenPainted() ? sinceNavigation() : Number.POSITIVE_INFINITY,
  );
  const reduced = useReducedMotion();
  const [done, setDone] = useState(false);
  const overlay = useRef<HTMLDivElement>(null);
  const show = !done && !reduced && elapsed < launchTiming.continueUntilMs;

  // The offset is set again just before paint: the first render of a whole app takes a few frames.
  useLayoutEffect(() => {
    overlay.current?.style.setProperty('--lm-ringmark-t0', `${-sinceNavigation()}ms`);
  }, [show]);

  // animationend normally ends the fade; the timers cover a tab that paused its animations, and the hard limit holds
  // whatever happens.
  useEffect(() => {
    if (!show) return;
    const now = sinceNavigation();
    const end = Math.max(0, Math.min(launchTiming.fadeMs + 50, launchTiming.hardLimitMs - now));
    const t = window.setTimeout(() => setDone(true), end);
    return () => window.clearTimeout(t);
  }, [show]);

  const onAnimationEnd = (e: AnimationEvent<HTMLDivElement>) => {
    if (e.animationName === 'lm-launch-fade') setDone(true);
  };

  return (
    <>
      {children}
      {show ? (
        <div
          ref={overlay}
          className="lm-launch"
          data-phase="fade"
          aria-hidden="true"
          style={{ '--lm-ringmark-t0': `${-elapsed}ms` } as CSSProperties}
          onAnimationEnd={onAnimationEnd}
        >
          <RingMark size={launchTiming.markPx} animate />
        </div>
      ) : null}
    </>
  );
}
