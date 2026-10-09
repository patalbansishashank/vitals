# Shared figure pose

The MakeHuman skin and BodyParts3D atlas use one relaxed standing pose. All
mounts consume the same asset and `placeAnatomy` geometry; camera rotation does
not change registration.

The shoulders use 18° abduction instead of the former 10°. The skin bake also
exports aggregated arm-chain weights and collision stencils. The shared scene
uses these to give crowded fitted arms only the extra lateral clearance they
need, rather than raising every body into a wide A-pose. Complete triangle
bounds include the torso, hips and thighs; the body's central skin stays fixed.
The lean layer takes the outer skin's correction, and anatomy follows the same
corrected skin rig. Forearm direction is preserved.

Rebuild with Node 22.18 or later, Python 3 and Blender 5.2 (on `PATH`, or set
`BLENDER` to its executable):

```sh
node scripts/figure/fetch.ts
python scripts/figure/fetch-anatomy.py
node scripts/figure/bake.ts
python scripts/figure/bake-anatomy.py
```

`bake-anatomy.py` runs `blender/decimate_atlas.py` once in headless Blender
(`blender -b --factory-startup`). For every atlas part it merges duplicate
vertices, drops stray fragments, trims forearm and leg muscles at the wrist
and ankle and hand and foot muscles at the knuckles, decimates with quadric
edge collapse, repairs pinched or open edges, and winds each shell to a
positive volume. A muscle belongs to the forearm or shin when it reaches 6 cm
up the limb (long finger and toe muscles included); after decimation each is
cut back to where it is at least 0.6 cm across for 3 cm (shin muscles from
4 cm above the ankle, at most 10 cm), and hand and foot muscles to 0.45 cm
for 1.5 cm; thin tendons read as frayed strands. Edges across the elbow and
knee are split. Neck muscles are capped 0.5 cm above the first cervical
vertebra (the jaw muscles stay on the skull). Trunk muscles that end on the
shoulder blade or collarbone follow the girdle's registration offset toward
that end. The linea alba is kept (widened 1.6 times across) and closes the
belly between the obliques, as the atlas has no rectus abdominis; the half
pelvic floor, the deep suboccipital muscles, the digastric and the thin foot
lumbricals and plantar interossei are dropped (listed in the report). Hole
outlines are walked in index order, so the output is byte-reproducible for a
given Blender version.

The skin bake exports ground-relative frame endpoints and joint stencils to
`.cache/skin-registration.json`. It uses the posed MakeHuman rig helpers and
actual bone-weighted skin vertices at limbs and digits. The atlas bake measures
named bone end sections, reposes bones and muscles to those joints, preserves
paired topology, and invokes `bind-anatomy.ts` automatically. The binder records
joint segments, skin triangle coordinates and frame deltas, and applies the
inward surface margin to both rest endpoints before packing.

Registration uses matching landmarks on both sides: the skull's pivot is the
first cervical vertebra (the rig's head joint), the trunk follows midline
section centres (the binder's trunk cage), digit joints are measured along each
small bone's own axis, and the foot joint is the base of the metatarsals. The
skull moves as one rigid piece. The shoulder blade and its muscles ride on the
thorax, offset so the socket meets the rig's shoulder. The binder fits each
section (along and around each joint segment) inside the rest skin with a soft
tissue margin (0.45 cm scalp and face, 0.3 cm over bones, 0.22 cm over
muscles), binds each bone to one segment, and binds trunk and arm parts to
their own skin.

At a fitted slider state, joints follow small skin stencils. Bone radii retain
their reference dimensions; muscle bellies grow by a bounded illustration
scale. Both stop at the surrounding skin, with a 0.18 cm reference inset. A
refitted triangle BVH finds the first boundary along concave shoulder/hip cage
directions. Exact placement runs in a persistent Web Worker with transferable
skin/output buffers. Joint offsets, triangle coordinates, belly factors and
reference centres are cached once per asset; the worker retains its skin buffer
and BVH between fits. Rotation reuses placed vertices, normals and GPU buffers.

The render thread keeps the previous registered frame while placement runs,
then commits the matching skin/core/ghost/anatomy together. There is at most one
in-flight request and one latest pending request; obsolete replies never show.
Worker errors, failed transfers or unavailable workers use the existing 2D
fallback. Worker disposal cancels all callbacks on unmount.

Checks:

```sh
TMPDIR=$PWD/.e6-tmp pnpm exec vitest run src/features/body scripts/figure tests/figure/pipeline.test.ts --maxWorkers=4
pnpm typecheck
pnpm lint
pnpm build
node scripts/figure/check-budget.mjs
node scripts/figure/pose-browser-qa.mjs --phase=after
node scripts/figure/placement-browser-bench.mjs
```

The registration test independently checks all atlas vertices against actual
skin triangles in nine fitted states, including opposing muscle settings,
height, frame and fat changes. It also checks limb axes, named bone endpoints
and foot height. The surface tolerance is 0.1 cm at reference stature.
`anatomyQuality.test.ts` checks the skull inside the head in four fitted
bodies (scalp, forehead and back margins), closed outward-wound parts, needle
triangles, and that no forearm, hand, lower-leg, foot or skull part tears when
placed. Known limit: where the fitted skin moves most (armpit, hips of heavy
bodies), trunk muscles and ribs still stretch by up to about 5 cm; this needs
the runtime placement (`placeAnatomy`), not the bake.

`armClearance.test.ts` checks exact triangle separation on 108 fitted states,
including maximum fat/muscle sliders, both sexes and three frames/heights. It
excludes the physically joined shoulder's first 5 cm, then checks the complete
upper-arm and forearm faces against the central body with a strict 0.15 cm
reference minimum. The source correction targets a conservative 0.4 cm gap.

Screenshots remain ignored under `.e6-tmp/C-POSE/screenshots`. The capture runner
uses synthetic browser fixtures, 390/768/1440 px, both themes, fixed views,
reduced motion and the SVG fallback. Decorative welcome/mini mounts have no
rotation control; the phone mini is absent at the desktop breakpoint.
Use `--views=front --samples=neutral,fat,muscle` for the arm clearance grid;
`--asset-dir=<ignored baseline folder>` replays a previous asset pair.
`--source-dir=<ignored baseline folder>` replays its Canvas/placement modules.
`--worker-error --only=dev --views=front` exercises transfer failure and the SVG
fallback. The placement benchmark measures warmed main-thread submission and
display commits at native/4× main-thread CPU, checks actual worker coordinates
against synchronous placement, and reports worker compute time separately.
Chromium's page CPU throttle does not throttle dedicated workers.

These are registered reference illustrations, not personal scans. See the
packaged notices and `src/features/body/figure3d/LICENSES.md` for attribution.

## Closed head surface

The hm08 body group includes inward eye and mouth skin pockets even when its
separate eyeball/teeth/tongue helper groups are omitted. The three authored
rims enclose the pockets together with the eyelids and lips. The bake walks
inward from each rim over front-facing skin to the lid margins and the line
between the lips, removes only the 2,244 pocket triangles behind them, and
zips each opening shut on a seam between its upper and lower edge (closed
eyes, a closed mouth), wound against the surrounding skin. The mouth's seam
lies midway; a shut eye's fold lies 65 % of the way down and bulges forward
by 0.4 of the gap (a height term in the depth stencil), because the lid
margins turn back into the head and a seam level with them read as a hollow
slit. A one-ring
collar relaxes depth only. The same linear source stencils repair every frame,
macro and local target before decimation; the seam vertices are retained. The
final skin is closed and consistently oriented. (Earlier radial caps replaced
the lids and lips and read as a squint and pursed lips.)

The atlas selection rejects 28 internal head/throat parts by their labels and
retains the skull, jaw and exterior face/neck muscles. The thin platysma sheet
is dropped. The complete inclusion
and exclusion lists are in `anatomy-bake-report.json`. `headSurface.test.ts`
checks the packed assets: seam orientation, no depth crossing behind the face
at 81 points in each of 35 macro/fitted shapes, watertight oriented edges and
excluded atlas labels. The renderer masks the outline to the external silhouette and resolves
the nearest skin surface before blending translucent layers.

Use `--head --only=dev --width=1440 --views=front,side,oblique45` for paired skin
and translucent-anatomy head captures. Head screenshots and rejected interim
closures remain ignored under `.e6-tmp/C-POSE/head`.

## Fat under the skin

The "Fat under skin" layer is drawn between the fitted skin and an inner
boundary built by `insetSubcutaneousShell` on the same closed skin mesh. The
lean morph (`coreState`) only says how deep the fat is; used as the boundary
itself it lay on or outside the skin on the face, hands, feet and knees
(holes), and its depth carried every rib, muscle edge and crease of the lean
shape plus vertex-scale noise, which the translucent layer showed as banding
and a saw-toothed back. The boundary is now a smooth layer:

- the lean depth is low-passed at body-region scale with a patch basis
  (~5 cm patches grown along the mesh from the rest shape, so an arm and the
  flank beside it stay apart), built once;
- it is held under 45 % of the skin's own baked thickness and a share of the
  curvature radius (smoothed at patch scale, so a nipple cannot hold the
  layer up), at least 0.6 mm;
- where the layer is deep and the body thick, it is offset from a smoothed
  copy of the skin (not in concave creases), so nipples, the navel and
  muscle relief are not copied, then relaxed (Taubin) and kept between the
  minimum and the cap below the real skin;
- folds (a face turned against its neighbours on the layer or against the
  smoothed copy) make the layer shallower over a few rings around them.
- the nipples are filled in: the bake finds the sharpest small cone on each
  side of the chest (in both frame shapes) and stores it with three rings
  (`shell.nippleTips`, `shell.pinned`); the shell builder fills that zone
  from the surrounding layer (a membrane over the offset from a smoothed
  reference), so the layer passes under the nipple instead of following it.

Every target is repaired and smoothed before decimation (`lib/smoothness.ts`): a
vertex whose delta is more than 1 mm off the affine fit of its two-ring takes the
fit, then three light Laplacian passes run over the body (head, hands and feet
keep their authored deltas). MakeHuman's targets carry single-vertex kinks and
vertex-scale noise that the fitter's large coefficients turned into points pulled
out of the belly and a jagged outline. `FIGURE_DIAGNOSE=<json> node
scripts/figure/bake.ts` writes per-target smoothness and a comparison of
smoothing methods; `morphSmoothness.test.ts` holds the limits. See
`docs/wp/C-FIX-morph-smoothing.md`.

The bake stores the thickness per vertex (`shell` in the figure manifest):
the shortest of a small cone of inward rays over the composite shapes,
meeting only the vertex's own part (body, left arm, right arm), because in
the heavier composites an arm passes into the flank. `fatShell.test.ts`
checks nine fitted bodies (closed, inside the skin, no visible fold), that
the layer is smoother than the skin over the trunk (the previous version was
1.3-2.0 times rougher and bent 21-36 degrees more between faces), and that it
thickens with body fat, more over the belly than the chest, and that the layer
around each nipple is no rougher than the rest of the chest.

Muscles and bones lie under this layer. The worker receives its inner
boundary with the skin, and each atlas vertex stays below it (below its depth
at the bound skin triangle and below the chord's first exit, squeezing a
section to at most 60 % of its radius). Where a bone or squeezed muscle still
reaches higher (a heavy shoulder or upper arm), the worker reports per skin
vertex how deep the fat may reach and `fatClearance.ts` makes the layer give
way there, the limit opening up as a 45 degree cone, so it has no step and
keeps over 75 % of its depth where it is deeper than 1 cm. The boundary is
built whenever muscles or bones show, so the fat chip does not move them.
`anatomyQuality.test.ts` checks seven fitted bodies (at most 30 of 53,000
atlas vertices within 3 cm of the skin cross the boundary; before, 5,000 to
14,500 did), bones inside the skin (the breastbone at least 0.5 cm deep in
heavy bodies), the closed belly, the capped neck, the trapezius on the
girdle and the shin muscles ending above the ankle; `fatClearance.test.ts`
checks the clamp.

## Visceral fat

The 3D `Fat around organs` chip and procedural ellipsoid were removed. Visceral
estimates still feed the body model, text and existing 2D waist view. The old
ellipsoid had inward winding and was outside the fitted skin in several cases.

A BodyParts3D mesentery/mesocolon/perirenal density-volume bake was attempted,
with filled kidney/stomach exclusions and conservative bowel masks. Static
closed shapes were possible, but the continuous thickness morph did not pass
face-orientation checks while retaining organ voids. No replacement 3D volume
or unvalidated estimate-to-geometry scaling is shipped. The rejected bake,
reports and preview remain ignored under `.e6-tmp/C-POSE/visceral/attempt`.
