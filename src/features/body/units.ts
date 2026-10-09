/**
 * Display units for Your body. Everything is STORED in SI/engine units (kg, cm, kcal, mmol/L); these helpers only
 * convert for display and entry, so switching metric ↔ imperial never changes a stored value.
 */
import { CM_PER_IN, cmToIn, inToCm, kgToLb } from '@/lib/units';
import type { EnergyUnit, GlucoseUnit, UnitSystem } from '@/state/settingsStore';

export const KJ_PER_KCAL = 4.184;

/** Round to a step (0.5 in, 0.1 lb …) without binary noise: roundTo(70.26, 0.5) = 70.5. */
export function roundTo(v: number, step: number): number {
  const r = Math.round(v / step) * step;
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  return Number(r.toFixed(decimals));
}

export type MeasureQuantity = 'mass' | 'length' | 'height';

/** Value as the user sees it (same rounding as MeasureStepper: kg/lb 0.1, cm 1 (height) / 0.1, in whole (height) / 0.01). */
export function displayMeasure(q: MeasureQuantity, sys: UnitSystem, metric: number): number {
  if (q === 'mass') return roundTo(sys === 'metric' ? metric : kgToLb(metric), 0.1);
  if (q === 'height') return sys === 'metric' ? roundTo(metric, 1) : Math.round(cmToIn(metric));
  return sys === 'metric' ? roundTo(metric, 0.1) : roundTo(cmToIn(metric), 0.01);
}

/**
 * Drift guard: an entry that shows the same number as the stored value is not a change. Re-committing "187.2 lb" must
 * not turn a stored 84.9 kg into 84.912 kg.
 */
export function sameDisplayed(q: MeasureQuantity, sys: UnitSystem, a: number | null, b: number): boolean {
  return a !== null && displayMeasure(q, sys, a) === displayMeasure(q, sys, b);
}

/** Length scale in the user's units: cm, or inches at 0.5 in resolution (your-body.md §8 "Imperial"). */
export const lengthScale = (sys: UnitSystem) =>
  sys === 'metric'
    ? { unit: 'cm', step: 0.5, toDisplay: (cm: number) => cm, toMetric: (v: number) => v }
    : { unit: 'in', step: 0.5, toDisplay: (cm: number) => roundTo(cmToIn(cm), 0.5), toMetric: (v: number) => inToCm(v) };

/** Waist scale range, 55–160 cm or 22–63 in (your-body.md §6). */
export const waistRange = (sys: UnitSystem): [number, number] => (sys === 'metric' ? [55, 160] : [22, 63]);

export function formatLength(cm: number, sys: UnitSystem, decimals = 1): string {
  return sys === 'metric' ? `${cm.toFixed(decimals)}\u202Fcm` : `${(cm / CM_PER_IN).toFixed(decimals)}\u202Fin`;
}

export function formatMass(kg: number, sys: UnitSystem, decimals = 1): { value: number; unit: 'kg' | 'lb' } {
  return sys === 'metric' ? { value: roundTo(kg, 10 ** -decimals), unit: 'kg' } : { value: roundTo(kgToLb(kg), 10 ** -decimals), unit: 'lb' };
}

export function energyIn(kcal: number, unit: EnergyUnit): number {
  return unit === 'kJ' ? kcal * KJ_PER_KCAL : kcal;
}
/** The maintenance total as shown everywhere (Estimates, Maintenance card, spoken line): to the nearest 10, rounded once. */
export function maintenanceShown(kcal: number, unit: EnergyUnit): number {
  return Math.round(energyIn(kcal, unit) / 10) * 10;
}
export function energyToKcal(v: number, unit: EnergyUnit): number {
  return unit === 'kJ' ? v / KJ_PER_KCAL : v;
}

/* ---------------------------------------------------------------------------------------------- lab units */

/**
 * mg/dL per mmol/L: glucose 18.016 (M 180.16 g/mol), cholesterol (LDL, HDL) 38.67 (M 386.7), triglycerides 88.57
 * (as triolein, M 885.7). ApoB: mg/dL = g/L × 100.
 */
export const MGDL_PER_MMOL = { glucose: 18.016, cholesterol: 38.67, triglyceride: 88.57 } as const;

export type LabConversion = 'glucose' | 'cholesterol' | 'triglyceride' | 'apoB' | 'energy' | 'none';

export function labUnit(conv: LabConversion, engineUnit: string, glucose: GlucoseUnit, energy: EnergyUnit): string {
  if (conv === 'energy') return energy === 'kJ' ? 'kJ/day' : 'kcal/day';
  if (glucose === 'mgdl' && conv !== 'none') return 'mg/dL';
  return engineUnit;
}

export function labToDisplay(conv: LabConversion, v: number, glucose: GlucoseUnit, energy: EnergyUnit): number {
  if (conv === 'energy') return energyIn(v, energy);
  if (glucose !== 'mgdl') return v;
  if (conv === 'apoB') return v * 100;
  if (conv === 'none') return v;
  return v * MGDL_PER_MMOL[conv];
}

export function labFromDisplay(conv: LabConversion, v: number, glucose: GlucoseUnit, energy: EnergyUnit): number {
  if (conv === 'energy') return energyToKcal(v, energy);
  if (glucose !== 'mgdl') return v;
  if (conv === 'apoB') return v / 100;
  if (conv === 'none') return v;
  return v / MGDL_PER_MMOL[conv];
}
