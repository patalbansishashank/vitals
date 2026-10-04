/**
 * Living-plan executors (E5) for the stubs E4 declared in `../defs/living.ts`: ids, schemas, permissions, surfaces, undo
 * and idempotency stay E4's; importing this module (after the defs) replaces each stub's `execute`. Wiring (E4): add
 * `import './living';` after `import './defs/living';` in `src/commands/index.ts`.
 *
 * The behaviour lives in the pure `@/living` package (docs/LIVING_PLAN.md); these functions only read the documents,
 * call it, and write the result through the command's transaction. Commands that need other packages' ports stay stubs
 * until those land: `log.meal`/`log.mealFromPhoto` (E8 food table, E9 vision), `log.session` (E8 catalogue resolution),
 * `log.bulk`. The adaptation commands (`plan.replan`, `plan.declareEvent`, `plan.shift`, `plan.editDay`,
 * `plan.swapExercise`) are in `./adapt.ts` (E5b).
 * `log.fromBiometrics` maps the biometrics documents to entries with `@/biometrics/core/deviceLogs` (loaded on use).
 */
import { MEASUREMENT_METRICS } from '../defs/living';
import { bodyOf, type Doc } from '@/store';
import { getDocumentStore } from '@/state/runtime';
import { sharedBioIndex } from '@/biometrics/store/docIndex';
import { appDay, rolloverOf } from '@/living/appDay';
import * as planner from '@/state/internal/planner';
import * as sched from '@/state/internal/schedule';
import { settingsValues } from '@/state/internal/settings';
import { simulatorProfileNow } from '@/state/internal/simulatorProfile';
import {
  addDays,
  anchorsFromRecords,
  blockStartsOf,
  canDiscard,
  endPlan,
  headAdopted,
  isLive,
  OPTION_OF_RUNG,
  pausePlan,
  planDay,
  planLength,
  projectLiving,
  realisedSchedule,
  resumePlan,
  resumeSchedule,
  RUNG_OF_OPTION,
  startFromRung,
  startFromScenario,
  weeklyCheckIn,
  weighInsFor,
  aiEnergyShare,
  effectiveEntries,
  type Actor as LivingActor,
  type ConfirmedStateRecord,
  type DayStatusDoc,
  type EndReason,
  type EntrySource,
  type LivingDocs,
  type LogEntry,
  type Mark,
  type MeasurementEntry,
  type MeasurementMetric,
  type PlanDoc,
  type PlannerProvenanceV2,
  type PlanVersionDoc,
  type RungId,
  type StartOutcome,
  type Weekday,
} from '@/living';
import { defineCommand, fail, getCommand } from '../registry';
import { T, Value, type JsonSchema } from '../schema';
import type { CommandContext, CommandDef } from '../types';

type Exec = (ctx: CommandContext, input: never) => unknown;

/** Replace a stub's executor; ids E4 no longer declares are skipped. Returns the ids implemented. */
const implemented: string[] = [];
export function implement(id: string, execute: Exec): void {
  const def = getCommand(id);
  if (!def) return;
  const { notImplemented: _stub, ...rest } = def;
  void _stub;
  // living writes read the store, not each other's buffers: they run one at a time (two taps on "start" started two plans)
  defineCommand({ ...rest, ...(def.perm === 'read' ? {} : { serial: 'living' }), execute: execute as CommandDef['execute'] } as CommandDef);
  implemented.push(id);
}

/** Ids whose stub executor this module replaced (tests, `app.status`). */
export function livingImplemented(): readonly string[] {
  return implemented;
}

// ------------------------------------------------------------------------------------------- documents
export type WithId<T> = T & { id: string };
const withId = <T>(d: Doc<unknown>): WithId<T> => ({ ...bodyOf<T>(d), id: d._id });

export async function readDocs(): Promise<LivingDocs & { plans: WithId<PlanDoc>[] }> {
  const store = getDocumentStore();
  await store.ready;
  const active = store.peek<{ planId: string | null }>('activePlan', 'me');
  const plans = store.peekAll<PlanDoc>('plans').map((d) => withId<PlanDoc>(d));
  const byActive = active?.planId ? plans.find((p) => p.id === active.planId) : undefined;
  const live = plans.filter(isLive).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
  const plan = byActive ?? live ?? null;
  const settings = settingsValues() as unknown as Record<string, unknown>;
  return {
    plans,
    plan,
    versions: plan ? store.peekAll<PlanVersionDoc>('planVersions').map((d) => bodyOf<PlanVersionDoc>(d)).filter((v) => v.planId === plan.id) : [],
    dayStatus: store.peekAll<DayStatusDoc>('dayStatus').map((d) => bodyOf<DayStatusDoc>(d)),
    entries: store.peekAll<LogEntry>('dailyLogs').map((d) => withId<LogEntry>(d)),
    measurements: store.peekAll<MeasurementEntry>('measurements').map((d) => withId<MeasurementEntry>(d)),
    records: plan ? store.peekAll<ConfirmedStateRecord>('anchors').map((d) => bodyOf<ConfirmedStateRecord>(d)).filter((r) => r.planId === plan.id) : [],
    settings: {
      ...(typeof settings.quietMode === 'boolean' ? { quietMode: settings.quietMode } : {}),
      ...(typeof settings.dayRolloverH === 'number' ? { dayRolloverH: settings.dayRolloverH } : {}),
    },
  };
}

export function requirePlan(docs: LivingDocs): WithId<PlanDoc> {
  if (!docs.plan || !isLive(docs.plan)) fail('precondition_failed', 'There is no running plan.', { precondition: 'activePlan' });
  return docs.plan as WithId<PlanDoc>;
}

function sourceOf(ctx: CommandContext, method: EntrySource['method'] = 'typed'): EntrySource {
  const k = ctx.actor.kind;
  const by: EntrySource['by'] = k === 'user' ? 'user' : k === 'system' ? 'system' : k === 'companion' ? 'import' : 'ai';
  return {
    by,
    method: by === 'ai' && method === 'typed' ? 'aiText' : method,
    ...(ctx.actor.conversationId ? { conversationId: ctx.actor.conversationId } : {}),
    ...(ctx.actor.toolCallId ? { toolCallId: ctx.actor.toolCallId } : {}),
    actorId: ctx.actor.id,
  };
}

export function actorOf(ctx: CommandContext): LivingActor {
  const k = ctx.actor.kind;
  return { kind: k === 'user' ? 'user' : k === 'system' ? 'system' : k === 'companion' ? 'import' : 'ai', id: ctx.actor.id };
}

const planBody = (p: WithId<PlanDoc>): PlanDoc => {
  const { id: _id, ...rest } = p;
  void _id;
  return rest;
};

export async function savePlan(ctx: CommandContext, p: WithId<PlanDoc>): Promise<void> {
  await ctx.docs.put('plans', { ...planBody(p), _id: p.id });
}

async function appendEntry(ctx: CommandContext, e: Omit<LogEntry, 'id'> & { id?: string }): Promise<{ entryId: string }> {
  const id = e.id ?? ctx.newId();
  const docs = await readDocs();
  const plan = docs.plan && isLive(docs.plan) ? docs.plan : null;
  const body = { ...e, ...(plan ? { planId: plan.id, planDay: planDay(plan, e.date) } : {}) } as LogEntry;
  const { id: _drop, ...rest } = body;
  void _drop;
  await ctx.docs.append('dailyLogs', { ...rest, _id: id });
  return { entryId: id };
}

// ------------------------------------------------------------------------------------------- reads
implement('today.get', async (ctx, input: { date?: string }) => {
  const docs = await readDocs();
  return projectLiving({ docs, today: input.date ?? ctx.today, tz: ctx.tz, now: ctx.now }).today;
});

implement('day.get', async (ctx, input: { date?: string }) => {
  const docs = await readDocs();
  const date = input.date ?? ctx.today;
  const p = projectLiving({ docs, today: date > ctx.today ? date : ctx.today, tz: ctx.tz, now: ctx.now, skipAssimilation: true });
  const day = p.days.find((d) => d.date === date) ?? null;
  return {
    date,
    planDay: day?.planDay ?? null,
    prescription: day?.prescription ?? null,
    entries: effectiveEntries(docs.entries).filter((e) => e.date === date),
    marks: docs.dayStatus.find((s) => s.date === date)?.marks ?? {},
    score: day?.result.score ?? null,
    items: day?.result.loggedDay.items ?? [],
  };
});

implement('plan.get', async (ctx) => {
  const docs = await readDocs();
  const plan = docs.plan;
  if (!plan) return { plan: null };
  const head = headAdopted(docs.versions);
  return {
    plan: { id: plan.id, name: plan.name, rung: plan.rung, status: plan.status, startDate: plan.startDate, plannedEndDate: plan.plannedEndDate, day: planDay(plan, ctx.today) + 1, of: planLength(plan), headVersion: head?.version ?? null, intentions: plan.intentions, policy: plan.policy, pauses: plan.pauses, ended: plan.ended ?? null },
    today: projectLiving({ docs, today: ctx.today, tz: ctx.tz, now: ctx.now, skipAssimilation: true }).today.prescription,
  };
});

implement('plan.versions', async (_ctx, input: { planId?: string }) => {
  const docs = await readDocs();
  const store = getDocumentStore();
  const pid = input.planId ?? docs.plan?.id;
  const versions = pid ? store.peekAll<PlanVersionDoc>('planVersions').map((d) => bodyOf<PlanVersionDoc>(d)).filter((v) => v.planId === pid) : [];
  return versions
    .sort((a, b) => a.version - b.version)
    .map((v) => ({ version: v.version, parent: v.parent, status: v.status, reason: v.reason, effectiveFromDay: v.effectiveFromDay, createdAt: v.createdAt, explanation: v.explanation, diff: v.diff ?? [] }));
});

implement('plan.adherence', async (ctx, input: { from?: string; to?: string }) => {
  const docs = await readDocs();
  const p = projectLiving({ docs, today: ctx.today, tz: ctx.tz, now: ctx.now, skipAssimilation: true });
  const days = p.days.filter((d) => (!input.from || d.date >= input.from) && (!input.to || d.date <= input.to));
  return { days: days.map((d) => ({ date: d.date, score: d.result.score.score, coverage: d.result.score.coverage, final: d.result.score.final })), trend: p.trend, blocks: p.blocks };
});

implement('plan.drift', async (ctx) => {
  const docs = await readDocs();
  return projectLiving({ docs, today: ctx.today, tz: ctx.tz, now: ctx.now }).drift ?? { asOf: ctx.today, goals: [] };
});

implement('log.get', async (_ctx, input: { from: string; to: string; kinds?: string[] }) => {
  const docs = await readDocs();
  return effectiveEntries(docs.entries).filter((e) => e.date >= input.from && e.date <= input.to && (!input.kinds || input.kinds.includes(e.kind)));
});

// ------------------------------------------------------------------------------------------- plan lifecycle
interface StartIn {
  source: { rung: string } | { scenarioId: string };
  startDate: string;
  name?: string;
  intentions?: PlanDoc['intentions'];
  checkInWeekday?: Weekday;
}

/** Build and write the start documents (`plan.start`, and `plan.replace` after it ended the running plan). */
async function startPlan(ctx: CommandContext, input: StartIn): Promise<{ planId: string; version: 1; anchorNotes: string[] }> {
  const sctx = { planId: ctx.newId(), now: ctx.now, today: ctx.today, createdBy: actorOf(ctx), versions: { engineVersion: '', registryHash: '', catalogueVersion: '' } };
  const common = {
    startDate: input.startDate,
    ...(input.name ? { name: input.name } : {}),
    ...(input.intentions ? { intentions: input.intentions } : {}),
    ...(input.checkInWeekday !== undefined ? { checkInWeekday: input.checkInWeekday } : {}),
  };
  let out: StartOutcome;
  if ('rung' in input.source) {
    const run = planner.runState();
    const res = run.result;
    const req = run.request;
    if (!res || !req) fail('not_found', 'Find plans in the Planner first.');
    const key = input.source.rung;
    const optionId = key === 'A' || key === 'B' || key === 'C' ? key : OPTION_OF_RUNG[key as RungId];
    if (!optionId) fail('invalid_input', 'The rung is hard, medium or easy.');
    const option = res!.options.find((o) => o.id === optionId) ?? fail('not_found', 'That plan is not in the current Planner result.');
    const meta = option.simulation?.meta;
    const versions = { ...sctx.versions, ...(meta ? { engineVersion: meta.engineVersion, registryHash: meta.registryHash } : {}) };
    out = startFromRung({ ...sctx, versions }, option, req!, RUNG_OF_OPTION[option.id], res!.provenance as PlannerProvenanceV2, common);
  } else {
    const sc = sched.scenarioById(input.source.scenarioId) ?? fail('not_found', 'There is no such scenario.');
    // the goal set as the last Planner run saw it (ranked goals); a scenario without a run starts without goals
    const goals = planner.runState().request?.goals ?? [];
    out = startFromScenario(sctx, { id: sc.id, rev: sc.updatedAt, name: sc.name, schedule: sc.schedule }, simulatorProfileNow(ctx.now), goals, common);
  }
  if (!out.ok) fail('invalid_input', out.reason);
  const ok = out as Extract<StartOutcome, { ok: true }>;
  await savePlan(ctx, ok.plan);
  await ctx.docs.append('planVersions', { ...ok.version, _id: `${ok.plan.id}:v1` });
  await ctx.docs.put('activePlan', { _id: 'me', planId: ok.plan.id, since: ok.plan.startDate });
  return { planId: ok.plan.id, version: 1, anchorNotes: ok.anchorNotes };
}

implement('plan.start', async (ctx, input: StartIn) => {
  const docs = await readDocs();
  if (docs.plan && isLive(docs.plan)) fail('precondition_failed', 'A plan is already running; end or replace it first.', { precondition: 'noActivePlan' });
  return startPlan(ctx, input);
});

implement('plan.replace', async (ctx, input: StartIn & { reason: 'replaced' }) => {
  const docs = await readDocs();
  const plan = requirePlan(docs);
  const t = endPlan(plan, ctx.now, ctx.today, 'replaced');
  if (!t.ok) fail('precondition_failed', t.reason, { precondition: 'activePlan' });
  await savePlan(ctx, { ...t.plan, id: plan.id });
  const { reason: _reason, ...start } = input;
  void _reason;
  return { ...(await startPlan(ctx, start)), replaced: plan.id };
});

implement('plan.discard', async (ctx, input: { planId: string }) => {
  const docs = await readDocs();
  const plan = docs.plans.find((p) => p.id === input.planId) ?? fail('not_found', 'There is no such plan.');
  const hasLogs = effectiveEntries(docs.entries).some((e) => e.planId === plan.id && !e.assumed);
  const can = canDiscard(plan, ctx.now, hasLogs);
  if (!can.ok) fail('conflict', can.reason ?? 'The plan cannot be discarded.');
  await ctx.docs.remove('plans', plan.id);
  for (const v of docs.versions) await ctx.docs.remove('planVersions', `${plan.id}:v${v.version}`);
  await ctx.docs.put('activePlan', { _id: 'me', planId: null, since: ctx.today });
  return { discarded: true };
});

implement('plan.pause', async (ctx, input: { from?: string; reason?: string }) => {
  const docs = await readDocs();
  const plan = requirePlan(docs);
  const t = pausePlan(plan, input.from ?? ctx.today, input.reason);
  if (!t.ok) fail('precondition_failed', t.reason, { precondition: 'activePlan' });
  await savePlan(ctx, { ...t.plan, id: plan.id });
  return { plan: { ...t.plan, id: plan.id }, notes: t.notes };
});

implement('plan.resume', async (ctx, input: { from?: string }) => {
  const docs = await readDocs();
  const plan = requirePlan(docs);
  const t = resumePlan(plan, input.from ?? ctx.today, ctx.actor.kind === 'user' ? 'user' : 'ai');
  if (!t.ok) fail('precondition_failed', t.reason, { precondition: 'activePlan' });
  const head = headAdopted(docs.versions) ?? fail('internal', 'The plan has no adopted version.');
  let version: number = head.version;
  if (t.shift && t.shift.R > t.shift.P) {
    const { schedule } = resumeSchedule(head.schedule, t.shift.P, t.shift.R);
    version = nextVersionNumber(plan);
    const v: PlanVersionDoc = { ...head, version, parent: head.version, status: 'adopted', reason: 'resume', effectiveFromDay: t.shift.R, schedule, diff: [], explanation: t.notes, createdBy: actorOf(ctx), createdAt: ctx.now };
    await ctx.docs.append('planVersions', { ...v, _id: `${plan.id}:v${version}` });
  }
  const next = { ...t.plan, headVersion: version, id: plan.id };
  await savePlan(ctx, next);
  return { plan: next, notes: t.notes };
});

implement('plan.end', async (ctx, input: { reason: EndReason; note?: string }) => {
  const docs = await readDocs();
  const plan = requirePlan(docs);
  const t = endPlan(plan, ctx.now, ctx.today, input.reason, input.note);
  if (!t.ok) fail('precondition_failed', t.reason, { precondition: 'activePlan' });
  await savePlan(ctx, { ...t.plan, id: plan.id });
  await ctx.docs.put('activePlan', { _id: 'me', planId: null, since: ctx.today });
  return { plan: { ...t.plan, id: plan.id } };
});

/**
 * The number a new version of `plan` takes: past every version id ever written for it. An undone version leaves a
 * tombstone and append never reuses an id, so `headVersion + 1` collided after an Undo (Q4: "v3 already exists").
 */
export function nextVersionNumber(plan: { id: string; headVersion: number }): number {
  let max = plan.headVersion;
  for (const d of getDocumentStore().peekAll<PlanVersionDoc>('planVersions', { includeDeleted: true })) {
    const m = d._id.startsWith(`${plan.id}:v`) ? /:v(\d+)$/.exec(d._id) : null;
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

async function setVersionStatus(ctx: CommandContext, input: { planId: string; version: number }, status: 'adopted' | 'rejected'): Promise<unknown> {
  const docs = await readDocs();
  const plan = docs.plans.find((p) => p.id === input.planId) ?? fail('not_found', 'There is no such plan.');
  const store = getDocumentStore();
  const v = store.peekAll<PlanVersionDoc>('planVersions').map((d) => bodyOf<PlanVersionDoc>(d)).find((x) => x.planId === plan.id && x.version === input.version) ?? fail('not_found', 'There is no such version.');
  if (v.status !== 'proposed') fail('conflict', 'Only a proposed version can be adopted or rejected.');
  if (store.peekAll<PlanVersionDoc>('planVersions').some((d) => { const x = bodyOf<PlanVersionDoc>(d); return x.planId === plan.id && x.parent === v.version && x.status !== 'proposed'; }))
    fail('conflict', 'That change was already applied or discarded.');
  // planVersions are immutable: the decision is a new version document carrying the same content
  const n = nextVersionNumber(plan);
  const decided: PlanVersionDoc = { ...v, version: n, parent: v.version, status, createdBy: actorOf(ctx), createdAt: ctx.now };
  await ctx.docs.append('planVersions', { ...decided, _id: `${plan.id}:v${n}` });
  await savePlan(ctx, { ...plan, headVersion: n, ...(status === 'adopted' && v.plannedEndDate ? { plannedEndDate: v.plannedEndDate } : {}) });
  return { planId: plan.id, version: n, status };
}
implement('plan.adoptVersion', (ctx, input: { planId: string; version: number }) => setVersionStatus(ctx, input, 'adopted'));
implement('plan.rejectVersion', (ctx, input: { planId: string; version: number }) => setVersionStatus(ctx, input, 'rejected'));

implement('plan.checkIn', async (ctx) => {
  const docs = await readDocs();
  const plan = requirePlan(docs);
  const head = headAdopted(docs.versions) ?? fail('internal', 'The plan has no adopted version.');
  const p = projectLiving({ docs, today: ctx.today, tz: ctx.tz, now: ctx.now, skipAssimilation: true });
  const past = p.days.filter((d) => d.date < ctx.today);
  const schedule = realisedSchedule(plan, head, past.map((d) => d.result), ctx.today);
  const entries = effectiveEntries(docs.entries);
  const ci = weeklyCheckIn({
    plan, schedule, records: docs.records, today: ctx.today,
    weighIns: weighInsFor(plan, docs.measurements, docs.observations ?? [], entries, blockStartsOf(head.schedule)),
    intakeDays: past.filter((d) => d.result.intakeLogged).map((d) => d.planDay),
    aiEnergyShare: aiEnergyShare(entries.filter((e) => e.date >= addDays(ctx.today, -20))),
  });
  if (ci.record) await ctx.docs.append('anchors', { ...ci.record, _id: `${plan.id}:${ctx.today}` });
  const anchors = anchorsFromRecords(ci.record ? [...docs.records, ci.record] : docs.records);
  return {
    verdict: ci.output.verdict,
    weighIns7: ci.output.in7,
    weighIns14: ci.output.in14,
    trend: ci.output.trend,
    energyBias: { mean: ci.output.bias.mean, sd: ci.output.bias.sd, updated: ci.output.bias.updated },
    residualSplit: ci.output.residualSplit,
    anchors: anchors.anchors.length,
    blocks: p.blocks,
  };
});

// ------------------------------------------------------------------------------------------- logs
implement('log.markDay', async (ctx, input: { date: string; marks: Partial<Record<'food' | 'train' | 'fast' | 'all', Mark>> }) => {
  const docs = await readDocs();
  const plan = docs.plan && isLive(docs.plan) ? docs.plan : null;
  const prev = docs.dayStatus.find((s) => s.date === input.date);
  const next: DayStatusDoc = { ...prev, date: input.date, ...(plan ? { planId: plan.id, planDay: planDay(plan, input.date) } : {}), marks: { ...prev?.marks, ...input.marks } };
  await ctx.docs.put('dayStatus', { ...next, _id: `day:${input.date}` });
  return next;
});

implement('log.confirmDay', async (ctx, input: { date: string }) => {
  const docs = await readDocs();
  const prev = docs.dayStatus.find((s) => s.date === input.date);
  const p = projectLiving({ docs, today: ctx.today, tz: ctx.tz, now: ctx.now, skipAssimilation: true });
  const day = p.days.find((d) => d.date === input.date);
  const next: DayStatusDoc = { ...prev, date: input.date, confirmedAt: ctx.now, ...(day ? { prescribed: day.prescription, score: { ...day.result.score, final: true } } : {}) };
  await ctx.docs.put('dayStatus', { ...next, _id: `day:${input.date}` });
  return next;
});

const METRICS: ReadonlySet<string> = new Set(MEASUREMENT_METRICS);

/** The unit in a metric's name (`weightKg` → kg). */
const UNIT_OF: ReadonlyArray<[RegExp, string]> = [[/Kg$/, 'kg'], [/Cm$/, 'cm'], [/Pct$/, '%'], [/MmHg$/, 'mmhg'], [/MmolL$/, 'mmol/l'], [/MgL$/, 'mg/l'], [/gL$/, 'g/l']];
const LB_KG = 0.45359237;
const IN_CM = 2.54;

/**
 * The value in the metric's own unit. The input's `unit` used to be dropped, so "180, lb" was stored as 180 kg; pounds
 * and inches convert (exact factors), any other unit that is not the metric's is refused. Negative values are refused,
 * and zero for every metric but ketones and CRP.
 */
function measurementValue(metric: string, value: number, unit?: string): number {
  const own = UNIT_OF.find(([re]) => re.test(metric))?.[1];
  const u = unit?.trim().toLowerCase().replace(/\s+/g, '');
  let v = value;
  if (u && u !== own) {
    if (own === 'kg' && ['lb', 'lbs', 'pound', 'pounds'].includes(u)) v = value * LB_KG;
    else if (own === 'cm' && ['in', 'inch', 'inches', '"'].includes(u)) v = value * IN_CM;
    else fail('invalid_input', `Give this measurement in ${own === 'mmhg' ? 'mmHg' : own === 'mmol/l' ? 'mmol/L' : own === 'g/l' ? 'g/L' : own === 'mg/l' ? 'mg/L' : own}.`, { path: '/unit' });
  }
  const zeroOk = metric === 'ketonesMmolL' || metric === 'crpMgL';
  if (!Number.isFinite(v) || v < 0 || (v === 0 && !zeroOk)) fail('invalid_input', 'That value is not a possible reading.', { path: '/value' });
  return v;
}

implement('log.measurement', async (ctx, input: { date?: string; metric: string; value: number; unit?: string; context?: MeasurementEntry['context']; method?: MeasurementEntry['method'] }) => {
  if (!METRICS.has(input.metric)) fail('invalid_input', `Unknown measurement "${input.metric}".`);
  const value = measurementValue(input.metric, input.value, input.unit);
  const id = ctx.newId();
  const m: Omit<MeasurementEntry, 'id'> = { date: input.date ?? ctx.today, at: ctx.now, metric: input.metric as MeasurementMetric, value, source: sourceOf(ctx), ...(input.context ? { context: input.context } : {}), ...(input.method ? { method: input.method } : {}) };
  await ctx.docs.append('measurements', { ...m, _id: id });
  return { entryId: id };
});

const day = (ctx: CommandContext, d?: string): string => d ?? ctx.today;
const base = (ctx: CommandContext, date: string) => ({ date, tz: ctx.tz, at: ctx.now, source: sourceOf(ctx) });

implement('log.steps', (ctx, input: { date?: string; steps: number }) => appendEntry(ctx, { ...base(ctx, day(ctx, input.date)), kind: 'steps', steps: input.steps } as LogEntry));
implement('log.sleep', (ctx, input: { bedAt: string; wakeAt: string; quality?: 'poor' | 'fair' | 'good' }) => {
  // V2 (V1a-L9): a wake at or before the bed time reads as 24 h asleep in the engine
  const hours = (Date.parse(input.wakeAt) - Date.parse(input.bedAt)) / 3_600_000;
  if (!(hours > 0 && hours <= 24)) fail('invalid_input', 'The wake time has to be after the bed time, within a day.', { path: '/wakeAt' });
  return appendEntry(ctx, { ...base(ctx, minDate(appDayOf(input.wakeAt, ctx.tz), ctx.today)), kind: 'sleep', bedAt: input.bedAt, wakeAt: input.wakeAt, ...(input.quality ? { quality: input.quality } : {}) } as LogEntry);
});
implement('log.substance', (ctx, input: { date?: string; substance: 'caffeine' | 'alcohol' | 'creatine' | 'exogenousKetones'; clockH: number; amount: number; unit: 'mg' | 'drinks' | 'g' }) =>
  appendEntry(ctx, { ...base(ctx, day(ctx, input.date)), kind: 'substance', substance: input.substance, clockH: input.clockH, amount: input.amount, unit: input.unit } as LogEntry));
implement('log.supplement', (ctx, input: { date?: string; supplementId: string; dose: number; unit: string; clockH?: number }) =>
  appendEntry(ctx, { ...base(ctx, day(ctx, input.date)), kind: 'supplement', supplementId: input.supplementId, dose: input.dose, unit: input.unit, ...(input.clockH !== undefined ? { clockH: input.clockH } : {}) } as LogEntry));
implement('log.subjective', (ctx, input: { date?: string; difficulty?: 1 | 2 | 3 | 4 | 5; hunger?: number; energy?: number; mood?: number; stress?: 'low' | 'moderate' | 'high'; illness?: boolean }) => {
  const { date, ...rest } = input;
  return appendEntry(ctx, { ...base(ctx, day(ctx, date)), kind: 'subjective', ...rest } as LogEntry);
});
implement('log.note', (ctx, input: { date?: string; text: string }) => appendEntry(ctx, { ...base(ctx, day(ctx, input.date)), kind: 'note', text: input.text } as LogEntry));

implement('log.fast', async (ctx, input: { action: 'start' | 'end' | 'broken' | 'record'; lastIntakeAt?: string; firstIntakeAt?: string }) => {
  const docs = await readDocs();
  const open = effectiveEntries(docs.entries).filter((e): e is Extract<LogEntry, { kind: 'fast' }> => e.kind === 'fast' && e.firstIntakeAt === null).sort((a, b) => (a.lastIntakeAt < b.lastIntakeAt ? 1 : -1))[0];
  if (input.action === 'start' || input.action === 'record') {
    const last = input.lastIntakeAt ?? ctx.now;
    return appendEntry(ctx, { ...base(ctx, appDayOf(last, ctx.tz)), kind: 'fast', lastIntakeAt: last, firstIntakeAt: input.action === 'record' ? (input.firstIntakeAt ?? null) : null } as LogEntry);
  }
  if (!open) fail('conflict', 'No fast is running.');
  const first = input.firstIntakeAt ?? ctx.now;
  return appendEntry(ctx, { ...open, id: undefined, at: ctx.now, source: sourceOf(ctx), supersedes: open.id, firstIntakeAt: first, ...(input.action === 'broken' ? { broken: true } : {}) } as unknown as LogEntry);
});

/** A stale id (edited or removed since) would fork the entry or change nothing: the screen reloads instead. */
function current<E extends { id: string; supersedes?: string; kind?: string; target?: string }>(all: readonly E[], target: E): E {
  if (!effectiveEntries(all).some((e) => e.id === target.id)) fail('conflict', 'That entry was changed or removed since. Look at it again first.');
  return target;
}

implement('log.retract', async (ctx, input: { entryId: string }) => {
  const docs = await readDocs();
  const found = docs.entries.find((e) => e.id === input.entryId);
  const target = found ? current(docs.entries, found) : undefined;
  if (target) return appendEntry(ctx, { ...base(ctx, target.date), kind: 'retract', target: target.id } as LogEntry);
  // a weigh-in or measurement: the retract entry goes into the (append-only) measurements collection
  const m = current(docs.measurements, docs.measurements.find((e) => e.id === input.entryId) ?? fail('not_found', 'There is no such entry.'));
  const id = ctx.newId();
  await ctx.docs.append('measurements', { date: m.date, at: ctx.now, metric: m.metric, value: m.value, kind: 'retract', target: m.id, source: sourceOf(ctx), _id: id });
  return { entryId: id };
});

implement('log.edit', async (ctx, input: { entryId: string; patch: Record<string, unknown> }) => {
  const docs = await readDocs();
  const target = current(docs.entries, docs.entries.find((e) => e.id === input.entryId) ?? fail('not_found', 'There is no such entry.'));
  const { id: _old, ...rest } = target;
  void _old;
  const patch = checkedPatch(target.kind, input.patch);
  return appendEntry(ctx, { ...rest, ...patch, at: ctx.now, source: sourceOf(ctx), supersedes: target.id } as unknown as LogEntry);
});

/**
 * What `log.edit` may change, by entry kind (review V1c-10). The field schemas are the logging commands' own inputs
 * (`log.steps`, `log.sleep`, …), so an edit can never write what logging could not. Bookkeeping fields (`assumed`,
 * `planId`, `planDay`, `at`, `tz`, `source`, `supersedes`, `id`, `kind`) and anything not listed are refused.
 * Meals and sessions keep their computed parts (components, nutrients, stimulus): log them again to change those.
 */
const EDITABLE: Partial<Record<LogEntry['kind'], { from: string; fields?: readonly string[]; extra?: Record<string, JsonSchema> }>> = {
  steps: { from: 'log.steps' },
  sleep: { from: 'log.sleep' },
  substance: { from: 'log.substance' },
  supplement: { from: 'log.supplement' },
  subjective: { from: 'log.subjective' },
  note: { from: 'log.note' },
  meal: { from: 'log.meal', fields: ['date', 'clockH', 'slot', 'complete'] },
  session: { from: 'log.session', fields: ['date', 'status', 'startH', 'durationMin', 'rpe'] },
  fast: { from: 'log.fast', fields: ['lastIntakeAt'], extra: { firstIntakeAt: T.Nullable(T.Instant()), broken: T.Boolean(), electrolytes: T.Boolean() } },
  event: { from: '', extra: { event: T.Enum(['illness', 'travel', 'noTraining', 'socialMeal', 'busy', 'dietBreak', 'creatineStart']), to: T.Date() } },
};

function checkedPatch(kind: LogEntry['kind'], patch: Record<string, unknown>): Record<string, unknown> {
  const spec = EDITABLE[kind];
  const source = (spec?.from && getCommand(spec.from)?.input.properties) || {};
  const props: Record<string, JsonSchema> = { date: T.Date(), text: T.String({ minLength: 1, maxLength: 2000 }), ...(spec?.extra ?? {}) };
  for (const [k, s] of Object.entries(source)) if (!spec?.fields || spec.fields.includes(k)) props[k] = s;
  const errors = Value.Errors({ type: 'object', properties: props, additionalProperties: false }, patch, 1);
  if (errors.length) {
    const field = decodeURIComponent(errors[0]!.path.split('/')[1] ?? '');
    const allowed = Object.keys(props).join(', ');
    fail('invalid_input', props[field] ? `The new value for ${field} is not valid (${errors[0]!.message}).` : `${field} can't be changed on this entry. You can change: ${allowed}.`, { path: `/patch${errors[0]!.path}` });
  }
  return patch;
}

implement('log.fromBiometrics', async (ctx, input: { date?: string }) => {
  const date = input.date ?? ctx.today;
  if (date > ctx.today) fail('invalid_input', 'That day has not happened yet.', { path: '/date' });
  const { planDeviceLogs, deviceLogWindow } = await import('@/biometrics/core/deviceLogs');
  const store = getDocumentStore();
  const ix = sharedBioIndex(store);
  await ix.ready;
  const docs = await readDocs();
  const w = deviceLogWindow(date);
  const plan = planDeviceLogs({
    date,
    tz: ctx.tz,
    rolloverH: rolloverOf(settingsValues()),
    records: ix.latestRecords(w.from, w.to).map((e) => ({ sourceKey: e.sourceKey, record: e.record })),
    sources: ix.sources(),
    person: ix.personPolicies,
    entries: docs.entries,
    corrections: ix.corrections(),
  });
  const created = [];
  for (const c of plan.create) {
    const source = { ...c.entry.source, actorId: ctx.actor.id };
    const { entryId } = await appendEntry(ctx, { ...c.entry, tz: ctx.tz, at: ctx.now, source, ...(c.supersedes ? { supersedes: c.supersedes } : {}) } as LogEntry);
    const e = c.entry as Record<string, unknown>;
    const wk = e.workout as { exerciseType?: string; activeKcal?: number } | undefined;
    created.push({
      entryId,
      kind: c.entry.kind as 'steps' | 'sleep' | 'session',
      stream: c.stream,
      key: c.key,
      recordId: c.recordId,
      source: ix.source(c.sourceKey)?.label ?? c.sourceKey,
      ...(c.supersedes ? { supersedes: c.supersedes } : {}),
      ...(typeof e.steps === 'number' ? { steps: e.steps } : {}),
      ...(typeof e.bedAt === 'string' ? { bedAt: e.bedAt, wakeAt: e.wakeAt as string } : {}),
      ...(wk ? { exerciseType: wk.exerciseType, startH: e.startH as number, durationMin: e.durationMin as number, ...(wk.activeKcal !== undefined ? { activeKcal: wk.activeKcal } : {}) } : {}),
    });
  }
  return { date, created, skipped: plan.skipped, notOptedIn: plan.notOptedIn };
});

/**
 * App day of an instant (sleep: the wake; fasts: the last intake), rolling over like every other log (04:00 by default)
 * and like the device entries of `log.fromBiometrics`: a wake at 02:30 belongs to the day before.
 */
function appDayOf(at: string, tz: string): string {
  return appDay(Date.parse(at), { tz, rolloverH: rolloverOf(settingsValues()) });
}
const minDate = (a: string, b: string): string => (a <= b ? a : b);
