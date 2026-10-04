/**
 * The Vitals mark's geometry, mirrored from public/brand/mark.svg (standard cut) and mark-small.svg (48 px and under).
 * The SVGs stay the source of truth: __tests__/geometry.test.ts reads them and fails when a number here drifts.
 * Everything is in the 108-unit grid both SVGs are drawn on (ring centre 54,54, radius 30).
 */

export const GRID = 108;
export const RING_CENTRE = 54;
export const RING_RADIUS = 30;

/**
 * Crop used by RingMark and the start screen: the ring's outer edge (54 ± 35 in the small cut) plus a 1-unit margin,
 * so a mark's `size` is the visible ring and not the Android icon grid's safe zone around it.
 */
export const CROP = { x: 18, y: 18, size: 72 } as const;
export const CROP_VIEWBOX = `${CROP.x} ${CROP.y} ${CROP.size} ${CROP.size}`;

/** Marks at this size and under use the small cut (heavier stroke, wider opening). */
export const SMALL_CUT_MAX_PX = 32;

export interface MarkCut {
  /** The open ring: one arc, round caps, drawn clockwise from the end nearest the dot. */
  ring: { d: string; stroke: number; sweepDeg: number; length: number };
  /** The signal dot on the bisector of the opening; `edge` is the ink outline width on light grounds. */
  dot: { cx: number; cy: number; r: number; edge: number };
}

/** Degrees swept by `M x0,y0 A r,r 0 1 1 x1,y1` (large arc, clockwise in SVG's y-down space) around the ring centre. */
export function arcSweepDeg(d: string): number {
  const nums = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  const [x0, y0, , , , , , x1, y1] = nums;
  if (nums.length !== 9 || x0 === undefined || y0 === undefined || x1 === undefined || y1 === undefined) {
    throw new Error(`mark geometry: unexpected ring path "${d}"`);
  }
  const deg = (x: number, y: number) => (Math.atan2(y - RING_CENTRE, x - RING_CENTRE) * 180) / Math.PI;
  const sweep = (deg(x1, y1) - deg(x0, y0) + 360) % 360;
  return Math.round(sweep * 100) / 100;
}

/** Length of the ring's arc in grid units (what stroke-dasharray needs for the draw-on). */
export const arcLength = (sweepDeg: number): number => Math.round(((RING_RADIUS * Math.PI * sweepDeg) / 180) * 100) / 100;

function cut(d: string, stroke: number, dot: MarkCut['dot']): MarkCut {
  const sweepDeg = arcSweepDeg(d);
  return { ring: { d, stroke, sweepDeg, length: arcLength(sweepDeg) }, dot };
}

/** mark.svg: stroke 7, opening 23.46 degrees, dot r 6.5 with a 1.5 edge. */
export const STANDARD: MarkCut = cut('M74.56,75.84 A30,30 0,1 1,81.56,65.85', 7, { cx: 67.93, cy: 63.75, r: 6.5, edge: 1.5 });

/** mark-small.svg: stroke 10, opening widened to 34 degrees, dot r 7.5 with a 2.5 edge. */
export const SMALL: MarkCut = cut('M72.47,77.64 A30,30 0,1 1,82.53,63.27', 10, { cx: 66.29, cy: 62.6, r: 7.5, edge: 2.5 });

export const cutFor = (sizePx: number): MarkCut => (sizePx <= SMALL_CUT_MAX_PX ? SMALL : STANDARD);

/** Fixed colours for a known ground (scripts/brand/mark.mjs PALETTE); `auto` reads the --lm-* tokens instead. */
export const PALETTE = {
  light: { ground: '#e8eaec', ink: '#191c20', signal: '#f5d336', edge: '#191c20' },
  dark: { ground: '#151618', ink: '#eff0f2', signal: '#f0d03c', edge: null },
} as const;

/**
 * Lumen's draw-on, in ms from the moment the mark appears: the ring draws from 5 % to the full arc, then the dot pops
 * from its own centre with one damped overshoot. The whole thing ends under 1 s. public/brand/launch.css repeats these
 * numbers for the pre-JS start screen; the tests keep the two in step.
 */
export const DRAW_ON = {
  trimFrom: 0.05,
  ringMs: 500,
  ringEase: 'cubic-bezier(0.4, 0, 0.2, 1)',
  dotDelayMs: 420,
  dotMs: 220,
  dotEase: 'cubic-bezier(0.34, 1.36, 0.64, 1)',
} as const;

/** Stroke-dashoffset of a ring with `trimFrom` of its length showing. */
export const trimOffset = (c: MarkCut): number => Math.round(c.ring.length * (1 - DRAW_ON.trimFrom) * 100) / 100;
