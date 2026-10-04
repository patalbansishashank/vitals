# Body avatar (`src/features/body/avatar`)

The parametric two-layer figure from `design/AVATAR_SPEC.md`: a solid **lean core** inside a frosted **adipose
envelope** on the perforated stage, front and side views, height ruler, optional girth callouts, a ghost outline for
before/after, and direct-manipulation handles. It is driven entirely by the engine's `AvatarParams`
(`stateToAvatarParams` in `src/engine/body`).

```ts
import { BodyAvatar, AvatarMorph, describeAvatar, avatarGeometry } from '@/features/body/avatar';
```

| File | What it is |
|---|---|
| `geometry.ts` | Pure: `AvatarParams` → closed outlines (cm, y up) for both layers, both views, arms, head, definition strokes, visceral layer, handle anchors; `pathD` (centripetal Catmull-Rom → cubic Bézier); `lerpGeometry`. ~0.2 ms per body. |
| `sections.ts` | Pure: engine params → per-landmark envelope **and** lean-core widths/depths (see "How the core is derived"). |
| `layout.ts` | Pure: stage pixel layout. The SVG's viewBox is the stage's own pixel box, so text is set in real px (≥ 11 px) and never scales down. |
| `BodyAvatar.tsx` | The figure component. |
| `AvatarMorph.tsx` | Before → after morph with scrubber and Play. |
| `describe.ts` | Generated accessible description (§7.8). |
| `motion.ts` | Reads `--lm-dur-*` / `--lm-ease-*` tokens at runtime (reduced-motion token overrides apply automatically). |
| `AvatarDemoPage.tsx` | `/dev/avatar` lab page (default export), wired to the real engine. |
| `avatar.css`, `demo.css` | Component / demo styles, tokens only. |

## `<BodyAvatar>`

| Prop | Type | Default | Notes |
|---|---|---|---|
| `params` | `AvatarParams` | — | `stateToAvatarParams(state, { baseline })`. |
| `compareTo` | `AvatarParams` | — | Ghost: the start state's **outer silhouette** (1 px `--lm-avatar-ghost` @ 60 %), drawn on top. |
| `view` | `'front' \| 'side' \| 'both'` | `'both'` | Both views share one vertical cm scale. |
| `showMeasures` | `{ chest?, waist?, hip?: string }` | — | Callouts with values **already formatted in the user's units** (`'86.6 cm'`, `'34.1 in'`). Leaders start at the side view's front edge (front view's right edge when side is hidden). Labels stack (name over value) on stages < 560 px wide. Hidden below 200 px. |
| `size` | `'lg' \| 'md' \| 'sm' \| 'xs' \| 'fill' \| number` | `'lg'` | Stage height: `lg` 460 (desktop), `md` 330 (mobile), `sm` 132 (mini figure), `xs` 64 (plan card), `fill` = parent's height, number = px. Width is always the container's. |
| `label` | `string` | generated | Accessible name of the `role="img"` SVG. Default: `describeAvatar(params, …)` ("Figure, 178 cm, shoulders a little wider than hips. Estimated body fat 23 percent, weighted toward the belly. Muscularity: athletic."; frame in shape words, never sex or gender words). The description adds "Inner shape: lean tissue. Outer layer: fat." |
| `interactive` | `AvatarInteraction` | — | Handles + vertical body drag (below). Omit for display-only. |
| `frame` | `number` 0..1 | `params.figure.frame`, else from sex | Skeletal frame, **drawing only**: 0 = hips-led, 1 = shoulders-led (templates, bust, curvature, continuous mix); girths stay the engine's. |
| `base` | `'female' \| 'neutral' \| 'male'` | params' sex | Legacy: mapped to frame 0 / 0.5 / 1; `frame` wins. |
| `showVisceral` | `boolean` | `false` | Ellipse sized from `outputs.vatKg`, inside the core (front), anterior half (side). |
| `appearance` | `'layers' \| 'silhouette'` | `'layers'` | `silhouette` = envelope only, for plan cards. |
| `ruler` | `boolean` | auto (≥ 200 px) | Height ruler: ticks every 10 cm, numerals every 50 cm, ink tick + label at the user's height. |
| `units` | `'metric' \| 'imperial'` | `'metric'` | Ruler scale (imperial: 6 in ticks, numerals at 2/4/6 ft) and default height label. |
| `heightText` | `string` | `"178 cm"` / `"5 ft 10 in"` | Label at the height tick. |
| `caption` | `ReactNode \| false` | spec caption | "Illustrative figure. Shows proportions from your inputs, not your exact shape." — pass `false` only where the host shows it elsewhere (plan cards, mini figure). |
| `tween` | `boolean` | `true` | Discrete jumps (reset, preset, big keyboard step: any point moving > 0.8 cm between renders) settle with `--lm-ease-needle` over `--lm-dur-needle`; continuous input follows 1:1. Always off under reduced motion. |

### `interactive: AvatarInteraction`

```ts
interface AvatarInteraction {
  onRegionDrag(region: 'chest' | 'waist' | 'hips' | 'arms' | 'body', delta: RegionDragDelta): void;
  values?: Partial<Record<'chest' | 'waist' | 'hips' | 'arms', { value; min; max; text }>>; // ARIA slider semantics
  describe?(region, channel): string;   // floating caption while dragging: "belly & waist · 41 % of fat"
  bodyDrag?: boolean;                   // vertical drag on the figure → total body fat (default true)
  handles?: 'always' | 'hover';         // visibility at rest (hover still shows them on touch devices)
  disabled?: Partial<Record<region, boolean | string>>; // string = reason, e.g. "set by your waist measurement"
}
interface RegionDragDelta { channel: 'fat' | 'muscle'; amount; total; px; phase: 'start' | 'move' | 'end'; source: 'pointer' | 'keyboard' }
```

The **parent owns the slider state**: add `amount` to the matching slider on every event (`amount` is the change
since the previous event; `phase: 'end'` is the commit point, e.g. for autosave). Units follow AVATAR_SPEC §8:

| Region | `fat` channel | `muscle` channel (Shift) |
|---|---|---|
| `waist` (right edge at the waist) | distribution, 1 per 60 px outward | — (Shift ignored) |
| `hips` (figure's right hip = viewer's left) | distribution, 1 per 60 px outward | lower-body muscle, 1 per 120 px |
| `chest` (viewer's left, at the chest) | distribution, 1 per 60 px outward | upper-body muscle, 1 per 120 px |
| `arms` (outer edge of the right upper arm) | distribution, 1 per 60 px outward | upper-body muscle, 1 per 120 px |
| `body` (vertical drag on either view) | body-fat **percentage points**, 10 per 100 px upward | — |

Keyboard: every handle is focusable (`role="slider"` when `values` are given, otherwise `role="button"`).
←/↓ −0.05, →/↑ +0.05, PgUp/PgDn ±0.25, Shift switches to the muscle channel; one `phase: 'end'` event per key.
Handles are 12 px raised caps with 44 px hit areas, yellow while active, 2 px focus ring. They are front-view only and
are not rendered on stages under 200 px.

## `<AvatarMorph>`

All `BodyAvatar` props except `params` / `compareTo` / `tween`, plus:

| Prop | Default | Notes |
|---|---|---|
| `from`, `to` | — | Start / end `AvatarParams`. The start is drawn as the ghost (`ghost={false}` to hide). |
| `t` / `defaultT` / `onTChange` | uncontrolled, `1` | Scrubber 0…1 (linear in time). Controlled when `t` is given; `onTChange` fires on scrub and on every animation frame. |
| `autoPlay` | `false` | Plays 0 → 1 on mount and when `from`/`to` change. |
| `durationMs` | `--lm-dur-morph` (900 ms) | Eased with `--lm-ease-in-out`. Resumes from the current `t`. |
| `steps` | — | Discrete playback, 120 ms per step (e.g. `steps={weeks}` for "weekly steps"). |
| `controls` | `false` | Play/Pause/Replay key + `ScaleSlider` scrubber (`scrubberLabel`, `formatT` e.g. `t => \`day ${Math.round(t * 84)}\``). |
| `summary` | — | Line under the figure ("start 24.1 kg fat · 60.8 kg lean → day 84 19.8 · 61.0"). |

Interpolation uses the engine's `lerpAvatarParams(from, to, t)`, so every frame is a real, valid body. Under reduced
motion Play snaps to the end.

## Integration notes

### Your body (`/body`, `design/screens/your-body.md`)

```tsx
const est = useMemo(() => liveEstimate({ sex, ageYears, heightCm, weightKg, waistCm, sliders: touchedOnly }), [...]);
const params = useMemo(() => stateToAvatarParams(est), [est]);
<Faceplate variant="flush" title="Figure" caption="front · side · drag the figure's edges to adjust">
  <div style={{ height: 'clamp(340px, 58vh, 560px)' }}>          {/* mobile: aspect-ratio 4 / 5 */}
    <BodyAvatar params={params} base={figureBase} size="fill" units={units} showVisceral={visceral}
                interactive={adjustOnFigure ? interaction : undefined} />
  </div>
</Faceplate>
```

- **Unused-slider rule** (engine README): pass only the sliders the user touched; display untouched ones from
  `slidersFromEstimate(est, inputs)`. When a handle drags an untouched slider, start from that displayed value
  (`AvatarDemoPage.tsx` `nudge()` shows the pattern).
- **Handle → engine slider mapping** (used by the demo): waist `fat` → `bellyVsHips +`, hips `fat` → `bellyVsHips −`,
  chest `fat` → `chest` (drawing only), arms `fat` → `arms` (drawing only); `muscle` → `muscleTorso` / `muscleLegs` /
  `muscleArms` (× 2: muscle units are 0…1, the engine's regional sliders span −1…1); `body` → adiposity via
  `bodyFatToSlider(sex, sliderToBodyFat(sex, current) + amount)`. The screen's separate "belly" and "hips" sliders
  collapse to the engine's single belly-vs-hips axis (AVATAR_SPEC §10.1).
- **Waist measured**: the engine ignores `bellyVsHips`; pass `disabled: { waist: 'set by your waist measurement', hips: … }`.
- **Touch**: pass `interactive` only while "adjust on figure" is on (the figure then takes `touch-action: none`);
  on pointer stages use `handles: 'hover'`.
- **Mini figure** (sticky, mobile): `<BodyAvatar size="sm" view="front" caption={false} />` (same live params).
- **Show figure off / gentle mode**: don't render the component (Settings `showFigure`).
- `aria-live` belongs on the estimates region, updated on commit; the figure's name updates with the params.

### Results — "figure over time" (and plan cards)

- For any simulated day: `stateToAvatarParams(stateOfDay, { baseline: initialEstimate })` — always pass the
  baseline (engine README: measured circumferences belong to t = 0; ψ = 0.83 waist-loss hysteresis needs it).
  Pass tissue FFM (no acute glycogen/water swings).
- Linked to the chart crosshair: either `<AvatarMorph from={p0} to={pEnd} t={crosshairDay / lastDay} />`, or, when
  the per-day states are available, `<BodyAvatar params={pAtCrosshair} compareTo={p0} tween={false} />` (exact day,
  not a linear blend). With no crosshair show the end state (`t = 1`).
- Play: `<AvatarMorph controls steps={weeklySteps ? weeks : undefined} onTChange={moveCrosshair} />`.
- Plan cards: `<BodyAvatar params={pEnd} size="xs" view="front" appearance="silhouette" caption={false} label=… />`
  (off in gentle mode).

### Dev page

`AvatarDemoPage.tsx` is a self-contained default export for **`/dev/avatar`** (the shell mounts it:
`lazy(() => import('@/features/body/avatar/AvatarDemoPage'))`). It needs no router context of its own.

## How the core is derived (AVATAR_SPEC §10.3)

The engine gives the **envelope**: an ellipse per landmark from predicted girths (`levels[]`, dossier 14 M8/M10).
The **lean core** is not in `AvatarParams`, so `sections.ts` rebuilds it from the engine's own M8 lean terms, using
only fields the params carry (sex, height, FFMI, VAT):

- waist `A = a_w·leanCoreKg/h` **+ VAT area** (visceral fat sits inside the abdominal wall), hip `A = a_h·leanCoreKg/h`,
  arm `A = a_a·SM_arm/(0.2 h)`; chest / thigh / calf / neck = reference-body lean area + muscle-area change;
- shell thickness of a convex section `δ = (C − C_core) / 2π`, split by direction (anterior abdominal SAT thicker than
  the back, glutes behind, lateral hip/thigh fat on the female template, breast in front of the female chest);
- intermediate stations (trap, axilla, underbust, navel, upper thigh, above/below knee, lower calf) use the §3
  template ratios; muscle shape emphasis (lats, deltoid cap, quad teardrop, calf) scales with FFMI;
- fat is low-pass (§4.2): envelope bumps wash out where the shell is thick; the core keeps its local shapes.

These use engine internals (`@/engine/body/geometry`, `…/partition`, `…/circumferences`): `sections.ts` is the only
coupling point. If the engine ever exposes core areas in `AvatarParams`, swap them in there.

## Deviations from AVATAR_SPEC.md

1. **Core model**: envelope = engine girths (§10.3); core = engine M8 lean terms (above) instead of the §3 absolute
   template widths, which survive as shape ratios. The spec's `muscle.upper/lower` split is not in `AvatarParams`;
   regional muscle shows through the girths, and FFMI drives muscle-shape emphasis.
2. **Section breadth**: front-view breadth = ellipse half-width × chest 0.86 · waist 0.95 (F 0.93) · hip 0.94 (F 1.0)
   · knee 0.88 — real torso sections are not ellipses (ANSUR breadth/girth). Drawing only; depths as given.
3. **Handles are keyboard-accessible** (task requirement) instead of `aria-hidden` (§8); chest and hips handles sit
   on the viewer's left so the four 44 px hit areas don't collide; "outward" is the drag direction.
4. **Arm angle**: the engine's `armAngleDeg` is the minimum; the arm opens continuously (bisection, no jumps) until
   the drawn elbow–forearm envelope clears the drawn torso by 0.6 cm (§3.4 "opens to 16°" generalised; up to 42°).
5. **Legs**: leg spacing has a skeletal floor (8.1/7.7 cm × √(H/175)) and a slight splay to the feet; inner thighs
   clamp at 0.35 cm from the midline (thigh gap emergent).
6. **Light-theme fat fill** = `color-mix(fat 74 %, lean 26 %)` via `light-dark()` (REVIEW_FINDINGS #8 contrast
   against the well); dark keeps the token at 92 % opacity (§4.1). Outline 1.25 px non-scaling.
7. **Text**: stage text is 11 px, ruler numerals and view labels use `--lm-ink-2` (ink-3 is 4.3:1 on the well).
8. **Visceral** ellipse sized from `vatKg` (no 0–100 index in the params).
9. **Stage** front column minimum ±40 cm (spec ±45), side ±30; extreme bodies widen them.
10. **Morph** interpolates params (`lerpAvatarParams`), not points; the needle tween interpolates points.

## Tests

`geometry.test.ts` — path validity; finite numbers for 304 bodies (both sexes × 18/45/80 y × BMI 16–50 × 150/200 cm ×
5 slider sets incl. all extremes, plus measured-waist extremes); stable topology; front symmetry; monotone contours;
core inside envelope; no self-intersection (sampled Béziers) and elbow/forearm clearance over the §9 corner cases
(fat × distribution × muscle × base); monotonic response (trunk fat → wider waist; fat → shell not core; muscle →
wider core at shoulders, arms, thighs, chest). `BodyAvatar.test.tsx` — mounts a matrix of bodies × views × sizes
with no NaN in any attribute, accessible names/description, text never inside scaled groups, ghost masks, handle
pointer/keyboard callbacks and units, disabled regions, needle tween vs reduced motion, morph t / Play / weekly steps.
