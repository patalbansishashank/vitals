import { estimateInitialState, stateToAvatarParams, type BodyInputs, type Sex } from '@/engine/body';
import { decodeAnatomy, type AnatomyAsset } from '../anatomyAsset';
import { anatomyJoints, placeAnatomy } from '../anatomyPose';
import { compositionFromParams } from '../composition';
import { FigureScene } from '../scene';
import { loadTestAsset } from './loadAsset';

interface NodeModules {
  fs: { readFileSync(path: string): Uint8Array };
  zlib: { gunzipSync(bytes: Uint8Array): Uint8Array };
}
const get = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process
  ?.getBuiltinModule;
if (!get) throw new Error('registration test needs Node');
const fs = get('node:fs') as NodeModules['fs'];
const zlib = get('node:zlib') as NodeModules['zlib'];
const anatomy = decodeAnatomy(zlib.gunzipSync(fs.readFileSync('public/figure/anatomy-v1.bin')));
const scene = new FigureScene(loadTestAsset());

type Point = [number, number, number];
type Part = AnatomyAsset['manifest']['source']['selected'][number];
const point = (positions: Float32Array, i: number): Point => [
  positions[3 * i]!,
  positions[3 * i + 1]!,
  positions[3 * i + 2]!,
];
const distance = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
const angleBetween = (a: Point, b: Point, c: Point, d: Point) => {
  const u = b.map((v, i) => v - a[i]!),
    v = d.map((x, i) => x - c[i]!);
  const dot = u.reduce((sum, x, i) => sum + x * v[i]!, 0);
  return (Math.acos(Math.max(-1, Math.min(1, dot / (Math.hypot(...u) * Math.hypot(...v))))) * 180) / Math.PI;
};

function endpoint(positions: Float32Array, part: Part, high: boolean): Point {
  const ids = Array.from({ length: part.vertexCount }, (_, i) => part.vertexStart + i);
  ids.sort((a, b) =>
    high ? positions[3 * b + 1]! - positions[3 * a + 1]! : positions[3 * a + 1]! - positions[3 * b + 1]!,
  );
  const count = Math.max(3, Math.floor(ids.length / 10));
  const out: Point = [0, 0, 0];
  for (const id of ids.slice(0, count))
    for (let axis = 0; axis < 3; axis++) out[axis] = out[axis]! + positions[3 * id + axis]! / count;
  return out;
}

/** Independent XY ray against the *actual* posed skin triangles, not the bake's surface binding. */
class SkinRay {
  private readonly cells = new Map<string, number[]>();
  constructor(
    private readonly positions: Float32Array,
    private readonly indices: Uint16Array,
  ) {
    for (let t = 0; t < indices.length; t += 3) {
      const a = point(positions, indices[t]!),
        b = point(positions, indices[t + 1]!),
        c = point(positions, indices[t + 2]!);
      const x0 = Math.floor(Math.min(a[0], b[0], c[0]) / 2),
        x1 = Math.floor(Math.max(a[0], b[0], c[0]) / 2);
      const y0 = Math.floor(Math.min(a[1], b[1], c[1]) / 2),
        y1 = Math.floor(Math.max(a[1], b[1], c[1]) / 2);
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++) {
          const key = `${x},${y}`;
          const faces = this.cells.get(key) ?? [];
          faces.push(t);
          this.cells.set(key, faces);
        }
    }
  }

  /** Positive distance beyond the front/back skin hull; Infinity if outside the XY silhouette. */
  breach(p: readonly number[]): number {
    let low = Infinity,
      high = -Infinity;
    const faces = this.cells.get(`${Math.floor(p[0]! / 2)},${Math.floor(p[1]! / 2)}`) ?? [];
    for (const t of faces) {
      const a = point(this.positions, this.indices[t]!),
        b = point(this.positions, this.indices[t + 1]!),
        c = point(this.positions, this.indices[t + 2]!);
      const det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      if (Math.abs(det) < 1e-10) continue;
      const u = ((b[1] - c[1]) * (p[0]! - c[0]) + (c[0] - b[0]) * (p[1]! - c[1])) / det;
      const v = ((c[1] - a[1]) * (p[0]! - c[0]) + (a[0] - c[0]) * (p[1]! - c[1])) / det;
      if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue;
      const z = u * a[2] + v * b[2] + (1 - u - v) * c[2];
      low = Math.min(low, z);
      high = Math.max(high, z);
    }
    if (!Number.isFinite(low)) return Infinity;
    return Math.max(0, low - p[2]!, p[2]! - high);
  }

  /** Accept a point very close to a side-facing triangle that a Z ray cannot cross. */
  withinSurfaceMargin(p: readonly number[], margin: number): boolean {
    const radius2 = margin * margin;
    const segmentDistance2 = (a: Point, b: Point) => {
      const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const len2 = d[0]! ** 2 + d[1]! ** 2 + d[2]! ** 2;
      const t =
        len2 > 0 ? Math.max(0, Math.min(1, d.reduce((sum, v, k) => sum + v * (p[k]! - a[k]!), 0) / len2)) : 0;
      return d.reduce((sum, v, k) => sum + (a[k]! + t * v - p[k]!) ** 2, 0);
    };
    for (let t = 0; t < this.indices.length; t += 3) {
      const a = point(this.positions, this.indices[t]!),
        b = point(this.positions, this.indices[t + 1]!),
        c = point(this.positions, this.indices[t + 2]!);
      let boxDistance2 = 0;
      for (let k = 0; k < 3; k++) {
        const lo = Math.min(a[k]!, b[k]!, c[k]!),
          hi = Math.max(a[k]!, b[k]!, c[k]!);
        boxDistance2 += Math.max(lo - p[k]!, 0, p[k]! - hi) ** 2;
      }
      if (boxDistance2 > radius2) continue;
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const w = [p[0]! - a[0], p[1]! - a[1], p[2]! - a[2]];
      const uu = u.reduce((sum, x) => sum + x * x, 0),
        uv = u.reduce((sum, x, k) => sum + x * v[k]!, 0),
        vv = v.reduce((sum, x) => sum + x * x, 0);
      const wu = w.reduce((sum, x, k) => sum + x * u[k]!, 0),
        wv = w.reduce((sum, x, k) => sum + x * v[k]!, 0);
      const det = uu * vv - uv * uv;
      if (det > 1e-12) {
        const s = (wu * vv - wv * uv) / det,
          q = (wv * uu - wu * uv) / det;
        if (s >= 0 && q >= 0 && s + q <= 1) {
          const d2 = w.reduce((sum, x, k) => sum + (x - s * u[k]! - q * v[k]!) ** 2, 0);
          if (d2 <= radius2) return true;
        }
      }
      if (Math.min(segmentDistance2(a, b), segmentDistance2(b, c), segmentDistance2(c, a)) <= radius2)
        return true;
    }
    return false;
  }
}

const cases: Array<[string, Sex, number, number, number, number | undefined, BodyInputs['sliders']?]> = [
  ['short and lean', 'female', 154, 49, 0, 18],
  ['neutral hips-led', 'female', 165, 65, 0, undefined],
  ['neutral shoulders-led', 'male', 178, 82, 1, undefined],
  ['tall and heavier', 'male', 192, 115, 1, 34],
  ['intermediate frame', 'female', 170, 76, 0.5, 29],
  ['arm muscle emphasis', 'male', 178, 82, 0.5, 22, { muscleArms: 1, muscleLegs: -1 }],
  ['leg muscle emphasis', 'female', 165, 65, 0.5, 25, { muscleArms: -1, muscleLegs: 1 }],
  [
    'BMI 50 hips-led with maximum combined sliders',
    'female',
    192,
    184.32,
    0,
    undefined,
    { adiposity: 1, muscularity: 1, muscleArms: 1, arms: 1, chest: 1, bellyVsHips: 1 },
  ],
  [
    'BMI 50 shoulders-led with maximum combined sliders',
    'male',
    192,
    184.32,
    1,
    undefined,
    { adiposity: 1, muscularity: 1, muscleArms: 1, arms: 1, chest: 1, bellyVsHips: 1 },
  ],
];

describe('baked anatomy registration against independently decoded skin geometry', () => {
  it.each(cases)(
    '%s keeps jointed anatomy in the fitted skin',
    (_name, sex, heightCm, weightKg, frame, bodyFatPct, sliders) => {
      expect(anatomy.manifest.registration?.method).toBe('joint-cage-v1');
      const state = estimateInitialState(
        { sex, ageYears: 40, heightCm, weightKg, sliders },
        bodyFatPct === undefined ? {} : { bodyFatPctOverride: bodyFatPct },
      );
      const params = stateToAvatarParams(state, { frame });
      const fit = scene.fit(params, frame);
      const skin = scene.place(fit.state, heightCm).positions;
      const composition = compositionFromParams(params, frame);
      const bones = placeAnatomy(anatomy, skin, heightCm, frame, composition);
      const joints = anatomyJoints(anatomy, skin, heightCm, frame);
      const names = anatomy.manifest.registration!.joints.map((j) => j.id);
      const joint = (id: string) => point(joints, names.indexOf(id));
      const part = (name: string) => anatomy.manifest.source.selected.find((p) => p.name === name)!;

      for (const side of ['Left', 'Right'] as const) {
        const letter = side === 'Left' ? 'L' : 'R';
        for (const [bone, proximal, distal] of [
          ['humerus', 'shoulder', 'elbow'],
          ['radius', 'elbow', 'wrist'],
          ['femur', 'hip', 'knee'],
          ['tibia', 'knee', 'ankle'],
        ] as const) {
          const p = part(`${side} ${bone}`);
          const upper = endpoint(bones, p, true),
            lower = endpoint(bones, p, false);
          const targetUpper = joint(`${proximal}${letter}`),
            targetLower = joint(`${distal}${letter}`);
          expect(distance(upper, targetUpper), `${side} ${bone} ${proximal}`).toBeLessThan(
            (4.5 * heightCm) / anatomy.heightCm,
          );
          expect(distance(lower, targetLower), `${side} ${bone} ${distal}`).toBeLessThan(
            (4.5 * heightCm) / anatomy.heightCm,
          );
          expect(
            angleBetween(upper, lower, targetUpper, targetLower),
            `${side} ${bone} 3D axis`,
          ).toBeLessThan(12);
        }
      }

      const ray = new SkinRay(skin, scene.model.indices);
      const selected = anatomy.manifest.source.selected;
      const footParts = selected.filter(
        (p) => p.kind === 'bone' && /\b(calcaneus|toe|metatarsal|distal phalanx.*foot)\b/i.test(p.name),
      );
      const footFloor = Math.min(
        ...footParts.flatMap((p) =>
          Array.from({ length: p.vertexCount }, (_, k) => bones[3 * (p.vertexStart + k) + 1]!),
        ),
      );
      expect(footFloor).toBeGreaterThan((-0.3 * heightCm) / anatomy.heightCm);
      expect(footFloor).toBeLessThan((3 * heightCm) / anatomy.heightCm);
      let checked = 0,
        outside = 0,
        maxFinite = 0,
        silhouetteMisses = 0;
      const byPart: Array<[string, number, number]> = [];
      const examples: Array<Record<string, unknown>> = [];
      for (const p of selected) {
        const step = 1;
        let partChecked = 0,
          partOutside = 0;
        for (let i = p.vertexStart; i < p.vertexStart + p.vertexCount; i += step) {
          const breach = ray.breach(point(bones, i));
          checked++;
          partChecked++;
          const margin = (0.1 * heightCm) / anatomy.heightCm;
          if (breach > margin && !ray.withinSurfaceMargin(point(bones, i), margin)) {
            outside++;
            partOutside++;
            if (examples.length < 8) {
              let low = margin,
                high = 8;
              for (let k = 0; k < 8; k++) {
                const mid = (low + high) / 2;
                if (ray.withinSurfaceMargin(point(bones, i), mid)) high = mid;
                else low = mid;
              }
              const reg = anatomy.manifest.registration!;
              const segment = reg.segments[anatomy.segments![i]!]!;
              const [a, b] = segment,
                t = anatomy.segmentT![i]! / 65535;
              const centre = [0, 1, 2].map(
                (axis) => joints[3 * a + axis]! * (1 - t) + joints[3 * b + axis]! * t,
              );
              const triangle = [0, 1, 2].map((k) => anatomy.surfaceIndices![3 * i + k]!);
              const w0 = anatomy.surfaceWeights![2 * i]! / 65535,
                w1 = anatomy.surfaceWeights![2 * i + 1]! / 65535;
              const weights = [w0, w1, 1 - w0 - w1];
              const boundary = [0, 1, 2].map((axis) =>
                triangle.reduce((sum, v, k) => sum + skin[3 * v + axis]! * weights[k]!, 0),
              );
              examples.push({
                part: p.name,
                vertex: i,
                source: point(anatomy.positions, i),
                placed: point(bones, i),
                nearestCm: +high.toFixed(2),
                segment: segment.map((v) => reg.joints[v]!.id),
                t: +t.toFixed(3),
                centre,
                centreRayBreach: ray.breach(centre),
                triangle,
                boundary,
                boundaryRayBreach: ray.breach(boundary),
              });
            }
          }
          if (!Number.isFinite(breach)) silhouetteMisses++;
          if (Number.isFinite(breach)) maxFinite = Math.max(maxFinite, breach);
        }
        byPart.push([p.name, partOutside, partChecked]);
      }
      const worst = byPart
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      expect(
        outside,
        `${outside}/${checked} anatomy vertices outside the skin (${silhouetteMisses} raw silhouette misses), max finite ray breach ${maxFinite.toFixed(2)}cm; worst ${JSON.stringify(worst)}; first ${JSON.stringify(examples)}`,
      ).toBe(0);
    },
  );
});
