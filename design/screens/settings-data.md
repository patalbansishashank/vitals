# Screen — Settings & data (`/settings`, anchors `#units` `#appearance` `#data` `#safety` `#about`)

> **v0.2 note (2026-10-01):** new sections Sync, AI provider, Agents and the
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
| Appearance | KeyBank (reduce motion), Switch (patterns, show figure) | dark only (Ember): no theme control |
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
- Licences: "Manrope — SIL Open Font License 1.1 · Lucide icons — ISC · uPlot — MIT · d3-scale,
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

## 11. Batch 03: your ring through your server, and corrections — removed in 0.6.0 (manual-only; ring data lives in [Gauge](https://github.com/patalbansishashank/Gauge))
