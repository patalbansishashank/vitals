/**
 * Goal conflicts and synergies before a run (planner-goals.md §6 "Conflict/synergy connectors"): a static table over
 * goal classes, mirroring the engine's goal classification (src/engine/planner/domain/context.ts `classify`) and the
 * relations dossier 18 §4.13 reports after a run. After a run the engine's own `result.relations` are shown instead.
 */
import type { MetricId } from '@/engine/types/metrics';
import type { GoalDraft } from '@/state/plannerStore';
import { goalMetric } from './catalogue';

export type GoalClass =
  | 'fatLoss'
  | 'weightGain'
  | 'muscle'
  | 'leanKeep'
  | 'transient'
  | 'ketone'
  | 'lipids'
  | 'tgBp'
  | 'glycaemia'
  | 'endurance'
  | 'glycogen'
  | 'comfort'
  | 'expenditure';

const FAT_METRICS = new Set<string>(['fatMass', 'bodyFatPct', 'waist', 'visceralFat', 'liverFat', 'scaleWeight']);
const MUSCLE_METRICS = new Set<string>(['leanTissue', 'skeletalMuscle', 'rtMuscleGain', 'strength']);

/** Classes of one goal as phrased (direction matters: "gain fat mass" is not fat loss). */
export function goalClasses(g: Pick<GoalDraft, 'metric' | 'mode'>): GoalClass[] {
  const m = g.metric as string;
  const down = g.mode === 'lose' || g.mode === 'lower';
  const up = g.mode === 'gain' || g.mode === 'raise' || g.mode === 'reach';
  const out: GoalClass[] = [];
  if (FAT_METRICS.has(m)) {
    if (down) out.push('fatLoss');
    else if (g.mode === 'gain') out.push('weightGain');
  }
  if (MUSCLE_METRICS.has(m)) out.push(g.mode === 'keep' ? 'leanKeep' : 'muscle');
  if (m === 'autophagyIdx' || m === 'igf1') out.push('transient');
  if (m === 'bhb' || m === 'hoursInKetosis' || m === 'ketoAdaptation') out.push('transient', 'ketone');
  if (m === 'ldl' || m === 'apoB') out.push('lipids');
  if (m === 'triglycerides' || m === 'sbp') out.push('tgBp');
  if (m === 'insulinSensitivity' || m === 'fastingGlucose' || m === 'glucose' || m === 'crp') out.push('glycaemia');
  if (m === 'vo2max' || m === 'enduranceCapacity') out.push('endurance');
  if (m === 'glycogenTotal' || m === 'muscleGlycogen') out.push('endurance', 'glycogen');
  if (m === 'hunger' || m === 'adherence' || m === 'ketoInduction') out.push('comfort');
  if (m === 'tdee' || m === 'rmr' || m === 'metabolicAdaptation') out.push('expenditure');
  if (up && FAT_METRICS.has(m) && !out.length) out.push('weightGain');
  return out;
}

export type RelationKind = 'conflict' | 'synergy';

interface RelationRule {
  a: GoalClass;
  b: GoalClass;
  kind: RelationKind;
  /** Short mechanism tag shown on the connector ("fasting vs muscle"). */
  tag: string;
  /** One or two sentences on the mechanism. */
  why: string;
  /** What the ranking does when a / b is ranked first (conflicts only). */
  ifAFirst?: string;
  ifBFirst?: string;
  /** Which side "the signal" in the copy refers to (replaced by that goal's metric name). */
  signal?: 'a' | 'b';
}

const RULES: RelationRule[] = [
  {
    a: 'muscle',
    b: 'transient',
    kind: 'conflict',
    tag: 'fasting vs muscle',
    signal: 'b',
    why: 'Muscle growth needs frequent protein and energy; the signal needs long gaps without them.',
    ifAFirst: 'Your ranking puts muscle first, so plans keep fasts short.',
    ifBFirst: 'Your ranking puts the signal first, so plans may use longer gaps and accept slower muscle gain.',
  },
  {
    a: 'leanKeep',
    b: 'transient',
    kind: 'conflict',
    tag: 'fasting vs lean tissue',
    signal: 'b',
    why: 'Keeping lean tissue needs protein spread through the day; the signal needs long gaps without it.',
    ifAFirst: 'Your ranking puts lean tissue first, so plans keep fasts short and protein high.',
    ifBFirst: 'Your ranking puts the signal first, so plans may use longer gaps and accept a little lean-tissue loss.',
  },
  {
    a: 'fatLoss',
    b: 'muscle',
    kind: 'conflict',
    tag: 'deficit vs growth',
    why: 'Muscle grows best with enough energy; a deficit slows it. Protein and lifting keep the two compatible, but both move more slowly together.',
    ifAFirst: 'Your ranking puts fat loss first, so plans keep the deficit and protect muscle with protein and lifting.',
    ifBFirst: 'Your ranking puts muscle first, so plans keep the deficit small.',
  },
  {
    a: 'fatLoss',
    b: 'leanKeep',
    kind: 'synergy',
    tag: 'protein and lifting',
    why: 'Keeping lean tissue keeps more of your energy expenditure, which helps fat loss.',
  },
  { a: 'fatLoss', b: 'lipids', kind: 'synergy', tag: 'fat loss lowers LDL', why: 'Losing fat tends to lower LDL cholesterol and ApoB a little.' },
  { a: 'fatLoss', b: 'tgBp', kind: 'synergy', tag: 'fat loss', why: 'Losing fat lowers triglycerides and blood pressure.' },
  { a: 'fatLoss', b: 'glycaemia', kind: 'synergy', tag: 'fat loss', why: 'Losing fat, especially around the organs, improves insulin sensitivity and fasting glucose.' },
  {
    a: 'fatLoss',
    b: 'comfort',
    kind: 'conflict',
    tag: 'deficit vs hunger',
    why: 'A deficit raises hunger as fat and leptin fall.',
    ifAFirst: 'Your ranking puts fat loss first, so plans accept some hunger and soften it with protein, fibre and diet breaks.',
    ifBFirst: 'Your ranking puts hunger first, so plans lose fat more slowly.',
  },
  {
    a: 'fatLoss',
    b: 'expenditure',
    kind: 'conflict',
    tag: 'deficit vs expenditure',
    why: 'Losing weight lowers energy expenditure, and a deficit adds some metabolic adaptation.',
    ifAFirst: 'Your ranking puts fat loss first, so plans accept a lower expenditure.',
    ifBFirst: 'Your ranking puts expenditure first, so plans use smaller deficits and breaks.',
  },
  { a: 'fatLoss', b: 'endurance', kind: 'synergy', tag: 'cardio', why: 'Aerobic training raises fitness and adds to the energy deficit.' },
  {
    a: 'fatLoss',
    b: 'weightGain',
    kind: 'conflict',
    tag: 'opposite directions',
    why: 'Losing fat and gaining weight pull directly apart.',
    ifAFirst: 'Your ranking puts fat loss first, so weight gain comes from lean tissue only, if at all.',
    ifBFirst: 'Your ranking puts weight gain first, so fat loss is limited.',
  },
  {
    a: 'transient',
    b: 'comfort',
    kind: 'conflict',
    tag: 'fasting vs hunger',
    signal: 'a',
    why: 'Long gaps without food raise hunger on those days.',
    ifAFirst: 'Your ranking puts the signal first, so plans accept hungrier fast days.',
    ifBFirst: 'Your ranking puts hunger first, so plans keep gaps short.',
  },
  {
    a: 'ketone',
    b: 'lipids',
    kind: 'conflict',
    tag: 'ketosis vs LDL',
    why: 'Very-low-carbohydrate eating that raises ketones often raises LDL cholesterol, especially with more saturated fat.',
    ifAFirst: 'Your ranking puts ketones first, so plans accept some LDL rise and favour unsaturated fats.',
    ifBFirst: 'Your ranking puts LDL first, so plans keep carbohydrate higher and ketosis short.',
  },
  {
    a: 'ketone',
    b: 'glycogen',
    kind: 'conflict',
    tag: 'ketosis vs glycogen',
    why: 'Ketosis needs low glycogen; performance needs it full.',
    ifAFirst: 'Your ranking puts ketones first, so glycogen stays low.',
    ifBFirst: 'Your ranking puts glycogen first, so ketosis stays light.',
  },
  { a: 'muscle', b: 'expenditure', kind: 'synergy', tag: 'more muscle', why: 'More lean tissue keeps resting expenditure up.' },
  { a: 'leanKeep', b: 'expenditure', kind: 'synergy', tag: 'lean tissue', why: 'Keeping lean tissue keeps resting expenditure up.' },
];

export interface GoalRelation {
  /** 0-based rank indices, `from` < `to`. */
  from: number;
  to: number;
  kind: RelationKind;
  tag: string;
  /** Plain explanation including what the ranking does. */
  text: string;
}

function metricWord(id: MetricId): string {
  return (goalMetric(id)?.label ?? id).toLowerCase();
}

/** Every pairwise relation among the ranked goals (conflicts first, then by rank distance). */
export function goalRelations(goals: readonly Pick<GoalDraft, 'metric' | 'mode'>[]): GoalRelation[] {
  const classes = goals.map(goalClasses);
  const out: GoalRelation[] = [];
  for (let i = 0; i < goals.length; i++)
    for (let j = i + 1; j < goals.length; j++) {
      const ci = classes[i]!;
      const cj = classes[j]!;
      let found: GoalRelation | null = null;
      for (const r of RULES) {
        const aFirst = ci.includes(r.a) && cj.includes(r.b);
        const bFirst = ci.includes(r.b) && cj.includes(r.a);
        if (!aFirst && !bFirst) continue;
        // index of the goal playing side a / side b of the rule
        const ia = aFirst ? i : j;
        const ib = aFirst ? j : i;
        const name = r.signal ? `the ${metricWord(goals[r.signal === 'a' ? ia : ib]!.metric)}` : '';
        const fill = (t: string) => (r.signal ? t.replace(/the signal/g, name) : t);
        const tail = r.kind === 'conflict' ? (aFirst ? r.ifAFirst : r.ifBFirst) : undefined;
        found = { from: i, to: j, kind: r.kind, tag: r.tag, text: fill(tail ? `${r.why} ${tail}` : r.why) };
        if (r.kind === 'conflict') break;
      }
      if (!found) {
        const shared = ci.find((c) => cj.includes(c) && c !== 'transient');
        if (shared === 'fatLoss')
          found = { from: i, to: j, kind: 'synergy', tag: 'same direction', text: 'Both fall together as fat is lost.' };
      }
      if (found) out.push(found);
    }
  return out.sort((a, b) => (a.kind === b.kind ? a.to - a.from - (b.to - b.from) || a.from - b.from : a.kind === 'conflict' ? -1 : 1));
}

/** The one connector shown under each row (attached to the lower-ranked goal of a pair; conflicts win). */
export function connectorsByRow(relations: readonly GoalRelation[]): Map<number, GoalRelation> {
  const map = new Map<number, GoalRelation>();
  for (const r of relations) {
    const cur = map.get(r.to);
    if (!cur || (cur.kind === 'synergy' && r.kind === 'conflict')) map.set(r.to, r);
  }
  return map;
}
