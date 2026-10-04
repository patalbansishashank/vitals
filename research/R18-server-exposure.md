# R18: Server exposure and the browser → server path (measured)

Date: 2026-10-03. Machine: this PC (`my-pc`, tailnet IPv4 `100.64.0.2`), Chromium 153.0.8010.52 (`/usr/bin/chromium`),
Companion 0.2.0 from `main`, Claude Code 2.1.287, Codex CLI 0.159.0, OpenCode 2.0.19. Server: `vitals-server` (tailnet
`100.64.0.1`). The owner's Companion on `127.0.0.1:4870` was not touched. The probe Companions ran on ports 4891 and 4892
with throwaway config folders under `.e6-tmp/r18/`. All probe processes and the temporary `tailscale serve --https=8444`
were stopped afterwards (`tailscale serve status` → "No serve config").

Scripts: `qa/scripts/R18/lna-probe.mjs`, `qa/scripts/R18/stream-server.mjs`, `qa/scripts/R18/mcp-remote-probe.mjs`.
Raw output: `qa/scripts/R18/results/*.json`.

Setup used by sections 1, 2 and 5:

```sh
export TMPDIR="$PWD/.e6-tmp"
node packages/companion/bin/vitals-companion.mjs proxy --port 4891 --config-dir $TMPDIR/r18/cfg                     # loopback
node packages/companion/bin/vitals-companion.mjs proxy --port 4892 --host 100.64.0.2 --config-dir $TMPDIR/r18/cfg2  # tailnet IP
node qa/scripts/R18/stream-server.mjs 4893                # 5 MiB body, SSE with 6 events 500 ms apart, CORS for the live site
tailscale serve --bg --https=8444 http://127.0.0.1:4893   # → https://my-pc.example.ts.net:8444 (tailnet only)
```

## 1. Chrome 153 Local Network Access from the live site

Command: `node qa/scripts/R18/lna-probe.mjs 100.64.0.2 my-pc.example.ts.net` (use your own values; see docs/QA.md) (and with
`R18_VARIANTS=granted-via-cdp,default-bypassCSP,granted-via-cdp-bypassCSP` after two fixes to the grant step). The script
opens `https://vitals.creative.desi/` in headless Chromium (no LNA flags) and runs `fetch(url, {mode:'cors'})` from the page.

Variants:
- **default**: no flags, no permission.
- **granted**: `Browser.grantPermissions` over CDP with `localNetwork` + `loopbackNetwork` in the page's browser context.
  This stands in for the user clicking Allow, because headless Chromium does not show the prompt.
- **flag**: `--disable-features=LocalNetworkAccessChecks`. docs/COMPANION.md lists no LNA flag; its only flag is
  `--enable-features=WebMCP`, which was also run and behaves exactly like default.
- **bypassCSP**: Playwright `bypassCSP: true`, to see Chromium's own behaviour behind the site's CSP.

| Target | default | granted | flag | granted + CSP off |
|---|---|---|---|---|
| (a) `http://127.0.0.1:4891/health` | **blocked**: `LocalNetworkAccessPermissionDenied`; console: "Permission was denied for this request to access the `loopback` address space" | allowed, 200 | allowed, 200 | allowed, 200 |
| (b) `http://100.64.0.2:4892/health` | **blocked by the site's CSP** (`connect-src 'self' https: wss: http://127.0.0.1:* … http://localhost:*`), so the request never reaches LNA | blocked (CSP) | blocked (CSP) | allowed, 200. Console warns "Mixed Content … requested an insecure resource" but the request goes through. Same result with and without `targetAddressSpace:'local'` |
| (b) with CSP off, no permission | `LocalNetworkAccessPermissionDenied`, "…access the `local` address space" | | | |
| (b) preflighted (`Authorization` header) `/v1/pair/status` | CSP | CSP | CSP | preflight passes; 401 from the Companion (expected: the probe token is fake) |
| (c) `https://vitals.example.ts.net:8443/health` (`tailscale serve`) | **blocked**: `LocalNetworkAccessPermissionDenied`, "`local` address space" | allowed, 200 `{"roles":["relay"],…}` | allowed | allowed |
| (c) `https://my-pc.example.ts.net:8444/echo` and `/sse` | blocked (same) | allowed; SSE events arrived at 504, 1003, 1503, 2003, 2505 and 3003 ms | allowed | allowed |
| (d) `https://api.github.com/zen` (public) | allowed, 200 | allowed | allowed | allowed |

Permission names in Chromium 153 (`navigator.permissions.query`): `loopback-network` and `local-network` are two separate
permissions, and both start in the state `prompt`. The older name `local-network-access` still answers. Granting only
`loopbackNetwork` left `local-network` denied, and the `ts.net` names stayed blocked. So **allowing the Companion on this
PC (loopback) does not cover the server (local)**: a user gets a second prompt the first time the site reaches the server.
What headless Chromium does is auto-deny. A headed Chrome with the state `prompt` shows the prompt; that was not measured
here (no headed run), and docs/COMPANION.md §2/§4 describes it as asked once per site.

**Is 100.64.0.0/10 private in Chromium 153?** Yes, it is `kLocal`. Source, opened at the exact tag:
`https://chromium.googlesource.com/chromium/src/+/refs/tags/153.0.8010.52/services/network/public/cpp/ip_address_space_util.cc`,
line 288–289: `// Carrier Grade NAT (RFC 6598): 100.64.0.0/10` / `Entry(IPAddress(100, 64, 0, 0), 10, IPAddressSpace::kLocal)`.
The measurement agrees: the `ts.net` names resolve to 100.x and were refused as "`local` address space".

Consequences:
- Every address on the tailnet needs the `local-network` permission, once per site, whether it is a raw IP, a `ts.net`
  name, or a public name whose DNS points to 100.x (other names under the owner's own domain do that, see §6). LNA
  classifies by the resolved IP.
- Only a server on a public IP avoids the prompt.
- Raw `http://100.x` is ruled out by the site's own CSP; the server needs an HTTPS name.

## 2. CORS and credentials

What the Companion sends today. The commands were curl with `-H 'Origin: https://vitals.creative.desi'`:

| Request | Response headers |
|---|---|
| `GET /health` (127.0.0.1:4891, 100.64.0.2:4892) | `Vary: Origin`, `Access-Control-Allow-Origin: https://vitals.creative.desi`, `Access-Control-Expose-Headers: Retry-After`, `Cache-Control: no-store` |
| `OPTIONS /v1/pair/status` with `Access-Control-Request-Headers: authorization` and `Access-Control-Request-Private-Network: true` | 204, the headers above plus `Access-Control-Allow-Methods: GET, POST`, `Access-Control-Allow-Headers: Authorization, Content-Type`, `Access-Control-Max-Age: 600`, `Access-Control-Allow-Private-Network: true` |
| same through `https://vitals.example.ts.net:8443` (relay role only) | 404 for `/v1/*` (the relay has no agent routes), CORS headers present |
| `Origin: https://evil.example` | 403 `{"error":"origin not allowed"}` |
| `Host: server.example.com` or `Host: 100.64.0.2:4891` on a loopback-bound Companion | 403 `{"error":"host not allowed"}` |

Code facts:
- `security.ts` always allows `PUBLIC_APP_ORIGIN = 'https://vitals.creative.desi'`, any `http://localhost|127.0.0.1|[::1]`
  origin, any extra `--origin`, and the same origin for trusted Host names.
- `Access-Control-Allow-Credentials` is never sent and cookies are not used: the bearer travels in `Authorization`.
- The Host guard accepts only loopback names, `*.<tailnet>.ts.net`, and the bind address. With `--host 0.0.0.0` it
  accepts any IP literal.

What `tailscale serve` does (stream-server behind `--https=8444`, curl from this PC):

| Check | Result |
|---|---|
| CORS headers | passed through unchanged (`access-control-allow-origin`, `access-control-expose-headers`, `vary`, custom `x-probe`) |
| `Authorization` | reaches the backend (`auth: present`) |
| Host seen by the backend | `my-pc.example.ts.net:8444`; `X-Forwarded-For: 100.64.0.2`; `X-Forwarded-Host` set |
| 5 MiB body | 200, 5,242,880 bytes in 0.02 s |
| SSE | not buffered: each event arrived within 3 ms of its send time, at 500 ms spacing (curl and Chromium alike) |
| HTTP version | HTTP/2 to the client |

What the website → server path needs:
1. The allow-list keeps `https://vitals.creative.desi`, and the installed PWA is the same origin, so nothing extra is
   needed for it. Deploy previews or a self-served copy need an `--origin`.
2. Bearer in `Authorization`, no cookies, no `Allow-Credentials`.
3. Preflight cached for 600 s today. Chromium caps `Access-Control-Max-Age` at 7200 s (Chromium source not opened for
   this; treat it as unverified), so raising the value to 7200 is harmless.
4. The Host guard must also accept the configured public server name if one is used (§6). Today it returns 403.
5. Server tokens must not be bound to a single origin the way `/v1/pair/local` binds them (see §3).

## 3. Device tokens on top of the pairing routes

Today, from `auth.ts` and `server.ts`:
- `POST /v1/pair/code` (admin token) mints one 8-digit code. It lasts 10 minutes, allows 5 attempts, and works once; a new
  code replaces the old one.
- `POST /v1/pair/local` (code + `Origin`) returns a 32-byte base64url token bound to that origin.
- `POST /v1/pair/client` (admin) mints a named token for MCP clients, which send no `Origin`.
- `GET /v1/pair/status` reports state.
- Only SHA-256 hashes are stored, in `pairings.json` (0600), and the lookup is constant-time.
- There is **no revoke route and no per-device listing route**. `list()` exists in code only.

Proposed scheme (for A4/E25/E27):

| Step | Route | Notes |
|---|---|---|
| Issue a code | `POST /v1/pair/code` (admin: CLI on the server, or an already-paired owner device) with `{person, label?}` | Several open codes at once, each tied to a person; 10 min, 5 attempts, single use as today. Rate limit per source IP |
| Redeem | `POST /v1/pair/device` `{code, label}` → `{token, deviceId, person}` | Token = 32 random bytes. Store only the hash with `{deviceId, person, label, origin-at-pairing, createdAt, lastSeenAt}`. Do not bind it to an origin (MCP clients have none). Origin is still checked by the allow-list on every request |
| Status | `GET /v1/pair/status` | Adds `{deviceId, person, label}` of the caller |
| List | `GET /v1/devices` (owner/admin) | label, created, last seen; never the token |
| Revoke | `DELETE /v1/devices/:id` (owner/admin, or the device itself) | Removes the hash. The next request gets 401, and the client asks to pair again (`companion.ts` already handles 401 as "pair again", line 309) |

Where the website keeps it: `src/agents/companion.ts` stores the Companion pairing `{v, token, baseUrl, pairedAt}` in
`localStorage` (line 188). `src/sync/pairing.ts` holds the sync owner secret format (`vitals-sync:1?u=<relay>&s=<secret>`),
not a server token. Proposal:
- A separate `localStorage` entry `vitals.server.v1 = {baseUrl, token, deviceId, person, pairedAt}`, same pattern as the
  Companion entry.
- IndexedDB gives no extra protection against script on the same origin, and the CSP already limits script to `'self'`.
- Clear the entry on 401 and on Settings › Server › Forget this server.

QR for the PWA: `vitals-server:1?u=<urlencoded https base URL>&c=<8-digit code>[&n=<label>]`. This mirrors the existing
`vitals-sync:1` string. The code is short-lived and single use, so a photographed QR is useless after 10 minutes or after
use. The QR must never carry the token itself.

## 4. Sign in with ChatGPT on a headless server

`~/.config/vitals-companion/siwc.json` was checked by structure only, no values printed:
- File mode 600, 2,422 bytes.
- Fields `accessToken` (JWT, 2,086 chars), `refreshToken` (211 chars), `expiresAt` (number), `clientId` (31 chars).
- `install.json` holds `installId` and `siwcClientId`.
- The JWT's claims are `sub, aud, client_id, scope, https://api.openai.com/auth{per_user_salt, encrypted_auth_metadata},
  iss, iat, exp, jti, nbf`. There is **no `cnf` claim**, so the token is not bound to a key or device (plain bearer).
- The access token lives 1 hour and was already expired, so the first use on any machine is a refresh.
- `siwc.ts` refreshes with `t.clientId` from `siwc.json`, so the file alone is enough to refresh.
- `siwc.ts` does not store `id_token`.

OpenAI's docs, opened 2026-10-03 at https://developers.openai.com/siwc/llms-full.txt, section "Self-hosted VMs":
- "A `127.0.0.1` callback reaches the computer running the browser, not the remote VM. Complete OAuth locally…"
- "Transfer the selected registration's protected credential file to the tool's documented VM path over a secure channel
  such as SSH. Include its issued `client_id`, `access_token`, `refresh_token`…"
- "Preserve the host ID assigned to the VM when importing the credentials so a copied laptop ID does not overwrite it."
- "Let the VM own later refreshes."
- "Host-specific usage attribution and revocation of ChatGPT plan access for transferred sessions are not yet available."

On refresh, the same docs say refreshes rotate ("Each successful refresh returns a replacement refresh token with a fresh
30-day lifetime") and list `refresh_token_reused` as an unusable-token error.

| Path | Verdict |
|---|---|
| Move `siwc.json` to oci-arm | **Portable and documented.** It must be a *move*: after the copy the PC must stop using it (delete it there or log out locally without revoking), otherwise whichever side refreshes second gets `refresh_token_reused`. oci-arm keeps its own `installId` and needs only `siwcClientId` from the PC's `install.json`. E26 needs a `siwc export` / `siwc import` pair that does exactly this. Not run here (it would rotate the owner's session) |
| `siwc login` on oci-arm through an SSH port-forward | Possible but not tested. The callback listener binds `127.0.0.1:<ephemeral>` (`listen(0)`, siwc.ts line 186), so the forward can only be set up after the port is known. E26 should add `--callback-port <n>` and print `ssh -L <n>:127.0.0.1:<n> oci-arm`. Advantage: the VM's own host id from the first login. Needs the owner at a browser; OpenAI's Cloudflare check blocked scripted browsers in E22 |
| Device-code flow | **Not offered**: the SIWC docs (87,810 bytes) contain no `device_code`, "device authorization" or device grant type. R14 §7 found the same on 2026-10-02 |

## 5. MCP over HTTPS from another machine

Test against a Companion on `100.64.0.2:4892` (tailnet IP, not loopback), with a client token from
`vitals-companion pair --client r18-probe --url http://100.64.0.2:4892 --config-dir .e6-tmp/r18/cfg2`. The token was
written to a 0600 file and never printed.

| Check | Command | Result |
|---|---|---|
| Raw Streamable HTTP (MCP SDK) | `node qa/scripts/R18/mcp-remote-probe.mjs http://100.64.0.2:4892/mcp .e6-tmp/r18/client.token` | `initialize` ok; **0 tools**; `today_get` → "Open Vitals in a browser tab, then try again." (no tab connected: the tools live in the page today) |
| Host check | same script, raw POST with `Host: my-pc.example.ts.net:4892` | 200 (ts.net accepted) |
| | `Host: server.example.com` | **403 host not allowed** |
| Origin on `/mcp` | `Origin: https://vitals.creative.desi` + client token | 401: client tokens are valid only without an Origin (`auth.verify`) |
| No bearer | | 401 |
| Claude Code 2.1.287 | `claude -p --strict-mcp-config --mcp-config <json with type http, url, headers.Authorization> --model claude-haiku-4-5-20251001 …` | init event: `{"name":"r18","status":"connected"}`, 0 tools |
| Codex 0.159.0 | `codex -c 'mcp_servers.r18.url="http://100.64.0.2:4892/mcp"' -c 'mcp_servers.r18.bearer_token_env_var="R18_TOKEN"' mcp list` | config accepted: `r18  http://100.64.0.2:4892/mcp  R18_TOKEN  enabled  Bearer token`. No session was run, so the connection itself is not tested |
| OpenCode 2.0.19 | `opencode mcp list` with the remote entry in `OPENCODE_CONFIG` and in a project `opencode.json` | printed "No MCP servers configured" even though the user config has `vitals`, so this listing is not a usable check in 2.0.19. **Not verified** |

Exact configuration for a Companion on another host. Replace `<url>` with `https://vitals.example.ts.net:8443/mcp`
or the public name, and `<token>` with a device or client token kept in an environment variable:

```toml
# ~/.codex/config.toml (also read by the ChatGPT desktop app)
[mcp_servers.vitals]
url = "https://vitals.example.ts.net:8443/mcp"
bearer_token_env_var = "VITALS_TOKEN"
default_tools_approval_mode = "approve"
```

```json
// ~/.config/opencode/opencode.json → "mcp"
"vitals": { "type": "remote", "url": "https://vitals.example.ts.net:8443/mcp",
            "headers": { "Authorization": "Bearer {env:VITALS_TOKEN}" }, "enabled": true }
```

```sh
claude mcp add --transport http -s user vitals https://vitals.example.ts.net:8443/mcp --header "Authorization: Bearer $VITALS_TOKEN"
```

The Claude Code form writes the token value into `~/.claude.json`. Codex and OpenCode read it from the environment.

For the server, the MCP transport, auth and Host check already work over the tailnet. The gap is that tools are
answered by an open browser tab. E26 must run them on the server against the person's store.

## 6. oci-arm today (read-only)

Commands: `ssh vitals-server '…'` with `node --version`, `free -m`, `df -h /`, `systemctl --user status|cat vitals-companion`,
`du -sh`, `ss -ltn`, `systemctl status caddy`, `tailscale serve status`. Caddy sites came from the admin API
`curl 127.0.0.1:2019/config/`, reduced to listen addresses, host matchers and issuer module names; `/etc/caddy/Caddyfile`
is root-only and was not read. DNS was checked with `dig` from this PC.

| Fact | Value |
|---|---|
| OS, CPU, Node | Ubuntu 24.04.5 LTS, aarch64, 2 cores, Node v24.21.0 |
| Memory | 11,927 MB total, 5,909 MB available; **swap 4,046 / 4,095 MB used** |
| Disk `/` | 96 GB, 48 GB free (51 %) |
| Relay unit | user unit `vitals-companion`, active since 2026-10-03 07:03 IST, 73.7 MB RSS (peak 95 MB); `sync --host 127.0.0.1 --port 4870 --data ~/.local/share/vitals-companion` |
| Relay data | `~/.local/share/vitals-companion` 104 KB; package `~/vitals-companion` 59 MB; `/health` `ownerCount: 9` |
| tailscale serve | `https://vitals.example.ts.net:8443 (tailnet only)` → `http://127.0.0.1:4870`; no Funnel |
| Caddy | system unit "Caddy reverse proxy (tailnet-only, custom domain TLS)". One server `srv0` listening on **`100.64.0.1:443` only** (also :80 on the tailnet IP). Hosts: five other self-hosted services under the owner's own domain. TLS: ACME DNS-01 via the `acmedns` provider (`_acme-challenge.<name>` is a CNAME to `*.auth.acme-dns.io`) |
| DNS pattern | those names are public A records pointing at the tailnet IP `100.64.0.1`; `vitals.creative.desi` is on Netlify; `server.example.com` does not exist |
| Ports listening on the tailnet IP | 80, 443, 1933, 8080, 8443, 8883, 35759 |
| Ports listening on all interfaces | 22, 111, 631 |
| Free | 4871–4879 on loopback (4870 = relay); any port not listed above |

Adding `server.example.com` behind Caddy, following the owner's existing pattern:
1. Register a new acme-dns account and add the CNAME `_acme-challenge.server.example.com` at NS1 (owner).
2. Add an A record `server.example.com → 100.64.0.1`.
3. Add a site block `reverse_proxy 127.0.0.1:4870` (root, owner).

Automatic TLS works through DNS-01 without opening anything. **That name is still tailnet-only and still `local` for LNA**
(§1), so it gives a nicer name and port 443, not a prompt-free path. A truly public name would need Caddy on the public
interface plus OCI security-list and host-firewall changes (not inspected: needs root). It would expose the server to the
internet.

## 7. Recommendation

**Default topology for v0.4.0: tailnet-only, over HTTPS, behind `tailscale serve`.**
- The server is `https://vitals.example.ts.net:8443`. The relay and the new server roles share one process on
  127.0.0.1:4870.
- The browser asks once per site for "local network". That is acceptable: the owner already accepts it for sync, and
  any tailnet address costs the same prompt (measured).
- `server.example.com` behind Caddy is an optional nicer name with the same LNA prompt. A public internet
  exposure is not recommended for v0.4.0: it has a larger attack surface and gains only the removal of one prompt.

Numbered list for A4, E25, E26 and E27:

1. **E25/E27** Keep the bind on `127.0.0.1` and expose it with `tailscale serve --https=8443`. Add a `--public-host <name>`
   option that the Host guard accepts. Today any non-`ts.net` Host is 403 (measured), so this is needed for
   `server.example.com`.
2. **E25** Device tokens:
   - `POST /v1/pair/code` with `{person,label}`, admin or owner only, several open codes, same limits as today.
   - `POST /v1/pair/device` → `{token, deviceId, person}`.
   - `GET /v1/devices`, `DELETE /v1/devices/:id`, and `GET /v1/pair/status` returning the caller's device and person.
   - Hash-only storage with `lastSeenAt`. Not origin-bound. The person is resolved from the token, never from the request
     body.
3. **E27** Website/PWA:
   - Settings › Server takes the URL and code, or scans `vitals-server:1?u=…&c=…`.
   - Store `{baseUrl, token, deviceId, person}` in `localStorage` like the Companion pairing.
   - Bearer in `Authorization`. Clear the entry on 401.
   - The plain-words explanation of the "local network" prompt appears before the first request. It is a separate
     permission from the one for this PC's Companion.
4. **E27** Never use `http://100.x` URLs: the site CSP blocks them (measured). Accept only `https://` server URLs. No CSP
   change is needed for HTTPS names (`https:` is already in `connect-src`).
5. **E25** CORS: keep the allow-list (live site, which also covers the PWA, plus `--origin`). Add `X-Device-Id` or other
   new headers to the preflight allow-list if used. Raise `Access-Control-Max-Age` to 7200. Keep
   `Access-Control-Allow-Private-Network: true`. No credentials mode.
6. **E26** Coach and provider proxy streams over SSE through `tailscale serve`: measured unbuffered, CORS and
   `Authorization` passed through. No proxy changes are needed.
7. **E26** Sign in with ChatGPT on the server:
   - Default path: add `vitals-companion siwc export` (PC) and `siwc import` (server). These move `siwc.json`, copy
     `siwcClientId` into the server's `install.json` without touching its `installId`, and then remove the PC copy, so
     only one side ever refreshes (`refresh_token_reused` otherwise).
   - Fallback: `siwc login --callback-port <n>` on the server plus a printed `ssh -L` line.
   - There is no device-code flow.
   - The owner does the consent once at their own browser.
8. **E26** MCP over HTTPS: tools must run on the server against the person store. Today `/mcp` connects over the tailnet
   but lists 0 tools without a browser tab (measured). `vitals-companion agents register <agent> --remote <url>` should
   write:
   - Codex: `url` + `bearer_token_env_var`.
   - OpenCode: `type: remote`, `url`, `headers` with `{env:VITALS_TOKEN}`.
   - Claude Code: `claude mcp add --transport http … --header`.

   Re-verify OpenCode by a real `opencode run`, because `mcp list` was not a usable check.
9. **E25** Rate-limit per device and per source IP. Keep the redacting logger. Log `deviceId`, never the token.
10. **Ops (owner, before E25 deploy)**: oci-arm swap is 99 % used with 5.9 GB RAM available. Check what holds swap before
    adding the server role. Disk (48 GB free) and relay size (104 KB) are not constraints.

Open items:
- A headed Chrome run to see the actual prompt wording for `local-network`.
- An OpenCode remote-MCP check by a real session.
- A Codex connection by a real session.
- The SIWC move, which needs the owner because it rotates the live session.
- The OCI public firewall state (root).
