# Screen — Settings v0.2: Sync, AI provider, Agents, Install, Devices and streams (`/settings/:section`)

> v0.2 (2026-10-01). Extends `settings-data.md` (Units, Appearance, Your data, Safety, About stay as
> specified there, with the copy changes in §9). Contracts: `docs/SUITE_SPEC.md` §2.6 (sync),
> §4.3–§4.6 (biometrics ingest, streams, Bluetooth), §5.1 (providers, keys, usage), §7 (Companion,
> agents). Research: sync (R7), AI providers (R8), sign-in and MCP, wearables. Components:
> `COMPONENTS.md §13.15–13.16`. Every control here is **UI-only**: neither the Coach nor any agent
> can change sync, keys, providers, stream consent or agent permissions.
> All numbers, names and dates in this spec are synthetic examples, not real data.

## 1. Purpose

Let the person decide, in plain words and with honest consequences, (a) where their data lives —
this device only, or synced through a server they control, with no account anywhere; (b) which AI
answers as their Coach, with their own key, and what it is sent; (c) which devices feed Vitals and
what each stream may be used for; (d) whether local AI agents may drive Vitals. Because there is no
Vitals server, this page is also where loss of data is explained without euphemism.

## 2. Entry points & exits

| In | Out |
|---|---|
| Rail/overflow "Settings" · sync pill → "Sync settings" · Coach "Set up a provider" · intake chapter 4 · Progress "Add a device" · agent indicator "Manage" · any `/settings/:section` deep link (`nav.open`) | the same screen it came from (back) · Coach (after a provider is ready: "Open Coach") · intake chapter 4 (add a device) |

## 3. Layout

Section index (v0.2 order): **units · appearance · your data · sync · devices and streams · AI
provider · agents · install · safety · about**. Desktop: sticky vertical KeyBank (240) + content
column (max 720). Mobile: sticky anchor chips. `/settings/:section` scrolls to that section
(aliases: `coach` → AI provider, `data-sources` and `devices` → Devices and streams). Each section is
one or more Faceplates; no nested faceplates. The mobile anchor chips use `scroll-padding-inline`
equal to the 16 px gutter so the active chip never sits under the edge (REVIEW_FINDINGS #7).

```
mobile — Sync section, sync on
┌──────────────────────────────────────────┐
│ ‹  Settings                              │
│ [units][appear…][data][●sync][devices]…  │ anchor chips
├──────────────────────────────────────────┤
│ ┌ Sync ─────────────────── synced 14:02 ┐│
│ │ ● On · vitals.tail1234.ts.net          ││ status line (state glyph + host)
│ │ 0 changes waiting · 0 files            ││
│ │ [Sync now]                             ││
│ │ ─────────────────────────────────────  ││
│ │ devices                                ││
│ │ Pixel 9 · Chrome · this device         ││
│ │ Laptop · Firefox · seen 2 h ago        ││
│ │ Companion · server · seen 5 min ago    ││
│ │ Rename this device                     ││
│ │ ─────────────────────────────────────  ││
│ │ sync key                               ││
│ │ [Show sync key]  Lost a device? ›      ││
│ │ ─────────────────────────────────────  ││
│ │ Lose every device and your 24 words,   ││ the warning stays on the page, always
│ │ and the data is gone.                  ││
│ │ [Turn off sync on this device]         ││
│ └────────────────────────────────────────┘│
```

## 4. Sync (`/settings/sync`)

### 4.1 States
| State | What the section shows |
|---|---|
| **Not available in this version** | "Sync is coming in a later update. Until then, use Export and Import in Your data to move data between devices." (no controls) |
| **Off** (default) | explainer + server address field + Test + Turn on sync / Join with a sync key (§4.2) |
| **Connecting / syncing** | status line with spinner arc; "Receiving 14.2 MB… 62 %" during a first join |
| **Synced** | §3 mock-up |
| **Offline** | "Offline · 12 changes waiting. They'll sync when you're back." |
| **Can't reach server** | caution mark: "Can't reach your sync server. Is Tailscale on? Last synced 14:02 · 37 changes waiting." [Try again] |
| **Needs permission** | caution mark: "Chrome is blocking Vitals from your local network." [How to allow it] (§4.6) |
| **Error** | the error in plain words (wrong key, server full, newer server version) + one action |

### 4.2 Turning sync on (first device)
> **Keep Vitals the same on every device — through a server you control.**
> No account, no sign-in. Your devices share one secret key; the server only ever stores
> scrambled data it can't read. The Vitals website never holds a copy.
> **You need a sync server.** The Vitals Companion can run one on a computer or home server (for
> example on your Tailscale network). How to set it up ›
> sync server address `[ wss://vitals.tail1234.ts.net             ]` [Test]
> ✓ Reached the server · Vitals Companion 0.2 · 3 ms
> [Turn on sync]  ·  Already syncing another device? [Join with a sync key]

- **Test** checks reachability before anything is created; failures say what failed ("No answer
  from that address. Is the server running and is Tailscale on?" / "That address isn't a Vitals
  sync server." / "The address must start with https:// or wss://.").
- **Turn on sync** creates the key on this device and goes straight to §4.3.
- Before the first connection to a private address, the Chrome local-network explainer shows
  (§4.6).

### 4.3 The sync key (show once, then on request)
```
 ┌ Your sync key ────────────────────────────────────────────┐
 │  1 orbit      9 velvet    17 lunar                         │ 24 words, 3 columns, numbered,
 │  2 cactus    10 hammer    18 pencil                        │ 15/500 wide; tabular numbers
 │  …                                                         │
 │  [QR code 200 px]       vitals-sync:1?u=…&s=…  [Copy]      │
 │  Hides in 0:42                                             │ countdown; hides after 60 s
 │ ────────────────────────────────────────────────────────── │
 │ ⬣ Lose every device and these 24 words, and the data is    │ danger mark, plain text
 │   gone. Vitals can't recover it: there is no account and   │
 │   no copy with us.                                         │
 │ ⬣ Anyone with these words can read and change your Vitals  │
 │   data. Keep them like a password.                         │
 │ ☐ I've saved the words (written down, printed or in a      │
 │   password manager)                                        │
 │ [Print a paper copy]   [Done] (enabled when ticked)        │
 └────────────────────────────────────────────────────────────┘
```
- After 60 s the words and QR hide behind "Hidden for privacy · [Show again]"; showing again
  restarts the 60 s and keeps the checkbox state. A **Keep showing** key stops the timer until the
  panel closes, and the countdown pauses while focus or the pointer is inside the panel (timing
  adjustable), so writing 24 words down never races the timer.
- Opened from "Show sync key" later: same panel, same 60 s hide, no checkbox.
- Optional "Protect the paper copy with a passphrase" (the printout then needs the passphrase).
- The key never appears in exports or logs; on the page the words stay hidden until "Show sync
  key" is pressed.

### 4.4 Joining (other devices)
"Join with a sync key" → **Scan the QR code** (opens the phone's camera through the photo picker —
take a picture of the code on the other device; Vitals itself never asks for camera permission) or
**Paste the words or link**. Validation is per word (BIP39 list) with the wrong word underlined.
- New device: joins and receives; progress with bytes.
- Device with data: "**This device already has data.** Merge it with the synced data, or replace
  it?" ( ) **Merge** — keep everything; nothing is dropped ( ) **Replace** — this device's data is
  removed first (typed confirmation "replace") [Cancel] [Continue].
- Each website address counts as its own device (the public site, the Companion's site, localhost)
  and is joined once; the devices list shows them separately.

### 4.5 When sync is on
- **Status** + **Sync now** (also in the sync pill). Sync runs on open, when the app becomes
  visible, when the network returns, after every change, and every 5 minutes while open. Copy never
  promises background sync: "Syncs while Vitals is open."
- **Devices** list: name, platform/browser, last seen, role (app / companion / server), "this
  device"; Rename this device.
- **Lost a device?** panel:
  > **Revoke and rotate** — the lost device can no longer send changes or fetch files. It can still
  > read what it already has. [Revoke and rotate]
  > **Make a new key** — full protection: copies everything to a new key, re-encrypts files and
  > removes the old copy from the server. About a minute per 100 MB. Every other device joins again
  > with the new words. [Make a new key…]
- **Turn off sync on this device** (destructive, typed "turn off"): "This device stops syncing. Its
  data stays here; other devices keep syncing."
- **Erase everywhere** lives in Your data (§9) next to Erase this device, with export offered
  first.

### 4.6 Chrome local-network permission
- Before the first connection to a Tailscale/LAN/localhost address (Chromium): an inline info
  Notice "Chrome will ask to let Vitals connect to devices on your local network. Allow it so Vitals
  can reach your server." [Continue].
- Denied: caution Notice "Chrome blocked the connection. Open site settings → Local network access
  → Allow, then try again." [Open instructions] [Try again]. Android Tailscale tip under "More
  help": "If the address doesn't resolve, set Android's Private DNS to Automatic."

### 4.7 Sync pill popover (from any screen)
State · "last synced 14:02" · "12 changes, 3 files waiting" · server host · [Sync now] ·
"Sync settings ›". Errors repeat the §4.1 wording and action.

## 5. AI provider (`/settings/coach`)

### 5.1 Choose a provider
Radio rows (name · how it works · one-line status):
| Row | Note shown |
|---|---|
| OpenAI | "Your API key. Billed by OpenAI, separate from a ChatGPT subscription." |
| Anthropic (Claude) | "Your API key." |
| OpenRouter | "One key for many models, including free ones." |
| Groq · Mistral · DeepSeek · Together · Google Gemini | "Your API key." |
| Ollama (on this computer) · LM Studio (on this computer) | "Free, private, runs on your computer. Simpler models can log and answer, not re-plan." |
| vLLM or another server | "Any OpenAI-compatible server you run." |
| Custom endpoint | base URL, protocol, auth, model |
| NVIDIA NIM · OpenCode Zen | "Needs the Vitals Companion (they don't accept requests from a web page)." |
| Sign in with ChatGPT | shown disabled until available: "Coming with the Vitals Companion app. It will use your ChatGPT plan instead of an API key." |

Never offered: a Claude.ai sign-in, or anything using another app's login tokens.

### 5.2 Key
- Password field with show/hide and paste; "Get a key ›" (provider's key page).
- Storage KeyBank: **remember on this device** (default) · **this session only**; optional
  Switch **Lock keys with a passkey** (feature-detected; passphrase fallback).
- Copy under the field:
  > Your key stays on this device, encrypted, and is only ever sent to {provider}. It can spend money
  > on your account: set a spending limit with {provider} (for example a monthly project limit).
  > Encryption protects against lost backups and exports; it can't protect against malicious
  > browser extensions or someone using your unlocked device.
- Changing the base URL clears the key ("Enter the key again for the new address.").
- Syncing keys to other devices: Switch "Sync this key to my devices (end-to-end encrypted)",
  default off, only when sync is on.

### 5.3 Check what the model can do
Consent first: "Check what this model can do? This sends three tiny test requests to {provider}
(about 600 tokens)." [Check] [Skip — assume from the provider's list]
Result table:
| capability | result | from |
|---|---|---|
| use Vitals' tools | ✓ | tested 15 Oct |
| several tools at once | ✓ | tested 15 Oct |
| read food photos | ✓ | tested 15 Oct |
| structured answers | ✓ | tested 15 Oct |
| streaming | ✓ | provider's list |
| memory (context) | 200 000 tokens | provider's list |
Badge: **Supported** / **Basic — logs and answers only** / **Chat only — can't use tools**.
"What this means" lines for anything missing ("No photos: the photo key is hidden in Coach.").
Re-checked after 30 days or after an unsupported-feature error.

### 5.4 Browser and local setup help (shown when needed)
- Blocked by the browser: "{provider} doesn't accept requests from a web page. Use the Vitals
  Companion, or another provider."
- Local servers, a two-step checklist: "1. Allow this site: Ollama — set OLLAMA_ORIGINS to
  https://vitals.creative.desi and restart it; LM Studio — turn on Enable CORS. 2. Allow Chrome's
  local-network prompt when it appears." [Test again]

### 5.5 Model
- Recommended list for the provider with tier words and cost: "best · Claude Sonnet 5.5 · about
  $0.12 a day of normal use" · "balanced" · "budget" · "free — may be slow or unavailable" ·
  "local — free, basic". Default = the provider's recommended "best".
- Optional **model for photos** (when the main model can't see).
- Effort KeyBank `low · medium · high` (default medium; hint: "Low is fine for logging.").

### 5.6 Coach behaviour
- Switch **Let the Coach make small plan edits without asking** — off by default (provisional,
  owner to confirm); helper: "Only moves of up to 3 days that don't add load and don't change any
  safety setting. Anything else is always a proposal you approve." (Separate from **Let the plan
  ease itself** in Plan details, which covers automatic easing from your data.)
- Monthly spending cap: Stepper (USD) + "warn at 80 %"; Switch "stop the Coach at the cap"
  (default off: warn only — provisional, owner to confirm). Usage readouts: today · 7 days · 30 days ("about $0.84 · estimated; your
  provider's bill is the truth").

### 5.7 What is sent
> The Coach sends {provider} this conversation, the results of what it looks up in Vitals, and a
> short summary of your plan and recent days. Not your name or email. Photos only in the message
> you attach them to. Body signals only as you chose in Devices and streams. [See what the Coach
> knows ›]

### 5.8 States
| State | Behaviour |
|---|---|
| None set | "No AI provider. The Coach is off; everything else works and you can log by hand." |
| Key refused | danger InlineWarning under the key: "{provider} refused this key. Check it and try again." |
| Model not found | "That model isn't available on your account. Choose another." |
| Offline | "Can't check now — you're offline." (key is saved, unchecked) |
| Usage at cap | caution Notice "You've reached this month's cap ($10). The Coach is paused." [Raise the cap] / or warning only when stopping is off |

## 6. Agents (`/settings/agents`)
- Switch **Let AI agents on this computer use Vitals** (WebMCP; default off) + explainer "Agents
  like Claude Desktop or Codex can then do what the Coach does, through a small relay on your
  computer, while a Vitals tab is open." Config snippets (Claude Desktop/Code, Codex, other) with
  Copy.
- Per-client Switch "may apply plan edits directly" (default off; edits otherwise wait in Coach).
- **Activity**: every change made by the Coach or an agent as ChangeCards, newest first, with Undo
  where still available.
- Tool list fingerprint (engraved, for support): "tool list 3f9a…".
- The top-bar indicator "An agent is using Vitals · Stop" links here.

## 7. Install (exists — `src/app/pwa/InstallSection.tsx`)
Keep the built section; v0.2 changes:
- Add **install** to the section index (between agents and safety).
- Copy when sync is on: "Opens in its own window with its own icon. Your data stays on your
  devices either way." (was "on this device").
- Update notice copy when sync is on: "Reloading applies the new version. Your data is kept."
- Offline line adds, when sync is on: "Changes made offline sync when you're back online."
- The update notice also shows on `/welcome` (currently missing).

## 8. Devices and streams (`/settings/devices`, `/settings/data-sources`)

### 8.1 Devices
One Faceplate per source:
```
 ┌ Colmi R10 ring ─────────────────────────────── tier C ┐
 │ connects directly · last data today 07:12              │
 │ sleep · heart rate · steps · SpO2                      │
 │ [Sync now]  (Chrome, while Vitals is open)             │
 │ StreamMatrix for this device's streams                 │
 │ Remove this device…                                    │
 └────────────────────────────────────────────────────────┘
```
- Tier words: "tier A · checked against medical devices" · "tier B · partly checked" · "tier C ·
  not independently checked — heart-rate variability, autonomic load, SpO2 and temperature are
  shown only as change from your own normal".
- **Add a device** → the intake chapter 4 flow in a panel.
- **Remove this device…** (destructive, typed "remove"): "Deletes this device's data from Vitals
  (and from your synced devices). Your logs and plan stay." Scores rebuild without it.
- A new device starts a new normal range: "Your normal range restarts with this ring; the old one
  stays visible, joined by a dashed line."

### 8.2 Streams
- The StreamMatrix (`COMPONENTS §13.15`), one per device plus **vendor scores** (off by default;
  shown as "{vendor} says …", never used by scores, plan or adherence).
- **Which source wins** (per metric, when two devices report it): ordered list with drag handles
  ("sleep: Oura ring ▸ Apple Watch"); copy "Vitals never averages devices; it uses the first one
  that has data that day."

### 8.3 Data sources (imports and helpers)
- **Import a file**: Apple Health export (.zip), Health Connect export, Health Auto Export (JSON),
  Gadgetbridge database, Vitals biometrics file (JSON/CSV), Lumen Health events — with "how to get
  this file" per format. Import runs in the background with progress and ends with the report
  ("182 days · 31 400 records · 112 duplicates skipped · sleep, heart rate, HRV, steps").
- **Import history**: date · source · days covered · [undo import] (removes that batch).
- **Phone helper** (when available): the Vitals Bridge app (Android) or the iPhone Shortcut — a QR
  code to pair, explained as "sends your phone's health data to this Vitals, nowhere else".
- **Companion receiver**: shows when a Companion is paired: "Your Companion can receive data from
  your phone and pull from services that need a server." (no vendor accounts are connected from the
  web page itself).
- Limits stated once: "A web page can't read Apple Health or Health Connect directly or sync in the
  background. Import files, use a helper app, or connect an open ring with Chrome."

## 9. Copy changes elsewhere in Settings (and the app) when sync is on
| Where | v0.1 | v0.2 with sync on |
|---|---|---|
| Your data line | "Stored on this device only. Nothing is sent to a server." | "Stored on your devices and your sync server (scrambled; the server can't read it). Nothing is sent to Vitals." |
| Reset | "Reset everything" (type "reset") | **Erase this device** (type "erase") · **Erase everywhere** (type "erase everywhere"; also deletes the server copy) — both offer Export first |
| About › privacy | "Data stays in your browser's local storage and IndexedDB." | "Data stays on your devices. With sync, encrypted copies go to your own server. With the Coach, the conversation goes to the AI provider you chose." |
| Body context bar | "saved on this device" | "saved" + sync pill |
| Install | see §7 | |

### 9.1 Appearance additions
- **figure drawing** KeyBank `detailed (3D) · simple` (default detailed; falls back automatically —
  `body-figure-v2.md §5.3`). When the browser can't draw 3D: "simple (this browser)", disabled
  detailed key with the reason.

## 10. Accessibility
- Each section is a landmark with `h2`; the index has `aria-current`.
- The 24 words are an ordered list; the countdown is announced once at 10 s ("Sync key hides in 10
  seconds"); the QR has the link as its text alternative (hidden with the words).
- Key fields: `autocomplete="off"`, a show/hide toggle with `aria-pressed`, errors linked with
  `aria-describedby`.
- Capability results are a table; badges are text.
- StreamMatrix: a table with headers; disabled cells explain why.
- Typed confirmations explain the word in `aria-describedby`.

## 11. What the engine supplies
| Need | Source |
|---|---|
| Sync | `sync.status` → `SyncStatus {state, lastSyncedAt, pendingChanges, pendingBlobs, lastError, endpoint}`; `sync.now`; `sync.configure`, `sync.pair` → `PairingCode {uri, words[24]}`, `sync.join (onExisting → merge \| replace)`, `sync.rotate`, `sync.unpair`; `devices` collection; re-key flow (adapter `rekey`) |
| Providers | `ai.configure` (UI only) with presets `{id, label, adapter, baseUrl, authHeader, browserDirect, keyHelpUrl, defaultModel, recommendedModels, corsFixText, price}`; `listModels()`, `probe(model)` → `Capabilities {tools, parallelTools, strictTools, vision, maxImages, jsonSchema, jsonObject, reasoning, streaming, streamUsage, contextTokens, maxOutput, browserDirect, verifiedAt, source}`; errors by kind (`auth`, `quota`, `rate_limited`, `context_length`, `unsupported_param`, `cors`, `network`, `server`, `refusal`, `usage_limit`); `ai.usage` |
| Agents | `agents.configure`; activity = ChangeCards from `changeLog`; tool-list hash |
| Devices | `bio.sources` → sources with tier, channel, last data, `StreamPolicy[]`; `bio.setPolicy`, `bio.setSourcePriority`, `bio.import` (job) → `IngestReport`, `bio.deviceConnect` / `bio.deviceSync` (user gesture), `bio.deleteSource` (typed confirmation) |
| Storage | `data.usage` (per collection, quota) |

## 12. Decisions & rationale
- **The data-loss sentence is permanent page furniture**, not a one-time modal: "Lose every device
  and these 24 words, and the data is gone." It is the truest thing about a no-account design.
- **Test before create.** The server address is checked before a key exists, so nobody writes down
  24 words for a server that isn't there.
- **Keys, sync and consent are UI-only.** The Coach can explain them and link here; it can never
  flip them.
- **Capability checks need consent and show provenance** ("tested 15 Oct" vs "provider's list"),
  because a check spends the person's tokens and a list can be wrong.
- **Sign in with ChatGPT is visible but honest.** It appears as "coming with the Companion" rather
  than a button that cannot work on a hosted page.

## 13. Batch 03: with your server (2026-10-03, design D3)

> The server on the person's own computer (`server.md`) replaces the Vitals Companion. This
> section supersedes, where they disagree: §5.1 (the last two rows), §5.4 (Companion lines), §6
> (Companion card) and §7. Names of commands and fields are proposals to reconcile with
> `docs/SUITE_SPEC.md` §14 (A4). Components: `COMPONENTS.md §15`. Layout widths as §3: 390 anchor
> chips and full-width keys; 768 content max 720 with keys side by side; 1440 KeyBank index 240 +
> content 720. Both themes use existing tokens only.

### 13.1 Sync when a server is paired
The Sync section keeps its states (§4.1) but no longer asks for an address: the address comes from
the pairing. Paired: status line "● On · through home server" + "Sync now" + "Server settings ›";
the devices list moves to Server › Devices (one list, not two). Not paired: one line "Sync needs
your server. Pair this device in Server." + **Pair a server** (→ `/settings/server`). The 24-word
sync key panel (§4.3) stays only if A4 keeps an end-to-end key between devices and server; if the
server holds the person's data readable (as `server.md §3.2` says), the panel and its loss warning
are removed rather than kept as decoration. Open until §14 lands.

### 13.2 AI provider rows "via your server"
The three providers that a web page cannot call are listed again as normal rows, grouped at the
end of the list under an engraved label **via your server**:

| Row | Note | State chip (right, `COMPONENTS §15.3` small, text only) |
|---|---|---|
| Sign in with ChatGPT | "Uses your ChatGPT plan instead of an API key. Your server signs in and sends the requests." | needs your server · not signed in · signed in · sign-in expired |
| OpenCode Zen | "Your OpenCode Zen key, kept on your server. The free tier only works inside OpenCode, so a paid key is needed here." | needs your server · no key · key set |
| NVIDIA NIM | "Your NVIDIA key, kept on your server." | needs your server · no key · key set |

```
 390                                        
 ┌ AI provider ───────────────────────────┐
 │ ( ) OpenAI                              │
 │ ( ) Anthropic (Claude)                  │
 │ …                                       │
 │ via your server                         │ engraved label 11/600 ink-3, hairline above
 │ (●) Sign in with ChatGPT   signed in    │ chip right-aligned, wraps under the name < 360
 │     Uses your ChatGPT plan instead …    │
 │ ( ) OpenCode Zen           key set      │
 │ ( ) NVIDIA NIM             needs your   │
 │                            server       │
 └─────────────────────────────────────────┘
```
- **Not paired**: the rows stay selectable (so the person can read about them) but choosing one
  shows, in place of the key and model blocks: "This provider works through your server. Pair this
  device with your server first." + **Pair a server**. Save provider is disabled with that reason.
- **Key for Zen and NIM**: the key field is the §5.2 field with different words: "Your key is sent
  once to your server, kept there encrypted, and only ever sent to {provider}. It never stays in
  this browser. It can spend money on your account: set a spending limit with {provider}." After
  saving: "key set on your server · ends …4f2a" + **Replace key** + **Remove key** (remove asks:
  "Remove the {provider} key from your server? Every device stops using it."). The "remember on
  this device / this session only" bank and the passkey lock do not apply and are hidden.
- **Load models** and **Test connection** keep their keys, words and result table (§5.3); they go
  through the server. Their errors replace every Companion line:
  - can't reach: "Couldn't reach your server. Check that it is on, then try again."
  - not signed in (ChatGPT): "Sign in with ChatGPT first."
  - no key: "Add your {provider} key first."
  - provider refused: the §5.8 words, with "{provider}" (the server only passes the answer on).
- **Usage and cap** (§5.6) for these rows read "counted by your server for all your devices".

### 13.3 Sign in with ChatGPT, started here, finished on the server
The sign-in tokens live only on the server; the browser never sees them. What the person sees,
inside the ChatGPT row's block (no new page):
```
 step 1  [ Sign in with ChatGPT ]
 step 2  Open this page and sign in to ChatGPT:
         https://auth.openai.com/…      [Open] [Copy]
         Then enter this code there:  ABCD-1234   [Copy]       ← only if the flow uses a code
         Waiting for ChatGPT… (this page updates by itself)      ← loading ring, live region
         [Cancel]
 step 3  ✓ Signed in as a…@example.com · Plus plan              ← account and plan when the server knows them
         [Test connection]   Manage usage ›   [Sign out]
```
- Step 2 opens the sign-in page in a new tab; the panel polls the server and moves to step 3 by
  itself; leaving and coming back keeps the step (the server holds the state for 10 minutes).
- Which exact sign-in OpenAI allows from a server (a code entered on OpenAI's page, or pasting
  back the address the browser lands on) is being checked (research R18); the panel is designed
  for both. Paste-back variant, step 2 reads: "After signing in, your browser shows a page that
  doesn't load. Copy its full address and paste it here." [ address field ] [Finish sign-in].
- Errors: "Sign-in timed out. Start again." · "ChatGPT didn't accept the sign-in. Start again." ·
  "Your server couldn't reach ChatGPT. Check its internet connection." · sign-in expired later:
  chip "sign-in expired" + "Sign in again".
- Sign out: "Sign out of ChatGPT on your server? Every device stops using your ChatGPT plan."
- On screen nowhere: the word "token", the server's command line, or any Companion step.

### 13.4 Agents with the server (replaces the Companion card in §6)
Order in the Agents section: intro and rules (unchanged copy) · **agents in this browser**
(WebMCP switch, unchanged) · **agents on your other computers** (new card) · direct plan changes ·
Activity.

```
 ┌ agents on your other computers ──────────────────────────┐
 │ Agents such as Codex, OpenCode, Claude Code or ChatGPT    │
 │ can use Vitals through your server, even when no Vitals   │
 │ tab is open. Plan changes still wait for you.             │
 │ address   https://vitals.tail1234.ts.net:8443/mcp [Copy]  │ tabular, wraps at "/"
 │ ─────────────────────────────────────────────────────────│
 │ [ Make an agent key ]                                     │
 │ ─────────────────────────────────────────────────────────│
 │ keys                                                      │
 │ Codex on laptop · made 3 Oct · used 10 min ago [Revoke]   │
 │ Claude Code · made 3 Oct · never used          [Revoke]   │
 └───────────────────────────────────────────────────────────┘
```
- **Make an agent key** → a name field ("which agent and where, e.g. Codex on laptop") → the
  shown-once block (`COMPONENTS §15.2`) with the key, Copy, and the recipes below, each a one-line
  command or snippet with its own Copy key. The key is part of the copied text, so nothing has to
  be typed by hand. Closing the block hides the key for good; the row stays in the list.
- **Recipes** (one line each; the exact syntax is verified against each agent's current docs by
  E26/R18 before shipping, so the strings below are placeholders in shape, not final):

| Agent | Line shown |
|---|---|
| Codex | "In `~/.codex/config.toml`, add a server `vitals` with this address and the key as a bearer token." + snippet |
| OpenCode | "In `opencode.json`, add a remote MCP server `vitals` with this address and an Authorization header." + snippet |
| Claude Code | "Run in a terminal:" + `claude mcp add --transport http vitals <address> --header "Authorization: Bearer <key>"` |
| ChatGPT desktop | "Add a connector with this address. ChatGPT needs the address to be reachable from the internet." (steps from R18; shown only if R18 finds a way that works with a key) |

- Not paired: the card shows "Agents on other computers reach Vitals through your server. Pair
  this device with your server first." + **Pair a server**.
- Revoke: "Revoke Codex on laptop? That agent can no longer use Vitals." (not typed).
- Removed from the page: the Companion heading and intro, Look for the Companion, address,
  8-digit pairing code, Tailscale rows, "agent apps on this computer", the `vitals-companion …`
  commands, and the Coach-providers list inside Agents (it lives in AI provider now).

### 13.5 Install: "Install on this device" + "Your server" (replaces §7)
The Install section has two blocks separated by a hairline:
1. **Install on this device** — the existing rows (install, offline, update) and their copy; with
   a server paired the "synced" variants of the copy are used ("Your data stays on your devices
   and your server either way.").
2. **Your server** — one status line and one key, never install steps:
   - paired: "● reachable · home server · 0.4.0" + **Server settings**
   - not paired: "Vitals can work with a server on a computer you own: it syncs your devices,
     runs the Coach for every device and receives your ring's data." + **Pair a server** + "How to
     set one up ›" (help page).
   - server older than this page: "Your server runs 0.3.2; this page needs 0.4.0. Update the
     server." (no key; the server is updated on the server).

### 13.6 States added
| Where | State | Shows |
|---|---|---|
| AI provider | server row chosen, not paired | §13.2 not-paired block |
| AI provider | server unreachable | caution line under the row: "Your server isn't answering, so the Coach can't use {provider} right now." |
| AI provider | ChatGPT sign-in in progress | §13.3 step 2 |
| Agents | key just made | shown-once block |
| Agents | server unreachable | card stays; keys list greyed with "Can't reach your server · last checked 14:02" |
| Install | not paired / paired / older server | §13.5 |

### 13.7 Acceptance checklist (batch 03 additions)
- [ ] Sync section without a server shows only "Sync needs your server" + Pair a server; paired shows "On · through {server}" and no address field.
- [ ] The three providers appear under "via your server" with their note and a text state chip (needs your server / not signed in / signed in / sign-in expired / no key / key set).
- [ ] Choosing a server provider while not paired shows the pair prompt in place of key and model; Save is disabled with the reason.
- [ ] Zen and NIM key field says the key goes to the server once and never stays in this browser; the storage bank and passkey lock are hidden for them.
- [ ] Load models and Test connection work through the server; every error says "your server" and never "Companion".
- [ ] Sign in with ChatGPT: step 1 → step 2 (open/copy, code when used, waiting line) → step 3 (signed in, account, Test connection, Sign out) with no page change; both sign-in variants designed; errors in plain words.
- [ ] Sign out warns that every device stops using the plan.
- [ ] Agents: address with Copy; Make an agent key → name → shown-once key with Copy and one-line recipes for Codex, OpenCode, Claude Code, ChatGPT desktop; keys list with made/used and Revoke.
- [ ] Recipes are checked against each agent's current docs before release; no recipe ships unverified.
- [ ] No Companion card, pairing code, Tailscale rows or `vitals-companion` commands remain in Agents or AI provider.
- [ ] Install has "Install on this device" (existing rows) and "Your server" (status + Server settings, or Pair a server + help link).
- [ ] All of the above at 390 / 768 / 1440 with no overlap of chips and names; chips wrap under the name below 360 px row width.
- [ ] Both themes: state chips are text with severity glyphs and pass contrast.
- [ ] None of these controls is reachable by the Coach or agents; no internal names on screen.
