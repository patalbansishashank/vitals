// Tape measure on the mesh (R2 sec. 5.4): each ring's plane cuts its candidate edges; the girth is the perimeter of the
// 2D convex hull of the cut points (a tape bridges concavities), the sagittal depth is the hull's front-back extent.
// Positions are read through `at(v)` -> slot so the same code runs on full meshes and on the fitter's vertex subset.

import type { FigureManifest, RingDef, RingId } from './manifest';

export interface RingMeasure {
  girth: number;
  /** Extent along the ring's v axis (front-back for torso rings). */
  depth: number;
  /** Extent along u (left-right). */
  width: number;
}

export interface MeshMeasures {
  /** Stature of the mesh as given (top vertex y - bottom vertex y), in mesh units. */
  height: number;
  rings: Record<RingId, RingMeasure>;
  /** Bideltoid breadth. */
  breadth: number;
}

const scratch: number[] = [];

/** Cut points of a ring (flat u,v pairs, relative to the anchor), written into `out`. */
export function cutRing(P: ArrayLike<number>, ring: RingDef, slot: (v: number) => number = (v) => v, out: number[] = []): number[] {
  out.length = 0;
  const { normal: n, u, v, edges } = ring;
  const A = 3 * slot(ring.anchor);
  const ax = P[A]!, ay = P[A + 1]!, az = P[A + 2]!;
  for (let e = 0; e < edges.length; e += 2) {
    const a = 3 * slot(edges[e]!), b = 3 * slot(edges[e + 1]!);
    const da = (P[a]! - ax) * n[0] + (P[a + 1]! - ay) * n[1] + (P[a + 2]! - az) * n[2];
    const db = (P[b]! - ax) * n[0] + (P[b + 1]! - ay) * n[1] + (P[b + 2]! - az) * n[2];
    if ((da > 0 && db > 0) || (da < 0 && db < 0) || da === db) continue;
    const t = da / (da - db);
    const x = P[a]! + t * (P[b]! - P[a]!) - ax;
    const y = P[a + 1]! + t * (P[b + 1]! - P[a + 1]!) - ay;
    const z = P[a + 2]! + t * (P[b + 2]! - P[a + 2]!) - az;
    out.push(x * u[0] + y * u[1] + z * u[2], x * v[0] + y * v[1] + z * v[2]);
  }
  return out;
}

const order: number[] = [];
const hull: number[] = [];

/** 2D convex hull (monotone chain) of flat pairs -> perimeter and extents. */
export function hullMeasure(xy: readonly number[]): RingMeasure {
  const n = xy.length / 2;
  if (n < 2) return { girth: 0, depth: 0, width: 0 };
  order.length = 0;
  for (let i = 0; i < n; i++) order.push(i);
  order.sort((a, b) => xy[2 * a]! - xy[2 * b]! || xy[2 * a + 1]! - xy[2 * b + 1]!);
  const cross = (o: number, a: number, b: number) =>
    (xy[2 * a]! - xy[2 * o]!) * (xy[2 * b + 1]! - xy[2 * o + 1]!) - (xy[2 * a + 1]! - xy[2 * o + 1]!) * (xy[2 * b]! - xy[2 * o]!);
  hull.length = 0;
  for (let pass = 0; pass < 2; pass++) {
    const start = hull.length;
    for (let k = 0; k < n; k++) {
      const p = order[pass === 0 ? k : n - 1 - k]!;
      while (hull.length >= start + 2 && cross(hull[hull.length - 2]!, hull[hull.length - 1]!, p) <= 0) hull.pop();
      hull.push(p);
    }
    hull.pop();
  }
  let girth = 0;
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]!, b = hull[(i + 1) % hull.length]!;
    girth += Math.hypot(xy[2 * a]! - xy[2 * b]!, xy[2 * a + 1]! - xy[2 * b + 1]!);
    uMin = Math.min(uMin, xy[2 * a]!);
    uMax = Math.max(uMax, xy[2 * a]!);
    vMin = Math.min(vMin, xy[2 * a + 1]!);
    vMax = Math.max(vMax, xy[2 * a + 1]!);
  }
  return { girth, depth: vMax - vMin, width: uMax - uMin };
}

/** All tape measures of a mesh (unscaled, mesh units = cm of the unscaled MakeHuman body). */
export function measureMesh(P: ArrayLike<number>, manifest: Pick<FigureManifest, 'rings' | 'breadth' | 'height'>, slot: (v: number) => number = (v) => v): MeshMeasures {
  const rings = {} as Record<RingId, RingMeasure>;
  for (const r of manifest.rings) rings[r.id] = hullMeasure(cutRing(P, r, slot, scratch));
  let xMin = Infinity, xMax = -Infinity;
  for (const v of manifest.breadth) {
    const x = P[3 * slot(v)]!;
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
  }
  const height = P[3 * slot(manifest.height.top) + 1]! - P[3 * slot(manifest.height.bottom) + 1]!;
  return { height, rings, breadth: xMax - xMin };
}

/** Every vertex the tape measure reads (for SubsetModel). */
export function measuredVertices(manifest: Pick<FigureManifest, 'rings' | 'breadth' | 'height'>): number[] {
  const s = new Set<number>([manifest.height.top, manifest.height.bottom, ...manifest.breadth]);
  for (const r of manifest.rings) {
    s.add(r.anchor);
    for (const v of r.edges) s.add(v);
  }
  return [...s];
}
