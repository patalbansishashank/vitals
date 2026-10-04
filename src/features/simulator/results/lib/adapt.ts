/**
 * Engine result → chart data (CHART_SPEC §2, §4; MODEL_SPEC §6-8). Builds an `EngineLikeResult` with the display
 * transforms applied (presentation mode, unit conversion, 0–1 → index) and hands it to the chart module's
 * `adaptResult`, then adds what the generic adapter cannot know: the TDEE stack, the weight decomposition, the
 * ketosis state band, event labels and the per-hour likely range.
 *
 * Bands: the ensemble's P10/P90 when present (they refine as draws stream in); otherwise the catalogue's fixed
 * fallback (±NN % of the change from the start, or of the value; MODEL_SPEC §8.2) so every channel carries a
 * likely range from the first frame.
 */
import type { CompiledSchedule, Schedule, SimulationResult } from '@/engine';
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
  /** Draws folded in so far / planned. */
  draws?: number;
  total?: number;
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

  for (const m of catalogue) {
    const raw = (result.daily as Arrays)[m.id];
    if (!raw || raw.length !== n || allNaN(raw)) continue;
    const base = engineBaseline(result, m.id, m.agg);
    const show = (v: number) => presentValue(m, v, base);
    const values = mapArray(raw, show);
    daily[m.id] = values;
    baseline[m.id] = m.presentation === 'deltaFromBaseline' ? 0 : base * m.factor;

    // likely range
    const p10 = bands?.p10?.[m.id];
    const p90 = bands?.p90?.[m.id];
    const method = bands?.method?.[m.id];
    let lo: Float32Array | undefined;
    let hi: Float32Array | undefined;
    if (m.bandNone) bandSource.set(m.id, 'none');
    else if (p10 && p90 && p10.length === n && p90.length === n && method !== 'none' && method !== 'fallback') {
      lo = mapArray(p10, show);
      hi = mapArray(p90, show);
      bandSource.set(m.id, 'draws');
    } else if (m.bandFallback && method !== 'none') {
      const fb = fallbackBand(raw, base, m.bandFallback);
      lo = mapArray(fb.lo, show);
      hi = mapArray(fb.hi, show);
      bandSource.set(m.id, 'fallback');
    } else bandSource.set(m.id, 'none');
    if (lo && hi) {
      // the nominal line must sit inside its range (the ensemble's median and the nominal run can differ slightly)
      for (let i = 0; i < n; i++) {
        const v = values[i]!;
        const a = Math.min(lo[i]!, hi[i]!, v);
        const b = Math.max(lo[i]!, hi[i]!, v);
        lo[i] = a;
        hi[i] = b;
      }
      dailyBand[m.id] = { p10: lo, p90: hi };
    }

    // hourly curve for fast metrics; its range borrows the day's band half-widths (the engine bands are daily)
    const hr = (result.hourly as Arrays)[m.id];
    if (hr && hr.length === n * 24) {
      // hourly samples of daily sums (kcal per hour) are shown as the day rate (× 24) so the unit stays "per day"
      const perDay = m.agg === 'sum' ? 24 : 1;
      const hv = mapArray(hr, (v) => show(v * perDay));
      hourly[m.id] = hv;
      if (lo && hi) {
        const hlo = new Float32Array(hv.length);
        const hhi = new Float32Array(hv.length);
        for (let i = 0; i < hv.length; i++) {
          const d = Math.floor(i / 24);
          hlo[i] = hv[i]! - Math.max(0, values[d]! - lo[d]!);
          hhi[i] = hv[i]! + Math.max(0, hi[d]! - values[d]!);
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
    });
    metrics.set(m.id, { ...m, lane: kind });
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
  return { data, metrics, bandSource };
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
