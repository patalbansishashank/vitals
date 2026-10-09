import { estimateInitialState, stateToAvatarParams } from '@/engine/body';
import { decodeAnatomy } from '../anatomyAsset';
import { AnatomyPlacement } from '../anatomyPlacement';
import { compositionFromParams } from '../composition';
import { fitForDisplay } from '../Figure3DCanvas';
import type { FitResult } from '../fit';
import { FigureScene, coreState } from '../scene';
import { insetSubcutaneousShell, partitionSubcutaneousShell } from '../subcutaneousShell';
import { loadTestAsset } from './loadAsset';

const get = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process!
  .getBuiltinModule!;
const fs = get('node:fs') as { readFileSync(path: string): Uint8Array };
const zlib = get('node:zlib') as { gunzipSync(bytes: Uint8Array): Uint8Array };
const anatomy = decodeAnatomy(zlib.gunzipSync(fs.readFileSync('public/figure/anatomy-v1.bin')));
const asset = loadTestAsset();
const params = (delta: number) =>
  stateToAvatarParams(
    estimateInitialState({
      sex: 'male',
      ageYears: 40,
      heightCm: 178,
      weightKg: 84,
      sliders: { adiposity: delta / 15 },
    }),
  );

function placed(scene: FigureScene, delta: number, warm?: FitResult) {
  const p = params(delta),
    frame = 1;
  const fit = warm ? scene.fit(p, frame, warm) : fitForDisplay(scene, p, frame);
  const body = scene.place(fit.state, p.heightCm);
  const inner = scene.place(coreState(fit.state), p.heightCm, undefined, body.armSpacing).positions;
  const composition = compositionFromParams(p, frame);
  partitionSubcutaneousShell({
    outer: body.positions,
    inner,
    heightCm: p.heightCm,
    waistHalfWidthCm: p.visceral.waist.halfWidthCm,
    waistHalfDepthCm: p.visceral.waist.halfDepthCm,
    waistCentreZCm: body.centre.side,
    visceralKg: composition.visceral.massKg,
    trunkSatKg: composition.subcutaneous.trunk.massKg,
    trunkShares: composition.subcutaneous.trunkShares,
  });
  insetSubcutaneousShell(
    body.positions,
    inner,
    scene.model.indices,
    p.heightCm,
    asset.thickness,
    Number(asset.manifest.stats.referenceHeightCm) || 166,
    scene.model.base,
    asset.manifest.shell?.pinned,
  );
  return { skin: body.positions, inner, composition, heightCm: p.heightCm, frame, fit };
}

describe('slider final geometry', () => {
  it('is exactly the direct-set skin, fat and anatomy after a fast drag history', () => {
    const dragged = new FigureScene(asset),
      direct = new FigureScene(asset);
    const host = new AnatomyPlacement(anatomy, asset.manifest.vertexCount * 3);
    let warm: FitResult | undefined;
    for (const delta of [-15, -9, -3, 3, 9]) {
      const input = placed(dragged, delta, warm);
      warm = input.fit;
      host.place(input);
    }
    const final = placed(dragged, 15),
      expected = placed(direct, 15);
    expect(final.skin).toEqual(expected.skin);
    expect(final.inner).toEqual(expected.inner);
    const afterDrag = host.place(final);
    const fresh = new AnatomyPlacement(anatomy, asset.manifest.vertexCount * 3).place(expected);
    expect(afterDrag.positions).toEqual(fresh.positions);
    expect(afterDrag.room).toEqual(fresh.room);
  }, 30_000);
});
