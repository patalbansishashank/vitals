/**
 * Progress › Blood markers (SUITE_SPEC §13.5.7): per marker, the readings as points against the engine's projection
 * band from the plan start (when the plan's forecast carries that marker) and the retest-due tick; one foot key to add
 * or update results. Compact rows use the shared r071 SVG skin in the body hue. A row opens its readings and evidence;
 * T opens its table twin. The card information panel holds every twin. Values are
 * shown in the unit of the person's latest reading.
 *
 * Inline status (C6, D7-05/D7-06/D7-09): one short word after the latest reading — Current, Repeat due or Review — and,
 * for fasting glucose, "Fasting unknown" / "Not fasting" when the draw is not an eligible fasting sample; for insulin, the
 * HOMA-IR only for an eligible same-draw pair, otherwise why not ("Pairing unknown", "Fasting unknown"). The reasons stay
 * in the marker's info; the value and unit are always the reading's own.
 *
 * Projection status (C6, D7-07/D7-08): when the plan's forecast carries the engine's per-series status, a band whose status
 * forbids reading it (Unsupported, Model limit, Unknown…) is not drawn, and a scenario or exploratory band is labelled as
 * that ("Projection: Scenario"), never as a likely range — an LDL response under a ketogenic exposure is uncertain, not
 * flat. Without a status the band reads as before.
 */
import { useId, useMemo, useState, type CSSProperties } from 'react';
import { CheckCircle2, ClipboardList, Droplet, Repeat2 } from 'lucide-react';
import {
  CardFoot,
  CardHead,
  ChartTwin,
  GradientCard,
  HeroNumber,
  InfoPanel,
  Key,
  KeyLink,
  MonoMeta,
  StateWord,
  useReveal,
  type InfoSpec,
  type TwinData,
} from '@/components';
import { useQuietMode } from '@/state/settingsStore';
import { BLOOD_MARKERS_TOPIC, markerEvidenceHref, topicHref } from '@/features/evidence/links';
import { EndDot, SkinGradients, chartHue, usePulseAfterReveal } from '@/features/charts/living/skin';
import { bandPath, smoothAreaPath, smoothLinePath } from '@/features/charts/living/trend';
import '@/features/charts/living/living-charts.css';
import type { SeriesId } from '@/engine';
import { INTERPRETABLE_STATUSES, STATUS_LABEL, type OutputStatus } from '@/lib/bodyContracts';
import { addDays, daysBetween } from '@/living/dates';
import { formatMarkerDate, type DateStyle } from '../because';
import { freshnessOf, historyOf, type FreshnessContext } from '../doc';
import { markerReviewStates } from '../review';
import { homaFor, sampleFastingOf, type HomaUnavailableReason } from '../rules';
import {
  MARKER_IDS,
  type MarkerEvaluation,
  type MarkerId,
  type MarkerReading,
  type MarkersDoc,
  type RuleContext,
} from '../types';
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
  /** The engine's per-series status (C6 `SeriesStatusMeta`), when the stored forecast carries it. */
  outputStatus?: Partial<Record<string, { status: OutputStatus; reasonCode?: string; fromDay?: number }>>;
}
export interface PlanLike {
  startDate: string;
  version?: { forecast?: ForecastLike } | undefined;
}

export const MARKER_TRENDS_COPY = {
  title: 'Blood markers',
  empty: 'No results yet',
  add: 'Add results',
  reenter: 'Update results',
  noBand: 'No projection for this marker in your plan',
  band: 'likely range from the plan',
  bandAs: (status: string) => `${status.toLowerCase()} range from the plan`,
  projection: (status: string) => `Projection: ${status}`,
  retest: (date: string) => `retest due ${date}`,
  readings: 'Readings',
  date: 'Date',
  value: 'Value',
  fastingUnknown: 'Fasting unknown',
  notFasting: 'Not fasting',
  homa: (v: string) => `HOMA-IR ${v}`,
  homaWhy: {
    pairingUnknown: 'Pairing unknown',
    fastingUnknown: 'Fasting unknown',
    notFasting: 'Not fasting',
    exogenousInsulin: 'On insulin',
    insulinTherapyUnknown: 'Unchecked',
    unit: 'Unchecked',
    samplingConflict: 'Draw conflict',
    illnessUnresolved: 'Ill at draw',
    prolongedFast: 'Long fast',
    noGlucose: '',
  } satisfies Record<HomaUnavailableReason, string>,
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
  /** (D7-05) Current / Repeat due / Review for the latest reading (set by `markerTrendViews`). */
  status?: string;
  /** (D7-06/D7-09) the latest draw's sample status or HOMA-IR, when it matters for this marker. */
  sampleNote?: string;
  /** (C6) the plan projection's status word (Scenario, Exploratory, Unsupported…) when it is not a plain projection. */
  projectionStatus?: string;
}

const display = (id: MarkerId, canonical: number, canonicalUnit: string, unit: string): number =>
  convert(id, canonical, canonicalUnit, unit) ?? canonical;

/** The chart model for one marker (pure). */
export function markerSeriesView(
  id: MarkerId,
  history: readonly MarkerReading[],
  plan: PlanLike | null,
  today: string,
  retestDue: string | null,
): MarkerSeriesView | null {
  if (history.length === 0) return null;
  const latest = history[history.length - 1]!;
  const unit = latest.unit;
  const canonical = latest.unitCanonical;
  const start = plan?.startDate ?? history[0]!.date;
  const series = MARKER_SERIES[id];
  const f = plan?.version?.forecast;
  const raw = series ? (f?.asPrescribed?.[series.id] ?? f?.realistic?.[series.id]) : undefined;
  let band: MarkerSeriesView['band'] = null;
  // C6: a status that forbids interpretation removes the band (the number is a compatibility value, not a forecast)
  const st = series ? f?.outputStatus?.[series.id] : undefined;
  const readable = !st || INTERPRETABLE_STATUSES.has(st.status);
  const projectionStatus =
    st && st.status !== 'observed' && st.status !== 'verified' && (raw || !readable)
      ? STATUS_LABEL[st.status]
      : undefined;
  if (raw && raw.p50.length > 0 && readable) {
    let scale = 1;
    if (series?.relative) {
      const base = [...history].reverse().find((r) => r.date <= start) ?? history[0]!;
      scale = base.valueCanonical;
    }
    const map = (a: number[]) =>
      a.map((v) => (Number.isFinite(v) ? display(id, v * scale, canonical, unit) : Number.NaN));
    band = { lo: map(raw.p10), mid: map(raw.p50), hi: map(raw.p90), fromDay: f?.fromDay ?? 0 };
  }
  const points = history.map((r) => ({
    day: daysBetween(start, r.date),
    date: r.date,
    value: display(id, r.valueCanonical, r.unitCanonical, unit),
  }));
  const todayDay = daysBetween(start, today);
  const retestDay = retestDue ? daysBetween(start, retestDue) : null;
  const lastBandDay = band ? band.fromDay + band.mid.length - 1 : 0;
  const days = Math.max(1, todayDay, retestDay ?? 0, lastBandDay, ...points.map((p) => p.day)) + 1;
  return {
    markerId: id,
    label: MARKER_UNITS[id].label,
    unit,
    startDate: start,
    days,
    points,
    band,
    retestDay,
    retestDate: retestDue,
    todayDay,
    ...(projectionStatus ? { projectionStatus } : {}),
  };
}

/** Spoken summary: "LDL cholesterol: 3 readings, latest 162 mg/dL on 14 Sep 2026; likely range from the plan 120 to 150 at the end; retest due 14 Dec 2026." */
export function markerSummary(v: MarkerSeriesView, style: DateStyle, quiet = false): string {
  const last = v.points[v.points.length - 1]!;
  if (quiet)
    return `${v.label}: readings over time; ${v.status ?? 'Logged'}. Latest entered ${formatMarkerDate(last.date, style)}${v.retestDate ? `; ${MARKER_TRENDS_COPY.retest(formatMarkerDate(v.retestDate, style))}` : ''}.`;
  const parts = [
    `${v.label}: ${v.points.length} reading${v.points.length === 1 ? '' : 's'}, latest ${displayValue(v.markerId, last.value, v.unit)} ${v.unit} on ${formatMarkerDate(last.date, style)}${[
      v.status,
      v.sampleNote,
    ]
      .filter(Boolean)
      .map((x) => `, ${x}`)
      .join('')}`,
  ];
  // The last day with a finite band (a non-finite engine point would read "NaN to NaN").
  const b = v.band;
  const i = b ? b.mid.findLastIndex((_, k) => Number.isFinite(b.lo[k]) && Number.isFinite(b.hi[k])) : -1;
  if (v.band && i >= 0) {
    parts.push(
      `${v.projectionStatus ? MARKER_TRENDS_COPY.bandAs(v.projectionStatus) : MARKER_TRENDS_COPY.band} ${displayValue(v.markerId, v.band.lo[i]!, v.unit)} to ${displayValue(v.markerId, v.band.hi[i]!, v.unit)} at the end`,
    );
  } else if (v.projectionStatus) parts.push(MARKER_TRENDS_COPY.projection(v.projectionStatus));
  if (v.retestDate) parts.push(MARKER_TRENDS_COPY.retest(formatMarkerDate(v.retestDate, style)));
  return `${parts.join('; ')}.`;
}

const MARKERS_INFO: InfoSpec = {
  title: 'Blood markers',
  body: "Your results as entered, in their own units. The shaded band is what your plan forecasts for that marker, labelled as a scenario where it's uncertain. 'Current': fresh enough to use. 'Repeat due': time to retest. 'Review': an earlier finding is still open. Not medical advice.",
  source: { kind: 'logged', words: 'Lab results, as typed or extracted.' },
  range: 'A projection band belongs to the plan, not a laboratory reference range.',
  evidence: { to: topicHref(BLOOD_MARKERS_TOPIC), label: 'Blood markers and diet' },
};

/** Readings and projection rows from the same model the sparkline draws; no hover is needed to recover a value. */
export function markerTwin(v: MarkerSeriesView, style: DateStyle): TwinData {
  const b = v.band;
  return {
    title: `${v.label} table`,
    caption: markerSummary(v, style),
    head: ['Date', `Reading (${v.unit})`, `Plan median (${v.unit})`, `Plan range (${v.unit})`, 'Note'],
    rows: [
      ...v.points.map((p) => [
        formatMarkerDate(p.date, style),
        displayValue(v.markerId, p.value, v.unit),
        '—',
        '—',
        'Entered result',
      ]),
      ...(b
        ? b.mid.flatMap((mid, i) =>
            Number.isFinite(mid) && Number.isFinite(b.lo[i]) && Number.isFinite(b.hi[i])
              ? [
                  [
                    formatMarkerDate(addDays(v.startDate, b.fromDay + i), style),
                    '—',
                    displayValue(v.markerId, mid, v.unit),
                    `${displayValue(v.markerId, b.lo[i]!, v.unit)}–${displayValue(v.markerId, b.hi[i]!, v.unit)}`,
                    v.projectionStatus
                      ? MARKER_TRENDS_COPY.projection(v.projectionStatus)
                      : 'Plan projection',
                  ],
                ]
              : [],
          )
        : []),
    ],
    fileName: `vitals-marker-${v.markerId}.csv`,
    rowNoun: ['entry', 'entries'],
  };
}

const W = 96;
const H = 28;
const PAD = 5;

/** A small chart uses the same hue, static gradients, end dot and first-view wipe as the larger SVG lanes. */
export function MarkerChart({
  v,
  style,
  quiet,
  animate = true,
}: {
  v: MarkerSeriesView;
  style: DateStyle;
  quiet: boolean;
  animate?: boolean;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [ref, pending] = useReveal<HTMLSpanElement>({ animate });
  const pulse = usePulseAfterReveal(pending, true, animate);
  const vals = [
    ...v.points.map((p) => p.value),
    ...(v.band ? [...v.band.lo, ...v.band.hi].filter(Number.isFinite) : []),
  ];
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  const pad = (hi - lo || Math.abs(hi) * 0.1 || 1) * 0.12;
  lo -= pad;
  hi += pad;
  const firstDay = Math.min(0, ...v.points.map((p) => p.day));
  const x = (d: number) => PAD + ((W - 2 * PAD) * (d - firstDay)) / Math.max(1, v.days - 1 - firstDay);
  const y = (val: number) => PAD + (H - 2 * PAD) * (1 - (val - lo) / (hi - lo));
  const b = v.band;
  const values = v.points.map((p) => p.value);
  const pointX = (i: number) => x(v.points[i]!.day);
  const line = smoothLinePath(values, pointX, y);
  const area = b
    ? bandPath(b.lo, b.hi, (i) => x(b.fromDay + i), y)
    : smoothAreaPath(values, pointX, y, H - PAD);
  const last = v.points[v.points.length - 1]!;
  return (
    <span
      ref={ref}
      className="lm-marker-trend__spark lmc-skin"
      data-reveal={pending ? 'pending' : undefined}
      style={{ '--lmc-hue': chartHue('body') } as CSSProperties}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={markerSummary(v, style, quiet)}
        focusable="false"
        className="lmc-lv-svg"
      >
        <defs>
          <SkinGradients id={uid} />
        </defs>
        <line className="lmc-lv-grid" x1={PAD} x2={W - PAD} y1={H / 2} y2={H / 2} />
        <g className="lmc-draw">
          {area ? (
            <path
              className={b ? 'lm-marker-trend__band' : 'lm-marker-trend__area'}
              d={area}
              fill={`url(#${uid}-${b ? 'band' : 'area'})`}
            />
          ) : null}
          {b ? (
            <path className="lm-marker-trend__median" d={smoothLinePath(b.mid, (i) => x(b.fromDay + i), y)} />
          ) : null}
          <path className="lm-marker-trend__line" d={line} />
          {v.retestDay !== null && v.retestDay >= firstDay ? (
            <line
              className="lm-marker-trend__retest"
              x1={x(v.retestDay)}
              x2={x(v.retestDay)}
              y1={PAD}
              y2={H - PAD}
              data-testid="retest-line"
            />
          ) : null}
          {v.points.map((p) => (
            <circle
              key={p.date}
              className="lm-marker-trend__point"
              cx={x(p.day)}
              cy={y(p.value)}
              r={1.8}
              data-testid="marker-point"
            />
          ))}
          <EndDot x={x(last.day)} y={y(last.value)} r={2.5} pulse={pulse} />
        </g>
      </svg>
    </span>
  );
}

function markerInfo(v: MarkerSeriesView, style: DateStyle, quiet: boolean): InfoSpec {
  const projection = v.projectionStatus
    ? MARKER_TRENDS_COPY.projection(v.projectionStatus)
    : v.band
      ? 'Projection from your plan'
      : MARKER_TRENDS_COPY.noBand;
  return {
    ...MARKERS_INFO,
    title: v.label,
    range: quiet ? 'Values stay hidden in quiet mode.' : projection,
    terms: [
      { term: 'Result entered', text: formatMarkerDate(v.points[v.points.length - 1]!.date, style) },
      ...(v.retestDate ? [{ term: 'Retest', text: formatMarkerDate(v.retestDate, style) }] : []),
      ...(!quiet && v.sampleNote ? [{ term: 'Sample', text: v.sampleNote }] : []),
      { term: 'Projection', text: projection },
    ],
    evidence: { to: markerEvidenceHref(v.markerId), label: `About ${v.label}` },
    ...(!quiet ? { twin: <ChartTwin data={markerTwin(v, style)} /> } : {}),
  };
}

function MarkerTrend({ v, style, quiet }: { v: MarkerSeriesView; style: DateStyle; quiet: boolean }) {
  const headId = useId();
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<'twin' | undefined>();
  const last = v.points[v.points.length - 1]!;
  const status = v.status ?? 'Logged';
  const statusIcon = status === 'Review' ? ClipboardList : status === 'Repeat due' ? Repeat2 : CheckCircle2;
  return (
    <article
      className="lm-marker-trend"
      aria-labelledby={headId}
      data-marker={v.markerId}
      onKeyDown={(e) => {
        if (
          e.key.toLowerCase() !== 't' ||
          e.metaKey ||
          e.ctrlKey ||
          e.altKey ||
          quiet ||
          (e.target as Element).closest('[role="dialog"], aside')
        )
          return;
        e.preventDefault();
        e.stopPropagation();
        setSection('twin');
        setOpen(true);
      }}
    >
      <div className="lm-marker-trend__head">
        <h4 id={headId}>
          <button
            type="button"
            className="lm-marker-trend__open"
            aria-haspopup="dialog"
            aria-expanded={open || undefined}
            onClick={() => {
              setSection(undefined);
              setOpen(true);
            }}
          >
            {v.label}
          </button>
        </h4>
        <StateWord word={status} icon={statusIcon} />
        {v.sampleNote && (!quiet || !/\d/.test(v.sampleNote)) ? <MonoMeta>{v.sampleNote}</MonoMeta> : null}
      </div>
      <MarkerChart v={v} style={style} quiet={quiet} />
      <div className="lm-marker-trend__reading">
        {quiet ? (
          <MonoMeta>{formatMarkerDate(last.date, style, false)}</MonoMeta>
        ) : (
          <HeroNumber
            value={displayValue(v.markerId, last.value, v.unit)}
            unit={v.unit}
            unitPlacement={v.unit.length > 8 ? 'below' : 'inline'}
            size="stat"
            label={`${v.label}: ${displayValue(v.markerId, last.value, v.unit)} ${v.unit}`}
          />
        )}
        {v.retestDate ? (
          <MonoMeta>{`Retest ${formatMarkerDate(v.retestDate, style, false)}`}</MonoMeta>
        ) : null}
      </div>
      {v.projectionStatus ? (
        <MonoMeta className="lm-marker-trend__projection">
          {MARKER_TRENDS_COPY.projection(v.projectionStatus)}
        </MonoMeta>
      ) : null}
      <InfoPanel
        {...markerInfo(v, style, quiet)}
        open={open}
        onClose={() => setOpen(false)}
        section={section}
      />
    </article>
  );
}

/** The latest draw's sample status (fasting glucose) or HOMA-IR (insulin), as a short inline word (D7-06/D7-09). */
export function sampleNoteOf(
  r: MarkerReading,
  doc: MarkersDoc,
  ctx: Pick<RuleContext, 'flags'>,
): string | undefined {
  if (r.id === 'fpg') {
    const f = sampleFastingOf(r);
    return f === 'unknown'
      ? MARKER_TRENDS_COPY.fastingUnknown
      : f === 'notFasting'
        ? MARKER_TRENDS_COPY.notFasting
        : undefined;
  }
  if (r.id === 'insulin') {
    const h = homaFor(r, doc, ctx);
    if (h.status === 'eligible') return MARKER_TRENDS_COPY.homa(h.value.toFixed(1));
    return MARKER_TRENDS_COPY.homaWhy[h.reasons[0] ?? 'noGlucose'] || undefined;
  }
  return undefined;
}

/**
 * The views for every marker with readings (pure). `ctx` is the rules' context (freshness: diet and medication changes;
 * flags for the insulin context); without it, the day alone.
 */
export function markerTrendViews(
  doc: MarkersDoc,
  evaluation: MarkerEvaluation,
  plan: PlanLike | null,
  today: string,
  ctx?: RuleContext | FreshnessContext,
): MarkerSeriesView[] {
  const fresh = freshnessOf(doc, ctx ?? today);
  const reviews = markerReviewStates(doc, fresh, evaluation);
  const flags = ctx && 'flags' in ctx ? { flags: ctx.flags ?? [] } : {};
  return MARKER_IDS.flatMap((id) => {
    const due =
      evaluation.retests
        .filter((r) => r.markerId === id)
        .map((r) => r.due)
        .sort()[0] ?? null;
    const history = historyOf(doc, id);
    const v = markerSeriesView(id, history, plan, today, due);
    if (!v) return [];
    const review = reviews.find((x) => x.markerId === id);
    if (review) v.status = review.label;
    const note = sampleNoteOf(history[history.length - 1]!, doc, flags);
    if (note) v.sampleNote = note;
    return [v];
  });
}

/** Progress section: compact reading rows, with the complete readings and projection in the (i) table twins. */
export function MarkerTrendsSection({
  plan,
  id = 'markers',
  quiet: quietOverride,
}: {
  plan: PlanLike | null;
  id?: string;
  quiet?: boolean;
}) {
  const mode = useQuietMode();
  const quiet = quietOverride ?? mode.on;
  // A fresh quiet period forgets the earlier reveal; the person's setting is never changed by Show numbers.
  return <MarkerTrendsContent key={quiet ? 'quiet' : 'numbers'} plan={plan} id={id} quiet={quiet} />;
}

function MarkerTrendsContent({
  plan,
  id,
  quiet: quietMode,
}: {
  plan: PlanLike | null;
  id: string;
  quiet: boolean;
}) {
  const today = markersToday();
  const { doc, evaluation, ctx } = useMarkerEvaluation(today);
  const style = useMarkerDateStyle();
  const [showNumbers, setShowNumbers] = useState(false);
  const quiet = quietMode && !showNumbers;
  const views = useMemo(
    () => markerTrendViews(doc, evaluation, plan, today, ctx),
    [doc, evaluation, plan, today, ctx],
  );
  const twin =
    !quiet && views.length ? (
      <>
        {views.map((v) => (
          <ChartTwin key={v.markerId} data={markerTwin(v, style)} />
        ))}
      </>
    ) : undefined;
  return (
    <GradientCard
      id={id}
      domain="body"
      className="lv-prog-face lm-marker-card"
      head={
        <CardHead as="h2" icon={Droplet} title={MARKER_TRENDS_COPY.title} info={{ ...MARKERS_INFO, twin }} />
      }
      foot={
        <CardFoot state={{ word: views.length ? 'Entered results' : MARKER_TRENDS_COPY.empty }}>
          {quietMode && views.length ? (
            <Key variant="text" size="sm" onClick={() => setShowNumbers((v) => !v)}>
              {showNumbers ? 'Hide numbers' : 'Show numbers'}
            </Key>
          ) : null}
          <KeyLink variant="action" size="sm" arrow to={markersChapterHref()}>
            {views.length ? MARKER_TRENDS_COPY.reenter : MARKER_TRENDS_COPY.add}
          </KeyLink>
        </CardFoot>
      }
    >
      <div className="lm-marker-trends">
        {views.length
          ? views.map((v) => (
              <MarkerTrend
                key={`${v.markerId}-${quiet ? 'quiet' : 'numbers'}`}
                v={v}
                style={style}
                quiet={quiet}
              />
            ))
          : (['ldl', 'hdl', 'tg'] as const).map((marker) => (
              <div key={marker} className="lm-marker-trend lm-marker-trend--ghost">
                <span>{MARKER_UNITS[marker].label}</span>
                <svg className="lm-marker-trend__spark" viewBox="0 0 96 28" aria-hidden="true">
                  <path d="M5 18H91" />
                </svg>
                <MonoMeta>No result</MonoMeta>
              </div>
            ))}
      </div>
    </GradientCard>
  );
}
