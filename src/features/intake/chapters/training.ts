/**
 * Chapter 2 · Training and equipment (`training`): willingness, injuries and conditions, equipment owned (Indian and
 * Western items from the catalogue), access, time → the catalogue's `TrainingProfile` (what the planner composes
 * sessions from) and `TrainingPreferences` (what the profile has no field for).
 *
 * Mapping (design §10.1): experience never · < 1 y · 1–3 y · 3+ y → skill 1 · 2 · 3 · 4; willingness no · fine · like →
 * enjoy −2 (hard filter, also listed in `refused`) · 0 · +1; a clinician-cleared injury is kept for the record without
 * an exercise filter; "blood pressure that isn't under control" is the hypertension filter; purchases no · ₹1 000 ·
 * ₹5 000 · more → price tier 0 · ≤ 1 · ≤ 2 · ≤ 3, up to 2 items. Heart and pregnancy come from the safety answers.
 */
import type { Catalogue, ContraTag, ExerciseRecord, TrainingProfile, Weekday } from '@/catalogues';
import type { ScreeningAnswers } from '@/features/onboarding/safetyRules';
import { EQUIPMENT_LABEL, T, WEEKDAY } from '../copy';
import { TEXT_PREFIX, isTextEntry, textOf, usedValues, type FlowContext, type Question } from '../flow';
import type { ChapterAnswers, HomeConstraint, LogStyle, TimeOfDay, TrainingFamily, TrainingPreferences, Willingness } from '../types';

export const FAMILIES: readonly TrainingFamily[] = ['lifting', 'bodyweight', 'indian', 'yoga', 'walking', 'running', 'cycling', 'swimming', 'sports', 'dance', 'martial', 'intervals'];

export type Experience = 'never' | 'lt1' | '1to3' | 'gt3';
export type Place = 'home' | 'gym' | 'park' | 'akhara' | 'pool' | 'stairs' | 'court' | 'walkRoute';
export type Kit = 'none' | 'home' | 'bands' | 'dumbbells' | 'indian' | 'gym';
export type Injury = 'shoulder' | 'elbow' | 'wrist' | 'lumbar' | 'cervical' | 'knee' | 'ankle' | 'hip';
export type Condition = 'hypertension' | 'glaucoma' | 'osteoporosis' | 'pelvic_floor';
export type WontDo = 'jumping' | 'floor' | 'overhead' | 'running' | 'noNoise' | 'smallSpace';
export type BuyTier = 'no' | 't1' | 't2' | 't3';

export interface KitValue {
  /** Catalogue equipment ids. */
  owned: string[];
  /** "Something else", kept as typed. */
  custom: string[];
}
/** Weights per loadable item: kg list, or 'unsure'. */
export type WeightsValue = Record<string, number[] | 'unsure'>;
export interface TrainTimeValue {
  days: number;
  minutes: number;
  best: TimeOfDay;
}
export interface InjuriesValue {
  parts: Injury[];
  /** Parts a clinician cleared for normal training. */
  cleared: Injury[];
}
export type PlaceDaysValue = Partial<Record<Place, Weekday[]>>;

export const PLACES: readonly Place[] = ['home', 'gym', 'park', 'akhara', 'pool', 'stairs', 'court', 'walkRoute'];
export const CONDITIONS: readonly Condition[] = ['hypertension', 'glaucoma', 'osteoporosis', 'pelvic_floor'];
export const INJURIES: readonly Injury[] = ['shoulder', 'elbow', 'wrist', 'lumbar', 'cervical', 'knee', 'ankle', 'hip'];
export const ALL_DAYS: readonly Weekday[] = [0, 1, 2, 3, 4, 5, 6];

/** Kit presets expand to catalogue equipment ids (UI presets, design §10). */
export const KITS: Readonly<Record<Kit, readonly string[]>> = {
  none: [],
  home: ['chair', 'backpack', 'water_jug', 'floor_mat'],
  bands: ['band_mini', 'band_tube', 'band_loop_long', 'pullup_bar', 'door_anchor'],
  dumbbells: ['dumbbell', 'kettlebell'],
  indian: ['mudgar_heavy', 'mudgar_pair', 'gada'],
  gym: ['barbell', 'plates', 'squat_rack', 'bench', 'dumbbell', 'kettlebell', 'pullup_bar', 'dip_bars'],
};

/** The grouped checklist (pre-ticked by the kits). */
export const EQUIPMENT_GROUPS: ReadonlyArray<{ id: keyof typeof T.kit.groups; items: readonly string[] }> = [
  { id: 'weights', items: ['dumbbell', 'kettlebell', 'barbell', 'sandbag', 'weighted_vest'] },
  { id: 'bands', items: ['band_mini', 'band_tube', 'band_loop_long', 'pullup_bar', 'dip_bars', 'suspension_trainer', 'ab_wheel'] },
  { id: 'cardio', items: ['treadmill', 'stationary_bike', 'bicycle', 'rower', 'elliptical', 'jump_rope'] },
  { id: 'indian', items: ['mudgar_heavy', 'mudgar_pair', 'indian_clubs', 'gada', 'steel_mace', 'sumtola', 'gar_nal', 'rope_mallakhamb'] },
  { id: 'home', items: ['chair', 'table', 'stairs', 'backpack', 'water_jug', 'bucket', 'towel', 'floor_mat'] },
];

/** Items asked "how heavy?". */
export const LOADABLE: readonly string[] = ['dumbbell', 'kettlebell', 'mudgar_heavy', 'mudgar_pair', 'gada', 'steel_mace', 'sandbag'];
export const WEIGHT_CHIPS: readonly number[] = [2.5, 5, 7.5, 10, 12.5, 15, 20];

/** Equipment a place gives access to (catalogue ids). */
export const PLACE_EQUIPMENT: Readonly<Record<Exclude<Place, 'home'>, readonly string[]>> = {
  gym: ['barbell', 'plates', 'squat_rack', 'bench', 'adjustable_bench', 'dumbbell', 'kettlebell', 'pullup_bar', 'dip_bars', 'cable_station', 'leg_press', 'leg_machine', 'treadmill', 'stationary_bike', 'rower', 'elliptical', 'stair_climber', 'floor_mat'],
  park: ['outdoor_bars'],
  akhara: ['akhara', 'climbing_rope', 'mallakhamb_pole', 'rope_mallakhamb', 'nal'],
  pool: ['pool'],
  stairs: ['stairs'],
  court: ['racquet_court'],
  walkRoute: [],
};

export const equipmentLabel = (id: string, catalogue?: Pick<Catalogue, 'equipmentItem'>): string => EQUIPMENT_LABEL[id] ?? catalogue?.equipmentItem(id)?.name ?? id;

const SKILL: Readonly<Record<Experience, 1 | 2 | 3 | 4>> = { never: 1, lt1: 2, '1to3': 3, gt3: 4 };
const ENJOY: Readonly<Record<Willingness, number>> = { no: -2, fine: 0, like: 1 };
const PURCHASE: Readonly<Record<BuyTier, TrainingProfile['purchaseAllowance']>> = {
  no: { maxPriceTier: 0, maxItems: 0 },
  t1: { maxPriceTier: 1, maxItems: 2 },
  t2: { maxPriceTier: 2, maxItems: 2 },
  t3: { maxPriceTier: 3, maxItems: 2 },
};

/**
 * Refusal / enjoyment tokens for a family. Traditions and patterns where one exists; exercise ids where the catalogue
 * has no single token (walking vs running are both "locomotion").
 */
export function familyTokens(f: TrainingFamily, catalogue: Pick<Catalogue, 'exercises'>): string[] {
  const ids = (pred: (e: ExerciseRecord) => boolean) => catalogue.exercises.filter(pred).map((e) => e.id);
  switch (f) {
    case 'lifting':
      return ['gym', 'kettlebell'];
    case 'bodyweight':
      return ['bodyweight'];
    case 'indian':
      return ['indian'];
    case 'yoga':
      return ['yoga'];
    case 'walking':
      return ids((e) => e.cardioModality === 'walk');
    case 'running':
      return ids((e) => e.cardioModality === 'run');
    case 'cycling':
      return ['cycle'];
    case 'swimming':
      return ['swim'];
    case 'sports':
      return ['sport'];
    case 'dance':
      return ids((e) => /garba|bhangra|danc/i.test(`${e.id} ${e.name}`));
    case 'martial':
      return ids((e) => /kushti|boxing|wrestl|martial/i.test(`${e.id} ${e.name}`));
    case 'intervals':
      return ids((e) => e.cardioModality === 'hiit');
  }
}

export const TRAINING_QUESTIONS: readonly Question[] = [
  {
    id: 'experience',
    chapter: 'training',
    section: 'training',
    kind: 'single',
    prompt: T.experience.prompt,
    short: T.experience.short,
    skipText: T.experience.skip,
    defaultValue: 'lt1',
    options: (['never', 'lt1', '1to3', 'gt3'] as const).map((o) => ({ value: o, label: T.experience.options[o] })),
  },
  {
    id: 'willing',
    chapter: 'training',
    section: 'training',
    anchor: 'willing',
    kind: 'custom',
    widget: 'willingness',
    prompt: T.willing.prompt,
    short: T.willing.short,
    skipText: T.willing.skip,
    receipt: (v) => {
      const w = (v ?? {}) as Partial<Record<TrainingFamily, Willingness>>;
      const name = (f: TrainingFamily) => T.willing.families[f].replace(/ \(.*\)$/, '');
      return T.willing.receipt(
        FAMILIES.filter((f) => w[f] === 'no').map(name),
        FAMILIES.filter((f) => w[f] === 'like').map(name),
      );
    },
  },
  {
    id: 'where',
    chapter: 'training',
    section: 'training',
    anchor: 'where',
    kind: 'multi',
    required: true,
    prompt: T.where.prompt,
    short: T.where.short,
    skipText: T.where.skip,
    options: PLACES.map((p) => ({ value: p, label: T.where.options[p] })),
  },
  {
    id: 'whereDays',
    parent: 'where',
    chapter: 'training',
    section: 'training',
    kind: 'custom',
    widget: 'placeDays',
    prompt: T.whereDays.prompt,
    short: T.whereDays.short,
    skipText: T.whereDays.skip,
    applies: (v) => Array.isArray(v.where) && (v.where as string[]).some((p) => p !== 'home' && p !== 'walkRoute'),
    receipt: (v) => {
      const d = (v ?? {}) as PlaceDaysValue;
      const parts = Object.entries(d)
        .filter(([, days]) => days && days.length < 7)
        .map(([p, days]) => `${T.where.options[p as Place]}: ${WEEKDAY.order.filter((x) => (days ?? []).includes(x as Weekday)).map((x) => WEEKDAY.short[x]).join(' ')}`);
      return parts.length ? parts.join(' · ') : T.whereDays.skip;
    },
  },
  {
    id: 'kit',
    chapter: 'training',
    section: 'training',
    anchor: 'equipment',
    kind: 'custom',
    widget: 'kit',
    prompt: T.kit.prompt,
    short: T.kit.short,
    skipText: T.kit.skip,
    receipt: (v) => {
      const k = (v ?? { owned: [], custom: [] }) as KitValue;
      const names = [...k.owned.filter((id) => id !== 'plates').map((id) => equipmentLabel(id)), ...k.custom];
      if (!names.length) return T.kit.receiptNone;
      return T.kit.receipt(names.slice(0, 4), names.length - 4);
    },
  },
  {
    id: 'weights',
    parent: 'kit',
    chapter: 'training',
    section: 'training',
    kind: 'custom',
    widget: 'weights',
    prompt: T.weights.prompt,
    short: T.weights.short,
    skipText: T.weights.skip,
    applies: (v) => ((v.kit as KitValue | undefined)?.owned ?? []).some((id) => LOADABLE.includes(id)),
    receipt: (v) => {
      const w = (v ?? {}) as WeightsValue;
      return T.weights.receipt(
        Object.entries(w).map(([id, kg]) => `${equipmentLabel(id)} ${kg === 'unsure' ? T.weights.notSure : kg.map((x) => `${x}`).join('/') + ' kg'}`),
      );
    },
  },
  {
    id: 'time',
    chapter: 'training',
    section: 'training',
    anchor: 'time',
    kind: 'custom',
    widget: 'trainTime',
    prompt: T.time.prompt,
    short: T.time.short,
    skipText: T.time.skip,
    receipt: (v) => {
      const t = v as TrainTimeValue;
      return T.time.receipt(t.days, t.minutes, T.time.bestOptions[t.best]);
    },
  },
  {
    id: 'injuries',
    chapter: 'training',
    section: 'training',
    anchor: 'injuries',
    kind: 'custom',
    widget: 'injuries',
    prompt: T.injuries.prompt,
    short: T.injuries.short,
    skipText: T.injuries.skip,
    receipt: (v) => {
      const i = (v ?? { parts: [], cleared: [] }) as InjuriesValue;
      if (!i.parts.length) return T.injuries.options.none;
      return i.parts.map((p) => `${T.injuries.options[p]}${i.cleared.includes(p) ? ` (${T.injuries.receiptCleared})` : ''}`).join(', ');
    },
  },
  {
    id: 'conditions',
    chapter: 'training',
    section: 'training',
    kind: 'custom',
    widget: 'conditions',
    prompt: T.conditions.prompt,
    short: T.conditions.short,
    skipText: T.conditions.skip,
    receipt: (v) => {
      const list = ((v ?? []) as string[]).filter((c) => c !== 'none') as Condition[];
      return list.length ? list.map((c) => T.conditions.options[c]).join(', ') : T.conditions.options.none;
    },
  },
  {
    id: 'wontDo',
    chapter: 'training',
    section: 'training',
    kind: 'multi',
    required: true,
    prompt: T.wontDo.prompt,
    short: T.wontDo.short,
    skipText: T.wontDo.skip,
    otherLabel: T.wontDo.otherLabel,
    options: [
      ...(['jumping', 'floor', 'overhead', 'running', 'noNoise', 'smallSpace'] as const).map((c) => ({ value: c, label: T.wontDo.options[c] })),
      { value: 'none', label: T.wontDo.options.none, exclusive: true },
    ],
  },
  {
    id: 'buy',
    chapter: 'training',
    section: 'training',
    kind: 'single',
    prompt: T.buy.prompt,
    short: T.buy.short,
    skipText: T.buy.skip,
    defaultValue: 'no',
    options: (ctx: FlowContext) => {
      const o = ctx.india ? T.buy.optionsIn : T.buy.optionsOther;
      return (['no', 't1', 't2', 't3'] as const).map((b) => ({ value: b, label: o[b] }));
    },
  },
  {
    id: 'log',
    chapter: 'training',
    section: 'training',
    kind: 'single',
    prompt: T.log.prompt,
    short: T.log.short,
    skipText: T.log.skip,
    defaultValue: 'quick',
    options: (['coach', 'quick', 'detailed'] as const).map((o) => ({ value: o, label: T.log.options[o] })),
  },
];

/* ------------------------------------------------------------------------------------------- reducer */

export interface TrainingContext extends FlowContext {
  catalogue: Pick<Catalogue, 'exercises' | 'equipmentItem'>;
  /** Safety answers (pregnancy and heart are not asked again here). */
  safety?: ScreeningAnswers | null;
}

export interface TrainingResult {
  profile: TrainingProfile;
  prefs: TrainingPreferences;
}

const uniq = <T>(xs: readonly T[]): T[] => Array.from(new Set(xs));

/** Contra tags the safety answers already imply (never asked again in this chapter). */
export function safetyContraTags(s: ScreeningAnswers | null | undefined): ContraTag[] {
  if (!s) return [];
  const out: ContraTag[] = [];
  if (s.pregnancy === 'pregnant-or-breastfeeding') out.push('pregnancy');
  if (s.conditionItems?.includes('heart') || s.symptoms === 'yes') out.push('cardiac_unscreened');
  return out;
}

/** Answers → `TrainingProfile` + `TrainingPreferences` (pure). Skipped answers take the shown defaults. */
export function reduceTraining(a: ChapterAnswers, ctx: TrainingContext): TrainingResult {
  const v = usedValues(TRAINING_QUESTIONS, a, ctx);
  const willing = (v.willing ?? {}) as Partial<Record<TrainingFamily, Willingness>>;
  const enjoy: Record<string, number> = {};
  const refused: string[] = [];
  const liked: string[] = [];
  for (const f of FAMILIES) {
    const w = willing[f] ?? 'fine';
    if (w === 'fine') continue;
    for (const t of familyTokens(f, ctx.catalogue)) {
      enjoy[t] = ENJOY[w];
      if (w === 'no') refused.push(t);
      else liked.push(t);
    }
  }

  const wont = ((v.wontDo ?? []) as string[]).filter((x) => x !== 'none');
  const homeConstraints: HomeConstraint[] = [];
  for (const w of wont) {
    if (isTextEntry(w)) continue;
    if (w === 'jumping') refused.push('jumping');
    else if (w === 'floor') refused.push('floor');
    else if (w === 'overhead') refused.push('overhead');
    else if (w === 'running') refused.push(...familyTokens('running', ctx.catalogue));
    else if (w === 'noNoise') {
      refused.push('noisy', 'jumping');
      homeConstraints.push('noNoise');
    } else if (w === 'smallSpace') homeConstraints.push('smallSpace');
  }
  const refusedText = wont.filter(isTextEntry).map(textOf).join('; ') || undefined;

  const kit = (v.kit ?? { owned: [], custom: [] }) as KitValue;
  const owned = uniq([...kit.owned, ...(kit.owned.includes('barbell') ? ['plates'] : [])]);
  const weights = (v.weights ?? {}) as WeightsValue;
  const loadsKg: Record<string, number[]> = {};
  const weightsUnknown: string[] = [];
  for (const id of owned.filter((x) => LOADABLE.includes(x))) {
    const w = weights[id];
    if (Array.isArray(w) && w.length) loadsKg[id] = [...w].sort((x, y) => x - y);
    else weightsUnknown.push(id);
  }

  const places = ((v.where as Place[] | undefined) ?? ['home']).filter((p) => PLACES.includes(p));
  const days = (v.whereDays ?? {}) as PlaceDaysValue;
  const access: TrainingProfile['access'][number][] = [];
  for (const p of places.length ? places : (['home'] as Place[])) {
    const weekdays = days[p]?.length ? [...days[p]!] : [...ALL_DAYS];
    if (p === 'home') access.push({ place: 'home', equipment: owned, weekdays });
    else access.push({ place: p === 'gym' ? 'gym' : p === 'park' ? 'park' : 'other', equipment: [...PLACE_EQUIPMENT[p]], weekdays });
  }

  const inj = (v.injuries ?? { parts: [], cleared: [] }) as InjuriesValue;
  const conditions = ((v.conditions ?? []) as string[]).filter((c): c is Condition => c !== 'none' && !isTextEntry(c)) as ContraTag[];
  const injuries = uniq<string>([...inj.parts, ...conditions, ...safetyContraTags(ctx.safety)]);
  const cleared = inj.cleared.filter((p) => inj.parts.includes(p));

  const time = (v.time ?? { days: 3, minutes: 30, best: 'any' }) as TrainTimeValue;
  const profile: TrainingProfile = {
    owned,
    access,
    refused: uniq(refused),
    liked: uniq(liked),
    injuries,
    ...(cleared.length ? { cleared } : {}),
    skill: SKILL[(v.experience as Experience | undefined) ?? 'lt1'],
    purchaseAllowance: PURCHASE[(v.buy as BuyTier | undefined) ?? 'no'],
    ...(Object.keys(loadsKg).length ? { loadsKg } : {}),
    ...(Object.keys(enjoy).length ? { enjoy } : {}),
  };
  const prefs: TrainingPreferences = {
    daysPerWeek: time.days,
    minPerSession: time.minutes,
    bestTime: time.best,
    logStyle: (v.log as LogStyle | undefined) ?? 'quick',
    willingness: { ...willing },
    homeConstraints,
    customEquipment: [...kit.custom],
    ...(refusedText ? { refusedText } : {}),
    weightsUnknown,
  };
  return { profile, prefs };
}

/** Kit presets → the checklist they tick (union, in checklist order). */
export function expandKits(kits: readonly Kit[]): string[] {
  return uniq(kits.flatMap((k) => KITS[k]));
}

export { TEXT_PREFIX };
