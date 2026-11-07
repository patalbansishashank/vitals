# Sync harness (plan 04 item 3, "Tests (binding)")

Four replicas in one sync group, run against the real Vitals Server (never a throwaway relay):

- **A, B, C**: Node replicas, one process each, running the app's own sync code (`src/sync/evolu/adapter.ts` on the
  server's Node platform `packages/companion/src/evoluNode.ts`, SQLite files under `.e6-tmp/sync-harness/<run>/`).
  They stand in for the desktop app, the phone app and a website profile until L-QA plugs the real apps in.
  Each sits behind its own switchable loopback proxy (`lib/proxy.mjs`) in front of the server, so `goOffline()` cuts
  that one device's socket and `/blobs` requests the way a lost network does.
- **S**: a test person on the real server, labelled `L-SYNC-harness`, that joins the group with the harness's own
  sync words. The harness reads and writes it through the server's MCP endpoint with an agent token (scope `log`).

Every scenario prints PASS / FAIL / OBSERVED lines and writes `qa/results/sync/<scenario>.json` (checks, times in ms,
observed values); `summary.json` holds the totals. The test person, its agent token and the replica data are removed
at the end, also on failure or Ctrl-C.

## Run

```sh
node qa/scripts/sync/run.mjs              # all: S1 S2 S3 S4 S5 S6, then a final convergence check
node qa/scripts/sync/run.mjs S5           # one or more scenarios
node qa/scripts/sync/killWindow.mjs 5     # local only, no server: the S4 kill window (5 tries per delay)
```

Options (environment): `SYNC_OFFLINE_S=60` (S2's offline period), `SYNC_KEEP=1` (keep the person and the replica
data to look at afterwards; remove the person by hand with `vitals-server persons remove <id>`).

A full run takes about 6 minutes; S5 alone about 1 to 2 minutes.

### What it needs

- Node 22.18 or newer (type stripping; the repo pins Node 26), the repo's dependencies installed (`pnpm install`).
- `qa/local.config.json` (git-ignored, shape in `qa/local.config.example.json`) with `serverUrl` (the server's origin)
  and `serverSsh` (the ssh alias of the server). `VITALS_QA_SERVER_URL` and `VITALS_QA_SERVER_SSH` override the file;
  `VITALS_QA_CONFIG=<path>` reads the file from elsewhere (a worktree whose `.gitignore` does not list it yet).
  No host name is written in any tracked file.
- Non-interactive ssh to the server (`ssh -o BatchMode=yes <serverSsh>`). The harness runs only these CLI commands
  there: `persons add L-SYNC-harness --join` (the sync words go on stdin), `agent-token create`, `agent-token revoke`,
  `persons list`, `persons remove`. It refuses to touch any person whose label does not start with `L-SYNC-`.
- The server must be reachable from this machine for MCP (`<serverUrl>/mcp`) and the relay (`/sync`, `/blobs`).

Check afterwards that no test person is left:
`ssh <serverSsh> '~/vitals-server/current/bin/vitals-server.mjs status'` (and `persons list`).

## The replica contract (for L-QA)

`lib/replica.mjs` `openReplica(kind, opts)` returns an object; every scenario uses only this object, so a real app
becomes a replica by implementing it:

| Member | Meaning |
|---|---|
| `kind`, `name` | `'node'`, `'server'`; L-QA adds `'desktop'` (Electron via Playwright), `'phone'` (Android over adb), `'browser'` |
| `write(cmd)` → `{ at }` | `{ op: 'logFood', id, date, text, kcal }` (a typed meal in `dailyLogs`, shape in `lib/docs.mjs` `mealEntry`), `{ op: 'patch', col: 'settings', id: 'me', fields }`, `{ op: 'put', col, id, value }` |
| `read(query)` → `{ [docId]: fields }` | `{ col: 'dailyLogs', date }`, `{ col: 'dailyLogs' }`, `{ col: 'settings', id: 'me' }` |
| `goOffline()`, `goOnline()` | cut / restore this device's network (Node: the proxy; phone: airplane mode or `svc wifi`; desktop: the proxy as relay URL) |
| `kill()`, `restart()` | SIGKILL (no close, no flush) and start again on the same data |
| `status()` | `{ state }` at least (`synced`, `syncing`, `offline`, `killed`) |
| `arrivedAt(col, id)` | optional: epoch ms the replica first saw a remote document (better times than polling) |
| `close()` | stop and clean up |

`read` returns the document bodies as the app stores them (no `_rev`, clocks or device stamps); convergence compares
them field by field (`lib/docs.mjs` `converged`). A replica that can only show a projection (like the server) says so,
and the harness compares the fields the projection shows (see "Known limits").

For a real app the simplest route is a test hook in the app that answers these calls (the web build already exposes
its command bus; Playwright can call it in the page), plus the device's own way to cut the network and kill the
process. The scenarios need no change.

## What each scenario proves

| Scenario | Plan 04 test | Steps and assertions |
|---|---|---|
| S1 online | "the same food logged online appears within 5 s" | A logs a meal; visible on B, C and the server within 5 s; all four converge |
| S2 offline | "food logged on the desktop while offline appears … within 30 s of reconnecting" | A offline for 60 s logs a meal, B logs one meanwhile; the cut is real (nobody sees A's entry, A does not see B's); after the network returns A reconnects by itself, A's entry reaches B, C and the server and B's reaches A within 30 s; converge |
| S3 fields | "two devices editing different fields offline merge" | C sets a baseline; A and B both offline edit different settings fields, one comes online first, then the other (both orders); both edits survive on all four; converge |
| S4 restart | "kill-and-restart of each client mid-sync loses nothing" | A offline writes and is SIGKILLed 0 ms and 100 ms after the write resolved; the writes are there after restart and reach everyone after reconnect; B is SIGKILLed while receiving a 30-entry burst and ends with all 30; the server holds all 30; converge |
| S5 ring, two devices | removed in 0.6.0 (Vitals is manual-only; the ring code is gone) | — |
| S6 MCP | "a meal logged through MCP by an AI appears on all devices" | `log_meal` on the server with the agent token; visible on A, B and C within 5 s; converge |
| final | | all days used by the scenarios converge on all four |

**S5** was removed in 0.6.0 with the ring code. Its last results stay in `qa/results/sync` and `qa/results/C-SYNCX` as
history; the `ring` and `bio*` ops left in `lib/nodeReplicaChild.mjs` are dead.

**killWindow.mjs** (S4 detail, local): one Node replica with its relay cut; for each delay a write, a SIGKILL that many
ms after `put()` resolved, a restart and a read. Writes `qa/results/sync/S4-kill-window.json`.

## Known limits

- The server replica is read through MCP tools, not raw documents (the server has no CLI or route that dumps a
  collection). `log_get` returns the effective log entries with their ids, so meals compare field by field;
  `settings_get` returns the settings in effect with defaults filled in, so the server is compared on the synced
  fields the Node replicas' document holds. Tool answers over 4000 tokens are cut in half (`src/ai/tools/budget.ts`);
  each scenario logs on its own day and the S4 burst spreads over three days to stay under it, and a cut answer is
  reported in the check's detail.
- The MCP endpoint allows 60 calls a minute per agent token and the command bus 20 reads / 5 writes per tool per
  "turn" (per MCP client name here). The server replica paces its calls (one per 1.1 s) and reconnects under a new
  client name before the per-turn count runs out, so server timings have a resolution of about a second.
- The server is never taken offline, killed or restarted by the harness (only the orchestrator deploys it).
- The Node replicas are not the real apps: no browser IndexedDB mirror, no SharedWorker, no OPFS; the S4 kill window
  measured here is the Node platform's. Their sync scheduler is not running.
