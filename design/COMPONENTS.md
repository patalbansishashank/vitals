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
> **v0.2 (2026-10-01):** new primitives for the intake, the ladder, Living mode and the Coach
> are in **§13**. Superseded v0.1 entries are marked in place (PlanCard → LadderCard, DifficultyMeter →
> BurdenScale, OptimiserProgress slots). Where §13 and an older entry disagree, §13 wins;
> `REVIEW_FINDINGS.md` still wins over both.
>
> **r071 (2026-10-30):** the foundation (package 0A) rewrote the entries for Key and Run key (§1), Key bank, link bank,
> tabs and Chip (§2), Notice (§9, the v0.1 "Banner"), Drawer, Sheet and Dialog (§10), the sidebar, dock and top bar (§11)
> and the date control (§13.8) to what ships, and added **§16** (the domain card recipe) and **§17** (the picture motion
> hooks). Package 0B then built the card and picture components and gave them entries: **§18** (`GradientCard`,
> `CardHead`, `InfoPanel`, `CardFoot`, `HeroNumber`, `MonoMeta`, `StatusDot`), **§19** (the pictures: the new
> `RadialTicks`, `DottedTrack`, `HighlightBars`, `GlowLine`, `RangeScale`, `StackBar` and `WindowBar`, and the restyled
> `Hypnogram`, `StateStrip`, `Stat`, `ShareBar` and `TwinTable`), **§20** (`Rail`, `CardGrid`, `CardLibrary`) and **§21**
> (the intake model and its pictures, the `todayCards` and `widgetWeight` settings keys, the gallery). Values are not
> copied here: `design/tokens.css` is the source of truth (§5 hues, §11 type, §15 glow, §16 motion). Entries this round
> did not touch (Engraved, Switch, Select, the sliders, the schedule, planner and intake components …) still describe
> the version they were written for; where one disagrees with `DESIGN.md`, `src/components/README.md` or the code, those
> win (`DESIGN.md` supersedes `REVIEW_FINDINGS.md`).

---

## 0. Surfaces

### Faceplate `<Faceplate>`
The plain container (the metric card is `GradientCard`, §18.1). A panel screwed onto the chassis.
- Anatomy: optional header row (title-m 17/24 at 600 + one fact caption + right-aligned actions) · body · optional
  footer. No divider: 12 px of space (16 from 1024) separates the header from the body.
- Tokens (r071): the card material `--lm-card-bg` (the gold wash over the grain tile over `--lm-face`; a `data-domain`
  card swaps the wash for one glow, §16), border 0.5 px `--lm-line`, radius `--lm-card-radius` (20), no shadow, padding
  `--lm-card-pad` (18 phone, 24 from 1024).
- Variants: `plain` · `inset` (bg `--lm-well`, no shadow — for sub-regions such as the avatar
  stage) · `flush` (no padding — charts, rasters).
- Faceplate or `GradientCard` (§18.1)? They draw the same material: `.lm-face` and `.lm-material` share one rule in
  `components.css`, with the same domain wiring and glow, and `Faceplate`'s markup does not change. `Faceplate` is the plain
  titled card (title, fact caption, actions, footer) for sections, forms, tools and every page that is not a metric card.
  `GradientCard` is the metric card: it adds the icon · title · (i) head, the foot, the whole-card open target and the
  glow's fade-in on first view.
- Rule: never put a Faceplate (or a `GradientCard`) inside a Faceplate. Use hairline rules and spacing.

### Engraved label `<Engraved>`
Lowercase 12/16, weight 500, `--lm-ink-2`. Used for control captions, lane names, axis titles.
Rendered text is authored lowercase (not CSS `text-transform`) so screen readers and copy-paste
match what is seen, except where the source string is a metric name reused in sentences — then
use the `engraved` utility.

---

## Bar control height (top bars and action bar)

One token, `--lm-bar-control-h`, is the height of **every control** in the top bars (`.lm-topbar`, the screen's `.lm-ctx` bar)
and in the action bar (`.lm-actionbar`): **36 px** for a fine pointer on every width, **44 px** under `(pointer: coarse)` so touch
screens keep the 44 px touch target. It covers word keys and icon keys (Back, Skip, Next, Find plans, Start this plan, Apply,
Undo, Stop …), key banks (schedule | results, figure | visceral, cards | table), steppers and number fields (the weeks
selector), inputs, selects and date buttons, switches, chips (sync status included) and the round run key.

- Key padding in a bar is 0 14 px with the base 15 px label; bank keys are the token height minus the bank's 3 px well and
  1 px edge, so the bank as a whole is exactly the token height; icons keep their own sizes.
- Bars centre their items (`align-items: center`); their own height is the token plus 16 px (desktop, `--lm-deskbar-h`) or
  20 px (phone bars).
- Do not set a height on a control inside a bar: the rules at the end of `src/styles/shell.css` ("one control height in the
  bars") own it, including bare text triggers a screen puts there. Anything that can grow past one line
  (a text area, a two-line status) must size from the token too (see the Coach composer).
- Guards: `src/app/__tests__/barControlHeight.test.ts` (rules and tokens) and `scripts/qa/bar-heights.mjs` (measures every
  route in a real browser, fine and touch emulation, and fails unless all are equal).

## 1. Keys (buttons)

### Key `<Key>`
r071: the primary is a gold PILL and every other variant a rounded rectangle in the card's language; no bevel, no shadow
(the v1 table of `default | solid | quiet | danger | signal` with key shadows is gone).
- Anatomy: cap · label · optional leading icon (20 px; 16 px on `sm`) · optional trailing icon (16 px; 18 px at stroke 2.25
  on a primary) · optional shortcut hint (12 px, `--lm-ink-3`). `arrow` is shorthand for `trailingIcon={ArrowRight}`: the
  arrow glyph U+2192 is in neither Geist file, so it is always an icon. A trailing icon takes 4 px off the padding on its
  side.
- Sizes: `sm` 32 h · `md` 40 h · `lg` 48 h. Side padding 12 / 16 / 24 (a primary: 14 / 22 / 22). Label 12/16 on `sm` and
  14/20 otherwise, at 500; a primary's label is 15/600 (12/600 on `sm`). Corners: 8 / 10 / 12 for the secondary; a primary
  uses `--lm-key-radius` (24 px: a full pill at 32, 40 and 48 px, and a 24 px corner rather than a stadium when a block
  key's label wraps to two lines). Icon-only keys are round. A touch layout keeps a 44 px hit area, drawn invisibly (48
  for icon keys, 32 under a fine pointer).
- Variants:
  | Variant | Look | Use |
  |---|---|---|
  | `primary` (aliases `solid`, `signal`) | gold `--lm-signal` fill, `--lm-signal-ink` label, the pill | the one primary action per view ("Log snack", "Start", "Add task →") |
  | `outlined` (alias `default`, the default) | the neutral tile: 6 % ink fill, 1 px `--lm-line-strong`, ivory label | ordinary actions |
  | `action` | gold label on a 16 % gold tile (`--lm-gold-action`), 8 px corners; 32 h (28 `sm`, 40 `lg`) | an inline verb on a row ("Log") |
  | `text` (alias `quiet`) | gold label, no fill, a gold tint on hover; icon-only = a stone icon | tertiary, inline; in a card's head or foot it takes the action tile |
  | `danger` | rose label, a 45 % rose outline, a 6 % rose tint | destructive ("Reset all data") |
- States: hover — the primary goes to `--lm-signal-hover`, the secondary to an 11 % ink fill; pressed (`pressed`) — gold
  wash + gold edge (not on a primary); active — scale .98 (.985 on the secondary) and brightness .94 over 80 ms; focus — the
  global 2 px gold ring at 2 px; disabled — a primary becomes a `--lm-raised` pill with a pale-stone label, the others keep
  their shape at 42 %, and a disabled key with a `disabledReason` stays focusable; loading — the label stays, a 12 px
  ring spinner replaces the leading icon, width locked.

### Run key `<RunKey>` (signature)
The Simulator's and the Planner's primary: the gold pill of a primary Key (a full pill, `md` 40 h · `lg` 48 h, 20 / 24 px
side padding, label 14/600), "Run" or, in the Planner, "Find plans", with an optional caption to its left (never a repeat
of "Run").
- States: idle · **stale** (a 6 px near-black dot after the label = "inputs changed") · running (the label becomes elapsed
  seconds "1.2 s", a 14 px arc spins before it, the cap dims to brightness .94) · disabled (a `--lm-raised` fill, a
  pale-stone label, a tooltip with the reason: "Paint at least one week first").
- Keyboard: `⌘/Ctrl Enter` from anywhere in the Simulator.

### Icon key `<IconKey>`
Round, 32 / 40 / 48 px (`size`), a 20 px icon, `quiet` by default (a stone icon that brightens to ivory over a 6 % ivory
hover); `action` and `primary` are a gold disc. Requires `label`: the accessible name and the tooltip on hover and focus.

---

## 2. Choice controls

### Key bank (segmented control) `<KeyBank>`, link bank `<LinkBank>`, tabs `<TabList>`
One track for the three (r068 U2; r071 sets the labels in mono caps). The v1 Braun push-button bank with yellow indicator
dots is gone.
- Anatomy: a rounded-rectangle well (`--lm-select-track` = `--lm-well`, 12 px corners = `--lm-radius-track`, a 0.5 px
  `--lm-line` hairline) holding 2–6 segments 3 px inside it (`--lm-select-inset`; their 9 px corners are concentric). It
  fills the width it is given in equal columns (`block`, the default), each at least its label wide and never under 48 px
  (40 in the small bank); `fit` sizes the track to its labels. When the labels cannot fit even so, the track scrolls
  sideways without a bar; a label never wraps and a segment never drops to a second row.
- Segments: a mono-caps label (Geist Mono 500, UPPERCASE, +0.08em, `--lm-text-meta`: 11 px, 12 px from 1024), pale stone,
  hover to ivory over a 4 % tint where a pointer hovers. Selected = the gold tile (`--lm-select-on` gold wash,
  `--lm-select-on-edge` gold edge, ivory label): gold is what you chose. No dots, no underline; an option `badge` is a
  6 px gold "changed" dot after the label.
- Sizes: `sm` 28 h (chart toolbar) · `md` 36 h · `lg` 44 h; every segment is at least 44 h under a coarse pointer, small
  banks included. Inside the top bar and the action bar the track takes the bar height (36 / 44) and the segments fill it
  at 14 px, still mono caps.
- Behaviour: `KeyBank` is a `radiogroup` (arrows move + select, Home/End); `LinkBank` is a `nav` of links
  (`aria-current="page"`); `TabList` is a `tablist` with `Tab` and `TabPanel`. Variants: `text` · `icon` · `icon+text`.
  Up to 6 segments; more → Select.

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
A pill (r071). Read-only it is a 22 h tag: a 6 % ink tint, a stone 12/16 label at 500, 9 px side padding, no border. When
it acts (`filter`, `onClick`, a link) it is a 28 h pill with a 1 px `--lm-line` hairline, a 4 % ink tint and 12 px side
padding, and it grows to the 48 px touch target under a coarse pointer below 768 px.
Kinds: `plain` · `metric` (a leading category swatch: a 10 × 3 line key for line metrics, an 8 × 8 rounded square for bar
metrics) · `domain` (a 6 px dot in the domain's solid, `domainColor(domain)`; the words stay stone, so the colour is on the
mark only) · `filter` (a toggle; pressed = gold wash + gold edge + ivory label) · `status` (only a 6 px dot in the
severity colour and the words, nothing around them). Removable (`onRemove`): a trailing 20 px × with a 28 px hit area.
`Swatch` takes a `category`, a `domain` or a colour.

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
 23.4 %                    ← readout-md (28) tabular; unit 14 stone
 ├──────█──────┤ 20–27 %   ← RangeBar + range text (12, ink-2)
```
Variants: `lg` (32), `md` (28, Your body) and `sm` (20, the readout strip); `ReadoutInline` is the one that sits in a
sentence. r071: the figure and its unit are drawn by a `HeroNumber` (§18.5) at the readout's own sizes (tabular, no
count-up; the unit 14 px, 12 on `sm`, after the figure), so one component draws every number and a readout is named once,
in the figure (`role="img"`, "19.7 kg, range 18.6 to 20.9"); the look is unchanged.
Updating (`animate`): the digits that changed roll (`HeroNumber`'s `roll`: each changed digit drops 6 px and fades in over
`--lm-dur-fast`) — the fixed-place readout rule. Stale/unknown: "—" with caption "needs waist".

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

### Notice `<Notice>` (the banner; the v0.1 "Warning banner `<Banner>`" is superseded)
Full-width inside the content column (not a toast). r071: it takes the card material (grain over the card colour, the
faint gold wash) with NO glow, a 0.5 px `--lm-line` hairline and 14 px corners (`--lm-radius-field`): a banner is a short
strip, not a data card, so it never takes a domain glow and never wears the 20 px card corner. Anatomy: a drawn mark (a
caution triangle in gold, a danger octagon in rose; info and ok carry none) · title (14/21 at 500, ivory) · one body line
(14/21, stone) · at most one action · dismiss (info and ok only). Severity lives on the mark only: no tinted fill, no
coloured title, **no coloured side stripe**. Danger banners cannot be dismissed while the condition holds; they can be
collapsed to a one-line summary. `layout="ruled"` (inside a card) is plain text with no surface and no rules.

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

### Drawer `<SidePanel>` (alias `<Drawer>`; desktop)
392 px (`--lm-drawer-w`). Overlay: `--lm-chassis-2` with a hairline left edge; the page keeps its width and positions
(no scrim unless `scrim` opts in). `ResponsivePanel` always overlays on desktop; legacy `dockAtXl` is ignored. An explicit
`mode="docked"` remains a low-level API for authored layouts, unused by the app. r071: an overlay panel opens on the spring from the right (`--lm-ease-spring`, 320 ms, one 2.5 %
overshoot, behind `@supports (transition-timing-function: linear(0, 1))`), leaves in 220 ms with `--lm-ease-in`, and a hard
colour extension past the right edge (0 blur, offscreen at rest) hides the gap the overshoot would open; under reduced
motion it does not move and cross-fades in 100 ms. Header grammar: title · Cancel with a filled commit key, or title · ✕
(`DESIGN.md`, Dialogs, sheets, side panels). `Esc` closes. Focus moves into the panel on open and returns to the invoking
control on close (`useRestoreFocus`).

### Sheet `<Sheet>` (mobile)
Bottom sheet on `--lm-chassis-2`, 24 px top corners (`--lm-radius-xl`; they were 18), a 0.5 px top hairline, scrim
`--lm-scrim` (except in the peek detent), detents 35 / 60 / 92 % and content height, a 32 × 4 drag handle, swipe down to
step down or close. r071 motion: it opens on a spring (`--lm-ease-spring`, 320 ms, a damped oscillator that overshoots once
by 2.5 %, behind `@supports (transition-timing-function: linear(0, 1))`; `--lm-ease-sheet` elsewhere), leaves in 220 ms with
`--lm-ease-in`, and the scrim fades in over 200 ms. A hard 32 px colour extension below the screen edge (0 blur, offscreen
at rest, so it is not a shadow) hides the gap the overshoot would open. Under reduced motion (the OS setting or Settings ›
Motion "reduce") it does not move: a 100 ms cross-fade. Content scrolls inside; the header stays. Uses `<dialog>` semantics
when modal, `role="region"` in peek. Focus returns to the opener when it closes (`useRestoreFocus`;
`src/components/__tests__/focusRestore.test.tsx` has one test per host).

### Dialog `<Dialog>`
Only for destructive confirmation, import preview and the first-run consent. Centred, elevated (`--lm-elevated`, 24 px
corners, a 0.5 px hairline), max 480 (640 `wide`), scrim, focus trap, `Esc` = cancel (except consent). Destructive dialogs
require the action verb on the key ("Delete scenario"), never "OK". It enters from 6 px below over 200 ms; under reduced
motion it cross-fades in 100 ms; focus returns to the opener on close.

### Popover `<Popover>`
Menus, date picker, conflict explanations. Raised, radius md, shadow pop, 8 px offset. Portaled
(escapes overflow). Arrow keys navigate menu items; typeahead.

---

## 11. Navigation

### Sidebar `<Sidebar>` (≥ 1024) and dock `<TabBar>` (< 1024)
See `INFORMATION_ARCHITECTURE.md §3`; the destination lists are in `src/components/README.md` §0 (`nav.ts`,
`modeNav.tsx`). r071 rewrote this entry (the v1 "both are KeyBanks, selected = pressed key + yellow indicator dot" is
gone). The rule that results: **ivory is where you are; gold is what you can do or chose.**
- Dock (phones): a frosted dock holding a floating pill (`--lm-nav-pill-bg`, Charcoal Card at 94 %, a 0.5 px hairline,
  36 px ends, `--lm-nav-pill-h` 64 px, at most 34 rem wide) of five keys that share its width equally, each about 56 px tall: a 22 px icon over a 12 px
  label (label-s 500), the destination's name as the accessible name. The current key is an IVORY capsule (`--lm-nav-on-bg`) with a
  near-black icon (stroke 2) and a 600 label (`--lm-nav-on-fg`), drawn by ONE thumb (`.lm-tabbar__thumb`, translated by
  `--lm-tabbar-i`, the index `Chrome.tsx` writes) that glides to the pressed key by `transform` in 280 ms (`--lm-dur-glide`)
  with the one damped overshoot (`--lm-ease-needle`). Under reduced motion it jumps; a page the dock does not list hides
  it; a mode change cross-fades the keys. A press shrinks the key's icon and label to .96 for 80 ms. Forced colours: the
  capsule is a `Highlight` fill with `HighlightText` ink.
- Sidebar (desktop): 240 px, or a 64 px icon rail; 40 px rows with 14 px corners (`--lm-radius-field`), a 20 px icon and a
  14/20 label at 500; hover a 6 % ink tint. The current row is a 9 % ivory tint with an ivory icon (stroke 2) and a 600
  label: no gold and no side stripe; forced colours draw a 2 px `Highlight` outline. (The Settings master list still takes
  the gold-soft row until package 5b moves it.)
- Badges: a waiting proposal (Coach) or stale results (Simulate) is a 6 px gold dot at the icon's top right, never a
  count; on the dock's current key the dot is near-black with a capsule-coloured ring, because gold on ivory would be
  1.5:1.

### Top bar `<TopBar>` (was "Context bar `<ContextBar>`")
One per screen, at the top of the content column, sticky: 56 px (one 48 px key row plus 4 px above and below, the safe area
added), or 66 px on a phone tab page that has a fact row. Left: Back (pushed pages), then the title: the page role
(`--lm-text-page`, 24/28 at 600, one line, truncated with an ellipsis; r071, SPEC Q2: no large collapsing title); on a
phone's pushed page it is title-m beside Back. ABOVE the title, ONE fact in mono caps (`--lm-text-meta`, stone, one line: the
date, or "Day 15 of 84" where a `DateControl` follows): on a phone tab page its own full-width row above the title row, on
desktop and on pushed pages stacked over the title in the heading; the h1 stays first in the DOM and `order` draws the
date first (r071, SPEC Q4: "like the references"). Right: at most two status icons, an optional primary key, the one ⋯.
Tabs and progress rows sit inside the bar under it, and the tintless frost comes in over the first 80 px of scroll. Every
control in the row is the bar height (36 / 44 px). The v1 "chassis-2 with a 1 px line-strong bottom rule" is gone.

### Scenario switcher `<ScenarioSwitcher>`
Title with chevron → popover (desktop) / sheet (mobile): list of scenarios (name, horizon, last
run, stale dot), actions: New · Duplicate · Rename · Delete. Current = check.

---

## 12. Data table `<DataTable>` (table view twin)
Sticky header + first column, 13 px condensed tabular numbers, right-aligned values, row hover
wash (`--lm-ink` @ 4 %), zebra none, 1 px row rules. Columns: date/time + each visible metric
(value and range as "19.8 (18.6–21.0)"). Download CSV key. Virtualised above 500 rows.

---

## 13. v0.2 primitives (intake, ladder, Living mode, Coach)

Shared rules for everything in this section:
- **Uncertainty travels with the number.** Any estimated, logged-by-AI, measured or projected value
  renders as value + likely range (80 %) + source, using `EstimateReadout` / `SourceChip` (§13.12).
- **Chrome stays achromatic.** New state encodings (adherence, change states, burdens, rung
  selection) use ink, fill, hollow, dash and hatch — never green/red. Category and rung hues appear
  only on data marks and on **identity keys** that stand for a series (a rung key, a metric swatch,
  an optimiser slot) — the same exception the v0.1 plan letter keys and lane swatches use.
- **No yellow on Living screens** except the now-hand and indicator dots: there is nothing to "run".
  The yellow key returns only where a planner or simulation run starts (Find plans, Run, and the
  "Find plans" verb of the Ideal's Limits to change panel).
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

### 13.8 Date control `<DateControl>` (r069 U2, restyled r071; Today, Food, Train, Ring)
Replaced the week strip (owner, r069: "only the current date should be shown"). One full-width row reads the selection
("Today · THU 29 OCT", "This week · 26 OCT–1 NOV") and opens the calendar (Gauge's history picker in Vitals' material):
a sheet on phones, a popover from 1024 px. See DESIGN.md "Date control" for the look; the API:
```
<DateControl
  value={period}                 // Period { kind: 'day'|'week'|'month'|'year'|'range', from, to } (period.ts)
  onChange={(p) => …}            // put it in the address; every pick applies at once
  today={today}
  periods={ALL_PERIODS}          // default DAY_ONLY (no bank)
  max={today}                    // optional bounds; a plan page leaves max open for its preview days
  useMarks={useRingDays}         // optional hook (from, to) => Set of days with data, called only while open
  domain="steps"                 // optional DomainName (r071): the calendar icon and the data dots wear this hue
/>
```
`periodFromSearch` / `periodSearch` read and write the `?date=` / `?period=` address; `periodDays`, `periodEnd`,
`periodStats` give a page its days so far and their total and average.
r071 (package 0A): the row has the field radius (14 px), the lead word ("Today") in Geist 600 and the dates as a mono-caps fact;
the calendar icon and the dots of days that hold data wear the page's domain hue (`domain`; stone without one); weekday
letters are mono caps; the selection stays gold. Its styles moved from `living.css` to
`src/features/living/components/dateControl.css`.

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
 —      ⌁ steps            9 000                 6 120          [ ]
 —      ◷ fast             until 12:30 · 14 h done, 2 to go     [ ]
```
- Columns: time (13 condensed tabular, ink-2) · glyph 20 · label (15/500) + target/plan (13 ink-2) ·
  logged value as `EstimateReadout` inline · **tick key** 44 × 44 · chevron IconKey.
- Tick key states: empty (well) · done (ink fill, inverse check) · partial (half fill) · skipped
  (hollow with a 1 px diagonal) · assumed (dashed outline; backfilled days).
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
  "Coach · photo", "Coach · photo + your grams", "Coach · text", "label", "assumed" (dashed
  outline). Tap → popover with the
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

### 13.14 Score tile `<ScoreTile>` and baseline gauge `<BaselineGauge>` — removed in 0.6.0 (manual-only; ring data lives in [Gauge](https://github.com/patalbansishashank/Gauge))

### 13.15 Stream matrix `<StreamMatrix>` — removed in 0.6.0 (manual-only; ring data lives in [Gauge](https://github.com/patalbansishashank/Gauge))

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
| Progress metric rows | rows that link to a metric page | static readouts |
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
- **Optional mode** (questions that are optional, B0): the later key reads "No, skip this chapter"
  and records "skipped by choice" (not asked later). An optional picker (pantry) has no key of its
  own: an empty list answered with Next is the choice ("skipped, by choice").
- States: unanswered (Next `aria-disabled` with reason "Choose an answer first") · answered
  (pressed key / filled fields, Next enabled) · saving (Next spinner) · error (InlineWarning danger
  above the footer, focus moves to it) · loading (3 skeleton lines).
- A11y: `fieldset` + `legend` (the prompt, including the restated context); the ParentChip is
  inside the legend's description (`aria-describedby`); shortcuts as intake-v3 §3.6.

### 14.4 Supplement row `<SupplementRow>`
One row per supplement, used in the intake (S2), Settings › Supplements and the Food tab.
Container query on the row (`container-type: inline-size`), so it fits any column.
```
 any row width ≥ 480 px
 creatine monohydrate [A ●●●●]                                     [taking|have it|not for me]
 3–5 g a day
 [ 5                                    g ▾ ]  each time                    ← amount grows, unit + caption at the end, 44 h
 [ morning  |  midday  |  evening  |  night ]                               ← 4 equal keys, 44 h
 < 480 (390 px screen): the same, the state is a Select
```
- **Left**: name 15/500 (wraps, never under the controls) + GradeBadge `sm` (evidence for the
  person's goal) + 12 ink-2 catalogue dose line. Left column `minmax(140px, 1fr)`.
- **Right**: the state (`justify-self: end`). **Under the name, two lines that take the row's full width**
  from its left content edge to its right one, gap 8, controls never overlap (each has a minimum width
  and the line wraps instead of shrinking):
  - dose: NumberField (44 h, min 88 w, grows; 16 px text on touch) with the unit inside as a suffix (g ·
    mg · µg · IU) or, when the catalogue lists more than one unit, a unit Select (96 w, 44 h) after it,
    then the "each time" caption.
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
- **Counts**: header total, per-group "n of N" and the "N selected" line. In the intake the picker
  draws no footer or Done key: it registers its save with the card (`CommitKey`), so the step's one
  docked Next (Save when changing) writes the list and moves on; a failed write keeps the turn open.
- **Optional** (pantry): no key of its own. Next with an empty list (nothing ticked, or "Clear
  defaults" first) records "skipped, by choice"; the card's Skip still means "ask later". The
  picker shows no "required" marks.
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
- [ ] SupplementRow at 360 / 390 / 768 / 1440: name, dose, times and state never overlap; the amount line and the times line each span the row's full width (equal 44 px time keys, 44 px amount field).
- [ ] SupplementRow "have it, don't take" hides dose and times; the same row renders in Settings and the Food tab.
- [ ] Picker: search filters across groups; counts update; dashed outline on region defaults; notes show on chips; paste-a-list previews before adding.
- [ ] BecauseChip readable in both themes, opens its popover with keyboard, short form at narrow widths.

## 15. Batch 03 primitives (server, pairing)

Specs that use these: `screens/server.md`, `screens/settings-sync-ai.md §13`. (The MQTT and
correction primitives were removed in 0.6.0, when Vitals became manual-only.) No new colour tokens: everything uses the faceplate, well, key,
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

### 15.2 Shown-once block `<ShownOnce>` (codes and keys)
```
 ┌───────────────────────────────────────────────────────────┐ inside a Faceplate: hairline frame,
 │ ⬣ Shown once. Copy it now: Vitals doesn't keep a readable │ no box shadow (not a nested card)
 │   copy. If you lose it, make a new one.                   │ caution mark + 13/500 ink
 │ ───────────────────────────────────────────────────────── │
 │ key        q8V…(32 chars)…Lm                 [Copy]       │ row 44 h, value 15 tabular; full
 │                                                           │ value shown, wraps by character
 │ ☐ I've saved this  (variant key)                          │
 │ [Done]  (enabled when ticked)                             │
 └───────────────────────────────────────────────────────────┘
```
- Variants: `code` (a pairing code with QR and an expiry countdown, no tick box; closes itself when
  used) · `key` (one agent key + recipe lines, each with Copy, + tick box). (A `credentials`
  variant for the MQTT card was removed in 0.6.0.)
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

Small variant (state chips inside rows, e.g. provider rows): 20 h, 12/500 text, glyph 12, no
popover. Row words use the same set plus row-specific words ("signed in", "key set").
Click (full pill) → Popover: state line, last sync, waiting changes, server name and host, **Check
now** / **Sync now**, "Server settings". Spinner stops with reduced motion (static arc).

### 15.4 Corrected-record marker `<CorrectedMarker>` and fed-by line `<FedBy>` — removed in 0.6.0 (manual-only; ring data lives in [Gauge](https://github.com/patalbansishashank/Gauge))

### 15.5 Acceptance checklist (components)
- [ ] PairingCodeField: auto-advance, paste of code or link fills both groups, errors linked and announced, Scan QR fills and submits; 48/56 h; readable at 390.
- [ ] Pairing QR is black on white with a quiet zone in both themes and scans from another phone.
- [ ] ShownOnce: two variants; long values wrap at 390 without overflow; Copy confirms politely; after Done only the masked line remains; never in exports or Coach context.
- [ ] ServerPill: six states with glyph + word; small variant inside rows; popover keyboard-reachable; reduced motion stops the spinner.
- [ ] All three in light and dark: text ≥ 4.5:1, glyphs ≥ 3:1 on `--lm-face`.

---

## 16. Domain card recipe (r071)

A card says what it shows with its domain, not how much of it there is. The values are tokens, not a table here: the hues
are `design/tokens.css` §5, the glow's position, size and strength §15, the motion §16. The CSS is `src/styles/components.css`
("the card", "domain wiring", "the glow"), and `src/styles/__tests__/tokens.test.ts` pins it. Specimens: `/dev/components` ›
Material and › Cards.

There is ONE recipe. `Faceplate` (`.lm-face`), `.lm-material`, `.lm-card` and `GradientCard` (`.lm-material` plus the layout
class `lm-gcard`, §18.1) draw the same material and take the same domain wiring and the same glow, declared once in
`components.css`. `src/components/card.css` only lays a `GradientCard` out (head, body, foot, the open link) and moves its
glow (`data-glow`, `data-reveal`): it declares no role variable, no glow size or alpha and no gradient, and the one glow input it sets is
`--lm-glow-pos`. `src/components/domain.css` and `foundation-fallback.css` no longer exist, and
`src/components/__tests__/r071Css.test.ts` fails if a second copy of the wiring or the glow appears. `Faceplate` stays the
plain titled card for sections, forms and tools; `GradientCard` adds the icon · title · (i) head, the foot, the whole-card
open target and the glow's fade-in.

**Opt in.** `data-domain="energy"` on a `Faceplate`, `.lm-material` or `.lm-card`, or `<GradientCard domain="energy">`, which
sets it. A picture or a number takes `data-hue` (its `hue` prop) for the same variables. The domains are the eight of the
wheel, in its fixed order: `heart`, `energy`, `food`, `steps`, `recovery`, `body`, `sleep`, `videos`; plus `plan` (alias `gold`
for `data-domain`) for the Next-up card. `neutral`, or no attribute, is the default card (the gold wash, no glow). In
TypeScript, `Domain` (`src/components/domain.ts`) is the eight names plus `plan` and `neutral`; `DomainName` is
`Exclude<Domain, 'neutral'>` (what `Chip`, `Swatch` and `DateControl` take); `domainToken(domain, role)` is the CSS colour of
one role (`solid`, `ink`, `deep` or `dim`); and `domainColor(domain)` (`src/components/Chip.tsx`) is the solid of
`domainToken`. The Android widgets' palette (the eight hues with their four steps, each card's glow, the card corner) is
generated from the real `--lm-hue-*` and `--lm-glow-*` tokens by `pnpm android:design` (`scripts/android-design.mjs`):
after changing one, run it and commit the result (`src/styles/__tests__/androidDesign.test.ts` fails otherwise).

| Domain | Covers |
|---|---|
| `heart` | heart rate, zones, Heart Points, blood oxygen |
| `energy` | energy burned and balance, kcal, the fast |
| `food` | eaten, macros, meals, groceries, pantry |
| `steps` | steps, distance, activity, workouts, Train |
| `recovery` | HRV, stress, skin temperature, the recovery and day scores |
| `body` | weight, composition, girths, blood markers |
| `sleep` | sleep, stages, bedtime |
| `videos` | short videos (the library only) |
| `plan` / `gold` | Next up, plan rows, adherence, goals, check-ins |

**Variables it sets**, on any element that carries `data-domain` or `data-hue`, for itself and its descendants: `--lm-hue` (the
solid: a card icon, today's bar, in-range ticks, a status dot), `--lm-ink-h` (the soft ink tint: units, mono meta, the footer
state word), `--lm-deep` (the glow core: never a mark, never text), `--lm-dim` (the unlit remainder of a track, a gauge or a tick
row), `--lm-tone-2` (the secondary text colour on that card: the ink tint mixed 62 % into stone, which a `HeroNumber`'s unit and
`MonoMeta tone="hue"` read), and the domain's `--lm-glow-pos`, `--lm-glow-size` and `--lm-glow-a`. `plan` sets `--lm-hue` to gold
(`--lm-signal`), `--lm-ink-h` to ivory, `--lm-deep` to `--lm-hue-gold-deep`, `--lm-dim` to `--lm-unlit` and `--lm-tone-2` to
stone. `data-domain="neutral"` sets `--lm-hue` to stone (`--lm-ink-2`), `--lm-ink-h` to ivory, `--lm-deep` to the card colour,
`--lm-dim` to `--lm-unlit` and `--lm-tone-2` to stone; with no attribute nothing is set and the new pictures fall back to the
same stone and ivory (`--lmz-*` in `viz-base.css`). A control that is not a card (the date row; `DateControl domain`) takes the
attribute for the variables only: the glow needs the card classes.

**The glow.** One `radial-gradient(in oklab ellipse <size> at <pos>, …)` of `--lm-deep` in five eased stops, alpha 1, .84,
.50, .16 and 0 (each times the card's core alpha and `--lm-glow-k`) at 0, 20, 42, 64 and 86 %, over the card's grain tile
(`--lm-grain-card`, fixed to the viewport) over `--lm-face`. The position, size and core alpha of each domain are tokens:
`--lm-glow-<domain>-pos`, `-size` and `-a`.
- One gradient layer: never a second one on the card (two read as a woven grid) and never a gradient on an inner element.
  The card hairline keeps the default `border-box` clip, so the glow tints the edge where it meets it.
- Never animated: it fades in once over `--lm-dur-glow` (900 ms) through the registered `@property --lm-glow-k`.
  On a plain `Faceplate` or `.lm-material`, `data-glow="pending"` holds it at 0 (remove the attribute to fade it in) and
  `data-glow="off"` is 0 with no transition. `GradientCard` holds it with `data-reveal="pending"` until the card is 20 % in
  view (its `animate` prop, default true; `card.css`) and switches it off with `data-glow="none"`; its `glow` prop moves the
  glow without resizing it, through `data-glow` (`card.css`: `tl` 0% 0%, `tr` 100% 0%, `bl` 0% 100%, `br` 100% 100%,
  `bottom` 50% 112%), and an object `{ pos, size, a }` (`data-glow="custom"`) sets the three inputs inline.
- Anchored away from small text: no small stone text and no solid-coloured mark in the core zone, and pale stone
  (`--lm-ink-3`) never on a glow. Ivory text and ivory marks are safe everywhere (measured at least 5.1:1 at every glow's
  brightest point).
- `--lm-glow-k` (0 to 1) scales or switches off every glow; there is no user setting (SPEC Q6).
- Behind `@supports`: an engine without `in oklab` or `color-mix()` keeps the plain card.
- Never on a banner (`Notice`), an inset well (`data-variant="inset"`) or a control.

**Marks on a glow.** Focal marks (a line, its end point, lit ticks, a thumb) are ivory; the hue lives in the glow and in the
secondary marks (`--lm-hue`, `--lm-ink-h`, `--lm-dim`). Text never wears the solid. The eight hues are never plotted
together (all pairs fail the colour-vision gates, by design): a chart that needs several series uses a derived set
(`--lm-stage-*`, `--lm-intensity-*`, `--lm-hr-zone-1…5`, `--lm-macro-*`) or the category palette. One hero number per card,
with its unit small and muted beside it; facts in mono caps.

---

## 17. Picture motion hooks (r071)

`src/app/motion.ts`, beside the page entrance (`usePageEntrance`, `useEnter`, `enter`). Tests:
`src/app/__tests__/motionHooks.test.tsx`. Durations come from the motion tokens in `design/tokens.css` §16 (the `MOTION`
constant mirrors them in ms, `EASE_OUT` is `--lm-ease-out` and `EASE_NEEDLE` is `--lm-ease-needle`; `tokens.test.ts` pins
both). The components that use the hooks are built (§18 to §20) and keep no motion code of their own. `@/components` still
exports `useReveal({ animate, threshold })` (`[ref, pending]`), `useMotionEnabled(animate)`, `useCountUp(target, { enabled,
active, from, duration, updateDuration })` and `canAnimate()`, which the pictures and the page code call: they are thin
wrappers over `useInView`, `useCountUp` and `motionAllowed()` here (`src/components/lib/reveal.ts`, `lib/motion.ts`; test:
`src/components/__tests__/reveal.test.tsx`), so there is one implementation.

| Hook | What it does | Returns | Used by |
|---|---|---|---|
| `useInView(ref, { once, threshold })` | true once 20 % of the element shows (`once: true`, `threshold: 0.2` by default); true at once where motion cannot run | boolean | `GradientCard` (the glow's first view), `HeroNumber`, and every picture that animates: `RadialTicks`, `DottedTrack`, `HighlightBars`, `GlowLine`, `RangeScale`, `StackBar`, `WindowBar`, `Hypnogram`, `StateStrip`, `ShareBar` |
| `useCountUp(value, { from, duration, updateDuration, start, reserve })` | 0 → `value` in 1100 ms expo-out on the first start; from the shown value in 400 ms when `value` changes | number (or `null` for no value) | `HeroNumber` |
| `useSweep(count, { stagger, start })` | how many of `count` ticks are lit while a gauge sweeps, one per 14 ms | integer | no component (the gallery's motion demo) |
| `useDrawIn(ref, { mode: 'clip' \| 'dash', duration, delay, start })` | a line draws left to right in 1200 ms: a `clip-path` reveal of the element, or `stroke-dashoffset` on an SVG path | void | no component (the gallery's motion demo) |
| `useGrow(ref, { selector, axis, stagger, duration, start })` | bars scale from their baseline (`axis: 'y'`) or a stacked segment from its left (`'x'`), 700 ms, 60 ms apart | void | no component (the gallery's motion demo) |
| `usePulse(times)` | true for `times` (default 2) pulses of 2.4 s from the first render, then false for good (a mark that must pulse again remounts with a new `key`) | boolean | no component (the gallery's motion demo) |
| `useFlip(ref, key, { selector, duration })` | children (`[data-flip]`) slide from where they were to where they are when `key` changes, 280 ms on `--lm-ease-needle`. Places are measured against `ref`'s own box, so scrolling the page is not a move, and measured again when the box or a child is resized; a new slide starts from where a still-running one had the child | void | `CardGrid`, `CardLibrary` |
| `fadeCue(el)` | the 100 ms cross-fade a state change gets under reduced motion instead of a move | void | `CardGrid` (a card added) |

`enter(elements)` (the page entrance's rise and fade: 10 px, 420 ms) also serves `CardGrid`, for a card added after mount.
The pictures do not call `useSweep`, `useDrawIn`, `useGrow` or `usePulse`: each sets `data-reveal="pending"` on its root
while its `animate` prop is on and it is not yet in view (`useInView`), its stylesheet holds the hidden values and the
transitions, and removing the attribute is the animation (§19). Where motion cannot run the attribute is never set, so the
final markup is the static markup; `fakeMotion()` in `src/components/viz/__tests__/motionHelpers.ts` lets a test exercise
both paths.

`usePulse` feeds the live mark: `.lm-live` (`components.css`) is a 10 px ivory dot with two thin rings; put `pulsing` in
`data-pulse` and the rings pulse twice (`--lm-pulse-cycles`, 2.4 s each: 4.8 s, under WCAG 2.2.2's five seconds), then stop.
The mark never loops; a breathing status dot exists only while a real process runs. `.lm-meta` and `.lm-num-prop` are
the mono-caps and proportional-figures classes the same pictures use.

Shared rules:
- State, not decoration. Every hook has a final frame that is the real content, and `motionAllowed()` false (jsdom,
  `prefers-reduced-motion`, Settings › Motion "reduce") makes every hook return that final state on the first render:
  `useInView` true, `useCountUp` the value, `useSweep` the count, `usePulse` not pulsing, the others do nothing.
- Animate only `transform`, `opacity`, `clip-path`, `stroke-dashoffset` and the registered `--lm-glow-k` (a picture's
  stylesheet may also move stroke and fill colours); never a layout property, never a gradient. Simple reveals use the Web
  Animations API (`fill: backwards`), so a picture works without GSAP.
- Start when 20 % in view, once per mount. A value that changes after a log re-animates from the old value to the new, not
  from zero.
- Width is reserved before a count-up (`HeroNumber` holds it with an invisible copy of the final string; a caller of
  `useCountUp` sets a `min-width`; proportional figures for heroes, tabular for clocks and tables), so the unit never
  moves; the element carries an `aria-label` with the final value and the animating digits are `aria-hidden`.
- Tokens: `--lm-dur-count` 1100, `--lm-dur-draw` 1200, `--lm-dur-glow` 900, `--lm-dur-bars` 700, `--lm-dur-fill` 900,
  `--lm-stagger-tick` 14, `--lm-stagger-bar` 60, `--lm-pulse-cycles` 2, `--lm-dur-spring` 320, `--lm-dur-exit` 220,
  `--lm-dur-glide` 280, `--lm-ease-in`, `--lm-ease-spring` (AUDIT aliases: `--lm-dur-tick`, `--lm-dur-grow`,
  `--lm-ease-expo-out`). Under reduced motion the durations drop to 0.01 ms, the staggers to 0 and `--lm-pulse-cycles` to 0.

---

## 18. Card components (r071)

The card, its head, foot and panel, and the numbers and facts that sit in them. All are exported from `@/components`.
Styles: `src/components/{card,infopanel,hero,mono,status}.css` (`@layer components`, tokens only, each with a forced-colours
block; `src/components/__tests__/r071Css.test.ts` pins them). Specimens: `/dev/components` › Cards. The rules of every
card: one hero number, its unit small and muted beside it; facts in mono caps; one glow in the card's domain hue (§16);
ivory text and marks on the glow, small stone text and solid marks out of its core; gold only for the action, the
selection and the moment; no card inside a card.

### 18.1 Card `<GradientCard>`
The metric card (`GradientCard.tsx`, `card.css`). It renders `<article class="lm-material lm-gcard">` (`as`: `article`,
the default, `section`, `li` or `div`): the material of §16, so a `Faceplate` with `data-domain` and a `GradientCard` look
alike. What it adds is the icon · title · (i) head, the foot, one whole-card open target and the glow's fade-in on first
view. `Faceplate` (§0) stays the plain titled card (title, fact caption, actions, footer) for sections, forms, tools and
every page that is not a metric card, and its markup does not change.
```
<GradientCard domain="sleep" size="card"
  head={<CardHead icon={Moon} title="Sleep" info={…} />}
  foot={<CardFoot state={{ word: 'Goal met' }} right="Goal 7 h 30" />}>
  <HeroNumber parts={[{ value: 7, unit: 'h' }, { value: 56, unit: 'm' }]} size="num-l" label="7 hours 56 minutes" />
  <MonoMeta tone="hue">23:12 – 07:08</MonoMeta>
</GradientCard>
```
- Anatomy: `head` · `<div class="lm-gcard__body">` holding the children (a column, 12 px apart; absent when there are none) ·
  `foot`. A flex column with padding `--lm-card-pad` (18, 24 from 1024), radius `--lm-card-radius` (20), a 0.5 px `--lm-line`
  hairline, no shadow. `card.css` spaces the three parts itself; it does not read `--lm-card-inner-gap`.
- Props:

  | Prop | Meaning |
  |---|---|
  | `domain` | a `Domain`, default `neutral` (the gold-wash card, no glow). Sets `data-domain`, so every picture and number inside wears the card's hue without a prop |
  | `glow` | `tl`, `tr`, `bl`, `br`, `bottom`, `none`, or `{ pos, size, a }` (exact position, size and core alpha). It moves the glow and never resizes it; a glow encodes the domain, never the value |
  | `size` | `hero`, `card` (default), `tile` or `slim` (a `CardSize`, the word `CardGrid` reads). `hero` and `slim` fill a row, `card` is half a row from 1024, `tile` a quarter. `slim` lays the card out as one row (a round key, the words, a time: 14 px apart, padding 14 20 14 14) |
  | `variant` | `plain` (default) · `inset` (a flat `--lm-well` card, no glow) · `flush` (no padding, for a chart or raster that bleeds) |
  | `head`, `foot` | a `CardHead` and a `CardFoot`; nothing else belongs in either slot |
  | `href` or `onOpen`, `openLabel` | the card's one open target (below); `openLabel` is the accessible name when "{title}" is not enough |
  | `animate` | default true: the glow fades in once at 20 % in view (900 ms). False, reduced motion and tests draw it at once |
  | any `<article>` attribute | passes through (`aria-label`, `id`, `className`, `style`, `data-*`) |
- States: `data-reveal="pending"` while the glow waits for its first view (`animate` and not yet 20 % in view, so never
  where motion cannot run), `data-glow="tl|tr|bl|br|bottom|none|custom"` for the position or off (`tl` 0% 0%, `tr` 100% 0%, `bl` 0% 100%, `br` 100% 100%, `bottom` 50% 112%; an object sets all three glow
  inputs inline and is `custom`). Also `data-domain`, `data-size`, `data-variant`, `data-open` (with an open target) and
  `data-enter` (the card rides the page entrance: `src/components/README.md` §0, Motion).
- Open target: with `href` the title is a router link, with `onOpen` a button; either way its `::after` stretches over the
  whole card (the card's radius), so the card is one target, and the (i), keys, links and fields sit above it. Hover
  (hover-capable pointers) tints the card 4 % ivory; focus-visible draws the 2 px `--lm-focus` ring inside the card edge.
- Keyboard: `T`, with focus inside the card (not in an input, textarea, select, editable field, dialog or aside) and a
  Table twin in the head's `InfoSpec`, opens the (i) panel at the table. Ctrl, Meta and Alt combinations do nothing.
- A11y: a card with a head is labelled by its title (`aria-labelledby` the heading) unless an `aria-label` is passed.
  Forced colours: a 1 px `CanvasText` border on `Canvas`.
- Tokens: `--lm-card-pad`, `--lm-card-radius`, `--lm-hairline`, `--lm-line`, `--lm-well` (inset), `--lm-focus`, and the
  glow's inputs and role variables of §16.
- Tests: `src/components/__tests__/cards.test.tsx`, `r071Css.test.ts`.

### 18.2 Card head `<CardHead>` and the (i) key `<InfoKey>`
`CardHead.tsx`. An icon in the domain's hue, the title and, at the right, the (i). Nothing else belongs in a head: no
Details, Open or Table key (the foot carries the one navigation, the (i) panel the table).
- Anatomy: `<header class="lm-cardhead">`, a row 6 px apart and at least `--lm-info-size` high: the icon (18 px, `--lm-hue`,
  decorative) · the title (an `h3`; `as` gives `h2`; one line with an ellipsis, `--lm-text-card`: 15/20 at 600, 16/22
  from 1024, Geist, with the full title as its `title` attribute) · `meta` (optional: a `MonoMeta` pushed to the right for
  a live fact such as LIVE or REC) · the (i). In a card with an open target the title text is the stretched link or button.
- Props: `icon` (an icon component), `title`, `info` (an `InfoSpec`; without it the head has no (i)), `meta`, `as`.
- The (i) is `InfoKey` (`label`, `onClick`, `expanded`): a `<button class="lm-info">`, a 24 px footprint (`--lm-info-size`)
  with a 48 px hit area (`--lm-info-hit`) drawn by a pseudo-element. At rest the surface and edge are transparent;
  hover/focus uses `--lm-info-key-bg-hover` (7 % ivory) and an optional hairline. The 14 px Lucide
  `Info` in stone (ivory on hover), press scale .94, the 2 px gold focus ring at 2 px. It is named "About {title}",
  has `aria-haspopup="dialog"` and `aria-expanded` while its panel is open.
- Tokens: the (i) reads its own `--lm-info-key-*`. `--lm-info-fg/-bg/-edge/-mark` are the "info" severity's (a notice) and
  are not read here; `tokens.test.ts` fails if a token is declared twice and pins the (i)'s values.
- Tests: `cards.test.tsx`, `src/styles/__tests__/tokens.test.ts`.

### 18.3 Info panel `<InfoPanel>` and `InfoSpec`
What the (i) opens (`InfoPanel.tsx`, `infopanel.css`). A `ResponsivePanel` (§10): a bottom sheet below 1024 px, a 392 px
side panel from it, always overlaying without changing the page width; so it springs in, restores focus and leaves like
every panel. It commits nothing, so its one way out is the ✕ (the One Way Out Rule). A foot action ("Remove from Today",
"Add as widget") is allowed, a commit never.
- `InfoSpec`, what a page passes as `info`:
  - `title`: default the card's title (22/26, -0.015em);
  - `body`: a string, a node, or sections `{ heading?, body }`; the reading text: plain, second person, 25 to 60 words,
    `--lm-text-read` (15/23, 16/24 from 1024) at 400, at most 62ch;
  - `source`: `{ kind, words? }`, kind `ring`, `phone`, `estimate`, `logged`, `plan` or `engine`, said as "Your ring", "Your
    phone", "An estimate", "What you logged", "Your plan", "The Vitals engine" and then `words` (`sourceText`);
  - `range`: a node (a band table, a sentence); `terms`: `{ term, text }[]`, the old per-value popovers;
  - `evidence`: one or several `{ to, label, grade? }` links to `/evidence` pages (48 px rows with the grade badge and a
    chevron; following one closes the panel);
  - `explain`: the existing Explain content as a node; this layer never imports features, so the page passes
    `<ExplainBody metricId=… />`;
  - `twin`: `<ChartTwin data={…} />`, the picture's Table twin (§19); `footer`: the foot action.
- Order: the reading text · "Where this comes from" · "Range" (mono labels, stone body text) · terms · evidence · explain ·
  "Data table". `section="twin"` opens the panel scrolled to the table with its scroll region focused; the card's `T` key
  asks for it.
- Tests: `cards.test.tsx` (a named dialog trigger, one way out).

### 18.4 Card foot `<CardFoot>` and state word `<StateWord>`
`CardFoot.tsx`. On a `GradientCard` it takes the place of the Faceplate footer and of the fact lines ("Goal met",
"Excellent"); it renders nothing when it has nothing.
- `CardFoot`: `state` (`{ word, icon?, tone? }`, left) · `children` (the card's one control: a `KeyBank` or one key) · `link`
  (`{ to | onClick, label }`: the card's one navigation, a small text key) · `right` (the range or goal, mono caps, at the
  right edge) · `tone` (`hue`, default, tints it with the card's domain; `ink` is ivory, for a foot in a glow's core, such
  as a bottom glow). Complete facts never wrap: textual facts use `OverflowText`. Measurements determine when separate
  facts must stack (8 px, 12 px apart); the second row then aligns left with the first.
- `StateWord` (`word`, `icon`, `tone`, `ink`): a mark and a word in mono caps. The mark is a 6 px dot in `--lm-hue` or a
  14 px `icon`; `tone` `neutral | caution | danger` takes `--lm-caution-mark` or `--lm-danger-mark` for the mark. The word
  is always there: a state is never colour alone.
- Tests: `cards.test.tsx`.

### 18.5 Hero number `<HeroNumber>`
`HeroNumber.tsx`, `hero.css`. The one big number of a card, and the one number component: a `Readout` draws its figure
and unit with it (§6).
- Sizes (the numeral role tokens, `--lm-text-<role>` with `--lh`, `--ls`, `--wt`, `--font`): `hero` 64 (88 from 1024) ·
  `num-l` 52 (64) · `num` 44 (52), Geist 300, line 1, -0.035em, proportional figures · `time` 36, 300, tabular (a clock) ·
  `stat` 15/20 at 500, tabular (a secondary figure). `numerals` (`proportional | tabular`) defaults from the size. The
  weight 300 comes only from these role tokens.
- `value`: a number, a string ("16:30", "Weigh in": drawn as it is) or `null` (a dash). `format` and `decimals` make the
  text; `parts` (`{ value, unit? }[]`) draws "7 h 56" with each piece counting on its own; `unit` sits 4 px after the
  digits (6 px when it is the only part) in `--lm-text-unit` (15 px, 400) and `--lm-tone-2`, or under them with
  `unitPlacement="below"`; `range` (a string, or a pair that reads "Likely lo–hi") is the likely range under the number,
  in mono caps, and is required for an estimate; `hue` tints the unit and the range (the card's own domain is usually
  enough).
- Motion: a number counts up from 0 over 1100 ms (expo-out) on first view and from the shown value over 400 ms on a
  change (`useCountUp`, started by `useInView`); on by default for `hero`, `num-l` and `num`, set with `countUp`
  (`false`, or `{ from, duration }`). While it counts, the final text holds the width in an invisible twin, so the unit
  never moves, and the unit and range wait for the first view (`data-reveal="pending"`, then a 400 ms fade after 500 and
  700 ms). A string of a `time` figure, or any figure with `roll`, rolls the digits that changed and never counts: a
  live readout (`RollingNumber`, in its own module `src/components/RollingNumber.tsx` and still exported from
  `@/components`, draws the rolling digits). `animate={false}`, reduced motion and tests draw the final number at once, and
  the settled markup is exactly the static one.
- Quiet: `quietWord` replaces every digit with a word (the display face at 400, half the size, at least 24 px); `null`
  draws nothing at all.
- A11y: the root is `role="img"` with `label`, the final spoken value ("1,096 kilocalories"); the digits and the unit are
  `aria-hidden`, so no one hears 0 to 1,096.
- Tests: `cards.test.tsx`, `readoutHero.test.tsx`, `src/app/__tests__/motionHooks.test.tsx`.

### 18.6 Mono meta `<MonoMeta>` and status dot `<StatusDot>`
- `MonoMeta` (`MonoMeta.tsx`, `mono.css`): a fact in mono caps (Geist Mono 500, `--lm-text-meta` 11/14, 12/16 from 1024,
  +0.08em), uppercase drawn by CSS so the DOM stays sentence case. Plain text and all-text `items` (joined with " · ")
  form one bounded `OverflowText`; complex JSX remains structured. Overflowing text loops continuously, pauses on
  hover/focus or offscreen/hidden, and exposes manual horizontal scrolling under reduced motion or keyboard focus;
  `tone` `muted` (stone, default), `ink` (ivory) or `hue` (`--lm-tone-2`, the card's tint); `size="sm"` stays 11 px; `as`
  `span | p | div`. Only for facts (a date, a range, a unit, a state, a legend label, a time, a tick), never above a
  heading, never a sentence. It is meant to replace `.lm-fact`, `Engraved` and the Faceplate caption, which still exist.
  `mono.css` is the one card, picture or layout stylesheet that declares uppercase.
- `StatusDot` (`StatusDot.tsx`, `status.css`): a 6 px dot and its word in mono caps, meant to replace the
  `.settings-status` chips and the breathing dots, which still exist. `tone` `live` (gold, "now") · `ok` · `caution` ·
  `danger` (the severity marks `--lm-ok-mark` …) · `neutral` (`--lm-ink-3`); `label` is the word (a status is a mark plus a
  word); `hideLabel` keeps it for assistive technology only. `pulse` breathes the dot (opacity 1 to 0.35, 1.1 s,
  alternating) and is for a real running process only (a recording, a fast); it does not breathe under reduced motion.
  Forced colours draw the dot in `CanvasText`.
- Tests: `cards.test.tsx`, `r071Css.test.ts`.

---

## 19. Pictures (r071)

Data drawn small, in the card's hue. Seven are new (`RadialTicks`, `DottedTrack`, `HighlightBars`, `GlowLine`,
`RangeScale`, `StackBar`, `WindowBar`) and five are restyled in place (`Hypnogram`, `StateStrip`, `Stat`, `ShareBar`,
`TwinTable`). Specimens: `/dev/components` › Ticks, tracks and bars · Lines, scales, stacks, windows · Restyled pictures.
The older `TickStrip`, `DotFill`, `OvernightTrace`, `LevelBar`, `ArcRuler` and `DayDisc` stay until the pages that draw
them move; each new picture's entry says what it replaces.

The contract of the seven new pictures (`src/components/viz/__tests__/contract.test.tsx`):
- Props: `hue` (sets `data-hue`, overriding the card's domain for this picture; without it a picture inside a card wears
  the card's), `animate` (default true), `quiet`, `twin`, `className`, and a name (`label`, `name` on `HighlightBars`) that
  is the first words of its sentence. `StackBar` and `WindowBar` take `hue` too, but nothing in them reads it: a stack's
  parts carry their own token colours and a window is ivory and stone.
- Exports, all from `@/components`: the component, its pure model (`radialModel`, `trackModel`, `barsModel`, `lineModel`,
  `scaleModel`, `stackModel`, `windowModel`), its `spoken…` sentence (`spokenRadial`, `spokenTrack`, `spokenBars`,
  `spokenLine`, `spokenRange`, `spokenStack`, `spokenWindow`) and its `…Twin(props): TwinData` (§19.9). The sentence and
  the twin read the raw values, never the smoothed or drawn ones.
- Role: one `role="img"` or `role="meter"` named by that sentence (a meter also has `aria-valuetext` and, for a number,
  `aria-valuemin`, `-max` and `-now`); everything drawn inside is `aria-hidden`.
- Quiet: no digit in the DOM or in aria, words only; the shape stays. Unknown is never zero: a missing value is nothing (no
  lit ticks, thumb, marker or bar) and the sentence says it is unknown.
- Reveal: `data-reveal="pending"` is on the root while `animate` is on and the picture is not yet 20 % in view (`useInView`)
  and absent otherwise, so wherever motion cannot run the markup is the final one. The pending rules in the picture's
  stylesheet hold the hidden values, the base rules hold the transitions, and removing the attribute is the animation. Only
  `transform`, `opacity`, `clip-path`, `stroke-dashoffset`, stroke and fill colours and `--lm-glow-k` move
  (`r071Css.test.ts`); under reduced motion the durations are 0.01 ms.
- Colour: tokens only. Focal marks (the line, its end dot, lit ticks, the thumb) are ivory (`--lmz-lit`); the hue lives in
  the card's glow and in secondary marks (today's bar, in-range ticks); the unlit remainder is `--lm-unlit`; text wears text
  tokens, never the series colour. `viz-base.css` maps `--lmz-hue`, `--lmz-ink-h` and `--lmz-dim` to the role variables of
  §16, and holds the shared read-out tooltip and inline twin.
- Styles: classes `lmz-…` in `viz/{radial,track,bars,glow,scale,stack,window}.css` with `viz-base.css`; `viz.css` keeps the
  old `lmv-` contract (flat, no uppercase, no glow, no gradient) for the restyled and retiring pictures.

### 19.1 Radial ticks `<RadialTicks>`
One reading in a bounded scale, or progress to a goal, as a ring of short radial ticks that light clockwise from 12
o'clock; the number sits in the middle. A screen carries one ring (gauges are space-hungry); the rest of the page uses the
linear pictures. Built from `DayDisc`'s lit-count model and `ArcRuler`'s tick drawing.
- Geometry: a 132-unit box scaled to `size`: `xs` 28 · `sm` 72 · `md` 120 · `lg` 160 px, or any px. 72 ticks (60 under
  120 px, 24 at `xs`; `count` is any integer from 6, to 144), a longer one every sixth and at the goal; 2 px strokes (1.5
  at `sm`, 1.25 at `xs`), round caps. Lit ticks are ivory, the rest `--lm-unlit`.
- Props: `label`, `value` (null is unknown), `goal` and `goalKind` (`target`, `floor` "at least", `limit`), `max` (the
  value that fills the ring once, default the goal, else 100; with it the goal is a longer ivory tick), `mark`, `band`
  (the likely range, a faint arc), `pending` (a dashed arc after the counted part), `fractional`, `lap2`, `parts`,
  `centre` (a `HeroNumber` and a `MonoMeta`), `state`, `quietFill`, `quietWord`, `spoken`, `unit`, `valueText`,
  `goalText`, `decimals`, `legend`.
- Past the goal the ring is full and, with `lap2` (default; never for a `limit`), a second lap lights an inner ring of
  short dashes in the domain's ink tint: neutral, never rose, told apart by position and not by colour.
- `parts` splits the ring into arcs with 8° gaps (the Day score: 24 ticks each for three). Each part has `id`, `label`,
  `value` (null is a missing part: a dashed outline arc, and `needs` says what it needs), `hue` and `confidence` (`low`
  draws its lit ticks dashed); a legend names them.
- States: `normal` · `learning` and `provisional` (dashed lit ticks) · `stale` (lit ticks at 60 %) · `zero` (an observed
  zero: the first tick hollow) · `unknown` and `none` (a bare ring, no number) · `loading` (bare, `aria-busy`).
- Quiet: no numeral anywhere; the fill is three steps (a third, two thirds, all) unless `quietFill="ratio"`.
- Motion: the ticks light in sequence, each 200 ms (`--lm-dur-base`) and 14 ms (`--lm-stagger-tick`) after the one before
  it; a change sweeps only the ticks between the old and new counts; the band, pending and missing arcs fade in after 600 ms.
- A11y: the plot is `role="meter"` named by `label`, with `aria-valuetext` the sentence ("Steps: 7 605 steps, goal 9 000
  steps"; "goal reached", "past the goal", "over the limit" said plainly, never praise or blame); the centre is `aria-hidden`.
- Tests: `viz/__tests__/radialTicks.test.tsx`.

### 19.2 Dotted track `<DottedTrack>`
Progress toward a goal, one number, as a row of dots with a thumb. It replaces `TickStrip` rows and `DotFill`. The name and
the value belong to the card's own row ("Protein … 32 / 150 G"); the track draws the dots, and `valueText` and `goalText` are
the words of its sentence.
- Geometry: one dot per 8 px (at least 8; `dots` or `ticks.count` sets an exact count, never closer than 4 px), 1.7 px
  radius, on a 16 px bar; the lit width is snapped to whole dots from the measured width (288 px in jsdom). The thumb is a
  14 px ivory disc (`--lm-thumb`) with a 3 px ring in the card colour, in the slot after the last lit dot (on the last dot
  when full). `ticks.majorEvery` makes every Nth dot larger (week marks on a plan track).
- Props: `label`, `value` (null is unknown), `goal` and `goalKind`, `valueText` (required: "32 g", or the words for an
  unknown, "Nothing logged yet") and `goalText` ("of 150 g"), `from` and `to` (the domain the track spans, a plan's days 0
  to 84), `unit`, `band` (the likely range, a faint capsule), `ghost` (the planned position, a hollow ring), `marks`
  (`{ at, label?, tone? }`: a tick with a mono word under it), `endLabels` ("WARM", "6500K"), `hue`, `litB` and `valueB`
  (a second tone drawn from the start: bought versus at home), `thumb`, `state`, `quiet`, `quietWord`.
- Lit dots are ivory, or the domain solid with `hue` (the thumb stays ivory). Past the goal the first lap stays ivory and a
  second lap lights again from the start in the ink tint (neutral, never rose) and the thumb passes the notch; a `limit` has
  no celebratory end (its words say "over the limit", and its notch is taller).
- States: `normal` · `provisional` (dotted rings, not discs) · `unknown` (no fill, no thumb) · `loading` (the bare dots,
  `aria-busy`).
- Motion: on first view the lit dots fill left to right (a `clip-path` over 900 ms, `--lm-dur-fill`, after 200 ms) and the
  thumb follows; later changes take 420 ms (`--lm-dur-needle`) and the thumb 280 ms on `--lm-ease-needle`; band, ghost
  and marks fade in after 700 ms.
- A11y: `role="meter"` named by `label`; `aria-valuetext` the sentence ("Protein: 32 g, at least 150 g").
- Tests: `viz/__tests__/dottedTrack.test.tsx`.

### 19.3 Highlight bars `<HighlightBars>`
A daily series as bars with the current day highlighted. It replaces `DayBars`, `StackedDays` and the Steps and Sleep period
views.
- Geometry: bars at most 20 px wide (8 in `variant="spark"`) with 4 px rounded tops and a 1.5 px base, 6 px apart (3 px
  above ten bars, 2 px in a spark), growing from the baseline; the bars area is `height` px (72; 28 for a spark). Other days
  wear the domain's ink tint at 40 %, the highlighted day the solid; a goal is a hairline across and never recolours a bar.
  A recorded zero is a 2 px stub, a day with no reading is no bar.
- Props: `name` (required) and `dates` (ISO dates), `values` (null is no bar), `goal`, `average` (a line with "avg" in the
  left margin, never over a bar), `highlight` (`'last'` default, an index, or `null` for every bar solid), `stacks` (a stack
  per bar, one `{ id, label, hue, values }` per app, 2 px gaps) with `limit`, `outline` (per bar: a partial or "at least"
  day as a dashed outline, a pattern and not colour alone), `format`, `spoken(i)`, `unit`, `max`, `height`, `showAxis`,
  `variant` (`full | spark`), `onScrub`, `quiet`, `twin`. The axis is weekday letters up to ten bars, else a day number
  every seventh bar and the last.
- Keyboard and pointer: one tab stop; left and right step through the days, Home and End jump, Escape clears; hover and
  touch scrub. The day is read in a polite live region and shown in a tooltip, the value first, then the date.
- Motion: the bars grow with `scaleY` over 700 ms (`--lm-dur-bars`), 60 ms apart (`--lm-stagger-bar`), so today's comes last.
- A11y: `role="img"`; the sentence is the summary; the bars are `aria-hidden`. Quiet: words against the goal, weekday
  names.
- Tests: `viz/__tests__/highlightBars.test.tsx`.

### 19.4 Glow line `<GlowLine>`
The smooth line of an intraday or daily series with a live end dot. It replaces `OvernightTrace`, the Ring's day line and the
sparks of Progress and the Ring. One picture for one data shape: a value that moves over time.
- The line is ivory, 2.25 px, round caps, drawn in real px from the measured width (smoothing is never distorted by a
  stretched viewBox); a null reading breaks it and a gap is never bridged. The hue lives in the card's glow and in the
  secondary marks (the band, the hatched spans), never in the line.
- Props: `label`, `unit`, `series` (points `{ t, v }`, or bare numbers; null breaks the line), `from` and `to`, `now` (the
  live instant: labels the end dot and makes it pulse), `future` (the dotted projection, 38 % ivory), `band` (the likely
  range: arrays aligned with the series and the projection, or `'iqr'`; a flat wash of the ink tint, never a gradient),
  `reference` (the plan line, a hairline), `spans` (`awake` hatched, `workout` a flat wash), `marks` (labelled points),
  `yTicks`, `xTicks` (`clock | hours | days | none`), `endDot` (`pulse | static | none`), `area` (a flat ivory wash, `true`
  is 8 %), `smoothing` (`fine` a day of readings, `night` calm and bucketed, `spark` as given), `variant` (`full | spark`),
  `height` (120; 56 for a spark), `decimals`, `gapMs`, `tz`, `state` (`normal | stale | none | loading`), `drawIn`, `quiet`,
  `twin`.
- The end dot is 10 px ivory with a 2 px ring and two thin halos that pulse twice (`PULSE_CYCLES` 2; 2400 and 2200 ms a
  pulse) and stop; `endDot="static"` is a finished series. A stale line is dimmed to 70 % and its dot hollow.
- Hover or focus reads a point (a crosshair, a tooltip, a polite live region); with focus on the plot (`full`, live), left
  and right walk the points, Home and End jump, Escape clears.
- Motion: the line wipes in over 1200 ms (`--lm-dur-draw`) after 120 ms; the band, area and plan line fade in after it
  (+100 ms), the projection last (+300 ms), the end dot, marks and "now" word as the line ends (−200 ms); then the halos pulse.
- A11y: the plot is `role="img"` named by the sentence ("Energy burned, 00:00 to 24:00: starts at 0, ends at 1 096 kcal at
  14:58, lowest 0, highest 1 096; expected to reach 2 595 kcal; 24 readings"); quiet: the direction in words, no digit.
- Tests: `viz/__tests__/glowLine.test.tsx`.

### 19.5 Range scale `<RangeScale>`
One reading on a bounded scale with the person's own usual range. It replaces `LevelTrack`, `RangeBands`, `LevelBar`,
`ArcRuler`'s straight form, the meter variant of `EquivalenceMeter` and the evidence parameter range.
- A printed scale: 41 ticks (17 for `size="inline"`, the 96 px glyph of a list row, which has no labels), the ticks inside
  `usual` lit in the domain hue, a 3 px ivory marker at the value. `ticks="bands"` makes each band edge a long tick and names
  each band under the scale when its word fits (else the current band is named once).
- Props: `label`, `value` (null: no marker), `min`, `max`, `bands` (ascending `{ from, word, severity }`, severity `info | ok
  | caution | danger`: always a mark and a word, never the colour of the marker), `usual`, `unit`, `spokenUnit`, `decimals`,
  `ticks`, `endLabels` (hidden when quiet and they carry a digit), `size`, `state`, `ageText`, `quiet`, `twin`.
- States: `normal`; `stale` keeps the last reading with its age and a gold dot, the marker hollow; `calibrating` draws
  dashed ticks and says "Building baseline"; `none` has no marker.
- Motion: the usual ticks light from the low end (200 ms each, 14 ms apart, after 150 ms), then the marker drops in with the
  one damped overshoot (420 ms on `--lm-ease-needle`, after 400 ms).
- A11y: `role="meter"` named by `label`, `aria-valuetext` the sentence ("HRV 48 milliseconds, balanced, your usual range 38 to
  62"); quiet: the words only ("HRV, balanced, within your usual range").
- Tests: `viz/__tests__/rangeScale.test.tsx`.

### 19.6 Stack bar `<StackBar>`
One whole in parts, as one bar (the night's stages, heart-rate zones, energy kinds, storage, a driver bar). It replaces the
`ShareBar` rows used for a single whole.
- A 10 px bar (6 px at `size="sm"`), 2 px card-colour gaps, each part as wide as its share and never narrower than 6 px;
  under it a legend that names every part with its value. The legend follows the width of its container, not the screen's:
  one column, two from 17 rem and four (value over name) from 34 rem. Parts that do not add up leave the rest as the bare unlit
  track: a partial night is drawn partial.
- Props: `label`, `rows` (`ShareBarRow`: `id`, `label`, `valueText`, `share` 0..1, `hue` a token colour such as
  `var(--lm-intensity-resting)`, `unknown`), `total` (said in the sentence and the table), `size`, `legend` (`below | inline
  | none`), `quiet` (names and shares in words: none, a small part, some, a large part, most), `twin`.
- Motion: the segments grow from the left with `scaleX` over 700 ms, 60 ms apart; the gaps stay.
- A11y: `role="img"`; the sentence names every part, a zero included ("Where it went so far: resting 742, light 238 …;
  total 1 096 kcal").
- Tests: `viz/__tests__/stackBar.test.tsx`.

### 19.7 Window bar `<WindowBar>`
When something happened against when it usually does: the Ring's Timing card and the Today sleep window.
- One axis between two instants (`axis`, in ms, for example 20:00 to 12:00 the next day), the person's `usual` window as a
  hairline-outlined band, the `actual` window as a solid ivory bar on top of it, `marks` (`{ t, label }`: fell asleep, woke) as
  ticks with their words (two rows at most; a word that would overprint another is left to its tick and the sentence), round
  hours as mono labels. `tz` sets the hours. A window past the axis is clipped to it and the sentence says so.
- Quiet: no clock and no digit; the bars stay; the sentence says "later than usual" in words (a half hour either way is
  "usual").
- Motion: the bars wipe in over 600 ms (`--lm-dur-draw` / 2) after 120 ms; the axis never moves.
- A11y: `role="img"`; "Sleep timing: 23:12 to 07:08, usual 23:00 to 07:00".
- Tests: `viz/__tests__/windowBar.test.tsx`.

### 19.8 The restyled pictures
`Hypnogram`, `StateStrip`, `Stat`, `ShareBar` and `TwinTable` keep their props, their sentences and their old class names
(`viz.css`, the `lmv-` contract: flat, tokens, no uppercase of its own: the mono caps come from the `lm-mono` class). The new
look is additive:
- `Hypnogram`: blocks 10 to 12 px, mono-caps row words; `legend` (the stage totals under the chart, from the raw totals; 2 x 2
  on a phone, four across from 1024), `hatch` (a 45° texture per stage: the `chartPatterns` setting, so a stage is never
  told by colour alone), `sessions` (`{ from, to, segments }[]`: a night recorded in parts on one shared axis; the gap
  between parts is the hatched "No stage" band; `from`, `to` and `segments` are optional then), `animate` (the blocks grow
  from their left edge in time order over 700 ms).
- `StateStrip`: `hue` (the ordinal ramp as four lightness steps of a domain; the default ramp is unchanged), `stateHues` (a
  domain per category state), `labels` (the state word inside every segment wide enough, on a taller 24 px track; the legend
  keeps only the states no word fits in, so nothing is colour alone), `animate` (a wipe, and the now tick pulses twice);
  the legend is mono caps.
- `Stat`: a mono-caps label (with a 6 px dot in the domain hue when `hue` is given), the value 22 px at 400 with its unit
  small and muted, the chip one fact line under it, no rules between cells (`StatGroup`).
- `ShareBar`: a 6 px dot, the name (14/500), the value (15/500, tabular) and the share in mono caps over a pill track (6 px,
  4 px at `sm`); `animate` (the fills grow from the left, transform only, 700 ms, 60 ms apart).
- `TwinTable`: its markup is frozen (it equals `charts/living`'s, pinned by `contract.test.tsx`); r071 restyles it through
  selectors. `TwinKey`, the "Table" key, is a text key with the table icon in both states ("Table", "Hide table").
- Tests: `viz/__tests__/restyle.test.tsx`, `contract.test.tsx`.

### 19.9 The Table twin `ChartTwin`, `InlineTwin`, `TwinData`
Every chart keeps a twin: the rows of the table that say what the picture says. Each new picture exports `<picture>Twin(props):
TwinData` (`title`, `caption` (the sentence), `head`, `rows`, `fileName`, optional `rowNoun`). A page puts `<ChartTwin
data={…} />` into its card's (i) panel (`InfoSpec.twin`, which the card's `T` key opens), or sets the picture's `twin` prop,
which draws an `InlineTwin`: a "Table" key and the table under the picture (not in quiet mode). `ChartTwin` is the
`TwinTable` markup: a row count ("N days", or the `rowNoun`), a "Download CSV" key (`twinCsv`, `twinFileName`) and a
keyboard-focusable scroll region with a sticky head.

---

## 20. Layout: Rail, CardGrid, CardLibrary (r071)

Specimens: `/dev/components` › Rail, card grid, card library.

### 20.1 Rail `<Rail>`, `<RailRow>`, `<RailNode>`
The day rail that Today's plan, Food's meals and Train's exercises share (`Rail.tsx`, `rail.css`): a time, a node on a
hairline spine, what the stop is with its targets, keys. It is extracted from the `.lv-item` rail in
`src/features/living/living.css`, which stays until the last page has moved.
- `Rail`: `children`, `timeAt` (`start`, default: the time before the node; `end`: the list-card form), `label`. A `ul` with
  `role="list"`. A rail where no row has a time drops the time column, so its nodes line up with the card's text edge.
- `RailRow`: `time` (mono, tabular), `node` (a `RailNode`), `title` (16/500), `meta` (the facts under it in mono caps: a node,
  or an array of facts joined with " · "), `trailing` (keys at the row's end; they sit above the stretched title), `onOpen`
  (makes the title a button whose target is the whole row), `highlight` (a gold-soft wash: the row a jump landed on), `id`.
  At least 56 px high, `--lm-radius-field` corners, a `--lm-face-hover` wash on hover for an openable row.
- `RailNode`: `status`, `label` (required: "Snack: log as planned"), `onPress`, `size`, `segments`, `lit`, `glyph`, `hue`,
  `number`. A 28 px ring (`size={44}` for 44) inside a 44 px press target. With `onPress` it is a `button` (the tick);
  without, a `role="img"` status mark with the same name.
  - `status`: `empty` (a ring) · `done` (a gold disc whose check draws itself: the stroke 220 ms after 60 ms, the fill
    140 ms) · `partial` (the left half gold) · `skipped` (struck) · `assumed` (a dashed gold ring: filled in for you).
  - `segments` (2 to 12) draws one ring segment per set with a gap between them, `lit` of them gold (all when `done`);
    `segmentArcs(n, lit)` is the pure layout. `glyph` (an icon tinted by `hue`) or `number` (a short mono figure) sits inside
    the ring and is hidden once the stop is done.
- Gold marks done (the action colour); a data hue only ever tints a glyph. A done title is struck and in stone, never paler
  (pale stone must not sit on a glow). The spine is two 1 px `--lm-line-strong` hairlines per row, from the row's edge to the
  ring, so it runs unbroken whatever a row's height, with none above the first stop or below the last.
- Motion: the fill and the check run on state change only, so a rail that mounts done is simply done; reduced motion zeroes
  them (`base.css`).
- Tests: `src/components/__tests__/rail.test.tsx`.

### 20.2 Card grid `<CardGrid>`, `packRows` and `packHeights`
Today's cards in the person's own order, as a CSS grid (`CardGrid.tsx`, `cardgrid.css`). Today passes `equalRows` so adjacent
card surfaces share the tallest natural content height in their row (r074 owner instruction). Empty-rendering choices
reserve no slot and are excluded from gesture targets, while saved choices remain. Other callers may omit `equalRows`
to use measured `packHeights` placement beneath shorter neighbours. Full-width cards remain row barriers.
- Props: `items` (`{ id, size, node, edit? }[]`; `size` is `hero | wide | card | tile | slim`), `cols` (forces `2` or `12`),
  `label` (a named group), `equalRows`, `editor` (`onResize`, `onReorder`), `keyboardEditing`, `className`.
- Columns follow the card area's width: 2 below 900px, 12 from it. Hero, wide and slim fill the row; card is 2 of 2 or
  6 of 12; tile is 1 of 2 or 3 of 12. Gap is `--lm-card-gap` (12, 16 from 1024 viewport width).
- CardGrid calls `packRows(..., false)` to preserve explicit widths; a lone Quarter remains Quarter. Legacy callers may
  use the helper's default widening. Cells carry `data-id`, `data-flip`, `data-size` and `data-span`.
- Edit metadata supplies the label and supported sizes. Pointer interaction is always available when `editor` is passed:
  drag the card surface after a movement threshold, or hold then drag on touch. A small diagonal corner mark, with a 44px
  hit target, resizes horizontally through distinct widths that fit this viewport. At the right edge, outward travel is
  scaled so the next width is reachable. Normal touch swipes scroll before the hold, even from the corner. Interactive
  controls, chart scrubbing and ordinary card clicks keep their own behavior; active gestures suppress their synthetic
  click only. There are no visible Move/Width strips or menu prerequisite.
- `keyboardEditing` makes cards focus targets: Alt+Arrows/Home/End reorder; corner slider keys resize, using current-viewport
  width names. Escape cancels a gesture, then exits keyboard entry. Changes commit through synced Today settings; hidden
  selections retain their saved slots. The hero has no handles. Gesture timers, pointer capture and scroll gating clean
  up on cancellation, blur, unmount and lost capture. Width/order survive reload.
- Motion (the shared hooks of §17): a card that appears after mount rises 10 px and fades in (`enter`, 420 ms); an add, remove,
  reorder or resize slides every card to its new place (`useFlip`, 280 ms on the damped curve). A change of column count
  alone is a reflow, not a move. Under reduced motion an added card cross-fades in 100 ms
  (`fadeCue`).
- Tests: `src/components/__tests__/cardGrid.test.tsx`.

### 20.3 Card library `<CardLibrary>` and `MonitorSheet`
The panel that adds and removes cards (`CardLibrary.tsx`, `library.css`): `MonitorSheet` generalised. Today passes
`organize={false}` because moving and resizing happen directly on its grid; signal lists retain their own panel ordering.
Every change applies at once, so its header is title · ✕ (no Cancel, no verb). A bottom sheet on phones (60 and 92 %
detents, opening at 60), a 392px overlay side panel from 1024px. Opening it never narrows the page.
- Props: `open`, `onOpenChange`, `title`, `items` (`LibraryItem[]`), `selected` (`{ id, size? }[]`, in order, the hero left
  out), `onChange`, `onReset`, `max` (the most that can be shown; locked rows count), `quiet`, `copy` (the words,
  `DEFAULT_LIBRARY_COPY`), `defaultSelected` (what Reset puts back when it is not the items flagged `default`), `sizeLabels`,
  `renderRowAction` (a key at the end of every row: "Add as widget"), `startAt` (`shown | add`: where the panel opens), `variant`.
- `LibraryItem`: `id`, `label`, `hue` (a `Domain`: the row's hue dot and icon tint), `group` (the Add list's group name) and
  optionally `icon`, `description` (one line, eight words at most), `preview` (a decorative thumbnail in the Add list), `sizes`
  (more than one draws a size toggle; the first is the default), `default`, `locked` (always shown and always first: a lock
  instead of a grip, no remove key, never stored), `unavailable` (why the card cannot be had now: it is listed greyed with
  the reason and cannot be added; one the person already chose stays in their list, greyed), `valueText` (the current
  value, hidden when quiet), `calibrating` ("Calibrating" instead of a value).
- Rows: a 48 px grip, a hue dot and icon, the label with its description in stone, a size toggle, a 48 px remove key (a
  minus in a circle; a plus to add). The Add list is grouped by domain (a mono group name with its hue dot, so a hue is never
  the only word) with a search field above ten cards (`SEARCH_ABOVE`). The foot reads "Showing 6 of 29" and Reset to
  default (disabled, with its reason, when already default). A removed item keeps its place and size for when it is added again.
- Keyboard: Space picks a row up, the arrows (Home, End) move it, Space drops, Escape cancels; a polite live region says
  where it went and focus stays on the grip. Pointer: press the grip and drag (pointer capture, edge auto-scroll). Rows slide
  to their new places in 160 ms (`useFlip`; instant where motion cannot run). The grip is named "Move {label}, position N of M".
- `variant="monitor"` keeps the markup and class names `MonitorSheet` always had (`lmv-mon*`); `MonitorSheet`
  (`viz/MonitorSheet.tsx`) is now a thin wrapper over it, for the Ring's Signals card, and goes when the Ring migrates. Its
  pure helpers (`moveId`, `removeId`, `addId`, `monitorCapacity`, `movedText`) live in `CardLibrary.tsx`; `sizeOf`,
  `defaultSelection`, `sameSelection`, `groupItems` and `filterItems` are exported too.
- Tests: `src/components/__tests__/cardLibrary.test.tsx`.

---

## 21. Intake, settings keys and the gallery (r071)

### 21.1 Intake model `intakeModel`
What was eaten against the day's targets, as ONE model (`src/features/living/model/intake.ts`, pure: no React, no store
reads). Today's "Eaten so far", Food's Targets, the planless Today and the widgets all read it, so the number, the likely
range, the kind and what is not known cannot disagree between screens. It wraps `intakeFigures`
(`src/features/living/today/model.ts`) for energy and protein and applies the same rules to carbs, fat and fibre.
- `intakeModel(view, rx, { energyUnit })` returns `channels` (energy, protein, carbs, fat, fibre, in that order, also named
  `energy`, `protein`, …), `logged` (at least one meal), `status` (`Not logged | Partial | Complete | No intake`), `left`
  (`{ amount, over, unit }`: what is left of the energy target, or how far past it; null without a figure or a target) and
  `hasTargets` (a zero-energy fast day has none).
- An `IntakeChannel`: `id`, `label`, `value` (null when nothing is known: never 0 for "unknown"), `lo` and `hi` (the likely
  range, 80 %, only for an estimate), `target`, `kind` (`target`, or `floor` for protein: more is fine, neither is good or
  bad), `state` (`value` · `atLeast` a lower bound, never drawn as exact · `partial` the figure is known but the macro lags
  energy's coverage · `unknown`), `why` (`nothingLogged | notInFood`), `unit` (the person's energy unit, or `g`), `ratio`
  (value / target, not capped: past 1 is a second lap on a ring, a thumb past the notch on a track), `over` (information, never
  a fault).
- Tests: `src/features/living/model/__tests__/intake.test.ts`.

### 21.2 `IntakeRing` and `IntakeTrack`
`src/features/living/components/IntakeViz.tsx`, `intakeViz.css`: the model drawn with the foundation pictures. A card with one
or two figures (Today's "Eaten so far") draws rings; a card with four or more (Food's Targets) draws the energy ring and one
track per other target.
- `IntakeRing` (`channel`, `size`, `quiet`, `quietWord`, `animate`, `hue`, `centre`, `className`): a `RadialTicks` of one
  channel (default `md` 120 px; no centre number under 100 px), the target a longer ivory tick, the likely range a faint arc,
  a second lap past the target. The centre is a `HeroNumber` (`num` for three digits at 120 px or more, else `time`) with the
  unit under it, a "At least" `MonoMeta` for a lower bound, or the reason for an unknown; `centre="none"` or a node.
- `IntakeTrack` (`channel`, `quiet`, `animate`, `className`): the name left ("At least" beside a floor, "Partial" for a
  macro that lags), "32 / 150 g" right in mono caps, a `DottedTrack` below; the lit dots wear the macro colour
  (`--lm-macro-protein`, `-carbs`, `-fat`, `-fibre`) and the thumb stays ivory. Quiet mode hides it (a macro in grams is a number).
- A lower bound is said as one and drawn dashed (`provisional`); an unknown draws no figure and no thumb and says why; over the
  goal is never rose. The sentence (`spokenIntake`): "Energy: eaten about 750 of 2 050 kcal (range 640–860), 1 300 kcal left".
- Tests: `src/features/living/components/__tests__/intakeViz.test.tsx`. The gallery has no sheet of its own for them; its
  "DottedTrack · Eaten so far" specimen draws the same tracks directly.

### 21.3 Settings keys `todayCards` and `widgetWeight`
Two r071 keys in `src/state/internal/settingsModel.ts`, written through `settings.update` (`src/commands/defs/settings.ts`).
There is no glow setting: `--lm-glow-k` has no key (SPEC Q6).
- `todayCards`: `string[] | null`, default `null`, synced (`SYNCED_SETTING_KEYS`). The cards the person chose for Today, in
  order, each `"id"` or `"id:size"` (`"steps:card"`; lower-case words joined by hyphens; at most `TODAY_CARDS_MAX` 40 entries
  of at most `TODAY_CARD_ENTRY_MAX` 40 characters). `null` means the default set, and later changes to the default reach the
  person; a list is the person's own and is the whole resolved list (the hero is implicit and never stored), so a card a
  later release adds to the default never appears by itself. Availability (a ring, a plan, quiet mode) is decided when Today
  draws, never when this is written: a card for a missing ring stays stored. It is never an AI's choice (not in
  `AI_SETTING_KEYS`). `parseCardEntry`, `formatCardEntry` and `sanitizeTodayCards` (drops entries that are not `id` or
  `id:size`, keeps the first of a card listed twice and the first 40, makes a non-array `null`; `[]` stays empty) guard it, so
  a corrupt synced document can never break Today; import validation (`isSettingsState`) rejects a bad list. `CardLibrary`'s
  `selected` is the same `{ id, size? }` list.
- `widgetWeight`: `boolean`, default `false`, this device only (`DEVICE_SETTING_KEYS`; not an AI's either). It shows the
  person's weight on the Android home-screen widgets: a weight is not something to leave on a screen anyone can see, so a
  widget snapshot has none unless it is on.
- Tests: `src/state/internal/settingsModel.test.ts`.

### 21.4 The gallery `/dev/components`
The living gallery (`src/app/dev/ComponentGalleryPage.tsx`; the route is lazy and in no navigation). The r071 sheets are
`src/app/dev/specimens/*.tsx`: `index.tsx` exports `R071Sheets` and `R071_JUMP`, `kit.tsx` is the kit (`GallerySection`,
`Spec`, `Row`), `specimens.css` the layout. A card never nests in a card, so these sheets are plain sections on the backdrop,
each specimen a name, a note and the thing at the size it has on Today. The numbers are synthetic.

| Jump-list entry (id) | Sheet | Specimens |
|---|---|---|
| tokens (`g-tokens`), material (`g-material`) | Tokens, Material | the token swatches, among them the wheel of domain hues; `Faceplate` cards in every domain, a banner (no glow), the live mark and the motion demo |
| keys … icons (`g-keys` … `g-icons`) | the 0A primitives | every primitive, variant and state |
| cards (`g-cards`) | Cards | `GradientCard` per domain, hero, card and slim, open targets and glow positions, the (i) panel (open it on load with `?info`), `HeroNumber` in every size, quiet mode, `MonoMeta`, state words and `StatusDot`, the wheel |
| rings, tracks, bars (`g-ticks`) | Ticks, tracks and bars | `RadialTicks` (tiles, sizes, states, past the goal and a limit, quiet, parts, every hue), `DottedTrack` (Eaten so far, states, a plan, a range and a second tone), `HighlightBars` (tiles, the wide card, quiet, no highlight, empty) |
| lines, scales (`g-lines`) | Lines, scales, stacks, windows | `GlowLine` (hero card, quiet, overnight, spark tiles, domain hues), `RangeScale` (tiles, bands, end labels and inline), `StackBar`, `WindowBar` |
| restyled (`g-restyled`) | Restyled pictures | `Hypnogram` (also gaps, parts and quiet), `StateStrip` (ramps by hue, labelled), `Stat`, `ShareBar`, `TwinTable` and its key |
| grid, library (`g-layout2`) | Rail, card grid, card library | every `Rail` status and form, `packRows` worked, `CardGrid` on phone and desktop columns, `CardLibrary` |
