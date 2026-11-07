/**
 * Start → end readouts (simulator-results.md §6): the value before day 1, the value on a given day (the last by
 * default), the signed change, the range (P10–P90 of the model variations: a parameter-sensitivity range with unvalidated
 * coverage, C6/D8-02) on that day, the grade, and whether the range is "wide" (> ±25 % of the value, CHART_SPEC §4.6).
 * Also the plain-text summary for "Copy summary". A status travels beside the number: a word replaces the number when the
 * status forbids reading it, or when the series is a research index whose readout is a word only (`DisplayMetric.wordOnly`).
 * A day the ensemble reports without a usable range reads no range (never the nominal or an earlier day's range); a range
 * of the valid members only on a day with excluded members says so ("7 of 8 variations"); the members behind the day's
 * range travel with the readout (A1-049).
 */
import type { ChartData, ChartSeries } from '@/features/charts';
import { formatNumber, formatRange, formatSigned } from '@/components';
import { INTERPRETABLE_STATUSES, STATUS_LABEL, type OutputStatus, type UncertaintyKind } from '@/lib/bodyContracts';
import type { SeriesBandInfo } from './adapt';
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
  /**
   * C6 status when the readout is not a plain model estimate: Exploratory (a research index: value without a range) or a
   * status that forbids reading the value (Unsupported, Model limit, Unknown…: no value, the word instead).
   */
  status?: OutputStatus;
  /** The status word shown in place of the value when `status` forbids reading it (null: the value is shown). */
  statusText?: string | null;
  /**
   * D7-02: the observed t = 0 value of a series whose later values a status hides (an accepted measurement outside the
   * model's domain stays exactly as measured at the start: "LDL 8.0 mmol/L at start · Unsupported").
   */
  measuredStart?: number;
  /** Unit of `measuredStart` (absolute, "mmol/L", even when the series reads as a change from the start). */
  measuredUnit?: string;
  /** What the shown range is (C6/D8-02): model variations ('parameterSensitivity'), a fixed display range ('heuristic')… */
  rangeKind?: UncertaintyKind;
  /** The members' qualifying status on this day (a scenario or limited range around an estimated nominal). */
  rangeStatus?: OutputStatus;
  /** The range is the valid members' only, on a day with excluded members (A1-049). */
  rangeValidOnly?: boolean;
  /** The ensemble's member accounting on this day (A1-049), when the producer reports it. */
  members?: { attempted: number; valid: number; excluded: number; reasons: readonly string[] };
}

/** Whether a readout's status forbids reading its value (C6). */
const hides = (status: OutputStatus | undefined): boolean => status !== undefined && !INTERPRETABLE_STATUSES.has(status);

/** Interpretable statuses other than a plain estimate: the readout keeps its number and adds the word (C6). */
export const QUALIFYING_STATUSES: ReadonlySet<OutputStatus> = new Set<OutputStatus>(['partial', 'scenario', 'limited', 'exploratory']);

/** The status word a readout adds beside its number ("Scenario", "Limited"…), or null for a plain estimate. */
export function qualifierWord(r: Pick<ReadoutDatum, 'status' | 'statusText'>): string | null {
  return !r.statusText && r.status && QUALIFYING_STATUSES.has(r.status) ? STATUS_LABEL[r.status] : null;
}

type ReadoutMeta = Pick<DisplayMetric, 'presentation'> & Partial<Pick<DisplayMetric, 'status' | 'statusFromDay' | 'exploratory' | 'observed' | 'wordOnly'>>;

/** The ensemble's member accounting of one day (A1-049): attempted, valid and excluded members and why they were excluded. */
function membersOn(info: SeriesBandInfo | undefined, d: number): ReadoutDatum['members'] | undefined {
  const av = info?.days?.availability;
  if (!av || d < 0 || d >= av.valid.length) return undefined;
  const reasons = (Object.keys(av.excludedBy) as Array<keyof typeof av.excludedBy>).filter((k) => (av.excludedBy[k]?.[d] ?? 0) > 0);
  return { attempted: av.attempted, valid: av.valid[d]!, excluded: av.excluded[d]!, reasons };
}

export function computeReadout(s: ChartSeries, meta?: ReadoutMeta, day?: number, band?: SeriesBandInfo): ReadoutDatum {
  const v = s.daily.values;
  const n = v.length;
  const wanted = day == null ? n - 1 : Math.max(0, Math.min(n - 1, Math.floor(day)));
  let d = wanted;
  const engine = meta?.status ?? (meta?.exploratory ? 'exploratory' : undefined);
  // a research index reads as its word only (the engine's own forbidding status still wins)
  const wordOnly = meta?.wordOnly !== undefined && !hides(engine);
  const status = wordOnly ? meta!.wordOnly : engine;
  // a status that hides the values from its day on: that stretch reads the status, never the last value carried forward
  const hidden = wordOnly || (hides(status) && wanted >= Math.max(0, Math.floor(meta?.statusFromDay ?? 0)));
  // the last finite sample (a run that stopped early leaves NaN at the end)
  if (!hidden) while (d > 0 && !Number.isFinite(v[d]!)) d--;
  const start = s.baseline ?? v[0]!;
  const end = hidden ? Number.NaN : v[d]!;
  const lo = s.daily.band?.lo[d];
  const hi = s.daily.band?.hi[d];
  // a day the ensemble reports without a usable range has none, whatever the band arrays hold there (A1-049)
  const usable = !band?.days || band.days.usable[d] === 1;
  // an exploratory index never carries a range (C6, D2-02)
  const range: [number, number] | undefined = !hidden && usable && status !== 'exploratory' && lo != null && hi != null && Number.isFinite(lo) && Number.isFinite(hi) ? [Math.min(lo, hi), Math.max(lo, hi)] : undefined;
  const members = !hidden && band?.source === 'draws' ? membersOn(band, d) : undefined;
  const rangeStatus = range && band?.qualifier && d >= band.qualifier.fromDay ? band.qualifier.status : undefined;
  const rangeValidOnly = !!range && band?.source === 'draws' && band.days?.conditional[d] === 1;
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
    pctChange: !hidden && Math.abs(start) > 1e-9 && !relative ? (100 * (end - start)) / Math.abs(start) : Number.NaN,
    range,
    wide: range ? half > 0.25 * scale : false,
    relative,
    day: hidden ? wanted : d,
    ...(status ? { status } : {}),
    statusText: hidden && status ? STATUS_LABEL[status] : null,
    ...(hidden ? measured(meta, relative, start, s.unit) : {}),
    ...(range && band && band.source !== 'none' ? { rangeKind: band.uncertaintyKind } : {}),
    ...(rangeStatus ? { rangeStatus } : {}),
    ...(rangeValidOnly ? { rangeValidOnly } : {}),
    ...(members ? { members } : {}),
  };
}

/** D7-02: the observed start of a hidden series: the run's anchor, else an absolute series' own day-0 value. */
function measured(meta: Partial<Pick<DisplayMetric, 'statusFromDay' | 'observed'>> | undefined, relative: boolean, start: number, unit: string): Pick<ReadoutDatum, 'measuredStart' | 'measuredUnit'> {
  if (meta?.observed) return { measuredStart: meta.observed.value, measuredUnit: meta.observed.unit };
  return !relative && Math.floor(meta?.statusFromDay ?? 0) >= 1 && Number.isFinite(start) ? { measuredStart: start, measuredUnit: unit } : {};
}

/** A readout that is only a status (the series' values are hidden for the whole run, C6): no number at all. */
function statusReadout(m: DisplayMetric, status: OutputStatus, day: number): ReadoutDatum {
  return {
    id: m.id,
    label: m.label,
    shortLabel: m.shortLabel,
    unit: m.unit,
    decimals: m.decimals,
    category: m.category,
    grade: m.grade,
    start: Number.NaN,
    end: Number.NaN,
    delta: Number.NaN,
    pctChange: Number.NaN,
    wide: false,
    relative: m.presentation === 'deltaFromBaseline',
    day,
    status,
    statusText: STATUS_LABEL[status],
    // D7-02/A1-052: a series hidden for the whole run (an out-of-domain measured baseline) keeps its exact measured start
    ...(m.observed ? { measuredStart: m.observed.value, measuredUnit: m.observed.unit } : {}),
  };
}

/**
 * Readouts for the given ids that exist in the data (or only as a status), in the given order. `bands` (the adapter's
 * `bandInfo`) carries what each range is and its per-day member accounting.
 */
export function computeReadouts(data: ChartData, ids: readonly string[], metrics?: ReadonlyMap<string, DisplayMetric>, day?: number, bands?: ReadonlyMap<string, SeriesBandInfo>): ReadoutDatum[] {
  const byId = new Map(data.series.map((s) => [s.id, s]));
  const out: ReadoutDatum[] = [];
  for (const id of ids) {
    const s = byId.get(id);
    const m = metrics?.get(id);
    if (s) out.push(computeReadout(s, m, day, bands?.get(id)));
    else if (m?.status && hides(m.status)) out.push(statusReadout(m, m.status, Math.max(0, Math.floor(day ?? data.time.days - 1))));
    else if (m?.wordOnly) out.push(statusReadout(m, m.wordOnly, Math.max(0, Math.floor(day ?? data.time.days - 1))));
  }
  return out;
}

const unitText = (u: string) => (u === 'index' ? '' : ` ${u}`);

/**
 * "Fat mass: 21.7 → 19.5 kg (−2.2 kg), range 19.1–19.9" — the range is P10–P90 of the model variations (a sensitivity
 * range, not a likelihood, C6); a status readout reads "TDEE: Model limit", or with its measured start "LDL: 8.0 mmol/L
 * at start · Unsupported" (D7-02); a scenario, limited or partial estimate (or a range of such members) adds its word
 * ("…, range 0.1–0.6, scenario"); a range of the valid members only names them ("…, range 19.1–19.9 · 7 of 8 variations").
 */
export function readoutLine(r: ReadoutDatum): string {
  const u = unitText(r.unit);
  if (r.statusText) return r.measuredStart !== undefined ? `${r.label}: ${formatNumber(r.measuredStart, r.decimals)}${unitText(r.measuredUnit ?? r.unit)} at start · ${r.statusText}` : `${r.label}: ${r.statusText}`;
  const word = qualifierWord(r) ?? (r.range && r.rangeStatus && QUALIFYING_STATUSES.has(r.rangeStatus) ? STATUS_LABEL[r.rangeStatus] : null);
  const of = r.range && r.rangeValidOnly && r.members ? ` · ${r.members.valid} of ${r.members.attempted} variations` : '';
  const range = `${r.range ? `, range ${formatRange(r.range[0], r.range[1], r.decimals)}${of}` : ''}${word ? `, ${word.toLowerCase()}` : ''}`;
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
