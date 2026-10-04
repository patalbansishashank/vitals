import { DEFAULT_BODY, type BodyProfileValues } from '@/state/profileStore';
import { deriveFigure, muscleImpliedBodyFat } from '../figure';
import { summarizeBody } from '../model';

const man: BodyProfileValues = { ...DEFAULT_BODY, sex: 'male', ageYears: 36, heightCm: 178, weightKg: 84.9 };
const view = (v: BodyProfileValues) => {
  const s = summarizeBody(v);
  return { s, f: deriveFigure(v, s) };
};

describe('figure derivation (sliders describe the figure, estimates fuse)', () => {
  it('untouched: the figure is the estimate and untouched sliders show its values', () => {
    const { s, f } = view(man);
    expect(f.bodyFatPct).toBeCloseTo(s.bodyFatPct, 6);
    expect(f.diverges).toBe(false);
    expect(f.shown.muscleUpper).toBeCloseTo(f.shown.muscleLower, 9);
    expect(f.shown.belly).toBe(0);
    expect(f.frame).toBe(1);
    expect(f.params.figure.frame).toBe(1);
    expect(f.params.outputs.bodyFatPct).toBeCloseTo(s.bodyFatPct, 1);
  });

  it('body fat touched: the figure follows the slider exactly; the estimate moves part of the way', () => {
    const base = view(man).s.bodyFatPct;
    const { s, f } = view({ ...man, shape: { bodyFatPct: 14 } });
    expect(f.bodyFatPct).toBe(14);
    expect(f.params.outputs.bodyFatPct).toBeCloseTo(14, 1);
    expect(s.bodyFatPct).toBeLessThan(base);
    expect(s.bodyFatPct).toBeGreaterThan(14);
    expect(f.diverges).toBe(true);
    // weight stays the hard constraint: fat + lean on the figure = weight
    expect(f.estimate.fatMassKg + f.estimate.fatFreeMassKg).toBeCloseTo(84.9, 6);
  });

  it('only muscle touched: the figure carries that muscularity at the real weight', () => {
    const { f } = view({ ...man, shape: { muscleUpper: 0.7 } });
    expect(f.bodyFatPct).toBeCloseTo(muscleImpliedBodyFat('male', 0.7, 178, 84.9), 6);
    expect(f.shown.muscleLower).toBeCloseTo(0.7, 2); // the untouched scale follows the figure
  });

  it('muscle words are relative to what the numbers imply, not absolute anchors', () => {
    // a heavy body carries a high lean mass index; untouched it reads "as expected", never "bodybuilder"
    const heavy = view({ ...DEFAULT_BODY, sex: 'female', ageYears: 52, heightCm: 162, weightKg: 118 }).f;
    expect(heavy.muscle.figureWords).toBe('as expected');
    expect(heavy.muscle.words(heavy.shown.muscleUpper)).toBe('as expected');
    const f = view(man).f;
    expect(f.muscle.words(0)).toBe('much less than expected');
    expect(f.muscle.words(1)).toBe('much more than expected');
    expect(f.muscle.z(f.muscle.expected)).toBeCloseTo(0, 1);
    // setting the figure leaner at the same weight shows more muscle than expected
    expect(view({ ...man, shape: { bodyFatPct: 10 } }).f.muscle.figureWords).toMatch(/more than expected/);
  });

  it('a measured body fat anchors the figure even when muscle is set', () => {
    const v: BodyProfileValues = { ...man, shape: { muscleUpper: 0.9 }, knownBodyFat: { use: true, pct: 24, source: 'dxa' } };
    const { s, f } = view(v);
    expect(f.bodyFatPct).toBeCloseTo(s.estimate.bodyFatPct, 6);
    expect(s.measured.bodyFat).toBe(true);
    expect(s.bodyFatSdPct).toBeLessThan(view(man).s.bodyFatSdPct);
  });

  it('shares of fat are real fractions of the figure and redistribute', () => {
    const { f } = view(man);
    const sum = f.shares.belly + f.shares.hips + f.shares.chest + f.shares.arms;
    expect(sum).toBeGreaterThan(85);
    expect(sum).toBeLessThanOrEqual(100);
    const more = view({ ...man, shape: { belly: 1 } }).f;
    expect(more.shares.belly).toBeGreaterThan(f.shares.belly);
    expect(more.shares.hips).toBeLessThan(f.shares.hips);
    const chest = view({ ...man, shape: { chest: 1 } }).f;
    expect(chest.shares.chest).toBeGreaterThan(f.shares.chest);
    // chest is drawing-only: the estimate does not move
    expect(view({ ...man, shape: { chest: 1 } }).s.bodyFatPct).toBeCloseTo(view(man).s.bodyFatPct, 9);
  });

  it('a measured waist sets where fat sits (belly scale shows the solved value)', () => {
    const { f } = view({ ...man, waist: { use: true, cm: 118, neckCm: null, hipCm: null } });
    expect(f.shown.belly).toBeGreaterThan(0);
    expect(f.shown.belly).toBeLessThanOrEqual(1);
    expect(f.waistCm).toBeCloseTo(118, 0);
  });

  it('"prefer not to say" draws a blend of both templates at the middle frame', () => {
    const { f } = view({ ...man, sex: 'unspecified' });
    expect(f.frame).toBe(0.5);
    expect(f.params.figure.frame).toBe(0.5);
    for (const l of f.params.levels) expect(Number.isFinite(l.halfWidthCm)).toBe(true);
  });

  it('a stored frame flows into the params and changes nothing but the drawing', () => {
    const a = view(man).f;
    const b = view({ ...man, figure: { frame: 0.2 } }).f;
    expect(b.frame).toBe(0.2);
    expect(b.params.figure.frame).toBe(0.2);
    expect({ ...b.params, figure: { ...b.params.figure, frame: 1 } }).toEqual(a.params);
    expect(b.bodyFatPct).toBe(a.bodyFatPct);
  });

  it('"prefer not to say" never reads the frame for the physiology', () => {
    const lo = summarizeBody({ ...man, sex: 'unspecified', figure: { frame: 0 } });
    const hi = summarizeBody({ ...man, sex: 'unspecified', figure: { frame: 1 } });
    expect(hi.bodyFatPct).toBe(lo.bodyFatPct);
    expect(hi.equationSex).toBe(lo.equationSex);
  });

  it('stays well-formed across the input box (lean/muscular/heavy, both sexes)', () => {
    for (const sex of ['male', 'female'] as const) {
      for (const [h, w, shape] of [
        [150, 40, { bodyFatPct: 4 }],
        [200, 70, { muscleUpper: 1, muscleLower: 1 }],
        [165, 180, { bodyFatPct: 60, belly: 1, hips: -1 }],
        [210, 250, {}],
        [140, 35, { chest: -1, arms: 1 }],
      ] as const) {
        const { s, f } = view({ ...DEFAULT_BODY, sex, ageYears: 50, heightCm: h, weightKg: w, shape });
        expect(Number.isFinite(s.bodyFatPct)).toBe(true);
        expect(Number.isFinite(s.maintenance.kcal)).toBe(true);
        expect(f.bodyFatPct).toBeGreaterThanOrEqual(4);
        expect(f.bodyFatPct).toBeLessThanOrEqual(60);
        for (const l of f.params.levels) expect(Number.isFinite(l.halfWidthCm) && Number.isFinite(l.sideDepthCm)).toBe(true);
      }
    }
  });

  it('is fast enough to recompute on every drag frame', () => {
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) view({ ...man, sex: i % 2 ? 'male' : 'unspecified', shape: { bodyFatPct: 10 + (i % 40), muscleUpper: 0.5, muscleLower: 0.3 } });
    expect((performance.now() - t0) / 200).toBeLessThan(8);
  });
});
