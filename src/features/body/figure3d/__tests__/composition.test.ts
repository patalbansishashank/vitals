import { estimateInitialState, stateToAvatarParams, type BodyInputs } from '@/engine/body';
import { compositionFromParams } from '../composition';

const base: BodyInputs = { sex: 'male', ageYears: 40, heightCm: 178, weightKg: 82 };
const draw = (inputs: BodyInputs = base, bodyFatPct?: number, frame?: number) =>
  compositionFromParams(
    stateToAvatarParams(
      estimateInitialState(inputs, bodyFatPct === undefined ? {} : { bodyFatPctOverride: bodyFatPct }),
      { frame },
    ),
  );

describe('anatomical layer mapping', () => {
  it('obeys the weight constraint while fat and muscle change in opposite directions', () => {
    const lean = draw(base, 15);
    const fat = draw(base, 35);
    expect(lean.weightKg).toBeCloseTo(82, 5);
    expect(fat.weightKg).toBeCloseTo(82, 5);
    expect(fat.fatMassKg).toBeGreaterThan(lean.fatMassKg);
    expect(fat.fatFreeMassKg).toBeLessThan(lean.fatFreeMassKg);
    expect(fat.subcutaneous.trunk.transverseScale).toBeGreaterThan(lean.subcutaneous.trunk.transverseScale);
    expect(fat.subcutaneous.legs.transverseScale).toBeGreaterThan(lean.subcutaneous.legs.transverseScale);
    expect(fat.muscle.trunk.transverseScale).toBeLessThan(lean.muscle.trunk.transverseScale);
    expect(fat.visceral.areaCm2).toBeGreaterThan(lean.visceral.areaCm2);
    expect(fat.skeleton).toEqual(lean.skeleton);
  });

  it('changes only the frame shape when the drawing-only frame slider moves', () => {
    const hips = draw(base, 25, 0);
    const shoulders = draw(base, 25, 1);
    expect(shoulders.skeleton.shoulderScale).toBeGreaterThan(hips.skeleton.shoulderScale);
    expect(shoulders.skeleton.hipScale).toBeLessThan(hips.skeleton.hipScale);
    expect(shoulders.muscle).toEqual(hips.muscle);
    expect(shoulders.subcutaneous).toEqual(hips.subcutaneous);
    expect(shoulders.visceral).toEqual(hips.visceral);
  });

  it('honours the separately stored display frame used by plan figures', () => {
    const params = stateToAvatarParams(estimateInitialState(base));
    const hips = compositionFromParams(params, 0);
    const shoulders = compositionFromParams(params, 1);
    expect(hips.skeleton.frame).toBe(0);
    expect(shoulders.skeleton.frame).toBe(1);
    expect(shoulders.skeleton.shoulderScale).toBeGreaterThan(hips.skeleton.shoulderScale);
    expect(shoulders.muscle).toEqual(hips.muscle);
    expect(shoulders.fatMassKg).toBe(hips.fatMassKg);
  });

  it('sends regional muscle and fat distribution to their corresponding layers', () => {
    const lower = draw({ ...base, sliders: { muscleArms: -1, muscleLegs: 1, chest: -1, arms: -1 } }, 25);
    const upper = draw({ ...base, sliders: { muscleArms: 1, muscleLegs: -1, chest: 1, arms: 1 } }, 25);
    expect(upper.muscle.arms.massKg).toBeGreaterThan(lower.muscle.arms.massKg);
    expect(upper.muscle.legs.massKg).toBeLessThan(lower.muscle.legs.massKg);
    expect(upper.subcutaneous.arms.massKg).toBeGreaterThan(lower.subcutaneous.arms.massKg);
    expect(upper.subcutaneous.trunkShares.chest).toBeGreaterThan(lower.subcutaneous.trunkShares.chest);
    expect(upper.muscle.totalKg).toBeCloseTo(lower.muscle.totalKg, 4);
    expect(upper.fatMassKg).toBeCloseTo(lower.fatMassKg, 4);
  });

  it('uses estimated visceral area and carries its wide range', () => {
    const low = draw({ ...base, sliders: { bellyVsHips: -1 } }, 30);
    const high = draw({ ...base, sliders: { bellyVsHips: 1 } }, 30);
    expect(high.visceral.estimated).toBe(true);
    expect(high.visceral.massKg).toBeGreaterThan(low.visceral.massKg);
    expect(high.visceral.transverseScale).toBeGreaterThan(low.visceral.transverseScale);
    expect(high.visceral.areaRangeCm2[0]).toBeLessThan(high.visceral.areaCm2);
    expect(high.visceral.areaRangeCm2[1]).toBeGreaterThan(high.visceral.areaCm2);
    expect(high.skeleton).toEqual(low.skeleton);
  });

  it('scales stature while keeping bone size independent of weight at fixed height and frame', () => {
    const light = draw({ ...base, weightKg: 60 }, 25);
    const heavy = draw({ ...base, weightKg: 110 }, 25);
    const tall = draw({ ...base, heightCm: 190, weightKg: 95 }, 25);
    expect(light.skeleton).toEqual(heavy.skeleton);
    expect(tall.skeleton.heightCm).toBe(190);
    expect(heavy.subcutaneous.trunk.massKg).toBeGreaterThan(light.subcutaneous.trunk.massKg);
    expect(heavy.muscle.totalKg).toBeGreaterThan(light.muscle.totalKg);
  });
});
