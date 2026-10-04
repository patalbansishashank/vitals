// Parametric two-layer body outlines (AVATAR_SPEC §3-§5, §10.3), driven by the engine's AvatarParams.
//
// Pure functions, no DOM. Units are centimetres; x = right (front view) or anterior (side view) of the midline /
// plumb line, y = height above the floor (y UP - the renderer flips it). Every outline has a FIXED number of points
// for any body, so two geometries can be interpolated point-by-point and paths morph cleanly.
//
// Rules carried over from the prototype (design/prototype/avatar.js):
// - the lean core keeps anatomical, local muscle shapes (trap slope, lats, deltoid cap, quad teardrop, calf);
// - fat is low-pass: the shell is interpolated between landmarks and the envelope's bumps are washed out as the
//   shell thickens, so fat rounds the contour instead of reading as "bigger muscles" (§4.2);
// - symmetric front view; arms hang in a relaxed A-pose and open just enough to clear the torso (§3.4, §7.4);
// - the thigh gap is emergent: inner thigh envelopes clamp at the midline and merge (§3.3).

import type { AvatarParams } from '@/engine/body';
import { SKIN_CM, clamp, fin, lerp, mixMF, resolveFrame, sectionsFrom, type LimbSection, type Sections } from './sections';

export { sectionsFrom, resolveFrame } from './sections';

/** A point in centimetres, y up. */
export type Pt = [number, number];

export interface Layered<T> {
  envelope: T;
  core: T;
}

export interface DefinitionStroke {
  id: 'pecL' | 'pecR' | 'lineaAlba' | 'deltL' | 'deltR' | 'quadL' | 'quadR' | 'calfL' | 'calfR';
  /** Open polyline, smoothed when drawn. */
  pts: Pt[];
  /** 0..1 from the engine's definition drivers (muscular AND lean). */
  opacity: number;
}

export interface Ellipse {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export type HandleRegion = 'chest' | 'waist' | 'hips' | 'arms';
export type LandmarkId = 'chest' | 'waist' | 'hip';

export interface FrontGeometry {
  /** Torso + legs + neck: one closed, left-right symmetric outline. */
  body: Layered<Pt[]>;
  /** [right arm, left arm], closed outlines. */
  arms: Layered<[Pt[], Pt[]]>;
  /** Closed head outline (lean material, no fat layer - facial fat is not modelled beyond jaw fullness). */
  head: Pt[];
  definition: DefinitionStroke[];
  visceral: Ellipse;
  /** Envelope half-width at the girth landmarks (for callouts and landmark ticks). */
  landmarks: Record<LandmarkId, { y: number; halfWidth: number }>;
  /** Direct-manipulation handle anchors on the envelope edge (chest/hips on the figure's right = viewer's left). */
  handles: Record<HandleRegion, Pt>;
  armAngleDeg: number;
  extent: { minX: number; maxX: number; maxY: number };
}

export interface SideGeometry {
  /** Profile section (arms omitted by design), closed. */
  body: Layered<Pt[]>;
  head: Pt[];
  /** Anterior half of the visceral ellipse, closed. */
  visceral: Pt[];
  landmarks: Record<LandmarkId, { y: number; front: number; back: number }>;
  extent: { minX: number; maxX: number; maxY: number };
}

export interface AvatarGeometry {
  heightCm: number;
  /** Drawing frame 0..1 (0 = hips-led, 1 = shoulders-led). */
  frame: number;
  front: FrontGeometry;
  side: SideGeometry;
}

export interface GeometryOptions {
  /** Drawing-only frame 0..1 (0 = hips-led, 1 = shoulders-led). Default: `params.figure.frame`, else from sex. */
  frame?: number;
}

/** Fixed vertical extent of the stage in cm (spec §5: shared vertical scale for both views). */
export const STAGE_HEIGHT_CM = 215;
/** Minimum horizontal extents per view (spec §5 viewBoxes, front tightened to ±40); extreme bodies widen them. */
export const FRONT_HALF_WIDTH_CM = 40;
export const SIDE_HALF_WIDTH_CM = 30;

const GAP_CM = 0.35; // inner-thigh clamp (x >= this), spec §3.3
const ARM_CLEAR_CM = 0.6; // elbow/forearm envelope vs torso envelope (horizontal, on the drawn curves)

// ------------------------------------------------------------------------------------------------ helpers
interface Station {
  y: number;
  e: number;
  c: number;
  /** Pinned stations come straight from engine landmarks and are not re-smoothed. */
  pin?: boolean;
}

/** Wash out envelope bumps where the shell is thick (spec §4.2): pull free stations toward the neighbours' mean. */
function washOut(st: Station[]): void {
  const e0 = st.map((s) => s.e);
  for (let i = 1; i < st.length - 1; i++) {
    const s = st[i]!;
    if (s.pin) continue;
    const t = s.e - s.c;
    const w = 0.5 * clamp((t - 0.8) / 3.2, 0, 1);
    const mean = 0.5 * (e0[i - 1]! + e0[i + 1]!);
    s.e = Math.max(s.c + SKIN_CM, lerp(e0[i]!, Math.max(e0[i]!, mean), w));
  }
}

function interpStationX(st: readonly { y: number; x: number }[], y: number): number {
  // st sorted by descending y; binary search for the bracketing pair
  const n = st.length;
  if (n === 0) return 0;
  if (y >= st[0]!.y) return st[0]!.x;
  if (y <= st[n - 1]!.y) return st[n - 1]!.x;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (st[mid]!.y >= y) lo = mid;
    else hi = mid;
  }
  const a = st[lo]!;
  const b = st[hi]!;
  const t = a.y === b.y ? 0 : (a.y - y) / (a.y - b.y);
  return lerp(a.x, b.x, t);
}

const mirror = (pts: Pt[]): Pt[] => pts.map(([x, y]) => [-x, y] as Pt);

function extentOf(groups: Pt[][]): { minX: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const g of groups)
    for (const [x, y] of g) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  return { minX, maxX, maxY };
}

/** Head outline: a plain form, fuller cranium, slightly narrower jaw (less so with face fullness). */
function headOutline(cx: number, cy: number, rx: number, ry: number, jaw: number, side: boolean): Pt[] {
  const n = 20;
  const pts: Pt[] = [];
  for (let k = 0; k < n; k++) {
    const phi = Math.PI / 2 - (2 * Math.PI * k) / n; // start at the crown, clockwise
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    let x = rx * Math.sign(c) * Math.pow(Math.abs(c), 0.86);
    const y = cy + ry * Math.sign(s) * Math.pow(Math.abs(s), 0.95);
    if (s < 0) x *= 1 - jaw * Math.pow(-s, 1.6);
    if (side) {
      if (c < 0 && s > -0.2) x *= 1.06; // occiput
      if (c > 0 && s < 0) x *= 1 - 0.1 * Math.pow(-s, 1.2); // face plane recedes to the chin
    }
    pts.push([cx + x, y]);
  }
  return pts;
}

// ------------------------------------------------------------------------------------------------ front view
interface LegStation {
  y: number;
  /** envelope outer / inner x, core outer / inner x (right leg, x > 0). */
  eo: number;
  ei: number;
  co: number;
  ci: number;
}

function frontTorsoStations(s: Sections, belly: { navelY: number }): Station[] {
  const { H, baseW: w, neck, shoulder, chest, waist, hip, crotch, muscularity: m, S } = s;
  const bust = 1 - w;
  const rTrap = mixMF(w, 0.42, 0.36);
  const rUnder = mixMF(w, 0.5, 0.56);
  const rNavel = mixMF(w, 0.2, 0.36);
  const bellyBonus = 0.16 * Math.max(0, waist.shell - 2.2);
  const st: Station[] = [
    { y: 0.897 * H, e: neck.e * 0.97, c: neck.c * 0.97 },
    { y: 0.877 * H, e: neck.e, c: neck.c },
    { y: neck.y, e: neck.e * 1.05, c: neck.c * 1.05, pin: true },
    {
      y: 0.843 * H,
      e: neck.e + rTrap * (shoulder.e - neck.e) + 0.3 * m * S,
      c: neck.c + rTrap * (shoulder.c - neck.c) + 0.7 * m * S,
    },
    // the arm's deltoid cap draws the outer shoulder; the torso's shoulder sits just inside it
    { y: shoulder.y, e: shoulder.e * 0.94, c: shoulder.c * 0.94, pin: true },
    // axilla: lats flare under the arm (muscle shape on the core)
    { y: 0.772 * H, e: chest.e * 1.02 + 0.6 * m * S, c: chest.c * 1.02 + 0.9 * m * S },
    { y: chest.y, e: chest.e + 0.55 * bust, c: chest.c, pin: true },
    { y: 0.675 * H, e: waist.e + rUnder * (chest.e - waist.e), c: waist.c + rUnder * (chest.c - waist.c) },
    { y: waist.y, e: waist.e, c: waist.c, pin: true },
    { y: belly.navelY, e: waist.e + rNavel * (hip.e - waist.e) + bellyBonus, c: waist.c + rNavel * (hip.c - waist.c) },
    { y: hip.y, e: hip.e, c: hip.c, pin: true },
    { y: crotch.y, e: crotch.e, c: crotch.c, pin: true },
  ];
  for (const x of st) x.e = Math.max(x.e, x.c + SKIN_CM);
  washOut(st);
  return st;
}

function legStations(s: Sections): { st: LegStation[]; foot: { cx: number; hw: number } } {
  const { H, thigh, knee, calf, ankle, crotch, muscularity: m, S, baseW: w } = s;
  // relaxed stance: thighs converge a little, lower legs stand slightly apart (feet about hip-width)
  const cxT = thigh.cx;
  const cxK = Math.max(cxT * 0.96, knee.e + 1.2 * S);
  const cxC = Math.max(cxT * 1.0, calf.e + 1.4 * S);
  const cxA = Math.max(cxT * 1.03, ankle.e + 2.6 * S);
  // lateral thigh fat is thicker on the female template; inner-thigh fat a little thicker than the mean
  const kOut = mixMF(w, 1.0, 1.25);
  const kIn = mixMF(w, 1.0, 1.1);
  const mk = (y: number, cx: number, L: Pick<LimbSection, 'e' | 'c'>, outBias = 0, inBias = 0, coreIn = 0, coreOut = 0): LegStation => {
    const t = L.e - L.c;
    const eo = cx + L.e + outBias;
    const ei = cx - L.e - inBias;
    const co = eo - Math.max(SKIN_CM, Math.min(t * kOut, L.e * 0.55)) + coreOut;
    const ci = ei + Math.max(SKIN_CM, Math.min(t * kIn, L.e * 0.55)) - coreIn;
    return { y, eo, ei, co, ci };
  };
  // upper thigh: outer edge continues the hip line, inner edge is the adductor mass under the crotch
  const utOuterE = lerp(crotch.e, cxT + thigh.e, 0.42);
  const utOuterC = lerp(crotch.c, cxT + thigh.e - (thigh.e - thigh.c) * kOut, 0.42);
  const ut: LegStation = {
    y: 0.438 * H,
    eo: utOuterE,
    ei: cxT - thigh.e * 1.08,
    co: utOuterC,
    ci: cxT - thigh.e * 1.08 + Math.max(SKIN_CM, (thigh.e - thigh.c) * kIn),
  };
  const aboveKnee = {
    e: lerp(knee.e, thigh.e, 0.36),
    c: lerp(knee.c, thigh.c, 0.36),
  };
  const belowKnee = { e: lerp(knee.e, calf.e, 0.5) * 0.99, c: lerp(knee.c, calf.c, 0.5) * 0.99 };
  const lowerCalf = { e: lerp(ankle.e, calf.e, 0.4), c: lerp(ankle.c, calf.c, 0.4) };
  const st: LegStation[] = [
    ut,
    mk(thigh.y, cxT, thigh, 0.15 * m * S, 0, 0.2 * m * S, 0.35 * m * S),
    // quad teardrop (vastus medialis): inner side only
    mk(0.322 * H, lerp(cxK, cxT, 0.36), aboveKnee, 0, 0.1, 0.75 * m * S, 0.1 * m * S),
    mk(knee.y, cxK, knee),
    mk(0.248 * H, lerp(cxK, cxC, 0.5), belowKnee, 0.12, 0, 0.1 * m * S, 0.3 * m * S),
    // calf: medial head sits lower and fuller
    mk(calf.y, cxC, calf, 0, 0.15, 0.55 * m * S, 0.3 * m * S),
    mk(0.13 * H, lerp(cxA, cxC, 0.4), lowerCalf),
    mk(0.05 * H, cxA, ankle),
  ];
  // fat is low-pass on the legs too: where the shell is thick, the knee/calf bumps wash out (spec §4.2)
  const eo0 = st.map((L) => L.eo);
  const ei0 = st.map((L) => L.ei);
  const tOut0 = st.map((L) => L.eo - L.co);
  const tIn0 = st.map((L) => L.ci - L.ei);
  for (const i of [2, 3, 4, 6]) {
    const L = st[i]!;
    // the thicker neighbouring shell fills the joint (knee fat pads)
    const tOut = Math.max(tOut0[i - 1]!, tOut0[i]!, tOut0[i + 1]!);
    const tIn = Math.max(tIn0[i - 1]!, tIn0[i]!, tIn0[i + 1]!);
    const wo = 0.6 * clamp((tOut - 0.8) / 2.5, 0, 1);
    const wi = 0.6 * clamp((tIn - 0.8) / 2.5, 0, 1);
    L.eo = lerp(eo0[i]!, Math.max(eo0[i]!, 0.5 * (eo0[i - 1]! + eo0[i + 1]!)), wo);
    L.ei = lerp(ei0[i]!, Math.min(ei0[i]!, 0.5 * (ei0[i - 1]! + ei0[i + 1]!)), wi);
  }
  // thigh gap is emergent: clamp inner edges at the midline, keep the core inside the envelope
  for (const L of st) {
    L.ei = Math.max(GAP_CM, L.ei);
    L.ci = Math.max(L.ei + SKIN_CM * 0.6, L.ci);
    L.eo = Math.max(L.eo, L.co + SKIN_CM);
    L.co = Math.max(L.co, L.ci + 0.8);
    L.eo = Math.max(L.eo, L.co + SKIN_CM);
  }
  const foot = { cx: cxA + mixMF(w, 0.7, 0.55) * S, hw: Math.max(ankle.e * 1.3, 3.2 * S) };
  return { st, foot };
}

function frontBodyOutline(torso: Station[], legs: LegStation[], foot: { cx: number; hw: number }, H: number, layer: 'e' | 'c'): Pt[] {
  const pts: Pt[] = [];
  for (const s of torso) pts.push([layer === 'e' ? s.e : s.c, s.y]);
  for (const L of legs) pts.push([layer === 'e' ? L.eo : L.co, L.y]);
  const inset = layer === 'e' ? 0 : SKIN_CM * 0.8;
  // front-view foot: foreshortened instep, flat sole, slightly turned out
  pts.push(
    [foot.cx + foot.hw * 0.92 - inset, 0.026 * H],
    [foot.cx + foot.hw * 1.0 - inset, 0.008 * H + inset],
    [foot.cx + foot.hw * 0.55, 0.0008 * H + inset],
    [foot.cx - foot.hw * 0.55, 0.0008 * H + inset],
    [foot.cx - foot.hw * 0.9 + inset, 0.009 * H + inset],
    [foot.cx - foot.hw * 0.8 + inset, 0.026 * H],
  );
  for (let i = legs.length - 1; i >= 0; i--) {
    const L = legs[i]!;
    pts.push([layer === 'e' ? L.ei : L.ci, L.y]);
  }
  pts.push([0, layer === 'e' ? 0.466 * H : 0.466 * H - 0.5]);
  // mirror (skip the apex, which is on the midline)
  const left = mirror(pts.slice(0, -1)).reverse();
  return pts.concat(left);
}

interface ArmStation {
  s: number;
  e: number;
  c: number;
}

function armStations(s: Sections): { st: ArmStation[]; L: number } {
  const { H, upperArm, elbow, forearm, wrist, muscularity: m, S } = s;
  const L = 0.332 * H; // shoulder joint -> wrist
  const handTip = 1 + (0.098 * H) / L;
  const palm = 1 + (0.042 * H) / L;
  const fingers = 1 + (0.078 * H) / L;
  const handHw = Math.max(wrist.e * 1.1, 0.0178 * H);
  const st: ArmStation[] = [
    { s: 0.06, e: upperArm.e * 1.1 + 0.25 * m * S, c: upperArm.c * 1.1 + 0.55 * m * S },
    { s: 0.27, e: upperArm.e, c: upperArm.c + 0.25 * m * S },
    { s: 0.55, e: elbow.e, c: elbow.c },
    { s: 0.7, e: forearm.e * 1.03, c: forearm.c * 1.03 + 0.2 * m * S },
    { s: 1.0, e: wrist.e, c: wrist.c },
    { s: palm, e: handHw, c: handHw - SKIN_CM },
    { s: fingers, e: handHw * 0.9, c: handHw * 0.9 - SKIN_CM },
    { s: handTip, e: handHw * 0.42, c: handHw * 0.42 - SKIN_CM * 0.5 },
  ];
  for (const a of st) {
    a.c = Math.max(0.3, Math.min(a.c, a.e - SKIN_CM * 0.5));
  }
  return { st, L };
}

/**
 * Smallest angle >= the engine's resting angle at which the drawn elbow-to-forearm envelope clears the drawn torso
 * envelope (AVATAR_SPEC §3.4, §7.4). Continuous in the params (bisection), so morphs never jump.
 */
function solveArmAngle(s: Sections, arm: { st: ArmStation[]; L: number }, torsoEdge: Pt[]): number {
  const edge = sampleCurve(torsoEdge, false, 6).map(([x, y]) => ({ x, y }));
  const H = s.H;
  const clearance = (deg: number): number => {
    const th = (deg * Math.PI) / 180;
    const yHi = s.armTop.y - Math.cos(th) * arm.L * 0.45;
    const yLo = s.armTop.y - Math.cos(th) * arm.L * 0.84;
    let worst = Infinity;
    for (const [x, y] of sampleCurve(armOutline(s, arm, deg, 'e'), true, 5)) {
      if (y > yHi || y < yLo) continue;
      worst = Math.min(worst, x - interpStationX(edge, y));
    }
    return (Number.isFinite(worst) ? worst : 0.1 * H) - ARM_CLEAR_CM;
  };
  const lo0 = s.armAngleDeg;
  if (clearance(lo0) >= 0) return lo0;
  let lo = lo0;
  let hi = 42;
  if (clearance(hi) < 0) return hi;
  for (let i = 0; i < 22; i++) {
    const mid = 0.5 * (lo + hi);
    if (clearance(mid) >= 0) hi = mid;
    else lo = mid;
  }
  return hi;
}

function armOutline(s: Sections, arm: { st: ArmStation[]; L: number }, deg: number, layer: 'e' | 'c'): Pt[] {
  const th = (deg * Math.PI) / 180;
  const dir: Pt = [Math.sin(th), -Math.cos(th)];
  const nrm: Pt = [Math.cos(th), Math.sin(th)];
  const { x: x0, y: y0 } = s.armTop;
  const at = (sv: number, off: number): Pt => [x0 + dir[0] * arm.L * sv + nrm[0] * off, y0 + dir[1] * arm.L * sv + nrm[1] * off];
  const w = (a: ArmStation) => (layer === 'e' ? a.e : a.c);
  const top = w(arm.st[0]!);
  const pts: Pt[] = [];
  // deltoid cap: from inside the shoulder, over the top, down the outer edge
  pts.push(at(-0.05, -top * 0.35), at(-0.04, top * 0.5));
  for (const a of arm.st.slice(0, -1)) pts.push(at(a.s, w(a)));
  const tip = arm.st[arm.st.length - 1]!;
  pts.push(at(tip.s, w(tip)), at(tip.s + 0.012, 0), at(tip.s, -w(tip)));
  for (let i = arm.st.length - 2; i >= 1; i--) {
    const a = arm.st[i]!;
    pts.push(at(a.s, -w(a) * (i === 1 ? 0.96 : 1)));
  }
  // armpit, tucked inside the torso outline
  pts.push(at(0.13, -top * 0.85));
  return pts;
}

function frontGeometry(s: Sections): FrontGeometry {
  const { H, waist, definition } = s;
  const sag = 0.004 * Math.max(0, waist.shell - 4);
  const navelY = (0.576 - sag) * H;
  const torso = frontTorsoStations(s, { navelY });
  const { st: legs, foot } = legStations(s);
  const env = frontBodyOutline(torso, legs, foot, H, 'e');
  const core = frontBodyOutline(torso, legs, foot, H, 'c');

  const arm = armStations(s);
  const edge: Pt[] = torso.map((t) => [t.e, t.y] as Pt).concat(legs.map((L) => [L.eo, L.y] as Pt));
  const deg = solveArmAngle(s, arm, edge);
  const armR = { e: armOutline(s, arm, deg, 'e'), c: armOutline(s, arm, deg, 'c') };

  const jaw = 0.2 * (1 - 0.55 * s.head.fullness);
  const head = headOutline(0, s.head.cy, s.head.rx, s.head.ry, jaw, false);

  // definition hairlines (§4.3) - positions on the core
  const byY = (y: number) => torso.reduce((best, t) => (Math.abs(t.y - y) < Math.abs(best.y - y) ? t : best), torso[0]!);
  const ub = byY(0.675 * H);
  const ch = byY(s.chest.y);
  const th = (deg * Math.PI) / 180;
  const armPt = (sv: number, off: number): Pt => [
    s.armTop.x + Math.sin(th) * arm.L * sv + Math.cos(th) * off,
    s.armTop.y - Math.cos(th) * arm.L * sv + Math.sin(th) * off,
  ];
  const deltC = arm.st[0]!.c;
  const uaC = arm.st[1]!.c;
  const deltR: Pt[] = [armPt(0.07, deltC * 0.92), armPt(0.2, uaC * 0.35), armPt(0.3, -uaC * 0.25)];
  const [thighL, aboveKneeL, kneeL, , calfL] = [legs[1]!, legs[2]!, legs[3]!, legs[4]!, legs[5]!];
  const quadR: Pt[] = [
    [thighL.ci + 1.4 * s.S, thighL.y - 2],
    [aboveKneeL.ci + 0.9 * s.S, aboveKneeL.y + 1.2],
    [kneeL.ci + 1.6 * s.S, kneeL.y + 1.2],
  ];
  const calfMid = 0.5 * (calfL.co + calfL.ci);
  const calfR: Pt[] = [
    [calfMid - 0.3, calfL.y + 0.05 * H * 0.6],
    [calfMid + 0.1, calfL.y - 0.02 * H],
  ];
  const pecW = s.baseW * 0.55 + 0.45; // hips-led frame: softer pec line (reads as underbust otherwise)
  const pecR: Pt[] = [
    [ch.c * 0.74, ub.y + 2.4],
    [ch.c * 0.34, ub.y - 0.3],
    [0.25, ub.y + 0.6],
  ];
  const definitionStrokes: DefinitionStroke[] = [
    { id: 'pecR', pts: pecR, opacity: clamp(fin(definition.pecs, 0) * pecW, 0, 1) },
    { id: 'pecL', pts: mirror(pecR), opacity: clamp(fin(definition.pecs, 0) * pecW, 0, 1) },
    { id: 'lineaAlba', pts: [[0, ub.y - 1], [0, (ub.y + navelY) / 2], [0, navelY + 1.5]], opacity: clamp(fin(definition.abs, 0) * 0.85, 0, 1) },
    { id: 'deltR', pts: deltR, opacity: clamp(fin(definition.delts, 0), 0, 1) },
    { id: 'deltL', pts: mirror(deltR), opacity: clamp(fin(definition.delts, 0), 0, 1) },
    { id: 'quadR', pts: quadR, opacity: clamp(fin(definition.quads, 0), 0, 1) },
    { id: 'quadL', pts: mirror(quadR), opacity: clamp(fin(definition.quads, 0), 0, 1) },
    { id: 'calfR', pts: calfR, opacity: clamp(fin(definition.quads, 0) * 0.7, 0, 1) },
    { id: 'calfL', pts: mirror(calfR), opacity: clamp(fin(definition.quads, 0) * 0.7, 0, 1) },
  ];

  const navel = torso.find((t) => t.y === navelY) ?? byY(navelY);
  const vatR = 0.8 + 2.6 * s.S * Math.pow(Math.max(0, s.vatKg), 0.45);
  const vRx = Math.min(navel.c * 0.72, vatR);
  const visceral: Ellipse = { cx: 0, cy: navelY + 2, rx: vRx, ry: Math.min(0.075 * H, vRx * 1.25) };

  const uaStation = arm.st[1]!;
  const handles: Record<HandleRegion, Pt> = {
    waist: [s.waist.e, s.waist.y],
    arms: armPt(uaStation.s, uaStation.e),
    chest: [-(s.chest.e + 0.55 * (1 - s.baseW)), s.chest.y],
    hips: [-s.hip.e, s.hip.y],
  };

  const armL = { e: mirror(armR.e), c: mirror(armR.c) };
  return {
    body: { envelope: env, core },
    arms: { envelope: [armR.e, armL.e], core: [armR.c, armL.c] },
    head,
    definition: definitionStrokes,
    visceral,
    landmarks: {
      chest: { y: s.chest.y, halfWidth: s.chest.e + 0.55 * (1 - s.baseW) },
      waist: { y: s.waist.y, halfWidth: s.waist.e },
      hip: { y: s.hip.y, halfWidth: s.hip.e },
    },
    handles,
    armAngleDeg: deg,
    extent: extentOf([env, armR.e, armL.e, head]),
  };
}

// ------------------------------------------------------------------------------------------------ side view
interface SideStation {
  y: number;
  /** envelope / core anterior and posterior x (anterior +, from the plumb line). */
  ef: number;
  eb: number;
  cf: number;
  cb: number;
  pin?: boolean;
}

function sideGeometry(s: Sections): SideGeometry {
  const { H, S, baseW: w, neck, shoulder, chest, waist, hip, crotch, thigh, knee, calf, ankle } = s;
  const bust = 1 - w;
  const neckX = 0.6 * S;
  const sag = 0.004 * Math.max(0, waist.shell - 4);
  const bellyY = (0.576 - sag) * H;
  const bellyBonus = 0.3 * Math.max(0, waist.shell - 2.4);
  const lowBellyY = 0.5 * (bellyY + hip.y);
  const bellyF = Math.max(waist.eF, lerp(waist.eF, hip.eF, 0.28)) + bellyBonus;
  const bellyCF = Math.max(waist.cF, lerp(waist.cF, hip.cF, 0.28));
  // bust volume (spec §3.6: ~2.2 cm + a fat term): the engine's chest girth already holds it, so the stations above
  // and below the chest recede instead of the chest growing
  const bustFold = bust * (2.1 + 0.8 * chest.shell);

  const T = (y: number, xc: number, ef: number, eb: number, cf: number, cb: number, pin = false): SideStation => ({
    y,
    ef: xc + ef,
    eb: xc - eb,
    cf: xc + Math.min(cf, ef - SKIN_CM),
    cb: xc - Math.min(cb, eb - SKIN_CM),
    pin,
  });
  const legSec = (L: LimbSection, phi: number, xc: number, y = L.y): SideStation =>
    T(y, xc, 2 * L.d * phi, 2 * L.d * (1 - phi), 2 * L.cd * phi, 2 * L.cd * (1 - phi));

  const xcThigh = -0.9 * S;
  const xcKnee = -0.7 * S;
  const xcCalf = -1.9 * S;
  const xcAnkle = -2.7 * S;
  const glute = {
    y: 0.452 * H,
    ef: lerp(crotch.eF, 2 * thigh.d * 0.56 + xcThigh, 0.5),
    eb: lerp(crotch.eB, 2 * thigh.d * 0.44 - xcThigh, 0.62),
    cf: lerp(crotch.cF, 2 * thigh.cd * 0.56 + xcThigh, 0.5),
    cb: lerp(crotch.cB, 2 * thigh.cd * 0.44 - xcThigh, 0.62),
  };
  const kneeAbove = {
    d: lerp(knee.d, thigh.d, 0.35),
    cd: lerp(knee.cd, thigh.cd, 0.35),
  };
  const st: SideStation[] = [
    T(0.897 * H, neckX, neck.eF * 0.95, neck.eB * 0.95, neck.cF * 0.95, neck.cB * 0.95),
    T(0.877 * H, neckX, neck.eF, neck.eB, neck.cF, neck.cB),
    T(neck.y, neckX * 0.7, neck.eF * 1.05, neck.eB * 1.08, neck.cF * 1.05, neck.cB * 1.08, true),
    T(0.841 * H, neckX * 0.3, lerp(neck.eF, shoulder.eF, 0.4), lerp(neck.eB, shoulder.eB, 0.62), lerp(neck.cF, shoulder.cF, 0.4), lerp(neck.cB, shoulder.cB, 0.62)),
    T(shoulder.y, 0, shoulder.eF, shoulder.eB, shoulder.cF, shoulder.cB, true),
    T(
      0.772 * H,
      0,
      lerp(shoulder.eF, chest.eF, 0.74) - 0.35 * bustFold,
      Math.max(chest.eB, shoulder.eB) * 1.02,
      lerp(shoulder.cF, chest.cF, 0.74),
      Math.max(chest.cB, shoulder.cB) * 1.02,
    ),
    T(chest.y, 0, chest.eF, chest.eB, chest.cF, chest.cB, true),
    T(0.675 * H, 0, lerp(waist.eF, chest.eF, 0.5) - bustFold, lerp(waist.eB, chest.eB, 0.55), lerp(waist.cF, chest.cF, 0.5), lerp(waist.cB, chest.cB, 0.55)),
    T(waist.y, 0, waist.eF, waist.eB, waist.cF, waist.cB, true),
    T(
      bellyY,
      0,
      bellyF,
      lerp(waist.eB, hip.eB, 0.3) * 0.95,
      bellyCF,
      lerp(waist.cB, hip.cB, 0.3) * 0.95,
    ),
    T(
      lowBellyY,
      0,
      lerp(bellyF, Math.max(hip.eF, lerp(crotch.eF, bellyF, 0.4)), 0.45),
      lerp(waist.eB, hip.eB, 0.68),
      lerp(bellyCF, Math.max(hip.cF, lerp(crotch.cF, bellyCF, 0.4)), 0.45),
      lerp(waist.cB, hip.cB, 0.68),
    ),
    // a heavy belly carries the front profile down over the hip level (the engine's hip phi is fixed)
    T(hip.y, 0, Math.max(hip.eF, lerp(crotch.eF, bellyF, 0.4)), hip.eB, Math.max(hip.cF, lerp(crotch.cF, bellyCF, 0.4)), hip.cB, true),
    T(crotch.y, 0, crotch.eF, crotch.eB, crotch.cF, crotch.cB, true),
    { y: glute.y, ef: glute.ef, eb: -glute.eb, cf: Math.min(glute.cf, glute.ef - SKIN_CM), cb: -Math.min(glute.cb, glute.eb - SKIN_CM) },
    legSec(thigh, 0.56, xcThigh),
    T(0.322 * H, lerp(xcKnee, xcThigh, 0.35), 2 * kneeAbove.d * 0.55, 2 * kneeAbove.d * 0.45, 2 * kneeAbove.cd * 0.55, 2 * kneeAbove.cd * 0.45),
    legSec(knee, 0.53, xcKnee),
    T(0.248 * H, lerp(xcKnee, xcCalf, 0.55), (knee.d + calf.d) * 0.47, (knee.d + calf.d) * 0.53, (knee.cd + calf.cd) * 0.47, (knee.cd + calf.cd) * 0.53),
    legSec(calf, 0.4, xcCalf),
    T(0.13 * H, lerp(xcAnkle, xcCalf, 0.4), lerp(ankle.d, calf.d, 0.4) * 2 * 0.42, lerp(ankle.d, calf.d, 0.4) * 2 * 0.58, lerp(ankle.cd, calf.cd, 0.4) * 2 * 0.42, lerp(ankle.cd, calf.cd, 0.4) * 2 * 0.58),
    legSec(ankle, 0.46, xcAnkle, 0.05 * H),
  ];
  // low-pass the side envelope bumps where fat is thick (not at pinned landmarks)
  const env0 = st.map((x) => ({ ef: x.ef, eb: x.eb }));
  for (let i = 1; i < st.length - 1; i++) {
    const x = st[i]!;
    if (x.pin) continue;
    const tf = x.ef - x.cf;
    const wf = 0.45 * clamp((tf - 1) / 3.5, 0, 1);
    x.ef = Math.max(x.cf + SKIN_CM, lerp(env0[i]!.ef, Math.max(env0[i]!.ef, 0.5 * (env0[i - 1]!.ef + env0[i + 1]!.ef)), wf));
    const tb = x.cb - x.eb;
    const wb = 0.45 * clamp((tb - 1) / 3.5, 0, 1);
    x.eb = Math.min(x.cb - SKIN_CM, lerp(env0[i]!.eb, Math.min(env0[i]!.eb, 0.5 * (env0[i - 1]!.eb + env0[i + 1]!.eb)), wb));
  }

  const footLen = 0.152 * H;
  const heel = xcAnkle - 0.26 * footLen;
  const toe = xcAnkle + 0.74 * footLen;
  const footTop = (layer: 'e' | 'c'): Pt[] => {
    const i = layer === 'e' ? 0 : SKIN_CM;
    return [
      [xcAnkle + 0.22 * footLen - i, 0.037 * H - i],
      [toe - 0.2 * footLen - i, 0.019 * H - i * 0.5],
      [toe - 0.03 * footLen - i, 0.012 * H],
      [toe - 0.02 * footLen - i, 0.003 * H + i],
      [toe - 0.16 * footLen, 0.0005 * H + i],
      [heel + 0.14 * footLen, 0.0005 * H + i],
      [heel + 0.01 * footLen + i, 0.006 * H + i],
      [heel + 0.03 * footLen + i, 0.022 * H],
    ];
  };
  const outline = (layer: 'e' | 'c'): Pt[] => {
    const pts: Pt[] = [];
    for (const x of st) pts.push([layer === 'e' ? x.ef : x.cf, x.y]);
    pts.push(...footTop(layer));
    for (let i = st.length - 1; i >= 0; i--) {
      const x = st[i]!;
      pts.push([layer === 'e' ? x.eb : x.cb, x.y]);
    }
    return pts;
  };
  const env = outline('e');
  const core = outline('c');

  const headCx = 1.4 * S;
  const jaw = 0.12 * (1 - 0.5 * s.head.fullness);
  const head = headOutline(headCx, s.head.cy, s.head.depth, s.head.ry, jaw, true);

  // visceral: anterior half-ellipse inside the abdominal core
  const bel = st[9]!;
  const vatR = 0.8 + 2.6 * S * Math.pow(Math.max(0, s.vatKg), 0.45);
  const vRx = Math.min(Math.max(0.5, bel.cf) * 0.8, vatR * 0.85);
  const vRy = Math.min(0.075 * H, vatR * 1.25);
  const vCx = Math.max(-1, bel.cf - vRx - 1.2);
  const visceral: Pt[] = [];
  for (let k = 0; k <= 12; k++) {
    const a = -Math.PI / 2 + (Math.PI * k) / 12;
    visceral.push([vCx + vRx * Math.cos(a), bellyY + 2 + vRy * Math.sin(a)]);
  }

  return {
    body: { envelope: env, core },
    head,
    visceral,
    landmarks: {
      chest: { y: chest.y, front: chest.eF, back: chest.eB },
      waist: { y: waist.y, front: waist.eF, back: waist.eB },
      hip: { y: hip.y, front: hip.eF, back: hip.eB },
    },
    extent: extentOf([env, head]),
  };
}

// ------------------------------------------------------------------------------------------------ public API
/** Engine avatar params -> front + side two-layer geometry (cm, y up). Pure; ~0.1 ms. */
export function avatarGeometry(params: AvatarParams, options: GeometryOptions = {}): AvatarGeometry {
  const frame = resolveFrame(params, options.frame);
  const s = sectionsFrom(params, frame);
  return { heightCm: s.H, frame, front: frontGeometry(s), side: sideGeometry(s) };
}

const f2 = (v: number): string => {
  const r = Math.round(fin(v, 0) * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
};

type Bez = [Pt, Pt, Pt, Pt];

/** Centripetal Catmull-Rom (alpha 0.5) segments as cubic Beziers [p1, c1, c2, p2]. */
function catmullRomSegments(pts: readonly Pt[], closed: boolean): Bez[] {
  const n = pts.length;
  if (n < 2) return [];
  const P = pts.map(([x, y]) => [fin(x, 0), fin(y, 0)] as Pt);
  const get = (i: number): Pt => (closed ? P[(i + n) % n]! : P[clamp(i, 0, n - 1)]!);
  const segs: Bez[] = [];
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = get(i - 1);
    const p1 = get(i);
    const p2 = get(i + 1);
    const p3 = get(i + 2);
    const d1 = Math.max(1e-4, Math.sqrt(Math.hypot(p1[0] - p0[0], p1[1] - p0[1])));
    const d2 = Math.max(1e-4, Math.sqrt(Math.hypot(p2[0] - p1[0], p2[1] - p1[1])));
    const d3 = Math.max(1e-4, Math.sqrt(Math.hypot(p3[0] - p2[0], p3[1] - p2[1])));
    const c1: Pt = [
      (d1 * d1 * p2[0] - d2 * d2 * p0[0] + (2 * d1 * d1 + 3 * d1 * d2 + d2 * d2) * p1[0]) / (3 * d1 * (d1 + d2)),
      (d1 * d1 * p2[1] - d2 * d2 * p0[1] + (2 * d1 * d1 + 3 * d1 * d2 + d2 * d2) * p1[1]) / (3 * d1 * (d1 + d2)),
    ];
    const c2: Pt = [
      (d3 * d3 * p1[0] - d2 * d2 * p3[0] + (2 * d3 * d3 + 3 * d3 * d2 + d2 * d2) * p2[0]) / (3 * d3 * (d3 + d2)),
      (d3 * d3 * p1[1] - d2 * d2 * p3[1] + (2 * d3 * d3 + 3 * d3 * d2 + d2 * d2) * p2[1]) / (3 * d3 * (d3 + d2)),
    ];
    segs.push([p1, c1, c2, p2]);
  }
  return segs;
}

/** Points on the drawn curve (what the eye sees), `perSeg` samples per segment. */
export function sampleCurve(pts: readonly Pt[], closed = true, perSeg = 6): Pt[] {
  const segs = catmullRomSegments(pts, closed);
  const out: Pt[] = segs.length ? [segs[0]![0]] : [];
  for (const [a, b, c, d] of segs)
    for (let k = 1; k <= perSeg; k++) {
      const t = k / perSeg;
      const u = 1 - t;
      out.push([
        u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0],
        u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1],
      ]);
    }
  return out;
}

/**
 * Centripetal Catmull-Rom (alpha 0.5) through the points, as cubic Bezier segments (spec §5). Closed by default.
 * Coordinates are written as given (the renderer flips y); numbers are rounded to 0.01 and never NaN.
 */
export function pathD(pts: readonly Pt[], closed = true): string {
  if (pts.length === 0) return '';
  const first = pts[0]!;
  let d = `M${f2(fin(first[0], 0))},${f2(fin(first[1], 0))}`;
  for (const [, c1, c2, p2] of catmullRomSegments(pts, closed)) {
    d += `C${f2(c1[0])},${f2(c1[1])} ${f2(c2[0])},${f2(c2[1])} ${f2(p2[0])},${f2(p2[1])}`;
  }
  return closed ? `${d}Z` : d;
}

/** Point-wise interpolation of two outlines with the same topology (morph helper). */
export function lerpPts(a: readonly Pt[], b: readonly Pt[], t: number): Pt[] {
  if (a.length !== b.length) throw new RangeError(`lerpPts: topology mismatch (${a.length} vs ${b.length})`);
  return a.map(([x, y], i) => [lerp(x, b[i]![0], t), lerp(y, b[i]![1], t)] as Pt);
}

/**
 * Interpolate two geometries of the same topology (every numeric leaf; t may lie outside 0..1 for overshooting
 * eases). Non-numeric leaves (ids) come from `b` once t >= 0.5.
 */
export function lerpGeometry(a: AvatarGeometry, b: AvatarGeometry, t: number): AvatarGeometry {
  return lerpAny(a, b, t);
}

function lerpAny<T>(a: T, b: T, t: number): T {
  if (typeof a === 'number' && typeof b === 'number') return (a + (b - a) * t) as T;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return (t < 0.5 ? a : b) as T;
    return a.map((x: unknown, i: number) => lerpAny(x, b[i] as unknown, t)) as T;
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const out: Record<string, unknown> = {};
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    for (const key of Object.keys(rb)) out[key] = key in ra ? lerpAny(ra[key], rb[key], t) : rb[key];
    return out as T;
  }
  return t < 0.5 ? a : b;
}

/** Largest point displacement (cm) between two geometries' outlines - decides whether a change is a "jump". */
export function maxDisplacement(a: AvatarGeometry, b: AvatarGeometry): number {
  const groups = (g: AvatarGeometry): Pt[][] => [
    g.front.body.envelope,
    g.front.body.core,
    g.front.arms.envelope[0],
    g.side.body.envelope,
    g.side.body.core,
  ];
  const ga = groups(a);
  const gb = groups(b);
  let m = 0;
  for (let i = 0; i < ga.length; i++) {
    const pa = ga[i]!;
    const pb = gb[i]!;
    if (pa.length !== pb.length) return Infinity;
    for (let j = 0; j < pa.length; j++) {
      const d = Math.hypot(pa[j]![0] - pb[j]![0], pa[j]![1] - pb[j]![1]);
      if (d > m) m = d;
    }
  }
  return m;
}
