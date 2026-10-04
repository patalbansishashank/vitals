# Changelog

All notable changes to Vitals. Dates are release dates (IST).

## Unreleased

### Added
- **MQTT over TLS for phones that cannot resolve tailnet names.** The server's broker can also listen on TLS (`ssl://`) on the
  server's tailnet addresses, using a certificate Caddy already keeps for a public name that points at the tailnet. Lumen Health
  on a phone with Tailscale DNS off connects to `ssl://hermes.example.com:8883` as before; only the login changes.
  `deploy/vitals-cert-sync.*` copies Caddy's certificate hourly and restarts the server when it is renewed. Documented in
  `docs/SERVER.md`; four broker tests cover it (valid client, bad password, untrusted certificate, plain text).

### Changed
- **A ring never asks for a password.** The J-Style 2301 driver now sends V0789 firmware's passcode on its own: it is a
  protocol constant built into the driver (`src/biometrics/core/ble/jstyle2301/passcode.ts`, stored as bytes). The "Ring key"
  field in Settings › Devices, the staged credential and the "type the key" messages are gone. The passcode is never shown,
  logged or captured, and a test scans every tracked file to keep it in that one file.

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
