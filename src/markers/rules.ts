/**
 * The W-L* rule engine (SUITE_SPEC §13.5.3). Pure and deterministic.
 *
 * Reads the person's confirmed, non-stale readings, evaluates every row of the interaction table and returns what the
 * plan does with them: planner locks and flags (`cap`, and the clinician rules that hold the plan gentle), notes for the
 * ladder, Food tab and Coach (`warn`, `clinician`, and every other fired rule, each with its "because" reading),
 * ranking preferences (`prefer`), re-asks and retest dates. No rule removes anything: a cap limits what the planner
 * proposes, a person's own logged choices are never refused.
 *
 * A rule whose condition needs something the app does not know (a printed range that was not entered, a context
 * answer not given) does not fire; it is listed in `unresolved`.
 */
import type { PersonProfile } from '@/engine/types/profile';
import type { PlannerSafetyInput } from '@/engine/planner/domain/types';
import type { LocalDate } from '@/store';
import { fillMessage, formatMarkerDate, readingText, type DateStyle } from './because';
import { currentReadings, historyOf, isStale, previousReading } from './doc';
import { TABLE } from './table';
import type {
  Also,
  Condition,
  InteractionRule,
  LabLockId,
  LeverId,
  MarkerEvaluation,
  MarkerId,
  MarkerNote,
  MarkerReading,
  MarkersDoc,
  MarkerState,
  MarkerSafetyPatch,
  RuleContext,
  Threshold,
} from './types';
import { MARKER_UNITS, convert, displayValue } from './units';

/** Re-asks that pause the planner search until answered (§13.5.3); the rest are questions shown with the note. */
export const BLOCKING_REASKS: ReadonlySet<string> = new Set(['diabetes', 'kidney', 'gout', 'foodAllergy']);

/** Locks where the larger value is the stricter one. */
const FLOOR_LOCKS: ReadonlySet<string> = new Set(['carb-floor', 'protein-floor', 'fat-floor', 'min-eating-window']);

/** WHO haemoglobin cut-off, g/dL; ACG healthy ALT limit, U/L (the research tables' symbolic thresholds). */
const WHO_HB_GDL = { male: 13, female: 12 } as const;
const HEALTHY_ALT_UL = { male: 33, female: 25 } as const;

/*
 * Sex not given: each sex-specific threshold takes its more cautious value. Hb low → the higher cut-off (anaemia is
 * flagged sooner); ALT → the lower healthy limit; a sex-specific cap → the lower cap; a rule limited to one sex applies.
 */
const whoHbCutoff = (sex: RuleContext['sex']): number => (sex === 'unknown' ? Math.max(WHO_HB_GDL.male, WHO_HB_GDL.female) : WHO_HB_GDL[sex]);
const healthyAltUln = (sex: RuleContext['sex']): number => (sex === 'unknown' ? Math.min(HEALTHY_ALT_UL.male, HEALTHY_ALT_UL.female) : HEALTHY_ALT_UL[sex]);

const EPS = 1e-9;

type Unknown = { unknown: string };
const isUnknown = (x: unknown): x is Unknown => typeof x === 'object' && x !== null && 'unknown' in x;

/* ------------------------------------------------------------------------------------------- values */

/** A reading's value in the unit a rule is written in (HOMA-IR is computed from glucose and insulin). */
function valueIn(r: MarkerReading, unit: string, cur: ReadonlyMap<MarkerId, MarkerReading>): number | Unknown {
  if (unit === 'HOMA-IR') {
    const g = cur.get('fpg');
    if (!g) return { unknown: 'fpg' };
    const gl = convert('fpg', g.value, g.unit, 'mmol/L');
    const ins = convert('insulin', r.value, r.unit, 'µU/mL');
    if (gl === null || ins === null) return { unknown: 'HOMA-IR' };
    return (gl * ins) / 22.5;
  }
  const v = convert(r.id, r.value, r.unit, unit);
  // Lp(a) mg/dL and nmol/L never convert: a rule in the other unit simply does not apply
  return v === null ? { unknown: `unit:${unit}` } : v;
}

/** The printed range's ends in a rule's unit. */
function labEnds(r: MarkerReading, unit: string): { low?: number; high?: number } {
  const lr = r.labRange;
  if (!lr) return {};
  const conv = (x: number | undefined): number | undefined => (x === undefined ? undefined : (convert(r.id, x, lr.unit || r.unit, unit) ?? undefined));
  return { low: conv(lr.low), high: conv(lr.high) };
}

function threshold(t: Threshold, r: MarkerReading, unit: string, ctx: RuleContext): number | Unknown {
  if (typeof t === 'number') return t;
  switch (t) {
    case 'whoCutoff':
      return convert('hb', whoHbCutoff(ctx.sex), 'g/dL', unit) ?? { unknown: t };
    case 'healthyULN':
      return healthyAltUln(ctx.sex);
    case 'labLow':
      return labEnds(r, unit).low ?? { unknown: 'labRange' };
    case 'labHigh':
    case 'labULN':
      return labEnds(r, unit).high ?? { unknown: 'labRange' };
  }
}

function cmp(op: string, v: number, t: number): boolean {
  switch (op) {
    case 'gte':
      return v >= t - EPS;
    case 'gt':
      return v > t + EPS;
    case 'lte':
      return v <= t + EPS;
    case 'lt':
      return v < t - EPS;
    case 'eq':
      return Math.abs(v - t) <= EPS;
  }
  return false;
}

/* ------------------------------------------------------------------------------------------- conditions */

interface Env {
  ctx: RuleContext;
  doc: MarkersDoc;
  cur: ReadonlyMap<MarkerId, MarkerReading>;
}

/** Does `when` hold for reading `r`? */
function holds(when: Condition, r: MarkerReading, env: Env): boolean | Unknown {
  switch (when.op) {
    case 'any':
      return true;
    case 'missing':
      return false; // evaluated separately (no reading)
    case 'cmp': {
      const v = valueIn(r, when.unit, env.cur);
      if (isUnknown(v)) return v;
      const t = threshold(when.value, r, when.unit, env.ctx);
      if (isUnknown(t)) return t;
      return cmp(when.cmp, v, t);
    }
    case 'between': {
      const v = valueIn(r, when.unit, env.cur);
      if (isUnknown(v)) return v;
      return v >= when.low - EPS && v <= when.high + EPS;
    }
    case 'outside': {
      const v = valueIn(r, when.unit, env.cur);
      if (isUnknown(v)) return v;
      const { low, high } = when.range === 'lab' ? labEnds(r, when.unit) : { low: when.range[0], high: when.range[1] };
      if (low === undefined && high === undefined) return { unknown: 'labRange' };
      return (low !== undefined && v < low - EPS) || (high !== undefined && v > high + EPS);
    }
    case 'xUln': {
      const high = r.labRange?.high;
      if (high === undefined) return { unknown: 'labRange' };
      const h = convert(r.id, high, r.labRange!.unit || r.unit, r.unit);
      if (h === null) return { unknown: 'labRange' };
      return r.value > when.factor * h + EPS;
    }
    case 'fallPct': {
      const prev = previousReading(env.doc, r.id);
      if (!prev) return false;
      const p = convert(r.id, prev.value, prev.unit, r.unit);
      if (p === null || p <= 0) return false;
      return ((p - r.value) / p) * 100 > when.pct + EPS;
    }
    case 'afterFast': {
      const h = env.ctx.fields?.['sample.fastHoursBefore'];
      const d = env.ctx.fields?.['sample.daysAfterFast'];
      if (typeof h !== 'number' || typeof d !== 'number') return { unknown: 'sample.fastHoursBefore' };
      return h > when.fastHours && d <= when.days;
    }
  }
}

const ORDINAL: Readonly<Record<string, number>> = { none: 0, low: 1, light: 1, moderate: 2, high: 3, 'very high': 4 };

function fieldValue(field: string, r: MarkerReading, env: Env): number | string | boolean | undefined {
  if (field === 'reading.fasting') return r.fasting;
  if (field === 'bmi') return env.ctx.bmi;
  if (field.startsWith('context.')) return env.doc.context[field.slice(8) as keyof MarkersDoc['context']];
  return env.ctx.fields?.[field];
}

function alsoHolds(a: Also, r: MarkerReading, when: Condition, env: Env): boolean | Unknown {
  switch (a.kind) {
    case 'sex':
      return env.ctx.sex === 'unknown' || env.ctx.sex === a.sex;
    case 'flag':
      return env.ctx.flags?.includes(a.flag) ?? false;
    case 'repeat': {
      const hits = historyOf(env.doc, r.id).filter((h) => !isStale(h, env.ctx.today, env.ctx.dietChangeDate) && holds(when, h, env) === true);
      return hits.length >= 2;
    }
    case 'marker': {
      const o = env.cur.get(a.markerId);
      if (!o) return { unknown: `marker:${a.markerId}` };
      const v = convert(a.markerId, o.value, o.unit, a.unit);
      if (v === null) return { unknown: `marker:${a.markerId}` };
      return a.cmp === 'eq' ? Math.abs(v - a.value) <= EPS : cmp(a.cmp, v, a.value);
    }
    case 'field': {
      const v = fieldValue(a.field, r, env);
      if (v === undefined) return { unknown: a.field };
      if (a.cmp === 'in') return Array.isArray(a.value) && (a.value as readonly string[]).includes(String(v));
      if (a.cmp === 'eq') return v === a.value;
      const num = (x: unknown): number | undefined => (typeof x === 'number' ? x : typeof x === 'string' && x in ORDINAL ? ORDINAL[x] : undefined);
      const nv = num(v);
      const nt = num(a.value);
      if (nv === undefined || nt === undefined) return { unknown: a.field };
      return cmp(a.cmp, nv, nt);
    }
  }
}

/* ------------------------------------------------------------------------------------------- evaluation */

const addWeeks = (iso: LocalDate, weeks: number): LocalDate => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.round(weeks * 7));
  return d.toISOString().slice(0, 10);
};

const addMonths = (iso: LocalDate, months: number): LocalDate => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  // 31 Jan + 1 month → 28/29 Feb, not 3 Mar
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
};

function lockValue(l: NonNullable<InteractionRule['effect']['locks']>[number], ctx: RuleContext): number {
  if (l.bySex) {
    if (ctx.sex !== 'unknown') return l.bySex[ctx.sex];
    // sex not given: the stricter value (the larger for a floor, the smaller for a cap)
    return FLOOR_LOCKS.has(l.lock) ? Math.max(l.bySex.male, l.bySex.female) : Math.min(l.bySex.male, l.bySex.female);
  }
  if (l.relative === 'deficitDefaultMinus') return Math.max(0, (ctx.defaultDeficitCapPct ?? 25) - l.value);
  return l.value;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * The message with its placeholders filled. The reading itself ("{v} mmol/L") is shown in the unit the person entered,
 * like the "because" chip (§13.5.3); when that differs in number from the unit the message is written in, the
 * message's unit follows in brackets so its other numbers ("At 190 or more") still read right. Other numbers stay in
 * the message's unit.
 */
function noteText(rule: InteractionRule, r: MarkerReading, env: Env, style: DateStyle): string {
  const unit = 'unit' in rule.when ? rule.when.unit : r.unit;
  const homa = unit === 'HOMA-IR' ? valueIn(r, unit, env.cur) : undefined;
  const v = typeof homa === 'number' ? homa : (convert(r.id, r.value, r.unit, unit) ?? r.value);
  const prev = previousReading(env.doc, r.id);
  const capLock = rule.effect.locks?.find((l) => l.bySex);
  const asRuleUnit = `${displayValue(r.id, v, unit)}${unit === '%' ? ' %' : ` ${unit}`}`;
  const entered = readingText(r.id, r.value, r.unit) + (Math.abs(v - r.value) > EPS ? ` (${asRuleUnit})` : '');
  const message = rule.message.replace(new RegExp(`\\{(?:v|value)\\} ?${escapeRe(unit)}(?![\\w/])`, 'g'), () => entered)
    // retest dates: "{date+12w}", "{date+3m}" count from the reading date
    .replace(/\{date\+(\d+)([wm])\}/g, (_all, n: string, u: string) => formatMarkerDate(u === 'w' ? addWeeks(r.date, Number(n)) : addMonths(r.date, Number(n)), style));
  return fillMessage(message, {
    value: displayValue(r.id, v, unit),
    date: formatMarkerDate(r.date, style),
    cap: capLock ? lockValue(capLock, env.ctx) : undefined,
    uln: rule.markerId === 'alt' ? `${healthyAltUln(env.ctx.sex)} U/L` : undefined,
    old: prev ? displayValue(r.id, convert(r.id, prev.value, prev.unit, r.unit) ?? prev.value, r.unit) : undefined,
    d1: prev ? formatMarkerDate(prev.date, style) : undefined,
    d2: formatMarkerDate(r.date, style),
  });
}

function statusOf(r: MarkerReading): MarkerState['status'] {
  const lr = r.labRange;
  if (!lr || (lr.low === undefined && lr.high === undefined)) return 'unknown';
  const lo = lr.low === undefined ? undefined : (convert(r.id, lr.low, lr.unit || r.unit, r.unit) ?? undefined);
  const hi = lr.high === undefined ? undefined : (convert(r.id, lr.high, lr.unit || r.unit, r.unit) ?? undefined);
  if (hi !== undefined && r.value > hi + EPS) return 'above';
  if (lo !== undefined && r.value < lo - EPS) return 'below';
  return 'in';
}

export interface EvaluateOptions {
  dateStyle?: DateStyle;
  /** Evaluate only these rules (tests). */
  rules?: readonly InteractionRule[];
}

export function evaluateMarkers(doc: MarkersDoc, ctx: RuleContext, opts: EvaluateOptions = {}): MarkerEvaluation {
  const style = opts.dateStyle ?? 'day-month';
  const all = currentReadings(doc);
  const cur = new Map<MarkerId, MarkerReading>();
  for (const r of all) if (!isStale(r, ctx.today, ctx.dietChangeDate)) cur.set(r.id, r);
  const env: Env = { ctx, doc, cur };

  const states: MarkerState[] = all.map((r) => ({ markerId: r.id, reading: r, status: statusOf(r), stale: !cur.has(r.id), rules: [] }));
  const ev: MarkerEvaluation = { states, notes: [], safety: { plannerLocks: [], flags: [] }, preferLevers: [], reasks: [], retests: [], unresolved: [] };
  const locks = new Map<LabLockId, { id: LabLockId; value: number; reasons: Array<{ rule: string }> }>();
  const prefer = new Map<LeverId, { lever: LeverId; weight: number; rule: string }>();

  for (const rule of opts.rules ?? TABLE.rules) {
    const r = cur.get(rule.markerId);
    if (rule.when.op === 'missing') {
      // fires when there is no usable reading within the window (and its extra conditions hold)
      const recent = r && addWeeks(r.date, rule.when.withinWeeks) >= ctx.today;
      if (recent) continue;
      const pseudo = r ?? all.find((x) => x.id === rule.markerId);
      let ok = true;
      for (const a of rule.also) {
        const h = pseudo ? alsoHolds(a, pseudo, rule.when, env) : a.kind === 'field' ? (ctx.fields?.[a.field] === undefined ? { unknown: a.field } : ctx.fields[a.field] === a.value) : false;
        if (isUnknown(h)) {
          ev.unresolved.push({ rule: rule.id, field: h.unknown });
          ok = false;
          break;
        }
        if (!h) {
          ok = false;
          break;
        }
      }
      if (ok && rule.effect.retestWeeks !== undefined) ev.retests.push({ markerId: rule.markerId, due: ctx.today, rule: rule.id });
      continue;
    }
    if (!r) continue;
    let fired = holds(rule.when, r, env);
    if (fired === true) {
      for (const a of rule.also) {
        const h = alsoHolds(a, r, rule.when, env);
        if (h !== true) {
          fired = h;
          break;
        }
      }
    }
    if (isUnknown(fired)) {
      ev.unresolved.push({ rule: rule.id, field: fired.unknown });
      continue;
    }
    if (!fired) continue;

    states.find((s) => s.markerId === rule.markerId)?.rules.push(rule.id);
    const e = rule.effect;
    const retestDue = e.retestWeeks !== undefined ? addWeeks(r.date, e.retestWeeks) : undefined;
    const note: MarkerNote = {
      rule: rule.id,
      markerId: rule.markerId,
      kind: rule.kind,
      severity: rule.severity,
      because: { markerId: r.id, label: MARKER_UNITS[r.id].label, value: r.value, unit: r.unit, date: r.date },
      levers: [...e.levers],
      text: noteText(rule, r, env, style),
      grade: rule.grade,
      sources: rule.sources,
    };
    if (retestDue) note.retestDue = retestDue;
    ev.notes.push(note);

    for (const l of e.locks ?? []) {
      const value = lockValue(l, ctx);
      const prev = locks.get(l.lock);
      const stricter = !prev || (FLOOR_LOCKS.has(l.lock) ? value > prev.value : value < prev.value);
      if (!prev) locks.set(l.lock, { id: l.lock, value, reasons: [{ rule: rule.id }] });
      else {
        if (stricter) prev.value = value;
        prev.reasons.push({ rule: rule.id });
      }
    }
    for (const f of e.flags ?? []) if (!ev.safety.flags.includes(f)) ev.safety.flags.push(f);
    if (rule.kind === 'prefer' && e.preferWeight !== undefined)
      for (const lever of e.levers) {
        const p = prefer.get(lever);
        if (!p || e.preferWeight > p.weight) prefer.set(lever, { lever, weight: Math.min(0.02, e.preferWeight), rule: rule.id });
      }
    if (e.reask) ev.reasks.push({ rule: rule.id, markerId: rule.markerId, about: e.reask });
    if (rule.kind === 'retest' && retestDue) ev.retests.push({ markerId: rule.markerId, due: retestDue, rule: rule.id });
  }

  ev.safety.plannerLocks = [...locks.values()];
  ev.preferLevers = [...prefer.values()];
  // one retest per marker: the earliest
  const byMarker = new Map<MarkerId, MarkerEvaluation['retests'][number]>();
  for (const t of ev.retests) {
    const p = byMarker.get(t.markerId);
    if (!p || t.due < p.due) byMarker.set(t.markerId, t);
  }
  ev.retests = [...byMarker.values()];
  return ev;
}

/** `markerConstraints(doc, ctx) → PlannerSafetyInput` patch (§13.5.3). */
export function markerConstraints(doc: MarkersDoc, ctx: RuleContext): MarkerSafetyPatch {
  return evaluateMarkers(doc, ctx).safety;
}

/**
 * Merge the lab patch into a screening outcome. One entry per lock id with the stricter value (the planner reads the
 * first entry of an id); reasons of both are kept; flags are united.
 */
export function mergeSafety(input: PlannerSafetyInput | undefined, patch: MarkerSafetyPatch): PlannerSafetyInput {
  const base = input ?? {};
  if (!patch.plannerLocks.length && !patch.flags.length) return base;
  const out = new Map<string, { id: string; value?: number; reasons?: Array<{ rule: string }> }>();
  for (const l of [...(base.plannerLocks ?? []), ...patch.plannerLocks]) {
    const prev = out.get(l.id);
    if (!prev) {
      out.set(l.id, { id: l.id, ...(l.value !== undefined ? { value: l.value } : {}), reasons: [...(l.reasons ?? [])] });
      continue;
    }
    if (l.value !== undefined) {
      if (prev.value === undefined) prev.value = l.value;
      else prev.value = FLOOR_LOCKS.has(l.id) ? Math.max(prev.value, l.value) : Math.min(prev.value, l.value);
    }
    prev.reasons = [...(prev.reasons ?? []), ...(l.reasons ?? [])];
  }
  return { ...base, plannerLocks: [...out.values()], flags: [...new Set([...(base.flags ?? []), ...patch.flags])] };
}

/**
 * Re-asks that pause the planner (`planner.find` → precondition `markerReask`): blocking re-asks whose reading is newer
 * than the date the screening question was last answered.
 */
export function blockingReasks(ev: MarkerEvaluation, answeredOn: Readonly<Partial<Record<string, LocalDate>>> = {}): MarkerEvaluation['reasks'] {
  return ev.reasks.filter((q) => {
    if (!BLOCKING_REASKS.has(q.about)) return false;
    const reading = ev.states.find((s) => s.markerId === q.markerId)?.reading;
    const answered = answeredOn[q.about];
    return !answered || (reading !== undefined && reading.date > answered);
  });
}

/** HC-E3 default deficit cap for a person (17 §2.3; mirrors the planner's compile without the screening locks). */
export function defaultDeficitCapPct(bmi: number, ageYears: number): number {
  let cap = 25;
  if (bmi >= 30) cap = 30;
  if (bmi < 25) cap = 20;
  if (ageYears >= 65) cap = Math.min(cap, 15);
  return cap;
}

/**
 * Rule context from the person's profile (sex, age, BMI, screening flags) and today's date. Sex is 'unknown' when the
 * person chose "prefer not to say" (`sexUnspecified`; `body.sex` then holds only the equation set) or gave none.
 * Callers use `markerRuleContext` (./context.ts), which adds the fields the app holds.
 */
export function ruleContextFrom(profile: Pick<PersonProfile, 'body' | 'safety' | 'sexUnspecified'> | undefined, today: LocalDate, extra: Partial<RuleContext> = {}): RuleContext {
  const b = profile?.body;
  const sex: RuleContext['sex'] = !profile?.sexUnspecified && (b?.sex === 'female' || b?.sex === 'male') ? b.sex : 'unknown';
  const bmi = b && b.heightCm > 0 ? b.weightKg / (b.heightCm / 100) ** 2 : undefined;
  const pf = profile?.safety?.flags;
  const flags: string[] = [];
  if (pf?.gout) flags.push('gout');
  if (pf?.kidneyDisease) flags.push('kidney-disease');
  if (pf?.diabetesMedication && pf.diabetesMedication !== 'none') flags.push('diabetes');
  const ctx: RuleContext = { sex, today, flags, ...extra };
  if (b?.ageYears !== undefined) ctx.ageYears = b.ageYears;
  if (bmi !== undefined && Number.isFinite(bmi)) {
    ctx.bmi = Math.round(bmi * 10) / 10;
    ctx.defaultDeficitCapPct = defaultDeficitCapPct(bmi, b?.ageYears ?? 40);
  }
  if (extra.flags) ctx.flags = [...new Set([...flags, ...extra.flags])];
  return ctx;
}
