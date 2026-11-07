/**
 * "Explain this curve" context for the results screen (QA 11): the metric's value where the reader is looking (the
 * crosshair, the pinned sample, or the end of the projection) with its unit and range (P10–P90 of the model variations),
 * its C6 status with the reason, range basis, model limit, resolution and assumptions, and "what is driving it
 * here" — a short, per-metric list of related values the result already carries. No engine changes: everything is
 * read from the simulation result, the compiled schedule and the adapted chart data.
 *
 * The driver lists are data (`EXPLAIN_DRIVERS`): plain series ids are shown as they are (value at the same moment,
 * converted to the user's units); `@`-keys are small derived readings (carbohydrate in the last 24 h, hours since the
 * last intake, whether a fast is running, energy vs maintenance, protein per kg, the scale-weight decomposition…).
 */
import type { CompiledSchedule, SimulationResult } from '@/engine';
import { describeSample, formatValueRange, valueAt, type ChartData, type Resolution } from '@/features/charts';
import { formatNumber, formatSigned } from '@/components';
import type { ExplainDriver, ExplainReading } from '@/features/evidence';
import type { ExplainStatus } from '@/features/evidence/ExplainDrawer';
import { EXPLORATORY_SERIES, type SeriesId } from '@/engine/types/metrics';
import { INTERPRETABLE_STATUSES, STATUS_LABEL, type BandMeta, type UncertaintyKind } from '@/lib/bodyContracts';
import { WORD_ONLY, convertUnit, seriesDefOf, toDisplayMetric, type UnitPrefs } from './metrics';

/** Where the reader is looking: snapped time (days) and the resolution the chart shows. */
export interface ExplainCursor {
  t: number | null;
  pinned: boolean;
  res: Resolution;
}

export interface ExplainSources {
  data: ChartData;
  result: SimulationResult;
  compiled?: CompiledSchedule | null;
  prefs: UnitPrefs;
}

/** Per-metric drivers, most telling first. Series ids or `@` derived readings (see `DERIVED`). */
export const EXPLAIN_DRIVERS: Readonly<Record<string, readonly string[]>> = {
  bhb: ['@carbs', '@sinceMeal', 'liverGlycogen', '@fast', 'ketoAdaptation'],
  totalKetones: ['@carbs', '@sinceMeal', 'liverGlycogen', '@fast'],
  hoursInKetosis: ['@carbs', '@fast', 'liverGlycogen', 'ketoAdaptation'],
  ketoAdaptation: ['@carbs', 'hoursInKetosis'],
  glycogenTotal: ['@carbs', '@training', '@fast'],
  liverGlycogen: ['@carbs', '@sinceMeal', '@fast'],
  muscleGlycogen: ['@carbs', '@training'],
  glucose: ['@sinceMeal', '@carbs', 'insulinSensitivity'],
  fatOxidation: ['@carbs', '@energy', '@fast'],
  scaleWeight: ['@decomp'],
  leanMass: ['@decomp'],
  fatMass: ['@energy', '@energy7', '@proteinPerKg'],
  bodyFatPct: ['fatMass', 'scaleWeight'],
  waist: ['@fatChange', 'visceralFat'],
  leanTissue: ['@energy7', '@proteinPerKg', '@rtSets7'],
  skeletalMuscle: ['@energy7', '@proteinPerKg', '@rtSets7'],
  rtMuscleGain: ['@rtSets7', '@proteinPerKg', '@energy7'],
  hunger: ['@energy7', '@proteinShare', 'inSleep', 'dietFatigue', '@fatChange'],
  adherence: ['hunger', '@energy7', 'dietFatigue'],
  tdee: ['rmr', 'neat', 'exerciseEE', 'tef', 'metabolicAdaptation'],
  maintenance: ['rmr', 'neat', 'exerciseEE', 'tef', 'metabolicAdaptation'],
  rmr: ['@fatChange', 'metabolicAdaptation'],
  metabolicAdaptation: ['@energy7', '@fatChange'],
  energyBalance: ['inEnergy', 'tdee'],
  autophagyIdx: ['@sinceMeal', '@fast', 'mtorIdx', 'ampkIdx'],
  mtorIdx: ['@sinceMeal', 'inProtein', '@training'],
  ampkIdx: ['@sinceMeal', '@fast', '@training'],
  mps: ['inProtein', '@training', '@energy'],
  energyAvailability: ['inEnergy', 'exerciseEE'],
  insulinSensitivity: ['@fatChange', '@rtSets7', 'inSleep'],
  leptin: ['@fatChange', '@energy7'],
};

/** Heading of the drivers list where "what is driving it" would misdescribe it. */
export function explainDriversTitle(id: string): string {
  if (id === 'scaleWeight' || id === 'leanMass') return 'what it is made of · change since the start';
  if (id === 'tdee' || id === 'maintenance') return 'what it is made of';
  return 'what is driving it here';
}

/**
 * Plain reasons for the run statuses the engine sets (C6 `reasonCode`), for the Explain sheet only (the operating screen
 * shows the word). Unknown codes show the status word alone; prefixed codes (`intakeTiming:…`, `eaExposure.…`) match on
 * their prefix.
 */
const STATUS_REASON: Readonly<Record<string, string>> = {
  outOfDomain: 'outside the model’s calibration range; the measured value stays at the start',
  measuredAnchorOutOfDomain: 'outside the model’s calibration range; the measured value stays at the start',
  observedBaselineOutsideCalibration: 'measured value outside the model’s calibration range; it stays as measured at the start',
  measuredBaselineOutsideModelDomain: 'measured value outside the model’s calibration range; it stays as measured at the start',
  measuredBaselineFlaggedOutOfDomain: 'measured value marked outside the model’s range; it stays as measured at the start',
  measuredBaselineNotReproduced: 'the model cannot start from this measured value; it stays as measured at the start',
  dependsOnOutOfDomainBaseline: 'depends on a measured value outside the model’s calibration range',
  modelLimit: 'the model reached a numerical limit',
  tissueFloorModelLimit: 'the run reached a tissue floor the model does not support; later days are not shown',
  tissueLedgerNotConserved: 'the tissue energy ledger stopped closing; later days are not shown',
  unsupportedPartition: 'depends on a lean-tissue split the inputs do not support',
  veryLowIntakeOutsideSupport: 'very low intake, outside the range the fat and lean split was fitted on',
  lowProteinSurplusPartition: 'a surplus with low protein: lean gain is a broad scenario',
  unknownProteinSurplusPartition: 'a surplus with unknown protein: lean gain is a broad scenario',
  legacyRollingIntakeRouting: 'fasting routing reads the last 24 h of actual intake (an approximation)',
  dailyResolution: 'daily model: within-day timing is not resolved',
  apoBProxyResponseUnvalidated: 'follows a proxy relation that has not been validated',
  liverFatLatentPrior: 'no measured liver fat: starts from a population prior',
  lemAdverseResponseScenario: 'opt-in adverse LDL response scenario',
  ketogenicLipidResponseUncertain: 'the lipid response to very-low-carbohydrate eating varies widely between people',
  liverKetoCompositionScenario: 'early liver-fat response to low-carbohydrate eating, not a sustained effect',
  liverKetoResponseUnsupported: 'early liver-fat response to low-carbohydrate eating, not a sustained effect',
  homaHepaticCalibrationScenario: 'liver insulin sensitivity is not calibrated from HOMA',
  glucoseLoweringMedicationContext: 'glucose-lowering medication changes the response',
  simulatedResponseIndex: 'a simulated response index, not measured synthesis or muscle growth',
  growthBurnInAnchor: 'training growth anchored on your usual week',
  growthPlateauReference: 'training growth from a plateau reference',
  growthProgressScenario: 'training growth from a progressing scenario',
  taskSpecificIndex: 'a task-specific index, not a strength test',
  fitnessResponseScenario: 'fitness response from effort ratings; a dated field test can calibrate it',
  carbMixtureUnknown: 'carbohydrate taken during sessions is treated as glucose (mixture unknown)',
  fibreHourlyTimingUnsupported: 'hourly timing of fibre energy is not supported',
  genericFibreMeScenario: 'generic fibre energy scenario switched on',
  genericNutMeScenario: 'generic nut energy scenario switched on',
  energyOnlyIntakeTefPrior: 'meals logged as energy only: the digestion cost uses your usual macro mix',
  proteinLowerBoundOnly: 'protein totals are a lower bound (some foods have no protein figure)',
  researchScenarioNoPersonalForecast: 'a research scenario; no personal bone forecast',
  taskScopedTteResearchIndex: 'a research index for one cycling task; not a race time or general endurance',
  patternHeuristicNotIntake: 'a food-pattern heuristic, not measured intake or adequacy',
  modelConcernFlagsNotObservedWellbeing: 'model concern flags, not how you feel',
  exerciseCompensationZeroRmrReference: 'exercise compensation: the no-resting-rate-change reference',
  exerciseCompensationLegacyRmrScenario: 'exercise compensation: a resting-rate response scenario',
};

const PREFIX_REASON: ReadonlyArray<[string, string]> = [
  ['intakeTiming:', 'hourly appearance is not supported with this medication or condition; daily totals still apply'],
  ['eaExposure.', 'a coarse exposure from logged intake, exercise and lean mass; not a diagnosis'],
  ['dailyNative', 'daily model: within-day timing is not resolved'],
];

/** Why a research index reads as a word only (`WORD_ONLY`), for the Explain sheet. */
const WORD_ONLY_REASON: Readonly<Record<string, string>> = {
  autophagyIdx: 'a legacy signalling index; not a measured amount of autophagy',
  mtorIdx: 'a signalling index, not a measurement',
  ampkIdx: 'a signalling index, not a measurement',
  mps: 'a simulated response index, not measured synthesis or muscle growth',
  ketoAdaptation: 'not a percent of adaptation; blood ketones in mmol/L are the observable',
  ketoAdaptFast: 'not a percent of adaptation; blood ketones in mmol/L are the observable',
  ketoAdaptSlow: 'not a percent of adaptation; blood ketones in mmol/L are the observable',
  igf1: 'a mechanism direction, not a predicted lab result',
  leptin: 'a mechanism direction, not a predicted lab result',
  t3: 'a mechanism direction, not a predicted lab result',
  cortisol: 'a mechanism direction, not a predicted lab result',
  testosterone: 'a mechanism direction, not a predicted lab result',
  menstrualRisk: 'a model index, not a chance per cycle',
  adherence: 'a model index, not a chance of keeping to the plan',
  micronutrientScore: 'a food-pattern heuristic, not intake or adequacy',
  hipBmdChange: 'no personal bone density forecast; a dated DXA scan is the observation',
  enduranceCapacity: 'scoped to one cycling task near 75 % of VO₂max; not a race time',
  sleepQuality: 'projected from the model; a quality word is what you enter',
};

export function reasonText(code: string | undefined): string | undefined {
  if (!code) return undefined;
  const direct = STATUS_REASON[code];
  if (direct) return direct;
  return PREFIX_REASON.find(([p]) => code.startsWith(p))?.[1];
}

/** Where the readout's range came from (the adapter's `bandSource`), with the band semantics when the store has them. */
export interface ExplainBandInfo {
  source?: 'draws' | 'fallback' | 'none';
  meta?: BandMeta;
}

/** Plain names of the named run assumptions (`meta.assumptions`) for the details rows; unknown ids are left out. */
const ASSUMPTION_TEXT: Readonly<Record<string, string>> = {
  legacyRollingIntakeRouting: 'fasting routing from the last 24 h of intake',
  unallocatedEnergyHabitualTefMix: 'energy-only meals at your usual macro mix',
  proteinLowerBoundTurnover: 'protein as a lower bound',
  unknownCarbMixtureAsGlucose: 'session carbohydrate as glucose',
  fibreEnergyHourlyTiming: 'fibre energy without hourly timing',
  fibreMeScenario: 'generic fibre energy scenario',
  nutMeScenario: 'generic nut energy scenario',
  growthBurnInAnchor: 'training growth anchored on your usual week',
  growthPlateauReference: 'training growth from a plateau reference',
  growthProgressScenario: 'training growth progressing',
};

/**
 * The C6 status of a channel in this run for the Explain drawer: the engine's `meta.outputStatus` (with its uncertainty
 * kind and reason), else the readout's word-only status, else Exploratory for a research index; a range is a
 * parameter-sensitivity range unless the band says otherwise (`meta` band semantics are never relabelled as a prediction
 * interval). Details: what the range is made of, a model-limit stop, the time resolution, named assumptions and the
 * model version. Null when there is nothing to say.
 */
export function explainStatus(result: SimulationResult, id: string, band?: ExplainBandInfo | null): ExplainStatus | null {
  const st = result.meta.outputStatus?.[id as SeriesId];
  const resolution = result.meta.resolution;
  const details = explainDetails(result, band);
  const word = WORD_ONLY.get(id);
  const bandKind: UncertaintyKind | undefined = band?.source === 'fallback' ? 'heuristic' : band?.source === 'draws' ? (band.meta?.uncertaintyKind ?? 'parameterSensitivity') : undefined;
  const withDetails = (x: ExplainStatus): ExplainStatus => (details.length ? { ...x, details } : x);
  if (st) {
    // the readout's word-only status wins over an interpretable engine status (the sheet says why no number is shown)
    const wordWins = word !== undefined && INTERPRETABLE_STATUSES.has(st.status);
    const reason = (wordWins ? WORD_ONLY_REASON[id] : undefined) ?? reasonText(st.reasonCode) ?? (st.resolution === 'daily' ? STATUS_REASON.dailyResolution : undefined);
    const kind = st.uncertaintyKind ?? bandKind;
    return withDetails({ status: wordWins ? word : st.status, ...(kind ? { uncertaintyKind: kind } : {}), ...(reason ? { reason } : {}) });
  }
  if (word) return withDetails({ status: word, reason: WORD_ONLY_REASON[id] ?? 'a research index, not a measurement or a goal' });
  if (EXPLORATORY_SERIES.has(id as SeriesId)) return withDetails({ status: 'exploratory', reason: 'a research index, not a measurement or a goal' });
  if (resolution === 'daily' || resolution === 'scenario') return withDetails({ status: resolution === 'scenario' ? 'scenario' : 'estimated', reason: STATUS_REASON.dailyResolution, ...(bandKind ? { uncertaintyKind: bandKind } : {}) });
  if (details.length || bandKind) return { ...(bandKind ? { uncertaintyKind: bandKind } : {}), ...(details.length ? { details } : {}) };
  return null;
}

/** Info-sheet rows of a run (C6/C7): range basis, model-limit stop, time resolution, named assumptions, model version. */
export function explainDetails(result: SimulationResult, band?: ExplainBandInfo | null): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  if (band?.source === 'draws') {
    const n = band.meta?.draws ?? 0;
    rows.push({ label: 'Range from', value: `${n > 0 ? `${formatNumber(n, 0)} model variations` : 'model variations'} · coverage not validated` });
  } else if (band?.source === 'fallback') rows.push({ label: 'Range from', value: 'a fixed display range while the variations run' });
  const v = result.meta.validity;
  if (v && v.status !== 'valid') {
    const through = v.validThroughHour !== undefined && Number.isFinite(v.validThroughHour) ? `valid through day ${formatNumber(Math.floor(v.validThroughHour / 24) + 1, 0)}` : null;
    rows.push({ label: v.status === 'modelLimit' ? 'Model limit' : 'Outside the model’s range', value: [through, reasonText(v.reasonCode)].filter(Boolean).join(' · ') || STATUS_LABEL.modelLimit });
  }
  if (result.meta.resolution === 'daily') rows.push({ label: 'Time resolution', value: 'daily' });
  else if (result.meta.resolution === 'scenario') rows.push({ label: 'Time resolution', value: 'scenario days' });
  const named = (result.meta.assumptions ?? []).map((a) => ASSUMPTION_TEXT[a]).filter((x): x is string => !!x);
  if (named.length) rows.push({ label: 'Assumptions', value: [...new Set(named)].join(' · ') });
  if (result.meta.engineVersion) rows.push({ label: 'Model version', value: result.meta.engineVersion });
  return rows;
}

/* ------------------------------------------------------------------------------------------------- moment */

interface Moment {
  day: number;
  /** Absolute hour index when the chart reads hours (hourly or 6-hourly), else null (a whole day). */
  hour: number | null;
}

function momentOf(t: number, res: Resolution, days: number): Moment {
  const day = Math.max(0, Math.min(days - 1, Math.floor(t)));
  if (res === 'daily') return { day, hour: null };
  return { day, hour: Math.max(0, Math.min(days * 24 - 1, Math.floor(t * 24))) };
}

/* ------------------------------------------------------------------------------------------------ reading */

/** The metric's value at the cursor (or at the end of the projection when there is no crosshair). */
export function explainReading(data: ChartData, id: string, cursor: ExplainCursor): ExplainReading | null {
  const s = data.series.find((x) => x.id === id);
  if (!s || data.time.days < 1) return null;
  const endT = data.time.days - 0.5;
  const t = cursor.t ?? endT;
  const res: Resolution = cursor.t == null ? 'daily' : cursor.res;
  const at = valueAt(s, t, res);
  if (!Number.isFinite(at.v)) return null;
  const d = s.format.decimals;
  const when = describeSample(data.time, t, at.res);
  const note =
    cursor.t == null
      ? 'End of the projection. Point at the chart to read another day.'
      : cursor.pinned
        ? 'Pinned on the chart. Unpin it to follow the pointer.'
        : 'Follows the crosshair.';
  return {
    when,
    value: s.unit.includes('vs start') ? formatSigned(at.v, d) : formatNumber(at.v, d),
    unit: s.unit,
    range: Number.isFinite(at.lo) && Number.isFinite(at.hi) && Math.abs(at.hi - at.lo) > 0 ? formatValueRange(at.lo, at.hi, d) : undefined,
    note,
  };
}

/* ------------------------------------------------------------------------------------------------ drivers */

type Arr = Float32Array | undefined;
const daily = (r: SimulationResult, id: string): Arr => (r.daily as Partial<Record<string, Float32Array>>)[id];
const hourly = (r: SimulationResult, id: string): Arr => {
  const a = (r.hourly as Partial<Record<string, Float32Array>>)[id];
  return a && a.length === r.meta.nDays * 24 ? a : undefined;
};
const fin = (x: number | undefined): x is number => x !== undefined && Number.isFinite(x);

function energyUnit(prefs: UnitPrefs) {
  return convertUnit('inEnergy', 'kcal/d', prefs);
}

function massUnit(prefs: UnitPrefs) {
  return convertUnit('fatMass', 'kg', prefs);
}

/** A series' value at the moment, formatted in the user's units (hourly value when the chart reads hours). */
function seriesDriver(src: ExplainSources, id: string, m: Moment): ExplainDriver | null {
  const def = seriesDefOf(id);
  if (!def) return null;
  const dm = toDisplayMetric(def, src.prefs);
  const h = m.hour != null ? hourly(src.result, id) : undefined;
  let raw = h && m.hour != null ? h[m.hour] : daily(src.result, id)?.[m.day];
  if (!fin(raw)) return null;
  if (h && def.agg === 'sum') raw *= 24; // hourly slice of a daily sum → per-day rate, as the lanes show it
  let v = raw * dm.factor;
  if (dm.presentation === 'deltaFromBaseline') {
    const base = (src.result.initial as Partial<Record<string, number>>)[id] ?? daily(src.result, id)?.[0];
    if (!fin(base)) return null;
    v = def.unit === 'rel' ? (base !== 0 ? 100 * (raw / base - 1) : NaN) : (raw - base) * dm.factor;
  }
  if (!Number.isFinite(v)) return null;
  const unit = dm.unit;
  const label = LABELS[id] ?? dm.shortLabel;
  return { label, value: dm.presentation === 'deltaFromBaseline' ? formatSigned(v, dm.decimals) : formatNumber(v, dm.decimals), unit };
}

/**
 * Driver labels where the short readout name would be cryptic in a sentence. Keto-adaptation has none: its name comes
 * from the engine catalogue (via `toDisplayMetric`), whatever component or index the engine ships.
 */
const LABELS: Record<string, string> = {
  liverGlycogen: 'liver glycogen',
  inSleep: 'sleep',
  inProtein: 'protein eaten',
  inEnergy: 'energy eaten',
  dietFatigue: 'diet fatigue',
  rmr: 'resting rate',
  neat: 'everyday movement',
  exerciseEE: 'exercise',
  tef: 'digestion',
  metabolicAdaptation: 'adaptation',
  mtorIdx: 'mTOR activity',
  ampkIdx: 'AMPK activity',
  tdee: 'energy expenditure',
};

function fastAt(src: ExplainSources, m: Moment): ExplainDriver | null {
  const spans = src.compiled?.fastSpans;
  if (!spans) {
    // without the compiled schedule: a day with (almost) no intake is a fast day
    const e = daily(src.result, 'inEnergy')?.[m.day];
    return fin(e) ? { label: 'fast', value: e < 50 ? 'yes' : 'no' } : null;
  }
  const lo = m.hour ?? m.day * 24;
  const hi = m.hour != null ? m.hour + 1 : m.day * 24 + 24;
  const span = spans.find((s) => s.startHour < hi && s.endHour > lo);
  if (!span) return { label: 'fast', value: 'no' };
  const total = span.mealToMealH ?? span.endHour - span.startHour;
  const note =
    m.hour != null
      ? `hour ${Math.max(1, Math.round(m.hour - span.startHour + 1))} of a ${formatNumber(total, 0)}\u2009h fast`
      : `a ${formatNumber(total, 0)}\u2009h fast`;
  return { label: 'fast', value: 'yes', note: `· ${note}` };
}

function carbsAt(src: ExplainSources, m: Moment): ExplainDriver | null {
  const meals = src.data.intake?.meals;
  if (m.hour != null && meals) {
    let g = 0;
    for (const x of meals) {
      const at = x.day * 24 + x.startHour;
      if (at <= m.hour + 1 && at > m.hour + 1 - 24) g += x.grams.netCarbs;
    }
    return { label: 'net carbohydrate, last 24 h', value: formatNumber(g, 0), unit: 'g' };
  }
  const c = daily(src.result, 'inCarbs')?.[m.day];
  return fin(c) ? { label: 'net carbohydrate this day', value: formatNumber(c, 0), unit: 'g' } : null;
}

function sinceMealAt(src: ExplainSources, m: Moment): ExplainDriver | null {
  if (m.hour != null) {
    const h = hourly(src.result, 'hoursFasted')?.[m.hour];
    return fin(h) ? { label: 'hours since the last intake', value: formatNumber(h, 0), unit: 'h' } : null;
  }
  const h = daily(src.result, 'hoursFasted')?.[m.day];
  return fin(h) ? { label: 'longest gap without food this day', value: formatNumber(h, 0), unit: 'h' } : null;
}

function energyOn(src: ExplainSources, day: number): { eat: number; maint: number } | null {
  const e = daily(src.result, 'inEnergy')?.[day];
  const mt = daily(src.result, 'maintenance')?.[day];
  return fin(e) && fin(mt) && mt > 0 ? { eat: e, maint: mt } : null;
}

function balanceText(eat: number, maint: number, prefs: UnitPrefs): { value: string; unit: string; note: string } {
  const eu = energyUnit(prefs);
  const diff = (eat - maint) * eu.factor;
  const pct = (100 * eat) / maint;
  return { value: formatSigned(Math.round(diff / 10) * 10, 0), unit: eu.unit, note: `· ${formatNumber(pct, 0)}\u2009% of maintenance` };
}

function energyDay(src: ExplainSources, m: Moment): ExplainDriver | null {
  const x = energyOn(src, m.day);
  if (!x) return null;
  return { label: 'energy vs maintenance this day', ...balanceText(x.eat, x.maint, src.prefs) };
}

function energyWeek(src: ExplainSources, m: Moment): ExplainDriver | null {
  let eat = 0;
  let maint = 0;
  let n = 0;
  for (let d = Math.max(0, m.day - 6); d <= m.day; d++) {
    const x = energyOn(src, d);
    if (!x) continue;
    eat += x.eat;
    maint += x.maint;
    n++;
  }
  if (!n) return null;
  return { label: `energy vs maintenance, ${n === 7 ? '7-day' : `${n}-day`} average`, ...balanceText(eat / n, maint / n, src.prefs) };
}

function proteinPerKg(src: ExplainSources, m: Moment): ExplainDriver | null {
  const p = daily(src.result, 'inProtein')?.[m.day];
  const w = daily(src.result, 'scaleWeight')?.[m.day];
  if (!fin(p) || !fin(w) || w <= 0) return null;
  return { label: 'protein eaten', value: formatNumber(p / w, 1), unit: 'g/kg', note: `· ${formatNumber(p, 0)}\u2009g` };
}

function proteinShare(src: ExplainSources, m: Moment): ExplainDriver | null {
  const p = daily(src.result, 'inProtein')?.[m.day];
  const e = daily(src.result, 'inEnergy')?.[m.day];
  if (!fin(p) || !fin(e) || e <= 50) return null;
  return { label: 'protein share of energy', value: formatNumber((400 * p) / e, 0), unit: '%' };
}

function rtSets7(src: ExplainSources, m: Moment): ExplainDriver | null {
  const a = daily(src.result, 'inRtSets');
  if (!a) return null;
  let s = 0;
  for (let d = Math.max(0, m.day - 6); d <= m.day; d++) s += fin(a[d]) ? a[d]! : 0;
  return { label: 'resistance sets, last 7 days', value: formatNumber(s, 0) };
}

function trainingDay(src: ExplainSources, m: Moment): ExplainDriver | null {
  const sets = daily(src.result, 'inRtSets')?.[m.day] ?? 0;
  const cardio = daily(src.result, 'inCardioMin')?.[m.day] ?? 0;
  const parts: string[] = [];
  if (sets > 0) parts.push(`lifting, ${formatNumber(sets, 0)} sets`);
  if (cardio > 0) parts.push(`cardio, ${formatNumber(cardio, 0)} min`);
  return { label: 'training this day', value: parts.length ? parts.join(' · ') : 'none' };
}

function fatChange(src: ExplainSources, m: Moment): ExplainDriver | null {
  const f = daily(src.result, 'fatMass');
  const base = (src.result.initial as Partial<Record<string, number>>).fatMass ?? f?.[0];
  const v = f?.[m.day];
  if (!fin(v) || !fin(base)) return null;
  const mu = massUnit(src.prefs);
  return { label: 'fat mass since the start', value: formatSigned((v - base) * mu.factor, 1), unit: mu.unit };
}

/** Scale weight = fat + lean tissue + glycogen with its water + fluid shift + gut contents (MODEL_SPEC §1.10). */
function decomposition(src: ExplainSources, m: Moment): ExplainDriver[] {
  const r = src.result;
  const init = r.initial as Partial<Record<string, number>>;
  const mu = massUnit(src.prefs);
  const out: ExplainDriver[] = [];
  const part = (label: string, id: string, base: number | undefined) => {
    const a = daily(r, id);
    const v = a?.[m.day];
    const b = base ?? a?.[0];
    if (!fin(v) || !fin(b)) return;
    out.push({ label, value: formatSigned((v - b) * mu.factor, 1), unit: mu.unit });
  };
  part('fat', 'fatMass', init.fatMass);
  part('lean tissue', 'leanTissue', init.leanTissue);
  part('glycogen and its water', 'glycogenWater', 0);
  part('fluid shift (salt, carbohydrate)', 'ecfShift', 0);
  part('gut contents', 'gutContent', 0);
  return out;
}

const DERIVED: Record<string, (src: ExplainSources, m: Moment) => ExplainDriver | ExplainDriver[] | null> = {
  '@carbs': carbsAt,
  '@sinceMeal': sinceMealAt,
  '@fast': fastAt,
  '@energy': energyDay,
  '@energy7': energyWeek,
  '@proteinPerKg': proteinPerKg,
  '@proteinShare': proteinShare,
  '@rtSets7': rtSets7,
  '@training': trainingDay,
  '@fatChange': fatChange,
  '@decomp': decomposition,
};

/** "What is driving it here" for a metric at the cursor (end of the projection without one). Empty when unknown. */
export function explainDrivers(src: ExplainSources, id: string, cursor: ExplainCursor): ExplainDriver[] {
  const keys = EXPLAIN_DRIVERS[id];
  const days = src.result.meta.nDays;
  if (!keys || days < 1) return [];
  const m = cursor.t == null ? { day: days - 1, hour: null } : momentOf(cursor.t, cursor.res, days);
  const out: ExplainDriver[] = [];
  for (const k of keys) {
    try {
      const got = k.startsWith('@') ? (DERIVED[k]?.(src, m) ?? null) : seriesDriver(src, k, m);
      if (Array.isArray(got)) out.push(...got);
      else if (got) out.push(got);
    } catch {
      // a driver that cannot be read is left out; the rest still explain the value
    }
  }
  return out;
}
