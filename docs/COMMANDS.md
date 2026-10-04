# Commands and the document store (E4)

**Normative source:** `docs/SUITE_SPEC.md` §1 (command API), §2 (local-first store), §9.3 (lint). This page says where
each part lives, how to call it, and where the code deviates from or adds to the spec. The command table at the end is
generated from the registry (`GEN_DOCS=1 pnpm vitest run src/commands/__tests__/docs.test.ts`); a test fails when it is
out of date.

## 1. The invariant

Every change to user data goes through `dispatch` (`src/commands/bus.ts`): the UI, the Coach (AI tools), WebMCP, MCP and
the Companion call the same commands. The only other writers are sync (merging remote documents), the one-time migration
and derive jobs (results the documents imply: simulation inputs, frozen prescriptions, the trend), each with its own
write-token kind.

- Screens may **read** through the store hooks (`useBodyValues`, `useScenario`, `useSimulation`, …) as before.
- Screens **write** with `dispatch('id', input)` (or `dispatchSync` when they need the output in the same tick, e.g. a new
  scenario id). Literal ids only: the parity census reads them statically.
- The v0.1 store actions (`useProfileStore.getState().setWeight(80)`, `useScheduleStore.getState().paintDays(…)`, …) keep
  their signatures; each now dispatches its command, so code outside the features (components, app shell, other packages)
  is routed too.
- **Strict store.** A persisted field of a store that changes outside a write scope throws `WriteOutsideCommand` in dev and
  test (logged and kept in production). `DocumentStore.transact` without a valid token throws the same. Tests seed with
  `withSystemWrite(() => useXStore.setState(…))` (`@/state/scope`).

## 2. Calling commands

```ts
import { dispatch, dispatchSync, outputOf, mintConfirmation } from '@/commands';

await dispatch('profile.patch', { weightKg: 80.5 });                       // the person (actor defaults to the UI user)
const id = outputOf(dispatchSync('scenario.create', { starter: 'blank' }))?.scenarioId;
await dispatch('scenario.edit', { id, ops: [{ op: 'paint', days: [3, 4], program: 1 }] }, { coalesceKey: 'stroke:7' });
await dispatch('history.seal', { scenarioId: id });                        // pointer-up: the stroke is one undo step

const input = { file, mode: 'replace' as const };                         // destructive: a confirm dialog mints the token
await dispatch('data.import', input, { confirmation: mintConfirmation('data.import', input) });

// agents: actor, and an idempotency key for keyed commands (`${conversationId}:${toolCallId}`)
await dispatch('log.measurement', { metric: 'weightKg', value: 80.2 }, { actor, idempotencyKey });
```

`CommandResult` is `{ ok: true, output, changeSet, notices }`, `{ ok: true, job }` (long-running: `sim.run`,
`planner.find`, `sim.whatIf`, `sim.compare`; poll `job.status` / `job.result`, stop with `job.cancel`), `{ ok: true,
pending }` (a staged agent proposal) or `{ ok: false, error: { code, message, detail } }`.

**Pipeline** (`bus.ts`): resolve → surface check (`user`→ui, `ai`→ai, `webmcp`→webmcp, `mcp`/`companion`→mcp; `system`
skips it) → input validation (JSON pointer in `detail.path`) → rate limit per agent turn (read 20, write 5, destructive 1
unless `aiLimit`) → idempotency ledger (24 h; UI calls get a per-click nonce) → confirmation (destructive: UI needs a
token, agents always get `confirmation_required`) → staging (consequential writes by agents become `pendingChanges`
documents from a dry run; `coach.applyPending` re-dispatches as the person `onBehalfOf` the proposer and refuses stale
proposals) → preconditions → safety gates → ChangeSet + write token → execute in the command's write scope → output
validation (`setOutputValidation('throw')` in tests) → commit → ledger → `committed` event.

**Safety gates** are the screens' own rules evaluated headlessly: `safetyAccessNow()` (`src/state/internal/safety.ts`)
mirrors `useSafetyAccess(useBodyContext())`. `screeningReady` and `simulatorAccess` apply to agents (the person's own
screens sit behind the onboarding route gate); `plannerAccess` applies to everyone. A declared gate or precondition
without an implementation fails closed.

**Ports** (`installPorts`): `navigate` (`nav.open`), `planner` (the Planner screen installs its request builder and the
worker pool in `features/planner/run.ts`), `download`, `reload`, and `living` (below). Executors reach IO only through
these and the store runtime.

## 3. ChangeSets, undo, coalescing

- A write command's projection writes and `ctx.docs` writes become one ChangeSet (per document: first "before", last
  "after"), committed in one document-store transaction; its `changeLog` row (inverse and forward field patches) follows
  right after. Kept: the last 300 ChangeSets within 30 days (in memory and in `changeLog`, LOC).
- `history.undo { changeSetId }` restores each field whose value still equals the ChangeSet's "after", reports the rest in
  `skipped` (`col/id.field`), and goes through the projections (`fromDocs` → store) so screens update at once. Agents may
  undo only their own ChangeSets.
- Gestures: dispatches with the same `coalesceKey` (same command, same actor, ≤ 1.5 s apart) join the open ChangeSet until
  `history.seal` or 300 ms idle; `profile.patch` from the UI coalesces by the fields it touches (slider drags), so a drag
  is one ChangeSet and one document write. A coalescing dispatch resolves at once; `settleCommits()` waits for writes.
- `scenario.undo` / `scenario.redo` keep v0.1's per-scenario step history (50 steps, in memory) — identical behaviour; the
  steps follow the dispatch `coalesceKey`.

## 4. The document store (`src/store/`, tier H)

`DocumentStore` (alias `DocStore`, SUITE_SPEC §2.4) over any `PersistenceBackend`:

```ts
interface DocumentStore {
  ready: Promise<void>; engine: string; device: DeviceId;
  get<T>(col, id): Promise<Doc<T> | null>;                       // Doc<T> = DocMeta & T (_id _col _schema _rev _device _created _updated _deleted?)
  query<T>(col, q?: Query): Promise<Doc<T>[]>;                     // index 'field' or 'a,b', range, limit, reverse, includeDeleted
  list<T>(col, { includeDeleted? }): Promise<Doc<T>[]>;
  watch<T>(col, q | { id }, cb): () => void;                       // local commits and merged remote changes
  transact<R>(token: WriteToken, fn: (tx: Tx) => Promise<R>): Promise<R>;   // atomic; WriteOutsideCommand without a token
  history?<T>(col, id, limit); estimate(); dump(cols): AsyncIterable<Doc>;
  subscribe(listener: (c: StoreChange) => void): () => void;       // change feed {seq, col, id, doc, origin, writer, changeSetId}
  changesSince(seq): StoreChange[]; peek(col, id); peekAll(col); erase(); close();
}
interface Tx { get; put(col, doc); patch(col, id, mergePatch); append(col, doc); remove(col, id) }   // §2.4, strategy-checked
```

**The seam for wp/E11** (`src/store/backend.ts`) — the engine-side shape of E11's `SyncStore`, so an opened Evolu store
plugs in unchanged:

```ts
interface PersistenceBackend {
  readonly engine: string;
  get<T>(col: string, id: string): Promise<BackendDoc<T> | null>;          // BackendDoc<T> = DocMeta & { value: T }
  list<T>(col: string, options?: { includeDeleted?: boolean }): Promise<BackendDoc<T>[]>;
  put<T>(col: string, id: string, value: T, options?: { schema?: number }): Promise<BackendDoc<T>>;
  delete(col: string, id: string): Promise<void>;                          // soft delete
  subscribe(listener: (c: { col; id; doc: BackendDoc | null; origin: 'local' | 'remote' }) => void): () => void;
  batch?(ops: BackendOp[]): Promise<BackendDoc[]>;                          // atomic multi-write when the engine has it
  history?<T>(col, id, limit): Promise<BackendDoc<T>[]>;
  erase?(): Promise<void>; eraseLocal?(): Promise<void>; close?(): Promise<void>;
}
await installPersistenceBackend(syncStore);   // src/state/runtime.ts (re-exported by @/state/persistence):
                                              // copyStore(current → new) once (marker in both), re-boot, remote feed moves
```

Implementations: `createIdbBackend()` (IndexedDB `vitals-docs`, `docs` + bounded `revs` stores, hand-written promise
wrappers), `createMemoryBackend()` (tests; `remote(doc)` simulates a merged change). Everything else — token checks,
validation, merge-rule metadata, schema migration on read (`COLLECTIONS[col].migrate` or `migrations` option), the
encryption hook for sealed collections (`secrets`, `providerKeys` through an `Encryptor`), the cache, watches and the change
feed — is in `createDocumentStore`, so every engine gets it. The conformance suite (`src/store/__tests__/conformance.ts`)
runs against both backends; E11 runs it against Evolu.

**Collections** (`src/store/collections.ts`): the 36 collection ids of SUITE_SPEC §2.3 (30 table rows; `conversations ·
messages`, `recipes · mealPlans`, `deviceSettings · uiPrefs`, `changeLog · commandLedger · jobs · aiUsage` are separate
collections) with strategy (lwwField / append / immutable / blob / derived / local), sync (yes / no / optIn), hydration
order, key rule, schema version, owner, budget, export flag and a JSON-Schema body validator (open where another package
owns the fields).

## 5. Projections and persistence (`src/state/`)

Each v0.1 store is a projection (`createProjection`, `src/state/projection.ts`): Zustand `persist` reads and writes through
`docStorage` (`src/state/bridge.ts`), the strict-store guard wraps every write, and a binding maps the persisted state to
documents and back:

| Store (boot-cache key) | Documents |
|---|---|
| profile (`vitals.body`) | `profile/me` (body inputs) + `uiPrefs/me` fields `bodySetup`, `shapeSkipped`, `habitsSkipped` |
| safety (`vitals.safety`) | `safety/me` |
| planner (`vitals.planner`) | `goals/me` |
| settings (`vitals.settings`) | `settings/me` (units, energy, glucose, date style, week start) + `deviceSettings/me` (theme, motion, charts, figure, last export) |
| scenarios (`vitals.scenarios`) | one `scenarios/<id>` per scenario + `uiPrefs/me.activeScenarioId` |
| simulations (`vitals.simulations`) | `derived/sim:<scenarioId>` (inputs of the last run) |

- Writes: a persisted change inside a command becomes document ops on the command's ChangeSet; the v0.1 `vitals.*` key is
  rewritten synchronously as the **boot cache** (first paint stays synchronous: theme, onboarding gate) and doubles as the
  rollback copy. Body writes keep the 300 ms autosave debounce and the "saving…" status.
- Reads at boot: the projections hydrate from the boot cache, then `bootDocuments()` (scheduled after the first paint)
  migrates or reconciles: newer documents win (a change merged while closed), a newer boot cache rewrites the documents
  (a write that never reached IndexedDB). Remote changes (sync) re-hydrate the projection in a `sync` scope.
- **Migration** (once; marker `syncState/me.migratedFromLocalStorage` and `localStorage['vitals.migratedToStore']`): every
  v0.1 key is parsed through its own sanitiser and migrator (the stores' `migrate`, e.g. scenarios v1 → v2, settings v2 →
  v3 with the `allowLongFasts` hand-off) and written in one transaction with a migration token, plus `vitals.results` →
  `uiPrefs.resultsUi` and `vitals.ui.lastRoute` → `uiPrefs.lastRoute`. `lumen.*` keys are copied first (v0.1 rename rule).
  The old keys stay. A fresh install migrates too (so every projection has its documents).
- **Export v2** (`exportAll`): `{ vitalsVersion: '2', app, appVersion, exportedAt, device, blobs: 'omitted', stores
  (the v1 section), collections }` — never secrets, keys, pending changes, logs, ledgers, derived caches. **Import**
  accepts v1 and v2 (`stores` → projections → documents; documents of collections no projection owns are written directly;
  a v2 file without `stores` is rebuilt from its documents), replace or merge. Erase deletes the database, every
  `vitals.*`/`lumen.*` key and the registered caches.

## 6. Lint (`eslint.config.js`)

Strict store everywhere outside `src/commands`, `src/state`, `src/store`, `src/sync`: no `useXStore.setState(…)`, no
`.transact(…)`, no `@/state/internal/*`, no `mintWriteToken`. Tier P (`src/engine`, `src/catalogues`, `src/living`,
`src/biometrics/core`, `src/ai/briefing`, `src/commands/schema`): no UI/state/storage/IO imports, no DOM/IO globals, no
`Date.now` / `Math.random` / `new Date()` (engine run telemetry via `performance.now` stays allowed). Tier H
(`src/commands`, `src/store`, `src/sync`): no React, Zustand or UI imports, no `window` / `document` / `localStorage`.
`mintConfirmation` cannot be imported from `src/ai`, `src/commands/adapters` or `packages/companion`.
Not added (owners): the `fetch`/`WebSocket` ban outside `src/net` (net.ts is wp/E11's), the `planRegimes` ban (E6).

## 7. Tools and the parity test

`manifest(surface)` / `manifestJson()` / `manifestSummary()` / `toolsetHash()` (`src/commands/manifest.ts`) generate tool
descriptors from the registry (name `log_meal_from_photo`, annotations read-only / destructive / idempotent); `adapters/openai.ts`
(`toOpenAIChatTools`, `toOpenAIResponsesTools` with the strict projection, `fromStrictInput`) and `adapters/anthropic.ts`
are pure. Optional nullable fields (merge patches: null = clear) are not expressible in strict mode, so those tools go out
non-strict. wp/E9's `src/ai` ToolRegistry and E12's MCP/WebMCP adapters consume the manifest.

`src/commands/__tests__/parity.test.ts`: UI census (TypeScript compiler API over features, app, components and the state
hooks; ids passed to the bus's `dispatch` / `dispatchSync` / `useCommand` / `<CommandButton>`), no-bypass scans, strict
guard on, registry closure (`excludedReason.ui` for UI commands no screen calls yet; `ai-excluded.json` reviewed list),
tool closure (manifests, OpenAI strict/namespaced and Anthropic projections, one fixture per command in
`src/commands/__fixtures__/<id>.json` valid against the original and the strict projection, the manifest summary (tools,
classes, schema hashes, exclusions) and `TOOLSET_HASH` as file snapshots in `__tests__/__snapshots__/`), behavioural parity (edit profile, edit a schedule day, run a
simulation: the UI path and the AI tool path — consequential edits applied by the person — give identical documents),
copy guard on titles and descriptions.

## 8. Additions to and deviations from SUITE_SPEC §1.9

- Domain `day` (for `day.get`, which §1.2's domain list omits).
- `profile.setSetupStep` (UI: first-run progress), `safety.clearAgeAnswer`, `safety.setShortWindow` (UI), 
  `scenario.applyStarter`, `scenario.ensureActive` — what v0.1 does that the table has no id for.
- `ScheduleOp` adds `setSchedule`, `copyWeek.cols` (the clipboard's copied days, so pasting from another scenario or an
  earlier copy keeps v0.1 behaviour) and `deloadWeek.habitualByWeekday`; `scenario.create` adds `provenance`,
  `startDate`, `started`, `activate`; `scenario.edit` output adds `changed`, `programIndex`; `goals.edit` output adds one
  `outcomes[]` entry per op (`added`, `duplicate`, `full`, …); `GoalOp.add.goal.key` is optional (the UI keeps its key).
- `history.seal` takes `scenarioId` (the v0.1 `seal(sid)`); `history.undo` plans field by field on stored patches.
- `planner.find` records `tier` (the v0.1 search runs one budget); `planner.openInSimulator` takes `kind: 'A'|'B'|'C'`
  (v0.1 options) plus optional `name` / `provenance`; `planner.stop` is the cooperative stop, `job.cancel` the hard one.
- `sim.run` resolves the profile headlessly (`simulatorProfileNow`, identical to `useSimulatorProfile`, tested); `planId`
  waits for E5. `sim.whatIf` / `sim.compare` run nominal variants of a scenario and persist nothing.
- `data.export` is a read returning the file text; the screen downloads it and records `lastExportAt` with
  `settings.update`. Commit failures do not roll the projection back (the boot cache still holds the change; a
  `commitFailed` event is emitted) — private windows without IndexedDB keep working on the boot cache alone.
- Schemas: a TypeBox-compatible builder (`src/commands/schema`: `T.Object`, `T.Optional`, `Static`, `Value.Check`) instead
  of the TypeBox package (no new dependency; interpreter validation only, CSP-safe).
- Store internals (`src/state/internal/*`) are importable from `src/commands/**` and the state layer itself.
- `intake.answer` validates the merged section against `src/commands/schema/intake.ts` (the intake package's section
  types; extra keys such as `turns` allowed, diet discriminated by `rulesComplete`) and derives, in the same ChangeSet,
  the profile habit fields the answers imply (SUITE_SPEC §2.3.1): `habits.activity` (the activity intake without its
  turns, so the Simulator and the Planner resolve the same maintenance as Your body), steps / sessions / mix from the
  activity chapter, diet level and alcohol from the food chapter — with the intake package's `chapterOutput` over the
  stored turns (`src/state/internal/intake.ts`). The screens dispatch only `intake.answer`. v3 (SUITE_SPEC §13.1): the
  activity section may carry `measured` ({kind, value, unit, method, date}); a resting value measured with a metabolic
  cart also sets `labs.measuredRmrKcal` in the same ChangeSet (cleared again only if it is still the value the intake
  wrote); a `markers` section holds the blood-markers chapter's turns; turns may carry `order` (commit order).
- `supplements.*` (E18, SUITE_SPEC §13.2) edit the `supplements` section of `intake/me` as v2 (`{ _v: 2, stance,
  rows[] }`; a v1 section is read through `toSectionV2` and replaced on the first write). `supplements.get` (R) returns
  the stance, the rows, a one-line summary (the Coach briefing's supplements section) and the planner view
  (`optInLevers`, `excludedLevers`, `habitual`, `onHand`). `supplements.set` (W·c) upserts one row by catalogue id
  (alias accepted) or typed text: state `taking | onHand | notForMe | unknown`, dose each time in a unit the item is
  sold in, times of day; a taking row needs a dose and a time (`invalid_input` with the field path); amounts above the
  catalogue's upper limit are warnings in the row, never refusals. `supplements.remove` (W·c) deletes a row. Both writes
  are consequential, so agent calls are staged as proposals. Screens save through
  `src/features/components/SupplementRowWriter.ts`, which serialises saves and waits for each commit (the command
  reads the section before writing).
- `goals.suggest` (E19, SUITE_SPEC §13.4; `src/commands/planner/goalsSuggest.ts`): **R**, all surfaces, `{source?:
  'rule'|'ai'}` → `GoalSuggestion` `{source, version ('rule@1' | 'ai:<model>@<briefing version>'), goals[] (rank, metric,
  target?, unit?, mode lose|keep|gain|raise|lower, targetFrom, why, because?), constraints (training days, minutes,
  time of day, longest fast only when already opted in, sleepFixed), notes[] (topic, text), missing[] (field,
  question, why), clarify? (AI only, ≤ 2), fallback?}`. It never writes. The pure core is `suggestGoals` in
  `src/engine/planner/domain/suggestGoals.ts`; `source: 'ai'` goes through `aiPorts().suggestGoals`, and the answer is
  checked against the rule result: on disagreement, failure or no Coach the rule result is returned with a `fallback`
  line. Inputs come from the `goalSuggest` port, installed when the Planner module loads; without it the command fails
  `precondition_failed` ("Open the Planner once so suggestions can read your answers."). Applying a suggestion is one
  `goals.edit` (replace or add goals, `setLimits`, then the new op `setSuggested {record | null}`, which stores
  `goals/me.suggested = {suggestion, at, provenance: {source, version}, goalKeys}`), so Undo is one `history.undo`.
- `log.measurement` (W, all): `metric` is an enum of metric ids with the unit in the name (`MEASUREMENT_METRICS` in
  `src/commands/defs/living.ts`): `weightKg`, `waistCm`, `hipCm`, `neckCm`, `chestCm`, `armCm`, `thighCm`, `bodyFatPct`,
  `sbpMmHg`, `dbpMmHg`, `ketonesMmolL`, `glucoseMmolL`, `ldlMmolL`, `hdlMmolL`, `tgMmolL`, `apoBgL`,
  `fastingGlucoseMmolL`, `hba1cPct`, `crpMgL`. Agents had guessed `weight` and were refused; the schema now lists the
  ids. Blood-test history uses `lab:<markerId>` entries written by `markers.*` (§9d), not this command.
- `profile.explainMaintenance` returns `explainMaintenance` of `features/body/maintenance.ts` (TDEE0, σ, 80 % band,
  drivers in kcal/day, assumed drivers from skipped answers, the biggest unknown worth fixing, PAL band and flag) plus
  the resting rate route, steps and sessions; numbers rounded to kcal.

## 9. Living-plan wiring (E5's executors, `src/commands/living/` + `src/commands/livingWiring.ts`)

`import './living'` in `src/commands/index.ts` replaces the stubs E5 implemented. `livingWiring.ts` installs
`ctx.ports.living` — `planner` (`legacyPlannerPort` over the planner worker; TODO(E6) `replan`), `sessionCompiler` (E8
`resolveSession` + `toEngineDose` over the seed catalogue, loaded lazily; VO2max measured or the engine bus's initial
value), `observations` (fake adapter until wp/E10) — and runs, after boot (`startLivingAutomation`): the **rollover**
(`runRollover`: every plan day up to the current day, at `dayRolloverH` 04:00, gets `dayStatus.prescribed` frozen with the
version in force; at boot, on day change and after `plan.*` commands) and the **daily assimilation** (`runAssimilation`:
debounced 1 s after `log.*` and `plan.checkIn`, replay + trend filter from the latest confirmed snapshot cached by the
record's `inputsHash` (in memory), trend kept in `derived/trend:<planId>`).

## 9b. I1 integration (sync, biometrics, catalogues, AI/agents, Living on the bus)

- **Navigation and saves.** The app installs the `nav.open` port at start. If the document store refuses a ChangeSet
  (quota, IndexedDB error), the change is rolled back: screens and boot cache are restored, the history row is dropped
  and the idempotency keys are forgotten. The waiting dispatch gets `ok:false` with "Couldn't save that change; it was
  undone.", and `commitFailed` carries `{changeSetId, label, rolledBack, notice?, skipped}`.
- **Living.** The Living screens dispatch `plan.*` and `log.*` with literal ids and read the plan documents through the
  same projection as `today.get`. `plan.end` and `plan.replace` carry a confirmation token from the typed-word dialog.
- **Sync (`sync.*`, 7).** `sync.status` reads the device's sync state. `sync.now` runs a round. `sync.pair` makes a new key,
  copies this device's synced documents into it and returns the pairing code. `sync.join` takes a `vitals-sync:` URI or the
  24 words plus `relayUrl`, and `onExisting: merge | replace`. `sync.configure` changes the server address or device name,
  or pauses/resumes. `sync.rotate` needs `full:true`: this device moves to a new key and every other device joins again
  (the relay cannot revoke a single device; otherwise `precondition_failed`, rule `sync:rotate-needs-full`).
  `sync.unpair` is destructive, needs a confirmation, forgets the key and keeps all local data. Pair, join, rotate,
  configure and unpair are UI-only. Device-local collections never reach Evolu; erasing this device never deletes
  anything on the server.
- **Biometrics (`bio.*`, 13).** Implemented over E10's BioStore on documents (`DocBioStore`) and the app blob store. Files and
  Bluetooth links are handed from the screen by reference (`fileRef` / `linkRef`). `bio.import`, `deviceConnect`,
  `deviceSync` and `rescore` run as jobs and write in derive transactions; `bio.manual`, `setPolicy`,
  `setSourcePriority` and the source document of `deleteSource` join the command's ChangeSet. Reads filter by the
  person's Coach sharing for non-UI actors and name what was left out in `hidden`. After small changes the app
  dispatches `bio.rescore` itself as SYSTEM, a short delay after the last change.
- **Catalogues.** `catalogue.addEquipment` is called from the intake's training chapter for each newly typed
  "something else" item; the devices chapter calls `bio.setPolicy` for each changed stream policy.
- **Tools.** Tools are projected from the one manifest (`vitals.tools/1`, `toolManifest()`; `TOOLSET_HASH =
  toolManifest().hash`). The strict projection (`src/commands/adapters/strict.ts`) makes every property required, turns
  an optional `T` into `anyOf [T, null]`, closes every object and strips keywords strict modes reject; a schema it cannot
  express (free-key or open objects, optional nullable properties, unconstrained values) makes that tool non-strict.
  OpenAI Responses tools are non-strict unless the preset declares `strictTools`; with Sign in with ChatGPT the
  functions are wrapped in one `{type:'namespace', name:'vitals', tools}` entry. Every tool's input schema must be an
  object schema (MCP and the Companion reject anything else). Consequential writes from MCP and WebMCP agents are
  staged as proposals unless the person allowed that client to apply plan changes directly (`agents.configure`); the
  Companion's `call.stage` flag is informational.
- **Device logs.** `log.fromBiometrics {date?}` (default the current app day) writes the day's steps, sleep and workouts
  as `dailyLogs` entries with `source {by:'device', method:'biometrics', bioRecordId, deviceKey}`. It reads only streams
  the person lets their plan use (Settings › Devices "my plan": `engine` on for `steps`, `sleep_sessions`, `workouts`),
  one source per metric by priority. Sleep is the main sleep ending on that app day (04:00 rollover); a workout belongs to
  the app day it starts on and carries type, duration, active kcal, distance and heart rate (`session` entry with
  `workout`, `bioWorkoutId` and engine sessions; Living treats it as a device workout, never twice). Natural key per day
  and stream (`${date}:steps`, `${date}:sleep_sessions`, `${date}:workouts:${recordId}`): a re-run with the same value
  writes nothing, a changed value supersedes the device entry, and a device entry the person removed stays removed. An
  entry the person (or the Coach) made for the same item wins and is returned in `skipped` (`userEntry`). Undo: each
  created entry is removed with `log.retract`; retracting an entry that superseded another brings that one back.
- **Profile.** `profile.patch` takes `figure: { frame: number | null }` instead of `figureBase`; `null` matches the
  basics. The frame changes only the drawing, never an estimate.

## 9c. Kitchen and pantry (E17, SUITE_SPEC §13.3; `src/commands/kitchen/`, `src/commands/food/pantry.ts`)

| Command | Perm | Input → output | Notes |
|---|---|---|---|
| `kitchen.get` | R | `{}` → kitchen view (equipment with labels, notes, `use`, `custom`, group; cuisines ranked; staples; regions; `fromIntake`) | Until the first write the lists come from the v0.2 intake answers (`migrateFromIntake`; reads write nothing). |
| `kitchen.set` | W low | `{equipment?, cuisines?, staples?, regions?}` whole lists → view | The picker and Settings › Kitchen. Kept items keep `addedAt`. UI edits coalesce per list. |
| `kitchen.add` | W low | `{items: [{label, id?, note?, use?}]}` → view | The Coach's "I also have a soda maker": matched to the catalogue, else `custom:<slug>` with the person's words. |
| `pantry.get` | R | `{}` → pantry view (items with labels, `qtyApprox`, `perishable`, food link status; `askStillHave`) | Food link status only (`resolved` id / `pending` IFCT / `notBundled` / `none`): never nutrient values. |
| `pantry.add` | W low | `{items: [{label, id?, qtyApprox?}], source?, replace?}` → view | One entry per id: adding again confirms it (`lastConfirmedAt`). `replace: true` = the picker's whole list (additive to §13.3). AI actors always write `source: 'coach'`. |
| `pantry.remove` | W low | `{ids}` → view | |
| `pantry.parseList` | R | `{text}` → `{items: [{label, id \| null, confidence, qty?}]}` | Lines, commas, semicolons and bullets; quantities kept apart; unmatched lines come back with `id: null`. Catalogue matcher only (the Coach itself resolves leftovers when it calls `pantry.add`). |

All writes are applied with Undo (inverse patch), never staged. Nothing expires by time: `askStillHave` lists perishable
items not confirmed for 14 days, which the Coach may ask about when a recipe depends on them.

## 9d. Blood markers (`markers.*`, E20, `src/commands/markers/`)

- **Document.** `markers/me` (`vitals.markers/1`, LWW-F, synced). Before the first save `markers.get` shows the Body page's
  `profile.labs` marker values migrated in (manual, confirmed, dated at the profile's last update); the first write stores
  them. Every saved reading also appends a `measurements` entry `{metric: 'lab:<markerId>', value: canonical, method:
  'lab'}`; a re-entry of the same marker and date supersedes it, `markers.remove` retracts it.
- **`markers.set`** (W·c, all; the Coach's call is staged and applied by the person): `{readings: MarkerReadingInput[],
  chapter?: 'skipped'|'manual'|'report', context?}` → `MarkersView`. The intake chapter's entry answer and the sample
  context ride on it (`readings: []` when only they change), so the domain keeps five commands. A unit outside the table
  fails `invalid_input` "… unit not recognised." at `/readings/i/unit`; a value outside the plausibility bounds or a
  date after today fails at `/value` / `/date`; soft-bound values pass with a caution notice. Provenance `manual`,
  `confirmed: true`. A first save with readings sets `chapter: 'manual'` unless given.
- **`markers.import`** (W, job, all): `{attachmentId, allowVision?}` → a job whose result is the `MarkerExtraction`
  (plus `pages`, and `error`/`message` when the file could not be read fully). The bytes come from the app blob store
  (the Coach's `putPhoto`, the chapter's `storeReport`); the type is sniffed from the bytes. Pages without text and photos
  go to the AI provider only when `allowVision` (default true for the Coach, false for the app) and a vision model is
  connected (`aiPorts().markerVision`, installed with the model). Nothing is written: the extraction is kept in memory
  for the session (`src/commands/markers/pending.ts`, 20 newest) until confirmed.
- **`markers.confirm`** (W·c, ui only; the Coach renders the review card, the person applies it): `{extractionId,
  accept: [{row, markerId?, value?, unit?, date, fasting?}], context?}` → `MarkersView`. Only accepted rows are saved
  (provenance `pdf`/`photo`, `coach` when the Coach started the import; confidence and attachment kept), the
  extraction's display-only rows are stored, `chapter` becomes `report` if unset. A replay returns the view unchanged.
- **`markers.remove`** (W, all): `{markerId, date}` → `MarkersView`; the newest remaining reading becomes current.
- **Classes.** `markers.get` R (all), `markers.set` W·c (all; staged for agents), `markers.import` W job (all),
  `markers.confirm` W·c (ui only), `markers.remove` W (all).
- **Coach.** `markers_get` and `markers_import` are core tools. `markers_import` waits for its job and returns the review
  card (`CardView.markers`, class `log`, pending); Apply sends `markers.confirm` as the person with the rows the app's
  review table passes (`CardActionExtra.markers`) or else the confident, matched rows with the sample date. The
  briefing carries `markers: [{id, value, unit, date, state, notes: rule ids}]` (≤ 300 tokens).

## 10. Stubs (ids, schemas and policies fixed; executors return `precondition_failed` with `detail.owner`)

- Living plan (E5; need E6/E8/E9/E10 ports): `log.meal`, `log.mealFromPhoto`, `log.session`, `log.bulk`,
  `plan.replan`, `plan.declareEvent`, `plan.shift`, `plan.editDay`, `plan.replace`,
  `plan.swapExercise`.
- Biometrics (E10): every `bio.*`.
- Sync (wp/E11): every `sync.*`; agents (E12): `agents.configure`.
- Catalogues (E8): `catalogue.*`, `food.*`, `train.*`; intake questions (E7): `intake.nextQuestions` (the screens walk
  the question sets themselves; the Coach needs them as headless data).
- Coach and AI (E9): `coach.conversations`, `coach.history`, `coach.searchNotes`, `coach.delete`, `ai.configure`, `ai.usage`.
- Results breakdown (E13): `sim.explain`.

## 11. Command table

Perm: R read, W write (low impact), W·c consequential write (staged for agents), D destructive (confirmation token).
Undo: IP inverse patch, RT retract, TS tombstone, CP compensating, — none. Idem: N natural, K key, — none.

<!-- commands:start -->
164 commands (164 implemented, 0 stubs) in 31 domains: agents 1 · ai 2 · app 1 · bio 12 · biometrics 3 · catalogue 10 · coach 7 · data 4 · day 1 · evidence 2 · food 8 · goals 3 · history 3 · intake 4 · job 3 · kitchen 3 · log 18 · markers 5 · nav 1 · pantry 4 · plan 18 · planner 4 · profile 5 · safety 9 · scenario 12 · settings 2 · sim 5 · supplements 3 · sync 7 · today 1 · train 3.

| Command | Tool name | Perm | Surfaces | Undo | Idem | Run | Status | Title |
|---|---|---|---|---|---|---|---|---|
| `agents.configure` | `agents_configure` | W·c | ui | IP | N |  | implemented | Agent access |
| `ai.configure` | `ai_configure` | W·c | ui | IP | N |  | implemented | Configure the AI provider |
| `ai.usage` | `ai_usage` | R | all | — | — |  | implemented | AI usage |
| `app.status` | `app_status` | R | all | — | — |  | implemented | App status |
| `bio.baselines` | `bio_baselines` | R | all | — | — |  | implemented | Personal baselines |
| `bio.daily` | `bio_daily` | R | all | — | — |  | implemented | Daily biometrics |
| `bio.deleteSource` | `bio_delete_source` | D | ui | — | N |  | implemented | Delete a source |
| `bio.deviceConnect` | `bio_device_connect` | W | ui | TS | K | job | implemented | Connect a device |
| `bio.deviceSync` | `bio_device_sync` | W | ui | TS | K | job | implemented | Sync a device |
| `bio.import` | `bio_import` | W | ui | TS | K | job | implemented | Import health data |
| `bio.manual` | `bio_manual` | W | all | TS | K |  | implemented | Enter a device value |
| `bio.rescore` | `bio_rescore` | W | ui | — | N | job | implemented | Recompute scores |
| `bio.scores` | `bio_scores` | R | all | — | — |  | implemented | Scores |
| `bio.series` | `bio_series` | R | all | — | — |  | implemented | Biometric series |
| `bio.setPolicy` | `bio_set_policy` | W·c | ui | IP | N |  | implemented | Sharing policy |
| `bio.sources` | `bio_sources` | R | all | — | — |  | implemented | Data sources |
| `biometrics.clearCorrection` | `biometrics_clear_correction` | W | all | RT | N |  | implemented | Use the device value again |
| `biometrics.correct` | `biometrics_correct` | W·c | all | RT | K |  | implemented | Correct a device value |
| `biometrics.dropPriorities` | `biometrics_drop_priorities` | W | ui | — | N |  | implemented | Drop source priorities |
| `catalogue.addEquipment` | `catalogue_add_equipment` | W | all | TS | K |  | implemented | Add equipment |
| `catalogue.addExercise` | `catalogue_add_exercise` | W | all | TS | K |  | implemented | Add an exercise |
| `catalogue.addFood` | `catalogue_add_food` | W | all | TS | K |  | implemented | Add a food |
| `catalogue.equipment` | `catalogue_equipment` | R | all | — | — |  | implemented | Equipment |
| `catalogue.equivalence` | `catalogue_equivalence` | R | all | — | — |  | implemented | Stimulus equivalence |
| `catalogue.getExercise` | `catalogue_get_exercise` | R | all | — | — |  | implemented | Read an exercise |
| `catalogue.getFood` | `catalogue_get_food` | R | all | — | — |  | implemented | Read a food |
| `catalogue.searchExercises` | `catalogue_search_exercises` | R | all | — | — |  | implemented | Search exercises |
| `catalogue.searchFoods` | `catalogue_search_foods` | R | all | — | — |  | implemented | Search foods |
| `catalogue.supplements` | `catalogue_supplements` | R | all | — | — |  | implemented | Supplements |
| `coach.applyPending` | `coach_apply_pending` | W·c | ui | — | N |  | implemented | Apply a proposal |
| `coach.conversations` | `coach_conversations` | R | ui ai | — | — |  | implemented | Conversations |
| `coach.delete` | `coach_delete` | D | ui | — | N |  | implemented | Delete a conversation |
| `coach.discardPending` | `coach_discard_pending` | W | ui ai | — | N |  | implemented | Discard a proposal |
| `coach.history` | `coach_history` | R | ui ai | — | — |  | implemented | Conversation history |
| `coach.pending` | `coach_pending` | R | ui ai | — | — |  | implemented | Proposals waiting |
| `coach.searchNotes` | `coach_search_notes` | R | ui ai | — | — |  | implemented | Search Coach notes |
| `data.eraseAll` | `data_erase_all` | D | ui | — | — |  | implemented | Erase everything on this device |
| `data.export` | `data_export` | R | ui | — | — |  | implemented | Export your data |
| `data.import` | `data_import` | D | ui | — | — |  | implemented | Import a data file |
| `data.usage` | `data_usage` | R | all | — | — |  | implemented | Storage used |
| `day.get` | `day_get` | R | all | — | — |  | implemented | A day |
| `evidence.get` | `evidence_get` | R | all | — | — |  | implemented | Read an evidence topic |
| `evidence.search` | `evidence_search` | R | all | — | — |  | implemented | Search the evidence library |
| `food.candidates` | `food_candidates` | R | all | — | — |  | implemented | Allowed foods |
| `food.dayTargets` | `food_day_targets` | R | all | — | — |  | implemented | Meal targets |
| `food.deleteRecipe` | `food_delete_recipe` | W | all | TS | K |  | implemented | Delete a recipe |
| `food.groceryList` | `food_grocery_list` | R | all | — | — |  | implemented | Grocery list |
| `food.parse` | `food_parse` | R | all | — | — |  | implemented | Parse a meal description |
| `food.planDay` | `food_plan_day` | W | all | IP | K |  | implemented | Plan a day’s meals |
| `food.recipes` | `food_recipes` | R | all | — | — |  | implemented | Recipes |
| `food.saveRecipe` | `food_save_recipe` | W | all | TS | K |  | implemented | Save a recipe |
| `goals.edit` | `goals_edit` | W | all | IP | N |  | implemented | Edit the goal set |
| `goals.get` | `goals_get` | R | all | — | — |  | implemented | Read the goal set |
| `goals.suggest` | `goals_suggest` | R | all | — | — |  | implemented | Suggest goals from the answers |
| `history.list` | `history_list` | R | all | — | N |  | implemented | Recent changes |
| `history.seal` | `history_seal` | W | all | — | N |  | implemented | Finish a gesture |
| `history.undo` | `history_undo` | W | all | — | N |  | implemented | Undo a change |
| `intake.answer` | `intake_answer` | W | all | IP | N |  | implemented | Answer intake questions |
| `intake.get` | `intake_get` | R | all | — | — |  | implemented | Read the intake |
| `intake.nextQuestions` | `intake_next_questions` | R | all | — | — |  | implemented | Next intake questions |
| `intake.skip` | `intake_skip` | W | all | IP | N |  | implemented | Skip an intake section |
| `job.cancel` | `job_cancel` | W | all | — | N |  | implemented | Cancel a job |
| `job.result` | `job_result` | R | all | — | N |  | implemented | Job result |
| `job.status` | `job_status` | R | all | — | N |  | implemented | Job status |
| `kitchen.add` | `kitchen_add` | W | all | IP | K |  | implemented | Add kitchen equipment |
| `kitchen.get` | `kitchen_get` | R | all | — | — |  | implemented | Read the kitchen |
| `kitchen.set` | `kitchen_set` | W | all | IP | N |  | implemented | Update the kitchen |
| `log.bulk` | `log_bulk` | W·c | all | RT | K |  | implemented | Log several days |
| `log.confirmDay` | `log_confirm_day` | W | all | IP | N |  | implemented | Confirm a day |
| `log.edit` | `log_edit` | W | all | RT | K |  | implemented | Edit an entry |
| `log.fast` | `log_fast` | W | all | RT | K |  | implemented | Log a fast |
| `log.fromBiometrics` | `log_from_biometrics` | W | all | RT | N |  | implemented | Log the day from devices |
| `log.get` | `log_get` | R | all | — | — |  | implemented | Read the log |
| `log.markDay` | `log_mark_day` | W | all | IP | N |  | implemented | Mark a day |
| `log.meal` | `log_meal` | W | all | RT | K |  | implemented | Log a meal |
| `log.mealFromPhoto` | `log_meal_from_photo` | W | all | RT | K |  | implemented | Log a meal from a photo |
| `log.measurement` | `log_measurement` | W | all | RT | K |  | implemented | Log a measurement |
| `log.note` | `log_note` | W | all | RT | K |  | implemented | Add a note |
| `log.retract` | `log_retract` | W | all | RT | K |  | implemented | Remove an entry |
| `log.session` | `log_session` | W | all | RT | K |  | implemented | Log a training session |
| `log.sleep` | `log_sleep` | W | all | RT | K |  | implemented | Log sleep |
| `log.steps` | `log_steps` | W | all | RT | K |  | implemented | Log steps |
| `log.subjective` | `log_subjective` | W | all | RT | K |  | implemented | How today felt |
| `log.substance` | `log_substance` | W | all | RT | K |  | implemented | Log caffeine or alcohol |
| `log.supplement` | `log_supplement` | W | all | RT | K |  | implemented | Log a supplement |
| `markers.confirm` | `markers_confirm` | W·c | ui | IP | N |  | implemented | Confirm results from a report |
| `markers.get` | `markers_get` | R | all | — | — |  | implemented | Read your blood test results |
| `markers.import` | `markers_import` | W | all | — | K | job | implemented | Read a blood test report |
| `markers.remove` | `markers_remove` | W | all | IP | N |  | implemented | Remove a blood test result |
| `markers.set` | `markers_set` | W·c | all | IP | N |  | implemented | Save blood test results |
| `nav.open` | `nav_open` | R | ui ai webmcp | — | — |  | implemented | Open a screen |
| `pantry.add` | `pantry_add` | W | all | IP | K |  | implemented | Add to the pantry |
| `pantry.get` | `pantry_get` | R | all | — | — |  | implemented | Read the pantry |
| `pantry.parseList` | `pantry_parse_list` | R | all | — | — |  | implemented | Read a list of food |
| `pantry.remove` | `pantry_remove` | W | all | IP | N |  | implemented | Remove from the pantry |
| `plan.adherence` | `plan_adherence` | R | all | — | — |  | implemented | Adherence |
| `plan.adoptVersion` | `plan_adopt_version` | W·c | all | CP (plan.rejectVersion) | N |  | implemented | Adopt a proposal |
| `plan.checkIn` | `plan_check_in` | W | ui ai | CP (plan.rejectVersion) | N |  | implemented | Weekly check-in |
| `plan.declareEvent` | `plan_declare_event` | W·c | all | IP | K |  | implemented | Declare an event |
| `plan.discard` | `plan_discard` | W·c | all | CP (plan.start) | K |  | implemented | Discard a new plan |
| `plan.drift` | `plan_drift` | R | all | — | — |  | implemented | Plan drift |
| `plan.editDay` | `plan_edit_day` | W·c | all | IP | K |  | implemented | Edit a plan day |
| `plan.end` | `plan_end` | D | all | CP (plan.start) | K |  | implemented | End the plan |
| `plan.get` | `plan_get` | R | all | — | — |  | implemented | Read the plan |
| `plan.pause` | `plan_pause` | W·c | all | CP (plan.resume) | N |  | implemented | Pause the plan |
| `plan.rejectVersion` | `plan_reject_version` | W | all | CP (plan.adoptVersion) | N |  | implemented | Reject a proposal |
| `plan.replace` | `plan_replace` | D | all | CP (plan.start) | K |  | implemented | Replace the plan |
| `plan.replan` | `plan_replan` | W·c | all | IP | K | job | implemented | Re-plan |
| `plan.resume` | `plan_resume` | W·c | all | CP (plan.pause) | N |  | implemented | Resume the plan |
| `plan.shift` | `plan_shift` | W·c | all | IP | K |  | implemented | Shift plan days |
| `plan.start` | `plan_start` | W·c | all | CP (plan.discard) | K |  | implemented | Start a plan |
| `plan.swapExercise` | `plan_swap_exercise` | W | all | IP | K |  | implemented | Swap an exercise |
| `plan.versions` | `plan_versions` | R | all | — | — |  | implemented | Plan versions |
| `planner.find` | `planner_find` | W | all | — | K | job | implemented | Find plans |
| `planner.openInSimulator` | `planner_open_in_simulator` | W | all | TS | K |  | implemented | Open a plan in the Simulator |
| `planner.result` | `planner_result` | R | all | — | — |  | implemented | Read the Planner result |
| `planner.stop` | `planner_stop` | W | all | — | N |  | implemented | Stop the Planner |
| `profile.explainMaintenance` | `profile_explain_maintenance` | R | all | — | — |  | implemented | Explain the maintenance estimate |
| `profile.get` | `profile_get` | R | all | — | — |  | implemented | Read your body profile |
| `profile.patch` | `profile_patch` | W·c | all | IP | N |  | implemented | Update your body profile |
| `profile.resetShape` | `profile_reset_shape` | W·c | all | IP | N |  | implemented | Reset shape to the estimate |
| `profile.setSetupStep` | `profile_set_setup_step` | W | ui | IP | N |  | implemented | Move through the body setup |
| `safety.acknowledge` | `safety_acknowledge` | W·c | ui | IP | N |  | implemented | Acknowledge safety copy |
| `safety.acknowledgeDanger` | `safety_acknowledge_danger` | W·c | ui | IP | N |  | implemented | Acknowledge a danger warning |
| `safety.clearAgeAnswer` | `safety_clear_age_answer` | W·c | ui | IP | N |  | implemented | Forget the age answer |
| `safety.clearFastingOptIn` | `safety_clear_fasting_opt_in` | W·c | ui | IP | N |  | implemented | Turn off longer fasts |
| `safety.commitScreening` | `safety_commit_screening` | W·c | ui | IP | N |  | implemented | Save the safety answers |
| `safety.reportIllness` | `safety_report_illness` | W | all | IP | N |  | implemented | Report a recent illness |
| `safety.setFastingOptIn` | `safety_set_fasting_opt_in` | W·c | ui | IP | N |  | implemented | Opt in to longer fasts |
| `safety.setShortWindow` | `safety_set_short_window` | W·c | ui | IP | N |  | implemented | Short eating window |
| `safety.status` | `safety_status` | R | all | — | — |  | implemented | Read the safety status |
| `scenario.applyStarter` | `scenario_apply_starter` | W | all | IP | N |  | implemented | Start from a starter |
| `scenario.create` | `scenario_create` | W | all | TS | K |  | implemented | New scenario |
| `scenario.delete` | `scenario_delete` | W | all | TS | N |  | implemented | Delete scenario |
| `scenario.duplicate` | `scenario_duplicate` | W | all | TS | K |  | implemented | Duplicate scenario |
| `scenario.edit` | `scenario_edit` | W | all | IP | K |  | implemented | Edit schedule |
| `scenario.ensureActive` | `scenario_ensure_active` | W | all | TS | N |  | implemented | Open the working scenario |
| `scenario.get` | `scenario_get` | R | all | — | — |  | implemented | Read a scenario |
| `scenario.list` | `scenario_list` | R | all | — | — |  | implemented | List scenarios |
| `scenario.redo` | `scenario_redo` | W | ui ai | — | — |  | implemented | Redo schedule edit |
| `scenario.rename` | `scenario_rename` | W | all | IP | N |  | implemented | Rename scenario |
| `scenario.setActive` | `scenario_set_active` | W | all | IP | N |  | implemented | Switch scenario |
| `scenario.undo` | `scenario_undo` | W | ui ai | — | — |  | implemented | Undo schedule edit |
| `settings.get` | `settings_get` | R | all | — | — |  | implemented | Read settings |
| `settings.update` | `settings_update` | W | all | IP | N |  | implemented | Change settings |
| `sim.compare` | `sim_compare` | R | all | — | N | job | implemented | Compare variants |
| `sim.explain` | `sim_explain` | R | all | — | — |  | implemented | Explain a simulated change |
| `sim.run` | `sim_run` | R | all | — | N | job | implemented | Run the simulation |
| `sim.series` | `sim_series` | R | all | — | — |  | implemented | Read simulated series |
| `sim.whatIf` | `sim_what_if` | R | all | — | N | job | implemented | What if… |
| `supplements.get` | `supplements_get` | R | all | — | — |  | implemented | Read your supplements |
| `supplements.remove` | `supplements_remove` | W·c | all | IP | N |  | implemented | Remove a supplement |
| `supplements.set` | `supplements_set` | W·c | all | IP | N |  | implemented | Change a supplement |
| `sync.configure` | `sync_configure` | W·c | ui | — | N |  | implemented | Sync settings |
| `sync.join` | `sync_join` | W·c | ui | — | N |  | implemented | Join sync |
| `sync.now` | `sync_now` | W | all | — | N |  | implemented | Sync now |
| `sync.pair` | `sync_pair` | W·c | ui | — | N |  | implemented | Set up sync |
| `sync.rotate` | `sync_rotate` | W·c | ui | — | N |  | implemented | Make a new sync key |
| `sync.status` | `sync_status` | R | all | — | — |  | implemented | Sync status |
| `sync.unpair` | `sync_unpair` | D | ui | — | N |  | implemented | Stop syncing |
| `today.get` | `today_get` | R | all | — | — |  | implemented | Today |
| `train.alternatives` | `train_alternatives` | R | all | — | — |  | implemented | Exercise alternatives |
| `train.session` | `train_session` | R | all | — | — |  | implemented | Training session |
| `train.shoppingList` | `train_shopping_list` | R | all | — | — |  | implemented | Equipment shopping list |
<!-- commands:end -->

## 12. Batch 03 commands (SUITE_SPEC §14)

`biometrics.correct`, `biometrics.clearCorrection` and `biometrics.dropPriorities` are registered (E28,
`src/commands/biometrics/`) and listed in the generated table above. `biometrics.correct` is open to every surface
(the planned row said ui ai mcp; WebMCP agents log too, so a redirected entry from them must be able to stage).
`biometrics.dropPriorities` runs once as the system actor when stored data needs it, in one ChangeSet (not a job).

**Removed in v0.4.0:** `bio.setSourcePriority` (fixed precedence replaces priority lists, SUITE_SPEC §14.6b).

**Changed behaviour (E28):** `log.sleep`, `log.steps`, `log.measurement` (weight, body fat, resting HR, HRV) and
`bio.manual` for a stream a device owns: from the Coach, agents or MCP they are staged as a `biometrics.correct`
proposal (`{ redirected: 'biometrics.correct', proposalId }`); from the UI they return `precondition_failed` with
`detail.reason = 'device_owned'`. Unchanged when no device owns the stream.

**New domain:** `biometrics` (add to `CommandDomain`). Server pairing, provider keys, agent tokens and MQTT credentials
are server calls through `src/net` (SUITE_SPEC §14.2–14.5), not commands: they hold no document state.
