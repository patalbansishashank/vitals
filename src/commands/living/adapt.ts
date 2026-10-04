/**
 * Adaptation commands of the living plan (E5b; docs/LIVING_PLAN.md §9, SUITE_SPEC §1.9 and §3.6, PLANNER_V2 §7):
 * `plan.replan`, `plan.declareEvent`, `plan.shift`, `plan.editDay` and `plan.swapExercise` replace E4's stubs.
 *
 * Every plan change runs the same path: the person's edit (if any) is applied to the adopted schedule by `@/living`'s
 * `edits.ts` and the days it touched are pinned; `buildReplanRequest` sends the confirmed state, the logged days since
 * the anchor and the revealed adherence to the planner's receding-horizon `replan` (the worker, `ctx.ports.living`),
 * which re-plans the other future days around the pinned ones (past immutable, today and tomorrow locked, churn limits
 * for the routine kinds). `checkReplan` + `adoptionPolicy` decide: the result is adopted at once only when every change
 * lowers load and the person (not the Coach or an agent) made it, otherwise it is a proposal the person applies with
 * `plan.adoptVersion` (the change card on Today). Writes are one plan version and the plan's head pointer, so Undo
 * (inverse patch) removes the version again.
 */
import type { ConcreteSession, PerformedExercise } from '@/catalogues';
import { runReplay } from '@/engine/assimilation';
import {
  absorbOccasion,
  addDays,
  adoptionPolicy,
  buildReplanRequest,
  chainEdits,
  checkReplan,
  compileVersion,
  confirmedStateFromRecord,
  daysBetween,
  DEFAULT_OCCASION_CARB_G,
  editDaysEdit,
  eventEdit,
  freezePrescription,
  headAdopted,
  planDay,
  projectLiving,
  realisedSchedule,
  shiftEdit,
  versionFromReplan,
  versionInForce,
  versionProposal,
  type ConfirmedState,
  type DeclaredEventKind,
  type LivingDocs,
  type PlanDoc,
  type PlanVersionDoc,
  type ReplanKind,
  type ReplanResult,
  type ReplanTrigger,
  type ScheduleEdit,
  type ShiftMode,
  type VersionReason,
} from '@/living';
import { catalogueWeekday, loadCatalogueModules, trainingSetupNow } from '../catalogue/setup';
import { fail } from '../registry';
import type { CommandContext } from '../types';
import { actorOf, implement, nextVersionNumber, readDocs, requirePlan, savePlan, type WithId } from './index';
import '../livingWiring';

/** Prior SD of the energy-balance bias before the first check-in (R11 δ prior, `biasPriorSdKcal`). */
const BIAS_PRIOR_SD = 150;
/** Diff rows returned to the caller (the version keeps them all). */
const DIFF_ROWS = 40;

type Plan = WithId<PlanDoc>;

/** The latest confirmed state, or the plan start's when no check-in anchored one yet. */
function confirmedState(docs: LivingDocs, plan: Plan, head: PlanVersionDoc, past: Parameters<typeof realisedSchedule>[2], today: string): ConfirmedState {
  const latest = [...docs.records].sort((a, b) => a.anchorDay - b.anchorDay).pop();
  if (latest) return confirmedStateFromRecord(plan, realisedSchedule(plan, head, past, today), docs.records, latest);
  const r = runReplay({ profile: plan.baselineProfile, schedule: head.schedule, captureAt: [0], record: 'none' });
  const snapshot = r.snapshots[0] ?? fail('internal', 'The plan start could not be simulated.');
  return { anchorDate: plan.startDate, snapshot, energyBiasKcal: { mean: 0, sd: BIAS_PRIOR_SD }, trendWeight: { kg: plan.baselineProfile.body.weightKg, sd: 0.5 } };
}

interface ReplanRun {
  kind: ReplanKind;
  trigger: ReplanTrigger;
  reason: VersionReason;
  why: string;
  edit?: ScheduleEdit;
  /** Edits must stay safe: a result with no safe plan refuses the edit. */
  strict: boolean;
  extraNotes?: string[];
}

export interface AdaptOutput {
  planId: string;
  /** null when nothing was written (no change, or no safe plan). */
  version: number | null;
  status: 'proposed' | 'adopted' | 'unchanged' | 'noSafePlan';
  goalDates: ReplanResult['goalDates'];
  impact: Array<{ metric: string; endP50Delta: number }>;
  notes: string[];
  diff: ReplanResult['diff'];
  /** Days the person's edit fixed (dates). */
  pinned: string[];
  /** The change card id the Living screens and the Coach use (`version:<planId>:<n>`). */
  cardId: string | null;
}

/** Edit → re-plan request → planner → policy → version (proposed or adopted). */
async function runReplan(ctx: CommandContext, docs: LivingDocs, plan: Plan, head: PlanVersionDoc, o: ReplanRun, opts: { tier?: 'S' | 'M' | 'L' | 'X' } = {}): Promise<AdaptOutput> {
  const port = ctx.ports.living?.planner ?? fail('precondition_failed', 'The planner is not ready yet; try again in a moment.', { retryable: true });
  const today = ctx.today < plan.startDate ? plan.startDate : ctx.today;
  const todayIdx = planDay(plan, today);
  const p = projectLiving({ docs, today, tz: ctx.tz, now: ctx.now, skipAssimilation: true });
  const past = p.days.filter((d) => d.date < today).map((d) => d.result);
  const state = confirmedState(docs, plan, head, past, today);
  const base = buildReplanRequest({
    decision: { kind: o.kind, trigger: o.trigger, reason: o.why },
    today,
    plan,
    head,
    state,
    // days with something logged; an unlogged day is unknown, and the planner's revealed adherence already covers it
    logs: past.map((r) => r.loggedDay).filter((l) => l.coverage > 0),
    adherence: p.blocks,
    ...(o.edit?.horizonDays !== undefined ? { changes: { horizonDays: o.edit.horizonDays } } : {}),
  });
  const req = o.edit ? { ...base, plan: { ...base.plan, schedule: o.edit.schedule }, pinnedDays: o.edit.pinned, baseline: head.schedule } : base;
  const result = await port.replan(req, { signal: ctx.signal, ...(opts.tier ? { tier: opts.tier } : {}) });
  const pinned = (o.edit?.pinned ?? []).map((d) => addDays(plan.startDate, d));
  const empty = { planId: plan.id, version: null, goalDates: result.goalDates, impact: [], diff: [], pinned, cardId: null };
  if (result.status === 'noSafePlan') {
    if (o.strict) fail('invalid_input', ['That change would leave no safe plan, so nothing was changed.', ...result.explanation.slice(1, 2)].join(' '));
    return { ...empty, status: 'noSafePlan', notes: result.explanation };
  }
  if (result.status === 'unchanged') return { ...empty, status: 'unchanged', notes: result.explanation };

  const check = checkReplan(head.schedule, result.plan.schedule, Math.max(0, todayIdx), o.kind === 'light' || o.kind === 'weekly' ? o.kind : 'event');
  const policy = adoptionPolicy(check, { kind: o.kind, autoApplyLoadLowering: plan.policy.autoApplyLoadLowering, status: result.status });
  if (policy === 'reject') fail('internal', 'The re-plan changed days already lived; nothing was changed.');
  // a change the Coach or an agent made is always a proposal (SUITE_SPEC §1.4); the person's own lighter change applies
  const adoption = policy === 'adopt' && (ctx.actor.kind === 'user' || ctx.actor.kind === 'system') ? 'adopt' : 'propose';
  const v = versionFromReplan({ result, plan: { ...plan, headVersion: nextVersionNumber(plan) - 1 }, head, today, reason: o.reason, adoption, createdBy: actorOf(ctx), createdAt: ctx.now });
  const notes = [...(o.edit?.notes ?? []), ...(o.extraNotes ?? []), ...result.explanation];
  const version: PlanVersionDoc = { ...v, explanation: notes, ...(o.edit?.horizonDays !== undefined ? { plannedEndDate: addDays(plan.startDate, result.plan.schedule.horizonDays) } : {}) };
  await ctx.docs.append('planVersions', { ...version, _id: `${plan.id}:v${version.version}` });
  await savePlan(ctx, { ...plan, headVersion: version.version, ...(adoption === 'adopt' && version.plannedEndDate ? { plannedEndDate: version.plannedEndDate } : {}) });
  const vp = versionProposal(version, result, head);
  return { planId: plan.id, version: version.version, status: vp.status, goalDates: vp.goalDates, impact: vp.impact, notes, diff: (version.diff ?? []).slice(0, DIFF_ROWS), pinned, cardId: `version:${plan.id}:${version.version}` };
}

/** The running plan, its adopted head and the documents. */
async function running(): Promise<{ docs: Awaited<ReturnType<typeof readDocs>>; plan: Plan; head: PlanVersionDoc }> {
  const docs = await readDocs();
  const plan = requirePlan(docs);
  if (plan.status !== 'active' && plan.status !== 'scheduled') fail('precondition_failed', 'The plan is paused; resume it first.', { precondition: 'activePlan' });
  const head = headAdopted(docs.versions) ?? fail('internal', 'The plan has no adopted version.');
  return { docs, plan, head };
}

/** Plan-day index of a date that may change (today or later, inside the plan). */
function futureDay(ctx: CommandContext, plan: Plan, head: PlanVersionDoc, date: string, path: string, opts: { allowEnd?: boolean } = {}): number {
  const d = planDay(plan, date);
  if (date < ctx.today) fail('invalid_input', 'Days already lived cannot change; pick today or a later day.', { path });
  if (d < 0 || d > head.schedule.horizonDays - (opts.allowEnd ? 0 : 1)) fail('invalid_input', 'That date is outside the plan.', { path });
  return d;
}

/** Energy and carbohydrate a future day prescribes now (socialMeal / absorb occasions add to these). */
function currentOf(ctx: CommandContext, plan: Plan, head: PlanVersionDoc): (d: number) => { energyKcal: number; carbG: number } {
  const compiled = compileVersion(plan.baselineProfile, head.schedule);
  return (d) => {
    const rx = freezePrescription({ plan, version: head, date: addDays(plan.startDate, d), tz: ctx.tz, compiled });
    return { energyKcal: rx.energyKcal, carbG: rx.macros.carbG };
  };
}

// ------------------------------------------------------------------------------------------- plan.replan
implement('plan.replan', async (ctx, input: { reason?: string; tier?: 'S' | 'M' | 'L' | 'X' }) => {
  const { docs, plan, head } = await running();
  return runReplan(ctx, docs, plan, head, { kind: 'event', trigger: 'user', reason: 'user', why: input.reason ?? 'You asked for a new plan from here.', strict: false }, input.tier ? { tier: input.tier } : {});
});

// ------------------------------------------------------------------------------------------- plan.declareEvent
const EVENT_WORDS: Record<DeclaredEventKind, string> = {
  noTraining: 'No training on those days.',
  busy: 'Busy days: no training, food as planned.',
  travel: 'Travel: no training and no fasting, food as planned.',
  illness: 'Illness: habitual food, no training and no fasting until you are well. Rest comes first.',
  socialMeal: 'A meal out: the extra food is planned in.',
};

implement('plan.declareEvent', async (ctx, input: { kind: DeclaredEventKind; from: string; to: string; note?: string; extraKcal?: number; extraCarbG?: number }) => {
  const { docs, plan, head } = await running();
  if (input.to < input.from) fail('invalid_input', 'The end date is before the start date.', { path: '/to' });
  if (daysBetween(input.from, input.to) > 27) fail('invalid_input', 'An event can last up to 28 days; pause the plan for longer breaks.', { path: '/to' });
  const fromDay = futureDay(ctx, plan, head, input.from, '/from');
  const toDay = Math.min(head.schedule.horizonDays - 1, planDay(plan, input.to));
  const edit = eventEdit(head.schedule, plan.startDate, plan.baselineProfile, { kind: input.kind, fromDay, toDay, ...(input.extraKcal !== undefined ? { extraKcal: input.extraKcal } : {}), ...(input.extraCarbG !== undefined ? { extraCarbG: input.extraCarbG } : {}), ...(input.note ? { note: input.note } : {}) }, currentOf(ctx, plan, head));
  return runReplan(ctx, docs, plan, head, { kind: 'weekly', trigger: 'absence', reason: 'event', why: `Declared ${input.kind} from ${input.from} to ${input.to}.`, edit: { ...edit, notes: [EVENT_WORDS[input.kind], ...edit.notes] }, strict: true });
});

// ------------------------------------------------------------------------------------------- plan.shift
interface ShiftIn {
  from: string;
  days: number;
  mode: ShiftMode;
  withDate?: string;
  absorb?: { date: string; extraKcal?: number; extraCarbG?: number; note?: string };
  replanRest?: boolean;
}

implement('plan.shift', async (ctx, input: ShiftIn) => {
  const { docs, plan, head } = await running();
  const fromDay = futureDay(ctx, plan, head, input.from, '/from');
  if (input.mode === 'swap' && !input.withDate) fail('invalid_input', 'Say which date to swap with.', { path: '/withDate' });
  const withDay = input.withDate ? futureDay(ctx, plan, head, input.withDate, '/withDate') : undefined;
  if (withDay !== undefined && Math.abs(withDay - fromDay) < input.days) fail('invalid_input', 'The two stretches overlap.', { path: '/withDate' });
  let edit = shiftEdit(head.schedule, plan.startDate, plan.baselineProfile, { fromDay, days: input.days, mode: input.mode, ...(withDay !== undefined ? { withDay } : {}) });
  if (input.absorb) {
    const d = futureDay(ctx, plan, head, input.absorb.date, '/absorb/date');
    const occasionDay = input.mode === 'pushBack' && d >= fromDay ? d + input.days : d;
    const cur = currentOf(ctx, plan, { ...head, schedule: edit.schedule });
    const a = input.absorb;
    const carb = a.extraKcal === undefined && a.extraCarbG === undefined ? DEFAULT_OCCASION_CARB_G : a.extraCarbG;
    edit = chainEdits(edit, absorbOccasion(edit.schedule, { day: occasionDay, ...(a.extraKcal !== undefined ? { extraKcal: a.extraKcal } : {}), ...(carb !== undefined ? { extraCarbG: carb } : {}), ...(a.note ? { note: a.note } : {}) }, cur(occasionDay)));
  }
  if (edit.pinned.length === 0) fail('invalid_input', edit.notes[0] ?? 'Nothing to change on those days.');
  // replanRest false: the other days stay; the planner still reports the forecast and goal dates of the edit alone
  if (input.replanRest === false) edit = { ...edit, pinned: Array.from({ length: Math.max(0, (edit.horizonDays ?? head.schedule.horizonDays) - Math.max(0, planDay(plan, ctx.today))) }, (_, k) => Math.max(0, planDay(plan, ctx.today)) + k) };
  return runReplan(ctx, docs, plan, head, { kind: 'weekly', trigger: 'absence', reason: 'event', why: `Shifted ${input.days} day${input.days === 1 ? '' : 's'} from ${input.from} (${input.mode}).`, edit, strict: true });
});

// ------------------------------------------------------------------------------------------- plan.editDay
implement('plan.editDay', async (ctx, input: { date: string; patch: Record<string, unknown>; scope: 'day' | 'weekday' | 'rest' }) => {
  const { docs, plan, head } = await running();
  const day = futureDay(ctx, plan, head, input.date, '/date');
  if (Object.keys(input.patch).length === 0) fail('invalid_input', 'The change is empty.', { path: '/patch' });
  const edit = editDaysEdit(head.schedule, { day, patch: input.patch, scope: input.scope });
  return runReplan(ctx, docs, plan, head, { kind: 'weekly', trigger: 'user', reason: 'user', why: 'Fits the plan around the days you changed.', edit, strict: true });
});

// ------------------------------------------------------------------------------------------- plan.swapExercise
interface SwapIn {
  date: string;
  slotKey: string;
  from: string;
  to: string | PerformedExercise;
  everyWeek?: boolean;
}

implement('plan.swapExercise', async (ctx, input: SwapIn) => {
  const { docs, plan, head } = await running();
  const day = futureDay(ctx, plan, head, input.date, '/date');
  const m = await loadCatalogueModules();
  const setup = trainingSetupNow(m);
  const version = versionInForce(docs.versions, day) ?? head;
  const compiled = compileVersion(plan.baselineProfile, version.schedule);
  const compose = (d: number) => {
    const date = addDays(plan.startDate, d);
    const rx = freezePrescription({ plan, version, date, tz: ctx.tz, compiled });
    const weekday = catalogueWeekday(date);
    return rx.sessions.map((s) => ({ s, weekday, session: (s.concrete as ConcreteSession | null) ?? m.cat.composeSession(m.cat.prescriptionFromEngine(s.kind, s.engine, { weekday, startH: s.startH, durationMin: s.durationMin }), { profile: setup.profile, catalogue: setup.catalogue, ctx: setup.ctx }) }));
  };
  const slot = compose(day).find((x) => x.s.slotKey === input.slotKey) ?? fail('not_found', 'There is no such session that day.', { path: '/slotKey' });
  const idx = slot.session.items.findIndex((it) => it.exerciseId === input.from);
  if (idx < 0) fail('not_found', 'That exercise is not in the session.', { path: '/from' });
  const item = slot.session.items[idx]!;
  let perf: PerformedExercise;
  if (typeof input.to === 'string') {
    const ex = setup.catalogue.exercise(input.to) ?? fail('not_found', 'There is no such exercise in the catalogue.', { path: '/to' });
    const opt = m.cat.swapOptions([item.perf], { profile: setup.profile, catalogue: setup.catalogue, ctx: setup.ctx, weekday: slot.weekday, startH: slot.s.startH }).find((o) => o.exerciseId === ex.id);
    perf = opt?.perf ?? (item.sets !== undefined ? { exerciseId: ex.id, setCount: item.sets } : { exerciseId: ex.id, minutes: Math.max(1, Math.round(item.minutes)) });
  } else {
    perf = input.to;
    if (!perf.exerciseId || !setup.catalogue.exercise(perf.exerciseId)) fail('not_found', 'There is no such exercise in the catalogue.', { path: '/to' });
  }
  const before = slot.session.items.map((it) => it.perf);
  const after = before.map((p, k) => (k === idx ? perf : p));
  const equivalence = m.cat.sessionEquivalence(before, after, setup.catalogue, setup.ctx);
  const toName = setup.catalogue.exercise(perf.exerciseId!)?.name ?? perf.exerciseId!;
  const swap = { slotKey: input.slotKey, from: input.from, to: perf, credit: equivalence.credit, band: equivalence.band };

  if (!input.everyWeek) {
    // this day only: kept on the day's record (synced), the Train screen shows it and logging credits the swap
    const date = input.date;
    const prev = docs.dayStatus.find((s) => s.date === date);
    const swaps = { ...(prev?.swaps ?? {}), [input.slotKey]: [...(prev?.swaps?.[input.slotKey] ?? []).filter((x) => x.from !== input.from), swap] };
    await ctx.docs.put('dayStatus', { ...prev, date, planId: plan.id, planDay: day, swaps, _id: `day:${date}` });
    return { equivalence, swap, everyWeek: false, cardId: null, version: null, notes: [`${item.name} → ${toName} on ${date}.`] };
  }

  // every week: a version whose sessions on this weekday from this date on carry the swap (a proposal; weekly dose shown)
  const sessions: PlanVersionDoc['sessions'] = { ...head.sessions };
  let weekBefore = 0;
  let weekAfter = 0;
  let weeks = 0;
  for (let d = day; d < head.schedule.horizonDays; d += 7) {
    const sl = compose(d).find((x) => x.s.slotKey.endsWith(`:${input.slotKey.split(':')[1]}`));
    if (!sl) continue;
    const k = sl.session.items.findIndex((it) => it.exerciseId === input.from);
    if (k < 0) continue;
    const items = sl.session.items.map((it, j) => (j === k ? { ...it, exerciseId: perf.exerciseId!, name: toName, perf, text: `${toName} (instead of ${it.name})` } : it));
    const eq = m.cat.sessionEquivalence(sl.session.items.map((it) => it.perf), items.map((it) => it.perf), setup.catalogue, setup.ctx);
    sessions[sl.s.slotKey] = { ...sl.session, items, equivalence: eq };
    weekBefore += 1;
    weekAfter += eq.credit;
    weeks++;
  }
  if (weeks === 0) fail('not_found', 'That exercise is not in this session on later weeks.', { path: '/from' });
  const n = nextVersionNumber(plan);
  const weekly = { weeks, meanCredit: weekAfter / weekBefore };
  const v: PlanVersionDoc = {
    ...head,
    version: n,
    parent: head.version,
    status: 'proposed',
    reason: 'user',
    effectiveFromDay: day,
    sessions,
    diff: [{ date: input.date, field: 'exercise', before: item.name, after: toName, why: `The same weekday every week (${weeks} sessions); ${Math.round(weekly.meanCredit * 100)} % of the prescribed stimulus.` }],
    explanation: [`Use ${toName} instead of ${item.name} on this weekday every week from ${input.date} (${weeks} sessions).`, `It keeps ${Math.round(weekly.meanCredit * 100)} % of the prescribed training stimulus.`],
    createdBy: actorOf(ctx),
    createdAt: ctx.now,
  };
  await ctx.docs.append('planVersions', { ...v, _id: `${plan.id}:v${n}` });
  await savePlan(ctx, { ...plan, headVersion: n });
  return { equivalence, swap, everyWeek: true, weekly, version: n, status: 'proposed', cardId: `version:${plan.id}:${n}`, notes: v.explanation };
});
