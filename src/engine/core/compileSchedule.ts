/**
 * Schedule compiler (docs/MODEL_SPEC.md §5.3): Schedule → DayInput[] → per-day 24-row hour table.
 *
 * - Programs are merged with per-day overrides (shallow per top-level field; `macros`/`food`/`meals`/`hydration`
 *   merged one level deeper).
 * - Energy: 'kcal' and 'pct' with the 'baseline' reference resolve here; 'current' and 'blockStart' resolve at
 *   runtime (`resolveDayInPlace`, allocation-free). Body-mass-based macro units follow the energy reference.
 *   "% of maintenance" means weight-stable at the PLANNED activity (ruling R-MAINT): every day's reference carries the
 *   activity adjustment of `core/activityReference.ts` (`DayInput.maintenanceKcal`, `activityAdjKcal`,
 *   `activityDeltaKcal`, `plannedBalanceKcal`).
 * - Macros resolve to grams (g, g/kg BW, g/kg FFM, %E, remainder); fibre defaults to 8 g/1000 kcal (15 §1.1).
 * - Meals: explicit list, or the eating-window shorthand (count evenly from window start to end).
 * - Fast events (meal-to-meal `durationH`, ruling 18:10) and 'zero' days build a zero-intake mask over absolute hours;
 *   meals strictly inside a fast window are dropped from the day (compile note `mealDroppedInFast`; never relocated).
 *   Fasts may span any day/week boundary.
 */
import type { ResolvedProfile } from '../types/profile';
import type {
  CardioSession,
  DayTemplate,
  EnergyReference,
  ExerciseSession,
  MacroAmount,
  MealSplit,
  ResistanceSession,
  Schedule,
  ScheduleDay,
  TrainingRegion,
} from '../types/schedule';
import {
  CARDIO_MODALITY_CODE,
  MAX_MEALS,
  MAX_SESSIONS,
  N_REGIONS,
  TRAINING_REGIONS,
  type CompileNoteCode,
  type CompiledSchedule,
  type DayInput,
  type HourInput,
  type MealResolved,
  type SessionResolved,
} from '../types/inputs';
import { ATWATER, DEFAULTS, PROTEIN_QUALITY, RT_PRESETS, RT_STYLE_MET, timeToPeakH } from './defaults';
import { activityReference } from './activityReference';

type Note = { day: number; code: CompileNoteCode; message: string };

// ---------------------------------------------------------------- template merge

export function mergeTemplate(base: DayTemplate, ov: ScheduleDay['override']): DayTemplate {
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

// ---------------------------------------------------------------- numeric resolution (allocation-free)

/** References for resolving % of maintenance and g/kg units. */
export interface ResolveRefs {
  maintenanceKcal: number;
  bodyMassKg: number;
  ffmKg: number;
}

function macroGrams(a: MacroAmount | undefined, factor: number, E: number, refs: ResolveRefs): number {
  if (!a) return 0;
  switch (a.unit) {
    case 'g':
      return a.value;
    case 'gPerKgBw':
      return a.value * refs.bodyMassKg;
    case 'gPerKgFfm':
      return a.value * refs.ffmKg;
    case 'pctEnergy':
      return ((a.value / 100) * E) / factor;
    case 'remainder':
      return Number.NaN; // resolved below
  }
}

const isRemainder = (a: MacroAmount | undefined): boolean => a !== undefined && a.unit === 'remainder';

/**
 * Fill the numeric fields of `d` from its template. Allocation-free (writes into preallocated meal/session objects),
 * so the loop can call it for runtime days. Returns the number of notes it would emit (notes only collected at
 * compile time through `notes`).
 */
export function resolveDayNumbers(
  d: DayInput,
  refs: ResolveRefs,
  profile: ResolvedProfile,
  refeedFactor: number,
  notes: Note[] | null,
  keepMealClocks = false,
): void {
  const t = d.template;
  const e = t.energy;
  // ---- energy
  let E: number;
  if (d.zeroIntake || e.kind === 'zero') {
    E = 0;
  } else if (e.kind === 'kcal') {
    E = e.kcal;
  } else {
    E = (e.pct / 100) * refs.maintenanceKcal;
  }
  d.maintenanceKcal = refs.maintenanceKcal;
  d.refeedFactor = refeedFactor;

  if (E <= 0) {
    zeroDay(d);
    return;
  }
  const m = t.macros;
  // ---- fibre first (it carries energy in the convention)
  let fibreG: number;
  if (m.fibre && m.fibre.unit === 'gPer1000Kcal') fibreG = (m.fibre.value * E) / 1000;
  else if (m.fibre) fibreG = macroGrams(m.fibre as MacroAmount, ATWATER.fibre, E, refs);
  else fibreG = (DEFAULTS.fibreGPer1000Kcal * E) / 1000;
  if (!Number.isFinite(fibreG)) fibreG = (DEFAULTS.fibreGPer1000Kcal * E) / 1000;

  let alcoholG = 0;
  const alc = t.substances?.alcohol;
  if (alc) for (let i = 0; i < alc.length; i++) alcoholG += alc[i]!.drinks * DEFAULTS.gramsPerDrink;

  let p = macroGrams(m.protein, ATWATER.protein, E, refs);
  let c: number;
  let f: number;
  const share = m.carbShareNonProtein;
  if (share !== undefined && Number.isFinite(share)) {
    // review m8 / 18 §4.4.2: carbohydrate share of the energy left after protein, fibre and alcohol; fat takes the rest
    if (!Number.isFinite(p)) {
      if (notes) notes.push({ day: d.day, code: 'nonProteinShareNeedsProtein', message: 'carbShareNonProtein needs an explicit protein amount; protein set to 0' });
      p = 0;
    }
    const sh = Math.min(1, Math.max(0, share));
    const npE = Math.max(0, E - ATWATER.protein * p - ATWATER.fibre * fibreG - ATWATER.alcohol * alcoholG);
    c = (sh * npE) / ATWATER.carb;
    f = ((1 - sh) * npE) / ATWATER.fat;
  } else {
    c = macroGrams(m.carbs, ATWATER.carb, E, refs);
    f = macroGrams(m.fat, ATWATER.fat, E, refs);
  }
  const useShare = share !== undefined && Number.isFinite(share);
  const nRem = useShare ? 0 : (isRemainder(m.protein) ? 1 : 0) + (isRemainder(m.carbs) ? 1 : 0) + (isRemainder(m.fat) ? 1 : 0);
  if (nRem > 1 && notes) notes.push({ day: d.day, code: 'multipleRemainder', message: 'more than one macro set to "remainder"; fat takes it' });
  const fixedKcal =
    (Number.isFinite(p) ? ATWATER.protein * p : 0) +
    (Number.isFinite(c) ? ATWATER.carb * c : 0) +
    (Number.isFinite(f) ? ATWATER.fat * f : 0) +
    ATWATER.fibre * fibreG +
    ATWATER.alcohol * alcoholG;
  let rest = E - fixedKcal;
  if (rest < 0) {
    if (notes) notes.push({ day: d.day, code: 'macrosExceedEnergy', message: `macros exceed energy by ${Math.round(-rest)} kcal; realised energy = sum of macros` });
    rest = 0;
  }
  const mctReqG = m.fatTypes?.mctG ?? 0;
  if (!Number.isFinite(f) || (nRem > 1 && isRemainder(m.fat))) {
    if (!Number.isFinite(p)) p = 0;
    if (!Number.isFinite(c)) c = 0;
    // MCT carries 8.3 kcal/g (05 §4.17): the remainder fat grams that fill `rest` include the MCT at its own density
    f = rest / ATWATER.fat;
    if (mctReqG > 0) f = (rest + (ATWATER.fat - ATWATER.mct) * Math.min(f, mctReqG)) / ATWATER.fat;
  } else if (!Number.isFinite(c)) {
    if (!Number.isFinite(p)) p = 0;
    c = rest / ATWATER.carb;
  } else if (!Number.isFinite(p)) {
    p = rest / ATWATER.protein;
  }
  // graded refeed (17 HC-F3): scale the whole day, grams included
  p *= refeedFactor;
  c *= refeedFactor;
  f *= refeedFactor;
  fibreG *= refeedFactor;
  d.proteinG = p;
  d.carbG = c;
  d.fatG = f;
  d.fibreG = fibreG;
  d.alcoholG = alcoholG;
  // ---- composition details (MODEL_SPEC §5.2.3 defaults)
  const ft = m.fatTypes;
  d.mctG = Math.min(f, mctReqG * refeedFactor);
  // engine energy convention (15 §4.2) with MCT at 8.3 kcal/g (05 §4.17; review item A6: intake uses 8.3 too)
  d.energyKcal =
    ATWATER.protein * p + ATWATER.carb * c + ATWATER.fat * f - (ATWATER.fat - ATWATER.mct) * d.mctG + ATWATER.fibre * fibreG + ATWATER.alcohol * alcoholG;
  d.satFatG = f * (ft?.satShare ?? DEFAULTS.satShare);
  d.mufaG = f * (ft?.mufaShare ?? DEFAULTS.mufaShare);
  d.pufaG = f * (ft?.pufaShare ?? DEFAULTS.pufaShare);
  d.omega3G = (ft?.omega3G ?? DEFAULTS.habitualOmega3G[profile.sex]) * refeedFactor;
  const chol = t.food?.cholesterolMg;
  d.cholesterolMg = chol !== undefined && Number.isFinite(chol) ? chol * refeedFactor : Number.NaN;
  const sugars =
    m.sugarsShare !== undefined
      ? c * m.sugarsShare
      : Math.min(c, (DEFAULTS.habitualSugarsG[profile.sex] * c) / Math.max(1, profile.habitualCarbG));
  d.sugarsG = sugars;
  d.fructoseG = sugars * (m.fructoseShareOfSugars ?? DEFAULTS.fructoseShareOfSugars);
  d.galactoseG = 0;
  d.glucoseEqG = Math.max(0, c - d.fructoseG - d.galactoseG);
  d.viscousFibreG = fibreG * (m.viscousFibreShare ?? DEFAULTS.viscousFibreShare);
  const pq = PROTEIN_QUALITY[m.proteinSource ?? (profile.habits.dietAnimalLevel === 'vegan' ? 'mixedVegan' : profile.habits.dietAnimalLevel === 'vegetarian' ? 'mixedVegetarian' : 'mixedOmnivore')];
  d.proteinQDaily = pq.qDaily;
  placeMeals(d, pq, notes, keepMealClocks);
  // sodium follows the food when the template does not set it (the habitual sodium density per kcal; A1 request
  // 2026-09-30: overfeeding brings its sodium, 15 §4.7 S_na); set before the exercise carbohydrate is added
  if (t.hydration?.sodiumG === undefined && profile.tdee0Kcal > 0) d.sodiumMg = (profile.habitualSodiumMg * d.energyKcal) / profile.tdee0Kcal;
  addExerciseCarbs(d, notes);
}

/**
 * Review M8: carbohydrate eaten during exercise (sessions' `carbDuringGPerH`) is part of the day's intake — added to
 * carbG, glucoseEqG and energyKcal after meal placement (meals never contain it). Intake absorbs it hourly from
 * `HourInput.exCarbG` as glucose (t_p 0.5 h). Allocation-free.
 */
function addExerciseCarbs(d: DayInput, notes: Note[] | null): void {
  let g = 0;
  for (let i = 0; i < d.nSessions; i++) {
    const s = d.sessions[i]!;
    if (s.carbDuringGPerH > 0 && s.durationMin > 0) g += (s.carbDuringGPerH * s.durationMin) / 60;
  }
  d.exerciseCarbG = g;
  if (g <= 0) return;
  d.carbG += g;
  d.glucoseEqG += g;
  d.energyKcal += ATWATER.carb * g;
  if (notes) notes.push({ day: d.day, code: 'carbsDuringExerciseAdded', message: `${Math.round(g)} g carbohydrate eaten during exercise added to the day's intake` });
}

function zeroDay(d: DayInput): void {
  d.energyKcal = 0;
  d.proteinG = 0;
  d.carbG = 0;
  d.glucoseEqG = 0;
  d.exerciseCarbG = 0;
  d.fructoseG = 0;
  d.galactoseG = 0;
  d.sugarsG = 0;
  d.fibreG = 0;
  d.viscousFibreG = 0;
  d.fatG = 0;
  d.satFatG = 0;
  d.mufaG = 0;
  d.pufaG = 0;
  d.omega3G = 0;
  d.mctG = 0;
  d.alcoholG = 0;
  d.nMeals = 0;
  d.cholesterolMg = Number.NaN;
}

function splitWeight(split: MealSplit, i: number, n: number): number {
  if (split === 'biggerLast') return i + 1;
  if (split === 'biggerFirst') return n - i;
  return 1;
}

/**
 * Place meals and distribute the day's grams. Explicit `meals` win over the window shorthand. `keepClocks` (runtime
 * re-resolution) keeps the clock times set at compile time; meals dropped by a planned fast (`mealDropMask`) are dropped again.
 */
function placeMeals(d: DayInput, pq: { qMeal: number; speed: number }, notes: Note[] | null, keepClocks: boolean): void {
  const t = d.template;
  const mp = t.meals ?? {};
  const explicit = mp.meals;
  let n: number;
  if (explicit && explicit.length > 0) n = Math.min(explicit.length, MAX_MEALS);
  else n = Math.max(1, Math.min(MAX_MEALS, Math.round(mp.count ?? DEFAULTS.mealsPerDay)));
  if (explicit && explicit.length > MAX_MEALS && notes) notes.push({ day: d.day, code: 'mealsTruncated', message: `only ${MAX_MEALS} meals are simulated` });
  const start = mp.window?.startH ?? DEFAULTS.windowStartH;
  const len = mp.window?.lengthH ?? DEFAULTS.windowLengthH;
  const split = mp.split ?? DEFAULTS.mealSplit;

  // shares
  let wSum = 0;
  for (let i = 0; i < n; i++) {
    const w = explicit && explicit[i]!.share !== undefined ? explicit[i]!.share! : splitWeight(split, i, n);
    d.meals[i]!.kcal = w; // temporary: weight
    wSum += w;
  }
  const alcHours = t.substances?.alcohol;
  for (let i = 0; i < n; i++) {
    const meal = d.meals[i]!;
    const share = wSum > 0 ? meal.kcal / wSum : 1 / n;
    if (!keepClocks) meal.clockH = explicit ? explicit[i]!.clockH : n === 1 ? start : start + (len * i) / (n - 1);
    const ex = explicit ? explicit[i]!.macros : undefined;
    meal.proteinG = ex?.proteinG ?? d.proteinG * share;
    meal.carbG = ex?.carbG ?? d.carbG * share;
    meal.fatG = ex?.fatG ?? d.fatG * share;
    meal.fibreG = ex?.fibreG ?? d.fibreG * share;
    meal.alcoholG = alcHours ? 0 : (ex?.alcoholG ?? 0);
    const cf = d.carbG > 0 ? meal.carbG / d.carbG : 0;
    meal.fructoseG = d.fructoseG * cf;
    meal.galactoseG = d.galactoseG * cf;
    meal.glucoseEqG = Math.max(0, meal.carbG - meal.fructoseG - meal.galactoseG);
    const ff = d.fatG > 0 ? meal.fatG / d.fatG : 0;
    meal.satFatG = d.satFatG * ff;
    meal.mctG = d.mctG * ff;
    meal.viscousFibreG = d.fibreG > 0 ? (d.viscousFibreG * meal.fibreG) / d.fibreG : 0;
    const src = explicit?.[i]?.proteinSource;
    const q = src ? PROTEIN_QUALITY[src] : pq;
    meal.proteinQDaily = q === pq ? d.proteinQDaily : (q as { qDaily: number }).qDaily;
    meal.proteinQMeal = q.qMeal;
    meal.proteinSpeed = q.speed;
    meal.glycaemicIndex = t.food?.glycaemicIndex ?? DEFAULTS.glycaemicIndex;
    meal.timeToPeakH = timeToPeakH(meal.glycaemicIndex, meal.carbG, meal.fatG);
    meal.kcal =
      ATWATER.protein * meal.proteinG +
      ATWATER.carb * meal.carbG +
      ATWATER.fat * meal.fatG -
      (ATWATER.fat - ATWATER.mct) * meal.mctG +
      ATWATER.fibre * meal.fibreG +
      ATWATER.alcohol * meal.alcoholG;
  }
  d.nMeals = n;
  if (d.mealDropMask) applyMealDrops(d);
  let first = 24;
  let last = 0;
  let any = false;
  for (let i = 0; i < n; i++) {
    const m = d.meals[i]!;
    if (!(m.kcal > 0) && !(m.alcoholG > 0)) continue;
    any = true;
    first = Math.min(first, m.clockH);
    last = Math.max(last, m.clockH);
  }
  d.windowStartH = any ? first : 0;
  d.windowLengthH = any ? Math.max(0, last - first) : 0;
}

/**
 * Meals strictly inside a planned fast window are dropped (A2 request 2026-09-30; they never move as a bolus to the
 * boundary): their content is removed from the day's totals and the meal slot is emptied (kcal 0, skipped by the hour
 * expansion). Day-level quantities without a per-meal split (MUFA/PUFA, EPA+DHA, sugars, cholesterol) scale with the kept
 * share of fat, carbohydrate or energy. Allocation-free (runtime re-resolution calls it too).
 */
function applyMealDrops(d: DayInput): void {
  const mask = d.mealDropMask ?? 0;
  const fat0 = d.fatG;
  const carb0 = d.carbG;
  const e0 = d.energyKcal;
  for (let i = 0; i < d.nMeals; i++) {
    if ((mask & (1 << i)) === 0) continue;
    const m = d.meals[i]!;
    d.proteinG -= m.proteinG;
    d.carbG -= m.carbG;
    d.glucoseEqG -= m.glucoseEqG;
    d.fructoseG -= m.fructoseG;
    d.galactoseG -= m.galactoseG;
    d.fatG -= m.fatG;
    d.satFatG -= m.satFatG;
    d.mctG -= m.mctG;
    d.fibreG -= m.fibreG;
    d.viscousFibreG -= m.viscousFibreG;
    d.alcoholG -= m.alcoholG;
    d.energyKcal -= m.kcal;
    m.proteinG = 0; m.carbG = 0; m.glucoseEqG = 0; m.fructoseG = 0; m.galactoseG = 0; m.fatG = 0; m.satFatG = 0; m.mctG = 0;
    m.fibreG = 0; m.viscousFibreG = 0; m.alcoholG = 0; m.kcal = 0;
  }
  const clamp0 = (x: number): number => (x > 1e-9 ? x : 0);
  d.proteinG = clamp0(d.proteinG); d.carbG = clamp0(d.carbG); d.glucoseEqG = clamp0(d.glucoseEqG); d.fructoseG = clamp0(d.fructoseG);
  d.galactoseG = clamp0(d.galactoseG); d.fatG = clamp0(d.fatG); d.satFatG = clamp0(d.satFatG); d.mctG = clamp0(d.mctG);
  d.fibreG = clamp0(d.fibreG); d.viscousFibreG = clamp0(d.viscousFibreG); d.alcoholG = clamp0(d.alcoholG); d.energyKcal = clamp0(d.energyKcal);
  const fFat = fat0 > 0 ? d.fatG / fat0 : 1;
  const fCarb = carb0 > 0 ? d.carbG / carb0 : 1;
  const fE = e0 > 0 ? d.energyKcal / e0 : 1;
  d.mufaG *= fFat;
  d.pufaG *= fFat;
  d.omega3G *= fFat;
  d.sugarsG *= fCarb;
  if (Number.isFinite(d.cholesterolMg)) d.cholesterolMg = (d.cholesterolMg as number) * fE;
}

// ---------------------------------------------------------------- allocation helpers (compile time only)

function newMeal(): MealResolved {
  return {
    clockH: 0, proteinG: 0, carbG: 0, glucoseEqG: 0, fructoseG: 0, galactoseG: 0, fatG: 0, satFatG: 0, mctG: 0,
    fibreG: 0, viscousFibreG: 0, alcoholG: 0, kcal: 0, proteinQDaily: 1, proteinQMeal: 1, proteinSpeed: 1,
    glycaemicIndex: DEFAULTS.glycaemicIndex, timeToPeakH: 1,
  };
}

function newSession(): SessionResolved {
  return {
    kind: 'cardio', startH: 0, durationMin: 0, modality: 0, intensityFrac: Number.NaN, met: Number.NaN,
    speedKmh: Number.NaN, powerW: Number.NaN, rpe: Number.NaN, setsByRegion: new Float64Array(N_REGIONS), rir: DEFAULTS.rtRir,
    loadPct1RM: DEFAULTS.rtLoadPct1RM, restSec: DEFAULTS.rtRestSec, toFailure: false, carbDuringGPerH: 0, coldWaterImmersion: false,
  };
}

function resolveSessions(d: DayInput, tmpl: DayTemplate, notes: Note[]): void {
  const ex = tmpl.exercise ?? [];
  if (ex.length > MAX_SESSIONS) notes.push({ day: d.day, code: 'sessionsTruncated', message: `only ${MAX_SESSIONS} sessions per day are simulated` });
  const n = Math.min(ex.length, MAX_SESSIONS);
  for (let i = 0; i < n; i++) {
    const src = ex[i]!;
    const s = d.sessions[i]!;
    s.startH = src.startH;
    s.setsByRegion.fill(0);
    if (src.kind === 'resistance') {
      const r = src as ResistanceSession;
      s.kind = 'resistance';
      s.modality = 0;
      let total = 0;
      if (r.setsByRegion) {
        for (let k = 0; k < N_REGIONS; k++) {
          const v = r.setsByRegion[TRAINING_REGIONS[k] as TrainingRegion] ?? 0;
          s.setsByRegion[k] = v;
          total += v;
        }
      } else {
        const preset = RT_PRESETS[r.volume ?? 'moderate'];
        const perSession = preset.setsPerRegionWeek / preset.sessionsPerWeek;
        for (let k = 0; k < N_REGIONS; k++) s.setsByRegion[k] = perSession;
        total = perSession * N_REGIONS;
      }
      s.durationMin = r.durationMin ?? total * DEFAULTS.rtMinPerSet;
      // an explicit session MET (catalogue item, additive 2026-10-01) wins over the style's Compendium MET
      s.met = r.met !== undefined && Number.isFinite(r.met) && r.met > 0 ? r.met : RT_STYLE_MET[r.style ?? 'general'];
      s.intensityFrac = Number.NaN;
      // 09 §4.1 volume presets are EFFECTIVE sets (hard sets already counted), so they carry RIR 0 unless the user says
      // otherwise; explicit sets per region are counted sets at the default RIR 2 (finisher 2026-09-30: the preset path
      // applied f_RIR 0.88 a second time, 'moderate' 11 → 9.7 effective sets/wk)
      s.rir = r.rir ?? (r.setsByRegion ? DEFAULTS.rtRir : 0);
      s.loadPct1RM = r.loadPct1RM ?? DEFAULTS.rtLoadPct1RM;
      s.restSec = r.restSec ?? DEFAULTS.rtRestSec;
      s.toFailure = r.toFailure ?? false;
      s.carbDuringGPerH = 0;
      s.coldWaterImmersion = r.coldWaterImmersion ?? false;
    } else {
      const c = src as CardioSession;
      s.kind = 'cardio';
      s.modality = CARDIO_MODALITY_CODE[c.modality];
      s.durationMin = c.durationMin;
      s.met = c.met ?? Number.NaN;
      s.speedKmh = c.speedKmh ?? Number.NaN;
      s.powerW = c.powerW ?? Number.NaN;
      s.rpe = c.rpe ?? Number.NaN;
      const anyGiven = c.met !== undefined || c.speedKmh !== undefined || c.powerW !== undefined || c.rpe !== undefined;
      s.intensityFrac = c.pctVo2max ?? (anyGiven ? Number.NaN : DEFAULTS.cardioPctVo2max[c.modality]);
      s.toFailure = false;
      s.carbDuringGPerH = c.carbDuringGPerH ?? 0;
      s.coldWaterImmersion = false;
    }
  }
  d.nSessions = n;
}

function newDay(day: number, dateISO: string, weekday: number, program: number, blockIndex: number, blockStartDay: number, tmpl: DayTemplate): DayInput {
  const meals: MealResolved[] = [];
  for (let i = 0; i < MAX_MEALS; i++) meals.push(newMeal());
  const sessions: SessionResolved[] = [];
  for (let i = 0; i < MAX_SESSIONS; i++) sessions.push(newSession());
  return {
    day, dateISO, weekday, program, blockIndex, blockStartDay, template: tmpl,
    energyMode: 'kcal', energyReference: 'baseline', energyPct: Number.NaN, runtime: false, maintenanceKcal: Number.NaN,
    energyKcal: 0, proteinG: 0, carbG: 0, glucoseEqG: 0, exerciseCarbG: 0, fructoseG: 0, galactoseG: 0, sugarsG: 0, fibreG: 0, viscousFibreG: 0,
    fatG: 0, satFatG: 0, mufaG: 0, pufaG: 0, omega3G: 0, mctG: 0, alcoholG: 0,
    proteinQDaily: 1, glycaemicIndex: DEFAULTS.glycaemicIndex, upfShare: DEFAULTS.upfShare, energyDensityKcalPerG: Number.NaN,
    nutsG: 0, nutDelta: 0, liquidKcal: 0, foodQuality: DEFAULTS.foodQuality,
    meals, nMeals: 0, windowStartH: DEFAULTS.windowStartH, windowLengthH: DEFAULTS.windowLengthH,
    zeroIntake: false, fastHours: 0, electrolytes: DEFAULTS.fastElectrolytes, fastStartDay: -1,
    sessions, nSessions: 0, steps: DEFAULTS.steps,
    sleepBedH: DEFAULTS.bedTimeH, sleepWakeH: DEFAULTS.wakeTimeH, sleepHours: 8, sleepQuality: 2, shiftWork: false,
    sodiumMg: DEFAULTS.sodiumG * 1000, potassiumMg: DEFAULTS.potassiumG * 1000, magnesiumMg: DEFAULTS.magnesiumMg,
    fluidL: Number.NaN, sweatLPerH: 0,
    caffeineMg: 0, creatineG: 0, creatineLoading: false, exoKetoneG: 0,
    stress: 0, illness: false, travelJetLag: false, hotClimate: false,
    refeedFactor: 1, cholesterolMg: Number.NaN, dashFraction: Number.NaN, saunaSessionsPerWeek: 0, mealDropMask: 0,
  };
}

const NUT_DELTA = { wholeRaw: 0.25, wholeRoasted: 0.2, chopped: 0.17, butter: 0 } as const;
const STRESS_CODE = { low: 0, moderate: 1, high: 2 } as const;
const QUALITY_CODE = { poor: 0, fair: 1, good: 2 } as const;

function addDaysISO(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * 17 HC-F3 refeed ramps (fraction of the planned day's energy) after a fast with refeed 'auto', by meal-to-meal duration:
 * T3 (48-72 h): 50 % then 90 % (midpoint of "80-100 %", DERIVED); T4 (> 72 h): 50/50/75 % … for max(4, ⌈½·fast days⌉) days;
 * ≤ 48 h: none (T2: "moderate first meal" is advice, not a ramp).
 */
export function refeedRamp(fastH: number): number[] {
  if (fastH > 72) {
    const days = Math.max(4, Math.ceil(0.5 * (fastH / 24)));
    const r = [0.5, 0.5, 0.75];
    while (r.length < days - 1) r.push(0.75);
    return r;
  }
  if (fastH > 48) return [0.5, 0.9];
  return [];
}

/**
 * Planned zero-intake windows in absolute hours (ruling 18:10, meal-to-meal semantics): intake is allowed at `t0` (last
 * intake) and from `t1` (first intake) on, never strictly between. The whole hours strictly between the hour holding
 * `t0` and the hour holding `t1` form the zero-intake mask.
 */
interface FastWindow {
  t0: number;
  t1: number;
  electrolytes: boolean;
  refeed: boolean;
  refeedDays: number;
}

/** First masked hour and end (exclusive) of a window: [⌊t0⌋ + 1, ⌊t1⌋). Empty when t1 − t0 < ~1 h. */
export function fastMaskHours(t0: number, t1: number): { a: number; b: number } {
  const a = Math.floor(t0 + 1e-9) + 1;
  const b = Math.floor(t1 + 1e-9);
  return { a, b: b > a ? b : a };
}

// ---------------------------------------------------------------- compile

/** Options of `compileSchedule` (additive). */
export interface CompileOptions {
  /**
   * Apply the R-MAINT activity adjustment to the maintenance reference (default true). The habitual week itself is
   * compiled without it (it is the reference; its days are absolute kcal).
   */
  activityReference?: boolean;
}

export function compileSchedule(schedule: Schedule, profile: ResolvedProfile, opts: CompileOptions = {}): CompiledSchedule {
  const notes: Note[] = [];
  const nDays = schedule.horizonDays;
  const startWeekday = (new Date(`${schedule.startDate}T00:00:00Z`).getUTCDay() + 6) % 7;
  const defRef: EnergyReference = schedule.defaults?.energyReference ?? DEFAULTS.energyReference;
  const blocks = schedule.blocks ?? [];
  const days: DayInput[] = [];
  // "training as usual" (DayTemplate.habitualTraining): the habitual week's sessions by weekday, built once when used
  let habitualEx: ExerciseSession[][] | null = null;

  // ---- zero-intake mask over absolute hours (fast events + 'zero' days)
  const nHours = nDays * 24;
  const mask = new Uint8Array(nHours);
  const elecMask = new Uint8Array(nHours);
  const refeedFactor = new Float64Array(nDays).fill(1);
  const windows: FastWindow[] = [];
  for (const ev of schedule.events ?? []) {
    if (ev.kind !== 'fast' || !(ev.durationH > 0)) continue;
    const t0 = ev.startDay * 24 + ev.startH;
    const t1 = t0 + ev.durationH;
    const { a, b } = fastMaskHours(t0, t1);
    for (let h = Math.max(0, a); h < Math.min(nHours, b); h++) {
      mask[h] = 1;
      elecMask[h] = ev.electrolytes === false ? 0 : 1;
    }
    const custom = ev.refeedFactors && ev.refeedFactors.length > 0 ? ev.refeedFactors : null;
    const ramp = custom ?? (ev.refeed === 'auto' ? refeedRamp(ev.durationH) : []);
    const endDay = Math.floor((t1 + 1e-9) / 24);
    for (let i = 0; i < ramp.length; i++) {
      const d = endDay + i;
      const f = Math.min(1, Math.max(0, ramp[i]!));
      if (d >= 0 && d < nDays && Number.isFinite(f)) refeedFactor[d] = Math.min(refeedFactor[d] as number, f);
    }
    windows.push({ t0, t1, electrolytes: ev.electrolytes !== false, refeed: custom !== null || ev.refeed === 'auto', refeedDays: ramp.length });
  }

  for (let d = 0; d < nDays; d++) {
    const sd = schedule.days[d] ?? schedule.days[schedule.days.length - 1];
    let prog = sd?.program ?? 0;
    if (prog < 0 || prog >= schedule.programs.length) {
      notes.push({ day: d, code: 'programIndexInvalid', message: `program ${prog} does not exist; using program 0` });
      prog = 0;
    }
    const tmpl = mergeTemplate(schedule.programs[prog]!, sd?.override);
    let bi = -1;
    for (let i = 0; i < blocks.length; i++) if (d >= blocks[i]!.startDay && d < blocks[i]!.endDay) bi = i;
    const blockStart = bi >= 0 ? blocks[bi]!.startDay : 0;
    const day = newDay(d, addDaysISO(schedule.startDate, d), (startWeekday + d) % 7, prog, bi, blockStart, tmpl);

    // energy mode & reference
    const e = tmpl.energy;
    if (e.kind === 'zero') {
      day.energyMode = 'zero';
      for (let h = 0; h < 24; h++) {
        mask[d * 24 + h] = 1;
        elecMask[d * 24 + h] = tmpl.hydration?.electrolytes === false ? 0 : 1;
      }
    } else if (e.kind === 'kcal') {
      day.energyMode = 'kcal';
    } else {
      day.energyMode = 'pct';
      day.energyPct = e.pct;
      day.energyReference = e.reference ?? defRef;
    }
    const usesBodyRefs = (['protein', 'carbs', 'fat'] as const).some((k) => {
      const u = tmpl.macros[k].unit;
      return u === 'gPerKgBw' || u === 'gPerKgFfm';
    });
    day.runtime = (day.energyMode === 'pct' && day.energyReference !== 'baseline') || (usesBodyRefs && day.energyReference !== 'baseline' && day.energyMode === 'pct');

    // food, hydration, substances, modifiers, sleep, steps
    const food = tmpl.food ?? {};
    day.glycaemicIndex = food.glycaemicIndex ?? DEFAULTS.glycaemicIndex;
    day.upfShare = food.upfShare ?? profile.habits.upfShare;
    day.energyDensityKcalPerG = food.energyDensityKcalPerG ?? Number.NaN;
    day.nutsG = food.nutsG ?? 0;
    day.nutDelta = NUT_DELTA[food.nutForm ?? 'wholeRaw'];
    day.liquidKcal = food.liquidKcal ?? 0;
    day.foodQuality = food.foodQuality ?? profile.habits.foodQuality;
    day.dashFraction = food.dashFraction !== undefined && Number.isFinite(food.dashFraction) ? Math.min(1, Math.max(0, food.dashFraction)) : Number.NaN;
    const hy = tmpl.hydration ?? {};
    day.sodiumMg = (hy.sodiumG ?? profile.habits.habitualSodiumG) * 1000;
    day.potassiumMg = (hy.potassiumG ?? DEFAULTS.potassiumG) * 1000;
    day.magnesiumMg = hy.magnesiumMg ?? DEFAULTS.magnesiumMg;
    day.fluidL = hy.fluidL ?? Number.NaN;
    day.sweatLPerH = hy.sweatLPerH ?? 0;
    const sub = tmpl.substances ?? {};
    day.caffeineMg = sub.caffeine ? sub.caffeine.reduce((a, c) => a + c.mg, 0) : profile.habits.habitualCaffeineMg;
    day.creatineG = sub.creatineG ?? 0;
    day.creatineLoading = sub.creatineLoading ?? false;
    day.exoKetoneG = sub.exogenousKetones ? sub.exogenousKetones.reduce((a, c) => a + c.gBhb, 0) : 0;
    const mo = tmpl.modifiers ?? {};
    day.stress = STRESS_CODE[mo.stress ?? profile.habits.stress];
    day.illness = mo.illness ?? false;
    day.travelJetLag = mo.travelJetLag ?? false;
    day.hotClimate = mo.hotClimate ?? profile.input.safety?.flags.hotClimate ?? false;
    day.saunaSessionsPerWeek = Math.max(0, mo.saunaSessionsPerWeek ?? 0);
    const sl = tmpl.sleep ?? {};
    day.sleepBedH = sl.bedH ?? profile.habits.bedTimeH;
    day.sleepWakeH = sl.wakeH ?? profile.habits.wakeTimeH;
    if (sl.hours === undefined && sameClock(day.sleepBedH, day.sleepWakeH)) {
      // review V1a-L9 (decision 2026-10-03): bed time equal to wake time is no sleep data, not 24 h asleep; use the
      // person's usual times (and the defaults when those are equal too)
      const usual = !sameClock(profile.habits.bedTimeH, profile.habits.wakeTimeH);
      day.sleepBedH = usual ? profile.habits.bedTimeH : DEFAULTS.bedTimeH;
      day.sleepWakeH = usual ? profile.habits.wakeTimeH : DEFAULTS.wakeTimeH;
    }
    day.sleepHours = sl.hours ?? ((day.sleepWakeH - day.sleepBedH + 24) % 24 || 24);
    day.sleepQuality = QUALITY_CODE[sl.quality ?? profile.habits.sleepQuality];
    day.shiftWork = sl.shiftWork ?? false;
    day.steps = tmpl.steps ?? profile.habits.typicalSteps;
    if (tmpl.habitualTraining === true) {
      habitualEx ??= habitualWeekPrograms(profile).map((t) => t.exercise ?? []);
      day.habitualTraining = true;
      resolveSessions(day, { ...tmpl, exercise: [...habitualEx[day.weekday]!, ...(tmpl.exercise ?? [])] }, notes);
    } else {
      resolveSessions(day, tmpl, notes);
    }
    days.push(day);
  }

  // ---- R-MAINT: maintenance reference at the planned activity (core/activityReference.ts), then the numeric resolution.
  // Static days resolve now; runtime days get a provisional resolution at the day-0 values (overwritten in the loop).
  const ref = opts.activityReference === false ? null : activityReference(profile, days, blocks, startWeekday, () => habitualWeek(profile));
  const refs: ResolveRefs = { maintenanceKcal: profile.tdee0Kcal, bodyMassKg: profile.weightKg, ffmKg: profile.ffm0Kg };
  for (let d = 0; d < nDays; d++) {
    const day = days[d]!;
    const e = day.template.energy;
    const habitualRef = e.kind === 'pctMaintenance' && e.activity === 'habitual';
    const adj = ref === null || habitualRef ? 0 : day.runtime ? ref.adjRuntime[d]! : ref.adjBaseline[d]!;
    day.activityAdjKcal = adj;
    day.activityDeltaKcal = ref === null || habitualRef ? 0 : ref.delta[d]!;
    refs.maintenanceKcal = profile.tdee0Kcal + adj;
    resolveDayNumbers(day, refs, profile, refeedFactor[d] as number, notes);
  }

  // ---- apply the zero-intake mask to meals; derive per-day fast info and merged spans
  for (let d = 0; d < nDays; d++) {
    const day = days[d]!;
    let covered = 0;
    for (let h = 0; h < 24; h++) covered += mask[d * 24 + h] as number;
    day.fastHours = covered;
    day.electrolytes = covered > 0 ? elecMask[d * 24 + (covered === 24 ? 0 : firstMasked(mask, d))] === 1 : DEFAULTS.fastElectrolytes;
    if (covered === 24) {
      if (day.exerciseCarbG > 0) {
        notes.push({ day: d, code: 'carbsDuringExerciseDropped', message: 'carbohydrate during exercise dropped (zero-intake day)' });
        for (let i = 0; i < day.nSessions; i++) day.sessions[i]!.carbDuringGPerH = 0;
      }
      day.zeroIntake = true;
      zeroDay(day);
      // water-only day: the sodium is the electrolyte plan's (habitual level unless the template sets it; 17 §4.3)
      if (day.template.hydration?.sodiumG === undefined) day.sodiumMg = profile.habitualSodiumMg;
      continue;
    }
    substancesInFastNotes(day, d, mask, notes);
    if (covered === 0) {
      // meals after this day's midnight may land in tomorrow's planned fast (review V1a-M2/L2 carry)
      if (d + 1 < nDays && maskedHours(mask, d + 1) > 0) markMealDrops(day, d, windows, mask, notes, profile);
      continue;
    }
    // review M8: carbohydrate during a session that overlaps the zero-intake mask is dropped (the fast wins)
    for (let i = 0; i < day.nSessions; i++) {
      const ss = day.sessions[i]!;
      if (!(ss.carbDuringGPerH > 0)) continue;
      const a = Math.floor(ss.startH);
      const b = Math.min(24, Math.ceil(ss.startH + ss.durationMin / 60));
      let hit = false;
      for (let hh = a; hh < b && !hit; hh++) if (mask[d * 24 + hh] === 1) hit = true;
      if (!hit) continue;
      const g = (ss.carbDuringGPerH * ss.durationMin) / 60;
      day.carbG -= g;
      day.glucoseEqG -= g;
      day.energyKcal -= ATWATER.carb * g;
      day.exerciseCarbG -= g;
      ss.carbDuringGPerH = 0;
      notes.push({ day: d, code: 'carbsDuringExerciseDropped', message: 'carbohydrate during exercise dropped (inside a planned fast)' });
    }
    markMealDrops(day, d, windows, mask, notes, profile);
  }
  // fast start days and merged spans (with the meal-to-meal duration and the planned refeed)
  const intake: number[] = [];
  for (let d = 0; d < nDays; d++) {
    const day = days[d]!;
    if (day.zeroIntake) continue;
    for (let i = 0; i < day.nMeals; i++) {
      const m = day.meals[i]!;
      const abs = d * 24 + m.clockH;
      if (m.kcal > 0 && mask[Math.min(nHours - 1, Math.floor(abs))] !== 1) intake.push(abs);
    }
  }
  intake.sort((x, y) => x - y);
  const spans: { startHour: number; endHour: number; electrolytes: boolean; mealToMealH: number; refeed: 'none' | 'auto'; refeedDays: number }[] = [];
  let h = 0;
  while (h < nHours) {
    if (mask[h] === 1) {
      const a = h;
      while (h < nHours && mask[h] === 1) h++;
      // last intake before the span and first after it (horizon edges count as intake)
      let before = a;
      let after = h;
      for (let i = intake.length - 1; i >= 0; i--)
        if (intake[i]! < a) {
          before = intake[i]!;
          break;
        }
      for (const t of intake)
        if (t >= h) {
          after = t;
          break;
        }
      let refeed: 'none' | 'auto' = 'none';
      let refeedDays = 0;
      for (const w of windows) {
        const wa = fastMaskHours(w.t0, w.t1);
        if (wa.a < h && wa.b > a && w.refeed) {
          refeed = 'auto';
          refeedDays = Math.max(refeedDays, w.refeedDays);
        }
      }
      spans.push({ startHour: a, endHour: h, electrolytes: elecMask[a] === 1, mealToMealH: after - before, refeed, refeedDays });
      for (let d = Math.floor(a / 24); d <= Math.floor((h - 1) / 24); d++) days[d]!.fastStartDay = Math.floor(a / 24);
    } else h++;
  }
  for (let d = 0; d < nDays; d++) {
    const day = days[d]!;
    day.plannedBalanceKcal = day.energyKcal - day.maintenanceKcal;
  }
  if (nDays > 0 && runsPastMidnight(days[nDays - 1]!))
    notes.push({ day: nDays - 1, code: 'pastHorizonDropped', message: 'food, drinks or exercise after midnight on the last day fall after the end of the plan and are not simulated' });
  const lv = schedule.adherence ?? {};
  const adherence = {
    selfMonitoring: lv.selfMonitoring === true,
    mealReplacement: lv.mealReplacement === true,
    preMealWater: lv.preMealWater === true,
    flexibleRestraint: lv.flexibleRestraint === true,
  };

  return { nDays, startDate: schedule.startDate, startWeekday, days, fastSpans: spans, notes, adherence };
}

/**
 * Mark and drop the meals of day `d` that lie strictly inside a fast window (event windows (t0, t1), or a masked hour of a
 * 'zero' day), then re-derive the day's window. Compile time only.
 */
function markMealDrops(day: DayInput, d: number, windows: readonly FastWindow[], mask: Uint8Array, notes: Note[], profile: ResolvedProfile): void {
  let bits = 0;
  for (let i = 0; i < day.nMeals; i++) {
    const meal = day.meals[i]!;
    const abs = d * 24 + meal.clockH;
    const ah = Math.floor(Math.max(d * 24, abs)); // absolute hour (a clock past 24:00 is in the next day's hours)
    let inside = ah < mask.length && mask[ah] === 1;
    for (const w of windows) if (abs > w.t0 + 1e-9 && abs < w.t1 - 1e-9) inside = true;
    if (!inside) continue;
    bits |= 1 << i;
    notes.push({ day: d, code: 'mealDroppedInFast', message: `meal at ${meal.clockH.toFixed(1)} h dropped (inside the fast)` });
  }
  if (bits === 0) return;
  day.mealDropMask = bits;
  applyMealDrops(day);
  if (day.template.hydration?.sodiumG === undefined && profile.tdee0Kcal > 0)
    day.sodiumMg = (profile.habitualSodiumMg * (day.energyKcal - ATWATER.carb * day.exerciseCarbG)) / profile.tdee0Kcal;
  let first = 24;
  let last = 0;
  let any = false;
  for (let i = 0; i < day.nMeals; i++) {
    const m = day.meals[i]!;
    if (!(m.kcal > 0) && !(m.alcoholG > 0)) continue;
    any = true;
    first = Math.min(first, m.clockH);
    last = Math.max(last, m.clockH);
  }
  day.windowStartH = any ? first : 0;
  day.windowLengthH = any ? Math.max(0, last - first) : 0;
}

function sameClock(a: number, b: number): boolean {
  return Math.abs((((a - b) % 24) + 24) % 24) < 1e-9;
}

function maskedHours(mask: Uint8Array, d: number): number {
  let n = 0;
  for (let h = 0; h < 24; h++) n += mask[d * 24 + h] as number;
  return n;
}

/**
 * Review V1a-L5 (decision 2026-10-03): a drink or exogenous ketones planned inside a fast are kept (a drink breaks the
 * fast); tell the person. Clock times past 24:00 are checked against the next day's hours.
 */
function substancesInFastNotes(day: DayInput, d: number, mask: Uint8Array, notes: Note[]): void {
  const sub = day.template.substances;
  if (!sub) return;
  const at = (clockH: number): boolean => {
    const ah = Math.floor(d * 24 + Math.max(0, clockH));
    return ah < mask.length && mask[ah] === 1;
  };
  const clock = (h: number): string => {
    const m = Math.round(h * 60);
    return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  };
  for (const a of sub.alcohol ?? [])
    if (a.drinks > 0 && at(a.clockH)) notes.push({ day: d, code: 'drinkInFast', message: `the drink at ${clock(a.clockH)} is inside the planned fast; it is counted and breaks the fast` });
  for (const k of sub.exogenousKetones ?? [])
    if (k.gBhb > 0 && at(k.clockH)) notes.push({ day: d, code: 'ketonesInFast', message: `the ketone drink at ${clock(k.clockH)} is inside the planned fast; it is counted and breaks the fast` });
}

/** Whether any meal, drink, caffeine or exercise of `day` runs past its midnight. */
function runsPastMidnight(day: DayInput): boolean {
  if (!day.zeroIntake) {
    for (let i = 0; i < day.nMeals; i++) {
      const m = day.meals[i]!;
      if ((m.kcal > 0 || m.alcoholG > 0) && m.clockH >= 24) return true;
    }
    const sub = day.template.substances;
    for (const a of sub?.alcohol ?? []) if (a.clockH >= 24) return true;
    for (const k of sub?.exogenousKetones ?? []) if (k.clockH >= 24) return true;
  }
  for (const c of day.template.substances?.caffeine ?? []) if (c.clockH >= 24) return true;
  for (let i = 0; i < day.nSessions; i++) {
    const s = day.sessions[i]!;
    if (s.startH + s.durationMin / 60 > 24 + 1e-9) return true;
  }
  return false;
}

function firstMasked(mask: Uint8Array, d: number): number {
  for (let h = 0; h < 24; h++) if (mask[d * 24 + h] === 1) return h;
  return 0;
}

/** Runtime re-resolution for 'current' / 'blockStart' days (allocation-free). */
export function resolveDayInPlace(day: DayInput, refs: ResolveRefs, profile: ResolvedProfile): void {
  const zero = day.zeroIntake;
  // the graded-refeed factor and the fast-adjusted meal clocks set at compile time are kept
  resolveDayNumbers(day, refs, profile, day.refeedFactor ?? 1, null, true);
  if (zero) {
    day.zeroIntake = true;
    zeroDay(day);
    if (day.template.hydration?.sodiumG === undefined) day.sodiumMg = profile.habitualSodiumMg;
  }
  day.plannedBalanceKcal = day.energyKcal - day.maintenanceKcal;
}

// ---------------------------------------------------------------- hour expansion

/** Preallocated 24-row struct-of-arrays for one day's HourInput rows. */
export class DayHourTable {
  readonly kcal = new Float64Array(24);
  readonly proteinG = new Float64Array(24);
  readonly carbG = new Float64Array(24);
  readonly glucoseEqG = new Float64Array(24);
  readonly fructoseG = new Float64Array(24);
  readonly galactoseG = new Float64Array(24);
  readonly fatG = new Float64Array(24);
  readonly satFatG = new Float64Array(24);
  readonly mctG = new Float64Array(24);
  readonly fibreG = new Float64Array(24);
  readonly alcoholG = new Float64Array(24);
  readonly proteinQMeal = new Float64Array(24).fill(1);
  readonly proteinSpeed = new Float64Array(24).fill(1);
  readonly timeToPeakH = new Float64Array(24).fill(1);
  readonly glycaemicIndex = new Float64Array(24);
  readonly mealStart = new Float64Array(24);
  readonly caffeineMg = new Float64Array(24);
  readonly exoKetoneG = new Float64Array(24);
  readonly exMin = new Float64Array(24);
  readonly exIntensityFrac = new Float64Array(24);
  readonly exModality = new Float64Array(24);
  readonly exMet = new Float64Array(24);
  readonly exCarbDuringGPerMin = new Float64Array(24);
  readonly exCarbG = new Float64Array(24);
  readonly rtSetsByRegion = new Float64Array(24 * N_REGIONS);
  readonly rtSetsTotal = new Float64Array(24);
  readonly rtRir = new Float64Array(24);
  readonly rtLoadPct1RM = new Float64Array(24);
  readonly rtToFailure = new Float64Array(24);
  readonly steps = new Float64Array(24);
  readonly asleep = new Float64Array(24);
  readonly plannedFast = new Float64Array(24);
  readonly electrolytes = new Float64Array(24);
  /**
   * Row groups that differ from their idle defaults (performance, integration 2026-09-30): 1 when the hour carries intake
   * (meal / alcohol / exogenous-ketone fields), exercise fields, or caffeine. Expansion resets only the flagged rows of the
   * previous day and `loadHour` copies only the groups the hour (or the previous hour) uses.
   */
  readonly rowIntake = new Uint8Array(24);
  readonly rowEx = new Uint8Array(24);
  readonly rowCaf = new Uint8Array(24);
  /** 1 when the hour has any intake, substance or exercise (kept for callers that test it). */
  readonly active = new Uint8Array(24);
  /** Whether the HourInput currently holds non-idle values of each group. */
  outIntakeDirty = true;
  outExDirty = true;
  outCafDirty = true;
  /** Legacy flag (any group dirty); kept for compatibility. */
  outDirty = true;
}

function overlap(a0: number, a1: number, b0: number, b1: number): number {
  const lo = a0 > b0 ? a0 : b0;
  const hi = a1 < b1 ? a1 : b1;
  return hi > lo ? hi - lo : 0;
}

/** Reset the rows the previous expansion used to their idle defaults (allocation-free). */
function resetUsedRows(t: DayHourTable): void {
  for (let h = 0; h < 24; h++) {
    if (t.rowIntake[h] === 1) {
      t.kcal[h] = 0; t.proteinG[h] = 0; t.carbG[h] = 0; t.glucoseEqG[h] = 0; t.fructoseG[h] = 0; t.galactoseG[h] = 0;
      t.fatG[h] = 0; t.satFatG[h] = 0; t.mctG[h] = 0; t.fibreG[h] = 0; t.alcoholG[h] = 0; t.mealStart[h] = 0;
      t.proteinQMeal[h] = 1; t.proteinSpeed[h] = 1; t.timeToPeakH[h] = 1; t.exoKetoneG[h] = 0;
      t.rowIntake[h] = 0;
    }
    if (t.rowEx[h] === 1) {
      t.exMin[h] = 0; t.exIntensityFrac[h] = 0; t.exModality[h] = 0; t.exMet[h] = 0; t.exCarbDuringGPerMin[h] = 0; t.exCarbG[h] = 0;
      for (let k = 0; k < N_REGIONS; k++) t.rtSetsByRegion[h * N_REGIONS + k] = 0;
      t.rtSetsTotal[h] = 0; t.rtRir[h] = 0; t.rtLoadPct1RM[h] = 0; t.rtToFailure[h] = 0;
      t.rowEx[h] = 0;
    }
    if (t.rowCaf[h] === 1) {
      t.caffeineMg[h] = 0;
      t.rowCaf[h] = 0;
    }
  }
}

/** Add one meal to hour `h` of the table. */
function addMealAt(t: DayHourTable, h: number, m: MealResolved): void {
  const prevP = t.proteinG[h]!;
  t.kcal[h] = t.kcal[h]! + m.kcal;
  t.proteinG[h] = prevP + m.proteinG;
  t.carbG[h] = t.carbG[h]! + m.carbG;
  t.glucoseEqG[h] = t.glucoseEqG[h]! + m.glucoseEqG;
  t.fructoseG[h] = t.fructoseG[h]! + m.fructoseG;
  t.galactoseG[h] = t.galactoseG[h]! + m.galactoseG;
  t.fatG[h] = t.fatG[h]! + m.fatG;
  t.satFatG[h] = t.satFatG[h]! + m.satFatG;
  t.mctG[h] = t.mctG[h]! + m.mctG;
  t.fibreG[h] = t.fibreG[h]! + m.fibreG;
  t.alcoholG[h] = t.alcoholG[h]! + m.alcoholG;
  const w = prevP + m.proteinG > 0 ? m.proteinG / (prevP + m.proteinG) : 1;
  t.proteinQMeal[h] = t.proteinQMeal[h]! * (1 - w) + m.proteinQMeal * w;
  t.proteinSpeed[h] = t.proteinSpeed[h]! * (1 - w) + m.proteinSpeed * w;
  t.timeToPeakH[h] = m.timeToPeakH;
  t.glycaemicIndex[h] = m.glycaemicIndex;
  t.mealStart[h] = 1;
  t.rowIntake[h] = 1;
}

/**
 * Today's hour of a clock time of `src` (a day whose clock times may run past 24:00). `shift` is 0 for today's own items
 * (clock in [0, 24)) and 24 for the previous day's items after its midnight (clock in [24, 48)); -1 when the item does
 * not belong to today's hours. Review V1a-L2: a clock time of 24:00 or later is no longer clamped to hour 23.
 */
function hourOf(clockH: number, shift: number): number {
  const c = clockH - shift;
  if (shift === 0 ? c >= 24 : c < 0) return -1;
  return Math.min(23, Math.max(0, Math.floor(c)));
}

/** Intake and substances of `src` that fall in today's hours (`shift` as in `hourOf`). */
function addIntake(src: DayInput, shift: number, fastMask: Uint8Array | null, maskOffset: number, t: DayHourTable): void {
  if (src.zeroIntake) return;
  for (let i = 0; i < src.nMeals; i++) {
    const m = src.meals[i]!;
    if (!(m.kcal > 0) && !(m.alcoholG > 0)) continue; // dropped (fast) or empty meal
    const h = hourOf(m.clockH, shift);
    if (h < 0) continue;
    if (fastMask && fastMask[maskOffset + h] === 1) continue; // inside a planned zero-intake hour
    addMealAt(t, h, m);
  }
  // Review V1a-L5 (decision 2026-10-03): a drink or exogenous ketones inside a planned fast are kept, not dropped. They
  // count as intake and break the fast; compile adds a note (`drinkInFast`, `ketonesInFast`) so the plan can say so.
  const tp = src.template.substances;
  if (tp?.alcohol) for (const a of tp.alcohol) { const h = hourOf(a.clockH, shift); if (h < 0) continue; t.alcoholG[h] = t.alcoholG[h]! + a.drinks * DEFAULTS.gramsPerDrink; t.kcal[h] = t.kcal[h]! + a.drinks * DEFAULTS.gramsPerDrink * ATWATER.alcohol; t.rowIntake[h] = 1; }
  if (tp?.exogenousKetones) for (const k of tp.exogenousKetones) { const h = hourOf(k.clockH, shift); if (h < 0) continue; t.exoKetoneG[h] = t.exoKetoneG[h]! + k.gBhb * (k.form === 'salt' ? 0.5 : 1); t.rowIntake[h] = 1; }
}

/** The part of each session of `src` that lies in today's hours (`shift` as in `hourOf`). */
function addSessions(src: DayInput, shift: number, t: DayHourTable): void {
  for (let i = 0; i < src.nSessions; i++) {
    const s = src.sessions[i]!;
    const a = s.startH - shift;
    const b = a + s.durationMin / 60;
    for (let h = Math.max(0, Math.floor(a)); h < Math.min(24, Math.ceil(b)); h++) {
      const mins = overlap(a, b, h, h + 1) * 60;
      if (mins <= 0) continue;
      const tot = t.exMin[h]! + mins;
      t.exIntensityFrac[h] = (t.exIntensityFrac[h]! * t.exMin[h]! + (Number.isFinite(s.intensityFrac) ? s.intensityFrac : 0) * mins) / tot;
      t.exMin[h] = tot;
      t.exModality[h] = s.modality;
      t.exMet[h] = Number.isFinite(s.met) ? s.met : 0;
      t.exCarbDuringGPerMin[h] = s.carbDuringGPerH / 60;
      t.exCarbG[h] = t.exCarbG[h]! + (s.carbDuringGPerH * mins) / 60;
      t.rowEx[h] = 1;
      if (s.kind === 'resistance') {
        const frac = mins / Math.max(1, s.durationMin);
        for (let k = 0; k < N_REGIONS; k++) {
          const v = s.setsByRegion[k]! * frac;
          t.rtSetsByRegion[h * N_REGIONS + k] = t.rtSetsByRegion[h * N_REGIONS + k]! + v;
          t.rtSetsTotal[h] = t.rtSetsTotal[h]! + v;
        }
        t.rtRir[h] = s.rir;
        t.rtLoadPct1RM[h] = s.loadPct1RM;
        t.rtToFailure[h] = s.toFailure ? 1 : 0;
      }
    }
  }
}

/**
 * Fill `t` for `day`. `prevBedH`/`prevSleepH` describe the sleep that started the previous evening (for the
 * morning hours). `prevDay` is the day before (as simulated): its meals, drinks, caffeine and exercise minutes after its
 * midnight (clock 24:00 or later) land in today's hours (review V1a-M2/L2, decision 2026-10-03: cross-day carry). They
 * stay in the previous day's totals, so every minute and gram is stepped exactly once. Today's own items after midnight
 * are left for tomorrow's expansion (dropped after the last simulated day; compile note `pastHorizonDropped`).
 * Allocation-free.
 */
export function expandDayToHours(
  day: DayInput,
  prevBedH: number,
  prevSleepH: number,
  fastMask: Uint8Array | null,
  maskOffset: number,
  t: DayHourTable,
  prevDay: DayInput | null = null,
): void {
  resetUsedRows(t);
  t.glycaemicIndex.fill(day.glycaemicIndex);

  if (prevDay) addIntake(prevDay, 24, fastMask, maskOffset, t);
  addIntake(day, 0, fastMask, maskOffset, t);
  if (prevDay?.template.substances?.caffeine) for (const c of prevDay.template.substances.caffeine) { const h = hourOf(c.clockH, 24); if (h < 0) continue; t.caffeineMg[h] = t.caffeineMg[h]! + c.mg; t.rowCaf[h] = 1; }
  const caf = day.template.substances?.caffeine;
  if (caf) for (const c of caf) { const h = hourOf(c.clockH, 0); if (h < 0) continue; t.caffeineMg[h] = t.caffeineMg[h]! + c.mg; t.rowCaf[h] = 1; }
  else if (day.caffeineMg > 0) { t.caffeineMg[DEFAULTS.caffeineClockH] = t.caffeineMg[DEFAULTS.caffeineClockH]! + day.caffeineMg; t.rowCaf[DEFAULTS.caffeineClockH] = 1; }

  // exercise: the previous day's minutes after its midnight, then today's minutes before midnight
  if (prevDay) addSessions(prevDay, 24, t);
  addSessions(day, 0, t);

  // sleep: previous evening's episode covers the morning, today's covers the night
  const prevStart = prevBedH - 24;
  const prevEnd = prevStart + prevSleepH;
  const todayStart = day.sleepBedH;
  const todayEnd = todayStart + day.sleepHours;
  let wakeHours = 0;
  for (let h = 0; h < 24; h++) {
    const a = overlap(h, h + 1, prevStart, prevEnd) + overlap(h, h + 1, todayStart, todayEnd);
    t.asleep[h] = a > 1 ? 1 : a;
    wakeHours += 1 - t.asleep[h]!;
  }
  // steps spread over waking hours
  if (wakeHours > 0) for (let h = 0; h < 24; h++) t.steps[h] = (day.steps * (1 - t.asleep[h]!)) / wakeHours;
  else t.steps.fill(0);

  if (fastMask) for (let h = 0; h < 24; h++) { const v = fastMask[maskOffset + h]!; t.plannedFast[h] = v; t.electrolytes[h] = v && day.electrolytes ? 1 : 0; }
  else if (day.zeroIntake) { t.plannedFast.fill(1); t.electrolytes.fill(day.electrolytes ? 1 : 0); }
  else { t.plannedFast.fill(0); t.electrolytes.fill(0); }
  for (let h = 0; h < 24; h++) t.active[h] = t.rowIntake[h]! | t.rowEx[h]! | t.rowCaf[h]!;
}

/**
 * Copy row `h` of the table into the reusable HourInput, group by group: the always-present fields (sleep, steps, fast
 * flags, GI) every hour; the intake, exercise and caffeine groups only when the hour uses them, or once to zero them after
 * an hour that did. Keeps the per-hour cost low (integration 2026-09-30, A1 profiling).
 */
export function loadHour(t: DayHourTable, h: number, out: HourInput): void {
  out.hourOfDay = h;
  out.steps = t.steps[h]!;
  out.asleep = t.asleep[h]!;
  out.plannedFast = t.plannedFast[h]!;
  out.electrolytes = t.electrolytes[h]!;
  out.glycaemicIndex = t.glycaemicIndex[h]!;
  if (t.rowIntake[h] === 1) {
    out.kcal = t.kcal[h]!;
    out.proteinG = t.proteinG[h]!;
    out.carbG = t.carbG[h]!;
    out.glucoseEqG = t.glucoseEqG[h]!;
    out.fructoseG = t.fructoseG[h]!;
    out.galactoseG = t.galactoseG[h]!;
    out.fatG = t.fatG[h]!;
    out.satFatG = t.satFatG[h]!;
    out.mctG = t.mctG[h]!;
    out.fibreG = t.fibreG[h]!;
    out.alcoholG = t.alcoholG[h]!;
    out.proteinQMeal = t.proteinQMeal[h]!;
    out.proteinSpeed = t.proteinSpeed[h]!;
    out.timeToPeakH = t.timeToPeakH[h]!;
    out.mealStart = t.mealStart[h]!;
    out.exoKetoneG = t.exoKetoneG[h]!;
    t.outIntakeDirty = true;
  } else if (t.outIntakeDirty) {
    out.kcal = 0; out.proteinG = 0; out.carbG = 0; out.glucoseEqG = 0; out.fructoseG = 0; out.galactoseG = 0; out.fatG = 0;
    out.satFatG = 0; out.mctG = 0; out.fibreG = 0; out.alcoholG = 0; out.proteinQMeal = 1; out.proteinSpeed = 1; out.timeToPeakH = 1;
    out.mealStart = 0; out.exoKetoneG = 0;
    t.outIntakeDirty = false;
  }
  if (t.rowCaf[h] === 1) {
    out.caffeineMg = t.caffeineMg[h]!;
    t.outCafDirty = true;
  } else if (t.outCafDirty) {
    out.caffeineMg = 0;
    t.outCafDirty = false;
  }
  if (t.rowEx[h] === 1) {
    out.exMin = t.exMin[h]!;
    out.exIntensityFrac = t.exIntensityFrac[h]!;
    out.exModality = t.exModality[h]!;
    out.exMet = t.exMet[h]!;
    out.exCarbDuringGPerMin = t.exCarbDuringGPerMin[h]!;
    out.exCarbG = t.exCarbG[h]!;
    for (let k = 0; k < N_REGIONS; k++) out.rtSetsByRegion[k] = t.rtSetsByRegion[h * N_REGIONS + k]!;
    out.rtSetsTotal = t.rtSetsTotal[h]!;
    out.rtRir = t.rtRir[h]!;
    out.rtLoadPct1RM = t.rtLoadPct1RM[h]!;
    out.rtToFailure = t.rtToFailure[h]!;
    t.outExDirty = true;
  } else if (t.outExDirty) {
    out.exMin = 0; out.exIntensityFrac = 0; out.exModality = 0; out.exMet = 0; out.exCarbDuringGPerMin = 0; out.exCarbG = 0;
    out.rtSetsByRegion.fill(0); out.rtSetsTotal = 0; out.rtRir = 0; out.rtLoadPct1RM = 0; out.rtToFailure = 0;
    t.outExDirty = false;
  }
  t.outDirty = t.outIntakeDirty || t.outExDirty || t.outCafDirty;
}

export function newHourInput(): HourInput {
  return {
    day: 0, hourOfDay: 0, hourIndex: 0, kcal: 0, proteinG: 0, carbG: 0, glucoseEqG: 0, fructoseG: 0, galactoseG: 0, fatG: 0,
    satFatG: 0, mctG: 0, fibreG: 0, alcoholG: 0, proteinQMeal: 1, proteinSpeed: 1, timeToPeakH: 1, glycaemicIndex: 55, mealStart: 0,
    caffeineMg: 0, exoKetoneG: 0, exMin: 0, exIntensityFrac: 0, exModality: 0, exMet: 0, exCarbDuringGPerMin: 0, exCarbG: 0,
    rtSetsByRegion: new Float64Array(N_REGIONS), rtSetsTotal: 0, rtRir: 0, rtLoadPct1RM: 0, rtToFailure: 0, steps: 0, asleep: 0,
    plannedFast: 0, electrolytes: 0,
  };
}

/**
 * Habitual day template used for the burn-in (MODEL_SPEC §3.4): habitual energy at maintenance, habitual macros,
 * meals and window, habitual steps, sessions/week folded into no explicit sessions (their energy is in TDEE0).
 */
export function habitualTemplate(profile: ResolvedProfile): DayTemplate {
  const h = profile.habits;
  // habitual alcohol (drinks/week spread evenly over the week, taken with the last meal); its energy is inside TDEE0
  // exactly as in resolveProfile's habitual macro split
  const drinksPerDay = Math.max(0, h.habitualAlcoholDrinksPerWeek) / 7;
  const lastMealH = h.habitualWindowStartH + h.habitualWindowLengthH;
  return {
    id: 'habitual',
    label: 'habitual',
    energy: { kind: 'kcal', kcal: profile.tdee0Kcal },
    macros: {
      protein: { unit: 'g', value: profile.habitualProteinG },
      carbs: { unit: 'g', value: profile.habitualCarbG },
      fat: { unit: 'remainder' },
      fibre: { unit: 'g', value: profile.habitualFibreG },
    },
    meals: { count: h.habitualMealsPerDay, window: { startH: h.habitualWindowStartH, lengthH: h.habitualWindowLengthH } },
    steps: h.typicalSteps,
    sleep: { bedH: h.bedTimeH, wakeH: h.wakeTimeH, quality: h.sleepQuality },
    ...(drinksPerDay > 0 ? { substances: { alcohol: [{ clockH: Math.min(23.5, lastMealH), drinks: drinksPerDay, withMeal: true }] } } : {}),
  };
}

/** Start time of habitual exercise sessions in the burn-in week (h). */
export const HABIT_SESSION_START_H = 18;
/** Duration of one habitual session (min), as in TDEE0's EAT0 (10 §4.1). */
export const HABIT_SESSION_MIN = 60;

/**
 * The habitual week used for burn-in (MODEL_SPEC §3.4, review B3): 7 DayInputs indexed by weekday (0 = Monday), all at
 * the habitual intake (TDEE0 kcal, habitual macros, meals, steps, sleep). `habits.sessionsPerWeek` sessions
 * (rounded, 0-7) of 60 min at 18:00 are spread over the week (slot i on weekday ⌊7i/N⌋, i.e. alternating days where
 * possible); a `lifingCardioMix` share of them are cardio (modality 'other' at the §5.3 default intensity, 0.625 VO2max —
 * exactly what the Simulator's default cardio session compiles to, so a user who keeps their habitual training stays at the
 * burn-in equilibrium in energy and in training dose; integration 2026-09-30: the former 5.0 MET made a fit person's
 * habitual training "below 40 % VO2max", i.e. no training dose, and energy's NEAT0 calibration absorbs the difference to
 * TDEE0's EAT0 prior), the rest resistance sessions with the 09 'moderate' weekly volume (11 effective sets per region per
 * week, entered at RIR 0 because they are already effective sets — the same count as the 'moderate' preset since 2026-09-30)
 * split over the RT sessions.
 */
export function habitualWeek(profile: ResolvedProfile): DayInput[] {
  const programs = habitualWeekPrograms(profile);
  const s: Schedule = {
    schemaVersion: 1,
    startDate: '2026-01-05', // a Monday: day i = weekday i
    horizonDays: 7,
    programs,
    days: programs.map((_, i) => ({ program: i })),
  };
  return compileSchedule(s, profile, { activityReference: false }).days;
}

/**
 * The seven day templates of `habitualWeek`, indexed by weekday (0 = Monday) — the single definition of the habitual week
 * (burn-in, the O-12 maintenance fixture `validation/fixtures/programs.habitualWeekSchedule`, and any caller that wants a
 * user to "keep doing exactly what they do now"). Allocation allowed (called once per run).
 */
export function habitualWeekPrograms(profile: ResolvedProfile): DayTemplate[] {
  const h = profile.habits;
  const n = Math.max(0, Math.min(7, Math.round(h.sessionsPerWeek)));
  const mix = Math.max(0, Math.min(1, h.lifingCardioMix));
  const kinds: ('rest' | 'rt' | 'cardio')[] = ['rest', 'rest', 'rest', 'rest', 'rest', 'rest', 'rest'];
  let nRt = 0;
  for (let i = 0; i < n; i++) {
    const cardio = Math.floor((i + 1) * mix + 1e-9) > Math.floor(i * mix + 1e-9);
    kinds[Math.floor((7 * i) / n)] = cardio ? 'cardio' : 'rt';
    if (!cardio) nRt++;
  }
  const base = habitualTemplate(profile);
  const perSession = nRt > 0 ? RT_PRESETS.moderate.setsPerRegionWeek / nRt : 0;
  const sets: Partial<Record<TrainingRegion, number>> = {};
  for (const r of TRAINING_REGIONS) sets[r as TrainingRegion] = perSession;
  const programs: DayTemplate[] = kinds.map((k, wd) => {
    if (k === 'rest') return { ...base, id: `habitual-${wd}` };
    const session: ResistanceSession | CardioSession =
      k === 'rt'
        ? { kind: 'resistance', startH: HABIT_SESSION_START_H, durationMin: HABIT_SESSION_MIN, setsByRegion: sets, rir: 0, style: 'general' }
        : { kind: 'cardio', modality: 'other', startH: HABIT_SESSION_START_H, durationMin: HABIT_SESSION_MIN };
    return { ...base, id: `habitual-${wd}`, exercise: [session] };
  });
  return programs;
}

/**
 * The profile's habitual sessions on `weekday` (0 = Monday) — what a `habitualTraining: true` ("training as usual") day
 * trains, identical to the burn-in habitual week (`habitualWeekPrograms`). Empty on habitual rest days. For UI display and
 * for callers that want to materialise the sessions into `exercise`.
 */
export function habitualSessionsFor(profile: ResolvedProfile, weekday: number): ExerciseSession[] {
  const wd = ((Math.floor(weekday) % 7) + 7) % 7;
  return habitualWeekPrograms(profile)[wd]!.exercise ?? [];
}

/** Build one standalone habitual DayInput (rest day of the habitual week; kept for tests and module test kits). */
export function habitualDay(profile: ResolvedProfile): DayInput {
  const s: Schedule = {
    schemaVersion: 1,
    startDate: '2026-01-05',
    horizonDays: 1,
    programs: [habitualTemplate(profile)],
    days: [{ program: 0 }],
  };
  return compileSchedule(s, profile, { activityReference: false }).days[0]!;
}
