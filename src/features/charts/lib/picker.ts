/* ==========================================================================
   Metric picker — data logic only (COMPONENTS §7 MetricPicker). The picker UI
   belongs to the simulator/planner features; they call these pure functions.
   ========================================================================== */
import { CATEGORY_LABEL, groupByCategory, OVERLAY_MAX, OVERLAY_MAX_PER_CATEGORY, overlayTransformOf } from '../catalogue';
import type { ChartSeries, EvidenceGrade, MetricCategory } from '../types';

/** Default lane set on first run (COMPONENTS §7). */
export const DEFAULT_LANE_IDS = [
  'fat_mass',
  'lean_mass',
  'scale_weight',
  'glycogen',
  'ketones',
  'hunger',
  'met_adaptation',
  'tdee',
] as const;

export type PickerMode = 'lanes' | 'overlay';

export interface PickerItem {
  id: string;
  label: string;
  unit: string;
  grade: EvidenceGrade;
  category: MetricCategory;
  selected: boolean;
  overlayEligible: boolean;
  overlayNote?: string;
}

export interface PickerGroup {
  category: MetricCategory;
  label: string;
  items: PickerItem[];
  selectedCount: number;
  total: number;
}

export interface PickerFilter {
  query?: string;
  grades?: readonly EvidenceGrade[];
  selectedOnly?: boolean;
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Every whitespace-separated token must appear in the label, short label, id, unit or category name. */
export function matchesQuery(s: ChartSeries, query: string): boolean {
  const q = fold(query.trim());
  if (!q) return true;
  const hay = fold([s.label, s.shortLabel ?? '', s.id.replace(/_/g, ' '), s.unit, CATEGORY_LABEL[s.category]].join(' '));
  return q.split(/\s+/).every((tok) => hay.includes(tok));
}

export function isOverlayEligible(s: ChartSeries): boolean {
  return overlayTransformOf(s) !== 'none' && s.kind !== 'stacked-area';
}

/** Groups in palette order with counts ("3/7"), filtered. Empty groups are omitted. */
export function pickerGroups(series: readonly ChartSeries[], selected: readonly string[], filter: PickerFilter = {}): PickerGroup[] {
  const sel = new Set(selected);
  const all = groupByCategory(series);
  const out: PickerGroup[] = [];
  for (const g of all) {
    const items = g.items
      .filter((s) => matchesQuery(s, filter.query ?? ''))
      .filter((s) => !filter.grades?.length || filter.grades.includes(s.grade))
      .filter((s) => !filter.selectedOnly || sel.has(s.id))
      .map<PickerItem>((s) => ({
        id: s.id,
        label: s.label,
        unit: s.unit,
        grade: s.grade,
        category: s.category,
        selected: sel.has(s.id),
        overlayEligible: isOverlayEligible(s),
        overlayNote: isOverlayEligible(s) ? undefined : (s.overlayNote ?? `${s.label} stays in lanes.`),
      }));
    if (!items.length) continue;
    out.push({
      category: g.category,
      label: CATEGORY_LABEL[g.category],
      items,
      selectedCount: g.items.filter((s) => sel.has(s.id)).length,
      total: g.items.length,
    });
  }
  return out;
}

export interface ToggleResult {
  selected: string[];
  /** Humane refusal copy when the toggle was not applied. */
  refused?: string;
}

/**
 * Toggle a metric. Lanes: a new metric joins at the end of its category group.
 * Overlay: at most 6 metrics, 3 per category, eligible transforms only.
 */
export function toggleMetric(
  series: readonly ChartSeries[],
  selected: readonly string[],
  id: string,
  mode: PickerMode,
): ToggleResult {
  if (selected.includes(id)) return { selected: selected.filter((x) => x !== id) };
  const s = series.find((x) => x.id === id);
  if (!s) return { selected: [...selected] };
  if (mode === 'overlay') {
    if (!isOverlayEligible(s))
      return { selected: [...selected], refused: s.overlayNote ?? `${s.label} can't be indexed to its start; view it in Lanes.` };
    if (selected.length >= OVERLAY_MAX)
      return { selected: [...selected], refused: 'Overlay shows up to 6 metrics. Switch to Lanes to see more.' };
    const sameCat = selected.filter((x) => series.find((y) => y.id === x)?.category === s.category).length;
    if (sameCat >= OVERLAY_MAX_PER_CATEGORY)
      return { selected: [...selected], refused: `Overlay shows up to 3 ${CATEGORY_LABEL[s.category]} metrics at once.` };
    return { selected: [...selected, id] };
  }
  // lanes: insert after the last selected metric of the same category (category order is kept by the stack)
  const idx = selected.reduce((acc, x, k) => (series.find((y) => y.id === x)?.category === s.category ? k : acc), -1);
  const next = [...selected];
  if (idx < 0) next.push(id);
  else next.splice(idx + 1, 0, id);
  return { selected: next };
}

/** "Lanes: 9 · Overlay: 4 / 6" */
export function capacityText(lanes: number, overlay: number): string {
  return `Lanes: ${lanes} · Overlay: ${overlay} / ${OVERLAY_MAX}`;
}
