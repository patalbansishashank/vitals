# Changelog

All notable changes to Vitals. Dates are release dates (IST).

## Unreleased

## [0.8.6] - 2026-11-07

### Added
- Experimental tracking for explicitly chosen Simulator plans. Preset deficit, energy-availability, loss-rate and cut-duration warnings remain recorded in a collapsed Plan Details disclosure. Current medical restrictions still apply; tracking does not issue a verified-plan certificate or guarantee individual outcomes.
- Owner-delegated agent control across registered app commands, including current-routine comparisons with matched calorie, macro and training controls.

### Fixed
- Release checks now verify the current optimizer checkpoint format and regenerated command documentation.
- A user can turn off the general adult 25% deficit preset without discarding clinician, marker, imported or condition-specific restrictions. The screening's generated duplicate follows the same choice.
- Simulator plans preserve the person's selected practical limits and muscle-retention budget when started. Protein targets and optional higher-protein preferences stay distinct from actual food logs.
- Documented habitual sleep reaches the model, and reported bike sessions linked to recreation are counted once.


### Added
- Server (home role): the coach can run on the server (`/v1/coach/*`, docs/SERVER.md "Coach"). The server drives
  Claude Code on the host, one process per turn, isolated from the owner's own Claude setup (no user settings or
  hooks, only the server's `/mcp` tools) and in its own memory-capped systemd scope; answers stream as server-sent
  events with tool progress and `proposal` events for staged plan changes. Vitals devices and the Gauge app may use
  it. Sessions are temporary: kept in memory, deleted with their transcript and short-lived token 24 hours after the
  last message (`keep` extends it) and on every restart. Codex is an opt-in fallback (`coach.fallback: "codex"`).
  Off until `server.json` has a `coach` block.
- Server (home role): the Gauge app (the ring app, formerly Lumen Health; Vitals plans, Gauge measures) pairs with
  the person's one-time code (`vitals-server pair-code`) and uploads its ring data over HTTPS (`/v1/lumen/pair`,
  `/v1/lumen/events`, `/v1/lumen/status`, `/v1/lumen/unpair`) into a separate `persons/<id>/lumen.db`; agents on `/mcp`
  read it through seven read-only `gauge_*` tools (`gauge_data_availability`, `gauge_metric_series`,
  `gauge_daily_summary`, `gauge_sleep`, `gauge_activity`, `gauge_scores`, `gauge_device_state`). The routes, the
  `lumen` token kind and the file keep the old name so paired phones keep working. Vitals itself stays manual-only and
  never syncs that data. (Step 1 below changes this for steps and sleep.)
- Ring steps and sleep come into Vitals by themselves (reverses 0.6.0's manual-only rule for these two only). While
  paired with the home server, every Vitals device (web, desktop, Android) reads the ring's daily steps and each
  morning's main sleep from Gauge's data on the server (`/v1/gauge/activity`, `/v1/gauge/sleep`) at start and every
  5 minutes, filling the last 30 days the first time, and logs them as ring entries ("8214 steps · ring"). The plan,
  check-ins and the planner count them like logged steps and sleep; a ring night counts the minutes the ring scored as
  asleep. Your own entry for a day always wins, and the import never writes over it; a ring entry you remove stays
  removed. Re-runs and other devices add no duplicates (each reading gets the same id everywhere). Settings › Sync ›
  Ring data from Gauge shows the last import and turns it off on all devices. Heart rate, HRV, SpO2 and temperature
  are not used by the plan.
- `src/net/gauge.ts`: `gaugeApi`, the client for `/v1/gauge/*` (typed `gauge_*` tool JSON, null when unpaired or
  offline, last good answer kept, conditional polling with ETag).
- Android home-screen widgets, restyled and extended (r071): the Today widget is three rings (steps, energy, sleep, each
  its own tap), Ring is Heart rate with the day's line, and Energy, Sleep and Steps are widgets of their own (2x2 as a ring
  with the figure inside, 4x2 with the day's running burn and its dotted forecast, the night's hypnogram, or steps by
  hour); Weight is a widget too, off until Settings › Widgets turns "Show weight on the home screen" on. Each card has
  its domain hue as one glow over the warm face, Geist for every figure and mono caps for its facts, and wears the
  launcher's own corner on Android 12 and later. Every instance is drawn at its own size. In quiet mode a widget says
  words and parts of the day, never a digit, and Energy says only that quiet mode is on. The figures now reach the home
  screen from the app's stores and models, not from the Today cards (a card removed from Today no longer freezes its
  widget), and are read only for widgets that are placed. The widgets' design is generated from `design/tokens.css`
  (`pnpm android:design`).

## [0.7.9] - 2026-11-01

### Changed
- Use the existing three-dot **Edit cards** action to rearrange cards; choose **Done editing cards** to finish.
  Normal mode keeps card links, information and chart interactions free of editing gestures. Add cards appears only
  while editing. In Edit mode, drag anywhere on an editable card; wide desktop layouts resize from the corner.
- Phone cards always use the full available width, including landscape. Phone resizing is removed while saved desktop
  widths remain intact.
- Card selection, order and widths are local to each device. Migration preserves the device's current layout once,
  including default and intentionally empty layouts; later shared settings cannot overwrite it.

### Fixed
- Kept-goal attainment now agrees with the final simulated verdict instead of an earlier search percentage. Goal
  thresholds, model values and safety checks are unchanged.

## [0.7.8] - 2026-11-01

### Changed
- Recent ring readings open from a bounded device cache and refresh in the background, including after reopening the
  app or losing connectivity. Saved readings remain labelled and are cleared when access or pairing changes.
- Today cards support reliable touch holds with finger drift, reachable resizing at either screen edge and edge
  auto-scroll. Eaten, Energy, Sleep and Energy burned have usable compact phone widths.
- Cards across Today, Ring, Food, Activities, Progress, Body and Simulate show the essential figures more clearly.
  Secondary facts remain in information panels; the quieter information glyph keeps its full 48px touch target.
- Desktop scrolling stops scheduling frames while idle, route focus no longer polls every frame, and charts share
  their theme snapshot. Full sleep ranges, gaps, limits and uncertainty remain visible where needed.
- Pull requests and integration pushes run complete, explicitly accounted software checks and real Chromium touch
  smoke tests. Core checks run in parallel, timing-sensitive checks run separately, and validation receipts do not
  depend on artifact-storage quota. Builds use Node 26; the server/CLI require Node 26.10 or newer.
  Release workflows validate one immutable source commit before packaging or deployment.

### Fixed
- Tiny finger movement transferred capture from a card child to the grid and was mistaken for cancellation. Cancelled
  and completed gestures no longer activate the card underneath on release.
- A refused server read could restore an older Progress snapshot. Cached readings now retire with the failed access.
- Populated local replacement validates and commits the complete snapshot with crash recovery. Stale commands and
  other windows cannot resurrect replaced data. Paired devices use Merge or disconnect document sync first.
- Storage batches remain atomic after clone/setup failures. Exports wait for document boot and pending writes.
- Native uploads detach when the web server pairing is forgotten or planning data is reset. Destroyed Android bridges
  release their engine observers, and a failed reset keeps its confirmation open with an error.
- Agent configuration parsing handles quoted and spaced TOML tables without duplicate registrations. Server polling
  and expiry failures stay within their request/store rather than escaping timer callbacks.
- Back-to-back resistance and cardio sessions keep quarter-hour start times and reserve their transition gap without
  changing the exercise dose or crossing meal/bedtime boundaries.

## [0.7.7] - 2026-10-31

### Fixed
- The ring authenticates automatically using its existing firmware handshake. Removed the connection-code prompt and
  entry form introduced in 0.7.6. Internal authentication stays in the native driver and out of UI and diagnostics.
- The upgrade recovers missed ring history without requiring a code or an extra setup step. Existing frequent guarded
  refreshes and truthful authentication status remain.

## [0.7.6] - 2026-10-31

### Fixed
- Restore private ring connection-code setup after moving from the old app. A visible notice explains when the code
  is missing or rejected; Bluetooth connectivity alone no longer implies that readings are available.
- Refresh the connected ring while Vitals is visible, with serialized shallow passes about a minute after each pass
  finishes, with guarded background checks scheduled every 15 minutes. Automatic reads keep their page limits, yield
  to measurements and protect the sleep window; explicit Sync recovers older history.
- Use sustained phone gait when direct minute evidence shows a stalled wrist, while retaining carry choices,
  corrections, source provenance and uncertainty. Never add overlapping phone and ring counts.
- Dragged cards follow the pointer and settle into place on release. Width changes respond over shorter distances
  with a bounded preview; previews stay inside the page on touch and mouse.
- Remove native WebView side padding and inset scrollbar reservation, and reduce Android chrome compositing work.
- Refresh imported step coverage and source metadata when its meaning changes even if the total stays the same.

## [0.7.5] - 2026-10-31

### Changed
- Android checks for updates on launch, on returning to Vitals and after connectivity returns, with minute checks while
  visible and prompt retries after failures. A failed request no longer suppresses discovery for a day.
- Available updates appear in a persistent banner under the header on every page, with Download, Install or a real
  Restart action. Progress and retry stay visible; visiting Settings is no longer required.
- Verified staged web updates can be applied explicitly without waiting for Android to kill the process. The new
  page must confirm its trial; older callbacks and watchdogs cannot confirm or roll back a later trial.
- A downloaded APK posts an update-ready notification where notification permission is already granted.

## [0.7.4] - 2026-10-31

### Changed
- Drag Today cards directly from their surface, or hold then drag on touch. Resize from a small bottom-right corner
  grip. The Move/Width button strips are removed; keyboard controls remain available.
- Neighbouring Today cards share their row height, including empty Sleep beside Energy. Existing widths and order stay
  saved; unavailable and empty selections return when their data becomes available.

### Fixed
- A selected card with no rendered content could disable layout packing for every other card and leave large gaps.
- Resizing cards at the right edge, scrolling before a touch hold, cancelling gestures and clicking controls after
  dragging now follow the same direct interaction without accidental navigation.

## [0.7.3] - 2026-10-31

### Changed
- Today cards pack beneath shorter neighbours. Drag their Move and Resize handles in Edit cards to arrange the page;
  saved widths and order sync as before. The library adds and removes cards.
- Complete facts stay on one line and scroll within their space when needed. Separate footer facts stack left when
  they cannot fit together. Numbers use comma grouping throughout the UI.
- Desktop slide-in panels cover the page without narrowing it. The Simulator day editor starts closed and overlays
  its calendar when opened.
- The Energy by kind card uses shorter labels and keeps every component and explanation in its info panel.

## [0.7.2] - 2026-10-31

### Changed
- Ring setup, readings, scores, notifications and help now speak about Vitals, your ring and your phone, without the
  retired app's name. Existing pairings and stored records keep working.
- Today cards have saved Full, Half and Quarter width choices where supported. The grid follows its available space,
  and Add a card has a larger target and more room.
- Card titles, figures and facts fit narrow cards; card tables align their last column right. The desktop top bar has
  more vertical room, and Simulator controls and results use space more evenly.
- Daily bars grow with the available width. The Energy breakdown uses distinct colours for the model's components.

### Fixed
- A late reconnect retry could replace a ring connection that was already connecting or connected.
- Ring activity values could occupy the chevron column and overflow the card.
- Re-pairing clears old ring caches, import cursors and update offers; late responses cannot refill the previous
  pairing's cache or send the new server's update credential to the previous server.
- Command polling respects its deadline, failed Simulator previews do not show old results with new dates, and server
  chat actions recover from failed requests.
- IndexedDB reopens after another tab closes its connection. Calling an asynchronous command synchronously now cancels
  its app writes instead of committing after reporting an error.

## [0.7.1] - 2026-10-30

### Changed
- A new look everywhere: Geist and Geist Mono, one colour per area (heart, energy, food, steps, recovery, body, sleep,
  videos) as a soft glow in its card, one hero number per card with facts in mono caps, and an (i) on every card that
  opens its explanation instead of subtext. Pictures that explain: tick rings, dotted tracks, glowing lines, highlighted
  bars, range scales and stacks, animated on first view (reduced motion respected).
- Today: the day's plan as the hero, a short default set (Eaten, Energy, Sleep, Steps, Weight) and an "Add a card"
  library you can reorder and edit (synced).
- Energy burned: any day, week, month, year or custom range, with daily bars, the average, and what made up the burn
  (resting metabolism from your weight, everyday movement, walking, exercise, food digestion) with ranges.
- Ring, Sleep, Food, Train, Plan, Coach, Progress, Body, Settings, Evidence and the planning tools restyled.
- Home-screen widgets redrawn, with new Energy, Sleep, Steps and (opt-in) Weight widgets; quiet mode shows no digits.
- The short-video island is one size inside the status bar; its count turns from white to red toward your limit.

### Fixed
- A night slept in two parts is one night (server, 0.6.0-db7a20dd).
- The short-video counter's "restricted setting": the app shows the steps to allow it; updates install through
  Android's package installer.
- Focus returns to where you were when a sheet or panel closes.

## [0.7.0] - Unreleased

### Fixed
- Android: the short-video counter could not be switched on (Settings › Accessibility showed it grey, with "restricted
  setting"). Android holds back an app that came onto the phone as a file, and the in-app update opened the system
  installer on the downloaded APK, which counts as one. Updates now go in through an install session, the way an app store
  installs (the system's own confirmation still shows), so an update no longer marks Vitals that way; it does not lift a
  hold that is already there. Where the counter is asked for (the short-video limit card, the Ring permission rows) a
  3-step guide with a key to Vitals' App info shows when Android holds it back, or when you opened Accessibility settings
  and the counter is still off: tap ⋮, Allow restricted settings (confirm with your phone's lock), then turn the counter on.
- Sleep: a night the ring recorded in two parts (you woke for an hour or more in the middle) is one night. The server
  showed the longer part as the night and the other as a nap, so Sleep, Today and the sleep log held only one part (2026-10-30:
  3 h 25 of a night of 6 h 33). The parts of a night, with a break of up to 3 hours between 21:00 and 12:00, are one
  session: the asleep minutes add up, the break counts as time awake after you fell asleep, and the sleep chart shows both
  parts with the break between them. A daytime nap stays a nap. Needs the home server updated; Vitals then corrects its ring
  sleep entries of the last 30 days by itself within a few hours.

### Added
- Android: Gauge's engine is part of Vitals (the `gauge` module: the ring drivers and sync, the phone's step counter, the
  Health Connect reader, the short-video counter, the home-server upload and command channel; Gauge's own screens and
  updater stay behind). While the Gauge app is installed the engine is passive (no ring, no steps, no short videos, no
  uploads); once Gauge is uninstalled and you tap take over, it finds your ring, counts and uploads on its own, with its
  upload token from the server (`/v1/lumen/pair-device`, authorised by this device's own server credential). Vitals
  asks for the Bluetooth, Health Connect, activity and notification permissions itself, with the system's dialogs.

## [0.6.7] - 2026-10-29

### Added
- Energy page (`/energy`): a day's energy burned by time of day and kind (resting, everyday movement, food digestion,
  exercise), the day's activities with their kcal ranges, what is measured and what is estimated; a week, month, year
  or range as daily bars with the total and daily average. Opened from Today's energy card and the navigation.
- One date control everywhere: it shows only the selected day or period and opens a calendar (Gauge's design) with
  Day · Week · Month · Year · Range; Ring › Sleep, Activity and Scores and Energy show longer periods.
- Gauge data reaches Vitals faster: the server wakes Vitals when Gauge uploads (`/v1/gauge/pulse`); on Android Vitals
  asks Gauge on the same phone to send what it holds and shows "Gauge sent hh:mm" (needs Gauge 2.8.7).

### Fixed
- An approved activity no longer returns to review unless what it books changes; a Health Connect session holding two
  walks becomes two activities; an approved walk withdrawn when Google Fit replaced its session comes back; rejecting
  an edited hand log removes every version of it.
- Steps: one steps chart for detected, approved and hand-logged activities; steps through the day in 15-minute bars
  that agree with the total and "Updated".
- Sleep: REM on the compact sleep card, a night without REM says the ring marked none, gaps read "No stage".
- Short videos: a day Gauge has not sent says so instead of "Nothing counted".
- Colours: one colour per sleep stage, intensity and steps on every chart; fewer gold buttons; readable placeholders.

## [0.6.6] - 2026-10-28

### Added (web and server update, same day)
- **Automatic activity detection** (server `detect/2`, Gauge 2.8.3 activity recognition): walks, runs and rides found from
  the phone's and ring's minutes show as "detected" activities to review (e.g. "Possible treadmill walk · 24 min — your
  phone recorded steady steps while your ring recorded very few"); never counted until you approve; "Walking now ·
  detected" on Today while it happens. Air bike, mudgar and other equipment are offered as choices, never guessed.
- Health Connect exercise sessions sent by Gauge (name plus code) are imported again. A Health Connect copy of a workout
  you already counted (another app saw the same session) attaches to it instead of asking again; a possible duplicate's
  row answers "Same activity" (keep the counted one) or "Both happened".

### Added
- **Android home-screen widgets:** Today (energy so far, steps, Heart Points this week, last night's sleep), Ring (heart
  rate, battery, last sync), Log or record, and a one-tap Log. They follow quiet mode (words only), never show weight,
  say "as of …" when their data is old, and open the matching screen when tapped.

## [0.6.5] - 2026-10-28

### Fixed
- **Approve, Approve all, Edit, Reject and Log an activity** answered "This isn't available in this version of Vitals
  yet." in the built apps: a screen that imported an activity helper made the bundle load the activity commands before
  their declarations, and the real commands were dropped. Commands now wait for their declaration, in any load order.
- The phone app is locked to portrait (tablets and foldables still rotate).
- **Overlapping activities never count twice:** where two counted activities overlap, the minutes go to the one that
  started first and the other keeps only its own minutes, with its energy and steps scaled to them. A hand log over
  another timed hand log asks what it was, as it does over a recording.
- A counted activity can be removed from its sheet ("Remove this activity", asked once), not only undone right away.

## [0.6.4] - 2026-10-28

### Fixed
- **Ring battery** shows how old its reading is ("100 % · 5 d ago") instead of passing a stale value as current;
  Gauge 2.8.2 now reads the battery on every sync, not once per connection.
- **Record on the phone:** the release app never found the owner's Gauge (it ships debug-signed), so Record and the
  "Allow Vitals to control Gauge" key never showed without the server. Vitals now trusts that Gauge build when it is
  signed with the owner's pinned Gauge certificate, and only then.

### Changed
- **Sleep** is a smooth hypnogram with four levels (Awake, REM, Light, Deep): mixed readings take their neighbours'
  stage, short gaps are bridged and long ones show as one band. The table, the CSV and every sleep figure keep the raw
  readings.
- **Heart rate, HRV, SpO2, temperature and stress** day charts draw a line with a faint spread band instead of
  raw dots: lightly smoothed, so real peaks and dips keep their shape; the caption names the highest and lowest real
  readings. Raw values stay in the table and CSV.
- The Activities hub's keys (Log · Record · Make a plan) sit on one aligned row.

Today as home, a sync server that stays up, and every open item from 0.6.2 (two Codex gpt-6.1-sol + gpt-6-astra
audits, each cross-checking the other).

### Added
- **Today is home in every mode.** The app always opens on Today. Without a plan it shows last night's sleep, steps,
  heart rate, Heart Points, energy by kind from your body and your day, activities to review, and a "No plan running"
  card; with a plan it adds how the plan is followed and its projections. Back never loops to Settings.
- **Activities without a plan.** Log, record and review activities with no plan running ("Activities" in the ⋯ menu,
  "Log an activity" on Today). A log takes a start time or "I don't know the time".
- **Exact heart-rate zone time** from each reading's own interval (not minute averages), for zones, Heart Points and
  activity energy. Health Connect heart rate, speed and (verified) power are used where the ring has none.
- **Step corrections:** "use the ring / the phone for this time", sent to step fusion. Where the phone was (pocket,
  hand, desk) now changes which source wins.
- **The Ring's Activity tab** lists your approved activities (with history), pending ones apart; scores use Heart
  Points pace, planned sessions and training load; training load and energy can be added to the monitor.
- The recording banner stays on every screen; Record offers the whole activity catalogue and explains when GPS is off.

### Fixed
- **The home server froze** after Gauge 2.8.0 sent 16,498 single-reading deletions: every read checked each event
  against every deletion. Visibility is now kept as state at ingest (lumen.db v4), reads are windowed and budgeted, and
  a watchdog restarts the server if it stops answering.
- The desktop app showed the flat figure: the 3D figure's own files were refused on `app://` (and in workers).
- Starting, resuming or adopting a re-plan was refused for every screened adult (the deficit cap was never simulated);
  each now runs the full safety check and final audit from your confirmed state. No safety rule was relaxed.
- Duplicates can't be approved twice; a log overlapping a recording asks what it was; Undo removes the whole activity.
- Estimates never use typical body values: no weight on record means "needs weight". A retracted weigh-in no longer
  counts.
- Steps after midnight count on the app day; deleted workouts, steps and sleep upstream are withdrawn; Heart Points
  count each second once; pauses keep their place; a 0 kcal machine reading is kept as 0.
- Quiet mode is words only on every Ring and activity detail page, the recording banner and Train.
- Energy shows in kJ everywhere when chosen.

## [0.6.2] - 2026-10-28

Energy, activity and the ring screens (energy SPEC, packages S1–S2, V1–V4, C).

### Added
- **The day's energy, by kind.** Today shows energy so far, likely by bedtime and the plan, each with its range, and a
  chart of the day split into sleeping, resting, light, active and exercise. Energy comes from heart rate inside a
  recognised activity (Keytel), else from METs and minutes, else from speed and grade; it's personalised from your
  height, weight and age.
- **Activities to review.** Ring and phone activity, Gauge workouts and Health Connect sessions arrive as candidates.
  Approve all (exactly the rows on screen), approve one, edit (type, times, minutes, intensity, a machine's kcal) or
  reject. Nothing is counted until you approve it. "Log an activity" covers the days with no device. An approved
  workout above or below the plan moves the day's and the plan's projections.
- **Steps from the ring and the phone, fused.** Each period takes one source: the phone wins on sustained walking (the
  treadmill case), the ring where the phone saw nothing, and neither counts twice. Approved non-walking activities
  (mudgar, dumbbells) keep arm swings out of the step count. Steps by source are one tap away.
- **Heart Points** (Fit-compatible estimate): 1 a minute for moderate effort, 2 for vigorous, the week against 150 and
  300, and WHO moderate-equivalent minutes on Progress.
- **More activity types**, including treadmill, air bike and the common Google Fit list, next to mudgar and gada.
- **Heart-rate zones 1–5.** Settings › Heart rate shows how max and resting HR are estimated; a session keeps the zones
  it was approved with.
- **The Ring section** (from Gauge): Overview with Signals, Activity, Sleep and Scores; a full sleep page (stages,
  sleep heart rate, restorative sleep, midpoint, settle time, wake-ups, HRV and skin temperature vs your usual,
  overnight SpO2); "Add lights-out time" for true latency and efficiency; Measure heart rate now; the short-video limit;
  Check for updates. Vitals asks Gauge through the home server, and Record starts a workout on the phone.
- Server: `gauge_steps`, `gauge_timeline`, `gauge_baselines` and `gauge_hc` (and their `/v1/gauge/*` routes),
  `POST /v1/gauge/steps/fuse`, a `tz` on every read, and the command channel from Vitals to Gauge.

### Changed
- Charts follow one visual system (tick strips, dot fills, share bars, level bars, arc rulers), each with a table for
  screen readers. Quiet mode shows words only: no kcal, no scores, no digits, including for screen readers.
- An unknown reading is shown as unknown, never as zero.
- Android asks for one more permission, to start and stop Gauge's workouts.

## [0.6.1] - Unreleased

### Added
- Android: app updates from your home server, without USB or wireless debugging. On launch and then every 24 hours
  while paired, the app asks the server (`GET /v1/apps/vitals/latest`) for a newer version.
  - **Web updates are silent.** A newer web bundle downloads in the background. Vitals checks its sha256 and its ed25519
    signature against the key built into the app, and starts using it on the next cold start. If that bundle doesn't
    show its first screen within 10 seconds, Vitals goes back to the previous one and never tries it again. The bundle
    inside the APK is the floor, and a newer APK starts from its own bundle.
  - **App updates need one tap.** A newer APK downloads to the app's private storage and its sha256 is checked. Then
    Settings › About shows "Update ready", with a dot on the About row. Install opens Android's installer; Vitals never
    installs on its own. On a metered network, an APK over 30 MB waits until you tap Download.
  - Settings › About shows one line on Android: the app version, the web bundle version, and "Up to date" or "Update
    ready".
- Release: `scripts/release/web-bundle.mjs` zips `dist/` with `bundle.json` and signs it with the web-bundle key, which
  stays on the build machine.

### Changed
- Android asks for two more permissions, both for updates: network state (the metered check) and "install unknown
  apps", which Android confirms on the first install.

## [0.6.0] - Unreleased

Vitals is now a manual planner and log. Everything it knows is what you enter by hand. Smart rings, Bluetooth and
health-file imports are gone from Vitals; they live on in a separate Android app,
[Gauge](https://github.com/patalbansishashank/Gauge) (formerly Lumen Health).

### Removed
- Rings. Vitals no longer connects to any ring (all seven protocol families), on the website, the desktop app or the
  Android app. The Ring and Body signals pages, the ring key in the top bar, Settings › Devices (with the MQTT card)
  and the "Devices and data" chapter of the setup are gone.
- Health-file imports (Apple Health, Health Connect, Gadgetbridge, Health Auto Export, CSV) and "Share to Vitals" for
  those files on Android.
- Vitals' own scores from wearable data: sleep score, HRV status, resting heart rate, readiness and VO2max. There is
  no heart rate, HRV, SpO2 or skin temperature anywhere in Vitals, and the evidence topic "Scores from wearable data"
  is gone.
- The Android app has no Bluetooth, no "Ring connected" foreground service, no boot receiver and no ring
  notifications. The desktop app has no Bluetooth and its tray no longer shows a ring status. The website blocks
  Web Bluetooth (`Permissions-Policy: bluetooth=()`).

### Changed
- The living plan uses only what you log: weight, measurements, sleep, steps, workouts and meals. Goal suggestions no
  longer use a device's sleep debt or HRV.
- The Coach's briefing has no body-signals or scores sections, and the Coach knows that Vitals reads no devices.
- Ring data synced by an older version (readings, sources, scores, corrections) is ignored when Vitals loads. Daily
  log entries a ring wrote earlier stay as ordinary log entries. Photos are kept. You do not need to do anything.
- A new look everywhere (website, desktop and Android), dark only: a near-black, finely grained background, charcoal
  cards with gold hairlines, the Manrope typeface, a floating icon bar on phones and a collapsible sidebar on the
  desktop (Ctrl/Cmd+B). Each screen has one top bar and one ⋯ menu; helper captions and notices between sections are
  gone.
- Your body: the shape scales sit beside the 3D figure again and every move reshapes it; muscles, bones and fat under
  the skin are drawn in their own colours; the figure follows height, weight and sex from the first setup step.
- The body model was reviewed against current research and re-audited twice before release:
  - Energy and body composition: energy is conserved through the model; exercise cost is split into its gross,
    resting, net and extra parts; the scale trend separates water and glycogen from fat and lean tissue.
  - Food: each food's own energy factors, the carbohydrate basis on its label, recipe preparation and sugar alcohols
    are counted; a nutrient you did not enter stays unknown and widens the range rather than being guessed; supplement
    doses are read in their active form (for example vitamin D in IU or micrograms).
  - Measurements keep how they were taken (scale, tape, scan, lab sample, blood-pressure sitting, ketone sample type),
    and correcting or removing one updates everything that relied on it.
  - Plans start only after a safety check of the exact schedule and starting state. Limits from a clinician, lab
    markers and kidney-related guidance are enforced, and a new concerning symptom pauses step increases until
    reviewed.
  - Goals the model cannot support are marked unavailable instead of being ranked. Check-ins show energy
    availability, hunger and mood, and a re-plan keeps the inputs it was based on.
  - Estimates show a range with units or a short status word; outputs that are research-only say so. Mechanisms that
    rest on practice and experience rather than trials are kept, labelled as such, and calibrated from your own logs.

### For developers and agents
- The `bio_*` MCP tools (`bio_sources`, `bio_series`, `bio_daily`, `bio_scores`, `bio_baselines`, `bio_manual`,
  `bio_import`, `bio_rescore`, `bio_device_connect`, `bio_device_sync`, `bio_set_policy`, `bio_set_source_priority`,
  `bio_set_ring_sharing`, `bio_delete_source`, `bio_dismiss_ring_defaults_notice`) and `log_from_biometrics` are
  removed, as are the `bio.*`, `biometrics.*` and `log.fromBiometrics` commands behind them.
- The server no longer runs an MQTT broker: `/mqtt`, `/v1/mqtt/*` and `vitals-server mqtt add|revoke` are gone, and
  an `mqtt` block in the server config is no longer read. `/health` no longer reports MQTT.
- `packages/rings` and `src/biometrics` are deleted. The `bioRecords`, `bioSources`, `bioScores`, `bioCorrections` and
  `decisionLog` collections are dropped from the schema; `bioChunks` stays as the blob-store manifest for photos.
- No data migration is needed: old documents in the dropped collections are skipped on load.

## [0.5.3] - 2026-10-09

### Changed
- Pages use the full width of the window. On the desktop the page's main buttons sit in a bar at the bottom, like on the phone,
  with "Saved on this device" on the left; on phones that bar stays at the bottom, above the tab bar. Step pages show the title
  first, then a full-width progress bar.
- Your body: opened from the sidebar it has the same two halves as the setup steps (figure and estimates on one side, shape on
  the other), with the other cards balanced between the two columns so no gaps are left. "Simulate a plan" and "Find a plan"
  moved into the bottom bar, the "Your setup" card is gone, and the figure's canvas is taller. Maintenance and Estimates show the
  same number.
- The 3D figure shares one pose for skin, fat under the skin, muscles and bones, with the arms further from the body. It has zoom,
  move, turn and pause buttons and works with two fingers. It no longer flashes the old drawing while it loads. Moving a Shape
  slider is smooth: the skeleton and muscles are placed in the background. The eyes and mouth are closed, with no eyeballs, eyelids
  or inner mouth inside the head. The "Fat around organs" layer is removed from the 3D figure; the estimate stays as numbers.
- The visceral view is now a slice through the belly drawn from real anatomy (muscle wall, spine, bowel loops in deep fat), with
  the scale at the bottom right and the reference outlines kept quiet. Its numbers did not change.
- Goals: the page is two equal halves on wide screens (Goals and Won't do on the left; Horizon, Before you run and Practical
  limits on the right). Suggested goals are applied, and undone, from the suggestion card. The run screen no longer repeats your
  goals. In the results, the four plans share the width in equal quarters in both cards and table view, and the cards / table
  switch sits in the ladder title.
- The setup summary is one column with every answer on its own labelled line (what you do each day, training equipment, food,
  blood markers, devices and what the Coach sees). The data notes on the devices step are shorter, with the rest under "How your
  data is used". In the simulator the schedule / results switch is right-aligned on the desktop.

- Today, Food and Train use two equal columns on the desktop. The week at the top is a plain card with the days as keys; today's
  key is yellow. Today's plan is a time line with one clear action per item ("As planned", "Log weight", "Done") and the rest
  behind "⋯"; logged items keep an Undo. "How hard was today?" is its own card. The "Tell the Coach" box is gone from Today and
  from phones; the Coach page is where you talk to the Coach. Food's meals use the same time line, Targets show what you ate
  against each target, Groceries has a simpler list, and Pantry sits on the left. Train shows each exercise with one "Done"
  key, with Swap and Skip behind "⋯".
- On phones the page title bar (title and "⋯") sits at the bottom of the screen, above the page buttons and the tab bar.
- The ring has one page, Body signals, with the ring card (battery, last read, connect) at the top. "Today from your ring" is
  gone, and the ring's settings and sharing live in Settings › Devices.
- Every control in the top bars and the bottom bar has one height (36 px with a mouse, 44 px on touch).
- The Coach's "what it knows" opens as a side panel (a sheet on phones). The plan state ("starts tomorrow", "day 5 of 90")
  moved from the sidebar to Today's status line.
- The simulator's schedule shows the program keys in the schedule card, every day cell shows its date, and the page is
  three quarters schedule, one quarter day editor.

### Fixed
- The ring no longer jumps between your phone and your computer. With both apps open, each took the ring whenever it was
  free, so neither kept it and live heart rate never started. Now the device that has the ring keeps it, also through a
  short drop; the other one says "Connected to <device>" and offers "Connect here instead", and only that tap (or a
  device that has been silent for 15 minutes) moves the ring, exactly once. When the ring is free, the phone takes it
  first (it runs in the background and reads the night) unless you chose another device with "Connect here instead";
  the computer waits 15 seconds and looks again before it tries.
- A device that loses the ring to another app or phone waits 5, 15, 30, 60, 120, then 300 seconds between tries instead
  of grabbing it back at once, and a link that is taken away seconds after it came up keeps waiting longer, so two
  devices cannot swap the ring every few seconds even without sync. Battery and "last read" stay on the card meanwhile.
- Connecting follows more of Lumen Health's rules: the retry wait starts over when the app comes to the foreground or
  Bluetooth comes back on; on the phone a reconnect looks for the ring for up to 28 seconds (it advertises only every 20
  to 40 seconds when idle) and, after a Bluetooth error 133, clears the system's cached view of the ring before using the
  new link; a link the system kept while the ring stopped answering is noticed when you return to the app, not 30
  minutes later; "may be connected to another app or phone" is shown only when the ring could not be found or refused,
  not for every failure.

- 3D figure repairs: the skull sits inside the head and moves as one piece, the shoulder blades and arm bones sit in their sockets,
  bones and muscles no longer press flat against or stretch through the skin, and the broken edges at the knees, fingers and toes
  are repaired. The "Fat under skin" layer is a whole layer again, with no holes at the face, knees, fingers or toes, and it is smooth.
  At full zoom the whole head fits in the view.
- The phone action bar stays at the bottom of the screen while you scroll. Only one "Suggestion applied · Undo" shows after you apply
  suggested goals, and notices clear when you change page. The chart on the "Finding plans" screen no longer draws huge text. A bar
  in the simulator's schedule preview can no longer get a negative width.

- Today no longer stays locked as a preview after the plan's start date: a plan counts as running from its start date, so
  Log weight, As planned and the other actions work.
- Plans that keep your usual training show those sessions on Train and Today; before, every day said "Rest day". The plan
  card's training days were shown a day off (Sunday-first); they now read correctly.
- Moving a Shape slider on the Body page updates the 3D figure while you drag (it used to freeze until you let go).
- 3D figure: the skull sits lower, in line with the mouth; the fat under the skin is smooth over the back, neck and chest; the
  muscles no longer tear in heavy bodies, and hands and feet join the arm and leg muscles.

## [0.5.2] - 2026-10-05

### Fixed
- The desktop app can add a J-Style 2301 ring again. It showed the ring under the wrong family ("YCBT ring") because on the
  desktop only the ring's name is known before connecting; a name alone no longer picks a family, the row reads "Ring", and
  the ring is recognised once connected.
- On the desktop, looking for rings keeps going for up to three minutes (a ring can advertise only a few times a minute), and
  a connect that started is no longer cut off when the looking time ends; a ring the computer misses on the first try is tried
  again in the same tap.

- The ring connection now follows Lumen Health's proven sequence on every platform: every connection (first, after a drop,
  after Disconnect/Connect, after a restart) runs the full handshake (firmware, the firmware passcode, battery) before anything
  else; live heart rate comes back by itself after a drop; reconnect waits use Lumen's backoff (5, 15, 30, 60, 120, 300 s); a
  write the ring never answers is dropped after 4 s instead of wedging the queue.

### Known limits
- These connection changes are proven on a simulated ring; the desktop's first read, restart and last-night view were also
  checked on the real ring. Why a desktop link sometimes drops after the first read is still being looked at; it reconnects.

## [0.5.1] - 2026-10-05

### Fixed
- A night of sleep from the ring is shown whole again. Vitals split a night at any short gap in the ring's data (a few minutes awake or out of contact) and showed only the longest piece, so a night could end hours early; Lumen's overnight messages also stayed as separate pieces. Pieces from one ring less than an hour apart are now one night, matching what the ring's own app shows, and a later sleep the same morning is shown as one sleep. Nothing stored changes.
- A night, day or workout that reached Vitals both from the ring and from Lumen Health was stored twice. Both paths now give it the same id, so it is stored once, with the most complete reading kept. On first start Vitals merges the copies already stored; nothing else changes.
- Turning ring sharing off now also covers a ring that was first set up on another device before that device had the switch. Once the devices sync, its readings stay hidden from the Coach and agents.
- Agents no longer see a ring's Bluetooth address, serial or advertised name. They see the ring as "J-Style 2301" (ring 1, ring 2 when you have more than one), and a ring you hid from the Coach is not listed to them at all.
- Logging a meal through an agent when Vitals needs you to pick the food no longer reads as logged. The agent is told nothing was saved and gets the foods to choose from. Logging several days at once now says how many entries were logged and which need a food choice.
- An AI tool connected to the server is no longer locked out of a tool after about 20 calls in one session. Each call counts on its own; the limit of 60 calls a minute stays.
- `vitals --mcp` starts on Linux without a display (an AI tool over ssh no longer sees "Connection closed"). Re-add the tool in Settings › Agents once to pick this up.
- The desktop and Android apps no longer blame "this browser" when the server cannot be reached, and several Settings, Ring and Your data lines now say app instead of browser or tab.
- The iPad download note, the goal label on activity charts, and the period label on phones (cut at 390 px) are fixed.

## [0.5.0] - 2026-10-04

Vitals now has a shared website, desktop app and Android app, with ring readings and sync available in the same interface.

### Added
- Ring support for seven protocol families: **J-Style 2301, Colmi, CRP, Jring, LuckRing, RWfit and YCBT**. The Ring page handles connection, readings and sharing; Body signals shows sleep, heart and activity over day, week, month and year.
- Linux, Windows and macOS desktop installers and an Android APK. The website offers the relevant download and keeps the website option. The desktop app has a tray, updates and a consent-based **Connect your AI tools** setup.
- Android background ring checks while its ring service is running, with connection and battery notices. A screen-off background read was observed on the phone; the unplugged overnight case remains to be checked.
- Pairing with a home server can turn sync on and hand the new device its sync key. Settings shows sync progress, queued changes and errors. Agents can request the same briefing the Coach uses, subject to the person's sharing choices.
- A shared rotating Body figure, refreshed app icons, and a public MIT source snapshot. The release pipeline produced and checked Linux, Windows, macOS and Android artifacts together in a green CI run; publishing the v0.5.0 release is a separate step.

### Changed
- Vitals supplies the built-in J-Style 2301 firmware passcode during connection; there is no ring key field to fill in. Ring sharing starts on for scores and Coach, with a master switch and per-stream controls.
- The apps use one ring library and keep the same ring's readings together across devices. A revised sleep night replaces its earlier version in normal views. A joined device with a complete profile skips body setup; local writes are saved before sync acknowledges them.
- Lumen Health's archive remains importable while Vitals takes over the phone's ring role after the owner checks the new app.

### Fixed
- J-Style history reads tolerate a pause within a page and report an incomplete read instead of silently losing the rest.
- Reconnecting after a network outage flushes queued changes promptly. Concurrent log edits show both choices and support resolution and Undo; clock drift no longer gives a false **Synced** status.
- MCP briefing and profile tools work after a tool list; tool limits recover. Android excludes app data from system backup. Mobile layouts, keyboard focus and download controls received release fixes.

### Known limits
- Windows installers are unsigned: in SmartScreen, choose **More info › Run anyway**. The macOS app is ad-hoc signed and not notarised: use **System Settings › Privacy & Security › Open Anyway**. Windows and macOS built and smoke-launched in CI but were not hand-tested through full flows.
- Mixed-family pairing and provisional-to-complete sleep merging still need their final integration fixes and a rebuild. These app paths are not release-proven yet.
- Only **J-Style 2301** was read from a real ring. The other six families passed recorded-packet and fake-peripheral tests only. Its built-in firmware passcode worked on one ring; other rings with that firmware may differ.
- A phone screen-off read was observed, but an **unplugged overnight** background read has not been observed. Fresh-start phone connection and desktop live heart rate also need another real-device check; the latest full hardware journeys did not pass those cases.
- Clock drift over five minutes holds affected sync changes back; the status explains the delay. Server compaction of replaced ring chunks is not built yet.
- Living plan commands do not yet read ring observations directly; some derived body-signal flags still need source-level Coach hiding. Resolving a conflicting lab result can leave its separate summary showing the other version. When a meal needs a food choice, an agent must check the returned question before treating it as logged.
- Colmi sport sessions and its live heart-rate keepalive, live workout recording, Health Connect and Strava are outside this release. The website may ask you to pick the ring again, and phone 3D figure speed is unmeasured.

## [0.4.0] - 2026-10-03

### Added
- **Vitals Server.** The Companion is replaced by `vitals-server` (docs/SERVER.md), run on one always-on computer. Its `home`
  role keeps a readable copy of each person's data, so the Coach and agents work while your phone and browser are off.
  It has persons, devices paired by an 8-digit code, backup and restore, and a deploy script for oci-arm with rollback.
- **Lumen Health over MQTT.** The server's broker takes the phone app's messages directly; each message is written to disk
  before it is acknowledged. Devices shows broker logins and counts, and "Allow a new phone".
- **AI through the server.** Sign in with ChatGPT, NVIDIA NIM and OpenCode Zen run on the server, with keys and the
  ChatGPT sign-in kept per person.
- **Agents through the server.** Codex, OpenCode and Claude Code connect to `<server>/mcp` with an agent token (read,
  log or edit scope); no browser tab is needed. Edits are staged for you to apply.
- **Settings › Server.** Connect a browser to your server by address and code, add or remove devices.
- **Ring views and Lumen archive import.** Ring data views, and an importer for Lumen Health's own archive file.

### Changed
- **Per-field sync merge.** Two devices that change different fields of the same item no longer overwrite each other;
  the later change wins per field.
- **One source of truth.** A stream a device records (sleep, steps, body, resting heart rate, HRV) is owned by that
  device; entries by hand become corrections (correction, then device, then nothing). Source priority lists are gone.
- The Companion pairing, the tab bridge for agents and the Companion copy in Settings are removed from the website.

### Fixed
- **The server no longer runs out of memory.** On oci-arm (Node 24) every idle person on the server kept waking the
  others, and with three people open the server stopped answering and grew by tens of MB a second until it was stopped.
  Each person now has its own lock manager, the deploy pins Node 26, and the server caps open people at 4 with memory
  and time limits per person. Proof on the real service: 3 of 3 runs, a Coach tool call in 32 ms, growth at most 123 MB
  per run.
- A browser that gets ring data through sync now shows scores (three causes fixed: one unreadable day stopped every
  day's scores, a chunk merged during an upload was never uploaded, and missed days were not scored on load).
- One ring message no longer stores a new copy of the day's samples: 124 messages store the same as one batch.
- A provider that refuses the key kept on your server says so, instead of "try again in a moment".
- The Coach at 390 px no longer scrolls sideways when a correction card or a long suggestion is shown.
- Revoking an agent key from Settings › Server says it revokes the key, not that it removes a device.
- The Devices card names the ring app's own scores in words ("blood pressure estimate (upper)", not a raw id) and shows
  times like the rest of the card; the history import names its dates plainly.
- Whole-app review fixes (two passes): 23 high findings fixed, among them lost slider edits, double runs of a retried
  command, values that slipped past the planner's safety gate, three ways around the one-source-of-truth rule,
  a sync clock from the year 3000 winning every field, and unbounded files on the server.

### Acceptance walk (plan 03 "Final scope")
| Promise | How it was proven | Result |
|---|---|---|
| The server does the work (pairing, providers, Coach, agents, no Companion) | Q8 journeys against vitals-server: J1 pair by code and revoke, J2 providers through the server, J3 Coach through the server with a scripted model (local server copy), J4 two devices through the server, J5 agent keys and MCP (Codex included), J6 no Companion wording, J7 route hygiene | J1 18/18, J2 25/25, J3 29/29, J4 12/12 (meal on the other device in 0.27 s), J5 20/20, J6 5/5, J7 33/33 |
| One source of truth per record (correction, then device, then nothing) | Q9 J4 on vitals-server: Today shows the ring's night with Correct; a correction in the sheet and one through the Coach win, survive a replay of the ring's data and can be undone; scores follow | 14/14; contract tests 9/9 and a 300-case property test |
| Lumen Health over MQTT | Q9 on vitals-server: J1 live stream through a real MQTT client into the broker, J2 replay, resend and dead letters, J5 history import then stream; J1b and the identical-batch tests: the broker and a file import give the same records | J1 9/9, J2 12/12, J5 3/3, J1b 5/5; restart safety (local) 8/8 |
| Per-field sync | E30: per-field clocks with a merge on receive; Q8 J4: two devices edit different fields offline, both kept | 11 unit tests incl. a 200-history property test, 6 real-engine tests; Q8 J4 12/12 |
| Whole-app review, two passes | V1 (8 areas) and V2 (pass 2 plus the server and website code) | V1: 13 high, all fixed; V2: 10 high, all fixed, 9 of 10 medium fixed |
| The oci-arm incident and its fix | E32 (caps, limits, unit memory) and E34 (cause found on oci-arm, fixed, proven on the real service) | E34: 6/6 repro runs pass after the fix (0/1 before); real service 3/3 |
| Hotfix 0.3.3 | sync resumes on load (shipped separately, deploy run 37116414274) | live 2026-10-03 16:00 IST |
| Release gate (Q11) | `pnpm typecheck`, `pnpm lint`, `pnpm test:release`, `pnpm audit:planner`, `pnpm build`, the server build and its tests | 0 type errors, 0 lint problems; 6,248 tests passed, 185 expected to fail, 0 failed, plus 103 serial; planner audit 17 part files + report passed (47 min); build ok; server 181/181 |
| Whole-app runs on the release build (Q11) | Q3 journeys without the Coach (13 scripts); Q6 visual pass of the screens changed since Q10 at 390/768/1440 px in both themes | Q3 2,205/2,205, the same as 0.3; Q6 60 screenshots, none scrolls sideways after the fixes |

### Waits for the owner
- The owner's data onto the server: `vitals-server persons add "<name>" --tz Asia/Kolkata --join` with the sync phrase,
  then pairing this PC and the phone (docs/HANDOFF.md, docs/SERVER.md "Migration steps").
- The phone: Lumen Health's broadcast settings and the one-night check (`qa/scripts/Q9/phone-checklist.md`).
- **Coach with the owner's real ChatGPT sign-in, through the server (done 2026-10-03 evening).** The sign-in was moved
  from the owner's PC to a throwaway person on oci-arm with `siwc export` / `siwc import` (one copy, renewed by the
  server) and `qa/scripts/Q8/j3-siwc.mjs` ran three times against the real model: every typed message got a reply with
  tools offered; real tool calls changed documents (a plan started and re-planned, a meal logged by the Coach, a session
  logged, a travel period applied, goals suggested). The scripted checks pass 10/12, 18/26 and 17/27 per run because the
  real model asks clarifying questions (amounts, walking or running, which dates) that the one-shot script does not always
  answer; the stand-in variant of the same journeys is 29/29. Evidence: `qa/results/Q8-J3-siwc-runs.json`. The sign-in
  now lives on the server (person `q8-siwc`) and moves to the owner's person when that person is created.


### Known limitations
- Copies of ring samples that reached the relay before this release stay there (the relay never deletes uploads).
- If four people on one server all ran away in memory at once, the whole server would be stopped and restart after 5 s.
- Sync groups made by testing stay on the server's relay (37 on oci-arm, encrypted test data).
- Small open items: a QA-only base address for providers, one 401 sentence on the server's pairing routes, the
  pairing help names `devices code` (both commands work), and an accessibility note on the intake summary rows.

## [0.3.3] - 2026-10-03

### Fixed
- **Sync resumes after a reload.** Since 0.3.0 the app no longer started its sync engine on load (a QA change dropped the
  call), so a paired device only synced while the Settings › Sync page was open. It starts on every load again; a guard test
  keeps it.
- **Review pass fixes across the app** (whole-app static review, pass 1): a non-numeric age or body value no longer slips
  past the planner's safety gate; a double tap on Start, Apply or a retried command no longer runs twice; sleep and fast
  logs use the 04:00 day; pounds and inches are stored in the right unit; a failed Coach request is no longer charged to
  the monthly cap; raw provider errors and raw placeholders ("{date+12w}") no longer show on screen; the HOMA-IR note
  prints the computed value; kJ shown beside kcal in seven more places; the "fill the missed days" offer appears only on
  today; Today, Food and Train follow the kJ setting; Escape returns focus to the opener; one undecryptable row no longer
  blocks the whole store; "Erase this device" clears the blob database and device keys; Sign in with ChatGPT refresh and
  sign-out no longer race.

## [0.3.2] - 2026-10-03

### Fixed
- **The Coach through the Companion works.** The Coach's requests to a "(via Companion)" provider carried no pairing, so
  the Companion refused them and the Coach said "Your key was refused". They now go through the browser's pairing, and an
  unpaired browser is told to pair first (Settings › Agents).
- **Sign in with ChatGPT can use Vitals' tools.** The ChatGPT-plan backend requires streamed requests and a description on
  the tool namespace; the Companion now streams on the caller's behalf and describes the namespace. "Check what the model
  can do" and the Coach's logging and lookups work with it; "Load the model list" shows the plan's models (it listed 0).
- `vitals-companion proxy` on a busy port says that a Companion is already running and how to pair, instead of a stack
  trace; `vitals-companion service --write` creates the folders its unit needs (the unit failed to start without them).
- Settings › Agents no longer shows "not found" beside a filled Companion status when the first look ran before the
  Companion was started. Settings › About shows the real version.

## [0.3.1] - 2026-10-03

### Fixed
- Settings › AI provider: **Sign in with ChatGPT (via Companion)** can be chosen (the Companion ships it; sign in once with
  `vitals-companion siwc login`). Its old note said it was still coming.
- Providers through the Companion: a **Load the model list** key fills the model picker from the provider (OpenCode Zen
  lists its full catalogue even before a key is set), and **Test connection** now reaches the Companion with the browser's
  pairing instead of failing silently; when the key is missing it says which command adds it.
- When the Companion is running but the browser has not allowed local-network access, Settings › Agents and the model list
  now say so and how to allow it, instead of "not found".

## [0.3.0] - 2026-10-03

### Added
- **Questions you can go back to.** Every intake chapter keeps a list of the questions you answered, each with your
  answer and a Change key. Each question has Back, Ask me later and Next, and leaving and coming back shows the same
  question in a fixed order. A follow-up question names the answer it depends on, and 45 questions were reworded so
  each one makes sense without the screen before it.
- **Measured maintenance as ordinary questions.** After the maintenance estimate at the end of "A normal day", the
  intake asks whether your maintenance or resting energy was ever measured, and if so the figure, how it was measured
  and when. A resting value from a breath test (metabolic cart) is used as your resting energy. The Body page asks the
  same questions in its Maintenance panel.
- **Kitchen, cuisines, staples and pantry.** Grouped, searchable lists of 181 pieces of kitchen equipment, 139 cuisines
  (78 of them Indian), 288 staples and 546 pantry items, with usual items for 17 regions one tap away, "I also have…",
  a note per item, "I own it but don't use it" and paste-a-list. Edit them later in Settings › Kitchen and on the Food
  tab's pantry page. Telling the Coach "I have these at home" updates the same pantry. The Coach's recipes use your
  equipment and pantry, and each recipe says which equipment it needs.
- **Supplements you take or have at home.** The supplements question has separate answers for "I already take some"
  and "I have some at home but don't take them". Each supplement gets a row with the amount and unit, morning · midday ·
  evening · night, and taking / have it, don't take / not for me. An amount above the usual upper limit shows a warning,
  never a refusal. The same row is used in the intake, Settings › Supplements and the Food tab. Plans may use what you
  take or have at home and never suggest one you marked "not for me".
- **Suggest goals from my answers** on the Goals page. Only when you press it, Vitals proposes ranked goals with
  targets and limits from your answers, one reason per goal, and lists what is missing instead of guessing. Apply, Add
  only new goals, Clear and Undo; nothing runs until Find plans. With a Coach provider the Coach may reword and add to
  the proposal, but its answer is checked against the built-in rules and replaced by them when it disagrees.
- **Blood markers.** An optional chapter after food: skip it, type the values, or give the Coach the lab report as a
  PDF or photo. The report is read on your device first; patient details are removed before any AI call, and nothing
  is saved until you confirm each value in a review table. 27 markers and 157 rules from new research write-ups set
  caps, warnings, re-asks and retest reminders; nothing is banned outright. Plans, the Food tab and the Coach say which
  reading changed something ("because your LDL was … on …"). Progress shows marker readings, and the Evidence library
  has a "Blood markers and diet" topic.
- **The Companion on your computer and your server** (version 0.2.0). `install` puts it on your PATH, `doctor` checks
  the computer and prints the command for each gap, `service` writes a systemd user unit, `agents register` sets up
  Codex, OpenCode, Claude Code and the ChatGPT desktop app, and `keys import opencode-zen` copies an OpenCode Zen key
  without showing it. The sync relay runs on a server in your Tailscale network (`tailscale serve`, port 8443 when 443
  is taken). Setup and results: docs/COMPANION.md.
- **Proposals** in Settings › Agents: changes that agents or the Coach staged for you, who proposed them, what they
  would change and until when, with Apply and Dismiss.
- Settings › Agents and Settings › Sync show what the Companion actually detects: connected tab, Tailscale, which agent
  apps are installed and set up, which agents used Vitals recently, the Coach providers, and whether the sync server
  answers now.
- **Quiet mode** in Settings › Appearance: words instead of numbers on the daily screens, and no calorie talk from the
  Coach.
- Log a fast by hand on a day that has none planned (Today menu › Log a fast…).
- The Coach accepts a PDF lab report, also with models that cannot read images.
- Evidence topic "Kitchen, pantry and recipes".

### Changed
- The "Correct it" slide-in panel on the maintenance card is gone; no panel opens anywhere in the intake.
- The intake progress bar sits on its own centred row under the chapter title on phones and to the right of the title
  from 768 px wide, with one segment per chapter; blood markers is drawn as optional.
- The "What we'll use" summary card has proper inner padding, its key lines up with the rows, and the "asked later"
  row is hidden when nothing was put off.
- **Plan ladder after the long search.** Easy now has its own search for the smallest change that keeps at least half of
  Hard's progress on your first goal. A longer search keeps the quick search's Medium and Easy ("from the quick search")
  when its own are no better, and never shows fewer plans without saying why. Medium has its own distinctness margin:
  in the 17 test requests it is shown in 13, 11 and 13 at the quick, standard and exhaustive searches (3, 6 and 4
  before), and Easy in 13, 12 and 13 (5, 10 and 11 before).
- When the Ideal is the same plan as Hard there is no second card: Hard says "None of your limits is binding; the Ideal
  is this same plan." and lists the limits that were lifted without effect.
- Effort bars use one scale on every card, from how you live now to your limit, with a small legend; only the Ideal
  draws a marked part past your limit. The card says that effort is the average of seven parts, and the ladder says the
  Ideal is not meant to be harder, only free of your practical limits.
- Plans that were left out appear as chips with their reason under the ladder graph, and the cards close up with no
  empty column. With fewer than two plans the graph shows how the search progressed; the effort axis is labelled in
  words.
- Rows that open nothing have no hover colour. Rows that open something get a faint shift of the card colour, the text
  colour never changes, and text stays at 4.5:1 contrast or better in both themes.
- Slide-in sheets on the daily screens (start a plan, busy or away, weekly check-in, meal and session loggers, swap,
  add a measurement, Coach briefing) have the same 16 px inner margin as the rest of the app.
- Numbers keep their thousands together on one line ("2 890" no longer breaks after the "2").
- Coach change cards describe goal and plan changes in plain sentences.
- The grocery list counts pantry items as already at home.
- WebMCP works with Chromium 153 (the browser needs its WebMCP flag); agents in the browser stay off by default.
- When your ChatGPT plan reaches its usage limit, the Coach says so in plain words with a link to your usage.
- Evidence: the 71 references added in 0.2.0 were checked against PubMed and DOIs: 29 confirmed, 40 corrected, 1 not
  found and 1 that is only a handout.

### Fixed
- Re-plan, busy or away, a meal out, travel and pushing the plan back all failed with "no safe plan" on the first day of
  a new plan.
- Swapping training days was refused on Hard and Medium plans that include a fast.
- The Ideal could be missing, or shown as the same plan as Hard although one of your limits held it back.
- Easy could keep less than half of Hard's progress on your first goal.
- Stopping the long search dropped the quick search's Medium, Easy and Ideal.
- Ladder graph labels covered other plans on phones, and the phase strip on ladder cards was an empty coloured bar.
- Food suggested eggs to lacto-vegetarians.
- AI recipe cards showed "carbs ≈ 0 g", and recipe amounts could read as garbled text.
- The Coach's plan proposals were refused, an applied proposal could be applied twice, and Undo could leave an adopted
  change in force.
- Asking the Coach to make a plan or suggest goals failed unless the Planner had been opened first.
- On a phone the Coach's reply could stay below the fold.
- "Tell the Coach instead" on the Food tab lost what you had typed and which meal it was about.
- Settings links could land on the wrong section while the page was still loading.
- The Devices import text still used the app's old name.
- The Companion's sync relay crashed at start on Node 24, and OpenCode refused the Companion's tool list.
- Agents that logged a weight as "weight" were refused; the tool now lists its measurement names.
- Food listed creatine twice with two doses when you already take it.
- The sheet for a Today row did not show the answer you had already logged.
- Repeated text: ladder blood-marker lines repeated their "because" chip, and Plan details used the same words for a
  section and its switch.
- Proposals and "used recently" named agents by internal client ids; they now say Codex (or the ChatGPT app),
  OpenCode or Claude Code.
- The server setup in docs/COMPANION.md now works from an empty folder (native module build checked, lockfile kept
  between deploys).
- Quiet mode is now on by default in gentle mode (the careful mode some safety answers turn on) until you set it
  yourself; Settings › Appearance says why.
- A change could be reported as saved shortly before it was stored, so reading it back at once could miss it.
- Stopping a search early could leave an almost empty Hard plan. Now a stopped search that found nothing better keeps
  the plans already shown and says so, and the long search's progress curve stays visible.

### Known limitations
- Sign in with ChatGPT has not been run against OpenAI: OpenAI's bot check stops scripted browsers before the consent
  page, so it needs your own browser.
- OpenCode Zen through the Companion has not been proven with a real key. Zen's free tier refuses clients other than
  OpenCode.
- Sync through the server was proven between two browser profiles on one computer, not yet from a phone.
- The ChatGPT desktop app loads the Vitals connector only after a restart; its window has not been tested (its bundled
  Codex host passed).
- The Coach journeys were verified against a scripted stand-in model, not a real model.
- The Plan screens offer the quick search and, on desktop, the long search; the standard search is available only to
  the Coach and agents.
- Medium can still be left out as "too close" to Hard or Easy (4, 6 and 4 of the 17 test requests at the quick,
  standard and exhaustive searches), and Hard is not always the least effort for its result.
- Starting the 8-week maintenance starter keeps the plan name "Moderate deficit".
- Settings › Agents logs a harmless "not found" for `/health` in the browser console.
- Supplements you take are allowed in plans but not yet kept in every plan; Today shows your own dose only for a
  supplement the plan also lists, and ticking it logs the plan's dose.
- A saved blood-test report file cannot be deleted yet; Progress shows marker readings without a projection band; 5
  marker rules cite only the project's own research summary.
- The pages for Body, Plan and Today load more script than in 0.2.0; the first load is about the same.
- The food table is a small starter set; the Indian food composition table (IFCT 2017) waits for permission, so most
  pantry items do not resolve to nutrients yet.
- Sync keeps the last change per item, not per field; the device list, revoking a lost device and a printable key are
  not available yet; there is no background sync.
- The wording of the Frame slider is not settled, and the 3D figure has been checked only in a headless browser.
- The phone Bridge app and vendor clouds for rings and watches are not built; the J-Style ring needs its firmware
  password; Web Bluetooth rings have not been tested with real hardware.

## [0.2.0] - 2026-10-02

### Added
- **Adapt a running plan.** "Re-plan the rest", "I'm busy or away…" (busy, travelling, unwell, no training, a meal out),
  pushing the plan back by a few days, editing a plan day and swapping an exercise for a day or every week now work.
  The plan is re-planned around the days you change, from what you actually logged. You see what changes and how your
  goal date moves, and nothing heavier is applied without your consent. Undo takes a change back.
- **Start a plan and live it.** Pick the Hard, Medium or Easy plan (or a Simulator scenario) and begin it on a date. Five
  screens follow a running plan: Today, Food, Train, Coach and Progress, plus Plan details. Planning, the Simulator and
  the Evidence library stay one tap away.
- A daily log for meals, workouts, steps, sleep, fasts, weight and measurements; every entry says whether you typed it,
  a device measured it or the app estimated it. Weigh-ins go through a trend filter, and a weekly check-in re-anchors
  the model to what actually happened.
- A daily adherence score that weighs each skipped item by how much it matters for your goals and credits an equivalent
  exercise or dish fairly.
- **Plan ladder.** The planner returns Hard, Medium and Easy plans inside your limits, side by side with expected
  results, effort and time to target, plus an **Ideal** plan without your practical limits that shows what each limit
  costs. The Ideal is never startable; you can adopt some of its limits instead.
- **Fasting when it helps.** Fasts are planned when they serve a goal you ranked, and every plan says why a fast was used
  or which fasting plan was considered and why it lost.
- **Activity intake.** Describe a normal day (job, steps, walking and standing, commute, recreation) instead of an assumed
  7,000 steps; maintenance energy is shown with what drove it and a likely range.
- **Human figure.** A 3D body on the Body page (simple drawing as fallback), a Frame slider instead of the
  female/neutral/male choice, and a true-to-scale visceral-fat view with a reference band and its uncertainty.
- **Catalogues.** 170 exercises (including Indian traditional training), 64 pieces of equipment and 23 supplements, each
  labelled with whether its mechanism is known and how certain the evidence is. Sessions are built from the equipment
  you have, with a shopping list that says what each item would add. Supplements are opt-in.
- Training and food intake: what you enjoy or avoid, injuries, equipment, diet pattern, kitchen and budget.
- Meal ideas and recipes for each day's targets, with portions and a grocery list, checked against a food table.
- **Coach.** An AI trainer that uses your own provider key (OpenAI, Anthropic, Gemini, OpenRouter, Groq, local servers and
  any OpenAI-compatible address). It can do what you can do in the app: logs apply at once with Undo, edits arrive as
  cards you accept, and destructive actions are never carried out by the model. Keys stay on your device, encrypted.
- Log by talking or by photo: describe a meal, a workout or a whole week and the Coach records it with a range.
- **Rings and watches.** Import Apple Health, Health Connect, Gadgetbridge, Health Auto Export or canonical files, or
  connect supported rings over Web Bluetooth. Vitals computes its own sleep, readiness, HRV, resting heart rate, VO2 max,
  training load and illness signals from the raw readings; vendor scores appear only as labelled vendor opinion. Each
  data stream is off until you allow it.
- **Sync without accounts.** End-to-end encrypted sync between your devices, paired with a 24-word key; you choose the
  relay.
- **Installable and offline,** with an update prompt.
- **Companion** (optional program for your own computer): sync relay, Sign in with ChatGPT bridge and a local connection
  for AI agents. WebMCP in the tab, off by default.
- Evidence library: six new topics, certainty and mechanism labels on every parameter, and the planner's benchmark
  results on the validation page.

### Changed
- Plans are named Hard, Medium, Easy and Ideal instead of A, B and C.
- Maintenance energy starts from your answers about a normal day.
- Every screen cites evidence by topic, with links into the Evidence library; internal codes are gone from the text.
- Your day rolls over at 04:00, so a late-night entry counts toward the day you are still living.
- The first load is lighter (about 200 kB of compressed script).

### Fixed
- A re-plan could report "no safe plan" while the current plan was still safe.
- Settings deep links (Devices, Sync, Coach) opened "Not found".
- Joining a second device could overwrite synced data with defaults.
- "I ate this" on a recipe logged the meal's target instead of the recipe.
- The Ideal plan could score below the Hard plan, or schedule a fast inside a maintenance break.
- A limit's cost could show a loss when relaxing the limit changes nothing.
- Undo of a measurement, note, steps, sleep or fast logged by the Coach failed.
- Plan texts showed internal field names; fast counts, deficit percentages and table headers now agree.

### Known limitations
- The Medium plan is usually left out: for most requests no plan between Easy and Hard is different enough to be a real
  choice, and the plan says so.
- Quiet mode, auto-ease and undo/redo of plan changes are not available yet.
- The food table is a small starter set; a full Indian food composition table is not included yet.
- Sync keeps the last change per item, not per field; the device list, revoking a lost device and a printable key are
  not available yet; there is no background sync.
- The Companion is not published yet; Sign in with ChatGPT has not been run against OpenAI.
- Web Bluetooth rings, real AI provider keys and WebMCP in Chrome have not been tested with real hardware or accounts.
