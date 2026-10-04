# LuckRing family (TK18 and relatives) — R19 research

Family id `luckring`. Company id `0xFF64`. The vendor SDK calls its protocol "K6". Everything below is read from the
Kotlin driver and its unit tests; nothing here was measured on a ring in this task. Items I could not pin down are
marked **unverified** and collected at the end.

## Sources

The Kotlin comes from upstream PulseLoopAndroid (package `com.pulseloop.ring`, Lumen's `LuckRing*.kt`). That repository
has no licence file; the owner accepted this (plan decision 3). The Kotlin in turn says it was checked against a
decompile of the vendor SDK (opcodes, framing, struct layouts); that decompile is not available here, so the Kotlin
comments are the only claim of ground truth.

Read for this document:

- `LuckRingProtocol.kt` (UUIDs, framing, opcodes, MixInfo TLV), `LuckRingEncoder.kt`, `LuckRingDecoder.kt`,
  `LuckRingDriver.kt`, `LuckRingHistorySync.kt`, `LuckRingSyncEngine.kt`, `LuckRingCoordinator.kt`.
- Tests: `LuckRing{Decoder,Driver,Encoder,HistorySync,Protocol,SyncEngineGate}Test.kt`, the LuckRing cases in
  `AdvertisementMatcherTest.kt` and `PairingMatchingTest.kt`.
- Shared: `RingDecodedEvent.kt`, `RingEventBridge.kt` (plausibility gates), `ReconnectBackoff.kt`,
  `ConnectionPriorityPolicy.kt`, the notify/write code in `RingBLEClient.kt`, `WearableModel.kt` (name pattern),
  `WearableDriver.kt` (`AdvertisementMatcher`).

Golden fixtures for this family are in `qa/fixtures/rings/luckring/` (see its README). All packets are synthetic.

## 1. GATT

| Item | UUID | Properties used | Notes |
| --- | --- | --- | --- |
| Service | `0000f618-0000-1000-8000-00805f9b34fb` | | The only service the driver opens. |
| Notify | `0000b001-0000-1000-8000-00805f9b34fb` | notify | Every reply and data frame arrives here. |
| Write | `0000b002-0000-1000-8000-00805f9b34fb` | write without response | Does not offer plain write; a write-with-response request fails. |
| Heart Rate service | `0000180d-0000-1000-8000-00805f9b34fb` | none | Present on the ring, deliberately not subscribed (the proprietary stream `07` reflects real finger contact). |

Mapping to `GattMap`: `service` f618, `write` b002, `notify: [{ characteristic: b001, mode: 'notify' }]`,
`writeMode: 'withoutResponse'`, no `command`, no `battery` (battery is in-band, data type 3), no `deviceInfo`.

- Subscription modes: Android writes the CCCD value that matches the characteristic's declared property (indicate if
  the characteristic says indicate, notify otherwise). B001 is treated as notify. **unverified** whether B001 also
  declares indicate.
- Required subscriptions before connected: none declared (`requiredSubscriptionsBeforeConnected` is empty). The Android
  client calls the link connected when the first notify CCCD write completes. Nothing is written until then.
- Immediate post-subscription commands: none (`immediatePostSubscriptionCommands` is empty). The startup commands in
  section 6 are sent by the sync engine afterwards.
- No OS bond, no authentication, no passcode, no pairing PIN. Nothing the person has to type.
- MTU: Android asks for 512 before discovery, but every packet is exactly 20 bytes, so the default MTU of 23 (20 bytes
  of ATT payload) is enough.
- Write pacing: one GATT write at a time. A frame of several packets is enqueued as several separate writes. Android
  waits for each write to complete (4 s timeout, up to 6 attempts 200 ms apart, then the link is reset).

## 2. Advertisement match

The family is recognised by any one of:

1. The service `0000f618-0000-1000-8000-00805f9b34fb` in the advertised service UUIDs.
2. Any manufacturer block in on-air layout starting `64 ff` (company id 0xFF64, little endian). The vendor app matches
   on this alone, with no name filter. Android's scan record drops the company id, so the adapter puts it back in front
   of each block, as `AdvertisementMatcher.manufacturerBlocks` does. Every block is tried, not only the first.
3. Advertised name matching the regular expression `^TK18([ _-].*)?$`. This is the only name pattern in the whole
   catalog that maps to this family: it matches `TK18`, `TK18_AA11`, `TK18 x`, `TK18-x`; it does not match `TK5 24AA`
   or `R02_A1B2`.

Test cases in Kotlin: service alone matches (any name, or no name); manufacturer `64 ff 01 02` matches with any name;
`TK18` and `TK18_AA11` match by name; company `0xFF64` + `01 02 03 04 05` with name `Unlabeled` matches; a block list
`[004c 021500, ff64 0102]` matches (the marker need not be first).

Order matters in a family list. Android tries, in order: J-Style 2301, jring, YCBT, Colmi, Colmi SmartHealth, LuckRing,
TK5, RWfit, CRP. A device with a Colmi service and a 0xFF64 block resolves to Colmi (tested). Keep LuckRing after
the families that have a service match of their own.

`ScanMatch` for the port: `requestFilters`: `{ services: [uuid16(0xf618)] }`, `{ manufacturerData: [{ companyIdentifier:
0xff64 }] }`, `{ namePrefix: 'TK18' }`; `optionalServices: [uuid16(0xf618)]`; `match(ad)` implements the three rules above.
`modelFromAdvertisement`: `TK18` when the name pattern matches, otherwise undefined. The catalog calls the model
`TK18`, family label `LuckRing`.

## 3. Frame format

Every write and every notification is a fixed 20-byte packet. All integers are little endian. There is no crypto and no
checksum: the CRC field is always `0000`.

Head packet:

| Offset | Size | Field |
| --- | --- | --- |
| 0 | 1 | `00` (head marker) |
| 1 | 1 | devType (outbound: 1; echoed from the ring in ACKs) |
| 2 | 1 | number of continuation packets |
| 3 | 1 | rolling sequence number |
| 4 | 1 | cmdType (low nibble is used on input) |
| 5 | 1 | dataType |
| 6 | 2 | CRC16, always `00 00` |
| 8 | 2 | payload length |
| 10 | 10 | first 10 payload bytes (zero padded) |

Continuation packet: byte 0 is the 1-based page number, bytes 1..19 the next 19 payload bytes, zero padded to 20.
Continuation count = `ceil((len - 10) / 19)`, 0 when `len <= 10`. Examples: 25 bytes -> head + 1; 67 bytes -> head + 3;
79 bytes -> head + 4.

cmdType: `1` SEND, `2` SEND_NO_ACK, `3` REQUEST, `4` ACK. An unknown value is treated as SEND on input.

Rules:

- The app sends commands as SEND (settings, toggles, actions) or REQUEST (empty payload, asks for a data type).
- The app ACKs every device-initiated SEND once the whole frame has arrived, before decoding it. The ACK is a head
  packet: `[1]` devType and `[3]` seq copied from the ring's frame, `[4]=4`, `[5]` dataType, `[8..9]=01 00`,
  `[10]=01` (accepted). The ring retransmits an un-ACKed SEND. The app never ACKs an ACK or a SEND_NO_ACK.
- Device ACK on input: a head with cmdType 4 is a complete single-packet frame; its payload is the single status byte at
  `[10]`.
- Reassembly (one buffer): a head starts a frame (payload length at `[8..9]`, continuation count at `[2]`). With 0
  continuations the frame is done at once, payload cut to the declared length. Otherwise continuations must come as
  pages 1, 2, 3 in order; a wrong page number drops the whole partial frame. A new head while a frame is open drops the
  open one. A continuation with no open head is ignored. On completion the payload is cut to the declared length (the last
  packet is zero padded). Notifications shorter than 20 bytes are ignored.
- The assembler never validates devType on input.

MixInfo TLV (data types 110 out, 9 in): `[totalLen u16][itemCount u8]`, then per property `[propLen u16 = dataLen + 3]
[propType u8][data]`. `totalLen = sum(propLen) + 1`. Decoding ignores `totalLen` and walks `itemCount` properties.

## 4. Data types

| dataType | Name | Direction | Use |
| --- | --- | --- | --- |
| 2 | DEV_INFO | request / reply | firmware |
| 3 | BATTERY | request / reply | percent |
| 4 | REAL_SPORT | ring | live step buckets |
| 5 | HISTORY_SPORT | request / ring | stored step buckets |
| 6 | SLEEP | request / ring | stored sleep timeline |
| 7 | REAL_HEART | ring | live heart rate |
| 8 | HISTORY_HEART | request / ring | stored heart rate |
| 9 | DEV_SYNC | request / reply | settings; reply is a MixInfo TLV, not decoded |
| 10 | MIX_SPORT | | workout records, not used |
| 11 | FIND_DEVICE | out | buzz the ring |
| 17 | EXERCISE_HEART | ring | workout heart rate, same decoder as 7 |
| 18 | REAL_BP | out toggle / ring | live blood pressure |
| 20 | REAL_O2 | out toggle / ring | live SpO2 |
| 22 | FUNCTION_CONTROL | ring | capability bitmap, not decoded |
| 24 | REAL_HR | out | live heart-rate toggle |
| 40 | HISTORY_O2 | request / ring | stored SpO2 |
| 41 | HISTORY_BP | request / ring | stored blood pressure |
| 42 | HISTORY_HRV | request / ring | stored HRV |
| 45 | REAL_HRV | out toggle / ring | live HRV |
| 46 | REAL_TEMP | out toggle / ring | live temperature |
| 47 | HISTORY_TEMP | request / ring | stored temperature |
| 52 | STRESS | ring | live stress ("body recovery") |
| 53 | STRESS_HISTORY | request / ring | stored stress |
| 102 | USER_INFO | out | profile |
| 103 | LANGUAGE | out | language code |
| 104 | TIME | out | clock |
| 109 | DATA_SWITCH | out | 1 enables the ring's real-time pushes |
| 110 | MIX_INFO | out | the connect bundle |
| 111 | GOALS | out | goals |
| 118 | RESET | | not used |
| 120 | PAIR_FINISH | out (in bundle) / ring | pairing animation flag |
| 124 | CALL_ALARM | out (in bundle) | constant |
| 128 | HEART_AUTO_SWITCH | out | auto-monitoring |
| 159 | UNBIND | out | release the ring |

## 5. Commands the encoder produces

Sequence: the encoder keeps one rolling `seq` per connection, starting at 0, wrapping at 256, incremented per frame it
builds. The history pager keeps its own, separate counter, also from 0. devType is always 1. Only single bytes in the
payloads are flags; `u32` etc. are little endian.

Proposed `RingCommand.op` names and the Kotlin function each comes from (the fixtures use these):

| op | params | cmdType / dataType | Payload |
| --- | --- | --- | --- |
| `startupBundle` | profile fields, `goalSteps`, `languageCode`, `nowMs`, `tzOffsetS` | SEND / 110 | MixInfo TLV of 7 properties, in this order: 102 user info, 104 time, 124 `01 ff ff 00 00`, 103 `[language]` (0), 109 `01`, 111 goals, 120 `00 00`. 67 bytes (4 packets), `totalLen` 65. |
| `userInfo` | `userId`, `sex`, `ageYears`, `heightCm`, `weightKg` | SEND / 102 | 9 bytes: `[userId u32][sex][age][height cm][weight kg][00]`. Sex is inverted: male -> 0, anything else (female, other) -> 1. Age below 1 becomes 20. `userId` is 0. |
| `setTime` | `nowMs`, `tzOffsetS` | SEND / 104 | 9 bytes: `[utcSeconds u32][utcOffsetSeconds u32][format 00]`. Offset is signed seconds written as u32 (negative wraps). Format byte is always 0. |
| `setGoal` | `steps` | SEND / 111 | 16 bytes: `[steps u32][distance u32 = 0][calories u32 = 0][sleep u16 = 0][duration u16 = 0]`. |
| `dataSwitch` | `on` | SEND / 109 | `[on]`. |
| `autoMonitoring` | `hrEnabled`, `hrIntervalMinutes`, `spo2Enabled` | SEND / 128 | 8 bytes: `[autoHR][00][interval min (0..255)][autoSpO2][00 00 00 00]`. |
| `request` | `dataType` | REQUEST / dataType | empty payload (length 0, one packet). |
| `realHeartRate` | `on` | SEND / 24 | `[on]`. |
| `realSpO2` | `on` | SEND / 20 | `[on 00 00 00 00]`. |
| `realHRV` | `on` | SEND / 45 | `[on]`. |
| `realBloodPressure` | `on` | SEND / 18 | `[on 00 00 00 00 00]`. |
| `realTemperature` | `on` | SEND / 46 | `[on]`. |
| `findDevice` | | SEND / 11 | `01`. |
| `unbind` | | SEND / 159 | `01`. |
| `ack` | `dataType`, `seq`, `devType` | ACK / dataType | single packet, see section 3. Raw frame op; `Protocol.ingest` returns it in `send`. |

Notes:

- Sex mapping in the shared profile: the engine receives male/female/other. Android's own mapping is male -> 0, female
  and unspecified -> 1.
- The auto-monitoring frame matters: the ring's firmware default is off, so a ring that never saw the vendor app logs no
  history between syncs until this is sent. The Android engine sends it on every cold connect with HR on, 30 minutes,
  SpO2 on. `hr24h` (continuous mode, byte 1) stays 0.
- `120 pair` is always `00 00`. The first byte set to 1 would make the ring play its pairing animation; Android
  deliberately never sends it.
- Defaults when the app has no profile or goal yet: gender other (sex byte 1), age 0 (-> 20), height 0, weight 0,
  goal 10000 steps.
- `unbind` (159) exists in the encoder but Android's forget flow does not use it (it writes the Colmi/jring unbind
  `4b 05 00 01` for every family). **unverified** that 159 is the right release for this ring. No test pushes it
  into a real forget.
- Time-dependent commands take `nowMs` and `tzOffsetS` from the session (the fixtures record both). Only the UTC seconds
  part of `nowMs` is used.

## 6. Connect handshake

State after connecting: GATT up, B001 subscribed, nothing written. Android runs `runStartup()` (cold pass) from the
sync coordinator once connected. The order of writes, each a separate 20-byte write, is:

1. `startupBundle` (110), 4 packets, encoder seq 0.
2. `autoMonitoring` (128), seq 1.
3. `request` device info (2), seq 2.
4. `request` battery (3), seq 3.
5. `request` settings sync (9), seq 4.
6. The history pager starts (section 7): `request` HISTORY_SPORT (5), pager seq 0.

That is 9 packets. None of them waits for a reply; Android queues them back to back. Replies come as notifications:
device info (SEND 2, `[items, customer, hardware, code, picture, font]`), battery (SEND 3), settings sync (SEND 9, a MixInfo
TLV that is not decoded), and device ACKs for commands the ring accepts (the decoder maps any device ACK to
`CommandAck`). Each reply SEND gets an ACK written back (queued behind whatever is already queued).

Warm pass (a later `runStartup` on the same connection): skips steps 1 to 3, writes battery (seq continues), settings
sync, then restarts the pager. A pass already in flight wins: a second `runStartup` while the pager is running writes
nothing. `reset()` cancels the pager and makes the next pass cold again.

Handshake for `RingFamily.handshake`: no passcode, no bond, no clock read. Run the cold pass commands as above; take
`firmware` from the device-info reply (`1.2.3.4.5` style, five bytes joined by dots), `battery` from the battery reply,
`clockOffsetS = 0` (the ring's clock is never read back), `serial` undefined, `model` from the advertised name, no
`historyBlocked`. A missing reply should not fail the connect (**unverified** what the ring does if the bundle is
rejected; Android never checks).

## 7. History sync

History is not cursor based. The ring replays every stored record of a type as one or more device-initiated data
frames and gives no end marker. `LuckRingHistorySync` is a sequential, time-settled pager.

Catalog, in request order (data types): 5 activity, 6 sleep, 8 heart rate, 40 blood oxygen, 41 blood pressure, 42 HRV,
47 temperature, 53 stress. (Type 10 workout records is skipped. The destructive "clean data" opcode 207 is never
sent.) A shorter list is used after a workout: `[8, 40]` (heart rate, blood oxygen).

Algorithm:

1. `start(types)`: if a pass is already running, ignore it. Otherwise queue the types and advance.
2. `advance()`: cancel both timers. If the queue is empty, mark not running and publish progress `done`. Otherwise pop
   the next type, publish `Syncing <label>...` (labels: activity, sleep, heart rate, blood oxygen, blood pressure, HRV,
   temperature, stress), write one `REQUEST <type>` frame (pager seq, then +1), and arm the stall timer.
3. Stall timer (6000 ms): nothing at all arrived for this type (an unsupported type answers with nothing), so advance.
4. When a complete device frame (SEND or SEND_NO_ACK) of the in-flight type arrives, cancel the stall timer and (re)arm
   the settle timer. Frames of other types are ignored.
5. Settle timer (1500 ms after the last frame of the type): advance.
6. `cancel()` stops the timers and drops the queue; it publishes nothing.

Acknowledgements: every device SEND is ACKed by the driver before decode; the pager does not send anything else.
Terminal condition: queue empty after the last type's settle or stall, then progress `done`. Replays are safe: persistence
upserts by timestamp, so asking again does not double count. There is no cursor, so `planSync` returns the whole catalog
every time and the content-derived record ids make a re-read idempotent.

Mapping to the contract: each `REQUEST` is a `RingCommand`; `Protocol.begin` returns `{ expectReply: true, quietMs: 1500,
stallMs: 6000 }`; `Protocol.timeout(state, 'quiet' | 'stall')` ends the type and the session sends the next. The quiet
timer must restart only on a complete frame of the in-flight data type (a battery reply arriving mid-sync must not
extend it), and not on every 20-byte packet.

Android's sync engine does not report the pager as in-flight to its worker (`isHistorySyncRunning` stays false), so the
Android worker used a fixed grace time instead of the real finish. The library has a real terminal condition and should
use it.

Sync-engine gate (`LuckRingSyncEngineGateTest`): cold pass = 9 packets; second `runStartup` while running = no packets;
after `cancel` a warm pass writes `[3, 9, 5]` (data types of the three packets); after `reset` it is cold again.

## 8. What the decoder reads

All metric envelopes: `[total u16][items u8]` then `items` fixed-size records. `total` is ignored. Records are cut at the
declared item count; a record that does not fit in the body is dropped; `items = 0` or a payload under 3 bytes gives no
records. Record timestamps are UTC Unix seconds (section 10).

| dataType | Record | Fields and scaling | Kotlin event |
| --- | --- | --- | --- |
| 2 | payload `[items, customer, hardware, code, picture, font]`, needs 6 bytes | firmware = bytes 1..5 joined with `.`; shorter payload -> `CommandAck(2)` | `Status(firmware)` |
| 3 | `[percent][charging]` | percent 0..100 direct; the charging byte is read by nobody | `Battery(percent, charging=false)`; empty payload -> `CommandAck(3)` |
| 4, 5 | 20 B: `[start u32][steps u32][distance u24 + pad][calories u24 + pad][duration u24 + pad]` | steps direct; distance u24 taken as meters; calories and duration ignored | `ActivityBucket(start, steps, distanceMeters)` |
| 6 | pages, see below | minutes of stage | `SleepTimeline(start, stages)` |
| 7, 17 | 5 B: `[time u32][bpm u8]` | bpm direct; empty envelope = measurement ended | `HeartRateSample` / `HeartRateComplete(now)` |
| 8 | 5 B `[time][bpm]` | bpm | `HistoryMeasurement(HEART_RATE)` |
| 20 | 5 B `[time][spo2 u8]` | percent; empty envelope = ended | `Spo2Result` / `Spo2Complete(now)` |
| 40 | 5 B | percent | `HistoryMeasurement(SPO2)` |
| 18, 41 | 6 B `[time][sys u8][dia u8]` | mmHg direct; both emit two rows, systolic first; empty live frame -> `CommandAck(18)`, empty history -> nothing | `HistoryMeasurement(BLOOD_PRESSURE_SYSTOLIC / _DIASTOLIC)` |
| 45 | 5 B | HRV value direct (unit assumed ms) | `HrvSample` |
| 42 | 5 B | same | `HistoryMeasurement(HRV)` |
| 46, 47 | record size = `body / items`; 8 B (or 6 or 7 B): `[time][value u16] / 10`; 5 B: `[time][value u8] / 10` | degrees C | `TemperatureSample` (46) / `HistoryMeasurement(TEMPERATURE)` (47); empty live -> `CommandAck(46)`, empty history -> nothing |
| 52 | 5 B | stress value direct | `StressSample` |
| 53 | 5 B | same | `HistoryMeasurement(STRESS)` |
| 9, 11, 22, 120, 159 | not decoded | | `CommandAck(dataType)` |
| ACK cmdType | payload = status byte | | `CommandAck(dataType)` |
| anything else | raw payload | | `Unknown(dataType, raw)` |

Sleep (data type 6): header `[total u16][pageCount u8]`, then `pageCount` pages of 76 bytes: `[validCount u8]` then 15 slots of
`[type u8][time u32]`; only the first `validCount` slots are real. Entry types: 1 start, 2 deep, 3 light, 4 wake (ends a
session), 5 movement. Build one list of entries across pages, then:

- An entry of type 1 closes any open session and opens a new one at its time; any other entry opens one at its own time
  if none is open.
- Each entry lasts until the next entry; minutes = `floor(delta / 60)` (negative -> 0). Those minutes get the stage of the
  earlier entry: 2 -> deep, 1, 3 and 5 -> light. (Type 4 closes the session first, so awake is never produced.)
- A wake entry closes the session; the last entry of a list contributes no minutes; remaining open session is closed
  at the end. A session with no minutes produces nothing.
- Output: one timeline per session, stamped with the session start, one stage per minute.

Plausibility gates live outside the decoder (`RingEventBridge`), not in it: HR 30..220, SpO2 70..100, stress 1..100,
HRV 1..300, temperature 30.0..45.0, systolic 60..250, diastolic 30..150; history records must be within 8 days back and
1 hour forward of now (sleep too). The decoder only cuts records. A ring's "no sample" filler records are not detected
by the decoder either; they fall out of those gates. Vitals' shared validation does the same job in the mapper.

## 9. Live heart rate and spot flows

- Live HR: write `realHeartRate(true)` (24 `01`). The ring pushes live frames on data type 7 (SEND_NO_ACK in the Kotlin
  tests; if it uses SEND, each gets an ACK). Each record is `[time][bpm]`. An empty envelope means the measurement ended.
  Stop with `realHeartRate(false)` (24 `00`). There is no keepalive in this family.
- Spot HR: no separate command. A spot reading is the first usable sample of the live stream; the coordinator runs the
  stream for a window (30 s default ceiling), then stops it. Contract: `liveHeartRate: { start: realHeartRate(true),
  stop: realHeartRate(false) }`, `spot.hr` = the same start command.
- Spot SpO2: `realSpO2(true)` (20 `01 00 00 00 00`); results on data type 20; empty envelope = ended; stop with
  `realSpO2(false)` (20 `00 00 00 00 00`). Default ceiling 60 s.
- HRV, temperature and BP have toggles (45, 46, 18). Android's "measure now" runs the blood pressure toggle (it shows BP
  and the HR streamed with it); standalone HRV, temperature and stress spot reads are left to the ring's own monitoring
  and history. Stress has no toggle in the encoder.
- Workout heart rate (data type 17) uses the same record layout as 7; no start command for it exists in the Kotlin.

## 10. Clock convention

True UTC. The ring is given the phone's UTC seconds plus its UTC offset in seconds (command 104, also inside the connect
bundle) and stamps every record with UTC Unix seconds, so decoding is `epochSeconds = u32` with no offset to remove. This
differs from the jring and YCBT families, which store local wall clock. The offset field is only for the ring's own
display, so after a time-zone change the session should re-send 104. The ring's clock is never read back, so there is no
measured drift: `clockOffsetS` is always 0 for this family. A ring whose clock was never set would stamp wrong times;
the connect bundle sets it on every cold connect (**unverified**: whether a warm pass should too).

## 11. Reconnect and link priority

Reconnect: the generic Android policy (`ReconnectBackoff`) with no LuckRing special case: delays 5, 15, 30, 60, 120, 300 s,
the last repeating; GATT status 133, 22 and 62 are transient (the first two failures retry after 5 s); status 257 means
wait for Bluetooth to come back (no timed retry). This is exactly `ANDROID_RECONNECT` in `types.ts`.

Link priority: `ConnectionPriorityPolicy` has special cases only for YCBT (default) and jring (balanced floor). LuckRing
follows the general rule: high while a sync, a spot measurement or a workout is running; balanced when idle; low power
after 300 s idle. That is exactly `DEFAULT_PRIORITY` in `types.ts`.

Liveness: this family has no keepalive traffic (only jring does), so silence while idle is normal. Android checks the OS's
own GATT state about once a minute (every 15 s when not yet stable) and forces a reconnect if the OS says it is gone; a connect
attempt that has not finished within 30 s is abandoned and retried by the backoff above.

Per connection the driver is rebuilt, so the assembler, the pager and the "configuration sent" flag all start clean.

## 12. Mapping to `RingEvent`

Stream names are the biometrics `BioStream`s. "t" is epoch seconds as the contract uses. `origin` is `history` for
stored types, `live` for the pushed live types, `spot` while a spot measurement is running.

| Kotlin `RingDecodedEvent` | `RingEvent` |
| --- | --- |
| `Battery(percent)` | `{ type: 'status', key: 'battery', value: percent }` (charging not decoded; do not emit `charging`) |
| `Status(firmware)` | `{ type: 'status', key: 'firmware', value: '1.2.3.4.5' }` |
| `HeartRateSample(bpm, t)` | `{ type: 'sample', stream: 'hr', t, value: bpm, unit: 'bpm', origin: 'live' \| 'spot' }` |
| `HistoryMeasurement(HEART_RATE)` | same with `origin: 'history'` |
| `Spo2Result(value, t)` / `HistoryMeasurement(SPO2)` | `{ type: 'sample', stream: 'spo2', t, value, unit: '%', origin }` |
| `HrvSample(value, t)` / `HistoryMeasurement(HRV)` | `{ type: 'sample', stream: 'hrv', t, value, unit: 'ms', origin }` (vendor defined; the mapper flags it) |
| `TemperatureSample(celsius, t)` / `HistoryMeasurement(TEMPERATURE)` | `{ type: 'sample', stream: 'skin_temp', t, value: celsius, unit: 'C', origin }` (stream choice **unverified**, see open questions) |
| `HistoryMeasurement(BLOOD_PRESSURE_SYSTOLIC)` | `{ type: 'vendor', key: 'bp_sys', t, value, unit: 'mmHg', origin }` |
| `HistoryMeasurement(BLOOD_PRESSURE_DIASTOLIC)` | `{ type: 'vendor', key: 'bp_dia', t, value, unit: 'mmHg', origin }` |
| `StressSample(value, t)` / `HistoryMeasurement(STRESS)` | `{ type: 'vendor', key: 'stress', t, value, unit: 'score', origin }` (scale 1..100 per the bridge gate; unit label is mine) |
| `ActivityBucket(t, steps, distanceMeters)` | `{ type: 'activityBucket', start: t, durS, steps, distanceM: distanceMeters }`; `durS` is **unverified** (the record's duration field is ignored in Kotlin); no `kcal` (field ignored in Kotlin) |
| `SleepTimeline(t, stages)` | `{ type: 'sleepEpochs', start: t, epochS: 60, stages, rawCodes, firmware, complete }`: `stages` map `LIGHT`->`light`, `DEEP`->`deep`, `AWAKE`->`awake` (never produced); `rawCodes` per minute = the entry type of the earlier entry (1, 2, 3 or 5); `complete` = the session ended with a wake entry (type 4) — my proposal, Kotlin never sets it |
| `HeartRateComplete`, `Spo2Complete` | no record. End of the measurement: `IngestResult.done = true` (or `{ type: 'status', key: 'ack', value: 'hr_complete' \| 'spo2_complete' }`); stamping with the decoder clock is not needed |
| `CommandAck(dataType)` | `{ type: 'status', key: 'ack', value: dataType }` (only so the session can end the command in flight) |
| `HistorySyncProgress("Syncing X...")` / `HistorySyncFinished` | `{ type: 'progress', stage: <short id>, done: false }` / `{ type: 'progress', stage: 'done', done: true }`; stage ids suggested: `activity`, `sleep`, `hr`, `spo2`, `bp`, `hrv`, `temperature`, `stress` |
| `Unknown(dataType, raw)` | drop, or `{ type: 'status', key: 'error', value: 'unknown data type N' }` (no secret can be in these frames) |

`dailyTotal`, `workout`: not produced by this family. Blood pressure has no biometrics stream; keep it as `vendor`
(`bp_sys`, `bp_dia`) until a stream exists. Live blood pressure is decoded exactly like stored (two rows per record).

## 13. Unverified items

- Whether B001 can also be an indicate characteristic, and whether the ring has a standard battery or device-information
  service (the driver reads neither).
- No serial number is read anywhere, so ring identity is the Bluetooth address or advertised id.
- Reply to the bundle (110), auto-monitoring (128) and settings-sync (9): Android never checks them. A "bundle accepted" ACK
  is assumed; the `CommandAck(111)` test only shows ACK handling, not the ring's answers.
- Whether live frames (types 7, 20, 18) arrive as SEND or SEND_NO_ACK (the test uses SEND_NO_ACK for type 7).
- Units of distance (u24 taken as meters), calories and duration in the sport record, the step bucket length, the unit of
  HRV (ms; RMSSD or SDNN unknown), stress scale, and whether temperature is finger skin temperature.
- 5-byte temperature records decode as `value / 10` of a single byte (so at most 25.5), which the 30..45 gate would drop;
  the 5-byte variant may be a different scale.
- Sleep: whether a session can span two separate data-type-6 frames (each frame is decoded on its own, so it would be
  split into two timelines); `complete`; whether a type-1 entry always starts the night.
- Whether the 159 unbind is correct for this ring (Android never uses it).
- The Kotlin history window is 8 days; how far back the ring stores records is not known.
- Packets of one frame may be interleaved with other writes in Android's queue (an ACK enqueued from the notify thread
  can land between a bundle's packets). Nothing shows the ring tolerates or rejects that. The library should write all
  packets of a frame without another write between them.

## 14. Port notes (`packages/rings/src/luckring/`)

Decisions taken where the Kotlin is silent or the contract differs:

- Handshake: the cold pass in the Kotlin order (bundle 110, auto-monitoring 128, requests 2, 3, 9), each packet a
  separate write. Unlike Android, the handshake then waits (4 s) for the device info, battery and settings-sync replies,
  because `HandshakeInfo` needs firmware and battery. A silent ring does not fail the connect (`firmware: ''`). So the
  replies and their ACKs land before the first history request, not after it as in the Kotlin session.
- Warm pass: a second `sync` on the same connection writes battery and settings-sync requests before the catalog
  (Kotlin `runStartup` with `configurationSent`); a new connection is always cold.
- Sequence numbers: `begin` reserves the encoder seq (and the separate pager seq for history). Toggles written by
  `session.stream` (live HR, spot) skip `begin`, so they use the next free seq without taking it.
- History: no cursor in the Kotlin; `planSync` returns the eight-type catalog every time. When a type ends, the read
  emits `status:cursor` `lr1:<local day of the sync>` for its stream (`steps`, `sleep_stage`, `hr`, `spo2`,
  `vendor:bp`, `hrv`, `skin_temp`, `vendor:stress`). Timers 1500 ms settle / 6000 ms stall. A settle timer never ends
  a read while a multi-packet frame is open: it keeps waiting up to 8 s of silence, then ends with
  `status:error partial:<stream>` and no cursor.
- Units: `pct` for SpO2, `degC` for temperature (`skin_temp`, still **unverified**), `ms` for HRV, `score` for stress;
  blood pressure and stress are `vendor` events (`bp_sys`, `bp_dia`, `stress`). `activityBucket.durS` is 60 (the record
  duration field is ignored, as in the Kotlin). Sleep `complete` = the session ended on a wake entry.
- Live and spot: the empty envelope on 7/17 or 20 (`HeartRateComplete` / `Spo2Complete`) is `status:ack`
  `hr_complete` / `spo2_complete` and ends the stream (`done`). Spot HR is the live HR toggle; spot SpO2 is toggle 20.
- Known gap: the session restarts its timer on every notification and switches to the stall timer after writing an
  ACK, so a battery frame mid-read extends the settle, and after an ACKed data frame a type ends after the stall time
  rather than the 1.5 s settle.
