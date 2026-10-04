/* ==========================================================================
   Static chart vocabulary: category order + names, macro order, encodings.
   Colours are NOT here — they are read from --lm-* tokens by theme.ts.
   ========================================================================== */
import type { ChartSeries, EventType, MacroKey, MetricCategory, OverlayTransform, PlanId } from './types';

/** Fixed category order (palette slots 1–8). */
export const CATEGORY_ORDER: readonly MetricCategory[] = [
  'body',
  'fuel',
  'energy',
  'cellular',
  'performance',
  'recovery',
  'cardio',
  'hormones',
];

/** Engraved group names (lowercase, authored). */
export const CATEGORY_LABEL: Record<MetricCategory, string> = {
  body: 'body composition',
  fuel: 'fuel & ketosis',
  energy: 'energy & metabolism',
  cellular: 'cellular signalling',
  performance: 'performance & training',
  recovery: 'recovery & wellbeing',
  cardio: 'cardiometabolic',
  hormones: 'hormones & appetite',
};

/** Stack order is fixed: protein, net carbs, fibre, fat, alcohol (tokens §6). */
export const MACRO_ORDER: readonly MacroKey[] = ['protein', 'netCarbs', 'fibre', 'fat', 'alcohol'];

export const MACRO_LABEL: Record<MacroKey, string> = {
  protein: 'protein',
  netCarbs: 'net carbs',
  fibre: 'fibre',
  fat: 'fat',
  alcohol: 'alcohol',
};

export const MACRO_LETTER: Record<MacroKey, string> = {
  protein: 'P',
  netCarbs: 'C',
  fibre: 'Fb',
  fat: 'F',
  alcohol: 'A',
};

/** Atwater factors, kcal per gram. Fibre ≈ 2 kcal/g (CHART_SPEC §4.4). */
export const KCAL_PER_GRAM: Record<MacroKey, number> = {
  protein: 4,
  netCarbs: 4,
  fibre: 2,
  fat: 9,
  alcohol: 7,
};

export const PLAN_ORDER: readonly PlanId[] = ['A', 'B', 'C'];

/**
 * Composite identity inside a category (CHART_SPEC §3.1): 1st solid ●, 2nd `7 4` ■,
 * 3rd `1.5 3.5` ▲. Dash values are CSS px (multiply by DPR on canvas).
 */
export type MarkerShape = 'circle' | 'square' | 'triangle';
export interface Encoding {
  slot: 1 | 2 | 3;
  dash: readonly number[];
  marker: MarkerShape;
}
export const ENCODINGS: readonly Encoding[] = [
  { slot: 1, dash: [], marker: 'circle' },
  { slot: 2, dash: [7, 4], marker: 'square' },
  { slot: 3, dash: [1.5, 3.5], marker: 'triangle' },
];

/** Max metrics in the overlay and max per category (CHART_SPEC §2, §3.1). */
export const OVERLAY_MAX = 6;
export const OVERLAY_MAX_PER_CATEGORY = 3;

/** Resolution thresholds in days (CHART_SPEC §5.2). */
export const RES_DAILY_ABOVE = 21;
export const RES_HOURLY_AT_OR_BELOW = 7;
/** At or below this span the inputs lane shows meals and the day view is offered. */
export const DAY_VIEW_AT_OR_BELOW = 2;

/** Event glyph priority for greedy label placement (higher wins). */
export const EVENT_PRIORITY: Record<EventType, number> = {
  safety: 100,
  'ketosis-entered': 60,
  'ketosis-exited': 55,
  'fast-start': 50,
  'fast-end': 45,
  'glycogen-low': 40,
  refeed: 35,
  'diet-break': 30,
  deload: 25,
  training: 10,
  note: 5,
};

export function overlayTransformOf(s: ChartSeries): OverlayTransform {
  if (s.overlay) return s.overlay;
  if (s.kind === 'stacked-area') return 'pct';
  if (s.kind === 'index' || s.unit === 'index' || s.unit === '%') return 'pts';
  return 'pct';
}

export function laneKindOf(s: ChartSeries): NonNullable<ChartSeries['kind']> {
  if (s.kind) return s.kind;
  return s.unit === 'index' ? 'index' : 'line';
}

/** Series grouped by category in palette order, preserving the given order inside a category. */
export function groupByCategory<T extends { category: MetricCategory }>(
  items: readonly T[],
): Array<{ category: MetricCategory; items: T[] }> {
  const groups = new Map<MetricCategory, T[]>();
  for (const it of items) {
    const g = groups.get(it.category);
    if (g) g.push(it);
    else groups.set(it.category, [it]);
  }
  return CATEGORY_ORDER.filter((c) => groups.has(c)).map((c) => ({ category: c, items: groups.get(c)! }));
}

/** Composite encoding for each series of an overlay, by order within its category. */
export function encodingsFor(series: readonly ChartSeries[]): Map<string, Encoding> {
  const seen = new Map<MetricCategory, number>();
  const out = new Map<string, Encoding>();
  for (const s of series) {
    const n = seen.get(s.category) ?? 0;
    seen.set(s.category, n + 1);
    out.set(s.id, ENCODINGS[Math.min(n, ENCODINGS.length - 1)]!);
  }
  return out;
}

export const GRADE_TEXT: Record<'A' | 'B' | 'C' | 'D', string> = {
  A: 'Evidence grade A: consistent human trials or meta-analyses.',
  B: 'Evidence grade B: a few human trials or consistent human mechanistic data.',
  C: 'Evidence grade C: limited human data. Read the shape, not the exact number.',
  D: 'Evidence grade D: based on animal and cell studies. Shown for exploration.',
};
