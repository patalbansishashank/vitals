/**
 * Practical limits and the Ideal transform (PLANNER_V2_SPEC §2.1-§2.4).
 *
 * - `LIMIT_CLASS`: every input field the planner reads, classed `practical` / `preference` (the user's limits on how they
 *   live: the Ideal relaxes them, grouped as `LimitGroupId`) or `value` / `safety` / `consent` / `request` (kept). The
 *   coverage audit fails on an unclassed field.
 * - `idealRequest(req)`: the same request with every practical and preference field at its Ideal value (§2.1 table);
 *   safety, consent, values, goals and horizon untouched; `ideal: true` and all groups in `relaxedGroups` (the grammar
 *   then adds the Ideal-only genes). `relaxGroup(req, group)`: only that group relaxed (shadow prices, §2.4).
 * - `limitText`: one group's limit before and after, in plain words, and the constraint patch "Adopt some of these
 *   limits" writes back. `bindingLimits`: which groups a plan presses against (§2.4 binding test).
 * - `ADVISED_IDEAL` (advice with no engine channel, never counted in the numbers) and `gMinMetric` (§1.3 table).
 *
 * The older form of three user limits — `safety.plannerLocks` entries `max-fast` / `protein-floor` / `carb-floor` whose
 * reasons are all `{ rule: 'user' }` — stands for `maxFastHours` / `proteinFloorGPerKg` / `carbFloorGPerDay` and is relaxed
 * with them; screening locks are never touched.
 */
import { resolveProfile } from '../../core/resolveProfile';
import type { ResolvedProfile } from '../../types/profile';
import type { CardioModality, Schedule } from '../../types/schedule';
import type { RepairEntry } from '../optim/types';
import { HUNGER_TOLERANCE, LATE_EATING_GAP_H, type PlanningContext } from './context';
import { decodePlan } from './decode';
import { longestFastH } from './fastMath';
import { IDEAL_SESSION_MAX_MIN, bedClockOf, idealSleepEnvelope, sleepHoursOf } from './ideal';
import { MARGIN_IDS } from './model';
import { HC, compileSafetyCaps } from './safety';
import type { SkeletonStructure } from './skeleton';
import { LIMIT_GROUPS, type LimitBinding, type LimitGroupId, type PlannerRequest, type PracticalConstraints, type Weekday } from './types';

// ---------------------------------------------------------------------------------------------------------------
// LIMIT_CLASS
// ---------------------------------------------------------------------------------------------------------------

export type FieldClass = 'practical' | 'preference' | 'value' | 'safety' | 'consent' | 'request';
export interface LimitFieldDef {
  /** Dotted path inside its source type, e.g. 'trainingDaysPerWeek', 'fasting.optInTiers'. */
  field: string;
  from: 'PracticalConstraints' | 'ConstraintDraft' | 'PlannerSafetyInput' | 'SafetyOptIns' | 'TrainingProfile' | 'PlannerRequest';
  class: FieldClass;
  /** Practical and preference fields have a group; safety, consent, value and request fields: null. */
  group: LimitGroupId | null;
}

const P = (field: string, group: LimitGroupId): LimitFieldDef => ({ field, from: 'PracticalConstraints', class: 'practical', group });
const PP = (field: string, group: LimitGroupId): LimitFieldDef => ({ field, from: 'PracticalConstraints', class: 'preference', group });
const D = (field: string, cls: 'practical' | 'preference', group: LimitGroupId): LimitFieldDef => ({ field, from: 'ConstraintDraft', class: cls, group });
const S = (field: string, cls: FieldClass = 'safety'): LimitFieldDef => ({ field, from: 'PlannerSafetyInput', class: cls, group: null });
const O = (field: string): LimitFieldDef => ({ field, from: 'SafetyOptIns', class: 'consent', group: null });
const TP = (field: string, cls: FieldClass, group: LimitGroupId | null): LimitFieldDef => ({ field, from: 'TrainingProfile', class: cls, group });
const R = (field: string, cls: FieldClass = 'request'): LimitFieldDef => ({ field, from: 'PlannerRequest', class: cls, group: null });

/** Every input field → class and limit group (§2.1). */
export const LIMIT_CLASS: readonly LimitFieldDef[] = [
  // ---- PracticalConstraints (engine request)
  P('trainingDaysPerWeek', 'trainingDays'),
  P('allowedTrainingWeekdays', 'trainingDays'),
  P('trainingTimeH', 'sessionTime'),
  P('maxSessionMin', 'sessionTime'),
  P('cardioDaysPerWeek', 'cardio'),
  P('cardioModality', 'cardio'),
  P('eatingWindow', 'eatingWindow'),
  P('mealsPerDay', 'eatingWindow'),
  P('steps', 'steps'),
  // the excluded options are cleared with the fasting group (most are fasting levers; the rest go with them)
  PP('excludedLevers', 'fasting'),
  PP('fasting', 'fasting'),
  PP('prefersFasting', 'fasting'),
  P('sleepFixed', 'sleep'),
  P('hungerTolerance', 'hunger'),
  P('maxFastHours', 'fasting'),
  PP('proteinFloorGPerKg', 'foodFloors'),
  PP('carbFloorGPerDay', 'foodFloors'),
  // ---- ConstraintDraft (the Goals screen's limits form; mapped onto PracticalConstraints by the app)
  D('trainingDays', 'practical', 'trainingDays'),
  D('trainingWeekdays', 'practical', 'trainingDays'),
  D('trainingTimeH', 'practical', 'sessionTime'),
  D('maxSessionMin', 'practical', 'sessionTime'),
  D('cardioDays', 'practical', 'cardio'),
  D('cardioModality', 'practical', 'cardio'),
  D('earliestH', 'practical', 'eatingWindow'),
  D('latestH', 'practical', 'eatingWindow'),
  D('mealsPerDay', 'practical', 'eatingWindow'),
  D('steps', 'practical', 'steps'),
  D('longestFastH', 'practical', 'fasting'),
  D('prefersFasting', 'preference', 'fasting'),
  D('excluded', 'preference', 'fasting'),
  D('proteinFloor', 'preference', 'foodFloors'),
  D('carbFloorG', 'preference', 'foodFloors'),
  D('sleepFixed', 'practical', 'sleep'),
  D('hungerTolerance', 'practical', 'hunger'),
  // ---- PlannerSafetyInput (screening outcome): never relaxed
  S('plannerAccess'),
  S('mode'),
  S('restrictions'),
  S('plannerLocks'),
  S('fasting'),
  S('fasting.maxFastHours'),
  S('fasting.maxEligibleTier'),
  S('fasting.effectiveTier'),
  S('fasting.optInTiers', 'consent'),
  S('fasting.shortWindowAvailable'),
  S('flags'),
  S('optIns', 'consent'),
  S('optIns.fastingTier', 'consent'),
  S('optIns.shortEatingWindow', 'consent'),
  S('optIns.levers', 'consent'),
  S('expertMode', 'consent'),
  // ---- SafetyOptIns (onboarding: the consents themselves; a recent illness is a screening answer)
  O('fastingTier'),
  O('shortEatingWindow'),
  { field: 'recentIllness', from: 'SafetyOptIns', class: 'safety', group: null },
  // ---- TrainingProfile (equipment and access are practical; refusals, injuries, skill and measured capacities kept)
  TP('owned', 'practical', 'equipment'),
  TP('access', 'practical', 'equipment'),
  TP('loadsKg', 'practical', 'equipment'),
  TP('purchaseAllowance', 'practical', 'equipment'),
  TP('liked', 'preference', 'equipment'),
  TP('enjoy', 'preference', 'equipment'),
  TP('refused', 'value', null),
  TP('capacities', 'value', null),
  TP('injuries', 'safety', null),
  TP('cleared', 'safety', null),
  TP('skill', 'safety', null),
  // ---- PlannerRequest (V2 adds training and ladder); containers are classed by their members above
  R('profile'),
  R('goals'),
  R('horizonDays'),
  R('startDate'),
  R('strictness'),
  R('seed'),
  R('budget'),
  R('constraints'),
  R('safety', 'safety'),
  R('ideal'),
  R('relaxedGroups'),
  R('training'),
  R('ladder'),
  R('previous'),
  // E20: markers — blood-marker warnings travel with safety; prefer biases are request-level (never relaxed)
  R('markerWarnings', 'safety'),
  R('preferLevers'),
];

/** Group of a PracticalConstraints field (null for a field outside the table). */
export function groupOf(field: keyof PracticalConstraints): LimitGroupId | null {
  return LIMIT_CLASS.find((d) => d.from === 'PracticalConstraints' && d.field === field)?.group ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// effective limits of a request (defaults as the context applies them) and their plain words
// ---------------------------------------------------------------------------------------------------------------

const rpCache = new WeakMap<object, ResolvedProfile>();

function resolved(req: PlannerRequest): ResolvedProfile {
  const hit = rpCache.get(req.profile);
  if (hit) return hit;
  const rp = resolveProfile({ ...req.profile, startDate: req.startDate ?? req.profile.startDate ?? '2026-01-05' });
  rpCache.set(req.profile, rp);
  return rp;
}

/** The user-tagged (non-screening) lock form of a user limit. */
const USER_LOCKS: Readonly<Record<string, LimitGroupId>> = { 'max-fast': 'fasting', 'protein-floor': 'foodFloors', 'carb-floor': 'foodFloors' };

function isUserLock(l: { id: string; reasons?: ReadonlyArray<{ rule: string }> }): boolean {
  return USER_LOCKS[l.id] !== undefined && !!l.reasons?.length && l.reasons.every((r) => r.rule === 'user');
}

function userLock(req: PlannerRequest, id: string): number | undefined {
  let v: number | undefined;
  for (const l of req.safety?.plannerLocks ?? []) if (l.id === id && isUserLock(l) && typeof l.value === 'number') v = v === undefined ? l.value : id === 'max-fast' ? Math.min(v, l.value) : Math.max(v, l.value);
  return v;
}

interface Eff {
  rtMin: number;
  rtMax: number;
  weekdays: number[];
  timeH: number | null;
  sessionMin: number;
  cMin: number;
  cMax: number;
  modality: CardioModality | null;
  earliest: number;
  latest: number;
  mealsMin: number;
  mealsMax: number;
  stepsMin: number;
  stepsMax: number;
  sleepFixed: boolean;
  sleepH: number;
  hunger: 'low' | 'medium' | 'high';
  maxFastH: number | null;
  fastingNone: boolean;
  excluded: number;
  prefersFasting: boolean;
  proteinFloor: number | null;
  carbFloor: number | null;
  tierMaxH: number;
  novice: boolean;
  equipmentRelaxed: boolean;
}

function effective(req: PlannerRequest): Eff {
  const rp = resolved(req);
  const c = req.constraints ?? {};
  const g = req.relaxedGroups ?? [];
  const all = req.ideal === true;
  const caps = compileSafetyCaps(rp, req.safety, c);
  const hab = rp.habits;
  const stepsMin = c.steps?.min ?? Math.min(15000, Math.max(3000, hab.typicalSteps));
  const userFast = [c.maxFastHours, userLock(req, 'max-fast')].filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  const pf = [c.proteinFloorGPerKg, userLock(req, 'protein-floor')].filter((x): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0);
  const cf = [c.carbFloorGPerDay, userLock(req, 'carb-floor')].filter((x): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0);
  return {
    rtMin: c.trainingDaysPerWeek?.min ?? 0,
    rtMax: c.trainingDaysPerWeek?.max ?? 4,
    weekdays: [...new Set(c.allowedTrainingWeekdays ?? [0, 1, 2, 3, 4, 5, 6])].sort((a, b) => a - b),
    timeH: all || g.includes('sessionTime') ? (c.trainingTimeH ?? null) : (c.trainingTimeH ?? 18),
    sessionMin: c.maxSessionMin ?? 90,
    cMin: c.cardioDaysPerWeek?.min ?? 0,
    cMax: c.cardioDaysPerWeek?.max ?? 3,
    modality: all || g.includes('cardio') ? (c.cardioModality ?? null) : (c.cardioModality ?? (hab.trainingHistory === 'none' ? 'walk' : 'cycle')),
    earliest: c.eatingWindow?.earliestH ?? 7,
    latest: c.eatingWindow?.latestH ?? 21,
    mealsMin: c.mealsPerDay?.min ?? 2,
    mealsMax: c.mealsPerDay?.max ?? 4,
    stepsMin,
    stepsMax: Math.max(stepsMin, c.steps?.max ?? Math.max(12000, stepsMin)),
    sleepFixed: all || g.includes('sleep') ? false : (c.sleepFixed ?? sleepHoursOf(hab.bedTimeH, hab.wakeTimeH) >= 7),
    sleepH: sleepHoursOf(hab.bedTimeH, hab.wakeTimeH),
    hunger: c.hungerTolerance ?? 'medium',
    maxFastH: userFast.length ? Math.min(...userFast) : null,
    fastingNone: c.fasting === 'none',
    excluded: new Set(c.excludedLevers ?? []).size,
    prefersFasting: !!c.prefersFasting,
    proteinFloor: pf.length ? Math.max(...pf) : null,
    carbFloor: cf.length ? Math.max(...cf) : null,
    tierMaxH: caps.maxFastH,
    novice: caps.rtNovice,
    equipmentRelaxed: all || g.includes('equipment'),
  };
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MODALITY_WORDS: Readonly<Record<CardioModality, string>> = { walk: 'walking', run: 'running', cycle: 'cycling', swim: 'swimming', row: 'rowing', hiit: 'intervals', other: 'other cardio' };

export function clockText(h: number): string {
  const m = Math.round((((h % 24) + 24) % 24) * 60);
  const hh = Math.floor(m / 60) % 24;
  const mm = m % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function intText(n: number): string {
  const s = String(Math.round(Math.abs(n)));
  return (n < 0 ? '-' : '') + s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function numText(x: number): string {
  const r = Math.round(x * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function rangeText(lo: number, hi: number, f: (x: number) => string = numText): string {
  return lo === hi ? f(lo) : lo <= 0 ? `up to ${f(hi)}` : `${f(lo)}-${f(hi)}`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

type FieldTexts = Partial<Record<keyof PracticalConstraints | 'equipment', string>>;

/** Plain words for every limit field of an effective view (only the fields a group relaxes). */
function fieldTexts(e: Eff): FieldTexts {
  return {
    trainingDaysPerWeek: `${rangeText(e.rtMin, e.rtMax)} training ${plural(e.rtMax, 'day')} a week${e.novice && e.rtMax > 3 ? ' (3 while you are new to training)' : ''}`,
    allowedTrainingWeekdays: e.weekdays.length >= 7 ? 'any day of the week' : `only on ${e.weekdays.map((d) => DAY_NAMES[d]).join(', ')}`,
    trainingTimeH: e.timeH === null ? 'the best time of your waking day' : `around ${clockText(e.timeH)}`,
    maxSessionMin: `sessions up to ${Math.round(e.sessionMin)} min`,
    cardioDaysPerWeek: `${rangeText(e.cMin, e.cMax)} cardio ${plural(e.cMax, 'day')} a week`,
    cardioModality: e.modality === null ? 'any kind of cardio your safety settings allow' : MODALITY_WORDS[e.modality],
    eatingWindow: `meals between ${clockText(e.earliest)} and ${clockText(e.latest)}`,
    mealsPerDay: `${rangeText(e.mealsMin, e.mealsMax)} meals a day`,
    steps: `${intText(e.stepsMin)}-${intText(e.stepsMax)} steps a day`,
    sleepFixed: e.sleepFixed ? `sleep kept as it is (about ${numText(e.sleepH)} h)` : 'sleep 7-8.5 h at the same times every day',
    hungerTolerance: `${e.hunger} hunger tolerance`,
    maxFastHours: e.maxFastH === null ? `fasts up to ${Math.round(e.tierMaxH)} h (what your safety settings allow)` : `fasts up to ${Math.round(e.maxFastH)} h`,
    fasting: e.fastingNone ? 'no fasting' : 'fasting allowed',
    excludedLevers: e.excluded ? `${e.excluded} ${plural(e.excluded, 'option')} ruled out` : 'nothing ruled out',
    prefersFasting: e.prefersFasting ? 'fasting preferred' : 'no preference for fasting',
    proteinFloorGPerKg: e.proteinFloor === null ? 'the safety minimum for protein' : `protein at least ${numText(e.proteinFloor)} g per kg`,
    carbFloorGPerDay: e.carbFloor === null ? 'the safety minimum for carbohydrate' : `carbohydrate at least ${Math.round(e.carbFloor)} g a day`,
    equipment: e.equipmentRelaxed ? 'any equipment (items to buy are listed)' : 'the equipment you have',
  };
}

const GROUP_FIELDS: Readonly<Record<LimitGroupId, ReadonlyArray<keyof FieldTexts>>> = {
  trainingDays: ['trainingDaysPerWeek', 'allowedTrainingWeekdays'],
  sessionTime: ['maxSessionMin', 'trainingTimeH'],
  cardio: ['cardioDaysPerWeek', 'cardioModality'],
  eatingWindow: ['eatingWindow', 'mealsPerDay'],
  steps: ['steps'],
  sleep: ['sleepFixed'],
  fasting: ['maxFastHours', 'fasting', 'excludedLevers', 'prefersFasting'],
  foodFloors: ['proteinFloorGPerKg', 'carbFloorGPerDay'],
  hunger: ['hungerTolerance'],
  equipment: ['equipment'],
};

// ---------------------------------------------------------------------------------------------------------------
// the transform
// ---------------------------------------------------------------------------------------------------------------

/** Steps range of the Ideal (lever L1 evidence range; never tighter than the user's own range). */
export const IDEAL_STEPS = { min: 4000, max: 12000 } as const;
/** Meals a day in the Ideal. */
export const IDEAL_MEALS = { min: 2, max: 5 } as const;
export const IDEAL_DAYS = { training: 6, cardio: 6 } as const;

export interface RelaxedField {
  field: string;
  from: string;
  to: string;
  group: LimitGroupId;
}

const quarter = (h: number) => Math.round(h * 4) / 4;

/** Supplement lever ids and families whose refusal the Ideal and the limit costs keep (consent, §2.1). */
export const SUPPLEMENT_REFUSALS: ReadonlySet<string> = new Set(['L7', 'creatine', 'L8', 'omega3', 'L9', 'fibre']);

function relaxCore<R extends PlannerRequest>(req: R, groups: readonly LimitGroupId[], ideal: boolean): { request: R; relaxed: RelaxedField[] } {
  const rp = resolved(req);
  const c: PracticalConstraints = { ...(req.constraints ?? {}) };
  const set = new Set<LimitGroupId>(groups);
  const allGroups = new Set<LimitGroupId>([...(req.relaxedGroups ?? []), ...groups]);
  const sleepRelaxed = ideal || req.ideal === true || allGroups.has('sleep');
  const hab = rp.habits;
  if (set.has('trainingDays')) {
    c.trainingDaysPerWeek = { min: 0, max: IDEAL_DAYS.training };
    delete c.allowedTrainingWeekdays;
  }
  if (set.has('sessionTime')) {
    delete c.trainingTimeH;
    c.maxSessionMin = Math.max(IDEAL_SESSION_MAX_MIN, c.maxSessionMin ?? 0);
  }
  if (set.has('cardio')) {
    c.cardioDaysPerWeek = { min: 0, max: IDEAL_DAYS.cardio };
    delete c.cardioModality;
  }
  if (set.has('eatingWindow')) {
    // first meal ≥ 30 min after waking, last ≥ 3 h before bed (L19); with the sleep genes, the widest night they allow.
    // Never narrower than the user's own window (the decoder holds the first meal ≥ 30 min after the decoded wake time)
    const env = sleepRelaxed ? idealSleepEnvelope(hab.bedTimeH, hab.wakeTimeH) : { earliestWakeH: hab.wakeTimeH, latestBedClock: bedClockOf(hab.bedTimeH) };
    const e0 = effective(req);
    const earliestH = Math.min(23, Math.max(0, Math.min(e0.earliest, quarter(env.earliestWakeH + 0.5))));
    const latestH = Math.min(23.5, Math.max(earliestH, e0.latest, quarter(env.latestBedClock - LATE_EATING_GAP_H)));
    c.eatingWindow = { earliestH, latestH };
    c.mealsPerDay = { ...IDEAL_MEALS };
  }
  if (set.has('steps')) c.steps = { min: Math.min(IDEAL_STEPS.min, c.steps?.min ?? Infinity), max: Math.max(IDEAL_STEPS.max, c.steps?.max ?? 0) };
  if (set.has('sleep')) c.sleepFixed = false;
  if (set.has('hunger')) c.hungerTolerance = 'high';
  if (set.has('fasting')) {
    delete c.maxFastHours;
    delete c.fasting;
    // a refused supplement is a consent answer, not a practical limit: it stays refused (QA LIV-13)
    const keep = (c.excludedLevers ?? []).filter((id) => SUPPLEMENT_REFUSALS.has(id));
    if (keep.length) c.excludedLevers = keep;
    else delete c.excludedLevers;
    delete c.prefersFasting;
  }
  if (set.has('foodFloors')) {
    delete c.proteinFloorGPerKg;
    delete c.carbFloorGPerDay;
  }
  // user-tagged locks are the older form of three user limits; screening locks stay
  let safety = req.safety;
  const locks = req.safety?.plannerLocks;
  if (locks?.some((l) => isUserLock(l) && set.has(USER_LOCKS[l.id]!))) safety = { ...req.safety, plannerLocks: locks.filter((l) => !(isUserLock(l) && set.has(USER_LOCKS[l.id]!))) };
  const request: R = {
    ...req,
    constraints: c,
    ...(safety !== req.safety ? { safety } : {}),
    relaxedGroups: LIMIT_GROUPS.filter((g) => allGroups.has(g)),
    ...(ideal ? { ideal: true } : {}),
  };
  const before = fieldTexts(effective(req));
  const after = fieldTexts(effective(request));
  const relaxed: RelaxedField[] = [];
  for (const g of LIMIT_GROUPS) {
    if (!set.has(g)) continue;
    for (const f of GROUP_FIELDS[g]) {
      if (g === 'equipment' && !(req as { training?: unknown }).training) continue;
      const from = before[f]!;
      const to = after[f]!;
      if (from !== to) relaxed.push({ field: f === 'equipment' ? 'training.owned' : `constraints.${f}`, from, to, group: g });
    }
  }
  return { request, relaxed };
}

/**
 * The Ideal's request (§2.1): every practical and preference field at its Ideal value; safety, consent, values, goals,
 * horizon, strictness and start date kept; `ideal: true` and every group in `relaxedGroups`. `relaxed` lists each field
 * that changed, with plain from/to texts.
 */
export function idealRequest<R extends PlannerRequest>(req: R): { request: R; relaxed: RelaxedField[] } {
  return relaxCore(req, LIMIT_GROUPS, true);
}

/** The request with only `group` relaxed to its Ideal value (a limit's shadow price, §2.4). */
export function relaxGroup<R extends PlannerRequest>(req: R, group: LimitGroupId): R {
  return relaxCore(req, [group], false).request;
}

/** `relaxGroup` with the changed fields (from/to texts). */
export function relaxGroupDetailed<R extends PlannerRequest>(req: R, group: LimitGroupId): { request: R; relaxed: RelaxedField[] } {
  return relaxCore(req, [group], false);
}

export const LIMIT_LABELS: Readonly<Record<LimitGroupId, string>> = {
  trainingDays: 'Training days',
  sessionTime: 'Session length and time',
  cardio: 'Cardio',
  eatingWindow: 'Eating window',
  steps: 'Daily steps',
  sleep: 'Sleep',
  fasting: 'Fasting',
  foodFloors: 'Food minimums',
  hunger: 'Hunger tolerance',
  equipment: 'Equipment',
};

function groupSummary(group: LimitGroupId, e: Eff): string {
  const t = fieldTexts(e);
  switch (group) {
    case 'trainingDays':
      return `${e.rtMax} training ${plural(e.rtMax, 'day')} a week${e.weekdays.length < 7 ? ` (${t.allowedTrainingWeekdays})` : ''}${e.novice && e.rtMax > 3 ? ', 3 while you are new to training' : ''}`;
    case 'sessionTime':
      return `${t.maxSessionMin}, ${e.timeH === null ? 'at the best time of day' : `around ${clockText(e.timeH)}`}`;
    case 'cardio':
      return `${e.cMax} cardio ${plural(e.cMax, 'day')} a week, ${e.modality === null ? 'any kind allowed' : MODALITY_WORDS[e.modality]}`;
    case 'eatingWindow':
      return `${t.eatingWindow}, ${t.mealsPerDay}`;
    case 'steps':
      return t.steps!;
    case 'sleep':
      return t.sleepFixed!;
    case 'fasting': {
      const parts = [e.fastingNone ? 'no fasting' : t.maxFastHours!];
      if (e.excluded) parts.push(t.excludedLevers!);
      return parts.join(', ');
    }
    case 'foodFloors':
      return e.proteinFloor === null && e.carbFloor === null ? 'the safety minimums only' : [e.proteinFloor !== null ? t.proteinFloorGPerKg : null, e.carbFloor !== null ? t.carbFloorGPerDay : null].filter(Boolean).join(', ');
    case 'hunger':
      return t.hungerTolerance!;
    case 'equipment':
      return t.equipment!;
  }
}

/**
 * One limit group before and after relaxing, in plain words ("3 training days a week" → "6 training days a week"), and
 * the constraint patch the "Adopt some of these limits" panel writes back (equipment lives in the training profile:
 * empty patch).
 */
export function limitText(group: LimitGroupId, req: PlannerRequest, relaxedReq: PlannerRequest): { label: string; current: string; relaxedTo: string; adopt: Partial<PracticalConstraints> } {
  const a = effective(req);
  const b = effective(relaxedReq);
  const rc = relaxedReq.constraints ?? {};
  let adopt: Partial<PracticalConstraints> = {};
  switch (group) {
    case 'trainingDays':
      adopt = { trainingDaysPerWeek: { min: b.rtMin, max: b.rtMax }, allowedTrainingWeekdays: b.weekdays as Weekday[] };
      break;
    case 'sessionTime':
      adopt = { maxSessionMin: b.sessionMin };
      break;
    case 'cardio':
      adopt = { cardioDaysPerWeek: { min: b.cMin, max: b.cMax } };
      break;
    case 'eatingWindow':
      adopt = { eatingWindow: { earliestH: b.earliest, latestH: b.latest }, mealsPerDay: { min: b.mealsMin, max: b.mealsMax } };
      break;
    case 'steps':
      adopt = { steps: { min: b.stepsMin, max: b.stepsMax } };
      break;
    case 'sleep':
      adopt = { sleepFixed: false };
      break;
    case 'fasting':
      // the user's own preference for fasting is theirs to keep; the limits are the refusal, the longest fast and the exclusions
      adopt = { fasting: 'allowed', maxFastHours: b.tierMaxH, excludedLevers: rc.excludedLevers ?? [] };
      break;
    case 'foodFloors':
      adopt = { proteinFloorGPerKg: 0, carbFloorGPerDay: 0 };
      break;
    case 'hunger':
      adopt = { hungerTolerance: b.hunger };
      break;
    case 'equipment':
      adopt = {};
      break;
  }
  return { label: LIMIT_LABELS[group], current: groupSummary(group, a), relaxedTo: groupSummary(group, b), adopt };
}

// ---------------------------------------------------------------------------------------------------------------
// binding test (§2.4)
// ---------------------------------------------------------------------------------------------------------------

/** Repair rules that come from a limit group (user hard constraints). */
const RULE_GROUP: Readonly<Record<string, LimitGroupId>> = {
  'user.trainingWeekdays': 'trainingDays',
  'user.maxSessionMin': 'sessionTime',
  'user.eatingWindow': 'eatingWindow',
  'user.meals': 'eatingWindow',
  'user.excluded': 'fasting',
};
/** §2.4 thresholds: a rule binds on ≥ 20 % of days; a gene within 2 % of its bound; a margin ≤ 0.25 units. */
export const BINDING = { logShare: 0.2, geneTol: 0.02, margin: 0.25 } as const;

function daysOfEntry(e: RepairEntry, s: Schedule): number[] {
  if (e.day !== undefined) return [e.day];
  const m = e.path ? /^programs\[(\d+)\]/.exec(e.path) : null;
  if (m) {
    const pi = Number(m[1]);
    const out: number[] = [];
    for (let d = 0; d < s.days.length; d++) if (s.days[d]!.program === pi) out.push(d);
    return out;
  }
  const dm = e.path ? /^days\[(\d+)\]/.exec(e.path) : null;
  return dm ? [Number(dm[1])] : [];
}

/**
 * Limit groups a plan presses against (§2.4): the repair log clamped a rule of the group on ≥ 20 % of days; a gene
 * whose bound comes from the group sits within 2 % of that bound (and the Ideal would move the bound); or a margin tied
 * to the group (the hunger cap) is ≤ 0.25 units. Equipment binding comes from the equipment envelope (`opts.equipment`).
 * Texts: "3 training days a week (on 71 % of days)", "sessions up to 60 min (the plan uses all of it)".
 */
export function bindingLimits(
  ctx: PlanningContext,
  structure: SkeletonStructure,
  x: ArrayLike<number>,
  schedule: Schedule,
  log: readonly RepairEntry[],
  margins: ArrayLike<number> | null,
  opts: { equipment?: { binding: boolean; share?: number } } = {},
): LimitBinding[] {
  const T = Math.max(1, schedule.horizonDays);
  const req = ctx.request;
  const c = req.constraints ?? {};
  const p = ctx.practical;
  const caps = ctx.caps;
  const share = new Map<LimitGroupId, number>();
  const viaLog = new Set<LimitGroupId>();
  const bump = (g: LimitGroupId, v: number, log = false) => {
    if (v > (share.get(g) ?? 0)) share.set(g, v);
    if (log) viaLog.add(g);
  };
  // (1) repair log: distinct days per group
  const days = new Map<LimitGroupId, Set<number>>();
  const userProtein = (c.proteinFloorGPerKg ?? userLock(req, 'protein-floor') ?? 0) >= HC.protein.floorDeficitOrAge65 - 1e-9 && (c.proteinFloorGPerKg !== undefined || userLock(req, 'protein-floor') !== undefined);
  const userCarb = (c.carbFloorGPerDay ?? userLock(req, 'carb-floor') ?? -1) >= caps.carbFloorG - 1e-6;
  for (const e of log) {
    let g = RULE_GROUP[e.rule];
    if (!g && e.rule === 'HC-M1' && userProtein) g = 'foodFloors';
    if (!g && e.rule === 'HC-M4' && userCarb) g = 'foodFloors';
    if (!g) continue;
    let set = days.get(g);
    if (!set) days.set(g, (set = new Set()));
    for (const d of daysOfEntry(e, schedule)) if (d >= 0 && d < T) set.add(d);
  }
  for (const [g, set] of days) if (set.size / T >= BINDING.logShare) bump(g, set.size / T, true);
  // (2) genes at a bound the group sets (and the Ideal would move)
  if (!structure.skeleton.baseline) {
    const plan = decodePlan(ctx, structure, x);
    const at = (path: string, side: 'lo' | 'hi', bound: number): boolean => {
      const i = structure.geneIndex[path];
      if (i === undefined) return false;
      const g = structure.genes[i]!;
      const lo = plan.ranges[2 * i]!;
      const hi = plan.ranges[2 * i + 1]!;
      const b = side === 'hi' ? hi : lo;
      if (Math.abs(b - bound) > 1e-6) return false;
      const span = Math.max(1e-9, g.max - g.min);
      return Math.abs(plan.values[i]! - b) <= BINDING.geneTol * span + 1e-9;
    };
    const rtIdealMax = Math.min(IDEAL_DAYS.training, caps.rtNovice ? HC.rtNovice.sessionsMax : IDEAL_DAYS.training);
    if (p.rtDays.max > 0 && p.rtDays.max < rtIdealMax && (at('rt.sessions', 'hi', p.rtDays.max) || (structure.geneIndex['rt.sessions'] === undefined && plan.lifestyle.rtSessions >= p.rtDays.max))) bump('trainingDays', 1);
    if (p.cardioDays.max < IDEAL_DAYS.cardio && at('cardio.sessions', 'hi', p.cardioDays.max)) bump('cardio', 1);
    if (p.maxSessionMin < IDEAL_SESSION_MAX_MIN) {
      if (at('cardio.minutes', 'hi', Math.min(90, p.maxSessionMin))) bump('sessionTime', 1);
      const si = structure.geneIndex['rt.sets'];
      if (si !== undefined && plan.values[si]! >= plan.ranges[2 * si + 1]! - BINDING.geneTol * (structure.genes[si]!.max - structure.genes[si]!.min) && plan.ranges[2 * si + 1]! < structure.genes[si]!.max - 1e-6) bump('sessionTime', 1);
    }
    const ideal = effective(idealRequest(req).request);
    if (p.earliestH > ideal.earliest + 1e-6 && at('window.startH', 'lo', p.earliestH)) bump('eatingWindow', 1);
    if (p.latestH < ideal.latest - 1e-6) {
      const li = structure.geneIndex['window.lengthH'];
      if (li !== undefined && plan.values[li]! >= plan.ranges[2 * li + 1]! - BINDING.geneTol * (structure.genes[li]!.max - structure.genes[li]!.min) && plan.ranges[2 * li + 1]! < 14 - 1e-6) bump('eatingWindow', 1);
    }
    if ((p.meals.max < IDEAL_MEALS.max && at('meals', 'hi', p.meals.max)) || (p.meals.min > IDEAL_MEALS.min && at('meals', 'lo', p.meals.min))) bump('eatingWindow', 1);
    if ((p.steps.max < IDEAL_STEPS.max && at('steps', 'hi', p.steps.max)) || (p.steps.min > IDEAL_STEPS.min && at('steps', 'lo', p.steps.min))) bump('steps', 1);
  }
  // sleep held where the evidence would move it (fixed below 7.5 h or above 8.5 h)
  if (p.sleepFixed && !p.idealGenes.sleep && (p.habitualSleepH < 7.5 - 1e-9 || p.habitualSleepH > 8.5 + 1e-9)) bump('sleep', 1);
  // the user's longest fast below the tier's, and the plan fasting right up to it
  const userFast = c.maxFastHours ?? userLock(req, 'max-fast');
  if (userFast !== undefined && caps.maxFastH <= userFast + 1e-6 && longestFastH(schedule) >= caps.maxFastH - 0.5 && caps.maxFastH > 0) bump('fasting', 1);
  // (3) margins tied to a group: the hunger cap (h_tol + 0.15) of the hunger tolerance
  const hi = MARGIN_IDS.indexOf('hungerCap');
  if (margins && p.hTol < HUNGER_TOLERANCE.high - 1e-9 && margins[hi] !== undefined && margins[hi]! <= BINDING.margin) bump('hunger', 1);
  if (opts.equipment?.binding) bump('equipment', Math.min(1, Math.max(0, opts.equipment.share ?? 1)));
  const out: LimitBinding[] = [];
  const eff = effective(req);
  for (const g of LIMIT_GROUPS) {
    const sh = share.get(g);
    if (sh === undefined) continue;
    const current = groupSummary(g, eff);
    const text = viaLog.has(g) && sh < 1 ? `${current} (on ${Math.round(100 * sh)} % of days)` : `${current} (the plan uses all of it)`;
    out.push({ group: g, label: LIMIT_LABELS[g], share: sh, text });
  }
  return out.sort((a, b) => b.share - a.share || LIMIT_GROUPS.indexOf(a.group) - LIMIT_GROUPS.indexOf(b.group));
}

// ---------------------------------------------------------------------------------------------------------------
// advice and minimal meaningful change
// ---------------------------------------------------------------------------------------------------------------

/** Advised-only items of the Ideal (§2.2): mechanism known, no engine channel; shown as advice, never in the numbers. */
export const ADVISED_IDEAL: ReadonlyArray<{ domain: string; text: string }> = [
  {
    domain: 'Sleep timing',
    text: 'Keep the middle of your night between about 02:30 and 04:30, moving it by no more than 2 hours from where it is now. If you work shifts, a regular daytime schedule helps if your work allows it.',
  },
  { domain: 'Training and sleep', text: 'Finish hard training at least an hour before bed.' },
  { domain: 'Caffeine', text: 'No caffeine within 6 hours of bedtime.' },
  { domain: 'Light, temperature and surroundings', text: 'Bright light in the morning; a dark, cool and quiet bedroom at night.' },
];

/**
 * Goal k's minimal meaningful change in metric units (§1.3, PROPOSED): fat mass 1 kg, trend weight 1 kg, body fat 1
 * point, waist 1 cm, visceral fat 0.1 kg, skeletal muscle or lean tissue 0.3 kg, strength 5 % of baseline. Null for every
 * other metric: the caller uses 10 % of the goal's achievable range.
 */
export function gMinMetric(ctx: PlanningContext, goalIndex: number): number | null {
  const g = ctx.goals.find((x) => x.index === goalIndex) ?? ctx.goals[goalIndex];
  if (!g) return null;
  switch (g.metric) {
    case 'fatMass':
    case 'scaleWeight':
      return 1;
    case 'bodyFatPct':
      return 1;
    case 'waist':
      return 1;
    case 'visceralFat':
      return 0.1;
    case 'skeletalMuscle':
    case 'leanTissue':
    case 'leanMass':
    case 'rtMuscleGain':
      return 0.3;
    case 'strength':
      return 5;
    default:
      return null;
  }
}
