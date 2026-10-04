/**
 * "Explain this curve" context for the results screen (QA 11): the metric's value where the reader is looking (the
 * crosshair, the pinned sample, or the end of the projection) with its unit and likely range, and "what is driving it
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
import { convertUnit, seriesDefOf, toDisplayMetric, type UnitPrefs } from './metrics';

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
