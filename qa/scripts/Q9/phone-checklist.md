# Q9 · phone checklist: Lumen Health → oci-arm → Vitals, one night

For the owner (steps 1–4 on the phone and in Vitals) and the orchestrator (step 5). Nothing here is a secret; the
password is read off the screen once and typed into the phone, never written down here.

## 1. Before the night: the broker login (Vitals, paired with the owner's person)

Settings › Devices, card **Lumen Health over MQTT** › **Create broker login**. The "Shown once" block lists four
values; paste each into Lumen Health's broadcast settings:

| Lumen Health field | Value from the card | What it looks like |
|---|---|---|
| Address / server URI | `address` | `wss://vitals.example.ts.net:8443/mqtt` (scheme `wss`, port 8443, path `/mqtt`) |
| User name | `username` | `p<16 hex digits>-<n>` |
| Password | `password` | shown once; if lost, Remove login and create a new one |
| Base topic | `base topic` | `lumen-health/v1` (Lumen's default; leave it) |
| Client id | anything | e.g. `vitals-phone`; it does not identify you |

Then tick "I've pasted these into Lumen Health" and press Done. The same login can come from
`ssh vitals-server '~/vitals-server/current/bin/vitals-server.mjs mqtt add <person>'` (prints the values once).

If the history is not in Vitals yet, do the history import first (docs/SERVER.md "Phone setup", steps 1–3), then
switch on broadcasting in Lumen Health.

## 2. Right after pasting (phone on, ring on the finger)

| Look at | Expect |
|---|---|
| Lumen Health broadcast status | connected, no error |
| Vitals › Settings › Devices card (reload the page) | the login shows **connected**; "last event" has today's time; "today" lists streams with counts (heart rate first) |
| "set aside" row | absent, or 0 today. If it shows a count, press **See why** and note the reason |

`wrong_installation` right after a phone change means the login is pinned to the old phone: press **Allow a new
phone** on that login.

## 3. After one night (the morning after, phone has synced the ring)

| Look at | Expect |
|---|---|
| Devices card | "last event" this morning; "today" counts include **sleep** and **steps**; the ring line "Battery NN % at HH:MM · last data received HH:MM" (needs the server with the Q9 fix; server 0.4.0 shows no battery) |
| Today (website and the installed app) | the **sleep** row shows the night as `H h MM min · J-Style 2301` (or the ring's name) with **Correct**, and no hours field to type into |
| Progress › Steps | today's running total and active minutes |
| Progress › a sleep score (after switching "my scores: sleep" on in Settings › Devices) | the stage timeline of last night, bed and wake times |

If the night is wrong: **Correct** › hours and minutes › Confirm. The row then reads "corrected · <time>" with
"Use the device value again". A later resend from the phone does not undo it.

## 4. Nothing arrives

| Symptom | Check |
|---|---|
| card says "never connected" | address typed with `wss://` and `:8443/mqtt`; phone on the tailnet (Tailscale app connected) |
| "Bad user name or password" in Lumen | the password was mistyped; Remove login, create a new one |
| connected but no events | Lumen's broadcast switch on; the ring synced to the phone at least once since |

## 5. Assertions the orchestrator checks (website on the owner's paired browser, `?qa=1`)

Run in the page console (read-only hook) or through a playwright script; replace `<D>` with the wake date (yyyy-mm-dd).

| # | Assertion | How |
|---|---|---|
| A1 | the night is in the resolved view, from the device | `(await __vitals.read('bio.daily', { from: '<D>', to: '<D>' })).output.days[0].sleep` has `asleepH` > 0, `basis: 'device'`, `source` = the ring |
| A2 | its record came over the broker | `JSON.parse((await __vitals.read('data.export')).output.text).collections.bioRecords.filter(r => r.kind === 'sleep' && r.time.end.startsWith('<D>'))` has a record with `provenance.channel === 'mqtt:lumen'` (or `file:lumen_archive` / `file:lumen_cloudevents` for nights from the history import: same `record_id`) |
| A3 | Today shows it | `/today`: a button named "Correct sleep" exists and its row text contains "h" and the ring's name |
| A4 | the Devices card counts | `GET /v1/mqtt/status` with the page's token (Settings › Devices card shows the same): the login `connected: true` while the phone is online, `lastEventAt` on <D>, `eventsToday` has `sleep` ≥ 1 and `hr` > 0; `deadLetters.today` 0 |
| A5 | the same on the installed app | open the PWA, wait for sync (Settings › Sync "synced"), repeat A1 and A3 |
| A6 | server side, read-only | `ssh vitals-server 'journalctl --user -u vitals-server -n 50 --no-pager'` shows "broker login p…-1 connected", no "import of a broker message failed" |
