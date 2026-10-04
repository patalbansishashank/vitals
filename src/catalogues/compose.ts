/**
 * Equipment-aware prescription (PLAN item 11; R3 §6; PLANNER_V2 §8.2-8.5). Deterministic and pure.
 *
 * - `composeSession(s)`: the engine's training dose (effective sets per region, or cardio minutes at %VO2max) becomes
 *   concrete exercises the person can do that day, chosen by utility U = 3·avail + 1·enjoy + 2·cover − 0.5·min/10 −
 *   0.5·(risk − 1) − 0.3·skillGap (availability scored highest), filled greedily to the targets, then one 1-swap pass.
 * - `trainingEnvelope`: what the available, willing, injury-safe catalogue can deliver per session (the planner's
 *   practical limit for training genes).
 * - `shoppingList`: per plan, the equipment (or minimal bundle) whose purchase raises the plan's delivered utility the
 *   most per price tier, required items first.
 * - `swapOptions`: alternatives that keep the dose equivalent, ranked by equivalence credit then utility.
 */
import { cp, INTENT_DEFAULTS } from './params';
import {
  aggregateStimulus,
  fLoadStrength,
  implementOf,
  loadClassOf,
  memWeight,
  repsToFailureAt,
  loadPctFromRepsToFailure,
  resolveDose,
  toEngineDose,
  type EngineTrainingDose,
  type ExerciseDose,
  type StimulusContext,
} from './stimulus';
import { defaultIntent, stimulusEquivalence } from './equivalence';
import { ENGINE } from './params';
import { energyText } from './text';
import { PATTERN_LABEL, REGIONS } from './vocab';
import type {
  CardioModality,
  Catalogue,
  EquipmentItem,
  EquivalenceResult,
  ExerciseRecord,
  ImplementClass,
  MovementPattern,
  PerformedExercise,
  ShortfallNote,
  StimulusIntent,
  StimulusVector,
  TrainingProfile,
  TrainingRegion,
  Weekday,
} from './types';

// ================================================================== prescriptions and options

export interface ResistancePrescription {
  kind: 'resistance';
  weekday: Weekday;
  /** Clock hour the session starts. */
  startH: number;
  /** Time cap including warm-up, min. */
  maxMin: number;
  /** Effective sets per region for this session. */
  setsByRegion: Partial<Record<TrainingRegion, number>>;
  /** Target load, %1RM (default: engine default 70). */
  loadPct1RM?: number;
  /** Target reps in reserve (default 2). */
  rir?: number;
  intent?: StimulusIntent;
  date?: string;
}

export interface CardioPrescription {
  kind: 'cardio';
  weekday: Weekday;
  startH: number;
  modality: CardioModality;
  minutes: number;
  /** Target intensity, fraction of VO2max. */
  pctVo2max: number;
  /** Time cap, min (default 1.5 × minutes). */
  maxMin?: number;
  intent?: StimulusIntent;
  date?: string;
}

export type SessionPrescription = ResistancePrescription | CardioPrescription;

export interface ComposeOptions {
  profile: TrainingProfile;
  catalogue: Catalogue;
  ctx: StimulusContext;
  /** The plan's purchase list: counted as available at 0.5 (PLANNER_V2 §8.3). */
  purchases?: readonly string[];
  /** Previously composed sessions (≈ 14 days): used to rotate exercises among equal choices. */
  history?: readonly ConcreteSession[];
  /** False when impact is not allowed (safety HC-X4/X5). Default true. */
  allowImpact?: boolean;
  /** Ideal plan: every catalogue item counts as available. */
  fullCatalogue?: boolean;
}

export interface ConcreteItem {
  exerciseId: string;
  name: string;
  /** Equipment the item is done with. */
  equipment: string[];
  sets?: number;
  reps?: number;
  holdSec?: number;
  workSec?: number;
  minutes: number;
  loadPct?: number;
  loadKg?: number;
  /** Gross MET the item is prescribed at (cardio). */
  met?: number;
  pctVo2max?: number;
  rir?: number;
  restSec?: number;
  /** Net kcal. */
  kcal: number;
  /** What to log when done as planned. */
  perf: PerformedExercise;
  /** One-line prescription, e.g. "Mudgar swing, single heavy club two-handed: 6 × 20 (60 s rest, about 100 kcal)". */
  text: string;
}

export interface ConcreteSession {
  prescription: SessionPrescription;
  items: ConcreteItem[];
  /** Minutes including warm-up (resistance). */
  minutes: number;
  delivered: StimulusVector;
  /** Target as a stimulus vector (what `delivered` is scored against). */
  target: StimulusVector;
  equivalence: EquivalenceResult;
  /** Within the composer tolerance: no region short by more than 0.5 effective set; cardio at full credit. */
  withinTolerance: boolean;
  shortfall: ShortfallNote[];
  /** Regions delivered beyond the target by more than the tolerance (spill from compound work). */
  spill: Partial<Record<TrainingRegion, number>>;
  /** Engine sessions to write into the schedule (delivered setsByRegion, MET). */
  engine: EngineTrainingDose;
  /** Equipment from the purchase list the session relies on. */
  purchasesUsed: string[];
}

// ================================================================== availability and willingness

interface Availability {
  avail: number;
  equipment: string[];
}

function equipmentAvail(id: string, weekday: Weekday, startH: number, o: ComposeOptions, owned: ReadonlySet<string>, purchases: ReadonlySet<string>): number {
  if (o.fullCatalogue) return 1;
  if (owned.has(id)) return cp('availOwned');
  let best = 0;
  for (const a of o.profile.access) {
    if (!a.equipment.includes(id) || !a.weekdays.includes(weekday)) continue;
    const inWindow = !a.hours || (startH >= a.hours[0] && startH < a.hours[1]);
    best = Math.max(best, inWindow ? cp('availAccess') : cp('availAccessOutsideWindow'));
  }
  if (best === 0 && purchases.has(id)) best = cp('availPurchase');
  return best;
}

function exerciseAvailability(ex: ExerciseRecord, weekday: Weekday, startH: number, o: ComposeOptions, owned: ReadonlySet<string>, purchases: ReadonlySet<string>, refused: ReadonlySet<string>): Availability {
  let best: Availability = { avail: 0, equipment: [] };
  for (const alt of ex.equipmentAnyOf) {
    if (alt.some((q) => refused.has(q))) continue;
    let a = 1;
    for (const q of alt) a = Math.min(a, equipmentAvail(q, weekday, startH, o, owned, purchases));
    if (a > best.avail || (a === best.avail && a > 0 && alt.length < best.equipment.length)) best = { avail: a, equipment: [...alt] };
  }
  return best;
}

function enjoyOf(ex: ExerciseRecord, p: TrainingProfile): number {
  const e = p.enjoy?.[ex.id] ?? p.enjoy?.[ex.pattern] ?? p.enjoy?.[ex.tradition];
  if (e !== undefined) return Math.max(-2, Math.min(2, e));
  return p.liked.includes(ex.id) || p.liked.includes(ex.pattern) || p.liked.includes(ex.tradition) ? 1 : 0;
}

/** Hard filters (R3 §6, PLANNER_V2 §8.3 step 1) except equipment: refusal, contraindication, skill, impact. */
export function isWilling(ex: ExerciseRecord, o: Pick<ComposeOptions, 'profile' | 'allowImpact'>): boolean {
  const p = o.profile;
  const refused = new Set(p.refused);
  if (refused.has(ex.id) || refused.has(ex.pattern) || refused.has(ex.tradition) || ex.tags.some((t) => refused.has(t))) return false;
  if (enjoyOf(ex, p) <= -2) return false;
  const cleared = new Set(p.cleared ?? []);
  if (ex.contraTags.some((t) => p.injuries.includes(t) && !cleared.has(t))) return false;
  if (ex.skill > p.skill + 1) return false;
  if (o.allowImpact === false && ex.tags.includes('highImpact')) return false;
  return true;
}

// ================================================================== per-candidate dose planning

interface Planned {
  ex: ExerciseRecord;
  /** One-set (or one-round) log at the planned intensity; the composer sets `setCount`. */
  perf: PerformedExercise;
  perSet: Partial<Record<TrainingRegion, number>>;
  perSetMin: number;
  loadPct: number;
  enjoy: number;
  skillGap: number;
}

const LOAD_IMPLEMENTS: ReadonlySet<ImplementClass> = new Set<ImplementClass>(['bar', 'handheld', 'machine', 'odd']);

/** The load can be chosen freely (%1RM-scaled item done with a weight, machine or loadable odd object). */
function loadable(ex: ExerciseRecord, equipment: readonly string[]): boolean {
  if (!(ex.intensityScale === 'pct1RM' || (ex.loadType === 'external' && ex.intensityScale === 'kgRpe'))) return false;
  return LOAD_IMPLEMENTS.has(implementOf(ex, equipment));
}

function planResistance(ex: ExerciseRecord, rx: ResistancePrescription, o: ComposeOptions, loaded: boolean): Planned | null {
  const sum = Object.values(ex.regions).reduce<number>((a, b) => a + (b ?? 0), 0);
  if (!(sum > 0) || ex.loadType === 'cardio' || ex.loadType === 'mobility') return null;
  const dd = ex.defaultDose;
  if (!((dd.sets ?? 0) > 0 || (dd.rounds ?? 0) > 0)) return null; // minute-only flows are not set-composable
  const targetL = rx.loadPct1RM ?? 70;
  const rir = rx.rir ?? dd.rir ?? cp('defaultRir');
  const cap = o.profile.capacities?.[ex.id];
  let perf: PerformedExercise;
  if (loaded) {
    const reps = Math.max(1, Math.min(30, Math.round(repsToFailureAt(targetL) - rir)));
    perf = { exerciseId: ex.id, setCount: 1, reps, pct1RM: targetL, rir };
    if (cap?.oneRepMaxKg) perf = { ...perf, loadKg: Math.round(((targetL / 100) * cap.oneRepMaxKg) * 2) / 2, oneRepMaxKg: cap.oneRepMaxKg };
  } else if (dd.reps !== undefined && (ex.loadType === 'bodyweight' || ex.loadType === 'odd-object' || ex.loadType === 'external')) {
    const reps = cap?.repsMax !== undefined ? Math.max(1, cap.repsMax - rir) : dd.reps;
    perf = { exerciseId: ex.id, setCount: 1, reps, rir };
  } else {
    perf = { exerciseId: ex.id, setCount: 1 };
  }
  const one = resolveDose(ex, perf, o.ctx);
  return { ex, perf, perSet: one.effectiveSetsByRegion, perSetMin: one.minutes, loadPct: one.meanLoadPct, enjoy: enjoyOf(ex, o.profile), skillGap: Math.max(0, ex.skill - o.profile.skill) };
}

const totalOf = (o: Partial<Record<TrainingRegion, number>>): number => Object.values(o).reduce<number>((a, b) => a + Math.max(0, b ?? 0), 0);

function utilityBase(avail: number, p: Planned): number {
  return cp('uAvail') * avail + cp('uEnjoy') * p.enjoy - cp('uInjury') * (p.ex.injuryRisk - 1) - cp('uSkillGap') * p.skillGap;
}

function lastUsedRank(id: string, history: readonly ConcreteSession[]): number {
  for (let i = history.length - 1; i >= 0; i--) if (history[i]!.items.some((it) => it.exerciseId === id)) return history.length - i;
  return Number.POSITIVE_INFINITY;
}

// ================================================================== resistance composition

interface Chosen {
  p: Planned;
  avail: number;
  equipment: string[];
  n: number;
}

function deliveredBy(picks: readonly Chosen[]): Partial<Record<TrainingRegion, number>> {
  const out: Partial<Record<TrainingRegion, number>> = {};
  for (const k of picks) for (const [r, v] of Object.entries(k.p.perSet) as Array<[TrainingRegion, number]>) out[r] = (out[r] ?? 0) + v * k.n;
  return out;
}

function chooseSets(p: Planned, deficit: Partial<Record<TrainingRegion, number>>, minutesLeft: number): number {
  const tol = cp('sessionSetTolerance');
  let need = 0;
  for (const [r, w] of Object.entries(p.ex.regions) as Array<[TrainingRegion, number]>) {
    const d = deficit[r] ?? 0;
    const c = p.perSet[r] ?? 0;
    if (d > tol && c > 0 && w >= 1) need = Math.max(need, d / c);
  }
  if (need === 0) {
    for (const r of REGIONS) {
      const d = deficit[r] ?? 0;
      const c = p.perSet[r] ?? 0;
      if (d > tol && c > 0) need = Math.max(need, d / c);
    }
  }
  let n = Math.max(1, Math.min(cp('maxSetsPerExercise'), Math.round(need)));
  while (n > 0 && n * p.perSetMin > minutesLeft + 1e-9) n--;
  return n;
}

function gainOf(p: Planned, n: number, deficit: Partial<Record<TrainingRegion, number>>): number {
  let g = 0;
  for (const [r, c] of Object.entries(p.perSet) as Array<[TrainingRegion, number]>) g += Math.min(c * n, Math.max(0, deficit[r] ?? 0));
  return g;
}

function strengthFactor(p: Planned, rx: ResistancePrescription): number {
  const L = rx.loadPct1RM ?? 70;
  return L >= ENGINE.loadHeavyPct ? Math.min(1, fLoadStrength(p.loadPct) / fLoadStrength(L)) : 1;
}

/** Σ_r max(0, target − delivered − tolerance): what the session misses beyond the composer tolerance. */
function shortfallBeyondTolerance(picks: readonly Chosen[], target: Partial<Record<TrainingRegion, number>>): number {
  const del = deliveredBy(picks);
  const tol = cp('sessionSetTolerance');
  let s = 0;
  for (const [r, t] of Object.entries(target) as Array<[TrainingRegion, number]>) s += Math.max(0, t - (del[r] ?? 0) - tol);
  return s;
}

function sessionObjective(picks: readonly Chosen[], target: Partial<Record<TrainingRegion, number>>, rx: ResistancePrescription): number {
  const del = deliveredBy(picks);
  let num = 0;
  let den = 0;
  for (const [r, t] of Object.entries(target) as Array<[TrainingRegion, number]>) {
    if (!(t > 0)) continue;
    num += Math.min(del[r] ?? 0, t);
    den += t;
  }
  const cover = den > 0 ? num / den : 1;
  const minutes = cp('warmupMin') + picks.reduce((a, k) => a + k.n * k.p.perSetMin, 0);
  const per = picks.length > 0 ? picks.reduce((a, k) => a + utilityBase(k.avail, k.p) * strengthFactor(k.p, rx), 0) / picks.length : 0;
  return cp('uCover') * cover + per - (cp('uMinutesPer10') * minutes) / 10;
}

function composeResistance(rx: ResistancePrescription, o: ComposeOptions, planned: readonly PlannedVariants[], owned: ReadonlySet<string>, purchases: ReadonlySet<string>): Chosen[] {
  const refused = new Set(o.profile.refused);
  const history = o.history ?? [];
  const cands: Array<{ p: Planned; avail: number; equipment: string[]; rank: number }> = [];
  for (const v of planned) {
    const a = exerciseAvailability(v.ex, rx.weekday, rx.startH, o, owned, purchases, refused);
    if (a.avail <= 0) continue;
    const p = loadable(v.ex, a.equipment) ? v.loaded : v.unloaded;
    if (p) cands.push({ p, avail: a.avail, equipment: a.equipment, rank: lastUsedRank(v.ex.id, history) });
  }
  const target = rx.setsByRegion;
  const tol = cp('sessionSetTolerance');
  const deficit: Partial<Record<TrainingRegion, number>> = { ...target };
  const picks: Chosen[] = [];
  const patternCount = new Map<MovementPattern, number>();
  let minutes = cp('warmupMin');
  for (let guard = 0; guard < 40; guard++) {
    const open = REGIONS.filter((r) => (deficit[r] ?? 0) > tol);
    if (open.length === 0) break;
    const remaining = totalOf(deficit);
    let best: { c: (typeof cands)[number]; n: number; u: number } | null = null;
    for (const c of cands) {
      if (picks.some((k) => k.p.ex.id === c.p.ex.id)) continue;
      if ((patternCount.get(c.p.ex.pattern) ?? 0) >= cp('maxExercisesPerPattern')) continue;
      const n = chooseSets(c.p, deficit, rx.maxMin - minutes);
      if (n < 1) continue;
      const gain = gainOf(c.p, n, deficit);
      if (gain < 0.25) continue;
      const cover = (gain / Math.max(1e-9, remaining)) * strengthFactor(c.p, rx);
      const u = utilityBase(c.avail, c.p) + cp('uCover') * cover - (cp('uMinutesPer10') * n * c.p.perSetMin) / 10;
      const better =
        !best ||
        u > best.u + 1e-9 ||
        (Math.abs(u - best.u) <= 1e-9 && (c.rank > best.c.rank || (c.rank === best.c.rank && c.p.ex.id < best.c.p.ex.id)));
      if (better) best = { c, n, u };
    }
    if (!best) break;
    picks.push({ p: best.c.p, avail: best.c.avail, equipment: best.c.equipment, n: best.n });
    patternCount.set(best.c.p.ex.pattern, (patternCount.get(best.c.p.ex.pattern) ?? 0) + 1);
    minutes += best.n * best.c.p.perSetMin;
    for (const [r, v] of Object.entries(best.c.p.perSet) as Array<[TrainingRegion, number]>) deficit[r] = (deficit[r] ?? 0) - v * best.n;
  }

  // one pass of 1-swap improvement (PLANNER_V2 §8.3 step 4): never at the cost of a larger shortfall beyond the
  // tolerance, then by the session objective; ties broken by id
  for (let i = 0; i < picks.length; i++) {
    let bestShort = shortfallBeyondTolerance(picks, target);
    let bestJ = sessionObjective(picks, target, rx);
    let bestSwap: Chosen | null = null;
    const others = picks.filter((_, k) => k !== i);
    const def: Partial<Record<TrainingRegion, number>> = { ...target };
    for (const [r, v] of Object.entries(deliveredBy(others)) as Array<[TrainingRegion, number]>) def[r] = (def[r] ?? 0) - v;
    const usedMin = cp('warmupMin') + others.reduce((a, k) => a + k.n * k.p.perSetMin, 0);
    for (const c of cands) {
      if (picks.some((k) => k.p.ex.id === c.p.ex.id)) continue;
      const sameAsReplaced = c.p.ex.pattern === picks[i]!.p.ex.pattern;
      if (!sameAsReplaced && others.filter((k) => k.p.ex.pattern === c.p.ex.pattern).length >= cp('maxExercisesPerPattern')) continue;
      const n = chooseSets(c.p, def, rx.maxMin - usedMin);
      if (n < 1 || gainOf(c.p, n, def) < 0.25) continue;
      const trial = [...others.slice(0, i), { p: c.p, avail: c.avail, equipment: c.equipment, n }, ...others.slice(i)];
      const sh = shortfallBeyondTolerance(trial, target);
      if (sh > bestShort + 1e-9) continue;
      const j = sessionObjective(trial, target, rx);
      const better = sh < bestShort - 1e-9 || j > bestJ + 1e-9 || (bestSwap !== null && Math.abs(j - bestJ) <= 1e-9 && c.p.ex.id < bestSwap.p.ex.id);
      if (better) {
        bestShort = sh;
        bestJ = j;
        bestSwap = trial[i]!;
      }
    }
    if (bestSwap) picks[i] = bestSwap;
  }
  return picks;
}

// ================================================================== cardio composition

function cardioTarget(rx: CardioPrescription, ctx: StimulusContext): StimulusVector {
  const met = (rx.pctVo2max * ctx.vo2max) / ENGINE.metVo2;
  const perMet = (ENGINE.metVo2 * ctx.bodyMassKg * ENGINE.kcalPerLO2) / 1000;
  return {
    effectiveSetsByRegion: {},
    pattern: 'locomotion',
    loadClass: 'veryLight',
    netKcal: Math.max(0, met - 1) * perMet * rx.minutes,
    mem: memWeight(rx.pctVo2max) * rx.minutes,
    hiMinutes: rx.pctVo2max >= ENGINE.hardX ? rx.minutes : 0,
    mobilityMinutes: {},
  };
}

function composeCardio(rx: CardioPrescription, o: ComposeOptions, owned: ReadonlySet<string>, purchases: ReadonlySet<string>): { pick: { ex: ExerciseRecord; equipment: string[]; perf: PerformedExercise; avail: number } | null; target: StimulusVector } {
  const target = cardioTarget(rx, o.ctx);
  const alpha = rx.intent ?? { ...INTENT_DEFAULTS.vo2max };
  const refused = new Set(o.profile.refused);
  const history = o.history ?? [];
  const metT = (rx.pctVo2max * o.ctx.vo2max) / ENGINE.metVo2;
  const maxMin = rx.maxMin ?? Math.ceil(rx.minutes * 1.5);
  let best: { ex: ExerciseRecord; equipment: string[]; perf: PerformedExercise; avail: number; u: number; rank: number } | null = null;
  const usable = o.catalogue.exercises.filter(
    (ex) => ex.hybridCardioShare > 0 && isWilling(ex, o) && exerciseAvailability(ex, rx.weekday, rx.startH, o, owned, purchases, refused).avail > 0,
  );
  // the prescribed modality when any available item delivers it, else any cardio-capable item
  const same = rx.modality === 'other' ? usable : usable.filter((ex) => ex.cardioModality === rx.modality);
  for (const ex of same.length > 0 ? same : usable) {
    const a = exerciseAvailability(ex, rx.weekday, rx.startH, o, owned, purchases, refused);
    const met = Math.min(ex.energy.metRange[1], Math.max(ex.energy.metRange[0], metT));
    const x = (met * ENGINE.metVo2) / o.ctx.vo2max;
    const memPerMin = memWeight(x) * ex.hybridCardioShare;
    const netPerMin = (Math.max(0, met - 1) * ENGINE.metVo2 * o.ctx.bodyMassKg * ENGINE.kcalPerLO2) / 1000;
    const mMem = memPerMin > 0 ? target.mem / memPerMin : Number.POSITIVE_INFINITY;
    const mKcal = netPerMin > 0 ? target.netKcal / netPerMin : Number.POSITIVE_INFINITY;
    const need = alpha.card > 0 ? Math.max(mMem, alpha.kcal > 0 ? mKcal : 0) : mKcal;
    const minutes = Math.max(1, Math.min(maxMin, Math.ceil(Number.isFinite(need) ? need : maxMin)));
    const perf: PerformedExercise = { exerciseId: ex.id, minutes, met };
    const vec = aggregateStimulus([resolveDose(ex, perf, o.ctx)]);
    const eq = stimulusEquivalence(target, vec, alpha);
    const u =
      cp('uAvail') * a.avail + cp('uEnjoy') * enjoyOf(ex, o.profile) + cp('uCover') * eq.score - (cp('uMinutesPer10') * minutes) / 10 -
      cp('uInjury') * (ex.injuryRisk - 1) - cp('uSkillGap') * Math.max(0, ex.skill - o.profile.skill);
    const rank = lastUsedRank(ex.id, history);
    if (!best || u > best.u + 1e-9 || (Math.abs(u - best.u) <= 1e-9 && (rank > best.rank || (rank === best.rank && ex.id < best.ex.id)))) {
      best = { ex, equipment: a.equipment, perf, avail: a.avail, u, rank };
    }
  }
  return { pick: best ? { ex: best.ex, equipment: best.equipment, perf: best.perf, avail: best.avail } : null, target };
}

// ================================================================== session assembly

function itemOf(ex: ExerciseRecord, equipment: string[], perf: PerformedExercise, dose: ExerciseDose): ConcreteItem {
  const kcal = Math.round(dose.energy.netKcal);
  const it: ConcreteItem = { exerciseId: ex.id, name: ex.name, equipment, minutes: dose.minutes, kcal, perf, text: '' };
  if (perf.minutes !== undefined && perf.setCount === undefined) {
    it.met = perf.met ?? dose.energy.met;
    it.text = `${ex.name}: ${Math.round(dose.minutes)} min (about ${energyText(kcal)})`;
  } else {
    const n = perf.setCount ?? 0;
    it.sets = n;
    const reps = perf.reps ?? ex.defaultDose.reps;
    const hold = ex.defaultDose.holdSec;
    const work = ex.defaultDose.workSec ?? ex.defaultDose.durationSec;
    if (reps !== undefined) it.reps = reps;
    else if (hold !== undefined) it.holdSec = hold;
    else if (work !== undefined) it.workSec = work;
    if (perf.pct1RM !== undefined) it.loadPct = perf.pct1RM;
    if (perf.loadKg !== undefined) it.loadKg = perf.loadKg;
    it.rir = dose.meanRir;
    it.restSec = dose.restSec;
    const per =
      reps !== undefined ? `${n} × ${reps}` : hold !== undefined ? `${n} × ${hold} s hold` : work !== undefined ? `${n} × ${work} s` : `${n} rounds`;
    const load = perf.loadKg !== undefined ? ` at ${perf.loadKg} kg` : '';
    it.text = `${ex.name}: ${per}${load} (${dose.restSec} s rest, about ${energyText(kcal)})`;
  }
  return it;
}

function emptyVector(): StimulusVector {
  return { effectiveSetsByRegion: {}, pattern: 'complex', loadClass: 'veryLight', netKcal: 0, mem: 0, hiMinutes: 0, mobilityMinutes: {} };
}

function finish(rx: SessionPrescription, items: ConcreteItem[], doses: ExerciseDose[], target: StimulusVector, alpha: StimulusIntent, purchases: ReadonlySet<string>, owned: ReadonlySet<string>): ConcreteSession {
  const delivered = doses.length > 0 ? aggregateStimulus(doses) : emptyVector();
  const equivalence = stimulusEquivalence(target, delivered, alpha);
  const tol = cp('sessionSetTolerance');
  const spill: Partial<Record<TrainingRegion, number>> = {};
  let ok = true;
  if (rx.kind === 'resistance') {
    for (const r of REGIONS) {
      const t = rx.setsByRegion[r] ?? 0;
      const d = delivered.effectiveSetsByRegion[r] ?? 0;
      if (t > 0 && d < t - tol) ok = false;
      if (d > t + tol) spill[r] = d - t;
    }
  } else ok = equivalence.parity;
  const minutes = (rx.kind === 'resistance' && items.length > 0 ? cp('warmupMin') : 0) + doses.reduce((a, d) => a + d.minutes, 0);
  const purchasesUsed = [...new Set(items.flatMap((i) => i.equipment).filter((q) => purchases.has(q) && !owned.has(q)))].sort();
  return {
    prescription: rx,
    items,
    minutes,
    delivered,
    target,
    equivalence,
    withinTolerance: ok,
    shortfall: equivalence.shortfall,
    spill,
    engine: toEngineDose(doses, rx.startH),
    purchasesUsed,
  };
}

function resistanceTarget(rx: ResistancePrescription): StimulusVector {
  return { ...emptyVector(), effectiveSetsByRegion: { ...rx.setsByRegion }, loadClass: loadClassOf(rx.loadPct1RM ?? 70) };
}

interface PlannedVariants {
  ex: ExerciseRecord;
  /** Dose when done with a loadable implement (target %1RM and RIR). */
  loaded: Planned | null;
  /** Dose when done without one (default or capacity reps). */
  unloaded: Planned | null;
}

/** Planned single-set doses of every willing catalogue item for a resistance prescription (availability-independent). */
function planAll(rx: ResistancePrescription, o: ComposeOptions): PlannedVariants[] {
  const out: PlannedVariants[] = [];
  for (const ex of o.catalogue.exercises) {
    if (!isWilling(ex, o)) continue;
    const canLoad = ex.equipmentAnyOf.some((alt) => loadable(ex, alt));
    const canUnload = ex.equipmentAnyOf.some((alt) => !loadable(ex, alt));
    const loaded = canLoad ? planResistance(ex, rx, o, true) : null;
    const unloaded = canUnload ? planResistance(ex, rx, o, false) : null;
    if (loaded || unloaded) out.push({ ex, loaded, unloaded });
  }
  return out;
}

function composeWith(rx: SessionPrescription, o: ComposeOptions, planned: PlannedVariants[] | null): ConcreteSession {
  const owned = new Set(o.profile.owned);
  const purchases = new Set(o.purchases ?? []);
  if (rx.kind === 'resistance') {
    const picks = composeResistance(rx, o, planned ?? planAll(rx, o), owned, purchases);
    const doses: ExerciseDose[] = [];
    const items: ConcreteItem[] = [];
    for (const k of picks) {
      const perf: PerformedExercise = { ...k.p.perf, setCount: k.n, equipmentUsed: k.equipment };
      const d = resolveDose(k.p.ex, perf, o.ctx);
      doses.push(d);
      items.push(itemOf(k.p.ex, k.equipment, perf, d));
    }
    const target = resistanceTarget(rx);
    const alpha = rx.intent ?? ((rx.loadPct1RM ?? 70) >= ENGINE.loadHeavyPct ? { ...INTENT_DEFAULTS.strength } : { ...INTENT_DEFAULTS.muscle });
    return finish(rx, items, doses, target, alpha, purchases, owned);
  }
  const { pick, target } = composeCardio(rx, o, owned, purchases);
  const alpha = rx.intent ?? { ...INTENT_DEFAULTS.vo2max };
  if (!pick) return finish(rx, [], [], target, alpha, purchases, owned);
  const perf = { ...pick.perf, equipmentUsed: pick.equipment };
  const d = resolveDose(pick.ex, perf, o.ctx);
  const item = itemOf(pick.ex, pick.equipment, perf, d);
  item.pctVo2max = rx.pctVo2max;
  return finish(rx, [item], [d], target, alpha, purchases, owned);
}

/** Compose one session (PLANNER_V2 §8.3). */
export function composeSession(rx: SessionPrescription, o: ComposeOptions): ConcreteSession {
  return composeWith(rx, o, null);
}

/** Compose sessions in order; each sees the earlier ones as history (exercise rotation among equal choices). */
export function composeSessions(rxs: readonly SessionPrescription[], o: ComposeOptions): ConcreteSession[] {
  const out: ConcreteSession[] = [];
  const history = [...(o.history ?? [])];
  for (const rx of rxs) {
    const s = composeSession(rx, { ...o, history });
    out.push(s);
    history.push(s);
  }
  return out;
}

// ================================================================== envelope (PLANNER_V2 §8.2)

export interface TrainingEnvelope {
  /** Upper bound of effective sets per region in one session (≤ 3 exercises, ≤ 5 sets each, ≤ 2 per pattern, time cap). */
  maxEffectiveSetsPerSession: Partial<Record<TrainingRegion, number>>;
  /** Highest %1RM (or equivalent) reachable per region; 100 where an adjustable external load exists. */
  maxLoadPct: Partial<Record<TrainingRegion, number>>;
  /** Regions whose hardest available variant has more than 30 reps to failure (load-limited, R3 §3.2). */
  loadLimitedRegions: TrainingRegion[];
  cardioModalities: Partial<Record<CardioModality, { maxMet: number; exerciseIds: string[] }>>;
  patterns: MovementPattern[];
  candidateCount: number;
  includesPurchases: boolean;
}

/**
 * What the willing, injury-safe, available catalogue can deliver (owned ∪ access ∪ purchasable within the allowance
 * when `includePurchases`; everything with `fullCatalogue`). The planner bounds its training genes by it.
 */
export function trainingEnvelope(
  o: ComposeOptions & { weekday?: Weekday; startH?: number; maxMinPerSession?: number; includePurchases?: boolean },
): TrainingEnvelope {
  const owned = new Set(o.profile.owned);
  let purchases = new Set(o.purchases ?? []);
  if (o.includePurchases) {
    const allow = o.profile.purchaseAllowance;
    if (allow.maxItems > 0) for (const q of o.catalogue.equipment) if (q.ownershipKind === 'owned' && q.priceTier <= allow.maxPriceTier) purchases = new Set([...purchases, q.id]);
  }
  const refused = new Set(o.profile.refused);
  const days: Weekday[] = o.weekday !== undefined ? [o.weekday] : [0, 1, 2, 3, 4, 5, 6];
  const startH = o.startH ?? 18;
  const rx: ResistancePrescription = { kind: 'resistance', weekday: days[0]!, startH, maxMin: o.maxMinPerSession ?? 120, setsByRegion: {}, loadPct1RM: 70, rir: 2 };
  const avail = (ex: ExerciseRecord): boolean => days.some((d) => exerciseAvailability(ex, d, startH, o, owned, purchases, refused).avail > 0);
  const willing = o.catalogue.exercises.filter((ex) => isWilling(ex, o) && avail(ex));
  const maxSets: Partial<Record<TrainingRegion, number>> = {};
  const maxLoad: Partial<Record<TrainingRegion, number>> = {};
  const limited: TrainingRegion[] = [];
  const patterns = new Set<MovementPattern>();
  const cardio: TrainingEnvelope['cardioModalities'] = {};
  const planned = willing
    .map((ex) => {
      const a = days.map((d) => exerciseAvailability(ex, d, startH, o, owned, purchases, refused)).reduce((x, y) => (y.avail > x.avail ? y : x));
      return planResistance(ex, rx, o, loadable(ex, a.equipment));
    })
    .filter((p): p is Planned => p !== null);
  for (const ex of willing) {
    patterns.add(ex.pattern);
    if (ex.hybridCardioShare > 0) {
      const m = ex.cardioModality ?? 'other';
      const c = cardio[m] ?? { maxMet: 0, exerciseIds: [] };
      c.maxMet = Math.max(c.maxMet, ex.energy.metRange[1]);
      c.exerciseIds.push(ex.id);
      cardio[m] = c;
    }
  }
  const budgetMin = (o.maxMinPerSession ?? Number.POSITIVE_INFINITY) - cp('warmupMin');
  for (const r of REGIONS) {
    const direct = planned.filter((p) => (p.ex.regions[r] ?? 0) >= 1 && (p.perSet[r] ?? 0) > 0).sort((a, b) => (b.perSet[r] ?? 0) - (a.perSet[r] ?? 0) || a.ex.id.localeCompare(b.ex.id));
    let total = 0;
    let used = 0;
    let minutes = 0;
    const perPattern = new Map<MovementPattern, number>();
    for (const p of direct) {
      if (used >= 3) break;
      if ((perPattern.get(p.ex.pattern) ?? 0) >= cp('maxExercisesPerPattern')) continue;
      let n = cp('maxSetsPerExercise');
      while (n > 0 && minutes + n * p.perSetMin > budgetMin + 1e-9) n--;
      if (n <= 0) continue;
      total += n * (p.perSet[r] ?? 0);
      minutes += n * p.perSetMin;
      used++;
      perPattern.set(p.ex.pattern, (perPattern.get(p.ex.pattern) ?? 0) + 1);
    }
    if (total > 0) maxSets[r] = total;
    let best = 0;
    for (const p of direct) {
      const cap = o.profile.capacities?.[p.ex.id];
      const L = p.perf.pct1RM !== undefined ? 100 : cap?.repsMax !== undefined ? loadPctFromRepsToFailure(cap.repsMax) : p.loadPct;
      best = Math.max(best, L);
    }
    if (best > 0) {
      maxLoad[r] = best;
      if (repsToFailureAt(best) > cp('maxRepsToFailureHyp')) limited.push(r);
    }
  }
  return {
    maxEffectiveSetsPerSession: maxSets,
    maxLoadPct: maxLoad,
    loadLimitedRegions: limited,
    cardioModalities: cardio,
    patterns: [...patterns].sort(),
    candidateCount: willing.length,
    includesPurchases: o.includePurchases === true,
  };
}

// ================================================================== shopping list (PLANNER_V2 §8.5, R3 §6)

export interface ShoppingItem {
  /** First equipment id of the bundle (PLANNER_V2 field). */
  equipmentId: string;
  /** All equipment ids that must be bought together (e.g. barbell + plates). */
  equipmentIds: string[];
  name: string;
  priceTier: number;
  /** The plan's dose cannot be delivered within tolerance without it. */
  required: boolean;
  /** Patterns and cardio modalities it makes possible. */
  unlocks: string[];
  /** ΔU = U*(owned ∪ bundle) − U*(owned): summed slot coverage minus time cost. */
  deltaUtility: number;
  /** Ranking score ΔU / (priceTier + 1). */
  score: number;
  withinAllowance: boolean;
  /** Filled by the planner from engine re-runs ("adds 0.3 kg muscle"); empty here. */
  benefit: Array<{ goal: number; delta: number; unit: string }>;
  text: string;
}

/**
 * U* of a plan's sessions (R3 §6): summed coverage minus time cost. The time cost is taken per unit of coverage
 * (minutes / S), so equipment that lets the plan deliver more of its prescribed dose is not penalised for the extra
 * minutes that dose takes, while equipment that delivers the same dose faster still gains.
 */
function planUtility(sessions: readonly ConcreteSession[]): number {
  return sessions.reduce((a, s) => a + cp('uCover') * s.equivalence.score - (cp('uMinutesPer10') * (s.minutes / Math.max(0.05, s.equivalence.score))) / 10, 0);
}

/**
 * Shopping list for a plan's sessions: for each not-available item (or the minimal bundle an exercise needs), the gain
 * in plan utility when it is owned, ranked by gain per price tier; gains under 0.05 are omitted; required items first.
 * Rungs respect `purchaseAllowance` (`ideal: false`); the Ideal lists everything.
 */
export function shoppingList(rxs: readonly SessionPrescription[], o: ComposeOptions & { ideal?: boolean; limit?: number }): ShoppingItem[] {
  const base = { ...o, fullCatalogue: false };
  const plannedByRx = rxs.map((rx) => (rx.kind === 'resistance' ? planAll(rx, base) : null));
  const composeAll = (opts: ComposeOptions): ConcreteSession[] => {
    const out: ConcreteSession[] = [];
    const history = [...(opts.history ?? [])];
    rxs.forEach((rx, i) => {
      const s = composeWith(rx, { ...opts, history }, plannedByRx[i] ?? null);
      out.push(s);
      history.push(s);
    });
    return out;
  };
  const baseSessions = composeAll(base);
  const uBase = planUtility(baseSessions);
  const baseFeasible = baseSessions.filter((s) => s.withinTolerance).length;
  const owned = new Set(o.profile.owned);
  const purchases = new Set(o.purchases ?? []);
  const refused = new Set(o.profile.refused);
  const days = [...new Set(rxs.map((r) => r.weekday))];
  const startH = rxs[0]?.startH ?? 18;

  // candidate bundles: what each willing exercise is missing (≤ 3 purchasable items)
  const bundles = new Map<string, string[]>();
  for (const ex of o.catalogue.exercises) {
    if (!isWilling(ex, o)) continue;
    for (const alt of ex.equipmentAnyOf) {
      if (alt.some((q) => refused.has(q))) continue;
      const missing = alt.filter((q) => !days.some((d) => equipmentAvail(q, d, startH, base, owned, purchases) > 0));
      if (missing.length === 0 || missing.length > 3) continue;
      const items = missing.map((q) => o.catalogue.equipmentItem(q));
      if (items.some((q) => !q || q.ownershipKind !== 'owned')) continue;
      const key = [...missing].sort().join('+');
      if (!bundles.has(key)) bundles.set(key, [...missing].sort());
    }
  }
  const patternsWith = (own: ReadonlySet<string>): { patterns: Set<string>; modalities: Set<string> } => {
    const patterns = new Set<string>();
    const modalities = new Set<string>();
    for (const ex of o.catalogue.exercises) {
      if (!isWilling(ex, o)) continue;
      const ok = ex.equipmentAnyOf.some((alt) => alt.every((q) => own.has(q) || days.some((d) => equipmentAvail(q, d, startH, base, owned, purchases) > 0)));
      if (!ok) continue;
      patterns.add(ex.pattern);
      if (ex.hybridCardioShare > 0) modalities.add(ex.cardioModality ?? 'other');
    }
    return { patterns, modalities };
  };
  const before = patternsWith(new Set());
  const allow = o.profile.purchaseAllowance;
  const out: ShoppingItem[] = [];
  for (const ids of bundles.values()) {
    const prof: TrainingProfile = { ...o.profile, owned: [...o.profile.owned, ...ids] };
    const sessions = composeAll({ ...base, profile: prof });
    const dU = planUtility(sessions) - uBase;
    if (dU < cp('shopMinDeltaU')) continue;
    const eq = ids.map((q) => o.catalogue.equipmentItem(q)!) as EquipmentItem[];
    const tier = Math.max(...eq.map((q) => q.priceTier));
    const after = patternsWith(new Set(ids));
    const unlocks = [
      ...[...after.patterns].filter((p) => !before.patterns.has(p)).sort(),
      ...[...after.modalities].filter((m) => !before.modalities.has(m)).sort().map((m) => `cardio:${m}`),
    ];
    const fixes = baseFeasible < rxs.length && sessions.filter((s) => s.withinTolerance).length > baseFeasible;
    const name = eq.map((q) => q.name).join(' + ');
    const what = unlocks
      .filter((u) => !u.startsWith('cardio:'))
      .slice(0, 2)
      .map((u) => PATTERN_LABEL[u as MovementPattern] ?? u)
      .join(' and ');
    const why = what ? `adds ${what} work` : 'makes the sessions shorter or closer to the plan';
    out.push({
      equipmentId: ids[0]!,
      equipmentIds: ids,
      name,
      priceTier: tier,
      required: fixes,
      unlocks,
      deltaUtility: dU,
      score: dU / (tier + 1),
      withinAllowance: tier === 0 || (allow.maxItems > 0 && tier <= allow.maxPriceTier),
      benefit: [],
      text:
        tier === 0
          ? `Use what you have: ${name} (${why}).`
          : fixes
            ? `To make this plan work you would need: ${name} (${why}).`
            : `Worth buying: ${name} (${why}).`,
    });
  }
  out.sort((a, b) => b.score - a.score || a.equipmentId.localeCompare(b.equipmentId));
  const pool = o.ideal ? out : out.filter((s) => s.withinAllowance);
  // the plan needs one of the bundles that restore feasibility: the best-ranked one is required, the rest are alternatives
  const firstFix = pool.find((s) => s.required);
  for (const s of pool) {
    if (s.required && s !== firstFix) {
      s.required = false;
      s.text = s.priceTier === 0 ? s.text : s.text.replace('To make this plan work you would need: ', 'Or instead: ');
    }
  }
  pool.sort((a, b) => Number(b.required) - Number(a.required) || b.score - a.score || a.equipmentId.localeCompare(b.equipmentId));
  let paid = 0;
  const listed = o.ideal
    ? pool
    : pool.filter((s) => {
        if (s.priceTier === 0) return true;
        paid++;
        return paid <= allow.maxItems;
      });
  return listed.slice(0, o.limit ?? listed.length);
}

// ================================================================== swaps (PLAN item 11: swaps that keep the dose equivalent)

export interface SwapOption {
  exerciseId: string;
  name: string;
  equipment: string[];
  perf: PerformedExercise;
  equivalence: EquivalenceResult;
  utility: number;
  minutes: number;
}

/**
 * Alternatives to a prescribed item that keep the dose equivalent: each willing, available item is dosed to match the
 * prescription (sets 1..6 for resistance, minutes for cardio), scored by `stimulusEquivalence`, and ranked by credit,
 * then utility, then id.
 */
export function swapOptions(
  prescribed: PerformedExercise | readonly PerformedExercise[],
  o: ComposeOptions & { weekday: Weekday; startH: number; alpha?: StimulusIntent; limit?: number },
): SwapOption[] {
  const list = Array.isArray(prescribed) ? (prescribed as readonly PerformedExercise[]) : [prescribed as PerformedExercise];
  const doses = list.map((p) => (p.exerciseId ? o.catalogue.exercise(p.exerciseId) : undefined)).map((ex, i) => (ex ? resolveDose(ex, list[i]!, o.ctx) : null)).filter((d): d is ExerciseDose => d !== null);
  const target = aggregateStimulus(doses);
  const alpha = o.alpha ?? defaultIntent(target);
  const owned = new Set(o.profile.owned);
  const purchases = new Set(o.purchases ?? []);
  const refused = new Set(o.profile.refused);
  const exclude = new Set(list.map((p) => p.exerciseId));
  const isCardio = Object.keys(target.effectiveSetsByRegion).length === 0 && (target.mem > 0 || target.netKcal > 0);
  const out: SwapOption[] = [];
  for (const ex of o.catalogue.exercises) {
    if (exclude.has(ex.id) || !isWilling(ex, o)) continue;
    const a = exerciseAvailability(ex, o.weekday, o.startH, o, owned, purchases, refused);
    if (a.avail <= 0) continue;
    let best: { perf: PerformedExercise; eq: EquivalenceResult; minutes: number } | null = null;
    const tryPerf = (perf: PerformedExercise): void => {
      const d = resolveDose(ex, perf, o.ctx);
      const eq = stimulusEquivalence(target, aggregateStimulus([d]), alpha);
      if (!best || eq.score > best.eq.score + 1e-9 || (Math.abs(eq.score - best.eq.score) <= 1e-9 && d.minutes < best.minutes)) best = { perf, eq, minutes: d.minutes };
    };
    if (isCardio) {
      if (!(ex.hybridCardioShare > 0)) continue;
      const tMin = target.minutes ?? 30;
      for (const f of [0.75, 1, 1.25, 1.5]) tryPerf({ exerciseId: ex.id, minutes: Math.max(1, Math.round(tMin * f)) });
    } else {
      if (ex.loadType === 'cardio' || ex.loadType === 'mobility') {
        if (Object.keys(target.mobilityMinutes).length === 0) continue;
        tryPerf({ exerciseId: ex.id });
      } else if ((ex.defaultDose.sets ?? ex.defaultDose.rounds ?? 0) > 0) {
        for (let n = 1; n <= 6; n++) tryPerf({ exerciseId: ex.id, setCount: n });
      } else tryPerf({ exerciseId: ex.id });
    }
    const b = best as { perf: PerformedExercise; eq: EquivalenceResult; minutes: number } | null;
    if (!b) continue;
    const u =
      cp('uAvail') * a.avail + cp('uEnjoy') * enjoyOf(ex, o.profile) - (cp('uMinutesPer10') * b.minutes) / 10 - cp('uInjury') * (ex.injuryRisk - 1) -
      cp('uSkillGap') * Math.max(0, ex.skill - o.profile.skill);
    out.push({ exerciseId: ex.id, name: ex.name, equipment: a.equipment, perf: { ...b.perf, equipmentUsed: a.equipment }, equivalence: b.eq, utility: u, minutes: b.minutes });
  }
  out.sort((x, y) => y.equivalence.credit - x.equivalence.credit || y.utility - x.utility || x.exerciseId.localeCompare(y.exerciseId));
  return out.slice(0, o.limit ?? 10);
}
