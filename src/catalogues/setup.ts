/**
 * The person's training setup as the composer needs it (PLANNER_V2 §8.1, R3 §7): the `TrainingProfile` stored by the
 * intake's training chapter (`intake/me.training`, SUITE_SPEC §2.3.1), checked field by field, plus the equipment the
 * person added themselves; and a plan session's engine dose as a composer prescription. Pure (tier P).
 */
import { resolveUnknownEquipment } from './equivalence';
import { normName } from './text';
import type { CardioPrescription, ResistancePrescription, SessionPrescription } from './compose';
import type { CardioSession, ResistanceSession } from '@/engine/types/schedule';
import type { AccessPlace, Catalogue, TrainingProfile, TrainingRegion, Weekday } from './types';
import { CARDIO_MODALITIES, REGIONS } from './vocab';

const ALL_DAYS: readonly Weekday[] = [0, 1, 2, 3, 4, 5, 6];

/**
 * Nothing answered yet: bodyweight at home every day, beginner limits (skill 2, the intake's "under 1 year" default), no
 * purchases — the defaults the intake shows for skipped questions (design §6.3).
 */
export const DEFAULT_TRAINING_PROFILE: TrainingProfile = {
  owned: [],
  access: [{ place: 'home', equipment: [], weekdays: ALL_DAYS }],
  refused: [],
  liked: [],
  injuries: [],
  skill: 2,
  purchaseAllowance: { maxPriceTier: 0, maxItems: 0 },
};

export interface TrainingProfileResult {
  profile: TrainingProfile;
  /** The intake's training section was there. */
  answered: boolean;
  /** "Something else" equipment as typed (intake `prefs.customEquipment`). */
  customEquipment: string[];
  /** Typed items no catalogue item matches yet (they count once added through `catalogue.addEquipment`). */
  unresolvedEquipment: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const days = (v: unknown): Weekday[] => (Array.isArray(v) ? v.filter((d): d is Weekday => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6) : []);
const PLACES: ReadonlySet<string> = new Set(['home', 'gym', 'park', 'other']);

function numberLists(v: unknown): Record<string, number[]> | undefined {
  if (!isObj(v)) return undefined;
  const out: Record<string, number[]> = {};
  for (const [k, xs] of Object.entries(v)) {
    const list = Array.isArray(xs) ? xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0) : [];
    if (list.length) out[k] = list;
  }
  return Object.keys(out).length ? out : undefined;
}

const compact = (s: string): string => normName(s).replace(/ /g, '');

/**
 * The equipment id a typed name stands for (seed or the person's own item, by name, alias or id; spaces and hyphens
 * ignored, so "pull-up bar" is `pullup_bar`), else null.
 */
export function equipmentIdFor(name: string, catalogue: Pick<Catalogue, 'equipment'>): string | null {
  const sentinel = '\u0000none';
  const hit = resolveUnknownEquipment(name, catalogue as Catalogue, { id: sentinel });
  if (hit.id !== sentinel) return hit.id;
  const c = compact(name);
  if (!c) return null;
  return catalogue.equipment.find((q) => [q.name, q.id, ...q.aliases].some((n) => compact(n) === c))?.id ?? null;
}

/**
 * The stored intake training section (`TrainingProfile & { prefs }`) → a checked `TrainingProfile`, with the person's
 * own equipment (`ownedEquipment`: custom items and owned references from `catalogueCustom`) and the intake's typed
 * "something else" items that resolve to a catalogue item added to what they own (and to their home place).
 */
export function trainingProfileFromIntake(section: unknown, o: { catalogue: Pick<Catalogue, 'equipment'>; ownedEquipment?: readonly string[] }): TrainingProfileResult {
  const answered = isObj(section);
  const s: Record<string, unknown> = answered ? section : {};
  const prefs = isObj(s.prefs) ? s.prefs : {};
  const customEquipment = strs(prefs.customEquipment).map((x) => x.trim()).filter(Boolean);
  const resolved: string[] = [];
  const unresolvedEquipment: string[] = [];
  for (const name of customEquipment) {
    const id = equipmentIdFor(name, o.catalogue);
    if (id) resolved.push(id);
    else unresolvedEquipment.push(name);
  }
  const base = answered ? s : (DEFAULT_TRAINING_PROFILE as unknown as Record<string, unknown>);
  const extra = [...new Set([...resolved, ...(o.ownedEquipment ?? [])])];
  const owned = [...new Set([...strs(base.owned), ...extra])];

  const access: AccessPlace[] = [];
  for (const a of Array.isArray(base.access) ? base.access : []) {
    if (!isObj(a) || typeof a.place !== 'string' || !PLACES.has(a.place)) continue;
    const hours = Array.isArray(a.hours) && a.hours.length === 2 && a.hours.every((h) => num(h) !== undefined) ? ([a.hours[0], a.hours[1]] as [number, number]) : undefined;
    access.push({ place: a.place as AccessPlace['place'], equipment: strs(a.equipment), weekdays: days(a.weekdays), ...(hours ? { hours } : {}) });
  }
  if (!access.length) access.push({ place: 'home', equipment: [], weekdays: ALL_DAYS });
  // the person's own items live at home (the intake puts what they own there)
  const home = access.find((a) => a.place === 'home');
  if (home && extra.length) home.equipment = [...new Set([...home.equipment, ...extra])];

  const skill = num(base.skill);
  const allowance = isObj(base.purchaseAllowance) ? base.purchaseAllowance : {};
  const maxPriceTier = num(allowance.maxPriceTier);
  const maxItems = num(allowance.maxItems);
  const enjoy = isObj(base.enjoy) ? Object.fromEntries(Object.entries(base.enjoy).filter((e): e is [string, number] => num(e[1]) !== undefined)) : undefined;
  const capacities = isObj(base.capacities)
    ? Object.fromEntries(
        Object.entries(base.capacities)
          .filter((e): e is [string, Record<string, unknown>] => isObj(e[1]))
          .map(([k, c]) => [k, { ...(num(c.repsMax) !== undefined ? { repsMax: num(c.repsMax) } : {}), ...(num(c.oneRepMaxKg) !== undefined ? { oneRepMaxKg: num(c.oneRepMaxKg) } : {}) }]),
      )
    : undefined;
  const loadsKg = numberLists(base.loadsKg);
  const cleared = strs(base.cleared);
  const profile: TrainingProfile = {
    owned,
    access,
    refused: [...new Set(strs(base.refused))],
    liked: [...new Set(strs(base.liked))],
    injuries: [...new Set(strs(base.injuries))],
    ...(cleared.length ? { cleared } : {}),
    skill: (skill !== undefined && Number.isInteger(skill) && skill >= 1 && skill <= 5 ? skill : DEFAULT_TRAINING_PROFILE.skill) as TrainingProfile['skill'],
    purchaseAllowance: {
      maxPriceTier: (maxPriceTier !== undefined && Number.isInteger(maxPriceTier) && maxPriceTier >= 0 && maxPriceTier <= 5 ? maxPriceTier : 0) as TrainingProfile['purchaseAllowance']['maxPriceTier'],
      maxItems: maxItems !== undefined && maxItems >= 0 ? Math.floor(maxItems) : 0,
    },
    ...(loadsKg ? { loadsKg } : {}),
    ...(capacities && Object.keys(capacities).length ? { capacities } : {}),
    ...(enjoy && Object.keys(enjoy).length ? { enjoy } : {}),
  };
  return { profile, answered, customEquipment, unresolvedEquipment };
}

/**
 * A plan session's engine dose (the frozen prescription's `engine` sessions) → the composer's prescription: resistance
 * = summed sets by region within the slot's minutes (first rir / %1RM), cardio = modality, minutes and %VO2max (0.6
 * when the plan gives none). Same reading as the Train screen's (`features/living/train/session.ts prescriptionOf`).
 */
export function prescriptionFromEngine(
  kind: 'resistance' | 'cardio',
  engine: ReadonlyArray<ResistanceSession | CardioSession>,
  o: { weekday: Weekday; startH: number; durationMin: number },
): SessionPrescription {
  if (kind === 'resistance') {
    const setsByRegion: Partial<Record<TrainingRegion, number>> = {};
    let rir: number | undefined;
    let load: number | undefined;
    for (const e of engine) {
      if (e.kind !== 'resistance') continue;
      for (const [k, v] of Object.entries(e.setsByRegion ?? {}) as Array<[TrainingRegion, number | undefined]>) if (REGIONS.includes(k)) setsByRegion[k] = (setsByRegion[k] ?? 0) + (v ?? 0);
      rir ??= e.rir;
      load ??= e.loadPct1RM;
    }
    const rx: ResistancePrescription = { kind: 'resistance', weekday: o.weekday, startH: o.startH, maxMin: o.durationMin, setsByRegion, ...(load !== undefined ? { loadPct1RM: load } : {}), ...(rir !== undefined ? { rir } : {}) };
    return rx;
  }
  const c = engine.find((e): e is CardioSession => e.kind === 'cardio');
  const modality = c && CARDIO_MODALITIES.includes(c.modality) ? c.modality : 'walk';
  const rx: CardioPrescription = { kind: 'cardio', weekday: o.weekday, startH: o.startH, modality, minutes: c?.durationMin ?? o.durationMin, pctVo2max: c?.pctVo2max ?? 0.6 };
  return rx;
}
