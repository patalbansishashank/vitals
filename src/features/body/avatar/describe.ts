// Generated accessible description of the figure (AVATAR_SPEC §7.8, body-figure-v2.md §8). Plain words, no
// weight-category labels, and no sex or gender words: the drawing's frame is described by its shape (R2 sec. 4.3). The
// same text names the SVG figure and the 3D figure (both draw the same proportions), the two-layer and ghost states and,
// when shown, the visceral view.

import type { AvatarParams, AvatarVisceral, VisceralBand } from '@/engine/body';
import { FFMI_ANCHOR_DESCRIPTORS, ffmiToSlider, visceralBandOf } from '@/engine/body';
import { resolveFrame, sectionsFrom } from './sections';

export interface DescribeOptions {
  /** Drawing frame 0..1. Default: `params.figure.frame`, else from the params. */
  frame?: number;
  /** Height as the user reads it ("178 cm", "5 ft 10 in"). Default: rounded cm. */
  heightText?: string;
  /** Formatted girths to read out, e.g. { waist: '86.6 cm' }. */
  measures?: Partial<Record<'chest' | 'waist' | 'hip', string>>;
  /** Replaces the muscularity sentence (e.g. "Muscle as expected for this size."). */
  muscle?: string;
  /** `two-layer`: the lean core is drawn inside a see-through fat layer. `envelope`: one solid body. Default: not said. */
  layers?: 'envelope' | 'two-layer';
  /** Start state drawn as a ghost outline behind the figure. */
  compareTo?: AvatarParams;
  /** The visceral view is on screen: append its waist-slice sentence. */
  visceral?: boolean;
}

/** Typical waist-to-hip ratio of the engine's girth model at median fat patterning (used only for wording). */
const TYPICAL_WHR = { male: 0.88, female: 0.8 } as const;

/** Where fat sits, in words: from the waist-to-hip ratio relative to the typical pattern for the sex. */
export function fatPatternWords(params: AvatarParams): string {
  const whr = params.outputs.whr;
  const typ = TYPICAL_WHR[params.sex === 'female' ? 'female' : 'male'];
  if (!Number.isFinite(whr)) return 'evenly spread';
  if (whr > typ + 0.05) return 'weighted toward the belly';
  if (whr < typ - 0.05) return 'weighted toward the hips and thighs';
  return 'evenly spread';
}

/** Muscularity in the engine's anchor words (FFMI anchors, dossier 14 T3), lowercase. */
export function muscularityWords(params: AvatarParams): string {
  const sex = params.sex === 'female' ? 'female' : 'male';
  const ffmi = params.outputs.ffmi;
  if (!Number.isFinite(ffmi)) return 'unknown';
  const idx = Math.round(ffmiToSlider(sex, ffmi) * (FFMI_ANCHOR_DESCRIPTORS.length - 1));
  return (FFMI_ANCHOR_DESCRIPTORS[idx] ?? 'average untrained').toLowerCase();
}

/**
 * Cut points on the DRAWN shoulder : hip breadth ratio (bideltoid envelope half-width / hip envelope half-width of the
 * figure, `sectionsFrom`), so the words follow what is on screen (body size and frame), not the slider number.
 * Literal comparisons: within +-3 % reads as even, up to 10 % (hips) / 15 % (shoulders) as "a little". Typical drawn
 * ratios: 1.05-1.25 at BMI 22-27 for the hips-led frame, 1.25-1.35 for the shoulders-led frame (own; PROPOSED).
 */
export const FRAME_RATIO_CUTS: readonly [number, number, number, number] = [0.9, 0.97, 1.03, 1.15];

const FRAME_WORDS = [
  'hips clearly wider than shoulders',
  'hips a little wider than shoulders',
  'shoulders and hips about even',
  'shoulders a little wider than hips',
  'shoulders clearly wider than hips',
] as const;

/** The same five bins, worded for the Frame slider's readout and `aria-valuetext` (COMPONENTS §13.3). */
export const FRAME_SLIDER_WORDS = [
  'hips clearly wider than shoulders',
  'hips a little wider',
  'about even',
  'shoulders a little wider',
  'shoulders clearly wider than hips',
] as const;

/** Drawn shoulder:hip breadth ratio of the figure at a frame (default: the params' own frame). */
export function frameRatio(params: AvatarParams, frame?: number): number {
  const s = sectionsFrom(params, resolveFrame(params, frame));
  return s.shoulder.e / s.hip.e;
}

/** Bin 0..4 of the drawn shoulder:hip breadth ratio. */
export function frameBin(params: AvatarParams, frame?: number): number {
  const r = frameRatio(params, frame);
  if (!Number.isFinite(r)) return 2;
  const i = FRAME_RATIO_CUTS.findIndex((c) => r < c);
  return i < 0 ? 4 : i;
}

/** The figure's frame in shape words (5 bins on the drawn shoulder:hip breadth ratio). */
export function frameWords(params: AvatarParams, frame?: number): string {
  return FRAME_WORDS[frameBin(params, frame)] ?? FRAME_WORDS[2];
}

/** Frame slider readout: "about even", "shoulders a little wider" … */
export function frameSliderWords(params: AvatarParams, frame?: number): string {
  return FRAME_SLIDER_WORDS[frameBin(params, frame)] ?? FRAME_SLIDER_WORDS[2];
}

const pctWords = (x: number) => (Number.isFinite(x) ? `${Math.round(x)} percent` : 'unknown');

/**
 * "Figure, 178 cm, shoulders a little wider than hips. Estimated body fat 23 percent, weighted toward the belly.
 * Muscularity: athletic." plus, when asked, how it is drawn (two layers), the start outline and the waist slice.
 */
export function describeAvatar(params: AvatarParams, options: DescribeOptions = {}): string {
  const frame = resolveFrame(params, options.frame);
  const h = options.heightText ?? `${Math.round(params.heightCm)} cm`;
  const parts = [
    `Figure, ${h}, ${frameWords(params, frame)}.`,
    `Estimated body fat ${pctWords(params.outputs.bodyFatPct)}, ${fatPatternWords(params)}.`,
    options.muscle ?? `Muscularity: ${muscularityWords(params)}.`,
  ];
  const m = options.measures;
  if (m) {
    const list = (['chest', 'waist', 'hip'] as const).filter((k) => m[k]).map((k) => `${k} ${m[k]}`);
    if (list.length) parts.push(`Measures: ${list.join(', ')}.`);
  }
  if (options.layers === 'two-layer') parts.push('Drawn in two layers: lean tissue inside, fat as a see-through outer layer.');
  const start = options.compareTo;
  if (start) parts.push(`Grey outline behind it: the start, at ${pctWords(start.outputs.bodyFatPct)} body fat.`);
  if (options.visceral) parts.push(visceralWords(params.visceral, start ? { compareTo: start.visceral } : {}));
  return parts.join(' ');
}

/** Round an area for reading out: nearest 5 cm2 below 100, nearest 10 above. */
export function roundArea(cm2: number): number {
  if (!Number.isFinite(cm2) || cm2 <= 0) return 0;
  return cm2 < 100 ? Math.round(cm2 / 5) * 5 : Math.round(cm2 / 10) * 10;
}

const BAND_ORDER: readonly VisceralBand[] = ['typical', 'raised', 'high'];

/**
 * What the likely range spans beyond the estimate's own band (body-figure-v2.md §6.3): '' when it stays inside,
 * "the range reaches raised", "the range spans all three bands". Never a single confident word over a wide range.
 */
export function rangeSpanWords(v: Pick<AvatarVisceral, 'vatAreaCm2' | 'areaRangeCm2'>): string {
  const band = visceralBandOf(v.vatAreaCm2);
  const lo = BAND_ORDER.indexOf(visceralBandOf(v.areaRangeCm2[0]));
  const hi = BAND_ORDER.indexOf(visceralBandOf(v.areaRangeCm2[1]));
  if (hi - lo >= 2) return 'the range spans all three bands';
  const other = [BAND_ORDER[lo], BAND_ORDER[hi]].find((b) => b !== band);
  return other ? `the range reaches ${other}` : '';
}

/** Where the deep-fat fill sits against the dashed reference rings, in words. */
function ringWords(vatAreaCm2: number, [t1, t2]: readonly [number, number]): string {
  if (vatAreaCm2 < t1) return `The deep fat stays inside the dashed ${t1} ring.`;
  if (vatAreaCm2 < t2) return `The deep fat reaches between the dashed ${t1} and ${t2} rings.`;
  return `The deep fat reaches past the dashed ${t2} ring.`;
}

/**
 * Accessible text of the waist-slice view (body-figure-v2.md §8): "Waist slice. Visceral fat about 160 square
 * centimetres, likely 95 to 270: in the high band, though the range spans all three bands (under 100 is typical, 100 to
 * 130 raised, 130 and over high). The deep fat reaches past the dashed 130 ring. Fat under the skin about 190 square
 * centimetres." The band is recomputed from the area (interpolated params keep the start band until t = 1).
 */
export function visceralWords(
  v: Pick<AvatarVisceral, 'vatAreaCm2' | 'satAreaCm2' | 'thresholdsCm2'> & Partial<Pick<AvatarVisceral, 'band' | 'areaRangeCm2'>>,
  options: { compareTo?: Pick<AvatarVisceral, 'vatAreaCm2'> } = {},
): string {
  const [t1, t2] = v.thresholdsCm2;
  const band = Number.isFinite(v.vatAreaCm2) ? visceralBandOf(v.vatAreaCm2) : (v.band ?? 'typical');
  const range = v.areaRangeCm2;
  const likely = range ? `, likely ${roundArea(range[0])} to ${roundArea(range[1])}:` : ',';
  const span = range ? rangeSpanWords({ vatAreaCm2: v.vatAreaCm2, areaRangeCm2: range }) : '';
  const start = options.compareTo ? ` At the start: about ${roundArea(options.compareTo.vatAreaCm2)} square centimetres.` : '';
  return (
    `Waist slice. Visceral fat about ${roundArea(v.vatAreaCm2)} square centimetres${likely} in the ${band} band` +
    `${span ? `, though ${span}` : ''} (under ${t1} is typical, ${t1} to ${t2} raised, ${t2} and over high). ` +
    `${ringWords(v.vatAreaCm2, v.thresholdsCm2)} Fat under the skin about ${roundArea(v.satAreaCm2)} square centimetres.${start}`
  );
}
