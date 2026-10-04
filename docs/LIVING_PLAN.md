# Living plan — engineering guide (E5)

**For:** E4 (commands and store), E6 (planner v2), E10 (biometrics), E13 (Today and Living screens), E9b (Coach tools).
**Normative sources:** `docs/SUITE_SPEC.md` §3 (lifecycle, logging, estimation, adherence, drift, Today) and §4.5,
`docs/PLANNER_V2_SPEC.md` §7–§9.3, R11 (`plan/01-after-launch/research/R11-living-plan.md`). This file says where each
rule lives in code, the signatures to call, the constants chosen, and what each package still has to wire.

---

## 1. Where the code is

| Path | Tier | What |
|---|---|---|
| `src/living/**` | pure (no React, store, clock, randomness) | lifecycle, calendar, prescription snapshot, logs, `toLoggedDay`, adherence, drift, Today, re-plan, start, the estimation loop over documents |
| `src/engine/assimilation/**` | engine-pure | trend filter, energy-balance bias δ, realised schedule, replay, weekly check-in, snapshot re-anchoring, the run hooks below |
| `src/engine/core/snapshot.ts` + small hooks in `core/loop.ts` | engine | CR-L1 day-stamped snapshots |
| `src/engine/types/result.ts` | engine | `RunOptions.captureSnapshotAt / startDay / anchors / intakeOffsetKcal`, `EngineSnapshot.day / latch / tracePrefix`, `AnchorSpec`, `AnchorApplied`, `IntakeOffset`, `SimulationResult.snapshots`, `meta.startDay / anchors` (all additive) |
| `src/features/planner/startPlan.ts` | pure | "Start this plan" next to "Open in Simulator" (`startPlanFromOption`) |
| `src/commands/living/index.ts` | headless | executors for E4's living-plan command stubs (thin: read documents → `@/living` → write) |

SUITE_SPEC §0.3 names `src/engine/living/`; the package brief moved the pure domain to `src/living/` (it depends on E8's
catalogue for equivalence, which the engine must not import). Engine-touching parts stay in `src/engine/assimilation/`.

`import … from '@/living'` gives everything; `@/engine/assimilation` gives the engine side.

## 2. Data flow

```
PlanDoc + PlanVersionDoc ──freezePrescription(date)──► PrescribedDaySnapshot  (dayStatus.prescribed, at rollover)
LogEntry[] + MeasurementEntry[] + DayStatusDoc.marks + DayObservations (E10)
        └─toLoggedDay──► LoggedDay {inputs: DayTemplate, items: ItemOutcome[], coverage} + AdherenceScore + realised fast
past LoggedDays ──realisedSchedule──► Schedule (logged days replace forecast days, day 0 = plan start)
records (ConfirmedStateRecord[]) ──anchorsFromRecords──► AnchorSpec[] + IntakeOffset[] (δ steps)
daily:   dailyAssimilation → runReplay (from the cached anchor snapshot) → trend filter (no anchor move)
weekly:  weeklyCheckIn → runCheckIn: replay → filter → δ → anchor → confirmed replay → ConfirmedStateRecord + ConfirmedState
Today:   buildTodayView(prescription, logs, score so far, trend, drift, trend weight vs forecast band, notices)
re-plan: pickReplan(triggers) → buildReplanRequest → PlannerPort.replan → checkReplan → adoptionPolicy → versionFromReplan
```

`projectLiving({ docs, today, tz, now })` (`src/living/projection.ts`) runs the whole read path above over the plan's
documents in one call and returns the days, scores, trend, revealed adherence, assimilation, drift and the `TodayView`.

Only raw inputs and `ConfirmedStateRecord`s sync. Snapshots are rebuilt by replay (`confirmedStateFromRecord`) and cached
in `derived` under the record's `inputsHash`; `dailyAssimilation` uses the cache only while the hash still matches (an
edited past day invalidates it). Identical documents give identical results on every device (tested bit for bit).

## 3. Engine contracts (CR-L1, CR-L2, CR-L3)

- **CR-L1 day-stamped snapshots.** `runEngine(rp, compiled, { captureSnapshotAt: [k] })` → `result.snapshots[k]`, the
  state at the START of day k (before its runtime energy references), with the core's block latch and the safety trace of
  days [0, k). `{ initialSnapshot: snap }` with a day-stamped snapshot starts the main loop at `snap.day`; the compiled
  schedule is still the whole plan from day 0, so absolute day/hour indices stay valid. The key excludes the horizon
  (restores into longer or shorter runs; per-day state arrays are copied as a prefix) but **keeps the series mask**
  (composition advances regional depots only when a regional series is recorded) — deviation from CR-L1's wording, for
  exactness. `RunOptions.startDay`, when given, must equal the snapshot's day. Tested bit for bit across horizons on the
  16 real modules (`core/__tests__/snapshotDay.test.ts`). Replays always record `REPLAY_SERIES`, so their snapshots chain.
- **CR-L2 anchors.** `RunOptions.anchors: [{ day, tissueMassKg, split? }]` sets FM + FFM_act at the start of `day`. The
  residual goes to fat and lean by the composition module's own partition (its deficit energy share when the residual is
  a loss, the surplus share when a gain, converted to a mass share at ρF/ρL; Forbes as fallback), or to a measured
  whole-body fat fraction (`split: { fatFrac }`, DXA). Glycogen and labile water are untouched (the filter's observation
  already has the engine's water terms removed). Depots, skeletal muscle (`smLossShare` of the lean change) and the bus
  masses follow. The jump is booked in `meta.anchors` (`storedEnergyKcal = ρF·ΔFM + ρL·ΔLT`) and never enters the flux
  identities: O-4/O-5 hold on both sides (tested with `checks: true`). The function is
  `assimilation/runHooks.applyTissueAnchor`; it writes composition's state fields, so it checks their shape and throws
  otherwise — when the engine owner adds a `reanchor` hook to composition, it becomes a call to that hook.
  `reanchorSnapshot(snapshot, spec)` does the same on a captured state (equals the in-run anchor bit for bit).
- **CR-L3 intake offset.** `RunOptions.intakeOffsetKcal: [{ fromDay, kcal }]` (step function) scales every meal of an
  eating day by (E + δ)/E (the day's own macro mix; alcohol and carbohydrate during exercise unchanged; zero-intake days
  untouched). The intake echo series (`inEnergy`, …) keep the logged/prescribed values. **Deviation:** the modules
  (appetite included) see the offset intake; excluding it from appetite needs an intake-module change (engine owner).
  δ = 0 is bit-identical to no option (tested).

## 4. Trend filter and δ (SUITE_SPEC §3.5; constants in `assimilation/params.ts`, `ASSIMILATION_PARAMS`)

Local-linear-trend Kalman on y = scale − engine labile water (the replay's `waterWeight` at the wake hour: glycogen with
its water, ECF/sodium water, gut contents), state [w, r], F = [[1,1],[0,1]], one predict step per day (gaps accumulate
process noise with elapsed time), RTS smoother for display and the day-of-week offset, EWMA α 0.1 display line.

| Parameter | Value | Range | Grade | Note |
|---|---|---|---|---|
| `sigmaRel` (σ_rel, standardised) | 0.5 % of body mass | 0.4–0.8 % | C | within-person 1-day SD 0.53 % (PMC10653631, n = 1) |
| `sigmaRelUnstd` | 0.65 % | 0.6–0.7 % | D | not morning-fasted |
| `qW` (q_w) | 0.03 kg/d at 75 kg | 0.02–0.05 | D | scales linearly with body mass |
| `qR` (q_r) | 0.005 kg/d per day at 75 kg | 0.003–0.01 | D | |
| `rateInitSdKgD` | 0.05 kg/d | 0.02–0.1 | D | start of the filter |
| `outlierSigma` / `outlierRMult` | 3.5 √S / ×10 | | D | flagged, never deleted |
| `eventRMult` / `eventDays` | ×4 / 4 d | 3–5 d | D | illness, travel, creatine start, diet break, block start |
| `gapResetDays` / `gapResetSdKg` | 14 d / 1 kg | | D | |
| `dowMinDays` / `dowShrink` | 42 d / 7 | 3–14 | D | weekday offsets, sum zero, shrunk |
| `ewmaAlpha` | 0.1 | 0.1–0.2 | D | display only |
| `checkInMin7` / `checkInMin14` | 4 / 10 weigh-ins | | D | check-in gate |
| `biasPriorSdKcal` | 150 kcal/d | 100–200 | D | +50 when > 70 % of logged energy was AI-estimated |
| `biasClampKcal` / `biasMaxStepKcal` | ±300 / 100 per check-in | | D | |
| `biasWindowDays` / `biasMinWeighIns` / `biasMinIntakeDays` | 20 d / 10 / 4 per week (both weeks) | | D | δ gate |
| `girthSdCm` / `girthMinWeeks` | 0.8 cm / 3 weeks | 0.7–1.0 | C | waist only nudges the split |
| `biaSdPct` / `biaMaxGain` | 2.5 points / 0.3 | 2–4 / 0.2–0.5 | D | consumer body fat never overrides |
| `dxaSdPct` / `modelBfSdPct` | 1.25 / 2 points | | C / D | DXA re-anchors composition |

None of these is in the physiology registry (never drawn, no registry-hash change). δ: `δ_meas = slope(y − E)·ρ + δ_applied`
over the 20-day window, E the jump-free engine tissue path, ρ the effective density (ρ + η) of the engine's own fat/lean
mix over the window (Forbes fallback for small changes), SE = σ/√Sxx·ρ; precision-weighted with N(δ_prev, 150²).
Synthetic-truth check (`assimilation/__tests__/checkIn.test.ts`): hidden δ −250 kcal/d → after 10 weekly check-ins
−244 ± 118 (seed 42), trend within 2 SD of the true tissue mass at every check-in.

Anchor target at a check-in on day k: `tissue(start of k) + (w_k − engine morning tissue on k)`, i.e. the morning on k
reads the filtered trend. Hard re-anchors (`hardReanchorReason`): engine/registry change, DXA, ≥ 14 days without a weigh-in
(then trend SD 1 kg), illness > 2 d, ≥ 5 days travel, diet-break start/end, end of a fast ≥ 48 h, new training block;
`weeklyCheckIn({ hard })` skips the weigh-in count (needs one weigh-in in 3 days or a DXA).

## 5. Adherence (SUITE_SPEC §3.7; `living/adherence.ts`)

`score = 100·Σ w_i c_i / Σ w_i` over known items; unknown items drop out of both sums; `coverage` = known weight share;
< 0.6 → `coverageLabel` "based on 3 of 5 items"; < 0.4 → no score; assumed (backfilled) and paused days → no score; days
not yet over → `final: false` ("so far"). Weights: the version's `PlanSensitivities.itemWeights` (floor 0.02, renormalised
over the day's items); without planner sensitivities, `DEFAULT_ITEM_WEIGHTS` (energy 0.34, rtSession 0.20, protein 0.16,
cardio 0.10, fast 0.08, steps 0.05, sleep 0.04, window 0.03, supplement 0.02 — grade D, replaced by E6's values).

Owner's example (test `adherence.test.ts`): items energy 0.4, protein 0.2, strength session 0.2, steps 0.2 →
days 1–3 all done **100, 100, 100**; day 4 session skipped **80**; day 5 back squat swapped for a goblet squat (E8
`stimulusEquivalence` at parity) **100**.

Credit fast forms (single exports): energy 1 within ±max(5 %, 75 kcal), then a linear taper to 0 when the whole planned
balance is undone (overshoot on a deficit day), the other side costing at most 50 %; protein full from 90 % of target
(overshoot 1); sessions by `stimulusEquivalence(...).credit` (parity ≥ 0.90 → 1); fasts `(h − 12)/(target − 12)` (a fast
broken at 18 of 24 h → 0.5); window = share of logged energy eaten inside (± 0.5 h); steps and sleep proportional;
supplements 0/1; T0 marks 1 / 0.5 / 0. `LoggedDayInput.creditOverrides` replaces any credit with E6's `benefitRetained`.
Trend: `A_7` (≥ 3 scored days), `A_28` EWMA half-life 14 d, arrow beyond ±5, "6 of the last 7 days logged". Revealed
adherence: Beta(6, 2) per item type and weekday, fractional updates, half-life 21 d → `BlockAdherence[]`; swap rule
(≥ 8 opportunities, E[c] < 0.5, 80 % upper bound < 0.7) and weekday rule (c < 0.4 on 3 of the last 4) in
`adherenceProposals`.

**Unknown is never failed.** No log, no mark, no device → the item is `unknown`: no score contribution, no "behind"
message, never a trigger (`missedInARow` skips unknowns). For the replay only, it is simulated at its expected credit
E[c] (energy interpolated between maintenance and the prescription, session sets/minutes scaled, a fast kept when
E[c] ≥ 0.5) and listed in `assumedItems`; days without a logged intake are excluded from the δ gate.

## 6. Drift (SUITE_SPEC §3.8; `living/drift.ts`)

Trend vs the forecast's P10–P90 for the day (`forecastBandOn(version, day)`), states ahead / onTrack / behind by goal
direction, hysteresis (a state changes only when two consecutive check-ins agree), goal-date shift shown only when
|shift| ≥ 3 d, outside the band and outside at two check-ins running; cause split (adherence from logged − prescribed
intake, expenditure from δ, water noise = rest); one action per verdict (`keepGoing` / `easeOptions` when adherence
explains > 60 % / `replan`); calm, self-compassionate copy ("your body is burning about 120 kcal a day less than
assumed; the plan has been updated").

## 7. Today (SUITE_SPEC §3.9; `buildTodayView(TodayInput): TodayView`) — for E13

- `prescription` is the frozen snapshot (meals with clock times and macros, window, sessions with slot keys and the
  composed session, fast as instants, steps, sleep, supplements, weighted items). `remaining` is null in quiet mode.
- `checklist[]` items carry the command to dispatch: `log.measurement` (weigh-in first, at `intentions.weighInClockH`),
  `log.markDay`, `log.meal`, `log.session`, `log.fast`, `log.supplement`, `log.steps`, `log.sleep`. Minimal mode keeps
  only the weigh-in and "Day as planned".
- `adherence.today` is "so far" (`final: false`) until rollover; quiet mode hides numbers (score, A7, A28, spark).
- `trendWeight.todayExpected` is the forecast band for today; show the trend line as the hero, raw weigh-ins faint.
- `notices`: welcome back (with the one-tap `log.bulk` "as planned" backfill, `assumed: true`), check-in due, minimal
  mode, paused; plus whatever the caller passes (safety, proposals, sync, pending Coach changes).
- `coachPrompts`: coverage label, the costliest item ("it carried 40 % of the day"), "plan assumed X, you measured Y".
- Copy produced here contains no dossier numbers, section marks or package ids (tested).

## 8. For E9b (Coach tools)

Read tools should return `TodayView`, `DriftReport`, `AdherenceScore` (with `items[].why`), `AdherenceTrend` and the
check-in output; the model explains them and never computes numbers. Log writes carry `EntrySource` (`by`, `method`,
`conversationId`, `toolCallId`) and `confidence`; `isAiEstimated` and `aiEnergyShare` drive the trust ledger (> 70 %
widens the δ prior). `defaultRelSd(source)` gives the SD by method when an estimate arrives without one (db/label 8 %, AI
text 25 %, photo 35 %). Schedule changes go only through `plan.shift` / `plan.replan` proposals (`VersionProposal`).

### 8.1 Pantry convergence (batch 02, E17; SUITE_SPEC §13.3, `docs/CATALOGUES.md` §7.1)

What the person has at home lives in two documents, `kitchen/me` (equipment, cuisines, staples) and `pantry/me` (food at
home). The picker (intake food chapter, Settings › Kitchen), the Food tab (`/food/pantry`, the pantry faceplate) and the
Coach all write these same documents through `kitchen.*` / `pantry.*` (`docs/COMMANDS.md` §9c), so there is one list.

| Path | How it converges |
|---|---|
| Coach: "I have X at home" | `pantry.add` with `source: 'coach'` (forced for AI and agent actors); a long list goes through `pantry.parseList` first; equipment ("I also have a soda maker") through `kitchen.add`. Applied at once with Undo, never staged; the Coach confirms in one line |
| Paste-a-list | `pantry.parseList` (catalogue matcher only, nothing written) then `pantry.add` with `source: 'paste'` |
| Picker | `kitchen.set` (whole lists) or `pantry.add` with `replace: true` (the picker's whole list) |
| Adding an item again | Confirms it (`lastConfirmedAt`); no duplicate entry |

**Briefing.** The Coach briefing reads `kitchen.get` and `pantry.get` into a kitchen section (≤ 1000 characters, about
250 tokens; `kitchenBlockFromViews` in `src/catalogues/kitchen/coach.ts`): equipment with notes and `ownNotUsed`, top
cuisines, staples, pantry labels (≤ 60). It also carries the recording rule above (`KITCHEN_RULE` in
`src/ai/coach/briefing.ts`) and the labels of up to 10 items in `askStillHave`. With nothing recorded it says "Kitchen:
not told yet". The visible "What the Coach knows" panel gets "Kitchen: n pieces of equipment, m items at home."

**Recipe constraints.** The recipe provider (`src/ai/coach/recipes.ts`) reads `kitchen.get` and `pantry.get` before every
request (a failed read counts as "not told") and sends `KITCHEN = {equipment, equipmentNotes, cuisines, staples, pantry,
preferPantry, timeBudgetMin?, skill?}`. The prompt allows only equipment in the list (owned-not-used may be suggested,
saying so), no baked dishes without an oven, OTG, air fryer or convection microwave, prefers dishes that use the
person's appliances, builds mostly from the pantry when `preferPantry` (else from staples) and favours cuisines in rank
order. Each recipe lists `equipment[]`; the recipe card and sheet show "Needs: … · you may not have: …".

**"Still have it?"** Only perishable pantry items whose `lastConfirmedAt ?? addedAt` is more than 14 days old are listed
(`askStillHave`). The Coach asks only when a recipe depends on one, and never removes an item unless the person says it is
gone (`pantry.remove`). `/food/pantry` has a "Still have these?" confirmation. Nothing is removed by time.

**Migration from intake v0.2.** Lazy: until the first write, `kitchen.get` / `pantry.get` read `intake/me.kitchen`,
`diet.cuisines` and `diet.staples` through the R12 §3 mapping and return them with `fromIntake: true`; reads write
nothing. The first write persists the migrated lists together with the edit. The v3 intake's picker answers are mapped
back to the v0.2 option ids for `DietProfile` (I2), so the engine's food profile keeps cuisines, staples and equipment.

**Open.** `food.candidates` (`readFoodSetup` in `src/commands/food/context.ts`) and the grocery "already have" set
(`src/features/living/food/groceries.ts`, the ⋯ Pantry panel) still read the v0.2 `intake.kitchen.pantry`, not
`pantry/me`. They should read `pantry.get`. Recipes already do. Food links resolve to nutrients only for the 19
fixture-linked items until `fdcId → FoodRecord.id` is mapped with the food bundle.

## 9. Wiring still to do

**E4 (commands/store).** E5's executors for the stubs in `src/commands/defs/living.ts` are in `src/commands/living/index.ts`
(importing it replaces each implemented stub's `execute`; ids, schemas and policies stay E4's). **Wire it with one line in
`src/commands/index.ts`: `import './living';` after `import './defs/living';`** (until then they are registered only where
the module is imported, e.g. its test). Implemented: `today.get`, `day.get`, `plan.get`, `plan.versions`, `plan.adherence`,
`plan.drift`, `log.get`, `plan.start`, `plan.discard`, `plan.pause`, `plan.resume`, `plan.end`, `plan.adoptVersion`,
`plan.rejectVersion`, `plan.checkIn`, `log.markDay`, `log.confirmDay`, `log.measurement`, `log.steps`, `log.sleep`,
`log.substance`, `log.supplement`, `log.subjective`, `log.note`, `log.fast`, `log.edit`, `log.retract`, and (E5b,
`src/commands/living/adapt.ts`, see §9.1) `plan.replan`, `plan.declareEvent`, `plan.shift`, `plan.editDay`,
`plan.swapExercise`. The food, session, bulk and biometrics logs are implemented by their packages. Reads go through
`projectLiving(docs, today)` (`src/living/projection.ts`). The rest of the wiring, by command:
- `plan.start` → `startFromRung` / `startPlanFromOption` / `startFromScenario` (persist `plan` and `version`; reject when a
  live plan exists; `anchorNotes` to the dialog); day ≥ start → `activateIfDue`; first open after the end → `completeIfDue`.
- `plan.pause` / `plan.resume` / `plan.end` / `plan.discard` → `lifecycle.ts`; resume also writes a `reason:'resume'`
  version from `resumeSchedule(parent, P, R)`; sync merges → `resolveLivePlans`; safety → `safetyPause` + an event re-plan.
- rollover (`settings.dayRolloverH`) → `freezePrescription` into `dayStatus.prescribed` (version in force:
  `versionInForce`; paused days: `pausedDaySet` → `paused: true`).
- `log.*`, `log.markDay`, `log.bulk` (backfill `assumed: true`) store entries; `toLoggedDay` per day (score into
  `dayStatus.score`), `effectiveEntries` for edits/retracts.
- `today.get` → `buildTodayView`; `plan.adherence` → `adherenceTrend`; `plan.drift` → `driftReport`.
- after each log/sync (debounced 1 s): `dailyAssimilation` (cache in `derived` keyed by `inputsHash`); on the check-in
  weekday or a hard reason: `weeklyCheckIn` → append the record to `anchors`, then `pickReplan` with `checkInConfirmed`.
- `plan.replan` / `plan.declareEvent` / `plan.shift` → `pickReplan` → `buildReplanRequest` → `PlannerPort.replan` →
  `checkReplan` + `adoptionPolicy` → `versionFromReplan` (+ `versionProposal`); the light nudge →
  `energyNudge` + `applyEnergyNudge` (adopted automatically, with Undo).
- Inject `PlannerPort` (worker client), `sessionCompiler` (E8 `resolveSession` + `toEngineDose`), the observation adapter.

### 9.1 Adaptation commands (E5b)

`src/commands/living/adapt.ts` implements the five plan-changing commands on one path:

1. **Edit.** `src/living/edits.ts` (pure) turns the adopted schedule into the edited one and names the plan days it fixed.
   - `plan.declareEvent`: `noTraining` and `busy` → sessions off on those days, food as planned; `travel` → the same and
     no fasts; `illness` → habitual days (maintenance food) without training or fasts; `socialMeal` → a high-carbohydrate
     occasion on each day (`extraCarbG`, default 150 g, or `extraKcal`; energy becomes kcal = the day's prescription + the
     extra). Busy and travel keep the plan's food rather than the habitual day: the habitual day drops the plan's protein
     and supplements, and before the first check-in its energy pushed training-day energy availability out of the
     planner's P10/P90 energy-bias band (measured on the test plan), so every re-plan around it was refused.
   - `plan.shift`: `noTraining`, `habitual` (habitual day with habitual training), `pushBack` (habitual days inserted,
     every later day, fast and block moved back, `changes.horizonDays` and the version's `plannedEndDate` moved; the plan's
     end date moves when the version is adopted), `swap` (two stretches exchanged, fasts moved with their days);
     `absorb` adds an occasion; `replanRest: false` pins every future day, so the result is the edit with its forecast.
   - `plan.editDay`: an RFC 7396 merge patch over the day template (`id` and `label` locked) for the day, that weekday or
     the rest of the plan.
2. **Re-plan around it.** `buildReplanRequest` with the latest `ConfirmedState` (before the first check-in: a replay
   snapshot at the plan start, the trend at the baseline weight, δ = 0 ± 150 kcal, the R11 prior), the days with
   something logged since the anchor (`coverage > 0`; an unlogged day is unknown and the revealed adherence covers it)
   and `BlockAdherence`. The request carries two additive fields (PLANNER_V2 §7.1, E5b): `pinnedDays` (every candidate
   keeps the edited schedule there, like the lock window; fasts from the search do not start or end on them) and
   `baseline` (the schedule before the edit: the diff, the load check, the validator's "new reasons" and
   `goalDates[].before` / `forecast.before` compare against it). Kinds: the edits run `weekly` re-plans (structure and
   neighbours, warm start, churn hard limits against the edited plan, lock window kept unless safety first);
   `plan.replan` runs the full `event` search with trigger `user` at the plan's tier (or `tier`). The port is the worker
   client's `replan` (`livingWiring.ts`, `tier` now passed through to the coordinator).
3. **Decide.** `noSafePlan` refuses an edit (`invalid_input`, nothing written) and is reported for `plan.replan`;
   `unchanged` writes nothing. Otherwise `checkReplan` + `adoptionPolicy`: adopted at once only when every change lowers
   load, `policy.autoApplyLoadLowering` is on and the person (or the system) made the change; the Coach's and agents'
   changes are always proposals (the bus also stages them). `versionFromReplan` writes the version (`reason` `event` for
   events and shifts, `user` for edits and re-plans) and the plan's `headVersion`; the output is the `VersionProposal`
   plus `diff`, `notes`, `pinned` dates and `cardId` (`version:<planId>:<n>`, the change card id the Living screens
   parse). `impact` now compares with the planner's forecast of the plan before the change from the same state
   (`forecast.before`), not the start-time digest. Undo (inverse patch) removes the version and restores the head.
   (Q3b, Q3-J5-01) Two re-plan rules keep a plan the ladder accepted adaptable: the energy-bias band (δ ± Z90·sd,
   before the first check-in the 0 ± 150 kcal prior) is judged relative to the current plan (the plan in force with the
   person's edit) on the margins it already breaks there, as the harbour does for the logged past (the ladder judges at
   δ alone, so a Medium rung at −24 % broke the band from day 1 and every re-plan, meal out, travel and push-back was
   refused); and when no finalist verifies, the current plan with its deficit eased by 2, 4 … 10 points on the days that
   may change is tried before `noSafePlan`. The nominal margins stay absolute: an edit that breaks a safety limit is still
   refused. Test: `src/commands/living/__tests__/adaptLadderPlan.test.ts` (day 1 and day 10).
4. **Swaps.** `plan.swapExercise` composes the prescribed session (the version's concrete session, else E8's
   `composeSession` from the setup), doses the substitute as `swapOptions` does and scores the swapped session with
   `sessionEquivalence`. Day only: the swap is kept on `dayStatus.swaps[slotKey]` (synced). `everyWeek: true`: a proposed
   version whose `sessions` on that weekday's slot from that date on carry the substitute (each with its own
   equivalence), the engine schedule unchanged; the output reports `weekly.meanCredit` (LIV-09).

Planner fix found on the way (`domain/replan.ts`): when none of the six finalists verified but the current plan still
does, the re-plan now keeps the current plan instead of reporting "no safe plan".

**E6 (planner).** Export the §7–§8 types from `@/engine/planner` and replace `src/living/plannerContract.ts` with
re-exports; implement `replan` (then drop `legacyPlannerPort`, marked TODO(E6)), `computePlanSensitivities` (feeds
`PlanVersionDoc.sensitivities`), `benefitRetained` (→ `creditOverrides`), `projectRealistic` (→ `ProjectionDigest.realistic`).
`ConfirmedState.snapshot` is day-stamped: run the realised schedule from day 0 with `initialSnapshot` and pass δ as
`intakeOffsetKcal`. Scenario-started plans have `rung: 'custom'`; `toActivePlanRecord` sends `kind: 'medium'` and an empty
genome for them (full pipeline) — confirm or widen the type. `RungPlan` start (genome, composed sessions,
`toActivePlan` after anchoring) is a TODO in `startFromRung`.

**E10 (biometrics).** Implement `ObservationAdapter.observations(from, to)` with the person's stream policy applied
(`engine: true` streams only) and one source per metric per day; `observationsFromBioRecords(records, tz)` maps canonical
records and can be reused. Vendor VO2max never enters. VO2max observations are carried in `DayObservations.vo2max` but the
engine has no observation input for the VO2max state yet (engine-owner request, like CR-L2).

**E13 (UI).** Render `TodayView` as is; start dialog from `startDateChoices` + `anchorNotes`; check-in card from the
check-in output (trend, δ, per-block bars `blockBars`, costliest item); drift from `DriftReport`.

## 10. Tests

`pnpm vitest run src/living src/engine/assimilation src/engine/core`: owner's example and score properties, credit
forms, trend and Beta rules; calendar anchoring, pause/resume, lifecycle; prescription freezing; `toLoggedDay` rules
(meals, marks, unknown at expected credit, swaps, fasts, device precedence, backfill); drift hysteresis and goal dates;
trigger table, nudge, stability checks and adoption; synthetic truth runs for the filter and δ; conservation across
re-anchors; CR-L1/L2/L3 exactness; cached-snapshot replay = full replay; end-to-end determinism.
