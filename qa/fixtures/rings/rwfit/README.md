# RWfit golden fixtures

Synthetic packets only. Every byte here was built by hand from the Lumen Android unit tests
(`RWfitCodecTest.kt`, `RWfitDecoderTest.kt`, `RWfitJLHistoryTest.kt`, `RWfitDriverTest.kt`,
`AdvertisementMatcherTest.kt`). No packet comes from a real ring, a capture or a person. The
protocol notes are in `packages/rings/docs/rwfit.md`.

The Kotlin came from upstream PulseLoopAndroid, which has no licence file. The owner accepted this
(plan decision 3).

## Files

| File | What it holds |
|---|---|
| `encode.json` | Frames the encoder must write, one entry per Kotlin encoder assertion, plus `checksums` (XOR and CRC-16/ARC vectors). Entries named `derived: …` are not asserted by any Kotlin test; they come from `RWfitEncoder.kt` and are marked in `source` and `note`. |
| `decode.json` | Notifications and the events the Kotlin code produces, one entry per decoder assertion, including negative cases (bad XOR, bad CRC, short frame, truncated record, wrong magic). |
| `sessions.json` | Scripted exchanges for a fake peripheral. `services` is what discovery returns, so the framing choice is testable. |
| `scan.json` | Advertisements and whether the family must match them. Manufacturer data is in on-air layout (little-endian company id first). |

## Format

Hex strings are lower case, bytes separated by one space. An empty string is zero bytes.

`framing` is `"legacy"` (frames start `7e`) or `"jl"` (frames start `ab`).

### encode.json

`{ family, source, clock, checksums, vectors: [ { name, source, framing, command: { op, params }, frame | frames, note? } ] }`

- `command.op` is a suggested op name for the TS port: `deviceInfo`, `battery`, `timeSync`, `syncManifest`,
  `history` (`params.stream`), `realtimeMeasure`, `unbind`, `appAck`, `startup` (the whole connect burst) or
  `raw` (codec-level: an explicit `cmd`/`triple` and `payload`).
- Legacy frames carry a serial counter. `params.serial` is the serial the frame was stamped with. A fresh codec
  starts at 1.
- Time-dependent frames use `params.nowMs` and `params.tz`/`params.tzOffsetS`. Every one here uses
  `nowMs` 1723000000000 (2024-08-07T03:06:40Z) in UTC, so local wall clock = UTC.

### decode.json

`{ family, source, timeConvention, vectors: [ { name, source, framing, context, bytes | bytesSequence, events, eventsPerPacket?, writes?, frame?, note? } ] }`

- `context.layer` says what the bytes are:
  - `codec`: one whole notification into the framing codec. Events are the codec's own classes
    (`RWfitLegacyInbound.*`, `RWfitJLInbound.*`).
  - `legacy-payload`: the payload of a legacy frame with command `context.cmd`. `frame` is the same payload
    wrapped in a legacy frame with ring serial 1, for end-to-end tests.
  - `jl-history-payload`: the body after the `05 xx 10` triple. `frame` is the full JL frame.
  - `driver`: a whole notification into the driver. `writes` lists the frames the driver must write in reply
    (app ACKs). `[]` means it must write nothing.
- `context.resetBeforePacket` lists packet indexes before which the codec is reset (connect or disconnect).
- `events` are the Kotlin event classes (`kotlin`) with the fields the test asserts. When a test asserts fewer
  fields than are listed, `note` says which; the rest come from the Kotlin source and were cross-checked by a
  re-implementation.
- `timestampS` is epoch seconds (Kotlin `Instant.epochSecond`). `RingEvent` uses epoch milliseconds.
- `stageRuns` is a run-length form of the Kotlin per-minute `stages` list: `[["LIGHT", 30], ["DEEP", 20]]`.
  `stageCount` is the list length.
- All timestamps assume the zone is UTC, so both correction terms are 0 (`tzCorrectionS: 0`). The Kotlin tests
  instead compute the correction from the machine's zone. See "Clock" in the doc.
- `RWfitDecoder.SyncManifest` and `pendingStreams` are return values, not events. They drive the legacy cascade.

### sessions.json

`{ family, sessions: [ { name, source, framing, services, clock, steps: [ { expectWrite, notify } ], expectEvents?, end?, note? } ] }`

Each step: the session must write `expectWrite` (full frame), then the fake peripheral sends every frame in
`notify` on the B003 notify characteristic. The Kotlin driver writes the whole connect burst without waiting for
replies, so most early steps have an empty `notify`.

### scan.json

`{ family, layout, vectors: [ { name, source, advertisement: { name?, serviceUuids, manufacturerData }, match, note? } ] }`
