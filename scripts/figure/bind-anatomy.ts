// Finish the atlas bake by binding each posed vertex to its joint segment and
// the first surrounding skin triangle. Run after bake.ts and bake-anatomy.py.
import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import type { FigureJoint, FigureManifest } from '../../src/features/body/figure3d/manifest.ts';
import { Surface, type Hit, type Point } from '../../src/features/body/figure3d/surface.ts';

const root = new URL('./', import.meta.url);
const file = new URL('../../public/figure/anatomy-v1.bin', root);
const skin = JSON.parse(await readFile(new URL('.cache/skin-registration.json', root), 'utf8')) as {
  heightCm: number;
  joints: FigureJoint[];
  skin: { hipsLed: number[]; shouldersLed: number[]; indices: number[] };
};
const raw = gunzipSync(await readFile(file));
const length = raw.readUInt32LE(4);
const manifest = JSON.parse(raw.subarray(8, 8 + length).toString());
const count: number = manifest.vertexCount;
const start = (8 + length + 3) & ~3;
const indexBytes = manifest.triangleCount * 6;
const positionBytes = count * 6;
const geometryEnd = start + positionBytes + indexBytes + positionBytes;
if (raw.length !== geometryEnd) throw Error('Bind a freshly posed atlas (run bake-anatomy.py first)');
const pos = Array.from(
  { length: count },
  (_, i) =>
    [0, 1, 2].map((a) => raw.readInt16LE(start + 2 * (a * count + i)) * manifest.positionStepCm) as Point,
);
const geometry = Buffer.from(raw.subarray(start, geometryEnd));
const surface = new Surface(skin.skin.hipsLed, skin.skin.indices);
const shoulderSurface = new Surface(skin.skin.shouldersLed, skin.skin.indices);
// Arms hang close to the body, and the shared scene moves them apart where
// they crowd it. A trunk vertex bound across the armpit to arm skin (or an arm
// vertex bound to the flank) would then be dragged and torn. Bind trunk and
// arm parts to their own skin, from the rig weights baked with the skin. The
// torso keeps the partly arm-weighted armpit, so its rays do not fall through.
const figure = gunzipSync(await readFile(new URL('../../public/figure/figure-v2.bin', root)));
const armPose = (JSON.parse(figure.subarray(8, 8 + figure.readUInt32LE(4)).toString()) as FigureManifest).armPose!;
const armWeight = armPose.leftWeights.map((w, i) => Math.max(w, armPose.rightWeights[i]!));
if (armWeight.length !== skin.skin.hipsLed.length / 3) throw Error('Bake the skin and atlas from the same figure');
const skinWhere = (arm: boolean) => {
  const out: number[] = [];
  const I = skin.skin.indices;
  for (let f = 0; f < I.length; f += 3)
    if ((armWeight[I[f]!]! + armWeight[I[f + 1]!]! + armWeight[I[f + 2]!]!) / 3 >= (arm ? 0.5 : 0.8) === arm)
      out.push(I[f]!, I[f + 1]!, I[f + 2]!);
  return new Surface(skin.skin.hipsLed, out);
};
const torsoSkin = skinWhere(false),
  armSkin = skinWhere(true);
// The shoulder blade, collarbone and rotator cuff ride on the thorax (as posed in atlas_pose.py).
const ON_THORAX = /scapula|clavicle|subscapularis|infraspinatus|supraspinatus|teres major|teres minor/i;
const joints = skin.joints;
// The rig's root follows the sacrum, near the back wall. A trunk cage needs
// the interior centre of each section, including the curve of the lower back.
const trunkIds: string[] = [];
for (let y = 84; y <= 144; y += 6) {
  const id = `trunk${y}`;
  const centre = (mesh: Surface): Point | null => {
    const back = mesh.ray([0, y, -100], [0, 0, 1]);
    const front = mesh.ray([0, y, 100], [0, 0, -1]);
    if (!back || !front) return null;
    return [0, y, (-100 + back.distance + 100 - front.distance) / 2];
  };
  const hipsLed = centre(surface),
    shouldersLed = centre(shoulderSurface);
  if (hipsLed && shouldersLed) {
    joints.push({ id, hipsLed, shouldersLed });
    trunkIds.push(id);
  }
}
const jointIndex = new Map(joints.map((j, i) => [j.id, i]));
const segments: [number, number][] = [];
const regions: Record<string, number[]> = { head: [], trunk: [], arms: [], legs: [] };
const add = (region: string, a: string, b: string) => {
  if (!jointIndex.has(a) || !jointIndex.has(b)) return;
  regions[region]!.push(segments.length);
  segments.push([jointIndex.get(a)!, jointIndex.get(b)!]);
};
for (let i = 0; i < trunkIds.length - 1; i++) add('trunk', trunkIds[i]!, trunkIds[i + 1]!);
add('head', 'neck', 'head');
add('head', 'head', 'head');
for (const side of ['L', 'R']) {
  add('arms', `shoulder${side}`, `elbow${side}`);
  add('arms', `elbow${side}`, `wrist${side}`);
  add('legs', `hip${side}`, `knee${side}`);
  add('legs', `knee${side}`, `ankle${side}`);
  add('legs', `ankle${side}`, `foot${side}`);
  for (let finger = 1; finger <= 5; finger++) {
    add('arms', `wrist${side}`, `finger${finger}-1${side}`);
    add('legs', `foot${side}`, `toe${finger}-1${side}`);
    for (let phalanx = 1; phalanx <= 3; phalanx++) {
      add(
        'arms',
        `finger${finger}-${phalanx}${side}`,
        `finger${finger}-${phalanx === 3 ? 'tip' : phalanx + 1}${side}`,
      );
      add(
        'legs',
        `toe${finger}-${phalanx}${side}`,
        `toe${finger}-${phalanx === (finger === 1 ? 2 : 3) ? 'tip' : phalanx + 1}${side}`,
      );
    }
  }
}
if (segments.length > 255) throw Error('Too many joint segments');

const sample = (positions: number[], hit: Hit): Point =>
  [0, 1, 2].map((a) =>
    hit.indices.reduce((sum, id, k) => sum + positions[3 * id + a]! * hit.weights[k]!, 0),
  ) as Point;
const jointBindings = joints.map((joint) => {
  if (joint.skinVertices?.length) {
    const indices = joint.skinVertices;
    const weights = indices.map(() => 1 / indices.length);
    return { indices, weights, hipsLed: joint.hipsLed, shouldersLed: joint.shouldersLed };
  }
  const hits: Hit[] = [];
  for (let axis = 0; axis < 3; axis++)
    for (const sign of [-1, 1]) {
      const direction: Point = [0, 0, 0];
      direction[axis] = sign;
      const hit = surface.ray(joint.hipsLed, direction);
      const maxDistance = /^(wrist|ankle|foot)/.test(joint.id) ? 8 : 35;
      if (hit && hit.distance < maxDistance) hits.push(hit);
    }
  if (!hits.length) throw Error(`No skin cage around ${joint.id}`);
  const indices = hits.flatMap((h) => h.indices);
  const weights = hits.flatMap((h) => h.weights.map((w) => w / hits.length));
  const average = (P: number[]): Point =>
    [0, 1, 2].map((a) => indices.reduce((sum, id, k) => sum + P[3 * id + a]! * weights[k]!, 0)) as Point;
  return {
    indices,
    weights,
    hipsLed: average(skin.skin.hipsLed),
    shouldersLed: average(skin.skin.shouldersLed),
  };
});

const surfaceIndices = Buffer.alloc(count * 6),
  surfaceWeights = Buffer.alloc(count * 4),
  segmentIds = Buffer.alloc(count),
  segmentT = Buffer.alloc(count * 2);
interface Bound {
  segment: number;
  t: number;
  centre: Point;
  direction: Point;
  radius: number;
  extent: number;
  margin: number;
  hit: Hit;
}
// Soft tissue kept between each layer's outer surface and the rest skin, in cm:
// scalp and face over the skull, then thinner layers over limb bones and muscles.
const MARGIN = { headBone: 0.45, bone: 0.3, muscle: 0.22 };
const nearest = (point: Point, candidates: number[]) => {
  let best = Infinity,
    chosen = candidates[0]!,
    chosenT = 0.5,
    centre: Point = [0, 0, 0];
  for (const candidate of candidates) {
    const [a, b] = segments[candidate]!,
      A = joints[a]!.hipsLed,
      B = joints[b]!.hipsLed;
    const d = B.map((v, k) => v - A[k]!);
    const d2 = d.reduce((sum, v) => sum + v * v, 0);
    const t =
      d2 > 1e-6
        ? Math.max(0.04, Math.min(0.96, d.reduce((sum, v, k) => sum + v * (point[k]! - A[k]!), 0) / d2))
        : 0.5;
    const C = A.map((v, k) => v + t * d[k]!) as Point;
    const dist = C.reduce((sum, v, k) => sum + (point[k]! - v) ** 2, 0);
    if (dist < best) {
      best = dist;
      chosen = candidate;
      chosenT = t;
      centre = C;
    }
  }
  return { segment: chosen, t: chosenT, centre, distance: best };
};
const bound: Bound[] = new Array(count);
for (const part of manifest.source.selected) {
  const thorax = part.region === 'arms' && ON_THORAX.test(part.name);
  let candidates = regions[thorax ? 'trunk' : part.region]!;
  const own = thorax || part.region === 'trunk' || part.region === 'head' ? torsoSkin : part.region === 'arms' ? armSkin : surface;
  const side = /\bleft\b/i.test(part.name) ? 'L' : /\bright\b/i.test(part.name) ? 'R' : null;
  if (side && !thorax && (part.region === 'arms' || part.region === 'legs'))
    candidates = candidates.filter((i) => joints[segments[i]![0]]!.id.endsWith(side));
  if (side && /pisiform|scaphoid|capitate|lunate|triquetral|trapezium|trapezoid|hamate/i.test(part.name))
    candidates = candidates.filter(
      (i) =>
        joints[segments[i]![0]]!.id === `wrist${side}` && joints[segments[i]![1]]!.id === `finger3-1${side}`,
    );
  if (side && /phalanx|metacarpal|metatarsal/i.test(part.name)) {
    const hand = part.region === 'arms';
    const labels = hand
      ? ['thumb', 'index finger', 'middle finger', 'ring finger', 'little finger']
      : ['big toe', 'second toe', 'third toe', 'fourth toe', 'little toe'];
    const ordinals = ['first', 'second', 'third', 'fourth', 'fifth'];
    let digit = labels.findIndex((label) => part.name.toLowerCase().includes(label)) + 1;
    if (!digit) digit = ordinals.findIndex((label) => part.name.toLowerCase().includes(label)) + 1;
    if (digit)
      candidates = candidates.filter((i) => {
        const [a, b] = segments[i]!;
        return (
          joints[a]!.id.startsWith(`${hand ? 'finger' : 'toe'}${digit}-`) ||
          joints[b]!.id === `${hand ? 'finger' : 'toe'}${digit}-1${side}`
        );
      });
  }
  // Skull bones share one rigid frame about the head joint (see atlas_pose.py).
  if (
    part.kind === 'bone' &&
    part.region === 'head' &&
    !/vertebra|intervertebral|\brib\b|axis|atlas/i.test(part.name)
  )
    candidates = candidates.filter((i) => segments[i]![0] === segments[i]![1]);
  const range = Array.from({ length: part.vertexCount }, (_, k) => part.vertexStart + k);
  // A bone is rigid: all of it follows one joint segment, so a fitted joint
  // bends the skeleton between bones rather than tearing a bone across its end.
  let partSegment: number[] | null = null;
  if (part.kind === 'bone') {
    const totals = new Map<number, number>();
    for (const i of range)
      for (const candidate of candidates)
        totals.set(candidate, (totals.get(candidate) ?? 0) + nearest(pos[i]!, [candidate]).distance);
    partSegment = [[...totals].sort((x, y) => x[1] - y[1])[0]![0]];
  }
  const margin =
    part.kind === 'muscle' ? MARGIN.muscle : part.region === 'head' ? MARGIN.headBone : MARGIN.bone;
  for (const i of range) {
    const point = pos[i]!;
    // Upper gluteal tissue wraps the pelvis; its cage centre belongs to that
    // horizontal body section, rather than the start of the thigh shaft.
    const localCandidates =
      partSegment ?? (/gluteus/i.test(part.name) && point[1] >= 84 ? regions.trunk! : candidates);
    const near = nearest(point, localCandidates);
    const chosen = near.segment;
    let { t: chosenT, centre } = near;
    const radial = point.map((v, k) => v - centre[k]!) as Point;
    const radius = Math.hypot(...radial);
    let direction = radial.map((v) => v / (radius || 1)) as Point;
    let hit = own.ray(centre, direction) ?? surface.ray(centre, direction);
    if (!hit) {
      // A helper at a finger/toe tip may sit just beyond its visible surface.
      // Retry from the segment's inner half, then bind the local surface.
      const [a, b] = segments[chosen]!;
      chosenT = 0.5;
      centre = joints[a]!.hipsLed.map((v, k) => (v + joints[b]!.hipsLed[k]!) / 2) as Point;
      const d = point.map((v, k) => v - centre[k]!);
      const l = Math.hypot(...d);
      direction = d.map((v) => v / (l || 1)) as Point;
      hit = own.ray(centre, direction) ?? surface.ray(centre, direction);
    }
    if (!hit) throw Error(`Skin cage does not enclose ${part.name} vertex ${i}`);
    const r = Math.hypot(...point.map((v, k) => v - centre[k]!));
    bound[i] = {
      segment: chosen,
      t: chosenT,
      centre,
      direction,
      radius: r,
      extent: hit.distance,
      margin,
      hit,
    };
  }
}

// Envelope fit: where the reference atlas is wider than this skin, scale the
// whole section toward its joint axis, so its outer layer keeps a soft-tissue
// margin under the skin. Scaling sections (bins along and around each segment,
// bilinearly blended) keeps layers nested and shapes intact, rather than
// flattening only the vertices that reach the skin.
const ANGLES = 12;
const binsOf = (segment: number) => {
  const [a, b] = segments[segment]!;
  const A = joints[a]!.hipsLed,
    B = joints[b]!.hipsLed;
  const axis = B.map((v, k) => v - A[k]!) as Point;
  const length = Math.hypot(...axis);
  if (length < 1e-3) return { along: 6, axis: null, u: null, v: null };
  const n = axis.map((v) => v / length) as Point;
  const ref: Point = Math.abs(n[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  const u0: Point = [
    n[1] * ref[2] - n[2] * ref[1],
    n[2] * ref[0] - n[0] * ref[2],
    n[0] * ref[1] - n[1] * ref[0],
  ];
  const ul = Math.hypot(...u0);
  const u = u0.map((x) => x / ul) as Point;
  const v: Point = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  return { along: Math.max(1, Math.round(length / 2.5)), axis: n, u, v };
};
const frames = segments.map((_, i) => binsOf(i));
// Continuous bin coordinates: along the segment (or elevation for a point
// joint such as the head) and around it.
const coords = (x: Bound): [number, number] => {
  const f = frames[x.segment]!;
  const d = x.direction;
  if (!f.axis) {
    const elevation = Math.asin(Math.max(-1, Math.min(1, d[1])));
    return [
      ((elevation + Math.PI / 2) / Math.PI) * f.along,
      ((Math.atan2(d[0], d[2]) + Math.PI) / (2 * Math.PI)) * ANGLES,
    ];
  }
  const angle = Math.atan2(
    d.reduce((sum, c, k) => sum + c * f.v![k]!, 0),
    d.reduce((sum, c, k) => sum + c * f.u![k]!, 0),
  );
  return [x.t * f.along, ((angle + Math.PI) / (2 * Math.PI)) * ANGLES];
};
const need = new Map<string, number[]>();
for (let i = 0; i < count; i++) {
  const x = bound[i]!;
  const [s, a] = coords(x);
  const key = `${x.segment}:${Math.min(frames[x.segment]!.along - 1, Math.floor(s))}:${Math.floor(a) % ANGLES}`;
  const room = Math.max(0.05, x.extent - x.margin);
  (need.get(key) ?? need.set(key, []).get(key)!).push(x.radius / room);
}
const shrink = new Map<string, number>();
for (const [key, ratios] of need) {
  ratios.sort((p, q) => p - q);
  // The few outliers beyond the 97th percentile meet the guard below instead.
  const ratio = ratios[Math.min(ratios.length - 1, Math.floor(ratios.length * 0.97))]!;
  shrink.set(key, Math.max(0.65, Math.min(1, 1 / ratio)));
}
const factor = (x: Bound): number => {
  const f = frames[x.segment]!;
  const [s, a] = coords(x);
  const s0 = Math.floor(s - 0.5),
    a0 = Math.floor(a - 0.5);
  const fs = s - 0.5 - s0,
    fa = a - 0.5 - a0;
  let sum = 0,
    weight = 0;
  for (const [ds, ws] of [
    [0, 1 - fs],
    [1, fs],
  ] as const)
    for (const [da, wa] of [
      [0, 1 - fa],
      [1, fa],
    ] as const) {
      const si = Math.max(0, Math.min(f.along - 1, s0 + ds));
      const k = shrink.get(`${x.segment}:${si}:${(((a0 + da) % ANGLES) + ANGLES) % ANGLES}`);
      if (k === undefined) continue;
      sum += k * ws * wa;
      weight += ws * wa;
    }
  return weight > 0 ? sum / weight : 1;
};

let inset = 0,
  scaled = 0;
for (let i = 0; i < count; i++) {
  const { segment: chosen, t: chosenT, hit } = bound[i]!;
  hit.indices.forEach((id, k) => surfaceIndices.writeUInt16LE(id, i * 6 + k * 2));
  const w0 = Math.max(0, Math.min(65535, Math.round(hit.weights[0] * 65535)));
  const w1 = Math.max(0, Math.min(65535 - w0, Math.round(hit.weights[1] * 65535)));
  surfaceWeights.writeUInt16LE(w0, i * 4);
  surfaceWeights.writeUInt16LE(w1, i * 4 + 2);
  segmentIds[i] = chosen;
  segmentT.writeUInt16LE(Math.round(chosenT * 65535), i * 2);
  const k = factor(bound[i]!);
  if (k < 0.999) scaled++;
  // Cap both rest-pose endpoints in the bake itself. The runtime cage then
  // preserves this pose while responding to the fitted skin's shape changes.
  const [a, b] = segments[chosen]!;
  const posed: Point[] = [];
  let capped = false;
  for (const end of ['hipsLed', 'shouldersLed'] as const) {
    const C = joints[a]![end].map((v, k) => v * (1 - chosenT) + joints[b]![end][k]! * chosenT) as Point;
    const S = sample(skin.skin[end], hit);
    const original = pos[i]!.map(
      (v, k) =>
        v +
        (end === 'shouldersLed'
          ? raw.readInt16LE(start + positionBytes + indexBytes + 2 * (k * count + i)) *
            manifest.registration.frameDeltaStepCm
          : 0),
    );
    const r = Math.hypot(...original.map((v, k) => v - C[k]!)) * k;
    const length = Math.hypot(...S.map((v, k) => v - C[k]!));
    const first =
      length > 1e-6
        ? (end === 'hipsLed' ? surface : shoulderSurface).ray(
            C,
            S.map((v, k) => (v - C[k]!) / length),
          )
        : null;
    const extent = Math.min(length, first?.distance ?? length);
    const margin = Math.min(0.18, extent * 0.12);
    const f = length > 1e-6 ? Math.min(r, Math.max(0, extent - margin)) / length : 0;
    if (r > extent - margin) capped = true;
    posed.push(C.map((v, k) => v + (S[k]! - v) * f) as Point);
  }
  if (capped) inset++;
  for (let axis = 0; axis < 3; axis++) {
    geometry.writeInt16LE(Math.round(posed[0]![axis]! / manifest.positionStepCm), 2 * (axis * count + i));
    geometry.writeInt16LE(
      Math.round((posed[1]![axis]! - posed[0]![axis]!) / manifest.registration.frameDeltaStepCm),
      positionBytes + indexBytes + 2 * (axis * count + i),
    );
  }
}
manifest.registration = {
  ...manifest.registration,
  method: 'joint-cage-v1',
  joints,
  segments,
  jointBindings,
  surfaceCage: true,
  minInsetCm: 0.18,
  skinIndices: skin.skin.indices,
};
const json = Buffer.from(JSON.stringify(manifest));
const header = Buffer.alloc((8 + json.length + 3) & ~3);
header.write('ANAT');
header.writeUInt32LE(json.length, 4);
json.copy(header, 8);
const packed = Buffer.concat([header, geometry, surfaceIndices, surfaceWeights, segmentIds, segmentT]);
const compressed = gzipSync(packed, { level: 9 });
await writeFile(file, compressed);
const reportFile = new URL('anatomy-bake-report.json', root);
const report = JSON.parse(await readFile(reportFile, 'utf8'));
const { jointBindings: _bindings, skinIndices: _topology, ...registrationSummary } = manifest.registration;
Object.assign(report, {
  rawBytes: packed.length,
  gzipBytes: compressed.length,
  sha256: createHash('sha256').update(compressed).digest('hex'),
  registration: {
    ...registrationSummary,
    jointBindingCount: jointBindings.length,
    skinTriangleCount: skin.skin.indices.length / 3,
  },
  cage: { vertices: count, envelopeScaledVertices: scaled, surfaceInsetVertices: inset, missingRays: 0 },
});
await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify({
    vertices: count,
    envelopeScaledVertices: scaled,
    surfaceInsetVertices: inset,
    missingRays: 0,
    gzipBytes: compressed.length,
  }),
);
