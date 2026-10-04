/**
 * Macro-split editor math (COMPONENTS §3 MacroSplit). Energy is held constant: moving one macro redistributes the
 * energy difference across the unlocked others in proportion to their current energy share; when they cannot absorb
 * it the moved macro is capped. Exactly one macro stays `remainder` so later energy edits keep the day consistent
 * (MODEL_SPEC §5.2: one `remainder`, resolution energy → fibre → alcohol → explicit macros → remainder).
 *
 * Units: g · g/kg body weight · g/kg lean mass · % energy (orchestrator ruling). Conversions use the day's energy and
 * the baseline body references, exactly like the compiler's static resolution.
 */
import type { MacroAmount, MacroSpec } from '@/engine';

export type MacroKey = 'protein' | 'carbs' | 'fat';
export const MACRO_KEYS: readonly MacroKey[] = ['protein', 'carbs', 'fat'];
/** Atwater factors of the engine convention (dossier 15 §4.2). */
export const KCAL_PER_G: Readonly<Record<MacroKey, number>> = { protein: 4, carbs: 4, fat: 9 };

export type ExplicitUnit = 'g' | 'gPerKgBw' | 'gPerKgFfm' | 'pctEnergy';
export type MacroUnit = ExplicitUnit | 'remainder';

export interface MacroRefs {
  /** Day energy, kcal (engine convention, incl. fibre and alcohol). */
  energyKcal: number;
  bodyMassKg: number;
  ffmKg: number;
  fibreG: number;
  alcoholG: number;
}

export type MacroGrams = Record<MacroKey, number>;

/** Energy left for protein + carbs + fat after fibre (2 kcal/g) and alcohol (7 kcal/g). */
export function availableKcal(refs: MacroRefs): number {
  return Math.max(0, refs.energyKcal - 2 * refs.fibreG - 7 * refs.alcoholG);
}

export function kcalOf(g: MacroGrams): number {
  return 4 * g.protein + 4 * g.carbs + 9 * g.fat;
}

/** Grams → value in a unit. */
export function gramsToUnit(key: MacroKey, grams: number, unit: ExplicitUnit, refs: MacroRefs): number {
  switch (unit) {
    case 'g':
      return grams;
    case 'gPerKgBw':
      return refs.bodyMassKg > 0 ? grams / refs.bodyMassKg : 0;
    case 'gPerKgFfm':
      return refs.ffmKg > 0 ? grams / refs.ffmKg : 0;
    case 'pctEnergy':
      return refs.energyKcal > 0 ? (100 * grams * KCAL_PER_G[key]) / refs.energyKcal : 0;
  }
}

/** Value in a unit → grams (the compiler's `macroGrams`). */
export function unitToGrams(key: MacroKey, value: number, unit: ExplicitUnit, refs: MacroRefs): number {
  switch (unit) {
    case 'g':
      return value;
    case 'gPerKgBw':
      return value * refs.bodyMassKg;
    case 'gPerKgFfm':
      return value * refs.ffmKg;
    case 'pctEnergy':
      return ((value / 100) * refs.energyKcal) / KCAL_PER_G[key];
  }
}

/** Storage precision per unit (keeps the saved schedule readable; energy stays exact via the remainder). */
export const UNIT_DECIMALS: Readonly<Record<ExplicitUnit, number>> = {
  g: 1,
  gPerKgBw: 2,
  gPerKgFfm: 2,
  pctEnergy: 1,
};

const roundTo = (v: number, dp: number): number => {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};

export function unitOf(a: MacroAmount | undefined): MacroUnit {
  return a ? a.unit : 'g';
}

/** The macro that takes the remaining energy (fat when none is marked, the compiler's fallback). */
export function remainderKey(m: MacroSpec): MacroKey {
  for (const k of ['fat', 'carbs', 'protein'] as const) if (m[k].unit === 'remainder') return k;
  return 'fat';
}

/** Default explicit unit for a macro that stops being the remainder. */
export const DEFAULT_UNIT: Readonly<Record<MacroKey, ExplicitUnit>> = {
  protein: 'gPerKgBw',
  carbs: 'g',
  fat: 'g',
};

/**
 * Move `key` to `grams` holding energy constant. `locked` macros keep their grams; the moved macro is capped at what
 * the unlocked others can give (they never go negative). Returns the new grams and whether the move was capped.
 */
export function redistribute(
  current: MacroGrams,
  key: MacroKey,
  grams: number,
  locked: ReadonlySet<MacroKey>,
  refs: MacroRefs,
): { grams: MacroGrams; capped: boolean; maxGrams: number } {
  const others = MACRO_KEYS.filter((k) => k !== key && !locked.has(k));
  const lockedKcal = MACRO_KEYS.filter((k) => k !== key && locked.has(k)).reduce(
    (a, k) => a + KCAL_PER_G[k] * current[k],
    0,
  );
  const avail = availableKcal(refs);
  const curKey = KCAL_PER_G[key] * current[key];
  const othersKcal = others.reduce((a, k) => a + KCAL_PER_G[k] * current[k], 0);
  // Max the moved macro can take: everything the unlocked others hold (and nothing locked).
  const maxKcal =
    others.length === 0 ? curKey : Math.max(curKey, Math.min(avail - lockedKcal, curKey + othersKcal));
  const maxGrams = maxKcal / KCAL_PER_G[key];
  let target = Math.max(0, grams) * KCAL_PER_G[key];
  let capped = false;
  if (target > maxKcal + 1e-9) {
    target = maxKcal;
    capped = true;
  }
  if (others.length === 0)
    return { grams: { ...current }, capped: grams * KCAL_PER_G[key] !== curKey, maxGrams };
  const delta = target - curKey;
  const next: MacroGrams = { ...current, [key]: target / KCAL_PER_G[key] };
  if (othersKcal > 1e-9) {
    for (const k of others) {
      const share = (KCAL_PER_G[k] * current[k]) / othersKcal;
      next[k] = Math.max(0, (KCAL_PER_G[k] * current[k] - delta * share) / KCAL_PER_G[k]);
    }
  } else {
    // Others are empty: a decrease is split evenly among them (an increase was capped at 0 above).
    for (const k of others) next[k] = Math.max(0, -delta / others.length / KCAL_PER_G[k]);
  }
  return { grams: next, capped, maxGrams };
}

/**
 * Write grams back into a MacroSpec, keeping each explicit macro in its unit and exactly one remainder.
 * Energy consistency holds by construction: the remainder takes whatever the explicit macros leave.
 */
export function writeMacros(
  spec: MacroSpec,
  grams: MacroGrams,
  refs: MacroRefs,
  remainder: MacroKey = remainderKey(spec),
): MacroSpec {
  const out: MacroSpec = { ...spec };
  for (const k of MACRO_KEYS) {
    if (k === remainder) {
      out[k] = { unit: 'remainder' };
      continue;
    }
    const u = spec[k].unit;
    const unit: ExplicitUnit = u === 'remainder' ? DEFAULT_UNIT[k] : u;
    out[k] = {
      unit,
      value: roundTo(gramsToUnit(k, grams[k], unit, refs), UNIT_DECIMALS[unit]),
    } as MacroAmount;
  }
  return out;
}

/**
 * Change the unit a macro is entered in (or make it the remainder). Grams stay the same; when the remainder moves,
 * the previous remainder becomes explicit in its default unit.
 */
export function changeUnit(
  spec: MacroSpec,
  key: MacroKey,
  unit: MacroUnit,
  grams: MacroGrams,
  refs: MacroRefs,
): MacroSpec {
  const rem = remainderKey(spec);
  if (unit === 'remainder') {
    if (rem === key) return spec;
    const withOld: MacroSpec = { ...spec, [rem]: { unit: DEFAULT_UNIT[rem], value: 0 } };
    return writeMacros(withOld, grams, refs, key);
  }
  let nextRem = rem;
  if (rem === key) nextRem = key === 'fat' ? 'carbs' : 'fat';
  const base: MacroSpec = { ...spec, [key]: { unit, value: 0 } as MacroAmount };
  if (nextRem !== rem) base[rem] = { unit: DEFAULT_UNIT[rem], value: 0 } as MacroAmount;
  return writeMacros(base, grams, refs, nextRem);
}

/** Energy shares (0..1) of P/C/F within the macro energy (the ternary triangle's coordinates). */
export function energyShares(g: MacroGrams): MacroGrams {
  const t = kcalOf(g);
  if (t <= 0) return { protein: 1 / 3, carbs: 1 / 3, fat: 1 / 3 };
  return { protein: (4 * g.protein) / t, carbs: (4 * g.carbs) / t, fat: (9 * g.fat) / t };
}

/** Shares → grams at the available energy (triangle drag). Shares are clamped to ≥ 0 and renormalised. */
export function gramsFromShares(s: MacroGrams, refs: MacroRefs): MacroGrams {
  const p = Math.max(0, s.protein);
  const c = Math.max(0, s.carbs);
  const f = Math.max(0, s.fat);
  const t = p + c + f || 1;
  const avail = availableKcal(refs);
  return { protein: (avail * p) / t / 4, carbs: (avail * c) / t / 4, fat: (avail * f) / t / 9 };
}

/** Human unit label. */
export const UNIT_LABEL: Readonly<Record<MacroUnit, string>> = {
  g: 'g',
  gPerKgBw: 'g/kg',
  gPerKgFfm: 'g/kg lean',
  pctEnergy: '%',
  remainder: 'rest',
};
