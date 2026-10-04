// Geometry of the parametric avatar (AVATAR_SPEC §3-§5, §9, §10.3): path validity, symmetry, stable topology,
// monotonic response to fat and muscle, layer containment, no self-intersection, arm clearance, and finite numbers for
// every engine output across the input space.
import {
  allocateRegional,
  frameForSex,
  liveEstimate,
  stateToAvatarParams,
  type AvatarParams,
  type BodyEstimate,
  type BodyInputs,
  type BodySliders,
  type BodyState,
  type Sex,
} from '@/engine/body';
import { avatarGeometry, lerpGeometry, lerpPts, maxDisplacement, pathD, sectionsFrom, type AvatarGeometry, type Pt } from './geometry';

// ------------------------------------------------------------------------------------------------ helpers

/** Flatten a pathD string (M + C segments) into a polygon, sampling each cubic. */
function samplePath(d: string, perSeg = 8): Pt[] {
  const nums = d.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g)?.map(Number) ?? [];
  const out: Pt[] = [];
  let x0 = nums[0]!;
  let y0 = nums[1]!;
  out.push([x0, y0]);
  for (let i = 2; i + 5 < nums.length + 0; i += 6) {
    const [x1, y1, x2, y2, x3, y3] = nums.slice(i, i + 6) as [number, number, number, number, number, number];
    for (let k = 1; k <= perSeg; k++) {
      const t = k / perSeg;
      const u = 1 - t;
      out.push([
        u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
        u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
      ]);
    }
    x0 = x3;
    y0 = y3;
  }
  return out;
}

function segIntersect(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a);
  const d2 = o(c, d, b);
  const d3 = o(a, b, c);
  const d4 = o(a, b, d);
  return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
}

/** Number of proper crossings between non-adjacent edges of a closed polygon. */
function selfIntersections(poly: Pt[]): number {
  const n = poly.length;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % n]!;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segIntersect(a, b, poly[j]!, poly[(j + 1) % n]!)) count++;
    }
  }
  return count;
}

function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distToPolygon(p: Pt, poly: Pt[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const vx = b[0] - a[0];
    const vy = b[1] - a[1];
    const len2 = vx * vx + vy * vy || 1e-12;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2));
    best = Math.min(best, Math.hypot(p[0] - a[0] - t * vx, p[1] - a[1] - t * vy));
  }
  return best;
}

const allOutlines = (g: AvatarGeometry): Pt[][] => [
  g.front.body.envelope,
  g.front.body.core,
  ...g.front.arms.envelope,
  ...g.front.arms.core,
  g.front.head,
  g.side.body.envelope,
  g.side.body.core,
  g.side.head,
  g.side.visceral,
  ...g.front.definition.map((s) => s.pts),
];

function allNumbers(g: AvatarGeometry): number[] {
  const out: number[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'number') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(g);
  return out;
}

function estimate(sex: Sex, ageYears: number, heightCm: number, bmi: number, sliders?: BodySliders, waistCm?: number): BodyEstimate {
  const h = heightCm / 100;
  const inputs: BodyInputs = { sex, ageYears, heightCm, weightKg: bmi * h * h, sliders, waistCm };
  return liveEstimate(inputs);
}

const paramsOf = (e: BodyEstimate) => stateToAvatarParams(e);

// ------------------------------------------------------------------------------------------------ input space

const SEXES: Sex[] = ['male', 'female'];
const SLIDER_SETS: (BodySliders | undefined)[] = [
  undefined,
  { adiposity: 0, muscularity: 0, bellyVsHips: -1, chest: -1, arms: -1, face: -1, muscleArms: -1, muscleLegs: -1, muscleTorso: -1 },
  { adiposity: 1, muscularity: 1, bellyVsHips: 1, chest: 1, arms: 1, face: 1, muscleArms: 1, muscleLegs: 1, muscleTorso: 1 },
  { adiposity: 1, muscularity: 0, bellyVsHips: 1, chest: -1, arms: 1, face: 1, muscleArms: -1, muscleLegs: -1, muscleTorso: -1 },
  { adiposity: 0, muscularity: 1, bellyVsHips: -1, chest: 1, arms: -1, face: -1, muscleArms: 1, muscleLegs: 1, muscleTorso: 1 },
];

interface Case {
  name: string;
  params: AvatarParams;
  /** Drawing frame 0..1 (0 = hips-led, 1 = shoulders-led). */
  frame: number;
}

function inputSpace(): Case[] {
  const cases: Case[] = [];
  for (const sex of SEXES)
    for (const age of [18, 45, 80])
      for (const bmi of [16, 22, 30, 40, 50])
        for (const heightCm of [150, 200])
          for (const [k, sliders] of SLIDER_SETS.entries()) {
            const e = estimate(sex, age, heightCm, bmi, sliders);
            cases.push({ name: `${sex} ${age}y ${heightCm}cm BMI${bmi} s${k}`, params: paramsOf(e), frame: frameForSex(sex) });
          }
  // measured-waist extremes (anchored circumferences)
  for (const sex of SEXES)
    for (const waist of [55, 160]) {
      const e = estimate(sex, 40, 175, 30, undefined, waist);
      cases.push({ name: `${sex} waist ${waist}`, params: paramsOf(e), frame: frameForSex(sex) });
    }
  return cases;
}

/** AVATAR_SPEC §9 corner cases: fat {lean, mid, max} x distribution {-1, 0, +1} x muscle {0, 1} x frame {0, 0.5, 1}. */
function cornerCases(): Case[] {
  const cases: Case[] = [];
  for (const sex of SEXES)
    for (const adiposity of [0, 0.5, 1])
      for (const dist of [-1, 0, 1])
        for (const muscularity of [0, 1])
          for (const frame of [0, 0.5, 1]) {
            const sliders: BodySliders = { adiposity, muscularity, bellyVsHips: dist, chest: dist, arms: dist, face: dist };
            const e = estimate(sex, 40, sex === 'male' ? 178 : 165, adiposity === 1 ? 38 : adiposity === 0 ? 20 : 26, sliders);
            cases.push({ name: `${sex} fat${adiposity} dist${dist} mus${muscularity} frame${frame}`, params: paramsOf(e), frame });
          }
  return cases;
}

const SPACE = inputSpace();
const CORNERS = cornerCases();

// ------------------------------------------------------------------------------------------------ tests

describe('pathD', () => {
  it('writes a closed centripetal Catmull-Rom path of cubic segments, one per point', () => {
    const pts: Pt[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const d = pathD(pts);
    expect(d).toMatch(/^M-?[\d.]+,-?[\d.]+(C-?[\d.]+,-?[\d.]+ -?[\d.]+,-?[\d.]+ -?[\d.]+,-?[\d.]+){4}Z$/);
    const open = pathD(pts, false);
    expect(open.endsWith('Z')).toBe(false);
    expect(open.match(/C/g)).toHaveLength(3);
  });

  it('never emits NaN, even for degenerate or non-finite input', () => {
    const d = pathD([
      [0, 0],
      [0, 0],
      [Number.NaN, 5],
      [Infinity, 1],
    ]);
    expect(d).not.toMatch(/NaN|Infinity/);
  });
});

describe('finite, valid geometry across the input space (both sexes, 18-80 y, BMI 16-50, slider extremes)', () => {
  it(`covers ${SPACE.length} bodies with finite numbers and valid paths`, () => {
    for (const c of SPACE) {
      const g = avatarGeometry(c.params, { frame: c.frame });
      const nums = allNumbers(g);
      const bad = nums.filter((v) => !Number.isFinite(v));
      expect(bad, c.name).toHaveLength(0);
      for (const o of allOutlines(g)) {
        const d = pathD(o);
        expect(d, c.name).not.toMatch(/NaN|Infinity/);
        expect(d, c.name).toMatch(/^M-?[\d.]+,-?[\d.]+(C[-\d., ]+)+Z$/);
      }
    }
  });

  it('keeps a stable point topology for every body (paths interpolate cleanly)', () => {
    const shape = (g: AvatarGeometry) => allOutlines(g).map((o) => o.length);
    const ref = shape(avatarGeometry(SPACE[0]!.params));
    for (const c of [...SPACE, ...CORNERS]) expect(shape(avatarGeometry(c.params, { frame: c.frame })), c.name).toEqual(ref);
  });

  it('is symmetric in the front view', () => {
    for (const c of CORNERS) {
      const g = avatarGeometry(c.params, { frame: c.frame });
      for (const o of [g.front.body.envelope, g.front.body.core]) {
        const n = o.length;
        expect(n % 2, c.name).toBe(1);
        for (let k = 0; k < n; k++) {
          expect(o[k]![0], c.name).toBeCloseTo(-o[n - 1 - k]![0], 9);
          expect(o[k]![1], c.name).toBeCloseTo(o[n - 1 - k]![1], 9);
        }
        expect(o[(n - 1) / 2]![0]).toBe(0);
      }
      const [r, l] = g.front.arms.envelope;
      r.forEach((p, i) => {
        expect(l[i]![0]).toBeCloseTo(-p[0], 9);
        expect(l[i]![1]).toBeCloseTo(p[1], 9);
      });
    }
  });

  it('runs a torso outline monotonically down the outer edge and up the inner leg', () => {
    for (const c of CORNERS) {
      const env = avatarGeometry(c.params, { frame: c.frame }).front.body.envelope;
      const half = env.slice(0, (env.length + 1) / 2); // right side incl. crotch apex
      // outer edge: neck top -> ankle (first 20 points) strictly descending
      for (let i = 1; i < 20; i++) expect(half[i]![1], `${c.name} #${i}`).toBeLessThan(half[i - 1]![1]);
      // inner edge: ankle -> crotch apex (last 9 points) strictly ascending
      const inner = half.slice(-9);
      for (let i = 1; i < inner.length; i++) expect(inner[i]![1], c.name).toBeGreaterThan(inner[i - 1]![1]);
    }
  });
});

describe('two layers', () => {
  it('keeps the lean core inside the envelope at every station (front and side, torso, legs and arms)', () => {
    for (const c of CORNERS) {
      const g = avatarGeometry(c.params, { frame: c.frame });
      const pairs: [Pt[], Pt[]][] = [
        [g.front.body.core, g.front.body.envelope],
        [g.front.arms.core[0], g.front.arms.envelope[0]],
        [g.side.body.core, g.side.body.envelope],
      ];
      for (const [core, env] of pairs) {
        const envPoly = samplePath(pathD(env));
        for (const p of core) {
          const ok = pointInPolygon(p, envPoly) || distToPolygon(p, envPoly) < 0.12;
          expect(ok, `${c.name} core point ${p.map((v) => v.toFixed(1)).join(',')}`).toBe(true);
        }
      }
    }
  });

  it('never self-intersects (sampled Bezier outlines, AVATAR_SPEC §9)', () => {
    for (const c of CORNERS) {
      const g = avatarGeometry(c.params, { frame: c.frame });
      const outlines: [string, Pt[]][] = [
        ['front envelope', g.front.body.envelope],
        ['front core', g.front.body.core],
        ['arm envelope', g.front.arms.envelope[0]],
        ['arm core', g.front.arms.core[0]],
        ['side envelope', g.side.body.envelope],
        ['side core', g.side.body.core],
        ['head', g.front.head],
      ];
      for (const [name, o] of outlines) expect(selfIntersections(samplePath(pathD(o))), `${c.name} ${name}`).toBe(0);
    }
  });

  it('keeps the elbow and forearm clear of the torso (arms open for large bodies)', () => {
    for (const c of [...CORNERS, ...SPACE.filter((_, i) => i % 3 === 0)]) {
      const g = avatarGeometry(c.params, { frame: c.frame });
      const torso = samplePath(pathD(g.front.body.envelope));
      const arm = samplePath(pathD(g.front.arms.envelope[0]));
      const H = g.heightCm;
      // the elbow-to-forearm band (the upper arm may touch the chest, the hand may rest on the hip, as real arms do)
      const band = arm.filter((p) => p[1] < 0.64 * H && p[1] > 0.55 * H);
      for (const p of band) {
        expect(pointInPolygon(p, torso), `${c.name} at y=${p[1].toFixed(1)}`).toBe(false);
        expect(distToPolygon(p, torso), `${c.name} at y=${p[1].toFixed(1)}`).toBeGreaterThan(0.2);
      }
      expect(g.front.armAngleDeg).toBeGreaterThanOrEqual(c.params.armAngleDeg - 1e-9);
    }
  });
});

describe('monotonic response', () => {
  function change(s: BodyEstimate, dFat: number, dSm: number): BodyState {
    const fm = s.fatMassKg + dFat;
    const sm = s.skeletalMuscleKg + dSm;
    const ffm = s.fatFreeMassKg + dSm / 0.9;
    const r = allocateRegional({ fat: s.fat, muscle: s.muscle }, { fatMassKg: fm, skeletalMuscleKg: sm });
    return { ...s, fatMassKg: fm, fatFreeMassKg: ffm, weightKg: fm + ffm, skeletalMuscleKg: sm, fat: r.fat, muscle: r.muscle, measuredCircumferences: undefined };
  }

  it('more trunk fat -> wider waist envelope (front width and side depth)', () => {
    for (const sex of SEXES) {
      let prev = -Infinity;
      let prevDepth = -Infinity;
      for (const s of [-1, -0.5, 0, 0.5, 1]) {
        const e = estimate(sex, 40, 172, 27, { adiposity: 0.5, bellyVsHips: s });
        const g = avatarGeometry(paramsOf(e));
        const w = g.front.landmarks.waist.halfWidth;
        const depth = g.side.landmarks.waist.front + g.side.landmarks.waist.back;
        expect(w, `${sex} belly ${s}`).toBeGreaterThan(prev);
        expect(depth, `${sex} belly ${s}`).toBeGreaterThan(prevDepth);
        prev = w;
        prevDepth = depth;
      }
      // and absolute fat gain widens it too (simulated state against its baseline)
      const base = estimate(sex, 40, 172, 24);
      let last = avatarGeometry(stateToAvatarParams(base)).front.landmarks.waist.halfWidth;
      for (const dFat of [3, 6, 9, 12]) {
        const w = avatarGeometry(stateToAvatarParams(change(base, dFat, 0), { baseline: base })).front.landmarks.waist.halfWidth;
        expect(w, `${sex} +${dFat} kg fat`).toBeGreaterThan(last);
        last = w;
      }
    }
  });

  it('fat gain thickens the shell, not the core', () => {
    const base = estimate('male', 40, 178, 24);
    const s0 = sectionsFrom(stateToAvatarParams(base));
    const s1 = sectionsFrom(stateToAvatarParams(change(base, 10, 0), { baseline: base }));
    expect(s1.waist.shell).toBeGreaterThan(s0.waist.shell);
    expect(s1.hip.shell).toBeGreaterThan(s0.hip.shell);
    expect(s1.waist.c).toBeCloseTo(s0.waist.c, 0);
  });

  it('more muscle -> wider lean core at the shoulders, arms and thighs', () => {
    for (const sex of SEXES) {
      const base = estimate(sex, 30, sex === 'male' ? 180 : 166, 22);
      let prev: ReturnType<typeof sectionsFrom> | null = null;
      for (const dSm of [0, 2, 4, 6, 8]) {
        const p = stateToAvatarParams(change(base, 0, dSm), { baseline: base });
        const s = sectionsFrom(p);
        if (prev) {
          expect(s.shoulder.c, `${sex} +${dSm} shoulder`).toBeGreaterThan(prev.shoulder.c);
          expect(s.upperArm.c, `${sex} +${dSm} arm`).toBeGreaterThan(prev.upperArm.c);
          expect(s.thigh.c, `${sex} +${dSm} thigh`).toBeGreaterThan(prev.thigh.c);
          expect(s.chest.c, `${sex} +${dSm} chest`).toBeGreaterThan(prev.chest.c);
        }
        prev = s;
      }
      // and the drawn core outline follows: the arm core is wider at the biceps
      const g0 = avatarGeometry(stateToAvatarParams(base));
      const g1 = avatarGeometry(stateToAvatarParams(change(base, 0, 8), { baseline: base }));
      const armWidth = (g: AvatarGeometry) => {
        const pts = g.front.arms.core[0];
        const xs = pts.map((q) => q[0]);
        return Math.max(...xs) - Math.min(...xs);
      };
      expect(armWidth(g1)).toBeGreaterThan(armWidth(g0));
    }
  });

  it('the muscularity slider (fixed weight) trades shell for core', () => {
    const lo = sectionsFrom(paramsOf(estimate('male', 30, 180, 25, { muscularity: 0.1 })));
    const hi = sectionsFrom(paramsOf(estimate('male', 30, 180, 25, { muscularity: 0.9 })));
    expect(hi.muscularity).toBeGreaterThan(lo.muscularity);
    expect(hi.waist.shell).toBeLessThan(lo.waist.shell);
    expect(hi.upperArm.c).toBeGreaterThan(lo.upperArm.c);
  });
});

describe('frame and interpolation', () => {
  it('frame changes only the drawing: landmarks stay on the engine girths', () => {
    const p = paramsOf(estimate('female', 35, 165, 24));
    const f = avatarGeometry(p, { frame: 0 });
    const n = avatarGeometry(p, { frame: 0.5 });
    const m = avatarGeometry(p, { frame: 1 });
    expect(f.front.landmarks.waist.y).toBe(m.front.landmarks.waist.y);
    expect(maxDisplacement(f, m)).toBeGreaterThan(0.3);
    // the middle frame sits between the two templates at the bust (side view chest front is the same engine value)
    expect(n.side.landmarks.chest.front).toBeCloseTo(f.side.landmarks.chest.front, 9);
  });

  it('continuous frame: clamped, carried on the geometry, default from params.figure.frame', () => {
    const p = paramsOf(estimate('female', 35, 165, 24));
    expect(avatarGeometry(p, { frame: -2 }).front).toEqual(avatarGeometry(p, { frame: 0 }).front);
    expect(avatarGeometry(p, { frame: 9 }).front).toEqual(avatarGeometry(p, { frame: 1 }).front);
    expect(avatarGeometry(p, { frame: 0.8 }).frame).toBe(0.8);
    const custom: AvatarParams = { ...p, figure: { ...p.figure, frame: 1 } };
    expect(avatarGeometry(custom).front).toEqual(avatarGeometry(p, { frame: 1 }).front);
    // a mid frame lies between the two templates
    const d0 = maxDisplacement(avatarGeometry(p, { frame: 0 }), avatarGeometry(p, { frame: 0.3 }));
    const d1 = maxDisplacement(avatarGeometry(p, { frame: 0 }), avatarGeometry(p, { frame: 1 }));
    expect(d0).toBeGreaterThan(0);
    expect(d0).toBeLessThan(d1);
  });

  it('interpolates geometries point by point', () => {
    const a = avatarGeometry(paramsOf(estimate('male', 40, 178, 22)));
    const b = avatarGeometry(paramsOf(estimate('male', 40, 178, 34)));
    const mid = lerpGeometry(a, b, 0.5);
    expect(mid.front.body.envelope).toHaveLength(a.front.body.envelope.length);
    expect(mid.front.body.envelope[5]![0]).toBeCloseTo((a.front.body.envelope[5]![0] + b.front.body.envelope[5]![0]) / 2, 9);
    expect(lerpPts(a.side.head, b.side.head, 0)).toEqual(a.side.head);
    expect(maxDisplacement(a, a)).toBe(0);
    expect(() => lerpPts([[0, 0]], [], 0.5)).toThrow();
  });
});
