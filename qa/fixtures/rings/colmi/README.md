# Colmi family golden fixtures

Byte-exact vectors for the Colmi ring family (R02, R03, R06, R10 and relatives on the same firmware) in
`@vitals/rings`. The protocol is described in `packages/rings/docs/colmi.md`.

**Synthetic only.** Every packet here was built by hand from the Kotlin unit tests of the upstream Android app
(`app/src/test/java/com/pulseloop/ring/Colmi*Test.kt`) or from its source. None is a capture from a real ring or
a real person. Timestamps use made-up instants (July 2026). One test in `ColmiDecoderTest.kt` ("real activity
buckets decode without calories") decodes seven captured on-ring frames; it is left out on purpose.

## Files

| File | What it holds |
|---|---|
| `encode.json` | One vector per encoder assertion: the command (`op`, `params`), the content the Kotlin encoder returns (`content`) and the bytes on the air (`frame`, `channel`). Vectors with `"unasserted": true` are frames the Kotlin sends that no test checks; they are computed from `ColmiEncoder.kt`. |
| `decode.json` | One vector per decoder assertion, negative cases included. `events` = exactly what the test asserts; `derivedEvents` = the full output read from the Kotlin source. Multi-chunk big-data transfers use `bytesSequence` and `eventsAfterEachChunk`. |
| `sessions.json` | Scripted exchanges for a fake peripheral: each step is the write the ring should see next and the notifications it sends back. Covers the connect handshake (three variants), an empty cold and warm history walk, one HR-log day, one steps day, sleep (on its own and inside the walk), live heart rate with the real-time fallback, spot HR and SpO2, sport sessions, and interval-temperature paging. |

## Format

- Hex strings are lower case with single spaces: `"03 54 00 …"`.
- A 16-byte frame ends in its checksum: byte 15 = sum of bytes 0..14 & 0xff.
- Big-data frames (first byte `bc`) are not 16 bytes: `[bc][action][length u16 LE][crc u16 LE][payload]`. Requests carry
  CRC16/MODBUS of the payload; replies in these fixtures carry `00 00` there, as in the Kotlin tests (the decoder never
  checks it).
- Channels: `write` = `6e400002-b5a3-f393-e0a9-e50e24dcca9e`, `notify` = `6e400003-…`, `command` =
  `de5bf72a-d711-4e47-af26-65e3012a5dc7`, `bigData` = `de5bf729-…`.
- `nowMs` is UTC epoch milliseconds; `tzOffsetS` is the local offset east of UTC in seconds. The Kotlin tests run in
  UTC with the machine clock; the instants here are fixed so the frames are reproducible.
- `"kotlin"` names the Kotlin event class (`HeartRateSample`, `HistoryMeasurement`, …) so a port can check its own
  `RingEvent` mapping against the original behaviour. The mapping itself is in `colmi.md`.

## Provenance

The Kotlin comes from the upstream PulseLoopAndroid project, which has no licence file; the owner accepted using it
(plan decision 3). The tests only contain hand-made frames, so these fixtures restate test inputs and expected
outputs; they copy no code.
