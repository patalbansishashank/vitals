# Vitals — Information Architecture

> Routes, navigation, objects and end-to-end flows. Visual rules live in `DESIGN_DIRECTION.md`;
> per-screen layouts in `screens/`. Router: React Router (data router, hash-free paths; Netlify
> `_redirects`: `/* /index.html 200`).
>
> **v0.2 (2026-10-01).** Vitals gains a second shape. Sections **§1.1, §2.1, §3.4–§3.7, §4.6–§4.14,
> §5.1 and §6.1** describe the two modes (Planning and Living), the new objects and routes, and the
> daily loop. Where v0.2 text and v0.1 text disagree, v0.2 wins. Engineering contracts behind this
> document: `docs/SUITE_SPEC.md` §6 (modes, routes), §3 (plan lifecycle, log, adherence, drift),
> §5 (AI change review), and `docs/PLANNER_V2_SPEC.md` §9.5 (the ladder). Screen specs:
> `screens/living-mode.md`, `screens/plan-ladder.md`, `screens/onboarding-intake-v2.md`,
> `screens/body-figure-v2.md`, `screens/settings-sync-ai.md`, `screens/scores.md`.
> `REVIEW_FINDINGS.md` still wins over every design document, v0.1 or v0.2.

---

## 1. Objects the user works with

| Object | What it is | Cardinality | Lives in |
|---|---|---|---|
| **Body** | sex, age, height, weight, shape (avatar parameters), waist, training history, activity, sleep | exactly 1 (current) + dated snapshots | Your body |
| **Program** | a reusable day configuration (energy, macros, meals & window, exercise, sleep, modifiers) shown as a lettered key | many per scenario (A–Z) | Simulator |
| **Scenario** | start date + horizon + a day→program map + per-day overrides + body snapshot | many; one active | Simulator |
| **Projection** | the engine output for a scenario (daily + hourly series, events, warnings) | 1 per scenario, cached; marked *stale* when inputs change | Simulator results |
| **Goal set** | ranked goals + horizon + constraints | 1 active (+ history) | Planner |
| **Plan** | an optimiser result: phases, day prescriptions, projection, scorecard | 2–3 per run | Planner results |
| **Mechanism** | an evidence entry: statement, equation, parameters, grade, citations, linked metrics | ~60–120, static | Evidence |
| **Metric** | an outcome channel: id, name, unit, category, grade, overlay transform | ~40, static catalogue | everywhere |

A **plan** becomes a **scenario** when opened in the Simulator (copied, not linked — editing it
does not change the plan; the scenario shows "from Plan B · 12 Oct" as provenance).

### 1.1 Objects added in v0.2

| Object | What it is | Cardinality | Lives in |
|---|---|---|---|
| **Intake** | answers about a normal day, training and equipment, food and kitchen, supplements, devices; each section can be "ask me later" | 1, sectioned | onboarding, Body › "Your setup", Coach |
| **Plan rung** | one plan of the ladder: **Hard · Medium · Easy** (inside your limits) and **Ideal** (no practical limits, safety still applies) | 3 + 1 per planner run | Plan › results |
| **Active plan** | a started rung or scenario, anchored to the calendar: scheduled → active ⇄ paused → ended | at most 1 at a time (+ ended history) | Living mode |
| **Plan version** | an immutable revision of the active plan (start, light, weekly, event, coach, user) with its forecast and diff | many per active plan | Progress › plan, `/plan/active/versions/:n` |
| **Prescription** | what a calendar day asks: meals and targets, window, sessions on your equipment, fast, steps, sleep, supplements; frozen when the day begins | 1 per day | Today, Food, Train |
| **Log entry** | what happened: meal, session, fast, steps, sleep, substance, supplement, how-hard-was-today, event, note; append-only with a source (you, Coach, device, import) and an uncertainty band | many per day | Today, Food, Train, Progress |
| **Measurement** | scale weight, girths, body-fat readings, blood pressure, ketones, glucose, labs | many | Progress › Body |
| **Adherence score** | 0–100 per day: how much of the day's goal value you kept, weighted by what each item contributes; coverage shown | 1 per scored day + 7 / 28-day trends | Today, Progress |
| **Drift** | ahead / on track / behind, with the goal date as a range and the likely cause | 1 per goal per check-in | Today card, Progress |
| **Biometric record** | a day of device data (sleep, heart rate, HRV, SpO2, skin temperature, steps, workouts, weight) with source and quality | 1 per day per source | Progress › Body signals |
| **Score** | a Vitals-computed number from raw data (sleep, HRV status, resting HR, VO2 max, load, flags, readiness index), versioned and graded | many, rescored on new versions | Progress › Body signals |
| **Conversation** | the Coach thread, segmented by days; change cards inside | 1 continuous (+ onboarding) | Coach |
| **Change** | a reviewable result of an AI (or agent) action: applied with Undo, proposed with Apply/Discard, or awaiting your typed confirmation | many | Coach, Today, Settings › Agents |
| **Stream policy** | per device stream: bring in · use in scores · use in my plan · what the Coach can see | 1 per stream | onboarding › devices, Settings › Devices |
| **Pairing** | the 24-word key that joins this device to your sync relay | 0–1 | Settings › Sync |

A **rung** becomes the **active plan** only through "Start this plan" (copied and frozen at start;
the planner run stays a reference). A Simulator **scenario** can also be started ("custom" plan).
The **Ideal** is never started as it is: it is a reference that tells you which of your limits
cost the most.

---

## 2. Routes

| Path | Screen | Spec | Notes |
|---|---|---|---|
| `/` | redirect | — | first run → `/welcome`; else → last visited top-level route |
| `/welcome` | Welcome + safety screening + disclaimer | `onboarding-safety.md` | 3 steps: `?step=intro\|screening\|consent` |
| `/body` | Your body | `your-body.md` | sections as anchors: `#basics`, `#shape`, `#habits` |
| `/simulate` | redirect | — | → `/simulate/:activeScenarioId/schedule` (creates a blank scenario if none) |
| `/simulate/:sid/schedule` | Schedule builder | `simulator-schedule.md` | `?day=2026-10-14` opens the day editor |
| `/simulate/:sid/results` | Results | `simulator-results.md` | view state in query: `?view=lanes\|overlay\|focus&m=fat_mass,ketones&z=2026-10-01..2026-10-28&explain=ketones` |
| `/plan` | redirect | — | → `/plan/goals` or `/plan/results` if a finished run exists |
| `/plan/goals` | Goals & constraints | `planner-goals.md` | |
| `/plan/run` | Optimiser progress | `planner-goals.md §States` | not directly navigable; returns to goals if no run is active |
| `/plan/results` | Plans A/B/C compared | `planner-results.md` | `?plan=b&tab=overview\|days\|curves\|safety` |
| `/evidence` | Library index | `evidence-library.md` | `?q=ketosis&cat=fuel&grade=A,B` |
| `/evidence/:mechanismId` | Mechanism page | `evidence-library.md` | `#citations`, `#parameters` |
| `/settings` | Settings & data | `settings-data.md` | `#units`, `#appearance`, `#data`, `#safety`, `#about` |
| `*` | Not found | — | "This page doesn't exist. Your data is safe." + link to Simulate |

Query-string state is **replace**-navigated (no history spam) except `view` and `explain`, which
push, so the back gesture closes the Explain drawer and returns to the previous view.

### 2.1 Routes added or changed in v0.2

| Path | Screen | Spec | Notes |
|---|---|---|---|
| `/` | redirect | — | Living mode → `/today`; Planning mode → last Planning route (v0.1 rule) |
| `/onboarding/:section` | Intake (`activity`, `training`, `diet`, `kitchen`, `supplements`, `devices`) | `onboarding-intake-v2.md` | `?from=setup` during first run; `?from=body` from "Your setup"; also driven by the Coach |
| `/onboarding/summary` | "What we'll use" summary + maintenance result | `onboarding-intake-v2.md §6.6` | end of first run, before *Choose a start* |
| `/body` | Your body (figure v2) | `your-body.md` + `body-figure-v2.md` | `#figure`, `#visceral`, `#shape`, `#setup` |
| `/plan/results` | The ladder (Hard · Medium · Easy ‖ Ideal) | `plan-ladder.md` | `?rung=easy\|medium\|hard\|ideal&tab=overview\|days\|curves\|safety\|limits` (replaces `?plan=a\|b\|c`; old links map a→hard, b→medium, c→easy) |
| `/plan/active` | Active plan detail: versions, diffs, proposals, pause, end | `living-mode.md §9` | `/plan/active/versions/:n` for one version |
| `/today`, `/today/:date` | Today | `living-mode.md §4` | past dates are read and backfill views; future dates read-only previews |
| `/food`, `/food/:date` | Food: meals, recipes, groceries, supplements | `living-mode.md §5` | `#meals`, `#groceries`, `#supplements`; `?recipe=:slot` opens the recipe sheet |
| `/train`, `/train/:date` | Train: sessions, swaps, equipment, things to buy | `living-mode.md §6` | `#session`, `#equipment`, `#buy`; `?swap=:slotKey` opens the swap sheet |
| `/coach`, `/coach/:conversationId` | Coach | `living-mode.md §7` | `?briefing=1` opens "What the Coach knows"; in Planning mode opened from the top bar |
| `/progress`, `/progress/:metric` | Progress | `living-mode.md §8` | `#trend`, `#goals`, `#adherence`, `#body`, `#signals`, `#log`, `#checkins`, `#plan`; `:metric` may be a score id (`/progress/hrv.status`) → `scores.md` detail |
| `/settings/:section` | Settings, scrolled to a section | `settings-data.md` + `settings-sync-ai.md` | `units`, `appearance`, `data`, `sync`, `devices`, `data-sources`, `coach` (AI provider), `agents`, `install`, `safety`, `about`; `#section` anchors still work |

`nav.open` (the command the Coach and agents use) accepts only these route ids. **Requested
additions** to the suite's route table (`docs/SUITE_SPEC.md §6.2`): `/settings/{units, appearance,
install, safety, about}` and `/onboarding/summary`.

Without an active plan: `/today`, `/food` and `/train` redirect to `/plan` with a one-line notice
("Start a plan to use Today."); `/coach` works in both modes; `/progress` works without a plan and
shows only Body, Body signals and Log (reachable from Body › "Signals and measurements" and from
Settings › Devices and streams).

---

## 3. Navigation model

Four destinations, one secondary. The order is the user's journey: set the instrument (Body),
play it (Simulate), let it play for you (Plan), check its calibration (Evidence).

| # | Destination | Icon (Lucide / authored) | Label |
|---|---|---|---|
| 1 | Your body | `avatar-front` (authored) | Body |
| 2 | Simulator | `audio-waveform`-style channel glyph (authored "channels") | Simulate |
| 3 | Planner | `route` | Plan |
| 4 | Evidence | `book-open-text` | Evidence |
| — | Settings | `settings-2` | Settings |

### 3.1 Mobile (< 768 px) and tablet (768–1023 px)

```
┌──────────────────────────────┐  top bar 56 px (sticky, chassis-2)
│ ‹  Spring cut ▾        ⋯     │  context title (scenario / screen), overflow menu
├──────────────────────────────┤
│                              │
│         screen content       │  16 px gutters; single column (<768)
│                              │  two columns where the spec says (768–1023)
│                              │
├──────────────────────────────┤  contextual action bar (only where needed),
│  Painting: B Rest day  [Run●]│  sits above the tab bar, 56 px
├──────────────────────────────┤
│ Body  Simulate  Plan Evidence│  tab bar 64 px + safe-area; key-bank style:
└──────────────────────────────┘  selected tab = pressed key + yellow dot
```

- **Tab bar**: 4 equal keys, icon 20 px over lowercase label 11 px. Selected = ink icon + yellow
  6 px indicator dot above the icon; the tab surface is chassis-2. Hidden while the on-screen
  keyboard is open and while a bottom sheet is at full height.
- **Top bar**: left = back chevron (only on nested routes: day editor, mechanism page) or the
  `vitals` wordmark on top-level screens; centre-left = context title; right = overflow `⋯`
  (Settings, Export, Theme, About). On Simulator screens the context title is the **scenario
  switcher** (tap → sheet listing scenarios, "New scenario", "Duplicate", "Rename").
- **Sub-navigation inside Simulate**: a two-key segmented control under the top bar —
  `schedule | results` — with a stale dot on *results* when inputs changed since the last run.
- **Sheets, not pages**, for: day editor, metric picker, Explain, scenario switcher, filters.
  Sheets have three detents: peek (35 %), half (60 %), full (92 %); drag handle 36 × 4 px.
- Tablet (768–1023) keeps the tab bar but uses the wider canvas: day editor becomes a right
  panel at ≥ 900 px, results show metric picker as a sheet.

### 3.2 Desktop (≥ 1024 px)

```
┌────┬─────────────────────────────────────────────────────────────┐
│ ●  │ Spring cut ▾   schedule | results      12 wk  1 Oct → 24 Dec  (Run●) │ context bar 56 px
│vitals├───────────────────────────────────────────────────────────┤
│    │                                                             │
│ ▣  │                                                             │
│Body│                   screen content                            │
│ ▤  │                   (max 1440, 24 px gutters)                 │
│Sim │                                                             │
│ ⤳  │                                                             │
│Plan│                                                             │
│ ▯  │                                                             │
│Evid│                                                             │
│    │                                                             │
│ ⚙  │                                                             │
│ ◐  │                                                             │
└────┴─────────────────────────────────────────────────────────────┘
 rail 76 px (chassis-2): wordmark dot, 4 destination keys, spacer, settings, theme toggle
```

- **Rail**: vertical key bank. Each key 60 × 56 px: icon + lowercase label. Selected = pressed
  key (well fill, inset shadow) + yellow indicator dot at the key's left edge. Tooltips not
  needed (labels are visible). `Ctrl/⌘ + 1…4` jump to destinations.
- **Context bar** (per screen, sticky): title/switcher, local tabs, key parameters, and the one
  primary action at the far right. The Run key lives here on Simulator screens, **Find plans**
  on Planner goals.
- **Panels instead of sheets**: day editor docks right (392 px) on schedule; metric picker docks
  left (280 px, collapsible) and Explain docks right (392 px) on results.
- **Command palette** `⌘K`: jump to any metric ("show ketones"), mechanism, scenario or
  action ("copy week 3 to weeks 4–6"). Optional in v1; reserve the shortcut.

### 3.3 Global elements

- **Safety status chip**: if screening flagged a condition, a persistent chip in the context bar
  "Safety mode: pregnancy" (info style). Tap → explanation + edit screening. See
  `onboarding-safety.md`.
- **Disclaimer line**: one-line footer on every results surface (Simulator results, Planner
  results): "Projections for an average person with your inputs. Not medical advice." + link.
- **Stale indicator**: when a scenario changes after a run, results show a caution-neutral
  (info) bar "Schedule changed since this run · Run again" and the curves drop to 40 % opacity.
- **Toasts** only confirm background completions and undoable actions ("Week 3 copied to weeks
  4–6 · Undo"). Bottom-centre on mobile above the tab bar; bottom-left on desktop.
- **Undo**: every edit in the schedule and goals is undoable (`⌘Z` / `⇧⌘Z`, 50 steps, per
  scenario). The toast offers Undo for bulk actions.

### 3.4 Two modes (v0.2): Planning and Living

Vitals has two shapes. The mode is **derived, never toggled freely**: it follows from whether a plan
is scheduled, active or paused (`docs/SUITE_SPEC.md §6.1`).

| | Planning (no plan running, or "planning tools" opened) | Living (a plan is scheduled, active or paused) |
|---|---|---|
| Question it answers | "What should I do, and what would happen?" | "What do I do today, and is it working?" |
| Destinations | Body · Simulate · Plan · Evidence | **Today** (home) · **Food** · **Train** · **Coach** · **Progress** |
| Secondary | Coach (top-bar icon key), Settings | Evidence, Planning tools, Settings (rail lower group / overflow `⋯`) |
| Home (`/`) | last Planning route | `/today` |
| Primary yellow key | Run (Simulate) · Find plans (Plan) | **none on Living screens** (nothing to run; logging is ink keys) |

Rules:
1. **One active plan.** Living mode exists only while a plan is scheduled, active or paused. There is
   no Living mode without a plan and no "mode switch" control to press for its own sake.
2. **Planning tools stay reachable but out of the way.** In Living mode, "Planning tools" sits in the
   rail's lower group (desktop) and in the overflow menu and the Today header menu (mobile). Opening it
   sets the planning override: the rail and tab bar show the Planning destinations, the first slot
   becomes a **return key "today"**, and a persistent **plan strip** sits under the context bar:
   > ● **Spring cut is running** · day 14 of 84 · Changes here don't touch it until you replace it.
   > [Back to Today]
   The strip cannot be dismissed while the override is set.
3. **Leaving Living mode for good** happens only by ending or replacing the plan (typed confirmation,
   restorable for 7 days) — never by navigation.
4. **The mode change is a moment, not an animation.** Starting a plan: the rail/tab-bar keys
   cross-fade (140 ms, reduced motion: instant), the app lands on Today, and a toast says "Spring cut
   starts tomorrow · Undo" (undo within 24 h while nothing is logged = discard).
5. **The Coach exists in both modes.** In Planning it is a top-bar icon key (onboarding conversation,
   what-ifs, planning help); in Living it is a tab. Same route, same conversation.

### 3.5 Living mode — mobile and tablet (< 1024 px)

```
┌──────────────────────────────┐  top bar 56 (chassis-2)
│ ● vitals  Today      ◔ ⋯     │  wordmark · context title · sync pill (icon) · overflow
├──────────────────────────────┤  (overflow: Evidence · Planning tools · Settings · Theme)
│                              │
│         screen content       │  16 px gutters
│                              │
├──────────────────────────────┤  contextual action bar only where a screen needs one
│ Tell the Coach what you did ⊙│  (Today: the log bar; Food: grocery count; Train: session timer)
├──────────────────────────────┤
│Today Food Train Coach Progr. │  tab bar: 5 keys, icon 20 over 11 px label,
└──────────────────────────────┘  pressed key + yellow dot = current
```

- **Tab bar**: five equal keys (375 px → 75 px each). Icons: Today `sun-dim` (authored "day dial":
  a 24 h tick ring with a hand), Food `utensils`, Train `dumbbell-plate` (authored), Coach
  `message-square-text`, Progress `chart-spline`. Labels: `today · food · train · coach · progress`.
  Coach shows a 6 px ink dot when a proposal is waiting for you (never a count badge).
- **Planning override on mobile**: the tab bar becomes `today ↩ · body · simulate · plan · evidence`
  — the return key keeps Today's slot so the thumb finds it where it was.
- **Plan scheduled (start date ahead)**: Living tabs show; Today shows the countdown state
  (`living-mode.md §4.6`).

### 3.6 Living mode — desktop (≥ 1024 px)

```
┌──────┬──────────────────────────────────────────────────────────────────────┐
│ ●        │ Today · Wed 15 Oct    day 15 of 84 · Spring cut (medium)   ◔ synced │ context bar 56
│ vitals   │                                                            ⋯ menu │
│ day 15/84├───────────────────────────────────────────────────────────────────┤
│   ◷      │                                                                    │
│  today   │                      screen content                                │
│   ⊓      │                      (max 1440, 24 px gutters)                     │
│  food    │                                                                    │
│   ⊟      │                                                                    │
│  train   │                                                                    │
│   ▭      │                                                                    │
│  coach   │                                                                    │
│   ⌇      │                                                                    │
│ progress │                                                                    │
│──────────│                                                                    │
│   ▯      │                                                                    │
│ evidence │                                                                    │
│   ⤳      │                                                                    │
│ planning │                                                                    │
│   ⚙      │                                                                    │
│ settings │                                                                    │
│   ◐      │                                                                    │
└──────────┴────────────────────────────────────────────────────────────────────┘
 rail 76 px: wordmark + plan-day readout ("day 15 / 84", condensed 11 px, tabular),
 5 destination keys, hairline, lower group (evidence, planning, settings, theme). Labels are
 full words at 11 px and are never abbreviated (REVIEW_FINDINGS #6); "progress" fits 60 px.
```

- `Ctrl/⌘ 1…5` = Today · Food · Train · Coach · Progress in Living mode; `Ctrl/⌘ 1…4` keep the v0.1
  meaning in Planning mode. `Ctrl/⌘ 0` = Today from anywhere while a plan runs (also the return key
  in the override).
- The **plan-day readout** under the wordmark is the only place the rail carries data; when the
  plan is paused it reads "paused" (ink-2), when scheduled "starts Mon".
- **Sync pill** (context bar, right; mobile: icon only in the top bar): state glyph + "synced 14:02"
  / "3 waiting" / "offline" / "can't reach server". Click → popover with status and **Sync now**
  (`settings-sync-ai.md §4.7`). Hidden when sync is off.
- **Agent indicator**: when a local agent (MCP/WebMCP) or the Coach acts outside the Coach screen, a
  chip "An agent is using Vitals · Stop" sits left of the sync pill for 60 s after the last call.

### 3.7 Global elements added in v0.2

- **Plan strip** (planning override only; above).
- **Pending changes**: any change the Coach or an agent proposed and you have not decided appears on
  Today as a change-review card and in Coach; never as a modal.
- **Safety pause**: if a danger warning or a screening change pauses the plan, a danger Notice sits
  at the top of Today, Food and Train until you resume (only you can resume).
- **Quiet mode** (on by default in gentle mode): numbers that invite restriction (remaining energy,
  adherence score, weight) become categories app-wide; a "show numbers" key reveals them per view.

---

## 4. End-to-end flows

Notation: `[Screen]` → action → `[Screen]`. **Bold** = primary key.

### 4.1 First run

```
[Welcome · intro]
   "See what a plan does before you live it."  → **Get started**
[Welcome · screening]            5 yes/no questions (see onboarding-safety.md)
   any "yes" → inline explanation of what changes (safety mode) → continue
   "under 18" → hard stop screen (Vitals is for adults) — no way forward except "I entered this by mistake"
[Welcome · consent]              3 plain statements + checkbox "I understand" → **Continue**
[Your body · basics]             sex, age, height, weight (units toggle) → **Next: shape**
[Your body · shape]              avatar + sliders; live estimates → **Next: habits**
[Your body · habits]             training history, steps, sleep → **Done**
[Choose a start]                 two large keys on a faceplate:
   "Simulate a plan I have in mind" → [Schedule · starter picker]
   "Find a plan for my goals"       → [Planner · goals]
```

- Progress is shown as a 3-segment scale in the top bar (basics · shape · habits), not numbered
  steps.
- Every step autosaves. Leaving mid-way returns the user to the same step on next visit.
- "Skip for now" exists on shape and habits (defaults: population averages for the entered
  sex/age/BMI; estimates show wider ranges and a "refine" chip).

### 4.2 Simulator: build → run → read → refine

```
[Schedule · empty]
   starter picker: "12 weeks · moderate deficit", "8 weeks · maintenance + training",
   "6 weeks · alternating fasts", "Blank" → creates programs A–C and paints them
[Schedule]
   pick program key → drag across days (paint) | tap day → [Day editor]
   bulk: select range → Copy week / Paste / Repeat to end / Clear
   live preview strip updates (coarse, < 100 ms)
   → **Run** (yellow key)
[Results · running]              previous curves at 40 %; progress rule; "Running 84 days…"
[Results]                        readout strip + channel stack + warnings + avatar morph
   hover/tap crosshair → values for all channels
   tap a lane label → Focus; tap "Explain" → [Explain drawer] → "Open mechanism" → [Evidence · mechanism]
   warning "Protein low weeks 3–5" → [Fix] jumps to schedule with those days selected
   edit anything → results marked stale → **Run** again
```

### 4.3 Planner: goals → optimise → choose → simulate

```
[Plan · goals · empty]           "What do you want to change?" + 6 suggested goals as chips
   add goals from catalogue (grouped by category) → drag to rank
   set target or direction per goal; horizon; constraints; won't-do list
   conflicts appear inline between goals ("pulls against #1")
   → **Find plans** (yellow key)
[Plan · running]                 progress: candidates tried, best score, 3 slots filling A/B/C;
                                 Cancel keeps best-so-far (if ≥1 feasible)
[Plan · results]                 plan cards A/B/C → compare curves → scorecard → safety
   choose a plan → "Open in Simulator" → new scenario "from Plan B" → [Schedule]
   or "Export plan (JSON / printable)"
```

### 4.4 Evidence

```
any "grade" badge / "Explain" / metric info (i) → [Explain drawer] → [Evidence · mechanism]
[Evidence index] search, filter by category and grade → [mechanism] → "Used by: fat mass,
lean mass…" chips → jump back to Results with that metric focused (if a projection exists)
```

### 4.5 Data

```
[Settings · data] Export → downloads vitals-2026-09-30.json (body, scenarios, programs, goals,
plans, settings; projections excluded — recomputed)
Import → file picker → [Import preview sheet]: what's inside, version, conflicts
   → Replace everything | Merge (keep both scenarios, rename duplicates) | Cancel
Reset → dialog: type "reset" to confirm → wipes local storage → [Welcome]
```

### 4.6 First run (v0.2) — replaces §4.1 from "Your body · habits" on

```
[Welcome · intro] → [screening] → [consent]              unchanged (onboarding-safety.md)
[Your body · basics] → [Your body · shape]               figure v2 (body-figure-v2.md); "habits" is retired
[Intake · a normal day]        10 questions, mostly one tap → maintenance with drivers  (activity)
[Intake · training & equipment]  willingness, kit, time, injuries                       (training)
[Intake · food & kitchen]      what you eat, rules, cooking, supplements stance         (diet, kitchen, supplements)
[Intake · devices & data]      what you wear → per-stream choices → import now / later  (devices)
[What we'll use]               one summary faceplate: maintenance, kit, food rules, streams, deferred items
[Choose a start]               "Simulate a plan I have in mind" · "Find a plan for my goals"
```
- Every intake chapter has **Skip this part** (chapter header) and every question **Ask me later**;
  nothing blocks the planner. Deferred items collect in Body › **Your setup**; the Coach asks them
  only when you open a conversation, and the lazy food questions surface the first time they matter
  (first grocery list, first swap).
- Progress: a 4-segment scale in the top bar (`a normal day · training · food · devices`).
- If an AI provider is configured, each chapter offers "Answer by chatting instead" → the Coach
  runs the same questions (`intake.nextQuestions`); answers land as log-class change cards.

### 4.7 Choose and start a plan

```
[Plan · results]   the ladder: Hard · Medium · Easy ‖ Ideal (plan-ladder.md)
   select a rung → [Start this plan] (solid)            ┐
   or [Simulator] scenario → [Start this plan]           ┘→ [Start sheet]
[Start sheet]      start date (today · tomorrow ● · next Monday · pick ≤ 28 days)
                   anchoring note ("Starting on Thursday skips 3 days of week 1; goal date moves 3 days")
                   weekly check-in day · weigh-in time · training days · if a session is missed
                   things to buy before day 1 (from the rung) · groceries for the first 3 days
   → [Start plan] → mode becomes Living → [Today] (scheduled countdown or day 1)
Ideal card → [Adopt some of these limits] → limit picker sheet → (Find plans) → new ladder
```
- If a plan is already active: the key reads **Replace active plan…** → typed confirmation
  Dialog (`plan.replace`, restorable 7 days).
- Undo: the start toast offers Undo for 24 h while nothing is logged (`plan.discard`).

### 4.8 The daily loop (Living)

```
open app → [Today] (rolls over at 04:00)
   T0  tick each block "as planned" · weigh in            ≤ 10 s
   T1  "partly / skipped / something else" on a row        ≤ 60 s
   T2  tell the Coach / photo a meal / log in Food          optional
   → delta vs forecast updates · adherence "so far" updates
   → a departed day may produce a light re-plan (tomorrow ±10 % energy) shown on Today with Undo
[Food]   accept a recipe → cook → "I ate this" / "I ate something else"
[Train]  do the session → tick sets or "as planned" → swap with equivalence credit if needed
```
- After ≥ 2 days away: "Welcome back. Nothing to catch up on." + one-tap backfill "as planned"
  (marked assumed, never scored).
- If logging drops below 3 days in 7 for two weeks, Today switches to **minimal mode** (taps and
  weigh-ins only) and says so once.

### 4.9 Logging by talking (Coach)

```
[Coach] "dal, rice and two eggs" / photo / "skipped the run, did 30 min treadmill"
   → read calls collapse to "looked at …"
   → log-class writes apply at once as change cards (source + likely range; Edit · Undo)
       confidence 0.4–0.7 → one chip on the weakest field first; < 0.4 → one question first
   → edit-class requests ("no training for 3 days") come back as proposals (diff + goal-date range;
     Apply · Adjust · Discard) — nothing changes until Apply
   → destructive requests ("end my plan") come back as a card that opens the typed confirmation
```

### 4.10 Weekly check-in

```
Today shows the check-in card on the chosen weekday (can be opened up to 2 days early)
[Check-in sheet]  trend weight vs forecast band · drift verdict and goal-date range · cause
                  adherence per block (the item that cost most) · the week's re-plan proposal
   → Apply / Keep the plan · next check-in date
```
- Needs ≥ 4 weigh-ins in 7 days (or ≥ 10 in 14); otherwise the card says what is missing and still
  shows adherence.

### 4.11 Re-plan

```
Today ⋯ menu
   "Re-plan the rest (same goals)"  → plan.replan job → proposal card on Today → Apply → new version
   "Re-plan from scratch"           → planning override → [Plan · goals ?from=active] (goals, limits,
                                      today's state prefilled) → Find plans → ladder →
                                      [Replace active plan…] typed confirm → Living, new plan
Progress drift card → one action per verdict: "Keep going" · "See easier options" · "Re-plan the rest"
```

### 4.12 Pause, resume, end

```
Today ⋯ → Pause plan → sheet (from · until, reason) → paused days prescribe your usual day
Today (paused) → Resume → proposal shows the new end date → Apply
Today ⋯ → End plan → typed confirmation → ended (restorable 7 days) → Planning mode
Plan reaches its end date → Today: "Spring cut is complete" → [Keep the result] (maintenance
   scenario) · [Plan again]
Safety pause (danger warning or screening change) → only you can resume, from Today
```

### 4.13 Devices and data

```
[Intake · devices] or [Settings · Devices and streams]
   pick device(s) → how it reaches Vitals (import file / connect ring / bridge app / later)
   → per-stream choices: bring in · use in scores · use in my plan · Coach can see
   → [Import a file] → import report (days, records, duplicates) → scores rescore in background
   → [Connect ring] (Chrome, Android/desktop) → device chooser → sync now → report
```

### 4.14 Sync and AI provider

```
[Settings · Sync]  enter relay URL → test → "Turn on sync" → this device creates the sync key
   → [Show sync key] (24 words + QR, hides after 60 s; "I've saved the words" required)
   second device: [Settings · Sync] → "Join with a sync key" → scan / paste → merge or replace
[Settings · AI provider]  choose preset → paste key → "Check what this model can do" (consent)
   → capability results → choose model → Coach is ready
```

---

## 5. States by surface

| Surface | Empty / first run | Loading | Error | Warning | Stale / other |
|---|---|---|---|---|---|
| Your body | Defaults pre-filled with population medians for sex/age; figure shown in neutral base; "Refine these" hint on estimates | — (all local, instant) | Out-of-range inputs: inline under field ("Height must be 120–230 cm") | Estimates rely on defaults → info chip "Based on averages — add waist for a tighter estimate" | Body changed after scenarios exist → info bar in Simulator: "Your body changed on 12 Oct. Update this scenario's snapshot?" [Update] [Keep] |
| Schedule | Starter picker faceplate over a perforated empty raster | Preview strip shows shimmer-free "…" readout while computing (< 100 ms) | Invalid day (e.g. macros exceed energy by > 5 %) → day cell gets a caution corner mark + editor shows fix | Per-day safety flags (caution/danger marks on cells) | Horizon shortened → days beyond are kept in history and restorable for 1 session ("Restore 14 removed days") |
| Results | "Run your first projection" with the yellow key centred on a perforated stage | Previous render at 40 % + top progress rule + elapsed seconds; first run: faint lane scaffolding with labels only (no skeleton blocks) | Worker failure: "The simulation stopped at day 37: numbers went out of range (glycogen < 0). This is our bug, not your plan." [Report details] [Run again] | Caution: Warnings panel + event markers. Danger: acknowledgement panel before results render, then a persistent "Simulation — not a recommendation" strip (dossier 17 §3) | Stale bar (see §3.3) |
| Planner goals | Suggested goals chips + short explanation of ranking | — | Contradictory constraints: "Training 6 days/week conflicts with 'no exercise on weekends'" | Goal needs data (e.g. waist) → chip "Needs waist measurement" | Body changed since last run → results marked stale |
| Planner run | — | Progress panel (candidates, best score per slot, elapsed/estimated) | Optimiser failed or timed out → keep best feasible so far; if none: explain which constraint blocked it | — | Cancelled → "Stopped at 58 %. 2 plans found." |
| Planner results | — | — | "No safe plan meets goal #1 in 8 weeks." + nearest achievable + suggestions | Per-plan safety notes; difficulty ≥ 4/5 flagged | — |
| Evidence | Search with no results: "No mechanism matches 'x'. Try a metric name, e.g. ketones." | — | — | Grade D entries show a caution-neutral note | — |
| Settings/data | — | Import parsing | Invalid file / newer version / partial data (see settings-data.md) | Storage > 80 % of quota | — |

### 5.1 States added in v0.2

| Surface | Empty / first run | Loading | Error | Warning | Other |
|---|---|---|---|---|---|
| Intake | defaults shown on every question | — (local) | out-of-range numbers inline | answers that change safety (injuries, conditions) explain the effect inline | deferred items listed in Body › Your setup |
| Ladder | "Find plans" not run → goals screen | provisional rungs appear as found; Ideal last | `noSafePlan`: no rungs, Ideal + "which limit blocks" still shown | rung cautions; collapsed rungs explained | stale (goals/body changed) → dimmed + "Find plans again" |
| Today | scheduled: countdown + prep checklist | prescription local; forecast "updating…" rule ≤ 1 s | engine failure → logging still works, forecast shows "not updated" | safety pause; flags; proposals | minimal mode; quiet mode; paused; welcome back; plan complete |
| Food | no recipe yet → "Plan my day" (needs AI) / targets as plain meals | recipe generation: per-slot progress rule | provider failure → targets as plain meals + manual log | "closest achievable: protein short by 18 g" | quiet mode hides kcal; family-food mode |
| Train | rest day → "Rest day" + steps target | — | unknown exercise → Coach resolves it, never rejects | injury-tagged exercise filtered (says why) | swap preview; equipment missing |
| Coach | no provider → manual-logging fallback + "Connect an AI provider" | streaming text; "running" job chip | provider errors by kind (auth, quota, CORS, network…) | safety-blocked card with alternatives | proposal pending; stale proposal; basic-tier model (logs only) |
| Progress | < 7 days → "Your trend starts after a week of weigh-ins" | rescoring chip "updating scores to v1.3" | — | drift behind (no red) | check-in report; version history |
| Scores | no device → explanation + "Add a device" | rescoring | withheld (gate unmet: "needs 14 nights, 9 so far") | flags yellow/amber/red | borderline; new device = new baseline |
| Sync | off (default) | connecting / syncing | can't reach server; needs permission (Chrome local network) | pending changes waiting | not available in this version |

---

## 6. Persistence (for engineers)

- Zustand stores persisted to `localStorage` under `vitals:v1:*` keys: `body`, `scenarios`,
  `programs`, `goals`, `plans`, `settings`, `ui` (last route, panel widths, chart view prefs).
- Projections are cached in IndexedDB (`vitals-projections`, keyed by scenario hash) because an
  hourly projection (4 400 × 41 floats ≈ 1.4 MB) exceeds comfortable localStorage use.
- Export file: `{ vitalsVersion: "1", exportedAt, body, scenarios, programs, goals, plans, settings }`.
- Every schema has a version and a migration; an import from a newer version is refused with a
  clear message.

### 6.1 Persistence in v0.2

Superseded by `docs/SUITE_SPEC.md §2`: one local-first document store (IndexedDB), optional
end-to-end-encrypted sync to a relay the person runs, export v2. The design consequences:
- "Saved on this device" (Your body context bar) becomes **"saved"** with the sync pill beside it
  when sync is on ("saved · synced 14:02").
- Copy that says "stays on this device" must say "stays on your devices" once sync is on
  (`settings-sync-ai.md §9` lists every string).
- The planning override (`uiPrefs.planningOverride`) is per device, so one device can sit in
  planning tools while another shows Today.

---

## 7. Keyboard map (desktop)

| Keys | Action |
|---|---|
| `⌘/Ctrl 1…4` | Body · Simulate · Plan · Evidence |
| `⌘/Ctrl Enter` | Run (Simulator) / Find plans (Planner) |
| `⌘/Ctrl Z`, `⇧⌘Z` | Undo / redo (schedule, goals) |
| `A…Z` (schedule, painter focused) | select program key |
| arrows / `⇧`+arrows | move / extend day selection in the raster |
| `P` | paint selection with the active program |
| `⌘C` / `⌘V` on selected week(s) | copy / paste weeks |
| `Enter` on a day | open day editor |
| `←/→` in chart | move crosshair one step (day, or hour when zoomed ≤ 3 days); `⇧` = 7 steps |
| `+ / −` in chart | zoom in/out around crosshair; `0` = fit horizon |
| `F` in chart | focus the lane under the crosshair; `Esc` exits |
| `E` in chart | Explain the focused metric |
| `T` in chart | toggle table view |
| `?` | shortcut sheet |
| `⌘/Ctrl 1…5` (Living) | Today · Food · Train · Coach · Progress |
| `⌘/Ctrl 0` (Living, or planning override) | Today |
| `L` (Today) | focus the Coach log bar ("tell the Coach what you did") |
| `W` (Today) | focus the weigh-in field |
| `Space` on a checklist row | mark as planned; `⇧Space` opens "partly / skipped / something else" |
| `[` / `]` (Today, Food, Train) | previous / next day |
| `⌘/Ctrl Z` (Living) | undo the last change you or the Coach made (`history.undo`) |
