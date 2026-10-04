# Vitals — Design Direction

> Status: v1, 2026-09-30. Owner of this document: design lead. Tokens: `tokens.css`.
> Companion docs: `INFORMATION_ARCHITECTURE.md`, `COMPONENTS.md`, `CHART_SPEC.md`, `AVATAR_SPEC.md`,
> `screens/*.md`, and the living reference `prototype/index.html`.

---

## 1. The concept in one paragraph

**Vitals is a precision instrument for your physiology.** You set it the way you set a good piece
of German laboratory or audio equipment — with keys, tuning scales and a clock dial — and you read
it the way a clinician reads a multi-channel recording: many channels stacked on one time axis,
each honest about its own range and error. The visual world comes from the Ulm school and the
Braun product line of the 1960s–70s (mineral-grey housings, white faceplates, anthracite text,
engraved lowercase labels, one coloured key), rebuilt for screens. It is precise without being
clinical, and warm without being "wellness".

### Direction contract

- **Thesis.** An instrument, not a dashboard. We refuse the category default (dark cards, glowing
  rings, KPI tiles, neon accents; or its opposite, cream-and-serif wellness) and give the user
  controls with a physical logic and readouts that show uncertainty as part of the number.
- **Own world.** Mineral-grey chassis, white faceplates (anthracite in dark), hairline scales with
  ticks, lowercase engraved labels, Archivo in three widths, push-button banks with indicator
  dots, a 24 h clock dial, a perforated dot-grid stage, and one Vitals-yellow key. Chrome is
  achromatic; colour belongs to data.
- **Story.** Set your body on a graphic figure → paint weeks with program keys → press the yellow
  key → read every channel with its likely range → tap any curve to see the mechanism and the
  evidence behind it.
- **Signature interactions.** (1) Tuning-scale sliders that move the body avatar live with a
  readout riding the pointer. (2) The schedule painter: pick a program key, drag across days.
  (3) The channel stack with one crosshair reading every channel at once.
- **Form.** Grounded candidate 7 of 7 ("Braun/Ulm instrument panel"), impeccable concept seed
  `b2838919`, raised by the six dealt challengers (§9).

---

## 2. Brand personality

| We are | We are not |
|---|---|
| **Precise** — numbers have units, ranges and sources | Hyped ("transform your body!") |
| **Candid** — we say what we don't know, in the same breath as what we do | Hedging into mush ("results may vary") |
| **Humane** — every body is a valid starting point; no food is "bad" | Moralising, shaming, cheerleading |
| **Quietly expert** — the depth is there when you ask for it | A lecture on first contact |
| **Tactile** — controls feel like objects with weight and detents | Flat forms and endless dropdowns |

Three words for the whole team: **calibrated, candid, kind.**

---

## 3. Visual language

### 3.1 Typography — one family, three widths

**Archivo** (Omnibus-Type, SIL OFL, Google Fonts; variable `wght 100–900`, `wdth 62–125`; has
`tnum`, `zero`, `case`, `frac`, `sups/subs`). One grotesque in the Akzidenz lineage, used at three
widths the way instrument makers use one typeface across a front panel:

| Width | `font-stretch` | Role | Example |
|---|---|---|---|
| Condensed | 84% | axis ticks, lane labels on mobile, dense tables, calendar day numbers | `wk 6 · 12 · 18` |
| Normal | 100% | all UI text, buttons, prose (library) | "Paint a block across days" |
| Wide | 112% | numeric readouts, key captions | `23.4 %` |
| Display | 120% | screen titles, the one hero readout per view | **Your body** |

Rules:
- **Engraved labels** — control captions, lane names, axis titles — are **lowercase**, 12 px,
  weight 500, `--lm-ink-2`, no letter-spacing tricks. This is the Braun panel voice ("energy",
  "window", "protein"). Headings and sentences stay in sentence case. Never uppercase tracked
  labels; never mono as a "technical" costume.
- Readouts that change live (sliders, crosshair, optimiser) use `tabular-nums slashed-zero` so
  digits never jitter (fixed-place readouts). Static summary numbers keep proportional figures.
- Units are set one step smaller and in `--lm-ink-2` after a thin space: `23.4 %`, `2 540 kcal`,
  `1.8 mmol/L`. Thousands use a no-break space (U+00A0; in Archivo it is as narrow as a thin space) so a number never breaks across lines, in metric locales; comma in en-US.
- Ranges read as "likely 20–27 %" with an en dash; ± only in tables.
- Screen titles: display width, 30 px desktop / 24 px mobile, weight 600, tracking −0.015 em.
- Prose measure: 68 ch, 17 px / 26 px (Evidence library).
- Scale (px): 11 · 12 · 13 · 15 · 17 · 20 · 24 · 30; readouts 22 · 32 · 52. UI body is 15 px on
  desktop and mobile (inputs are 16 px on mobile to prevent iOS zoom).

Loading: `https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&display=swap`
for the prototype; the app should self-host the variable `Archivo[wdth,wght].ttf` (converted to
woff2, latin + latin-ext subsets, ≈ 110 kB) with `font-display: swap` and a metric-matched
fallback (`size-adjust: 104%` on Arial) to avoid layout shift.

### 3.2 Colour system — achromatic instrument, chromatic data

Strategy: **Restrained**. The chassis and faceplates are neutral (hue 255 at chroma ≤ .006 — a
mineral grey, deliberately *not* cream). Exactly one chrome accent exists: **Vitals yellow**
`#f5d336`, the colour of the "=" key on a Braun ET66 and of the second hand on a Braun clock.

| Role | Light | Dark | Where |
|---|---|---|---|
| Chassis (page) | `#e8eaec` | `#151618` | background, behind faceplates |
| Chassis 2 | `#dde0e3` | `#181a1c` | rail, toolbars, program-key tray |
| Face (panels, chart surface) | `#fbfcfd` | `#1d1f22` | every content panel |
| Well (recessed) | `#f1f2f4` | `#181a1c` | inputs, slider tracks, day cells |
| Ink / ink-2 / ink-3 | `#191c20` / `#52565b` / `#6e7277` | `#eff0f2` / `#b7bbc0` / `#95999e` | text hierarchy |
| Signal | `#f5d336` | `#f0d03c` | Run/Optimise key, now-hand, active indicator dots, brand dot |

What the yellow **never** does: warn (caution is amber `--lm-caution-*`), colour text, fill large
areas, or mark a data series.

Selection states are expressed the Braun way: the **pressed key** — ink fill with inverse text
and a small signal-yellow indicator dot — not a coloured highlight.

**Data colour** (all validated with the dataviz six-check script; see `CHART_SPEC.md §3`):
- 8 **category hues**, one per metric family, fixed forever: body `#2a6cc9` cobalt · fuel
  `#d6682f` copper · energy `#129d97` teal · cellular `#694daf` violet · performance `#25873e`
  green · recovery `#58b0db` sky · cardiometabolic `#dda734` saffron · hormones `#ca588c` rose.
  A metric wears its category hue everywhere it appears — the user learns "copper = fuel".
- 5 **macro colours** in fixed stack order: protein indigo · net carbs gold · fibre olive · fat
  rose-coral · alcohol plum.
- **Energy balance** is a diverging tint: cool blue for deficit, warm apricot for surplus,
  neutral well for maintenance. Neither side is framed as good.
- **Plan A/B/C**: cobalt / copper / teal (all-pairs validated).
- **Severity**: info slate-blue, caution amber, danger red, ok green — always icon + label.
- **Evidence grades** are achromatic on purpose: A solid ink, B grey, C outlined, D dashed.

### 3.3 Shape and material

- **Faceplates**: 8 px radius, 1 px `--lm-line-strong` edge, `--lm-shadow-face`. They sit on the
  chassis like panels screwed into a housing. No nested cards: inside a faceplate, structure is
  made with hairline rules (`--lm-line`) and spacing, never another box.
- **Keys** (buttons): 5 px radius, `--lm-raised` cap with a 1 px inner top highlight and a 1 px
  bottom shadow (`--lm-shadow-key`); pressed = inset shadow, 1 px translate. The Run key is a
  **round** 56 px yellow key (the ET66 "=" key), the only round primary in the product.
- **Wells**: inputs, tracks and day cells are recessed (`--lm-well` + `--lm-shadow-well`).
- **Scales**: every continuous control has a printed scale — major ticks every 5 units, minor
  every 1, lowercase numerals under majors — like a radio tuning window.
- **Perforation**: the avatar stage and empty states use a 12 px perforated dot grid
  (`stage-dots`), the speaker grille of a Braun SK4/T3, which doubles as a measurement grid.
- **Indicator lights**: 6 px round dots. Yellow = active/selected; ink = on; hollow = off. Used on
  key banks, program keys, metric chips.
- **Hairlines** are 1 px solid. Dashed lines are reserved for *meaning* (grade D edges, the
  second metric in a category on overlay charts). Gridlines are never dashed.
- Icons: 1.5 px stroke, 20 px grid, rounded caps, drawn from **Lucide** (ISC) plus ~12 authored
  glyphs in the same grammar (dumbbell-plate, footsteps, run, fast-clock, meal-dot, ketone-drop,
  sleep-arc, avatar-front, avatar-side, grade-pips, program-key, scale-ruler).

### 3.4 Density

Two densities, chosen by the task, not the screen:
- **Setting** (Your body, day editor, goals): comfortable — 44 px touch targets, 16–24 px
  between groups, one idea per row.
- **Reading** (results chart, schedule painter, tables): dense — 32 px pointer targets on
  desktop, 11–13 px condensed labels, 72 px lanes (26 px strips in focus mode), zero decoration. Density is where the
  expertise shows.

Layout grid: 4 px base; desktop content on a 12-column grid with 24 px gutters inside
`--lm-content-max: 1440px`; mobile 16 px side gutter, single column, no horizontal page scroll
(horizontal scroll only inside explicit rails: program keys, summary readouts, plan cards).

### 3.5 Motion — state, not decoration

Motion copies the physical behaviour of instruments:
- **Keys** depress in 80 ms (`--lm-ease-press`) and release in 140 ms.
- **Needles and readouts** settle with one damped overshoot (`--lm-ease-needle`, 420 ms): slider
  thumbs after a keyboard step, the avatar after a preset jump, readout digits after a run.
- **Panels and sheets** slide on `--lm-ease-sheet` (320 ms); drawers never fade in from nowhere.
- **Charts** keep their frame on re-run: the previous projection holds at 40 % opacity with a
  thin progress rule at the top of the chart; new curves draw in place (no skeletons, no bounce).
- **The one authored moment**: after a run, the playhead sweeps once across the chart
  (700 ms, expo-out) and the start→end readouts count to their values. That is the "result
  arrived" signal. Nothing else animates on load.
- `prefers-reduced-motion`: everything snaps; only 80 ms opacity crossfades remain.

---

## 4. What makes it distinctive (the memory test)

After one visit people should describe: *"the health app that looks like a Braun radio — you drag
little tuning scales and a grey figure changes shape, you paint weeks like a sequencer, press a
yellow button, and get a stack of graphs like a sleep-lab printout, each with its own error band
and a grade letter."*

The six signatures, in order of importance:
1. **The channel stack** — stacked lanes on one time axis with a single crosshair, likely-range
   bands and A–D grade badges on each lane.
2. **The two-layer avatar** — a lean core inside a frosted adipose envelope, DEXA-inspired,
   neutral material colour, front + side.
3. **Tuning-scale sliders** with printed ticks and a riding readout.
4. **Program keys + painter** — schedule editing as a step sequencer.
5. **The 24 h clock dial** — eating window, fast, meals, training and sleep on one Braun-clock
   face with a yellow now-hand.
6. **The yellow key** — one round key runs simulations and the optimiser. Nothing else is yellow.

---

## 5. Anti-patterns — do not ship these

Visual:
- Dark-mode-first neon: glowing rings, cyan/lime on black, gradient-filled charts, glass cards.
- Cream backgrounds with serif display type and terracotta accents.
- KPI hero templates (big number + tiny label + delta chip, ×4 in a row) as the page structure.
- Activity rings, progress donuts, gauges, sparklines used as decoration.
- Uppercase tracked micro-labels, eyebrow text above headings, "01 / 02 / 03" section numbers.
- Nested cards; coloured left-border callouts; gradient text; emoji as icons.
- Dual-axis charts; more than 8 hues; colour assigned by rank; dashed gridlines.
- Photographs of bodies, "before/after" transformation imagery, fitness-model stock.

Product and content:
- **Diet brand names** as model categories ("Keto mode"). Presets describe composition:
  "Very-low-carb, ≤ 30 g net carbs" — the familiar name may appear as a secondary search alias.
- Moral language: clean/dirty, cheat, guilt-free, junk, earn/burn off, "bad" foods, "ideal" body.
- Body labels: obese/overweight/skinny/"problem areas". We show numbers and ranges only.
- Single-number certainty: every projection shows a likely range or states why it can't.
- Gamification: streaks, badges, confetti, scores for eating less.
- Modals as a first resort; they are for destructive confirmation and the first-run safety step.
- Hiding safety content behind "learn more": the first line of every warning says the risk.

---

## 6. Naming

| Concept | Name in UI | Notes |
|---|---|---|
| Product | **Vitals** | wordmark: lowercase `vitals`, display width, with a yellow indicator dot |
| Profile | **Your body** | never "profile", never "stats" |
| Feature 1 | **Simulate** (nav) / **Simulator** | a saved schedule is a **scenario** |
| Feature 2 | **Plan** (nav) / **Planner** | outputs are **plans A, B, C** |
| Library | **Evidence** | an entry is a **mechanism** |
| Reusable day config | **program** (key A, B, C…) | "Training day · 85 %" |
| Consecutive days with one program | **block** | shown in the phase column |
| Planner periods | **phase** | "Phase 2 · weeks 5–8" |
| Uncertainty band | **likely range** | = 80 % interval; "wide range" when > ±25 % |
| Evidence strength | **grade A–D** | A strong … D speculative |
| Energy vs maintenance | **deficit / maintenance / surplus** | as % of maintenance |
| Run | **Run** (simulator) / **Find plans** (planner) | the yellow key |
| Curve explanation | **Explain** | opens the mechanism drawer |

Metric names are plain first, technical second: "Hunger pressure" (index), "Blood ketones (BHB)",
"Metabolic adaptation", "Autophagy signal (index)". Indices are always labelled "index" and carry
their scale (0–100) and meaning in the Explain drawer.

---

## 7. Voice

- **Second person, present tense, short.** "Your maintenance is about 2 540 kcal."
- **Specific over soothing.** Not "great progress!" but "Fat mass falls 4.3 kg over 12 weeks."
- **Numbers carry units and ranges.** "likely 18.6–21.0 kg".
- **Say the mechanism.** "Hunger rises because leptin falls with fat mass and the deficit."
- **Name trade-offs without judgement.** "Longer fasts raise the autophagy signal and slow
  muscle gain. Plan B trades some autophagy for more muscle."
- **Warnings: risk first, then what to do, then the option.** Never scold.
- **No exclamation marks.** No emoji. No "Oops".
- **Verbs on controls**: "Run", "Paint", "Copy week", "Open in Simulator", "Export data".

### 7.1 Sample copy

**First run (welcome)**
> **See what a plan does before you live it.**
> Vitals projects your body forward day by day from what you eat, how you train, move and sleep.
> It shows trends for an average person like you — with ranges, not promises — and the evidence
> behind every curve.
> [Set up your body]

**Your body, live estimate**
> body fat **23.4 %** likely 20–27 %
> Estimated from your height, weight, waist and the figure. A DEXA scan would narrow this to ±2 %.

**Empty scenario**
> **Paint your first weeks.**
> Pick a program key, then drag across days. Start with one and refine later.
> [Use a starter: 12 weeks, moderate deficit]

**Run in progress**
> Running 84 days · 41 channels… 1.2 s

**Uncertainty language**
> - "likely 18.6–21.0 kg" (tooltip: *80 % of people like you would land in this range.*)
> - "The range widens after week 8 because metabolic adaptation varies a lot between people."
> - "Grade C — limited human data. Read the shape, not the exact number."
> - "Grade D — based on animal and cell studies. Shown for exploration; the Planner won't
>   optimise for it by default."
> - "We can't estimate this without a waist measurement." [Add waist]

**Caution (inline, simulator)**
> [icon: caution-triangle] **Your deficit is 31 % of maintenance.**
> Above about 25 % the model shows more muscle loss and stronger hunger and hormone effects.
> Real-world results vary.
> [Set energy to 75 %] [Keep as is]

**Danger (simulator, unsafe regime)**
> [icon: danger-octagon] **Under 800 kcal a day for 28 days.**
> Very-low-energy diets this long need medical supervision: risks include gallstones,
> electrolyte problems and heart rhythm changes. Vitals shows the projection so you can see it,
> but the Planner will never prescribe it. Talk to a clinician before trying this.

**Planner: goal not achievable**
> **Lose 10 kg fat in 8 weeks — not reachable safely.**
> The fastest safe plan reaches 6.2 kg (likely 5.1–7.3). Extend to 13 weeks, or keep 8 weeks and
> accept 6 kg.

**Planner: conflict**
> **Muscle gain and the autophagy signal pull in opposite directions.**
> Muscle growth needs frequent protein and energy; the autophagy signal needs long gaps without
> them. Your ranking puts muscle first, so plans keep fasts under 20 h.

**Disclaimer (short form, footer of results)**
> Projections for an average person with your inputs. Not medical advice. Individual results
> differ — see the range on each curve.

**Import error**
> **This file isn't a Vitals export.** It's missing the `vitalsVersion` field. Choose a `.json`
> file exported from Settings → Data.

---

## 8. Accessibility commitments

- WCAG 2.2 AA: body text ≥ 4.5:1, UI boundaries ≥ 3:1 (`--lm-edge`), focus ring 2 px + 2 px
  offset on every interactive element (ink in light, yellow in dark).
- Every chart has a table view and keyboard crosshair; identity is never colour-alone (labels,
  dash patterns, markers; textures in forced-colors).
- Targets: 44 × 44 px touch, 32 × 32 px pointer in dense chart chrome.
- All sliders are native `input[type=range]` (or ARIA slider) with `aria-valuetext` including
  units ("23 percent body fat").
- Body representation: neutral material colour (never a skin tone), no facial features, a
  neutral base shape available, no weight-category labels (see `AVATAR_SPEC.md §7`).
- Reduced motion honoured; nothing flashes > 3×/s.

---

## 9. How the direction was chosen (for the record)

Process: impeccable new-work flow, **Operate** mode, owner asked not to be consulted on design, so
the decision round ran unattended with the assignment accepted. Product truth was inferred from
`docs/PROJECT_BRIEF.md` into `design/PRODUCT.md`.

Grounded candidates, by resonance: 1 ensemble weather meteogram · 2 polysomnogram / patient
monitor · 3 nutrition-facts label · 4 chronobiology actogram · 5 gym periodisation board ·
6 anatomical atlas plate · **7 Braun/Ulm instrument panel (assigned by seed `b2838919`)**.
The meteogram and polysomnogram survive as the correct *chart form* (stacked channels, shared
time axis, spread bands) inside the instrument world; the actogram survives as the week-row
schedule raster.

Dealt challengers — all declined; each donated one discipline:

| Challenger | Verdict | Raise written into Vitals |
|---|---|---|
| Streaming title wall | declined | **Focus lane**: the focused channel grows, the rest dim and shrink to 24 px strips. |
| Skeuomorph leather studio | declined | **Direct manipulation**: drag the avatar's waist, hips, chest and arms themselves, not only sliders. |
| Nixie laboratory counter | declined | **Fixed-place readouts**: live values in tabular digits with a short digit roll; quantities are the interface. |
| Variable-font specimen | declined | **One axis drives the whole field**: every slider remaps the avatar and all readouts continuously at 60 fps, with a coordinate readout on the thumb. |
| Gravity-rain garden | declined | **Paint and watch it flow**: painting days updates a coarse preview strip (fat mass + ketosis) under the painter in < 100 ms. |
| Iridescent cloud edge | declined | **Colour only at data edges** and first-class uncertainty states (forming / established / fading bands for ketosis). |

---

## 10. v0.2 additions (2026-10-01) — the living plan

The instrument gains a second face: once a plan starts, Vitals is read daily rather than tuned.
The direction holds; these are the additions engineers and writers need.

**Naming** (extends §6):

| Concept | Name in UI | Notes |
|---|---|---|
| Planner outputs | **Hard · Medium · Easy** and **Ideal** | replaces "plans A, B, C" everywhere (copy, URLs, legends, exports, scenario names); Ideal is always "scientific ceiling", never applied to a body |
| A started plan | **your plan** / its name ("Spring cut") | "active plan" only in settings-like contexts |
| Living destinations | **Today · Food · Train · Coach · Progress** | provisional until the owner confirms |
| Planning screens while a plan runs | **Planning tools** | never "edit mode" |
| Day's instructions | **today's plan** | the frozen per-day prescription |
| What happened | **log** (verb and noun) | "as planned" for one-tap logging |
| Weekly review | **check-in** | |
| Drift | **ahead · on track · behind** | words with shape marks, never red/green |
| The 0–100 per-day number | **adherence** | never "score" alone, never "compliance"; distinct from the model's plan-survival series |
| AI action review | **proposal** (waits for Apply) · **logged** (applied, Undo) · **needs your confirmation** | |
| Device trust | **tier A · B · C** | "trend only" for tier C heart-rate variability, autonomic load, oxygen, temperature |
| Vendor numbers | "**{vendor} says …**" · vendor opinion | never as Vitals' value |

**Colour additions**: rung hues alias the validated plan hues (Hard cobalt, Medium copper, Easy
teal); the Ideal is ink, dashed. Adherence, change-card states and burdens are achromatic. Living
screens carry **no yellow key** — yellow stays reserved for starting a run (Run, Find plans).

**Anti-patterns added**: streak counters or "days in a row" headlines; closing-the-ring moments;
red for being behind; "make up for yesterday"; an AI change applied without a card; a vendor score
in a primary position; a Start key on the Ideal; sex or gender words on the figure's Frame
control; a visceral "blob".

**Voice samples (Living)**:
> "Welcome back. Nothing to catch up on. Today's plan is below."
> "You followed the plan; your body is burning about 120 kcal a day less than assumed. The plan is
> updated."
> "Three days without training moves your goal date by 2–4 days. Apply?"
> "Logged lunch: about 640 kcal (510–780), 33 g protein. Tap any amount to correct it."
> "Signs of strain for 2 nights. Today's session is now easy. Any of these: alcohol, travel, a hard
> session yesterday?"
