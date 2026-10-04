/**
 * Deep links into results (simulator-results.md §2): `?view=lanes|overlay|focus&m=<metricId>&z=<preset>&explain=<id>&xi=<day>`.
 * `m` and `explain` accept loose ids (`fat_mass`, `fat-mass`) and resolve to engine ids; unknown ids are dropped.
 * `focus` is accepted as an alias of `m` (the prototype's spelling).
 */
import type { ChartView } from '@/features/charts';
import { resolveMetricId } from './metrics';

export type ZoomParam = 'all' | 28 | 7 | 1;

export interface ResultsUrlState {
  view?: ChartView;
  /** Focused metric (view=focus) — also added to the lanes if not selected. */
  metric?: string;
  zoom?: ZoomParam;
  explain?: string;
  /** Crosshair day (0-based). */
  day?: number;
}

const VIEWS: readonly ChartView[] = ['lanes', 'overlay', 'focus'];

export function parseResultsParams(params: URLSearchParams): ResultsUrlState {
  const out: ResultsUrlState = {};
  const view = params.get('view');
  if (view && (VIEWS as readonly string[]).includes(view)) out.view = view as ChartView;
  const m = resolveMetricId(params.get('m') ?? params.get('focus'));
  if (m) {
    out.metric = m;
    if (!out.view && params.has('m')) out.view = 'focus';
  }
  const z = params.get('z');
  if (z === 'all' || z === '28' || z === '7' || z === '1') out.zoom = z === 'all' ? 'all' : (Number(z) as ZoomParam);
  const ex = resolveMetricId(params.get('explain'));
  if (ex) out.explain = ex;
  const xi = params.get('xi');
  if (xi != null && /^\d+$/.test(xi)) out.day = Number(xi);
  return out;
}

/** Write the view/metric/explain back, leaving unrelated params alone. Returns a new URLSearchParams. */
export function writeResultsParams(params: URLSearchParams, s: Pick<ResultsUrlState, 'view' | 'metric' | 'explain'>): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete('focus');
  if (!s.view || s.view === 'lanes') next.delete('view');
  else next.set('view', s.view);
  if (s.view === 'focus' && s.metric) next.set('m', s.metric);
  else next.delete('m');
  if (s.explain) next.set('explain', s.explain);
  else next.delete('explain');
  return next;
}

/** Lanes to show for a URL focus request: the metric joins the selection when it is not already there. */
export function lanesWithFocus(laneIds: readonly string[], metric: string | undefined, available: ReadonlySet<string>): string[] {
  if (!metric || !available.has(metric) || laneIds.includes(metric)) return [...laneIds];
  return [...laneIds, metric];
}
