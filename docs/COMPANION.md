# Vitals Companion: user guide

> **History.** The Companion as a user install is replaced by the Vitals Server (`vitals-server`, see
> [SERVER.md](SERVER.md)) from v0.4.0. This file describes v0.2 to v0.3 and is kept for history. `vitals-companion`
> stays as an alias for one release.

The Vitals Companion is a small program that runs next to Vitals. It does three jobs that a web page cannot do on its
own:

| Job | Where it runs | Command |
|---|---|---|
| Sync relay: devices exchange encrypted changes through it | a server you control (here: `oci-arm`), reached over Tailscale | `vitals-companion sync` |
| Agents: Codex, OpenCode, Claude Code and the ChatGPT desktop app use Vitals tools (read your day, log, propose plan changes) | this computer, next to an open Vitals tab | `vitals-companion proxy` (or `serve`) |
| Coach providers: Sign in with ChatGPT, OpenCode Zen and NVIDIA keys stay in the Companion, never in the page | this computer | `vitals-companion proxy` |

Agents never get destructive tools (ending or replacing a plan, erasing data). Changes that matter, such as a plan edit or a
body-profile change, come back as proposals you apply in Vitals.

Version: 0.2.0. Needs Node.js 22.18 or newer.

## 1. Install on this computer

```fish
# from the repo (any checkout); writes ~/.local/bin/vitals-companion, a 5-line wrapper
node packages/companion/bin/vitals-companion.mjs install
vitals-companion --version
vitals-companion doctor
```

- The wrapper pins the Node binary and the checkout it runs from. `VITALS_COMPANION_ROOT=<dir>` runs another checkout once.
- `install` refuses to overwrite a file it did not write (use `--force`; a dated backup is kept). `--dry-run` prints only.
- Uninstall: `rm ~/.local/bin/vitals-companion`.
- Config (pairings, tokens, keys; folder 700, files 600): `~/.config/vitals-companion/`. Data (relay store, blobs):
  `~/.local/share/vitals-companion/` (an existing `~/.vitals` is still used).

### `vitals-companion doctor`

Checks this computer and prints the exact command for each gap. `--json` prints the report as JSON; `--server <url>`
also checks a sync server. Exit code 1 only when a required check fails (Node, config permissions, port, a server you
named). Keys and tokens are reported as present or absent, never shown.

| Check | What it looks at |
|---|---|
| `node` | Node 22.18+ |
| `bin` | `vitals-companion` on PATH and which checkout it runs |
| `configDir` | folder exists, 700; secret files 600 |
| `port` | 127.0.0.1:4870 is free, or the Companion answers there |
| `service` | a systemd user unit `vitals-companion` (optional on a desktop) |
| `tailscale`, `serve` | connected, HTTPS certificates on, and whether `tailscale serve` points at the Companion |
| `relay` | `--server <url>`: `/health` answers within 3 s with the relay role |
| `siwc`, `zen` | signed in with ChatGPT; OpenCode Zen key (environment, Companion, or only in OpenCode's own store) |
| `agent:codex`, `agent:opencode`, `agent:claude`, `agent:chatgpt-desktop` | installed, version, Vitals MCP registered |
| `webmcp` | Chromium version, and the flag agents in the browser need |

## 2. Run the sync server with Tailscale

The relay stores only encrypted changes. Run it on an always-on machine in your tailnet.

```fish
# on this PC: copy the package to the server and install its dependencies there (better-sqlite3 builds for that CPU)
# `vitals-server` is your ssh alias for the server
# --exclude keeps --delete from removing the server's node_modules and package-lock.json (the repo package has no lockfile)
rsync -a --delete --exclude node_modules --exclude package-lock.json --exclude spike packages/companion/ vitals-server:vitals-companion/
ssh vitals-server 'cd ~/vitals-companion && npm install --omit=dev --no-audit --no-fund --legacy-peer-deps --foreground-scripts'
# check the native module loads (if it does not: npm rebuild better-sqlite3 --foreground-scripts, then check again)
ssh vitals-server 'cd ~/vitals-companion && node -e "require(\"better-sqlite3\"); console.log(\"better-sqlite3 ok\")"'
# the unit (also printed for any path by: vitals-companion service --role sync)
ssh vitals-server 'mkdir -p ~/.local/share/vitals-companion ~/.config/systemd/user && cp ~/vitals-companion/deploy/vitals-companion-sync.service ~/.config/systemd/user/vitals-companion.service'
ssh vitals-server 'systemctl --user daemon-reload && systemctl --user enable --now vitals-companion && curl -s http://127.0.0.1:4870/health'
# HTTPS on the tailnet only; port 8443 because Caddy already serves :443 on that machine
ssh vitals-server 'tailscale serve --bg --https=8443 http://127.0.0.1:4870'
vitals-companion doctor --server https://vitals.example.ts.net:8443
```

- `--legacy-peer-deps`: `@evolu/nodejs` declares optional lint-tool peers whose versions clash; none is used at runtime.
- better-sqlite3 builds with an install script (`node-gyp rebuild`). Newer npm may warn that it is "not yet covered by
  allowScripts" and, on a clean `~/vitals-companion` without a built module, skip the build; the relay then fails at
  start. `--foreground-scripts` runs and shows the build; if the check line above still fails, run
  `npm rebuild better-sqlite3 --foreground-scripts` (it needs `python3`, `make` and a C++ compiler on the server). An
  existing `node_modules` with the built module keeps working, which is why a redeploy over it does not show the problem.
- `package-lock.json` stays on the server between deploys so the `^` ranges (`@modelcontextprotocol/sdk`, `ws`) do not
  move silently; delete it there on purpose to take newer versions.
- The unit is a **user** unit (no root; the server's other services are user units and lingering is on, so it starts at
  boot). It binds 127.0.0.1 only; nothing is opened in the firewall.
- Hardening: `NoNewPrivileges` and `UMask=0077` apply. On Ubuntu 24.04 the user manager cannot create the mount namespace
  that `ProtectSystem=strict`, `PrivateTmp` and `ReadWritePaths` need (AppArmor blocks unprivileged user namespaces), so
  systemd skips those three with a log line. Install it as a system unit with `User=` to get them.
- If nothing else serves port 443 on the server, `--https=443` gives the shorter address `https://<server>.<tailnet>.ts.net`.

**In Vitals:** Settings › Sync › Set up sync on this device, server address `https://vitals.example.ts.net:8443`.
On each other device: Join with a pairing code (scan, paste, or the 24 words plus the address). Chrome may ask once
whether Vitals may reach devices on your local network (Tailscale addresses count as local); allow it.

Undo on the server: `tailscale serve --https=8443 off; systemctl --user disable --now vitals-companion; rm ~/.config/systemd/user/vitals-companion.service; systemctl --user daemon-reload; rm -rf ~/vitals-companion ~/.local/share/vitals-companion`.

## 3. Agents on this computer

1. Start the Companion and keep it running: `vitals-companion proxy`. It prints an 8-digit pairing code
   (`vitals-companion pair` prints a new one).
2. In Vitals: Settings › Agents › Look for the Companion, enter the code, then turn on **agents on this computer**.
   Agents can use Vitals only while that tab is open.
3. Register the agents you use (each writes only the Vitals entry and keeps a dated backup of the file it edits):

```fish
vitals-companion agents register codex      # ~/.codex/config.toml [mcp_servers.vitals]
vitals-companion agents register chatgpt    # the same file: the ChatGPT desktop app reads Codex's config; restart the app
vitals-companion agents register opencode   # ~/.config/opencode/opencode.json mcp.vitals
vitals-companion agents register claude     # runs: claude mcp add -s user vitals -- <wrapper> mcp
vitals-companion agents status
# undo any of them: vitals-companion agents unregister <name>
```

Every agent starts `vitals-companion mcp` (stdio), which forwards to the running Companion with the admin token from the
config folder, so no secret is written into any agent's config. The Codex entry sets `default_tools_approval_mode =
"approve"` so `codex exec` can call Vitals tools without a prompt; that is safe because destructive tools are never
listed and consequential ones are staged.

Settings › Agents shows what the Companion detects: this tab connected (and how many tools), Tailscale, which agent apps
are installed and set up, which agents used Vitals recently, and the Coach providers.

### Agents in the browser (WebMCP)

Chromium 153 has WebMCP behind a flag. Turn on chrome://flags/#enable-webmcp-testing ("WebMCP for testing") and relaunch,
or add `--enable-features=WebMCP` to `~/.config/chromium-flags.conf`. Then Settings › Agents › **agents in this browser**
(off by default, this device only). Without the flag the switch is disabled and says the browser cannot share tools yet.

## 4. Coach providers through the Companion

In the browser, first: keep `vitals-companion proxy` running, open Vitals › Settings › Agents › **Look for the Companion**,
allow the browser's "connect to devices on your local network" prompt (Chrome asks once per site; if you declined, the icon
left of the address bar › Site settings › Local network), enter the pairing code, and the status reads *paired*. Then in
Settings › AI provider pick a "(via Companion)" provider: **Load the model list** fills the picker from the provider
(OpenCode Zen lists its catalogue even before a key is set), and **Test connection** says exactly what is missing (for
example "No OpenCode Zen key on the Companion. Run: vitals-companion keys set opencode-zen"). The OpenCode Zen free tier
answers only OpenCode itself, so the Coach needs a paid Zen key.

| Provider | Set up | Notes |
|---|---|---|
| Sign in with ChatGPT | `vitals-companion siwc login` (with `proxy` running on the same config folder), then `siwc status`. The ChatGPT-plan backend needs streaming requests, a description on the tool namespace and lists models as `{models:[{slug}]}`; the proxy handles all three (2026-10-03) | Opens your browser at OpenAI's consent page; tokens stay in `~/.config/vitals-companion/siwc.json` (600). A 429 `subscription_sharing_usage_limit_exceeded` now reaches the Coach as "Your ChatGPT plan has reached its usage limit for now … Settings › Usage". |
| OpenCode Zen | `vitals-companion keys import opencode-zen` (copies the key from OpenCode's own store, never shown) or `vitals-companion keys set opencode-zen` | Then pick the Companion preset `opencode-zen` in Settings › AI provider. |
| NVIDIA | `vitals-companion keys set nim` | |

## 5. A user unit on this computer (installed 2026-10-03)

`vitals-companion service --role proxy --write` writes `~/.config/systemd/user/vitals-companion.service` (backup if one
exists), creates the data and config folders the unit's `ReadWritePaths=` names, and prints
`systemctl --user daemon-reload && systemctl --user enable --now vitals-companion`. Installed on this PC on 2026-10-03,
so the Companion runs in the background from login and no terminal needs to stay open; `systemctl --user status
vitals-companion` shows it, `journalctl --user -u vitals-companion -f` follows its log (the pairing code is printed
there at start; `vitals-companion pair` prints a fresh one). Undo: `systemctl --user disable --now vitals-companion`.

## 6. What was installed where (2026-10-02, job E22)

| Where | Change | Undo |
|---|---|---|
| this PC | `~/.local/bin/vitals-companion` wrapper, pointing at `<checkout>/packages/companion` with `/usr/bin/node` | after the merge: `node "<checkout>/packages/companion/bin/vitals-companion.mjs" install --force` (repoint), or `rm ~/.local/bin/vitals-companion` |
| this PC | `~/.config/vitals-companion/` (700) with `admin.token`, `pairings.json` (600) | `rm -r ~/.config/vitals-companion` |
| this PC | `~/.codex/config.toml`: `[mcp_servers.vitals]` appended (also used by the ChatGPT desktop app). Backup `~/.codex/config.toml.vitals-backup-2026-10-02T10-32-02` | `vitals-companion agents unregister codex` |
| this PC | `~/.config/opencode/opencode.json`: `mcp.vitals` added. Backup `~/.config/opencode/opencode.json.vitals-backup-2026-10-02T10-32-02` | `vitals-companion agents unregister opencode` |
| this PC | Claude Code user scope: server `vitals` (`claude mcp add -s user vitals -- ~/.local/bin/vitals-companion mcp`) | `claude mcp remove vitals -s user` |
| this PC | nothing else: no systemd unit, no `tailscale serve`, no Chromium flags, ChatGPT app not restarted. Test browser profiles live in the worktree's `.e6-tmp/` | — |
| oci-arm | `~/vitals-companion/` (package 0.2.0 + `node_modules` built on arm64), `~/.local/share/vitals-companion/` (relay data), `~/.config/systemd/user/vitals-companion.service` (enabled, active), `tailscale serve --bg --https=8443 http://127.0.0.1:4870`; npm's own cache in `~/.npm` | the undo line in §2 |

Not ours, seen while probing (left alone): Claude Code's user-scope server `codex` (`codex mcp-server`) fails to connect
because Codex 0.159 has no `mcp-server` subcommand; OpenCode's `hyponoia` server points at a missing binary.

## 7. Checklist with results (this run, 2026-10-02)

Raw logs: `qa/results/E22/`. Detailed log with output excerpts: `docs/wp/E22-proofs.md`.

| # | Proof | Command | Result |
|---|---|---|---|
| 1 | Installed on PATH | `fish -l -c 'vitals-companion --version; vitals-companion doctor'` | **pass**: `0.2.0`; doctor exit 0, no FAIL rows |
| 2a | Server unit | `ssh vitals-server 'systemctl --user is-active vitals-companion; curl -s http://127.0.0.1:4870/health'` | **pass**: `active`, `{"version":"0.2.0","roles":["relay"],…}`, 0 restarts |
| 2b | Tailscale serve | `ssh vitals-server tailscale serve status`; `curl -s https://vitals.example.ts.net:8443/health` | **pass**: `:8443 → http://127.0.0.1:4870` (tailnet only); same JSON over valid TLS; Caddy's sites on :443 unchanged |
| 2c | Two-device sync through the server | `node qa/scripts/e22/two-profiles-sync.mjs` | **pass**: an entry logged in profile A reached profile B in 3.1 s; no Local Network Access prompt from the loopback origin. Phone: offline, re-run below |
| 3 | Sign in with ChatGPT, prepared | `node qa/scripts/e22/siwc-precheck.mjs` | **prepared, consent not attempted**: request matches OpenAI's discovery document and docs; loopback callback reachable; OpenAI's Cloudflare check stops scripted and headless browsers before the login page, so only the owner's own browser can go further |
| 4 | OpenCode Zen preset | `vitals-companion keys import opencode-zen` | **blocked: no key on this PC** (OpenCode auth store absent, `OPENCODE_API_KEY` unset) |
| 5a | Codex CLI 0.159.0 | `codex exec --skip-git-repo-check --ephemeral --json -s read-only …` | **pass**: 3 MCP tool calls; note applied and visible in Vitals; `profile_patch` → `pending_user`; no `plan_end`/`plan_replace` |
| 5b | OpenCode 2.0.19 | `opencode run --standalone --auto --format json -m opencode/nemotron-3-ultra-free …` | **pass after two Companion fixes** (output schemas): same three results |
| 5c | Claude Code 2.1.287, second account | `claude -p --allowedTools "mcp__vitals__*" …` in a clean fish login shell | **pass**: 109 Vitals tools, none destructive; note applied; profile change staged |
| 5d | ChatGPT desktop app 26.928 | `/usr/lib/chatgpt/resources/codex exec …` (the app's bundled Codex host, same config) | **pass on the bundled host**; the app's own window was not driven (it was open in the owner's session and needs a restart to load the new entry): owner steps below |
| 6 | WebMCP in Chromium 153 | `node qa/scripts/e22/webmcp-cdp.mjs` (headless, `--enable-features=WebMCP`) | **pass, 23/23 checks**: 110 tools registered, none destructive; `today_get`, `log_measurement`, `log_note` completed; consequential tools staged; switching off removes all tools |

### Re-run when the owner is present

| What | Steps |
|---|---|
| Phone sync | Phone online in Tailscale → open https://vitals.creative.desi → Settings › Sync › Join with a pairing code (scan A's code, or the words + `https://vitals.example.ts.net:8443`) → allow the local-network prompt → log an entry on one device, Sync now on the other; `curl -s https://vitals.example.ts.net:8443/health` shows one more synced account |
| Sign in with ChatGPT | `vitals-companion proxy` running; in another terminal `vitals-companion siwc login`; accept in the browser (or copy OpenAI's refusal text verbatim); `vitals-companion siwc status`; then Settings › AI provider › Companion preset `siwc` and send one Coach message that logs something |
| OpenCode Zen | `opencode auth login` (OpenCode Zen) or `vitals-companion keys set opencode-zen`; `vitals-companion keys import opencode-zen`; Coach preset `opencode-zen`: "log 2 eggs and toast for breakfast, then suggest a swap for tomorrow's lunch" |
| ChatGPT desktop app | Quit and reopen the app → Settings › MCP servers shows `vitals` → new Codex task: "Use the vitals MCP server: call today_get, then log_note 'water 250 ml'" with a paired Vitals tab open |
| WebMCP in your Chromium | Enable chrome://flags/#enable-webmcp-testing, relaunch, Settings › Agents › agents in this browser |
