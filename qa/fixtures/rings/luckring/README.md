# LuckRing golden fixtures

Family `luckring` (TK18 and relatives, company id 0xFF64). Protocol notes: `packages/rings/docs/luckring.md`.

## Provenance

Extracted from the Kotlin unit tests of the upstream PulseLoopAndroid driver (`LuckRingEncoderTest`,
`LuckRingDecoderTest`, `LuckRingProtocolTest`, `LuckRingDriverTest`, `LuckRingHistorySyncTest`,
`LuckRingSyncEngineGateTest`). That upstream has no licence file; the owner accepted this (plan decision 3).

**Synthetic only.** Every packet here was built from the test inputs (made-up timestamps around 1700000000, round
numbers). Nothing was captured from a real ring and no person's data is in these files.

The Kotlin tests build logical frames (`LuckRingFrame`), not bytes. The on-air 20-byte packets here are derived with the
Kotlin packetizer rules (devType 1, seq 0 unless the test sets them). The packets were generated and cross-checked by a
throwaway script, which is not committed.

## Format

All hex is lower case, bytes separated by single spaces. Every packet is 20 bytes. A frame of several packets is given
as `packets` / `bytesSequence` (one string per packet); `frame` is those packets joined.

- `encode.json`: `vectors[]` with `name`, `source`, `command { op, params }`, `seq`, `devType`, `cmdType`, `dataType`,
  `payload` (hex), `frame`, `packets`, optional `note`, optional `derived: true` (not asserted by a Kotlin test).
  Time-dependent commands record `nowMs` and `tzOffsetS` in `params`. `seq` is the encoder counter in the order of the
  Kotlin test. Layout-only Kotlin tests (userInfoBytes, timeBytes, goalBytes) assert the payload; the frame wrapper is
  derived and the note says so.
- `decode.json`: `vectors[]` with `name`, `source`, `context { layer, cmdType, dataType, seq, devType, nowS? }`, `bytes`
  or `bytesSequence`, `events`, optional `derived`, `writes`, `perPacket`, `frames`, `note`.
  - `layer` is `decoder` (logical frame -> events), `driver` (adds the ACK writes) or `assembler` (packets -> frames).
  - `events` hold only the fields the Kotlin test asserts (`kotlin` = `RingDecodedEvent` class; timestamps in
    epoch seconds as `timestampS`). Match them as a subset. `allStages` means every stage in the timeline equals it.
  - `derived` is the full decoder output computed from the Kotlin source for the same bytes (not asserted by Kotlin).
  - `derivedVector: true` marks extra edge cases that no Kotlin test covers (empty envelopes, short payloads, live SpO2,
    stress, narrow temperature records, sleep without a wake entry).
  - `writes` are the packets the driver must write back (the ACK of a device SEND). `perPacket` gives the events and
    writes after each packet of a multi-packet frame. `frames[i]` is the assembler result after packet i (`null` =
    still assembling).
- `sessions.json`: `sessions[]`, each with `name`, `source`, `setup`, `steps[]`, optional `derived: true`. Steps run in
  order against a fake peripheral on a virtual clock: `do` (host call), `advanceMs`, `expectWrite` (next packet
  written; one packet per step), `notify` (packets from the ring), `expectEvents` (decoded events after the last
  notified packet), `expectProgress` (pager progress strings), `expectNoWrite`, `expectRunning`. After the last step no
  write may be pending. Covered: cold connect handshake, handshake with ring replies, the four history-sync tests,
  the warm-pass gate test, a full catalog pass with the production timers, live HR and spot SpO2.

## Checking

The validator used while writing these lives outside the tree (`.e6-tmp`, git-ignored). It checked JSON, hex form,
20-byte packets, head and continuation layout, zero CRC, padding, reassembly, re-encoding, decoder output against
`events` and `derived`, and replayed every session against a fake driver and pager.
