/**
 * The goal catalogue: every outcome metric of the engine (`SERIES`, MODEL_SPEC §6) with its planner eligibility
 * (dossier 18 §4.5: target / maximise / minimise / not eligible and why), grade, caveat, category and the goal types
 * the Goals screen offers for it (planner-goals.md §6 "Goal types"). Pure data; no React.
 */
import { SERIES, type MetricCategory, type MetricId, type SeriesDef } from '@/engine/types/metrics';
import type { GoalDirection } from '@/engine/planner/domain/types';
import type { GoalDraft, GoalMode, GoalStrength } from '@/state/plannerStore';

export type Grade = 'A' | 'B' | 'C' | 'D';

/** Fixed category order (charts CATEGORY_ORDER / tokens palette slots). */
export const CATEGORY_ORDER: readonly MetricCategory[] = ['body', 'fuel', 'energy', 'cellular', 'performance', 'recovery', 'cardio', 'hormones'];

/** How a target amount is entered: a body measurement (unit-aware stepper) or a plain stepper in metric units. */
export type TargetQuantity = 'mass' | 'length' | 'plain';

export interface TargetSpec {
  quantity: TargetQuantity;
  /** Unit shown for plain quantities ("% pts", "mmol/L", "g"). */
  unit: string;
  /** Spoken unit ("percentage points"). */
  unitText: string;
  min: number;
  max: number;
  step: number;
  decimals: number;
  /** Default magnitude when a goal is added or its mode switches to one that needs an amount. */
  fallback: number;
}

export interface ModeSpec {
  mode: GoalMode;
  /** Key label (lowercase, engraved voice). */
  label: string;
  /** Whether this mode takes an amount and how it maps. */
  target: 'none' | 'change' | 'absolute' | 'zero';
  /** Sign applied to the amount for change targets. */
  sign: 1 | -1;
  direction: GoalDirection;
}

export interface GoalMetric {
  id: MetricId;
  label: string;
  unit: string;
  category: MetricCategory;
  grade: Grade;
  eligible: boolean;
  /** Plain-language reason when not eligible. */
  reason: string | null;
  /** Short note for eligible metrics ("muscle and organ tissue without glycogen and water swings"). */
  note: string | null;
  /** Mandatory caveat that travels with the metric (grade C/D, blood markers, indices). */
  caveat: string | null;
  /** Modes offered, first = default. Empty when not eligible. */
  modes: ModeSpec[];
  target: TargetSpec | null;
  /** Default functional: 'mean' for time-integrated signals, else 'end'. */
  defaultFunctional: 'end' | 'mean';
  /** Physiology-sex restriction (hormone markers). */
  sexes?: readonly ('male' | 'female')[];
  /** Search terms besides the label (plain synonyms, never diet brands). */
  aliases: string[];
}

const DEFS = SERIES.filter((d) => d.kind === 'metric') as readonly SeriesDef[];
const BY_ID: ReadonlyMap<string, SeriesDef> = new Map(DEFS.map((d) => [d.id, d]));
const LABEL_BY_ID: ReadonlyMap<string, string> = new Map((SERIES as readonly SeriesDef[]).map((d) => [d.id, d.label]));

/* ---------------------------------------------------------------------------------------------------- modes */

const M = {
  lose: { mode: 'lose', label: 'lose', target: 'change', sign: -1, direction: 'target' },
  keep: { mode: 'keep', label: 'keep', target: 'zero', sign: 1, direction: 'target' },
  gain: { mode: 'gain', label: 'gain', target: 'change', sign: 1, direction: 'target' },
  raise: { mode: 'raise', label: 'raise', target: 'none', sign: 1, direction: 'maximise' },
  lower: { mode: 'lower', label: 'lower', target: 'none', sign: -1, direction: 'minimise' },
  reach: { mode: 'reach', label: 'reach', target: 'absolute', sign: 1, direction: 'target' },
} as const satisfies Record<GoalMode, ModeSpec>;

/** Maximise-kind masses (lean tissue): keep = maximise with the start value as the aspiration, gain = maximise + amount. */
const KEEP_MAX: ModeSpec = { ...M.keep, direction: 'maximise' };
const GAIN_MAX: ModeSpec = { ...M.gain, direction: 'maximise' };

const mass = (fallback: number, max: number, min = 0.5, step = 0.5): TargetSpec => ({ quantity: 'mass', unit: 'kg', unitText: 'kilograms', min, max, step, decimals: 1, fallback });

/** Per-metric goal configuration; anything not listed follows its catalogue goal kind (maximise → raise, minimise → lower). */
const OVERRIDES: Partial<Record<MetricId, { modes: ModeSpec[]; target?: TargetSpec; aliases?: string[] }>> = {
  fatMass: { modes: [M.lose, M.keep, M.gain], target: mass(5, 40), aliases: ['fat loss', 'body fat mass', 'lose fat'] },
  scaleWeight: { modes: [M.lose, M.keep, M.gain], target: mass(5, 40), aliases: ['weight', 'body weight', 'lose weight'] },
  bodyFatPct: {
    modes: [M.lose, M.keep, M.gain],
    target: { quantity: 'plain', unit: '% pts', unitText: 'percentage points', min: 0.5, max: 20, step: 0.5, decimals: 1, fallback: 3 },
    aliases: ['body fat percentage', 'bf'],
  },
  waist: { modes: [M.lose, M.keep, M.gain], target: { quantity: 'length', unit: 'cm', unitText: 'centimetres', min: 0.5, max: 30, step: 0.5, decimals: 1, fallback: 4 }, aliases: ['waist circumference', 'belly'] },
  leanTissue: { modes: [KEEP_MAX, GAIN_MAX], target: mass(1, 8, 0.2, 0.1), aliases: ['lean mass', 'muscle', 'fat-free mass', 'keep muscle'] },
  skeletalMuscle: { modes: [GAIN_MAX, KEEP_MAX], target: mass(1, 6, 0.2, 0.1), aliases: ['muscle', 'build muscle', 'muscle gain'] },
  bhb: {
    modes: [M.reach, M.raise],
    target: { quantity: 'plain', unit: 'mmol/L', unitText: 'millimoles per litre', min: 0.3, max: 3, step: 0.1, decimals: 1, fallback: 1 },
    aliases: ['ketones', 'ketosis', 'beta-hydroxybutyrate'],
  },
  glycogenTotal: {
    modes: [M.raise, M.reach],
    target: { quantity: 'plain', unit: 'g', unitText: 'grams', min: 250, max: 900, step: 10, decimals: 0, fallback: 500 },
    aliases: ['glycogen', 'carbohydrate stores'],
  },
  igf1: { modes: [M.lower, M.raise], aliases: ['growth factor'] },
  metabolicAdaptation: { modes: [{ ...M.raise, label: 'limit' }], aliases: ['adaptive thermogenesis', 'metabolic slowdown'] },
  tdee: { modes: [{ ...M.raise, label: 'keep up' }], aliases: ['energy expenditure', 'calories burned', 'metabolism'] },
  rmr: { modes: [{ ...M.raise, label: 'keep up' }], aliases: ['resting metabolism', 'bmr'] },
  autophagyIdx: { modes: [M.raise], aliases: ['autophagy', 'cellular clean-up'] },
  hoursInKetosis: { modes: [M.raise], aliases: ['ketosis', 'ketones'] },
  hunger: { modes: [M.lower], aliases: ['appetite', 'cravings'] },
  vo2max: { modes: [M.raise], aliases: ['fitness', 'aerobic capacity', 'cardio fitness'] },
  strength: { modes: [M.raise], aliases: ['lifting', 'strength gain'] },
  ldl: { modes: [M.lower], aliases: ['cholesterol', 'ldl-c'] },
  apoB: { modes: [M.lower], aliases: ['apolipoprotein b', 'cholesterol'] },
  sbp: { modes: [M.lower], aliases: ['blood pressure', 'hypertension'] },
  visceralFat: { modes: [M.lower], aliases: ['belly fat', 'organ fat'] },
};

/** The design's suggested starters (planner-goals.md §6 empty state), as metric + mode. */
export const SUGGESTED_GOALS: ReadonlyArray<{ metric: MetricId; mode: GoalMode }> = [
  { metric: 'fatMass', mode: 'lose' },
  { metric: 'leanTissue', mode: 'keep' },
  { metric: 'hunger', mode: 'lower' },
  { metric: 'vo2max', mode: 'raise' },
  { metric: 'strength', mode: 'raise' },
  { metric: 'ldl', mode: 'lower' },
];

/* --------------------------------------------------------------------------------------------------- reasons */

/** Replace engine ids inside notes with their labels ("use leanTissue as the goal" → "use Lean tissue (protein-based) …"). */
export function humaniseNote(note: string): string {
  return note.replace(/\b([a-z][a-zA-Z0-9]+)\b/g, (w) => {
    const label = LABEL_BY_ID.get(w);
    return label && /[A-Z]/.test(w) ? label.toLowerCase() : w;
  });
}

const REASON_BY_NOTE: ReadonlyArray<[RegExp, string]> = [
  [/^guard only/i, 'The Planner keeps it inside safe limits but never pushes it.'],
  [/^constraint\/guard only/i, 'The Planner keeps it inside safe limits but never pushes it.'],
  [/^constraint for women/i, 'Used as a safety limit for women, never as a goal.'],
  [/^constraint \(/i, 'Used as a safety limit, never as a goal.'],
  [/^hard floor/i, 'A safety floor the Planner never goes below; not something to push.'],
  [/^reference line/i, 'A reference line for other curves, not an outcome.'],
  [/^an input consequence/i, 'It follows directly from what you eat and do; set those instead.'],
  [/^display/i, 'Shown to explain other curves; it drives ketosis but is not an outcome itself.'],
  [/^advanced signalling view/i, 'An advanced signalling view; the evidence does not support optimising it.'],
  [/^weak causal target/i, 'Raising it has not been shown to lower heart risk, so it makes a poor goal.'],
  [/^acute mps does not predict growth/i, 'Short-term muscle protein synthesis does not predict muscle growth; use lean tissue or skeletal muscle instead.'],
];

/** Research-dossier cross-references ("(04 §4.15)", "08 §4.16") are for engineers, never for the reader. */
export function stripDossierRefs(text: string): string {
  return text
    .replace(/\s*\(\s*\d{2}\s*§\s*[\d.]+[a-z]?\s*\)/gi, '')
    .replace(/\s*\b\d{2}\s*§\s*[\d.]+[a-z]?/gi, '')
    .replace(/\s+([.,;:])/g, '$1')
    .trim();
}

function reasonFor(d: SeriesDef): string {
  const note = d.goalNote;
  if (!note) return 'Shown for context; the Planner does not optimise it.';
  for (const [re, text] of REASON_BY_NOTE) if (re.test(note)) return text;
  const h = stripDossierRefs(humaniseNote(note)).replace(/\.$/, '');
  return `${h.charAt(0).toUpperCase()}${h.slice(1)}.`;
}

/* ---------------------------------------------------------------------------------------------- catalogue */

const TIME_INTEGRATED = new Set<string>(['bhb', 'hoursInKetosis', 'autophagyIdx', 'glucose', 'hunger']);

function build(d: SeriesDef): GoalMetric {
  const eligible = d.goal !== 'none';
  const o = OVERRIDES[d.id as MetricId];
  let modes: ModeSpec[] = [];
  if (eligible) {
    if (o) modes = o.modes;
    else if (d.goal === 'maximise') modes = [M.raise];
    else if (d.goal === 'minimise') modes = [M.lower];
    else modes = d.direction === 'down' ? [M.lower, M.raise] : [M.raise, M.lower];
  }
  return {
    id: d.id as MetricId,
    label: d.label,
    unit: d.unit,
    category: d.category,
    grade: d.grade,
    eligible,
    reason: eligible ? null : reasonFor(d),
    note: eligible && d.goalNote ? stripDossierRefs(humaniseNote(d.goalNote)) : null,
    caveat: d.caveat ?? null,
    modes,
    target: eligible ? (o?.target ?? null) : null,
    defaultFunctional: TIME_INTEGRATED.has(d.id) || d.agg === 'mean' ? 'mean' : 'end',
    sexes: d.sexes,
    aliases: o?.aliases ?? [],
  };
}

export const GOAL_METRICS: readonly GoalMetric[] = DEFS.map(build);
const METRIC_BY_ID: ReadonlyMap<string, GoalMetric> = new Map(GOAL_METRICS.map((m) => [m.id, m]));

export function goalMetric(id: string): GoalMetric | undefined {
  return METRIC_BY_ID.get(id);
}

export function isMetricId(id: string): id is MetricId {
  return BY_ID.has(id);
}

export function modeSpec(metric: GoalMetric, mode: GoalMode): ModeSpec {
  return metric.modes.find((m) => m.mode === mode) ?? metric.modes[0] ?? M.raise;
}

/** Does this mode take an amount (stepper shown)? */
export const modeTakesAmount = (m: ModeSpec): boolean => m.target === 'change' || m.target === 'absolute';

let keySeq = 0;
/** A fresh goal for a metric with its default mode (or `mode` when offered). */
export function newGoal(metric: GoalMetric, mode?: GoalMode, strength: GoalStrength = 'should'): GoalDraft {
  const spec = mode ? modeSpec(metric, mode) : metric.modes[0]!;
  keySeq += 1;
  return {
    key: `${metric.id}-${Date.now().toString(36)}-${keySeq}`,
    metric: metric.id,
    mode: spec.mode,
    amount: modeTakesAmount(spec) ? (metric.target?.fallback ?? 1) : null,
    strength,
    functional: null,
  };
}

/** Grouped for the picker: categories in fixed order, eligible metrics first inside each group. */
export function groupedMetrics(list: readonly GoalMetric[] = GOAL_METRICS): Array<{ category: MetricCategory; metrics: GoalMetric[] }> {
  return CATEGORY_ORDER.map((category) => ({
    category,
    metrics: list.filter((m) => m.category === category).sort((a, b) => Number(b.eligible) - Number(a.eligible)),
  })).filter((g) => g.metrics.length > 0);
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[₂]/g, '2');

/** Case/diacritic-insensitive match on label, id, unit and plain aliases. */
export function matchesGoalQuery(m: GoalMetric, query: string): boolean {
  const q = norm(query.trim());
  if (!q) return true;
  const hay = norm([m.label, m.id, m.unit, ...m.aliases].join(' '));
  return q.split(/\s+/).every((part) => hay.includes(part));
}

/** Shown on grade-D goals (planner-goals.md §6). */
export const GRADE_D_HELP = 'Based on animal and cell studies. The Planner weights it lightly and won’t trade a higher goal for it.';

/**
 * Grade-D helper for one metric: "animal and cell studies" is only true of the autophagy signal; the other grade-D
 * outcomes (micronutrient score, adherence) are rule-based or expert estimates, so they get a truthful general line.
 */
export function gradeDHelp(metricId: string): string {
  return metricId === 'autophagyIdx'
    ? GRADE_D_HELP
    : 'A rough, low-confidence estimate (grade D). The Planner weights it lightly and won’t trade a higher goal for it.';
}

/** Degradation tolerance ladder (dossier 18 §4.7): goal 1 ≤ 5 %, goal 2 ≤ 10 %, others ≤ 15 %. */
export function ladderTolerance(rankIndex: number): number {
  return rankIndex === 0 ? 0.05 : rankIndex === 1 ? 0.1 : 0.15;
}

/** Strength → explicit tolerance δ (desirability units); undefined = engine default ladder × strictness. */
export function toleranceFor(strength: GoalStrength, rankIndex: number): number | undefined {
  if (strength === 'should') return undefined;
  const base = ladderTolerance(rankIndex);
  return strength === 'must' ? Math.round(base * 0.25 * 1000) / 1000 : Math.min(0.5, Math.round(base * 3 * 1000) / 1000);
}

export const STRENGTH_LABEL: Record<GoalStrength, string> = { must: 'must', should: 'should', nice: 'nice' };
export const STRENGTH_HELP: Record<GoalStrength, string> = {
  must: 'Held almost at its best. Plans that miss it are shown as not achievable.',
  should: 'Kept within a few percent of its best while lower goals are helped.',
  nice: 'Gives way easily; mostly breaks ties between otherwise equal plans.',
};
