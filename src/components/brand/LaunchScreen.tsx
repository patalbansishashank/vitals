import { useEffect, useLayoutEffect, useRef, useState, type AnimationEvent, type CSSProperties, type ReactNode } from 'react';
import { useReducedMotion } from '../lib/hooks';
import { DRAW_ON } from './geometry';
import { RingMark } from './RingMark';
import './brand.css';

/** Milliseconds from navigation start. index.html's start screen and public/brand/launch.css run the same clock. */
export const launchTiming = {
  /** Mark size on the start screen and the overlay, in px. */
  markPx: 88,
  /** Only pages younger than this get the overlay; later, the app shows at once. */
  continueUntilMs: 600,
  /** The dot has popped: ring 0–500, dot 420–640. */
  drawnMs: DRAW_ON.dotDelayMs + DRAW_ON.dotMs,
  /** Overlay fade. */
  fadeMs: 150,
  /** Gone by this whatever happens. */
  hardLimitMs: 1000,
} as const;

/** True when index.html's pre-JS start screen is (still) in the document, i.e. this is a cold load of the page. */
export const hadStartScreen = (): boolean => typeof document !== 'undefined' && document.querySelector('.vitals-launch') !== null;

const sinceNavigation = (): number => Math.round(performance.now());

type Phase = 'draw' | 'fade' | 'done';

/**
 * Seamless hand-over from the pre-JS start screen. Mounted once at the app root around the app, which it renders
 * unchanged and interactive at once. When the start screen was in the HTML and the page is still young, the same mark
 * is drawn over the app with its animation shifted back by the elapsed time, so the ring keeps drawing where the
 * static screen left it; once the dot has popped the overlay fades and unmounts. Older pages and reduced motion get
 * nothing. It never delays the app.
 */
export function LaunchScreen({ children }: { children?: ReactNode }) {
  // Read before React commits: the commit replaces #root's children, taking the static screen with it. A page opened
  // in a background tab gets nothing: its timers are throttled, so the overlay could outlive the 1 s limit.
  const [elapsed] = useState(() =>
    hadStartScreen() && document.visibilityState !== 'hidden' ? sinceNavigation() : Number.POSITIVE_INFINITY,
  );
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('draw');
  const overlay = useRef<HTMLDivElement>(null);
  const show = phase !== 'done' && !reduced && elapsed < launchTiming.continueUntilMs;

  // The offset is set again just before paint: the first render of a whole app takes a few frames.
  useLayoutEffect(() => {
    overlay.current?.style.setProperty('--lm-ringmark-t0', `${-sinceNavigation()}ms`);
  }, [show]);

  useEffect(() => {
    if (!show) return;
    const now = sinceNavigation();
    const fade = window.setTimeout(() => setPhase('fade'), Math.max(0, launchTiming.drawnMs - now));
    const hard = window.setTimeout(() => setPhase('done'), Math.max(0, launchTiming.hardLimitMs - now));
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(hard);
    };
  }, [show]);

  // animationend normally ends the fade; the timer covers a tab that paused its animations.
  useEffect(() => {
    if (phase !== 'fade') return;
    const t = window.setTimeout(() => setPhase('done'), launchTiming.fadeMs + 50);
    return () => window.clearTimeout(t);
  }, [phase]);

  const onAnimationEnd = (e: AnimationEvent<HTMLDivElement>) => {
    if (e.animationName === 'lm-launch-fade') setPhase('done');
  };

  return (
    <>
      {children}
      {show ? (
        <div
          ref={overlay}
          className="lm-launch"
          data-phase={phase}
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
