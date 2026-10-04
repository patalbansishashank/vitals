/**
 * TEST-ONLY scenario builders for the ketones validation suite (05 §7, 20 §4.3.4). Absolute clock: hours since
 * midnight of day 0; burn-in days are negative. Bodies follow the dossiers' model subjects (05 §4.6 "lean man 75 kg /
 * FFM 60"; 20 Tables A1/A3) — protocol details the dossiers do not state (meal clock 08/13/19 h, 50/15/35 %E habitual
 * diet) are test assumptions documented here.
 */
import type { RefBody, RefMeal, RefScenario } from './reference05';

export const BODY = {
  /** 05 §4.6 model subject. */
  leanMan: { BW: 75, FFM: 60, IR: 1.0, TEE: 2600 },
  /** Lean woman (smaller glycogen capacity relative to brain demand, 05 §4.6). */
  woman: { BW: 60, FFM: 45, IR: 1.0, TEE: 2000 },
  /** Deru 2024 overweight/obese adults (05 used IR 1.3). */
  overweight: { BW: 90, FFM: 58, IR: 1.3, TEE: 2600 },
  /** Owen/Balasse obese subjects (BW ≈ 110, FFM ≈ 60; 05 §4.1 derivation), IR 1.2. */
  obese: { BW: 110, FFM: 60, IR: 1.2, TEE: 2800 },
  /** 20 Table A1 lean man (75 kg, 15 % BF, TEE 2633). */
  lean20: { BW: 75, FFM: 63.75, IR: 1.0, TEE: 2633 },
  /** 20 Table A3 obese woman (100 kg, 45 % BF, TEE 2468), IR 1.2. */
  obese20: { BW: 100, FFM: 55, IR: 1.2, TEE: 2468 },
  /** Hall 2016 / Rosenbaum 2019 overweight men (BMI 25-35). */
  hall2016: { BW: 95, FFM: 65, IR: 1.2, TEE: 2700 },
  /** Harvey 2019 cohort (25 M / 52 F, BMI 27): a mixed-average adult. */
  harvey: { BW: 76, FFM: 50, IR: 1.1, TEE: 2300 },
  /** Urbain & Bertz 2016 healthy BMI 23. */
  urbain: { BW: 68, FFM: 52, IR: 1.0, TEE: 2300 },
  /** Burke 2021 elite male race walkers. */
  walker: { BW: 65, FFM: 58, IR: 0.9, TEE: 3500 },
} as const satisfies Record<string, RefBody>;

export interface DietDay {
  kcal: number;
  carbG: number;
  proteinG: number;
  /** Clock hours of the meals (equal split). */
  hours?: readonly number[];
}

export function dietFromPct(kcal: number, carbPct: number, proteinPct: number, hours?: readonly number[]): DietDay {
  return { kcal, carbG: (kcal * carbPct) / 400, proteinG: (kcal * proteinPct) / 400, hours };
}

/** Meals of one day (equal split); fat is the energy remainder. */
export function mealsOfDay(day: number, diet: DietDay): RefMeal[] {
  const hours = diet.hours ?? [8, 13, 19];
  const n = hours.length;
  const fat = Math.max(0, (diet.kcal - 4 * diet.carbG - 4 * diet.proteinG) / 9);
  return hours.map((h) => ({ t: 24 * day + h, netCarbG: diet.carbG / n, proteinG: diet.proteinG / n, fatG: fat / n }));
}

export function mealsOfDays(fromDay: number, toDayExcl: number, diet: DietDay): RefMeal[] {
  const out: RefMeal[] = [];
  for (let d = fromDay; d < toDayExcl; d++) out.push(...mealsOfDay(d, diet));
  return out;
}

export const BURN_IN_DAYS = 14;

/** Habitual mixed diet at maintenance (50/15/35 %E). */
export const habitual = (body: RefBody): DietDay => dietFromPct(body.TEE, 50, 15);

/**
 * Water-only fast from the dinner of day 0 (t = 19 h): 14 burn-in days + day 0 breakfast/lunch/dinner on the habitual
 * diet, then nothing until tEnd. Returns the scenario and t0 (the last meal).
 */
export function fastScenario(body: RefBody, fastHours: number, extra?: Partial<RefScenario>): { sc: RefScenario; t0: number } {
  const hab = habitual(body);
  const meals = mealsOfDays(-BURN_IN_DAYS, 1, hab);
  const t0 = 19;
  return {
    t0,
    sc: {
      body,
      meals,
      tStart: -24 * BURN_IN_DAYS,
      tEnd: t0 + fastHours + 1,
      habitualProteinG: hab.proteinG,
      habitualCarbG: hab.carbG,
      ...extra,
    },
  };
}

/** Habitual burn-in, then `days` of `diet` from day 0 (inclusive). */
export function dietScenario(body: RefBody, diet: DietDay, days: number, extra?: Partial<RefScenario>): RefScenario {
  const hab = habitual(body);
  return {
    body,
    meals: [...mealsOfDays(-BURN_IN_DAYS, 0, hab), ...mealsOfDays(0, days, diet)],
    tStart: -24 * BURN_IN_DAYS,
    tEnd: 24 * days,
    habitualProteinG: hab.proteinG,
    habitualCarbG: hab.carbG,
    ...extra,
  };
}

/**
 * 20 §4.3.4 water-only reference curve, t in hours since the start of zero intake:
 * BHB_ref = 0.08 + B1/(1 + e^{−(t−44)/9}) + B2·(1 − e^{−max(0, t−48)/τ2}), B1 = 2.2·(1 − 0.4·ob), B2 = 3.7,
 * τ2 = 170·(1 + 0.5·ob), ob = clamp((BF% − 25)/20, 0, 1).
 */
export function bhbRef20(tH: number, bodyFatPct: number): number {
  const ob = Math.min(1, Math.max(0, (bodyFatPct - 25) / 20));
  const b1 = 2.2 * (1 - 0.4 * ob);
  const tau2 = 170 * (1 + 0.5 * ob);
  return 0.08 + b1 / (1 + Math.exp(-(tH - 44) / 9)) + 3.7 * (1 - Math.exp(-Math.max(0, tH - 48) / tau2));
}

/** 05 §7 tolerance: ±30 % or ±0.15 mM, whichever is larger. */
export const tol05 = (obs: number): number => Math.max(0.3 * obs, 0.15);
