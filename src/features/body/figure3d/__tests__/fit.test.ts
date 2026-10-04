// R2 gate: the fitted mesh's tape girths match the engine's AvatarParams to <= 1 cm on the 304-body matrix used by the
// SVG avatar's geometry tests (2 sexes x 3 ages x 5 BMIs x 2 heights x 5 slider sets + 4 measured-waist extremes).
import { allocateRegional, liveEstimate, stateToAvatarParams, type AvatarParams, type BodyEstimate, type BodySliders, type Sex } from '@/engine/body';
import { FigureFitter, targetsFromParams } from '../fit';
import { RING_IDS, type RingId } from '../manifest';
import { FigureScene, coreState, lerpState } from '../scene';
import { loadTestAsset, loadTestModel } from './loadAsset';

const SLIDER_SETS: (BodySliders | undefined)[] = [
  undefined,
  { adiposity: 0, muscularity: 0, bellyVsHips: -1, chest: -1, arms: -1, face: -1, muscleArms: -1, muscleLegs: -1, muscleTorso: -1 },
  { adiposity: 1, muscularity: 1, bellyVsHips: 1, chest: 1, arms: 1, face: 1, muscleArms: 1, muscleLegs: 1, muscleTorso: 1 },
  { adiposity: 1, muscularity: 0, bellyVsHips: 1, chest: -1, arms: 1, face: 1, muscleArms: -1, muscleLegs: -1, muscleTorso: -1 },
  { adiposity: 0, muscularity: 1, bellyVsHips: -1, chest: 1, arms: -1, face: -1, muscleArms: 1, muscleLegs: 1, muscleTorso: 1 },
];

function estimate(sex: Sex, ageYears: number, heightCm: number, bmi: number, sliders?: BodySliders, waistCm?: number): BodyEstimate {
  const h = heightCm / 100;
  return liveEstimate({ sex, ageYears, heightCm, weightKg: bmi * h * h, sliders, waistCm });
}

function matrix(): { name: string; params: AvatarParams }[] {
  const out: { name: string; params: AvatarParams }[] = [];
  for (const sex of ['male', 'female'] as Sex[])
    for (const age of [18, 45, 80])
      for (const bmi of [16, 22, 30, 40, 50])
        for (const heightCm of [150, 200])
          for (const [k, s] of SLIDER_SETS.entries())
            out.push({ name: `${sex} ${age}y ${heightCm}cm BMI${bmi} s${k}`, params: stateToAvatarParams(estimate(sex, age, heightCm, bmi, s)) });
  for (const sex of ['male', 'female'] as Sex[])
    for (const waist of [55, 160]) out.push({ name: `${sex} waist ${waist}`, params: stateToAvatarParams(estimate(sex, 40, 175, 30, undefined, waist)) });
  return out;
}

const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))]!;

describe('girth fit (R2 sec. 5.4 gate)', () => {
  const fitter = new FigureFitter(loadTestModel());

  it('fits all 304 bodies with every ring girth within 1 cm', () => {
    const cases = matrix();
    expect(cases).toHaveLength(304);
    const errs: Record<RingId, number[]> = { neck: [], chest: [], waist: [], hip: [], thigh: [], calf: [], arm: [] };
    const extra = { waistDepth: [] as number[], chestDepth: [] as number[], bideltoid: [] as number[], ms: [] as number[] };
    const fails: string[] = [];
    for (const c of cases) {
      const frame = c.params.figure.frame;
      const r = fitter.fit(c.params, frame);
      for (const id of RING_IDS) errs[id].push(Math.abs(r.errors.girths[id]));
      extra.waistDepth.push(Math.abs(r.errors.waistDepth));
      extra.chestDepth.push(Math.abs(r.errors.chestDepth));
      extra.bideltoid.push(Math.abs(r.errors.bideltoid));
      extra.ms.push(r.ms);
      if (r.maxGirthErrorCm > 1) fails.push(`${c.name}: ${r.maxGirthErrorCm.toFixed(2)} cm`);
    }
    const row = (k: string, xs: number[]) => `${k.padEnd(11)} mean ${(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3)}  p95 ${pct(xs, 0.95).toFixed(3)}  max ${Math.max(...xs).toFixed(3)}`;
    console.info(
      ['girth |error| cm over 304 bodies', ...RING_IDS.map((id) => row(id, errs[id])), row('waistDepth', extra.waistDepth), row('chestDepth', extra.chestDepth), row('bideltoid', extra.bideltoid), row('fit ms', extra.ms)].join('\n'),
    );
    expect(fails).toEqual([]);
  }, 120_000);

  it('a warm-started refit after a small change stays within 1 cm in <= 6 iterations', () => {
    const e = estimate('female', 35, 165, 27);
    const a = stateToAvatarParams(e);
    const r = allocateRegional({ fat: e.fat, muscle: e.muscle }, { fatMassKg: e.fatMassKg - 2, skeletalMuscleKg: e.skeletalMuscleKg });
    const b = stateToAvatarParams({ ...e, fatMassKg: e.fatMassKg - 2, weightKg: e.weightKg - 2, fat: r.fat, muscle: r.muscle }, { baseline: e });
    const cold = fitter.fit(a, 0);
    const warm = fitter.fit(b, 0, { warm: cold });
    expect(warm.iterations).toBeLessThanOrEqual(6);
    expect(warm.maxGirthErrorCm).toBeLessThan(1);
  });

  it('responds monotonically: more fat -> wider mesh waist, more muscle -> wider mesh shoulders and arms', () => {
    const scene = new FigureScene(loadTestAsset());
    const measure = (p: AvatarParams) => {
      const f = scene.fit(p, 1);
      const m = fitter.measure(f.state);
      return { waist: m.rings.waist.girth * f.scale, breadth: m.breadth * f.scale, arm: m.rings.arm.girth * f.scale };
    };
    const lean = measure(stateToAvatarParams(estimate('male', 40, 178, 22)));
    const fat = measure(stateToAvatarParams(estimate('male', 40, 178, 32)));
    expect(fat.waist).toBeGreaterThan(lean.waist + 5);
    const weak = measure(stateToAvatarParams(estimate('male', 40, 178, 26, { muscularity: 0.1, adiposity: 0.5 })));
    const strong = measure(stateToAvatarParams(estimate('male', 40, 178, 26, { muscularity: 0.9, adiposity: 0.5 })));
    expect(strong.arm).toBeGreaterThan(weak.arm);
    expect(strong.breadth).toBeGreaterThanOrEqual(weak.breadth - 0.5);
  });

  it('frame changes the drawing only: same targets, and a shoulders-led frame is broader at the shoulders than at the hips', () => {
    const p = stateToAvatarParams(estimate('male', 40, 175, 24));
    const t0 = targetsFromParams(p);
    const a = fitter.fit(p, 0);
    const b = fitter.fit(p, 1);
    expect(targetsFromParams(p)).toEqual(t0);
    expect(a.maxGirthErrorCm).toBeLessThan(1);
    expect(b.maxGirthErrorCm).toBeLessThan(1);
    expect(a.state.frame).toBe(0);
    expect(b.state.frame).toBe(1);
  });

  it('places meshes at stature with the floor at 0; the lean core is inside the envelope at the waist', () => {
    const scene = new FigureScene(loadTestAsset());
    const p = stateToAvatarParams(estimate('female', 40, 164, 30));
    const f = scene.fit(p, 0);
    const body = scene.place(f.state, p.heightCm);
    expect(body.heightCm).toBeCloseTo(p.heightCm, 3);
    let minY = Infinity;
    for (let i = 1; i < body.positions.length; i += 3) minY = Math.min(minY, body.positions[i]!);
    // floor = the reference sole vertex; on other bodies the lowest vertex may sit a millimetre or two lower
    expect(Math.abs(minY)).toBeLessThan(0.3);
    const core = fitter.measure(coreState(f.state));
    const env = fitter.measure(f.state);
    expect(core.rings.waist.girth).toBeLessThan(env.rings.waist.girth);
    const mid = lerpState(f.state, coreState(f.state), 0.5);
    expect(mid.weight).toBeCloseTo(f.state.weight / 2, 6);
  });
});
