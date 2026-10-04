# Screen — Scores: body signals computed by Vitals (`/progress#signals`, `/progress/:scoreId`, Today › Body signals)

> v0.2 (2026-10-01). Contract: `docs/SUITE_SPEC.md §4.4` (ScoreDef, ScoreResult, versions,
> rescoring, plan effects, vendor opinion), §4.5 (stream consent), §3.7 (adherence), §3.9 (Today
> biometrics). Research: scores (R9), the owner's Android estimators (R10), living plan (R11).
> Components: `COMPONENTS.md §13.14` (ScoreTile, BaselineGauge), §13.9 (AdherenceDial),
> §13.11 (ChangeCard). Copy follows PLAN item 5 (no internal ids; versions show as "v1.2").
> All numbers, names and dates in this spec are synthetic examples, not real data.

## 1. Purpose

Show what the person's ring, watch or scale says about their body — sleep, heart-rate variability,
resting heart rate, cardio fitness, training load, and warning signs of illness or overreaching —
as **Vitals' own numbers, computed from the raw data**, each with its version, evidence grade,
likely range, the device it came from and how far that device can be trusted. Say exactly what
each score changes in the plan. Show vendor numbers only as the vendor's opinion, beside ours,
never instead of ours.

## 2. Entry points & exits

| In | Out |
|---|---|
| Progress › Signals · Today › Body signals (3 tiles) · a flag notice · a Coach answer ("your HRV is below your normal" → link) · a plan change caused by a score ("Why?") | score detail `/progress/:scoreId` · Settings › Devices and streams (source, consent) · Evidence (method) · the change card it produced |

## 3. Layout

### 3.1 Body signals faceplate (Progress, mobile 375)
```
┌ Body signals ────────────────────── last night ▾ ┐  scope KeyBank: last night · 7 days · 28 days
│ sleep                         [B ●●●○] v1.0       │  ScoreTiles inside one faceplate,
│ 7 h 10 asleep · likely 6 h 10–8 h 10              │  hairline dividers, 1 column on mobile
│ ⌁ ring · Colmi R10 · tier C                       │
│ ───────────────────────────────────────────────── │
│ hrv status                    [B ●●●○] v1.2       │
│ within your normal                                │
│ ├──────░░░▓▓▓▓▓░░──────┤  7-day 42 ms · 38–47     │
│ ⌁ ring · tier C · trend only                      │
│ ┄ Oura says "balanced" · vendor opinion           │  (only if vendor scores are brought in)
│ ───────────────────────────────────────────────── │
│ resting heart rate            [B ●●●○] v1.0       │
│ 54 bpm · 2 below your normal                      │
│ ───────────────────────────────────────────────── │
│ illness watch           ▲ signs of strain         │  flag tile (StatusMark + word;
│                                                   │  level codes never shown)
│ signs of strain · 2 nights                        │
│ → this week's fasts are paused · Undo             │  plan link
│ ───────────────────────────────────────────────── │
│ readiness   index · not a measurement  [D] v4.0   │
│ 64 / 100 · from 4 of 6 parts                      │
│ ───────────────────────────────────────────────── │
│ more: cardio fitness · training load · sleep      │  quiet link list to the rest
│ timing · regularity · blood oxygen · temperature  │
└───────────────────────────────────────────────────┘
```
Desktop (≥ 1024): a 3-column grid of tiles inside the same faceplate (hairlines between cells, not
cards); order: sleep · HRV status · resting HR / flags (if any, first row) · VO2 max · load ·
readiness · then the rest. Today shows only three tiles (sleep, HRV status, resting HR) plus any
active flag.

### 3.2 Score detail (`/progress/:scoreId`)
```
┌ HRV status ─────────────────────────── v1.2 · grade B ┐
│ within your normal                                     │ state word, display width 24
│ ├────────░░░░▓▓▓▓▓▓░░░░──────┤                          │ BaselineGauge lg (320)
│ 7-day mean 42 ms (likely 39–45) · your normal 38–47    │
│ last night 44 ms · ring · Colmi R10 · tier C           │
├─────────────────────────────────────────────────────────┤
│ history  [4 wk | 12 wk | all]                           │ chart: nightly dots (faint), 7-day mean
│ ┄┄┄┄┄┄┄normal range band┄┄┄┄┄┄┄                         │ line, normal-range band; version change
│ ·  ·· ━━━━━━━━━━━━┃━━━━━━━━━━━━  ·                       │ marked "v1.2 from 20 Oct · history
│                   ┃ v1.2 · history rescored             │ rescored"; new device = dashed join
├─────────────────────────────────────────────────────────┤
│ what it changes in your plan                            │
│ below your normal → the next hard session becomes easy  │
│ or rest, and no fast over 24 h starts. Proposed on      │
│ Today; applied by itself only when it makes the plan    │
│ lighter.                                                │
│ recent decisions: 12 Oct · below → eased Tue's lift ›   │ decision log rows → their change cards
├─────────────────────────────────────────────────────────┤
│ how it's worked out                                     │ formula text from the score definition
│ The average of the last 7 nights of ln RMSSD, compared  │
│ with your normal: the 60 nights before that, ± half a   │
│ standard deviation. Needs 3 nights in the last 7 and 14 │
│ nights of history.                                      │
│ inputs: heart-rate variability (night) · 7 nights · ring│ contributors table
│ evidence: probably tracks recovery (grade B) ›          │ Evidence link
├─────────────────────────────────────────────────────────┤
│ about this device                                       │
│ tier C — not independently checked. Vitals uses its HRV │
│ only as change from your own normal, never as an        │
│ absolute number.                                        │
├─────────────────────────────────────────────────────────┤
│ vendor opinion (if brought in)                          │
│ Oura says "balanced" (its own method, not published).   │
│ Vitals doesn't use it for anything.                     │
├─────────────────────────────────────────────────────────┤
│ versions  v1.2 (current, 20 Oct) · v1.1 · v1.0  ›       │ changelog popover; "compare with v1.1"
└─────────────────────────────────────────────────────────┘
```
Desktop: two columns — left (value, gauge, history), right (what it changes, how it's worked out,
device, vendor, versions).

## 4. Display rules for every score

| Element | Rule |
|---|---|
| Name | plain first: "resting heart rate", "heart-rate variability", "cardio fitness (VO2 max)" |
| Kind label | measurement (nothing extra) · **estimate** (chip "estimate") · **index** (chip "index · not a measurement", formula always one tap away) · **flag** (StatusMark + word) |
| Value | number + unit + "likely lo–hi" (80 %) — or a state word with the BaselineGauge — or a band word; never a bare number without its range or normal |
| Version | "v1.2" chip on every tile and detail; tap → what changed and when; history rescored on new versions, old versions kept for comparison |
| Grade | GradeBadge = certainty of what the score claims (A–D); wording follows it: A "does", B "probably", C "may", D "might, by mechanism" |
| Confidence | low / medium / high from the inputs (coverage, device, baseline length): shown as a word in the detail ("confidence: medium — 5 of 7 nights") |
| Device | glyph + "ring · Colmi R10 · tier C"; tier C on heart-rate variability, autonomic load, SpO2 and temperature adds "trend only" and shows change from normal only |
| Source | one device per metric per day, by the person's priority; the source label sits next to the number; devices are never averaged |
| New device | a new normal range; the history joins old and new with a dashed segment and an engraved "new ring" mark |
| Vendor | a separate row "{vendor} says …" in ink-3 under a dotted hairline; labelled "vendor opinion"; never in the primary position, never an input |
| Plan link | if the score changed anything today: "→ eased today's session · Undo" (links the change card) |

**Status states** (from `ScoreResult.status`):
- **ok** — as above.
- **borderline** — the 7-day mean's likely range straddles a normal-range edge: state word
  "borderline (within or below)" and a bracket on the gauge; plan behaviour is the milder one.
- **withheld** — "—" + the unmet requirement in plain words: "needs 14 nights of data · 9 so far"
  with a 14-tick count scale (9 inked). Never a guessed value.
- **insufficient baseline** — the value shows; the normal range reads "forming · 9 of 14 nights";
  no state word yet.

## 5. The scores (v1)

| UI name (id) | Shown as | Needs | Plan behaviour it can drive | Never |
|---|---|---|---|---|
| **sleep** (time asleep) | "7 h 10 asleep · likely 6 h 10–8 h 10" (bands by tier ±30/40/60 min) | one night | replaces the sleep the plan assumed: "plan assumed 7 h 30, you slept 6 h 10" | count unknown minutes as sleep |
| **sleep debt** | "1.2 h behind your need (7 h 30)" | 1 night | over 1.5 h behind → no fast over 24 h starts; training one step easier (applies with Undo by default) | — |
| **sleep continuity** | "91 % of the night asleep · 34 min awake" | 95 % of the night covered | display; feeds sleep quality after 3 poor nights in 7 | call it "efficiency" (rings don't know time in bed); show latency as 0 when unknown |
| **sleep timing** | "midpoint 03:10 · weekend shift 1 h 20" | 3 free + 5 work nights in 14 | timing advice to the Coach | — |
| **sleep regularity** | "78 / 100 · adults' median 81 (middle half 74–86)" | 5 day-pairs | below 74 for 2 weeks → a regularity suggestion (proposal) | invent cut-offs |
| **sleep index** | "82 / 100 · index" with its three parts (duration 50 %, continuity 25 %, timing 25 %) | 1 part | display only (and readiness) | drive the plan |
| **resting heart rate** | "54 bpm · 2 below your normal" (±3/4/5 bpm by tier) | 12 samples a night | updates the model's resting HR where a mechanism exists | flag overreaching on its own |
| **heart-rate variability (night)** | "44 ms" (tier A/B); tier C: "+6 % vs your normal" | one night | observation for the model (tier A/B only) | compare across devices |
| **HRV status** | "within / below / above your normal" + gauge | 3 nights in 7, 14 nights of history (60 for full confidence) | **below** → next hard session easy or rest; no fast over 24 h; Coach told. **above** with rising resting HR and falling performance → Coach told only | — |
| **strain accumulating** | flag word under HRV status | 28 days | feeds the overreaching watch; Coach told | — |
| **cardio fitness (VO2 max)** | "44 ml/kg/min · likely 41–47 · estimate" + method ("from your runs" / "from resting and maximum heart rate" / "field test" / "lab") | one method | sets cardio intensities; observation for the model | come from ring-only heart rate; take the vendor's number as ours |
| **training load** | "this week 420 (heart-rate based)" or "1 900 (effort × minutes)"; "4-week average 380" | HR from tier A/B, or effort ratings | weekly volume rises at most 10 % over the 4-week average (proposal) | sum the two methods; show a 0–21 strain scale; call the acute:chronic ratio an injury risk |
| **autonomic load** | "38 / 100 · index" | sleep or still periods | display and Coach only | ever be called "stress" |
| **blood oxygen (night)** | "95 % average · lowest 89 %" | 30 min of samples | none; flag "worth discussing with a clinician" if the night minimum is under 88 % on 3 of 7 nights | change the plan; tier C absolute values (trend only, reads high on darker skin) |
| **temperature change** | "+0.3 °C vs your normal" | 14 nights | supports the illness watch | absolute temperature from a ring |
| **illness watch** | flag: none · **worth watching** · **signs of strain** · **strong signs of strain** | 7 nights | worth watching → Coach told; signs of strain / strong signs → training easy or rest and planned fasts paused (applies with Undo by default; the fast rule is provisional pending the safety review), re-plan offered | diagnose; use danger styling |
| **overreaching watch** | flag "possible overreaching" | strain on 5 of 7 days with rising load, or HRV below 7 nights running | a lighter week (applies with Undo by default); Coach told | trigger from resting HR alone |
| **readiness** | "64 / 100 · index · from 4 of 6 parts" | heart data (HRV or resting HR) plus one more part | **none directly** — the plan reacts to its parts | be called a measurement; drive the plan |
| **adherence** | AdherenceDial (`living-mode.md §4`) | a plan | revealed adherence for re-planning | streaks; be confused with the model's "plan survival" |

## 6. Flags (illness watch, overreaching watch)

- **Shape and word** (the engine's yellow / amber / red levels are never shown as words or colours):
  yellow → info mark, "worth watching"; amber → caution mark, "signs of
  strain"; red → caution mark, "strong signs of strain". Flags **never** use danger styling — danger
  is reserved for safety rules. No red text anywhere.
- **Copy** (risk first, then what to do, then the option; never a diagnosis):
  > **Signs of strain · 2 nights.** Your resting heart rate is 6 bpm above your normal and your
  > temperature is up 0.4 °C. That often comes before a cold — or after alcohol, travel, a late
  > meal or a hard session. Today's session is now easy, and Saturday's 24-hour fast is paused.
  > Any of these? [Alcohol] [Travel] [Late meal] [Hard session yesterday] [Vaccination] [I'm unwell]
- Confounder keys record context (and soften the flag's plan effect when they explain it). **I'm
  unwell** asks "Mark yourself as ill from today?" → declares illness (the plan re-plans; lighter
  until you say you're better).
- Clinician line when the rules require it (SpO2, persistent red): "Worth discussing with a
  clinician."
- When flags disagree, the most protective plan effect wins: illness (strong) > HRV below > sleep
  debt > training load. The tile says which one is in charge: "The illness watch is deciding today."

## 7. Readiness (labelled convenience index)

Tile: "readiness · index · not a measurement" + value + "from 4 of 6 parts". Detail panel copy:
> **Readiness is a convenience index, not a measurement.** It's a weighted mean of the parts
> available today: HRV 25 %, resting heart rate 15 %, sleep 30 %, temperature 10 %, yesterday's
> training 10 %, food 10 % (4 of 6 available today, re-weighted). A normal day lands around 60–70.
> **The plan reacts to the parts, not to this number.**
Contributors table: part · today's value · its score · weight set → weight used · available.
The formula and weights are provisional (owner to confirm the food part). Rules: withheld without HRV or resting heart rate ("needs heart data"); confidence is never "high";
capped at 40 while the illness watch shows signs of strain.

## 8. How scores change the plan

- Every effect is a **proposal** on Today (and told to the Coach), unless it only makes the plan
  lighter and **Let the plan ease itself** is on (default on, in Plan details) — then it
  applies with Undo and shows as an applied notice: "Your HRV is below your normal, so today's
  lift is now easy. · Undo".
- Copy names the score, its value and the change: "plan assumed 7 h 30 of sleep, you slept 6 h 10
  · effect: tomorrow's interval session is a steady run".
- Every decision is listed in the score detail ("recent decisions") with date, value, version and
  the change it made → its ChangeCard.
- A score with no established mechanism (SpO2, autonomic load, readiness, vendor scores) can only
  be shown and told to the Coach; the detail says so: "Shown and trended only — no established link
  to your plan."

## 9. Versions and rescoring

- A new version rescores history in the background (most recent 90 days first, interruptible):
  chip on Progress "updating scores to v1.3…"; tiles show the old value until the new one is ready.
- History charts mark the change with a vertical engraved line "v1.3 from 20 Oct"; the detail
  offers "compare with v1.2" (both lines, older one dashed).
- The changelog popover: "v1.3 · 20 Oct · heart-rate variability now ignores the first 30 min of
  sleep. Typical change: −2 ms." Never internal names.

## 10. Vendor opinion

- Brought in only if the "vendor scores" stream is on (off by default).
- Shown as "{vendor} says {value or word}" with the vendor's own scale ("Oura readiness 82 of
  100"), in ink-3, under a dotted hairline, with the label "vendor opinion · method not published".
- Never feeds a Vitals score, the plan, adherence or the model; the Coach sees it only if allowed
  and labelled as the vendor's opinion.
- Disagreement is not hidden: "Oura says 'pay attention'; Vitals' HRV status is within your normal."

## 11. States

| State | Behaviour |
|---|---|
| No devices | Body signals faceplate: EmptyStage "**No body signals yet.** Add a ring, watch or scale, or import a file." [Add a device] |
| Stream not brought in | tile absent; "more" list shows it as "not brought in · change" |
| Withheld / forming | see §4 |
| Rescoring | chip + old values until ready |
| Device changed | dashed join + "new normal range forming · 3 of 14 nights" |
| Tier C | values as change from normal only; "trend only" chip |
| Gentle / quiet mode | scores stay (they aren't about weight); readiness and sleep index show as words ("about usual", "lower than usual", "higher than usual") |
| Plan not running | plan-behaviour section reads "When a plan is running, this score can …" |

## 12. Accessibility

- Tiles are list items with full sentences: "HRV status: within your normal. 7-day average 42
  milliseconds, normal 38 to 47. Ring, tier C, trend only. Version 1.2, evidence grade B."
- The BaselineGauge has a text equivalent; history charts have table views (date, value, 7-day
  mean, normal range, version).
- Flags: StatusMark + word; announced politely when they change on Today.
- Version and grade chips are buttons with names ("Version 1.2: what changed").

## 13. What the engine supplies

| Need | Source |
|---|---|
| Definitions | `ScoreDef {scoreId, title, version, released, kind, label, inputs, gates, formula.text, params, output{unit, range, display}, uncertainty, evidence, planEffects[{target, rule, priority}]}` |
| Results | `bio.scores` → `ScoreResult {scoreId, version, scope, status, value, state, band{lo, hi, level}, confidence, contributors[], sourceIds, computedAt}` |
| Baselines | `bio.baselines` (normal range per metric and device epoch) |
| Sources and tiers | `bio.sources` (label, tier, priority, policies) |
| Today | `TodayView.biometrics {lastNight, restingHr{value, vsBaseline}, hrv{state, metric}, flags[{id, level, text}]}` (UI maps `normal` → "within your normal") |
| Decisions | `decisionLog` rows `{scoreId, version, value, band, decision, planVersion, conversationId}` |
| Rescoring | `bio.rescore` job |
| UI never computes | values, bands, states, flags, effects |

## 14. Decisions & rationale

- **Our number leads; the vendor's follows, labelled.** Vendor methods are unpublished and differ;
  showing them as opinion keeps the person informed without letting an opaque number steer a plan.
- **Every score says what it changes.** A number that silently moves a plan is worse than no
  number; a number that changes nothing says so.
- **Flags are never "danger".** Danger styling means a safety rule; strain signals are protective
  nudges with likely everyday causes, and the copy says so.
- **Cheap devices give trends, not absolutes.** Tier C heart-rate variability, oxygen and
  temperature are shown only as change from the person's own normal.
