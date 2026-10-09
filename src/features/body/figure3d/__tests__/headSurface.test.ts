import { liveEstimate, stateToAvatarParams } from '@/engine/body';
import { expandHead, type HeadSmoothing, type HeadStencil } from '../../../../../scripts/figure/lib/head';
import { decodeAnatomy } from '../anatomyAsset';
import { FigureFitter } from '../fit';
import { FigureModel, type MorphState } from '../model';
import { loadTestAsset } from './loadAsset';

/** Front/back intersections along a +z line. Shared edges count only once. */
function depths(P: Float32Array, indices: Uint16Array, x: number, y: number): number[] {
  const hits: number[] = [];
  for (let f = 0; f < indices.length; f += 3) {
    const a = 3 * indices[f]!,
      b = 3 * indices[f + 1]!,
      c = 3 * indices[f + 2]!;
    const ax = P[b]! - P[a]!,
      ay = P[b + 1]! - P[a + 1]!;
    const bx = P[c]! - P[a]!,
      by = P[c + 1]! - P[a + 1]!;
    const determinant = ax * by - ay * bx;
    if (Math.abs(determinant) < 1e-10) continue;
    const px = x - P[a]!,
      py = y - P[a + 1]!;
    const u = (px * by - py * bx) / determinant;
    const v = (ax * py - ay * px) / determinant;
    if (u < -1e-7 || v < -1e-7 || u + v > 1 + 1e-7) continue;
    hits.push(P[a + 2]! + u * (P[b + 2]! - P[a + 2]!) + v * (P[c + 2]! - P[a + 2]!));
  }
  hits.sort((a, b) => a - b);
  return hits.filter((z, i) => i === 0 || z - hits[i - 1]! > 1e-4);
}

function triangleArea(P: Float32Array, a: number, b: number, c: number): number {
  const u = [0, 1, 2].map((k) => P[3 * b + k]! - P[3 * a + k]!);
  const w = [0, 1, 2].map((k) => P[3 * c + k]! - P[3 * a + k]!);
  return (
    Math.hypot(u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!) /
    2
  );
}

function frontCosine(P: Float32Array, a: number, b: number, c: number): number {
  const ax = P[3 * b]! - P[3 * a]!,
    ay = P[3 * b + 1]! - P[3 * a + 1]!,
    az = P[3 * b + 2]! - P[3 * a + 2]!;
  const bx = P[3 * c]! - P[3 * a]!,
    by = P[3 * c + 1]! - P[3 * a + 1]!,
    bz = P[3 * c + 2]! - P[3 * a + 2]!;
  const nx = ay * bz - az * by,
    ny = az * bx - ax * bz,
    nz = ax * by - ay * bx;
  return nz / Math.hypot(nx, ny, nz);
}

const macroStates: MorphState[] = [];
for (const frame of [0, 0.5, 1])
  for (const muscle of [0, 0.5, 1])
    for (const weight of [0, 0.5, 1]) macroStates.push({ frame, muscle, weight, locals: {} });

describe('closed outer head skin', () => {
  const asset = loadTestAsset();
  const model = new FigureModel(asset);
  const surface = asset.manifest.headSurface!;

  function verify(state: MorphState) {
    const P = model.evaluate(state);
    for (const cap of surface.caps) {
      // The lids and lips nearly touch, so the zipped seam is a strip a fraction
      // of a millimetre wide. As a whole it faces outward (the mouth seam lies in
      // the groove between the lips, so less directly forward). Faces large enough
      // to see never face into the head (the upper lip's seam may face down);
      // sub-0.01 cm² slivers along the seam may tilt either way.
      let nz = 0,
        area = 0;
      for (let f = 0; f < cap.triangles.length; f += 3) {
        const [a, b, c] = [0, 1, 2].map((k) => cap.triangles[f + k]!) as [number, number, number];
        const size = triangleArea(P, a, b, c);
        nz += frontCosine(P, a, b, c) * size;
        area += size;
        if (size > 0.01) expect(frontCosine(P, a, b, c), `${cap.id} face ${f / 3}`).toBeGreaterThan(-0.2);
      }
      expect(nz / area, cap.id).toBeGreaterThan(0.2);
      // Probe the closure at 27 places. An inward pocket or retained oral
      // shell adds deeper crossings; a reversed cap fails the orientation checks.
      const faceCount = cap.triangles.length / 3;
      for (let sample = 0; sample < 27; sample++) {
        const f = 3 * Math.floor(((sample + 0.37) * faceCount) / 27);
        const vertices = cap.triangles.slice(f, f + 3);
        const centre = [0, 1, 2].map((axis) => vertices.reduce((sum, v) => sum + P[3 * v + axis]!, 0) / 3);
        const crossings = depths(P, asset.indices, centre[0]!, centre[1]!);
        // Only the back of the head and the face itself: lid and lip corners
        // may overhang by a fraction of a millimetre, a pocket would sit deeper.
        const inner = crossings.slice(1).filter((z) => z < centre[2]! - 0.3);
        expect(inner, `${cap.id} ${JSON.stringify(state)} sample ${sample}`).toEqual([]);
        expect(crossings.at(-1)! - centre[2]!).toBeLessThan(0.3);
      }
      // The seam lies between the lid or lip edges: it never dips into the head. Shut lids bulge gently past
      // their margins (a convex lid, not a hollow slit), by well under a millimetre.
      const rimBack = Math.min(...cap.rim.map((v) => P[3 * v + 2]!));
      const rimFront = Math.max(...cap.rim.map((v) => P[3 * v + 2]!));
      const eye = cap.id !== 'mouth';
      for (const v of cap.triangles) {
        expect(P[3 * v + 2]!).toBeGreaterThan(rimBack - 0.01);
        expect(P[3 * v + 2]!).toBeLessThan(rimFront + (eye ? 0.12 : 0.01));
      }
      if (eye) {
        // Convex: the seam stands in front of its lid margins on average (it sat level with them, a blank slit).
        const rim = new Set(cap.rim);
        const seam = [...new Set(cap.triangles)].filter((v) => !rim.has(v));
        const depth = (vs: number[]) => vs.reduce((sum, v) => sum + P[3 * v + 2]!, 0) / vs.length;
        expect(depth(seam) - depth(cap.rim), `${cap.id} lid bulge`).toBeGreaterThan(0.03);
      }
    }
  }

  it('records only skin repairs and excludes inner eye/oral asset labels', () => {
    expect(surface).toBeDefined();
    // Only the inward pockets behind the lid margins and lips are removed;
    // the eyelids and lips themselves stay.
    expect(surface.removedSourceTriangles).toBe(2244);
    expect(surface.caps.map((cap) => cap.id).sort()).toEqual(['leftEye', 'mouth', 'rightEye']);
    const labels = [...asset.manifest.source.files, ...asset.manifest.targets.map((t) => t.id)];
    expect(labels.filter((label) => /(?:eye|tongue|teeth|palate|headthroat)/i.test(label))).toEqual([]);
  });

  it('excludes internal head and throat atlas labels while retaining the external neck and skull', () => {
    const get = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process
      ?.getBuiltinModule;
    if (!get) throw new Error('needs Node');
    const fs = get('node:fs') as { readFileSync(path: string): Uint8Array };
    const zlib = get('node:zlib') as { gunzipSync(data: Uint8Array): Uint8Array };
    const anatomy = decodeAnatomy(zlib.gunzipSync(fs.readFileSync('public/figure/anatomy-v1.bin')));
    const labels = anatomy.manifest.source.selected.map((entry) => entry.name.toLowerCase());
    const excluded =
      /eye|eyelid|tongue|tooth|teeth|molar|premolar|incisor|canine|palate|palatine|platysma|geniohyoid|mylohyoid|longus capitis|longus colli|sternohyoid|thyrohyoid|omohyoid|stylohyoid|sternothyroid/;
    expect(labels.filter((label) => excluded.test(label))).toEqual([]);
    // Deep suboccipital muscles and the digastric stood up as a ragged crown on the neck in the muscle layer.
    expect(labels.filter((label) => /rectus capitis posterior|obliquus capitis|digastric/.test(label))).toEqual([]);
    for (const retained of [
      'sternocleidomastoid',
      'scalenus',
      'semispinalis capitis',
      'splenius capitis',
      'frontal bone',
      'mandible',
    ]) {
      expect(
        labels.some((label) => label.includes(retained)),
        retained,
      ).toBe(true);
    }
  });

  it('has exactly two oppositely oriented owners of every edge, including the cap rims', () => {
    const edges = new Map<number, { count: number; orientation: number }>();
    for (let f = 0; f < asset.indices.length; f += 3)
      for (let k = 0; k < 3; k++) {
        const a = asset.indices[f + k]!,
          b = asset.indices[f + ((k + 1) % 3)]!;
        const key = Math.min(a, b) * 65536 + Math.max(a, b);
        const entry = edges.get(key) ?? { count: 0, orientation: 0 };
        entry.count++;
        entry.orientation += a < b ? 1 : -1;
        edges.set(key, entry);
      }
    expect([...edges.values()].filter((edge) => edge.count !== 2 || edge.orientation !== 0)).toEqual([]);
    for (const cap of surface.caps)
      for (let f = 0; f < cap.faces.length; f++) {
        expect(Array.from(asset.indices.slice(3 * cap.faces[f]!, 3 * cap.faces[f]! + 3))).toEqual(
          cap.triangles.slice(3 * f, 3 * f + 3),
        );
      }
  });

  it('keeps outward, single-depth closures through all 27 frame/muscle/weight combinations', () => {
    expect(macroStates).toHaveLength(27);
    macroStates.forEach(verify);
  }, 30_000);

  it('keeps closures through fitted lean, heavy and measured-waist extremes', () => {
    const fitter = new FigureFitter(model);
    for (const sex of ['female', 'male'] as const)
      for (const [heightCm, bmi, waistCm] of [
        [150, 16, undefined],
        [200, 50, undefined],
        [175, 30, 55],
        [175, 30, 160],
      ] as const) {
        const params = stateToAvatarParams(
          liveEstimate({ sex, ageYears: 40, heightCm, weightKg: bmi * (heightCm / 100) ** 2, waistCm }),
        );
        const result = fitter.fit(params, params.figure.frame);
        expect(result.maxGirthErrorCm).toBeLessThan(1);
        verify(result.state);
      }
  }, 30_000);

  it('applies rim smoothing and synthetic stencils linearly to every target', () => {
    const smoothing: HeadSmoothing[] = [
      {
        vertex: 1,
        xy: [
          [0, 0.25],
          [1, 0.5],
          [2, 0.25],
        ],
        z: [
          [0, 0.25],
          [1, 0.5],
          [2, 0.25],
        ],
      },
    ];
    const stencils: HeadStencil[] = [
      {
        xy: [
          [0, 0.3],
          [1, 0.7],
        ],
        z: [
          [1, 0.4],
          [2, 0.6],
        ],
      },
    ];
    const base = Float64Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9);
    const target = Float64Array.of(-0.4, 0.2, 0.7, 0.9, -0.3, 0.5, 0.1, 0.8, -0.6);
    const composed = expandHead(
      base.map((x, i) => x + 0.73 * target[i]!),
      stencils,
      smoothing,
    );
    const expandedBase = expandHead(base, stencils, smoothing);
    const expandedTarget = expandHead(target, stencils, smoothing);
    composed.forEach((value, i) =>
      expect(value).toBeCloseTo(expandedBase[i]! + 0.73 * expandedTarget[i]!, 12),
    );
    expect(base).toEqual(Float64Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9));
    expect(() => expandHead(base, [{ xy: [[3, 1]], z: [[3, 1]] }])).toThrow('non-body vertex');
  });
});
