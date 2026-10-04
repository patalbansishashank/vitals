// Pure geometry of the visceral view (R2 sec. 3.3 / 3.4): the true-to-scale waist slice and the side cutaway pictogram.
//
// Coordinates: cm, SVG orientation (x right, y DOWN). The slice is centred on the waist ellipse; the FRONT of the body
// is at the top (negative y). Every contour is a polar function r(theta) sampled on one fixed angle grid around the
// ellipse centre, so nesting is a per-angle comparison and areas are exact for the drawn polygon:
//
//   outer       R(theta)        = waist ellipse (engine a, b)                 area pi*a*b (polygon: within 0.1 %)
//   wallOuter   R - tau1*dSat   (SAT ring: thicker in front)                  area = outer - satAreaCm2
//   wallInner   wallOuter - tau2*dWall (thin in front, psoas + erectors back) area = vat + organs + spine
//   spine       circle on the back of the cavity (half in the wall)
//   organs      min(s*wallInner, cap)                                          area = organsAreaCm2
//   vat         min(organs + t*lobe, cap)       (lobulated, fixed harmonics)   area = organs + vatAreaCm2
//   ref 100/130 min(organs + t*lobe, 0.99 wallOuter) (hypothetical reach of 100 / 130 cm2 of deep fat)
//   halo        same at areaRangeCm2
//
// Scalars tau1, tau2, s, t are solved by bisection (monotone), so a contour never flickers while params morph.
// Drawing convention constants (thickness profiles, lobes) are own PROPOSED choices, grade D.

import type { AvatarLevel, AvatarParams, AvatarVisceral } from '@/engine/body';

export type Pt = [number, number];

/** Angle samples per contour. */
export const SAMPLES = 180;
const DTHETA = (2 * Math.PI) / SAMPLES;
const THETA: readonly number[] = Array.from({ length: SAMPLES }, (_, i) => i * DTHETA);
const SIN_D = Math.sin(DTHETA);

/** Polar radius of an axis-aligned ellipse (semi-axes a along x, b along y) at angle theta. */
export function ellipseRadius(a: number, b: number, theta: number): number {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const d = Math.sqrt((b * c) ** 2 + (a * s) ** 2);
  return d > 0 ? (a * b) / d : 0;
}

/** Area of a closed polygon (shoelace, absolute value). */
export function polygonArea(pts: readonly Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i]!;
    const [x1, y1] = pts[(i + 1) % pts.length]!;
    s += x0 * y1 - x1 * y0;
  }
  return Math.abs(s) / 2;
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

/** Fixed lobulation of the deep-fat contour (low harmonics; positive, mean 1). PROPOSED drawing convention. */
export function lobe(theta: number): number {
  return (
    1 + 0.2 * Math.cos(5 * theta + 0.4) + 0.1 * Math.cos(8 * theta + 1.3) + 0.06 * Math.cos(3 * theta + 2.1)
  );
}
const LOBE: readonly number[] = THETA.map(lobe);

const ant = (t: number) => Math.max(-Math.sin(t), 0); // front (top)
const post = (t: number) => Math.max(Math.sin(t), 0); // back (bottom)
/** SAT thickness profile: front ~2.2x, sides 1x, back 0.8x (R2: anterior 0.55 / lateral 0.25 / posterior 0.20 of SAT). */
const D_SAT: readonly number[] = THETA.map((t) => 1 + 1.2 * ant(t) ** 2 - 0.2 * post(t) ** 2);
/** Muscle wall thickness profile: thin rectus in front, obliques at the sides, erectors behind, psoas beside the spine. */
const PSOAS_ANGLE = 0.62; // rad either side of straight back (PROPOSED)
const D_WALL: readonly number[] = THETA.map((t) => {
  const back = Math.PI / 2;
  const psoas =
    Math.exp(-(((t - (back - PSOAS_ANGLE)) / 0.22) ** 2)) +
    Math.exp(-(((t - (back + PSOAS_ANGLE)) / 0.22) ** 2));
  return 0.55 + 0.45 * Math.abs(Math.cos(t)) + 1.6 * post(t) ** 6 + 1.5 * psoas;
});

/** Floor of any inner contour as a fraction of the outer radius (keeps contours star-shaped and finite). */
const FLOOR = 0.04;

/** Contour inset from `from` by tau*profile, area-matched by bisection on tau. */
function inset(
  from: readonly number[],
  profile: readonly number[],
  targetArea: number,
  floorFrom: readonly number[],
): number[] {
  const at = (tau: number) => from.map((r, i) => Math.max(r - tau * profile[i]!, FLOOR * floorFrom[i]!));
  const maxR = Math.max(...from);
  const tau = bisect((x) => -polarArea(at(x)), -targetArea, 0, maxR / Math.min(...profile));
  return at(tau);
}

export interface Circle {
  cx: number;
  cy: number;
  r: number;
}

/** Distance from the origin along angle theta to the first hit of a circle, or Infinity. */
function rayToCircle(theta: number, c: Circle): number {
  const dx = Math.cos(theta);
  const dy = Math.sin(theta);
  const along = c.cx * dx + c.cy * dy;
  const perp2 = c.cx * c.cx + c.cy * c.cy - along * along;
  const disc = c.r * c.r - perp2;
  if (disc < 0 || along <= 0) return Infinity;
  return Math.max(along - Math.sqrt(disc), 0);
}

/** Deep-fat-style contour: min(base + t*lobe, cap), area-matched by bisection on t >= 0 (saturates at the cap). */
export function growContour(base: readonly number[], cap: readonly number[], targetArea: number): number[] {
  const at = (t: number) => base.map((r, i) => Math.min(r + t * LOBE[i]!, cap[i]!));
  const maxCap = Math.max(...cap);
  const t = bisect((x) => polarArea(at(x)), targetArea, 0, Math.max(maxCap, 1) * 2);
  return at(t);
}

/** Scaled contour: min(s*base, cap), area-matched by bisection on s in [0, 1]. */
export function scaleContour(base: readonly number[], cap: readonly number[], targetArea: number): number[] {
  const at = (s: number) => base.map((r, i) => Math.min(s * r, cap[i]!));
  const s = bisect((x) => polarArea(at(x)), targetArea, 0, 1);
  return at(s);
}

export interface SliceAreas {
  outer: number;
  wallOuter: number;
  wallInner: number;
  organs: number;
  /** Deep-fat fill = vat contour area - organs area. */
  vat: number;
}

export interface SliceGeometry {
  a: number;
  b: number;
  /** Radii per angle (same grid) - for nesting checks. */
  radii: {
    outer: number[];
    wallOuter: number[];
    wallInner: number[];
    organs: number[];
    vat: number[];
    cap: number[];
  };
  outer: Pt[];
  wallOuter: Pt[];
  wallInner: Pt[];
  organs: Pt[];
  vat: Pt[];
  spine: Circle;
  /** Hypothetical deep-fat contours at the band thresholds (100, 130 cm2). */
  refs: [Pt[], Pt[]];
  /** Deep-fat contours at the low and high end of `areaRangeCm2`. */
  halo: [Pt[], Pt[]];
  areas: SliceAreas;
}

const finite = (v: number, fb: number) => (Number.isFinite(v) ? v : fb);

/** Waist-slice geometry from the engine's visceral block. Pure; ~0.2 ms. */
export function sliceGeometry(v: AvatarVisceral): SliceGeometry {
  const a = Math.max(finite(v.waist.halfWidthCm, 15), 1);
  const b = Math.max(finite(v.waist.halfDepthCm, 11), 1);
  const pos = (x: number) => Math.max(finite(x, 0), 0);
  const R = THETA.map((t) => ellipseRadius(a, b, t));
  const aOuter = polarArea(R);
  // engine areas are for pi*a*b; rescale to the polygon so the drawn proportions are exact
  const k = aOuter / (Math.PI * a * b);
  const sat = Math.min(pos(v.satAreaCm2) * k, aOuter * 0.98);
  const vatA = pos(v.vatAreaCm2) * k;
  const organsA = pos(v.organsAreaCm2) * k;
  const spineA = pos(v.spineAreaCm2) * k;

  const wallOuterR = inset(R, D_SAT, aOuter - sat, R);
  const aWallOuter = polarArea(wallOuterR);
  const innerTarget = Math.min(vatA + organsA + spineA, aWallOuter * 0.98);
  const wallInnerR = inset(wallOuterR, D_WALL, innerTarget, R);

  // spine: circle bulging into the back of the cavity, its centre a third of a radius inside the wall, so the cavity
  // always has room for organs + deep fat (the cavity target already excludes the full spine area)
  const back = SAMPLES / 4; // theta = pi/2 (straight back)
  const rs = Math.sqrt(spineA / Math.PI);
  const spine: Circle = { cx: 0, cy: wallInnerR[back]! + rs / 3, r: rs };
  const cap = wallInnerR.map((r, i) => Math.min(r, rayToCircle(THETA[i]!, spine)));

  const organsR = scaleContour(wallInnerR, cap, organsA);
  const aOrgans = polarArea(organsR);
  const vatR = growContour(organsR, cap, aOrgans + vatA);
  // hypothetical reaches stay inside the muscle wall's outer surface (never drawn into the pinchable layer)
  const reachCap = wallOuterR.map((r) => 0.99 * r);
  const reach = (area: number) => polarPoints(growContour(organsR, reachCap, aOrgans + area * k));
  const [r100, r130] = v.thresholdsCm2;
  const [lo, hi] = v.areaRangeCm2;

  return {
    a,
    b,
    radii: { outer: R, wallOuter: wallOuterR, wallInner: wallInnerR, organs: organsR, vat: vatR, cap },
    outer: polarPoints(R),
    wallOuter: polarPoints(wallOuterR),
    wallInner: polarPoints(wallInnerR),
    organs: polarPoints(organsR),
    vat: polarPoints(vatR),
    spine,
    refs: [reach(r100), reach(r130)],
    halo: [reach(pos(lo)), reach(pos(hi))],
    areas: {
      outer: aOuter,
      wallOuter: aWallOuter,
      wallInner: polarArea(wallInnerR),
      organs: aOrgans,
      vat: polarArea(vatR) - aOrgans,
    },
  };
}

/** "M x y L ... Z" for a closed polygon (2 decimals). */
export function polyD(pts: readonly Pt[]): string {
  if (!pts.length) return '';
  const f = (n: number) => (Math.round(finite(n, 0) * 100) / 100).toString();
  return `M${pts.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}Z`;
}

/** Closed centripetal-ish Catmull-Rom (uniform, tension 0.5) through the points, as cubic Beziers. */
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

// ------------------------------------------------------------------------------------------------ side cutaway

export interface CutawayGeometry {
  /** Side silhouette (front to the RIGHT, +x), chest to crotch, closed. y = -height (cm, up is negative). */
  skin: Pt[];
  /** Inside the SAT band (muscle wall outer surface). */
  wall: Pt[];
  /** Abdominal cavity (rib cage to pelvis) inside the wall. */
  cavity: Pt[];
  /** Bowel loops (circles), to be clipped by the cavity; total area = (1 - vatFraction) of the cavity box. */
  loops: Circle[];
  /** Deep fat share of the cavity: A_vat / (A_vat + A_organs). */
  vatFraction: number;
  /** Slice line at the waist: y and the x extent of the silhouette there. */
  slice: { y: number; x0: number; x1: number };
  extent: { minX: number; maxX: number; minY: number; maxY: number };
}

function levelOf(params: AvatarParams, id: AvatarLevel['id']): AvatarLevel | undefined {
  return params.levels.find((l) => l.id === id);
}

/** Bowel-loop grid (unit square, hex-ish), fixed so the pictogram never jitters. */
const LOOP_GRID: readonly Pt[] = (() => {
  const out: Pt[] = [];
  const rows = 6;
  const cols = 4;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols + (r % 2 ? 0 : 1); c++)
      out.push([(c + (r % 2 ? 0.5 : 0)) / cols, (r + 0.5) / rows]);
  return out;
})();
const LOOP_CELL = 1 / LOOP_GRID.length; // unit-square area per loop

/**
 * Side cutaway pictogram from the params' side levels (chest, waist, hip, crotch): skin -> SAT band (front / back
 * thickness from the waist slice) -> muscle wall -> cavity with bowel loops; deep fat fills the cavity behind the loops.
 */
export function cutawayGeometry(
  params: AvatarParams,
  slice: SliceGeometry = sliceGeometry(params.visceral),
): CutawayGeometry {
  const H = finite(params.heightCm, 170);
  const get = (id: AvatarLevel['id'], frac: number, F: number, B: number) => {
    const l = levelOf(params, id);
    return {
      y: -finite(l?.yCm ?? frac * H, frac * H),
      F: Math.max(finite(l?.sideFrontCm ?? F, F), 2),
      B: Math.max(finite(l?.sideBackCm ?? B, B), 2),
    };
  };
  const chest = get('chest', 0.72, 13, 11);
  const waist = get('waist', 0.61, 13, 10);
  const hip = get('hip', 0.52, 9, 15);
  const crotch = get('crotch', 0.47, 8, 13);
  const top = { y: chest.y - 0.035 * H, F: chest.F * 0.92, B: chest.B * 0.95 };
  const levels = [top, chest, waist, hip, crotch];

  // layer thicknesses from the slice (front = top of the slice, theta = -pi/2 -> index 3/4 of the grid)
  const front = (SAMPLES * 3) / 4;
  const back = SAMPLES / 4;
  const rr = slice.radii;
  const satF = Math.max(rr.outer[front]! - rr.wallOuter[front]!, 0.3);
  const satB = Math.max(rr.outer[back]! - rr.wallOuter[back]!, 0.3);
  const wallF = Math.max(rr.wallOuter[front]! - rr.wallInner[front]!, 0.4);
  const wallB = Math.max(rr.wallOuter[back]! - rr.wallInner[back]! + slice.spine.r, 1);

  const skin: Pt[] = [
    ...levels.map((l) => [l.F, l.y] as Pt),
    ...[...levels].reverse().map((l) => [-l.B, l.y] as Pt),
  ];
  const wallL = levels.map((l) => ({
    y: l.y,
    F: Math.max(l.F - satF, 0.6 * l.F),
    B: Math.max(l.B - satB, 0.6 * l.B),
  }));
  const wall: Pt[] = [
    ...wallL.map((l) => [l.F, l.y] as Pt),
    ...[...wallL].reverse().map((l) => [-l.B, l.y] as Pt),
  ];

  // cavity: diaphragm (between chest and waist) to the pelvic floor (just below the hip level)
  const yTop = chest.y + 0.35 * (waist.y - chest.y);
  const yBot = hip.y + 0.45 * (crotch.y - hip.y);
  const interp = (y: number, key: 'F' | 'B') => {
    for (let i = 0; i < wallL.length - 1; i++) {
      const p = wallL[i]!;
      const q = wallL[i + 1]!;
      if (y >= p.y && y <= q.y) return p[key] + ((q[key] - p[key]) * (y - p.y)) / (q.y - p.y || 1);
    }
    return wallL[wallL.length - 1]![key];
  };
  const cavL = [yTop, (yTop + waist.y) / 2, waist.y, (waist.y + hip.y) / 2, hip.y, yBot].map((y) => ({
    y,
    F: Math.max(interp(y, 'F') - wallF, 1),
    B: Math.max(interp(y, 'B') - wallB, 1),
  }));
  // dome under the diaphragm and a rounded pelvic floor
  const domeTop: Pt = [(cavL[0]!.F - cavL[0]!.B) / 2, yTop - 0.35 * (cavL[0]!.F + cavL[0]!.B) * 0.4];
  const floor: Pt = [(cavL[cavL.length - 1]!.F - cavL[cavL.length - 1]!.B) / 2, yBot + 1.5];
  const cavity: Pt[] = [
    domeTop,
    ...cavL.map((l) => [l.F, l.y] as Pt),
    floor,
    ...[...cavL].reverse().map((l) => [-l.B, l.y] as Pt),
  ];

  // deep-fat fraction and the loops that fill the rest
  const vatA = Math.max(finite(params.visceral.vatAreaCm2, 0), 0);
  const orgA = Math.max(finite(params.visceral.organsAreaCm2, 0), 0);
  const vatFraction = vatA + orgA > 0 ? vatA / (vatA + orgA) : 0;
  const xs = cavity.map((p) => p[0]);
  const ys = cavity.map((p) => p[1]);
  const bx0 = Math.min(...xs);
  const bx1 = Math.max(...xs);
  const by0 = Math.min(...ys);
  const by1 = Math.max(...ys);
  const w = bx1 - bx0;
  const h = by1 - by0;
  const cell = LOOP_CELL * w * h;
  const r = Math.sqrt(((1 - vatFraction) * cell) / Math.PI);
  const loops: Circle[] = LOOP_GRID.map(([u, v]) => ({ cx: bx0 + u * w, cy: by0 + v * h, r }));

  const all = [...skin];
  return {
    skin,
    wall,
    cavity,
    loops,
    vatFraction,
    slice: { y: waist.y, x0: -waist.B, x1: waist.F },
    extent: {
      minX: Math.min(...all.map((p) => p[0])),
      maxX: Math.max(...all.map((p) => p[0])),
      minY: Math.min(...all.map((p) => p[1])),
      maxY: Math.max(...all.map((p) => p[1])),
    },
  };
}
