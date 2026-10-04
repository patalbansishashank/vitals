# Vitals — Parametric Body Avatar

> The figure on **Your body**, in the Simulator's before/after morph and on plan cards.
> Reference implementation: `prototype/avatar.js` (pure functions, no dependencies) — port it to
> `src/features/body/avatar/` as-is, then refine.
>
> **v0.2 (2026-10-01): read §11 first.** The figure becomes a fitted 3D mannequin with this SVG
> figure as its fallback, "figure base" is replaced by **Frame**, and the visceral ellipse is
> replaced by a separate visceral view. Screen behaviour: `screens/body-figure-v2.md`. Where §11 and
> earlier sections disagree, §11 wins.

---

## 1. What the figure is for

- **Input**: a tactile way to describe shape (fat level, where it sits, muscularity) without
  anthropometry jargon. The sliders are the accessible source of truth; the figure answers
  "does this look like me?" and offers direct-manipulation handles.
- **Output**: a before → after morph showing *how* composition changes (fat envelope shrinking
  vs. lean core growing), not a beauty rendering.
- It is **illustrative**: it communicates proportions, not a portrait. The caption always says so.

Visual idea: a **two-layer, DEXA-inspired figure** — a solid **lean core** (muscle, organs, bone)
inside a frosted **adipose envelope**. The gap between them *is* subcutaneous fat. The user sees
fat and muscle as two different materials, which is exactly what the simulator models.

---

## 2. Parameters

| Parameter | Range | Default | Source | Drives |
|---|---|---|---|---|
| `base` | `female` · `neutral` · `male` | from sex; neutral if sex = "prefer not to say"* | Key bank "figure base" | core template (§3) |
| `heightCm` | 140–210 | entered | Stepper | vertical scale; widths × (H/175)^0.5 |
| `weightKg` | 35–250 | entered | Stepper | with body fat → fat mass → FMI |
| `bodyFatPct` | 4–60 | estimate from BMI/sex/age (Deurenberg-style) until the user moves it | ScaleSlider "body fat" | envelope thickness everywhere |
| `dist.abdomen` | −1…+1 | M +0.35 · F −0.20 · N 0 | ScaleSlider "belly & waist" | regional multiplier |
| `dist.hips` | −1…+1 | M −0.25 · F +0.40 · N 0 | "hips & thighs" | regional multiplier |
| `dist.chest` | −1…+1 | M 0 · F +0.15 · N 0 | "chest" | regional multiplier |
| `dist.arms` | −1…+1 | M 0 · F +0.05 · N 0 | "arms" | regional multiplier |
| `muscle.upper` | 0…1 | from training history (untrained 0.15, 1–3 y 0.4, 3 y+ 0.6) | "upper-body muscle" | core widths above the waist |
| `muscle.lower` | 0…1 | same rule | "lower-body muscle" | core widths below the waist |
| `waistCm` | 50–180 (optional) | — | Stepper "waist (optional)" | pins waist girth; derives `dist.abdomen` |
| `showVisceral` | bool | false | Switch | draws visceral ellipse |

\* Physiology needs a sex for equations; if the user chooses "prefer not to say", the engine uses
the average of both equations with a wider range, and the figure uses the neutral base. The
**figure base is independently selectable** — a user may enter female physiology and choose the
neutral figure, or vice versa. Copy: "figure base — only changes the drawing".

Derived:
```
fatMassKg = weightKg × bodyFatPct / 100
FMI       = fatMassKg / (heightCm/100)²                 // fat-mass index, kg/m²
g         = max(0.25, FMI − 1.5)                        // visible subcutaneous "fatness"
m_r       = 1 + 0.6 × dist_r                            // r ∈ {abdomen, hips, chest, arms}
m_r      ← m_r / Σ_r(w_r × m_r)                         // renormalise: redistribution preserves total
            with w = {abdomen .34, hips .38, chest .14, arms .14}
```
The renormalisation is what makes the distribution sliders honest: moving fat to the belly takes
it from elsewhere; only **body fat** changes the total.

**Waist pin**: when `waistCm` is set, solve for `dist.abdomen` such that the modelled waist
girth (ellipse approximation from front half-width `a` and side half-depth `b`:
`π(3(a+b) − √((3a+b)(a+3b)))`) equals `waistCm` (bisection, 12 iterations, clamp to −1…+1). The
belly slider shows a lock icon and caption "set by your waist measurement · unlock". If the pin
can't be met within the clamp, the body-fat slider is nudged and a caption explains it:
"Your waist suggests about 28 % body fat — we moved the estimate."

---

## 3. Geometry model

### 3.1 Coordinates
Units are centimetres. Front view: x = left/right from the midline, y = height above the floor
(y up; flip when drawing SVG). Side view: x = anterior (+) / posterior (−) from the plumb line
through the ankle. Stations are fixed fractions of height `H`.

### 3.2 Front view — torso stations (half-widths of the **lean core** at H = 175)

| Station | y / H | Male | Female | Fat k (cm per g) | Fat region | Muscle (upper/lower) cm |
|---|---|---|---|---|---|---|
| neck | .853 | 5.6 | 4.9 | .10 | chest | upper +0.9 (traps) |
| shoulder | .818 | 19.6 | 17.0 | .10 | arms | upper +3.2 (deltoid cap) |
| chest (armpit) | .735 | 15.6 | 13.9 | .32 | chest | upper +2.3 (lats/pecs) |
| underbust | .680 | 14.2 | 12.6 | .28 | chest .5 / abdomen .5 | upper +1.3 |
| waist | .625 | 12.9 | 11.2 | .60 | abdomen | upper +0.4 |
| abdomen | .585 | 13.3 | 12.9 | .70 | abdomen .8 / hips .2 | — |
| hip | .520 | 15.3 | 16.6 | .55 | hips | lower +1.1 |
| crotch-outer | .475 | 15.2 | 16.3 | .60 | hips | lower +1.5 |

Neutral = mean of male and female columns. Every width is multiplied by `(H/175)^0.5` (frame
scales sub-linearly with height).

Envelope half-width at a station: `E = C + k × g × m_region`, where C is the core half-width
(template + muscle term).

### 3.3 Front view — legs (per leg; `cx` = leg centre offset from midline)

| Station | y / H | cx M/F | core half-width M/F | Fat k outer / inner | Muscle lower |
|---|---|---|---|---|---|
| upper thigh | .440 | 8.2 / 8.6 | 7.4 / 7.9 | .55 / .38 | +1.9 |
| mid-thigh | .370 | 7.8 / 8.0 | 6.4 / 6.6 | .40 / .30 | +1.6 |
| above knee | .315 | 7.4 / 7.4 | 5.1 / 5.2 | .20 / .18 | +0.9 (inner teardrop: apply to inner side only) |
| knee | .285 | 7.2 / 7.0 | 4.6 / 4.5 | .08 / .08 | +0.2 |
| calf | .210 | 7.0 / 6.8 | 5.2 / 4.8 | .16 / .14 | +1.4 (outer .6, inner .8) |
| ankle | .055 | 6.8 / 6.6 | 2.7 / 2.4 | .03 / .03 | — |
| foot | .000–.025 | 7.4 / 7.1 | 3.4 / 3.1 | — | — |

Thigh gap is emergent: inner envelopes of both legs are clamped at x ≥ 0.4 cm, so with enough
hip/thigh fat the thighs meet and the contour merges smoothly (no overlap artefacts).

### 3.4 Front view — arms (per arm)
The arm hangs in a relaxed A-pose, axis from the shoulder joint `(shoulderHW − 4.2, .812H)`
at **11°** from vertical (so the waist stays visible for all body sizes; the angle opens to 16°
when envelope width at the waist exceeds 20 cm, keeping arms clear of the torso).

| Station | s along arm (0 shoulder → 1 wrist, length .335H) | core half-width M/F | Fat k | Muscle upper |
|---|---|---|---|---|
| deltoid | .04 | 5.0 / 4.3 | .12 | +1.7 |
| upper arm | .30 | 4.2 / 3.7 | .32 | +1.5 (biceps/triceps) |
| elbow | .52 | 3.2 / 2.9 | .10 | +0.2 |
| forearm | .64 | 3.6 / 3.1 | .12 | +0.8 |
| wrist | .92 | 2.3 / 2.0 | .03 | — |
| hand | 1.00–1.16 | 3.3 / 3.0 → rounded tip | — | — |

Arm fat uses `m_arms`.

### 3.5 Head
An ellipse, centre `y = .935H`, radii `rx 7.4 (M) / 7.0 (F)`, `ry 11.2`, scaled by `(H/175)^0.5`
horizontally and `H/175` vertically. A plain, featureless form; same material as the lean core,
no envelope (facial fat is not modelled). Neck joins with a smooth fillet.

### 3.6 Side view (profile section — arms omitted by design)

| Station | y / H | anterior M/F | posterior M/F | Fat k ant / post | Fat region | Muscle |
|---|---|---|---|---|---|---|
| neck | .853 | 5.0 / 4.6 | 5.2 / 4.8 | .08 / .08 | chest | — |
| shoulder | .818 | 7.6 / 6.9 | 8.4 / 7.6 | .10 / .12 | chest | upper: ant +1.0, post +1.5 |
| chest | .735 | 10.6 / 9.6 | 9.0 / 8.2 | .45 / .20 | chest | upper: ant +1.8 (pecs), post +1.6 (lats) |
| underbust | .680 | 9.2 / 8.4 | 7.9 / 7.2 | .45 / .20 | chest .5 / abdomen .5 | upper: ant +0.8 |
| waist | .625 | 8.2 / 7.4 | 6.9 / 6.4 | .95 / .22 | abdomen | — |
| belly | .580 | 8.6 / 8.2 | 7.4 / 7.8 | 1.15 / .30 | abdomen | — |
| glute | .520 | 7.8 / 8.0 | 10.2 / 11.4 | .40 / .62 | hips | lower: post +1.8 |
| crotch | .475 | 7.0 / 7.2 | 9.4 / 10.4 | .30 / .55 | hips | lower: post +1.2 |
| thigh | .420 | 7.8 / 7.8 | 6.6 / 7.0 | .35 / .35 | hips | lower: ant +1.5, post +1.0 |
| above knee | .320 | 6.3 / 6.1 | 5.3 / 5.2 | .18 / .15 | hips | lower: ant +0.7 |
| knee | .285 | 5.1 / 4.9 | 4.5 / 4.3 | .06 / .06 | — | — |
| calf | .210 | 4.1 / 3.9 | 6.3 / 5.8 | .10 / .18 | hips | lower: post +1.3 |
| ankle | .055 | 3.0 / 2.8 | 2.6 / 2.4 | — | — | — |
| foot | .000–.03 | toe +17.5 / +16.0 | heel −4.2 / −3.8 | — | — | — |

Female base adds a **bust volume** at the chest station: `ant += 2.2 + 0.35 × g × m_chest`
(front view: `+0.6` half-width at chest). Neutral adds half of that. Male base has none.

**Belly sag**: with high abdominal fat the belly's widest point moves down and forward:
`belly.y = (.580 − 0.004 × max(0, g×m_abdomen − 4)) × H`. This, and the smoothing in §4, is what
makes fat read as fat rather than as "bigger muscles".

---

## 4. Fat vs muscle — how the eye tells them apart

1. **Two materials.** Lean core: `--lm-avatar-lean` solid fill. Adipose envelope:
   `--lm-avatar-fat` fill, 1.25 px `--lm-avatar-outline` edge. Core drawn on top of envelope.
   The envelope is slightly translucent in dark mode (opacity .92) so the core reads through.
2. **Different curvature.** Muscle terms are applied at specific stations only (deltoid cap,
   biceps, quad teardrop, calf belly, glutes, lats) → local, higher-frequency bumps. Fat terms are
   **low-pass**: the envelope's thickness profile is smoothed with a 3-station moving average
   (weights .25/.5/.25) before being added, so fat rounds and fills the contour and *washes out*
   the core's bumps as it grows — exactly what happens on real bodies.
3. **Definition strokes.** 8 short interior strokes on the core (pec line, linea alba, deltoid
   separation ×2, quad teardrop ×2, calf split ×2), 1 px `--lm-avatar-definition`, opacity
   `clamp(0, 1, (muscle − 0.25) × 1.6) × clamp(0, 1, 1 − (g − 2) / 5)` — visible only when muscular
   *and* lean. Never shaded like anatomy art; these are single hairlines.
4. **Direction of change in the morph.** Fat loss shrinks the envelope toward the core; muscle gain
   pushes the core outward (and the envelope with it). In the morph the **ghost** (start state) is
   the envelope outline only, so the user sees which layer moved.
5. **Labels while dragging.** Handle drags show a floating caption: "belly fat +12 %" vs
   "upper muscle +0.1".

---

## 5. Rendering

- One `<svg>` per view, `viewBox` in centimetres: front `−45 0 90 215`, side `−30 0 60 215`
  (y flipped by `transform="scale(1,-1) translate(0,-215)"` inside a group). Both views share the
  same vertical scale so heights compare.
- Paths: sample stations → points (mirrored for the front view) → **centripetal Catmull-Rom →
  cubic Bézier** (α = 0.5) → `d` string. ~120 points per view; generation < 0.3 ms.
- Draw order: stage (perforated `stage-dots` background + height ruler) → envelope (torso+legs,
  then arms) → core (torso+legs, then arms) → head → definition strokes → visceral ellipse (if
  on) → handles (edit mode) → ghost outline (morph mode).
- Front torso+legs outline is one closed path: neck-L → shoulder-L → chest-L → … → crotch-outer-L
  → leg-L outer stations → foot → leg-L inner stations back up → crotch point (0, .47H) → mirror.
  Arms are separate closed paths drawn after the torso (outer side down, inner side up).
- Height ruler: 1 px `--lm-line-strong` vertical at the stage's left, ticks every 10 cm
  (6 px), numerals every 50 cm (11 px condensed ink-3), a 1 px ink tick at the user's height with
  the value ("178 cm").
- Updates: sliders write params → `requestAnimationFrame` → recompute both views. Keyboard steps
  and preset jumps tween params over `--lm-dur-needle` with `--lm-ease-needle`; pointer drags are
  1:1 with no tween.
- Size: front and side side-by-side, stage 16:10 on desktop (figure height 420 px), 4:5 on mobile
  (figure height 300 px); a `view` KeyBank (`front · side · both`) on mobile defaults to `both`
  (both fit at 375 px: each view ~150 px wide).

### 5.1 Visceral layer
When `showVisceral` is on: an ellipse centred at the belly station, inside the core, radii
`rx = 0.55 × core half-width × v`, `ry = 0.06H × v`, where `v = visceral index / 100` from the
engine (Your body uses the estimator; Results uses the projected value). Fill
`--lm-avatar-visceral` @ 70 %, no outline; caption "visceral fat (estimated)". Side view shows it
as the anterior half of the same ellipse.

---

## 6. Before / after morph (Results + Plan details)

- The morph panel sits beside the readout strip (desktop) or below it (mobile): front + side
  views, a date scrubber under the figure, and a Play key.
- **Linked to the chart**: the figure shows the state at the crosshair date; with no crosshair,
  it shows the end state. The **start state** is always visible as a ghost envelope outline
  (1 px `--lm-avatar-ghost`, 60 % opacity).
- Interpolation: both states produce the same point topology; interpolate each point linearly
  for scrubbing (`t` from the date), and for Play animate `t` 0 → 1 over `--lm-dur-morph` (900 ms,
  `--lm-ease-in-out`), or step week by week (120 ms per week) when "weekly steps" is on.
- Captions under the figure: "start 24.1 kg fat · 60.8 kg lean" → "end 19.8 · 61.0" with
  signed deltas. No "before/after" wording; use "start" and "day 84".
- Plans: each plan card shows a 64 px-high end-state front silhouette (envelope only, outline,
  no core) next to the scorecard — optional, off by default for users in gentle mode.

---

## 7. Respectful representation — rules

1. **Material, not skin.** The figure uses neutral, cool material colours (`--lm-avatar-*`). No
   skin tones, no hair, no faces, no nipples, no navel, no genital detail, no clothing.
2. **Same pose for every body.** Relaxed A-pose, level shoulders, feet hip-width. Posture never
   changes with size or over time (no slumping "before", no proud "after").
3. **No judgement encoded.** Fat is not red, not grey-and-sad, not blurred; muscle is not gold.
   No ideal-body overlay, no silhouettes of "targets", no BMI category words anywhere near the
   figure.
4. **Every body renders well.** Tested across the full parameter box (4–60 % fat, 140–210 cm,
   all distributions, both muscle extremes): no self-intersections, no pinched joints, arms stay
   clear of the torso, thighs merge smoothly. Automated visual tests at 27 corner cases.
5. **Base is a drawing choice.** "Figure base: female · neutral · male" is labelled as changing
   only the drawing. Neutral is a first-class option, not a fallback.
6. **Opt out.** A "show figure" switch on Your body (and in Settings) hides the avatar everywhere
   and replaces it with the numeric readouts. **Gentle mode** (offered when screening mentions an
   eating-disorder history) hides the figure and body-weight numbers by default and emphasises
   non-weight outcomes (see `screens/onboarding-safety.md`).
7. **Caption, always.** Under the figure: "Illustrative figure. Shows proportions from your
   inputs, not your exact shape."
8. **Accessible description.** `role="img"` with a generated `aria-label`: "Figure, neutral base,
   178 cm. Estimated body fat 23 %, weighted toward the belly. Moderate upper-body muscle,
   light lower-body muscle."

---

## 8. Handles (direct manipulation)

| Handle | Position | Horizontal drag | `⇧` + drag |
|---|---|---|---|
| waist | right edge of envelope at waist station | `dist.abdomen` (±1 over 60 px) | — |
| hips | right edge at hip station | `dist.hips` | `muscle.lower` |
| chest | right edge at chest station | `dist.chest` | `muscle.upper` |
| arm | outer edge of right upper arm | `dist.arms` | `muscle.upper` |
| (whole figure) | vertical drag on the envelope body | `bodyFatPct` (±10 % over 100 px) | — |

- Caps: 12 px round, raised, 1 px `--lm-edge`, with a 4 px ink centre dot; 44 px hit areas.
  Visible on hover over the stage (pointer) or when "adjust on figure" is on (touch).
- While dragging, the matching slider animates in sync and its readout highlights.
- Handles are `aria-hidden`; the sliders are the accessible controls.

---

## 9. Test matrix (engineering)

27 corner cases = {fat 4 %, 25 %, 60 %} × {distribution all −1, 0, all +1 per region pair} ×
{muscle 0, 1} sampled, × {female, neutral, male} bases → snapshot SVGs; assert: no path
self-intersection (sampled), arm–torso clearance ≥ 0.5 cm, monotone y in each contour, and
envelope ≥ core at every station.

---

## 10. Engine coupling (research dossier 14, read 2026-09-30)

`research/14-anthropometrics-fat-distribution.md` (M2, M3, M8, M10) arrived while this spec was
written. It agrees with the approach (own parametric SVG, front + side, no mesh licences) and adds
three things engineers must wire in:

1. **Slider semantics.** The engine reads a *fat* slider and a *muscle* slider as coordinates in the
   (FMI, FFMI) plane with BF % anchors (dossier table T2/T3), and a single **belly-vs-hips** slider
   (`s_b ∈ [−1, 1]`, z-score of the trunk:limb fat ratio). Map our controls as follows:
   `body fat` → fat slider; `upper/lower muscle` → mean gives the muscle slider, their difference is
   drawing-only; `belly & waist` minus `hips & thighs` (after renormalisation) → `s_b`;
   **`chest` and `arms` are drawing-only** ("avatar-only re-allocation" in the dossier). The UI says
   so in their helper text: "changes the drawing, not the estimate".
2. **Uncertainty of the estimate.** Body-fat is fused from equations, the figure (σ ≈ 5.5 % BF on
   its own), waist and training history (dossier M3). Show the fused 80 % range: typical adult with
   figure + waist ≈ ±4.5 points; figure only ≈ ±6; a known DEXA value ≈ ±3. The copy on the
   estimate always names the input that would narrow it most (usually waist, then training years).
3. **Circumference-driven geometry (v1.1).** Once the engine exposes circumferences (M8), replace the
   FMI-thickness envelope with the dossier's cross-section model: each station's envelope half-width
   `a = C / (π k(ρ))` and side depth `2b = 2ρa` split by the front fraction `φ`, with ρ/φ from the
   dossier table (waist ρ rises with visceral fraction). Keep the lean core from §3 and the
   smoothing/curvature rules from §4 — they are what make fat and muscle read differently. The
   prototype's FMI model has the same point topology, so the morph and handles do not change.

---

## 11. v0.2 changes (figure v2, Frame, visceral view)

### 11.1 Renderer
- **3D (default where available)**: a decimated, closed MakeHuman-derived mannequin (CC0 assets,
  ≈ 3 500 vertices; no genital detail, smooth chest, no nipples, navel, face or hair), drawn by a
  small in-house WebGL renderer with CPU morphing; lazy chunk ≤ 300 kB gz; ≥ 55 fps while morphing
  on a mid-range phone; two fixed orthographic views (front, side) in one canvas, one cm scale; no
  orbit or zoom. Ruler, labels, handles and captions stay an **SVG overlay** (real pixels,
  keyboard-accessible).
- **Materials**: lean core opaque `--lm-avatar-lean` (matte); fat envelope `--lm-avatar-fat` at
  alpha 0.5 (light) / 0.4 (dark) with a fresnel rim in `--lm-avatar-outline`; ghost = start
  envelope as a rim-only pass. Colours are read from CSS tokens at mount (both themes).
- **Fitting**: the engine's girths (neck, chest, waist, hip, thigh, calf, arm) are fitted within
  1 cm; muscle and weight macros start from FFMI/FMI; local targets absorb residuals (waist depth
  carries visceral fat). Shoulder breadth and taper are **not** fitted — they belong to Frame.
- **SVG (this spec, §1–§10)** remains the fallback and the renderer for: first paint, no WebGL or
  lost context, slow devices (< 30 fps over the first 60 morph frames, remembered), data saver,
  print, and all small sizes (plan-card silhouettes, mini figure, glyphs). Both renderers take the
  same parameters.

### 11.2 Parameters
| v0.1 | v0.2 |
|---|---|
| `base: female · neutral · male` | **`frame: 0–1`** (0 hips-led … 1 shoulders-led), drawing only; null = match basics (female 0, male 1, prefer not to say 0.5). Stored synced as `profile.figure.frame` (code name `figureFrame`, distinct from the engine's `frameZ`). |
| per-base distribution defaults (§2) | distribution defaults come from the estimator (physiology), never from the drawing |
| female bust volume (§3.6) | follows the chest slider and the engine's chest share of subcutaneous fat, for every frame |
| neutral = mean of male and female templates | frame blends the two skeletal templates continuously (the geometry already mixes them) |
| `showVisceral` ellipse (§5.1) | **removed**. Visceral fat shows on the figure only as the deeper front-to-back waist; it is drawn in the visceral view (§11.4) |

"Prefer not to say" physiology averages both equation sets and never reads `frame`.

### 11.3 Rules that change
- §7.5 becomes: **Frame is a drawing choice.** One continuous control labelled "frame" with ends
  "hips-led" and "shoulders-led" and silhouettes; no sex or gender words anywhere on or near it;
  helper "Only changes the drawing. Your estimates don't change."
- §7.8 description drops the base: "Figure, 178 cm, shoulders a little wider than hips. Estimated
  body fat 23 %, weighted toward the belly. …" (the frame phrase is the FrameSlider bin word).
- §6 timing: Simulator Play sweeps day 1 → last day in 2.2 s (ease-in-out); `--lm-dur-morph`
  (900 ms) stays for short morphs (preset jumps, plan-card start → end).
- §9 test matrix: replace "× {female, neutral, male} bases" with "× frame {0, 0.5, 1}"; add the
  fitted-girth check (≤ 1 cm) and monotone tests (more trunk fat → wider waist; more muscle →
  wider shoulders, arms, thighs) across the 3D test bodies; add five-bin reachability for Frame.

### 11.4 Visceral view (new component, SVG only)
`<VisceralView>` = `<SideCutaway>` + `<CrossSection>` (`COMPONENTS.md §13.4`), drawn to scale from
the engine's `visceral{…}` block: subcutaneous ring, muscle wall with psoas and spine, organ region
with stylised loops, lobulated visceral fill (equal-area), uncertainty halo (80 % range), reference
rings at 100 and 130 cm², start ghost when comparing. Tokens: `--lm-avatar-fat`,
`--lm-avatar-wall`, `--lm-avatar-organ`, `--lm-avatar-organ-line`, `--lm-avatar-visceral`,
`--lm-avatar-halo-alpha`. It follows the figure's timeline (`lerpAvatarParams`), re-fitting the
fill each frame. Full behaviour and copy: `screens/body-figure-v2.md §6`.
