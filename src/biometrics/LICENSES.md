# Third-party sources used by src/biometrics

## Ring protocols (packages/rings/src/**, formerly src/biometrics/core/ble/**)

| Code | Source | Licence | Author | Accessed |
|---|---|---|---|---|
| `packages/rings/src/jstyle2301/**` (and the `core/ble/jstyle2301` re-exports) | Owner's Android fork `LumenHealth`: `ring/JStyle2301{Protocol,Decoder,Driver,FirmwareProfile}.kt` and `JStyle2301ProtocolTest.kt` (R10 §1: owner-authored: written from captures of the owner's ring and the observed behaviour of the vendor's SDK; no vendor code is included); its V0789 passcode is a protocol constant kept only in `passcode.ts` | owner's own code | the Vitals authors | 2026-10-04 |
| `packages/rings/src/{colmi,crp,jring,luckring,rwfit,ycbt}/**` and `qa/fixtures/rings/{colmi,crp,jring,luckring,rwfit,ycbt}/**` | Lumen Health's Kotlin ring drivers and their unit tests (`app/src/main/java/com/pulseloop/ring/**`, `app/src/test/java/com/pulseloop/ring/**`), which came in with the upstream PulseLoopAndroid project. **Upstream ships no licence file**; the owner recorded and accepted this on 2026-10-04 (plan 04 decision 3) and may still ask the upstream author for permission. Lumen's own comments say some Colmi byte layouts were read from a decompiled copy of the vendor app and one Colmi real-time request from Gadgetbridge (AGPL); the Colmi port marks those functions with `// provenance:` comments. | none upstream (unlicensed) | upstream PulseLoopAndroid authors; Lumen Health changes by the owner | 2026-10-04 |
| `packages/rings/src/types.ts`, `session.ts`, `records.ts`, `testing/**` | written for Vitals | MIT (Vitals) | Vitals | 2026-10-04 |
| `core/ble/colmi/**` (the v0.4.0 web driver, kept until the app switches to `packages/rings`) and its test vectors | https://github.com/tahnok/colmi_r02_client (main @ 19e70aa): `packet.py`, `battery.py`, `set_time.py`, `hr.py`, `steps.py`, `hr_settings.py`, `real_time.py`, `client.py`, `tests/*.py` | MIT | (c) 2024 Wesley Ellis | 2026-10-01 |
| Colmi cross-check only (V1 command table) | https://github.com/servolok84/smart-ring-dashboard `docs/protocol.md` | MIT | (c) 2026 Smart Ring Dashboard contributors | 2026-10-01 |

Not used directly: Gadgetbridge (AGPL; the ported-families row notes the one Colmi request Lumen took from it); Puxtril/colmi-docs (no licence). The
servolok84 "V2 big data" sleep/SpO2 section cites Gadgetbridge as a source, so Colmi sleep and SpO2 history are not
implemented.

### MIT licence text (tahnok/colmi_r02_client)

Copyright (c) 2024 Wesley Ellis

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Ring protocol code provenance

- The J-Style 2301 driver (`packages/rings/src/jstyle2301/**`, re-exported from `core/ble/jstyle2301/**`) is the owner's own code, written from captures of the owner's ring and the observed behaviour of the vendor's SDK; no vendor code is included.
- The other ring families (Colmi, CRP, Jring, LuckRing, RWfit and YCBT) were ported from the Android project
  PulseLoopAndroid, which ships no licence file. The port is used in good faith and will be removed or relicensed
  on request from that project's author.
- Per-family detail: the table above and each family's notes in `packages/rings/docs/<family>.md`.

## C-BODY: shared 3D body figure exterior (4 October 2026)

`public/figure/figure-v2.bin` is a derived CC0 1.0 mesh and morph pack from MakeHuman hm08,
repository <https://github.com/makehumancommunity/makehuman>, pinned commit
`a8bc2d54ff0ac92e78ff71431b1023eda42bf482`. The [licence at that commit](https://github.com/makehumancommunity/makehuman/blob/a8bc2d54ff0ac92e78ff71431b1023eda42bf482/LICENSE.md)
releases bundled mesh, target and rig assets under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
The separate AGPL application code is not used. Changes: adult frame blending, a relaxed
pose, mesh reduction to 9,000 vertices, quantization and compression. The full source-file
list and reproducible pipeline are in `scripts/figure/lib/sources.ts` and
`src/features/body/figure3d/LICENSES.md`. Courtesy credit: “Body mesh derived from MakeHuman (CC0).”

## C-BODY: reference bones and muscles (4 October 2026)

`public/figure/anatomy-v1.bin` is an adapted selection from **BodyParts3D 4.0**,
official IS-A tree 99% reduced OBJ archive:
<https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/isa_BP3D_4.0_obj_99.zip>.
Pinned SHA-256: `40665852c49f218326590e204db91064a1ecfc3c6f8cbd7bbbcaac62c7cd409e`.
Licence: **CC BY 4.0**, <https://creativecommons.org/licenses/by/4.0/>.

**BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International**.

The [current official licence](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html)
and [27 February 2025 update record](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/update.html)
supersede the historical CC BY-SA 2.1 Japan notice still embedded in source OBJ
headers. Only the official archive is used; no Z-Anatomy or non-commercial assets
are included. Changes comprise selection, mesh reduction, reference-pose registration,
coordinate conversion, grouping, quantization and compression. Selected OBJ IDs and
names are in the binary manifest; exact pipeline and provenance are documented in
`src/features/body/figure3d/LICENSES.md` and `scripts/figure/{fetch,bake}-anatomy.py`.
Packaged attribution: `public/figure/NOTICE.txt`. The atlas data is CC BY 4.0;
the independent application remains MIT.
