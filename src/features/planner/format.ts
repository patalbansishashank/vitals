/**
 * Planner number formatting in the Vitals voice (DESIGN_DIRECTION §3.1): true minus, thin-space thousands, units one
 * step smaller. Masses and lengths follow Settings › Units (kg/lb, cm/in), energy follows Settings › Units › energy
 * (kcal/kJ); everything else stays in metric units.
 */
import { energyPerDayUnit, formatEnergy, formatNumber, formatRange, formatSigned, toEnergyUnit } from '@/components';
import type { EnergyUnit, UnitSystem } from '@/state/settingsStore';
import { goalMetric } from './catalogue';

const LB_PER_KG = 2.2046226218;
const IN_PER_CM = 1 / 2.54;

export interface Shown {
  value: number;
  unit: string;
  decimals: number;
}

/** A metric value in the user's unit system (value, display unit, decimals); energy metrics (kcal/d) in `energy`. */
export function toDisplay(metricId: string, value: number, units: UnitSystem, energy: EnergyUnit = 'kcal'): Shown {
  const m = goalMetric(metricId);
  const unit = m?.unit ?? '';
  if (unit === 'kg') return units === 'imperial' ? { value: value * LB_PER_KG, unit: 'lb', decimals: 1 } : { value, unit: 'kg', decimals: 1 };
  if (unit === 'cm') return units === 'imperial' ? { value: value * IN_PER_CM, unit: 'in', decimals: 1 } : { value, unit: 'cm', decimals: 1 };
  if (unit === 'mmol/L' || unit === 'g/L' || unit === 'rel') return { value, unit, decimals: 2 };
  if (unit === 'kcal/d') return { value: toEnergyUnit(value, energy), unit: energyPerDayUnit(energy), decimals: 0 };
  if (unit === 'g' || unit === 'g/d') return { value, unit, decimals: 0 };
  if (unit === 'index' || unit === 'score' || unit === 'mmHg') return { value, unit, decimals: 0 };
  return { value, unit, decimals: 1 };
}

export const displayUnit = (metricId: string, units: UnitSystem, energy: EnergyUnit = 'kcal'): string => toDisplay(metricId, 0, units, energy).unit;

/** "−10.4 kg" (signed) or "72.1 kg". */
export function fmtMetric(metricId: string, value: number, units: UnitSystem, opts: { signed?: boolean; unit?: boolean; energy?: EnergyUnit } = {}): string {
  const s = toDisplay(metricId, value, units, opts.energy);
  const n = opts.signed ? formatSigned(s.value, s.decimals) : formatNumber(s.value, s.decimals);
  return opts.unit === false || !s.unit ? n : `${n}\u2009${s.unit}`;
}

/** "9.1–11.0 kg" in display units (magnitudes of a signed range are ordered). */
export function fmtMetricRange(metricId: string, lo: number, hi: number, units: UnitSystem, energy: EnergyUnit = 'kcal'): string {
  const a = toDisplay(metricId, Math.min(lo, hi), units, energy);
  const b = toDisplay(metricId, Math.max(lo, hi), units, energy);
  return `${formatRange(a.value, b.value, a.decimals)}${a.unit ? `\u2009${a.unit}` : ''}`;
}

/** "−1.1 to −0.3 kg" / "0.1–0.6 kg": a range that keeps its signs (negative ends spelled with "to" so dashes never collide). */
export function fmtSignedRange(metricId: string, lo: number, hi: number, units: UnitSystem, energy: EnergyUnit = 'kcal'): string {
  const a = toDisplay(metricId, Math.min(lo, hi), units, energy);
  const b = toDisplay(metricId, Math.max(lo, hi), units, energy);
  const u = a.unit ? `\u2009${a.unit}` : '';
  if (a.value >= 0) return `${formatRange(a.value, b.value, a.decimals)}${u}`;
  // an end that rounds to zero reads "0.0", not "±0.0"
  const end = (v: number, d: number) => (Math.abs(v) < 0.5 * 10 ** -d ? formatNumber(0, d) : formatSigned(v, d));
  return `${end(a.value, a.decimals)} to ${end(b.value, b.decimals)}${u}`;
}

/** "2 300 kcal" / "9 620 kJ" in the Settings energy unit, to the nearest 10 of that unit. */
export function fmtKcal(kcal: number, energy: EnergyUnit = 'kcal'): string {
  return `${formatEnergy(kcal, energy, { step: 10, withUnit: false })}\u2009${energy}`;
}

/** Just the number of `fmtKcal` ("2 300"), for tables whose header names the unit. */
export function fmtKcalValue(kcal: number, energy: EnergyUnit = 'kcal'): string {
  return formatEnergy(kcal, energy, { step: 10, withUnit: false });
}

/** "−480 kcal" / "+120 kJ": a signed daily difference in the Settings energy unit. */
export function fmtKcalSigned(kcal: number, energy: EnergyUnit = 'kcal'): string {
  return `${formatEnergy(kcal, energy, { step: 10, withUnit: false, signed: true })}\u2009${energy}`;
}

/**
 * The planner's percentages ("62 %", "−4 %"): the engine's own rounding (`Math.round`, as in its option names, phase
 * names and explanation sentences), never clamped. The one formatter for scorecards, phase labels, tooltips, exports and
 * the run view, so the same engine number always prints the same string.
 */
export function fmtPct(pct: number): string {
  return `${fmtPctValue(pct)} %`;
}

/** The number of `fmtPct` without the sign ("78"), for columns whose header names the unit. */
export function fmtPctValue(pct: number): string {
  return formatNumber(Math.round(pct), 0);
}

export function fmtGrams(g: number): string {
  return `${formatNumber(g, 0)}\u2009g`;
}

/** "07:30" from a clock hour (wraps past 24). */
export function fmtClock(h: number): string {
  const x = ((h % 24) + 24) % 24;
  let hh = Math.floor(x);
  let mm = Math.round((x - hh) * 60);
  if (mm === 60) {
    hh = (hh + 1) % 24;
    mm = 0;
  }
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** "1 840" steps, "8.5 k" when compact. */
export function fmtSteps(n: number, compact = false): string {
  if (compact && n >= 1000) return `${formatNumber(n / 1000, n % 1000 === 0 ? 0 : 1)}\u2009k`;
  return formatNumber(Math.round(n / 10) * 10, 0);
}

export function fmtWeeks(days: number): string {
  const w = Math.round(days / 7);
  return `${w} week${w === 1 ? '' : 's'}`;
}

const DATE_FMT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const DATE_FMT_WD = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

function parseIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

/** Newer ICU data spells September "Sept" in en-GB; the design writes three-letter months everywhere. */
const month3 = (s: string) => s.replace(/\bSept\b/, 'Sep');
/** "5 Oct". */
export const fmtDate = (iso: string): string => month3(DATE_FMT.format(parseIso(iso)));
/** "Mon 5 Oct". */
export const fmtDateWd = (iso: string): string => month3(DATE_FMT_WD.format(parseIso(iso)).replace(',', ''));

/** Today's date in the user's time zone, ISO (toISOString would give the UTC date). */
export function todayISO(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/**
 * A change from the start value in the metric's reading: relative markers ('rel' units, change from your own
 * baseline) read as percent; everything else as a signed amount in display units.
 */
export function fmtChange(metricId: string, start: number, value: number, units: UnitSystem, energy: EnergyUnit = 'kcal'): string {
  const m = goalMetric(metricId);
  if (m?.unit === 'rel') {
    if (!Number.isFinite(start) || start === 0) return fmtMetric(metricId, value - start, units, { signed: true, energy });
    return `${formatSigned(((value - start) / Math.abs(start)) * 100, 0)}\u2009%`;
  }
  if (m?.unit === 'index' || m?.unit === 'score' || m?.unit === '% of baseline' || m?.unit === '%') {
    return `${formatSigned(value - start, 0)}\u2009${m.unit === 'index' || m.unit === 'score' ? 'pts' : m.unit === '%' ? '% pts' : '%'}`;
  }
  return fmtMetric(metricId, value - start, units, { signed: true, energy });
}
