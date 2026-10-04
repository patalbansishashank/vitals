/**
 * Runs the model's tool calls through the command bus by confirmation class and turns each result into a tool result
 * envelope (SUITE_SPEC §1.8) and, for writes, a change card (§5.5). Also completes the person's decisions on those
 * cards (`act`): Undo / Redo through `history.undo` and re-dispatch, Apply / Discard through `coach.applyPending` /
 * `coach.discardPending`, edited meal grams by re-logging as `aiPhotoUserGrams`.
 *
 * Every model write is dispatched with `actor: {kind:'ai', conversationId, toolCallId}` and the idempotency key
 * `${conversationId}:${toolCallId}`; the person's decisions are dispatched as the person on behalf of the Coach.
 * Destructive commands are never dispatched from here: the page's typed-confirmation dialog completes them.
 */
import type { Actor, CommandResult } from '@/commands/types';
import type { ChatMessage, ToolCall } from '../providers/types';
import { capToolResult, TOOL_RESULT_MAX_TOKENS } from '../tools/budget';
import { idempotencyKeyFor } from '../tools/proposals';
import type { PortError, ToolResultEnvelope } from '../tools/types';
import { formatErrors, stripStrictNulls, validate } from '../tools/validate';
import { blockedCard, destructiveCard, logCard, mealCard, proposalCard, uiOnlyCard, type MealMeta } from './cards';
import { classOf, LOAD_TOOLS_ID, safetyLoosening, type CoachBus, type ResolvedTool, type CoachToolset, type Tier } from './tools';
import { confirmInputOf, MARKERS_CONFIRM, MARKERS_IMPORT, markersReviewCard, readerMessage, reviewOf, reviewSummary, settleJob } from './markers';
import type { CardAction, CardActionExtra, CardRecordData, CardView } from './types';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);

/** Per user turn (SUITE_SPEC §5.2): 20 calls, 5 writes, 1 destructive request. */
export const TURN_LIMITS = { calls: 20, writes: 5, destructive: 1 } as const;
const DEFAULT_PAGE = 30;
const CHANGE_WINDOW_MS = 24 * 3600 * 1000;

export interface TurnContext {
  conversationId: string;
  /** Correlation id of the user turn (the bus counts agent calls per turn by it). */
  turnId: string;
  /** The person's current day in the app (rollover at 04:00), for log tools called without a date. */
  date?: string;
  tier: Tier;
  noPlanning: boolean;
  smallEditsWithoutAsking: boolean;
  quiet: boolean;
  signal?: AbortSignal;
  /** Photos attached this turn, by attachment id (thumbnail for the "what I saw" card). */
  photos: Map<string, { url: string; alt: string }>;
  /** Plan name for destructive cards. */
  planName: string | null;
  /** `app_load_tools`. */
  loadGroups(groups: string[]): void;
  counts: { calls: number; writes: number; destructive: number };
}

export interface CallOutcome {
  envelope: ToolResultEnvelope;
  message: ChatMessage;
  /** A read: what was looked at (one line of the turn's "looked at" card). */
  read?: { label: string; summary?: string };
  card?: CardView;
}

/** What a card remembers to complete the person's decisions (stored on the card as `record`, see `CardRecordData`). */
type CardRecord = CardRecordData & { meal?: { meta: MealMeta; fromPhoto: boolean } };

/** Shown on an applied card whose undo window is over (the card no longer offers Undo). */
export const UNDO_WINDOW_OVER = 'The 24 h to undo this are over. Change it in History.';

const KINDS: ReadonlySet<string> = new Set(['log', 'staged', 'local', 'destructive', 'info']);

/** A card's stored record, checked (it comes back from the documents after a reload). */
function recordFrom(v: unknown): CardRecord | null {
  if (!isRec(v) || typeof v.kind !== 'string' || !KINDS.has(v.kind) || typeof v.commandId !== 'string' || !isRec(v.aiActor)) return null;
  const undo = isRec(v.undo) && typeof v.undo.command === 'string' ? { command: v.undo.command, input: v.undo.input } : undefined;
  const meal = isRec(v.meal) && isRec(v.meal.meta) ? { meta: v.meal.meta as MealMeta, fromPhoto: v.meal.fromPhoto === true } : undefined;
  return {
    kind: v.kind as CardRecord['kind'],
    commandId: v.commandId,
    input: v.input,
    aiActor: v.aiActor as unknown as Actor,
    ...(typeof v.changeSetId === 'string' ? { changeSetId: v.changeSetId } : {}),
    ...(undo ? { undo } : {}),
    ...(typeof v.pendingId === 'string' ? { pendingId: v.pendingId } : {}),
    ...(meal ? { meal } : {}),
  };
}

/** True while an applied card can still be undone (24 h from when it applied, or its own `until`). */
export function undoWindowOpen(card: Pick<CardView, 'createdAt' | 'until'>, now: Date): boolean {
  return (card.until ? Date.parse(card.until) : Date.parse(card.createdAt) + CHANGE_WINDOW_MS) > now.getTime();
}

export interface ExecutorDeps {
  bus: CoachBus;
  now: () => Date;
  newId: () => string;
  aiActorId: string;
  resultTokenCap?: number;
}

const USER = (onBehalfOf: Actor): Actor => ({ kind: 'user', id: 'local-user', onBehalfOf });

function envelopeOf(code: PortError['code'], message: string, extra: Partial<ToolResultEnvelope> = {}): ToolResultEnvelope {
  return { ok: false, status: 'rejected', summary: message, error: { code, message }, ...extra };
}

function lowerFirst(s: string): string {
  return s ? s[0]!.toLowerCase() + s.slice(1) : s;
}

/** Pages an array (or the largest array inside an object) by an offset cursor (the cursor is the next row's index). */
export function pageOf(output: unknown, cursor: string | undefined, limit: number): { data: unknown; nextCursor?: string; page?: { rowsKey: string; offset: number } } {
  const offset = Math.max(0, Number.parseInt(cursor ?? '0', 10) || 0);
  const slice = (arr: unknown[]) => {
    const page = arr.slice(offset, offset + limit);
    const next = offset + limit < arr.length ? String(offset + limit) : undefined;
    return { page, total: arr.length, next };
  };
  if (Array.isArray(output)) {
    const s = slice(output);
    return { data: { items: s.page, total: s.total, ...(s.next ? { nextCursor: s.next } : {}) }, ...(s.next ? { nextCursor: s.next } : {}), page: { rowsKey: 'items', offset } };
  }
  if (isRec(output)) {
    let key: string | null = null;
    for (const [k, v] of Object.entries(output)) if (Array.isArray(v) && v.length > limit && (!key || v.length > (output[key] as unknown[]).length)) key = k;
    if (key) {
      const s = slice(output[key] as unknown[]);
      return { data: { ...output, [key]: s.page, [`${key}Total`]: s.total, ...(s.next ? { nextCursor: s.next } : {}) }, ...(s.next ? { nextCursor: s.next } : {}), page: { rowsKey: key, offset } };
    }
  }
  return { data: output };
}

export class CoachExecutor {
  private readonly records = new Map<string, CardRecord>();
  private readonly ledger = new Map<string, CallOutcome>();
  private readonly cap: number;

  constructor(private readonly deps: ExecutorDeps) {
    this.cap = deps.resultTokenCap ?? TOOL_RESULT_MAX_TOKENS;
  }

  private nowIso(): string {
    return this.deps.now().toISOString();
  }

  private wrap(call: ToolCall, envelope: ToolResultEnvelope, extra: Omit<CallOutcome, 'envelope' | 'message'> = {}): CallOutcome {
    const message: ChatMessage = { role: 'tool', parts: [{ type: 'text', text: JSON.stringify(envelope) }], toolCallId: call.id, toolName: call.name };
    if (!envelope.ok) message.isError = true;
    return { envelope, message, ...extra };
  }

  /**
   * Caps a result's data; a truncated page tells the model how to get the rest ("more: cursor"). When the cap cut
   * rows off a page, the cursor points at the first row that was cut (offset + rows kept), so no row is skipped.
   */
  private capped(data: unknown, nextCursor?: string, page?: { rowsKey: string; offset: number }): unknown {
    const c = capToolResult(data, this.cap, page?.rowsKey);
    let cursor = nextCursor ?? c.nextCursor;
    if (c.truncated && page && c.rowsKept !== undefined && c.rowsKept < c.rowsBefore!) {
      cursor = String(page.offset + c.rowsKept);
      if (isRec(c.data) && 'nextCursor' in c.data) c.data.nextCursor = cursor;
    }
    if (!c.truncated) return cursor && isRec(c.data) ? { ...c.data, more: `call again with cursor "${cursor}"` } : c.data;
    return { partial: c.data, truncated: true, hint: c.hint, ...(cursor ? { nextCursor: cursor, more: `call again with cursor "${cursor}"` } : {}) };
  }

  private aiActor(ctx: TurnContext, call: ToolCall): Actor {
    return { kind: 'ai', id: this.deps.aiActorId, conversationId: ctx.conversationId, toolCallId: call.id };
  }

  async run(toolset: CoachToolset, call: ToolCall, ctx: TurnContext): Promise<CallOutcome> {
    const key = await idempotencyKeyFor(ctx.conversationId, call.id);
    const seen = this.ledger.get(key);
    if (seen) return seen;
    const once = await this.runOnce(toolset, call, ctx, key);
    const out = once.card ? { ...once, card: this.stamp(once.card) } : once;
    this.ledger.set(key, out);
    return out;
  }

  /** The card with a snapshot of its record, so the record is stored with the conversation (survives a reload). */
  private stamp(card: CardView): CardView {
    const rec = this.records.get(card.id);
    if (!rec) return card;
    return { ...card, record: JSON.parse(JSON.stringify(rec)) as CardRecordData };
  }

  private async runOnce(toolset: CoachToolset, call: ToolCall, ctx: TurnContext, key: string): Promise<CallOutcome> {
    const resolved = toolset.resolve(call.name);
    if (!resolved) return this.wrap(call, envelopeOf('not_found', `There is no tool named "${call.name}". Use one of the tools provided.`));
    const createdAt = this.nowIso();
    if ('excluded' in resolved) {
      // a command the Coach is not given (UI-only: screening, keys, sync, deletes): never dispatched
      const def = resolved.excluded;
      const loosening = safetyLoosening(def.id, call.args, def.perm);
      const id = this.deps.newId();
      const card = loosening && def.id.startsWith('safety.')
        ? blockedCard(id, def.title, loosening, [], createdAt)
        : uiOnlyCard(id, def.title, '/settings', createdAt);
      this.records.set(card.id, { kind: 'info', commandId: def.id, input: call.args, aiActor: this.aiActor(ctx, call) });
      const reason = def.excludedReason?.ai ?? 'Only the person can do this, in the app.';
      return this.wrap(call, envelopeOf(card.class === 'blocked' ? 'safety_blocked' : 'surface_forbidden', `${reason} Tell the person where to do it; nothing has changed.`), { card });
    }

    if (call.parseError !== undefined) {
      return this.wrap(call, envelopeOf('invalid_input', `The arguments were not valid JSON (${call.parseError}). Send a single JSON object matching the tool's schema.`));
    }
    const schema = (resolved.kind === 'paged' ? resolved.paged!.input : resolved.kind === 'command' ? resolved.descriptor!.inputSchema : { type: 'object' }) as Rec;
    const input = stripStrictNulls(schema, call.args) as Rec;
    // a log without a date belongs to the day the person sees (after midnight and before the 04:00 rollover that is
    // still yesterday): the screen's day when the turn carries one, else the bus's `ctx.today` (also `appDay`)
    if (resolved.kind === 'command' && ctx.date && input.date === undefined && Object.hasOwn((schema.properties ?? {}) as Rec, 'date')) input.date = ctx.date;
    const check = validate(schema, input);
    if (!check.ok) return this.wrap(call, envelopeOf('invalid_input', `The arguments do not match the tool's schema. Fix these and call again:\n${formatErrors(check.errors)}`));

    if (++ctx.counts.calls > TURN_LIMITS.calls) return this.wrap(call, envelopeOf('rate_limited', 'Too many tool calls for one message. Answer with what you have.'));

    if (resolved.kind === 'loadTools') {
      const groups = Array.isArray(input.groups) ? (input.groups as string[]) : [];
      ctx.loadGroups(groups);
      return this.wrap(call, { ok: true, status: 'applied', summary: `Loaded the ${groups.join(', ')} tools for this conversation.` });
    }

    if (resolved.kind === 'command') {
      const loosening = safetyLoosening(resolved.id, input, resolved.def?.perm);
      if (loosening) {
        const card = blockedCard(this.deps.newId(), resolved.title, loosening, [], createdAt);
        this.records.set(card.id, { kind: 'info', commandId: resolved.id, input, aiActor: this.aiActor(ctx, call) });
        return this.wrap(call, envelopeOf('safety_blocked', `${loosening} Relay this; nothing has changed.`), { card });
      }
    }
    if (!toolset.allows(resolved, { tier: ctx.tier, noPlanning: ctx.noPlanning })) {
      if (ctx.noPlanning) {
        const rule = 'In your current safety mode, plans can’t be changed here.';
        const card = blockedCard(this.deps.newId(), resolved.title, rule, [], createdAt);
        this.records.set(card.id, { kind: 'info', commandId: resolved.id, input, aiActor: this.aiActor(ctx, call) });
        return this.wrap(call, envelopeOf('safety_blocked', `${rule} You can still log and explain.`), { card });
      }
      return this.wrap(call, envelopeOf('surface_forbidden', 'This model can log and answer questions, but not change the plan or run simulations. Say so and suggest Plan details or a larger model.'));
    }

    switch (resolved.cls) {
      case 'read':
        return this.read(resolved, call, ctx, input);
      case 'destructive':
        return this.destructive(resolved, call, ctx, input);
      case 'log':
        return this.log(resolved, call, ctx, input, key);
      case 'edit':
        if (ctx.smallEditsWithoutAsking && resolved.def?.impact !== 'consequential') return this.log(resolved, call, ctx, input, key);
        return this.edit(resolved, call, ctx, input, key);
    }
  }

  private async read(tool: ResolvedTool, call: ToolCall, ctx: TurnContext, input: Rec): Promise<CallOutcome> {
    const actor = this.aiActor(ctx, call);
    const commandInput = tool.kind === 'paged' ? tool.paged!.toCommandInput(input) : input;
    const r = await this.deps.bus.dispatch(tool.id, commandInput, { actor, correlationId: ctx.turnId, ...(ctx.signal ? { signal: ctx.signal } : {}) });
    const label = lowerFirst(tool.title);
    if (!r.ok) return this.wrap(call, this.fromError(r.error), { read: { label, summary: r.error.message } });
    if ('job' in r) return this.wrap(call, { ok: true, status: 'running', jobId: r.job.jobId, summary: `${tool.title} is running; check it with job_status.` }, { read: { label } });
    const output = 'output' in r ? r.output : null;
    const limit = typeof input.limit === 'number' ? input.limit : DEFAULT_PAGE;
    const cursor = typeof input.cursor === 'string' ? input.cursor : undefined;
    const paged = tool.kind === 'paged' || cursor || input.limit !== undefined ? pageOf(output, cursor, limit) : { data: output };
    const summary = `Looked at ${label}.`;
    return this.wrap(call, { ok: true, status: 'applied', summary, data: this.capped(paged.data, paged.nextCursor, 'page' in paged ? paged.page : undefined) }, { read: { label, summary: readSummary(output) } });
  }

  private destructive(tool: ResolvedTool, call: ToolCall, ctx: TurnContext, input: Rec): CallOutcome {
    if (++ctx.counts.destructive > TURN_LIMITS.destructive) {
      return this.wrap(call, envelopeOf('rate_limited', 'Only one confirmation request per message. Nothing has changed.'));
    }
    const card = destructiveCard(this.deps.newId(), tool.id, tool.title, ctx.planName, this.nowIso());
    this.records.set(card.id, { kind: 'destructive', commandId: tool.id, input, aiActor: this.aiActor(ctx, call) });
    return this.wrap(call, envelopeOf('confirmation_required', `${tool.title} needs the person's typed confirmation in the app. Nothing has changed; tell them it is waiting below and do not ask again.`, { data: { cardId: card.id } }), { card });
  }

  private async log(tool: ResolvedTool, call: ToolCall, ctx: TurnContext, input: Rec, key: string): Promise<CallOutcome> {
    if (++ctx.counts.writes > TURN_LIMITS.writes) return this.wrap(call, envelopeOf('rate_limited', 'Too many changes for one message. Stop and tell the person what was done.'));
    const actor = this.aiActor(ctx, call);
    const r = await this.deps.bus.dispatch(tool.id, input, { actor, idempotencyKey: key, correlationId: ctx.turnId, ...(ctx.signal ? { signal: ctx.signal } : {}) });
    if (!r.ok) return this.failed(tool, call, ctx, input, r);
    // E20: a read blood test report waits for its job and becomes the review card (saving is the person's markers.confirm)
    if ('job' in r && tool.id === MARKERS_IMPORT) return this.markersReview(call, ctx, input, r.job.jobId);
    if ('job' in r) return this.wrap(call, { ok: true, status: 'running', jobId: r.job.jobId, summary: `${tool.title} is running.` });
    if ('pending' in r) {
      // a log on a device-owned stream was staged as a correction (SUITE_SPEC §14.6): the card shows that correction
      const shown = r.redirected && isRec(r.redirectedInput) ? { commandId: r.redirected, input: r.redirectedInput } : null;
      return this.stagedOutcome(tool, call, ctx, input, r.pending.pendingId, r.pending.expiresAt, null, shown);
    }
    const output = r.output;
    const changeSetId = r.changeSet?.id;
    const id = this.deps.newId();
    const createdAt = this.nowIso();
    const meal = this.mealMeta(tool.id, input, ctx);
    const pending = isRec(output) && (output.logged === false || output.status === 'pending' || output.status === 'ask');
    const undo = undoOf(output, tool.id);
    const state = pending ? 'pending' : 'applied';
    const card = meal
      ? mealCard(id, output, input, { createdAt, state, meta: meal.meta, quiet: ctx.quiet, fromPhoto: meal.fromPhoto })
      : logCard(id, tool.title, input, output, { createdAt, state, commandId: tool.id });
    this.records.set(id, { kind: pending ? 'local' : 'log', commandId: tool.id, input, aiActor: actor, ...(changeSetId && !pending ? { changeSetId } : {}), ...(undo ? { undo } : {}), ...(meal ? { meal } : {}) });
    const question = isRec(output) && typeof output.question === 'string' ? output.question : null;
    const env: ToolResultEnvelope = { ok: true, status: pending ? 'pending_user' : 'applied', summary: pending ? `Not logged yet: ${question ?? 'one answer is needed from the person'}. Ask it, then log again with the answer.` : `${tool.title}: done. The person can undo it from the card.` };
    if (changeSetId) env.changeId = changeSetId;
    if (output !== undefined) env.data = this.capped(output);
    return this.wrap(call, env, { card });
  }

  /** E20: `markers.import` → its job's extraction → the review card; the card's Apply sends `markers.confirm` as the person. */
  private async markersReview(call: ToolCall, ctx: TurnContext, input: Rec, jobId: string): Promise<CallOutcome> {
    const actor = this.aiActor(ctx, call);
    const r = await settleJob(this.deps.bus, jobId, { kind: 'ai', id: actor.id, ...(actor.conversationId ? { conversationId: actor.conversationId } : {}), ...(actor.toolCallId ? { toolCallId: actor.toolCallId } : {}) }, ctx.signal);
    if (!r.ok) return this.wrap(call, this.fromError(r.error));
    const review = reviewOf('output' in r ? r.output : null, typeof input.attachmentId === 'string' ? input.attachmentId : '');
    if (!review) return this.wrap(call, envelopeOf('internal', 'The report could not be read. Ask the person to type the key values instead.'));
    const said = readerMessage('output' in r ? r.output : null);
    if (!review.rows.length) return this.wrap(call, envelopeOf('invalid_input', `${said ?? 'No results could be read from that file.'} Nothing was saved; offer to type the key values instead.`));
    const card = markersReviewCard(this.deps.newId(), review, this.nowIso());
    this.records.set(card.id, { kind: 'local', commandId: MARKERS_CONFIRM, input: confirmInputOf(review), aiActor: actor });
    return this.wrap(call, { ok: true, status: 'pending_user', jobId, summary: reviewSummary(review), data: this.capped('output' in r ? r.output : null) }, { card });
  }

  private mealMeta(commandId: string, input: Rec, ctx: TurnContext): CardRecord['meal'] | undefined {
    if (commandId !== 'log.meal' && commandId !== 'log.mealFromPhoto') return undefined;
    const fromPhoto = commandId === 'log.mealFromPhoto' || (Array.isArray(input.attachmentIds) && input.attachmentIds.length > 0);
    const attachment = typeof input.attachmentId === 'string' ? input.attachmentId : Array.isArray(input.attachmentIds) ? String(input.attachmentIds[0]) : undefined;
    const photo = attachment ? ctx.photos.get(attachment) : undefined;
    return {
      fromPhoto,
      meta: {
        ...(typeof input.slot === 'string' ? { slot: input.slot } : {}),
        ...(typeof input.clockH === 'number' ? { clockH: input.clockH } : {}),
        ...(photo ? { photo } : {}),
      },
    };
  }

  private async edit(tool: ResolvedTool, call: ToolCall, ctx: TurnContext, input: Rec, key: string): Promise<CallOutcome> {
    if (++ctx.counts.writes > TURN_LIMITS.writes) return this.wrap(call, envelopeOf('rate_limited', 'Too many proposals for one message. Stop and tell the person what is waiting.'));
    const actor = this.aiActor(ctx, call);
    const opts = { actor, correlationId: ctx.turnId, ...(ctx.signal ? { signal: ctx.signal } : {}) };
    // the dry run gives the preview (diff, goal dates); nothing is written
    const dry = await this.deps.bus.dispatch(tool.id, input, { ...opts, dryRun: true });
    if (!dry.ok) return this.failed(tool, call, ctx, input, dry);
    const preview = 'output' in dry ? dry.output : null;
    if (tool.def?.impact === 'consequential') {
      const staged = await this.deps.bus.dispatch(tool.id, input, { ...opts, idempotencyKey: key });
      if (!staged.ok) return this.failed(tool, call, ctx, input, staged);
      if ('pending' in staged) {
        // a log on a device-owned stream was staged as a correction (SUITE_SPEC §14.6): the card shows that correction
        const shown = staged.redirected && isRec(staged.redirectedInput) ? { commandId: staged.redirected, input: staged.redirectedInput } : null;
        return this.stagedOutcome(tool, call, ctx, input, staged.pending.pendingId, staged.pending.expiresAt, preview, shown);
      }
      // not staged (should not happen for an agent): it applied
      const id = this.deps.newId();
      const card = { ...proposalCard(id, tool.title, input, preview, { createdAt: this.nowIso(), commandId: tool.id }), state: 'applied' as const };
      this.records.set(id, { kind: 'log', commandId: tool.id, input, aiActor: actor, ...('changeSet' in staged && staged.changeSet ? { changeSetId: staged.changeSet.id } : {}) });
      return this.wrap(call, { ok: true, status: 'applied', summary: `${tool.title}: done.` }, { card });
    }
    // a low-impact proposal: kept here until the person applies it
    const id = this.deps.newId();
    const createdAt = this.nowIso();
    const card = proposalCard(id, tool.title, input, preview, { createdAt, until: new Date(Date.parse(createdAt) + CHANGE_WINDOW_MS).toISOString(), commandId: tool.id });
    this.records.set(id, { kind: 'local', commandId: tool.id, input, aiActor: actor });
    return this.wrap(call, this.pendingEnvelope(tool, preview, id), { card });
  }

  private pendingEnvelope(tool: ResolvedTool, preview: unknown, proposalId: string): ToolResultEnvelope {
    return {
      ok: true,
      status: 'pending_user',
      summary: `Proposed: ${tool.title}. Nothing has changed yet; tell the person what it does (goal dates included) and wait for them to apply or discard it.`,
      data: this.capped({ proposalId, preview }),
    };
  }

  private stagedOutcome(tool: ResolvedTool, call: ToolCall, ctx: TurnContext, input: Rec, pendingId: string, expiresAt: string, preview: unknown, shown: { commandId: string; input: Rec } | null = null): CallOutcome {
    const id = this.deps.newId();
    const card = proposalCard(id, tool.title, shown?.input ?? input, preview, { createdAt: this.nowIso(), until: expiresAt, commandId: shown?.commandId ?? tool.id });
    this.records.set(id, { kind: 'staged', commandId: tool.id, input, aiActor: this.aiActor(ctx, call), pendingId });
    return this.wrap(call, this.pendingEnvelope(tool, preview, pendingId), { card });
  }

  private failed(tool: ResolvedTool, call: ToolCall, ctx: TurnContext, input: Rec, r: Extract<CommandResult, { ok: false }>): CallOutcome {
    const env = this.fromError(r.error);
    const createdAt = this.nowIso();
    if (r.error.code === 'safety_blocked') {
      const card = blockedCard(this.deps.newId(), tool.title, r.error.message, r.error.detail?.allowedAlternatives ?? [], createdAt);
      this.records.set(card.id, { kind: 'info', commandId: tool.id, input, aiActor: this.aiActor(ctx, call) });
      return this.wrap(call, env, { card });
    }
    if (r.error.code === 'surface_forbidden') {
      const card = uiOnlyCard(this.deps.newId(), tool.title, '/settings', createdAt);
      this.records.set(card.id, { kind: 'info', commandId: tool.id, input, aiActor: this.aiActor(ctx, call) });
      return this.wrap(call, env, { card });
    }
    return this.wrap(call, env);
  }

  private fromError(error: PortError): ToolResultEnvelope {
    const env: ToolResultEnvelope = { ok: false, status: 'rejected', summary: error.message, error };
    if (error.code === 'safety_blocked' && error.detail?.allowedAlternatives?.length) env.data = { allowedAlternatives: error.detail.allowedAlternatives };
    return env;
  }

  /* ------------------------------------------------------------------------------------------ decisions */

  /**
   * The person's decision on a card. Returns the next card (or a failure message). A card made before a reload is
   * completed from the record stored on it.
   */
  async act(card: CardView, action: CardAction, extra: CardActionExtra = {}): Promise<{ ok: boolean; message?: string; card?: CardView }> {
    if (!this.records.has(card.id)) {
      const stored = recordFrom(card.record);
      if (stored) this.records.set(card.id, stored);
    }
    const r = await this.decide(card, action, extra);
    return r.card ? { ...r, card: this.stamp(r.card) } : r;
  }

  private async decide(card: CardView, action: CardAction, extra: CardActionExtra): Promise<{ ok: boolean; message?: string; card?: CardView }> {
    const rec = this.records.get(card.id);
    const now = this.deps.now();
    const open = undoWindowOpen(card, now);
    const bus = this.deps.bus;
    const fail = (message: string) => ({ ok: false, message });
    if (!rec) return action === 'open' || action === 'adjust' ? { ok: true } : fail('That card is no longer here.');

    switch (action) {
      case 'undo': {
        if (card.state === 'applied' && !open) return { ok: false, message: UNDO_WINDOW_OVER, card: { ...card, note: UNDO_WINDOW_OVER } };
        if (card.state !== 'applied' || (!rec.changeSetId && !rec.undo)) return fail('That can’t be undone from here any more; use History.');
        const r = await this.revert(rec);
        if (!r.ok) return fail(r.error.message);
        return { ok: true, card: { ...card, state: 'undone' } };
      }
      case 'redo': {
        if (card.state !== 'undone') return fail('That can’t be done now.');
        const r = await bus.dispatch(rec.commandId, rec.input, { actor: USER(rec.aiActor) });
        if (!r.ok) return fail(r.error.message);
        if ('changeSet' in r && r.changeSet) rec.changeSetId = r.changeSet.id;
        const u = undoOf('output' in r ? r.output : null, rec.commandId);
        if (u) rec.undo = u;
        return { ok: true, card: { ...card, state: 'applied', createdAt: now.toISOString(), until: undefined } };
      }
      case 'apply': {
        if (card.state !== 'pending' || (card.class === 'edit' && !open)) return fail('That can’t be applied any more.');
        if (rec.kind === 'staged' && rec.pendingId) {
          let changeSetId: string | undefined;
          const off = bus.on((e) => {
            if (e.type === 'committed' && e.commandId === rec.commandId && e.changeSet) changeSetId = e.changeSet.id;
          });
          let r: CommandResult;
          try {
            r = await bus.dispatch('coach.applyPending', { pendingId: rec.pendingId }, { actor: USER(rec.aiActor) });
          } finally {
            off();
          }
          if (!r.ok) {
            if (r.error.code === 'conflict' && r.error.detail?.retryable) return { ok: false, message: r.error.message, card: { ...card, state: 'stale', refreshed: { items: card.items, ...(card.impact ? { impact: card.impact } : {}) } } };
            return fail(r.error.message);
          }
          const out = 'output' in r && isRec(r.output) ? r.output : {};
          if (out.applied === false) return fail(isRec(out.error) && typeof out.error.message === 'string' ? out.error.message : 'That can’t be applied now.');
          if (changeSetId) rec.changeSetId = changeSetId;
          rec.kind = 'log';
          const note = adaptNote(out.result);
          return { ok: true, card: { ...card, state: 'applied', createdAt: now.toISOString(), until: undefined, ...(note ? { note } : {}) } };
        }
        // E20: a blood test report card saves the rows ticked in the app's review table (else the confident ones)
        if (rec.commandId === MARKERS_CONFIRM) {
          const base = isRec(rec.input) ? rec.input : {};
          rec.input = extra.markers ? { ...base, accept: extra.markers.accept, ...(extra.markers.context ? { context: extra.markers.context } : {}) } : base;
          if (!Array.isArray((rec.input as Rec).accept) || !((rec.input as Rec).accept as unknown[]).length) return fail('Open the review table to pick the rows and the sample date.');
        }
        const r = await bus.dispatch(rec.commandId, rec.input, { actor: USER(rec.aiActor) });
        if (!r.ok) return fail(r.error.message);
        if ('changeSet' in r && r.changeSet) rec.changeSetId = r.changeSet.id;
        rec.kind = 'log';
        const output = 'output' in r ? r.output : null;
        const u = undoOf(output, rec.commandId);
        if (u) rec.undo = u;
        if (rec.commandId === MARKERS_CONFIRM) {
          const n = ((rec.input as Rec).accept as unknown[]).length;
          return { ok: true, card: { ...card, state: 'applied', title: 'Blood test results saved', createdAt: now.toISOString(), until: undefined, note: `${n} result${n === 1 ? '' : 's'} saved. The rest of the report was not kept.` } };
        }
        if (card.class === 'log' && rec.meal) {
          const next = mealCard(card.id, output, rec.input, { createdAt: now.toISOString(), state: 'applied', meta: rec.meal.meta, fromPhoto: rec.meal.fromPhoto });
          return { ok: true, card: next };
        }
        const note = adaptNote(output);
        return { ok: true, card: { ...card, state: 'applied', createdAt: now.toISOString(), until: undefined, ...(note ? { note } : {}) } };
      }
      case 'discard':
      case 'dismiss': {
        if (action === 'dismiss' && card.meal?.review) return { ok: true, card: { ...card, meal: { ...card.meal, review: false } } };
        if (rec.kind === 'staged' && rec.pendingId && (card.state === 'pending' || card.state === 'stale')) {
          const r = await bus.dispatch('coach.discardPending', { pendingId: rec.pendingId }, { actor: USER(rec.aiActor) });
          if (!r.ok) return fail(r.error.message);
        }
        if (card.state === 'pending' || card.state === 'stale' || ((card.class === 'blocked' || card.class === 'uiOnly') && card.state === 'applied')) {
          return { ok: true, card: { ...card, state: 'discarded' } };
        }
        return fail('That can’t be done now.');
      }
      case 'review': {
        if (card.class === 'destructive') {
          // the page ran the typed confirmation and the command itself; the Coach only records that it happened
          if (extra.outcome !== 'confirmed') return { ok: true };
          return { ok: true, card: { ...card, state: 'applied' } };
        }
        if (card.state === 'stale' && rec.kind === 'staged') {
          // ask for a fresh proposal (the bus stages it again against the current documents)
          const r = await bus.dispatch(rec.commandId, rec.input, { actor: rec.aiActor, idempotencyKey: `r:${this.deps.newId()}`.slice(0, 64), correlationId: `review-${card.id}` });
          if (!r.ok) return fail(r.error.message);
          if ('pending' in r) {
            rec.pendingId = r.pending.pendingId;
            return { ok: true, card: { ...card, state: 'pending', createdAt: now.toISOString(), until: r.pending.expiresAt, refreshed: undefined } };
          }
        }
        return fail('That can’t be done now.');
      }
      case 'edit': {
        if (!rec.meal || !card.meal || !extra.componentId) return { ok: true };
        const comps = card.meal.components;
        const comp = comps.find((c) => c.id === extra.componentId);
        if (!comp) return fail('That card is no longer here.');
        const grams = extra.grams;
        if (grams === undefined || !Number.isFinite(grams) || grams <= 0) return fail('Type the grams as a number.');
        // the person's grams: re-log the meal as "photo + your grams" (narrower band), retracting the first estimate
        if (card.state === 'applied' && (rec.changeSetId || rec.undo)) {
          const u = await this.revert(rec);
          if (!u.ok) return fail(u.error.message);
        }
        const inp = isRec(rec.input) ? rec.input : {};
        const components = comps.map((c) => ({ name: c.name, grams: c.id === comp.id ? grams : c.grams, ...(c.id === comp.id || c.yours ? {} : { gramsLow: c.gramsLow, gramsHigh: c.gramsHigh }) }));
        const relog = {
          ...(typeof inp.date === 'string' ? { date: inp.date } : {}),
          ...(typeof inp.slot === 'string' ? { slot: inp.slot } : rec.meal.meta.slot ? { slot: rec.meal.meta.slot } : {}),
          ...(typeof inp.clockH === 'number' ? { clockH: inp.clockH } : {}),
          ...(typeof inp.text === 'string' ? { text: inp.text } : {}),
          components,
          method: rec.meal.fromPhoto ? 'aiPhotoUserGrams' : 'typed',
          ...(typeof inp.attachmentId === 'string' ? { attachmentIds: [inp.attachmentId] } : Array.isArray(inp.attachmentIds) ? { attachmentIds: inp.attachmentIds } : {}),
        };
        const r = await bus.dispatch('log.meal', relog, { actor: USER(rec.aiActor) });
        if (!r.ok) return fail(r.error.message);
        rec.commandId = 'log.meal';
        rec.input = relog;
        rec.kind = 'log';
        if ('changeSet' in r && r.changeSet) rec.changeSetId = r.changeSet.id;
        const u2 = undoOf('output' in r ? r.output : null, 'log.meal');
        if (u2) rec.undo = u2;
        const output = 'output' in r ? r.output : null;
        const next = mealCard(card.id, output, relog, { createdAt: card.createdAt, state: 'applied', meta: rec.meal.meta, fromPhoto: rec.meal.fromPhoto });
        // the components the person typed are theirs (exact grams)
        next.meal = { ...next.meal!, review: false, components: next.meal!.components.map((c, i) => (comps[i]?.id === comp.id || comps[i]?.yours ? { ...c, gramsLow: c.grams, gramsHigh: c.grams, yours: true } : c)) };
        return { ok: true, card: { ...next, ...(card.until ? { until: card.until } : {}) } };
      }
      case 'alternative':
        if (card.class !== 'blocked') return fail('That can’t be done now.');
        return { ok: true, message: 'Ask the Coach for that instead.', card: { ...card, state: 'discarded' } };
      case 'adjust':
      case 'open':
        return { ok: true };
    }
  }

  /**
   * Undo an applied record as the person: the command's own undo, else `history.undo` of its ChangeSet. A plan change
   * the person then adopted on Today is un-adopted first; otherwise the adopted copy stayed in force (Q4).
   */
  private async revert(rec: CardRecord): Promise<CommandResult> {
    if (rec.undo) return this.deps.bus.dispatch(rec.undo.command, rec.undo.input, { actor: USER(rec.aiActor) });
    if (rec.changeSetId && rec.commandId.startsWith('plan.')) await this.revertAdoption(rec, rec.changeSetId);
    return this.deps.bus.dispatch('history.undo', { changeSetId: rec.changeSetId }, { actor: USER(rec.aiActor) });
  }

  /** Undoes the adoption of a version this record's ChangeSet proposed (`plan.adoptVersion` appends `parent` = it). */
  private async revertAdoption(rec: CardRecord, changeSetId: string): Promise<void> {
    const opts = { actor: USER(rec.aiActor) };
    const list = await this.deps.bus.dispatch('history.list', { limit: 100 }, opts);
    type Set = { id: string; commandId: string; undoneBy?: string; docs: Array<{ col: string; id: string }> };
    const sets = list.ok && 'output' in list && Array.isArray(list.output) ? (list.output as Set[]) : [];
    const proposed = new Map<number, string>(); // version → plan id, from `<planId>:v<n>`
    for (const d of sets.find((c) => c.id === changeSetId)?.docs ?? []) {
      const m = d.col === 'planVersions' ? /^(.+):v(\d+)$/.exec(d.id) : null;
      if (m) proposed.set(Number(m[2]), m[1]!);
    }
    if (!proposed.size) return;
    const vr = await this.deps.bus.dispatch('plan.versions', {}, opts);
    const versions = vr.ok && 'output' in vr && Array.isArray(vr.output) ? (vr.output as Array<{ version: number; parent: number | null; status: string }>) : [];
    for (const v of versions) {
      const planId = v.parent !== null && v.status === 'adopted' ? proposed.get(v.parent) : undefined;
      if (!planId) continue;
      const decision = sets.find((c) => !c.undoneBy && c.commandId === 'plan.adoptVersion' && c.docs.some((d) => d.col === 'planVersions' && d.id === `${planId}:v${v.version}`));
      if (decision) await this.deps.bus.dispatch('history.undo', { changeSetId: decision.id }, opts);
    }
  }

  /**
   * A log the model suggested without tools (structured-output fallback, living-mode.md §7.5 "Model can't use tools"):
   * shown as a pending card; nothing is written until the person applies it (as themselves, on behalf of the Coach).
   */
  suggest(commandId: string, args: Rec, ctx: Pick<TurnContext, 'conversationId' | 'quiet'>): CardView | null {
    const def = this.deps.bus.getCommand(commandId);
    if (!def || classOf(def) !== 'log' || safetyLoosening(commandId, args, def.perm)) return null;
    const descriptor = this.deps.bus.manifest().find((d) => d.commandId === commandId);
    const input = commandId === 'log.meal' ? { method: 'aiText', ...args } : args;
    if (descriptor && !validate(descriptor.inputSchema as Rec, input).ok) return null;
    const id = this.deps.newId();
    const createdAt = this.nowIso();
    const actor: Actor = { kind: 'ai', id: this.deps.aiActorId, conversationId: ctx.conversationId, toolCallId: `suggest-${id}` };
    const meal = commandId === 'log.meal' ? { fromPhoto: false, meta: { ...(typeof args.slot === 'string' ? { slot: args.slot } : {}), ...(typeof args.clockH === 'number' ? { clockH: args.clockH } : {}) } } : undefined;
    this.records.set(id, { kind: 'local', commandId, input, aiActor: actor, ...(meal ? { meal } : {}) });
    return this.stamp(meal ? mealCard(id, null, input, { createdAt, state: 'pending', meta: meal.meta, quiet: ctx.quiet }) : logCard(id, def.title, input, null, { createdAt, state: 'pending', commandId }));
  }

  /** The command behind a card (tests, activity). */
  commandOf(cardId: string): string | undefined {
    return this.records.get(cardId)?.commandId;
  }

  /** A card as restored from the documents: an applied change past its undo window says so (it no longer offers Undo). */
  static restored(card: CardView, now: Date): CardView {
    if (card.state !== 'applied' || (card.class !== 'log' && card.class !== 'edit') || card.note || undoWindowOpen(card, now)) return card;
    return { ...card, note: UNDO_WINDOW_OVER };
  }
}

/**
 * How to undo a write: the command's own `undo` hint; else, for a log that answered with its `entryId`, a retract of
 * that entry (logs and measurements are append-only, so `history.undo` of their ChangeSet cannot remove them — the
 * same rule the Living screens apply); else nothing (the ChangeSet is undone).
 */
function undoOf(output: unknown, commandId?: string): CardRecord['undo'] | undefined {
  const u = isRec(output) ? output.undo : undefined;
  if (isRec(u) && typeof u.command === 'string') return { command: u.command, input: u.input };
  const entryId = isRec(output) ? output.entryId : undefined;
  if (typeof entryId === 'string' && commandId?.startsWith('log.') && commandId !== 'log.retract' && commandId !== 'log.edit') return { command: 'log.retract', input: { entryId } };
  return undefined;
}

/** A two-line summary of a read result for the "looked at" card. */
function readSummary(output: unknown): string | undefined {
  if (Array.isArray(output)) return `${output.length} item${output.length === 1 ? '' : 's'}.`;
  if (isRec(output)) {
    const keys = Object.keys(output).slice(0, 4);
    return keys.length ? `${keys.join(', ')}.` : undefined;
  }
  return undefined;
}

export { classOf, LOAD_TOOLS_ID };

/**
 * What an applied plan change did (AdaptOutput of `plan.replan`, `plan.declareEvent`, `plan.shift`, `plan.editDay`): the
 * plan may keep it as a proposal on Today (it raises load), apply it, or find nothing to change.
 */
export function adaptNote(output: unknown): string | undefined {
  if (!isRec(output) || typeof output.status !== 'string' || !('goalDates' in output)) return undefined;
  const lead = Array.isArray(output.notes) && typeof output.notes[0] === 'string' ? `${output.notes[0]} ` : '';
  switch (output.status) {
    case 'proposed':
      return `${lead}It is waiting on Today: apply it there to change the plan.`;
    case 'adopted':
      return `${lead}The plan is updated.`;
    case 'unchanged':
      return 'The plan already fits, so nothing changed.';
    default:
      return undefined;
  }
}
