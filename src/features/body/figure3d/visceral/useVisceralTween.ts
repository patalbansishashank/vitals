// The slice follows its numbers smoothly: when the estimate changes, the drawn block eases from what is on screen to
// the new values (an exponential follow, so a stream of changes, a slider drag or the Simulator's playhead, never
// restarts from the old value). Reduced motion (the OS or Settings) snaps. Only the drawing eases; the words and the
// accessible name always say the target numbers.

import { useEffect, useRef, useState } from 'react';
import type { AvatarVisceral } from '@/engine/body';
import { useReducedMotion } from '@/components';

/** Time constant of the follow, ms: about 95 % of the way in 3 tau (~ --lm-dur-needle). */
const TAU_MS = 140;

const lerp = (a: number, b: number, t: number) =>
  Number.isFinite(a) && Number.isFinite(b) ? a + (b - a) * t : b;

/** Every numeric field of the block eased by t (0..1); the band and anything non-numeric come from `to`. */
export function lerpVisceral(from: AvatarVisceral, to: AvatarVisceral, t: number): AvatarVisceral {
  if (t >= 1) return to;
  return {
    ...to,
    vatKg: lerp(from.vatKg, to.vatKg, t),
    vatAreaCm2: lerp(from.vatAreaCm2, to.vatAreaCm2, t),
    satAreaCm2: lerp(from.satAreaCm2, to.satAreaCm2, t),
    leanAreaCm2: lerp(from.leanAreaCm2, to.leanAreaCm2, t),
    wallAreaCm2: lerp(from.wallAreaCm2, to.wallAreaCm2, t),
    organsAreaCm2: lerp(from.organsAreaCm2, to.organsAreaCm2, t),
    spineAreaCm2: lerp(from.spineAreaCm2, to.spineAreaCm2, t),
    waist: {
      halfWidthCm: lerp(from.waist.halfWidthCm, to.waist.halfWidthCm, t),
      halfDepthCm: lerp(from.waist.halfDepthCm, to.waist.halfDepthCm, t),
      phi: lerp(from.waist.phi, to.waist.phi, t),
    },
    areaRangeCm2: [
      lerp(from.areaRangeCm2[0], to.areaRangeCm2[0], t),
      lerp(from.areaRangeCm2[1], to.areaRangeCm2[1], t),
    ],
  };
}

/** Largest relative gap between two blocks' areas and waist (0 when equal). */
function gap(a: AvatarVisceral, b: AvatarVisceral): number {
  const pairs: [number, number][] = [
    [a.vatAreaCm2, b.vatAreaCm2],
    [a.satAreaCm2, b.satAreaCm2],
    [a.organsAreaCm2, b.organsAreaCm2],
    [a.waist.halfWidthCm, b.waist.halfWidthCm],
    [a.waist.halfDepthCm, b.waist.halfDepthCm],
    [a.areaRangeCm2[0], b.areaRangeCm2[0]],
    [a.areaRangeCm2[1], b.areaRangeCm2[1]],
  ];
  let g = 0;
  for (const [x, y] of pairs) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return x === y ? g : Infinity;
    g = Math.max(g, Math.abs(x - y) / Math.max(Math.abs(y), 1));
  }
  return g;
}

/** The visceral block to draw this frame: `target`, reached by an eased follow (snapped under reduced motion). */
export function useVisceralTween(target: AvatarVisceral): AvatarVisceral {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);
  const canAnimate = !reduced && typeof requestAnimationFrame === 'function';

  useEffect(() => {
    if (!canAnimate || gap(shownRef.current, target) < 1e-4) {
      shownRef.current = target;
      setShown(target);
      return;
    }
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(Math.max(now - last, 0), 64);
      last = now;
      const next = lerpVisceral(shownRef.current, target, 1 - Math.exp(-dt / TAU_MS));
      const done = gap(next, target) < 2e-3;
      shownRef.current = done ? target : next;
      setShown(shownRef.current);
      if (!done) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, canAnimate]);

  return canAnimate ? shown : target;
}
