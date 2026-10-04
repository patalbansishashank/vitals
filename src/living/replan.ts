/**
 * Re-planning (docs/SUITE_SPEC.md §3.6; docs/PLANNER_V2_SPEC.md §7): trigger rules (§7.5), the daily energy nudge, the
 * receding-horizon `ReplanRequest` builder (warm start from the active plan, logs since the anchor, revealed adherence),
 * validation of a `ReplanResult` against the stability rules (past immutable, lock window, churn hard limits), the
 * adopt-or-propose policy (automatic only when every change lowers load, or for the ±10 % energy nudge; raising load,
 * adding a fast or changing rung always needs consent) and the conversion to a `PlanVersionDoc`. Pure.
 *
 * The planner itself is reached through `PlannerPort` (PLANNER_V2 §9.2 `replan`). Until E6 exposes it,
 * `legacyPlannerPort` adapts the v1 `plan()/planRegimes` call — TODO(E6): replace with the worker client's `replan`.
 */
import type { DayTemplate, ExerciseSession, MetricId, Schedule } from '@/engine';
import type { PlannerRequest, PlannerResult, RankedGoal } from '@/engine/planner/domain/types';
import { addDays, daysBetween } from './dates';
import { planDay } from './calendar';
import { fastEventOn, templateOfDay } from './prescription';
import type {
  ActivePlanRecord,
  BlockAdherence,
  ConfirmedState,
  ItemOutcome,
  LoggedDay,
  PlanItemType,
  PlannerPort,
  PlannerProvenanceV2,
  ReplanKind,
  ReplanRequest,
  ReplanResult,
  ReplanTrigger,
  RungId,
} from './plannerContract';
import type { Actor, Instant, LocalDate, PlanDoc, PlanVersionDoc, ProjectionDigest, VersionReason } from './types';

// ------------------------------------------------------------------------------------------- constants (PLANNER_V2 §7)
/** Daily: a day "departed" when an item was skipped or energy was off by more than 10 %. */
export const LIGHT_ENERGY_DEPARTURE = 0.1;
/** Energy nudge: at most 10 % of one day's target in total, over the next 1-3 days, overshoot only. */
export const NUDGE_MAX_FRAC = 0.1;
export const NUDGE_MAX_DAYS = 3;
/** Event triggers: ≥ 3 consecutive missed items of one type; 7-day adherence < 70 with ≥ 4 scored days. */
export const MISSED_IN_A_ROW = 3;
export const LOW_ADHERENCE = 70;
export const LOW_ADHERENCE_MIN_DAYS = 4;
/** Out of band on ≥ 3 consecutive weigh-in days flags the next weekly re-plan as full. */
export const OUT_OF_BAND_DAYS = 3;
/** A safety margin predicted to bind within 7 days → event re-plan, bypassing the lock window. */
export const SAFETY_AHEAD_DAYS = 7;
/** Churn hard limits for light and weekly re-plans (§7.4). */
export const CHURN = { energyMeanRel: 0.1, sessionsPerWeek: 1, newFastMinH: 24, windowDays: 7 } as const;
/** Minimum re-plan horizon (§7.2). */
export const MIN_REPLAN_HORIZON_D = 7;

// ------------------------------------------------------------------------------------------- triggers
export interface DeclaredEvent {
  kind: 'noTraining' | 'illness' | 'travel' | 'socialMeal' | 'busy' | 'dietBreak';
  from: LocalDate;
  to: LocalDate;
}

export interface TriggerInputs {
  today: LocalDate;
  /** The day that just closed (yesterday): its outcomes and energy. */
  closedDay: { date: LocalDate; items: readonly ItemOutcome[]; energy?: { target: number; actual: number } } | null;
  /** A weekly check-in was confirmed today. */
  checkInConfirmed: boolean;
  /** Events declared since the last evaluation. */
  declared: readonly DeclaredEvent[];
  /** Item outcomes of the last 14 days, any order. */
  recent: ReadonlyArray<{ date: LocalDate; items: readonly ItemOutcome[] }>;
  /** Mean of scored days in the last 7, and how many were scored. */
  a7: number | null;
  scored7: number;
  /** Consecutive most recent weigh-in days with the trend outside the forecast band. */
  outOfBandDays: number;
  /** Goals, limits, opt-ins or safety answers changed. */
  requestChanged: boolean;
  /** Days until a safety margin is predicted to bind (null = none in sight). */
  safetyBindsInDays: number | null;
}

export interface TriggerDecision {
  kind: ReplanKind;
  trigger: ReplanTrigger;
  reason: string;
  /** Weekly re-plan with structure moves allowed (out of band for ≥ 3 weigh-in days). */
  full?: boolean;
  /** Safety first: the lock window may change. */
  bypassLock?: boolean;
}

/** Consecutive most recent skipped items of a type (unknown items neither count nor break the run). */
export function missedInARow(recent: TriggerInputs['recent'], type: PlanItemType): number {
  const seq = [...recent].sort((a, b) => (a.date < b.date ? -1 : 1)).flatMap((d) => d.items.filter((x) => x.type === type));
  let n = 0;
  for (let k = seq.length - 1; k >= 0; k--) {
    const o = seq[k]!;
    if (o.status === 'unknown') continue;
    if (o.status === 'skipped' || o.credit === 0) n++;
    else break;
  }
  return n;
}

/** Did a closed day depart from the prescription (§7.5 row 1)? */
export function dayDeparted(day: NonNullable<TriggerInputs['closedDay']>): boolean {
  if (day.items.some((x) => x.status === 'skipped')) return true;
  if (day.energy && day.energy.target > 0 && Math.abs(day.energy.actual - day.energy.target) > LIGHT_ENERGY_DEPARTURE * day.energy.target) return true;
  return false;
}

/** All triggers that fire, highest priority first. Rate changes < 0.4 kg/week are never a trigger (not detectable). */
export function evaluateTriggers(i: TriggerInputs): TriggerDecision[] {
  const out: TriggerDecision[] = [];
  if (i.safetyBindsInDays !== null && i.safetyBindsInDays <= SAFETY_AHEAD_DAYS) out.push({ kind: 'event', trigger: 'safetyAhead', reason: `A safety margin is predicted to bind in ${i.safetyBindsInDays} days.`, bypassLock: true });
  for (const e of i.declared) out.push({ kind: 'event', trigger: 'absence', reason: `Declared ${e.kind} from ${e.from} to ${e.to}.` });
  if (i.requestChanged) out.push({ kind: 'event', trigger: 'requestChange', reason: 'Goals, limits or safety answers changed.' });
  const types = new Set<PlanItemType>(i.recent.flatMap((d) => d.items.map((x) => x.type)));
  for (const t of [...types].sort()) {
    const n = missedInARow(i.recent, t);
    if (n >= MISSED_IN_A_ROW) {
      out.push({ kind: 'event', trigger: 'missedBlocks', reason: `${n} ${t} items missed in a row.` });
      break;
    }
  }
  if (i.a7 !== null && i.scored7 >= LOW_ADHERENCE_MIN_DAYS && i.a7 < LOW_ADHERENCE) out.push({ kind: 'event', trigger: 'lowAdherence', reason: `7-day adherence ${Math.round(i.a7)}.` });
  if (i.checkInConfirmed) out.push({ kind: 'weekly', trigger: 'checkin', reason: 'Weekly check-in.', ...(i.outOfBandDays >= OUT_OF_BAND_DAYS ? { full: true } : {}) });
  if (i.closedDay && dayDeparted(i.closedDay)) out.push({ kind: 'light', trigger: 'nudge', reason: 'Yesterday went differently from the plan.' });
  return out;
}

/** The one re-plan to run now (the highest-priority trigger), or null. */
export function pickReplan(i: TriggerInputs): TriggerDecision | null {
  return evaluateTriggers(i)[0] ?? null;
}

// ------------------------------------------------------------------------------------------- energy nudge (light)
export interface EnergyNudge {
  date: LocalDate;
  /** kcal to take off that day's target (≤ 0). */
  deltaKcal: number;
}

/**
 * Daily light adjustment for an energy OVERSHOOT beyond tolerance only: the excess over tolerance, capped at 10 % of one
 * day's target, is spread over the next 1-3 days (never today; never "make up for yesterday" within a day). Undershoot
 * is never compensated (restrict-binge guard).
 */
export function energyNudge(today: LocalDate, target: number, actual: number, tolKcal: number, days: number = NUDGE_MAX_DAYS): EnergyNudge[] {
  const excess = actual - target - tolKcal;
  if (!(excess > 0) || !(target > 0)) return [];
  const total = Math.min(excess, NUDGE_MAX_FRAC * target);
  const n = Math.max(1, Math.min(NUDGE_MAX_DAYS, Math.floor(days)));
  return Array.from({ length: n }, (_, k) => ({ date: addDays(today, k + 1), deltaKcal: -total / n }));
}

/** Apply nudges to a schedule as day overrides (kcal), from the compiled energies of those days. */
export function applyEnergyNudge(schedule: Schedule, startDate: LocalDate, nudges: readonly EnergyNudge[], energyOfDay: (d: number) => number): Schedule {
  if (nudges.length === 0) return schedule;
  const days = schedule.days.map((d) => ({ ...d }));
  for (const n of nudges) {
    const d = daysBetween(startDate, n.date);
    if (d < 0 || d >= days.length) continue;
    const e = energyOfDay(d);
    if (!(e > 0)) continue;
    days[d] = { ...days[d]!, override: { ...days[d]!.override, energy: { kind: 'kcal', kcal: e + n.deltaKcal } } };
  }
  return { ...schedule, days };
}

// ------------------------------------------------------------------------------------------- request builder
/** `toActivePlanRecord(plan, version)` (§3.2): the only bridge from the plan documents to the planner. */
export function toActivePlanRecord(plan: PlanDoc & { id: string }, version: PlanVersionDoc): ActivePlanRecord & { kind: RungId } {
  return {
    planId: plan.id,
    version: version.version,
    // scenario-started plans have no rung and no genome: the planner runs its full pipeline for them (E5 note)
    kind: plan.rung === 'custom' ? 'medium' : plan.rung,
    request: plan.request,
    startDate: plan.startDate,
    endDate: plan.plannedEndDate,
    structureId: version.genome?.structureId ?? '',
    genome: version.genome?.x ?? [],
    schedule: version.schedule,
    provenance: ('seed' in version.provenance ? version.provenance : { seed: '', tier: 'S', budgetEU: 0, euUsed: 0, registryHash: version.provenance.registryHash, engineVersion: version.provenance.engineVersion, libraryVersion: 0, structures: 0 }) as PlannerProvenanceV2,
  };
}

export interface BuildRequestInput {
  decision: TriggerDecision;
  today: LocalDate;
  plan: PlanDoc & { id: string };
  head: PlanVersionDoc;
  state: ConfirmedState;
  /** Logged days (any range; only those since the anchor are sent). */
  logs: readonly LoggedDay[];
  adherence: readonly BlockAdherence[];
  changes?: ReplanRequest['changes'];
}

/** PLANNER_V2 §7.1 request: logs since the anchor, revealed adherence, absolute goals kept from the plan start. */
export function buildReplanRequest(i: BuildRequestInput): ReplanRequest {
  const logs = i.logs.filter((l) => l.date >= i.state.anchorDate && l.date < i.today).sort((a, b) => (a.date < b.date ? -1 : 1));
  return {
    kind: i.decision.kind,
    today: i.today,
    plan: toActivePlanRecord(i.plan, i.head),
    state: i.state,
    logs,
    adherence: [...i.adherence],
    trigger: i.decision.trigger,
    ...(i.changes ? { changes: i.changes } : {}),
  };
}

// ------------------------------------------------------------------------------------------- result validation & policy
export interface DayLoad {
  energyKcal: number;
  sets: number;
  cardioMin: number;
  fastH: number;
  dayType: string;
}

function sessionLoad(ex: readonly ExerciseSession[] | undefined): { sets: number; cardioMin: number } {
  let sets = 0;
  let cardioMin = 0;
  for (const s of ex ?? []) {
    if (s.kind === 'cardio') cardioMin += s.durationMin;
    else sets += Object.values(s.setsByRegion ?? {}).reduce<number>((a, b) => a + (b ?? 0), 0) || (s.volume ? { minimal: 4, light: 8, moderate: 12, high: 18, veryHigh: 24 }[s.volume] : 12);
  }
  return { sets, cardioMin };
}

/** Load of plan day d of a schedule; energy from `energyOf` (compiled/echo kcal) when given, else the template's kcal/pct. */
export function dayLoad(schedule: Schedule, d: number, energyOf?: (d: number) => number): DayLoad {
  const t: DayTemplate = templateOfDay(schedule, d);
  const e = energyOf?.(d) ?? (t.energy.kind === 'kcal' ? t.energy.kcal : t.energy.kind === 'zero' ? 0 : t.energy.pct * 25);
  const s = sessionLoad(t.exercise);
  const f = fastEventOn(schedule, d);
  return { energyKcal: e, ...s, fastH: f && f.startDay === d ? f.durationH : 0, dayType: t.label };
}

export interface ReplanCheck {
  violations: string[];
  /** Every future change lowers load (less deficit/volume, no new or longer fast). */
  lowersLoad: boolean;
  addsFast: boolean;
  changedDays: number[];
}

/**
 * Check a re-planned schedule against the active one (§7.2, §7.4): days before today unchanged; today and tomorrow
 * unchanged unless safety (or a light re-plan moving tomorrow's energy by ≤ 10 %); for light/weekly: next-7-day mean energy
 * within ±10 %, sessions ±1 per week, no new fast ≥ 24 h within 7 days, no new day type in the next 7 days.
 */
export function checkReplan(head: Schedule, next: Schedule, todayIdx: number, kind: ReplanKind, opts: { bypassLock?: boolean; deficitPlan?: boolean; energyOf?: { head: (d: number) => number; next: (d: number) => number } } = {}): ReplanCheck {
  const violations: string[] = [];
  const changed: number[] = [];
  const H = Math.max(head.horizonDays, next.horizonDays);
  const same = (d: number): boolean => JSON.stringify(templateOfDay(head, d)) === JSON.stringify(templateOfDay(next, d)) && JSON.stringify(fastEventOn(head, d) ?? null) === JSON.stringify(fastEventOn(next, d) ?? null);
  for (let d = 0; d < Math.min(todayIdx, H); d++) if (d < head.horizonDays && d < next.horizonDays && !same(d)) violations.push(`past day ${d} changed`);
  let lowers = true;
  let addsFast = false;
  const deficit = opts.deficitPlan ?? true;
  for (let d = todayIdx; d < H; d++) {
    if (d >= head.horizonDays || d >= next.horizonDays) continue;
    if (same(d)) continue;
    changed.push(d);
    const a = dayLoad(head, d, opts.energyOf?.head);
    const b = dayLoad(next, d, opts.energyOf?.next);
    if (d <= todayIdx + 1 && !opts.bypassLock) {
      const lightTomorrow = kind === 'light' && d === todayIdx + 1 && a.energyKcal > 0 && Math.abs(b.energyKcal - a.energyKcal) <= 0.1 * a.energyKcal + 1e-9 && a.sets === b.sets && a.cardioMin === b.cardioMin && a.fastH === b.fastH;
      if (!lightTomorrow) violations.push(`lock window day ${d} changed`);
    }
    if (b.fastH > a.fastH) addsFast = true;
    const energyLowers = deficit ? b.energyKcal >= a.energyKcal - 1e-9 : b.energyKcal <= a.energyKcal + 1e-9;
    if (!(energyLowers && b.sets <= a.sets + 1e-9 && b.cardioMin <= a.cardioMin + 1e-9 && b.fastH <= a.fastH + 1e-9)) lowers = false;
  }
  if (kind === 'light' || kind === 'weekly') {
    const lo = todayIdx;
    const hi = Math.min(H, todayIdx + CHURN.windowDays);
    let eA = 0;
    let eB = 0;
    let sA = 0;
    let sB = 0;
    const typesA = new Set<string>();
    for (let d = 0; d < Math.min(todayIdx, head.horizonDays); d++) typesA.add(dayLoad(head, d).dayType);
    for (let d = lo; d < hi; d++) {
      const a = dayLoad(head, d, opts.energyOf?.head);
      const b = dayLoad(next, d, opts.energyOf?.next);
      typesA.add(a.dayType);
      eA += a.energyKcal;
      eB += b.energyKcal;
      sA += (a.sets > 0 ? 1 : 0) + (a.cardioMin > 0 ? 1 : 0);
      sB += (b.sets > 0 ? 1 : 0) + (b.cardioMin > 0 ? 1 : 0);
      if (b.fastH >= CHURN.newFastMinH && b.fastH > a.fastH) violations.push(`new fast of ${Math.round(b.fastH)} h within 7 days`);
    }
    for (let d = lo; d < hi; d++) if (!typesA.has(dayLoad(next, d).dayType)) violations.push(`new day type in the next 7 days (day ${d})`);
    if (eA > 0 && Math.abs(eB - eA) / eA > CHURN.energyMeanRel + 1e-9) violations.push('next-7-day mean energy moved by more than 10 %');
    if (Math.abs(sB - sA) > CHURN.sessionsPerWeek) violations.push('sessions changed by more than one in the next 7 days');
  }
  return { violations: [...new Set(violations)], lowersLoad: lowers && changed.length > 0, addsFast, changedDays: changed };
}

export type Adoption = 'adopt' | 'propose' | 'reject';

/**
 * Adopt automatically only when every change lowers load and the hard limits hold, or for the light energy nudge;
 * anything that raises load, adds a fast or changes the rung is proposed; a result breaking the immutable past is rejected.
 */
export function adoptionPolicy(check: ReplanCheck, opts: { kind: ReplanKind; nudgeOnly?: boolean; rungChanged?: boolean; autoApplyLoadLowering: boolean; status: ReplanResult['status'] }): Adoption {
  if (opts.status === 'noSafePlan' || opts.status === 'unchanged') return 'reject';
  if (check.violations.some((v) => v.startsWith('past day'))) return 'reject';
  if (opts.nudgeOnly && opts.kind === 'light' && check.violations.length === 0) return 'adopt';
  if (opts.status === 'proposal' || opts.rungChanged || check.addsFast) return 'propose';
  if (check.violations.length > 0) return 'propose';
  if (check.lowersLoad && opts.autoApplyLoadLowering) return 'adopt';
  return 'propose';
}

const toArr = (a: ArrayLike<number>): number[] => Array.from(a, (x) => x);

/** ReplanResult → PlanVersionDoc (status from the policy; days before `effectiveFromDay` equal the parent's). */
export function versionFromReplan(i: {
  result: ReplanResult;
  plan: PlanDoc & { id: string };
  head: PlanVersionDoc;
  today: LocalDate;
  reason: VersionReason;
  adoption: Exclude<Adoption, 'reject'>;
  createdBy: Actor;
  createdAt: Instant;
}): PlanVersionDoc {
  const r = i.result;
  const fromDay = Math.max(0, planDay(i.plan, i.today));
  const forecast: ProjectionDigest = {
    fromDay,
    asPrescribed: Object.fromEntries(Object.entries(r.forecast.bands).map(([k, b]) => [k, { p10: toArr(b!.p10), p50: toArr(b!.p50), p90: toArr(b!.p90) }])),
    realistic: {},
    goals: r.forecast.asPrescribed.map((g) => {
      const gd = r.goalDates.find((x) => x.goal === g.goal);
      return { metric: g.metric, endP50: g.endP50, dateRange: gd?.range ?? null };
    }),
    warnings: i.head.forecast.warnings,
  };
  return {
    planId: i.plan.id,
    version: i.plan.headVersion + 1,
    parent: i.head.version,
    status: i.adoption === 'adopt' ? 'adopted' : 'proposed',
    reason: i.reason,
    effectiveFromDay: fromDay,
    schedule: r.plan.schedule,
    genome: r.plan.genome.length > 0 ? { structureId: r.plan.structureId, x: [...r.plan.genome] } : i.head.genome,
    sessions: Object.fromEntries(Object.entries(i.head.sessions).filter(([k]) => Number(k.split(':')[0]) < fromDay)),
    sensitivities: i.head.sensitivities,
    forecast,
    diff: r.diff,
    explanation: r.explanation,
    provenance: r.plan.provenance,
    createdBy: i.createdBy,
    createdAt: i.createdAt,
  };
}

/** `VersionProposal` (§3.6) for the command layer. */
export function versionProposal(v: PlanVersionDoc, r: ReplanResult, head: PlanVersionDoc): { version: number; status: 'proposed' | 'adopted'; goalDates: ReplanResult['goalDates']; impact: Array<{ metric: MetricId; endP50Delta: number }>; notes: string[] } {
  const impact = r.forecast.asPrescribed.map((g) => {
    // the planner's own forecast of the plan before the change, from the same state (else the head's stored forecast)
    const before = r.forecast.before?.find((x) => x.goal === g.goal) ?? head.forecast.goals.find((x) => x.metric === g.metric);
    return { metric: g.metric, endP50Delta: before ? g.endP50 - before.endP50 : 0 };
  });
  return { version: v.version, status: v.status === 'adopted' ? 'adopted' : 'proposed', goalDates: r.goalDates, impact, notes: r.explanation };
}

/** Day-level diff of two schedules over [from, to) (fields: energy, exercise, meals, fast). */
export function scheduleDiff(head: Schedule, next: Schedule, startDate: LocalDate, from: number, to: number, why: string): ReplanResult['diff'] {
  const out: ReplanResult['diff'] = [];
  for (let d = from; d < Math.min(to, head.horizonDays, next.horizonDays); d++) {
    const a = templateOfDay(head, d);
    const b = templateOfDay(next, d);
    for (const f of ['energy', 'exercise', 'meals'] as const) {
      const x = JSON.stringify(a[f] ?? null);
      const y = JSON.stringify(b[f] ?? null);
      if (x !== y) out.push({ date: addDays(startDate, d), field: f, before: x, after: y, why });
    }
    const fa = JSON.stringify(fastEventOn(head, d) ?? null);
    const fb = JSON.stringify(fastEventOn(next, d) ?? null);
    if (fa !== fb) out.push({ date: addDays(startDate, d), field: 'fast', before: fa, after: fb, why });
  }
  return out;
}

// ------------------------------------------------------------------------------------------- legacy planner adapter
/**
 * TODO(E6): PLANNER_V2 §9.2 `replan` is not exposed yet. This adapter runs the v1 planner (`plan()` in Node/tests,
 * `planRegimes` from the worker client in the browser — E4 injects it) on the REMAINING horizon from the confirmed state:
 * the profile at today's trend weight, goals as absolute targets frozen at the plan start, the active plan's limits and
 * the user's changes; the past and the lock window (today, tomorrow) are copied from the active schedule; the result is
 * always a proposal (v1 cannot honour the churn limits) unless nothing changed. Warm start, churn keys and revealed
 * adherence in the forward model arrive with E6.
 */
export function legacyPlannerPort(planFn: (req: PlannerRequest) => Promise<PlannerResult>): PlannerPort {
  return {
    async replan(req) {
      const plan = req.plan;
      const todayIdx = daysBetween(plan.startDate, req.today);
      const remaining = Math.max(MIN_REPLAN_HORIZON_D, daysBetween(req.today, plan.endDate));
      const goals: RankedGoal[] = (req.changes?.goals ?? plan.request.goals).map((g) => ({ ...g }));
      const base = plan.request.profile;
      const request: PlannerRequest = {
        ...plan.request,
        profile: { ...base, body: { ...base.body, weightKg: Math.round(req.state.trendWeight.kg * 10) / 10 }, startDate: req.today },
        goals,
        horizonDays: Math.min(183, Math.max(28, remaining)),
        startDate: req.today,
        ...(req.changes?.constraints ? { constraints: req.changes.constraints } : {}),
        ...(req.changes?.safety ? { safety: req.changes.safety } : {}),
      };
      const res = await planFn(request);
      const rungIndex = { hard: 0, medium: 1, easy: 2 }[plan.kind as RungId] ?? 0;
      const opt = res.options[Math.min(rungIndex, res.options.length - 1)];
      if (res.status !== 'ok' || !opt) {
        return { status: 'noSafePlan', plan, diff: [], forecast: { asPrescribed: [], realistic: [], bands: {} }, goalDates: [], proposals: [], explanation: res.noSafePlanReasons.length > 0 ? res.noSafePlanReasons : [res.message ?? 'No safe plan from here.'], euUsed: res.provenance.euUsed };
      }
      const keep = Math.min(plan.schedule.horizonDays, todayIdx + 2);
      const H = Math.max(plan.schedule.horizonDays, todayIdx + opt.schedule.horizonDays);
      const progs = [...plan.schedule.programs];
      const offset = progs.length;
      progs.push(...opt.schedule.programs);
      const days = Array.from({ length: H }, (_, d) => {
        if (d < keep) return { ...plan.schedule.days[d]! };
        const j = d - todayIdx;
        const sd = opt.schedule.days[Math.min(j, opt.schedule.days.length - 1)]!;
        return { program: sd.program + offset, ...(sd.override ? { override: sd.override } : {}) };
      });
      const events = [
        ...(plan.schedule.events ?? []).filter((e) => e.startDay < keep),
        ...(opt.schedule.events ?? []).map((e) => ({ ...e, startDay: e.startDay + todayIdx })).filter((e) => e.startDay >= keep),
      ];
      const schedule: Schedule = { ...plan.schedule, horizonDays: H, programs: progs, days, events, blocks: [...(plan.schedule.blocks ?? []).filter((b) => b.startDay < keep).map((b) => ({ ...b, endDay: Math.min(b.endDay, keep) })), ...(opt.schedule.blocks ?? []).map((b) => ({ ...b, startDay: Math.max(keep, b.startDay + todayIdx), endDay: b.endDay + todayIdx })).filter((b) => b.endDay > b.startDay)] };
      const diff = scheduleDiff(plan.schedule, schedule, plan.startDate, todayIdx, todayIdx + 14, `re-plan (${req.trigger})`);
      const asPrescribed = opt.scorecard.map((g) => ({ goal: g.goal, metric: g.metric, endP50: g.band?.p50 ?? g.value, ...(g.band ? { p10: g.band.p10, p90: g.band.p90, pTargetMet: g.band.pTargetMet } : {}) }));
      return {
        status: diff.length === 0 ? 'unchanged' : 'proposal',
        plan: { ...plan, version: plan.version + 1, schedule, endDate: addDays(plan.startDate, H), provenance: { ...plan.provenance, ...res.provenance } },
        diff,
        forecast: { asPrescribed, realistic: asPrescribed, bands: {} },
        goalDates: [],
        proposals: [],
        explanation: opt.explanation,
        euUsed: res.provenance.euUsed,
      };
    },
  };
}
