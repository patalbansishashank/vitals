# J-Style 2301 family (R19)

What a `RingFamily` for the J-Style 2301 ring (`id: 'jstyle2301'`) needs to know. Written from the owner's Android
Lumen app (Kotlin: `JStyle2301Protocol.kt`, `JStyle2301Decoder.kt`, `JStyle2301FirmwareProfile.kt`,
`JStyle2301Driver.kt` with its `JStyle2301HistorySync` and `JStyle2301SyncEngine`, `ReconnectBackoff.kt`,
`ConnectionPriorityPolicy.kt`, `RingBLEClient.kt`), its unit tests, its notes (the manual heart rate note, the MQTT
note, the V0789 awake note, Lumen's V0789 transition note, the J-Style parity audit), and the existing TS port in
`src/biometrics/core/ble/jstyle2301/`. Golden vectors: `qa/fixtures/rings/jstyle2301/`.

Things the Kotlin does but nobody has checked on a ring are marked **unverified**.

## 1. Recognising the ring (`ScanMatch`)

- Service `0000fff0-0000-1000-8000-00805f9b34fb` (FFF0) in the advertisement.
- Manufacturer data, on-air layout: company id `0x1234` little-endian first (`34 12`), at least 4 bytes, and the
  last two bytes are `23 01`. Example from the Kotlin test: `34 12 44 23 01`.
- The Kotlin also matches a brand-bearing name prefix. It is not used in Vitals. `SMART_RING` is a different family
  (Jring, service 56FF) and must not match.
- Web Bluetooth filters: `{ services: [FFF0] }` and
  `{ manufacturerData: [{ companyIdentifier: 0x1234 }] }`. The Web Bluetooth prefix filter cannot express "ends with
  `23 01`", so `match()` checks the suffix. `optionalServices: [FFF0]`.
- Model names for the ledger: `2301A`, `2301B` (the platform name in the Kotlin coordinator).

## 2. GATT map (`GattMap`)

| Role | UUID | Mode |
|---|---|---|
| service | `0000fff0-…` (FFF0) | |
| write | `0000fff6-…` (FFF6) | write with response when FFF6 allows it, else without (Android picks by the characteristic's properties; FFF6's properties are **unverified**) |
| notify | `0000fff7-…` (FFF7) | `notify`; subscribed before anything is written |

No command channel, no standard battery or Device Information service is used. No OS bond is needed (the Android
app bonds only two Colmi models). Android asks for MTU 512 on connect; 130-byte sleep packets and the 22-byte `0x09`
realtime packets need an MTU above 23 (**unverified** what the ring does at MTU 23).

## 3. Frames and checksum

Every write is 16 bytes:

```
byte 0      opcode
bytes 1–14  payload, zero filled
byte 15     checksum = (sum of bytes 0..14) & 0xff
```

Notifications are not framed the same way. Info replies seen on a ring are 16 bytes with the same checksum. History
notifications are one or more fixed-size records back to back, with no checksum. The decoder never checks a
checksum on input.

## 4. Commands

| Op | Name | Payload (bytes 1..) | Reply |
|---|---|---|---|
| `0x13` | battery | none | `13 pct …` |
| `0x21` | chip info | none | acknowledged only; defined but never sent by the Kotlin driver |
| `0x27` | firmware | none | `27 b1 b2 b3 b4 …` |
| `0x3E` | device name | none | acknowledged only; never sent |
| `0x3C` | authenticate (V0789) | see §5.2 | `3c 01 …` accepted, anything else rejected |
| `0x09` | realtime steps | `enable(1/0) 00` | stream of `0x09` packets, heart rate at byte 21 |
| `0x28` | measurement | `type(02 = heart rate) start(1/0) secondsLo secondsHi` | `28 type value …` |
| `0x19` | sport mode | `state mode 00 02` | acknowledged; ring then pushes `0x18` |
| `0x51`…`0x66` | history | `mode` (0 first page, 2 continuation) | records (§5.6) |

Exact frames (checksum last):

- prepare `09 01 00 … 0a`, prepare stop `09 00 00 … 09`
- heart rate start (30 s) `28 02 01 1e 00 … 49`, stop `28 02 00 1e 00 … 48`
- sport: state 1 start, 2 pause, 3 resume, 4 stop; mode 0 run, 9 walk. Walk start `19 01 09 00 02 … 25`
- history: heart rate first page `55 00 … 55`, continuation `55 02 … 57`

## 5. Replies and records

### 5.1 Info

- Battery `0x13`: byte 1 is the percentage. No charging flag is read.
- Firmware `0x27`: bytes 1..4, each written as hex without padding, upper case, joined, prefixed `V`:
  `27 00 05 02 05` → `V0525`, `27 00 07 08 09` → `V0789`. A byte of `0x10` or more gives two digits. The rest of the
  reply is not decoded (**unverified** meaning). A reply shorter than 5 bytes is ignored.
- `0x21`, `0x3E`, `0x19` replies: an acknowledgement, no value.

### 5.2 Authentication `0x3C`

V0789 needs a 16-byte 0x3C write carrying the built-in passcode (`passcode.ts`, `builtInPasscode()`); the value is
never written anywhere else; see jstyle2301-passcode.md.

- Reply: byte 1 = `01` accepted; any other value rejected.
- The Kotlin calls it non-mutating and connection-scoped: it is sent again on every connection.
- `redactOutbound` keeps byte 0 and zeroes bytes 1..14 and recomputes the checksum: `3c 00 … 00 3c`. Captures and
  logs only ever hold that copy.
- No reply timeout in the Kotlin (open question 4).

### 5.3 Realtime steps `0x09`

Written as `09 01 00` to prepare a manual heart-rate reading. The ring then streams `0x09` packets. Byte 21 is the
heart rate; it counts only when 30..220. The rest of the packet is activity data the vendor SDK parses
(**unverified** layout; Vitals does not decode it). A packet shorter than 22 bytes has no heart rate.

### 5.4 Measurement `0x28`

Reply byte 1 is the type, byte 2 the value. Only type `02` (heart rate) is read. On V0789 the `0x28` replies seen on
the ring were all zero (start and stop acknowledgements); the real reading arrives on the `0x09` stream. A non-zero
type-2 value is taken as the ring's own spot result. Other types carry no value Vitals reads.

### 5.5 Sport telemetry `0x18`

Pushed during sport mode. At least 14 bytes, else ignored. Byte 1 heart rate (counts when 30..220); per the vendor
SDK bytes 2–5 steps, 6–9 calories, 10–13 active time (**unverified**, not decoded).

### 5.6 History records

Request: `[opcode, mode, 0 …, checksum]`. The reply is notifications whose byte 0 is the opcode.

Cutting: strip a trailing terminal first (see §7), then walk the body in record-size steps and keep each record
whose byte 0 is the opcode. A short tail is dropped. Bytes 1–2 of every record are not decoded (**unverified**
meaning).

Timestamp: BCD `YY MM DD hh mm ss` at bytes 3..8, year 2000+YY, ring-local wall time (§6). A nibble above 9 or an
impossible date drops the record. The activity total carries a BCD date only, `YY MM DD` at bytes 2..4, read as
local midnight.

Little-endian throughout.

| Opcode | Stream | Size | Fields after the timestamp |
|---|---|---|---|
| `0x51` | activity total (per day) | 26 or 27 | date at 2..4; steps u32 @5; exercise seconds u32 @9; distance u32 @13 in 10 m units; calories u32 @17 in 0.01 kcal (rounded to whole kcal); step goal u8 @21 (26-byte) or u16 @21 (27-byte); last 4 bytes opaque "active time" |
| `0x52` | activity detail (10 min) | 25 | steps u16 @9; calories u16 @11 in 0.01 kcal; distance u16 @13 in 10 m units; 10 per-minute step counts @15..24 |
| `0x53` | sleep | 130 or 34 | 130-byte packet: count @9, then `count` one-minute stage codes @10.. (at most 120). 34-byte record: count @9 (at most 24), then codes @10..33, each covering 5 minutes |
| `0x54` | workout heart rate | 24 | 15 bpm bytes @9..23, 10 s apart; 0 = no sample |
| `0x55` | heart rate | 10 | bpm @9 |
| `0x56` | HRV bundle | 15 | raw HRV @9; vascular age @10; heart rate @11; stress @12; systolic estimate @13; diastolic estimate @14 |
| `0x62` | skin temperature | 11 | u16 @9 in 0.1 °C |
| `0x66` | SpO2 | 10 | percent @9 |

Activity total size: body length 2 → 27; divisible by 26 → 26; divisible by 27 → 27; (length − 2) divisible by 26 →
26; else 27. Both firmwares seen send 27. When 26 occurs is **unverified**.

Activity detail to buckets: one bucket per minute with steps, at record time + i × 60 s. The record distance is split
in proportion to steps (rounded), the last non-zero minute takes the remainder (never below 0). If every minute is 0
but the record total is not, one bucket with the total. Record calories > 0 are kept as the vendor value
`activity_detail_calories` (kcal), not as active energy: the ring's daily total and the vendor app's total have not
been reconciled.

34-byte sleep records: implemented in the Kotlin, never seen on either firmware (**unverified**).

Plausibility gates: HRV bundle values count only when > 0; the blood-pressure pair only when systolic is 60..250
and diastolic 30..150, and both stay vendor values (firmware estimates, not cuff readings). Live and sport heart
rate: 30..220. History heart rate, SpO2 and temperature have **no gate** in the Kotlin (open question 2).

## 6. The ring clock

The Kotlin never sets the ring clock and never reads it. Timestamps are ring-local wall time, turned into instants
with the phone's time zone at decode time (Kotlin uses the zone's rules per record; the TS port uses one offset per
sync, `tzOffsetS`). `HandshakeInfo.clockOffsetS` is 0. The TS port reports records more than 120 s ahead of the phone
as `status: clock_offset_s` (a proposal, not Kotlin behaviour). Live and spot readings carry no time: they are
stamped with the phone's `nowMs`.

## 7. Firmware profiles

Framing is shared; meanings are chosen only after the firmware reply.

| | V0525 | V0789 | any other |
|---|---|---|---|
| authentication | no | yes, before any history, measurement or sport command (V0789 ignores history until `3c 01`) | no |
| sleep codes | 1 deep, 2 light, 3 REM, 5 awake, 11 and 12 awake (seen only as a packet's first minute), else unknown | 1 deep, 2 light, 3 REM, 5 awake, 10 and 11 awake, else unknown | all unknown |
| HRV | ms = floor(raw / 2) + 5 | same | none (raw kept as `hrv_raw` only) |
| exercise field of `0x51` | seconds; active minutes = floor(s / 60), replaces the day's value | same | not converted |

The revision is matched after trimming, upper-casing and dropping a leading `V`: `0525` or `0789`. Evidence: the
J-Style parity audit (V0525; HRV transform 399 of 399 samples, sleep map 91 % minute agreement), Lumen's V0789
transition note, and the V0789 awake note (byte 5 = awake).

## 8. Handshake (`RingFamily.handshake`)

Order on Android, confirmed on a V0789 ring:

```
subscribe FFF7 → battery 0x13 → firmware 0x27 → authenticate 0x3C (V0789 only) → history
```

- Battery and firmware are always asked first; history waits for the firmware reply.
- V0789: send the authentication write; on `3c 01` history may start. On any other reply throw
  `RingError('…', 'auth_rejected')`; the Kotlin then drops the pending history and live heart rate and sends nothing
  else. It tries again only when a later request asks for firmware again.
- V0525: history starts right after the firmware reply.
- Unknown firmware: the Kotlin still reads history (it needs no authentication) but decodes it opaquely, and never
  starts live heart rate or sport mode. See open question 3 about `historyBlocked`.
- `HandshakeOptions.credential` overrides the built-in passcode in tests only. No screen ever asks for it.
- On disconnect, authentication, measurement and sport state reset.

## 9. History sync

### 9.1 Pager (per stream)

- Write `[opcode, 0]` (mode 0). Arm the stall timer, 4 s.
- Each notification with the stream's opcode counts as one packet (not one record).
- A terminal packet ends the stream: byte 0 is the opcode and the last byte is `FF` (standalone `55 ff`, or
  appended after the last records). The decoder strips `[opcode, FF]` from the end; it also strips a lone trailing
  `FF` when the length is one more than a whole number of records.
- At 50 packets the page is full. If the page budget is used up, close the stream ("bounded at N pages"); otherwise
  write `[opcode, 2]` (mode 2, continue from the ring's own read position), reset the count, arm the stall timer.
- Any other packet re-arms the settle timer, 1.2 s. Settle or stall closes the stream and moves on. Neither is an
  error in the Kotlin.
- Packets of another opcode are decoded but do not count.
- After the last stream: progress `done`.

In contract terms: `begin(history)` returns `quietMs: 1200, stallMs: 4000`; `ingest` returns
`send: [historyContinue]` at 50 packets and `done` on a terminal or a bounded page; `timeout` closes the stream.

### 9.2 Order and budgets

Catalogue order: activity total `0x51` → activity detail `0x52` → heart rate `0x55` → workout heart rate `0x54` →
HRV `0x56` → sleep `0x53` → SpO2 `0x66` → temperature `0x62`.

| Kotlin entry point | Streams | Pages per stream |
|---|---|---|
| startup and refresh | whole catalogue | 1 |
| sleep now | sleep | 4 |
| vitals history | 0x55, 0x54, 0x56, 0x66, 0x62 | 1 |
| pager default (tests only) | any | 20 (the cap) |

Page budgets are clamped to 1..20.

### 9.3 V0525 link drop and one page per open

The V0525 ring ends an Android link after about 3 minutes. A 20-page pull spent most of that on activity detail and
dropped before SpO2 and temperature, so every open reads only the newest page (mode 0) of each stream. It is
idempotent, and history records get stable ids, so the same records read twice are one record. Whether V0789 drops
the link the same way is **unverified**.

### 9.4 Cursor

The Kotlin keeps no cursor. The ring keeps its own read position: mode 0 starts at the newest page (per the Kotlin
comment; the order of records inside a page is **unverified**), mode 2 continues on the same connection. Whether
that position survives a reconnect is **unverified**, so never send mode 2 as the first history command of a
connection.

The TS port's `SyncCursor` value per `BioStream` is an opaque string `j1|<op hex>.<round>.<newest epoch s>.<end|more>`
per opcode. The planner uses it only to order streams: never-read first, then least recently refreshed, catalogue
order for ties. After a dropped link, the next open starts with the streams it did not reach.

## 10. Live heart rate, spot reading, workouts

Spot heart rate (`spot.hr`):

1. If history is not ready, write `0x27` (and authenticate on V0789) first. Nothing is sent without it.
2. Write `09 01 00`.
3. Wait 500 ms, then write `28 02 01 1e 00` (30 s).
4. Collect for 32 s. A non-zero type-2 `0x28` value is the result. Otherwise the `0x09` byte-21 stream is judged:
   drop the first 5 s (the ring first echoes an old value), then take the stable tail (last 12 s, a majority of 60 %
   within 8 bpm of the median). `0x18` sport heart rate is never used for a spot reading.
5. On the way out: `28 02 00 1e 00` if step 3 ran, then `09 00 00` if step 2 ran. Cancel during the 500 ms wait sends
   only `09 00 00`.

Only the one settled value is stored; raw `0x09` samples are not.

Live heart rate on the Ring page (`liveHeartRate` with `measure`): `09 01 00`, 500 ms, `28 02 01 1e 00`, then every
`0x09` byte-21 value (30..220) is shown; after 30 s `28 02 00 1e 00` and `09 00 00`, and the window starts again while
someone watches. Stop (or a read, or a spot check) writes the same two stop commands. `09 01 00` alone gave no heart
rate in 198 s on the owner's V0789 (R5-01); that byte 21 carries heart rate only while `0x28` runs is inferred from
the spot flow above (**unverified**). Each new window may first echo the last value for a few seconds.

Workout heart rate (not used for the Ring page): sport mode `19 01 <mode> 00 02` for run (0) or walk (9), stop with state 4,
pause 2, resume 3. The ring pushes `0x18` with heart rate at byte 1. Other activity types send nothing. Sport mode has
tests but was never checked on a ring (**unverified**).

## 11. Link rules (Android, same for every family unless noted)

- Reconnect (`ReconnectBackoff.kt` = `ANDROID_RECONNECT`): 5, 15, 30, 60, 120, 300 s; GATT 133, 22 or 62 gets its
  first two attempts at 5 s; 257 waits for Bluetooth; after six attempts the client parks and waits for a scan.
  Reset on a good connection. Nothing specific to this family.
- Priority (`ConnectionPriorityPolicy.kt` = `DEFAULT_PRIORITY`): high while syncing, measuring or in a workout; balanced
  when idle; low power after 300 s idle. High is asked at connect and released when the sync ends.
- Connect timeout 30 s. No keepalive is sent to this ring; the watchdog asks the OS whether the GATT link is still
  up (every 15 s, every 60 s once the link has been stable for 2 minutes) and reconnects if not.
- MTU 512 asked before service discovery; discovery goes ahead after 3 s if the MTU reply never comes.

## 12. Mapping to `RingEvent`

| Kotlin event (source) | `RingEvent` |
|---|---|
| `Battery(percent)` (`0x13`) | `status battery` = percent |
| `FirmwareRevision(version)` (`0x27`) | `status firmware` = `V0525` / `V0789` / other |
| `AuthenticationResult(accepted)` (`0x3C`) | `status auth` = `accepted` / `rejected` (the TS port uses `status ack`) |
| `CommandAck` (`0x19`, `0x21`, `0x3E`) | `status ack` = `0x19` … |
| `Unknown(op)` | `status ack` = `unknown:0xNN` (never the payload) |
| `HeartRateSample`, `measurementResult` (`0x28` type 2) | `sample hr`, bpm, `origin: 'spot'`, `t = nowMs`; value 0 gives no sample |
| `HeartRateSample`, `measurementStream` (`0x09` byte 21) | `sample hr`, `origin: 'live'`, `t = nowMs`; feeds the spot window only, not stored |
| `HeartRateSample` (`0x18` byte 1) | `sample hr`, `origin: 'workout_stream'` |
| `SportTelemetry` | nothing (it only marks the packet as health data for Android's diagnostics) |
| `HistoryMeasurement HEART_RATE` (`0x55`, `0x54`, `0x56` byte 11) | `sample hr`, unit `bpm`, `origin: 'history'` |
| `HistoryMeasurement SPO2` (`0x66`) | `sample spo2`, unit `pct` |
| `HistoryMeasurement TEMPERATURE` (`0x62`) | `sample skin_temp`, unit `degC` |
| `HistoryMeasurement HRV` (`0x56`, known firmware) | `sample hrv`, unit `ms` (vendor-derived, not RMSSD from RR intervals) |
| `HistoryMeasurement STRESS` (`0x56` byte 12) | `vendor stress`, unit `vendor_units` (no stress stream) |
| `VendorMetric` | `vendor` with the same key and unit: `hrv_raw`, `vascular_age`, `blood_pressure_systolic_estimate`, `blood_pressure_diastolic_estimate`, `exercise_duration_raw`, `active_time_raw`, `step_goal`, `activity_detail_calories` |
| `ActivityUpdate` (`0x51`) | `dailyTotal`: `localDay` from the BCD date, `steps`, `distanceM`, `kcal`, `activeS` = whole active minutes × 60 (known firmware only). The TS port emits `vendor daily_*` values instead; `dailyTotal` is the contract's shape |
| `ActivityBucket` (`0x52`) | `activityBucket`, `durS: 60` (600 for the whole-record fallback), `steps`, `distanceM` |
| `SleepTimeline` (`0x53`) | `sleepEpochs`: `epochS: 60` for the 130-byte packet, `300` for 34-byte records (`records.ts` spreads to minutes), stages lower-case, `rawCodes` = the vendor codes, `firmware` = the revision. The Kotlin never marks a J-Style packet complete; the TS port's "count equals capacity" rule for `complete` is a proposal |
| `HistorySyncProgress(stage)` / `HistorySyncFinished` | `progress { stage, done: false }` / `progress { stage: 'done', done: true }` |
| (TS port) end of a stream | `status cursor` with `stream`, the new cursor string |

## 13. Open questions for the port author

1. The pager takes any packet ending in `FF` with the right opcode as the terminal. A full record whose last byte is
   `0xFF` (a heart-rate record with bpm 255, a sleep packet whose last code is 255, an activity total with `FF` at
   the end of the opaque field) would end the stream early, and the decoder would strip its last byte. Not seen;
   worth a guard (e.g. only `[opcode, FF]` exactly, or length = n × record + 2).
2. History heart rate, SpO2 and temperature have no plausibility gate. A `0x55` record with bpm 0 becomes a
   0 bpm sample in the Kotlin. Should the port drop 0 (and out-of-range values) like the live paths?
3. Unknown firmware: the Kotlin reads history with opaque decoding; the contract offers `historyBlocked` for this.
   Pick one. A future firmware that needs authentication would make every stream stall (8 × 4 s).
4. The Kotlin has no timeout for info or authentication replies; a lost `3c` reply leaves the sync "running" for the
   whole connection. The TS port uses 4 s (`REPLY_MS`).
5. Kotlin reads ring-local time with the zone's rules per record (daylight saving aware); the contract has one
   `tzOffsetS` per command. They differ across a daylight-saving change.
6. When does the ring send 26-byte activity totals, and when 34-byte sleep records? Both are coded, neither seen.
7. Does mode 0 always mean "newest page"? Does the ring's read position survive a reconnect? Do some streams end only
   by going quiet (the Kotlin comment says so; which ones is not recorded)?
8. The `0x28` stop and the `09 00 00` frames are sent from a `finally`; on a dropped link they fail silently. Fine,
   but the session should not wait for replies to them.

## 14. Fixture notes

- The Kotlin spot heart-rate test replays a real `0x09` sequence from a ring; it is left out of the fixtures. The
  spot session in `sessions.json` uses made-up values.
- The authentication vector uses `TESTKEY1` instead of the Kotlin test's own placeholder.
- One Kotlin test name and one scan vector carry the retail brand; the name is reworded and the vector left out.

## Port notes (L-RINGS, 2026-10-04)
- **Mid-page pauses (fixed after the real-ring runs).** The ring pauses for more than the 1.2 s settle inside a 50-packet
  page. Lumen's settle timer ended the read there and the rest of the page was lost without an error (3 of 6 desktop
  reads). `legacyProtocol.ts` now keeps waiting while a page is short of its 50 packets and has shown no end marker, up to
  `SILENCE_MAX_MS` (8 s) of silence in all; a read that still stops short ends with `status:error`
  `partial:<stream>:<n>/50`, its cursor keeps the old refresh round (so the stream is read first next time) and only the
  newest time seen moves. A full page with nothing after it, or a stream that ends without a marker, still ends on the
  settle as before. The session runner keeps the quiet timer alive while the protocol answers a timer with `done: false`.
  Test: `__tests__/pause.test.ts`.
- **Handshake order.** Firmware (0x27) first; on V0789 the 0x3C authentication next; then battery (0x13). A V0789 ring
  answers nothing before it is authenticated, so Lumen's battery-first order cost a 4 s stall per connect.
- **Passcode.** Built in (`passcode.ts`), sent on its own, never shown; a refusal is `RingError('auth_rejected')` and the
  service reports "this ring needs a one-time setup" at most. Whether the value is shared by every V0789 ring is open:
  see `jstyle2301-passcode.md`.
- **Day totals.** The 0x51 totals arrive as `vendor daily_*` values and are joined into one `dailyTotal` per day
  (`protocol.ts`), which `records.ts` writes into the day's daily record without summing it against the 0x52 buckets.
- **Identity.** Serial from the Device Information service when the ring exposes it; else the Bluetooth address
  (desktop, Android); else the advertised id (browser).
- **Unknown firmware** blocks history (`historyBlocked`), unlike Lumen, which read it without named meanings.
