# V1g review: the Companion (`packages/companion/**`), pass 1

Static review of server, auth, security, proxy, siwc, mcp, agentHub, relay, blobs, static, config, install, cli, sys and
doctor, with probe requests against a Companion on a free port (never 4870). Paths are relative to
`packages/companion/src/`. Line numbers are after the fixes on branch `wp/V1g`.

No blockers and no highs. The route auth, Host/Origin and traversal handling held up under probing; the defects found
are races and lifecycle leaks.

| ID | Severity | File:line | What is wrong | How confirmed | Fix or reason not fixed |
|---|---|---|---|---|---|
| V1g-01 | medium | `siwc.ts:148` (`refresh`), `siwc.ts:321` (`logout`) | A token refresh that is in flight when the person signs out finishes afterwards, writes `siwc.json` again and signs them back in. The same happens when a login completes during a refresh (the old session overwrote the new one). | `hardening.test.ts` "a refresh in flight during sign-out…": failed before (file present), passes after | **Fixed.** A `generation` counter is bumped by logout and by a completed login. A refresh that sees a changed generation neither stores nor deletes, and rejects with `refresh_failed` ("try again"). |
| V1g-02 | medium | `siwc.ts:155-160` | A network failure on the token endpoint during refresh came out as a raw `TypeError` instead of a `SiwcError`. The proxy then answered `500 internal` instead of `502 siwc_refresh_failed`, and the log said "request failed: fetch failed". | `hardening.test.ts` "a network failure during refresh…": failed before, passes after | **Fixed.** Fetch errors map to `SiwcError('refresh_failed')`; only the error name is logged. |
| V1g-03 | medium | `siwc.ts:188` (`login`) | Two `login()` calls close together (two `POST /v1/ai/siwc/login` or a double click) each opened a loopback listener and a browser tab. The first listener lost its cancel hook, so `close()` on shutdown left it open for up to 5 minutes and kept the process alive. | `hardening.test.ts` "concurrent login() calls…": failed before (two redirect URIs, two browser opens), passes after | **Fixed.** A second caller shares the in-flight start (`starting` promise) and gets the same pending login. |
| V1g-04 | medium | `server.ts:384` | When `listen` failed (EADDRINUSE), `startCompanion` threw with the relay SQLite database, the MCP sessions and the hub still open. The CLI reported the error and exited, so in practice only tests and embedders leaked. | `hardening.test.ts` "closes the relay database before rejecting": counted `/proc/self/fd` entries under the data dir. Failed before (open fds), passes after | **Fixed.** On a listen error the relay, the MCP sessions, the hub and siwc are closed before rethrowing. |
| V1g-05 | low | `install.ts:94-122` (`unitFile`) | Paths in the systemd unit were not escaped. systemd expands `%` specifiers in `WorkingDirectory=`, `ExecStart=` and `ReadWritePaths=`, and expands `$VAR` in `ExecStart=`. A checkout or data path containing `%` or `$` would run the wrong command or bind the wrong directory. | `hardening.test.ts` "keeps % and $ in paths literal" | **Fixed.** Values are written as `%%` everywhere and as `$$` in `ExecStart=`. |
| V1g-06 | medium | `server.ts:273` (`/mcp`), `agentHub.ts` `call` | SUITE_SPEC §7.2 asks for "rate limits per token", but only `/v1/ai/siwc/login` and the provider proxy (`server.ts:234`, `:293`) take a token from the bucket. An MCP client token can send `tools/call` to the paired tab without limit. | Read. The limiter is never called on the `/mcp` path | **Open.** The default bucket (20 burst, 60/min) may be too tight for agents, and the limit belongs on `tools/call` only, not on `tools/list` or SSE GETs. That is a policy choice. Pointer: call `rateLimit(a, p)` inside `case '/mcp'` for POST bodies whose `method === 'tools/call'`, with its own bucket size. |
| V1g-07 | medium | `auth.ts` (whole), `cli.ts` | Paired browser and client tokens never expire, and no command revokes one: `pairings.json` can only be edited by hand. A leaked MCP client token stays valid. | Read; grep for revoke/unpair finds nothing | **Open** (a feature, more than about 30 lines). Pointer: `vitals-companion pair --list` / `--revoke <id>` using `auth.list()` plus a `remove(id)` that saves. Settings › Companion could show the list. |
| V1g-08 | low | `cli.ts:303` | The startup pairing code goes to stdout. Under the systemd unit, stdout is the journal, so the code (single use, 10 minutes, 5 attempts) is stored there. SUITE_SPEC §13.6 says "logs to stdout/journald only, no secrets". | Read | **Open.** Possible fix: when `INVOCATION_ID` is set (systemd), print "run `vitals-companion pair` for a code" instead of the code. Left as is because the owner workflow may depend on `journalctl` showing it; needs a decision. |
| V1g-09 | low | `security.ts:124` | `perMinute: 0` gives `perMs = 0` and `Retry-After: Infinity`. | Read | **Open.** Config only (no CLI flag sets it); not reachable from outside. |
| V1g-10 | low | `blobs.ts:128`, `:141` | The per-owner quota is checked before the body is read, but usage is only updated after the write. N concurrent PUTs can overshoot the 10 GB quota by up to N × 1 MiB. | Read | **Open.** Bounded and harmless (one owner, their own chunks). |
| V1g-11 | low | `mcp.ts:96` | When 32 sessions are open, the next `initialize` evicts the oldest session, whoever owns it. One client token can push out another client's session. | Read | **Open.** All tokens belong to the same owner, and the evicted client re-initialises. Per-principal caps would fix it. |
| V1g-12 | low | `siwc.ts:256` | Any request to the loopback callback with a wrong `state` ends the pending sign-in (`state_mismatch`). A local page that guesses the ephemeral port could cancel a sign-in. | Read | **Open.** Only a denial of service on a 5-minute flow, and the port is random. It could ignore mismatches until the timeout instead. |
| V1g-13 | low | `config.ts:92` | An existing `admin.token` with wider permissions (for example 0644 after a copy) is reused without `chmod 600`. | Read | **Open.** `doctor` already fails the `configDir` check and prints the `chmod` fix (`doctor.ts:136-138`). |
| V1g-14 | low | `server.ts:140` | The Sign in with ChatGPT URL is printed through the raw sink (`print` falls back to `options.log`, not the redacting logger). The URL contains `state` and the PKCE challenge. | Read | **Open, intended.** The person has to see the URL. `state` is one-time and the verifier is never printed. |
| V1g-15 | low | `server.ts` `handle` | An absolute-form request target (`GET http://x/v1/pair/status`) matches no route and gets the SPA `index.html`. | Probe: 200 with `index.html` | **Open.** It does not bypass anything: Host is still checked and no API route answers. Noted so pass 2 does not chase it. |

## Verified fine (pass 2 need not redo)

- **Host check (DNS rebinding):** `localhost.`, `evil.com` and `evil.com` combined with `X-Forwarded-Host: localhost` all get 403. `*.ts.net` and loopback names pass. With a wildcard bind, only IP literals pass.
- **Origin:** `null`, foreign origins and spoofed `X-Forwarded-Host` get 403 on GET and on OPTIONS preflight. The response carries no CORS headers.
- **CORS:** `Access-Control-Allow-Origin` echoes only allowed origins, and only on API, blob and health paths. Preflight sends `Allow-Private-Network`.
- **Auth on every route:**
  - `/v1/pair/code`, `/v1/pair/client`, `/v1/agent/*`: admin only.
  - `/mcp`: admin or client token, never with an Origin.
  - Browser tokens: only from their bound origin.
  - Admin and client tokens sent with an Origin are refused.
  - Bridge WebSocket: allowed Origin, then a `hello` with a browser token for that origin.
  - `/sync`: a valid owner id in the URL. `/blobs`: K_auth trust on first use, with a constant-time compare.
- **Pairing:** 8-digit code, single use. Check and use happen with no `await` between them, so concurrent correct codes cannot both win. Locks after 5 wrong attempts and expires after 10 minutes. The code and the admin token are registered as log secrets.
- **Body limits:** pairing 4 KiB (413 tested), JSON must be an object (400 on `[1]`), MCP 4 MiB, agent call 1 MiB, proxy 8 MiB, blobs 1 MiB (both the declared size and the streamed size).
- **Traversal:** static `/%2e%2e/`, `..%2f` and `%5c` get 404 and never escape the root. `/blobs/<id>/..` gets 400. The proxy matches sub-paths exactly (`..%2fmodels` gets no route), and a query cannot change the upstream host.
- **Proxy:** forwards only `content-type`, `accept` and `openai-beta`. Strips `Authorization` and `Cookie`. Never forwards `set-cookie`. Uses `redirect: 'error'`. Keys are registered as log secrets.
- **File permissions:**
  - Config dir is created 0700 and chmodded again on every start.
  - Secrets are written to a 0600 temp file (`wx`) and renamed into place.
  - Blob `.auth` and chunks are 0600; the data dir is 0700.
  - The unit sets `UMask=0077`.
- **SIWC:** PKCE S256, `state` compared in constant time, `nonce` checked against the ID token, callback on 127.0.0.1 only. Concurrent refreshes share one request. A caller holding a stale rotated refresh token gets `lastRefreshed`. A 400 or 401 on refresh deletes the file (signed out).
- **Logging:** callback queries, bearer and cookie headers, `sk-`, `nvapi-`, `oaiapp_` and JWT-shaped strings, and JSON token fields are all redacted. Log lines carry origins, labels, statuses and counts, never bodies or health data.
- **Agent hub:** destructive tools and tools without the `mcp` surface are refused (`exposedTo`). The result envelope is validated. A newer tab replaces the old one and settles its pending calls. A tab that does not answer in time gets `running`, not a false failure.
- **Relay isolation:** messages are broadcast only to sockets subscribed to the same owner id. Writes need the Evolu owner write key (upstream protocol). Unsent broadcast bytes per socket are capped.
- **Lifecycle:**
  - SIGINT and SIGTERM close everything (hub, MCP, relay, server); a second signal kills the process.
  - The CLI turns EADDRINUSE into a plain message.
  - `close()` is idempotent.
  - The relay waits up to the `ws` close timeout for peers.
- **Unit template:** loopback bind; `ProtectSystem=strict` with the data and config dirs in `ReadWritePaths=` (created before writing the unit); `NoNewPrivileges`; `PrivateTmp`; spaces in paths quoted.

## For other areas

None. Every finding is inside `packages/companion/**`.
