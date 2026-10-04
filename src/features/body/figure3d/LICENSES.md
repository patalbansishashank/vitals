# Figure 3D: sources and licences

`public/figure/figure-v1.bin` is derived from MakeHuman assets by `scripts/figure/bake.ts`. Nothing else third-party is
shipped: the renderer, fitter, decoder and pipeline are our own code (no three.js, no decoders, no WebAssembly).

## Source

- Repository: <https://github.com/makehumancommunity/makehuman>, commit `a8bc2d54ff0ac92e78ff71431b1023eda42bf482`
  (master on 2026-10-01). `scripts/figure/fetch.ts` downloads exactly these files from `raw.githubusercontent.com`.
- Files (all under `makehuman/data/`; full list in `scripts/figure/lib/sources.ts`, also embedded in the pack manifest):
  - `3dobjs/base.obj`: base mesh **hm08**, `body` group only (13,380 vertices). Helper geometry (tongue, teeth, eyes,
    eyelashes, hair, tights, skirt, genital helper) is dropped.
  - `targets/macrodetails/{african,asian,caucasian}-{female,male}-young.target` (6 files): averaged per end into the
    two frame end shapes.
  - `targets/macrodetails/universal-{female,male}-young-{min,average,max}muscle-{min,average,max}weight.target`
    (18 files; the two average/average ones are empty).
  - Local targets, `-incr` and `-decr`: `measure/measure-{neck,bust,waist,hips,thigh,calf,upperarm}-circ`,
    `measure/measure-shoulder-dist`, `stomach/stomach-pregnant`, `torso/torso-scale-depth`, `torso/torso-scale-horiz`,
    `buttocks/buttocks-volume` (24 files).
  - `rigs/default.mhskel` and `rigs/default_weights.mhw`: used offline only, to lower the arms and straighten the
    forearms (linear blend skinning baked into the base and every target). The joint positions and weights are not
    shipped.
  - `LICENSE.md`: the licence statement quoted below.

## Licence

MakeHuman's `LICENSE.md`, section C: "The assets are defined as any data contributing to the graphical output of
MakeHuman. This includes: the base mesh and proxies, targets and modifiers, ... These assets have been released under
**CC0 1.0 Universal**." The individual files repeat this in their headers ("This asset was explicitly released as CC0
in september 2020"). `default.mhskel` and `default_weights.mhw` carry `"license": "CC0"`.

CC0 requires no attribution. As good practice, the credits/about page should say: *"Body mesh derived from MakeHuman
(CC0)."* (R2 sec. 5.5). Our derived pack is also released as CC0.

MakeHuman's **code** is AGPL. None of it is used or copied:
- The tape-measure rings are derived by our own code. Each ring is a plane cut at a landmark found by a girth search
  on the mesh. MakeHuman's ruler vertex lists in `plugins/0_modeling_a_measurement.py` (AGPL) are not used.
- The macro blending (min/average/max, piecewise linear) re-implements documented modifier behaviour. No code is copied.

## Not used (licence reasons, R2 sec. 2)

SMPL / SMPL-X / STAR / SUPR / SKEL (non-commercial, no redistribution), MB-Lab (AGPL / CC BY), the community
`bodyshapes-elvs-*` targets (licence unverified, folk typology), BodyParts3D / Z-Anatomy (CC BY-SA; the visceral view
is drawn from geometry, not from their meshes).
