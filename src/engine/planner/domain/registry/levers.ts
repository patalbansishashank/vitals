/**
 * Lever registry (dossier 18 §4.4.1; MODEL_SPEC §10.3) as typed data.
 *
 * Every controllable thing the planner can vary is a lever: a self-describing record with parameters, the Schedule
 * fields it writes (`engineInputs`, checked at registration against `SCHEDULE_FIELDS`), a person- and parameter-
 * dependent tier (17), spacing/composition constraints, a complexity cost and explanation strings. The optimiser only
 * sees genomes; lever semantics live here and in the decoder.
 *
 * Contents: the planner's own diet/timing/training levers (18 §4.2), the fasting family (13 B9/B11-B15, 17 §4.3,
 * 20 §4C) and the 21 §4J blocks L1-L19. A lever whose physical inputs are not in the v1 Schedule (MODEL_SPEC §11.1:
 * extra inputs X1-X19 are deferred) is registered with `plannerUsable: false` and the reason, so it is visible in the
 * catalogue but can never be decoded.
 */
import type { SafetyCaps } from '../safety';
import { fastAllowed, tierForHours } from '../safety';
import type { SafetyTier } from './blocks';

export type LeverKind = 'dayParam' | 'dayOverlay' | 'event' | 'phaseModifier';

export type ParamSpec =
  | { key: string; kind: 'real'; min: number; max: number; unit: string; grid?: number; evidence?: { min: number; max: number; ref: string } }
  | { key: string; kind: 'int'; min: number; max: number; unit: string; step?: number }
  | { key: string; kind: 'cat'; options: readonly string[] };

export type LeverConstraint =
  | { type: 'minGapDays'; family: string; days: number }
  | { type: 'maxPerWindow'; family: string; count: number; windowDays: number }
  | { type: 'maxHoursPerWindow'; family: string; hours: number; windowDays: number }
  | { type: 'requires' | 'excludes'; leverId: string; scope: 'day' | 'phase' | 'plan' }
  | { type: 'noTrainingWithin'; hoursBefore: number; hoursAfter: number }
  | { type: 'allowedInBlocks'; blockIds: readonly string[] }
  /** Locked recovery days after the event (17 HC-F3; 13 rule 4): no training, energy ≤ `maxPct` %. */
  | { type: 'recoveryDays'; days: number; maxPct: number };

export type LeverParams = Record<string, number | string>;

export interface LeverDef {
  readonly id: string;
  readonly version: number;
  readonly kind: LeverKind;
  readonly family: string;
  readonly params: readonly ParamSpec[];
  /** Schedule field paths written (`SCHEDULE_FIELDS`). */
  readonly engineInputs: readonly string[];
  tier(caps: SafetyCaps, p: LeverParams): SafetyTier;
  readonly constraints: readonly LeverConstraint[];
  complexityCost(p: LeverParams): number;
  /** `name` and `oneLiner` are user-visible plain text; `dossierRefs` is a maintainer pointer (code-only, never rendered). */
  readonly explain: { readonly name: string; readonly oneLiner: string; readonly dossierRefs: readonly string[] };
  /** Dossier record the lever comes from (e.g. '21 §4J L7', '13 §4C B13'): maintainer pointer, code-only, never rendered. */
  readonly source: string;
  /** False when the v1 Schedule has no channel for it (or it only applies to ad-libitum intake). */
  readonly plannerUsable: boolean;
  readonly unsupportedReason?: string;
  /** Used by the v1 skeleton grammar (usable levers may still be catalogue-only). */
  readonly inGrammar: boolean;
  readonly grade: 'A' | 'B' | 'C' | 'D';
}

/**
 * Every Schedule field a lever may write (MODEL_SPEC §5.2 `DayTemplate` / `FastEvent`). The registration check rejects
 * any `engineInputs` entry outside this list.
 */
export const SCHEDULE_FIELDS: readonly string[] = [
  'energy', 'macros.protein', 'macros.carbs', 'macros.fat', 'macros.fibre', 'macros.viscousFibreShare', 'macros.fatTypes.omega3G',
  'macros.fatTypes.mctG', 'macros.sugarsShare', 'macros.proteinSource', 'food.glycaemicIndex', 'food.upfShare',
  'food.energyDensityKcalPerG', 'meals.count', 'meals.window', 'meals.meals', 'meals.split', 'exercise.resistance', 'exercise.cardio',
  'steps', 'sleep.hours', 'sleep.bedH', 'sleep.wakeH', 'substances.caffeine', 'substances.creatineG', 'substances.creatineLoading',
  'hydration.sodiumG', 'hydration.fluidL', 'hydration.electrolytes', 'events.fast', 'days.program', 'days.override', 'blocks',
];

const always = (): SafetyTier => 'default';
const zeroIntakeTier = (caps: SafetyCaps, h: number): SafetyTier => {
  if (!fastAllowed(caps, h)) return 'never';
  const t = tierForHours(h);
  return t === 'T0' || t === 'T1' ? 'default' : t === 'T2' || t === 'T3' ? 'optIn' : t === 'T4' ? 'expert' : 'never';
};
const unsupported = (why: string) => ({ plannerUsable: false, unsupportedReason: why, inGrammar: false });
const NO_CHANNEL = 'Not modelled yet: the simulator has no input for this.';

export const LEVERS: readonly LeverDef[] = [
  // ------------------------------------------------------------------ energy & macronutrients (18 §4.2)
  {
    id: 'energy', version: 1, kind: 'dayParam', family: 'energy', source: '18 §4.2; 13 §4C',
    params: [{ key: 'pct', kind: 'real', min: 45, max: 125, unit: '% of maintenance', grid: 1 }],
    engineInputs: ['energy'], tier: always, constraints: [], complexityCost: () => 0,
    explain: { name: 'Energy intake', oneLiner: 'Daily energy as a percentage of your modelled maintenance, re-anchored every 4 weeks.', dossierRefs: ['02', '13', '17'] },
    plannerUsable: true, inGrammar: true, grade: 'A',
  },
  {
    id: 'protein', version: 1, kind: 'dayParam', family: 'macros', source: '18 §4.2; 03; 17 HC-M1/M2',
    params: [{ key: 'gPerKg', kind: 'real', min: 1.0, max: 2.6, unit: 'g/kg', grid: 0.05 }],
    engineInputs: ['macros.protein'], tier: always, constraints: [], complexityCost: () => 0,
    explain: { name: 'Protein', oneLiner: 'Protein per kg of body weight (reference weight above BMI 27.5).', dossierRefs: ['03', '17'] },
    plannerUsable: true, inGrammar: true, grade: 'A',
  },
  {
    id: 'carbFat', version: 1, kind: 'dayParam', family: 'macros', source: '18 §4.2; 04; 05; 13 §4C',
    params: [
      { key: 'fatGPerKg', kind: 'real', min: 0.3, max: 1.5, unit: 'g/kg', grid: 0.05 },
      { key: 'carbG', kind: 'real', min: 20, max: 50, unit: 'g/d', grid: 5 },
    ],
    engineInputs: ['macros.carbs', 'macros.fat'], tier: always, constraints: [], complexityCost: () => 0,
    explain: { name: 'Carbohydrate and fat split', oneLiner: 'Fat per kg (or carbohydrate grams in very-low-carbohydrate blocks); the other takes the remaining energy.', dossierRefs: ['04', '05', '13'] },
    plannerUsable: true, inGrammar: true, grade: 'A',
  },
  {
    id: 'fibre', version: 1, kind: 'dayParam', family: 'fibre', source: '18 §4.2; 15; 13 B20',
    params: [{ key: 'g', kind: 'real', min: 15, max: 45, unit: 'g/d', grid: 1 }],
    engineInputs: ['macros.fibre'], tier: always, constraints: [], complexityCost: () => 0,
    explain: { name: 'Fibre', oneLiner: 'Total dietary fibre per day, raised by at most 5 g/d per week.', dossierRefs: ['15', '13'] },
    plannerUsable: true, inGrammar: true, grade: 'B',
  },
  {
    id: 'eatingWindow', version: 1, kind: 'dayParam', family: 'timing', source: '18 §4.2; 07; 17 HC-F5; 21 L19',
    params: [
      { key: 'startH', kind: 'real', min: 5, max: 14, unit: 'clock h', grid: 0.5 },
      { key: 'lengthH', kind: 'real', min: 4, max: 14, unit: 'h', grid: 0.5 },
      { key: 'meals', kind: 'int', min: 2, max: 5, unit: 'meals' },
    ],
    engineInputs: ['meals.window', 'meals.count'], tier: (c, p) => ((p.lengthH as number) < c.minWindowH ? 'never' : (p.lengthH as number) < 6 ? 'optIn' : 'default'),
    constraints: [], complexityCost: () => 0,
    explain: { name: 'Eating window', oneLiner: 'First and last meal of the day; windows under 6 h need opt-in and under 4 h are never planned.', dossierRefs: ['07', '17'] },
    plannerUsable: true, inGrammar: true, grade: 'C',
  },
  {
    id: 'resistanceTraining', version: 1, kind: 'dayParam', family: 'training', source: '18 §4.2; 09; 17 HC-X2',
    params: [
      { key: 'sessions', kind: 'int', min: 0, max: 6, unit: 'sessions/wk' },
      { key: 'setsPerRegionWeek', kind: 'real', min: 4, max: 20, unit: 'hard sets/region/wk', grid: 1 },
    ],
    engineInputs: ['exercise.resistance'], tier: (c) => (c.exercise.allowed ? 'default' : 'never'), constraints: [], complexityCost: () => 0,
    explain: { name: 'Resistance training', oneLiner: 'Full-body sessions on your allowed weekdays, spread for rest; novices start at ≤ 10 sets per muscle per week and add ≤ 2 per week.', dossierRefs: ['09', '17'] },
    plannerUsable: true, inGrammar: true, grade: 'A',
  },
  {
    id: 'cardio', version: 1, kind: 'dayParam', family: 'training', source: '18 §4.2; 10; 17 HC-X3/X4',
    params: [
      { key: 'sessions', kind: 'int', min: 0, max: 6, unit: 'sessions/wk' },
      { key: 'minutes', kind: 'real', min: 20, max: 90, unit: 'min', grid: 5 },
      { key: 'pctVo2max', kind: 'real', min: 0.45, max: 0.75, unit: 'fraction of VO2max', grid: 0.05 },
    ],
    engineInputs: ['exercise.cardio'], tier: (c) => (c.exercise.allowed ? 'default' : 'never'), constraints: [], complexityCost: () => 0,
    explain: { name: 'Cardio', oneLiner: 'Moderate aerobic sessions; minutes and intensity are tuned.', dossierRefs: ['10', '17'] },
    plannerUsable: true, inGrammar: true, grade: 'A',
  },

  // ------------------------------------------------------------------ recurring days and fasting family
  {
    id: 'dietBreak', version: 1, kind: 'phaseModifier', family: 'dietBreak', source: '13 §4C B8; 17 HC-E7',
    params: [{ key: 'weeks', kind: 'int', min: 1, max: 2, unit: 'wk' }], engineInputs: ['energy', 'blocks'], tier: always,
    constraints: [{ type: 'allowedInBlocks', blockIds: ['B1', 'B2', 'B6'] }], complexityCost: () => 0,
    explain: { name: 'Diet break', oneLiner: 'One or two weeks at maintenance between deficit blocks; lowers hunger, adds no fat loss.', dossierRefs: ['13'] },
    plannerUsable: true, inGrammar: true, grade: 'B',
  },
  {
    id: 'refeedDay', version: 1, kind: 'dayOverlay', family: 'refeed', source: '13 §4C B9',
    params: [
      { key: 'days', kind: 'int', min: 1, max: 2, unit: 'd/wk' },
      { key: 'pct', kind: 'real', min: 100, max: 120, unit: '% of maintenance', grid: 1 },
      { key: 'carbGPerKg', kind: 'real', min: 6, max: 10, unit: 'g/kg', grid: 0.5 },
    ],
    engineInputs: ['days.override', 'energy', 'macros.carbs', 'macros.fat'], tier: always,
    constraints: [{ type: 'maxPerWindow', family: 'refeed', count: 2, windowDays: 7 }, { type: 'allowedInBlocks', blockIds: ['B1', 'B3', 'B6'] }],
    complexityCost: (p) => 0.5 * Number(p.days ?? 1),
    explain: { name: 'Refeed day', oneLiner: 'A higher-carbohydrate day at 100-120 % of maintenance inside a deficit.', dossierRefs: ['13'] },
    plannerUsable: true, inGrammar: true, grade: 'C',
  },
  {
    id: 'lowDays', version: 1, kind: 'dayOverlay', family: 'restrictedDay', source: '13 §4C B11; 17 HC-E2',
    params: [{ key: 'kcal', kind: 'real', min: 500, max: 700, unit: 'kcal', grid: 10 }],
    engineInputs: ['days.override', 'energy'], tier: (c) => (c.deficitCapPct > 0 ? 'default' : 'never'),
    constraints: [{ type: 'maxPerWindow', family: 'restrictedDay', count: 2, windowDays: 7 }, { type: 'minGapDays', family: 'restrictedDay', days: 2 }],
    complexityCost: () => 1,
    explain: { name: 'Low-energy days', oneLiner: 'Two non-consecutive days a week at 500-700 kcal.', dossierRefs: ['13', '17'] },
    plannerUsable: true, inGrammar: true, grade: 'A',
  },
  {
    id: 'zeroDay', version: 1, kind: 'dayOverlay', family: 'zeroIntake', source: '13 §4C B12; 17 HC-F1/F2; 20 §4C',
    params: [{ key: 'perWeek', kind: 'int', min: 2, max: 3, unit: 'd/wk' }],
    engineInputs: ['days.override', 'energy', 'hydration.electrolytes', 'hydration.fluidL', 'hydration.sodiumG'],
    tier: (c) => zeroIntakeTier(c, 36), // a zero calendar day spans ≥ 36 h between meals (48 h − window)
    constraints: [
      { type: 'minGapDays', family: 'zeroIntake', days: 2 },
      { type: 'maxHoursPerWindow', family: 'zeroIntake', hours: 108, windowDays: 7 },
      { type: 'noTrainingWithin', hoursBefore: 0, hoursAfter: 0 },
    ],
    complexityCost: (p) => 1 + Number(p.perWeek ?? 2) * (36 / 72),
    explain: { name: 'Zero-energy days', oneLiner: 'Whole calendar days without energy (water, electrolytes), 2-3 per week, never consecutive.', dossierRefs: ['13', '17', '20'] },
    plannerUsable: true, inGrammar: true, grade: 'B',
  },
  {
    id: 'fastDay24', version: 1, kind: 'event', family: 'zeroIntake', source: '13 §4C B13; 17 HC-F1/F2/F4; 20 §4C',
    params: [{ key: 'perWeek', kind: 'int', min: 1, max: 2, unit: '/wk' }],
    engineInputs: ['events.fast', 'days.override'], tier: (c) => zeroIntakeTier(c, 24),
    constraints: [
      { type: 'maxPerWindow', family: 'zeroIntake', count: 2, windowDays: 7 },
      { type: 'minGapDays', family: 'zeroIntake', days: 2 },
      { type: 'maxHoursPerWindow', family: 'zeroIntake', hours: 108, windowDays: 7 },
      { type: 'noTrainingWithin', hoursBefore: 0, hoursAfter: 0 },
    ],
    complexityCost: () => 1 + 24 / 72,
    explain: { name: '24-hour fast', oneLiner: 'From the last meal of one day to the same clock hour next day; water and electrolytes only.', dossierRefs: ['07', '13', '17', '20'] },
    plannerUsable: true, inGrammar: true, grade: 'B',
  },
  {
    id: 'waterFast', version: 1, kind: 'event', family: 'zeroIntake', source: '13 §4C B14/B15/B16; 17 §4.3; 20 §4C; MODEL_SPEC §10.3',
    params: [{ key: 'durationH', kind: 'int', min: 36, max: 72, step: 12, unit: 'h' }],
    engineInputs: ['events.fast', 'days.override', 'hydration.electrolytes', 'hydration.fluidL', 'hydration.sodiumG'],
    tier: (c, p) => zeroIntakeTier(c, Number(p.durationH)),
    constraints: [
      { type: 'maxHoursPerWindow', family: 'zeroIntake', hours: 108, windowDays: 7 },
      // 48 h: ≤ 1 per 2 weeks (13 B14, PROPOSED); 72 h: ≤ 1 per month (13 B15) and ≥ 7 d apart, ≤ 2 per 30 d (17 HC-F2)
      { type: 'minGapDays', family: 'zeroIntake', days: 7 },
      { type: 'noTrainingWithin', hoursBefore: 0, hoursAfter: 24 },
      { type: 'recoveryDays', days: 2, maxPct: 100 },
    ],
    complexityCost: (p) => 1 + Number(p.durationH) / 72,
    explain: { name: 'Multi-day water-only fast', oneLiner: 'A 48- or 72-hour water-only fast with electrolytes, followed by locked recovery days (graded refeed after 72 h).', dossierRefs: ['07', '13', '17', '20', '21'] },
    plannerUsable: true, inGrammar: true, grade: 'C',
  },

  // ------------------------------------------------------------------ 21 §4J L1-L19
  {
    id: 'L1', version: 1, kind: 'dayParam', family: 'steps', source: '21 §4J L1',
    params: [{ key: 'steps', kind: 'real', min: 4000, max: 12000, unit: 'steps/d', grid: 500 }],
    engineInputs: ['steps'], tier: always, constraints: [], complexityCost: () => 0,
    explain: { name: 'Step target', oneLiner: 'Daily steps 4,000-12,000, raised by at most 1,000 per week.', dossierRefs: ['21', '10'] },
    plannerUsable: true, inGrammar: true, grade: 'B',
  },
  {
    id: 'L2', version: 1, kind: 'dayParam', family: 'postMealWalk', source: '21 §4J L2',
    params: [{ key: 'minutes', kind: 'real', min: 5, max: 15, unit: 'min', grid: 5 }],
    engineInputs: ['exercise.cardio'], tier: always, constraints: [], complexityCost: () => 0.5,
    explain: { name: 'Post-meal walk', oneLiner: '5-15 min light walking within 30 min after a meal (glycaemia only).', dossierRefs: ['21'] },
    plannerUsable: true, inGrammar: false, grade: 'B',
  },
  { id: 'L3', version: 1, kind: 'dayParam', family: 'neat', source: '21 §4J L3', params: [], engineInputs: [], tier: always, constraints: [], complexityCost: () => 0.5, explain: { name: 'Sit-breaks / standing', oneLiner: 'More standing and short walking breaks.', dossierRefs: ['21'] }, ...unsupported(NO_CHANNEL), grade: 'A' },
  { id: 'L4', version: 1, kind: 'dayParam', family: 'snack', source: '21 §4J L4', params: [], engineInputs: [], tier: () => 'optIn', constraints: [], complexityCost: () => 1, explain: { name: 'Exercise snacks', oneLiner: 'Short near-maximal bouts; no fat-loss credit.', dossierRefs: ['21'] }, ...unsupported(NO_CHANNEL), grade: 'B' },
  {
    id: 'L5', version: 1, kind: 'phaseModifier', family: 'sleep', source: '21 §4J L5',
    params: [{ key: 'extraH', kind: 'real', min: 0.5, max: 1.5, unit: 'h', grid: 0.25 }],
    engineInputs: ['sleep.hours'], tier: always, constraints: [], complexityCost: () => 0.5,
    explain: { name: 'Sleep extension', oneLiner: 'More time in bed toward 7.5-8.5 h when you sleep under 7 h.', dossierRefs: ['21', '16'] },
    plannerUsable: true, inGrammar: true, grade: 'B',
  },
  {
    id: 'L6', version: 1, kind: 'event', family: 'caffeine', source: '21 §4J L6; 17 HC-M11',
    params: [{ key: 'mgPerKg', kind: 'real', min: 3, max: 6, unit: 'mg/kg' }],
    engineInputs: ['substances.caffeine'], tier: (_c, p) => (Number(p.mgPerKg) <= 3 ? 'default' : 'optIn'), constraints: [], complexityCost: () => 0.5,
    explain: { name: 'Caffeine timing', oneLiner: 'Pre-session caffeine, last dose well before bed (performance only).', dossierRefs: ['21', '15'] },
    plannerUsable: true, inGrammar: false, grade: 'A',
  },
  {
    id: 'L7', version: 1, kind: 'dayParam', family: 'creatine', source: '21 §4J L7; 17 HC-M12',
    params: [{ key: 'g', kind: 'real', min: 3, max: 5, unit: 'g/d', grid: 1 }],
    engineInputs: ['substances.creatineG'], tier: (c) => (c.creatineAllowed ? 'default' : 'never'),
    constraints: [{ type: 'requires', leverId: 'resistanceTraining', scope: 'plan' }], complexityCost: () => 0.5,
    explain: { name: 'Creatine', oneLiner: '3-5 g/d creatine monohydrate with resistance training (adds ≈ 1 kg of water to scale weight).', dossierRefs: ['21', '15'] },
    plannerUsable: true, inGrammar: true, grade: 'A',
  },
  {
    id: 'L8', version: 1, kind: 'dayParam', family: 'omega3', source: '21 §4J L8',
    params: [{ key: 'g', kind: 'real', min: 2, max: 3, unit: 'g/d EPA+DHA', grid: 0.5 }],
    engineInputs: ['macros.fatTypes.omega3G'], tier: (c) => (c.flags.has('anticoagulant') ? 'never' : 'optIn'), constraints: [], complexityCost: () => 0.5,
    explain: { name: 'Omega-3', oneLiner: '2-3 g/d EPA+DHA for triglyceride or blood-pressure goals (opt-in).', dossierRefs: ['21', '06'] },
    plannerUsable: true, inGrammar: true, grade: 'A',
  },
  {
    id: 'L9', version: 1, kind: 'dayParam', family: 'fibre', source: '21 §4J L9',
    params: [{ key: 'g', kind: 'real', min: 5, max: 15, unit: 'g/d viscous fibre', grid: 1 }],
    engineInputs: ['macros.fibre', 'macros.viscousFibreShare'], tier: always, constraints: [], complexityCost: () => 0.5,
    explain: { name: 'Viscous fibre', oneLiner: '5-15 g/d psyllium or oat beta-glucan before meals, for LDL goals; skipped on zero-energy days.', dossierRefs: ['21', '15', '06'] },
    plannerUsable: true, inGrammar: true, grade: 'A',
  },
  { id: 'L10', version: 1, kind: 'dayParam', family: 'mealOrder', source: '21 §4J L10', params: [], engineInputs: [], tier: always, constraints: [], complexityCost: () => 0.5, explain: { name: 'Protein-first meal order', oneLiner: 'Protein and vegetables before carbohydrate.', dossierRefs: ['21'] }, ...unsupported(NO_CHANNEL), grade: 'C' },
  { id: 'L11', version: 1, kind: 'dayParam', family: 'preload', source: '21 §4J L11', params: [], engineInputs: [], tier: always, constraints: [], complexityCost: () => 0.5, explain: { name: 'Water preload', oneLiner: '500 mL water before main meals.', dossierRefs: ['21'] }, ...unsupported('Not modelled yet: an adherence or ad-libitum effect only, and the simulator has no input for it.'), grade: 'B' },
  { id: 'L12', version: 1, kind: 'dayParam', family: 'foodEnv', source: '21 §4J L12', params: [], engineInputs: [], tier: always, constraints: [], complexityCost: () => 0.5, explain: { name: 'Food environment', oneLiner: 'Lower energy density and less ultra-processed food.', dossierRefs: ['21'] }, ...unsupported('Applies only when intake is ad libitum; a planned day prescribes its intake, so it has no effect here.'), grade: 'A' },
  { id: 'L13', version: 1, kind: 'phaseModifier', family: 'monitor', source: '21 §4J L13', params: [], engineInputs: [], tier: always, constraints: [], complexityCost: () => 0.5, explain: { name: 'Self-monitoring', oneLiner: 'Weekly weighing and food logging.', dossierRefs: ['21'] }, ...unsupported('Not modelled yet: it affects only how well a plan is followed, and the simulator has no input for it.'), grade: 'B' },
  { id: 'L14', version: 1, kind: 'dayOverlay', family: 'mealRep', source: '21 §4J L14', params: [], engineInputs: [], tier: always, constraints: [], complexityCost: () => 0.5, explain: { name: 'Meal replacement', oneLiner: '1-2 portion-controlled meals a day.', dossierRefs: ['21'] }, ...unsupported(NO_CHANNEL), grade: 'A' },
  { id: 'L15', version: 1, kind: 'event', family: 'sauna', source: '21 §4J L15', params: [], engineInputs: [], tier: () => 'optIn', constraints: [], complexityCost: () => 1, explain: { name: 'Sauna', oneLiner: '10-20 min sessions 2-4 times a week.', dossierRefs: ['21'] }, ...unsupported(NO_CHANNEL), grade: 'C' },
  { id: 'L16', version: 1, kind: 'event', family: 'cold', source: '21 §4J L16', params: [], engineInputs: [], tier: () => 'optIn', constraints: [{ type: 'noTrainingWithin', hoursBefore: 0, hoursAfter: 6 }], complexityCost: () => 1, explain: { name: 'Cold exposure', oneLiner: 'Cold showers or immersion; never within 6 h after RT when a muscle goal ranks top-2.', dossierRefs: ['21'] }, ...unsupported(NO_CHANNEL), grade: 'C' },
  { id: 'L17', version: 1, kind: 'event', family: 'perfStack', source: '21 §4J L17', params: [], engineInputs: [], tier: () => 'optIn', constraints: [], complexityCost: () => 1, explain: { name: 'Event-day performance stack', oneLiner: 'Nitrate, beta-alanine, citrulline, bicarbonate for events.', dossierRefs: ['21'] }, ...unsupported(NO_CHANNEL), grade: 'A' },
  { id: 'L18', version: 1, kind: 'dayParam', family: 'alcoholFree', source: '21 §4J L18; 17 HC-M10', params: [], engineInputs: [], tier: always, constraints: [], complexityCost: () => 0, explain: { name: 'No alcohol after training', oneLiner: 'The planner never prescribes alcohol, so this holds by construction.', dossierRefs: ['21', '17'] }, ...unsupported('Satisfied by construction: planned days contain no alcohol.'), grade: 'B' },
  {
    id: 'L19', version: 1, kind: 'dayParam', family: 'mealClock', source: '21 §4J L19',
    params: [{ key: 'hoursBeforeBed', kind: 'real', min: 3, max: 3, unit: 'h' }],
    engineInputs: ['meals.window'], tier: always, constraints: [], complexityCost: () => 0,
    explain: { name: 'No late eating', oneLiner: 'Last meal at least 3 h before bedtime (shift workers exempt).', dossierRefs: ['21', '07'] },
    plannerUsable: true, inGrammar: true, grade: 'B',
  },
];

export const LEVER_INDEX: ReadonlyMap<string, LeverDef> = new Map(LEVERS.map((l) => [l.id, l]));

export function lever(id: string): LeverDef {
  const l = LEVER_INDEX.get(id);
  if (!l) throw new Error(`unknown lever "${id}"`);
  return l;
}

export interface RegistryProblem {
  lever: string;
  problem: string;
}

/** Registration check (18 §4.4.7): unique ids, engine inputs inside the Schedule field list, params well-formed. */
export function checkLeverRegistry(levers: readonly LeverDef[] = LEVERS): RegistryProblem[] {
  const out: RegistryProblem[] = [];
  const seen = new Set<string>();
  const fields = new Set(SCHEDULE_FIELDS);
  for (const l of levers) {
    if (seen.has(l.id)) out.push({ lever: l.id, problem: 'duplicate id' });
    seen.add(l.id);
    if (l.plannerUsable && l.engineInputs.length === 0) out.push({ lever: l.id, problem: 'usable lever writes no Schedule field' });
    for (const f of l.engineInputs) if (!fields.has(f)) out.push({ lever: l.id, problem: `engine input "${f}" is not a Schedule field` });
    if (!l.plannerUsable && !l.unsupportedReason) out.push({ lever: l.id, problem: 'unusable lever without a reason' });
    if (l.inGrammar && !l.plannerUsable) out.push({ lever: l.id, problem: 'grammar lever must be usable' });
    for (const p of l.params) {
      if (p.kind !== 'cat' && !(p.min <= p.max)) out.push({ lever: l.id, problem: `param ${p.key}: min > max` });
    }
  }
  return out;
}
