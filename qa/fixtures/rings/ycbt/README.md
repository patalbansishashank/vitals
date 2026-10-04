# YCBT golden fixtures

Golden vectors for the YCBT family (the Yucheng protocol: R10M, TK5 and the SmartHealth-app rings). The protocol is described in `packages/rings/docs/ycbt.md`.

## Synthetic only

Every byte here comes from the Lumen Android unit tests (`app/src/test/java/com/pulseloop/ring/YCBT*Test.kt`, `SubscriptionSetupGateTest.kt`), or was built with those tests' own helpers (`header`, `terminal`, `sleepSession`, `sleepRecord`). Nothing was captured from a ring for this folder.

Left out on purpose: the multi-hour hardware dumps in `YCBTHealthRecordsTest.kt` (`capturedNight`, the 8-record `capturedHeartRecords` and `capturedAllRecords`). They are a real person's night and day, so the tests that need them ("sleep decodes a full night matching the app", "multiple sessions in one buffer", "a session spans exactly the header's declared start and end", "heart rate records decode every record", the three "combined vitals" tests on the 8-record dump) are not here. The sleep rules they cover are covered by the synthetic sleep vectors. The few short items kept (one 28-byte body-data record, two heart records, one device-info reply) are single readings with no identity. The one manufacturer-data blob in the Kotlin tests holds a device address, so it is not copied.

Provenance: the Kotlin came from upstream PulseLoopAndroid, which has no licence file. The owner accepted this (plan 04, decision 3).

## Conventions

- Hex is lower case, one space between bytes.
- A "frame" is on-wire bytes: `[group][cmd][len u16 LE = whole frame][payload][crc16 LE]`, where the CRC is CRC16/CCITT-FALSE over every byte before it. A "logical" command is `[group][cmd][payload]`, which is what most Kotlin encoder tests check.
- Ring times are `{ "ringSeconds": N }`: local wall-clock seconds since 2000-01-01, turned into an instant with the zone in `context.tz` (Kotlin uses the phone's default zone). `836694044` is 2026-07-06 23:00:44 local.
- Events use the Kotlin class names (`"kotlin": "HeartRateSample"`) and only the fields the Kotlin test checks. Events stamped with "now" carry no time.
- `tolerance` on an event means the Kotlin test compared doubles with that delta.

## encode.json

`vectors[]`: `{ name, source?, command: { op, params? }, logical | logical[], frame | frames[], note? }`. `frame` = `frame(logical)`. A note says when Kotlin checks less than the whole frame (only the weekday byte, only the `(group, cmd)` order). Vectors marked "(derived)" have no Kotlin test behind them; they follow the encoder code.

Command ops: `frame`, `setTime {instant, tz}`, `getDeviceName`, `monitorCommands {...}`, `setUserInfo`, `startupSequence {profile: ycbt|tk5|colmi_smart_health, …}`, `postSubscriptionHandshake`, `historyRequest {type}`, `historyBlockAck {status}`, `liveMeasurement {enable, mode}`, `findDevice`, `enableLiveStatus`, `devControlAck {key}`.

## decode.json

`vectors[]`: `{ name, source, context: { layer, … }, bytes | bytesSequence, events, match, count?, note? }`.

`context.layer`:
- `frame`: `YCBTFrame.validating(bytes)`. `frame` is the parsed `{type, cmd, payload}` or `null` (bad CRC, wrong length, short).
- `assembler`: `YCBTFrameAssembler`. `bytesSequence[i]` arrives on `channels[i]`; `framesPerAppend[i]` lists the whole frames that append returns. `"RESET"` means `reset()`.
- `decoder`: `YCBTDecoder.decode(validating(bytes), startedMode = context.startedMode)`.
- `driver`: `YCBTDriver.ingest` (reassembly, validation, the `04 xx 00` acknowledgements in `writes` / `writesFramed`, and the capability gate). With `bytesSequence`, `events[i]` belongs to `bytesSequence[i]`. `"RECONNECT"` means `connectionDidEnd()` then `connectionDidStart()`.
- `healthRecords`: `YCBTHealthRecords` on a reassembled history buffer of `context.historyType`.
- `helper`: `score`, `composite`, `u24` on the given bytes.
- `clock`: `bytes` is a u32 LE ring time in `context.tz`; `events[0].value` is the instant it decodes to.

`match`:
- `exact`: the events, in order, and nothing else (entries with `"absent": true` are not counted).
- `prefix`: the first events, in order.
- `contains`: each listed event appears somewhere.
- `count`: only the number of events is checked (`count`); listed events are a derived extra, not a Kotlin assertion.
- `ignore`: Kotlin checks nothing about the events.

Event extras: `"absent": true` (no event of that class), `index` (the n-th event of that class), `count` (how many of that class), `capabilities` / `capabilitiesInclude` / `capabilitiesExclude`, and for `SleepTimeline`: `stagesSize`, `stageCounts`, `stagesExclude`, `firstStages`.

## sessions.json

`sessions[]`: `{ name, source, context, steps[], note? }`. A fake peripheral replays the steps in order. Each step may hold, in this order:
- `send`: what the host side starts (`runStartup`, `refresh`, `syncVitalsHistory`, `syncSleepNow`, `querySleep`, `history {types}`, `historyAppend {types}`, `historyCancel`, `engineReset`, `liveMeasurement {enable, mode}`).
- `gatt` / `cccdWritten` / `expectReady` / `expectTopologyFailure`: the subscription gate (see the doc). `expectTopologyFailure: null` means no failure.
- `reconnect`: `"end"` (connectionDidEnd) or `"end+start"`.
- `inject`: an event handed straight to the sync engine (no wire frame), as the Kotlin test does.
- `timer`: `"inactivity"` with `afterMs`: the history watchdog fires.
- `expectWrite` (one frame) or `expectWrites` (several, in order): the next frames written to `be940001`.
- `notify`: frames the ring sends, in order, on `context.channel`.
- `expectEvents` + `match`: what the notifications decode to.
- `expectNoWrite: true`: nothing is written by this step.

The write order assumes Lumen's FIFO write queue: a command batch (the whole startup sequence and the first history query) is queued before any reply is handled, so writes caused by a reply land behind it. A port that waits for each reply may interleave differently; what must hold is the order within each batch and the history query order. The ring's replies to `02 03`, `01 00`, `02 07` and the settings writes are not modelled (there are no Kotlin vectors for them). Notifications sit on the stream characteristic as in the Kotlin tests; which characteristic the real ring answers each command on is unverified.

## Counts and validation

39 encode vectors, 85 decode vectors, 47 sessions (201 steps). A throwaway validator (kept out of git) loads the three files, parses every hex string, recomputes the length and CRC16 of every frame (516), checks `frame(logical)` and the two literal frames from the Kotlin tests, and replays the `frame`, `assembler`, `decoder`, `healthRecords`, `helper` and `clock` vectors through a small independent JS port of the Kotlin logic.
