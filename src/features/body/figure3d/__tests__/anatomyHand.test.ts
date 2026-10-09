import { estimateInitialState, stateToAvatarParams, type Sex } from '@/engine/body';
import { decodeAnatomy } from '../anatomyAsset';
import { FigureScene } from '../scene';
import { placeAnatomy } from '../anatomyPose';
import { compositionFromParams } from '../composition';
import { loadTestAsset } from './loadAsset';

interface NodeMods {
  fs: { readFileSync(path: string): Uint8Array };
  zlib: { gunzipSync(bytes: Uint8Array): Uint8Array };
}
const get = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process
  ?.getBuiltinModule;
if (!get) throw new Error('Node needed');
const fs = get('node:fs') as NodeMods['fs'];
const zlib = get('node:zlib') as NodeMods['zlib'];
const anatomy = decodeAnatomy(zlib.gunzipSync(fs.readFileSync('public/figure/anatomy-v1.bin')));
const scene = new FigureScene(loadTestAsset());

// Re-baking a pose can change retained vertex indices. Read the source rig's
// distal finger stencils from this pack rather than assuming a previous layout.
const LEFT_MIDDLE_FINGER = [
  ...new Set(
    ['finger3-3L', 'finger3-tipL'].flatMap((id) => {
      const joint = scene.model.manifest.joints?.find((j) => j.id === id);
      if (!joint?.skinVertices?.length) throw new Error(`missing skin stencil for ${id}`);
      return joint.skinVertices;
    }),
  ),
];

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function fittedFinger(sex: Sex, heightCm: number, weightKg: number, frame: number): [number, number, number] {
  const estimate = estimateInitialState({ sex, ageYears: 40, heightCm, weightKg });
  const params = stateToAvatarParams(estimate, { frame });
  const fit = scene.fit(params, frame);
  const positions = scene.place(fit.state, heightCm).positions;
  return [0, 1, 2].map((axis) => median(LEFT_MIDDLE_FINGER.map((i) => positions[3 * i + axis]!))) as [
    number,
    number,
    number,
  ];
}

function atlasFinger(sex: Sex, heightCm: number, weightKg: number, frame: number): [number, number, number] {
  const part = anatomy.manifest.source.selected.find((p) => p.id === 'FJ3186');
  if (!part) throw new Error('missing left middle distal phalanx');
  const points = Array.from({ length: part.vertexCount }, (_, j) => part.vertexStart + j);
  const estimate = estimateInitialState({ sex, ageYears: 40, heightCm, weightKg });
  const params = stateToAvatarParams(estimate, { frame });
  const fit = scene.fit(params, frame);
  const skin = scene.place(fit.state, heightCm).positions;
  const positions = placeAnatomy(anatomy, skin, heightCm, frame, compositionFromParams(params, frame));
  return [0, 1, 2].map((axis) => median(points.map((i) => positions[3 * i + axis]!))) as [
    number,
    number,
    number,
  ];
}

it.each([
  ['male', 178, 84.9, 1],
  ['female', 165, 65, 0],
  ['female', 165, 65, 0.5],
] as const)('keeps named atlas fingers by the fitted %s hand at %icm', (sex, height, weight, frame) => {
  const skin = fittedFinger(sex, height, weight, frame);
  const bone = atlasFinger(sex, height, weight, frame);
  for (let axis = 0; axis < 3; axis++) expect(Math.abs(skin[axis]! - bone[axis]!)).toBeLessThan(2.5);
});
