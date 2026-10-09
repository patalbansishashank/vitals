import { afterAll, describe, expect, it } from 'vitest';
import { estimateInitialState, stateToAvatarParams, type BodyInputs, type Sex } from '@/engine/body';
import { decodeFigure } from '../asset';
import { FigureScene } from '../scene';
import { fatStressState } from '../devStress';

type Point = [number, number, number];
interface Triangle {
  points: [Point, Point, Point];
  low: Point;
  high: Point;
  face: number;
}
interface Node {
  low: Point;
  high: Point;
  faces?: Triangle[];
  left?: Node;
  right?: Node;
}
interface ClearanceStencil {
  leftArm: number[];
  rightArm: number[];
  centralBody: number[];
}
const subtract = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Point, b: Point): Point => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const clamp = (n: number) => Math.max(0, Math.min(1, n));

function segmentDistance2(p: Point, q: Point, a: Point, b: Point): number {
  const d = subtract(q, p),
    e = subtract(b, a),
    r = subtract(p, a);
  const dd = dot(d, d),
    ee = dot(e, e),
    de = dot(d, e),
    dr = dot(d, r),
    er = dot(e, r);
  let s = 0,
    t = 0;
  if (dd <= 1e-14) t = ee > 1e-14 ? clamp(er / ee) : 0;
  else if (ee <= 1e-14) s = clamp(-dr / dd);
  else {
    const det = dd * ee - de * de;
    s = det > 1e-14 ? clamp((de * er - dr * ee) / det) : 0;
    t = (de * s + er) / ee;
    if (t < 0) {
      t = 0;
      s = clamp(-dr / dd);
    } else if (t > 1) {
      t = 1;
      s = clamp((de - dr) / dd);
    }
  }
  return r.reduce((sum, v, i) => sum + (v + s * d[i]! - t * e[i]!) ** 2, 0);
}

function pointDistance2(p: Point, [a, b, c]: [Point, Point, Point]): number {
  const ab = subtract(b, a),
    ac = subtract(c, a),
    ap = subtract(p, a);
  const normal = cross(ab, ac),
    n2 = dot(normal, normal);
  if (n2 > 1e-14) {
    const aa = dot(ab, ab),
      bb = dot(ac, ac),
      abac = dot(ab, ac);
    const u = (dot(ap, ab) * bb - dot(ap, ac) * abac) / n2;
    const v = (dot(ap, ac) * aa - dot(ap, ab) * abac) / n2;
    if (u >= 0 && v >= 0 && u + v <= 1) return dot(ap, normal) ** 2 / n2;
  }
  return Math.min(segmentDistance2(p, p, a, b), segmentDistance2(p, p, b, c), segmentDistance2(p, p, c, a));
}

function crossesTriangle(p: Point, q: Point, [a, b, c]: [Point, Point, Point]): boolean {
  const direction = subtract(q, p),
    ab = subtract(b, a),
    ac = subtract(c, a);
  const h = cross(direction, ac),
    det = dot(ab, h);
  if (Math.abs(det) < 1e-12) return false;
  const r = subtract(p, a),
    u = dot(r, h) / det;
  if (u < -1e-10 || u > 1 + 1e-10) return false;
  const s = cross(r, ab),
    v = dot(direction, s) / det;
  if (v < -1e-10 || u + v > 1 + 1e-10) return false;
  const t = dot(ac, s) / det;
  return t >= -1e-10 && t <= 1 + 1e-10;
}

/** Minimum between complete triangles, including edge/face crossings between their vertices. */
export function triangleDistance2(a: [Point, Point, Point], b: [Point, Point, Point]): number {
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    const next = (i + 1) % 3;
    if (crossesTriangle(a[i]!, a[next]!, b) || crossesTriangle(b[i]!, b[next]!, a)) return 0;
    best = Math.min(best, pointDistance2(a[i]!, b), pointDistance2(b[i]!, a));
    for (let j = 0; j < 3; j++)
      best = Math.min(best, segmentDistance2(a[i]!, a[next]!, b[j]!, b[(j + 1) % 3]!));
  }
  return best;
}

function bounds(items: Array<{ low: Point; high: Point }>): { low: Point; high: Point } {
  return {
    low: [0, 1, 2].map((axis) => Math.min(...items.map((p) => p.low[axis]!))) as Point,
    high: [0, 1, 2].map((axis) => Math.max(...items.map((p) => p.high[axis]!))) as Point,
  };
}

function build(faces: Triangle[]): Node {
  const box = bounds(faces);
  if (faces.length <= 12) return { ...box, faces };
  const axis = [0, 1, 2].sort((a, b) => box.high[b]! - box.low[b]! - (box.high[a]! - box.low[a]!))[0]!;
  faces.sort((a, b) => a.low[axis]! + a.high[axis]! - b.low[axis]! - b.high[axis]!);
  const middle = faces.length >> 1;
  return { ...box, left: build(faces.slice(0, middle)), right: build(faces.slice(middle)) };
}

const boxDistance2 = (a: { low: Point; high: Point }, b: { low: Point; high: Point }) =>
  a.low.reduce((sum, v, axis) => sum + Math.max(v - b.high[axis]!, b.low[axis]! - a.high[axis]!, 0) ** 2, 0);

function triangles(positions: Float32Array, indices: Uint16Array, stencil: number[]): Triangle[] {
  const allowed = new Set(stencil),
    result: Triangle[] = [];
  for (let face = 0; face < indices.length / 3; face++) {
    const ids = [indices[3 * face]!, indices[3 * face + 1]!, indices[3 * face + 2]!];
    if (!ids.every((id) => allowed.has(id))) continue;
    const points = ids.map((id) => [positions[3 * id]!, positions[3 * id + 1]!, positions[3 * id + 2]!]) as [
      Point,
      Point,
      Point,
    ];
    result.push({
      points,
      face,
      low: [0, 1, 2].map((k) => Math.min(...points.map((p) => p[k]!))) as Point,
      high: [0, 1, 2].map((k) => Math.max(...points.map((p) => p[k]!))) as Point,
    });
  }
  return result;
}

export function clearance(
  arm: Triangle[],
  body: Triangle[],
): { minCm: number; armFace: number; bodyFace: number } {
  const root = build(body);
  let best = Infinity,
    armFace = -1,
    bodyFace = -1;
  for (const triangle of arm) {
    const visit = (node: Node) => {
      if (boxDistance2(triangle, node) >= best) return;
      if (node.faces)
        for (const other of node.faces) {
          if (boxDistance2(triangle, other) >= best) continue;
          const d = triangleDistance2(triangle.points, other.points);
          if (d < best) {
            best = d;
            armFace = triangle.face;
            bodyFace = other.face;
          }
        }
      else {
        const a = node.left!,
          b = node.right!;
        if (boxDistance2(triangle, a) < boxDistance2(triangle, b)) {
          visit(a);
          visit(b);
        } else {
          visit(b);
          visit(a);
        }
      }
    };
    visit(root);
    if (best === 0) break;
  }
  return { minCm: Math.sqrt(best), armFace, bodyFace };
}

const process = (
  globalThis as {
    process?: { getBuiltinModule?: (id: string) => unknown; env?: Record<string, string | undefined> };
  }
).process;
const get = process?.getBuiltinModule;
if (!get) throw new Error('arm clearance test needs Node');
const fs = get('node:fs') as { readFileSync(path: string): Uint8Array };
const zlib = get('node:zlib') as { gunzipSync(bytes: Uint8Array): Uint8Array };
const asset = decodeFigure(
  zlib.gunzipSync(fs.readFileSync(process?.env?.FIGURE_CLEARANCE_PACK ?? 'public/figure/figure-v2.bin')),
);
const scene = new FigureScene(asset);
const stencil = (asset.manifest as typeof asset.manifest & { armClearance?: ClearanceStencil }).armClearance;
const rows: Array<Record<string, unknown>> = [];
const shapes: Array<{ name: string; bmi: number; fat?: number; sliders?: BodyInputs['sliders'] }> = [
  { name: 'lean', bmi: 20, fat: 16 },
  { name: '75 percent belly stress', bmi: 28, fat: 75, sliders: { bellyVsHips: 1 } },
  { name: '75 percent hip stress', bmi: 28, fat: 75, sliders: { bellyVsHips: -1 } },
  { name: 'high fat', bmi: 38, fat: 45, sliders: { arms: 1, bellyVsHips: -1 } },
  { name: 'high muscle', bmi: 28, fat: 12, sliders: { muscularity: 1, muscleArms: 1, chest: 1 } },
  {
    name: 'combined',
    bmi: 40,
    fat: 35,
    sliders: { muscularity: 1, muscleArms: 1, arms: 1, chest: 1, bellyVsHips: -1 },
  },
  {
    name: 'maximum fat sliders',
    bmi: 50,
    sliders: { adiposity: 1, muscularity: 0.5, arms: 1, bellyVsHips: -1 },
  },
  {
    name: 'maximum combined sliders',
    bmi: 50,
    sliders: { adiposity: 1, muscularity: 1, muscleArms: 1, arms: 1, chest: 1, bellyVsHips: 1 },
  },
];
const cases = (['female', 'male'] as Sex[]).flatMap((sex) =>
  [0, 0.5, 1].flatMap((frame) =>
    [154, 178, 192].flatMap((heightCm) => shapes.map((shape) => ({ sex, frame, heightCm, shape }))),
  ),
);

describe('arm clearance geometry measurement', () => {
  it('detects a face crossing without any contained vertices', () => {
    expect(
      triangleDistance2(
        [
          [0, 0, 0],
          [3, 0, 0],
          [0, 3, 0],
        ],
        [
          [1, 1, -1],
          [1, 1, 1],
          [4, 4, 1],
        ],
      ),
    ).toBe(0);
  });
  it('measures separated parallel and coplanar triangles', () => {
    expect(
      triangleDistance2(
        [
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
        ],
        [
          [0, 0, 3],
          [1, 0, 3],
          [0, 1, 3],
        ],
      ),
    ).toBeCloseTo(9, 10);
    expect(
      triangleDistance2(
        [
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
        ],
        [
          [2, 0, 0],
          [3, 0, 0],
          [2, 1, 0],
        ],
      ),
    ).toBeCloseTo(1, 10);
  });
});

describe('source-weighted free arm skin stays separate from torso, hips and thighs', () => {
  it.each(cases)('$sex frame $frame at $heightCm cm, $shape.name', ({ sex, frame, heightCm, shape }) => {
    expect(stencil, 'bake must include source-weighted armClearance stencils').toBeDefined();
    const state = estimateInitialState(
      { sex, ageYears: 40, heightCm, weightKg: shape.bmi * (heightCm / 100) ** 2, sliders: shape.sliders },
      shape.fat === undefined ? {} : { bodyFatPctOverride: shape.fat },
    );
    const params = stateToAvatarParams(fatStressState(state, shape.fat ?? 0), { frame });
    const fit = scene.fit(params, frame);
    const positions = scene.place(fit.state, heightCm).positions;
    const body = triangles(positions, scene.model.indices, stencil!.centralBody);
    expect(body.length).toBeGreaterThan(1000);
    const results: Array<{ side: string; minCm: number; armFace: number; bodyFace: number }> = [];
    const scale = heightCm / Number(asset.manifest.stats.referenceHeightCm);
    for (const side of ['L', 'R'] as const) {
      const shoulder = asset.manifest.joints!.find((j) => j.id === `shoulder${side}`)!;
      const wrist = asset.manifest.joints!.find((j) => j.id === `wrist${side}`)!;
      const elbow = asset.manifest.joints!.find((j) => j.id === `elbow${side}`)!;
      const jointY = (joint: typeof shoulder) =>
        (joint.hipsLed[1] + frame * (joint.shouldersLed[1] - joint.hipsLed[1])) * scale;
      // The shoulder is a joined surface, not a gap. Check all triangles on the
      // free upper arm and forearm, with their full faces below that attachment.
      const arm = triangles(
        positions,
        scene.model.indices,
        side === 'L' ? stencil!.leftArm : stencil!.rightArm,
      ).filter(
        (face) => face.high[1] < jointY(shoulder) - 5 * scale && face.low[1] > jointY(wrist) - 2 * scale,
      );
      expect(arm.length, `${side} free arm triangle coverage`).toBeGreaterThan(100);
      const upperArmTriangles = arm.filter((face) => face.low[1] > jointY(elbow)).length;
      const forearmTriangles = arm.filter((face) => face.high[1] < jointY(elbow)).length;
      expect(upperArmTriangles, `${side} free upper arm coverage`).toBeGreaterThan(100);
      expect(forearmTriangles, `${side} forearm coverage`).toBeGreaterThan(100);
      const result = clearance(arm, body);
      rows.push({
        sex,
        frame,
        heightCm,
        shape: shape.name,
        side,
        armTriangles: arm.length,
        upperArmTriangles,
        forearmTriangles,
        bodyTriangles: body.length,
        ...result,
      });
      results.push({ side, ...result });
    }
    expect(
      Math.min(...results.map((r) => r.minCm)),
      `free arm clearance ${JSON.stringify(results)}`,
    ).toBeGreaterThan(0.15 * scale);
  });
});

afterAll(() => {
  if (process?.env?.FIGURE_CLEARANCE_REPORT === '1')
    console.log(JSON.stringify({ armAngleDeg: asset.manifest.model.armAngleDeg, cases: rows }));
});
