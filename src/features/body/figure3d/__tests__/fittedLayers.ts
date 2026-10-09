// Test helper: a fitted skin and the inner boundary of its fat layer, built as Figure3DCanvas builds them.
import { estimateInitialState, stateToAvatarParams, type BodyInputs, type Sex } from '@/engine/body';
import { compositionFromParams } from '../composition';
import type { FigureScene } from '../scene';
import { coreState } from '../scene';
import { insetSubcutaneousShell, partitionSubcutaneousShell } from '../subcutaneousShell';

export interface LayerCase {
  name: string;
  sex: Sex;
  heightCm: number;
  weightKg: number;
  frame: number;
  sliders?: BodyInputs['sliders'];
  /** Body fat set by hand on the Shape page (the figure is drawn at it). */
  bodyFatPct?: number;
}

export function fittedLayers(scene: FigureScene, c: LayerCase) {
  const estimate = estimateInitialState(
    { sex: c.sex, ageYears: 40, heightCm: c.heightCm, weightKg: c.weightKg, sliders: c.sliders },
    c.bodyFatPct ? { bodyFatPctOverride: c.bodyFatPct } : undefined,
  );
  const params = stateToAvatarParams(estimate, { frame: c.frame });
  const fit = scene.fit(params, c.frame);
  const body = scene.place(fit.state, c.heightCm);
  const outer = body.positions;
  const inner = scene.place(coreState(fit.state), c.heightCm, undefined, body.armSpacing).positions;
  const composition = compositionFromParams(params, c.frame);
  partitionSubcutaneousShell({
    outer,
    inner,
    heightCm: c.heightCm,
    waistHalfWidthCm: params.visceral.waist.halfWidthCm,
    waistHalfDepthCm: params.visceral.waist.halfDepthCm,
    waistCentreZCm: body.centre.side,
    visceralKg: composition.visceral.massKg,
    trunkSatKg: composition.subcutaneous.trunk.massKg,
    trunkShares: composition.subcutaneous.trunkShares,
  });
  const asset = scene.model.asset;
  insetSubcutaneousShell(
    outer,
    inner,
    scene.model.indices,
    c.heightCm,
    asset.thickness,
    Number(asset.manifest.stats.referenceHeightCm) || 166,
    scene.model.base,
    asset.manifest.shell?.pinned,
  );
  return { outer, inner, composition, frame: fit.state.frame };
}
