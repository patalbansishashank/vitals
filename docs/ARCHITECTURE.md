# Architecture (engine contracts fixed by `docs/MODEL_SPEC.md`; app suite per `docs/SUITE_SPEC.md`)

`docs/MODEL_SPEC.md` is normative for everything under `src/engine`. This page is the map: layers, folders, data
flow and the rules every contributor follows. v0.1.0 (live 2026-10-01) is the engine, Simulator, Planner and Evidence
library described first; the sections from "After-launch packages" on describe what has landed on the way to v0.2.0
(`plan/01-after-launch/`, status in `docs/ROADMAP.md`).

## Layers
```
UI (React, src/features/*)  ──►  state (Zustand, src/state)  ──►  engine client (src/workers/engineClient, Comlink)
                                                                        │
                                                                        ▼
                                   Web Worker(s): src/engine (pure TypeScript, no DOM, no clocks, no Math.random)
                                   ├─ core/resolveProfile   PersonProfile → ResolvedProfile (body module, RMR0, TDEE0)
                                   ├─ core/compileSchedule  Schedule → CompiledSchedule (DayInput[] + zero-intake mask)
                                   ├─ core/loop             burn-in → hourly loop over 16 modules → SimulationResult
                                   ├─ model/<module>        physiology (one folder per module, one owner each)
                                   ├─ body/                 initial state, regional depots, circumferences, avatar
                                   └─ planner/              optim core (generic) + domain layer (PlanModel, levers)
```

## Folder map and ownership
| Path | Contents | Owner (work package, MODEL_SPEC §11.3) |
|---|---|---|
| `src/engine/types/` | contracts: profile, schedule, inputs, signals (bus), metrics catalogue, events, params, module, result, state | WP-C |
| `src/engine/core/` | loop, recorder, compiler, profile resolution, parameter registry, math, defaults, module registry, unrolled dispatch | WP-C |
| `src/engine/model/<module>/` | `moderators activity intake fasting energy fuel ketones composition muscle water cellular hormones appetite cardiometabolic wellbeing safety` | WP-M1…M13, WP-S |
| `src/engine/body/` | dossier 14 body module (built) | body engineer |
| `src/engine/validation/` | validation harness, scenario fixtures, BWP oracle, known-miss register | WP-V |
| `src/engine/planner/optim/` | engine-agnostic optimiser (built, 73 tests) | planner engineer |
| `src/engine/planner/domain/`, `src/workers/planner*.ts` | PlanModel implementation, lever registry, decoder/repair, evaluator workers | WP-P |
| `src/workers/engine.worker.ts`, `engineClient.ts` | Comlink worker exposing `simulate` and `plan` | app |
| `src/engine/intake/activity/`, `src/engine/assimilation/` | activity intake (maintenance energy from a described day); trend filter, bias estimate, replay and weekly check-in | E7a, E5 |
| `src/engine/planner/{bench,audit}/`, `domain/ladderPlanner.ts` | planner v2: Hard/Medium/Easy ladder + Ideal plan, benchmark harness, evidence-coverage audit | E6 |
| `src/commands/`, `src/store/` | command layer (single mutation path) and local-first document store | E4 |
| `src/sync/`, `src/state/sync/`, `src/net/` | Evolu sync, encrypted blob store, pairing, the only network module | E11 |
| `src/ai/`, `src/agents/` | provider wrapper and tool registry; WebMCP and Companion client | E9, E12 |
| `src/biometrics/` | `vitals.biometrics/1`, importers, scores, Web Bluetooth drivers, opt-in policy, engine adapter | E10 |
| `src/catalogues/`, `src/content/catalogues/` | exercise/equipment/food/supplement schemas, seed data, stimulus mapping, evidence labels | E8 |
| `src/living/`, `src/features/living/`, `src/features/intake/` | living plan domain; its screens; intake flow | E5, E13, E7b |
| `src/features/body/figure3d/` | 3D figure and visceral view | E14 |
| `packages/companion/` | `vitals-companion` Node CLI | E11, E12 |

## Time base and loop
- Fixed **1-hour step, no sub-stepping**; fast dynamics use closed forms (exact exponential relaxation, Lambert-W
  Michaelis–Menten, gamma-kernel hour integrals). Slow states update in `endOfDay` with Δt = 1 d.
- Order per day: resolve runtime energy references → expand the day into 24 hour rows → every module's `startDay` →
  24 × (`stepHour` for each module, `recordHour`) → `endOfDay` → `recordDay` → checks → planner abort test.
- Fixed module order (MODEL_SPEC §3): moderators, activity, intake, fasting, energy, fuel, ketones, composition, muscle,
  water, cellular, hormones, appetite, cardiometabolic, wellbeing, safety. Same-hour reads only from earlier modules;
  everything else is the previous hour's value.
- 14-day burn-in on the habitual week (habitual intake and sessions) before day 0 (no recording, no events), then the
  optional `endBurnIn` hook: energy calibrates NEAT0 so maintenance closes, composition resets tissue masses, water
  re-anchors its references (MODEL_SPEC §3.4).
- Performance: ≤ 10 ms per 180-day run desktop, ≤ 50 ms phone; zero allocation in the step loop (typed arrays,
  monomorphic state objects, unrolled dispatch). Contract overhead with stub modules: 1.5 / 2.6 / 3.3 ms per 180 days
  (`record` none / daily / full).

## Engine module contract (`types/module.ts`)
```ts
interface EngineModule<S, K> {
  id: ModuleId; specSection: string; dossiers: readonly string[];
  params: readonly ParamDef[];                    // every constant, with low/high/grade/source/§/status
  reads: readonly SignalName[]; writes: readonly SignalName[]; records: readonly SeriesId[];
  prepare(ctx: ModuleContext): K;                 // constants from the parameter vector, calibrations
  init(k: K, ctx: ModuleContext, bus: SignalBus): S;
  startDay(s, k, bus, day: DayInput, clock): void;
  stepHour(s, k, bus, hour: HourInput, day: DayInput, clock): void;
  endOfDay(s, k, bus, day: DayInput, clock): void;
  recordHour(s, k, bus, frame: Float64Array): void;
  recordDay(s, k, bus, frame: Float64Array): void;
  finalize(s, k, sink): void;
  endBurnIn?(s, k, bus, ctx: ModuleContext): void; // once, after the last burn-in day (MODEL_SPEC §3.4)
}
```
- Modules communicate only through the monomorphic `SignalBus` (118 numeric signals, one writer each; readers and
  timing listed in `SIGNAL_DEFS` and MODEL_SPEC §4), built with fast properties (`Object.fromEntries`). `checkWiring()`
  reports hard `issues` (foreign writes, undeclared reads) and `pending` adoption of new contract entries.
- One parameter registry: modules declare `ParamDef {id, value, unit, low, high, grade, source, dossier, status?, draw?}`;
  `buildModelParams` validates and hashes them; ensembles override the value vector only.
- A module's state interface lives in its folder and is composed into `EngineState`; `structuredClone(state)` is a
  valid snapshot.

## Inputs
`PersonProfile` (body inputs for dossier 14, habits, cycle/menopause, labs, safety mode) and `Schedule` (programs =
day templates, dense per-day program assignment with overrides, blocks, fast events). Energy is kcal or % of
maintenance with reference `baseline` (default), `current` or `blockStart`; macros in g, g/kg BW, g/kg FFM or % energy.
No diet names exist in the engine. `compileSchedule` resolves everything to numbers (`DayInput`), hour rows are built
per day (`HourInput`). Intake entered by the user is authoritative; hunger and adherence are outputs only.

## Outputs
`SimulationResult {meta, initial, daily, hourly, final, safety, events, warnings}`: typed arrays per series (55
metrics, 13 detail series, 11 input echoes; catalogue `types/metrics.ts` `SERIES` with category, owner, aggregation,
direction, goal eligibility, grade, band method, presentation, caveats); `safety` = dossier 17 derived quantities per
day; events and warnings from preallocated buffers. Blood markers and hormones are presented as change from the user's
baseline. `simulateEnsemble` adds P10/P50/P90 bands from Latin-hypercube parameter draws (fallback fixed bands from
dossier 16 when draws are off).

## Planner
The optimiser core (`planner/optim`) is generic. The domain layer implements `PlanModel<SkeletonStructure, Schedule,
SimulationResult>`: `decode` (18 plan → Schedule), `repair` (17 input-space constraints, logged), `simulate(schedule,
draw)` (= `runEngine` in planner mode, `record:'daily'`, goal/constraint series only, ensemble row `draw` mapped with
`quantilesToParams`, −1 = nominal), `goals`, `constraints` (17 state-space margins from `result.safety`),
`descriptors`, `regulariser`, `features`. Evaluator workers are bound with `createPooledEvaluator(WorkerCall[])`.
Fasting tiers and other safety gates are lever-registry data (MODEL_SPEC §10.3).

## Determinism and testing
Same inputs → bit-identical outputs in one JS engine; randomness only through seeded parameter vectors. Tests:
`src/engine/core/__tests__` (loop, compiler, registry, benchmark), module unit tests in each module folder, the
validation suite (`src/engine/validation`, MODEL_SPEC §9: oracles, conservation, dossier targets, known-miss register).

## UI feature slices (file ownership for parallel build)
`src/features/body` (profile form + avatar) · `src/features/simulator` (schedule builder, day editor, results) ·
`src/features/planner` · `src/features/evidence` · `src/features/settings` · `src/components` (design-system
primitives) · `src/features/charts` (chart engine wrapper).

## After-launch packages (v0.2.0 work, `plan/01-after-launch/`)
Status as of 2026-10-01: the packages below have landed on their `wp/*` branches and been merged into the integration
branch (E5, E7, E8, E9–E14); E4 (commands/store) is merged but several executors are still stubs, E6 (planner v2) and
E9b (Coach on the AI layer) are not finished (see `docs/ROADMAP.md`). Normative specs: `docs/SUITE_SPEC.md` (suite,
commands, store, sync, AI, biometrics, living plan) and `docs/PLANNER_V2_SPEC.md` (planner).

```
 devices/files ──► src/biometrics ──► scores ──► engine adapter ──┐   (opt-in per stream; vendor scores never used)
                                                                  ▼
 UI (features/*) ─┐                                    src/living ──► src/engine/assimilation ──► engine/planner
 AI tools (src/ai)├─► src/commands (dispatch) ─► src/store (documents, IndexedDB) ◄─► src/sync (Evolu, E2E encrypted)
 WebMCP / MCP    ─┘            ▲                                                          │
 (src/agents, Companion)       └── tool manifest (vitals.tools/1)                 relay + blob store (Companion or any
                                                                                 user-supplied endpoint) via src/net
```

### Commands (`src/commands`, docs/COMMANDS.md)
- **Single mutation path.** Every change to user data is `dispatch('domain.verb', input)` (`bus.ts`). The UI, the Coach
  (AI tools), WebMCP and the Companion's MCP server all call the same commands; the only other writers are sync (merging
  remote documents), the one-time migration and derive jobs, each with its own write-token kind. v0.1 Zustand store
  actions keep their signatures but now dispatch commands. A "strict store" throws `WriteOutsideCommand` (dev/test) for a
  persisted write outside a command.
- Modules: `registry.ts` (`defineCommand`, ids `domain.lowerCamel`), `schema/` (JSON-schema builders), `defs/<domain>.ts`
  (146 commands in 26 domains at the time of writing; counts and the stub list are generated into docs/COMMANDS.md),
  `manifest.ts` (tool manifest and `TOOLSET_HASH` generated from the registry; names are `snake_case` of the id),
  `confirm.ts` (confirmation classes read / log / edit / destructive, one-time confirmation tokens), `history.ts` (change
  sets, undo), `jobs.ts`, `adapters/` (Anthropic and OpenAI tool renderings), `living/` and `livingWiring.ts` (E5
  executors plus rollover freezing and daily assimilation as derive jobs).
- `implement.ts`: other packages declared commands as stubs (id, schemas and policy fixed, executor returns
  `precondition_failed`); `implement(id, exec)` swaps in the real executor. The domain modules `commands/{sync,bio,catalogue,ai}`
  exist as placeholders for those executors and are still empty, so the corresponding commands remain stubs.
- Rule: screens read through hooks and write only with `dispatch`; a parity test (`src/commands/__tests__/parity.test.ts`)
  checks that UI actions and tool surfaces stay in step.

### Store (`src/store`) and sync (`src/sync`, `src/state/sync`, `src/net`)
- `src/store`: the local-first `DocumentStore` (collections with schemas, `transact(token, …)`, `watch`), IndexedDB
  backend (`idbBackend.ts`) and an in-memory backend for tests. The v0.1 `vitals.*` localStorage keys stay as the
  synchronous boot cache and rollback copy; Zustand stores are projections bound to documents (`src/state/bridge.ts`,
  `src/state/persistence.ts` handles export v2, import and erase).
- `src/sync`: `SyncStore` on Evolu (`evolu/adapter.ts`: SQLite on OPFS in a worker, per-column last-writer-wins, end-to-end
  encryption under keys derived from the owner secret, one WebSocket to a relay); account-free pairing by a 24-word
  phrase or `vitals-sync:1?…` link (`pairing.ts`); Vitals' own key schedule (`crypto.ts`, HKDF on WebCrypto); a trigger
  scheduler with back-off (`scheduler.ts`); an immutable encrypted chunk store for raw samples (`blobs/`: encode, gzip,
  AES-GCM, local OPFS cache, remote endpoint; manifest rows sync, bytes never enter the CRDT). `src/state/sync` is the
  app-side controller and key vault; Settings › Sync is `src/features/settings/sync`.
- `src/net/net.ts` is the only module allowed to touch the network (ESLint bans `fetch`, `WebSocket`, `EventSource`,
  `XMLHttpRequest` elsewhere). Because users enter their own AI and sync endpoints, the production CSP allows any
  `https:`/`wss:` origin (and loopback) in `connect-src` and adds `'wasm-unsafe-eval'` for Evolu's SQLite-WASM
  (`netlify.toml`); the compensating control is a device-local, per-purpose origin allowlist in `net.ts`
  (`vitals-net.allow`, never exported or synced). Same-origin is always allowed.
- Rule: nothing is held by us. Data lives in the browser and, if the user pairs devices, on a relay they choose,
  encrypted so the relay sees ciphertext only.

### AI layer (`src/ai`) and agents (`src/agents`)
- `providers/`: one wrapper over three wire formats (`openaiChat`, `openaiResponses`, `anthropicMessages`) with SSE
  parsing, retry, usage and image handling; providers are data (`presets.ts`: base URL, adapter, auth header, quirks,
  recommended models); `probe.ts` detects capabilities and degrades to a basic tier. `keys.ts` is the key vault.
  `storage/kv.ts` is a small IndexedDB/memory KV.
- `tools/`: the tool registry over command definitions (`registry.ts`, per-dialect rendering, `TOOLSET_HASH`), the
  proposal flow (`proposals.ts`: read runs, log applies with an undo token, edit is staged as a reviewable proposal,
  destructive waits for typed confirmation in the app; idempotency ledger, per-turn limits) and result budgets.
- `src/agents`: the app side of external agents: WebMCP registration in this tab (off by default, `webmcp.ts`), the
  Companion client and tab bridge (`companion.ts`), the guarded dispatcher every agent call goes through
  (`dispatcher.ts`), an activity indicator with a stop control, and the tool-manifest types (`manifest.ts`,
  `vitals.tools/1`). Settings › Agents is `src/features/settings/agents`.
- Status: the Coach screen (`src/features/living/coach`) still runs on a mock adapter; wiring it to `src/ai` is E9b.

### Biometrics (`src/biometrics`, docs/biometrics, docs/wp/E10.md)
- Contract `vitals.biometrics/1` (`core/types.ts`): canonical streams (hr, ibi, hrv, spo2, skin/body temp, steps, sleep
  stages, …) and records (sleep sessions, workouts, daily summaries, body), with source resolution (`core/resolve.ts`,
  `source.ts`) so overlapping devices do not double count.
- Inputs: file importers (`importers/`: canonical JSONL, Apple Health XML/zip, Health Connect, Gadgetbridge SQLite, Health
  Auto Export, Lumen CloudEvents) and Web Bluetooth drivers (`ble/`: registry, session runner, drivers for the J-Style 2301
  ring and Colmi R02, recorded-link fake for tests). `ingest/` is the pipeline (validate, dedupe, chunk to the blob
  store); `store/` holds the in-memory store. Third-party licences: `src/biometrics/LICENSES.md`.
- Scores are computed from raw data, versioned and re-runnable (`core/scores/`: sleep.index 4.0.0 and readiness.index
  1.0.0 as exact ports of the Android estimators, VO2max Kalman ladder, load/ACWR, HRV status with a 60-day baseline,
  resting HR, night vitals, overreaching, autonomic, illness signal; `rescore.ts`, `ingest/rescoreJob.ts`). Vendor scores
  are stored but never taken at face value.
- Boundary to the engine: `core/policy.ts` is the opt-in matrix (all streams off by default; only eligible streams can
  drive the engine) and `core/engineAdapter.ts` turns resolved days and scores into observation inputs with provenance
  (measured / estimated / assumed). Flow: importers or drivers → ingest → store/blobs → scores → policy → engine adapter →
  `src/living` (`LoggedDay` observations) → assimilation. Pure tier (P) except `ble/`, `importers/` and `ingest/` (H).
- Status: the `bio.*` commands are stubs, and Settings › Devices defers to the intake's devices chapter
  (`src/features/intake/chapters/devices.ts`) until the stream matrix UI lands.

### Catalogues (`src/catalogues`, `src/content/catalogues`, docs/CATALOGUES.md)
- Pure (no React/state/clock). Schemas and `createCatalogue`/`validateCatalogue` (`catalogue.ts`, `types.ts`); stimulus
  mapping from exercise and dose to the engine's training inputs (`stimulus.ts`); equivalence credit for substitutions
  (`equivalence.ts`); equipment-aware session composition and shopping list (`compose.ts`); food tables and meal
  totals (`foods.ts`); the evidence policy helpers (`evidence.ts`): each item carries a two-axis `EvidenceLabel`
  (mechanism known and its pathway, empirical certainty A-D), mechanism is the signal and grades inform but do not gate;
  `params.ts` exports constants as `ParamDef`s for the Evidence library.
- Seed data (`src/content/catalogues`, `SEED_CATALOGUE`, version `seed-2026.10.01`): exercises, equipment, supplements, no-benefit
  and advisory records, with sources. The food catalogue is a small fixture only (`foods.fixture.ts`).
- Used by: planner (equipment-aware prescription), living plan (session compiler port), Train/Food screens.

### Living plan (`src/living`, `src/features/living`, docs/LIVING_PLAN.md)
- `src/living` is the pure domain: plan lifecycle (scheduled, active, paused), calendar anchoring, frozen daily
  prescriptions, daily log to `LoggedDay`, adherence and revealed adherence, drift, the Today contract, re-plan triggers
  and requests (`replan.ts`), plan start, and `assimilate.ts`/`projection.ts` which drive the estimation loop. No React,
  store or clock: commands call it with documents and clock/id ports (`commands/livingWiring.ts`).
- `src/features/living`: Today, Food, Train, Coach, Progress and Plan details (`routes.tsx`), Start-plan sheet; app mode is
  derived (`mode.ts`: living while a plan is scheduled/active/paused, planning otherwise) and drives the shell nav
  (`src/app/shell/modeNav.tsx`).
- Stubs still present: the Coach adapter (mock), the recipe provider and the scores source.

### Activity intake (`src/engine/intake/activity`, `src/features/intake`)
- Engine side: `resolveActivity.ts` turns "what does a normal day look like" answers (occupation class, steps, walking and
  standing time, commute, home work, recreation) into habitual steps, NEAT0 components, baseline TDEE0 with drivers and a
  p10/p90 band; `core/resolveProfile` calls it once per profile. Constants are `ParamDef`s (`params.ts`).
- UI side: `src/features/intake` (routes `/onboarding/:section`, an `intake/me` document, Body maintenance panel).

### Assimilation and re-planning (`src/engine/assimilation`, `src/engine/planner`)
- Pure: weigh-in trend filter with day-of-week offsets (`trendFilter.ts`), energy-balance bias (`energyBias.ts`), realised
  schedule from logs (`realised.ts`), replay with tissue anchors and intake offset (`replay.ts`, `runHooks.ts`), weekly
  check-in producing a confirmed day-stamped snapshot (`checkIn.ts`, `reanchor.ts`). Hooks are applied inside the engine
  loop without changing its determinism.
- Planner v2 (`planner/domain`): `ladderPlanner.ts` (Hard, Medium, Easy rungs from one optimiser run, plus an Ideal plan
  without practical limits; safety limits always kept), `replan.ts`, `equipment.ts`, `fastingExplain.ts`, `evidenceGraph.ts`;
  `planner/bench` is the benchmark harness (toy and domain suites, frozen v1 baseline); `planner/audit` is the
  evidence-coverage audit. The ladder UI is in `src/features/planner` (`ladder.ts`). Still open: see ROADMAP.

### 3D figure (`src/features/body/figure3d`)
- `<Figure3D params frame visceral/>`: MakeHuman-based (CC0) mesh drawn by an in-house WebGL2 renderer in a lazy chunk
  (`public/figure/figure-v1.bin`, built by `scripts/figure/`); a fitter (`fit.ts`, `measure.ts`) matches girths to the engine's
  body state; `visceral/` draws the true-to-scale abdominal section. The SVG `BodyAvatar` shows while loading and whenever
  WebGL2 or the asset fails. `/dev/figure` is the developer screen. Drawing frame never changes estimates. Gate numbers:
  docs/wp/E14.md. It is not mounted on the Body page yet (only the `/dev/figure` route uses it).

### Companion (`packages/companion`, its README)
- `vitals-companion`: an optional Node (22.18+) program the user runs on their own machine; Node runs the TypeScript directly.
  Subcommands `sync`, `serve`, `proxy`, `pair`, `mcp`, `keys`, `siwc` on one port (default `127.0.0.1:4870`).
- It provides what a static app cannot: a sync relay and blob store (`relay.ts`, `blobs.ts`, `evoluNode.ts`); an AI proxy
  for providers that need a server-held key or sign-in (`proxy.ts`: NVIDIA NIM, OpenCode Zen, Sign in with ChatGPT with
  PKCE, `siwc.ts`); and an MCP server (`mcp.ts`, Streamable HTTP and stdio) whose tools come from the app's `vitals.tools/1`
  manifest and are executed in the paired browser tab over a WebSocket agent hub (`agentHub.ts`, `bridgeProtocol.ts`).
- Security (`security.ts`, `auth.ts`, `config.ts`): origin and Host checks, local pairing code to a per-origin token, admin
  token for CLI processes, 0600 secrets (hashes only for tokens), rate limits, redacting logger. Provider keys and OAuth
  tokens live only in the Companion; the page never holds them.
- Not part of the static deploy; the app works without it.

### Evidence library additions (`src/content/evidence`, `src/features/evidence`)
- Six new topics (dossier files 22-27): Daily activity and maintenance energy, Scores from wearable data, Tracking and
  re-planning, Training catalogue evidence, Supplements, How Vitals weighs evidence. They are registered in
  `content/evidence/index.ts` (files `topics/22-*` to `27-*`). After-launch research pointers on parameters ("R1 §3.2")
  map to these topics in `sources.ts`, so parameter evidence lines cite them by name.
- Parameter cards: a mechanism lists `relatedParamIds`; `content/evidence/params.ts` resolves them against every
  `ParamDef` (engine modules, activity intake, assimilation, catalogue constants) so a card shows value, range, grade and
  source, plus the two evidence labels (mechanism, certainty) and the band inflation of `catalogues/evidence.ts`
  (`content/evidence/paramEvidence.ts`). The Explain drawer takes a `paramId` and finds the mechanisms that document it.
- Validation page: the bundled `docs/VALIDATION_REPORT.md`, then two data sections. Planner benchmarks: the schema,
  shape check and fixture are in `content/evidence/validation/plannerBenchmarks.ts`; the page bundles
  `docs/validation/planner-benchmarks.json` when the planner harness has written it and otherwise says "not published
  yet". Activity intake: a snapshot of the validation suite's activity-intake rows
  (`validation/activityIntake.snapshot.json`, checked against a fresh run by a test; regenerate with
  `VITALS_UPDATE_SNAPSHOTS=1`) with plain-language labels and miss reasons. The guard test scans both.

### Boundaries that hold across the suite
- Client-only: the production site is static; there is no backend, no account, no analytics and no data held by us.
- Engine and `src/living`, `src/catalogues`, `src/biometrics/core` (except `ble`/`importers`/`ingest`) stay pure: no DOM, React,
  clock or randomness; effects arrive through ports.
- All writes are commands; all network goes through `src/net`; secrets never enter synced documents or exports
  (`vitals-net.*`, `vitals-companion.*` keys are device-local).
- CSP (`netlify.toml`): `script-src 'self' 'wasm-unsafe-eval'`, `object-src 'none'`, `frame-ancestors 'none'`,
  `connect-src` open to `https:`/`wss:` plus loopback (compensated by the `net.ts` allowlist).
- Installable and offline: `vite-plugin-pwa` Workbox service worker precaches the build; the update prompt and install
  hint are in `src/app/pwa`.
