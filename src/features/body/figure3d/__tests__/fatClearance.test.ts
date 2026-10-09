// The fat layer gives way to the placed muscles and bones only where they need the room, without steps or folds.
import { decodeAnatomy } from '../anatomyAsset';
import { fatRoom, placeAnatomy } from '../anatomyPose';
import { clampFatToAnatomy } from '../fatClearance';
import { FigureScene } from '../scene';
import { SHELL_MIN_CM } from '../subcutaneousShell';
import { fittedLayers, type LayerCase } from './fittedLayers';
import { loadTestAsset } from './loadAsset';

const get = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process!.getBuiltinModule!;
const fs = get('node:fs') as { readFileSync(path: string): Uint8Array };
const zlib = get('node:zlib') as { gunzipSync(bytes: Uint8Array): Uint8Array };
const anatomy = decodeAnatomy(zlib.gunzipSync(fs.readFileSync('public/figure/anatomy-v1.bin')));
const scene = new FigureScene(loadTestAsset());
const indices = scene.model.indices;

const cases: LayerCase[] = [
  { name: 'heavy male', sex: 'male', heightCm: 175, weightKg: 128, frame: 1 },
  { name: 'lean female', sex: 'female', heightCm: 170, weightKg: 48, frame: 0 },
];

describe('fat layer clearance', () => {
  it.each(cases.map((c) => [c.name, c] as const))('%s: never deeper, never under the minimum, no step', (_name, c) => {
    const { outer, inner, composition, frame } = fittedLayers(scene, c);
    const placed = placeAnatomy(anatomy, outer, c.heightCm, frame, composition, inner);
    const room = fatRoom(anatomy, outer, inner, placed, c.heightCm);
    const before = inner.slice();
    const start = performance.now();
    clampFatToAnatomy(outer, inner, indices, room, c.heightCm);
    // Part of the fat layer rebuild on every shape change (about 4 ms alone, 20 ms for the whole rebuild). A guard against
    // pathological slowness, not a benchmark: it measured 46 ms in the full suite with other jobs loading the machine.
    expect(performance.now() - start).toBeLessThan(150);
    const minimum = SHELL_MIN_CM * (c.heightCm / 166);
    const depth = (P: Float32Array, i: number) =>
      Math.hypot(outer[3 * i]! - P[3 * i]!, outer[3 * i + 1]! - P[3 * i + 1]!, outer[3 * i + 2]! - P[3 * i + 2]!);
    let limited = 0;
    for (let i = 0; i < outer.length / 3; i++) {
      const was = depth(before, i),
        now = depth(inner, i);
      expect(now).toBeLessThanOrEqual(was + 1e-4);
      expect(now).toBeGreaterThanOrEqual(Math.min(was, minimum) - 1e-4);
      // The fat gives way where muscle or bone needs the room, as a smooth swell (not to each vertex's own limit).
      if (now < was - 1e-4) limited++;
    }
    expect(limited).toBeGreaterThan(0);
    // Smooth: on the back, neck and chest the layer is no bumpier than without the clamp (a bone's relief imprinted
    // on it doubled to tripled the 99th percentile of its bumps).
    const neighbours = Array.from({ length: outer.length / 3 }, () => new Set<number>());
    for (let f = 0; f < indices.length; f += 3)
      for (let k = 0; k < 3; k++) {
        neighbours[indices[f + k]!]!.add(indices[f + ((k + 1) % 3)]!);
        neighbours[indices[f + ((k + 1) % 3)]!]!.add(indices[f + k]!);
      }
    const bumps = (P: Float32Array) => {
      const out: number[] = [];
      for (let i = 0; i < outer.length / 3; i++) {
        const y = outer[3 * i + 1]! / c.heightCm;
        if (Math.abs(outer[3 * i]!) > 18 || y < 0.6 || y > 0.88) continue;
        const n = [0, 1, 2].map((a) => outer[3 * i + a]! - P[3 * i + a]!);
        const l = Math.hypot(...n) || 1;
        let off = 0;
        for (let a = 0; a < 3; a++) {
          let mean = 0;
          for (const w of neighbours[i]!) mean += P[3 * w + a]! / neighbours[i]!.size;
          off += ((P[3 * i + a]! - mean) * n[a]!) / l;
        }
        out.push(Math.abs(off));
      }
      out.sort((x, y) => x - y);
      return out[Math.floor(out.length * 0.99)]!;
    };
    expect(bumps(inner)).toBeLessThan(1.15 * bumps(before));
    // No step: across every edge, the depth taken away changes by at most the edge length (a 45 degree cone) plus
    // the change in the depth itself.
    for (let f = 0; f < indices.length; f += 3)
      for (let k = 0; k < 3; k++) {
        const a = indices[f + k]!,
          b = indices[f + ((k + 1) % 3)]!;
        const edge = Math.hypot(outer[3 * a]! - outer[3 * b]!, outer[3 * a + 1]! - outer[3 * b + 1]!, outer[3 * a + 2]! - outer[3 * b + 2]!);
        const cut = (i: number) => depth(before, i) - depth(inner, i);
        expect(Math.abs(cut(a) - cut(b))).toBeLessThanOrEqual(edge + Math.abs(depth(before, a) - depth(before, b)) + 1e-3);
      }
  });
});
