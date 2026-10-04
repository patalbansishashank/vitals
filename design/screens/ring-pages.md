# Screens — Ring (`/ring`) and Body signals (`/signals`)

> **Status:** v1, 2026-10-04 (plan 04 item 2, D4 by `L-AUDIT`). Builders: `L-PAGES`. Data and state contracts:
> `docs/SUITE_SPEC.md §15.2–15.3` (ring service, lease, `RingStatus`, `RingCandidate`, routes); this file decides how it
> looks, reads and behaves. Design language: `../DESIGN_DIRECTION.md`, `../COMPONENTS.md`, `../CHART_SPEC.md`,
> `../tokens.css`. Source of the audit: Lumen Health's Compose UI and phone captures of every main screen (captures are
> the owner's data and stay in the git-ignored `design/screens/private/`; never commit them).
>
> **Rules that bind every line below.** No ring brand name anywhere: the ring is a "J-Style 2301" (driver label) and the
> UI never shows a ring's advertised Bluetooth name. No ring ever asks for a password, key, code or "advanced" setting
> (PLAN decision 13): the only prompt a person may see is the operating system's own pairing dialog, announced first in
> plain words. Ring data is first-party and shared by default (decision 11). Colour belongs to data; chrome is
> achromatic; yellow is never used on these pages except the focus ring in dark mode and the now-hand.

---

## 1. Decisions in one page

| # | Decision | Why |
|---|---|---|
| D1 | **Two pages.** **Ring** is the device (connection, pairing, Check now, today's readings, sharing, ring settings). **Body signals** is what the ring measured over time (tabs Sleep · Heart and recovery · Activity, each with a Day / Week / Month / Year switch). Lumen's 5 tabs, pairing, onboarding, workout and ~13 settings screens fold into these two or are already in Vitals (§3). | Owner: "club pages together (one or two pages)". The split follows the two questions people bring: "is my ring working?" and "what did it see?". |
| D2 | **Navigation: a ring light in the top bar, not a sixth tab.** Every viewport, both modes, shows a `RingLight` (ring glyph + 6 px indicator light, §4.2) in the shell's top bar: on phones between the sync pill and the overflow ⋯, on desktop in the context bar left of the theme key. It is mounted by the shell (`Chrome.tsx`), never through a page's `TopBar.actions`; it opens `/ring`. Phones keep the five living tabs (IA §3.5: a sixth tab breaks the 5-slot tab bar at 390 px). Desktop rail is unchanged. Body signals is reached from the Ring page (header link and every today row), from Progress (its ring sections become one link card, §6.9) and from Today's signal tiles. | The plan asked for "a Ring entry in the main nav on phones". A top-bar key is better than a tab: it is on every screen in both modes, it carries the live state (connected / not / attention) at a glance, and it costs no tab. |
| D3 | **When the ring light shows.** Shown when the person has at least one ring source, or `platformCaps().installedApp` is true (Android and desktop apps exist for the ring). Hidden on the website and PWA with no ring and no Web Bluetooth; there Settings › Devices "connect a ring" still links to `/ring`, which explains the apps. | No dead key for people who will never own a ring; always present where the ring is the point. |
| D4 | **Lumen inspires the graphs only.** Kept ideas: heart rate as a line coloured by effort zone with resting heart rate marked; sleep as stage lanes with unknown time drawn as unknown and gaps left blank; stacked stage bars per night (new: Lumen only had totals); goals for steps, active minutes and active energy read together; a Day / Week / Month / Year switch with calendar-aligned windows, the future blocked, coverage stated ("5 of 7 nights"); missing days drawn as missing, never zero. **Changed form:** Lumen's three concentric activity rings and 270° gauges become printed **scale meters** (Vitals bans rings and gauges as decoration, DESIGN_DIRECTION §5); the idea "three goals at a glance" is kept. | Vitals' own design language (Braun/Ulm instrument). |
| D5 | **No per-ring differences in the UI.** Capabilities (which Check now keys exist, whether stress or temperature is measured) come from the driver; a missing capability hides its control. Nothing in the UI names a firmware quirk, handshake or bond. | Decision 13. |
| D6 | **Tier C signals** (heart-rate variability, blood oxygen, skin temperature, autonomic load) are shown as change from the person's own normal (COMPONENTS §13.14, SUITE_SPEC §4.4); absolute values appear only in table twins. Until a normal exists (14 nights) the chart shows the absolute line with "building your normal: 9 of 14 nights", as E29 does today. Ring-maker scores (its own sleep score, stress) appear only as "Your ring says …" when vendor scores are on (Settings › Devices), never in a primary position, never on a Vitals axis. | DESIGN_DIRECTION §10 naming; SUITE_SPEC §4.4. |

---

## 2. Routes, files and ownership

| Route | Page | Code (owner `L-PAGES`) |
|---|---|---|
| `/ring` | Ring | `src/features/ring/` (`RingPage.tsx`, `ConnectionCard.tsx`, `PairingFlow.tsx`, `CheckNow.tsx`, `TodayReadings.tsx`, `RingSettings.tsx`, `copy.ts`, `ring-page.css`) |
| `/signals?tab=sleep\|heart\|activity&period=day\|week\|month\|year&date=YYYY-MM-DD` | Body signals | `src/features/signals/` (`SignalsPage.tsx`, `PeriodBar.tsx`, `tabs/{Sleep,Heart,Activity}Tab.tsx`, `charts/*`, `models.ts`, `copy.ts`) |

- The E29 views in `src/features/living/progress/ring/` (`NightStages`, `DayLine`, `StepsBars`, `WorkoutsTable`, `ringData.ts`, `copy.ts`, `ring.css`) **move** to `src/features/signals/charts/` and are extended as §7 says; Progress imports nothing from there afterwards except the link card (§6.9).
- Shared, unchanged: `src/components/*` (Faceplate, KeyBank, Key, IconKey, Tabs, Switch, Notice, Readout, ReadoutStrip, Progress, Sheet, Dialog, EmptyStage, Engraved, KeyValueList), `src/features/charts/core/hooks` (`useElementWidth`), `src/features/charts/living/ScoreHistory`, `src/features/charts/components/DataTable`, `src/features/living/components/{TypedConfirmDialog,ScoreTile}`.
- Outside `L-PAGES`' paths (go through `.jobs/requests.md`): `src/app/routes.tsx` + `paths.ts` (two lazy routes and helpers, SUITE_SPEC §15.3), `src/app/shell/TopBar.tsx` / `AppShell.tsx` (mount `RingLight`, §4.2), `src/features/settings/devices/DevicesSection.tsx` (the "connect a ring" block becomes a link to `/ring`), `src/features/living/progress/*` (§6.9), Today's signal tiles (§6.9).
- URL is the state: tab, period and date live in the query, so Back walks through them and a link can open "last Tuesday's night". Defaults: `tab=sleep`, `period=day`, `date` = the reference day (§7.1).

### 2.1 What the pages need beyond SUITE_SPEC §15.2 (requested from `L-RINGSVC`; build the fallback if absent)

| Need | Requested field | Fallback in v0.5.0 if not delivered |
|---|---|---|
| which controls a ring supports | `RingStatus.capabilities?: { checkNow: Array<'hr'\|'spo2'\|'hrv'\|'skin_temp'>; vibrate: boolean; reset: boolean; intervals?: { minMin: number; maxMin: number; stepMin: number; toggles: string[] } }` | Check now offers heart rate and blood oxygen; Find my ring, Reset the ring and How often your ring measures are not built |
| Check now progress, live value, cancel, reasons | `checkNow(ringKey, metric, opts?: { signal?: AbortSignal; onLive?: (v: number) => void })`, `ceilingS` on the capability, error codes `no_steady_reading` · `not_worn` | indeterminate rule; countdown text from a fixed 30 s; no live value; **Stop** only discards the result (not saved); any rejection shows `error.message` |
| storing a spot check | the service stores the returned value as a spot sample (its choice of `recording_method`) | the page shows the value and says "not saved" is never claimed; it says "saved" only when the service confirms |
| live heart rate on the Ring page | `RingStatus.liveHr?: { bpm: number; at: Instant }`, read only while `/ring` is visible (§15.2) | the heart row shows "last reading 72 bpm · 13:30" |
| telling two identical rings apart in the scan list | `RingCandidate.ringIdSuffix?: string` (last 4 hex of the driver's ring id) | no suffix; the signal word and "yours" tell them apart |
| who read the ring last | `SourceBody.ble.lastSyncBy` through `bio.sources` (already in §15.2) | — |
| battery over time | a device-local battery log per ring | the battery row shows the current value and when it was read; no chart |
| Android battery restrictions | `shell().batteryOptimisation?(): Promise<{ restricted: boolean; openSettings(): void }>` | no line about it |

---

## 3. Lumen → Vitals mapping

Every Lumen surface, where it goes, and what happens to its parts. "Dropped" always says why.

| Lumen screen (route) | What it had | In Vitals |
|---|---|---|
| **Today** (`today`) | header pill "Connected · NN%"; Movement card (steps, distance, calories, 3 rings, Start workout); Sleep card (asleep, sleep index, stage lanes); Nutrition card; Heart rate card with Check now; VO2 max, SpO2, HRV, temperature, stress, fatigue, glucose, blood pressure tiles; "Your indices"; Customize (hide/reorder) | **Ring page**: connection card (§5.2) replaces the pill and Settings' hero card; **Today from your ring** rows (§5.4) replace the tiles (sleep, heart, activity, blood oxygen, temperature, heart-rate variability), each opening its Body signals tab; Check now (§5.3). Nutrition card → Vitals **Food** (exists). "Your indices" → Vitals **scores** (`ScoreTile`, exists). VO2 max → Vitals **Train/Progress** (exists). Fatigue, glucose and blood-pressure *estimates* → **dropped** (not measured by a sensor; Vitals shows no fabricated clinical numbers); a ring-maker value can still appear as "Your ring says …" when vendor scores are on. Customize → **dropped** (the Ring page is short and fixed; capability gating hides what a ring cannot measure). |
| **Vitals** tab (`vitals`) | overview cards per metric with sparkline + status word; Measure sweep; Day/Week/Month/Year | **Body signals › Heart and recovery** (§7.4). The Measure sweep → **Check now** on the Ring page. Lumen's status words from resting thresholds ("High" for exercise heart rate) → **dropped**; zones come from the person's age (§7.4.1). |
| Vital detail (`vitals/{metric}`) | one generic time-axis line per metric, hold-to-scrub tooltip, pinch zoom | **Body signals › Heart and recovery**, the metric's chart at the chosen period (§7.4); crosshair per CHART_SPEC §5.1; table twin. Pinch zoom → **dropped** (the period switch does that job). |
| Score detail (`score/{kind}`) | contributor list with weights | Vitals **score details** (exist, `ScoreDetail.tsx`); Body signals links to them. |
| VO2 check (`vo2-check`) | explainer + "Choose walk or run" | **Dropped**; Vitals' VO2 max estimate lives in Train/Progress. |
| **Sleep** tab (`sleep`) | night hypnogram lanes incl. Unknown; duration histogram for Week/Month/Year with ghost bars; stage totals; sleep index + contributors; session carousel; coach card | **Body signals › Sleep** (§7.3): night view (lanes, bed/wake, stage minutes, overnight heart rate, blood oxygen and temperature under the night on one time axis), stacked stage bars per night for Week/Month, monthly bars for Year, coverage line. Sleep index → Vitals **sleep score** (exists). Coach card → **dropped** here (the Coach has the data; the page states facts). Naps: shown as their own short session, labelled "nap", not added to the night's bar (§7.3.5). |
| **Activity** tab (`activity`) | 3 rings (steps, distance, calories); weekly goal card; workout list; Record activity; Log past activity | **Body signals › Activity** (§7.5): goal meters (steps, active minutes, active energy), steps by hour (Day) and by day (Week/Month), monthly averages (Year), workouts list per period with zone time. Distance stays a number, not a goal. Goals → Vitals **Plan/Goals** (exists; the meters read them). |
| Log past activity (`log_past_activity`) | type, start, duration | Vitals **Train › log a session** (exists). Body signals' Activity tab links "Log an activity" there. |
| Workout record (`record`) | live timer, HR, zone label, GPS | **Stretch goal, not in v0.5.0.** If built: a Ring-page sheet "Record a workout" using the live heart-rate stream; spec deferred. |
| Workout summary (`activity_detail/{id}`) | hero values, stats grid, map, splits, edit, delete | **Workout sheet** on Body signals (§7.5.4): time, duration, distance, avg/max heart rate, heart-rate line in zones, time in zone bars. Map and splits → **dropped** (no GPS in the web/desktop app; the ring has none). Edit/delete → Vitals' existing record correction (`Correction`). |
| Measurement modal / Check now | HR check on Today; sweep on Vitals; dormant modal | **Ring page › Check now** (§5.3): one key per measurement the ring supports (heart rate, blood oxygen, heart-rate variability, skin temperature), inline, no modal, with countdown, Stop, result and "saved". |
| **Pairing** (`pairing`) | brand tabs, model carousel, scan list (advertised name, family, signal dots), Connect ring, diagnostics toggle | **Ring page › pairing flow** (§5.5): no brand tabs and no model carousel (the driver recognises the ring); a scan list of rings by driver label + short id + signal; tap to connect; staged progress; the OS prompt explained. Diagnostics lines → **dropped** from the UI (the job log keeps them). |
| **Onboarding** (`onboarding`) | Welcome, Ring, Profile, Goals, Baseline | Ring step → **Ring page pairing flow** (also offered from Vitals' existing intake "Choose devices"). Profile, goals, baseline → **already in Vitals** (Your body, Plan, intake). |
| **Wearable** settings (`settings/wearable`) | status (connected, firmware, last synced), Sync now, Disconnect, Reconnect, Find ring, keep connected in background, battery-exemption link, battery history, **ring credential card**, Forget, factory reset | **Ring page** connection card and **Ring settings** (§5.7): firmware, keep connected (Android), battery history (small chart), Disconnect, Forget (with confirmation), Find ring and factory reset only when the driver has the capability. **The ring credential card is dropped: handled by the driver** (decision 13). |
| **Measurement Frequency** (`settings/measurement`) | all-day heart rate on/off + interval 5–60 min; SpO2, stress, HRV, temperature switches; Save | **Ring settings › How often your ring measures** (§5.7), shown only when the driver supports intervals; applies at once (no Save key), "sent to your ring" / "sent when it next connects". Not shown for the J-Style 2301 (its driver has no interval setting). |
| **Calibration** (`settings/calibration`) | blood-pressure cuff offset; blood-sugar offset | **Dropped.** Both "calibrate" estimates that no sensor measures; offsetting them to one reading makes a guess look like a measurement. |
| Coach (`coach`) | chat with ring context | Vitals **Coach** (exists); ring data reaches it by default (item 11). |
| AI Coach settings, Coach Check-Ins | provider keys, check-in schedule | Vitals **Settings › AI provider** and Coach (exist). |
| Nutrition (`nutrition`) + settings, meal analysis, barcode | food log, photo analysis, barcode | Vitals **Food** (exists). |
| Goals, User Profile, Physiology | goals, age/sex/height/weight; physiology flags (athlete, altitude, beta-blockers, lung condition) that silenced Lumen's heart-rate and SpO2 alarms | Vitals **Plan/Goals** and **Your body** (exist). Body signals reads age for heart-rate zones from Your body. The physiology flags are **not needed**: Vitals raises no heart-rate or SpO2 alarms. Lumen wrote profile and step goal to the ring; Vitals does not (no ring feature depends on it). |
| Low-battery alerts, check-ins after a sync | notifications at 20 % and 10 %; Coach check-in when history lands | Android app notifications (SUITE_SPEC §15.7: "Ring battery low" at 15 %, "Ring disconnected"); Coach check-ins stay the Coach's. |
| Health Connect | export ring data to Health Connect | **Dropped for v0.5.0** (on request; the Android app can add it later). Imports of Health Connect files stay in Settings › Devices. |
| Strava | upload workouts | **Dropped.** |
| Live Data Broadcast (MQTT) | publish live ring data | Covered: Vitals' optional MQTT bridge (Settings › Devices, `MqttCard`) stays (decision 8). |
| Privacy & Data | export, import, reset, unpair | Vitals **Settings › Your data** (exists); unpair → Ring settings › Forget. |
| Debug | logs, packets | **Dropped** from the UI (job log; never shows auth bytes). |
| About | version | Vitals **Settings › About** (exists). |

---

## 4. Shared pieces

### 4.1 The two layouts

| Width | Ring page | Body signals |
|---|---|---|
| 390 (phone) | one column, 16 px gutters; faceplates stacked in the order of §5.1 | tab list sticky under the top bar; period bar below it; one chart per faceplate |
| 768 (tablet) | one column, max 640 px, centred | as phone, charts get the full 736 px |
| 1440 (desktop) | two columns inside `--lm-content-max`: left 7/12 = connection card(s) (one per ring), Check now, today rows; right 5/12 = sharing, ring settings | tabs and period bar in one toolbar row; charts full width in a 12-col grid; secondary charts pair up 6/6 (e.g. blood oxygen next to temperature) |

Both pages use `Page` + `TopBar` (title "Ring" / "Body signals", display width 24/30 px) and `Faceplate` panels; no
nested cards; structure inside a faceplate is hairlines and spacing.

### 4.2 `RingLight` (top bar, D2)

An `IconKey` 44×44 touch / 32×32 pointer, glyph = the ring mark (outline ring, 20 px grid, 1.5 px stroke; the Vitals
logo's ring without the dot), plus a 6 px **indicator light** at its top-right:

| Ring state (the worst of all known rings, worst first: error · Bluetooth off · permission needed · stale › elsewhere › idle · searching · connecting › syncing › connected) | Light | Accessible name |
|---|---|---|
| `connected`, `syncing` | ink, solid (`syncing`: 1.2 s opacity pulse 100→40 %, none under reduced motion) | "Ring: connected" / "Ring: reading" |
| `elsewhere` | half-filled dot (left half ink) | "Ring: connected to <device>" |
| `idle`, `searching`, `connecting` | hollow | "Ring: not connected" |
| `error`, `bluetooth_off`, `permission_needed`, stale (last sync > 24 h) | `--lm-caution` small triangle mark instead of the dot | "Ring: needs attention" |
| no ring, `unsupported` | no light | "Ring" |

Yellow is not used (it means "selected" in Vitals). Pressed state: the Braun pressed key when the current route is
`/ring`. Tooltip on pointer: the accessible name.

### 4.3 Words used on both pages

| Concept | Say | Never say |
|---|---|---|
| the device | "your ring", or its label "J-Style 2301" | the advertised name, a brand, "wearable", "device" (except "this phone/computer" and the permission line "nearby devices", which repeats Android's own wording) |
| reading history | "reading your ring", "read 6 min ago" | "sync" alone in copy (the action key may say "Sync now", the existing Vitals term) |
| connected elsewhere | "Connected to <device label>" | "lease", "central", "holder" |
| an estimate the ring makes | "Your ring says …" | its number as Vitals' value |
| a day with no data | "no data" | 0, "—" inside charts |
| unknown sleep stage | "unknown: the ring could not tell the stage" | folding it into light |

All copy goes in `copy.ts` per feature; sentence case; lowercase engraved labels; numbers with units after a thin
space; no exclamation marks; no "Oops".

---

## 5. Ring page (`/ring`)

### 5.1 Order (phone)

1. **Connection card** (§5.2), always first.
2. **Check now** (§5.3), when a ring is `connected` or `syncing` and supports at least one spot measurement.
3. **Today from your ring** (§5.4), when a ring source exists (even if the ring is not connected; data may come from
   another device through sync). Header link "All body signals ›" → `/signals`.
4. **Pairing flow** (§5.5) replaces 1–3 when there is no ring; otherwise it opens in place of the connection card after
   "Add another ring".
5. **Sharing** (§5.6): the master switch.
6. **Ring settings** (§5.7).

Sharing and Ring settings render only when at least one ring source exists.

Desktop: left column 1–3, right column 5–6 (§4.1).

### 5.2 Connection card

One `Faceplate`, header row: ring mark glyph (24 px, ink) · label ("J-Style 2301", 17 px, weight 600) · on the right the
state word with its indicator light (engraved, 13 px). Body: a `KeyValueList` of readouts and a key row.

```
┌ Faceplate ─────────────────────────────────────────────┐
│ ◯  J-Style 2301                         ● connected     │
│ ────────────────────────────────────────────────────── │
│ battery     ▮▮▮▮▮▮▮▯▯▯  72 %                            │
│ last read   6 min ago · 13:35                           │
│ on          this phone                                  │
│ ────────────────────────────────────────────────────── │
│ [ Sync now ]   [ Disconnect ]                           │
└────────────────────────────────────────────────────────┘
```

- **battery**: a 10-segment printed scale (segments 4 × 10 px, 2 px gaps, ink fill; empty segments are wells), value
  in wide tabular figures. ≤ 15 %: segments and value stay ink, a caution mark and "low · charge it soon" follow
  (amber `--lm-caution` mark + words; never red). Unknown: "battery not read yet".
- **last read**: relative time that ticks every 30 s ("just now" < 1 min, "6 min ago", "3 h ago", "yesterday 22:10",
  "Tue 1 Oct"), then the clock time. Reads `RingStatus.lastSyncAt`; when another device read it last (`lastSyncBy` on the
  ring's source doc, `bio.sources`), "6 min ago on <device label>".
- **on**: where the link is: "this phone" / "this computer" / "this browser", or the holder's label when `elsewhere`.
- **firmware** is not on the card (it is in Ring settings).

**States** (one row per `RingLinkState`, SUITE_SPEC §15.2, plus derived stale). Copy is final.

| State | State word + light | Body | Keys |
|---|---|---|---|
| `unsupported` (web/pwa without Web Bluetooth) | "can't connect here" · none | "This browser can't reach Bluetooth rings. Use the Vitals app on Android or on your computer, or open this site in Chrome on a computer. Your ring's data still shows here once another device reads it." | **Get the app** (→ downloads block / Settings › Install), **Import a file** (→ Settings › Devices) |
| no ring (any platform with `ble`) | — | pairing flow in place (§5.5) | — |
| `bluetooth_off` | "Bluetooth is off" · caution | "Turn on Bluetooth to reach your ring." | Android: **Turn on Bluetooth** (system request); desktop/web: no key, the line adds "in your computer's settings" |
| `permission_needed` | "needs permission" · caution | Android: "Vitals needs permission to find and connect to nearby devices. It doesn't use your location." Web: "Your browser needs your permission to connect. Choose your ring in the list it shows." | **Allow** (asks again); after a permanent denial: **Open app settings** |
| `idle` | "not connected" · hollow | last read and battery (last known, labelled "when last read") | **Connect** (primary), **Forget…** in Ring settings |
| `searching` | "looking for your ring…" · hollow | "Keep it close. If it doesn't appear, put it on its charger for a moment to wake it." after 15 s | **Stop** (calls `disconnect(ringKey)`, which also pauses auto-connect on this device; the card then shows `idle` with **Connect**) |
| `connecting` | "connecting…" · hollow | a 2 px `ProgressRule` at the top edge of the card (indeterminate) | **Stop** (as above) |
| `connected` | "connected" · ink | readouts | **Sync now**, **Disconnect** |
| `syncing` | "reading your ring · 34 %" · ink pulse | `ProgressRule` determinate, `value={syncProgress / 100}`; readouts stay | **Sync now** disabled with "reading…" |
| `elsewhere` | "connected to <device>" · hollow ink | "Your ring talks to one device at a time. It's connected to <device label> since 09:12." | **Connect here instead** (→ `connectHere`; the card goes `connecting`; while a page-local "connect here pending" flag is set (set on the call, cleared when the state leaves `connecting`) the line reads "waiting for <device> to let go…") |
| stale (any state except `syncing`, and last read > 24 h ago) | as the state, plus caution mark | an `InlineWarning` line: "Not read since Tue 1 Oct. Days after that will be filled in when it next connects." (no claim about how long the ring keeps data) | as the state |
| `error` | "couldn't connect" · caution | the service's plain message (`RingStatus.error.message`); for not-found with no lease: "Your ring may be connected to another app or phone. Close it there, then try again." | **Try again**, **Forget…** link |
| sync failed (connected but last read errored) | "connected" · ink | `InlineWarning` "Couldn't read the latest data: <reason>." | **Try again** |
| low battery (≤ 15 %) | unchanged | battery row shows the caution mark | — |

Motion: state changes crossfade the state word (150 ms); the progress rule follows CHART_SPEC §5.6; nothing else moves.

Several rings: one connection card per ring, ordered by last read; each card is collapsible to its header row except the
first.

### 5.3 Check now

`Faceplate` titled "Check now", engraved help "Hold still. Your ring measures for about 30 seconds." Below, a
`KeyBank` (single choice, pressed-key style) with one key per metric in `capabilities.checkNow` (fallback §2.1:
heart rate and blood oxygen): **heart rate · blood oxygen · heart-rate variability · skin temperature**
(`checkNow(ringKey, metric)`), then the **Start** key (normal key, not yellow). While the ring is `syncing`, **Start**
is disabled with "reading your ring first".

| Phase | Shows |
|---|---|
| ready | the KeyBank + **Start**; under it the last spot value of the chosen metric: "last check 72 bpm · 09:14" |
| measuring | **Start** becomes **Stop**; a 2 px `ProgressRule`, determinate over `ceilingS` when the service gives it, else indeterminate with "measuring · about 30 s"; with `onLive` heart rate shows the live value as a wide readout ("— bpm" before) |
| result | readout "71 bpm" (wide, 32 px) + "13:41" and "saved" only when the service confirms it stored the value (§2.1) + for tier C metrics "change from your normal: +3 ms"; stays until the next start or leaving the page |
| no steady reading | `InlineWarning` "No steady reading. Keep the ring snug and your hand still, then try again." + **Try again** |
| ring not on a finger (error code `not_worn`, §2.1) | "Your ring isn't touching your skin. Put it on snugly, then try again." |
| stopped | "Stopped. Nothing was saved." (returns to ready after 4 s; a late result is discarded) |
| not available (not connected) | the faceplate is hidden; the connection card's Connect is the way in |

Rules: one check at a time; switching metric while measuring is disabled; storing the value is the ring service's job
(§2.1), the page only shows what it returns; nothing is stored on stop or failure. `aria-live="polite"` announces the phase and result.

### 5.4 Today from your ring

A `Faceplate` titled "Today from your ring" with header link "All body signals ›". Not KPI tiles (DESIGN_DIRECTION
§5): a **channel list**, one 56 px row per signal, label left (engraved), readout right, a 16 px chevron; the row opens
its Body signals tab at `period=day`. Rows show only when the ring measures that signal.

| Row | Readout | Secondary line (13 px ink-2) | Opens |
|---|---|---|---|
| sleep | "7 h 12 min asleep" | "in bed 23:40 – 07:05 · 41 min unknown" (unknown only if > 0) | `tab=sleep` |
| heart | "resting 58 bpm" | "now 72 bpm" from `liveHr` while the page is visible and connected (§2.1); otherwise "last reading 72 bpm · 13:30" | `tab=heart` |
| heart-rate variability | "−6 ms from your normal" | "last night · tier C" | `tab=heart` |
| blood oxygen | "−1 % from your normal at night" | "last night · tier C" | `tab=heart` |
| skin temperature | "+0.3 °C from your normal" | "last night" | `tab=heart` |
| activity | three mini **scale meters** inline (steps, active minutes, active energy; §7.5.1 at 120 px wide, no numerals) | "6 420 steps · 34 active min · 280 kcal" | `tab=activity` |

- Reference day: sleep uses the reference night (§7.1); everything else the calendar day.
- Each readout is the **resolved** value (corrections win, SUITE_SPEC §14.6).
- Missing: the row stays, readout "no data yet today" in ink-3, no chevron change. Before the first read of the day
  with the ring connected: "reading…".
- Freshness: when the newest sample is > 3 h old, the secondary line ends with its age ("· 4 h ago").
- When vendor scores are on, a last row "your ring says" lists the ring's own scores (sleep score, stress) as text with
  "(their estimate)". Never on top.

### 5.5 Pairing flow (no ring, or "Add another ring")

Inline in the page (no modal, no separate route). Three steps in one faceplate titled "Connect your ring"; a step
indicator is not shown (it is short).

**Step 1 — before scanning**
> **Connect your ring**
> Put the ring on your finger or its charger and keep it near this phone. If another app is connected to it (for
> example the ring's own app), close that app first: a ring talks to one device at a time.
> [ Look for rings ]

Web/desktop add: "Your browser will show a list of nearby devices. Choose your ring there." (Web Bluetooth's own
chooser, or on desktop the in-app list fed by `select-bluetooth-device`.)

**Step 2 — scan list** (`scan()` → `RingCandidate`s; Android and desktop show this list; on the web the browser's
chooser replaces it)

```
 looking for rings…                                   [ Stop ]
 ────────────────────────────────────────────────────────────
 ◯  J-Style 2301 · ending 4F2A          near   ▮▮▮  ›
 ◯  J-Style 2301 · ending 91C0          far    ▮▯▯  ›
 ────────────────────────────────────────────────────────────
 Not seeing yours? Tap the ring or put it on its charger to wake it.
```
- Row: ring glyph, `label` (driver label) + "· ending " + `ringIdSuffix` when the service gives it (§2.1; so two identical rings differ), signal
  as a word and a 3-step meter (near: rssi ≥ −65; close: −80 ≤ rssi < −65; far: rssi < −80; no rssi: no meter and the
  word "found"), chevron. A ring the person already has shows
  "yours" instead of the signal word. 56 px rows, whole row is the target.
- Order: known rings first, then strongest signal; the list never reorders under the finger (new rows append; order is
  recomputed only when the list has been still for 2 s).
- Only rings a driver recognises are listed; never the advertised name; never unrelated Bluetooth devices.
- Timeout 30 s → the list stays, the header says "Stopped looking." with **Look again**. Empty after 30 s:
  "No rings found. Check it's charged and close to this phone, close any other app using it, then look again."

**Step 3 — connecting** (after a tap; `pair(candidateId)`)

| Stage | Line | |
|---|---|---|
| connect | "Connecting to J-Style 2301…" | indeterminate rule |
| OS prompt (Android bond, when the driver needs it) | announced **before** it appears: "Your phone may ask to pair with the ring. That's expected: tap Pair." | — |
| set up | "Setting up…" (the driver's handshake; never described) | indeterminate |
| first read | "Reading what your ring has stored · 34 %" | determinate |
| done | "Connected." then the normal Ring page with the connection card; `toast('Your ring is connected')`. The first read goes on as `syncing` | — |
| failed | "Couldn't connect. Keep the ring close and try again." + **Try again** · **Choose another ring** | — |

The first read can take minutes; the person may leave the page: the read continues (the ring service owns it) and the
`RingLight` light pulses.

### 5.6 Sharing (item 11 master switch)

`Faceplate` "Sharing", one `Switch` row (52 px): **Use my ring data in my plan and Coach**. Under it, ink-2 13 px:
"Your ring data is used for your plan and scores, and the Coach and your AI tools can see it. Turn it off here or per
signal in Settings › Devices." (SUITE_SPEC §15.2.) States: on / off / **some** (any other mix: the switch shows **off**, the line
reads "Some of it is shared." + link "Choose in Settings › Devices"; turning it on applies the ring defaults). Toggling runs `bio.setRingSharing` with the normal undo toast.
The one-time notice from the `biometrics.ringDefaults` migration shows here as an info `Notice` above the switch:
"Your ring data is now shared with your plan and Coach. You can turn that off here." with **OK**.

### 5.7 Ring settings

`Faceplate` "Ring settings" (per ring when several). Rows, in order; a row whose capability is missing from `RingStatus.capabilities` (or all of them while that field does not exist, §2.1) is absent:

| Row | Control | Notes |
|---|---|---|
| firmware | the version as the ring reports it, or "read when connected" | read-only |
| keep my ring connected (Android app) | `Switch`, on by default | help: "Stays connected in the background. Android shows a small notification while it is." When `shell().batteryOptimisation` exists (§2.1) and Android restricts the app: a line "Android may pause Vitals in the background." + **Allow** (system screen). |
| keep running in the tray (desktop app) | link to the tray setting text "Vitals stays in the tray when you close the window." | read-only line; the switch is the tray's |
| how often your ring measures | `Switch` "all-day heart rate" + `ScaleSlider` 5–60 min (driver's range and step), switches for blood oxygen, stress, heart-rate variability, temperature (each only if supported) | applies at once; status "sent to your ring" / "sent when it next connects". Hidden for the J-Style 2301. |
| battery over time | only when a battery log exists (§2.1): a 64 px line, 0–100 %, last 7 days, gaps for no readings, 15 % hairline labelled "low"; "Not enough readings yet." | otherwise the row is absent |
| find my ring | **Vibrate** key | only with the capability |
| disconnect | **Disconnect** | stays known; auto-connect paused on this device (SUITE_SPEC §15.2) |
| forget this ring | **Forget this ring…** (danger key) → `TypedConfirmDialog`: title "Forget J-Style 2301?", body "Vitals stops connecting to it on all your devices. The data it already gave stays.", typed word "forget", key **Forget ring** | `forget(ringKey)` |
| reset the ring | **Reset the ring…** → confirmation "This erases everything stored on the ring itself. Vitals reads it first. You'll connect it again afterwards." | only with the capability; not the J-Style 2301 |
| add another ring | **Add another ring** | opens §5.5 |

There is **no** credential, password, key, "advanced", calibration or per-firmware row (decision 13).

### 5.8 Ring page states matrix (for the tests)

| State | 390 | 768 | 1440 |
|---|---|---|---|
| unsupported | card with Get the app + Import; Today rows, Sharing and Settings if a ring source exists from elsewhere | same | left column card; right column Sharing (if a ring source exists) |
| no ring | pairing step 1 only | same | pairing spans both columns |
| bluetooth off / permission needed | card + caution light in `RingLight` | same | same |
| searching / connecting | card with progress rule | same | same |
| connected / syncing | card, Check now, Today rows, Sharing, Settings | same | two columns |
| elsewhere | card with Connect here instead; no Check now | same | same |
| stale | card + warning line; Today rows show ages | same | same |
| error | card with message + Try again | same | same |

Both themes: the battery scale, light and progress rule use ink tokens that flip; check contrast of ink-3 secondary text
(4.7:1 on face) in both.

---

## 6. Body signals page (`/signals`)

### 6.1 Purpose and entry

What the ring (and any import) measured, over a day, a week, a month or a year. Read mode inside an Operate app: dense
charts, plain facts, no advice (the Coach gives advice). Entry: Ring page header link and today rows; Progress link card
(§6.9); Today's signal tiles; Settings › Devices "see the data". Exit: score details (sleep score, recovery), Train's
log, the workout sheet, Ring page (empty states).

### 6.2 Anatomy

```
┌ top bar: ‹ Body signals                          [sync] [ring light] [⋯] ┐
├ tabs (sticky): [ sleep ] [ heart and recovery ] [ activity ]              ┤
├ period bar (sticky): [day|week|month|year]   ‹  Night to Sun 4 Oct  ›  today ┤
├ Faceplate: main chart of the tab (§7)                                      ┤
├ Faceplate(s): secondary charts                                             ┤
├ Faceplate: numbers for the period (readout strip + table)                  ┤
└ source line: "From J-Style 2301 · read 6 min ago" · tier note              ┘
```
- **Tabs**: the `Tabs` component (roving tab index, arrow keys), labels "sleep", "heart and recovery", "activity"
  (engraved lowercase). At 390 the three fit (they are short); no scrolling tab rail.
- **Period bar** (`PeriodBar.tsx`, §7.1): a `KeyBank` (day · week · month · year, radio semantics) and a date navigator.
  At 1440 tabs and period bar share one toolbar row (tabs left, period right).
- **Source line** at the foot of each tab: which sources fed the shown period ("From J-Style 2301 and an Apple Health
  import"), last read time, and for heart-rate variability, blood oxygen and temperature the tier note "tier C: shown
  as change from your own normal".

### 6.3 States (whole page)

| State | What shows |
|---|---|
| no data ever, no ring | `EmptyStage` (perforated grid) "Nothing measured yet." / "Connect a ring or import a file to see your sleep, heart and activity here." **Connect a ring** (→ `/ring`) · **Import a file** (→ Settings › Devices) |
| no data in this period | per chart: the frame and axes stay, missing marks in every slot, one line over the plot "No sleep recorded this week." (wording per tab); the readout strip shows "no data" |
| ring known but not read since before the period | the line adds "Your ring hasn't been read since Tue 1 Oct." + **Open Ring** |
| loading (first) | each faceplate reserves its chart height and shows "reading…" engraved in the middle; no skeleton, no layout shift |
| loading (period change) | previous frame stays at 40 % with a 2 px progress rule at the top of the faceplate (CHART_SPEC §5.6) |
| failed | "These readings couldn't be loaded." + **Try again** inside the faceplate |
| syncing in the background | the source line reads "reading your ring · 34 %"; charts update in place when records land (no flash) |
| unknown sleep stages | §7.3 rules; never folded into light |
| missing days | missing marks (§7.2), excluded from every average, coverage counted in the header |

### 6.4 Layout per width

| | 390 | 768 | 1440 |
|---|---|---|---|
| main chart height | 180 | 220 | 260 |
| secondary chart height | 120 | 140 | 160 |
| overnight lanes (sleep day) | 56 each | 64 | 72 |
| night channel stack | exempt from "main chart height": stage rows + lanes + axis | | |
| secondary charts | stacked | stacked | two per row (6/6 columns) |
| y tick column | 26 px | 32 px | 32 px |
| readout strip | 2 per row | 4 per row | one row |

### 6.5 – 6.8 Tabs

The three tabs are specified chart by chart in §7.3 (sleep), §7.4 (heart and recovery) and §7.5 (activity). Order of
faceplates per tab and period:

| Tab | Day | Week / Month | Year |
|---|---|---|---|
| sleep | night summary strip → night stages + overnight lanes (one crosshair) → stage minutes table → naps | stacked stage bars → when you slept → numbers | monthly stage bars → numbers |
| heart and recovery | heart rate through the day → heart-rate variability last night → blood oxygen at night → skin temperature at night → your ring says (vendor, if on) | heart rate per day → resting heart rate → heart-rate variability → blood oxygen per night → skin temperature per night | the same five at monthly points |
| activity | goal meters → steps by hour → workouts today → numbers | steps per day → active minutes per day → workouts list → numbers | steps per month → workouts per month → numbers |

### 6.9 Links from the rest of the app (requests, not `L-PAGES` files)

- **Progress**: the E29 ring sections (night stages, steps, workouts) are replaced by one faceplate "Body signals" with
  three readouts (last night asleep, resting heart rate, steps today) and **Open body signals ›**. The signals strip
  (`SignalsSection`) stays as it is.
- **Today**: tiles that show a ring signal open `/signals?tab=…&period=day`.
- **Score details** (`ScoreDetail.tsx`): the night-stages and day-line views they embed import from
  `src/features/signals/charts/` after the move.
- **Settings › Devices**: "connect a ring" block becomes one row "Your ring" → `/ring`; each ring source row gains
  "see the data" → `/signals`.

---

## 7. Charts (builders follow this directly)

All charts are SVG in the Living idiom (E29 `RingViews`, `ScoreHistory`): `useElementWidth` for width, printed ticks,
1 px solid hairline grid (`--lm-chart-grid`), 11 px condensed tick text in `--lm-chart-tick`, a `role="img"` summary,
a **table** key that toggles the table twin (`TwinTable` / `DataTable`), a crosshair per CHART_SPEC §5.1 (pointer
hover; touch horizontal drag after 8 px, vertical scrolls the page; keyboard ←/→ one slot, ⇧ seven, Home/End; readout
mirrored to a polite live region). Tooltips never hold a value the table lacks.

### 7.1 Period model (`PeriodBar`, `models.ts`)

- **Windows** are half-open local-calendar ranges `[start, end)`: day = one calendar date; week = ISO week (Monday
  first; SUITE_SPEC §15.3); month = calendar month; year = calendar year. Use the person's time zone; a 23 h or 25 h day
  is still one slot.
- **Reference day.** Activity and heart: today. Sleep: a night belongs to the date it **ends** (wake date); the sleep
  tab's default date is the wake date of the newest main night that is ≤ today (so at 02:00 it shows last night, not an
  empty "tonight").
- **Labels.** day: "Today" / "Yesterday" / "Sun 4 Oct" (sleep: "Night to Sun 4 Oct", or "Last night"); week:
  "28 Sep – 4 Oct" (year added when not the current year: "29 Dec 2025 – 4 Jan 2026"); month: "October 2026"; year:
  "2026". Follow the person's date style (day-month or month-day, `formatDay`).
- **Navigation.** ‹ › step one period to the canonical start of the neighbour. › is disabled once the period contains
  today. ‹ is disabled before the period containing the first record of any ring or import source (the earliest first-record
  date over `bio.sources`; until it is known, ‹ stays enabled). **today** key shows
  when not on the current period. Tapping the label opens a `Popover` month calendar: days with data carry a 4 px ink
  dot, future days disabled, Enter/Space pick, "Go to date".
- **Switching period keeps the date**: day 2 Oct → week shows the week containing 2 Oct → day returns to 2 Oct (store
  the anchor date, not the window start). Lumen lost it; Vitals must not.
- **Drill down**: tapping (or Enter on) a slot in week or month opens day for that date; a slot in year opens that month.
- **Current period truncated at today**: slots after today are empty (no missing mark, no tick emphasis); the x axis
  still spans the full calendar period so a week always shows 7 slots.
- **Coverage** in every period faceplate header: "5 of 7 nights recorded" / "26 of 31 days recorded" (counting only
  slots up to today).

### 7.2 Missing, unknown, zero

| Case | Bars | Lines | Table |
|---|---|---|---|
| **missing** (no record for the slot) | a hollow stub at the baseline: 4 px tall, slot width, 1 px dashed `--lm-ink-3` outline (E29 `.lv-ring-missing`; dashed here *means* "no data") | the line breaks; no interpolation across the gap | "no data" |
| **zero** (a record says 0, e.g. 0 steps in an hour while worn) | nothing above the baseline; the baseline tick is solid | the line touches 0 | 0 |
| **unknown sleep stage** | the shipped E29 style (`.lv-ring-stage[data-stage='unknown']`: hatched ink) | — | "unknown" row |
| **provisional night** (ring not finished) | bar at 60 % opacity + "still changing" in its tooltip | — | "(still changing)" |
| **future slot** | nothing | nothing | not listed |

Dashed means only "no data" (stubs) or "a device change" (`ScoreHistory` joins); never a gridline.

A gap in a line is any interval longer than `max(3 × median sample interval, 20 min)` (E29 `runsOf`). Averages,
minimums and maximums for a period use recorded slots only and say so ("average of 5 recorded nights").

### 7.3 Sleep

Colours: the existing stage tints of the recovery hue (`ring.css`: deep = `--lm-cat-recovery`; light = recovery 60 %;
REM = recovery 35 % mixed with ink-2; awake = `--lm-ink-3`; unknown = hatched ink). They are ordinal by depth and
already shipped; keep them. Every stage also has its own **row** (night) or **stack position** (bars), so identity is
never colour-alone.

#### 7.3.1 Night summary strip (day)
`ReadoutStrip`: **asleep** "7 h 12 min" · **in bed** "23:40 – 07:05" · **awake** "18 min" · **unknown** "41 min" (only
if > 0) · **sleep score** (the existing Vitals score tile, if computed; links to its detail). Provisional night: a
line "Stages may still change: the ring hadn't finished this night." (replaces the E29 string). Vendor score (if on): "Your ring says
82 (their estimate)" as the last item.

#### 7.3.2 Night stages + overnight lanes (day) — the night as a channel stack
One faceplate, one shared x axis, **one crosshair** through all lanes (the Vitals signature, CHART_SPEC §4).
- **x**: clock time from 30 min before bed to 30 min after wake, ticks every hour (every 2 h if the span > 10 h),
  labels "23", "00", "01"…; bed and wake marked by engraved labels "bed 23:40" / "up 07:05" at the ends.
- **Stage lanes** (E29 `NightStages`, extended): rows top → bottom **awake, REM, light, deep, unknown**; the unknown
  row is always present (rows never shift between nights); row height 18 px (390) / 20 px (≥ 768); segments at true
  time, ≥ 1 px wide, no connectors across unrecorded gaps (gaps stay blank).
- **Overnight lanes** under the stages, same x: **heart rate** (bpm, cardio hue 2 px line, lowest point labelled
  "lowest 52"), **blood oxygen** (change from your normal, recovery hue line around a labelled zero line),
  **skin temperature** (change from normal in °C, recovery hue line around a 1 px `--lm-chart-axis` zero line labelled
  "your normal"). Each lane: engraved name + unit at left, its own y scale hugging the data (CHART_SPEC §4.3), 2 ticks.
  A lane with no readings this night collapses to a 24 px row "no blood-oxygen readings this night".
- **Crosshair readout**: "02:14 · deep · 54 bpm · 95 % · +0.2 °C".
- **Data**: the main sleep record for the date (stages from the sleep record; HR, SpO2, temperature from `bio.series`
  between bed and wake). Several sessions: the longest is the main night; others are naps (§7.3.5).
- **Only unknown stages**: the unknown row is filled for the whole night; note "Your ring recorded when you slept but
  not the stages." The overnight lanes still draw.
- **Empty**: no main night for the date → the frame with empty rows and "No night recorded." (+ the ring line of §6.3).
- **Table twin**: stage, start, end, minutes; then one row per 5-min bucket for the lanes (time, stage, bpm, %, °C).

#### 7.3.3 Stage minutes (day)
The E29 table: stage, minutes, share of time asleep (deep, light, REM, then awake and unknown below a hairline; awake
is not part of "asleep"). Swatch per row (the stage tint) + the word.

#### 7.3.4 Stacked stage bars (week, month)
- **x**: one slot per night (wake date) of the calendar period. Week ticks: weekday letter over date ("M / 29");
  month: date numerals every 7 days (1, 8, 15, 22, 29) plus the selected date.
- **y**: hours asleep, 0 to ceiling = `ceil(max(longest bar, goal) × 1.1)` to the next whole hour; tick step 2 h (1 h
  when the ceiling ≤ 6 h); ticks at multiples of the step ≤ the ceiling ("0", "2 h", "4 h", "6 h", "8 h"). Lumen
  rounded up by a whole step (8 h → 12 h for ten extra minutes); do not.
- **Marks**: one column per night, stack bottom → top **deep, light, REM, unknown**; awake is not stacked (it is not
  sleep; it is in the tooltip and table). Column width `min(24, slot × 0.72)`, 2 px surface gaps between segments,
  4 px rounded top on the top segment only.
- **Goal**: the person's sleep goal from Plan, if set: 1 px solid `--lm-ink` line with a right-aligned label "goal 8 h".
  No goal → no line.
- **Missing night**: stub (§7.2). **Provisional**: 60 % opacity. **Nap**: not in the bar (§7.3.5).
- **Hover/tap**: crosshair snaps to the night; readout "Night to Tue 30 Sep · 7 h 05 asleep · deep 1 h 10 · light
  4 h 02 · REM 1 h 31 · unknown 22 min · awake 25 min · in bed 23:52 – 07:22"; tap opens day.
- **Header readouts**: average asleep (recorded nights), coverage, average stage shares computed **only over nights
  with stage data** (Lumen divided by all nights).
- **Table**: date, asleep, deep, light, REM, unknown, awake, bed, up.

#### 7.3.5 When you slept (week, month) and naps
- A floating-bar chart (the actogram): y = clock time from 18:00 (top) to 14:00 (bottom), x = nights; each night a
  6 px rounded bar from bed to wake in the recovery hue at 60 %; naps as a 6 px bar in ink-3 at their times in the slot of
  their date. Ticks "18", "22", "02", "06", "10", "14". A bed time before
  18:00 or a wake after 14:00 is clipped at the edge with a small arrow; the table has the exact times. A median bed and median wake as 1 px ink lines labelled
  "usually 23:45" / "usually 07:10". Missing night: stub at the top. 120/140/160 px tall.
- Naps (sessions other than the main one, < 3 h, ending after 09:00 and before 21:00): listed on day under the stages as
  rows "nap · 14:10 – 14:40 · 30 min"; never added to the night's bar or to "asleep". Any other second session is
  shown as "another sleep" with the same row.

#### 7.3.6 Year
Twelve monthly columns: average asleep per recorded night, stacked by the average stage minutes of nights that have
stages (unknown hatched on top); coverage under each column as condensed numerals "21/31"; a month with no nights is a
stub; the current month truncated at today. Tap → month. Table: month, nights recorded, average asleep, averages per stage.

### 7.4 Heart and recovery

#### 7.4.1 Effort zones (used here and in workouts)
- Max heart rate = the person's observed max (`hrMaxObs`, a profile input) if set, else `208 − 0.7 × age` (Tanaka), age
  from Your body; rounded to a whole bpm, and zone boundaries are rounded the same way. No age → no zones: the
  line is plain cardio hue and a line under the chart says "Add your age in Your body to see effort zones."
- Zones by % of max: **zone 1 · easy** 50–60, **zone 2 · steady** 60–70, **zone 3 · moderate** 70–80, **zone 4 ·
  hard** 80–90, **zone 5 · maximum** ≥ 90. Below 50 % is "resting range" (not a zone).
- Colour: an **ordinal ramp of the cardio hue** (one hue, light → dark = easy → maximum), validated with the dataviz
  validator `--ordinal` (monotone lightness, ΔL ≥ .06, end contrast ≥ 2:1, single hue):

| token | light (on `#fbfcfd`) | dark (on `#1d1f22`) |
|---|---|---|
| `--lm-hr-zone-1` | `#cf9a22` | `#7d5408` |
| `--lm-hr-zone-2` | `#ae7c14` | `#a2700f` |
| `--lm-hr-zone-3` | `#8e600c` | `#c48e1c` |
| `--lm-hr-zone-4` | `#6e4707` | `#dfae3c` |
| `--lm-hr-zone-5` | `#4f3104` | `#f2d27a` |
| resting range | `--lm-ink-3` | `--lm-ink-3` |

  In dark mode the ramp runs the other way (higher zone = lighter = more salient). Both ramps PASS the validator
  (run 2026-10-04). Add the tokens to `tokens.css` §8 via a request (or define them locally in `signals.css` with a
  pointer to this table). Zone identity is never colour-alone: zone boundaries are labelled on the right edge and the
  table names the zone of every value.

#### 7.4.2 Heart rate through the day (day) — main chart
- **x**: 00:00–24:00 of the date; ticks every 4 h at 390 ("00 04 08 12 16 20 24"), every 2 h at ≥ 768; today: data
  ends at now and a 1 px yellow now-hand with its ink edge marks now (CHART_SPEC §7.8, the only yellow; the edge keeps
  it apart from the zone 1 colour).
- **y**: bpm, domain = [min, max] of the day's samples including resting and spot checks, + 10 % padding; the 2–3 nice
  values inside it are the ticks.
- **Marks**: a 2 px line segmented by zone (each segment in its zone colour; segments split exactly at zone
  boundaries, as Lumen did); breaks at gaps (§7.2); spot checks as 8 px dots with a 2 px surface ring; **resting heart
  rate** as a 1 px solid `--lm-ink` line labelled "resting 58" at the right; zone boundaries that fall inside the y
  domain as 1 px `--lm-chart-grid` lines labelled at the right edge "zone 2 · 114"; **context bands** behind the line:
  sleep (recovery hue at 10 %, label "asleep") and workouts (performance hue at 12 %, label the workout type word).
- **Readouts** (header): resting · lowest (time) · highest (time) · readings count.
- **Time in zones** (under the chart, only if any zone time > 0): one horizontal stacked bar, segments in zone colours
  with 2 px gaps, labels "zone 2 · 24 min" under each segment ≥ 40 px, the rest in the table.
- **Crosshair readout**: "16:42 · 128 bpm · zone 3 · moderate" (or "· resting range").
- **Empty**: "No heart-rate readings for this day." (E29 copy). **Table**: time, bpm, zone.
- Data: `bio.series` heart rate for the day (hourly resolution is not enough for zones: use the raw samples, M4
  downsampled per pixel column when > 2 × width).

#### 7.4.3 Heart-rate variability last night (day)
`BaselineGauge` (exists): printed scale, personal normal band, 7-day mean bar, last night hollow dot; text "−6 ms from your
normal last night" (the gauge's printed scale is the only place the absolute range shows, as the existing tiles do). Fewer than 14 nights: "Building your normal: 9 of 14 nights." and only the
value. Tier note once per tab.

#### 7.4.4 Blood oxygen and skin temperature at night (day)
Two `DayLine`s (E29) over the night window, in the recovery hue. Blood oxygen: change from your normal (% points)
around a labelled zero line, readout "average −1 % from your normal · lowest at 03:12"; absolute values in the table. Skin temperature: **change from your normal** (°C or °F)
around a labelled zero line ("your normal"), absolute value only in the table (fixes the E29 absolute display for tier
C). Empty copy from E29.

#### 7.4.5 Heart rate per day (week, month) — main chart
- **x**: days of the period (as §7.3.4 ticks). **y**: bpm, hugs the data.
- **Marks**: per day a 2 px vertical range line from the day's lowest to highest (cardio hue at 50 %), the day's
  **resting** value as an 8 px cardio dot with a surface ring; a 2 px cardio line through the resting dots, broken at
  missing days. Missing day: stub.
- **Readout**: "resting average 59 bpm (recorded days) · range 48–162".
- **Table**: date, resting, lowest, highest, readings.

#### 7.4.6 Resting heart rate, heart-rate variability (week, month, year)
`ScoreHistory` (exists): nightly dots, 7-day mean line, personal normal band, new device as a dashed join; category
`cardio` for resting heart rate, `recovery` for heart-rate variability. Year: pass monthly means as `mean7` and the monthly values as
the nightly dots, title suffix "monthly mean". Titles "resting heart rate", "heart-rate variability · tier C".

#### 7.4.7 Blood oxygen per night, skin temperature per night (week, month, year)
- Blood oxygen: per night the night's average change from normal as an 8 px recovery dot, with a range line down to the
  lowest reading's change (recovery hue 50 %), around a labelled zero line; y hugs the data with 10 % padding.
- Skin temperature: per night a column from the zero line ("your normal") up or down to the night's deviation, recovery
  hue, 4 px rounded data end, square base on the zero line; no diverging colour (position carries the sign).
- Missing night: stub on the baseline (temperature: on the zero line).

#### 7.4.8 Your ring says (any period, only when vendor scores are on)
A plain list faceplate, never a chart on a Vitals axis: "stress 34 (their estimate) · 16:00". Hidden when off.

### 7.5 Activity

Colour: the **performance** hue (`--lm-cat-performance`) for steps, active minutes and active energy (E29's steps bars
move from cardio to performance when they move here). Workouts use the zone ramp for heart rate.

#### 7.5.1 Goal meters (day; also the mini version on the Ring page)
Three rows, one per goal: **steps**, **active minutes**, **active energy**. Each row is a printed horizontal scale
(the ScaleSlider look without a thumb): domain 0 → `max(goal × 1.25, value × 1.05)`; minor ticks at 10 % of the goal,
major ticks with condensed numerals at 0, ½ goal, goal; the goal tick is taller and labelled "goal 8 000"; the value is
a 6 px performance-hue bar from 0 (4 px rounded end) with the readout at the right "6 420 steps" (wide tabular). Over
the goal the bar simply runs past the goal tick (no colour change, no celebration). No goal set: no goal tick, scale to
`value × 1.25`, line "No goal set. Set one in Plan." Missing (nothing read today): an empty well and "no data yet
today". Goals come from Plan (steps, active minutes) and the plan's energy target if any; never invented defaults.
Mini version (Ring page row): 120 px wide, 4 px bars, no numerals, goal tick only.

#### 7.5.2 Steps by hour (day)
24 columns (00–23), performance hue, `min(24, slot × 0.72)` wide, 4 px rounded tops; y 0 → nice ceiling, 2 ticks;
hours with no record → stub; hours after now → nothing. Sleep shaded behind (recovery 10 %) so a quiet night reads as
asleep, not missing. Readout "6 420 steps · 4.1 km · 280 kcal active". Table: hour, steps.

#### 7.5.3 Steps per day (week, month) and per month (year)
Columns per day (§7.3.4 geometry), goal as a 1 px ink line "goal 8 000"; missing day stub; tap → day. Header readouts:
average on recorded days, "at goal on 4 of 7 days" (a count, never a streak). **Active minutes per day** as a second,
secondary-height chart with the same x and its own goal line. Year: monthly average steps per recorded day + coverage
numerals.

#### 7.5.4 Workouts list and workout sheet
- **List** (any period): rows grouped by day (engraved day header "Tue 30 Sep"), each row: type word (E29
  `workoutTypeWord`), start time, duration, average heart rate, distance if any, a 64 px **time-in-zones** mini bar
  (zone ramp, no labels) and "from your ring" / "logged by hand". Tap → sheet. Empty: "No workouts in this period." +
  **Log an activity** (→ Train's log). Year: a count per month as columns instead of rows.
- **Sheet** (`ResponsivePanel`: bottom sheet under 1024 px, side panel at 1024 and over): title "Run · Tue 30 Sep · 18:05 – 18:43";
  `ReadoutStrip` duration, distance, average heart rate, highest heart rate, active energy; **heart rate during the
  workout** = §7.4.2 marks over the workout window (x = minutes from start, ticks every 5 or 10 min); **time in zones**
  as the labelled horizontal stacked bar (§7.4.2); source line. No edit or delete in v0.5.0: `Correction`
  covers sleep, steps and weight only (extending it to workouts is a request). No map, no splits.

### 7.6 Summary of reused and new components

| Piece | Status |
|---|---|
| `NightStages`, `DayLine`, `StepsBars`, `WorkoutsTable`, `ringData.ts` (E29) | moved to `src/features/signals/charts/`, extended as above (unknown row always, overnight lanes, crosshair, table twins, change-from-normal temperature) |
| `ScoreHistory`, `BaselineGauge`, `ScoreTile` | reused as is |
| `Tabs`, `KeyBank`, `Popover`, `Faceplate`, `ReadoutStrip`, `KeyValueList`, `EmptyStage`, `ResponsivePanel`, `Switch`, `ScaleSlider`, `TypedConfirmDialog`, `InlineWarning`, `Notice`, `ProgressRule`, `toast()` | reused |
| `PeriodBar` (KeyBank + date navigator + calendar popover) | new, `src/features/signals/PeriodBar.tsx` |
| `StageBars`, `SleepWindow`, `DailyRange`, `ZoneLine`, `ZoneBar`, `GoalMeter`, `HourBars` | new, `src/features/signals/charts/` |
| `RingLight`, `ConnectionCard`, `BatteryScale`, `ScanList`, `CheckNow` | new, `src/features/ring/` (`RingLight` mounted by the shell in `Chrome.tsx` via request) |
| `--lm-hr-zone-1..5` | new tokens (§7.4.1) |

---

## 8. Test checklist for `L-PAGES`

- Every state of §5.2 and §6.3 at 390 / 768 / 1440 in light and dark (fixture ring service + fixture records):
  unsupported, no ring, Bluetooth off, permission needed, searching, connecting, connected, syncing, elsewhere
  (with Connect here instead), stale, error, low battery; Body signals with a night that has unknown stages, a night with
  only unknown, a provisional night, a nap, missing days inside a week and a month, a period with no data, the current
  week truncated at today, a day with no age set (no zones).
- The period model: switching day → week → day keeps the date; › disabled on the current period; ‹ stops at the first
  record; drill-down from week and year; reference night at 02:00.
- Missing is never zero: a fixture day with no record draws a stub and is excluded from the average; a fixture hour with
  a 0-step record draws nothing above the baseline.
- Forbidden text scan over both pages' DOM in every state: no ring brand name, no advertised name, no "password",
  "passcode", "credential", "key" as a ring field, "PIN", "firmware password", no "MQTT", no "lease", no "GATT".
- Accessibility: tab order (tabs → period bar → each chart as one stop → table key), keyboard crosshair, live readout,
  `RingLight` accessible names per state, 44 px touch targets, reduced motion (no pulse, no transitions).
- Side by side with Lumen's screens for the same night (owner's captures in `design/screens/private/lumen/`, never
  committed): same bed and wake, same stage minutes within the re-classification rules, same steps.
