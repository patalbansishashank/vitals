/**
 * Energy encoding for the raster and the program keys.
 *
 * REVIEW_FINDINGS #4: the fill is stepped every 5 % of maintenance so 85 / 80 / 75 % stay distinguishable in both
 * themes. Deficit steps run to −12 (≤ 40 %), surplus steps to +8 (≥ 140 %). The colours are mixed in OKLab between
 * the neutral well and a deeper end-of-ramp tone defined per theme in simulator.css (`--sim-deficit-end`,
 * `--sim-surplus-end`), so every step is a near-equal perceptual increment. Water-only days have their own treatment.
 */
import { formatNumber, toEnergyUnit, type EnergyUnitChoice } from '@/components';
import type { EnergySpec } from '@/engine';

export const DEFICIT_STEPS = 12;
export const SURPLUS_STEPS = 8;

/** Signed 5 % step: −12 … +8; 0 = within ±2.5 % of maintenance. */
export function energyStep(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  const s = Math.round((pct - 100) / 5);
  return Math.max(-DEFICIT_STEPS, Math.min(SURPLUS_STEPS, s));
}

/**
 * Mix share (0..100) of the end tone for a step. Deficit: 10 % per 5 % step down to 50 % of maintenance (≈ 2.6
 * ΔE_OK×100 between neighbours in both themes; 40–50 % share the end tone and are labelled danger anyway).
 * Surplus: 12.5 % per step to 140 %.
 */
export function stepMix(step: number): number {
  if (step === 0) return 0;
  if (step < 0) return Math.min(100, -step * 10);
  return Math.min(100, Math.round(step * 12.5));
}

/** CSS background for an energy step (tokens only). */
export function energyFill(step: number): string {
  if (step === 0) return 'var(--lm-energy-neutral)';
  const end = step < 0 ? 'var(--sim-deficit-end)' : 'var(--sim-surplus-end)';
  return `color-mix(in oklab, ${end} ${stepMix(step)}%, var(--lm-energy-neutral))`;
}

/** Percent of maintenance a spec asks for, given the (baseline) maintenance. NaN for fasts. */
export function specPct(e: EnergySpec, maintenanceKcal: number): number {
  if (e.kind === 'zero') return 0;
  if (e.kind === 'pctMaintenance') return e.pct;
  return maintenanceKcal > 0 ? (100 * e.kcal) / maintenanceKcal : Number.NaN;
}

/** Target kcal of a spec at a given maintenance. */
export function specKcal(e: EnergySpec, maintenanceKcal: number): number {
  if (e.kind === 'zero') return 0;
  if (e.kind === 'kcal') return e.kcal;
  return (e.pct / 100) * maintenanceKcal;
}

/** Round kcal the way the UI shows it (10 kcal). */
export const roundKcal = (k: number): number => Math.round(k / 10) * 10;

/** Scale zones for the EnergyScale (40–140 %): coarse deficit/surplus tones, a caution band below half of maintenance
 *  and a danger band where the day falls under 800 kcal (COMPONENTS §3 EnergyScale). */
export type EnergyZoneTone =
  | 'deficit-1'
  | 'deficit-2'
  | 'deficit-3'
  | 'deficit-4'
  | 'surplus-1'
  | 'surplus-2'
  | 'surplus-3'
  | 'surplus-4'
  | 'caution'
  | 'danger';
export function energyZones(
  maintenanceKcal: number,
  unit: EnergyUnitChoice = 'kcal',
): Array<{ from: number; to: number; tone: EnergyZoneTone; label?: string }> {
  const dangerTo = maintenanceKcal > 0 ? Math.max(40, Math.min(65, (800 / maintenanceKcal) * 100)) : 40;
  const zones: Array<{ from: number; to: number; tone: EnergyZoneTone; label?: string }> = [];
  if (dangerTo > 40)
    zones.push({
      from: 40,
      to: dangerTo,
      tone: 'danger',
      label: `under ${formatKcal(800, unit)} ${unit} a day: medical supervision only`,
    });
  if (dangerTo < 50)
    zones.push({ from: dangerTo, to: 50, tone: 'caution', label: 'below half of maintenance' });
  zones.push(
    { from: Math.max(50, dangerTo), to: 65, tone: 'deficit-4' },
    { from: 65, to: 80, tone: 'deficit-3' },
    { from: 80, to: 90, tone: 'deficit-2' },
    { from: 90, to: 97.5, tone: 'deficit-1' },
    { from: 102.5, to: 110, tone: 'surplus-1' },
    { from: 110, to: 120, tone: 'surplus-2' },
    { from: 120, to: 130, tone: 'surplus-3' },
    { from: 130, to: 140, tone: 'surplus-4' },
  );
  return zones.filter((z) => z.to > z.from);
}

/* ------------------------------------------------------------------------------------------ true balance (R-MAINT) */

/** Within this band of the maintenance reference a block reads as "maintenance" (tokens §8: ±3 %). */
const MAINT_BAND_PCT = 3;

export type BalanceKind = 'deficit' | 'maintenance' | 'surplus' | 'fast';

/** What a mean energy (% of the day's maintenance reference) is, in plain words. */
export function balanceKind(pct: number): BalanceKind {
  if (!Number.isFinite(pct)) return 'maintenance';
  if (pct <= 2) return 'fast';
  if (pct < 100 - MAINT_BAND_PCT) return 'deficit';
  if (pct <= 100 + MAINT_BAND_PCT) return 'maintenance';
  return 'surplus';
}

/**
 * Honest label of a block by its true planned balance (ruling R-MAINT: against maintenance at the activity the
 * schedule prescribes): "deficit 18 %", "surplus 6 %", "maintenance", "water-only". With `kcal`, the mean daily
 * difference is added: "deficit 18 % · −480 kcal".
 */
export function balanceLabel(pct: number, kcal?: number, unit: EnergyUnitChoice = 'kcal'): string {
  const kind = balanceKind(pct);
  if (kind === 'fast') return 'water-only';
  if (kind === 'maintenance') return 'maintenance';
  // the engine's rounding (planner scorecards and phase names): round the percent, then take the difference
  const off = Math.abs(100 - Math.round(pct));
  const k = kcal !== undefined && Number.isFinite(kcal) ? ` · ${kcal < 0 ? '\u2212' : '+'}${formatKcal(Math.abs(kcal), unit)}\u2009${unit}` : '';
  return `${kind} ${off}\u2009%${k}`;
}

/**
 * Thousands with a thin space, rounded to 10 of the display unit ("2 840" kcal, "11 880" kJ). Stored values are kcal;
 * `unit` is the Settings energy unit.
 */
export function formatKcal(k: number, unit: EnergyUnitChoice = 'kcal'): string {
  return formatNumber(Math.round(toEnergyUnit(k, unit) / 10) * 10, 0);
}

/**
 * The maintenance reference of a compiled day (ruling R-MAINT: habitual maintenance adjusted to the schedule's planned
 * activity), falling back to the habitual maintenance when the compiler does not provide one.
 */
export function dayMaintenance(d: { maintenanceKcal?: number }, habitualKcal: number): number {
  const m = d.maintenanceKcal;
  return m !== undefined && Number.isFinite(m) && m > 0 ? m : habitualKcal;
}
