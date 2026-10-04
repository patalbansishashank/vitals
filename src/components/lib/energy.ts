/**
 * Energy display in the user's unit (Settings › Units › energy: kcal or kJ). Stored and engine values are always kcal;
 * only display and entry convert. kJ values are rounded to the nearest 10 kJ by default (same visual precision as
 * whole kcal at typical magnitudes), with the same thin-space grouping and U+2212 minus as `formatNumber`.
 */
import { formatNumber, formatSigned, type FormatOptions } from './format';

export type EnergyUnitChoice = 'kcal' | 'kJ';

/** Thermochemical calorie. */
export const KJ_PER_KCAL = 4.184;

/** kcal → the display unit. */
export function toEnergyUnit(kcal: number, unit: EnergyUnitChoice): number {
  return unit === 'kJ' ? kcal * KJ_PER_KCAL : kcal;
}

/** Display unit → kcal (entry). */
export function fromEnergyUnit(v: number, unit: EnergyUnitChoice): number {
  return unit === 'kJ' ? v / KJ_PER_KCAL : v;
}

/** Per-day unit label: "kcal/d" or "kJ/d". */
export function energyPerDayUnit(unit: EnergyUnitChoice): string {
  return unit === 'kJ' ? 'kJ/d' : 'kcal/d';
}

/** Spoken unit for screen readers. */
export function energyUnitSpoken(unit: EnergyUnitChoice): string {
  return unit === 'kJ' ? 'kilojoules' : 'kilocalories';
}

export interface EnergyFormatOptions extends FormatOptions {
  /** Round to this step in the display unit (default: 1 kcal / 10 kJ; pass 10 for the "2 840 kcal" style). */
  step?: number;
  /** Append the unit after a thin space (default true). */
  withUnit?: boolean;
  /** Signed output ("+120 kcal", "−480 kJ"). */
  signed?: boolean;
}

/** "2 840 kcal" / "11 880 kJ". */
export function formatEnergy(kcal: number, unit: EnergyUnitChoice, opts: EnergyFormatOptions = {}): string {
  const step = opts.step ?? (unit === 'kJ' ? 10 : 1);
  const v = toEnergyUnit(kcal, unit);
  const r = step > 0 ? Math.round(v / step) * step : v;
  const body = opts.signed ? formatSigned(r, 0, opts) : formatNumber(r, 0, opts);
  return opts.withUnit === false ? body : `${body}\u2009${unit}`;
}

/**
 * Engine-written text (warning messages, rule titles, planner phase names) states energy in kcal. In kJ mode, rewrite
 * each "<number> kcal" (also "600-kcal", "kcal/day", "kcal/kg FFM") into kJ with the same grouping; kcal mode returns
 * the text unchanged. Numbers ≥ 1 000 kJ are rounded to 10 kJ, smaller ones to whole kJ.
 */
export function energyInText(text: string, unit: EnergyUnitChoice): string {
  if (unit !== 'kJ' || !text.includes('kcal')) return text;
  // "… 29 kcal/kg lean mass/day, below the ~30 level …": the bare threshold is in the same unit as the figure
  const perKg = /kcal\/kg/.test(text);
  // densities "8 g per 1000 kcal" read per 1000 kJ ("1.9 g per 1000 kJ"), not "per 4 180 kJ"
  const perK = (g: string) => formatNumber(Number(g) / KJ_PER_KCAL, 1);
  let dens = text.replace(
    /(\d+(?:\.\d+)?)(\+?) g per 1[\u2009\u202f\u00a0 ,]?000 kcal/g,
    (_m, g: string, plus: string) => `${perK(g)}${plus} g per 1000 kJ`,
  );
  // a bare target after such a density is in the same unit: "(target 14+)"
  if (dens !== text) dens = dens.replace(/\(target (\d+(?:\.\d+)?)(\+?)\)/g, (_m, g: string, plus: string) => `(target ${perK(g)}${plus})`);
  const out = dens.replace(
    /([\u2212-]?)(\d{1,3}(?:[\u2009\u202f\u00a0 ,]\d{3})+|\d+(?:\.\d+)?)([\u2009\u202f ]?|-)kcal/g,
    (_m, sign: string, num: string, sep: string) => {
      const v = Number(num.replace(/[\u2009\u202f\u00a0 ,]/g, '')) * KJ_PER_KCAL;
      const r = v >= 1000 ? Math.round(v / 10) * 10 : Math.round(v);
      return `${sign}${formatNumber(r, 0)}${sep}kJ`;
    },
  );
  return perKg ? out.replace(/~(\d+(?:\.\d+)?) level/g, (_m, n: string) => `~${Math.round(Number(n) * KJ_PER_KCAL)} level`) : out;
}
