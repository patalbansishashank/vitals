# R16 · Lumen Health as the ring bridge

Research for plan 03 item 7 (MQTT ingest on the server). Date 2026-10-03.

Two repos are cited:

- **L** = the Lumen Health phone app checkout, read-only. Paths are relative to `app/src/main/java/com/pulseloop/` unless they start with `app/` or `docs/`.
- **V** = this repo.

I opened every file cited here. aedes facts come from the published `aedes@1.2.0` tarball (`npm pack`, unpacked under `.e6-tmp/aedes/`). Paho facts come from the `eclipse-paho/paho.mqtt.java` source at tag `v1.2.5`. I wrote no Kotlin and read no owner data.

Synthetic fixtures built from this research are in `qa/fixtures/lumen/` (§2.4).

---

## 1. Broadcast settings and client behaviour

### 1.1 What the phone asks for

The screen is **Settings → Live Data Broadcast**. It is `BroadcastSettingsScreen` at L `ui/screens/SettingsSubScreens.kt:2871` (title at :2917).

| Field on screen | Rule (validation) | Default | Source |
|---|---|---|---|
| Enable switch | Broadcasting is off by default. While it is off, events are not even queued. | off | `SettingsSubScreens.kt:2929`; `broadcasting/BroadcastSettingsStore.kt:155`; `service/EventPersistenceSubscriber.kt:127`; `docs/jstyle-2301-mqtt.md:107-110` |
| Broker URI | Must parse as a URI with scheme `ssl`, `tcp`, `wss` or `ws` and a non-blank host. User info in the URI is refused ("Put the username and password in their separate fields"). Error text: "Use ssl://host:port, tcp://host:port, wss://host/path, or ws://host/path." | empty | `SettingsSubScreens.kt:2935`; `BroadcastSettingsStore.kt:31-36,50` |
| Base topic | Must be non-empty, have no leading or trailing `/`, and contain no `#` or `+`. Trimmed of `/` on save. | `lumen-health/v1` | `SettingsSubScreens.kt:2951`; `BroadcastSettingsStore.kt:37-39,107,171` |
| MQTT client ID | Must be non-blank. | `lumen-health-<first 16 hex of installation id>` | `SettingsSubScreens.kt:2958`; `BroadcastSettingsStore.kt:40,158-159` |
| Username (optional) | Sent only if not blank. | empty | `SettingsSubScreens.kt:2965`; `broadcasting/MqttOutboxPublisher.kt:86` |
| Password (optional) | Masked field. Sent only if not empty. Stored in EncryptedSharedPreferences (AES-256). Redacted from `toString` and from error text. | empty | `SettingsSubScreens.kt:2972`; `BroadcastSettingsStore.kt:23-27,69-78`; `MqttOutboxPublisher.kt:87,294-302` |
| Keepalive (seconds) | 60–900 ("240 recommended"). | 240 | `SettingsSubScreens.kt:2980-2981`; `BroadcastSettingsStore.kt:41-43,48-49` |
| Buttons | "Save and publish pending" and "Send test event". The test event is a `health.sync.progress` with stage `manual MQTT test`. | — | `SettingsSubScreens.kt:2987-3006` |
| Delivery status card | Shows the pending count, the delivery receipts count and the session state. | — | `SettingsSubScreens.kt:3011-3020` |

These settings are **not** exposed. Each one is fixed in code.

| Setting | Value | Source |
|---|---|---|
| Protocol | MQTT 3.1.1, pinned (no fallback to 3.1) | `MqttOutboxPublisher.kt:77-80` |
| QoS | 1 for every event | `broadcasting/BroadcastEventMapper.kt:62` |
| Retain | Per event type (see §2): `insights/*` and `state/*` except `state/measurement` are retained | `BroadcastEventMapper.kt:63,143,213,227,240,249,258,267,276` |
| Clean session | `true` | `MqttOutboxPublisher.kt:81` |
| Automatic reconnect | Paho's, on | `MqttOutboxPublisher.kt:82` |
| Connect timeout | 12 s | `MqttOutboxPublisher.kt:83,100` |
| Max in flight | 10 | `MqttOutboxPublisher.kt:85,101` |
| Paho client persistence | `MemoryPersistence`. Room owns durability. | `MqttOutboxPublisher.kt:61,67` |
| TLS hostname verification | on | `MqttOutboxPublisher.kt:88` |
| Trusted CAs | **System CAs only.** There is no custom-CA or pinning field. The app's network security config trusts `src="system"` only, so user-installed CAs and self-signed certificates fail. A TLS failure is classed as permanent: the session stops until the settings are saved again. | L `app/src/main/res/xml/network_security_config.xml:24-27`; `MqttOutboxPublisher.kt:276-278` |
| Cleartext | Allowed app-wide, so `tcp://` and `ws://` work | `network_security_config.xml:24` |
| Library | `org.eclipse.paho:org.eclipse.paho.client.mqttv3:1.2.5` | L `app/build.gradle.kts:174` |

The **installation id** is a random UUID without dashes. It is generated once and stored in the same encrypted preferences (`BroadcastSettingsStore.kt:80-87`). It appears in every topic and in the CloudEvents `source`.

### 1.2 Connection life cycle, reconnect and backoff

- **When it connects.** The session opens only when the outbox has pending rows (`broadcasting/MqttSessionManager.kt:287-296`).
  - It stays open while the ring is connected.
  - Otherwise it closes after 5 idle minutes with an empty queue (`MqttSessionManager.kt:252-266,422-434,448`).
  - So the broker sees short, bursty sessions. It does not see a permanent connection.
- **Backoff for its own retries.** Starts at 10 s, doubles up to 5 min (cap reached after 5 failures), with ×0.8–1.2 jitter (`MqttSessionManager.kt:38-62`).
  - The backoff resets on success, on a network change and on a settings save (`MqttSessionManager.kt:192-195,212-216,241-243,351`).
- **Socket loss on an open client.** Paho's automatic reconnect handles this. When `connectComplete(reconnect=true)` fires, the outbox drains again (`MqttSessionManager.kt:190-198,302-310`).
- **Safety net.** A WorkManager job runs every 15 min with a network constraint and flushes whenever rows are pending (`broadcasting/BroadcastOutboxDispatcher.kt:75-92,96-110`).
- **Network callback.** It reacts to any network, including one without validated internet, "A local MQTT broker is useful without validated internet access" (`MqttSessionManager.kt:151-174`).
- **Permanent failures** stop retries until the settings are saved again (`MqttSessionManager.kt:369-387`; `MqttOutboxPublisher.kt:274-292`):
  - `SSLException` anywhere in the cause chain;
  - `MqttSecurityException`;
  - Paho reason codes for failed authentication or not authorised;
  - invalid protocol version or invalid client id.

  Everything else is transient and retried with backoff.

### 1.3 Delivery, ack semantics, replay, batching

- **Outbox write.** Each accepted health event is written to its data table and to `broadcast_outbox` in one Room transaction (`docs/jstyle-2301-mqtt.md:59-62`).
  - Enqueue uses `INSERT … IGNORE` on the stable event id. A replayed identical record is dropped *on the phone* while its outbox row still exists (L `data/dao/BroadcastOutboxDao.kt:12-14`).
- **Delivered means the PUBACK arrived.** A row is marked published only when Paho's publish token succeeds (`MqttOutboxPublisher.kt:109-120,148-167,204-208`). For QoS 1 that is the broker's PUBACK.
  - On success the row's `payloadJson` is cleared (`BroadcastOutboxDao.kt:31-36`). The outbox can never be used as a history export.
- **Failure handling.** A failed or timed-out publish marks the row failed. It stays pending and is resent on the next drain (`MqttOutboxPublisher.kt:209-222`; `BroadcastOutboxDao.kt:38-42`).
  - A PUBACK lost after the broker stored the message therefore causes a **resend with the same event id**. The server must deduplicate (§3.2).
- **Replay after reconnect.** There is no broker session state (clean session, memory persistence). Replay is "select pending rows ordered by `createdAt, eventId`" (`BroadcastOutboxDao.kt:16-20`).
- **Batching.** Pipelined windows of up to 10 publishes (the in-flight limit) (`MqttOutboxPublisher.kt:189-197,227-258`).
  - One drain is capped at 2,000 rows or 30 s, then the next drain is queued at once (`MqttOutboxPublisher.kt:175-176,188,224`; `MqttSessionManager.kt:349-352`).
  - Publishes are started in list order to keep per-topic order (`MqttOutboxPublisher.kt:235-237`; smoke test "preserves one topic order across one hundred inflight messages", L `app/src/test/java/com/pulseloop/broadcasting/MqttTransportSmokeTest.kt:77`).
- **Retention.** The DAO has `pruneOlderThan` (delivered *and* undelivered rows older than the cutoff; `BroadcastOutboxDao.kt:44-49`). A unit test covers a 30-day cutoff (`app/src/test/.../BroadcastRetentionTest.kt:10`).
  - `grep` found **no production caller** of `pruneOlderThan` in L `app/src/main`. Today pending rows are therefore kept until delivered. The server must not rely on either behaviour.
- **Max payload.** Lumen sets no limit. The largest event is a sleep timeline: one string per minute, about 6–9 kB for a night. The 3.1.1 limit (256 MB) is far away.
  - aedes 1.2.0 documents no packet-size limit (`docs/Aedes.md` options list). The server should cap PUBLISH size itself (for example 256 kB) in `authorizePublish`.

### 1.4 WebSocket through a reverse-proxy path

`wss://host/mqtt` works.

- Paho 1.2.5 `WebSocketHandshake.sendHandshakeRequest` sends `GET <raw path>[?query]`, defaulting to `/mqtt` when the URI has no path. It sends `Sec-WebSocket-Protocol: mqtt` and `Host: host:port` (the port is added whenever it is not 80) (paho `internal/websocket/WebSocketHandshake.java:91-112`).
- The app's validation accepts `wss://host/path` (`BroadcastSettingsStore.kt:34`).
- Consequences for the server:
  1. The proxy (Caddy) must pass the `Upgrade` request through on that path. Caddy's `reverse_proxy` does this by default (not tested here).
  2. The Node WebSocket server must accept subprotocol `mqtt`.
  3. Use an explicit `:443` in the URI so the Host header is predictable.
  4. The certificate must chain to a public CA (§1.1). Caddy's Let's Encrypt certificate or a Tailscale `*.ts.net` certificate both qualify. A private CA does not.
- I did not open Paho's default-port logic for `wss` without an explicit port. Writing `wss://host:443/mqtt` avoids depending on it.

---

## 2. Topics and payloads

### 2.1 Topic layout

The topic is `<baseTopic>/<installationId>/<topicSuffix>` (`MqttOutboxPublisher.kt:260-264`; `docs/jstyle-2301-mqtt.md:89-101`). With the defaults it is `lumen-health/v1/<32-hex>/metrics/hr`.

- The server subscribes to (or authorises) `<base>/<installationId>/#`.
- Raw BLE packets, Bluetooth addresses, ring names and credentials are never sent (`docs/jstyle-2301-mqtt.md:100-101`; `BroadcastEventMapper.kt:221,298-305`; the mapper test asserts that no address or name is present, `app/src/test/.../BroadcastEventMapperTest.kt:41-53`).

### 2.2 Envelope

The envelope is defined at `BroadcastEventMapper.kt:19-29,50-57` and serialised with `encodeDefaults = true` (:37). Every `data` object starts with the same three fields (:339-343).

| Field | Value |
|---|---|
| `specversion` | `"1.0"` |
| `id` | `"pl-" + first 40 hex chars of sha256(canonical)` (§3.2) |
| `type` | see the table below |
| `source` | `"urn:pulseloop:installation:<installationId>"` |
| `subject` | per type |
| `time` | observed instant, ISO-8601 UTC (`Instant.toString`) |
| `datacontenttype` | `"application/json"` |
| `data.schema_version` | `1` |
| `data.observed_at` | equals `time` |
| `data.received_at` | when the phone got it. This field is excluded from the id. |

### 2.3 Types, fields and Vitals handling

**Metric keys and units** come from `ring/RingDecodedEvent.kt:8-22`: `hr` bpm · `spo2` % · `stress` "" · `fatigue` "" · `hrv` ms · `temp` °C · `bp_sys` / `bp_dia` mmHg · `glucose` mg/dL · `resp_rate` breaths/min · `vo2max` mL/kg/min.

**Sleep stage names** are `light`, `deep`, `awake`, `unknown`, `rem` (`RingDecodedEvent.kt:27-28`, lowercased at `BroadcastEventMapper.kt:201`).

**HRV.** On the J-Style 2301 the `hrv` metric is the firmware-profile conversion of the raw byte. The raw byte is also sent as vendor metric `hrv_raw` (`ring/JStyle2301Decoder.kt:208-213`; `docs/jstyle-2301-mqtt.md:29-31`).

Importer pointers are V `src/biometrics/importers/lumenCloudEvents.ts` ("CE").

| `type` (topic suffix) | `data` fields (unit) | Example (Kotlin test or synthetic) | Vitals handling | Gap |
|---|---|---|---|---|
| `health.metric.observed` (`metrics/<key>`) | `metric`, `value` (unit per key), `unit`, `provenance` (`device_history`, `vendor_history`, `device_live`, `device_spot`, `device_estimate`), `quality:"unverified"`. Plus `spot` and `ring_will_log` for live HR and SpO2, or `replayed` for history. `BroadcastEventMapper.kt:78-111,145-148,308-328` | hr 72.0 bpm, `device_history`, `replayed:true` (`BroadcastEventMapperTest.kt:24-37`) | **Handled.** `hr`, `spo2`, `temp`→`skin_temp`, `hrv` (flagged vendor-defined), `resp_rate` become series (CE:47-50,160-164). `stress`, `fatigue`, `glucose` become `vendor:*` (CE:51,166). `vo2max` becomes a daily `vendor_estimate` (CE:165). | Provenance `device_estimate` falls into origin `history` (CE:46). Harmless. |
| `health.metric.observed` (`metrics/blood_pressure`) | `systolic`, `diastolic` (mmHg ints), `unit`, `provenance` `device_history_estimate`/`device_estimate`, `replayed`. There is no `metric` or `value` field. `BroadcastEventMapper.kt:149-162` | synthetic 118/76 | **Handled** as `vendor:bp_sys_estimate` / `bp_dia_estimate` (CE:154-158) | — |
| `health.vendor_metric.observed` (`vendor/<safe key>`) | `metric` (raw key, e.g. `"vascular age"`), `value`, `unit`, `provenance` `device_history_estimate`/`device_estimate`, `quality`, `replayed`. `BroadcastEventMapper.kt:112-126` | vascular age 39.0 years (`BroadcastEventMapperTest.kt:56-66`) | **Handled** as `vendor:<raw key>` (CE:169-173) | The key keeps its space (`vendor:vascular age`). The topic segment is `vascular_age`. Cosmetic. |
| `health.activity.bucket.observed` (`activity/buckets`) | `steps` (count), `distance_m` (m), `provenance:"device_history"`, `replayed:true`. The 1-min bucket start is `observed_at`. `BroadcastEventMapper.kt:179-191` | synthetic 84 steps | **Handled** as steps and distance `sum` series. The per-day total from buckets is dropped on purpose (CE:88-89,175-181). | Series record id (§3.1, gap G1) |
| `health.activity.updated` (`activity/daily`) | `steps`, `distance_m`, `calories_kcal` (basis `unspecified_by_device`), `calories_provenance`, `active_minutes` (int or null), `provenance:"device_reported"`. `BroadcastEventMapper.kt:163-178` | synthetic 6,400 steps | **Partial.** Steps and distance go to a daily record; the later `received_at` wins (CE:196-205,238-266). Kcal and active minutes go only into `quality.vendor_state` text (CE:202-203). | G4: `active_minutes` is not mapped to `active_min`. |
| `health.sleep.timeline.updated` (`sleep/timeline`) | `sample_interval_minutes:1`, `complete_session` (bool), `stages[]` (one name per minute from `observed_at`), `provenance:"device_classified"`, `replayed:true`. `BroadcastEventMapper.kt:192-205` | synthetic night, sent twice (provisional, then complete) | **Handled** in one file import: the record id comes from the event id, and one record is kept per session start (CE:182-195,113-127) | G2: across MQTT messages the same night becomes several records. |
| `health.insight.updated` (`insights/<key>`, retained) | `insight`, `value`, `unit`, `confidence`, `algorithm_version`, `inputs{}` (contributors `<id>_value` / `_score` / `_weight` / `_available`), `note` (string or null), `provenance:"locally_derived"`. `observed_at` = local midnight of the wake day (`service/LocalInsightEngine.kt:571`; `util/TimeUtil.kt:63-70`). Keys: `sleep_score`, `activity_score`, `recovery_score`, `workout_score`, `workout_load`, `vo2max_estimate` (`docs/jstyle-2301-mqtt.md:114-127`). `BroadcastEventMapper.kt:127-144`; `LocalInsightEngine.kt:837-846` | recovery_score 73.0, medium, `test-v1`, inputs `{sleep_score:81.0, hrv:47.0}` (`BroadcastEventMapperTest.kt:69-87`) | **Partial.** `sleep_score` → `vendor.sleep`; `recovery_score` → `vendor.recovery`; `vo2max_estimate` → derived vo2max (CE:207-226). The rest are ignored (CE:213). | Ignoring Lumen's own `activity_score`, `workout_score` and `workout_load` is right: they are Lumen's opinion, and Vitals computes its own load (§6). |
| `health.device.battery.updated` (`state/battery`, retained) | `percent` (int). `observed_at` = receive time. `BroadcastEventMapper.kt:206-214` | synthetic 64 | **Ignored** (CE:233-234) | G3: no battery on the Devices card. |
| `health.device.firmware.updated` (`state/firmware`, retained) | `version` (string). `BroadcastEventMapper.kt:260-268` | synthetic `V0789` | **Handled:** sets the decoder's firmware stamp (CE:228-232) | Only within one import; per-message ingest loses it (G5). |
| `health.device.connection.updated` (`state/connection`, retained) | `state` (lowercased enum), `device_type` (or null), `firmware` (or null). `BroadcastEventMapper.kt:215-228` | `BroadcastEventMapperTest.kt:41-53` | Ignored | Could feed "last seen" on Devices (G3). |
| `health.device.identified` (`state/device`, retained) | `device_type`, `model_id` (or null), `capabilities[]`. `BroadcastEventMapper.kt:229-241` | — | Ignored | G6: the importer hard-codes the device as `J-Style 2301` tier C (CE:39). |
| `health.device.forgotten` (`state/device`, retained) | `forgotten:true`. `BroadcastEventMapper.kt:242-250` | — | Ignored | Leave. |
| `health.device.wear_state.updated` (`state/wear`, retained) | `worn` (bool). `BroadcastEventMapper.kt:269-277` | synthetic | Ignored | Leave. |
| `health.sync.progress` (`state/sync`, retained) | `stage` (string). `BroadcastEventMapper.kt:251-259` | "manual MQTT test" (`SettingsSubScreens.kt:2994-2997`) | Ignored | The server can use it as a "connection test received" signal. |
| `health.measurement.completed` / `.rejected` (`state/measurement`, not retained) | `mode`, `success` / `mode`. `BroadcastEventMapper.kt:278-296` | — | Ignored | Leave. |

**Not sent over MQTT at all.** The mapper's `when` is an exhaustive expression over `PulseEvent` (`BroadcastEventMapper.kt:77-306`) and has no case for these:

- workouts (activity sessions, GPS, splits);
- meals and nutrition;
- manual edits and deletions;
- the resting-HR baseline;
- battery history;
- coach data.

Workouts and edits can only reach Vitals through an export (§4).

### 2.4 Fixtures

`qa/fixtures/lumen/make_stream.py` writes two files:

- `mqtt-stream.synthetic.jsonl`: one `{topic, qos, retain, payload}` per line. `payload` is the exact UTF-8 string a broker would receive.
- `cloudevents.synthetic.jsonl`: the envelopes only, which is the importer's input.

Together they hold 17 events covering every type Vitals reads, plus the state topics. One sleep night is sent twice (provisional, then complete).

Values come from the Kotlin tests where one exists; the rest are made up. The ids come from a Python re-implementation of the Kotlin rule and are **not verified against a Kotlin run**. E25 can use the file for the "real MQTT client into the broker" test.

---

## 3. Importer gaps and the id rule

### 3.1 Gaps

The importer was built for **one file holding many events**. The server will feed it **one message, or a small group, at a time**. Most gaps come from that difference.

| # | What goes wrong | Fix (one line) |
|---|---|---|
| G1 | Series record ids are `stream + origin + first sample time of the chunk` (V `src/biometrics/core/events.ts:151`). One message per sample gives one series record per HR sample (about 1,440 a day for HR and 1,440 for buckets). It also gives different ids from a file import of the same samples, so the history import and the live stream overlap as duplicates. `resolve.ts` ignores series (V `src/biometrics/core/resolve.ts:39`), so the effect is on charts, scores and storage, not on the daily view. | The server buffers metric and bucket events per stream and imports them in fixed windows (for example per UTC hour, flushed when the hour closes or after 10 min idle). Better still: the series record id uses the window start, not the first sample, with a `version` that grows as the window fills. |
| G2 | Sleep record id = event id (CE:189-192). The same night arrives as several events (provisional, then complete, then re-syncs with new stage lists), so per-message import creates several sleep records for one night. Collapsing by session start only happens inside one import (CE:113-127). `is_main` is set per batch (`events.ts:168-182`). Two "main" sleeps can exist for one wake date. `resolve.ts:119-125` then picks the longest, but `day.sleeps` lists all of them. | Sleep `record_id` = `recordId({source: channel, kind:'sleep', start: session start})`. `version` = `complete ? 2·10¹⁰ + received_s : received_s`, so a complete night supersedes provisional ones and later re-syncs supersede earlier ones. |
| G3 | `health.device.battery.updated` and `.connection.updated` are ignored (CE:233-234). The Devices card has a `battery` field (V `src/features/settings/devices/DevicesSection.tsx:36-37`, filled from `src.ble?.battery` at `src/commands/bio/exec.ts:368`), but only Bluetooth sync sets it (`exec.ts:915`), and the card does not render it (no other `battery` reference in `DevicesSection.tsx`). | The server ingest writes `percent` and `received_at` into the Lumen source's device state (the same place `exec.ts:915` writes). The Devices card shows "Battery 64 % · 12:35". |
| G4 | `active_minutes` goes only into `vendor_state` text (CE:202-203), although `active_min` is a resolved daily metric (`resolve.ts:15`). On V0525 the field is elapsed exercise minutes (`docs/jstyle-2301-mqtt.md:36-37`). | Map it to `active_min` with a `vendor_proprietary` quality flag. Keep the kcal in `vendor_state` (the device leaves its energy basis unspecified, `BroadcastEventMapper.kt:174`). |
| G5 | The firmware stamp lives in per-import state (CE:59,228-232). A per-message ingest forgets it, and `firmware.updated` is retained, so it only arrives on reconnect. | The server keeps the last firmware (and `device.identified`) per installation and passes it into every import context. |
| G6 | The device is hard-coded as `{ring, 'J-Style 2301', tier C}` (CE:39). Lumen also drives other ring families (`docs/jstyle-2301-mqtt.md:3-4`). | Take `device_type` / `model_id` from `health.device.identified`. Fall back to the current constant. |
| G7 | Local dates use `ctx.tz` (CE:147,249-250). On the server that would be the server's zone. | The ingest passes the person's time zone (from their profile), never the host's. |
| G8 | `health.vendor_metric.observed` keeps the raw key with spaces (`vendor:vascular age`, CE:171-172). | Normalise with the same rule as the topic segment (`[^a-z0-9_-]+`→`_`, `BroadcastEventMapper.kt:350-353`). |

No gaps found in the units: `temp` °C → `degC`, `resp_rate` breaths/min → `brpm`, bpm and % are unchanged (CE:47-50).

### 3.2 The id rule (idempotent replay)

The Kotlin rule is at `BroadcastEventMapper.kt:45-49`:

```
canonical = "<type>|<subject>|<observedAt Instant.toString()>|<data without received_at as kotlinx compact JSON>"
id        = "pl-" + sha256(canonical UTF-8) hex, first 40 chars
```

- `identityData` is a `JsonObject` built in insertion order. The order is `schema_version`, `observed_at`, then the type's values (`BroadcastEventMapper.kt:339-344`).
- Doubles print with a fraction (`72.0`; the test asserts `"72.0"` at `BroadcastEventMapperTest.kt:35`). Ints print without one. Non-ASCII stays raw (`°C`).
- **The rule cannot be reproduced byte for byte in JavaScript from parsed JSON.** `JSON.parse` turns `72.0` into `72`, and `JSON.stringify` writes `72`.
- Vitals does **not** try to. The importer never recomputes the id. It uses the envelope `id` as given, for sleep `native_id` and `record_id` (CE:143,189-191) and for daily `native_id` (CE:260). The file's header comment describes the rule correctly (CE:4-5). The test fixture builds ids as `pl-0001…` and does not hash (V `src/biometrics/importers/__tests__/lumenCloudEvents.test.ts:9`).

So the rule matches by design: Vitals treats `id` as opaque. Idempotency on the server should rest on two things:

1. **Delivery deduplication.** Use the envelope `id` as the dead-letter / write-ahead-log key. A resend after a lost PUBACK has the same `id`.
2. **Content-derived record ids** (dates, session starts, window starts). These make re-importing a replay or a history export a no-op whatever the event ids are.

If E25 must verify ids, hash the raw `data` text minus `received_at`, not re-serialised JSON. That is fragile. My recommendation is not to verify ids.

---

## 4. History export and the one-time import

What Lumen Health can export today:

| Export | Where in the UI | Format and contents | Vitals importer |
|---|---|---|---|
| **Export All Data** | Settings → Privacy & Data → Data Backup (`ui/screens/SettingsSubScreens.kt:2156-2196`) | One pretty JSON file `lumen-health-export-YYYY-MM-DD-HHmm.json`, shared through the Android share sheet (`data/DataArchiveService.kt:326-333`). `PulseArchive` format v1 (`data/DataArchive.kt:7-43`) holds: `measurements` (kindRaw, value, unit, timestamp ms, sourceRaw, confidenceRaw), `measurementDeletions`, `activityDaily`, `activityBuckets`, `batterySamples`, `activitySessions` (workouts with HR, SpO2, distance, RPE), GPS points, `sleepSessions` + `sleepStageBlocks`, `derivedUpdates`, meals and food products. It also holds **coach conversations and messages, raw BLE packets and wearable logs**, which are private. | **None.** There is no PulseArchive importer in V `src/biometrics/importers/`. |
| Health Connect write-export | Settings → Health Connect (`SettingsSubScreens.kt:3077-3181`). Lumen writes heart rate, SpO2, body temperature (finger), sleep sessions with stages, steps, distance, active kcal, workouts, resting HR and nutrition to Health Connect (L `health/exporters/*.kt`). HRV is deliberately not written (`docs/jstyle-2301-mqtt.md:53-55`). | Android's Health Connect "Export" zip holding `health_connect_export.db` | **`file:health_connect`** (V `src/biometrics/importers/healthConnect.ts:1-4`). It already treats `com.pulseloop` body temperature as skin temperature (`healthConnect.ts:43-44,70,270-272`). The SQLite engine is not in the production build, so the owner must convert the database to a JSON dump (`src/biometrics/importers/sqlite.ts:1-8`). |
| Diagnostics | Settings → Privacy & Data and the Debug screen (`SettingsSubScreens.kt:2279-2322`; `ui/screens/DebugScreen.kt:213-255`) | Logs as JSON, masked by default | None. Not for import. |
| CloudEvents JSONL | — | **Lumen has no such export.** The outbox clears payloads once delivered (`BroadcastOutboxDao.kt:31-36`) and queues nothing while broadcasting is off. | `file:lumen_cloudevents` (CE). It only reads a stream that something else recorded, for example the server's own write-ahead log. |

So the importer named in the scope (`lumen_cloudevents`) does **not** cover history. Two paths do.

### Path A: works today, no code

1. In Lumen Health: Settings → Health Connect → grant all and choose "export all" at the backfill prompt. Wait for the export to finish (the worker is debounced; `SettingsSubScreens.kt:3179-3181`).
2. In Android Settings → Health Connect → Export, save the zip.
3. On a computer, unzip it and run the `sqlite.ts:7-8` one-liner on `health_connect_export.db` to get `dump.json`.
4. In Vitals → Settings → Devices, import `dump.json` as a Health Connect export.

What path A loses:

- HRV;
- vendor metrics (stress, vascular age, BP estimates);
- Lumen's scores;
- SpO2 and temperature that Health Connect plausibility filters reject;
- sleep minutes the ring could not classify, which Health Connect cannot carry.

### Path B: recommended, small code

Add a Vitals importer for the PulseArchive JSON (`lumen_archive`). It reads only these tables:

- `measurements` minus `measurementDeletions`;
- `activityDaily` and `activityBuckets`;
- `sleepSessions` and `sleepStageBlocks`;
- `activitySessions` (workouts);
- the latest `batterySamples`.

It must ignore the coach, raw-packet, log and meal tables. Its record ids must be the same content-derived ids as the live ingest (G1, G2), so the overlap between history and the stream is a no-op.

Owner steps for path B:

1. In Lumen Health: Settings → Privacy & Data → Export All Data. Share the file to the computer.
2. In Vitals → Settings → Devices, import the file.
3. Then enable Live Data Broadcast with the server's address.

Because enabling broadcast does not queue earlier data (`docs/jstyle-2301-mqtt.md:108-110`), the order "export, then enable" leaves no hole. Any overlap is covered by the content-derived ids.

---

## 5. Broker for Node

| Option | Version and maintenance | TLS | WebSocket | Auth hook | Ack after our write |
|---|---|---|---|---|---|
| **aedes** | 1.2.0, `latest` tag, modified 2026-09-16. `2.0.0-beta.1` is on the `beta` tag. Requires Node ≥ 20 (`package.json:94-95`). | Through any `tls.createServer` stream (README feature list "SSL / TLS", `README.md:68`). Or terminate TLS at Caddy. | `ws` + `createWebSocketStream` → `aedes.handle(stream, req)` (`docs/Examples.md:71-90`) | `authenticate(client, username, password, cb)` (`docs/Aedes.md:320-332`). `authorizePublish(client, packet, cb)` can also rewrite the packet (`docs/Aedes.md:352-375`). | **PUBACK is written before `broker.publish`.** For QoS 1, `enqueuePublish` calls `write(client, PubAck)` and only then `broker.publish` (`lib/handlers/publish.js:92-97`), and the `published` hook runs inside `broker.publish` (`aedes.js:375`). So `published` and persistence adapters run **after** the ack. **But `authorizePublish` runs before `enqueuePublish`** (`publish.js:18-21,43`) and is asynchronous. Calling its callback only after our write succeeds delays the PUBACK until then. An error closes the connection without a PUBACK (`docs/Aedes.md:368`). |
| mosca | 2.8.3. Last publish 2025-02-13; the project points to aedes. | — | — | — | Do not use (not maintained). |
| `mqtt-connection` + own broker | 4.1.0, last modified 2022-06-20 | own | own | own | Full control, but we would write and own a broker: session handling, keepalive, retained messages. Not worth it for one publisher. |
| Mosquitto beside the server | System package. Not a Node library. | yes | yes | Password file or plugin | No hook into our write. The server would subscribe as a client: Mosquitto acks Lumen when *Mosquitto* has the message, and we read later. Durability then depends on Mosquitto's persistence plus a persistent session for our subscriber. That is a second process to run, back up and secure. |

### Recommendation: aedes 1.2.x embedded in the server

Do the work in the **`authorizePublish` hook**:

```js
aedes.authorizePublish = (client, packet, cb) => {
  // 1. client.user was set in authenticate(); topic must be <base>/<that person's installationId>/…
  // 2. packet.qos must be 1, payload size ≤ cap, payload must parse as a CloudEvent
  // 3. append to the person's write-ahead log (fsync), keyed by envelope id  ← the write
  // 4. cb(null) only after step 3 resolves → aedes then writes PUBACK
  //    any failure → cb(err) → connection closed, no PUBACK → Lumen resends later
  // 5. packet.retain = false (we do not need the broker to keep retained copies)
}
```

**The PUBACK goes out only after the write-ahead log append.**

- Import into the person store runs **after** that, from the log, asynchronously. Each processed id is marked done.
- At start, entries not marked done are replayed.
- Import failures go to a dead-letter file with the id and reason. They are never acknowledged twice, because the PUBACK already went out after the append.
- Do not do the full import inside `authorizePublish`: an importer bug would then block delivery for every event.

Concurrency notes:

- aedes dispatches all packets of one socket read concurrently (comment at `publish.js:62-67`), and Paho keeps up to 10 in flight. The append must be serialised per person: a simple promise chain.
- A resent message after a lost PUBACK is appended again with the same id. The importer ignores ids already marked done.

This also answers the "if aedes cannot delay PUBACK" question: it can, through `authorizePublish`. The write-ahead log plus replay at start is the design either way.

Not verified by running: I read the aedes code but did not run a test. E25 should add one: a hook that waits 2 s before `cb`, with a Paho- or mqtt.js-style client measuring the PUBACK delay.

---

## 6. What the owner would miss without Lumen Health's screens

**What Vitals shows today.**

- **Progress** shows score tiles for last night, 7 days and 28 days (V `src/features/living/progress/sections/SignalsSection.tsx:1-4`).
- **Score detail** shows the history chart, how the score is worked out, the device and "the vendor's opinion" (Lumen's `sleep_score` / `recovery_score`) (`src/features/living/progress/ScoreDetail.tsx:1-6`).
- The scores themselves are sleep, sleep index, resting HR, HRV, illness, overreaching, autonomic, night vitals, load, VO2max and readiness (`src/biometrics/core/scores/catalogue.ts`).
- **Devices** lists sources, last sync and an activity readout (`src/features/settings/devices/DevicesSection.tsx:36-37,264`).

**What it lacks.** No screen under `src/features` reads `bio.series`, sleep stages or the workouts list (grep: only `DevicesSection.tsx` uses `bio.*` views).

Lumen screens are under L `ui/`.

| Lumen element | Where in Lumen | Vitals today | Verdict |
|---|---|---|---|
| Today hero insight and coach card | `components/TodayTiles.kt:478,518`; `screens/TodayScreen.kt:585` | Today and the Coach | **Leave.** Vitals' own Today and Coach replace it. |
| Today sleep tile with stage bar | `TodayTiles.kt:268,331` | Sleep score tile (duration only) | **Small gap.** Last night's stage bar on the sleep score detail (part of item 1 below). |
| Today activity tile (steps, goal ring) | `TodayTiles.kt:166`; `TodayScreen.kt:320` | Devices activity readout only | **Small gap.** "Steps today / yesterday" line on the Devices card or Progress. |
| Today chart tiles (HR, SpO2, temperature, stress) and gauges | `TodayScreen.kt:369,496` | None (series are stored, not shown) | **Small gap.** Day charts for HR, SpO2 and skin temperature on the matching score details. |
| Blood-pressure tile | `TodayScreen.kt:527-552` | Stored as `vendor:bp_*_estimate`, not shown | **Leave.** A firmware estimate, not a measurement; showing it as blood pressure would mislead. |
| Sleep screen: night hypnogram, stage summary cards, day navigation | `screens/SleepScreen.kt:592,838,992` | No | **Small gap, highest value.** Night view with stages and minutes per stage, unknown minutes shown as unknown. |
| Sleep duration histogram, weekly and monthly range | `SleepScreen.kt:885,463` | Score history chart (`charts/living/ScoreHistory.tsx`) | Already covered by the sleep score history. **Leave.** |
| Sleep score contributors | `SleepScreen.kt:238`; `screens/ScoreDetailScreen.kt:79-127` | Vitals' own sleep score with "how it's worked out" | **Leave.** Lumen's score appears as the vendor's opinion. |
| Activity: daily summary, weekly goal ring, pill calendar | `screens/ActivityScreen.kt:293,417,494` | No | **Small gap.** Steps per day for 7/28 days (one bar chart) on Progress. Goals stay in the plan. |
| Workouts list and workout summary (splits, pace, GPS, HR) | `ActivityScreen.kt:356,593`; `screens/WorkoutSummaryScreen.kt:69-558` | Workouts are stored if imported; not over MQTT (§2.3) | **Small gap:** a workouts list (date, type, duration, avg HR) fed by the history import. **Leave** live GPS recording, splits and pace (that is phone sensor work, item 6 deferred). |
| Log past activity, record type picker | `screens/LogPastActivityScreen.kt`; `ActivityScreen.kt:538` | Training log in Vitals' Train area | **Leave.** Vitals logs training through its own commands. |
| Vitals list and vital detail (readings, zones, thresholds) | `screens/Screens.kt:71,538,900,1081` | Night vitals and resting HR scores | **Small gap.** Covered by the day charts item, with the latest reading and time. |
| Manual spot HR and SpO2 measurement | `Screens.kt:820`; `screens/MeasurementModal.kt` | No | **Leave.** It needs the phone's live link to the ring. Results that are taken still arrive as `device_spot` samples. |
| Device hero card (ring image, battery, connection) | `components/DeviceHeroCard.kt:43` | Devices card has a battery field but does not render it | **Small gap.** Battery and "last data received" on the Devices card (G3). |
| Pairing, device settings, measurement intervals | `screens/PairingScreen.kt`; settings | No | **Leave.** Lumen keeps owning the ring. |
| Nutrition, barcode scanner, meal analysis | `screens/NutritionScreen.kt`; `BarcodeScannerScreen.kt`; `MealAnalysisSheet.kt` | Vitals Food and Intake | **Leave.** Vitals is the food system. |
| Coach and coach usage | `screens/CoachScreen.kt`; `CoachUsageSheet.kt` | Vitals Coach | **Leave.** |
| Lumen's recovery, activity and workout scores, workout load | insights (§2.3) | Vitals readiness and load. Lumen recovery is shown as the vendor's opinion. | **Leave.** Vitals' own scores replace them. |
| Debug and raw packets | `screens/DebugScreen.kt` | No | **Leave.** Diagnostics stay on the phone. |

### Ranked small gaps for E29 (at most 8)

1. **Night view.** Last night's stages as a timeline with minutes per stage (deep, light, REM, awake, unknown) and bed and wake times, on the sleep score detail. Needs G2 fixed first.
2. **Battery and last data received** on the Devices card. Needs G3 in the ingest; the card already has the field.
3. **Heart-rate day chart** (minute samples, with resting HR marked) on the resting-HR score detail. Needs G1 windows.
4. **Steps per day** for 7 or 28 days, with today's running total, on Progress (from the daily `activity.updated` records).
5. **SpO2 and skin-temperature night charts** on the night-vitals score detail.
6. **Workouts list** (date, type, duration, avg and max HR, distance) on Progress, fed by the history import (path B). Live MQTT has no workouts.
7. **Active minutes** in the steps readout once G4 maps them.
8. **"Lumen's own score" line** with confidence and algorithm version is already on the score detail. Check only that `activity_score` stays ignored. No work unless a test is missing.

---

## 7. Open questions for the orchestrator

1. **History path.** Is a `lumen_archive` importer (path B, §4) in scope for E25 or E29? Without it, history comes only through the Health Connect route, which loses HRV, vendor metrics and unknown sleep minutes. That route also needs a SQLite→JSON step done on a computer.
2. **Broker exposure.** The phone trusts system CAs only (§1.1). Is the endpoint `wss://<public host>:443/mqtt` behind Caddy, or `ssl://` on the tailnet name with a Tailscale certificate? A private CA cannot work. This repeats the owner's open item in PLAN "Final scope".
3. **Credentials.** One username and password per person, with the server pinning that person to the first `installationId` it sees (rejecting other installation ids on that account)? Or the owner pastes an installation id into Vitals?
4. **Series windows (G1).** Changing the series `record_id` rule touches A4 and the canonical schema (SUITE_SPEC §4). Is that A4's decision, or should the ingest only micro-batch (simpler, no schema change)?
5. **Retained state topics.** Should the server drop the broker's retained copies (`packet.retain=false` in the hook)? Retained `insights/*` and `state/*` are then re-sent by Lumen only on change, so is it acceptable that a restarted server learns battery and firmware only at the next change or sync?
