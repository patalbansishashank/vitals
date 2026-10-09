import { estimateInitialState, stateToAvatarParams } from '@/engine/body';
import { engineSliders } from '@/features/body/model';
import { fatStressState } from '../devStress';
import { FigureScene, coreState } from '../scene';
import { insetSubcutaneousShell } from '../subcutaneousShell';
import { frontProfile, sideSilhouette, profileCurvature } from '../../../../../scripts/figure/lib/profile';
import { loadTestAsset } from './loadAsset';
import { cutRing } from '../measure';

const asset = loadTestAsset(),
  scene = new FigureScene(asset),
  model = scene.model;
const pose = asset.manifest.armPose!;
const arm = (v: number) => Math.max(pose.leftWeights[v]!, pose.rightWeights[v]!) > 0.2;
const rows: Record<string, unknown>[] = [];
for (const sex of ['male', 'female'] as const)
  for (const belly of [-1, 0, 1]) {
    let previous = -Infinity;
    for (const bf of [45, 50, 57.4, 65, 75])
      it(`${sex} ${bf}% belly ${belly}: rounded skin and inner fat profile`, () => {
        const height = sex === 'male' ? 176 : 164;
        const params = stateToAvatarParams(
          fatStressState(
            estimateInitialState(
              {
                sex,
                ageYears: 40,
                heightCm: height,
                weightKg: sex === 'male' ? 86 : 70,
                sliders: engineSliders({ belly }, sex),
              },
              { bodyFatPctOverride: bf },
            ),
            bf,
          ),
        );
        expect(params.outputs.bodyFatPct).toBeCloseTo(bf, 6);
        const fit = scene.fit(params, sex === 'male' ? 1 : 0),
          placed = scene.place(fit.state, height);
        const inner = scene.place(coreState(fit.state), height, undefined, placed.armSpacing).positions;
        insetSubcutaneousShell(
          placed.positions,
          inner,
          model.indices,
          height,
          asset.thickness,
          Number(asset.manifest.stats.referenceHeightCm),
          model.base,
          asset.manifest.shell?.pinned,
        );
        const measures: Record<string, number> = {};
        for (const [name, P] of [
          ['skin', placed.positions],
          ['fat', inner],
        ] as const) {
          const outline = sideSilhouette(P, model.indices, height, arm);
          expect([...outline.front].every(Number.isFinite)).toBe(true);
          // At least a ~3.2 cm bend radius over a 2 cm chord, including the soft underside fold.
          // Nipples are above this band. A dent in a sagittal section is not the visible side outline.
          const curvature = Math.max(...profileCurvature(outline.front, outline.step));
          measures[`${name}Silhouette`] = curvature;
          expect.soft(curvature, `${name} projected silhouette degrees/cm`).toBeLessThan(18);
          for (const offset of [0, 0.025, -0.025]) {
            const profile = frontProfile(P, model.indices, height, arm, offset);
            expect([...profile.front].every(Number.isFinite)).toBe(true);
            const curve = Math.max(...profileCurvature(profile.front, profile.step));
            measures[`${name}${offset}`] = curve;

            expect
              .soft(
                Math.max(...profile.crossings.map((c) => c.length)),
                `${name} folds back through sagittal section`,
              )
              .toBeLessThanOrEqual(1);
            if (name === 'skin' && offset === 0) {
              const depth = Math.max(...outline.front);
              expect.soft(depth, 'belly depth must grow with fat').toBeGreaterThanOrEqual(previous - 0.1);
              previous = depth;
              measures.depth = depth;
            }
          }
        }
        rows.push({ sex, belly, bf, measures, state: fit.state });
      });
  }
afterAll(() => {
  if (process.env.BELLY_REPORT) {
    const fs = process.getBuiltinModule('node:fs');
    fs.writeFileSync(process.env.BELLY_REPORT, JSON.stringify(rows, null, 1));
  }
});

it('the saved 57.4% specimen has no pointed skin or inner-fat outline', () => {
  const params = stateToAvatarParams(
    estimateInitialState(
      {
        sex: 'male',
        ageYears: 40,
        heightCm: 176,
        weightKg: 86,
        sliders: engineSliders({ muscleUpper: 0.42, muscleLower: 0.05 }, 'male'),
      },
      { bodyFatPctOverride: 57.4 },
    ),
  );
  const fit = scene.fit(params, 1),
    skin = scene.place(fit.state, 176);
  const fat = scene.place(coreState(fit.state), 176, undefined, skin.armSpacing).positions;
  insetSubcutaneousShell(
    skin.positions,
    fat,
    model.indices,
    176,
    asset.thickness,
    Number(asset.manifest.stats.referenceHeightCm),
    model.base,
    asset.manifest.shell?.pinned,
  );
  for (const P of [skin.positions, fat]) {
    const outline = sideSilhouette(P, model.indices, 176, arm);
    expect(Math.max(...profileCurvature(outline.front, outline.step))).toBeLessThan(18);
  }
});

it.each([0, 1])('frame %s: a larger waist grows primarily in front, not as a lumbar bulge', (frame) => {
  const ring = model.manifest.rings.find((r) => r.id === 'waist')!;
  const extent = (waist: number) => {
    const P = scene.place({ frame, muscle: 0.5, weight: 1, locals: { waist } }, 176).positions;
    const cuts = cutRing(P, ring);
    const z = cuts.filter((_, i) => i % 2 === 1).map((x) => x + P[3 * ring.anchor + 2]!);
    return { front: Math.max(...z), back: Math.min(...z) };
  };
  const a = extent(0),
    b = extent(4);
  expect(b.front - a.front).toBeGreaterThan(2 * (a.back - b.back));
});
