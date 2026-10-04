/**
 * Start → end readouts (simulator-results.md §6): the value before day 1, the value on a given day (the last by
 * default), the signed change, the likely range (P10–P90) on that day, the grade, and whether the range is "wide"
 * (> ±25 % of the value, CHART_SPEC §4.6). Also the plain-text summary for "Copy summary".
 */
import type { ChartData, ChartSeries } from '@/features/charts';
import { formatNumber, formatRange, formatSigned } from '@/components';
import type { DisplayMetric } from './metrics';

export interface ReadoutDatum {
  id: string;
  label: string;
  shortLabel: string;
  unit: string;
  decimals: number;
  category: ChartSeries['category'];
  grade: ChartSeries['grade'];
  /** Value before day 1 (0 for change-from-baseline metrics). */
  start: number;
  end: number;
  delta: number;
  /** Percent change from the start (NaN when the start is ~0). */
  pctChange: number;
  range?: [number, number];
  wide: boolean;
  /** "relative to your baseline" metrics have no meaningful "start → end" pair. */
  relative: boolean;
  day: number;
}

export function computeReadout(s: ChartSeries, meta?: Pick<DisplayMetric, 'presentation'>, day?: number): ReadoutDatum {
  const v = s.daily.values;
  const n = v.length;
  let d = day == null ? n - 1 : Math.max(0, Math.min(n - 1, Math.floor(day)));
  // the last finite sample (a run that stopped early leaves NaN at the end)
  while (d > 0 && !Number.isFinite(v[d]!)) d--;
  const start = s.baseline ?? v[0]!;
  const end = v[d]!;
  const lo = s.daily.band?.lo[d];
  const hi = s.daily.band?.hi[d];
  const range: [number, number] | undefined = lo != null && hi != null && Number.isFinite(lo) && Number.isFinite(hi) ? [Math.min(lo, hi), Math.max(lo, hi)] : undefined;
  const relative = meta?.presentation === 'deltaFromBaseline';
  const half = range ? (range[1] - range[0]) / 2 : 0;
  const scale = relative ? Math.max(Math.abs(end - start), 1e-9) : Math.abs(end);
  return {
    id: s.id,
    label: s.label,
    shortLabel: s.shortLabel ?? s.label.toLowerCase(),
    unit: s.unit,
    decimals: s.format.decimals,
    category: s.category,
    grade: s.grade,
    start,
    end,
    delta: end - start,
    pctChange: Math.abs(start) > 1e-9 && !relative ? (100 * (end - start)) / Math.abs(start) : Number.NaN,
    range,
    wide: range ? half > 0.25 * scale : false,
    relative,
    day: d,
  };
}

/** Readouts for the given ids that exist in the data, in the given order. */
export function computeReadouts(data: ChartData, ids: readonly string[], metrics?: ReadonlyMap<string, DisplayMetric>, day?: number): ReadoutDatum[] {
  const byId = new Map(data.series.map((s) => [s.id, s]));
  const out: ReadoutDatum[] = [];
  for (const id of ids) {
    const s = byId.get(id);
    if (s) out.push(computeReadout(s, metrics?.get(id), day));
  }
  return out;
}

const unitText = (u: string) => (u === 'index' ? '' : ` ${u}`);

/** "Fat mass: 21.7 → 19.5 kg (−2.2 kg), likely 19.1–19.9". */
export function readoutLine(r: ReadoutDatum): string {
  const u = unitText(r.unit);
  const range = r.range ? `, likely ${formatRange(r.range[0], r.range[1], r.decimals)}` : '';
  if (r.relative) return `${r.label}: ${formatSigned(r.end, r.decimals)}${u}${range}`;
  return `${r.label}: ${formatNumber(r.start, r.decimals)} → ${formatNumber(r.end, r.decimals)}${u} (${formatSigned(r.delta, r.decimals)}${u})${range}`;
}

export interface SummaryInput {
  title: string;
  dateRange: string;
  days: number;
  readouts: readonly ReadoutDatum[];
  warnings: { danger: number; caution: number; titles: readonly string[] };
  disclaimer: string;
}

/** Plain-text summary for the clipboard ("Copy summary"). */
export function summaryText(p: SummaryInput): string {
  const lines = [`${p.title} · ${p.dateRange} · ${p.days} days`, '', ...p.readouts.map(readoutLine)];
  const warn = p.warnings.danger + p.warnings.caution;
  if (warn) {
    lines.push('', `Warnings: ${[p.warnings.danger ? `${p.warnings.danger} danger` : '', p.warnings.caution ? `${p.warnings.caution} caution` : ''].filter(Boolean).join(', ')}`);
    for (const t of p.warnings.titles) lines.push(`- ${t}`);
  }
  lines.push('', p.disclaimer);
  return lines.join('\n');
}
