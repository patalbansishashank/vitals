// Pure geometry of the visceral view (R2 sec. 3.3 / 3.4): the true-to-scale waist slice, drawn as an axial plate of the
// belly at about the navel (L3 to L4), the way a CT slice is read: front at the top, the body's right on the viewer's
// left.
//
// Coordinates: cm, SVG orientation (x right, y DOWN), centred on the waist ellipse. Every contour is a polar function
// r(theta) on one fixed angle grid around the centre, so nesting is a per-angle comparison and areas are exact for the
// drawn polygon. The engine's areas (sat + wall + spine + organs + vat = pi*a*b) set the layers:
//
//   outer      body outline: the waist ellipse, squarer at the back, a midline groove behind and a shallow notch in
//              front (both fade as fat under the skin thickens), rescaled to the waist area exactly
//   wallOuter  outer - tau1*dSat           thicker over the belly, the flanks and the lower back; area = outer - sat
//   vertebra   body (an oval, ~0.8 of the spine area) a back-muscle depth in front of the wall's back surface; the
//              posterior elements (canal, arch, processes) are drawn in the back muscles
//   psoas      two ovals beside the vertebral body (a share of the muscle area)
//   cavity     min(wallOuter - tau2*dWall, rays to the vertebra and the psoas): the abdominal cavity; area = organs + vat.
//              Muscle = wallOuter - cavity - bone: the rectus pair in front, the flat flank layers, quadratus lumborum
//              and the back muscles behind the spine (dWall profile)
//   loops      the cavity's Voronoi cells around fixed seeds (small bowel loops, the ascending and descending colon,
//              aorta and vena cava), rounded and shrunk about their centres by ONE factor so the organs fill exactly
//              organsAreaCm2: little deep fat = loops packed with thin fat seams; much deep fat = loops apart in fat
//   refs       cavity outlines at organs + 100 / 130 cm2 of deep fat (hypothetical, never past the muscle's outer
//              surface)
//   halo       the same at the two ends of areaRangeCm2 (edges of the likely-range band)
//
// Scalars tau1, tau2 and the loop factor are solved by bisection or in closed form (monotone), and the seeds are fixed
// in cavity-relative coordinates, so nothing flickers while the numbers ease. Shapes and profiles are own PROPOSED
// drawing conventions from axial CT anatomy, grade D: the areas are the data, the shapes are illustration.

import type { AvatarVisceral } from '@/engine/body';

export type Pt = [number, number];

/** Angle samples per contour. */
export const SAMPLES = 180;
const DTHETA = (2 * Math.PI) / SAMPLES;
const THETA: readonly number[] = Array.from({ length: SAMPLES }, (_, i) => i * DTHETA);
const SIN_D = Math.sin(DTHETA);
/** Grid index of straight back (theta = pi/2) and straight front (3pi/2). */
export const BACK = SAMPLES / 4;
export const FRONT = (SAMPLES * 3) / 4;

/** Polar radius of an axis-aligned ellipse (semi-axes a along x, b along y) at angle theta. */
export function ellipseRadius(a: number, b: number, theta: number): number {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const d = Math.sqrt((b * c) ** 2 + (a * s) ** 2);
  return d > 0 ? (a * b) / d : 0;
}

/** Area of a closed polygon (shoelace, absolute value). */
export function polygonArea(pts: readonly Pt[]): number {
  return Math.abs(signedArea(pts));
}

function signedArea(pts: readonly Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i]!;
    const [x1, y1] = pts[(i + 1) % pts.length]!;
    s += x0 * y1 - x1 * y0;
  }
  return s / 2;
}

/** Area of a polar polygon on the fixed angle grid (equals `polygonArea(polarPoints(r))`). */
export function polarArea(r: readonly number[]): number {
  let s = 0;
  for (let i = 0; i < r.length; i++) s += r[i]! * r[(i + 1) % r.length]!;
  return 0.5 * s * SIN_D;
}

export function polarPoints(r: readonly number[], cx = 0, cy = 0): Pt[] {
  return r.map((ri, i) => [cx + ri * Math.cos(THETA[i]!), cy + ri * Math.sin(THETA[i]!)] as Pt);
}

/** Radius of a polar contour at any angle (linear between grid samples). */
export function radiusAt(r: readonly number[], theta: number): number {
  const t = (((theta % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / DTHETA;
  const i = Math.floor(t) % SAMPLES;
  const w = t - Math.floor(t);
  return (r[i] ?? 0) * (1 - w) + (r[(i + 1) % SAMPLES] ?? 0) * w;
}

/**
 * Bisection for an INCREASING function f on [lo, hi]: the x with f(x) = target, clamped to the ends when the target
 * is out of reach. 60 halvings: exact to double precision for any sane bracket.
 */
export function bisect(
  f: (x: number) => number,
  target: number,
  lo: number,
  hi: number,
  iterations = 60,
): number {
  if (!(f(lo) < target)) return lo;
  if (!(f(hi) > target)) return hi;
  let a = lo;
  let b = hi;
  for (let i = 0; i < iterations; i++) {
    const m = (a + b) / 2;
    if (f(m) < target) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

const gauss = (t: number, at: number, w: number) => {
  // shortest angular distance, so a bump near 0 / 2pi wraps
  const d = Math.atan2(Math.sin(t - at), Math.cos(t - at));
  return Math.exp(-((d / w) ** 2));
};
const ant = (t: number) => Math.max(-Math.sin(t), 0); // front (top)

/** Fat under the skin, thickness profile: belly ~2x, flanks and the lower back ("love handles") more than the spine. */
const D_SAT: readonly number[] = THETA.map(
  (t) =>
    0.75 +
    0.85 * ant(t) ** 1.5 +
    0.4 * Math.cos(t) ** 2 +
    0.4 * (gauss(t, Math.PI / 2 - 1.05, 0.4) + gauss(t, Math.PI / 2 + 1.05, 0.4)),
);
/**
 * Muscle wall, thickness profile: the rectus pair in front, the flat flank layers, the
 * quadratus lumborum behind the flanks, and the back muscles either side of the spine.
 */
const D_WALL: readonly number[] = THETA.map(
  (t) =>
    0.7 +
    0.45 * gauss(t, -Math.PI / 2, 0.42) +
    0.4 * (gauss(t, Math.PI / 2 - 0.9, 0.3) + gauss(t, Math.PI / 2 + 0.9, 0.3)) +
    0.8 * gauss(t, Math.PI / 2, 0.36),
);

/** Floor of any inner contour as a fraction of the outer radius (keeps contours star-shaped and finite). */
const FLOOR = 0.04;

/** Contour inset from `from` by tau*profile, area-matched by bisection on tau. */
function inset(
  from: readonly number[],
  profile: readonly number[],
  targetArea: number,
  floorFrom: readonly number[],
  cap?: readonly number[],
): number[] {
  const at = (tau: number) =>
    from.map((r, i) => {
      const v = Math.max(r - tau * profile[i]!, FLOOR * floorFrom[i]!);
      return cap ? Math.min(v, cap[i]!) : v;
    });
  const maxR = Math.max(...from);
  const tau = bisect((x) => -polarArea(at(x)), -targetArea, 0, maxR / Math.min(...profile));
  return at(tau);
}

export interface Circle {
  cx: number;
  cy: number;
  r: number;
}

export interface Oval {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

/** Distance from the origin along angle theta to the first hit of an axis-aligned oval, or Infinity. */
function rayToOval(theta: number, o: Oval): number {
  // scale y so the oval is a circle of radius rx
  const k = o.rx / o.ry;
  const dx = Math.cos(theta);
  const dy = Math.sin(theta) * k;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const cy = o.cy * k;
  const along = o.cx * ux + cy * uy;
  const perp2 = o.cx * o.cx + cy * cy - along * along;
  const disc = o.rx * o.rx - perp2;
  if (disc < 0 || along <= 0) return Infinity;
  return Math.max(along - Math.sqrt(disc), 0) / len;
}

/** Distance from `o` along angle theta to the farthest crossing of a closed polygon (star-shaped from `o`). */
function rayToPolygon(o: Pt, theta: number, poly: readonly Pt[]): number {
  const dx = Math.cos(theta);
  const dy = Math.sin(theta);
  let best = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const ex = q[0] - p[0];
    const ey = q[1] - p[1];
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const wx = p[0] - o[0];
    const wy = p[1] - o[1];
    const u = (wx * ey - wy * ex) / den;
    const v = (wx * dy - wy * dx) / den;
    if (u > 0 && v >= 0 && v <= 1) best = Math.max(best, u);
  }
  return best;
}

/**
 * Distance from the origin along theta to the posterior wall beside the psoas (quadratus lumborum): the region
 * y >= y0 + slope*u + curve*u^2, u = |x| - x0 >= 0, a floor that curves back towards the flanks (where the wall's own
 * profile takes over). Infinity when missed.
 */
function rayToBackWall(theta: number, x0: number, y0: number, slope: number, curve: number): number {
  const dx = Math.cos(theta);
  const dy = Math.sin(theta);
  const ax = Math.abs(dx);
  if (ax < 1e-9) return Infinity;
  const t0 = x0 / ax; // where the ray reaches |x| = x0
  if (t0 * dy >= y0) return t0;
  // y0 + slope*u + curve*u^2 = (u + x0) * k on the ray, k = dy / |dx|
  const k = dy / ax;
  const B = k - slope;
  const C = x0 * k - y0; // < 0 here
  const disc = B * B + 4 * curve * C;
  if (!(curve > 0) || disc < 0 || B <= 0) return Infinity;
  const u = (B - Math.sqrt(disc)) / (2 * curve);
  return u >= 0 ? (u + x0) / ax : Infinity;
}

/** Soften a polar cap's steps (shadow edges): a running minimum, then a running mean, over a few samples. */
function softenCap(cap: readonly number[], w: number): number[] {
  const n = cap.length;
  const big = Math.max(...cap.filter(Number.isFinite), 1) * 4;
  const c = cap.map((x) => (Number.isFinite(x) ? x : big));
  const mn = c.map((_, i) => {
    let m = Infinity;
    for (let k = -w; k <= w; k++) m = Math.min(m, c[(i + k + n) % n]!);
    return m;
  });
  return mn.map((_, i) => {
    let s = 0;
    for (let k = -w; k <= w; k++) s += mn[(i + k + n) % n]!;
    return s / (2 * w + 1);
  });
}

/** Body outline: the waist ellipse, squarer at the back, with midline grooves that fade as `lean` goes to 0. */
function outline(a: number, b: number, lean: number): number[] {
  const n = 2.35 + 0.35 * lean; // squarer back on a lean body
  const r = THETA.map((t) => {
    const e = ellipseRadius(a, b, t);
    const c = Math.abs(Math.cos(t)) / a;
    const s = Math.abs(Math.sin(t)) / b;
    const se = (c ** n + s ** n) ** (-1 / n);
    const w = Math.max(Math.sin(t), 0) ** 0.7; // back half only
    const base = e * (1 - w) + se * w;
    return (
      base *
      (1 -
        0.03 * lean * gauss(t, -Math.PI / 2, 0.06) -
        (0.012 + 0.035 * lean) * gauss(t, Math.PI / 2, 0.11) +
        0.012 * lean * (gauss(t, Math.PI / 2 - 0.3, 0.16) + gauss(t, Math.PI / 2 + 0.3, 0.16)))
    );
  });
  const k = Math.sqrt((Math.PI * a * b) / polarArea(r));
  return r.map((x) => x * k);
}

/** Small-bowel seeds, polar in cavity-relative units (angle, share of the cavity radius on that angle). PROPOSED. */
const BOWEL_SEEDS: readonly [number, number][] = (() => {
  let seed = 0x2301;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // the colon seeds (fixed below) and the spine region are taken: keep the small bowel in the front and middle
  const placed: Pt[] = [
    [Math.cos(Math.PI - 0.32) * 0.72, Math.sin(Math.PI - 0.32) * 0.72],
    [Math.cos(0.36) * 0.74, Math.sin(0.36) * 0.74],
    [0, 0.62],
  ];
  const out: [number, number][] = [];
  for (let i = 0; i < 16; i++) {
    let best: Pt = [0, 0];
    let score = -Infinity;
    for (let k = 0; k < 80; k++) {
      const rho = Math.sqrt(rand()) * 0.86;
      const th = rand() * 2 * Math.PI;
      const p: Pt = [rho * Math.cos(th), rho * Math.sin(th)];
      if (p[1] > 0.45 && Math.abs(p[0]) < 0.45) continue; // in front of the spine: vessels and fat
      const d = Math.min(...placed.map((q) => Math.hypot(q[0] - p[0], q[1] - p[1])), 1.6 * (1 - rho) + 0.05);
      if (d > score) {
        score = d;
        best = p;
      }
    }
    placed.push(best);
    out.push([Math.atan2(best[1], best[0]), Math.hypot(best[0], best[1])]);
  }
  return out;
})();

export type LoopKind = 'bowel' | 'colon';

export interface Loop {
  kind: LoopKind;
  /** Rounded outline of the loop (cm). */
  pts: Pt[];
  /** The loop's centre (cm), for its lumen. */
  c: Pt;
}

/** Half-plane clip (Sutherland-Hodgman): keep points with (p - m) . n <= 0. */
function clipHalf(poly: readonly Pt[], m: Pt, n: Pt): Pt[] {
  const out: Pt[] = [];
  const side = (p: Pt) => (p[0] - m[0]) * n[0] + (p[1] - m[1]) * n[1];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const sp = side(p);
    const sq = side(q);
    if (sp <= 0) out.push(p);
    if ((sp < 0 && sq > 0) || (sp > 0 && sq < 0)) {
      const t = sp / (sp - sq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

/** Clip to a disc (a 24-gon) around c. */
function clipDisc(poly: Pt[], c: Pt, r: number): Pt[] {
  let out = poly;
  for (let k = 0; k < 24 && out.length >= 3; k++) {
    const t = (k / 24) * 2 * Math.PI;
    const n: Pt = [Math.cos(t), Math.sin(t)];
    out = clipHalf(out, [c[0] + r * n[0], c[1] + r * n[1]], n);
  }
  return out;
}

/** Clip to a star-shaped region (seen from `c`) by its supporting half-planes at every 6th edge: close enough. */
function clipConvexish(poly: Pt[], region: readonly Pt[], c: Pt): Pt[] {
  let out = poly;
  for (let i = 0; i < region.length && out.length >= 3; i += 6) {
    const p = region[i]!;
    const q = region[(i + 6) % region.length]!;
    // outward normal of the edge p -> q (the region is counter-clockwise or clockwise: pick the side away from c)
    let n: Pt = [q[1] - p[1], -(q[0] - p[0])];
    if ((c[0] - p[0]) * n[0] + (c[1] - p[1]) * n[1] > 0) n = [-n[0], -n[1]];
    out = clipHalf(out, p, n);
  }
  return out;
}

const LOOP_RAYS = 40;
const LOOP_HARMONICS = 8;

/**
 * A rounded loop from a convex-ish cell: the cell's radius around its centre, sampled on 40 rays, low-passed (a smooth,
 * slightly irregular round shape: a loop of bowel, never a wedge). `cutoff` is the soft harmonic limit: ~2.5 gives
 * round loops, ~6 loops that press into each other's shape, as packed bowel does.
 */
function roundCell(cell: readonly Pt[], c: Pt, cutoff: number): Pt[] {
  const r: number[] = [];
  for (let k = 0; k < LOOP_RAYS; k++) {
    const t = (k / LOOP_RAYS) * 2 * Math.PI;
    const dx = Math.cos(t);
    const dy = Math.sin(t);
    let best = 0;
    for (let i = 0; i < cell.length; i++) {
      const p = cell[i]!;
      const q = cell[(i + 1) % cell.length]!;
      const ex = q[0] - p[0];
      const ey = q[1] - p[1];
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const wx = p[0] - c[0];
      const wy = p[1] - c[1];
      const u = (wx * ey - wy * ex) / den; // along the ray
      const v = (wx * dy - wy * dx) / den; // along the edge
      if (u > 0 && v >= 0 && v <= 1) best = Math.max(best, u);
    }
    r.push(best);
  }
  const out: Pt[] = [];
  const coef: [number, number][] = [];
  for (let h = 0; h <= LOOP_HARMONICS; h++) {
    let re = 0;
    let im = 0;
    r.forEach((v, k) => {
      const t = (k / LOOP_RAYS) * 2 * Math.PI * h;
      re += v * Math.cos(t);
      im += v * Math.sin(t);
    });
    coef.push([re / LOOP_RAYS, im / LOOP_RAYS]);
  }
  for (let k = 0; k < LOOP_RAYS; k++) {
    const t = (k / LOOP_RAYS) * 2 * Math.PI;
    let v = coef[0]![0];
    for (let h = 1; h <= LOOP_HARMONICS; h++) {
      const keep = Math.exp(-((h / cutoff) ** 2)); // a soft low-pass: round when loose, closer to the cell when packed
      v += 2 * keep * (coef[h]![0] * Math.cos(h * t) + coef[h]![1] * Math.sin(h * t));
    }
    v = Math.max(v, 0.05 * coef[0]![0]);
    out.push([c[0] + v * Math.cos(t), c[1] + v * Math.sin(t)]);
  }
  return out;
}

function centroid(pts: readonly Pt[]): Pt {
  const A = signedArea(pts);
  if (Math.abs(A) < 1e-12) {
    const n = Math.max(pts.length, 1);
    return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i]!;
    const [x1, y1] = pts[(i + 1) % pts.length]!;
    const f = x0 * y1 - x1 * y0;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  return [cx / (6 * A), cy / (6 * A)];
}

export interface Vessels {
  /** Aorta: round, on the viewer's right of the midline (the body's left). */
  aorta: Circle;
  /** Inferior vena cava: an oval on the viewer's left. */
  ivc: Oval;
}

export interface SliceAreas {
  outer: number;
  wallOuter: number;
  /** Abdominal cavity (organs + deep fat). */
  cavity: number;
  /** Drawn organs: the loops plus the two vessels. */
  organs: number;
  /** Deep fat = cavity - organs. */
  vat: number;
  /** Muscle = wallOuter - cavity - bone (the vertebral body). */
  muscle: number;
}

export interface SliceGeometry {
  a: number;
  b: number;
  /**
   * Radii per angle (same grid), for nesting checks and the drawing's fascia lines. `outer` and `wallOuter` are about
   * the slice centre; `wallOuterO`, `wallInner` and `cavity` about the cavity's centre `origin`.
   */
  radii: {
    outer: number[];
    wallOuter: number[];
    wallOuterO: number[];
    /** The muscle's inner surface before the spine and psoas cap it. */
    wallInner: number[];
    cavity: number[];
  };
  /** Centre of the cavity's polar contours (in front of the spine). */
  origin: Pt;
  outer: Pt[];
  wallOuter: Pt[];
  cavity: Pt[];
  /** Vertebral body (an oval); `r` is its half-width (the posterior elements scale with it). */
  spine: Oval & { r: number };
  psoas: [Oval, Oval];
  vessels: Vessels | null;
  loops: Loop[];
  /** The one shrink factor of the loops (1 = packed, the organs fill their cells). */
  loopScale: number;
  /** Hypothetical cavity outlines at the band thresholds (100, 130 cm2 of deep fat). */
  refs: [Pt[], Pt[]];
  /** Cavity outlines at the low and high end of `areaRangeCm2`. */
  halo: [Pt[], Pt[]];
  areas: SliceAreas;
}

const finite = (v: number, fb: number) => (Number.isFinite(v) ? v : fb);

/** Waist-slice geometry from the engine's visceral block. Pure; about a millisecond. */
export function sliceGeometry(v: AvatarVisceral): SliceGeometry {
  const a = Math.max(finite(v.waist.halfWidthCm, 15), 1);
  const b = Math.max(finite(v.waist.halfDepthCm, 11), 1);
  const pos = (x: number) => Math.max(finite(x, 0), 0);
  const ellipseArea = Math.PI * a * b;
  // engine areas are for pi*a*b; the polygon is within 0.1 %: rescale so the drawn proportions are exact
  const satRaw = pos(v.satAreaCm2);
  const perimeter = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
  const lean = Math.min(Math.max((3 - satRaw / Math.max(perimeter, 1)) / 2.4, 0), 1);
  const R = outline(a, b, lean);
  const aOuter = polarArea(R);
  const k = aOuter / ellipseArea;
  const sat = Math.min(satRaw * k, aOuter * 0.98);
  const vatA = pos(v.vatAreaCm2) * k;
  const organsA = pos(v.organsAreaCm2) * k;
  const spineA = pos(v.spineAreaCm2) * k;
  const wallA = pos(v.wallAreaCm2) * k;

  const wallOuterR = inset(R, D_SAT, aOuter - sat, R);
  const aWallOuter = polarArea(wallOuterR);

  // vertebral body: an oval of ~0.8 of the spine area (the posterior elements are the rest), a back-muscle depth in
  // front of the wall's back surface, never past the middle of the slice
  const bodyA = Math.max(0.8 * spineA, 1);
  const rx = Math.sqrt(bodyA / (Math.PI * 0.82));
  const ry = 0.82 * rx;
  const backR = wallOuterR[BACK]!;
  // back-muscle depth behind the body: the back muscles' share of the muscle area spread over their width, so a body
  // with little muscle has a shallower back block (and its cavity the room the numbers ask for)
  const behind = Math.min(Math.max((0.3 * wallA) / (5.8 * rx) + rx, 1.6 * rx), 3.1 * rx, 0.55 * backR);
  const spine = { cx: 0, cy: Math.max(backR - ry - behind, 0.05 * b), rx, ry, r: rx };
  // psoas: two ovals beside the vertebral body, ~15 % of the muscle area
  const psA = Math.max(0.075 * wallA, 0.5);
  const prx = Math.sqrt(psA / (Math.PI * 1.1));
  const pry = 1.1 * prx;
  const psoas: [Oval, Oval] = [
    { cx: -(rx + 0.8 * prx), cy: spine.cy - 0.1 * ry, rx: prx, ry: pry },
    { cx: rx + 0.8 * prx, cy: spine.cy - 0.1 * ry, rx: prx, ry: pry },
  ];
  // the cavity is measured from its own centre O, in front of the spine, so the bones and the psoas shadow only what
  // lies behind them (from the slice centre, just in front of the spine, they would shadow the whole back half)
  const wallOuterPts = polarPoints(wallOuterR);
  const oy = (-wallOuterR[FRONT]! + (spine.cy - ry)) / 2;
  const O: Pt = [0, oy];
  const shift = (o: Oval): Oval => ({ ...o, cx: o.cx - O[0], cy: o.cy - O[1] });
  // behind the psoas, out to the flanks, the quadratus lumborum: a flat back wall a little behind the psoas' middle
  const capO = softenCap(
    THETA.map((t) =>
      Math.min(
        rayToOval(t, shift(spine)),
        rayToOval(t, shift(psoas[0])),
        rayToOval(t, shift(psoas[1])),
        rayToBackWall(t, psoas[1].cx + 0.55 * prx, psoas[1].cy - 0.25 * pry - O[1], 0.35, 0.16 / rx),
      ),
    ),
    2,
  );
  const wallOuterO = THETA.map((t) => rayToPolygon(O, t, wallOuterPts));

  // the cavity holds organs + deep fat; the muscle is what is left inside the wall's outer surface
  const cavityR = inset(wallOuterO, D_WALL, Math.min(organsA + vatA, aWallOuter * 0.97), wallOuterO, capO);
  // the uncapped inner surface, for the flank layers: tau from the side (theta = 0), which the spine never caps
  const tau = (wallOuterO[0]! - cavityR[0]!) / D_WALL[0]!;
  const wallInnerFree = wallOuterO.map((r, i) => Math.max(r - tau * D_WALL[i]!, FLOOR * r));
  const aCavity = polarArea(cavityR);
  const cavity = polarPoints(cavityR, O[0], O[1]);
  const polarAt = (theta: number, rho: number): Pt => {
    const d = rho * radiusAt(cavityR, theta);
    return [O[0] + d * Math.cos(theta), O[1] + d * Math.sin(theta)];
  };

  // vessels just in front of the vertebral body (inside the cavity), sized from the body's width
  const ra = 0.5 * rx;
  const aorta: Circle = { cx: 0.42 * rx, cy: spine.cy - ry - 1.08 * ra, r: ra };
  const ivc: Oval = { cx: -0.78 * rx, cy: spine.cy - ry - 0.82 * ra, rx: 1.12 * ra, ry: 0.72 * ra };
  const inside = (x: number, y: number, m: number) =>
    Math.hypot(x - O[0], y - O[1]) + m < radiusAt(cavityR, Math.atan2(y - O[1], x - O[0]));
  const vessels: Vessels | null =
    inside(aorta.cx, aorta.cy - aorta.r, 0) && inside(ivc.cx, ivc.cy - ivc.ry, 0) ? { aorta, ivc } : null;
  const vesselsA = vessels ? Math.PI * ra * ra + Math.PI * ivc.rx * ivc.ry : 0;

  // loops: Voronoi cells of the seeds inside the cavity, rounded, shrunk about their centres by one factor
  // Bowel keeps its own size: the small bowel packs into a zone in the middle of the cavity, sized from the organ area
  // (about 80 % packed), and the deep fat fills the rest. Little deep fat: the zone is the whole cavity and the loops
  // touch with thin seams of fat. Much deep fat: a cluster of loops in a sea of fat. The colon stays at the flanks.
  const loopTarget = Math.max(organsA - vesselsA, 0);
  const cavityC = centroid(cavity);
  // power-diagram weights: the colon's cells are wider than the small bowel's
  const wColon = 0.012 * aCavity;
  const weight = (kind: LoopKind | 'vessel') => (kind === 'colon' ? wColon : 0);
  const PACK = 0.9; // the loops' share of their cells: thin seams of fat between them
  // how full of organs the cavity is: packed loops take their cells' shape and their cells may be wide
  const fill = Math.min(Math.max((loopTarget / Math.max(aCavity, 1e-6) - 0.5) / 0.4, 0), 1);
  const cutoff = 2.6 + 3.6 * fill;
  const discK = 1 + 1.6 * fill;
  const build = (zoneScale: number) => {
    const Z = cavityC;
    const toZone = ([x, y]: Pt): Pt => [Z[0] + (x - Z[0]) * zoneScale, Z[1] + (y - Z[1]) * zoneScale];
    const zone = cavity.map(toZone);
    const cellR = Math.sqrt((aCavity * zoneScale * zoneScale) / ((BOWEL_SEEDS.length + 3) * Math.PI));
    const seeds: { p: Pt; kind: LoopKind | 'vessel' }[] = [
      { p: polarAt(Math.PI - 0.32, 0.72), kind: 'colon' },
      { p: polarAt(0.36, 0.74), kind: 'colon' },
      ...BOWEL_SEEDS.map(([t, rho]) => ({ p: toZone(polarAt(t, rho)), kind: 'bowel' as const })),
      ...(vessels
        ? [
            { p: [aorta.cx, aorta.cy] as Pt, kind: 'vessel' as const },
            { p: [ivc.cx, ivc.cy] as Pt, kind: 'vessel' as const },
          ]
        : []),
    ];
    const cells: { kind: LoopKind; pts: Pt[]; c: Pt }[] = [];
    seeds.forEach((s, i) => {
      if (s.kind === 'vessel') return;
      let cell: Pt[] = cavity;
      seeds.forEach((o, j) => {
        if (j === i || cell.length < 3) return;
        const n: Pt = [o.p[0] - s.p[0], o.p[1] - s.p[1]];
        const n2 = n[0] * n[0] + n[1] * n[1];
        if (!(n2 > 1e-12)) return;
        const shift = (weight(s.kind) - weight(o.kind)) / (2 * n2);
        const m: Pt = [(s.p[0] + o.p[0]) / 2 + shift * n[0], (s.p[1] + o.p[1]) / 2 + shift * n[1]];
        cell = clipHalf(cell, m, n);
      });
      // a loop is never wider than a loop: small bowel inside its zone and a disc, the colon inside a wider disc
      if (s.kind === 'bowel' && zoneScale < 1) cell = clipConvexish(cell, zone, Z);
      cell = clipDisc(cell, s.p, (s.kind === 'colon' ? 1.3 : 1.4) * discK * cellR);
      if (cell.length < 3 || polygonArea(cell) <= 1e-6) return;
      const c = centroid(cell);
      cells.push({ kind: s.kind, pts: roundCell(cell, c, cutoff), c });
    });
    // slivers (a seed squeezed against the spine or the wall) are dropped: the rest grow to keep the organ area
    const sizes = cells.map((c) => polygonArea(c.pts)).sort((x, y) => x - y);
    const median = sizes[Math.floor(sizes.length / 2)] ?? 0;
    for (let i = cells.length - 1; i >= 0; i--) if (polygonArea(cells[i]!.pts) < 0.22 * median) cells.splice(i, 1);
    return { cells, area: cells.reduce((sum, c) => sum + polygonArea(c.pts), 0) };
  };
  // the bowel zone: start from the organ area, then let it grow (a few fixed steps, so it eases smoothly) until the
  // loops, at their packing, hold the organ area; it never grows past the cavity
  let zoneScale = Math.min(1, Math.sqrt(loopTarget / (PACK * PACK) / Math.max(aCavity, 1e-6)));
  let built = build(zoneScale);
  for (let it = 0; it < 4 && zoneScale < 1; it++) {
    const need = loopTarget / (PACK * PACK);
    zoneScale = Math.min(1, zoneScale * Math.sqrt(need / Math.max(built.area, 1e-6)));
    built = build(zoneScale);
  }
  const { cells, area: cellsA } = built;
  const loopScale = cellsA > 0 ? Math.min(Math.sqrt(loopTarget / cellsA), 0.985) : 0;
  const loops: Loop[] = cells.map((c) => ({
    kind: c.kind,
    c: c.c,
    pts: c.pts.map(([x, y]) => [c.c[0] + (x - c.c[0]) * loopScale, c.c[1] + (y - c.c[1]) * loopScale] as Pt),
  }));
  const organsDrawn = cellsA * loopScale * loopScale + vesselsA;

  // hypothetical cavity outlines: never past the muscle's outer surface
  // the cavity's own outline, scaled about its centre: the same shape, larger or smaller
  const reachCap = wallOuterO.map((r, i) => Math.min(0.985 * r, capO[i]!));
  const reach = (area: number) => {
    const at = (l: number) => cavityR.map((r, i) => Math.min(l * r, reachCap[i]!));
    const l = bisect((x) => polarArea(at(x)), organsA + area * k, 0, 4);
    return polarPoints(at(l), O[0], O[1]);
  };
  const [r100, r130] = v.thresholdsCm2;
  const lo = pos(v.areaRangeCm2[0]);
  const hi = Math.max(pos(v.areaRangeCm2[1]), lo);

  return {
    a,
    b,
    radii: { outer: R, wallOuter: wallOuterR, wallOuterO, wallInner: wallInnerFree, cavity: cavityR },
    origin: O,
    outer: polarPoints(R),
    wallOuter: wallOuterPts,
    cavity,
    spine,
    psoas,
    vessels,
    loops,
    loopScale,
    refs: [reach(r100), reach(r130)],
    halo: [reach(lo), reach(hi)],
    areas: {
      outer: aOuter,
      wallOuter: aWallOuter,
      cavity: aCavity,
      organs: organsDrawn,
      vat: aCavity - organsDrawn,
      muscle: aWallOuter - aCavity - Math.PI * rx * ry,
    },
  };
}

/** "M x y L ... Z" for a closed polygon (2 decimals). */
export function polyD(pts: readonly Pt[]): string {
  if (!pts.length) return '';
  const f = (n: number) => (Math.round(finite(n, 0) * 100) / 100).toString();
  return `M${pts.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}Z`;
}

/** Closed uniform Catmull-Rom (tension 0.5) through the points, as cubic Beziers. */
export function smoothD(pts: readonly Pt[]): string {
  const n = pts.length;
  if (n < 3) return polyD(pts);
  const f = (v: number) => (Math.round(finite(v, 0) * 100) / 100).toString();
  const p = (i: number) => pts[((i % n) + n) % n]!;
  let d = `M${f(p(0)[0])} ${f(p(0)[1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = p(i - 1);
    const p1 = p(i);
    const p2 = p(i + 1);
    const p3 = p(i + 2);
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return `${d}Z`;
}

/** Open polyline "M x y L ..." (2 decimals). */
export function lineD(pts: readonly Pt[]): string {
  if (!pts.length) return '';
  const f = (n: number) => (Math.round(finite(n, 0) * 100) / 100).toString();
  return `M${pts.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}`;
}
