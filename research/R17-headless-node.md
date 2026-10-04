# R17: the Vitals data layer headless in Node

Spike: `packages/companion/spike/headless/` (README there). Date: 2026-10-03. Node v26.10.0, linux-x64, 32 cores shared with other jobs. The raw numbers are in `packages/companion/spike/headless/results/r17-results-test.json` and `…-production.json`.

## Answer in one paragraph

The website's own data layer runs headless in Node today, and none of it had to change. A person's Evolu store opens from a directory through the existing Node platform (`packages/companion/src/evoluNode.ts`). The app's document runtime switches to it through the public seam `installPersistenceBackend` (`src/state/runtime.ts:495`). After that the unmodified command bus (`src/commands/index.ts`) runs reads and writes against it with no DOM: `today.get`, `plan.get`, `day.get`, `food.dayTargets`, `log.steps`, `log.sleep`, `log.measurement`, `log.note`, `log.get`, `pantry.add`, `settings.update`, `data.export`. `bio.import` ingests a Lumen CloudEvents JSONL file through the real importer and pipeline: 124 events become 2 records, 122 samples and 3 chunks, then 46 scores. An MCP tool call goes through the same guard the browser bridge uses (`guardedCall` + `createBusAgentDispatcher`) and is applied without a browser tab. A second device paired with the same secret receives all 17 synced documents through the in-process relay in about 125 ms. The same code also bundles with vite SSR into a plain Node program, which cold-starts in about 0.3 s at about 150 MiB RSS. No patch to the main tree was needed (`patches/` is empty).

What does not work yet, in rank order (details in "Blockers for E25"):

1. The bus and the document runtime are module singletons, so one module graph holds one person.
2. Raw-sample bytes go to an in-memory blob store, so they are lost on restart and never uploaded.
3. Local-only collections, including the idempotency ledger and the undo log, live in memory.
4. The day and timezone come from the server's clock zone, not the person's.
5. The device id is fresh on every start unless the caller seeds it.
6. Living automation and rescoring only start in a browser window.
7. Database files are created 0644.
8. The planner, PDF and Coach-vision ports exist only in the browser.

## What was run

| Step | How | Result (vitest, `--mode production`) |
|---|---|---|
| Import the command bus in Node (no jsdom) | `await import('@/commands')` | ok, 162 commands; 3.9 s under vitest (on-the-fly transform), **0.23–0.27 s bundled**; +122 MiB RSS under vitest, +44 MiB bundled |
| Open a person store from a directory | `openPersonStore()` → `createEvoluSyncStore` + `createNodeEvoluPlatform({ dataDir })` + `createSyncedBackend` | ok, **50–68 ms** cold, 16–23 ms reopen |
| Attach to the app runtime | `setDocumentStore(seed)` then `installPersistenceBackend(backend, { copy: false, prefer: 'docs' })` | ok, 9–19 ms |
| (a) Commands | `dispatch(id, input)` | every read and log command listed above ok, 0–24 ms each; `today.get` 0.2–0.3 ms after warm-up (20 calls, no RSS growth); `pantry.add` 236–416 ms on first call (catalogue load) |
| (b) Ring ingest | bio port `takeFile` returns a Node `Blob` of `fixtures/ring.jsonl`; `dispatch('bio.import', { fileRef, format: 'lumen_cloudevents' })`; job awaited | job `done` in 460–640 ms: 2 records, 122 samples, 3 chunks, 0 duplicates, 0 rejected, 46 scores |
| (c) Agent tool call | `guardedCall(createBusAgentDispatcher(), manifest, 'mcp', toolName(id), args, { actor: { kind: 'mcp', id } })` | 124 tools exposed to MCP; `today.get`, `plan.get`, `settings.update`, `log.steps` all `applied` (envelope `{ ok, status, changeId, summary, data }`) |
| (d) Second device | separate `createEvoluSyncStore` (memory only) with the same secret and relay | 17 of 17 synced documents seen in 120–128 ms, same count per collection (profile, safety, goals, scenarios, dailyLogs 4, measurements, bioRecords 2, bioChunks 3, bioSources, pantry, settings) |
| Restart | close and reopen the person directory | 17 documents back in 16–23 ms |
| Living automation | `startLivingAutomation()` + `runRollover()` | ok (needs an explicit call on the server, see blocker 6) |
| Port-dependent commands | `planner.find`, `markers.import`, `nav.open`, `data.export` | `nav.open` and `data.export` ok without ports; `planner.find` stopped earlier at the safety gate (`safety_blocked`, no intake answers), **so the missing planner port was not reached**; `markers.import` stopped at `not_found` (no attachment), **so pdf.js was not reached** |

Note on `MODE`: inside vitest, `import.meta.env.MODE` is `test` by default, and several modules then take test shortcuts (`isTest()` in `src/state/runtime.ts:51`, `src/state/blobStore.ts:41`, `src/commands/bio/runtime.ts:38`). I repeated the run with `--mode production` so the server's real branches ran. Both runs passed. The production run additionally touched `indexedDB` at `src/store/idbBackend.ts:53` and `src/state/blobStore.ts:53` (see below).

## Browser dependencies hit, with the smallest fix

Recorded by `traps.ts`, which records every access with the first app stack frame. "Benign" means the code already checks `typeof …` and takes a working Node path.

| Dependency | Where (first frame) | Effect in Node | Smallest fix |
|---|---|---|---|
| `window` (pagehide/visibility flush) | `src/state/bridge.ts:221` | skipped (benign) | none. On the server, call `flushAllMirrors` on SIGTERM if the mirrors are kept at all |
| `localStorage` (projection mirrors, boot cache) | `src/state/bridge.ts:152`, `src/state/persistence.ts:120` | returns null, so mirrors are skipped (benign; the document store is the truth) | none |
| `localStorage` → **device id** | `src/state/runtime.ts:58` (`deviceId()`) | **a new DeviceId on every process start** | injection point: seed the runtime with the person's id (the spike does this in `personStore.ts` via `setDocumentStore`). Cleaner: `device?` in `InstallOptions` (`runtime.ts:477`) |
| `window` → document **boot and living automation** | `src/state/persistence.ts:612` | the browser boot (`bootDocuments`, then `startLivingAutomation`, `persistence.ts:614–620`) never runs | the server calls `installPersistenceBackend` (which boots) and `startLivingAutomation()` itself (verified) |
| `indexedDB` (document backend) | `src/store/idbBackend.ts:53` via `runtime.ts:85` | the default store falls back to memory | replaced by the person's backend (as the spike does) |
| `indexedDB` / OPFS (**blob store**) | `src/state/blobStore.ts:53` (`createPersistent`) | **memory placeholder: raw sample chunks are lost on restart and never uploaded to `/blobs`**. Other devices get the `bioChunks` manifests but cannot fetch the bytes | module addition: a Node `BlobBackend` (files under `<person>/blobs/`) + `ChunkIndex` (one SQLite table) for `createChunkStore` (`src/sync/blobs/chunkStore.ts:79–104`), then `setBlobStore()` and `attachRemote` as the browser sync runtime does |
| `Intl` time zone | `src/commands/bus.ts:153–157` (`timeZone()`), used at `bus.ts:272` for `today` and `tz` | **every command uses the server's zone** (this machine: Asia/Calcutta; a server is usually UTC), so the person's "today" and rollover are wrong | injection point: a `tz` (or `clock`) port read by `timeZone()`, set per person from their settings or device. `process.env.TZ` is process-wide, so it does not work for several persons |
| `navigator.locks` | `packages/companion/src/evoluNode.ts:43` | Node 26 has it (works) | none. On older Node the existing `testCreateLockManager` needs a polyfill |
| `navigator.userAgent` | zod `v4/core/util.js:224` | benign | none |
| `document` | `@evolu/common/dist/src/Platform.js:17` | benign (platform probe) | none |
| `window` via react-router and `src/components/lib/hooks.ts:5` | reached through the bus graph: `src/state/*` imports `@/features/**` (for example `src/state/safetyStore.ts:12`, `src/state/internal/intake.ts:8–15`). I did not trace the exact chain to react-router | benign, but it adds React, react-router and UI code to the server's memory (part of the +44 MiB) | module split later: move the pure models used by `src/state/internal/*` out of `src/features/**` |
| Web Workers (planner, simulation, engine pools) | `src/workers/plannerClient.ts`, `simulationClient.ts`, `engineClient.ts`; the planner port is installed by `src/features/planner/run.ts:149`, which the bus does not import | not reached in the spike (`planner.find` stopped at the safety gate). Without the port, the planner commands fail on the server | Node port: `worker_threads` pool. `src/engine/planner/bench/node/pool.ts` already exists for the bench. Install it with `installPorts({ planner })` |
| pdf.js (`markers.import`) | `src/markers/extract/pdfClient.ts`, `src/markers/extract/pdf.ts` | not reached (no attachment). It uses a browser worker | out of E25 scope: run lab-PDF reading in the browser and send the result as a command, or add a Node pdf.js later |
| `fetch` | (not hit) | the import, scoring and sync paths do not fetch; sync uses Evolu's WebSocket | none. AI calls still go through `src/net/net.ts` |
| `window.__vitals`, comlink, SharedWorker (browser) | not hit | Evolu's SharedWorker and DbWorker are already shimmed in-process by `evoluNode.ts` | none |
| bio file hand-off | `src/commands/bio/runtime.ts:13` (`takeFile`) | the default reads files the screen staged | injection point (used): `installPorts({ bio: { takeFile } })` with a Node `Blob`. For MQTT, call `ingestBatches` (`src/biometrics/ingest/pipeline.ts:45`) with the importer's batches instead of staging a file |

Stubbed in the spike: only the `bio.takeFile` port (and `takeLink` returning undefined). Nothing else.

## Memory and start-up

| Measurement | Value |
|---|---|
| Bundled program, one person: cold start → bus loaded | 232–269 ms, RSS 136 MiB |
| + open and attach the person store | 58–64 ms, RSS 152–153 MiB |
| First write command (`log.steps`) | 15–18 ms |
| `today.get` | 1–2 ms on first call, 0.2–0.3 ms warm |
| Whole program, wall time including Node start | 555–672 ms |
| Under vitest: bus import | 3.9–5.0 s, +122 MiB (transform cost; not representative) |
| One more Evolu store in the same graph | +0.2 to 14.8 MiB, 50–68 ms to open |
| 5 extra Evolu stores (raw sync stores, same graph) | +5.7–6.2 MiB open, +26 MiB after 1,000 writes (≈5 MiB per person), 29–42 ms each to open, 1,000 writes in 190–230 ms |
| **Full persons (bus + store) as `worker_threads`, 1** | +118 MiB over the parent, ready in 569 ms |
| **Full persons as `worker_threads`, 5** | +488 MiB (**≈98 MiB per person**), all ready in 742 ms |
| Bundle size (`vite build --ssr`, npm packages external) | 7.6 MB in 136 chunks (the evidence dossiers are the largest) |

How many persons one process can hold: with the code as it is, one person per module graph. That means one `worker_threads` Worker (or one process) per person at about 100 MiB each, plus about 50 MiB for the parent. Five persons fit in about 0.55 GiB. The Evolu stores themselves cost only about 5 MiB each. Once the bus and the runtime take a per-person context (blocker 1), N persons would cost about 140 MiB shared plus about 5 MiB each, plus their projections, which I did not measure. A middle path that needs no refactor: open a person's worker on demand (an MQTT message, an HTTPS call, a sync push) and close it after it has been idle. Cold open is about 0.6 s.

## Person directory on disk

What the spike produced (one person after the commands, the import and a restart):

| Path | Size | Mode | What it is |
|---|---|---|---|
| `persons/<id>/` | dir | **0700** (set by `openPersonStore`) | one folder per person |
| `persons/<id>/owner.key` | 32 B | **0600** (set by `main.ts`) | the owner secret, raw 32 bytes (the same entropy as the 12/24-word phrase) |
| `persons/<id>/vitals-<22-char id>.db` | 60–112 KiB for this data | **0644 (umask; must be 0600)** | Evolu's SQLite database (better-sqlite3). Evolu chooses the name. No `-wal` or `-shm` files remained after a clean close |

What E25 must add to this layout (not in the spike):

| Path | Why |
|---|---|
| `local.db` (0600) | the local-only collections: `changeLog` (undo), `commandLedger` (idempotency keys, which matter for MCP retries and MQTT replays), `jobs`, `aiUsage`, `bioScores` and `derived` (can be recomputed), `secrets`, `providerKeys`, `syncState`, `deviceSettings`, `uiPrefs` (`src/store/collections.ts:162–209`). In the spike they live in memory (`createMemoryBackend`) and are lost on restart |
| `blobs/` (0700) + chunk index (0600) | raw sample bytes (blocker 2) |
| `person.json` (0600) | display name, timezone, device id of the server's copy, relay URL, MQTT credentials hash |

Start the server with `process.umask(0o077)`. Then every file, including Evolu's database and its WAL files, is created 0600 or 0700 without per-file chmods.

## The owner secret in the Node process

- What it is: the 32-byte owner secret (`newOwnerSecret()` in `src/sync/pairing.ts`). `secretToWords` and `wordsToSecret` convert it to and from the phrase. Evolu derives the owner and the encryption keys from it (`createAppOwner` in `src/sync/evolu/adapter.ts:352–353`). Whoever holds it can read and write the person's data. A server that "does the work" must therefore hold it. That is inherent to the final scope and A4 should state it plainly.
- How it reaches the server: `vitals-server persons add <name>` either creates a new secret or reads the existing phrase from stdin with echo off (never from argv, which shows in `ps` and shell history; never from an environment variable).
- How it is stored: it is written once as raw bytes to `<person>/owner.key`, mode 0600, inside the 0700 person directory, owned by the service user. It is read at open time into a `Uint8Array` that is passed only to `sync.open`. It is never logged, never written into `person.json`, and never returned by any route. The browser pairs with the phrase as it does today.
- Optional later step: encrypt `owner.key` with a key from systemd `LoadCredential=` or the OS keyring. The file permissions are what protect it on a single-user host.

## Blockers for E25, ranked

| # | Blocker | Pointer | Fix | Effort |
|---|---|---|---|---|
| 1 | The bus and the document runtime are module singletons, so one person per module graph | `src/commands/bus.ts:65–74` (`jobs`, `ports`), `src/state/runtime.ts:47–49` (`store`, `booted`), zustand projections in `src/state/*Store.ts` | E25: one `worker_threads` Worker per person running the bundled person program (proven, about 100 MiB each), opened on demand and closed when idle. A per-person context through the bus and the runtime is the long-term fix | worker per person: **1–2 days** (message protocol: dispatch, agent call, ingest, close). Context refactor: **1–2 weeks**, not needed for one or two persons |
| 2 | Raw-sample bytes go to an in-memory blob store: lost on restart, never uploaded to `/blobs` | `src/state/blobStore.ts:52–53` (`createPersistent`) | Node `BlobBackend` (files) + `ChunkIndex` (SQLite) for `createChunkStore`; `setBlobStore`; `attachRemote` to the relay | **1 day** |
| 3 | Local-only collections live in memory: idempotency ledger, undo log, jobs, AI usage | `personStore.ts` passes `createMemoryBackend` as `local` to `createSyncedBackend` (`src/sync/syncedBackend.ts:37–47`) | a `PersistenceBackend` on better-sqlite3 (`local.db`), the same interface as `src/store/memoryBackend.ts` | **1 day** |
| 4 | Time zone and "today" come from the server process | `src/commands/bus.ts:153–157`, `:272` | a `tz` port (or a `DispatchOptions.tz`) read by `timeZone()`, set per person | **0.5 day** (tests included) |
| 5 | DeviceId is new on each start | `src/state/runtime.ts:56–76` (`ls()`, `deviceId()`) | seed it as the spike does, or add `device?` to `InstallOptions` | **1 hour** |
| 6 | Boot and living automation run only in a browser window; background rescoring relies on timers in a live page | `src/state/persistence.ts:612–620`, `src/commands/bio/runtime.ts:38–56` | the server calls `installPersistenceBackend`, `startLivingAutomation()`, and `flushRescore()` before closing a person | **2 hours** |
| 7 | Database files are 0644 | `evoluNode.ts` creates through better-sqlite3 with the process umask | `process.umask(0o077)` at server start, plus a check in `vitals-server status` | **1 hour** |
| 8 | Agent calls are forwarded to a browser tab | `packages/companion/src/agentHub.ts:1–16` (`NO_TAB_MESSAGE`) | the `home` role routes `tools/call` to the person worker, which runs `guardedCall(createBusAgentDispatcher(), …)` (proven in the spike); the existing re-check in agentHub stays | **1 day** |
| 9 | Ring ingest from MQTT: the importer reads a `Blob` | `src/commands/bio/exec.ts:796–830`, `src/biometrics/importers/lumenCloudEvents.ts:273` | for live events, call the importer on a small in-memory `Blob` per message batch (works today, as the spike does) or feed `ingestBatches` directly; acknowledge after `backend.settled()` | **0.5 day** on top of the broker work |
| 10 | Planner and simulation worker pools exist only in the browser | `src/workers/plannerClient.ts`, `src/features/planner/run.ts:149` | Node pool from `src/engine/planner/bench/node/pool.ts` installed as the `planner` port. Not proven here | **1 day**, only if the Coach must run the planner server-side |
| 11 | The UI and React graph is loaded on the server | `src/state/safetyStore.ts:12`, `src/state/internal/*.ts` → `@/features/**` | split the pure models out of `features`. Memory only, not correctness | **2–3 days**, defer |
| 12 | Lab PDFs (pdf.js worker) | `src/markers/extract/pdfClient.ts` | keep PDF reading in the browser for now | defer |
| 13 | Shipping: better-sqlite3 is a native module (oci-arm is arm64) | `@evolu/nodejs` | build with `vite build --ssr` (proven), install production `node_modules` on the host, or build on arm64 in CI | **0.5 day** |

Total for a working `home` role (items 1–9 and 13): about 6–7 working days of engineering, plus the HTTP, broker and CLI work E25 already lists.

## Open, and why

- **A server-side Coach turn (the LLM loop in `src/ai/coach/runtime.ts`) was not run.** The spike proves the tool-call path (bus + guard), not the model loop or the provider-via-server path. That is the next spike step, or the first E25 test.
- **The planner port and pdf.js were not reached** (safety gate, no attachment). Blockers 10 and 12 come from reading the code, not from a run.
- **Projection memory per person** (zustand stores filled from a large real history) was not measured. The spike's data is small. A run on a copy of real-size data is needed before choosing between "worker per person" and keeping persons warm.
- **I did not trace the exact import chain to react-router.** I only know that it is reached through `src/state` → `src/features`.
