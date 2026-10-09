// Optional Blender inspection export: FIGURE_INSPECT_OUT=<json> vitest run tests/figure/belly-export.test.ts
import { writeFileSync } from 'node:fs';
import { estimateInitialState, stateToAvatarParams } from '@/engine/body';
import { engineSliders } from '@/features/body/model';
import type { MorphState } from '@/features/body/figure3d/model';
import { fatStressState } from '@/features/body/figure3d/devStress';
import { FigureScene, coreState } from '@/features/body/figure3d/scene';
import { insetSubcutaneousShell } from '@/features/body/figure3d/subcutaneousShell';
import { loadTestAsset } from '@/features/body/figure3d/__tests__/loadAsset';

it('exports the actual fitted skin and keys for Blender inspection', () => {
  if (!process.env.FIGURE_INSPECT_OUT) return;
  const asset = loadTestAsset(),
    scene = new FigureScene(asset),
    model = scene.model;
  const bf = Number(process.env.INSPECT_BF ?? 57.4);
  const params = stateToAvatarParams(
    fatStressState(
      estimateInitialState(
        {
          sex: 'male',
          ageYears: 40,
          heightCm: 176,
          weightKg: 86,
          sliders: engineSliders(
            {
              ...(process.env.INSPECT_GENERIC ? {} : { muscleUpper: 0.42, muscleLower: 0.05 }),
              belly: Number(process.env.INSPECT_BELLY ?? 0),
            },
            'male',
          ),
        },
        { bodyFatPctOverride: bf },
      ),
      bf,
    ),
  );
  const fit = scene.fit(params, 1),
    placed = scene.place(fit.state, 176);
  const fat = scene.place(coreState(fit.state), 176, undefined, placed.armSpacing).positions;
  insetSubcutaneousShell(
    placed.positions,
    fat,
    model.indices,
    176,
    asset.thickness,
    Number(asset.manifest.stats.referenceHeightCm),
    model.base,
    asset.manifest.shell?.pinned,
  );
  const neutral = { frame: 1, muscle: 0.5, weight: 0.5, locals: {} };
  const shapes: Record<string, number[]> = {
    skin: Array.from(placed.positions),
    fat: Array.from(fat),
    neutral: Array.from(scene.place(neutral, 176).positions),
  };
  for (const [name, state] of Object.entries({
    weight: { ...neutral, weight: 1 },
    belly: { ...neutral, locals: { belly: 1 } },
    waist: { ...neutral, locals: { waist: 1 } },
    macroMinMuscle: { ...neutral, muscle: 0, weight: 1 },
  }))
    shapes[name] = Array.from(scene.place(state as MorphState, 176).positions);
  for (const id of ['waist', 'belly', 'torsoDepth', 'torsoWidth', 'hips', 'buttocks'])
    shapes[`without-${id}`] = Array.from(
      scene.place({ ...fit.state, locals: { ...fit.state.locals, [id]: 0 } }, 176).positions,
    );
  const stages: Record<string, number[]> = {};
  insetSubcutaneousShell(
    placed.positions,
    scene.place(coreState(fit.state), 176, undefined, placed.armSpacing).positions,
    model.indices,
    176,
    asset.thickness,
    Number(asset.manifest.stats.referenceHeightCm),
    model.base,
    asset.manifest.shell?.pinned,
    (stage, P) => {
      stages[stage] = Array.from(P);
    },
  );
  writeFileSync(
    process.env.FIGURE_INSPECT_OUT,
    JSON.stringify({
      triangles: Array.from(model.indices),
      shapes,
      stages,
      state: fit.state,
      armSpacing: placed.armSpacing,
    }),
  );
  expect(fit.maxGirthErrorCm).toBeLessThan(1);
});
