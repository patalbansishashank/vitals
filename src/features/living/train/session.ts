/**
 * Train view models (pure). The day's sessions as concrete exercises (the plan's composed session, or one composed here
 * with the catalogue when the plan carries none), plain-language prescriptions, energy with its likely range, the
 * equipment line, the in-progress session draft → what gets logged, swap and search lists, the week rows and the
 * shopping rows.
 *
 * The catalogue's pure functions are the engine side (composeSession, swapOptions, sessionEquivalence, boutEnergy,
 * shoppingList, resolveUnknownSync); nothing here invents a score, credit or band of its own.
 */
import {
  PATTERN_LABEL,
  REGION_LABEL,
  boutEnergy,
  composeSession,
  createCatalogue,
  draftToRecord,
  isWilling,
  resolveDose,
  resolveUnknownSync,
  sessionEquivalence,
  shoppingList,
  swapOptions,
  type Catalogue,
  type ConcreteItem,
  type ConcreteSession,
  type EquipmentItem,
  type EquivalenceResult,
  type ExerciseRecord,
  type MovementPattern,
  type PerformedExercise,
  type SessionPrescription,
  type StimulusContext,
  type SwapOption,
  type TrainingProfile,
  type TrainingRegion,
  type Weekday as CatalogueWeekday,
} from '@/catalogues';
import { SEED_CATALOGUE, SEED_INPUT } from '@/content/catalogues';
import { compareDates, weekdayOf } from '@/living/dates';
import type { LocalDate, PrescribedDaySnapshot, PrescribedSession, TodayView } from '@/living';
import { EQUIVALENCE_COPY, creditedTo, listWords, pctOf, verdictBand } from '../components/EquivalenceMeter';
import { fmtDay, fmtWeekday, kcal as fmtKcal } from '../format';
import { TRAIN_COPY } from './copy';

/** Everything the catalogue functions need. */
export interface TrainSetup {
  profile: TrainingProfile;
  ctx: StimulusContext;
  catalogue: Catalogue;
}

/* ------------------------------------------------------------------ words */

export function lowerFirst(s: string): string {
  return s.length > 1 && /[a-z]/.test(s[1]!) ? `${s[0]!.toLowerCase()}${s.slice(1)}` : s;
}

export function capFirst(s: string): string {
  return s ? `${s[0]!.toUpperCase()}${s.slice(1)}` : s;
}

/** "Dand (Hindu push-up)" → "dand"; "Mudgar swing, single heavy club two-handed" → "mudgar swing". */
export function shortName(name: string): string {
  const base = (name.split(' (')[0] ?? name).split(',')[0]!.trim();
  return lowerFirst(base || name);
}

/** Full catalogue name on first use in a list, the short name after. */
export function displayNames(items: ReadonlyArray<{ exerciseId: string; name: string }>): string[] {
  const seen = new Set<string>();
  return items.map((it) => {
    if (seen.has(it.exerciseId)) return shortName(it.name);
    seen.add(it.exerciseId);
    return it.name;
  });
}

/** "Mudgar, single heavy (two-hand)" → "mudgar"; "Yoga / exercise mat" → "exercise mat". */
export function equipmentShort(eq: Pick<EquipmentItem, 'name'>): string {
  let n = eq.name.replace(/\s*\([^)]*\)/g, '');
  n = n.split(',')[0]!;
  if (n.includes(' / ')) n = n.split(' / ').pop()!;
  n = n.split(/ (?:loaded|with|in) /)[0]!;
  return lowerFirst(n.trim() || eq.name);
}

function withArticle(n: string): { text: string; plural: boolean } {
  const plural = /[^s]s$/.test(n);
  return { text: plural ? n : `${/^[aeiou]/i.test(n) ? 'an' : 'a'} ${n}`, plural };
}

/** "needs a kettlebell (you don’t have one)". */
export function needsText(ids: readonly string[], catalogue: Catalogue): string {
  const parts = ids.map((id) => withArticle(equipmentShort(catalogue.equipmentItem(id) ?? { name: id.replace(/_/g, ' ') })));
  return TRAIN_COPY.swapSheet.needs(listWords(parts.map((p) => p.text)), parts.length > 1 || parts.some((p) => p.plural));
}

/** "today’s" on today, "Wednesday’s" on any other day. */
export function dayWord(date: LocalDate, today: LocalDate): string {
  return date === today ? TRAIN_COPY.todayWord : TRAIN_COPY.dayWord(fmtWeekday(date));
}

/** "today’s lift", "Wednesday’s dand". */
export function targetOf(date: LocalDate, today: LocalDate, what: string): string {
  return TRAIN_COPY.target(dayWord(date, today), what);
}

/** "12:30" / "1:02:05". */
export function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ the day's sessions */

/** Living dates are Monday-first (0 = Mon); the catalogue's weekday is Sunday-first (0 = Sun). */
export function catalogueWeekday(date: LocalDate): CatalogueWeekday {
  return ((weekdayOf(date) + 1) % 7) as CatalogueWeekday;
}

type EngineSession = PrescribedSession['engine'][number];
type EngineCardio = Extract<EngineSession, { kind: 'cardio' }>;
type EngineResistance = Extract<EngineSession, { kind: 'resistance' }>;

/** The catalogue prescription of a plan session (resistance: sets by region within its minutes; cardio: modality, minutes, intensity). */
export function prescriptionOf(s: PrescribedSession, date: LocalDate): SessionPrescription {
  const weekday = catalogueWeekday(date);
  if (s.kind === 'resistance') {
    const setsByRegion: Partial<Record<TrainingRegion, number>> = {};
    let rir: number | undefined;
    let load: number | undefined;
    for (const e of s.engine) {
      if (e.kind !== 'resistance') continue;
      const r = e as EngineResistance;
      for (const [k, v] of Object.entries(r.setsByRegion ?? {}) as Array<[TrainingRegion, number | undefined]>) setsByRegion[k] = (setsByRegion[k] ?? 0) + (v ?? 0);
      rir ??= r.rir;
      load ??= r.loadPct1RM;
    }
    return { kind: 'resistance', weekday, startH: s.startH, maxMin: s.durationMin, setsByRegion, ...(load !== undefined ? { loadPct1RM: load } : {}), ...(rir !== undefined ? { rir } : {}) };
  }
  const c = s.engine.find((e): e is EngineCardio => e.kind === 'cardio');
  return { kind: 'cardio', weekday, startH: s.startH, modality: c?.modality ?? 'walk', minutes: c?.durationMin ?? s.durationMin, pctVo2max: c?.pctVo2max ?? 0.6 };
}

export interface SessionModel {
  slotKey: string;
  kind: 'resistance' | 'cardio';
  startH: number;
  /** "lift", "walk", "run", … */
  noun: string;
  /** Minutes of the concrete session (warm-up included), else the plan slot's. */
  minutes: number;
  session: ConcreteSession;
  /** True when the plan carried no composed session and it was composed here from the catalogue. */
  composedHere: boolean;
  /** Adherence item id (`rtSession:<slotKey>` / `cardioSession:<slotKey>`). */
  itemId: string;
  /** Checklist row id (`session:<slotKey>`). */
  rowId: string;
}

export function itemIdOf(kind: 'resistance' | 'cardio', slotKey: string): string {
  return `${kind === 'resistance' ? 'rtSession' : 'cardioSession'}:${slotKey}`;
}

export function sessionNoun(kind: 'resistance' | 'cardio', modality: string | null): string {
  return kind === 'resistance' ? TRAIN_COPY.noun.resistance! : (TRAIN_COPY.noun[modality ?? 'other'] ?? TRAIN_COPY.noun.other!);
}

function modalityOf(s: PrescribedSession, session: ConcreteSession | null): string | null {
  if (s.kind !== 'cardio') return null;
  if (session?.prescription.kind === 'cardio') return session.prescription.modality;
  return s.engine.find((e): e is EngineCardio => e.kind === 'cardio')?.modality ?? 'other';
}

export function sessionModels(rx: PrescribedDaySnapshot | null, date: LocalDate, setup: TrainSetup): SessionModel[] {
  if (!rx) return [];
  return rx.sessions.map((s) => {
    const session = s.concrete ?? composeSession(prescriptionOf(s, date), { profile: setup.profile, catalogue: setup.catalogue, ctx: setup.ctx });
    return {
      slotKey: s.slotKey,
      kind: s.kind,
      startH: s.startH,
      noun: sessionNoun(s.kind, modalityOf(s, session)),
      minutes: session.items.length > 0 ? Math.max(1, Math.round(session.minutes)) : s.durationMin,
      session,
      composedHere: !s.concrete,
      itemId: itemIdOf(s.kind, s.slotKey),
      rowId: `session:${s.slotKey}`,
    };
  });
}

/** Status and credit of a session item as the source reports it. */
export function loggedStatus(view: TodayView | null, itemId: string): { status: 'done' | 'partial' | 'skipped' | 'unknown'; credit: number | null } {
  const it = view?.logged.items.find((x) => x.itemId === itemId);
  return { status: it?.status ?? 'unknown', credit: it?.credit ?? null };
}

/* ------------------------------------------------------------------ items in plain words */

export function isMinutesItem(item: Pick<ConcreteItem, 'sets'>): boolean {
  return item.sets === undefined;
}

/** Energy is shown for cardio-like items (minutes, cardio, or half-or-more cardio share). */
export function isCardioLike(item: Pick<ConcreteItem, 'sets'>, ex: ExerciseRecord | undefined): boolean {
  return isMinutesItem(item) || (!!ex && (ex.loadType === 'cardio' || ex.hybridCardioShare >= 0.5));
}

/** "6 × 20 · rest 60 s · leave 2 reps in the tank" (+ "≈ 95 kcal" for cardio-like items when energy is shown). */
export function rxWords(item: ConcreteItem, ex: ExerciseRecord | undefined, o: { energy: boolean }): string {
  const C = TRAIN_COPY.rx;
  const parts: string[] = [];
  if (isMinutesItem(item)) {
    parts.push(C.minutes(Math.max(1, Math.round(item.minutes))));
    if (item.perf.speedKmh) parts.push(C.speed(item.perf.speedKmh));
  } else {
    const n = item.sets ?? 0;
    let head = item.reps !== undefined ? C.sets(n, item.reps) : item.holdSec !== undefined ? C.holds(n, item.holdSec) : item.workSec !== undefined ? C.work(n, item.workSec) : C.rounds(n);
    if (item.loadKg !== undefined) head = `${head} ${C.load(item.loadKg)}`;
    parts.push(head);
    if (item.restSec) parts.push(C.rest(Math.round(item.restSec)));
    const rir = item.rir !== undefined ? Math.round(item.rir) : 0;
    if (rir >= 1) parts.push(C.tank(rir));
  }
  if (o.energy && isCardioLike(item, ex)) parts.push(C.kcal(fmtKcal(item.kcal)));
  return parts.join(' · ');
}

/** A concrete item for a performed instance (swaps, things done instead), resolved by the catalogue. */
export function concreteOf(ex: ExerciseRecord, perf: PerformedExercise, equipment: readonly string[], ctx: StimulusContext): ConcreteItem {
  const dose = resolveDose(ex, perf, ctx);
  const it: ConcreteItem = { exerciseId: ex.id, name: ex.name, equipment: [...equipment], minutes: dose.minutes, kcal: Math.round(dose.energy.netKcal), perf, text: '' };
  const setBased = perf.setCount !== undefined || (perf.sets?.length ?? 0) > 0 || (perf.minutes === undefined && ((ex.defaultDose.sets ?? ex.defaultDose.rounds ?? 0) > 0));
  if (!setBased) {
    it.met = perf.met ?? dose.energy.met;
    return it;
  }
  it.sets = perf.setCount ?? perf.sets?.length ?? ex.defaultDose.sets ?? ex.defaultDose.rounds ?? 1;
  const reps = perf.reps ?? perf.sets?.[0]?.reps ?? ex.defaultDose.reps;
  if (reps !== undefined) it.reps = reps;
  else if (ex.defaultDose.holdSec !== undefined) it.holdSec = ex.defaultDose.holdSec;
  else if ((ex.defaultDose.workSec ?? ex.defaultDose.durationSec) !== undefined) it.workSec = ex.defaultDose.workSec ?? ex.defaultDose.durationSec;
  if (perf.loadKg !== undefined) it.loadKg = perf.loadKg;
  it.rir = dose.meanRir;
  it.restSec = dose.restSec;
  return it;
}

/** Sum of the items' net energy with the catalogue's band (MET range or equation floor); ±20 % where an item has none. */
export function sessionEnergy(items: readonly ConcreteItem[], catalogue: Catalogue, ctx: StimulusContext): { value: number; lo: number; hi: number } {
  let v = 0;
  let lo = 0;
  let hi = 0;
  for (const it of items) {
    const ex = catalogue.exercise(it.exerciseId);
    if (ex) {
      const e = boutEnergy(ex, it.perf, it.minutes, ctx);
      v += e.netKcal;
      lo += e.netLow;
      hi += e.netHigh;
    } else {
      v += it.kcal;
      lo += it.kcal * 0.8;
      hi += it.kcal * 1.2;
    }
  }
  const r10 = (x: number) => Math.round(x / 10) * 10;
  return { value: r10(v), lo: r10(Math.min(lo, v)), hi: r10(Math.max(hi, v)) };
}

export function equipmentUsed(items: readonly ConcreteItem[]): string[] {
  return [...new Set(items.flatMap((i) => i.equipment))];
}

/** "10 kg mudgar and exercise mat" (owned weights from the profile), or null when nothing is needed. */
export function equipmentPhrase(ids: readonly string[], profile: TrainingProfile, catalogue: Catalogue): string | null {
  const names = ids
    .map((id) => {
      const eq = catalogue.equipmentItem(id);
      if (!eq) return null;
      const kg = profile.loadsKg?.[id]?.[0];
      return kg ? `${kg} kg ${equipmentShort(eq)}` : equipmentShort(eq);
    })
    .filter((x): x is string => !!x);
  return names.length > 0 ? listWords(names) : null;
}

/** Where the session happens that day: the first place whose equipment covers what it uses (owned items travel). */
export function placeOf(profile: TrainingProfile, date: LocalDate, equipment: readonly string[]): string | null {
  const wd = catalogueWeekday(date);
  const owned = new Set(profile.owned);
  const fit = profile.access.filter((a) => a.weekdays.includes(wd)).find((a) => equipment.every((q) => owned.has(q) || a.equipment.includes(q)));
  return fit ? (TRAIN_COPY.place[fit.place] ?? fit.place) : null;
}

/** "home · every day", "gym · Mon, Wed, Fri". */
export function placeLines(profile: TrainingProfile): string[] {
  return profile.access.map((a) => {
    const days = [...a.weekdays].sort((x, y) => ((x + 6) % 7) - ((y + 6) % 7));
    const when = days.length >= 7 ? TRAIN_COPY.equipment.everyDay : days.map((d) => TRAIN_COPY.weekdaysShort[d]).join(', ');
    return `${TRAIN_COPY.place[a.place] ?? a.place} · ${when}`;
  });
}

/** Footnote when injuries filter the catalogue (cleared ones excluded). */
export function injuryNote(profile: TrainingProfile): string | null {
  const cleared = new Set(profile.cleared ?? []);
  const words = [...new Set(profile.injuries.filter((i) => !cleared.has(i)).map((i) => TRAIN_COPY.injuryWords[i] ?? i.replace(/_/g, ' ')))];
  return words.length > 0 ? TRAIN_COPY.injury(listWords(words)) : null;
}

/** True when the person has said nothing about equipment or places (sessions are bodyweight). */
export function noEquipmentAnswered(profile: TrainingProfile): boolean {
  return profile.owned.length === 0 && profile.access.every((a) => a.equipment.length === 0);
}

/* ------------------------------------------------------------------ the session in progress */

export type LogStyle = 'quick' | 'detailed' | 'duration';

export interface SetLog {
  loadKg?: number;
  reps?: number;
  rir?: number;
}

export type ItemLog =
  | { kind: 'chips'; done: boolean[] }
  | { kind: 'sets'; sets: SetLog[] }
  | { kind: 'minutes'; minutes: number; speedKmh?: number; gradePct?: number };

/** A swap or a thing done instead of one item (applies to this day only). */
export interface SwapPick {
  exerciseId: string;
  name: string;
  equipment: string[];
  perf: PerformedExercise;
  equivalence: EquivalenceResult;
}

export interface SessionDraft {
  /** Items ticked "as planned". */
  ticks: Readonly<Record<number, true>>;
  skips: Readonly<Record<number, true>>;
  swaps: Readonly<Record<number, SwapPick>>;
  logs: Readonly<Record<number, ItemLog>>;
  style: LogStyle;
  /** Timer start (clock ms), when started. */
  startedAt: number | null;
  /** Re-opened after it was logged. */
  editing: boolean;
  /** The partial summary is showing before saving. */
  review: boolean;
}

export const EMPTY_DRAFT: SessionDraft = { ticks: {}, skips: {}, swaps: {}, logs: {}, style: 'quick', startedAt: null, editing: false, review: false };

export type ItemState = 'open' | 'done' | 'partial' | 'skipped';

/** The item as it will be done: the swap when there is one, else the plan's. */
export function effectiveItem(model: SessionModel, draft: SessionDraft, i: number, setup: TrainSetup): ConcreteItem {
  const base = model.session.items[i]!;
  const sw = draft.swaps[i];
  if (!sw) return base;
  const ex = setup.catalogue.exercise(sw.exerciseId);
  return ex ? concreteOf(ex, sw.perf, sw.equipment, setup.ctx) : { ...base, exerciseId: sw.exerciseId, name: sw.name, perf: sw.perf, equipment: [...sw.equipment] };
}

export function plannedSets(item: Pick<ConcreteItem, 'sets'>): number {
  return item.sets ?? 0;
}

export function itemState(draft: SessionDraft, i: number, item: ConcreteItem): ItemState {
  if (draft.skips[i]) return 'skipped';
  if (draft.ticks[i]) return 'done';
  const log = draft.logs[i];
  if (!log) return 'open';
  if (log.kind === 'chips') {
    const n = log.done.filter(Boolean).length;
    return n === 0 ? 'open' : n >= plannedSets(item) ? 'done' : 'partial';
  }
  if (log.kind === 'sets') return log.sets.length === 0 ? 'open' : log.sets.length >= plannedSets(item) ? 'done' : 'partial';
  return log.minutes >= 0.9 * item.minutes ? 'done' : 'partial';
}

/** What an item log means as a catalogue instance (null = nothing done). */
export function performedFromLog(item: ConcreteItem, log: ItemLog): PerformedExercise | null {
  const base: PerformedExercise = {
    exerciseId: item.perf.exerciseId ?? item.exerciseId,
    ...(item.perf.freeText ? { freeText: item.perf.freeText } : {}),
    ...(item.equipment.length > 0 ? { equipmentUsed: item.equipment } : {}),
  };
  if (log.kind === 'chips') {
    const n = log.done.filter(Boolean).length;
    return n === 0 ? null : { ...item.perf, setCount: n };
  }
  if (log.kind === 'sets') {
    if (log.sets.length === 0) return null;
    return {
      ...base,
      ...(item.restSec ? { restSec: item.restSec } : {}),
      sets: log.sets.map((s) => ({
        ...(s.reps !== undefined ? { reps: s.reps } : item.reps !== undefined ? { reps: item.reps } : {}),
        ...(s.reps === undefined && item.reps === undefined && item.holdSec !== undefined ? { holdSec: item.holdSec } : {}),
        ...(s.loadKg !== undefined ? { loadKg: s.loadKg } : {}),
        ...(s.rir !== undefined ? { rir: s.rir } : {}),
      })),
    };
  }
  return {
    ...base,
    minutes: log.minutes,
    ...(log.speedKmh !== undefined ? { speedKmh: log.speedKmh } : {}),
    ...(log.gradePct !== undefined ? { gradePct: log.gradePct } : {}),
    ...(log.speedKmh === undefined && item.perf.met !== undefined ? { met: item.perf.met } : {}),
  };
}

export interface SessionLogPlan {
  prescribed: PerformedExercise[];
  performed: PerformedExercise[];
  done: number;
  total: number;
  skipped: number;
  partialItems: number;
  result: EquivalenceResult;
  status: 'done' | 'partial' | 'skipped';
}

/** "Session done": every item not ticked, logged or skipped counts as planned; the credit is the catalogue's equivalence. */
export function sessionLogPlan(model: SessionModel, draft: SessionDraft, setup: TrainSetup): SessionLogPlan {
  const prescribed = model.session.items.map((i) => i.perf);
  const performed: PerformedExercise[] = [];
  let done = 0;
  let skipped = 0;
  let partialItems = 0;
  model.session.items.forEach((_, i) => {
    const item = effectiveItem(model, draft, i, setup);
    const st = itemState(draft, i, item);
    if (st === 'skipped') {
      skipped++;
      return;
    }
    const log = draft.ticks[i] ? undefined : draft.logs[i];
    performed.push((log ? performedFromLog(item, log) : null) ?? item.perf);
    done++;
    if (st === 'partial') partialItems++;
  });
  const result = sessionEquivalence(prescribed, performed, setup.catalogue, setup.ctx);
  const status = done === 0 ? 'skipped' : result.parity ? 'done' : 'partial';
  return { prescribed, performed, done, total: model.session.items.length, skipped, partialItems, result, status };
}

/** The summary shows before saving when the session is not counted in full or anything was left out. */
export function needsReview(p: SessionLogPlan): boolean {
  return p.status !== 'done' || p.skipped > 0 || p.partialItems > 0;
}

/** What a save returned, for the verdict under the session. */
export interface SavedResult {
  status: 'done' | 'partial' | 'skipped';
  result: EquivalenceResult | null;
}

/**
 * After saving: "Counts as today’s lift · 96 %" · "Partly · Chest work is short: add 1 set." · "Different work —
 * credited to shoulders and upper back; today’s lift is still open." plus "also trained: trunk".
 */
export function savedLines(s: SavedResult, target: string): { line: string; also: string | null } {
  if (s.status === 'skipped' || !s.result) return { line: TRAIN_COPY.saved.skipped(target), also: null };
  const r = s.result;
  const band = verdictBand(r.score);
  const also = band !== 'different' && r.alsoTrained.length > 0 ? TRAIN_COPY.saved.also(listWords(r.alsoTrained.map((x) => REGION_LABEL[x]))) : null;
  if (band === 'full') return { line: TRAIN_COPY.saved.full(target, pctOf(r.score)), also };
  if (band === 'partial') return { line: TRAIN_COPY.saved.partial(r.shortfall[0]?.text ?? `${capFirst(EQUIVALENCE_COPY.addSet)}.`), also };
  return { line: TRAIN_COPY.saved.different(creditedTo(r), target), also: null };
}

/* ------------------------------------------------------------------ swaps */

export interface SwapRow {
  option: SwapOption;
  /** The option as a concrete item (dose words). */
  item: ConcreteItem;
  /** Equipment it needs that the person doesn't have (empty = available). */
  needs: string[];
}

function availableEquipment(profile: TrainingProfile): Set<string> {
  return new Set([...profile.owned, ...profile.access.flatMap((a) => a.equipment)]);
}

export function missingEquipment(ids: readonly string[], profile: TrainingProfile): string[] {
  const have = availableEquipment(profile);
  return ids.filter((q) => !have.has(q));
}

/**
 * Swap alternatives for a prescribed item (the plan's, not a current swap): what the person can do on their equipment,
 * ranked by credit then by what they like (the catalogue's order), and — for "show all" — the ones that need equipment
 * they don't have.
 */
export function swapRows(item: ConcreteItem, date: LocalDate, startH: number, setup: TrainSetup): { available: SwapRow[]; needing: SwapRow[] } {
  const base = { profile: setup.profile, catalogue: setup.catalogue, ctx: setup.ctx, weekday: catalogueWeekday(date), startH };
  const toRow = (o: SwapOption): SwapRow => {
    const ex = setup.catalogue.exercise(o.exerciseId);
    return { option: o, item: ex ? concreteOf(ex, o.perf, o.equipment, setup.ctx) : { ...item, exerciseId: o.exerciseId, name: o.name, perf: o.perf }, needs: missingEquipment(o.equipment, setup.profile) };
  };
  const available = swapOptions(item.perf, { ...base, limit: 8 }).map(toRow);
  const ids = new Set(available.map((r) => r.option.exerciseId));
  const needing = swapOptions(item.perf, { ...base, fullCatalogue: true, limit: 16 })
    .filter((o) => !ids.has(o.exerciseId))
    .map(toRow)
    .filter((r) => r.needs.length > 0);
  return { available, needing };
}

export function swapParam(slotKey: string, index: number): string {
  return `${slotKey}:${index}`;
}

/** `?swap=:slotKey:itemIndex` (the slot key itself may contain ":"). */
export function parseSwapParam(v: string | null): { slotKey: string; index: number } | null {
  if (!v) return null;
  const k = v.lastIndexOf(':');
  if (k <= 0) return null;
  const index = Number(v.slice(k + 1));
  if (!Number.isInteger(index) || index < 0) return null;
  return { slotKey: v.slice(0, k), index };
}

/* ------------------------------------------------------------------ something else */

export interface DoneText {
  name: string;
  sets?: number;
  reps?: number;
  minutes?: number;
}

/** "wooden wheel rollouts 3 × 10" → name + 3 sets of 10; "stairs 20 min" → name + 20 minutes. */
export function parseDone(text: string): DoneText {
  let t = ` ${text} `;
  const out: DoneText = { name: '' };
  const sr = /(\d+)\s*[x×]\s*(\d+)/i.exec(t);
  if (sr) {
    out.sets = Number(sr[1]);
    out.reps = Number(sr[2]);
    t = t.replace(sr[0], ' ');
  }
  const mn = /(\d+(?:\.\d+)?)\s*(?:min|mins|minutes)\b/i.exec(t);
  if (mn) {
    out.minutes = Number(mn[1]);
    t = t.replace(mn[0], ' ');
  }
  out.name = t.replace(/[,;:·-]+\s*$/, '').replace(/\s+/g, ' ').trim();
  return out;
}

/** Equipment for an exercise is owned or accessible (or it needs none). */
export function hasEquipmentFor(ex: ExerciseRecord, profile: TrainingProfile): boolean {
  const have = availableEquipment(profile);
  return ex.equipmentAnyOf.some((alt) => alt.every((q) => have.has(q)));
}

/** Catalogue search (names and aliases), the ones the person is willing and equipped to do first. */
export function searchDone(query: string, catalogue: Catalogue, profile: TrainingProfile, limit = 8): Array<{ ex: ExerciseRecord; ready: boolean }> {
  const q = parseDone(query).name || query.trim();
  if (!q) return [];
  return catalogue
    .searchExercises(q, Math.max(limit, 12))
    .map((ex) => ({ ex, ready: isWilling(ex, { profile }) && hasEquipmentFor(ex, profile) }))
    .sort((a, b) => Number(b.ready) - Number(a.ready))
    .slice(0, limit);
}

/** Minutes are its natural unit (cardio, mobility, flows, circuits). */
export function isMinutesExercise(ex: ExerciseRecord): boolean {
  return ex.loadType === 'cardio' || ex.loadType === 'mobility' || ex.volumeUnit === 'minutes' || ex.volumeUnit === 'distanceOrTime' || !((ex.defaultDose.sets ?? ex.defaultDose.rounds ?? 0) > 0);
}

export interface DoneDose {
  sets?: number;
  reps?: number;
  minutes?: number;
}

/** The dose to start from: what was typed, else the exercise's default. */
export function defaultDoneDose(ex: ExerciseRecord, typed: DoneText | null): DoneDose {
  if (isMinutesExercise(ex) && typed?.sets === undefined) return { minutes: typed?.minutes ?? ex.defaultDose.durationMin ?? 20 };
  const reps = typed?.reps ?? ex.defaultDose.reps;
  return { sets: typed?.sets ?? ex.defaultDose.sets ?? ex.defaultDose.rounds ?? 3, ...(reps !== undefined ? { reps } : {}) };
}

export function perfFor(ex: ExerciseRecord, dose: DoneDose, freeText?: string): PerformedExercise {
  const p: PerformedExercise =
    dose.minutes !== undefined && dose.sets === undefined
      ? { exerciseId: ex.id, minutes: dose.minutes }
      : { exerciseId: ex.id, setCount: dose.sets ?? 1, ...(dose.reps !== undefined ? { reps: dose.reps } : {}) };
  return freeText ? { ...p, freeText } : p;
}

export function userExerciseId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `user-${slug || 'exercise'}`;
}

/**
 * Free text → a catalogue record: an exact catalogue match, else a draft resolved from the closest seed template and
 * made into a temporary record (never rejected). TODO(E8/E4): persist new records through `catalogue.addExercise`.
 */
export function resolveTyped(text: string, catalogue: Catalogue): { record: ExerciseRecord; isNew: boolean; typed: DoneText } {
  const typed = parseDone(text);
  const name = typed.name || text.trim();
  const draft = resolveUnknownSync(name, text.trim(), catalogue);
  if (draft.resolvedBy === 'catalogue' && draft.basedOn) {
    const ex = catalogue.exercise(draft.basedOn);
    if (ex) return { record: ex, isNew: false, typed };
  }
  return { record: draftToRecord(draft, { id: userExerciseId(name), origin: 'user' }), isNew: true, typed };
}

/** The catalogue (default the seed), with the person's own records from this session added (they win on id clashes). */
export function catalogueWith(records: readonly ExerciseRecord[], base: Catalogue = SEED_CATALOGUE): Catalogue {
  if (records.length === 0) return base;
  return createCatalogue(base === SEED_CATALOGUE ? SEED_INPUT : base, { exercises: records });
}

/* ------------------------------------------------------------------ the week */

export type WeekStatus = 'done' | 'partial' | 'skipped' | 'unknown' | 'planned';

export interface WeekRow {
  date: LocalDate;
  day: string;
  rest: boolean;
  outside: boolean;
  sessions: Array<{ slotKey: string; noun: string; minutes: number; status: WeekStatus }>;
}

/**
 * The week list. With `setup`, sessions the plan carries no composed session for are composed as the day view composes
 * them, so the minutes match the session ("lift · 36 min" on both; QA LIV-11).
 */
export function weekRows(dates: readonly LocalDate[], views: ReadonlyArray<TodayView | null>, today: LocalDate, setup?: TrainSetup): WeekRow[] {
  return dates.map((date, k) => {
    const v = views[k] ?? null;
    const rx = v?.prescription ?? null;
    const future = compareDates(date, today) > 0;
    const models = setup && rx ? sessionModels(rx, date, setup) : null;
    const sessions = (rx?.sessions ?? []).map((s, j) => {
      const st = loggedStatus(v, itemIdOf(s.kind, s.slotKey)).status;
      const m = models?.[j];
      return {
        slotKey: s.slotKey,
        noun: m?.noun ?? sessionNoun(s.kind, modalityOf(s, s.concrete)),
        minutes: m?.minutes ?? (s.concrete && s.concrete.items.length > 0 ? Math.max(1, Math.round(s.concrete.minutes)) : s.durationMin),
        status: (future && st === 'unknown' ? 'planned' : st) as WeekStatus,
      };
    });
    return { date, day: fmtDay(date), rest: !!rx && sessions.length === 0, outside: !rx, sessions };
  });
}

/** Every session prescription of the given days (the plan's shopping list is per plan week). */
export function weekPrescriptions(dates: readonly LocalDate[], views: ReadonlyArray<TodayView | null>): SessionPrescription[] {
  const out: SessionPrescription[] = [];
  dates.forEach((d, k) => {
    for (const s of views[k]?.prescription?.sessions ?? []) out.push(s.concrete?.prescription ?? prescriptionOf(s, d));
  });
  return out;
}

/* ------------------------------------------------------------------ things to buy */

export interface ShopRow {
  key: string;
  ids: string[];
  name: string;
  tier: number;
  /** "adds pulling work" */
  unlocks: string;
  required: boolean;
  /** "+0.4 kg muscle", when the planner filled it. */
  benefit: string | null;
}

const MODALITY_WORK: Readonly<Record<string, string>> = { walk: 'walking', run: 'running', cycle: 'cycling', swim: 'swimming', row: 'rowing', hiit: 'interval', other: 'cardio' };

export function shopRows(prescriptions: readonly SessionPrescription[], setup: TrainSetup): ShopRow[] {
  if (prescriptions.length === 0) return [];
  const items = shoppingList(prescriptions, { profile: setup.profile, catalogue: setup.catalogue, ctx: setup.ctx, limit: 3 });
  return items.map((s) => {
    const words = [
      ...new Set(
        s.unlocks.map((u) => (u.startsWith('cardio:') ? (MODALITY_WORK[u.slice(7)] ?? 'cardio') : (PATTERN_LABEL[u as MovementPattern] ?? u))),
      ),
    ].slice(0, 2);
    const name = s.equipmentIds.map((id) => setup.catalogue.equipmentItem(id)?.name ?? id).join(' + ');
    return {
      key: s.equipmentIds.join('+'),
      ids: s.equipmentIds,
      name,
      tier: s.priceTier,
      unlocks: words.length > 0 ? TRAIN_COPY.equipment.adds(listWords(words)) : TRAIN_COPY.equipment.shorter,
      required: s.required,
      benefit: s.benefit.length > 0 ? s.benefit.map((b) => `${b.delta > 0 ? '+' : ''}${b.delta} ${b.unit}`).join(' · ') : null,
    };
  });
}
