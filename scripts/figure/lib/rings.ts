// Offline copy of the tape-measure maths (the runtime version lives in src/features/body/figure3d/measure.ts and is
// tested against this one in tests/figure). Kept separate because Node runs this file directly.

import type { RingDef } from '../../../src/features/body/figure3d/manifest.ts';

/** Cut points of the ring's candidate edges with its plane, as 2D (u, v) pairs. */
export function cutRing(P: ArrayLike<number>, ring: RingDef): number[] {
  const { anchor, normal: n, u, v, edges } = ring;
  const ax = P[3 * anchor]!, ay = P[3 * anchor + 1]!, az = P[3 * anchor + 2]!;
  const out: number[] = [];
  for (let e = 0; e < edges.length; e += 2) {
    const a = edges[e]!, b = edges[e + 1]!;
    const da = (P[3 * a]! - ax) * n[0] + (P[3 * a + 1]! - ay) * n[1] + (P[3 * a + 2]! - az) * n[2];
    const db = (P[3 * b]! - ax) * n[0] + (P[3 * b + 1]! - ay) * n[1] + (P[3 * b + 2]! - az) * n[2];
    if ((da > 0 && db > 0) || (da < 0 && db < 0) || da === db) continue;
    const t = da / (da - db);
    const x = P[3 * a]! + t * (P[3 * b]! - P[3 * a]!) - ax;
    const y = P[3 * a + 1]! + t * (P[3 * b + 1]! - P[3 * a + 1]!) - ay;
    const z = P[3 * a + 2]! + t * (P[3 * b + 2]! - P[3 * a + 2]!) - az;
    out.push(x * u[0] + y * u[1] + z * u[2], x * v[0] + y * v[1] + z * v[2]);
  }
  return out;
}

/** Perimeter of the 2D convex hull of flat (x, y) pairs (monotone chain). */
export function hullPerimeter(xy: number[]): number {
  const n = xy.length / 2;
  if (n < 2) return 0;
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => xy[2 * a]! - xy[2 * b]! || xy[2 * a + 1]! - xy[2 * b + 1]!);
  const cross = (o: number, a: number, b: number) =>
    (xy[2 * a]! - xy[2 * o]!) * (xy[2 * b + 1]! - xy[2 * o + 1]!) - (xy[2 * a + 1]! - xy[2 * o + 1]!) * (xy[2 * b]! - xy[2 * o]!);
  const hull: number[] = [];
  for (const pass of [idx, [...idx].reverse()]) {
    const start = hull.length;
    for (const p of pass) {
      while (hull.length >= start + 2 && cross(hull[hull.length - 2]!, hull[hull.length - 1]!, p) <= 0) hull.pop();
      hull.push(p);
    }
    hull.pop();
  }
  let per = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]!, b = hull[(i + 1) % hull.length]!;
    per += Math.hypot(xy[2 * a]! - xy[2 * b]!, xy[2 * a + 1]! - xy[2 * b + 1]!);
  }
  return per;
}
