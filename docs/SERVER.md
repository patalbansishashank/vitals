# Vitals Server

The Vitals Server is the `vitals-server` program in `packages/companion`. It runs on one always-on computer (for the
owner: a small ARM server) and serves the website and installed apps. It has two roles:

| Role | What it holds | Can it read health data? |
|---|---|---|
| `relay` | the sync relay and encrypted blobs (the old Companion `sync`) | no |
| `home` | the relay, plus one readable copy of each person's data, and device pairing | **yes**, for the people it hosts |

## What the server can read (plain words)

A `home` server keeps each person's sync key on its disk (`persons/<id>/owner.key`). Whoever holds that key can read and
change all of that person's data: logs, plans, lab values. The server needs it to work while your phone and
browser are off. Anyone with root on the server, or with a copy of its data folder or backups, can read it too. A
`relay` server only ever sees encrypted data. Pairing also hands the device the person's sync key; the 24 words remain the backup.

## Install on the server

The server and both CLI entrypoints require Node.js 26.10.0 or newer. This is a runtime API requirement, not only a TypeScript-stripping requirement.

The server is deployed from the repository on your own computer; the checkout is not needed on the host. The script
installs the server's own Node 26.10.0 under `~/vitals-server/node` (see "Operations": not Node 24.21). better-sqlite3 is a native module and is installed on the host itself (arm64).

```sh
pnpm --filter vitals-companion build     # packages/companion/dist/server: bin/, src/ (no tests), dist/person-worker.mjs, package.json
deploy/oci-arm.sh                        # DEPLOY_TARGET=ssh:<serverSsh from qa/local.config.json> by default (`ssh:vitals-server` without it); DEPLOY_TARGET=local:<dir> is a dry run
```

The build bundles the person program (`dist/person-worker.mjs`, with the app's npm dependencies inside it) and packs a
directory with only the runtime dependencies and npm 12 `allowScripts` for better-sqlite3. The script then, on the host
(it is safe to run twice):

| Step | What happens |
|---|---|
| copy | the packed directory goes to `~/vitals-server/releases/<version>-<sha>`; `npm install --omit=dev --legacy-peer-deps` runs inside it |
| first run only | stops `vitals-companion`, copies its relay data `~/.local/share/vitals-companion` to `~/.local/share/vitals-server/relay` (the old folder stays for rollback), runs `vitals-server init --role home --public-origin https://vitals.example.ts.net:8443 --port 4870` |
| switch | `~/vitals-server/current` points to the new release; the old target becomes `~/vitals-server/previous` |
| unit | writes `~/.config/systemd/user/vitals-server.service`, disables `vitals-companion`, restarts `vitals-server` |
| check | `GET http://127.0.0.1:4870/health` must answer role `home` and this version |

`tailscale serve` is not changed: it already forwards `:8443` to `127.0.0.1:4870`.

On the host, use the server through an alias:

```sh
alias vitals-server="node $HOME/vitals-server/current/bin/vitals-server.mjs"
vitals-server status          # file modes, persons, and /health of the running server
```

`server.json` (`~/.config/vitals-server/server.json`) never holds a secret. Data lives in `~/.local/share/vitals-server`
(0700; every file 0600). `init` options: `--origin <url>` adds an allowed browser origin (the live site is always
allowed), `--public-host <name>` accepts an extra host name (for example a Caddy name), `--port <n>` changes the local
port (default 4870).

The unit the script writes:

```ini
[Unit]
Description=Vitals Server
After=network-online.target

[Service]
ExecStart=node %h/vitals-server/current/bin/vitals-server.mjs serve
UMask=0077
Restart=on-failure

[Install]
WantedBy=default.target
```

If the host has no lingering user session, run `loginctl enable-linger $USER` once.

**Roll back.** `deploy/oci-arm-rollback.sh` goes back to the `previous` release. `ROLLBACK_TO=companion
deploy/oci-arm-rollback.sh` stops `vitals-server` and starts the old relay unit on its untouched data.

The server listens on `127.0.0.1:4870` only. `tailscale serve` gives it the `https://<host>.<tailnet>.ts.net:8443`
address with a publicly trusted certificate, reachable only inside the tailnet. A `home` server refuses to bind to a
public address unless `tls` is set in `server.json`.

## Persons

```sh
vitals-server persons add "Name" --tz Asia/Kolkata          # a new, empty sync group
vitals-server persons add "Name" --tz Asia/Kolkata --join   # joins an existing sync group: paste the sync phrase
vitals-server persons list
vitals-server persons remove <person>
```

The time zone decides "today" for that person on the server; the server's own zone is never used. With `--join` the
phrase is read from the terminal with echo off; it is never taken from the command line or an environment variable.

## Pairing a browser or the installed app

```sh
vitals-server pair code <person> --label "Phone"
```

This prints an 8-digit code, shown as two groups of 4 (10 minutes, one use, 5 wrong tries lock it) and the QR text
`vitals-server:1?u=<server address>&c=<code>&n=<label>`. In Vitals, Settings › Server, scan the QR or type the server
address and the code. A paired device can also make a code for another device. The device keeps a token; the server
keeps only its hash. Remove a device with `vitals-server devices revoke <person> <deviceId>` or from Settings › Server.

The browser asks once for permission to reach devices on your local network, because tailnet addresses count as local.

### Pairing turns sync on

On a `home` server, pairing a device also lets that device take the person's sync key over TLS, once, so it joins the
person's sync group without the 24 words. The device does this by itself after it is paired:

- The route is `POST /v1/sync/key`, called with the new device's token (an agent token gets 403).
- It works once per device and only within 10 minutes of pairing (the same window as the code). A second call gets 409
  `already_issued`; a late call gets 410 `window_closed`, and the device must be paired again.
- The answer is sent with `Cache-Control: no-store`. The key is in the response body only: never in a URL or a log line.
- The server log gets one line, `person <id> device <deviceId>: sync key handed over` (or `sync key refused: <reason>`),
  never the key.
- A `relay` server holds no key, so it answers 404 and the app keeps the old path: type or scan the 24 words.

The 24 words stay as the backup (Settings › Sync). A device that was revoked after it took the key still has the key,
exactly as with the 24 words; to lock it out, make a new key in Settings › Sync.

## Ring and phone data over HTTPS

The Vitals Android app connects to the ring, reads permitted phone data, and uploads to the person's `home` server. The website and desktop app read that store over `GET /v1/gauge/*`; agents can read it through `/mcp`. Historical data from the old ring app remains in the same store. Wire names such as `/v1/lumen/*`, the `lumen` token kind and `persons/<id>/lumen.db` stay for paired-device compatibility.

**Old ring app pairing.** The old ring app pairs with the person's ordinary one-time code (8 digits, 10 minutes, one use):

```sh
vitals-server pair-code [--person <id>]     # --person may be left out when the server has one person
```

or `POST /v1/pair/code` from a paired device. In the old ring app, type the server's `https://…:8443` address and the code.
The ring app calls `POST /v1/lumen/pair` `{ code, installationId, deviceName?, appVersion? }` and gets
`{ token, personId, deviceId, serverVersion, maxBatch: 500, maxBytes: 1048576 }`; a wrong code is 401 `invalid_code`,
an expired, used or locked one 410. The token is a device token of kind `lumen` (hash only, in
`persons/<id>/devices.json`): it works on `/v1/lumen/*` and nowhere else (403 `wrong_kind`). It is listed and revoked
like any device (`GET /v1/devices`, Settings › Server, `vitals-server devices revoke`); pairing the same installation
again retires its old token, and ring app's Unpair calls `POST /v1/lumen/unpair` (204, the token is revoked).

**The ring engine inside the Vitals app (r070, schema version 6).** The old ring app is being retired: its engine
(ring, phone steps, Health Connect, short videos, uploader) now runs inside the Vitals Android app, which pairs without a
code through `POST /v1/lumen/pair-device`:

- *Auth.* The Vitals device's own bearer (a `device` token with `full` scope: the credential the app already uses for the
  server). A `lumen` or `agent` token is 403 `wrong_kind`; no token 401; at most 10 calls a minute per device (429).
- *Body.* `{ installationId, deviceName?, appVersion? }`, the engine's own installation id (8–64 letters, digits, dashes), a
  short device name (the engine sends `Vitals · <maker model>`) and its version. Anything else is 400 `bad_request`.
- *Answer.* The same as `/v1/lumen/pair`: `{ token, personId, deviceId, serverVersion, maxBatch, maxBytes }`. The token is of
  kind `lumen`, bound to that installation: it uploads, polls commands and unpairs exactly like a paired ring app's.
- *Idempotent per installation.* Calling again with the same `installationId` answers the same lumen device (`deviceId`)
  with a new token; the previous token stops working (401). The engine pairs again after a 401 or when the server address
  changes. An installation id that belongs to the old ring app is 409 `installation_is_gauge` (its token is never
  rotated from here).
- *Recorded honestly.* The device record and the installation carry `app: 'vitals'` (the standalone app: `gauge`):
  `GET /v1/devices` lists `app` on a lumen device, `gauge_data_availability`, every tool's `installations` and
  `gauge_device_state` list `app`, `status` and `supersededBy` for each installation.

*Superseded.* While an embedded installation is paired (and has not unpaired, `POST /v1/lumen/unpair` or removing the device),
every standalone ring app installation of the person reads `status: 'superseded'`, `supersededBy: <embedded installation id>`.
Nothing is deleted or hidden: its history stays, and a late backlog from it is still accepted. An unpaired installation reads
`status: 'unpaired'`. *Commands.* `POST /v1/gauge/commands` without an `installationId`, and `GET /v1/gauge/commands/state`
(which now also says `app`), go to the embedded installation once one exists, to the standalone ring app before that; naming an
`installationId` still reaches either. The embedded engine is a normal command target (`ring.sync`, `hr.measure`,
`workout.*`); it does not list `update.check` among its capabilities (its updates come through Vitals).

*One record, however many installations send it.* The new installation starts with an empty local database and re-syncs the
ring's stored history and Health Connect under its own id, overlapping what the standalone app uploaded. Event ids are the
content's (`pl-` + SHA-256 of type, subject, observed time and data without `received_at`), so an identical record is a
duplicate whichever installation sends it. Records that differ in content but are the same record stay one: `event_state`
keeps the newest version across installations for a *shared scope* (`current`): a ring's readings with a `device_key`
(`metrics/*`, `vendor/*`, `activity/buckets`, `activity/daily`, `sleep/timeline`: `ring:<device_key>`, one ring = one source),
the phone's step counter records (`activity/phone_steps`: `phone`, a boot and counter timestamp name the record) and Health
Connect (`hc/record`, `hc/deleted`: the record id, the latest revision wins and a tombstone from either installation
retracts it). A ring row without a `device_key` (older uploads) stays its installation's. Step fusion keys the phone's and
Health Connect's records by the record, not the installation, and its per-lineage disjoint track means two phone spans
over the same minutes are never both counted. Short-video days were already one row per date, newest `received_at` wins.
A deletion still hides only its own installation's rows, and an event any installation delivers again after it (the engine
re-sending what the old app stored) shows again. Schema 6 rebuilds `event_state` once on first open (seconds); an older
server refuses the file afterwards, so go back with a backup.

**Uploads.** `POST /v1/lumen/events` with the token, `{ installationId, events: [CloudEvent…] }`, gzipped
(`Content-Encoding: gzip`) or not. The events are ring app's MQTT envelopes plus `category` (the topic suffix:
`metrics/<kind>`, `vendor/<key>`, `activity/daily`, `activity/buckets`, `sleep/timeline`, `insights/<key>`,
`state/<x>`, `habits/short_video`, `activity/session`, `deletion`). At most 500 events and 1 MiB after decompression (413), 120 uploads a minute per token (429
with `Retry-After`). The answer is `{ accepted, duplicates, rejected: [{ id, index, reason }] }`: a re-sent id is a
duplicate, a malformed event is rejected on its own. `GET /v1/lumen/status` answers
`{ personId, lastEventAt, lastObservedAt, counts, deletions, serverVersion }`. Every `/v1/lumen/*` answer is direct,
never a redirect. The server logs counts only, never a payload.

**Store.** `persons/<id>/lumen.db` (SQLite, WAL, 0600), opened on first use in the main process (not the person's
worker) and closed after 10 minutes idle. It is never part of the Evolu replica or any Vitals collection. The raw
`events` table keeps every version; for one `(category, subject, observed_at)` the derived views show the newest by
`data.received_at`, then upload order. ring app's short-video habit (`habits/short_video`, type
`com.pulseloop.habits.short_video.v1`) is one event per local date: subject and `data.date` are `YYYY-MM-DD`, with
`counts` per app (`instagram`, `youtube`), `limit`, `limit_hits` and `cancels` (non-negative whole numbers; anything else
is rejected as `bad_short_video`). Its counts grow through the day, so its view keeps one row per date, the newest
version by `data.received_at` then upload order, whatever its `observed_at`. ring app's recorded workouts
(`activity/session`, type `com.pulseloop.activity.session.v1`, subject = the session id) keep one row per session the
same way; when the newest version is deleted the session is gone (an older version never comes back). Their data is
`{ start, end, type, source, durationS, distanceM?, kcal?, avgHr?, maxHr?, zones?, steps?, route? }`: `start` ≤ `end`
(at most 7 days), `durationS` the moving time (up to the span), `avgHr` / `maxHr` 20–260 bpm, `zones` seconds per
heart-rate zone (`{ cardio: 1500, … }`), `route` `{ polyline, points }` (an encoded polyline, at most 256 KiB); anything
else is rejected as `bad_workout`. A deletion (`com.pulseloop.deletion.v1`, target `{ category, kind?, from, to }`
or `{ category: "*" }` for Reset App Data; a group such as `habits` covers `habits/short_video`) hides, from every view and tool, the matching events of its installation that
The ring app had received before the deletion. Data received after it (the ring handing old history back after a reset) shows
again. Backups (`vitals-server backup`) copy `lumen.db` with the rest of the person's folder.

**Reads stay cheap (schema version 4, 0.6.3).** Which events are deleted and which version of each reading is current
is kept in `event_state` (one row per event, keyed by its rowid), updated in the same transaction as every upload,
deletion, re-delivery and `gauge dedupe`; the views look it up instead of recomputing it per read (on 2026-10-28 that
per-read work over 179k events and 16k point deletions held the server's event loop for minutes). The first start of
0.6.3 migrates a version-3 file in one set-based pass (about 3 s for 179k events on the PC; the server opens every
`lumen.db` 2 s after it starts, so no request waits on it) and drops any `hotfix_*` table or trigger left from the
emergency fix. Every ring app read is bounded by its window through indexes; one tool call may read at most 300,000 rows
(else `invalid_input`: ask for a shorter range), and a call slower than 250 ms is logged with its route and duration.
(r063 FX2) The budget counts every synchronous read of the call, not only the paged helpers: declared HR cadences (the
current readings only), the ring's daily totals, sleep packets and their expanded minutes, a day's metric rows, and the
sync coverage reports, which are read only from the asked days on (a report is observed on or after the days it covers).
`deploy/oci-arm-rollback.sh` to a release before 0.6.3 sets each `lumen.db` back to version 2 first (the older release
recreates its own views; nothing in `events` changes). (0.6.7) To a release with version 4 but not 5 (0.6.3 to 0.6.6)
it only marks a version-5 file as 4: the detection tables stay and the next deploy finds its episodes again.

**Clock copies.** ring app 2.7.3 shifted re-pulled ring history back by the ring's clock offset (383.118 s) and stored it
again under new ids, beside the copies older versions had uploaded at the raw stamps, plus sub-second copies from later
connections. 2.7.4 uploads exact deletions for its measurements but keeps no sleep packets, so
`vitals-server gauge dedupe <person> [--dry-run] [--category <c>]… [--offset-ms <n>] [--undo]` cleans the server's
copies (default `sleep/timeline`; also `activity/buckets`, `metrics`, `metrics/<kind>`). Copies have the same payload
apart from `observed_at` / `received_at`: a **clock twin** is `offset` away (under 1 s either way; the later-received,
corrected copy stays, as in 2.7.4); a **near copy** is under 1 s away (the one on the corrected grid stays, else the one
received last). The offset is not uploaded: it is the most common gap between identical sleep packets (at least 3), or
`--offset-ms`. Each copy is hidden by an exact-instant row in `deletions` (`srv-dedupe-<event id>`, nothing is removed
from `events`); `--undo` drops those rows. It prints counts per category and day and each night's minutes before and
after; `--dry-run` rolls the transaction back. Stop the server while it writes.

**Agent tools.** Every agent token (scope `read` or higher) also gets these read-only tools on `/mcp`. Their
descriptions say the data is ring and wearable data (formerly Lumen Health), separate from Vitals' manual logs; no
`lumen_*` names remain. Times are in the
person's zone; each result carries units, `installations` and `freshness`:

| Tool | Answers |
|---|---|
| `gauge_data_availability` | categories with counts, first/last reading and the tool that reads each, metric kinds, short-video days, installations, deletions |
| `gauge_metric_series(kind, from, to, bucket?, cursor?, limit?)` | readings of one metric, oldest first in pages (`raw`: each with `id`, `quality` and `source`; `next` → `cursor`, never a silent cut) or hour/day mean/min/max over every reading |
| `gauge_daily_summary(date)` | the day's activity (with the fused headline and the ring's `ringStepGoal`), the night that ends that morning (with its metrics), older on-device scores, per-metric stats with `medianGapS`, and `derived` (`day-metrics/1`): `peakHr` (highest held reading, spikes dropped; a lower bound), `nonExerciseHr` (sampled, never a resting HR), `avgWorkoutHr` |
| `gauge_sleep(from, to)` | sessions by day of waking (from 19:00 counts toward the next day), stage minutes and blocks; packets go on one minute grid, `unknown` is only what the ring marked unknown and `noDataMinutes` (blocks `no_data`) the gaps between packets. Each session is `primary` (the day's most known-asleep minutes) or a `nap` and carries `metrics` (`sleep-metrics/1`, below). (r071) A night the ring recorded in parts is one `primary` session: the parts of a night, with a wake break of an hour to 3 h between them inside 21:00 to 12:00 (local), join; the asleep minutes add up, the break stays a `no_data` block and is listed in `awakeBreaks` (`start`, `end`, `minutes`), and a daytime nap, an evening doze or sleep more than 3 h away stays its own session. `recordedWindowMinutes` replaces `inBedMinutes` (kept one release); `efficiencyPercent` is legacy and never shown |
| `gauge_activity(from, to)` | daily steps (the day's latest total, not the max), distance, calories (ring app estimate, method stated), active minutes, the ring's bucket sums (minute detail first, legacy buckets where none covers them) and `fusedHeadline` / `fusedLocated` (`steps-fuse/1`); hourly step buckets for ranges up to 7 days |
| `gauge_scores(from, to, key?)` | older on-device scores and insights with unit, confidence, algorithm version, inputs; every entry `legacy: true` |
| `gauge_device_state()` | latest battery, connection, device, firmware, wear, sync and measurement state per installation |
| `gauge_short_video(from, to)` | the phone's count of Reels/Shorts watched per day (counts only, never content): per-app counts, total, limit, limit hits, cancels; 7- and 30-day means of the days with data ending at `to` |
| `gauge_workouts(from, to)` | recorded workouts that overlap the range, newest version of each: start, end, pauses, type, source, moving time, distance, kcal with `kcalMethod` / `energyBasis` ("ring app estimate (method …)"), average/max heart rate, ring app's legacy zone seconds, steps, route polyline; totals count overlapping sessions once |
| `gauge_steps(from, to)` | fused steps (`steps-fuse/1`, at most 62 days): intervals with source, lineage, support, `selectionReason`, alternatives and `disagreement`; per day `located`, `ringDailyTotal`, `ringResidual` (unlocated), `phoneDailyTotal`, `headline` (`atLeast` until the ring's detail is complete) and coverage minutes |
| `gauge_timeline(date)` | the local day minute by minute (1440; 1380/1500 on a DST change), null where unknown: fused steps (with the person's fusion context) and each minute's `steps.support` (`minute` where `selected` holds a minute unit's count, `coarse` across a coarse unit, null where nothing was selected), per-source steps, heart rate (time-weighted with a declared cadence, else the minute's sampled mean; `hr.source` names each minute's source: ring app first, Health Connect HeartRate only in minutes ring app has no reading of), Health Connect speed and power (`hc`, null without any), `evidence` (which sources each stream used: lineage, minutes, cadence, records, `verified: false` for power), sleep stages, workouts, Health Connect exercise, acquisition, the day's stress readings. With no store yet it answers the same full shape, every minute null |
| `gauge_hr_intervals(from, to, cursor?, limit?)` | raw heart-rate readings of a window of at most 36 hours, oldest first in pages (default 2000, at most 5000; `next` → `cursor`): each reading's `t`, `bpm`, `cadenceS` (declared, else null), `nextT` (the next reading) and its `hr-support/1` interval `start`..`end` (null without a declared cadence). Times are UTC epoch ms. `count` and `supportedS` cover the whole window; every page carries the same `inputsHash` while the data stands |
| `gauge_baselines(date)` | baselines from the 28 nights before the waking date: usual onset / wake / midpoint (circular means, R̄, n), sleeping low HR (14 nights, s), HRV (ln scale), skin temperature and ΔT, `learning` (night n of 7), sampled non-exercise HR |
| `gauge_changes(since?, limit?)` | the change feed of what Vitals imports (ring app workouts, Health Connect exercise sessions and weights) after a cursor: each touched record's state now (`revised` with start, end and revision time, or `deleted` with when), the next `cursor`, `more`, and `resync` (no cursor yet, or a restored store: check the imported records with `gauge_changes_state`). See "Change feed" below |
| `gauge_changes_state(refs)` | (0.6.3 FX1) the state now of up to 100 imported records named `kind:id` (comma-separated): `present`, `deleted` or `unknown` (never a deletion) |
| `gauge_detections(since?, from?, to?, limit?)` | (0.6.7) the activities the server detected automatically (`detect/2`), in change order after a cursor: `episodes`, `withdrawn` ids, `cursor`, `more`, `resync`, `processedThrough`. Suggestions only. See "Automatic detection" below |
| `gauge_hc(type, from, to, cursor?, limit?)` | Health Connect records of one type (latest revision minus deletions) with origin, device and lineage; ring app's own exports never arrive. (0.6.7) An ExerciseSession's `payload` is normalised on read: `exercise_type` the symbolic name (`running_treadmill`; a legacy integer becomes its name) and `exercise_type_code` the Health Connect integer (null when unknown); the stored event is unchanged. The timeline's `hcExercise` carries both (`exerciseType`, `exerciseTypeCode`). `deleted` (first page): the records of that type in the range whose latest revision a Health Connect deletion (`hc/deleted`, from ring app's changes token) retracted, with `deletedAt`, so Vitals withdraws what it imported from them (`activity.fromGauge` `deletedRefs`) |

**Derivations (energy SPEC §S2).** Pure modules under `packages/companion/src/home/`, fed by `gaugeDerive.ts` through
the store's paged read helpers (a derivation never runs on truncated input):

- `stepFusion.ts` (`steps-fuse/1`, SPEC §2.3): one lineage per supported interval (ring, phone, `hc-other:<origin>`,
  unknown), never max, never sum. Same-lineage copies (Health Connect's copy of the phone, a re-upload) are alternatives;
  validity comes first (r063 A8: an invalid primary, e.g. over 300 steps/min, never hides a valid same-lineage copy).
  A component with any coarse record is one unit; minute components are chosen minute by minute: user correction →
  activity context → **sole sustained gait** (≥ 3 minutes at ≥ 80/min against the other lineage observed at ≤ 10 %: the
  treadmill with the hands still) → the only valid lineage → a phone walking bout with missing ring coverage or repeated
  wrist stalls → `ring > phone > hc-other`, flagged at 20 % apart. A wrist stall needs sustained direct phone minute gait
  and repeated low ring minutes despite complete ring detail; a coarse total alone cannot establish it. A still phone in
  a non-locomotor activity can instead expose ring arm artefacts. When carry is unknown and both streams plausibly count
  gait, fusion keeps the configured preference and reports disagreement rather than asserting which count is true.
  - (r063 A3) A coarse `hc-other` record is eclipsed (an alternative only, out of the component) only when valid records
    of preferred lineages cover at least 90 % of its time; otherwise it joins the component, so one ring minute never
    erases a Health Connect hour. In a coarse unit, a lineage covering under 90 % of it is `partial` and cannot win by
    rules (b) to (e) while another covers it (`selectionReason: coverage`); the person's correction still can.
  - Activity context: `nonLocomotor` takes the phone if observed, else the ring (flagged). A `locomotor` bout with
    unknown carry uses sustained gait or bout evidence; a few phone steps cannot displace a walking ring. A treadmill
    bout takes the phone with credible count, while a nearly still phone yields to ring gait. Known `pocket` carry takes
    the phone if observed; `hand` or `desk` takes the ring and the phone's zeros there are not observations. A person's
    explicit correction takes precedence over every inferred rule.
  - Observed zeros (r063 A9, `r063/GAUGE-CONTRACT.md` item 2): a `phone/acquisition` interval with `state: listening` and
    `observed_zero: true` (ring app 2.8.1: the step detector registered) is observed whole; any other listening interval
    only when a detector-timed phone record overlaps it. Fusion subtracts every phone record (counter spans included)
    at read time; the minutes left are the phone's observed zeros.
  - Legacy `activity_bucket` rows (unknown duration) are never placed; the ring's daily total covers them as
    `ringResidual`.
- `hrSupport.ts` (`hr-support/1`): a reading stands for time only with a declared cadence (`cadence_s`, or the workout
  stream's 10 s): ±min(c, 60 s)/2, clipped at neighbour midpoints and session/pause edges; otherwise sampled statistics only.
- `sleepMetrics.ts` (`sleep-metrics/1`): K/A/U/G minutes, `tstLowerMin`..`tstUpperMin` (unknown and gaps never asleep),
  `onset` / `finalWake` / `midpoint`, `leadingWakeMin` ("settle time"), `stageMinutes`, `restorativeEstimatedMin`,
  `namedCoveragePct` and `incomplete` (< 95 %), `windowContinuityPct`, `wasoMin`, `awakeningRuns`, `wakeUps` (≥ 5 min),
  `nightlyLowHrP10` (5-min bins), `avgSleepHr` (declared cadence) or `sampledMeanSleepHr`, `timeToLowMin`, `trace5min`,
  `hrTrend`, `tooFewHrReadings`, `hrvNightlyMs`, `hrvWithinNightMs`, `skinTempNightC`, `spo2Night`, `minutesBelow90`;
  `respRate`, `tossesTurns`, `sleepLatency` are null (`reasons`: `unsupported`). Every null names its reason. (r071) A wake
  break between the parts of a night (`awakeBreaks`) is awake after sleep onset: it counts in `wasoMin`, `wakeUps`,
  `stageMinutes.awake`, `namedCoveragePct` and `windowContinuityPct` and never as asleep; for the ring's coverage (`G`,
  `coveragePct`) it stays a gap, and its readings stay out of the night's heart rate, HRV, temperature and SpO2. A gap under
  an hour inside a night was never a break and stays unnamed, as before.
- `baselines.ts`, `dayMetrics.ts`, `timeline.ts`: the baselines, day values and minute timeline above. No score is
  computed on the server: Vitals computes its indices from these.
- Every derived answer carries `inputsHash` (`sha256:` over its input event ids, each one revision, and the algorithm
  versions), so the ETag changes when a source row is revised or deleted. `packages/companion/fixtures/gauge-v2/*.json`
  are the fixture day's answers (`gaugeV2.test.ts` writes them; Vitals reads them and never edits them).

**ring app data for Vitals.** The person's Vitals devices (Vitals device tokens only; a ring app `lumen` token or an agent
token is 403 `wrong_kind`, agents use `/mcp`) read the same tools over `GET`, the tool's arguments as query parameters.
Each answer is exactly the tool's JSON (`{ ok, status, summary, data }`): 200, or 400 with the tool's rejection for a
bad value, 400 `bad_request` for an unknown or repeated parameter, 503 when the store could not be read.

| Endpoint | Tool |
|---|---|
| `/v1/gauge/availability` | `gauge_data_availability` |
| `/v1/gauge/series?kind=&from=&to=&bucket=&cursor=&limit=` | `gauge_metric_series` |
| `/v1/gauge/daily?date=` | `gauge_daily_summary` |
| `/v1/gauge/sleep?from=&to=` | `gauge_sleep` |
| `/v1/gauge/activity?from=&to=` | `gauge_activity` |
| `/v1/gauge/scores?from=&to=&key=` | `gauge_scores` |
| `/v1/gauge/device` | `gauge_device_state` |
| `/v1/gauge/short-video?from=&to=` | `gauge_short_video` |
| `/v1/gauge/workouts?from=&to=` | `gauge_workouts` |
| `/v1/gauge/steps?from=&to=` | `gauge_steps` |
| `/v1/gauge/timeline?date=` | `gauge_timeline` |
| `/v1/gauge/hr-intervals?from=&to=&cursor=&limit=` | `gauge_hr_intervals` |
| `/v1/gauge/baselines?date=` | `gauge_baselines` |
| `/v1/gauge/hc?type=&from=&to=&cursor=&limit=` | `gauge_hc` |
| `/v1/gauge/changes?since=&limit=` | `gauge_changes` |
| `/v1/gauge/changes-state?refs=` | `gauge_changes_state` |
| `/v1/gauge/detections?since=&from=&to=&limit=` | `gauge_detections` (0.6.7) |
| `POST /v1/gauge/steps/fuse` (JSON body) | `gauge_steps` with context |
| `POST /v1/gauge/fusion-context` (JSON body) | stores the person's fusion context (below); not a tool |

**ring app pulse (r069).** `GET /v1/gauge/pulse?since=&wait=0..25` (Vitals device tokens only) answers
`{ token, boot, uploads, data, lastUploadAt, dataAt, serverNow }`, held up to `wait` seconds while `since` is still the
current token. `uploads` moves on every ring app upload the store took; `data` moves on uploads with readings (anything but
The ring app's `state/*` reports) and on detection runs that wrote episodes. The counters live in memory: a restart is a new
`boot`, which a client reads as "read everything again". Vitals holds one while it is in front and runs its ring app import
when `data` moves (at most every 30 s), so new readings reach the screen seconds after they reach the server.

**Automatic detection (0.6.7, `detect/2`; r065 autodetect CONTRACT §§1–2).** The server proposes activity windows from
what ring app already uploads and keeps them as persistent episodes, so detection goes on while no Vitals client is open.
A detection is always a suggestion: nothing is logged until the person approves it in Vitals.

- **Evidence ring app 2.8.3 adds.** `phone/activity_transition` (one event per Android Transition API callback event:
  `activity` = the subject, one of `IN_VEHICLE`, `ON_BICYCLE`, `RUNNING`, `WALKING`, `STILL`; `transition` `ENTER` or
  `EXIT`; `occurred_at` from elapsed realtime through the boot anchor, never the callback's time; `boot_id`;
  `elapsed_ns` as a decimal string; `registration_epoch`) and `phone/activity_recognition_acquisition` (intervals
  `from`..`to` with `state` `listening`, `noPermission`, `unsupported`, `failed` or `stopped`, `registration_epoch`).
  Malformed ones are `bad_activity_transition` / `bad_ar_acquisition`. Both are span categories (a transition is a point
  at `occurred_at`), read through the views `activity_transitions` and `ar_acquisition` over `event_state` (current
  versions only); a re-sent event is a duplicate, an interval re-sent with the same `from` replaces the earlier version
  (newest received). The phone step acquisition's 5-minute checkpoint (`phone/acquisition` with `open: true` and `to`
  the last-seen time, same subject and `from`) replaces the previous checkpoint the same way and counts as listening up
  to its `to`, so observed zeros and a walk in progress reach detection within minutes.
- **The minute evidence** (`packages/companion/src/home/detect/features.ts`, bounded windows through the existing
  helpers): the phone's and the ring's own minute counts (`counted`, the phone's observed `zero`, `coarse` under a
  counter span or the ring's ten-minute fallback, `unknown`: never zero), step fusion's selection (reported only; fusion
  runs here without the person's activity context, so a pending detection can never feed the selection that detects
  it, and step fusion stays the only source of step totals), HR mean and supported seconds (`hr-support/1`; a minute
  counts with ≥ 30 s), the sleep stage, the recognised activity (carried forward inside `listening` intervals of the
  same registration, unknown outside; recognition intervals upload when they close, at the UTC hour at the latest, so
  the newest closed listening interval is carried into the still-open hour), accepted GPS speed and position inside
  ring app workouts, and the overlapping ring app workouts and Health Connect exercise sessions.
- **The detector** (`detect/detect.ts`, pure, `detect/2` config `2.0.0`): bouts first, then a label only as specific as
  the evidence. Known sleep and `IN_VEHICLE` minutes are never part of a passive episode (a diagnostic is kept). Gait is
  read from the phone lineage (walk ≥ 10 min at ≥ 60/min on ≥ 80 % of minutes; slow walk ≥ 20 min at ≥ 40/min, steady
  cadence `1.4826·MAD/median ≤ 0.20`), never from the fused headline: the keyboard treadmill (steady phone steps, the
  ring at ≤ 20 % of them, no location evidence) is `walk_possibly_treadmill`, with accepted stationary location
  `treadmill_walk`; missing GPS is never "indoors". A run needs `RUNNING` recognition or accepted GPS ≥ 2.8 m/s besides
  its cadence: high cadence alone stays a walk with `run` as an alternative. Cycling needs `ON_BICYCLE` (≥ 70 % of the
  known time); GPS-only cycling and ring-burst (strength-like) bouts need a supported HR response and stay low; a steady
  ring with the phone at zero or unknown is `possible_workout` (alternative `walk`), never strength; an HR-only bout
  needs a pre-bout awake baseline, the steps observed low, a recovery and at most 2 h (existence ≤ 0.45). Bouts bridge
  ≤ 2 minutes (ring-burst rests ≤ 4). Scores: `existence` = clamp(0.35C + 0.25P + 0.20X + 0.20H − 0.25K, 0, 0.95)
  with the design's caps, `typeScore` from its evidence table, `level` low/medium/high (< 0.60, < 0.80) of the smaller.
  These rank suggestions; they are not probabilities.
- **Non-stepping limits.** Air-bike and dumbbell exercises have no equipment classifier. They can produce only a
  generic review suggestion when the evidence above qualifies. Ordinary ring all-day history and live readings carry
  no declared HR cadence, so visible sampled HR elevations alone cannot meet the supported-HR gates. The native app
  declares cadence for verified workout streams; sparse history is never expanded into continuous exertion. Missing
  suggestions can therefore reflect insufficient evidence even when an exercise really happened.
- **Episodes** (`detect/episodes.ts`, table `detection_episodes`, schema version 5): a ULID assigned once; every later
  run over the same movement (earlier uploads that move its start, late evidence, a merge or a split) keeps it and
  bumps `revision` only when something public changed. `open` while fewer than 5 minutes of the primary lineage's
  evidence follow the bout (or it ended under 2 h ago), then `final`; a final episode is still revised by late
  evidence. An episode the evidence no longer supports (a deletion hid it) is `withdrawn`; matched again, it comes back
  under its id. Rejection is the client's (Vitals keeps rejected ids rejected across revisions).
- **When it runs.** The upload's own transaction queues the ranges its detection evidence touches (`detection_queue`;
  a deletion its target range, a `*` reset the 35-day horizon); the upload then kicks the person's job, which runs
  after a 3 s debounce, never inside a request: each queued range ± 30 min, cut into windows of at most 6 h, each one
  synchronous step in its own event-loop turn inside the 300,000-row budget (a window over it is split), widened to
  whole episodes, read with 150 min of context (the maximum HR bout plus baseline/recovery dependency). Queue rows
  go only after every window succeeds; failed batches remain queued for the next kick or startup, and do not advance
  the completion watermark. Replays are idempotent. The
  migration to version 5 queues the last 30 days once; the server's warm-up runs it after start.
- **Reading it.** `GET /v1/gauge/detections?since=<cursor>&from=&to=&limit=` (`gauge_detections`; default 200, at
  most 500 a page) answers `{ detector: "detect/2", config, episodes: [episode…], withdrawn: [id…], cursor, more,
  resync, processedThrough, diagnostics }` in change order. `cursor` is `<epoch>.<sequence>`: pass it as `since`;
  another file's epoch (a restored store) answers from the start with `resync: true`. `from`/`to` keep the changes
  overlapping that range (the cursor still advances past the others). `processedThrough` (ISO UTC) is how far
  detection has run, held back by any range still queued. `diagnostics`: queued ranges, episode counts by state, the
  last run's suppression counts (`sleep`, `vehicle`, `hr_unbounded`, …) and its time. An episode:
  `{ id, revision, detector, config, start, end, moving: [{ start, end }], state, label, alternatives, existence,
  typeScore, level, reasons, coverage: { phone, ring, hr, ar, gps }, evidenceHash, recordingRefs }`, times ISO UTC;
  `label` one of `walk`, `walk_possibly_treadmill`, `treadmill_walk`, `run`, `treadmill_run`, `cycling`,
  `possible_cycling`, `possible_workout`, `possible_strength`; `recordingRefs` the overlapping `gauge:<session>` and
  `hc:<id>` (Vitals' absorption rule decides). Reason codes: `phone_cadence`, `steady_cadence`, `slow_cadence`,
  `no_intensity_claim`, `brisk_cadence`, `ring_low`, `ring_agrees`, `location_unknown`, `stationary_location`,
  `gps_moving`, `ar_walking`, `ar_running`, `ar_bicycle`, `ar_conflict`, `high_cadence_unresolved`, `hr_raised`,
  `hr_bounded`, `hr_sampled_raised`, `hr_only`, `steps_low`, `ring_bursts`, `ring_only_movement`, `phone_zero`,
  `phone_unknown`, `phone_low_cadence`, `phone_gait_during_cycling`, `gps_only`, `type_unknown`, `coverage_gaps`,
  `recording_overlap`. `gauge_data_availability` names the detector (`detection: "detect/2"`, `detectionConfig`): a
  Vitals client that sees it does not run its own `detect/1`.
- **Cost** (a copy of the live `lumen.db`, this PC under load ~9–12, `scripts/detect-bench.mjs`): the 30-day backlog
  is 121 windows of 6 h in about 2.2 s (a window 17 ms median, 32 ms at most); with a dense synthetic month added
  (phone minutes 16 h a day, ring minutes and HR every minute, 93k events) 122 windows in 3.8 s (30 ms median, 47 ms
  at most), an incremental run after one upload about 30 ms, the route under 2 ms. Expect two to three times that on
  the ARM box. Ingest maintains the queue in its transaction (about 78 ms per 500 events with the state).

**Heart-rate intervals.** `GET /v1/gauge/hr-intervals` (`gauge_hr_intervals`) gives Vitals the raw readings behind
the timeline's minute means, so time in heart-rate zones is the sum of each reading's own supported interval rather than
of minute means (a 30-second Zone 1 and a 30-second Zone 4 inside one minute are not a minute of Zone 3).
- The window `[from, to)` spans at most 36 hours (a date as `to` is that whole day); a wider one is 400 `invalid_input`.
- The supports are `hr-support/1`'s: `[t − h, t + h)` with h = min(cadence, 60 s)/2, clipped at the midpoints to the
  neighbouring readings, at each workout's start, end and pause edges and at the window. They never overlap and a gap
  over min(2 × cadence, 60 s) is never bridged. A reading without a declared cadence has `start`/`end` null: it stands
  for no time (the same rule as the timeline).
- Supports are computed over the whole window before paging (readings up to a minute past each edge count as
  neighbours and are not returned), so a page boundary never changes them. Vitals follows `next` to the end and refuses
  a set whose pages disagree on `inputsHash` (it then uses the minute means and says so).
- Reads go through the store's read helpers (`readMetricSamples`, `visible_events`, `readIntervals`), never the tables.

**Time zone.** Every read takes an optional `tz` (an IANA name). Day boundaries, the 19:00 sleep rule and the clock
baselines use, in this order: `tz`; else the fixed offset of the newest `local_offset_min` in the range; else the
person's zone; else UTC. Object answers echo the zone used as `tz`. Vitals always sends its device zone.

**Step fusion with context.** `POST /v1/gauge/steps/fuse` returns exactly the `GET /v1/gauge/steps` JSON, fused with
what only Vitals knows. The body is `{from, to, tz?, bucket?, activities?, corrections?, preference?}`:
- `activities` are the approved bouts, `{start, end, kind: locomotor | nonLocomotor | unknown}`;
- `corrections` are the person's step corrections;
- `preference` carries `stepsPreference` and `soleSustainedGait`;
- `rolloverH` (r063 FX2) is the person's day rollover (local hour, may be fractional): merged minute intervals break at
  each day's rollover as well as at midnight, so every located interval lies in one app day and Vitals' app-day adapter
  places its count. An indivisible coarse record still counts on the day of its last instant.

Inside a nonLocomotor window the phone's observed zero wins over the ring's arm swings. With no context the answer equals
the GET. A day's total depends only on that day's evidence, never on `from`. `gauge_steps` takes the same optional
arguments. An activity may carry `carry: pocket | hand | desk` (a locomotor bout's phone carry).

**Fusion context (r063 S6/A2).** One contextual fusion result for every consumer: the timeline, the activity and day
summaries, `/steps`, the Ring, the detectors, Heart Points and the import, and the agents' tools.
- *Decision:* the server resolves the person's context itself. The alternative (every read accepting the context and the
  client passing it everywhere) would put the person's decisions into every Ring and Progress request, need POSTs for
  reads and keep the consumers in step by hand. The server is already the one place every read passes.
- Vitals posts `POST /v1/gauge/fusion-context` `{ window: { start, end }, activities, corrections?, preference?, tz? }`
  (the same activity, correction and preference shapes as `/steps/fuse`). The import posts it at every run for the last
  35 days to tomorrow, and within a few seconds of any change to the log or the step settings.
- The server keeps it per person (`persons/<id>/fusion-context.json`, 0600). A post replaces the activities and
  corrections that start inside its window and keeps the rest; the preference and `rolloverH` (r063 FX2) are replaced
  when given. Items ending
  more than 400 days ago are dropped, at most 5000 of each list are kept. The answer is
  `{ revision, changed, updatedAt, activities, corrections }` (`revision` is a hash of the stored content), never cached.
- Every fused read without its own context (`gauge_steps`, `gauge_timeline`, `gauge_activity`, `gauge_daily_summary`)
  uses the stored items that overlap its widened read (the asked days ± 2 days). Its `inputsHash`, and so its ETag,
  names that part (`context:<key>`), so a conditional poll after a change gets the new answer. A call that brings its own
  context (`POST /steps/fuse` with `activities`, `corrections` or `preference`) uses that instead.
- Vitals' client drops its cached ring app answers when the revision changes and tells listeners
  (`onFusionContextChange`): Progress's timeline cache and the Ring's screens refresh.
- Two devices with different views of the log converge as each syncs; the last post wins for its window.

**Change feed (r063 S13/A6).** `GET /v1/gauge/changes?since=<cursor>&limit=` (`gauge_changes`) lists what changed upstream
in the data Vitals imports, so it withdraws an import whose source was deleted, never inferring a deletion from absence.
- Covered: ring app workouts (`activity/session`, ref `gauge:<session id>`), Health Connect exercise sessions and weights
  (`hc/record` and `hc/deleted`, ref `hc:<record id>`).
- The cursor is `c1.<events seq>.<deletions rowid>`, or (0.6.3 FX1) `c1.<seq>.<rowid>.<target>.<observed ms>.<seq>` when a
  page stopped inside a deletion. Without `since` the answer is the current cursor with `resync: true`; a cursor ahead of
  the store (a restored file) is `resync: true` too.
- Each change is the record's state now (`revised`: its latest start, end and revision time; `deleted`: retracted by a
  Health Connect tombstone or hidden by a ring app deletion, with when). `revised` can repeat a redelivered record.
- Bounded: one page scans at most 20,000 events and 2,000 deletions after the cursor by primary key, reads at most
  20,000 hidden records of the deletions (keyset pages of 500 over `event_state_category`, each a seek from where the last
  stopped) and stops once `limit` records (default 500, at most 2000) were touched; `more: true` asks for the next page.
  (0.6.3 FX1) A deletion hiding many imported records (a `*` reset, a bulk delete) is listed across pages, never answered
  with `resync`.
- **State of named records (0.6.3 FX1).** `GET /v1/gauge/changes-state?refs=<kind>:<id>,…` (`gauge_changes_state`, at
  most 100 refs; kinds `workout`, `hcExercise`, `hcWeight`) answers each record's state now: `present`, `deleted` (with
  when) or `unknown` (the server holds nothing of it: never a deletion). Indexed lookups only (`event_state_group`).
- Vitals keeps the cursor on the device and advances it only after the deletions were applied: activities get them as
  `activity.fromGauge` `deletedRefs`, imported weights are removed with `log.retract` (restorable), and each retraction
  is kept in the device's import audit trail. On `resync: true` it pages what it imported (activity source refs, weights)
  through `changes-state` (10 pages of 100 a run), withdraws what is `deleted`, and saves the feed's cursor only once every
  ref was checked and the deletions landed (the progress is kept between runs).

**Health Connect pages (r063 S15).** `gauge_hc` returns `next`; Vitals follows it to the end (at most 25 pages) and marks
a cut read `truncated`. The import splits `activity.fromGauge` into calls of at most 500 sessions and 500 deleted refs,
`log.fromGauge` into calls of at most 400 weights, and moves its watermark only when every page and call succeeded.

An empty parameter is left out (`bucket=` is the default). For cheap polling every 200 carries a weak `ETag`, computed
without the `minutesSince…` counters (they move with the clock, not the data), `Last-Modified` (the person's last ring app
upload) and `Cache-Control: private, max-age=30`; send the tag back as `If-None-Match` and an unchanged answer is 304
with no body. Browsers may send `If-None-Match` (the preflight allows it) and read `ETag` and `Last-Modified`.

**End-to-end check.** `node packages/companion/scripts/lumen-e2e.mjs` (after `pnpm --filter vitals-companion
build:person`) runs a real `vitals-server serve` in the home role on 127.0.0.1 with its data in a throwaway folder, pairs
as ring app with a `pair-code` code, uploads the fixture ring app's own mapper built (`HubE2eFixtureTest.kt`: two days of
history, duplicates, malformed events, a deletion, a Reset App Data and the re-sent history) plus hand-built short-video days, calls every `gauge_*`
tool and `briefing_get` with an agent token over `/mcp`, unpairs and stops the server. Exit 1 on any failed check.

## Updates

The server delivers app updates over the air, so the owner's phone never needs USB or wireless debugging. Vitals gets
silent web-bundle updates and APK updates; ring app gets APK updates. The binding contract is
`vitals-research/ota/CONTRACT.md`. The code is in `packages/companion/src/home/releases.ts`.

**Store.** Releases live in `<dataDir>/releases/<app>/<channel>/`, with app `vitals` or `gauge` and channel `stable`.
`index.json` lists the releases newest first, and the files sit next to it (0700 directories, 0600 files). The server
keeps the last 3 APKs and the last 3 web bundles of each app and channel. When a release drops off the index, its files
are deleted.

**Publish.** The orchestrator copies the files to the host with scp, then runs on the host:

```sh
vitals-server release publish vitals --apk vitals-release.apk [--version-name 0.7.0 --version-code 14] [--notes "…"] [--sha256 <hex>]
vitals-server release publish gauge  --apk gauge-debug.apk --version-name 0.3.0 --version-code 3
vitals-server release publish vitals --web vitals-web-202610260809-10ecce3.zip --sig vitals-web-202610260809-10ecce3.zip.sig [--version 202610260809-10ecce3] [--sha256 <hex>]
vitals-server release list vitals
```

- **APK.** The version comes from the APK's own binary manifest. `--version-name` and `--version-code` are needed only
  when the manifest cannot be read. When both are present they must agree. A versionCode that is already published
  with another file, or that is lower than the newest one, is refused (Android cannot install it as an update).
- **Web bundle** (Vitals only). The zip must have `bundle.json` at its top level:
  `{ "version", "minNativeVersionCode", "builtAt" }`. The server reads all three from it. `--version` is a check: it
  must match. `--sig` is the detached ed25519 signature over the zip's sha256 hex: 64 bytes, given raw, as hex or as
  base64. The server stores the file as given (`<file>.sig`) and returns the signature as base64. It never verifies the
  signature; only the app holds the public key. A version that is already published with another file is refused.
  Bundles are ordered by `builtAt`, then publish order, never by semver: a bundle built earlier but published later is
  stored below the newer builds and never offered over them, and one built before all 3 kept bundles is refused.
- **Integrity.** The server computes the sha256 and size, writes a temporary copy, fsyncs it, hashes the copy, and
  renames it into place only if the two match. `--sha256` adds a check against the hash from the build machine. The
  index is written atomically as well. Publishing the same file again changes nothing. A lock file stops two publishes
  from running at once. The CLI prints versions, sizes and hashes only.

**Endpoints.** These need a paired token. A Vitals device token sees app `vitals` only; a ring app `lumen` token sees app
`gauge` only (403 `wrong_app` otherwise). Agent tokens, including the coach's, get 403 `wrong_kind`. A ring app token
still works nowhere else except `/v1/lumen/*` and `/v1/coach/*`.

| Method + path | Answer |
|---|---|
| `GET /v1/apps/<app>/latest?channel=stable&versionCode=<installed>&web=<installed web version>` | `{ apk: { versionName, versionCode, sha256, size, url, notes? } \| null, web: { version, sha256, size, url, sig } \| null }`; `versionCode` is required (400 without it) |
| `GET\|HEAD /v1/apps/<app>/files/<channel>/<file>` | the file, with `Content-Length`, `Accept-Ranges: bytes`, `ETag: "<sha256>"`; one `Range` gives 206 with `Content-Range`, an unsatisfiable one gives 416; `If-Range` with a stale ETag sends the whole file |

- `apk` is null unless the newest APK's versionCode is above the installed one.
- `web` (Vitals only) is the newest bundle (by `builtAt`) with `minNativeVersionCode` ≤ the installed versionCode,
  offered only when it was built after the installed bundle. The installed bundle's build time is its `builtAt` when
  this server published it; else the UTC minute in a `scripts/release/web-bundle.mjs` name (`202610260809-10ecce3`,
  the end of that minute); else, for `web=apk-<versionName>` (an APK without bundle.json), the time this server
  published that APK. A bundle of unknown age gets `web: null`, so a phone is never handed a possible downgrade. The
  app checks again: it refuses a bundle built before its own APK's bundle.
- **The `url`s are relative** (`/v1/apps/gauge/files/stable/gauge-3-….apk`). The apps resolve them against the address
  they paired with, so the same answer works on the `.ts.net:8443` address and on the public 8444 address. The ring app refuses
  any URL on another host or port, so the server never builds an absolute URL from `publicOrigin`.

**End to end.** `node packages/companion/scripts/ota-e2e.mjs` (after `pnpm --filter vitals-companion build:person`,
`pnpm build` and `node scripts/release/web-bundle.mjs --use-dist`) runs a real `vitals-server serve` on 127.0.0.1 behind
a self-signed TLS front, pairs with the app's own client, publishes a dummy APK and the bundle with the CLI (plus an
older build published later and one that needs a newer APK), checks `/latest` for many installed states, runs the app's
`checkForUpdates` with a Node port of the native checks (ranged download, sha256, ed25519 with the key in
`OtaVerify.kt`, `OtaLogic.acceptable`) and checks `/install`. Exit 1 on any failed check.

**Bootstrap page (no token).** `GET /install` is a small HTML page with two links, "Vitals" and "ring app", to
`GET /install/<app>.apk`: the latest stable APK, with range support. The owner opens it once in the phone's browser to
install the OTA-capable builds without debugging. It shows no data: no versions, no person, no device. An app with no
APK yet is listed as "not published yet".

- It answers only requests from the tailnet or from the server itself; everything else gets 404. The server listens
  on loopback, behind `tailscale serve` (:8443) and Caddy (:8444, bound to the tailnet address). Both proxies connect
  from loopback and append the client's address to `X-Forwarded-For`. The server takes the last entry and requires a
  Tailscale address (100.64.0.0/10 or fd7a:115c:a1e0::/48). A request marked `Tailscale-Funnel-Request` (Funnel,
  public) is refused. A loopback request with no forwarded address was made on the host itself and is allowed. The
  usual Host check still applies.
- It is also gated by `server.json` `"releases": { "publicInstall": true }`. The default is on. Set it to `false` and
  restart to turn `/install` off. The token routes do not depend on it.
- It shares the per-address limit of the pairing routes. Responses carry `Content-Security-Policy: default-src 'none'`
  and `Cache-Control: no-store`.

## A public address for devices without tailnet DNS (the apps)

Some phones cannot resolve `*.ts.net` names (Tailscale's DNS setting is off), and the packaged desktop and Android apps
have the same problem. The fix is a public DNS name whose address record points at the server's tailnet address
(`vitals-server.example.com` -> `100.64.0.1`), with a certificate Caddy already keeps for that name. Only a tailnet
address is in public DNS, so nothing is reachable from the internet.

Port 443 on that name may be taken by something else, so the API uses port **8444**.

1. **Caddy.** Add one site on port 8444, bound to the tailnet address only, with the same `tls` block as the existing
   site for that name (same issuer, so Caddy reuses the same certificate). Back up the Caddyfile first.

   ```caddy
   vitals-server.example.com:8444 {
       bind 100.64.0.1
       tls { …the same tls block as the existing site for this name… }
       import tailnet_only          # whatever refuses non-tailnet addresses in your file
       reverse_proxy 127.0.0.1:4870
   }
   ```
   Then `caddy validate --config /etc/caddy/Caddyfile` and `systemctl reload caddy`. Check that Caddy now listens on
   `100.64.0.1:8444`. If the tailnet firewall lists ports, allow 8444.
2. **The server.** As the server's user, then restart:

   ```sh
   vitals-server init --public-host vitals-server.example.com \
     --public-origin https://vitals-server.example.com:8444
   systemctl --user restart vitals-server && vitals-server status
   ```
   `--public-host` adds the name to the Host names the server accepts (it replaces any earlier list, so repeat every name
   you want to keep). `--public-origin` makes this the server's own address. `init` keeps every other setting. If the
   old `.ts.net` address is already in use, it keeps working where it resolves.
3. **App origins.** The server always accepts the packaged apps' own origins, `https://localhost` and
   `capacitor://localhost` (Android) and `app://vitals` (desktop); you add nothing for them. An origin for any other web
   page needs `--origin <url>` (it adds to the list, no duplicates). A request with no `Origin` header (curl, the apps'
   native calls) passes.

With a public origin set, the pairing code's QR text (`vitals-server:1?u=<address>&c=<code>&n=<label>`) and the agent MCP
address all carry `https://vitals-server.example.com:8444`, so a device that scans the code is given an
address it can reach. Devices paired earlier, and agent registrations already made, keep the address they were given.

The site on 8444 proxies everything to the server, so these paths work on it: `/health`, `/v1/…` (pairing, devices,
the person routes), `/sync` (WebSocket, `wss://vitals-server.example.com:8444/sync`) and `/mcp`. In the app, Settings › Server takes `https://vitals-server.example.com:8444` (write the port,
no trailing slash).

**Check it** from a computer on the tailnet:

```sh
curl -sS https://vitals-server.example.com:8444/health                       # 200 and JSON; 403 "host not allowed" = step 2 is missing
curl -sS -o /dev/null -D - -H 'Origin: https://localhost' https://vitals-server.example.com:8444/health | grep -i -E '^HTTP|access-control-allow-origin'
curl -sS -o /dev/null -w '%{http_code}\n' -H 'Origin: https://evil.example' https://vitals-server.example.com:8444/health   # 403
```

On the phone (Tailscale on), open `https://vitals-server.example.com:8444/health` in the browser: it shows the same JSON.

**Roll back.** Copy the Caddyfile backup back and `systemctl reload caddy`; the `.ts.net` address does not depend on
this site. To drop the public origin, run `vitals-server init --public-origin <the old address>` and restart. Port 8444
depends on Caddy: if Caddy is down the apps lose the API on this address.

## Providers

Three services run through the server because a browser cannot call them directly: Sign in with ChatGPT (`siwc`),
NVIDIA NIM (`nim`) and OpenCode Zen (`opencode-zen`). Other providers stay browser-direct, with the person's key kept
in the browser.

The routes are mounted on the home role (`packages/companion/src/home/aiMount.ts`). The person is resolved from the `Authorization: Bearer <device token>` header only, by the same function that serves every other route (`home.resolvePerson`). A person id in the path, query or
body is ignored, and a token in the query is refused with 401. Each request then uses only that person's files:

| File (under `persons/<id>/`) | Holds | Mode |
|---|---|---|
| `credentials/providers.json` | `{ "nim": "<key>", "opencode-zen": "<key>" }` | 0600, in a 0700 directory |
| `credentials/siwc.json` | ChatGPT access and refresh token, expiry, client id | 0600 |
| `credentials/install.json` | `installId` of this server for this person, and `siwcClientId` | 0600 |
| `usage.jsonl` | one line per AI request: `{ at, preset, model, inputTokens, outputTokens, status }`, no prompt text; rotated to `usage.1.jsonl` above 4 MB | 0600 |

Host environment variables (`NVIDIA_API_KEY`, `OPENCODE_API_KEY`) are not used on the server. They would serve every
person.

| Method + path (device token) | Answer |
|---|---|
| `GET /v1/ai/status` | `{ presets: [{ id, label, ready }] }` |
| `PUT /v1/ai/keys/{nim\|opencode-zen}` `{ key }` | 204; the key is never returned |
| `DELETE /v1/ai/keys/{preset}` | 204 |
| `GET /v1/ai/siwc/status` | `{ signedIn, expiresAt? }` |
| `POST /v1/ai/siwc/logout` | 204: revokes and removes this person's ChatGPT tokens |
| `GET /v1/ai/{preset}/models` | upstream list (the ChatGPT list is translated to `{ data: [{ id }] }`) |
| `GET /v1/ai/{preset}/probe` | `{ ready: true, models }` or `{ ready: false, error: { code, message } }` |
| `POST /v1/ai/{preset}/chat/completions` (`nim`, `opencode-zen`) or `/responses` (`siwc`) | upstream answer; SSE passed chunk by chunk (`X-Accel-Buffering: no`); a client abort cancels the upstream request |
| `GET /v1/ai/usage` | `{ today: { requests, inputTokens, outputTokens }, cap? }`, counted in the person's own time zone |

The ChatGPT rewrites are applied unchanged: `store: false`, unsupported parameters dropped, tools namespaced, and a
non-streaming request collapsed from the stream.

**Limits.** 30 AI requests per minute per person by default (`server.json` `limits.aiRequestsPerMinute`). An optional
daily cap per person is set with `requestsPerDay`. The per-device and per-IP limits are the server core's.

**Errors.** The body is `{ error: { code, message, detail? } }`, and `message` is shown to the person as written.

| HTTP | code | When |
|---|---|---|
| 401 | `unauthorized` / `revoked` | no token, unknown token, revoked token |
| 403 | `wrong_kind` | an agent token on a provider route |
| 409 | `not_signed_in` | `siwc` without a sign-in on the server for this person (also `POST /v1/ai/siwc/login`: the browser has no sign-in route) |
| 409 | `no_key` | `nim` or `opencode-zen` without a key |
| 429 | `usage_limit` | ChatGPT `subscription_sharing_usage_limit_exceeded` |
| 429 | `rate_limited` | the per-person limit, or another upstream 429 (`Retry-After` passed on) |
| 429 | `daily_cap` | the per-person daily cap (added by E26) |
| 502 | `upstream_error` | any other upstream error status, an unreachable upstream, or a failed ChatGPT refresh; `detail.status` and `detail.upstreamCode` only, never the upstream body |
| 504 | `upstream_timeout` | no response headers within 120 s, or an upstream 504/408 |
| 400 / 404 / 413 | `bad_request` / `not_found` / `too_large` | bad body, unknown preset or path, body over 8 MB |

**Admin CLI** (on the server; `--data-dir` defaults to `$XDG_DATA_HOME/vitals-server`):

```sh
vitals-server keys set <person> nim          # key from stdin, hidden
vitals-server keys import <person> keys.json # a Companion keys.json; or from stdin
vitals-server keys list <person>
vitals-server keys remove <person> nim
```

These subcommands are routed only when the first argument after the subcommand is a person id. They use the server's
data folder from `server.json` unless `--data-dir` is given. (Before Q8 they were only in `vitals-companion`; a
`vitals-server` older than this fix prints its help instead.)

## Sign in with ChatGPT

OpenAI offers no device-code flow, and a `127.0.0.1` sign-in callback reaches the computer running the browser, not
the server. Sign-in is therefore an admin step, done once per person. Two ways:

**1. Move an existing sign-in (default).** Refresh tokens rotate, so exactly one machine may hold them. The export
deletes the local copy without revoking it, and the import deletes the export file. From then on only the server
refreshes. The server keeps its own install id per person and takes only the issued client id (OpenAI, "Self-hosted
VMs").

```sh
# on the computer where the person signed in
systemctl --user stop vitals-companion     # a running Companion could refresh during the move
vitals-companion siwc export --out ~/vitals-chatgpt-signin.json
scp ~/vitals-chatgpt-signin.json vitals-server:   # `vitals-server` is your ssh alias for the server
# on the server
vitals-server siwc import <person> ~/vitals-chatgpt-signin.json
vitals-server siwc status <person>
```

`siwc export`:
- refuses if a Companion answers on `127.0.0.1:4870` (pass `--force` to override);
- refuses if the target file already exists;
- writes the file 0600 with exclusive create, reads it back, and only then deletes `siwc.json`.

`siwc import`:
- refuses a person who is already signed in unless `--force`;
- writes `credentials/siwc.json` 0600 and copies `siwcClientId` into `credentials/install.json`, keeping its
  `installId`;
- deletes the export file.

**2. Sign in on the server through an SSH tunnel (fallback).**

```sh
vitals-server siwc login <person> --callback-port 1455 --ssh-host vitals-server
# prints:  ssh -N -L 1455:127.0.0.1:1455 vitals-server    → run this on the computer with the browser
#          https://auth.openai.com/api/accounts/authorize?…  → open it there and sign in
```

The listener binds `127.0.0.1:<port>` on the server only. The tunnel carries the callback to it. This path gives the
server its own host id from the first sign-in, but it needs a person at a browser (OpenAI's bot check blocks scripted
browsers).

`siwc status <person>` and `siwc logout <person>` work per person. The website can only read the status and sign out
(`/v1/ai/siwc/status`, `/v1/ai/siwc/logout`).

## Agents

Agents (Codex, OpenCode, Claude Code, any MCP client) connect to `<publicOrigin>/mcp` with an **agent token**. Tools
run on the server against the person's store, through the same guard the browser uses (`guardedCall` with
`createBusAgentDispatcher({ directApply: () => false })`), inside the person's worker (worker operations `agentManifest` and `agentCall`). No browser tab is needed.

| Scope | Tools listed | Writes |
|---|---|---|
| `read` | read tools | none |
| `log` (default) | read and log tools | log entries applied directly, with undo |
| `edit` | read, log and edit tools | edits staged as proposals (`coach.pending`); the person applies them in the app. On the server an agent never applies an edit directly |

These rules hold for every scope:
- Destructive tools are never listed and never run.
- Commands that need a browser-only port (`planner.find`, `nav.open`, `markers.import`, `log.mealFromPhoto`, and some
  plan editing commands) are left out. Any command whose answer names `not_on_server` (`detail.reason` or `detail.rule`) is removed at run time and open sessions get
  `tools/list_changed`.
- Limits: 60 tool calls per minute per token, 4 open sessions per token, 32 per server.

| Method + path | Token | Answer |
|---|---|---|
| `POST /v1/agents/tokens` `{ client, scope, label? }` | device | `{ token, id, mcpUrl, recipes }`; the token is shown once |
| `GET /v1/agents/tokens` | device | `{ tokens: [{ id, client, label, scope, createdAt, lastUsedAt }] }` |
| `DELETE /v1/agents/tokens/{id}` | device | 204; open sessions of that token close; its next request gets 401 `revoked` |
| `GET /v1/agents/activity` | device | last 50 calls `{ at, tokenId, tool, outcome }`, without arguments |
| `GET\|POST\|DELETE /mcp` | agent | MCP Streamable HTTP |

Agent tokens are kept in the same `persons/<id>/devices.json` as device tokens (kind `agent`, with a `client` field; the id is a UUID). The old Companion agent bridge (`/v1/agent/*`) is not part of the server routes.

**Admin CLI:**

```sh
vitals-server agent-token create <person> --client codex --scope log --url https://vitals.<tailnet>.ts.net:8443
vitals-server agent-token list <person>
vitals-server agent-token revoke <person> <id>
```

**Connecting an agent.** Keep the token in `VITALS_TOKEN`. On the agent's computer,
`vitals-companion agents register <codex|opencode|claude> --remote https://vitals.<tailnet>.ts.net:8443` writes the
entry below and keeps a backup of the file it edits.

| Client | What gets written | Evidence |
|---|---|---|
| Codex 0.159 (`codex exec`) | `~/.codex/config.toml`: `[mcp_servers.vitals]` `url = "<url>"`, `bearer_token_env_var = "VITALS_TOKEN"`, `default_tools_approval_mode = "approve"` | yes: `today_get` ran on the server |
| OpenCode 2.0 (`opencode run`) | `~/.config/opencode/opencode.json` → `mcp.vitals = { type: "remote", url, headers: { Authorization: "Bearer {env:VITALS_TOKEN}" }, enabled: true }` | yes: `today_get` ran on the server. OpenCode prints the resolved request headers, token included, in its own output |
| Claude Code 2.1 (`claude -p`) | runs `claude mcp add --transport http -s user vitals <url> --header "Authorization: Bearer $VITALS_TOKEN"` (Claude Code then keeps the token in `~/.claude.json`, 0600) | yes: `today_get` ran on the server |
| ChatGPT desktop app | On Linux, the packaged client can use the Codex entry in `~/.codex/config.toml`. On Windows and macOS, Settings › Agents shows manual steps to add the remote MCP address and an agent key in ChatGPT's settings. `agents register` has no ChatGPT option. | Q5 exercised ChatGPT's bundled Codex command through a local Companion proxy, not the ChatGPT GUI or the current home-server route. Those paths still need a hands-on check. |

The MCP connection also provides `briefing_get`, a `coach` prompt and a `vitals://briefing` resource. They use the
Coach's own briefing rules and visibility filters. Some derived body-signal flags still need source-level hiding; the
release does not claim every derived signal is filtered. Agents can read the briefing and stage a
plan change for review; they cannot end or replace a plan or erase data.

An agent config that already has a local `vitals` entry (the Companion over stdio) must be replaced. Codex refuses to
merge `url` into a stdio entry ("url is not supported for stdio"), and OpenCode silently keeps the local entry.
`agents register --remote` replaces the whole entry.

Re-run the live check (it uses each agent's own account for one short prompt):
`E26_LIVE=1 pnpm vitest run src/agents/__tests__/serverAgents.live.e26.test.ts`. Results go to
`qa/results/E26-agents-live.json`.

## Coach

When an app is paired with the server, its coach can run **on the server**: the server drives Claude Code (`claude
-p`) on the host in a temporary session, and that session reads the person's data through the server's own `/mcp`
(the Vitals tools and the `gauge_*` tools). The API is `vitals-research/server-coach/CONTRACT.md`. Vitals device tokens
and ring app `lumen` tokens may call it; agent tokens get 403 `wrong_kind` (a coach cannot start coaches). A session
belongs to the token that opened it: a ring app chat is not listed from Vitals.

| Method + path | Answer |
|---|---|
| `GET /v1/coach/status` | `{ available, backend, model?, retentionHours, reason? }` (`reason` when unavailable or busy) |
| `POST /v1/coach/sessions` `{ app: "vitals"\|"gauge", title?, context?: { screen?, date? } }` | `{ sessionId, expiresAt, greeting }`; `app` defaults to `gauge` for a lumen token |
| `GET /v1/coach/sessions` | `{ sessions: [{ sessionId, id, app, title?, createdAt, expiresAt }] }` |
| `GET /v1/coach/sessions/{id}` | `{ sessionId, app, title?, createdAt, expiresAt, messages: [{ id, role, text, at }] }` |
| `POST /v1/coach/sessions/{id}/messages` `{ text, attachments?: [{ kind: "image", mime, data }] }` | `text/event-stream`: `delta`, `tool` (`start` from the CLI, `done` from `/mcp`), `proposal`, then `done` or `error`; `: ping` every 15 s |
| `POST /v1/coach/sessions/{id}/keep` | `{ sessionId, expiresAt }`: `expiresAt` moves `retentionHours` later (at most `maxKeepHours` from now) |
| `DELETE /v1/coach/sessions/{id}` | 204; the session, its folder, its transcript and its token are deleted |

Errors (before the stream: HTTP with `{ error: { code, message } }`; after: an SSE `error` event):

| Case | Answer |
|---|---|
| unknown, other caller's or expired session | 404 `session_expired` ("start a new one") |
| a turn already runs in this session or for this person | 429 `busy`, `Retry-After: 5` |
| `maxConcurrent` turns run on the server | 429 `server_busy`, `Retry-After: 20` |
| `turnsPerMinute` / `turnsPerDay` per person | 429 `rate_limited` / `daily_cap` |
| coach off, CLI missing or not signed in | 503 `coach_unavailable` with the status `reason` |
| more than `maxMessagesPerSession` | 409 `session_full` |
| text over 16 KB, more than 4 pictures, a picture over 5 MB | 413 `too_large`; PNG, JPEG, GIF and WebP only (else 400) |
| during a turn | SSE `error` with `usage_limit`, `timeout` (`turnTimeoutSec`, or `idleTimeoutSec` with no CLI output), `backend_error` or `coach_unavailable`; the user message stays, no answer is added |

**One CLI process per turn.** The first turn passes `--session-id <uuid>`, later turns `--resume <uuid>`; nothing runs
between turns. The command, from the session folder:

```
systemd-run --user --scope --quiet --collect --slice=vitals-coach.slice -p MemoryMax=<memoryMaxMB>M -p MemorySwapMax=0 \
  -p CPUQuota=150% -p RuntimeMaxSec=<turnTimeoutSec+30> -- <claudePath> -p --restricted --setting-sources "" \
  --settings '{"disableAllHooks":true}' --strict-mcp-config --mcp-config <dir>/mcp.json --tools "" \
  --allowedTools mcp__vitals --permission-mode dontAsk --disable-slash-commands --output-format stream-json \
  --include-partial-messages --verbose --input-format stream-json --system-prompt <persona> (--session-id|--resume) <uuid>
```

- **Isolation.** `--restricted` and `--setting-sources ""` load no user, project or local settings, so the owner's
  `~/.claude/settings.json` hooks (multica-ctx) never see a health chat; `disableAllHooks` turns off any other hook.
  Checked on oci-arm with Claude Code 2.1.283: the debug log says "Found 0 total hooks in registry", a live turn
  changed nothing under `~/.local/share/multica-ctx` and wrote nothing to `~/.claude/history.jsonl`. Only our
  `mcp.json` is loaded, no built-in tool is there and only `mcp__vitals__*` may run. The CLI uses the owner's normal
  `~/.claude` login (a copy would sign the owner out when Claude rotates its refresh token).
- **Environment.** The CLI gets a small fixed environment (`HOME`, a PATH with the pinned Node, `TMPDIR=<dir>/tmp`,
  `XDG_RUNTIME_DIR`, `DBUS_SESSION_BUS_ADDRESS`, `DISABLE_AUTOUPDATER=1`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`,
  `VITALS_TOKEN`), never the server's own. The service's PATH does not hold `~/.npm-global/bin`, so the CLI runs by
  absolute path: `coach.claudePath`, else the first of `~/.npm-global/bin/claude`, `~/.local/bin/claude`, … found at start.
- **Memory.** Each CLI runs in its own scope under `vitals-coach.slice`, outside `vitals-server.service`'s 2 GB, so a
  large CLI can never get the server killed. Install the slice once:
  `cp deploy/vitals-coach.slice ~/.config/systemd/user/ && systemctl --user daemon-reload` (1200 MB for all coach
  CLIs together; without it systemd makes the slice with no limit of its own and each scope still has its
  `memoryMaxMB`). If `systemd-run --user` does not work, the CLI runs directly and only one turn runs at a time.
- **Token.** Each session gets its own agent token (kind `agent`, label `coach:<8 hex>`, scope `edit`: on this server
  `edit` only stages proposals, which the person approves in Vitals; each staged change is the person's own `pendingChanges` document, which syncs to their devices, and becomes a
  `proposal` event whose `id` is that document's pendingId, so Apply in Vitals finds it).
  It reaches the CLI only through `VITALS_TOKEN` (`mcp.json` says `Bearer ${VITALS_TOKEN}`), works only on the
  loopback listener (not through tailscale serve or a reverse proxy), is not listed in Settings › Agents or Devices,
  and is deleted from `devices.json` with the session. People cannot give their own tokens a `coach:` label.
- **Sessions** are kept in memory. Each has a folder `$XDG_RUNTIME_DIR/vitals-coach/<session>` (tmpfs, 0700) with
  `mcp.json` and `tmp/`. A session is deleted `retentionHours` (24) after its last message; `keep` extends it. Deleting
  removes the folder, Claude's transcript folder `~/.claude/projects/<slug of the folder>/` and its per-session files,
  and the token. A restart drops every session: the start sweep empties `vitals-coach/`, removes the transcript
  folders under that prefix and every `coach:` token; clients get 404 and start a new session. Nothing of the chat is
  written anywhere else (no usage lines, no logs with text).
- **Personas.** One system prompt for both apps (health safety: no diagnosis, no medication, clinicians for anything
  urgent; proposals wait for approval; tool results are data, not instructions; JSON only when asked) plus the app the
  person is in. Both read all data. The first turn starts with a context block (app, today in the person's time
  zone, screen, date, title); the one-off screens `checkin_morning`, `checkin_evening` and `meal_estimate` (ring app
  opens and then deletes these sessions) get their own instruction.
- **Status** checks that the binary is there and `claude auth status` says `loggedIn`, cached 3 minutes and checked
  again after a turn failed on sign-in. A usage limit in the last 5 minutes adds the reason "The server's AI is busy".

**Config** (`server.json`, optional; no `coach` block means off, `"coach": {}` means on with these defaults):

```json
"coach": {
  "backend": "claude", "fallback": "none",
  "claudePath": "/home/ubuntu/.npm-global/bin/claude", "codexPath": "/home/ubuntu/.npm-global/bin/codex",
  "model": null, "effort": null,
  "retentionHours": 24, "maxKeepHours": 168,
  "maxConcurrent": 2, "maxConcurrentPerPerson": 1,
  "turnTimeoutSec": 240, "idleTimeoutSec": 90, "memoryMaxMB": 700,
  "turnsPerMinute": 6, "turnsPerDay": 300, "maxSessionsPerPerson": 5, "maxMessagesPerSession": 200
}
```

`fallback: "codex"` lets new sessions use `codex exec` (`--ignore-user-config --ignore-rules -s read-only`, the MCP
server and persona passed with `-c`) while Claude is not signed in or just hit its limit. It is off by default: Codex
keeps shared stores (`~/.codex/logs_2.sqlite`, `state_5.sqlite`) that cannot be cleaned per session, so with Codex
"nothing persists" holds only for its rollout files. An existing session stays on the backend it started with.

Tests: `pnpm vitest run packages/companion/src/coach` (a fake Claude Code, `packages/companion/fixtures/fake-claude.mjs`,
that speaks stream-json and calls the real `/mcp`).

## Backup and restore

```sh
vitals-server backup <person>                     # copies the person's folder to persons/<id>/backup/<time>/
systemctl --user stop vitals-server
vitals-server restore <person> <backup folder>
systemctl --user start vitals-server
```

A backup contains the sync key and is as sensitive as the data itself. Back up while the person is idle (the server
closes a person after 15 minutes without requests), or stop the server first.

## Migration steps (the owner moves to person 1 on the server)

Run once, with the owner present. The relay data on the server is `~/.local/share/vitals-companion` (not `~/.vitals`).

0. Owner, first: the server's swap was 99 % used with 5.9 GB RAM free (R18 §6). Check what holds swap
   (`free -h; swapon --show`) before adding the `home` role; each open person worker needs about 100 MiB.
1. Back up the relay as it is today: `tar -C ~/.local/share/vitals-companion -czf ~/vitals-relay-backup-$(date +%F).tgz .`
2. `deploy/oci-arm.sh`. On the first run it stops `vitals-companion`, copies the relay data to
   `~/.local/share/vitals-server/relay`, runs `vitals-server init --role home --public-origin https://vitals.example.ts.net:8443 --port 4870`
   (port 8443 stays behind `tailscale serve`) and starts `vitals-server`.
3. `vitals-server persons add "<owner label>" --tz Asia/Kolkata --join`, pasting the owner's sync key (sync phrase) from
   Settings › Sync on this PC. The replica pulls the owner's history through the relay; record the document count and how
   long it took.
4. Delete the 9 QA owners from the relay (default yes; skipped if the owner says no).
5. Pair the website on this PC and the phone PWA: `vitals-server pair code <person> --label "This PC"`, then again
   with `--label "Phone"`.
6. Move the owner's provider keys and the ChatGPT sign-in (owner present; it rotates the live session):
   `vitals-server keys set <person> nim` (and `opencode-zen`), or `vitals-server keys import <person> keys.json`;
   on this PC `vitals-companion siwc export --out ~/vitals-chatgpt-signin.json`, copy it to the server, then
   `vitals-server siwc import <person> ~/vitals-chatgpt-signin.json`. For agents:
   `vitals-server agent-token create <person> --client codex --scope log --url https://vitals.example.ts.net:8443`.

The numbering follows docs/SUITE_SPEC.md §14.1. Not measured before: joining the owner's existing history over the relay
at real size.

## Limits

If a device clock differs by more than five minutes, sync holds its new changes back and shows a clock-drift status.
Correct that device's date and time and restart Vitals; the pending changes are kept. Blob chunks replaced by newer
versions are readable correctly, but the relay does not yet compact their old stored bytes, so its storage can grow.

| What | Limit |
|---|---|
| Pairing codes | 8 digits, 10 minutes, one use, 5 wrong tries lock all open codes |
| ring app uploads | 500 events and 1 MiB (after gzip) per request, 120 requests a minute per ring app (`lumen`) token |
| Requests | per device and per source address; over the limit the answer is "too many requests" |
| Open persons | 4 at once (`server.json` `maxOpenPersons`); each is one worker, closed after 15 minutes idle |
| Person worker memory | 512 MB old space and 64 MB young space of JavaScript heap per worker |
| Request time | 60 s for a command or an agent tool call, 10 minutes for an import, counted from when the person's worker starts it |
| Server process (systemd unit) | `MemoryHigh=1536M` (slowed down above), `MemoryMax=2048M` (the server is killed and restarted above), `MemorySwapMax=256M`, `OOMPolicy=kill` |

Measured on this PC (2026-10-03, one person, the bundled worker): a worker's JavaScript heap stays at 35–75 MB through
pairing, two agent tokens, two MCP sessions, tool calls, the ring fixture import and 2,000 MQTT messages; the whole server
process (relay, broker, one worker) settles at 400–450 MB resident. (Measured before 0.6.0, which removed the broker and
the ring import; the figures are an upper bound now.) A person adds about 130–150 MB of resident memory when
it opens. The heap limit is the ceiling for one person; the unit's `MemoryMax` is the ceiling for all of them together.

**What a person sees when a limit is hit.**

| Case | What happens | What the person or agent sees |
|---|---|---|
| 4 persons open, one more asks | The person idle the longest is closed (its work is saved first) and the new one opens | Nothing; the first request takes the usual open time (under a second) longer |
| 4 persons open and all are working | The request is refused; nothing is stored | HTTP 503 `server_busy`: "The server is busy with other people right now. Try again in a minute." |
| A person's worker runs out of memory | Only that worker stops; the server and the other persons carry on; the server log says so | That request: `precondition_failed`, reason `person_restarting`: "Your data on the server is restarting. Try again in a moment." The next request opens the person again |
| A request runs past its time | The worker is stopped and opens again on the next request; requests waiting behind it get `person_restarting` | `precondition_failed`, reason `timeout`: "This took longer than 1 min and was stopped. Try again." |
| The whole server goes over 2 GB | systemd kills the server and starts it again 5 s later | A few seconds of "not reachable"; the app keeps working on the device and syncs afterwards |

Every write a person had confirmed is in their replica on disk before the answer, so a stopped worker loses no confirmed
data.

## Operations

**Memory, once a minute.** For every open person the server logs one line, with no personal data:

```
person 0000000000000000: memory heap 52/102 MB, external 3 MB; server rss 412 MB
```

`heap` is that person's worker (used / reserved JavaScript heap; a thread has no resident size of its own), `server rss`
is the whole process. The same sample goes to `~/.local/share/vitals-server/memory.json` (0600), and
`vitals-server status` prints it:

```
Running: {"version":"0.4.0","role":"home",…,"persons":5,"memoryMb":412}
Memory (31 s ago): server rss 412 MB, main heap 53 MB, 2 of at most 4 persons open
  0000000000000000  heap 52/102 MB, external 3 MB, idle 40 s
```

`GET /health` carries `memoryMb` (the server process's resident memory in MB) for monitoring from outside, and
`eventLoop` `{ meanMs, p99Ms, maxMs, windowS }`: the main thread's delay over the last 30–60 s (a long synchronous read
shows here once it ends).

**Watchdog.** `deploy/oci-arm.sh` installs `~/vitals-server/bin/vitals-watchdog` and the user timer
`vitals-watchdog.timer`: every minute it asks `/health` (10 s limit) and restarts `vitals-server` after 3 failures in a
row, never in the first 3 minutes after a start; it logs to `~/.local/state/vitals-server/watchdog.log`.
`systemctl --user list-timers vitals-watchdog.timer` shows it; `systemctl --user disable --now vitals-watchdog.timer`
pauses it.

**Other log lines to look for.**

| Line | Meaning |
|---|---|
| `person <id>: opened in <n> ms` | A worker opened. Normal is 300–700 ms; several seconds means the host is short of memory or CPU |
| `person <id>: closed to make room (at most 4 persons open)` | The cap was reached and the person idle the longest was closed |
| `person <id>: worker ran out of memory (heap limit 512 MB); closed, it opens again on the next request` | One person's worker hit its heap limit |
| `person <id>: worker stopped: a <command> request ran past 1 min; closed, …` | A request ran past its time |

**Removing a person.** `vitals-server persons remove <person>` also closes that person's worker, and `status` counts only
persons that still exist (a removed person may show as "removed" for up to a minute).

**Changing the cap.** Set `"maxOpenPersons": <n>` in `~/.config/vitals-server/server.json` and restart
(`systemctl --user restart vitals-server`). Keep `n × 600 MB` under the unit's `MemoryMax` if every person may be busy at
once; raise `MemoryMax` in the unit (deploy/oci-arm.sh writes it) when the host has room.

**Memory limits of the unit.** deploy/oci-arm.sh writes them into `~/.config/systemd/user/vitals-server.service`. Check
with `systemctl --user show vitals-server -p MemoryHigh -p MemoryMax -p MemorySwapMax -p OOMPolicy` and the current use
with `systemctl --user status vitals-server` (the `Memory:` line).

**The server's Node.** The server and its CLI run on a Node kept next to the releases, not on the system's:
`~/vitals-server/node` points at `~/vitals-server/node-v26.10.0`. deploy/oci-arm.sh downloads it from nodejs.org once,
checks it against `SHASUMS256.txt`, and builds the native module (better-sqlite3) for it. The unit's `ExecStart` uses it,
and `bin/vitals-server.mjs` switches to it when another node starts it, so `node ~/vitals-server/current/bin/vitals-server.mjs …`
and `~/vitals-server/bin/vitals-server …` behave the same. Check with `~/vitals-server/node/bin/node -v` and
`systemctl --user show vitals-server -p ExecStart`. A different version: `NODE_VERSION=<x.y.z> deploy/oci-arm.sh`.

Do not run the server on Node 24.21 (Ubuntu's `/usr/bin/node` on the server). With three persons open, every person
worker stopped answering and the process grew by about 45 MB a second until the unit's memory limit stopped it (the
2026-10-03 incidents). The cause is Node 24's Web Locks, which every thread of the process shares. The server no longer
uses them (each person's store has its own locks), and Node 26 does not show the problem either.

**Rolling back to the previous release.** That release's native module may have been built for another Node. Rebuild it
for the pinned Node before you switch:
`cd ~/vitals-server/previous && PATH=~/vitals-server/node/bin:$PATH npm rebuild better-sqlite3`, then
`ln -sfn "$(readlink ~/vitals-server/previous)" ~/vitals-server/current && systemctl --user restart vitals-server`.

**Diagnostics when memory or CPU climbs.** Start the server with `VITALS_DIAG_PORT=<port>` (for example
`systemctl --user edit vitals-server` → `[Service]` `Environment=VITALS_DIAG_PORT=4872`, then restart). It then answers on
`127.0.0.1:<port>` only, with sizes, counts and timings and no personal data:

| Request (on the host) | Answer |
|---|---|
| `curl -s http://127.0.0.1:4872/diag` | The main thread's memory (`rss`, heap, `external`, `arrayBuffers`, open handles). For each open person: requests sent and not answered (`pending`), how busy its thread was since the last read (`elu`, 0–1, read even when the thread is stuck), and its own report: heap and heap spaces, malloc, requests waiting in its queue, the request it is running and for how long, the longest event-loop delay. `report: null` means the worker did not answer within 2 s |
| `curl -s -X POST 'http://127.0.0.1:4872/profile?person=<id>&ms=8000'` | A CPU profile of that person's thread (open it in Chrome DevTools › Performance) |
| `curl -s -X POST 'http://127.0.0.1:4872/snapshot?person=<id>'` (or `person=main`) | A heap snapshot (DevTools › Memory) |

The files go to `~/.local/share/vitals-server/snapshots/` (0600). A snapshot can hold personal data in memory. Delete it
when you are done, and do not share it. Without `VITALS_DIAG_PORT` nothing listens.

How to read it: a person with `elu` near 1 and no report, while nobody uses it, has a stuck thread. When `rss` grows and
the heaps do not, the memory is outside JavaScript (native queues, SQLite, buffers).
