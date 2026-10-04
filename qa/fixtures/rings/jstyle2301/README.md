# J-Style 2301 golden fixtures

Synthetic only. Every packet here is built from the owner-authored Kotlin unit tests of the Android Lumen app
(`app/src/test/java/com/pulseloop/ring/JStyle2301ProtocolTest.kt`, mainly) or derived from the Kotlin encoder and
decoder rules. Nothing comes from a real ring capture, a vendor-app export or the owner's own data. Timestamps are
synthetic (2026-09-14 and 2026-09-16, UTC, as in the Kotlin tests).

The V0789 authentication vector uses the test credential `TESTKEY1`. The real passcode is never in a fixture: session
scripts check only the first byte (`3c`) of the authentication write.

The protocol is described in `packages/rings/docs/jstyle2301.md`.

## Files

All byte strings are lower-case hex pairs separated by single spaces. Every 16-byte frame ends with its checksum
(sum of bytes 0..14, low 8 bits).

- `encode.json`: `{ family, source, vectors: [{ name, command: { op, params? }, frame, note?, redacted? }] }`. One entry
  per encoder assertion in the Kotlin tests, then entries named `derived: …` that cover the opcodes no test asserts.
  `op` names follow the existing TS port (`battery`, `firmware`, `chip`, `name`, `authenticate`, `history`,
  `historyContinue`, `realtimeSteps`, `hrMeasure`, `sportMode`). `redacted` is what `redactOutbound` must return.
- `decode.json`: `{ family, source, vectors, terminal }`.
  - `vectors[]`: `{ name, firmware, tzOffsetS, nowMs, bytes, prelude?, events, match, counts?, absent?, note? }`.
    `firmware` is the decoder's starting firmware (`V0525`, `V0789` or `null` = unknown); `prelude` packets are decoded
    first (a firmware reply that switches the profile); `nowMs` stamps live and spot readings (`null` when the packet
    carries its own time). `events` use the Kotlin event class (`kotlin`) and the fields the test asserts.
    `match: "exact"` = the decoder returns exactly these events in this order; `"contains"` = each listed event is
    present (only its listed fields compared); `counts` = number of events of a class; `absent` = no event matches.
    Floating values (temperature, kcal) compare with a small tolerance.
  - `terminal[]`: `{ name, streamOpcode, bytes, terminal }` for the end-of-stream test.
- `scan.json`: advertisement vectors for `ScanMatch.match` (manufacturer data in on-air layout, company id first).
- `sessions.json`: scripted exchanges for a fake peripheral. Each step is
  `{ expectWrite?, match?: "prefix", notify: [hex…], delayMs?, expectNoWrite?, waitMs?, note? }`: wait for the write
  (full frame, or a prefix when `match` is `prefix`), then send the notifications in order. `outcome` says what a
  session should end with. `pageLimit` and `streams` give the history read the session runs.

## Checking

Every hex string parses, every 16-byte frame carries the right checksum, and no file contains the retail brand or
the real passcode (the passcode guard test scans every tracked file).
