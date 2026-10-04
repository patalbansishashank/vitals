# CRP family golden fixtures

Golden vectors for the CRP (`fdda`-profile) ring family. The protocol is described in `packages/rings/docs/crp.md`.

**Synthetic only.** Every packet here is made up. Some come from Lumen's Kotlin unit tests, where the test builds them with `CRPProtocol.frame(...)` out of small constants. The rest were built from scratch. Four Kotlin decoder tests use payloads captured from real people's rings: a full night of sleep, plus all-day heart rate, HRV and temperature. Those payloads are **not** copied here. Each one is listed under `excluded` in `decode.json` and replaced by a synthetic stand-in. The two single-byte spot replies the tests quote (heart rate `4a`, wear state `00`) are kept: they carry no date and no person. The firmware string `MOY-R1K3-2.1.6` is a firmware model name, not personal data.

## Provenance

| File | From |
|---|---|
| `encode.json` | `CRPProtocolTest.kt`, plus payload assertions in `CRPSyncEngineTest.kt` and the firmware-query assertion in `CRPDecoderTest.kt` |
| `decode.json` | `CRPDecoderTest.kt` and the header tests in `CRPProtocolTest.kt`; vectors marked `"derived": true` are computed from the rules in `CRPDecoder.kt` and are **not** asserted by any Kotlin test |
| `sessions.json` | `CRPSyncEngineTest.kt` (handshake order, frame walk, guards), `RingBLEClient.onServicesDiscovered` and `DriverRerouteTest.kt` (reroute), `RingSyncCoordinator` (spot flows) |

The Kotlin is in the Lumen Android repo (upstream PulseLoopAndroid, no licence file; accepted by the owner, plan 04 decision 3). No code is copied.

## Format

Hex strings are lower-case bytes separated by single spaces (`"fd da 10 07 01 09 01"`), which is what `toHex` / `fromHex` in `packages/rings/src/types.ts` produce.

### `encode.json`

`{ family, source, vectors: [{ name, source, command: { op, params? }, frame, note? }] }`. `op` names are listed in crp.md, Commands. Time-dependent frames (`set_time`) put the instant they used in `params` as `nowMs` (epoch ms) and `tzOffsetS`. When a note says Kotlin asserted less than the whole frame (only the opcode, say), the rest of the bytes come from the builder.

### `decode.json`

`{ family, source, excluded: [...], vectors: [{ name, source, context, bytes | bytesSequence, match, events, eventsPerChunk?, derived?, note? }] }`.

- `context.layer`: `decoder` (one complete frame, or one `fdd1` push, given to the decoder), `assembler` (chunks into `CRPFrameAssembler`; each event is `{kotlin: 'CRPFrameAssembler.frame', bytes}`), `driver` (chunks through assembler and decoder, as `CRPDriver.ingest` does), or `header` (`CRPProtocol.isFrameStart` / `frameLength`, `{value}`).
- `context.channel`: the full UUID of the notifying characteristic (`fdd1` or `fdd3`). `context.now` + `context.zone`: the clock the decoder used. Without them, times are not asserted.
- `events`: Kotlin event class names (`kotlin`) plus **only the fields that must match**. A field that is left out is not checked. Field names follow the Kotlin (`bpm`, `value`, `celsius`, `steps`, `distanceMeters`, `calories`, `kind`, `t`, `cmd`, `day`, `frameIndex`, `version`, `capabilities`, `worn`, `commandId`, `startsFrame`). For `SleepTimeline`: `t` (session start), `stagesCount`, `firstStage`, `stageCounts`, `stagesRle` (`[[stage, minutes], …]`).
- `match`: how to compare the decoded list with `events`:
  - `exact`: same length, same order;
  - `first`: the first decoded event matches `events[0]`;
  - `counts`: same length, and the same class at each position;
  - `only:<Class>`: keep only events of that class, then compare exactly;
  - `none:<Class>`: no event of that class.
  
  Parts can be joined with `+`.
- `eventsPerChunk`: for chunk sequences, the events each chunk produced, in order.

How these map onto `RingEvent` is in crp.md, "Mapping to RingEvent".

### `sessions.json`

`{ family, write: {service, characteristic}, defaultNotifyChar, sessions: [{ name, source, advertisement?, scanFamily?, services?, expectFamily?, expectSubscribe?, requiredBeforeHandshake?, context?, order?, steps, expectNoFurtherWrites?, note? }] }`.

- `services`: what `Transport.services()` returns after connecting. `scanFamily` is the family the scan picked. `expectFamily` is the family the session must end up driving.
- Each step: `{ expectWrite?, prefix?, notify: [hex…], notifyChar?, delayMs?, atMs?, expectEvents?, note? }`. When `prefix: true`, `expectWrite` is only the 6-byte header (the rest depends on the time). `delayMs` is how long the fake peripheral waits after the write before notifying. `atMs` is when the write is expected, counted from the session's first write. `expectEvents` (Kotlin vocabulary) applies to the first notification of the step.
- `order: "kotlin-fifo"`: writes are in Lumen's order. Lumen queues the whole startup batch first, and each history follow-up joins the end of the queue. A port that waits for each reply may send a follow-up earlier. In that case, match writes by content, not by position.

## Counts (validated)

59 encode vectors; 72 decode vectors (45 from Kotlin tests, 27 derived; 6 Kotlin tests excluded with reasons); 16 sessions (79 expected writes, 41 notifications). All hex parses, every frame's declared length matches its size, and a reference decoder written from the Kotlin rules reproduces every decode vector and every session's `expectEvents`.
