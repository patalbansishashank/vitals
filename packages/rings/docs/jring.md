# Jring family ("56ff", generic SMART_RING rings): protocol notes for the port

Research for R19. Everything here is read from the Lumen Kotlin and its unit tests. No ring was touched. Things the Kotlin guesses or never checks are marked **unverified**. Fixtures: `qa/fixtures/rings/jring/`.

Family id `jring`. Not the J-Style 2301 (different protocol, different file). Not Colmi, CRP or YCBT, although some of those rings advertise the same generic name.

## Sources

The protocol comes from the Kotlin app that grew out of the upstream PulseLoopAndroid project. Upstream has no licence file; the owner accepted that (plan decision 3). Read files (all under `app/src/main/java/com/pulseloop/` unless noted):

- `ring/RingProtocol.kt`, `RingEncoder.kt`, `RingDecoder.kt`, `RingDecodedEvent.kt`, `JringDriver.kt` (driver, coordinator and `JringSyncEngine`), `JringClock.kt`, `DriverReroute.kt`, `ReconnectBackoff.kt`, `ConnectionPriorityPolicy.kt`, `RingEventBridge.kt`.
- `ring/RingBLEClient.kt` (connect order, keepalive, watchdog, write type) and `service/RingSyncCoordinator.kt`, `service/EventPersistenceSubscriber.kt` (sync timers, spot windows, what is done with sleep and activity).
- Tests (`app/src/test/...`): `RingDecoderTest`, `JringClockTest`, `ExistingFamilyRefreshContractTest`, `PairingMatchingTest`, `AdvertisementMatcherTest`, `DriverRerouteTest`, `ConnectionPriorityPolicyTest`, `RingEventBridgeTest`.

The vendor SDK behind the ring is the "keepfit" SDK; Kotlin comments quote its method names (`getBandFunction`, `setAppId`, `triggerActivityReportByDays`). We did not read it.

## Recognising the ring

`JringCoordinator.matches(name, advertisement)`:

1. The advertised name is exactly `SMART_RING` **and** the advertisement does not carry a Colmi UART service (`6e40fff0-b5a3-f393-e0a9-e50e24dcca9e` or `de5bf728-d711-4e47-af26-65e3012a5dc7`). Some Colmi/Yawell R11 units use the same generic name; Colmi claims them.
2. Or the advertisement lists service `000056ff-0000-1000-8000-00805f9b34fb`.
3. Or the manufacturer data, as lower-case hex of the on-air block (company id first, little-endian, then the vendor bytes), contains `41422ec75b6a` anywhere.

Registry order in Lumen: J-Style 2301 is asked first, then Jring, then the rest. The match is not exclusive: `SMART_RING` alone does not prove the family. Other names (`R02_…`, `R10M …`) never match.

Proposed `ScanMatch`:

- `requestFilters`: `{ name: 'SMART_RING' }` and `{ services: [56ff] }`. Rule 3 cannot be a Web Bluetooth filter (the company id is not known), so it lives only in `match()`.
- `optionalServices`: `56ff`, `180f` (battery), `180a` (firmware string). Add `fdda` and the two Colmi UART services if the platform should be able to reroute after connecting (see Routing); Web Bluetooth hides services that were not listed.
- `modelFromAdvertisement`: `SMART_RING` gives model `SMART_RING`.

### Routing after connect (the "SMART_RING" ambiguity)

After service discovery Lumen may swap driver (`RingBLEClient`, `DriverReroute`):

- Driver is Jring and the table has a Colmi UART service: switch to Colmi.
- Driver is Jring (or Colmi) and the table has `fdda` and no Colmi UART service: switch to CRP. (This is the case where a "SMART_RING" ends up CRP, not Jring.)
- Driver is something else only because the person picked another model, the scan said "generic SMART_RING", the table has `56ff` and none of that driver's own services: switch to Jring. Never when the scan was a confident match for the other family.

A port keeps one rule: decide the family from the discovered services when the advertisement is only the generic name. In the TS library that means `Transport.services()` plus a re-open with the right `RingFamily`.

## GATT

| What | UUID | Use |
|---|---|---|
| Service | `000056ff-0000-1000-8000-00805f9b34fb` | the family service |
| Write | `000033f3-0000-1000-8000-00805f9b34fb` | commands, 20 bytes. Kotlin picks write-with-response when the characteristic allows it, else without response. No `command` channel. |
| Notify | `000033f4-0000-1000-8000-00805f9b34fb` | all replies and pushes, plain notification (CCCD value 01 00) |
| Battery | `00002a19-0000-1000-8000-00805f9b34fb` in service `0000180f-…` | read once after connect; byte 0 is the percent. Not subscribed. |
| Firmware string | `2a26` (and `2a28`) in any service, usually `180a` | read once after connect, ASCII, trimmed. The ring exposes them even without advertising `180a`. |

`GattMap`: `service` 56ff, `write` 33f3, `notify: [{ characteristic: 33f4, mode: 'notify' }]`, `battery: { service: 180f, characteristic: 2a19 }`, `deviceInfo: { service: 180a, firmware: 2a26 }`. The 0x0C reply also carries a firmware string, which Lumen treats as the authoritative one.

Lumen also asks for MTU 512 on Android before discovering services, because the stack drops discovery if it overlaps the MTU exchange. 20-byte packets do not need it. On Chromium the MTU is unknown; that does not matter here.

## Packet format

Every packet, both directions, is exactly 20 bytes: byte 0 is the command id, bytes 1..19 the payload, zero padded. No length byte, no checksum, no framing. Multi-byte integers are little-endian. A notification that is not exactly 20 bytes is not decoded (it becomes `Unknown` carrying the first byte as id), not even a longer one. Reads of unknown ids are harmless.

Writes go through one queue, one at a time. Lumen retries a rejected write up to 6 times, 200 ms apart, and forces a reconnect after 3 consecutive dropped or timed-out writes (the Android stack can wedge). A single write has a 4 s completion timeout.

## Commands the app writes

Fixtures: `encode.json` (33 frames; `asserted: true` means a Kotlin test checks the bytes, otherwise the frame comes from reading the encoder).

| Id | Name in `RingCommandID` | Frame the encoder builds (byte index: meaning) |
|---|---|---|
| 01 | TIME_SYNC | 1..4 u32le = UTC epoch seconds + UTC offset seconds (local wall-clock seconds); 5 = offset in whole hours as a signed byte, integer division toward zero (+05:30 sends 5). |
| 02 | USER_INFO | 1 = age (low 7 bits, clamped 0..127) OR 0x80 when male; 2 = height cm; 3 = weight kg (clamped 0..255); 4 = 0 (metric, always). Default profile sent on connect: age 25, male, 184 cm, 90 kg = `02 99 b8 5a`. |
| 04 | FIND_RING | `04 0a`. |
| 0C | STATUS | `0c` + zeros (asks for device info). |
| 10 | HISTORY_SUMMARY | 1 = number of days, clamped 0..27. Returns activity (0x10) and sleep (0x11) streams. |
| 14 | HEART_RATE_SAMPLE_OR_START | `14 b4`: start live heart rate. Byte 1 is a vendor constant (180); its meaning is not documented. |
| 15 | HEART_RATE_STOP | `15` + zeros. Stops any heart-rate measurement. |
| 16 | HISTORY_MEASUREMENT_STREAM | `16` + zeros: request the heart-rate history stream. |
| 19 | AUTO_HR_MODE | 1,2 = start 00:00; 3,4 = end 23:59 (`17 3b`); 5 = enabled (1/0); 6 = cadence minutes (min 1; Lumen sends 30); 7 = constant 01. Arms the ring's background logging; without it the ring records almost nothing. |
| 1A | STEP_GOAL | 1..4 u32le steps. |
| 20 | DEVICE_CAPABILITIES | `20` + zeros: ask for the feature bitmask. |
| 21 | LOCALE | 1..19 = ASCII locale (`en-US`), zero padded. |
| 23 | COMBINED_MEASUREMENT | 1 = mode: 2 starts SpO2 and also returns the combined 0x24 reply; 0 stops. Mode 1 is a blood-pressure run, never used. SpO2 start and combined start are the same frame. |
| 33 | (not in the enum) | blood-pressure calibration: 1..2 systolic u16le, 3..4 diastolic u16le. Sent only when the person stored a cuff reference. |
| 3A | KEEPALIVE_PING | `3a` + zeros, every 15 s while connected. The ring never answers it. |
| 48 | APP_IDENTIFIER | 1..18 = ASCII app id, zero padded. Lumen's id is `PL` + 14 hex characters, generated once per install. The ring binds to the id of the app it talks to and can stay mute if another app claimed it. |
| 4B | (not in the enum) | bind: 1 = action (0 INIT, 1 APP_START, 2 ACK, 3 ACK_CANCEL, 4 SUCCESS, 5 UNBOND, 6 UNBOND_ACK), 2 = state (0 no, 1 yes), 3 = type (always 1). |

Ids declared in `RingCommandID` that the app never writes and the decoder does not read: 03 CURRENT_ACTIVITY (the ring pushes it), 05 ANTI_LOST, 06 DEVICE_COMMAND, 07 CAMERA_MODE, 0B PERCENT_STATUS (the ring pushes it), 0D ALARM, 0E DEVICE_MODE, 12 ALERT_NOTIFICATION, 13 ACTIVITY_SUMMARY, 1B DEVICE_SETTINGS, 1D HOUR_FORMAT, 22 WEATHER, 25 SPORT_REPORT, 26 HR_ALERT_AREA, 31 REMINDER, 34 WALLPAPER, 3E SPO2_TOGGLE (a trap: it never started SpO2), 44 MENSTRUAL_CYCLE. 0x52 is "set app state", not temperature; the ring has **no temperature sensor** (capability bit 10 is not set on these rings).

## Replies and pushes the decoder reads

Fixtures: `decode.json` (55 vectors, 5 clock vectors; `asserted: true` means a Kotlin test checks it).

| Id | Meaning | Layout |
|---|---|---|
| 01 | time-sync echo | 1..4 u32le ring clock, local wall-clock seconds. Whether the ring really echoes its new clock is **unverified**. |
| 02 | acknowledgement | no payload read. |
| 03 | activity so far today (pushed on connect) | 1..4 ring time; 5..8 steps; 9..12 distance in metres; 13..16 calories (kcal vs small calories **unverified**). All u32le, cumulative for the ring-local day. |
| 0B | battery | 1 = percent (0..100); 2 = 1 when charging (any other value is not charging). |
| 0C | device info | 3..8 = six address bytes shown as `AA:BB:CC:DD:EE:FF` (byte order vs the over-the-air address **unverified**); firmware string = `%04X` of u16le(9..10) + `%04X` of u16le(11..12) + `V` + decimal u16le(1..2), e.g. `003A002AV138`. |
| 10 | activity history | 1..4 base time; 5..19 = 15 one-byte step counts, one per minute from the base time. Distance is not carried. |
| 11 | sleep history | 1..4 base time; 5..19 = 15 one-byte stage codes, one per minute. Stage: 0 awake, 1..0x4f light, 0x50 and above deep. Never REM. |
| 14 | live heart rate | 1..4 ring time (zero means the ring could not read: bpm 0, error); 5 = bpm; 6 = "sleep status" (meaning unknown, ignored). |
| 16 | heart-rate history | byte 1 is the sub-type. `f0` header (1 progress marker; total packet count at 6..7 per a comment, not read). `aa` index block (not read). `a0` data block: 2..5 base time; 8..13 six samples, 14..19 six samples; each group is averaged and rounded half up to one reading; a zero average is skipped; second reading is stamped base + 60 s. `ff` the stream is finished. Other sub-types: the first non-zero byte from byte 8 on is one reading at the time in 2..5, else it is an ack. |
| 20 | capabilities | 19 payload bytes = bit array: bit n is byte n / 8, mask `1 << (n % 8)`. Bit order inside a byte is an assumption (**unverified**). Bit 10 temperature (not set on these rings), bit 65 SpO2 uses its own mode, bit 81 SpO2 offline history, bit 83 pressure history. Nothing branches on them yet. |
| 24 | combined measurement result | 1 HR bpm; 2 systolic mmHg; 3 diastolic mmHg; 4 SpO2 %; 5 fatigue 0..100; 6 stress 0..100; 7 blood sugar in mmol/L x 10 (stored as mg/dL: raw / 10 x 18.016); 8 is HRV in the vendor app but is not read. A zero field is skipped, except systolic is emitted when systolic or diastolic is non-zero. SpO2 outside 80..100 is skipped. Timestamps are the phone clock at decode time. Blood sugar is a profile-derived estimate by the vendor, not a measurement. |
| 27 | measurement ended (`SENSOR_COMPLETE`) | no payload. Lumen reads it as "the heart-rate run ended"; with no reading yet it aborts the run. When the ring sends it is **unverified**. |
| 28 | measurement ended (`BLOOD_DATA_NOTIFY`) | no payload. Same for SpO2. |
| 3F | SpO2 result | 1 = percent; 80..100 is a result, anything else is "still measuring". |
| 4B | bind notification | 1 = action, 2 = state (see the write table). |
| F6 | firmware number | u16le at 4..5. The ring sends two kinds of F6 record and one decodes to a bogus 2704; Lumen ignores it. |

## Connect handshake (what Kotlin does, in order)

1. Connect, request high priority and MTU 512 (Android), settle 500 ms, discover services. A hung connect is abandoned after 30 s.
2. Write the CCCD of 33f4. Only when it succeeds is the link "connected". A CCCD failure fails the attempt.
3. Read battery `2a19` and the firmware characteristics. Reads are queued after the CCCD.
4. `RingSyncCoordinator` then runs, in this order: write 0x48 app id (every connect), then `runStartup`: `0c` status, `01` time sync (latching the clock offset first), `21` locale, `02` default user info, `19` auto heart rate (enabled, 30 min), `20` capabilities, `10` history (3 days on the first pass of a connection, 1 day on every later pass), `16` history stream. Then `02` again with the person's real profile if age, height and weight are known, and `33` if a cuff reference is stored.
5. Pushes that may follow at any time: `03` activity totals, `0B` battery, `4B` bind INIT (answered with `4b 01 00 01`; on ACK, `4b 04 00 01`).
6. Start the 15 s keepalive.

Kotlin writes all of these without waiting for replies. Nothing blocks on the 0x0C reply; a port that wants the firmware string for `HandshakeInfo` must wait for it, bounded (suggest 4 s, then continue with the 2a26 value). Session fixtures: `connect handshake`, `ring-driven bind handshake`.

Proposed `HandshakeInfo`: `firmware` from 0x0C (fallback 2a26, else empty), `battery` from the 2a19 read, `serial` = the 0x0C address text when it is not all zero (identity by serial is then the same on every platform, and Chromium never sees the real Bluetooth address), `clockOffsetS` = 0 (the phone sets the ring clock; the echo is not a verified readback).

Forget: write `4b 05 00 01` and wait up to 1.5 s for action 6 (or 3) before dropping the link.

## History sync

One request, three streams, no sleep-only request:

1. `10 nn` (nn = days, 3 then 1). The ring replies with `0x10` (activity, 15 minutes per packet, so about 96 packets per day) and `0x11` (sleep, 15 minutes per packet). Both are self-dated by the base time in bytes 1..4, so a day is identified by the reply, not by the request. A day the ring has nothing for yields no packets. The Kotlin comment says the last activity packet of a day starts at 23:45 local time; nothing in code uses that.
2. `16 00`: the heart-rate history. Packets: `f0` header, `aa` index, a run of `a0` data blocks (two readings each), then `ff` as the end marker.
3. Kotlin sends 1 and 2 back to back; replies are not tied to the request, so a port must tolerate interleaving, or send them one after the other and wait.

Terminal conditions in Kotlin (there is no protocol terminator for 0x10 or 0x11):

- `16 ff` becomes the sync-finished event, which is the only real end marker.
- The progress bar maps each record time onto the window [now minus 1 day, now]; a record at or past now ends it.
- A stall of 12 s without any history record (checked every 2 s) ends it; with no record at all it is dropped silently. Priority goes back from high when it ends.

For the port: plan `[historyQuery(days), historyMeasurementQuery]`; the session finishes `0x16` on `ff`, or on a stall; suggest `stallMs` 12000 and a quiet window of a few seconds for `0x10` (**unverified**: no data on the real inter-packet timing).

The sleep timeline arrives as consecutive 15-minute packets of one-minute stage codes. Lumen merges them per waking day downstream (sleep from 7 pm rolls to the next morning), replacing only the minutes a packet covers. Packets older than 8 days or more than 1 hour in the future are dropped. Whether the ring also sends packets for waking minutes before and after the night, and the order of 0x11 against 0x10, is **unverified**.

Re-syncing the same days is harmless: activity buckets upsert by time, history measurements dedupe on (kind, time).

## Live heart rate and spot measurements

Live heart rate: write `14 b4`; the ring pushes `0x14` about once a second. A zero time stamp means no reading. Stop: write `15`, then write `19 …` again (stop disables the background logging, so Lumen re-arms it). `startHeartRate` is idempotent.

Spot heart rate: same start. The coordinator listens for 30 s, ignores the first 5 s (the ring replays a cached value) and settles by a consistency check. A `0x27` that arrives while no reading has come in yet means the ring gave up (for example worn badly): the run is aborted as "no reading". It stops with `15` plus the `19` re-arm.

Spot SpO2 and the combined measurement: write `23 02`; the ring answers with one `0x24` packet carrying HR, blood pressure, SpO2, fatigue, stress and a blood sugar estimate (mode 2 returns the full packet). The SpO2 leg is up to 60 s, the combined window 45 s, then `23 00`. `supportsCombinedMeasurement` is true for this family, so Lumen uses the single-packet flow rather than separate legs. A `0x28` while no SpO2 value has arrived yet aborts a separate SpO2 leg the same way (the combined flow does not use it). When the ring sends `0x27` and `0x28` is otherwise **unverified**.

Session fixtures: `live heart rate`, `spot heart rate`, `spot SpO2`, `combined`.

## Clock rules (`JringClock`)

- The ring's clock runs on **local wall-clock seconds**: the time sync frame carries `utcEpoch + utcOffset`, plus the offset in whole hours. Every history time the ring stamps is therefore local; the decoder subtracts the offset latched at the last time sync. Both halves must move together. One clock per connection.
- The offset is latched when `01` is built (`capture`), not when a packet is decoded. DST is included because the offset is read at that instant.
- Re-push: `resyncTime()` latches again and writes `01`. In Lumen nothing calls it; every reconnect re-syncs, and a timezone change while connected stays wrong until then. The port should call it on timezone or wall-clock change.
- The ring clock is never read back to measure drift. `HandshakeInfo.clockOffsetS` is 0.
- **Kotlin quirk, fixed in the port:** the Kotlin decoder applies the offset to 0x01, 0x03, 0x11 and 0x16 but **not** to 0x10 (activity buckets) and **not** to 0x14 (live HR), using those times as if they were UTC, so Lumen's activity buckets sit one UTC offset late. The port applies it to all of them (port note 1). Vectors `0x10 activity history: the clock offset is applied` and `0x14 live heart rate with timestamp` pin the port's result; the first-pass history session runs at +05:30.

## Link keeping, reconnect, priority

- Keepalive `3a` every 15 s while connected (Jring only; the same id is something else on Colmi). The ring would otherwise drop the link after about 20 s idle (a Kotlin comment). The ring never echoes it, so the liveness check is "any GATT write ack, read or notification".
- Stale link: no GATT activity for 50 s while connected means a zombie link; Lumen reconnects (after two consecutive stale ticks once the link is older than 2 minutes). Watchdog tick 15 s, 60 s when the link is stable and idle.
- Reconnect (`ReconnectBackoff.kt`) is the shared `ANDROID_RECONNECT`: delays 5, 15, 30, 60, 120, 300 s; GATT status 133, 22 and 62 are transient (the first two attempts use the 5 s delay); status 257 waits for Bluetooth to come back. Note: in Kotlin the unattended watchdog **parks** once six attempts are used (`atCeiling`), until the person opens the app or asks to reconnect (this resets the counter); the TS contract comment "the last repeats" is true of the delay list, not of the unattended loop.
- Link priority (`ConnectionPriorityPolicy`): active work (sync, a spot measurement, a workout stream) gets `high`; otherwise Jring sits at `balanced` and never drops to `low_power` (the 5-minute downgrade other families get is not even scheduled). The code gives no reason. The author's optimisation notes say why: the 15 s keepalive is a protocol requirement, and `low_power` (connection interval up to 2 s) risks the write acknowledgement arriving late against the 50 s stale limit, so `balanced` was chosen as the floor. As a `PriorityPolicy`: `{ active: 'high', idle: 'balanced', idleLowPowerMs: 300000, idleLong: 'balanced' }`. Only Android can act on it.

## Mapping to RingEvent

Shared by every family port. Kotlin's `RingDecodedEvent` is a sealed class; below, every case, and where it goes in `packages/rings` (`RingEvent`). Times: the TS side uses epoch **milliseconds** for `t`, `start` and `localDay` (as `src/biometrics/core/events.ts` does; `types.ts` itself does not state the unit). Units follow the existing decoders: `bpm`, `pct`, `degC`, `ms`, `count`, `m`. `proposed` = not Kotlin behaviour.

Kotlin gates (RingEventBridge), to keep: HR 30..220; SpO2 70..100; stress and fatigue 1..100; HRV 1..300; temperature 30..45; systolic 60..250; diastolic 30..150; glucose 20..600 mg/dL; activity bucket steps 0..5000 and distance 0..6000; history values and sleep within [now minus horizon (8 days), now plus 1 hour]; battery 0..100.

| Kotlin class (fields) | Produced by | RingEvent |
|---|---|---|
| `HeartRateSample(bpm, timestamp, sleepStatus, isError, measurementResult, measurementStream)` | 0x14, and 0x24 byte 1 | `sample{stream:'hr', t, value:bpm, unit:'bpm', origin}`. `origin` is `'live'` for 0x14 during a live stream, `'spot'` for 0x14 during a spot HR run and for 0x24. `isError` (bpm 0): no event. `sleepStatus`: dropped. `measurementResult`, `measurementStream`: never set by this family. |
| `Spo2Result(value, timestamp)` | 0x24 byte 4, 0x3F | `sample{stream:'spo2', unit:'pct', origin:'spot'}`. |
| `Spo2Progress(percent, timestamp)` | 0x3F with a value outside 80..100 | none. |
| `StressSample(value, timestamp, isHistory)` | 0x24 byte 6 | `vendor{key:'stress', unit:'', origin:'spot'}`. |
| `HistoryMeasurement(kind_field, value, timestamp, historyHorizonDays, provenance)` | 0x16 a0 blocks, 0x24 | by `kind_field` (`MeasurementKind`): `HEART_RATE` to `sample{hr, 'bpm', origin:'history'}`; `BLOOD_PRESSURE_SYSTOLIC` to `vendor{key:'bp_sys', unit:'mmHg', origin:'spot'}`; `BLOOD_PRESSURE_DIASTOLIC` to `vendor{key:'bp_dia', unit:'mmHg'}`; `FATIGUE` to `vendor{key:'fatigue', unit:''}`; `BLOOD_SUGAR` to `vendor{key:'glucose', unit:'mg/dL'}` (an estimate, label it so; no clinical claim). The other kinds (`SPO2`, `STRESS`, `HRV`, `TEMPERATURE`, `RESPIRATORY_RATE`, `VO2MAX`) are not produced by this family; the general rule: `SPO2` to `sample spo2 'pct'`, `HRV` to `sample hrv 'ms'`, `TEMPERATURE` to `sample skin_temp 'degC'`, `RESPIRATORY_RATE` to `sample resp_rate`, the rest to `vendor` with the Kotlin `key` and `unit` (`stress`, `fatigue`, `vo2max`, `bp_sys`, `bp_dia`, `glucose`). `historyHorizonDays` becomes the plausibility window. `provenance` (`device_history` or `vendor_history`) is dropped. |
| `ActivityBucket(timestamp, steps, distanceMeters)` | 0x10 | `activityBucket{start, durS:60, steps}`; omit `distanceM` when the source has none (Jring always sends 0). |
| `ActivityUpdate(timestamp, steps, distanceMeters, calories, activeMinutes, replaceActiveMinutes)` | 0x03 | `dailyTotal{localDay, steps, distanceM, kcal}` with `localDay` = midnight (UTC ms) of the ring's local date; `activeMinutes` (`activeS` = minutes x 60) when present, and `replaceActiveMinutes` means the day total is authoritative for it. Calories unit unverified. |
| `SleepTimeline(timestamp, stages, completeSession, historyHorizonDays)` | 0x11 | `sleepEpochs{start, epochS:60, stages, rawCodes, firmware, complete:completeSession}`. `SleepStage` `LIGHT, DEEP, AWAKE, UNKNOWN, REM` to `'light','deep','awake','unknown','rem'`. Keep the raw stage bytes in `rawCodes` (Kotlin throws them away). Jring never sets `completeSession`, so `complete:false`. Contiguous packets (start + 15 min) may be coalesced into one event (proposed). |
| `HeartRateComplete(timestamp)`, `Spo2Complete(timestamp)` | 0x27, 0x28 | `status{key:'ack', value:'hr_complete' | 'spo2_complete'}` (proposed); the session or service treats it as "run ended" and, if no sample came in during a spot run, as "no reading". |
| `MeasurementComplete(mode, success, timestamp)` | YCBT only | `status{key:'ack', value:'measurement_complete:<mode>:<ok|fail>'}` (proposed). |
| `MeasurementRejected(mode)` | YCBT only | `status{key:'error', value:'measurement_rejected:<mode>'}`. |
| `SportTelemetry(bpm, timestamp)` | Colmi only | none (the bpm arrives separately as a `HeartRateSample`). |
| `TimingHistoryFrame(cmd, day, frameIndex)` | CRP only | none; the protocol's `ingest` returns `send` for the next frame instead. |
| `HistorySyncProgress(stage)` | 0x16 f0, aa | `progress{stage, done:false}`. |
| `HistorySyncFinished` | 0x16 ff | `progress{stage:'hr_history', done:true}` here; `done` closes the whole sync, so the session should instead emit the final `done` after every planned read (proposed). |
| `Battery(percent, charging)` | 0x0B, and the 2a19 read | `status{key:'battery', value:percent}` and, when the source says so, `status{key:'charging', value:1|0}`. |
| `Status(address, firmware)` | 0x0C | `status{key:'firmware', value}` and `status{key:'serial', value:address}` when not all zero (proposed). |
| `FirmwareVersion(version)` | 0xF6 | none (it is diagnostic only). |
| `FirmwareRevision(version)` | CRP, 2a26 string | `status{key:'firmware', value}`. |
| `AuthenticationResult(accepted)` | J-Style 2301 only | `status{key:'auth', value:'accepted' | 'rejected'}`. |
| `BindNotify(action, state)` | 0x4B | none; the protocol answers it through `send` (INIT to APP_START, ACK to SUCCESS). Lumen's `PulseEvent` has none either. |
| `BandFunction(capabilities)` | 0x20 | `status{key:'capabilities', value:<19 payload bytes as spaced hex>}` (proposed). |
| `SupportFunctions(capabilities)` | YCBT only | `status{key:'capabilities', value:<comma list of capability keys>}`. |
| `ChipScheme(value)` | YCBT only | none (diagnostic). |
| `WearingStatus(worn, timestamp)` | YCBT only | `status{key:'ack', value:'worn' | 'not_worn'}` (proposed; no contract key for wear). |
| `HrvSample(value, timestamp)` | other families | `sample{hrv, 'ms'}`. |
| `TemperatureSample(celsius, timestamp, isHistory)` | other families | `sample{skin_temp, 'degC', origin: isHistory ? 'history' : 'spot'}`. |
| `VendorMetric(key, value, unit, timestamp, isHistory)` | other families | `vendor{key, value, unit, t}`. |
| `BloodPressureSample(systolic, diastolic, timestamp, isHistory)` | other families | two `vendor` events `bp_sys` and `bp_dia` (`mmHg`). |
| `BloodSugarSample(mgdl, timestamp)` | other families | `vendor{key:'glucose', unit:'mg/dL'}`. |
| `TimeSyncAck(timestamp)` | 0x01 | `status{key:'ack', value:'time_sync'}` (proposed). The ring time is not turned into `clock_offset_s`. |
| `CommandAck(commandId)` | 0x02 and fallbacks | none worth keeping; `status{key:'ack', value:'cmd_0x02'}` if the session wants a trace. |
| `FramePending(raw, startsFrame)` | framed families (CRP, YCBT) | none (diagnostics only). |
| `Unknown(commandId, raw)` | anything undecoded | none; log the hex. Never put it in a record. |

Two Kotlin details to carry: a `PulseEvent` of any of these also marks the sync window progress, and `RingEventBridge` drops values that fail a gate silently.

## Unverified and open

Unverified in the Kotlin (no hardware captures in the tests; "hex dumps captured on real hardware" is claimed in the test header but none of the vectors is a capture):

- Bit order inside each capability byte. Whether the ring echoes `01` and what `01` really means. Calories unit in `03`. Byte order of the `0c` address. What byte 6 of `14` is. What `14 b4` byte 1 is. Contents of the `16 f0` and `16 aa` packets beyond the packet count. When `27`, `28`, `0B` and `4B` INIT are sent.
- Whether `0x10` and `0x14` times are local wall-clock like the others (see Clock). Whether `days` 0 is valid, and whether `days = 1` includes today.
- The `a0` block: 12 samples averaged as 6 + 6 and stamped 60 s apart is odd if the samples are one per minute (the two readings would be 6 minutes apart). Kotlin trusts the vendor app's example. Treat the second timestamp as uncertain.
- Whether sleep packets exist for waking minutes, and the order of the streams.
- Inter-packet timing of a history read (no quiet window is known, only the 12 s stall).

Open questions for the port author:

1. Fix the clock quirk (apply the offset to 0x10 and 0x14) or copy Kotlin? Decided: fixed (port note 1); a capture from a real ring would confirm it.
2. The app id: one per install (Lumen) or one per Vitals install? It claims the ring; two apps compete. Suggest `VT` + 14 hex characters, generated once, sent first on every connect.
3. Wait for the 0x0C reply in the handshake (suggested) or fire and forget like Kotlin?
4. Coalesce sleep packets, and who marks a night `complete`?
5. `origin` of `0x14` samples: `live` for a stream, `spot` for a spot run; the protocol cannot tell, the session knows.
6. Should blood pressure, stress, fatigue and the blood-sugar estimate be kept at all? They are vendor estimates; this doc keeps them as `vendor` events without claims.
7. Are `status` keys `'ack'` for completions acceptable, or does the contract want new keys?

## Port notes (`packages/rings/src/jring`)

Decisions taken in the TypeScript port, where the Kotlin was open or the library shape differs:

1. **Clock quirk fixed.** Every ring-stamped time has the latched offset taken off, 0x10 activity buckets and 0x14 live heart rate included (Kotlin leaves those two raw). Why: the time sync writes UTC + offset, `JringClock`'s own header says every ring timestamp must have the offset taken off and that encoder and decoder must move together, and the port's "caught up" rule (note 5) already read the 0x10 base as local. Copying the quirk left steps one UTC offset in the future (at +05:30 a bucket at 11:45Z came out as 17:15Z), steps and sleep of one night apart by the offset, and the steps cursor ahead of now, while the read still counted as caught up. Caught-up now compares the offset-free 0x10 time with the phone's UTC now. The decode vectors for 0x10 and 0x14 and the first-pass history session (+05:30) pin it; `pause.test.ts` checks both directions at +05:30. UNVERIFIED on a real ring (no capture).
2. **App id.** `createJringFamily({ appId })`; the exported `jring` sends the fixed `JRING_DEFAULT_APP_ID` (`VT00000000000001`) as 0x48 first on every connect, so phone, PC and server are one "app" to the ring. `appId: null` sends none (what the session fixtures script).
3. **0x0C is waited for** (4 s, `REPLY_MS`); every other startup write is fire-and-forget as in Kotlin. Firmware falls back to the 2a26 string (read in 180a only), battery comes from the 2a19 read. The 0x0C address, when not all zero, is `HandshakeInfo.serial`. `clockOffsetS` is 0.
4. **History tail of `runStartup` is `planSync`** (`10 nn` then `16 00`, days 3 on the first pass of a connection, 1 after). The person profile (0x02) goes at the end of the handshake, after the default one, as Kotlin does after `runStartup`.
5. **Timing.** A quiet window of 4 s (`QUIET_MS`, unverified) never ends a read that still expects packets: 0x16 until `16 ff`; 0x10 until its newest packet (offset taken off) runs to within 15 minutes of now (Kotlin: a record at or past now). The read keeps waiting up to Kotlin's 12 s stall in all, then ends with `status:error partial:<stream>:<packets>` (for 0x10 both `sleep_stage` and `steps`) and emits no cursor. A quiet timeout before the first packet of the read counts as stall time as well, so a push that is not part of the read (battery, a late 0x27) and switches the session to the quiet window does not end it early; a read that gets no packet of its own within the 12 s ends silently (Kotlin).
6. **Cursor** `jr1:<newest record epoch s>` per stream (`hr`, `steps`, `sleep_stage`). Kotlin keeps none and the planner does not use it to narrow the window.
7. **0x03 day totals** become `dailyTotal` with `localDay` = the instant of the ring-local midnight (what `records.ts` expects), not the UTC midnight of the local date proposed in `sessions.json`.
8. **Spot runs.** `hr` rides 0x14 (stop: 0x15 then the 0x19 re-arm); `spo2` and `stress` are the 0x23 mode 2 run that one 0x24 packet ends. A 0x27 / 0x28 with no reading since the last completion gives `status:error no_reading` and ends the run. During a 0x10 or 0x16 history read a 0x27, 0x28 or 0x24 (background logging) is decoded but neither ends the read nor says `no_reading`. The first-5-seconds cached-value discard of Kotlin's coordinator is left to the service.
9. **Keepalive** is `jringKeepalive` every `JRING_KEEPALIVE_MS` (15 s), sent by the session itself through the shared write queue while connected (also during a sync; the ring's reply, if any, is `unrelated`); forget is `jringForget` (waits 1.5 s for UNBOND_ACK); re-push the clock with `jringResyncTime` on a timezone change.
10. **Priority** follows `ConnectionPriorityPolicy`: idle never drops below `balanced`.
