# vitals-companion

A small Node (≥ 22.18) program that runs on a machine you own and gives Vitals what a static web app cannot do alone:
a sync relay for your devices, a proxy for AI providers that need a server-held key or sign-in (NVIDIA NIM, OpenCode Zen,
Sign in with ChatGPT), and an MCP server so local agents (Claude, Codex, Hermes, OpenClaw) can use Vitals. Everything
runs on one port, default `127.0.0.1:4870`.

## Install and run

```sh
npx vitals-companion serve            # once published to npm
node packages/companion/bin/vitals-companion.mjs serve   # from this repository
```

No build step: Node runs the TypeScript sources directly (type stripping, Node 22.18+ / 23.6+).

On your PATH: `node packages/companion/bin/vitals-companion.mjs install` writes a wrapper to `~/.local/bin`. Then
`vitals-companion doctor` checks the computer, `vitals-companion agents register <codex|opencode|claude|chatgpt>` adds
the MCP server to an agent's config (with a backup), and `vitals-companion service --role sync|proxy [--write]` prints or
writes a systemd user unit. The full guide, with the server set-up over Tailscale, is `docs/COMPANION.md`;
`deploy/vitals-companion-sync.service` is the server unit.

## Commands

| Command | What it runs |
|---|---|
| `sync` | Sync relay (`/sync`), blob store (`/blobs`), `/health`; optional app with `--serve-app`. No pairing, no proxy. |
| `serve` | Everything on one port: the Vitals build (`--dist`, default `./dist`) with a narrow CSP, the relay, the AI proxy, pairing, the agent hub and `/mcp`. |
| `proxy` | AI proxy, pairing, Sign in with ChatGPT, agent hub and `/mcp` only (no relay, no app). |
| `pair` | Asks the running Companion for a fresh pairing code and prints it. |
| `pair --client <name>` | Mints a named token for an MCP client that connects over HTTP; printed once. |
| `mcp` | MCP over stdio for agents; forwards to the running Companion. |
| `keys set <preset>` · `keys list` · `keys remove <preset>` | Provider keys for `nim` and `opencode-zen`. `set` reads the key from stdin without echo (or from a pipe). `list` shows configured / not configured only. |
| `siwc login` · `siwc status` · `siwc logout` | Sign in with ChatGPT from the terminal (the app can also start it). |
| `--help`, `--version` | |

Flags:

| Flag | Applies to | Meaning |
|---|---|---|
| `--port <n>` | all | Port (default 4870; `0` picks a free one). `pair`/`mcp` use it to find the Companion. |
| `--host <addr>` | all | Bind address (default `127.0.0.1`). Use a tailnet IP only if you know why. |
| `--data <dir>` | sync, serve | Relay data directory (default `~/.vitals`). |
| `--origin <url>` | sync, serve, proxy | Extra browser origin allowed (repeatable). |
| `--serve-app <dist>` | sync | Serve a Vitals build at `/`. |
| `--dist <dir>` | serve | Vitals build to serve (default `./dist`). |
| `--config-dir <dir>` | all but sync | Secrets directory (see below). `pair`, `mcp`, `keys`, `siwc` must use the same one as the server. |
| `--manifest <file>` | serve, proxy, mcp | Tool manifest (`vitals.tools/1`, e.g. `fixtures/tool-manifest.json` or an export from Vitals) used while no tab is connected. |
| `--url <url>` | pair, mcp | The running Companion (default `http://127.0.0.1:<port>`). |

Config directory (0700; secret files 0600, written atomically): Linux `$XDG_CONFIG_HOME/vitals-companion` (or
`~/.config/vitals-companion`), macOS `~/Library/Application Support/vitals-companion`, Windows
`%APPDATA%\vitals-companion`. It holds `admin.token`, `pairings.json` (SHA-256 hashes only), `keys.json`, `siwc.json`
and `install.json` (a per-install id and the ChatGPT client id).

## Routes

| Route | Auth |
|---|---|
| `GET /health` → `{version, roles, ownerCount}` | none (nothing secret) |
| `POST /v1/pair/local` `{code, label?}` → `{token}` | the one-time pairing code; browser `Origin` required |
| `GET /v1/pair/status` → `{ok, version, roles, presets, tab}` | any paired token |
| `POST /v1/pair/code`, `POST /v1/pair/client` `{name}` | admin token |
| `POST /v1/ai/siwc/login` (→ `{started:true}`), `GET /v1/ai/siwc/status` (→ `{signedIn, expiresAt}`), `POST /v1/ai/siwc/logout` | paired token |
| `/v1/ai/<preset>/<path>` and alias `/proxy/<preset>/<path>`: `nim` and `opencode-zen` (`chat/completions`, `models`), `siwc` (`responses`, `models`) | paired token; 60/min per token, burst 20; 8 MB bodies |
| `wss /v1/agent/bridge` | `Origin` + first frame `hello` with the tab's paired token |
| `GET /v1/agent/manifest`, `POST /v1/agent/call` | admin token (used by `vitals-companion mcp`) |
| `POST/GET/DELETE /mcp` (Streamable HTTP) | admin token or a client token, no `Origin` |
| `wss /sync`, `/blobs/<ownerIdHash>/<chunkId>` | their own Evolu / `Bearer K_auth` auth (remote devices reach them over Tailscale) |
| `/` (serve, or sync `--serve-app`) | static files |

## Pairing

1. Start the Companion (`serve` or `proxy`). It prints an 8-digit **pairing code** (single use, valid 10 minutes, locked
   after 5 wrong tries). The code is the only secret it ever prints on its own.
2. In Vitals › Settings › Companion, enter the address and the code. The tab posts it to `POST /v1/pair/local` and gets
   a token bound to its own origin; it sends `Authorization: Bearer <token>` from then on (and `hello` on the bridge).
3. Need another code (expired, locked, second browser)? `vitals-companion pair` prints a new one.

Allowed origins: `https://vitals.creative.desi`, any `http://localhost:*` / `http://127.0.0.1:*` (dev servers), the
Companion's own origin (loopback, the bind address or `*.ts.net`), plus `--origin`. Anything else gets 403 on every route.

Local CLI processes authenticate with `admin.token` (created on first start, 0600) and send no `Origin`. HTTP MCP
clients get their own token: `vitals-companion pair --client claude-code` prints it once (it is a Vitals local token,
not a provider key; only its hash is stored).

## Provider keys (NIM, OpenCode Zen)

```sh
vitals-companion keys set nim            # paste the key, Enter (nothing is echoed)
echo "$KEY" | vitals-companion keys set opencode-zen
vitals-companion keys list
vitals-companion keys remove nim
```

Environment variables `NVIDIA_API_KEY` and `OPENCODE_API_KEY` override `keys.json`. In Vitals, pick the "via Companion"
preset; the page sends no provider key, the Companion adds it, strips the page's own credentials and cookies, streams
the answer back and never returns a key or `Set-Cookie`.

## Sign in with ChatGPT

`vitals-companion siwc login` (or the button in Vitals) opens your browser at OpenAI. After you approve, OpenAI redirects
to a one-off listener on `http://127.0.0.1:<random port>/callback` (5-minute limit), and the Companion stores the tokens
in `siwc.json` (0600). Requests to `/v1/ai/siwc/responses` go to `https://api.openai.com/v1/responses` with
`store:false`, unsupported parameters removed, `system` items moved to `instructions` and function tools grouped in
the `vitals` namespace, as plan usage requires. The access token is refreshed a minute before it expires (one refresh at
a time; the rotated refresh token is saved). `siwc status` shows only whether you are signed in; `siwc logout` revokes
and deletes the tokens. To disconnect Vitals from your ChatGPT account entirely, use ChatGPT › Settings › Security and
login. Plan usage needs ChatGPT Plus or Pro and counts toward your plan's limits.

## MCP for local agents

The tools are the ones Vitals publishes for `mcp` (one manifest, generated from the app's command registry). Agents never
see or call destructive tools (ending a plan, erasing data); consequential changes (shifting a plan) are staged as
proposals you apply in Vitals. Calls run in the open Vitals tab, so keep one open; without it the agent gets "Open
Vitals in a browser tab, then try again".

stdio (all agents). The Companion (`serve` or `proxy`) must be running on the same machine:

```jsonc
// Claude Desktop: claude_desktop_config.json
{ "mcpServers": { "vitals": { "command": "npx", "args": ["-y", "vitals-companion", "mcp"] } } }
```

```sh
# Claude Code
claude mcp add vitals -- npx -y vitals-companion mcp
# Claude Code over HTTP, with a client token
vitals-companion pair --client claude-code            # prints the token once
claude mcp add --transport http vitals http://127.0.0.1:4870/mcp --header "Authorization: Bearer <token>"
# OpenClaw
openclaw mcp add vitals -- npx -y vitals-companion mcp
```

```toml
# Codex: ~/.codex/config.toml
[mcp_servers.vitals]
command = "npx"
args = ["-y", "vitals-companion", "mcp"]
```

```yaml
# Hermes: ~/.hermes/config.yaml
mcp_servers:
  vitals:
    command: npx
    args: ["-y", "vitals-companion", "mcp"]
```

From the repository, replace `npx -y vitals-companion` with `node /path/to/packages/companion/bin/vitals-companion.mjs`.
Add `--manifest <file>` to let an agent list tools even when the Companion is not running (calls then answer with the
"open Vitals" message). In stdio mode only MCP JSON-RPC goes to stdout; diagnostics go to stderr.

## Reaching it from your devices (Tailscale)

1. Enable HTTPS certificates in the tailnet admin console (DNS › HTTPS Certificates).
2. On this machine: `tailscale serve --bg --https=8443 http://127.0.0.1:4870` (8443 leaves port 443 to any web server
   already on the machine; use `--https=443` if there is none).
3. With `serve` (or `sync --serve-app`), open `https://<this-machine>.<tailnet>.ts.net:8443` on each device.
4. In Vitals › Settings › Sync, enter `https://<this-machine>.<tailnet>.ts.net:8443` as the sync address.

The machine name appears in public certificate transparency logs once a certificate is issued. Tabs opened from the
tailnet address pair with their own code like any other browser.

## Security notes

- Binds to loopback by default; only `tailscale serve` (or another local reverse proxy) exposes it.
- Every request is checked for `Host` (loopback, the bind address or `*.ts.net`, against DNS rebinding) and `Origin`
  (allow-list above; others get 403). CORS headers go only to allowed origins; preflights allow
  `Authorization, Content-Type` and Chrome's Private Network Access.
- Tokens: 32 random bytes; stored as SHA-256 hashes; compared in constant time; browser tokens work only from the origin
  they were paired from; admin and client tokens only without an `Origin`.
- Provider keys and ChatGPT tokens stay in the config directory (0600) and are never sent to the page, logged or echoed.
  One redacting logger handles all output (no `Authorization`, cookies, tokens, codes, keys or callback query strings).
  Future work: the OS keychain instead of 0600 files.
- Limits: 8 MB proxy bodies, 4 MB MCP bodies, 60 requests/min per token (burst 20) on the proxy, 5 pairing attempts per code.
- End-to-end encrypted sync: relay rows and blobs are encrypted on the device, so the server stores ciphertext only. Blob
  requests need `Authorization: Bearer <token>`; the server keeps only SHA-256 of the token, set by the owner's first
  upload.
- Quota: 10 GiB per owner by default (relay and blobs each); single blobs are limited to 1 MiB.
- Back up the data directory like any other personal data; it cannot be read without a device's pairing secret.

Status codes on `/blobs`: 201 created, 412 already exists, 428 missing `If-None-Match: *`, 400 bad id, 401 bad or
unknown token, 404 missing, 413 too large, 507 over quota.

The relay protocol code is adapted from `@evolu/nodejs` (MIT).
