# Screen — Simulator · Schedule (`/simulate/:sid/schedule`)

> Reference rendering: `prototype/index.html#schedule` (painter, program keys, day editor, clock
> ring, preview strip all live). Components: `COMPONENTS.md §3–5`.

## 1. Purpose

Build "what I'm going to do" over 1–6 months, fast. The user defines a handful of reusable
**programs** (day configurations) as lettered keys, **paints** them onto a week-row calendar,
overrides single days where needed, and presses the yellow **Run** key. A coarse preview under the
calendar reacts to every stroke so the user feels the consequences before running the full model.

## 2. Entry points & exits

| In | Out |
|---|---|
| Rail/tab "Simulate" (last scenario) · Welcome "Simulate a plan I have in mind" (starter picker) · Planner "Open in Simulator" (new scenario "from Plan B") · Results warning "Fix" (days pre-selected) · Evidence (none) | Run → Results · `schedule | results` KeyBank · scenario switcher · Your body (banner link when the body changed) |

## 3. Layout — mobile (375 px)

```
┌──────────────────────────────────────────┐
│ ● vitals                       ◐   ⚙     │ top bar
├──────────────────────────────────────────┤
│ Spring cut ▾        [●schedule|results•] │ context row; • = stale dot on results
│ 12 wk · 5 Oct → 27 Dec          [1 2 ●3 4 6] │ horizon row (KeyBank sm, months)
├──────────────────────────────────────────┤
│ ┌A ● training…┐┌B ○ rest day ┐┌C ○ long…  │ ProgramKey rail, 142 px keys,
│ │85%·P2 C140  ││75%·P2 C60   ││80%·P2 …   │ snap scroll, "+ New" at end
│ │▓▓▓░░░▒▒▒▒   ││▓▓▓░▒▒▒▒▒▒   ││           │
│ └─────────────┘└─────────────┘└──────     │
│ ┌ Wed 11 Nov · A training day  ⧉ ↻ ⌫ ──┐ │ raster bar: label + icon keys
│ │      mon tue wed thu fri sat sun      │ │ sticky weekday header
│ │ wk1 [A85][B75][A85][B75][A85][C80][B75]│ │ cells ≥ 44 × 52, energy tints
│ │ wk2 [A85][B75][A85][B75][A85][C80][B75]│ │ letter + % + 3 px macro bar
│ │ …                                      │ │
│ │ wk6 [A85][B75][A▣ ][D36][A85][C80][B75]│ │ D = ink cell (fast), ▲ caution flag
│ │ …                                      │ │
│ │ preview ─ fat mass −4.4 kg · ketosis 5 d│ │ PreviewStrip 52 px
│ │ ╲___________╲_____________             │ │
│ └───────────────────────────────────────┘ │
├──────────────────────────────────────────┤
│ painting with                     (run)  │ action bar 64: armed program + RunKey 48
│ A · training day                         │
├──────────────────────────────────────────┤
│  body    simulate•   plan    evidence    │
└──────────────────────────────────────────┘
```

- **Day editor** is a Sheet (detents 60 % / 92 %) opened by tapping a cell; the raster stays
  visible above the sheet in the 60 % detent with the tapped cell scrolled into view.
- **Bulk toolbar**: when ≥ 2 days are selected, the action bar swaps to `N days selected · Paint
  with A · Copy · Paste · Repeat · ⋯` (icon keys with labels under 11 px).
- **Long horizons** (4–6 months, up to 27 rows): a vertical week scrubber (8 px wide, right edge
  of the raster, shows "wk 14" bubble while dragging) and the weekday header stays sticky.

## 4. Layout — desktop (1440 px)

```
┌────┬───────────────────────────────────────────────────────────────────────────────────────────────┐
│ ●  │ Spring cut ▾  [●schedule|results]        [1 mo|2|●3|4|6] 5 Oct → 27 Dec      Run (●run)        │ 56
├────┼───────────────────────────────────────────────────────────────────────────────────────────────┤
│    │ program keys  A–F │ ┌ raster ─────────────────────────────────────────┐ ┌ day editor ── 372 ┐ │
│    │ ┌A ● training day┐│ │ Wed 11 Nov · A training day   ⧉ Copy week ↻ Rep… │ │ Wed 11 Nov   [A] ×│ │
│    │ │85% P2 C140 F96 ││ │ block        wk   mon  tue  wed  thu  fri  sat  sun│ │ day 38 of 84      │ │
│    │ │▓▓▓▓░░░▒▒▒▒▒ 27d││ │ fat-loss  │ wk1 [A  ][B  ][A  ][B  ][A  ][C  ][B ]│ │ edits apply to    │ │
│    │ └────────────────┘│ │ base      │ wk2 …                                 │ │ [day|block|●all A]│ │
│    │ ┌B ○ rest day ───┐│ │ wk 1–4    │ …                                     │ │ Energy            │ │
│    │ …  C  D  E  F     │ │ diet break│ wk5 [E  ][E  ]…                        │ │ ▕EnergyScale▏ 85% │ │
│    │ [+ New program]   │ │ fasting   │ wk6 [A][B][A▣][D■][A][C][B]            │ │ Macros            │ │
│    │                   │ │ block     │ …                                     │ │ protein · carbs   │ │
│    │ 188               │ │ maint.    │ wk11 [F][E][F][E][F][C][E]             │ │ ▓▓▓▓░░░░▒▒▒▒▒▒    │ │
│    │                   │ │ preview · coarse ─ fat mass −4.4 kg · ketosis 5 d │ │ Meals & window    │ │
│    │                   │ │ ╲_____╲____________                               │ │ (ClockRing) meals │ │
│    │                   │ └──────────────────────────────────────────────────┘ │ Exercise · Sleep  │ │
└────┴──────────────────────────────────────────────────────────────────────────────────────────────┘
 columns: 188 | minmax(0,1fr) | 372 ; raster: 132 phase col | 44 week col | 7 × 1fr (cells 88 × 62)
```

- **1024–1279**: two columns (tray 188 | raster); the day editor becomes a right Drawer (392 px,
  overlays with `--lm-shadow-drawer`) opened by clicking a cell; `Esc` closes.
- **Tablet 768–1023**: tray as a horizontal rail above the raster (as mobile), raster with phase
  column hidden and a "blocks" chip row above it instead; day editor as a right Drawer 360 px.

## 5. Regions & components

| Region | Components | Content | Tokens |
|---|---|---|---|
| Context bar | ContextBar, ScenarioSwitcher, KeyBank (schedule/results), HorizonPicker, RunKey | name, sub-view, horizon, start→end, Run | RunKey `--lm-signal`, stale dot `--lm-signal-ink` |
| Program tray | ProgramKey ×n, Key "+ New program" | letter, name, energy %, macro summary, micro-bar, window + exercise glyphs, day count | armed: `--lm-shadow-key-pressed` + yellow indicator |
| Raster | ScheduleRaster (grid), phase column, week labels | day cells | energy tints `--lm-energy-*`, fast `--lm-energy-fast`, selection ring 2 px `--lm-ink`, focus edge 2 px `--lm-signal` |
| Raster bar / bulk toolbar | Key `sm` quiet | selection label, Copy week, Paste, Repeat to end, Clear, Paint with X | — |
| Preview | PreviewStrip | fat-mass line + ketosis ribbon + caption | `--lm-cat-body`, `--lm-keto-*` |
| Day editor | DayEditor, KeyBank (scope), EnergyScale, MacroSplit, ClockRing, SessionRow, ScaleRange, DetailGroup, Banner | per-day settings | — |

## 6. Content & copy

**Starter picker (empty scenario)** — Faceplate centred on a perforated `EmptyStage`:
> **Paint your first weeks.**
> Pick a starter to get programs and a first draft, or start blank. You can change everything.
> - `12 weeks · moderate deficit` — "80 % energy, 2.0 g/kg protein, lifting 3×/week"
> - `8 weeks · maintenance + training` — "100 % energy, higher carbs on lifting days"
> - `6 weeks · weekly 36 h fasts` — "85 % energy, one water-only fast per week"
> - `Blank` — "One program, no days painted"

**Program presets** (menu under "+ New program"; names describe composition, never brands; the
familiar term is a search alias shown in ink-3):
| Preset | Defaults | Alias |
|---|---|---|
| very-low-carb, ≤ 30 g net carbs | 85 %, P 1.8 g/kg, C 25 g, fat rest | keto |
| balanced | 90 %, P 1.8, C 45 % energy, fat rest | — |
| high-carb, low-fat | 90 %, P 1.8, fat 20 % energy, C rest | — |
| protein-sparing, ≥ 2.5 g/kg, ≤ 50 % energy | 45 %, P 2.5, C 30 g, minimal fat | PSMF |
| training day, maintenance | 100 %, P 2.0, C 4 g/kg, lift 60 min | — |
| training day, surplus | 110 %, P 2.0, C 5 g/kg | lean bulk |
| water-only fast | 0 %, 24/36/48/72 h | extended fast |
| higher-energy day | 110–120 %, extra carbs | refeed |

**Raster bar**
- One day selected: "Wed 11 Nov · A training day" + engraved "drag to paint with A" (or "drag to
  select" when no program is armed).
- Several: "5 days selected" + keys `Paint with A` · `Copy` · `Paste` · `Repeat to end` · `Clear`.
- Copy feedback: key label becomes "Copied wk 6" for 2 s; Toast on paste: "Week 6 pasted to weeks
  7–9 · Undo".

**Phase column** (auto-derived from runs of weeks with the same pattern; renamable inline):
"fat-loss base · wk 1–4 · 80 %", "diet break · wk 5 · 100 %", "fasting block · wk 6–10 · 69 %",
"maintenance · wk 11–12 · 97 %".

**Day editor**
- Header: "Wed 11 Nov" (16/600) · "day 38 of 84 · fasting block" (engraved) · program chip "A
  training day" · close.
- Scope: engraved "edits apply to" + KeyBank `this day · this block · all 27 A days`. Default:
  `all A days` when opened from a program key's "Edit"; `this day` when opened from a cell.
  Editing with `this day` creates an override (triangle corner marker on the cell) and the header
  shows "override · Reset to program A".
- Energy: EnergyScale 40–140 % with diverging zones and "maint." reference tick; sub-line "2 159
  kcal · −381 vs maintenance"; KeyBank `% | kcal`.
- Macros: linked scales (protein g/kg with reference tick 1.6 "muscle-retention floor" and a
  caution zone 0.8–1.2; net carbs g with reference tick 50 "ketosis likely below"; fat "takes the
  remaining energy"), 10 px macro bar, legend with grams and % energy, fibre. Toggle `triangle` at
  ≥ 768 px. "More detail" DetailGroup: fat types, sugars, sodium, potassium, water, alcohol,
  caffeine, creatine — each with a "typical" reference tick.
- Meals & window: ClockRing editor (drag window ends or body; meals drag along the arc) + meal list
  "12:30 · 972 kcal", "19:00 · 1 187 kcal", "17:30 lift · 60 min", "23:30 sleep · 7.5 h";
  KeyBank `meals: 1 · 2 · 3 · 4 · 5`; meal split KeyBank `even · bigger last · bigger first`.
- Exercise: SessionRows + "Add" (resistance, walk, run, cycle, swim, HIIT, other); steps row with
  the user's typical as reference tick.
- Sleep: ScaleRange bed/wake + quality KeyBank; "same as usual" link resets to Habits.
- Modifiers (collapsed): stress KeyBank, illness Switch ("pauses training effects"), travel/jet-lag
  Switch.

**Multi-day fasts.** Painting program D (water-only fast, 36 h) on a day renders an ink cell with
"36 h". A fast longer than 24 h that crosses midnight shows a continuous ink band across the
affected cells (cells merge visually: inner radius 0 and a 2 px surface gap removed) with a small
hatched-ring glyph at the start. The day editor for such a day shows a **multi-day timeline**
instead of one ring: a 72 px-tall horizontal strip spanning the fast (e.g. Wed 20:00 → Fri
08:00) with day boundaries, sleep bands and a "break-fast meal" marker; info Banner "Fasts over
24 h: keep fluids and salt up. Aim for 2–3 L of water and about 2 g of sodium across the day.
Break the fast with a protein-first meal."

**Validation & safety (inline in the editor; flags on cells)**
| Condition (rule id, dossier 17) | Severity | Copy (≤ 200 chars) |
|---|---|---|
| Macros exceed energy by > 5 % (app rule) | error (blocks Run) | "Protein and carbs already use 2 310 kcal — more than the 2 159 set. Lower one, or raise energy." |
| 7-day intake below 1 200 (F) / 1 500 (M) kcal and ≥ 800 (W-E01) | caution | "Your average intake (1 180 kcal/day) is below the 1 200 kcal/day usually treated as the minimum without professional support. This is a simulation, not advice." |
| Under 800 kcal/day for ≥ 3 days, not a fast (W-E02) | danger | "Under 800 kcal/day is a very-low-energy diet: guidelines say medical supervision only, for up to 12 weeks." |
| 7-day deficit above the cap (default 25 %) (W-E03) / above 40 % (W-E04) | caution / danger | "Your deficit is 31 % of maintenance. Above about 25 % the model shows more muscle loss and stronger hunger and hormone effects." |
| Protein < 0.8 g/kg (W-M01) · < 1.2 g/kg in a deficit (W-M02) | caution · info | "In a deficit, 1.0 g/kg protein is low for keeping muscle. Trials use 1.2–2.4 g/kg, higher when you are leaner or training hard." |
| Fat < 15 % energy or < 30 g/day (W-M06) | caution | "Fat is 22 g/day. During faster weight loss, too little fat is linked to gallstones; include some fat at main meals (aim for at least 10 g)." |
| Net carbs < 50 g/day (W-M08) · for ≥ 4 weeks (W-M09) | info · caution | "Below ~50 g net carbs the model enters ketosis. Expect 2–4 weeks of 'keto flu', more urination and salt loss; keep fluids and sodium up." |
| Fast 24–48 h (W-F02) · 48–72 h (W-F03) | caution | "Fasts of 24–48 h can cause lightheadedness, headache and low energy. Keep drinking, add salt, keep exercise light, and stop if you feel faint or unwell." |
| Fast 3–7 days (W-F04) · > 7 days (W-F05) | danger | "Water fasts of 3–7 days are studied under medical supervision. Risks: fainting, arrhythmia, low sodium, gout, refeeding problems. Not to be attempted alone." |
| ≥ 72 h fast without a refeeding ramp (W-F08) | danger | "After fasting over 3 days, restart food gradually (about half your usual energy for the first 2 days)." |
| Hard exercise on a fasting day ≥ 24 h (W-F09) | caution | "Hard exercise while fasting cut endurance and risked low blood sugar in studies. Keep long-fast days light." [Move the session] |
| Alcohol > 14 units/week (W-M18) · on a fast/low-energy day (W-M19) | caution · danger | "More than 14 units of alcohol a week is above UK low-risk guidance; WHO says no level of alcohol is completely safe." |
| Caffeine > 400 mg/day or > 200 mg per dose (W-M21) | caution | "Caffeine above 400 mg/day (about 4 cups of coffee), or 200 mg at once, is beyond what EFSA and FDA consider safe for most adults." |
| Safety-mode conditions (W-P01…W-P07) | per `onboarding-safety.md` | — |

Rule ids and thresholds are dossier 17 §3 (draft); messages must stay ≤ 200 characters (scripted
check, dossier 17 §7.4). A caution/danger on a day adds a corner flag to its cell (icon, never
colour alone); danger days also block nothing — the Simulator may simulate anything — but Results
will ask for an acknowledgement first.



## 7. Interactions

**Arm and paint (pointer)**
1. Click a ProgramKey → armed (pressed + yellow dot); click again → disarmed. Keyboard: letter
   keys `A–Z` arm; `0` disarms.
2. With a program armed, press on a cell and drag: each cell entered is painted immediately
   (optimistic), selection follows the stroke; release → one undo step, preview recomputes
   (< 100 ms), results become stale (Run key dot, "results" stale dot).
3. A click without movement on a cell opens the day editor (never repaints).
4. With nothing armed, drag selects a linear range (row-wrapping); `⌥`-drag selects a rectangle
   (e.g. all Thursdays); `⇧`-click extends; click a week label selects the week; the top-left corner
   selects all.

**Touch**
- Tap cell → day editor sheet. Long-press (350 ms, 8 ms haptic tick) then drag → paint (armed) or
  select (not armed). Vertical scroll before the long-press completes cancels it.
- Two-finger drag scrolls the raster; the page never scrolls horizontally.

**Week operations** (week label menu / long-press): Copy week · Paste to… (multi-select target
weeks in a Popover with week chips) · Insert week (shifts later days, extends horizon if needed,
asks) · Delete week · Repeat to end · Mark as deload (lifting volume × 0.5).

**Keyboard in the raster** (`role="grid"`): arrows move focus; `⇧`+arrows extend selection;
`Space` toggles selection; `P` paints the selection with the armed program; `Enter` opens the
editor; `⌘C/⌘V` copy/paste selected weeks; `Delete` clears to the scenario's default program;
`⌘Z / ⇧⌘Z` undo/redo (50 steps).

**Editor ↔ raster**: every editor change re-tints affected cells live (for scope "all A days",
all A cells), updates the program key summary, and recomputes the preview on release.

**Run**: RunKey (or `⌘Enter`) → navigates to Results in running state (see
`simulator-results.md §8`). If there are blocking errors, Run is disabled with a tooltip listing
them ("2 days have more macros than energy") and the first offending cell pulses its ring once.

## 8. States

| State | Behaviour |
|---|---|
| Empty scenario | Starter picker over a perforated stage; RunKey disabled ("Paint at least one week first"). |
| Painting | Cell fill changes instantly; preview updates at stroke end; Toast only for bulk ops. |
| Stale results | RunKey stale dot; "results" tab dot; mobile tab-bar Simulate dot. |
| Horizon shortened | Removed days kept for this session: info Toast "14 days removed · Restore". |
| Horizon extended | New weeks filled by repeating the last week (Toast "Weeks 13–16 repeat week 12 · Undo"). |
| Program deleted while in use | Blocked: Dialog "Replace B with…" listing programs; never leaves holes. |
| Invalid day | Cell gets a danger corner flag; editor section header shows the icon; Run disabled. |
| Safety warning | Caution/danger flags on cells; the preview caption appends "· 1 caution". |
| From a plan | Context bar provenance chip "from Plan B · 30 Sep" (info), removable. |
| Loading | None — schedule is local and synchronous; preview shows "…" in its caption for > 150 ms computations. |

## 9. Accessibility

- Raster: `role="grid"`, `aria-rowcount=12`, `aria-colcount=7`; each cell `role="gridcell"` with
  label "Wed 11 November, program A training day, 85 percent energy, window 12 to 20, lifting,
  caution: fast after lifting day"; `aria-selected` reflects selection. Roving tabindex.
- Program keys: `role="radiogroup"` / `role="radio"` with `aria-checked` for the armed key.
- Energy tints are never the only encoding: each cell prints its % (or "36 h"), and the program
  letter; the fast cell is inverted (ink) and labelled.
- Preview strip is `aria-hidden`; its caption text carries the numbers.
- Clock ring thumbs are ARIA sliders ("window starts 12:00"); a text summary under the ring
  repeats the day's timeline.
- Touch targets: cells ≥ 44 × 52 px on mobile; program keys 132 × 76.
- Reduced motion: no ring pulse on invalid cells; paint is instant anyway.

## 10. Decisions & rationale

- **Programs + painting** instead of per-day forms: real schedules are 3–6 recurring day types;
  editing the type once updates every day that uses it (scope "all A days"), and overrides stay
  explicit.
- **Week rows (actogram)** rather than a month calendar: weekly rhythm is how people train and
  eat; 7 fixed columns fit 375 px without horizontal scroll.
- **Diverging energy tint** is the one colour on the raster because energy balance is the most
  consequential daily variable; macros live in the 3 px micro-bar, exercise in glyphs.
- **Preview is labelled "preview"** and rounded, so it never competes with Results.
- **A click never paints**: painting requires a drag, which removes the most common accidental
  edit.
