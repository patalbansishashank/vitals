/**
 * Catalogue assembly, user extensions and validation (pure). The seed lives in `src/content/catalogues`; user and
 * AI-resolved items (SUITE_SPEC `catalogueCustom`) are merged over it, user entries winning on id clashes (an explicit
 * edit by the person).
 */
import { matchScore } from './text';
import type {
  Catalogue,
  CatalogueSource,
  EquipmentItem,
  ExerciseRecord,
  MappingDef,
  SupplementRecord,
  UserCatalogue,
} from './types';
import {
  CARDIO_MODALITIES,
  CONTRA_TAGS,
  ENERGY_EQUATIONS,
  EQUIPMENT_CATEGORIES,
  EXERCISE_TAGS,
  INTENSITY_SCALES,
  LOAD_TYPES,
  PATTERNS,
  REGIONS,
  TRADITIONS,
  VOLUME_UNITS,
} from './vocab';

export interface CatalogueInput {
  version: string;
  exercises: readonly ExerciseRecord[];
  equipment: readonly EquipmentItem[];
  supplements: readonly SupplementRecord[];
  sources: Readonly<Record<string, CatalogueSource>>;
  mappings?: readonly MappingDef[];
}

/** Source used for user and AI-resolved items. */
export const USER_SOURCE: CatalogueSource = {
  key: 'USER',
  cite: 'Added by the person or resolved from their description; mapped by mechanism',
  url: null,
  accessed: '',
  internal: false,
};

function mergeById<T extends { id: string }>(seed: readonly T[], user: readonly T[]): T[] {
  const out = new Map<string, T>();
  for (const s of seed) out.set(s.id, s);
  for (const u of user) out.set(u.id, u);
  return [...out.values()];
}

/** Build a catalogue from the seed and, optionally, the user's extension. */
export function createCatalogue(input: CatalogueInput, user?: Partial<UserCatalogue>): Catalogue {
  const exercises = mergeById(input.exercises, user?.exercises ?? []);
  const equipment = mergeById(input.equipment, user?.equipment ?? []);
  const supplements = [...input.supplements];
  const mappings = [...(input.mappings ?? []), ...(user?.mappings ?? [])];
  const sources: Record<string, CatalogueSource> = { ...input.sources, [USER_SOURCE.key]: USER_SOURCE };
  const exById = new Map(exercises.map((e) => [e.id, e]));
  const eqById = new Map(equipment.map((e) => [e.id, e]));
  const supById = new Map(supplements.map((s) => [s.id, s]));
  const userTag = user && ((user.exercises?.length ?? 0) > 0 || (user.equipment?.length ?? 0) > 0) ? `+u${(user.exercises?.length ?? 0) + (user.equipment?.length ?? 0)}` : '';
  return {
    version: `${input.version}${userTag}`,
    exercises,
    equipment,
    supplements,
    sources,
    mappings,
    exercise: (id) => exById.get(id),
    equipmentItem: (id) => eqById.get(id),
    supplement: (id) => supById.get(id),
    searchExercises(query, limit = 10) {
      return exercises
        .map((e) => ({ e, s: matchScore(query, [e.name, e.id.replace(/_/g, ' '), ...e.aliases]) }))
        .filter((x) => x.s > 0.2)
        .sort((a, b) => b.s - a.s || a.e.id.localeCompare(b.e.id))
        .slice(0, limit)
        .map((x) => x.e);
    },
  };
}

// ================================================================== validation

export interface CatalogueIssue {
  severity: 'error' | 'warning';
  kind: 'exercise' | 'equipment' | 'supplement' | 'source' | 'mapping';
  id: string;
  message: string;
}

const inList = <T>(list: readonly T[], v: unknown): boolean => list.includes(v as T);
const grade = (g: unknown): boolean => g === 'A' || g === 'B' || g === 'C' || g === 'D';
const int15 = (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5;

/** Validate one exercise against the equipment ids and source keys it may reference. */
export function validateExercise(e: ExerciseRecord, ctx: { equipment: ReadonlySet<string>; sources: ReadonlySet<string> }): CatalogueIssue[] {
  const out: CatalogueIssue[] = [];
  const err = (message: string): void => void out.push({ severity: 'error', kind: 'exercise', id: e.id, message });
  if (!/^[a-z0-9_.:-]+$/.test(e.id)) err('id must be lower snake case');
  if (!e.name.trim()) err('name is empty');
  if (!inList(TRADITIONS, e.tradition)) err(`unknown tradition ${e.tradition}`);
  if (!inList(PATTERNS, e.pattern)) err(`unknown pattern ${e.pattern}`);
  if (!inList(LOAD_TYPES, e.loadType)) err(`unknown loadType ${e.loadType}`);
  if (!inList(INTENSITY_SCALES, e.intensityScale)) err(`unknown intensityScale ${e.intensityScale}`);
  if (!inList(VOLUME_UNITS, e.volumeUnit)) err(`unknown volumeUnit ${e.volumeUnit}`);
  if (!inList(ENERGY_EQUATIONS, e.energy.equation)) err(`unknown energy equation ${e.energy.equation}`);
  if (e.cardioModality !== null && !inList(CARDIO_MODALITIES, e.cardioModality)) err(`unknown cardio modality ${e.cardioModality}`);
  for (const [r, w] of Object.entries(e.regions)) {
    if (!inList(REGIONS, r)) err(`unknown region ${r}`);
    if (!(typeof w === 'number' && w > 0 && w <= 1)) err(`region weight ${r}=${w} outside (0, 1]`);
  }
  if (e.equipmentAnyOf.length === 0) err('equipmentAnyOf is empty (use [[]] for no equipment)');
  for (const alt of e.equipmentAnyOf) for (const q of alt) if (!ctx.equipment.has(q)) err(`unknown equipment ${q}`);
  const [lo, hi] = e.energy.metRange;
  if (!(e.energy.metGross > 0 && lo > 0 && lo <= e.energy.metGross && e.energy.metGross <= hi)) err(`MET ${e.energy.metGross} outside its range [${lo}, ${hi}]`);
  if (!(e.hybridCardioShare >= 0 && e.hybridCardioShare <= 1)) err('hybridCardioShare outside [0, 1]');
  if (e.loadType === 'cardio' && e.hybridCardioShare < 1) err('cardio items must compile fully to cardio (hybridCardioShare 1)');
  if (!(e.secPerRep > 0)) err('secPerRep must be positive');
  if (!int15(e.skill)) err('skill must be 1..5');
  if (!int15(e.injuryRisk)) err('injuryRisk must be 1..5');
  for (const t of e.contraTags) if (!inList(CONTRA_TAGS, t)) err(`unknown contraTag ${t}`);
  for (const t of e.tags) if (!inList(EXERCISE_TAGS, t)) err(`unknown tag ${t}`);
  if (!e.mechanism.trim()) err('mechanism is empty (R5: inclusion needs a named pathway)');
  if (!grade(e.certainty)) err('certainty must be A-D');
  if (e.status !== 'modelled' && e.status !== 'mapped' && e.status !== 'infoOnly') err(`unknown status ${e.status}`);
  if (e.loadType === 'ballistic' && !e.loadFactor) err('ballistic items need a loadFactor');
  if (e.loadFactor && !(e.loadFactor.min <= e.loadFactor.mode && e.loadFactor.mode <= e.loadFactor.max && e.loadFactor.min > 0)) err('loadFactor must be min ≤ mode ≤ max, > 0');
  const d = e.defaultDose;
  const hasVolume = (d.sets ?? 0) > 0 || (d.rounds ?? 0) > 0 || (d.durationMin ?? 0) > 0;
  if (!hasVolume) err('defaultDose has no sets, rounds or duration');
  if ((d.sets ?? 0) > 0 && d.reps === undefined && d.holdSec === undefined && d.durationSec === undefined) err('defaultDose sets need reps, holdSec or durationSec');
  if (e.sources.length === 0) err('no sources');
  for (const s of e.sources) if (!ctx.sources.has(s)) err(`unknown source ${s}`);
  return out;
}

/** Validate the whole catalogue: ids, references, vocabularies, ranges, and that every entry has resolvable sources. */
export function validateCatalogue(c: Catalogue): CatalogueIssue[] {
  const out: CatalogueIssue[] = [];
  const sources = new Set(Object.keys(c.sources));
  const equipment = new Set(c.equipment.map((q) => q.id));
  // ids are unique per kind (an exercise and the equipment it needs may share a name, e.g. leg_press)
  const seen = new Set<string>();
  const dup = (kind: CatalogueIssue['kind'], id: string): void => {
    if (seen.has(`${kind}:${id}`)) out.push({ severity: 'error', kind, id, message: `duplicate ${kind} id` });
    else seen.add(`${kind}:${id}`);
  };
  for (const [k, s] of Object.entries(c.sources)) {
    if (s.key !== k) out.push({ severity: 'error', kind: 'source', id: k, message: 'key mismatch' });
    if (!s.cite.trim()) out.push({ severity: 'error', kind: 'source', id: k, message: 'empty cite' });
    if (!s.internal && s.url !== null && !/^https?:\/\//.test(s.url)) out.push({ severity: 'error', kind: 'source', id: k, message: `public source with a non-web url ${s.url}` });
  }
  for (const e of c.exercises) {
    dup('exercise', e.id);
    out.push(...validateExercise(e, { equipment, sources }));
  }
  for (const q of c.equipment) {
    dup('equipment', q.id);
    const err = (message: string): void => void out.push({ severity: 'error', kind: 'equipment', id: q.id, message });
    if (!q.name.trim()) err('name is empty');
    if (!inList(EQUIPMENT_CATEGORIES, q.category)) err(`unknown category ${q.category}`);
    for (const p of q.enablesPatterns) if (!inList(PATTERNS, p)) err(`unknown pattern ${p}`);
    if (!(Number.isInteger(q.priceTier) && q.priceTier >= 0 && q.priceTier <= 5)) err('priceTier must be 0..5');
    if (q.loadRangeKg && !(q.loadRangeKg[0] > 0 && q.loadRangeKg[0] <= q.loadRangeKg[1])) err('loadRangeKg must be 0 < lo ≤ hi');
    if (q.sources.length === 0) err('no sources');
    for (const s of q.sources) if (!sources.has(s)) err(`unknown source ${s}`);
  }
  for (const s of c.supplements) {
    dup('supplement', s.id);
    const err = (message: string): void => void out.push({ severity: 'error', kind: 'supplement', id: s.id, message });
    if (!s.mechanism.trim()) err('mechanism is empty');
    if (s.outcomes.length === 0) err('no graded outcomes');
    for (const o of s.outcomes) if (!grade(o.certainty)) err(`outcome ${o.outcome} has no A-D certainty`);
    if (s.dose.amount === null && !s.dose.rule && Object.keys(s.dose.details).length === 0) err('dose has neither an amount nor a rule');
    if (s.dose.range && !(s.dose.range[0] <= s.dose.range[1])) err('dose range reversed');
    if (s.sources.length === 0) err('no sources');
    for (const k of s.sources) if (!sources.has(k)) err(`unknown source ${k}`);
    if (s.sources.every((k) => c.sources[k]?.internal))
      out.push({ severity: 'warning', kind: 'supplement', id: s.id, message: 'only internal sources (research notes); add a public reference' });
  }
  for (const m of c.mappings) {
    const err = (message: string): void => void out.push({ severity: 'error', kind: 'mapping', id: m.itemId, message });
    if (!c.exercise(m.itemId) && !c.supplement(m.itemId)) err('mapping for an unknown item');
    if (!(m.tau.median > 0 && m.tau.sigmaLog > 0 && m.tau.wRobust >= 0 && m.tau.wRobust < 1)) err('invalid tau prior');
    if (!m.pathway.trim()) err('mapping without a pathway');
  }
  return out;
}
