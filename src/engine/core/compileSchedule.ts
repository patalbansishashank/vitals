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
 *
 * 2026-10-18 contracts (W0-core):
 * - D2-01/C2: a fast's planned length and label are policy metadata (`fastSpans[].source/protocol/eventId`,
 *   `DayInput.fastPolicy`). A zero-calorie fast ends at the first VERIFIED intake with positive energy (any intake inside an
 *   observed/censored fast, or an intake on an observed day): that intake is kept, never dropped. A `modified` protocol is
 *   never a zero-intake mask. Graded refeed ramps never rescale an observed day. Observed days carry their coverage and
 *   causal resolution (at best 'daily': daily-native modules read whole-day totals).
 * - D6-02/C3: a meal with reported energy (`MealSpec.energyKcal`) keeps exactly that energy; absent macros are unknown
 *   (0 known grams), the unexplained remainder is unallocated energy (`unallocatedKcal`, never a named substrate) and known
 *   grams exceeding the report are a source conflict (the grams are simulated, the report is kept in `reportedKcal`).
 * - D3-01: resistance set groups compile to `DayInput.rtGroups` with the sets started per hour in `rtGroupSets`; a day
 *   with any explicit group (or a grouped bout carried past midnight into it) lists every set stepped in its hours as a
 *   group (legacy sessions as one merged group, carried bouts with `session` −1); other days keep the legacy hour path.
 * - D4-01: `resolvedDayExposure` / `CompileOptions.exposure` give the final resolved per-day exposure with coverage.
 *
 * W1-core (2026-10-18):
 * - D3-03/D3-07/D3-09: cardio interval phases, the public-health class, the steps scope and session steps travel to the
 *   resolved day/session (the activity module integrates phases; the step ledger subtracts session steps only for a
 *   total-day count).
 * - D6-07: an intake event's carbohydrate mixture, duration and form travel with the meal (an unknown remainder is
 *   simulated at the day's default mixture as a scenario and kept in `carbUnknownMixG`); a known during-session mixture
 *   splits the session carbohydrate into fructose and glucose instead of forcing it all into glucose.
 * - D6-08: a nut form that is not stated gets no form-specific ME delta (unknown species/form never inherits the almond
 *   coefficient).
 * - D6-03/D7-04: the resolved exposure also carries fatty-acid classes, EPA+DHA, fructose, magnesium and the normalised
 *   active-ingredient doses (total and largest single dose, by ingredient) with their coverage.
 * - D8-06: an observed sleep episode maps to its WAKE date: it is the night that ended on that day (`sleepEndingToday`) and
 *   the previous day's night in the hour expansion; planned nights keep the starting-date convention. The last observed
 *   episode ending on day 0 initialises the carried sleep (`CompiledSchedule.initialSleep`).
 *
 * Re-audit 2026-10-19 (stage 1, waves 0-1):
 * - A1-014: every meal keeps its nutrient knowledge (`MealResolved.nutrientMask`: absent analysis on a reported meal is
 *   unknown, an explicit 0 is a known 0) through reported-meal resolution, day aggregation (`DayInput.nutrientUnknownMask`),
 *   runtime re-resolution, fast-window removal and hourly ingestion (`HourInput.nutrientUnknownMask`). The resolved exposure
 *   of a nutrient is complete only when every included contribution is known; otherwise its known sum is a lower bound
 *   (`partial`) or nothing is known (`unknown`), with the contribution counts beside it.
 * - A1-025: finite non-negative reported ME is the meal's energy for every ledger status (negative rounding and a source
 *   conflict included); the known grams stay the record and the signed difference is an energy-only correction, so an
 *   incompatible gram allocation never supplies energy the report does not contain. A conflict keeps its status (the run
 *   puts a review status on the outputs that depend on the allocation).
 * - A1-029: an observed meal keeps its known ethanol whatever standalone drinks the day also lists; a standalone drink adds
 *   its own amount at its own time. Only an explicit same-event identity (a drink entry carrying the meal's `eventId`) counts
 *   one exposure once (the meal record is kept). Prescribed (prospective) days keep the drink-budget convention.
 * - A1-031: polyols travel by identity (`polyolsG`) on meals, days and hours, outside the non-polyol carbohydrate; the
 *   reported ME is unchanged.
 * - A1-020/A1-022: groups and sessions carry their physical-bout key and compiled bout end, and an unknown hard-set count
 *   (`setsUnknown`, the named `unknownDoseScenario`, field provenance) apart from ordinary inferred fields (`assumed`).
 * - A1-062: a cardio session's effort-scale identity and its class source travel to the resolved session; a phase inherits
 *   only an explicitly declared session scale.
 * - A1-053: the observed sleep of a waking day keeps its known total asleep hours (explicit, else the union of its episodes
 *   counted once) apart from the main-episode timing that places hourly sleep; the entered quality (or unrated) reaches day
 *   zero and every later day; a nap-only record stays partial.
 * - A1-040: a known habitual step/session overlap reaches the habitual week's step ledger (the same resolver as the plan's
 *   days).
 */
import type { ResolvedProfile } from '../types/profile';
import type {
  ActiveDoseSpec,
  CardioSession,
  CarbComposition,
  ContractionType,
  DayTemplate,
  DoseFieldProvenance,
  EnergyReference,
  ExerciseSession,
  IntervalPhase,
  MacroAmount,
  MealNutrientKey,
  MealSpec,
  MealSplit,
  ObservedSleepEpisode,
  ResistanceSession,
  ResistanceSetGroup,
  Schedule,
  ScheduleDay,
  SleepSpec,
  TrainingRegion,
  UnknownDoseScenario,
} from '../types/schedule';
import {
  CARDIO_MODALITY_CODE,
  MAX_MEALS,
  MAX_SESSIONS,
  MAX_SET_GROUPS_PER_DAY,
  N_REGIONS,
  NUTRIENT_UNKNOWN_BIT,
  TRAINING_REGIONS,
  boutKeyOf,
  type CompileNoteCode,
  type CompiledSchedule,
  type DayExposureSummary,
  type DayInput,
  type HourInput,
  type MealNutrientMask,
  type MealResolved,
  type ResistanceGroupResolved,
  type SessionResolved,
  type SleepEndingToday,
} from '../types/inputs';
import { coverageOf, weakestResolution, type ChannelCoverage, type ExposureChannel } from '@/lib/bodyContracts';
import { ATWATER, DEFAULTS, MEAL_GRAM_ROUNDING_G, PROTEIN_QUALITY, RT_PRESETS, RT_STYLE_MET, timeToPeakH } from './defaults';
import { activityReference } from './activityReference';
import { DOCUMENTED_CYCLE_MET } from './resolveProfile';
import { habitualStepsReference } from '../model/activity';

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
  d.unallocatedKcal = 0;
  d.energyStatus = undefined;

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
  // carbohydrate composition per gram for meals with reported energy (D6-02): the day's mixture, or the default sugar
  // mixture when the template resolves to no carbohydrate (same defaults as above)
  const sugarsPerCarb = c > 0 ? sugars / c : (m.sugarsShare ?? Math.min(1, DEFAULTS.habitualSugarsG[profile.sex] / Math.max(1, profile.habitualCarbG)));
  placeMeals(d, pq, notes, keepMealClocks, sugarsPerCarb);
  // sodium follows the food when the template does not set it (the habitual sodium density per kcal; A1 request
  // 2026-09-30: overfeeding brings its sodium, 15 §4.7 S_na); set before the exercise carbohydrate is added
  if (t.hydration?.sodiumG === undefined && profile.tdee0Kcal > 0) d.sodiumMg = (profile.habitualSodiumMg * d.energyKcal) / profile.tdee0Kcal;
  addExerciseCarbs(d, notes);
}

/**
 * Review M8: carbohydrate eaten during exercise (sessions' `carbDuringGPerH`) is part of the day's intake — added to
 * carbG, glucoseEqG and energyKcal after meal placement (meals never contain it). Intake absorbs it hourly from
 * `HourInput.exCarbG`. D6-07: a session with a known mixture (`carbDuringFructoseShare`) adds its fructose to fructoseG and
 * only the rest to glucoseEqG; an unknown mixture stays the glucose scenario (flagged by the absent share).
 * Allocation-free.
 */
function addExerciseCarbs(d: DayInput, notes: Note[] | null): void {
  let g = 0;
  let fru = 0;
  for (let i = 0; i < d.nSessions; i++) {
    const s = d.sessions[i]!;
    if (s.carbDuringGPerH > 0 && s.durationMin > 0) {
      const gi = (s.carbDuringGPerH * s.durationMin) / 60;
      g += gi;
      fru += gi * exerciseFructoseShare(s);
    }
  }
  d.exerciseCarbG = g;
  if (g <= 0) return;
  d.carbG += g;
  d.fructoseG += fru;
  d.glucoseEqG += g - fru;
  d.energyKcal += ATWATER.carb * g;
  if (notes) notes.push({ day: d.day, code: 'carbsDuringExerciseAdded', message: `${Math.round(g)} g carbohydrate eaten during exercise added to the day's intake` });
}

/** Known fructose share of a session's during-exercise carbohydrate (D6-07); 0 = unknown mixture (glucose scenario). */
function exerciseFructoseShare(s: SessionResolved): number {
  const f = s.carbDuringFructoseShare;
  return f !== undefined && Number.isFinite(f) && f > 0 ? Math.min(1, f) : 0;
}

/**
 * D6-07: fructose share of a during-session feeding mixture (g/h by component) when it is fully known — fructose stated, no
 * unknown remainder, and the stated components account for the session's g/h (±5 %, label rounding). Otherwise undefined:
 * the mixture is unknown, never assumed to be pure glucose by the record.
 */
export function knownFructoseShare(comp: CarbComposition | undefined, gPerH: number): number | undefined {
  if (!comp || !(gPerH > 0)) return undefined;
  const fru = comp.fructoseG;
  if (fru === undefined || !Number.isFinite(fru) || fru < 0) return undefined;
  if (comp.unknownG !== undefined && comp.unknownG > 0) return undefined;
  const known = (comp.glucoseEqG ?? 0) + fru + (comp.galactoseG ?? 0);
  if (!(Math.abs(known - gPerH) <= 0.05 * gPerH)) return undefined;
  return Math.min(1, fru / gPerH);
}

/**
 * D6-07: apply an intake event's stated carbohydrate mixture to a placed meal (allocation-free). Stated components are kept
 * (scaled to the meal's carbohydrate if they exceed it); the unexplained remainder — including a stated `unknownG` — is
 * simulated at the day's default fructose share as a scenario and recorded as `carbUnknownMixG`. Returns the change of the
 * meal's fructose, galactose and glucose grams through `delta` so the day totals can follow.
 */
function applyCarbComposition(meal: MealResolved, comp: CarbComposition, defaultFructoseShare: number, delta: Float64Array): void {
  const c = meal.carbG > 0 ? meal.carbG : 0;
  const g0 = meal.glucoseEqG;
  const f0 = meal.fructoseG;
  const ga0 = meal.galactoseG;
  const nz = (x: number | undefined): number => (x !== undefined && Number.isFinite(x) && x > 0 ? x : 0);
  let glc = nz(comp.glucoseEqG);
  let fru = nz(comp.fructoseG);
  let gal = nz(comp.galactoseG);
  const known = glc + fru + gal;
  if (known > c && known > 0) {
    const k = c / known;
    glc *= k;
    fru *= k;
    gal *= k;
  }
  const unknown = Math.max(0, c - (glc + fru + gal));
  const fShare = Math.min(1, Math.max(0, defaultFructoseShare));
  meal.fructoseG = fru + unknown * fShare;
  meal.galactoseG = gal;
  meal.glucoseEqG = Math.max(0, c - meal.fructoseG - meal.galactoseG);
  meal.carbUnknownMixG = unknown;
  delta[0] = delta[0]! + (meal.fructoseG - f0);
  delta[1] = delta[1]! + (meal.galactoseG - ga0);
  delta[2] = delta[2]! + (meal.glucoseEqG - g0);
}

const COMP_DELTA = new Float64Array(3);

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
  d.unallocatedKcal = 0;
  d.energyStatus = undefined;
  // a zero-intake day is a confirmed zero of every nutrient (nothing unknown)
  d.nutrientUnknownMask = 0;
}

// ---------------------------------------------------------------- nutrient knowledge (A1-014, allocation-free)

type MutableMask = { -readonly [K in MealNutrientKey]: MealNutrientMask[K] };
type Knowledge = MealNutrientMask[MealNutrientKey];

/** The nutrients whose knowledge each meal carries, in a fixed order (no `Object.keys` in the hot path). */
const NUTRIENT_KEYS: readonly MealNutrientKey[] = ['protein', 'carbohydrate', 'fat', 'fibre', 'ethanol'];

/** A fresh all-known mask (one per preallocated meal, rewritten in place by every resolution). */
function knownMask(): MealNutrientMask {
  return { protein: 'known', carbohydrate: 'known', fat: 'known', fibre: 'known', ethanol: 'known' };
}

/** Write a meal's nutrient knowledge in place (the meal owns its mask object; allocation-free). */
function setMask(meal: MealResolved, p: Knowledge, c: Knowledge, f: Knowledge, fib: Knowledge, alc: Knowledge): void {
  let m = meal.nutrientMask as MutableMask | undefined;
  if (!m) {
    m = knownMask() as MutableMask;
    meal.nutrientMask = m;
  }
  m.protein = p;
  m.carbohydrate = c;
  m.fat = f;
  m.fibre = fib;
  m.ethanol = alc;
}

/**
 * Unknown-nutrient bits of one meal (`NUTRIENT_UNKNOWN_BIT`; 'imputed' is not analysed either). A meal without a mask is
 * read conservatively: a reported-energy meal's absent analysis cannot be proven, so every nutrient whose gram number is
 * 0 counts as unknown (an adapter for meals built before masks; never a known zero inferred from the compatibility 0).
 */
export function mealUnknownBits(meal: MealResolved): number {
  const m = meal.nutrientMask;
  if (!m) {
    if (meal.reportedKcal === undefined) return 0;
    let bits = 0;
    if (!(meal.proteinG > 0)) bits |= NUTRIENT_UNKNOWN_BIT.protein;
    if (!(meal.carbG > 0)) bits |= NUTRIENT_UNKNOWN_BIT.carbohydrate;
    if (!(meal.fatG > 0)) bits |= NUTRIENT_UNKNOWN_BIT.fat;
    if (!(meal.fibreG > 0)) bits |= NUTRIENT_UNKNOWN_BIT.fibre;
    if (!(meal.alcoholG > 0)) bits |= NUTRIENT_UNKNOWN_BIT.ethanol;
    return bits;
  }
  let bits = 0;
  for (let i = 0; i < NUTRIENT_KEYS.length; i++) {
    const k = NUTRIENT_KEYS[i]!;
    if (m[k] !== 'known') bits |= NUTRIENT_UNKNOWN_BIT[k];
  }
  return bits;
}

/** A meal that is part of the day's intake (not emptied by a fast, not an empty slot). */
const includedMeal = (m: MealResolved): boolean => m.kcal > 0 || m.alcoholG > 0;

/** D6-02/A1-014: the day's unknown-nutrient bits = the union over its included meals (allocation-free). */
function refreshNutrientMask(d: DayInput): void {
  let bits = 0;
  if (!d.zeroIntake) for (let i = 0; i < d.nMeals; i++) if (includedMeal(d.meals[i]!)) bits |= mealUnknownBits(d.meals[i]!);
  d.nutrientUnknownMask = bits;
}

/** Total polyol grams of a meal (all identities); 0 when it carries none. Allocation-free (`for…in`). */
function mealPolyolG(m: MealResolved): number {
  const p = m.polyolsG;
  if (!p) return 0;
  let s = 0;
  for (const k in p) {
    const v = p[k]!;
    if (Number.isFinite(v) && v > 0) s += v;
  }
  return s;
}

/** The day's polyol grams by identity over its kept meals (A1-031), or undefined when none (compile time). */
function dayPolyols(d: DayInput): Record<string, number> | undefined {
  if (d.zeroIntake) return undefined;
  let out: Record<string, number> | undefined;
  for (let i = 0; i < d.nMeals; i++) {
    const m = d.meals[i]!;
    if (!m.polyolsG || !includedMeal(m)) continue;
    for (const [k, v] of Object.entries(m.polyolsG)) {
      if (!(Number.isFinite(v) && v > 0)) continue;
      out ??= {};
      out[k] = (out[k] ?? 0) + v;
    }
  }
  return out;
}

/** Polyol identities of a meal spec with positive finite grams (A1-031), or undefined (compile time). */
function polyolsOf(spec: MealSpec | undefined): Readonly<Record<string, number>> | undefined {
  const p = spec?.polyolsG;
  if (!p) return undefined;
  for (const k in p) if (Number.isFinite(p[k]!) && p[k]! > 0) return p;
  return undefined;
}

function splitWeight(split: MealSplit, i: number, n: number): number {
  if (split === 'biggerLast') return i + 1;
  if (split === 'biggerFirst') return n - i;
  return 1;
}

/** A known, non-negative gram amount (D6-02: an absent or invalid macro is unknown, never a measured zero). */
function knownG(v: number | undefined): v is number {
  return v !== undefined && Number.isFinite(v) && v >= 0;
}

/**
 * Knowledge of one reported nutrient (A1-014): the producer's explicit statement when it gives one, else the presence of a
 * valid gram number ('known', an explicit 0 included) or its absence ('unknown'). An 'unknown' statement over a number makes
 * the number a compatibility value (never a known amount); 'imputed' is a named scenario fill (simulated, not analysed).
 */
function reportedKnowledge(v: number | undefined, stated: 'known' | 'imputed' | 'unknown' | undefined): Knowledge {
  if (stated === 'unknown') return 'unknown';
  if (!knownG(v)) return 'unknown';
  return stated === 'imputed' ? 'imputed' : 'known';
}

/**
 * One meal with reported metabolizable energy (D6-02, C3): known grams only (unknown macros contribute 0 known grams and
 * no named substrate), carbohydrate mixture and saturated/viscous shares per gram from the day, no undeclared MCT. The
 * convention energy of the known grams E_k = 4P + 4C + 9F + 2·fibre + 7·ethanol is reconciled once against the report E:
 * R = E − E_k > rounding → `energyOnly`, R kept as unallocated energy; |R| within the gram-rounding tolerance →
 * `consistent`; R below −tolerance → `conflict`. A1-025: in every case the meal's energy is the reported E (the energy the
 * run ingests, hour by hour): the known grams stay the record and are simulated, and the signed R is an energy-only
 * correction (intake never makes an hour negative), so an incompatible gram allocation never supplies energy the report does
 * not contain; the conflict status stays (the run marks the allocation-dependent outputs for review). A provider verdict
 * `reconciliation` (a source record's residual, either sign) is the same arithmetic without a conflict. A1-014: the meal's
 * nutrient knowledge is written to its mask (absent analysis unknown, explicit 0 known). A1-029: an observed meal keeps its
 * known ethanol whatever standalone drinks the day lists (`keepEthanol`); a prospective day's drink budget sits in its
 * substances. Never scaled by a refeed ramp. Allocation-free.
 */
function reportedMeal(
  meal: MealResolved,
  ex: MealSpec['macros'],
  knowledge: MealSpec['nutrientKnowledge'],
  eRep: number,
  residual: MealSpec['energyResidual'],
  keepEthanol: boolean,
  sugarsPerCarb: number,
  fructoseShare: number,
  satPerFat: number,
  viscousPerFibre: number,
  day: number,
  notes: Note[] | null,
): void {
  const kP = reportedKnowledge(ex?.proteinG, knowledge?.protein);
  const kC = reportedKnowledge(ex?.carbG, knowledge?.carbohydrate);
  const kF = reportedKnowledge(ex?.fatG, knowledge?.fat);
  const kFib = reportedKnowledge(ex?.fibreG, knowledge?.fibre);
  let kA = reportedKnowledge(ex?.alcoholG, knowledge?.ethanol);
  const pK = kP !== 'unknown';
  const cK = kC !== 'unknown';
  const fK = kF !== 'unknown';
  const fibK = kFib !== 'unknown';
  let aK = kA !== 'unknown';
  // a prospective (planned) day budgets its drinks as substances: a meal's ethanol is that budget, counted there once
  if (aK && !keepEthanol) {
    aK = false;
    kA = 'known';
  }
  meal.proteinG = pK ? ex!.proteinG! : 0;
  meal.carbG = cK ? ex!.carbG! : 0;
  meal.fatG = fK ? ex!.fatG! : 0;
  meal.fibreG = fibK ? ex!.fibreG! : 0;
  meal.alcoholG = aK ? ex!.alcoholG! : 0;
  setMask(meal, kP, kC, kF, kFib, kA);
  meal.fructoseG = meal.carbG * sugarsPerCarb * fructoseShare;
  meal.galactoseG = 0;
  meal.glucoseEqG = Math.max(0, meal.carbG - meal.fructoseG - meal.galactoseG);
  meal.satFatG = meal.fatG * satPerFat;
  meal.mctG = 0;
  meal.viscousFibreG = meal.fibreG * viscousPerFibre;
  const knownKcal =
    ATWATER.protein * meal.proteinG + ATWATER.carb * meal.carbG + ATWATER.fat * meal.fatG + ATWATER.fibre * meal.fibreG + ATWATER.alcohol * meal.alcoholG;
  const tol =
    MEAL_GRAM_ROUNDING_G *
    ((pK ? ATWATER.protein : 0) + (cK ? ATWATER.carb : 0) + (fK ? ATWATER.fat : 0) + (fibK ? ATWATER.fibre : 0) + (aK ? ATWATER.alcohol : 0));
  const r = eRep - knownKcal;
  meal.reportedKcal = eRep;
  // A1-025: the reported ME is the meal's energy for every status; the signed residual is the energy-only correction
  meal.kcal = eRep;
  meal.unallocatedKcal = r;
  if (residual === 'reconciliation') {
    // the provider's source reconciliation (W0-food): unknown macros still make the meal energy-only
    meal.energyStatus = pK && cK && fK ? 'consistent' : 'energyOnly';
  } else if (r > tol) {
    meal.energyStatus = 'energyOnly';
    if (notes) notes.push({ day, code: 'energyOnlyMeal', message: `meal at ${clockText(meal.clockH)}: ${Math.round(r)} of ${Math.round(eRep)} kcal without known macros, kept as energy` });
  } else if (r >= -tol) {
    meal.energyStatus = 'consistent';
  } else {
    meal.energyStatus = 'conflict';
    if (notes)
      notes.push({
        day,
        code: 'mealEnergyConflict',
        message: `meal at ${clockText(meal.clockH)}: known macros give ${Math.round(knownKcal)} kcal, reported ${Math.round(eRep)} kcal (the reported energy is kept)`,
      });
  }
}

function clockText(h: number): string {
  const m = Math.round(h * 60);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(((m % 60) + 60) % 60).padStart(2, '0')}`;
}

const ENERGY_STATUS_RANK = { consistent: 0, energyOnly: 1, conflict: 2 } as const;

/**
 * Place meals and distribute the day's grams. Explicit `meals` win over the window shorthand. `keepClocks` (runtime
 * re-resolution) keeps the clock times set at compile time; meals dropped by a planned fast (`mealDropMask`) are dropped again.
 * A day with any reported-energy meal (D6-02) takes its totals from its meals (the meals are the record).
 */
function placeMeals(d: DayInput, pq: { qMeal: number; speed: number }, notes: Note[] | null, keepClocks: boolean, sugarsPerCarb: number): void {
  const t = d.template;
  const mp = t.meals ?? {};
  // an empty explicit list is no list (the window shorthand places the day's meals; it never reads a missing spec)
  const explicit = mp.meals && mp.meals.length > 0 ? mp.meals : undefined;
  let n: number;
  if (explicit) n = Math.min(explicit.length, MAX_MEALS);
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
  const fructoseShare = t.macros.fructoseShareOfSugars ?? DEFAULTS.fructoseShareOfSugars;
  const satPerFat = t.macros.fatTypes?.satShare ?? DEFAULTS.satShare;
  const viscousPerFibre = t.macros.viscousFibreShare ?? DEFAULTS.viscousFibreShare;
  // A1-014: on a logged day (or one with reported meals) the template's macro totals are not a statement about any meal, so
  // a gram filled from them is a named scenario fill ('imputed'), never known analysis
  const observedDay = t.observed !== undefined;
  let dayHasReported = false;
  if (explicit)
    for (let i = 0; i < n; i++) {
      const e = explicit[i]!.energyKcal;
      if (e !== undefined && Number.isFinite(e) && e >= 0) {
        dayHasReported = true;
        break;
      }
    }
  const fillIsScenario = dayHasReported || observedDay;
  let anyReported = false;
  let anyComposition = false;
  COMP_DELTA.fill(0);
  let dayStatus = -1;
  for (let i = 0; i < n; i++) {
    const meal = d.meals[i]!;
    const share = wSum > 0 ? meal.kcal / wSum : 1 / n;
    const spec = explicit ? explicit[i]! : undefined;
    if (!keepClocks) meal.clockH = spec ? spec.clockH : n === 1 ? start : start + (len * i) / (n - 1);
    const ex = spec?.macros;
    meal.eventId = spec?.eventId;
    const eRep = spec?.energyKcal;
    meal.polyolsG = polyolsOf(spec);
    if (eRep !== undefined && Number.isFinite(eRep) && eRep >= 0) {
      // A1-029: an observed meal (a logged event or a logged day) keeps its known ethanol whatever drinks the day lists
      const keepEthanol = alcHours === undefined || spec?.eventId !== undefined || observedDay;
      reportedMeal(meal, ex, spec?.nutrientKnowledge, eRep, spec?.energyResidual, keepEthanol, sugarsPerCarb, fructoseShare, satPerFat, viscousPerFibre, d.day, notes);
      anyReported = true;
      const rank = ENERGY_STATUS_RANK[meal.energyStatus!];
      if (rank > dayStatus) dayStatus = rank;
    } else {
      meal.reportedKcal = undefined;
      meal.unallocatedKcal = 0;
      meal.energyStatus = undefined;
      meal.proteinG = ex?.proteinG ?? d.proteinG * share;
      meal.carbG = ex?.carbG ?? d.carbG * share;
      meal.fatG = ex?.fatG ?? d.fatG * share;
      meal.fibreG = ex?.fibreG ?? d.fibreG * share;
      meal.alcoholG = alcHours ? 0 : (ex?.alcoholG ?? 0);
      const kn = spec?.nutrientKnowledge;
      setMask(
        meal,
        fillKnowledge(ex?.proteinG, kn?.protein, fillIsScenario),
        fillKnowledge(ex?.carbG, kn?.carbohydrate, fillIsScenario),
        fillKnowledge(ex?.fatG, kn?.fat, fillIsScenario),
        fillKnowledge(ex?.fibreG, kn?.fibre, fillIsScenario),
        // a prospective drink budget sits in the substances; otherwise absent ethanol on a logged meal is not analysed
        alcHours ? 'known' : (kn?.ethanol ?? (knownG(ex?.alcoholG) || !fillIsScenario ? 'known' : 'unknown')),
      );
      const cf = d.carbG > 0 ? meal.carbG / d.carbG : 0;
      meal.fructoseG = d.fructoseG * cf;
      meal.galactoseG = d.galactoseG * cf;
      meal.glucoseEqG = Math.max(0, meal.carbG - meal.fructoseG - meal.galactoseG);
      const ff = d.fatG > 0 ? meal.fatG / d.fatG : 0;
      meal.satFatG = d.satFatG * ff;
      meal.mctG = d.mctG * ff;
      meal.viscousFibreG = d.fibreG > 0 ? (d.viscousFibreG * meal.fibreG) / d.fibreG : 0;
      meal.kcal =
        ATWATER.protein * meal.proteinG +
        ATWATER.carb * meal.carbG +
        ATWATER.fat * meal.fatG -
        (ATWATER.fat - ATWATER.mct) * meal.mctG +
        ATWATER.fibre * meal.fibreG +
        ATWATER.alcohol * meal.alcoholG;
    }
    // D6-07: event-specific carbohydrate mixture, intake duration and physical form travel with the meal
    meal.intakeDurationH = spec?.intakeDurationH !== undefined && Number.isFinite(spec.intakeDurationH) && spec.intakeDurationH >= 0 ? spec.intakeDurationH : undefined;
    meal.form = spec?.form;
    meal.carbUnknownMixG = undefined;
    if (spec?.carbComposition) {
      const share = d.sugarsG > 0 && d.carbG > 0 ? (d.fructoseG / d.carbG) : sugarsPerCarb * fructoseShare;
      applyCarbComposition(meal, spec.carbComposition, share, COMP_DELTA);
      anyComposition = true;
    }
    const src = spec?.proteinSource;
    const q = src ? PROTEIN_QUALITY[src] : pq;
    meal.proteinQDaily = q === pq ? d.proteinQDaily : (q as { qDaily: number }).qDaily;
    meal.proteinQMeal = q.qMeal;
    meal.proteinSpeed = q.speed;
    meal.glycaemicIndex = t.food?.glycaemicIndex ?? DEFAULTS.glycaemicIndex;
    meal.timeToPeakH = timeToPeakH(meal.glycaemicIndex, meal.carbG, meal.fatG);
  }
  d.nMeals = n;
  if (anyReported) dayTotalsFromMeals(d, alcHours !== undefined, sugarsPerCarb, dayStatus);
  else if (anyComposition) {
    // D6-07: the day's mixture follows the meals' stated mixtures (prescribed days keep their template totals otherwise)
    d.fructoseG = Math.max(0, d.fructoseG + COMP_DELTA[0]!);
    d.galactoseG = Math.max(0, d.galactoseG + COMP_DELTA[1]!);
    d.glucoseEqG = Math.max(0, d.glucoseEqG + COMP_DELTA[2]!);
  }
  if (d.mealDropMask) applyMealDrops(d);
  refreshNutrientMask(d);
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
 * Knowledge of a non-reported meal's nutrient (A1-014): the producer's statement, else a stated gram ('known'), else the
 * template's construction — known by construction on a prescribed day, a scenario fill ('imputed') on a logged day.
 */
function fillKnowledge(v: number | undefined, stated: Knowledge | undefined, scenario: boolean): Knowledge {
  if (stated !== undefined) return stated;
  return knownG(v) || !scenario ? 'known' : 'imputed';
}

/**
 * A1-029: whether drink entry `eventId` is the same logged event as one of the day's kept meals carrying ethanol (an
 * explicit canonical-event identity: the drink entry carries the meal's event id). Equal times or amounts never link two
 * entries. Allocation-free.
 */
function sameEventMeal(d: DayInput, eventId: string | undefined): boolean {
  if (eventId === undefined || eventId === '') return false;
  for (let i = 0; i < d.nMeals; i++) {
    const m = d.meals[i]!;
    if (m.eventId === eventId && m.alcoholG > 0 && includedMeal(m)) return true;
  }
  return false;
}

/** Ethanol of the day's standalone drink entries, g, except those linked to a kept meal of the same event (A1-029). */
function unlinkedDrinkEthanolG(d: DayInput): number {
  const alc = d.template.substances?.alcohol;
  if (!alc) return 0;
  let g = 0;
  for (let i = 0; i < alc.length; i++) {
    const a = alc[i]!;
    if (!(a.drinks > 0) || sameEventMeal(d, a.eventId)) continue;
    g += a.drinks * DEFAULTS.gramsPerDrink;
  }
  return g;
}

/**
 * D6-02: the totals of a day with reported-energy meals are the sums of its meals (unallocated energy included in
 * `energyKcal`, alcohol from `substances` added once). Fat-type and sugar shares follow the summed grams; EPA+DHA and
 * cholesterol stay day-level. A1-029: the day's ethanol is the meals' kept ethanol plus every standalone drink not linked
 * to one of them by event identity (each at its own amount and energy). Allocation-free.
 */
function dayTotalsFromMeals(d: DayInput, alcInSubstances: boolean, sugarsPerCarb: number, statusRank: number): void {
  let p = 0, c = 0, ge = 0, fr = 0, ga = 0, f = 0, sf = 0, mct = 0, fib = 0, vf = 0, alc = 0, kcal = 0, un = 0;
  for (let i = 0; i < d.nMeals; i++) {
    const m = d.meals[i]!;
    p += m.proteinG; c += m.carbG; ge += m.glucoseEqG; fr += m.fructoseG; ga += m.galactoseG; f += m.fatG; sf += m.satFatG;
    mct += m.mctG; fib += m.fibreG; vf += m.viscousFibreG; alc += m.alcoholG; kcal += m.kcal; un += m.unallocatedKcal ?? 0;
  }
  const ft = d.template.macros.fatTypes;
  d.proteinG = p; d.carbG = c; d.glucoseEqG = ge; d.fructoseG = fr; d.galactoseG = ga; d.fatG = f; d.satFatG = sf; d.mctG = mct;
  d.fibreG = fib; d.viscousFibreG = vf;
  const drinks = alcInSubstances ? unlinkedDrinkEthanolG(d) : 0;
  d.alcoholG = alc + drinks;
  d.mufaG = f * (ft?.mufaShare ?? DEFAULTS.mufaShare);
  d.pufaG = f * (ft?.pufaShare ?? DEFAULTS.pufaShare);
  d.sugarsG = c * sugarsPerCarb;
  d.unallocatedKcal = un;
  d.energyKcal = kcal + ATWATER.alcohol * drinks;
  d.energyStatus = statusRank >= 2 ? 'conflict' : statusRank === 1 ? 'energyOnly' : 'consistent';
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
    if ((m.unallocatedKcal ?? 0) !== 0) d.unallocatedKcal = (d.unallocatedKcal ?? 0) - m.unallocatedKcal!;
    m.proteinG = 0; m.carbG = 0; m.glucoseEqG = 0; m.fructoseG = 0; m.galactoseG = 0; m.fatG = 0; m.satFatG = 0; m.mctG = 0;
    m.fibreG = 0; m.viscousFibreG = 0; m.alcoholG = 0; m.kcal = 0; m.unallocatedKcal = 0;
  }
  if (Math.abs(d.unallocatedKcal ?? 0) < 1e-9) d.unallocatedKcal = 0;
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
  // A1-014: a dropped meal no longer contributes knowledge (its unknown analysis leaves with it)
  refreshNutrientMask(d);
}

// ---------------------------------------------------------------- allocation helpers (compile time only)

function newMeal(): MealResolved {
  return {
    clockH: 0, proteinG: 0, carbG: 0, glucoseEqG: 0, fructoseG: 0, galactoseG: 0, fatG: 0, satFatG: 0, mctG: 0,
    fibreG: 0, viscousFibreG: 0, alcoholG: 0, kcal: 0, proteinQDaily: 1, proteinQMeal: 1, proteinSpeed: 1,
    glycaemicIndex: DEFAULTS.glycaemicIndex, timeToPeakH: 1,
    unallocatedKcal: 0, reportedKcal: undefined, energyStatus: undefined, eventId: undefined,
    carbUnknownMixG: undefined, intakeDurationH: undefined, form: undefined,
    nutrientMask: knownMask(), polyolsG: undefined,
  };
}

function newSession(): SessionResolved {
  return {
    kind: 'cardio', startH: 0, durationMin: 0, modality: 0, intensityFrac: Number.NaN, met: Number.NaN,
    speedKmh: Number.NaN, powerW: Number.NaN, rpe: Number.NaN, setsByRegion: new Float64Array(N_REGIONS), rir: DEFAULTS.rtRir,
    loadPct1RM: DEFAULTS.rtLoadPct1RM, restSec: DEFAULTS.rtRestSec, toFailure: false, carbDuringGPerH: 0, coldWaterImmersion: false,
    sessionId: undefined, groupStart: 0, groupCount: 0, realisedGrossKcal: undefined,
    phases: undefined, healthIntensityClass: undefined, carbDuringFructoseShare: undefined, stepsIncluded: undefined,
    boutKey: undefined, boutEndH: undefined, boutDurationMin: undefined, healthClassSource: undefined, rpeScale: undefined, doseStatus: undefined, unknownDoseScenario: undefined,
  };
}

/**
 * One resistance set group at compile time (D3-01): physical sets, per-set region weights, contraction type, whether the
 * weights already include the type factor, load %1RM / RIR / rest s (NaN = unknown), absolute clock start (h, may exceed
 * 24) and duration (min). `explicit` = from `ResistanceSession.groups` (else the legacy merged dose of a whole session).
 */
interface GroupSpec {
  session: number;
  explicit: boolean;
  sets: number;
  w: Float64Array;
  contraction: ContractionType;
  typeFactorIncluded: boolean;
  load: number;
  rir: number;
  rest: number;
  startH: number;
  durationMin: number;
  assumed: number;
  /** A1-022: 1 when the set count itself is unknown (the named scenario stands in for it), its scenario and field provenance. */
  setsUnknown: number;
  unknownDoseScenario: UnknownDoseScenario | undefined;
  provenance: ResistanceSetGroup['provenance'] | undefined;
}

const finiteOr = (v: number | undefined, fallback: number): number => (v !== undefined && Number.isFinite(v) ? v : fallback);

/**
 * Explicit set groups of a session (D3-01). A group without its own timing spans the whole bout (its sets follow the
 * session's timing, nothing is fabricated); a group without a load/RIR/rest inherits the session's reported value, else it
 * stays unknown (NaN, `assumed` 1). Zero-set groups are skipped. Compile time only.
 */
function explicitGroupSpecs(r: ResistanceSession, session: number, startH: number, durationMin: number): GroupSpec[] {
  const out: GroupSpec[] = [];
  for (const g of r.groups ?? []) {
    const sets = finiteOr(g.sets, 0);
    if (!(sets > 0)) continue;
    const w = new Float64Array(N_REGIONS);
    for (let k = 0; k < N_REGIONS; k++) {
      const v = g.regionWeights[TRAINING_REGIONS[k] as TrainingRegion];
      w[k] = v !== undefined && Number.isFinite(v) && v > 0 ? v : 0;
    }
    const load = finiteOr(g.loadPct1RM, finiteOr(r.loadPct1RM, Number.NaN));
    const rir = finiteOr(g.rir, finiteOr(r.rir, Number.NaN));
    const rest = finiteOr(g.restSec, finiteOr(r.restSec, Number.NaN));
    const off = g.startOffsetMin !== undefined && Number.isFinite(g.startOffsetMin) ? Math.max(0, g.startOffsetMin) : undefined;
    const dur =
      g.durationMin !== undefined && Number.isFinite(g.durationMin) && g.durationMin >= 0 ? g.durationMin : off !== undefined ? Math.max(0, durationMin - off) : durationMin;
    const prov = g.provenance;
    const provAssumed = prov !== undefined && Object.values(prov).some((p) => p !== undefined && p !== 'reported');
    // A1-022: an unknown set count (a minutes-only record) is not an ordinary inferred field: it stays named as such
    const setsUnknown = prov?.sets === 'unknown' || r.doseStatus === 'unknown';
    out.push({
      session,
      explicit: true,
      sets,
      w,
      contraction: g.contraction ?? 'dynamic',
      typeFactorIncluded: g.typeFactorIncluded === true,
      load,
      rir,
      rest,
      startH: startH + (off ?? 0) / 60,
      durationMin: dur,
      assumed: provAssumed || setsUnknown || !Number.isFinite(load) || !Number.isFinite(rir) || !Number.isFinite(rest) ? 1 : 0,
      setsUnknown: setsUnknown ? 1 : 0,
      unknownDoseScenario: setsUnknown ? (r.unknownDoseScenario ?? 'legacyMinuteConversion') : undefined,
      provenance: prov !== undefined ? { ...prov, ...(setsUnknown ? { sets: 'unknown' as DoseFieldProvenance } : {}) } : setsUnknown ? { sets: 'unknown' } : undefined,
    });
  }
  return out;
}

/**
 * The legacy merged dose of a resolved resistance session as one homogeneous group (D3-01 migration): sets = the legacy
 * total (Σ region weights, as the legacy hour path counts them), per-set weights = setsByRegion/total, the session's
 * resolved effort fields (existing defaults) and timing, `typeFactorIncluded` unless the session says otherwise (catalogue
 * counts include the set-type factor), `assumed` 1 (legacy merged provenance, never recovered detail).
 */
function legacyGroupSpec(s: SessionResolved, session: number, includesTypeFactor: boolean | undefined): GroupSpec | null {
  let total = 0;
  for (let k = 0; k < N_REGIONS; k++) total += s.setsByRegion[k]!;
  if (!(total > 0)) return null;
  const w = new Float64Array(N_REGIONS);
  for (let k = 0; k < N_REGIONS; k++) w[k] = s.setsByRegion[k]! / total;
  return {
    session,
    explicit: false,
    sets: total,
    w,
    contraction: 'dynamic',
    typeFactorIncluded: includesTypeFactor !== false,
    load: s.loadPct1RM,
    rir: s.rir,
    rest: s.restSec,
    startH: s.startH,
    durationMin: s.durationMin,
    assumed: 1,
    setsUnknown: s.doseStatus === 'unknown' ? 1 : 0,
    unknownDoseScenario: s.doseStatus === 'unknown' ? (s.unknownDoseScenario ?? 'legacyMinuteConversion') : undefined,
    provenance: s.doseStatus === 'unknown' ? { sets: 'unknown' } : undefined,
  };
}

/** Resolve the day's sessions; returns the compile-time set-group specs of its resistance sessions (D3-01). */
function resolveSessions(d: DayInput, tmpl: DayTemplate, notes: Note[]): GroupSpec[] {
  const ex = tmpl.exercise ?? [];
  if (ex.length > MAX_SESSIONS) notes.push({ day: d.day, code: 'sessionsTruncated', message: `only ${MAX_SESSIONS} sessions per day are simulated` });
  const n = Math.min(ex.length, MAX_SESSIONS);
  const specs: GroupSpec[] = [];
  for (let i = 0; i < n; i++) {
    const src = ex[i]!;
    const s = d.sessions[i]!;
    s.startH = src.startH;
    s.setsByRegion.fill(0);
    s.sessionId = src.sessionId;
    s.groupStart = 0;
    s.groupCount = 0;
    // A1-020: the physical-bout key (explicit bout id, else the session id, else origin day + session index)
    s.boutKey = boutKeyOf({ ...(src.boutId !== undefined ? { boutId: src.boutId } : {}), ...(src.sessionId !== undefined ? { sessionId: src.sessionId } : {}) }, d.day, i);
    // (r063) one moving part of a paused bout: EPOC's duration factor reads the whole bout's moving minutes
    s.boutDurationMin = src.boutDurationMin !== undefined && Number.isFinite(src.boutDurationMin) && src.boutDurationMin > 0 ? src.boutDurationMin : undefined;
    s.doseStatus = undefined;
    s.unknownDoseScenario = undefined;
    s.rpeScale = undefined;
    s.healthClassSource = undefined;
    // SPEC V1.5: an approved bout's chosen gross energy (booked first by the activity module)
    // (0.6.3) an explicit 0 (the machine showed 0) is kept: replay books no energy above rest, never a default estimate
    s.realisedGrossKcal = src.realisedGrossKcal !== undefined && Number.isFinite(src.realisedGrossKcal) && src.realisedGrossKcal >= 0 ? src.realisedGrossKcal : undefined;
    if (src.kind === 'resistance' && src.groups && src.groups.length > 0) {
      const r = src as ResistanceSession;
      s.kind = 'resistance';
      s.modality = 0;
      // the bout's duration: as entered, else the physical sets at the default minutes per set (never the region-weight sum),
      // at least long enough for every group with its own timing
      let phys = 0;
      let lastEnd = 0;
      for (const g of r.groups!) {
        const sets = finiteOr(g.sets, 0);
        if (sets > 0) phys += sets;
        if (g.startOffsetMin !== undefined && g.durationMin !== undefined && Number.isFinite(g.startOffsetMin + g.durationMin))
          lastEnd = Math.max(lastEnd, g.startOffsetMin + g.durationMin);
      }
      s.durationMin = r.durationMin ?? Math.max(phys * DEFAULTS.rtMinPerSet, lastEnd);
      s.met = r.met !== undefined && Number.isFinite(r.met) && r.met > 0 ? r.met : RT_STYLE_MET[r.style ?? 'general'];
      s.intensityFrac = Number.NaN;
      const groups = explicitGroupSpecs(r, i, s.startH, s.durationMin);
      // A1-022: the session's hard-set dose status (unknown when stated, or when every counted group's set count is unknown)
      const allUnknown = groups.length > 0 && groups.every((g) => g.setsUnknown === 1);
      s.doseStatus = r.doseStatus ?? (allUnknown ? 'unknown' : undefined);
      if (s.doseStatus === 'unknown') s.unknownDoseScenario = r.unknownDoseScenario ?? 'legacyMinuteConversion';
      if (groups.some((g) => g.setsUnknown === 1))
        notes.push({ day: d.day, code: 'unknownDoseScenario', message: `resistance at ${clockText(s.startH)}: hard-set count unknown, simulated as the named minute-conversion scenario` });
      // legacy per-session fields for the consumers of the merged hour arrays: region-weighted physical sets (raw, the
      // weights as given) and set-weighted means of the known effort fields (defaults where none is known)
      let sRir = 0, nRir = 0, sLoad = 0, nLoad = 0, sRest = 0, nRest = 0;
      for (const g of groups) {
        for (let k = 0; k < N_REGIONS; k++) s.setsByRegion[k] = s.setsByRegion[k]! + g.sets * g.w[k]!;
        if (Number.isFinite(g.rir)) { sRir += g.sets * g.rir; nRir += g.sets; }
        if (Number.isFinite(g.load)) { sLoad += g.sets * g.load; nLoad += g.sets; }
        if (Number.isFinite(g.rest)) { sRest += g.sets * g.rest; nRest += g.sets; }
      }
      s.rir = nRir > 0 ? sRir / nRir : DEFAULTS.rtRir;
      s.loadPct1RM = nLoad > 0 ? sLoad / nLoad : DEFAULTS.rtLoadPct1RM;
      s.restSec = nRest > 0 ? sRest / nRest : DEFAULTS.rtRestSec;
      s.toFailure = r.toFailure ?? false;
      s.carbDuringGPerH = 0;
      s.coldWaterImmersion = r.coldWaterImmersion ?? false;
      for (const g of groups) specs.push(g);
    } else if (src.kind === 'resistance') {
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
      s.doseStatus = r.doseStatus;
      if (r.doseStatus === 'unknown') {
        s.unknownDoseScenario = r.unknownDoseScenario ?? 'legacyMinuteConversion';
        notes.push({ day: d.day, code: 'unknownDoseScenario', message: `resistance at ${clockText(s.startH)}: hard-set count unknown, simulated as the named minute-conversion scenario` });
      }
      const lg = legacyGroupSpec(s, i, r.setsByRegion ? r.setsByRegionIncludesTypeFactor : undefined);
      if (lg) specs.push(lg);
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
      // D3-03: interval phases (true work/recovery durations and intensities) and the stated public-health class;
      // 'unknown' stays unknown (never zero activity). D6-07: the feeding mixture's known fructose share. D3-07: the
      // locomotor steps this bout contributes to a total-day count.
      // A1-062: the rating's scale identity travels (cr10 stays Borg CR10); a phase inherits only an explicitly declared scale
      s.rpeScale = c.rpeScale;
      s.healthClassSource = c.healthClassSource;
      s.phases = c.phases && c.phases.length > 0 ? phasesWithScale(c.phases, c.rpeScale) : undefined;
      s.healthIntensityClass = c.healthIntensityClass;
      s.carbDuringFructoseShare = knownFructoseShare(c.carbDuringComposition, s.carbDuringGPerH);
      s.stepsIncluded = c.stepsIncluded !== undefined && Number.isFinite(c.stepsIncluded) && c.stepsIncluded >= 0 ? c.stepsIncluded : undefined;
    }
  }
  d.nSessions = n;
  // A1-020: the compiled end of each physical bout (clock h on the session's own day, may exceed 24): the session's interval,
  // or later when one of its groups is timed past it
  for (let i = 0; i < n; i++) {
    const s = d.sessions[i]!;
    let end = s.startH + Math.max(0, s.durationMin) / 60;
    for (const g of specs) if (g.session === i) end = Math.max(end, g.startH + Math.max(0, g.durationMin) / 60);
    s.boutEndH = end;
  }
  return specs;
}

/**
 * A1-062: a cardio session's phases with the scale of their ratings: a phase's own `rpeScale` wins; a phase without one
 * inherits only the session's explicitly declared scale (absent stays absent = unknown). Phases are copied only when one
 * actually inherits (compile time).
 */
function phasesWithScale(phases: readonly IntervalPhase[], scale: IntervalPhase['rpeScale']): readonly IntervalPhase[] {
  if (scale === undefined || !phases.some((p) => p.rpeScale === undefined)) return phases;
  return phases.map((p) => (p.rpeScale === undefined ? { ...p, rpeScale: scale } : p));
}

/** Whether a group's sets run past its day's midnight (part of them is stepped in the next day's hours). */
const crossesMidnight = (g: GroupSpec): boolean => g.startH + Math.max(0, g.durationMin) / 60 > 24 + 1e-9 || g.startH >= 24;

/**
 * D3-01: resolved set groups per day. A day lists groups when one of its sessions has explicit groups or an explicit group
 * of the previous day runs past midnight into it; it then lists EVERY set stepped in its hours — its own sessions' groups
 * (legacy sessions as one merged group, `groupStart`/`groupCount` on the session) followed by copies of the previous day's
 * groups that run past midnight (`session` −1, start shifted by −24 h; each set is stepped once, in the hour it falls in).
 * Other days keep `nRtGroups` 0 (the legacy merged hour path, unchanged). More than MAX_SET_GROUPS_PER_DAY groups: note
 * `setGroupsTruncated` (never silent). Compile time only (allocation allowed).
 */
function buildSetGroups(days: DayInput[], specs: readonly GroupSpec[][], notes: Note[]): void {
  for (let d = 0; d < days.length; d++) {
    const day = days[d]!;
    const own = specs[d] ?? [];
    const prev = d > 0 ? (specs[d - 1] ?? []) : [];
    const carried = prev.filter(crossesMidnight);
    if (!own.some((g) => g.explicit) && !carried.some((g) => g.explicit)) {
      day.nRtGroups = 0;
      continue;
    }
    const list: ResistanceGroupResolved[] = [];
    const toResolved = (g: GroupSpec, session: number, shiftH: number): ResistanceGroupResolved => {
      // the owning bout (this day's session, or the previous day's for a carried copy): its identity and flags travel
      // with the group so a copy carried past midnight keeps them (D3-01)
      const originDay = shiftH === 0 ? d : d - 1;
      const owner = days[originDay]?.sessions[g.session];
      return {
        session,
        sets: g.sets,
        regionWeights: shiftH === 0 ? g.w : g.w.slice(),
        contraction: g.contraction,
        typeFactorIncluded: g.typeFactorIncluded,
        loadPct1RM: g.load,
        rir: g.rir,
        restSec: g.rest,
        startH: g.startH - shiftH,
        durationMin: g.durationMin,
        assumed: g.assumed,
        originDay,
        ...(owner?.sessionId !== undefined ? { sessionId: owner.sessionId } : {}),
        ...(owner && owner.kind === 'resistance' ? { coldWaterImmersion: owner.coldWaterImmersion, toFailure: owner.toFailure } : {}),
        // A1-020: the owning bout's key (identical on a copy carried past midnight) and its compiled end on this day's clock
        boutKey: owner?.boutKey ?? boutKeyOf({}, originDay, g.session),
        boutEndH: (owner?.boutEndH ?? g.startH + Math.max(0, g.durationMin) / 60) - shiftH,
        // A1-022: an unknown set count stays named (scenario + provenance), apart from ordinary inferred fields
        ...(g.setsUnknown === 1 ? { setsUnknown: 1, unknownDoseScenario: g.unknownDoseScenario ?? 'legacyMinuteConversion' } : {}),
        ...(g.provenance !== undefined ? { provenance: { ...g.provenance } } : {}),
      };
    };
    for (let i = 0; i < day.nSessions; i++) {
      const s = day.sessions[i]!;
      if (s.kind !== 'resistance') continue;
      s.groupStart = list.length;
      for (const g of own) if (g.session === i) list.push(toResolved(g, i, 0));
      s.groupCount = list.length - s.groupStart;
    }
    for (const g of carried) list.push(toResolved(g, -1, 24));
    if (list.length > MAX_SET_GROUPS_PER_DAY) {
      notes.push({ day: d, code: 'setGroupsTruncated', message: `${list.length} set groups; only ${MAX_SET_GROUPS_PER_DAY} are simulated` });
      list.length = MAX_SET_GROUPS_PER_DAY;
      for (let i = 0; i < day.nSessions; i++) {
        const s = day.sessions[i]!;
        const end = Math.min(MAX_SET_GROUPS_PER_DAY, (s.groupStart ?? 0) + (s.groupCount ?? 0));
        s.groupStart = Math.min(s.groupStart ?? 0, MAX_SET_GROUPS_PER_DAY);
        s.groupCount = Math.max(0, end - s.groupStart);
      }
    }
    day.rtGroups = list;
    day.nRtGroups = list.length;
  }
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
    unallocatedKcal: 0, energyStatus: undefined, nRtGroups: 0, nutrientUnknownMask: 0,
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
  /** D2-01/D5-05 provenance: planned = prescription metadata; observed/censored = from the realised history. */
  source: 'planned' | 'observed' | 'censored';
  protocol: 'zeroCalorie' | 'modified';
  eventId: string | undefined;
  /** The fast's declared duration, h (policy/forecast metadata). */
  durationH: number;
}

/**
 * D2-01/C2: the earliest VERIFIED intake with positive energy strictly inside a zero-calorie window ends it there (the
 * intake is kept). Verified = any intake inside an observed/censored fast, or an intake on an observed day (a replayed
 * log). Meals, drinks, exogenous ketones and carbohydrate during a session count. Planned intake on prescribed days inside
 * a planned fast is still dropped by the prescription rule. Compile time only.
 */
function endAtVerifiedIntake(w: FastWindow, days: readonly DayInput[]): void {
  const eps = 1e-9;
  const historical = w.source !== 'planned';
  let first = w.t1;
  const consider = (abs: number): void => {
    if (abs > w.t0 + eps && abs < first - eps) first = abs;
  };
  const d0 = Math.max(0, Math.floor(w.t0 / 24) - 1);
  const d1 = Math.min(days.length - 1, Math.floor(w.t1 / 24));
  for (let d = d0; d <= d1; d++) {
    const day = days[d]!;
    if (!historical && day.template.observed === undefined) continue;
    for (let i = 0; i < day.nMeals; i++) {
      const m = day.meals[i]!;
      if (m.kcal > 0 || m.alcoholG > 0) consider(d * 24 + m.clockH);
    }
    const sub = day.template.substances;
    for (const a of sub?.alcohol ?? []) if (a.drinks > 0) consider(d * 24 + a.clockH);
    for (const k of sub?.exogenousKetones ?? []) if (k.gBhb > 0) consider(d * 24 + k.clockH);
    for (let i = 0; i < day.nSessions; i++) {
      const s = day.sessions[i]!;
      if (s.carbDuringGPerH > 0 && s.durationMin > 0) consider(d * 24 + s.startH);
    }
  }
  if (first < w.t1) w.t1 = first;
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
  /**
   * D4-01: fill `DayInput.exposure` with the resolved per-day exposure summary (`resolvedDayExposure`). Static days are
   * final at compile time; runtime days are refreshed in place by the loop after their runtime resolution.
   */
  exposure?: boolean;
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

  // ---- zero-intake mask over absolute hours (fast events + 'zero' days). The event windows are written into the mask
  // after the days are resolved (D2-01: verified intake ends a zero-calorie window first); 'zero' days in the day loop.
  const nHours = nDays * 24;
  const mask = new Uint8Array(nHours);
  const elecMask = new Uint8Array(nHours);
  const refeedFactor = new Float64Array(nDays).fill(1);
  const windows: FastWindow[] = [];
  /** D2-01: modified-protocol fasts (permitted intake): policy metadata only, never a zero-intake mask or meal drop. */
  const modifiedWindows: FastWindow[] = [];
  for (const ev of schedule.events ?? []) {
    if (ev.kind !== 'fast' || !(ev.durationH > 0)) continue;
    const t0 = ev.startDay * 24 + ev.startH;
    const t1 = t0 + ev.durationH;
    const custom = ev.refeedFactors && ev.refeedFactors.length > 0 ? ev.refeedFactors : null;
    const ramp = custom ?? (ev.refeed === 'auto' ? refeedRamp(ev.durationH) : []);
    const endDay = Math.floor((t1 + 1e-9) / 24);
    for (let i = 0; i < ramp.length; i++) {
      const d = endDay + i;
      const f = Math.min(1, Math.max(0, ramp[i]!));
      if (d >= 0 && d < nDays && Number.isFinite(f)) refeedFactor[d] = Math.min(refeedFactor[d] as number, f);
    }
    const w: FastWindow = {
      t0,
      t1,
      electrolytes: ev.electrolytes !== false,
      refeed: custom !== null || ev.refeed === 'auto',
      refeedDays: ramp.length,
      source: ev.source ?? 'planned',
      protocol: ev.protocol ?? 'zeroCalorie',
      eventId: ev.eventId,
      durationH: ev.durationH,
    };
    (w.protocol === 'modified' ? modifiedWindows : windows).push(w);
  }
  const zeroDays: number[] = [];
  const groupSpecs: GroupSpec[][] = [];

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
      zeroDays.push(d);
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
    // D6-08: a form-specific ME delta applies only to a stated form; unknown species/form gets none (design abstention)
    day.nutDelta = food.nutForm !== undefined ? NUT_DELTA[food.nutForm] : 0;
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
    // D8-06: a template that carries an observed episode does not also define the night starting on its day (the episode
    // is mapped to its wake date below); that night is the usual one until another observation replaces it
    const sl0 = tmpl.sleep ?? {};
    const sl: SleepSpec = hasObservedSleep(sl0) ? (sl0.shiftWork !== undefined ? { shiftWork: sl0.shiftWork } : {}) : sl0;
    day.sleepSource = sl.bedH !== undefined || sl.wakeH !== undefined || sl.hours !== undefined ? 'planned' : 'habitual';
    day.sleepBedH = sl.bedH ?? profile.habits.bedTimeH;
    day.sleepWakeH = sl.wakeH ?? profile.habits.wakeTimeH;
    if (sl.hours === undefined && sameClock(day.sleepBedH, day.sleepWakeH)) {
      // review V1a-L9 (decision 2026-10-03): bed time equal to wake time is no sleep data, not 24 h asleep; use the
      // person's usual times (and the defaults when those are equal too)
      const usual = !sameClock(profile.habits.bedTimeH, profile.habits.wakeTimeH);
      day.sleepBedH = usual ? profile.habits.bedTimeH : DEFAULTS.bedTimeH;
      day.sleepWakeH = usual ? profile.habits.wakeTimeH : DEFAULTS.wakeTimeH;
    }
    const clockHours = (day.sleepWakeH - day.sleepBedH + 24) % 24 || 24;
    day.sleepHours = sl.hours ?? (sl.bedH !== undefined || sl.wakeH !== undefined
      ? clockHours
      : profile.habits.habitualSleepDurationH ?? clockHours);
    day.sleepQuality = QUALITY_CODE[sl.quality ?? profile.habits.sleepQuality];
    day.shiftWork = sl.shiftWork ?? false;
    day.steps = tmpl.steps ?? profile.habits.typicalSteps;
    // D3-07: what the step number counts — the day's own statement, else the habitual scope when the day uses the habitual
    // steps; absent = unknown (an explicit overlap scenario, never assumed either way)
    const scope = tmpl.stepsScope ?? (tmpl.steps === undefined ? profile.habits.stepsScope : undefined);
    if (scope !== undefined) day.stepsScope = scope;
    if (tmpl.habitualTraining === true) {
      habitualEx ??= habitualWeekPrograms(profile).map((t) => t.exercise ?? []);
      day.habitualTraining = true;
      groupSpecs.push(resolveSessions(day, { ...tmpl, exercise: [...habitualEx[day.weekday]!, ...(tmpl.exercise ?? [])] }, notes));
    } else {
      groupSpecs.push(resolveSessions(day, tmpl, notes));
    }
    // D3-07: session steps inside a total-day count — stated for the day, else the sum of the sessions' stated steps
    const inc = tmpl.sessionIncludedSteps;
    if (inc !== undefined && Number.isFinite(inc) && inc >= 0) day.sessionIncludedSteps = inc;
    else {
      let sum = 0;
      let any = false;
      for (let i = 0; i < day.nSessions; i++) {
        const si = day.sessions[i]!.stepsIncluded;
        if (si !== undefined) {
          sum += si;
          any = true;
        }
      }
      if (any) day.sessionIncludedSteps = sum;
    }
    // C1/C2/D2-01: a replayed (observed) day carries its channel coverage; its causal resolution is at best 'daily' because
    // daily-native modules read whole-day totals (never a within-day causal claim)
    if (tmpl.observed) {
      day.coverage = tmpl.observed.coverage;
      day.resolution = weakestResolution(tmpl.observed.resolution, 'daily');
    }
    days.push(day);
  }
  buildSetGroups(days, groupSpecs, notes);
  const initialSleep = mapSleepEpisodes(days, schedule.startDate, profile, notes);

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
    // D2-01/C1: a graded refeed ramp is a prescription for prospective days; it never rescales an observed (logged) day
    resolveDayNumbers(day, refs, profile, day.template.observed ? 1 : (refeedFactor[d] as number), notes);
  }

  // ---- D2-01: verified intake ends a zero-calorie window; then the event windows and the 'zero' days form the mask
  for (const w of windows) endAtVerifiedIntake(w, days);
  for (const w of windows) {
    const { a, b } = fastMaskHours(w.t0, w.t1);
    for (let h = Math.max(0, a); h < Math.min(nHours, b); h++) {
      mask[h] = 1;
      elecMask[h] = w.electrolytes ? 1 : 0;
    }
  }
  for (const d of zeroDays) {
    const elec = days[d]!.template.hydration?.electrolytes === false ? 0 : 1;
    for (let h = 0; h < 24; h++) {
      mask[d * 24 + h] = 1;
      elecMask[d * 24 + h] = elec;
    }
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
      const fru = g * exerciseFructoseShare(ss);
      day.carbG -= g;
      day.fructoseG -= fru;
      day.glucoseEqG -= g - fru;
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
  const spans: CompiledSchedule['fastSpans'][number][] = [];
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
      // D2-01: provenance of the span (the first overlapping event window that carries one); 'zero' days are planned
      let src: FastWindow | null = null;
      for (const w of windows) {
        const wa = fastMaskHours(w.t0, w.t1);
        if (wa.a < h && wa.b > a) {
          if (w.refeed) {
            refeed = 'auto';
            refeedDays = Math.max(refeedDays, w.refeedDays);
          }
          if (src === null || (src.source === 'planned' && w.source !== 'planned')) src = w;
        }
      }
      const mealToMealH = after - before;
      spans.push({
        startHour: a,
        endHour: h,
        electrolytes: elecMask[a] === 1,
        mealToMealH,
        refeed,
        refeedDays,
        ...(src !== null && src.source !== 'planned' ? { source: src.source } : {}),
        ...(src !== null && ev(src.eventId) ? { eventId: src.eventId } : {}),
      });
      // policy/consent/forecast metadata only: history-driven physiology never reads it (D2-01)
      const policy = { plannedDurationH: mealToMealH, startDay: Math.floor(a / 24), source: src?.source ?? ('planned' as const) };
      for (let d = Math.floor(a / 24); d <= Math.floor((h - 1) / 24); d++) {
        days[d]!.fastStartDay = Math.floor(a / 24);
        days[d]!.fastPolicy = policy;
      }
    } else h++;
  }
  // D2-01: a modified-protocol fast (permitted intake) is policy metadata only
  for (const w of modifiedWindows) {
    const policy = { plannedDurationH: w.durationH, startDay: Math.floor(w.t0 / 24), source: w.source };
    for (let d = Math.max(0, Math.floor(w.t0 / 24)); d <= Math.min(nDays - 1, Math.floor((w.t1 - 1e-9) / 24)); d++) days[d]!.fastPolicy ??= policy;
  }
  for (let d = 0; d < nDays; d++) {
    const day = days[d]!;
    day.plannedBalanceKcal = day.energyKcal - day.maintenanceKcal;
    // A1-031: the day's polyols by identity (kept meals only; static, so runtime re-resolution leaves them as they are)
    const polyols = dayPolyols(day);
    if (polyols) {
      day.polyolsG = polyols;
      notes.push({ day: d, code: 'polyolRouteUnmodelled', message: `${Object.keys(polyols).join(', ')}: polyol energy kept, its glucose/insulin route is not modelled` });
    }
    if (opts.exposure === true) writeDayExposure(day);
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

  return {
    nDays,
    startDate: schedule.startDate,
    startWeekday,
    days,
    fastSpans: spans,
    notes,
    adherence,
    ...(schedule.realised ? { realised: { ...schedule.realised } } : {}),
    ...(initialSleep ? { initialSleep } : {}),
  };
}

const ev = (id: string | undefined): id is string => typeof id === 'string' && id.length > 0;

// ---------------------------------------------------------------- observed sleep (D8-06)

const DAY_MS = 86_400_000;
const OFFSET_RE = /([+-])(\d{2}):?(\d{2})$/;

/**
 * Local calendar date and clock hour of an instant (D8-06): in the episode's IANA zone when given, else at the instant's
 * own UTC offset when the string states one. A bare UTC instant without a zone has no known local clock (null) — the
 * occurrence is never guessed from the UTC clock. Pure (Intl with an explicit zone).
 */
export function localClockOf(iso: string, tz: string | undefined): { date: string; clockH: number } | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  if (tz) {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
      }).formatToParts(new Date(ms));
      const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '0';
      return { date: `${get('year')}-${get('month')}-${get('day')}`, clockH: Number(get('hour')) + Number(get('minute')) / 60 + Number(get('second')) / 3600 };
    } catch {
      return null;
    }
  }
  const m = OFFSET_RE.exec(iso.trim());
  if (!m) return null;
  const off = (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
  const local = new Date(ms + off * 60_000);
  return { date: local.toISOString().slice(0, 10), clockH: local.getUTCHours() + local.getUTCMinutes() / 60 + local.getUTCSeconds() / 3600 };
}

const dayIndexOf = (startDate: string, date: string): number => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / DAY_MS);

/** Whether a template's sleep carries an observation (a main episode and/or a list of logged episodes, D8-06/A1-053). */
function hasObservedSleep(sl: SleepSpec): boolean {
  return sl.observed !== undefined || (sl.observedEpisodes !== undefined && sl.observedEpisodes.length > 0);
}

interface MappedEpisode {
  /** Plan day the episode ENDED on (its wake date). */
  wakeDay: number;
  bedRel: number;
  wakeRel: number;
  /** Absolute instants (ms) — the union of a waking day's episodes is taken on them, local clock known or not. */
  bedMs: number;
  wakeMs: number;
  hours: number;
  quality: SleepSpec['quality'];
  restfulness: number | undefined;
  timed: boolean;
  nap: boolean;
  eventId: string | undefined;
}

/** Everything observed about the sleep of one waking day (A1-053). */
interface WakeDaySleep {
  mains: MappedEpisode[];
  naps: MappedEpisode[];
  /** Known total asleep hours stated by the reduction (the union of every logged episode), when given. */
  totalH: number | undefined;
  coverage: 'complete' | 'partial' | undefined;
}

type InitialSleep = NonNullable<CompiledSchedule['initialSleep']>;

/** Map one logged episode to its wake date (D8-06); null when its instants are invalid. */
function mapEpisode(ob: ObservedSleepEpisode, d: number, startDate: string): MappedEpisode | null {
  const bedMs = Date.parse(ob.bedAt);
  const wakeMs = Date.parse(ob.wakeAt);
  if (!Number.isFinite(bedMs) || !Number.isFinite(wakeMs) || !(wakeMs > bedMs)) return null;
  const bed = localClockOf(ob.bedAt, ob.tz);
  const wake = localClockOf(ob.wakeAt, ob.tz);
  const timed = bed !== null && wake !== null;
  return {
    wakeDay: timed ? dayIndexOf(startDate, wake!.date) : d,
    bedRel: timed ? bed!.clockH - 24 * dayIndexOf(bed!.date, wake!.date) : Number.NaN,
    wakeRel: timed ? wake!.clockH : Number.NaN,
    bedMs,
    wakeMs,
    hours: (wakeMs - bedMs) / 3_600_000,
    quality: ob.quality,
    restfulness: ob.restfulness !== undefined && Number.isFinite(ob.restfulness) ? ob.restfulness : undefined,
    timed,
    nap: ob.kind === 'nap',
    eventId: ob.eventId,
  };
}

/** Asleep hours of the union of episodes' absolute intervals (an overlap or a duplicate counts once). */
function unionHours(eps: readonly MappedEpisode[]): number {
  if (eps.length === 0) return 0;
  const iv = eps.map((e) => [e.bedMs, e.wakeMs] as [number, number]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let total = 0;
  let [cs, ce] = iv[0]!;
  for (let i = 1; i < iv.length; i++) {
    const [a, b] = iv[i]!;
    if (a > ce) {
      total += ce - cs;
      cs = a;
      ce = b;
    } else if (b > ce) ce = b;
  }
  return (total + ce - cs) / 3_600_000;
}

/**
 * D8-06: map every observed sleep episode to its WAKE date W. Main episodes are the night that ended on W: they replace the
 * night starting on W − 1 in the hour expansion (bed clock relative to W − 1, ≥ 24 after midnight; overlapping mains merged,
 * never double-counted), set W's own wake hour and form W's `sleepEndingToday`. An episode without a known local clock keeps
 * the planned timing and contributes its instant duration. Returns `CompiledSchedule.initialSleep` (an observed episode
 * ending on day 0). Compile time only.
 *
 * A1-053: the waking day's KNOWN TOTAL asleep hours (`totalAsleepHours`) is the reduction's explicit total when it gives one
 * (`observedTotalHours`; a legacy template's `hours` beside its observed main), else the union of every episode (mains and
 * naps, counted once) — never overwritten by the main interval's duration, while the main-episode timing alone places
 * hourly sleep (a nap never stretches the night). The entered quality (or `qualityStatus: 'unrated'`) and restfulness reach
 * day zero (`initialSleep`) exactly as a later waking day; an observed unrated night clears the planned quality of the night
 * it replaces (nothing is read as good or poor). A nap-only record stays partial: the planned night keeps the timing (a
 * named scenario) and only the naps' known hours are the observed dose (`coverage: 'partial'`).
 */
function mapSleepEpisodes(days: DayInput[], startDate: string, profile: ResolvedProfile, notes: Note[]): InitialSleep | undefined {
  const n = days.length;
  const byWake = new Map<number, WakeDaySleep>();
  const slot = (w: number): WakeDaySleep => {
    let x = byWake.get(w);
    if (!x) {
      x = { mains: [], naps: [], totalH: undefined, coverage: undefined };
      byWake.set(w, x);
    }
    return x;
  };
  for (let d = 0; d < n; d++) {
    const sl = days[d]!.template.sleep;
    if (!sl || !hasObservedSleep(sl)) continue;
    const listed = sl.observedEpisodes ?? [];
    const eps: ObservedSleepEpisode[] = [...listed];
    const main = sl.observed;
    if (main && !listed.some((e) => e.bedAt === main.bedAt && e.wakeAt === main.wakeAt && (e.kind ?? 'main') === (main.kind ?? 'main'))) eps.push(main);
    const mapped: Array<{ ob: ObservedSleepEpisode; ep: MappedEpisode }> = [];
    for (const ob of eps) {
      const ep = mapEpisode(ob, d, startDate);
      if (!ep) continue;
      mapped.push({ ob, ep });
      const x = slot(ep.wakeDay);
      const list = ep.nap ? x.naps : x.mains;
      // the same logged episode carried by several templates (a repeated program, a re-sent log) is one episode
      if (!list.some((o) => o.bedMs === ep.bedMs && o.wakeMs === ep.wakeMs && o.eventId === ep.eventId)) list.push(ep);
    }
    // the reduction's total belongs to the waking day of the main episode (the stated one, else the first main, else a nap)
    const anchorWake = (mapped.find((m) => m.ob === main && !m.ep.nap) ?? mapped.find((m) => !m.ep.nap) ?? mapped[0])?.ep.wakeDay;
    if (anchorWake === undefined) continue;
    const x = slot(anchorWake);
    const stated = sl.observedTotalHours ?? (main && sl.hours !== undefined ? sl.hours : undefined);
    if (stated !== undefined && Number.isFinite(stated) && stated >= 0) x.totalH = Math.max(x.totalH ?? 0, stated);
    if (sl.observedCoverage === 'partial' || (sl.observedCoverage === 'complete' && x.coverage === undefined)) x.coverage = sl.observedCoverage;
  }
  const usual = !sameClock(profile.habits.bedTimeH, profile.habits.wakeTimeH);
  const bed0 = usual ? profile.habits.bedTimeH : DEFAULTS.bedTimeH;
  const wake0 = usual ? profile.habits.wakeTimeH : DEFAULTS.wakeTimeH;
  let initial: InitialSleep | undefined;
  for (const [w, obs] of byWake) {
    if (obs.mains.length === 0) continue;
    const ep = mergeEpisodes(obs.mains);
    const all = [...obs.mains, ...obs.naps];
    const total = obs.totalH ?? unionHours(all);
    const coverage = obs.coverage ?? 'complete';
    const rated = ep.quality !== undefined;
    const eventIds = [...new Set(all.map((e) => e.eventId).filter((id): id is string => id !== undefined && id !== ''))];
    const p = w - 1;
    // the night starting the day before carries the MAIN episode in the hour expansion (bed clock relative to that day, ≥ 24
    // after midnight); the wake day's own wake hour (recording/morning anchor) is the observed wake clock
    if (p >= 0 && p < n) {
      const pd = days[p]!;
      if (ep.timed) pd.sleepBedH = ep.bedRel + 24;
      pd.sleepHours = ep.hours;
      // an entered rating, else unrated: the planned label of the replaced night is cleared (not poor; nothing invented —
      // the waking day's `sleepEndingToday` says 'unrated')
      pd.sleepQuality = rated ? QUALITY_CODE[ep.quality!] : QUALITY_CODE.fair;
    } else if (w === 0) {
      initial = {
        bedClockH: ep.timed ? ep.bedRel + 24 : bed0,
        sleepHours: ep.hours,
        totalAsleepHours: total,
        ...(rated ? { quality: QUALITY_CODE[ep.quality!] } : {}),
        qualityStatus: rated ? 'rated' : 'unrated',
        ...(ep.restfulness !== undefined ? { restfulness: ep.restfulness } : {}),
        coverage,
      };
    }
    if (w >= 0 && w < n) {
      // an untimed episode keeps the planned/usual bed time and contributes its instant duration
      const bedClockH = ep.timed ? ep.bedRel : p >= 0 ? days[p]!.sleepBedH - 24 : initial!.bedClockH - 24;
      const wakeClockH = ep.timed ? ep.wakeRel : bedClockH + ep.hours;
      const se: SleepEndingToday = {
        bedClockH,
        wakeClockH,
        hours: ep.hours,
        totalAsleepHours: total,
        ...(rated ? { quality: QUALITY_CODE[ep.quality!] } : {}),
        qualityStatus: rated ? 'rated' : 'unrated',
        ...(ep.restfulness !== undefined ? { restfulness: ep.restfulness } : {}),
        ...(eventIds.length > 0 ? { eventIds } : {}),
        coverage,
      };
      days[w]!.sleepSource = 'observed';
      days[w]!.sleepEndingToday = se;
      if (ep.timed) days[w]!.sleepWakeH = ep.wakeRel;
      if (Math.abs(total - ep.hours) > 1e-9)
        notes.push({ day: w, code: 'sleepTotalFromEpisodes', message: `${total.toFixed(1)} h asleep in total; the main episode (${ep.hours.toFixed(1)} h) keeps the night's timing` });
    }
  }
  // the night ending on each day = the night starting the day before as the hour expansion steps it (planned
  // starting-date convention); day 0 = the usual night
  for (let d = 0; d < n; d++) {
    const day = days[d]!;
    if (day.sleepEndingToday !== undefined) continue;
    const bed = d === 0 ? bed0 - 24 : days[d - 1]!.sleepBedH - 24;
    const hours = d === 0 ? profile.habits.habitualSleepDurationH ?? ((wake0 - bed0 + 24) % 24 || 24) : days[d - 1]!.sleepHours;
    day.sleepEndingToday = { bedClockH: bed, wakeClockH: bed + hours, hours };
  }
  // a nap-only waking day: the night is not observed (its planned timing stays a scenario); the naps' known hours are the
  // observed dose, partial coverage (never a full night invented from them)
  for (const [w, obs] of byWake) {
    if (obs.mains.length > 0 || w < 0 || w >= n || obs.naps.length === 0) continue;
    const se = days[w]!.sleepEndingToday!;
    const eventIds = [...new Set(obs.naps.map((e) => e.eventId).filter((id): id is string => id !== undefined && id !== ''))];
    days[w]!.sleepEndingToday = { ...se, totalAsleepHours: obs.totalH ?? unionHours(obs.naps), ...(eventIds.length > 0 ? { eventIds } : {}), coverage: 'partial' };
  }
  return initial;
}

/** Union of main episodes ending on the same day (overlaps counted once; earliest bed, latest wake). */
function mergeEpisodes(list: readonly MappedEpisode[]): MappedEpisode {
  if (list.length === 1) return list[0]!;
  const timed = list.filter((e) => e.timed);
  if (timed.length === 0) return { ...list[0]!, hours: unionHours(list) };
  const iv = timed.map((e) => [e.bedRel, e.bedRel + e.hours] as [number, number]).sort((a, b) => a[0] - b[0]);
  let hours = 0;
  let [cs, ce] = iv[0]!;
  for (let i = 1; i < iv.length; i++) {
    const [a, b] = iv[i]!;
    if (a > ce) {
      hours += ce - cs;
      cs = a;
      ce = b;
    } else if (b > ce) ce = b;
  }
  hours += ce - cs;
  const last = timed.reduce((x, e) => (e.bedRel + e.hours > x.bedRel + x.hours ? e : x));
  return {
    ...timed[0]!,
    bedRel: iv[0]![0],
    wakeRel: last.wakeRel,
    hours,
    quality: last.quality ?? timed[0]!.quality,
    restfulness: last.restfulness ?? timed[0]!.restfulness,
  };
}

/**
 * Mark and drop the meals of day `d` that lie strictly inside a fast window (event windows (t0, t1), or a masked hour of a
 * 'zero' day), then re-derive the day's window. Compile time only. A logged (observed) day's meals are never dropped
 * (C1: known intake is never displaced by a prescription; verified intake ends the fast instead, `endAtVerifiedIntake`).
 */
function markMealDrops(day: DayInput, d: number, windows: readonly FastWindow[], mask: Uint8Array, notes: Note[], profile: ResolvedProfile): void {
  if (day.template.observed) return;
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

// ---------------------------------------------------------------- resolved exposure (D4-01, C3)

interface ExposureEntry {
  readonly id: string;
  readonly unit: string;
  readonly channel: ExposureChannel;
  readonly value: (d: DayInput) => number;
  /** Whether the day's template (or its reported meals) states the quantity itself rather than an engine default. */
  readonly stated: (d: DayInput) => boolean;
  /** The quantity a resolved meal carries (meal-borne exposures), so an imputed remainder meal can be told apart. */
  readonly meal?: (m: MealResolved) => number;
  /**
   * A1-014: the meal nutrient whose knowledge the quantity follows (derived quantities follow their parent: sugars and
   * fructose the carbohydrate, fatty-acid classes the fat). Its day total is complete only when every included contribution
   * is known.
   */
  readonly nutrient?: MealNutrientKey;
}

const ALWAYS = (): boolean => true;

/** Fructose is stated by an explicit sugar mixture, or when every carbohydrate-bearing meal states its mixture (D6-07). */
function fructoseStated(d: DayInput): boolean {
  const m = d.template.macros;
  if (m.sugarsShare !== undefined && m.fructoseShareOfSugars !== undefined) return true;
  const explicit = d.template.meals?.meals;
  if (!explicit || explicit.length === 0) return false;
  let any = false;
  for (let i = 0; i < d.nMeals; i++) {
    const meal = d.meals[i]!;
    if (!(meal.carbG > 0)) continue;
    if (meal.carbUnknownMixG === undefined || meal.carbUnknownMixG > 1e-9) return false;
    any = true;
  }
  return any;
}

/** Polyols are stated when an included meal carries a polyol record (A1-031); otherwise the amount is unknown, not 0. */
function polyolStated(d: DayInput): boolean {
  for (let i = 0; i < d.nMeals; i++) if (d.meals[i]!.polyolsG !== undefined && includedMeal(d.meals[i]!)) return true;
  return false;
}

/** The day's polyol grams, all identities (A1-031). */
function dayPolyolG(d: DayInput): number {
  let s = 0;
  if (!d.zeroIntake) for (let i = 0; i < d.nMeals; i++) if (includedMeal(d.meals[i]!)) s += mealPolyolG(d.meals[i]!);
  return s;
}

/**
 * Final resolved per-day exposures in canonical units (C3 `EXPOSURE_UNITS`): energy is metabolizable kcal including
 * unallocated energy, carbohydrate is the engine's available (net, non-polyol) carbohydrate, ethanol g, caffeine/sodium/
 * potassium/cholesterol mg, creatine/exogenous BHB g, polyols g, fluid mL.
 */
const EXPOSURE_TABLE: readonly ExposureEntry[] = [
  { id: 'energy', unit: 'kcal', channel: 'energy', value: (d) => d.energyKcal, stated: ALWAYS, meal: (m) => m.kcal },
  { id: 'protein', unit: 'g', channel: 'protein', value: (d) => d.proteinG, stated: ALWAYS, meal: (m) => m.proteinG, nutrient: 'protein' },
  { id: 'carbAvailable', unit: 'g', channel: 'carbohydrate', value: (d) => d.carbG, stated: ALWAYS, meal: (m) => m.carbG, nutrient: 'carbohydrate' },
  { id: 'fat', unit: 'g', channel: 'fat', value: (d) => d.fatG, stated: ALWAYS, meal: (m) => m.fatG, nutrient: 'fat' },
  { id: 'satFat', unit: 'g', channel: 'fat', value: (d) => d.satFatG, stated: (d) => d.template.macros.fatTypes?.satShare !== undefined, meal: (m) => m.satFatG, nutrient: 'fat' },
  { id: 'mct', unit: 'g', channel: 'fat', value: (d) => d.mctG, stated: (d) => d.template.observed === undefined || d.template.macros.fatTypes?.mctG !== undefined, meal: (m) => m.mctG, nutrient: 'fat' },
  // A1-014: fibre comes from the meals on a day with reported meals (their masks say which are known), else the template
  { id: 'fibre', unit: 'g', channel: 'fibre', value: (d) => d.fibreG, stated: (d) => d.template.macros.fibre !== undefined || d.energyStatus !== undefined, meal: (m) => m.fibreG, nutrient: 'fibre' },
  { id: 'sugars', unit: 'g', channel: 'carbohydrate', value: (d) => d.sugarsG, stated: (d) => d.template.macros.sugarsShare !== undefined, nutrient: 'carbohydrate' },
  // D6-03/D6-07: fructose is stated by an explicit sugar mixture or by every meal's stated carbohydrate mixture
  { id: 'fructose', unit: 'g', channel: 'carbohydrate', value: (d) => d.fructoseG, stated: fructoseStated, meal: (m) => m.fructoseG, nutrient: 'carbohydrate' },
  // D6-03: fatty-acid classes and EPA+DHA are known only when the template states them (else engine defaults: unknown)
  { id: 'mufa', unit: 'g', channel: 'fat', value: (d) => d.mufaG, stated: (d) => d.template.macros.fatTypes?.mufaShare !== undefined, nutrient: 'fat' },
  { id: 'pufa', unit: 'g', channel: 'fat', value: (d) => d.pufaG, stated: (d) => d.template.macros.fatTypes?.pufaShare !== undefined, nutrient: 'fat' },
  { id: 'epaDha', unit: 'g', channel: 'fat', value: (d) => d.omega3G, stated: (d) => d.template.macros.fatTypes?.omega3G !== undefined, nutrient: 'fat' },
  { id: 'ethanol', unit: 'g', channel: 'alcohol', value: (d) => d.alcoholG, stated: ALWAYS, meal: (m) => m.alcoholG, nutrient: 'ethanol' },
  // A1-031: polyols by mass (identities on the meals/day), outside carbAvailable; unknown unless a meal records them
  { id: 'polyol', unit: 'g', channel: 'carbohydrate', value: dayPolyolG, stated: polyolStated, meal: mealPolyolG },
  { id: 'caffeine', unit: 'mg', channel: 'caffeine', value: (d) => d.caffeineMg, stated: (d) => d.template.substances?.caffeine !== undefined },
  { id: 'creatine', unit: 'g', channel: 'supplements', value: (d) => d.creatineG, stated: ALWAYS },
  { id: 'exogenousBhb', unit: 'g', channel: 'supplements', value: (d) => d.exoKetoneG, stated: ALWAYS },
  { id: 'sodium', unit: 'mg', channel: 'sodium', value: (d) => d.sodiumMg, stated: (d) => d.template.hydration?.sodiumG !== undefined },
  { id: 'potassium', unit: 'mg', channel: 'potassium', value: (d) => d.potassiumMg, stated: (d) => d.template.hydration?.potassiumG !== undefined },
  { id: 'magnesium', unit: 'mg', channel: 'micronutrients', value: (d) => d.magnesiumMg, stated: (d) => d.template.hydration?.magnesiumMg !== undefined },
  { id: 'cholesterol', unit: 'mg', channel: 'micronutrients', value: (d) => d.cholesterolMg ?? Number.NaN, stated: (d) => d.template.food?.cholesterolMg !== undefined },
  { id: 'fluid', unit: 'mL', channel: 'fluids', value: (d) => d.fluidL * 1000, stated: (d) => d.template.hydration?.fluidL !== undefined },
];

/** Scratch of `nutrientContributions`: [known, unknown] included contributions (allocation-free). */
const CONTRIB = new Int32Array(2);

/**
 * A1-014: included contributions of nutrient `k` with known vs not-analysed ('unknown'/'imputed') knowledge — the day's
 * kept meals, plus its standalone drinks for ethanol (each a known amount). Writes `CONTRIB`. Allocation-free.
 */
function nutrientContributions(day: DayInput, k: MealNutrientKey): void {
  let known = 0;
  let unknown = 0;
  if (!day.zeroIntake) {
    const bit = NUTRIENT_UNKNOWN_BIT[k];
    for (let i = 0; i < day.nMeals; i++) {
      const m = day.meals[i]!;
      if (!includedMeal(m)) continue;
      if ((mealUnknownBits(m) & bit) !== 0) unknown++;
      else known++;
    }
    if (k === 'ethanol') {
      const alc = day.template.substances?.alcohol;
      if (alc) for (let i = 0; i < alc.length; i++) if (alc[i]!.drinks > 0 && !sameEventMeal(day, alc[i]!.eventId)) known++;
    }
  }
  CONTRIB[0] = known;
  CONTRIB[1] = unknown;
}

/**
 * Coverage of one resolved quantity (C1/C3): a quantity the engine filled from a default is `unknown` (never a measured or
 * prescribed amount); a prescribed day states its own exposure completely within the modeled prescription (construction
 * scope only — no claim about unlogged outside intake); an observed day takes the channel coverage of its realised history.
 * A1-014: a meal-borne nutrient is complete only when every included contribution is known analysis; with some contribution
 * not analysed its known sum is a lower bound (`partial`), with none known nothing is (`unknown`). Day completeness never
 * upgrades a meal's absent analysis.
 */
function exposureCoverage(day: DayInput, e: ExposureEntry, v: number): ChannelCoverage {
  if (!Number.isFinite(v) || !e.stated(day)) return 'unknown';
  const base = baseCoverage(day, e);
  if (!knowledgeDecides(day, e, base)) return base;
  nutrientContributions(day, e.nutrient!);
  return CONTRIB[0]! > 0 ? 'partial' : 'unknown';
}

/** The coverage a quantity has before nutrient knowledge: the realised channel coverage, or a prescription's own. */
function baseCoverage(day: DayInput, e: ExposureEntry): ChannelCoverage {
  const obs = day.template.observed;
  return obs ? coverageOf(obs.coverage, e.channel) : 'complete';
}

/** Whether a not-analysed contribution of the quantity's nutrient limits an otherwise (partly) known total (A1-014). */
function knowledgeDecides(day: DayInput, e: ExposureEntry, base: ChannelCoverage): boolean {
  if (e.nutrient === undefined || ((day.nutrientUnknownMask ?? 0) & NUTRIENT_UNKNOWN_BIT[e.nutrient]) === 0) return false;
  return base !== 'unknown' && base !== 'asPlannedEstimate';
}

/**
 * Known sum of one quantity under its coverage (C1/C3): exact when `complete`; when `partial`, only known contributions
 * count — on an observed day the realised history's imputed remainder sits on meals without an event identity and is a
 * scenario input, never part of a known lower bound (a cap must not be "proven" violated by imputed food), and (A1-014) a
 * meal whose nutrient is not analysed (a scenario fill, or a compatibility 0) contributes nothing; 0 otherwise.
 * Allocation-free (runtime-resolved days refresh it in place).
 */
function knownSumOf(day: DayInput, e: ExposureEntry, v: number, coverage: ChannelCoverage): number {
  if (coverage !== 'complete' && coverage !== 'partial') return 0;
  let known = v;
  if (coverage === 'partial' && e.meal !== undefined) {
    const bit = e.nutrient !== undefined ? NUTRIENT_UNKNOWN_BIT[e.nutrient] : 0;
    const observed = day.template.observed !== undefined;
    for (let k = 0; k < day.nMeals; k++) {
      const m = day.meals[k]!;
      if ((observed && m.eventId === undefined) || (bit !== 0 && (mealUnknownBits(m) & bit) !== 0)) known -= e.meal(m);
    }
  }
  return known > 0 ? known : 0;
}

/**
 * Write the contribution counts of a summary whose coverage the nutrient knowledge decided (A1-014: some included
 * contribution not analysed); a fully known or wholly unknown quantity carries none (a stale pair is cleared in place).
 * Allocation-free.
 */
function writeContributions(day: DayInput, e: ExposureEntry, s: DayExposureSummary): void {
  if (Number.isFinite(e.value(day)) && e.stated(day) && knowledgeDecides(day, e, baseCoverage(day, e))) {
    nutrientContributions(day, e.nutrient!);
    s.knownContributions = CONTRIB[0]!;
    s.unknownContributions = CONTRIB[1]!;
  } else if (s.knownContributions !== undefined || s.unknownContributions !== undefined) {
    s.knownContributions = undefined;
    s.unknownContributions = undefined;
  }
}

/**
 * D4-01/C3: the day's FINAL resolved exposure (after exercise energy references, explicit and reported meals, fast
 * suppression and refeed factors) with coverage: `knownSum` is exact when coverage is `complete`, a lower bound of the
 * known contributions when `partial` (an imputed remainder or a not-analysed nutrient is excluded), and 0 when nothing is
 * known (`unknown`, `asPlannedEstimate`) or zero is confirmed; nutrient-borne quantities carry their known/unknown
 * contribution counts (A1-014). Call it on compiled days after a run for runtime-resolved days (the loop resolves them in
 * place). Allocation: one record per call.
 */
export function resolvedDayExposure(day: DayInput): Record<string, DayExposureSummary> {
  const out: Record<string, DayExposureSummary> = {};
  for (let i = 0; i < EXPOSURE_TABLE.length; i++) {
    const e = EXPOSURE_TABLE[i]!;
    const v = e.value(day);
    const coverage = exposureCoverage(day, e, v);
    const s: DayExposureSummary = { knownSum: knownSumOf(day, e, v, coverage), unit: e.unit, coverage };
    writeContributions(day, e, s);
    out[e.id] = s;
  }
  addActiveExposure(day, out);
  return out;
}

/** Canonical mass unit of active-ingredient doses (C3): g/mg/µg are converted to mg; mmol is a different basis. */
const MASS_TO_MG: Readonly<Record<'g' | 'mg' | 'ug', number>> = { g: 1000, mg: 1, ug: 0.001 };

/**
 * D7-04/C3: the day's active-ingredient exposure by ingredient (`active:<ingredient>`, mg; `active:<ingredient>:mmol` for a
 * molar basis such as nitrate) and its largest single dose (`activePeak:…`), so a weekly or alternate-day bolus is never
 * judged by a daily average alone. Ingredients are aggregated across products (identity = the normalised ingredient, its
 * basis already elemental/active from the label conversion). Coverage: a prescribed day states its planned doses; an
 * observed day takes the supplements channel of its realised history. A product of unknown potency is never listed as a
 * number (it stays an unchecked log upstream). Allocation: compile time only.
 */
function addActiveExposure(day: DayInput, out: Record<string, DayExposureSummary>): void {
  const actives = day.template.substances?.actives;
  if (!actives || actives.length === 0) return;
  const obs = day.template.observed;
  const coverage: ChannelCoverage = obs ? coverageOf(obs.coverage, 'supplements') : 'complete';
  const sums = new Map<string, { sum: number; peak: number; unit: string }>();
  for (const a of actives as readonly ActiveDoseSpec[]) {
    if (!a.ingredient || !Number.isFinite(a.amount) || a.amount < 0) continue;
    const molar = a.unit === 'mmol';
    const key = molar ? `${a.ingredient}:mmol` : a.ingredient;
    const v = a.unit === 'mmol' ? a.amount : a.amount * MASS_TO_MG[a.unit];
    const cur = sums.get(key) ?? { sum: 0, peak: 0, unit: molar ? 'mmol' : 'mg' };
    cur.sum += v;
    if (v > cur.peak) cur.peak = v;
    sums.set(key, cur);
  }
  const known = coverage === 'complete' || coverage === 'partial';
  for (const [key, a] of sums) {
    out[`active:${key}`] = { knownSum: known ? a.sum : 0, unit: a.unit, coverage };
    out[`activePeak:${key}`] = { knownSum: known ? a.peak : 0, unit: a.unit, coverage };
  }
}

/** Fill `day.exposure` (allocating it once), or refresh it in place without allocation (runtime-resolved days). */
export function writeDayExposure(day: DayInput): void {
  const cur = day.exposure as Record<string, DayExposureSummary> | undefined;
  if (!cur) {
    day.exposure = resolvedDayExposure(day);
    return;
  }
  for (let i = 0; i < EXPOSURE_TABLE.length; i++) {
    const e = EXPOSURE_TABLE[i]!;
    const s = cur[e.id];
    if (!s) continue;
    const v = e.value(day);
    const coverage = exposureCoverage(day, e, v);
    s.coverage = coverage;
    s.knownSum = knownSumOf(day, e, v, coverage);
    writeContributions(day, e, s);
  }
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
  /** D6-02: unallocated energy (reported meal energy without known macros) starting in each hour, kcal; part of `kcal`. */
  readonly unallocatedKcal = new Float64Array(24);
  /** A1-014: unknown-nutrient bits (`NUTRIENT_UNKNOWN_BIT`) of the meals starting in each hour (0 = all known). */
  readonly nutrientUnknownMask = new Int32Array(24);
  /** A1-031: polyol grams (all identities) of the meals starting in each hour; outside `carbG`, energy inside `kcal`. */
  readonly polyolG = new Float64Array(24);
  /** D3-01: sets started in each hour per day set-group index (row-major, MAX_SET_GROUPS_PER_DAY columns per hour). */
  readonly rtGroupSets = new Float64Array(24 * MAX_SET_GROUPS_PER_DAY);
  /** Set-group columns used by the current expansion, and columns possibly non-zero in the HourInput. */
  groupCols = 0;
  outGroupCols = 0;
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
      t.proteinQMeal[h] = 1; t.proteinSpeed[h] = 1; t.timeToPeakH[h] = 1; t.exoKetoneG[h] = 0; t.unallocatedKcal[h] = 0;
      t.nutrientUnknownMask[h] = 0; t.polyolG[h] = 0;
      t.rowIntake[h] = 0;
    }
    if (t.rowEx[h] === 1) {
      t.exMin[h] = 0; t.exIntensityFrac[h] = 0; t.exModality[h] = 0; t.exMet[h] = 0; t.exCarbDuringGPerMin[h] = 0; t.exCarbG[h] = 0;
      for (let k = 0; k < N_REGIONS; k++) t.rtSetsByRegion[h * N_REGIONS + k] = 0;
      t.rtSetsTotal[h] = 0; t.rtRir[h] = 0; t.rtLoadPct1RM[h] = 0; t.rtToFailure[h] = 0;
      const g0 = h * MAX_SET_GROUPS_PER_DAY;
      for (let g = 0; g < t.groupCols; g++) t.rtGroupSets[g0 + g] = 0;
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
  const un = m.unallocatedKcal;
  if (un !== undefined && un !== 0) t.unallocatedKcal[h] = t.unallocatedKcal[h]! + un; // signed: a reconciliation can be negative
  // A1-014/A1-031: the hour keeps which of its grams are only known lower bounds, and the meal's polyols by mass
  t.nutrientUnknownMask[h] = t.nutrientUnknownMask[h]! | mealUnknownBits(m);
  if (m.polyolsG !== undefined) t.polyolG[h] = t.polyolG[h]! + mealPolyolG(m);
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
  // A1-029: a drink entry that is the same logged event as a kept meal is that meal's ethanol (stepped with the meal, once)
  if (tp?.alcohol) for (const a of tp.alcohol) { const h = hourOf(a.clockH, shift); if (h < 0 || sameEventMeal(src, a.eventId)) continue; t.alcoholG[h] = t.alcoholG[h]! + a.drinks * DEFAULTS.gramsPerDrink; t.kcal[h] = t.kcal[h]! + a.drinks * DEFAULTS.gramsPerDrink * ATWATER.alcohol; t.rowIntake[h] = 1; }
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
 * D3-01: the sets of each of the day's set groups started in each of today's hours (`rtGroupSets[h][g]`), spread over the
 * group's own duration (all in its start hour when it has none). Only today's hours [0, 24) are filled: the part of a group
 * past midnight belongs to the next day's copy (`session` −1), so every set is stepped exactly once. Allocation-free.
 */
function addGroups(day: DayInput, t: DayHourTable): void {
  const groups = day.rtGroups;
  const n = groups !== undefined ? Math.min(day.nRtGroups ?? 0, groups.length, MAX_SET_GROUPS_PER_DAY) : 0;
  t.groupCols = n;
  for (let g = 0; g < n; g++) {
    const grp = groups![g]!;
    if (!(grp.sets > 0)) continue;
    const a = grp.startH;
    const dur = grp.durationMin > 0 ? grp.durationMin : 0;
    if (dur === 0) {
      const h = Math.floor(a);
      if (h < 0 || h >= 24) continue;
      t.rtGroupSets[h * MAX_SET_GROUPS_PER_DAY + g] = t.rtGroupSets[h * MAX_SET_GROUPS_PER_DAY + g]! + grp.sets;
      t.rowEx[h] = 1;
      continue;
    }
    const b = a + dur / 60;
    for (let h = Math.max(0, Math.floor(a)); h < Math.min(24, Math.ceil(b)); h++) {
      const mins = overlap(a, b, h, h + 1) * 60;
      if (mins <= 0) continue;
      const i = h * MAX_SET_GROUPS_PER_DAY + g;
      t.rtGroupSets[i] = t.rtGroupSets[i]! + (grp.sets * mins) / dur;
      t.rowEx[h] = 1;
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
  addGroups(day, t);

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
    out.unallocatedKcal = t.unallocatedKcal[h]!;
    out.nutrientUnknownMask = t.nutrientUnknownMask[h]!;
    out.polyolG = t.polyolG[h]!;
    t.outIntakeDirty = true;
  } else if (t.outIntakeDirty) {
    out.kcal = 0; out.proteinG = 0; out.carbG = 0; out.glucoseEqG = 0; out.fructoseG = 0; out.galactoseG = 0; out.fatG = 0;
    out.satFatG = 0; out.mctG = 0; out.fibreG = 0; out.alcoholG = 0; out.proteinQMeal = 1; out.proteinSpeed = 1; out.timeToPeakH = 1;
    out.mealStart = 0; out.exoKetoneG = 0; out.unallocatedKcal = 0; out.nutrientUnknownMask = 0; out.polyolG = 0;
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
    const og = out.rtGroupSets;
    if (og !== undefined) {
      const g0 = h * MAX_SET_GROUPS_PER_DAY;
      const G = t.groupCols < og.length ? t.groupCols : og.length;
      for (let g = 0; g < G; g++) og[g] = t.rtGroupSets[g0 + g]!;
      for (let g = G; g < t.outGroupCols && g < og.length; g++) og[g] = 0;
      t.outGroupCols = G;
    }
    t.outExDirty = true;
  } else if (t.outExDirty) {
    out.exMin = 0; out.exIntensityFrac = 0; out.exModality = 0; out.exMet = 0; out.exCarbDuringGPerMin = 0; out.exCarbG = 0;
    out.rtSetsByRegion.fill(0); out.rtSetsTotal = 0; out.rtRir = 0; out.rtLoadPct1RM = 0; out.rtToFailure = 0;
    const og = out.rtGroupSets;
    if (og !== undefined) for (let g = 0; g < t.outGroupCols && g < og.length; g++) og[g] = 0;
    t.outGroupCols = 0;
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
    rtGroupSets: new Float64Array(MAX_SET_GROUPS_PER_DAY), unallocatedKcal: 0, nutrientUnknownMask: 0, polyolG: 0,
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
  // A1-040: the habitual steps reconciled by the same rule as a plan day — their scope, and the habitual sessions' locomotor
  // steps inside them only when KNOWN (the activity module's habitual reference ledger is the same resolver)
  const stepsRef = habitualStepsReference(profile);
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
    ...(stepsRef.scope !== undefined ? { stepsScope: stepsRef.scope } : {}),
    ...(stepsRef.includedSteps !== undefined ? { sessionIncludedSteps: stepsRef.includedSteps } : {}),
    sleep: { bedH: h.bedTimeH, wakeH: h.wakeTimeH, ...(h.habitualSleepDurationH !== undefined ? { hours: h.habitualSleepDurationH } : {}), quality: h.sleepQuality },
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
    kinds[Math.floor((7 * i) / n)] = cardio ? (h.habitualCardio ? 'rest' : 'cardio') : 'rt';
    if (!cardio) nRt++;
  }
  const base = habitualTemplate(profile);
  const perSession = nRt > 0 ? RT_PRESETS.moderate.setsPerRegionWeek / nRt : 0;
  const sets: Partial<Record<TrainingRegion, number>> = {};
  for (const r of TRAINING_REGIONS) sets[r as TrainingRegion] = perSession;
  const programs: DayTemplate[] = kinds.map((k, wd) => {
    const exercise: ExerciseSession[] = [];
    if (k !== 'rest') {
      const session: ResistanceSession | CardioSession = k === 'rt'
        ? { kind: 'resistance', startH: HABIT_SESSION_START_H, durationMin: HABIT_SESSION_MIN, setsByRegion: sets, rir: 0, style: 'general' }
        : { kind: 'cardio', modality: 'other', startH: HABIT_SESSION_START_H, durationMin: HABIT_SESSION_MIN };
      exercise.push(session);
    }
    if (h.habitualCardio?.weekdays.includes(wd)) exercise.push({
      kind: 'cardio', modality: h.habitualCardio.modality,
      startH: k === 'rest' ? HABIT_SESSION_START_H : HABIT_SESSION_START_H - 1,
      durationMin: h.habitualCardio.minutesPerSession, met: DOCUMENTED_CYCLE_MET,
    });
    return { ...base, id: `habitual-${wd}`, ...(exercise.length ? { exercise } : {}) };
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
