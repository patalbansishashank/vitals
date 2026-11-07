/**
 * The Vitals mark, the plan ring: an ivory ring left open at four o'clock, a hairline bezel across the opening and a
 * gold dot inside aimed at it. The numbers come from mark-geometry.ts, which design/brand/vitals-mark.py writes from
 * the same geometry as every icon; this file adds the palette and the draw-on timing. Units are the mark's 24-unit
 * design space (centre 12,12, outer edge 9.95), the same one Gauge's reading ring uses.
 */
import { CROP, MEDIUM, MEDIUM_CUT_MAX_PX, SMALL, SMALL_CUT_MAX_PX, STANDARD } from './mark-geometry';

export { BISECTOR_DEG, CENTRE, CROP, GRID, MEDIUM, MEDIUM_CUT_MAX_PX, MONO, NOTIFICATION, OUTER, SMALL, SMALL_CUT_MAX_PX, STANDARD } from './mark-geometry';

export const CROP_VIEWBOX = `${CROP.x} ${CROP.y} ${CROP.size} ${CROP.size}`;

export interface MarkCut {
  /** The hairline bezel, a full circle under the ring; null in the small cut. */
  readonly track: { readonly r: number; readonly stroke: number; readonly opacity: number } | null;
  /** The ring: one clockwise arc from just after the opening round to it, round caps. */
  readonly ring: { readonly d: string; readonly r: number; readonly stroke: number; readonly openDeg: number; readonly length: number };
  /** The gold dot inside the ring, on the opening's bisector; `edge` is its ink outline on light grounds. */
  readonly dot: { readonly cx: number; readonly cy: number; readonly r: number; readonly edge: number };
}

/** The cut for a mark drawn `sizePx` wide: heavier strokes and a wider opening as it gets small. */
export const cutFor = (sizePx: number): MarkCut => (sizePx <= SMALL_CUT_MAX_PX ? SMALL : sizePx <= MEDIUM_CUT_MAX_PX ? MEDIUM : STANDARD);

/**
 * The Ember palette, Vitals' only one (dark only): the backdrop, the ivory ring and bezel and the gold dot, no edge.
 * RingMark's `auto` tone resolves to these through --lm-chassis / --lm-ink / --lm-signal; the pre-JS start screen
 * (public/brand/launch.css), every icon and tile, the Android launcher and splash and the brand cards write them out
 * (design/brand/vitals-mark.py EMBER).
 */
export const EMBER = { ground: '#090909', ink: '#f5f1e9', signal: '#e3bf78', edge: null } as const;

/**
 * Fixed colours of the transparent brand files for a known ground (public/brand/mark*.svg, the lockups, the tray
 * icons; vitals-mark.py LIGHT). `dark` is Ember; `light` is for a light page: the Ember ground colour as the ink and
 * a thin edge of it round the gold dot. `auto` reads the --lm-* tokens instead.
 */
export const PALETTE = {
  light: { ground: EMBER.ink, ink: EMBER.ground, signal: EMBER.signal, edge: EMBER.ground },
  dark: EMBER,
} as const;

/**
 * The draw-on, in ms from the moment the mark appears: the bezel is there at once, the ring draws round it from 5 %
 * to the full arc, then the dot pops from its own centre with one damped overshoot. The whole thing ends under 1 s.
 * public/brand/launch.css and the Android splash use the same numbers; the tests keep them in step.
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
