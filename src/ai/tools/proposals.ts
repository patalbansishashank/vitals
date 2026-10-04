/**
 * Runs AI tool calls through the command port per confirmation class (R8 §5.2–§5.3, SUITE_SPEC §1.4, §1.6, §1.8):
 * `read` runs, `log` applies with an undo token, `edit` is staged as a proposal from a dry run, `destructive` never
 * runs from the model and waits for a typed confirmation in the app.
 *
 * Idempotency key: `${conversationId}:${toolCallId}` when that is ≤ 64 chars; otherwise `h:` + the first 62 hex chars
 * of SHA-256 over that same string (64 chars, deterministic). A local ledger keyed by it returns the stored result when
 * a stream is retried or the model repeats a call, without dispatching again.
 */
import type { ChatMessage, ToolCall } from '../providers/types';
import { capToolResult, TOOL_RESULT_MAX_TOKENS } from './budget';
import { perTurnLimit, sha256Hex, type ToolRegistry } from './registry';
import type {
  AiCommandDef,
  CommandPort,
  PortActor,
  PortError,
  PortResult,
  Proposal,
  ToolResultEnvelope,
} from './types';
import { formatErrors, stripStrictNulls, validate } from './validate';

const MAX_KEY_LENGTH = 64;

export async function idempotencyKeyFor(conversationId: string, toolCallId: string): Promise<string> {
  const raw = `${conversationId}:${toolCallId}`;
  if (raw.length <= MAX_KEY_LENGTH) return raw;
  return `h:${(await sha256Hex(raw)).slice(0, MAX_KEY_LENGTH - 2)}`;
}

export interface ToolRunnerOptions {
  registry: ToolRegistry;
  port: CommandPort;
  /** ISO instant. */
  now: () => string;
  /** Proposal ids. */
  newId: () => string;
  /** "Auto-apply small edits" (SUITE_SPEC §1.4; default off). Called with the dry-run output. */
  autoApplyEdit?: (def: AiCommandDef, input: unknown, preview: unknown) => boolean;
  resultTokenCap?: number;
  /** `Actor.id` for the Coach (provider preset id or similar). */
  aiActorId?: string;
}

export interface HandledCall {
  envelope: ToolResultEnvelope;
  message: ChatMessage;
}

export class ToolRunner {
  private readonly registry: ToolRegistry;
  private readonly port: CommandPort;
  private readonly now: () => string;
  private readonly newId: () => string;
  private readonly autoApplyEdit: ToolRunnerOptions['autoApplyEdit'];
  private readonly cap: number;
  private readonly aiActorId: string;

  private readonly ledger = new Map<string, HandledCall>();
  private readonly inflight = new Map<string, Promise<HandledCall>>();
  private readonly proposals = new Map<string, Proposal>();
  private readonly applying = new Map<string, Promise<ToolResultEnvelope>>();
  private readonly turnCounts = new Map<string, number>();
  private notes: string[] = [];

  constructor(opts: ToolRunnerOptions) {
    this.registry = opts.registry;
    this.port = opts.port;
    this.now = opts.now;
    this.newId = opts.newId;
    this.autoApplyEdit = opts.autoApplyEdit;
    this.cap = opts.resultTokenCap ?? TOOL_RESULT_MAX_TOKENS;
    this.aiActorId = opts.aiActorId ?? 'coach';
  }

  /** Resets per-turn call counters; call at the start of each user turn. */
  beginTurn(): void {
    this.turnCounts.clear();
  }

  async handleCall(conversationId: string, call: ToolCall, signal?: AbortSignal): Promise<HandledCall> {
    const def = this.registry.byToolName(call.name);
    if (!def) {
      return this.wrap(call, reject('not_found', `There is no tool named "${call.name}". Use one of the tools provided.`));
    }
    const key = await idempotencyKeyFor(conversationId, call.id);
    const stored = this.ledger.get(key);
    if (stored) return stored;
    const running = this.inflight.get(key);
    if (running) return running;

    if (call.parseError !== undefined) {
      return this.wrap(call, reject('invalid_input', `The arguments were not valid JSON (${call.parseError}). Send a single JSON object matching the tool's schema.`));
    }
    const input = stripStrictNulls(def.input, call.args);
    const check = validate(def.input, input);
    if (!check.ok) {
      return this.wrap(call, reject('invalid_input', `The arguments do not match the tool's schema. Fix these and call again:\n${formatErrors(check.errors)}`, { path: check.errors[0]!.path }));
    }
    const used = this.turnCounts.get(def.id) ?? 0;
    const limit = perTurnLimit(def);
    if (used >= limit) {
      return this.wrap(call, reject('rate_limited', `This tool can be used at most ${limit} time${limit === 1 ? '' : 's'} per message. Continue with what you have or ask the person.`));
    }
    this.turnCounts.set(def.id, used + 1);

    const p = this.run(def, conversationId, call, key, input, signal).then((envelope) => {
      const handled = this.wrap(call, envelope);
      this.ledger.set(key, handled);
      return handled;
    });
    this.inflight.set(key, p);
    try {
      return await p;
    } finally {
      this.inflight.delete(key);
    }
  }

  private aiActor(conversationId: string, toolCallId: string): PortActor {
    return { kind: 'ai', id: this.aiActorId, conversationId, toolCallId };
  }

  private async run(def: AiCommandDef, conversationId: string, call: ToolCall, key: string, input: unknown, signal?: AbortSignal): Promise<ToolResultEnvelope> {
    const actor = this.aiActor(conversationId, call.id);
    const withSignal = signal ? { signal } : {};
    switch (def.confirm) {
      case 'read': {
        const r = await this.port.dispatch(def.id, input, { actor, idempotencyKey: key, ...withSignal });
        return this.toEnvelope(def, r, 'read');
      }
      case 'log': {
        const r = await this.port.dispatch(def.id, input, { actor, idempotencyKey: key, ...withSignal });
        return this.toEnvelope(def, r, 'write');
      }
      case 'edit': {
        const dry = await this.port.dispatch(def.id, input, { actor, dryRun: true, ...withSignal });
        if (!dry.ok || 'job' in dry || 'pending' in dry) return this.toEnvelope(def, dry, 'write');
        const preview = dry.output;
        const proposal = this.newProposal(def, conversationId, call.id, key, input, preview);
        if (this.autoApplyEdit?.(def, input, preview)) {
          // the person's own "auto-apply small edits" setting applies it: as the person, on behalf of the Coach
          // (an AI actor's consequential write would be staged by the dispatcher)
          const r = await this.port.dispatch(def.id, input, { actor: { kind: 'user', id: 'local-user', onBehalfOf: actor }, idempotencyKey: key, ...withSignal });
          const env = this.toEnvelope(def, r, 'write');
          proposal.status = env.ok ? 'applied' : 'failed';
          proposal.result = env;
          return env;
        }
        const what = dry.summary ?? def.title;
        return {
          ok: true,
          status: 'pending_user',
          summary: `Proposed: ${what}. Nothing has changed yet; stop here and wait for the person to apply or discard it.`,
          data: this.capData({ proposalId: proposal.id, preview }),
        };
      }
      case 'destructive': {
        const proposal = this.newProposal(def, conversationId, call.id, key, input, null);
        proposal.requiresTypedConfirmation = true;
        return {
          ok: false,
          status: 'rejected',
          summary: `${def.title} needs the person's typed confirmation in the app. Nothing has changed; ask them to confirm there.`,
          data: { proposalId: proposal.id },
          error: { code: 'confirmation_required', message: `${def.title} needs the person's typed confirmation.` },
        };
      }
    }
  }

  private newProposal(def: AiCommandDef, conversationId: string, toolCallId: string, key: string, input: unknown, preview: unknown): Proposal {
    const proposal: Proposal = {
      id: this.newId(),
      conversationId,
      toolCallId,
      commandId: def.id,
      input,
      preview,
      status: 'pending',
      createdAt: this.now(),
      idempotencyKey: key,
    };
    this.proposals.set(proposal.id, proposal);
    return proposal;
  }

  private capData(data: unknown): unknown {
    const c = capToolResult(data, this.cap);
    if (!c.truncated) return c.data;
    return { partial: c.data, truncated: true, hint: c.hint, ...(c.nextCursor ? { nextCursor: c.nextCursor } : {}) };
  }

  private toEnvelope(def: AiCommandDef, r: PortResult, kind: 'read' | 'write'): ToolResultEnvelope {
    if (!r.ok) return fromError(r.error);
    if ('pending' in r) {
      return {
        ok: true,
        status: 'pending_user',
        changeId: r.pending.pendingId,
        summary: `Proposed: ${def.title}. Nothing has changed yet; stop here and wait for the person to apply or discard it.`,
      };
    }
    if ('job' in r) {
      return {
        ok: true,
        status: 'running',
        jobId: r.job.jobId,
        summary: `${def.title} is running. Check progress with the job status tool.`,
      };
    }
    const env: ToolResultEnvelope = {
      ok: true,
      status: 'applied',
      summary: r.summary ?? (kind === 'read' ? `Looked at ${lowerFirst(def.title)}.` : `${def.title}: done.`),
    };
    if (r.changeId) env.changeId = r.changeId;
    if (r.undoToken) env.undoToken = r.undoToken;
    if (r.output !== undefined) env.data = this.capData(r.output);
    return env;
  }

  private wrap(call: ToolCall, envelope: ToolResultEnvelope): HandledCall {
    const message: ChatMessage = {
      role: 'tool',
      parts: [{ type: 'text', text: JSON.stringify(envelope) }],
      toolCallId: call.id,
      toolName: call.name,
    };
    if (!envelope.ok) message.isError = true;
    return { envelope, message };
  }

  /**
   * Applies a pending proposal as the person (SUITE_SPEC §1.4: actor `user`, `onBehalfOf` the AI) with the same
   * idempotency key. Applying an already-applied proposal returns the first result without dispatching again.
   */
  async apply(proposalId: string, opts: { confirmation?: unknown; signal?: AbortSignal } = {}): Promise<ToolResultEnvelope> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) return reject('not_found', 'That proposed change no longer exists.');
    if (proposal.status === 'applied' && proposal.result) return proposal.result;
    if (proposal.status === 'discarded') return reject('conflict', 'That proposed change was discarded.');
    const inflight = this.applying.get(proposalId);
    if (inflight) return inflight;
    const def = this.registry.get(proposal.commandId);
    if (!def) return reject('not_found', 'That command is no longer available.');
    if (proposal.requiresTypedConfirmation && opts.confirmation === undefined) {
      return reject('confirmation_required', `${def.title} needs a typed confirmation.`);
    }
    const p = (async () => {
      const r = await this.port.dispatch(def.id, proposal.input, {
        actor: { kind: 'user', id: 'local-user', onBehalfOf: this.aiActor(proposal.conversationId, proposal.toolCallId) },
        idempotencyKey: proposal.idempotencyKey,
        ...(opts.confirmation !== undefined ? { confirmation: opts.confirmation } : {}),
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      const env = this.toEnvelope(def, r, 'write');
      if (env.ok) {
        proposal.status = 'applied';
        proposal.result = env;
        this.notes.push(`[system note: proposal ${proposal.id} applied]`);
      } else {
        proposal.status = 'failed';
        proposal.result = env;
        this.notes.push(`[system note: proposal ${proposal.id} failed: ${env.summary}]`);
      }
      return env;
    })();
    this.applying.set(proposalId, p);
    try {
      return await p;
    } finally {
      this.applying.delete(proposalId);
    }
  }

  /** Marks a pending proposal discarded; false when it is not pending. */
  discard(proposalId: string): boolean {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.status !== 'pending' || this.applying.has(proposalId)) return false;
    proposal.status = 'discarded';
    this.notes.push(`[system note: proposal ${proposal.id} discarded]`);
    return true;
  }

  async undo(undoToken: string): Promise<ToolResultEnvelope> {
    const r = await this.port.undo(undoToken);
    if (!r.ok) return fromError(r.error);
    return { ok: true, status: 'applied', summary: 'summary' in r && r.summary ? r.summary : 'Undone.' };
  }

  pending(): Proposal[] {
    return [...this.proposals.values()].filter((p) => p.status === 'pending');
  }

  proposal(id: string): Proposal | undefined {
    return this.proposals.get(id);
  }

  /** System notes for the next user turn; cleared on read. */
  drainNotes(): string[] {
    const out = this.notes;
    this.notes = [];
    return out;
  }
}

function lowerFirst(s: string): string {
  return s ? s[0]!.toLowerCase() + s.slice(1) : s;
}

function reject(code: PortError['code'], message: string, detail?: PortError['detail']): ToolResultEnvelope {
  return fromError({ code, message, ...(detail ? { detail } : {}) });
}

function fromError(error: PortError): ToolResultEnvelope {
  const env: ToolResultEnvelope = { ok: false, status: 'rejected', summary: error.message, error };
  const alternatives = error.detail?.allowedAlternatives;
  if (error.code === 'safety_blocked' && alternatives?.length) env.data = { allowedAlternatives: alternatives };
  return env;
}
