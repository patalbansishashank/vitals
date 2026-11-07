/**
 * Whether a picture may animate right now (r071 §4.2): a real browser, and neither the OS nor the person asked for less
 * (`<html data-motion>` from Settings › Appearance › Motion wins, then `prefers-reduced-motion`). jsdom and engines
 * without matchMedia / rAF never animate, so tests and old engines see every final state at once.
 *
 * It is `motionAllowed()` of src/app/motion.ts under the name the pictures and the page code already use.
 */
export { motionAllowed as canAnimate } from '@/app/motion';
