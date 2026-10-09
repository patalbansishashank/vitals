// Waist-slice geometry (R2 sec. 3.3 / 3.4): exact areas, nesting, the anatomy's parts, monotone response, finite
// everywhere.
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
  ellipseRadius,
  polarArea,
  polarPoints,
  polygonArea,
  radiusAt,
  sliceGeometry,
  BACK,
  FRONT,
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

  it('radiusAt interpolates between grid samples and wraps', () => {
    const r = Array.from({ length: SAMPLES }, (_, i) => i);
    expect(radiusAt(r, 0)).toBe(0);
    expect(radiusAt(r, (2 * Math.PI * 10.5) / SAMPLES)).toBeCloseTo(10.5, 9);
    expect(radiusAt(r, 2 * Math.PI + (2 * Math.PI * 3) / SAMPLES)).toBeCloseTo(3, 9);
  });
});

describe('sliceGeometry', () => {
  it('every layer matches its engine area within 0.5 % (scaled to the polygon)', () => {
    for (const kg of [0.3, 1, 2.82, 5]) {
      const v = paramsVat(kg).visceral;
      const g = sliceGeometry(v);
      const k = g.areas.outer / (Math.PI * v.waist.halfWidthCm * v.waist.halfDepthCm);
      expect(rel(g.areas.outer, Math.PI * v.waist.halfWidthCm * v.waist.halfDepthCm), `outer ${kg}`).toBeLessThan(
        0.002,
      );
      expect(rel(g.areas.outer - g.areas.wallOuter, v.satAreaCm2 * k), `sat ${kg}`).toBeLessThan(0.005);
      expect(rel(g.areas.cavity, (v.vatAreaCm2 + v.organsAreaCm2) * k), `cavity ${kg}`).toBeLessThan(0.005);
      expect(rel(g.areas.organs, v.organsAreaCm2 * k), `organs ${kg}`).toBeLessThan(0.005);
      expect(rel(g.areas.vat, v.vatAreaCm2 * k), `vat ${kg}`).toBeLessThan(0.01);
      // muscle = what the wall holds besides the cavity and the vertebral body: the engine's wall plus the rest of
      // the spine (the posterior elements are drawn inside the back muscles)
      expect(rel(g.areas.muscle, (v.wallAreaCm2 + 0.2 * v.spineAreaCm2) * k), `muscle ${kg}`).toBeLessThan(0.01);
    }
  });

  it('draws the anatomy: vertebra behind the cavity, psoas beside it, vessels in front, bowel and colon loops', () => {
    const g = sliceGeometry(paramsVat(2.82).visceral);
    const { spine, psoas } = g;
    // the vertebral body sits in the back half, a back-muscle depth in front of the muscle's back surface
    expect(spine.cy).toBeGreaterThan(0);
    expect(spine.cy + spine.ry).toBeLessThan(g.radii.wallOuter[BACK]!);
    expect(psoas[0].cx).toBeLessThan(-spine.rx * 0.9);
    expect(psoas[1].cx).toBeGreaterThan(spine.rx * 0.9);
    expect(psoas[0].cx).toBeCloseTo(-psoas[1].cx, 9);
    // aorta on the viewer's right (the body's left), vena cava on the left, both just in front of the spine
    expect(g.vessels).not.toBeNull();
    expect(g.vessels!.aorta.cx).toBeGreaterThan(0);
    expect(g.vessels!.ivc.cx).toBeLessThan(0);
    expect(g.vessels!.aorta.cy).toBeLessThan(spine.cy - spine.ry);
    const kinds = g.loops.map((l) => l.kind);
    expect(kinds.filter((k) => k === 'colon')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'bowel').length).toBeGreaterThanOrEqual(10);
    // the cavity reaches round the spine: its back edge beside the psoas is behind the vertebral body's front
    const behindPsoas = Math.max(...g.cavity.filter(([x]) => Math.abs(x) > psoas[1].cx + psoas[1].rx).map(([, y]) => y));
    expect(behindPsoas).toBeGreaterThan(spine.cy - spine.ry);
  });

  it('little deep fat packs the loops; much deep fat leaves them their size in a sea of fat', () => {
    const lean = sliceGeometry(paramsVat(0.3).visceral);
    const high = sliceGeometry(paramsVat(5).visceral);
    const meanLoop = (g: typeof lean) =>
      g.loops.filter((l) => l.kind === 'bowel').reduce((s, l) => s + polygonArea(l.pts), 0) /
      Math.max(g.loops.filter((l) => l.kind === 'bowel').length, 1);
    // loops fill most of a lean cavity, a small share of a fat one
    expect(lean.areas.organs / lean.areas.cavity).toBeGreaterThan(0.6);
    expect(high.areas.organs / high.areas.cavity).toBeLessThan(0.4);
    // and a loop keeps roughly its size (the organs do not shrink with the fat)
    expect(meanLoop(high) / meanLoop(lean)).toBeGreaterThan(0.6);
    expect(meanLoop(high) / meanLoop(lean)).toBeLessThan(1.6);
  });

  it('contours are nested and finite over a body matrix', () => {
    for (const { name, p } of bodies()) {
      const g = sliceGeometry(p.visceral);
      const r = g.radii;
      for (let i = 0; i < SAMPLES; i++) {
        expect(r.wallOuter[i]!, name).toBeLessThanOrEqual(r.outer[i]! + 1e-9);
        expect(r.cavity[i]!, name).toBeLessThanOrEqual(r.wallOuterO[i]! + 1e-9);
        expect(r.cavity[i]!, name).toBeGreaterThan(0);
      }
      for (const pts of [g.outer, g.wallOuter, g.cavity, ...g.refs, ...g.halo, ...g.loops.map((l) => l.pts)])
        for (const [x, y] of pts) expect(Number.isFinite(x) && Number.isFinite(y), name).toBe(true);
      expect(Number.isFinite(g.spine.r) && g.spine.r > 0, name).toBe(true);
      // the cavity holds its target; on the smallest bodies (BMI 16) the spine and psoas leave up to 8 % less room
      const bmi16 = name.includes('BMI16');
      const k = g.areas.outer / (Math.PI * p.visceral.waist.halfWidthCm * p.visceral.waist.halfDepthCm);
      expect(rel(g.areas.cavity, (p.visceral.vatAreaCm2 + p.visceral.organsAreaCm2) * k), name).toBeLessThan(bmi16 ? 0.08 : 0.01);
    }
  });

  it('the cavity and its deep fat grow monotonically with vatKg', () => {
    let last = -1;
    let lastCavity = -1;
    for (const kg of [0, 0.5, 1, 1.5, 2, 3, 4, 6]) {
      const g = sliceGeometry(paramsVat(kg).visceral);
      expect(g.areas.vat).toBeGreaterThan(last);
      expect(g.areas.cavity).toBeGreaterThan(lastCavity);
      last = g.areas.vat;
      lastCavity = g.areas.cavity;
    }
  });

  it('fat under the skin is thicker over the belly than over the spine; the outline is wider than deep', () => {
    const g = sliceGeometry(paramsVat(2).visceral);
    const r = g.radii;
    expect(r.outer[FRONT]! - r.wallOuter[FRONT]!).toBeGreaterThan(r.outer[BACK]! - r.wallOuter[BACK]!);
    const xs = g.outer.map((p) => p[0]);
    const ys = g.outer.map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(Math.max(...ys) - Math.min(...ys));
  });

  it('is stable: identical params give identical contours (no flicker)', () => {
    expect(sliceGeometry(paramsVat(2).visceral)).toEqual(sliceGeometry(paramsVat(2).visceral));
  });

  it('a small change of the numbers moves the drawing a little (smooth easing, no jumps)', () => {
    const a = sliceGeometry(paramsVat(2).visceral);
    const b = sliceGeometry(paramsVat(2.02).visceral);
    expect(b.loops.length).toBe(a.loops.length);
    const scale = a.a;
    a.loops.forEach((l, i) => {
      const m = b.loops[i]!;
      expect(Math.hypot(l.c[0] - m.c[0], l.c[1] - m.c[1]) / scale).toBeLessThan(0.03);
    });
  });
});

describe('reference outlines and the likely-range band', () => {
  it('the 100 and 130 outlines hold organs + 100 / 130 cm2 (within 0.5 %)', () => {
    const p = paramsVat(1.5);
    const g = sliceGeometry(p.visceral);
    const k = g.areas.outer / (Math.PI * p.visceral.waist.halfWidthCm * p.visceral.waist.halfDepthCm);
    const organs = p.visceral.organsAreaCm2 * k;
    expect(rel(polygonArea(g.refs[0]) - organs, 100 * k)).toBeLessThan(0.005);
    expect(rel(polygonArea(g.refs[1]) - organs, 130 * k)).toBeLessThan(0.005);
  });

  it('the band runs from the low to the high end of the range, around the cavity, inside the muscle', () => {
    for (const { name, p } of bodies()) {
      const g = sliceGeometry(p.visceral);
      const [lo, hi] = g.halo;
      expect(polygonArea(lo), name).toBeLessThanOrEqual(g.areas.cavity + 1e-6);
      expect(polygonArea(hi), name).toBeGreaterThanOrEqual(polygonArea(lo) - 1e-6);
      // never into the layer you can pinch
      const [ox, oy] = g.origin;
      hi.forEach(([x, y], i) => expect(Math.hypot(x - ox, y - oy), name).toBeLessThanOrEqual(g.radii.wallOuterO[i]! + 1e-9));
    }
  });
});
