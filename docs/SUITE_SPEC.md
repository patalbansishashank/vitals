# Vitals Suite Specification (v0.2 release, normative)

**Status:** normative for every package of release v0.2 ("01 · after launch") outside `src/engine/model`, `src/engine/body`
and the planner search (those stay under `docs/MODEL_SPEC.md` and `docs/PLANNER_V2_SPEC.md`). Package A1 of
`plan/01-after-launch/IMPLEMENTATION.md`. Written 2026-10-01 against the v0.1.0 tree.
**Covers PLAN items:** 6, 9, 10, 13, 16, 18, 19, 20 fully; 11, 12, 14 (catalogue schemas); 15 (Companion/MCP boundary).
**Normative words:** MUST / MUST NOT / SHOULD / MAY. Choices that remain provisional after the research are listed in
§11 with what settles them; engineers build the interface as written and keep each such constant or choice behind a single
named export, so a later decision changes one line, not a design.
**Research incorporated:** `research-chatgpt-signin-and-mcp.md`, `research-wearables.md`, and the R-files that landed by
19:20: R1, R3 (+ seed), R4 (+ supplement seed), R5, R7, R8, R9, R10, R11; `docs/PLANNER_V2_SPEC.md` (A2) is normative for
the planner side of every interface shared here (§3.6, §8.4). R7's engine choice is gated by a two-week spike, so the
store is specified behind an engine-neutral interface (§2).
**Later batches:** §13 Batch 02 contracts (plan 02) · §14 Batch 03 contracts (plan 03, v0.4.0) · §15 One app everywhere (plan 04, v0.5.0).

---

## 0. Conventions and package map

### 0.1 Scalars
```ts
type LocalDate = string;   // 'YYYY-MM-DD', calendar date in the user's current IANA time zone (engine day = 00:00–24:00 local)
type Instant   = string;   // ISO-8601 UTC with 'Z', millisecond precision
type ClockH    = number;   // 0..24 local clock hour, fractional allowed (engine convention, MODEL_SPEC §0.1)
type Id        = string;   // ULID (26 chars, Crockford base32, time-sortable), minted only by CommandContext.newId()
type DeviceId  = string;   // 16 chars base32, random, minted once per browser profile / Companion install
type Rev       = string;   // opaque document revision from the store engine (§2.2); compared only for equality
```
- Units are the engine's (kg, cm, kcal, g, mg, h, min); imperial and kJ are display-only (unchanged from v0.1).
- Every persisted document carries `_schema` (integer) and is migrated forward on read by its collection's migrator.
- User-facing strings produced by any package in this spec obey PLAN item 5 (no dossier numbers, `§`, ruling or WP ids).

### 0.2 Purity tiers (enforced by ESLint, §9.3)
| Tier | Rule | Packages |
|---|---|---|
| **P** pure | no DOM, no React, no IO, no clock (`Date.now`, `new Date()` without argument, `performance.now`), no `Math.random`, no globals; deterministic | `src/engine/**` (incl. new `src/engine/living/`), `src/catalogue/**`, `src/biometrics/core/**`, `src/ai/briefing/**`, `src/commands/schema/**` |
| **H** headless | no DOM, no React, no `@/features|@/app|@/components`; IO only through injected ports; runs in browser main thread, workers, service worker and Node 22 | `src/commands/**` (except `schema`), `src/sync/**`, `src/ai/**` (except `briefing`, `ui`), `src/biometrics/{importers,ble,ingest}/**`, `src/state/docstore/core/**`, `packages/companion/**` |
| **UI** | React allowed | `src/features/**`, `src/app/**`, `src/components/**`, `src/state/*.ts` hooks, `src/ai/ui/**` |

### 0.3 New and changed packages
```
src/net/net.ts           the only module allowed to call fetch/WebSocket; per-target allowlist (R7 §6) (E4)
src/commands/            registry, dispatcher, definitions per domain, tool adapters (E4; tools adapters E9/E12)
  schema/                TypeBox schemas shared by commands, tools, MCP (tier P)
  defs/<domain>.ts       one file per domain of §1.9
  adapters/{openai,anthropic,mcp,webmcp}.ts
src/state/               same hooks as v0.1; Zustand stores become projections of the doc store (E4)
  docstore/              DocStore interface (core/, tier H), reference IndexedDB implementation (idb/), migration
  internal/              store action functions, importable only by src/commands (lint)
src/sync/                SyncAdapter interface, Evolu adapter (fallback PouchDB), blob client, key schedule, pairing (interface E4, engines E11)
src/engine/living/       plan anchoring, realised schedule, assimilation, adherence, drift (pure; E5)
src/catalogue/           exercise, equipment, food, supplement catalogues, stimulus mapping, equivalence (E8)
src/biometrics/          core/ (schema, merge, scores, estimators, BLE protocols; tier P), importers/, ble/, ingest/ (E10)
src/ai/                  providers/, loop/, briefing/ (tier P), multimodal/, ui/ (Coach tab components) (E9)
src/features/{today,food,train,coach,progress}/   Living-mode screens (E13; Coach screen E9)
packages/companion/      Node package `vitals-companion` (+ bin `vitals-mcp`) (E12)
```

---

## 1. Command API (`src/commands/`)

### 1.1 Invariant
1. Every mutation of user data MUST go through `CommandBus.dispatch`. This holds for the UI, the Coach (AI tools),
   WebMCP, the MCP server and the Companion. The only other writers are the sync engine (merging remote documents), the
   one-time migration and derived-cache recomputation; each holds its own `WriteToken` kind (§2.4).
2. AI tools, WebMCP tools and MCP tools are *generated* from the registry (§1.8). No hand-written tool exists.
3. The UI MAY read through store hooks and doc queries (rendering performance); AI, WebMCP and MCP read only through
   read commands.
4. Store action functions move to `src/state/internal/` and are importable only from `src/commands/**` (lint, §9.3).
   `DocStore.transact` throws `WriteOutsideCommand` in dev and test, and rejects plus logs in production, when called
   without a valid token.
5. Safety gates (screening, fasting tiers, planner locks, warnings) are enforced inside command executors and
   preconditions, never in prompts or UI only. A command that bypasses a gate the UI applies is a defect.

### 1.2 Definition
```ts
import type { TSchema, Static } from '@sinclair/typebox';   // or its successor 'typebox'; only Value.* APIs (no TypeCompiler: it uses new Function, blocked by CSP)

type CommandDomain = 'app'|'nav'|'job'|'history'|'profile'|'intake'|'safety'|'goals'|'planner'|'scenario'|'sim'|'plan'|'today'
  |'log'|'bio'|'catalogue'|'food'|'train'|'coach'|'evidence'|'settings'|'ai'|'sync'|'agents'|'data';
type CommandId = `${CommandDomain}.${string}`;              // lowerCamel verb: 'log.meal', 'plan.start'
type Perm = 'read' | 'write' | 'destructive';
type Impact = 'low' | 'consequential';                      // writes only; see §1.4
type Surface = 'ui' | 'ai' | 'webmcp' | 'mcp';

interface CommandDef<I extends TSchema, O extends TSchema> {
  id: CommandId;
  version: number;                       // bump on any breaking input/output change; tool manifest hash includes it
  title: string;                         // ≤ 60 chars, user-facing (change cards, history)
  description: string;                   // model-facing, ≤ 600 chars, plain language, states units and side effects
  input: I; output: O;                   // JSON Schema draft 2020-12 via TypeBox; additionalProperties: false everywhere
  perm: Perm;
  impact?: Impact;                       // required when perm === 'write'
  surfaces: readonly Surface[];
  excludedReason?: Partial<Record<Surface, string>>;   // required for every surface not listed (parity test, §1.10)
  undo: UndoStrategy;
  idempotency: 'natural' | 'key' | 'none';
  longRunning?: { kind: 'job'; softTimeoutMs: number };   // returns JobRef when it outlives softTimeoutMs
  sideEffects: readonly ('docs'|'engine'|'planner'|'network'|'file'|'device'|'ui')[];
  preconditions?: readonly PreconditionId[];             // evaluated before execute; failure → 'precondition_failed'
  safety?: readonly SafetyGateId[];                      // gates the executor must pass (same functions the UI uses)
  aiLimit?: { perTurn: number };                         // default 20 for read, 5 for write, 1 for destructive
  toModel?(out: Static<O>): unknown;                     // compact projection for tool results (≤ 4k tokens, paged)
  execute(ctx: CommandContext, input: Static<I>): Promise<Static<O> | JobRef>;
}
```
`defineCommand()` returns the def unchanged and registers it at module load into the single `registry: ReadonlyMap<CommandId, CommandDef>`.
Input and output types used in executors MUST be `Static<typeof Schema>`; the TypeScript interfaces in this document are
the normative shapes those schemas encode (a type test asserts `Static<S>` ≡ the interface for each one named here).

### 1.3 Context, dispatch, results
```ts
type ActorKind = 'user' | 'ai' | 'webmcp' | 'mcp' | 'companion' | 'system';
interface Actor {
  kind: ActorKind;
  id: string;                     // 'local-user', provider preset id, MCP client name, …
  conversationId?: Id; toolCallId?: string;
  onBehalfOf?: Actor;             // set when the user applies a pending change proposed by `ai`/`mcp`
}
interface CommandContext {
  actor: Actor; device: DeviceId; now: Instant; today: LocalDate; tz: string;
  newId(): Id;
  docs: Tx;                               // §2.4; bound to this command's ChangeSet
  engine: EngineGateway;                  // §9.2; worker in the browser, in-process in Node
  catalogue: CatalogueGateway;            // §8
  jobs: JobRunner;
  signal: AbortSignal;
  notice(n: Notice): void;                // warnings shown with the result (safety, staleness)
}
interface DispatchOptions {
  actor: Actor;
  idempotencyKey?: string;                // ≤ 64 chars; AI actors MUST pass `${conversationId}:${toolCallId}`
  confirmation?: ConfirmationToken;       // destructive commands (§1.4)
  coalesceKey?: string;                   // gesture coalescing (paint strokes, slider drags) into one ChangeSet
  dryRun?: boolean;                       // compute the ChangeSet, do not commit (pending changes, previews)
  correlationId?: string; signal?: AbortSignal;
}
type CommandResult<O> =
  | { ok: true; output: O; changeSet: ChangeSetSummary | null; notices: Notice[] }
  | { ok: true; job: JobRef; notices: Notice[] }
  | { ok: true; pending: PendingChangeRef; notices: Notice[] }            // staged for review (§1.4)
  | { ok: false; error: CommandError };
interface CommandError {
  code: 'invalid_input'|'not_found'|'conflict'|'precondition_failed'|'safety_blocked'|'confirmation_required'
      |'surface_forbidden'|'rate_limited'|'busy'|'cancelled'|'quota_exceeded'|'internal';
  message: string;                        // user-readable, item-5 clean
  detail?: { path?: string; precondition?: PreconditionId; gate?: SafetyGateId; rule?: string; retryable?: boolean;
            allowedAlternatives?: string[] };   // 'safety_blocked': what the model may offer instead (R8 §5.2)
}
interface Notice { level: 'info'|'caution'|'danger'; text: string; rule?: string; link?: RouteRef }
interface CommandBus {
  dispatch<Id extends CommandId>(id: Id, input: InputOf<Id>, opts: DispatchOptions): Promise<CommandResult<OutputOf<Id>>>;
  manifest(surface: Surface): ToolDescriptor[];          // §1.8
  on(listener: (e: BusEvent) => void): () => void;        // 'committed' | 'undone' | 'pending' | 'job' events
}
```
**Pipeline (in order, all synchronous parts ≤ 2 ms p95 excluding `execute`):** resolve def → surface check (`actor.kind`
→ surface; `user` = `ui`, `ai` = `ai`, `companion` and `mcp` = `mcp`) → schema validation (`Value.Check`, errors as
`invalid_input` with JSON pointer) → rate limit per actor turn → idempotency lookup (§1.6) → confirmation policy (§1.4) →
preconditions → safety gates → open ChangeSet, mint `WriteToken` → `execute` → output validation (dev/test only) →
commit (one store transaction per ChangeSet; optimistic projection update before the commit resolves, rolled back
with a toast on failure) → ledger record → `committed` event → result.

### 1.4 Permission classes and confirmation
| Perm / impact (R8 class) | Examples | `user` (UI) | `ai` (Coach) | `webmcp` / `mcp` |
|---|---|---|---|---|
| `read` (read) | `today.get`, `bio.daily` | run | run; collapsed "looked at …" chip | run |
| `write` / `low` (log) | `log.*`, `goals.edit`, `scenario.edit` | apply; undo toast | apply; inline card with values, source and band; Edit / Undo (R11 §6.3 confidence gating decides auto-commit vs one-tap chip) | apply; card in Settings › Agents activity |
| `write` / `consequential` (edit) | `plan.shift`, `plan.editDay`, `profile.patch`, `plan.replan` | apply; undo toast | **stage** as a proposal (diff + goal-date impact; Apply / Adjust / Discard). Setting "auto-apply small edits" (≤ 3 days shifted, no safety-tier change, load not raised) applies them with Undo; default **off** | **stage**; per-client "may apply directly" (default off) |
| `destructive` (destructive) | `plan.end`, `plan.replace`, `data.eraseAll`, `bio.deleteSource` | only with a `ConfirmationToken` minted by the confirm dialog | never executes; returns `confirmation_required`; the Coach renders the typed-confirmation dialog; never batched | never executes; queued for confirmation in the app |

- Automatic changes (re-plans, score effects) may only lower load; raising load, adding a fast or moving up a rung is
  always a proposal (R11 §4.3, PLANNER_V2 §7.4).
- **AI may tighten, never loosen.** Commands that relax a safety boundary (screening answers, fasting opt-ins,
  acknowledgements, stream policies, sync, keys, agent permissions) are UI-only (`excludedReason.ai` = "requires the
  person's own consent"). Commands that only tighten (`safety.reportIllness`, lowering a planner limit) MAY be AI-callable.
- `ConfirmationToken = { commandId; inputDigest: string; nonce: string; issuedAt: Instant; mac: string }`, HMAC with a
  per-session in-memory key, valid 60 s, single use. `mintConfirmation()` lives in `src/app/confirm/` and MUST NOT be
  importable from `src/ai`, `src/commands/adapters` or `packages/companion` (lint).
- Pending change (collection `pendingChanges`, synced so a proposal made on one device can be approved on another;
  expires 24 h):
```ts
interface PendingChange {
  _id: Id; commandId: CommandId; input: unknown; actor: Actor; createdAt: Instant; expiresAt: Instant;
  preview: ChangeCard;                          // from a dryRun dispatch (§5.5)
  baseRevs: Record<string /* `${col}/${id}` */, Rev>;
  status: 'pending' | 'applied' | 'discarded' | 'expired' | 'stale';
}
```
  Apply re-dispatches with `actor = { kind: 'user', id: 'local-user', onBehalfOf: original }`; if any `baseRevs` entry
  changed, it re-runs the dry run, marks `stale` and shows the refreshed preview instead of applying.

### 1.5 Undo
```ts
type UndoStrategy =
  | { kind: 'none' }                                              // reads, sync, exports, device IO
  | { kind: 'inversePatch' }                                      // default for LWW documents: apply stored inverse RFC 6902 patches
  | { kind: 'retract' }                                           // append-only collections: append a retract entry (§2.5)
  | { kind: 'tombstone' }                                         // soft delete, restorable for 30 days
  | { kind: 'compensating'; command: CommandId; windowMs: number; precondition?: PreconditionId };
interface ChangeSet {                                             // collection 'changeLog', local-only, kept 30 days
  _id: Id; commandId: CommandId; actor: Actor; at: Instant; label: string; coalesceKey?: string;
  ops: Array<{ col: CollectionId; id: string; op: 'put'|'patch'|'append'|'remove';
               beforeRev: Rev | null; afterRev: Rev; inverse: JsonPatchOp[] | null }>;
  undoneBy?: Id; undoes?: Id;
}
```
- `history.undo {changeSetId}` undoes when every touched document's current `_rev` equals `afterRev`; otherwise it
  applies the inverse field by field only for fields whose value still equals the ChangeSet's "after" value and reports
  what it skipped.
- Gesture coalescing: consecutive dispatches with the same `coalesceKey` within 1.5 s merge into one ChangeSet until
  `history.seal {coalesceKey}` (pointer-up, blur). This replaces the scenario store's in-memory history; `scenario.undo`
  / `scenario.redo` walk the scenario's ChangeSets (50 steps) so v0.1 undo/redo behaviour is unchanged.
- UI MAY keep an ephemeral draft during a drag (60 fps) and MUST dispatch at least every 250 ms and on release.

### 1.6 Idempotency
- `natural`: set-semantics commands (`profile.patch`, `settings.update`, `goals.edit` with absolute ops) — replaying
  yields the same state. `key`: creates or appends (`log.*`, `scenario.create`, `plan.start`) — the dispatcher stores
  `(commandId, idempotencyKey) → result` in local `commandLedger` for 24 h and returns the stored result on replay.
  `none`: reads and device IO.
- AI adapters MUST derive keys from `(conversationId, toolCallId)`; MCP from `(clientName, requestId)`; UI from a
  per-click nonce. A `key` command dispatched by `ai`/`mcp`/`webmcp` without a key is `invalid_input`.
- Sync never replays commands; it merges documents (§2.6). Commands are a local concept.

### 1.7 Jobs
```ts
interface JobRef { jobId: Id; kind: 'sim'|'planner'|'replan'|'whatIf'|'import'|'rescore'|'assimilate'; startedAt: Instant }
interface JobStatus { jobId: Id; state: 'queued'|'running'|'done'|'failed'|'cancelled'; progress: number /*0..1*/;
                      stage?: string; etaMs?: number; partial?: unknown; resultRef?: string; error?: CommandError }
```
`job.status`, `job.result`, `job.cancel` are commands. AI adapters wait up to `softTimeoutMs` (default 25 s) for a job,
then return `{ status: 'running', jobId }`; the model polls `job.status`. Planner "exhaustive" jobs persist resumable
state in local `jobs` (E6 defines the payload).

### 1.8 Tool generation
- Tool name = command id with `.` → `_` and camelCase → snake_case (`log.mealFromPhoto` → `log_meal_from_photo`; R8's
  prefix style), ≤ 64 chars, `[a-z0-9_]`.
  Description = `def.description` (≤ ~80 words: when to use, units, one example; shared rules live in the briefing).
  Input schema = `def.input` without `idempotencyKey` (the adapter injects it). Schemas use no `$ref`, ISO dates, enums
  for units, `additionalProperties:false`.
- Adapters (pure functions over the registry, one file each):
  - `toOpenAIChatTools` (`/chat/completions`, every OpenAI-compatible server) and `toOpenAIResponsesTools` (OpenAI direct
    and Sign in with ChatGPT; with `namespace:'vitals'` wrapping, which plan usage requires). Strict projection: every
    property required, optional `T` → `T | null`, unsupported keywords stripped; the dispatcher re-validates the
    original schema.
  - `toAnthropicTools` (`{name, description, input_schema}`), `toWebMcpTools` (`registerTool({…, annotations:{readOnlyHint,
    destructiveHint}, execute})`), `toMcpTools` (`annotations: {readOnlyHint, destructiveHint, idempotentHint, openWorldHint:false}`).
- **Tool result envelope** (all adapters): `{ ok: boolean; status: 'applied'|'pending_user'|'rejected'|'running'; changeId?;
  jobId?; summary: string /* ≤ 2 lines, human words */; data?: unknown /* toModel(), ≤ 4k tokens, paged with nextCursor */;
  error?: CommandError }`. `pending_user` tells the model to stop and wait; the next turn carries a system note
  "proposal P applied/discarded".
- **Groups.** Every `ai`-surface command is a tool (parity), but the Coach sends by default only the **core group**
  (≈ 28 tools, ≤ 6k tokens, inside the cached prefix): `app_status`, `nav_open`, `history_undo`, `job_status`,
  `profile_get`, `profile_patch`, `intake_answer`, `today_get`, `log_get`, `log_meal`, `log_meal_from_photo`, `log_session`,
  `log_fast`, `log_measurement`, `log_mark_day`, `log_bulk`, `plan_get`, `plan_declare_event`, `plan_shift`, `plan_replan`,
  `plan_drift`, `sim_what_if`, `sim_series`, `bio_daily`, `catalogue_search_exercises`, `catalogue_search_foods`,
  `food_plan_day`, `evidence_search`, plus the meta-tool `app_load_tools {groups: CommandDomain[]}` that adds a domain's
  tools for the rest of the conversation segment. Small/local models ("basic" tier, R8 §3.6) get only `read` tools and
  `log_*`. `TOOLSET_HASH` = SHA-256 of the canonical manifest JSON, shown in Settings › Agents, snapshot-tested.

### 1.9 Command catalogue (v0.2)
Legend: R/W/D = perm; `·c` = consequential; Undo: IP inversePatch, RT retract, TS tombstone, CP compensating, — none;
Idem: N natural, K key, — none; Surfaces: all = ui ai webmcp mcp; "UI" = ui only (reason in the def).

| Command(s) | Perm | Input → output (types in this spec) | Undo | Idem | Surfaces |
|---|---|---|---|---|---|
| `app.status` | R | `{}` → `AppStatus` (mode, today, active plan summary, sync, provider, counts) | — | — | all |
| `nav.open` | R | `{route: RouteId, params?}` → `{opened}` | — | — | ui ai webmcp |
| `job.status` · `job.result` · `job.cancel` | R·R·W | `{jobId}` → `JobStatus` / result / `{cancelled}` | — | N | all |
| `history.list` · `history.undo` · `history.seal` | R·W·W | → `ChangeSetSummary[]` / `{undone, skipped[]}` | — | N | all (`undo` by ai/mcp only for its own ChangeSets) |
| `profile.get` · `profile.explainMaintenance` | R | → `ProfileView` / `MaintenanceExplanation` (item 1: what drove the estimate) | — | — | all |
| `profile.patch` | W·c | `ProfilePatch` → `ProfileView`; precondition `noWeightEditDuringPlan` unless `asStartingPoint:true` (UI dialog) | IP | N | all |
| `profile.resetShape` | W·c | `{}` → `ProfileView` | IP | N | all |
| `intake.get` · `intake.nextQuestions` | R | `{section?}` → `IntakeView` / `IntakeQuestion[]` (conversational onboarding) | — | — | all |
| `intake.answer` · `intake.skip` | W | `{section, answers}` → `IntakeView` | IP | N | all |
| `safety.status` | R | → `SafetyStatus` (mode, restrictions, effective fasting tier, locks as labels; never raw answers) | — | — | all |
| `safety.commitScreening` · `safety.acknowledge` · `safety.setFastingOptIn` · `safety.clearFastingOptIn` · `safety.acknowledgeDanger` | W·c | as safetyStore v1 | IP | N | UI |
| `safety.reportIllness` | W | `{at?}` → `SafetyStatus` (tightens) | IP | N | all |
| `goals.get` · `goals.edit` | R·W | → `GoalSet` / `{ops: GoalOp[]}` → `GoalSet` | IP | N | all |
| `planner.find` | W (job) | `{tier:'S'|'M'|'L'|'X', overrides?: Partial<PlannerRequestOverrides>}` → `JobRef` → `PlannerRunSummary` (ladder per PLANNER_V2_SPEC) | — | K | all |
| `planner.stop` · `planner.result` | W·R | → `{stopped}` / `{kind?: PlanKind}` → `PlannerRunSummary` / `RungPlanView` (incl. limit costs, shopping list) | — | N | all |
| `planner.openInSimulator` | W | `{kind: PlanKind}` → `{scenarioId}` | TS | K | all |
| `scenario.list` · `scenario.get` | R | `{id, days?: [from,to]}` → `ScenarioView` | — | — | all |
| `scenario.create` · `scenario.duplicate` | W | `{name?, starter?, fromScenarioId?, schedule?}` → `{scenarioId}` | TS | K | all |
| `scenario.rename` · `scenario.setActive` | W | → `ScenarioView` | IP | N | all |
| `scenario.delete` | W | `{id}` → `{deleted}` | TS | N | all |
| `scenario.edit` | W | `{id, ops: ScheduleOp[], label?}` → `{scenarioId, rev, summary}` | IP | K | all |
| `scenario.undo` · `scenario.redo` | W | `{id}` → `{rev}` | — | — | ui ai |
| `sim.run` | R (job) | `{scenarioId} | {planId}` + `{draws?: 0|16|32}` → `SimSummary` (goal metrics, warnings, end values) | — | N | all |
| `sim.series` | R | `{source, series: SeriesId[], from?, to?, resolution:'day'|'week'}` → `SeriesTable` | — | — | all |
| `sim.whatIf` · `sim.compare` | R (job) | `{base, variants: ScheduleOp[][]}` → `WhatIfResult` (goal deltas, ETA, new warnings); nothing persisted | — | N | all |
| `sim.explain` | R | `{source, metric, day?}` → `Breakdown` ("why did the scale move") | — | — | all |
| `plan.get` · `plan.versions` · `plan.drift` · `plan.adherence` | R | → `PlanView` / `PlanVersionSummary[]` / `DriftReport` / `AdherenceSeries` | — | — | all |
| `plan.start` · `plan.discard` | W·c | `PlanStartInput` (§3.2) → `{planId, version, anchorNotes}`; precondition `noActivePlan` / `{planId}` → `{discarded}` (≤ 24 h, no logs) | CP | K | all |
| `plan.pause` · `plan.resume` | W·c | `{from?, until?, reason?}` → `PlanView` | CP | N | all |
| `plan.end` · `plan.replace` | D | `{reason, note?}` / `PlanStartInput & {reason:'replaced'}` → `PlanView` | CP restore 7 d | K | all (confirmation) |
| `plan.declareEvent` | W·c | `{kind:'noTraining'|'illness'|'travel'|'socialMeal'|'busy', from, to, note?}` → `VersionProposal` (maps to `plan.shift` / modifiers, §3.6) | IP | K | all |
| `plan.checkIn` | W | `{}` → `CheckInReport` (anchor move, drift verdict, weekly re-plan proposal; runs automatically on the check-in day) | CP | N | ui ai |
| `plan.shift` | W·c | `PlanShiftInput` (§3.6) → `VersionProposal` (+ impact) | IP | K | all |
| `plan.editDay` | W·c | `{date, patch: DayTemplatePatch, scope:'day'|'weekday'|'rest'}` → `VersionProposal` | IP | K | all |
| `plan.replan` | W·c (job) | `{reason?, tier?}` → `VersionProposal` | IP | K | all |
| `plan.adoptVersion` · `plan.rejectVersion` | W·c·W | `{planId, version}` → `PlanView` | CP | N | all |
| `plan.swapExercise` | W | `{date, slotKey, from, to: ExerciseRef | PerformedExercise}` → `{equivalence: EquivalenceResult}` | IP | K | all |
| `today.get` · `day.get` | R | `{date?}` → `TodayView` / `DayRecord` | — | — | all |
| `log.meal` | W | `LogMealInput` (§3.4: components with grams; nutrients only from labels or the user) → `LogResult` (app-computed nutrients with bands) | RT | K | all |
| `log.mealFromPhoto` | W | `{attachmentId, text?, slot?, clockH?}` → `LogResult` (vision extraction → components → app-computed nutrients, §5.6) | RT | K | all |
| `log.bulk` | W·c | `{days: Array<{date, entries: LogEntryInput[]}>}` (≤ 14 days) → `LogResult[]` | RT | K | all |
| `log.session` | W | `LogSessionInput` → `LogResult & {equivalence}` | RT | K | all |
| `log.fast` | W | `{action:'start'|'end'|'broken'|'record', lastIntakeAt?, firstIntakeAt?}` → `LogResult` | RT | K | all |
| `log.steps` · `log.sleep` · `log.substance` · `log.supplement` · `log.subjective` · `log.note` | W | entry body (§3.4) → `LogResult` | RT | K | all |
| `log.measurement` | W | `{date?, metric, value, unit?, context?, method?}` → `LogResult & {filter: FilterUpdate}` | RT | K | all |
| `log.markDay` · `log.confirmDay` | W | `{date, marks: DayStatusDoc['marks']}` / `{date}` → `DayRecord` | IP | N | all |
| `log.edit` · `log.retract` | W | `{entryId, patch}` / `{entryId}` → `LogResult` | RT | K | all |
| `log.get` | R | `{from, to, kinds?}` → `LogEntryView[]` | — | — | all |
| `log.fromBiometrics` | W | `{date}` → `PendingChangeRef[]` (proposals only) | — | N | all |
| `bio.daily` · `bio.series` · `bio.baselines` · `bio.sources` · `bio.scores` | R | §4.1–§4.5 views (ai reads filtered by stream policy) | — | — | all |
| `bio.manual` | W | `{date, metric, value, at?, note?}` → `{recordId}` (manual provenance; AI screenshot reading) | TS | K | all |
| `bio.setSourcePriority` | W | `{metric, sourceKeys: string[]}` → `BioSourceView[]` | IP | N | all |
| `bio.import` · `bio.deviceConnect` · `bio.deviceSync` | W (job) | file / Web Bluetooth (user gesture required) → `ImportReport` | TS | K | UI |
| `bio.setPolicy` | W·c | `{stream, policy: StreamPolicy}` → `StreamPolicy[]` (consent) | IP | N | UI |
| `bio.deleteSource` | D | `{sourceKey}` → `{deleted}` | — | N | UI |
| `bio.rescore` | W (job) | `{scoreIds?, from?}` → `JobRef` | — | N | ui |
| `catalogue.searchExercises` · `catalogue.getExercise` · `catalogue.searchFoods` · `catalogue.getFood` · `catalogue.supplements` · `catalogue.equipment` | R | §8 | — | — | all |
| `catalogue.addExercise` · `catalogue.addFood` · `catalogue.addEquipment` | W | custom item with stimulus/nutrients → `{id}` | TS | K | all |
| `catalogue.equivalence` | R | `{prescribed: StimulusRef, performed: PerformedExercise[]}` → `EquivalenceResult` | — | — | all |
| `food.dayTargets` · `food.recipes` · `food.groceryList` · `food.parse` | R | `{date}` → `MealTargets[]` / `RecipeView[]` / `GroceryList` / `{text}` → `MealEstimate` (catalogue parser, no AI) | — | — | all |
| `food.candidates` | R | `{date, slot?}` → allowed foods (hard-filtered by diet, allergy, day rules, equipment; ≤ 150, R4 §3.1) | — | — | all |
| `food.planDay` | W | `{date, meals: ProposedMeal[]}` (R4 `propose_day_meals`, food ids + raw grams, no nutrients) → `{fit: PortionFitResult, deltas, repairHints}` and saved meal plan | IP | K | all |
| `food.saveRecipe` · `food.deleteRecipe` | W | `RecipeInput` → `{id}` | TS | K | all |
| `train.session` · `train.alternatives` · `train.shoppingList` | R | `{date}` / `{exerciseId, date?}` / `{planId} | {kind: PlanKind}` → views (`ShoppingItem[]`, PLANNER_V2 §8.5) | — | — | all |
| `coach.conversations` · `coach.history` · `coach.pending` · `coach.searchNotes` | R | → `ConversationView[]` / `MessageView[]` / `PendingChange[]` | — | — | ui ai |
| `coach.applyPending` | W | `{pendingId}` → result of the staged command | as staged | N | UI |
| `coach.discardPending` | W | `{pendingId}` → `{discarded}` | — | N | ui ai |
| `coach.delete` | D | `{conversationId}` → `{deleted}` | — | N | UI |
| `evidence.search` · `evidence.get` | R | `{q}` / `{slug}` → topic summaries with links | — | — | all |
| `settings.get` · `settings.update` | R·W | → `SettingsView` / `{patch: Partial<SyncedSettings & DeviceSettings>}` | IP | N | all (ai: display settings only) |
| `ai.configure` · `ai.usage` | W·R | provider presets, keys (UI only) / token totals | IP | N | UI·all |
| `sync.status` · `sync.now` | R·W | → `SyncStatus` | — | N | all |
| `sync.pair` · `sync.join` · `sync.rotate` · `sync.configure` | W·c | pairing (§2.6) | — | N | UI |
| `sync.unpair` | D | `{}` → `SyncStatus` | — | N | UI |
| `agents.configure` | W·c | WebMCP on/off, per-client direct-apply | IP | N | UI |
| `data.usage` | R | → storage usage per collection, quota estimate | — | — | all |
| `data.export` · `data.import` · `data.eraseAll` | R·D·D | §2.8 | — | — | UI |

Types not spelled out in this table are defined in §3–§8, in PLANNER_V2_SPEC, or are thin view projections whose exact
fields E4 fixes in `src/commands/schema/` under the rule: views contain no typed arrays (series as `number[]`, rounded to
display precision), no secrets and no raw screening answers. Helper names used without expansion in this spec
(`PreconditionId`, `SafetyGateId`, `ChangeSetSummary`, `PendingChangeRef`, `JobRunner`, `CatalogueGateway`, `RouteRef`,
`LogEntrySummary`, `CheckInReport`, `AssimilationInput`/`Result`, `ScoreInput`, `BleLink`, `RingCommand`, `ProtocolState`,
`UiPrefs`) are owned by the package that implements them and MUST be structured-clone-safe plain data.

```ts
// ScheduleOp: the serialisable form of src/features/simulator/lib/ops.ts (each op maps 1:1 onto one ops function)
type DayTemplatePatch = JsonMergePatch<Omit<DayTemplate, 'id'>>;          // RFC 7396 over the engine type
type ScheduleOp =
  | { op: 'paint'; days: number[]; program: number } | { op: 'clear'; days: number[] }
  | { op: 'editDays'; days: number[]; patch: DayTemplatePatch } | { op: 'resetOverrides'; days: number[] }
  | { op: 'shiftDays'; days: number[]; delta: number } | { op: 'applyPattern'; pattern: number[]; fromDay?: number; toDay?: number }
  | { op: 'copyWeek'; fromRow: number; toRows: number[] } | { op: 'repeatWeekToEnd'; row: number }
  | { op: 'insertWeek'; row: number } | { op: 'deleteWeek'; row: number } | { op: 'deloadWeek'; row: number }
  | { op: 'addProgram'; preset?: PresetId; template?: Omit<DayTemplate, 'id'> } | { op: 'updateProgram'; index: number; patch: DayTemplatePatch }
  | { op: 'duplicateProgram'; index: number } | { op: 'deleteProgram'; index: number; replaceWith: number }
  | { op: 'addFast'; fast: Omit<FastEvent, 'kind'> } | { op: 'updateFast'; index: number; patch: Partial<FastEvent> } | { op: 'removeFast'; index: number }
  | { op: 'setBlock'; block: ScheduleBlock } | { op: 'setBlocks'; blocks: ScheduleBlock[] } | { op: 'renameBlock'; index: number; name: string }
  | { op: 'removeBlock'; index: number } | { op: 'setHorizon'; days: number } | { op: 'setStartDate'; date: LocalDate }
  | { op: 'setEnergyReference'; ref: EnergyReference } | { op: 'setAdherence'; patch: Partial<AdherenceLevers> };
type GoalOp =
  | { op: 'add'; goal: Omit<GoalDraft, 'key'> } | { op: 'remove'; key: string } | { op: 'move'; from: number; to: number }
  | { op: 'update'; key: string; patch: Partial<Omit<GoalDraft, 'key'|'metric'>> } | { op: 'setHorizon'; days: number }
  | { op: 'setStartDate'; date: LocalDate | null } | { op: 'setLimits'; patch: Partial<ConstraintDraft> } | { op: 'resetLimits' }
  | { op: 'setStrictness'; value: Strictness };
type ProfilePatch = JsonMergePatch<ProfileDoc> & { asStartingPoint?: boolean };   // weight edits during a plan need the flag
interface MealComponentInput { name: string; localName?: string; foodId?: string; recipeId?: Id;
  grams?: number; gramsLow?: number; gramsHigh?: number; portion?: { unit: string; count: number };
  cookingMethod?: string; visibleFatCue?: 'none'|'some'|'glossy'|'pooled';
  labelPer100g?: Partial<FoodRecord['per100g']> }                              // only transcribed labels or numbers the person typed
interface LogMealInput { date?: LocalDate; clockH?: ClockH; slot?: string; text?: string; components: MealComponentInput[];
  method: EntrySource['method']; confidence?: number; itemId?: string; attachmentIds?: Id[]; complete?: boolean }
interface LogSessionInput { date?: LocalDate; status: 'done'|'partial'|'skipped'; slotKey?: string; startH?: ClockH;
  durationMin?: number; performed: PerformedExercise[]; rpe?: number; bioWorkoutId?: string }
interface LogResult { entryId: Id; card: ChangeCard; totals?: NutrientEstimate; credit?: number | null;
  remaining?: TodayView['remaining']; equivalence?: EquivalenceResult }
```
The UI clipboard (`copyWeek` then `pasteWeeks`) stays a UI convenience that dispatches `copyWeek {fromRow, toRows}`.

### 1.10 Parity test (`src/commands/__tests__/parity.test.ts`, required green for release)
1. **UI census (static).** A test walks `src/features/**` and `src/app/**` with the TypeScript compiler API and collects
   every literal command id passed to `useCommand(id)`, `dispatch(id, …)` and `<CommandButton command=…>`; non-literal ids
   fail the test. Set `U`.
2. **No bypass (static).** No module outside `src/commands/**` imports `@/state/internal/*` or calls `DocStore.transact`
   (ESLint rule, run inside the test too).
3. **No bypass (dynamic).** The RTL screen suites run with `DocStore` in strict mode: any write without a command token
   throws, so an un-migrated control fails its own screen test.
4. **Registry closure.** For registry `R`: `U ⊆ R`; every `def` whose `surfaces` include `ui` appears in `U` or carries
   `excludedReason.ui`; every `def` without `ai` carries `excludedReason.ai`; the reviewed allowlist
   `src/commands/__tests__/ai-excluded.json` equals the set of ai-excluded ids (adding one is a reviewed diff).
5. **Tool closure.** `manifest('ai')`, `manifest('webmcp')`, `manifest('mcp')` each equal `R` filtered by surface; the
   generated OpenAI (strict and namespaced), Anthropic, WebMCP and MCP schemas are produced without error for every
   tool; one fixture input per command (`src/commands/__fixtures__/<id>.json`) validates against the original and the
   strict projection; `TOOLSET_HASH` snapshot.
6. **Behavioural parity.** For every write command with a fixture: dispatching as `user` and through each tool adapter
   (`ai` with a mocked approval for consequential ones) from the same seed state yields byte-identical documents
   (excluding `_rev`, `_device`, timestamps and actor fields).
7. **Docs.** Every `description` passes the item-5 guard (no `dossier`, `§`, `R-[A-Z]`, `WP\d`, `MODEL_SPEC`).

---

## 2. Local-first store and sync interface

### 2.1 Decision (R7)
- Every feature reads and writes one app-facing **`DocStore`** (collections of JSON documents, §2.4). Zustand stores stay
  as in-memory projections so every v0.1 hook (`useBodyEstimate`, `usePersonProfile`, `useScenario`, `useSimulation`, …)
  keeps its signature; their `persist` middleware is replaced by `bindDocs()` (§2.7).
- **Production engine: Evolu** (`@evolu/common` 8.14, `@evolu/web` 3.4, `@evolu/nodejs` 4.1, pinned exactly): SQLite-WASM
  on OPFS in a worker, per-column last-writer-wins by HLC, end-to-end encryption (XChaCha20-Poly1305) built in,
  range-based set reconciliation with a Node relay the Companion embeds. **Gate:** R7's two-week spike and its six pass
  criteria (R7 §7.3). **Fallback:** PouchDB 9 ↔ CouchDB 3.5 with ComDB encryption, behind the same interfaces.
- **Reference store: `IdbDocStore`** (IndexedDB, no sync) is built first by E4. It is the conformance oracle
  (`src/state/docstore/__tests__/conformance.ts`, also run against the Evolu adapter and the Companion's Node store) and the
  production store until the spike passes. Switching implementations runs `copyStore(from, to)` once at boot (marker in
  both stores); nothing else in the app changes.
- **Raw biometric samples and attachments never go through the CRDT.** They are immutable encrypted chunks in a blob
  store (local cache + the endpoint's `/blobs`), with one small manifest row per chunk synced as a document (§2.6, §4.2).

### 2.2 Document envelope
```ts
interface DocMeta {
  _id: string; _col: CollectionId; _schema: number;
  _rev: Rev;                       // opaque engine revision (Evolu: max column timestamp; IDB: HLC; Pouch: _rev); equality-comparable
  _device: DeviceId; _created: Instant; _updated: Instant;
  _deleted?: true;                 // soft delete (engines keep history; compaction is the engine's business)
}
type Doc<T> = DocMeta & T;
```

### 2.3 Collections
Strategies: **LWW-F** per top-level field last-writer-wins (Evolu: one row per document, one column per top-level field,
nested values as JSON text); **APP** insert-only, never updated (edits are new entries, §2.5); **IMM** immutable versions,
id includes the version, readers take the newest; **BLOB** manifest row synced, bytes in the blob store; **DER** derived,
recomputable, never synced; **LOC** local-only. Concurrent edits of different fields both survive; the loser of an
edit to the same field is meant to stay restorable from the engine history (`DocStore.history`, not read back on Evolu
yet), which replaces v0.1's scenario merge rule.

**How LWW-F is implemented (Evolu, phase 1).** Each document is still one row with its body in one encrypted `json`
column, but that column holds `{ v: 2, fields, clocks, deleted, deletedClock }`: the document split into fields, with
the clock of the last change of each field. A field is a top-level key; a collection may declare deeper paths (then each
child key is a field of its own); arrays and plain values are always replaced as a whole. Clocks are the device's HLC
(§0.1 format, so equal times are ordered by device id). A local write gives a new clock only to the fields it adds,
changes or removes (a removed field keeps its clock, so a removal also wins or loses by time), and to the deleted flag
when it flips. When a version written elsewhere arrives, the device merges it with its own copy field by field: the
newer clock wins each field. If the result is not what the database kept, the device writes the result as a new
version, so the other devices receive it; merging is order-independent, so every device ends with the same document.
A row written before this rule has no clocks: on first read every field counts as written at the row's last write
time, and the row is only rewritten when the document next changes. Older app versions cannot read the new rows, so
every device and the home node must run the same version.
Clocks are capped in size (13 digits of milliseconds, `MAX_HLC_MS`): an oversized clock is cut down to the cap when it is
read, and a clock that cannot be read counts as the lowest clock, so it never wins a field. Ruling: a valid clock far in the
future wins until every device has seen it; there is no clamp to wall-clock time. Clamping on receive would make the merge
depend on the time each device happens to read, so devices could stop converging. Devices that have seen the clock move
their own past it, so their later edits win; nothing is lost for good.

| Collection | Key | Document | Strategy | Budget / year |
|---|---|---|---|---|
| `profile` | `me` | `ProfileDoc` = v0.1 `BodyProfileValues` minus `setup`/`*Skipped` (moved to `uiPrefs`) | LWW-F | 10 KB |
| `intake` | `me` | `IntakeDoc` (§2.3.1) | LWW-F | 40 KB |
| `safety` | `me` | v0.1 `SafetyValues` (SCOFF items never stored) | LWW-F | 5 KB |
| `goals` | `me` | v0.1 `PlannerValues` (goal set, limit overrides, strictness) | LWW-F | 5 KB |
| `scenarios` | `Id` | v0.1 `Scenario` (`schedule` is one field) | LWW-F | ≤ 60 KB each, cap 50 |
| `plans` | `Id` | `PlanDoc` (§3.2) | LWW-F | 5 KB each |
| `planVersions` | `${planId}:v${n}` | `PlanVersionDoc` (§3.2) | IMM (+ `status` LWW-F) | ≤ 90 KB each |
| `activePlan` | `me` | `{ planId: Id | null; since: Instant }` | LWW-F | — |
| `dailyLogs` | `Id` | `LogEntry` (§3.4), indexed by `date`, `[planId, date]` | APP | ≈ 2 MB |
| `dayStatus` | `day:${LocalDate}` | `DayStatusDoc` (§3.4) | LWW-F | ≈ 0.5 MB |
| `measurements` | `Id` | `MeasurementEntry` (§3.4), indexed by `[metric, date]` | APP | < 0.2 MB |
| `anchors` | `${planId}:${LocalDate}` | `ConfirmedStateRecord` (§3.5) without the snapshot | IMM | < 0.1 MB |
| `bioRecords` | `${record_id}@${version}` | canonical `daily`/`sleep`/`workout`/`spot`/`device_profile` record (§4.1) | IMM | ≈ 1.5 MB |
| `bioChunks` | `chunkId` | `BioChunkManifest` (§4.2) | BLOB | manifest < 1 MB; bytes 0.2–70 MB by device (R9 §5) |
| `bioSources` | `sourceKey` | `BioSourceDoc` (label, tier, priority, `StreamPolicy[]`, baseline epochs) | LWW-F | — |
| `bioScores` | `${scoreId}@${version}|${scope}` | `ScoreResult` (§4.4) | DER (rebuilt on any device) | ≈ 1 MB |
| `decisionLog` | `Id` | `{ at, scoreId?, version?, value?, band?, decision, planVersion?, conversationId? }` (R9 §4.2) | APP | < 0.5 MB |
| `conversations` · `messages` | `Id` | §5.4 (`messages` indexed by `[conversationId, at]`; tool results ≤ 4 KB) | LWW-F · APP | ≈ 15 MB |
| `attachments` | `Id` | `{ mime, w, h, sha256, purpose, linkedIds, chunkId? }`; bytes local (photos ≤ 1024 px WebP), synced only on opt-in | BLOB | photos kept 90 d |
| `catalogueCustom` | `Id` | user/AI-added `ExerciseDef` / `FoodRecord` / `EquipmentDef` / `MappingDef` (§8) | LWW-F | < 1 MB |
| `recipes` · `mealPlans` | `Id` · `${LocalDate}` | `RecipeDoc` · `MealPlanDoc` (§8.3) | LWW-F | < 3 MB |
| `settings` | `me` | `SyncedSettings`: units, energy/glucose unit, date style, week start, home tz, rollover hour, coach and re-plan policies, quiet mode | LWW-F | — |
| `devices` | `DeviceId` | `{ name, platform, appVersion, lastSeen, roles: ('app'|'companion'|'relay')[] }` (each device writes only its own) | LWW-F | — |
| `pendingChanges` | `Id` | `PendingChange` (§1.4); `status` is the only field that changes | LWW-F | 30-day retention |
| `providerKeys` | presetId | API key, only when the user opts in to key sync (inside E2EE; re-wrapped per device, R8 §7) | LWW-F, opt-in | — |
| `deviceSettings` · `uiPrefs` | `me` | theme, motion, chart patterns, figure, provider choice; last route, results lanes/pins, setup step, planning override, dismissed hints | LOC | — |
| `secrets` | presetId, `companion`, `bleCred:${driver}` | AES-GCM ciphertext under a non-extractable device `CryptoKey` (R8 §7) | LOC | — |
| `changeLog` · `commandLedger` · `jobs` · `aiUsage` | `Id` | §1.5 · §1.6 · §1.7 · §5.1 | LOC | 30-day retention (`aiUsage` 400 d) |
| `derived` | `${kind}:${key}` | engine snapshots, assimilation caches, last simulation inputs (v0.1 `vitals.simulations`) | DER | ≤ 20 MB LRU |
| `syncState` | `me` | `SyncStatus` + engine cursors | LOC | — |

Total target excluding raw chunks and photos: ≤ 40 MB per year. `navigator.storage.persist()` is requested when the
first plan starts, the first device stream is enabled or the first key is saved. `QuotaExceededError` maps to
`quota_exceeded` with a "free space" action (drop `derived`, then photos older than 30 days, then local raw chunks that
the endpoint already holds).

#### 2.3.1 Intake document (R1, R3 §7, R4 §1)
```ts
type IntakeSectionId = 'activity'|'training'|'diet'|'kitchen'|'supplements'|'devices';
interface IntakeDoc {
  activity?: ActivityIntake;        // R1 §3.5 verbatim: work class, work days/hours, commute, steps {source, workday, offDay,
                                    // weeklyMean, daysOfHistory}, offDay, onFeetAtHome, recreation[]; resolved terms live in
                                    // ResolvedProfile (typicalSteps, nonStepActivityKcal, pal0, tdee0SigmaKcal, tdee0Drivers), CR-E1
  training?: TrainingProfile;       // PLANNER_V2 §8.1: owned, access[], refused, liked, injuries, skill, purchaseAllowance
  diet?: DietProfile;               // R4 §1.1 verbatim (animal foods, day/period rules, Jain sub-rules, allergies (hard),
                                    // intolerances (soft), medicalDiet (→ safety), dislikes, cuisines, staples, whoCooks,
                                    // skill, time budgets, batch cooking, budget, eating out, meals per day)
  kitchen?: { equipment: string[]; pantry: Array<{ foodId: string; have: boolean; qtyApprox?: string; perishable?: boolean; confirmedAt: Instant }> };
  supplements?: { stance: 'food_first' | 'open'; taking: Array<{ supplementId: string; dose: number; unit: string; clockH?: ClockH }> };
  devices?: { has: Array<'ring'|'watch'|'band'|'scale'|'chestStrap'|'phoneOnly'|'none'>; models: string[]; platforms: Array<'android'|'ios'|'desktop'> };
  answeredAt: Partial<Record<IntakeSectionId, Instant>>; questionSetVersion: Partial<Record<IntakeSectionId, number>>;
}
```
`profile.habits.dietAnimalLevel` is derived from `diet` (R4 §1.1 rule) and `profile.habits.typicalSteps` from `activity`
by `intake.answer`; the engine keeps reading the v0.1 fields plus the additive ones requested in §10.

### 2.4 DocStore interface (tier H)
```ts
type WriteTokenKind = 'command' | 'sync' | 'migration' | 'derive';
interface WriteToken { kind: WriteTokenKind; changeSetId?: Id; readonly brand: unique symbol }
interface Query { index?: string; range?: { lower?: unknown; upper?: unknown }; limit?: number; reverse?: boolean; includeDeleted?: boolean }
interface DocStore {
  ready: Promise<void>;
  get<T>(col: CollectionId, id: string): Promise<Doc<T> | null>;
  query<T>(col: CollectionId, q?: Query): Promise<Doc<T>[]>;
  watch<T>(col: CollectionId, q: Query | { id: string }, cb: (docs: Doc<T>[]) => void): () => void;   // local and remote changes
  transact<R>(token: WriteToken, fn: (tx: Tx) => Promise<R>): Promise<R>;                            // atomic
  history?<T>(col: CollectionId, id: string, limit: number): Promise<Array<{ rev: string; at: Instant; device: DeviceId; doc: Doc<T> }>>;
  estimate(): Promise<Record<CollectionId, { docs: number; bytes: number }>>;
  dump(cols: CollectionId[]): AsyncIterable<Doc<unknown>>;                                           // export, copyStore
}
interface Tx {
  get: DocStore['get'];
  put<T>(col: CollectionId, doc: T & { _id: string }): Promise<Doc<T>>;                 // LWW-F collections
  patch<T>(col: CollectionId, id: string, mergePatch: JsonMergePatch<T>): Promise<Doc<T>>;
  append<T>(col: CollectionId, doc: T & { _id: string }): Promise<Doc<T>>;              // APP/IMM; throws if the id exists
  remove(col: CollectionId, id: string): Promise<void>;                                  // soft delete
}
interface BlobStore {                                                                    // local cache + remote, create-only
  put(bytes: Uint8Array, meta: { purpose: 'bio'|'photo'; aadId: string }): Promise<{ chunkId: string; bytes: number }>;
  get(chunkId: string): Promise<Uint8Array>;          // local first, then remote; decrypts
  hasLocal(chunkId: string): Promise<boolean>; evictLocal(olderThan: LocalDate, purpose: 'bio'|'photo'): Promise<number>;
}
```

### 2.5 Append-only semantics
`dailyLogs`, `measurements`, `messages`: an edit appends a new entry with `supersedes: <id>`; a delete appends
`{ kind: 'retract', target: <id> }`. The **effective view** = entries neither superseded nor retracted. If two devices
supersede the same entry, both successors stay effective and the day shows "edited on two devices" with a one-tap
resolve (retracting one). Undo of a log write = retract; undo of a retract = a copy of the target superseding the retract.

### 2.6 Sync interface (R7)
```ts
interface SyncTarget { kind: 'relay'; url: string /* wss/https */; label: string }                // phase 2: 'webdavBackup' | 's3Backup'
interface PairingCode { uri: string /* vitals-sync:1?u=<url>&s=<base64url secret>&n=<label> */; words: string[] /* 24 BIP39 */ }
interface SyncAdapter {                       // implemented by the Evolu adapter (fallback: PouchDB adapter)
  readonly engine: 'evolu' | 'pouchdb';
  readonly capabilities: { live: boolean; history: boolean; maxRowBytes: number };
  open(store: 'local' | { secret: Uint8Array }): Promise<void>;
  pair(target: SyncTarget): Promise<PairingCode>;                    // first device: new 256-bit owner secret
  join(code: string, onExisting: (summary: string) => Promise<'merge' | 'replace'>): Promise<void>;
  push(): Promise<{ sent: number }>;                                 // upload unacknowledged local changes (Evolu: one RBSR round)
  pull(): Promise<{ received: number; collections: CollectionId[] }>;
  subscribe(cb: (s: SyncStatus) => void): () => void;                // status and remote-change hints (live socket)
  revokeAndRotate(): Promise<void>;                                  // rotates write key + K_auth (lost device cannot write or read blobs)
  rekey(): Promise<PairingCode>;                                     // full read revocation: new owner, copy, re-encrypt blobs
  eraseThisDevice(): Promise<void>; eraseEverywhere(): Promise<void>;
}
interface CollectionPolicy { col: CollectionId; strategy: 'lwwField'|'append'|'immutable'|'blob'|'derived'|'local'; sync: 'yes'|'no'|'optIn'; order: number }
interface SyncStatus { state: 'off'|'connecting'|'synced'|'syncing'|'offline'|'error'|'needs-permission'; lastSyncedAt: Instant | null;
  pendingChanges: number; pendingBlobs: number; lastError?: { code: string; message: string; at: Instant }; endpoint?: string /* host only */ }
interface Encryptor { seal(plain: Uint8Array, aad: string): Promise<Uint8Array>; open(sealed: Uint8Array, aad: string): Promise<Uint8Array> }   // blob path, backups
```
- **Keys:** Evolu derives OwnerId, encryption and write keys from the secret (SLIP-21). Vitals-owned keys use a separate
  HKDF-SHA256: `PRK = Extract("vitals/sync/v1", secret)`; `K_blob` (`blob-aead`), `K_blobid` (`blob-id`), `K_auth`
  (`endpoint-auth`, bearer for `/blobs`; the relay stores only its SHA-256); `ownerIdHash = base64url(SHA-256("vitals-owner" ‖ OwnerId))[0..22]`.
  Blobs: XChaCha20-Poly1305 (`@noble/ciphers`), 24-byte random nonce, AAD = `chunkId ‖ schemaVersion`;
  `chunkId = base64url(HMAC-SHA256(K_blobid, source‖stream‖date‖contentHash))[0..22]`.
- **Pairing:** first device shows the 24 words, QR and copyable `vitals-sync:1?…` behind "Show pairing code" (60 s
  auto-hide) with a required "I've saved the words" checkbox and the copy "Lose every device and these 24 words, and the
  data is gone." Others scan (`BarcodeDetector`, else a bundled decoder) or paste; a device that already holds data is
  asked "Merge it, or replace it with the synced data?" (merge = collection strategies; nothing is silently dropped).
- **Triggers:** app open, `visibilitychange → visible`, `online`, live socket pushes on write, blob uploads debounced 2 s
  (8 in parallel), heartbeat reconcile every 5 min while visible, "Sync now". No Background Sync in v1 (the SQLite worker
  is not reachable from the service worker); phase 2 MAY register `sync` for blob uploads only. Failures back off 30 s →
  5 min after 3 consecutive errors and never block the UI; status pill copy per R7 §5.4.
- **Chrome Local Network Access:** a public origin reaching a tailnet (100.64/10) or loopback endpoint triggers a
  one-time prompt; Settings explains it before the first connection and offers a fix-it link when denied. Each origin
  (public site, Companion-served site, localhost) is a separate device and is paired once.
- **Dumb storage** (WebDAV, S3) is phase 2 and backup-only: per-device encrypted export snapshots, no live multi-writer sync.

### 2.7 Projections and boot
- `bindDocs(store, { col, id | query, toState, fromState? })` hydrates a Zustand store and updates it on every
  `committed` event and every remote change; hooks keep their names and return shapes.
- Boot: store `ready` (Evolu WASM 461 KB gz is precached by the service worker) → migrations (§2.8) → hydrate the
  singletons (`profile`, `intake`, `safety`, `goals`, `settings`, `deviceSettings`, `uiPrefs`, `activePlan`, the active
  plan with its head version, today's `dayStatus` and entries) before the first data screen paints. Everything else loads
  through `useDocs(col, query)`. Budgets in §9.5.

### 2.8 Migration, export, import, erase
- **One-time migration (`migration` token).** If the store has no `migratedFromLocalStorage` marker and any `vitals.*`
  key (or legacy `lumen.*`, via the existing `migrateLegacyKeys`) exists: parse each key through its v0.1 sanitiser and
  migrator (`migrateScenarios`, `pickSafetyValues`, the profile `pick*`, settings `pickValues`, `sanitizeResultsUi`), map
  `vitals.body → profile + uiPrefs`, `vitals.safety → safety`, `vitals.scenarios → scenarios + uiPrefs.activeScenarioId`,
  `vitals.planner → goals`, `vitals.settings → settings + deviceSettings`, `vitals.results`, `vitals.ui.lastRoute → uiPrefs`,
  `vitals.simulations → derived`; write everything in one transaction; set the marker and
  `localStorage['vitals.migratedToStore'] = <Instant>`. The localStorage keys stay untouched for two releases (rollback)
  and are removed in v0.4. R7's phase-1 "document mirror" is skipped because v0.2 ships the collections directly.
  Fixture tests: every v0.1 store at its current version, plus a `lumen.*` dump; export after migration round-trips.
- **Export v2:** `{ vitalsVersion: '2', app: 'vitals', appVersion, exportedAt, device, collections: Record<CollectionId, Doc[]>, blobs: 'omitted'|'inline' }`
  covering synced collections plus `deviceSettings` and `uiPrefs`; never `secrets`, `providerKeys`, `pendingChanges`,
  `changeLog`, `commandLedger`, `derived`, `syncState`. Raw series export as canonical `vitals.biometrics/1` JSONL (R9 §5).
  Import accepts v1 (through the migration mapping) and v2, in `replace` (D) or `merge` (collection strategies) mode.
- **Erase:** "Erase this device" deletes the local database, blob cache, legacy keys and caches, then reloads; with sync
  on, "Erase everywhere" also deletes the owner on the relay; distinct confirmations, export offered first.

---

## 3. Plan lifecycle and the living plan (`src/engine/living/` pure; state and commands E5)

Planner-side contracts (`ActivePlanRecord`, `ConfirmedState`, `LoggedDay`, `ItemOutcome`, `BlockAdherence`,
`ReplanRequest`, `ReplanResult`, `PlanSensitivities`, `PlanItemType`, `projectRealistic`, `benefitRetained`,
`stimulusEquivalence`) are defined in PLANNER_V2_SPEC §7–§8 and used here unchanged.

### 3.1 States
```
 draft (a ladder rung or a scenario) ─plan.start─► scheduled ─(start date)─► active ◄─plan.resume─ paused
                                          │ plan.discard (24 h, no logs)        │  └─plan.pause───────────┘
                                          ▼                                     ▼ plan.end · plan.replace · horizon end
                                      (removed)                               ended {completed|abandoned|replaced|safety}
```
- Startable sources: a `hard`/`medium`/`easy` rung (`toActivePlan`, which freezes change targets as absolute values) or a
  scenario (`rung: 'custom'`, no genome). The Ideal is never startable as is (PLANNER_V2 §9.5).
- At most one plan in {`scheduled`,`active`,`paused`}. If sync merges two, the newer `activePlan` wins and the other
  ends as `replaced` with a notice on both devices.
- `ended:completed` is set at the first open after `plannedEndDate`; Today offers "keep the result" (a maintenance
  scenario) or "plan again" (§6.3). Ending never deletes versions or logs.
- A `danger` warning on the forecast, or a safety-screening change that blocks the plan's regime, pauses the plan
  (`reason:'safety'`) and opens an `event` re-plan proposal. Only the person resumes (UI-only path).
- At start the person records implementation intentions (R11 §1.2): weigh-in time, training days, what to do when a
  session is missed; stored in `PlanDoc.intentions` and shown on Today.

### 3.2 Documents and start
```ts
type PlanStatus = 'scheduled' | 'active' | 'paused' | 'ended';
interface PlanDoc {
  name: string; rung: RungId | 'custom';
  origin: { kind: 'planner'; requestHash: string; runAt: Instant } | { kind: 'scenario'; scenarioId: Id; scenarioRev: string };
  previousPlanId?: Id;
  status: PlanStatus; startDate: LocalDate; plannedEndDate: LocalDate;
  request: PlannerRequestV2;                    // goals with ABSOLUTE targets frozen at start; constraints; safety; training profile
  baselineProfile: PersonProfile;               // the person at day 0 (later profile edits never move the plan's past)
  headVersion: number;
  pauses: Array<{ from: LocalDate; to: LocalDate | null; reason?: string }>;
  ended?: { at: Instant; date: LocalDate; reason: 'completed'|'abandoned'|'replaced'|'safety'; note?: string };
  intentions: { weighInClockH?: ClockH; trainingWeekdays?: Weekday[]; missedSessionPlan?: 'nextDay'|'skip'|'shorter' };
  policy: { checkInWeekday: Weekday; autoApplyLoadLowering: boolean /* default true */ };
}
interface PlanVersionDoc {
  planId: Id; version: number; parent: number | null;
  status: 'proposed' | 'adopted' | 'rejected' | 'superseded';
  reason: 'start'|'light'|'weekly'|'event'|'user'|'coach'|'pause'|'resume'|'safety';
  effectiveFromDay: number;                     // plan-day index from which this version prescribes
  schedule: Schedule;                           // full horizon, day 0 = plan.startDate; days < effectiveFromDay equal the parent's
  genome: { structureId: string; x: number[] } | null;      // null for scenario-started plans
  sessions: Record<string /* slotKey */, ConcreteSession>;    // PLANNER_V2 §8.3 composed sessions
  sensitivities: PlanSensitivities;             // adherence weights (§3.7)
  forecast: ProjectionDigest; diff?: ReplanResult['diff']; explanation: string[];
  provenance: PlannerResultV2['provenance'] | { engineVersion: string; registryHash: string; catalogueVersion: string };
  createdBy: Actor; createdAt: Instant;
}
interface ProjectionDigest { fromDay: number;
  asPrescribed: Partial<Record<SeriesId, { p10: number[]; p50: number[]; p90: number[] }>>;
  realistic:    Partial<Record<SeriesId, { p10: number[]; p50: number[]; p90: number[] }>>;   // at expected credit (PLANNER_V2 §7.6)
  goals: Array<{ metric: MetricId; endP50: number; dateRange: [LocalDate, LocalDate] | null }>; warnings: SafetyNote[] }
interface PlanStartInput { source: { rung: RungId } | { scenarioId: Id }; startDate: LocalDate; name?: string; intentions?: PlanDoc['intentions'] }
```
`toActivePlanRecord(plan, version): ActivePlanRecord` (pure) is the only bridge to the planner.

**Anchoring (`anchorSchedule(schedule, startDate)`, pure).** If the weekdays of `startDate` and `schedule.startDate`
match, only the date changes. Otherwise, with `j = (weekday(startDate) − weekday(schedule.startDate)) mod 7`, the new
`days` are the old `days[j..H−1]` followed by the old days of the last week that fall on the missing weekdays, restoring
horizon `H`; blocks shift by `−j` (clipped at 0); fasts with `startDay < j` are dropped with a notice; genome-based
plans get `toActivePlan` re-run on the anchored schedule. The start dialog shows "starting on <weekday> skips the first
j days of week 1; goal date moves by N days". Start choices: today, tomorrow (default), next Monday, a date ≤ 28 days ahead.

**Calendar.** `planDay(date) = daysBetween(plan.startDate, date)`. The version in force on a date is the adopted version
with the largest `effectiveFromDay ≤ planDay`. Pause `[P, R)`: those days prescribe the habitual day
(`habitualTraining: true`, 100 % of maintenance, habitual meals); logs still count. `plan.resume` creates a version with
`effectiveFromDay = R` whose days from `R` are the parent's days from `P`, blocks and fasts shifted alike, and
`plannedEndDate` extended by `R − P`.

### 3.3 Prescription snapshot
When a date becomes the current day (rollover, §3.4) its prescription is frozen into `dayStatus.prescribed`, so re-plans
never rewrite what the person was asked to do on a past day.
```ts
interface PrescribedDaySnapshot {
  planId: Id; version: number; planDay: number; dayType: string;
  energyKcal: number; macros: { proteinG: number; carbG: number; fatG: number; fibreG: number }; window?: { startH: ClockH; endH: ClockH };
  meals: Array<{ slot: string; clockH: ClockH; energyKcal: number; proteinG: number; carbG: number; fatG: number; mealPlanId?: string }>;
  sessions: Array<ConcreteSession & { slotKey: string; startH: ClockH }>;
  fast?: { lastIntakeAt: Instant; firstIntakeAt: Instant; hours: number; refeedFactor?: number };
  steps?: number; sleep?: { bedH: ClockH; wakeH: ClockH }; supplements: Array<{ supplementId: string; dose: number; unit: string; clockH?: ClockH }>;
  items: Array<{ itemId: string; type: PlanItemType; weight: number; target: Record<string, number> }>;   // weights sum to 1
}
```

### 3.4 Daily log
Tiered logging (R11 §1.2): **T0** (≤ 10 s) per-block "as planned / partly / not" plus weigh-in; **T1** (≤ 60 s) what
differed (swap, skip, fast broken at hour X), steps and sleep from devices; **T2** meals by text, voice or photo; **T3**
girths, body-fat readings, labs, hunger/energy/mood (weekly default). Plus one daily "how hard was today" 1–5.
```ts
interface EntrySource { by: 'user'|'ai'|'device'|'import'|'system';
  method: 'typed'|'asPlanned'|'aiText'|'aiPhoto'|'aiPhotoUserGrams'|'label'|'dbMatch'|'biometrics'|'import'|'backfill';
  conversationId?: Id; toolCallId?: string; bioRecordId?: string; actorId?: string }
interface Est { value: number; sd: number }      // P50 and SD; display band per R8 §6.3 / R4 §4.3 by method
interface NutrientEstimate { energyKcal: Est; proteinG: Est; carbG: Est; fatG: Est; fibreG?: Est; sugarsG?: Est; satFatG?: Est; alcoholG?: Est; sodiumMg?: Est }
interface LogEntryBase { date: LocalDate; tz: string; at?: Instant; planId?: Id; planDay?: number; source: EntrySource;
  confidence?: number /* 0–1, R11 §6.2 */; assumed?: boolean /* backfill: excluded from scoring and estimation */;
  supersedes?: Id; itemId?: string /* prescribed item it addresses */; text?: string; attachmentIds?: Id[] }
type LogEntry = LogEntryBase & (
  | { kind: 'meal'; clockH: ClockH; slot?: string; complete?: boolean;
      components: Array<{ name: string; localName?: string; foodId?: string; recipeId?: Id; grams: Est;
                          cookingMethod?: string; visibleFatCue?: 'none'|'some'|'glossy'|'pooled'; nutrients: NutrientEstimate;
                          nutrientSource: 'table'|'label'|'user'|'model' }>;
      totals: NutrientEstimate }                                     // computed by the app (§5.6), never by the model
  | { kind: 'session'; status: 'done'|'partial'|'skipped'; startH?: ClockH; durationMin?: number; performed: PerformedExercise[];
      rpe?: number; hr?: { avgBpm?: number; maxBpm?: number }; bioWorkoutId?: string; stimulus: StimulusVector; catalogueVersion: string }
  | { kind: 'fast'; lastIntakeAt: Instant; firstIntakeAt: Instant | null; broken?: boolean; electrolytes?: boolean }
  | { kind: 'steps'; steps: number } | { kind: 'sleep'; bedAt: Instant; wakeAt: Instant; quality?: SleepQuality }   // sleep date = wake date
  | { kind: 'substance'; substance: 'caffeine'|'alcohol'|'creatine'|'exogenousKetones'; clockH: ClockH; amount: number; unit: 'mg'|'drinks'|'g' }
  | { kind: 'supplement'; supplementId: string; dose: number; unit: string; clockH?: ClockH }
  | { kind: 'subjective'; difficulty?: 1|2|3|4|5; hunger?: number; energy?: number; mood?: number; stress?: StressLevel; illness?: boolean }
  | { kind: 'event'; event: 'illness'|'travel'|'noTraining'|'socialMeal'|'busy'|'dietBreak'|'creatineStart'; to?: LocalDate }
  | { kind: 'note' } | { kind: 'retract'; target: Id });
interface MeasurementEntry { date: LocalDate; at?: Instant; metric: MeasurementMetric; value: number;
  repeats?: number[];                                               // girths: 2–3 repeats, mean is `value`
  context?: 'morningFasted'|'evening'|'postWorkout'|'unknown'; method?: 'scale'|'tape'|'dxa'|'bia'|'skinfold'|'navy'|'lab'|'meter';
  source: EntrySource; supersedes?: Id }
type MeasurementMetric = 'weightKg'|'waistCm'|'hipCm'|'neckCm'|'chestCm'|'armCm'|'thighCm'|'bodyFatPct'|'sbpMmHg'|'dbpMmHg'|'ketonesMmolL'|'glucoseMmolL'|keyof LabBaselines;
interface DayStatusDoc { date: LocalDate; planId?: Id; planDay?: number;
  marks?: Partial<Record<'food'|'train'|'fast'|'all', 'asPlanned'|'partly'|'not'>>; assumed?: boolean;
  confirmedAt?: Instant; prescribed?: PrescribedDaySnapshot; score?: AdherenceScore; note?: string }
```
- Dates are the event's calendar date in the device time zone (engine day 00:00–24:00); the UI's current day rolls over
  at `settings.dayRolloverH` (default 04:00).
- `toLoggedDay(date): LoggedDay` (pure) produces PLANNER_V2's `LoggedDay {inputs: DayTemplate, items: ItemOutcome[], coverage}`:
  meals → `energy:{kind:'kcal'}`, macro grams, explicit `meals[]`, carbohydrate-weighted GI, NOVA-4 energy share as
  `upfShare`, dominant protein source; sessions → `exercise[]` via E8 `resolveStimulus`/`toSessions` (hybrid items compile
  to two sessions, R3 §3.3); fasts → `FastEvent` from instants (a logged meal inside a prescribed fast ends it there);
  steps device > manual > prescribed-if-`asPlanned` > habitual; sleep device > manual > prescribed (the night ending on D
  goes to the field the engine reads for that night, MODEL_SPEC §1.1; E5 contract test); substances, supplements (§8.5)
  and events (illness → `modifiers.illness`, stress) as engine inputs. Items without any log or mark are `unknown`; for
  the replay only, an unknown item is simulated at its expected credit `E[c_b]` from revealed adherence (as PLANNER_V2
  §7.6 does for future days), flagged `assumed`, and excluded from scoring and from the δ estimate.
- Lapse flow: the first open after ≥ 2 missed days says "Welcome back, nothing to catch up on" and offers one-tap
  "as planned" backfill for the gap (`assumed: true`). Burden monitor: T1+ logging below 3 days in 7 for two weeks →
  Today switches to minimal mode (T0 only) and the Coach says the plan still works with weigh-ins and taps; at most one
  weekly prompt.

### 3.5 State estimation, anchoring, forecast (R11 §3; produces PLANNER_V2 `ConfirmedState`)
**Daily (every log or sync change, debounced 1 s; no anchor move):**
1. Replay `baselineProfile` from the latest anchor snapshot (or day 0) with logged days through yesterday (`LoggedDay.inputs`).
2. Trend filter, local-linear-trend Kalman, state `[w, r]`, `F = [[1,1],[0,1]]`, `Q = diag(q_w², q_r²)`; observation
   `y = scaleWeight − (engine water terms: glycogen-bound water 2.7·ΔG + ΔECF/sodium water)`, `R = (σ_rel·W)²`.
   Defaults: `σ_rel` 0.5 % (0.6–0.7 % when weigh-ins are unstandardised), `q_w` 0.03 kg/d, `q_r` 0.005 kg/d per day; a
   gap of n days multiplies `Q` by n; innovation > 3.5·√S multiplies `R` by 10 for that point (flagged, never deleted);
   declared events (illness, travel, creatine start, diet break, new block) multiply `R` by 4 for 3–5 days; a
   day-of-week offset (6 parameters, shrunk) only after 6 weeks of data. Display line: EWMA α = 0.1.
3. Light re-plan only for energy overshoot beyond tolerance: next 1–3 days' energy shifted by ≤ 10 % in total (never
   "make up for yesterday" within a day).

**Weekly check-in (`plan.checkIn`, on `policy.checkInWeekday`; needs ≥ 4 weigh-ins in 7 d or ≥ 10 in 14 d):**
4. Energy-balance bias `δ` (kcal/d, intake under-report plus expenditure error): `δ̂ = (r_obs − r_engine(δ=0))·ρ` with ρ
   the energy density of the engine's own fat/lean mix; precision-weighted with prior `N(δ_prev, 150²)`; updated only with
   ≥ 10 weigh-ins in 20 d and ≥ 4 logged intake days in each of the last two weeks; clamp ±300, change ≤ 100 per week;
   prior SD +50 when > 70 % of logged energy was AI-estimated.
5. Anchor: engine snapshot at the check-in date with total tissue mass set to the filtered `w` (plus the engine's water
   terms) and the residual allocated to fat, lean and glycogen **by the engine's own partition** (CR-L2), never all to fat.
   Girths enter as weekly means of 2–3 repeats (`R = (0.8 cm)²`) and only nudge the fat/lean split after 3–4 weeks;
   consumer BIA readings are weekly-mean observations of body-fat % with SD ≥ 2 points and never override; a DXA or
   clinical reading is a hard re-anchor of composition with its own SD.
6. Persist `ConfirmedStateRecord { planId, anchorDate, trendWeight: {kg, sd}, energyBiasKcal: {mean, sd}, residualSplit,
   inputsHash, engine: {engineVersion, registryHash} }` in `anchors` (synced, immutable). The `EngineSnapshot` itself is
   rebuilt deterministically by replaying with the stored anchors (CR-L1, CR-L2) and cached in `derived`; together they
   form the planner's `ConfirmedState`.
7. Hard re-anchor (immediate, R11 §3.3): confirmed illness > 2 d, ≥ 5 days off-plan travel, diet-break start/end, end of
   a fast ≥ 48 h, a new training block, ≥ 14 days without a weigh-in (trend prior SD reset to 1 kg), a DXA entry, an engine
   or registry version change (anchors recomputed from plan start under the new version; old ones kept for audit).

**Forecast:** from today, PLANNER_V2 `projectRealistic(plan, state, adherence)` (expected credit) and the as-prescribed
curve, both with `δ` as an intake offset (CR-L3) and the seeded ensemble → `ProjectionDigest`. Identical documents and
versions give identical results on every device; only raw inputs and anchors sync, never forecasts.

### 3.6 Re-planning
PLANNER_V2 §7 is normative (inputs, lock window of today and tomorrow, shrinking horizon with a 7-day minimum, warm
start, churn limits, trigger table §7.5, revealed adherence §7.6). E5 builds `ReplanRequest` from `PlanDoc`, the head
version, the latest `ConfirmedState`, `LoggedDay`s since the anchor and `BlockAdherence`, and turns `ReplanResult` into a
`PlanVersionDoc`:
- **Adopted automatically** when every change lowers load and stays within PLANNER_V2 §7.4's hard limits, or for the
  daily ±10 % energy nudge; the change shows on Today with Undo.
- **Proposed** otherwise (`status:'proposed'`; Today card and Coach: diff, goal dates before/after as ranges, Apply /
  Discard). Raising load, adding a fast or changing rung always needs consent.
- `plan.declareEvent` and `plan.shift` map to `event` re-plans with `changes`:
```ts
interface PlanShiftInput { from: LocalDate; days: number /* 1–28 */;
  mode: 'noTraining'   // sessions removed on those days, energy re-derived for the activity (R-MAINT); later days unchanged
      | 'habitual'     // the days become habitual days (busy, travel, festival)
      | 'pushBack'     // insert habitual days and push every later prescription back; end date moves
      | 'swap'; withDate?: LocalDate;
  absorb?: { date: LocalDate; extraKcal?: number; extraCarbG?: number; note?: string };   // a known occasion
  replanRest?: boolean }                                                                  // default true
interface VersionProposal { version: number; status: 'proposed'|'adopted';
  goalDates: ReplanResult['goalDates']; impact: Array<{ metric: MetricId; endP50Delta: number }>; notes: string[] }
```
The Coach explains `goalDates` ("three days without training moves your goal date by 2–4 days").

### 3.7 Daily adherence score (R11 §4, PLANNER_V2 §8.6)
```ts
interface AdherenceScore { score: number | null /* 0–100; null when coverage < 0.4 */; coverage: number;
  items: Array<{ itemId: string; type: PlanItemType; weight: number; credit: number | null; why: string }>; final: boolean }
```
- **Weights** `w_i` = the version's `PlanSensitivities.itemWeights` (the item's counterfactual share of the weighted goal
  score, floor 0.02), renormalised over the day's items. Not equal weights.
- **Credits** `c_i ∈ [0,1]` = benefit retained: `benefitRetained(plan, date, itemId, performed)` (28-day forward run from
  the confirmed state) when the worker budget allows (≤ 12 runs per scored day), else the fast forms: energy 1 inside
  ±5 % (min ±75 kcal), then the engine-sensitivity taper, overshoot < 1 only when the engine says it costs progress;
  protein 1 inside −10 % (overshoot scores 1); sessions `stimulusEquivalence(...).credit` (a substitute at parity scores
  1, lighter partially, skipped 0; over-delivery capped per term); fasts by hours achieved through the same sensitivity
  curve (a fast broken at 18 of 24 h earns partial credit); steps, sleep `min(1, actual/target)`; supplements 0/1.
- **Score:** `100·Σ w_i c_i / Σ w_i` over items with known status (logged, device-covered or marked `asPlanned`);
  unknown items are dropped from both sums; `coverage` = known weight share; < 0.6 shows "based on 3 of 5 items";
  < 0.4 gives no score; `assumed` days are never scored. Owner's example: all done → 100; one skipped item with
  weight 0.2 → 80; an equivalent swap → 100. Unconfirmed days are `final:false`, labelled "so far".
- **Trend:** `A_7` = mean of scored days in the last 7 (≥ 3 needed); `A_28` = EWMA over scored days, half-life 14 d,
  with coverage ("scored 22 of 28 days"); arrow when `A_7 − A_28` exceeds ±5. No streak counter; the headline is
  "6 of the last 7 days logged". Weekly check-in shows per-block bars and names the item that cost the most.
- **Revealed adherence:** per `PlanItemType` (and weekday slot) `Beta(a, b)`, prior `Beta(6, 2)`, fractional update
  `a += c, b += 1 − c`, forgetting half-life 21 d → `BlockAdherence[]` for the planner (swap and weekday rules in
  PLANNER_V2 §7.6).
- **Quiet mode** (`settings.quietMode`): categories instead of numbers for the score and remaining energy; on by default
  in safety mode R1 and offered whenever disordered-eating risk signals appear (R11 §8 Q4) **[owner confirms]**.
- The score is distinct from the engine's `adherence` series (modelled plan-survival probability); copy never mixes them.

### 3.8 Drift (R11 §2.2)
```ts
interface DriftReport { asOf: LocalDate; goals: Array<{ goal: number; metric: MetricId; target: number | null;
    trend: { value: number; sd: number };                         // filtered (weight) or latest estimate
    band: { p10: number; p90: number };                           // forecast 80 % interval for today, from the last adopted version
    state: 'ahead' | 'onTrack' | 'behind'; checkInsOutside: number;   // state changes only after 2 consecutive check-ins outside
    goalDate: { range: [LocalDate, LocalDate] | null; shiftDays: number | null; shiftSd: number | null };   // shown when ≥ 3 d and outside the band
    causes: Array<{ cause: 'adherence' | 'expenditure' | 'waterNoise'; share: number; text: string }>;
    action: 'keepGoing' | 'easeOptions' | 'replan'; text: string }> }
```
Causes come from the replay (logged vs prescribed intake and training), `δ` (expenditure correction) and the filter
residual. If adherence explains > 60 % of a gap, the text says so; if the person was on plan it says the expenditure
estimate is being corrected ("your body is burning about 120 kcal a day less than assumed; plan updated"). One action
per verdict, no red, self-compassionate lapse copy, trend line as the hero, raw weigh-ins faint.

### 3.9 Today data contract (`today.get`; the same object feeds the Today screen and the Coach)
```ts
interface TodayView {
  date: LocalDate; tz: string; rolloverH: number; mode: 'living' | 'planning'; minimalMode: boolean; quietMode: boolean;
  plan: { id: Id; name: string; rung: RungId | 'custom'; day: number; of: number; status: PlanStatus; version: number } | null;
  prescription: PrescribedDaySnapshot | null;
  logged: { entries: LogEntrySummary[]; totals: { energyKcal: Est; proteinG: Est; carbG: Est; fatG: Est; fibreG: Est };
            items: Array<{ itemId: string; status: 'done'|'partial'|'skipped'|'unknown'; credit?: number }>;
            fast?: { state: 'notStarted'|'running'|'done'|'broken'; sinceH?: number; remainingH?: number }; steps?: number; sleepHours?: number };
  remaining: { energyKcal: number; proteinG: number; carbG: number; fatG: number } | null;      // null in quiet mode
  checklist: Array<{ id: string; at?: ClockH; kind: 'mark'|'meal'|'session'|'fast'|'supplement'|'weigh'|'measure'|'sleep'|'steps';
                     label: string; done: boolean; command: { id: CommandId; input: unknown } }>;   // one-tap actions are commands
  adherence: { today: AdherenceScore | null; a7: number | null; a28: number | null; daysLogged7: number; spark: number[] };
  drift: Array<Pick<DriftReport['goals'][number], 'metric'|'state'|'goalDate'|'text'>> | null;
  trendWeight: { kg: number; sd: number; todayExpected: { p10: number; p50: number; p90: number }; measured?: number } | null;
  checkIn: { due: boolean; lastAt: LocalDate | null };
  biometrics: { lastNight?: { hours: number; efficiency?: number; source: string }; restingHr?: { value: number; vsBaseline: number };
                hrv?: { state: 'below'|'normal'|'above'; metric: 'rmssd'|'sdnn' }; flags: Array<{ id: string; level: 'yellow'|'amber'|'red'; text: string }> } | null;
  notices: Notice[];                       // safety warnings, proposals, pending Coach changes, sync problems, welcome-back
  coachPrompts: string[];
}
```

---

## 4. Biometrics (`src/biometrics/`, E10)

### 4.1 Canonical record `vitals.biometrics/1` (wire and storage; snake_case to match the published schema)
```ts
interface BioBatch { schema: 'vitals.biometrics/1'; producer: { name: string; version: string }; exported_at: string; tz: string; records: BioRecord[] }
type BioChannel = 'manual'|'file:apple_health'|'file:health_auto_export'|'file:health_connect'|'file:gadgetbridge'|'file:canonical'
  |'file:lumen_cloudevents'|'file:lumen_archive'|'share'|'bridge:android'|'shortcut:ios'|'mqtt:lumen'|`ble:${string}`|`oauth:${string}`|'companion:ingest';
interface BioCommon {
  kind: 'daily'|'sleep'|'workout'|'series'|'spot'|'device_profile';
  record_id: string;                  // UUIDv5(source, native_id) or of (kind, metric, start, source); stored as `${record_id}@${version}`
  version: number;                    // monotonic for upserts; readers take the highest
  time: { start?: string; end?: string; at?: string; tz_offset_s: number; local_date: string };
  provenance: { channel: BioChannel; source_app?: string;
    device?: { type: 'ring'|'watch'|'band'|'phone'|'scale'|'strap'|'manual'; manufacturer?: string; model?: string; firmware?: string; tier: 'A'|'B'|'C' };
    recording_method: 'automatic'|'active'|'manual'|'unknown'; modality: 'sensed'|'self_reported'|'derived';
    native_id?: string; native_version?: string; source_created_at?: string; ingested_at: string; decoder?: string;   // e.g. 'jstyle2301/V0789@1'
    algorithm?: { name: string; version: string; doc_url?: string } };
  quality: { validation: 'measured'|'vendor_proprietary'|'estimated'|'self_reported'; confidence: 'low'|'medium'|'high'|null;
    completeness?: number; vendor_state?: string;
    flags: Array<'provisional_stages'|'hrv_vendor_defined'|'apple_sdnn'|'out_of_range'|'partial_day'|'estimated_vo2'|'ai_extracted'|'clock_drift'> };
}
type BioRecord = BioCommon & (
  | { kind: 'daily'; steps?: number; distance_m?: number; active_kcal?: number; total_kcal?: number;
      active_min?: { light: number; moderate: number; vigorous: number }; resting_hr_bpm?: number; hr_avg_bpm?: number; hr_min_bpm?: number; hr_max_bpm?: number;
      hrv?: { metric: 'rmssd'|'sdnn'|'vendor'; value_ms: number; window: 'night'|'deep_sleep'|'first_4h'|'morning'|'spot'; n?: number };
      spo2_avg_pct?: number; spo2_min_pct?: number; resp_rate_brpm?: number; skin_temp_delta_c?: number; skin_temp_c?: number; body_temp_c?: number;
      vo2max?: { ml_kg_min: number; method: 'lab'|'field_test'|'vendor_estimate'|'derived' };
      vendor?: { stress?: { value: number; scale: string }; readiness?: number; sleep?: number; recovery?: number; strain?: number; body_battery?: number };  // opinion only
      main_sleep_id?: string }
  | { kind: 'sleep'; is_main: boolean; in_bed_s?: number; asleep_s: number; awake_s?: number; light_s?: number; deep_s?: number; rem_s?: number; unknown_s?: number;
      latency_s?: number; waso_s?: number; awakenings?: number; efficiency_pct?: number;
      stages?: Array<{ start: string; end: string; stage: 'unknown'|'awake'|'awake_in_bed'|'out_of_bed'|'asleep_unspecified'|'light'|'deep'|'rem' }>;   // Apple core → light
      raw_codes_chunk?: string;          // chunkId of the vendor's raw stage codes + firmware (R10 §6.1), so a corrected map can rescore
      night?: { hr_min_bpm?: number; hrv?: { metric: 'rmssd'|'sdnn'|'vendor'; value_ms: number }; spo2_avg_pct?: number; resp_rate_brpm?: number; skin_temp_delta_c?: number } }
  | { kind: 'workout'; exercise_type: string; native_type?: string; title?: string; active_duration_s: number; distance_m?: number; active_kcal?: number;
      hr_avg_bpm?: number; hr_max_bpm?: number; hr_zones_s?: number[]; rpe_0_10?: number; load?: { value: number; method: 'trimp'|'srpe'|'vendor' };
      percent_recorded?: number; hr_chunk_ids?: string[] }        // routes are not stored by default
  | { kind: 'series'; metric: BioStream; unit: string; aggregation: 'sample'|'avg'|'min'|'max'|'sum'; interval_s?: number;
      sampling: { mode: 'continuous'|'periodic'|'spot'|'event'; nominal_interval_s?: number };
      context?: 'sleep'|'rest'|'exercise'|'unknown'; t_offset_s?: number[]; values: number[]; wear?: Array<[number, number]>; quality_mask?: number[] }  // wire only; stored as chunks (§4.2)
  | { kind: 'spot'; metric: 'weight_kg'|'body_fat_pct'|'lean_mass_kg'|'waist_cm'|'bp_sys_mmhg'|'bp_dia_mmhg'|'glucose_mg_dl'|'body_temp_c'|'hr_bpm'|'spo2_pct'|'hrv_ms';
      value: number; context?: 'fasting'|'morning'|'post_workout' }
  | { kind: 'device_profile'; model: string; firmware_range?: string; metric: BioStream; bias: number; loa_lo: number; loa_hi: number;
      n_nights: number; reference_device: string });               // R9 §3 own validation; replaces tier C bands for that model
type BioStream = 'hr'|'ibi'|'hrv'|'spo2'|'skin_temp'|'body_temp'|'resp_rate'|'steps'|'distance'|'active_kcal'|'motion'|'sleep_state'|'sleep_stage'|`vendor:${string}`;
```
HRV metrics never share a field (Apple SDNN stays `sdnn`); vendor-computed numbers (stress, readiness, vendor HRV
transforms, BP and glucose estimates, vascular age) live only under `vendor` / `vendor:<key>` streams.

### 4.2 Raw sample streams
- Series are stored as **chunks per (source, stream, local date)**; a chunk over 256 KB compressed is split by UTC hour
  (high-rate streams such as 1 Hz HR or IBI). Encoding: header `{t0_ms, dt_ms|null, scale, n, tz_offset_s}`, delta-coded
  Int32 time offsets (omitted when regular), Int16/Float32 values, Uint8 origin (`history|spot|live|workout_stream|import`)
  and optional quality mask; gzip (`CompressionStream`), then the blob AEAD (§2.6).
```ts
interface BioChunkManifest { chunkId: string; sourceKey: string; stream: BioStream; local_date: string; hourStartUtc?: string;
  n: number; min: number; max: number; bytes: number; contentHash: string; schemaVersion: 1; decoder?: string; createdAt: Instant;
  supersedes?: string }   // a re-sync with more samples writes a merged chunk that supersedes the old one
```
- Sample identity inside a chunk is `(origin, t)` (R10's deterministic id), so re-imports are no-ops; tombstoned samples
  (user deletions) are kept as a per-source tombstone list so a re-sync never resurrects them.
- **Retention (R9 §5 + R7 §3):** raw data is kept indefinitely on the sync endpoint (or locally when sync is off), because
  rescoring history is the point. With sync on, phones keep 30 days of raw chunks locally and fetch older ones on demand;
  desktops keep everything (setting). Optional "compact raw older than N months" downsamples and freezes the affected
  scores at their current version, with a warning.

### 4.3 Ingest

> Batch 03 changes: see §14.5 (record ids and per-message ingest).

> v0.4.0: resolution is one truth per record (correction > device > nothing) in a fixed device order, no priority lists: see §14.6.
```ts
interface BiometricsImporter {                        // runs in biometrics.worker.ts; one adapter per format
  id: string; label: string; accepts: { mime: string[]; extensions: string[]; sniff(head: Uint8Array): boolean };
  needs?: Array<'sqljs'>;                             // SQLite imports (Health Connect zip, Gadgetbridge) need 'wasm-unsafe-eval'
  run(input: Blob, ctx: { tz: string; now: Instant; signal: AbortSignal; onProgress(p: number): void }): AsyncIterable<BioBatch>;
}
interface IngestReport { batches: number; records: number; samples: number; chunks: number; duplicates: number;
  sources: string[]; days: { from: LocalDate; to: LocalDate }; warnings: string[] }
```
Phase A importers (E10): canonical JSON/JSONL/CSV, Apple Health `export.zip` (streaming XML, SDNN kept as SDNN), Health
Auto Export JSON, the Lumen app's CloudEvents JSONL (`health.metric.observed`, `health.sleep.timeline.updated`,
`health.activity.updated`, `health.insight.updated` → `modality:'derived'`), then the Health Connect export zip and
Gadgetbridge DB (sql.js). Every channel (file, share target, Companion `/ingest`, BLE, MQTT via the Companion) produces
`BioBatch`es and goes through one pipeline: validate → normalise units → dedupe → split series into chunks → write
manifests and records → resolve daily views → schedule rescoring. Daily views pick **one source per metric per day** by
the user's priority (`bio.setSourcePriority`); values are never averaged across devices; the source label shows next to
every number. A new device starts a new baseline (the old one stays for display).

### 4.4 Score catalogue (R9 §4; `src/biometrics/core/scores/`)
```ts
interface ScoreDef {                                   // 'vitals.score_def/1'
  scoreId: string; title: string; version: string /* semver */; released: LocalDate; supersedes?: string;
  kind: 'derived_measurement'|'estimate'|'index'|'flag'; label: 'measurement'|'estimate'|'convenience_index'|'flag';
  inputs: Array<{ stream: BioStream | string; window: 'main_sleep'|'night'|'7d'|'14d'|'28d'|'60d'|'90d'|'workout'|'all';
                  minCoverage?: number; minCount?: number; tiersAllowed: Array<'A'|'B'|'C'>; sameSourceRequired: boolean }>;
  profileInputs: Array<'age'|'sex'|'massKg'|'hrMaxObs'|'sleepNeedH'>;
  gates: string[];                                     // machine-readable; unmet → status 'withheld' with a reason, never a fabricated value
  formula: { fn: string /* `${scoreId}@${version}` */; text: string /* shown in the UI */ };
  params: Array<{ name: string; value: number; range?: [number, number]; unit: string; sourceRef: string; kind: 'published'|'proposed'|'engineering' }>;
  output: { unit: string; range?: [number, number]; goodDirection?: 'up'|'down'; display: 'number'|'band'|'state' };
  uncertainty: { method: 'propagated'|'empirical_profile'|'fixed_band'|'none'; notes: string };
  evidence: EvidenceLabel;                             // §8.6 (mechanism × certainty)
  planEffects: Array<{ target: 'training_intensity'|'training_volume'|'fast_permission'|'replan_trigger'|'engine_observation'|'trainer_briefing'|'display_only';
                       rule: string; priority: number }>;
  optInStreams: BioStream[];
  compute(input: ScoreInput): ScoreResult;             // pure; tier P
}
interface ScoreResult {                                // 'vitals.score_result/1', a cache (collection bioScores)
  scoreId: string; version: string; scope: { kind: 'night'|'day'|'week'|'workout'; localDate: string };
  status: 'ok'|'withheld'|'insufficient_baseline'|'borderline'; value: number | null; state?: string;
  band?: { lo: number; hi: number; level: 0.8 | 0.95 }; confidence: 'low'|'medium'|'high';
  contributors: Array<{ id: string; raw?: number; unit?: string; component?: number; weightConfigured: number; weightApplied: number; available: boolean }>;
  inputsHash: string; sourceIds: string[]; computedAt: Instant; build: string;
}
```
- v1 entries are R9 §4.3 (normative list): `sleep.tst`, `sleep.debt` (dossier-16 `dF`/`dS`, need 7.5 h), `sleep.se_spt`,
  `sleep.waso`, `sleep.midpoint`/`sjl`/`msf_sc`, `sleep.sri`, `sleep.index` (= `lumen-sleep-v4` port), `hr.rhr_night`,
  `hrv.ln_rmssd_night`, `hrv.status` (7-day mean vs 60-day baseline ± 0.5 SD), `hrv.strain_accumulating`,
  `illness.nightsignal` (published FSM, ported exactly), `load.trimp`/`load.srpe`/`load.ewma`, `fitness.vo2max` (Bayesian
  ladder feeding the engine's VO2max state as an observation with variance), `autonomic.deviation` (never called
  "stress"), `readiness.index` (`lumen-recovery-v4` parity port; display only), `spo2.night`, `temp.deviation`. Port order
  and parity tolerances per R10 §6 (sleep v4 integer-exact; others ±0.1 against replayed CloudEvents and the owner's
  local DB, which never enters the repo).
- **Rescoring:** a new version is computed for every scope of history (most recent 90 days first, in the worker) and old
  versions stay side by side; UI and Coach show which version produced a number. Whenever a score value feeds a briefing
  or a plan change, a `decisionLog` entry records `(scoreId, version, value, band, decision)`.
- **Vendor score as opinion:** vendor numbers are shown as "<vendor> says …", are never inputs to a `ScoreDef`, the
  engine, the planner, the adherence score or a plan effect, and reach the Coach only when that stream's coach policy
  allows and labelled `vendor_opinion`.
- **Plan effects are proposals** (pending changes on Today and to the Coach), applied automatically only when they lower
  load and `autoApplyLoadLowering` is on. When flags disagree the most protective effect wins: illness red > HRV below >
  sleep debt > load. A planEffect other than `display_only`/`trainer_briefing` requires `evidence.mechanism.status` ≠
  `infoOnly` (no mechanism, no model change). Device tiers set the bands (R9 §3); tier C HRV, SpO2 and stress are
  within-person trends only.

### 4.5 Opt-in matrix and use in the living plan

> Batch 03 changes: see §14.6 (one source of truth).

> v0.4.0: a stream a device imports is device-owned; entries by hand for it become corrections: see §14.6.
```ts
interface StreamPolicy { stream: BioStream | 'workouts' | 'sleep_sessions' | 'vendor_scores';
  imported: boolean;                      // data from this stream is stored at all
  coach: 'hidden' | 'daily' | 'daily+series';   // what the Coach may see (series only through a visible tool call)
  engine: boolean;                        // may replace assumed inputs / feed observations (engine-eligible streams only)
  scores: boolean }                       // may feed Vitals' own scores
```
Defaults: everything off until onboarding's `devices` intake; turning a device on suggests `imported`, `scores` and
`engine` for eligible streams and `coach: 'hidden'` until the person chooses (consent; UI-only command `bio.setPolicy`).

| Stream | Engine use when `engine` (via `LoggedDay.inputs` or observations) | Plan / Coach use |
|---|---|---|
| sleep sessions | measured bed, wake, hours, quality replace the assumed sleep | `sleep.*` scores; timing advice |
| steps, workouts | replace planned steps; workouts matched to prescribed sessions by date, type, duration → done/partial with TRIMP or sRPE load | adherence items, equivalence |
| weight, body fat | trend filter (§3.5) | drift |
| VO2max | lab/field tests and Vitals' `fitness.vo2max` posterior as an observation of the VO2max state; vendor estimates shown only | cardio intensities |
| resting HR, HRV, skin temperature | observations only where a mechanism exists (recovery, illness flags); suggested `modifiers.illness`/`stress` need the person's confirmation | `hrv.status`, `illness.*` plan effects |
| SpO2, vendor stress, vendor scores | none | shown and trended; flags to the Coach |

Every metric that replaces an assumption shows "plan assumed X, you measured Y, effect on the projection: …".

### 4.6 Web Bluetooth driver registry (phase C, Chromium only, foreground "Sync now")
```ts
interface BleDriver {
  id: string; family: string; label: string;
  requestOptions: { filters: BluetoothLEScanFilter[]; optionalServices: BluetoothServiceUUID[] };   // e.g. 2301: namePrefix + 0xFFF0
  protocol: BleProtocol;                                           // pure (tier P), golden vectors ported from the Kotlin tests
  open(link: BleLink, opts: { credential?: string }): Promise<BleSession>;   // impure transport (src/biometrics/ble/); `credential` overrides a built-in passcode, tests only
}
// No ring asks the person for anything (owner, 2026-10-04): any handshake is built into its driver. 2301 V0789's 0x3C
// passcode is a protocol constant in src/biometrics/core/ble/jstyle2301/passcode.ts, stored as bytes, never shown, logged
// or captured (redactOutbound), and allowed in no other file (its __tests__/passcode.test.ts scans every tracked file).
interface BleProtocol {
  frame(cmd: RingCommand): Uint8Array[];
  ingest(bytes: Uint8Array, state: ProtocolState): { events: RingDecodedEvent[]; state: ProtocolState };
  planSync(cursor: Partial<Record<BioStream, string>>): RingCommand[];   // one page per stream per open + resumable backfill (R10 §4.4)
}
interface BleSession { info(): Promise<{ firmware: string; battery?: number; clockOffsetS: number }>;
  sync(cursor: Partial<Record<BioStream, string>>, onProgress: (p: number) => void, signal: AbortSignal): AsyncIterable<RingDecodedEvent>; close(): Promise<void> }
type RingDecodedEvent =
  | { type: 'sample'; stream: BioStream; t: number; value: number; unit: string; origin: 'history'|'spot'|'live' }
  | { type: 'sleepEpochs'; start: number; epochS: 60; stages: string[]; rawCodes: number[]; firmware: string; complete: boolean }
  | { type: 'activityBucket'; start: number; durS: number; steps: number; distanceM?: number }
  | { type: 'workout'; start: number; end: number; kind: string } | { type: 'vendor'; key: string; t: number; value: number; unit: string };
```
`mapEventsToBatch(events, ctx): BioBatch` is shared with the CloudEvents importer. Order (R10 §6): J-Style 2301 (owner's
code; MTU spike on Chrome Android first; clock offset recorded per sync and flagged on drift), then Colmi from MIT/CC-BY
sources only. No background promises in copy; "close the ring's own app first".

---

## 5. AI layer (`src/ai/`, E9; R8)

### 5.1 Provider wrapper
```ts
type AdapterId = 'openai-chat' | 'openai-responses' | 'anthropic' | 'companion';
interface ProviderPreset { id: string; label: string; adapter: AdapterId; baseUrl: string; authHeader: 'bearer'|'x-api-key'|'none';
  extraHeaders?: Record<string, string>; browserDirect: boolean; keyHelpUrl?: string; defaultModel: string; recommendedModels: string[];
  quirks: { mistralToolIds?: boolean; noToolChoice?: boolean; echoReasoning?: 'reasoning_content'|'reasoning_details'|null;
            thinkTags?: boolean; imageUrlUnsupported?: boolean; maxImages?: number; stripParams?: string[] };
  corsFixText?: string; price?: { inPerM: number; outPerM: number } }
type Part = { type: 'text'; text: string } | { type: 'image'; mime: string; localRef: Id; width: number; height: number };   // base64 built at send time only
interface ChatMessage { role: 'system'|'user'|'assistant'|'tool'; parts: Part[]; toolCalls?: ToolCall[]; toolCallId?: string;
  providerState?: unknown }                 // opaque round-trip (thinking signatures, reasoning_content); echoed only to the same provider+model
interface ToolCall { id: string; name: string; args: Record<string, unknown>; rawArgs: string; parseError?: string }
interface ChatRequest { model: string; messages: ChatMessage[]; tools?: ToolDescriptor[]; toolChoice?: 'auto'|'none';
  effort?: 'low'|'medium'|'high'; maxOutputTokens?: number; responseSchema?: { name: string; schema: object }; temperature?: number;
  cacheHint?: number }                       // index of the last stable message; fields a model cannot take are dropped, never sent blind
type StreamEvent =
  | { type: 'text'; delta: string } | { type: 'reasoning'; delta: string; visible: boolean }
  | { type: 'tool_call_start'; index: number; id: string; name: string } | { type: 'tool_call_delta'; index: number; argsDelta: string }
  | { type: 'tool_call_end'; index: number; call: ToolCall } | { type: 'usage'; usage: Usage }
  | { type: 'done'; stopReason: 'end'|'tool'|'length'|'refusal'|'error' } | { type: 'error'; error: ProviderError };
interface Usage { inputTokens: number; outputTokens: number; cachedInputTokens?: number; reasoningTokens?: number; costUsd?: number; estimated: boolean }
interface Capabilities { tools: boolean; parallelTools: boolean; strictTools: boolean; vision: boolean; maxImages: number;
  jsonSchema: boolean; jsonObject: boolean; reasoning: boolean; reasoningField?: string; streamUsage: boolean;
  contextTokens: number; maxOutput: number; maxTools: number; browserDirect: boolean; verifiedAt: Instant; source: 'catalog'|'selftest'|'preset' }
interface Provider { preset: ProviderPreset;
  listModels(): Promise<Array<{ id: string; label?: string; contextTokens?: number }>>;
  probe(model: string): Promise<Capabilities>;     // catalogue metadata first, else a ~600-token self-test with consent; cached 30 d per (baseUrl, model)
  stream(req: ChatRequest, signal: AbortSignal): AsyncIterable<StreamEvent>;
  countTokens?(req: ChatRequest): Promise<number> }
interface ProviderError { code: 'auth'|'rate_limited'|'quota'|'context_length'|'unsupported_param'|'cors'|'network'|'server'|'refusal'|'usage_limit';
  message: string; retryable: boolean; retryAfterMs?: number }
```
- Presets shipped (data, `src/ai/presets.ts`): openai, anthropic (`anthropic-dangerous-direct-browser-access: true`),
  openrouter, groq, mistral, deepseek, together, gemini-compat, ollama, lmstudio, vllm-custom, custom; nim and opencode-zen
  as `companion` (no browser CORS); `siwc` (Sign in with ChatGPT, `openai-responses` through the Companion with
  `store:false`, full history each turn, `instructions` for the briefing, namespaced tools, "Using ChatGPT plan" label and
  Manage-usage link). Defaults per R8 §4 and its conformance suite (`src/ai/__conformance__`, run manually with real keys;
  results in `src/ai/COMPAT.md`).
- Retries: status-code based (rate-limit headers are not exposed to the browser): 429/5xx → exponential backoff with
  full jitter, base 1 s, cap 30 s, 4 tries; honour readable `retry-after`.
- Degradation (R8 §3.6): no tools → chat-only with structured-extraction logging shown as a proposal; no parallel tools →
  12-step cap; no strict schema → validate and repair once, then "fill the form instead"; no vision → photo button hidden
  or the user's `visionModel` used; models < 15 B ("basic") → read and `log_*` tools only.
- **Token accounting:** one `aiUsage` row per request `{at, preset, model, in, out, cached, costUsd, estimated, conversationId}`;
  Settings › Coach shows today / 7 / 30 days; an optional monthly cap warns at 80 % and blocks at 100 % unless overridden;
  a request estimated above 70 % of `contextTokens` compacts first (§5.4).
- **Keys:** IndexedDB, AES-GCM under a non-extractable device `CryptoKey`; "remember on this device" (default) or "this
  session only"; optional passkey lock (WebAuthn PRF where supported, passphrase fallback). A key is bound to its preset's
  origin: `net.ts` refuses to send it anywhere else, and changing the base URL forces re-entry. Keys never appear in
  exports, logs or transcripts; key sync is opt-in and end-to-end encrypted.

### 5.2 Agent loop (`src/ai/loop/`, tier H)
Turn = `[static briefing (cached)] + [tool block (cached)] + [dynamic briefing] + history segment + user turn`. Each step:
stream → collect tool calls → validate → run `read` tools in parallel → dispatch writes through `CommandBus` with
`actor:{kind:'ai', conversationId, toolCallId}` (staging per §1.4) → return all results in one message. Limits per user
turn: 8 tool steps, 20 tool calls, 5 writes, 1 destructive request, 40k output tokens; then the model is told to summarise
and stop. "Stop" aborts the request; staged proposals stay pending.

### 5.3 Briefing and retrieval contract (`buildBriefing(inputs, budget)`, pure, `src/ai/briefing/`)
- **Static (≈ 1.5k tokens, cached, `BRIEFING_VERSION`):** role and scope (education, not medical advice; never diagnose),
  how Vitals works (engine, plans, ladder, living plan, logs, equivalence, adherence, uncertainty bands), evidence policy
  (mechanism first, grades as wording), units and date rules (dates resolved by code and echoed), confirmation policy,
  the safety relay rule (`safety_blocked` → relay reason and `allowedAlternatives`, never argue around it), "ask before
  assuming" for onboarding, style (short, numbers with bands, one action).
- **Dynamic (≤ 1.5k tokens, rebuilt by code every turn, never by the model):** date, time zone, rollover; profile card
  (age band, sex, height, trend weight, safety mode and restriction text, effective fasting tier, diet pattern and
  exclusions, equipment, supplements taken); active plan card (name, rung, day n of N, today's prescription summary,
  goals with date ranges, drift state, `A_7`/`A_28`, open proposals); last 7 days one line each; biometrics only for
  streams with `coach ≠ 'hidden'` (14-day compact table with baselines, active flags, source per metric); onboarding
  `missingFields[]` from the intake state machine (code decides completeness); quiet-mode flag (no numeric scores or
  calorie talk).
- **Fetched through tools only:** full logs and series (`log_get`, `sim_series`, `bio_daily`, `bio_series`; `detail:
  'summary'|'full'`, cursors, results ≤ 4k tokens with semantic labels plus ids), plan versions and diffs, what-ifs,
  evidence topics, catalogue lookups, past conversation notes (`coach_search_notes`, local BM25 over day summaries).

### 5.4 Conversations and memory
```ts
interface ConversationDoc { title: string; kind: 'coach' | 'onboarding'; createdAt: Instant; archived?: boolean;
  segment: number; preset: string; model: string }
interface MessageDoc { conversationId: Id; segment: number; at: Instant; role: 'user'|'assistant'|'tool'|'note';
  parts: Part[]; toolCalls?: ToolCall[]; toolCallId?: string; usage?: Usage; changeSetIds?: Id[]; pendingIds?: Id[];
  providerState?: unknown /* local only, never synced */ }
interface DaySummary { date: LocalDate; decisions: string[]; logged: string[]; openQuestions: string[]; userPrefsLearned: string[] }
```
One continuous Coach conversation day after day. At 30 turns or 60k tokens, code asks the model (low effort) for
`DaySummary` items (stored as `note` messages) and starts a new segment whose history is the summaries plus the last 6
turns. Old segments stay readable and searchable on every device.

### 5.5 Change review and undo contract
```ts
interface ChangeCard { id: Id; kind: 'applied' | 'proposal' | 'confirm'; actor: Actor; title: string;
  items: Array<{ collection: CollectionId; label: string; before: string | null; after: string | null }>;   // human-readable
  impact?: { goalDates: VersionProposal['goalDates']; metrics: VersionProposal['impact'] };            // plan edits
  source?: { method: EntrySource['method']; confidence?: number; band?: string };                      // AI-estimated logs
  state: 'applied' | 'pending' | 'undone' | 'discarded' | 'expired' | 'stale';
  actions: Array<'undo' | 'edit' | 'apply' | 'adjust' | 'discard' | 'confirm'> }
```
Every AI write yields a card in the conversation and in Settings › Agents › Activity (also for WebMCP/MCP). Applied
cards keep Undo for 24 h, then through `history`; proposals expire after 24 h; `confirm` cards require the typed
confirmation for destructive commands.

### 5.6 Multimodal logging (R8 §6, R4 §4, R11 §6.3)
1. Photo → attachment (downscaled, local) → the vision model extracts, via the strict internal schema
   `report_meal_components {components[{name, localName?, cuisine, cookingMethod, visibleFatCue, portion{amount, unit, grams, gramsLow, gramsHigh}, confidence}], referenceObjectsSeen[], uncertainties[], questions[≤ 2]}`
   (cuisine hint from intake; effort low, medium for thalis).
2. **Code computes nutrients** (`src/catalogue/food/estimate.ts`): food-table match by name and aliases, cooking-fat
   recipe prior scaled by `visibleFatCue`, unmatched items with the model's per-100 g estimate flagged `nutrientSource:'model'`;
   `σ_E² = Σ (e_i·σ_g,i)² + (g_i·σ_e,i)²`, `σ_g = (gramsHigh − gramsLow)/3.3`, table error 10 %; display band =
   max(computed, floor): photo only ±35 % energy / ±50 % protein / ±55 % fat; photo + text ±20/30/30; user grams ±15/20/25;
   weighed or label ±8/10/10; free text ±30/35/45; ×1.3 energy and fat for gravies, curries, fried and restaurant food;
   ×1.5 on the basic tier; single components > 400 g raised 10 % with the upper band widened.
3. "What I saw" card with editable gram chips; confidence ≥ 0.7 and nothing flagged → auto-commit (`aiPhoto`, Undo);
   0.4–0.7 → one chip on the weakest field; < 0.4 → one question. Ask only when the answer moves the meal by > 15 % of
   daily energy or decides credit for a prescribed item. User-corrected grams switch the method to `aiPhotoUserGrams`.
4. Text ("dal, rice and two eggs") → the Coach calls `log_meal` with components and grams (recents, recipes, catalogue
   first); labels → `report_label` transcription; scale or wearable screenshots → `report_reading` → `log_measurement` or
   `bio_manual` with `ai_extracted`. A weight stated in conversation is logged and the forecast re-runs. If the provider
   fails, the text is stored as an unparsed note marked "to review" and counts as unknown, never as zero.
5. Daily intake totals carry summed variances; the estimator treats them as measurements with that variance (§3.5).

### 5.7 Safety rules for AI actions
- The same command validators, safety gates, tiers and warnings apply to the AI as to the person (§1.1); a blocked
  action returns `safety_blocked` with `allowedAlternatives`, which the briefing tells the model to relay.
- The AI cannot change screening answers, acknowledgements, fasting opt-ins, stream policies, sync, keys, agent
  permissions or the quiet-mode default for R1; it cannot resume a safety pause; destructive commands need the person's
  typed confirmation. Automatic changes only lower load.
- Age gate and safety modes apply to the Coach tab (R1 → quiet mode and restricted wording; H → no Coach planning tools).
  Danger warnings are surfaced verbatim. The Coach never claims to be medical advice and suggests a clinician where the
  safety rules say so.
- Privacy: nothing leaves the device except the conversation and tool results sent to the provider the person chose,
  named in Settings with what is sent; no name or email in prompts; biometrics only per `coach` policy; photos are sent
  only in the turn they are attached or on an explicit re-estimate.

---

## 6. Modes and navigation (E13; design D1)

### 6.1 State that decides the mode
```ts
type AppMode = 'planning' | 'living';
const mode = (active: PlanDoc | null, ui: UiPrefs): AppMode =>
  active && ['scheduled', 'active', 'paused'].includes(active.status) && !ui.planningOverride ? 'living' : 'planning';
```
`uiPrefs.planningOverride` is set by "Re-plan" or "Planning tools" and cleared by "Back to Today" or by starting or
ending a plan. While it is set, the shell shows the Planning tabs with a persistent "Plan active · back to Today" banner
so the active plan is never overwritten by accident.

### 6.2 Tabs and routes
| Mode | Tabs (mobile bottom bar / desktop rail) | Also reachable |
|---|---|---|
| Planning | Body · Simulate · Plan · Evidence | Coach (top-bar button; onboarding conversation), Settings |
| Living | **Today** (home) · **Food** · **Train** · **Coach** · **Progress** | Evidence, Settings, "Re-plan" and pause/end in the Today header menu |

| Route | Screen | Notes |
|---|---|---|
| `/today`, `/today/:date` | Today (§3.9) | home in Living mode; past dates are read/backfill views |
| `/food`, `/food/:date` | meals, recipes, groceries, supplements, AI-estimate edits | supplements and groceries live here, not as tabs |
| `/train`, `/train/:date` | sessions, equipment, swaps with equivalence preview | equipment lives here |
| `/coach`, `/coach/:conversationId` | Coach conversation and change cards | in Planning mode the same route, opened from the top bar |
| `/progress`, `/progress/:metric` | trend weight with band, goal-date range, composition, girths, adherence (A_7/A_28, per-block bars), log history with backfill, measurements, biometrics, check-in reports | measurements and biometrics live here |
| `/plan/active`, `/plan/active/versions/:n` | plan detail, versions, diffs, proposals, pause/end | |
| `/body`, `/simulate/...`, `/plan/...` (v0.1 routes) | unchanged Planning screens | `/plan/results` shows the ladder (PLANNER_V2 §9.5) |
| `/onboarding/:section` | intake sections (activity, training, diet, kitchen, supplements, devices) | also driven by the Coach |
| `/settings/{sync,coach,agents,data-sources,devices,data}` | new Settings sections | |
| `/evidence/...`, `/safety`, `/welcome` | unchanged | |

`/` redirects to `/today` in Living mode and to the remembered Planning route (v0.1 `lastRoute`) otherwise. `nav.open`
accepts only `RouteId`s from this table.

### 6.3 Re-plan and start paths
- **Re-plan same goals** (Today menu): `plan.replan` → proposal card → adopt; stays in Living mode.
- **Re-plan from scratch:** "Re-plan" sets `planningOverride` and opens `/plan/goals?from=active` with the active plan's
  goals and limits, start date = effective day (§3.6), and the person's current state (trend weight, anchor) as the
  starting point; results show the ladder; "Replace active plan" dispatches `plan.replace` (ends the old one as
  `replaced`, keeps its history, links `previousPlanId`).
- **Start:** from a ladder rung or a Simulator scenario ("Start this plan"), via the start dialog (date, anchoring note,
  intentions); success clears the override and lands on `/today`.

---

## 7. Companion, MCP and WebMCP (`packages/companion/`, E12)

> Batch 03 changes: see §14.1–§14.4 and §14.8; the Companion is replaced by the Vitals Server (docs/SERVER.md).

### 7.1 Boundary
| Capability | PWA alone | Companion (Node ≥ 22, `npx vitals-companion`) |
|---|---|---|
| Engine, planner, store, commands, BYOK providers with browser CORS, WebMCP registration, file imports, Web Bluetooth | yes | — |
| Sign in with ChatGPT (loopback OAuth, tokens in the OS keychain, `/v1/responses` proxy); NIM and OpenCode Zen proxy | no | yes |
| Sync relay (Evolu `createNodeJsRelay`) + encrypted `/blobs` + `/health`; optionally serving the Vitals build (narrow CSP, no LNA prompt) | no | yes (`vitals-companion sync`, default `127.0.0.1:4870`; owner: `tailscale serve --bg --https=8443 http://127.0.0.1:4870`, port 8443 because Caddy owns :443 on oci-arm; `vitals-companion service --https-port <n>` prints another port; see §13.6) |
| Biometrics receiver (`POST /v1/ingest` canonical batches from Health Auto Export, Shortcuts, Vitals Bridge; optional Aedes MQTT broker for the Lumen app) | no | yes, **device role only** |
| Headless MCP (`vitals-mcp` over stdio; Streamable HTTP at `/mcp`) on synced data, no tab open | no | yes, **device role only** |

**Roles.** *Relay* stores ciphertext only (any server, including a VPS). *Device* is paired like a browser (holds the
owner secret, runs the engine, `src/commands` and a Node `DocStore` that passes the conformance suite) and is required for
ingest and headless MCP. A process may hold both roles.

**Install (E22, 0.2.0).** The CLI is put on the PATH by `vitals-companion install`, which writes a wrapper script
`~/.local/bin/vitals-companion` that pins Node and the checkout (not `pnpm link --global`: Node refuses type stripping
under `node_modules`, and GUI apps without the shell PATH must start the same program). `vitals-companion doctor
[--json] [--server <url>]` checks the setup; `--listen` is accepted as an alias of `--host`. Details: §13.6 and
`docs/COMPANION.md`.

### 7.2 Local HTTP API (one port; every route validates `Origin` and auth)
| Route | Role | Auth | Purpose |
|---|---|---|---|
| `GET /health` | any | none | `{version, roles, ownerCount}`, nothing secret |
| `POST /v1/pair/local` | any | one-time 8-digit code printed in the terminal (or `#pair=` URL fragment opened by the CLI) | returns a local bearer token for that browser origin |
| `GET/PUT /blobs/{ownerIdHash}/{chunkId}` | relay | `Bearer K_auth` (relay stores SHA-256) | create-only (412 on overwrite), ≤ 1 MB, quota 10 GB per owner |
| `wss /sync` | relay | Evolu owner write key | RBSR relay |
| `POST /v1/ai/siwc/login` · `GET /v1/ai/siwc/status` · `POST /v1/ai/siwc/logout` | device or proxy | local bearer | sign-in flow; tokens never reach the page |
| `POST /v1/ai/{preset}/…` | proxy | local bearer | streaming passthrough for `siwc`, `nim`, `opencode-zen`; adds credentials; enforces `store:false` and namespaced tools for `siwc` |
| `POST /v1/ingest` | device | bearer derived from the pairing (shown as a QR for phone apps) or the local bearer | canonical `BioBatch` ≤ 25 MB → the same ingest pipeline (§4.3) |
| `POST /mcp` | device | local bearer; MCP Origin rule | Streamable HTTP MCP (stdio via `vitals-mcp` needs no network) |

Hardening: bind 127.0.0.1 unless `--listen` names an interface (e.g. the tailnet IP); Origin allowlist =
`https://vitals.creative.desi`, the Companion's own origin(s), loopback; CORS answers only those; body-size limits;
rate limits per token; optional `Tailscale-User-Login` allowlist; no secrets in logs. Chrome's Local Network Access
prompt is expected once per origin (Settings explains it first).

### 7.3 Shared tool list
- The Companion imports `src/commands` (tier H), `src/engine`, `src/catalogue` and `src/biometrics/core` from the same
  build; `vitals-mcp` serves `manifest('mcp')` (§1.8) and dispatches with `actor:{kind:'mcp', id:<client name>}`.
  Consequential writes are staged as pending changes, which sync (§2.3), so the person approves them in the app on any
  paired device; destructive commands are never executed for MCP clients.
- **WebMCP (in the PWA):** behind Settings › Agents (default **off** until the owner decides), feature-detected through
  the bundled polyfill (`@mcp-b/global`), `registerTool` for every `webmcp`-surface command; executes through `dispatch`
  with `actor:{kind:'webmcp'}`; a top-bar indicator "An agent is using Vitals" with a stop switch while a tool ran in the
  last 60 s. The local relay route (`@mcp-b/webmcp-local-relay --widget-origin https://vitals.creative.desi`) is
  documented, not bundled. Origin-trial token and any isolation header are added to `netlify.toml` by E12 after
  verification.
- Docs: `packages/companion/README.md` gives config snippets for Claude Desktop/Code, Codex, Hermes and OpenClaw (all stdio).

---

## 8. Catalogues (`src/catalogue/`, pure data + functions, E8; R3, R4, R5)

### 8.1 Exercises and equipment
The storage format is the R3 seed schema (`R3-catalogue-seed.json`, `schemaVersion` R3-0.1: 170 exercises, 64 equipment
items); PLANNER_V2 §8.1 `ExerciseRecord` / `EquipmentItem` are projections of it. Where the two vocabularies differ
(`loadType`, `intensityScale`, `defaultDose`, `priceTier`, `space`) the seed is canonical and E8 aligns the V2 types.
```ts
interface ExerciseDef {               // R3 §2.1
  id: string; name: string; aliases: string[]; tradition: 'gym'|'home'|'bodyweight'|'outdoor'|'kettlebell'|'bands'|'indian'|'yoga'|'mobility'|'odd-object'|'cardio';
  equipmentAnyOf: string[][];         // OR of AND-sets; [[]] = no equipment
  pattern: MovementPattern;           // R3 vocabulary (squat … neck)
  regions: Partial<Record<TrainingRegion, 0.5 | 1>>;   // engine regions only; direct 1, indirect 0.5
  loadType: 'external'|'bodyweight'|'odd-object'|'ballistic'|'isometric'|'cardio'|'mobility';
  intensityScale: 'pct1RM'|'repsToFailure'|'kgRpe'|'holdSec'|'rpe'|'speed'|'power'|'met';   // decides which log fields the UI asks for
  volumeUnit: 'setsReps'|'holds'|'timeOrReps'|'intervals'|'minutes'|'rounds'|'distanceOrTime';
  defaultDose: Record<string, number>; secPerRep: number;
  energy: { equation: 'met'|'ludlowWalk'|'acsmWalk'|'acsmRun'|'acsmStep'|'cyclePower'|'pandolf'; metGross: number; metRange: [number, number]; compendiumCode?: string; metSource: string };
  cardioModality: CardioModality | null; hybridCardioShare: number; mobilityTargets: string[];
  skill: 1|2|3|4|5; injuryRisk: 1|2|3|4|5; contraTags: string[];
  mechanism: string; evidence: EvidenceLabel; sources: string[];
  origin: 'seed' | 'ai-resolved' | 'user';      // ai-resolved: certainty D, a MappingDef with robust weight ≥ 0.25 (R5)
}
interface EquipmentDef { id: string; name: string; aliases: string[]; category: string; ownership: 'owned'|'access';
  loadRangeKg: [number, number] | null; adjustable: boolean; enablesPatterns: MovementPattern[]; priceTier: 0|1|2|3|4; space: 'none'|'tiny'|'small'|'medium'|'large'; note: string; sources: string[] }
interface PerformedExercise {         // R3 §2.3: what the person or the AI logs
  exerciseId?: string; freeText?: string; sets?: Array<{ reps?: number; holdSec?: number; workSec?: number; loadKg?: number; rir?: number; rpe?: number }>;
  restSec?: number; minutes?: number; speedKmh?: number; powerW?: number; gradePct?: number; loadCarriedKg?: number; equipmentIds?: string[] }
```
### 8.2 Stimulus mapping to engine inputs (R3 §3–§4)
- `resolveStimulus(performed | prescribed, profile): StimulusVector` (PLANNER_V2 §8.6 type). Effective sets per region =
  sets × region weight × load factor; bodyweight, band and odd-object load via reps to failure `L_eq = 100/(1 + R_f/30)`,
  `R_f = reps + RIR`, then the engine's own `f_load`/`f_RIR`; ballistic sets count × 0.5 (`ballisticSetFactor`, grade D);
  energy = gross MET × minutes unless an engine equation applies (Ludlow, ACSM, cycle watts, Pandolf).
- `toSessions(performed[], startH): ExerciseSession[]`: resistance work → `ResistanceSession.setsByRegion`, RIR, %1RM;
  hybrid items (mudgar, gada, kettlebell swing, kushti-cadence baithak, Surya Namaskar) split by `hybridCardioShare` into a
  `CardioSession` and a `ResistanceSession`, both booked at the item's MET (needs CR-E2).
- Unknown exercises or equipment ("a wooden wheel", "sandbag curls") are resolved by the AI through
  `catalogue.addExercise` into an `ExerciseDef` with `origin:'ai-resolved'` and a `MappingDef` (§8.6); they are never rejected.
- Session composition, envelopes, availability scoring and shopping lists are PLANNER_V2 §8.2–§8.5 (E8 implements).

### 8.3 Foods, recipes, meal plans (R4)
```ts
interface FoodRecord {                // bundled table, ~2,000 foods, lazy chunk ≈ 155 KB gz + aliases
  id: string; name: string; aliases: string[]; group: string; tags: string[];   // diet, allergen, Jain-root, vrat-allowed, onion-garlic, animal type (hand-curated hard filters)
  source: 'usda-fdc' | 'ifct2017' | 'literature' | 'indb-qa' | 'user' | 'model'; verified: boolean;
  state: 'raw'|'cooked'|'as-eaten'; yieldRawToCooked?: number; edibleFraction?: number;
  portions: Array<{ label: string; g: number }>;                                 // katori 115/155/200/360 mL, roti 35–40 g, tsp 5 g …
  per100g: { energyKcal: number; proteinG: number; fatG: number; carbG: number; fibreG?: number; sugarsG?: number; satFatG?: number;
             mufaG?: number; pufaG?: number; epaG?: number; dhaG?: number; cholesterolMg?: number; alcoholG?: number; caffeineMg?: number;
             sodiumMg?: number; potassiumMg?: number; calciumMg?: number; ironMg?: number; magnesiumMg?: number; zincMg?: number;
             b12Ug?: number; folateUg?: number; vitDUg?: number; vitCMg?: number; vitAUg?: number; leucineG?: number };
  gi?: number; nova?: 1|2|3|4; proteinSource?: ProteinSource; evidence?: EvidenceLabel }
interface RecipeDoc { title: string; cuisine: string; servings: number; ingredients: Array<{ foodId: string; gramsRaw: number; role: string; flexible: boolean; unitHint?: string }>;
  steps: string[]; activeMin: number; passiveMin: number; equipment: string[]; generatedBy: 'ai' | 'user'; perServing: NutrientEstimate }
interface MealPlanDoc { date: LocalDate; meals: Array<{ slot: string; recipeId?: Id; familyStyle: boolean; fit: PortionFitResult }>; groceries: Array<{ foodId: string; grams: number }> }
interface PortionFitResult { grams: Record<string, number>; totals: Record<'energyKcal'|'proteinG'|'carbG'|'fatG'|'fibreG', number>;
  withinTolerance: boolean; deltas: Record<string, number>; binding: string[] }
```
- `food.planDay` validates the model's `propose_day_meals` against `food.candidates` (hard filters: allergies, diet, Jain
  and day rules, equipment, medical diets), runs the deterministic portion-fit solver (R4 §3.4: weighted least squares
  toward targets with a proximity term, bounds 0.5–1.6× of the model's grams, oil ≤ 15 g per meal, ceilings as
  constraints; then household-unit discretisation) and checks the daily tolerances (energy ±5 %, min ±75 kcal; protein
  −5 %/+20 %; carbohydrate ±10 % or target +5 g on low-carbohydrate days; fat ±15 %; fibre ≥ −10 %; saturated fat ≤ cap).
  Out of tolerance → `repairHints` for at most two model rounds, then "closest achievable" with the deviation stated. The
  model never states nutrient numbers; the app computes every total.
- Logged meals map to engine inputs per §3.4. IFCT 2017 is used only with NIN's written permission; until then Indian
  raw ingredients missing from USDA come from flagged literature values (`verified:false`).

### 8.4 Equivalence scoring
`stimulusEquivalence(prescribed, performed, sensitivities)` (PLANNER_V2 §8.6) is the credit used by adherence (§3.7)
and swaps. R3 §5 supplies the display layer: component scores `S_hyp`, `S_str` (pattern/implement factor 1.0/0.8/0.5/0.2),
`S_card` (MEM and high-intensity minutes), `S_kcal`, `S_mob` with the plan's intent vector; labels "counts as today's …"
(≥ 0.90), partial with one shortfall fix computed from the logged exercise ("add 1 set", "8 more minutes") (0.60–0.90),
"different stimulus, credited to …" (< 0.60). The engine always simulates the logged stimulus; equivalence only scores it.
Foods are credited by nutrients (§3.7), never by dish identity.

### 8.5 Supplements (R4 §5; `R4-supplements-seed.json`: 23 actionable entries + 12 "no expected benefit for your goals")
```ts
interface SupplementDef { id: string; name: string; aliases: string[]; category: string;
  status: 'offer'|'offer_if_risk'|'situational'|'only_if_diagnosed'|'food_first_rule'|'info';
  goals: string[]; mechanism: string; grades: Record<string, EvidenceGrade>;   // per outcome; never gates
  dose: { amount: number; unit: string; per: string; range: [number, number]; rule?: string }; timing: string; form?: string;
  foodFirstAlternative?: string; interactions: string[]; contraindications: string[];   // keys = safety flags; a match hides the card ("ask your doctor")
  cautions: string[]; upperLimit: string | null; engineHooks: string[];
  dietCompat: { vegetarian: boolean; vegan: boolean; jain: boolean; halal: string | boolean; containsAllergens: string[] }; sources: string[]; unverified: string[] }
```
Opt-in only, after the "food first or supplements?" question. Engine hooks: creatine → `substances.creatineG`
(+ loading); caffeine → `substances.caffeine`; whey/plant protein → meal protein with `proteinSource`; electrolytes →
`hydration` (fasts); omega-3 → `fatTypes.omega3G`; psyllium → fibre and viscous share; exogenous ketones →
`substances.exogenousKetones`; vitamin D, B12, iodine and similar → `infoOnly` (shown, not simulated). India advisories
(B12 for vegetarians, iodine on rock-salt days, third-party-tested products) are shown with the cards.

### 8.6 Evidence labels (R5; every parameter, intervention and catalogue item)
```ts
interface EvidenceLabel {
  mechanism: { status: MechanismStatus /* 'modelled'|'mapped'|'infoOnly' (PLANNER_V2 §6.1); M0 items are never catalogued */;
               pathway: string; engineNodes: string[] };       // per (item, outcome) pair
  certainty: EvidenceGrade;                                      // A–D; for mapped items computed: anchor − indirectness (floor D)
  indirectness?: { population: 0|1|2; intervention: 0|1|2; outcome: 0|1|2 };
  refs: Array<{ topicSlug: string; refIds: string[] }>;          // item-5 clean user-facing references
}
interface MappingDef { itemId: string; outcomes: string[]; anchor: { kind: 'mechanism'|'item'; id: string }; pathway: string;
  inputs: Record<string, { value: number; low: number; high: number }>; similarity: { dims: Record<string, 0|0.5|1>; S: number };
  tau: { median: number; sigmaLog: number /* 0.10 + 0.50·(1 − S) */; wRobust: number /* 0.10–0.25; ≥ 0.25 for ai */; tauLo: number };
  indirectness: { population: 0|1|2; intervention: 0|1|2; outcome: 0|1|2 }; directEvidence?: { refs: string[]; grade: EvidenceGrade; sign: 1|-1|0 };
  certainty: EvidenceGrade; wouldSettle: string; author: 'dossier'|'ai'|'user' }
```
Rules: an item enters the simulator and planner iff `status` is `modelled` or `mapped`; certainty only sets the band floor
(relative σ 5/10/20/35 % for A/B/C/D, R5 §2.3) and the wording ("does", "probably", "may", "might, by mechanism"); it never
orders, prunes, weights or excludes. Exclusion needs direct null or adverse evidence for that outcome, or a safety rule.

---

## 9. Cross-cutting

### 9.1 CSP and headers (`netlify.toml`; E3 applies with E4)
```
Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:;
  style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:;
  connect-src 'self' https: wss: http://127.0.0.1:* ws://127.0.0.1:* http://localhost:* ws://localhost:*;
  object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
Permissions-Policy: camera=(), microphone=(), geolocation=(), bluetooth=(self)
```
- `connect-src` is R7 option B (user-chosen relays and AI base URLs make a fixed list impossible on a static host).
  Compensating control: `src/net/net.ts` is the only caller of `fetch`, `WebSocket` and `EventSource` (lint), and checks
  every target against a user-managed allowlist (sync endpoint, provider preset origins, Companion); provider keys are
  bound to their origin. Evolu's own socket receives only a URL that passed the same check.
- `'wasm-unsafe-eval'` is required by Evolu's SQLite-WASM and by sql.js imports; it does not allow JavaScript `eval`.
  Trusted Types (`require-trusted-types-for 'script'`) is added if the build passes with it.
- Photos use `<input type="file" accept="image/*" capture>` (no camera permission); voice uses OS dictation in v0.2.
- The Companion-served build ships a narrow CSP listing its exact origins.

### 9.2 Workers and gateways
| Thread | Hosts |
|---|---|
| main | React, `CommandBus` and executors (IO through gateways), Zustand projections, AI loop (streaming through `net.ts`) |
| `engine.worker` (×1 + simulator run/preview workers as v0.1) | `simulate`, ensembles, `assimilate`/`forecast` (§3.5), `benefitRetained` batches |
| planner coordinator + pool (v0.1 files, PLANNER_V2 §9) | `planLadder`, `replan`, `computePlanSensitivities`, tier X checkpoints |
| `biometrics.worker` | importers, chunk encoding, daily resolution, scoring and rescoring |
| store worker (Evolu) / IndexedDB | documents; blob cache |
| service worker (E3) | precache incl. WASM; Web Share Target for files; no sync in v1 |

```ts
interface EngineGateway {           // browser: Comlink to workers; Node (Companion): direct calls
  simulate(profile: PersonProfile, schedule: Schedule, opts?: RunOptions): Promise<SimulationResult>;
  assimilate(input: AssimilationInput): Promise<AssimilationResult>;        // §3.5
  replan(req: ReplanRequest, signal?: AbortSignal): Promise<ReplanResult>;   // PLANNER_V2 §9.2
  planLadder(req: PlannerRequestV2, opts?: PlanLadderOptions): Promise<PlannerResultV2>;
  sensitivities(plan: ActivePlanRecord, state: ConfirmedState): Promise<PlanSensitivities>;
}
```

### 9.3 Lint rules (`eslint.config.js`, E4)
- **Tier P** (`src/engine/**`, `src/catalogue/**`, `src/biometrics/core/**`, `src/ai/briefing/**`, `src/commands/schema/**`):
  the existing engine rule extended to these paths, plus `no-restricted-imports` of `@/net`, `@/sync`, `@/commands`
  (except `schema`); `no-restricted-globals`: `window`, `document`, `localStorage`, `navigator`, `indexedDB`, `fetch`,
  `WebSocket`; `no-restricted-properties`: `Date.now`, `Math.random`, `performance.now`; `no-restricted-syntax`:
  `new Date()` without arguments. Hashing uses a pure SHA-256 module, not `crypto.subtle`.
- **Tier H** (`src/commands/**`, `src/sync/**`, `src/ai/**` except `ui`, `src/biometrics/{importers,ble,ingest}/**`,
  `src/state/docstore/core/**`, `packages/companion/**`): no `react*`, `zustand`, `@/features`, `@/app`, `@/components`;
  no `window`, `document`, `localStorage`.
- **Everywhere:** `fetch`, `WebSocket`, `EventSource` only in `src/net/**` (and `packages/companion/**` through its own
  `net.ts`); `@/state/internal/*` only from `src/commands/**`; `DocStore.transact` only from `src/commands/**`,
  `src/sync/**`, `src/state/docstore/**` and registered derive modules; `mintConfirmation` only from `src/app/confirm/**`
  and UI components; `planRegimes` banned (PLANNER_V2 §9.6).

### 9.4 Testing strategy
| Layer | Tests (all in `pnpm test` unless marked) |
|---|---|
| Commands | schema ↔ interface type tests; one fixture per command; parity test §1.10; idempotency replay; undo/redo round trips; confirmation-token misuse; safety-gate equivalence with the UI paths |
| Store | conformance suite run against `IdbDocStore`, the Evolu adapter and the Companion's Node store; migration fixtures for every v0.1 store version and `lumen.*`; export v1/v2 round trips; quota handling |
| Sync | property test: random interleavings of writes on 3 simulated devices converge to identical documents per strategy; join merge/replace; rotate and rekey flows; blob create-only and AAD tamper rejection; spike scripts (R7 §7.3) as `pnpm spike:sync` (manual) |
| Living plan | `anchorSchedule` cases; synthetic truth runs (engine with perturbed parameters → noisy weigh-ins and partial logs → filter and anchors recover trend within 2 SD and δ within its SE); adherence golden days (owner's 100/80/100 example, unknown items, coverage cut-offs); drift hysteresis; pause/resume shifts; determinism across devices |
| Biometrics | importer golden files (Apple, Health Auto Export, CloudEvents, canonical, HC zip, Gadgetbridge); chunk encode/decode; source priority; score parity with R10 tolerances (local-only fixtures via env var); NightSignal transitions; rescoring version coexistence; BLE protocol golden vectors from the Kotlin tests |
| AI | adapters against recorded SSE fixtures per preset (no network in CI); degradation matrix; briefing token budgets and determinism; photo pipeline band arithmetic; agent-loop limits; conformance suite with real keys (manual, `src/ai/__conformance__`) |
| Companion | Origin and auth rejection, CORS, body limits, blob quota, SIWC token never returned to the page, MCP `tools/list` equals `manifest('mcp')` |
| UI | RTL screen suites in strict store mode (no write outside a command); Living/Planning mode switch; Today at 375 px and 1440 px in both themes (QA) |

### 9.5 Performance budgets (mid-range phone / desktop)
| Path | Budget |
|---|---|
| Store ready + singleton hydration (warm cache) | ≤ 400 + 120 ms / ≤ 150 + 50 ms; cold first run with WASM fetch ≤ 2.5 s on 4G |
| `dispatch` synchronous part (validation, policy, ChangeSet) | ≤ 2 ms p95; single-document commit ≤ 15 ms p95 |
| Today view from store | ≤ 100 ms |
| Daily assimilation (replay ≤ 7 days from the anchor + filter) | ≤ 150 ms / ≤ 40 ms; weekly check-in with forecast ensemble ≤ 3 s / ≤ 0.8 s |
| Adherence for one day (fast credit forms) | ≤ 20 ms; with `benefitRetained` ≤ 1 s, in the worker |
| Rescoring one day of data, all scores | ≤ 200 ms; 90-day backfill ≤ 20 s, background, interruptible |
| Apple Health 1 GB `export.zip` import | streaming, ≤ 300 MB memory, ≤ 3 min desktop |
| Sync: no-change reconcile / cold pair of the R7 test dataset | ≤ 300 ms LAN / ≤ 60 s over Tailscale |
| Coach: first token after send (excluding provider latency) | ≤ 150 ms; briefing build ≤ 20 ms |
| Bundle | initial JS +≤ 60 KB gz (commands, store binding, Living shell); Evolu, AI, biometrics, catalogues, food table lazy |

---

## 10. Engine and planner contract requests (engine owner; filed by E5/E8 against MODEL_SPEC §11)
| Id | Request | Needed by |
|---|---|---|
| CR-L1 | Snapshot at any day: `RunOptions.captureSnapshotAt?: number[]` → `result.snapshots: Record<number, EngineSnapshot>`; `initialSnapshot` accepted with `RunOptions.startDay`; the validity key excludes horizon and series mask | E5 anchors, PLANNER_V2 `ConfirmedState` |
| CR-L2 | `RunOptions.anchors?: Array<{ day: number; tissueMassKg: number; split?: 'engine' | { fatFrac: number } }>`: at the start of `day` set tissue mass, allocating the residual by the composition module's own partition (or the given fat fraction for DXA), re-anchoring water references | E5 §3.5 |
| CR-L3 | `RunOptions.intakeOffsetKcal?: Array<{ fromDay: number; kcal: number }>`: absorbed energy offset at the day's macro mix, excluded from intake echoes and appetite inputs | E5, PLANNER_V2 §7.1 |
| CR-E1 | `HabitProfile.activity` (R1 §3.5) and `ResolvedProfile.{nonStepActivityKcal, pal0, tdee0SigmaKcal, tdee0Drivers}` folded into NEAT0 (R-MAINT unchanged) | E7, `profile.explainMaintenance` |
| CR-E2 | `ResistanceSession.met?: number` for hybrid items (R3 §3.3) | E8 `toSessions` |
| CR-E3 | `ParamDef` gains `mechanism`, `indirectness`, `bounds`, `personal` and the registry `effectiveBand()` (R5 §5); planner removes the grade term from `priorScore` | E8 with E6 |

---

## 11. Decisions needed from research (still provisional)
| # | Provisional choice in this spec | Settled by |
|---|---|---|
| 1 | Evolu as the store and sync engine; `IdbDocStore` until then; PouchDB fallback (§2.1) | R7 §7.3 two-week spike (E11) |
| 2 | Evolu row-size limit ≥ 200 KB for scenarios and plan versions; otherwise large documents go through the blob path | R7 spike, unverified claim |
| 3 | `'wasm-unsafe-eval'` added to `script-src` (§9.1) | owner sign-off (follows from R7's engine and R4/wearables SQLite imports) |
| 4 | Raw chunks: phones keep 30 days with sync on; endpoint keeps all; daily chunks split hourly above 256 KB (§4.2) | R7 Q3 + R9 §5 (owner) |
| 5 | Filter constants `σ_rel` 0.5 %, `q_w` 0.03, `q_r` 0.005, δ prior SD 150, clamps (§3.5) | R11 §8 Q1 (population data); weekday/menstrual offsets R11 Q2 |
| 6 | `benefitRetained` vs fast credit forms per day, ≤ 12 runs (§3.7) | R11 §8 Q3 with PLANNER_V2 §8.6 benchmark (E5/E6) |
| 7 | Quiet mode on by default in safety mode R1 (§3.7) | R11 §8 Q4 (owner, safety) |
| 8 | AI-estimate confidence thresholds 0.7/0.4 and calibration from edits (§5.6) | R11 §8 Q5 (needs logged data) |
| 9 | δ treated as one intake-plus-expenditure term; biometrics not yet used to split it | R11 §8 Q6 |
| 10 | Equivalence display bands 0.90/0.60 (R3) next to PLANNER_V2 parity ≥ 0.95; seed vocabulary canonical over V2 `ExerciseRecord` (§8.1, §8.4) | E8 with A2 (one reconciled table) |
| 11 | `ResistanceSession.met` (CR-E2) rather than the circuit-style MET | R3 Q1 (engine owner) |
| 12 | USDA-based food table; IFCT 2017 only with written permission; flagged literature values for missing Indian ingredients; frying-oil absorption and yield factors | R4 §2 (owner e-mails NIN); R4 unverified list |
| 13 | Fast-permission plan effects (no new fast > 24 h on illness red, HRV below, sleep debt > 1.5 h) | R9 Q3 + dossier-20 safety review |
| 14 | Tier C bands and NightSignal thresholds for cheap rings | R9 Q1 (owner's 14-night validation → `device_profile`) |
| 15 | Readiness v1 = `lumen-recovery-v4` parity incl. nutrition; HRV baseline 60 d with an Android-parity mode | R9 Q2, R10 Q3/Q5 (owner) |
| 16 | The V0789 passcode is built in (§4.6); unverified whether one value serves every V0789 ring or is per account (only one ring tested); Chrome Android MTU unverified | R10 Q1 + MTU spike (E10); plan 04 R19 |
| 17 | Core tool group (≈ 28), per-provider `maxTools`, recommended models | R8 §4.3 conformance with real keys (E9) |
| 18 | "Auto-apply small edits" off; spend cap warn-only; optional separate `visionModel` | R8 Q1–Q3 (owner) |
| 19 | WebMCP off by default; MCP consequential writes staged; pending-change approval across devices (§7.3) | sign-in research Q7 (owner); E12 verification of origin trial |
| 20 | Sign in with ChatGPT via the Companion requires open-sourcing Vitals | sign-in research Q1–Q2 (owner, OpenAI) |
| 21 | Tab names Today / Food / Train / Coach / Progress | PLAN item 10, R11 Q7 (owner) |

---

## 12. Work-package summary (what each E-package builds from this spec)
| WP | Builds | Sections |
|---|---|---|
| **E4** | `src/commands` (registry, dispatcher, pipeline, ChangeSets, undo, idempotency, jobs, confirmation tokens, all §1.9 definitions and fixtures, parity test, tool manifest core + OpenAI/Anthropic adapters as pure functions); `src/state/docstore` (`DocStore`, `IdbDocStore`, conformance suite, `bindDocs`, collections and envelopes, migration from localStorage, export v2/import/erase); `src/net/net.ts`; `SyncAdapter`/`BlobStore`/`Encryptor` interfaces; lint rules §9.3; every v0.1 store moved behind commands | §0, §1, §2.1–2.5, §2.7–2.8, §9.1, §9.3 |
| **E5** | `src/engine/living` (anchoring, calendar, pause/resume, `toLoggedDay`, filter, δ, anchors, forecast, adherence, revealed adherence, drift, `TodayView`); plan/log/day/today commands' executors; `plans`, `planVersions`, `dailyLogs`, `dayStatus`, `measurements`, `anchors` collections; CR-L1–L3 with the engine owner | §3, §10 |
| **E6** | PLANNER_V2 (not this spec), plus the interfaces E5 calls: `replan`, `computePlanSensitivities`, `benefitRetained`, `projectRealistic`, `toActivePlan` | §3.6–3.7, §9.2 |
| **E7** | intake sections and `IntakeDoc` (R1 activity, training profile, R4 diet and kitchen, supplements stance, devices), `intake.*` commands, maintenance explanation, onboarding `missingFields[]` state machine | §2.3.1, §5.3 |
| **E8** | `src/catalogue` (seeds, `ExerciseDef`/`EquipmentDef`/`FoodRecord`/`SupplementDef`, `resolveStimulus`, `toSessions`, equivalence display layer, food table chunk, meal-estimate arithmetic, portion-fit solver, `food.*`/`catalogue.*`/`train.*` executors, `EvidenceLabel`/`MappingDef`, CR-E2, CR-E3) | §8, §5.6, §10 |
| **E9** | `src/ai` (presets, three adapters + Companion adapter, probing, degradation, agent loop, briefing, memory and summaries, multimodal pipeline, key storage, usage ledger), Coach tab and change cards, AI safety rules, tool adapters wired to the core group | §1.4, §1.8, §5 |
| **E10** | `src/biometrics` (canonical schema and validation, chunks, ingest pipeline, Phase A importers, source priority, scores and rescoring, decision log, stream policies, BLE registry with the 2301 driver then Colmi), `bio.*` executors, Settings › Data sources and Devices | §4 |
| **E11** | Evolu spike and adapter (fallback PouchDB), blob client, key schedule, pairing (words, QR, scan), join merge/replace, revoke/rotate/rekey, status pill, Settings › Sync, `copyStore` switch-over, Companion relay wiring with E12 | §2.1, §2.6, §2.8 |
| **E12** | `packages/companion` (`sync` relay + blobs + health + optional static app, SIWC login and proxy, NIM/Zen proxy, `/v1/ingest` with optional MQTT, `vitals-mcp` stdio + Streamable HTTP on the shared registry, Node `DocStore`), WebMCP registration and Agents settings, origin-trial verification | §7, §1.8 |
| **E13** | mode switch, Living shell and routes, Today, Food, Train, Progress screens (Coach screen from E9), check-in card, lapse and minimal modes, quiet mode, drift presentation, re-plan and start paths, ladder start dialog | §3.9, §6 |
| **E14** | figure and visceral view (items 2–4); consumes `profile.*` commands only | §1.1 |

Plan 03 packages (E25 server core, E26 server AI and agents, E27 website → server, E28 one source of truth) build from §14.


---

## 13. Batch 02 contracts (plan 02; referred to in `plan/02-next/IMPLEMENTATION.md` as "§12 Batch 02 contracts")

**Status:** normative for v0.3.0 (package A3, 2026-10-02). It is numbered 13 because §12 above is the v0.2 package
summary; briefs that say "SUITE_SPEC §12 Batch 02" mean this section. Planner-side contracts (rung stability, the
dedicated Easy search, same-scale effort bars, the four-level audit) are in `docs/PLANNER_V2_SPEC.md` §12. Owners are the
plan-02 packages E16–E22. Store naming: a document is `<collection>/<key>`; the names `vitals.<x>/N` below are the wire
schema ids of new collections (`_schema: N`), as with `vitals.biometrics/1`.

**New command domains** (add to `CommandDomain`): `kitchen`, `pantry`, `markers`. Every new command ships a fixture,
appears in `docs/COMMANDS.md` and passes the parity test (§1.10).

### 13.1 Intake flow v3 (items 1, 2, 4) · owner **E16**

**Found in the code (2026-10-02), the path the owner hit.** On the maintenance card (`components/Maintenance.tsx:111`,
end of chapter A in `IntakePage.tsx:233-248` and on Body via `BodyIntake.tsx:111` `MaintenanceFace`), "Add a measurement"
and "Correct it" open `CorrectPanel` (`Maintenance.tsx:195`, a `ResponsivePanel` sheet) with three paths: (1) a steps
slider and a work-class bank with a live what-if (`resolveActivity(next, act.base)`), saved by **"Keep these"**; (2) a
measured resting metabolism stepper + "how" (calorimetry | clinic) saved by `saveMeasuredRmr` →
`profile.patch {labs:{measuredRmrKcal}}` (`persist.ts:79`; the "how" is never stored); (3) an explanation only.
"Keep these" does **not** navigate: it calls `applyWhatIf` (`chapters/activity.ts:407`), which writes `work='yes'` (when it
was no or unknown) and `job=<class>` as answered turns, then `saveChapter('activity')` → `intake.answer`. Because `work`
is now `yes`, the chapter's follow-ups (`workTime`, `commute`, `commuteMin`) become visible and unanswered, so the next
render of the chapter (`activeQuestion`, `flow.ts:167`) opens "How many days a week, and about how long?" and "How do you
get there?" with no context and no Back. There is no Back per question (only "ask me later" and, on a reopened receipt,
Cancel); `FlowState.reopened` is not persisted; `ctx.stepDevice` (from the devices chapter) changes what is asked, so
leaving and returning can show a different question. No measured-maintenance field exists in `ActivityIntake`.

**Removal plan.** Delete `CorrectPanel`, `applyWhatIf`, `CORRECT` copy, the "Add a measurement" fix key route to the
panel and the `onKeep`/`onMeasured` props; the maintenance card becomes a result card (band, drivers, biggest unknown)
whose fix keys jump to a **question** (`Change` on that question in the answered list, or the measured-energy question
below). The steps/work what-if survives only as the answered list's Change on `stepsKnown`/`job`.

```ts
type QuestionId = string;                                  // stable, `${chapter}.${name}`, e.g. 'activity.commute'
type Answers = Readonly<Record<QuestionId, unknown>>;
type ChapterIdV3 = 'activity' | 'training' | 'food' | 'markers' | 'devices';
interface QuestionV3 {
  id: QuestionId; chapter: ChapterIdV3; section: IntakeSectionId | 'markers';
  order: number;                                           // fixed position in the chapter graph; unique per chapter
  parent?: QuestionId;                                     // shown directly under its parent in the answered list
  condition?: (a: Answers) => boolean;                     // PURE: reads answers only (no FlowContext, no clock, no store)
  text: string;                                            // self-contained: restates the context (no-vagueness test)
  contextLine?: (a: Answers) => string | null;             // the parent answer it depends on, shown above the text
  answer: AnswerSpec; askLater: boolean;                   // false only for gating questions (markers.has, food rules)
  skipText: string; short: string; why?: string; anchor?: string;
}
type AnswerSpec =
  | { kind: 'single'; options: AnswerOption[] } | { kind: 'multi'; options: AnswerOption[]; ranked?: boolean; otherLabel?: string }
  | { kind: 'number'; min: number; max: number; step: number; unit?: string }
  | { kind: 'measure'; units: string[]; methods: string[] } | { kind: 'custom'; widget: string };
interface ChapterStateV3 {
  answered: Array<{ id: QuestionId; status: 'answered' | 'later'; value?: unknown; at: Instant }>;   // in graph order
  current: QuestionId | null;                              // = firstOpen(graph, answers); persisted for audit only
}
```
- **Order and state.** `visible(graph, a)` = questions in `order` whose `condition(a)` holds (a child is visible only if
  its parent is visible and answered). `firstOpen(graph, a)` = the first visible question with no entry. The screen
  always shows `firstOpen` unless a Change is open. Locale and gentle-mode differences become **answers** written
  before the chapter (`meta.india`, `meta.gentle`, `devices.stepDevice` copied in at chapter entry), never hidden context.
- **Controls.** *Next* commits the value (`intake.answer`). *Ask me later* records `status:'later'` (default applies,
  value dropped). *Back* moves to the previous visible question in order and opens it in Change mode without erasing
  it. *Change* (on any answered row) re-asks **only that question**; on commit, children whose `condition` became false
  stay stored and show "not used"; children that newly apply become open and are asked next, directly under the parent.
- **Persisted.** The `turns` blob is kept (`values`, `status` with `'skipped'` read as `'later'`), plus `order` of
  commits; the open Change is UI state.
- **Progress** = answered (incl. later) ÷ visible questions of the chapter, per question (children count);
  the header shows the four (five with markers) chapter segments **centred on their own row under the title below
  768 px, right-aligned on the title row from 768 px** (item 4).
- **Invariant (determinism).** For any answers `a`, `firstOpen(graph, a)` is the same on every render, after leave and
  return, reload, another device or the Body page; it depends on nothing but `a`.

**Measured maintenance (item 1) as ordinary questions** (end of chapter A, after the result card):
| id | Text | Answer | Condition |
|---|---|---|---|
| `activity.measuredEver` | "Have you ever had your maintenance calories or your resting energy measured?" | single: no · yes, resting energy (RMR) · yes, maintenance (TDEE) | always; ask later allowed |
| `activity.measured` | "What was the measured value, and how was it measured?" | measure: value; unit kcal/day · kJ/day; method `metabolic_cart` (indirect calorimetry) · `dxa_based` · `smart_scale` · `calculator` · `tracking` (weeks of logged intake at stable weight); date | `measuredEver ≠ no` |
Binding: RMR with method `metabolic_cart` → `profile.labs.measuredRmrKcal` exactly as `saveMeasuredRmr` did (so
`resolveProfile` sets `rmrRoute='measured'` and `resolveActivity` reads it through `ActivityBase.rmr0Kcal`). Every other
method is stored (`intake.activity.measured = {kind, value, unit, method, date}`) and shown on the card but **not** used
as RMR0 (`dxa_based`, `smart_scale`, `calculator` are estimates, not measurements); a measured TDEE (`tracking` or
metabolic ward) becomes an observation the living-plan filter uses at plan start (`measurements` entry `metric:
'tdee'`), never a replacement for the engine estimate. The answer appears in the answered list with Change. The Body
page Maintenance panel renders these two questions **inline** from the same graph (same component, no sheet).

**Wording audit (every existing question; ✗ = fails "would a stranger know what is asked without the previous screen?").**
| Id | Current text | Verdict / v3 text |
|---|---|---|
| work | Do you work or study outside the home most weeks? | ✓ |
| job | On a work day, what are you mostly doing? | ✓ (context line: "You work or study outside the home") |
| workTime | How many days a week, and about how long? | ✗ "How many days a week do you go to work or study, and how many hours is a usual day there?" |
| commute | How do you get there? | ✗ "How do you get to work or study on a work day?" |
| commuteMin | About how many minutes a day, both ways? | ✗ "On a work day, how many minutes do you walk or cycle to work and back, in total?" |
| stepsKnown | Do you know your daily steps? | ✓ |
| stepsNumber | About how many a day, over the last 2–4 weeks? | ✗ "How many steps a day does your watch, ring or phone show, on average over the last 2–4 weeks?" |
| phoneCarried | Is your phone with you most of the day? | ✗ "Your phone counts your steps: is it in your pocket or hand most of the day?" |
| stepsRough | Roughly how many steps a day? | ✓ |
| offDay | On a day off, you're mostly… | ✗ "On a day off from work or study, how do you spend most of the day?" |
| home | At home, how much are you on your feet — cooking, cleaning, washing, children, caring? | ✓ |
| sport | Any sport or active hobby that isn't your planned training? | ✓ |
| trainNow | Do you train now, on purpose? | ✗ "Do you exercise on purpose now (gym, sport practice, runs, classes)? How many times a week?" |
| trainMix | Mostly… | ✗ "When you exercise now, is it mostly lifting weights, mostly cardio, or a mix?" |
| sleep | When do you usually sleep? | ✗ "On a usual night, what time do you go to sleep and wake up?" |
| sleepQuality | And usually, how well? | ✗ "On a usual night, how well do you sleep?" |
| experience | How long have you trained regularly? | ✗ "How long have you exercised regularly (at least twice a week), in total?" |
| willing | Which of these would you do? | ✗ "Which kinds of exercise would you do as part of a plan?" |
| where | Where can you train? | ✓ |
| whereDays | Which days can you use them? | ✗ "On which days can you use the places you picked (gym, park, pool…)?" |
| kit | What do you have? | ✗ "What exercise equipment do you have at home?" |
| weights | How heavy? | ✗ "How heavy are the weights you have (dumbbells, kettlebells, plates)?" |
| time | How much time for training? | ✗ "How many days a week, and how many minutes each, can you give to exercise?" |
| injuries | Any pain or injury we should work around? | ✓ |
| conditions | Do any of these apply? | ✗ "Do you have any of these conditions that change which exercises are safe?" |
| wontDo | Anything you won't do, or can't at home? | ✗ "Is there any kind of exercise you won't do, or can't do where you live?" |
| buy | If a plan worked better with a small purchase, would you buy it? | ✓ ("…exercise equipment purchase…") |
| log | How do you want to log workouts? | ✓ |
| eat | Which of these do you eat? | ✓ |
| dairy | Do you avoid any dairy? | ✓ |
| eggs | Eggs as eggs, or only inside baked food? | ✗ "You eat eggs: as eggs (boiled, omelette), or only when baked into food like cake?" |
| allergies | Any food allergies? | ✓ |
| traces | Even traces? | ✗ "For your food allergies, should even traces (e.g. 'may contain') be avoided?" |
| rules | Do you follow any of these? | ✗ "Do you follow any of these religious or food rules?" |
| jain / jainGreens / fasting | (current) | ✓ |
| fastingFood | What do you eat then? | ✗ "On your fasting days, what do you eat?" |
| meatDays / cuisine / cooks / household / mealTime | (current) | ✓ |
| kitchen | What can you cook with? | ✓ → replaced by E17's kitchen question (§13.3) |
| alcohol | Do you drink alcohol? | ✓ |
| drinks | About how many drinks a week? | ✗ "About how many alcoholic drinks do you have in a week?" |
| supplements | Food first, or open to supplements? | ✗ replaced by §13.2 |
| taking | Which do you take? | ✗ replaced by §13.2 |
| later | A few more come up when they matter … Answer them now? | ✗ removed: those questions join the graph with Ask later |
| staples / budget / eatingOut | (current) | ✓ (staples → §13.3 picker) |
| pantry | What is in your kitchen now? | ✓ → §13.3 pantry |
| has | Do you wear or use any of these? | ✓ |
| models | Which one? | ✗ "Which brand and model is your {device}?" |
| platform | And your phone? | ✗ "Which kind of phone do you use?" |
| streams | What should Vitals do with each stream? | ✗ "For each kind of data your device records, what may Vitals do with it?" |
E16 owns the final copy; a test asserts every `text` is ≥ 6 words, contains no leading "And", "Mostly", "Which one"
pattern, and that every child has a `contextLine`.

**Acceptance tests (E16).** `flow-v3.test.ts`: (1) answer A to the end, Back three times, Change `work` to no → the
`workTime`/`commute` rows show "not used", nothing else changes; (2) leave after any question, rebuild the view from the
stored doc (fresh module) → same `firstOpen`; repeated over 200 random answer sequences (property test); (3) Body page
inline maintenance questions write the same document as the chapter; (4) `measured` RMR via metabolic cart → the
maintenance estimate equals the pre-v3 `saveMeasuredRmr` result for the same number (golden); (5) no `ResponsivePanel`
is rendered by `features/intake/**` or the Body maintenance panel (DOM test); (6) progress = answered/visible.

**Status (I2, 2026-10-02).** Built by E16 (`docs/wp/E16.md`): question graph with `parent`, `contextLine`,
`askLater` and a pure `applies` (`flow.ts`, `useChapterFlow.ts`), the answered list as the main surface with an inset
QuestionCard (Back · Ask me later · Next; change mode Cancel · Save), per-question progress, the measured-maintenance
questions, removal of `CorrectPanel` / `applyWhatIf` / "Correct it", the Body page's inline measured question and
chapter A list, and the chapter-part registry (`INTAKE_PARTS` / `INTAKE_WIDGETS` from `food-kitchen.ts`,
`supplements.ts`, `markers*.ts`). Deviations: question ids stay bare in storage (`work`, not `activity.work`; the
`chapter.id` form is exposed as `qid` in `intake.nextQuestions`); the field is `prompt`, not `text`; the stored status
stays `'skipped'` (read as later); single-choice keys still commit on press after 240 ms; `meta.*` context is
re-stamped at every chapter entry; the measured-maintenance binding runs inside `intake.answer` (so the Coach path binds
too) and a value typed in Body › labs is never cleared; the food chapter's "answer them now?" gate is removed (its
questions are ordinary ones with Ask me later); chapter A uses the design §7 wording where it differs from the table
above. Open: a measured TDEE is stored and shown but is not yet a plan-start observation; the loading skeleton and
10-minute draft are not built; return to `/body#maintenance` after a deep-linked Change is not built.

### 13.2 Supplements: taking vs on hand (item 6) · owner **E18**

Questions: `food.suppStance` "Do you take supplements now, or have some at home?" (single: `taking` "I already take
some" · `onHand` "I have some at home but don't take them" · `open` "None now, but I'm open to them" · `food_first`
"I'd rather get everything from food"); `food.suppList` (child, when `taking | onHand`) "Which supplements do you take
or have at home?" (catalogue picker + free text) with one **dose row** per item.
```ts
type SupplementState = 'taking' | 'onHand' | 'notForMe' | 'unknown';
type TimeOfDay = 'morning' | 'midday' | 'evening' | 'night';
interface SupplementRow { supplementId: string | null; text?: string;   // free text until resolved to the catalogue
  state: SupplementState; dose?: number; unit?: string; timesOfDay: TimeOfDay[]; since?: LocalDate }
interface SupplementsSectionV2 { _v: 2; stance: 'taking' | 'onHand' | 'open' | 'food_first'; rows: SupplementRow[] }
```
Migration v1 → v2: `stance:'open'` with `taking[]` non-empty → `stance:'taking'`; each `taking` entry → row
`state:'taking'`, `timesOfDay` from `clockH` (< 11 morning, < 16 midday, < 21 evening, else night).
Planner and Food rules. Today only `stance === 'open'` reaches the planner, as `optIns.levers: ['creatine']`
(`src/features/planner/request.ts:234`, `CONSENT_SUPPLEMENTS = { L7: 'creatine' }` in `skeleton.ts:180`); v3 maps per row
(supplement → lever: creatine L7, omega-3 L8, psyllium L9; others are display-only per §8.5):
| State | Planner | Food / Coach |
|---|---|---|
| `taking` | habitual: in the baseline and every rung (engine hooks of §8.5); a lever id with `taking` is never "added" by a plan and costs no difficulty | dose shown on Today; logged by `log.supplement` |
| `onHand` | offered to the planner as an opt-in lever (`optIns.levers`) with zero purchase cost (never in "things to buy") | the Coach suggests it before any purchase |
| `notForMe` | refused (`SUPPLEMENT_REFUSALS` path; kept by the Ideal) | never suggested |
| `unknown` / absent | stance `open` → catalogue opt-in as today; `food_first` → not offered | catalogue cards only when `open` |
Equipment analogue: kitchen and training equipment items carry `use: 'use' | 'ownNotUsed'`; `ownNotUsed` counts as
owned for "things to buy" and the session composer, with the Coach allowed to suggest it ("you have a rope you don't use").
Dose row UI (D2 owns the visuals): name + evidence badge left; dose field with unit, the four time-of-day toggles as a
segmented control and the state control right; wraps to its own line below 480 px; one component reused in Settings
and Food. **Tests (E18):** migration; planner request for each state; no overlap at 390/768/1440 (screenshot test).

**Status (I2, 2026-10-02).** Built by E18 (`docs/wp/E18.md`): v2 types, migration v1 → v2 and planner mapping in
`src/catalogues/supplements/`; commands `supplements.get` (R), `supplements.set` and `supplements.remove` (W·c); the
`SupplementRow` component reused in the intake, Settings › Supplements and the Food tab ("yours" rows, Taken logs
`log.supplement`); Coach briefing section. Deviations: the question ids stay `supplements` / `taking` (`taking` a child of
`supplements`) in the food chapter's base graph, in the v3 Question shape, so stored answers keep working (not
`food.suppStance` / `food.suppList`); the dose is the amount **per time of day** (daily amount = dose × times; upper-limit
checks use the daily amount); units come per catalogue item plus sold forms (scoop, tablet, µg/IU for vitamin D; 40 IU =
1 µg); going over a catalogue upper limit is a warning, not a refusal; a safety caution does not lock the row to "not
for me" (it shows a caution line; no safety flags reach the row yet). Planner: `taking` and `onHand` both only grant
consent through `optIns.levers` (the habitual "in the baseline and every rung" hook is not built; the request has no
field for it); `notForMe` → `constraints.excludedLevers`; the open stance with no rows still gives `['creatine']`, so old
request hashes are unchanged. Not built: the dose on Today, "never in things to buy" (no consumer), and the equipment
`use`/`ownNotUsed` flag for training equipment (`TrainingProfile.owned` has no per-item field; kitchen equipment has it,
§13.3).

### 13.3 Kitchen and pantry (item 5) · owner **E17**
```ts
// vitals.kitchen/1  — collection `kitchen`, key `me`, LWW-F
interface KitchenDoc { _schema: 1; equipment: Array<{ id: string;            // R12 catalogue id or `custom:<slug>`
    label?: string; note?: string; use: 'use' | 'ownNotUsed'; addedAt: Instant; source: 'picker' | 'coach' | 'paste' }>;
  cuisines: Array<{ id: string; rank: number }>; staples: Array<{ id: string; source: 'picker' | 'coach' | 'paste' }> }
// vitals.pantry/1   — collection `pantry`, key `me`, LWW-F
interface PantryDoc { _schema: 1; items: Array<{ id: string;                  // food id (resolves to nutrients) or `custom:<slug>`
    label?: string; qtyApprox?: string; source: 'picker' | 'coach' | 'paste'; addedAt: Instant; lastConfirmedAt?: Instant }> }
```
No automatic expiry: nothing is removed by time; the Coach may ask "still have it?" when a recipe depends on an item
whose `lastConfirmedAt ?? addedAt` is older than 14 days. Migration moves `intake/me.kitchen` and `diet.cuisines/staples`
into these documents (the intake keeps only turns).
| Command | Perm | Input → output | Surfaces |
|---|---|---|---|
| `kitchen.get` | R | `{}` → `KitchenDoc` view | all |
| `kitchen.set` | W | `{equipment?, cuisines?, staples?}` (whole lists; the picker) → view | all |
| `kitchen.add` | W | `{items: Array<{label, id?, note?, use?}>}` (Coach "I also have a soda maker") → view | all |
| `pantry.get` | R | `{}` → `PantryDoc` view | all |
| `pantry.add` · `pantry.remove` | W | `{items: Array<{label, id?, qtyApprox?}>}` / `{ids}` → view | all |
| `pantry.parseList` | R | `{text}` → `{items: Array<{label, id|null, confidence}>}` (catalogue matcher first, model only for unmatched words; nothing written) | all |
All are `write/low` (applied with Undo, never staged). **Convergence:** the Coach's "I have X at home" calls
`pantry.add` with `source:'coach'` on the same document the picker writes; paste-a-list = `pantry.parseList` then
`pantry.add` with `source:'paste'`. **Briefing** gains a kitchen block (≤ 250 tokens): equipment ids with notes and
`ownNotUsed`, top 3 cuisines, staples, pantry item labels (≤ 60). **Recipe tool constraints** (`createAiRecipeProvider`,
fixing the runtime gap where no `kitchen` is passed): `{ equipment: string[]; equipmentNotes: Record<string,string>;
cuisines: string[]; staples: string[]; pantry: string[]; preferPantry: boolean; timeBudgetMin; skill }`; each returned
recipe lists `equipment[]`, which the Food tab shows. **Tests (E17):** convergence (Coach add and picker add produce one
item list); migration; recipe request carries equipment and pantry; no expiry after 400 simulated days.

**Status (I2, 2026-10-02).** Built by E17 (`docs/wp/E17.md`): generated catalogue (181 equipment, 139 cuisines,
288 staples, 546 pantry items, 17 regions; `scripts/kitchen-catalogue.mjs`, lazy chunk), library `src/catalogues/kitchen/`,
the seven commands above (`src/commands/kitchen/`, `src/commands/food/pantry.ts`), the `CataloguePicker`, Settings ›
Kitchen, the Food tab pantry faceplate and `/food/pantry`, the briefing kitchen section and the recipe `KITCHEN`
constraints. Deviations: the intake part replaces `cuisine`, `kitchen`, `staples` and `pantry` after `cooks` with four
picker questions (`food.cuisines`, `food.equipment`, `food.staples`, `food.pantry`), and I2 maps their answers back to the
v0.2 ids so `DietProfile` keeps cuisines, staples and equipment; migration is lazy (reads return the v0.2 answers with
`fromIntake: true` and write nothing; the first write persists them); `KitchenDoc.regions?` and `pantry.add`
`source?`/`replace?` are additive fields, and AI or agent actors always write `source: 'coach'`; `pantry.parseList` uses
the catalogue matcher only (no model call; unmatched lines return `id: null`); "still have it?" applies to perishable items
only; perishables are never pre-ticked even where the seed lists them. Open: `food.candidates` and the grocery "already
have" set still read the v0.2 `intake.kitchen.pantry`; `fdcId → FoodRecord.id` waits for the food bundle (only the 19
fixture-linked items resolve today).

### 13.4 Goal suggestion (item 8) · owner **E19**
`goals.suggest` — **R**, surfaces all, `{source?: 'rule' | 'ai'}` → `GoalSuggestion`. It never writes; the Goals page
shows the result as a proposal card, and "Use these" dispatches `goals.edit` (W) with the ops plus a `goals.suggested`
record. Nothing runs until the person presses Find plans.
```ts
interface GoalSuggestionInput {            // gathered by code; the pure core is suggestGoals(input) in src/engine/planner/domain/suggestGoals.ts
  profile: ProfileView; body: { bfPct: number | null; bfBand: [number, number] | null; leanKg: number | null; waistCm?: number;
    visceralKg?: number; trainingAgeY: number | null }; intake: IntakeDoc; markers: MarkerNote[]; devices: { sleepDebtH?: number;
    hrvBelow?: boolean; steps7d?: number }; safety: SafetyStatus; reach: TargetReach[] }   // reach = estimateTargetsAsync
interface GoalSuggestion {
  source: 'rule' | 'ai'; version: string;                 // 'rule@1' | `ai:${model}@${BRIEFING_VERSION}`
  goals: Array<{ rank: number; metric: MetricId; target?: number; unit?: string; mode: 'target'|'minimise'|'maximise'|'keep';
    targetFrom: 'fastestSafeReach' | 'band' | 'keep'; why: string }>;                         // one plain sentence each
  constraints: Partial<ConstraintDraft>;                  // training days, equipment, windows, food pattern; fasting only if already opted in
  missing: Array<{ field: string; question: QuestionId; why: string }>;
  clarify?: string[];                                     // AI only, ≤ 2
}
```
Rules (`rule@1`): fat loss first when body fat is above the healthy band; muscle first when lean and training ≥ 6
months; recomposition when both; a marker goal when a `MarkerNote` of severity ≥ caution exists; sleep/recovery when
device sleep debt > 1 h/night over 14 days. With no body or intake data the result has `goals: []` and a non-empty
`missing` (never a guess). Record `goals/me.suggested = { suggestion, at: Instant, provenance: {source, version} }`.
**AI equivalence test:** for the golden personas, the AI variant (recorded fixtures) must produce the same metric set
in the first two ranks as `rule@1`, targets within ±10 % of the rule targets, constraints that are a subset of the
intake's, and `missing` ⊇ the rule's; anything else falls back to the rule result with a note. **Tests (E19):** golden
personas; unanswered profile → `missing` lists the body and activity questions; no write without "Use these".

**Status (I2, 2026-10-02).** Built by E19 (`docs/wp/E19.md`): pure `suggestGoals` (`rule@1`), command `goals.suggest`, the
model-backed suggester (`src/ai/coach/goalSuggester.ts`), the proposal card on the Goals page and `goals/me.suggested`
written by the new `goals.edit` op `setSuggested`. Deviations: the output adds `notes` (sleep is not goal-eligible, so a
sleep shortfall becomes `sleepFixed: false` plus a note) and `fallback` (the line shown when the rule result replaces a
disagreeing or failed AI answer); `body.bfBand` is read as the estimate's likely range and the healthy band is computed
inside the suggester (Gallagher 2000); recomposition keeps the second goal as skeletal muscle maximise without an amount;
"Use these" became **Apply** (one `goals.edit`: replace goals, `setLimits`, `setSuggested`, so Undo is one
`history.undo`) plus "Add only new goals"; the record also carries `goalKeys`; the command fails with
`precondition_failed` until the Planner module has loaded once. The ladder shows "Goals based on your answers." (or
"…, suggested by the Coach.") from `basedOnAnswersLine`; marker notes come from `markers.get` (I2).

### 13.5 Blood markers (item 9) · owner **E20** (intake chapter file `chapters/markers*.ts`; E16 wires the chapter position)

**Document `vitals.markers/1`** (collection `markers`, key `me`, LWW-F; history kept as APP entries in `measurements`
with `metric: 'lab:<markerId>'` so Progress can trend them).
```ts
type MarkerId =                     // Tier A (typed by hand and planned on); ids are stable and used by the R13 JSON
  | 'ldl' | 'hdl' | 'tg' | 'nonHdl' | 'apoB' | 'lpa' | 'fpg' | 'hba1c' | 'insulin' | 'alt' | 'ast' | 'ggt'
  | 'creatinine' | 'egfr' | 'uacr' | 'urate' | 'tsh' | 'ft3' | 'hb' | 'ferritin' | 'b12' | 'vitD' | 'hsCrp'
  | 'sodium' | 'potassium' | 'testosterone' | 'cortisol';
type MarkerProvenance = 'manual' | 'pdf' | 'photo' | 'coach';
interface MarkerReading {
  id: MarkerId; value: number; unit: string;          // as entered or printed
  valueCanonical: number; unitCanonical: string;      // after the §13.5.1 table; Lp(a) nmol/L is never converted
  date: LocalDate;                                    // sample date, confirmed by the person
  labRange?: { low?: number; high?: number; text?: string; unit: string };   // as printed; never invented
  method?: string;                                    // 'direct' | 'calculated' | lab text (LDL direct ≠ Friedewald)
  fasting?: boolean; provenance: MarkerProvenance; confidence?: number;     // 0–1, extraction only
  confirmed: boolean;                                 // only confirmed readings are used by any rule or the engine
  attachmentId?: Id; enteredAt: Instant;
}
interface MarkersDoc {
  _schema: 1;
  readings: MarkerReading[];                          // newest per id is "current"; older ones stay for trends
  displayOnly: Array<{ name: string; value: string; unit?: string; range?: string; date: LocalDate }>; // CBC indices etc.
  context: { creatineLast2w?: boolean; recentIllness?: boolean; hardTraining48h?: boolean;
             thyroidMeds?: boolean; metformin?: boolean; ppi?: boolean };
  chapter: 'skipped' | 'manual' | 'report' | null;   // the entry answer
}
```
Staleness: a reading older than 12 months is display-only; HbA1c and lipids older than 3 months after a recorded big diet
change (plan start with a different diet pattern) likewise. Display-only readings never fire a rule. A plan's diet
pattern is the animal-food level of its baseline profile (omnivore when not set). The diet change date is the start of
the first plan in the latest run of started plans that share the live plan's pattern, so a re-plan with the same pattern
does not move it; the first plan ever counts as a diet change.

#### 13.5.1 Units (canonical = the engine's `LabBaselines` unit; constants must match `src/engine/model/cardiometabolic/baselines.ts`)
| Marker | Canonical | Accepted → factor |
|---|---|---|
| LDL, HDL, non-HDL | mmol/L | mg/dL × 0.02586 |
| TG | mmol/L | mg/dL × 0.01129 |
| ApoB | g/L | mg/dL × 0.01 |
| Lp(a) | as entered (mg/dL **or** nmol/L) | none: unit-specific thresholds (50 mg/dL; 125 nmol/L) |
| Fasting glucose | mmol/L | mg/dL × 0.05551 |
| HbA1c | % | mmol/mol: % = mmol/mol × 0.09148 + 2.152 |
| Insulin | µU/mL | pmol/L ÷ 6.0 |
| ALT, AST, GGT | U/L | µkat/L × 60 |
| Creatinine | mg/dL | µmol/L ÷ 88.42 |
| eGFR | mL/min/1.73 m² | lab value, else CKD-EPI 2021 from creatinine, age, sex |
| Urine ACR | mg/g | mg/mmol × 8.84 |
| Uric acid | mg/dL | µmol/L ÷ 59.48 |
| TSH | mIU/L | µIU/mL × 1 |
| Free T3 | pmol/L | pg/mL × 1.536 |
| Hb | g/dL | g/L ÷ 10 (`gm/dL` = g/dL) |
| Ferritin | µg/L | ng/mL × 1 |
| B12 | pg/mL | pmol/L ÷ 0.738 |
| 25(OH)D | ng/mL | nmol/L ÷ 2.496 |
| hs-CRP | mg/L | mg/dL × 10 (plain CRP is display-only) |
| Na, K | mmol/L | mEq/L × 1 |
| Testosterone | nmol/L | ng/dL × 0.03467 |
Each marker also has plausibility bounds (block entry) and soft bounds ("is this right?") in `src/markers/units.ts`;
E20 takes them from the R13 dossiers. A unit not in the table rejects the row with "unit not recognised".

#### 13.5.2 Interaction table (the R13 JSON; `src/markers/interactions.json` is generated from R13a–d and tested against them)
```ts
type LeverId = 'vlc' | 'lowcarb' | 'highprotein' | 'fast16_8' | 'fast24' | 'fast36_48' | 'fast48plus' | 'satfat'
  | 'dietcholesterol' | 'fibre' | 'unsatfat' | 'alcohol' | 'caffeine' | 'creatine' | 'wheyprotein' | 'deficit_large'
  | 'deficit_moderate' | 'surplus' | 'resistance_load' | 'aerobic_load' | 'sleep_debt' | 'weight_loss' | `supp:${string}`;
type Grade = 'A' | 'B' | 'C' | 'D';                       // R5 grades
interface SourceRef { id: string; doi?: string; pmid?: string; url?: string; note?: string }   // opened by the author
interface MarkerFileV1 {
  schema: 'vitals.markerInteractions/1'; dossier: string;   // e.g. 'R13-markers-lipids.md'
  markers: Array<{
    markerId: MarkerId; unitCanonical: string; plausible: [number, number]; soft: [number, number];
    states: Array<{ id: string; label: string; predicate: Predicate; source: SourceRef[] }>;  // e.g. 'ldl.high'
    retestWeeks: { afterChange: number; routine: number }; indianRange?: string; guidelineTargets?: string[];
  }>;
  interactions: Array<{                                     // how a lever moves a marker (display + engine checks)
    markerId: MarkerId; lever: LeverId; direction: 'up' | 'down' | 'none' | 'mixed';
    effectSize: { value: number; low?: number; high?: number } | null; unit: string;   // e.g. 'mg/dL', '%'
    subgroup?: string;                                      // 'LMHR: BMI < 25, TG/HDL low'
    timeCourseWeeks: number; mechanism: string; grade: Grade; sources: SourceRef[]; rule?: string;   // rule id
  }>;
  rules: Array<{                                            // what a marker state does to the plan
    id: `W-L${string}`; state: string;                      // markers[].states[].id; AND/OR only via Predicate
    kind: 'cap' | 'warn' | 'reask' | 'clinician' | 'retest' | 'prefer';
    lever?: LeverId; cap?: { lock: LabLockId; value: number; unit: string };
    severity: 'info' | 'caution' | 'danger'; message: string;   // ≤ 200 chars, "because …" filled by code
    retestWeeks?: number; reask?: 'diabetes' | 'kidney' | 'gout' | 'foodAllergy';
    grade: Grade; sources: SourceRef[];
  }>;
}
type Predicate =
  | { gte: number } | { gt: number } | { lte: number } | { lt: number } | { between: [number, number] }
  | { outsideLabRange: true } | { all: Array<{ markerId: MarkerId; p: Predicate }> } | { any: Array<{ markerId: MarkerId; p: Predicate }> };
type LabLockId = 'deficit-cap' | 'max-fast' | 'protein-cap' | 'carb-floor' | 'satfat-cap' | 'fat-cap'
  | 'creatine-cap' | 'potassium-supp-cap' | 'alcohol-cap';   // the last four are new PlannerLockIds (numeric, may be 0)
```
Invariants (tested in `src/markers/__tests__/interactions.test.ts`): every `rules[].state` and `interactions[].markerId`
resolves; every row has ≥ 1 source with a DOI, PMID or URL; `kind` is never a removal: there is no `block`/`exclude`
kind; a `cap` with value 0 is allowed only for `creatine-cap` and `potassium-supp-cap` and only adds "the planner will
not add it" (a person's own logged use is never refused, it gets the warning); the table renders in the plan view, the
Coach and the Evidence library from this one file.

#### 13.5.3 Binding to the planner
| `rule.kind` | Planner input it writes (`markerConstraints(doc, profile) → PlannerSafetyInput` patch, pure) | Where it shows |
|---|---|---|
| `cap` | `plannerLocks.push({ id: cap.lock, value, reasons:[{rule: id}] })`; the strictest of lab and screening locks wins | rung safety notes, "limits it presses" |
| `warn` | `markerWarnings: MarkerNote[]` on the request; rendered before the ladder and on each affected rung, lever and dish; not a margin | ladder banner, rung, Food, Coach |
| `reask` | a pending re-ask on the safety screening item (`reask`), `planner.find` returns `precondition_failed` with `detail.precondition = 'markerReask'` until answered (the only lab rule that pauses search; it asks, it does not refuse) | screening card |
| `clinician` | a `MarkerNote` with `severity: 'danger'` and the clinician sentence; existing clinician-first lock (HC-P7) only when R13 lists the threshold as clinician-only | ladder banner, Progress |
| `retest` | a retest task `{markerId, due: LocalDate}` in the living plan (calendar entry, check-in prompt) | Today on the due week, Progress |
| `prefer` | a ranking bias: `preferLevers: Array<{lever, weight ≤ 0.02}>` added to the regulariser R only (never to G, never to safety) | "favoured because your X was Y" |
Safety warnings use the new `W-L01…W-L12` ids of research-blood-markers §5 (extending W-M05, W-M09, W-F11, W-P06,
W-E20 and friends; `ruleSources.test.ts` and the 200-char rule apply). Kidney: eGFR < 60 or ACR ≥ 30 sets the existing
`kidney-disease` flag so HC-M2/HC-M7/HC-M12 apply unchanged.
```ts
interface MarkerNote { rule: `W-L${string}`; markerId: MarkerId; severity: 'info'|'caution'|'danger';
  because: { markerId: MarkerId; label: string; value: number; unit: string; date: LocalDate };   // "because your LDL was 192 mg/dL on 12 Sep 2026"
  levers: LeverId[]; text: string; grade: Grade; sources: SourceRef[]; retestDue?: LocalDate }
```
The `because` sentence uses the reading's **entered** unit and the date in the person's date style; it is built by
code (`becauseText(note)`), never by the model.

#### 13.5.4 Engine baseline
`labBaselinesFrom(doc): Partial<LabBaselines>` (pure) maps confirmed, non-stale readings to `ldlMmolL, hdlMmolL, tgMmolL,
apoBgL, fastingGlucoseMmolL, fastingInsulinUuMl, hba1cPct, crpMgL, urateMgDl, testosteroneNmolL` (existing) and to the
new fields `lpaMgDl | lpaNmolL, nonHdlMmolL, altUL, astUL, ggtUL, creatinineMgDl, egfr, uacrMgG, tshMiuL, ft3PmolL,
hbGdL, ferritinUgL, b12PgMl, vitDNgMl, sodiumMmolL, potassiumMmolL` plus `labDates: Partial<Record<keyof LabBaselines,
LocalDate>>`. Entered values replace the population draw; missing ones are drawn conditioned on entered ones (CORR).
`profile.labs` keeps `measuredRmrKcal`, `vo2maxMlKgMin` and the Body page fields; the Body page's marker inputs become a
view of `markers` (one source of truth; migration copies existing `profile.labs` marker values in as `manual`,
`confirmed: true`, dated at the profile's `_updated`).

#### 13.5.5 Intake chapter and statements
Chapter `markers` sits **after food, before devices** (`CHAPTERS = ['activity','training','food','markers','devices']`).
Header copy, verbatim and both always visible before any value is entered:
1. "This is the most detailed option; many values are involved."
2. "Vitals is not medical advice; it does not diagnose or treat."
Questions (v3 graph, §13.1): `markers.has` "Do you have a blood test from the last 12 months?" (No, skip · Type the key
values · Let the Coach read my report) → manual: one group question per panel ("Your lipid results: LDL, HDL,
triglycerides, ApoB, Lp(a)") with date and fasting per group; report: upload → review table → confirm.

#### 13.5.6 `markers.*` commands and the `markers.import` tool
| Command | Perm | Input → output | Surfaces |
|---|---|---|---|
| `markers.get` | R | `{}` → `MarkersView` (current readings, states, notes) | all |
| `markers.set` | W·c | `{readings: MarkerReadingInput[]}` (manual) → `MarkersView` | all (ai: staged) |
| `markers.import` | W (job) | `{attachmentId}` → `MarkerExtraction` | all |
| `markers.confirm` | W·c | `{extractionId, accept: Array<{row, value?, unit?, date}>, context}` → `MarkersView` | ui (ai may only render the card) |
| `markers.remove` | W | `{markerId, date}` → `MarkersView` | all |
```ts
interface MarkerExtraction { extractionId: Id; route: 'textLayer' | 'vision'; sampleDate?: LocalDate;
  rows: Array<{ row: number; markerId: MarkerId | null; nameOnReport: string; value: number | null; unit: string | null;
    labRange?: string; method?: string; calculated: boolean; confidence: number; issues: string[] }>;
  displayOnly: MarkersDoc['displayOnly']; notInReport: MarkerId[] }
```
Pipeline: (1) PDF with a text layer → pdf.js positional text in a worker, rows by y, five columns by x, synonym table,
`CALCULATED` rows recomputed and dropped from confirmation; (2) photo or no text layer → vision model with the strict
row schema, Tier A names only. Before step 2 the page header region and every line matching the patient-block patterns
(name, age/sex, patient id, referred by, phone, address, barcode, collected at) are removed from the image (masked) and
from any text; only the sample date is kept and asked to be confirmed. Nothing is saved until `markers.confirm`; the
Coach shows the review table as a `confirm` card. Attachments stay local and deletable from the review.

#### 13.5.7 Display hooks
Ladder: a marker banner above the cards listing active `MarkerNote`s; every rung row a note touches shows a chip
"because your LDL was 192 mg/dL on 12 Sep". Food: dishes that hit a capped lever (sat fat, cholesterol, alcohol) carry
the same chip. Coach briefing: `markers: Array<{id, value, unit, date, state, notes: rule ids}>` (≤ 300 tokens).
Progress: per marker, readings as points against the engine's projection band from the plan start. Evidence: topic
`blood-markers-and-diet`.

**Acceptance tests (E20):** interaction JSON schema test and source test; one golden per W-L rule at threshold ± ε
(L9); high-LDL and low-eGFR persona variants (rules fire, caps bind, nothing removed); unit table round trips; synthetic
Indian-layout PDFs (≥ 4 layouts, generated in-repo) extract ≥ 95 % of Tier A rows with correct values; the patient block
never reaches the provider (test spy on the request body); `because` text snapshot; L5/L6 (creatine artefact) pass.

**Status (I2, 2026-10-02).** Built by E20 (`docs/wp/E20.md`): `src/markers/` (units, because-line, rules engine
`evaluateMarkers`, baselines), the generated `src/markers/interactions.json` (27 markers, 503 interactions, 157 rules:
144 research rules and 13 clinician-only thresholds), pdf.js extraction in a worker with patient-block masking and the
vision fallback, the five `markers.*` commands, Coach tools `markers_get` / `markers_import`, the briefing `markers`
section, display hooks (`BecauseChip`, ladder banner, rung and Food chips, Progress section) and the Evidence topic
`blood-markers-and-diet`. Deviations: R13 rule ids are kept as written (`W-L-LDL-1` …; `mapsTo` keeps the index id);
lock ids add `added-sugar-cap`, `surplus-cap` and `caffeine-cap`; cap value 0 is allowed for `creatine-cap`,
`potassium-supp-cap`, `alcohol-cap` and `deficit-cap` (the research wins over the two listed above); the planner applies
`deficit-cap`, `max-fast`, `protein-cap`, `carb-floor`, `creatine-cap`, `surplus-cap` and the `kidney-disease` flag,
while the sat-fat, fat, alcohol, added-sugar, caffeine and potassium-supplement caps are reasons on the plan and Food
chips only; `labDates` is returned beside `LabBaselines` (`labBaselinesWithDates`), not inside it; rules whose context
field the app does not know stay unfired and listed as `unresolved`. Integration: the chapter is hosted by the v3
QuestionCard through `INTAKE_PARTS` (`has` entry gate with `askLater: false`, children `manual` / `report`), turns in
`intake.markers.turns` with a fallback derived from the markers document; pdf.js chunks are excluded from the PWA
precache and cached at runtime (`vitals-pdf`). Open: the planner search does not read `preferLevers` yet; report files
cannot be deleted yet; `dietChangeDate` and other rule-context fields are not passed from the UI.
Sex not given (unset or "prefer not to say"): the rule context's sex is `unknown` and each sex-specific threshold takes its more cautious value: Hb low below the higher WHO cut-off (13 g/dL), ALT above the lower healthy limit (25 U/L), a sex-specific cap at its stricter value (alcohol 20 g a day), and a rule limited to one sex applies (`ruleContextFrom`, `src/markers/rules.ts`; one builder `markerRuleContext` for screens, commands and the planner precondition).

### 13.6 Companion ops contract (item 3) · owner **E22** (R14 writes the probe; this fixes only the shapes)
- **Install locations.** Binary `vitals-companion` on the owner's PATH as a wrapper script `~/.local/bin/vitals-companion`
  written by `vitals-companion install [--bin-dir] [--force] [--dry-run]` from the checkout (built by E22 instead of
  `pnpm link --global`: Node refuses type stripping under `node_modules`; the wrapper pins Node and the checkout, so GUI
  apps without the shell PATH start the same program, and it is one file to remove); config dir
  `$XDG_CONFIG_HOME/vitals-companion/` (`config.json`, pairing and token files mode 0600; secrets never in
  `config.json`); data dir `$XDG_DATA_HOME/vitals-companion/` (relay store, blobs; `~/.vitals` is used instead when it
  already exists); logs to stdout/journald only, no secrets.
- **`vitals-companion doctor [--json] [--server <url>]`** exits 0 when every `required` check passes, 1 otherwise
  (required: `node`, `configDir`, `port`, and `relay` when `--server` is given):
```ts
interface DoctorReport { version: string; node: string; os: string; configDir: string; dataDir: string;
  checks: Array<{ id: 'node' | 'bin' | 'configDir' | 'port' | 'tailscale' | 'serve' | 'service' | 'relay' | 'siwc' | 'zen'
      | `agent:${'codex' | 'opencode' | 'claude' | 'chatgpt-desktop'}` | 'webmcp';
    required: boolean; status: 'ok' | 'warn' | 'fail' | 'absent'; detail: string;   // e.g. "codex 0.159 at /usr/bin/codex; vitals MCP registered"
    fix?: string }> }                                                                // exact command to run; never contains a secret
```
  `bin` (added by E22) reports the PATH entry and which checkout it runs.
- **Service unit expectations** (`packages/companion/deploy/vitals-companion-sync.service`, user or system unit;
  `vitals-companion service [--role sync|proxy|serve] [--write] [--https-port <n>]` prints the same unit for any path):
  `ExecStart=… sync --host 127.0.0.1 --port 4870 --data <data dir>` (`--listen` is an alias of `--host`; the shipped
  unit uses `--host`), `Restart=on-failure`, `NoNewPrivileges=yes`, `ProtectSystem=strict`, `ReadWritePaths=` the data
  dir only, no secrets in `Environment=`; health = `GET /health` → `{version, roles, ownerCount}` within 2 s of start.
  **Caveat:** in a systemd *user* unit on Ubuntu 24.04, `ProtectSystem=`, `PrivateTmp=` and `ReadWritePaths=` are
  skipped (AppArmor blocks unprivileged user namespaces; systemd logs the skip and starts the service without them;
  verified on oci-arm). `NoNewPrivileges=` and `UMask=` are applied. The directives stay in the file for hosts that
  allow namespacing or a system unit with `User=`.
- **Serve URL shape.** `tailscale serve --bg --https=8443 http://127.0.0.1:4870` →
  `https://<host>.<tailnet>.ts.net:8443/` (8443 where :443 is taken, as on oci-arm where Caddy owns it; `--https-port`
  on `service` changes the port printed by the CLI and doctor; `--https=443` gives the bare origin where nothing else
  serves :443), with routes of §7.2 unchanged (`/health`, `/sync` as wss, `/blobs/…`, `/mcp`); the app stores the relay as that origin
  and adds it to `connect-src` through the existing per-target allowlist, not a wildcard.
- **Tests (E22):** `doctor --json` schema test with stubbed probes; unit file lint (`systemd-analyze verify` when present);
  a written proof log `docs/wp/E22-proofs.md`.
- **Status (I2, 2026-10-02).** Built by E22 (`docs/wp/E22.md`, proofs in `docs/wp/E22-proofs.md`, guide
  `docs/COMPANION.md`): Companion 0.2.0 with `doctor`, `install`, `service`, `agents status|register|unregister`
  (`codex`, `opencode`, `claude`, `chatgpt-desktop`) and `keys import opencode-zen`; the sync relay runs as a user unit on
  oci-arm behind `tailscale serve` on :8443, and two browser profiles synced through it. Deviations (recorded above):
  wrapper script via `vitals-companion install` instead of `pnpm link --global`; `--https=8443` instead of 443; doctor
  check `bin` added; `--listen` alias of `--host`; user-unit sandboxing skipped on Ubuntu 24.04. Also: `/v1/pair/status`
  gained optional `agents`, `tailscale` and `mcpClients`; MCP tools list an `outputSchema` only for object schemas of
  unstaged tools (OpenCode refused the server otherwise); the relay calls `@evolu/common`'s `installPolyfills()` (Node 24
  crash). Owner-dependent and open: Sign in with ChatGPT consent (OpenAI's bot check stops scripted runs), the OpenCode Zen
  Coach turn (no key on this PC), the phone sync proof (phone offline), the ChatGPT desktop app window, and repointing the
  PC wrapper at the main checkout after the merge.

---

## 14. Batch 03 contracts (plan 03 "Final scope" and item 7)

**Status:** normative for v0.4.0 (package A4, 2026-10-03). Owners: E25 (server core, MQTT), E26 (server AI and agents),
E27 (website → server), E28 (one source of truth). Research folded in: R16 (`research/R16-lumen-bridge.md`, Lumen Health as
the ring bridge → §14.5), R17 (`research/R17-headless-node.md`, the store headless in Node → §14.1, §14.4), R18
(`research/R18-server-exposure.md`, exposure, tokens, Sign in with ChatGPT on a server, remote MCP → §14.2–§14.4).
Points those reports left unverified are named where they occur. Where this section and §7 disagree, this section wins for
v0.4.0; §7 stays as the history of the Companion.

**What changes in one paragraph.** The Companion stops being something a person installs. The headless server on oci-arm
(role `home`) holds each person's store in plaintext, runs sync, the AI proxy, Sign in with ChatGPT, the keys, the MCP
endpoint for agents and an MQTT broker for Lumen Health. The website and the installed PWA talk to it over HTTPS with a
device token. Inside Vitals, each record has one truth: a correction, else the device, else nothing.

**New command domain:** `biometrics` (add to `CommandDomain`) for the correction commands. Server pairing, provider keys, agent
tokens and MQTT credentials are server calls through `src/net`, not commands (they hold no document state). Rows: `docs/COMMANDS.md` §12.

### 14.1 Server roles and config · owner **E25**

| Role | Holds | Can read health data | Runs | Default bind |
|---|---|---|---|---|
| `relay` | Evolu relay store (ciphertext) and encrypted blobs, for any number of owners | no | `wss /sync`, `/blobs/…`, `GET /health` (today's `vitals-companion sync`, unchanged) | `127.0.0.1:4870` |
| `home` | everything `relay` holds, plus one plaintext replica per person (`persons/<id>/`) | **yes**, for the persons it hosts | relay + headless person store + command bus + ingest + AI proxy + Sign in with ChatGPT + MCP + MQTT broker | `127.0.0.1:4870` (HTTP), MQTT per §14.5 |

- One package and one binary: `packages/companion` is renamed in place to the server package (directory move is E25's
  choice); the binary is `vitals-server`. `vitals-companion` stays as an alias that prints a one-line notice for one
  release.
  (I3: the package keeps its directory and name `vitals-companion`, version 0.4.0, matching the website's `MIN_SERVER_VERSION`. `pnpm --filter vitals-companion build` bundles the person program to `dist/person-worker.mjs` and packs a deployable directory `packages/companion/dist/server`; on the host run `npm install --omit=dev --legacy-peer-deps` inside it. The repo checkout is not needed on the host. `deploy/oci-arm.sh` deploys it, `deploy/oci-arm-rollback.sh` rolls back.)
- `home` refuses to start bound to a non-loopback, non-tailnet address unless `tls` is configured in the config file
  (public exposure behind Caddy is an owner decision, PLAN "Open for the owner").
- `GET /health` → `{ version, role: 'relay'|'home', persons: number, ownerCount: number, mqtt: 'on'|'off' }`; nothing
  secret, no person labels.

**Config file** `$XDG_CONFIG_HOME/vitals-server/server.json` (0600; never holds a secret):
```ts
interface ServerConfig {
  schema: 'vitals.server/1';
  role: 'relay' | 'home';
  listen: { host: string; port: number };            // HTTP; 127.0.0.1:4870 by default
  publicOrigin: string;                              // what browsers use, e.g. https://<host>.<tailnet>.ts.net:8443
  publicHosts?: string[];                            // extra Host names accepted, e.g. server.example.com (R18 §7 item 1)
  allowedOrigins: string[];                          // §14.2; default ['https://vitals.creative.desi']
  dataDir: string;                                   // default $XDG_DATA_HOME/vitals-server
  mqtt?: { enabled: boolean; tcp?: { host: string; port: number }; ws?: { path: '/mqtt' } };   // §14.5
  tls?: { certFile: string; keyFile: string };       // only for a direct public bind
  limits?: { aiRequestsPerMinute?: number; bodyBytes?: number };
}
```
The process starts with `umask 077`, so every file and directory it creates (Evolu's database and WAL files included)
is 0600/0700 (R17 blocker 7; `vitals-server status` checks the modes). Secrets live only under `dataDir` (below); `server.json` names no key, token or password. Logs go to
stdout/journald, name persons by id only, never print a token, key, password or health value.

**Data directory** (`dataDir`, 0700; every file 0600; created by `vitals-server persons add`):

| Path | Contents | Notes |
|---|---|---|
| `relay/` | relay store, blobs (as §7.2) | shared by all owners, ciphertext only |
| `admin.token` | CLI admin bearer (hash stored, value printed once) | local CLI only, never accepted with an `Origin` (I3: the file holds only the hash; `vitals-server admin-token` prints a new token) |
| `persons/index.json` | `[{ id, label, createdAt }]` | `id` = 16 lowercase hex chars, random, never reused; `label` is a display name |
| `persons/<id>/vitals-<id>.db` | the person's plaintext Evolu replica (SQLite, better-sqlite3; Evolu chooses the file name) | written only through the command bus, ingest and sync |
| `persons/<id>/local.db` | the local-only collections (`changeLog` undo, `commandLedger` idempotency keys, `jobs`, `aiUsage`, `bioScores`, `derived`, …; `src/store/collections.ts`) on a better-sqlite3 `PersistenceBackend` | R17 blocker 3: in memory in the spike; idempotency keys matter for MCP retries and MQTT replays |
| `persons/<id>/blobs/` + chunk index | raw sample bytes (Node `BlobBackend`), uploaded to the relay's `/blobs` like a browser's | R17 blocker 2 |
| `persons/<id>/owner.key` | the 32-byte owner secret, raw bytes | how the replica joins the person's sync group; read only into `sync.open`; never logged, never in `person.json`, never returned by a route |
| `persons/<id>/person.json` | `{ label, timeZone, deviceId, relayUrl, createdAt }` | `deviceId` is fixed at creation (R17 blocker 5) |
| `persons/<id>/devices.json` | device and agent tokens: `{ id, kind, label, origin?, scope, hash, createdAt, lastSeenAt, revokedAt? }` | SHA-256 of the token only (I3: agent tokens live in this same file, with an optional `client` field; their ids are UUIDs) |
| `persons/<id>/credentials/providers.json` | API keys per preset (`nim`, `opencode-zen`) | never returned to any client |
| `persons/<id>/credentials/siwc.json` | Sign in with ChatGPT tokens | refreshed in place |
| `persons/<id>/mqtt.json` | MQTT credentials: `{ username, passwordHash (scrypt), baseTopic, createdAt, revokedAt? }[]` | §14.5 |
| `persons/<id>/usage.jsonl` | one line per AI request: `{ at, preset, model, inputTokens, outputTokens, status }` | no prompt text |
| `persons/<id>/ingest/wal.jsonl`, `installations.json` | write-ahead log of acknowledged MQTT messages; last device and firmware per Lumen installation (§14.5) | compacted when all entries are done |
| `persons/<id>/deadletter/<YYYY-MM-DD>.jsonl` | rejected events with reason (§14.5) | kept 30 days (I3: the date is UTC) |
| `persons/<id>/backup/` | `vitals-server backup <id>` output | |

**Person runtime (R17).** The command bus and document runtime are module singletons, so the server runs **one
`worker_threads` Worker per person** with the bundled person program (about 100 MiB each in the spike), opened on the
first request for that person and closed after 15 minutes idle (rescoring flushed first). The main thread owns HTTP,
MQTT, tokens and routing; it passes `PersonContext` to the right worker and never opens a person store itself. Inside
the worker: `installPersistenceBackend`, `startLivingAutomation()`, the person's time zone from `person.json` as the bus's
`tz` port (never the host zone; R17 blocker 4). Commands that need a port the server lacks (the planner pool, pdf.js,
the vision port; R17 blockers 10 and 12) answer `precondition_failed` with `detail.reason = 'not_on_server'`, and §14.4
leaves them out of the server's tool list until a Node port exists.
(I3: the planner is not on the server; its commands answer `precondition_failed` with `detail.rule = 'not_on_server'`.)

**Trust, stated plainly.** Whoever holds a person's owner secret can read and change all of that person's data. A `home`
server holds it, because it does the work while the person's devices are off. Settings › Server says so (§14.7).

**CLI (admin only, local):** `vitals-server init --role home`, `persons add <label> [--join]` (with `--join` the
person's sync phrase is read from stdin with echo off, never from argv or an environment variable, so the replica joins
an existing sync group; without it a new secret is made; prints the person id), `persons list`,
`devices code <person> [--label]` (§14.2), `devices list <person>`, `devices revoke <person> <deviceId>`,
`mqtt add <person>` / `mqtt revoke <person> <username>` (§14.5), `siwc import <person> <file>` / `siwc login <person> --callback-port <n>` (§14.3),
`keys import <person>`, `status`,
`backup <person>`, `service --write`, `doctor`. There is no admin web page in v0.4.0.
(I3: the implemented CLI is `init`, `persons add|list|remove`, `pair code` (alias `devices code`), `devices list|revoke`, `mqtt add|revoke`, `admin-token`, `status`, `backup`, `restore`, `serve [--app <dir>]`, plus `siwc`, `keys`, `agent-token` and `agents register`; there is no `service --write` or `doctor` for the server.)

**Migration of the owner to person 1 on oci-arm (E25, run once with the owner present):**
0. Owner, first: R18 §6 found oci-arm's swap 99 % used with 5.9 GB RAM free; check what holds swap before adding the
`home` role (about 100 MiB per open person worker, R17). 1. Back up `relay/` as it is today. 2. `vitals-server init --role home` (keeps the existing relay data and port 8443
behind `tailscale serve`). 3. `vitals-server persons add <owner label> --join`, pasting the owner's sync key from
Settings › Sync on this PC; the replica pulls the owner's history through the relay and reports the document count.
4. Delete the 9 QA owners from `relay/` (default yes per PLAN; skipped if the owner says no). 5. Pair the website on
this PC and the phone PWA (§14.2). 6. Move the owner's provider keys (`vitals-server keys import`) and the ChatGPT
sign-in (`siwc export` on this PC, then `siwc import` on oci-arm, §14.3; owner present, it rotates the live session). R17 ran the store, the bus and `bio.import` headless in
Node from a person directory through `evoluNode.ts`; joining the owner's existing history over the relay at real size was
not measured there, so E25's migration log records the document count and the time it took.
(I3: the relay data on oci-arm is `~/.local/share/vitals-companion`, not `~/.vitals`; `deploy/oci-arm.sh` copies it to `~/.local/share/vitals-server/relay`. The step list with real command names is in docs/SERVER.md "Migration steps".)

### 14.2 Device tokens and pairing · owner **E25** (server) and **E27** (website)

Measured by R18 (`research/R18-server-exposure.md` §1–§3): Chrome 153 treats every tailnet address (100.64.0.0/10, so
also `*.ts.net` names and public names that resolve to 100.x) as **local network**, so the website asks once per site
for the "local network" permission whatever name is used; the site's CSP blocks raw `http://100.x`; SSE passes
`tailscale serve` unbuffered; the Companion's Host guard refuses any non-`ts.net` name. Default exposure for v0.4.0:
bind `127.0.0.1:4870`, `tailscale serve --https=8443` (tailnet only). A nicer name behind Caddy
(`server.example.com`, R18 §6) is optional and needs `publicHosts` in `server.json`.

**Flow.** A code is issued by the admin (`vitals-server devices code <person> [--label "Phone"]`) or by an already paired
device of that person (Settings › Server › "Add another device"). Codes: 8 digits, 10 minutes, 5 wrong attempts lock
it, single use; several open codes per person at once; each tied to one person. The issuer shows:
- the QR string `vitals-server:1?u=<urlencoded https base URL>&c=<code>[&n=<label>]` (mirrors `vitals-sync:1`; never
  carries a token), as a QR in Settings or in the terminal;
- a link `https://vitals.creative.desi/settings?section=server#<the same string>` (the fragment never reaches Netlify).

The person scans the QR (the existing scanner in Settings), opens the link, or types the server address and the code.
Before the first request Settings › Server explains the "local network" question in plain words. Only `https://` server
addresses are accepted.
(I3: the code is shown as two groups of 4 digits; https is required for `localhost` too; codes are stored hashed in `<dataDir>/pair-codes.json`, and 5 wrong guesses lock all open codes, not one.)

| Method + path | Auth | Body | Response | Errors |
|---|---|---|---|---|
| `POST /v1/pair/code` | device token (issues for its own person) or admin token (`{ person }` required) | `{ label?: string; person?: string /* admin only */ }` | `200 { code, expiresAt, qr: string }` | `401`, `403 wrong_kind`, `429 rate_limited` |
| `POST /v1/pair/device` | none; `Origin` must be allowed if present | `{ code: string; label?: string }` (label ≤ 40 chars, default "Browser on <platform>") | `200 { token, deviceId, person: { id, label }, server: { version, role } }` | `400 bad_request`, `403 origin_not_allowed`, `401 invalid_code` (+`attemptsLeft`), `410 expired`, `423 locked`, `429 rate_limited` |
| `GET /v1/pair/status` | device token | — | `{ deviceId, label, kind, scope, person: { id, label }, createdAt, lastSeenAt, server: { version, role, mqtt } }` | `401 unauthorized` / `revoked` |
| `GET /v1/devices` | device token (kind `device`) | — | `{ devices: Array<{ id, kind, label, scope, createdAt, lastSeenAt, current: boolean }> }` | `401` |
| `DELETE /v1/devices/{id}` | device token (kind `device`) of the same person, or admin | — | `204`; the revoked device's next request gets `401 revoked` | `401`, `404 not_found` |

**Sync after pairing** (plan 04 decision 5, R20-PAIR, L-SYNC). Pairing turns sync on. Right after pairing to a `home`
server the browser asks once for the person's sync key with `POST /v1/sync/key` (device token of kind `device`, scope
`full`, body `{}`), answered `200 { key: <base64url 32 B>, format: 'owner-secret-v1' }` with `Cache-Control: no-store`
and `Pragma: no-cache`, and an audit line with the device id. It works once per device and only inside the pairing
code's 10-minute window: a second call is `409 already_issued`, a late one `410 window_closed`, another token kind or
scope `403 wrong_kind`. The key is only ever in that response body (never a URL, query, log line, page or storage
outside the sync vault). The browser then joins the person's sync group as it would with the 24 words (`sync.join`,
merge by default when it already holds data; a device that syncs with another key is told so, never switched). A
`relay`-role server has no such route (`404`) and keeps the words path; the 24 words stay the backup.

**Tokens.**
- `token` = 32 random bytes base64url. The server keeps only its SHA-256 (constant-time lookup) in `devices.json` with
  `{ deviceId, kind, person, label, originAtPairing?, scope, createdAt, lastSeenAt }`. Kinds: `device` (browsers and
  PWAs), `agent` (§14.4), `admin` (CLI, never accepted with an `Origin`). Tokens are **not bound to an origin** (R18 §3);
  the origin rule below applies to every request instead.
- Browser storage: `localStorage` key `vitals.server.v1` = `{ baseUrl, token, deviceId, person: { id, label }, pairedAt }`
  (same pattern as the Companion pairing; IndexedDB adds no protection against script on the same origin, and the CSP
  limits script to `'self'`, R18 §3). Device-local: never in a synced document, never in an export, never in a URL.
  Cleared by "Forget this server" and by any `401`.
- Sent as `Authorization: Bearer <token>`. A token in a query parameter or body is ignored and the request is answered
  `401`.
- **Origin and Host rules.** A request carrying an `Origin` header is refused (`403 origin_not_allowed`) unless the origin
  is on `allowedOrigins` (default `https://vitals.creative.desi`, which covers the installed PWA; deploy previews and
  `http://localhost:<port>` only when listed). The `Host` must be a `ts.net` name, loopback, or one of `publicHosts`.
  CORS answers exactly the allowed request origin, `Access-Control-Allow-Headers: authorization, content-type,
  mcp-session-id`, `Access-Control-Max-Age: 7200`, `Access-Control-Allow-Private-Network: true`, no credentials mode.
- (I3: bearer to person goes through one point, `home.resolvePerson`; the preflight for pairing and device routes answers GET, POST, PUT and DELETE.)
- Rate limits per device and per source IP; logs carry `deviceId`, never the token (R18 §7 item 9).
- `src/net` stores the paired server origin with `allowOrigin(origin, 'server')` (new `NetPurpose` `'server'`, replacing
  `'companion'`); no CSP change is needed (`https:` is already in `connect-src`, R18 §7 item 4).

**What every route derives from the token:** exactly one `{ personId, deviceId, kind, scope }`. Every handler receives a
`PersonContext` built by one function `resolvePerson(req)`; no handler reads a person id from the path, query, body or a
header other than `Authorization` (the admin-only `person` field of `POST /v1/pair/code` is the one exception, admin
token only). Paths never contain a person id (except the relay's own `ownerIdHash` routes, which carry ciphertext only).
A revoked or unknown token → `401`; a token of the wrong kind for a route → `403 wrong_kind`.

```ts
interface PersonContext { personId: string; deviceId: string; kind: 'device' | 'agent'; scope: AgentScope | 'full';
  worker: PersonWorker /* §14.1, opened on demand */; log: Logger /* prefixed with personId */ }
```

### 14.3 Providers via the server · owner **E26** (server) and **E27** (website)

**Which presets go where.** Browser-direct presets (the person's own key kept in the browser, CORS allowed) stay as they
are. The three presets that needed the Companion become **"via your server"**: `siwc` (Sign in with ChatGPT), `nim`
(NVIDIA NIM), `opencode-zen` (OpenCode Zen). They are listed again in Settings › Coach, enabled only while a server is
paired; without one the row reads "Needs your Vitals server" with a link to Settings › Server.

**Routes** (all: device token of kind `device`; `Origin` allowed if present; body ≤ 8 MB; per-person rate limit):

| Method + path | Body | Response |
|---|---|---|
| `GET /v1/ai/status` | — | `{ presets: Array<{ id: 'siwc'|'nim'|'opencode-zen'; label; ready: boolean; account?: string /* e.g. ChatGPT plan name, no e-mail */ }> }` |
| `PUT /v1/ai/keys/{preset}` | `{ key: string }` (preset `nim` or `opencode-zen`) | `204`; the key is written to `credentials/providers.json` and never returned |
| `DELETE /v1/ai/keys/{preset}` | — | `204` |
| `GET /v1/ai/siwc/status` | — | `{ signedIn: boolean; plan?: string; expiresAt?: string }` per person |
| `POST /v1/ai/siwc/logout` | — | `204`; removes the person's ChatGPT tokens on the server |
| `GET /v1/ai/{preset}/models` | — | upstream list, passed through |
| `POST /v1/ai/{preset}/{path}` | the provider body the adapter builds today (`chat/completions` for `nim`/`opencode-zen`, `responses` for `siwc`) | upstream response; streaming passed through as `text/event-stream` |
| `GET /v1/ai/usage` | — | `{ today: { requests, inputTokens, outputTokens }, cap?: { requestsPerDay } }` from `usage.jsonl` |

(I3: also `GET /v1/ai/{preset}/probe` → `{ ready, models }` or `{ ready: false, error }`. The routes are mounted on the home role in `packages/companion/src/home/aiMount.ts`; the person comes from `home.resolvePerson`. The preflight for `/v1/ai/*` and `/v1/agents/*` answers GET, POST, PUT, DELETE.)

**Sign in with ChatGPT on the server (R18 §4).** OpenAI offers no device-code flow, and a `127.0.0.1` callback reaches
the machine running the browser, not the server. So the sign-in is an admin step, done once per person: default
`vitals-server siwc import <person>` of a file made by `siwc export` on the machine where the person signed in. It is a
**move**: the export removes the local copy, because refresh tokens rotate and the second side to refresh would get
`refresh_token_reused`; the server keeps its own install id and takes only the client id (OpenAI "Self-hosted VMs").
Fallback: `vitals-server siwc login <person> --callback-port <n>`, which prints the `ssh -L <n>:127.0.0.1:<n> <host>`
line and the sign-in address to open on the person's own computer. The server owns all later refreshes. The browser has
no sign-in route.

What the browser sends: `{ preset, model, body }` expressed as the path and the body above; never a key or a ChatGPT
token. What the server adds: the person's key or ChatGPT access token from `persons/<id>/credentials/` (refreshing it when
it is within 60 s of expiry), the `siwc` rewrites the Companion already applies (`store:false`, unsupported parameters
dropped, tools namespaced: `proxy.ts`), and a usage line. Streaming: the server pipes the upstream SSE body chunk by
chunk without buffering (`X-Accel-Buffering: no`, flush per chunk); a client abort cancels the upstream request.

**Error contract** (I3: AI and agent routes answer `{ error: { code, message } }`; pairing, device and MQTT routes answer `{ error: "<code>", message }`; the web client reads both. Extra codes: `daily_cap`, `wrong_kind`, `bad_request`, `too_large`, `not_found`.) (JSON `{ error: { code, message } }`; `message` is shown to the person as is, so it is plain words and
names no file, module, route, package or plan id):

| HTTP | `code` | `message` (exact) |
|---|---|---|
| 401 | `unauthorized` | "This device is no longer connected to your server. Connect it again in Settings › Server." |
| 401 | `revoked` | "This device was removed from your server. Connect it again in Settings › Server." |
| 409 | `not_signed_in` | "ChatGPT isn't signed in on your server yet. Whoever runs your server can do that once." |
| 409 | `no_key` | "Add a key for this service in Settings › Coach first." |
| 429 | `usage_limit` | "Your ChatGPT plan's limit is reached for now. Try again later or pick another service." |
| 429 | `rate_limited` | "Too many requests in a short time. Wait a minute and try again." |
| 502 | `upstream_error` | "The AI service answered with an error. Try again in a moment." (+ upstream status in `detail.status`) |
| 502 | `key_refused` | "<Service> refused the key kept on your server. Replace it above." (the service answered 401, 403 or 410 to a key; names the service, e.g. "NVIDIA NIM"; never HTTP 401, which the website reads as an unpaired device; `detail.status` holds the upstream status) |
| 504 | `upstream_timeout` | "The AI service did not answer in time. Try again." |
| 503 | `server_busy` | "The server is busy with other people right now. Try again in a minute." (`Retry-After: 60`; the website shows it as a passing state, not as a broken server) |
| — (fetch failed) | `server_unreachable` (client-side) | "Your Vitals server can't be reached. Check that it is running and that this device is on your private network." |
| — (blocked by the browser) | `local_network_denied` (client-side) | "This browser blocked the connection to your server. Allow \"local network\" access for this site in the browser's site settings." |

A test scans every `message` for the forbidden-text list (§9.3 guard tests) and for the words "Companion", "proxy",
"preset", "token", "MCP".

### 14.4 Agents via the server · owner **E26**

- **Endpoint:** `POST|GET|DELETE /mcp` on the server's `publicOrigin`, Streamable HTTP, authenticated by an **agent
  token** (kind `agent`, no `Origin` header required; a request that does carry an `Origin` must be on the allow-list).
  Tools execute **server-side** against the person store through the same command bus (`dispatch` with
  `actor: { kind: 'mcp', id: <client name> }`); no browser tab is involved. The tab bridge (`agentHub.ts`,
  `/v1/agent/*`, `NO_TAB_MESSAGE`) is removed. R17 proved the tool-call path headless
  (`guardedCall(createBusAgentDispatcher(), …)` in the person worker). Commands answering `not_on_server` (§14.1) are left
  out of the server's tool list; a test derives that list and fails if a listed tool answers `not_on_server`.
- (I3: agent tool calls run in the person worker through the worker ops `agentManifest` and `agentCall` (`home/personRpc.ts`); agent tokens are stored in `devices.json`, ids are UUIDs. The old bridge (`agentHub.ts`, `/v1/agent/*`, the bridge WebSocket, old `/proxy/*`) is not removed yet: it is only active in the old `vitals-companion` agent role. Open item.)
- **Tools exposed:** `manifest('mcp')` (§1.8, `toolManifest.ts`) filtered by the token's scope. Destructive tools are
  never listed and never executed. Consequential writes (class `edit`) are **staged as proposals** (`coach.pending`), which
  sync to every device and are applied by the person in the app; `log` class writes run directly with undo.

| Scope (`AgentScope`) | Listed tools | Writes |
|---|---|---|
| `read` | `read` class only | none |
| `log` (default) | `read` + `log` | `log` direct, with undo |
| `edit` | `read` + `log` + `edit` | `edit` staged as proposals; never applied by the agent |

(I3: on the server agents never apply edits directly; edits are always staged.)

- **Briefing for agents** (plan 04 item 12, L-MCP): every MCP server built on `packages/companion/src/mcp.ts`
  sends `instructions` at initialize (`MCP_INSTRUCTIONS` in `packages/companion/src/briefingRules.ts`:
  the Coach's rules only, no personal data), offers the read tool `briefing_get` (command `briefing.get`: the Coach's own
  briefing, built by the same builder and filtered by the same Coach visibility switches), the prompt `coach` and the
  resource `vitals://briefing`; prompts and resources go through the same token scope and limits as tools. `toMcpTools`
  lists portable output schemas (no `prefixItems` tuples, which MCP clients' draft-07 validation rejects); the toolset
  hash is still computed over the app's own manifest.

- **Token minting** (from the website, Settings › Agents, device token of kind `device`):

| Method + path | Body | Response |
|---|---|---|
| `POST /v1/agents/tokens` | `{ client: 'codex'|'opencode'|'claude'|'chatgpt-desktop'|'other'; label?: string; scope: AgentScope }` | `200 { token, id, mcpUrl, recipes: AgentRecipe[] }` (token shown once) |
| `GET /v1/agents/tokens` | — | `{ tokens: Array<{ id, client, label, scope, createdAt, lastUsedAt }> }` |
| `DELETE /v1/agents/tokens/{id}` | — | `204` |
| `GET /v1/agents/activity` | — | last 50 tool calls: `{ at, tokenId, tool, outcome: 'ok'|'staged'|'rejected'|'error' }` (no arguments) |

```ts
interface AgentRecipe { client: string; title: string; steps: string[]; config?: { file: string; snippet: string } }
```
Recipes are the remote forms R18 §5 checked (Streamable HTTP over the tailnet: transport, bearer and Host check work;
Claude Code connected; Codex accepted the config; OpenCode not verified), with `<url>` = `<publicOrigin>/mcp` and the
token in the environment variable `VITALS_TOKEN` (snippets show a placeholder, never the token):

| Client | Recipe | Verified |
|---|---|---|
| Codex (and the ChatGPT desktop app, which reads the same file; I3: the app shows "Not available yet", a connection to your own server was not confirmed) | `~/.codex/config.toml`: `[mcp_servers.vitals]` `url = "<url>"`, `bearer_token_env_var = "VITALS_TOKEN"` | config accepted; a real session still to run (E26) |
| OpenCode | `~/.config/opencode/opencode.json` → `"mcp": { "vitals": { "type": "remote", "url": "<url>", "headers": { "Authorization": "Bearer {env:VITALS_TOKEN}" }, "enabled": true } }` | no (`opencode mcp list` was not usable); E26 runs a real `opencode run` |
| Claude Code | `claude mcp add --transport http -s user vitals <url> --header "Authorization: Bearer $VITALS_TOKEN"` (this writes the token value into `~/.claude.json`; the recipe says so) | connected |

- Limits: 60 tool calls per minute per token; at most 4 open MCP sessions per token and 32 per server
  (`MCP_MAX_SESSIONS`); every call logged in `GET /v1/agents/activity` and shown in the app's agent indicator (§7.3).

### 14.5 MQTT ingest from Lumen Health · owner **E25** (broker), **E28** (Devices card)

Facts about the phone side are from R16 (`research/R16-lumen-bridge.md` §1–§3, §5): Lumen Health speaks MQTT 3.1.1 through
Paho 1.2.5, QoS 1 for every event, clean session, up to 10 messages in flight, drains of up to 2,000 rows; a row leaves its
outbox only when the PUBACK arrives, so a PUBACK lost after the broker stored the message causes a resend **with the same
envelope `id`**; it trusts **system CAs only** (no self-signed or private CA); keep-alive 60–900 s (240 by default).

**Broker:** aedes 1.2.x embedded in the server process, `home` role only (R16 §5).

| Listener | Where | TLS |
|---|---|---|
| `wss` on the HTTP server at path `/mqtt`, WebSocket subprotocol `mqtt` (I3: bridged to an internal loopback TCP listener of aedes) | `wss://<host>.<tailnet>.ts.net:8443/mqtt` (explicit port, R16 §1.4) | the `*.ts.net` certificate from `tailscale serve` (publicly trusted); or Caddy on a public name |
| `tcp` (optional) | `127.0.0.1:1883`, exposed as `ssl://…` only through a TLS-terminating front (`tailscale serve` TCP or Caddy) | from the front; plain `tcp://` is never bound to a non-loopback address |

Default is `wss` because it reuses the HTTPS name and port that already work. **Open for the owner** (PLAN "Final scope",
R16 §7 q2): tailnet name only, or also a public name behind Caddy (the phone's tailnet has been unreliable).
The TCP listener is optional and off by default; R18 did not test a `tailscale serve` TCP form, so E25 documents it only
if it is built and checked.

**Credentials.** `vitals-server mqtt add <person>` or the Devices card button "Create broker login" (device token,
`POST /v1/mqtt/credentials`) makes one credential and returns it once:
```ts
interface MqttCredential { address: string /* full URI to paste, e.g. wss://host:8443/mqtt */;
  username: string /* `p<personId>-<n>` */; password: string /* 24 random bytes base64url, shown once */;
  baseTopic: 'lumen-health/v1' /* Lumen's default; nothing to change on the phone */ }
```
Server side: password stored as scrypt hash in `persons/<id>/mqtt.json`; the username alone resolves the person; the client
id is not used for identity. At most 2 credentials per person; `DELETE /v1/mqtt/credentials/{username}` revokes and
disconnects at once. **Installation pinning** (R16 §7 q3, decided here): the first `installationId` seen on a credential
is pinned to it; publishes under another installation id are refused (dead letter `wrong_installation`, acknowledged).
The Devices card offers "Allow a new phone", which clears the pin.
(I3: the route is `POST /v1/mqtt/credentials/{username}/allow-new-phone`. The web client `src/net/mqtt.ts` grants the server origin with purpose `'server'` and reads the same `vitals.server.v1` pairing.)

**Topics and authorisation.** Lumen publishes to `<baseTopic>/<installationId>/<suffix>` (R16 §2.1, e.g.
`lumen-health/v1/<32 hex>/metrics/hr`). Publish is allowed only under `lumen-health/v1/<pinned installationId>/`. The
broker reads the event type from the CloudEvent `type`, not from the suffix. Subscribe is refused. `retain` is cleared on
every message (the broker keeps no retained copies, R16 §7 q5); the last `health.device.identified` and firmware event
per installation are kept by the server in `persons/<id>/ingest/installations.json` and passed into every import (R16
G5, G6), so a restart loses nothing.

**Write-ahead, then ack (the binding rule; R16 §5).** All work happens in aedes' `authorizePublish` hook, serialised per
person (a promise chain; aedes runs the packets of one socket read concurrently):

| Step | On success | On failure |
|---|---|---|
| 1. size ≤ 256 KB, JSON, CloudEvents 1.0 envelope with `id` and `type` | go on | append to the dead-letter file (fsync), then PUBACK: a bad message must not block the phone's outbox |
| 2. append `{ envelopeId, topic, receivedAt, payload }` to `persons/<id>/ingest/wal.jsonl`, fsync | `cb(null)` → aedes sends PUBACK | `cb(err)` → no PUBACK, connection closed; Lumen resends from its outbox |
| 3. (after the PUBACK, asynchronous) import from the WAL: `lumenCloudEvents.ts` → `BioBatch` (channel `mqtt:lumen`, the person's time zone from their profile, never the host's, R16 G7) → the ingest pipeline (§4.3) → mark the envelope id done | done | dead letter `unknown_type` / `invalid_payload` / `validation_failed` / `import_error` with the envelope id; never retried silently |

On start, WAL entries not marked done are imported before the broker accepts connections. A resend with an envelope id
already in the WAL is acknowledged and skipped. The WAL is compacted once all its entries are done.

**Dead letters:** `persons/<id>/deadletter/<date>.jsonl`, one line `{ at, reason, envelopeId?, type?, bytes, sample: string
/* first 2 KB */ }`; reasons `too_large`, `not_json`, `not_cloudevent`, `wrong_installation`, `unknown_type`,
`invalid_payload`, `validation_failed`, `import_error`. Never written to the store. Counts feed the Devices card.

**Limits per connection:** message ≤ 256 KB (R16: a sleep night is about 6–9 KB); ≤ 100 messages/s sustained (Lumen's
drain is at most about 67/s), above that the broker stops reading the socket for a moment and never drops; ≤ 2
connections per credential; keep-alive accepted up to 900 s.

**Record ids for per-message ingest (decided here; R16 G1, G2, §7 q4).** The importer was built for whole files; one
message at a time must give the same records:
- **Series:** `record_id` = UUIDv5 of `(source, stream, origin, local_date)`, the same window as the stored chunks
  (§4.2); samples merge into it by their `(origin, t)` identity, so one HR sample per message no longer creates one
  record per sample, and a file import and the live stream of the same samples give the same record.
- (I3: one rule in `src/biometrics/core/recordIds.ts`: `recordId({ source: 'file:lumen_cloudevents', kind, metric, start })`; the sleep version is `(complete ? 2e12 : 0) + received_s × 100`. The CloudEvents importer (file and broker) and the archive importer use it, so ids of Lumen data imported before stay the same. `sourceKeyOf` maps `mqtt:lumen` and `file:lumen_archive` to the `file:lumen_cloudevents` source key.)
- **Sleep:** `record_id` = UUIDv5 of `(source, 'sleep', session start)`; the provisional night and the complete one are
  versions of one record (higher `version` wins, §4.1); `is_main` is recomputed per wake date across batches, not per batch.
- Daily records keep their content-derived ids. The envelope `id` stays a delivery key only (WAL, dead letters), never
  recomputed or verified (R16 §3.2).

**Identical-batch rule.** For the same CloudEvents, the file import (`bio.import` of Lumen's JSONL, channel
`file:lumen_cloudevents`) and the broker (channel `mqtt:lumen`, one message at a time) produce the same stored records:
equal `record_id`, `version`, `kind`, time, values and quality flags; provenance equal except `channel` and `ingested_at`.
An event that arrives both ways (history import, then live) is stored once. A history importer for Lumen's own export
(R16 §4 path B) is not part of this section; if one is built, the same rule binds it. (I3: it is built, channel `file:lumen_archive` (E29), and uses the same rule.)

**Devices card "Lumen Health over MQTT"** reads `GET /v1/mqtt/status` (device token):
```ts
interface MqttStatus { enabled: boolean; address: string | null;
  credentials: Array<{ username: string; createdAt: string; connected: boolean; lastConnectAt: string | null }>;
  lastEventAt: string | null;
  eventsToday: Array<{ stream: string /* e.g. 'sleep_sessions', 'steps', 'hr' */; count: number }>;
  /** Newest battery reading of the ring (server 0.4.1 and later; the website treats it as optional). */
  battery?: { percent: number; at: string } | null;
  /** `byReason`: counts over the last 7 days, for "See why" (server 0.4.1 and later; optional for the website). */
  deadLetters: { today: number; last7d: number; lastReason: string | null; byReason?: Record<string, number> } }
```
The card also shows the per-stream switches (`bio.setPolicy`, §4.5; opt-in unchanged: nothing drives scores, the engine
or the Coach until switched on) and the values to paste into Lumen Health (address, username, password once, base topic,
client id), matching docs/SERVER.md "Phone setup". The one-time history import is offered first ("Import your Lumen Health
history before connecting live").

### 14.6 One source of truth · owner **E28**

**(a) Stream ownership.** A stream family is **device-owned** for a person when a source whose channel is not `manual`
has `imported` on for it in the policy matrix (§4.5). Pure function in `src/biometrics/core/policy.ts`:
```ts
type OwnedFamily = 'sleep_sessions' | 'steps' | 'body' | 'resting_hr' | 'hrv' | 'workouts';
function streamOwner(family: OwnedFamily, sources: readonly BioSourceDoc[]): { sourceKey: string; label: string } | null;
```

| Owned family | Hidden manual entry (UI) | Commands redirected for the Coach and agents |
|---|---|---|
| `sleep_sessions` | Today's sleep row input (`PrescriptionRows.tsx`, `logSleep`); `bio.manual` metric `sleep_h` | `log.sleep` |
| `steps` | Today's steps row input (`logSteps`); `bio.manual` `steps` | `log.steps` |
| `body` (weight, body fat; only when a scale feeds it) | Today's weight input (`logWeight`); `bio.manual` `weight_kg`, `body_fat_pct` | `log.measurement` with `weightKg`/`bodyFatPct` |
| `resting_hr`, `hrv` | `bio.manual` `resting_hr_bpm`, `hrv_ms` | `log.measurement` for those metrics |
| `workouts` | none hidden (a training session logged against the plan is a different record); matching stays as §4.5 | — |

Where an input is hidden the row shows the device value with its source label ("7 h 12 min · J-Style ring") and a
**Correct** action that opens the correction sheet. A stream with no owner keeps today's manual logging unchanged.

**Coach and agent rule.** When `log.sleep`, `log.steps`, `log.measurement` or `bio.manual` is dispatched for an owned
stream by an actor other than `ui`, the bus does not write a log entry; it builds the equivalent `biometrics.correct`
input and stages it as a proposal (the result is `{ redirected: 'biometrics.correct', proposalId }`, outcome `staged`).
From the UI the hidden inputs cannot dispatch these commands; a direct UI dispatch for an owned stream returns
`precondition_failed` with `detail.reason = 'device_owned'`. The Coach's tool descriptions say so in one sentence
("If a device records this, your entry becomes a correction for the person to confirm.").

**(b) Correction precedence.** Per record key: **correction > device > nothing.** Keys:

| Record kind | Key | Corrected fields |
|---|---|---|
| sleep night | `sleep:<local_date>` (the main sleep of that date) | `asleep_s`, optional `bedAt`/`wakeAt` (→ `time.start`/`time.end`, `in_bed_s`) |
| daily totals | `daily:<local_date>:<metric group>` (groups of `DAILY_METRIC_GROUPS`: `steps`, `distance_m`, `active_kcal`, `total_kcal`, `resting_hr_bpm`, `hrv`, …) | the group's fields |
| spot value | `spot:<local_date>:<metric>[:<at>]` (`at` given when the day has several readings) | `value` |

```ts
// command `biometrics.correct`: perm write, impact consequential (class edit), surfaces ui+ai+mcp, undo RT, idempotency key
type CorrectionTarget =
  | { kind: 'sleep'; localDate: LocalDate }
  | { kind: 'daily'; localDate: LocalDate; metric: keyof typeof DAILY_METRIC_GROUPS }
  | { kind: 'spot'; localDate: LocalDate; metric: SpotRecord['metric']; at?: Instant };
interface CorrectInput { target: CorrectionTarget;
  value: { asleepS: number; bedAt?: Instant; wakeAt?: Instant } | { fields: Partial<DailyRecord> } | { value: number };
  note?: string /* ≤ 500 chars, e.g. "slept six hours, the ring was off" */ }
interface CorrectOutput { correctionId: string; key: string; replaced: { sourceKey: string; recordId: string } | null }
// command `biometrics.clearCorrection`: perm write, impact low (class log), surfaces ui+ai+mcp, undo RT
interface ClearCorrectionInput { key: string }
```
- **Propose → apply.** From the UI the correction sheet shows "Device: 5 h 10 min → Yours: 6 h 00 min" and applies on
  confirm (the same propose → apply path as other `edit` commands); from the Coach or an agent it is staged and the person
  applies it from the proposal card.
- **Storage.** New collection `bioCorrections` (`vitals.bio_correction/1`), document key = the correction key:
  `{ key, target, value, note?, createdAt, actor, replaced: { sourceKey, recordId, version } | null, clearedAt? }`. Ingest
  never writes this collection, so a later device record, a replayed MQTT message or a re-import for the same key can
  never replace a correction (**replay-proof**). Device records keep arriving and are stored with provenance as before.
- **Marker and undo.** Every corrected value shows a small "corrected" marker with the time and an action "Use the device
  value again" (`biometrics.clearCorrection`). Undo of `biometrics.correct` (RT) and `clearCorrection` both bring back the
  device value, if there is one. Exports carry corrections as their own records.
- **What `resolve.ts` returns.** `resolveDays(records, sources, opts, corrections)` gives one resolved record per key, with
  where it came from:
```ts
type Basis = 'correction' | 'device' | 'manual';   // 'manual' only for streams without a device owner
interface ResolvedDay { /* existing fields */ basisByMetric: Record<string, Basis>;
  corrections: Array<{ key: string; correctionId: string; deviceValue: unknown | null }> }
```
  The engine, the planner, scores, `today.get`, `bio.daily` and the Coach briefing read only the resolved view; scores of a
  corrected day are recomputed (`bio.rescore` from that date) and the score's `sourceIds` include the correction id.
- **No priority lists.** When several device sources report the same metric on a day, the fixed order is: device tier A >
  B > C, then the source with more coverage that day (sleep: longer `asleep_s` window recorded; daily: more fields
  present), then the most recent `ingested_at`, then `sourceKey`. `bio.setSourcePriority` is **removed** (registry,
  manifest, fixture, COMMANDS row, the Coach tool list); the "Source priority" block in Settings › Devices is removed;
  stored `priority` and `priorityByMetric` on `BioSourceDoc` are ignored by `resolve.ts` and dropped by a one-time
  migration (`biometrics.dropPriorities`, system actor, idempotent). Existing `bio.manual` records on an owned stream are
  migrated into `bioCorrections` only when they differ from the device value of that key; otherwise dropped as
  duplicates (migration report in the job log).

### 14.7 Server settings page and Install section · owner **E27** (design D3)

**Settings › Server** (new section id `server`, replaces the Companion parts of Sync, Coach and Agents):

| State | Shows | Actions | Errors shown |
|---|---|---|---|
| `none` | One sentence on what the server does; the "local network" explanation (§14.2); fields "Server address" and "Connection code"; Scan a code | Connect | invalid address ("That doesn't look like a web address."), `invalid_code`, `expired`, `locked`, `origin_not_allowed` ("This server doesn't accept this website yet. Ask whoever runs it to add it."), `local_network_denied`, unreachable, an `http://` address ("Use the https:// address of your server.") |
| `connecting` | progress, then "Setting up sync…" while `sync.join` runs | Cancel | as above |
| `connected` | person label, server address, version, role and what it can read ("Your server keeps a readable copy of your data so the Coach and agents work without this browser."), last contact, sync state (from `sync.status`), this device's label | Check now, Add another device (shows a code and QR, §14.2), Forget this server | — |
| `unreachable` | last contact time, "Your server can't be reached." | Check now | — |
| `revoked` | "This device was removed from your server." | Connect again | — |

Devices list (in `connected`): label, kind (browser / agent), last seen, "This device" tag; Remove (confirm dialog;
removing an agent token also lives in Settings › Agents). Opening the pairing URL (§14.2) lands on this section with the
fields filled and asks once "Connect this device to <host>?".

**Settings › Coach:** the three presets of §14.3 listed with "via your server"; ChatGPT shows "Signed in on your server"
or "Not signed in yet. Whoever runs your server signs in once." (§14.3, no sign-in button in the browser). Keys for NIM and Zen are typed once and sent to the server (`PUT /v1/ai/keys/{preset}`); the field then
reads "Saved on your server".

**Settings › Agents:** the server MCP address, "Create access for an agent" (client, scope radio read / log / edit with
one line each), the token shown once with the recipe steps, the list of agent tokens with last use and Remove. WebMCP
stays as it is.

**Settings › Devices:** the "Lumen Health over MQTT" card (§14.5); the source priority block removed (§14.6).

**Install section:** "Install Vitals on this device" (PWA install, as today, plus where the browser puts it) and "Run
your own Vitals server" (one paragraph and a link to docs/SERVER.md). No Companion download, no terminal command for a
person, no pairing-code instructions.

All of it: plain words, kJ next to kcal where energy shows, both themes, 390/768/1440 px.

### 14.8 Removal of the Companion as a user install · owners **E27** (UI) and **E25** (package, docs)

| Goes | Stays |
|---|---|
| Companion pairing UI (8-digit code panel, local-network explanation, `PairingCodePanel` use for the Companion, `CompanionError('not_paired')` paths) | the sync pairing between browsers (words/QR) for people without a server |
| Settings copy and the Coach notice that mention the Companion; `NetPurpose` `'companion'` (→ `'server'`) | the server package and its CLI for admins (`vitals-server`) |
| the tab bridge for agents (`agentHub.ts`, `bridgeProtocol.ts`, `/v1/agent/manifest`, `/v1/agent/call`) | `/mcp` (now executing server-side), `vitals-mcp` stdio for an admin on the server host |
| `POST /v1/pair/local` (origin-bound browser tokens), `POST /v1/pair/client` (replaced by agent tokens) | `/v1/pair/code`, `/v1/pair/status` with the §14.2 shapes, `/v1/pair/device`, `/v1/devices/*` |
| `docs/COMPANION.md` as a person's guide (replaced by docs/SERVER.md; the old file keeps a one-line pointer) | `/v1/ingest` canonical batches, now per person via device token |
| `vitals-companion install` wrapper for a person's PC | `vitals-server service`/`doctor` for the host |

A guard test fails if the built app contains the word "Companion" in any screen text or the old local-pairing copy
(the 8-digit "code from your terminal" instructions). The "local network" explanation of §14.2 stays: it is about the
browser's permission for the server.

### 14.9 Test contracts

| Test | Owner | What it proves | Pass condition |
|---|---|---|---|
| **Two-person isolation** (property) | E25 | Two persons on one `home` server (even though production has one): random sequences of commands, AI calls (stubbed upstream), MCP calls, MQTT publishes and device-list calls, each under a randomly chosen token of person A or B | No response, tool list, proposal, usage line, dead letter, MQTT status or store document of one person ever contains an id or value written by the other; a token of A on any route of §14.2–14.5 never reads or writes B's directory (checked by filesystem audit of `persons/B/` mtimes); a person id in a query parameter or body is ignored |
| **Token rules** | E25 | origin and Host rules, revocation, query-parameter tokens | any token with a non-allowed `Origin` → 403; an unknown Host → 403; revoked → 401 `revoked` within one request; `?token=` → 401 |
| **Correction / replay** | E28 | correction > device > nothing, replay-proof | device sleep 5 h 10 min → correct to 6 h → resolved 6 h, `basis: 'correction'`; replay the same MQTT stream and a file re-import → still 6 h; a newer device version of that night → still 6 h, the device record stored; `clearCorrection` → the newest device value; undo of `correct` → device value; scores of the day recomputed with the correction id in `sourceIds` |
| **Owned-stream redirect** | E28 | the Coach cannot log over a device | with sleep owned, a Coach `log.sleep` yields a staged `biometrics.correct` proposal and no log entry; UI dispatch → `precondition_failed` `device_owned`; with sleep not owned, `log.sleep` works as before |
| **No priority** | E28 | `bio.setSourcePriority` gone | not in the registry, the manifest or the Coach tools; stored priorities have no effect on `resolveDays`; migration idempotent |
| **Identical batch** | E25 | file ≡ broker | `qa/fixtures/lumen/cloudevents.synthetic.jsonl` through `bio.import`, and `mqtt-stream.synthetic.jsonl` (same events, R16 §2.4) one message at a time through a real MQTT client (`mqtt` package, QoS 1) into the in-process broker, give equal records up to `channel` and `ingested_at`; the second path adds zero records; the night sent twice (provisional, complete) is one sleep record |
| **Ack after write** | E25 | no loss | with the WAL append made to fail, no PUBACK is sent and the client redelivers; a hook delay of 2 s delays the PUBACK by ≥ 2 s (R16 asks for this measurement); a resend with the same envelope id after a lost PUBACK is stored once; a WAL entry left undone at shutdown is imported at start; malformed events land in dead letters with the right reason and are acknowledged |
| **Website through the server, Coach with tools** | E27 + E26 | the binding test rule of PLAN "Final scope" | the built website (Playwright, Chromium) paired to the server by code; Coach on `siwc` (owner's sign-in once, then recorded fixtures replayed by a stub upstream in CI) receives a typed message, streams a reply, calls at least one read tool and one `log` tool, the log entry appears in a second browser profile through sync within 5 s; same journey on oci-arm before the tag |
| **Agent through the server** | E26 | no tab needed | with no browser open, an MCP client (the SDK client in the test; Codex on the owner's PC for the release proof) lists tools with an agent token, calls a read tool and an `edit` tool; the edit appears as a proposal on the website; destructive tools absent; a `read`-scope token cannot call a `log` tool |
| **Error wording** | E27 | §14.3 table | every error message renders as specified and passes the forbidden-text scan |

---

## 15. One app everywhere (plan 04, v0.5.0)

**Status:** normative for v0.5.0 (package A5b, 2026-10-04). Plan: `plan/04-next/PLAN.md` items 1–12 and decisions 1–13.
Owners: `L-RINGSVC` (ring service, item 11 defaults), `L-PAGES` (Ring and Body signals pages), `L-SYNC` (pairing turns
sync on), `L-DESKTOP` (Electron), `L-ANDROID` (Capacitor), `L-WEB` (downloads block), `S0` (`src/platform/` stub,
completed by `L-WEB`). The ring library (`packages/rings`: `RingFamily`, `Protocol`, `Transport`, `TransportFactory`,
`openRingSession`, `RingSession`, `RingError`, `ringIdentity`, `ringSourceKey`, `ringRecords`, `reconnectDelayMs`) is
A5a's contract (`packages/rings/src/types.ts`, `records.ts`); the platform transports are `L-XPORT`'s
(`src/biometrics/ble/transports`: `pickTransport()`, `requestDevice`, `reconnect`, `NoDeviceError`). This section uses
them and does not redefine them. Visual design of every screen named here
is `L-AUDIT`'s `design/screens/ring-pages.md`. Where this section and §4.5, §4.6 or §14 disagree, this section wins for
v0.5.0.

**What changes in one paragraph.** One web build runs in four places: the website, the installed PWA, an Electron
desktop app and a Capacitor Android app. Each place reports what it is (`src/platform/`) and what it can do; nothing
else in the app branches on user agents. A ring service in the app connects to the person's known rings on its own,
holds one link per ring, reads history since the last read, and writes records with provenance into the biometrics
store, so sync carries them to every device. A ring talks to one device at a time; every device shows where it is
connected and offers "Connect here instead". Ring data is shared with the plan, scores, Coach and agents by default.
Pairing a server turns sync on. The website's first screen offers the apps; the apps never show that block.

### 15.1 Platform detection (`src/platform/`, tier H) · owner **S0** (stub), **L-WEB**

```ts
export type Platform = 'web' | 'pwa' | 'electron' | 'android';
export interface PlatformCaps {
  platform: Platform;
  ble: 'web-bluetooth' | 'capacitor' | 'electron' | null;   // the transport `pickTransport()` returns (L-XPORT)
  keepAlive: boolean;          // the link may outlive the visible window (Android foreground service, desktop tray)
  installedApp: boolean;       // electron | android: no downloads block, no PWA install section
  mcpHost: boolean;            // electron only (§15.6)
  os: 'android' | 'ios' | 'windows' | 'macos' | 'linux' | 'chromeos' | 'other';
}
export function platform(): Platform;            // decided once at boot, then frozen
export function platformCaps(): PlatformCaps;
export function shell(): ShellBridge;            // §15.8; a no-op implementation on web and pwa
```
- Order: `window.vitalsDesktop` present (the preload bridge, §15.6; `Electron/` in the user agent until it is) → `electron`; `Capacitor.isNativePlatform()` and
  `Capacitor.getPlatform() === 'android'` → `android`; standalone display (`isStandalone` in `src/app/pwa/install.ts`,
  exported for this) → `pwa`; else `web`. No user-agent sniffing for the platform; the user agent and `navigator.userAgentData` are read only for `os`.
- `ble` follows `pickTransport()`; on web and pwa it is `'web-bluetooth'` only when `isWebBluetoothAvailable()` (`src/biometrics/ble/webBluetooth.ts`)
  is true, else `null` (the Ring page then says the browser cannot reach rings and offers the apps, §15.3).
- Files: `src/platform/{index,detect,caps,shell,os}.ts`, `__tests__/detect.test.ts` (each platform from a stubbed
  `window`). Tier H: pure modules (tier P) never import `src/platform`.
- Tests may force a platform with `setPlatformForTests(p)`; no URL parameter or setting changes it in a build.

### 15.2 Ring service (`src/biometrics/service/`, tier H) · owner **L-RINGSVC**

One instance per app (`getRingService()`), started at boot after the store opens (`start()`; idempotent). It drives
A5a sessions over the transport from `pickTransport()` and writes with A5a's `ringRecords` through the existing ingest
path (`ringJob` in `src/commands/bio/exec.ts` moves here and stays the only writer; `bio.deviceConnect` and
`bio.deviceSync` remain the UI commands and call the service). The types are `src/biometrics/service/types.ts`
(`RingService`, `RingStatus`, `RingLinkState`, `RingServiceErrorCode`, `RingCandidate`, `RingHolder`, `CheckMetric`):

```ts
type RingLinkState = 'unsupported' | 'bluetooth_off' | 'permission_needed'
  | 'idle'          // known ring, not connected, not trying
  | 'searching' | 'connecting' | 'connected' | 'syncing'
  | 'elsewhere'     // another device of this person holds the ring (fresh lease, below)
  | 'error';
type RingServiceErrorCode = 'not_found' | 'refused' | 'unsupported_firmware' | 'bond_required' | 'disconnected'
  | 'bluetooth_off' | 'permission_needed' | 'failed';          // mapped from RingError and NoDeviceError
interface RingStatus { ringKey: string; label: string /* driver label, never the advertised name */; state: RingLinkState;
  battery?: number; charging?: boolean; firmware?: string; lastSyncAt?: Instant; lastSyncBy?: string; syncProgress?: number;
  liveHr?: { bpm: number; at: Instant }; heldBy?: RingHolder; paused?: boolean;
  error?: { code: RingServiceErrorCode; message: string /* plain words; never names a passcode or a retail brand */ } }
interface RingService {
  start(): Promise<void>; stop(): Promise<void>;
  rings(): RingStatus[]; subscribe(cb: (rings: RingStatus[]) => void): () => void;
  availability(): 'ready' | 'unsupported' | 'bluetooth_off' | 'permission_needed';
  scan(signal: AbortSignal): AsyncIterable<RingCandidate>;   // web: opens the browser's chooser, inside a click
  pair(candidateId: string): Promise<RingStatus>;              // first connect + full history the ring holds
  connectHere(ringKey: string): Promise<void>;                 // "Connect here instead"
  syncNow(ringKey: string): Promise<void>;
  checkNow(ringKey: string, metric: CheckMetric /* 'hr' | 'spo2' | 'hrv' | 'skin_temp' */): Promise<{ value: number; unit: string; at: Instant }>;
  watchLiveHeartRate(ringKey: string): () => void;             // while the Ring page is visible
  disconnect(ringKey: string): Promise<void>;                  // stays known; auto-connect paused on this device
  forget(ringKey: string): Promise<void>;                      // removes the ring from this person (data stays)
}
```
"Stale" (last sync over 24 h ago) is derived by the pages from `lastSyncAt`, not a link state.

**Auto-connect.** At start, on app resume, on Bluetooth on (`shell().onBluetoothState`) and on Android boot, the service
tries every known ring (a `bioSources` doc with `deviceType: 'ring'`) whose lease is free, stale or held by this device,
unless the person pressed Disconnect on this device. Reconnect backoff follows the driver's rules (A5a, ported from the
Android drivers): `reconnectDelayMs(family.reconnect, attempt, gattStatus)`, where `null` means wait for Bluetooth.
Capacitor and Electron reconnect without a gesture through the transport's `reconnect(platformId, family)`; the
`platformId` (`link.deviceId`, the Bluetooth address on Android and Linux) is remembered per ring in device-local state
(`deviceSettings` id `ringLink:<ringKey>`) and is never the ring's identity. On web and pwa `requestDevice` needs a
click, so the service reconnects on its own only where `navigator.bluetooth.getDevices()` exists and returns the ring;
else the state is `idle` and the Ring page shows Connect. While connected the service syncs on connect, then every 30 min,
and on `syncNow`; live heart rate is read only while the Ring page is visible.

**One central at a time: the lease.** The ring allows one connection, so devices take turns through a lease document
in `bioSources` with id `lease:<ringKey>` (beside `policy:me`; source listings skip both). `bioSources` merges per
top-level field (`lwwField`), so holder and taker write different fields and never overwrite each other:
```ts
interface RingLeaseBody { kind: 'ringLease'; ringKey: string;
  holder: { deviceId: string /* SyncView.deviceId */; deviceLabel: string; platform: Platform; since: Instant } | null;
  heartbeatAt: Instant | null;                                     // written by the holder only
  takeover: { deviceId: string; deviceLabel: string; at: Instant } | null }   // written by the taker only
```
- The holder writes `heartbeatAt` every 5 min while connected (each write is a synced change kept forever, so not
  more often) and sets `holder: null` on a clean disconnect. A lease is **stale** after 15 min without a heartbeat.
  (`LEASE_HEARTBEAT_MS = 300_000`, `LEASE_STALE_MS = 900_000`. This replaces the first draft's lease inside
  `SourceBody.ble.link`: one field holding both writers' data would lose a takeover in a merge.)
- `elsewhere` shows "Connected to <deviceLabel>" with the time since, and the action **Connect here instead**.
- `connectHere`: writes `takeover`; the holder sees it through sync, disconnects within 10 s, clears `holder` and pauses
  its own auto-connect for that ring until its person presses Connect there (or 12 h pass); the new device retries the
  connection for 60 s (BLE needs a few seconds to free the link). If the lease is stale it connects at once.
- If the ring cannot be found or refuses the connection and no fresh lease explains it, the error says "Your ring may be
  connected to another app or phone. Close it there, then try again." Nothing else is assumed.
- Without sync (no server, no sync group) there is no lease: the service connects and the error line above covers
  another app holding the ring.

**History since the last read.** Each device keeps its own cursor per ring in device-local state (the local-only
collection `deviceSettings`, document id `ringCursor:<ringKey>`; the synced `SourceBody.ble.cursor` is no longer
written). Before a sync the
service may skip ahead to the newest sample the store already holds for that ring and stream, minus 2 hours of overlap;
correctness never depends on this (PLAN item 1 rule f). A5a's `store.loadCursor(identity)` and `saveCursor` are
implemented over this document; the cursor is saved only after the batch is ingested. The first `pair` reads everything
the ring still holds. Synced
`SourceBody.ble` keeps only facts about the ring: `driver`, `ringId`, `firmware`, `battery`, `lastSyncAt`, `lastSyncBy`
(device label), `clockOffsetS`.

**Ring identity and source key (PLAN item 1 rules a–e).**
- `ringKey` = `ringSourceKey(ringIdentity(…))` = `ble:<family>/<model>/<ringId>` (A5a). It is both the record's
  `provenance.channel` and the source key: `sourceKeyOf` returns such a channel unchanged. `ringId` is `serial:<S>`, else
  `mac:<address>`, else `adv:<id>`, read from the ring (status events, Device Information, manufacturer data) or the
  Bluetooth address where the platform exposes it. Web Bluetooth's per-origin device id is never used.
- A device that meets a ring whose identity basis it cannot see (for example no address in a browser) looks for the
  person's ring sources of the same family and model; if there is exactly one it uses that key, else it asks once "Is this your J-Style 2301 from <device>?" (no typing).
- `manufacturer` and `model` come from the driver (`J-Style`, `2301`), never from the advertised name (decision 10).
  The advertised name is not stored or shown, and it is never a `ringId`: a peripheral that gives only a name has no
  identity (the session refuses it; a browser id gives `adv:<id>`).
- One ring = one source. `biometrics.ringFold` (system actor, at boot and after a ring is paired, idempotent) moves a
  `ble:` source keyed from what a ring advertised (neither a ring key nor its driver's canonical legacy key) into the
  ring's canonical source, a Lumen source under an old key into the one Lumen key, and, when the person has exactly one
  J-Style 2301 ring source, the Lumen source into it; from then on `bioSources/ringFold:me` `{ lumen: <ringKey> }` makes
  the ingest pipeline file new Lumen data (MQTT, files, archive) under the ring key. Records keep their ids and samples
  merge by `(origin, t)`, so nothing is duplicated; the old source goes as `bio.deleteSource` removes one. With two or
  more J-Style 2301 rings nothing folds. Every case is detected by key structure, never by a name.
- Record ids come from content, never from the read window: A5a's `ringRecords` uses `seriesRecordId`,
  `sleepRecordId` (versioned by `sleepVersion`), `dailyRecordId` and `workoutRecordId` from
  `src/biometrics/core/recordIds.ts` with `source = ringKey` (not today's `mapEventsToBatch`, which keys series by their
  first sample); series are stored as chunks per (source, stream, local date) and samples merge by `(origin, t)`, §4.2. Two devices reading the same night therefore write the
  same record; fields that differ per reader (`provenance.ingested_at`) are not part of identity.
- Keys are never rewritten (record ids and chunk keys embed them). An existing ring source from before v0.5.0
  (`ble:jstyle2301|…`, `ble:colmi|…`) keeps its key and history; new reads go to the new key. A stored ring
  source whose label carries another manufacturer name is shown as `J-Style 2301` (`sourceLabel` uses the driver's
  label for `deviceType: 'ring'`); its key lives only in the person's data. Lumen-imported data keeps its own source
  (`file:lumen_cloudevents|…`) and record ids; it gets the ring defaults below.

**Provenance on every ring record.** `channel: ringKey` on every platform; `device: { type: 'ring', manufacturer,
model, firmware, tier }` from the family (`J-Style`, `2301`); `recording_method: 'automatic'`; `modality: 'sensed'`;
`decoder: family.decoderTag(firmware)`; `source_app: 'Vitals'`. Which device read it is **not** part of the record (two
devices must produce identical records); the job log keeps it.

**Item 11 defaults and the master switch.**
- A **ring source** is a source whose channel starts with `ble:`, or the Lumen source (`file:lumen_cloudevents`): one
  test, `isRingSource` in `src/biometrics/core/policy.ts`, for the commands, the migration, `newSourceDoc` and the Ring
  page. A `ring` device type alone does not count (Apple Health, Health Connect and Gadgetbridge files mark rings too;
  those imports stay opt-in, §4.5). New function `ringDefaultPolicies(): StreamPolicy[]` in `src/biometrics/core/source.ts`
  (beside `defaultPolicies` and `suggestedPolicies`) = `imported: true`, `scores: true`, `engine: true` where
  `engineEligible`, `coach: 'daily+series'`, for every stream in `POLICY_STREAMS`. The ring job creates ring sources
  with it and does not apply `adoptPersonPolicies` to them; every other source keeps `suggestedPolicies` plus the
  person's matrix (`policy:me`, §4.5).
- **Master switch** "Use my ring data in my plan and Coach" on the Ring page. UI-only command `bio.setRingSharing
  { on: boolean }` (perm write, impact consequential, undo RT): on → the ring defaults on every ring source; off →
  `engine: false`, `scores: false`, `coach: 'hidden'` on every stream of every ring source (`imported` stays on, so the
  Ring pages still show the data). The switch reads **on**, **off** or **some** (any other mix; "Some of it is shared"
  with a link to Settings › Devices). Per-stream switches stay in Settings › Devices (`bio.setPolicy`). The command
  also stores the choice once per person in `bioSources/ringSharing:me` (`choice: 'on' | 'off'`, synced; part of the
  same change, so Undo restores it), and every ring source created later (`newSourceDoc`, a stream new to a ring source,
  the Lumen broker) starts from it: the ring defaults, or with the switch off what off writes.
- A plain line under the switch: "Your ring data is used for your plan and scores, and the Coach and your AI tools can
  see it. Turn it off here or per signal in Settings › Devices."
- MCP read tools and `briefing_get` (item 12) apply the same visibility rule as the Coach (`coachSees` in
  `src/commands/bio/exec.ts`), so the same switch hides ring data from agents.
- **Existing data:** migration `biometrics.ringDefaults` (registered like `biometrics.dropPriorities` in
  `src/commands/biometrics/index.ts`; once, system actor): a ring source whose policies were never
  changed by the person (no policy change with a `user` actor in the ledger) gets the ring defaults and a one-time
  notice on the Ring page; a source the person changed is left alone. It records itself (`ringDefaults:me`) only once
  it moved or kept a ring source, so a device whose ring source has not synced in yet does not stop it for every device.

### 15.3 Ring page and Body signals page · owner **L-PAGES**

| Route | Page | Code | Purpose |
|---|---|---|---|
| `/ring` | Ring | `src/features/ring/` | the ring itself: connection, pairing, today's tiles, Check now, master switch, ring settings |
| `/signals` | Body signals | `src/features/signals/` | what the ring measured over time: tabs Sleep, Heart and recovery, Activity |

`/body` stays the existing Body page (`src/features/body/BodyPage`); `L-PAGES` owns `src/features/signals/**` in place
of the plan's `src/features/body/**`. `S0` created both routes (`src/features/ring/RingPage.tsx`,
`src/features/signals/SignalsPage.tsx`, helpers `paths.ring`, `paths.signals` in `src/app/paths.ts`) and left the nav
entry point in `src/app/shell/nav.ts` (`DESTINATIONS`, `LIVING_DESTINATIONS`). Navigation
placement (a Ring entry in the phone nav, a link from Settings › Devices on desktop) is D4's (`ring-pages.md`).

**Ring page data:** `getRingService().rings()` and `subscribe` for the connection card (state, battery, last sync,
`heldBy`, actions Connect / Sync now / Connect here instead / Check now); `today.get` and `bio.daily` for today's tiles
(the resolved view, §14.6, so a correction shows as corrected); `bio.sources` for the master switch state. Pairing flow:
`scan()` list of `RingCandidate` (driver label, signal), tap to `pair`; no password, key or "advanced" field for any
ring (decision 13); the only prompt a person may see is the operating system's own pairing dialog, preceded by "Your
phone may ask to pair with the ring. That's expected."

**Body signals data:** `bio.daily` (resolved days), `bio.series` (chunks: heart rate by hour, SpO2 and temperature at
night), sleep records (stages; `unknown` time drawn as unknown), workouts; the E29 views in
`src/features/living/progress/ring/` (`RingViews.tsx`, `ringData.ts`) are moved here and the Progress page links to
`/signals`. URL state: `?tab=sleep|heart|activity&period=day|week|month|year&date=YYYY-MM-DD`; periods are
calendar-aligned (ISO week, calendar month); a day with no data is drawn as missing, never as zero. Every value shows its
source label and, for tier C signals, the change from the person's own normal (§4.4).

**States both pages render** (tested at 390 / 768 / 1440 px in both themes): unsupported browser (offers the apps),
no ring, Bluetooth off, permission needed, searching, connecting, connected, syncing, connected elsewhere, stale (last
sync over 24 h), error, unknown sleep stages, missing days.

### 15.4 Pairing turns sync on (decision 5) · owner **L-SYNC**

Contract only; shapes are `L-SYNC`'s and replace the I3 note "pairing never fills the sync key" in §14.2.
- Pairing a device to a `home` server by code, QR or link (§14.2) ends with the device in the person's sync group:
  no words, no second QR, no "set up sync" step. The `home` server already holds the person's sync secret (set by the
  admin CLI today; `L-SYNC` adds a way for an already paired device to hand it over once, over TLS, if the server lacks
  it). It returns the secret only to a freshly redeemed code, only on the `home` role, and the device stores it in the
  existing vault (`src/state/sync/vault.ts`).
- On a `relay`-only server nothing changes (words or QR from another device, `sync.join`).
- Settings › Server `connecting` shows "Setting up sync…" until `sync.status` reports `synced` or `syncing`; failure
  leaves the device paired and shows the reason with Try again.
- The 24 words stay as a backup in Settings › Sync.
- Status is visible everywhere sync matters (header chip and Settings): `synced`, `syncing`, `offline` with "N changes
  waiting" (`SyncStatus.pendingChanges`), `error` with a plain reason.
- Desktop and Android use the same flow; the QR scanner is the existing one in Settings › Server.

### 15.5 Server address on phones without tailnet DNS · owners **L-ANDROID**, orchestrator (server config)

The owner's phone runs Tailscale with its DNS setting off, so `*.ts.net` names do not resolve there.
- The server gets a public name for its HTTPS address (`publicHosts`, behind Caddy, §14.2) and that address becomes its
  `publicOrigin`, so pairing QR codes and links (`vitals-server:1?u=…`), agent MCP addresses and the MQTT hint carry an
  address every device can reach; the tailnet address keeps working where it resolves. Steps and the chosen name are in
  `L-REL`'s survey (`.jobs/L-REL.server-address.md`), applied by the orchestrator with the owner's approval.
- The app accepts any `https://` base URL (§14.2 rule unchanged). No hostname, address or tailnet name is written in
  the source: they come from the server and the pairing code at run time.
- The server's `allowedOrigins` gain the app origins: `app://vitals` (Electron, `APP_ORIGIN`), `https://localhost`
  (Capacitor Android) and `capacitor://localhost`. Requests without an `Origin` (Electron main, native HTTP) pass as
  today.

### 15.6 Desktop shell (Electron, `apps/desktop/`) · owner **L-DESKTOP**

- **Layout:** `apps/desktop/src/main/` (main process), `src/preload/index.ts`, `electron-builder.yml`, packaged by
  `L-REL`'s CI as Linux AppImage and deb, Windows NSIS installer, macOS dmg (unsigned).
- **Loading:** the built web app (`dist/`) is served from the privileged scheme `app://vitals/` (`standard`, `secure`,
  `supportFetchAPI`); unknown paths fall back to `index.html`; responses carry the same CSP as `netlify.toml` plus
  nothing else. Navigation away from `app://vitals` and `window.open` go to the system browser. `contextIsolation: true`,
  `sandbox: true`, `nodeIntegration: false`, one window, single-instance lock (a second launch focuses the first).
- **Bluetooth:** item 1's Electron transport (A5a, `L-XPORT`): `webContents.on('select-bluetooth-device')` in main forwards
  the device list to the renderer's scan list and returns the person's choice (`L-XPORT`'s `apps/desktop/src/ble/`:
  `enableWebBluetooth(app)` before ready, `attachBluetooth(win.webContents, ipcMain)` per window, `bluetoothBridge` in
  the preload, exposed as `window.vitalsDesktop.bluetooth`); a `node-ble` fallback, if R21 needs it, lives behind the
  same bridge. The ring service itself runs in the renderer.
- **Tray:** the ring mark; menu: Open Vitals; a status line ("Ring connected · 82 %" / "Ring not connected"); Sync now;
  Start with my computer (check box); Quit. The tray line comes from `shell().keepAlive` (§15.8). Closing the window hides it to the tray (window kept with
  `backgroundThrottling: false`, so the ring link and sync go on). Where the desktop has no tray, closing quits.
- **Autostart:** off by default; set from the tray or Settings › Install (desktop only row). Windows:
  `app.setLoginItemSettings({ openAtLogin, args: ['--hidden'] })`; macOS: `setLoginItemSettings({ openAtLogin })` and a
  login start is detected with `getLoginItemSettings().wasOpenedAtLogin`; Linux: `~/.config/autostart/vitals.desktop`
  with `--hidden`. A login start opens in the tray.
- **Auto-update:** `electron-updater`, provider `github`, the public Vitals repo's Releases (owner and repo set in
  `electron-builder.yml`, nothing else). Check at start and every 6 h; download in the background; "Restart to update" in
  the tray and a quiet banner. AppImage and Windows update in place; deb and unsigned macOS show "A new version is
  ready" with the download link.
- **MCP host (item 4).** The app binary started with `--mcp` is an Electron process with no window, outside the
  single-instance lock, that writes nothing but MCP frames to stdout; it runs a stdio MCP server and bridges to:
  - **with a server paired:** the server's `/mcp` (§14.4) with an agent token the app minted for that AI tool
    (`ServerClient.createAgentToken` in `src/net/server.ts`, scope `edit`: read, log, edits staged as proposals;
    destructive tools never listed), one per AI tool (`--client <AiToolId>`). The token stays in the app (Electron
    `safeStorage`, key `agentToken:<AiToolId>`), never in the AI tool's config.
  - **without a server:** the running app over a local socket (`<userData>/mcp.sock`; Windows named pipe
    `\\.\pipe\vitals-mcp-<user>`), started hidden if it is not running. Main relays each call to the renderer, which runs
    it through the command bus (`dispatch` with `actor: { kind: 'mcp', id: <client> }`) and `createMcpServer` from
    `packages/companion/src/mcp.ts` with the same tool list, scope `edit`, and the item 12 instructions and
    `briefing_get`.
- **"Connect your AI tools"** (desktop only: `src/features/settings/agents/ConnectTools.tsx`, its own `#connect-tools`
  block after Settings › Agents, rendered when `platform() === 'electron'`): one row per tool, detected from its config or
  binary: Claude Code, Codex, OpenCode, ChatGPT desktop. Each row: found / not found; **Add Vitals** opens a consent
  dialog that shows the file or command that will change things, the exact entry, and what the tool will be able to do
  ("read your data, log food and activity, propose changes you approve"); nothing is written until the person
  confirms. The entry is the stdio command (`<app path> --mcp`, server name `vitals`); an edited file is backed up once
  (`<file>.vitals-backup`); **Remove** undoes it. Claude Code: `claude mcp add -s user vitals -- <app path> --mcp`
  (writes `~/.claude.json`; Remove runs `claude mcp remove -s user vitals`); Codex: `~/.codex/config.toml`
  `[mcp_servers.vitals]` `command`, `args`; OpenCode: `~/.config/opencode/opencode.json` `"mcp": { "vitals": { "type":
  "local", "command": ["<app path>", "--mcp"], "enabled": true } }`.
  ChatGPT desktop takes remote servers only: its row shows the server's MCP address and the token steps from §14.4 when
  a server is paired, else "Needs your Vitals server".
- **Preload surface:** `window.vitalsDesktop`, typed by `DesktopBridge` in `apps/desktop/src/shared/bridge.ts` (with
  `APP_ORIGIN`, `FLAGS` `--hidden` / `--mcp` / `--client`, and `CHANNELS`, every one prefixed `vitals:`; main rejects a
  call whose sender frame is not `app://vitals`). The page declares the same shape structurally in
  `src/platform/bridge.ts` and never imports desktop code. Members: `version`, `os`; `bluetooth` (`L-XPORT`); `tray.setStatus`;
  `autostart.get/set`; `updates.onState/check/restart` (`UpdateState`: idle, checking, downloading, ready, manual, error);
  `mcp.tools/add/remove` (`AiToolRow`), `mcp.onCall` (main → page tool calls when no server is paired, answered with the
  `ToolResultEnvelope`), `mcp.setManifest`, `mcp.setServer({ mcpUrl } | null)`; `secrets.get/set` (`agentToken:<AiToolId>`);
  `keepAlive(on, text)`; `onShow(cb)`. `AiToolId` is `'claude-code' | 'codex' | 'opencode' | 'chatgpt-desktop'`; it maps
  to the server's `AgentClient` with `'claude-code'` → `'claude'`.
  `mcp.add` is only callable from the consent dialog's confirm handler (a user gesture); the preview is what is written.
- **First run** without a server works locally (providers with the person's key); with a server, the Coach providers and
  ChatGPT sign-in go through it (§14.3).

### 15.7 Android shell (Capacitor, `apps/android/`) · owner **L-ANDROID**

- `apps/android/capacitor.config.ts`: `appId: 'desi.creative.vitals'`, `appName: 'Vitals'`, `webDir: '../../dist'`,
  `server.androidScheme: 'https'` (origin `https://localhost`). Capacitor 8, `minSdk 26`, `targetSdk 36` (Android 16).
  `versionName` = the root `package.json` version, `versionCode` = major·10000 + minor·100 + patch.
- **Bluetooth:** `@capacitor-community/bluetooth-le` 8 through `L-XPORT`'s Capacitor transport. Permissions
  `BLUETOOTH_SCAN` (`neverForLocation`), `BLUETOOTH_CONNECT`, `POST_NOTIFICATIONS`, `FOREGROUND_SERVICE`,
  `FOREGROUND_SERVICE_CONNECTED_DEVICE`, `RECEIVE_BOOT_COMPLETED`, `CAMERA` (QR); for Android 8–11 also
  `ACCESS_FINE_LOCATION`, `BLUETOOTH` and `BLUETOOTH_ADMIN` with `maxSdkVersion 30` ("Android needs location access to
  find Bluetooth devices. Vitals does not use your location."). Each is asked when first needed, with one plain line why.
- **Native plugin `VitalsShell`** (Kotlin, `apps/android/android/app/src/main/java/desi/creative/vitals/`), the only
  Vitals native code besides Capacitor's own plugins: `keepAlive({ on, text })` starts or stops a foreground service of
  type `connectedDevice` with the persistent notification ("Ring connected" / "Reading your ring…" / "Waiting for
  Bluetooth"); `notify({ kind, title, text })`; events `bluetoothState`, `bootCompleted`, `resume`, `shared` (files
  shared to Vitals). Android 12+ does not let a Bluetooth-on broadcast start a foreground service from the background,
  so the service is started from the app or at boot (`BOOT_COMPLETED` is allowed) and **stays running while Bluetooth
  is off**, reconnecting when it comes back on. The ring link and history sync stay in the web layer; the service keeps
  the process alive. If R21 shows the WebView stalls with the screen off, `L-ANDROID` reports it and the fallback is
  decided then (not specified here).
- **Notifications:** channel `ring_link` (low importance, the persistent one); channel `ring_alerts`: "Ring battery low"
  at 15 % or less (once per charge), "Ring disconnected" after 10 min without reconnecting (once until it reconnects).
- **Keep my ring connected** (Ring page, Android only, on by default): when on and a ring is known, the service starts
  with the app and at boot, and survives Bluetooth off and on.
- **Pairing to the server:** Settings › Server by code or by QR (the existing scanner, camera through the WebView); the
  pairing link opens the app when installed (App Link, `/.well-known/assetlinks.json` on the website, requested from
  `L-WEB`; verified only for the signed build, an unsigned APK opens the link in the browser).
- **Files:** import through the Android file picker into `bio.import`; "Share to Vitals" (an intent filter delivered by
  the `shared` event) for the same formats Lumen accepted; export through the system share sheet.
- **Back button** goes back in the router and leaves the app at the root route.
- **Build:** `pnpm --filter @vitals/android run build:apk` gives the unsigned release APK; `L-REL`'s CI signs it on the tag
  (keystore outside the repo; `Vitals-android-unsigned.apk` if CI has no key).

### 15.8 Shell bridge and how the pieces talk

```ts
// src/platform/shell.ts
interface ShellBridge {
  keepAlive(on: boolean, text: string): Promise<void>;     // android: foreground service; electron: tray status; web: no-op
  notify(n: { kind: 'battery_low' | 'ring_disconnected'; title: string; text: string }): Promise<void>;
  onBluetoothState(cb: (on: boolean) => void): () => void; // android receiver; web: navigator.bluetooth availability
  onResume(cb: () => void): () => void;                    // android resume, electron show, web visibilitychange
}
```

| From | To | Through |
|---|---|---|
| `packages/rings` (A5a) + transports (`L-XPORT`) | ring service | `RingFamily`, `openRingSession`, `ringRecords`; `pickTransport()` |
| ring service | biometrics store | the ingest path (`mapEventsToBatch` → ingest → rescore), records with provenance, `SourceBody.ble` (lease, facts) |
| ring service | Ring and Body signals pages | `getRingService().rings()` / `subscribe`; pages read history through `bio.*` commands only |
| ring service | Android and desktop shells | `shell().keepAlive`, `shell().notify`, `onBluetoothState`, `onResume` |
| store | every device, the server | sync (§2.6, §14.6); ring leases travel the same way |
| desktop MCP host | command bus | local socket → main → renderer `dispatch` (no server), or the server's `/mcp` (server) |
| pairing (§14.2) | sync | §15.4 |
| `src/platform` | downloads block, Install section, Ring page, Settings › Agents | `platformCaps()` |

No feature imports Capacitor or Electron directly: only `src/platform/` and the transports in `src/biometrics/ble/` do.

### 15.9 Downloads block (`src/features/home/`) · owner **L-WEB**

- `DownloadsBlock` (`src/features/home/DownloadsBlock.tsx`) is mounted by `S0` in `IntroStep` of
  `src/features/onboarding/WelcomePage.tsx` (a new visitor's first screen) and may also appear in Settings › Install. It
  renders only when the platform is `web`.
- **Release data:** `GET https://api.github.com/repos/<owner>/<repo>/releases/latest` (owner and repo in one constant,
  `PUBLIC_REPO`, in `src/features/home/`); version = `tag_name` without `v`, size = the asset's `size`. Cached in
  `sessionStorage` for 1 h (the API allows 60 requests per hour per address); on any failure the block falls back to
  `https://github.com/<owner>/<repo>/releases/latest/download/<name>` links without sizes.
- **Asset names** (`L-REL`'s `.jobs/L-REL.assets.md`; fixed, no version in the name):

| Key | Asset | Label |
|---|---|---|
| android | `Vitals-android.apk` (signed only: an unsigned APK cannot be installed, so none is offered; until a signed one is published the block offers the desktop builds and the website) | Android |
| linux-appimage | `Vitals-linux-x86_64.AppImage` | Linux (AppImage) |
| linux-deb | `Vitals-linux-amd64.deb` | Linux (deb) |
| windows | `Vitals-windows-x64-setup.exe` | Windows |
| macos | `Vitals-macos-universal.dmg` | macOS |

- **Choice by `os`:** android → APK; windows → installer; macos → dmg; linux → AppImage, with deb second; ios,
  chromeos, other → no main key, all links listed, and "On iPhone, use the website and add it to your home screen".
- **Shows:** the main key ("Download for Android") with version and size in MB, the other systems under it, "or keep
  using the website" beneath, and one plain note per unsigned build ("Windows may warn that the app is from an unknown
  publisher. Choose More info, then Run anyway."; a similar line for macOS; Android's "install unknown apps" note
  goes with the signed APK). Cached release data from a build that listed an unsigned APK is dropped.
- **No layout shift:** the block reserves its height before the release data arrives. "Not now" folds it to one line
  ("Get the app"), remembered in `localStorage` `vitals.downloads.v1`.

### 15.10 Test contracts

| Test | Owner | Pass condition |
|---|---|---|
| Platform detection | S0 / L-WEB | each of web, pwa, electron, android from a stubbed `window`; `os` for Android, iOS, Windows, macOS, Linux, ChromeOS user agents |
| Ring identity | L-RINGSVC | the same fake ring through the three transport fakes gives one `ringKey`; the advertised name never appears in a source key, label or record |
| Two devices, one ring (PLAN item 1 binding test) | L-SYNC + L-RINGSVC | two replicas read one fake ring while offline (one more, one after a revised night), go online in either order: one record per night, one sample per (stream, time), nothing lost, on every replica and the server |
| Lease | L-RINGSVC | holder heartbeats; second device shows `elsewhere` with the holder's label; `connectHere` moves the link within 2 min online; concurrent heartbeat and takeover writes both survive a merge; a stale lease is taken at once; no lease without sync |
| Ring defaults | L-RINGSVC | a new ring source has the ring defaults on every platform; other imports stay off; master off removes ring data from the plan, scores, Coach briefing and `briefing_get` within one sync; `biometrics.ringDefaults` leaves a changed source alone |
| Pages | L-PAGES | every state of §15.3 at 390 / 768 / 1440 in both themes; missing days are gaps; forbidden-text scan; no password or key text anywhere |
| Pairing turns sync on | L-SYNC | a fresh device paired by code reaches `synced` with no other step and sees the person's data |
| Desktop | L-DESKTOP | packaged Linux app under Playwright's Electron driver: loads from `app://vitals`, tray, autostart toggle writes and removes the entry, update check against a fixture feed, "Connect your AI tools" writes nothing before consent and exactly the preview after, `--mcp` lists tools and runs a read and a log call with and without a server |
| Android | L-ANDROID | install, first run, pair, connect the ring, history sync, foreground notification present, screen off for an hour without losing the link, reconnect after Bluetooth off and on |
| Downloads | L-WEB | OS choice per platform; links resolve against a recorded release; fallback link on API failure; hidden on pwa, electron, android; no layout shift; both themes at 390 / 768 / 1440 |
