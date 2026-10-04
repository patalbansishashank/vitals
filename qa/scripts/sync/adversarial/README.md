# C-SYNCX adversarial sync probes

These scripts use the installed candidate server and the app's real Evolu adapter. A, B and C are Node replicas,
each with its own SQLite database and network proxy. S is a server person read through MCP. All data is synthetic.
This does not exercise Electron, browser storage, Android background scheduling, or physical ring transport.

Install with `pnpm install --frozen-lockfile`. Configure the ignored `qa/local.config.json` as described in the parent
README. Run from the repository root:

```sh
node qa/scripts/sync/adversarial/run.mjs conflicts
node qa/scripts/sync/adversarial/run.mjs ring killUpload mcp
node qa/scripts/sync/adversarial/run.mjs longOffline
node qa/scripts/sync/adversarial/run.mjs lateHistory
node qa/scripts/sync/adversarial/restart.mjs
```

Each main scenario creates a distinct `C-SYNCX-` person, keeps its sync phrase and token in memory, verifies removal,
and removes local replica files. Evidence goes to `qa/results/C-SYNCX`. Private scratch data goes to `.e6-tmp`.
Interruptions clean up too. If a process is killed without its signal handler, inspect the private
`.e6-tmp/sync-harness/persons.txt` ledger and remove only persons with the `C-SYNCX-` prefix.

| Scenario | Workload and assertions |
| --- | --- |
| `conflicts` | Three offline same-field edits with clocks at −10 min, normal, and +10 min; causal follow-up edits; delete/edit races; actual quarantine counts and visible sync status. |
| `ring` | Two offline readers of the same synthetic J-Style 2301 source, both reconnect orders, complete-to-complete reclassification, all sample values and one resolved night; correction versus newer device value. |
| `killUpload` | Proxy forwards part of a blob PUT, pauses it, then the writer is killed. Missing bytes must yield a partial read; restart must retry upload and recover every sample. |
| `mcp` | MCP and an offline device append concurrent replacements of one meal; raw documents and effective views converge. The device write uses `log.edit`'s persistence contract. |
| `longOffline` | A real 30-minute network outage with 160 records and 800 writes, plus 20 online writes. All final values must reach all replicas within 30 s; a fresh replica then joins. |
| `lateHistory` | A fresh replica joins a larger synthetic history; exact record IDs, values, counts, and timing are checked. |
| `restart` | An isolated second instance of the installed server with its own configuration and state is restarted. The production unit and its persons are never stopped. |

`SYNC_LONG_OFFLINE_S` may shorten a smoke run; only the default 1800-second run proves the requested outage.
The long-offline reconnect explicitly invokes the adapter's reconnect method, as the app's online-event handler does.
Ring uploads explicitly flush the chunk outbox, as the application's scheduler does.

The server MCP view is a projection. Log checks use small per-day pages and reject truncated replies; they never fill
missing server records from a client. Ring daily checks prove the resolved night, not deletion of older stored versions.
MCP polling is paced to respect the service's token limit, so server visibility measurements are upper bounds.

The append-only log contract deliberately retains concurrent successors until the person chooses a version
(`docs/SUITE_SPEC.md`, §2.5). Two retained successors are a conflict, rather than a duplicated transport write. The
findings report separately records whether the production UI exposes and resolves that conflict.
