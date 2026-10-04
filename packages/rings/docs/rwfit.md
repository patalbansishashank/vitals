# RWfit family (R19)

Research notes for the `rwfit` `RingFamily`. Source of truth: the Lumen Android driver (see "Sources"). Golden
fixtures: `qa/fixtures/rings/rwfit/`.

RWfit rings are sold under many badges. One GATT service (`A00A`) carries two wire framings that do not
understand each other:

- **legacy**: frames start `0x7E`, XOR checksum, serial numbers, a mandatory ACK for every frame.
- **JL**: frames start `0xAB`, CRC-16/ARC, a `{cmd, key, keyFlag}` triple at the start of every body.

The advertisement does not say which framing a ring speaks. The choice is made after connect, from the sibling
services the ring exposes (`Transport.services()`).

Words used below: "unverified" means the Kotlin port says it, but no test or capture backs it. "Not ported"
means the Kotlin port has no code for it.

## GATT

| Role | UUID | Notes |
|---|---|---|
| Data service (both framings) | `0000a00a-0000-1000-8000-00805f9b34fb` | `GattMap.service` |
| Write | `0000b002-0000-1000-8000-00805f9b34fb` | commands and app ACKs, both framings |
| Notify | `0000b003-0000-1000-8000-00805f9b34fb` | mode `notify`; replies and ring pushes |
| JL marker: JL service | `0000ae00-0000-1000-8000-00805f9b34fb` | never opened, only seen |
| JL marker: PixArt OTA | `0000ff00-0000-1000-8000-00805f9b34fb` | never opened, only seen |
| JL marker: Telink OTA | `00010203-0405-0607-0809-0a0b0c0d1912` | never opened, only seen |

- **Framing choice.** After discovery: any marker service present → JL. None present → legacy. Compare
  lower-case (the Kotlin test checks an upper-case `AE00`). Legacy is the default until discovery has run. A
  frame in the wrong framing is ignored by the ring (the magic byte differs), so a wrong guess does nothing.
- **Web Bluetooth.** `getPrimaryServices()` only returns services listed up front. So `ScanMatch.optionalServices`
  must list `A00A` **and all three marker services**, or every ring will look legacy.
- No battery service and no Device Information service are used. Battery comes in-band.
- **Write mode.** Android writes with response when B002 has the WRITE property, otherwise without. Which
  properties B002 has: unverified. Leave `GattMap.writeMode` unset.
- **MTU.** Android asks for 512 for every family. Nothing in this family depends on the MTU: JL reassembly uses
  the length field. (The Kotlin JL codec has a `chunkSize` setting, but nothing sets or reads it.)
- No `command` channel. Everything goes to B002.

## Advertisement match

The vendor app matches substrings of the raw advertising bytes (hex with spaces):

| Raw pattern | Meaning |
|---|---|
| `02 01 06 03 03 0a a0` | Flags, then a 16-bit service list holding `0xA00A` |
| `d6 05 02 00` | manufacturer data, company `0x05D6`, then `02 00` |
| `15 ff d6 05 41 54` | a 21-byte manufacturer block, company `0x05D6`, then ASCII "AT" |
| `d6 06 02 00` | company `0x06D6`, then `02 00` |

The Lumen port (and the rule to keep) matches on parsed fields:

- `serviceUuids` contains `A00A` (16-bit or 128-bit, any case), **or**
- any manufacturer block, in on-air layout (little-endian company id first), starts with
  `d6 05 02 00`, `d6 05 41 54` or `d6 06 02 00`.

`requestFilters` for Web Bluetooth: `{ services: [A00A] }`, and
`{ manufacturerData: [{ companyIdentifier: 0x05d6, dataPrefix: 02 00 }] }`, `{ … 0x05d6, dataPrefix: 41 54 }`,
`{ … 0x06d6, dataPrefix: 02 00 }`.

**Name patterns: none.** The vendor requires a non-empty name but never reads it. The rings are rebadged all the
time, so the name carries no family signal. A name such as "RW-01" must not match on its own (Kotlin test).
The Lumen port also does not require a non-empty name. `modelFromAdvertisement` should return undefined.

Registry order: this family's signals are exclusive, so its position is not important.

Fixtures: `scan.json` (11 cases).

## Legacy framing (`0x7E`)

### Frame

Single packet, 8-byte header:

| Byte | Field |
|---|---|
| 0 | `0x7E` |
| 1 | `0x01` version |
| 2 | command |
| 3 | flags (`0x00`; bit 3 = multi-packet) |
| 4 | payload length (one byte, max 255) |
| 5..6 | serial, big-endian |
| 7 | XOR of all payload bytes; `0x00` when the payload is empty |
| 8.. | payload |

Multi-packet (flags bit 3 set, and the packet is at least 10 bytes): a 12-byte header. Bytes 0..7 describe this
chunk (length and XOR of this chunk only), then bytes 8..9 total chunk count (BE), 10..11 this chunk's index
(BE, 1-based), then the chunk.

Example: `7e 01 21 00 04 00 01 ef 07 e9 08 09` (command 0x21, 4-byte payload, serial 1, XOR `ef`).

### Serials

- Our counter starts at 1, goes up by one per frame (app ACKs included) and wraps 65535 → 1.
- It is **not** reset on reconnect (the vendor does the same). The `reconnect clears the cascade` vector shows
  serial 7 on the second link.
- A serial is an echo token for ACKs, not a sequence check. Inbound serials are never checked for order.

### ACKs (both ways)

- **App ACK.** For every inbound frame except a device ACK, write command `0xFF` with payload
  `[serHi, serLo, cmd, status]`: the inbound frame's serial and command, status `0x00`. The ACK frame has its own
  fresh serial. Write the ACK **before** acting on the frame (the vendor does). Every chunk of a multi-packet
  frame gets its own ACK.
- **Bad XOR.** Do not decode. Write the same ACK with status `0x02`; the ring sends the frame again.
- **Device ACK.** The ring answers our commands with command `0xFE`, payload `[serHi, serLo, cmd, status]`. Never
  ACK it. Status other than 0 means the ring refused the command; the port only logs it.
- The vendor app sends one command at a time and waits for its `0xFE`. The Lumen port does **not** wait: it
  queues the whole burst. This works in the Kotlin tests; behaviour on hardware: unverified.
- The vendor skips the ACK handshake for file-transfer commands `0x80 0x82 0x84 0x85 0x86`. We never send them.

### Reassembly

- Every notification is one whole frame. There is no byte stream to buffer.
- Multi-packet chunks are collected per command id. When the chunk with index = total arrives and the bucket
  holds `total` chunks, sort by index and join. A duplicate chunk would stop the frame from ever completing
  (Kotlin quirk; no retry logic).
- Reset the buckets on connect and disconnect. A stale chunk must never complete a frame on the next link.

### Commands we send (legacy)

All history requests have an empty payload.

| Op | Cmd | Payload |
|---|---|---|
| device info | `0x00` | none |
| battery | `0x01` | none |
| time sync | `0x21` | `[yearHi, yearLo, month, day, hour, minute, second]`: full year as BE u16, local wall clock |
| sync manifest | `0xA0` | none |
| steps history | `0xA1` | none |
| sleep history | `0xA2` | none |
| heart-rate history | `0xA3` | none |
| blood-pressure history | `0xA4` | none |
| SpO2 history | `0xA5` | none |
| temperature history | `0xA6` | none |
| breathing history | `0xA7` | none |
| unbind (Forget only) | `0x44` | none |
| app ACK | `0xFF` | `[serHi, serLo, cmd, status]` |

Known but never sent by the port: bind status `0x02`, features `0x03`, bind `0x20`
(`[bindType, userId UTF-16LE]`), units `0x24`, profile `0x2E`. Legacy has **no** on-demand measurement command.

### Replies we read (legacy)

All multi-byte fields are big-endian. "Ring time" is explained under "Clock".

| Cmd | Layout | Result |
|---|---|---|
| `0x00` device info | not decoded | marks the handshake done; no data kept |
| `0x01` / `0x60` battery | `[lowPowerFlag, powerStatus, percent]` | percent = **byte 2** (clamped 0..100); charging = `powerStatus == 1`. Under 3 bytes: nothing |
| `0xA0` manifest | `[count u16][flagsA][flagsB]` | flagsA bits 0..7 = steps, sleep, HR, BP, SpO2, temperature, breathing, ECG; flagsB bit 0 = sport. Under 4 bytes: ignored |
| `0xA3` HR | repeating day records `[dayTs u32][n u16]` + n × `[ts u32][bpm u8]` | bpm, kept when 25..250 |
| `0xA5` SpO2 | same, item `[ts u32][spo2 u8]` | %, kept when 50..100 |
| `0xA4` BP | same, item `[ts u32][sys u8][dia u8]` (6 bytes) | mmHg, kept when sys 60..250 and dia 30..200 |
| `0xA6` temperature | same, item `[ts u32][raw u8]` | °C = (raw + 200) / 10, kept when 30..45 |
| `0xA1` steps | day record `[dayTs u32][steps u24][kcal u24][distance u24][n u16]` + n × 8-byte items `[index u8][steps u16][kcal u24][distance u16]` | **day totals only**. Items are skipped: their bucket width is unknown |
| `0xA2` sleep | day record `[dayTs u32][totalMin u16][asleepTs u32][awakeTs u32][n u16]` + n × `[minutes u8][stage u8]` | per-minute stages from `asleepTs`; stage 0 awake, 1 light, 2 deep, 3 REM, other unknown. A record with no non-awake minute is dropped |
| `0xA7` breathing | not decoded | only advances the cascade |
| `0x02`, `0x03` | not decoded | ignored (the features bitmap layout is not extracted) |
| `0xFE` | `[serHi, serLo, cmd, status]` | device ACK, see above |

A day record whose item count runs past the end of the payload stops the decode (no partial read). Several day
records may follow each other in one payload.

Units not proven: legacy step-day `kcal` and `distance` (the port reads them as kcal and metres): unverified.

## JL framing (`0xAB`)

### Frame

| Byte | Field |
|---|---|
| 0 | `0xAB` |
| 1 | flag: `0x01` normal, `0x11` ACK |
| 2..3 | body length, BE u16 |
| 4..5 | CRC-16/ARC of the body, **big-endian** (high byte first) |
| 6..8 | body starts: `cmd`, `key`, `keyFlag` (the triple) |
| 9.. | payload |

- The body is the triple plus the payload. Length and CRC both cover the triple.
- CRC-16/ARC: init `0x0000`, reflected poly `0xA001`, no final XOR. Check value: "123456789" → `0xBB3D`. The flag
  byte is not covered, so a request and its ACK can have the same CRC.
- No sequence numbers.
- keyFlag convention: `0x00` set, `0x10` get or sync, `0x20` bind, `0x30` a second sync variant (delete).

Example: `ab 01 00 03 fc a0 02 03 10` (battery request).

### Reassembly

- A packet that starts with `0xAB` and whose body length is more than the bytes present is a header packet. Keep
  its bytes and wait.
- While waiting, every packet that does **not** start with `0xAB` is raw body bytes (no header). Append until the
  length is reached, then check the CRC. Bytes past the length are dropped.
- Packets under 6 bytes, or under 9 (no full triple), are ignored.
- Quirks to keep in mind (Kotlin behaviour, not proven on hardware): a continuation packet whose first byte
  happens to be `0xAB` is read as a new header; a complete `0xAB` frame that arrives mid-reassembly is decoded but
  the half-built frame is kept, and later raw packets still append to it.
- Reset on connect and disconnect.

### ACKs

- For every inbound frame whose flag is not `0x11`, write an app ACK: flag `0x11`, body = the inbound triple, no
  payload. One exception: for triple `06 09 xx` the ACK body is `06 09 xx 00` (4 bytes). Write the ACK before
  decoding.
- Bad CRC: drop silently. No ACK, no NACK.
- Inbound ACK frames (flag `0x11`) are not ACKed. The Kotlin driver still runs them through the decoder, so a ring
  ACK of our device-info request would mark the handshake done. Harmless, but note it.

### Commands we send (JL)

| Op | Triple | Payload |
|---|---|---|
| device info | `02 04 10` | none |
| battery | `02 03 10` | none |
| time sync | `02 01 00` | `[year - 2000, month, day, hour, minute, second]`: one-byte year, local wall clock |
| history, per stream | `05 <type> 10` | **none** |
| realtime measure | `06 09 00` | `[type, 0x05, enable]` (enable 1 start, 0 stop) |
| app ACK | inbound triple, flag `0x11` | none (`00` for `06 09 xx`) |

History and realtime `type` byte: steps `02`, heart rate `03`, BP `04`, sleep `05`, temperature `08`, SpO2 `09`,
HRV `0A`, stress `0D`, blood sugar `10`. Breathing has no JL type.

Known but never sent: profile `02 06 00`, goal `02 07 00`, units `02 11 00`, bind status `03 01 00`, bind
`03 01 20`, the `05 xx 30` delete variants. **No JL unbind is sent**: the vendor table has no confirmed triple
(`03 02 20` is the only candidate; another port used `03 01 30`, which is not in the table). Forget only drops the
link.

### Replies we read (JL)

| Triple | Layout | Result |
|---|---|---|
| `02 03 xx` battery | `[percent]` | percent (clamped 0..100). No charging flag |
| `02 04 xx` device info | not decoded | marks the handshake done |
| `05 xx 10` history | see below | events |
| `05 0E 10` sport, `05 17 10` and other `05` keys | not ported | nothing (the frame is still ACKed) |
| `06 09 xx` realtime result | **not ported** | nothing (see "Live heart rate and spot") |

History bodies (after the triple). Fixed-size records, all multi-byte fields BE, `ts` = JL ring time. A torn tail
shorter than one record is dropped. An empty body (the bare triple) means the ring holds no records.

| Type | Record | Value |
|---|---|---|
| `02` steps | 16 bytes: `[ts u32][pad][steps u24][kcal×10 u32][distance dm u32]` | one bucket per record; steps (records with 0 steps dropped), distance m = raw / 10, kcal = raw / 10 (Kotlin drops kcal). Records are per-interval deltas, not day totals |
| `03` HR | 6: `[ts u32][bpm][pad]` | bpm; 0 dropped |
| `04` BP | 6: `[ts u32][sys][dia]` | mmHg; a 0 in either drops the record |
| `08` temperature | 6: `[ts u32][raw u16]` | °C = raw / 10 (**no** +200 offset); 0 dropped |
| `09` SpO2 | 6: `[ts u32][spo2][pad]` | %; 0 dropped |
| `0A` HRV | 6: `[ts u32][hrv][pad]` | ms; 0 dropped |
| `0D` stress | 6: `[ts u32][stress][pad]` | vendor units; 0 dropped |
| `10` blood sugar | 6: `[ts u32][raw u16]` | mmol/L = raw / 10 (Kotlin converts to mg/dL × 18.016); 0 dropped |
| `05` sleep | 7: `[ts u32][model][2 unused]` | stage-change stream, see below |

JL sleep: each record is a stage change. Model `0x11` opens a session, `0x22` closes it. Each record's segment runs
to the next record's time, in whole minutes (segments of 0 or 1440+ minutes are skipped; the last record adds
nothing). Model → stage: `1` deep, `2` light, `0` or `3` awake, `4` REM, `0x11` light (the opening segment counts as
light), anything else unknown. A session is emitted at its `0x22` when it has at least one minute, timestamped at
the `0x11` record, `complete = true`. A session with no `0x22` emits nothing. **This map is not the legacy one.**

## Connect handshake

No authentication, no passcode, no bond, no profile, no units push. The person is never asked for anything.

Order after connect: discover services, choose the framing, subscribe to B003, then write back to back (the
Kotlin driver does not wait for replies):

- **Legacy:** device info `0x00`, time sync `0x21`, battery `0x01`, manifest `0xA0`. The manifest reply starts the
  history cascade.
- **JL:** device info `02 04 10`, time sync `02 01 00`, battery `02 03 10`, then the nine history requests (below).

`HandshakeInfo`: firmware is not known (the device-info reply is not decoded), so use `''` or a fixed
`'unknown'`. No serial, so `ringIdentity` falls back to the Bluetooth address, then the advertised id.
`clockOffsetS: 0` (the ring clock is never read). `battery` from the battery reply.

The Kotlin `runStartup` is also the ~30-minute background pass, so it runs again on an open link: legacy resends
all four frames (and so rereads history); JL resends the first three only.

## History sync

There are no cursors on the wire. Each stream request returns **everything** the ring holds for that stream, every
time. Nothing is deleted after a sync (the vendor's `05 xx 30` delete-acks are not sent). Repeated reads are made
safe by the content-derived record ids. `planSync` can ignore the incoming `SyncCursor`; emit no `status:cursor`
(or a fixed one).

### Legacy: manifest-gated cascade

1. Write the manifest request `0xA0`.
2. From the reply, queue only the streams whose bit is set, in this order: steps `A1`, sleep `A2`, HR `A3`, BP `A4`,
   SpO2 `A5`, temperature `A6`, breathing `A7`. (ECG and sport bits are read but never requested.)
3. Write the first queued request. When its reply frame arrives (after reassembly, after the app ACK), remove that
   stream and write the next.
4. Done when the queue is empty.

- A reply for a stream that is not queued (for example one left over from a dropped link) only gets its ACK.
- Timers: **none in Kotlin.** A lost reply stalls the cascade until the next pass. For the TS `begin()`, a stall
  timer per request is needed; the value is unverified (no capture). Something like 10 s per stream is a guess.

### JL: one burst per connection

1. After the handshake frames, write all nine requests at once, in this order: steps `02`, sleep `05`, HR `03`,
   BP `04`, SpO2 `09`, temperature `08`, HRV `0A`, stress `0D`, blood sugar `10`.
2. Each reply is a single frame (often multi-packet) holding the stream's full record list. ACK it, decode it.
3. Send the burst only once per connection; a reconnect sends it again.

- There is no "done" signal and no manifest. The Kotlin code has no terminal condition and no timers. For the TS
  port: done when all nine replies have arrived, or when a quiet timer fires after the last one. Value unverified.
- `RWfitJLHistory.kt` is a pure decoder. Chunking is plain GATT-level reassembly in the codec. The only
  acknowledgement is the per-frame app ACK.

Progress labels (Kotlin `HistoryType.label`): `activity`, `sleep`, `heart rate`, `blood pressure`,
`blood oxygen`, `temperature`, `breathing`, `HRV`, `stress`, `blood sugar`.

## Live heart rate and spot

- **Legacy: none.** The vendor app has no legacy on-demand command.
- **JL:** the start/stop command is known (`06 09 00 [type 05 01|00]`), and the app ACK rule for `06 09` is known.
  The **reply layout is not ported**: the Kotlin driver logs `06 09` frames and drops them. No test covers it.
- Kotlin never grants the realtime or manual capabilities (they wait on a features bitmap that is not decoded), so
  no Measure button is ever shown for this family.
- For the TS family: leave `liveHeartRate` and `spot` undefined until a capture shows the reply. If they are
  added for JL later, `spotStop` is the same command with enable `0`.

## Reconnect and link priority

Nothing is special for this family:

- `reconnect: ANDROID_RECONNECT` (5, 15, 30, 60, 120, 300 s; GATT 133/22/62 get two quick retries at 5 s; 257 waits
  for Bluetooth).
- `priority: DEFAULT_PRIORITY` (high while a sync or measurement runs, balanced when idle, low power after 300 s
  idle). Only YCBT (always default) and Jring (balanced floor) differ.
- On every connect and disconnect: reset both codecs and the sync state, set the framing back to legacy, and
  choose again from discovery. The legacy serial counter keeps counting.

## Clock

- **Setting the clock.** Both framings send the **local wall clock** fields (from the phone's zone). Legacy: full
  year as BE u16. JL: year − 2000 in one byte. Getting the year encoding wrong moves every timestamp by ~2000
  years. In TS: local = `nowMs / 1000 + tzOffsetS`, then take the UTC fields of that.
- **Legacy ring time.** u32 seconds since 1970, counted in local wall clock as if it were UTC. To get true epoch
  seconds the vendor subtracts `rawOffset + (zone ever uses DST ? 3600 : 0)`. That is an hour off for half the year
  in DST zones; the port copies the quirk on purpose, to agree with the vendor app.
- **JL ring time.** u32 seconds since **2000-01-01T00:00:00Z** in local wall clock. True epoch seconds =
  `raw + 946684800 − currentOffset`, where `currentOffset` is the zone's offset **now** (at decode time), not at the
  record's time. A different function from legacy; do not merge them.
- In TS terms: JL uses the session's `tzOffsetS`. Legacy needs the zone's standard offset and whether the zone
  ever uses DST, which a fixed `tzOffsetS` cannot give. See open questions.
- Fixtures use UTC, so both corrections are 0.

## Mapping to RingEvent

Times: Kotlin `Instant` → epoch **ms** in `RingEvent`.

| Kotlin event (from) | RingEvent |
|---|---|
| `Battery(percent, charging)` (legacy `0x01/0x60`, JL `02 03`) | `status` `battery` = percent; legacy also `status` `charging` = 1 or 0 |
| `Status(address = null)` (device info) | none (internal: handshake done) |
| `HistoryMeasurement(HEART_RATE)` | `sample` `hr`, unit `bpm`, origin `history` |
| `HistoryMeasurement(SPO2)` | `sample` `spo2`, unit `pct`, origin `history` |
| `HistoryMeasurement(HRV)` (JL only) | `sample` `hrv`, unit `ms`, origin `history` |
| `HistoryMeasurement(TEMPERATURE)` | `sample` `skin_temp`, unit `degC`, origin `history` (a ring reads the finger) |
| `HistoryMeasurement(BLOOD_PRESSURE_SYSTOLIC / _DIASTOLIC)` | two `vendor` events `blood_pressure_systolic_estimate` / `blood_pressure_diastolic_estimate`, unit `mmHg`, origin `history` (same keys as J-Style 2301) |
| `HistoryMeasurement(STRESS)` (JL only) | `vendor` `stress`, unit `vendor_units` |
| `HistoryMeasurement(BLOOD_SUGAR)` (JL only) | `vendor` `blood_glucose_estimate`, value raw / 10, unit `mmol/L` (keep the ring's own unit; Kotlin's mg/dL conversion is a display choice) |
| `ActivityUpdate(steps, distanceMeters, calories)` (legacy steps) | `dailyTotal`: `localDay` = `dayTs × 1000` (ring time is already local, so no correction), `steps`, `distanceM`, `kcal` |
| `ActivityBucket(steps, distanceMeters)` (JL steps) | `activityBucket`: `start`, `durS` (**unknown**, see open questions), `steps`, `distanceM`, `kcal` = raw / 10 |
| `SleepTimeline(stages, completeSession = true)` (both) | `sleepEpochs`: `start` = session start, `epochS` 60, `stages` in lower case (`LIGHT` → `light` …), `rawCodes` = the vendor code per minute (legacy stage byte, JL model byte), `firmware`, `complete: true` |
| (none in Kotlin) | `progress` per stream (labels above); `done: true` at the end of the sync |
| legacy `0xFE` with status ≠ 0 | optional `status` `error` (Kotlin only logs it) |

## Fixture counts

- `encode.json`: 31 vectors (12 asserted by Kotlin tests, 19 marked `derived:` from the encoder source) plus 8
  checksum vectors.
- `decode.json`: 61 vectors (codec 9, legacy payload 17, JL history payload 28, driver 7), including 9 negative
  cases (plus torn-tail cases).
- `sessions.json`: 6 sessions (legacy connect + cascade, JL connect + burst, four framing-choice checks).
- `scan.json`: 11 cases.

## Open questions for the port author

1. **Legacy time correction.** The legacy decode needs "standard offset + 1 h if the zone ever uses DST". A fixed
   `tzOffsetS` cannot give that. Either pass an IANA zone into the protocol state (and work out "ever uses DST"
   with `Intl`), or decide to drop the quirk and accept a one-hour difference from the vendor app in DST zones.
2. **JL step bucket width.** Records are per-interval deltas, but the interval is never stated. `activityBucket.durS`
   needs a value: compute it from the gap to the next record, or use a fixed width after a capture.
3. **JL realtime replies.** The `06 09` reply layout is unknown, so live heart rate and spot cannot be done yet.
4. **Command gating.** The vendor waits for each `0xFE` before the next legacy command; the port does not. Is the
   burst safe on real legacy rings?
5. **Sync timers.** Kotlin has none. Pick stall and quiet values for `begin()` (legacy per stream; JL for the
   burst).
6. **Device info.** Neither framing's device-info reply is decoded, so there is no firmware or serial.
   `decoderTag` cannot depend on firmware.
7. **Features bitmap.** Legacy `0x03` decides which sensor streams a ring has. Its layout is not extracted.
8. **JL unbind.** No confirmed triple.
9. **Legacy units.** Step-day calories and distance units are not proven.
10. **Write mode** of B002 (with or without response) is not recorded anywhere.

## Sources

- Kotlin (Lumen Android, `app/src/main/java/com/pulseloop/ring/`): `RWfitProtocol.kt`, `RWfitLegacyCodec.kt`,
  `RWfitJLCodec.kt`, `RWfitEncoder.kt`, `RWfitDecoder.kt`, `RWfitJLHistory.kt`, `RWfitDriver.kt`,
  `RWfitSyncEngine.kt`, `RWfitCoordinator.kt`, `RingDecodedEvent.kt`, `ReconnectBackoff.kt`,
  `ConnectionPriorityPolicy.kt`, and the RWfit parts of `RingBLEClient.kt` and `WearableDriver.kt`.
- Kotlin tests (`app/src/test/java/com/pulseloop/ring/`): `RWfitCodecTest.kt`, `RWfitDecoderTest.kt`,
  `RWfitDriverTest.kt`, `RWfitJLHistoryTest.kt`, the RWfit case in `AdvertisementMatcherTest.kt`.
  `PairingMatchingTest.kt` only lists the family in the registry; it has no RWfit-specific case.
- The Kotlin cites a decompiled vendor app for every constant. That decompile was not read for this note.
- **Licence:** the Kotlin came from upstream PulseLoopAndroid, which has no licence file. The owner accepted this
  (plan decision 3).

## Port notes (TS, `packages/rings/src/rwfit/`)

Decisions on the open questions above, and where the port differs from the Kotlin:

1. **Legacy time correction.** The port subtracts the session's `tzOffsetS` (the offset now). This equals the Kotlin rule
   in zones without DST and during DST. In a DST zone's winter the port is one hour later than the Kotlin (and the
   vendor app). No IANA zone is passed in.
2. **JL step bucket width.** `durS` is the gap to the next record (zero-step records count as boundaries), else the gap
   from the previous record, else 60 s. Gaps over a day fall back too. UNVERIFIED until a capture. JL kcal = raw / 10 is
   emitted (the Kotlin drops it).
3. **JL realtime.** `liveHeartRate` and `spot` stay undefined. `realtimeMeasure` can be framed; its `06 09` replies are
   ACKed (with the trailing `00`) and decode to nothing.
4. **Command gating.** As in the Kotlin, writes are not gated on the ring's `0xFE`. The handshake writes device info and
   time without waiting and waits for the battery reply (4 s) so `HandshakeInfo.battery` is set. A `0xFE` with status
   ≠ 0 becomes `status:error refused:0x<cmd>:<status>`.
5. **Timers** (engineering values, UNVERIFIED): replies 4 s; a history read 10 s before its first packet; after that,
   silences are tolerated up to 20 s in all. A read cut while a body is half built ends as `status:error partial:<stream>`;
   streams that never answered end as `no_reply:<stream>`. Neither moves a cursor.
6. **Device info.** Not decoded. `HandshakeInfo.firmware` is the framing (`legacy` | `jl`), so `decoderTag` is
   `rwfit/legacy@1` or `rwfit/jl@1`. No serial: identity falls back to the address, then the advertised id.
7. **Cursors.** `rw1:<newest record epoch s>` per Vitals stream, emitted when a stream's reply arrived whole; only
   progress for the service. The ring still sends everything every time.
8. **Legacy cascade.** `planSync` gives the manifest, then one `history` command per legacy stream with `ifClaimed`; an
   unclaimed stream writes nothing and takes no serial (same frames as `requestNextStream`).
9. **JL burst.** One `historyBurst` command writes the nine requests back to back and ends when all nine replied.
10. **Serials** restart at 1 per session (the Kotlin keeps counting across reconnects). Only an echo token.
11. **Legacy step day.** `dailyTotal.localDay` is the Kotlin instant `dayTs − offset` (the day's local start as a true
    instant, the contract's meaning), not `dayTs × 1000`.
12. **Blood sugar** is `vendor` `blood_glucose_estimate` in mg/dL (raw / 10 × 18.016), as the Kotlin emits it.
13. **Framing choice.** A transport without `services()` stays on legacy (the Kotlin default).
