import { useEffect, useMemo, useState } from 'react';
import { lerpAvatarParams, type AvatarParams } from '@/engine/body';
import { useReducedMotion } from '@/components';
import { Figure3D, webgl2Available, type Figure3DProps } from './Figure3D';
import { isSlowDevice } from './device';

export interface FigureMorphProps extends Omit<Figure3DProps, 'params' | 'compareTo' | 'tween'> {
  from: AvatarParams;
  to: AvatarParams;
  durationMs?: number;
}

/** A single start-to-end illustration; wait for the 3D figure before beginning. */
export function FigureMorph({
  from,
  to,
  durationMs = 1200,
  onReady,
  onFallback,
  forceSvg,
  ...props
}: FigureMorphProps) {
  const reduced = useReducedMotion();
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState(0);
  const canStart = ready || forceSvg || !webgl2Available() || isSlowDevice();

  useEffect(() => {
    if (!canStart || reduced) return;
    let raf = 0;
    let started: number | null = null;
    let lastUpdate = -Infinity;
    const tick = (now: number) => {
      started ??= now;
      const t = Math.min(1, (now - started) / Math.max(1, durationMs));
      // A parent-driven shape needs a fit; 30 changes/s keeps the animation light.
      // The renderer independently maintains smooth rotation at display refresh.
      if (now - lastUpdate >= 32 || t === 1) {
        lastUpdate = now;
        setProgress(t * t * (3 - 2 * t));
      }
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [from, to, canStart, durationMs, reduced]);

  const params = useMemo(
    () => (reduced ? to : lerpAvatarParams(from, to, progress)),
    [from, to, progress, reduced],
  );
  return (
    <Figure3D
      {...props}
      params={params}
      compareTo={from}
      forceSvg={forceSvg}
      tween={false}
      onReady={() => {
        setReady(true);
        onReady?.();
      }}
      onFallback={(reason) => {
        setReady(true);
        onFallback?.(reason);
      }}
    />
  );
}
