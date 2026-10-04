// Stage layout: centimetres -> pixels for one stage. The SVG's viewBox is the stage's own pixel box, so every text
// element is set in real pixels and never scales below its minimum (REVIEW_FINDINGS #8); only the figure groups are
// scaled (k px per cm), with non-scaling strokes.

import { FRONT_HALF_WIDTH_CM, SIDE_HALF_WIDTH_CM, STAGE_HEIGHT_CM } from './geometry';

export type AvatarView = 'front' | 'side' | 'both';

/** Smallest text rendered anywhere inside the figure (px). */
export const MIN_TEXT_PX = 11;

export interface StageLayoutInput {
  width: number;
  height: number;
  view: AvatarView;
  /** Figure extents (cm) of everything drawn (current + ghost). */
  frontHalfCm: number;
  sideHalfCm: number;
  /** Tallest figure drawn (cm). */
  maxHeightCm: number;
  ruler: boolean;
  /** Width reserved for measure callout labels at the right (px), 0 for none. */
  measureLabelPx: number;
  viewLabels: boolean;
}

export interface StageLayout {
  width: number;
  height: number;
  /** px per cm. */
  k: number;
  /** px y of the floor line. */
  floorY: number;
  /** px y of a height in cm. */
  topCm: number;
  frontX: number | null;
  sideX: number | null;
  frontHalfCm: number;
  sideHalfCm: number;
  rulerX: number | null;
  labelX: number | null;
  viewLabelY: number | null;
}

const PAD_X = 8;
const PAD_TOP = 10;
const RULER_W = 34;
const GAP_PX = 10;
const LABEL_GAP_PX = 12;
const VIEW_LABEL_H = 20;

export function stageLayout(i: StageLayoutInput): StageLayout {
  const width = Math.max(40, i.width);
  const height = Math.max(40, i.height);
  const topCm = Math.max(STAGE_HEIGHT_CM, Math.ceil(i.maxHeightCm + 6));
  const frontHalf = Math.max(FRONT_HALF_WIDTH_CM, Math.ceil(i.frontHalfCm + 1.5));
  const sideHalf = Math.max(SIDE_HALF_WIDTH_CM, Math.ceil(i.sideHalfCm + 1.5));
  const showFront = i.view !== 'side';
  const showSide = i.view !== 'front';
  const spanCm = (showFront ? 2 * frontHalf : 0) + (showSide ? 2 * sideHalf : 0);
  const rulerW = i.ruler ? RULER_W : 0;
  const labelW = i.measureLabelPx > 0 ? i.measureLabelPx + LABEL_GAP_PX : 0;
  const gap = showFront && showSide ? GAP_PX : 0;
  const padBottom = i.viewLabels ? VIEW_LABEL_H : 6;
  const kv = (height - PAD_TOP - padBottom) / topCm;
  const kh = (width - 2 * PAD_X - rulerW - labelW - gap) / spanCm;
  const k = Math.max(0.05, Math.min(kv, kh));
  const contentW = rulerW + k * spanCm + gap + labelW;
  const left = Math.max(PAD_X, (width - contentW) / 2);
  const freeV = height - PAD_TOP - padBottom - k * topCm;
  const floorY = height - padBottom - Math.max(0, freeV) / 2;
  let x = left + rulerW;
  const frontX = showFront ? x + k * frontHalf : null;
  if (showFront) x += 2 * k * frontHalf + gap;
  const sideX = showSide ? x + k * sideHalf : null;
  if (showSide) x += 2 * k * sideHalf;
  return {
    width,
    height,
    k,
    floorY,
    topCm,
    frontX,
    sideX,
    frontHalfCm: frontHalf,
    sideHalfCm: sideHalf,
    rulerX: i.ruler ? left + 4 : null,
    labelX: labelW > 0 ? x + LABEL_GAP_PX : null,
    viewLabelY: i.viewLabels ? floorY + 15 : null,
  };
}

/** Rough width of a string set in Archivo at 11 px (condensed digits, normal letters). */
export function textWidthPx(text: string, px = MIN_TEXT_PX): number {
  return text.length * px * 0.56;
}
