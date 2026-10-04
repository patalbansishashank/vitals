# YCBT family (Yucheng protocol)

R19 research note for the `ycbt` family. It describes the protocol as Lumen's Android code speaks it, in the words of `packages/rings/src/types.ts`. The golden vectors are in `qa/fixtures/rings/ycbt/`.

One protocol, three kinds of ring:

| Variant | Lumen device type | How Lumen knows it | Seen on hardware |
|---|---|---|---|
| `r10m` | `YCBT` | name `R10M…`, or the `be940000` service in the advertisement | yes (one unit) |
| `tk5` | `TK5` | name starting `TK5`, or manufacturer data `10 78 65 01…` | yes |
| `smarthealth` | `COLMI_SMART_HEALTH` | name "model, space, 4 hex digits" (`R99 54DC`), or manufacturer data `10 78…` | yes (two units) |

"SmartHealth" is the vendor phone app these rings ship with. The Colmi rings that ship with the QRing app speak a different protocol and belong to the `colmi` family.

"Unverified" below means the Kotlin code says so, or no Kotlin test or capture backs the claim.

## Sources

- Kotlin (read only): `app/src/main/java/com/pulseloop/ring/YCBT{Coordinator,Coordinators,Decoder,Driver,Encoder,HealthRecords,HistoryTransfer,Protocol,SyncEngine}.kt`, `SubscriptionSetupGate.kt`, `RingDecodedEvent.kt`, `ConnectionPriorityPolicy.kt`, `ReconnectBackoff.kt`, and the YCBT parts of `RingBLEClient.kt`, `WearableDriver.kt`, `wearables/WearableModel.kt`, `service/RingSyncCoordinator.kt`.
- Kotlin tests: `YCBT{Decoder,Driver,Encoder,HealthRecords,HistoryTransfer,Protocol,SyncEngineGate,SyncEngine}Test.kt`, `SubscriptionSetupGateTest.kt`, `ConnectionPriorityPolicyTest.kt`, and the YCBT/TK5/SmartHealth cases in `AdvertisementMatcherTest.kt` and `PairingMatchingTest.kt`. `ExistingFamilyRefreshContractTest.kt` has no YCBT case.
- Licence: this Kotlin came from upstream PulseLoopAndroid, itself a port of the PulseLoop iOS Swift code (`YCBT*.swift`). Upstream has no licence file. The owner accepted this (plan 04, decision 3). Some Kotlin comments say a record layout was read off the vendor's phone app. This note describes behaviour only and copies no vendor code.

## GATT

| | UUID | Properties | Use |
|---|---|---|---|
| Service | `be940000-7333-be46-b7ae-689e71722bd5` | | the protocol service |
| Command | `be940001-7333-be46-b7ae-689e71722bd5` | write + indicate | every write; command replies |
| Stream | `be940003-7333-be46-b7ae-689e71722bd5` | indicate only | live pushes, history |

- Subscribe to **both** with **indications** (CCCD value `02 00`) before the ring counts as connected. The stream characteristic only offers indicate (the Kotlin comment says this was checked against the vendor SDK). Writing the notification value there means nothing ever arrives.
- Lumen writes with response when the characteristic allows it, otherwise without. It never sends on another characteristic (`usesCommandChannel` is always false).
- No standard battery service is read: battery comes in the `02 00` reply and the `06 15` push.
- Lumen never requests a bigger MTU on the R10M (see "Link rules"). So expect 20-byte notifications, with long frames split across several.

Suggested `GattMap`:

```ts
{ service: 'be940000-…', write: 'be940001-…',
  notify: [ { characteristic: 'be940001-…', mode: 'indicate' }, { characteristic: 'be940003-…', mode: 'indicate' } ] }
```

The order follows Lumen's `notifyUUIDs`. Which characteristic carries which reply is unverified: the Kotlin tests feed everything through the stream UUID, and the frame assembler keeps a separate buffer per characteristic.

### The subscription gate (`SubscriptionSetupGate`)

1. After service discovery, look at both required characteristics. If either is missing, has no CCCD, or local enable fails, the connect fails at once with "Required ring indication channel unavailable: BE940003" (the first block of each missing UUID, upper case). No partial setup is allowed.
2. Write each CCCD. A failed write on a required channel fails the connect.
3. The link is "connected" only once **every** required CCCD write has succeeded. Then the post-subscription handshake goes out ahead of anything already queued.

Families with no required list (the others) count as connected after the first successful subscription. In Vitals terms: `openRingSession` must fail with `transport` if `subscribe` rejects for either channel, and must not run the handshake before both resolve.

## Advertisement match

All three variants advertise without the protocol service, except the R10M, which may advertise `be940000`. The TK5 and the SmartHealth rings advertise Heart Rate (`0x180d`) and `0xfee7`. Company id `0x7810` is Yucheng's. In on-air layout (id little-endian first) that is `10 78`.

Lumen's rule, in registry order. Only the family-relevant steps are shown:

1. An advertisement with a QRing service (`6e40fff0-b5a3-f393-e0a9-e50e24dcca9e` or `de5bf728-d711-4e47-af26-65e3012a5dc7`) is never YCBT.
2. **r10m**: the trimmed, upper-cased name matches `^R10M(?:[ _-][0-9A-Z]+)?$` (catalog card: `^R10M[ _][0-9A-F]{4}$`), or the advertisement lists `be940000`. It claims no other name.
3. **smarthealth**: if a catalog card claims the name, that card must be the SmartHealth one, and the name must match `^[A-Za-z0-9-]+( [A-Za-z0-9-]+)* [0-9A-Fa-f]{4}$`. If no card claims the name, any manufacturer block starting `10 78` matches, unless the TK5 rule also matches.
4. **tk5**: the name starts with `TK5` (any case), or the catalog card `^TK5 [0-9A-Fa-f]{4}$` matches, or a manufacturer block starts `10 78 65 01`.

Every manufacturer block is tried, not just the first. The SmartHealth name pattern is the broadest in the catalog. It is tried last, so the underscore names of the QRing rings (`R02_A1B2`) never match it. In Lumen, the LuckRing family is checked before TK5, so the loose `TK5` prefix can never take a LuckRing (`F618` service, company `0xFF64`).

Cases from the Kotlin tests:

| Name | Services | Manufacturer block | Result |
|---|---|---|---|
| `R10M FCF4`, `R10M_FCF4` | | | r10m |
| `Unlabeled` | `be940000` | | r10m |
| `TK5 24AA`, `tk5 24aa`, `TK5_1234` | | | tk5 |
| (none) / `Unlabeled` | | `10 78 65 01 aa …` | tk5 |
| `R99 54DC` | | | smarthealth |
| a hyphenated shop name + ` E1C7` | `180d`, `fee7` | `10 78 d4 08 77 …` | smarthealth |
| `Unlabeled` | `180d`, `fee7` | `10 78 d4 08 77 …` | smarthealth |
| same, with the company id stripped (`d4 08 77 …`) | | | nothing |
| `R99 54DC` | QRing `6e40fff0…` | | not YCBT |
| `R02_A1B2`, `COLMI R10_9C3F`, `R09_9D07`, `R11C_BEEF` | | | not smarthealth |
| `TK5 1234`, `T50_1234`, `SR09_1234`, `R08 1234` | | | not r10m |
| `Unlabeled` | | `10 78` (r10m rule) | not r10m |

For Web Bluetooth, `requestFilters` can be: `{ services: [be940000] }`, `{ namePrefix: 'R10M' }`, `{ namePrefix: 'TK5' }`, `{ manufacturerData: [{ companyIdentifier: 0x7810 }] }`, with `optionalServices: [be940000]`. The SmartHealth name pattern cannot be a chooser filter. `0xfee7` alone is far too common to filter on.

### Three device types, or one family?

Lumen keeps three device types because they differ in everything **around** the protocol, not in the protocol itself. The Kotlin says outright that the bytes are identical, and all three build the same `YCBTDriver`. The differences:

| | r10m | tk5 | smarthealth |
|---|---|---|---|
| Recognised by | name, `be940000` service | name prefix, `10 78 65 01` | name pattern, `10 78` |
| `02 1b` chip scheme at startup | **never** (this ring drops the link with HCI 0x13 when asked) | yes | yes |
| Blood pressure monitor `01 1c` | never sent | sent if the bitmap claims BP | sent if the bitmap claims BP |
| HRV | gated by the bitmap | **always** (seen working on hardware) | gated (one unit denied it four ways) |
| SpO2 history `05 1a` | never asked | asked | asked |
| Find ring | gated by the bitmap | always | always |
| Fatigue | gated | gated | never (one unit rejected the query) |
| Link | default MTU, default priority, no battery read | normal Lumen policy | normal Lumen policy |

Vitals can treat them as **one family, `ycbt`, with model variants**. A variant record holds the scan rule, the baseline and bitmap-gated capability sets, `queryChipScheme`, `bpMonitor` and the link policy. `modelFromAdvertisement` picks it, and `models: ['R10M', 'TK5', 'SmartHealth ring']`. Two cautions:

- The variant must be known before the handshake. When it cannot be (a bare `be940000` connect, or a chooser that hides manufacturer data), use the R10M rules. They are the safe ones: never send `02 1b`, which is diagnostic only anyway.
- `RingFamily.priority` is per family. Use the R10M's conservative "default" for the whole family, unless the session can read the variant.

## Frame format

```
[group:1][cmd:1][len:u16 LE][payload:N][crc:u16 LE]      len = 4 + N + 2 (the whole frame)
```

- CRC16/CCITT-FALSE: polynomial `0x1021`, initial value `0xffff`, no reflection, no final xor. It covers every byte before the CRC, including the header and length. Check: the body `01 00 0e 00 ea 07 07 06 0c 22 0e 00` gives `0xc726`, sent as `26 c7`.
- An inbound frame is rejected when it is shorter than 6 bytes, when its declared length differs from its real length, or when the CRC does not match. The driver reports it as `Unknown` and goes on.
- Reassembly (`YCBTFrameAssembler`) keeps one buffer per characteristic. While the buffer holds 4 or more bytes: if the first byte is not a group `01..06`, or the declared length is outside `6..1024`, drop one byte and look again (this is how it gets back in sync after garbage). Wait until the whole declared length is in. One notification may complete zero, one or several frames. Clear the buffers on every connect and disconnect.
- Outbound frames are short (13 bytes at most) and go one per write. Lumen never splits them.
- **Refusal**: a reply whose payload is a single byte `fb` (unsupported command), `fc` (unsupported key), `fd` (length), `fe` (data) or `ff` (CRC) is the ring refusing a command. `fb` and `fc` are permanent.

Groups: `01` Setting, `02` Get, `03` AppControl, `04` DevControl (pushes from the ring), `05` Health (history), `06` Real (live stream).

## Commands (app to ring)

All times are local wall clock. Every frame below is in `encode.json`.

| Logical bytes | What | Notes |
|---|---|---|
| `01 00 YY YY MM DD hh mm ss wd` | set time | year u16 LE, month 1..12, weekday Mon=0 … Sun=6 |
| `01 03 h w s a` | user info | height cm, weight kg, sex (1 male, else 0), age years |
| `01 04 d w t f 00 00` | units | distance, weight, temperature: 0 metric, 1 imperial; time format 0 = 24 h, 1 = 12 h; then blood sugar 0, uric acid 0 |
| `01 0c e i` | heart rate monitor | enable 0/1, interval minutes |
| `01 1c e i` | blood pressure monitor | TK5 and SmartHealth only, and only with a BP bit; uses the HR enable and interval |
| `01 20 e i` | temperature monitor | |
| `01 26 e i` | SpO2 monitor | |
| `01 45 e i 00 00 00` | HRV monitor | |
| `01 12 c` | language | Lumen sends 0 |
| `02 00 47 43` | get device info | the two trailing bytes are fixed constants (ASCII "GC") |
| `02 01 47 46` | get SupportFunction bitmap | ("GF") |
| `02 03 47 50` | get device name | ("GP"); reply not decoded |
| `02 07 43 46` | get user config | ("CF"); reply not decoded |
| `02 1b` | get chip scheme | empty payload; never on the R10M |
| `03 09 01 00 02` | enable live status push | makes the ring send `06 00` (today's steps) |
| `03 2f e m` | start (e=1) / stop (e=0) a measurement | mode below |
| `03 00 01 05 02` | find ring | payload meaning unverified |
| `04 kk 00` | acknowledge a `04 kk` push | written for every `04` push except a refusal |
| `05 qq` | history request | `qq` = query key below |
| `05 80 ss` | history block acknowledgement | `00` accepted, `04` CRC/length failure |

The monitor interval is clamped to 30..255 minutes. A value of 0 or less means 60. Lumen's default is "every 5 minutes", which goes out as 30. A monitor command is sent only for sensors the ring has: HR, SpO2, temperature and HRV each need their capability, and BP also needs the variant's `bpMonitor`.

Measurement modes (shared by `03 2f`, `04 13` and `04 0e`): `00` heart rate, `01` blood pressure, `02` SpO2, `04` temperature, `05` blood sugar, `06` uric acid, `09` blood fat, `0a` HRV, `0c` stress.

Lumen never sends the Health delete opcodes (`05 40..4e`) or the retired Gets `02 24`, `02 26`, `02 28`, and a test guards against it.

## Replies and pushes (ring to app)

| Frame | Payload | Decoded as |
|---|---|---|
| `02 00` device info | `[2]` minor, `[3]` major, `[5]` battery % | firmware `"<major>.<minor, 2 digits>"` (`12 01` gives `1.18`), battery. Other bytes are unread: no serial, no model |
| `02 01` SupportFunction | bitmap, variable length | capabilities (table below) |
| `02 1b` chip scheme | `[0]` | 240 or more reads as 0; 3..5 is a JieLi chip. Diagnostic only |
| other `02 xx`, `03 xx`, `01 xx` | | plain acknowledgement (`01 00` is the time-set ack) |
| `03 2f` | `[status]` | `00` accepted, anything else refused (see "Spot flows") |
| `04 13` measurement status | `[mode][?][value][fraction]` | HR: value bpm. BP: value/fraction = sys/dia. SpO2: value if 70..100. Temp: `value.fraction` °C. Sugar: `(value*10+fraction)` tenths of mmol/L. HRV: not decoded (no captured layout). Byte 1 is unread (`01` or `00` in the tests). A zero value means no event |
| `04 0e` measurement result | `[mode][status]` | the ring ended a spot measurement: status 1 = success, 2 = failed, anything else = cancelled. Carries no value |
| `04 00`, `04 05`, `04 16`, `04 17` | | find phone, SOS, sedentary reminder, SOS call: acknowledged, ignored |
| `06 00` live status | steps u16, distance m u16, kcal u16 | **today's running totals**, stamped with the phone time |
| `06 01` live HR | `[bpm]` | |
| `06 02` live SpO2 | `[%]` | only 70..100 |
| `06 03` live vitals | sys, dia, HR, HRV, SpO2, temp integer, temp fraction | each field 0 = absent. BP needs both sides; SpO2 only 70..100 |
| `06 13` wearing | ring time u32, worn u8 | wear state. Lumen only shows it on its debug screen |
| `06 15` battery | `[?][%]` | percent is byte 1 |

`06 xx` frames are never acknowledged. Every `04 xx` frame is acknowledged with `04 xx 00`, unless its payload is a refusal byte.

**Scaling quirks**: temperature and the body-data HRV are **digit strings**, not fractions. `36` and `25` mean 36.25, `36` and `5` mean 36.5. Stress and fatigue concatenate their two bytes as digits (5 and 3 mean 53), which Kotlin marks UNVERIFIED. Blood sugar is assumed to be tenths of mmol/L times 18.016 to get mg/dL (also UNVERIFIED). In history records, a temperature fraction of 15 means "not measured".

### SupportFunction bitmap (`02 01`)

Bit `n` of byte `b` is `(payload[b] >> n) & 1`, with the least significant bit as 0. A bit is read only when the payload is at least the minimum length.

| Byte.bit | Min length | Capability |
|---|---|---|
| 0.7 | 14 | steps |
| 0.6 | 14 | sleep |
| 0.3 | 14 | heart rate |
| 0.0 | 14 | blood pressure |
| 1.3 | 14 | SpO2 |
| 1.1 | 14 | HRV |
| 6.4 | 14 | find ring |
| 8.0 | 14 | temperature |
| 15.1 / 15.2 / 15.3 | 18 | manual HR / manual BP / manual SpO2 |
| 17.3 | 18 | blood sugar |
| 22.6 | 23 | stress **and** fatigue (one bit) |
| 23.0 | 24 | manual HRV |

The bitmap can only **add** capabilities: what the session offers is `baseline ∪ (bitmap ∩ gated)` for the variant. Values of a kind the ring has not been granted are dropped in the driver. That covers BP, sugar, HRV, stress, fatigue and temperature samples, and the matching history values. History HR, SpO2, respiratory rate and VO2max always pass. On every reconnect the set falls back to the baseline until the next bitmap. In `RingEvent` terms, emit `status:capabilities` with the raw bitmap hex, so a corrected bit table can read it again later.

Baselines:
- r10m: HR, SpO2, steps, sleep (with REM), battery, manual HR, manual SpO2, live HR, live steps, monitor interval.
- tk5: the same, plus SpO2 history, HRV, manual HRV and find ring.
- smarthealth: the r10m baseline plus SpO2 history and find ring.

Gated:
- r10m: temperature, BP, manual BP, stress, fatigue, sugar, HRV, manual HRV, find ring.
- tk5: temperature, BP, manual BP, stress, fatigue, sugar.
- smarthealth: temperature, BP, manual BP, stress, sugar, HRV, manual HRV (no fatigue).

## Connect handshake

1. Both indications are on (the gate above).
2. **Post-subscription handshake**, written ahead of anything queued: `02 03 47 50` (device name), then `01 00 …` (set time to the phone's local time).
3. **Startup** (`runStartup`, first pass on the connection), queued as one batch:
   `02 00 47 43` → `02 01 47 46` → (`02 1b`, TK5/SmartHealth only) → `02 07 43 46` → `01 12 00` → `01 04 …` → monitors for baseline sensors (`01 0c`, `01 26`, plus `01 45` on TK5) → `01 03 …` (user info) → `03 09 01 00 02`. Then the first history request.
4. The `02 00` reply gives firmware and battery. The `02 01` reply widens the capabilities. For each newly granted sensor it sends that sensor's monitor command, and it appends the newly readable history types to the running transfer (plus `05 09` again if BP, HRV, temperature or sugar was added and `05 09` is not already queued).
5. When the startup history walk finishes, `03 09 01 00 02` goes out once more. Some R10M firmware does not push today's steps the first time.

A later `runStartup` on the same connection skips the configuration: it sends only `03 09 01 00 02` and the history walk. A call while a transfer is running does nothing. A new connection starts from scratch.

Lumen always sends a user profile. When the person has none, it sends 175 cm, 70 kg, 25 years, sex 0. `HandshakeOptions.profile` says "omitted = never sent". That is fine here: just leave `01 03` out when there is no profile (open question below).

`HandshakeInfo`: `firmware` from `02 00`, `battery` from `02 00`, no `serial`, `model` = variant name, `clockOffsetS: 0` (the clock is never read back). Ring identity therefore falls to `mac:` on Android and BlueZ, and `adv:` in Chromium.

## History sync (`YCBTHistoryTransfer`)

One type at a time, as whole-type transfers. There is no day or index selector: every pass reads everything the ring holds for that type.

| Type | Query | Data cmd | Record bytes | Read when |
|---|---|---|---|---|
| sport (activity) | `05 02` | `05 11` | 14 | steps |
| sleep | `05 04` | `05 13` | variable | sleep |
| heart rate | `05 06` | `05 15` | 6 | heart rate |
| blood pressure | `05 08` | `05 17` | 8 | BP |
| all (vitals) | `05 09` | `05 18` | 20 | always |
| SpO2 | `05 1a` | `05 22` | 6 | SpO2 history (TK5, SmartHealth) |
| temperature | `05 1e` | `05 26` | 7 | temperature |
| comprehensive | `05 2f` | `05 30` | 44 | blood sugar |
| body data | `05 33` | `05 34` | 28 | HRV or stress or fatigue |

The full walk order is the table order, filtered by capability. On a fresh R10M that is `02 04 06 09`. `refresh` sends `03 09 01 00 02` first, then the whole filtered catalog. "Vitals after a workout" reads `06 09`. "Sleep now" reads `04` alone.

Per type:

1. Write `05 qq`. Arm the watchdog.
2. **Header** `05 qq`, payload of 10 bytes or more: u16 record count, u16 packet count, 2 unknown bytes, u32 total bytes at offset 6. The total is only an estimate. It sizes the buffer cap at `min(total, 512 KiB)` (the default cap is 64 KiB); data that would overflow the cap is silently dropped. The header yields `progress` ("Syncing heart rate…").
   - A shorter payload (the tests use a single `00`) means **no data**: go to the next type, no acknowledgement.
   - A refusal byte goes to the next type. `fb`/`fc` also mark the type unsupported for the rest of the connection.
3. **Data** `05 <data cmd>`: append the payload to the buffer. Records may straddle frames. Re-arm the watchdog.
4. **Terminal** `05 80`, payload of 6 bytes or more: u16 packet count, u16 byte count, u16 CRC16 (the same CCITT-FALSE) of the reassembled data.
   - The packet counts (header and terminal) are **never** checked. The ring packs whole records per frame and sends more packets than its header said.
   - Byte count ≠ buffer length, or CRC mismatch: write `05 80 04`, then ask for the same type again **once**. A second failure moves to the next type.
   - Both match: write `05 80 00`, decode the buffer, next type.
   - A terminal that arrives before any data for the current request (a stale one) is ignored. A payload shorter than 6 bytes moves to the next type with no ack.
5. When the queue is empty: `HistorySyncFinished` (`progress { done: true }`).

Other rules: a new start is ignored while a transfer runs. An "append" adds types that are not current, not queued and not unsupported, and starts them if idle. Frames that arrive while idle, after a cancel, or a repeated terminal are ignored. Disconnect cancels everything.

**Timers** (map to `CommandPlan`/`Protocol.timeout`): the watchdog fires at `min(10 s after the last header or data frame, 30 s after the request)`. When it fires, the type is skipped **without** an acknowledgement and the next one is asked for. The 30 s cap restarts when a type is asked for again. The watchdog is not armed after completion or a cancel. Its final `HistorySyncFinished` comes out on its own, outside any ingest call. In Vitals: `stallMs: 10000` plus a per-command absolute cap of 30000; the stall outcome is "skip, no ack".

**Acknowledgement and erase**: `05 80 00` only tells the ring the block arrived intact. Lumen never sends the delete opcodes. Whether the ring forgets acknowledged data is **unverified**. Lumen assumes not, and dedupes downstream. A `SyncCursor` therefore cannot shorten the transfer. It can only hold "last record time per stream" so that old records are filtered out. The content-derived record ids make re-reads harmless anyway.

### Record layouts (`YCBTHealthRecords`)

Every record starts with a u32 LE ring time (see "Clock"). Records are cut at the stride, and a partial trailing record is dropped. "?" means unread.

- **sport** (14): `[0..3]` start, `[4..7]` end (unread by Lumen; start + 900 s in the test), `[8..9]` steps, `[10..11]` distance m, `[12..13]` probably kcal (unread). Dropped when steps and distance are both 0. Lumen emits a bucket at the start time.
- **heart** (6): `[4]` ?, `[5]` bpm. 0 is dropped.
- **blood pressure** (8): `[4]` ?, `[5]` systolic, `[6]` diastolic, `[7]` HR.
- **all** (20): `[4..6]` ? (a step-like field Lumen ignores on purpose: it lags behind and made the step count jump), `[7]` sys, `[8]` dia, `[9]` SpO2, `[10]` respiratory rate, `[11]` HRV, `[12]` ?, `[13]`/`[14]` temperature digits, `[15..16]` ?, `[17]` blood sugar in tenths of mmol/L, `[18..19]` ?. Each field 0 = absent. BP needs both sides.
- **SpO2** (6): `[4]` ?, `[5]` %.
- **temperature** (7): `[4]` ?, `[5]` integer, `[6]` fraction digits. 15 = filler.
- **comprehensive** (44): `[4]` ?, `[5]` sugar integer, `[6]` sugar tenth digit, giving `(int*10 + tenth)/10` mmol/L. The rest is unread.
- **body data** (28): `[4..5]` ?, `[6]`/`[7]` HRV digits (ms), `[8]`/`[9]` stress digits, `[10]`/`[11]` fatigue digits, `[16]` VO2max. The rest is unread.
- **sleep** (variable): a buffer holds one or more sessions.
  - Session header (20 bytes): `af fa`, u16 record length (header included), u32 start, u32 end, then 8 unread bytes (probably the vendor's totals).
  - Segments (8 bytes each): tag (low nibble: 1 deep, 2 light, 3 REM, 4 awake, 5 unknown or nap; anything else skips the segment; seen as `f1..f5`), u32 start, u24 length in seconds.
  - Segment count = `min((length−20)/8, what is really there)`. If the bytes at the cursor are not `af fa`, scan ahead to the next `af fa`.
  - Zero-length segments are dropped. Segments that share a start time are kept once.
  - If the header bounds are usable (start > 0, end > start, at most 24 h), the session covers exactly `round((end−start)/60)` minutes (1..1440), filled with **awake**. Each segment is then placed from `round((s−start)/60)` up to, but not including, `round((s+len−start)/60)`.
  - Otherwise the minutes are concatenated: `max(1, round(len/60))` per segment, capped at 1440 in total.
  - The session starts at the header start (or at the first segment's start). It is always complete.

## Live heart rate and spot measurements

- There is no separate "stream" command. Live HR is `03 2f 01 00` / `03 2f 00 00`, the same as a spot HR. During a workout, Lumen restarts it after every interruption. Values arrive as `04 13` (mode 00), `06 01` or `06 03`.
- **Spot**: write `03 2f 01 m`. Values arrive as `04 13`, `06 xx` and `06 03`. The ring itself ends the run with **`04 0e [m][status]`**. Lumen collects samples until that push and settles a value from what it collected; the vendor app re-reads history instead. It always writes the stop `03 2f 00 m` afterwards, and acknowledges the push with `04 0e 00`.
- The ceilings only apply when `04 0e` never comes. HR: **45 s** (the default is 30; on hardware the ring needed about 26 s to settle and ended at about 35 s). SpO2: **75 s** (the default is 60; five captures ended at about 63 s). BP and HRV: 40 s. For BP and HRV, a success `04 0e` does not end the leg early, because no value rides on it; a failure does.
- **Refusals**: every `03 2f` written goes on a FIFO list (a start records its mode, a stop records nothing), capped at 8 with the oldest dropped. Each `03 2f` reply takes the oldest entry. A non-zero status paired with a start is `MeasurementRejected(mode)`; anything else is a plain ack. A real `04 13` value for mode m proves that start worked and removes the first pending entry for m. The list is cleared on connect and disconnect.
- Suggested `RingFamily`: `liveHeartRate = { start: { op: 'liveMeasurement', params: { enable: true, mode: 0 } }, stop: { …enable: false… } }`; `spot = { hr: mode 0, spo2: mode 2, hrv: mode 0x0a }` (BP is mode 1, vendor). The spot command's `IngestResult.done` comes from `04 0e` or a refusal.

## Link rules

- **Link priority** (`ConnectionPriorityPolicy`): device type `YCBT` (the R10M) always gets `DEFAULT`. Lumen then makes no `requestConnectionPriority` call at all, no idle step-down, and no `requestMtu(512)`. The reason, from `RingBLEClient`: cheap BE94 controllers were seen dropping Android links after aggressive connection-parameter and MTU requests; the iOS path that works makes neither request; and the frame assembler already handles fragmentation. TK5 and SmartHealth rings get the normal policy (HIGH while busy, BALANCED when idle, LOW_POWER after 5 min idle). For Vitals: `priority: { active: 'default', idle: 'default', idleLowPowerMs: 300000, idleLong: 'default' }`, and never call `requestMtu` for this family.
- **Reconnect** (`ReconnectBackoff`): nothing family-specific. Use `ANDROID_RECONNECT` (5, 15, 30, 60, 120, 300 s; GATT 133/22/62 get two quick retries at 5 s; 257 waits for Bluetooth). Each reconnect clears the assembler, cancels the transfer and the pending measurement replies, and drops capabilities back to the baseline.
- Lumen skips the GATT battery read for the R10M.

## Clock

- The ring keeps **local wall-clock time with no zone**. A ring time is u32 LE seconds since 2000-01-01 00:00 local, so the epoch offset is 946684800.
- Writing: `01 00` with the phone's local date and time, right after subscribing. Lumen sends it again when the phone's zone or clock changes (`resyncTime`).
- Reading: `instant = local(ringSeconds + 946684800)` in the phone's zone, using the offset **at that record's date**, not today's. A winter record decodes with winter time even in summer. In the autumn overlap the earlier offset wins (01:30 means the first 01:30). Records written before a zone change decode in the new zone (accepted).
- Live frames (`06 xx`, `04 13`, `04 0e`) are stamped with the phone time when they arrive. The ring clock is never read back, so `clockOffsetS` is always 0.
- Vitals note: `RingCommand` carries one fixed `tzOffsetS`. That is wrong by an hour for records from the other side of a DST change. Give the protocol state the IANA zone instead (see open questions).

## Mapping to RingEvent

`t` and `start` are epoch ms after the clock rule above. The `origin` is `live` for `06 xx`, `spot` for `04 13` during a spot, and `history` for health records.

| Kotlin `RingDecodedEvent` | From | `RingEvent` |
|---|---|---|
| `HeartRateSample(bpm)` | `06 01`, `06 03`, `04 13` | `sample` `hr`, `bpm` |
| `Spo2Result(value)` | `06 02`, `06 03`, `04 13` | `sample` `spo2`, `%` |
| `HrvSample(value)` | `06 03` | `sample` `hrv`, `ms` (vendor-defined HRV; flag `hrv_vendor_defined`) |
| `TemperatureSample(celsius)` | `06 03`, `04 13` | `sample` `skin_temp`, `°C` |
| `BloodPressureSample(sys, dia)` | `06 03`, `04 13`, records `08`/`09` | two `vendor` events: `ycbt_bp_systolic`, `ycbt_bp_diastolic`, `mmHg` |
| `BloodSugarSample(mgdl)` | `04 13` | `vendor` `ycbt_glucose`, `mg/dL` (unverified scaling) |
| `ActivityUpdate(steps, m, kcal)` | `06 00` | `dailyTotal` for today: `steps`, `distanceM`, `kcal` |
| `ActivityBucket(steps, m)` | record `02` | `activityBucket` `start`, `durS` = end − start (bytes 4..7; Lumen drops it), `steps`, `distanceM` |
| `HistoryMeasurement` HEART_RATE / SPO2 / HRV / TEMPERATURE | records | `sample` `hr` / `spo2` / `hrv` / `skin_temp`, origin `history` |
| `HistoryMeasurement` RESPIRATORY_RATE | record `09` | `sample` `resp_rate`, `brpm` |
| `HistoryMeasurement` BLOOD_SUGAR | records `09`, `2f` | `vendor` `ycbt_glucose`, `mg/dL` |
| `HistoryMeasurement` STRESS / FATIGUE / VO2MAX | record `33` | `vendor` `ycbt_stress` / `ycbt_fatigue` (`score`), `ycbt_vo2max` (`ml/kg/min`) |
| `SleepTimeline(start, stages, complete)` | record `04` | `sleepEpochs`: `start`, `epochS: 60`, `stages` in lower case, `rawCodes` = segment tag per minute (0 for filler awake), `firmware`, `complete: true` |
| `Battery(percent)` | `02 00`, `06 15` | `status` `battery` |
| `Status(firmware)` | `02 00` | `status` `firmware` |
| `SupportFunctions(caps)` | `02 01` | `status` `capabilities` (raw bitmap hex) |
| `ChipScheme(value)` | `02 1b` | none (log only) |
| `WearingStatus(worn)` | `06 13` | none (Lumen only shows it on its debug screen); `vendor` `ycbt_worn` 0/1 if wanted |
| `MeasurementComplete(mode, success)` | `04 0e` | ends the spot command (`done: true`); `status` `error` when `success` is false |
| `MeasurementRejected(mode)` | `03 2f` | `status` `error` `measurement_rejected:<mode>`, `done: true` |
| `HistorySyncProgress(stage)` | header | `progress { stage: '<type>', done: false }` |
| `HistorySyncFinished` | end of walk | `progress { stage: 'history', done: true }` |
| `TimeSyncAck`, `CommandAck` | acks | `status` `ack` (or nothing) |
| `Unknown(raw)` | bad frame | `status` `error` `bad_frame` |

Streams: `hr`, `spo2`, `hrv`, `skin_temp`, `resp_rate`, `steps`, `distance`, `active_kcal` (from the day total), `sleep_stage`. Decoder tag: `ycbt/<variant>@1`.

## Unverified, and open questions for the port author

1. Which characteristic carries which reply (command vs stream). The tests use the stream for everything.
2. The ring's replies to `02 03` (name), `02 07` (user config) and the settings writes are not decoded and not in any test. Does `02 03` or `02 00` carry a serial or MAC that could give `serial:` identity?
3. Does `05 80 00` make the ring drop the acknowledged data? If it did, a re-read would come back empty; Lumen's tests only cover "no data".
4. Why does the R10M never get the blood pressure monitor `01 1c`? There is no comment.
5. Stress and fatigue digit concatenation, the blood sugar unit, and the HRV units are marked UNVERIFIED in Kotlin. So are the find-ring payload `01 05 02` and the `03 09` payload `01 00 02`.
6. The `04 13` HRV layout is unknown, and byte 1 of `04 13` is unread.
7. Sport bytes `[4..7]` (end time) and `[12..13]` (probably kcal) are read by nothing. Use them for `durS`/`kcal`?
8. `YCBTHistoryTransfer.start()` drops the `HistorySyncFinished` that `advance()` returns when every requested type is already unsupported. So a second sync on the same connection writes nothing and never says it is done. A Vitals port should report done.
9. The timezone: `RingCommand` stamps one `tzOffsetS`, while the Kotlin applies per-record DST rules. The protocol state needs the IANA zone.
10. Variant detection on Web Bluetooth: if the chooser hides manufacturer data, a TK5 or SmartHealth ring with an odd name looks like an R10M. Is "R10M rules for everyone" acceptable? The cost is losing the always-on HRV on TK5 until its bitmap claims it.
11. Should Vitals send a user profile at all (`01 03`) when the person has none? Lumen sends 175 cm / 70 kg / 25 y.

## Port notes

The `@vitals/rings` port lives in `src/ycbt/` (`commands.ts`, `decoder.ts`, `protocol.ts`, `family.ts`). Decisions on the open questions above, and every place it differs from the Kotlin:

- **One family, three variants** (question 10). `ycbtVariantOf` follows Lumen's registry order; `modelFromAdvertisement` gives `R10M`, `TK5` or `SmartHealth ring`. The handshake only sees the advertised name through the transport, so a ring whose name does not tell (Web Bluetooth hiding the manufacturer data) gets the R10M rules: no `02 1b`, no `01 1c`, the R10M baseline. A TK5 then loses its always-on HRV until its bitmap claims it. `priority` is the R10M's `default` for the whole family; no MTU request.
- **Handshake waits for `02 00` and `02 01`** (3 s each), unlike Lumen's fire-and-forget queue, so the firmware, battery and capabilities are known before the monitors and the sync plan. All other configuration writes are fire-and-forget, as in Lumen. The monitor batch therefore already covers the sensors the bitmap granted (Lumen sends those after the batch). A bitmap that arrives later still switches the new monitors on and, during a history read, appends the newly readable types to it (`YCBTHistoryTransfer.append`); while idle, the next sync reads them.
- **User profile** (question 11): `01 03` only when `HandshakeOptions.profile` is set; Lumen's 175 cm / 70 kg / 25 y default is never sent.
- **History** is one `history` command per type (catalog order, capability-filtered, minus the types the ring refused with `fb`/`fc` on this connection), so `readHistory(stream)` reads only the types that feed it. The first sync on a connection is the startup walk and ends with `03 09` once more; later syncs are Lumen's `refresh` (`03 09` first). A type granted mid-read is read right after the type in flight, not at the end of the walk.
- **History finished is always reported** (question 8): the last read of a walk emits `progress { stage: 'history', done: true }`; when nothing is left to read, an empty `history` command writes nothing and reports it at once. Lumen's `start()` dropped that event.
- **Timers**: 10 s with no frame after a request skips the type with `status:error stall:<stream>` (Lumen's watchdog, no acknowledgement). After the header the ring owes data, so quiet periods (5 s) only count up to 30 s of silence; then `status:error partial:<stream>`, no acknowledgement, no cursor, next type. Lumen's absolute 30 s cap per type while frames still flow is not kept: the protocol has no clock between frames, and cutting a flowing transfer would lose data.
- **Cursor**: `d:YYYY-MM-DD`, the local day of the last complete read, emitted for every stream a type feeds (`status:cursor` with `stream`). It cannot shorten a transfer (no day selector; question 3 stays open: Lumen never deletes and assumes the ring keeps acknowledged data).
- **Clock** (question 9): ring times are read in `params.tz` (an IANA zone) when a command carries one, with the offset at each record's date and the earlier offset in an autumn overlap, as `LocalDateTime.atZone`. The session stamps only `tzOffsetS`, so today the fixed offset applies; see the request to the lead.
- **Sport records** (question 7): bytes 4..7 (end) give `durS`; bytes 12..13 stay unread (kcal UNVERIFIED).
- **Spot runs** end on `04 0e` for their mode (`done: true`; a failure is `status:error measurement_failed:<mode>`), or on a refusal of their start (`measurement_rejected:<mode>`). For BP and HRV a success `04 0e` does not end the run (no value rides on it). Live heart rate is the HR measurement left running (`params.live`): a `04 0e` does not end it. Ceilings when `04 0e` never comes: `YCBT_SPOT_CEILING_MS` (HR 45 s, SpO2 75 s, HRV 40 s) for the service to pass as `spotCeilingMs`.
- **Capabilities** go out as `status:capabilities` with the claimed capability names comma-joined (`BLOOD_PRESSURE,TEMPERATURE`), Lumen's bit table names. The chip scheme maps to no event.
- **Replies on which characteristic** (question 1): the assembler keeps one buffer per characteristic, so either works. Which one the ring uses stays unverified.
- **Fixture replay**: the 47 sessions run through `openRingSession` over a ring that matches writes by content. Seven keep Lumen's set of writes but not its batch order (the reasons are in `DEVIATIONS` in `__tests__/sessions.test.ts`); "late HRV capability" leaves `05 33`/`05 09` to the next sync; "append preserves the active transfer" cannot be expressed through the session API (types are added to a running read only by a late bitmap).
