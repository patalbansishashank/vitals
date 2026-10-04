/**
 * Equipment-aware prescription (PLANNER_V2_SPEC §8; E8's catalogues own the composer, the envelope, the shopping list and
 * the stimulus mapping, docs/CATALOGUES.md). Pure and deterministic; no engine runs except through the injected
 * `goalDelta` callback.
 *
 * - `equipmentEnvelope(ctx)`: what the person's equipment can deliver (§8.2), read from `request.training` (E8
 *   `TrainingProfile`). Without a profile every function here is a no-op and the v1 dose model is unchanged. The grammar
 *   and the decoder bound `rt.sets` by it (`equipmentSetsCap`) and use 82 % 1RM for strength goals only when some
 *   region can be loaded to ≥ 80 % (`equipmentHeavyOk`). The Ideal (and a shadow-price run that relaxes the `equipment`
 *   group) uses the full-catalogue envelope.
 * - `equipmentFor(ctx, schedule, opts)`: composes the plan's training sessions into exercises (§8.3, previous-14-days
 *   rotation), writes the composed sessions' delivered sets (and MET) into the schedule so the simulated dose is the dose
 *   the person is told, judges feasibility (composer tolerance), and builds the shopping list (§8.5).
 * - `purchaseBurden(items)`: each required purchase adds 0.05 to the habit-distance burden (§8.4).
 */
import { DEFAULTS, RT_PRESETS } from '../../core/defaults';
import { selectorIndexFor } from '../../core/resolveProfile';
import { ACTIVITY_PARAMS } from '../../model/activity/params';
import type { CardioModality, CardioSession, DayTemplate, ExerciseSession, ResistanceSession, Schedule, ScheduleDay, TrainingRegion } from '../../types/schedule';
import {
  composeSession,
  fLoad,
  fRest,
  fRir,
  shoppingList,
  trainingEnvelope,
  CARDIO_MODALITIES,
  PATTERN_LABEL,
  REGION_LABEL,
  REGIONS,
  type Catalogue,
  type ComposeOptions,
  type ConcreteSession,
  type MovementPattern,
  type SessionPrescription,
  type ShoppingItem,
  type StimulusContext,
  type TrainingProfile,
  type Weekday as CatalogueWeekday,
} from '@/catalogues';
import { SEED_CATALOGUE } from '@/content/catalogues';
import type { PlanningContext } from './context';
import { mergeDay } from './dayMath';
import type { PlannerRequestV2, ShoppingItemV2 } from './types';

/** §8.4 [PROPOSED]: each required purchase adds this to the habit-distance burden c₇. */
export const PURCHASE_BURDEN_PER_ITEM = 0.05;
/** §8.2: strength goals use 82 % 1RM only when some region can be loaded to at least this. */
export const HEAVY_LOAD_PCT = 80;
/** §8.3 composer tolerances (E8 `catalogue.sessionSetTolerance`, `catalogue.weekTolerance`). */
export const SESSION_SET_TOLERANCE = 0.5;
export const WEEK_TOLERANCE = 0.1;
/** Rotation window of the composer (§8.3: the previous 14 days of composed sessions). */
export const HISTORY_DAYS = 14;
/** Shopping rows whose benefit is re-run through `goalDelta` (§8.5: the top 3). */
export const BENEFIT_TOP = 3;

// ---------------------------------------------------------------------------------------------------------------
// profile, options, envelope
// ---------------------------------------------------------------------------------------------------------------

/** The request's training profile (E8 `TrainingProfile`), or null (then everything here is a no-op). */
export function trainingProfileOf(ctx: PlanningContext): TrainingProfile | null {
  return (ctx.request as PlannerRequestV2).training ?? null;
}

/** The Ideal, and a shadow-price run relaxing the `equipment` group, use the full catalogue (§2.1, §8.2). */
export function fullCatalogueRequest(ctx: PlanningContext): boolean {
  const r = ctx.request;
  return r.ideal === true || (r.relaxedGroups ?? []).includes('equipment');
}

/** Effective-set factor of a counted set at this RIR, load and rest (the engine's f_RIR·f_load·f_rest, read via E8). */
export function effectiveFactor(rir: number, loadPct: number, restSec: number): number {
  return fRir(rir, loadPct) * fLoad(loadPct) * fRest(restSec);
}

function param(id: string): number {
  const d = ACTIVITY_PARAMS.find((p) => p.id === id);
  if (!d) throw new Error(`activity param ${id} not found`);
  return d.value;
}

/**
 * VO2max for the composer's cardio intensities: measured, else the activity module's non-exercise estimate (Jackson
 * equation with the PA-R of the selector row, same parameters and rule as the module's `prepare`).
 */
export function vo2maxEstimate(ctx: PlanningContext): number {
  const rp = ctx.rp;
  let v = rp.labs.vo2maxMlKgMin ?? Number.NaN;
  if (!(v > 0)) {
    const par = [param('activity.parSedentary'), param('activity.parLight'), param('activity.parModerate'), param('activity.parActive'), param('activity.parVeryActive')][Math.min(4, selectorIndexFor(rp))]!;
    const male = rp.input.sexUnspecified ? 0.5 : rp.sex === 'male' ? 1 : 0;
    const bmi = rp.weightKg / (rp.heightM * rp.heightM);
    v =
      param('activity.jacksonIntercept') + param('activity.jacksonPar') * par + param('activity.jacksonAge') * rp.ageYears + param('activity.jacksonBmi') * bmi + param('activity.jacksonSex') * male;
  }
  return Math.min(90, Math.max(10, v));
}

export function stimulusContext(ctx: PlanningContext, vo2max?: number): StimulusContext {
  return { bodyMassKg: ctx.rp.weightKg, vo2max: vo2max ?? vo2maxEstimate(ctx), heightM: ctx.rp.heightM, rmrKcalPerDay: ctx.rp.rmr0Kcal };
}

function composeOptions(ctx: PlanningContext, profile: TrainingProfile, o: { ideal: boolean; catalogue: Catalogue; vo2max?: number }): ComposeOptions {
  const x = ctx.caps.exercise;
  return {
    profile,
    catalogue: o.catalogue,
    ctx: stimulusContext(ctx, o.vo2max),
    // HC-X4 (light-moderate only / low impact): no high-impact items
    allowImpact: !(x.lowImpact || x.lightModerateOnly),
    fullCatalogue: o.ideal,
  };
}

/** What the equipment can deliver (§8.2), in the planner's terms. */
export interface EquipmentBounds {
  /** Full-catalogue envelope (Ideal / equipment group relaxed). */
  ideal: boolean;
  /** Purchasable items within the allowance counted as available (rungs with an allowance). */
  includesPurchases: boolean;
  /** Upper bound of effective sets one session can deliver, per region (E8 envelope). */
  maxEffectiveSetsPerSession: Partial<Record<TrainingRegion, number>>;
  /** Regions no available exercise trains directly. */
  uncoveredRegions: TrainingRegion[];
  /** max over the regions of `maxEffectiveSetsPerSession`: beyond it no region gets more (bounds the `rt.sets` gene). */
  bestEffectiveSetsPerSession: number;
  /** Highest %1RM reachable in any region. */
  maxLoadPct: number;
  /** Some region can be loaded to ≥ 80 % 1RM (strength goals keep 82 % 1RM). */
  heavyReachable: boolean;
  loadLimitedRegions: TrainingRegion[];
  /** Cardio modalities some available, willing item delivers. */
  cardioModalities: CardioModality[];
  patterns: MovementPattern[];
}

const ENVELOPES = new WeakMap<object, Map<string, EquipmentBounds | null>>();
/** Fast path for the decoder (default options, asked once per region and day): one entry per context object. */
const BY_CTX = new WeakMap<PlanningContext, EquipmentBounds | null>();

/**
 * Equipment envelope (§8.2), null without a training profile. `ideal` defaults to the request's own mode (Ideal or a
 * relaxed `equipment` group → full catalogue). Cached per request object, so the decoder can ask on every evaluation.
 */
export function equipmentEnvelope(ctx: PlanningContext, opts: { ideal?: boolean; catalogue?: Catalogue } = {}): EquipmentBounds | null {
  const profile = trainingProfileOf(ctx);
  if (!profile) return null;
  if (opts.ideal === undefined && opts.catalogue === undefined) {
    const hit = BY_CTX.get(ctx);
    if (hit !== undefined) return hit;
    const b = equipmentEnvelope(ctx, { ideal: fullCatalogueRequest(ctx) });
    BY_CTX.set(ctx, b);
    return b;
  }
  const ideal = opts.ideal ?? fullCatalogueRequest(ctx);
  const key = `${ideal ? 1 : 0}|${ctx.practical.maxSessionMin}`;
  const cacheable = opts.catalogue === undefined || opts.catalogue === SEED_CATALOGUE;
  if (cacheable) {
    const hit = ENVELOPES.get(ctx.request)?.get(key);
    if (hit !== undefined) return hit;
  }
  const catalogue = opts.catalogue ?? SEED_CATALOGUE;
  const allow = profile.purchaseAllowance;
  const includePurchases = !ideal && allow.maxItems > 0;
  const env = trainingEnvelope({ ...composeOptions(ctx, profile, { ideal, catalogue }), maxMinPerSession: ctx.practical.maxSessionMin, includePurchases });
  const covered = REGIONS.filter((r) => (env.maxEffectiveSetsPerSession[r] ?? 0) > 0);
  let maxLoad = 0;
  for (const r of REGIONS) maxLoad = Math.max(maxLoad, env.maxLoadPct[r] ?? 0);
  const bounds: EquipmentBounds = {
    ideal,
    includesPurchases: includePurchases,
    maxEffectiveSetsPerSession: { ...env.maxEffectiveSetsPerSession },
    uncoveredRegions: REGIONS.filter((r) => !covered.includes(r)),
    bestEffectiveSetsPerSession: covered.length ? Math.max(...covered.map((r) => env.maxEffectiveSetsPerSession[r]!)) : 0,
    maxLoadPct: maxLoad,
    heavyReachable: maxLoad >= HEAVY_LOAD_PCT - 1e-9,
    loadLimitedRegions: [...env.loadLimitedRegions],
    cardioModalities: CARDIO_MODALITIES.filter((m) => env.cardioModalities[m] !== undefined),
    patterns: [...env.patterns],
  };
  if (cacheable) {
    let m = ENVELOPES.get(ctx.request);
    if (!m) ENVELOPES.set(ctx.request, (m = new Map()));
    m.set(key, bounds);
  }
  return bounds;
}

/**
 * Upper bound of the `rt.sets` gene (counted sets per region per week at the planner's prescription: RIR 2, `loadPct`,
 * default rest) that `sessions` sessions can deliver in the best-equipped region (more helps no region); Infinity without
 * a profile. Each region is then limited on its own by `equipmentRegionCap`.
 */
export function equipmentSetsCap(ctx: PlanningContext, sessions: number, loadPct: number = DEFAULTS.rtLoadPct1RM): number {
  const b = equipmentEnvelope(ctx);
  if (!b) return Number.POSITIVE_INFINITY;
  return (b.bestEffectiveSetsPerSession / effectiveFactor(DEFAULTS.rtRir, loadPct, DEFAULTS.rtRestSec)) * Math.max(0, sessions);
}

/**
 * Counted sets of one session the equipment can deliver for `region` at the planner's prescription (RIR 2, `loadPct`,
 * default rest): the decoder writes min(uniform dose, this) per region (§8.2 "rt.sets per region"); 0 for a region
 * nothing available trains directly; Infinity without a profile.
 */
export function equipmentRegionCap(ctx: PlanningContext, region: TrainingRegion, loadPct: number = DEFAULTS.rtLoadPct1RM): number {
  const b = equipmentEnvelope(ctx);
  if (!b) return Number.POSITIVE_INFINITY;
  return (b.maxEffectiveSetsPerSession[region] ?? 0) / effectiveFactor(DEFAULTS.rtRir, loadPct, DEFAULTS.rtRestSec);
}

/** Strength goals keep 82 % 1RM and the heavy-compound style only when the equipment reaches ≥ 80 % 1RM (§8.2). */
export function equipmentHeavyOk(ctx: PlanningContext): boolean {
  const b = equipmentEnvelope(ctx);
  return b === null || b.heavyReachable;
}

/** §8.4: required purchases (price tier > 0) add 0.05 each to the habit-distance burden (input to the difficulty). */
export function purchaseBurden(items: ReadonlyArray<Pick<ShoppingItemV2, 'required' | 'priceTier'>>): number {
  return PURCHASE_BURDEN_PER_ITEM * items.filter((i) => i.required && i.priceTier > 0).length;
}

// ---------------------------------------------------------------------------------------------------------------
// slots: the distinct training days of the schedule (weekday × sessions), with their composer prescriptions
// ---------------------------------------------------------------------------------------------------------------

interface Slot {
  /** Planner weekday (0 = Monday). */
  weekday: number;
  /** Day indices (ascending) that carry exactly these sessions on this weekday. */
  days: number[];
  sessions: ExerciseSession[];
  /** One prescription per session (same order); resistance targets limited to what the equipment can deliver. */
  rxs: SessionPrescription[];
  /** The same with the planner's full targets (shopping list and benefit runs value items that cover the cut regions). */
  rxsFull: SessionPrescription[];
  /** Per session: regions whose target was cut to zero (nothing available trains them) or lowered to the envelope. */
  cut: TrainingRegion[];
  reduced: TrainingRegion[];
}

const isoDay = (start: string, d: number): string => new Date(Date.parse(`${start}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
/** Planner weekday (0 = Monday) → catalogue weekday (0 = Sunday). */
export const catalogueWeekday = (w: number): CatalogueWeekday => ((w + 1) % 7) as CatalogueWeekday;
const r3 = (x: number): number => Math.round(x * 1000) / 1000;

function countedSets(s: ResistanceSession): Partial<Record<TrainingRegion, number>> {
  if (s.setsByRegion) return s.setsByRegion;
  const p = RT_PRESETS[s.volume ?? 'moderate'];
  const per = p.setsPerRegionWeek / p.sessionsPerWeek;
  const out: Partial<Record<TrainingRegion, number>> = {};
  for (const r of REGIONS) out[r] = per;
  return out;
}

function collectSlots(ctx: PlanningContext, schedule: Schedule, bounds: EquipmentBounds | null, vo2max: number): Slot[] {
  const byKey = new Map<string, Slot>();
  const order: Slot[] = [];
  const maxMin = ctx.practical.maxSessionMin;
  for (let d = 0; d < schedule.horizonDays; d++) {
    const sd = schedule.days[d];
    if (!sd) continue;
    const t = mergeDay(schedule.programs[sd.program]!, sd.override);
    const ex = (t.exercise ?? []).filter((s) => s.kind === 'resistance' || s.kind === 'cardio');
    if (ex.length === 0) continue;
    const weekday = (ctx.startWeekday + d) % 7;
    const key = `${weekday}|${JSON.stringify(ex)}`;
    let slot = byKey.get(key);
    if (!slot) {
      const date = isoDay(schedule.startDate, d);
      const cut = new Set<TrainingRegion>();
      const reduced = new Set<TrainingRegion>();
      const rxsFull: SessionPrescription[] = [];
      const rxs: SessionPrescription[] = ex.map((s): SessionPrescription => {
        if (s.kind === 'resistance') {
          const rir = s.rir ?? (s.setsByRegion ? DEFAULTS.rtRir : 0);
          const load = s.loadPct1RM ?? DEFAULTS.rtLoadPct1RM;
          const f = effectiveFactor(rir, load, s.restSec ?? DEFAULTS.rtRestSec);
          const counted = countedSets(s);
          const target: Partial<Record<TrainingRegion, number>> = {};
          const full: Partial<Record<TrainingRegion, number>> = {};
          // the planner doses every region alike; the decoder already limited each region to the envelope, so a region
          // below the session's top dose was cut (nothing trains it directly) or reduced by the equipment
          let top = 0;
          for (const r of REGIONS) top = Math.max(top, (counted[r] ?? 0) * f);
          for (const r of REGIONS) {
            let v = (counted[r] ?? 0) * f;
            const cap = bounds ? (bounds.maxEffectiveSetsPerSession[r] ?? 0) : Number.POSITIVE_INFINITY;
            const isCut = top > 0 && cap <= 0;
            const isReduced = !isCut && top > cap + SESSION_SET_TOLERANCE;
            if (isCut) cut.add(r);
            if (isReduced) reduced.add(r);
            const want = isCut || isReduced ? Math.max(v, top) : v;
            if (want > 0) full[r] = r3(want);
            v = Math.min(v, cap);
            if (v > 0) target[r] = r3(v);
          }
          const rx: SessionPrescription = { kind: 'resistance', weekday: catalogueWeekday(weekday), startH: s.startH, maxMin, setsByRegion: target, loadPct1RM: load, rir, date };
          rxsFull.push({ ...rx, setsByRegion: full });
          return rx;
        }
        const c = s as CardioSession;
        const pct = c.pctVo2max ?? (c.met !== undefined ? (c.met * 3.5) / vo2max : DEFAULTS.cardioPctVo2max[c.modality]);
        const rx: SessionPrescription = {
          kind: 'cardio',
          weekday: catalogueWeekday(weekday),
          startH: c.startH,
          modality: c.modality,
          minutes: c.durationMin,
          pctVo2max: pct,
          maxMin: Math.max(c.durationMin, Math.min(Math.ceil(1.5 * c.durationMin), maxMin)),
          date,
        };
        rxsFull.push(rx);
        return rx;
      });
      slot = { weekday, days: [], sessions: ex, rxs, rxsFull, cut: [...cut], reduced: [...reduced] };
      byKey.set(key, slot);
      order.push(slot);
    }
    slot.days.push(d);
  }
  return order;
}

/** Compose every slot in order of first appearance; each sees the sessions composed for the previous 14 days. */
function composeSlots(slots: readonly Slot[], o: ComposeOptions): ConcreteSession[][] {
  const out: ConcreteSession[][] = [];
  for (let i = 0; i < slots.length; i++) {
    const d0 = slots[i]!.days[0]!;
    const hist: Array<{ day: number; j: number; s: ConcreteSession }> = [];
    for (let j = 0; j < i; j++) for (const d of slots[j]!.days) if (d >= d0 - HISTORY_DAYS && d < d0) for (const s of out[j]!) hist.push({ day: d, j, s });
    hist.sort((a, b) => a.day - b.day || a.j - b.j);
    const history = hist.map((h) => h.s);
    const own: ConcreteSession[] = [];
    for (const rx of slots[i]!.rxs) {
      const s = composeSession(rx, { ...o, history: [...history, ...own] });
      own.push(s);
    }
    out.push(own);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// feasibility (§8.3 tolerance) and the schedule write-back
// ---------------------------------------------------------------------------------------------------------------

interface Check {
  infeasible: string | null;
  shortRegions: TrainingRegion[];
  cardioShort: boolean;
}

/**
 * The dose is deliverable when, per region and calendar week, the delivered effective sets fall short of the target by
 * no more than the composer tolerance: 10 % of the week's target or 0.5 effective set per session that trains the
 * region, whichever is larger (a session within ±0.5 always passes; misses in one session may be made up in another).
 * Cardio sessions must reach full equivalence credit. Over-delivery (spill from compound work) is simulated as delivered.
 */
function feasibility(slots: readonly Slot[], composed: readonly ConcreteSession[][], T: number): Check {
  const short = new Set<TrainingRegion>();
  let cardioShort = false;
  const weeks = Math.max(1, Math.floor(T / 7));
  for (let w = 0; w < weeks; w++) {
    const tgt: Partial<Record<TrainingRegion, number>> = {};
    const del: Partial<Record<TrainingRegion, number>> = {};
    const n: Partial<Record<TrainingRegion, number>> = {};
    slots.forEach((slot, i) => {
      const k = slot.days.filter((d) => d >= 7 * w && d < 7 * w + 7).length;
      if (k === 0) return;
      slot.rxs.forEach((rx, j) => {
        const s = composed[i]![j]!;
        if (rx.kind !== 'resistance') {
          if (!s.withinTolerance) cardioShort = true;
          return;
        }
        for (const r of REGIONS) {
          const t = rx.setsByRegion[r] ?? 0;
          if (!(t > 0)) continue;
          tgt[r] = (tgt[r] ?? 0) + k * t;
          del[r] = (del[r] ?? 0) + k * (s.delivered.effectiveSetsByRegion[r] ?? 0);
          n[r] = (n[r] ?? 0) + k;
        }
      });
    });
    for (const r of REGIONS) {
      const t = tgt[r] ?? 0;
      if (t > 0 && t - (del[r] ?? 0) > Math.max(WEEK_TOLERANCE * t, SESSION_SET_TOLERANCE * (n[r] ?? 0)) + 1e-9) short.add(r);
    }
  }
  const shortRegions = REGIONS.filter((r) => short.has(r));
  const parts: string[] = [];
  if (shortRegions.length) parts.push(`With what you have, the sessions cannot deliver the planned ${joinAnd(shortRegions.map((r) => REGION_LABEL[r]))} work.`);
  if (cardioShort) parts.push('With what you have, no activity matches the planned cardio.');
  return { infeasible: parts.length ? parts.join(' ') : null, shortRegions, cardioShort };
}

const round = (x: number, k: number): number => Math.round(x * k) / k;

/** Engine sessions of one composed slot, back to back from the slot's first start time (resistance, its cardio parts, cardio). */
function engineSessions(slot: Slot, sessions: readonly ConcreteSession[]): ExerciseSession[] {
  const out: ExerciseSession[] = [];
  let t = slot.sessions[0]!.startH;
  const at = (): number => round(Math.min(23, t), 100);
  sessions.forEach((s, k) => {
    const orig = slot.sessions[k]!;
    const r = s.engine.resistance;
    if (r) {
      const setsByRegion: Partial<Record<TrainingRegion, number>> = {};
      for (const reg of REGIONS) {
        const v = r.setsByRegion?.[reg] ?? 0;
        if (v > 0) setsByRegion[reg] = r3(v);
      }
      const rs: ResistanceSession = {
        kind: 'resistance',
        startH: at(),
        durationMin: round(r.durationMin ?? 0, 10),
        setsByRegion,
        rir: r3(r.rir ?? DEFAULTS.rtRir),
        loadPct1RM: round(r.loadPct1RM ?? DEFAULTS.rtLoadPct1RM, 10),
        restSec: Math.round(r.restSec ?? DEFAULTS.rtRestSec),
        ...(r.style ? { style: r.style } : {}),
        ...(s.engine.resistanceMet !== null && s.engine.resistanceMet > 0 ? { met: r3(s.engine.resistanceMet) } : {}),
        ...(orig.kind === 'resistance' && orig.coldWaterImmersion ? { coldWaterImmersion: true } : {}),
      };
      out.push(rs);
      t += (rs.durationMin ?? 0) / 60;
    }
    for (const c of s.engine.cardio) {
      const cs: CardioSession = { kind: 'cardio', modality: c.modality, startH: at(), durationMin: round(c.durationMin, 10), ...(c.met !== undefined ? { met: r3(c.met) } : {}) };
      if (orig.kind === 'cardio' && orig.carbDuringGPerH !== undefined) cs.carbDuringGPerH = orig.carbDuringGPerH;
      out.push(cs);
      t += cs.durationMin / 60;
    }
  });
  return out;
}

/**
 * Write composed sessions into the schedule: a day whose override sets `exercise` gets the composed list there; other
 * days point at a copy of their program with the composed list (one copy per distinct composition; the first one reuses
 * the program itself), so the Simulator shows the same sessions the person is told to do.
 */
function writeSlots(schedule: Schedule, slots: readonly Slot[], composed: readonly ConcreteSession[][]): Schedule {
  const programs: DayTemplate[] = schedule.programs.slice();
  const days: ScheduleDay[] = schedule.days.slice();
  const slotOfDay = new Map<number, number>();
  slots.forEach((s, i) => s.days.forEach((d) => slotOfDay.set(d, i)));
  const ex = slots.map((s, i) => engineSessions(s, composed[i]!));
  const exKey = ex.map((e) => JSON.stringify(e));
  const variant = new Map<string, number>();
  const reused = new Set<number>();
  const copies = new Map<number, number>();
  for (let d = 0; d < days.length; d++) {
    const i = slotOfDay.get(d);
    if (i === undefined) continue;
    const sd = days[d]!;
    if (sd.override?.exercise !== undefined) {
      days[d] = { ...sd, override: { ...sd.override, exercise: ex[i]! } };
      continue;
    }
    const key = `${sd.program}|${exKey[i]}`;
    let idx = variant.get(key);
    if (idx === undefined) {
      const base = schedule.programs[sd.program]!;
      if (!reused.has(sd.program)) {
        idx = sd.program;
        reused.add(idx);
        programs[idx] = { ...base, exercise: ex[i]! };
      } else {
        const n = (copies.get(sd.program) ?? 1) + 1;
        copies.set(sd.program, n);
        idx = programs.length;
        programs.push({ ...base, id: `${base.id}-${n}`, exercise: ex[i]! });
      }
      variant.set(key, idx);
    }
    if (idx !== sd.program) days[d] = { ...sd, program: idx };
  }
  return { ...schedule, programs, days };
}

// ---------------------------------------------------------------------------------------------------------------
// texts
// ---------------------------------------------------------------------------------------------------------------

function joinAnd(xs: readonly string[]): string {
  if (xs.length <= 1) return xs[0] ?? '';
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}
const KEEP_CAPITAL = /^(Indian|Olympic)\b/;
const lowerFirst = (s: string): string => (!KEEP_CAPITAL.test(s) && s.length > 1 && s[1] === s[1]!.toLowerCase() ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const capFirst = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const noParens = (s: string): string => s.replace(/\s*\([^)]*\)/g, '').trim();
/** "Dumbbells (fixed or adjustable)" → "dumbbells"; "Sturdy table" → "a sturdy table"; "Ab wheel" → "an ab wheel". */
export function equipmentPhrase(name: string): string {
  const p = lowerFirst(noParens(name));
  const last = p.split(/\s+/).pop() ?? '';
  if (/s$/i.test(last) && !/ss$/i.test(last)) return p;
  return `${/^[aeiou]/i.test(p) ? 'an' : 'a'} ${p}`;
}

const MODALITY_LABEL: Readonly<Record<CardioModality, string>> = {
  walk: 'walking', run: 'running', cycle: 'cycling', swim: 'swimming', row: 'rowing', hiit: 'interval training', other: 'other cardio',
};

function whyOf(unlocks: readonly string[]): string {
  const what = [...new Set(unlocks.filter((u) => !u.startsWith('cardio:')).map((u) => PATTERN_LABEL[u as MovementPattern] ?? u))].slice(0, 2);
  if (what.length) return `adds ${joinAnd(what)} work`;
  const cardio = unlocks.filter((u) => u.startsWith('cardio:')).map((u) => MODALITY_LABEL[u.slice(7) as CardioModality] ?? 'cardio');
  if (cardio.length) return `adds ${joinAnd(cardio.slice(0, 2))} as cardio`;
  return 'makes the sessions shorter or closer to the plan';
}

function fmt(v: number): string {
  const a = Math.abs(v);
  return a >= 10 ? a.toFixed(0) : a >= 0.1 ? a.toFixed(1) : a.toFixed(2);
}

/** Smallest goal change worth stating or counting as a gain (metric units). */
const BENEFIT_EPS = 0.005;

/**
 * +1 when a larger value of goal `goal` is better, −1 when smaller is better, 0 for a "keep" goal (no direction):
 * maximise / minimise as stated; a target goal points from its start toward its target.
 */
export function goalSense(ctx: PlanningContext, goal: number): number {
  const g = ctx.goals.find((x) => x.index === goal);
  if (!g) return 0;
  if (g.direction === 'maximise') return 1;
  if (g.direction === 'minimise') return -1;
  const t = g.spec.target;
  if (t === undefined) return g.def.direction === 'down' ? -1 : 1;
  const change = g.spec.targetKind === 'change' ? t : t - g.startEstimate;
  return Number.isFinite(change) ? Math.sign(change) : g.def.direction === 'down' ? -1 : 1;
}

/** Highest-ranked goal the item improves: "adds 0.3 kg skeletal muscle" / "0.4 kg less fat mass"; null when none. */
function benefitPhrase(ctx: PlanningContext, benefit: ShoppingItemV2['benefit']): string | null {
  for (const b of [...benefit].sort((x, y) => x.goal - y.goal)) {
    if (!Number.isFinite(b.delta) || !(goalSense(ctx, b.goal) * b.delta >= BENEFIT_EPS)) continue;
    const g = ctx.goals.find((x) => x.index === b.goal);
    const label = lowerFirst(noParens(g?.def.label ?? `goal ${b.goal + 1}`));
    const unit = b.unit && b.unit !== '1' ? ` ${b.unit}` : '';
    if (!unit) return `${label} ${b.delta > 0 ? '+' : '−'}${fmt(b.delta)}`;
    return b.delta > 0 ? `adds ${fmt(b.delta)}${unit} ${label}` : `${fmt(b.delta)}${unit} less ${label}`;
  }
  return null;
}

function itemText(ctx: PlanningContext, row: ShoppingItemV2, ideal: boolean, names: string): string {
  const why = benefitPhrase(ctx, row.benefit) ?? whyOf(row.unlocks);
  if (row.required) return ideal ? `The Ideal plan uses ${names} (${why}).` : `To make this plan work you'd need ${names} (${why}).`;
  return row.priceTier === 0 ? `You could also use ${names} (${why}).` : `Worth buying: ${names} (${why}).`;
}

/**
 * E8 `ShoppingItem` → the planner's `ShoppingItemV2` (structural, §8.5): same ids (the whole bundle in `equipmentIds`),
 * R3 price tier, flags and unlocks; the text is the planner's plain sentence (the benefit in goal units when the item was
 * re-run, else what it adds).
 */
export function toShoppingItemV2(
  ctx: PlanningContext,
  item: ShoppingItem,
  o: { ideal: boolean; required?: boolean; benefit?: ShoppingItemV2['benefit']; catalogue?: Catalogue } = { ideal: false },
): ShoppingItemV2 {
  const cat = o.catalogue ?? SEED_CATALOGUE;
  const names = joinAnd(item.equipmentIds.map((q) => equipmentPhrase(cat.equipmentItem(q)?.name ?? q)));
  const row: ShoppingItemV2 = {
    equipmentId: item.equipmentId,
    equipmentIds: [...item.equipmentIds],
    name: item.name,
    priceTier: item.priceTier,
    required: o.required ?? item.required,
    unlocks: [...item.unlocks],
    benefit: (o.benefit ?? item.benefit).map((b) => ({ ...b })),
    text: '',
  };
  row.text = itemText(ctx, row, o.ideal, names);
  return row;
}

// ---------------------------------------------------------------------------------------------------------------
// equipmentFor
// ---------------------------------------------------------------------------------------------------------------

export type GoalDeltaFn = (s: Schedule) => Promise<Array<{ goal: number; delta: number; unit: string }>>;

export interface EquipmentForOptions {
  /** The Ideal: compose from the full catalogue; the shopping list is not limited by the allowance. */
  ideal: boolean;
  /**
   * Goal values of a schedule (the lead's nominal + holdout runs, P50 per goal in metric units). Called for the schedule
   * without the item and once per top-3 shopping row with it; the benefit is the difference, so the callback may return
   * absolute values or changes against any fixed reference. For a rung whose targets the equipment covers fully, the
   * "without" schedule is the returned `schedule` object itself (a cache keyed by schedule identity serves the final run).
   */
  goalDelta?: GoalDeltaFn;
  /** Catalogue (default: the seed catalogue). */
  catalogue?: Catalogue;
  /** VO2max for cardio composition, mL/kg/min (default: measured or the activity module's estimate). */
  vo2max?: number;
  /** Shopping rows re-run for benefits (default 3). */
  benefitTop?: number;
}

export interface EquipmentForResult {
  /** The schedule with the composed sessions written in (unchanged without a training profile). */
  schedule: Schedule;
  /** Composed sessions, one per training session of the horizon in day order (`prescription.date` set; repeats share content). */
  sessions: ConcreteSession[];
  /** Items the plan's dose cannot be delivered without; a rung lists a paid item here only within its purchase allowance. */
  required: ShoppingItemV2[];
  optional: ShoppingItemV2[];
  /** "Uses only what you have." / "To make this plan work you'd need …" (plain language). */
  text: string;
  /** Plain reason when the dose cannot be delivered within the composer tolerance (the planner treats it as infeasible). */
  infeasible: string | null;
}

const NO_OP = (schedule: Schedule): EquipmentForResult => ({ schedule, sessions: [], required: [], optional: [], text: '', infeasible: null });

/**
 * Compose the plan's sessions with the person's equipment (§8.3) and write the delivered dose into the schedule; judge
 * feasibility; build the shopping list (§8.5). No-op (schedule returned as is) without a training profile.
 */
export async function equipmentFor(ctx: PlanningContext, schedule: Schedule, opts: EquipmentForOptions): Promise<EquipmentForResult> {
  const profile = trainingProfileOf(ctx);
  if (!profile) return NO_OP(schedule);
  const ideal = opts.ideal;
  const catalogue = opts.catalogue ?? SEED_CATALOGUE;
  const vo2max = opts.vo2max ?? vo2maxEstimate(ctx);
  const base = composeOptions(ctx, profile, { ideal, catalogue, vo2max });
  const bounds = equipmentEnvelope(ctx, { ideal, catalogue });
  const slots = collectSlots(ctx, schedule, bounds, vo2max);
  if (slots.length === 0) return { ...NO_OP(schedule), text: 'No training sessions, so no equipment is needed.' };
  const T = schedule.horizonDays;

  let composed = composeSlots(slots, base);
  let check = feasibility(slots, composed, T);
  // shopping rows against what the person has now, on the planner's full targets (E8 marks the bundle that restores
  // feasibility as required); a rung sees only items within its allowance (free household items always), the Ideal all
  const anyClip = slots.some((s) => s.cut.length > 0 || s.reduced.length > 0);
  const slotsFull: Slot[] = anyClip ? slots.map((s) => ({ ...s, rxs: s.rxsFull })) : [...slots];
  const rows = shoppingList(
    slotsFull.flatMap((s) => s.rxs),
    { ...base, fullCatalogue: false, ideal, limit: 8 },
  );
  let fix: ShoppingItem | null = null;
  let purchases: string[] = [];
  if (!ideal && check.infeasible) {
    const cand = rows.find((r) => r.required) ?? null;
    if (cand) {
      const withFix = composeSlots(slots, { ...base, purchases: cand.equipmentIds });
      const c2 = feasibility(slots, withFix, T);
      if (!c2.infeasible) {
        composed = withFix;
        check = c2;
        fix = cand;
        purchases = [...cand.equipmentIds];
      }
    }
  }
  const finalSchedule = writeSlots(schedule, slots, composed);

  // a rung requires only the bundle that made its dose deliverable; the Ideal the bundle E8 found restores its dose
  const isRequired = (r: ShoppingItem): boolean => (ideal ? r.required : r === fix);
  const ordered = [...rows].sort((a, b) => Number(isRequired(b)) - Number(isRequired(a)));
  const benefits = new Map<ShoppingItem, ShoppingItemV2['benefit']>();
  const dropped = new Set<ShoppingItem>();
  if (opts.goalDelta && ordered.length) {
    const values = new Map<Schedule, Array<{ goal: number; delta: number; unit: string }>>();
    const valueOf = async (s: Schedule) => {
      let v = values.get(s);
      if (!v) values.set(s, (v = await opts.goalDelta!(s)));
      return v;
    };
    const composedWith = new Map<string, Schedule>();
    const owning = (extra: readonly string[]): Schedule => {
      const key = [...extra].sort().join('+');
      let s = composedWith.get(key);
      if (!s) {
        const o: ComposeOptions = { ...base, fullCatalogue: false, profile: { ...profile, owned: [...profile.owned, ...extra] }, purchases: [] };
        composedWith.set(key, (s = writeSlots(schedule, slotsFull, composeSlots(slotsFull, o))));
      }
      return s;
    };
    // "without" an optional row: the rung as delivered (with its required bundle); for the Ideal and for the required
    // row itself: what the person has now. "With": the same plus the row's items.
    const without = (r: ShoppingItem): Schedule => (ideal || r === fix ? owning([]) : anyClip ? owning(purchases) : finalSchedule);
    const withItem = (r: ShoppingItem): Schedule => (r === fix ? (anyClip ? owning(purchases) : finalSchedule) : owning([...(ideal ? [] : purchases), ...r.equipmentIds]));
    for (const r of ordered.slice(0, opts.benefitTop ?? BENEFIT_TOP)) {
      const a = await valueOf(withItem(r));
      const b = await valueOf(without(r));
      const benefit = a.map((x) => {
        const y = b.find((z) => z.goal === x.goal);
        return { goal: x.goal, delta: y ? x.delta - y.delta : 0, unit: x.unit };
      });
      benefits.set(r, benefit);
      // an optional row whose re-run moves no goal the right way is not worth listing
      if (!isRequired(r) && !benefit.some((x) => Number.isFinite(x.delta) && goalSense(ctx, x.goal) * x.delta >= BENEFIT_EPS)) dropped.add(r);
    }
  }
  const mapped = ordered.filter((r) => !dropped.has(r)).map((r) => toShoppingItemV2(ctx, r, { ideal, required: isRequired(r), benefit: benefits.get(r) ?? [], catalogue }));
  const required = mapped.filter((r) => r.required);
  const optional = mapped.filter((r) => !r.required);

  // texts
  const parts: string[] = [];
  if (ideal) {
    const have = new Set([...profile.owned, ...profile.access.flatMap((a) => a.equipment)]);
    const used = [...new Set(composed.flat().flatMap((s) => s.items.flatMap((it) => it.equipment)))].filter((q) => !have.has(q)).sort();
    parts.push(used.length ? `Uses equipment you don't have yet: ${joinAnd(used.map((q) => equipmentPhrase(catalogue.equipmentItem(q)?.name ?? q)))}.` : 'Uses only what you have.');
  } else if (required.length) parts.push(required[0]!.text);
  else parts.push('Uses only what you have.');
  const cut = REGIONS.filter((r) => slots.some((s) => s.cut.includes(r)));
  const reduced = REGIONS.filter((r) => !cut.includes(r) && slots.some((s) => s.reduced.includes(r)));
  if (cut.length) parts.push(`Nothing you have trains the ${joinAnd(cut.map((r) => REGION_LABEL[r]))} directly, so the plan has less work for them.`);
  if (reduced.length) parts.push(`What you have limits ${joinAnd(reduced.map((r) => REGION_LABEL[r]))} work, so the plan does less of it.`);

  const sessions: ConcreteSession[] = [];
  const slotOfDay = new Map<number, number>();
  slots.forEach((s, i) => s.days.forEach((d) => slotOfDay.set(d, i)));
  for (let d = 0; d < T; d++) {
    const i = slotOfDay.get(d);
    if (i === undefined) continue;
    const date = isoDay(schedule.startDate, d);
    for (const s of composed[i]!) sessions.push({ ...s, prescription: { ...s.prescription, date } });
  }
  return { schedule: finalSchedule, sessions, required, optional, text: capFirst(parts.join(' ')), infeasible: check.infeasible };
}
