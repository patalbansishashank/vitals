/**
 * Goal suggestion (SUITE_SPEC §13.4, PLAN 02 item 8): a deterministic, rule-based suggester that reads what the person
 * has already answered (body estimate, intake, entered blood markers) and proposes a ranked goal set with
 * one plain sentence of why per goal, the practical limits their answers imply, and a list of what is missing instead
 * of a guess. Pure: no clock, no IO; the caller gathers the input (and the fastest-safe reach estimate) and stamps the
 * time on the stored record.
 *
 * The same output shape is produced by the Coach-assisted variant (`source: 'ai'`); `coerceSuggestion` turns a model
 * reply into this shape and `checkAgainstRule` is the oracle. D4-06 (rule@2): the AI only rewrites prose. The rule's
 * structured result is frozen — goal ranks, metrics, modes, target presence/value/unit, target provenance, marker
 * `because`, limits and the required safety/marker notes — and `structureHash` fingerprints it; any change to it falls
 * back to the rules (see `docs/wp/E19.md`).
 *
 * Reference body-fat band: Gallagher et al. 2000 (Am J Clin Nutr 72:694, doi 10.1093/ajcn/72.3.694) — the body fat that
 * corresponds to BMI 18.5 and 25 for the person's sex and age, from the paper's own prediction equation (the engine's
 * `gallagher2000`; SEE 2.8–5.4 percentage points; a provisional BMI-linked population reference, not an individual
 * optimum or a medical need). D4-06: when the body-fat interval overlaps the reference, no fat-loss goal is ranked
 * automatically — neutral options come first, fat loss stays an optional candidate the person may choose, and a purpose
 * question is offered. A numeric target needs a correctly signed supported reach and rounds toward zero on the display
 * grid (q = ⌊raw/grid⌋·grid ≤ raw; no number below one grid step).
 */
import { gallagher2000 } from '@/engine/body/equations';
import { fnv1a } from '@/engine/core/math';
import { GOAL_CAPABILITY, isProductionGoalEligible, type MetricId } from '@/engine/types/metrics';
import type { HabitProfile, LabBaselines } from '@/engine/types/profile';
import type { RankedGoal, TargetReach } from './types';

/** D4-06: rule@2 = signed reach, round-toward-zero grid, reference-overlap branch, frozen structure under AI rewrites. */
export const SUGGEST_RULE_VERSION = 'rule@2';
/**
 * Display grid of suggested fat-mass targets, kg: an optional UI design default, never a physiological minimum (a raw
 * amount below one step gives no numeric target).
 */
export const SUGGEST_MASS_GRID_KG = 0.5;
/** Display grid of suggested muscle-gain targets, kg (same semantics). */
export const SUGGEST_MUSCLE_GRID_KG = 0.1;
/** Smallest muscle-gain target worth a number, kg (two grid steps; below it the goal stays directional). */
export const SUGGEST_MUSCLE_MIN_KG = 0.2;
/** At most six ranked goals (the Planner's limit). */
export const SUGGEST_MAX_GOALS = 6;
/** Default horizon the targets are read at (16 weeks, the Planner's default). */
export const SUGGEST_HORIZON_DAYS = 112;
/** Training for at least half a year counts as "training" for the muscle-first rule. */
export const TRAINED_MIN_YEARS = 0.5;

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
  skipped?: Partial<Record<string, string>>;
}

/** A blood-marker note (the markers package's `MarkerNote`, the fields read here). */
export interface MarkerNote {
  markerId: string;
  severity: MarkerSeverity;
  because: { markerId: string; label: string; value: number; unit: string; date?: string };
  text?: string;
}

export interface SuggestSafety {
  /** The safety answers lock weight-loss goals (e.g. pregnancy, eating-disorder history). */
  noWeightLossGoal: boolean;
  /** The fasting tier the person opted into (null: never opted in). */
  optedTier: FastingTierOptIn | null;
  /** The longest fast the safety answers allow, h. */
  maxFastHours?: number;
}

/** What the person wants the plan for (D4-06): asked when the body-fat interval overlaps the reference. */
export type SuggestPurpose = 'fatLoss' | 'maintenance' | 'strength' | 'health' | 'performance';

export interface GoalSuggestionInput {
  profile: SuggestProfile;
  body: SuggestBody;
  intake: SuggestIntake;
  /** Notes from entered blood markers (empty when none were entered). */
  markers: MarkerNote[];
  /** Whether a blood test was entered at all (absent = the person was never asked or skipped). */
  markersAnswered?: boolean;
  safety: SuggestSafety;
  /** Fastest-safe reach answers for the probe goals (`suggestionProbeGoals`), any order; empty = no estimate yet. */
  reach: TargetReach[];
  horizonDays?: number;
  /** The purpose the person chose (D4-06); absent = not asked or not answered. Only an explicit choice reorders goals. */
  purpose?: SuggestPurpose | null;
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
  targetFrom: 'fastestSafeReach' | 'band' | 'keep' | 'direction' | 'user';
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

/** An optional goal the person may adopt by explicit choice (D4-06): not ranked, no number unless they set one. */
export interface SuggestedCandidate {
  metric: MetricId;
  mode: SuggestedMode;
  why: string;
}

/** Where the body-fat interval sits against the provisional reference band (D4-06). */
export type ReferenceOverlap = 'clearlyAbove' | 'overlaps' | 'within' | 'clearlyBelow' | 'unknown';

/** The body-fat reading behind the body goals (info sheet data; D4-06). */
export interface SuggestedReference {
  /** Provisional BMI-linked population reference (Gallagher 2000 at BMI 18.5 and 25), %. */
  band: [number, number];
  basis: 'gallagher2000Provisional';
  bfPct: number;
  /** The estimate's likely range, % (null = no interval: uncertain). */
  interval: [number, number] | null;
  overlap: ReferenceOverlap;
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
  /** 'rule@2' | `ai:<model>@<briefing version>`. */
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
  /** D4-06: optional goals offered for an explicit choice (e.g. fat loss when the body-fat interval overlaps the reference). */
  candidates?: SuggestedCandidate[];
  /** D4-06: purposes to ask about (present only when the answer would change the suggestion and none is recorded). */
  purposeAsk?: SuggestPurpose[];
  /** D4-06: body-fat estimate vs the provisional reference (info sheet). */
  reference?: SuggestedReference;
  /** D4-06: fingerprint of the frozen structured result (goals without prose, limits, required notes, version). */
  structureHash?: string;
  purpose?: SuggestPurpose;
}

/* ------------------------------------------------------------------------------------------------ helpers */

const r1 = (x: number) => Math.round(x * 10) / 10;
const r0 = (x: number) => Math.round(x);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/**
 * Round a positive magnitude toward zero on a display grid (D4-06): q = ⌊raw/grid⌋·grid with 0 < q ≤ raw. Null when the
 * raw amount is below one step (no numeric target is forced up to the grid) or not a positive finite number.
 */
export function floorToGrid(raw: number, grid: number): number | null {
  if (!finite(raw) || !finite(grid) || raw <= 0 || grid <= 0) return null;
  const n = Math.floor(raw / grid + 1e-9);
  let q = +(n * grid).toFixed(6);
  if (q > raw) q = +((n - 1) * grid).toFixed(6);
  return q >= grid - 1e-12 && q <= raw ? q : null;
}

/** Reference body-fat band (%) for sex and age: Gallagher 2000 at BMI 18.5 and 25 (age clamped to the paper's 20–79). */
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
export function suggestionProbeGoals(): RankedGoal[] {
  return [
    { metric: 'fatMass', direction: 'minimise' },
    { metric: 'skeletalMuscle', direction: 'maximise' },
  ];
}

/**
 * The correctly signed supported reach of a route (D4-06), kg: a fat-loss route must lose (change < 0) and a muscle-gain
 * route must gain (change > 0) under the metric's own operator. A missing, unsupported, not-found or wrong-sign reach is
 * null — never authorized through its absolute value.
 */
export function signedReachKg(
  input: Pick<GoalSuggestionInput, 'reach' | 'horizonDays'>,
  metric: MetricId,
  kind: 'loss' | 'gain',
): number | null {
  const r = input.reach.find(
    (x) =>
      x.metric === metric &&
      finite(x.requestedHorizonDays) &&
      finite(x.coveredDays) &&
      x.coveredDays >= x.requestedHorizonDays &&
      x.coveredDays >= (input.horizonDays ?? SUGGEST_HORIZON_DAYS) &&
      x.supported &&
      finite(x.changeAtHorizon) &&
      (x.kind === null || x.kind === undefined || x.kind === kind),
  );
  if (!r) return null;
  const c = r.changeAtHorizon;
  return kind === 'loss' ? (c < 0 ? -c : null) : c > 0 ? c : null;
}

/** Where the body-fat interval sits against the reference band; an absent interval stays uncertain (D4-06). */
export function referenceOverlap(
  body: Pick<SuggestBody, 'bfPct' | 'bfBand'>,
  band: [number, number],
): ReferenceOverlap {
  const iv = body.bfBand;
  if (!finite(body.bfPct) || !iv || !finite(iv[0]) || !finite(iv[1])) return 'unknown';
  const lo = Math.min(iv[0], iv[1]);
  const hi = Math.max(iv[0], iv[1]);
  if (lo > band[1]) return 'clearlyAbove';
  if (hi < band[0]) return 'clearlyBelow';
  if (lo >= band[0] && hi <= band[1]) return 'within';
  return 'overlaps';
}

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
  const add = (
    markerId: string,
    label: string,
    value: number | undefined,
    unit: string,
    caution: number,
    danger: number | null,
  ) => {
    if (!finite(value) || value < caution) return;
    const severity: MarkerSeverity = danger !== null && value >= danger ? 'danger' : 'caution';
    out.push({ markerId, severity, because: { markerId, label, value, unit } });
  };
  add('ldl', 'LDL', labs.ldlMmolL, 'mmol/L', 4.14, 4.91);
  add('tg', 'triglycerides', labs.tgMmolL, 'mmol/L', 1.69, 5.65);
  add('fpg', 'fasting glucose', labs.fastingGlucoseMmolL, 'mmol/L', 5.55, 7.0);
  add('hba1c', 'HbA1c', labs.hba1cPct, '%', 5.7, 6.5);
  if (finite(labs.crpMgL) && labs.crpMgL >= 3 && labs.crpMgL <= 10)
    add('hsCrp', 'hs-CRP', labs.crpMgL, 'mg/L', 3, null);
  add('urate', 'uric acid', labs.urateMgDl, 'mg/dL', 6.8, null);
  return out;
}

const markerValueText = (b: MarkerNote['because']) =>
  `${b.label} ${b.value} ${b.unit}${b.date ? ` on ${b.date}` : ''}`;

/* -------------------------------------------------------------------------------------------- the rules */

const WHY = {
  bf: (b: SuggestBody, band: [number, number]) =>
    `body fat about ${r0(b.bfPct!)} %${b.bfBand ? ` (likely ${r0(b.bfBand[0])}–${r0(b.bfBand[1])})` : ''}, ` +
    `${b.bfPct! > band[1] ? 'above' : b.bfPct! < band[0] ? 'below' : 'within'} the reference of ${r0(band[0])}–${r0(band[1])} % for your age and sex`,
};

/** What the body branch produced: ranked goals, optional candidates and whether the purpose question applies. */
interface BodyResult {
  goals: Omit<SuggestedGoal, 'rank'>[];
  candidates: SuggestedCandidate[];
  askPurpose: boolean;
  reference?: SuggestedReference;
}

const FAT_LOSS_CANDIDATE = (why: string): SuggestedCandidate => ({ metric: 'fatMass', mode: 'lose', why });

/**
 * A numeric fat-loss goal from a correctly signed supported reach and the fat above the reference top (D4-06):
 * 0 < target ≤ min(reach, excess), rounded toward zero on the display grid; null when there is no supported loss route or
 * the amount is below one grid step.
 */
function numericFatLoss(
  input: GoalSuggestionInput,
  excess: number,
  weeks: number,
  body: SuggestBody,
  band: [number, number],
): Omit<SuggestedGoal, 'rank'> | null {
  const reachKg = signedReachKg(input, 'fatMass', 'loss');
  if (reachKg === null || !(excess > 0)) return null;
  const raw = Math.min(reachKg, excess);
  const target = floorToGrid(raw, SUGGEST_MASS_GRID_KG);
  if (target === null) return null;
  const from: SuggestedGoal['targetFrom'] = reachKg < excess ? 'fastestSafeReach' : 'band';
  const how =
    from === 'fastestSafeReach'
      ? `; about ${r1(target)} kg is what the reference route reaches in ${weeks} weeks (an estimate)`
      : `; ${r1(target)} kg brings it to the top of that reference`;
  return {
    metric: 'fatMass',
    mode: 'lose',
    target,
    unit: 'kg',
    targetFrom: from,
    why: `Your ${WHY.bf(body, band)}${how}.`,
  };
}

function bodyGoals(input: GoalSuggestionInput, notes: SuggestedNote[]): BodyResult {
  const { profile, body, safety } = input;
  const none: BodyResult = { goals: [], candidates: [], askPurpose: false };
  if (!profile.complete || !finite(body.bfPct) || !finite(profile.weightKg)) return none;
  const band = healthyBodyFatBand(profile.sex, profile.ageYears);
  const bf = body.bfPct;
  const above = bf > band[1];
  const below = bf < band[0];
  const overlap = referenceOverlap(body, band);
  const reference: SuggestedReference = {
    band,
    basis: 'gallagher2000Provisional',
    bfPct: bf,
    interval: body.bfBand ? [body.bfBand[0], body.bfBand[1]] : null,
    overlap,
  };
  const years = body.trainingAgeY;
  const trained = years !== null && years >= TRAINED_MIN_YEARS;
  const weeks = Math.round((input.horizonDays ?? SUGGEST_HORIZON_DAYS) / 7);
  const purpose = input.purpose ?? null;
  const out: Omit<SuggestedGoal, 'rank'>[] = [];
  const candidates: SuggestedCandidate[] = [];

  if (above) {
    // a fat-loss goal is ranked only when the interval lies clearly above the reference, or the person chose fat loss;
    // a non-weight purpose is honoured, and an overlapping interval offers neutral options first (no midpoint loss)
    const clear = overlap === 'clearlyAbove';
    const wantsLoss = purpose === 'fatLoss' || (purpose === null && clear);
    let lossGoal: Omit<SuggestedGoal, 'rank'> | null = null;
    if (safety.noWeightLossGoal) {
      notes.push({
        topic: 'safety',
        text: `Your body fat is above the reference, but your safety answers keep weight-loss goals out of plans, so none is suggested.`,
      });
    } else {
      const excess = fatAboveBandKg(profile.weightKg, bf, band[1]);
      if (wantsLoss) lossGoal = numericFatLoss(input, excess, weeks, body, band);
      if (!lossGoal)
        candidates.push(
          FAT_LOSS_CANDIDATE(`Your ${WHY.bf(body, band)}; fat loss is an option you can choose.`),
        );
    }
    if (lossGoal) out.push(lossGoal);
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
        why: lossGoal
          ? 'Keeping lean mass while losing fat protects your maintenance energy and strength.'
          : 'Keeping lean mass protects your maintenance energy and strength.',
      });
    }
    if (!lossGoal) {
      out.push({
        metric: 'strength',
        mode: 'raise',
        targetFrom: 'direction',
        why: 'Strength improves with regular training whatever your weight goal.',
      });
    }
    return {
      goals: out,
      candidates,
      askPurpose: purpose === null && !clear && !safety.noWeightLossGoal,
      reference,
    };
  }

  if (trained) {
    const kg = signedReachKg(input, 'skeletalMuscle', 'gain');
    const target =
      kg !== null && kg >= SUGGEST_MUSCLE_MIN_KG ? floorToGrid(kg, SUGGEST_MUSCLE_GRID_KG) : null;
    if (target !== null && target >= SUGGEST_MUSCLE_MIN_KG - 1e-9) {
      out.push({
        metric: 'skeletalMuscle',
        mode: 'gain',
        target,
        unit: 'kg',
        targetFrom: 'fastestSafeReach',
        why: `Your ${WHY.bf(body, band)} and you train, so muscle comes first; about ${r1(target)} kg is what a lean-gain route reaches in ${weeks} weeks (an estimate).`,
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
      out.push({
        metric: 'fatMass',
        mode: 'keep',
        targetFrom: 'keep',
        why: 'Your body fat is within the reference, so plans hold it while muscle grows.',
      });
    out.push({
      metric: 'strength',
      mode: 'raise',
      targetFrom: 'direction',
      why: 'Strength rises with the same training and is the first sign the muscle goal is working.',
    });
    if (purpose === 'fatLoss' && !below && !safety.noWeightLossGoal)
      candidates.push(
        FAT_LOSS_CANDIDATE('You chose fat loss; set the amount you want, within your safety limits.'),
      );
    return { goals: out, candidates, askPurpose: false, reference };
  }

  if (years === 0 || years === null) {
    // not training (or not said): no muscle-vs-fat call; a below-reference body never gets a loss goal
    if (below)
      out.push({
        metric: 'leanTissue',
        mode: 'keep',
        targetFrom: 'keep',
        why: `Your ${WHY.bf(body, band)}; plans should not lower it further, and keeping lean mass comes first.`,
      });
    if (years === 0)
      out.push({
        metric: 'strength',
        mode: 'raise',
        targetFrom: 'direction',
        why: 'You do not train yet; strength improves fastest in the first months of lifting.',
      });
  }
  if (purpose === 'fatLoss' && !below && !safety.noWeightLossGoal)
    candidates.push(
      FAT_LOSS_CANDIDATE('You chose fat loss; set the amount you want, within your safety limits.'),
    );
  return { goals: out, candidates, askPurpose: false, reference };
}

function markerGoals(input: GoalSuggestionInput, notes: SuggestedNote[]): Omit<SuggestedGoal, 'rank'>[] {
  const relevant = input.markers
    .filter((n) => n.severity === 'caution' || n.severity === 'danger')
    .slice()
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        idx(a.markerId) - idx(b.markerId) ||
        a.markerId.localeCompare(b.markerId),
    );
  const out: Omit<SuggestedGoal, 'rank'>[] = [];
  for (const n of relevant) {
    const mapped = MARKER_GOAL[n.markerId];
    // C6: a marker whose goal metric has no optimizable capability (e.g. ApoB, an exploratory proxy response) is a note only
    const goal = mapped && isProductionGoalEligible(mapped.metric) ? mapped : undefined;
    const v = markerValueText(n.because);
    if (!goal) {
      notes.push({
        topic: 'marker',
        text: `Your ${v} is high; no goal moves it directly, so plans take it into account as a limit.`,
      });
      continue;
    }
    // D4-05: a quantity with a required target/band (glucose, blood pressure) is never an open-ended "lower" goal; no
    // universal target is invented, so the reading is a note until a target band is entered
    if (GOAL_CAPABILITY[goal.metric].satiation === 'required') {
      notes.push({
        topic: 'marker',
        text: `Your ${v} is above the usual range; with a target range from your clinician it can become a goal.`,
      });
      if (n.severity === 'danger')
        notes.push({
          topic: 'marker',
          text: `Your ${v} is in a range to discuss with a clinician; plans are not a substitute for that.`,
        });
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
    if (n.severity === 'danger')
      notes.push({
        topic: 'marker',
        text: `Your ${v} is in a range to discuss with a clinician; plans are not a substitute for that.`,
      });
  }
  return out;
}
const idx = (id: string) => {
  const i = MARKER_ORDER.indexOf(id);
  return i < 0 ? MARKER_ORDER.length : i;
};

const TIME_OF_DAY: Readonly<Record<string, number>> = { morning: 7, midday: 12, evening: 18 };
const TIER_HOURS: Readonly<Record<FastingTierOptIn, 48 | 72>> = { T2: 48, T3: 72, T4: 72 };

function constraintsOf(input: GoalSuggestionInput): SuggestedConstraints {
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
    out.latestH = clamp(
      Math.ceil(habits.habitualWindowStartH + habits.habitualWindowLengthH),
      out.earliestH + 1,
      24,
    );
  }
  // fasting only when the person already opted in (and never above what the safety answers allow)
  const tier = input.safety.optedTier;
  if (tier) {
    const cap = input.safety.maxFastHours;
    const h = TIER_HOURS[tier];
    out.longestFastH = finite(cap) && cap < h ? (cap >= 48 ? 48 : 24) : h;
  }
  return out;
}

function carriedNotes(input: GoalSuggestionInput, notes: SuggestedNote[]): void {
  const t = input.intake.training;
  if (t && (t.owned?.length || t.access?.length)) {
    const places = [
      ...new Set((t.access ?? []).map((a) => (typeof a === 'string' ? a : a.place)).filter(Boolean)),
    ];
    const where = places.length ? places.join(' and ') : 'home';
    const kit = t.owned?.length
      ? `${t.owned.length} piece${t.owned.length === 1 ? '' : 's'} of equipment`
      : 'no equipment';
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
  const { profile, body, intake } = input;
  if (!profile.complete)
    out.push({
      field: 'body',
      question: 'body.basics',
      why: 'Sex, age, height and weight are where every estimate starts.',
    });
  if (body.trainingAgeY === null)
    out.push({
      field: 'trainingHistory',
      question: 'training.experience',
      why: 'How long you have trained decides between building muscle and keeping it.',
    });
  if (profile.complete && body.waistCm === undefined && !body.measuredBodyFat)
    out.push({
      field: 'waist',
      question: 'body.waist',
      why: 'A waist measurement would sharpen the body-fat estimate.',
    });
  if (!intake.activity && !intake.skipped?.['activity'])
    out.push({
      field: 'activity',
      question: 'activity.work',
      why: 'Your daily activity sets how much energy you use.',
    });
  if (!intake.training?.prefs && !intake.skipped?.['training'])
    out.push({
      field: 'trainingTime',
      question: 'training.time',
      why: 'Days and minutes you can train set the training limits.',
    });
  if (!intake.diet?.rulesComplete && !intake.skipped?.['diet'])
    out.push({
      field: 'food',
      question: 'food.rules',
      why: 'What you eat decides which foods plans may use.',
    });
  if (input.markersAnswered !== true && input.markers.length === 0 && !profile.labs)
    out.push({
      field: 'markers',
      question: 'markers.has',
      why: 'No blood markers entered, so no marker goals.',
    });
  return out;
}

/** Goal metrics a purpose brings forward (only after the person chose it; stable order otherwise). */
const PURPOSE_FIRST: Readonly<Record<SuggestPurpose, ReadonlySet<string>>> = {
  fatLoss: new Set(['fatMass']),
  maintenance: new Set(['fatMass', 'leanTissue', 'skeletalMuscle']),
  strength: new Set(['strength', 'skeletalMuscle']),
  health: new Set(['ldl', 'triglycerides', 'liverFat', 'crp', 'insulinSensitivity']),
  performance: new Set(['strength', 'vo2max', 'skeletalMuscle']),
};

/** Topics of notes an AI rewrite must keep verbatim (safety answers and marker readings). */
const REQUIRED_NOTE_TOPICS: ReadonlySet<SuggestedNote['topic']> = new Set(['safety', 'marker']);

/** The structured content an AI rewrite may not change (D4-06): goals without prose, limits, required notes. */
function structureOf(
  s: Pick<
    GoalSuggestion,
    'goals' | 'constraints' | 'notes' | 'candidates' | 'purpose' | 'purposeAsk' | 'reference'
  >,
): unknown {
  return {
    goals: s.goals.map((g) => [
      g.rank,
      g.metric,
      g.mode,
      g.target ?? null,
      g.unit ?? null,
      g.targetFrom,
      g.because ?? null,
    ]),
    constraints: Object.keys(s.constraints)
      .sort()
      .map((k) => [k, s.constraints[k as keyof SuggestedConstraints]]),
    notes: s.notes.filter((n) => REQUIRED_NOTE_TOPICS.has(n.topic)).map((n) => [n.topic, n.text]),
    purpose: s.purpose ?? null,
    purposeAsk: s.purposeAsk ?? null,
    reference: s.reference ?? null,
    candidates: (s.candidates ?? []).map((c) => [c.metric, c.mode]),
  };
}

/** Fingerprint of a suggestion's frozen structure (rule version included). */
export function suggestionStructureHash(
  s: Pick<
    GoalSuggestion,
    'goals' | 'constraints' | 'notes' | 'candidates' | 'purpose' | 'purposeAsk' | 'reference'
  >,
  version = SUGGEST_RULE_VERSION,
): string {
  return fnv1a(JSON.stringify({ version, structure: structureOf(s) }));
}

/** The rule-based suggestion (`rule@2`). Deterministic: the same input always gives the same output. */
export function suggestGoals(input: GoalSuggestionInput): GoalSuggestion {
  const notes: SuggestedNote[] = [];
  const missing = missingOf(input);
  const base = { source: 'rule' as const, version: SUGGEST_RULE_VERSION };
  // no body (or nothing answered): never a guess
  if (!input.profile.complete) {
    const empty = { ...base, goals: [], constraints: {}, notes: [], missing };
    return { ...empty, structureHash: suggestionStructureHash(empty) };
  }

  const body = bodyGoals(input, notes);
  let ordered = [...body.goals, ...markerGoals(input, notes)];
  const purpose = input.purpose ?? null;
  if (purpose) {
    const first = PURPOSE_FIRST[purpose];
    ordered = [...ordered.filter((g) => first.has(g.metric)), ...ordered.filter((g) => !first.has(g.metric))];
  }
  const goals: Omit<SuggestedGoal, 'rank'>[] = [];
  for (const g of ordered) {
    if (goals.length >= SUGGEST_MAX_GOALS) break;
    if (!goals.some((x) => x.metric === g.metric)) goals.push(g);
  }
  const constraints = constraintsOf(input);
  carriedNotes(input, notes);
  const candidates = body.candidates.filter((c) => !goals.some((g) => g.metric === c.metric));
  const out: GoalSuggestion = {
    ...base,
    goals: goals.map((g, i) => ({ rank: i + 1, ...g })),
    constraints,
    notes,
    missing,
    ...(candidates.length ? { candidates } : {}),
    ...(body.askPurpose
      ? { purposeAsk: ['fatLoss', 'maintenance', 'strength', 'health', 'performance'] as SuggestPurpose[] }
      : {}),
    ...(purpose ? { purpose } : {}),
    ...(body.reference ? { reference: body.reference } : {}),
  };
  return { ...out, structureHash: suggestionStructureHash(out) };
}

/* ----------------------------------------------------------------------------------- the AI variant's oracle */

const MODES: readonly SuggestedMode[] = ['lose', 'keep', 'gain', 'raise', 'lower'];
const TARGET_FROM: readonly SuggestedGoal['targetFrom'][] = [
  'fastestSafeReach',
  'band',
  'keep',
  'direction',
  'user',
];
const NOTE_TOPICS = ['sleep', 'recovery', 'marker', 'safety', 'equipment', 'food'] as const;
const CONSTRAINT_KEYS: readonly (keyof SuggestedConstraints)[] = [
  'trainingDays',
  'trainingTimeH',
  'maxSessionMin',
  'earliestH',
  'latestH',
  'longestFastH',
  'sleepFixed',
];
const isRec = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 300): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;

function coerceBecause(v: unknown): MarkerNote['because'] | undefined {
  if (!isRec(v)) return undefined;
  const markerId = str(v.markerId, 60);
  const label = str(v.label, 60);
  const unit = str(v.unit, 20);
  if (!markerId || !label || !unit || !finite(v.value)) return undefined;
  const date = str(v.date, 20);
  return { markerId, label, value: v.value, unit, ...(date ? { date } : {}) };
}

/**
 * A model reply → `GoalSuggestion` (`source: 'ai'`). Goal metrics, modes and constraint names are coerced onto the
 * rule vocabulary; anything unknown is dropped. `isMetric` says which metric ids may be goals; the capability registry
 * applies on top of it (C6/D8-09: a suggestion route never proposes a metric without an optimizable capability — the
 * generic endurance index, the adherence index, keto adaptation, IGF-1, BMD change or the micronutrient score — whatever
 * the caller allows). Target, unit, target provenance and marker `because` are read as given (D4-06: nothing is
 * defaulted, so an omitted unit or provenance shows up in the check). Returns null when the reply has no usable shape.
 */
export function coerceSuggestion(
  raw: unknown,
  version: string,
  isMetric: (id: string) => boolean,
): GoalSuggestion | null {
  if (!isRec(raw) || !Array.isArray(raw.goals)) return null;
  const goals: SuggestedGoal[] = [];
  for (const g of raw.goals) {
    if (
      !isRec(g) ||
      typeof g.metric !== 'string' ||
      !isMetric(g.metric) ||
      !isProductionGoalEligible(g.metric)
    )
      continue;
    const mode = MODES.find((m) => m === g.mode);
    const why = str(g.why);
    if (!mode || !why || goals.some((x) => x.metric === g.metric)) continue;
    const target = finite(g.target) && g.target > 0 ? g.target : undefined;
    const unit = str(g.unit, 12);
    const from = TARGET_FROM.find((t) => t === g.targetFrom);
    if (!from) return null;
    const because = coerceBecause(g.because);
    goals.push({
      rank: goals.length + 1,
      metric: g.metric as MetricId,
      mode,
      ...(target !== undefined ? { target } : {}),
      ...(unit !== undefined ? { unit } : {}),
      targetFrom: from,
      why,
      ...(because ? { because } : {}),
    });
    if (goals.length >= SUGGEST_MAX_GOALS) break;
  }
  const constraints: SuggestedConstraints = {};
  if (isRec(raw.constraints)) {
    const c = raw.constraints;
    for (const k of CONSTRAINT_KEYS) {
      const v = c[k];
      if (k === 'trainingDays') {
        if (Array.isArray(v) && v.length === 2 && v.every(finite))
          constraints.trainingDays = [v[0] as number, v[1] as number];
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
  const clarify = Array.isArray(raw.clarify)
    ? raw.clarify
        .map((q) => str(q, 200))
        .filter((q): q is string => !!q)
        .slice(0, 2)
    : [];
  const notes: SuggestedNote[] = Array.isArray(raw.notes)
    ? raw.notes.filter(isRec).flatMap((n) => {
        const text = str(n.text);
        const topic = NOTE_TOPICS.find((t) => t === n.topic);
        return text && topic ? [{ topic, text }] : [];
      })
    : [];
  return {
    source: 'ai',
    version,
    goals,
    constraints,
    notes,
    missing,
    ...(clarify.length ? { clarify } : {}),
  };
}

const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const WEIGHT_METRICS: ReadonlySet<string> = new Set(['fatMass', 'scaleWeight', 'bodyFatPct', 'waist']);

/**
 * Where an AI suggestion changes the rule's frozen structure (empty = acceptable; D4-06). The AI may reword `why`, add
 * clarifying questions, non-required notes and extra missing answers. It must keep: every rule goal at the same rank with
 * the same mode, target presence and exact value, unit, target provenance and marker `because`; every rule limit with the
 * same value and no other limit; every safety/marker note verbatim; at least everything the rules list as missing. An
 * extra goal is allowed only after the rule goals, directional (no number), capability-eligible without a required
 * target band, and never a weight goal.
 */
export function checkAgainstRule(rule: GoalSuggestion, ai: GoalSuggestion | null): string[] {
  if (!ai) return ['invalid structured reply'];
  const issues: string[] = [];
  if (rule.goals.length === 0 && ai.goals.length > 0) issues.push('goals without enough answers');
  const top = (s: GoalSuggestion) =>
    s.goals
      .slice(0, 2)
      .map((g) => g.metric)
      .join('|');
  if (rule.goals.length > 0 && top(rule) !== top(ai)) issues.push('different first goals');
  rule.goals.forEach((r, i) => {
    const j = ai.goals.findIndex((g) => g.metric === r.metric);
    if (j < 0) {
      issues.push(`goal ${r.metric} missing`);
      return;
    }
    const g = ai.goals[j]!;
    if (j !== i) issues.push(`rank of ${r.metric}`);
    if (r.mode !== g.mode) issues.push(`direction for ${r.metric}`);
    if (
      (r.target === undefined) !== (g.target === undefined) ||
      (r.target !== undefined && g.target !== r.target)
    )
      issues.push(`target for ${r.metric}`);
    if ((r.unit ?? null) !== (g.unit ?? null)) issues.push(`unit for ${r.metric}`);
    if (r.targetFrom !== g.targetFrom) issues.push(`provenance for ${r.metric}`);
    if (!sameValue(r.because ?? null, g.because ?? null)) issues.push(`marker reading for ${r.metric}`);
  });
  ai.goals.forEach((g, j) => {
    if (rule.goals.some((r) => r.metric === g.metric)) return;
    const cap = GOAL_CAPABILITY[g.metric];
    if (j < rule.goals.length) issues.push(`extra goal ${g.metric} ranked above the rules`);
    if (g.target !== undefined || g.mode === 'lose' || g.mode === 'gain')
      issues.push(`extra goal ${g.metric} with a number`);
    if (WEIGHT_METRICS.has(g.metric)) issues.push(`weight goal ${g.metric}`);
    if (cap && cap.satiation === 'required') issues.push(`extra goal ${g.metric} needs a target range`);
  });
  for (const k of CONSTRAINT_KEYS) {
    const inRule = k in rule.constraints;
    const inAi = k in ai.constraints;
    if (inAi && !inRule) issues.push(`limit ${k} not from the answers`);
    else if (inRule && !inAi) issues.push(`limit ${k} missing`);
    else if (inRule && !sameValue(ai.constraints[k], rule.constraints[k]))
      issues.push(`limit ${k} differs from the answers`);
  }
  for (const n of rule.notes) {
    if (!REQUIRED_NOTE_TOPICS.has(n.topic)) continue;
    if (!ai.notes.some((m) => m.topic === n.topic && m.text === n.text))
      issues.push(`${n.topic} note missing`);
  }
  const aiMissing = new Set(ai.missing.map((m) => m.field));
  for (const m of rule.missing) if (!aiMissing.has(m.field)) issues.push(`missing ${m.field} not listed`);
  return issues;
}

/**
 * The AI rewrite when it keeps the rule's structure (D4-06): the rule's frozen goals, limits, required notes, candidates,
 * purpose question, reference and structure hash, with the AI's wording of each `why`, its extra directional goals after
 * the rule goals, its other notes, clarifying questions and extra missing answers. Otherwise the rule result marked as a
 * fallback.
 */
export function reconcile(rule: GoalSuggestion, ai: GoalSuggestion | null, fallback: string): GoalSuggestion {
  if (!ai || checkAgainstRule(rule, ai).length > 0) return { ...rule, fallback };
  const goals: SuggestedGoal[] = rule.goals.map((r) => ({
    ...r,
    why: ai.goals.find((g) => g.metric === r.metric)?.why ?? r.why,
  }));
  for (const g of ai.goals) {
    if (goals.length >= SUGGEST_MAX_GOALS) break;
    if (!goals.some((x) => x.metric === g.metric)) goals.push({ ...g, rank: goals.length + 1 });
  }
  const required = rule.notes.filter((n) => REQUIRED_NOTE_TOPICS.has(n.topic));
  const otherAi = ai.notes.filter((n) => !REQUIRED_NOTE_TOPICS.has(n.topic));
  const otherRule = rule.notes.filter(
    (n) => !REQUIRED_NOTE_TOPICS.has(n.topic) && !otherAi.some((m) => m.topic === n.topic),
  );
  const extra = ai.missing.filter((m) => !rule.missing.some((r) => r.field === m.field));
  const { fallback: _f, ...frozen } = rule;
  return {
    ...frozen,
    source: 'ai',
    version: ai.version,
    goals,
    notes: [...required, ...otherRule, ...otherAi],
    missing: [...rule.missing, ...extra],
    ...(ai.clarify?.length ? { clarify: ai.clarify } : {}),
  };
}
