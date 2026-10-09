// The bake binds the atlas to one joint pose and the surrounding skin triangles.
// Fit changes update this geometry once; rotating any mount only changes the camera.
import type { AnatomyAsset } from './anatomyAsset';
import type { BodyComposition } from './composition';
import { Surface } from './surface';

const surfaces = new WeakMap<Float32Array, Surface>();
const UNDER_FAT_FLOOR = 0.6;

function surfaceOf(positions: Float32Array, indices: ArrayLike<number>): Surface {
  let surface = surfaces.get(positions);
  if (surface) surface.refit();
  else {
    surface = new Surface(positions, indices);
    surfaces.set(positions, surface);
  }
  return surface;
}

interface PlacementBinding {
  jointOffsets: Uint16Array;
  surfaceOffsets: Uint32Array;
  t: Float64Array;
  u: Float64Array;
  weights: Float64Array;
  referenceCentres: Float64Array;
  referenceDeltas: Float64Array;
  muscleRegions: Int8Array;
  belly: Float64Array;
  growth: Float32Array;
  /** Under the fat: neighbours along the atlas mesh (built on first use) and the push each vertex takes. */
  start?: Uint32Array;
  list?: Uint32Array;
  push: Float64Array;
  eased: Float64Array;
}

const bindings = new WeakMap<AnatomyAsset, PlacementBinding>();

function placementBinding(asset: AnatomyAsset): PlacementBinding {
  const previous = bindings.get(asset);
  if (previous) return previous;
  const count = asset.manifest.vertexCount;
  const registration = asset.manifest.registration!;
  const binding: PlacementBinding = {
    jointOffsets: new Uint16Array(count * 2),
    surfaceOffsets: new Uint32Array(count * 3),
    t: new Float64Array(count),
    u: new Float64Array(count),
    weights: new Float64Array(count * 3),
    referenceCentres: new Float64Array(count * 3),
    referenceDeltas: new Float64Array(count * 3),
    muscleRegions: new Int8Array(count).fill(-1),
    belly: new Float64Array(count),
    growth: new Float32Array(3),
    push: new Float64Array(count * 3),
    eased: new Float64Array(count * 3),
  };
  for (const part of asset.manifest.source.selected) {
    if (part.kind !== 'muscle') continue;
    const region = part.region === 'arms' ? 1 : part.region === 'legs' ? 2 : 0;
    binding.muscleRegions.fill(region, part.vertexStart, part.vertexStart + part.vertexCount);
  }
  for (let i = 0; i < count; i++) {
    const [a, b] = registration.segments[asset.segments![i]!]!;
    const ja = registration.joints[a]!,
      jb = registration.joints[b]!;
    const t = asset.segmentT![i]! / 65535,
      u = 1 - t;
    binding.jointOffsets[2 * i] = 3 * a;
    binding.jointOffsets[2 * i + 1] = 3 * b;
    binding.t[i] = t;
    binding.u[i] = u;
    binding.belly[i] = Math.sin(Math.PI * t) ** 2;
    const w0 = asset.surfaceWeights![2 * i]! / 65535;
    const w1 = asset.surfaceWeights![2 * i + 1]! / 65535;
    binding.weights[3 * i] = w0;
    binding.weights[3 * i + 1] = w1;
    binding.weights[3 * i + 2] = 1 - w0 - w1;
    for (let axis = 0; axis < 3; axis++) {
      binding.surfaceOffsets[3 * i + axis] = 3 * asset.surfaceIndices![3 * i + axis]!;
      // Keep the original operation order and double precision: changing the
      // grouping here can alter the final Float32 coordinates near a skin cap.
      binding.referenceCentres[3 * i + axis] = ja.hipsLed[axis]! * u + jb.hipsLed[axis]! * t;
      binding.referenceDeltas[3 * i + axis] =
        (ja.shouldersLed[axis]! - ja.hipsLed[axis]!) * u + (jb.shouldersLed[axis]! - jb.hipsLed[axis]!) * t;
    }
  }
  bindings.set(asset, binding);
  return binding;
}

export function anatomyJoints(
  asset: AnatomyAsset,
  skin: Float32Array,
  heightCm: number,
  frame: number,
): Float32Array {
  const registration = asset.manifest.registration;
  if (!registration) return new Float32Array();
  const scale = heightCm / asset.heightCm;
  const out = new Float32Array(registration.joints.length * 3);
  registration.joints.forEach((joint, i) => {
    const binding = registration.jointBindings[i]!;
    for (let axis = 0; axis < 3; axis++) {
      let surface = 0;
      for (let k = 0; k < binding.indices.length; k++)
        surface += skin[3 * binding.indices[k]! + axis]! * binding.weights[k]!;
      const reference =
        (binding.hipsLed[axis]! + frame * (binding.shouldersLed[axis]! - binding.hipsLed[axis]!)) * scale;
      out[3 * i + axis] =
        (joint.hipsLed[axis]! + frame * (joint.shouldersLed[axis]! - joint.hipsLed[axis]!)) * scale +
        surface -
        reference;
    }
  });
  return out;
}

/**
 * Neighbouring vertices meet different limits under the fat (another skin triangle, another chord), and pushed by
 * their own amounts they moved apart by up to 8 cm: strands and holes in a heavy belly. Average the push over each
 * part's mesh so neighbours move together; where that leaves a vertex short of its limit, the fat layer gives way
 * instead (fatRoom, clampFatToAnatomy).
 */
function easePush(asset: AnatomyAsset, binding: PlacementBinding, out: Float32Array) {
  const count = asset.manifest.vertexCount;
  if (!binding.start) {
    const sets = Array.from({ length: count }, () => new Set<number>());
    for (let f = 0; f < asset.indices.length; f += 3)
      for (let k = 0; k < 3; k++) {
        const a = asset.indices[f + k]!,
          b = asset.indices[f + ((k + 1) % 3)]!;
        sets[a]!.add(b);
        sets[b]!.add(a);
      }
    binding.start = new Uint32Array(count + 1);
    for (let i = 0; i < count; i++) binding.start[i + 1] = binding.start[i]! + sets[i]!.size;
    binding.list = new Uint32Array(binding.start[count]!);
    sets.forEach((set, i) => binding.list!.set([...set].sort((x, y) => x - y), binding.start![i]!));
  }
  const start = binding.start,
    list = binding.list!;
  let from = binding.push,
    to = binding.eased;
  for (let pass = 0; pass < PUSH_PASSES; pass++) {
    for (let i = 0; i < count; i++) {
      const n = start[i + 1]! - start[i]!;
      for (let axis = 0; axis < 3; axis++) {
        let sum = from[3 * i + axis]!;
        for (let j = start[i]!; j < start[i + 1]!; j++) sum += from[3 * list[j]! + axis]!;
        to[3 * i + axis] = sum / (n + 1);
      }
    }
    [from, to] = [to, from];
  }
  for (let i = 0; i < out.length; i++) out[i] = out[i]! + from[i]!;
}
const PUSH_PASSES = 5;

/**
 * Place bones and muscles inside the fitted skin, sharing its joint motion and floor. With `inner` (the inner boundary
 * of the fat under the skin, on the skin's topology) they also stay under the fat, by the same inset.
 */
export function placeAnatomy(
  asset: AnatomyAsset,
  skin: Float32Array,
  heightCm: number,
  frame: number,
  composition: BodyComposition,
  inner?: Float32Array | null,
  out: Float32Array = new Float32Array(asset.positions.length),
): Float32Array {
  const registration = asset.manifest.registration;
  const scale = heightCm / asset.heightCm;
  const f = Math.max(0, Math.min(1, frame));
  if (
    !registration?.surfaceCage ||
    !asset.frameDeltas ||
    !asset.surfaceIndices ||
    !asset.surfaceWeights ||
    !asset.segments ||
    !asset.segmentT
  ) {
    for (let i = 0; i < out.length; i++) out[i] = asset.positions[i]! * scale;
    return out;
  }
  const joints = anatomyJoints(asset, skin, heightCm, f);
  const binding = placementBinding(asset);
  const surface = surfaceOf(skin, registration.skinIndices);
  const fat = inner ? surfaceOf(inner, registration.skinIndices) : null;
  const minInset = registration.minInsetCm * scale;
  const growth = binding.growth;
  for (const [region, name] of ['trunk', 'arms', 'legs'].entries()) {
    growth[region] = Math.max(
      0.83,
      Math.min(1.26, composition.muscle[name as 'trunk' | 'arms' | 'legs'].transverseScale),
    );
  }
  const centre = [0, 0, 0],
    boundary = [0, 0, 0],
    direction = [0, 0, 0];
  for (let i = 0; i < asset.manifest.vertexCount; i++) {
    const a = binding.jointOffsets[2 * i]!,
      b = binding.jointOffsets[2 * i + 1]!;
    const t = binding.t[i]!,
      u = binding.u[i]!;
    const w0 = binding.weights[3 * i]!,
      w1 = binding.weights[3 * i + 1]!,
      w2 = binding.weights[3 * i + 2]!;
    const s0 = binding.surfaceOffsets[3 * i]!,
      s1 = binding.surfaceOffsets[3 * i + 1]!,
      s2 = binding.surfaceOffsets[3 * i + 2]!;
    let radius2 = 0,
      boundary2 = 0;
    for (let axis = 0; axis < 3; axis++) {
      centre[axis] = joints[a + axis]! * u + joints[b + axis]! * t;
      const referenceCentre =
        binding.referenceCentres[3 * i + axis]! + f * binding.referenceDeltas[3 * i + axis]!;
      const radial =
        (asset.positions[3 * i + axis]! + f * asset.frameDeltas[3 * i + axis]! - referenceCentre) * scale;
      radius2 += radial * radial;
      boundary[axis] = skin[s0 + axis]! * w0 + skin[s1 + axis]! * w1 + skin[s2 + axis]! * w2 - centre[axis]!;
      boundary2 += boundary[axis]! ** 2;
    }
    const boundaryLength = Math.sqrt(boundary2);
    // Muscle attachments stay at the joint; growth is strongest in each belly.
    const region = binding.muscleRegions[i]!;
    const q = region >= 0 ? 1 + (growth[region]! - 1) * binding.belly[i]! : 1;
    const radius = Math.sqrt(radius2) * q;
    // A chord to the bound triangle may leave a concave shoulder or hip before
    // reaching it. Use the first actual skin intersection along that direction.
    for (let axis = 0; axis < 3; axis++) direction[axis] = boundary[axis]! / (boundaryLength || 1);
    const first =
      boundaryLength > 1e-6 ? surface.distance(centre, direction, Math.min(boundaryLength, radius + minInset)) : null;
    const extent = Math.min(boundaryLength, first ?? boundaryLength);
    const inset = Math.min(minInset, extent * 0.12);
    let limit = extent - inset;
    if (fat && boundaryLength > 1e-6) {
      // Under the fat: below its inner boundary at the bound skin point (depth measured along this chord) and below
      // the first place the chord leaves it. A section squeezes to at most UNDER_FAT_FLOOR of its radius; where the
      // fat is deeper still, the fat layer gives way instead (fatRoom).
      let depth2 = 0,
        along = 0;
      for (let axis = 0; axis < 3; axis++) {
        const m =
          (skin[s0 + axis]! - inner![s0 + axis]!) * w0 +
          (skin[s1 + axis]! - inner![s1 + axis]!) * w1 +
          (skin[s2 + axis]! - inner![s2 + axis]!) * w2;
        depth2 += m * m;
        along += m * direction[axis]!;
      }
      const depth = Math.sqrt(depth2);
      let under = depth > 1e-6 ? boundaryLength - depth / Math.max(along / depth, 0.5) - minInset : limit;
      const exit = fat.distance(centre, direction, Math.min(extent, radius + minInset), true);
      if (exit !== null) under = Math.min(under, exit - inset);
      limit = Math.min(limit, Math.max(UNDER_FAT_FLOOR * radius, under));
    }
    const fraction = boundaryLength > 1e-6 ? Math.min(radius, Math.max(0, limit)) / boundaryLength : 0;
    const free = boundaryLength > 1e-6 ? Math.min(radius, Math.max(0, extent - inset)) / boundaryLength : 0;
    for (let axis = 0; axis < 3; axis++) {
      out[3 * i + axis] = centre[axis]! + boundary[axis]! * free;
      binding.push[3 * i + axis] = boundary[axis]! * (fraction - free);
    }
  }
  if (fat) easePush(asset, binding, out);
  return out;
}

/**
 * How deep the fat under the skin may reach at each skin vertex (cm) without meeting the placed anatomy: the depth of
 * the shallowest muscle or bone vertex bound to a neighbouring skin triangle, along that vertex's fat direction, less
 * a clearance. Infinity where nothing is bound. See clampFatToAnatomy.
 */
export function fatRoom(
  asset: AnatomyAsset,
  skin: Float32Array,
  inner: Float32Array,
  placed: Float32Array,
  heightCm: number,
  out: Float32Array = new Float32Array(skin.length / 3),
): Float32Array {
  out.fill(Infinity);
  const registration = asset.manifest.registration;
  if (!registration?.surfaceCage || !asset.surfaceIndices) return out;
  const binding = placementBinding(asset);
  const clearance = FAT_CLEARANCE_CM * (heightCm / asset.heightCm);
  for (let i = 0; i < asset.manifest.vertexCount; i++)
    for (let k = 0; k < 3; k++) {
      const v = binding.surfaceOffsets[3 * i + k]!;
      const mx = skin[v]! - inner[v]!,
        my = skin[v + 1]! - inner[v + 1]!,
        mz = skin[v + 2]! - inner[v + 2]!;
      const depth = Math.sqrt(mx * mx + my * my + mz * mz);
      if (depth < 1e-6) continue;
      const below =
        ((skin[v]! - placed[3 * i]!) * mx + (skin[v + 1]! - placed[3 * i + 1]!) * my + (skin[v + 2]! - placed[3 * i + 2]!) * mz) /
        depth;
      const room = below - clearance;
      if (room < out[v / 3]!) out[v / 3] = room;
    }
  return out;
}

/** Gap kept between the fat's inner boundary and the shallowest muscle or bone, cm at reference stature. */
export const FAT_CLEARANCE_CM = 0.1;
