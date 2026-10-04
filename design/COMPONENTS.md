# Vitals — Component Inventory

> Every component: anatomy · variants · states · behaviour · tokens. Names here are the React
> component names engineers should use (`src/ui/*` for primitives, `src/features/*` for
> composites). All sizes in px at 1× unless noted. "Pointer" = mouse/trackpad, "touch" = finger.
>
> Universal rules
> - Every interactive component implements: default, hover, focus-visible, active/pressed,
>   disabled, and — where it can — loading and error.
> - Focus: `outline: 2px solid var(--lm-focus); outline-offset: 2px` (never removed).
> - Min target: 44 × 44 touch; 32 × 32 pointer in dense chart/raster chrome (the hit area may
>   extend beyond the painted shape).
> - Disabled: `--lm-ink-faint` text, no shadow, `cursor: not-allowed`, still focusable when a
>   tooltip explains *why* it is disabled (`aria-disabled="true"` instead of `disabled`).
> - Transitions: colours/shadows `--lm-dur-fast`, layout `--lm-dur-base`, all on `--lm-ease-out`.
>
> **v0.2 (2026-10-01):** new primitives for the intake, the ladder, Living mode, the Coach and scores
> are in **§13**. Superseded v0.1 entries are marked in place (PlanCard → LadderCard, DifficultyMeter →
> BurdenScale, OptimiserProgress slots). Where §13 and an older entry disagree, §13 wins;
> `REVIEW_FINDINGS.md` still wins over both.

---

## 0. Surfaces

### Faceplate `<Faceplate>`
The only container. A panel screwed onto the chassis.
- Anatomy: optional header row (title 15/600 + engraved caption + right-aligned actions) · body ·
  optional footer rule. Header separated by a 1 px `--lm-line` rule, not a fill change.
- Tokens: bg `--lm-face`, border 1 px `--lm-line-strong`, radius `--lm-radius-md`, shadow
  `--lm-shadow-face`, padding 16 (mobile) / 20 (desktop).
- Variants: `plain` · `inset` (bg `--lm-well`, no shadow — for sub-regions such as the avatar
  stage) · `flush` (no padding — charts, rasters).
- Rule: never put a Faceplate inside a Faceplate. Use hairline rules and spacing.

### Engraved label `<Engraved>`
Lowercase 12/16, weight 500, `--lm-ink-2`. Used for control captions, lane names, axis titles.
Rendered text is authored lowercase (not CSS `text-transform`) so screen readers and copy-paste
match what is seen, except where the source string is a metric name reused in sentences — then
use the `engraved` utility.

---

## 1. Keys (buttons)

### Key `<Key>`
- Anatomy: cap (rounded rect) · label (15/500, normal width) · optional leading icon 20 px ·
  optional trailing indicator dot (6 px) · optional shortcut hint (12 px, `--lm-ink-3`).
- Sizes: `sm` 32 h, 12 px x-padding, 13 px label · `md` 40 h, 16 px, 15 px · `lg` 48 h, 20 px,
  15 px. Touch layouts use `md` minimum with 44 px hit area.
- Variants:
  | Variant | Fill | Text | Shadow | Use |
  |---|---|---|---|---|
  | `default` | `--lm-raised` | `--lm-ink` | `--lm-shadow-key` + 1 px `--lm-edge` border | most actions |
  | `solid` | `--lm-ink` | `--lm-ink-inverse` | none | the single strongest non-run action in a view ("Open in Simulator") |
  | `quiet` | transparent | `--lm-ink` | none | tertiary, inline ("Copy week") |
  | `danger` | `--lm-raised` | `--lm-danger-fg` | key + `--lm-danger-edge` border | destructive ("Reset all data") |
  | `signal` | `--lm-signal` | `--lm-signal-ink` | key + 1 px `--lm-signal-edge` | **only** Run / Find plans |
- States: hover — `default` fill mixes 3 % ink (`color-mix(in oklab, var(--lm-raised), var(--lm-ink) 3%)`);
  pressed — `--lm-shadow-key-pressed`, `translateY(1px)`, 80 ms; focus — ring; disabled — as
  universal; loading — label stays, a 12 px ring spinner replaces the leading icon, width locked.

### Run key `<RunKey>` (signature)
- Round 56 px (desktop context bar: 44 px round + label to its left "Run"; mobile action bar:
  56 px round with "Run" label inside at 13/600). Yellow `--lm-signal`, 1 px `--lm-signal-edge`,
  `--lm-shadow-key`. Icon: none — the word is the icon.
- States: idle · **stale** (a 6 px ink dot at 1 o'clock on the key's rim = "inputs changed") ·
  running (label becomes elapsed seconds "1.2 s", a 2 px ink arc runs around the rim, the key
  stays pressed) · done (releases with needle ease, dot disappears) · disabled (no scenario days
  painted: `--lm-well` fill, faint label, tooltip "Paint at least one week first").
- Keyboard: `⌘/Ctrl Enter` from anywhere in the Simulator.
- Planner variant: pill 48 h "Find plans" (same colours), because the label is longer.

### Icon key `<IconKey>`
32 or 40 square, 20 px icon, same variants as Key minus `signal`. Requires `aria-label`.

---

## 2. Choice controls

### Key bank (segmented control) `<KeyBank>`
Braun push-button bank.
- Anatomy: a well (`--lm-well`, radius sm, `--lm-shadow-well`) containing 2–6 equal keys separated
  by 1 px `--lm-line`. Selected key: raised cap (`--lm-raised`, `--lm-shadow-key`) with a 6 px
  **yellow indicator dot** left of its label; unselected keys: flat, `--lm-ink-2` label.
- Sizes: `sm` 28 h (chart toolbar), `md` 36 h, touch 44 h.
- Behaviour: `role="radiogroup"`, arrows move + select, Home/End. Pressing a key animates the dot
  (fade 80 ms), never slides a highlight across.
- Variants: `text` · `icon` · `icon+text`. Up to 6 keys; more → Select.

### Switch `<Switch>`
A slide switch, 36 × 20 track (well), 16 px thumb (raised cap with thumb shadow). On: track
`--lm-ink`, thumb shifts, yellow 4 px dot appears inside the track at the left end. Label on the
left, lowercase engraved or sentence case. `role="switch"`.

### Checkbox / Radio
18 px, 1 px `--lm-edge`, radius 3 (checkbox) / full (radio). Checked: `--lm-ink` fill, inverse
check glyph 12 px. Used in lists (won't-do list, screening), never as the only toggle in a row
of settings (use Switch).

### Select `<Select>`
Well field 40 h with trailing chevron; opens a Popover list (not native on desktop; native
`<select>` on mobile). Selected option: bold check 16 px at left.

### Chip `<Chip>`
24 h, radius xs, 12/500 text, 8 px x-padding. Variants: `metric` (leading 8 px category-hue
swatch — a short 10 × 3 line-key for line metrics, 8 × 8 rounded square for bar metrics),
`filter` (toggle, pressed state = ink fill), `status` (info/caution/danger icon + label). Remove
affordance: trailing 16 px × (icon key, 24 hit).

---

## 3. Numeric controls

### Tuning scale slider `<ScaleSlider>` (signature)
A radio tuning window turned into a slider.
```
 body fat                                   23.4 %   ← readout rider (wide, tabular)
 ┌────────────────────────────────────────────────┐
 │▕▏▏▏▏▕▏▏▏▏▕▏▏▏▏▕▏▏▏▏▕▏▏▏▏▕▏▏▏▏▕▏▏▏▏▕▏▏▏▏▕▏▏▏▏▕ │ ← printed scale in the well
 │      ░░░░░░░░░░░█░░░░░░░                        │ ← optional likely-range underlay
 └──────────────────┃─────────────────────────────┘
                    ▼ thumb: 2 px ink needle + 14 × 18 cap
   10    15    20    25    30    35    40    45     ← lowercase numerals under majors (11 px, condensed)
```
- Anatomy: engraved label (left) · readout (right: value 15/600 wide tabular + unit 12
  `--lm-ink-2`) · track well 28 h (`--lm-well`, `--lm-shadow-well`, radius sm) with printed ticks
  (minor 6 px `--lm-line-strong`, major 10 px `--lm-edge`) · thumb = a 2 px `--lm-ink` needle the
  full well height + a 14 × 12 cap straddling the well's top edge (raised, `--lm-shadow-thumb`,
  radius 3, with a 1 px vertical grip line) · scale numerals under major ticks.
- Optional layers: **zones** (background tints in the well, e.g. energy deficit/surplus tints, or
  a `--lm-caution-bg` zone for unsafe values with a 1 px caution-mark edge) · **likely-range
  underlay** (a 4 px bar in `--lm-ink` @ 18 % showing the estimate's range) · **reference tick**
  (a labelled tick, e.g. "maintenance", "population median").
- Behaviour: drag anywhere on the well (jump-to-pointer on pointer, relative drag on touch to
  avoid accidental jumps). While dragging, the readout rides above the thumb (desktop) or stays
  pinned right (mobile) and updates every frame. Release → value snaps to `step` with needle ease.
  Wheel/trackpad: horizontal scroll adjusts when focused. Double-click readout → type a value.
- Keyboard: ←/→ = step; `⇧` = 10 × step; PgUp/PgDn = major tick; Home/End = min/max.
- A11y: native `<input type="range">` underneath (opacity 0, full size) for semantics;
  `aria-valuetext="23.4 percent body fat, likely 20 to 27"`.
- Sizes: `md` (Your body, day editor), `sm` 20 h well without numerals (dense lists).
- Tokens: needle `--lm-ink`; zones from energy/severity tokens; readout `readout` utility.

### Range slider (dual thumb) `<ScaleRange>`
Same anatomy with two needles; the selected span is a 4 px `--lm-ink` bar at the well's base.
Thumbs cannot cross; the pushed thumb stops (no swap). Readout shows "6–8 h". Used for eating-
window length limits, sleep window, step ranges in constraints.

### Stepper `<Stepper>`
Numeric field for exact entry (age, height, weight, grams).
- Anatomy: − key (40 × 40) · well field (value 17/500 wide tabular, unit 13 `--lm-ink-2` inside
  the field, right) · + key. Optional unit key bank beside it (`kg | lb`, `cm | ft in`).
- Behaviour: press-and-hold accelerates (400 ms delay, then 12/s, then 30/s after 2 s). Typing
  commits on blur/Enter; invalid → error state: 1 px `--lm-danger-fg` border + message below
  ("Weight must be 30–300 kg"). Imperial height uses two fields (ft, in).
- `inputmode="decimal"`, 16 px font on mobile.

### Energy scale `<EnergyScale>`
A ScaleSlider 40–140 % of maintenance with the **diverging zones** printed in the well
(deficit tints left of 100, surplus tints right), a "maintenance" reference tick at 100, and a
secondary readout under the main one: "−610 kcal · 1 930 kcal/day". A key bank on the right
toggles `% | kcal`. Values < 50 % show a caution zone; < 800 kcal absolute shows danger zone
(mark + label, see Warning).

### Macro-split editor `<MacroSplit>` (signature)
Two linked views of one state; the user can use either.

**A. Linked scales (default, all widths)** — energy is held constant.
```
 protein   ▕────────────█──────▏  2.0 g/kg · 150 g · 600 kcal   [lock]
 net carbs ▕───█────────────────▏   60 g · 240 kcal              [lock]
 fibre     ▕──────█─────────────▏   30 g   (not in energy balance: ~2 kcal/g shown in detail)
 fat       ▕──────────█─────────▏  121 g · 1 090 kcal            [lock]
 ────────────────────────────────────────────────────────────────
 ████████████▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░   1 930 kcal = 77 % of maintenance
 protein     carbs     fat            ← 1-row stacked bar, macro colours, 2 px gaps
```
- Moving one macro redistributes the energy difference across the **unlocked** others in
  proportion to their current energy share. If all others are locked, the moved slider is capped
  and the cap is shown as a hatched end-zone with tooltip "Unlock another macro to go further".
- Protein can be entered as g/kg body weight (default), g/kg lean mass, or grams (key bank).
- Holding `⌥/Alt` while dragging lets total energy change instead (the energy readout turns ink
  and shows the delta) — for users who think in grams.
- Alcohol appears only when "detail" is on; it takes energy like the others.

**B. Triangle (≥ 768 px, toggle "triangle")** — a ternary plot of energy share P/C/F.
- Equilateral triangle, 220 px side, faceplate `inset`; corners labelled "protein", "carbs",
  "fat" (engraved); 10 % gridlines as 1 px `--lm-chart-grid`; a dragged 16 px puck (raised cap
  with ink centre dot). Shaded region = the **safe zone** (protein ≥ 1.2 g/kg at current energy)
  in `--lm-ok-bg`; outside it the puck ring turns caution.
- Presets appear as small labelled ticks inside the triangle ("very-low-carb", "balanced",
  "high-carb low-fat", "protein-sparing"). Snapping within 3 % of a preset tick.
- Keyboard: arrows move along P (↑/↓) and C (←/→) axes in 1 % steps, fat is the remainder.
- Fibre and detail (fat types, sugars, sodium, alcohol) are separate scales under the triangle.

States: valid · over-constrained (caution text "Protein 2.0 g/kg needs at least 600 kcal") ·
detail collapsed/expanded.

### Detail disclosure `<DetailGroup>`
"More detail" rows (fat types: SFA/MUFA/PUFA/omega-3; sugars; sodium; potassium; water; alcohol;
caffeine; creatine) collapse under a quiet key with a count badge "4 set". Each is a compact
ScaleSlider `sm` with defaults shown as a reference tick ("typical").

---

## 4. Time controls

### 24 h clock ring `<ClockRing>` (signature)
A Braun clock face. Display and editor modes.
```
                 00
          22 ·   |   · 02
       20 ·  ╭───────╮   · 04        outer ring (14 px): eating window arc (ink @ 16 %)
         ·  ╱  fast   ╲  ·           meal dots on the ring (8–14 px, size ∝ kcal, macro pie)
     18 ─  │   16 h    │  ─ 06       inner ring (8 px): sleep arc (recovery hue @ 35 %)
         ·  ╲ 16:8    ╱  ·           training: 3 px arc ticks outside the ring (performance hue)
       16 ·  ╰───────╯   · 08        walking: dotted outside ticks (energy hue)
          14 ·   |   · 10            now-hand: 1.5 px yellow hand with 6 px counterweight dot
                 12
```
- Geometry: 0:00 at top, clockwise, 15° per hour. Diameter: 240 (desktop editor), 200 (mobile
  editor), 64 (day cell/list glyph, rings only, no labels).
- Centre readout: fast length "fast 16 h" (15/600) + window "16:8" (12 engraved) or, for multi-day
  fasts, "fast 36 h · ends Wed 20:00".
- **Editor**: the eating window is a dual-thumb arc — drag either end (thumbs are 18 px caps on
  the ring) or drag the arc body to move the whole window (length preserved). Meals are dots you
  drag along the arc; they cannot leave the window (dragging out extends the window, with
  confirmation tick). Tap empty ring → "add meal here". Training sessions drag as blocks outside
  the ring. Snap: 15 min; `⇧` = 5 min.
- Keyboard: focus cycles start-thumb → end-thumb → meals → sessions; arrows move 15 min.
- A11y: each thumb is an ARIA slider with `aria-valuetext="window starts 12:00"`; a text summary
  below the ring lists everything ("Eat 12:00–20:00, 2 meals: 12:30 (900 kcal), 19:00 (1 030
  kcal). Lift 17:30–18:30. Sleep 23:00–07:00.").
- Extended fasts (> 24 h): the ring shows a full-circle hatched fast ring and a small "+1 day"
  counter; the day editor switches to a multi-day timeline (see screens/simulator-schedule.md).

### Horizon picker `<HorizonPicker>`
KeyBank `1 · 2 · 3 · 4 · 6 months` + start date field (well, calendar popover). Shows end date
as a computed caption "ends Tue 23 Dec". Shortening the horizon warns if painted days will be
removed (with restore).

---

## 5. Schedule

### Program key `<ProgramKey>`
A reusable day configuration, presented as a preset key (Braun memory buttons).
```
 ┌────────────────────┐
 │ B ●  rest day       │  letter (15/700 wide) · indicator dot (yellow when armed for painting)
 │ 75 % · P2.0 C60 F…  │  energy % + macro summary (12, ink-2, condensed)
 │ ▓▓▓▓░░░░▒▒▒▒▒▒▒▒    │  8 px macro micro-bar (P/C/F energy shares, 1 px gaps)
 │ ◔ 16:8   ⌁ 8k steps │  window glyph + exercise glyphs (16 px)
 └────────────────────┘
```
- Fills the 188 px desktop tray column (≈ 88 px tall) / 142 × 76 on the mobile horizontal rail.
- States: default · armed (pressed cap + yellow dot; the painter cursor shows the letter) ·
  hover (shows "Edit" icon key) · in-use count badge ("23 days") · dragging (to reorder).
- Actions (context menu / long-press): Edit · Duplicate · Rename · Delete (only if unused, else
  "Replace with…").
- Program tray: vertical list left of the raster (desktop), horizontal rail above it (mobile);
  "+ New program" key at the end, with presets menu: *very-low-carb (≤ 30 g net)*, *balanced*,
  *high-carb low-fat*, *protein-sparing (≥ 2.5 g/kg, ≤ 50 % energy)*, *maintenance training day*,
  *surplus training day*, *water-only fast*, *refeed (higher carb, +10–20 %)*.

### Schedule raster (calendar painter) `<ScheduleRaster>` (signature)
Weeks as rows, days as columns — a chronobiology actogram.
```
            mon   tue   wed   thu   fri   sat   sun
 block ┊ wk 1 ┃ A 80 ┃ B 75 ┃ A 80 ┃ B 75 ┃ A 80 ┃ C 90 ┃ D ▪ ┃
 cut   ┊ wk 2 ┃ …
 ──────┊ wk 5 ┃ E110 ┃ …                                         ← block boundary: 2 px ink rule
```
- **Day cell** (desktop 88 × 64, mobile ≥ 44 × 52): fill = energy tint (diverging tokens;
  water-only fast = `--lm-energy-fast` ink with inverse text); top-left program letter
  (13/700); top-right energy % (12, tabular, condensed); bottom: 4 px macro micro-bar; glyph row
  (desktop only): training/walk/run/fast. Today/start marker: a 2 px yellow top edge.
  Override marker: a small ink triangle in the bottom-right corner when the day differs from its
  program. Warning marker: caution/danger corner flag (icon 10 px, never colour alone).
- **Phase column** (desktop 120 px, left): consecutive-weeks blocks as brackets with a name and
  summary ("fat-loss base · wk 1–4 · 78 %"); click selects the block; rename inline.
- **Selection**: click = select day; drag = rectangular or linear (row-wrapping) range — linear
  by default, `⌥` for rectangle (e.g. all Mondays); `⇧`-click extends; clicking a week label
  selects the week; the corner selects all. Selected cells get a 2 px ink inner ring.
- **Paint**: with a program armed, drag paints immediately (optimistic), 1 undo step per stroke.
  On touch: long-press (350 ms) starts paint/select, then drag; a single tap on a cell opens the
  day editor. Two-finger scroll moves the raster.
- **Bulk toolbar** (appears above the raster when ≥ 2 days selected, or as the bottom action bar
  on mobile): "Paint with ▾" · "Copy" · "Paste" · "Repeat to end" · "Clear" · "Edit selection…"
  (opens day editor in multi-edit: shows mixed values as "—" and applies only touched fields).
- Week operations (week label menu): Copy week · Paste to… (multi-select target weeks) · Insert
  week · Delete week · Mark as deload.
- Scroll: vertically, sticky weekday header; horizontal never (7 columns always fit).
- A11y: `role="grid"` with `aria-rowcount/colcount`, each cell `role="gridcell"` with a label
  "Tue 14 Oct, program B rest day, 75 % energy, 16:8 window, caution: low protein". Arrows move,
  space toggles selection, `P` paints, Enter opens editor.

### Preview strip `<PreviewStrip>`
Under the raster, aligned to it: a 48 px coarse projection (daily fat-mass line in body hue + a
ketosis band in keto ramp) computed in the worker's fast mode (< 100 ms). Caption left:
"preview · fat mass −3.9 kg · ketosis 18 days". Not interactive except click → Results. Updates
on every paint stroke end. Label says "preview" to set expectations; values are rounded.

### Day editor `<DayEditor>`
Desktop: docked right panel 392 px; mobile: bottom sheet (half → full).
- Header: date ("Tue 14 Oct · day 14 of 84"), program letter key, scope KeyBank:
  **this day · this block · all B days** — the scope decides what an edit changes; editing
  "this day" creates an override (triangle marker).
- Sections (collapsible, remembered): Energy (EnergyScale) · Macros (MacroSplit + detail) ·
  Meals & window (ClockRing editor + meal list) · Exercise (session rows + "add") · Sleep
  (ScaleRange bed/wake + quality KeyBank) · Modifiers (stress, caffeine, creatine…).
- Footer: "Reset to program B" (quiet) · prev/next day arrows · Done.
- Validation lives inline in the section; section header shows a caution mark if something
  inside needs attention.

### Session row `<SessionRow>`
One exercise session: type icon · type (resistance / walk / run / cycle / swim / HIIT / other) ·
time (from ClockRing) · duration Stepper · intensity (resistance: sets × RIR or "volume: hard sets"
+ muscle split KeyBank upper/lower/full; cardio: zone 1–5 KeyBank + optional pace) · remove.
Steps are a day-level field (ScaleSlider 0–30 000, reference tick at the user's typical).

---

## 6. Body

### Avatar `<BodyAvatar>` — see `AVATAR_SPEC.md`
Props: `params`, `view: "front" | "side" | "both"`, `mode: "edit" | "display" | "morph"`,
`compare?: params` (ghost), `showVisceral?`. Stage: `stage-dots` perforated well, radius lg,
height scale ticks on the left edge every 10 cm (engraved numerals every 50 cm).

### Avatar handles `<AvatarHandles>`
Edit mode only (pointer ≥ 768 px, and on touch after "Adjust on figure" toggle to avoid scroll
conflicts): 12 px round caps at waist, hips, chest, upper-arm on the front view; drag
horizontally changes the regional fat parameter, `⇧`-drag changes muscularity of that region.
Hover shows the region name and value. The sliders stay the accessible source of truth; handles
are `aria-hidden` shortcuts.

### Readout `<Readout>`
The live estimate unit (no card).
```
 body fat                  ← engraved
 23.4 %                    ← readout-md (32) wide tabular; unit 15 ink-2
 ├──────█──────┤ 20–27 %   ← RangeBar + range text (12, ink-2)
```
Variants: `md` (Your body), `sm` (22 px, readout strip), `inline` (15 px in sentences).
Updating: digits roll (each changed digit translates 6 px + fades, 120 ms) — the fixed-place
readout rule. Stale/unknown: "—" with caption "needs waist".

### Range bar `<RangeBar>`
A 64–120 px wide, 8 px tall glyph: 1 px `--lm-line-strong` axis, the likely range as a 4 px
bar in `--lm-ink` @ 22 %, the point estimate as a 2 × 8 px ink tick. Optional before/after:
ghost tick (`--lm-ink-3`) for the start value.

### Readout strip `<ReadoutStrip>`
A single Faceplate containing 4–6 readouts in a row divided by 1 px hairlines — never separate
cards. Each item: engraved name + category swatch, "start → end" (e.g. `24.1 → 19.8 kg`),
change (`−4.3 kg`, signed, `--lm-ink`), RangeBar for the end value. Mobile: horizontal scroll
rail with snap, items 168 px wide, first item flush with the gutter.

---

## 7. Metrics and charts (chart internals: `CHART_SPEC.md`)

### Metric picker `<MetricPicker>`
- Desktop: docked left panel 280 px (collapsible to a 44 px strip showing only swatches);
  mobile: sheet (full).
- Anatomy: search field · filter chips (grade A–D, "has target", "selected") · category groups
  (8, collapsible, each header: hue swatch 10 × 10 + name + count "3/7") · metric rows (32 h):
  checkbox, line-key swatch in category hue, name, unit (ink-3), GradeBadge `sm` on the right,
  (i) opens Explain.
- Footer: "Lanes: 9 · Overlay: 4 / 6" capacity readout, "Reset to default set".
- Behaviour: checking adds a lane at the end of its category group; in Overlay view, a 7th pick is
  refused with an inline message "Overlay shows up to 6 metrics. Switch to Lanes to see more."
- Default set (first run): fat mass, lean mass, scale weight, glycogen, blood ketones, hunger
  pressure, metabolic adaptation, energy expenditure (TDEE).

### Chart frame `<ChartFrame>`
Faceplate `flush` holding: toolbar (sticky) · event ribbon · inputs lane · outcome lanes · x-axis
(sticky bottom on desktop) · table-view twin. Specified in `CHART_SPEC.md §4`.

### Lane `<Lane>`
Label gutter (168 px desktop; on mobile the label sits above the plot as a 20 px row) with:
category swatch + name (12.5/600) on line 1; GradeBadge + unit (11.5 ink-2) on line 2;
value-at-crosshair (15/600 wide tabular) on line 3; collapse and focus icon keys on hover. Plot
area with its own y-scale and a 32 px tick-label column. Heights: strip 26 (focus mode), default
72 (64 mobile), focus 280 (220 mobile).

### Legend chip `<LegendChip>`
For multi-series plots (overlay, comparison, inputs lane). 24 h, key glyph (line 14 × 2 with the
series dash pattern and marker, or 10 × 10 rect for bars) + name (12/500, ink). Click = isolate
toggle (others dim to `--lm-chart-dim-alpha`); `⌥`-click = hide. Hidden state: text ink-3 and
key hollow. Order = series order; never re-sorted by value.

### Crosshair readout (tooltip) `<CrosshairReadout>`
Desktop: a floating panel following the crosshair on the side with more room; mobile: docked
panel above the chart (never covering the finger). Header: date/time ("Tue 14 Oct · day 14" or
"Tue 14 Oct 18:00") + phase name. Rows: line-key, **value** (15/600 tabular, ink), unit, likely
range (12, ink-2), name (12, ink-2) — values lead. Events at this time listed at the bottom
("Ketosis entered · 06:00").

### Event marker `<EventMarker>`
A 1 px vertical tick through the event ribbon with a 12 px glyph on a surface ring: ketosis
entered/exited (keto drop glyph), glycogen depleted, refeed, fast start/end, safety flag
(caution/danger icon). Labels appear on hover/focus and when zoomed to ≤ 4 weeks.

### Phase band `<PhaseBand>`
Schedule blocks behind every lane: alternate blocks tinted `--lm-chart-phase-alt`, block
boundaries as 1 px `--lm-line` verticals, block names in the top ribbon (12 engraved,
truncated with full name on hover).

### Grade badge `<GradeBadge>` (evidence badge)
```
 [A ●●●●]   [B ●●●○]   [C ●●○○]   [D ●○○○]
```
- 20 h (`md`) / 16 h (`sm`), radius xs. Letter 12/700 wide + 4 pips (4 px circles, 2 px gap).
- A: ink fill, inverse letter, pips inverse · B: ink-2 fill · C: transparent with 1 px
  `--lm-grade-c-edge` · D: transparent, **dashed** 1 px `--lm-grade-d-edge`, letter ink-2.
- Tooltip / `aria-label`: "Evidence grade B: a few human trials or consistent human mechanistic
  data." Click → Explain.

---

## 8. Planner

### Goal rank list `<GoalRankList>`
A vertical, drag-sortable list; rank is information, so ranks are numbered.
```
 ⠿ 1  ● Fat mass        lose  [ 10.0 kg ]  by wk 16          must ▾   ×
      │ pulls against #3 — fasting vs muscle                              ← conflict connector
 ⠿ 2  ● Lean mass       keep  (± 0.5 kg)                     should ▾ ×
 ⠿ 3  ● Autophagy signal  raise  ↑                            nice ▾   ×
```
- Row 56 h: drag handle (⠿ drawn as 6 dots, 44 hit) · rank numeral (17/700 wide) · metric chip ·
  goal type KeyBank (`lose / keep / gain` for masses; `raise / lower` for directional; `reach`
  for targets) · target Stepper (if targeted) · priority strength Select (must / should / nice) ·
  remove.
- Drag: lift (raised shadow, 2° no rotation — flat lift only), others slide 200 ms; keyboard:
  focus handle, Space to pick up, ↑/↓ to move, Space to drop; live region announces "Fat mass
  moved to rank 1".
- **Conflict connector**: when two goals conflict (engine synergy matrix), a 1 px ink-3 bracket
  links them on the left with a one-line caption; synergy shows the same bracket in ok-fg with
  "helps #1". Tap caption → explanation popover.

### Constraint panel `<Constraints>`
Faceplate with: horizon (HorizonPicker) · training days/week KeyBank 0–7 · session length max
Stepper · eating window: allowed length ScaleRange (4–16 h) + allowed clock span ClockRing
(display with draggable span) · longest fast I'd do KeyBank (none · 16 h · 24 h · 36 h · 72 h; **v0.2: none · 16 h · 24 h · 48 h ·
72 h**, default follows the fasting opt-in — 48 h with the 48 h opt-in, 72 h with the 72 h opt-in, else
24 h — so ticking an opt-in can no longer be silently undone by this key) ·
**won't do** checklist (no fasting days, no alcohol changes, no running, no calorie cycling, no
supplements, keep weekends at maintenance…) · minimum protein floor (defaults to evidence
minimum, can only go up).

### Optimiser progress `<OptimiserProgress>`
Faceplate, centred on desktop, full-width on mobile.
- **v0.2:** four slots **Hard · Medium · Easy ‖ Ideal** (rung colours; the Ideal slot hollow, dashed
  ink) that fill as provisional rungs arrive; a slot that collapses shows its one-line reason instead
  of filling (see `screens/plan-ladder.md §6.4, §8`). The chart plots "best result for goal 1" and "ladder
  coverage" against evaluations; counters read "plans tried 12 400 · 38 s".
- (v0.1) Top: 3 slots A/B/C as plan-colour outlined keys that fill as feasible candidates are found.
- Middle: "Best plan score" line chart (x = iterations, y = score, one line per slot, 120 h),
  plus counters in readout style: "candidates 1 840 · feasible 612 · 4.1 s".
- Bottom: Cancel (quiet key) — "Stop and keep the best so far".
- Honest estimate: a thin progress rule with estimated remaining time only after 1 s of data.

### Plan card `<PlanCard>` — superseded in v0.2 by `<LadderCard>` (§13.6)
```
 ┌───────────────────────────────────────────┐
 │ [A] Steady deficit, carb-periodised        │ plan letter key in plan colour + name
 │ 16 weeks · 3 phases · difficulty ●●●○○     │
 │ ▓▓▓▓▓▓▓▓│▓▓▓▓▓▓│▒▒▒▒                       │ phase timeline strip (energy tints)
 │ 1 Fat mass −10 kg      ✓ reached  −10.4    │ scorecard in priority order
 │ 2 Lean mass keep       ✓ −0.3 kg           │ (icon + label + number, never colour alone)
 │ 3 Autophagy ↑          ◐ partial  +18 %    │
 │ hunger: moderate · 2 fasts/week · 4 lifts  │ practical summary
 │ safety: no flags                           │
 │ [Compare]  [Details]  (Open in Simulator)  │
 └───────────────────────────────────────────┘
```
- Width 360 (desktop, 3 across) / 100 % − 32 (mobile, horizontal snap rail with 16 px peek of
  the next card and a 3-dot position indicator).
- Selected card: 2 px `--lm-ink` edge and pressed letter key.
- Scorecard status glyphs: reached (check), partial (half disc), missed (open circle + "not
  reachable"), and a numeric result with range.

### Difficulty meter `<DifficultyMeter>` — superseded in v0.2 by `<BurdenScale>` (§13.7); the
word scale (easy … very hard) is retired because it collides with rung names
5 pips (6 px) + word (easy / moderate / demanding / hard / very hard) + "why" tooltip listing
drivers ("hunger pressure peaks at 72/100 in week 9; two 36 h fasts per week").

### Phase timeline `<PhaseTimeline>`
Horizontal strip, full width of its container, height 28 (card) / 44 (detail). Each phase a
segment with energy tint, 2 px surface gaps, name + weeks inside when it fits (else tooltip).
Hover/tap → phase summary popover (energy, macro split, window, training).

---

## 9. Feedback

### Warning banner `<Banner>`
Full-width inside the content column (not a toast). Anatomy: 20 px icon (info circle / caution
triangle / danger octagon) · title (15/600, severity fg) · body (15, ink) · actions (keys) ·
dismiss (only for info). Tokens: bg `--lm-<sev>-bg`, 1 px `--lm-<sev>-edge` border all round,
radius md. **No thick coloured left border.** Danger banners cannot be dismissed while the
condition holds; they can be collapsed to a one-line summary.

### Inline warning `<InlineWarning>`
Inside controls/sections: icon 16 + one sentence (13, severity fg) + optional fix link.

### Warnings panel `<WarningsPanel>`
Results side/bottom panel listing all warnings sorted by severity then date: each row = icon,
title, date range ("days 15–35"), "Show" (moves crosshair + highlights range in chart) and
"Fix" (jumps to schedule with the days selected). Count badge in the toolbar: "2 cautions".

### Toast `<Toast>`
Raised, radius md, shadow pop, 13/500, max 360 wide. Auto-dismiss 5 s (pause on hover/focus),
optional single action ("Undo"). `role="status"`. Never for errors that need action.

### Tooltip `<Tooltip>`
Ink fill (inverse text) 12/500, radius xs, 6 × 8 padding, 400 ms delay, 0 ms on subsequent
tooltips within 1 s. Never holds essential info.

### Progress rule `<ProgressRule>`
2 px line at the top of the region that is working (chart frame, optimiser card) in `--lm-ink`,
indeterminate = a 30 % segment sliding (1.2 s linear), determinate = width. With reduced motion:
static text "Running…".

### Empty state `<EmptyStage>`
Perforated `stage-dots` region, centred: a 40 px authored line illustration in ink-3 (e.g. a
tiny raster with a paint stroke), a sentence headline (17/600), one line of help (15, ink-2), one
primary key. No cartoon mascots.

---

## 10. Overlays

### Drawer `<Drawer>` (desktop)
Docked side panel (392 px) that pushes content when the viewport ≥ 1280, overlays (with
`--lm-shadow-drawer`, no scrim) below that. Header with title + close. `Esc` closes. Focus moves
to the drawer title on open and back to the invoking control on close.

### Sheet `<Sheet>` (mobile)
Bottom sheet, radius xl top corners, `--lm-shadow-sheet`, scrim `--lm-scrim` (except in peek
detent), detents 35 / 60 / 92 %, drag handle, swipe-down to close, `--lm-ease-sheet` 320 ms.
Content scrolls inside; the sheet header stays. Uses `<dialog>` semantics when modal (full
detent), `role="region"` in peek.

### Dialog `<Dialog>`
Only for destructive confirmation, import preview and the first-run consent. Centred Faceplate
max 480, scrim, focus trap, `Esc` = cancel (except consent). Destructive dialogs require the
action verb on the key ("Delete scenario"), never "OK".

### Popover `<Popover>`
Menus, date picker, conflict explanations. Raised, radius md, shadow pop, 8 px offset. Portaled
(escapes overflow). Arrow keys navigate menu items; typeahead.

---

## 11. Navigation

### Rail `<NavRail>` (≥ 1024) and Tab bar `<TabBar>` (< 1024)
See `INFORMATION_ARCHITECTURE.md §3`. Both are KeyBanks: selected destination = pressed key +
yellow indicator dot. Badges: 6 px ink dot for "stale results" on Simulate.
**v0.2:** the destination set follows the mode (`INFORMATION_ARCHITECTURE.md §3.4–§3.6`): 4 keys in
Planning, 5 in Living, and in the planning override the first slot is the return key "today ↩"
(glyph `undo-2`, label `today`). The rail gains a lower group (evidence · planning · settings ·
theme) separated by a hairline, and a plan-day readout under the wordmark ("day 15 / 84", 11 px
condensed tabular, ink-2). Coach's badge is a 6 px ink dot = "a proposal is waiting"; never a count.

### Context bar `<ContextBar>`
Sticky 56 h, `--lm-chassis-2` with a 1 px `--lm-line-strong` bottom rule. Left: title or switcher
(17/600 display width); middle: local KeyBank tabs; right: parameters + primary key.

### Scenario switcher `<ScenarioSwitcher>`
Title with chevron → popover (desktop) / sheet (mobile): list of scenarios (name, horizon, last
run, stale dot), actions: New · Duplicate · Rename · Delete. Current = check.

---

## 12. Data table `<DataTable>` (table view twin)
Sticky header + first column, 13 px condensed tabular numbers, right-aligned values, row hover
wash (`--lm-ink` @ 4 %), zebra none, 1 px row rules. Columns: date/time + each visible metric
(value and range as "19.8 (18.6–21.0)"). Download CSV key. Virtualised above 500 rows.

---

## 13. v0.2 primitives (intake, ladder, Living mode, Coach, scores)

Shared rules for everything in this section:
- **Uncertainty travels with the number.** Any estimated, logged-by-AI, measured or projected value
  renders as value + likely range (80 %) + source, using `EstimateReadout` / `SourceChip` (§13.12).
- **Chrome stays achromatic.** New state encodings (adherence, change states, burdens, rung
  selection) use ink, fill, hollow, dash and hatch — never green/red. Category and rung hues appear
  only on data marks and on **identity keys** that stand for a series (a rung key, a metric swatch,
  an optimiser slot) — the same exception the v0.1 plan letter keys and lane swatches use.
- **No yellow on Living screens** except the now-hand and indicator dots: there is nothing to "run".
  The yellow key returns only where a planner or simulation run starts (Find plans, Run, and the
  "Find plans with these limits" key on the Ideal).
- **Quiet mode** (`TodayView.quietMode`): components that show restriction-adjacent numbers (remaining
  energy, adherence, weight, kcal of a meal) take a `quiet` prop and render the category vocabulary
  in §13.9 instead; a quiet "show numbers" key reveals the number for that view only.

### 13.1 Intake turn `<IntakeTurn>` (onboarding-intake-v2)
One question in the conversation-like intake. Turns stack in a single column; answered turns
collapse into receipts.
```
 ┌──────────────────────────────────────────────┐  active turn (no box: spacing + hairline above)
 │ On a work day, what are you mostly doing?    │  prompt 17/600, sentence case, ≤ 2 lines
 │ why we ask ▾                                  │  quiet disclosure, 12 engraved
 │ ┌──────────────┐┌──────────────┐┌───────────┐ │  AnswerKey grid: 2 cols ≤ 767, 3–5 cols ≥ 768
 │ │ ▭ sitting at ││ ▭ a mix of   ││ ▭ on my   │ │  each key 64–88 h: 20 px glyph · label 15/500 ·
 │ │ a desk or    ││ sitting and  ││ feet most │ │  examples 12 ink-2 ("office, driving, call centre")
 │ │ driving      ││ moving       ││ of the day│ │
 │ └──────────────┘└──────────────┘└───────────┘ │
 │ if you skip: a mix (most common)   ask me later│  default line 12 ink-3 · Key quiet sm
 └──────────────────────────────────────────────┘
 receipt (answered):  on a work day · desk or driving ·················· change
                      12 ink-2 question · 15 ink answer · quiet "change" key
```
- **Answer types**: `single` (AnswerKey grid; commits on press, advances after 240 ms so the pressed
  state is seen) · `multi` (Chip `filter` grid + Key "Done (4)") · `number` (Stepper with a row of
  preset Chips: "4 000 · 6 000 · 8 000 · 10 000 · 12 000"; a preset tap commits) · `scale`
  (ScaleSlider/ScaleRange with Done) · `rows` (repeatable mini-rows, e.g. sport: text + KeyBank
  light/moderate/hard + minutes Stepper) · `text` (free text with suggestions).
- **AnswerKey** states: default (raised), pressed (ink fill, inverse text, yellow 6 px dot top-left),
  focus ring, disabled-with-reason. The default answer carries an engraved "default" tag; nothing is
  preselected — the default applies only on skip.
- **Ask me later**: records `skipped` for that question, applies the shown default, collapses to a
  receipt "using 7 000 steps · asked later" with a hollow dot.
- **Why we ask** opens inline (not a tooltip): one or two sentences naming what the answer changes
  ("Your job sets about a third of the energy you use outside training.").
- Motion: the next turn enters from 8 px below with opacity, 240 ms `--lm-ease-needle`; the column
  scrolls so the active prompt sits at 35 % of the viewport. Reduced motion: no translate.
- A11y: each turn is a `fieldset` + `legend` (the prompt). Single-choice AnswerKeys are a group of
  **buttons** with roving focus — arrow keys move focus only, Space/Enter commits, the chosen key
  carries `aria-pressed="true"` (not a radiogroup: radios select on arrow keys, and these commit and
  advance); multi-select keys are a checkbox group; the receipt is a button "Change: on a work day,
  desk or driving".
  Focus moves to the next legend after commit; a polite live region announces the receipt.

### 13.2 Driver bar `<DriverBar>` (maintenance and what drives it)
```
 maintenance                     about 2 740 kcal a day    likely 2 390–3 090
 ▕█████████████████████▌▓▓▓▓▌▒▒▒▌░░▌▒▒▒▒▒▒▕            ← 20 px stacked bar, energy hue in 2 steps
  resting metabolism    every- steps home digest-          + direct labels under segments ≥ 56 px
  1 855                 day    266   68   ing 274            (else a leader to the table)
 ┊ dashed outline = this part uses a default (you skipped the question)
```
- Segments in fixed order: resting metabolism · everyday living · steps · work beyond sitting ·
  home · commute · sport and hobbies · training · digesting food. Zero segments are omitted.
- Fill: `--lm-cat-energy` at 100 % / 55 % alternating, 2 px `--lm-face` gaps; a segment whose answer
  was defaulted gets a 1 px dashed ink outline (dash = "assumed"); never colour alone — labels or the
  table always carry identity.
- **Table twin** (always rendered under the bar on < 768, collapsible on ≥ 768): rows "part · kcal ·
  from" ("steps · 266 · about 6 700 a day, from your answers · change"). Each row's "change" jumps to
  the question that set it.
- **What-if handles** (optional `whatIf` prop): a steps ScaleSlider `sm` and a work-class KeyBank
  under the table re-compute the bar live (closed form, no engine run); a quiet "Keep these" commits.
- Readout uses `Readout` `md`; the band is the 80 % range (±1.28 σ), rounded to 10 kcal.

### 13.3 Frame slider `<FrameSlider>` (figure drawing only)
A `ScaleSlider` variant with silhouette end-caps instead of numerals.
```
 frame                                   about even        ← readout = drawn shoulder:hip word
 [◖▯◗]▕▏▏▏▏▕▏▏▏▏▕▏▏▏▏┃▏▏▏▏▕▏▏▏▏▕▏▏▏▏▕▏▏▏▏▕[◗▯◖]
  hips-led                  ▲ centre tick           shoulders-led
 Only changes the drawing. Your estimates don't change.   Match my basics
```
- Range 0–1, step 0.01, keyboard ←/→ 0.05, PgUp/PgDn 0.25, Home/End. Centre tick at 0.5.
- End-caps: 24 × 32 px outline silhouettes (front torso, no head detail), `aria-hidden`.
- Readout and `aria-valuetext` are five bins of the **drawn** shoulder-to-hip breadth ratio:
  "hips clearly wider than shoulders" · "hips a little wider" · "about even" · "shoulders a little
  wider" · "shoulders clearly wider than hips" (cut-points in `body-figure-v2.md §5.4`).
- Forbidden strings on or near the control: female, male, man, woman, masculine, feminine, neutral,
  type A/B, body type. Lint them in the component's copy test.

### 13.4 Cross-section `<CrossSection>` and side cutaway `<SideCutaway>` (visceral view)
Specified in full in `screens/body-figure-v2.md §6`. Primitive contract:
- Props: `slice: { outer: {a, b, phi}; satAreaCm2; wallAreaCm2; organsAreaCm2; vatAreaCm2;
  vatRangeCm2: [lo, hi] }`, `compare?: slice` (ghost), `size: 'xs' | 'sm' | 'md' | 'lg'` (160 / 200 /
  240 / 320 px square; `sm` is the mobile Body size, with ring labels inside the frame), `reference: [100, 130]`, `quiet?`.
- Layers, outside in: skin line (1.25 px `--lm-avatar-outline`) · subcutaneous ring
  (`--lm-avatar-fat`) · muscle wall (`--lm-avatar-wall`) with two psoas bulges and the spine at the
  back · organ region (`--lm-avatar-organ` + `--lm-avatar-organ-line` loops) · visceral fill
  (`--lm-avatar-visceral`, lobulated outline) · uncertainty halo (visceral at
  `--lm-avatar-halo-alpha`, between the low and high contours) · reference rings (1 px ink, dashed
  `2 3`, labelled "100" and "130" in 11 px condensed outside the section at 2 o'clock).
- The drawing is to scale in cm² (equal-area contours); a 10 cm scale bar sits under it.
- Every layer boundary is a 1 px `--lm-avatar-outline` line (≥ 3:1 against both neighbours in
  both themes); with "patterns in charts" on, the subcutaneous ring gets a fine dot pattern and the
  visceral fill a 45° hatch.
- `role="img"`, label generated per `body-figure-v2.md §8`; a table twin lists the four areas.

### 13.5 Ladder scale `<LadderScale>` (the ladder at a glance)
```
 goal 1 · fat mass             ceiling (Ideal) −9.4 kg ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
 −10 ┤                                     ● Hard −8.1
  −5 ┤                  ● Medium −6.9 ╱
   0 ┤   ● Easy −4.2 ╱─────╯
     └────┬─────────┬─────────┬─────────┬────▶ effort
          20        40        60        80   100
```
- 96 h (desktop) / 72 h (mobile); x = effort 0–100 (D × 100), y = goal 1 change in its unit; rung
  markers 10 px in rung colours with direct labels ("Hard −8.1"); a 1 px ink-3 frontier joins them;
  the Ideal is a dashed `--lm-rung-ideal` horizontal **ceiling line** with its label, not a point
  (its effort is measured against limits it ignores).
- Clicking a marker selects that rung (same as clicking its card); arrow keys move between markers.
- Collapsed rungs are absent; a single-rung ladder draws one marker and the ceiling.
- A11y: `role="img"` + summary "Hard reaches −8.1 kg at effort 64; Medium −6.9 at 41; Easy −4.2 at
  18; without your limits −9.4."

### 13.6 Ladder card `<LadderCard>` (replaces PlanCard)
```
 ┌ H ┐ Hard                               effort 64 ┐  rung key 24 × 24 (rung colour fill, inverse
 └───┘ Deficit 22 % · 4 sessions · 16:8 window      │  initial) · title 17/600 · effort readout
 ▓▓▓▓▓▓│▓▓▓▓│▒▒▒▒                                   │  PhaseTimeline 28
 goals ─────────────────────────────────────────── │  section labels are engraved hairline rules
 1 fat mass    −8.1 kg   ├──█──┤ 6.9–9.2    ✓ 15 wk │  rank · metric · value · RangeBar · verdict
 2 lean mass   −0.4 kg   ├─█───┤ −0.9–0.1   ✓ kept  │  + time to target (target goals)
 effort ────────────────────────────────────────── │
 BurdenScale ×7 (compact)                           │
 day to day ────────────────────────────────────── │
 hunger moderate, peaks wk 9 · 4 h training a week  │
 fasting none · a weekly 24 h fast was considered › │  FastingVerdict one-liner + "why" popover
 to make it work ───────────────────────────────── │
 nothing to buy                                      │  or ShoppingItem rows
 limits it presses ─────────────────────────────── │
 3 training days (71 % of days) · window 8 h        │
 safety ─────────────────────────────────────────── │
 ✓ within safety limits                              │
 [ Start this plan ]          Open in Simulator      │  solid on the selected card only
 └──────────────────────────────────────────────────┘
```
- One card per rung; sections are **row-aligned across cards** (CSS subgrid over a shared row
  template), so goal 1 sits on the same line in every card. Goal rows never re-sort.
- Widths: ≥ 1320 four columns `repeat(3, minmax(280px, 1fr)) 1px minmax(280px, 1fr)` (the 1 px
  column is the "your limits" rule); 1024–1319 a 2 × 2 grid; 768–1023 a 2-up rail; mobile a snap
  rail, 100 % − 32 px, 16 px peek, `scroll-padding-inline: 16px`. Below 768 the Start key lives in
  the action bar, not on the card.
- **Selected**: 2 px ink edge, rung key pressed (inset), yellow dot left of the title; the solid
  "Start this plan" key appears only on the selected card (one solid key per view).
- **Ideal variant**: 1 px dashed `--lm-rung-ideal` edge (`4 3`), hollow rung key with "I", title
  "Ideal" + engraved "scientific ceiling", BurdenScale bars may run past the limit tick into a
  hatched zone, an extra section **what your limits cost** (§13.7 LimitCost rows), and the action
  **Adopt some of these limits** (default key). Never a Start key.
- **Collapsed slot**: a rung that was dropped keeps its column as a 1-line slot with the engraved
  rung name and the reason ("medium · not distinct: Easy already reaches 95 % of Hard's fat loss").
- States: provisional (while the run continues: values in ink-2, "provisional" engraved, no Start),
  stale (60 % opacity + "Goals changed · Find plans again"), outside current safety mode (caution
  mark, Start disabled with reason).
- A11y: each card is an `article` (so its keys and links stay reachable — not `role="radio"`);
  the title row is a toggle button named "Select Hard plan: fat mass −8.1 kilograms, effort 64 of
  100" with `aria-pressed`. Section rows are a description list.

### 13.7 Burden scale `<BurdenScale>` and limit cost row `<LimitCostRow>`
```
 effort 64 / 100 · hardest part: hunger
 deficit          ├───────────█───┤        18 % below maintenance, your limit 25 %
 hunger           ├──────────────█┤        peaks 74 / 100, near your limit
 training time    ├────────█──────┤        4 h a week, 2 h more than now
 fasting load     ├───────────────┤        none
 eating window    ├─────█─────────┤        8 h, 3 h shorter than now
 daily decisions  ├───█───────────┤        2 day types, 1 new supplement
 change from now  ├──────█────────┤        moderate
                  now          your limit   (the left end is today's habit, the right tick your limit)
```
- Seven rows in fixed order (`deficit, hunger, trainingTime, fastingLoad, windowTightness,
  decisions, habitDistance`), labels as above (engraved, lowercase). Bar: 8 px well, ink fill to
  `c_i`, 1 px ink tick at the limit, value text from `DifficultyComponent.text`.
- **Inactive** burden (`active:false`): no bar; text in ink-3 "no room to change here (your limit
  is where you are now)". It still counts in the /7 — the header carries a footnote "effort averages
  all seven parts".
- **Ideal**: the bar may extend beyond the limit tick into a 45° hatched zone ("beyond your limit").
- Compact (card) size: 6 px bars, text truncated to the value; full text in the Overview tab.
- LimitCostRow: `allowing 5 training days instead of 3 · +0.6 kg fat loss by week 12 · effort +9`
  — group label, from → to, goal deltas with units, ΔD; top 3 shown, then "together, through
  interactions: +0.3 kg" when the remainder is non-zero.

### 13.8 Date strip `<DateStrip>` (Living: Today, Food, Train)
A week as seven day keys on one row; the instrument's date dial.
```
  mon   tue   wed   thu   fri   sat   sun        ‹ ›   week arrows (IconKey) at the ends
  13    14   [15]   16    17    18    19
  ◔     ◕     ◍     ·     ·     ·     ·          16 px AdherenceDial glyph (past) · hollow dot (future)
```
- Key 44 × 56 (touch) / 40 × 52 (pointer); today = pressed + yellow dot; selected (other date) =
  2 px ink ring; paused days show a 1 px ink-3 strike line; plan start/end days carry a 2 px ink
  bracket on their outer edge.
- Swipe (touch) or ‹ › changes week; `[` `]` move one day. `role="tablist"`-like radiogroup with
  `aria-label="Wed 15 Oct, today, adherence so far 62"`.

### 13.9 Adherence dial `<AdherenceDial>` (the "adherence ring")
A **composition dial**, not a progress ring. The circle is always the whole day's prescription,
divided into arcs by each item's weight; each arc shows what happened to that item.
```
          ·  ━━━━━━  ·            arcs clockwise from 12, in prescription time order
        ━━            ┃           done      = solid ink arc (3 px)
       ┃      80       ┃          partial   = ink for the credit share, then hollow outline
        ┃   so far    ┃           missed    = hollow outline arc (1 px --lm-edge)
          ┈┈┈      ━━             unknown   = dashed hairline (2 2, ink-3) — not counted
                                  2 px gaps between arcs; a 1 px hairline circle underneath
```
- Sizes: `glyph` 16 px (arcs only, no number) · `sm` 64 px (number 17/600 wide tabular) · `md`
  120 px (number 32, plus "so far"/coverage inside the lower third).
- The number is `AdherenceScore.score`; null → "—" with "not enough logged". Coverage < 0.6 →
  caption under the dial "based on 3 of 5 items". Unconfirmed day → "so far".
- **Never**: green/red, a sweep animation to completion, a "closed ring" celebration, a streak
  count, or a goal ring at 100. Arc state changes cross-fade 140 ms; reduced motion: instant.
- Hover/focus an arc → Tooltip "Lunch · protein 31 of 40 g · counted 80 % · carried 15 % of today".
  Click → scrolls to that checklist row.
- **Quiet vocabulary** (also used by other quiet components): ≥ 85 "as planned" · 60–84 "mostly" ·
  30–59 "partly" · < 30 "a little" · null "not enough logged". In quiet mode the centre is empty and
  the word sits under the dial.
- A11y: `role="img"` with a full sentence ("Adherence so far 62 of 100, based on 4 of 6 items:
  breakfast done, lunch 80 percent, run not logged…") plus a visually hidden table.

### 13.10 Prescription row `<PrescriptionRow>` (Today checklist, Food meals, Train items)
```
 07:30  ◍ breakfast        520 kcal · protein 35 g             [✓]  ›
 12:30  ◍ lunch            plan: dal, rice, curd   ≈ 640 · 33 g [◐]  ›   partial: tap › for detail
 17:30  ⊟ lift · 45 min    mudgar swings, dand, baithak         [ ]  ›
 —      ⌁ steps            9 000                 6 120 · ring ⌁ [ ]
 —      ◷ fast             until 12:30 · 14 h done, 2 to go     [ ]
```
- Columns: time (13 condensed tabular, ink-2) · glyph 20 · label (15/500) + target/plan (13 ink-2) ·
  logged value as `EstimateReadout` inline · **tick key** 44 × 44 · chevron IconKey.
- Tick key states: empty (well) · done (ink fill, inverse check) · partial (half fill) · skipped
  (hollow with a 1 px diagonal) · device-covered (small source glyph inside, e.g. ring) · assumed
  (dashed outline; backfilled days).
- One tap on an empty tick = "as planned" (dispatches the row's `command`); tap again within 5 s =
  undo. The chevron (or long-press, or `⇧Space`) opens the row sheet: **as planned · partly ·
  skipped · something else** (+ the item's detail editor).
- Rows are sorted by time; untimed rows (steps, sleep, supplements) follow under a hairline.

### 13.11 Change card `<ChangeCard>` (AI and agent actions; also Today proposals)
One component, four looks keyed by confirmation class. Standalone (Today, Settings › Agents) it
renders as a Faceplate; inside the Coach conversation it renders as an inset region (`--lm-well`
fill, 1 px `--lm-line`, radius md) so faceplates are never nested.
```
 read      ⌕ looked at  today's log · 14 nights of sleep · plan v3                   ▸ (expand)
 ─────────────────────────────────────────────────────────────────────────────────────────────
 log       ✓ Logged lunch · 13:10                        Coach · photo + text  · 23 h to undo
           dal         1 katori ≈ 150 g (110–200)        180 kcal
           rice        1 cup ≈ 160 g (120–210)           210 kcal
           eggs        2 ≈ 100 g (90–110)                150 kcal
           total ≈ 640 kcal (510–780) · protein 33 g (25–41)
           [Edit]  [Undo]
 ─────────────────────────────────────────────────────────────────────────────────────────────
 edit      ◇ Proposal · no training Thu–Sat                         expires in 23 h
           Thu 16  lift 45 min      →  rest, your usual steps
           Fri 17  run 30 min       →  rest
           Sat 18  lift 45 min      →  rest
           goal date   ├──▓▓▓▓──┤ 21–30 Dec   →   ├───▓▓▓▓──┤ 23 Dec–2 Jan
           fat mass by the end  −8.1 → −7.9 kg
           [Apply] (solid)  [Adjust]  [Discard] (quiet)
 ─────────────────────────────────────────────────────────────────────────────────────────────
 confirm   ⬣ Needs your confirmation · end "Spring cut"
           Ends the plan today. Logs and versions are kept; you can restore it for 7 days.
           [Review and confirm…]   [Not now]
 ─────────────────────────────────────────────────────────────────────────────────────────────
 blocked   ▲ Not allowed by your safety settings · a 48-hour fast
           Your fasting opt-in allows up to 24 hours. Options:
           [Plan a 24-hour fast instead]  [Leave it]
```
- Marks (16 px, ink): read `search`, log check, edit hollow diamond, confirm danger octagon (mark in
  `--lm-danger-mark`), blocked caution triangle (mark in `--lm-caution-mark`). Colour on marks only.
- Header line: title (15/600) · `SourceChip` (who + how) · time left (undo window or expiry).
- `items[]` render as a 3-column diff (label · before · after); for logs, components with gram chips.
- `impact.goalDates` render as two mini RangeBars on a shared date axis (before → after); metric
  impacts as signed deltas with units.
- **States**: applied (as drawn) · pending (edit) · undone (title struck, ink-3, "Redo" quiet key) ·
  discarded (collapsed to one line, ink-3) · expired ("Expired — ask again") · stale (caution mark:
  "Something changed since this was proposed. Updated version:" + refreshed diff; Apply re-enabled
  only on the refreshed version).
- **Rules**: Apply is never pre-focused; Undo is visible for the whole undo window; destructive
  cards never carry the action itself — "Review and confirm…" opens the typed-confirmation Dialog,
  which only the person can complete (the token is minted in the dialog).
- A11y: `role="article"` with `aria-labelledby` the title; actions are buttons named with the
  object ("Undo logged lunch"); state changes announced politely.

### 13.12 Source chip `<SourceChip>` and estimate readout `<EstimateReadout>`
- **SourceChip** (Chip `plain` 24 h): glyph + who · how: "you · typed", "you · as planned",
  "Coach · photo", "Coach · photo + your grams", "Coach · text", "label", "ring · Colmi R10",
  "watch · Apple", "import · Health Connect", "assumed" (dashed outline). Tap → popover with the
  method, confidence ("Coach was fairly sure: 0.72"), and the band rule ("photo only: about ±35 %
  for energy").
- **EstimateReadout**: value (tabular) + unit + "(likely lo–hi)" in ink-2 + optional SourceChip.
  Short form in rows: `≈ 640 kcal (510–780)`. AI-estimated and photo values always use "≈".

### 13.13 Equivalence meter `<EquivalenceMeter>` (Train swaps and logs)
```
 same stimulus   92 %   ├───────────────┼───────────┼──█─┤   counts as today's bench press
                        0              60           90  100
```
- 120–200 px printed scale with ticks at 60 and 90 (the partial and full-credit thresholds); ink
  tick at the score; verdict text: ≥ 90 "counts as today's …" · 60–89 "partly — add 1 set" (the
  computed fix) · < 60 "different work — credited to shoulders, upper back".
- Detail popover: per-term bars (muscle · strength · cardio · energy · mobility) with their intent
  weights, and "also trained: …".

### 13.14 Score tile `<ScoreTile>` and baseline gauge `<BaselineGauge>`
Tiles live **inside one Faceplate** (a "signals" strip/grid with hairline dividers), never as
separate cards or KPI tiles.
```
 hrv status                                [B ●●●○]  v1.2
 within your normal                          ← state word 17/600 (or value "54 bpm")
 ├────────░░░░▓▓▓▓▓▓░░░░──────┤              ← BaselineGauge
            38      47                         normal range band · ▮ 7-day mean · ○ last night
 7-day 42 ms · normal 38–47 ms               ← 12 ink-2
 ⌁ ring · Colmi R10 · tier C · trend only    ← provenance 11 ink-3
 ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
 Oura says "balanced" · vendor opinion       ← optional, 12 ink-3, never larger than the tile text
```
- Header: title (engraved), GradeBadge `sm` (evidence certainty of the score), version chip
  ("v1.2", 11 condensed, links to the score's changelog), and for convenience indices the label chip
  "index · not a measurement".
- Body by `output.display`: `number` (value + unit + band), `state` (word + gauge), `band` (word only).
- **BaselineGauge**: 160–240 × 24 px; printed ticks; the personal normal range as a 6 px band
  (ink @ 18 %); the 7-day mean as a 2 px ink bar; last night as a hollow 6 px dot; optional
  population reference ticks (labelled, e.g. "median 81"). Borderline = the 80 % interval of the
  7-day mean drawn as a thin bracket that straddles a band edge, state word "borderline".
- **States**: ok · borderline · withheld ("—", reason "needs 14 nights · 9 so far" with a printed
  14-tick count scale, 9 inked — a count, not a ring) · insufficient baseline (value shown, band
  replaced by "normal range forming · 9 of 14 nights") · flag (StatusMark + word; see scores.md).
- **Plan link**: when the score changed something today, a quiet line "→ eased today's session ·
  Undo" linking to its change card.
- Device tier C on heart-rate variability, autonomic load, SpO2 and temperature: values shown only
  as change from your normal ("+0.3 °C vs your normal"), never absolute — the tile enforces this
  from `tiersAllowed`.

### 13.15 Stream matrix `<StreamMatrix>` (devices intake, Settings › Devices and streams)
```
                    bring in   my scores   my plan    Coach sees
 sleep              [● ]       [● ]        [● ]       [hidden | daily | daily + detail]
 heart rate         [● ]       [● ]        [● ]        hidden     ← resting HR feeds the model
 HRV                [● ]       [● ]        [○ ]        hidden
 SpO2               [● ]       [● ]        never ⓘ     hidden
 steps & workouts   [● ]        —          [● ]        hidden
 vendor scores      [○ ]       never ⓘ     never ⓘ     hidden
                    [Use recommended]   [Coach can see daily summaries]
```
- Rows = streams the chosen device offers; columns = the four `StreamPolicy` fields. Switches for
  booleans, a 3-key KeyBank for the Coach (`hidden · daily · daily + detail`; detail = series, only
  through a visible tool call).
- "—" = not applicable; "never" + (i) = not allowed, with the reason ("No established mechanism
  links SpO2 to your plan, so it's shown and trended only.").
- Columns 2–4 are disabled while "bring in" is off. When a device is turned on, the recommended
  cells (bring in, scores and plan for eligible streams) are **marked as suggested** (hollow
  indicator dot) but nothing is stored until the person presses **Use recommended** or sets cells
  one by one; the Coach column stays **hidden** until chosen.
- Mobile (< 768): one row per stream as a block: name + "bring in" Switch on line 1, the other
  three controls stacked under a hairline.
- Every change is a UI-only consent command; nothing here is reachable by the Coach.

### 13.16 Sync pill `<SyncPill>`
24 h chip in the context bar (desktop) / 32 px icon key in the top bar (mobile). Glyph + text:
`synced 14:02` (check-circle) · `syncing…` (2 px ink arc spinner) · `3 waiting` (dot) ·
`offline` (cloud-off) · `can't reach server` (caution mark) · `allow network access` (caution mark).
Click → Popover: state, last synced, pending changes / files, endpoint host, **Sync now**, "Sync
settings". Hidden when sync is off or unavailable.

### 13.17 Plan strip `<PlanStrip>` (planning override)
Full-width 40 h strip under the context bar, `--lm-chassis-2` with 1 px rules: yellow 6 px dot ·
"**Spring cut is running** · day 15 of 84 · changes here don't touch it until you replace it" ·
right: Key `default` sm "Back to Today". Not dismissible while the override is set.

### 13.18 Coach composer `<CoachComposer>`
```
 [log breakfast as planned] [I'm busy Thu–Sat] [why is my weight up?]     ← prompt chips (≤ 3)
 ┌─────────────────────────────────────────────────────────────┐ ⌷ ➤
 │ Tell the Coach what you did…                                 │ photo  send
 └─────────────────────────────────────────────────────────────┘
```
- Auto-growing textarea (1–6 lines), 16 px on mobile; photo key opens `input[type=file]
  accept="image/*" capture` (no camera permission prompt); send = Enter (Shift+Enter newline).
- While the model works: send becomes **Stop** (Key default with square glyph); staged proposals
  stay pending.
- Disabled-with-reason when no provider: "Connect an AI provider in Settings to chat. You can still
  log everything by hand." with a link.
- Used in three places: Coach (full), Today (log bar, single line), Food/Train (contextual, opens
  the Coach with the context attached).

### 13.19 Plan-start sheet `<StartPlanSheet>`
ResponsivePanel (sheet < 1024, side panel ≥ 1024). Sections: plan name (TextInput, default
"{rung} plan · {start month}", e.g. "Hard plan · October"); start date KeyBank (today · tomorrow ●
· next Monday · pick date) with the anchoring note; weekly check-in day KeyBank (Mon–Sun, default
the start weekday); weigh-in time (ClockRing-free time Stepper, default 07:00); training days
(7-key multi KeyBank, prefilled from the plan); "if I miss a session" KeyBank (next day · skip it ·
do a shorter one); "before day 1" list (things to buy from the rung, groceries for 3 days). Footer:
solid **Start plan**. If a plan is active the footer key reads **Replace active plan…** and opens
the typed-confirmation Dialog.

### 13.20 Primitives referenced above
Already built in `src/components` (see its README) and used as-is: **Notice** (`severity`, `title`,
`actions`, `layout="boxed|ruled"`) — per REVIEW_FINDINGS #5 it is faceplate text with a drawn status
mark and a hairline rule, colour on the mark only; every "Banner" in v0.2 specs means this Notice
(the v0.1 §9 Banner's tinted fill and coloured title are superseded) · **InlineWarning** (icon +
one sentence in ink; colour on the icon only) · **StatusMark** · **KeyValueList** ·
**ResponsivePanel** · **TopBar** / **ActionBar** (`@/app/shell`) · **ScrollRail** (snap,
`scroll-padding-inline` = gutter, next cell peeks).

New, small:
- **BandScale** `<BandScale>`: a printed horizontal scale split into labelled reference bands
  (e.g. typical · raised · high at 100 and 130 cm²), 1 px ink ticks at thresholds with numerals,
  the value as a 2 × 10 px ink tick and its likely range as a 4 px ink @ 22 % bar; band names in
  12 px engraved under each band; no band fills in colour. Used by the visceral view and any
  reference-banded readout.

---

## 14. v0.3 primitives (batch 02: intake v3, pickers, supplements, markers, hover)

Specs that use these: `screens/onboarding-intake-v3.md`, `screens/plan-ladder.md` §v2,
`screens/planner-goals.md` §12, `screens/living-mode.md` §5 (Food tab). Where §14 and an older
entry disagree, §14 wins.

### 14.1 Hover rule (PLAN 02 item 11) — token `--lm-face-hover`
**New token** (to add to `design/tokens.css` and `src/styles/tokens.css`, same name in both):
```css
--lm-face-hover: color-mix(in oklab, var(--lm-face), var(--lm-ink) 6%);
/* light ≈ #ecedee (L −0.045) · dark ≈ #27292c (L +0.042): a 4–5 % lightness shift, no tint */
```
Measured contrast of text on `--lm-face-hover`: light — ink 14.6:1, ink-2 7.1:1, ink-3 5.2:1;
dark — ink 12.8:1, ink-2 7.6:1, ink-3 5.1:1. All ≥ 4.5:1. (The current ladder row hover fills
with `--lm-ink-faint`, which drops ink-3 to 2.4:1 in light and 1.9:1 in dark: that is the bug.)
On a surface other than `--lm-face` (the Ideal card's 70 % face / chassis mix, a `--lm-well`
region) mix 6 % ink into **that** surface: `color-mix(in oklab, <surface>, var(--lm-ink) 6%)`.

Rules:
- Only rows that **do something when activated** get a hover: the whole row is a `button` or `a`
  (or has one full-row hit target) and opens something (the Explain drawer, a detail sheet, a
  route). Rows whose only control is a key inside them (AnswerRow, SupplementRow) get **no** row
  hover; the key has its own Key hover.
- Hover changes the background only: `background: var(--lm-face-hover)`; text colour, weight and
  borders stay; no box-shadow halo; `border-radius: var(--lm-radius-sm)`; the row's padding is
  inside the painted area (no negative spread). Transition `--lm-dur-fast`.
- `@media (hover: hover)` only; touch shows the pressed state instead
  (`color-mix(in oklab, <surface>, var(--lm-ink) 10%)` for 80 ms).
- Focus-visible uses the focus ring (outline 2 px `--lm-focus`), never the hover fill alone.
- Cross-card "compare this row" highlighting on the ladder is **removed** (it painted
  non-interactive rows).

Where it applies (E21 for the ladder, E23 for the sweep):

| Surface | Interactive rows (hover) | Non-interactive (no hover) |
|---|---|---|
| Ladder card (`.lp-lcard__row`) | goal rows, effort rows, fasting line, safety line — each opens the Explain drawer at that row | section labels, "day to day", "to make it work", "limits it presses" text rows unless they open Explain |
| Ladder card itself | border goes `--lm-edge` on hover (unchanged) | — |
| Today checklist (PrescriptionRow) | the row's chevron area / row button opening the row sheet | time column, tick key (Key states) |
| Food meals, groceries | recipe row opening the recipe sheet | target lines, grocery rows (checkbox is the control) |
| Train items | session item row opening its detail | equivalence meter |
| Progress tiles (ScoreTile, metric rows) | tiles that link to a metric page | static readouts |
| DataTable rows (§12) | keep `--lm-face-hover` (replaces "ink @ 4 %") only when the row opens detail | otherwise none |

### 14.2 Answered list `<AnsweredList>` and answer row `<AnswerRow>`
The intake's main surface: every question of a chapter in fixed order.
```
 ┌ Your answers ─────────────────────────────── 3 of 11 ┐   Faceplate, header caption = count
 │ Do you work or study outside home most weeks?          │   question 13/500 --lm-ink-2
 │ yes                                           Change   │   answer 15/500 --lm-ink · Key quiet sm
 │ ──────────────────────────────────────────────────── │   1 px --lm-line
 │ ┃ What do you mostly do on a workday, at work or study?│   child: padding-left 16 + 1 px
 │ ┃ sitting at a desk or driving                Change   │   --lm-line-strong rule at x = 6
 │ ○ Do you know your daily steps?                        │   hollow dot = asked later
 │   using about 7 000 · asked later              Answer   │
 │   On a day off, what are you mostly doing?             │   not used: ink-3, reason line
 │   not used: you said you work from home       Change   │
 └────────────────────────────────────────────────────────┘
```
- Row: grid `minmax(0,1fr) auto`, gap 2 × 12, padding-block 12, min-height 56; the key column
  aligns to the **first answer line** (`align-self: end` of row 1 / start of row 2). Depth > 1 adds
  16 px per level (max 2 levels).
- States: answered · asked later (hollow 6 px dot before the question, answer "using … · asked
  later", key "Answer") · not used (ink-3 + reason) · open (row replaced by the QuestionCard) ·
  saving (key shows a 12 px spinner, width locked) · error (danger InlineWarning under the row).
- A11y: `ol`; each `li` has the question text and the answer in a `p`; the key is named "Change: {question}, {answer}".
  No row hover (§14.1). Dark/light: tokens only.

### 14.3 Question card `<QuestionCard>`
Replaces `IntakeTurn` (§13.1) as the open question. An **inset region** inside the AnsweredList
(`--lm-well`, 1 px `--lm-line`, radius md, padding 16, margin-block 12); standalone (Body page) it
sits inside the panel the same way.
```
 question 4 of 11                                                     engraved 12, ink-3
 [⤷ because you said: work or study outside · yes]                   ParentChip (0–2)
 How do you usually get to work or study on a workday?                prompt 17/600, ≤ 3 lines
 why we ask ▾                                                         quiet disclosure, inline
 answer controls (AnswerKeys · Chip multi · Stepper + presets · NumberField · CataloguePicker ·
                  SupplementRow list · MarkerTable)
 if you skip: ride, 0 min walking                                     12 --lm-ink-3
 ─────────────────────────────────────────────────────────────────── 1 px --lm-line, margin-top 16
 [‹ Back]                                   Ask me later   [Next ›]   footer, padding-top 12
```
- **ParentChip**: Chip 24 h, `--lm-face` fill, 1 px `--lm-line-strong`, leading 12 px "return"
  glyph, text "because you said: {parent question short name} · {answer}" (12/500 ink-2). Click →
  focuses the parent row's Change key. Max 2 chips; more → "+1".
- **Footer** keys: Back (`default` md, leading ‹) left; Ask me later (`quiet` md) and Next
  (`solid` md, trailing ›) right; gap 8; 44 px hit on touch. < 360 px: Ask me later moves to its own
  line above, right-aligned. Back is hidden on the first question of the first chapter. Single
  choice still commits on press and advances after 240 ms; Next then means "keep this answer".
- **Change mode** (opened from a row): header line "changing an answer", footer **Cancel** (quiet,
  left) · **Save** (solid, right); no Ask me later. Esc = Cancel.
- **Optional mode** (pickers that are optional, B0): the later key reads "Skip this list" / "No,
  skip this chapter" and records "skipped by choice" (not asked later).
- States: unanswered (Next `aria-disabled` with reason "Choose an answer first") · answered
  (pressed key / filled fields, Next enabled) · saving (Next spinner) · error (InlineWarning danger
  above the footer, focus moves to it) · loading (3 skeleton lines).
- A11y: `fieldset` + `legend` (the prompt, including the restated context); the ParentChip is
  inside the legend's description (`aria-describedby`); shortcuts as intake-v3 §3.6.

### 14.4 Supplement row `<SupplementRow>`
One row per supplement, used in the intake (S2), Settings › Supplements and the Food tab.
Container query on the row (`container-type: inline-size`), so it fits any column.
```
 ≥ 720 px row width (one line)
 creatine monohydrate [A ●●●●]      [ 5   g ]  [morning|midday|evening|night]  [taking ▾]
 3–5 g a day · any time                         (multi toggles, 36 h)            state
 480–719
 creatine monohydrate [A ●●●●]                                         [taking|have it|not for me]
 3–5 g a day                                  [ 5   g ]  [morning|midday|evening|night]
 < 480 (390 px screen)
 creatine monohydrate [A ●●●●]                                                   [taking ▾]
 3–5 g a day                                                                   [ 5   g ]
 [ morning ][ midday ][ evening ][ night ]                       ← own line, 4 equal keys, 44 h
```
- **Left**: name 15/500 (wraps, never under the controls) + GradeBadge `sm` (evidence for the
  person's goal) + 12 ink-2 catalogue dose line. Left column `minmax(140px, 1fr)`.
- **Right** (`justify-self: end`, gap 12, items never overlap: each control has a fixed min width
  and the grid wraps to the next line instead of shrinking):
  - dose: NumberField 88 w (16 px text on touch) with the unit inside as a suffix (g · mg · µg · IU ·
    scoop); a unit Select only when the catalogue lists more than one unit.
  - time of day: a **multi toggle bank** (KeyBank look, `role="group"`, each key `aria-pressed`):
    morning · midday · evening · night; selected = raised cap + yellow dot. ≥ 1 required while
    taking.
  - state: KeyBank `taking · have it, don't take · not for me` (≥ 480) or Select (< 480).
- States: **taking** (dose and times shown, required) · **have it, don't take** (dose and times
  hidden; ink-2 line "at home · the Coach may suggest using it before buying anything") · **not
  for me** (row collapses to name + state, ink-3) · invalid dose (field error "Enter an amount") ·
  caution (a supplement the safety answers rule out: state locked to "not for me" with the reason
  line, never hidden).
- Variants: `edit` (as drawn) · `today` (Food tab: name · "5 g · morning" text · tick key 44 ·
  "Edit" quiet → turns into `edit` in place).
- Spacing: row padding-block 12, hairline between rows; no row hover.
- A11y: each row is a `group` labelled by the name; dose input named "Creatine dose, grams"; time
  toggles named "Creatine in the morning"; state named "Creatine: taking".

### 14.5 Catalogue picker `<CataloguePicker>` (equipment · cuisines · staples · pantry)
```
 [⌕ Search 340 items                              ×]        42 selected      ← sticky in the card
 Pre-ticked: defaults for a Kerala kitchen. Untick what you don't have.  Use another region ▾ · Clear defaults
 ▾ cooking                                   9 of 31 · clear              ← DetailGroup header
   [✓ pressure cooker 5 L ✎] [✓ tawa] [✓ gas, 2 burners] [ OTG oven ] [ egg boiler ] [ soda maker ] …
 ▸ prep                                      4 of 22 · clear
 ▸ storage                                   2 of 8
 ▸ added by you                              2        "a few things here and there" · matching…
 I also have…  [ e.g. a waffle maker                        ] [Add]
 ▸ Paste a list
```
- **Search**: well field 40 h (44 touch), filters across all groups as you type (debounce 120 ms);
  matching groups open, the match is bold in the chip; no match → "No match for 'waffle iron' ·
  Add it as your own item". Region-name synonyms match (bhindi = okra).
- **Groups**: DetailGroup; header "name · n of N · clear" (clear is a quiet key; Undo toast 5 s).
  First group with a ticked item opens by default; others closed. Chips: Chip `filter` 32 h on
  touch (44 hit), 28 h pointer, 13/500, wrap with 8 px gaps.
- **Region defaults**: ticked chips that came from defaults carry a **dashed** outline (the
  system's "assumed" mark) until the person presses Done or touches the chip; the note above the
  groups names the region and offers "Use another region" (Select) and "Clear defaults".
- **Per-item note**: a ticked chip shows a 16 px ✎ IconKey (24 hit) → Popover with a text field (≤ 80
  characters, "e.g. small OTG, 28 L"); the chip then reads "OTG oven · small, 28 L" (truncated at 32
  characters, full text in the title and accessible name). For equipment the same popover has a
  Switch "I own it but don't use it" (`use: 'ownNotUsed'`); such chips show "· not used" in ink-2.
- **I also have…**: text field + Add; the item lands in "added by you" with status "matching…"
  (Coach available) → "matched: soda maker" or "kept as you wrote it". Nothing is rejected.
- **Paste a list**: disclosure with a textarea (4 rows) + "Read the list"; result preview: "14
  matched · 3 kept as written" with each line ticked, then **Add 17 items**. With a provider the Coach
  parses it; without one, lines and commas are split and matched by name.
- **Counts**: header total, per-group "n of N"; the question card's Done shows the total "Done (42)".
- **Optional** (pantry): the card's footer has "Skip this list"; the picker shows no "required" marks.
- States: empty (no defaults for the region: note "No defaults for your region; pick what you have")
  · loading catalogue (skeleton chips) · error ("Couldn't load the list. Try again.") · saving.
- Places: intake F5/F7/F7b/F7c; **Settings › Kitchen** (four Faceplates: Equipment · Cuisines ·
  Staples · Pantry, autosave with Undo toast, no footer); **Food tab** › Pantry faceplate (count +
  12 recent chips + "from your staples:" quick-add chip row + "Edit pantry" → `/food/pantry`, a full
  page with the picker; no sheet).
- A11y: search is `role="searchbox"` with a live count ("12 matches"); each group is a
  `group` with its header; chips are checkboxes (`role="checkbox"`, `aria-checked`), with "default
  for Kerala" in the description when dashed.

### 14.6 Because chip `<BecauseChip>` (markers in the ladder, Food tab and Coach)
```
 [⌁ because your LDL was 158 mg/dL on 12 Aug 2026]      ← Chip 24 h, 12/500 ink, 1 px --lm-line-strong
```
- Glyph: 12 px lab-tube outline, ink. No colour fill; the marker state is in the words.
- Short form when space is tight (< 280 px): "because LDL 158 · 12 Aug".
- Tap/click → Popover (max 360): the rule in words (from the interaction table), GradeBadge,
  "retest due {date}", links **Why** (Evidence topic "Blood markers and diet") and **Edit value**
  (opens the markers chapter row in change mode). Older than 12 months → suffix "· old result",
  ink-2.
- Placement: ladder card "limits it presses" and fasting lines; Food recipe card fit line; Coach
  messages (inline after the sentence it explains); max 2 per row, then "+1 more".
- A11y: a button named with the full sentence; popover is a dialog-less Popover with focus return.

### 14.7 Marker table `<MarkerTable>` and review table `<MarkerReview>`
Layouts, columns and states as `onboarding-intake-v3.md §8.2–8.3`. Shared metrics: header row 12/500
ink-2 engraved; cells 13 tabular, values right-aligned; row height 48 (touch 56); 1 px row rules;
sticky header inside the card; < 768 renders as one fieldset block per marker. Confidence chip:
Chip `status` with text, low = dashed outline. Status text: "in range" ink-2, "above range" /
"below range" ink + caution mark 12 px.

### 14.8 Acceptance checklist (components)
- [ ] `--lm-face-hover` exists in both token files; no hover anywhere uses `--lm-ink-faint` or a tinted fill.
- [ ] Ladder rows: hover only on rows that open Explain; text colour unchanged; ink-3 on hover ≥ 4.5:1 both themes.
- [ ] Today, Food, Train, Progress: non-interactive rows and tiles have no hover.
- [ ] SupplementRow at 390 / 768 / 1440: name, dose, times and state never overlap; times on their own line below 480 px row width; controls on the right.
- [ ] SupplementRow "have it, don't take" hides dose and times; the same row renders in Settings and the Food tab.
- [ ] Picker: search filters across groups; counts update; dashed outline on region defaults; notes show on chips; paste-a-list previews before adding.
- [ ] BecauseChip readable in both themes, opens its popover with keyboard, short form at narrow widths.

## 15. Batch 03 primitives (server, pairing, ring over MQTT, corrections)

Specs that use these: `screens/server.md`, `screens/settings-sync-ai.md §13`,
`screens/settings-data.md §11`. No new colour tokens: everything uses the faceplate, well, key,
ink and severity tokens of §1–§3 in both themes. Where §15 and an older entry disagree, §15 wins.

### 15.1 Pairing code field `<PairingCodeField>` (with QR entry)
```
 pairing code
 [ K 7 Q M ] – [ 4 X R D ]      [ Scan QR ]        ← two wells 4 characters each; Scan QR Key default
 Codes last 10 minutes.                            ← help 12 ink-2
```
- Two Well inputs, 4 characters each, 20/500 tabular, letter-spaced 0.12 em, uppercase display,
  case-insensitive input; alphabet without look-alikes (no 0, O, 1, I; provisional, the format is
  the server contract's). Width 4 ch + padding; height 48 (56 on touch).
- Typing the 4th character moves focus to the second group; Backspace in an empty second group
  returns to the first. Pasting a full code (with or without the dash) or a pairing link fills
  both groups and, for a link, the address field too.
- `inputmode="text"`, `autocapitalize="characters"`, `autocomplete="one-time-code"`,
  `spellcheck=false`.
- **Scan QR** opens the existing scan dialog; a read link fills code and address and submits.
- States: empty · filled · checking (loading ring on the submit key, inputs read-only) · error
  (well border `--lm-danger-line`, message under the group linked by `aria-describedby`: wrong,
  expired, used, too many tries) · disabled.
- Display variant `show` (the code a paired device hands out): one line "K7QM–4XRD" 28/500
  tabular, a Copy key, and a 200 px QR (black on white with an 8 px white quiet zone in both
  themes).
- A11y: `role="group"` labelled "pairing code"; inputs named "first 4 characters" / "last 4
  characters"; errors announced politely.

### 15.2 Shown-once block `<ShownOnce>` (codes, keys and credentials)
```
 ┌───────────────────────────────────────────────────────────┐ inside a Faceplate: hairline frame,
 │ ⬣ Shown once. Copy it now: Vitals doesn't keep a readable │ no box shadow (not a nested card)
 │   copy. If you lose it, make a new one.                   │ caution mark + 13/500 ink
 │ ───────────────────────────────────────────────────────── │
 │ username   p1-lumen                          [Copy]       │ rows 44 h, value 15 tabular
 │ password   q8V…(24 chars)…Lm                 [Copy]       │ full value shown, wraps by character
 │ [Copy all]                                                │
 │ ☐ I've saved this  (variant credentials / key)            │
 │ [Done]  (enabled when ticked)                             │
 └───────────────────────────────────────────────────────────┘
```
- Variants: `code` (a pairing code with QR and an expiry countdown, no tick box; closes itself when
  used) · `key` (one agent key + recipe lines, each with Copy) · `credentials` (several values +
  Copy all + tick box).
- Values are in a Well, 15/400 tabular, `user-select: all`, `word-break: break-all` so long values
  wrap at 390 px instead of overflowing.
- Copy keys show "Copied" for 2 s (live region, polite); the clipboard is not cleared by Vitals
  (say nothing that promises it).
- After Done (or closing), the values are gone from the page; the block's place shows the masked
  line "•••••••• shown once" with the "make new …" key of its screen.
- The countdown (variant `code`) is tabular "expires in 9:41", announced once at 1 minute left.
- Never rendered into exports, logs, screenshots for support, or the Coach's context.

### 15.3 Server status pill `<ServerPill>` (reachable · syncing · error set)
Same frame as `<SyncPill>` (§13.16): 24 h chip in the context bar (desktop), 32 px icon key in the
top bar (mobile), glyph + word, never colour alone. Replaces the sync pill when a server is paired.

| State | Glyph | Word | Tone |
|---|---|---|---|
| reachable | check-circle | "reachable" (popover: "synced 14:02") | ok green glyph, ink text |
| syncing | 2 px ink arc spinner | "syncing…" / "12 waiting" | ink |
| offline (this device) | cloud-off | "offline" | ink-2 |
| can't reach | caution mark | "can't reach server" | caution amber glyph |
| removed (token revoked) | danger mark | "pair again" | danger red glyph |
| needs update | caution mark | "update server" | caution amber glyph |

Small variant (state chips inside rows, e.g. provider rows and the MQTT card): 20 h, 12/500 text,
glyph 12, no popover. Row words use the same set plus row-specific words ("signed in", "key set",
"connected", "waiting", "never connected", "refused").
Click (full pill) → Popover: state line, last sync, waiting changes, server name and host, **Check
now** / **Sync now**, "Server settings". Spinner stops with reduced motion (static arc).

### 15.4 Corrected-record marker `<CorrectedMarker>` and fed-by line `<FedBy>`
```
 6 h 0 min
 ✎ you corrected this · Undo           ← 12 px pencil glyph, 12/500 ink-2; Undo = quiet key (44 hit)
   ring said 7 h 40 min                ← 12/400 ink-3, optional (Progress; popover on Today)

 fed by your ring · last 07:12  [Correct]     ← FedBy: 12/500 ink-2 + quiet key
```
- CorrectedMarker sits directly under the value it marks, never in a separate column; the value
  itself is unchanged in style (the person's value is the value).
- In charts: the corrected point is a hollow dot (1.5 px ring in the series colour, `--lm-face`
  fill); the tooltip carries the marker text. No dashed segment (dashes mean something else).
- Short form under 280 px: "✎ corrected · Undo".
- FedBy replaces any manual log affordance for a device-fed stream; its Correct key opens the
  correction sheet. Kinds: "your ring", "your watch", "your scale", or the device's name.
- A11y: marker is text ("you corrected this; ring said 7 hours 40 minutes"); Undo named "Undo
  correction of sleep on 2 October"; FedBy's key named "Correct sleep".

### 15.5 Acceptance checklist (components)
- [ ] PairingCodeField: auto-advance, paste of code or link fills both groups, errors linked and announced, Scan QR fills and submits; 48/56 h; readable at 390.
- [ ] Pairing QR is black on white with a quiet zone in both themes and scans from another phone.
- [ ] ShownOnce: three variants; long values wrap at 390 without overflow; Copy and Copy all confirm politely; after Done only the masked line remains; never in exports or Coach context.
- [ ] ServerPill: six states with glyph + word; small variant inside rows; popover keyboard-reachable; reduced motion stops the spinner.
- [ ] CorrectedMarker: under the value, Undo works, "ring said" line on Progress, hollow chart dot with tooltip, short form under 280 px.
- [ ] FedBy replaces manual logging for device-fed streams; never a disabled log key.
- [ ] All four in light and dark: text ≥ 4.5:1, glyphs and hollow dot ≥ 3:1 on `--lm-face`.
