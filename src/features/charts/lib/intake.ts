/* ==========================================================================
   Intake derivations: kcal per macro (Atwater), totals, energy balance, and
   the same in the display energy unit (kcal or kJ).
   ========================================================================== */
import { toEnergyUnit, type EnergyUnitChoice } from '@/components';
import { KCAL_PER_GRAM, MACRO_ORDER } from '../catalogue';
import type { IntakeContext, MacroSeries } from '../types';

export interface IntakeKcal {
  byMacro: MacroSeries;
  /** Energy total excluding fibre unless `withFibre` (CHART_SPEC §4.4: fibre only in detail mode). */
  total: Float32Array;
  totalWithFibre: Float32Array;
}

const cache = new WeakMap<IntakeContext, IntakeKcal>();

export function intakeKcal(intake: IntakeContext): IntakeKcal {
  const hit = cache.get(intake);
  if (hit) return hit;
  const n = intake.maintenance.length;
  const byMacro = {} as MacroSeries;
  for (const k of MACRO_ORDER) {
    const given = intake.kcal?.[k];
    if (given) byMacro[k] = given;
    else {
      const g = intake.grams[k];
      const a = new Float32Array(n);
      for (let i = 0; i < n; i++) a[i] = (g[i] ?? 0) * KCAL_PER_GRAM[k];
      byMacro[k] = a;
    }
  }
  const total = new Float32Array(n);
  const totalWithFibre = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let t = 0;
    for (const k of MACRO_ORDER) if (k !== 'fibre') t += byMacro[k][i]!;
    total[i] = t;
    totalWithFibre[i] = t + byMacro.fibre[i]!;
  }
  const out = { byMacro, total, totalWithFibre };
  cache.set(intake, out);
  return out;
}

/** Energy balance per day (intake − maintenance), kcal. */
export function energyBalance(intake: IntakeContext): Float32Array {
  const { total } = intakeKcal(intake);
  const out = new Float32Array(total.length);
  for (let i = 0; i < total.length; i++) out[i] = total[i]! - intake.maintenance[i]!;
  return out;
}

/** Intake, maintenance and balance in the display energy unit (Settings › energy: kcal or kJ). */
export interface IntakeEnergy extends IntakeKcal {
  unit: EnergyUnitChoice;
  maintenance: Float32Array;
  /** Intake − maintenance per day. */
  balance: Float32Array;
}

const energyCache = new WeakMap<IntakeContext, Partial<Record<EnergyUnitChoice, IntakeEnergy>>>();

const scaled = (a: Float32Array, f: number): Float32Array => {
  if (f === 1) return a;
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i]! * f;
  return out;
};

/**
 * The intake context's energy in the display unit. The chart data stays in kcal (the engine unit; grams convert with
 * Atwater factors); lanes, readouts and the table convert through here so every intake/energy number follows the unit.
 */
export function intakeEnergy(intake: IntakeContext, unit: EnergyUnitChoice = 'kcal'): IntakeEnergy {
  let byUnit = energyCache.get(intake);
  const hit = byUnit?.[unit];
  if (hit) return hit;
  const kc = intakeKcal(intake);
  const f = toEnergyUnit(1, unit);
  const byMacro = {} as MacroSeries;
  for (const k of MACRO_ORDER) byMacro[k] = scaled(kc.byMacro[k], f);
  const out: IntakeEnergy = {
    unit,
    byMacro,
    total: scaled(kc.total, f),
    totalWithFibre: scaled(kc.totalWithFibre, f),
    maintenance: scaled(intake.maintenance, f),
    balance: scaled(energyBalance(intake), f),
  };
  if (!byUnit) {
    byUnit = {};
    energyCache.set(intake, byUnit);
  }
  byUnit[unit] = out;
  return out;
}

/** Energy unit of a display unit string: "kJ/d" / "kJ" → kJ, anything else → kcal. */
export function energyUnitOf(displayUnit: string): EnergyUnitChoice {
  return /^kJ\b/.test(displayUnit) ? 'kJ' : 'kcal';
}

/** Tone step for a % of maintenance (tokens §8: 1 = 1–10 %, 2 = 10–20 %, 3 = 20–35 %, 4 = > 35 %). */
export function energyStep(fractionOfMaintenance: number): { side: 'deficit' | 'surplus' | 'neutral' | 'fast'; step: 0 | 1 | 2 | 3 | 4 } {
  if (!Number.isFinite(fractionOfMaintenance)) return { side: 'neutral', step: 0 };
  if (fractionOfMaintenance <= 0.02) return { side: 'fast', step: 4 };
  const d = Math.abs(1 - fractionOfMaintenance);
  const side = fractionOfMaintenance < 1 ? 'deficit' : 'surplus';
  if (d < 0.01) return { side: 'neutral', step: 0 };
  if (d <= 0.1) return { side, step: 1 };
  if (d <= 0.2) return { side, step: 2 };
  if (d <= 0.35) return { side, step: 3 };
  return { side, step: 4 };
}

