# Screen — Your body · figure v2, Frame, visceral view (`/body#figure`, `#visceral`; also Simulator results, plan ladder, Progress)

> v0.2 (2026-10-01). Replaces the figure parts of `your-body.md` (Basics "figure base" key bank,
> the `visceral` switch, the blob) and updates `AVATAR_SPEC.md` (see its v0.2 section). Research:
> figure, visceral view and body-type picker (R2). Engineering package: the MakeHuman-based WebGL
> figure, fitter, Frame contract and visceral section (E14). Components: `COMPONENTS.md §13.3–13.4`.
> Everything not mentioned here in `your-body.md` stays as specified there.
> All numbers, names and dates in this spec are synthetic examples, not real data.

## 1. Purpose

Make the figure read as a person at a glance — a calm, featureless mannequin, not a stack of
shapes — while staying an honest instrument: it is fitted to the engine's girths, it morphs with
the simulation, and it never pretends to be a portrait. Replace the "female / neutral / male"
drawing choice with a single **Frame** control that uses no sex or gender words. Give visceral fat
its own view — a side cutaway and a waist slice, drawn to scale, with reference marks and the
uncertainty around the estimate — instead of a blob on the belly.

## 2. Entry points & exits

| In | Out |
|---|---|
| Body (figure faceplate) · Simulator results "Figure over time" band · Plan results Overview tab (start → end) · Progress › Body · a "visceral fat" chip or Explain link anywhere (`/body#visceral`) | Evidence › body composition (from "How this is drawn") · Settings › Appearance (figure drawing, show figure) |

## 3. Layout — mobile (375 px)

```
┌──────────────────────────────────────────┐
│ Your body                         saved  │
├──────────────────────────────────────────┤
│ ┌ Figure ─────── [figure | visceral] ──┐ │ Faceplate flush; view KeyBank replaces the
│ │ ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  │ │ old visceral switch
│ │200┤                                   │ │
│ │178┼─    ◯                ◯            │ │ two fixed views, one cm scale:
│ │   │   ╭███╮            ▐██▌           │ │ front ~150 px wide, side ~110 px
│ │100┤   █████            ███            │ │ (3D canvas; ruler, labels and handles
│ │   │   ██ ██             ██            │ │  are an SVG overlay)
│ │ 50┤   ██ ██             ██▄           │ │
│ │     front               side          │ │
│ │ Illustrative figure. Shows proportions │ │
│ │ from your inputs, not your exact shape.│ │
│ └────────────────────────────────────────┘ │
│ ┌ Shape ─────────────── Reset to estimate┐ │
│ │ body fat · where it sits · muscle ·     │ │ unchanged (your-body.md §6 Shape)
│ │ waist                                   │ │
│ │ Adjust the drawing ▸                    │ │ disclosure (closed by default)
│ │   frame   [◖▯◗]▕▏▏▏▏┃▏▏▏▏▕[◗▯◖] about even│ │ FrameSlider
│ │   hips-led                 shoulders-led│ │
│ │   chest · arms · face   (drawing only)  │ │ existing drawing-only sliders move here
│ │   Only changes the drawing. Your        │ │
│ │   estimates don't change.  Match my basics│
│ └─────────────────────────────────────────┘ │
```

Visceral selected (same faceplate, same height, no page jump):
```
│ ┌ Figure ─────── [figure | visceral] ──┐ │
│ │  side            waist slice          │ │
│ │  ╭──╮         front                   │ │
│ │  │▒▒│       ╭──────────╮              │ │ cutaway 80 px wide, slice 200 px;
│ │                                       │ │ ring labels inside the frame (mobile)
│ │ ─┼▓▓┼─ ←  ╭╯ ░░░░░░░░░ ╰╮  ┄100┄130   │ │ reference rings dashed, labelled
│ │  │▒▒│     │░ ▒▓▒▓▒▓▒▓▒ ░│             │ │
│ │  ╰──╯     ╰╮ ░ ▓▓▓▓▓ ░ ╭╯             │ │
│ │             ╰────●─────╯  10 cm ├──┤  │ │ spine dot at the back, scale bar
│ │ visceral fat  about 160 cm²           │ │ Readout sm
│ │ likely 95–270 · high                  │ │ band of the estimate +
│ │ the range spans all three bands       │ │ what the range spans
│ │ ├──────┼────┼──────█───────┤           │ │ BandScale: typical | raised | high
│ │ ░ under the skin (you can pinch it)   │ │ legend, always visible
│ │ ▓ deep, around the organs (visceral)  │ │
│ │ ▒ muscle wall                         │ │
│ └───────────────────────────────────────┘ │
```

## 4. Layout — desktop (1440 px)

The three-column Body layout from `your-body.md §4` stays (Basics 320 · Figure flexible · Shape
372). Changes:
- Basics loses the "figure base" row (Frame lives in Shape › Adjust the drawing); nothing about
  the drawing sits near the sex key bank.
- The Figure faceplate's stage bar: `Figure` · engraved "front · side · drag the figure's edges to
  adjust" · view KeyBank `figure | visceral` (sm) · (touch only) Switch `adjust on figure`.
- Visceral view on desktop: cutaway 140 px wide on the left, waist slice 320 px on the right, the
  readout, band scale and legend in a column to the right of the slice (stage height unchanged:
  `clamp(340px, 58vh, 560px)`).
- **Simulator results "Figure over time"** (band under the readout strip, per REVIEW_FINDINGS #1):
  the same `figure | visceral` KeyBank; both views follow the chart crosshair.

## 5. The figure (3D with SVG fallback)

### 5.1 What it looks like
- A decimated, closed **mannequin** (about 3 500 vertices): smooth groin and chest, no nipples, no
  navel, no face, no hair, no fingers or toes detail beyond the hand and foot form. Relaxed A-pose
  (arms 8–12° from vertical), level shoulders, feet hip-width — the **same pose for every body,
  at every point in time** (AVATAR_SPEC §7.2).
- **Two materials**, as in v0.1: an opaque **lean core** (`--lm-avatar-lean`, matte clay) inside a
  translucent **fat envelope** (`--lm-avatar-fat`, alpha 0.5 light / 0.4 dark) with a thin rim
  (fresnel) in `--lm-avatar-outline` so the envelope reads against the light stage
  (REVIEW_FINDINGS #8). One key light from upper left, one hemisphere fill; no specular shine, no
  shadows on the stage.
- **Two fixed orthographic views**, front and side, side by side, sharing one centimetre scale and
  the height ruler. There is **no orbit or zoom** in v0.2: fixed views keep the ruler honest,
  keep handles where the sliders expect them, and make start/end comparisons exact.
- Muscle definition comes from geometry only (no painted strokes on the 3D figure).
- Visceral fat shows on the main figure **only** as the deeper front-to-back waist it causes —
  never as a blob or a colour patch. The visceral view (§6) is where it is drawn.

### 5.2 Fitted, not slid
The engine's estimated girths (neck, chest, waist, hip, thigh, calf, arm) are the truth; the
figure is fitted to them each time the state changes (≤ 1 cm error per girth). The sliders move
the engine's estimate; the figure follows the estimate. Shoulder breadth and torso taper are left
to **Frame** (§5.4), which is why Frame can change the drawing without changing a single number.

### 5.3 Rendering ladder and fallbacks

| Situation | Renderer | Notes |
|---|---|---|
| First paint, anywhere | **SVG** figure (existing `BodyAvatar`) | instant; the 3D chunk (≤ 300 kB gz) loads lazily only where a large figure is on screen |
| 3D chunk ready | **3D** cross-fades in over 200 ms (none with reduced motion) | no skeleton, no spinner; the SVG simply becomes the 3D figure |
| No WebGL, or context lost | SVG | silently; Settings › Appearance shows "figure drawing: simple (this browser)" |
| Slow device (first 60 morph frames average < 30 fps) | SVG, remembered per device | toast once: "Switched to the simple figure to keep sliders smooth. Change in Settings." |
| Data saver (`saveData`) | SVG until asked | a quiet key in the stage bar: "Load detailed figure · up to 300 kB" |
| Print, plan-card silhouettes (64 px), mini figure (120 px), date strips | SVG | small sizes never use 3D |
| `prefers-reduced-motion` | either | no tweens, no cross-fade |
| Show figure off / gentle mode | none | Figure faceplate replaced by the compact note (your-body.md §8) |

Settings › Appearance gains **figure drawing** `detailed (3D) · simple` (default detailed, falls
back automatically). Both renderers take the same parameters and draw the same proportions; only
the material and silhouette fidelity differ.

### 5.4 Frame (replaces "figure base: female / neutral / male")

**Control**: FrameSlider (`COMPONENTS §13.3`), inside **Shape › Adjust the drawing** together with
the existing drawing-only sliders (chest, arms, face).

| Property | Value |
|---|---|
| Label | **frame** |
| Ends | **hips-led** (0) · **shoulders-led** (1), each with a small outline silhouette (aria-hidden) |
| Default | "Match my basics": 0 for female physiology, 1 for male, 0.5 for "prefer not to say"; shown as a reference tick when the person has moved away from it |
| Readout / `aria-valuetext` | five words for the **drawn** shoulder-to-hip breadth ratio *r* (front view, widest points): *r* < 0.97 "hips clearly wider than shoulders" · 0.97–1.05 "hips a little wider" · 1.05–1.15 "about even" · 1.15–1.27 "shoulders a little wider" · ≥ 1.27 "shoulders clearly wider than hips" (cut-points tuned in the figure spike so every bin is reachable across the test bodies) |
| Helper | "Only changes the drawing. Your estimates don't change." |
| Reset | quiet key **Match my basics** |
| Never on or near it | female, male, man, woman, masculine, feminine, neutral, type A/B, body type |
| Stored | `profile.figure.frame` (0–1, or null = match my basics); synced, so the figure looks the same on every device. Code name `figureFrame` to keep it distinct from the engine's skeletal `frameZ` |

What Frame changes: shoulder breadth relative to the pelvis and the waist taper of the **drawing**.
What it never changes: any girth the engine estimates, any readout, any equation. For "prefer not
to say", the physiology uses the average of both equation sets (your-body.md §6) and **never reads
Frame**. Breast form follows the chest slider and the engine's chest fat share, not Frame.

Pointer from the figure, not from Basics: the Figure faceplate's caption row carries a quiet link
"Adjust the drawing ›" that scrolls to Shape › Adjust the drawing and opens it. Nothing about the
drawing is placed next to the sex key bank, so the two never read as linked.

### 5.5 Handles, mini figure, ghost
Unchanged in behaviour (AVATAR_SPEC §6, §8): handles are an SVG overlay over the canvas (waist,
hips, chest, arm), keyboard users use the sliders; the mobile mini figure is SVG; the start-state
ghost is the start envelope drawn as a rim-only pass (3D) or a 1 px outline (SVG).

## 6. Visceral view

### 6.1 Why a separate view
Visceral fat sits **inside** the abdominal wall, around the gut; it pushes the wall forward and
can't be pinched. Subcutaneous fat sits outside the wall and can. The only drawing that shows both
truthfully is a slice through the waist, with a side cutaway that shows where the slice is.

### 6.2 Anatomy (to scale)
**Side cutaway** (left, small): the figure's side silhouette from ribs to pelvis, opened to show,
from outside in: skin line · subcutaneous band (fat material; thicker at the front) · muscle wall
(lean material) · abdominal cavity with stylised bowel loops (fixed, scaled paths in
`--lm-avatar-organ-line` on `--lm-avatar-organ`) with visceral fat (`--lm-avatar-visceral`)
filling between the loops and the wall. A thin horizontal ink line marks the **waist slice**
level, with an arrow to the slice panel.

**Waist slice** (right, large), front at the top labelled "front": outer contour from the engine's
waist (half-width, half-depth, shape) · subcutaneous ring · muscle wall ring with the two psoas
bulges and the spine (a small ink-2 dot at the back) · organ region · **visceral fill** with a
gently lobulated outline whose area equals the estimate · **uncertainty halo** between the low and
high contours of the likely range (visceral at `--lm-avatar-halo-alpha`; 45° hatch when "patterns
in charts" is on) · **reference rings** at 100 cm² and 130 cm² (1 px ink, dashed `2 3`, labels
"100" and "130" outside at 2 o'clock; inside the slice frame at the top right on mobile) · a 10 cm
scale bar.

**Contrast**: every layer boundary is a 1 px `--lm-avatar-outline` line (≥ 3:1 against both
neighbours in both themes), so the layers separate by line as well as by fill; with "patterns in
charts" on, the subcutaneous ring gets a fine dot pattern and the visceral fill a 45° hatch. The
organ region is never left as an unbounded light area on the light stage.

Every area is equal-area to the engine's number; the outer contour always keeps the engine's waist
girth. The fill's ripples are fixed (seeded per person) so it never flickers while animating.

### 6.3 Numbers and bands

| Item | Display |
|---|---|
| Visceral fat | **about 160 cm²** at the waist slice · "likely 95–270" (80 % range from the engine) |
| Band | the band of the estimate: **typical** (under 100 cm²) · **raised** (100–130) · **high** (130 and over), drawn as a printed BandScale under the readout with the value tick and the range as a 4 px bar. When the range crosses a threshold the line adds what it spans: "high · the range reaches raised" / "high · the range spans all three bands" — never a single confident word over a wide range |
| Details (disclosure) | "about 2.8 kg of visceral fat · under the skin about 190 cm² · muscle wall about 140 cm²" |
| Bands note | "The bands are the same for everyone. Your estimate already allows for sex, age and ancestry." |

Leading unit is cm² at the slice (it is what the picture shows and what the reference rings
mean); kg is secondary. Never mix in scanner "android fat" grams or vendor visceral indexes.

### 6.4 Legend and copy (always visible, not a tooltip)
- ░ **Under the skin** (you can pinch it)
- ▓ **Deep, around the organs** (visceral)
- ▒ **Muscle wall**
- ┄ reference rings · 100 · 130 cm²
- Caption: "Waist slice, drawn to scale from your estimate. Illustrative — organs are simplified."
- How line: "Estimated from your fat mass, where it sits, age and waist. Grade C: a model checked
  against scans; read the size of the band, not the exact number." + "How this is drawn ›"
  (Evidence).
- With a waist measurement the how line adds: "Your waist measurement sets the outer contour."
- Never: "L4–L5", "CT", "android", "apple/pear", "belly fat" as a judgement.

### 6.5 Over time (animates with the simulation)
- The view takes the same timeline as the figure (`lerpAvatarParams`): on Simulator results it
  shows the state at the chart crosshair (end state with no crosshair); **Play** sweeps day 1 → last
  day over 2.2 s (ease-in-out; press again to stop); "weekly steps" steps 120 ms per week. Areas
  interpolate; the visceral contour is re-fitted every frame (< 0.1 ms).
- The **start contour** stays as a ghost (1 px `--lm-avatar-ghost` outline of the start visceral
  fill and the start outer contour), so loss reads as the fill shrinking away from it.
- Readout during Play: "day 42 · about 128 cm² (likely 75–215) · raised", digits rolling.
- The halo uses the estimate's relative uncertainty at every date (projections carry no extra band
  here); the caption says so: "Range shown is the estimate's; projections are less certain."
- Plan ladder Overview: start → end for the selected rung, side by side, no Play. **Never for the
  Ideal** — the ceiling plan is shown in numbers only, so "ideal" is never attached to a body.
- Progress › Body: the current estimate (from the latest anchored state) with the plan-start ghost
  and a sparkline-free change line: "since day 1: about −22 cm² (likely −10 to −35)".
- Reduced motion: Play jumps start → end; the crosshair still updates instantly.

## 7. States

| State | Behaviour |
|---|---|
| Estimate only (no waist) | wide range; how line suggests a waist measurement; band word stays |
| Range crosses a threshold | band of the estimate + "the range reaches raised" / "the range spans all three bands"; the BandScale shows the range bar across the bands; a waist measurement is suggested as the way to narrow it |
| Very low visceral (under 20 cm²) | fill becomes a thin lining; readout "under 20 cm²", no reference ring clutter (rings stay) |
| Very high (over 300 cm²) | slice view scales to fit; reference rings still drawn; caption unchanged |
| 3D unavailable | visceral view is SVG in every case (it never needs WebGL) |
| Show figure off | the visceral view is still available from the Estimates faceplate as a numbers-only row with the band scale (no drawing) |
| Gentle mode | figure and visceral drawing hidden by default; band word shown; numbers behind "show numbers" |
| Plan running (Living) | Body shows the profile as entered at plan start with a note "Your current estimate lives in Progress"; weight edits ask "Use as a new starting point?" (plan dialog) |

## 8. Accessibility

- Figure: `role="img"` with the generated description, updated on release; the description no
  longer names a "base": "Figure, 178 cm, shoulders a little wider than hips. Estimated body fat
  23 %, weighted toward the belly. Moderate upper-body muscle, light lower-body muscle."
- FrameSlider: native range, `aria-valuetext` = the bin word; end-caps `aria-hidden`.
- Visceral view: `role="img"` with "Waist slice. Visceral fat about 160 square centimetres, likely
  95 to 270: in the high band, though the range spans all three bands (under 100 is typical, 100 to
  130 raised, 130 and over high). Fat under the skin about 190 square centimetres." plus a table
  twin (area by layer, start vs now when comparing).
- Layers differ in lightness and pattern, not only hue; the legend names them; the halo has a
  hatch alternative.
- Play is a button with `aria-pressed`; the readout region is `aria-live="polite"` and announces
  only when Play stops.

## 9. What the engine supplies

| Need | Field / function |
|---|---|
| Figure fit | `AvatarParams` (girths, 16 levels with half-width/depth, `armAngleDeg`, `definition`, `outputs`) + the figure block `figure{frame, ageYears, fatKg{head, arms, legs, trunkSat, vat}, muscleKg{arms, legs, trunk}, satShares, leanCoreAreaCm2, sliders{chest, arms, face}}` |
| Timeline | `stateToAvatarParams(state, {baseline})`, `lerpAvatarParams(from, to, t)` |
| Visceral slice | `visceral{vatKg, vatAreaCm2, satAreaCm2, leanAreaCm2, wallAreaCm2, organsAreaCm2, waist{halfWidthCm, halfDepthCm, phi}, band: 'typical'\|'raised'\|'high', thresholdsCm2: [100, 130], areaRangeCm2: [lo, hi]}` (80 % range). The UI never computes the estimate, its range or the thresholds; it only places the engine's range against the engine's thresholds to say which bands it spans. **Requested contract addition**: this block, `uncertainty.vatRelativeSd` and `profile.figure.frame` are not yet in the engine or suite contracts — provisional until they are filed there |
| Uncertainty | `uncertainty{bodyFatBand80, waistSdCm, vatRelativeSd}` |
| Frame | `profile.figure.frame` via `profile.patch` (UI dispatches every 250 ms while dragging and on release, coalesced) |
| Reset | `profile.resetShape` (does not reset Frame; "Match my basics" sets it to null) |

## 10. Decisions & rationale

- **Fixed front and side views, no orbit.** A turntable is fun but breaks the shared ruler, the
  handles and exact start/end comparison; the two classic views carry all the information.
- **SVG first, 3D as enhancement.** The page never waits for a mesh; slow or old devices keep the
  simple figure; everything accessible lives in the SVG overlay either way.
- **Frame is continuous and wordless.** One slider about the drawn frame, with silhouettes at the
  ends and plain words about shoulders and hips, means nobody is asked to pick a sex to get a
  drawing that looks like them.
- **Visceral gets its own view, to scale, with references in the same picture.** People read a
  slice with a pinchable outer ring and a deep inner fill correctly when the legend uses plain
  words and the reference rings sit in the drawing; before shipping, a five-person hallway test
  ("which has more fat around the organs?", "which part can you pinch?") must score ≥ 4 of 5.
