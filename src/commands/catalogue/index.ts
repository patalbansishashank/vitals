/**
 * `catalogue.*`, `train.*` and `food.dayTargets` executors (I1-C) for the stubs declared in `../defs/catalogue.ts`, over
 * E8's catalogues (`@/catalogues`, `@/content/catalogues`, imported lazily: the data is large) and the person's setup
 * (`./setup.ts`: the seed merged with their `catalogueCustom` items, the intake's training profile, the body context, the
 * running plan's prescriptions).
 *
 * User additions (`catalogue.addExercise` / `addFood` / `addEquipment`) are `catalogueCustom` documents written through
 * the command's transaction (undo: tombstone). Each kind has a natural key, the normalised name: adding a name the
 * person already added returns that item, and a name the seed knows returns the seed item (equipment then records that
 * the person owns it). The food reference bundle is a later data task (docs/CATALOGUES.md): food search reads the
 * person's own foods only, and says so.
 */
import type {
  ConcreteItem,
  ConcreteSession,
  EquipmentItem,
  EquivalenceResult,
  ExerciseRecord,
  FoodRecord,
  PerformedExercise,
  PerformedSet,
  SessionPrescription,
  StimulusIntent,
  StimulusVector,
  SupplementRecord,
  TrainingProfile,
  TrainingRegion,
} from '@/catalogues';
import type { LocalDate, PrescribedDaySnapshot } from '@/living';
import { addDays, compareDates } from '@/living';
import { implement } from '../implement';
import { fail } from '../registry';
import type { CommandContext } from '../types';
import { catalogueWeekday, loadCatalogueModules, personCatalogueNow, prescribedDays, trainingSetupNow, type CatalogueModules, type TrainingSetupNow } from './setup';

const BY = 'I1-C (catalogues)';
const FOOD_REFERENCE_NOTE = 'The food reference is not bundled yet: only foods you added are searched.';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const fin = (x: number | undefined | null): number => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const norm = (s: string): string => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

function numMap(o: Readonly<Record<string, number | undefined>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(o)) if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  return out;
}

function addedBy(ctx: CommandContext): 'user' | 'ai' | 'agent' | 'system' {
  const k = ctx.actor.kind;
  return k === 'user' ? 'user' : k === 'ai' ? 'ai' : k === 'system' ? 'system' : 'agent';
}

/* ---------------------------------------------------------------- views */

function hasEquipmentFor(ex: Pick<ExerciseRecord, 'equipmentAnyOf'>, p: TrainingProfile): boolean {
  const owned = new Set(p.owned);
  return ex.equipmentAnyOf.some((alt) => alt.every((q) => owned.has(q) || p.access.some((a) => a.equipment.includes(q))));
}

function ownsEquipment(id: string, p: TrainingProfile): boolean {
  return p.owned.includes(id) || p.access.some((a) => a.equipment.includes(id));
}

function exerciseView(m: CatalogueModules, ex: ExerciseRecord, s: TrainingSetupNow) {
  return {
    id: ex.id,
    name: ex.name,
    aliases: [...ex.aliases],
    tradition: ex.tradition,
    pattern: ex.pattern,
    regions: numMap(ex.regions),
    equipmentAnyOf: ex.equipmentAnyOf.map((a) => [...a]),
    loadType: ex.loadType,
    intensityScale: ex.intensityScale,
    volumeUnit: ex.volumeUnit,
    defaultDose: numMap(ex.defaultDose as Record<string, number | undefined>),
    metGross: ex.energy.metGross,
    cardioModality: ex.cardioModality,
    skill: ex.skill,
    injuryRisk: ex.injuryRisk,
    contraTags: [...ex.contraTags],
    tags: [...ex.tags],
    status: ex.status,
    certainty: ex.certainty,
    origin: ex.origin,
    own: ex.origin !== 'seed',
    available: hasEquipmentFor(ex, s.profile),
    willing: m.cat.isWilling(ex, { profile: s.profile }),
  };
}

function equipmentView(q: EquipmentItem, p: TrainingProfile) {
  return {
    id: q.id,
    name: q.name,
    aliases: [...q.aliases],
    category: q.category,
    ownershipKind: q.ownershipKind,
    loadRangeKg: q.loadRangeKg ? [...q.loadRangeKg] : null,
    adjustable: q.adjustable,
    enablesPatterns: [...q.enablesPatterns],
    priceTier: q.priceTier,
    space: q.space,
    note: q.note,
    origin: q.origin,
    own: q.origin !== 'seed',
    owned: ownsEquipment(q.id, p),
  };
}

function equivalenceView(e: EquivalenceResult) {
  return {
    score: fin(e.score),
    credit: fin(e.credit),
    parity: e.parity,
    band: e.band,
    perTerm: e.perTerm.map((t) => ({ term: t.term, ratio: fin(t.ratio), weight: fin(t.weight) })),
    shortfall: e.shortfall.map((s) => ({ term: s.term, missing: fin(s.missing), text: s.text })),
    alsoTrained: [...e.alsoTrained],
  };
}

const json = <T>(v: T): Record<string, unknown> => JSON.parse(JSON.stringify(v)) as Record<string, unknown>;

const ITEM_NUMS = ['sets', 'reps', 'holdSec', 'workSec', 'loadKg', 'loadPct', 'met', 'rir', 'restSec'] as const;

function itemView(it: ConcreteItem) {
  const out: Record<string, unknown> = { exerciseId: it.exerciseId, name: it.name, equipment: [...it.equipment], minutes: fin(it.minutes), kcal: fin(it.kcal), text: it.text, perf: json(it.perf) };
  for (const k of ITEM_NUMS) {
    const v = it[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

/* ---------------------------------------------------------------- performed exercises from tool input */

const PERF_NUMS = [
  'setCount', 'reps', 'holdSec', 'workSec', 'rounds', 'loadKg', 'pct1RM', 'rir', 'rpe', 'restSec', 'minutes', 'met', 'speedKmh', 'powerW', 'gradePct',
  'stepRatePerMin', 'stepHeightM', 'loadCarriedKg', 'oneRepMaxKg',
] as const;
const SET_NUMS = ['reps', 'holdSec', 'workSec', 'loadKg', 'pct1RM', 'rir', 'rpe'] as const;

/** A `PerformedExercise` from an open object (unknown and ill-typed fields dropped; null when it names nothing). */
function perfOf(v: unknown): PerformedExercise | null {
  if (!isObj(v)) return null;
  const out: Record<string, unknown> = {};
  if (typeof v.exerciseId === 'string' && v.exerciseId) out.exerciseId = v.exerciseId;
  if (typeof v.freeText === 'string' && v.freeText.trim()) out.freeText = v.freeText.trim();
  for (const k of PERF_NUMS) if (typeof v[k] === 'number' && Number.isFinite(v[k]) && (v[k] as number) >= 0) out[k] = v[k];
  if (Array.isArray(v.sets)) {
    const sets: PerformedSet[] = [];
    for (const s of v.sets) {
      if (!isObj(s)) continue;
      const set: Record<string, unknown> = {};
      for (const k of SET_NUMS) if (typeof s[k] === 'number' && Number.isFinite(s[k]) && (s[k] as number) >= 0) set[k] = s[k];
      if (typeof s.nearFailure === 'boolean') set.nearFailure = s.nearFailure;
      sets.push(set as PerformedSet);
    }
    if (sets.length) out.sets = sets;
  }
  if (Array.isArray(v.equipmentUsed)) out.equipmentUsed = v.equipmentUsed.filter((x): x is string => typeof x === 'string');
  if (typeof v.terrain === 'string' && ['road', 'dirt', 'lightBrush', 'heavyBrush'].includes(v.terrain)) out.terrain = v.terrain;
  return out.exerciseId || out.freeText ? (out as PerformedExercise) : null;
}

function perfList(list: unknown, path: string): PerformedExercise[] {
  if (!Array.isArray(list)) fail('invalid_input', 'Expected a list of exercises.', { path });
  return list.map((p, i) => perfOf(p) ?? fail('invalid_input', 'Each exercise needs an exerciseId or a freeText description.', { path: `${path}/${i}` }));
}

const INTENT_KEYS = ['hyp', 'str', 'card', 'kcal', 'mob'] as const;

function intentOf(m: CatalogueModules, p: Record<string, unknown>): StimulusIntent | undefined {
  if (typeof p.goal === 'string' && ['muscle', 'strength', 'fatLoss', 'vo2max', 'mobility'].includes(p.goal)) return m.cat.intentFor(p.goal as 'muscle');
  const i = p.intent;
  if (!isObj(i)) return undefined;
  const out = { hyp: 0, str: 0, card: 0, kcal: 0, mob: 0 };
  for (const k of INTENT_KEYS) if (typeof i[k] === 'number' && Number.isFinite(i[k]) && (i[k] as number) >= 0) out[k] = i[k] as number;
  const sum = INTENT_KEYS.reduce((a, k) => a + out[k], 0);
  return sum > 0 ? (Object.fromEntries(INTENT_KEYS.map((k) => [k, out[k] / sum])) as unknown as StimulusIntent) : undefined;
}

/** A stimulus vector given directly (open object, sanitised); null when it carries no dose. */
function vectorOfInput(m: CatalogueModules, p: Record<string, unknown>): StimulusVector | null {
  const eff: Partial<Record<TrainingRegion, number>> = {};
  if (isObj(p.effectiveSetsByRegion))
    for (const [r, v] of Object.entries(p.effectiveSetsByRegion)) if (m.cat.REGIONS.includes(r as TrainingRegion) && typeof v === 'number' && Number.isFinite(v) && v > 0) eff[r as TrainingRegion] = v;
  const n = (k: string): number => (typeof p[k] === 'number' && Number.isFinite(p[k]) && (p[k] as number) > 0 ? (p[k] as number) : 0);
  const mobility: Record<string, number> = {};
  if (isObj(p.mobilityMinutes)) for (const [k, v] of Object.entries(p.mobilityMinutes)) if (typeof v === 'number' && Number.isFinite(v) && v > 0) mobility[k] = v;
  if (!Object.keys(eff).length && !n('netKcal') && !n('mem') && !Object.keys(mobility).length) return null;
  const pattern = typeof p.pattern === 'string' && m.cat.PATTERNS.includes(p.pattern as never) ? (p.pattern as StimulusVector['pattern']) : 'complex';
  const loadClass = ['heavy', 'moderate', 'light', 'veryLight'].includes(p.loadClass as string) ? (p.loadClass as StimulusVector['loadClass']) : 'moderate';
  return { effectiveSetsByRegion: eff, pattern, loadClass, netKcal: n('netKcal'), mem: n('mem'), hiMinutes: n('hiMinutes'), mobilityMinutes: mobility };
}

/* ---------------------------------------------------------------- composed days */

interface ComposedSession {
  slotKey: string;
  kind: 'resistance' | 'cardio';
  startH: number;
  durationMin: number;
  composedHere: boolean;
  session: ConcreteSession;
}

/** The day's sessions as concrete exercises: the plan's composed session, else one composed now from the setup. */
function composeDay(m: CatalogueModules, s: TrainingSetupNow, rx: PrescribedDaySnapshot, date: LocalDate): ComposedSession[] {
  const weekday = catalogueWeekday(date);
  return rx.sessions.map((p) => {
    const concrete = p.concrete as ConcreteSession | null;
    const session =
      concrete ?? m.cat.composeSession(m.cat.prescriptionFromEngine(p.kind, p.engine, { weekday, startH: p.startH, durationMin: p.durationMin }), { profile: s.profile, catalogue: s.catalogue, ctx: s.ctx });
    return { slotKey: p.slotKey, kind: p.kind, startH: p.startH, durationMin: p.durationMin, composedHere: !concrete, session };
  });
}

function sessionView(c: ComposedSession) {
  const items = c.session.items.map(itemView);
  return {
    slotKey: c.slotKey,
    kind: c.kind,
    startH: c.startH,
    minutes: c.session.items.length > 0 ? Math.max(1, Math.round(c.session.minutes)) : c.durationMin,
    composedHere: c.composedHere,
    items,
    kcal: c.session.items.reduce((a, it) => a + fin(it.kcal), 0),
    withinTolerance: c.session.withinTolerance,
    credit: fin(c.session.equivalence.credit),
    band: c.session.equivalence.band,
    shortfall: c.session.shortfall.map((x) => x.text),
    purchasesUsed: [...c.session.purchasesUsed],
  };
}

const equipmentAnswered = (p: TrainingProfile): boolean => !(p.owned.length === 0 && p.access.every((a) => a.equipment.length === 0));

/* ---------------------------------------------------------------- catalogue reads */

const SEARCH_FILTERS = ['pattern', 'tradition', 'region', 'equipment', 'loadType', 'origin', 'available', 'willing'] as const;

implement(
  'catalogue.searchExercises',
  async (_ctx, input: { q?: string; limit?: number; filters?: Record<string, unknown> }) => {
    const m = await loadCatalogueModules();
    const s = trainingSetupNow(m);
    const f = input.filters ?? {};
    const unknown = Object.keys(f).filter((k) => !(SEARCH_FILTERS as readonly string[]).includes(k));
    if (unknown.length) fail('invalid_input', `Unknown filter ${unknown.join(', ')}; use ${SEARCH_FILTERS.join(', ')}.`, { path: '/filters' });
    const oneOf = (v: unknown): string[] | null => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null);
    const patterns = oneOf(f.pattern);
    const traditions = oneOf(f.tradition);
    const pass = (ex: ExerciseRecord): boolean => {
      if (patterns && !patterns.includes(ex.pattern)) return false;
      if (traditions && !traditions.includes(ex.tradition)) return false;
      if (typeof f.region === 'string' && !((ex.regions as Record<string, number | undefined>)[f.region] ?? 0)) return false;
      if (typeof f.equipment === 'string' && !ex.equipmentAnyOf.some((a) => a.includes(f.equipment as string))) return false;
      if (typeof f.loadType === 'string' && ex.loadType !== f.loadType) return false;
      if (typeof f.origin === 'string' && !(f.origin === 'own' ? ex.origin !== 'seed' : ex.origin === f.origin)) return false;
      if (f.available === true && !hasEquipmentFor(ex, s.profile)) return false;
      if (f.willing === true && !m.cat.isWilling(ex, { profile: s.profile })) return false;
      return true;
    };
    const limit = input.limit ?? 20;
    const q = input.q?.trim() ?? '';
    const pool = q ? s.catalogue.searchExercises(q, s.catalogue.exercises.length) : [...s.catalogue.exercises].sort((a, b) => Number(b.origin !== 'seed') - Number(a.origin !== 'seed') || a.name.localeCompare(b.name));
    return pool.filter(pass).slice(0, limit).map((ex) => exerciseView(m, ex, s));
  },
  BY,
);

implement(
  'catalogue.getExercise',
  async (ctx, input: { id: string }) => {
    const m = await loadCatalogueModules();
    const s = trainingSetupNow(m);
    const ex = s.catalogue.exercise(input.id);
    if (!ex) fail('not_found', `No exercise with id ${input.id}; search with catalogue.searchExercises.`, { path: '/id' });
    const d = m.cat.resolveDose(ex, { exerciseId: ex.id }, s.ctx);
    const ids = [...new Set(ex.equipmentAnyOf.flat())];
    const alternatives = m.cat.swapOptions({ exerciseId: ex.id }, { profile: s.profile, catalogue: s.catalogue, ctx: s.ctx, weekday: catalogueWeekday(ctx.today), startH: 18, limit: 5 });
    return {
      exercise: exerciseView(m, ex, s),
      mechanism: ex.mechanism,
      energy: json(ex.energy),
      evidence: json(m.cat.exerciseLabels(ex)),
      equipment: ids.map((id) => s.catalogue.equipmentItem(id)).filter((q): q is EquipmentItem => !!q).map((q) => equipmentView(q, s.profile)),
      dose: { sets: fin(d.sets), minutes: fin(d.minutes), netKcal: fin(d.energy.netKcal), mem: fin(d.cardio?.mem), effectiveSetsByRegion: numMap(d.effectiveSetsByRegion) },
      alternatives: alternatives.map((a) => ({
        exerciseId: a.exerciseId,
        name: a.name,
        equipment: [...a.equipment],
        minutes: fin(a.minutes),
        credit: fin(a.equivalence.credit),
        score: fin(a.equivalence.score),
        band: a.equivalence.band,
        parity: a.equivalence.parity,
        shortfall: a.equivalence.shortfall.map((x) => x.text),
        perf: json(a.perf),
      })),
    };
  },
  BY,
);

implement(
  'catalogue.equipment',
  async (_ctx, input: { q?: string }) => {
    const m = await loadCatalogueModules();
    const s = trainingSetupNow(m);
    const q = norm(input.q ?? '');
    const list = q ? s.catalogue.equipment.filter((e) => [e.name, e.id.replace(/_/g, ' '), e.category, ...e.aliases].some((x) => norm(x).includes(q))) : s.catalogue.equipment;
    return list.map((e) => equipmentView(e, s.profile));
  },
  BY,
);

function supplementView(m: CatalogueModules, x: SupplementRecord) {
  return {
    kind: 'supplement',
    id: x.id,
    name: x.name,
    aliases: [...x.aliases],
    category: x.category,
    status: x.status,
    goals: [...x.goals],
    mechanism: x.mechanism,
    dose: json(x.dose),
    timing: x.timing,
    form: x.form,
    foodFirstAlternative: x.foodFirstAlternative,
    contraindications: x.contraindications.map((c) => c.flag),
    interactions: [...x.interactions],
    cautions: [...x.cautions],
    diet: json(x.diet),
    evidence: m.cat.supplementLabels(x).map((l) => ({ outcome: l.outcome, direction: l.direction, certainty: l.label.certainty, route: l.label.mechanism.route })),
    engineRoute: x.engine.route,
  };
}

implement(
  'catalogue.supplements',
  async (_ctx, input: { q?: string }) => {
    const m = await loadCatalogueModules();
    const q = norm(input.q ?? '');
    const hit = (names: readonly string[]) => !q || names.some((n) => norm(n).includes(q));
    const supps = m.content.SEED_SUPPLEMENTS.filter((x) => hit([x.name, x.id.replace(/_/g, ' '), x.category, ...x.aliases, ...x.goals])).map((x) => supplementView(m, x));
    const none = m.content.NO_EXPECTED_BENEFIT.filter((x) => hit([x.name, x.id.replace(/_/g, ' ')])).map((x) => ({ kind: 'noExpectedBenefit', id: x.id, name: x.name, reason: x.reason, certainty: x.certainty, gradeText: x.gradeText }));
    return [...supps, ...none];
  },
  BY,
);

function foodView(f: FoodRecord) {
  return { ...json(f), own: f.source === 'user' };
}

implement(
  'catalogue.searchFoods',
  async (ctx, input: { q?: string; limit?: number; filters?: Record<string, unknown> }) => {
    const m = await loadCatalogueModules();
    const { user } = personCatalogueNow(m);
    ctx.notice({ level: 'info', text: FOOD_REFERENCE_NOTE });
    const foods = user.catalogue.foods;
    const table = m.cat.createFoodTable(foods, 'user');
    const q = input.q?.trim() ?? '';
    const tag = typeof input.filters?.tag === 'string' ? input.filters.tag : null;
    const group = typeof input.filters?.group === 'string' ? input.filters.group : null;
    const pool = q ? table.search(q, foods.length) : [...foods].sort((a, b) => a.name.localeCompare(b.name));
    return pool.filter((f) => (!tag || f.tags.includes(tag)) && (!group || f.group === group)).slice(0, input.limit ?? 20).map(foodView);
  },
  BY,
);

implement(
  'catalogue.getFood',
  async (ctx, input: { id: string }) => {
    const m = await loadCatalogueModules();
    const { user } = personCatalogueNow(m);
    const f = user.catalogue.foods.find((x) => x.id === input.id);
    if (!f) {
      ctx.notice({ level: 'info', text: FOOD_REFERENCE_NOTE });
      fail('not_found', `No food with id ${input.id}.`, { path: '/id' });
    }
    return foodView(f);
  },
  BY,
);

implement(
  'catalogue.equivalence',
  async (ctx, input: { prescribed: Record<string, unknown>; performed: unknown[] }) => {
    const m = await loadCatalogueModules();
    const s = trainingSetupNow(m);
    const performed = perfList(input.performed, '/performed');
    const unresolved = performed.filter((p) => !p.exerciseId || !s.catalogue.exercise(p.exerciseId)).map((p) => p.freeText ?? p.exerciseId ?? '');
    const p = input.prescribed;
    const alpha = intentOf(m, p);
    let target: StimulusVector | null;
    if (Array.isArray(p.exercises)) target = m.cat.vectorOf(perfList(p.exercises, '/prescribed/exercises'), s.catalogue, s.ctx);
    else if (typeof p.exerciseId === 'string') {
      const one = perfOf(p);
      if (!one || !s.catalogue.exercise(p.exerciseId)) fail('not_found', `No exercise with id ${p.exerciseId}.`, { path: '/prescribed/exerciseId' });
      target = m.cat.vectorOf([one], s.catalogue, s.ctx);
    } else if (typeof p.date === 'string') {
      const date = p.date as LocalDate;
      const rx = prescribedDays([date], ctx.tz).days.get(date) ?? null;
      const sessions = rx ? composeDay(m, s, rx, date) : [];
      const pick = typeof p.slotKey === 'string' ? sessions.find((x) => x.slotKey === p.slotKey) : sessions[0];
      if (!pick) fail('not_found', `Nothing is prescribed for ${date}${typeof p.slotKey === 'string' ? ` in slot ${p.slotKey}` : ''}.`, { path: '/prescribed' });
      target = pick.session.target;
    } else target = vectorOfInput(m, p);
    if (!target) fail('invalid_input', 'Give the prescription as exercises, an exerciseId, a date (and slotKey) or a stimulus vector.', { path: '/prescribed' });
    const log = m.cat.vectorOf(performed, s.catalogue, s.ctx);
    return { ...equivalenceView(m.cat.stimulusEquivalence(target, log, alpha)), unresolved };
  },
  BY,
);

/* ---------------------------------------------------------------- additions */

implement(
  'catalogue.addEquipment',
  async (ctx, input: { equipment: Record<string, unknown> }) => {
    const m = await loadCatalogueModules();
    const pc = personCatalogueNow(m);
    const out = m.cat.buildUserEquipment(input.equipment, { catalogue: pc.catalogue, user: pc.user });
    switch (out.kind) {
      case 'invalid':
        return fail('invalid_input', out.issues.join('; '), { path: '/equipment' });
      case 'existing':
        return { id: out.id, name: out.name, created: false };
      case 'seed': {
        // a catalogue item typed by name: record that the person has it (once)
        if (input.equipment.owned === false || pc.user.ownedEquipment.includes(out.id)) return { id: out.id, name: out.name, created: false };
        await ctx.docs.put('catalogueCustom', { _id: ctx.newId(), kind: 'equipment', key: m.cat.userItemKey(String(input.equipment.name)), ref: out.id, owned: true, addedBy: addedBy(ctx) });
        return { id: out.id, name: out.name, created: true };
      }
      case 'new':
        for (const w of out.warnings) ctx.notice({ level: 'info', text: w });
        await ctx.docs.put('catalogueCustom', { _id: ctx.newId(), kind: 'equipment', key: out.key, item: json(out.item), owned: input.equipment.owned !== false, addedBy: addedBy(ctx) });
        return { id: out.item.id, name: out.item.name, created: true };
    }
  },
  BY,
);

implement(
  'catalogue.addExercise',
  async (ctx, input: { exercise: Record<string, unknown> }) => {
    const m = await loadCatalogueModules();
    const pc = personCatalogueNow(m);
    const out = m.cat.buildUserExercise(input.exercise, { catalogue: pc.catalogue, user: pc.user, origin: ctx.actor.kind === 'user' ? 'user' : 'ai-resolved' });
    switch (out.kind) {
      case 'invalid':
        return fail('invalid_input', out.issues.join('; '), { path: '/exercise' });
      case 'existing':
      case 'seed':
        return { id: out.id, name: out.name, created: false };
      case 'new':
        for (const w of out.warnings) ctx.notice({ level: 'info', text: w });
        await ctx.docs.put('catalogueCustom', { _id: ctx.newId(), kind: 'exercise', key: out.key, item: json(out.item), addedBy: addedBy(ctx) });
        return { id: out.item.id, name: out.item.name, created: true };
    }
  },
  BY,
);

implement(
  'catalogue.addFood',
  async (ctx, input: { food: Record<string, unknown> }) => {
    const m = await loadCatalogueModules();
    const { user } = personCatalogueNow(m);
    const out = m.cat.buildUserFood(input.food, { user, foods: user.catalogue.foods });
    switch (out.kind) {
      case 'invalid':
        return fail('invalid_input', out.issues.join('; '), { path: '/food' });
      case 'existing':
      case 'seed':
        return { id: out.id, name: out.name, created: false };
      case 'new':
        for (const w of out.warnings) ctx.notice({ level: 'caution', text: w });
        await ctx.docs.put('catalogueCustom', { _id: ctx.newId(), kind: 'food', key: out.key, item: json(out.item), addedBy: addedBy(ctx) });
        return { id: out.item.id, name: out.item.name, created: true };
    }
  },
  BY,
);

/* ---------------------------------------------------------------- train.* */

implement(
  'train.session',
  async (ctx, input: { date: string }) => {
    const m = await loadCatalogueModules();
    const s = trainingSetupNow(m);
    const { plan, days } = prescribedDays([input.date], ctx.tz);
    if (!plan) ctx.notice({ level: 'info', text: 'There is no running plan, so no session is prescribed.' });
    const rx = days.get(input.date) ?? null;
    const sessions = rx ? composeDay(m, s, rx, input.date) : [];
    return {
      date: input.date,
      planId: plan?.id ?? null,
      rest: !!rx && rx.sessions.length === 0,
      sessions: sessions.map(sessionView),
      equipmentAnswered: equipmentAnswered(s.profile),
      unresolvedEquipment: [...s.unresolvedEquipment],
    };
  },
  BY,
);

implement(
  'train.alternatives',
  async (ctx, input: { exerciseId: string; date?: string }) => {
    const m = await loadCatalogueModules();
    const s = trainingSetupNow(m);
    if (!s.catalogue.exercise(input.exerciseId)) fail('not_found', `No exercise with id ${input.exerciseId}.`, { path: '/exerciseId' });
    const date = input.date ?? ctx.today;
    const rx = prescribedDays([date], ctx.tz).days.get(date) ?? null;
    const sessions = rx ? composeDay(m, s, rx, date) : [];
    // the prescribed dose of the exercise that day, when it is in a session; else its default dose
    let perf: PerformedExercise = { exerciseId: input.exerciseId };
    let startH = sessions[0]?.startH ?? 18;
    for (const c of sessions) {
      const it = c.session.items.find((x) => x.exerciseId === input.exerciseId);
      if (it) {
        perf = it.perf;
        startH = c.startH;
        break;
      }
    }
    const rows = m.cat.swapOptions(perf, { profile: s.profile, catalogue: s.catalogue, ctx: s.ctx, weekday: catalogueWeekday(date), startH, limit: 10 });
    return rows.map((a) => ({
      exerciseId: a.exerciseId,
      name: a.name,
      equipment: [...a.equipment],
      minutes: fin(a.minutes),
      credit: fin(a.equivalence.credit),
      score: fin(a.equivalence.score),
      band: a.equivalence.band,
      parity: a.equivalence.parity,
      shortfall: a.equivalence.shortfall.map((x) => x.text),
      perf: json(a.perf),
    }));
  },
  BY,
);

implement(
  'train.shoppingList',
  async (ctx, input: { planId?: string; kind?: string }) => {
    if ((input.planId === undefined) === (input.kind === undefined)) fail('invalid_input', 'Give exactly one of planId or kind.', { path: '' });
    const m = await loadCatalogueModules();
    const s = trainingSetupNow(m);
    const probe = prescribedDays([], ctx.tz).plan;
    let ideal = false;
    if (input.planId !== undefined) {
      if (!probe || probe.id !== input.planId) fail('not_found', 'Only the running plan’s shopping list is available here; the Planner lists each option’s.', { path: '/planId' });
    } else {
      ideal = input.kind === 'ideal';
      if (!probe || !(ideal || probe.rung === input.kind)) fail('not_found', `The running plan is not a ${input.kind} plan; the Planner lists each option’s shopping list.`, { path: '/kind' });
    }
    const plan = probe!;
    const from = compareDates(ctx.today, plan.startDate) < 0 ? plan.startDate : ctx.today;
    const dates = Array.from({ length: 7 }, (_, i) => addDays(from, i));
    const { days } = prescribedDays(dates, ctx.tz);
    const rxs: SessionPrescription[] = [];
    for (const date of dates) {
      const rx = days.get(date);
      if (!rx) continue;
      for (const p of rx.sessions)
        rxs.push((p.concrete as ConcreteSession | null)?.prescription ?? m.cat.prescriptionFromEngine(p.kind, p.engine, { weekday: catalogueWeekday(date), startH: p.startH, durationMin: p.durationMin }));
    }
    if (!rxs.length) return [];
    const items = m.cat.shoppingList(rxs, { profile: s.profile, catalogue: s.catalogue, ctx: s.ctx, ideal, limit: 10 });
    return items.map((x) => ({
      equipmentId: x.equipmentId,
      equipmentIds: [...x.equipmentIds],
      name: x.name,
      priceTier: x.priceTier,
      required: x.required,
      unlocks: [...x.unlocks],
      deltaUtility: fin(x.deltaUtility),
      score: fin(x.score),
      withinAllowance: x.withinAllowance,
      benefit: x.benefit.map((b) => ({ goal: b.goal, delta: fin(b.delta), unit: b.unit })),
      text: x.text,
    }));
  },
  BY,
);
