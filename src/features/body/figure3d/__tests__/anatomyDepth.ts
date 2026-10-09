// Test helper: how far each placed muscle or bone vertex sits under a closed surface on the skin topology (the skin,
// or the fat's inner boundary), measured outward along the vertex's own placement chord (from its joint segment).
// Negative: the first crossing on the way out enters the surface, or there is none, so the vertex is outside it.
import type { AnatomyAsset } from '../anatomyAsset';
import { anatomyJoints } from '../anatomyPose';
import { Surface } from '../surface';

export function depthUnder(
  asset: AnatomyAsset,
  skin: Float32Array,
  surfacePositions: Float32Array,
  placed: Float32Array,
  heightCm: number,
  frame: number,
): Float64Array {
  const registration = asset.manifest.registration!;
  const joints = anatomyJoints(asset, skin, heightCm, frame);
  const surface = new Surface(surfacePositions, registration.skinIndices);
  const S = surfacePositions;
  const out = new Float64Array(asset.manifest.vertexCount);
  for (let i = 0; i < out.length; i++) {
    const [a, b] = registration.segments[asset.segments![i]!]!;
    const t = asset.segmentT![i]! / 65535;
    const p = [placed[3 * i]!, placed[3 * i + 1]!, placed[3 * i + 2]!];
    const d = [0, 1, 2].map((k) => p[k]! - (joints[3 * a + k]! * (1 - t) + joints[3 * b + k]! * t));
    const l = Math.hypot(...d);
    if (l < 1e-4) {
      out[i] = Infinity;
      continue;
    }
    const dir = d.map((v) => v / l);
    const hit = surface.ray(p, dir);
    if (!hit) {
      out[i] = -1;
      continue;
    }
    const [x, y, z] = hit.indices.map((v) => 3 * v) as [number, number, number];
    const u = [0, 1, 2].map((k) => S[y + k]! - S[x + k]!);
    const w = [0, 1, 2].map((k) => S[z + k]! - S[x + k]!);
    const n = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
    const facing = n[0]! * dir[0]! + n[1]! * dir[1]! + n[2]! * dir[2]!;
    out[i] = facing > 0 ? hit.distance : -hit.distance;
  }
  return out;
}
