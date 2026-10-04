/**
 * Small shared helpers for scenario `measure` functions (WP-V). Pure functions over `ArmView`.
 */
import { RHO } from '../../core/defaults';
import type { ArmView } from '../harness/view';

/** Hall-convention tissue energy densities used by the engine (MODEL_SPEC §0.2): kcal/kg fat and lean tissue, kcal/g glycogen. */
export const RHO_FAT = RHO.fat; // 9 441
export const RHO_LEAN = 1816;
export const RHO_GLYCOGEN = RHO.glycogenPerG; // 4.207

/** Fat lost after n days, kg (positive = loss). */
export function fatLossKg(v: ArmView, n: number): number {
  return v.initial('fatMass') - v.after('fatMass', n);
}

/** Scale-weight change after n days, kg (negative = loss). */
export function scaleDelta(v: ArmView, n: number): number {
  return v.after('scaleWeight', n) - v.profile.weightKg;
}

/** Energy stored in tissue and glycogen over the first n days, kcal (ρF·ΔFM + ρL·ΔLT + ρG·ΔG). */
export function storedEnergyKcal(v: ArmView, n: number): number {
  return (
    RHO_FAT * v.delta('fatMass', n) +
    RHO_LEAN * v.delta('leanTissue', n) +
    (v.has('glycogenTotal') ? RHO_GLYCOGEN * v.delta('glycogenTotal', n) : 0)
  );
}

/** Realised intake summed over days [from, to), kcal (the `inEnergy` input echo). */
export function intakeKcal(v: ArmView, from: number, to: number): number {
  return v.sum('inEnergy', from, to);
}

/** Mean expenditure (TDEE series) over days [from, to), kcal/d. */
export function meanTdee(v: ArmView, from: number, to: number): number {
  return v.mean('tdee', from, to);
}

/** Percent change of mean TDEE over [from, to) versus the baseline maintenance the engine derived (TDEE0). */
export function tdeePctVsBaseline(v: ArmView, from: number, to: number): number {
  return 100 * (v.mean('tdee', from, to) / v.profile.tdee0Kcal - 1);
}

/**
 * Non-protein respiratory quotient from carbohydrate and fat oxidation, g/d (Weir/Frayn coefficients:
 * O2 0.746 / 2.03 L per g, CO2 0.746 / 1.43 L per g). Approximation: ignores the protein term (~0.005 RQ).
 */
export function rqNonProtein(choOxG: number, fatOxG: number): number {
  const co2 = 0.746 * choOxG + 1.43 * fatOxG;
  const o2 = 0.746 * choOxG + 2.03 * fatOxG;
  return o2 > 0 ? co2 / o2 : Number.NaN;
}
