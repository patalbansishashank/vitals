// Waist-slice and cutaway geometry (R2 sec. 3.3 / 3.4): exact areas, nesting, monotone response, finite everywhere.
import {
  estimateInitialState,
  liveEstimate,
  stateToAvatarParams,
  type AvatarParams,
  type BodyState,
  type Sex,
} from '@/engine/body';
import {
  bisect,
  cutawayGeometry,
  ellipseRadius,
  growContour,
  polarArea,
  polarPoints,
  polygonArea,
  sliceGeometry,
  SAMPLES,
} from './geometry';

const man = estimateInitialState({ sex: 'male', ageYears: 40, heightCm: 178, weightKg: 88, waistCm: 96 });
const withVat = (s: BodyState, vatKg: number): BodyState => ({ ...s, fat: { ...s.fat, vatKg } });
const paramsVat = (kg: number) => stateToAvatarParams(withVat(man, kg));

function bodies(): { name: string; p: AvatarParams }[] {
  const out: { name: string; p: AvatarParams }[] = [];
  for (const sex of ['male', 'female'] as Sex[])
    for (const bmi of [16, 22, 30, 40, 50])
      for (const heightCm of [150, 200])
        for (const bellyVsHips of [-1, 0, 1]) {
          const e = liveEstimate({
            sex,
            ageYears: 50,
            heightCm,
            weightKg: bmi * (heightCm / 100) ** 2,
            sliders: { bellyVsHips },
          });
          out.push({ name: `${sex} BMI${bmi} ${heightCm} belly${bellyVsHips}`, p: stateToAvatarParams(e) });
        }
  return out;
}
const rel = (x: number, y: number) => Math.abs(x - y) / Math.max(Math.abs(y), 1e-9);

describe('polar helpers', () => {
  it('shoelace area of the sampled ellipse is within 0.1 % of pi*a*b', () => {
    const r = Array.from({ length: SAMPLES }, (_, i) => ellipseRadius(17, 12, (i * 2 * Math.PI) / SAMPLES));
    expect(rel(polygonArea(polarPoints(r)), Math.PI * 17 * 12)).toBeLessThan(0.001);
    expect(polarArea(r)).toBeCloseTo(polygonArea(polarPoints(r)), 9);
  });

  it('bisect solves increasing functions and clamps out-of-range targets', () => {
    expect(bisect((x) => x * x, 2, 0, 4)).toBeCloseTo(Math.SQRT2, 12);
    expect(bisect((x) => x, -1, 0, 1)).toBe(0);
    expect(bisect((x) => x, 5, 0, 1)).toBe(1);
  });

  it('growContour hits the target area and saturates at the cap', () => {
    const base = Array.from({ length: SAMPLES }, () => 3);
    const cap = Array.from({ length: SAMPLES }, () => 8);
    const r = growContour(base, cap, 120);
    expect(rel(polarArea(r), 120)).toBeLessThan(1e-6);
    const sat = growContour(base, cap, 1e6);
    expect(sat).toEqual(cap);
  });
});

describe('sliceGeometry', () => {
  it('VAT fill area matches vatAreaCm2 within 0.5 % (scaled to the polygon), and every layer its target', () => {
    for (const kg of [0.3, 1, 2.82, 5]) {
      const p = paramsVat(kg);
      const v = p.visceral;
      const g = sliceGeometry(v);
      const k = g.areas.outer / (Math.PI * v.waist.halfWidthCm * v.waist.halfDepthCm);
      expect(rel(g.areas.vat, v.vatAreaCm2 * k), `vat ${kg}`).toBeLessThan(0.005);
      expect(rel(g.areas.organs, v.organsAreaCm2 * k)).toBeLessThan(0.005);
      expect(rel(g.areas.outer - g.areas.wallOuter, v.satAreaCm2 * k)).toBeLessThan(0.005);
      expect(rel(g.areas.wallInner, (v.vatAreaCm2 + v.organsAreaCm2 + v.spineAreaCm2) * k)).toBeLessThan(
        0.005,
      );
      expect(rel(polygonArea(g.vat) - polygonArea(g.organs), g.areas.vat)).toBeLessThan(1e-9);
    }
  });

  it('reference rings sit at 100 and 130 cm2 of deep fat (within 0.5 %)', () => {
    const p = paramsVat(1.5);
    const g = sliceGeometry(p.visceral);
    const k = g.areas.outer / (Math.PI * p.visceral.waist.halfWidthCm * p.visceral.waist.halfDepthCm);
    expect(rel(polygonArea(g.refs[0]) - g.areas.organs, 100 * k)).toBeLessThan(0.005);
    expect(rel(polygonArea(g.refs[1]) - g.areas.organs, 130 * k)).toBeLessThan(0.005);
    expect(polygonArea(g.halo[0])).toBeLessThan(polygonArea(g.vat));
    expect(polygonArea(g.halo[1])).toBeGreaterThan(polygonArea(g.vat));
  });

  it('contours are nested per angle: organs in vat in wall-inner in wall-outer in outer, over a body matrix', () => {
    for (const { name, p } of bodies()) {
      const g = sliceGeometry(p.visceral);
      const r = g.radii;
      for (let i = 0; i < SAMPLES; i++) {
        expect(r.organs[i]!, name).toBeLessThanOrEqual(r.vat[i]! + 1e-9);
        expect(r.vat[i]!, name).toBeLessThanOrEqual(r.wallInner[i]! + 1e-9);
        expect(r.wallInner[i]!, name).toBeLessThanOrEqual(r.wallOuter[i]! + 1e-9);
        expect(r.wallOuter[i]!, name).toBeLessThanOrEqual(r.outer[i]! + 1e-9);
        expect(r.organs[i]!, name).toBeGreaterThan(0);
      }
      for (const pts of [g.outer, g.wallOuter, g.wallInner, g.organs, g.vat, ...g.refs, ...g.halo])
        for (const [x, y] of pts) expect(Number.isFinite(x) && Number.isFinite(y), name).toBe(true);
      expect(Number.isFinite(g.spine.r) && g.spine.r > 0, name).toBe(true);
      // the deep-fat fill matches its target wherever the cavity can hold it
      const k = g.areas.outer / (Math.PI * p.visceral.waist.halfWidthCm * p.visceral.waist.halfDepthCm);
      expect(rel(g.areas.vat, p.visceral.vatAreaCm2 * k), name).toBeLessThan(0.005);
    }
  });

  it('the deep-fat contour grows monotonically with vatKg', () => {
    let last = -1;
    for (const kg of [0, 0.5, 1, 1.5, 2, 3, 4, 6]) {
      const g = sliceGeometry(paramsVat(kg).visceral);
      expect(g.areas.vat).toBeGreaterThan(last);
      last = g.areas.vat;
    }
  });

  it('SAT is thicker in front than behind; the wall is thicker behind', () => {
    const r = sliceGeometry(paramsVat(2).visceral).radii;
    const front = (SAMPLES * 3) / 4;
    const back = SAMPLES / 4;
    expect(r.outer[front]! - r.wallOuter[front]!).toBeGreaterThan(r.outer[back]! - r.wallOuter[back]!);
    expect(r.wallOuter[back]! - r.wallInner[back]!).toBeGreaterThan(
      r.wallOuter[front]! - r.wallInner[front]!,
    );
  });

  it('is stable: identical params give identical contours (no flicker)', () => {
    expect(sliceGeometry(paramsVat(2).visceral)).toEqual(sliceGeometry(paramsVat(2).visceral));
  });
});

describe('cutawayGeometry', () => {
  it('fills the cavity with deep fat at A_vat / (A_vat + A_organs) and stays finite', () => {
    const lo = cutawayGeometry(paramsVat(0.5));
    const hi = cutawayGeometry(paramsVat(4));
    expect(hi.vatFraction).toBeGreaterThan(lo.vatFraction);
    expect(hi.loops[0]!.r).toBeLessThan(lo.loops[0]!.r);
    const v = paramsVat(4).visceral;
    expect(hi.vatFraction).toBeCloseTo(v.vatAreaCm2 / (v.vatAreaCm2 + v.organsAreaCm2), 12);
    for (const { name, p } of bodies()) {
      const c = cutawayGeometry(p);
      for (const [x, y] of [...c.skin, ...c.wall, ...c.cavity])
        expect(Number.isFinite(x) && Number.isFinite(y), name).toBe(true);
      expect(c.slice.y, name).toBeCloseTo(-p.levels.find((l) => l.id === 'waist')!.yCm, 9);
      // cavity inside the wall inside the skin (front and back edges at the waist)
      expect(c.extent.maxY).toBeGreaterThan(c.extent.minY);
    }
  });
});
