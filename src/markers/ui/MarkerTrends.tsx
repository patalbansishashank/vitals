/**
 * Progress › Blood markers (SUITE_SPEC §13.5.7): per marker, the readings as points against the engine's projection
 * band from the plan start (when the plan's forecast carries that marker), the retest-due line, and "Re-enter values".
 * Achromatic secondary chart in the living-chart conventions: filled likely-range band, dashed median hairline, ink
 * dots, engraved ticks; one tab stop with a spoken summary and a table twin. Values are shown in the unit of the
 * person's latest reading.
 */
import { useId, useMemo } from 'react';
import { Link } from 'react-router';
import { Faceplate } from '@/components';
import type { SeriesId } from '@/engine';
import { addDays, daysBetween } from '@/living/dates';
import { formatMarkerDate, type DateStyle } from '../because';
import { historyOf } from '../doc';
import { MARKER_IDS, type MarkerEvaluation, type MarkerId, type MarkerReading, type MarkersDoc } from '../types';
import { MARKER_UNITS, convert, displayValue } from '../units';
import { markersChapterHref } from './links';
import { markersToday, useMarkerDateStyle, useMarkerEvaluation } from './useMarkers';
import './markers.css';

/** Engine series per marker (canonical units match; `rel` series are relative to the starting value). */
export const MARKER_SERIES: Partial<Record<MarkerId, { id: SeriesId; relative?: boolean }>> = {
  ldl: { id: 'ldl' },
  hdl: { id: 'hdl' },
  tg: { id: 'triglycerides' },
  apoB: { id: 'apoB' },
  fpg: { id: 'fastingGlucose' },
  hsCrp: { id: 'crp', relative: true },
  urate: { id: 'uricAcid', relative: true },
};

type Band = { p10: number[]; p50: number[]; p90: number[] };
export interface ForecastLike {
  fromDay?: number;
  asPrescribed?: Partial<Record<string, Band>>;
  realistic?: Partial<Record<string, Band>>;
}
export interface PlanLike {
  startDate: string;
  version?: { forecast?: ForecastLike } | undefined;
}

export const MARKER_TRENDS_COPY = {
  title: 'Blood markers',
  empty: 'No blood results yet. Add the key values from a recent test and the plan uses them.',
  add: 'Add values',
  reenter: 'Re-enter values',
  noBand: 'No projection for this marker in your plan; readings only.',
  band: 'likely range from the plan',
  retest: (date: string) => `retest due ${date}`,
  readings: 'readings',
  date: 'date',
  value: 'value',
} as const;

export interface MarkerSeriesView {
  markerId: MarkerId;
  label: string;
  unit: string;
  /** Day 0 of the x axis. */
  startDate: string;
  days: number;
  points: Array<{ day: number; date: string; value: number }>;
  band: { lo: number[]; mid: number[]; hi: number[]; fromDay: number } | null;
  retestDay: number | null;
  retestDate: string | null;
  todayDay: number;
}

const display = (id: MarkerId, canonical: number, canonicalUnit: string, unit: string): number => convert(id, canonical, canonicalUnit, unit) ?? canonical;

/** The chart model for one marker (pure). */
export function markerSeriesView(id: MarkerId, history: readonly MarkerReading[], plan: PlanLike | null, today: string, retestDue: string | null): MarkerSeriesView | null {
  if (history.length === 0) return null;
  const latest = history[history.length - 1]!;
  const unit = latest.unit;
  const canonical = latest.unitCanonical;
  const start = plan?.startDate ?? history[0]!.date;
  const series = MARKER_SERIES[id];
  const f = plan?.version?.forecast;
  const raw = series ? (f?.asPrescribed?.[series.id] ?? f?.realistic?.[series.id]) : undefined;
  let band: MarkerSeriesView['band'] = null;
  if (raw && raw.p50.length > 0) {
    let scale = 1;
    if (series?.relative) {
      const base = [...history].reverse().find((r) => r.date <= start) ?? history[0]!;
      scale = base.valueCanonical;
    }
    const map = (a: number[]) => a.map((v) => (Number.isFinite(v) ? display(id, v * scale, canonical, unit) : Number.NaN));
    band = { lo: map(raw.p10), mid: map(raw.p50), hi: map(raw.p90), fromDay: f?.fromDay ?? 0 };
  }
  const points = history.map((r) => ({ day: daysBetween(start, r.date), date: r.date, value: display(id, r.valueCanonical, r.unitCanonical, unit) }));
  const todayDay = daysBetween(start, today);
  const retestDay = retestDue ? daysBetween(start, retestDue) : null;
  const lastBandDay = band ? band.fromDay + band.mid.length - 1 : 0;
  const days = Math.max(1, todayDay, retestDay ?? 0, lastBandDay, ...points.map((p) => p.day)) + 1;
  return { markerId: id, label: MARKER_UNITS[id].label, unit, startDate: start, days, points, band, retestDay, retestDate: retestDue, todayDay };
}

/** Spoken summary: "LDL cholesterol: 3 readings, latest 162 mg/dL on 14 Sep 2026; likely range from the plan 120 to 150 at the end; retest due 14 Dec 2026." */
export function markerSummary(v: MarkerSeriesView, style: DateStyle): string {
  const last = v.points[v.points.length - 1]!;
  const parts = [`${v.label}: ${v.points.length} reading${v.points.length === 1 ? '' : 's'}, latest ${displayValue(v.markerId, last.value, v.unit)} ${v.unit} on ${formatMarkerDate(last.date, style)}`];
  // The last day with a finite band (a non-finite engine point would read "NaN to NaN").
  const b = v.band;
  const i = b ? b.mid.findLastIndex((_, k) => Number.isFinite(b.lo[k]) && Number.isFinite(b.hi[k])) : -1;
  if (v.band && i >= 0) {
    parts.push(`${MARKER_TRENDS_COPY.band} ${displayValue(v.markerId, v.band.lo[i]!, v.unit)} to ${displayValue(v.markerId, v.band.hi[i]!, v.unit)} at the end`);
  }
  if (v.retestDate) parts.push(MARKER_TRENDS_COPY.retest(formatMarkerDate(v.retestDate, style)));
  return `${parts.join('; ')}.`;
}

const W = 320;
const H = 112;
const PAD = { l: 40, r: 8, t: 8, b: 20 };

function MarkerChart({ v, style }: { v: MarkerSeriesView; style: DateStyle }) {
  const vals = [...v.points.map((p) => p.value), ...(v.band ? [...v.band.lo, ...v.band.hi].filter(Number.isFinite) : [])];
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  const pad = (hi - lo || Math.abs(hi) * 0.1 || 1) * 0.12;
  lo -= pad;
  hi += pad;
  const x = (d: number) => PAD.l + ((W - PAD.l - PAD.r) * d) / Math.max(1, v.days - 1);
  const y = (val: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - (val - lo) / (hi - lo));
  const b = v.band;
  let area = '';
  let mid = '';
  if (b) {
    const idx = b.mid.map((_, i) => i).filter((i) => Number.isFinite(b.lo[i]!) && Number.isFinite(b.hi[i]!));
    if (idx.length > 1) {
      area = `M${idx.map((i) => `${x(b.fromDay + i).toFixed(1)},${y(b.hi[i]!).toFixed(1)}`).join('L')}L${[...idx]
        .reverse()
        .map((i) => `${x(b.fromDay + i).toFixed(1)},${y(b.lo[i]!).toFixed(1)}`)
        .join('L')}Z`;
      mid = `M${idx.map((i) => `${x(b.fromDay + i).toFixed(1)},${y(b.mid[i]!).toFixed(1)}`).join('L')}`;
    }
  }
  const fmt = (n: number) => displayValue(v.markerId, n, v.unit);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={markerSummary(v, style)} focusable="false">
      <line className="lm-marker-trend__axis" x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} />
      <text className="lm-marker-trend__tick" x={PAD.l - 4} y={PAD.t + 8} textAnchor="end">
        {fmt(hi - pad)}
      </text>
      <text className="lm-marker-trend__tick" x={PAD.l - 4} y={H - PAD.b} textAnchor="end">
        {fmt(lo + pad)}
      </text>
      <text className="lm-marker-trend__tick" x={PAD.l} y={H - 4}>
        {formatMarkerDate(v.startDate, style, false)}
      </text>
      <text className="lm-marker-trend__tick" x={W - PAD.r} y={H - 4} textAnchor="end">
        {formatMarkerDate(addDays(v.startDate, v.days - 1), style, false)}
      </text>
      {area ? <path className="lm-marker-trend__band" d={area} /> : null}
      {mid ? <path className="lm-marker-trend__median" d={mid} /> : null}
      {v.retestDay !== null && v.retestDay >= 0 ? (
        <line className="lm-marker-trend__retest" x1={x(v.retestDay)} x2={x(v.retestDay)} y1={PAD.t} y2={H - PAD.b} data-testid="retest-line" />
      ) : null}
      {v.points
        .filter((p) => p.day >= 0)
        .map((p) => (
          <circle key={p.date} className="lm-marker-trend__point" cx={x(p.day)} cy={y(p.value)} r={3.5} data-testid="marker-point" />
        ))}
    </svg>
  );
}

function MarkerTrend({ v, style }: { v: MarkerSeriesView; style: DateStyle }) {
  const headId = useId();
  const last = v.points[v.points.length - 1]!;
  return (
    <article className="lm-marker-trend" aria-labelledby={headId} data-marker={v.markerId}>
      <div className="lm-marker-trend__head">
        <h4 id={headId}>{v.label}</h4>
        <span className="lm-marker-trend__meta">
          {displayValue(v.markerId, last.value, v.unit)} {v.unit} · {formatMarkerDate(last.date, style)}
          {v.retestDate ? ` · ${MARKER_TRENDS_COPY.retest(formatMarkerDate(v.retestDate, style))}` : ''}
        </span>
      </div>
      <MarkerChart v={v} style={style} />
      {v.band ? null : <p className="lm-marker-trend__meta">{MARKER_TRENDS_COPY.noBand}</p>}
      <details>
        <summary className="lm-marker-trend__meta">{MARKER_TRENDS_COPY.readings}</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">{MARKER_TRENDS_COPY.date}</th>
              <th scope="col">{`${MARKER_TRENDS_COPY.value} (${v.unit})`}</th>
            </tr>
          </thead>
          <tbody>
            {v.points.map((p) => (
              <tr key={p.date}>
                <td>{formatMarkerDate(p.date, style)}</td>
                <td className="lm-num">{displayValue(v.markerId, p.value, v.unit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </article>
  );
}

/** The views for every marker with readings (pure). */
export function markerTrendViews(doc: MarkersDoc, evaluation: MarkerEvaluation, plan: PlanLike | null, today: string): MarkerSeriesView[] {
  return MARKER_IDS.flatMap((id) => {
    const due = evaluation.retests.filter((r) => r.markerId === id).map((r) => r.due).sort()[0] ?? null;
    const v = markerSeriesView(id, historyOf(doc, id), plan, today, due);
    return v ? [v] : [];
  });
}

/** Progress section: one small chart per marker with readings. */
export function MarkerTrendsSection({ plan, id = 'markers' }: { plan: PlanLike | null; id?: string }) {
  const today = markersToday();
  const { doc, evaluation } = useMarkerEvaluation(today);
  const style = useMarkerDateStyle();
  const views = useMemo(() => markerTrendViews(doc, evaluation, plan, today), [doc, evaluation, plan, today]);
  return (
    <Faceplate id={id} title={MARKER_TRENDS_COPY.title} className="lv-prog-face">
      {views.length === 0 ? (
        <p className="lv-prog-state">
          {MARKER_TRENDS_COPY.empty} <Link to={markersChapterHref()}>{MARKER_TRENDS_COPY.add}</Link>
        </p>
      ) : (
        <div className="lm-marker-trends">
          {views.map((v) => (
            <MarkerTrend key={v.markerId} v={v} style={style} />
          ))}
          <p className="lm-marker-banner__links">
            <Link to={markersChapterHref()}>{MARKER_TRENDS_COPY.reenter}</Link>
          </p>
        </div>
      )}
    </Faceplate>
  );
}
