// Motion helpers that read the design's motion tokens at runtime (tokens.css §motion), so reduced-motion token
// overrides (durations -> 0.01 ms) and theme changes apply without duplicating values in code.

/** Cubic-bezier easing (x1, y1, x2, y2) as a function of linear progress 0..1 (y may overshoot, e.g. needle ease). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sy = (u: number) => ((ay * u + by) * u + cy) * u;
  const dsx = (u: number) => (3 * ax * u + 2 * bx) * u + cx;
  return (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    // Newton, then bisection fallback
    let u = t;
    for (let i = 0; i < 6; i++) {
      const err = sx(u) - t;
      const d = dsx(u);
      if (Math.abs(err) < 1e-6) return sy(u);
      if (Math.abs(d) < 1e-6) break;
      u -= err / d;
    }
    let lo = 0;
    let hi = 1;
    u = t;
    for (let i = 0; i < 30; i++) {
      const x = sx(u);
      if (Math.abs(x - t) < 1e-6) break;
      if (x < t) lo = u;
      else hi = u;
      u = 0.5 * (lo + hi);
    }
    return sy(u);
  };
}

/** Parse "cubic-bezier(a, b, c, d)"; `linear` and unknown values fall back. */
export function parseEasing(value: string | null | undefined, fallback: [number, number, number, number]): (t: number) => number {
  const v = (value ?? '').trim();
  if (v === 'linear') return (t) => Math.min(1, Math.max(0, t));
  const m = /cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/.exec(v);
  const n = m ? [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] : fallback;
  return cubicBezier(n[0] ?? fallback[0], n[1] ?? fallback[1], n[2] ?? fallback[2], n[3] ?? fallback[3]);
}

/** Parse "420ms" / "0.9s" to milliseconds. */
export function parseDuration(value: string | null | undefined, fallbackMs: number): number {
  const v = (value ?? '').trim();
  const m = /^([\d.]+)\s*(ms|s)$/.exec(v);
  if (!m) return fallbackMs;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return fallbackMs;
  return m[2] === 's' ? n * 1000 : n;
}

function readToken(name: string, el?: Element | null): string | null {
  if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') return null;
  const target = el ?? document.documentElement;
  try {
    return getComputedStyle(target).getPropertyValue(name) || null;
  } catch {
    return null;
  }
}

/** Motion tokens with documented fallbacks (tokens.css: needle 420 ms, morph 900 ms). */
export function motionTokens(el?: Element | null) {
  return {
    needleMs: parseDuration(readToken('--lm-dur-needle', el), 420),
    needleEase: parseEasing(readToken('--lm-ease-needle', el), [0.34, 1.36, 0.64, 1]),
    morphMs: parseDuration(readToken('--lm-dur-morph', el), 900),
    morphEase: parseEasing(readToken('--lm-ease-in-out', el), [0.65, 0, 0.35, 1]),
  };
}
