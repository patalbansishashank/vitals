/**
 * Goal suggestion (SUITE_SPEC §13.4, PLAN 02 item 8): a deterministic, rule-based suggester that reads what the person
 * has already answered (body estimate, intake, entered blood markers, device sleep) and proposes a ranked goal set with
 * one plain sentence of why per goal, the practical limits their answers imply, and a list of what is missing instead
 * of a guess. Pure: no clock, no IO; the caller gathers the input (and the fastest-safe reach estimate) and stamps the
 * time on the stored record.
 *
 * The same output shape is produced by the Coach-assisted variant (`source: 'ai'`); `coerceSuggestion` turns a model
 * reply into this shape and `checkAgainstRule` is the oracle: an AI suggestion that does not agree with `rule@1` on the
 * essentials is replaced by the rule result (see `docs/wp/E19.md`).
 *
 * Healthy body-fat band: Gallagher et al. 2000 (Am J Clin Nutr 72:694, doi 10.1093/ajcn/72.3.694) — the body fat that
 * corresponds to BMI 18.5 and 25 for the person's sex and age, from the paper's own prediction equation (the engine's
 * `gallagher2000`; SEE 2.8–5.4 percentage points, grade B as a guideline proposal, white/African-American/Asian adults).
 */
import { gallagher2000 } from '@/engine/body/equations';
import type { MetricId } from '@/engine/types/metrics';
import type { HabitProfile, LabBaselines } from '@/engine/types/profile';
import type { TargetReach } from './types';

export const SUGGEST_RULE_VERSION = 'rule@1';
/** At most six ranked goals (the Planner's limit). */
export const SUGGEST_MAX_GOALS = 6;
/** Default horizon the targets are read at (16 weeks, the Planner's default). */
export const SUGGEST_HORIZON_DAYS = 112;
/** Training for at least half a year counts as "training" for the muscle-first rule. */
export const TRAINED_MIN_YEARS = 0.5;
/** Device sleep shorter than the need by more than this, per night over 14 nights, makes a sleep suggestion. */
export const SLEEP_DEBT_MIN_H = 1;

/* ------------------------------------------------------------------------------------------------- input */

export type SuggestSex = 'male' | 'female';
export type MarkerSeverity = 'info' | 'caution' | 'danger';
export type FastingTierOptIn = 'T2' | 'T3' | 'T4';

/** The facts of Your body the suggester reads (structural; built by the caller from the profile store). */
export interface SuggestProfile {
  /** Sex, age, height and weight are the person's own (not placeholders). */
  complete: boolean;
  sex: SuggestSex | null;
  ageYears: number | null;
  heightCm: number | null;
  weightKg: number | null;
  habits?: HabitProfile;
  labs?: LabBaselines;
}

export interface SuggestBody {
  /** Body-fat estimate, % (null without a body). */
  bfPct: number | null;
  /** Likely range of that estimate (80 %). */
  bfBand: [number, number] | null;
  leanKg: number | null;
  /** A measured waist, cm (absent when not measured). */
  waistCm?: number;
  visceralKg?: number;
  /** Years of training (none 0, under a year 0.5, 1–3 y 2, over 3 y 4); null when not answered. */
  trainingAgeY: number | null;
  /** The body-fat estimate rests on population averages only (no shape, measurement or training answer). */
  basedOnAverages?: boolean;
  /** Body fat was measured (scan, calipers…). */
  measuredBodyFat?: boolean;
}

/** The parts of the intake document (`intake/me`) the suggester reads; every field is optional (thin profiles). */
export interface SuggestIntake {
  activity?: object;
  training?: {
    owned?: readonly string[];
    /** Where the person trains: the intake stores `{ place, equipment, weekdays }` rows (older answers: plain place names). */
    access?: ReadonlyArray<string | { place: string }>;
    prefs?: { daysPerWeek?: number; minPerSession?: number; bestTime?: string };
  };
  diet?: {
    rulesComplete?: boolean;
    animalFoods?: { meat?: string; fish?: boolean; eggs?: string; dairy?: string };
    jain?: object;
  };
  devices?: { has?: readonly string[] };
  skipped?: Partial<Record<string, string>>;
}

/** A blood-marker note (the markers package's `MarkerNote`, the fields read here). */
export interface MarkerNote {
  markerId: string;
  severity: MarkerSeverity;
  because: { markerId: string; label: string; value: number; unit: string; date?: string };
  text?: string;
}

export interface SuggestDevices {
  /** Mean nightly shortfall against the sleep need over the last 14 nights, h (absent: no sleep data). */
  sleepDebtH?: number;
  /** Nights of device sleep behind `sleepDebtH`. */
  sleepNights?: number;
  /** Heart-rate variability below the person's own usual range. */
  hrvBelow?: boolean;
  steps7d?: number;
}

export interface SuggestSafety {
  /** The safety answers lock weight-loss goals (e.g. pregnancy, eating-disorder history). */
  noWeightLossGoal: boolean;
  /** The fasting tier the person opted into (null: never opted in). */
  optedTier: FastingTierOptIn | null;
  /** The longest fast the safety answers allow, h. */
  maxFastHours?: number;
}

export interface GoalSuggestionInput {
  profile: SuggestProfile;
  body: SuggestBody;
  intake: SuggestIntake;
  /** Notes from entered blood markers (empty when none were entered). */
  markers: MarkerNote[];
  /** Whether a blood test was entered at all (absent = the person was never asked or skipped). */
  markersAnswered?: boolean;
  devices: SuggestDevices;
  safety: SuggestSafety;
  /** Fastest-safe reach answers for the probe goals (`suggestionProbeGoals`), any order; empty = no estimate yet. */
  reach: TargetReach[];
  horizonDays?: number;
}

/* ------------------------------------------------------------------------------------------------ output */

export type SuggestedMode = 'lose' | 'keep' | 'gain' | 'raise' | 'lower';

export interface SuggestedGoal {
  rank: number;
  metric: MetricId;
  /** Magnitude in metric units (kg); absent for directional goals. */
  target?: number;
  unit?: string;
  /** The Goals page's goal type (lose/keep/gain take a target; raise/lower are directional). */
  mode: SuggestedMode;
  /** Where the target comes from. */
  targetFrom: 'fastestSafeReach' | 'band' | 'keep' | 'direction';
  /** One plain sentence. */
  why: string;
  /** The marker reading behind a marker goal (for the "because" chip). */
  because?: MarkerNote['because'];
}

/** The practical limits a suggestion sets (the Goals page's limit names; fasting only when already opted in). */
export interface SuggestedConstraints {
  trainingDays?: [number, number];
  trainingTimeH?: number;
  maxSessionMin?: number;
  earliestH?: number;
  latestH?: number;
  longestFastH?: 24 | 48 | 72;
  sleepFixed?: boolean;
}

export interface SuggestedNote {
  topic: 'sleep' | 'recovery' | 'marker' | 'safety' | 'equipment' | 'food';
  text: string;
}

export interface MissingAnswer {
  /** What is missing (stable id). */
  field: string;
  /** The question that answers it (`<chapter>.<question>`; `body.*` = Your body). */
  question: string;
  why: string;
}

export interface GoalSuggestion {
  source: 'rule' | 'ai';
  /** 'rule@1' | `ai:<model>@<briefing version>`. */
  version: string;
  goals: SuggestedGoal[];
  constraints: SuggestedConstraints;
  /** Lines carried from the answers that are not goals or limits (equipment, food pattern, sleep, markers without a goal). */
  notes: SuggestedNote[];
  missing: MissingAnswer[];
  /** AI only, at most two clarifying questions. */
  clarify?: string[];
  /** Set when the result had to fall back to the rules. */
  fallback?: string;
}

/* ------------------------------------------------------------------------------------------------ helpers */

const r1 = (x: number) => Math.round(x * 10) / 10;
const r0 = (x: number) => Math.round(x);
/** Round down to a half (targets never overshoot the safe estimate). */
const floorHalf = (x: number) => Math.floor(x * 2 + 1e-9) / 2;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Healthy body-fat band (%) for sex and age: Gallagher 2000 at BMI 18.5 and 25 (age clamped to the paper's 20–79). */
export function healthyBodyFatBand(sex: SuggestSex | null, ageYears: number | null): [number, number] {
  const age = clamp(ageYears ?? 40, 20, 79);
  const band = (s: SuggestSex): [number, number] => [gallagher2000(s, age, 18.5), gallagher2000(s, age, 25)];
  if (sex) return band(sex);
  const m = band('male');
  const f = band('female');
  return [(m[0] + f[0]) / 2, (m[1] + f[1]) / 2];
}

/** Years of training from the habits answer (null = not answered). */
export function trainingYears(history: HabitProfile['trainingHistory'] | undefined): number | null {
  switch (history) {
    case 'none':
      return 0;
    case 'lt1y':
      return 0.5;
    case '1to3y':
      return 2;
    case 'gt3y':
      return 4;
    default:
      return null;
  }
}

/** The goals the caller asks the reach estimator about (fat-loss route and muscle-gain route). */
export function suggestionProbeGoals(): Array<{ metric: MetricId; mode: 'lose' | 'gain'; amount: number }> {
  return [
    { metric: 'fatMass', mode: 'lose', amount: 5 },
    { metric: 'skeletalMuscle', mode: 'gain', amount: 1 },
  ];
}

const reachOf = (input: GoalSuggestionInput, metric: MetricId): TargetReach | undefined =>
  input.reach.find((r) => r.metric === metric && r.supported && finite(r.changeAtHorizon));

/** Fat (kg) above the top of the healthy band at the current lean mass. */
export function fatAboveBandKg(weightKg: number, bfPct: number, bandTopPct: number): number {
  const fat = (weightKg * bfPct) / 100;
  const lean = weightKg - fat;
  const fatAtTop = (bandTopPct * lean) / (100 - bandTopPct);
  return Math.max(0, fat - fatAtTop);
}

/* ---------------------------------------------------------------------------------------- blood markers */

/** Marker id → the goal metric that moves it (markers with no plannable outcome are notes only). */
const MARKER_GOAL: Readonly<Record<string, { metric: MetricId; mode: 'lower' | 'raise' }>> = {
  ldl: { metric: 'ldl', mode: 'lower' },
  nonHdl: { metric: 'ldl', mode: 'lower' },
  apoB: { metric: 'apoB', mode: 'lower' },
  tg: { metric: 'triglycerides', mode: 'lower' },
  fpg: { metric: 'fastingGlucose', mode: 'lower' },
  hba1c: { metric: 'fastingGlucose', mode: 'lower' },
  insulin: { metric: 'insulinSensitivity', mode: 'raise' },
  alt: { metric: 'liverFat', mode: 'lower' },
  ggt: { metric: 'liverFat', mode: 'lower' },
  hsCrp: { metric: 'crp', mode: 'lower' },
};
const MARKER_ORDER = ['ldl', 'apoB', 'nonHdl', 'tg', 'hba1c', 'fpg', 'insulin', 'alt', 'ggt', 'hsCrp'];
const SEVERITY_RANK: Readonly<Record<MarkerSeverity, number>> = { danger: 0, caution: 1, info: 2 };

/**
 * Notes from the readings typed on Your body (`profile.labs`), for when the markers chapter has not landed or was not
 * used. Only readings above a published threshold make a note (plan research on blood markers §1, §3):
 * LDL ≥ 160 mg/dL (≥ 190: possible familial hypercholesterolaemia); TG ≥ 150 mg/dL (≥ 500 severe); fasting glucose ≥ 100
 * mg/dL (≥ 126 diabetes range, ADA); HbA1c ≥ 5.7 % (≥ 6.5 diabetes range, ADA); hs-CRP 3–10 mg/L (above 10 reads as a recent illness, not a goal); uric acid ≥ 6.8 mg/dL (saturation).
 */
export function labNotes(labs: LabBaselines | undefined): MarkerNote[] {
  if (!labs) return [];
  const out: MarkerNote[] = [];
  const add = (markerId: string, label: string, value: number | undefined, unit: string, caution: number, danger: number | null) => {
    if (!finite(value) || value < caution) return;
    const severity: MarkerSeverity = danger !== null && value >= danger ? 'danger' : 'caution';
    out.push({ markerId, severity, because: { markerId, label, value, unit } });
  };
  add('ldl', 'LDL', labs.ldlMmolL, 'mmol/L', 4.14, 4.91);
  add('tg', 'triglycerides', labs.tgMmolL, 'mmol/L', 1.69, 5.65);
  add('fpg', 'fasting glucose', labs.fastingGlucoseMmolL, 'mmol/L', 5.55, 7.0);
  add('hba1c', 'HbA1c', labs.hba1cPct, '%', 5.7, 6.5);
  if (finite(labs.crpMgL) && labs.crpMgL >= 3 && labs.crpMgL <= 10) add('hsCrp', 'hs-CRP', labs.crpMgL, 'mg/L', 3, null);
  add('urate', 'uric acid', labs.urateMgDl, 'mg/dL', 6.8, null);
  return out;
}

const markerValueText = (b: MarkerNote['because']) => `${b.label} ${b.value} ${b.unit}${b.date ? ` on ${b.date}` : ''}`;

/* -------------------------------------------------------------------------------------------- the rules */

const WHY = {
  bf: (b: SuggestBody, band: [number, number]) =>
    `body fat about ${r0(b.bfPct!)} %${b.bfBand ? ` (likely ${r0(b.bfBand[0])}–${r0(b.bfBand[1])})` : ''}, ` +
    `${b.bfPct! > band[1] ? 'above' : b.bfPct! < band[0] ? 'below' : 'within'} the healthy band of ${r0(band[0])}–${r0(band[1])} % for your age and sex`,
};

function bodyGoals(input: GoalSuggestionInput, notes: SuggestedNote[]): Omit<SuggestedGoal, 'rank'>[] {
  const { profile, body, safety } = input;
  if (!profile.complete || !finite(body.bfPct) || !finite(profile.weightKg)) return [];
  const band = healthyBodyFatBand(profile.sex, profile.ageYears);
  const bf = body.bfPct;
  const above = bf > band[1];
  const below = bf < band[0];
  const years = body.trainingAgeY;
  const trained = years !== null && years >= TRAINED_MIN_YEARS;
  const weeks = Math.round((input.horizonDays ?? SUGGEST_HORIZON_DAYS) / 7);
  const out: Omit<SuggestedGoal, 'rank'>[] = [];

  if (above) {
    if (safety.noWeightLossGoal) {
      notes.push({ topic: 'safety', text: `Your body fat is above the healthy band, but your safety answers keep weight-loss goals out of plans, so none is suggested.` });
    } else {
      const excess = fatAboveBandKg(profile.weightKg, bf, band[1]);
      const fat = reachOf(input, 'fatMass');
      const safeKg = fat ? Math.abs(fat.changeAtHorizon) : null;
      const raw = safeKg !== null ? Math.min(safeKg, excess) : excess;
      const target = Math.max(0.5, floorHalf(raw));
      const from: SuggestedGoal['targetFrom'] = safeKg !== null && safeKg < excess ? 'fastestSafeReach' : 'band';
      const how =
        from === 'fastestSafeReach'
          ? `; ${r1(target)} kg is about what the fastest safe rate reaches in ${weeks} weeks`
          : `; ${r1(target)} kg brings it to the top of that band`;
      out.push({ metric: 'fatMass', mode: 'lose', target, unit: 'kg', targetFrom: from, why: `Your ${WHY.bf(body, band)}${how}.` });
    }
    if (trained) {
      out.push({
        metric: 'skeletalMuscle',
        mode: 'keep',
        targetFrom: 'keep',
        why: `You have trained for ${years! >= 1 ? 'more than a year' : 'at least six months'}, so plans keep your muscle and build it where the deficit allows (recomposition).`,
      });
    } else {
      out.push({
        metric: 'leanTissue',
        mode: 'keep',
        targetFrom: 'keep',
        why: 'Keeping lean mass while losing fat protects your maintenance energy and strength.',
      });
    }
    return out;
  }

  if (trained) {
    const gain = reachOf(input, 'skeletalMuscle');
    const kg = gain ? Math.abs(gain.changeAtHorizon) : null;
    if (kg !== null && kg >= 0.2) {
      const target = Math.max(0.2, Math.floor(kg * 10) / 10);
      out.push({
        metric: 'skeletalMuscle',
        mode: 'gain',
        target,
        unit: 'kg',
        targetFrom: 'fastestSafeReach',
        why: `Your ${WHY.bf(body, band)} and you train, so muscle comes first; about ${r1(target)} kg is what a lean gain reaches in ${weeks} weeks.`,
      });
    } else {
      out.push({
        metric: 'skeletalMuscle',
        mode: 'keep',
        targetFrom: 'keep',
        why: `Your ${WHY.bf(body, band)} and you train, so muscle comes first; plans build it as far as they safely can.`,
      });
    }
    if (!below)
      out.push({ metric: 'fatMass', mode: 'keep', targetFrom: 'keep', why: 'Your body fat is already in the healthy band, so plans hold it while muscle grows.' });
    out.push({ metric: 'strength', mode: 'raise', targetFrom: 'direction', why: 'Strength rises with the same training and is the first sign the muscle goal is working.' });
    return out;
  }

  if (years === 0 || years === null) {
    // not training (or not said): no muscle-vs-fat call; a below-band body never gets a loss goal
    if (below)
      out.push({
        metric: 'leanTissue',
        mode: 'keep',
        targetFrom: 'keep',
        why: `Your ${WHY.bf(body, band)}; plans should not lower it further, and keeping lean mass comes first.`,
      });
    if (years === 0)
      out.push({ metric: 'strength', mode: 'raise', targetFrom: 'direction', why: 'You do not train yet; strength improves fastest in the first months of lifting.' });
  }
  return out;
}

function markerGoals(input: GoalSuggestionInput, notes: SuggestedNote[]): Omit<SuggestedGoal, 'rank'>[] {
  const relevant = input.markers
    .filter((n) => n.severity === 'caution' || n.severity === 'danger')
    .slice()
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || idx(a.markerId) - idx(b.markerId) || a.markerId.localeCompare(b.markerId));
  const out: Omit<SuggestedGoal, 'rank'>[] = [];
  for (const n of relevant) {
    const goal = MARKER_GOAL[n.markerId];
    const v = markerValueText(n.because);
    if (!goal) {
      notes.push({ topic: 'marker', text: `Your ${v} is high; no goal moves it directly, so plans take it into account as a limit.` });
      continue;
    }
    if (out.some((g) => g.metric === goal.metric)) continue;
    out.push({
      metric: goal.metric,
      mode: goal.mode,
      targetFrom: 'direction',
      why: `Your ${v} is ${n.severity === 'danger' ? 'well above' : 'above'} the usual range, so ${goal.mode === 'lower' ? 'lowering' : 'improving'} it is a goal plans can work on.`,
      because: n.because,
    });
    if (n.severity === 'danger') notes.push({ topic: 'marker', text: `Your ${v} is in a range to discuss with a clinician; plans are not a substitute for that.` });
  }
  return out;
}
const idx = (id: string) => {
  const i = MARKER_ORDER.indexOf(id);
  return i < 0 ? MARKER_ORDER.length : i;
};

const TIME_OF_DAY: Readonly<Record<string, number>> = { morning: 7, midday: 12, evening: 18 };
const TIER_HOURS: Readonly<Record<FastingTierOptIn, 48 | 72>> = { T2: 48, T3: 72, T4: 72 };

function constraintsOf(input: GoalSuggestionInput, notes: SuggestedNote[]): SuggestedConstraints {
  const out: SuggestedConstraints = {};
  const prefs = input.intake.training?.prefs;
  if (prefs) {
    if (finite(prefs.daysPerWeek)) {
      const d = clamp(Math.round(prefs.daysPerWeek), 0, 6);
      out.trainingDays = [Math.min(2, d), d];
    }
    if (finite(prefs.minPerSession)) out.maxSessionMin = clamp(Math.round(prefs.minPerSession), 20, 150);
    const h = prefs.bestTime ? TIME_OF_DAY[prefs.bestTime] : undefined;
    if (h !== undefined) out.trainingTimeH = h;
  }
  const habits = input.profile.habits;
  if (habits && finite(habits.habitualWindowStartH) && finite(habits.habitualWindowLengthH)) {
    out.earliestH = clamp(Math.floor(habits.habitualWindowStartH), 0, 23);
    out.latestH = clamp(Math.ceil(habits.habitualWindowStartH + habits.habitualWindowLengthH), out.earliestH + 1, 24);
  }
  // fasting only when the person already opted in (and never above what the safety answers allow)
  const tier = input.safety.optedTier;
  if (tier) {
    const cap = input.safety.maxFastHours;
    const h = TIER_HOURS[tier];
    out.longestFastH = finite(cap) && cap < h ? (cap >= 48 ? 48 : 24) : h;
  }
  const debt = input.devices.sleepDebtH;
  if (finite(debt) && debt > SLEEP_DEBT_MIN_H) {
    out.sleepFixed = false;
    notes.push({
      topic: 'sleep',
      text: `Your device shows about ${r1(debt)} h a night less sleep than you need over the last ${input.devices.sleepNights ?? 14} nights, so plans may move your bedtime earlier.`,
    });
  }
  if (input.devices.hrvBelow)
    notes.push({ topic: 'recovery', text: 'Your heart-rate variability is below your usual range, so a gentler start is worth considering.' });
  return out;
}

function carriedNotes(input: GoalSuggestionInput, notes: SuggestedNote[]): void {
  const t = input.intake.training;
  if (t && (t.owned?.length || t.access?.length)) {
    const places = [...new Set((t.access ?? []).map((a) => (typeof a === 'string' ? a : a.place)).filter(Boolean))];
    const where = places.length ? places.join(' and ') : 'home';
    const kit = t.owned?.length ? `${t.owned.length} piece${t.owned.length === 1 ? '' : 's'} of equipment` : 'no equipment';
    notes.push({ topic: 'equipment', text: `Training: ${where} with ${kit}, as you answered.` });
  }
  const d = input.intake.diet;
  if (d?.rulesComplete && d.animalFoods) {
    const a = d.animalFoods;
    const pattern =
      a.meat && a.meat !== 'none'
        ? 'eats meat'
        : a.fish
          ? 'eats fish, no meat'
          : a.eggs === 'yes'
            ? 'vegetarian with eggs'
            : a.dairy && a.dairy !== 'none'
              ? 'vegetarian'
              : 'plant-based';
    notes.push({ topic: 'food', text: `Food: ${pattern}${d.jain ? ', Jain rules' : ''}, as you answered.` });
  }
}

function missingOf(input: GoalSuggestionInput): MissingAnswer[] {
  const out: MissingAnswer[] = [];
  const { profile, body, intake, devices } = input;
  if (!profile.complete) out.push({ field: 'body', question: 'body.basics', why: 'Sex, age, height and weight are where every estimate starts.' });
  if (body.trainingAgeY === null)
    out.push({ field: 'trainingHistory', question: 'training.experience', why: 'How long you have trained decides between building muscle and keeping it.' });
  if (profile.complete && body.waistCm === undefined && !body.measuredBodyFat)
    out.push({ field: 'waist', question: 'body.waist', why: 'A waist measurement would sharpen the body-fat estimate.' });
  if (!intake.activity && !intake.skipped?.['activity'])
    out.push({ field: 'activity', question: 'activity.work', why: 'Your daily activity sets how much energy you use.' });
  if (!intake.training?.prefs && !intake.skipped?.['training'])
    out.push({ field: 'trainingTime', question: 'training.time', why: 'Days and minutes you can train set the training limits.' });
  if (!intake.diet?.rulesComplete && !intake.skipped?.['diet'])
    out.push({ field: 'food', question: 'food.rules', why: 'What you eat decides which foods plans may use.' });
  if (input.markersAnswered !== true && input.markers.length === 0 && !profile.labs)
    out.push({ field: 'markers', question: 'markers.has', why: 'No blood markers entered, so no marker goals.' });
  if (!finite(devices.sleepDebtH))
    out.push({ field: 'sleep', question: 'devices.has', why: 'No device sleep data, so no sleep suggestion.' });
  return out;
}

/** The rule-based suggestion (`rule@1`). Deterministic: the same input always gives the same output. */
export function suggestGoals(input: GoalSuggestionInput): GoalSuggestion {
  const notes: SuggestedNote[] = [];
  const missing = missingOf(input);
  const base = { source: 'rule' as const, version: SUGGEST_RULE_VERSION };
  // no body (or nothing answered): never a guess
  if (!input.profile.complete) return { ...base, goals: [], constraints: {}, notes: [], missing };

  const goals: Omit<SuggestedGoal, 'rank'>[] = [];
  for (const g of [...bodyGoals(input, notes), ...markerGoals(input, notes)]) {
    if (goals.length >= SUGGEST_MAX_GOALS) break;
    if (!goals.some((x) => x.metric === g.metric)) goals.push(g);
  }
  const constraints = constraintsOf(input, notes);
  carriedNotes(input, notes);
  return { ...base, goals: goals.map((g, i) => ({ rank: i + 1, ...g })), constraints, notes, missing };
}

/* ----------------------------------------------------------------------------------- the AI variant's oracle */

const MODES: readonly SuggestedMode[] = ['lose', 'keep', 'gain', 'raise', 'lower'];
const CONSTRAINT_KEYS: readonly (keyof SuggestedConstraints)[] = ['trainingDays', 'trainingTimeH', 'maxSessionMin', 'earliestH', 'latestH', 'longestFastH', 'sleepFixed'];
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 300): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

/**
 * A model reply → `GoalSuggestion` (`source: 'ai'`). Goal metrics, modes and constraint names are coerced onto the
 * rule vocabulary; anything unknown is dropped. `isMetric` says which metric ids may be goals. Returns null when the
 * reply has no usable shape.
 */
export function coerceSuggestion(raw: unknown, version: string, isMetric: (id: string) => boolean): GoalSuggestion | null {
  if (!isRec(raw) || !Array.isArray(raw.goals)) return null;
  const goals: SuggestedGoal[] = [];
  for (const g of raw.goals) {
    if (!isRec(g) || typeof g.metric !== 'string' || !isMetric(g.metric)) continue;
    const mode = MODES.find((m) => m === g.mode);
    const why = str(g.why);
    if (!mode || !why || goals.some((x) => x.metric === g.metric)) continue;
    const target = finite(g.target) && g.target > 0 ? g.target : undefined;
    goals.push({
      rank: goals.length + 1,
      metric: g.metric as MetricId,
      mode,
      ...(target !== undefined ? { target, unit: str(g.unit, 12) ?? 'kg' } : {}),
      targetFrom: target !== undefined ? 'fastestSafeReach' : mode === 'keep' ? 'keep' : 'direction',
      why,
    });
    if (goals.length >= SUGGEST_MAX_GOALS) break;
  }
  const constraints: SuggestedConstraints = {};
  if (isRec(raw.constraints)) {
    const c = raw.constraints;
    for (const k of CONSTRAINT_KEYS) {
      const v = c[k];
      if (k === 'trainingDays') {
        if (Array.isArray(v) && v.length === 2 && v.every(finite)) constraints.trainingDays = [v[0] as number, v[1] as number];
      } else if (k === 'sleepFixed') {
        if (typeof v === 'boolean') constraints.sleepFixed = v;
      } else if (k === 'longestFastH') {
        if (v === 24 || v === 48 || v === 72) constraints.longestFastH = v;
      } else if (finite(v)) (constraints as Record<string, number>)[k] = v;
    }
  }
  const missing: MissingAnswer[] = Array.isArray(raw.missing)
    ? raw.missing.filter(isRec).flatMap((m) => {
        const field = str(m.field, 60);
        return field ? [{ field, question: str(m.question, 60) ?? '', why: str(m.why) ?? '' }] : [];
      })
    : [];
  const clarify = Array.isArray(raw.clarify) ? raw.clarify.map((q) => str(q, 200)).filter((q): q is string => !!q).slice(0, 2) : [];
  const notes: SuggestedNote[] = Array.isArray(raw.notes)
    ? raw.notes.filter(isRec).flatMap((n) => {
        const text = str(n.text);
        const topic = (['sleep', 'recovery', 'marker', 'safety', 'equipment', 'food'] as const).find((t) => t === n.topic);
        return text && topic ? [{ topic, text }] : [];
      })
    : [];
  return { source: 'ai', version, goals, constraints, notes, missing, ...(clarify.length ? { clarify } : {}) };
}

const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Where an AI suggestion disagrees with the rules (empty = acceptable). The AI result must: keep the rule's first two
 * goal metrics in its first two ranks (as a set) — none when the rules found none; keep targets within ±10 % of the
 * rule targets for the same metric; set only limits the rules set, with the same values (they come from the answers);
 * and list at least everything the rules list as missing.
 */
export function checkAgainstRule(rule: GoalSuggestion, ai: GoalSuggestion): string[] {
  const issues: string[] = [];
  const top = (s: GoalSuggestion) => new Set(s.goals.slice(0, 2).map((g) => g.metric));
  const rt = top(rule);
  const at = top(ai);
  if (rule.goals.length === 0 && ai.goals.length > 0) issues.push('goals without enough answers');
  else if (rt.size !== at.size || [...rt].some((m) => !at.has(m))) issues.push('different first goals');
  for (const g of ai.goals) {
    const r = rule.goals.find((x) => x.metric === g.metric);
    if (r?.target !== undefined && g.target !== undefined && Math.abs(g.target - r.target) > 0.1 * Math.abs(r.target) + 1e-9) issues.push(`target for ${g.metric}`);
    if (r && r.mode !== g.mode && !(r.mode === 'keep' && g.mode === 'gain' && r.metric !== 'fatMass')) issues.push(`direction for ${g.metric}`);
    if (!r && (g.mode === 'lose' || g.mode === 'gain') && (g.metric === 'fatMass' || g.metric === 'scaleWeight') && !rule.goals.some((x) => x.metric === 'fatMass'))
      issues.push(`weight goal ${g.metric}`);
  }
  for (const k of Object.keys(ai.constraints) as (keyof SuggestedConstraints)[]) {
    if (!(k in rule.constraints)) issues.push(`limit ${k} not from the answers`);
    else if (!sameValue(ai.constraints[k], rule.constraints[k])) issues.push(`limit ${k} differs from the answers`);
  }
  const aiMissing = new Set(ai.missing.map((m) => m.field));
  for (const m of rule.missing) if (!aiMissing.has(m.field)) issues.push(`missing ${m.field} not listed`);
  return issues;
}

/** The AI result when it agrees with the rules; else the rule result marked as a fallback. */
export function reconcile(rule: GoalSuggestion, ai: GoalSuggestion | null, fallback: string): GoalSuggestion {
  if (ai && checkAgainstRule(rule, ai).length === 0) {
    // the rule's missing list wins on wording (the AI may add more)
    const extra = ai.missing.filter((m) => !rule.missing.some((r) => r.field === m.field));
    return { ...ai, missing: [...rule.missing, ...extra] };
  }
  return { ...rule, fallback };
}
