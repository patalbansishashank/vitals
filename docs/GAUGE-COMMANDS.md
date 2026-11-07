# Ring app commands

Vitals asks ring app to do things through the person's home server: set the Reels limit and apps, start, pause, resume
or stop a workout recording, measure heart rate now, sync the ring now (r068 B2), and check for updates. The binding design is energy SPEC §A.4
(`vitals-research/energy/SPEC.md`). A command is a request, never data: it carries no health values.

## Transport

The ring app uses a **hold-open poll**. It asks `GET /v1/lumen/commands?wait=25`. The server answers at once when a command is
waiting; otherwise it holds the request for up to 25 s and then answers an empty list. The the ring app then asks again at once,
but never sooner than 2 s after its last poll. An idle phone makes about 2.4 requests a minute. If the device run shows
a battery cost, `wait=0` every 60–120 s is a drop-in fallback that needs no protocol change.

On the same phone, workout commands can go **local** through ring app's broadcast API (`WorkoutControlReceiver`) via the
`VitalsGauge` plugin. Everything else always goes through the server.

## Auth

| Side | Token | Routes |
|---|---|---|
| Vitals | device token (`kind: device`) | `/v1/gauge/commands*` |
| ring app | lumen token, bound to one installation | `/v1/lumen/commands*` |

The two bearer checks are joined only by `personId`. No token is ever forwarded or put inside a command.

- An agent or lumen token on a Vitals route gets `403 wrong_kind`.
- A device token on a ring app route gets `403`.
- When the lumen token is revoked, ring app gets `401`, marks the pairing `needsRepair` and stops its loop.
- (r070) Target: the command's `installationId`; without one, the ring app engine embedded in the Vitals app (paired with `POST /v1/lumen/pair-device`, `app: vitals`) once one exists, the standalone ring app before that. `GET /v1/gauge/commands/state` describes the same installation and says its `app`. The embedded engine does not list `update.check` in its capabilities (its update answer is `updates_in_vitals`).

## Commands

| Type | Payload | TTL | Terminal result |
|---|---|---|---|
| `reels.set` | at least one of: `dailyLimit` 1–500, `apps` (`instagram`, `youtube`), `enabled`, `countdownSeconds` 3–30 | 24 h | `done {applied}` |
| `workout.start` | `type` (`walk`, `run`, `cycle` or `other`), `useGps?` | 60 s | `done {state, sessionId, type, startedAt}` |
| `workout.pause`, `workout.resume` | `sessionId?` | 2 min | `done {state}` |
| `workout.stop` | `sessionId?` | 30 min | `done {state:'idle', sessionId}` |
| `hr.measure` | none | 60 s | `running`, then `done {bpm, observedAt, uploaded}` |
| `ring.sync` (ring app 2.8.4+) | none | 2 min | `running`, then `done {syncedAt, complete, uploaded}` |
| `update.check` | none | 1 h | `done {outcome, versionName?, versionCode?}` |

- A client may ask for a shorter TTL (`ttlS`) but never a longer one; a longer one is cut back to the default.
- If a `sessionId` is given while a *different* recording is active, the command is `rejected: wrong_workout`. A late
  stop therefore never ends a newer workout.
- Workout commands are idempotent by state: asking for the state ring app is already in is `noop`.
- The full result-code table is in SPEC §A.4 item 9.
- ring app's `CommandExecutor` and Vitals' `GaugeWorkoutAck` map ring app's results to the same ack shape.

## Lifecycle

```
queued → delivered → running → done | failed | rejected | noop
                               (and expired, superseded, cancelled)
```

- **Idempotency.** The client's `id` (16–40 URL-safe characters) is the key.
  - Posting the same `id` with the same body returns the stored command (`200 deduped`).
  - Posting the same `id` with a different body is `409 id_reused`.
  - A pending `hr.measure`, `ring.sync` or `update.check` is returned instead of a second one (`coalesced`). The new request id is
    kept as a durable alias of the command it joined (r063 A35): retrying it, `GET /v1/gauge/commands/{id}` and
    `DELETE` answer that command whatever its state, even after the first response was lost and the command finished,
    and the id can never name a different command (`409 id_reused`). Aliases are purged with their command.
  - A new `reels.set` marks older pending ones `superseded`.
- **Delivery and acks.** Delivery is at least once, with a 30 s lease: a command that is not acked within the lease is
  offered again. Terminal acks are write-once; a conflicting one gets `409 already_terminal`.
- **Running too long.** A `running` command with no terminal ack becomes `failed: timeout` after 90 s for `hr.measure`,
  3 min for `ring.sync`, and 30 s for the other types.
- **The data before the answer (r068 B2).** After a reading or a ring sync, ring app drains its hub outbox (up to 40 s)
  before it acks `done`, so the device that asked re-reads and finds the new data. `uploaded: false` means the upload
  is still waiting on the phone (the regular upload carries it). `ring.sync` dials a ring that dropped (never one the
  person disconnected) and waits up to 90 s for the ring's own end of sync (`complete: false` if it stalled).
- **Expiry.** The server sets `expiresAt` from its own clock. Every poll answer carries `now`, and ring app refuses a
  command past `expiresAt` by that clock. A sweep runs every 30 s and marks unacked commands `expired`.
- **ring app's answer wins.** If ring app acks a command it held after the sweep has marked it expired, ring app's ack replaces
  the sweep's.
- **Retention.** Terminal commands are kept for 30 days.
- **ring app's ledger.** ring app's `CommandLedger` (`filesDir/command_ledger.json`) keeps the last 200 ids, or 7 days. A
  re-delivered id gets its stored ack sent again. An id that started but never finished (the process died) is acked
  `failed: interrupted` and is not run again.

## Server API (`packages/companion/src/home/commands.ts`)

Commands are stored per person in `persons/<id>/commands.db` (WAL, mode 0600), separate from `lumen.db`.

| Route | Does |
|---|---|
| `POST /v1/gauge/commands` `{id, type, payload, occurredAt?, installationId?, ttlS?}` | `201 {command, online}`; `200` with `deduped` or `coalesced`; `400 bad_command`; `404 no_gauge`; `409 id_reused` or `ambiguous_target`; `429 too_many_pending` or `rate_limited` |
| `GET /v1/gauge/commands/{id}?wait=&since=` | `{command, online, terminal}`; holds up to 25 s while the state equals `since` |
| `GET /v1/gauge/commands?limit=&type=&state=` | recent commands, newest first |
| `DELETE /v1/gauge/commands/{id}` | cancels while `queued`; otherwise `409 already_delivered` |
| `GET /v1/gauge/commands/state` | `{paired, installationId, online, lastPollAt, appVersion, capabilities, reels, recording, serverNow}` |
| `GET /v1/lumen/commands?wait=0..25` | `{now, personId, maxWaitS, commands:[{id, seq, type, payload, issuedAt, expiresAt, attempt}]}` |
| `POST /v1/lumen/commands/{id}/ack` `{status, code?, detail?, result?}` | `204` |
| `POST /v1/lumen/commands/state` `{appVersion, capabilities, reels?, recording?}` | `204` |

- `online` means ring app polled in the last 55 s. A ring app that polls again after a longer gap is logged with the gap
  (`commands: Gauge polling again after N s`).
- **Limits:**
  - payloads and results: 2 KiB each
  - pending commands: 20 per person
  - enqueues: 30 a minute per Vitals device
  - ring app polls: one per 2 s
  - the existing per-device limiter applies as well
- **Logs** carry ids, types and counts only.
- **Preflight** on the Vitals paths allows `GET, POST, DELETE` and the headers `authorization, content-type`.
- `home.ts` checks these paths before the `gauge` and `lumen` routes, whose prefixes would otherwise take them.

## Vitals (`src/net/gaugeCommands.ts`, `src/platform/gaugeLocal.ts`, `src/state/gaugeCommands.ts`)

- **`useGaugeLink()`** returns `{online, lastPollAt, appVersion, reels, recording, capabilities, paired, local,
  transportFor}`.
- **`useGaugeCommand(type)`** returns `{send(payload), retry(), pending, last}`. A command view is
  `{id, type, state, code?, result?, expiresAt?, via, online?}`.
- **Ring screens (r068 B2).** "Refresh ring data" re-reads at once and sends `ring.sync` when ring app reports it; the
  bar's subtitle says "Sent to your phone…", "Syncing the ring…", or why not. "Measure now" says "Sent to your
  phone…", "Measuring on the ring…", then the reading. A command the phone never took says "Your phone didn't answer:
  open ring app on the phone, then try again". A finished `hr.measure`, `ring.sync` or `workout.stop` asks every screen
  again.
- **Choosing the transport (`transportFor`).** A workout command goes `local` only when all of these hold:
  - the `VitalsGauge` plugin is there;
  - ring app is installed (`com.pulseloop`, or `com.pulseloop.debug` in a debug Vitals);
  - `CONTROL_WORKOUT` is granted;
  - `WORKOUT_STATUS` answers within 1.5 s.
- **Local timeout.** After a local timeout, Vitals asks for the status once and adopts the state it asked for if ring app
  has reached it. Otherwise it sends the command through the server with the same id.
- **No offline queue.** If the server cannot be reached, the command fails at once with `server_unreachable`.
- **Older Android shells** have no plugin, so Vitals uses the server.
- **The manifest** adds the two `CONTROL_WORKOUT` permissions and a `<queries>` entry for both ring app packages.
  `ManifestPrivacyTest` allows exactly those additions.

## Ring app (`app/src/main/java/com/pulseloop/command/`)

- **`CommandChannel`.** `RingConnectionService` calls `startIn` and `stopIn`. The loop runs while ring app is paired and
  not `needsRepair`.
  - Client: OkHttp with the hub's settings (15 s connect, 60 s read, no redirects).
  - Errors back off from 2 s, doubling up to 60 s, with jitter.
  - A `personId` change ends the loop.
- **Three lanes** run concurrently, each in `seq` order:
  - `workout`
  - `ring` (`hr.measure`)
  - `app` (`reels.set`, `update.check`)
- **Wake holds (2.8.4, r068 B2).** The loop holds a partial wake lock through a backoff, the gap between polls, the
  admission of a delivered batch, and each command until its last ack (at most 4 min). It holds none while parked in
  the 25 s poll: the server's answer is a network packet, which wakes the phone. Before 2.8.4 a phone that dozed during
  a backoff (after a server restart, say) froze the loop inside a coroutine `delay`, and commands expired unseen.
- **`CommandPollWorker`** runs every 15 min as a safety net and makes one `wait=0` poll. While the always-on loop runs
  but no poll has answered for 3 min, it restarts the loop instead (2.8.4).
- **`CommandStateReporter`** posts ring app's state:
  - on start;
  - after every applied command;
  - when the Reels settings or the live workout change (debounced 2 s).

## Tests

- Server: `packages/companion/src/home/commands.test.ts`, and `node packages/companion/scripts/commands-e2e.mjs`
  against a real server process with a simulated ring app.
- Vitals:
  - `src/net/__tests__/gaugeCommands.test.ts`
  - `src/platform/__tests__/gaugeLocal.test.ts`
  - `src/state/__tests__/gaugeCommands.test.ts`
  - `VitalsGaugePluginTest`
  - `ManifestPrivacyTest`
- ring app: `app/src/test/java/com/pulseloop/command/`.
- Still to do: the emulator end-to-end run of §A.4 (ring app `.debug` paired to a local server, both transports, a
  battery reading over a day).
