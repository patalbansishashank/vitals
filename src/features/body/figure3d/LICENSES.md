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

## C-BODY exterior update (4 October 2026)

`public/figure/figure-v2.bin` replaces the experimental v1 exterior. It uses the same
MakeHuman hm08 CC0 assets and pinned commit `a8bc2d54ff0ac92e78ff71431b1023eda42bf482`
listed above, with 9,000 retained vertices and 42 morph targets.
The source and licence are unchanged: [MakeHuman assets licence at the pinned commit](https://github.com/makehumancommunity/makehuman/blob/a8bc2d54ff0ac92e78ff71431b1023eda42bf482/LICENSE.md),
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
The derived exterior pack is CC0. Rebuild with `node scripts/figure/fetch.ts` followed by
`node scripts/figure/bake.ts`; the default vertex budget is now 9,000. No MakeHuman
application code is included, and the application remains MIT.

## C-BODY anatomical layers (4 October 2026)

This section supersedes the older “Not used” statement about **BodyParts3D** above.
Z-Anatomy and all other excluded sources remain unused.

`public/figure/anatomy-v1.bin` contains adapted bones and skeletal muscles from
**BodyParts3D 4.0**, the official IS-A tree OBJ archive with 99% polygon reduction.

- Source archive: <https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/isa_BP3D_4.0_obj_99.zip>
- Pinned SHA-256: `40665852c49f218326590e204db91064a1ecfc3c6f8cbd7bbbcaac62c7cd409e`
- Download/version description: <https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html>
- Current official licence: <https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html>
- Explicit licence-update record, 27 February 2025: <https://dbarchive.biosciencedbc.jp/en/bodyparts3d/update.html>
- Database description: <https://dbarchive.biosciencedbc.jp/en/bodyparts3d/desc.html>
- Licence: **Creative Commons Attribution 4.0 International (CC BY 4.0)**,
  <https://creativecommons.org/licenses/by/4.0/>.

Required attribution: **BodyParts3D, © The Database Center for Life Science licensed
under CC Attribution 4.0 International**.

The original OBJ headers retain a historical CC BY-SA 2.1 Japan notice. The same
licensor's official database licence was explicitly updated on 27 February 2025
and now permits redistribution and adaptations under CC BY 4.0. This pack uses the
official database archive under that current grant, not a Z-Anatomy adaptation or
third-party repack.

Changes: selection of named bones and skeletal muscles; removal of unneeded atlas
structures; coordinate conversion from millimetres/z-up to centimetres/y-up;
registration to the MakeHuman reference stature and relaxed arm span; mesh reduction;
merging into material/region groups; position quantization and gzip compression.
Runtime muscle thickness and display-frame changes are illustrative adaptations.
The atlas is an adult male reference, not a reconstruction of any app user's anatomy.

`scripts/figure/fetch-anatomy.py` verifies the pinned archive checksum;
`scripts/figure/bake-anatomy.py` reproduces the separate derived asset. Every selected
source OBJ ID and name is embedded in the pack's `source.selected` manifest.
The derived atlas data remains CC BY 4.0; the independent application code is MIT.
The packaged attribution is also in `public/figure/NOTICE.txt`, linked by the figure UI.
