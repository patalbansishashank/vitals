/**
 * Dead-field test (PLANNER_V2_SPEC §6.3 check 4; R6 §7.2 item 4): every field of the limits form (`ConstraintDraft`),
 * the consents (`SafetyOptIns`), the request's limits (`PracticalConstraints`), the screening input
 * (`PlannerSafetyInput`) and the training profile (`TrainingProfile`) is classed in `LIMIT_CLASS`, and changing it
 * changes something downstream for at least one corpus request:
 *
 *   UI state → request          (the app's own mapping, injected: `toPracticalConstraints`, `toSafetyInput`, …)
 *   request → caps / context    (`compileRequest`: safety caps, resolved limits, fasting gate, equipment envelope)
 *   context → structure set and gene bounds (`enumerateStructures`, nominal gene ranges, decoded run-time ranges)
 *
 * Limits are metamorphic: relaxing a field enlarges the reachable set (a superset of structures and gene boxes, strictly
 * larger) and tightening it shrinks it, for at least one request. A field that changes the context but not the structure
 * set (hunger tolerance: the hunger cap and regulariser) is reported as acting in the model and validator. A field that
 * changes nothing is dead. Decode level only: no engine runs.
 */
import type { TrainingProfile } from '@/catalogues';
import { compileRequest, type PlanningContext } from '../domain/context';
import { decodePlan } from '../domain/decode';
import { equipmentEnvelope } from '../domain/equipment';
import { LIMIT_CLASS, type LimitFieldDef } from '../domain/limits';
import { enumerateStructures, type SkeletonStructure } from '../domain/skeleton';
import type { PlannerRequest, PlannerRequestV2, PlannerSafetyInput, PracticalConstraints } from '../domain/types';
import { CORPUS_PERSONAS } from './corpus';

// ---------------------------------------------------------------------------------------------------------------
// the app's mapping (injected: the engine does not import the UI layer)
// ---------------------------------------------------------------------------------------------------------------

/** Structural copy of the limits form's draft (`ConstraintDraft`, src/state/internal/plannerModel.ts). */
export type DraftLike = Record<string, unknown>;

export interface AppMapping {
  defaultConstraints(habits: PlannerRequest['profile']['habits']): DraftLike;
  toPracticalConstraints(d: DraftLike): PracticalConstraints;
  /** Screening outcome + consents → `PlannerSafetyInput` (`toSafetyInput`). */
  toSafetyInput(s: {
    outcome: { plannerAccess: 'full' | 'restricted' | 'blocked'; mode: 'M0' | 'R1' | 'R2' | 'H'; restrictions: string[]; plannerLocks: unknown[]; fasting: Record<string, unknown>; flags: string[] };
    plannerAccess: 'full' | 'restricted' | 'blocked';
    optedTier: 'T2' | 'T3' | 'T4' | null;
    shortWindowOn: boolean;
    expertModeAvailable?: boolean;
  }): PlannerSafetyInput;
  /** Screening flags → the profile's safety flags (`profileSafetyFrom`). */
  profileSafetyFrom(flags: readonly string[], mode: 'M0' | 'R1' | 'R2' | 'H', optedTier: 'T2' | 'T3' | 'T4' | null): NonNullable<PlannerRequest['profile']['safety']>;
  /**
   * The limits form's longest fast while the person has never set one (`defaultLongestFast`: it follows the opted-in
   * tier). Absent = the form's old fixed default of 24 h.
   */
  defaultLongestFast?(optedTier: 'T2' | 'T3' | 'T4' | null): number;
}

// ---------------------------------------------------------------------------------------------------------------
// reach signature
// ---------------------------------------------------------------------------------------------------------------

export interface ReachSig {
  /** Compiled context (caps, resolved limits, fasting gate, equipment envelope) as canonical JSON. */
  context: string;
  structures: ReadonlySet<string>;
  /** Nominal gene boxes of every structure: `${structure}|${gene}` → [min, max]. */
  nominal: ReadonlyMap<string, readonly [number, number]>;
  /** Run-time ranges decoded at the defaults, for the first structures (by prior). */
  runtime: ReadonlyMap<string, readonly [number, number]>;
  /** Decoded default schedules of the first structures. */
  schedules: ReadonlyMap<string, string>;
}

const RUNTIME_STRUCTURES = 20;

function contextJson(ctx: PlanningContext): string {
  const caps = { ...ctx.caps, flags: [...ctx.caps.flags].sort(), optInLevers: [...ctx.caps.optInLevers].sort(), reasons: [] };
  const practical = { ...ctx.practical, excluded: [...ctx.practical.excluded].sort() };
  return JSON.stringify({ caps, practical, fasting: [ctx.fastingRelevant, ctx.fastingReason, ctx.fastingServedGoal], equipment: equipmentEnvelope(ctx), problems: ctx.problems });
}

/**
 * Structure family: the id without its supplement / sleep flags. The grammar sets those flags per request (on or off for
 * every structure), so a lever the request newly allows shows as a new gene in the same family, not as other structures.
 */
const family = (id: string): string => id.replace(/\[[^\]]*\]$/, '');
const union = (m: Map<string, readonly [number, number]>, k: string, lo: number, hi: number) => {
  const r = m.get(k);
  m.set(k, r ? [Math.min(r[0], lo), Math.max(r[1], hi)] : [lo, hi]);
};

export function reachSig(req: PlannerRequest): ReachSig {
  const ctx = compileRequest(req);
  const sts = enumerateStructures(ctx);
  const nominal = new Map<string, readonly [number, number]>();
  const runtime = new Map<string, readonly [number, number]>();
  const schedules = new Map<string, string>();
  sts.forEach((st: SkeletonStructure, k) => {
    const f = family(st.id);
    for (const g of st.genes) union(nominal, `${f}|${g.path}`, g.min, g.max);
    if (k === 0 || k > RUNTIME_STRUCTURES) return;
    const plan = decodePlan(ctx, st, st.x0);
    st.genes.forEach((g, i) => union(runtime, `${f}|${g.path}`, plan.ranges[2 * i]!, plan.ranges[2 * i + 1]!));
    schedules.set(f, JSON.stringify(plan.schedule));
  });
  return { context: contextJson(ctx), structures: new Set(sts.map((s) => family(s.id))), nominal, runtime, schedules };
}

const EPS = 1e-9;
/** b ⊇ a: every structure of a is in b and every gene box of a lies inside b's (genes a has and b lacks: b is smaller). */
function contains(b: ReachSig, a: ReachSig): boolean {
  for (const s of a.structures) if (!b.structures.has(s)) return false;
  for (const [k, [lo, hi]] of a.nominal) {
    const r = b.nominal.get(k);
    if (!r) {
      if (hi - lo > EPS) return false;
      continue;
    }
    if (r[0] > lo + EPS || r[1] < hi - EPS) return false;
  }
  for (const [k, [lo, hi]] of a.runtime) {
    const r = b.runtime.get(k);
    if (!r) continue; // not decoded in b (outside its first structures): no evidence either way
    if (r[0] > lo + EPS || r[1] < hi - EPS) return false;
  }
  return true;
}

export type ReachChange = 'none' | 'contextOnly' | 'scheduleOnly' | 'bigger' | 'smaller' | 'different';

/** How `b` relates to `a`. */
export function compareReach(a: ReachSig, b: ReachSig): ReachChange {
  const ab = contains(b, a);
  const ba = contains(a, b);
  const sameSets = ab && ba;
  if (!sameSets) return ab ? 'bigger' : ba ? 'smaller' : 'different';
  for (const [id, s] of a.schedules) {
    const t = b.schedules.get(id);
    if (t !== undefined && t !== s) return 'scheduleOnly';
  }
  return a.context === b.context ? 'none' : 'contextOnly';
}

// ---------------------------------------------------------------------------------------------------------------
// perturbations
// ---------------------------------------------------------------------------------------------------------------

/** One base request of the field trace, with its UI state (limits draft, consents, screening). */
export interface FieldBase {
  id: string;
  request: PlannerRequestV2;
  draft: DraftLike;
  optedTier: 'T2' | 'T3' | 'T4' | null;
  shortWindowOn: boolean;
  screeningFlags: string[];
}

type Variant = (b: FieldBase, m: AppMapping) => PlannerRequestV2;
export interface Perturbation {
  /** The request the variants are compared with (default: the base request itself). */
  base?: Variant;
  relax?: Variant;
  tighten?: Variant;
  /** A value change that is neither (a clock time, a modality, a preference). */
  change?: Variant;
}

const withC = (b: FieldBase, c: Partial<PracticalConstraints>): PlannerRequestV2 => ({ ...b.request, constraints: { ...(b.request.constraints ?? {}), ...c } });
const withS = (b: FieldBase, s: Partial<PlannerSafetyInput>): PlannerRequestV2 => ({ ...b.request, safety: { ...(b.request.safety ?? {}), ...s } });
const withFasting = (b: FieldBase, f: NonNullable<PlannerSafetyInput['fasting']>): PlannerRequestV2 => withS(b, { fasting: { ...(b.request.safety?.fasting ?? {}), ...f } });
const withOptIns = (b: FieldBase, o: NonNullable<PlannerSafetyInput['optIns']>): PlannerRequestV2 => withS(b, { optIns: { ...(b.request.safety?.optIns ?? {}), ...o } });
const withDraft = (b: FieldBase, m: AppMapping, d: DraftLike): PlannerRequestV2 => ({ ...b.request, constraints: m.toPracticalConstraints({ ...b.draft, ...d }) });
const withTraining = (b: FieldBase, t: Partial<TrainingProfile>): PlannerRequestV2 => ({ ...b.request, training: { ...(b.request.training ?? BASE_TRAINING), ...t } });
/** The consents through the app's own path: screening outcome + opt-ins → `toSafetyInput`, flags → profile. */
function viaApp(b: FieldBase, m: AppMapping, o: { optedTier?: FieldBase['optedTier']; shortWindowOn?: boolean; flags?: string[] }): PlannerRequestV2 {
  const optedTier = o.optedTier === undefined ? b.optedTier : o.optedTier;
  const flags = o.flags ?? b.screeningFlags;
  const outcome = { plannerAccess: 'full' as const, mode: 'M0' as const, restrictions: [], plannerLocks: [], fasting: { maxFastHours: optedTier === 'T4' ? 168 : optedTier === 'T3' ? 72 : optedTier === 'T2' ? 48 : 24, maxEligibleTier: 'T3', effectiveTier: optedTier ?? 'T1', optInTiers: optedTier ? [optedTier] : [], shortWindowAvailable: true }, flags };
  const safety = m.toSafetyInput({ outcome, plannerAccess: 'full', optedTier, shortWindowOn: o.shortWindowOn ?? b.shortWindowOn });
  return { ...b.request, profile: { ...b.request.profile, safety: m.profileSafetyFrom(flags, 'M0', optedTier) }, safety };
}

export const BASE_TRAINING: TrainingProfile = {
  owned: ['dumbbell', 'bench', 'floor_mat', 'pullup_bar'],
  access: [],
  refused: [],
  liked: [],
  injuries: [],
  skill: 3,
  purchaseAllowance: { maxPriceTier: 0, maxItems: 0 },
};
const GYM_ACCESS: TrainingProfile['access'] = [
  { place: 'gym', equipment: ['barbell', 'plates', 'squat_rack', 'bench', 'dumbbell', 'cable_station', 'leg_machine', 'leg_press', 'pullup_bar', 'treadmill', 'rower'], weekdays: [0, 1, 2, 3, 4, 5, 6] },
];
const EXCLUDE_MANY = ['fastDay24', 'refeedDay', 'waterFast', 'zeroDay', 'L7', 'L8', 'L9', 'B2', 'B6', 'B11'];

/** Perturbation of every classed field, keyed `${from}.${field}`. */
export const PERTURBATIONS: Readonly<Record<string, Perturbation>> = {
  // ---- PracticalConstraints
  'PracticalConstraints.trainingDaysPerWeek': {
    relax: (b) => withC(b, { trainingDaysPerWeek: { min: 0, max: 6 } }),
    // fewer days at the same minimum (a lower maximum alone would also drop the person's own minimum)
    tighten: (b) => {
      const lo = b.request.constraints?.trainingDaysPerWeek?.min ?? 0;
      return withC(b, { trainingDaysPerWeek: { min: lo, max: lo } });
    },
  },
  'PracticalConstraints.allowedTrainingWeekdays': { tighten: (b) => withC(b, { allowedTrainingWeekdays: [0, 3] }) },
  'PracticalConstraints.trainingTimeH': { change: (b) => withC(b, { trainingTimeH: 7 }) },
  'PracticalConstraints.maxSessionMin': { relax: (b) => withC(b, { maxSessionMin: 150 }), tighten: (b) => withC(b, { maxSessionMin: 30 }) },
  'PracticalConstraints.cardioDaysPerWeek': { relax: (b) => withC(b, { cardioDaysPerWeek: { min: 0, max: 6 } }), tighten: (b) => withC(b, { cardioDaysPerWeek: { min: 0, max: 0 } }) },
  'PracticalConstraints.cardioModality': { change: (b) => withC(b, { cardioModality: 'run' }) },
  'PracticalConstraints.eatingWindow': { relax: (b) => withC(b, { eatingWindow: { earliestH: 5, latestH: 23 } }), tighten: (b) => withC(b, { eatingWindow: { earliestH: 11, latestH: 17 } }) },
  'PracticalConstraints.mealsPerDay': { relax: (b) => withC(b, { mealsPerDay: { min: 2, max: 5 } }), tighten: (b) => withC(b, { mealsPerDay: { min: 3, max: 3 } }) },
  'PracticalConstraints.steps': { relax: (b) => withC(b, { steps: { min: 3000, max: 15000 } }), tighten: (b) => withC(b, { steps: { min: 8000, max: 8000 } }) },
  'PracticalConstraints.excludedLevers': { tighten: (b) => withC(b, { excludedLevers: EXCLUDE_MANY }) },
  'PracticalConstraints.fasting': { tighten: (b) => withC(b, { fasting: 'none' }) },
  'PracticalConstraints.prefersFasting': { relax: (b) => withC(b, { prefersFasting: true }) },
  'PracticalConstraints.sleepFixed': { relax: (b) => withC(b, { sleepFixed: false }), tighten: (b) => withC(b, { sleepFixed: true }) },
  'PracticalConstraints.hungerTolerance': { change: (b) => withC(b, { hungerTolerance: 'low' }) },
  'PracticalConstraints.maxFastHours': { tighten: (b) => withC(b, { maxFastHours: 16 }) },
  'PracticalConstraints.proteinFloorGPerKg': { tighten: (b) => withC(b, { proteinFloorGPerKg: 2.0 }) },
  'PracticalConstraints.carbFloorGPerDay': { tighten: (b) => withC(b, { carbFloorGPerDay: 120 }) },
  // ---- ConstraintDraft (through the app's toPracticalConstraints)
  'ConstraintDraft.trainingDays': {
    relax: (b, m) => withDraft(b, m, { trainingDays: [0, 6] }),
    tighten: (b, m) => withDraft(b, m, { trainingDays: [(b.draft.trainingDays as [number, number])[0], (b.draft.trainingDays as [number, number])[0]] }),
  },
  'ConstraintDraft.trainingWeekdays': { tighten: (b, m) => withDraft(b, m, { trainingWeekdays: [0, 3] }) },
  'ConstraintDraft.trainingTimeH': { change: (b, m) => withDraft(b, m, { trainingTimeH: 7 }) },
  'ConstraintDraft.maxSessionMin': { relax: (b, m) => withDraft(b, m, { maxSessionMin: 150 }), tighten: (b, m) => withDraft(b, m, { maxSessionMin: 30 }) },
  'ConstraintDraft.cardioDays': { relax: (b, m) => withDraft(b, m, { cardioDays: [0, 6] }), tighten: (b, m) => withDraft(b, m, { cardioDays: [0, 0] }) },
  'ConstraintDraft.cardioModality': { change: (b, m) => withDraft(b, m, { cardioModality: 'run' }) },
  'ConstraintDraft.earliestH': { relax: (b, m) => withDraft(b, m, { earliestH: 5 }), tighten: (b, m) => withDraft(b, m, { earliestH: 12 }) },
  'ConstraintDraft.latestH': { relax: (b, m) => withDraft(b, m, { latestH: 23 }), tighten: (b, m) => withDraft(b, m, { latestH: 17 }) },
  'ConstraintDraft.mealsPerDay': { relax: (b, m) => withDraft(b, m, { mealsPerDay: [2, 5] }), tighten: (b, m) => withDraft(b, m, { mealsPerDay: [3, 3] }) },
  'ConstraintDraft.steps': { relax: (b, m) => withDraft(b, m, { steps: [3000, 15000] }), tighten: (b, m) => withDraft(b, m, { steps: [8000, 8000] }) },
  'ConstraintDraft.longestFastH': {
    base: (b, m) => withDraft(b, m, { longestFastH: 24 }),
    relax: (b, m) => withDraft(b, m, { longestFastH: 72 }),
    tighten: (b, m) => withDraft(b, m, { longestFastH: 16 }),
  },
  'ConstraintDraft.prefersFasting': { relax: (b, m) => withDraft(b, m, { prefersFasting: true }) },
  'ConstraintDraft.excluded': { tighten: (b, m) => withDraft(b, m, { excluded: EXCLUDE_MANY }) },
  'ConstraintDraft.proteinFloor': { tighten: (b, m) => withDraft(b, m, { proteinFloor: 2.0 }) },
  'ConstraintDraft.carbFloorG': { tighten: (b, m) => withDraft(b, m, { carbFloorG: 120 }) },
  'ConstraintDraft.sleepFixed': { relax: (b, m) => withDraft(b, m, { sleepFixed: false }), tighten: (b, m) => withDraft(b, m, { sleepFixed: true }) },
  'ConstraintDraft.hungerTolerance': { change: (b, m) => withDraft(b, m, { hungerTolerance: 'low' }) },
  // ---- PlannerSafetyInput (screening outcome and consents as the engine receives them)
  'PlannerSafetyInput.plannerAccess': { tighten: (b) => withS(b, { plannerAccess: 'blocked' }) },
  'PlannerSafetyInput.mode': { tighten: (b) => withS(b, { mode: 'R1' }) },
  'PlannerSafetyInput.restrictions': { tighten: (b) => withS(b, { restrictions: ['R2'] }) },
  'PlannerSafetyInput.plannerLocks': { tighten: (b) => withS(b, { plannerLocks: [{ id: 'deficit-cap', value: 10 }, { id: 'no-ketogenic' }, { id: 'no-creatine' }] }) },
  'PlannerSafetyInput.fasting': { tighten: (b) => withS(b, { fasting: { maxFastHours: 16, maxEligibleTier: 'T0', effectiveTier: 'T0', optInTiers: [], shortWindowAvailable: false } }) },
  'PlannerSafetyInput.fasting.maxFastHours': { tighten: (b) => withFasting(b, { maxFastHours: 16 }) },
  'PlannerSafetyInput.fasting.maxEligibleTier': { tighten: (b) => withFasting(b, { maxEligibleTier: 'T1' }) },
  'PlannerSafetyInput.fasting.effectiveTier': { tighten: (b) => withFasting(b, { effectiveTier: 'T1' }) },
  'PlannerSafetyInput.fasting.optInTiers': { relax: (b) => withFasting(b, { optInTiers: ['T2', 'T3'] }) },
  'PlannerSafetyInput.fasting.shortWindowAvailable': {
    base: (b) => withOptIns(b, { shortEatingWindow: true }),
    tighten: (b) => {
      const r = withOptIns(b, { shortEatingWindow: true });
      return { ...r, safety: { ...r.safety, fasting: { ...(r.safety?.fasting ?? {}), shortWindowAvailable: false } } };
    },
  },
  'PlannerSafetyInput.flags': { tighten: (b) => withS(b, { flags: ['kidney-disease', 'anticoagulant'] }) },
  'PlannerSafetyInput.optIns': { relax: (b) => withS(b, { optIns: { fastingTier: 'T3', shortEatingWindow: true, levers: ['L8', 'omega3'] } }) },
  // in the app the screening's effective longest fast moves with the opt-in; here the consent alone, without that outcome
  'PlannerSafetyInput.optIns.fastingTier': {
    base: (b) => ({ ...withOptIns(b, { fastingTier: null }), safety: { ...withOptIns(b, { fastingTier: null }).safety, fasting: {} } }),
    relax: (b) => ({ ...withOptIns(b, { fastingTier: 'T3' }), safety: { ...withOptIns(b, { fastingTier: 'T3' }).safety, fasting: {} } }),
  },
  'PlannerSafetyInput.optIns.shortEatingWindow': { relax: (b) => withOptIns(b, { shortEatingWindow: true }) },
  'PlannerSafetyInput.optIns.levers': { relax: (b) => withOptIns(b, { levers: ['L8', 'omega3'] }) },
  // the person's own longest fast at 168 h so it does not hide the tier (the limits form offers at most 72 h: see
  // `defaultFastMasking`)
  'PlannerSafetyInput.expertMode': {
    base: (b) => withC({ ...b, request: withOptIns(b, { fastingTier: 'T4' }) }, { maxFastHours: 168 }),
    relax: (b) => withC({ ...b, request: withS(b, { expertMode: true, optIns: { ...(b.request.safety?.optIns ?? {}), fastingTier: 'T4' } }) }, { maxFastHours: 168 }),
  },
  // ---- SafetyOptIns (the consents through the app: screening outcome + opt-ins → toSafetyInput, flags → profile)
  'SafetyOptIns.fastingTier': { relax: (b, m) => viaApp(b, m, { optedTier: 'T3' }) },
  'SafetyOptIns.shortEatingWindow': { relax: (b, m) => viaApp(b, m, { shortWindowOn: true }) },
  'SafetyOptIns.recentIllness': { tighten: (b, m) => viaApp(b, m, { flags: [...b.screeningFlags, 'recent-illness'] }) },
  // ---- TrainingProfile (equipment, preferences, capacities, injuries)
  'TrainingProfile.owned': { relax: (b) => withTraining(b, { owned: [...BASE_TRAINING.owned, 'barbell', 'plates', 'squat_rack', 'kettlebell'] }), tighten: (b) => withTraining(b, { owned: [] }) },
  'TrainingProfile.access': { relax: (b) => withTraining(b, { access: GYM_ACCESS }) },
  'TrainingProfile.loadsKg': { tighten: (b) => withTraining(b, { loadsKg: { dumbbell: [2, 4] } }) },
  'TrainingProfile.purchaseAllowance': { relax: (b) => withTraining(b, { purchaseAllowance: { maxPriceTier: 4, maxItems: 5 } }) },
  'TrainingProfile.liked': { change: (b) => withTraining(b, { liked: ['squat', 'hinge'] }) },
  'TrainingProfile.enjoy': { change: (b) => withTraining(b, { enjoy: { squat: -2, push_horizontal: 2 } }) },
  'TrainingProfile.refused': { tighten: (b) => withTraining(b, { refused: ['dumbbell', 'jumping', 'floor'] }) },
  'TrainingProfile.capacities': { change: (b) => withTraining(b, { capacities: { db_bench_press: { repsMax: 4 }, pushup: { repsMax: 2 } } }) },
  'TrainingProfile.injuries': { tighten: (b) => withTraining(b, { injuries: ['shoulder', 'knee', 'lumbar'] }) },
  'TrainingProfile.cleared': {
    base: (b) => withTraining(b, { injuries: ['shoulder', 'knee', 'lumbar'] }),
    relax: (b) => withTraining(b, { injuries: ['shoulder', 'knee', 'lumbar'], cleared: ['shoulder', 'knee', 'lumbar'] }),
  },
  'TrainingProfile.skill': { tighten: (b) => withTraining(b, { skill: 1 }) },
};

// ---------------------------------------------------------------------------------------------------------------
// bases and trace
// ---------------------------------------------------------------------------------------------------------------

const BASE_SPECS: ReadonlyArray<{ id: string; persona: string; goals: PlannerRequest['goals']; optedTier: FieldBase['optedTier'] }> = [
  { id: 'man88 · autophagy, triglycerides · T3', persona: 'man88', goals: [{ metric: 'autophagyIdx', direction: 'maximise' }, { metric: 'triglycerides', direction: 'minimise' }], optedTier: 'T3' },
  { id: 'woman78 · fat loss, LDL · T2', persona: 'woman78', goals: [{ metric: 'fatMass', direction: 'target', target: -6, targetKind: 'change' }, { metric: 'ldl', direction: 'minimise' }], optedTier: 'T2' },
  { id: 'leanTrained · lean tissue, strength', persona: 'leanTrained', goals: [{ metric: 'leanTissue', direction: 'maximise' }, { metric: 'strength', direction: 'maximise' }], optedTier: null },
  { id: 'obeseMan · autophagy, fat mass · T4', persona: 'obeseMan', goals: [{ metric: 'autophagyIdx', direction: 'maximise' }, { metric: 'fatMass', direction: 'minimise' }], optedTier: 'T4' },
];

/**
 * Base requests of the trace, built through the app's mapping (limits draft → constraints, consents → safety input). The
 * drafts accept fasts up to 72 h (`longestFastH`), so the person's own limit does not hide what the fasting consents do;
 * `defaultFastMasking` reports what the form's default (24 h) hides.
 */
export function fieldBases(m: AppMapping, draftOverrides: DraftLike = { longestFastH: 72 }): FieldBase[] {
  return BASE_SPECS.map((s) => {
    const profile = CORPUS_PERSONAS[s.persona]!;
    const draft = { ...m.defaultConstraints(profile.habits), ...draftOverrides };
    const b: FieldBase = { id: s.id, draft, optedTier: s.optedTier, shortWindowOn: false, screeningFlags: [], request: { profile, goals: s.goals, horizonDays: 112 } };
    const app = viaApp(b, m, {});
    b.request = { ...app, constraints: m.toPracticalConstraints(draft), training: BASE_TRAINING };
    return b;
  });
}

export type FieldVerdict = 'live' | 'changes' | 'contextOnly' | 'dead' | 'noPerturbation';

export interface FieldTrace {
  key: string;
  def: LimitFieldDef;
  /** The UI → request mapping changed the request (always true for fields of the request itself). */
  requestChanged: boolean;
  outcomes: Array<{ base: string; dir: 'relax' | 'tighten' | 'change'; change: ReachChange }>;
  /** Relaxing shrank or tightening enlarged the reachable set on some base (reported). */
  nonMonotone: string[];
  verdict: FieldVerdict;
}

const RANK: Readonly<Record<ReachChange, number>> = { none: 0, contextOnly: 1, scheduleOnly: 2, different: 3, bigger: 3, smaller: 3 };

/** Trace every field of the five audited sources (PlannerRequest fields are classed, not traced). */
export function traceFields(m: AppMapping, defs: readonly LimitFieldDef[] = LIMIT_CLASS): FieldTrace[] {
  return traceFieldsWith(m, fieldBases(m), defs);
}

export function traceFieldsWith(
  m: AppMapping,
  bases: readonly FieldBase[],
  defs: readonly LimitFieldDef[] = LIMIT_CLASS,
  perturbations: Readonly<Record<string, Perturbation>> = PERTURBATIONS,
): FieldTrace[] {
  const sigCache = new Map<string, ReachSig>();
  const sigOf = (req: PlannerRequest) => {
    const k = JSON.stringify(req);
    let sg = sigCache.get(k);
    if (!sg) {
      sg = reachSig(req);
      sigCache.set(k, sg);
    }
    return sg;
  };
  const out: FieldTrace[] = [];
  for (const def of defs) {
    if (def.from === 'PlannerRequest') continue;
    const key = `${def.from}.${def.field}`;
    const p = perturbations[key];
    if (!p) {
      out.push({ key, def, requestChanged: false, outcomes: [], nonMonotone: [], verdict: 'noPerturbation' });
      continue;
    }
    const outcomes: FieldTrace['outcomes'] = [];
    const nonMonotone: string[] = [];
    let requestChanged = false;
    const success: Partial<Record<'relax' | 'tighten' | 'change', boolean>> = {};
    let best = 0;
    for (const dir of ['relax', 'tighten', 'change'] as const) {
      const v = p[dir];
      if (!v) continue;
      success[dir] = false;
      for (const b of bases) {
        const baseReq = p.base ? p.base(b, m) : b.request;
        const req = v(b, m);
        if (JSON.stringify(req) !== JSON.stringify(baseReq)) requestChanged = true;
        else continue;
        const change = compareReach(sigOf(baseReq), sigOf(req));
        outcomes.push({ base: b.id, dir, change });
        best = Math.max(best, RANK[change]);
        if ((dir === 'relax' && change === 'smaller') || (dir === 'tighten' && change === 'bigger')) nonMonotone.push(`${dir} on ${b.id}: ${change}`);
        const ok = dir === 'relax' ? change === 'bigger' : dir === 'tighten' ? change === 'smaller' : RANK[change] >= 2;
        if (ok) {
          success[dir] = true;
          break;
        }
      }
    }
    const dirs = Object.keys(success) as Array<keyof typeof success>;
    const verdict: FieldVerdict = dirs.length && dirs.every((d) => success[d]) ? 'live' : best >= 2 ? 'changes' : best === 1 ? 'contextOnly' : 'dead';
    out.push({ key, def, requestChanged, outcomes, nonMonotone, verdict });
  }
  return out;
}

/**
 * What the limits form hides: the fasting consents under the form's default longest fast (`AppMapping.defaultLongestFast`,
 * which follows the opted-in tier; 24 h when the mapping has none), and the expert tier under the form's largest option
 * (72 h). Each request of the comparison gets the form's default for its own opted tier, so an opt-in that raises the
 * default is compared at the raised limit. `masked` = the consent enlarges the reachable set when the person's own limit
 * is open but not with the form's value (the person's limit then decides: no plan can use the consent). `formLimitH` is
 * the limit after the opt-in.
 */
export function defaultFastMasking(m: AppMapping): Array<{ key: string; formLimitH: number; masked: boolean }> {
  const formDefault = (req: PlannerRequestV2): number => (m.defaultLongestFast ? m.defaultLongestFast(req.safety?.optIns?.fastingTier ?? null) : 24);
  const cases: ReadonlyArray<readonly [string, ((req: PlannerRequestV2) => number) | number]> = [
    ['SafetyOptIns.fastingTier', formDefault],
    ['PlannerSafetyInput.optIns.fastingTier', formDefault],
    ['PlannerSafetyInput.expertMode', 72],
  ];
  return cases.map(([key, limit]) => {
    const limitOf = (req: PlannerRequestV2) => (typeof limit === 'number' ? limit : limit(req));
    const def = LIMIT_CLASS.filter((d) => `${d.from}.${d.field}` === key);
    const open = traceFields(m, def)[0]?.verdict === 'live';
    // the same perturbation with the person's own longest fast at the form's value
    const p = PERTURBATIONS[key]!;
    const at = (req: PlannerRequestV2, b: FieldBase) => withC({ ...b, request: req }, { maxFastHours: limitOf(req) });
    const shut: Perturbation = {
      base: (b, mm) => at(p.base ? p.base(b, mm) : b.request, b),
      relax: (b, mm) => at(p.relax!(b, mm), b),
    };
    const closed = traceFieldsWith(m, fieldBases(m), def, { [key]: shut })[0]?.verdict === 'live';
    const bases = fieldBases(m);
    const formLimitH = Math.max(...bases.map((b) => limitOf(p.relax!(b, m))));
    return { key, formLimitH, masked: open && !closed };
  });
}
