# Screen — Your body (`/body`)

> **v0.2 note (2026-10-01):** the figure, the "figure base" control and the visceral switch are
> replaced by `body-figure-v2.md` (3D figure with SVG fallback, Frame slider, visceral view). The
> Habits section is retired: activity, training and sleep timing move to the intake
> (`onboarding-intake-v2.md`); Body keeps a slim **Your setup** faceplate listing the intake
> chapters, deferred questions, stress and cycle tracking. Everything else here stands.

> Reference rendering: `prototype/index.html#body`. Components: `COMPONENTS.md`. Figure model:
> `AVATAR_SPEC.md`. Estimator: research dossier 14 (M1–M3, M9–M11).

## 1. Purpose

Describe the starting body once, in a way that feels like handling an object rather than filling
a medical form: basics, a two-layer figure you shape with tuning scales (or by dragging its edges),
and habits. The screen answers, live: *what does Vitals think my body fat, lean mass and maintenance
energy are, and how sure is it?* Every projection and plan starts from this state.

Also serves as onboarding steps 3–5 (`/welcome` hands over to `/body?setup=basics|shape|habits`).

## 2. Entry points & exits

| In | Out |
|---|---|
| Rail/tab "Body" · first-run after consent · "Refine" chip on any estimate · Simulator banner "Your body changed" · Planner "needs waist measurement" chip (deep link `#shape` with waist focused) | Setup mode: "Next: shape" → "Next: habits" → "Done" → *Choose a start* faceplate. Normal mode: nothing to confirm — autosave; nav away freely. |

## 3. Layout — mobile (375 px)

```
┌──────────────────────────────────────────┐
│ ● vitals                       ◐   ⚙     │ top bar 56
├──────────────────────────────────────────┤
│ Your body                saved on device │ context row (title 24 display)
├──────────────────────────────────────────┤
│ ┌ Figure  front·side ─── visceral [○ ] ┐ │ Faceplate flush
│ │ ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·   │ │ perforated stage, 4:5
│ │ 200┤      ◯          ◯               │ │ height ruler left
│ │ 178┼──  ╱ █ ╲       ██▌              │ │ front ~150 px wide
│ │    │   │ ███ │      ███              │ │ side  ~110 px wide
│ │ 100┤   │ █ █ │      ██               │ │ figure height ≈ 300 px
│ │    │     █ █         █               │ │
│ │  50┤     █ █         █▄              │ │
│ │      front          side             │ │
│ │ Illustrative figure. Shows proportions│ │
│ │ from your inputs, not your exact shape│ │
│ └───────────────────────────────────────┘ │
│ ┌ Estimates  live ─────────────────────┐ │ ReadoutStrip-style rail
│ │ body fat │ fat mass │ lean mass │ ma… │ │ 172 px items, snap scroll
│ │ 28.4 %   │ 24.1 kg  │ 60.8 kg   │     │ │
│ │ ├─█─┤ likely 23.7–33.1                │ │
│ └───────────────────────────────────────┘ │
│ ┌ Basics ──────────── [metric|imperial] ┐ │
│ │ sex for the physiology equations      │ │ KeyBank full width
│ │ [female | ●male | prefer not to say]  │ │
│ │ age      [ −     36 yrs      + ]      │ │ Steppers stacked, 44 px
│ │ height   [ −    178 cm       + ]      │ │
│ │ weight   [ −    84.9 kg      + ]      │ │
│ │ figure base · only changes the drawing│ │
│ │ [female | neutral | ●male]            │ │
│ └───────────────────────────────────────┘ │
│ ┌ Shape ───────────── Reset to estimate ┐ │ ScaleSliders
│ │ body fat                     28.4 %   │ │
│ │ ▕┃┃┃┃▕┃┃┃┃▕┃┃█┃▕┃┃┃┃▕┃┃┃┃▕┃┃┃┃▕       │ │
│ │ where it sits ────────────────────    │ │
│ │ belly & waist          41 % of fat    │ │
│ │ hips & thighs          32 % of fat    │ │
│ │ chest (drawing only)   14 % of fat    │ │
│ │ arms  (drawing only)   14 % of fat    │ │
│ │ muscle ───────────────────────────    │ │
│ │ upper body          some training     │ │
│ │ lower body               trained      │ │
│ │ waist ───────── use measurement [○ ]  │ │
│ └───────────────────────────────────────┘ │
│ ┌ Habits ──────────────────────── Edit ┐ │ summary; Edit opens Sheet
│ └───────────────────────────────────────┘ │
├──────────────────────────────────────────┤
│  body    simulate    plan    evidence    │ tab bar 64 + safe area
└──────────────────────────────────────────┘
```

- **Sticky mini figure.** When the stage scrolls out of view while the user is dragging a Shape
  slider, a 120 × 120 px mini figure (front view only, same live model) docks at the top-right
  under the top bar, on a `--lm-raised` circle-cornered plate (radius lg, shadow pop). It fades
  out 1.5 s after the last slider input. Tapping it scrolls back to the stage.
- Setup mode (first run): the sections render one at a time (basics → shape → habits) with a
  bottom action bar holding "Next: shape" (solid Key) and a 3-segment progress scale in the top bar.
- Handles on the figure are hidden on touch until "Adjust on figure" (switch in the stage bar) is
  on, so vertical page scrolls over the figure never change the body.

## 4. Layout — desktop (1440 px)

```
┌────┬──────────────────────────────────────────────────────────────────────────────────────────┐
│ ●  │ Your body                                                          saved on this device   │ context bar 56
│    ├──────────────────────────────────────────────────────────────────────────────────────────┤
│body│ ┌ Basics ─────── 320 ┐ ┌ Figure ────────────────── flexible ┐ ┌ Shape ───────── 372 ┐   │
│sim │ │ units KeyBank       │ │ front · side      visceral [○ ]    │ │ body fat   28.4 %    │   │
│plan│ │ sex KeyBank         │ │ ····························      │ │ ▕scale▏ ░likely░     │   │
│evid│ │ age    Stepper      │ │ 200┤                               │ │ where it sits        │   │
│    │ │ height Stepper      │ │ 178┼─   ◯            ◯            │ │  belly & waist       │   │
│    │ │ weight Stepper      │ │    │  ╱█╲ handles   ██▌           │ │  hips & thighs       │   │
│    │ │ figure base KeyBank │ │ 100┤  │███│ (hover) ███            │ │  chest · drawing only│   │
│    │ └─────────────────────┘ │    │   █ █          █             │ │  arms  · drawing only│   │
│    │ ┌ Habits ─────── Edit ┐ │  50┤   █ █          █▄            │ │ muscle               │   │
│    │ │ training history    │ │     front          side            │ │  upper · lower       │   │
│    │ │ training type       │ │ Illustrative figure. …             │ │ waist                │   │
│    │ │ typical steps       │ └────────────────────────────────────┘ │  use measurement [○] │   │
│    │ │ sleep · stress      │ ┌ Estimates  live · likely range … ──┐ │  waist at the navel  │   │
│    │ └─────────────────────┘ │ body fat 28.4 %   │ fat mass 24.1 kg│ └──────────────────────┘   │
│ ⚙  │                         │ lean mass 60.8 kg │ maint. 2 541    │                            │
│ ◐  │                         └────────────────────────────────────┘                            │
└────┴──────────────────────────────────────────────────────────────────────────────────────────┘
 grid: 320 | minmax(0,1fr) | 372, 16 px gaps, 24 px page gutters, max 1440
```

- **1280–1439**: same three columns, the figure column shrinks (min 480).
- **1024–1279** and **tablet 768–1023**: two columns — left `minmax(0,1fr)`: Figure, Estimates,
  Basics; right 360: Shape, Habits. Shape stays visible next to the figure (the main interaction).
- The Figure stage height: `clamp(340px, 58vh, 560px)`; the figure scales to fit (SVG
  `preserveAspectRatio="xMidYMid meet"`, shared cm scale for both views).

## 5. Regions & components

| Region | Components | Content | Tokens of note |
|---|---|---|---|
| Context bar | ContextBar | "Your body" (display 30/24) · save status (engraved) | `--lm-chassis-2` desktop, `--lm-chassis` mobile |
| Basics | Faceplate, KeyBank ×3, Stepper ×3 | units, sex, age, height, weight, figure base | Stepper values `readout` utility |
| Figure | Faceplate `flush`, BodyAvatar (both views), AvatarHandles, Switch | height ruler, front + side, caption | `stage-dots`, `--lm-avatar-*` |
| Estimates | Faceplate, Readout ×4, RangeBar | body fat %, fat mass, lean mass, maintenance | `--lm-readout-md` 32 px, wide tabular |
| Shape | Faceplate, ScaleSlider ×8, Switch, InlineWarning | fat, distribution ×4, muscle ×2, waist | scale wells `--lm-well`, needle `--lm-ink` |
| Habits | Faceplate (summary list) → Sheet/Drawer editor | training years, sessions/week, type mix, steps, sleep window + quality, stress, cycle tracking | — |
| Mini figure (mobile) | BodyAvatar `display`, front only | live | `--lm-shadow-pop` |

## 6. Content & copy

**Titles**: "Your body" · faceplates "Basics", "Figure", "Estimates", "Shape", "Habits".

**Basics**
- units KeyBank: `metric | imperial` (imperial: height ft + in two fields, weight lb; energy stays
  kcal unless Settings says kJ).
- `sex for the physiology equations` → `female | male | prefer not to say`. Helper under
  "prefer not to say" (only when selected): "We'll average the female and male equations, so ranges
  are a little wider."
- `age` Stepper 18–90 yrs (under 18 is blocked earlier, in screening).
- `height` 140–210 cm (4 ft 7 in – 6 ft 11 in) · `weight` 35–250 kg (77–551 lb), step 0.1.
- `figure base · only changes the drawing` → `female | neutral | male`. Defaults to the sex
  choice (neutral for "prefer not to say") until the user presses a key; then it stays independent.

**Figure**
- Stage bar: "Figure" · engraved "front · side · drag the figure's edges to adjust" (pointer) /
  "front · side" (touch) · Switch `visceral` · (touch only) Switch `adjust on figure`.
- Caption: "Illustrative figure. Shows proportions from your inputs, not your exact shape."
- Handle tooltips while dragging: "belly & waist · 41 % of fat", `⇧`: "upper muscle · trained".

**Shape**
- `body fat` 4–60 %, step 0.1, numerals every 10 (5, 15, …), readout `28.4 %`, likely-range
  underlay. Helper (only while untouched): "Start from our estimate, then match the figure to how
  you look."
- Group "Where it sits": `belly & waist`, `hips & thighs`, `chest`, `arms`, each −1…+1 with
  numerals `less · typical · more`; readout is the region's **share of your fat** (`41 % of fat`)
  — a number that means something, instead of an abstract slider value. Chest and arms carry the
  helper "changes the drawing, not the estimate" (dossier 14: avatar-only re-allocation).
- Group "Muscle": `upper body`, `lower body`, 0…1, numerals `untrained · trained · very muscular`,
  readout words: untrained (< .2) · some training (< .45) · trained (< .7) · very trained (< .9) ·
  exceptional.
- Group "Waist": Switch `use measurement` + ScaleSlider `waist at the navel` 55–160 cm (22–63 in),
  step 0.5, locked (lock icon, 55 % opacity) until the switch is on. Helper: "Optional. A tape
  measure at the navel narrows the body-fat range and sets where fat sits." When on, the belly
  slider locks with "set by your waist measurement · unlock" (tap = turns the switch off).
- Key "Reset to estimate" (quiet) — restores estimator defaults for fat, distribution and muscle.

**Estimates** (engraved title line: "live · likely range = 80 % of people like you")

| Readout | Example | How line |
|---|---|---|
| body fat | **28.4 %** · likely 23.7–33.1 | "From your figure and weight. Add a waist measurement to narrow the range." → with waist: "From your figure, weight and waist. A DEXA scan would narrow this to about ±3 points." |
| fat mass | **24.1 kg** · likely 20.1–28.1 | "Body fat × weight." |
| lean mass | **60.8 kg** · likely 56.8–64.8 | "Everything that isn't fat: muscle, organs, bone, water, glycogen." |
| maintenance | **2 541 kcal/day** · likely 2 313–2 770 | "Resting energy from lean mass, × your activity: 8 400 steps, 4 sessions a week." |

Ranges use the dossier-14 fusion (figure alone ≈ ±6 points at 80 %, figure + waist ≈ ±4.5).
Unknown state: readout "—" with "needs weight".

**Habits** (summary rows, "Edit" opens the editor Sheet/Drawer):
- `training history` KeyBank `none · < 1 yr · 1–3 yrs · 3+ yrs` + Stepper `sessions/week` 0–14.
- `training type` ScaleSlider `lifting ↔ cardio` (0–100 %).
- `typical steps` ScaleSlider 1 000–25 000 with reference tick "typical for your age: 7 000".
- `sleep` ScaleRange bed/wake (clock times) + KeyBank quality `poor · fair · good`.
- `stress` KeyBank `low · moderate · high`.
- (female physiology only) Switch `track menstrual cycle` + cycle length Stepper 21–40 d + last
  period start date — helper: "Lets the model account for cycle-related water and appetite
  changes. Stays on this device."

**Validation** (inline under fields, `--lm-danger-fg` text + icon):
- "Height must be 140–210 cm." · "Weight must be 35–250 kg." · "Age must be 18–90."
- Plausibility (caution, not error): BMI < 16 or > 60 → "Check this weight — it's outside the range
  our equations were built on. Projections will show wider ranges."

## 7. Interactions

**Shaping the figure (pointer)**
1. Drag anywhere on a scale well → the needle jumps to the pointer and follows; figure and all
   four readouts update every frame (rAF); readout digits roll.
2. Release → value snaps to step with needle ease (420 ms).
3. Hover the stage → four handles (waist, hips, chest, arm) fade in (140 ms). Drag a handle
   horizontally: ±1 of the region's distribution per 60 px; `⇧`-drag on hips/chest/arm changes the
   matching muscle slider (0–1 per 120 px). Vertical drag on the figure body changes body fat (±10
   points per 100 px). The matching ScaleSlider moves in sync and its readout highlights.
4. Double-click a slider readout → inline number entry (Enter commits, Esc cancels).

**Touch**
- Scale wells use `touch-action: pan-y`: horizontal drags adjust, vertical drags scroll the page.
- Relative drag on touch (the needle moves by the finger's delta, not to the finger), so a tap
  near the needle never jumps the value.
- Handles only when "adjust on figure" is on; while on, the stage shows a 1 px ink frame and page
  scroll over the stage is disabled.

**Keyboard**
- Tab order: units → sex → age → height → weight → figure base → (figure is skipped: handles are
  aria-hidden) → visceral → Shape sliders top to bottom → waist switch → waist → Habits Edit.
- Sliders: ←/→ step · `⇧` ×10 · PgUp/PgDn major tick · Home/End.
- Steppers: ↑/↓ = step, `⇧` ×10; typing commits on Enter/blur.

**Autosave**: every change writes to the body store (debounced 300 ms); the context bar shows
"saved on this device" (engraved) and briefly "saving…" during the debounce.

**Body changed after scenarios exist**: on the next visit to Simulator, an info Banner: "Your body
changed on 12 Oct (weight 84.9 → 83.6 kg). Update this scenario's starting point?" [Update]
[Keep the old start]. Plans show "stale" until re-run.

## 8. States

| State | Behaviour |
|---|---|
| First run (setup) | Estimator defaults from sex/age/height/weight (population medians); figure neutral base until sex chosen; body-fat helper visible; "Next" keys. |
| Skipped shape | Figure shows the estimator default; estimates carry an info chip "based on averages · refine" that deep-links here. |
| Imperial | All inputs convert both ways without drift (store metric, display rounded: 0.5 in, 0.1 lb). |
| Extreme values | Figure stays well-formed from 4–60 % fat and 140–210 cm (AVATAR_SPEC §9); readouts clamp; caution copy for implausible BMI. |
| Waist pin unreachable | If the pinned waist needs a distribution beyond ±1, body fat is nudged and an InlineWarning says: "Your waist suggests about 31 % body fat — we moved the estimate." |
| Show figure off (Settings or gentle mode) | Figure faceplate replaced by a compact Faceplate: "Figure hidden. Your estimates still use the shape sliders." Sliders remain; handles gone. |
| Gentle mode | Figure hidden by default; weight and body-fat readouts collapsed behind "show numbers" (not removed); lean mass, maintenance and habits lead. |
| Storage unavailable | Top Banner (caution): "This browser isn't saving. Your body will reset when you close the tab. Export your data from Settings to keep it." |

## 9. Accessibility

- Sliders are native `input[type=range]` with `aria-valuetext` including units and meaning:
  "belly and waist: 41 percent of your body fat", "body fat 28.4 percent, likely 23.7 to 33.1".
- The figure is `role="img"` with a generated `aria-label` (AVATAR_SPEC §7.8) updated on release,
  not per frame. Handles are `aria-hidden`; everything they do is reachable via sliders.
- Estimates region is `aria-live="polite"`, updated on slider release (not on every frame) to
  avoid chatter.
- Targets: steppers 44 px on touch; scale wells 28 px tall with the full 44 px row as hit area.
- Reduced motion: no digit roll, no needle overshoot, no mini-figure fade.
- Colour: the figure's two layers differ in lightness (fat ≈ L .88, lean ≈ L .62 in light), not
  only hue; the stage caption states what the layers are for screen readers:
  "Inner shape: lean tissue. Outer layer: fat."

## 10. Decisions & rationale

- **Share-of-fat readouts** on distribution sliders replace meaningless −1…+1 values and make the
  "moving fat takes it from elsewhere" rule (renormalisation) visible.
- **Chest and arms are drawing-only** and say so, because the estimator (dossier 14) uses one
  belly-vs-hips axis. Honesty over apparent precision.
- **Sex and figure base are separate controls** so physiology and self-image are not forced to
  match; neutral is a first-class base, not a fallback.
- **Handles are shortcuts, sliders are truth** — accessible, precise, and consistent on touch.
- **No BMI shown.** It adds nothing the estimates don't, and invites category labels.
- **Maintenance lives here**, not only in the simulator, because users check it constantly and it
  anchors every "% of maintenance" in the schedule.
