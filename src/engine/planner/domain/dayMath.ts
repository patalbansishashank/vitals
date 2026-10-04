/**
 * Static estimate of a planned day's energy and grams at baseline references (maintenance = TDEE0, body weight and
 * FFM at t = 0), mirroring the engine's resolution order (MODEL_SPEC §5.2: energy → fibre → alcohol → explicit macros
 * → remainder). Used by the decoder, repair, descriptors and explanations for input-space checks; the engine's
 * runtime resolution (blockStart maintenance) remains authoritative and is checked by the state-space margins.
 * The independent validator (validate.ts) deliberately does NOT use this file (18 §4.4.6 layer 3).
 */
import type { DayTemplate, MacroAmount } from '../../types/schedule';

export interface DayRefs {
  maintenanceKcal: number;
  bwKg: number;
  ffmKg: number;
}

export interface DayEstimate {
  kcal: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  fibreG: number;
  /** % of maintenance (NaN for zero days). */
  pct: number;
  zero: boolean;
  /** Macros exceeded the energy (engine would realise their sum). */
  exceeds: boolean;
}

const ATW = { protein: 4, carb: 4, fat: 9, fibre: 2 } as const;
/** 15 §1.1 default fibre, g per 1000 kcal (core/defaults DEFAULTS.fibreGPer1000Kcal). */
const DEFAULT_FIBRE_PER_1000 = 8;

function grams(m: MacroAmount | { unit: 'gPer1000Kcal'; value: number }, kcalPerG: number, E: number, r: DayRefs): number {
  switch (m.unit) {
    case 'g':
      return m.value;
    case 'gPerKgBw':
      return m.value * r.bwKg;
    case 'gPerKgFfm':
      return m.value * r.ffmKg;
    case 'pctEnergy':
      return ((m.value / 100) * E) / kcalPerG;
    case 'gPer1000Kcal':
      return (m.value * E) / 1000;
    default:
      return NaN;
  }
}

export function estimateDay(t: Pick<DayTemplate, 'energy' | 'macros'>, r: DayRefs): DayEstimate {
  const e = t.energy;
  const E = e.kind === 'zero' ? 0 : e.kind === 'kcal' ? e.kcal : (e.pct / 100) * r.maintenanceKcal;
  if (E <= 0) return { kcal: 0, proteinG: 0, carbG: 0, fatG: 0, fibreG: 0, pct: 0, zero: true, exceeds: false };
  const m = t.macros;
  let fibre = m.fibre ? grams(m.fibre, ATW.fibre, E, r) : (DEFAULT_FIBRE_PER_1000 * E) / 1000;
  if (!Number.isFinite(fibre)) fibre = (DEFAULT_FIBRE_PER_1000 * E) / 1000;
  let p = grams(m.protein, ATW.protein, E, r);
  let c = grams(m.carbs, ATW.carb, E, r);
  let f = grams(m.fat, ATW.fat, E, r);
  const fixed = (Number.isFinite(p) ? 4 * p : 0) + (Number.isFinite(c) ? 4 * c : 0) + (Number.isFinite(f) ? 9 * f : 0) + 2 * fibre;
  let rest = E - fixed;
  const exceeds = rest < -0.5;
  if (rest < 0) rest = 0;
  if (!Number.isFinite(f)) {
    if (!Number.isFinite(p)) p = 0;
    if (!Number.isFinite(c)) c = 0;
    f = rest / 9;
  } else if (!Number.isFinite(c)) {
    if (!Number.isFinite(p)) p = 0;
    c = rest / 4;
  } else if (!Number.isFinite(p)) {
    p = rest / 4;
  }
  const kcal = 4 * p + 4 * c + 9 * f + 2 * fibre;
  return { kcal, proteinG: p, carbG: c, fatG: f, fibreG: fibre, pct: (100 * kcal) / r.maintenanceKcal, zero: false, exceeds };
}

/** Merge a day override into its template (same semantics as core/compileSchedule.mergeTemplate). */
export function mergeDay(base: DayTemplate, ov: Partial<Omit<DayTemplate, 'id' | 'label'>> | undefined): DayTemplate {
  if (!ov) return base;
  return {
    ...base,
    ...ov,
    macros: ov.macros ? { ...base.macros, ...ov.macros } : base.macros,
    food: ov.food ? { ...base.food, ...ov.food } : base.food,
    meals: ov.meals ? { ...base.meals, ...ov.meals } : base.meals,
    hydration: ov.hydration ? { ...base.hydration, ...ov.hydration } : base.hydration,
    substances: ov.substances ? { ...base.substances, ...ov.substances } : base.substances,
    modifiers: ov.modifiers ? { ...base.modifiers, ...ov.modifiers } : base.modifiers,
    sleep: ov.sleep ? { ...base.sleep, ...ov.sleep } : base.sleep,
  } as DayTemplate;
}

/** Clock hours of a day's planned meals (explicit meals win; else evenly over the window, MODEL_SPEC §5.2.4). */
export function mealClocks(t: DayTemplate): number[] {
  const mp = t.meals ?? {};
  if (mp.meals && mp.meals.length) return mp.meals.map((m) => m.clockH);
  const n = Math.max(1, Math.round(mp.count ?? 3));
  const s = mp.window?.startH ?? 8;
  const L = mp.window?.lengthH ?? 12;
  return Array.from({ length: n }, (_, i) => (n === 1 ? s : s + (L * i) / (n - 1)));
}
