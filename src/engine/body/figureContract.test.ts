// R2 sec. 5.3 contract: figure / uncertainty / visceral blocks of AvatarParams (waist-slice areas, R2 sec. 3.3).
import {
  frameForSex,
  lerpAvatarParams,
  stateToAvatarParams,
  visceralBandOf,
  visceralSlice,
  VAT_SLICE_L_CM,
} from './avatar';
import { estimateInitialState } from './estimateBody';
import { KV_L_PER_KG, waistCoreArea } from './geometry';
import { liveEstimate } from './sliders';
import type { AvatarParams, BodySliders, BodyState, Sex } from './types';

const withVat = (s: BodyState, vatKg: number): BodyState => ({ ...s, fat: { ...s.fat, vatKg } });

function matrix(): { name: string; p: AvatarParams }[] {
  const out: { name: string; p: AvatarParams }[] = [];
  const sliderSets: (BodySliders | undefined)[] = [
    undefined,
    { adiposity: 0, muscularity: 0, bellyVsHips: -1, muscleTorso: -1 },
    { adiposity: 1, muscularity: 1, bellyVsHips: 1, muscleTorso: 1 },
    { adiposity: 1, muscularity: 0, bellyVsHips: 1 },
    { adiposity: 0, muscularity: 1, bellyVsHips: -1 },
  ];
  for (const sex of ['male', 'female'] as Sex[])
    for (const age of [18, 45, 80])
      for (const bmi of [16, 22, 30, 40, 50])
        for (const heightCm of [150, 200])
          for (const [k, sliders] of sliderSets.entries()) {
            const weightKg = bmi * (heightCm / 100) ** 2;
            const e = liveEstimate({ sex, ageYears: age, heightCm, weightKg, sliders });
            out.push({ name: `${sex} ${age}y ${heightCm}cm BMI${bmi} s${k}`, p: stateToAvatarParams(e) });
          }
  for (const sex of ['male', 'female'] as Sex[])
    for (const waistCm of [55, 160]) {
      const e = estimateInitialState({ sex, ageYears: 40, heightCm: 175, weightKg: 92, waistCm });
      out.push({ name: `${sex} waist ${waistCm}`, p: stateToAvatarParams(e) });
    }
  return out;
}

describe('visceral block (R2 sec. 3.3)', () => {
  const man = estimateInitialState({ sex: 'male', ageYears: 40, heightCm: 178, weightKg: 88, waistCm: 96 });
  const woman = estimateInitialState({
    sex: 'female',
    ageYears: 40,
    heightCm: 165,
    weightKg: 74,
    waistCm: 89,
  });

  it('reproduces the R2 Samouda worked examples: man 2.82 kg -> 164 cm2, woman 1.39 kg -> 99 cm2', () => {
    const m = stateToAvatarParams(withVat(man, 2.82)).visceral;
    const f = stateToAvatarParams(withVat(woman, 1.39)).visceral;
    expect(Math.abs(m.vatAreaCm2 - 164)).toBeLessThanOrEqual(1);
    expect(Math.abs(f.vatAreaCm2 - 99)).toBeLessThanOrEqual(1);
    expect(m.vatAreaCm2).toBeCloseTo((2.82 * KV_L_PER_KG * 1000) / VAT_SLICE_L_CM.male, 9);
    expect(m.band).toBe('high');
    expect(f.band).toBe('typical');
  });

  it('band edges: < 100 typical, 100-130 raised, >= 130 high', () => {
    expect(visceralBandOf(99.99)).toBe('typical');
    expect(visceralBandOf(100)).toBe('raised');
    expect(visceralBandOf(129.99)).toBe('raised');
    expect(visceralBandOf(130)).toBe('high');
    // through the engine: the vatKg that gives exactly 100 / 130 cm2 for a man (L 22 cm)
    const kgAt = (a: number) => (a * VAT_SLICE_L_CM.male) / (KV_L_PER_KG * 1000);
    expect(stateToAvatarParams(withVat(man, kgAt(100) - 1e-6)).visceral.band).toBe('typical');
    expect(stateToAvatarParams(withVat(man, kgAt(100) + 1e-6)).visceral.band).toBe('raised');
    expect(stateToAvatarParams(withVat(man, kgAt(130) + 1e-6)).visceral.band).toBe('high');
  });

  it('thresholds, uncertainty range and the waist ellipse', () => {
    const p = stateToAvatarParams(withVat(man, 2.82));
    const v = p.visceral;
    expect(v.thresholdsCm2).toEqual([100, 130]);
    const sd = Math.sqrt(0.35 ** 2 + 0.25 ** 2);
    expect(v.areaRangeCm2[0]).toBeCloseTo(v.vatAreaCm2 * (1 - sd), 9);
    expect(v.areaRangeCm2[1]).toBeCloseTo(v.vatAreaCm2 * (1 + sd), 9);
    const w = p.levels.find((l) => l.id === 'waist')!;
    expect(v.waist).toEqual({ halfWidthCm: w.halfWidthCm, halfDepthCm: w.halfDepthCm, phi: w.phi });
  });

  it('sum consistency: SAT + lean + VAT = pi*a*b, wall + spine + organs = lean; lean = M8 waist core when not clamped', () => {
    const p = stateToAvatarParams(man);
    const v = p.visceral;
    const aWaist = Math.PI * v.waist.halfWidthCm * v.waist.halfDepthCm;
    expect(v.satAreaCm2 + v.leanAreaCm2 + v.vatAreaCm2).toBeCloseTo(aWaist, 6);
    expect(v.wallAreaCm2 + v.spineAreaCm2 + v.organsAreaCm2).toBeCloseTo(v.leanAreaCm2, 6);
    expect(v.leanAreaCm2).toBeCloseTo(waistCoreArea('male', 1.78, man.fatFreeMassKg), 9);
    expect(v.leanAreaCm2).toBeCloseTo(p.figure.leanCoreAreaCm2.waist, 9);
    expect(v.satAreaCm2).toBeGreaterThan(100);
  });

  it('all areas finite and >= 0, identities hold, over a 304-body matrix', () => {
    for (const { name, p } of matrix()) {
      const v = p.visceral;
      const aWaist = Math.PI * v.waist.halfWidthCm * v.waist.halfDepthCm;
      for (const x of [
        v.vatAreaCm2,
        v.satAreaCm2,
        v.leanAreaCm2,
        v.wallAreaCm2,
        v.organsAreaCm2,
        v.spineAreaCm2,
        ...v.areaRangeCm2,
      ]) {
        expect(Number.isFinite(x), name).toBe(true);
        expect(x, name).toBeGreaterThanOrEqual(0);
      }
      expect(v.satAreaCm2 + v.leanAreaCm2 + v.vatAreaCm2, name).toBeCloseTo(aWaist, 6);
      expect(v.wallAreaCm2 + v.spineAreaCm2 + v.organsAreaCm2, name).toBeCloseTo(v.leanAreaCm2, 6);
      expect(v.organsAreaCm2, name).toBeGreaterThanOrEqual(0.15 * v.leanAreaCm2 - 1e-9);
      expect(v.areaRangeCm2[0], name).toBeLessThanOrEqual(v.vatAreaCm2);
      expect(v.areaRangeCm2[1], name).toBeGreaterThanOrEqual(v.vatAreaCm2);
      const u = p.uncertainty;
      expect(u.bodyFatBand80[0], name).toBeLessThanOrEqual(u.bodyFatBand80[1]);
      expect(Number.isFinite(u.waistSdCm) && u.waistSdCm > 0, name).toBe(true);
    }
  });

  it('clamps an impossible slice (VAT larger than the waist) to consistent, finite areas', () => {
    const v = visceralSlice({
      sex: 'male',
      heightCm: 175,
      fatFreeMassKg: 60,
      vatKg: 30,
      trunkMuscleKg: 9,
      trunkMuscleRefKg: 9,
      waist: { halfWidthCm: 12, halfDepthCm: 8, phi: 0.6 },
      vatRelativeSd: 0.35,
    });
    const aWaist = Math.PI * 12 * 8;
    expect(v.satAreaCm2 + v.leanAreaCm2 + v.vatAreaCm2).toBeCloseTo(aWaist, 9);
    expect(v.satAreaCm2).toBeGreaterThan(0);
    expect(v.vatAreaCm2).toBeGreaterThanOrEqual(0);
    expect(v.wallAreaCm2 + v.spineAreaCm2 + v.organsAreaCm2).toBeCloseTo(v.leanAreaCm2, 9);
  });

  it('VAT area is monotone in vatKg', () => {
    let last = -1;
    for (const kg of [0, 0.5, 1, 2, 3, 4, 6]) {
      const a = stateToAvatarParams(withVat(man, kg)).visceral.vatAreaCm2;
      expect(a).toBeGreaterThan(last);
      last = a;
    }
  });
});

describe('figure block and options', () => {
  const est = estimateInitialState({ sex: 'female', ageYears: 33, heightCm: 168, weightKg: 64 });

  it('frameForSex: female 0, male 1, unknown 0.5', () => {
    expect(frameForSex('female')).toBe(0);
    expect(frameForSex('male')).toBe(1);
    expect(frameForSex(null)).toBe(0.5);
    expect(frameForSex(undefined)).toBe(0.5);
  });

  it('frame defaults from sex, option wins and is clamped; sliders carried and clamped', () => {
    expect(stateToAvatarParams(est).figure.frame).toBe(0);
    const male = estimateInitialState({ sex: 'male', ageYears: 33, heightCm: 180, weightKg: 80 });
    expect(stateToAvatarParams(male).figure.frame).toBe(1);
    expect(stateToAvatarParams(est, { frame: 0.7 }).figure.frame).toBe(0.7);
    expect(stateToAvatarParams(est, { frame: 3 }).figure.frame).toBe(1);
    expect(stateToAvatarParams(est).figure.sliders).toEqual({ chest: 0, arms: 0, face: 0 });
    expect(stateToAvatarParams(est, { sliders: { chest: 0.5, face: -4 } }).figure.sliders).toEqual({
      chest: 0.5,
      arms: 0,
      face: -1,
    });
  });

  it('frame changes nothing else', () => {
    const a = stateToAvatarParams(est, { frame: 0 });
    const b = stateToAvatarParams(est, { frame: 1 });
    expect({ ...b, figure: { ...b.figure, frame: 0 } }).toEqual(a);
  });

  it('figure block mirrors the state composition', () => {
    const f = stateToAvatarParams(est).figure;
    expect(f.ageYears).toBe(33);
    expect(f.fatKg.vat).toBe(est.fat.vatKg);
    expect(f.fatKg.trunkSat).toBe(est.fat.trunkSatKg);
    expect(f.muscleKg.trunk).toBe(est.muscle.trunkKg);
    expect(f.satShares).toEqual(est.satShares);
    for (const v of Object.values(f.leanCoreAreaCm2)) expect(v).toBeGreaterThan(0);
  });

  it('uncertainty: from the estimate (re-centred), overrides win, defaults for a bare state', () => {
    const p = stateToAvatarParams(est);
    expect(p.uncertainty.vatRelativeSd).toBe(est.uncertainty.vatRelativeSd);
    expect(p.uncertainty.waistSdCm).toBe(est.uncertainty.waistSdCm);
    const mid = (p.uncertainty.bodyFatBand80[0] + p.uncertainty.bodyFatBand80[1]) / 2;
    expect(mid).toBeCloseTo(p.outputs.bodyFatPct, 6);
    const o = stateToAvatarParams(est, {
      uncertainty: { vatRelativeSd: 0.2, bodyFatBand80: [20, 30], waistSdCm: 1 },
    }).uncertainty;
    expect(o).toEqual({ vatRelativeSd: 0.2, bodyFatBand80: [20, 30], waistSdCm: 1 });
    const bare: BodyState = {
      sex: est.sex,
      ageYears: est.ageYears,
      heightCm: est.heightCm,
      weightKg: est.weightKg,
      fatMassKg: est.fatMassKg,
      fatFreeMassKg: est.fatFreeMassKg,
      skeletalMuscleKg: est.skeletalMuscleKg,
      fat: est.fat,
      muscle: est.muscle,
      satShares: est.satShares,
      frameZ: est.frameZ,
    };
    const d = stateToAvatarParams(bare).uncertainty;
    expect(d.vatRelativeSd).toBe(0.35);
    expect(d.waistSdCm).toBe(6.5);
    expect(d.bodyFatBand80[1] - d.bodyFatBand80[0]).toBeCloseTo(2 * 1.2815515655446004 * 4.5, 6);
  });

  it('lerpAvatarParams handles the nested blocks; band switches at t = 1', () => {
    const lo = stateToAvatarParams(withVat(est, 0.5));
    const hi = stateToAvatarParams(withVat(est, 3));
    expect(lo.visceral.band).toBe('typical');
    expect(hi.visceral.band).toBe('high');
    const mid = lerpAvatarParams(lo, hi, 0.5);
    expect(mid.visceral.vatAreaCm2).toBeCloseTo((lo.visceral.vatAreaCm2 + hi.visceral.vatAreaCm2) / 2, 9);
    expect(mid.visceral.areaRangeCm2[1]).toBeCloseTo(
      (lo.visceral.areaRangeCm2[1] + hi.visceral.areaRangeCm2[1]) / 2,
      9,
    );
    expect(mid.figure.fatKg.vat).toBeCloseTo(1.75, 9);
    expect(mid.visceral.band).toBe('typical');
    expect(lerpAvatarParams(lo, hi, 0.999).visceral.band).toBe('typical');
    expect(lerpAvatarParams(lo, hi, 1).visceral.band).toBe('high');
    expect(lerpAvatarParams(lo, hi, 1)).toEqual(hi);
    const aW = Math.PI * mid.visceral.waist.halfWidthCm * mid.visceral.waist.halfDepthCm;
    // interpolated identities stay close (pi*a*b is bilinear, so not exact)
    expect(
      Math.abs(mid.visceral.satAreaCm2 + mid.visceral.leanAreaCm2 + mid.visceral.vatAreaCm2 - aW) / aW,
    ).toBeLessThan(0.02);
  });
});
