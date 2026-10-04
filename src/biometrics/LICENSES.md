# Third-party sources used by src/biometrics

## BLE protocols (src/biometrics/core/ble/**)

| Code | Source | Licence | Author | Accessed |
|---|---|---|---|---|
| `core/ble/jstyle2301/**` | Owner's Android fork `LumenHealth`: `ring/JStyle2301{Protocol,Decoder,Driver,FirmwareProfile}.kt` and `JStyle2301ProtocolTest.kt` (R10 §1: owner-authored) | owner's own code | the Vitals authors | 2026-10-01 |
| `core/ble/colmi/**` and its test vectors | https://github.com/tahnok/colmi_r02_client (main @ 19e70aa): `packet.py`, `battery.py`, `set_time.py`, `hr.py`, `steps.py`, `hr_settings.py`, `real_time.py`, `client.py`, `tests/*.py` | MIT | (c) 2024 Wesley Ellis | 2026-10-01 |
| Colmi cross-check only (V1 command table) | https://github.com/servolok84/smart-ring-dashboard `docs/protocol.md` | MIT | (c) 2026 Smart Ring Dashboard contributors | 2026-10-01 |

Not used: Gadgetbridge (AGPL); upstream PulseLoop ring code (no licence); Puxtril/colmi-docs (no licence). The
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

- The J-Style 2301 driver (`core/ble/jstyle2301/**`) is original work by the Vitals authors, written from their own protocol notes.
- The other ring families (Colmi, CRP, Jring, LuckRing, RWfit and YCBT) were ported from the Android project
  PulseLoopAndroid, which ships no licence file. The port is used in good faith and will be removed or relicensed
  on request from that project's author.
- Per-family detail follows.

<!-- L-RINGS: per-family provenance -->
