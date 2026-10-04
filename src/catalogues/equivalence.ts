/**
 * Equivalence credit (PLAN items 6, 11, 12, 13; R3 §5; PLANNER_V2 §8.6; SUITE_SPEC §3.7).
 *
 * A logged session is never rejected as "the wrong exercise": it is scored against the prescription by stimulus terms,
 * S = Σ α_k·S_k over hypertrophy volume, strength specificity, cardio, energy and mobility (over-delivery capped per
 * term, no cross-term credit). S ≥ 0.90 → full credit (parity); 0.60–0.90 → partial, with the largest fix; < 0.60 →
 * a different stimulus, credited for what it trains. The engine always simulates the logged stimulus; S is only the
 * adherence credit. Meals are credited the same way against nutrient targets.
 *
 * Unknown exercises resolve to a draft record (catalogue match → pluggable resolver (the AI) → keyword heuristic) and
 * join the user's catalogue as `mapped` items with a wider τ; nothing is refused.
 */
import { cp, INTENT_DEFAULTS, type GoalClass } from './params';
import { aggregateStimulus, fLoadStrength, resolveDose, type StimulusContext } from './stimulus';
import { energyText, normName } from './text';
import { PATTERN_LABEL, REGION_LABEL } from './vocab';
import { USER_SOURCE } from './catalogue';
import type {
  Catalogue,
  CreditBand,
  DefaultDose,
  EquipmentItem,
  ExerciseDraft,
  ExerciseRecord,
  ExerciseResolver,
  LoadClass,
  LoadType,
  MealTotals,
  MovementPattern,
  NutrientEquivalenceResult,
  NutrientTargets,
  PerformedExercise,
  ShortfallNote,
  StimulusIntent,
  StimulusTermId,
  StimulusVector,
  StrengthWork,
  EquivalenceResult,
  TrainingRegion,
} from './types';

// ================================================================== intent

/** R3 §5.1 intent defaults by goal class. */
export function intentFor(goal: GoalClass): StimulusIntent {
  return { ...INTENT_DEFAULTS[goal] };
}

/** A sensible α when the planner has not supplied one: from what the prescription itself trains. */
export function defaultIntent(prescribed: StimulusVector): StimulusIntent {
  const sets = Object.values(prescribed.effectiveSetsByRegion).reduce<number>((a, b) => a + (b ?? 0), 0);
  const mob = Object.values(prescribed.mobilityMinutes).reduce<number>((a, b) => a + b, 0);
  if (sets <= 0 && prescribed.mem <= 0 && prescribed.netKcal <= 0 && mob > 0) return intentFor('mobility');
  if (sets <= 0 && (prescribed.mem > 0 || prescribed.hiMinutes > 0)) return intentFor('vo2max');
  if (sets > 0 && prescribed.loadClass === 'heavy') return intentFor('strength');
  if (sets > 0) return intentFor('muscle');
  return intentFor('fatLoss');
}

// ================================================================== component scores (R3 §5.2)

const NEIGHBOURS: ReadonlyArray<readonly [MovementPattern, MovementPattern]> = [
  ['horizontalPush', 'verticalPush'],
  ['horizontalPull', 'verticalPull'],
  ['squat', 'lunge'],
  ['hinge', 'ballisticHinge'],
];

/** R3 §5.2 strength-transfer coefficient c between a logged and a prescribed pattern/implement. */
export function transferCoefficient(log: Pick<StrengthWork, 'pattern' | 'implement'>, pre: Pick<StrengthWork, 'pattern' | 'implement'>): number {
  if (log.pattern === pre.pattern) return log.implement === pre.implement ? cp('cSamePatternSameImplement') : cp('cSamePattern');
  if (NEIGHBOURS.some(([a, b]) => (a === log.pattern && b === pre.pattern) || (b === log.pattern && a === pre.pattern))) return cp('cNeighbourPattern');
  return cp('cOtherPattern');
}

const sumVals = (o: Partial<Record<string, number>>): number => Object.values(o).reduce<number>((a, b) => a + (b ?? 0), 0);

interface TermEval {
  term: StimulusTermId;
  ratio: number;
  /** False when the prescription has nothing on this term (it drops out). */
  present: boolean;
}

function sHyp(pre: StimulusVector, log: StimulusVector): TermEval {
  let num = 0;
  let den = 0;
  for (const [r, e] of Object.entries(pre.effectiveSetsByRegion) as Array<[TrainingRegion, number]>) {
    if (!(e > 0)) continue;
    const pi = pre.regionPriority?.[r] ?? 1;
    num += pi * Math.min(log.effectiveSetsByRegion[r] ?? 0, e);
    den += pi * e;
  }
  return { term: 'hyp', ratio: den > 0 ? num / den : 1, present: den > 0 };
}

function sStr(pre: StimulusVector, log: StimulusVector): TermEval {
  const preWork: StrengthWork[] = pre.strength && pre.strength.length > 0 ? pre.strength : [];
  if (preWork.length === 0) return { term: 'str', ratio: 1, present: false };
  const logWork: StrengthWork[] = log.strength ?? [];
  let num = 0;
  let den = 0;
  for (const p of preWork) {
    let best = 0;
    for (const l of logWork) {
      const s = transferCoefficient(l, p) * Math.min(1, fLoadStrength(l.loadPct) / fLoadStrength(p.loadPct));
      if (s > best) best = s;
    }
    num += p.sets * best;
    den += p.sets;
  }
  return { term: 'str', ratio: den > 0 ? num / den : 1, present: true };
}

function sCard(pre: StimulusVector, log: StimulusVector): TermEval {
  if (!(pre.mem > 0) && !(pre.hiMinutes > 0)) return { term: 'card', ratio: 1, present: false };
  const memR = pre.mem > 0 ? Math.min(1, log.mem / pre.mem) : 1;
  const hiR = pre.hiMinutes > 0 ? 0.5 + 0.5 * Math.min(1, log.hiMinutes / pre.hiMinutes) : 1;
  return { term: 'card', ratio: memR * hiR, present: true };
}

function sKcal(pre: StimulusVector, log: StimulusVector): TermEval {
  if (!(pre.netKcal > 0)) return { term: 'kcal', ratio: 1, present: false };
  return { term: 'kcal', ratio: Math.min(1, Math.max(0, log.netKcal) / pre.netKcal), present: true };
}

/** Mobility: specific targets first, then logged "general" minutes fill the remaining gaps. */
function sMob(pre: StimulusVector, log: StimulusVector): TermEval {
  const den = sumVals(pre.mobilityMinutes);
  if (!(den > 0)) return { term: 'mob', ratio: 1, present: false };
  let general = log.mobilityMinutes.general ?? 0;
  let num = 0;
  for (const [t, m] of Object.entries(pre.mobilityMinutes)) {
    const specific = t === 'general' ? 0 : Math.min(m, log.mobilityMinutes[t] ?? 0);
    const fill = Math.min(m - specific, general);
    general -= fill;
    num += specific + fill;
  }
  return { term: 'mob', ratio: num / den, present: true };
}

const LOAD_RANK: Readonly<Record<LoadClass, number>> = { veryLight: 0, light: 1, moderate: 2, heavy: 3 };
const fmt = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'}`;

function shortfallFor(term: TermEval, pre: StimulusVector, log: StimulusVector): ShortfallNote | null {
  switch (term.term) {
    case 'hyp': {
      let worst: TrainingRegion | null = null;
      let worstGap = 0;
      for (const [r, e] of Object.entries(pre.effectiveSetsByRegion) as Array<[TrainingRegion, number]>) {
        const gap = (pre.regionPriority?.[r] ?? 1) * (e - (log.effectiveSetsByRegion[r] ?? 0));
        if (gap > worstGap + 1e-12 || (Math.abs(gap - worstGap) <= 1e-12 && worst !== null && r < worst)) {
          worstGap = gap;
          worst = r;
        }
      }
      if (!worst) return null;
      const missing = (pre.effectiveSetsByRegion[worst] ?? 0) - (log.effectiveSetsByRegion[worst] ?? 0);
      const per = log.perSetCredit?.[worst] ?? 0;
      const lighter = LOAD_RANK[log.loadClass] < LOAD_RANK[pre.loadClass] && (log.strength?.length ?? 0) > 0;
      const effort = (log.meanRir ?? 0) > cp('effortRirThreshold');
      if (per > 0) {
        const n = Math.max(1, Math.ceil(missing / per - 1e-9));
        const sets = n > 3 ? `add ${fmt(n, 'set')}, or an exercise that works the ${REGION_LABEL[worst]} directly` : `add ${fmt(n, 'set')}`;
        const fix = effort ? `${sets}, or finish each set closer to failure` : sets;
        return { term: 'hyp', missing, text: lighter ? `Lighter load: ${fix}.` : `${REGION_LABEL[worst][0]!.toUpperCase()}${REGION_LABEL[worst].slice(1)} work is short: ${fix}.` };
      }
      const n = Math.max(1, Math.ceil(missing - 1e-9));
      return { term: 'hyp', missing, text: `No ${REGION_LABEL[worst]} work yet: about ${fmt(n, 'hard set')} would close it.` };
    }
    case 'str': {
      const pre0 = pre.strength?.[0];
      return {
        term: 'str',
        missing: 1 - term.ratio,
        text:
          LOAD_RANK[log.loadClass] < LOAD_RANK[pre.loadClass]
            ? 'For strength, use a heavier variant, or a load you can lift no more than 8 times.'
            : `For strength, practise the ${pre0 ? PATTERN_LABEL[pre0.pattern] : 'prescribed'} movement itself.`,
      };
    }
    case 'card': {
      const memGap = pre.mem - log.mem;
      if (pre.hiMinutes > 0 && log.hiMinutes < pre.hiMinutes && memGap <= 0) {
        return { term: 'card', missing: pre.hiMinutes - log.hiMinutes, text: 'Do part of it at a pace you cannot talk through.' };
      }
      const perMin = log.memPerMin && log.memPerMin > 0 ? log.memPerMin : 1;
      const n = Math.max(1, Math.ceil(memGap / perMin - 1e-9));
      return { term: 'card', missing: memGap, text: `${n} more minutes at a brisk pace would close the aerobic gap.` };
    }
    case 'kcal': {
      const gap = pre.netKcal - log.netKcal;
      const per = log.netKcalPerMin ?? 0;
      if (per > 0) {
        const n = Math.max(1, Math.ceil(gap / per - 1e-9));
        return { term: 'kcal', missing: gap, text: `${n} more minutes would close the energy gap.` };
      }
      return { term: 'kcal', missing: gap, text: `About ${energyText(gap)} of activity is still open.` };
    }
    case 'mob': {
      const gaps = Object.entries(pre.mobilityMinutes)
        .map(([t, m]) => [t, m - (log.mobilityMinutes[t] ?? 0)] as const)
        .filter(([, g]) => g > 0.05)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      const total = gaps.reduce((a, [, g]) => a + g, 0);
      const names = gaps.slice(0, 2).map(([t]) => t.replace(/_/g, ' ')).join(' and ');
      return { term: 'mob', missing: total, text: `${Math.max(1, Math.ceil(total - 1e-9))} more minutes of stretching${names ? ` for ${names}` : ''}.` };
    }
  }
}

function bandOf(score: number): CreditBand {
  return score >= cp('creditFull') ? 'full' : score >= cp('creditPartial') ? 'partial' : 'different';
}

/**
 * PLANNER_V2 §8.6 `stimulusEquivalence(prescribed, performed, alpha)`. Components with α = 0 or an empty prescription
 * drop out and the rest are renormalised; π_r defaults to the prescription's own region roles (`regionPriority`; direct
 * 1, indirect 0.5), else 1.
 */
export function stimulusEquivalence(prescribed: StimulusVector, performed: StimulusVector, alpha: StimulusIntent = defaultIntent(prescribed)): EquivalenceResult {
  const terms = [sHyp(prescribed, performed), sStr(prescribed, performed), sCard(prescribed, performed), sKcal(prescribed, performed), sMob(prescribed, performed)];
  let num = 0;
  let den = 0;
  const perTerm: EquivalenceResult['perTerm'] = [];
  for (const t of terms) {
    const w = alpha[t.term];
    if (!t.present || !(w > 0)) continue;
    num += w * t.ratio;
    den += w;
    perTerm.push({ term: t.term, ratio: t.ratio, weight: w });
  }
  const score = den > 0 ? Math.min(1, Math.max(0, num / den)) : 1;
  const band = bandOf(score);
  const parity = band === 'full';
  const shortfall: ShortfallNote[] = [];
  if (!parity) {
    const gaps = perTerm
      .filter((t) => t.ratio < cp('creditFull'))
      .sort((a, b) => b.weight * (1 - b.ratio) - a.weight * (1 - a.ratio) || a.term.localeCompare(b.term));
    for (const g of gaps) {
      const note = shortfallFor(terms.find((t) => t.term === g.term)!, prescribed, performed);
      if (note) shortfall.push(note);
    }
  }
  const alsoTrained = (Object.entries(performed.effectiveSetsByRegion) as Array<[TrainingRegion, number]>)
    .filter(([r, v]) => v >= 0.5 && !((prescribed.effectiveSetsByRegion[r] ?? 0) > 0))
    .map(([r]) => r)
    .sort();
  return { score, credit: parity ? 1 : score, parity, band, perTerm, shortfall, alsoTrained };
}

/** Stimulus vector of a prescription or log; entries not in the catalogue contribute nothing. */
export function vectorOf(items: readonly PerformedExercise[], catalogue: Catalogue, ctx: StimulusContext): StimulusVector {
  const doses = [];
  for (const p of items) {
    const ex = p.exerciseId ? catalogue.exercise(p.exerciseId) : undefined;
    if (ex) doses.push(resolveDose(ex, p, ctx));
  }
  return aggregateStimulus(doses);
}

/** Equivalence of a logged session (one or more exercises) to a prescribed one, both as catalogue instances. */
export function sessionEquivalence(
  prescribed: readonly PerformedExercise[],
  performed: readonly PerformedExercise[],
  catalogue: Catalogue,
  ctx: StimulusContext,
  alpha?: StimulusIntent,
): EquivalenceResult {
  const pre = vectorOf(prescribed, catalogue, ctx);
  const log = vectorOf(performed, catalogue, ctx);
  return stimulusEquivalence(pre, log, alpha ?? defaultIntent(pre));
}

// ================================================================== meals vs nutrient targets

/**
 * Meal (or day) equivalence against nutrient targets (PLAN item 11: "a different dish with the same nutrients fulfils
 * the meal"). Each targeted nutrient scores 1 inside its R4 §3.5 tolerance (protein and fibre overshoot score 1) and
 * tapers linearly to 0 beyond it; the weights are R4 §3.4's (energy 4, protein 3, carbohydrate 2, fat 2, fibre 1.5);
 * the saturated-fat cap folds into the fat score. Bands as for exercise.
 */
export function nutrientEquivalence(targets: NutrientTargets, actual: MealTotals): NutrientEquivalenceResult {
  const taper = cp('nutrientTaperRel');
  const per: NutrientEquivalenceResult['perNutrient'] = [];
  const shortfall: NutrientEquivalenceResult['shortfall'] = [];
  const outside = (excess: number, T: number): number => Math.max(0, 1 - excess / Math.max(1e-9, taper * T));
  const pushShort = (nutrient: keyof NutrientTargets, missing: number, text: string): void => void shortfall.push({ nutrient, missing, text });

  if (targets.energyKcal !== undefined && targets.energyKcal > 0) {
    const T = targets.energyKcal;
    const tol = Math.max(cp('tolEnergyRel') * T, cp('tolEnergyAbsKcal'));
    const dev = actual.energyKcal - T;
    const s = Math.abs(dev) <= tol ? 1 : outside(Math.abs(dev) - tol, T);
    per.push({ nutrient: 'energyKcal', target: T, actual: actual.energyKcal, ratio: actual.energyKcal / T, score: s, weight: cp('wKcal') });
    if (s < 1) pushShort('energyKcal', -dev, dev < 0 ? `Energy short by ${energyText(-dev)}.` : `Energy over by ${energyText(dev)}.`);
  }
  if (targets.proteinG !== undefined && targets.proteinG > 0) {
    const T = targets.proteinG;
    const lower = T * (1 - cp('tolProteinUnder'));
    const s = actual.proteinG >= lower ? 1 : outside(lower - actual.proteinG, T);
    per.push({ nutrient: 'proteinG', target: T, actual: actual.proteinG, ratio: actual.proteinG / T, score: s, weight: cp('wProtein') });
    if (s < 1) pushShort('proteinG', T - actual.proteinG, `Protein short by ${Math.round(T - actual.proteinG)} g.`);
  }
  if (targets.netCarbG !== undefined && targets.netCarbG >= 0) {
    const T = targets.netCarbG;
    let s: number;
    if (targets.lowCarbDay) {
      const ceiling = T + cp('tolCarbLowCarbAbsG');
      s = actual.netCarbG <= ceiling ? 1 : outside(actual.netCarbG - ceiling, Math.max(T, 20));
      if (s < 1) pushShort('netCarbG', ceiling - actual.netCarbG, `Carbohydrate over the low-carb ceiling by ${Math.round(actual.netCarbG - ceiling)} g.`);
    } else {
      const tol = cp('tolCarbRel') * T;
      const dev = actual.netCarbG - T;
      s = Math.abs(dev) <= tol ? 1 : outside(Math.abs(dev) - tol, Math.max(T, 1));
      if (s < 1) pushShort('netCarbG', -dev, dev < 0 ? `Carbohydrate short by ${Math.round(-dev)} g.` : `Carbohydrate over by ${Math.round(dev)} g.`);
    }
    if (T > 0 || targets.lowCarbDay) per.push({ nutrient: 'netCarbG', target: T, actual: actual.netCarbG, ratio: T > 0 ? actual.netCarbG / T : 0, score: s, weight: cp('wCarb') });
  }
  if (targets.fatG !== undefined && targets.fatG > 0) {
    const T = targets.fatG;
    const tol = cp('tolFatRel') * T;
    const dev = actual.fatG - T;
    let s = Math.abs(dev) <= tol ? 1 : outside(Math.abs(dev) - tol, T);
    if (s < 1) pushShort('fatG', -dev, dev < 0 ? `Fat short by ${Math.round(-dev)} g.` : `Fat over by ${Math.round(dev)} g.`);
    if (targets.satFatMaxG !== undefined && actual.satFatG > targets.satFatMaxG) {
      const sf = outside(actual.satFatG - targets.satFatMaxG, targets.satFatMaxG);
      if (sf < s) s = sf;
      pushShort('satFatMaxG', targets.satFatMaxG - actual.satFatG, `Saturated fat over the cap by ${Math.round(actual.satFatG - targets.satFatMaxG)} g.`);
    }
    per.push({ nutrient: 'fatG', target: T, actual: actual.fatG, ratio: actual.fatG / T, score: s, weight: cp('wFat') });
  }
  if (targets.fibreG !== undefined && targets.fibreG > 0) {
    const T = targets.fibreG;
    const lower = T * (1 - cp('tolFibreUnder'));
    const s = actual.fibreG >= lower ? 1 : outside(lower - actual.fibreG, T);
    per.push({ nutrient: 'fibreG', target: T, actual: actual.fibreG, ratio: actual.fibreG / T, score: s, weight: cp('wFibre') });
    if (s < 1) pushShort('fibreG', T - actual.fibreG, `Fibre short by ${Math.round(T - actual.fibreG)} g.`);
  }
  const den = per.reduce((a, p) => a + p.weight, 0);
  const score = den > 0 ? per.reduce((a, p) => a + p.weight * p.score, 0) / den : 1;
  const band = bandOf(score);
  const order = new Map(per.map((p) => [p.nutrient as string, p.weight * (1 - p.score)]));
  shortfall.sort((a, b) => (order.get(b.nutrient) ?? 0) - (order.get(a.nutrient) ?? 0));
  return { score, credit: band === 'full' ? 1 : score, parity: band === 'full', band, perNutrient: per, shortfall: band === 'full' ? [] : shortfall };
}

// ================================================================== unknown exercises (PLAN item 11 "resolved on the spot")

interface KeywordRule {
  re: RegExp;
  pattern: MovementPattern;
  loadType?: LoadType;
  regions?: Partial<Record<TrainingRegion, number>>;
}

/** Keyword → pattern rules, most specific first (engineering heuristic; the AI resolver supersedes it). */
const RULES: readonly KeywordRule[] = [
  { re: /\b(stretch|yoga|asana|mobility|foam roll)/, pattern: 'mobility', loadType: 'mobility' },
  { re: /\b(club|mudgar|mugdar|mace|gada|sledge ?hammer)/, pattern: 'rotationalSwing', loadType: 'ballistic' },
  { re: /\b(kettlebell swing|swing)/, pattern: 'ballisticHinge', loadType: 'ballistic' },
  { re: /\b(jump rope|skipping|skip)/, pattern: 'locomotion', loadType: 'cardio' },
  { re: /\b(rowing machine|rower|erg)/, pattern: 'row', loadType: 'cardio' },
  { re: /\b(walk|hike|stroll|trek)/, pattern: 'locomotion', loadType: 'cardio' },
  { re: /\b(run|jog|sprint)/, pattern: 'locomotion', loadType: 'cardio' },
  { re: /\b(cycl|bike|spin)/, pattern: 'cycle', loadType: 'cardio' },
  { re: /\b(swim)/, pattern: 'swim', loadType: 'cardio' },
  { re: /\b(dance|garba|zumba|aerobic)/, pattern: 'locomotion', loadType: 'cardio' },
  { re: /\b(curl)/, pattern: 'elbowFlexion' },
  { re: /\b(tricep|kickback|skull)/, pattern: 'elbowExtension' },
  { re: /\b(pull ?up|chin ?up|pulldown|pull down)/, pattern: 'verticalPull' },
  { re: /\b(row)/, pattern: 'horizontalPull' },
  { re: /\b(bench|push ?up|press up|chest press|dand|fly|flye)/, pattern: 'horizontalPush' },
  { re: /\b(overhead|shoulder press|military|press)/, pattern: 'verticalPush' },
  { re: /\b(lateral raise|front raise|raise)/, pattern: 'shoulderIsolation' },
  { re: /\b(lunge|split squat|step ?up)/, pattern: 'lunge' },
  { re: /\b(squat|baithak|bethak|sit to stand)/, pattern: 'squat' },
  { re: /\b(deadlift|good morning|rdl|hinge|bridge|hip thrust)/, pattern: 'hinge' },
  { re: /\b(carry|farmer|suitcase)/, pattern: 'carry' },
  { re: /\b(plank|hold|hollow)/, pattern: 'coreAntiExtension', loadType: 'isometric' },
  { re: /\b(crunch|sit ?up|leg raise)/, pattern: 'coreFlexion' },
  { re: /\b(calf)/, pattern: 'calfRaise' },
];
const ODD = /\b(sandbag|wheel|stone|rock|log|jug|bucket|tyre|tire|backpack|brick|rod|pipe|bag of)/;
const EXTERNAL = /\b(dumbbell|barbell|kettlebell|weight|weights|kg|plate|band|tube|cable|machine)/;
const CARDIO_MODALITY: ReadonlyArray<readonly [RegExp, NonNullable<ExerciseRecord['cardioModality']>]> = [
  [/\b(run|jog|sprint)/, 'run'],
  [/\b(walk|hike|stroll|trek)/, 'walk'],
  [/\b(cycl|bike|spin)/, 'cycle'],
  [/\b(swim)/, 'swim'],
  [/\b(rowing machine|rower|erg)/, 'row'],
];

function draftFrom(ex: ExerciseRecord, name: string, description: string | undefined, resolvedBy: ExerciseDraft['resolvedBy'], confidence: number, override?: Partial<ExerciseDraft>): ExerciseDraft {
  return {
    name,
    ...(description ? { description } : {}),
    pattern: ex.pattern,
    regions: { ...ex.regions },
    loadType: ex.loadType,
    intensityScale: ex.intensityScale,
    volumeUnit: ex.volumeUnit,
    defaultDose: { ...ex.defaultDose },
    secPerRep: ex.secPerRep,
    metGross: ex.energy.metGross,
    metRange: ex.energy.metRange,
    cardioModality: ex.cardioModality,
    hybridCardioShare: ex.hybridCardioShare,
    mobilityTargets: [...ex.mobilityTargets],
    equipmentAnyOf: ex.equipmentAnyOf.map((a) => [...a]),
    skill: ex.skill,
    injuryRisk: ex.injuryRisk,
    contraTags: [...ex.contraTags],
    mechanism: ex.mechanism,
    confidence,
    resolvedBy,
    basedOn: ex.id,
    ...override,
  };
}

/** Pick the catalogue template that best matches a pattern and load type (same pattern + load, then same pattern). */
function templateFor(catalogue: Catalogue, pattern: MovementPattern, loadType: LoadType | undefined, modality: ExerciseRecord['cardioModality'] | undefined): ExerciseRecord | undefined {
  const pool = catalogue.exercises.filter((e) => e.origin === 'seed');
  const score = (e: ExerciseRecord): number =>
    (e.pattern === pattern ? 4 : 0) + (loadType && e.loadType === loadType ? 2 : 0) + (modality && e.cardioModality === modality ? 3 : 0) + (e.equipmentAnyOf.some((a) => a.length === 0) ? 0.5 : 0);
  let best: ExerciseRecord | undefined;
  let bestS = 0;
  for (const e of pool) {
    const s = score(e);
    if (s > bestS || (s === bestS && best && e.id < best.id)) {
      best = e;
      bestS = s;
    }
  }
  return bestS >= 4 ? best : pool.find((e) => e.id === 'kushti_circuit') ?? best;
}

/**
 * Resolve an unknown exercise without a model: catalogue name/alias match, else keyword rules onto the closest seed
 * template (its regions, MET and dose), with the load type taken from the description (odd objects → odd-object,
 * named weights or bands → external). Low confidence by design; the AI resolver replaces it when available.
 */
export function resolveUnknownSync(name: string, description: string | undefined, catalogue: Catalogue): ExerciseDraft {
  const hit = catalogue.searchExercises(name, 1)[0];
  if (hit) {
    const s = Math.max(...[hit.name, hit.id.replace(/_/g, ' '), ...hit.aliases].map((n) => (normName(n) === normName(name) ? 1 : 0)));
    if (s === 1) return draftFrom(hit, hit.name, description, 'catalogue', 1);
  }
  const text = normName(`${name} ${description ?? ''}`);
  const rule = RULES.find((r) => r.re.test(text));
  const modality = CARDIO_MODALITY.find(([re]) => re.test(text))?.[1];
  let loadType: LoadType | undefined = rule?.loadType;
  if (!loadType && rule) loadType = ODD.test(text) ? 'odd-object' : EXTERNAL.test(text) ? 'external' : 'bodyweight';
  const pattern = rule?.pattern ?? 'complex';
  const tpl = templateFor(catalogue, pattern, loadType, modality);
  if (!tpl) throw new Error('catalogue has no seed exercises to base a draft on');
  const isOdd = loadType === 'odd-object' && tpl.loadType !== 'odd-object';
  return draftFrom(tpl, name, description, 'heuristic', rule ? 0.5 : 0.2, {
    ...(loadType && (tpl.loadType === 'bodyweight' || tpl.loadType === 'external' || tpl.loadType === 'odd-object') ? { loadType } : {}),
    ...(isOdd ? { intensityScale: 'kgRpe' as const, equipmentAnyOf: [[]] } : {}),
    mechanism: `${PATTERN_LABEL[pattern][0]!.toUpperCase()}${PATTERN_LABEL[pattern].slice(1)} work, counted like ${tpl.name.toLowerCase()} by the muscles it loads.`,
  });
}

/**
 * Plausible default-dose values: [min, max, whole numbers only]. Sane outer limits for one exercise, well beyond
 * every seed exercise (sets 2–4, reps 1–50, rest 10–180 s, 5–90 min), so only nonsense (sets 1e9, reps −5) fails.
 */
const DOSE_BOUNDS: Readonly<Record<keyof DefaultDose, readonly [number, number, boolean]>> = {
  sets: [1, 20, true],
  reps: [1, 200, true],
  rir: [0, 10, false],
  restSec: [0, 900, false],
  holdSec: [1, 600, false],
  durationSec: [1, 3600, false],
  durationMin: [1, 600, false],
  rounds: [1, 100, true],
  workSec: [1, 3600, false],
  secPerRound: [1, 3600, false],
};
/** Gross MET bounds: resting is 1; 20 is beyond sustained elite effort (the AI prompt asks for 1–20). */
const MET_GROSS_MIN = 1;
const MET_GROSS_MAX = 20;

/** Problems with a draft (an AI or form result) that make it unusable; empty = valid. */
export function validateDraft(d: ExerciseDraft): string[] {
  const out: string[] = [];
  if (!d.name.trim()) out.push('name is empty');
  if (!d.mechanism.trim()) out.push('mechanism is empty');
  if (!(d.metGross >= MET_GROSS_MIN && d.metGross <= MET_GROSS_MAX)) out.push(`metGross must be in [${MET_GROSS_MIN}, ${MET_GROSS_MAX}]`);
  if (!(d.hybridCardioShare >= 0 && d.hybridCardioShare <= 1)) out.push('hybridCardioShare outside [0, 1]');
  for (const [r, w] of Object.entries(d.regions)) if (!(typeof w === 'number' && w > 0 && w <= 1)) out.push(`region ${r} weight outside (0, 1]`);
  // cardio and mobility work may load no region (as walking or stretches in the seed catalogue); strength work must
  if (d.loadType !== 'cardio' && d.loadType !== 'mobility' && Object.keys(d.regions).length === 0) out.push('regions is empty');
  const dd = d.defaultDose;
  for (const [k, v] of Object.entries(dd) as Array<[keyof DefaultDose, number | undefined]>) {
    const b = DOSE_BOUNDS[k];
    if (v === undefined || !b) continue;
    if (!(typeof v === 'number' && v >= b[0] && v <= b[1] && (!b[2] || Number.isInteger(v)))) out.push(`defaultDose.${k} must be ${b[2] ? 'a whole number ' : ''}in [${b[0]}, ${b[1]}]`);
  }
  if (!((dd.sets ?? 0) > 0 || (dd.rounds ?? 0) > 0 || (dd.durationMin ?? 0) > 0)) out.push('defaultDose has no volume');
  if (!(d.confidence >= 0 && d.confidence <= 1)) out.push('confidence outside [0, 1]');
  return out;
}

/**
 * Resolve an unknown exercise: exact catalogue match → `resolver` (the AI, through E9's tool) → keyword heuristic.
 * Never rejects; the result becomes a `mapped` record via `draftToRecord`.
 */
export async function resolveUnknown(name: string, description: string | undefined, opts: { catalogue: Catalogue; resolver?: ExerciseResolver }): Promise<ExerciseDraft> {
  const exact = resolveUnknownSync(name, description, opts.catalogue);
  if (exact.resolvedBy === 'catalogue') return exact;
  if (opts.resolver) {
    try {
      const d = await opts.resolver.resolve({ name, ...(description ? { description } : {}) }, { candidates: opts.catalogue.exercises });
      if (d && validateDraft(d).length === 0) return { ...d, resolvedBy: d.resolvedBy === 'user' ? 'user' : 'ai' };
    } catch {
      /* the heuristic below stands in when the provider fails */
    }
  }
  return exact;
}

/** A user-catalogue record from a draft: `mapped`, certainty D, wider τ (author ai/user), never rejected. */
export function draftToRecord(d: ExerciseDraft, opts: { id: string; origin?: 'ai-resolved' | 'user' }): ExerciseRecord {
  const origin = opts.origin ?? (d.resolvedBy === 'user' ? 'user' : 'ai-resolved');
  const range = d.metRange ?? [Math.max(1, d.metGross * 0.75), d.metGross * 1.25];
  const lo = Math.min(range[0], d.metGross);
  const hi = Math.max(range[1], d.metGross);
  return {
    id: opts.id,
    name: d.name,
    aliases: d.aliases ?? [],
    tradition: 'home',
    equipmentAnyOf: d.equipmentAnyOf && d.equipmentAnyOf.length > 0 ? d.equipmentAnyOf : [[]],
    pattern: d.pattern,
    regions: { ...d.regions },
    loadType: d.loadType,
    intensityScale: d.intensityScale,
    volumeUnit: d.volumeUnit,
    defaultDose: { ...d.defaultDose },
    secPerRep: d.secPerRep ?? 3,
    energy: { equation: 'met', metGross: d.metGross, metRange: [lo, hi], compendiumCode: null, metSource: d.basedOn ? `analog of ${d.basedOn}` : 'analog (resolved)' },
    cardioModality: d.cardioModality,
    hybridCardioShare: d.loadType === 'cardio' ? 1 : d.hybridCardioShare,
    mobilityTargets: d.mobilityTargets ?? [],
    skill: d.skill ?? 2,
    injuryRisk: d.injuryRisk ?? 2,
    contraTags: d.contraTags ?? [],
    tags: [],
    mechanism: d.mechanism,
    status: d.loadType === 'mobility' ? 'infoOnly' : 'mapped',
    certainty: 'D',
    ...(d.loadType === 'ballistic' ? { loadFactor: { min: 0.25, mode: cp('ballisticSetFactor'), max: 0.75 } } : {}),
    sources: [USER_SOURCE.key],
    origin,
  };
}

/** An unknown piece of equipment: catalogue match by name/alias, else an improvised item enabling the given patterns. */
export function resolveUnknownEquipment(name: string, catalogue: Catalogue, opts: { id: string; patterns?: MovementPattern[]; loadKg?: number }): EquipmentItem {
  const n = normName(name);
  const hit = catalogue.equipment.find((q) => normName(q.name) === n || q.aliases.some((a) => normName(a) === n) || normName(q.id.replace(/_/g, ' ')) === n);
  if (hit) return hit;
  return {
    id: opts.id,
    name,
    aliases: [],
    category: 'improvised',
    ownershipKind: 'owned',
    loadRangeKg: opts.loadKg !== undefined && opts.loadKg > 0 ? [opts.loadKg, opts.loadKg] : null,
    adjustable: false,
    enablesPatterns: opts.patterns ?? [],
    priceTier: 0,
    space: 'small',
    note: 'Added by the person.',
    sources: [USER_SOURCE.key],
    origin: 'user',
  };
}
