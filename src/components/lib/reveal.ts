/**
 * The first-view reveal and count-up of the r071 pictures, as the page packages call them: `useReveal`, `useMotionEnabled`
 * and `useCountUp`. They are thin wrappers over the shared hooks of src/app/motion.ts (`useInView`, `useCountUp`,
 * `motionAllowed`), which are the one implementation: reduced motion, jsdom, `animate={false}` and a missing
 * IntersectionObserver all give the final frame from the first render, and a first view starts the picture once per mount.
 * New code may call the shared hooks directly; these keep the shape the pictures and the page code already use.
 *
 * Pattern for a picture: `const [ref, pending] = useReveal({ animate })`, then put `data-reveal="pending"` on the picture's
 * root while `pending` (the attribute is absent otherwise). The CSS gives the pending state its hidden values (lines
 * clipped, ticks unlit, bars flat) and the base rules carry the transitions, so removing the attribute IS the animation,
 * and the markup after it equals the static markup.
 */
import { useRef, type RefObject } from 'react';
import { motionAllowed, useCountUp as useSharedCountUp, useInView } from '@/app/motion';
import { useReducedMotion } from './hooks';

export interface RevealOptions {
  /** The component's `animate` prop (default true). False renders the final state at once. */
  animate?: boolean;
  /** Share of the element that must be in view first (default 0.2). */
  threshold?: number;
}

/** Whether animation will run for these options, now (follows Settings › Motion and the OS preference as they change). */
export function useMotionEnabled(animate = true): boolean {
  const reduced = useReducedMotion();
  return animate && !reduced && typeof IntersectionObserver !== 'undefined' && motionAllowed();
}

/**
 * `[ref, pending]`: `pending` is true from mount until the element is `threshold` in view for the first time, once per
 * mount. It is never true where motion cannot run. Attach `ref` to the element whose visibility starts the picture.
 */
export function useReveal<T extends Element = HTMLDivElement>({ animate = true, threshold = 0.2 }: RevealOptions = {}): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const inView = useInView(ref, { threshold });
  // `useMotionEnabled` follows the motion setting as it changes, so a picture still waiting for its first view when the person
  // asks for less is final at once
  const enabled = useMotionEnabled(animate);
  return [ref, enabled && !inView];
}

export interface CountUpOptions {
  /** Motion may run (`useMotionEnabled`) and the caller wants a count. Off: the target at once. */
  enabled: boolean;
  /** The picture has been seen (`!pending`). Until then the count waits at `from`. */
  active: boolean;
  /** Where the first count starts (default 0). */
  from?: number;
  /** First view, ms (default 1100: --lm-dur-count). */
  duration?: number;
  /** A later change of the target, ms (default 400): old value to new, never from zero. */
  updateDuration?: number;
}

/**
 * The displayed number of a count-up: 0 → target on first view (expo-out, 1,100 ms), then old → new on every change
 * (400 ms). Returns the target itself whenever `enabled` is false, so a static render shows the content. The shared
 * `useCountUp(value, { from, duration, updateDuration, start })` of src/app/motion.ts does the counting.
 */
export function useCountUp(target: number, { enabled, active, from, duration, updateDuration }: CountUpOptions): number {
  const shown = useSharedCountUp(enabled ? target : null, { from, duration, updateDuration, start: active });
  return shown ?? target;
}
