// stateToAvatarParams (dossier 14 M10): ellipse maths, landmarks, before/after behaviour, morphing.
import { ellipseFromCircumference, ellipsePerimeter, lerpAvatarParams, ramanujanK, stateToAvatarParams, LANDMARKS } from './avatar';
import { circumferencesFor } from './circumferences';
import { estimateInitialState } from './estimateBody';
import { PSI_LOSS } from './geometry';
import { allocateRegional } from './regional';
import type { BodyState, Sex } from './types';

/** Exact ellipse perimeter by numerical integration (Simpson, 20k panels). */
function exactPerimeter(a: number, b: number): number {
  const n = 20000;
  const e2 = 1 - (b * b) / (a * a);
  const f = (t: number) => Math.sqrt(1 - e2 * Math.sin(t) ** 2);
  const hStep = Math.PI / 2 / n;
  let s = f(0) + f(Math.PI / 2);
  for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * f(i * hStep);
  return 4 * a * ((s * hStep) / 3);
}

function change(s: BodyState, dFM: number, dFFM: number): BodyState {
  const fm = s.fatMassKg + dFM;
  const ffm = s.fatFreeMassKg + dFFM;
  const sm = s.skeletalMuscleKg + 0.9 * dFFM;
  const r = allocateRegional({ fat: s.fat, muscle: s.muscle }, { fatMassKg: fm, skeletalMuscleKg: sm });
  return { ...s, fatMassKg: fm, fatFreeMassKg: ffm, weightKg: fm + ffm, skeletalMuscleKg: sm, fat: r.fat, muscle: r.muscle, measuredCircumferences: undefined };
}

describe('ellipse maths (dossier 14 M10)', () => {
  it('Ramanujan error < 0.001 % for depth/width 0.5-1.0 against the exact integral', () => {
    for (let rho = 0.5; rho <= 1.0001; rho += 0.05) {
      const a = 10;
      const approx = Math.PI * a * ramanujanK(rho);
      expect(Math.abs(approx / exactPerimeter(a, rho * a) - 1)).toBeLessThan(1e-5);
    }
  });

  it('reproduces the dossier example half-widths (a, depth 2b) to +-0.1 cm', () => {
    const cases: [number, number, number, number][] = [
      [80, 0.68, 15.0, 20.4],
      [96, 0.75, 17.4, 26.1],
      [120, 0.85, 20.6, 35.0],
      [86, 0.72, 15.8, 22.8],
      [106, 0.72, 19.5, 28.1],
      [100, 0.7, 18.6, 26.0],
    ];
    for (const [C, rho, a, depth] of cases) {
      const e = ellipseFromCircumference(C, rho);
      expect(Math.abs(e.a - a)).toBeLessThanOrEqual(0.1);
      expect(Math.abs(2 * e.b - depth)).toBeLessThanOrEqual(0.1);
      expect(ellipsePerimeter(e.a, e.b)).toBeCloseTo(C, 6);
    }
  });
});

describe('stateToAvatarParams', () => {
  const inputs = { sex: 'male' as Sex, ageYears: 35, heightCm: 178, weightKg: 88, waistCm: 96 };
  const est = estimateInitialState(inputs);

  it('at t = 0 uses the estimate circumferences (measured waist) and every section is consistent', () => {
    const p = stateToAvatarParams(est);
    expect(p.circumferences).toEqual(est.circumferences);
    expect(p.circumferences.waistCm).toBe(96);
    const ys = p.levels.map((l) => l.yFrac);
    expect([...ys].sort((x, y) => y - x)).toEqual(ys);
    expect(p.levels).toHaveLength(Object.keys(LANDMARKS).length);
    for (const l of p.levels) {
      expect(l.halfWidthCm).toBeGreaterThan(0);
      expect(l.halfDepthCm).toBeGreaterThan(0);
      expect(l.frontWidthCm).toBeCloseTo(2 * l.halfWidthCm, 12);
      expect(l.sideFrontCm + l.sideBackCm).toBeCloseTo(l.sideDepthCm, 12);
      expect(l.yCm).toBeCloseTo(l.yFrac * 178, 12);
      if (l.circumferenceCm !== null) {
        expect(ellipsePerimeter(l.halfWidthCm, l.halfDepthCm)).toBeCloseTo(l.circumferenceCm, 6);
      }
    }
    const waist = p.levels.find((l) => l.id === 'waist');
    expect(waist?.rho).toBeGreaterThanOrEqual(0.6);
    expect(waist?.rho).toBeLessThanOrEqual(0.92);
    expect(p.outputs.whtr).toBeCloseTo(96 / 178, 12);
  });

  it('before/after: fat loss narrows the waist by psi x geometry, fattens nothing, and raises definition', () => {
    const after = change(est, -8, -1);
    const pa = stateToAvatarParams(after, { baseline: est });
    const p0 = stateToAvatarParams(est);
    const geoDelta = circumferencesFor(after).waistCm - circumferencesFor({ ...est, measuredCircumferences: undefined }).waistCm;
    expect(pa.circumferences.waistCm - 96).toBeCloseTo(PSI_LOSS * geoDelta, 9);
    for (const k of ['neckCm', 'chestCm', 'hipCm', 'thighCm', 'armCm'] as const) {
      expect(pa.circumferences[k]).toBeLessThan(p0.circumferences[k]);
    }
    expect(pa.definition.abs).toBeGreaterThanOrEqual(p0.definition.abs);
    expect(pa.faceFullness).toBeLessThan(p0.faceFullness);
    expect(pa.outputs.vatKg).toBeLessThan(p0.outputs.vatKg);
  });

  it('fat gain is not damped (psi applies to waist loss only)', () => {
    const noMeasure = { ...est, measuredCircumferences: undefined };
    const after = change(noMeasure, 5, 0.5);
    const pa = stateToAvatarParams(after, { baseline: noMeasure });
    expect(pa.circumferences.waistCm - circumferencesFor(noMeasure).waistCm).toBeCloseTo(
      circumferencesFor(after).waistCm - circumferencesFor(noMeasure).waistCm,
      9,
    );
  });

  it('a state equal to its baseline reproduces the baseline avatar exactly', () => {
    expect(stateToAvatarParams(est, { baseline: est })).toEqual(stateToAvatarParams(est));
  });

  it('muscle gain widens arm, shoulders, chest and thigh', () => {
    const lean = estimateInitialState({ sex: 'male', ageYears: 30, heightCm: 180, weightKg: 75 });
    const r = allocateRegional({ fat: lean.fat, muscle: lean.muscle }, { fatMassKg: lean.fatMassKg, skeletalMuscleKg: lean.skeletalMuscleKg + 6 });
    const big: BodyState = { ...lean, muscle: r.muscle, skeletalMuscleKg: lean.skeletalMuscleKg + 6, fatFreeMassKg: lean.fatFreeMassKg + 6.7, weightKg: lean.weightKg + 6.7 };
    const p0 = stateToAvatarParams(lean);
    const p1 = stateToAvatarParams(big, { baseline: lean });
    for (const k of ['armCm', 'bideltoidCm', 'chestCm', 'thighCm', 'calfCm'] as const) {
      expect(p1.circumferences[k]).toBeGreaterThan(p0.circumferences[k]);
    }
    expect(p1.definition.delts).toBeGreaterThanOrEqual(p0.definition.delts);
  });

  it('male and female base proportions: at equal BMI women have a larger hip and lower WHR', () => {
    const m = stateToAvatarParams(estimateInitialState({ sex: 'male', ageYears: 30, heightCm: 170, weightKg: 66 }));
    const f = stateToAvatarParams(estimateInitialState({ sex: 'female', ageYears: 30, heightCm: 170, weightKg: 66 }));
    expect(f.circumferences.hipCm).toBeGreaterThan(m.circumferences.hipCm);
    expect(f.outputs.whr).toBeLessThan(m.outputs.whr);
    expect(m.circumferences.bideltoidCm).toBeGreaterThan(f.circumferences.bideltoidCm);
  });

  it('apple pattern loses ab definition earlier than pear at the same BF % (BFeff = BF + 6 z)', () => {
    const base = { sex: 'male' as Sex, ageYears: 30, heightCm: 180, weightKg: 78 };
    const apple = stateToAvatarParams(estimateInitialState({ ...base, sliders: { bellyVsHips: 1 } }, { bodyFatPctOverride: 13 }));
    const pear = stateToAvatarParams(estimateInitialState({ ...base, sliders: { bellyVsHips: -1 } }, { bodyFatPctOverride: 13 }));
    expect(apple.definition.abs).toBeLessThan(pear.definition.abs);
  });

  it('lerpAvatarParams: t = 0 / 1 return the endpoints, t = 0.5 the midpoint', () => {
    const a = stateToAvatarParams(est);
    const b = stateToAvatarParams(change(est, -6, -1), { baseline: est });
    expect(lerpAvatarParams(a, b, 0)).toEqual(a);
    expect(lerpAvatarParams(a, b, 1)).toEqual(b);
    const mid = lerpAvatarParams(a, b, 0.5);
    expect(mid.circumferences.waistCm).toBeCloseTo((a.circumferences.waistCm + b.circumferences.waistCm) / 2, 12);
    expect(mid.levels[3]?.halfWidthCm).toBeCloseTo(((a.levels[3]?.halfWidthCm ?? 0) + (b.levels[3]?.halfWidthCm ?? 0)) / 2, 12);
    expect(mid.levels.map((l) => l.id)).toEqual(a.levels.map((l) => l.id));
  });

  it('works across the size range (short/tall, lean/obese, both sexes)', () => {
    for (const [sex, h, W] of [
      ['male', 150, 45],
      ['male', 205, 160],
      ['female', 145, 38],
      ['female', 190, 140],
    ] as [Sex, number, number][]) {
      const p = stateToAvatarParams(estimateInitialState({ sex, ageYears: 40, heightCm: h, weightKg: W }));
      for (const l of p.levels) {
        expect(Number.isFinite(l.halfWidthCm)).toBe(true);
        expect(l.halfWidthCm).toBeGreaterThan(0);
      }
      for (const v of Object.values(p.definition)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});
