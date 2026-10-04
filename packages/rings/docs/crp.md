# CRP family (`crp`): the `fdda`-profile rings

R19 research for the CRP port. CRP is the vendor SDK name ("crrepa", the Moyoung "Da Rings" app). Rings known to speak it:

- the **R11 sold with CRP firmware** (firmware string `MOY-R1K3-…`). The same R11 shell also ships with a different firmware that speaks the Colmi protocol, and both advertise `SMART_RING`;
- the **R100** (firmware `MOY-R2E3-…`), which advertises a usable name.

Everything below comes from the Lumen Kotlin driver, its unit tests and a few hardware captures quoted in its comments. Where the Kotlin only guesses, this doc says **unverified**. Golden vectors are in `qa/fixtures/rings/crp/`.

## Sources

| What | Where (Lumen Android repo) |
|---|---|
| UUIDs, opcodes, frame builders | `app/src/main/java/com/pulseloop/ring/CRPProtocol.kt` |
| Recognition, capabilities | `CRPCoordinator.kt`, `wearables/WearableModel.kt` (`COLMI_R11_CRP`, `R100`) |
| GATT topology, subscriptions | `CRPDriver.kt` |
| Reassembly and decoding | `CRPDecoder.kt` (`CRPFrameAssembler`, `CRPDecoder`) |
| Handshake, history walk, spot commands | `CRPSyncEngine.kt` |
| Reroute after service discovery | `RingBLEClient.kt` `onServicesDiscovered` (the CRP block), `DriverReroute.kt` (the inverse rule) |
| Reconnect and link priority | `ReconnectBackoff.kt`, `ConnectionPriorityPolicy.kt`, `RingBLEClient.kt` watchdog |
| Spot flows | `service/RingSyncCoordinator.kt` (`measureHR`, `measureSpO2`, wear-state handler) |
| Tests | `app/src/test/java/com/pulseloop/ring/CRP{Decoder,Protocol,SyncEngine}Test.kt`, `DriverRerouteTest.kt` |
| Hardening notes | `docs/crp-r11-hardening-plan.md` |

**Licence.** The Kotlin came from the upstream PulseLoopAndroid project, which has no licence file. The owner accepted this (plan 04, decision 3). The Kotlin says it is a port of the vendor app's on-air behaviour, read from a decompiled build. We copy no code. This doc describes the protocol, and the fixtures are bytes taken from unit tests or built from scratch.

## GATT

| Service | Characteristic | Use | Mode |
|---|---|---|---|
| `0000fdda-…` (CRP) | `0000fdd2-…` | **write**: every command | write; Lumen uses "with response" when the characteristic has the Write property, else "without response" (property not recorded: **unverified**) |
| | `0000fdd3-…` | **command replies**: every `FD DA` frame the ring sends | notify |
| | `0000fdd1-…` | current-steps push (raw, no header) | notify |
| | `0000fdd6-…` | recording / OTA; subscribed, ignored | notify |
| | `0000fdd5-…` | OTA / recording write; never used | – |
| `0000180d-…` heart rate | `00002a37-…` | subscribed by Lumen but **never used**: all HR comes back on `fdd3` | notify |
| `0000180f-…` battery | `00002a19-…` | battery %, one read after subscribing | read |
| `0000180a-…` device info | `00002a26-…` / `00002a28-…` | firmware / software revision, read if present | read |

`GattMap` for the port: `service` fdda, `write` fdd2, `notify` [fdd3 (main, must come first), fdd1, fdd6], `battery` 180f/2a19, `deviceInfo` 180a/2a26. Leave 2a37 out.

**Subscribe gate.** Do not start the handshake until the `fdd3` subscription is confirmed (`requiredSubscriptionsBeforeConnected = [fdd3, notify]`). Otherwise `fdd1` tends to finish first, the handshake writes go out, and every reply is lost without trace. `fdd1`/`fdd6` do not gate.

**Bonding.** None. The ring works over plain GATT and the vendor app never bonds in its connect path.

**MTU.** Lumen asks for MTU 512 (Android) before service discovery, with a 3 s fallback. The longest frame seen is 152 bytes. On the default MTU it arrives as eight 20-byte notifications and is reassembled (see Frames).

## Recognition and the reroute rule

### Scan match (`CRPCoordinator.matches`)

A CRP ring is recognised at scan time only if:

1. its advertised name matches a CRP model's name pattern. Today that is only the R100: `^R100(_[0-9A-Fa-f]+)?$`. Use the underscore form only: `R100 1A2B` with a space belongs to another family; or
2. it advertises the `0000fdda-…` service UUID.

The CRP R11 does neither. It advertises the bare name `SMART_RING` with **no service UUID** before connecting. The jring matcher takes that name (unless the advertisement also carries a Colmi UART service), so **the scan classifies a CRP R11 as jring**.

### Reroute after service discovery (`RingBLEClient.onServicesDiscovered`)

After connecting, Lumen runs three checks on the discovered services in this order. Each one swaps the installed driver before any subscription or write:

1. **Colmi rescue:** if a Colmi UART service (`6e40fff0-b5a3-f393-e0a9-e50e24dcca9e` or `de5bf728-d711-4e47-af26-65e3012a5dc7`) is present and jring is installed, switch to colmi.
2. **CRP rescue:** if `0000fdda-…` is present, **no** Colmi UART service is present, and the installed family is **jring or colmi**, switch to **crp**. (Colmi is on the list because a person may have picked a Colmi R11 by hand.) The model resolves to the advertised name's CRP model, else the person's pick if it is CRP, else "R11 (CRP)". No bond is started.
3. **jring rescue** (`DriverReroute.shouldRerouteToJring`, the inverse rule): switch back to jring only if the scan said jring, the installed family is not jring, `000056ff-…` is present, and **none** of the installed driver's own services are present. A driver that declares no services is never moved. After step 2 the installed driver is crp and its `fdda` is present, so this rule never takes a CRP ring (`DriverRerouteTest` "does not fire for a ring with no 56ff service"). It also never fires on a direct reconnect with no scan classification, or when the scan matched confidently.

A ring showing **both** `fdda` and the Colmi UART stays colmi (step 1 runs first, and step 2 needs the Colmi service absent). A ring showing `fdda` **and** `56ff` ends up crp, because step 2 does not look at `56ff`. No such ring is known (open question 1).

**Port shape.** The jring family's session (and colmi's) calls `Transport.services()` after connecting, then applies the rule above. On a match, the session re-opens with the crp family on the same transport. A person's explicit model pick overrides a jring scan guess before connecting, as Lumen's `honorSelection` does.

**Web Bluetooth catch.** Chromium only shows services named in `filters` or `optionalServices`. If the jring (and colmi) families do not list `0000fdda-…` in `optionalServices`, `services()` can never see it there and the reroute cannot happen. The crp family's own `requestFilters` should be `{ services: [fdda] }` and `{ namePrefix: 'R100' }`.

## Frames

```
FD DA L1 L0 GG CC payload…
```

| Byte | Meaning |
|---|---|
| 0–1 | magic `FD DA` |
| 2 | `0x10` on every frame we send. Bit 0 is the 9th bit of the length: `0x11` means +256 |
| 3 | low 8 bits of the **total** length (header included): `len = ((b2 & 1) << 8) \| b3`, so header 6 + payload |
| 4 | group |
| 5 | command |
| 6… | payload |

Commands and replies use the same layout. There is **no checksum** and no sequence number. Our builder always writes `0x10` and `len & 0xff`, which is fine because every command we send is 6–11 bytes.

**Reassembly (`fdd3` only).** One assembler per connection:

- a chunk that starts with `FD DA` begins a new frame: the expected length is read from bytes 2–3, and any partial frame is dropped;
- a chunk with no frame in progress is dropped;
- chunks are appended until the buffer reaches the expected length. The frame is the first `len` bytes; anything past `len` in that chunk is **dropped**, not kept for the next frame;
- a fresh connection starts a fresh assembler, so a frame cut off by a disconnect can never be completed with bytes from the next link. The port must keep this rule: reset the assembler on every new transport.

`fdd1` pushes have no header and are decoded as they come.

## Commands (all written to `fdd2`)

`[x]` = one byte. Multi-byte values are little-endian. "Op" is the `RingCommand.op` name used in the fixtures.

| Op | G/C | Payload | Notes |
|---|---|---|---|
| `set_time` | 1/1 | `[epoch u32 LE][08]` | see Clock |
| `set_user_info` | 1/0 | `[heightCm][weightKg][ageYears][gender][strideCm]` | sent only if a profile is known. stride = `floor(heightCm * 0.43)`, clamped 0..255. gender uses Lumen's Colmi convention 0 female, 1 male, 2 other (**unverified** for CRP) |
| `measure_hr` | 1/9 | `[1]` start / `[0]` stop | spot HR, also used for live HR |
| `measure_hrv` | 1/10 | `[1]`/`[0]` | never sent by Lumen |
| `measure_spo2` | 1/11 | `[1]`/`[0]` | spot SpO2 |
| `measure_stress` | 1/14 | `[1]`/`[0]` | never sent |
| `measure_temp` | 1/32 | `[1]`/`[0]` | never sent |
| `timing_hr` | 1/6 | `[intervalMin]`, 0 = off | all-day monitor |
| `timing_hrv` | 1/7 | `[intervalMin]`, 0 = off | |
| `timing_spo2` | 1/8 | `[intervalMin]`, 0 = off | |
| `timing_stress` | 1/39 | `[intervalMin]`, 0 = off | |
| `timing_temp` | 1/13 | `[1]` on / `[0]` off | no interval |
| `history_hr` | 2/15 | `[day][frameIndex]` | day 0 = today |
| `history_hrv` | 2/16 | `[day][frameIndex]` | |
| `history_spo2` | 2/17 | `[day][frameIndex]` | |
| `history_stress` | 2/47 | `[day][frameIndex]` | |
| `history_temp` | 2/22 | `[day][frameIndex]` | **not** 2/48: that is the vendor's "sleep state" query, which never answered |
| `history_sleep` | 2/14 | `[daysAgo]` | |
| `query_spo2_support` | 2/37 | – | |
| `query_timing_state` | 2/6 hr, 2/7 hrv, 2/8 spo2, 2/45 stress, 2/21 temp | – | reply = the monitor's interval in minutes, 0 = off (vendor). Reply layout **unverified**; Lumen only acks it |
| `query_firmware` | 3/3 | – | |
| `factory_reset` | 3/0 | – | destructive |
| `find_device` | 9/2 | `[1]` | |

Known but never sent: 3/1 shut down, 3/4 firmware hash, 3/6 real-time battery, 3/14 restart. Group 7 is the vendor's licensed activity module. Old Lumen builds sent 7/0, 7/1 and 7/13 thinking they were device-info queries, and the ring never answered.

## Replies

All replies come on `fdd3` as frames, apart from the steps push. The cmd byte of a spot result is the same as the command that started it.

| G/C | Payload | Decoded as | Valid range (outside = dropped, no event) |
|---|---|---|---|
| 1/9 | `[bpm]` | heart rate | 40..200 |
| 1/10 | `[ms]` | HRV | 20..200 |
| 1/11 | `[%]` | SpO2. `FF` = no reading | 70..100 |
| 1/14 | `[score]` | stress | 0..100 |
| 1/32 | `[u16 LE]` tenths of °C | temperature | 28.0..50.0 |
| other 1/x, empty 1/x | – | ack | – |
| 2/15, 2/17, 2/47 | `[day][frameIndex]` + 144 × `[u8]` | HR / SpO2 / stress history | HR 40..200, SpO2 **1..100**, stress 1..100; 0 = empty slot |
| 2/16, 2/22 | `[day][frameIndex]` + 72 × `[u16 LE]` | HRV (ms) / temperature (tenths °C) | HRV 1..300, temp 280..500 raw |
| 2/14 | `[dayIndex]` + N × `[state][hour][minute]` | sleep | see Sleep |
| 2/37 | `[type]` | SpO2 support: 1 sleep-SpO2 or 2 timed-SpO2 means supported. 0 means not supported; any other value (including `FF`) means unknown | – |
| other 2/x | – | ack | – |
| 3/3 | UTF-8 string, no length byte | firmware, e.g. `MOY-R1K3-2.1.6` | strict UTF-8; trim whitespace and NUL; reject if empty or if any control character is left (then ack) |
| 3/7 | `[worn]` | wear state, 0 = off the finger | pushed by the ring on its own |
| other 3/x | – | ack | – |
| `fdd1` push | `[steps u24 LE]([distance m u24][kcal u24])` | today's running totals | length must be a multiple of 3. Missing fields are 0. Bytes past 9 are ignored (the vendor comment hints at a 4th triple holding a time: **unverified**) |

**Timing history slots.** Every slot is 5 minutes, whatever the monitor interval. Slot `s` of frame `f` covers `localMidnight(today − day) + (f × slotsPerFrame + s) × 5 min`. slotsPerFrame is 144 for 1-byte vitals and 72 for 2-byte ones. A 1-byte day is two frames (0, 1); a 2-byte day is four (0..3). The total is 288 slots. A `day` above 14 is treated as corrupt (ack, no samples). A payload under 2 bytes gives nothing. A dangling odd byte in a 2-byte frame is ignored.

**History SpO2 range.** The vendor keeps 1..100 for history and 70..100 for spot. The port should probably drop history values under 70 (open question 4).

**Sleep (2/14).** The payload must be `1 + 3N` bytes with N ≥ 1, and `dayIndex` ≤ 14. Each record says that from `hour:minute` the sleep is in `state` (0 awake, 1 light, 2 deep, 3 REM, anything else unknown), until the next record's time. Decoding:

1. Skip records with hour > 23 or minute > 59. A record whose gap from the previous kept record is negative or over 24 h is also skipped. Gaps wrap past midnight (`prevHour > hour` means +24 h). Each skip leaves the previous kept time as it was.
2. Fewer than 2 kept records gives nothing.
3. **Anchor:** `dayIndex` is the **wake day**, today − dayIndex. If the first record's minute-of-day is later than the last's, the night began the evening before (first − 1440 min). Lumen assumes this from one post-midnight capture; the evening-start case is still **unverified** on hardware.
4. Expand to one stage per minute. Any awake run of **60 min or more** splits the night into separate sessions (night and nap) and is not included in either. Shorter wakes stay inside the session as awake minutes. A session with no non-awake minute is dropped. The last record (normally awake) only closes the night. Lumen does not stretch an unfinished night up to "now".

## Connect handshake (Lumen order)

Runs once the `fdd3` subscription is up. Lumen queues all of these at once and does not wait for any reply:

1. `set_time`;
2. `set_user_info`, only if a profile is known;
3. **once per connection:** `query_firmware`, `query_spo2_support`, then `query_timing_state` for hr, hrv, spo2, stress, temp. These **must** go before step 4. The read-backs are there to learn whether a monitor was off, and step 4 switches them all on;
4. **once per connection:** the five monitor commands, in this order: hr, hrv, stress, spo2, temp. With no saved settings, everything is on at interval 5 min (`ALL_ON_DEFAULT`). A fresh ring has every monitor off and records nothing until this runs. With saved settings, the HR interval is used for all four interval monitors (there is no per-vital interval), and a disabled vital gets interval 0 (temp gets `[0]`);
5. the history pass (next section).

The battery (2a19) and firmware (2a26/2a28) reads happen at the GATT level after the subscriptions. The ring's clock is never read, so `clockOffsetS = 0`. There is no serial number query, so `ringIdentity` falls back to the Bluetooth address, or the advertised id on Chromium.

Port handshake: `set_time` → `set_user_info` (if `opts.profile`) → `query_firmware` (wait for 3/3; fall back to the 2a26 string) → `query_spo2_support` → five state queries → five monitor commands → battery read. None of these has a known ack: send each, and give replies a short quiet window, not a hard expectation (**unverified** whether the ring acks set_time or the monitor commands at all).

## History sync

**What Lumen asks for in each pass.** A pass runs on connect, on every manual sync, and on every background sync, which is about 30 min:

1. `history_hr(0,0)`, `history_spo2(0,0)`, `history_hrv(0,0)`, `history_stress(0,0)`, `history_temp(0,0)`, `history_sleep(0)`;
2. **once per connection:** `history_sleep(1)` … `history_sleep(6)`, the sleep backfill. Each reply carries its own `dayIndex`, so dates come from the reply. A day the ring has no record of simply gets no reply.

**Walking frames.** Each timing reply produces a "frame" marker (cmd, day, frameIndex). If frameIndex is below the vital's last frame (1 for HR, SpO2 and stress; 3 for HRV and temp), Lumen asks for `(cmd, day, frameIndex + 1)`. A guard keyed on (cmd, day, frameIndex) stops a ring that repeats a frame from setting off a storm of requests. The guard is cleared at the start of every pass. In Lumen these follow-ups join the end of the write queue, after the whole startup batch (see `sessions.json`).

**End of a pass.** Nothing marks the end. Lumen never signals "sync done" for CRP. The background worker waits up to 45 s for a done signal that never comes, then lets go. Empty days get no reply, so silence is normal. The port should end each request on a quiet timer (proposed `quietMs` 2–3 s after the last frame, `stallMs` ~10 s with no reply). It should emit `progress {stage, done: true}` when the plan is used up.

**Gaps in Lumen's walk.**

- Timing vitals are pulled for **today only**. A day that is not synced before midnight never has its HR, SpO2, HRV, stress or temp timeline read, even though the command takes a `day`. The port's `planSync` should use the per-stream cursor (the last local date fully read) to ask for every missed day back to a limit. How many days the ring keeps is **unknown**: the vendor's day type names TODAY = 0 and YESTERDAY = 1, and the decoder accepts up to 14.
- Sleep goes back 6 nights once per connection. The decoder accepts 14.

**Proposed `SyncCursor`** per stream: `"d:<YYYY-MM-DD>"` = the last local date whose final frame arrived. The plan then covers `day = min(daysSince(cursor), limit) … 0`, oldest first. Today is always read again, because the ring keeps writing to it.

## Live HR and spot measurements

All of these share the single `fdd2` channel with the history pass. Lumen raises link priority to high while a measurement runs.

- **Spot HR:** `measure_hr [1]` → 1/9 `[bpm]` replies → `measure_hr [0]`. Lumen samples a 30 s window and drops samples in the first 5 s (the ring may echo an old cached value). How many 1/9 replies come per start, and how often, is **unverified**: the one capture quoted shows a single value. The ring does not say when the measurement is finished.
- **Live HR** (workout): the same start command, stopped with `[0]`. Lumen sends the start again after any spot measurement, because the spot's stop also ends the workout stream. Whether the ring streams steadily after one start is **unverified**.
- **Spot SpO2:** `measure_spo2 [1]`. The CRP R11 stays silent for **about 48 s**, sends **one** 1/11 `[%]` value, and then sends nothing more. Lumen keeps the first plausible value (70..100) and sends `measure_spo2 [0]` straight away. A failed reading is 1/11 `[FF]`, which is dropped, so the leg runs to its 60 s limit. Do not wait for more samples or a completion frame; none comes.
- **Not worn:** a 3/7 `[00]` push during a spot HR or SpO2, with no reading yet, ends it early as "not worn". Lumen does this for CRP only. A 3/7 drop after a good reading does not cancel the reading.
- HRV, stress and temperature: Lumen offers no spot measurement. The commands exist (1/10, 1/14, 1/32) and their replies decode (see Replies), but no flow has been tested.

Family fields: `liveHeartRate = { start: measure_hr {enable: true}, stop: measure_hr {enable: false} }`; `spot = { hr: measure_hr {enable: true}, spo2: measure_spo2 {enable: true} }`; `spotStop` = the same ops with `enable: false`; no `spotGapMs`. Ceilings: HR 30 s window, SpO2 60 s, first plausible SpO2 value ends the run.

## Reconnect and link priority

- **Backoff** (`ReconnectBackoff`, same for every family, `ANDROID_RECONNECT`): 5, 15, 30, 60, 120, 300 s, and the last delay repeats. GATT 133/22/62 count as transient and get two quick retries at 5 s. GATT 257 means "wait for Bluetooth to come back" (no retry until it does). Once the six delays are used up, the watchdog stops retrying on its own until something wakes it (Bluetooth returns, the app connects).
- **Connect limit:** a connect still not finished after 30 s is torn down (and retried if the ring is known). Each GATT op times out after 4 s.
- **Liveness:** CRP gets **no keepalive** (that is jring-only). Every 15 s Lumen checks whether the operating system still reports the GATT link as connected (every 60 s once the link has been stable for 2 min and nothing is running), and reconnects if it does not. Silence alone is never taken as a dead link.
- **Link priority** (`ConnectionPriorityPolicy`): CRP falls in the general branch, which is `DEFAULT_PRIORITY`. That means high during a sync, a spot measurement or a workout; balanced when idle; low power after 300 s idle. Connect also asks for high priority before MTU and discovery (all families except YCBT).

## Clock

`set_time` sends the phone's **local wall clock** as if the phone were at UTC+8, with a fixed zone byte `08`:

```
epoch = (nowUtcS + tzOffsetS) − 8 × 3600     // u32 LE, then 0x08
```

This copies the vendor app. The ring then shows the correct local time in any time zone. The ring's records carry no absolute time, only a day index plus a slot, or hour:minute. So:

- every history time is worked out on the phone from the phone's local midnight. The ring's day boundary is the local midnight of the last `set_time`;
- `clockOffsetS` is 0 (never read). Drift cannot be measured;
- Lumen adds `slot × 5 min` to the start of the day as plain elapsed time. On a daylight-saving day, slots after the change move by an hour. Whether the ring's slots follow wall time or elapsed time is **unverified**;
- after a time zone change, data recorded before the next `set_time` is laid out against the old midnight.

Time-dependent vectors in `encode.json` record `nowMs` and `tzOffsetS` in `params`.

## Mapping to RingEvent

`t` for live and spot values = the moment the phone received the notification. History times are as computed above.

| Kotlin event | RingEvent |
|---|---|
| `ActivityUpdate` (fdd1: steps, distanceMeters, calories) | `dailyTotal { localDay: today, steps, distanceM, kcal }`. These are running totals for today, not a bucket. Do not emit `activityBucket` |
| `HeartRateSample` (1/9) | `sample { stream: 'hr', unit: 'bpm', origin: 'spot' }` during a spot run, `'live'` during a live stream |
| `HrvSample` (1/10) | `sample { stream: 'hrv', unit: 'ms', origin: 'spot' \| 'live' }` |
| `Spo2Result` (1/11) | `sample { stream: 'spo2', unit: '%', origin: 'spot' }` |
| `StressSample` (1/14) | `vendor { key: 'stress', unit: 'score', origin }` |
| `TemperatureSample` (1/32) | `sample { stream: 'skin_temp', unit: 'degC', origin }` |
| `HistoryMeasurement` HEART_RATE / SPO2 / HRV / TEMPERATURE | `sample { stream: 'hr' \| 'spo2' \| 'hrv' \| 'skin_temp', unit: 'bpm' \| '%' \| 'ms' \| 'degC', origin: 'history' }` |
| `HistoryMeasurement` STRESS | `vendor { key: 'stress', unit: 'score', origin: 'history' }` |
| `TimingHistoryFrame` (cmd, day, frameIndex) | no event. It drives `IngestResult.send` (the next frame). On the last frame: `status { key: 'cursor', value: 'd:<date>', stream }` and `progress { stage: <stream>, done: false }` |
| `SleepTimeline` (start, per-minute stages) | `sleepEpochs { start, epochS: 60, stages (AWAKE/LIGHT/DEEP/REM/UNKNOWN → awake/light/deep/rem/unknown), rawCodes: the vendor state per minute, firmware, complete }`. Lumen always sets `complete = false`. Proposal: `true` when `dayIndex ≥ 1`, or when the last record is awake and older than 60 min |
| `WearingStatus` (3/7) | `status { key: 'error', value: 'not_worn' }` when worn = false. worn = true needs no event (open question 3) |
| `FirmwareRevision` (3/3) | `status { key: 'firmware', value }` |
| `SupportFunctions` (2/37) | `status { key: 'capabilities', value: 'spo2' \| '' }`. Informational only: Lumen never removes SpO2 because of it |
| `CommandAck` | `status { key: 'ack', value: 'crp:<group>/<cmd>' }`. Keep the full group and cmd. Lumen's `commandId` (`(g << 4) \| (c & 0x0f)`) loses bits |
| `FramePending` (a partial chunk) | none (protocol state only). `redactOutbound` can return frames as they are: CRP sends no secrets |

Streams for the family: `hr`, `spo2`, `hrv`, `skin_temp`, `sleep_stage`, plus `vendor:stress` and daily steps, distance and kcal. Tier `C`. Decoder tag proposal: `crp/fdda@1`.

## Unverified, and open questions for the port author

1. **fdda + 56ff together:** Lumen picks crp. Keep that, or prefer jring? No such ring is known.
2. **Does the ring ack** `set_time`, `set_user_info` or the monitor commands, and what do the 2/6..2/45 state read-backs carry? Lumen never waits. The fixtures script no reply for them.
3. **Wear state** has no `StatusKey`. Add `'worn'`, or keep `error:not_worn`? The polarity (0 = off) is confirmed by one capture only.
4. **History SpO2 under 70:** the vendor keeps 1..100. Clamp to 70..100?
5. **How many days back** the timing histories go (the vendor names only TODAY and YESTERDAY; the decoder takes ≤ 14), and whether `history_*` for a past day behaves like today.
6. **Gender byte** for `set_user_info` (Colmi convention assumed). **Stride** is Lumen's own 0.43 × height.
7. **Live HR cadence** after one `measure_hr [1]`, and whether a second start is needed.
8. **The 4th triple** in the fdd1 push, and whether that push comes on a timer or on change.
9. **Daylight-saving days**: slot times are elapsed minutes from midnight in Lumen; the ring's own rule is unknown.
10. **2a37:** Lumen subscribes to it. Does the CRP firmware ever notify on it?
11. **Spot HR/SpO2 values in the R11 capture** are single readings. Whether some firmware streams several SpO2 values (as YCBT does) is unknown. The 48 s figure is from one ring.
12. **Write property of fdd2** (with or without response) was never recorded.
13. **Temperature history** has been seen on the R100 only. The R11 never answered 2/22, and nobody knows whether that is because its monitor was off. The first-connect state read-backs exist to answer this. The R100 also answered neither 2/47 nor 2/45 (no stress).

## Fixtures

`qa/fixtures/rings/crp/`: `encode.json` (59), `decode.json` (72: 45 from Kotlin tests, 27 derived from the decoder rules and marked `derived`; 4 capture-based Kotlin tests replaced by synthetic stand-ins and listed under `excluded`), `sessions.json` (16 scripted exchanges: reroute, handshake, history walks, spot flows). See its `README.md`.

## Port notes

The TypeScript port lives in `packages/rings/src/crp/` (`commands.ts`, `decoder.ts`, `protocol.ts`, `family.ts`). Decisions on the open questions and where it differs from Lumen:

- **Reroute.** `crpAfterDiscovery(services)` is the Lumen rule: `fdda` present and no Colmi UART service. A ring with `fdda` and `56ff` goes CRP, as the Kotlin does (open question 1). `scan.match` claims an R100 name or an advertised `fdda`; a bare `SMART_RING` is left to Jring.
- **Handshake.** Lumen's order, each command sent in turn: set_time, user info (only with a profile), the firmware query (waited for, 4 s; 2a26 then 2a28 back it up), the SpO2-support query, the five state queries and the five monitor commands (fire and forget, as Lumen: open question 2), then the battery read. With no saved settings every monitor is switched on at 5 min. The model is R100 when the name says so, otherwise R11.
- **History.** Each read covers one stream for one local day and waits for its own frames. Lumen fires every query at once instead. A day with no reply ends on the stall timer (6 s) and counts as finished and empty. Next-frame queries keep Lumen's guard on (cmd, day, frame). The guard is cleared when a new read of the same cmd and day starts, not once per pass.
- **Depth.** Sleep goes 6 nights back (Lumen's backfill). Timing vitals go 1 day back (yesterday). Lumen reads today only; the vendor names only TODAY and YESTERDAY, so deeper reads are unverified (open question 5).
- **Cursor.** `d:<YYYY-MM-DD>` per stream is the last local day read to the end, and it is always before today. Today is read on every sync and never closes. The cursor only moves one day at a time, so after a partial day the later days of that pass leave it alone. The planner passes a `floor` (the day before the first day it plans) so that a cursor older than the depth limit still moves.
- **Timers.** Quiet 2.5 s between the chunks of a frame. A quiet timer never ends a read that is half done (a frame partly in, or frames still due): the read keeps waiting up to 10 s of silence in total. After that it ends with `status:error partial:<stream>` and the cursor does not move. A stall after a next-frame query is also `partial`.
- **Values.** Bands are the Kotlin ones. History SpO2 keeps the vendor's 1..100 (open question 4). Units are `bpm`, `ms`, `pct` (the library's spelling, not `%`), `degC`, and `score` for stress (a `vendor` value). Temperatures are `raw / 10`.
- **Sleep.** Decoded as the Kotlin does. `complete` is true when the wake day is before today; Lumen never sets this flag.
- **Wear.** A 3/7 `[00]` gives `status:error not_worn` (open question 3), and ends whatever spot or live stream is running. Lumen ends only spot runs, and only before a reading. A reading already yielded is kept.
- **Spot SpO2.** The first plausible value ends the run and the stop goes out at once. Spot HR runs to the session's 30 s ceiling. Lumen's "drop samples in the first 5 s" is left to the service.
- **Clock re-push.** Lumen sends set_time and user info again on every poll pass. The port sends them once, in the handshake. A service can run `crpResyncTime` whenever it wants to.
- **Steps push.** Each push becomes a `dailyTotal` at the local midnight of the time the protocol last saw. That time comes from the last command, because `ingest` has no clock of its own.
