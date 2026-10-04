# Vitals — Chart Specification

> Method: the `dataviz` skill (form first → colour by job → validate → mark specs → hover layer →
> accessibility → look at it). Tokens: `tokens.css §5–9`. Components: `COMPONENTS.md §7`.
> Reference rendering: `prototype/index.html#results`.

---

## 1. What the charts must answer

| Reader question | Form | Where |
|---|---|---|
| "What happens to my fat, muscle and weight?" | readout strip (start → end + range) + lanes | Results top |
| "When does X happen, and what else is going on then?" | **channel stack**: lanes sharing one time axis, one crosshair | Results main |
| "Do these move together / which reacts first?" | **overlay**: ≤ 6 metrics indexed to baseline on one axis | Results, view = overlay |
| "Show me this one properly." | **focus lane** (300 px, full annotations) | Results, view = focus |
| "Why did the scale drop 2 kg in week 1?" | weight-change decomposition (diverging stacked bars) | Results, under the stack / Explain |
| "Where does my energy go?" | TDEE stacked area | Results lane type + Explain |
| "What does one day look like hour by hour?" | 24 h day view | Results zoomed ≤ 2 days, day editor |
| "Which plan is better for my goals?" | comparison small multiples, A/B/C lines | Planner results |

**Non-negotiables** (dataviz): no dual axes, ever; ≤ 8 hues; colour follows the entity; legend
for ≥ 2 series; tooltips never gate values (table view twin); solid hairline grids; thin marks.

---

## 2. The mixed-units problem — decision

~40 metrics span kg, g, mmol/L, mg/dL, mmHg, kcal, %, ml/kg/min and unitless indices. Three
options were considered:

| Approach | Verdict |
|---|---|
| Up to N y-axes on one plot | **Rejected.** Axis alignment is arbitrary; invents correlations; unreadable past 2. |
| Everything as % change from baseline | **Secondary view only.** Great for timing and direction; destroys absolute meaning (a 5 % LDL rise and a 5 % fat loss look equal) and breaks for values near zero (ketones 0.1 → 1.5 mM = +1 400 %). |
| **Small multiples on a shared time axis (lanes)** | **Default.** Each metric keeps its native unit and its own y-scale; the shared x-axis and single crosshair carry the "at the same time" comparison. This is how meteograms and polysomnograms solve the same problem. |

So: **Lanes** (default) · **Overlay** (indexed, ≤ 6) · **Focus** (one lane large). The view is a
KeyBank in the chart toolbar; the selection, zoom and crosshair persist across views.

### 2.1 Overlay transforms (per metric, in the catalogue)
- `pct` — ratio-scale quantities with a meaningful zero (masses, kcal, hormones, lipids, BP, VO2):
  `100 × (v − v0) / v0`.
- `pts` — bounded indices 0–100 (hunger, autophagy, mTOR/AMPK, mood, sleep quality, strength
  index): `v − v0` in index points, plotted on the same axis as "% / pts" (axis title:
  "change from start (% or index points)"). The legend row shows the unit kind.
- `log2` — quantities that span orders of magnitude (blood ketones, IGF-1 optional):
  `log2(v / v0)` shown as "×2, ×4" ticks on a **separate overlay** is not allowed (one axis); so
  these metrics are **excluded from overlay** and the picker says "Ketones vary 10-fold; view in
  Lanes". (Cleaner than a misleading %.)
- `none` — states (ketosis state, fasting state) are never overlaid; they live in the event
  ribbon.

---

## 3. Colour

### 3.1 Jobs
| Job | Palette | Rule |
|---|---|---|
| Identity of a metric | **category hue** (8) | fixed per category, everywhere |
| Identity inside a category (overlay) | hue + **dash** + **marker** | 1st solid ● · 2nd `7 4` ■ · 3rd `1.5 3.5` ▲; max 3 per category in overlay |
| Macro inputs | macro palette (5), fixed stack order | protein, net carbs, fibre, fat, alcohol |
| Plan identity | plan A/B/C (cobalt, copper, teal) | only in planner comparison views — **v0.2: rungs** Hard `--lm-rung-hard` (cobalt) · Medium `--lm-rung-medium` (copper) · Easy `--lm-rung-easy` (teal), aliases of the validated A/B/C hues; **Ideal** `--lm-rung-ideal` = ink, dashed `4 3`, hollow markers (achromatic on purpose: a reference, not a choice) |
| Adherence | ink states (solid, partial, hollow, dashed) | never green/red; see COMPONENTS §13.9 |
| Energy balance | diverging tints (deficit ↔ surplus) | phase bands, day cells, plan timelines |
| Ketosis depth | ordinal ramp in the fuel hue | forming · nutritional · deep |
| Severity | status tokens + icon + label | warnings, event flags; never a series |
| Uncertainty | the series hue at `--lm-chart-band-alpha` | 80 % likely range |

### 3.2 Validation record (run `dataviz/scripts/validate_palette.js`)
Surfaces: light `--lm-face #fbfcfd`, dark `#1d1f22`.
- Category, adjacent: light CVD worst ΔE 14.2 (teal↔copper), normal 23.8; dark CVD 11.4
  (violet↔teal), normal 17.3 → PASS. Contrast relief: recovery `#58b0db` 2.36:1 and cardio
  `#dda734` 2.12:1 on light face → lanes always carry text labels and value readouts (they do),
  overlay lines always carry direct end labels (mandatory, §5.3).
- All-pairs (overlay can put any two side by side): 8 hues cannot pass all-pairs (true of any 8);
  hence the overlay cap of 6, the dash/marker secondary encoding, and mandatory direct labels.
- Macros, adjacent in stack order: light CVD 17.3 / normal 23.8; dark 11.5 / 16.0 → PASS.
  Relief: carbs 2.12:1 and fat 2.76:1 on light → inputs lane has legend + tooltip + table.
- Plans A/B/C, all-pairs: CVD 13.9, normal 15.4 in both modes → PASS.
- Ketosis ramp `--ordinal`: monotone, ΔL ≥ .06, light end 2.28:1 (light) / 2.34:1 (dark) → PASS.
- Any change to a hex → re-run the validator for both modes and update this table.

### 3.3 Composite identity (series 9–24)
The brief asks for ≥ 12 simultaneous series identities. We never generate hues; identities 9–24
are composites: category hue × dash pattern × marker shape. In practice the overlay cap (6) means
composites only appear when a user overlays 2–3 metrics from one category (e.g. fat mass, lean
mass, scale weight: cobalt solid ●, cobalt dash ■, cobalt dot ▲).

### 3.4 Texture (opt-in)
Settings → Appearance → "Patterns in charts", and automatically in `forced-colors`/print:
range bands get 45° hatch (1 px lines, 5 px pitch, series hue), stacked macro segments get
protein none · carbs 45° · fibre 135° · fat 45° dense · alcohol 135° dense. Lines keep dash
patterns. Never on by default.

---

## 4. Main chart — the channel stack

### 4.1 Anatomy (top → bottom)
```
┌ toolbar (sticky, 44 px) ────────────────────────────────────────────────────────────────┐
│ [lanes|overlay|focus]  [12 wk|4 wk|1 wk|day]  ◂ ▸   Metrics (9)   2 cautions   ⤓  ▦ table │
├ time ruler + phase ribbon (28 px) ──────────────────────────────────────────────────────┤
│ wk1      wk2      wk3      wk4 │ wk5 …          block names: "fat-loss base" "diet break"  │
├ event ribbon (20 px) ────────────────────────────────────────────────────────────────────┤
│        ▁▁▂▂▃▃▃▃▃▃▃▃▂▁      ketosis state band (keto ramp) · event glyphs · safety flags   │
├ inputs lane (72 px) ─────────────────────────────────────────────────────────────────────┤
│ intake ▮▮▮▮▮▮▮▯▮▮▮▮▮▮  stacked macro kcal/day, 2 px gaps; maintenance line ──────────────  │
│        ·  ·  ·  ·  ·    training ticks (performance hue) under the bars                  │
├ ── category group header: ● body composition (12 engraved) ─────────────────────────────┤
├ lane: fat mass  kg  [A●●●●]   19.8 │ ~~~~~~line + band~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~   │
├ lane: lean mass kg  [B●●●○]   61.0 │ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~   │
├ ── ● fuel & ketosis ─────────────────────────────────────────────────────────────────────┤
├ lane: glycogen  g   [B●●●○]  310   │ …                                                   │
├ lane: blood ketones mmol/L [B] 1.4 │ … (threshold line 0.5 "nutritional ketosis")        │
│ …                                                                                        │
├ x-axis (sticky bottom, 28 px): dates, condensed 11 px ───────────────────────────────────┤
└ disclaimer line (12 px ink-2) ───────────────────────────────────────────────────────────┘
```
Lane label gutter: 168 px (desktop), plots start at the same x in every lane. Right padding
8 px; overlay adds a 176 px end-label column (96 px on mobile).

### 4.2 Lane types
| Type | Used for | Marks |
|---|---|---|
| `line` | most continuous metrics | 2 px line in category hue, round joins; likely-range band (80 %) as a filled area at band alpha, no band edge strokes; start value dot (8 px, surface ring) |
| `line+threshold` | ketones (0.5, 3.0 mM), glucose, BP (130/80), LDL targets | as `line` + solid 1 px `--lm-ink-3` threshold lines with right-aligned 11 px labels; threshold zones are **not** tinted |
| `index` | 0–100 indices (hunger, autophagy, mTOR, AMPK, mood, sleep quality, training capacity) | fixed y 0–100 with ticks 0/50/100, a faint midline; line + band |
| `state` | ketosis state, fasting state, "in MPS window" | lives in the event ribbon as an ordinal band; can be promoted to a 24 px lane in Focus |
| `stacked-area` | TDEE components (BMR, TEF, NEAT, exercise) | stacked areas in 4 steps of the energy hue (sequential ramp, legend required) with 2 px surface gaps as 1 px separating lines of surface colour; total as a 2 px line; "without adaptation" as a 1 px `--lm-ink-3` line with label |
| `bars` | inputs (macro kcal), steps/day, training volume | columns ≤ 24 px wide, 4 px rounded top, square base, 2 px gaps; switch to a stepped area when bar width < 3 px |
| `range-only` | metrics with no reliable point estimate (e.g. grade D curves where only direction is known) | band only, with a centre hairline 1 px dashed-free at 50 % opacity, and the label "direction only" |

### 4.3 Y-scales
- Each lane's domain **hugs the data**: `[min(p10), max(p90)]` over the **visible time range**
  plus 10 % padding (lanes with thresholds start at 0 and extend to 1.2 × the highest threshold).
  Ticks are then the "nice" values (1, 2, 2.5, 5 × 10ⁿ) that fall *inside* the domain — 2 or 3 of
  them. Do not round the domain outward to nice numbers: that flattens a 4 kg fat loss into a
  near-flat line on a 15–25 kg axis.
- Tick labels live in a **32 px left padding column inside the plot** (26 px under 500 px), 11 px
  condensed `--lm-ink-3`, right-aligned 5 px from the data area. Data never starts before that
  column, so labels never sit on marks. Each tick gets a 1 px `--lm-chart-grid` line.
- Indices use fixed 0–100. Percent metrics (body-fat %) use nice bounds, not 0–100.
- **"From zero" toggle** per lane (lane menu): forces zero baseline for magnitude honesty (masses);
  default off because changes of 2–5 % over months must be readable; the gutter always shows the
  % change from start in text so the scale can't mislead ("−17.8 %").
- Y-scale changes on zoom animate over `--lm-dur-slow` (lines morph; no jump).

### 4.4 Inputs lane
- Stacked columns per day: kcal from protein, net carbs, fat, alcohol (fibre shown at ~2 kcal/g
  only when "detail" is on, else fibre is omitted from the energy stack and shown in the tooltip).
- Toggle in the lane menu: `kcal | grams | % energy`. In grams the stack is not meaningful as a
  total, so grams mode shows **grouped** thin columns (protein, carbs, fat side by side) instead.
- Maintenance reference: the projected TDEE as a 1.5 px `--lm-ink` step line over the bars,
  labelled "maintenance" at its right end; its value moves with metabolic adaptation, which is the
  point — the user sees the target move.
- Exercise ticks under the bars: resistance ■ (performance hue), cardio ▲, walking volume as
  bar-height micro-columns (max 6 px).
- At ≤ 2 days zoom, the inputs lane switches to meals: columns at meal times with width ∝ duration
  (15 min min), stacked macros per meal.

### 4.5 Event ribbon
- Ketosis state band: none (transparent) → forming (`--lm-keto-1`) → nutritional (`-2`) → deep
  (`-3`), drawn as a 10 px band; transitions are gradients over the transition hours (the
  "forming/fading" states of the brief).
- Event glyphs (12 px on a 2 px surface ring) at exact times: ketosis entered/exited · glycogen
  < 30 % · refeed · fast start/end · diet break · deload · safety flag (caution/danger icons,
  which also add a vertical 1 px severity-mark line through all lanes at 30 % opacity).
- Labels show on hover/focus, and inline when zoom ≤ 4 weeks and no collision (greedy placement;
  drop lower-priority labels, never overlap).

### 4.6 Uncertainty
- Band = 80 % likely range (10th–90th percentile of the engine's inter-individual distribution).
- Band widens over time where the engine says so; the widening is the message — never smooth it.
- When a metric's band exceeds ±25 % of its value, the lane label gets a "wide range" note and
  the Explain drawer states the main source of uncertainty.
- Readouts pair every value with its range: "19.8 kg (likely 18.6–21.0)".

### 4.7 Dimensions
| Viewport | Lane label | Lane height (compact / default / focus) | X-axis ticks |
|---|---|---|---|
| 375 | above plot, 20 px row | 26 (strip) / 64 / 220 | every 3 weeks, "wk 4" condensed |
| 768 | 150 px gutter | 26 / 72 / 260 | weekly |
| 1024–1440 | 168 px gutter | 26 / 72 / 280 | weekly with dates ("wk 3 · 19 Oct"); days when ≤ 1 wk |

72 px is the default lane: tall enough for a 2 px line, its band and three ticks, short enough
that the first viewport at 1440 × 900 shows the inputs lane plus five channels. The inputs lane
is 72 px (60 px on mobile).

Lanes are virtualised: only lanes within the viewport ± 1 screen render.

---

## 5. Interaction model

### 5.1 Crosshair (one for all lanes)
- **Pointer**: hover anywhere in any plot → a 1 px `--lm-chart-crosshair` vertical line through all
  lanes, snapped to the nearest sample at the current resolution (day, 6 h or hour). Each lane
  shows a 8 px dot (series hue, 2 px surface ring) at the value and its value in the label gutter.
  The crosshair readout (COMPONENTS §7) floats beside it.
- **Touch**: one-finger **horizontal** drag on a plot = scrub (after 8 px of horizontal intent;
  vertical intent scrolls the page). The readout docks at the top of the chart. Lift = crosshair
  stays (pinned) until tap elsewhere. Tap a lane = pin crosshair there.
- **Keyboard**: focus the chart (Tab lands on the toolbar, then the plot region as one stop);
  ←/→ move one sample, `⇧` 7 samples, Home/End, `PgUp/PgDn` jump between events. The readout
  content is mirrored to a polite `aria-live` region (debounced 400 ms).
- Pinned crosshair shows a small "pinned · Tue 14 Oct ×" chip in the toolbar.

### 5.2 Zoom and pan
- Toolbar presets: whole horizon · 4 wk · 1 wk · day. Arrows ◂ ▸ pan by one window.
- Pointer: `Ctrl/⌘ + wheel` or trackpad pinch = zoom around the pointer; plain wheel scrolls the
  page (never hijacked); **drag on the time ruler** = brush a range to zoom; `⇧`-drag on a plot
  = pan; double-click a week in the ruler = zoom to that week.
- Touch: two-finger pinch = zoom around the midpoint; two-finger drag = pan; double-tap ruler =
  zoom in one level.
- Overview: when zoomed, the time ruler becomes a mini-map (the full horizon compressed, 28 px)
  with the visible window as a draggable well-coloured frame.
- Resolution switching (data comes pre-aggregated from the worker):
  | Visible span | Samples | Band |
  |---|---|---|
  | > 21 days | daily (mean; min/max envelope available) | daily 80 % |
  | 7–21 days | 6-hourly | 6-hourly |
  | ≤ 7 days | hourly | hourly |
  | ≤ 2 days | hourly + meal/fast/sleep/training bands in the event ribbon; inputs lane shows meals | |
- Zoom animates x over `--lm-dur-slow` with `--lm-ease-out`; resolution swaps after the animation.

### 5.3 Series control
- Lanes: lane menu (hover icon key / long-press label): Focus · Explain · Move up/down · From
  zero · Hide. Drag the label to reorder within its category.
- Overlay: legend chips above the plot; click = isolate (others to `--lm-chart-dim-alpha`),
  `⌥`-click = hide. **Direct end labels** in a 176 px label column right of the plot (96 px on
  mobile): end value first (`−17.8 %`, 11.5/500 ink), then the metric name in lowercase ink-2;
  leader lines when labels collide (13 px minimum spacing, vertical relaxation).
- Overlay smoothing: when the visible window spans more than 21 days, overlay lines show a
  **7-day centred mean** (caption in the gutter: "7-day average"), because overlay is for
  direction and timing and day-to-day training/fast oscillations would otherwise dominate.
  Lanes never smooth.
- Overlay y-axis: one axis, zero line 1 px `--lm-chart-axis` emphasised, ticks every nice step,
  axis title "change from start (% or index points)".

### 5.4 Focus mode
Triggered by a lane's Focus action, `F`, or view = focus. The focused lane grows to 300 px with:
full y-axis (5 ticks), band + point labels at start/end/min/max, threshold labels, event labels
always on, and a 1-line mechanism summary under it ("Falls as the deficit draws on stores; rate
slows as metabolic adaptation builds (grade A)"). All other lanes collapse to 24 px strips (line
only, `--lm-chart-dim-alpha`, label + value) so the crosshair still reads them. `Esc` exits.

### 5.5 Explain
Clicking a line (within 12 px), a lane label, or an event glyph opens the **Explain drawer**:
metric name + grade badge, what it represents (1 sentence), what drives it in *this* scenario
(ranked drivers with sparkline-free bars: "deficit 62 %, protein 21 %, training 17 %"), the
mechanism statement and plain-language equation, time constants, uncertainty source, and links
to Evidence entries and citations. Deep link: `?explain=<metricId>`.

### 5.6 Stale and running
- Running: previous render stays, all marks at 40 % opacity, a 2 px `ProgressRule` at the top of
  the chart frame, toolbar shows "Running · 1.2 s". No skeleton, no layout jump.
- Result arrives: marks cross-fade to 100 % (200 ms), then the **playhead sweep** (one 1.5 px
  yellow line from left to right, 700 ms, expo-out) — the one authored motion moment.
- Stale: marks at 40 %, info bar "Schedule changed since this run · Run again".

---

## 6. Annotation layers (z-order, bottom → top)

1. Phase bands (alternate block tint) + block boundaries (1 px `--lm-line`)
2. Gridline (middle tick only) and zero/axis line
3. Likely-range bands
4. Reference and threshold lines (maintenance, 0.5 mM ketones, BP 130)
5. Series marks (bars, areas, lines)
6. Start/end/extreme point markers and direct labels
7. Event lines (safety flags at 30 %) and glyphs
8. Crosshair line + dots
9. Selection brush / pinned chip

Everything from 1–5 is drawn on the lane canvas; 6–9 in one absolutely positioned SVG overlay per
chart frame (cheap to update, crisp text, accessible).

---

## 7. Secondary charts

### 7.1 Plan comparison (Planner results)
**v0.2 (plan ladder):** four series — Hard, Medium, Easy as 2 px lines in rung colours with
half-alpha bands, the Ideal as a 1.5 px dashed (`4 3`) ink line without a band (it is a ceiling
reference); direct end labels "Hard −8.1 · Medium −6.9 · Easy −4.2 · Ideal −9.4"; the selected rung
2.5 px. Collapsed rungs are absent from the legend (no empty chips). The text below describes v0.1.
- **Small multiples, one per ranked goal metric** (in goal priority order), 2 columns desktop /
  1 column mobile, each 160 px tall, shared x-axis (horizon), independent y.
- In each: three lines — plan A/B/C in plan colours (2 px) — with their likely-range bands at half
  band alpha, plus the **target** as a solid 1 px `--lm-ink` line with an engraved label ("target
  −10 kg"). Start value dot shared.
- Direct end labels "A −10.4", "B −8.9", "C −11.2" (values lead). Legend chips above the grid.
- Hover crosshair is synced across all multiples.
- Title of each multiple: rank numeral + metric + goal ("1 · Fat mass · lose 10 kg").

### 7.2 24 h day view
Shown when zoom ≤ 2 days and in the day editor ("preview this day").
- **Clock ring** (COMPONENTS §4) on the left (desktop) / top (mobile) for the schedule of the day.
- **Linear 24 h strip** on the right: x = 00:00–24:00 of the selected day (plus 6 h of the next
  day faded at 40 % to show carry-over), lanes: blood glucose (if modelled), insulin index, blood
  ketones, glycogen (liver + muscle as two lines within the fuel hue, dash 2 for liver), MPS rate
  (performance), autophagy index. Background bands: eating window (ink @ 5 %), sleep (recovery
  hue @ 10 %), training (performance hue @ 12 %). Meal markers as macro micro-stacks at their
  times.
- Crosshair shares time with the ring: the ring's now-hand follows the crosshair.

### 7.3 TDEE stacked area
- Lane type `stacked-area` in the energy category and a larger version in Explain.
- Components bottom → top: BMR (resting), TEF, NEAT (non-exercise movement), exercise. Steps of
  the energy hue: teal 700 / 550 / 400 / 250 equivalents (define as `--lm-energy-ramp-1..4` when
  implemented; validate with `--ordinal`). Legend + direct labels on the right.
- "Adaptation" is **not** a negative area (confusing); instead a 1 px `--lm-ink-3` line "expected
  without adaptation" above the total, and the gap is labelled "adaptation −182 kcal".

### 7.4 Macro bars (inputs detail)
- Per-day stacked columns (kcal) or grouped columns (grams), weekly average as a 1 px `--lm-ink`
  step line per macro in grams mode. Used in the inputs lane, the day editor's week context, and
  Planner day-by-day prescription.
- Bar width = min(24, slot × 0.72); gap 2 px; 4 px rounded top on the top segment only.

### 7.5 Weight-change decomposition
- Weekly columns centred on zero: Δ fat, Δ lean tissue, Δ glycogen, Δ water (body-comp hue ramp
  steps + macro-like distinct: fat = cobalt, lean = cobalt 300, glycogen = copper, water = sky),
  2 px gaps, diverging around a 1 px `--lm-chart-axis` zero line; net change as an ink dot.
- Answers "why did the scale drop 2 kg in week 1" — mostly glycogen + water — in one glance.
  Validate the 4 colours adjacent before implementing.

### 7.6 Optimiser convergence
120 px line chart, x = iterations, y = best score per slot, plan colours, no bands, direct end
labels "A 0.82". Purely reassurance; hidden under 1 s runs.

### 7.7 Preview strip (schedule)
48 px, daily fat-mass line (body hue, 1.5 px) + ketosis ribbon (6 px keto ramp). No axes; start
and end values as text at the ends. Labelled "preview".

---

### 7.8 Trend lane (Living: Today, Progress, check-in) `<TrendLane>`
The weight trend against the plan's forecast — the hero of every "is it working?" question.
- **Marks**: filtered trend line 2 px in `--lm-cat-body`; raw weigh-ins as 4 px dots in the body
  hue at 35 % (flagged outliers hollow, never removed); **realistic forecast** band (at the person's
  actual adherence) as the series band; **as-prescribed** forecast as a 1 px dashed outline band
  (what full adherence would give); the goal as a 1 px ink line with label; the goal-date range as a
  bracket on the x-axis ("likely 21–30 Dec"); today = yellow now-hand.
- **Sizes**: Today 7–14 days, 64–96 h, no y-axis numerals in quiet mode; Progress full width, 240 h
  (180 mobile), range KeyBank 2 wk · 4 wk · 12 wk · all; check-in 14 days, 160 h.
- **Events**: engraved markers for estimate resets (illness, travel, a long fast, DXA, model update),
  plan versions (v2, v3…) and pauses (hatched span).
- **Readout**: "trend 83.1 kg (±0.3) · expected today 82.8–83.6 · on track".
- **Never** red or green; drift state is a word with a shape mark (CHART_SPEC §3.1 severity rules).
- Table view: date · weigh-in · trend · expected range · event.

### 7.9 Adherence views
- **Calendar**: month grid of 16 px AdherenceDial glyphs; assumed days dashed, paused days struck,
  unscored days a hollow dot; weekday header; tap → that day.
- **Per-block bars**: horizontal bars 0–100 per item type (training, protein, energy, fasting,
  steps) for the week, ink fill, with the costliest item named in text; no target line at 100.
- "last 7 days" / "last 28 days" adherence Readouts (`A_7` / `A_28` in the data) with "steady" or
  an arrow; never a sparkline used as decoration.

### 7.10 Score history `<ScoreHistory>`
Nightly values as faint dots, the 7-day mean as a 2 px line in the category hue (recovery sky for
HRV/RHR/sleep, performance green for VO2 max and load), the personal normal range as a band, version
changes as engraved vertical lines ("v1.3 from 20 Oct"), a new device as a dashed join; optional
"compare with v1.2" second line dashed. Vendor values never plotted on the same axis.

## 8. Performance

### 8.1 Data volume
- Horizon ≤ 6 months = 184 days × 24 h = **4 416 hourly samples** per metric; 41 metrics +
  2 band bounds each ≈ 543 k floats ≈ 2.2 MB as Float32.
- The engine worker returns **columnar `Float32Array`s** (`t`, `metric[i].p50`, `.p10`, `.p90`)
  as Transferables, plus pre-aggregated daily and 6-hourly columns (mean + min/max envelope) so
  the UI never aggregates on the main thread.

### 8.2 Rendering budget
| Operation | Budget |
|---|---|
| First render of 12 visible lanes after data arrives | < 120 ms |
| Crosshair move (all lanes + readout) | < 4 ms per frame, no React re-render |
| Zoom/pan frame | < 12 ms |
| Resolution swap | < 50 ms |

### 8.3 Techniques
- **Downsample per pixel column** (M4: first/min/max/last) for any series with more samples than
  2 × plot width px; hourly data at the full horizon never reaches the canvas.
- One canvas per lane (DPR-aware), lanes outside viewport ± 1 screen are not rendered (IntersectionObserver).
- Crosshair, dots and readout are updated imperatively (refs), not via React state; readout text
  uses a pre-built DOM with `textContent` swaps.
- Bands drawn as a single closed path per lane; lines as one path; no per-point DOM.
- Theme change → re-read CSS variables once (`getComputedStyle`) and redraw; do not read CSS vars
  per frame.

---

## 9. Accessibility

- **Table view twin** for every chart (`T` or toolbar ▦): DataTable with the visible metrics and
  time range at the current resolution, values with ranges, CSV download.
- Every lane: `role="img"` with an `aria-label` generated summary, e.g. *"Fat mass, kilograms,
  grade A. Falls from 24.1 to 19.8 (likely 18.6 to 21.0) over 12 weeks; fastest in weeks 1 to 2.
  Press T for the data table."* Overlay/comparison: one summary per series.
- Keyboard crosshair (§5.1) and live readout; all toolbar controls are standard buttons/radios.
- Identity is never colour-alone: lane labels, overlay direct labels + dash + markers, macro
  legend + tooltip, plan letters on every plan mark's end label.
- Forced colors: lines use `CanvasText`/`LinkText`-mapped system colours via a forced palette,
  bands switch to hatch textures, the crosshair to `Highlight`.
- Motion: playhead sweep and y-rescale animations are disabled under reduced motion.
- Minimum text in charts 11 px; tick text ≥ 4.5:1 (ink-3 on face = 4.7:1).

---

## 10. Library recommendation

| Option | Fit | Notes |
|---|---|---|
| **uPlot** (MIT, ~48 kB) | **Recommended** for lanes, overlay, comparison, convergence | Canvas time-series specialist; renders 100 k+ points in a few ms; `cursor.sync` keys multiple charts to one crosshair (exactly the lane model); `bands` option for likely ranges; draw hooks for thresholds/phase bands; tiny, framework-free, easy to theme from CSS vars; per-lane instances keep y-scales independent without dual axes. Needs our own plugins for touch pinch/pan, brush-on-ruler and the overlay label layer (≈ 600 LOC). |
| Apache ECharts (~350 kB min+gz tree-shaken ≈ 180 kB) | Capable, not chosen | Great dataZoom and touch out of the box, but heavy, its visual defaults fight our marks spec, and fine control of lane layout, crosshair readout and annotation layering costs more than it saves. |
| visx / D3 + SVG | Use for small custom charts only | SVG with ~40 k path vertices on screen is fine; at hourly × 40 lanes and live crosshair it drops frames on mid phones. Good for the clock ring, triangle, phase timeline, preview strip, avatar (all custom SVG with D3 scales/shapes). |
| Custom canvas/WebGL renderer | Not now | Maximum control, but weeks of work for zoom/crosshair/text; revisit only if uPlot limits show up (e.g. > 60 lanes). |

**Decision**: uPlot for all time-series plots (one instance per lane, synced), `d3-scale` /
`d3-shape` + React SVG for bespoke instruments (clock ring, macro triangle, raster, avatar,
timelines), a shared `ChartTheme` module that reads `--lm-*` tokens and exposes resolved colours
to canvas code, and a thin HTML/SVG overlay layer for labels, events and the crosshair readout.

---

## 11. Export
- PNG export of the current view at 2×: includes title (scenario name), date range, legend,
  grade badges, and the disclaimer line; width 1600 px; always light theme unless the user picks
  dark.
- CSV export of the table view.

---

## Appendix A — Metric catalogue (v1 draft for engine + UI)

Grades are placeholders until the research dossiers land (`research/NN-*.md`, column "src").
`ovl` = overlay transform (§2.1). Default lanes marked ★.

| id | Name (UI) | Category | Unit | Lane type | ovl | src |
|---|---|---|---|---|---|---|
| fat_mass ★ | Fat mass | body | kg | line | pct | 01, 14 |
| lean_mass ★ | Lean mass | body | kg | line | pct | 01, 03 |
| skeletal_muscle | Skeletal muscle | body | kg | line | pct | 09 |
| scale_weight ★ | Scale weight | body | kg | line | pct | 01 |
| body_fat_pct | Body fat | body | % | line | pts | 14 |
| body_water | Body water | body | kg | line | pct | 13, 15 |
| waist | Waist | body | cm | line | pct | 14 |
| visceral_fat | Visceral fat | body | index | index | pts | 14, 06 |
| glycogen ★ | Glycogen (total) | fuel | g | line | pct | 04 |
| liver_glycogen | Liver glycogen | fuel | g | line | pct | 04, 07 |
| ketones ★ | Blood ketones (BHB) | fuel | mmol/L | line+threshold | — | 05 |
| ketosis_state | Ketosis state | fuel | state | state | — | 05 |
| keto_adaptation | Keto-adaptation | fuel | index | index | pts | 05 |
| fat_ox_share | Fat oxidation share | fuel | % | line | pts | 05, 10 |
| glucose | Blood glucose | fuel | mmol/L | line+threshold | pct | 04 |
| tdee ★ | Energy expenditure (TDEE) | energy | kcal/d | stacked-area | pct | 02 |
| energy_balance | Energy balance | energy | kcal/d | line (zero line) | — | 01, 02 |
| met_adaptation ★ | Metabolic adaptation | energy | kcal/d | line | — | 02, 12 |
| neat | Non-exercise movement | energy | kcal/d | line | pct | 02, 10 |
| autophagy | Autophagy signal | cellular | index | index | pts | 08 |
| mtor | mTOR activity | cellular | index | index | pts | 08, 03 |
| ampk | AMPK activity | cellular | index | index | pts | 08 |
| mps | Muscle protein synthesis | cellular | index | index | pts | 03 |
| igf1 | IGF-1 | cellular | ng/mL | line | — | 08 |
| hunger ★ | Hunger pressure | hormones | index | index | pts | 12 |
| leptin | Leptin | hormones | ng/mL | line | pct | 12 |
| t3 | Thyroid (T3) | hormones | pg/mL | line | pct | 12 |
| cortisol | Cortisol | hormones | index | index | pts | 12, 16 |
| reproductive | Reproductive hormones | hormones | index | index | pts | 12, 16 |
| insulin_sens | Insulin sensitivity | cardio | index | index | pts | 04, 06 |
| ldl | LDL-C | cardio | mmol/L | line+threshold | pct | 06 |
| apob | ApoB | cardio | g/L | line+threshold | pct | 06 |
| hdl | HDL-C | cardio | mmol/L | line | pct | 06 |
| tg | Triglycerides | cardio | mmol/L | line+threshold | pct | 06 |
| bp_sys | Blood pressure (systolic) | cardio | mmHg | line+threshold | pct | 06, 15 |
| liver_fat | Liver fat | cardio | % | line+threshold | pct | 06 |
| vo2max | VO₂max | performance | mL/kg/min | line | pct | 10 |
| strength | Strength index | performance | index | index | pts | 09, 19 |
| training_capacity | Training capacity | performance | index | index | pts | 09, 19 |
| sleep_quality | Sleep quality | recovery | index | index | pts | 16 |
| mood_energy | Mood & energy | recovery | index | index | pts | 19 |
| bone | Bone health index | recovery | index | index | pts | 19 |
| micronutrient_risk | Micronutrient risk | recovery | index | index | pts | 15 |

Units follow the user's settings (mmol/L ↔ mg/dL for glucose and lipids; kg ↔ lb; cm ↔ in;
kcal ↔ kJ).
