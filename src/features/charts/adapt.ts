/* ==========================================================================
   Engine → chart adapter. The engine's SimulationResult (docs/ARCHITECTURE.md)
   stores columnar Float32Arrays per metric id plus a static METRICS catalogue;
   this maps that shape onto ChartData without copying arrays.
   ========================================================================== */
import type {
  ChartData,
  ChartEvent,
  ChartSeries,
  DirectionOfGood,
  EvidenceGrade,
  IntakeContext,
  LaneKind,
  MetricCategory,
  OverlayTransform,
  Phase,
  StateTrack,
  Threshold,
} from './types';

/** The subset of a METRICS catalogue entry the chart needs. */
export interface EngineMetricMeta {
  id: string;
  label: string;
  shortLabel?: string;
  unit: string;
  category: MetricCategory;
  grade: EvidenceGrade;
  direction?: DirectionOfGood;
  decimals?: number;
  kind?: LaneKind;
  overlay?: OverlayTransform;
  overlayNote?: string;
  thresholds?: Threshold[];
  reference?: { lo: number; hi: number; label?: string };
  mechanism?: string;
}

export interface EngineLikeResult {
  days: number;
  startDate?: string;
  /** p50 per metric, length = days. */
  daily: Record<string, Float32Array>;
  /** 10th / 90th percentile per metric, length = days. */
  dailyBand?: Record<string, { p10: Float32Array; p90: Float32Array }>;
  /** Fast metrics only, length = days × 24. */
  hourly?: Record<string, Float32Array>;
  hourlyBand?: Record<string, { p10: Float32Array; p90: Float32Array }>;
  /** Start values (before day 1). */
  baseline?: Record<string, number>;
  /** Simulation events with time in hours since the start. */
  events?: Array<{ tHours: number; type: ChartEvent['type']; label: string; severity?: ChartEvent['severity'] }>;
  states?: StateTrack[];
}

export interface AdaptOptions {
  /** Only these metric ids, in this order (default: catalogue order, metrics present in the result). */
  metricIds?: readonly string[];
  phases?: Phase[];
  intake?: IntakeContext;
}

export function toChartSeries(meta: EngineMetricMeta, r: EngineLikeResult): ChartSeries | null {
  const values = r.daily[meta.id];
  if (!values) return null;
  const band = r.dailyBand?.[meta.id];
  const hv = r.hourly?.[meta.id];
  const hb = r.hourlyBand?.[meta.id];
  return {
    id: meta.id,
    label: meta.label,
    shortLabel: meta.shortLabel,
    unit: meta.unit,
    category: meta.category,
    direction: meta.direction ?? 'neutral',
    grade: meta.grade,
    format: { decimals: meta.decimals ?? (meta.unit === 'index' ? 0 : 1) },
    kind: meta.kind,
    overlay: meta.overlay,
    overlayNote: meta.overlayNote,
    thresholds: meta.thresholds,
    reference: meta.reference,
    mechanism: meta.mechanism,
    baseline: r.baseline?.[meta.id],
    daily: { values, band: band ? { lo: band.p10, hi: band.p90 } : undefined },
    hourly: hv ? { values: hv, band: hb ? { lo: hb.p10, hi: hb.p90 } : undefined } : undefined,
  };
}

export function adaptResult(r: EngineLikeResult, catalogue: readonly EngineMetricMeta[], opts: AdaptOptions = {}): ChartData {
  const byId = new Map(catalogue.map((m) => [m.id, m]));
  const ids = opts.metricIds ?? catalogue.map((m) => m.id);
  const series = ids
    .map((id) => byId.get(id))
    .filter((m): m is EngineMetricMeta => !!m)
    .map((m) => toChartSeries(m, r))
    .filter((s): s is ChartSeries => !!s);
  return {
    time: { days: r.days, startDate: r.startDate },
    series,
    phases: opts.phases,
    intake: opts.intake,
    states: r.states,
    events: r.events?.map((e) => ({ day: Math.floor(e.tHours / 24), hour: e.tHours % 24, type: e.type, label: e.label, severity: e.severity })),
  };
}
