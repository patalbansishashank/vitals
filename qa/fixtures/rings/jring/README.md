# Jring ("56ff") golden fixtures

Synthetic only. Every packet here was built by hand from the Kotlin unit tests and the Kotlin encoder and decoder sources (Lumen, which came from the upstream PulseLoopAndroid project, no licence file; the owner accepted that, plan decision 3). No bytes come from a real ring, a phone capture, a person's data or a private file. The MAC in the status examples is made up. Protocol notes: `packages/rings/docs/jring.md`.

All hex is lower case, two digits per byte, separated by single spaces. Every packet the ring protocol defines is exactly 20 bytes; the few shorter or longer packets are negative cases and say so.

## Files

- `encode.json`: `{ family, source, vectors[] }`. One vector per encoder assertion in the Kotlin tests plus the frames the encoder builds that no test checks.
  - `name`: the Kotlin test name, or a description for derived frames.
  - `command`: `{ op, params }` in the port's vocabulary. Time-dependent frames record the instant (`nowMs`, `tzOffsetS`; the session stamps both on every command).
  - `frame`: the 20 expected bytes.
  - `asserted`: `true` when a Kotlin test checks (some of) the bytes; the `note` says which bytes. `false` when the frame comes from reading `RingEncoder.kt` only.
  - `test`: where it came from.
- `decode.json`: `{ family, source, contextKeys, matchModes, vectors[], clockVectors[] }`.
  - `context.clockOffsetS`: `null` means no clock (Kotlin `RingDecoder(clock = null)`); a number is the offset latched by `JringClock` (seconds east of UTC) and subtracted from ring-stamped times.
  - `bytes` (one packet, possibly empty or not 20 bytes) or `bytesSequence` (several packets decoded in turn, events concatenated).
  - `events`: expected Kotlin events: `kotlin` is the class name of `RingDecodedEvent`; the other keys are the fields the Kotlin test asserts (Kotlin field names; `_timestamp` is written `timestampS`, epoch seconds; `"now"` means "the phone clock at decode time", never asserted). `also` holds fields that are deterministic from the decoder code but not asserted by the test. `stagesPrefix` and `stageCount` describe a sleep timeline; `addressNotNull` the test's null check; `tolerance` an absolute numeric tolerance.
  - `match`: `exact` (same events in the same order), `first` (only the first event), `contains` (every listed event appears; the output has at least `minCount` events).
  - `asserted`, `test`, `note`: as in `encode.json`. `asserted: false` vectors come from reading `RingDecoder.kt`; they are there because the decoder is the contract, not because a test pins them.
  - `clockVectors`: the three `JringClockTest` cases plus two derived ones (`construct` and `capture` with an IANA zone at an instant give an offset; `date` converts a ring epoch).
- `sessions.json`: scripted exchanges for a fake peripheral (`stepKinds` at the top of the file explains each key). A step is a harness action (`do`), a subscribe or read the session must make, a write the session must make (`expectWrite`, with the notifications the peripheral then sends, `notify`), an unsolicited push, a clock jump (`advanceMs`) and the RingEvents expected (`expectEvents`). `expectWrite` of 20 bytes is exact; shorter is a prefix. `expectEvents` follow the mapping in `docs/jring.md`; `proposed: true` marks a design suggestion that is not Kotlin behaviour. Replies the ring may not send in reality are synthetic and are called out in notes.
  - Sessions: connect handshake; ring-driven bind handshake; history read (first pass, 3 days) with activity, sleep and heart-rate history; history read (later pass, 1 day); live heart rate start, samples and stop; spot heart rate; spot SpO2; combined spot measurement; keepalive; clock re-push; profile push; forget.

## What is not here

- No captures. Whether the real ring answers `01`, when it sends `27`, `28`, `0B` or `4B` INIT, and the real inter-packet timing of a history read are unknown (see "Unverified" in the notes). The sessions show the order of writes, which is Kotlin's, and replies built from the decoder layouts.
- The two Kotlin timestamp quirks (0x10 and 0x14 not offset by the clock) are not copied: the port takes the offset off every ring time and the `decode.json` vectors for 0x10 and 0x14 say so in their notes (`docs/jring.md`, port note 1). The first-pass history session runs at +05:30, its packets carry local wall-clock times, so a decoder that leaves any stream raw fails it.
- No J-Style, Colmi, CRP, YCBT, LuckRing or RWfit vectors.
