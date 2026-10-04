# Screen — Settings & data (`/settings`, anchors `#units` `#appearance` `#data` `#safety` `#about`)

> **v0.2 note (2026-10-01):** new sections Sync, Devices and streams, AI provider, Agents and the
> Install changes are in `settings-sync-ai.md`, which also lists the copy that changes here when
> sync is on (Reset becomes Erase this device / Erase everywhere).

## 1. Purpose

Everything that shapes how Vitals reads and where its data lives: units, appearance, the local data
(export, import, reset), safety answers and modes, and what the app is (version, model version,
evidence method, disclaimer, licences). Because there is no server, this screen is also the user's
only backup and restore tool — it must make that obvious and safe.

## 2. Entry points & exits

| In | Out |
|---|---|
| Rail "settings" (desktop) · top-bar icon (mobile) · overflow menu items (Export, Theme, About) · storage warnings · onboarding "Import a file" | Welcome (after reset) · onboarding screening (Review my answers) · Evidence (method) |

## 3. Layout — mobile (375 px)

```
┌──────────────────────────────────────────┐
│ ‹  Settings                              │ top bar
├──────────────────────────────────────────┤
│ [units] [appearance] [data] [safety] [ab…│ anchor chips (scroll), sticky under top bar
├──────────────────────────────────────────┤
│ ┌ Units ───────────────────────────────┐ │ Faceplate per section
│ │ body          [●metric | imperial]   │ │ rows 52 px: label left, control right
│ │ energy        [●kcal | kJ]           │ │
│ │ glucose, lipids [●mmol/L | mg/dL]    │ │
│ │ dates         [●5 Oct | Oct 5]       │ │
│ │ week starts   [●Monday | Sunday]     │ │
│ └───────────────────────────────────────┘ │
│ ┌ Appearance ──────────────────────────┐ │
│ │ theme      [●system | light | dark]  │ │
│ │ patterns in charts             [○ ]  │ │
│ │ reduce motion  [●system | on | off]  │ │
│ │ show figure                    [● ]  │ │
│ └───────────────────────────────────────┘ │
│ ┌ Your data ───────────────────────────┐ │
│ │ stored on this device only            │ │
│ │ ▕█████████░░░░░░░░░▏ 1.8 of 5 MB      │ │ storage meter
│ │ 3 scenarios · 2 plan runs · body      │ │
│ │ [ Export data ]                       │ │
│ │ [ Import a file ]                     │ │
│ │ last export: never                    │ │
│ │ ─────────────────────────────────     │ │
│ │ [ Reset everything ]   (danger key)   │ │
│ └───────────────────────────────────────┘ │
│ ┌ Safety ──────────────────────────────┐ │
│ │ mode: Standard                        │ │
│ │ [Review my answers]                   │ │
│ │ allow fasts over 24 h in plans  [○ ]  │ │
│ │ Support, any time ›                   │ │
│ └───────────────────────────────────────┘ │
│ ┌ About ───────────────────────────────┐ │
│ └───────────────────────────────────────┘ │
├──────────────────────────────────────────┤
│  body    simulate    plan    evidence    │
└──────────────────────────────────────────┘
```

## 4. Layout — desktop (1440 px)

```
┌────┬──────────────────────────────────────────────────────────────────────────────────────────────┐
│ ●  │ Settings                                                                                       │
├────┼──────────────────────────────────────────────────────────────────────────────────────────────┤
│    │ ┌ sections ─ 240 ┐  ┌ content ─────────────────────────── max 720 ─┐                           │
│    │ │ ● units         │  │ Units            (Faceplate)                 │                           │
│    │ │   appearance    │  │ Appearance                                    │                           │
│    │ │   your data     │  │ Your data                                     │                           │
│    │ │   safety        │  │ Safety                                        │                           │
│    │ │   about         │  │ About                                         │                           │
│    │ └─────────────────┘  └───────────────────────────────────────────────┘                           │
└────┴──────────────────────────────────────────────────────────────────────────────────────────────┘
 section index: sticky KeyBank (vertical), yellow indicator on the section in view
```

## 5. Regions & components

| Region | Components | Notes |
|---|---|---|
| Section index | vertical KeyBank (desktop) / anchor chips (mobile) | scroll-spy |
| Units | KeyBank rows | changes apply instantly everywhere; stored values stay metric |
| Appearance | KeyBank (theme, reduce motion), Switch (patterns, show figure) | theme writes `data-theme` |
| Your data | storage meter (Meter), Key "Export data", Key "Import a file", Key `danger` "Reset everything", Dialog (import preview, reset) | — |
| Safety | mode summary, Key "Review my answers", Switch (fasting opt-in) with acknowledgement Dialog, help card link | dossier 17 |
| About | definition list | version, model, licences |

## 6. Content & copy

**Units**: `body metric | imperial` · `energy kcal | kJ` · `glucose and lipids mmol/L | mg/dL` ·
`dates 5 Oct | Oct 5` · `week starts Monday | Sunday`.

**Appearance**
- `theme system | light | dark` — helper: "System follows your device."
- `patterns in charts` Switch — helper: "Adds hatching to bands and bars so they read without
  colour. On automatically in high-contrast mode."
- `reduce motion system | on | off`.
- `show figure` Switch — helper: "Hide the body figure everywhere and use numbers only."

**Your data**
- Line: "Stored on this device only. Nothing is sent to a server."
- Meter: `1.8 of 5 MB used` (track `--lm-well`, fill `--lm-ink`; ≥ 80 % turns caution with icon:
  "Storage is nearly full. Export and delete old scenarios to make room.").
- Contents line: "3 scenarios · 2 plan runs · body and settings".
- Key "Export data" → downloads `vitals-2026-09-30.json`; Toast "Exported vitals-2026-09-30.json ·
  1.1 MB". Caption: "last export: 30 Sep 2026" / "never" (caution tint after 30 days of edits
  without export: "Last export was 34 days ago. Browsers can clear site data.").
- Key "Import a file" → file picker (`.json`) → **Import preview** (Dialog desktop / full Sheet
  mobile):
  > **Import vitals-2026-08-12.json?**
  > Exported 12 Aug 2026 from Vitals 1.0 · 2 scenarios · 1 plan run · body (weight 86.2 kg) ·
  > settings · safety answers (Standard mode)
  > Conflicts: a scenario named "Spring cut" already exists.
  > ( ) **Merge** — keep everything; imported items get "(imported)" if names clash
  > ( ) **Replace everything** — your current data is removed first
  > [Cancel] [Import]
  Safety answers from a file are applied only after the user confirms them in the screening view.
- Import errors (InlineWarning in the Dialog, danger):
  - Not JSON / not Vitals: "This file isn't a Vitals export. It's missing the `vitalsVersion` field.
    Choose a .json file exported from Settings › Your data."
  - Newer version: "This file is from a newer Vitals (2.1). Update the app, then import again."
  - Partial/corrupt: "Part of this file couldn't be read (scenario 'Bulk' is damaged). Import the
    rest?" [Import the rest] [Cancel]
- Key `danger` "Reset everything" → Dialog:
  > **Reset everything?**
  > This deletes your body, 3 scenarios, 2 plan runs and settings from this device. It can't be
  > undone. Export first if you might want them back.
  > Type **reset** to confirm: [          ]
  > [Cancel] [Delete everything] (danger, enabled when the word matches)

**Safety**
- Mode summary: "Mode: **Standard**. The Planner can suggest deficits up to 25 % of maintenance and
  fasts up to 24 hours." (other modes per `onboarding-safety.md §6.2`).
- Key "Review my answers".
- Switch "Allow fasts over 24 hours in plans" (disabled outside Standard mode with reason) → on
  requires a Dialog: "Fasts of 24–72 hours can cause light-headedness, headaches and low energy,
  and need salt and fluid planning. Plans will include those. ☐ I understand [Allow]".
- Link "Support, any time ›" → help card.

**About**
- "Vitals 1.0.0 · model 2026.09 (research dossiers 01–19) · evidence method ›"
- "Changelog ›" (model changes listed with the metrics they affect).
- Disclaimer (full text, collapsible) — final text from dossier 17 §4.6 when available; interim:
  "Vitals simulates average physiological responses from published research. It is not a medical
  device and does not provide medical advice, diagnosis or treatment. Individual results vary. Talk
  to a qualified clinician before making significant changes to your diet, fasting or exercise,
  especially if you have a medical condition or take medication."
- Licences: "Archivo — SIL Open Font License 1.1 · Lucide icons — ISC · uPlot — MIT · d3-scale,
  d3-shape — ISC".
- Privacy: "No accounts, no analytics, no cookies. Data stays in your browser's local storage and
  IndexedDB."

## 7. Interactions

- Every control applies instantly (no Save button); a quiet "saved" engraved label flashes in the
  section header (1 s).
- Theme change cross-fades surfaces over 200 ms (none with reduced motion); charts re-read tokens.
- Unit change re-renders all numbers; open editors keep focus.
- Export uses a Blob + `download`; on iOS Safari, falls back to opening the JSON in a new tab with
  instructions ("Tap Share › Save to Files").
- Import is fully validated (schema + version) before the preview appears; nothing is written until
  "Import".
- Reset: typed confirmation, then wipe localStorage + IndexedDB, then route to `/welcome`.

## 8. States

| State | Behaviour |
|---|---|
| Storage blocked (private mode) | Caution Banner at top: "This browser isn't saving data. Everything resets when you close the tab. Export to keep your work." Export still works. |
| Storage ≥ 80 % | Meter caution + advice; ≥ 95 %: danger Banner "Vitals can't save more. Export and remove scenarios." |
| Import in progress (large file) | Dialog key shows loading ring; > 1 s shows "Reading 4.2 MB…". |
| Import success | Toast "Imported 2 scenarios and 1 plan run." + stale markers where projections are missing ("Run to see results"). |
| Never exported + ≥ 5 edits | Info chip beside "Export data": "Not backed up yet". |

## 9. Accessibility

- Sections are landmarks (`section` with `h2`); the index is a nav with `aria-current`.
- KeyBanks are radio groups with visible labels; Switches have `role="switch"`.
- Dialogs trap focus, restore it on close; the reset field has `aria-describedby` for the rule.
- Meter uses `role="meter"` with `aria-valuetext="1.8 of 5 megabytes used"`.
- Error messages are linked to their controls and announced (`role="alert"` in dialogs).

## 10. Decisions & rationale

- **Local-first honesty**: the storage meter, "last export" and "not backed up yet" exist because
  browsers can clear data and there is no server to recover from.
- **Merge vs Replace** is explicit with consequences spelled out; destructive paths need typing.
- **Imported safety answers need confirmation** so a file can't silently lift a safety mode.
- **No account, analytics or cookies** is stated as a feature, in plain words.

## 11. Batch 03: your ring through your server, and corrections (2026-10-03, design D3)

> Adds to Devices and streams (`settings-sync-ai.md §8`) and to how body data reads on Today and
> Progress (`living-mode.md`). Rules from the plan's final scope: Lumen Health is left as it is and
> sends every ring event to the person's server over MQTT; **one source of truth per record**:
> where a device feeds a stream there is no manual logging for it; a correction replaces that one
> record, is marked, can be undone and is never overwritten by a later replay from the ring
> (correction, then device, then nothing). Command and field names are proposals to reconcile with
> `docs/SUITE_SPEC.md` §14 (A4). Components: `COMPONENTS.md §15.2–15.4`.

### 11.1 Devices › "Lumen Health over MQTT" card
One Faceplate in Devices and streams, above the other device Faceplates once set up. Only shown
when a server is paired; otherwise the Devices intro gains one line: "Your ring can send its data to
your server through the Lumen Health app. Pair a server first." + **Pair a server**.

```
 390
 ┌ Lumen Health over MQTT ──────────── ● connected ┐ status pill §15.3 (connected · waiting · never)
 │ Your ring's data arrives through the Lumen Health  │
 │ app on your phone. Paste these into Lumen Health › │
 │ Broadcasting once.                                 │
 │ ────────────────────────────────────────────────── │
 │ address    ssl://vitals.tail1234.ts.net:8883 [Copy]│ in the order Lumen asks for them
 │ base topic vitals                            [Copy]│
 │ client id  lumen-pixel9                      [Copy]│
 │ username   p1-lumen                          [Copy]│
 │ password   •••••••• shown once               [Make new credentials]
 │ ────────────────────────────────────────────────── │
 │ last event   today 07:12 · sleep                   │
 │ today        sleep 1 · heart rate 412 · steps 96 · │ per stream, tabular counts
 │              blood oxygen 38 · temperature 40      │
 │ set aside    3 today · See why ›                   │ dead letters; hidden when 0
 │ ────────────────────────────────────────────────── │
 │ history      not imported yet                      │
 │ [ Import your Lumen Health history ]               │ §11.2
 │ ────────────────────────────────────────────────── │
 │ StreamMatrix (unchanged §13.15)                    │ nothing used until switched on
 └────────────────────────────────────────────────────┘
```
- **768**: key/value rows in a two-column grid (label 120, value + Copy); "today" counts as a
  small table (stream · count). **1440**: inside the 720 content column, the credentials and the
  activity block sit side by side (≥ 680 px Faceplate width), the StreamMatrix full width below.
- **First set-up** (no credential yet): the card shows the intro and **Create credentials**. Pressing
  it shows all five values in the **shown-once block** (`§15.2`, variant `credentials`):
  > ⬣ **Shown once.** Copy the password into Lumen Health now. Vitals doesn't keep a readable copy;
  > if you lose it, make new credentials.
  > [Copy all] (copies the five values as lines "address: …") · each value has its own Copy ·
  > ☐ I've pasted these into Lumen Health · [Done] (enabled when ticked)
  After Done the password reads "•••••••• shown once".
- **Make new credentials** (regenerate): confirm "Make new credentials? Lumen Health stops sending
  until you paste the new password. Nothing already received is lost; events wait on the phone and
  arrive after." [Cancel] [Make new credentials] → shown-once block again.
- **Connection state** (pill words): **connected** (the phone is connected now) · **waiting** ("last
  connected 06:40; the phone sends when it's online") · **never connected** ("Nothing has arrived
  yet. Check the values in Lumen Health and that the phone can reach your server.") · **refused**
  (caution: "Your server refused Lumen Health's login 4 times since 06:00. The password may be old;
  make new credentials.").
- **Events per stream today**: counts since local midnight, plain stream names (`streamName`),
  `—` for none; "about 1 400 events today" total when narrower than 360 px.
- **Set aside (dead letters)** → "See why" opens a sheet (bottom sheet ≤ 768, side panel 1440):
  > **Events set aside** · Your server keeps these out of your data because it couldn't read them.
  > Nothing to do unless the count keeps rising.
  | when | what | why |
  |---|---|---|
  | 07:12 | 2 events | an event type Vitals doesn't know yet |
  | 03:40 | 1 event | the event was damaged or incomplete |
  Reason words: "an event type Vitals doesn't know yet" · "the event was damaged or incomplete" ·
  "the event was too large" · "too many events at once; the phone will send them again". The sheet
  shows the last 7 days, newest first; never the event contents.
- **Per-stream switches**: the existing StreamMatrix and opt-in rule; nothing drives scores or the
  plan until switched on. The streams listed are the ones the ring has sent so far.

### 11.2 One-time history import
- Entry: the card's "history" row while no Lumen Health file import exists: **Import your Lumen
  Health history** + help "Export your events from Lumen Health and choose the file here. Do this
  once; anything that also arrived through your server is not counted twice." The key opens the
  existing import flow (§8.3) with Lumen Health events preselected.
- After: "history  imported 3 Oct · 1 Jan 2025 to 3 Oct 2026 · 41 200 records" + "undo import"
  (existing import history behaviour). The entry also stays in Data sources › Import a file.

### 11.3 Device-fed streams have no manual logging
When a stream is fed by a switched-on device ("bring in" on), the place that would offer logging
it by hand shows a **fed-by line** instead (`COMPONENTS §15.4`, variant `fed`):
```
 Today › body signals            Progress › sleep
 sleep  7 h 40 min               fed by your ring · Lumen Health · last 07:12
 fed by your ring · last 07:12   [Correct a value]
 [Correct]
```
- Wording: "fed by your ring" (or the source's kind: watch, scale…) + "· last {time}". Never a
  disabled log button.
- **Correct** opens the correction sheet: day (default the shown day) · field (e.g. "hours asleep")
  · new value with units per Settings (energy fields show kJ when the person chose kJ, e.g.
  "active energy 1 880 kJ") · optional note · [Save correction]. Help: "Your ring's value stays in
  the history. Vitals uses yours from now on, and the ring won't change it again. Undo any time."
- Streams with no device keep their normal manual logging; turning a device's "bring in" off
  brings manual logging back for that stream (existing records keep their provenance).

### 11.4 How a corrected record looks
```
 Progress › sleep, Thu 2 Oct            Today › yesterday's sleep
 6 h 0 min                              6 h 0 min
 ✎ you corrected this · Undo            ✎ you corrected this · Undo
   ring said 7 h 40 min                   (ring said 7 h 40 min)
```
- The corrected-record marker (`COMPONENTS §15.4`): 12 px pencil glyph + "you corrected this" in
  ink-2 12/500 + **Undo** quiet key; a second line "ring said {value}" in ink-3 on Progress and in
  the popover on Today. Charts draw the corrected point as a **hollow** dot (the system's "not
  measured" mark) with the same marker in its tooltip; the line passes through it.
- Undo: removes the correction; the ring's value returns; Toast "Back to your ring's value
  (7 h 40 min). Redo" (5 s). Undo stays available as long as the correction exists (not only 5 s).
- Engine, scores, the plan and the Coach read the corrected value; only the marker and the
  history show the ring's.

### 11.5 The Coach's confirmation line for a correction
A correction asked of the Coach ("I slept six hours last night, not 7:40") is an edit, so it
arrives as a ChangeCard (`COMPONENTS §13.11`) to apply:
> **Correct last night's sleep** · Thu 2 Oct · 7 h 40 min → 6 h 0 min · from your message
> [Apply] [Not now]
After Apply, the Coach's line under the card:
> "Done. Last night's sleep now reads 6 h 0 min; your ring won't change it again. Undo"
(Undo is a link-key that runs the same undo as §11.4.) The Coach never applies a correction
without the card, and never corrects a stream the person hasn't switched on.

### 11.6 States
| State | Shows |
|---|---|
| No server paired | Devices intro line + Pair a server; no MQTT card |
| Paired, no credentials | card with intro + Create credentials |
| Credentials made, never connected | "never connected" pill + the check line |
| Connected / waiting | pill + last event + counts |
| Refused logins | caution line + Make new credentials |
| Set-aside events > 0 | "set aside n today · See why" |
| Server unreachable | card values stay; pill "can't reach your server"; counts "as of 14:02" |
| Correction saved / undone | marker shown / removed; Toast with Redo |

### 11.7 Acceptance checklist (batch 03 additions)
- [ ] The MQTT card shows only with a paired server; without one, Devices shows one line and Pair a server.
- [ ] Address, base topic, client id, username and password appear in the order Lumen Health's broadcast settings ask for them, each with Copy, plus Copy all.
- [ ] The password is in a shown-once block with the "shown once" warning and a tick before Done; afterwards it reads "•••••••• shown once".
- [ ] Make new credentials warns that Lumen Health stops sending until the new password is pasted and that nothing received is lost.
- [ ] Connection state reads connected / waiting / never connected / refused, in words with a glyph.
- [ ] Last event time and stream; events per stream since midnight in plain stream names.
- [ ] Set-aside count hidden at 0; "See why" sheet lists time, count and reason words for 7 days, never event contents.
- [ ] Per-stream switches are the existing StreamMatrix; nothing drives scores or plan until switched on.
- [ ] History import entry shows until a Lumen Health file import exists; it opens the import flow preselected and says replays aren't counted twice.
- [ ] A device-fed stream shows "fed by your ring · last {time}" + Correct, never a manual log form or a disabled log key.
- [ ] Correction sheet: day, field, value in the person's units (kJ when chosen), note; help says the ring's value stays in history and won't overwrite.
- [ ] Corrected record shows "you corrected this · Undo" and "ring said …" on Progress and Today; the chart point is hollow with the marker in its tooltip.
- [ ] Undo restores the ring's value with a Redo toast; a later replay from the ring never removes a correction.
- [ ] The Coach proposes a correction as a ChangeCard and confirms with the "won't change it again · Undo" line.
- [ ] 390 / 768 / 1440 as drawn, with no overflow of addresses (they wrap at "." and ":").
- [ ] Both themes: marker, pill and set-aside reason text pass contrast; hollow chart dot visible on both chart surfaces.
- [ ] No internal names on screen ("dead letter", "CloudEvents", "QoS", "channel", plan names never appear).
