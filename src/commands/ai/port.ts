/**
 * The Coach's `CommandPort` (`src/ai/tools/types.ts`) over the command bus (SUITE_SPEC §1.3–§1.6, §5.2):
 *
 * - every call is a `dispatch` with the Coach's actor (`{kind:'ai', id, conversationId, toolCallId}`) or, when the
 *   person applies a proposal, `{kind:'user', onBehalfOf: <the AI actor>}`;
 * - the idempotency key is the caller's, else `${conversationId}:${toolCallId}` (hashed past 64 characters exactly like
 *   `src/ai/tools/proposals.ts` `idempotencyKeyFor`), so a retried stream or a repeated call replays the stored result;
 * - `dryRun` previews a proposal (safety gates and preconditions still run; nothing is written);
 * - a consequential write the bus staged comes back as `pending` (the runner shows it as `pending_user`);
 * - `safety_blocked` keeps `detail.allowedAlternatives`; destructive commands come back `confirmation_required`;
 * - `undo(undoToken)` is `history.undo` for that ChangeSet, as the person (the Undo key on the Coach's card).
 *
 * The bus is imported lazily so this module stays light for the main chunk.
 */
import type { CommandPort, PortActor, PortDispatchOptions, PortError, PortResult } from '@/ai/tools/types';
import { getCommand } from '../registry';
import { sha256Hex } from '../schema';
import { LOCAL_USER, type Actor, type CommandResult, type ConfirmationToken, type DispatchOptions } from '../types';

const MAX_KEY = 64;

/** `${conversationId}:${toolCallId}`, or `h:` + 62 hex of its SHA-256 when longer than 64 characters. */
export function aiIdempotencyKey(conversationId: string, toolCallId: string): string {
  const raw = `${conversationId}:${toolCallId}`;
  return raw.length <= MAX_KEY ? raw : `h:${sha256Hex(raw).slice(0, MAX_KEY - 2)}`;
}

function toActor(a: PortActor): Actor {
  return {
    kind: a.kind,
    id: a.id,
    ...(a.conversationId ? { conversationId: a.conversationId } : {}),
    ...(a.toolCallId ? { toolCallId: a.toolCallId } : {}),
    ...(a.onBehalfOf ? { onBehalfOf: toActor(a.onBehalfOf) } : {}),
  };
}

/** The key a call carries: the caller's, else derived from the AI actor (or the AI it acts on behalf of). */
function keyFor(opts: PortDispatchOptions): string | undefined {
  if (opts.idempotencyKey) return opts.idempotencyKey.slice(0, MAX_KEY);
  const ai = opts.actor.kind === 'ai' ? opts.actor : opts.actor.onBehalfOf;
  return ai?.conversationId && ai.toolCallId ? aiIdempotencyKey(ai.conversationId, ai.toolCallId) : undefined;
}

function portError(e: { code: PortError['code']; message: string; detail?: Record<string, unknown> }): PortError {
  return { code: e.code, message: e.message, ...(e.detail ? { detail: e.detail as PortError['detail'] } : {}) };
}

/** The bus result as the port's simplified result. */
export function toPortResult(id: string, r: CommandResult, dryRun = false): PortResult {
  if (!r.ok) return { ok: false, error: portError(r.error) };
  if ('job' in r) return { ok: true, job: { jobId: r.job.jobId } };
  if ('pending' in r) return { ok: true, pending: { pendingId: r.pending.pendingId, expiresAt: r.pending.expiresAt } };
  const def = getCommand(id);
  const cs = !dryRun && r.changeSet && r.changeSet.id !== 'dry-run' ? r.changeSet : null;
  const notes = r.notices.filter((n) => n.level !== 'info').map((n) => n.text);
  return {
    ok: true,
    output: def?.toModel ? def.toModel(r.output as never) : r.output,
    ...(cs ? { changeId: cs.id } : {}),
    ...(cs && def && def.undo.kind !== 'none' ? { undoToken: cs.id } : {}),
    ...(notes.length ? { summary: `${def?.title ?? id}: ${notes.join(' ')}`.slice(0, 280) } : {}),
  };
}

export interface BusCommandPortOptions {
  /** Who undoes through `undo()` (default the person: the Undo key on the Coach's card). */
  undoActor?: Actor;
}

/** `CommandPort` over `dispatch` (SUITE_SPEC §1.3). */
export function createBusCommandPort(options: BusCommandPortOptions = {}): CommandPort {
  return {
    async dispatch(id, input, opts) {
      const { dispatch } = await import('../bus');
      const key = keyFor(opts);
      const dispatchOpts: DispatchOptions = {
        actor: toActor(opts.actor),
        ...(key ? { idempotencyKey: key } : {}),
        ...(opts.dryRun ? { dryRun: true } : {}),
        ...(opts.confirmation !== undefined ? { confirmation: opts.confirmation as ConfirmationToken } : {}),
        ...(opts.signal ? { signal: opts.signal } : {}),
      };
      return toPortResult(id, await dispatch(id, input, dispatchOpts), Boolean(opts.dryRun));
    },
    async undo(undoToken) {
      const { dispatch } = await import('../bus');
      const r = await dispatch('history.undo', { changeSetId: undoToken }, { actor: options.undoActor ?? LOCAL_USER });
      if (!r.ok) return { ok: false, error: portError(r.error) };
      if (!('output' in r)) return { ok: true, output: null };
      const out = r.output as { undone: boolean; skipped: string[] };
      return {
        ok: true,
        output: out,
        summary: out.skipped.length ? `Undone, except what changed since (${out.skipped.length}).` : 'Undone.',
      };
    },
  };
}
