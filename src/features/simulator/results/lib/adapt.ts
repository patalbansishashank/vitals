/**
 * Engine result → chart data (CHART_SPEC §2, §4; MODEL_SPEC §6-8). Builds an `EngineLikeResult` with the display
 * transforms applied (presentation mode, unit conversion, 0–1 → index) and hands it to the chart module's
 * `adaptResult`, then adds what the generic adapter cannot know: the TDEE stack, the weight decomposition, the
 * ketosis state band, event labels and the per-hour range.
 *
 * Bands: the ensemble's P10/P90 when present (they refine as draws stream in: a parameter-sensitivity range with
 * unvalidated coverage, C6/D8-02), drawn exactly at the members' endpoints — the nominal line is its own trajectory and is
 * never folded into the range (it may sit outside it); otherwise the catalogue's fixed fallback (±NN % of the change from
 * the start, or of the value; MODEL_SPEC §8.2), a separately named heuristic display range while the variations run. A
 * channel whose band the ensemble marks `method: 'none'` (no member contributed) gets no range at all, whatever arrays
 * travel with it. A day the ensemble reports without a usable range (no valid member, or members excluded by their own
 * status or validity, A1-049) gets a chart-local gap there: never the nominal, a previous day's range or the finite
 * compatibility numbers stored in its slot.
 */
import type { CompiledSchedule, Schedule, SeriesId, SimulationResult } from '@/engine';
import { BAND_DAY_METHOD, INTERPRETABLE_STATUSES, STATUS_LABEL, bandDayUsable, type BandAvailability, type BandMeta, type OutputStatus, type UncertaintyKind } from '@/lib/bodyContracts';
import { adaptResult, type ChartData, type ChartSeries, type CompositionTracks, type EngineLikeResult, type EngineMetricMeta, type StateTrack } from '@/features/charts';
import { displayCatalogue, METRIC_UNITS, type DisplayMetric, type UnitPrefs } from './metrics';
import { intakeContext, schedulePhases } from './schedule';
import { eventsForChart } from './events';

type Arrays = Partial<Record<string, Float32Array>>;

/** The ensemble summary as it streams in (a `BandedResult` or a partial of it). */
export interface BandsLike {
  p10?: Arrays;
  p90?: Arrays;
  method?: Partial<Record<string, 'draws' | 'fallback' | 'none'>>;
  /** D8-02: band semantics by channel (`BandedResult.bandMeta`); `method: 'none'` means no range. */
  bandMeta?: Partial<Record<string, BandMeta>>;
  /**
   * A1-049: per-day band availability by channel (`BandedResult.bandDays`): which days carry a usable range (full, or the
   * valid members' only), the attempted/valid/excluded members with the reasons, and the members' own status and onset.
   * Absent (a legacy result): every day with finite quantiles is a range.
   */
  bandDays?: Partial<Record<string, BandAvailability>>;
  /** Draws folded in so far / planned. */
  draws?: number;
  total?: number;
}

/** A1-049: the per-day accounting of one drawn range, as the chart and the readouts use it. */
export interface ResolvedBandDays {
  /** 1 where the day's range is drawn and read; 0 = no range that day (a gap). */
  usable: Uint8Array;
  /** 1 where the usable range is the valid members' only (a named conditional range, never the full ensemble's). */
  conditional: Uint8Array;
  /** The producer's accounting (absent for a legacy result). */
  availability?: BandAvailability;
}

/** What one channel's range is (C6/D8-02, A1-049/A1-051): where it came from, its kind and, for draws, its day accounting. */
export interface SeriesBandInfo {
  source: 'draws' | 'fallback' | 'none';
  /** The producer's kind for draws; 'heuristic' for the fixed display fallback; 'none' without a range. */
  uncertaintyKind: UncertaintyKind;
  /** Members behind a drawn range (the producer's count; absent when not reported). */
  members?: number;
  days?: ResolvedBandDays;
  /** The members' qualifying status (a conditional scenario range) from its first day. */
  qualifier?: { status: OutputStatus; fromDay: number };
}

export interface ResultsInput {
  result: SimulationResult;
  bands?: BandsLike | null;
  schedule?: Schedule | null;
  compiled?: CompiledSchedule | null;
  /** Warnings shown as safety events (defaults to `result.warnings`). */
  warnings?: SimulationResult['warnings'];
}

export interface AdaptedResults {
  data: ChartData;
  /** Display metrics present in the result, by id (catalogue order). */
  metrics: Map<string, DisplayMetric>;
  /** Where each metric's band came from. */
  bandSource: Map<string, 'draws' | 'fallback' | 'none'>;
  /** What each metric's band is, with the drawn range's per-day accounting (A1-049); read by the readouts. */
  bandInfo: Map<string, SeriesBandInfo>;
}

/**
 * The run's C6 status of one series: the engine's `meta.outputStatus` when it set one, else Exploratory for a latent or
 * legacy research index (`EXPLORATORY_SERIES`), else none (a plain estimate under the run's assumptions).
 */
export function seriesStatus(result: SimulationResult, m: Pick<DisplayMetric, 'id' | 'exploratory'>): { status?: OutputStatus; fromDay?: number } {
  const st = result.meta.outputStatus?.[m.id as SeriesId];
  if (st) {
    // A1-052: a baseline outside the model's domain makes every modelled sample unsupported, the first end-of-day value
    // (index 0, already a response to day 1) included; only the t = 0 anchor (`initial`, `observedAnchors`) is observed
    const fromDay = statusHidesValues(st.status) && BASELINE_DOMAIN_REASONS.has(st.reasonCode) ? 0 : st.fromDay;
    return { status: st.status, ...(fromDay !== undefined ? { fromDay } : {}) };
  }
  return m.exploratory ? { status: 'exploratory' } : {};
}

/** Interpretable member statuses that qualify a drawn range (it stays, with its word): scenario, limited, partial. */
const QUALIFYING_BAND_STATUSES: ReadonlySet<OutputStatus> = new Set<OutputStatus>(['scenario', 'limited', 'partial']);

/**
 * Reasons that put a series' whole modelled run outside the domain because of its measured (or dependent) t = 0 baseline
 * (D7-02): its zero-based daily samples are all responses after t = 0, so the status applies from index 0 whatever day an
 * older producer stamped (A1-052).
 */
export const BASELINE_DOMAIN_REASONS: ReadonlySet<string> = new Set([
  'observedBaselineOutsideCalibration',
  'dependsOnOutOfDomainBaseline',
  'measuredBaselineOutsideModelDomain',
  'measuredBaselineFlaggedOutOfDomain',
  'measuredBaselineNotReproduced',
  'measuredAnchorOutOfDomain',
]);

/**
 * The days on which a drawn range is usable (A1-049): finite endpoints and, when the producer reports it, a day method other
 * than none (`bandDayUsable`: no valid member, or a model-limit/domain exclusion without an explicitly named valid-domain
 * range, is none). A `conditionalValid` day is the valid members' range only and is named so wherever it is read.
 */
export function resolveBandDays(p10: ArrayLike<number>, p90: ArrayLike<number>, av: BandAvailability | undefined, n: number): ResolvedBandDays {
  const usable = new Uint8Array(n);
  const conditional = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(p10[i]!) || !Number.isFinite(p90[i]!) || !bandDayUsable(av, i)) continue;
    usable[i] = 1;
    if (av && av.method[i] === BAND_DAY_METHOD.conditionalValid) conditional[i] = 1;
  }
  return { usable, conditional, ...(av ? { availability: av } : {}) };
}

/**
 * D7-02: the accepted measurement the run anchored at t = 0 for this series (`meta.observedAnchors`), in the display
 * unit system with its absolute unit; null for relative markers or without an anchor.
 */
export function observedOf(result: SimulationResult, m: Pick<DisplayMetric, 'id' | 'engineUnit' | 'unit' | 'factor' | 'scale100'>): { value: number; unit: string } | null {
  const a = result.meta.observedAnchors?.find((x) => x.series === m.id);
  if (!a || !Number.isFinite(a.value) || m.engineUnit === 'rel' || m.scale100) return null;
  return { value: a.value * m.factor, unit: m.unit.replace(/ vs start$/, '') };
}

/** Whether a status forbids reading the series' numbers (C6): the values are hidden and the status word shown instead. */
export const statusHidesValues = (status: OutputStatus | undefined): boolean => status !== undefined && !INTERPRETABLE_STATUSES.has(status);

/**
 * Status words by series id for the table view (`DataTable.statusWords`, C6): a cell whose value a status hides shows
 * the word ("Unsupported", "Model limit") instead of a dash; a research index whose readout is a word only shows it too.
 */
export function statusWordsOf(metrics: ReadonlyMap<string, Pick<DisplayMetric, 'status' | 'wordOnly'>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, m] of metrics) {
    if (m.status && statusHidesValues(m.status)) out[id] = STATUS_LABEL[m.status];
    else if (m.wordOnly) out[id] = STATUS_LABEL[m.wordOnly];
  }
  return out;
}

/** Value before day 1 in engine units: `initial` for end/wake/max aggregations, else the first daily value. */
export function engineBaseline(result: SimulationResult, id: string, agg: DisplayMetric['agg']): number {
  const daily = (result.daily as Arrays)[id];
  const init = (result.initial as Partial<Record<string, number>>)[id];
  const instantaneous = agg === 'sum' || agg === 'mean' || agg === 'min';
  if (!instantaneous && init != null && Number.isFinite(init)) return init;
  return daily && daily.length ? daily[0]! : Number.NaN;
}

/** Display transform for one metric: engine value → shown value (presentation + unit conversion). */
export function presentValue(m: Pick<DisplayMetric, 'presentation' | 'engineUnit' | 'factor'>, v: number, base: number): number {
  if (m.presentation === 'deltaFromBaseline') {
    if (m.engineUnit === 'rel') return base !== 0 && Number.isFinite(base) ? 100 * (v / base - 1) : Number.NaN;
    return (v - base) * m.factor;
  }
  return v * m.factor;
}

function mapArray(src: Float32Array, f: (v: number) => number): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = f(src[i]!);
  return out;
}

/** Fixed fallback band (engine units) around the nominal series (MODEL_SPEC §8.2). */
export function fallbackBand(values: Float32Array, base: number, fb: NonNullable<DisplayMetric['bandFallback']>): { lo: Float32Array; hi: Float32Array } {
  const lo = new Float32Array(values.length);
  const hi = new Float32Array(values.length);
  const k = fb.pct / 100;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    const half = fb.kind === 'change' ? Math.abs(v - base) * k : Math.abs(v) * k;
    lo[i] = v - half;
    hi[i] = v + half;
  }
  return { lo, hi };
}

/** Ketosis state (engine 0 none · 1 light · 2 nutritional · 3 fasting · 4 warning) → chart ordinal band. */
export function ketosisStateTrack(result: SimulationResult): StateTrack | undefined {
  const daily = result.daily.ketosisState;
  if (!daily) return undefined;
  const toLevel = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(3, Math.round(v))) : 0);
  const d = new Uint8Array(daily.length);
  for (let i = 0; i < daily.length; i++) d[i] = toLevel(daily[i]!);
  const hv = result.hourly.ketosisState;
  let h: Uint8Array | undefined;
  if (hv && hv.length === daily.length * 24) {
    h = new Uint8Array(hv.length);
    for (let i = 0; i < hv.length; i++) h[i] = toLevel(hv[i]!);
  }
  return { id: 'ketosis', label: 'Ketosis', levels: ['none', 'forming', 'nutritional', 'deep'], daily: d, hourly: h };
}

/**
 * Weight decomposition tracks (CHART_SPEC §7.5), kg in display units. Scale weight = fat + lean tissue + glycogen with
 * its bound water + fluid shift + gut contents (MODEL_SPEC §1.10); "water" carries the fluid shift and gut contents
 * together so the weekly net equals the scale change; `gut` is returned separately for the caption.
 */
export function compositionTracks(result: SimulationResult, massFactor = 1): (CompositionTracks & { gut: Float32Array; baseline: Record<keyof CompositionTracks, number> }) | undefined {
  const d = result.daily;
  if (!d.fatMass || !d.leanTissue) return undefined;
  const n = result.meta.nDays;
  const z = new Float32Array(n);
  const gly = d.glycogenWater ?? z;
  const ecf = d.ecfShift ?? z;
  const gut = d.gutContent ?? z;
  const f = (a: Float32Array) => mapArray(a, (v) => v * massFactor);
  const water = new Float32Array(n);
  for (let i = 0; i < n; i++) water[i] = ((ecf[i] ?? 0) + (gut[i] ?? 0)) * massFactor;
  const init = result.initial as Partial<Record<string, number>>;
  return {
    fat: f(d.fatMass),
    lean: f(d.leanTissue),
    glycogen: f(gly),
    water,
    gut: f(gut),
    baseline: {
      fat: (init.fatMass ?? d.fatMass[0]!) * massFactor,
      lean: (init.leanTissue ?? d.leanTissue[0]!) * massFactor,
      glycogen: 0,
      water: 0,
    },
  };
}

/** Attach the TDEE components (stack) and the "expected without adaptation" line to the TDEE series. */
function withTdeeStack(s: ChartSeries, result: SimulationResult, factor: number): ChartSeries {
  const d = result.daily;
  const n = result.meta.nDays;
  const tdee = d.tdee;
  if (!tdee) return s;
  const z = new Float32Array(n);
  const tef = d.tef ?? z;
  const neat = d.neat ?? z;
  const ex = d.exerciseEE ?? z;
  // resting absorbs the small remainder so the stack sums exactly to the total line
  const resting = new Float32Array(n);
  for (let i = 0; i < n; i++) resting[i] = (tdee[i]! - tef[i]! - neat[i]! - ex[i]!) * factor;
  const counter = d.metabolicAdaptation ? mapArray(tdee, (v) => v) : undefined;
  if (counter && d.metabolicAdaptation) for (let i = 0; i < n; i++) counter[i] = (tdee[i]! - d.metabolicAdaptation[i]!) * factor;
  return {
    ...s,
    kind: 'stacked-area',
    stack: {
      components: [
        { id: 'resting', label: 'resting (RMR)', daily: resting },
        { id: 'tef', label: 'digestion (TEF)', daily: mapArray(tef, (v) => v * factor) },
        { id: 'neat', label: 'movement (NEAT)', daily: mapArray(neat, (v) => v * factor) },
        { id: 'exercise', label: 'exercise', daily: mapArray(ex, (v) => v * factor) },
      ],
      counterfactual: counter ? { label: 'without adaptation', daily: counter } : undefined,
    },
  };
}

/** Whether every finite value lies on the 0–100 index scale (else an index lane would clip it). */
function fitsIndex(...arrays: Array<Float32Array | undefined>): boolean {
  for (const a of arrays) {
    if (!a) continue;
    for (let i = 0; i < a.length; i++) {
      const v = a[i]!;
      if (Number.isFinite(v) && (v < -0.5 || v > 100.5)) return false;
    }
  }
  return true;
}

function allNaN(a: Float32Array): boolean {
  for (let i = 0; i < a.length; i++) if (Number.isFinite(a[i]!)) return false;
  return true;
}

/**
 * Adapt a simulation (plus its streaming bands, schedule and compiled schedule) to the chart contract.
 * Metrics the result does not carry (not recorded, or NaN for the other sex) are left out.
 */
export function buildResultsData(input: ResultsInput, prefs: UnitPrefs = METRIC_UNITS): AdaptedResults {
  const { result } = input;
  const n = result.meta.nDays;
  const bands = input.bands ?? null;
  const catalogue = displayCatalogue(prefs);
  const daily: Arrays = {};
  const dailyBand: Record<string, { p10: Float32Array; p90: Float32Array }> = {};
  const hourly: Arrays = {};
  const hourlyBand: Record<string, { p10: Float32Array; p90: Float32Array }> = {};
  const baseline: Record<string, number> = {};
  const metas: EngineMetricMeta[] = [];
  const metrics = new Map<string, DisplayMetric>();
  const bandSource = new Map<string, 'draws' | 'fallback' | 'none'>();
  const bandInfo = new Map<string, SeriesBandInfo>();
  const none = (id: string) => {
    bandSource.set(id, 'none');
    bandInfo.set(id, { source: 'none', uncertaintyKind: 'none' });
  };

  for (const m of catalogue) {
    const raw = (result.daily as Arrays)[m.id];
    if (!raw || raw.length !== n || allNaN(raw)) continue;
    // C6: numbers and statuses travel separately. A status that forbids interpreting the numbers hides them from its day
    // on (the chart shows a gap, the readout the status word); from day 0 the series leaves the chart and stays only as
    // a status for the readouts. An accepted measurement used as the t = 0 anchor stays visible (D7-02).
    const { status, fromDay } = seriesStatus(result, m);
    const hideFrom = statusHidesValues(status) ? Math.max(0, Math.min(n, Math.floor(fromDay ?? 0))) : n;
    const observed = observedOf(result, m);
    const withStatus: DisplayMetric = status ? { ...m, status, ...(fromDay !== undefined ? { statusFromDay: fromDay } : {}), ...(observed ? { observed } : {}) } : observed ? { ...m, observed } : m;
    if (hideFrom === 0) {
      metrics.set(m.id, withStatus);
      none(m.id);
      continue;
    }
    const base = engineBaseline(result, m.id, m.agg);
    const show = (v: number) => presentValue(m, v, base);
    const values = mapArray(raw, show);
    for (let i = hideFrom; i < n; i++) values[i] = Number.NaN;
    daily[m.id] = values;
    baseline[m.id] = m.presentation === 'deltaFromBaseline' ? 0 : base * m.factor;

    // range (P10–P90 of the draws: a parameter-sensitivity range with unvalidated coverage, C6/D8-02)
    const p10 = bands?.p10?.[m.id];
    const p90 = bands?.p90?.[m.id];
    const meta = bands?.bandMeta?.[m.id];
    // the producer's explicit "no band" wins over any compatibility arrays or method map (A1-051)
    const method = meta?.method === 'none' ? 'none' : (bands?.method?.[m.id] ?? meta?.method);
    let lo: Float32Array | undefined;
    let hi: Float32Array | undefined;
    let days: ResolvedBandDays | undefined;
    // an exploratory index or a hidden stretch gets no band: a range whose bounds lack warrant is not drawn (C6, D2-02)
    if (m.bandNone || m.exploratory || status === 'exploratory' || hideFrom < n) none(m.id);
    else if (p10 && p90 && p10.length === n && p90.length === n && method !== 'none' && method !== 'fallback') {
      // each endpoint keeps its own value under the unit/presentation transform; the nominal is never inserted (A1-051);
      // a day without a usable range is a chart-local gap (A1-049), never its compatibility numbers
      const av = bands?.bandDays?.[m.id];
      days = resolveBandDays(p10, p90, av, n);
      const u = days.usable;
      lo = new Float32Array(n);
      hi = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        lo[i] = u[i] ? show(p10[i]!) : Number.NaN;
        hi[i] = u[i] ? show(p90[i]!) : Number.NaN;
      }
      // labelled scenario/limited members stay in the range; the range carries their status from its first day
      const qualifier = av && QUALIFYING_BAND_STATUSES.has(av.status) ? { status: av.status, fromDay: Math.max(0, Math.floor(av.fromDay ?? 0)) } : meta?.uncertaintyKind === 'scenario' ? { status: 'scenario' as const, fromDay: 0 } : undefined;
      bandSource.set(m.id, 'draws');
      bandInfo.set(m.id, {
        source: 'draws',
        uncertaintyKind: (qualifier && av?.uncertaintyKind) || meta?.uncertaintyKind || 'parameterSensitivity',
        ...(meta && meta.draws > 0 ? { members: meta.draws } : av ? { members: av.attempted } : bands?.draws ? { members: bands.draws } : {}),
        days,
        ...(qualifier ? { qualifier } : {}),
      });
    } else if (m.bandFallback && method !== 'none') {
      // a separately named heuristic display range around the nominal (no ensemble range yet), never a producer's "none"
      const fb = fallbackBand(raw, base, m.bandFallback);
      lo = mapArray(fb.lo, show);
      hi = mapArray(fb.hi, show);
      bandSource.set(m.id, 'fallback');
      bandInfo.set(m.id, { source: 'fallback', uncertaintyKind: 'heuristic' });
    } else none(m.id);
    if (lo && hi) {
      // a presentation transform that flips the order (a negative factor) keeps both endpoints, ordered low → high
      for (let i = 0; i < n; i++) {
        if (lo[i]! > hi[i]!) {
          const t = lo[i]!;
          lo[i] = hi[i]!;
          hi[i] = t;
        }
      }
      dailyBand[m.id] = { p10: lo, p90: hi };
    }

    // hourly curve for fast metrics; its range borrows the day's offsets from the nominal (the engine bands are daily)
    const hr = (result.hourly as Arrays)[m.id];
    if (hr && hr.length === n * 24) {
      // hourly samples of daily sums (kcal per hour) are shown as the day rate (× 24) so the unit stays "per day"
      const perDay = m.agg === 'sum' ? 24 : 1;
      const hv = mapArray(hr, (v) => show(v * perDay));
      for (let i = hideFrom * 24; i < hv.length; i++) hv[i] = Number.NaN;
      hourly[m.id] = hv;
      if (lo && hi) {
        const hlo = new Float32Array(hv.length);
        const hhi = new Float32Array(hv.length);
        for (let i = 0; i < hv.length; i++) {
          const d = Math.floor(i / 24);
          // the same signed distance from the nominal as the day's endpoints (a nominal outside the range stays outside)
          hlo[i] = hv[i]! + (lo[d]! - values[d]!);
          hhi[i] = hv[i]! + (hi[d]! - values[d]!);
        }
        hourlyBand[m.id] = { p10: hlo, p90: hhi };
      }
    }

    const kind = m.lane === 'index' && !fitsIndex(values, lo, hi) ? 'line' : m.lane;
    metas.push({
      id: m.id,
      label: m.label,
      shortLabel: m.shortLabel,
      unit: m.unit,
      category: m.category,
      grade: m.grade,
      direction: m.direction,
      decimals: m.decimals,
      kind,
      overlay: m.overlay,
      overlayNote: m.overlayNote,
      thresholds: m.thresholds,
      mechanism: m.mechanism,
      display: { ...(m.wordOnly ? { wordOnly: STATUS_LABEL[m.wordOnly] } : {}), ...(status && !statusHidesValues(status) && status !== 'estimated' ? { qualifier: STATUS_LABEL[status] } : {}), ...(observed ? { observed } : {}) },
    });
    metrics.set(m.id, { ...withStatus, lane: kind });
  }

  const engineLike: EngineLikeResult = {
    days: n,
    startDate: result.meta.startDate,
    daily: daily as Record<string, Float32Array>,
    dailyBand,
    hourly: hourly as Record<string, Float32Array>,
    hourlyBand,
    baseline,
    events: eventsForChart(result.events, input.warnings ?? result.warnings, n),
    states: [ketosisStateTrack(result)].filter((s): s is StateTrack => !!s),
  };
  const data = adaptResult(engineLike, metas, {
    phases: schedulePhases(input.schedule, result, input.compiled),
    intake: intakeContext(result, input.compiled),
  });

  // TDEE lane carries its components; delta-from-baseline lanes start at zero by definition
  const tdeeFactor = metrics.get('tdee')?.factor ?? 1;
  data.series = data.series.map((s) => {
    if (s.id === 'tdee' && s.kind === 'stacked-area') return withTdeeStack(s, result, tdeeFactor);
    if (s.kind === 'stacked-area') return { ...s, kind: 'line' };
    return s;
  });
  const massFactor = metrics.get('fatMass')?.factor ?? 1;
  const comp = compositionTracks(result, massFactor);
  if (comp) data.composition = { fat: comp.fat, lean: comp.lean, glycogen: comp.glycogen, water: comp.water };
  return { data, metrics, bandSource, bandInfo };
}


/**
 * Whole-horizon scale breakdown (display mass unit): scale change (on waking) and its parts — fat, lean tissue,
 * glycogen with its bound water, fluid shifts, gut contents — each as the last day minus the start.
 */
export function scaleBreakdown(result: SimulationResult, massFactor = 1, unit = 'kg'): { scale: number; fat: number; lean: number; glycogen: number; fluid: number; gut: number; unit: string } | null {
  const d = result.daily;
  const init = result.initial as Partial<Record<string, number>>;
  const n = result.meta.nDays;
  if (!d.scaleWeight || !d.fatMass || !d.leanTissue || n < 1) return null;
  let last = n - 1;
  while (last > 0 && !Number.isFinite(d.fatMass[last]!)) last--;
  const ch = (a: Float32Array | undefined, base: number | undefined) => (a ? (a[last]! - (base ?? a[0]!)) * massFactor : 0);
  return {
    scale: ch(d.scaleWeight, init.scaleWeight),
    fat: ch(d.fatMass, init.fatMass),
    lean: ch(d.leanTissue, init.leanTissue),
    glycogen: ch(d.glycogenWater, 0),
    fluid: ch(d.ecfShift, 0),
    gut: ch(d.gutContent, 0),
    unit,
  };
}
