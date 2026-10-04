// Tape measure maths, and agreement with the offline copy used by the bake.
import { cutRing as cutOffline, hullPerimeter } from '../../../../../scripts/figure/lib/rings';
import { cutRing, hullMeasure } from '../measure';
import type { RingDef } from '../manifest';

/** A closed cylinder of radius r (n sides, k rings from y=0 to y=10) as positions + edge list. */
function cylinder(r: number, n = 48, k = 5) {
  const P: number[] = [];
  const edges: number[] = [];
  for (let j = 0; j < k; j++) for (let i = 0; i < n; i++) P.push(r * Math.cos((2 * Math.PI * i) / n), (10 * j) / (k - 1), r * Math.sin((2 * Math.PI * i) / n));
  for (let j = 0; j + 1 < k; j++) for (let i = 0; i < n; i++) edges.push(j * n + i, (j + 1) * n + i, j * n + i, j * n + ((i + 1) % n));
  return { P, edges };
}

describe('tape measure', () => {
  it('hull perimeter of a polygon inscribed in a circle approaches 2 pi r', () => {
    const xy: number[] = [];
    for (let i = 0; i < 360; i++) xy.push(10 * Math.cos((i * Math.PI) / 180), 10 * Math.sin((i * Math.PI) / 180));
    const m = hullMeasure(xy);
    expect(m.girth).toBeCloseTo(2 * Math.PI * 10, 1);
    expect(m.width).toBeCloseTo(20, 3);
    expect(m.depth).toBeCloseTo(20, 2);
  });

  it('bridges concavities like a tape (convex hull, not the polyline)', () => {
    // a square with a deep notch: the tape spans the notch
    const xy = [0, 0, 10, 0, 10, 10, 6, 10, 5, 2, 4, 10, 0, 10];
    expect(hullMeasure(xy).girth).toBeCloseTo(40, 6);
  });

  it('cuts a cylinder at the anchor plane to its circumference, same as the offline copy', () => {
    const { P, edges } = cylinder(15);
    const ring: RingDef = { id: 'waist', anchor: 2 * 48 + 7, normal: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1], edges };
    // tilt the plane slightly: the anchor is on the middle ring, the plane passes through it
    const pts = cutRing(P, ring);
    const g = hullMeasure(pts).girth;
    expect(g).toBeGreaterThan(2 * Math.PI * 15 * 0.995);
    expect(g).toBeLessThan(2 * Math.PI * 15);
    expect(hullPerimeter(cutOffline(P, ring))).toBeCloseTo(g, 9);
  });

  it('reads through a slot map (fitter subset)', () => {
    const { P, edges } = cylinder(8);
    const ring: RingDef = { id: 'arm', anchor: 48, normal: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1], edges };
    const shifted = [0, 0, 0, ...P];
    expect(hullMeasure(cutRing(shifted, ring, (v) => v + 1)).girth).toBeCloseTo(hullMeasure(cutRing(P, ring)).girth, 9);
  });
});
