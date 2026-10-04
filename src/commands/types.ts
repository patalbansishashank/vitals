/**
 * Command API contracts (SUITE_SPEC §1.2–§1.7). Tier H.
 */
import type { CollectionId, DeviceId, Id, Instant, LocalDate, Tx } from '@/store';
import type { Static, TSchema } from './schema';

export type CommandDomain =
  | 'app'
  | 'nav'
  | 'job'
  | 'history'
  | 'profile'
  | 'intake'
  | 'safety'
  | 'goals'
  | 'planner'
  | 'scenario'
  | 'sim'
  | 'plan'
  | 'today'
  // `day.get` is in the catalogue (§1.9) although the domain list of §1.2 omits it
  | 'day'
  | 'log'
  | 'bio'
  // batch 03 (SUITE_SPEC §14.6, E28): corrections of device values
  | 'biometrics'
  // E20: blood markers (SUITE_SPEC §13.5.6)
  | 'markers'
  | 'catalogue'
  | 'food'
  // E18 (SUITE_SPEC §13.2): the person's supplements, taking vs on hand
  | 'supplements'
  | 'train'
  | 'coach'
  | 'evidence'
  | 'settings'
  | 'ai'
  | 'sync'
  | 'agents'
  | 'data'
  // batch 02 (SUITE_SPEC §13): kitchen and pantry (E17)
  | 'kitchen'
  | 'pantry';
export type CommandId = `${CommandDomain}.${string}`;
export type Perm = 'read' | 'write' | 'destructive';
export type Impact = 'low' | 'consequential';
export type Surface = 'ui' | 'ai' | 'webmcp' | 'mcp';
export const SURFACES: readonly Surface[] = ['ui', 'ai', 'webmcp', 'mcp'];
export type SideEffect = 'docs' | 'engine' | 'planner' | 'network' | 'file' | 'device' | 'ui';

export type ActorKind = 'user' | 'ai' | 'webmcp' | 'mcp' | 'companion' | 'system';
export interface Actor {
  kind: ActorKind;
  /** 'local-user', provider preset id, MCP client name, … */
  id: string;
  conversationId?: Id;
  toolCallId?: string;
  /** Set when the user applies a pending change proposed by `ai`/`mcp`. */
  onBehalfOf?: Actor;
}
export const LOCAL_USER: Actor = Object.freeze({ kind: 'user', id: 'local-user' });
export const SYSTEM_ACTOR: Actor = Object.freeze({ kind: 'system', id: 'system' });

export function surfaceOf(actor: Actor): Surface | null {
  switch (actor.kind) {
    case 'user':
      return 'ui';
    case 'ai':
      return 'ai';
    case 'webmcp':
      return 'webmcp';
    case 'mcp':
    case 'companion':
      return 'mcp';
    case 'system':
      return null;
  }
}

export type UndoStrategy =
  | { kind: 'none' }
  | { kind: 'inversePatch' }
  | { kind: 'retract' }
  | { kind: 'tombstone' }
  | { kind: 'compensating'; command: CommandId; windowMs: number; precondition?: PreconditionId };

/** Precondition ids (evaluated before execute; `./gates.ts`). */
export type PreconditionId = 'noWeightEditDuringPlan' | 'noActivePlan' | 'activePlan' | 'scenarioExists' | 'storageAvailable' | /* E20: markers */ 'markerReask';
/** Safety gates (the same functions the UI applies; `./gates.ts`). */
export type SafetyGateId = 'screeningReady' | 'simulatorAccess' | 'plannerAccess' | 'tightenOnly';

export interface Notice {
  level: 'info' | 'caution' | 'danger';
  text: string;
  rule?: string;
  link?: { route: string; params?: Record<string, string> };
}

export interface JobRef {
  jobId: Id;
  kind: 'sim' | 'planner' | 'replan' | 'whatIf' | 'import' | 'rescore' | 'assimilate';
  startedAt: Instant;
}
export interface JobStatus {
  jobId: Id;
  state: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  progress: number;
  stage?: string;
  etaMs?: number;
  partial?: unknown;
  resultRef?: string;
  error?: CommandError;
}
export interface JobHandle {
  readonly jobId: Id;
  readonly signal: AbortSignal;
  progress(p: number, stage?: string, partial?: unknown): void;
  /** Projection writes from inside a job run in a `derive` scope. */
  write<R>(fn: () => R): R;
}
export interface JobRunner {
  start<T>(kind: JobRef['kind'], run: (job: JobHandle) => Promise<T>, options?: { onCancel?: () => void; id?: Id }): JobRef;
  status(jobId: Id): JobStatus | null;
  result(jobId: Id): unknown;
  cancel(jobId: Id): boolean;
  /** Resolves when the job settles (done, failed or cancelled). */
  wait(jobId: Id): Promise<JobStatus>;
  list(): JobStatus[];
}

export interface CommandError {
  code:
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
  message: string;
  detail?: {
    path?: string;
    precondition?: PreconditionId | 'implemented';
    gate?: SafetyGateId;
    rule?: string;
    retryable?: boolean;
    allowedAlternatives?: string[];
    /** Package that will implement a stub command. */
    owner?: string;
    /** Machine-readable reason (SUITE_SPEC §14.6: `device_owned` when a device records the stream). */
    reason?: string;
    /** The device source a `device_owned` refusal names. */
    sourceKey?: string;
  };
}

export interface ChangeSetSummary {
  id: Id;
  commandId: CommandId;
  label: string;
  at: Instant;
  actor: Actor;
  docs: Array<{ col: CollectionId; id: string; op: 'put' | 'patch' | 'append' | 'remove' }>;
  coalesceKey?: string;
  undoneBy?: Id;
  undoes?: Id;
}
export interface PendingChangeRef {
  pendingId: Id;
  commandId: CommandId;
  expiresAt: Instant;
}

export type CommandResult<O = unknown> =
  | { ok: true; output: O; changeSet: ChangeSetSummary | null; notices: Notice[] }
  | { ok: true; job: JobRef; notices: Notice[] }
  /** `redirected`: the bus staged another command in place of the one dispatched (SUITE_SPEC §14.6: an entry by an agent
   * for a stream a device owns becomes a `biometrics.correct` proposal; `pending.pendingId` is the proposal id). */
  | { ok: true; pending: PendingChangeRef; notices: Notice[]; redirected?: CommandId; redirectedInput?: unknown }
  | { ok: false; error: CommandError };

export interface ConfirmationToken {
  commandId: CommandId;
  inputDigest: string;
  nonce: string;
  issuedAt: Instant;
  mac: string;
}

export interface DispatchOptions {
  actor?: Actor;
  /** ≤ 64 chars; AI actors MUST pass `${conversationId}:${toolCallId}`. */
  idempotencyKey?: string;
  confirmation?: ConfirmationToken;
  /** Gesture coalescing (paint strokes, slider drags) into one ChangeSet. */
  coalesceKey?: string;
  /** Compute the ChangeSet, do not commit (pending changes, previews). */
  dryRun?: boolean;
  correlationId?: string;
  signal?: AbortSignal;
}

/** Ports the app injects (browser: workers; Node: in-process). Executors reach IO only through these. */
export interface CommandPorts {
  /** Route changes (`nav.open`). */
  navigate?: (route: string, params?: Record<string, string>) => boolean;
  /** Planner runs (installed by the Planner feature: request builder + worker pool). */
  planner?: PlannerPort;
  /** File download for `data.export` (browser). */
  download?: (fileName: string, text: string) => number;
  /** Reload after erase (browser). */
  reload?: () => void;
}
export interface PlannerPort {
  /** The request the Planner screen would run now, with its hash (null when the goal set cannot run). */
  prepare(): { request: unknown; hash: string } | null;
  run(request: unknown, options: { signal: AbortSignal; onProgress: (p: unknown) => void }): Promise<unknown>;
  /** Hard stop (terminates the workers). */
  cancel(): void;
}

export interface CommandContext {
  actor: Actor;
  device: DeviceId;
  now: Instant;
  today: LocalDate;
  tz: string;
  commandId: CommandId;
  changeSetId: Id | null;
  /** The gesture key this dispatch coalesces under (schedule history steps follow it). */
  coalesceKey?: string;
  dryRun: boolean;
  newId(): Id;
  /** Buffered document transaction, committed with this command's ChangeSet. */
  docs: Tx;
  jobs: JobRunner;
  ports: CommandPorts;
  signal: AbortSignal;
  notice(n: Notice): void;
  /** Re-enter this command's write scope (projection writes after an await). */
  write<R>(fn: () => R): R;
}

export interface CommandDef<I extends TSchema = TSchema, O extends TSchema = TSchema> {
  id: CommandId;
  /** Bump on any breaking input/output change (the tool manifest hash includes it). */
  version: number;
  /** ≤ 60 chars, user-facing (change cards, history). */
  title: string;
  /** Model-facing, ≤ 600 chars, plain language, units and side effects. */
  description: string;
  input: I;
  output: O;
  perm: Perm;
  /** Required when perm === 'write'. */
  impact?: Impact;
  surfaces: readonly Surface[];
  /** Required for every surface not listed. */
  excludedReason?: Partial<Record<Surface, string>>;
  undo: UndoStrategy;
  idempotency: 'natural' | 'key' | 'none';
  longRunning?: { kind: 'job'; softTimeoutMs: number };
  sideEffects: readonly SideEffect[];
  preconditions?: readonly PreconditionId[];
  safety?: readonly SafetyGateId[];
  aiLimit?: { perTurn: number };
  /**
   * Lane name: writes of one lane run one at a time, each after the previous one's dispatch resolved (its documents
   * written). For executors that read the store rather than their own transaction (a double submit must see the first).
   */
  serial?: string;
  /** Default coalescing key for gesture-like UI edits (consecutive edits of the same field). */
  coalesce?(input: Static<I>, actor: Actor): string | undefined;
  toModel?(out: Static<O>): unknown;
  /** Stub marker: the package that will implement it. Executes as `precondition_failed`. */
  notImplemented?: { owner: string };
  execute(ctx: CommandContext, input: Static<I>): Static<O> | JobRef | Promise<Static<O> | JobRef>;
}

/** Id → definition map, augmented by every `defs/<domain>.ts` (typed dispatch). */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface CommandMap {}
export type KnownCommandId = keyof CommandMap & CommandId;
export type InputOf<K extends KnownCommandId> = CommandMap[K] extends CommandDef<infer I, TSchema> ? Static<I> : never;
export type OutputOf<K extends KnownCommandId> = CommandMap[K] extends CommandDef<TSchema, infer O> ? Static<O> : never;

/**
 * One tool, as the manifest generator (`./manifest.ts`) produces it: every field of the agent contract's
 * `ToolManifestEntry` (`vitals.tools/1`, `packages/companion/src/toolManifest.ts`) plus E4's own `commandId`, `group`
 * and `notImplemented`. `manifestEntryOf(descriptor)` drops the extras.
 */
export interface ToolDescriptor {
  /** Command id (the contract's name for `commandId`). */
  id: CommandId;
  /** `log_meal_from_photo` */
  name: string;
  /** The command domain (the contract's name for `group`). */
  namespace: string;
  commandId: CommandId;
  version: number;
  title: string;
  description: string;
  /** Input schema without `idempotencyKey` (adapters inject it). */
  inputSchema: unknown;
  outputSchema: unknown;
  /** `idempotentHint` is true for reads and `natural` commands (replaying a keyed write with a new key adds again). */
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: false };
  perm: Perm;
  /** Set for writes only (`low` when the definition omits it). */
  impact?: Impact;
  /** SUITE_SPEC §1.4 class from perm / impact (`confirmClassOf`). */
  confirm: 'read' | 'log' | 'edit' | 'destructive';
  surfaces: Surface[];
  idempotency: 'natural' | 'key' | 'none';
  group: CommandDomain;
  notImplemented?: string;
}

export type BusEvent =
  /** A write command ran (`changeSet` null when it changed nothing). Reads never emit this. */
  | { type: 'committed'; commandId: CommandId; changeSet: ChangeSetSummary | null; actor: Actor }
  /** A read command (perm `read`) ran; nothing was written. */
  | { type: 'read'; commandId: CommandId; actor: Actor }
  | { type: 'undone'; changeSetId: Id; by: Id }
  | { type: 'pending'; pending: PendingChangeRef }
  | { type: 'job'; status: JobStatus }
  | CommitFailedEvent;

/** A ChangeSet the document store refused to write (quota, an IndexedDB error), with the rollback outcome. */
export interface CommitFailedEvent {
  type: 'commitFailed';
  commandId: CommandId;
  error: string;
  changeSetId: Id;
  label: string;
  /** The documents were not written and the screens went back to the "before" values. */
  rolledBack: boolean;
  /** Plain-language line for the screen (rolled-back changes only). */
  notice?: string;
  /** Fields left as they are because something changed them since (`col/id.field`). */
  skipped: string[];
}

/** What the person is told when a change could not be saved and was undone. */
export const SAVE_FAILED_NOTICE = 'Couldn’t save that change; it was undone.';
