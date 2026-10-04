# Screen — Settings › Server (`/settings/server`), and the first-run "Use your server?" step

> Batch 03 (2026-10-03, design D3). The server on the person's own machine replaces the Vitals
> Companion as the thing a person sets up: it runs sync, the Coach's providers that need a server
> (Sign in with ChatGPT, OpenCode Zen, NVIDIA), the keys for those, the address agents use, and the
> receiver for Lumen Health's ring events. The website and the installed app talk to it over HTTPS
> with a device token obtained by pairing **once per device**.
> Contracts: `docs/SUITE_SPEC.md` §14 "Batch 03 contracts" (A4, in progress when this was written:
> command and field names in §11 below are proposals to reconcile with §14, not settled names).
> Components: `COMPONENTS.md §15` (pairing field, shown-once block, server status pill, corrected
> marker). Related: `settings-sync-ai.md §13` (providers, agents, install with the server),
> `settings-data.md §11` (Lumen Health over MQTT, corrections).
> Every control here is **UI-only**: neither the Coach nor any agent can pair, revoke or forget.
> All names, addresses, codes and dates are synthetic examples.

## 1. Purpose

Let the person connect this device to their server once, see at a glance that it works, see which
devices are connected and remove any of them, and understand in plain words what the server holds
and can read. It must also explain failures (server down, code expired, device removed) with one
clear action each, and never lose data on this device while doing so.

## 2. Entry points & exits

| In | Out |
|---|---|
| Settings index "server" · server status pill popover "Server settings" · AI provider row "needs your server" → "Pair a server" · Agents "Pair a server first" · Install "Your server" · Devices "Lumen Health over MQTT" (when not paired) · first-run step (§7) · `/settings/server` deep link · a pairing link `…/settings/server#pair=…` from the server's QR | back to where it came from · after pairing from the first run: Today (data received) or intake (empty server) |

## 3. Layout

Settings index order with batch 03: **units · appearance · kitchen · supplements · your data ·
server · sync · devices and streams · AI provider · agents · install · safety · about**. Server
comes right after "your data" because it answers the same question: where the data lives.

| Width | Frame |
|---|---|
| 390 | top bar "‹ Settings", sticky anchor chips (gutter 16, `scroll-padding-inline` 16), one Faceplate per block, full width minus gutters. Keys full width, 48 h. |
| 768 | anchor chips stay; content column max 720 centred; key rows inline (two keys side by side). Devices list is a two-column grid inside the Faceplate (name/platform · last seen + Revoke). |
| 1440 | sticky vertical KeyBank (240) + content column (max 720) as the rest of Settings; the "what it can read" block sits beside the status block in a two-column grid inside the Faceplate (≥ 1200 px content width only; otherwise stacked). |

The page is three Faceplates when paired (Server · Devices · What your server holds), one when
not paired. No nested faceplates: inside each, hairlines and spacing.

### 3.1 Not paired (390)
```
┌──────────────────────────────────────────┐
│ ‹  Settings                              │
│ [data][●server][sync][devices][ai…]      │ anchor chips
├──────────────────────────────────────────┤
│ ┌ Server ───────────────────────────────┐│
│ │ Your server is a small program on a   ││ two lines, 15/400 ink
│ │ computer you own. It keeps your data, ││
│ │ syncs your devices and runs the Coach.││
│ │ You pair each device with it once.    ││ 13 ink-2
│ │                                        ││
│ │ [ Enter code ]                         ││ Key default, full width, 48 h
│ │ [ Scan QR ]                            ││ Key default, full width, 48 h
│ │ ─────────────────────────────────────  ││
│ │ No server yet? How to set one up ›     ││ link to the help page
│ │ Without a server, Vitals works on this ││ ink-2 12
│ │ device only; the Coach can use most    ││
│ │ providers directly.                    ││
│ └────────────────────────────────────────┘│
```

### 3.2 Paired (390)
```
│ ┌ Server ─────────────────── ● reachable ┐│ status pill (COMPONENTS §15.3) in the header
│ │ home server                            ││ 15/500, the server's name
│ │ https://vitals.tail1234.ts.net:8443    ││ 13 mono-ish tabular, ink-2, wraps at "/"
│ │ ─────────────────────────────────────  ││
│ │ answers now       yes · 42 ms          ││ key/value rows, 44 h
│ │ last sync         14:02                ││
│ │ server version    0.4.0                ││
│ │ this device       Pixel 9 · Chrome     ││
│ │ [ Check now ]                          ││
│ │ ─────────────────────────────────────  ││
│ │ [ Add another device ]                 ││ opens the code + QR panel (§4.5)
│ └────────────────────────────────────────┘│
│ ┌ Devices ──────────────────────── 3 ────┐│
│ │ Pixel 9 · Chrome · this device         ││
│ │ paired 3 Oct 2026 · seen now           ││
│ │ ─────────────────────────────────────  ││
│ │ Laptop · Firefox                       ││
│ │ paired 3 Oct 2026 · seen 2 h ago       ││
│ │                           [ Revoke ]   ││ Key quiet, danger text
│ │ ─────────────────────────────────────  ││
│ │ Vitals app · Laptop                    ││ installed app counts as its own device
│ │ paired 3 Oct 2026 · seen yesterday     ││
│ │                           [ Revoke ]   ││
│ └────────────────────────────────────────┘│
│ ┌ What your server holds ────────────────┐│
│ │ • your plan, logs, body data and Coach ││
│ │   conversations, in one folder on that ││
│ │   computer                             ││
│ │ • your AI keys and your ChatGPT        ││
│ │   sign-in, if you added them there    ││
│ │ • your ring's data from Lumen Health,  ││
│ │   if you connected it                  ││
│ │ It can read all of this: that is how   ││
│ │ the Coach, agents and your ring work   ││
│ │ while your devices are off. Anyone who ││
│ │ can open that computer's files can     ││
│ │ read it too.                           ││
│ │ ─────────────────────────────────────  ││
│ │ [ Forget this server ]                 ││ Key quiet, danger text, full width
│ │ This device stops using the server.    ││ 12 ink-2
│ │ Its data stays here.                   ││
│ └────────────────────────────────────────┘│
```
At 1440 the Server Faceplate shows the address and the key/value rows on the left (360) and the
"Add another device" block on the right; Devices rows are one line each: `name · platform ·
paired · seen · [Revoke]`.

## 4. Flows

### 4.1 Enter code
"Enter code" opens a panel in place (not a dialog; the Faceplate grows; focus moves to the first
field):
```
 server address  [ https://vitals.tail1234.ts.net:8443      ]
 pairing code    [ K7QM ]–[ 4XRD ]                               ← PairingCodeField §15.1
 Make a code on your server ("vitals-server pair") or on a device that is already
 paired (Settings › Server › Add another device). Codes last 10 minutes.
 name this device [ Pixel 9 · Chrome                       ]     ← prefilled from the platform
 [ Pair ]   [ Cancel ]
```
- The address is remembered from a QR scan or a previous pairing; first time it is empty with
  placeholder "https://your-server.example:8443". It must start with `https://` (`http://` only for
  `localhost`): "The address must start with https://."
- Code: 8 characters in two groups of 4, letters and digits without look-alikes (no 0, O, 1, I),
  case-insensitive, pasting a whole code or a pairing link fills both groups (provisional; the
  code format is A4's).
- **Pair** is enabled when both are filled; while pairing it shows the loading ring and the text
  "Pairing…"; the panel stays (§5 "pairing in progress").

### 4.2 Scan QR
"Scan QR" opens the existing scan dialog (camera; `ScanDialog`), titled "Scan the server's code",
help "Point the camera at the QR code on your server's screen or on another paired device." The QR
holds the address and the code (a pairing link); scanning fills §4.1 and pairs at once (no second
tap) because both came from the code. Camera denied / no camera / unsupported browser: the existing
copy, ending "Enter the code instead." with the Enter code panel opened.

Opening a pairing link directly (`#pair=` in the address, e.g. from a phone's camera app) lands on
`/settings/server` with §4.1 filled and a single key **Pair this device** (the fragment is removed
from the address bar at once so it does not stay in history).

### 4.3 Pairing in progress → paired
- In progress: Pair key shows the loading ring; under it, step lines replace each other (one live
  region, polite): "Reaching your server…" → "Checking the code…" → "Getting your data… 62 %"
  (bytes when known: "4.1 of 6.6 MB"). Cancel stays available until the code is accepted.
- **This device already has data** (the server holds data too): the same choice as joining sync
  today, in the same words: "**This device already has data.** Merge it with your server's data,
  or replace it?" ( ) **Merge** — keep everything; nothing is dropped ( ) **Replace with your
  server's data** — this device's data is removed first (typed confirmation "replace") [Cancel]
  [Continue]. If the server is empty, no question: this device's data goes up.
- Done: Toast "Paired with home server." The Faceplate switches to §3.2; the status pill reads
  "syncing" then "reachable".

### 4.4 Revoke a device
Revoke → confirm dialog (not typed; pairing again undoes it): title "Remove Laptop · Firefox from
your server?", body "That device can no longer reach your server or use the Coach through it. Its
own copy of your data stays on it until you clear it there. You can pair it again any time."
[Cancel] [Remove device]. The row then reads "removed just now" for the session and disappears on
reload. The current device has no Revoke (it has "Forget this server").

### 4.5 Add another device (shows a code for a new device)
Opens a shown-once style block (`COMPONENTS §15.2`, variant `code`):
```
 ┌ Pair a new device ─────────────────────────────────────────┐
 │  K7QM–4XRD                         [Copy]                   │ 28/500 tabular, spaced
 │  [QR 200 px]  On the new device: open Vitals › Settings ›   │
 │               Server › Scan QR, or enter the code and the   │
 │               address https://vitals.tail1234.ts.net:8443   │
 │  Works once · expires in 9:41                               │ countdown, tabular
 │  ⬣ Anyone with this code in the next 10 minutes can pair a  │ caution mark
 │    device with your server.                                 │
 │  [Done]                                                     │
 └─────────────────────────────────────────────────────────────┘
```
When the new device pairs, the block closes by itself and the Devices list gains the row with a
1 s indicator-dot flash (none with reduced motion), and the live region says "Laptop · Firefox
paired."

### 4.6 Forget this server
Confirm dialog (not typed): title "Forget home server on this device?", body "This device stops
syncing and stops using the Coach providers, agent address and ring data that go through your
server. What is already on this device stays here. Your other devices keep working. To use the
server again, pair this device again." [Cancel] [Forget server]. After: §3.1, plus a one-time info
Notice "This device no longer uses your server. Its data is still here."

## 5. States

| State | What the page shows | Action |
|---|---|---|
| **Not paired** | §3.1 | Enter code · Scan QR |
| **Pairing in progress** | §4.3 step lines in the panel; pill "syncing" | Cancel (until the code is accepted) |
| **Paired, reachable** | §3.2; pill "reachable" | Check now |
| **Paired, syncing** | pill "syncing" with arc; "Sending 12 changes…" under the address | — |
| **Offline (this device)** | pill "offline"; "You're offline. 12 changes waiting. They'll sync when you're back." | — |
| **Unreachable** | pill "can't reach"; caution Notice "Can't reach your server. Is the computer on, and is Tailscale on here? Last sync 14:02 · 12 changes waiting. Everything still works on this device." | Try again |
| **Not a Vitals server** (on pairing) | field error under the address: "That address isn't a Vitals server." | fix address |
| **Code wrong** | field error: "That code doesn't match. Check it and try again." After 5 tries: "Too many tries. Make a new code on your server." | — |
| **Code expired** | field error: "That code has expired. Codes last 10 minutes. Make a new one on your server or a paired device." | focus returns to the code |
| **Code already used** | "That code was already used. Make a new one." | — |
| **Token revoked** (this device was removed) | pill "removed"; danger Notice at the top of the Faceplate: "This device was removed from your server. Sync, the Coach's server providers and the agent address stopped here. Your data on this device is kept." | Pair again (opens §4.1 with the address filled) |
| **Version mismatch** | caution Notice: "Your server runs 0.3.2 and this page needs 0.4.0 or later. Update the server, then check again." | Check now |
| **Server error** | "Your server answered with an error. Try again in a minute. If it keeps happening, check the server's log." | Try again |

The pill also appears in the sync pill's place in the top bar when a server is paired
(`COMPONENTS §15.3`); its popover repeats the state line and action from this table and links
"Server settings".

## 6. Copy (plain words; final strings for E27's `copy.ts`)

| Key | Text |
|---|---|
| intro | "Your server is a small program on a computer you own. It keeps your data, syncs your devices and runs the Coach." |
| introOnce | "You pair each device with it once." |
| enterCode / scan | "Enter code" / "Scan QR" |
| noServer | "No server yet? How to set one up" |
| noServerHelp | "Without a server, Vitals works on this device only; the Coach can use most providers directly." |
| addressLabel / addressHelp | "server address" / "The address your server prints when it starts." |
| codeLabel / codeHelp | "pairing code" / "Make a code on your server (vitals-server pair) or on a device that is already paired (Settings › Server › Add another device). Codes last 10 minutes." |
| nameLabel | "name this device" |
| pair / pairing | "Pair" / "Pairing…" |
| steps | "Reaching your server…" · "Checking the code…" · "Getting your data… {pct} %" |
| paired | "Paired with {name}." |
| keys | "answers now" · "last sync" · "server version" · "this device" |
| holdsTitle | "What your server holds" |
| holds | see §3.2 (three bullets + the two sentences) |
| addDevice | "Add another device" |
| forget | "Forget this server" / help "This device stops using the server. Its data stays here." |
| revoke | "Revoke" |

Never on this page: the word "Companion", "relay", "owner", "token" (say "pairing"), protocol
names other than the address itself, or any spec or plan name.

## 7. First-run variant ("Use your server?", website and installed app)

Shown once, before the intake, when this device has no data and no pairing. It matters most for
the installed app: on iPhone and iPad a Home Screen app keeps its own storage apart from Safari, so
it is a new device that needs pairing even if Safari is paired.
```
 390                                           1440 (centred card, max 560)
┌──────────────────────────────────────────┐
│ vitals•                                  │
│                                          │
│ Do you have a Vitals server?             │ 24/600 display
│ If you already use Vitals on another     │ 15 ink-2
│ device, pair this one with your server   │
│ and your data comes across.              │
│                                          │
│ [ Scan QR ]                              │ Key primary (raised, yellow dot)
│ [ Enter code ]                           │ Key default
│ [ Start on this device only ]            │ Key quiet
│                                          │
│ You can pair later in Settings › Server. │ 12 ink-2
└──────────────────────────────────────────┘
```
- Scan QR first on phones (≤ 768, the code is usually on another screen); at 1440 **Enter code** is
  the primary and Scan QR second.
- Pairing runs the §4.3 steps on this card. Server has data → "Your data is here. Opening
  Today…" → Today. Server empty → straight into the intake.
- "Start on this device only" goes to the intake; the card never returns (Settings › Server keeps
  the way back).
- Not shown when the page was opened through a pairing link (§4.2): that link pairs directly.

## 8. Accessibility

- Each Faceplate is a `section` with `h2`; the index item has `aria-current`.
- The pairing field is a `group` labelled "pairing code" with two inputs named "first 4
  characters" and "last 4 characters"; typing the 4th character moves focus; paste fills both
  (`COMPONENTS §15.1`).
- Step lines and pairing results are one polite live region; errors are linked to their field with
  `aria-describedby` and announced.
- The status pill's state is text, never colour alone; the popover is reachable by keyboard.
- The countdown in "Add another device" is announced once at 1 minute left, not every second.
- Devices list is a list; each Revoke key is named "Revoke Laptop · Firefox".
- Touch targets ≥ 44 px; contrast per tokens in both themes (§10).

## 9. Both themes

No new colours. Faceplate, well and key tokens as everywhere; the status pill uses the severity
tokens (ok green for reachable, ink arc for syncing, caution amber for can't reach / offline,
danger red for removed) with an icon and a word, checked ≥ 4.5:1 for text and ≥ 3:1 for the glyph
on `--lm-face` in light and dark. The QR is always drawn black on a white quiet zone (8 px) in
both themes so cameras read it.

## 10. Acceptance checklist

- [ ] Not paired: two plain lines explain the server and "pair each device once"; Enter code and Scan QR are the only keys; the set-up help link and the "works on this device only" line are present.
- [ ] Enter code: address + 8-character code in two groups; paste of a code or a pairing link fills both; Pair disabled until both are filled.
- [ ] Scan QR fills address and code and pairs without a second tap; camera errors fall back to Enter code with the panel open.
- [ ] A pairing link opens the page filled, offers "Pair this device", and the code is removed from the address bar at once.
- [ ] Pairing in progress shows the step lines in one live region and keeps Cancel until the code is accepted.
- [ ] Merge / Replace is asked only when both this device and the server hold data; Replace needs the typed word.
- [ ] Paired: name, address, status pill, answers now, last sync, server version, this device, Check now.
- [ ] Devices list shows name, platform, paired date, last seen; Revoke on every row but this device; revoke dialog says the data on that device stays.
- [ ] "What your server holds" lists data, keys and sign-in, ring data, and says plainly that the server can read them.
- [ ] Forget this server: dialog says this device's data stays; afterwards the not-paired state and a one-time notice.
- [ ] Add another device: code + QR + address, "works once · expires in", caution line; closes by itself when the new device pairs.
- [ ] Errors: unreachable, not a Vitals server, code wrong, too many tries, code expired, code used, device removed, version mismatch, server error — each in the §5 words with its one action.
- [ ] Device removed: data on this device kept; "Pair again" opens the code panel with the address filled.
- [ ] First-run card: shown once before the intake with no data and no pairing; Scan QR primary at ≤ 768, Enter code primary at 1440; "Start on this device only" never shows it again.
- [ ] Installed app on iPhone: the first-run card appears even when Safari is already paired.
- [ ] Layout at 390 / 768 / 1440 as §3, no horizontal scroll; the address wraps instead of overflowing.
- [ ] Both themes: pill text and glyph contrast pass; QR black on white in dark mode.
- [ ] No "Companion", "relay", "owner", "token" or internal names on screen; no control reachable by the Coach or agents.
- [ ] Keyboard only: every flow completes; focus returns to the key that opened a dialog or panel.

## 11. What the engine and server supply (proposals; reconcile with SUITE_SPEC §14)

| Need | Proposed source |
|---|---|
| Pairing | `server.pair({address, code, deviceName}) → {serverName, deviceId}` (UI only); the token stays in `secrets`, never in exports |
| Status | `server.status → {state: 'unpaired' \| 'reachable' \| 'syncing' \| 'offline' \| 'unreachable' \| 'revoked' \| 'version', name, address, version, latencyMs, lastSyncAt, pendingChanges}` |
| Devices | `server.devices → [{id, name, platform, pairedAt, lastSeenAt, current}]`; `server.revoke(id)` (UI only) |
| New device code | `server.newPairingCode → {code, link, expiresAt}` (UI only) |
| Forget | `server.forget` (UI only; local data kept) |
| What it holds | static copy; the ring line shows only when the MQTT credential exists |

## 12. Decisions & rationale

- **Pair once per device, by code or QR.** No accounts, no passwords: a short-lived code from the
  server or a paired device is the whole ceremony. The QR carries the address too, so phones need
  no typing.
- **Say plainly that the server can read the data.** Unlike the earlier scrambled-only relay, this
  server works on the data (Coach, agents, ring) while devices are off. Saying so is the honest
  trade; the person chose to run it on their own computer.
- **Revoke and Forget are not typed.** Both are undone by pairing again and neither deletes data;
  typed confirmations stay for deleting.
- **The installed app is its own device**, because on iPhone its storage is separate; the first-run
  card exists so it never silently starts empty.
