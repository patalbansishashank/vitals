/**
 * AI-side view of the command API (SUITE_SPEC §1.3–§1.8, R8 §5.2–§5.3).
 *
 * The real registry and dispatcher live in `src/commands/` (package E4). The Coach talks to them only through the
 * narrow `CommandPort` below, so E4 plugs in an adapter over `CommandBus` and nothing in `src/ai/tools` changes.
 *
 * Tier H (SUITE_SPEC §0.2): no DOM, no React, no clock, no randomness.
 */
import type { JsonSchema } from '../providers/types';

/** R8 §5.2 confirmation class. */
export type ConfirmClass = 'read' | 'log' | 'edit' | 'destructive';

export type CommandIdLike = `${string}.${string}`;

/** What the AI layer needs to know about one command (a projection of SUITE_SPEC `CommandDef`). */
export interface AiCommandDef {
  /** `domain.lowerCamel`, e.g. `log.meal`. */
  id: CommandIdLike;
  /** The domain before the dot; used for tool groups. */
  namespace: string;
  /** Bumped on any breaking input/output change; part of the manifest hash (SUITE_SPEC §1.2). */
  version?: number;
  /** User-facing, ≤ 60 chars. */
  title: string;
  /** Model-facing, ≤ 600 chars. */
  description: string;
  input: JsonSchema;
  output?: JsonSchema;
  confirm: ConfirmClass;
  aiLimit?: { perTurn: number };
  /** Offered to "basic" tier models (R8 §3.6). Default: true for `read` and `log`, false otherwise. */
  basic?: boolean;
}

/** Builds an `AiCommandDef` with `namespace` derived from the id. */
export function aiCommand(def: Omit<AiCommandDef, 'namespace'> & { namespace?: string }): AiCommandDef {
  return { ...def, namespace: def.namespace ?? def.id.slice(0, def.id.indexOf('.')) };
}

export type Perm = 'read' | 'write' | 'destructive';
export type Impact = 'low' | 'consequential';

/** SUITE_SPEC §1.4 table: perm / impact → R8 class. A write without impact counts as `low`. */
export function confirmClassOf({ perm, impact }: { perm: Perm; impact?: Impact }): ConfirmClass {
  if (perm === 'read') return 'read';
  if (perm === 'destructive') return 'destructive';
  return impact === 'consequential' ? 'edit' : 'log';
}

/** SUITE_SPEC §1.3 `CommandError['code']`. */
export type CommandErrorCode =
  | 'invalid_input'
  | 'not_found'
  | 'conflict'
  | 'precondition_failed'
  | 'safety_blocked'
  | 'confirmation_required'
  | 'surface_forbidden'
  | 'rate_limited'
  | 'busy'
  | 'cancelled'
  | 'quota_exceeded'
  | 'internal';

export interface CommandErrorDetail {
  path?: string;
  precondition?: string;
  gate?: string;
  rule?: string;
  retryable?: boolean;
  /** `safety_blocked`: what the model may offer instead (R8 §5.2). */
  allowedAlternatives?: string[];
}

/** SUITE_SPEC §1.3 `CommandError`. `message` is user-readable. */
export interface PortError {
  code: CommandErrorCode;
  message: string;
  detail?: CommandErrorDetail;
}

/** Subset of SUITE_SPEC `Actor` the Coach uses. */
export interface PortActor {
  kind: 'ai' | 'user';
  id: string;
  conversationId?: string;
  toolCallId?: string;
  onBehalfOf?: PortActor;
}

export interface PortDispatchOptions {
  actor: PortActor;
  /** ≤ 64 chars (SUITE_SPEC §1.3). */
  idempotencyKey?: string;
  dryRun?: boolean;
  /** Opaque `ConfirmationToken` minted by the app's confirm dialog; the AI layer never mints one. */
  confirmation?: unknown;
  signal?: AbortSignal;
}

/** Simplified `CommandResult` (SUITE_SPEC §1.3). */
export type PortResult =
  | { ok: true; output: unknown; changeId?: string; undoToken?: string; summary?: string }
  | { ok: true; job: { jobId: string } }
  /** The bus staged the call as a proposal (`pendingChanges`) for the person to apply. */
  | { ok: true; pending: { pendingId: string; expiresAt?: string } }
  | { ok: false; error: PortError };

/** Narrow port over SUITE_SPEC `CommandBus` (implemented by E4). */
export interface CommandPort {
  dispatch(id: string, input: unknown, opts: PortDispatchOptions): Promise<PortResult>;
  undo(undoToken: string): Promise<PortResult>;
}

export type ToolResultStatus = 'applied' | 'pending_user' | 'needs_choice' | 'rejected' | 'running';

/** Tool result envelope (SUITE_SPEC §1.8, R8 §5.3) plus `undoToken`. Serialised as the tool message text. */
export interface ToolResultEnvelope {
  ok: boolean;
  status: ToolResultStatus;
  changeId?: string;
  jobId?: string;
  /** ≤ 2 lines, human words. */
  summary: string;
  /** `needs_choice`: false, nothing was saved. */
  saved?: boolean;
  /** `needs_choice`: foods the model can pick from (pass `foodId` in the component and call again). */
  candidates?: Array<{ component: string; foodId: string; name: string }>;
  /** Capped at the tool-result budget (R8 §5.5). */
  data?: unknown;
  error?: PortError;
  undoToken?: string;
}

export type ProposalStatus = 'pending' | 'applied' | 'discarded' | 'failed';

/** A staged `edit` or `destructive` call (SUITE_SPEC §1.4 PendingChange, local form). */
export interface Proposal {
  id: string;
  conversationId: string;
  toolCallId: string;
  commandId: string;
  input: unknown;
  /** Dry-run output (`edit`); `null` for `destructive`, which is never dry-run by the AI. */
  preview: unknown;
  status: ProposalStatus;
  createdAt: string;
  idempotencyKey: string;
  /** Destructive: Apply needs a typed-confirmation token. */
  requiresTypedConfirmation?: boolean;
  result?: ToolResultEnvelope;
}
