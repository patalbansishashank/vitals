/**
 * The command bus (SUITE_SPEC §1.3): one dispatcher for the UI, the Coach (AI tools), WebMCP, MCP and the Companion.
 *
 * Pipeline: resolve def → surface check → schema validation → rate limit per actor turn → idempotency lookup →
 * confirmation policy → staging of consequential agent writes → preconditions → safety gates → open ChangeSet and
 * mint the WriteToken → execute (in the command's write scope) → output validation (dev/test) → ChangeSet commit (one
 * document-store transaction; the projection already shows the change) → ledger → `committed` event → result.
 *
 * When the commit fails (quota, an IndexedDB error), the ChangeSet rolls back (./history.ts): the screens show the
 * "before" values again, the ledger forgets it, `commitFailed` carries `rolledBack: true` and the plain-language
 * `notice`, and a dispatch still waiting for the write resolves with that error.
 *
 *   dispatch('scenario.edit', { id, ops }, { coalesceKey })   // Promise<CommandResult>, resolves after the commit
 *   dispatchSync('goals.edit', { ops })                        // UI handlers that need the output now
 *
 * Tier H: no DOM, no React. Reads of projections and documents only through `@/state/internal/*` and the runtime.
 */
import { applyMergePatch, bodyOf, isPlainObject, jsonClone, mintWriteToken, revokeWriteToken, ulid, type CollectionId, type Doc, type LocalDate, type Tx } from '@/store';
import { appDay, rolloverOf } from '@/living/appDay';
import { getBindings } from '@/state/bridge';
import { settingsValues } from '@/state/internal/settings';
import { getDocumentStore, commitWithToken } from '@/state/runtime';
import { createScope, runInScope, type DocOpRecord, type WriteScope } from '@/state/scope';
import { consumeConfirmation } from './confirm';
import { checkGates, checkPreconditions } from './gates';
import { addOps, coalescible, discardIfEmpty, onCommitFailure, openChangeSet, pendingWrites, scheduleCommit, summary, type ChangeSet } from './history';
import { createJobRunner } from './jobs';
import { buildManifest } from './manifest';
import { CommandFailure, getCommand } from './registry';
import { Value } from './schema';
import {
  LOCAL_USER,
  SAVE_FAILED_NOTICE,
  surfaceOf,
  type Actor,
  type BusEvent,
  type CommitFailedEvent,
  type CommandContext,
  type CommandDef,
  type CommandError,
  type CommandId,
  type CommandPorts,
  type CommandResult,
  type DispatchOptions,
  type InputOf,
  type JobRef,
  type KnownCommandId,
  type Notice,
  type OutputOf,
  type PendingChangeRef,
  type Surface,
  type ToolDescriptor,
} from './types';

const listeners = new Set<(e: BusEvent) => void>();
function emit(e: BusEvent): void {
  for (const l of listeners) {
    try {
      l(e);
    } catch (err) {
      console.error(err);
    }
  }
}

export const jobs = createJobRunner((status) => emit({ type: 'job', status }));
let ports: CommandPorts = {};

/** Install IO ports (navigation, planner pool, downloads). Later calls merge. */
export function installPorts(p: Partial<CommandPorts>): void {
  ports = { ...ports, ...p };
}
export function getPorts(): CommandPorts {
  return ports;
}

/** An error's message (Error, DOMException from IndexedDB, anything thrown). */
function messageOf(e: unknown): string {
  const m = (e as { message?: unknown } | null)?.message;
  return typeof m === 'string' ? m : String(e);
}


/** Changes whose rollback a waiting dispatch reports (by ChangeSet id). */
const rolledBack = new Set<string>();

onCommitFailure((cs, e, outcome) => {
  console.error(`Vitals: could not save "${cs.label}"${outcome.rolledBack ? ' (undone)' : ''}`, e);
  if (outcome.rolledBack) {
    for (const k of cs.ledgerKeys ?? []) ledger.delete(k);
    rolledBack.add(cs.id);
    // gestures still coalescing have no dispatch waiting: keep the set small
    if (rolledBack.size > 50) rolledBack.delete(rolledBack.values().next().value!);
  }
  const event: CommitFailedEvent = {
    type: 'commitFailed',
    commandId: cs.commandId,
    error: messageOf(e),
    changeSetId: cs.id,
    label: cs.label,
    rolledBack: outcome.rolledBack,
    ...(outcome.rolledBack ? { notice: SAVE_FAILED_NOTICE } : {}),
    skipped: outcome.skipped,
  };
  emit(event);
});

/* ---------------------------------------------------------------- idempotency ledger and rate limits */

const LEDGER_TTL_MS = 24 * 3600 * 1000;
const ledger = new Map<string, { at: number; result: CommandResult }>();
const turnCounts = new Map<string, number>();

function ledgerGet(key: string): CommandResult | null {
  let hit = ledger.get(key);
  if (!hit) {
    // after a reload the in-memory map is empty: the persisted row (written with the ChangeSet) still answers a retry
    const row = getDocumentStore().peek<{ at?: unknown; result?: unknown }>('commandLedger', key);
    const at = typeof row?.at === 'string' ? Date.parse(row.at) : NaN;
    if (!row || !Number.isFinite(at) || !isPlainObject(row.result)) return null;
    hit = { at, result: row.result as unknown as CommandResult };
    ledger.set(key, hit);
  }
  if (Date.now() - hit.at > LEDGER_TTL_MS) {
    ledger.delete(key);
    return null;
  }
  return hit.result;
}

function rateLimited(def: CommandDef, actor: Actor, opts: DispatchOptions): boolean {
  if (actor.kind === 'user' || actor.kind === 'system') return false;
  const limit = def.aiLimit?.perTurn ?? (def.perm === 'read' ? 20 : def.perm === 'write' ? 5 : 1);
  const turn = `${actor.kind}:${actor.id}:${actor.conversationId ?? ''}:${opts.correlationId ?? actor.toolCallId ?? ''}:${def.id}`;
  const n = (turnCounts.get(turn) ?? 0) + 1;
  turnCounts.set(turn, n);
  if (turnCounts.size > 1000) turnCounts.clear();
  return n > limit;
}

/** Tests: forget ledger rows and turn counters. */
export function resetBusState(): void {
  ledger.clear();
  turnCounts.clear();
}

/* ---------------------------------------------------------------- output checking */

let outputCheck: 'warn' | 'throw' | 'off' = 'warn';
export function setOutputValidation(mode: 'warn' | 'throw' | 'off'): void {
  outputCheck = mode;
}

/* ---------------------------------------------------------------- helpers */

const err = (code: CommandError['code'], message: string, detail?: CommandError['detail']): CommandResult<never> => ({
  ok: false,
  error: { code, message, ...(detail ? { detail } : {}) },
});

let timeZoneSource: (() => string) | null = null;

/** Where "today" comes from: the host's zone by default; the server sets the person's zone (one person per module graph). */
export function setTimeZoneSource(source: (() => string) | null): void {
  timeZoneSource = source;
}

export function timeZone(): string {
  try {
    return timeZoneSource?.() || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

const isJobRef = (x: unknown): x is JobRef =>
  isPlainObject(x) && typeof x.jobId === 'string' && typeof x.kind === 'string' && typeof x.startedAt === 'string' && Object.keys(x).length === 3;
const isThenable = (x: unknown): x is PromiseLike<unknown> => !!x && typeof (x as { then?: unknown }).then === 'function';

/** Buffered transaction: writes become ChangeSet ops of the command's scope (committed together). */
function bufferedTx(scope: WriteScope, readOnly: boolean, commandId: string): Tx {
  const store = getDocumentStore();
  const current = (col: CollectionId, id: string): Record<string, unknown> | null => {
    for (let i = scope.ops.length - 1; i >= 0; i--) {
      const o = scope.ops[i]!;
      if (o.col === col && o.id === id && !o.fields) return o.after ? { ...o.after } : null;
    }
    const d = store.peek<Record<string, unknown>>(col, id);
    return d ? bodyOf(d) : null;
  };
  const guard = () => {
    if (readOnly) throw new Error(`${commandId} is a read command and cannot write documents`);
  };
  const asDoc = <T>(col: CollectionId, id: string, body: Record<string, unknown>) => ({ ...body, _id: id, _col: col }) as unknown as Doc<T>;
  return {
    async get<T>(col: CollectionId, id: string) {
      await store.ready;
      const b = current(col, id);
      return b ? asDoc<T>(col, id, b) : null;
    },
    async put<T>(col: CollectionId, doc: T & { _id: string }) {
      guard();
      await store.ready;
      const before = current(col, doc._id);
      const after = bodyOf(jsonClone(doc) as unknown as Record<string, unknown>);
      scope.ops.push({ col, id: doc._id, before, after, kind: 'put' });
      return asDoc<T>(col, doc._id, after);
    },
    async patch<T>(col: CollectionId, id: string, mergePatch: unknown) {
      guard();
      await store.ready;
      const before = current(col, id);
      const after = applyMergePatch(before ?? {}, jsonClone(mergePatch)) as Record<string, unknown>;
      scope.ops.push({ col, id, before, after, kind: 'put' });
      return asDoc<T>(col, id, after);
    },
    async append<T>(col: CollectionId, doc: T & { _id: string }) {
      guard();
      await store.ready;
      if (current(col, doc._id)) throw new Error(`${col}/${doc._id} already exists`);
      const after = bodyOf(jsonClone(doc) as unknown as Record<string, unknown>);
      scope.ops.push({ col, id: doc._id, before: null, after, kind: 'append' });
      return asDoc<T>(col, doc._id, after);
    },
    async remove(col: CollectionId, id: string) {
      guard();
      await store.ready;
      const before = current(col, id);
      if (!before) return;
      scope.ops.push({ col, id, before, after: null, kind: 'remove' });
    },
  } as Tx;
}

/* ---------------------------------------------------------------- pipeline */

interface Started {
  def: CommandDef;
  input: unknown;
  actor: Actor;
  opts: DispatchOptions;
  scope: WriteScope;
  cs: ChangeSet | null;
  notices: Notice[];
  ledgerKey: string | null;
  snapshots: Array<() => void> | null;
}

type Begin = { done: CommandResult } | { started: Started; value: unknown };

function begin(id: string, input: unknown, opts: DispatchOptions): Begin {
  const def = getCommand(id);
  if (!def) return { done: err('not_found', `Unknown command "${id}".`) };
  const actor = opts.actor ?? LOCAL_USER;
  const surface = surfaceOf(actor);
  if (surface && !def.surfaces.includes(surface))
    return { done: err('surface_forbidden', def.excludedReason?.[surface] ?? 'Not available here.', { rule: `surface:${surface}` }) };

  const errors = Value.Errors(def.input, input, 5);
  if (errors.length) return { done: err('invalid_input', `Invalid input: ${errors.map((e) => `${e.path || '/'} ${e.message}`).join('; ')}`, { path: errors[0]!.path }) };

  if (rateLimited(def, actor, opts)) return { done: err('rate_limited', 'Too many calls of this tool in one turn.', { retryable: true }) };

  let ledgerKey: string | null = null;
  if (def.idempotency === 'key') {
    // a dry run writes nothing (nor the ledger), so an agent's preview of a keyed command needs no key (Q4: the Coach's
    // previews of plan.start / plan.editDay / plan.declareEvent were refused)
    if (!opts.idempotencyKey && !opts.dryRun && actor.kind !== 'user' && actor.kind !== 'system') return { done: err('invalid_input', 'An idempotency key is required.', { path: '/idempotencyKey' }) };
    ledgerKey = `${def.id}|${opts.idempotencyKey ?? ulid()}`;
    const hit = ledgerGet(ledgerKey);
    if (hit) return { done: hit };
  }

  if (def.perm === 'destructive') {
    if (actor.kind !== 'user' && actor.kind !== 'system') return { done: err('confirmation_required', 'This needs your confirmation in the app.') };
    if (actor.kind === 'user') {
      const check = consumeConfirmation(opts.confirmation, def.id, input);
      if (check !== 'ok') return { done: err('confirmation_required', 'Confirm this in the dialog first.', { rule: `confirmation:${check}` }) };
    }
  }

  if (def.notImplemented) {
    return { done: err('precondition_failed', "This isn't available in this version of Vitals yet.", { precondition: 'implemented', owner: def.notImplemented.owner, retryable: false }) };
  }

  const nowDate = new Date();
  const tz = timeZone();
  // the app's day, not the calendar date: before the rollover hour (default 04:00) it is still yesterday (SUITE_SPEC §3.4)
  const today = appDay(nowDate, { tz, rolloverH: rolloverOf(settingsValues()) });
  const ctxBase = { actor, device: getDocumentStore().device, now: nowDate.toISOString(), today, tz };

  const pre = checkPreconditions(def, input, actor);
  if (pre) return { done: err('precondition_failed', pre.message, { precondition: pre.id }) };
  const gate = checkGates(def, input, actor, ctxBase.now);
  if (gate) return { done: err('safety_blocked', gate.message, { gate: gate.id, ...(gate.allowedAlternatives ? { allowedAlternatives: gate.allowedAlternatives } : {}) }) };

  const write = def.perm !== 'read';
  const dryRun = Boolean(opts.dryRun);
  let cs: ChangeSet | null = null;
  let scope: WriteScope;
  if (!write) scope = createScope('derive', { commandId: def.id, label: def.id });
  else if (dryRun) scope = createScope('dryRun', { commandId: def.id, label: def.id });
  else {
    const coalesceKey = opts.coalesceKey ?? def.coalesce?.(input as never, actor);
    const nowMs = nowDate.getTime();
    cs = coalescible(coalesceKey, actor, def.id, nowMs);
    if (cs) cs.lastAt = nowMs;
    else cs = openChangeSet({ id: ulid(nowMs), commandId: def.id, actor, label: def.title, ...(coalesceKey ? { coalesceKey } : {}), at: ctxBase.now, now: nowMs });
    scope = createScope('command', { token: cs.token ?? undefined, changeSetId: cs.id, commandId: def.id, label: def.title });
  }
  const snapshots = dryRun ? getBindings().map((b) => {
    const state = b.api.getState();
    return () => runInScope(createScope('dryRun'), () => b.api.setState(state as never, true));
  }) : null;

  const notices: Notice[] = [];
  const controller = new AbortController();
  if (opts.signal) opts.signal.addEventListener('abort', () => controller.abort(), { once: true });
  const ctx: CommandContext = {
    ...ctxBase,
    commandId: def.id,
    changeSetId: cs?.id ?? null,
    dryRun,
    newId: () => ulid(),
    docs: bufferedTx(scope, !write, def.id),
    jobs,
    ports,
    signal: controller.signal,
    notice: (n) => notices.push(n),
    write: (fn) => runInScope(scope, fn),
    ...(cs?.coalesceKey ? { coalesceKey: cs.coalesceKey } : {}),
  };
  const started: Started = { def, input, actor, opts, scope, cs, notices, ledgerKey, snapshots };
  try {
    const value = runInScope(scope, () => def.execute(ctx, input as never));
    return { started, value };
  } catch (e) {
    return { done: failStarted(started, e) };
  }
}

function failStarted(s: Started, e: unknown): CommandResult {
  s.snapshots?.forEach((restore) => restore());
  if (s.cs && !s.cs.committed) {
    // the projection may already show part of the change: keep what was applied (it is consistent), commit it
    addOps(s.cs, s.scope.ops);
    if (!discardIfEmpty(s.cs)) void scheduleCommit(s.cs);
  }
  if (e instanceof CommandFailure) return { ok: false, error: e.error };
  console.error(`Command ${s.def.id} failed`, e);
  return err('internal', e instanceof Error ? e.message : String(e));
}

interface Finished {
  result: CommandResult;
  committed: Promise<void>;
}

function finish(s: Started, value: unknown): Finished {
  const { def, scope, cs, notices } = s;
  if (isJobRef(value)) {
    if (cs) {
      addOps(cs, scope.ops);
      if (!discardIfEmpty(cs)) void scheduleCommit(cs);
    }
    const result: CommandResult = { ok: true, job: value, notices };
    return { result, committed: Promise.resolve() };
  }
  if (outputCheck !== 'off') {
    const errors = Value.Errors(def.output, value, 3);
    if (errors.length) {
      const msg = `${def.id}: output does not match its schema (${errors.map((e) => `${e.path || '/'} ${e.message}`).join('; ')})`;
      if (outputCheck === 'throw') return { result: err('internal', msg), committed: Promise.resolve() };
      console.warn(msg);
    }
  }
  if (s.snapshots) {
    // dry run: report what would change, then put every projection back
    const preview = { id: 'dry-run', commandId: def.id, label: def.title, at: new Date().toISOString(), actor: s.actor, docs: scope.ops.map((o) => ({ col: o.col, id: o.id, op: (o.after === null ? 'remove' : 'put') as 'put' | 'remove' })) };
    s.snapshots.forEach((restore) => restore());
    return { result: { ok: true, output: value, changeSet: preview, notices }, committed: Promise.resolve() };
  }
  let committed: Promise<void> = Promise.resolve();
  let changeSet = null;
  if (cs) {
    addOps(cs, scope.ops);
    if (!discardIfEmpty(cs)) changeSet = summary(cs);
  }
  const result: CommandResult = { ok: true, output: value, changeSet, notices };
  if (s.ledgerKey) {
    ledger.set(s.ledgerKey, { at: Date.now(), result });
    // the ledger row joins the ChangeSet's transaction (before the commit starts, so a sealed ChangeSet carries it too)
    if (cs && changeSet && !cs.committed) {
      const key = s.ledgerKey;
      (cs.ledgerKeys ??= []).push(key);
      cs.extras.push(async (tx) => {
        await tx.put('commandLedger', { _id: key, commandId: def.id, at: new Date().toISOString(), result: jsonClone(result) });
      });
    }
  }
  if (cs && changeSet) {
    const write = scheduleCommit(cs);
    // a gesture still coalescing resolves now (it is written when the gesture ends: seal or 300 ms idle)
    committed = cs.sealed ? write : Promise.resolve();
    if (!cs.sealed) write.catch(() => undefined);
  }
  // "committed" means a write ran (its ChangeSet, or null for a write that changed nothing); a read says "read" (Q3-J5-09)
  emit(cs ? { type: 'committed', commandId: def.id, changeSet, actor: s.actor } : { type: 'read', commandId: def.id, actor: s.actor });
  return { result, committed };
}

/* ---------------------------------------------------------------- staging (agent proposals) */

const AGENTS = new Set(['ai', 'webmcp', 'mcp', 'companion']);
const PENDING_TTL_MS = 24 * 3600 * 1000;

function needsStaging(def: CommandDef, actor: Actor, opts: DispatchOptions): boolean {
  return def.perm === 'write' && def.impact === 'consequential' && AGENTS.has(actor.kind) && !opts.dryRun;
}

async function stage(id: string, input: unknown, opts: DispatchOptions): Promise<CommandResult> {
  const actor = opts.actor!;
  const preview = await dispatchInternal(id, input, { ...opts, dryRun: true });
  if (!preview.ok) return preview;
  const pendingId = ulid();
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + PENDING_TTL_MS).toISOString();
  const store = getDocumentStore();
  const docs = 'changeSet' in preview && preview.changeSet ? preview.changeSet.docs : [];
  const baseRevs: Record<string, string> = {};
  for (const d of docs) baseRevs[`${d.col}/${d.id}`] = store.peek(d.col, d.id)?._rev ?? '';
  const token = mintWriteToken('command', { label: 'stage proposal' });
  try {
    await commitWithToken(token, [
      {
        col: 'pendingChanges',
        id: pendingId,
        before: null,
        after: { commandId: id, input: jsonClone(input), actor, createdAt, expiresAt, preview: { title: getCommand(id)?.title ?? id, docs }, baseRevs, status: 'pending' },
      },
    ]);
  } finally {
    revokeWriteToken(token);
  }
  const pending: PendingChangeRef = { pendingId, commandId: id as PendingChangeRef['commandId'], expiresAt };
  emit({ type: 'pending', pending });
  return { ok: true, pending, notices: 'notices' in preview ? preview.notices : [] };
}

/* ---------------------------------------------------------------- redirect rules (SUITE_SPEC §14.6) */

/** What a redirect rule decides for one dispatch: refuse it, stage another command in its place, or let it run. */
export type RedirectDecision = null | { refuse: CommandError } | { stage: { id: CommandId; input: unknown } };
export type RedirectRule = (input: unknown, actor: Actor, at: { today: LocalDate; tz: string }) => RedirectDecision;
const redirectRules = new Map<string, RedirectRule>();

/** Install a rule for one command id (E28: `log.sleep`, `log.steps`, `log.measurement`, `bio.manual` on device-owned
 * streams). Rules are synchronous and run after input validation, before staging and execution. */
export function setRedirectRule(id: CommandId, rule: RedirectRule | null): void {
  if (rule) redirectRules.set(id, rule);
  else redirectRules.delete(id);
}

let redirectReady: (() => Promise<unknown>) | null = null;
/** A hook the bus awaits before it runs a redirect rule (the biometrics index may still be loading at start-up, and a
 * rule that cannot see the owner yet would let a hand entry through). */
export function setRedirectReady(fn: (() => Promise<unknown>) | null): void {
  redirectReady = fn;
}

function redirectOf(id: string, input: unknown, actor: Actor): RedirectDecision {
  const rule = redirectRules.get(id);
  const def = rule ? getCommand(id) : undefined;
  if (!rule || !def || Value.Errors(def.input, input, 1).length) return null;
  const tz = timeZone();
  return rule(input, actor, { today: appDay(new Date(), { tz, rolloverH: rolloverOf(settingsValues()) }), tz });
}

/* ---------------------------------------------------------------- public API */

/** Keyed dispatches still running, by ledger key: a double submit with the same key waits for the first (one run). */
const inFlight = new Map<string, Promise<CommandResult>>();

function dispatchInternal(id: string, input: unknown, opts: DispatchOptions): Promise<CommandResult> {
  const def = getCommand(id);
  if (def?.idempotency !== 'key' || !opts.idempotencyKey || opts.dryRun) return dispatchInLane(id, input, opts);
  const key = `${id}|${opts.idempotencyKey}`;
  const running = inFlight.get(key);
  if (running) return running;
  const p = dispatchInLane(id, input, opts);
  inFlight.set(key, p);
  // the caller gets `p` itself (no extra ticks before it resolves)
  const done = () => void inFlight.delete(key);
  p.then(done, done);
  return p;
}

/** The tail of each `serial` lane (CommandDef.serial). */
const lanes = new Map<string, Promise<unknown>>();

function dispatchInLane(id: string, input: unknown, opts: DispatchOptions): Promise<CommandResult> {
  const lane = getCommand(id)?.serial;
  if (!lane || opts.dryRun) return dispatchOnce(id, input, opts);
  const p = (lanes.get(lane) ?? Promise.resolve()).then(() => dispatchOnce(id, input, opts));
  const tail = p.catch(() => undefined);
  lanes.set(lane, tail);
  void tail.then(() => {
    if (lanes.get(lane) === tail) lanes.delete(lane);
  });
  return p;
}

async function dispatchOnce(id: string, input: unknown, opts: DispatchOptions): Promise<CommandResult> {
  const def = getCommand(id);
  const actor = opts.actor ?? LOCAL_USER;
  // a replay of a keyed command that already ran gets its first result, even when a redirect would apply now (a ring
  // that owns steps since then must not turn an MQTT replay of `log.steps` into a new correction)
  if (def?.idempotency === 'key' && opts.idempotencyKey && !opts.dryRun) {
    const hit = ledgerGet(`${def.id}|${opts.idempotencyKey}`);
    if (hit) return hit;
  }
  if (redirectReady && redirectRules.has(id)) await redirectReady().catch(() => undefined);
  const redirect = redirectOf(id, input, actor);
  if (redirect && 'refuse' in redirect) return { ok: false, error: redirect.refuse };
  if (redirect) {
    const r = await stage(redirect.stage.id, redirect.stage.input, { ...opts, actor });
    // the caller learns what was staged in its place (a Coach card shows the correction, not the log it asked for)
    return r.ok && 'pending' in r ? { ...r, redirected: redirect.stage.id, redirectedInput: redirect.stage.input } : r;
  }
  if (def && needsStaging(def, actor, opts)) {
    const errors = Value.Errors(def.input, input, 5);
    if (errors.length) return err('invalid_input', `Invalid input: ${errors.map((e) => `${e.path || '/'} ${e.message}`).join('; ')}`, { path: errors[0]!.path });
    const surface = surfaceOf(actor);
    if (surface && !def.surfaces.includes(surface)) return err('surface_forbidden', def.excludedReason?.[surface] ?? 'Not available here.');
    // a retried proposal (same key) is the same proposal, not a second one
    const key = opts.idempotencyKey ? `${def.id}|stage|${opts.idempotencyKey}` : null;
    const hit = key ? ledgerGet(key) : null;
    if (hit) return hit;
    const staged = await stage(id, input, { ...opts, actor });
    if (key && staged.ok) ledger.set(key, { at: Date.now(), result: staged });
    return staged;
  }
  // a read sees every write already announced: `committed` fires before the documents land (Q3-J5-10)
  if (def?.perm === 'read') {
    const pending = pendingWrites();
    if (pending) await pending;
  }
  const b = begin(id, input, { ...opts, actor });
  if ('done' in b) return b.done;
  let value = b.value;
  if (isThenable(value)) {
    try {
      value = await value;
    } catch (e) {
      return failStarted(b.started, e);
    }
  }
  const { result, committed } = finish(b.started, value);
  try {
    await committed;
  } catch (e) {
    // reported through `commitFailed`; when the change was rolled back, the caller hears it too
    const id = result.ok && 'changeSet' in result ? result.changeSet?.id : undefined;
    if (id && rolledBack.delete(id)) {
      const { name, message } = (e ?? {}) as { name?: unknown; message?: unknown };
      const quota = /quota/i.test(`${String(name)} ${String(message)}`);
      return err(quota ? 'quota_exceeded' : 'internal', SAVE_FAILED_NOTICE, { retryable: true });
    }
  }
  return result;
}

/**
 * Dispatch a command; resolves after its ChangeSet is written (or immediately for jobs). A read first waits for the
 * writes still on their way to the store, so it sees every write whose `committed` event has fired.
 */
export function dispatch<K extends KnownCommandId>(id: K, input: InputOf<K>, opts?: DispatchOptions): Promise<CommandResult<OutputOf<K>>>;
export function dispatch(id: string, input: unknown, opts?: DispatchOptions): Promise<CommandResult>;
export function dispatch(id: string, input: unknown, opts: DispatchOptions = {}): Promise<CommandResult> {
  return dispatchInternal(id, input, opts);
}

/**
 * Synchronous dispatch for UI handlers that need the output in the same tick (a new scenario id, an add-goal
 * outcome). The projection changes before it returns; the document write follows. Asynchronous executors throw.
 */
export function dispatchSync<K extends KnownCommandId>(id: K, input: InputOf<K>, opts?: DispatchOptions): CommandResult<OutputOf<K>>;
export function dispatchSync(id: string, input: unknown, opts?: DispatchOptions): CommandResult;
export function dispatchSync(id: string, input: unknown, opts: DispatchOptions = {}): CommandResult {
  const def = getCommand(id);
  const actor = opts.actor ?? LOCAL_USER;
  if (def && needsStaging(def, actor, opts)) throw new Error(`${id} from ${actor.kind} is staged for review: use dispatch()`);
  const redirect = redirectOf(id, input, actor);
  if (redirect && 'refuse' in redirect) return { ok: false, error: redirect.refuse };
  if (redirect) throw new Error(`${id} from ${actor.kind} is staged for review: use dispatch()`);
  const b = begin(id, input, { ...opts, actor });
  if ('done' in b) return b.done;
  if (isThenable(b.value)) {
    const started = b.started;
    void Promise.resolve(b.value).then(
      (v) => finish(started, v),
      (e) => failStarted(started, e),
    );
    throw new Error(`${id} is asynchronous: use dispatch()`);
  }
  return finish(b.started, b.value).result;
}

/** The output of a successful result (undefined for errors, jobs and staged proposals). */
export function outputOf<O>(r: CommandResult<O>): O | undefined {
  return r.ok && 'output' in r ? r.output : undefined;
}

export function on(listener: (e: BusEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function manifest(surface: Surface): ToolDescriptor[] {
  return buildManifest(surface);
}

/** The bus as one object (SUITE_SPEC §1.3 `CommandBus`). */
export const commandBus = { dispatch, dispatchSync, manifest, on };

export type { DocOpRecord };
