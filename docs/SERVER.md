# Vitals Server

The Vitals Server is the `vitals-server` program in `packages/companion`. It runs on one always-on computer (for the
owner: a small ARM server) and serves the website, the installed app and the Lumen Health phone app. It has two roles:

| Role | What it holds | Can it read health data? |
|---|---|---|
| `relay` | the sync relay and encrypted blobs (the old Companion `sync`) | no |
| `home` | the relay, plus one readable copy of each person's data, device pairing, and the MQTT broker for Lumen Health | **yes**, for the people it hosts |

## What the server can read (plain words)

A `home` server keeps each person's sync key on its disk (`persons/<id>/owner.key`). Whoever holds that key can read and
change all of that person's data: logs, plans, ring data, lab values. The server needs it to work while your phone and
browser are off. Anyone with root on the server, or with a copy of its data folder or backups, can read it too. A
`relay` server only ever sees encrypted data.

## Install on the server

The server is deployed from the repository on your own computer; the checkout is not needed on the host. The script
installs the server's own Node 26 under `~/vitals-server/node` (see "Operations": not Node 24.21). better-sqlite3 is a native module and is installed on the host itself (arm64).

```sh
pnpm --filter vitals-companion build     # packages/companion/dist/server: bin/, src/ (no tests), dist/person-worker.mjs, package.json
deploy/oci-arm.sh                        # DEPLOY_TARGET=ssh:<serverSsh from qa/local.config.json> by default (`ssh:vitals-server` without it); DEPLOY_TARGET=local:<dir> is a dry run
```

The build bundles the person program (`dist/person-worker.mjs`, with the app's npm dependencies inside it) and packs a
directory with only the runtime dependencies and npm 12 `allowScripts` for better-sqlite3. The script then, on the host
(it is safe to run twice):

| Step | What happens |
|---|---|
| copy | the packed directory goes to `~/vitals-server/releases/<version>-<sha>`; `npm install --omit=dev --legacy-peer-deps` runs inside it |
| first run only | stops `vitals-companion`, copies its relay data `~/.local/share/vitals-companion` to `~/.local/share/vitals-server/relay` (the old folder stays for rollback), runs `vitals-server init --role home --public-origin https://vitals.example.ts.net:8443 --port 4870` |
| switch | `~/vitals-server/current` points to the new release; the old target becomes `~/vitals-server/previous` |
| unit | writes `~/.config/systemd/user/vitals-server.service`, disables `vitals-companion`, restarts `vitals-server` |
| check | `GET http://127.0.0.1:4870/health` must answer role `home` and this version |

`tailscale serve` is not changed: it already forwards `:8443` to `127.0.0.1:4870`.

On the host, use the server through an alias:

```sh
alias vitals-server="node $HOME/vitals-server/current/bin/vitals-server.mjs"
vitals-server status          # file modes, persons, and /health of the running server
```

`server.json` (`~/.config/vitals-server/server.json`) never holds a secret. Data lives in `~/.local/share/vitals-server`
(0700; every file 0600). `init` options: `--origin <url>` adds an allowed browser origin (the live site is always
allowed), `--public-host <name>` accepts an extra host name (for example a Caddy name), `--port <n>` changes the local
port (default 4870).

The unit the script writes:

```ini
[Unit]
Description=Vitals Server
After=network-online.target

[Service]
ExecStart=node %h/vitals-server/current/bin/vitals-server.mjs serve
UMask=0077
Restart=on-failure

[Install]
WantedBy=default.target
```

If the host has no lingering user session, run `loginctl enable-linger $USER` once.

**Roll back.** `deploy/oci-arm-rollback.sh` goes back to the `previous` release. `ROLLBACK_TO=companion
deploy/oci-arm-rollback.sh` stops `vitals-server` and starts the old relay unit on its untouched data.

The server listens on `127.0.0.1:4870` only. `tailscale serve` gives it the `https://<host>.<tailnet>.ts.net:8443`
address with a publicly trusted certificate, reachable only inside the tailnet. A `home` server refuses to bind to a
public address unless `tls` is set in `server.json`.

## Persons

```sh
vitals-server persons add "Name" --tz Asia/Kolkata          # a new, empty sync group
vitals-server persons add "Name" --tz Asia/Kolkata --join   # joins an existing sync group: paste the sync phrase
vitals-server persons list
vitals-server persons remove <person>
```

The time zone decides "today" for that person on the server; the server's own zone is never used. With `--join` the
phrase is read from the terminal with echo off; it is never taken from the command line or an environment variable.

## Pairing a browser or the installed app

```sh
vitals-server pair code <person> --label "Phone"
```

This prints an 8-digit code, shown as two groups of 4 (10 minutes, one use, 5 wrong tries lock it) and the QR text
`vitals-server:1?u=<server address>&c=<code>&n=<label>`. In Vitals, Settings › Server, scan the QR or type the server
address and the code. A paired device can also make a code for another device. The device keeps a token; the server
keeps only its hash. Remove a device with `vitals-server devices revoke <person> <deviceId>` or from Settings › Server.

The browser asks once for permission to reach devices on your local network, because tailnet addresses count as local.

## Phone setup (Lumen Health)

Create a broker login (at most two per person):

```sh
vitals-server mqtt add <person>
```

or use "Create broker login" on the Devices page. In Lumen Health, Settings › Broadcasting:

| Field | Value |
|---|---|
| Address | `wss://<host>.<tailnet>.ts.net:8443/mqtt` (write the port) |
| User name | `p<person id>-<n>`, as printed |
| Password | as printed; it is shown once |
| Base topic | `lumen-health/v1` (the default) |
| Client id | anything; it is not used to identify you |

The first phone that sends is pinned to the login; another phone is refused until you press "Allow a new phone" (route `POST /v1/mqtt/credentials/{username}/allow-new-phone`).
Messages are written to disk before the phone gets its acknowledgement, so nothing is lost if the server stops. Bad
messages are kept for 30 days under `persons/<id>/deadletter/` and counted on the Devices page.

### A phone that cannot resolve tailnet names: MQTT over TLS (`ssl://`)

Some phones cannot resolve `*.ts.net` names. On the owner's phone, turning Tailscale's DNS setting on blocked all DNS, so it
stays off, and the `wss://…ts.net` address above does not work there. The fix is a public name that points at the
server's tailnet address, with a certificate Caddy already keeps for it. The broker then also listens for plain MQTT over
TLS on that name, so Lumen Health uses `ssl://<name>:8883` and nothing on the phone changes except the login.

1. In `server.json`, under `mqtt`, add the listeners and the certificate files (the server reads them at start):

   ```json
   "tls": { "listen": [ { "host": "100.64.0.1", "port": 8883 }, { "host": "fd7a:115c:a1e0::1", "port": 8883 } ],
            "certFile": "/home/ubuntu/.config/vitals-server/tls/mqtt.crt", "keyFile": "/home/ubuntu/.config/vitals-server/tls/mqtt.key" }
   ```
   The hosts are the server's own tailnet addresses (`tailscale ip`). Nothing else binds them.
2. One time, as root: install `deploy/vitals-cert-sync.sh` as `/usr/local/bin/vitals-cert-sync.sh` and
   `deploy/vitals-cert-sync.{service,timer}` in `/etc/systemd/system/`, then `systemctl enable --now vitals-cert-sync.timer`
   and run `systemctl start vitals-cert-sync.service` once. It copies Caddy's certificate for the name into the server's
   `tls/` folder and restarts the server only when the certificate was renewed.
3. In Lumen Health: Broker URI `ssl://<name>:8883`, the login as above.

The listener accepts TLS 1.2 or newer. Logins, installation pinning, acknowledgement after the write and the limits are
the same as on the WebSocket address. A client that does not trust the certificate, or sends plain text, is dropped.

Import your Lumen Health history first, then switch on broadcasting. Records sent both ways are stored once.

1. In Lumen Health: Settings › Privacy & Data › Data Backup › Export All Data; share the file
   `lumen-health-export-<date>.json` to the computer.
2. In Vitals: Settings › Devices, card "Lumen Health over MQTT", **Import your Lumen Health history…**, pick that file.
   The message reads "<from> to <to> · N records · N samples · N duplicates skipped".
3. In the stream list under the card, switch on what each stream may be used for (nothing drives scores, the plan or
   the Coach until it is on).
4. Then paste the broker login into Lumen Health's broadcast settings (table above). The card shows "connected", the
   last event, events per stream today and the ring's battery.

## Providers

Three services run through the server because a browser cannot call them directly: Sign in with ChatGPT (`siwc`),
NVIDIA NIM (`nim`) and OpenCode Zen (`opencode-zen`). Other providers stay browser-direct, with the person's key kept
in the browser.

The routes are mounted on the home role (`packages/companion/src/home/aiMount.ts`). The person is resolved from the `Authorization: Bearer <device token>` header only, by the same function that serves every other route (`home.resolvePerson`). A person id in the path, query or
body is ignored, and a token in the query is refused with 401. Each request then uses only that person's files:

| File (under `persons/<id>/`) | Holds | Mode |
|---|---|---|
| `credentials/providers.json` | `{ "nim": "<key>", "opencode-zen": "<key>" }` | 0600, in a 0700 directory |
| `credentials/siwc.json` | ChatGPT access and refresh token, expiry, client id | 0600 |
| `credentials/install.json` | `installId` of this server for this person, and `siwcClientId` | 0600 |
| `usage.jsonl` | one line per AI request: `{ at, preset, model, inputTokens, outputTokens, status }`, no prompt text; rotated to `usage.1.jsonl` above 4 MB | 0600 |

Host environment variables (`NVIDIA_API_KEY`, `OPENCODE_API_KEY`) are not used on the server. They would serve every
person.

| Method + path (device token) | Answer |
|---|---|
| `GET /v1/ai/status` | `{ presets: [{ id, label, ready }] }` |
| `PUT /v1/ai/keys/{nim\|opencode-zen}` `{ key }` | 204; the key is never returned |
| `DELETE /v1/ai/keys/{preset}` | 204 |
| `GET /v1/ai/siwc/status` | `{ signedIn, expiresAt? }` |
| `POST /v1/ai/siwc/logout` | 204: revokes and removes this person's ChatGPT tokens |
| `GET /v1/ai/{preset}/models` | upstream list (the ChatGPT list is translated to `{ data: [{ id }] }`) |
| `GET /v1/ai/{preset}/probe` | `{ ready: true, models }` or `{ ready: false, error: { code, message } }` |
| `POST /v1/ai/{preset}/chat/completions` (`nim`, `opencode-zen`) or `/responses` (`siwc`) | upstream answer; SSE passed chunk by chunk (`X-Accel-Buffering: no`); a client abort cancels the upstream request |
| `GET /v1/ai/usage` | `{ today: { requests, inputTokens, outputTokens }, cap? }`, counted in the person's own time zone |

The ChatGPT rewrites are applied unchanged: `store: false`, unsupported parameters dropped, tools namespaced, and a
non-streaming request collapsed from the stream.

**Limits.** 30 AI requests per minute per person by default (`server.json` `limits.aiRequestsPerMinute`). An optional
daily cap per person is set with `requestsPerDay`. The per-device and per-IP limits are the server core's.

**Errors.** The body is `{ error: { code, message, detail? } }`, and `message` is shown to the person as written.

| HTTP | code | When |
|---|---|---|
| 401 | `unauthorized` / `revoked` | no token, unknown token, revoked token |
| 403 | `wrong_kind` | an agent token on a provider route |
| 409 | `not_signed_in` | `siwc` without a sign-in on the server for this person (also `POST /v1/ai/siwc/login`: the browser has no sign-in route) |
| 409 | `no_key` | `nim` or `opencode-zen` without a key |
| 429 | `usage_limit` | ChatGPT `subscription_sharing_usage_limit_exceeded` |
| 429 | `rate_limited` | the per-person limit, or another upstream 429 (`Retry-After` passed on) |
| 429 | `daily_cap` | the per-person daily cap (added by E26) |
| 502 | `upstream_error` | any other upstream error status, an unreachable upstream, or a failed ChatGPT refresh; `detail.status` and `detail.upstreamCode` only, never the upstream body |
| 504 | `upstream_timeout` | no response headers within 120 s, or an upstream 504/408 |
| 400 / 404 / 413 | `bad_request` / `not_found` / `too_large` | bad body, unknown preset or path, body over 8 MB |

**Admin CLI** (on the server; `--data-dir` defaults to `$XDG_DATA_HOME/vitals-server`):

```sh
vitals-server keys set <person> nim          # key from stdin, hidden
vitals-server keys import <person> keys.json # a Companion keys.json; or from stdin
vitals-server keys list <person>
vitals-server keys remove <person> nim
```

These subcommands are routed only when the first argument after the subcommand is a person id. They use the server's
data folder from `server.json` unless `--data-dir` is given. (Before Q8 they were only in `vitals-companion`; a
`vitals-server` older than this fix prints its help instead.)

## Sign in with ChatGPT

OpenAI offers no device-code flow, and a `127.0.0.1` sign-in callback reaches the computer running the browser, not
the server. Sign-in is therefore an admin step, done once per person. Two ways:

**1. Move an existing sign-in (default).** Refresh tokens rotate, so exactly one machine may hold them. The export
deletes the local copy without revoking it, and the import deletes the export file. From then on only the server
refreshes. The server keeps its own install id per person and takes only the issued client id (OpenAI, "Self-hosted
VMs").

```sh
# on the computer where the person signed in
systemctl --user stop vitals-companion     # a running Companion could refresh during the move
vitals-companion siwc export --out ~/vitals-chatgpt-signin.json
scp ~/vitals-chatgpt-signin.json vitals-server:   # `vitals-server` is your ssh alias for the server
# on the server
vitals-server siwc import <person> ~/vitals-chatgpt-signin.json
vitals-server siwc status <person>
```

`siwc export`:
- refuses if a Companion answers on `127.0.0.1:4870` (pass `--force` to override);
- refuses if the target file already exists;
- writes the file 0600 with exclusive create, reads it back, and only then deletes `siwc.json`.

`siwc import`:
- refuses a person who is already signed in unless `--force`;
- writes `credentials/siwc.json` 0600 and copies `siwcClientId` into `credentials/install.json`, keeping its
  `installId`;
- deletes the export file.

**2. Sign in on the server through an SSH tunnel (fallback).**

```sh
vitals-server siwc login <person> --callback-port 1455 --ssh-host vitals-server
# prints:  ssh -N -L 1455:127.0.0.1:1455 vitals-server    → run this on the computer with the browser
#          https://auth.openai.com/api/accounts/authorize?…  → open it there and sign in
```

The listener binds `127.0.0.1:<port>` on the server only. The tunnel carries the callback to it. This path gives the
server its own host id from the first sign-in, but it needs a person at a browser (OpenAI's bot check blocks scripted
browsers).

`siwc status <person>` and `siwc logout <person>` work per person. The website can only read the status and sign out
(`/v1/ai/siwc/status`, `/v1/ai/siwc/logout`).

## Agents

Agents (Codex, OpenCode, Claude Code, any MCP client) connect to `<publicOrigin>/mcp` with an **agent token**. Tools
run on the server against the person's store, through the same guard the browser uses (`guardedCall` with
`createBusAgentDispatcher({ directApply: () => false })`), inside the person's worker (worker operations `agentManifest` and `agentCall`). No browser tab is needed.

| Scope | Tools listed | Writes |
|---|---|---|
| `read` | read tools | none |
| `log` (default) | read and log tools | log entries applied directly, with undo |
| `edit` | read, log and edit tools | edits staged as proposals (`coach.pending`); the person applies them in the app. On the server an agent never applies an edit directly |

These rules hold for every scope:
- Destructive tools are never listed and never run.
- Commands that need a browser-only port (`planner.find`, `nav.open`, `markers.import`, `log.mealFromPhoto`, and the
  re-plans `plan.replan`, `plan.declareEvent`, `plan.shift`, `plan.editDay`) are left out. Any command whose answer names `not_on_server` (`detail.reason` or `detail.rule`) is removed at run time and open sessions get
  `tools/list_changed`.
- Limits: 60 tool calls per minute per token, 4 open sessions per token, 32 per server.

| Method + path | Token | Answer |
|---|---|---|
| `POST /v1/agents/tokens` `{ client, scope, label? }` | device | `{ token, id, mcpUrl, recipes }`; the token is shown once |
| `GET /v1/agents/tokens` | device | `{ tokens: [{ id, client, label, scope, createdAt, lastUsedAt }] }` |
| `DELETE /v1/agents/tokens/{id}` | device | 204; open sessions of that token close; its next request gets 401 `revoked` |
| `GET /v1/agents/activity` | device | last 50 calls `{ at, tokenId, tool, outcome }`, without arguments |
| `GET\|POST\|DELETE /mcp` | agent | MCP Streamable HTTP |

Agent tokens are kept in the same `persons/<id>/devices.json` as device tokens (kind `agent`, with a `client` field; the id is a UUID). The old Companion agent bridge (`/v1/agent/*`) is not part of the server routes.

**Admin CLI:**

```sh
vitals-server agent-token create <person> --client codex --scope log --url https://vitals.<tailnet>.ts.net:8443
vitals-server agent-token list <person>
vitals-server agent-token revoke <person> <id>
```

**Connecting an agent.** Keep the token in `VITALS_TOKEN`. On the agent's computer,
`vitals-companion agents register <codex|opencode|claude> --remote https://vitals.<tailnet>.ts.net:8443` writes the
entry below and keeps a backup of the file it edits.

| Client | What gets written | Checked 2026-10-03 against a server on a loopback port with a real store |
|---|---|---|
| Codex 0.159 (`codex exec`) | `~/.codex/config.toml`: `[mcp_servers.vitals]` `url = "<url>"`, `bearer_token_env_var = "VITALS_TOKEN"`, `default_tools_approval_mode = "approve"` | yes: `today_get` ran on the server |
| OpenCode 2.0 (`opencode run`) | `~/.config/opencode/opencode.json` → `mcp.vitals = { type: "remote", url, headers: { Authorization: "Bearer {env:VITALS_TOKEN}" }, enabled: true }` | yes: `today_get` ran on the server. OpenCode prints the resolved request headers, token included, in its own output |
| Claude Code 2.1 (`claude -p`) | runs `claude mcp add --transport http -s user vitals <url> --header "Authorization: Bearer $VITALS_TOKEN"` (Claude Code then keeps the token in `~/.claude.json`, 0600) | yes: `today_get` ran on the server |
| ChatGPT desktop app | nothing: "Not available yet". Connecting it to your own server was not confirmed to work | no |

An agent config that already has a local `vitals` entry (the Companion over stdio) must be replaced. Codex refuses to
merge `url` into a stdio entry ("url is not supported for stdio"), and OpenCode silently keeps the local entry.
`agents register --remote` replaces the whole entry.

Re-run the live check (it uses each agent's own account for one short prompt):
`E26_LIVE=1 pnpm vitest run src/agents/__tests__/serverAgents.live.e26.test.ts`. Results go to
`qa/results/E26-agents-live.json`.

## Backup and restore

```sh
vitals-server backup <person>                     # copies the person's folder to persons/<id>/backup/<time>/
systemctl --user stop vitals-server
vitals-server restore <person> <backup folder>
systemctl --user start vitals-server
```

A backup contains the sync key and is as sensitive as the data itself. Back up while the person is idle (the server
closes a person after 15 minutes without requests), or stop the server first.

## Migration steps (the owner moves to person 1 on the server)

Run once, with the owner present. The relay data on the server is `~/.local/share/vitals-companion` (not `~/.vitals`).

0. Owner, first: the server's swap was 99 % used with 5.9 GB RAM free (R18 §6). Check what holds swap
   (`free -h; swapon --show`) before adding the `home` role; each open person worker needs about 100 MiB.
1. Back up the relay as it is today: `tar -C ~/.local/share/vitals-companion -czf ~/vitals-relay-backup-$(date +%F).tgz .`
2. `deploy/oci-arm.sh`. On the first run it stops `vitals-companion`, copies the relay data to
   `~/.local/share/vitals-server/relay`, runs `vitals-server init --role home --public-origin https://vitals.example.ts.net:8443 --port 4870`
   (port 8443 stays behind `tailscale serve`) and starts `vitals-server`.
3. `vitals-server persons add "<owner label>" --tz Asia/Kolkata --join`, pasting the owner's sync key (sync phrase) from
   Settings › Sync on this PC. The replica pulls the owner's history through the relay; record the document count and how
   long it took.
4. Delete the 9 QA owners from the relay (default yes; skipped if the owner says no).
5. Pair the website on this PC and the phone PWA: `vitals-server pair code <person> --label "This PC"`, then again
   with `--label "Phone"`. For the phone app, create a broker login with `vitals-server mqtt add <person>` and follow
   "Phone setup".
6. Move the owner's provider keys and the ChatGPT sign-in (owner present; it rotates the live session):
   `vitals-server keys set <person> nim` (and `opencode-zen`), or `vitals-server keys import <person> keys.json`;
   on this PC `vitals-companion siwc export --out ~/vitals-chatgpt-signin.json`, copy it to the server, then
   `vitals-server siwc import <person> ~/vitals-chatgpt-signin.json`. For agents:
   `vitals-server agent-token create <person> --client codex --scope log --url https://vitals.example.ts.net:8443`.

The numbering follows docs/SUITE_SPEC.md §14.1. Not measured before: joining the owner's existing history over the relay
at real size.

## Limits

| What | Limit |
|---|---|
| Pairing codes | 8 digits, 10 minutes, one use, 5 wrong tries lock all open codes |
| Requests | per device and per source address; over the limit the answer is "too many requests" |
| MQTT message | 256 KB (a night of sleep is about 6–9 KB) |
| MQTT rate | about 100 messages a second per connection; above that acknowledgements slow down, nothing is dropped |
| MQTT connections | 2 per login; keep-alive up to 900 s |
| Broker logins | 2 per person |
| Open persons | 4 at once (`server.json` `maxOpenPersons`); each is one worker, closed after 15 minutes idle |
| Person worker memory | 512 MB old space and 64 MB young space of JavaScript heap per worker |
| Request time | 60 s for a command or an agent tool call, 10 minutes for an import (a Lumen batch, a file import), counted from when the person's worker starts it |
| Server process (systemd unit) | `MemoryHigh=1536M` (slowed down above), `MemoryMax=2048M` (the server is killed and restarted above), `MemorySwapMax=256M`, `OOMPolicy=kill` |

Measured on this PC (2026-10-03, one person, the bundled worker): a worker's JavaScript heap stays at 35–75 MB through
pairing, two agent tokens, two MCP sessions, tool calls, the ring fixture import and 2,000 MQTT messages; the whole server
process (relay, broker, one worker) settles at 400–450 MB resident. A person adds about 130–150 MB of resident memory when
it opens. The heap limit is the ceiling for one person; the unit's `MemoryMax` is the ceiling for all of them together.

**What a person sees when a limit is hit.**

| Case | What happens | What the person or agent sees |
|---|---|---|
| 4 persons open, one more asks | The person idle the longest is closed (its work is saved first) and the new one opens | Nothing; the first request takes the usual open time (under a second) longer |
| 4 persons open and all are working | The request is refused; nothing is stored | HTTP 503 `server_busy`: "The server is busy with other people right now. Try again in a minute." Ring messages already on the server are tried again every 5 s for up to 2 minutes, then set aside (Settings › Data shows them under "Set aside") |
| A person's worker runs out of memory | Only that worker stops; the server and the other persons carry on; the server log says so | That request: `precondition_failed`, reason `person_restarting`: "Your data on the server is restarting. Try again in a moment." The next request opens the person again |
| A request runs past its time | The worker is stopped and opens again on the next request; requests waiting behind it get `person_restarting` | `precondition_failed`, reason `timeout`: "This took longer than 1 min and was stopped. Try again." |
| The whole server goes over 2 GB | systemd kills the server and starts it again 5 s later | A few seconds of "not reachable"; the app keeps working on the device and syncs afterwards |

Every write a person had confirmed is in their replica on disk before the answer, so a stopped worker loses no confirmed
data. Ring messages are acknowledged only after they are on disk and are imported again after a restart.

## Operations

**Memory, once a minute.** For every open person the server logs one line, with no personal data:

```
person 0000000000000000: memory heap 52/102 MB, external 3 MB; server rss 412 MB
```

`heap` is that person's worker (used / reserved JavaScript heap; a thread has no resident size of its own), `server rss`
is the whole process. The same sample goes to `~/.local/share/vitals-server/memory.json` (0600), and
`vitals-server status` prints it:

```
Running: {"version":"0.4.0","role":"home",…,"persons":5,"mqtt":"on","memoryMb":412}
Memory (31 s ago): server rss 412 MB, main heap 53 MB, 2 of at most 4 persons open
  0000000000000000  heap 52/102 MB, external 3 MB, idle 40 s
```

`GET /health` carries `memoryMb` (the server process's resident memory in MB) for monitoring from outside.

**Other log lines to look for.**

| Line | Meaning |
|---|---|
| `person <id>: opened in <n> ms` | A worker opened. Normal is 300–700 ms; several seconds means the host is short of memory or CPU |
| `person <id>: closed to make room (at most 4 persons open)` | The cap was reached and the person idle the longest was closed |
| `person <id>: worker ran out of memory (heap limit 512 MB); closed, it opens again on the next request` | One person's worker hit its heap limit |
| `person <id>: worker stopped: a <command> request ran past 1 min; closed, …` | A request ran past its time |

**Changing the cap.** Set `"maxOpenPersons": <n>` in `~/.config/vitals-server/server.json` and restart
(`systemctl --user restart vitals-server`). Keep `n × 600 MB` under the unit's `MemoryMax` if every person may be busy at
once; raise `MemoryMax` in the unit (deploy/oci-arm.sh writes it) when the host has room.

**Memory limits of the unit.** deploy/oci-arm.sh writes them into `~/.config/systemd/user/vitals-server.service`. Check
with `systemctl --user show vitals-server -p MemoryHigh -p MemoryMax -p MemorySwapMax -p OOMPolicy` and the current use
with `systemctl --user status vitals-server` (the `Memory:` line).

**The server's Node.** The server and its CLI run on a Node kept next to the releases, not on the system's:
`~/vitals-server/node` points at `~/vitals-server/node-v26.10.0`. deploy/oci-arm.sh downloads it from nodejs.org once,
checks it against `SHASUMS256.txt`, and builds the native module (better-sqlite3) for it. The unit's `ExecStart` uses it,
and `bin/vitals-server.mjs` switches to it when another node starts it, so `node ~/vitals-server/current/bin/vitals-server.mjs …`
and `~/vitals-server/bin/vitals-server …` behave the same. Check with `~/vitals-server/node/bin/node -v` and
`systemctl --user show vitals-server -p ExecStart`. A different version: `NODE_VERSION=<x.y.z> deploy/oci-arm.sh`.

Do not run the server on Node 24.21 (Ubuntu's `/usr/bin/node` on the server). With three persons open, every person
worker stopped answering and the process grew by about 45 MB a second until the unit's memory limit stopped it (the
2026-10-03 incidents). The cause is Node 24's Web Locks, which every thread of the process shares. The server no longer
uses them (each person's store has its own locks), and Node 26 does not show the problem either.

**Rolling back to the previous release.** That release's native module may have been built for another Node. Rebuild it
for the pinned Node before you switch:
`cd ~/vitals-server/previous && PATH=~/vitals-server/node/bin:$PATH npm rebuild better-sqlite3`, then
`ln -sfn "$(readlink ~/vitals-server/previous)" ~/vitals-server/current && systemctl --user restart vitals-server`.

**Diagnostics when memory or CPU climbs.** Start the server with `VITALS_DIAG_PORT=<port>` (for example
`systemctl --user edit vitals-server` → `[Service]` `Environment=VITALS_DIAG_PORT=4872`, then restart). It then answers on
`127.0.0.1:<port>` only, with sizes, counts and timings and no personal data:

| Request (on the host) | Answer |
|---|---|
| `curl -s http://127.0.0.1:4872/diag` | The main thread's memory (`rss`, heap, `external`, `arrayBuffers`, open handles). For each open person: requests sent and not answered (`pending`), how busy its thread was since the last read (`elu`, 0–1, read even when the thread is stuck), and its own report: heap and heap spaces, malloc, requests waiting in its queue, the request it is running and for how long, the longest event-loop delay. `report: null` means the worker did not answer within 2 s |
| `curl -s -X POST 'http://127.0.0.1:4872/profile?person=<id>&ms=8000'` | A CPU profile of that person's thread (open it in Chrome DevTools › Performance) |
| `curl -s -X POST 'http://127.0.0.1:4872/snapshot?person=<id>'` (or `person=main`) | A heap snapshot (DevTools › Memory) |

The files go to `~/.local/share/vitals-server/snapshots/` (0600). A snapshot can hold personal data in memory. Delete it
when you are done, and do not share it. Without `VITALS_DIAG_PORT` nothing listens.

How to read it: a person with `elu` near 1 and no report, while nobody uses it, has a stuck thread. When `rss` grows and
the heaps do not, the memory is outside JavaScript (native queues, SQLite, buffers).

