/* ==========================================================================
   Label placement: truthful phase labels, greedy event labels, end-label
   relaxation with leader lines. Pure; `measure` is injectable for tests.
   ========================================================================== */
import type { Phase } from '../types';

export type Measure = (text: string) => number;

/** Rough width of 11–12 px Archivo text; replaced by canvas measureText at runtime. */
export const estimateWidth =
  (charPx = 6): Measure =>
  (text) =>
    text.length * charPx;

export interface FittedLabel {
  text: string;
  /** True when the rendered text is not the full label (the full name goes in the tooltip). */
  abbreviated: boolean;
}

/**
 * The label a phase gets in `widthPx` (REVIEW_FINDINGS 6): the full name, else its authored
 * honest short form, else its letter, else nothing. Never a clipped prefix ("diet break" ≠ "diet").
 */
export function fitPhaseLabel(phase: Phase, widthPx: number, measure: Measure = estimateWidth()): FittedLabel {
  const room = widthPx - 12;
  if (phase.balance && phase.balance !== phase.label) {
    const full = `${phase.label} · ${phase.balance}`;
    if (measure(full) <= room) return { text: full, abbreviated: false };
  }
  if (measure(phase.label) <= room) return { text: phase.label, abbreviated: false };
  if (phase.shortLabel && measure(phase.shortLabel) <= room) return { text: phase.shortLabel, abbreviated: true };
  if (phase.letter && measure(phase.letter) <= room) return { text: phase.letter, abbreviated: true };
  return { text: '', abbreviated: true };
}

export interface EventLabelInput {
  id: string;
  x: number;
  text: string;
  priority: number;
}

export interface PlacedLabel {
  id: string;
  x: number;
  text: string;
  /** Left edge of the label box. */
  left: number;
  width: number;
}

/**
 * Greedy placement: highest priority first; a label sits to the right of its glyph
 * (or to the left when it would overflow); lower-priority labels that collide are dropped.
 */
export function placeEventLabels(
  items: EventLabelInput[],
  widthPx: number,
  measure: Measure = estimateWidth(5.8),
  opts: { glyphGap?: number; pad?: number; avoidGlyphs?: boolean } = {},
): PlacedLabel[] {
  const gap = opts.glyphGap ?? 9;
  const avoid = opts.avoidGlyphs ?? true;
  const pad = opts.pad ?? 6;
  const placed: PlacedLabel[] = [];
  const sorted = [...items].sort((a, b) => b.priority - a.priority || a.x - b.x);
  const collides = (l: number, r: number) => placed.some((p) => l < p.left + p.width + pad && r + pad > p.left);
  const glyphs = items.map((i) => i.x);
  const onGlyph = (l: number, r: number, own: number) => glyphs.some((g) => g !== own && g + 6 > l && g - 6 < r);
  for (const it of sorted) {
    const w = measure(it.text);
    const candidates = [it.x + gap, it.x - gap - w];
    for (const left of candidates) {
      const right = left + w;
      if (left < 0 || right > widthPx) continue;
      if (collides(left, right) || (avoid && onGlyph(left, right, it.x))) continue;
      placed.push({ id: it.id, x: it.x, text: it.text, left, width: w });
      break;
    }
  }
  return placed.sort((a, b) => a.left - b.left);
}

export interface EndLabelInput {
  id: string;
  y: number;
}

/**
 * Vertical relaxation of end labels: keep order, enforce `minGap` px between neighbours,
 * stay inside [top, bottom]. Returns the label y per id (leader lines connect y → label y).
 */
export function relaxLabels(items: EndLabelInput[], minGap: number, top: number, bottom: number): Map<string, number> {
  const sorted = [...items].filter((i) => Number.isFinite(i.y)).sort((a, b) => a.y - b.y);
  const ys = sorted.map((i) => Math.min(bottom, Math.max(top, i.y)));
  for (let k = 1; k < ys.length; k++) if (ys[k]! - ys[k - 1]! < minGap) ys[k] = ys[k - 1]! + minGap;
  const overflow = (ys[ys.length - 1] ?? bottom) - bottom;
  if (overflow > 0) {
    ys[ys.length - 1] = bottom;
    for (let k = ys.length - 2; k >= 0; k--) if (ys[k + 1]! - ys[k]! < minGap) ys[k] = ys[k + 1]! - minGap;
  }
  const out = new Map<string, number>();
  sorted.forEach((it, k) => out.set(it.id, Math.max(top, ys[k]!)));
  return out;
}
