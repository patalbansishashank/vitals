# Colmi family (R02, R03, R06, R10 and relatives)

Research notes for the `colmi` `RingFamily` in `@vitals/rings` (plan 04, R19). This describes what the upstream
Android Kotlin does, byte for byte, so the TypeScript port can match it. Golden vectors are in
`qa/fixtures/rings/colmi/`. Where a part comes from matters for licensing, so every table says its source:

- **[T]** tahnok/colmi_r02_client, MIT. The existing TS port (`src/biometrics/core/ble/colmi/protocol.ts`) uses only this.
- **[K]** the upstream PulseLoopAndroid Kotlin (`ColmiProtocol/Encoder/Decoder/Driver/SyncEngine.kt`), no licence file,
  accepted by the owner (plan decision 3). The Kotlin says in its own comments that it was cross-checked against
  [T], against Gadgetbridge and against a decompiled copy of the vendor's Android app; see "Sources".
- **[T+K]** both agree.

"Kotlin" below always means [K]. "The vendor app" is the official app these rings ship with (the Kotlin calls it
QRing).

## 1. Models and scan match

Every model below runs one protocol and one driver. Model names only pick the label and picture [K
`WearableModel.kt`].

| Model | Advertised name (regex) | OS bond |
|---|---|---|
| R02 | `^R02_.*` | no |
| R03 | `^R03_.*` | no |
| R05 (Yawell) | `^R05_[0-9A-F]{4}$` | no |
| R06 | `^R06_.*` | no |
| R07 | `^COLMI R07_.*` | no |
| R08 | `^R08_.*` | no |
| R09 | `^R09_.*` | **yes** |
| R10 | `^COLMI R10_.*` | no |
| R10 (Yawell) | `^R10_[0-9A-F]{4}$` | no |
| R11 | `^R11C_[0-9A-F]{4}$` | **yes** |
| R11 (Yawell) | `^R11_[0-9A-F]{4}$` | **yes** |
| R12 | `^COLMI R12_.*` | no |
| H59 | `^H59_.*` | no |

`ColmiCoordinator.matches` is: the name matches one of these patterns, **or** the advertised service list contains
`6e40fff0-b5a3-f393-e0a9-e50e24dcca9e` (V1) or `de5bf728-d711-4e47-af26-65e3012a5dc7` (V2). Notes:

- The Kotlin walks one catalog for every family in a fixed order, first match wins. Look-alikes that are **not**
  Colmi: `R10M[ _]XXXX` (YCBT), `R100` / `R100_<hex>` (CRP), `TK5 XXXX` (YCBT), and any `<model> XXXX` name with a
  **space** before the hex (the "SmartHealth" firmware, YCBT). The Colmi names always use an underscore.
- Some rings (an R11 sold with this firmware) advertise only the generic `SMART_RING` and no service UUID. The
  Kotlin first treats them as a different family, then re-routes to Colmi after service discovery finds V1 or V2.
  A port that sees V1/V2 after connecting should do the same.
- Web Bluetooth filters: `namePrefix` `R02_`, `R03_`, `R05_`, `R06_`, `R08_`, `R09_`, `R10_`, `R11_`, `R11C_`, `H59_`,
  `COLMI R07_`, `COLMI R10_`, `COLMI R12_`, plus `services: [V1]` and `[V2]`. `optionalServices`: V1, V2, `0x180a`.
  (`R10_` does not catch `R100_` or `R10M_`.)
- `modelFromAdvertisement`: the model from the matching pattern ("R02", …).

## 2. GATT

| Role | UUID | Notes | Source |
|---|---|---|---|
| Service V1 | `6e40fff0-b5a3-f393-e0a9-e50e24dcca9e` | Nordic-UART style base with `fff0` | [T+K] |
| Write | `6e400002-b5a3-f393-e0a9-e50e24dcca9e` | every 16-byte command | [T+K] |
| Notify | `6e400003-b5a3-f393-e0a9-e50e24dcca9e` | every 16-byte reply | [T+K] |
| Service V2 ("big data") | `de5bf728-d711-4e47-af26-65e3012a5dc7` | | [K] |
| Command | `de5bf72a-d711-4e47-af26-65e3012a5dc7` | big-data requests (first byte `bc`) only | [K] |
| Big-data notify | `de5bf729-d711-4e47-af26-65e3012a5dc7` | big-data replies, any chunking | [K] |
| Device Information | `0000180a-…` / firmware `00002a26-…` | read after subscribing; the Kotlin also reads `2a26` and `2a28` (software revision) from any service. Firmware looks like `RT09_3.10.22_260420`. | [T+K] |

- The Kotlin subscribes to both notify characteristics (notifications, not indications) before any other GATT
  work, then reads firmware. Neither subscription is marked required. No serial number is read, and the standard
  battery service is not used (battery comes from command `0x03`).
- Write type: with response when the characteristic has the Write property, else without.
- Android asks for MTU 512 before service discovery (3 s fallback if the callback never comes). Normal frames are 16
  bytes, so MTU only changes how big-data replies are chunked.
- Suggested `GattMap`: `service` V1, `write` V1 write, `notify` `[V1 notify, { characteristic: big-data notify, service: V2 }]`,
  `command` V2 command, `deviceInfo { service: 0x180a, firmware: 0x2a26 }`. **Contract gap:** `GattMap.command` has
  no service field, but this command characteristic lives in V2, not in `service`.

## 3. Framing

**Normal frame [T+K]:** 16 bytes. Byte 0 is the opcode, bytes 1..14 the sub-data (zero-padded), byte 15 the checksum
= sum of bytes 0..14 & 0xff. A reply with the wrong length or checksum decodes to `Unknown` in the Kotlin and is
otherwise ignored. A reply whose opcode has bit 7 set (`opcode | 0x80`) is the ring refusing that command (seen:
`9e` for `1e`, `f7` for `77`).

**Big-data frame [K]:** `[bc][action][length u16 LE][crc u16 LE][payload]`, not padded, not checksummed. Requests carry
CRC16/MODBUS of the payload (init `0xffff`, poly `0xa001`, little-endian on the wire). The Kotlin never checks the
CRC of a reply. Replies arrive on the big-data notify characteristic in chunks; the driver keeps one buffer: an idle
buffer accepts only a chunk that starts with `bc` and is at least 6 bytes; once a transfer has started **every**
chunk is appended, even one starting with `bc`; the transfer is complete when the buffer holds at least
`length + 6` bytes. One transfer at a time.

## 4. Clock convention

The Kotlin writes the **local wall clock** to the ring (`0x01`, BCD of the phone's local time; no offset is sent)
[K]. The ring keeps its day logs on that local clock:

- HR log requests send the local calendar date at 00:00 **UTC** as epoch seconds (`2026-07-17` → `1784246400`
  whatever the zone). The ring echoes it; the Kotlin reads the echo back as a UTC date.
- Activity replies carry a BCD local date and a local quarter-hour slot.
- History samples are placed on the **local** day grid: local midnight + slot × index.

[T] (and the existing TS port) set the clock to **UTC** instead. The two disagree; the Kotlin comments say the
local convention is what the vendor app does and that the UTC epoch fix stopped HR days landing on the wrong day in
zones east of UTC. Recommendation: follow the Kotlin (local), and report `clock_offset_s` 0 (the clock is never read
back).

## 5. Commands the Kotlin sends

Content = opcode + sub-data; the driver pads and checksums it. All on the write characteristic unless marked
"command".

| Op | Content | Meaning | Source |
|---|---|---|---|
| `01` set time | `01 yy mm dd hh mm ss lang` | BCD local time; `lang` 01 English, 00 Chinese (00 turns display models to Chinese) | [T] layout, [K] local clock + `lang` |
| `03` battery | `03` | | [T+K] |
| `04` phone name | `04 02 0a 50 4c` | constant ("PL"); `02 0a` unexplained | [K] |
| `0a` user preferences | `0a 02 00 unit sex age cm kg 78 5a 00` | unit 00 metric / 01 imperial; sex 00 female, 01 male, 02 other; age, height cm, weight kg clamped to 0..255; `78 5a` = 120/90 BP reference the vendor app always sends; last byte 0 = HR alert off. Defaults when no profile: metric, 02, 25, 175, 70 | [K] |
| `15` HR log | `15 t0 t1 t2 t3` | u32 LE epoch s of the local date at 00:00 UTC | [T] layout, [K] date rule |
| `16` HR settings read | `16 01` | | [T+K] |
| `16` HR settings write | `16 02 en iv 00 00 00 00` | `en` 01 on / **02 off**; `iv` minutes, `floor(iv/5)*5` clamped to 5..60. The four zero bytes (alarm start, low, high, switch) are required by newer firmware (R09), which acknowledges the short `16 02 en iv` but never starts sampling | [T] short form, [K] 7-field form |
| `1e` real-time HR | `1e 01` start, `1e 02` stop, `1e 03` continue | not a vendor-app command; many rings refuse it with `9e ee` (see 9.1) | [K] (from Gadgetbridge) |
| `21` goals read | `21 01` | reply not used | [K] |
| `2c` / `36` / `38` read | `2c 01`, `36 01`, `38 01` | SpO2 / stress / HRV all-day pref read; reply not decoded | [K] |
| `2c` / `36` / `38` write | `xx 02 en` | on 01 / off 00 | [K] |
| `37` stress log | `37 d` | `d` = days ago 0..6 | [K] |
| `39` HRV log | `39 d 00 00 00` | `d` = days ago 0..6, written as u32 LE | [K] |
| `3a` temp pref read | `3a 03 01` | | [K] |
| `3a` temp pref write | `3a 03 02 en 1e 05 0a 00 b9` | en 01/00, then interval 30 min, start 5, remind 10, alert bits 0, alert value `b9` (38.5 °C, inert). The short `3a 03 02 en` is acknowledged but not armed on newer firmware | [K] |
| `3c` device support | `3c` | capability bits, see 6 | [K] |
| `43` activity log | `43 d 0f 00 5f 01` | `d` = days ago; the four constants are unexplained (slots 15..95?) | [T+K] |
| `50` find device | `50 55 aa` | | [K] |
| `69` measure start | HR `69 01`, SpO2 `69 03 25` | SpO2's third byte is BCD 25, what the vendor app sends ([T] sends `01` there) | [T] family, [K] bytes |
| `6a` measure stop | HR `6a 01 bpm 00`, SpO2 `6a 03 00 00` | HR stop carries the last bpm (0 = cancelled) so the ring logs it. `6a` stops the ring's whole measuring engine, HR included | [T] family, [K] bytes |
| `77` sport session | `77 status type` | status 01 start, 02 pause, 03 resume, 04 stop; type 04 walk, 07 run, 08 hike, 09 cycle, 16 yoga, 0a other | [K] |
| `08` power off | `08 01` | | [K] |
| `ff` factory reset | `ff 66 66` | | [K] |
| big data `2a` SpO2 | `bc 2a 01 00 ff 00 ff` (command) | all history | [K] |
| big data `27` sleep | `bc 27 02 00 81 80 ff 01` (command) | payload `ff` all history, `01` protocol version. The older one-byte `ff` payload is silently ignored | [K] |
| big data `25` temperature | `bc 25 01 00 crc n` (command) | `n` days, clamped 1..255 (6 normally, 1 on a today-only pass) | [K] |
| big data `77` interval temperature | `bc 77 02 00 crc day packet` (command) | only when the `3c` reply sets supportIntervalTemp | [K] |

Never sent: blood pressure (`14`, `0e`), blood sugar (big data `47`): Colmi rings support neither, and asking makes
some rings re-send their last big-data frame in a loop. No keepalive either (the vendor app sends none; `3a` is
not a ping on this family).

## 6. Replies

Normal channel, 16 bytes; indices are full-frame (byte 0 = opcode).

| Reply | Layout | Kotlin result | Source |
|---|---|---|---|
| `03` battery | `[1]` percent, `[2]` charging (0/1) | Battery(percent); `[2]` ignored | [T+K] (`[2]` from [T]) |
| `73 0c` battery push | `[2]` percent | Battery | [K] |
| `73 12` live activity | `[2..4]` steps, `[5..7]` calories (cal), `[8..10]` metres, each **big-endian** u24 | ActivityUpdate(steps, metres, kcal = cal / 1000 integer); dropped as CommandAck if steps > 200 000 | [K] |
| `1e` real-time HR | either `[1]` = 0 and `[2]` bpm, or `[1]` bpm | bpm 30..220 → sample; `[1]` nonzero and not a bpm → complete (no reading); `[1]` = 0 and no bpm → warm-up, nothing | [K] |
| `9e` | `9e ee` | refusal of `1e` → complete (and the fallback, 9.1) | [K] |
| `69` measurement | `[1]` type (1 HR, 3 SpO2; anything but 3 is treated as HR), `[2]` error, `[3]` value | HR: error ≠ 0 → complete; 30..220 → sample; else warm-up. SpO2: error ≠ 0 → complete; 70..100 → result; else warm-up. Error 1 = not worn | [T] layout, [K] ranges |
| `78` sport telemetry | `[1]` data type, `[2]` status (03 = ring ended the session), `[3..4]` duration min (BE), `[5]` bpm, `[6..8]` steps, `[9..11]` metres, `[12..14]` calories ×1000 | SportTelemetry always; plus HR sample if bpm 30..220. Steps/metres/calories/duration not used | [K] |
| `f7` | `f7 …` | refusal of `77`: no sport sessions on this firmware | [K] |
| `16 01` HR settings read | `[2]` 01 on / 02 off, `[3]` interval min | used in the handshake (7) | [T+K] |
| `3a 03 01` temp pref read | `[3]` 01 on / 00 off | used in the handshake | [K] |
| `3c` device support | `[2] & 0x08` supportBlePair; `[9] & 0x80` supportIntervalTemp | bond request (7); temperature path (8) | [K] |
| `15` HR log | packet 0: `[2]` packet count (2..64 trusted), `[3]` slot minutes (1..240 trusted). packet 1: `[2..5]` day echo u32 LE, `[6..14]` 9 samples. packet n ≥ 2: `[2..14]` 13 samples. `[1]` = ff: no data | sample i of packet n at local midnight + (offset + i) × slot, offset 0 for packet 1 and `(9 + (n-2)*13)` slots for n ≥ 2. 0 = no sample. Default slot 5 | [T+K] |
| `37` stress log | packet 0 as HR; packet 1: `[2]` day offset echo (0..29 trusted), `[3..14]` 12 samples; n ≥ 2: 13 samples | same grid, offset `(12 + (n-2)*13)` slots, default slot 30; value 0 = none | [K] |
| `39` HRV log | as stress | HRV value, unit not stated (ms assumed) | [K] |
| `43` activity log | header `[1]` = f0 (skipped; [T]: `[3]` = 1 means "new calorie protocol", calories ×10). data: `[1..3]` BCD yy mm dd, `[4]` quarter-hour slot 0..95, `[5]` index, `[6]` count, `[7..8]` calories u16 LE (ignored by [K]), `[9..10]` steps u16 LE, `[11..12]` metres u16 LE. `[1]` = ff: no data | ActivityBucket at local date + slot × 15 min; dropped if outside now − 8 days .. now + 1 h. A non-BCD date byte throws in the Kotlin | [T+K] |
| `14` blood pressure | `[1..4]` epoch s LE, `[5]` dia, `[6]` sys; `ff ff ff ff` end | decoded defensively only, never requested | [K] |
| anything else | | CommandAck(opcode), ignored | [K] |

Big-data replies (all [K]); payload starts at byte 6:

| Action | Payload | Result |
|---|---|---|
| `2a` SpO2 | `length / 49` blocks of `[days ago][24 × (min, max)]` | per hour with min and max > 0: SpO2 = (min + max) / 2 at local midnight of that day + hour. Every block is read whatever the day order |
| `27` sleep, `3e` nap | `[days in packet]` then per day `[days ago][day bytes][start min u16 LE][end min u16 LE][(stage, minutes) pairs…]`; pairs run while 4 + 2k < day bytes | one SleepTimeline per day: start = local midnight of that day + start minutes, minus 1440 when start > end (a night that began the evening before). Stage 2 light, 3 deep, 4 REM, 5 awake, other unknown; pairs with 0 minutes skipped. `3e` comes unasked next to `27` on rings with naps |
| `25` temperature | day blocks `[days ago][span min][1440 / span bytes]` | °C = raw / 10 + 20 at local midnight + i × span; 0 = none; span outside 1..1440 → 30 |
| `77` interval temperature | `[0]` day, `[1]` interval min (0 → 30), `[2]` packet count, `[3]` packet index, then u16 LE samples | °C = raw / 100 at local midnight of (today − day) + slot × interval, slot continuing across the day's packets |
| `47` blood sugar | | ignored |

## 7. Handshake (what `runStartup` does on connect)

All of these are queued at once; nothing waits for a reply [K]:

1. `04` phone name, `01` set time (local), `0a` user preferences (profile, or the defaults).
2. `3c` device support, `03` battery.
3. Reads: `16 01`, `36 01`, `2c 01`, `38 01`, `3a 03 01`, `21 01`.
4. If the person has saved measurement settings: write them (`16 02 …`, `2c 02`, `36 02`, `38 02`, `3a 03 02 …`).
   If not: write `2c 02 01`, `36 02 01`, `38 02 01` (SpO2, stress and HRV forced on, the history needs them) and
   take HR and temperature settings from the ring's replies instead of overwriting them.
5. Start the history walk (8) with `43 00 0f 00 5f 01`.

Replies handled during the handshake:

- `3c`: remember supportIntervalTemp; if supportBlePair, ask the platform to bond. The Kotlin then bonds only models
  on its allowlist (R09, R11, Yawell R11) and only after the GATT queue is idle, and only if not bonded yet. The
  vendor app bonds every ring with the bit; the Kotlin does not, because the R10 sets it too and does not need a bond
  (the pairing dialog was a regression). In the contract: `status: bond_requested` from the protocol, the allowlist in
  the family's handshake.
- `16 01` (no saved settings only): interval outside 5..60 → 5. If HR is off, write `16 02 01 <interval> 00 00 00 00`
  (all-day HR must be on or the HR log is empty). This write lands behind everything already queued.
- `3a 03 01` (no saved settings only): once both replies are in, the seeded settings are HR on + the ring's interval,
  SpO2/stress/HRV on, temperature as the ring said; the app saves them.
- `03`: battery.

The handshake has no "done" reply. The contract's `handshake()` can run steps 1..4 and return after the battery
reply (or a short timeout), with `firmware` from the Device Information read.

## 8. History sync

One walk per connection, driven by replies, one stage at a time [K]:

| # | Stage | Requests | Day ends when | Next |
|---|---|---|---|---|
| 1 | Activity | `43 d …`, d = 0..7 | `[1]` = ff, or a data packet with `[5]` = `[6]` − 1 | HR |
| 2 | HR | `15 <date>`, d = 0..7 | `[1]` = ff, or packet ≥ 2 equal to count − 1 (count from packet 0), or packet 23 | Stress |
| 3 | Stress | `37 d`, d = 0..6 | `[1]` = ff, or packet ≥ 2 equal to count − 1 (count 5 if packet 0 was missed) | SpO2 |
| 4 | SpO2 | big data `2a` | the transfer completes | Sleep |
| 5 | Sleep | big data `27` | the transfer completes | HRV |
| 6 | HRV | `39 d …`, d = 0..6 | as stress | Temperature |
| 7 | Temperature | interval `77 day packet` if supportIntervalTemp, else legacy `25 06` | legacy: the transfer completes. Interval: if the packet index went up and is below count − 1, ask `day, index + 1`; else next day `day + 1, 0` up to day 6; then done | done |

- Day index: "days ago" counted on the phone's local calendar. HR uses the date rule in 4. Packet 1 of HR echoes the
  day; the Kotlin re-anchors the samples to the echoed date if it is within ± 2 days of the requested one (a garbage
  echo such as `ff ff ff ff` is ignored). Packet 1 of stress/HRV echoes the day offset (0..29).
- Packet count and slot minutes are reset on every request.
- **Watchdog:** 10 s (20 s for activity), re-armed on every history packet and every big-data completion. When it
  fires, the rest of the stuck stage is skipped and the next stage starts (temperature → done). There is no retry.
  In the contract this is `stallMs` = `quietMs` = 10 000 (20 000 for activity), and `timeout` moves to the next stage.
- **Stray frames:** a big-data completion for SpO2, sleep, temperature or interval temperature advances only when the
  walk is on that stage; a re-sent frame after done is ignored. A `3e` nap never advances anything.
- **Done:** the walk publishes sync progress "done" (the app's only "fully synced" signal).
- **Today only:** after one complete walk, a second `runStartup` on the same engine reads only day 0 of every stage
  and asks legacy temperature for 1 day. The app builds a new engine on every connection and calls `runStartup` once
  per engine, so in practice every connection walks the full 8/7 days. There are no cursors.
- **Sleep on its own:** `syncSleepNow` sends only `bc 27 02 00 81 80 ff 01` when no walk is running. Its completion
  does not advance anything; a 10 s timer drops it quietly. A walk that starts meanwhile cancels it. The app calls it
  when a walk ends and when the sleep screen opens, because a dropped sleep request inside the walk is skipped
  silently by the watchdog.

## 9. Live and spot measurements

### 9.1 Live heart rate and the real-time fallback

1. Start with `1e 01` [K]. A ring that accepts it streams `1e` frames; the Kotlin sends `1e 03` every 20 s (wall
   clock, not per frame) and stops with `1e 02`.
2. A ring that answers `9e` (seen: every `1e` frame of an R09 on firmware `RT09_3.10.22_260420` came back `9e ee`)
   is marked "refuses real-time" for the rest of the connection; the Kotlin cancels the keepalive and starts
   `69 01` instead. Later sessions on that connection go straight to `69 01`. A `9e` with no session running only
   sets the mark.
3. On the `69` stream the Kotlin re-sends `69 01` only after 30 s without a `69/01` frame (checked every 20 s),
   because re-sending mid-measurement restarts the reading. A `69/03` (SpO2) frame does not count. Stop with
   `6a 01 <last bpm> 00`. Calling start again while the stream runs sends nothing.

The vendor app never sends `1e`; it only ever receives `1e` as an unasked bpm push.

### 9.2 Spot measurements

- HR: `69 01`, the caller samples for 30 s and ignores the first 5 s (the ring may echo a cached value), then
  `6a 01 <last bpm> 00`.
- SpO2: `69 03 25`, 60 s window, stop `6a 03 00 00`. The ring streams warm-up frames (about 25 s on an R09) before
  real values. Because `6a` stops everything, a live HR stream must be restarted after an SpO2 spot.

### 9.3 Workouts (sport session)

A workout is a ring-side sport session, not an HR stream [K]: `77 01 <type>` on start, the ring then pushes `78`
about every 10 s with bpm, `77 04 <type>` on stop. No keepalive. A restart after a spot measurement must not resend
`77 01` (that resets the ring's own sport record). Every 20 s a watchdog checks: 45 s without `78` → one
`77 03 <type>` (resume); still silent 45 s later → `77 04 <type>` and fall back to 9.1 for the rest of the workout,
remembered for the connection. `f7` (refusal) → fall back, remembered for the connection. `78` with status 03 (ring
ended the session) → fall back for this workout only; the next workout tries `77 01` again.

## 10. Measurement settings

- All-day HR: `16 02 en interval 00 00 00 00`; interval in 5-minute steps, 5..60 (input rounded down to a multiple of
  5, then clamped; 7 → 5, 33 → 30, 90 → 60, 0 → 5).
- SpO2 / stress / HRV: `2c|36|38 02 en`. Temperature: `3a 03 02 en 1e 05 0a 00 b9`.
- Saved settings are written in the handshake and again whenever the person changes them (all five commands, in the
  order HR, SpO2, stress, HRV, temperature).
- Without saved settings the ring's own HR interval and temperature switch win (7), except that all-day HR is always
  turned on.

## 11. Reconnect and link priority

- Reconnect: `ReconnectBackoff.kt` = `ANDROID_RECONNECT` in `types.ts` (5, 15, 30, 60, 120, 300 s; GATT 133/22/62 get
  the first two retries at 5 s; 257 waits for Bluetooth). Nothing Colmi-specific.
- Priority: `ConnectionPriorityPolicy.kt` gives Colmi the default rule = `DEFAULT_PRIORITY` (high while syncing,
  measuring or in a workout; balanced when idle; low power after 300 s idle).
- Liveness: no keepalive, so silence is normal. The Kotlin checks the OS's own GATT connection state instead of
  timing out on silence.
- Every reconnect is a new engine: the "refuses real-time" and "no sport sessions" marks, the capability bits and the
  today-only state all start over.

## 12. Mapping to RingEvent

| Kotlin event | RingEvent |
|---|---|
| `HeartRateSample` from `1e` / `69` (live session) | `sample` hr, bpm, origin `live` (`spot` during a spot measurement); t = receive time |
| `HeartRateSample` from `78` | `sample` hr, bpm, origin `workout_stream` |
| `HeartRateComplete` (`9e`, error byte) | `status` `error` (`no_reading`); ends a spot measurement early |
| `Spo2Result` / `Spo2Complete` | `sample` spo2, `pct`, origin `spot` / end of the spot |
| `Battery` (`03`, `73 0c`) | `status` `battery`, percent (and `charging` from `03 [2]` if the port adopts [T]'s reading) |
| `ActivityUpdate` (`73 12`) | `dailyTotal` for today's local day: steps, distanceM, kcal |
| `ActivityBucket` (`43`) | `activityBucket` start, durS 900, steps, distanceM (calories bytes: optional `vendor` `colmi_calories_raw`, as the existing port does) |
| `HistoryMeasurement` HEART_RATE | `sample` hr, bpm, origin `history` |
| `HistoryMeasurement` HRV | `sample` hrv, `ms` (unit unverified), origin `history` |
| `StressSample` (history) | `vendor` `stress`, `vendor_units`, origin `history` |
| `HistoryMeasurement` SPO2 | `sample` spo2, `pct`, origin `history` (hourly (min+max)/2; min and max could also go out as `vendor`) |
| `SleepTimeline` (`27`, `3e`) | `sleepEpochs` start, epochS 60, stages (light/deep/rem/awake/unknown), `rawCodes` = the vendor stage code per minute, firmware from Device Information, `complete` (Kotlin always leaves it false; see open questions) |
| `TemperatureSample` (`25`, `77`) | `sample` skin_temp, `degC`, origin `history` |
| `SportTelemetry` | no event of its own; status 03 ends the workout stream |
| `3c` reply | `status` `capabilities`; `status` `bond_requested` when supportBlePair |
| Firmware read (`2a26`/`2a28`) | `status` `firmware` |
| Walk finished | `progress` { stage: `temperature`, done: true } |
| `CommandAck`, `Unknown`, pref-read replies | nothing (diagnostics only) |

## 13. Differences from the existing TS port ([T] only)

| Topic | Existing port [T] | Kotlin [K] |
|---|---|---|
| Clock | UTC | local wall clock |
| HR day request | UTC midnight of a UTC day | local date at 00:00 UTC |
| HR settings write | `16 02 en iv` | `16 02 en iv 00 00 00 00` |
| Measure start / continue / stop | `69 k 01`, `69 k 03`, `6a k 00 00` | `69 01`, `69 03 25`; no continue on `69`; `6a 01 bpm 00`, `6a 03 00 00` |
| Days read | 7 | activity/HR 8 (0..7), stress/HRV 7 |
| Sleep, SpO2, temperature, stress, HRV, device support, profile | not implemented | implemented (big data on V2) |

## 14. Unverified and open questions

- `1e` reply layout: the Kotlin accepts two shapes because neither is confirmed on hardware.
- Reply layouts of `2c 01` / `36 01` / `38 01` / `21 01` / `01` / `04` / `0a` / write acks: never decoded. The vendor app
  reads a "new sleep protocol" bit from the set-time reply (byte 8 per the Kotlin docs); the Kotlin ignores it and
  always uses big data `27`. Old-protocol rings (day-indexed sleep reads) are not supported.
- HR log: a day whose packet 0 says count 2 never ends (packet 1 is never terminal), so it waits for the watchdog.
  Packet 23 always ends an HR day.
- HRV unit (assumed ms) and stress scale are not stated anywhere.
- Big-data reply CRC: never checked; whether rings fill it in is unknown.
- `43` request constants `0f 00 5f 01` and the header packet's bytes are not understood.
- `78` steps/metres/calories/duration are not used; their scale is from the Kotlin comments only.
- `sleepEpochs.complete`: whether the ring has closed last night's record at the time of a morning sync is open
  (a Lumen diagnosis saw an R10 return no sleep right after waking).
- The R09 streaming `69 01` continuously (rather than stopping after one reading) is not hardware-confirmed.
- Contract: `GattMap.command` needs a service UUID (section 2). There is no cursor in the Kotlin; a `SyncCursor`
  (last complete local day per stream) would only shorten the walk, since the ring keeps about 7 days.

## Sources

- **Kotlin [K]:** upstream PulseLoopAndroid, `app/src/main/java/com/pulseloop/ring/Colmi{Protocol,Encoder,Decoder,
  Driver,SyncEngine}.kt`, `ReconnectBackoff.kt`, `ConnectionPriorityPolicy.kt`, `RingBLEClient.kt` (GATT order, MTU,
  bond allowlist), `wearables/WearableModel.kt` (name patterns), and the tests `Colmi{DecoderTest,
  MeasurementSettingsTest, QringParityTest, RealtimeHeartRateFallbackTest, SleepSyncTest, SportModeTest,
  SyncEngineGateTest}.kt`; Lumen docs `qring-ble-adoption.md` and `colmi-sleep-sync-diagnosis.md`. No licence file;
  the owner accepted it (plan decision 3). By its own comments the Kotlin draws on: [T]; Gadgetbridge (AGPL), for the
  `1e` real-time request and its reply layout (the existing port's notes add that public write-ups of the big-data
  sleep/SpO2 layout also trace back to Gadgetbridge); and a decompiled copy of
  the vendor's Android app, for the 7-field `16` write, `3c`, `77`/`78`, the big-data request header and CRC, interval
  temperature, the temperature-pref write, nap sleep and the `69 03 25` / `6a 01 bpm 00` bytes. Nothing here was
  taken from Gadgetbridge or the decompile directly.
- **[T]:** tahnok/colmi_r02_client, MIT, (c) 2024 Wesley Ellis: framing and checksum, set time, battery, HR log
  `15`, HR settings `16` (short form), steps `43`, real-time `69`/`6a` reading types. The existing TS port is built
  from [T] only, deliberately without the big-data sleep/SpO2 path.

## Port notes (`packages/rings/src/colmi/`)

What the TypeScript port decided where the Kotlin, this doc and the library contract meet.

- **Clock:** follows the Kotlin. `01` sets the ring to the device's **local** wall clock (`nowMs` + `tzOffsetS` stamped
  by the session); HR day requests send the local date at 00:00 UTC; all history sits on the local day grid at the
  fixed offset of the sync. The clock is never read back, so `clockOffsetS` is 0.
- **History walk:** one exchange per stage (`planSync` returns seven `history` commands in the Kotlin order); the days of
  a paged stage are follow-ups (`send`). Every fresh connection walks the full 8/7 days, as the Kotlin does. A stage
  that completed on the same connection reads today only (the Kotlin's warm pass, kept per stage here instead of
  per engine so a single-stream read does not shorten the others).
- **Cursor:** the Kotlin has none. Each stream gets `status:cursor` `c1:<local date of the sync>` when its whole walk
  completed; a stalled or partial stage emits none. `planSync` does not use it to shorten the walk.
- **Timers:** stall and quiet are the Kotlin watchdog (10 s, 20 s for activity). Changed from the Kotlin: a quiet timer
  never ends a day or transfer that still owes packets (HR/stress/HRV count from packet 0, activity until its last
  packet, any half big-data transfer); the read waits up to 30 s of silence in all, then ends with `status:error`
  `partial:<stream>` and no cursor. A stall (no reply to a request) ends the stage with `stall:<stream>` (the Kotlin
  skipped the rest of the stage silently). An HR day whose packet 0 says count 2 never meets the Kotlin's terminal
  rule; here the quiet timer ends that day and the walk goes on to the next day (the Kotlin's watchdog skipped the
  rest of the stage). A half big-data buffer is dropped when a read ends short or a new stage starts (the Kotlin kept
  it, which would swallow the next transfer).
- **Handshake:** the Kotlin queues every write at once and never waits. Here the four reads whose replies are decoded
  (`3c`, `03`, `16 01`, `3a 03 01`) wait up to 3 s each and a silent ring is not an error; the others are written back
  to back. The HR-on write after a `16 01` reply with HR off goes last (the Kotlin queued it behind the first history
  request, which belongs to the sync here). Saved measurement settings come from `createColmiFamily({ settings })`;
  the seed the Kotlin persists when none were saved is `seededSettings(state)`.
- **Bond:** `3c` with supportBlePair emits `status:bond_requested` (value = model) only for R09 and R11 (both name
  forms), the Kotlin allowlist; `status:capabilities` lists `ble_pair` / `interval_temp`.
- **Live heart rate:** `1e 01`; a `9e` moves the stream onto `69 01` for the rest of the connection; stop is `1e 02` or
  `6a 01 <last bpm> 00`. Not ported: the 20 s `1e 03` keepalive and the 30 s `69 01` re-arm (both need a wall-clock
  timer the contract does not offer). The protocol cannot see whether a live stream runs, so the first `9e` always
  starts the fallback when no history read is in flight (UNVERIFIED that a `9e` never arrives unasked).
- **Spot:** HR `69 01` / `6a 01 <last bpm> 00`, SpO2 `69 03 25` / `6a 03 00 00`; a ring-side error frame ends the spot
  (`status:error no_reading`). The last bpm is the last `69/01` reading on the connection (the Kotlin resets it on
  start; the protocol has no start hook in stream mode). Dropping the first 5 s of a spot is the caller's job.
- **Workouts:** sport-session frames (`77`) are encoded and `78` decodes to `workout_stream` heart rate, but the
  session engine (resume/stop watchdog, fallbacks on `f7` and status 03) is not ported: the library has no workout API.
- **Decoding:** a non-BCD activity date drops the packet (the Kotlin threw). Battery `03 [2]` is ignored, as in the
  Kotlin. Live activity `73 12` becomes `dailyTotal` on today's local day. HRV unit `ms` and the stress scale stay
  UNVERIFIED; `sleepEpochs.complete` is always false, as in the Kotlin.
- **Not done:** re-routing a `SMART_RING` advertisement to Colmi after service discovery (another family claims it
  first; the reroute belongs to the platform layer).
