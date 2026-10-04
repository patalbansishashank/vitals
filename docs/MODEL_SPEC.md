# Vitals — Engine Model Specification (v1, normative)

Status: **v1 contract, 2026-09-30.** Supersedes `docs/ARCHITECTURE.md` v0 for everything inside `src/engine`.
Built from all 21 research dossiers (`research/01…21`, all final) and `docs/INTEGRATION_NOTES.md` (all sections).
Code contracts: `src/engine/types/**`, `src/engine/core/**`, one stub per module in `src/engine/model/<module>/`.
Where this document and a dossier disagree, **this document wins** (it records the ruling); where this document is
silent, the cited dossier section is normative. Every number below is copied from the cited dossier section; values
the dossier marks `UNVERIFIED` / `PROPOSED FIT` keep that status in their `ParamDef.status`.

Reading guide: §0 conventions · §1 modules (one subsection each) · §2 ownership & rulings · §3 evaluation order ·
§4 signal bus · §5 inputs · §6 metrics · §7 events & warnings · §8 uncertainty · §9 validation suite · §10 planner
contract · §11 open risks & build plan.

## Changelog

- **2026-10-01 (after launch, PLAN item 1) — activity intake (E7a; research R1).**
  - *Input (additive, §5.1, §5.5):* `HabitProfile.activity?: ActivityIntake` (work class, work days/hours, commute, steps
    answer with its source, day-off pattern, time on feet at home, recreation); defaults `DEFAULTS.activity`. Absent =
    the pre-intake engine bit for bit (steps = `typicalSteps` ?? 7 000, no non-step terms).
  - *Mapping (§5.5):* new pure module `src/engine/intake/activity` (`resolveActivity`, 50 ParamDefs
    `activityIntake.*`): weekly-mean steps S_hab become `habits.typicalSteps`; occupational, home, cycling-commute and
    recreational energy enter TDEE0 and therefore energy's NEAT0 (the burn-in calibration keeps them); PAL0 warns > 2.4,
    and the non-step answers may not push it above 2.5 (sessions and steps are never capped). `ResolvedProfile.activity` (additive) carries the maintenance drivers (R1 §6 order, Σ = TDEE0), PAL0,
    the NASEM category and the p10/p90 band (σ from components, floored at 12 % skip-all / 10 % answered or BF measured /
    8 % RMR measured); without an intake the band equals the UI's former cv0 by RMR route.
  - *Activity (§1.2):* with an intake the VO2max prior's PA-R row is the 10 §4.14 selector row nearest to PAL0 (R1 §3.4),
    else the steps row as before (`core/resolveProfile.selectorIndexFor`).
  - *R-MAINT:* unchanged — non-step energy is "life as usual" inside NEAT0; the habitual week books zero; same body, same
    S_hab, different job → identical activity adjustment (tested).
  - *Validation (§9.2):* 8 scenarios `R1-*` (FAO lifestyle PAL, NASEM 2023 category equations, IAEA DLW PI, step cost,
    Cambridge index spacing, occupational trend, postal workers, PAL cap, R-MAINT/O-12 invariance, band floors, sleep
    neutrality, desk vs manual steady state): 54 M rows, 47 pass, 7 registered (R1's α0 = 0.10 arithmetic vs the
    engine's ≈ 0.087, and R1's own mixed-job value below its FAO band); TEE oracles `validation/oracle/teeEquations.ts`.

- **2026-10-01 (blocker round) — engine engineer (release check 00:40 IST, docs/QA_FINDINGS.md).**
  - *R-DETRAIN (1), muscle (§1.9):* 09 §4.10 detraining (no loss for ~3 weeks after the last session, then τ_d 70 d) now
    decays **towards a retained floor**: the set-point of a habitual lifter is the untrained, FFMI-derived lean
    (`mBase` = M_acc,0 − trained gains, trained gains = min(M_acc,0, h²·max(FFMI − FFMI_untr, 14's ΔFFMI_train(Y_eff)))) and
    the floor keeps `muscle.detrainFloorFrac` 0.5 [0.3, 0.7] (C, PROPOSED) of those long-term gains; gains accrued in a run
    detrain fully (Psilander). QA reproduction (man 34 y, 178 cm, 88 kg, 1-3 y, 3 lifts/wk, no lifts at 100 %, 18 %E
    protein): lean mass −3.97 → −1.05 kg at 8 weeks (lean tissue −3.81 → −0.94, fat +0.84 → +0.13), −8.62 → −2.23 kg at 20
    weeks (training-attributable loss bounded by 2.8 kg).
    09 #12 re-expressed for the long-term lifter (82 % ± 10 of the losable gains at 20 weeks: 81 %); novice rows unchanged.
    New exports `muscle.trainedGainsAtStart`, `equations.trainedGains0/detrainFloor`; state `mFloor`.
  - *R-DETRAIN (2), "training as usual" (§5.2):* `DayTemplate.habitualTraining?: boolean` (default false) resolves the day's
    sessions from the profile's habitual week (the burn-in sessions) plus any `exercise` extras; compiled marker
    `DayInput.habitualTraining?`; helper `habitualSessionsFor(profile, weekday)` (also exported from `src/engine`).
  - *Keto-adaptation (§1.7, §6):* the displayed `ketoAdaptation` is the labelled combined index 50·(A_f + A_s) ("Keto-adaptation
    index", grade C) instead of 100·A_f; new detail series `ketoAdaptFast` (100·A_f) and `ketoAdaptSlow` (100·A_s).
  - *Fast warnings (§7.2):* the tier rules W-F01…W-F05, their peak value, W-F08/W-F10/W-F11 and the fast log use the planned
    span's meal-to-meal duration (`fastSpans[i].mealToMealH`) — a "72 h" fast reported "71 h" and missed W-F08.
  - *R-REGAIN (coordinator ruling after the blocker report; §1.9):* below M_peak (after detraining) accretion is 09's full
    rate B_r (gap term, habituation, κ_mem) capped at M_peak, the excess form above; `muscle.kMem` 1.0 → 1.3. QA lifter,
    12 weeks off (−1.60 kg), back on the habitual programme: 16-week regain 10 % → 76 % (26 weeks 19 % → 100 %). Validation:
    only 09-13 Bickel old9 (0.30 → 0.35, < 0.9, pass) and young9 moved; no registered row moved.
  - *Warning day attribution (coordinator ruling; §7.2):* rolling-window and trend rules are reported on the days whose own
    values produced the mean/trend (from day 0), fast-related rules on the fast's own days from its first zero-intake hour
    plus the refeed; new `setHitWorst`, per-day own-value arrays in `SafetyState`, `evaluate.hitWindow/recordOwnDay/
    exclusiveBands`. Warning existence and the SafetyTrace (Planner margins) are unchanged.
  - *VLC → high-carbohydrate switch (QA: fat −0.8, lean −4.3 kg in 8 weeks):* the detraining bug, not a partition problem —
    with the lifts painted lean tissue is −0.05 (VLC phase) / −0.09 kg (8 weeks) and fat −1.97 kg; without lifts now lean
    tissue −1.34, fat −1.48 kg (was −4.29 / −0.77).
- **2026-09-30 (final round) — engine engineer (QA findings, docs/QA_FINDINGS.md).**
  - *R-MAINT:* "% of maintenance" resolves against the maintenance at the schedule's planned activity (§5.2; new
    `core/activityReference.ts`; `DayInput.activityAdjKcal/activityDeltaKcal/plannedBalanceKcal`; `EnergySpec.activity`;
    series `inMaintRef`, `inBalancePlanned`; `compileSchedule(…, {activityReference})`); the `maintenance` metric is the
    energy that holds the current body at the scheduled activity (§1.5); TH_C's EI_ref is the day's reference (§1.5);
    R-RTSWITCH (§1.8 2d) makes surplus lean gain monotone in RT volume. Study fixtures that cut intake from baseline intake
    while adding exercise use `activity: 'habitual'` (CALERIE CR + EX, MET-2, Deru, Veldhorst, Pasiakos); 10 V16 uses 100 %.
  - *Maintenance metric (§1.5):* energy that holds the current body at the scheduled activity on the habitual diet mix
    (AT and compensation included, diet-composition terms not) — falls with weight loss and adaptation; t = 0 = the static
    reference.
  - *Ketones (§1.7):* R-KETEX (exercise effects wane with ketonaemia; ≤ 4.7 mM with a session in any ≤ 7-day fast, was
    7-10 mM); daily `ketosisState` = the wake-hour (morning fasting) category; `fuel.cMMax` 200 → 180 (registry low; 04 V4
    Bussau passes); `fuel.cLMax` 420 tested and not applied (moves 05 V3 Deru's exercise arm out of its band).
  - *Safety (§7.2-7.3):* W-05-KETO-FED only in absorptive, non-fasting hours; W-E03/W-E04/W-13-ALPERT on deficit days with
    "averaged over the last 7 days" texts, runs with equal printed value and limit dropped; W-S02/W-S03 need a 28-day
    surplus near fasts; W-F13 counts fasts started in its window; R-T4CAP (`SafetyTrace.fastH7Cap`, also HC-F2);
    R-PLAN-SAFETY `SimulationResult.warningMargins` (`computeWarningMargins`); `SafetyTrace.deficitPct28`.
- **2026-09-30 (late) — engine finisher.**
  - *Rulings implemented:* **R-MORNING** — the entered weight is the day-0 weigh-in weight; daily `scaleWeight`,
    `leanMass` and `bodyFatPct` are weigh-in values, hourly series unchanged (§1.8, §1.10, §3.4, §6, O-5, O-12);
    **R-FASTHUNGER** — 07's fasting-hunger time course in appetite: peak on day 2-3, then falling; refeeding hunger
    sensible (§1.12); **R-SIFAST** — no fasting insulin resistance in the insulin-sensitivity index; it lives in
    carbohydrate tolerance only (§1.14). Also **R-EFAST** (fasting natriuresis scales with body size; `kFast` and
    `fastZeroCarb` retired, §1.10) and **R-RMRDEV** (person-level RMR deviation `energy.rmrIndividualFrac`, ±20 %, drawn in
    ensembles, §8.1).
  - *Contract (additive):* `SafetyTrace.eee7/fastDay/ei28`, `SimulationMeta.checks.t0ScaleKg`, `SeriesDef.description`,
    `core/math.wakeRecordHour`, `core/loop.withRmrDeviation`, `core/compileSchedule.habitualWeekPrograms`; appetite reads
    `hoursSinceIntakeH`, cardiometabolic reads `tissueMassKg`, composition reads `rtDoseFrac` (its V_R copy removed);
    37 stale reader entries pruned; §4 and §6 tables regenerated from `signals.ts` / `metrics.ts` (§11.0).
  - *Fixes and re-fits inside registry ranges:* the resistance-training RIR factor was applied twice to preset sessions
    (compileSchedule); cardiometabolic weight terms use tissue-mass loss instead of −ΔFM/0.75 (§1.14); s_keto bounds
    0.2-0.5 mM on the 24-h mean BHB (§1.14); leptin a_max (men) 0.35 → 0.28, k_ov 1.0 → 0.75, carbohydrate coefficient
    0.30 → 0.37 (§1.11); cellular h50 56 → 60 h and f_fast 0.2 → 0.3 (§1.13); fasting natriuresis E_fast 1.3 L scaled by
    ECF (§1.10).
  - *Validation:* register regenerated with owning module, class, cause, target and reason (97 registered M rows, none
    unexplained); several scenario inputs corrected from the study reports (listed in `docs/VALIDATION_REPORT.md`); 05 V14
    promoted to M; bands, performance (§0.3) and status (§8.3, §9.2, §11) updated. Report: `docs/VALIDATION_REPORT.md`.
- **2026-09-30 — integration passes A1, A2, B** (§11.0): snapshot restore, burn-in re-anchoring, fuel/ketone
  recalibration, habitual-volume equilibrium in muscle, fast-day safety rules.
- **2026-09-30 — v1 contract** after the independent review (`docs/MODEL_SPEC_REVIEW.md`).

---

## 0. Conventions (apply to every module)

### 0.1 Time
- One master step **Δt = 1 h**, no sub-stepping (orchestrator ruling). Fast dynamics use closed forms: exact
  first-order relaxation `x ← x* + (x − x*)·f`, `f = exp(−Δt/τ)` precomputed in `prepare()` (`core/math.relax`,
  `relax2` for asymmetric τ); Michaelis–Menten emptying by its exact Lambert-W solution (`mmRemaining`); gamma(2)
  absorption kernels by their closed-form hour integrals (`gamma2Mass`, `gamma2HourMean`); the 04 §4.16/§4.17
  glucose/insulin excursions by evaluating `x·e^{1−x}` at the hour midpoint. Dossier recommendations for 5-min or
  0.05-0.25-h sub-steps (01 §4.11, 03 §4.7, 04 §4.10, 05 §4.0, 07 §4.1) are **overruled**; each module's unit tests
  must show its hourly closed form stays within 2 % (state) of a 5-min Euler reference on the dossier's own test case.
- Daily states update in `endOfDay` with Δt = 1 d exact exponentials (02 §4.13, 12 §4.0, 15 §4.17, 19).
  12 §4.0's optional Δt = 0.25 d during fasts is not needed: hormone *drivers* (u, BHB, hFast) are hourly signals.
- Day `d` = clock hours 00:00-24:00. Hour `h` of day `d` has absolute index `24d + h`. Weekday 0 = Monday.
- **Burn-in:** 14 days of the habitual **week** (with habitual sessions; §3.4, R-BURNIN) before day 0 (01 §4.11, 05 §4.17), no recording; `clock.day < 0` during
  burn-in (modules must not emit events or write per-day outputs then). `RunOptions.burnInDays` (0 disables).

### 0.2 Units and energy convention
- Mass kg (body), g (substrates), mmol/L, µU/mL insulin, kcal (never kJ inside the engine), h, d.
- **Intake energy (15 §4.2, aligned with 02 §4.4):** `E = 4·protein + 9·fat + 4·(net carbohydrate) + 2·fibre +
  7·alcohol` kcal (MCT 8.3 kcal/g, 05 §4.17). Net carbohydrate = available (digestible) carbohydrate, fibre excluded.
- **Tissue energy densities (Hall convention, ruling R-RHO):** fat ρF = 9 441 kcal/kg (39.5 MJ/kg), deposition cost
  ηF = 179 kcal/kg; lean tissue ρL = 1 816 kcal/kg (7.6 MJ/kg, incl. h_P = 1.6 g bound water per g protein),
  ηL = 229 kcal/kg; glycogen ρG = 4.207 kcal/g (17.6 MJ/kg) (01 §4.7, 02 §4.11, 11 §4.1). **η enters EE with the
  sign of the change** (Hall convention, 01 §4.2.4 / 02 §4.11: "EE includes η_F·dF/dt + η_L·dL/dt"), so the effective
  density is ρ + η for gain *and* loss (mobilising 1 kg fat balances 9 620 kcal) and `depositionCostKcalH` is signed.
  Never rectify η hour by hour (`max(0, ·)`): with meal-driven hourly storage/mobilisation that books a spurious
  15-30 kcal/d at maintenance and a meal-frequency effect 02 §4.4 rules out (review B2).
- Protein content of lean tissue for bookkeeping `f_prot = 1/(1 + h_P) = 0.385` (ruling R-FPROT).
- Carbohydrate grams at 4.0 kcal/g (intake) ↔ glycogen grams at ρG by energy: `ΔG_g = E_C/4.207`.

### 0.3 Hot path and performance rules (orchestrator rulings)
- One 180-day run (4 320 steps) ≤ 10 ms desktop, ≤ 50 ms mid-range phone (dossier 18's 5 ms is the stretch goal).
  Measured contract overhead with 16 stub modules: **1.3 ms (`none`) / 2.9 ms (`daily`) / 4.2 ms (`full`)** per
  180-day run (Node 26, Vitest, `core/__tests__/loop.test.ts`). **Full engine (integration 2026-09-30, O-11):** measured on a
  production bundle (`validation/harness/bundledBench.ts` builds `validation/bench/benchEntry.ts` with Vite and runs it in
  the test's Node process; the Vitest module transform alone costs ≈ 30 %), MAN, 180 d training-week deficit, 14-d burn-in,
  best of 15 on one desktop core: **planner mode 6.6 ms** (median 7.7; record 'daily', goal series only — the gating O-11
  number), simulate mode `none` 8.1 / `daily` 9.6 / `full` 9.9 ms best, medians 10.0 / 10.9 / 11.5 (warnings, events, all
  series); finisher measurement 2026-09-30 at host load 0.1 per core (integration figure: planner 7.2 ms). Gating bounds of
  the O-11 test: planner ≤ 10 ms, simulate modes ≤ 15 ms; the test records the host load and skips (never passes silently,
  never fails) when the host is saturated (> 0.5 runnable tasks per core after one retry). Self-time shares of a
  planner run (bundled, `node --cpu-prof`): fuel 14 %, ketones 13 %, intake 13 %, compileSchedule `expandDayToHours` +
  `loadHour` 7.7 %, loop + dispatch + recorder 10 %, muscle 5.3 %, cardiometabolic 4.5 %, cellular 4.0 %, safety 3.9 %,
  `param()` lookups in `prepare` 3.5 %, energy 3.4 %, fasting 2.6 %, composition 2.3 %, wellbeing 2.2 %, activity 1.9 %,
  water 1.9 %, hormones 1.8 %, appetite 0.9 %, moderators 0.3 % (per-module fixes: `docs/CONTRACT_REQUESTS.md`).
- The core calls `recordHour`/`recordDay` only for modules that own at least one requested series (planner runs record a
  handful), so a module's record hooks must not update state (the subset-equals-full test in `core/__tests__/loop.test.ts`
  guards it).
- No allocation in `startDay/stepHour/endOfDay/record*`: no object/array literals, closures, spreads, string
  building, `Array.prototype` callbacks. All buffers are created in `prepare/init`. Documented exception: the
  composition module's once-per-day call to `body.allocateRegional` (returns new objects), skipped when neither waist,
  VAT nor avatar output is requested (`ctx.seriesEnabled`).
- State = plain monomorphic objects and typed arrays. Parameters are read only in `prepare()` into a constants object.
- Costly outputs not requested in planner mode (`ctx.seriesEnabled[i] === 0`) may be skipped.
- Determinism: no `Math.random`, `Date`, or wall clock in physics. Same inputs → bit-identical outputs in one JS
  engine (tested). Uncertainty only via explicit parameter vectors (§8).

### 0.4 Parameter registry (orchestrator ruling)
Every constant is a `ParamDef` `{ id: '<module>.<name>', value, unit, low, high, grade, source, dossier, status?,
draw? }` (`types/params.ts`), declared in the owning module's `params` array; `core/paramsRegistry` validates (unique,
prefixed, low ≤ value ≤ high, source and § present) and builds `ModelParams`. Only definitional constants live in
`core/defaults.ts` (unit conversions, Atwater factors, input defaults). Grade = the dossier's grade for that number;
`status`: `verified` / `proposed-fit` (dossier PROPOSED FIT / PROPOSED / DERIVED) / `unverified`.
**Alternatives (ruling R-ALT, review M20):** `low`/`high` hold only plausible values *of the same quantity* (they are
sampled in every ensemble, §8.1). Where a ruling rejects a dossier's alternative that is a plausible value of the same
quantity (e.g. alcohol TEF 0.20, caffeine 0.25 kcal/mg, τ_slow 14 d, κ_mem 1.3), it may be `low`/`high`; an alternative
from a different convention, structure or model form (hydrated-lean ρL 1 000, T3 carbohydrate knee 130 g, sleep
reference 7.5 h, 20's γ_P/γ_F, 12's IGF-1 or R_MD forms) goes to `note` only (format "alt <value> <unit> (<dossier §>):
<why rejected>") and is never drawn. Convention constants (ρF, ηF, ρL, ηL, ρG, f_prot) are `draw: 'fixed'`.

### 0.5 Module contract
`EngineModule<S, K>` (`types/module.ts`): `id, specSection, dossiers, params, reads, writes, records, prepare(ctx)→K,
init(K, ctx, bus)→S, startDay, stepHour, endOfDay, recordHour, recordDay, finalize`. Modules talk only through the
`SignalBus` (§4) and read `HourInput` / `DayInput` (§5). Each module writes only its own signals and records only its
own series (checked by `checkWiring` and the loop tests). A module's state interface lives in its own folder and is
composed into `EngineState` (`types/state.ts`); `structuredClone(state)` is a valid snapshot.

---

## 1. Modules

### 1.0 Module map

| # | Module (`src/engine/model/…`) | Purpose | Owning dossier sections |
|---|---|---|---|
| 1.1 | `moderators/` | sleep debt, stress, cycle, menopause, age → multipliers | 16 §4.0-4.13; 15 §4.11 (caffeine dose/time) |
| 1.2 | `activity/` | exercise & step energy, EPOC, intensity descriptors, VO2max, mitochondria | 10 §4.1-4.2, §4.8-4.9, §4.13-4.17; 09 §4.13 |
| 1.3 | `intake/` | absorption kinetics, glucose & insulin curves, fed/fasted clocks, alcohol, caffeine, creatine, fibre ME | 04 §4.10/4.16/4.17; 03 §4.7A; 07 §4.1-4.2/4.15; 15 §4.2/4.10-4.12; 05 §4.17 (basal insulin) |
| 1.4 | `fasting/` | **zero-intake regime owner**: fasting RMR, protein-N economy, labile pool, refeeding memory | 20 §4.0-4.12, §4B |
| 1.5 | `energy/` | RMR, TEF, NEAT, adaptive thermogenesis, exercise compensation, maintenance, TDEE | 02 §4.1-4.13; 10 §4.3 (c_met); 11 §4.5 (TH_C) |
| 1.6 | `fuel/` | liver/muscle glycogen, CHO disposal & oxidation, DNL, GNG, fat oxidation, RQ | 04 §4.1-4.13/4.22; 01 accounting; 20 §4B (k_Mf) |
| 1.7 | `ketones/` | FFA, ketogenesis, TKB/BHB, keto-adaptation, ketosis state | 05 §4.0-4.17; 20 §4.3.4 (calibration) |
| 1.8 | `composition/` | fat mass, lean tissue, partition, regional fat/muscle, VAT, waist, overshoot, N balance | 01 §4.2-4.7; 03 §4.3-4.4/4.8/4.14/4.19; 11 §4.7/4.12/4.15; 14 M6-M8; 20 §4.4 |
| 1.9 | `muscle/` | RT stimulus, accretion, retention, detraining, strength, fatigue, MPS layer | 09 §4.1-4.17; 03 §4.2/4.5/4.7/4.8/4.10/4.14 |
| 1.10 | `water/` | glycogen water, natriuresis, sodium water, gut, plasma volume, cycle & creatine water, scale weight | 13 §4.1-4.6; 15 §4.7-4.8/4.12; 04 §4.1; 20 §4.5 |
| 1.11 | `hormones/` | leptin, ghrelin/SPI (display), T3, cortisol, testosterone, menstrual risk, GH, IGF-1 | 12 §4.0-4.8; 08 §4.12 |
| 1.12 | `appetite/` | Hunger Pressure Index, effort, adherence P_surv, diet fatigue (outputs only) | 12 §4.9-4.12; 15 §4.5-4.6; 21 §4 (behavioural levers) |
| 1.13 | `cellular/` | autophagy signal index, mTORC1 index, AMPK index | 08 §4.3-4.11 |
| 1.14 | `cardiometabolic/` | S_hep, S_mus, carb tolerance, lipids, BP, liver fat, glycaemic markers, CRP, urate | 06 §4.1-4.16; 04 §4.13b/4.18-4.19; 13 §4.8 |
| 1.15 | `wellbeing/` | energy availability, bone, strength/endurance multipliers, mood tier, keto-induction, micronutrients | 19 §4.1-4.20; 13 §4.10; 15 §4.9 |
| 1.16 | `safety/` | 17 derived quantities, warnings, safety events, planner constraint margins | 17 §2-4; all dossiers' §9 |
| — | `src/engine/body/` (built) | initial state estimation, regional allocation, circumferences, avatar | 14 M1-M12 |
| — | `src/engine/core/` | loop, recorder, compiler, registry, burn-in, checks | this spec |

Per-module subsections list: **state** (the stub's interface is the contract; init rules here), **parameters**
(`ParamDef`s to declare; id suffix → value [low, high] unit, grade, status, dossier §), **reads/writes** (see §4 for
units and timing), **records**, **algorithm** (numbered), **numerics**, **validation** (unit tests the module must
pass; the cross-module scenarios are in §9).

### 1.1 `moderators` — sleep, stress, cycle, menopause, age (16)

State (`ModeratorsState`): `sleepDebtFastH` dF, `sleepDebtSlowH` dS, `lastNightSleepH`, `caffeineAtBedMg`,
`cycleDay`, `ageYears`, `sleepQualityIdx`. Init: dF = dS = 0 after burn-in on habitual sleep; cycleDay from
`profile.cycle.lastPeriodStart` (−1 when not tracked or on hormonal contraception).

Parameters (16 §4.1.1, §4.0.1, §4.13; 15 §4.11): `hRef` 7.0 h [7.0, 7.5] (ruling R-SLEEP); `qualityPoorH` 0.75 h;
`shiftWorkH` 1.0 h (smoker = `HabitProfile.smoker`, OC = `cycle.contraception` 'combinedOral', both applied to the bedtime
caffeine residual); `tauDfUp` 1 d, `tauDfDown` 2 d; `tauDsUp` 3 d, `tauDsDown` 5 d; `debtCap` 4 h (testosterone 5);
`siPerH` 0.07; `mpsPerH` 0.05; `testoPerH` 0.05; `partitionPerH` 0.04, `partitionCap` 0.12, `partitionDeficitRef`
0.15; caffeine `tHalfH` 5.4 [4, 6] (×1.47 combined oral contraceptive, ×0.56 smoker), `R*` 37 mg, `tstLossPerMg`
0.40 min, cap 120 min (16 §4.2.1 / 15 §4.11); `lutealAmp` 0.05 of RMR [0.02, 0.09] (02 §4.3, PROPOSED FIT); menopause
drift +0.20 kg/yr fat, −0.12 kg/yr lean while peri (16 §4.7).

Algorithm (startDay):
1. `d_t = max(0, hRef − lastNightSleepH) + (quality==poor ? 0.75 : 0) + (shiftWork ? 1.0 : 0)`.
2. dF, dS ← relax2 toward `min(cap, d_t)` with their up/down τ; clamp to caps.
3. Write `siSleepMult = 1 − 0.07·min(dS, 4)`; `mpsSleepMult = 1 − 0.05·min(dS, 4)`; `testoSleepMult = 1 − 0.05·min(dS, 5)`
   (men; 1 for women); `partitionSleepShift = u < 0 ? min(0.12, 0.04·dS·min(1, (−u)/0.15)) : 0` with
   `u = energyBalanceFrac` of the previous day (grade C; band lower edge 0, 16 §4.0.1).
4. Cycle: `cycleDay` advances; `lutealWeight s(d)` = 1 on luteal days (≈ 15-28 of a 28-d cycle), 2-day linear ramps
   (02 §4.3); 0 with hormonal contraception, post-menopause, or tracking off.
5. `stressLevel` = day input; `ageYears` += 1/365.25.
6. Sleep-quality output (16 §4.2, 19 §4.10): caffeine residual at bedtime `A_bed` (from `caffeineLoadMg` at the
   planned bed hour, recorded in stepHour), `TST_loss = min(120, 0.40·max(0, A_bed − 37))` min; alcohol next-night
   recovery penalty 0.09/0.24/0.39 for ≤0.25/≤0.75/>0.75 g/kg (15 §4.10); index = 100 − penalties (16 §4.2 table).
   **Diet→sleep feedback into sleep hours is OFF** (16 §4.2): sleep hours are an input.

Validation: 16 §7 targets V1-V6 (sleep restriction insulin sensitivity −11 to −25 %, MPS −18 % after one night via
09's `f_sleep`, testosterone −10-15 % after a week of 5 h), caffeine cut-offs 8.8 h / 13.2 h → residual 35/40 mg
(15 V13), luteal RMR +5 % ±4 (02 §4.3 data).

### 1.2 `activity` — exercise and step energy, VO2max (10, 09 §4.13)

State: `vo2max`, `vo2FastPool`, `vo2SlowPool`, `mem7d`, `mitoRel`, `epocRemainingKcal`, `epocTauH`,
`postRtReeHoursLeft`, `eeNetRing[7]`, `ringIdx`, `dayNetKcal`. Init: VO2max from `labs.vo2maxMlKgMin` else 10 §4.8
Jackson PA-R non-exercise equation (PA-R from the 10 §4.14 selector nearest to habitual steps; FRIEND table cross-check);
mem7d from habitual sessions.

Parameters (10 §4.1-4.3, §4.8-4.9, §4.14; 09 §4.13): `stepsNet` 0.44 kcal/kg/1000 steps [0.36, 0.50] (DERIVED
from Ludlow); `runEff` 0.90 [0.80, 1.0] (net 0.90 kcal/kg/km); walking `3.85 + 5.97·V²/H` (Ludlow); cycling
`2.4·RMR_W + P/0.26` (PROPOSED FIT); RT MET by style 3.5/5.0/6.0/5.8/3.0 (09 §4.13, Compendium 2024), default 4.0 MET
for a 60-min moderate-rest session (10 §4.1); `displacedBaseline` 0.2·RMR (PROPOSED, 10 §4.1); EPOC fraction φ by
session (10 §4.2 table, e.g. moderate 50-65 % 30-60 min φ 0.04-0.06; SIT 40-60 kcal); `epocRt` 0.05 [0, 0.10]; post-RT
REE `0.05·REE·(1 − 0.5·H_wb)` for 72 h, not additive (09 §4.13); VO2max dose `g* = min(0.60, 0.35·z·sexF·MEM²/(MEM²
+ 130²))`, pools τF 15 d (55 %) and τS 60 d (45 %), detraining τDn 30 d [20, 40] with retention floor
ρ = 0.45·(1 − e^(−trainYears/2)) (10 §4.8); MEM weights w = 0 (<0.40 VO2max), 0.4 (0.40-0.55), 1.0 (0.55-0.70),
1.5 (0.70-0.85), 3.0 per interval minute ≥ 0.85-0.90, 0.3 per recovery minute (10 §4.8).

Algorithm:
1. (stepHour) If `hour.exMin > 0`: resolve intensity: a stated MET (`exMet`, the session-average gross cost) sets the
   energy; else a given `exIntensityFrac` (fraction VO2max) → gross MET = `x·VO2max/3.5`; else speed (Ludlow walk / ACSM
   run), power (cycling), RPE (10 §4.1 mapping) → `x = MET·3.5/VO2max`. The relative intensity x of the descriptors (EPOC,
   MEM, hard session) is the stated work intensity when given (HIIT at 90 % VO2max averaging 8 MET; integration 2026-09-30,
   10 V13 matched energy), else the one implied by the cost. Resistance sessions: MET by style. Habitual sessions of the
   burn-in week (no intensity, 5.0 MET, as EAT0) count at the §5.3 default moderate intensity for the training dose (MEM,
   VO2max equilibrium), so a habitual exerciser's baseline carries a training gain detraining can lose (10 V16).
2. Session EE this hour (10 §4.17 `sessionEnergy`): gross `= VO2(x)·5 kcal/L × minutes` with `VO2 = x·VO2max·BW`
   (or MET·3.5 mL/kg/min for MET/speed/power inputs); **net** = gross − the person's own RMR for those minutes (net of
   resting, not "MET − 1" with a standard MET; 10 §4.1) → `exSessionNetKcalH` (the EEE of energy availability, ruling
   R-EA). For the TDEE ledger the displaced lifestyle baseline 0.2·RMR·minutes/60 is also removed (10 §4.1, so 02's
   PAL baseline is not double counted), and EPOC released this hour (queue decaying with the 10 §4.2 τ) plus post-RT REE
   are added → `exEEKcalH`. Uncompensated here (compensation lives in energy §1.5, ruling R-COMP).
3. Steps: `stepsExtraKcalH = stepsNet/1000·BW·(steps_h − baselineSteps_h)` where baselineSteps = habitual steps
   distributed like the day's steps (10 §4.14: step energy counts only above the lifestyle baseline).
4. Descriptors: `exIntensityFrac`, `exMinutesH`, `exActiveMuscleKg` (cycling/running ≈ 0.40·SMM, 04 §4.4 UNVERIFIED;
   10 §4.17 active-mass function), `exHardSession` (x ≥ 0.85 intervals, or RT with `rtToFailure`).
5. (endOfDay) MEM update; VO2max pools relax; detraining; `mitoRel = M_c·M_r` (10 §4.9); rings; `exSessionNetKcalD` =
   the day's Σ exSessionNetKcalH (read by wellbeing next day; review m10).
6. (startDay) `exPlannedKcalD` = Σ over today's `DayInput.sessions` of the step-2 `exEEKcalH` estimate (net, incl.
   displaced baseline, EPOC and post-RT REE, at yesterday's VO2max/BW) — read by energy for `tdeeEstKcalD`;
   `aerobicIdx` ∈ [0, 1] for 03's M_act (ruling R-AEROBIC, review M14): `aerobicIdx = clamp(mean over the last 7 days of
   the daily net cardio session EE (Σ exSessionNetKcalH of cardio sessions only) / 300 kcal·d⁻¹, 0, 1)` (≈ 150 min/wk
   moderate → 0.5; Chaston's aerobic arms ≈ 1); steps stay in NEAT only; the burn-in week initialises the 7-d ring. RMR for "net of the person's own RMR" and the post-RT REE is `rmrKcalH` of the previous hour.

Numerics: EPOC queue is two scalars (remaining kcal, τ); no per-session objects.
Validation: 10 §7 (Ohkawara +588 kcal/d for +20 615 steps ±15 %; VO2max +15-20 % in 12 wk moderate training; detraining
−7 %/30 d; EPOC 6-15 % of net cost after ≥50 min at ≥70 %), 09 §4.13 RT 80 kg 60 min MET 3.5 → 200 kcal net.

### 1.3 `intake` — absorption, curves, clocks, substances

State: `IntakeState` (meal ring 16 × 12, `aLagGH`, `etohG`, `caffeineMg`, `caffeineTol`, `creatineX`, `fibreEffG`,
clocks, 24-h rings, `insulinBasal0`).

Parameters:
- Carbohydrate appearance (04 §4.10 step 1): gamma(2) kernel, θ = t_p by class 0.50/0.75/1.0/1.25-1.5 h
  (04 §4.16; `core/defaults.timeToPeakH`); caps `Ra_glc ≤ 60 g/h`, `Ra_glc + Ra_fru ≤ 90-105 g/h` (excess queued).
- Protein digestion (03 §4.7A, PROPOSED FIT): `Vmax` 11 g/h × speed s (whey 1.6, casein/fibre-rich 0.8, EAA 2.0),
  `Km` 20 g, `F_sys` 0.66, `τ_lag` 0.5 h; quality Q_meal on the systemic signal (03 §4.10 table in `PROTEIN_QUALITY`).
- Fat appearance (ruling R-ABS): proportional to the meal's gastric emptying by 07 §4.1 — gut energy pool per meal
  `dE/dt = −kGE·E/(E + KGE)`, `kGE` 270 kcal/h, `KGE` 150 kcal, 0.5-h lag for solids; fat appears at the meal's fat
  share of the emptied energy. **Fed state** (07 §4.1): total absorptive flux ≥ 30 kcal/h.
- Fasting clocks (07 §4.2): `tPA` resets while FED; `hFast` (08 §4.10) resets on protein ≥ 10 g **or** net CHO ≥ 15 g
  (pure fat, black coffee, electrolytes do not reset); `fast_h` (17 §2.1) = hours since intake > 50 kcal.
- Insulin (04 §4.17): `Ins = Ins_f + M_ins·Σ_m ΔI_m`, `Ins_f = 7·S_hep^−0.9`, `ΔI_m = B_m·y·e^{1−y}`,
  `y = (t − t_m)/(t_p + 0.25 h)`, `B_m = [B_max·L_I/(L_I + K_I) + b_P·P_m]·S_mus^−0.7`, `B_max` 250 µU/mL, `K_I` 300 g,
  `b_P` 0.6 µU/mL per g protein (UNVERIFIED), `L_I = Σ(0.5 + 0.5·GI/100)·C`, `M_ins = 1 − 0.2·(1 − T_C)`.
  **Merged basal decline (ruling R-INS, extended by integrator A2):** `Ins_f` is multiplied by the **lower** of 05 §4.17's
  basal factor `I_floor + (1 − I_floor)·min(1, G_L/G_ref)^0.5` (`I_floor` 0.45, `Iexp` 0.5, `G_ref` 60·FFM/60 g) and
  07 §4.4.3's fasting time course `0.45 + 0.55·e^(−p(τ − 12 h)/10 h)` (grade A; Klein 1993: 70 % of the 12 → 72 h fall
  by 24 h), τ = hours post-absorptive + 4.5 h (the glucose table's clock). With 04's liver kinetics (σ_fed-suppressed
  glycogenolysis keeps ≈ 50 g at 24 h) the liver factor alone gave ≈ 40 % of the fall by 24 h (07 #2) and delayed the
  fasting FFA rise. `insulinRel = Ins/insulinBasal0` with `insulinBasal0` = the **lowest non-exercise hourly insulin of
  the last burn-in day** (the pre-breakfast trough, which carries the previous dinner's 04 §4.17 tail: 05's "1.0 =
  overnight-fasted insulin on a mixed diet"; Ins_f at t = 0 when burn-in is off). **`insulinRefRel`** (new signal,
  read by ketones as 05's I; integrator A2, second pass) = **05 §4.17's own insulin proxy on this module's absorption
  rates**: `I = IR·(I_b + 0.12·Ra_C + 0.04·Ra_P)·(1 − 0.3·x)` with `I_b` = the basal-decline factor above, Ra_C = glucose +
  fructose/galactose appearance, Ra_P = protein appearance (g/h; `intake.ketIPerGCarbH` / `ketIPerGProtH`, 05 §4.4) and
  `IR = Ins_f(S_hep)/Ins_f(1) = S_hep^−0.9` (04 §4.17's HOMA link; 05 §3's IR 1.0 lean → 1.2-1.6 obese). 05 calibrated its
  lipolysis/ketogenesis functions on this proxy; 04's absolute meal insulin is ≈ 2× higher after a low-carbohydrate meal
  and stays above basal ≈ 4 h longer, which kept very-low-carbohydrate BHB at 0.1-0.3 mM for most of the day (first pass)
  — the absolute insulin (`insulinUuMl`, fuel/cellular/cardiometabolic) keeps 04's curve. During exercise
  `Ins × (1 − 0.3·x)` (05 §3).
- Glucose (04 §4.16): `Glc = Glc_f + M_tol·M_circ·Σ ΔG_m`, `Glc_f = 5.0·S_hep^−0.1`, `ΔG_m = A_m·x·e^{1−x}`,
  `x = (t − t_m)/t_p`, `A_m = A_50·[L_eff(K_L + 50)]/[50(K_L + L_eff)]·M_PF·M_fib·M_order·M_vin·S_mus^−0.5`, cap 4.5,
  `A_50` 2.8 mmol/L (UNVERIFIED), `K_L` 80 g, `M_PF = 1 − 0.006·min(P,50) − 0.0025·min(F,30)`,
  `M_fib = 1 − 0.035·min(βglucan,12)`, `M_tol = 1 + 0.6·(1 − T_C)`, `M_circ` 1.0 breakfast / 1.15 later (UNVERIFIED;
  07 §4.7 `mClock` slope 0.0142/h may replace it — owner 07, ruling R-CIRC). In fasting (no meals) glucose follows 20
  §4.7's reference (nadir 3.3-3.5 mmol/L by day 3-4) via `Glc_f·(fasting factor from 07 §4.4.3 continuous functions)`.
- Alcohol (15 §4.10): absorption within the hour; zero-order queue `k_ox` 0.10 g/kg/h (men) / 0.085 (women); energy
  7 kcal/g enters `eAbsKcalH` as it is oxidised; `etohPoolG` exported.
- Caffeine (15 §4.11): one compartment, `t_half` = `moderators.caffeineTHalfH` (5.4 h; single owner of the value,
  16 §4.2.1) × `moderators.caffeineOcMult` (1.47) for combined oral contraceptives × `moderators.caffeineSmokerMult` (0.56)
  when `habits.smoker`; tolerance τ 14 d at ≥ 200 mg/d. The per-run meal-trajectory caches are module state (not
  constants), so `RunOptions.initialSnapshot` restores intake bit-identically.
- Creatine (15 §4.12): `x_target = 0.20·min(1, D/2.5)`, `τ_up = clamp(30/D, 1.5, 15)` d, `τ_down` 10 d,
  non-responder `x_max ×0.25` exposed as a range (not a draw); `creatineSatFrac = x/x_max` (ruling R-CREATINE: 15's
  kinetics, not 21's CrLoad ODE).
- Fibre ME correction (15 §4.2): `F_eff` EMA τ 3 d (nut and supplement fibre excluded);
  `dME_fibre = −2.8·(F_eff − 8·E/1000)` kcal/d, clamped to [−0.06E, +0.03E]; nuts `dME = −δ·nut kcal` (δ table
  0.05-0.25). Distributed over the day's absorbed energy in proportion to appearance.

Algorithm (stepHour):
1. Register meals starting this hour into the ring (glucose-eq, fructose+galactose, protein, fat, gut energy, t_p,
   Q_meal, speed, insulin load). Retire slots older than 16 h with < 0.1 g left.
   **Carbohydrate eaten during exercise (ruling R-EXCARB, review M8):** `hour.exCarbG` (glucose-equivalent g; not part of
   the hour's meal fields) is registered as its own glucose slot with t_p 0.5 h (04 §4.3), GI 100, no protein/fat, no
   gut-emptying lag, and is added to the 24-h rings (`kcalEaten24` +4·g, `carbAbs24G` +g) and to the intake clocks
   (> 50 kcal resets `hoursSinceIntakeH`; ≥ 15 g resets `hoursSinceMealH`). Its energy reaches `eAbsKcalH` through
   `raGlcGH` like any glucose; fuel reads only `raGlcGH` (no separate exercise-carbohydrate path). The compiler has
   already added the grams to `DayInput.carbG/glucoseEqG/energyKcal` (`DayInput.exerciseCarbG`, §5.2).
2. Per slot: carbohydrate appearance by `gamma2Mass(τa, τb, t_p)`; protein by `mmRemaining`; gut energy by
   `mmRemaining(kGE, KGE)`; fat = fat share × emptied energy. Apply the 04 intestinal caps (queue the excess).
3. `raGlcGH`, `raFruGalGH`, `raProtGH`, `raFatGH`, `raMctGH`; `raAaQGH` = A_lag relaxed toward Σ Q_meal·F_sys·V
   with τ_lag 0.5 h (exact exponential); `eAbsKcalH = 4·(glc + fru + gal) + 4·prot + 9·(fat − mct) + 8.3·mct + 2·fibre_h +
   7·alcOx + 4.45·exoBHB_g + dME_h` (fibre energy appears with the meal's carbohydrate; MCT 8.3 kcal/g per §0.2;
   exogenous D-BHB at ρK 4.45 kcal/g, 05 §4.15/01, counted as it appears — review m17).
4. Insulin and glucose at the hour midpoint (sum over active slots); `insulinBasalUuMl` = the basal term alone (Ins_f ×
   basal-decline factor); `insulinRel`, `insulinRefRel`; `fedState` and `absFluxKcalH` (gut emptying only — an
   exogenous-ketone drink's energy enters `eAbsKcalH` but never the fed state, the 24-h intake rings or the intake
   clocks); clocks; caffeine; alcohol queue. Exogenous ketones: appearance by 05 §4.12's gamma(2) kernel (peak 0.5 h
   fasted / 0.75 h fed) × 0.75 when taken with food — applied here once (ketones only shapes the hour's amount within the
   hour).
5. (endOfDay) creatine x, fibre EMA, caffeine tolerance.

Validation: 07 §4.1 — a 700-kcal mixed meal stays absorptive 4.6 h (t95) ± 0.5 h; 03 V6 — Trommelen appearance
51/62/66 % (25 g) and 26/44/53 % (100 g) at 4/8/12 h ± 7 points; 04 §4.16 Taylor check (Δ 3.6 vs observed 3.4 mmol/L
± 1.0), Lee & Wolever dose steps +68 %/+38 % by construction; 04 §4.17 479-g meal insulin peak 154 vs 139 µU/mL ± 40 %;
15 V9-V10 (alcohol: fat oxidation −60 to −85 % during clearance; −400 to −480 kcal/d at 96 g), V13 (caffeine residual),
V14-V15 (creatine x(6 d) 0.19-0.20, W_Cr 0.5-1.0 kg at 7 d); 15 V1-V3 (fibre/nut ME corrections).
Known limitation (04 §4.16 (iii), documented, not fixed): very large slowly eaten starch meals peak lower and later than
the 04 curve predicts — Acheson's 479-g meal peaks at 9.5 mmol/L in the engine vs 6.6 observed even with t_p 1.5 h and
the 4.5-mmol/L cap; the dossier gives no saturating form beyond these two rules (the 04 V1 glucose row is Q).

### 1.4 `fasting` — zero-intake regime owner (20)

Rulings R-FAST: dossier 20 owns every phenomenon of water-only and modified (Buchinger-type) fasts. While the overlay
is active it **replaces** (never adds to): 02's resting AT (AT_R held, not updated), 03 §4.13 / 07 N-loss models (the
fasting protein oxidation), 20's own E_fast (13's `E_cna` with `k_fast` is used instead, 20 §4.0), and 04's resting
muscle glycogenolysis constant (k_Mr → k_Mf). AT_N (NEAT adaptation, 02) continues (20 §4B.1). Energy also **holds
P_eff and the exercise-compensation state compKcalD** while the overlay is active (ruling R-FAST-AT, review M6: 20's
fastRmrMult is fitted to measured fasting REE, which already contains the protein-turnover fall); both resume on refeed.

State: `active`, `tFastH`, `sAT`, `sN`, `dLabG`, `eOedL`, `lastFastDays`, rolling 24-h kcal/protein/carb.

Parameters (20 §4B.2, all grades as listed there): `aSNS` 0.05 [−0.08, 0.14]; `tP` 2.0 d [1.5, 3.0]; `tLag` 2 d [1, 4];
`tauAT` 9 d [6, 14], `tauATOff` 4 d [3, 7]; `phiAT = clamp(0.25 − 0.004·BF%, 0.05, 0.22)` (±0.07);
`gammaP` 19, `gammaF` 4.5 kcal/kg/d (Hall 2010, for 20's own RMR form — see note); `kMf` 0.008 h⁻¹ [0.005, 0.012]
(read by `fuel` in prepare; the ODE is solved exactly over the hour, §1.6);
`nPk = 0.25 − 0.06·clamp((F − 10)/40, 0, 1)` g N/kg FFM/d [0.21, 0.28]; `prLate = 0.04 + 0.22·e^(−BF%/15)`
[×0.75, ×1.25]; `tauN` 8 d [6, 14], `tauNOff` 3 d [2, 5], `tauNOffLowCarb` 7 d [4, 14]; `hP` 1.6 [1.1, 3.0];
`cCarb` 0.45 per 100 g [0.3, 0.6]; `kKet` 0.3 per 1.5 mM exogenous [0.2, 0.4]; `kEx` 1.0 [0.9, 1.0]; `lMax` 0.75 g/kg
FFM [0.3, 1.5]; `tauRep` 2 d [1, 4]; `aOed` 0.08 L per fast day > 3 d, cap 2.0 L; BHB_ref (B1 2.2, B2 3.7 mM, τ2 170 h;
calibration only).

Algorithm (stepHour, 20 §4B.1 adapted to the module split):
1. Criteria: `fasting = kcal24 < 0.10·maintenance ∧ protein24 < 5 g ∧ carb24 < 10 g`; `modified = ¬fasting ∧ kcal24 <
   0.15·maintenance ∧ protein24 < 5 g`; `active = fasting ∨ modified ∨ (hour.plannedFast ∧ planned span ≥ 24 h)` — a
   planned span of ≥ 24 h activates the overlay from its first hour so 20 Table A1 day 1 is reproduced; **shorter planned
   fasts use only the 24-h intake criteria** (ruling R-PART-HOUR, review M7), so a 16-h FastEvent and a 16:8 meal window
   are treated alike. The span length is known from `CompiledSchedule.fastSpans` (read in `prepare`) and is the fast's
   **meal-to-meal** duration `mealToMealH` (ruling 2026-09-30 18:10; a 24-h dinner-to-dinner fast compiles to a 23-h
   zero-intake span and still activates the overlay; the zero-intake length is used only when `mealToMealH` is absent). `maintenance` is
   `maintenanceKcalD` of the previous day (d−1). `tFastH` counts hours since the start.
2. `A_SNS = active ? aSNS·(t/tP)·e^{1 − t/tP} : 0` (t in days); `s_AT` relaxes toward `(active ∧ t > tLag) ? 1 : 0` with
   τ `tauAT` (on) / `tauATOff` (off). `fastRmrMult = (1 + A_SNS)·(1 − phiAT·s_AT)` — applied by `energy` to its
   mass-based RMR; while `active` or `|fastRmrMult − 1| > 0.001`, energy holds AT_R (ruling R-FAST). Never test
   `fastRmrMult ≠ 1`: s_AT relaxes exponentially and never returns exactly to 0, so an equality test would hold AT_R
   forever after the first fast (review M19).
3. Protein: `S_N` relaxes toward `clamp((BHB − 0.5)/3.5, 0, 1)` (τ_N up; τ_N,off or τ_N,off(low-carb) when carbs < 50 g)
   using `bhbMmolL` of the previous hour. While active: `N = (FFM·nPk·(1 − S_N) + (prLate·TEE/29.4)·S_N)·rise·Cc·Kk·kEx`
   g N/d with `rise = 0.8 + 0.2·min(1, t/2.5)`, `Cc = 1 − 0.45·clamp(carb24/100, 0, 1)`,
   `Kk = 1 − 0.3·clamp(BHB_exo/1.5, 0, 1)`; `fastProtOxGH = 6.25·N/24`; `D_lab += fastProtOxGH` up to `lMax·FFM0`.
4. Refeeding repletion (not active, kcal24 ≥ 0.9·maintenance, protein24 ≥ 1.0 g/kg BW): `fastRepletionGH =
   D_lab/(tauRep·24)`, `D_lab −= that` (03/11 partitions must not also credit this protein — composition subtracts it
   from the protein ceiling, §1.8).
5. Oedema after a completed fast > 3 d: `E_oed` amplitude `min(2, 0.08·(lastFastDays − 3))` L, released per 20 §4.5.2
   → `fastOedemaL`.

Note on 20's RMR form: 20 writes `rmr = (RMR0 + γP·P_tis + γF·dF)(1 + A_SNS)(1 − φ·s_AT)`. The mass terms are the
energy module's (02 §4.2 γ_L 22 / γ_F 3.2 per kg, ruling R-RMRMASS); only the multiplier comes from here. 20's γ values
are documented in the `note` of energy's γ parameters only (not used by any formula, not drawn; ruling R-ALT).

Validation (must pass, 20 §7 and §4B.3, tolerances there): V1 Kolnes 7-d (ΔBW −5.8 ± 0.8, fat −1.4 ± 0.5, DXA-lean
−4.6 ± 1.0, urinary N 84 ± 15 g/7 d, RMR day 5 ±6 %), V2 Pietzner 7-d + 3-d refeed (lean −3.6 → −0.69; fat −1.85 kept),
V3 Dai 21-d (ΔBW −10.0 ± 1.5, REE −7.5/−13.7/−20.3 % ± 6 points), V5 Levanzin 31-d, V6 N peak 14.5 g/d ± 2 and obese
week-4 3.0 ± 1.5 g/d, V7 Ogłodek 8-d, V8 24-72-h BHB (with 05), V9 Templeman (fat 0:150 < 75:75 by ≥ 0.5 kg), and the
§4B.3 schedule behaviours (24/48/72-h, 7-d, 21-d, weekly 24-h × 12, monthly 72-h × 6, fast broken by 110 g CHO on day 3).

### 1.5 `energy` — expenditure (02; 10 §4.3; 11 §4.5; 15)

State: `EnergyState` (baselines; `atR`, `atN`; `pEffG`; `compKcalD`; day accumulators; `prevDayTeeKcal`).
Init: RMR0 and TDEE0 = EI0 from `ResolvedProfile` (`core/resolveProfile`: 02 §4.1 selection rule — measured RMR >
Müller-FFM / Cunningham-1980 (trained or FFMI ≥ 20 M / ≥ 17 F) when body fat is *measured* (DXA/BIA) > Mifflin–St Jeor;
slider/visual body fat counts as unknown → Mifflin; TDEE0 by 02 §4.13 init step 2 steps form with 10's step cost:
`TDEE0 = (RMR0 + 0.15·RMR0 + 0.44/1000·BW·steps0 + EAT0)/(1 − α_mix0)`, `EAT0 = profile.eat0Kcal`); initial NEAT0 =
TDEE0 − RMR0 − TEF0 − EAT0 (floor 0.10·RMR0); P0 = habitual protein.
**Burn-in calibration (ruling R-BURNIN, review B3b):** the burn-in runs the habitual week (§3.4, days −7…−1 are one full
habitual week whenever burnInDays ≥ 7); energy accumulates the model TEE (Σ teePre + deposition cost + DNL heat) over the
last `n = min(7, ctx.burnInDays)` burn-in days and in `endBurnIn` sets `NEAT0 ← NEAT0 + (EI_hab − mean TEE_ref)` with
EI_hab = the realised absorbed habitual intake (Σ `eAbsKcalH`, = TDEE0 up to ME corrections), floor 0.10·RMR0 — every term
the analytic TDEE0 misses (post-RT REE, EPOC, session cost "net of own RMR", TEF of fibre/alcohol, GNG baseline) is
absorbed once, so a weight-stable person at 100 % of baseline maintenance stays stable (invariant O-12). **TEE_ref** (integration
2026-09-30) is the burn-in TEE (Σ teePre + DNL heat, deposition cost excluded) *minus its mass-dependent part* — the RMR
γ-terms `(RMR_mass − RMR0)·fastRmrMult·(1 + a_lut(s − s̄))` and NEAT's `NEAT0·(BW/BW0 − 1)` accumulated over the same days:
composition re-anchors FM/LT at the same boundary, so a burn-in drift must not be frozen into NEAT0 (it re-appeared as a
drift after t = 0). Glycogen change is not part of TEE (a cyclic week has ΣΔG = 0; a still-settling glycogen pool must not
be calibrated into expenditure). EAT0 := the realised mean exercise EE of those days, α_mix0 := mean TEF/EI. In the same hook
energy sets FM0/FFM_act0/BW0 to the profile values (composition then resets the masses), AT_R = AT_N = comp = 0,
P_eff = P0, recomputes `maintenanceKcalD` at the reference masses and shifts yesterday's TEE (the base of day 0's
`tdeeEstKcalD`) by the NEAT0 change. With burnInDays = 0 there is no calibration (n = 0).

Parameters (02 §4.2-4.13 unless noted): `gammaL` 22 kcal/kg/d [19.7, 22.8]; `gammaF` 3.2 [3.1, 4.5]; `gammaSM` 13
[12.6, 13]; `betaAT` 0.14 [0.05, 0.40] (deficit); `betaATPlus` 0.12 [0, 0.35] (surplus; ruling R-AT); `sigmaAT` 0.6
[0.4, 0.8]; `tauROn` 7 d [3, 14]; `tauNOn` 14 d [7, 30]; `tauOff` 14 d [14, 42] (PROPOSED); `tefP` 0.25 [0.20, 0.30],
`tefC` 0.075 [0.05, 0.10], `tefF` 0.025 [0, 0.03], `tefMctExtra` 0.065, `tefAlc` **0.10** [0.05, 0.22] (ruling R-ALC),
`tefFibre` 0.30 of fibre energy [0, 0.30] (ruling R-FIBRE); `mIR = 1 − 0.25·IR` (PROPOSED); `kP` 0.6 kcal per g/d
[0.3, 1.1] with `tauP` 2 d, clamp P_eff/BW 0.4-3.5 g/kg; `kCaff` **0.10 kcal/mg × (mg − 150)·(1 − 0.5·Tol)** [0.05, 0.25]
(ruling R-CAFF, 15 §4.11); `cMet` 0.15 + 0.010·clamp(BMI − 25, −5, 8) [0, 0.28], τ 14 d, cap −5 % RMR (ruling R-COMP,
10 §4.3); `phiC` 0.10 [0.05, 0.15] (11 §4.5 TH_C, only when EI > EI_ref); **`gngCost` 0 [0, 0.2]** (ruling R-GNG,
review M5: 02 §4.11's 0.2 double counts protein TEF and 20's fitted fasting REE; 0.2 = registry high, sensitivity only);
luteal amplitude `a_lut` is read at `prepare` from moderators' registry entry `moderators.lutealAmp` (single owner;
fallback 0 only when the moderators module is absent from the module list, e.g. unit tests);
temperature coefficient 0.11/°C (|ΔT| ≤ 2); guards |AT| ≤ 0.25·TDEE0, flag RMR < 0.6·RMR0 or TDEE < 1.1·RMR (02 §9).

Algorithm:
1. (startDay) P_eff relax (τ 2 d) toward today's protein — **held while `fastActive`** (and compKcalD held; review M6);
   `tdeeEstKcalD = prevDayTee − prevDayEAT + exPlannedKcalD` (activity writes `exPlannedKcalD` in its startDay, which runs
   before energy's).
2. (stepHour) `RMR_mass = RMR0 + γL·[(FFM_act − SM_RT) − FFM_act0] + γSM·SM_RT + γF·(FM − FM0)` (02 §4.2).
   `RMR = (RMR_mass + AT_R·[not held] + kP·(P_eff − P0) + compKcalD)·fastRmrMult·(1 + a_lut·(s(d) − s̄)) + caffeine term`
   (per hour ÷ 24). `s̄` = mean of s(d) over the user's cycle (≈ 0.5): RMR0 equations are phase-averaged, so the luteal
   term must be mean-zero (uncentred it adds +2.5 % RMR ≈ 35 kcal/d → −1.3 kg/yr at "maintenance"; review M3).
   Caffeine term (ruling R-CAFF) = `kCaff·(mg_d − mg_hab)·(1 − 0.5·Tol)` kcal/d with `mg_d` = DayInput.caffeineMg and
   `mg_hab` = the profile's habitual caffeine (default 150 mg; habitual intake is already inside RMR0/TDEE0), distributed
   over the day's hours in proportion to `caffeineLoadMg`; `Tol` = energy's own 14-d EMA of mg_d ≥ 200 (15 §4.11) —
   review M4. TEF_h = `α_day·eAbsKcalH` with α_day = the day's macro TEF fraction (tefP·E_P + tefC·E_C + (tefF + tefMctExtra
   on MCT)·E_F + tefAlc·E_A + tefFibre·E_fib)/E from DayInput (ruling R-TEFTIME: TEF follows absorption hour by hour; its
   daily integral equals 02's daily TEF up to the absorption spill-over across midnight; 0 at zero intake; no extra
   reads of the per-macro appearance signals needed). NEAT_h = (NEAT0·BW/BW0 + AT_N)/24 spread by waking hours +
   `stepsExtraKcalH`. EAT = `exEEKcalH`. TH_C_h (11 §4.5). GNG cost = gngCost·max(0, gng − gng0)·4 kcal/g (previous
   hour; 0 by default, R-GNG).
   `teePreKcalH = RMR_h + TEF_h + NEAT_h + EAT + TH_C_h + GNGcost_h`; `rmrKcalH` = RMR_h.
3. (endOfDay) ΔEI = EI_day − EI0 (EI_day = Σ `eAbsKcalH`); AT* = (ΔEI < 0 ? βAT : βAT⁺)·ΔEI; AT_R* = 0.4·AT*,
   AT_N* = 0.6·AT*; AT_R ← relax (τ 7 d building / 14 d off) unless held by the fasting overlay; AT_N ← relax (14/14 d).
   Compensation: `comp ← relax toward −min(cMet·EnetMean7d, 0.05·RMR)` τ 14 d. `atKcalD = AT_R + AT_N`.
   `maintenanceKcalD = EI_inst = (RMR + NEAT_hab + EAT_hab + other)/(1 − α_mix)` at habitual steps and exercise, AT
   frozen (02 §4.13 "instantaneous maintenance") — the base of the 'current' energy days (orchestrator ruling), to which
   the loop adds the day's R-MAINT activity adjustment (§5.2). **`maintenance` metric (R-MAINT, final round):** the energy
   that holds the *current* body at the *scheduled* activity = EI_inst + Δ/(1 − α_mix), Δ = `DayInput.activityDeltaKcal`
   (planned − habitual booked activity, phase/week mean), evaluated on the habitual diet mix: [(RMR_mass + AT_R + comp)·
   (1 + luteal) + NEAT0·BW/BW0 + AT_N + EAT0 + GNG cost + Δ]/(1 − α0). It carries AT and the compensation state (so it
   falls as weight is lost and adaptation develops) but not the diet-composition terms (TEF share of the day, protein term
   k_P·(P_eff − P0)): at t = 0 it equals the static reference TDEE0 + Δ/(1 − α0), and a high-protein plan no longer makes it
   ramp up over the first days (QA "+22/+38 kcal/d in a deficit" = P_eff relaxing toward 2 g/kg, τ 2 d). Its t = 0 value
   uses day 0's Δ (held in the constants, so snapshots stay schedule-independent). The bus `maintenanceKcalD` (base of the
   'current' reference) keeps the day's diet terms. **TH_C (11 §4.5):** EI_ref is the
   day's maintenance reference `DayInput.maintenanceKcal` (1-kcal tolerance), not TDEE0 — eating to fuel planned
   training is not carbohydrate overfeeding.
   `α_mix` = the day's realised TEF/EI when EI_day > 0.1·EI0, else the habitual α_mix0 (a zero-intake day gives 0/0 → NaN,
   which would propagate into 'current' days and the fasting criteria; review M12). RMR here excludes `fastRmrMult`.
4. Records: `tdee` = Σ (teePre + depositionCost + dnlHeat) per hour; `rmr`, `neat`, `tef`, `energyBalance`,
   `metabolicAdaptation`, `maintenance`.

Validation: 02 V1-V10 (Levine ΔTEE +350-550 ± 150; Bray REE ≈0/+160/+227 ± 60 kcal/d (ruling R-BRAY); Hall 2016 KD
ΔTEE −30 to +100; CALERIE-1 AT_R + ΔTEF −60 to −200 and AT total −100 to −350 at M6; Martins W9/W13; Biggest Loser
with compensation −300 to −650; MATADOR/ICECAP direction; Leibel = documented known-miss; Ohkawara steps; Mikkelsen
protein +80-120), 02 §4.1 RMR fixtures (male 35 y 180 cm 90 kg 25 %: Mifflin 1855, Müller-FFM 1879), §4.13 worked
example (day-1 TDEE 2976, week-12 ≈ 2773 ± 30).

### 1.6 `fuel` — glycogen and substrate oxidation (04 owner)

Ruling R-FUEL: 04 §4.10's hourly disposal rule set is the single substrate-oxidation model. Hall 2010's weight
machinery (01 §4.1.10), 11 §4.2-4.4's oxidative hierarchy and 05 §4.17's FALLBACK glycogen are **not** implemented;
they are validation references. Fat oxidation is the residual of non-protein, non-alcohol energy (04 §4.10, 11 §4.2).

State: `FuelState` (liver g, cM[3] mmol/kg ww per group legs/arms/trunk, smmKg[3], lastDepletionHour[3], carry and
fructose-delay queues, references, day accumulators). Init: G_L = `body.glycogen.liverG` (14 M5; 04 §2 C_L0·V_liv·0.162),
c_M from 04 §2 `(462 + 6.7·(VO2max − 53) + ΔCHO)/4.3` distributed over groups by SMM, then settled by burn-in.

Parameters (04): `cLMax` 500 mmol/L [400, 550]; `vLiv` 1.45 L [1.2, 1.8]; `cMMax` 200 mmol/kg ww [180, 290];
`hWater` 3.0 g/g [2, 4] (declared here, read by water via `liverGlycogenG`/`muscleGlycogenG`); `tauL` **20 h** [18, 36]
(04 value 24 h; `proposed-fit`, integrator A2: 04 §4.2's own check fits Taylor −41 %/10.5 h and Magnusson −65 %/18.5 h
better at 18-20 h than at 24 h, and the coupled fasting liver/BHB need it; 18 h breaks the 2 % O-10 band of the hourly
liver form);
`gLFloor` 5 g [0, 15] (UNVERIFIED); `rHalf` 10 g/h (UNVERIFIED); liver exercise slope 30 g/h per unit I above 0.20
(full sparing at ≥ 1.2 g/min CHO); `uEx75` 0.9 mmol/kg/min, exponent 1.5, availability exponent 0.5, keto reduction
0.75 [0.6, 0.8]; RT depletion `dMax` 0.40 [0.25, 0.50], `s0` 3 sets; resting `kMr` 0.0035 /h [0.002, 0.005], `cMFloor`
25 mmol/kg; repletion `sMax` 7.5 mmol/kg/h [5, 10], `kR` 0.3 g/kg/h, `eRapid` 1.0, `tauE1` 1.5 h, `eSlow` 0.3,
`tauE2` 36 h; liver synthesis `alphaGlc` 0.20 (0.10 post-exercise), `alphaFru` 0.15, fructose 0.40 → glucose (1-h delay),
0.45 oxidised; `vLSyn` 8 g/h; `fCpaRef` 0.45 [0.35, 0.55]; `fCMax` 0.95; `ec50Ox` 54 µU/mL; brain floor 4.5-6 g/h
(110-145 g/d) unless ketone-adapted (brain share from 05); DNL yield **0.3125 g fat per g glucose** [0.28, 0.36]
(ruling R-DNL: 04 §4.13 Acheson 3.2 g/g); DNL gate `G_tot ≥ 0.95·G_cap`; GNG from protein 0.57 g glucose/g protein,
from glycerol 0.10·fat oxidised (04 §4.11/4.22); fasting muscle rate `kMf` = the fasting module's `fasting.kMf` (20),
read in prepare (a module-local fallback 0.008 h⁻¹ only when fuel is registered alone in unit tests).

Burn-in re-equilibration (integrator A2): fuel records its hourly inputs over the last habitual burn-in week (days −7…−1)
and, in `endBurnIn`, replays that week 6 times with TEE_pre scaled to the week's mean absorbed energy (`eAbsKcalH`; energy's
NEAT0 calibration makes TEE = EI_hab at the end of burn-in), so glycogen starts t = 0 at its post-calibration equilibrium
(before: muscle glycogen drifted −2.6 % over the first week; now ≤ 0.4 %). Events are relative to the person's habitual
week (latched from the last replay pass): `glycogenLow` needs total glycogen below 30 % of capacity **and** below 0.75 ×
the habitual daily low; `supercompensation` needs muscle glycogen > 1.3 × the habitual daily high (≥ the fed reference) —
none fires at steady state.

Published for ketones (integrator A2, additive signals): `liverGlycogenMaxG` = c_L,max·V_liv·0.162 (daily; ketones' G50 =
g50Frac·G_L,max, no registry peeking) and **`muscleGlycogenExDefFrac`** = the exercise-driven muscle-glycogen deficit
(per group: glycogen removed by cardio/RT bouts, reduced first by any resynthesis, never more than the deficit below the
fed reference c_ref; ÷ the fed reference). Resting (k_Mr) and fasting (k_Mf) glycogenolysis do not add to it: 05's
FFA term δ_M (k_mgF 3, grade D) was fitted with a fallback muscle that falls only through exercise, and feeding it 20's
fasting decline tripled FFA (BHB ≈ 3.3 mM at 72 h and 18-28 mM by day 21 — the runaway fixed in the integration pass).

Algorithm (stepHour; 04 §4.10 steps, glycogen in g):
1. Exogenous supply `A = raGlcGH + fruDelayed + carry`; fructose/galactose first pass: `0.15 → liver`, `0.40 → glucose
   next hour`, `0.45 → CHOox_fru` (04 §4.8).
2. Liver: synthesis `S_L = min(V_L,syn, α_glc·A·(1 − G_L/G_L,max)^0.5 + α_fru·Ra_fru)`; glycogenolysis
   `J_L,out = (G_L − floor)·(1 − e^{−1/τ_L})·(1 − σ_fed) + J_L,ex` (exact form of 04 §4.2 over 1 h),
   `σ_fed = min(1, A/R_half)`.
3. Muscle: exercise use per active group `U = u(I)·(c/110)^0.5·(1 − 0.75·A_keto)` over the hour's exercise minutes
   (04 §4.4) where `A_keto = ketoAdaptFast` (ruling R-FATADAPT); RT `c ← c·(1 − D_RT·(c/110)^0.3)`,
   `D_RT = 0.40·(1 − e^{−sets/3})` for trained regions (04 §4.5); resting `J_M,rest = k·(c − floor)·(1 − σ_fed)·(1 −
   0.5·A_keto)` with `k = fastActive ? kMf-form (20: −kMf·(G_M − 0.35·G_M0), solved exactly: × (1 − e^{−kMf·1 h})) :
   kMr` → lactate to liver (not oxidised).
4. Oxidation demand: `EE_np = teePre − 4·protOx − 7·alcOx` (kcal/h); `f_C,pa = clamp(0.45·(G_tot/G_ref)²·(1 − 0.75·A_keto),
   0.05, 0.85)`; `f_C = f_C,pa + (0.95 − f_C,pa)·Ins²/(Ins² + 54²)`; `CHOox = f_C·EE_np/4.1` (≥ brain floor ×
   (1 − brainKetoneShare) unless supply-limited).
5. Allocation: `L_up`, `Ox_ex = min(A1, CHOox − CHOox_fru)`, `M_up = min(A2, Σ S_M,j·0.162·SMM_j)` with 04 §4.7 S_M;
   `A3 → DNL if G_tot ≥ 0.95·G_cap else carry` (04 §4.10 step 5).
   **Accepted deviations (ruling 2026-09-30 18:10):** (1) muscle glycogen **above** the normal-diet reference c_ref is
   mobilised on demand when liver + lactate + glycerol GNG fall short of the CHO demand (outside fasts) — required for
   O-3 (no spurious DNL at 45-70 %E carbohydrate at maintenance); (2) muscle **below** c_ref is refilled before meal
   glucose is oxidised (below the reference only: low glycogen activates synthase, 04 §4.7); (3) `choOxGH` is NET
   carbohydrate oxidation — glucose from amino acids is counted in `gngGH` but booked as protein oxidation (single booking
   of protein energy, 04 §4.11). Consequence (tracked): the 04 §4.11 quadratic law's slow glycogen drift after a switch
   (O-3 ΔG at 30/70 %E; Schrauwen's 3-day fat-oxidation lag, 13 V15 d2-d3) is faster in the engine.
6. Endogenous supply (ruling R-HGO, review M21): `HGO = CHOox − CHOox_fru − Ox_ex`. J_L,out and lactate follow 04 as
   written (G_L stays on 04's fitted τ_L curve, ≈ 63 % gone at 24 h of fasting); **gluconeogenesis fills the gap:
   `GNG = max(0, HGO − J_L,out − lactate)`**, capped by its capacity `GNG_cap = 0.57·protOx + 0.10·fatOx` (protein-derived +
   glycerol; also the value shown for display). If `GNG_cap` is short, CHOox is reduced and fat covers the gap (04 §4.10
   step 6). If `J_L,out + lactate > HGO` (surplus supply, e.g. in fasts), GNG = 0 and CHOox rises to consume the surplus
   (the glucose is oxidised, never parked in liver glycogen — that would move G_L off τ_L and change 05's ketogenesis
   partition, R-KET). `gngGH` = this GNG.
7. Protein oxidation: `protOx = raProtGH − (fastActive ? −fastProtOxGH : leanRateKgD/24·1000·f_prot)` (absorbed minus
   deposited; during fasts = the fasting module's rate).
8. `fatOx = max(0, (EE_np − 4.1·CHOox)/9.44)`; DNL fat `= DNL_glc·0.3125`, heat `dnlHeatKcalH = 4·DNL_glc − 9.441·DNL_fat`;
   `glycogenChangeKcalH = 4.207·(ΔG_L + ΔG_M)`; RQ from 04 §4.12 per-gram factors.

Numerics: glycogen explicit with Δt = 1 h is stable (τ ≥ 0.7 d); clamp pools to [floor, capacity]; carry queue caps
the stiff quadratic behaviour 11 §4.3 warned about (no daily Euler step anywhere).
Validation (unit): 04 §7 (Taylor/Magnusson liver trajectories within ±20 %; Bussau 95 → 180 mmol/kg in 24 h at 10 g/kg ±
15; Acheson 1982 479-g meal: 346 g stored, 133 g oxidised ± 20 %, no net DNL; Acheson 1988 DNL ≈ 150 g/d ± 40 on days
5-7; Schrauwen fat balance +1.06/+0.75/+0.55 MJ on days 1-3 ± 0.4; Jebb CHO oxidation within 5 % of intake by day 5);
**Oracle B (±5 % rule, R-ORACLE):** for steady-state reference menus (30/50/70 %E carbohydrate at maintenance, 7 days)
the 24-h integrals of CHOox, fatOx and ΔG must match 04 §4.11's daily reduced form within ±5 %.

### 1.7 `ketones` — FFA, ketogenesis, BHB, keto-adaptation (05; 20 calibration)

Ruling R-KET: 05 §4.17's reference implementation is normative with its FALLBACK blocks **removed**: G_L, G_M come
from `fuel`, insulin from `intake` — **`insulinRefRel`** is 05's I: 05 §4.17's insulin proxy evaluated on intake's
absorption rates, basal decline (05 liver factor / 07 time course) and IR = S_hep^−0.9 (§1.3; the domain 05's lipolysis
and ketogenesis functions were calibrated in). `insulinRel` (own-baseline 04 insulin) is kept for hormones.
The zero-intake trajectory beyond day 5 is calibrated to 20 §4.3.4 `BHB_ref` (20 is the owner of that target;
07 §4.4.1's fasting BHB values are superseded — they are 0.5-1.3 mM low for water-only fasts). A_f (05 §4.11.1) is
the single keto/fat-adaptation state (13 §4.9's fat-adaptation F_ad is not implemented; ruling R-FATADAPT).

State (`KetonesState`): `tkb`, `tkbExo` (exogenous share of the pool, so that `bhbEndo` excludes it — 08 rule), `ffa`,
`pEw` (protein memory g/d), `xPost`, `postExHoursLeft`, `aF`, `aS`, `inKetosis`, `hoursInKetosisToday`, `firstKetosisHour`.
Init (05 §4.17): TKB 0.25, FFA 0.5, A_f = A_s = 0 (A_f = 1 if habitual carbohydrate < 50 g/d, 05 §2), P_ew = habitual
protein; then the 14-day burn-in.

Parameters (05 §4.17 `K`, grades per 05 §4.1-4.12). **R-KET retune done in the coupled engine (integrator A2,
2026-09-30, second pass with `insulinRefRel` = 05's own insulin proxy; status `proposed-fit`, previous values in the
ParamDef notes)** — coordinate search inside the registry ranges against 05 V1-V3, V5-V7, V9, V10, V13, the 05 §4.7
very-low-carbohydrate onset/plateau surface and 20 §4.3.4 BHB_ref (lean man, obese woman, lean woman), scenarios in
`model/ketones/integration/targets.ts`: `kP` 0.010 [0.0075, 0.0125] and `g50Frac` 0.55 (05 values kept); `nG` **2** (was
2.5) [2, 3]; `phiMin` **0.10** (0.12) [0.05, 0.3]; `aH` **0.45** (0.35) [0.2, 0.5]; `aHs` **0.30** (0.5) [0.3, 0.8];
`kIHep` **0.09** (0.15) [0, 0.3]; `fHep` **0.2** (0.15) [0.05, 0.2]; `kProt` **0.06** (0.15) per 90 g/d [0, 0.15]
(Hall's 0.69 = note only); `aM` **0.38** (0.35) [0.2, 0.5]; with fuel's `tauL` 20 h (24). Unchanged: `vdPerBW` 0.25 L/kg
[0.18, 0.31]; `clFFM` 0.0134 L/min/kg FFM (±30 %); `km` 6.0 mM [4, 12]; `renal` 0.00025 L/min/kg [×0.5, ×1.5], `tThr`
1.0 mM; `f0` 0.50 mM; `tauProt` 8 h [6, 24]; `tauFUp` 1.0 h,
`tauFDown` 1.5 h; `kFB` 15 mM; `eDef` 1.5; `kMgF` 3.0 (grade D); `exF` 0.4,
`tauPostF` 3 h; `exCL` 1.0, `postCL` 0.6 for 2 h; `c50` 100 g/d (A_f* uses the calibrated code form, ruling on 05
digest inconsistency (a)); `tauAfUp` 48 h, `tauAfDn` 40 h; `asLo` 0.5, `asSpan` 2.0, `tauAs` 120 h; `yC8` 0.5, `yC10`
0.17, `mctMealFactor` 0.5; `mctC8Share` 0.6 [0, 1] (ENGINEERING DEFAULT, UNVERIFIED: the schedule gives MCT grams only);
exogenous D-BHB 1.0 fasted / 0.75 fed (the fed factor is applied once, by intake), salts count 50 % (05 §4.12);
BHB:AcAc `R = 1.5 + 0.3·TKB` (±40 %). nG, aHs and fHep sit at a range edge.

Algorithm (stepHour; runs after `fuel`, so G_L/G_M are this hour's):
1. `P_ew` relax (τ 8 h) toward 24·`raProtGH`. `I = insulinRefRel`.
2. FFA: `lipo = 1/(0.25 + 0.75·I^1.2)`; `d = max(0, 1 − kcalEaten24/tdeeEstKcalD)`; `X_post` = 0.4·x during exercise, else
   decays with τ 3 h; **`δ_M = muscleGlycogenExDefFrac`** (fuel's exercise-driven deficit, §1.6 — the coupling of 05's
   `(0.85·G_Mmax − G_M)/(0.85·G_Mmax)`, whose fallback muscle fell only through exercise; 20's fasting decline and 04's
   resting glycogenolysis are excluded — this was the long-fast runaway);
   `FFA* = f0·lipo·(1 + eDef·d)·(1 + X_post·h)·(1 + kMgF·δ_M·(1 − d·(1 − h)))/(1 + TKB/kFB)`; FFA ← exact relaxation
   (τ up/down). **R-KETEX (final round 2026-09-30):** every exercise effect wanes with ketonaemia by 05 §4.1's Hill factor
   `h = 1/(1 + (TKB/3 mM)^4)` (hour-start TKB; 05 §4.10 "stimulatory effects wane above 2.5 mM and are abolished/reversed
   above 3-4 mM"): the during-exercise clearance gain (05's own form), the post-exercise clearance fall
   `M_ex = 1 − 0.4·h` for 2 h (05: ×0.6), X_post, and — weighted by the 24-h energy deficit d, because k_mgF (grade D) was
   fitted in fed LCHF training (Burke) and at the start of a fast (Deru) — the glycogen-deficit drive. Unattenuated, one
   session in a 72-h fast ran BHB from 2.7 to 7-9 mM and a 7-day fast above 10 mM; now ≤ 4.7 mM (all four reference
   bodies, RT or running, `integration/qaKetones.test.ts`), with no 05/20 target moved.
3. A_f* = 1/(1 + (carbAbs24G/c50)³), relax (48/40 h) → `ketoAdaptFast`; A_s* = clamp((TKB − 0.5)/2, 0, 1), relax 120 h.
4. Production (mmol/min): `φ = [φMin + (1 − φMin)/(1 + (G_L/G50)^nG)]·(1 + aH·A_f)·(1 + aHs·A_s)`, `G50 = g50Frac·G_L,max`
   with G_L,max = fuel's `liverGlycogenMaxG`;
   `P = kP·FFM·(FFA + fHep)·φ/(1 + kIHep·I)·exp(−kProt·P_ew/90)` + MCT `m_meal·(yC8·6.37·Ra_C8 + yC10·5.41·Ra_C10)/60` +
   exogenous `exoKetoneMmolH/60` (intake's amount incl. the fed factor). P is evaluated **per 15-min quarter** (exact FFA
   relaxation means per quarter; G_L interpolated between the previous and the current hour) so that production collapses
   within the hour of a refeeding meal (coupled O-10: ≤ 1.2 % vs a converged Euler on the engine's own inputs).
5. Pool (ruling R-KETNUM, replaces 5-min Euler): `f(T) = (P − U(T) − Ren(T))/Vd`, `U = Vmax·T/(Km + T)·M_ex·(1 − aM·A_s)`,
   `Ren = renal·BW·max(0, T − tThr)`. **Four 15-min sub-steps** (P, M_ex, A_s held for the hour), each the exact solution
   of the ODE linearised at the sub-step start: `b = −f′(T0)`, `T1 = T0 + f(T0)·(1 − e^{−15b})/b`, sub-step mean
   `T* + (T0 − T*)(1 − e^{−15b})/(15b)` with `T* = T0 + f(T0)/b`; hour mean `T̄` = mean of the four; floor 0.01; the four
   `e^{−15b}` cost 4 `Math.exp` per hour. A single 60-min linearisation at T0 is **not** acceptable: when T falls by more
   than half within the hour (exogenous-ketone decay, refeeding exit from a fast) it overshoots the MM decay (T0 = 3 mM,
   P ≈ 0: 0.04 vs exact 0.41 mM; T0 = 5 mM refeed: 0.63 vs 1.13 mM), whereas 4 × 15 min stays within 3 % (review B4).
   The exogenous sub-pool `tkbExo` gets its input and a share `tkbExo/T` of U and Ren.
6. Outputs: `tkbMmolL` = T̄; `bhbMmolL = T̄·R/(1 + R)`; `bhbEndoMmolL` = BHB·(1 − tkbExo/T); `ffaMmolL`;
   `ketoneLossKcalH = 0.46·Ren·60` (05 §6); `brainKetoneShare = 0.70·T/(T + 1.5)` (05 §4.11.3; 20 §4.3.5's display form
   not used).
7. Ketosis state (05 §6): 0 none (< 0.2), 1 light (0.2-0.5), 2 nutritional (0.5-3.0), 3 fasting (3-6 with no intake in the
   last 24 h), 4 warning (> 3.0 with food in the last 24 h, or > 6.0). Events `ketosisEntered/Exited` (0.5 mM crossing,
   2-h hysteresis), `deepKetosis` (state 3), `ketoneAlert` (state 4), `ketoAdapted` (A_f crosses 0.9).

Records: `bhb` (hourly, daily mean; the UI also reads the 07:00 value from the hourly array), `ketosisState` (hourly
category; **daily = the category at the wake hour** — 05 §6 "morning fasting BHB", the trials' convention for "in
ketosis"; final round 2026-09-30, was the daily max: a moderate-carbohydrate deficit whose late first meal let BHB pass
0.5 mM before lunch, or a fasted walk, counted as a ketosis day — the 12-week starter showed "ketosis 47-81 d" with no
morning value ≥ 0.5; the hourly categories, `hoursInKetosis` and the events are unchanged),
`hoursInKetosis` (count of hours BHB ≥ 0.5), `ketoAdaptation` = **labelled combined index 50·(A_f + A_s)** ("Keto-adaptation
index"; release check 2026-10-01 — was 100·A_f, which read 94 % after a week while the brief and 05 §4.11 describe
adaptation over weeks): 05 defines keto-adaptation as its two states, fast fat-oxidation retooling A_f (days, grade B) and
slow ketone-kinetics adaptation A_s (weeks, grade C); each counts half (equal weights PROPOSED — no dossier weighting
exists). On a ketogenic diet the index is ≈ 50 at day 7 and settles at 55-65 within 3-4 weeks (A_s stays ≲ 0.1-0.3 at
TKB ≈ 1 mM, 05 §4.11.2); a 5-day fast takes it above 70. Components as detail series `ketoAdaptFast` (100·A_f) and
`ketoAdaptSlow` (100·A_s). The `ketoAdapted` event still marks A_f crossing 0.9 (fat-oxidation adaptation).

Validation — must pass after the 04 coupling retune (05 §7 tolerances: ±30 % or ±0.15 mM, ±3 h): V1, V2, V3, V4, V5, V6,
V7 (inside ±0.15 mM), V9, V10, V11 (fasted), V12, V13; plus **20 §4.3.4 BHB_ref** for water-only fasts from 24 h to 21 d
within ±30 % (lean and obese curves; B/C beyond 72 h).
Coupled fit (full engine, 2026-09-30, second pass; last meal 20:00, t = hours since it; `integration/fastingBhb.test.ts`,
`transitions.test.ts`): lean man 0.11 (12 h) · 0.51 (24 h; 0.5 accepted) · 0.92 (30 h) · 1.71 (48 h; 1.4-1.9) · 2.44
(72 h; 2.3-2.7) · 4.21 (d7) · 4.52 (d8; Ogłodek 4.77) · 5.62 (d14) · 6.03 (d21; 5.7-6.6) mM, t(0.5 mM) 24 h, AUC 0-36 h
15.4; obese woman 1.12 (48 h) · 1.53 (72 h; 20 ref 1.68) · 2.93 (d7) · 5.43 (d21) · 5.63 (d24; Owen 5.29); lean woman 0.66
(24 h; Browning 0.33 — miss) · 1.12 (30 h; Haymond 1.7) · 1.82 (48 h; Browning 1.22 — miss) · 2.47 (72 h). Very-low
carbohydrate (80-kg adult, 104 g protein): first 07:00 ≥ 0.5 mM on day 3 / 4 / 6 at 20 / 30 / 50 g/d (maintenance) and day
2 / 2 / 3 in a 25 % deficit; week 4 at 30 g/d 0.64 mM at 07:00 and 0.49 mM 24-h mean (05 surface 0.64 / 0.43), deficit
1.04 / 0.79 (1.04 / 0.68); daily swing ≈ 1.6× with a trough 2-3 h after lunch/dinner (≈ 0.40 mM); protein 60 → 180 g/d
−17 % (05 model −27 %). Hall 2016 KD 0.66 (0.77 ± 0.23), Harvey ΔBHB +0.60/+0.36/+0.19 (+0.62/+0.41/+0.27), Urbain
0.39-0.61 (0.33-0.70), Burke eucaloric 1.60 (1.2 ± 0.36 — miss); V7 exit 0.51 → 0.39 → 0.13 → 0.51 (0.59 → 0.28 → 0.19
→ 0.44); Féry TKB 0.24 → 0.37 → 0.84 (0.20 → 0.39 → 0.93). Plateau < 8 mM for the whole body matrix over 28 days.
Tracked known-misses (reported, not gating): V8 (older adults,
24-h values too high), V11 fed Cmax (−58 % vs −33 %), V14 (hypocaloric KD −36 %), V15 (post-exercise 0-carb day −60 %),
Neudorf 2025 lean 48-h 3.7 mM, chronic MCT (+0.10 vs +0.8 mM). Numerical: the hourly integrator stays within 0.05 mM
or 5 % of the 5-min Euler reference of 05 §4.17 on V1, V3, V7, V11 (module tests run with 05 §4.17's own calibration,
`testing/harness.ts REF05_CALIBRATION`, because they drive the module with 05's fallback inputs), and — coupled O-10 —
within 1.2 % of a converged Euler integration driven by the full engine's own hourly inputs (`integration/o10Coupled.test.ts`;
the literal 5-min Euler is itself 7 % off in the hour after a refeeding meal).

### 1.8 `composition` — fat mass, lean tissue, partition, regional (01, 03, 11, 14, 20)

Rulings: R-PART (partition), R-RHO, R-FPROT, R-RT (09 owns every RT effect), R-FAST (20 owns fasting lean loss),
R-OVERSHOOT (11 §4.12 kept). Hall-convention lean tissue `LT` (protein + its 1.6 g/g water; glycogen and labile water
excluded — those are `water`'s). FFM_act = FFM0 + ΔLT.

State (`CompositionState`): `fm`, `lt`, `ffm0`, `lt0`, `fm0`, `sm` (skeletal muscle), `vat`, `regional` (body
`RegionalComposition`), `pE` (today's energy share of stored/mobilised energy going to lean), `leanExtraKgD`,
`eb7`, `ebDayPlanned`, `overshoot` {`active`, `fmPre`, `ffmPre`, `pctFatPre`, `pmSS`, `deficitEndDay`},
`fastLeanLostKg`, day accumulators (N balance). Init from `ResolvedProfile.body` (14 M1-M5 via `estimateInitialState`):
`FM0 = profile.fm0Kg`, **absolute `LT0 = FFM0 − (1 + h)·G0/1000`** (ruling R-LT0, review m6: the Hall-convention protein
tissue excludes the initial glycogen G0 = `body.glycogen.totalG` and its bound water, h = `fuel.hGlyWater`; helper
`core/resolveProfile.leanTissue0Kg(profile, h)`), `SM0 = body` skeletal muscle. **End of burn-in (`endBurnIn`, ruling
R-BURNIN, review B3c):** FM, LT, SM (and the regional depots) are reset to FM0, LT0, SM0 and the overshoot/eb7 memories
cleared; burn-in drift is thereby removed, not hidden. **Morning anchor (R-MORNING, 2026-09-30):** the entered body is the
wake-hour body, so the t = 0 (midnight) masses are FM0 − ΔFM_night and LT0 − ΔLT_night, where ΔFM/ΔLT_night are the
midnight → weigh-in changes latched on the most recent burn-in day of day 0's weekday (the same habitual evening precedes
both nights; the latest burn-in day when burnInDays < 7; none when burnInDays = 0) — FM = FM0 and LT = LT0 again at day 0's
weigh-in hour. The references FM0, LT0, FFM0 stay the entered values (water has no tissue offset; its labile references are
anchored the same way in its own `endBurnIn`, §1.10). The EB7 ring and the VLI clock
keep their settled values. Records also the regional details `fatTrunk`, `fatArms`, `fatLegs`, `muscleArms`, `muscleLegs`,
`muscleTrunk` (daily `allocateRegional` runs when any of them, waist or VAT is requested).

Parameters: `rhoF` 9441 kcal/kg (A), `etaF` 179, `rhoL` 1816 (B; `draw: 'fixed'` — 03's 1000 is a different convention, recorded in `note` only; drawing it would
break f_prot = 0.385 and the fasting protein energy, review M20), `etaL` 229 (01 §4.7, 02
§4.11, 11 §4.1); 03 §4.4.2 `leanFractionOfLoss` constants (p0 10.4/(10.4 + FM); qSat, knee 0.8, M_min, d_crit, M_D slope
0.65, M_act 0.30, M_age 0.01/y ≤ 1.4 — PROPOSED FIT, grade C); 11 §4.7/§4.15 surplus constants (`rAT` 0.20 [0.15, 0.25]
UNVERIFIED, `rS` 0.45 [0.35, 0.55], m_P shape (0.75, 0.35), φ_F, m_FA 1.0 / PUFA 1.5 / SFA 0.7); 11 §4.12 overshoot
(a 0.92, b 0.11, c 0.015, threshold ramp 0.10-0.30, 26-wk expiry; P_RF × 0.5 at age ≥ 60); 03 §4.13 fasting-branch
constants (Pox_min 0.52·(1 + 0.5·L), Pox_0 0.90 UNVERIFIED, τ_N 3 d); 03 §4.14 `ΔL_age = −0.4 g/d × clamp((age − 45)/20, 0,
1.5) × (1 − 0.8·RT)`; SM split 0.5 of lean loss / 0.85 of RT gain (03 §4.19 step 7); VAT/regional per 14 M6-M7 (body module).

Algorithm:
1. (startDay) `EI_plan` = today's planned intake (DayInput); `TEE_est = tdeeEstKcalD`; `u = clamp((EI_plan − TEE_est)/TEE_est,
   −1, 1)` → `energyBalanceFrac`; `eb7` = **trailing 7-day mean (boxcar)** of (EI_plan − TEE_est) including today's plan →
   `energyBalance7KcalD` (integration 2026-09-30, replaces 11's EMA: a boxcar over exactly one week is constant for any
   weekly-periodic schedule, so training and rest days of a weight-stable week do not flip the partition regime; the EMA
   oscillated ±30 kcal/d and, with the 03/11 share jump at 0, ratcheted +0.25 kg lean / −0.1 kg fat per 90 d at maintenance).
2. Partition regime — **chosen per hour** (ruling R-PART-HOUR, review M7); the day-level quantities (p_E of c/d,
   leanExtraKgD) are computed once in startDay, the branch is picked every hour:
   a. **Fasting overlay** (`fastActive` = 1 **this hour**): lean change is the fasting module's protein flux (step 5); no
      fraction. When the fast is broken mid-day the next hours use b/c/d with the day's p_E, so refeed protein and energy
      are partitioned normally. (The fasting module activates the overlay from a planned span only for spans ≥ 24 h;
      shorter planned fasts use the 24-h intake criteria, §1.4 step 1 — a 16-h FastEvent and a 16:8 meal window give the
      same lean accounting.)
   b. **Very-low-intake, non-fasting** (EI_plan < 0.3·TEE_est and q < 0.3 g/kg FFM/d, protein ≥ 5 g/d so 20's criteria are
      not met): 03 §4.13 Pox branch → explicit lean rate `ΔLT = −(Pox·FFM − 0.3·P_eff)/(1000·f_prot)` (03 used c_P 0.206 on
      hydrated DXA lean; the Hall LT convention uses f_prot, ruling R-FPROT).
   c. **Deficit** (`eb7 < 0`): `pCat` = 03 `leanFractionOfLoss(q, d, BF, RT = 0, sex, age, BW, TEE, G_RT = 0, Q, activity)`
      with RT terms stripped (M_RT = 1, credit = 0: 09 owns RT) and M_act from `aerobicIdx` (activity module; the single
      owner of aerobic lean retention; definition ruling R-AEROBIC, §1.2 step 6), then `pCat′ = pCat·(1 − rtRetentionFrac)`
      (09 R_RT). Energy share `p_E = pCat′·(ρL + ηL)/[pCat′·(ρL + ηL) + (1 − pCat′)·(ρF + ηF)] + partitionSleepShift`,
      clamped to [0, 0.9]: 16's shift is on the P-ratio, i.e. the *energy* share of loss (16 §4.0.1 converts Nedeltcheva
      to P and states "raises a P = 0.09 baseline to ≈ 0.18"); adding it to the mass fraction pCat would make it ≈ 4× too
      weak (review M1). `q` (protein, g/kg FFM/d) excludes the protein used for labile-pool repletion
      (24·`fastRepletionGH`, 20 §4B.1 "03 must not double-count this protein").
   d. **Surplus** (`eb7 ≥ 0`): `r_L = rAT + rS·m_P(P/BW)·φ_F(FM)·(1 − s_RT)·m_FA` (11 §4.7). **R-RTSWITCH (final round
      2026-09-30):** s_RT = min(1, L_RT/L_sed) when V_wb > 0 (else 0), L_RT = 09's accretion `rtAccretionKgD`, L_sed = the
      sedentary surplus lean rate p_E(r_L at s_RT = 0)·max(EB7, W)/(ρL + ηL): RT replaces 11's sedentary surplus lean only
      as far as 09 supplies it, so total surplus lean = max(L_sed, L_RT) is non-decreasing in training volume (with 11's
      literal s_RT = min(1, V_wb/12) a trained lifter at +10 % gained less lean at 8-12 than at 4 sets/wk; R-MAINT test
      (d)). `sRtSets` is kept in the registry but no longer read. Former text: s_RT = the muscle module's
      normalised weekly RT stimulus `min(1, rtVolumeWb/12)` — 11's own anti-double-count factor; 11's h(EB)/L_RT are **not**
      used (09 f_EP owns energy modulation of RT gain). If the overshoot memory is active, blend with r_L,RF (11 §4.12).
      `p_E = r_L·(ρL + ηL)/[(ρF + ηF) + r_L·(ρL + ηL)]`. Apply r_L to the 7-day EMA of dFM (11 numerical note 2) — i.e. p_E is
      fixed per day, not per hour.
   e. **Continuity (review m20, applied at integration):** both shares are computed every non-VLI day — the deficit share
      p_def (2c; its deficit size d = clamp(−eb7/TEE_est, 0, 1), the *sustained* deficit, not one day's plan) and the
      surplus share p_sur (2d) — and blended linearly in EB7: `w = clamp(0.5 − eb7/(2·W), 0, 1)`, `p_E = w·p_def + (1 − w)·p_sur`,
      W = `composition.partBlendKcalD` 100 kcal/d (fully 03 at EB7 ≤ −W, fully 11 at EB7 ≥ +W). The regime label (deficit/surplus,
      for the overshoot memory) is the sign of EB7. With 1e the habitual week gets the same p_E every day: 90-d maintenance
      drift |ΔFM| ≤ 0.043 kg, |ΔLT| ≤ 0.044 kg (age drift) over 432 sedentary/cardio profiles (O-12 matrix).
   Explicit daily lean terms `leanExtraKgD = rtAccretionKgD (09, net of detraining) + ΔL_age/1000` (ΔL_age is in g/d);
   the refeeding repletion is an explicit **hourly** term `ΔLT_rep = fastRepletionGH·(1 + h_P)/1000` kg (the signal is
   g protein **per hour**; review M2). The RT term of ΔL_age uses `RT = rtDoseFrac` (= min(1, V_wb/V_R(age)), written by
   muscle, so composition does not copy V_R).
3. (stepHour) Stored energy `S_h = eAbsKcalH − teePreKcalH − dnlHeatKcalH − ketoneLossKcalH − glycogenChangeKcalH`
   (kcal; intake energy not oxidised and not moved into glycogen).
4. Lean first (all regimes): explicit `ΔLT_x = leanExtraKgD/24 + ΔLT_rep` costs `(ρL + ηL)·ΔLT_x` (signed: a loss
   returns `(ρL + ηL)·|ΔLT_x|`, §0.2); remaining `S′ = S_h − (ρL + ηL)·ΔLT_x`. Fraction regime: `ΔLT_f = p_E·S′/(ρL + ηL)`,
   `ΔFM = (1 − p_E)·S′/(ρF + ηF)` for either sign of S′ (review B2).
   4b. **Smooth fat floor (ruling R-FATFLOOR, review M9; replaces any hard FM clamp):** when S′ < 0 the fat share of the
   loss is multiplied by `g = clamp((FM − FM_min)/1.0 kg, 0, 1)`, `FM_min = 0.02·BW0` (`composition.fmMinFracBw` 0.02,
   `composition.fmFloorBandKg` 1.0; engineering values, `draw: 'fixed'`); the remainder `(1 − g)·(1 − p_E)·S′` is taken
   from lean tissue at ρL + ηL — energy is conserved (O-4 holds) and scale weight keeps falling. Composition writes
   `fatFloorActive = 1 − g` every hour (0 normally; implemented); safety raises warning `W-01-FATFLOOR` (danger) while it is
   > 0. Composition emits no events (§7.1 reserves `safetyFlag` for safety). 01 §4.6's Alpert cap is not a law of the
   engine (20's lean man oxidises ≈ 150 kcal/kg FM/d); it stays a warning (R-ALPERT).
   The same g applies in the fasting regime's residual (step 5).
5. Fasting regime (`fastActive` this hour): `ΔLT = −(fastProtOxGH·(1 + h_P))/1000` (20 §4B.1: P_tis −= protOx·(1 + h_P)/1000),
   its energy `(ρL + ηL)·(1 + h_P)/1000 ≈ 5.3 kcal/g × protOx` (4.7 kcal/g protein energy + the η_L saving, Hall convention
   §0.2) is part of the oxidised fuel (fuel module), and `ΔFM` = the residual `(S′ + (ρL + ηL)·|ΔLT|)/(ρF + ηF)` (subject to
   the fat floor of 4b).
6. `depositionCostKcalH = ηF·ΔFM + ηL·ΔLT` (signed; negative during net mobilisation; read by energy next hour);
   `tissueEnergyKcalH` = S_h (energy stored in FM and LT incl. deposition costs); `fatMassKg`, `leanTissueKg`, `ffmActKg = ffm0 + (lt − lt0)`, `tissueMassKg = FM + FFM_act`.
7. (endOfDay) SM: `ΔSM = 0.5·ΔLT_nonRT + 0.7·rtAccretion` (03 §4.19 step 7 for the non-RT part; the RT part uses 09
   §4.9's 0.7, the same factor muscle uses for `smRtKg` — 03's 0.85 would make the metric and RMR's γ_SM disagree;
   ruling R-RT, review M10); VAT and regional depots via
   `body.allocateRegional(prev, target)` once per day (14 M7; skipped when waist/VAT/avatar not requested); waist from
   `body.circumferencesFor` (14 M8). Overshoot memory update (11 §4.12). N balance `= ΔLT·1000·f_prot/6.25` g N/d.
   `leanRateKgD` for tomorrow (fuel reads it for protein oxidation).

Records: `fatMass`, `leanTissue`, `skeletalMuscle`, `waist`, `visceralFat`, details `nitrogenBalance`, `fastProteinCost`
(cumulative protein-tissue loss inside fasts, 20 §6).
Invariant (checked when `RunOptions.checks`): each hour `S_h = (ρF + ηF)·ΔFM + (ρL + ηL)·ΔLT` to 1e-6 kcal (signed η,
§0.2); each day `EI − TEE − ΔE_glycogen − ketone loss = ρF·ΔFM + ρL·ΔLT` within 1 kcal (TEE includes the signed
deposition cost) — exactly what `core/loop.ts` checks.
Validation (unit): 03 §4.4.2 model table (pCat for the Mettler/Pasiakos/obese arms within ±0.02 of the dossier's column,
RT arms excluded), 03 §4.13 cross-check (70-kg man day-1 N 8.2 g ± 1), 11 §4.15 prototype table (Bouchard/Johannsen/Diaz/
Bray 15-25 %/Horton/Ravussin/Roberts/Boden/Müller ΔBW ± 25 %; Bray 5 % arm = documented known-miss), 11 §4.12 Jacquet
examples (overshoot 1.5/0.5/0.17 kg at 10/20/30 % fat), 14 M7 regional tests (body module).

### 1.9 `muscle` — resistance-training stimulus, accretion, retention, strength (09, 03)

Ruling R-RT (**revised 2026-09-30, integration WP-M8**): 09 owns every resistance-training effect on lean mass: accretion
A_r, retention R_RT of non-RT loss, detraining D_r, muscle memory, habituation, strength. 03's RT terms (M_RT, the RT part
of M_min, the RT credit, AR_age) are dropped. **Protein inside A_r is 09's own f_P per kg body mass** (09 §4.8:
`f_P = 0.44 + 0.56·clamp((P − 0.8)/0.8, 0, 1)`, the form 09's k_g and its §7 targets were calibrated with) evaluated on
03's effective intake: `P` = 7-day mean of the quality-weighted protein `proteinG·proteinQDaily` (03 §4.2 integration
window, 03 §4.10 quality) per kg tissue mass. The first ruling put 03's per-kg-FFM `f_Pgain` there; that lifted older and
obese people at 1.0-1.1 g/kg BW to q ≈ 1.5-1.7 g/kg FFM (f 0.80-0.87 instead of 0.58-0.65) and missed Morton, Villareal and
Sardeli (decision table below). 03's E_dist (§4.8 daily formula, 0.83-1.0) multiplies A_r only. 09's f_age is used (16's
hypertrophy age multipliers ×1.3/×0.85 are not implemented; INTEGRATION_NOTES item 7). The energy term uses the **7-day
mean** `e₇` of `energyBalanceFrac` (09's e is a study-average balance; the daily u swings ≈ ±0.1 between training and rest
days because TEE_est contains the day's session, which biased A_r down by ≈ 10 % at weekly balance and made alternating
plans look worse than their weekly mean).
Training-status speed (INTEGRATION "09 +2.2 FFMI/yr vs 14 +1.0"): 09 owns TS dynamics; 14's prior is only an input to
the initial body-fat estimate. TS₀ by 09 §4.6 `TS₀ = max(1 − e^{−0.47·Y_eff}, clamp((FFMI − FFMI_untr)/ΔFFMI_pot, 0, 0.95))`
from the body module's `training.{ffmi, ffmiUntrainedRef}` and `Y_eff` = the body module's `trainingYearsEffective` (entered
years, or years `resolveProfile` derives), else the habits history bucket (`histYearsLt1` 0.5 / `histYears1to3` 2 /
`histYearsGt3` 5 y, the app's key values), else 0 (FFMI route only). "Currently training" (H₀ = 1, T_low,0 = 0, N > 0) = the
habitual week has RT sessions (same rule as `habitualWeek`); a cardio-only habit is not RT training.
**Habitual-training equilibrium (coordinator ruling 2026-09-30, O-12; replaces "habitual trainees keep gaining"):** the
habitual weekly RT stimulus is the person's maintenance stimulus. `endBurnIn` latches per region the reference rate
`B_ref,r` = the gross 09 §4.9 rate `B_r` of the habitual week at maintenance (e = 0) and habitual protein (0 without RT in
the habitual week); accretion is the excess `A_r = max(0, B_r − B_ref,r)`. So the habitual week keeps M_acc constant, more
volume/protein/energy (or a lower TS after a break) accretes towards a higher equilibrium TS where B_r = B_ref,r, losses come
only from 09 detraining (V_r < V_maint: breaks, stopping) and from composition's partition (a lower stimulus above V_maint
maintains — Bickel), and users who START training (no RT in the habitual week) keep 09's novice gains. Set-point: without RT
in the habitual week all of M_acc,0 is non-detrainable (`mBase`); with it, see R-DETRAIN.
**Detraining towards a retained floor (ruling R-DETRAIN, release check 2026-10-01).** A habitual lifter whose schedule paints
no lifts lost 3.9 kg lean in 8 weeks (all of M_acc,0 = TS₀·G_pot = 11.6 kg detrainable towards zero). Now:
(a) the **untrained, FFMI-derived set-point is never detrained**: a habitual lifter's trained gains are the part of M_acc,0
the body carries above the untrained reference, `G_tr = min(M_acc,0, h²·max(FFMI − FFMI_untr, ΔFFMI_train(Y_eff)))`
(ΔFFMI_train = 14's training offset `dmax·(1 − e^{−Y/3})`, the body module's `trainingFfmiOffset`, so a stated history
counts even when the body estimate did not use it; 09's TS₀ route at 2 y gives 11.6 kg of M_acc,0, 14's curve 5.5 kg — the
INTEGRATION "09 +2.2 vs 14 +1.0 FFMI/yr" conflict is resolved towards the body for what can be lost), and `mBase_r` =
M_acc,0,r − w_r·G_tr; (b) detraining decays **towards the floor** `mFloor_r = mBase_r + φ·(M_acc,0,r − mBase_r)`,
`D_r = λ(T_low)·(1 − min(1, V_r/V_maint))·(M_acc,r − mFloor_r)/τ_d`, with φ = `detrainFloorFrac` 0.5 [0.3, 0.7] (grade C,
PROPOSED: myonuclear/epigenetic "muscle memory", 09 §4.10 [68, 70, 71]; [69] finds myonuclei not permanent in human
atrophy) — a long-term lifter keeps half of the trained gains they came with; (c) gains accrued **inside a run** are above
the floor and detrain fully, as in Psilander 2019 (10-wk gains back to baseline after 20 wk) — so 09 #12's novice rows keep
their literal target and the floor applies to the long-term gains only; (d) M_peak is unchanged, so κ_mem boosts retraining
while M_acc < 0.95·M_peak (R-REGAIN below). Onset unchanged: T_low counts days with V_r <
V_maint, so with a 3-session habit the first loss comes 21 days after the last session and the full rate 14 days later.
`muscle.trainedGainsAtStart(k, profile)` returns G_tr and the losable (1 − φ)·G_tr. Numbers (real engine, QA reproduction:
man 34 y, 178 cm, 88 kg, 2 training years, 3 lifts/wk, no lifts, 100 %): G_tr 5.55 kg, losable 2.78 kg; at 18 %E protein
lean mass −1.05 kg at 8 weeks (was −3.97; lean tissue −0.94, was −3.81; fat +0.13, was +0.84) and −2.23 kg at 20 weeks (was
−8.62); at 1.6 g/kg −1.17 / −1.00 / −0.07 kg (8 weeks) and −2.45 kg (20 weeks); rtMuscleGain −1.01 kg (8 weeks), −2.25 kg
(20 weeks = 81 % of the losable 2.78 kg), bounded by 2.78 kg thereafter; nothing in the first 17 days.
The habits bucket alone ('1-3 y', no years entered) gives the same (the FFMI excess is 0, 14's curve at 2 y applies).
**Regain after detraining (ruling R-REGAIN, 2026-10-01).** Below the previous peak M_peak,r (only reachable through
detraining) the lost muscle is regained at 09's full retraining rate, `A_r = (D_day/D̄₇)·B_r` with B_r's gap term (1 − TS_r),
habituation H_r and κ_mem, capped at M_peak,r − M_acc,r; at or above M_peak,r the excess form `max(0, B_r − B_ref,r)` holds.
The O-12 excess form alone regained through B_r − B_ref,r only (a lifter back on the habitual programme after 12 weeks off
had 10 % of the loss back after 16 weeks, 37 % after a year at κ_mem 1.0); the proportional-reference variant first
written here (B_ref scaled by (M_acc − mBase)/(M_acc,0 − mBase)) was measured at 25 % / 44 % (κ 1.0 / 1.3) in 16 weeks and
rejected. Nothing else moves: a habitual lifter at M_acc,0 = M_peak stays on the excess form (steady-state matrix flat),
novices have B_ref = 0 (unchanged), the floor rule is untouched; κ_mem default → 1.3 (09's boost; R-MEM's 1.0 = registry
low; Psilander 2019 saw no retraining advantage after 10 weeks of training — grade C). Basis of the target: 09 §4.10
"regain is fast because TS falls with M_acc (gap term) plus κ_mem" — 09's own rate with no reference regains 86 % of this
lifter's 12-week loss in 16 weeks; Ogasawara 2013 (regain to the continuous-training level within the next block after
3-wk breaks) and Blocquiaux 2020 (1RM regained in < 8 wk after 12 wk off) point the same way. Real engine (QA lifter,
12 weeks off: −1.60 kg training-attributable, −1.57 kg lean tissue; then the habitual programme at 100 %): 38 % back at 8
weeks, **76 % at 16 weeks**, 100 % at 26 weeks, then flat at M_acc,0 (κ_mem 1.0: 29 / 63 / 98 %). Tests: `muscle.test.ts`
R-REGAIN (≥ 60 % at 16 weeks, all by 26, never above M_peak, faster than κ 1.0), `rDetrain.test.ts` (same, real engine).

State (`MuscleState`, 9 regions `TRAINING_REGIONS`): 7-day rings of effective sets, CWI-lost sets (`cwiLossHist`), protein
(`qRing`, g/kg BW) and `energyBalanceFrac` (`eRing`); `mAcc[9]`, `mAcc0`, `mPeak[9]`, `mBase[9]`, `mFloor[9]` (R-DETRAIN), `hR` (H_r), `wR` (W_r),
`tLow[9]`, `fatR[9]`, `daysSinceTrained[9]` (burn-in included), neural N and `strength0`, strength references `fatRef`,
`eaRef` (habitual-week means), kernel states (`kAmp`, `kAge`, `kResid`), MPS-layer states (`R`, `xRT`), `uIndividual`.

Parameters (09): `kG` 0.001507 /d (0.55/yr, PROPOSED FIT, C); `dFfmiPotM` 6.0 [5, 7], `dFfmiPotF` 4.3 [3.3, 5.3] (D);
region shares/ρ_reg (09 §4.15 table, D); `kRir` 0.059 [0.02, 0.09] (0.045 ≥ 80 %1RM, 0.075 < 60 %1RM); f_load, f_rest,
w_dir 0.5 indirect; `beta` 0.01768 (f_V, V_cap 40); f_F 0/0.90/1.00/1.05; habituation τ 14 d up / 60 d down (UNVERIFIED);
swelling a 0.05, τ 7 d; **`fP0` 0.44, `pLow` 0.8, `pPlateau` 1.6 g/kg/d** (09 §4.8 f_P; Morton breakpoint 1.62, CI
1.03-2.20; B; 03's f_Pgain per kg FFM, q0 0.49 / λ 0.61, is the rejected alternative in `note`); `d0` 0.30 [0.20, 0.45];
**`rhoMax` 0.5** [0.5, 1.0] (R-PROT2 fallback applied, see below; 09's 0.8 in range); `bS` 0.15, `eSat` 0.10; `rMax` 0.75 [0.5, 0.95]; V_R 6 → 10 sets/wk (age 50 → 70); V_maint 3 → 9
(50 → 70), 10 > 75; detraining λ = clamp((T − 14)/14, 0, 1), `tauD` 70 d [42, 140], **`detrainFloorFrac` 0.5** [0.3, 0.7]
(C, PROPOSED; R-DETRAIN: Cumming 2024 PMID 39159314, Seaborne 2018 PMID 29382913, Snijders 2020 PMID 32175681; counter-evidence
Rahmati 2022 PMID 35961635); `kMem` **1.3** [1.0, 1.3] (ruling R-REGAIN 2026-10-01: 09's ×1.3
retraining boost; was R-MEM's conservative 1.0, now the registry low); f_age = max(0.6, 1 − 0.0086·(age − 40)) above 40; MPS
kernel A(H) = 1 + 0.6·H, τ(H) = 30 − 20·H h, a(s) = 1 − e^{−s/4}; fatigue c_fat 0.02/set, τ 2 d (1.5 without failure), cap
0.3; strength α 1.0 (UNVERIFIED), `nMaxBase` 0.05, **`nMaxSlope` 0.125** [0.10, 0.20] (ruling R-STR: 09's 0.20 gives +31 %
at 12 wk vs published 19-27 %; refit so the 09 §4.14 novice check lands at +23 % ± 4), h_S coefficient 0.14635, f_loadS
1.0/0.85/0.65, τ_N 21 d up / 280 d off; individual multiplier `uIndividual` 1 [0.33, 3.0] logTri (≙ 09 §4.16 LogNormal
σ 0.45; varies only in ensemble draws, §8.1); the history-bucket years (above); **`fCwi` 0.8
[0.5, 1.0]** (21 §4D-4 post-RT limb cold-water immersion ≤ 15 °C: Grgic 2023 PMID 35068365 strength ES −0.23, limb −0.31;
Roberts 2015 PMID 26174323 no type II CSA gain with CWI; B strength / C hypertrophy; 21 §7 #10 ratio 0.65-0.95); 03 §4.7
hourly MPS layer constants (s0 0.045 %/h, K 0.07 g/kg FFM/h, n 4, A 2.0, k_R 2.0 /h, m 4, τ_R 4.5 h, a_X 1.1, b_X 1.5, τ_X
36 h untrained / 12 h trained); anabolic resistance 03 §4.14 (K_age, AR_fed 0.74 while steps < 1 500/d for older users,
obesity AR_fed 0.63 at BMI ≥ 30).

Algorithm:
1. (stepHour) Effective sets this hour per region from `rtSetsByRegion` × f_RIR(rir, load) × f_load × f_rest (rest of the
   covering resistance session; ×0.95 beyond the 10th set when `muscleGlycogenRel` < 0.5, f_fastHV). Sets of a session with
   `SessionResolved.coldWaterImmersion` (undefined = false) also book `(1 − fCwi)·sets` into the CWI ring. Update the MPS
   kernel (→ `mpsStimWb` = muscle-mass-weighted kernel value, to `cellular`; always computed). MPS display layer (03 §4.7B;
   **skipped with X_RT when `seriesEnabled[mps] = 0`**): `x = raAaQGH/FFM`, `S = x⁴/(K_age⁴ + x⁴)`, refractoriness `R` by
   the exact solution of `dR/dt = k_R·S⁴(1 − R) − R/τ_R` with S held for the hour, `X_RT` from the bout stimuli; `MPS =
   s0·f_E,MPS·AR_basal·(1 + a_X·X) + s0·f_E,MPS·AR_fed·A·S·(1 − R)·(1 + b_X·X)` × `mpsSleepMult`; record `mps` = 100·MPS/s0
   (index; display only — its integral never changes mass, 03 §4.7). `exHardSession` handled by activity.
2. (endOfDay, 09 §4.17 per region) push today's sets; V_r (7-d sum), F_r; H_r, W_r; gross rate `B_r = kG·G_pot,r·(1 − TS_r)·
   f_V·f_F·f_P(P₇)·f_EP(e₇, P₇, TS_r)·f_age·H_r·κ_mem·ρ_reg·f_CWI,r·u·D̄₇` and `A_r = (D_day/D̄₇)·max(0, B_r − B_ref,r)`
   (below M_peak,r: `(D_day/D̄₇)·B_r` capped at M_peak,r − M_acc,r, R-REGAIN),
   where `D = mpsSleepMult·f_alc·f_Cr·E_dist` (D̄₇ its 7-day mean: a periodic week gives B_r = B_ref exactly every day, and
   without a reference A_r = the old daily 09 product) and `f_CWI,r = 1 − Σ_7d CWI-lost sets / V_r` (a session followed by CWI
   keeps fCwi of its stimulus; every session with CWI → ×0.8); on training days only `f_alc = 1 − 0.16·dose_gkg` (≥ 0.3 g/kg protein within 2 h; reduction capped at 0.25) or
   `1 − 0.25·dose_gkg` (no protein; cap 0.37) for alcohol taken between session end and 8 h later (15 §4.10; the dossier's
   "floor" is a cap on the reduction), and creatine `f_Cr = 1 + 0.05·creatineSatFrac` [0, 0.10] (15 §4.12; 21's 15 %
   accretion multiplier = high, ruling R-CREATINE); detraining D_r towards `mFloor_r` (R-DETRAIN); M_acc, M_peak, TS.
   `rtAccretionKgD = Σ A_r − Σ D_r` (to composition, next day); `rtDoseFrac = min(1, V_wb/V_R(age))` (composition's RT
   index for ΔL_age); `rtRetentionFrac = 0.75·rtDoseFrac`; `smRtKg` = 0.7·Σ (M_acc − M_acc,0) (09 §4.9 SM ≈ 0.7 × FFM
   change; **change since t = 0**, review M10) for energy's γ_SM; `rtVolumeWb` = V_wb (muscle-mass-weighted weekly
   effective sets) for composition; `trainingStatus` = mass-weighted TS.
3. Strength (09 §4.14): N relaxes to `N_max(TS)·h_S(V_S)·f_loadS·f_FS(F)·f_CWI,wb` (τ 21 d) if trained this week else decays
   (τ 280 d); `strength = 100·(1 + N)/(1 + N₀)·(SM/SM₀)·[(1 − Fat_acute)/fatRef]·[strengthEaMult/eaRef]` (19 §4.3 M_EA, read
   from wellbeing). **Baseline treatment of habitual fatigue:** `fatRef`, `eaRef` are the habitual-week means (last 7 burn-in
   days), so a habitual trainee's index averages 100 over the habitual week (session days ≈ 97, rest days ≈ 102-104); the
   t = 0 value is that mean, 100 by definition.
4. **Burn-in and `endBurnIn` (R-BURNIN).** The burn-in runs every state on the habitual week (set/CWI/protein/e/day-factor
   rings, habituation, T_low, fatigue, N, kernel, MPS layer) except the training-attributable mass (M_acc, M_peak frozen at
   their 09 §4.6 values; `rtAccretionKgD` = `smRtKg` = 0) and events. `endBurnIn` latches M_acc,0, SM₀ (after composition's
   reset) and `B_ref,r` (e = 0; the e ring restarts at 0 as energy re-anchors at maintenance), sets N to its habitual
   equilibrium (step 3 target; 09 §2's 0.8·N_max is only the no-burn-in fallback) and latches fatRef/eaRef. At t = 0:
   rtMuscleGain = smRtKg = 0, strength = 100, trainingStatus = 100·TS₀.

**Equilibrium check (full loop, 90 d):** habitual RT cells of A1's O-12 matrix (3 RT sessions/wk, history 1-3 y, both sexes,
22-70 y, BMI 20-38): worst |ΔFM| 0.011, |ΔLT| 0.011 kg (limit 0.15; were +0.7 kg lean before); O-12 personas (30 d): MAN
3 sessions/wk ΔLT +0.003, LEAN_MAN 0.000, WOMAN 4 cardio +0.002 kg; trainingStatus and rtMuscleGain flat. Habitual RT person
(m45 BMI 27), 90 d: surplus 115 % + 1.8 g/kg +0.26 kg, VLC (protein 20 %E > habitual) +0.19 kg, deficit 75 % + 2 g/kg 0.

Records: `mps`, `strength`, `trainingStatus`, `rtMuscleGain` (Σ M_acc − initial). Events: `detrainingOnset` (λ > 0 in the
region with the most M_acc above its R-DETRAIN floor, among regions with effective sets in the last 8 weeks of burn-in +
simulated history — never for a habit without RT),
`supercompensation` is fuel's.

Validation (R-DETRAIN, `muscle/rDetrain.test.ts`, `muscle.test.ts`, scenario 09 #12 rows `lifter3`/`lifter20`): the QA
reproduction above (≤ 1.2 kg lean at 8 weeks, ≤ the floor-bounded (1 − φ)·G_tr at 20 weeks, three profile variants); 09 #12
re-expressed for a long-term lifter — ≤ 3 % of the losable gains lost in 3 weeks (0.6 %) and 82 % ± 10 after 20 weeks
(81 %; the dossier's "82 % of M_acc" read as 82 % of what can be lost above the floor), the novice rows keep the literal
target (in-run gains detrain fully); continuing lifters flat (O-12 matrix, R-MAINT (a)); novice start at the Benito rate;
retraining after 12 weeks off regains ≥ 60 % in 16 weeks (R-REGAIN, 76 %); the VLC → high-carbohydrate
switch of the QA (lifts painted: lean tissue ≈ 0, fat −2.0 kg). Registry range φ 0.3-0.7 checked (loss after a year =
(1 − φ)·G_tr).
Validation: 09 §7 #1-14 (e = 0 means energy = model TEE, review m21: `pctMaintenance 100` excludes the added sessions' EE and
runs at e ≈ −0.08; the WP-M8 fixtures use the mean model TEE of a first pass; RCT arms are people who are NOT already doing
the study programme — Benito's trained arm is a trained person without habitual RT, H ramping from 0, because a habitual
trainee repeating their own programme is at equilibrium); habituation H 0.40/0.65/0.79/0.96 at d 7/14/21/42; strength novice
12 wk 19-27 % (+3) after R-STR; Longland PRO > CON and Garthe slow > fast in direction — magnitudes known-miss; 21 CWI ratio
0.65-0.95 (model 0.80). **Protein-basis decision (R-RT revised)**, full engine with the real composition, e = 0 at model TEE,
14 A/B-graded targets: (a) reference FFM (14 M5 FFMI₀ 19.6/16.0·h²) 11/14; (b) 09 f_P per kg body mass **13/14 — adopted**;
(b′) 03 f_Pgain on 0.82·BW 12/14; (c) keep 03 f_Pgain per kg FFM 11/14 (9/14 with the daily e). Before = (c) with daily e
and ρ_max 0.8; after = (b) with e₇, ρ_max 0.5 and the habitual-training equilibrium:

| Target (dossier) | Grade | Tolerance | Before | After |
|---|---|---|---|---|
| Benito untrained / trained TS₀ 0.45 (09 #1) | B | 1.54 / 0.98 ± 0.4 kg | 1.36 / 0.91 | 1.37 / 0.76 |
| Morton supplemented/control 1.4 → 1.8 g/kg (09 #2) | B | 1.27 ± 0.15 | 1.10 ✗ | 1.16 |
| Morton 1.2 → 1.6 / 1.6 → 2.4 g/kg (03 §7 #4) | A/B | 0.1-0.5 / < 0.15 kg | 0.20 / 0.17 ✗ | 0.45 / 0.01 |
| Peterson ≥ 50 y, mean of M/F (09 #3) | B | 1.1 ± 0.4 kg | 1.13 | 0.94 |
| Murphy zero crossing, 1.3 g/kg, Murphy's fat-based deficit (09 #4) | B | 500-700 kcal/d | 636 | 604 |
| Murphy, WP-V scenario (1.6 g/kg, prescribed deficit below TDEE0) | B | 500-700 kcal/d | 810 ✗ | 660 |
| Longland PRO > CON / difference ≥ 0.4 kg (09 #5, 03 §7 #1) | B | direction / ≥ 0.4 | ✓ / 0.19 ✗ | ✓ / 0.09 ✗ |
| Garthe slow > fast (09 #6) | B | > 0 points | +0.10 | +0.10 |
| Villareal RT arm (09 #7) | B | −1.0 ± 0.8 kg | −0.09 ✗ | −0.23 |
| Sardeli RT − CR (95 % CI) | B | 0.36-1.27 kg | 1.15 | 1.00 |
| Ballor FFM-share ratio RT/diet (09 #8) | B | 0.25-0.5 | 0.20 ✗ | 0.26 |
| Chaston ΔFFM/ΔW with RT (03 §4.4.2 row) | B | 0.17 ± 0.14 | 0.05 | 0.05 |

Remaining misses: Longland difference (0.09 kg; 03's own model 0.71, 09's 0.45 — the ρ_max 0.5 fallback trades Longland's
magnitude, grade K, for Murphy's crossing, grade B); Murphy at 1.6 g/kg on the fat-based axis 745 kcal/d (just above);
the non-RT arms (Villareal aerobic −1.3 vs −2.7 kg, Ballor diet share 12 vs 24-28 %, Chaston sedentary 0.19 vs 0.27,
Mettler) are composition's partition. **Calibration item (ruling R-PROT2, review M13) — fallback applied:** protein acts in
both 03's partition (M_P) and 09's ρ(P); both are kept. With ρ_max 0.8 the full engine put the crossing at 810 kcal/d (WP-V
scenario, 1.6 g/kg) and 622 / 813 kcal/d at 1.3 g/kg (Murphy's fat-based / prescribed axis) — above the band, not below
400; the coordinator ruled ρ_max 0.5 (registry low): 660 kcal/d (WP-V) and 604 / 789 kcal/d (1.3 g/kg). Murphy & Koehler
estimated each study's deficit from the fat-mass change (≈ 9 441 kcal/kg). Longland PRO > CON and Garthe slow > fast hold.

### 1.10 `water` — labile water, gut, scale weight (13, 15, 04, 20)

Ruling R-WATER: one implementation per term — glycogen water `h·ΔG` with h = 3.0 g/g [2, 4] (04 §4.1 owner; 01/11's 2.7
kept only inside the BWP oracle); carbohydrate/insulin natriuresis = 13 §4.3 `E_cna` with 15's `A_nat = 0` (15 §5.1
merge) with, while `fastActive`, 20 §4.5.2's body-size-scaled fasting target `E_fast* = −1.3 L·(ECF0/17 L)`, ECF0 =
0.2 L/kg·BW0 (R-EFAST, 2026-09-30: replaces 13's `−E_max·(1 + k_fast)`, which gave every body size −0.9 L and left the
obese woman of 20 Table A3 0.5 kg short on days 1-3; same state and time constants, still one implementation); dietary sodium = 13 §4.4
`S_na` with 15's partial habituation h_Na = 0.5 (Na_hab relaxes toward Na0 + (1 − h_Na)·(Na_in − Na0)) and τ_Na 1.5 d
(15), which gives the steady-state 0.0054 kg per mmol/d that 15 §4.7 quotes (κ 0.006 vs 0.0054 resolved); gut content =
13 §4.5 `M_gut` (15's W_gut,fibre not added); refeeding oedema = 20 §4.5.2 (`fastOedemaL` from fasting); menstrual water =
16 §4.5 `W_cycle`; creatine water = 15 §4.12 `W_Cr = 0.9 kg·creatineSatFrac` [0.5, 1.5]; hydration deficit = 15 §4.8 H_def
(default fluid = need → 0); plasma volume after hard sessions 13 §4.6 (+4.5 mL/kg, τ 2 d). Scale noise and the weekly rhythm
(13 §4.1) are **not** simulated (deterministic engine); the UI may draw a ±0.35 %·BW noise band.

State: `ecnaL`, `sNaMmol`, `naHabMmol`, `mGutKg`, `mGutRefKg`, `pvL`, `hDefKg`, `glycogenRef` (burn-in values).
Parameters: `hGlyWater` read from fuel's registry entry (single owner, no duplicate); `eMax` 0.6 L [0.3, 1.0], `cRefCna`
100 g/d [50, 150], `tauDown` 1.5 d [1, 3], `tauUp` 0.7 d [0.3, 1.5] (13 §4.3, PROPOSED FIT); `eFastL` 1.3 L [1.1, 1.5]
(20 §4.5.2; range = 20 §4A's ±15 % ΔBW band), `ecfRefL` 17 L and `ecfPerKgBw` 0.2 L/kg (fixed; 01 §4.12's ECF0 used by 20's
tables) — `kFast` and the `fastZeroCarb` switch are retired (R-EFAST);
`tauNa` 1.5 d [0.5, 2], `tauHab` 5 d [3, 10], `hNa` 0.5 [0, 1] (0 = Heer full habituation, 1 = Visser none); gut `s0` 162 M
/ 83 F g/d, slope 5 g stool per g NSP, `tTr` 2.0 M / 3.0 F d [1.5, 3.5], `tauEmpty` 1.5 d; PV 4.5 mL/kg, τ 2 d; cycle
water amplitude per 16 §4.5; H_def τ 0.5 d, f_kidney 0.6, cap 2.5 kg.

Algorithm (stepHour; exact relaxations with hourly factors): glycogen water `= h·(G_L + G_M − G_ref)/1000`; `E_cna*` =
`−eMax·max(0, 1 − C/cRef)` with C = `carbAbs24G` when fed, and `E_fast*` from the first fasting hour (natriuresis starts
with the fast as in 20's 24/48/72-h table instead of waiting for the 24-h carbohydrate ring to empty); S_na from the day's sodium spread over waking hours (sweat
losses subtract, 15 §4.7 `L_sweat`); M_gut toward `(S0 + 5·NSP)·T_tr/1000` (τ = T_tr/2 filling, 1.5 d when intake ≈ 0);
oedema, cycle, creatine, PV, H_def. `labileWaterKg` = sum of **all** labile deviations from the burn-in-end references,
**including the glycogen mass itself**: `(1 + h)·(G_L + G_M − G_ref)/1000 + E_cna + S_na/140 + (M_gut − M_gut,ref) + E_oed
+ PV + W_cycle + W_Cr − H_def` (kg); `scaleWeightKg = tissueMassKg + labileWaterKg` (the previous form added
`(1 + h)·ΔG` on top of a labile sum that already contained `h·ΔG` — glycogen water counted twice; review B1).
**End of burn-in (`endBurnIn`, R-BURNIN + R-MORNING):** the entered weight is a wake-hour (post-void, fasted) weight, so
each labile reference is the value the quantity will have at day 0's weigh-in hour: its t = 0 (midnight) state plus its
midnight → weigh-in change latched on the most recent burn-in day of day 0's weekday (glycogen, sodium/fluid sum and gut
contents; none when burnInDays = 0). Every labile deviation is then ≈ 0 at the day-0 weigh-in and positive at t = 0 by the
habitual overnight fall; composition anchors the tissue masses the same way (§1.8), so the **day-0 weigh-in scale weight =
the entered weight** (O-5, `meta.checks.t0WeightErrKg`, measured by the core at that hour: ≤ 3 g in the O-12 matrix)
whenever day 0 continues the habitual night (no fast overlay, food, exercise or other wake time before waking). Water
carries **no** tissue offset. `scaleWeight`, `leanMass`, `bodyFatPct` and the water details are hourly series whose
daily value is the weigh-in value (`agg: 'wake'`, the state at clock time ⌈sleepWakeH⌉ = the value recorded for hour
⌈sleepWakeH⌉ − 1, `core/math.wakeRecordHour`) and whose t = 0 value (`initial`) is day 0's weigh-in value; the midnight
t = 0 scale is `meta.checks.t0ScaleKg`. M_gut target while `fastActive` = 0 (13 §4.5: the colon
empties with τ_empty 1.5 d when intake ≈ 0; the fed formula with S0 would keep ≈ 0.5 kg; review M16).
**DXA-equivalent lean** (INTEGRATION "DXA-lean vs protein tissue"; 20 §4.5.3): `leanMass = scaleWeightKg − fatMassKg`
(= FFM_act + labileWaterKg; the earlier term list omitted cycle water and H_def, so ΔleanMass ≠ Δscale − ΔFM; review
M15) — reported as `leanMass` (owner water) and distinguished from `leanTissue` (protein-based, owner composition). `bodyFatPct = 100·FM/scaleWeight`.
Records: `scaleWeight` (wake-hour value), `leanMass`, `bodyFatPct`, details `glycogenWater`, `ecfShift`, `gutContent`,
`waterWeight`. Events: `waterRebound` (scale weight +≥ 0.5 kg within 3 d while fat mass falls, 13 T4),
`weightPlateau` (7-d mean scale weight moves < 0.1 kg over 14 d while EB7 < −200 kcal/d: water masking fat loss, 13 §4.7;
EB7 = `energyBalance7KcalD`, read by water — implemented as stated, no fat-loss proxy). `cycleDay` is 1-based (1 = first day of menses; −1 = not tracked).
Validation: 13 §4.2 Hall 2016 KD switch (extra −1.6 ± 0.2 kg rapid loss; model glycogen ≈ −1.2 + E_cna ≈ −0.4), 13 §4.4
step +100 mmol/d → +0.4-0.8 kg by day 3-7, Visser +150 mmol/d → +1.4 kg ± 0.6 at 7 d, Heer no TBW change (inside the h_Na
range), 20 V1 DXA-lean −4.6 ± 1.0 kg at 7 d and V2 refeed recovery, 15 V14-V15 creatine water, 13 §4.5 gut examples.

### 1.11 `hormones` — leptin, T3, cortisol, testosterone, menstrual risk, IGF-1 (12, 08, 19)

Daily states updated in `endOfDay` with 12 §4.0's exact first-order rule `x ← x* + (x − x*)·e^{−1/τ}` (Δt = 1 d; the
0.25-d fasting option is unnecessary because every fasting driver is already an hourly signal integrated into the day).
Hormones are **biomarkers and appetite drivers, never RMR drivers** (12 ruling; 02 owns AT). Ghrelin/SPI (12 §4.2) and
GH (12 §4.7) display states are **not implemented** (review m11: no consumer, no metric; hunger is §1.12's HPI).
Reads `tdeeEstKcalD`, `fatMassKg`, `ffmActKg`, `insulinRel` (h), `hoursSinceMealH` (h), `testoSleepMult`, `sleepDebtFastH`.
Drivers (12 §4.0): **`u = EI_d/T̄ − 1`, T̄ = 7-day trailing mean of `tdeeEstKcalD`**, clamped to [−1, 1] — intake enters
day by day, expenditure as its weekly mean (decision 2026-09-30: 12 §4.1 "leptin reflects cumulative short-term energy
balance" [14]; with the day's own TEE a habitual exerciser at a flat habitual intake alternated u ≈ −0.08/+0.12 between
training and rest days and the asymmetric τ biased every state — full loop: leptin t = 0 jump −12 %, weekly-mean drift
−10 %; a zero-intake day is u = −1 either way). `φ_L(u) = 1 − e^{−max(0,−u)/0.20}`, `φ_E(u) = 1 − e^{−max(0,−u)/0.30}`,
`DC_L = max(0, 1 − carb/150)`, `DC_T = max(0, 1 − carb/130)` (cortisol), **`DC_T3 = max(0, 1 − carb/50)`** (ruling R-T3:
Spaulding "≥ 50 g → no T3 change" and 13 §4.11's 50-g threshold win over 12's 130 g; `t3CarbKnee` 50, 130 in note),
`S_L(L) = L³/(L³ + L50³)`, L50 1.0 ng/mL men / 2.5 women.

- **Baseline and habitual week (§3.4 contract).** On burn-in days the module computes each state's equilibrium on the
  habitual day at u = 0: `C_hab = 1 − 0.37·DC_L`, `T3f_hab = 1 − 0.22·DC_T3`, `rT3_hab = 1 + 0.15·DC_T3`, `Cort_hab = 1 +
  0.05·DC_T + 0.04·dF` (a habitual low-carbohydrate pattern is long-standing: n_LC past its 21-d habituation), testosterone
  core = the habitual `testoSleepMult` (leptin, fasting and obesity terms are 1 at the reference), composition factor
  `F_fat·F_prot·F_alc` of the habitual day, SHBG at the habitual daily insulin minimum. `endBurnIn` sets the states to
  these values (A = 1), latches them as the references of the relative outputs (`L = L_FM·A·C/C_hab`, so L = L0 on the
  habitual diet; `T3 = (T3f/T3f_hab)·(L_FM_lag/L0)^0.30`; Cort, rT3, Tt, SHBG = state/reference), shifts the 7-day
  expenditure window to the burn-in week's mean intake (energy calibrates NEAT0 there, §3.4), resets the protein window to
  P_hab and latches the habitual IGF-1 level (`igf1Rel` = 08 state / its value at t = 0). Every relative output is exactly
  1 at t = 0; at habitual maintenance (full-loop matrix, sedentary and cardio habits) weekly means stay within 0.3 % over
  90 d; RT habits follow composition's recomposition at maintenance (FM −0.2, LT +0.7 kg/90 d → leptin −11 %,
  testosterone −10 % at 6 % body fat; O-12 owner).
- **Leptin (12 §4.1, ruling R-LEPTIN: 12's form; 13 §4.11's alternative and 16's sex multiplier not implemented):**
  `L0 = a·FM0^b` (men 0.21/1.14; women 0.22/1.36, post-menopausal ×0.80); `L_FM = L0·(FM/FM0)^β`, β 1.8 [1.1, 2.4];
  `A* = 1 − a_max·φ_L(u)` (**0.28** men — 12's 0.35 re-fitted inside its range [0.2, 0.5] to the 12 fit list with the full
  engine (Dubuc men −43 %, sex ratio 1.42; Kiel −53 %) — / 0.55 women) or, in surplus,
  `min(1.5, 1 + k_ov·u·(f_carb + 0.5·f_prot + 0.15·f_fat))` with **k_ov 0.75** (12's 1.0; the Kiel overfeeding week raised
  leptin to 1.36 and inflated the restriction fall), τ 1.5 d down / 0.5 d up; `C* = 1 − 0.37·DC_L` (12 §4.1(d) PROPOSED
  0.30 re-fitted to 0.37 [0.2, 0.4] on Ebbeling 2012's leptin ratio with the full engine; τ 1.5/0.5); `L = L_FM·A·C/C_hab`; `L_FM_lag` τ 21 d. Writes `leptinRel`,
  `leptinSuffFM`, `leptinSuff0`.
- **T3 (12 §4.3):** `T3f* = 1 − 0.22·φ_E(u) − 0.22·DC_T3` (u ≤ 0), `1 + 0.10·min(1, u/0.3) − 0.22·DC_T3` (u > 0; the
  carbohydrate term is kept so T3 is continuous at u = 0), τ 2 d down / 3 d up; `T3 = (T3f/T3f_hab)·(L_FM_lag/L0)^0.30`.
  rT3 per 12 §4.3 (display state, no metric; skipped in planner mode). Writes `t3Rel`.
- **Cortisol (12 §4.4):** `Cort* = 1 + ΔER* + ΔLC* + 0.04·sleepDebtFastH + Δlean*` (τ 1 d), with 12's n_def/n_LC counters;
  display only (no reader): computed only when the `cortisol` series is recorded.
- **Testosterone (12 §4.5, men):** `T*` = leptin-threshold term × fasting term × F_ob·F_fat·F_prot·F_alc × **testoSleepMult**
  (16 replaces 12's F_sleep, ruling R-SLEEP), τ 2 d down / 7 d up; SHBG `(Ins_rel)^−0.3` (τ 7 d) and free T by Vermeulen
  are display states without a metric (skipped in planner mode). Writes `testosteroneRel` (1 for women).
- **Menstrual-disturbance risk (ruling R-MENS):** single implementation = 19 §4.9 `P_LPD = clip(1/(1 + e^{−0.20·(MEN −
  15)}), 0.10, 0.90)` with MEN = mean over the last 84 recorded days (3 cycles) of `max(0, −100·u)`, u as above (deficit
  % of needs incl. exercise, 19 §2; expenditure as its 7-day mean); computed only for pre-menopausal women not on hormonal
  contraception (else NaN). Reason: it is the only form with a quantitative validation target (19 V8, Williams 2015,
  ±0.15) and is expressed per cycle as the UI needs; 12 §4.6's EA-based `R_MD` (OR 0.91 per kcal/kg FFM) is the
  documented alternative (not computed); the EA dimension is covered by HC-E4/W-E08 on `ea7`. Writes `reproRiskFemale`.
- **IGF-1 (ruling R-IGF: 08 §4.12 only; 12 §4.7's protein-elasticity ODE not implemented):** hourly-driven, updated in
  stepHour: `s = 1/(1 + e^{−(hFast − 30)/LW})`, `T_E = 1 − (1 − 0.25)·s`; protein factor `min(1, TP(P7)/TP(P_hab))`
  updates only while hFast < 24 (τ_P 168 h); the state relaxes to `T_E·igfProt` with τ 44 h down / 173 h up (exact
  hourly factors). Writes `igf1Rel`. Decisions (2026-09-30): (a) **obesity modifier** — 08 gives no form: known miss (20
  §4.7: obese men show no fall at 72 h). (b) **Hartman "unchanged at 56 h"** — incompatible with 08's ranges together with
  Chan's −50 % at 72 h (needs τ_down ≈ 10 h vs 30-60 h; best in range lag 42 h/LW 2 h/τ 30 h gives 0.72 at 56 h with
  0.53 at 72 h; defaults 0.70 at 53 h, 0.55 at 72 h): known miss, lag not changed. (c) **Protein above habitual** — the
  ratio `TP(P7)/TP(P_hab)` exceeded 1 whenever P_hab < 1.67 g/kg (full loop +19 % at 1.6 g/kg, +21 % at 2 g/kg from a
  habitual 1.0 g/kg) although 08 §2 gives igfProt 0.5-1.0 ("1.0 at habitual protein") and igf1Rel ≤ 1.05 and no 08 row
  raises IGF-1 with extra protein: capped at 1 (`igfProtRatioMax`, fixed; 12's uncapped (P/P_ref)^0.43 is the rejected
  R-IGF form). Protein below habitual still lowers IGF-1 (V5).
Records: `leptin`, `t3`, `cortisol`, `testosterone` (male only), `menstrualRisk` (female only), `igf1`.
Validation: 12 §7 and Appendix A regression table (leptin fits −61 % 3-d fast, Dubuc, Mars, Müller within ±15 points;
Chan 72-h = known under-prediction), T3 fit list (±12 points), cortisol, testosterone contest-prep −72 % ± 10; 19 V8
P_LPD ± 0.15; 08 §7 IGF-1 (0.52 ± 0.1 at 72 h water fast; 5-d refeed 0.36 → 0.68 ± 0.1); 20 §4B.3 monthly-72-h-fast IGF-1
recovery ≥ 95 % after 25 d; baseline contract (exactly 1 at t = 0; habitual-exerciser week steady within 0.2 %).

### 1.12 `appetite` — Hunger Pressure Index, effort, adherence (12 §4.9-4.12; 10 §4.3; 15; 16 §4.5; 21)

Orchestrator ruling: **intake is authoritative**; this module produces outputs only (`hungerIdx`, `dietFatigue`,
`adherence`), never changes intake. 12 §4.10c's free-living intake model is future work (not implemented).
State: `wRef`, `sEx` (τ 28 d), `fatigue F`, `kAd`, `eS`, cumulative hazard / `P_surv`, meal-pattern memory, luteal ring
(cycle length), 7-day expenditure window. Reads `tdeeEstKcalD`, `tissueMassKg` (h), `leptinSuffFM`, `leptinSuff0`,
`exEEKcalH` (h), `sleepDebtFastH`, `bhbMmolL` (h), `fibreEffG`, `lutealWeight`, `ketoInduction`.
Algorithm (endOfDay, 12 §4.9 verbatim except rulings and the decisions marked ▸):
1. Drive `D = EI_hab + D_WL·Λ_lean + D_ex + D_sleep + D_fat + D_meal + D_luteal` with `EI_hab = TDEE0`; `D_WL = 95·W_c·(1 −
   e^{−ΔW/W_c})`, W_c = 0.08·W0 (gain: `−min(500, 47.5·(W − W_ref))`), ΔW = W_ref − W with ▸ **W = daily mean tissue mass**
   (`tissueMassKg` = FM + FFM_act) and W_ref (τ 3650 d; D) — glycogen water, gut contents and sodium water are not weight
   lost for appetite (with the 7-d scale mean the days after a 72-h fast read HPI 14.2/12.1/10.0 instead of 13.1/10.7/9.8,
   and a 25-g VLC diet read hungrier through its glycogen water: 90-d HPI 5.5 instead of 4.4); `Λ_lean` from leptin sufficiency
   `[1 + 1.5·(1 − S_L(L_FM))]/[1 + 1.5·(1 − S_L(L0))]`; **`D_ex` = 10 §4.3's appetite compensation `100·(1 − e^{−S_ex/150}) −
   100·(1 − e^{−ExEE0/150})`**, S_ex = net exercise EE filtered τ 28 d [14, 42] (10 `tauAp` 28 d; ruling R-COMP: 10 owns
   both halves of exercise compensation; 12's 150/120 form = rejected alternative in note); **`D_sleep = 100·(min(4, dF) −
   min(4, dF_hab))`** (ruling R-SLEEP: 16's fast debt, 7-h reference; ▸ relative to the habitual debt latched at t = 0);
   `D_fat = 150·F` (F builds τ 45 d when u < −0.05, recovers τ 7 d; ▸ u = EI_d/T̄ − 1 as in §1.11, so training days of a
   habitual exerciser at flat intake build no fatigue); `D_meal` per 12; **`D_luteal = 168·(s(d) − s̄)`** (16 §4.5, V12:
   luteal − follicular intake +168 kcal/d; s = `lutealWeight`, s̄ its mean over the last cycle length L (profile, default
   28 d), so the term is mean-zero like energy's luteal RMR, review M3; 0 without cycle effects).
2. Satiety-effective intake `S = EI − 0.9·max(0, liquid − liquid_ref) + H_P + H_fib + H_ED + H_UPF` (12 §4.9.2; fibre uses
   `fibreEffG` and the viscous share; pre-meal water tip −8 % meal intake is a display note only, 15 §4.16). References =
   the habitual diet: P_ref habitual protein, fibre_ref habitual fibre, f_UPF,ref `habits.upfShare`, ▸ **ED_ref =
   `habits.habitualEnergyDensityKcalPerG`** (NaN → 15 §4.6 `ED_auto = 1.15 + 0.35·f_UPF,ref`), ▸ **liquid_ref =
   `habits.habitualLiquidKcal`** (NaN → 0: the habitual day carries no liquid energy). ▸ A day without an energy density
   (NaN, "auto from upfShare") takes `ED_ref + 0.35·(f_UPF − f_UPF,ref)` (15 §4.6 slope; before, H_ED was 0 and a UPF change
   acted only through the residual H_UPF — Hall 2019's +508 kcal/d is ≈ 50 % ED, 50 % residual).
3. `E_raw = SatDef(EI_hab − S) + …`, `E_s` (τ 1 d), `K_ad` (BHB ≥ 0.3: τ 10 d up / 3 d down), `E_k = E_s·(1 − 0.9·K·K_ad)`
   if positive; keto-induction symptoms add `+ 100·ketoInduction` kcal-eq (13 §4.10 appetite hook, grade D);
   `HPI = 100/(1 + e^{−(E_k − 800)/300})` → `hungerIdx` (HPI(0) = 6.50).
4. Adherence (12 §4.10a): `h = 0.0005·((HPI − 20)/40)²` for HPI > 20; `P_surv = exp(−Σh)` over recorded days; 21 §4G G10
   behavioural levers from `ctx.schedule.adherence` (self-monitoring 0.10, meal replacement 0.05, pre-meal water 0.03,
   flexible restraint 0.03; undefined = none) shift the hazard only: `h × (1 − min(0.15, ΣΔp))` (orchestrator ruling
   "behavioural levers map to an adherence shift only"). Record `adherence = 100·P_surv`. Planner uses P_surv as a
   multiplier on outcome scores (12 §4.10a; 18 §4.12).
5. Baseline and habitual week (§3.4 contract): `endBurnIn` latches ExEE0 (mean net exercise EE of the last 7 burn-in days),
   W_ref = tissue mass at t = 0 plus the habitual day's (daily mean − end-of-day) offset, dF_hab, and the expenditure
   window (shifted to the burn-in week's mean intake, §1.11); clears E_s and F; HPI = HPI(0) exactly and P_surv = 1 at
   t = 0. At habitual maintenance every drive term is 0 (full loop: sedentary/cardio habits within 0.05 HPI over 90 d;
   RT habits −0.5 HPI from composition's +0.5 kg tissue gain, O-12).
Decisions and known misses (2026-09-30): (d) **Λ_lean too weak for lean users** — 12's reference implementation gives the
lean man of Appendix A (scenario I) 62/81/94/98 at weeks 4-16, the §4.9 equations 37/55/77/91; c = 1.5, L50 and the Hill
exponent are fixed (no registry range; L50 is fitted to testosterone case reports, 12 §10.5), so it stays a known miss
(contest-leanness anchor HPI ≥ 95 is met). (e) **ADF vs CR attrition** — the 1-d effort filter with SatDef's linear
surplus side makes feast days read HPI ≈ 6 and fast days ≈ 50, so ADF 25/125 % gives 18 % vs CR 75 % 28 % dropout at
12 mo (target 38 vs 29 %); SatDef max/scale, the effort τ and the hazard constants are fixed without ranges: known miss.
(f) **Fasts — 07 §4.10 fasting-hunger time course (R-FASTHUNGER, orchestrator ruling 2026-09-30; adopted unchanged by
20 §4.4).** The acute-deficit drive `SatDef(EI_hab − S)` of a zero-intake span is multiplied by the day's mean
`ψ(τ) = 1` for `x ≤ 1`, else `x·e^(1−x)`, `x = (τ − τ0)/τw`, τ = hours since the last intake > 50 kcal (`hoursSinceIntakeH`),
`fastHungerOnsetH` τ0 12 h (fixed) and `fastHungerWidthH` τw 18 h [12, 36] (PROPOSED, grade C; range from 20's "hunger
peaks late day 1 – day 2"): 07's normalised Hfast shape beyond its 30-h peak (≈ 1/3 at 72 h, ≈ 0 by day 5). Days with
food every < 30 h are unchanged (ψ = 1), so 24-h and 36-h fasts keep the 12 App. A acute-deficit behaviour ("fast-day
hunger does not habituate"). Full loop, lean man: 72-h fast HPI 65/76/54 on days 1-3, 7-d fast 65/76/54/29/18/14/12
(peak day 2, falling after day 2-3 as 20 §4.10 item 5 and 12's ketosis/ghrelin evidence require); refeeding at
maintenance returns to ≈ 10-20 within 3 d (the tail is D_WL of the tissue lost), a graded refeed reads 40-45 on its
reduced-intake days (SatDef of the refeed intake). Adherence after a 72-h fast 99.8 %.
Validation: 12 Appendix A regression values (maintenance HPI ≈ 6; 25 % deficit week 1 ≈ 40-50; contest leanness ≥ 95), 12 §7
intake-effort targets (Polidori ≈ 100 kcal/d per kg lost), attrition calibration of P_surv (ADF 38 % vs CR 29 % at 12 mo;
known miss), baseline contract (HPI exactly HPI(0) at t = 0; habitual-exerciser week within 0.05).

### 1.13 `cellular` — autophagy signal, mTORC1, AMPK (08)

Grade C/D relative indices with the mandatory caveat (08 §4.10, W-U05); never traded against grade A/B goals (08 §4.15).
Hourly (stepHour, after muscle):
1. Clock `hFast` = `hoursSinceMealH` (08 reset rule; intake module owns it).
2. Suppression: `S_aa` from the leucine proxy `dL` built from `raAaQGH` (fold above post-absorptive; 03 owns the curve):
   `dL = raAaQGH/(k_aa·FFM)` with `k_aa` = 0.10 g/kg FFM/h (`cellular.aaRefKgFfmH`, PROPOSED FIT; the earlier ratio to the
   post-absorptive value divided by ≈ 0 because A_lag → 0 after absorption — CONTRACT_REQUESTS, cellular);
   `S_aa = dL^1.5/(dL^1.5 + 0.5^1.5)`; `S_ins = dI^1.5/(dI^1.5 + EC50_I^1.5)`, `dI = max(0, insulinUuMl − insulinBasalUuMl)`
   (intake's basal insulin of this hour: Ins_f × the 05 liver-glycogen factor, no meal excursions; the last finite value is
   kept if the signal is not finite); `S = 1 − (1 − 0.6·S_aa)(1 − 0.75·S_ins)` (w_ins 0.75 = midpoint of 0.6-0.9).
   Ruling R-EC50 (INTEGRATION item 9): EC50_I stays 5 µU/mL [3, 15] and is calibrated with B0 against the ASI anchor
   table; 08's "94 % at +10 µU/mL" data point implies ≈ 1.6 (outside its own range) and is recorded as a known inconsistency.
3. Depth: `F = 0.6·F_clock + 0.2·F_glyc + 0.2·F_ket`, `F_clock = hFast^nh/(hFast^nh + h50^nh)` (nh 2 [1.5, 3]; h50 **60 h**
   [24, 96] log-uniform — 08's 48 h moved inside 08's own anchor-adjustment window 36-60 h to hit the anchor table; 56 h
   until the fuel/ketone recalibration of 2026-09-30, after which the 36-h anchor needed 60 h, all nine anchors within
   ±4.4 points), `F_glyc = clamp01(1 − G_L/G_L,12h)`, `F_ket = bhbEndo²/(bhbEndo² + 1.5²)` (endogenous BHB only:
   no compound raises the ASI).
4. `ASI = clamp(100(1 − S)(B0 + (1 − B0)F) + A_ex·min(1.5, xEx) + asi_CR, 0, 100)`, `B0 = (0.25 − F12)/(1 − F12)` with
   F12 = 0.6·F_clock(12 h) + 0.2·F_ket(BHB_12h) (08 §4.10 step 4; F_glyc(12 h) = 0 by definition; recomputed per parameter
   draw); `xEx` pulse from exercise with the intensity ramp 0.40-0.80 VO2max, duration factor min(1.5, √(min/60)), training
   damping (τ 3 h, A_ex 15); resistance 0.5·min(1, sets/15).
5. `mtorIdx` (08 §4.11) with `reSens` = `mpsStimWb`; `ampkIdx` (08 §4.6) with `dGly` from `muscleGlycogenRel` and the
   fasting damping `f_fast` **0.3** (08's 0.2 re-fitted inside [0, 0.4] so that AMPK at 48 h stays ≤ its 12-h value, 08 V1/V3/V4,
   once the full engine's fasting glycogen fall enters through `dGly`; Wojtaszewski's exercise rows unchanged). Both are
   display-only and skipped when neither series is recorded (planner mode); `asiIdx` is always written.
Daily: chronic-deficit EMA cDef (τ 7 d) toward `1 − energyKcal/maintenanceKcalD` → `asi_CR = 3·min(1, cDef/0.25)` (08 §4.9).
**Baseline (§3.4):** the person's 12-h post-absorptive references G_L,12h and BHB_12h are sampled on the last habitual
burn-in week where hFast crosses 12 h; a habitual overnight fast that a meal ends before 12 h (≥ 6 h; e.g. 3 meals
08:00-20:00 reach 11 h) is extrapolated to 12 h with the last hour's trend (G_L falling, BHB rising). `endBurnIn` latches
their means (priors 0.75·G_L(init), 0.1 mM when nothing was sampled) and calibrates B0 on them; a harness without
`endBurnIn` latches on day 0. Reads: `raAaQGH`, `insulinUuMl`, `insulinBasalUuMl`, `hoursSinceMealH`, `liverGlycogenG`,
`muscleGlycogenRel`, `bhbEndoMmolL`, `exIntensityFrac`, `exMinutesH`, `mpsStimWb`, `maintenanceKcalD`, `energyBalanceFrac`,
`ffmActKg` (not `absFluxKcalH` / `fedState`: hFast carries the clock).
Records: `autophagyIdx`, `mtorIdx`, `ampkIdx` (hourly; daily mean). Validation: 08 §4.10 anchor table within ±5 points
(12, 16, 24, 36, 48, 72, 96, 120, 168 h), illustrative daily-pattern table within ±5 points once 03/04 are wired, 08 §7.
Full-engine status (finisher 2026-09-30, h50 60 h, `cellular/fullLoop.test.ts`): anchors 22.0/29.1/38.0/53.4/63.6/78.1/85.7/
90.2/95.0 at 12/16/24/36/48/72/96/120/168 h (all within ±4.4 of the ±5 band; 12 h sits below 25 because intake's meal insulin is still +1.6 µU/mL above basal 12 h after dinner); daily
peaks within ±5; daily means ≈ 7/10/11.5/15/17 for 3 meals/16:8/18:6/20:4/one meal vs 15/16/18/19/24 (known miss: intake's
insulin excursion stays +30…+100 µU/mL above basal 4 h after a meal, where 08 §4.4 assumes a return to basal by 2.5-4 h).

### 1.14 `cardiometabolic` — insulin sensitivity, carbohydrate tolerance, lipids, BP, liver fat, glycaemia, CRP, urate

**Insulin sensitivity in fasts (R-SIFAST, orchestrator ruling 2026-09-30).** Fasting and very-low-carbohydrate eating
cause a short-lived insulin resistance (post-fast glucose intolerance 1-3 d, 20 §4.10 table; 04 §4.19). It is carried
**only** by carbohydrate tolerance `T_C` (`carbTolerance`, fast/slow states, recovers within days once carbohydrate is
eaten) — it is **not** added to `S_hep`/`S_mus` or to the `insulinSensitivity` metric, which describes the chronic,
fat-mass-, liver-fat-, fitness- and activity-driven sensitivity (the catalogue's `description` says so).
Owners: 04 §4.18 (S_hep, S_mus), 04 §4.19 + 13 §4.8 (T_C), 06 §4.1-4.16 (markers), 06 §4.13 + 20 §4.7 (urate).
Presentation (orchestrator ruling): every blood marker is output as **change from the user's baseline**
(`presentation: 'deltaFromBaseline'`), absolute values only when the user entered labs (`profile.labs`) — the NHANES
generators (06 §2.3) set internal baselines otherwise and are never displayed as the user's values.
Algorithm (endOfDay; each mechanism its own state and τ, summed — 06 §4.1):
1. S_hep*, S_mus* per 04 §4.18 factor table: F_LF (liver fat), F_EBh (3-day EB; **neutral on zero-intake days** — a fast
   does not improve and transiently lowers insulin sensitivity, 20 §4.7 [69, 23]; the ring keeps the day's balance so ADF and
   daily CR at the same mean deficit get the same credit on eating days), F_adip, F_steps (7-d), F_fit (VO2max),
   F_exAcute = 1 + 0.25·E_is (04's absolute form; E_is from the real sessions, burn-in week included), **F_sleep :=
   siSleepMult** (16 replaces 04's F_sleep, ruling R-SLEEP), F_SFA (τ 21 d; **only while total fat < 37 %E**, 04 §4.18 [101]
   — a 70-80 %E-fat ketogenic diet is not penalised for its SFA %E, 04 §8 myth 10), F_sugar (τ 7 d); τ_hep 2 d, τ_mus 3 d.
   `insulinSensitivity = S_hep^0.4·S_mus^0.6`; `insulinResistanceIdx = clamp(1 − S_I, 0, 1)` (for 02 m_IR and 05).
   Glycogen-depletion alternative to F_exAcute is not used (04 says one only). The fasting fall of glucose tolerance
   ("starvation diabetes", 20 §4.7) is carried by T_C, not by S_I.
2. **T_C (ruling R-TC):** 04 §4.19 structure `T_C* = clamp((CI_3d − 50)/100, 0, 1)`, `T_C = 0.6·T_fast + 0.4·T_slow`,
   τ_fast 2.5 d, **τ_slow 28 d [10, 42]** (13 §4.8 Jansen change point ≈ 5 wk; 04's 14 d = low). 13 §4.8's separate
   A_f/A_s tolerance states are not implemented (same phenomenon); the OGTT-readiness flag uses `1 − T_C > 0.1`.
3. Lipids (06 §4.2-4.7): LDL = Mensink SFA/MUFA/PUFA/trans deltas vs habitual (scaled by `1 + 0.35·(LDL0 − 112)/40`,
   clipped 0.7-1.4) + dietary cholesterol (Keys square-root law) + LEM term for lean users on carbohydrate restriction (grade
   C/D; on by default, labelled; ketosis state s_keto rises from 0 to 1 as the 24-h mean BHB goes from 0.2 to 0.5 mmol/L —
   06 §4.3's spot-BHB bounds ≈ 0.5 / ≥ 1.5 mM restated on the engine's 24-h mean with 05 §6's light/nutritional-ketosis
   bounds, finisher 2026-09-30) + portfolio (viscous fibre, sterols, nuts, soy) + weight −0.6 mg/dL/kg; τ 7 d
   (composition), 10 d (LEM, portfolio). ApoB `= 0.587·ΔnonHDL`. HDL, TG (per mechanism τ 4/14/30-45/21 d), per 06 master
   table (§4.16). n-6:n-3 ratio not modelled.
4. BP (06 §4.8): sodium 2.4/1.0 mmHg per g, DASH, potassium, weight 1.05/0.92 per kg, alcohol, exercise; τ 4-30 d by
   component. Sauna −4 mmHg (21, PROPOSED half of RCT) only as a lever when present.
5. Liver fat (06 §4.9, 11 §4.9): ln-scale mechanism states, %WL −0.075 ln/%, ketosis −0.40 ln, overfeeding by type (11 k_liver
   table: mixed 15, SFA 28, unsat 15, n-6 PUFA 0, sugars 18), exercise −0.25 ln; τ 12 d down / 21 d up. The overfeeding
   state D grows with `max(0, d(BW%)/dt)` of the 7-day fat-mass trend (window n = day + 1 in the first week) on surplus days
   (weighted by the smooth surplus indicator of `energyBalance7KcalD`), so day-to-day swings of a weekly training pattern
   cannot ratchet it up at maintenance; τ_D 120 d. `liverFatPct`.
6. Glycaemic (06 §4.11, 04 §4.16): fasting glucose (τ 5 d acute, 30 d weight) + the fasting-state term of intake's
   post-absorptive glucose (hours with tPA ≥ 8 h; divided by intake's S_hep^(−0.1) factor and compared with the habitual
   week's value; 0 on days without post-absorptive hours), HbA1c τ 50 d (eAG = 28.7·A1c − 46.7).
7. hs-CRP (06 §4.12): adiposity threshold rule, exercise, n-3; τ 30-60 d. Urate (06 §4.13): +0.6 mg/dL per mM BHB (τ 5-7 d),
   fructose/SSB, alcohol, weight −0.06/kg; 20 §4.7 fasting ×2.2 at day 21 is a validation target, not an extra term.
8. Individual variability: persistent z-draws with 06 §4.17's correlation matrix are applied **only** in ensemble mode (§8);
   the nominal run uses z = 0.
Weight terms use kg lost = −ΔTM, the change in tissue mass (`tissueMassKg` = fat + lean tissue, i.e. body weight
without glycogen, its water, ECF shifts and gut contents; contract request 2026-09-30 — the former −ΔFM/0.75 with the
retired `weight.fatShare` over-counted weight loss in obese dieters and counted resistance-training recomposition as loss). Exercise doses (aerobic min/wk at ≥ 40 %
VO2max, MET·h/wk, resistance sets/wk) are counted from `HourInput`; the aerobic classification uses the VO2max latched at
t = 0, so a later VO2max change does not flip habitual sessions in or out of the dose.
**Baseline (§3.4):** the burn-in is the habitual week with its sessions, so the absolute states (S_hep, S_mus, T_C, lagged
factors) reach the habitual steady state and the 7-day dose rings hold the habitual week. `endBurnIn` latches the habitual
weekly doses from the rings (profile priors if fewer than 7 burn-in days), fat mass after composition's reset, the habitual
week's mean BHB / ketosis state and normalised post-absorptive glucose, and zeroes every mechanism delta: at t = 0 every
marker equals its baseline exactly, and repeating the habitual week keeps weekly means flat (habitual exercisers included).
Inputs: `DayInput.cholesterolMg` (undefined/NaN = habitual, no effect), `dashFraction` (0..1; undefined/NaN = from
`foodQuality`), `saunaSessionsPerWeek` (undefined/NaN/≤ 0 = none). `habits.smoker` is not read (06 has no smoking term for a
modelled marker). Reads: `glucoseMmolL`, `insulinUuMl`, `carbAbs24G`, `hoursPostAbsorptiveH`, `fatMassKg`, `tissueMassKg`,
`energyBalanceFrac`, `energyBalance7KcalD`, `siSleepMult`, `vo2maxMlKgMin`, `bhbMmolL`.
Planner mode: lipids, BP, glycaemia, hs-CRP and urate are skipped when none of their series is recorded; S_hep, S_mus, T_C,
the IR index and liver fat are always computed.
Records: `insulinSensitivity`, `ldl`, `apoB`, `hdl`, `triglycerides`, `sbp`, `liverFat`, `fastingGlucose`, `crp`,
detail `uricAcid`. Writes `sHep`, `sMus`, `carbTolerance`, `insulinResistanceIdx`, `liverFatPct`.
Validation: 06 §7 targets (Mensink/Clarke coefficient checks; Hall 2016 KD LDL; DASH-sodium BP; weight-loss liver fat −40 %
at 7 % loss ± 15 points; Retterstøl heavy tail inside the ensemble band), 04 §7 insulin-sensitivity targets (48-h −1000 kcal
hepatic +; 4-h night −25 %; step reduction −17 %), 13 §4.8 Jansen OGTT recovery slope; full-engine baseline contract and
intervention directions in `cardiometabolic/fullLoop.test.ts`.

### 1.15 `wellbeing` — energy availability, bone, performance multipliers, mood tier, symptoms (19, 13, 15)

**Ruling R-EA (energy-availability convention):** `EA = (EI − EEE)/FFM` with **EEE = session exercise energy net of
resting expenditure** (the day's Σ `exSessionNetKcalH`, available as activity's daily `exSessionNetKcalD` — review m10;
EPOC, post-RT REE and step energy excluded), FFM = `ffmActKg`.
This is 17 §2.1's definition (Loucks) and the one behind the 30 and 45 kcal/kg FFM thresholds; 10's gross-MET accounting
is used for TDEE only. Both 17 (HC-E4) and 19 read this single `ea7KcalKgFfm`.
Algorithm (endOfDay): `EA`, `EA_s` (EWMA τ 3 d) → `eaKcalKgFfm`, `EA_7` (trailing mean) → `ea7KcalKgFfm`, `EA_c` (14-d mean);
bone turnover P1NP/CTX (19 §4.2, τ_b 2 d) and BMD (hip `−k_h·mAge·mRT·mCa·mSrc·WL%`, k_h 0.20 [0.10, 0.30]; 15 §4.14's
"k_h basis" slip resolved by using this register value; τ 120 d loss / 240 d recovery) → `hipBmdChange`; strength/power
chronic multiplier `M_EA = 1 − a·clip((30 − EA_c)/15, 0, 1.3)·g_lean` (τ 28 d on / 75 d off) → `strengthEaMult` (read
by muscle next day); endurance capacity (19 §4.4: Bergström TTE from muscle glycogen, economy penalty `0.065·A_f·gI`
from `ketoAdaptFast`, VO2max and mass effect) → `enduranceCapacity` (% of baseline); keto-induction **13 §4.10 Φ_ind only**
(ruling R-KETOFLU; 19's KI curve and 05 §4.13's keto-flu index are not implemented): `Φ = Φ_max·(Δt/2.5)·e^{1 − Δt/2.5}`,
Φ_max = relative carbohydrate drop × (1 − 0.3·[Na ≥ 2 g/d]), heavy-tail τ 6 d in 25 % of ensemble draws →
`ketoInduction`; mood tier (19 §4.5 points: EA_c bands, 14-d loss rate, Φ ≥ 0.3, sleep debt > 1 h, very lean) →
`moodTier` 0 green / 1 amber / 2 red (never a cognition score); micronutrient completeness (15 §4.9 rule-based density
projection by food quality, multivitamin, energy intake; grade D) → `micronutrientScore`.
Records: `energyAvailability`, `hipBmdChange`, `enduranceCapacity`, `moodTier`, `ketoInduction`, `micronutrientScore`.
Baselines (integration 2026-09-30, `endBurnIn`): EEE is read once per day from `exSessionNetKcalD`; the baselines of the
baseline-relative indices (P1NP/CTX, glycogen concentration of the endurance index, the M_EA penalty) are the means over the
last 7 burn-in days (the habitual week, sessions included), and the weight/fat references are re-latched after composition
and water re-anchor the body, so a habitual exerciser's week averages to 100 % / 1.0.
Validation: 19 §7 V1 (TTE ± 10 min), V3 (A_econ), V5-V6 (BMD ± 0.7/±1 pp), V7 (P1NP 0.83 ± 0.05), V9-V10 (M_EA), V11-V12
(qualitative tier), 13 §4.10 median induction resolution 4.5 d.

### 1.16 `safety` — derived quantities, warnings, constraint margins (17)

Reads everything it needs from the bus at `endOfDay` and fills `SafetyTrace` (types/result.ts, 17 §2.1): `ei7`, `tdee7`,
`deficitPct7 = 100·(1 − EI_7/TDEE_7)`, `ea7`, `tissueMassKg` (TM), `rate14KgPerWk` / `rate14PctPerWk` (−OLS slope of TM over
the trailing 14 d), `cumLossPct`, `bmi`, `bodyFatPct` (integration 2026-09-30, ruling 18:10: `ei7`/`tdee7`/`deficitPct7` and
the 7-day protein and fat shares use the non-fast days of the window and are NaN on fast-event days; near a fast `ei7` is
min(non-fast EI_7, EI_28) and the rate is the 28-day TM slope — §7.2 "Fast-event days"; `bmi`/`bodyFatPct` use TM, the
projected values of 17), `fastHMax` (longest ≤ 50 kcal run ending that day), `fastH7`,
`proteinGPerKgRw` (RW = min(BW, 27.5·H²)), `fatPctEnergy`, `hungerIdx`, and (finisher 2026-09-30, additive, optional in the
type) `eee7` (trailing 7-d session EEE — the exercise gate of the EA rules), `fastDay` (1 on fast-event days) and `ei28`
(trailing 28-d mean intake); final round: `fastH7Cap` (R-T4CAP: T1-T3 fasting hours only) and `deficitPct28` (28-day
balance over all days). BW (cumulative loss, reference weight) is the day's **weigh-in** scale weight (R-MORNING), the
value the user sees. Evaluates the warning rules of §7.2 per day into
a preallocated `Uint8Array[nRules × nDays]` hit matrix plus peak values; `finalize` merges runs into `SimWarning`s with the
17 §3 message templates (≤ 200 characters incl. placeholders). **W-F04 replaces 17's text verbatim with** (20-corrected,
176 characters): "Water fasts of 3–7 days are studied under medical supervision: about 20% of stays had a grade ≥3
adverse event by day 5; serious events were rare (2 of 768). Not to be attempted alone." (17 §3 still says "serious events
~20%"; that wording is wrong — review m2). Planner mode: evaluates `RunOptions.abortOn` bounds on daily values
and sets `safetyAbort` (loop stops at the end of that day). Constraint margins for HC-* are computed by the planner domain
layer from `SafetyTrace` (§10), not inside the engine loop. Engine-specific rule `W-01-FATFLOOR` (danger) fires on every
day with `fatFloorActive` > 0 (composition's smooth fat floor engaged, R-FATFLOOR): "Your modelled fat mass is near the
minimum the body can lose; further losses would come from muscle and organs. Stop the plan and seek medical advice."
Validation: 17 §7 golden tests (each HC/W rule fires on its canonical trajectory and not on its neighbour; message-length CI
check; 20 copy correction present).

---

## 2. Phenomenon ownership and rulings

### 2.1 Ownership map (one owner per phenomenon)

| Phenomenon | Owner module (dossier §) | Explicitly **not** implemented elsewhere |
|---|---|---|
| Initial body composition, regional depots, circumferences, avatar | `body/` (14 M1-M12) | 01 initial-state heuristics |
| RMR, TEF, NEAT, adaptive thermogenesis, protein-turnover EE, caffeine EE, TH_C | energy (02; 11 §4.5 TH_C; 15 §4.11) | Hall 2010 T/λ (01 §4.1.4), 11 β_OF, 11 k_P, 02 C_comp |
| Exercise EE, EPOC, step energy, VO2max, exercise compensation (both halves) | activity (10; 09 §4.13) + energy (c_met) + appetite (D_ex) | 02 constrained-TEE term, 12 D_ex coefficients |
| Absorption, glucose & insulin curves, fed/fasted clocks, alcohol, caffeine PK, creatine kinetics, fibre ME | intake (04 §4.16-4.17, 03 §4.7A, 07 §4.1-4.2, 15, 08 §4.10 clock) | 05 FALLBACK insulin/absorption, 21 CrLoad ODE, 03 insulin proxy |
| Zero-intake regime (fasting RMR multiplier, protein-N loss, labile pool, repletion, oedema) | fasting (20 §4.0-4.12, §4B) | 02 AT_R during fasts, 03 §4.13 / 07 N-loss for water-only fasts, 20 E_fast, Hall T |
| Glycogen, CHO/fat/protein oxidation, DNL, GNG, RQ | fuel (04 §4.1-4.13, §4.22) | Hall 2010 flux ODEs (01 §4.1.10), 11 §4.2-4.4 hierarchy, 05 fallback glycogen |
| FFA, ketones, keto-adaptation (A_f, A_s), brain ketone share, urinary ketone loss | ketones (05; 20 §4.3.4 target) | 07 §4.4.1 BHB values, 13 §4.9 F_ad, 20 urinary-ketone constant, 20 brain-share formula |
| Fat mass, lean tissue, partition (deficit/surplus/fasting), overshoot, age lean drift, VAT/waist update | composition (01, 03 §4.4/4.13/4.14/4.19, 11 §4.7/4.12, 14 M6-M8) | 01 p = C/(C+F) default, 11 h(EB)·L_RT, 03 RT credit |
| RT stimulus, accretion, retention, detraining, memory, strength, MPS display layer | muscle (09; 03 §4.2/4.7/4.8/4.14 as factors) | 03 M_RT, credit, AR_age; 16 hypertrophy age multipliers; 11 L_RT |
| Scale weight, labile water, DXA-equivalent lean | water (13 §4.1-4.6, 15 §4.7-4.8/4.12, 04 §4.1, 20 §4.5, 16 §4.5) | 15 L_ket and W_gut,fibre, 20 E_fast, 01 Hall ECF equation |
| Leptin, ghrelin, T3, cortisol, testosterone, GH, IGF-1, menstrual risk | hormones (12 §4.1-4.7, 08 §4.12, 19 §4.9) | 12 §4.7 IGF-1, 13 §4.11 leptin/T3 forms, 16 leptin sex multiplier, 12 §4.6 R_MD |
| Hunger, effort, adherence, diet fatigue | appetite (12 §4.9-4.12; 10 §4.3 appetite part; 21 behavioural levers) | ad-lib intake drift (future), 15/21 pre-meal water as intake change |
| Autophagy / mTOR / AMPK indices | cellular (08 §4.3-4.11) | any compound effect on ASI |
| Insulin sensitivity, carbohydrate tolerance, lipids, BP, liver fat, glycaemic markers, CRP, urate | cardiometabolic (04 §4.18-4.19, 06, 13 §4.8, 11 §4.9) | 13 §4.8 A_f/A_s tolerance states |
| Sleep debt & multipliers, stress, cycle, menopause drift, age | moderators (16) | 04 F_sleep, 12 F_sleep/D_sleep raw forms, 16 V7 ageRmrMult, 16 ketoneProdMult |
| EA, bone, performance multipliers, endurance, mood tier, keto-induction, micronutrients | wellbeing (19, 13 §4.10, 15 §4.9) | 19 KI curve, 05 keto-flu index |
| Safety quantities, warnings, constraint margins | safety (17) + planner domain layer (§10) | dossier §9 thresholds that disagree with 17 (17 is authoritative) |

### 2.2 Rulings (every INTEGRATION_NOTES item and every dossier conflict table)

Format: **ID — topic.** Decision (number; alternative as registry low/high only when it is a plausible value of the same
quantity, else in the ParamDef `note` — R-ALT). *Reason.* Rulings added or changed by the independent review
(2026-09-30, `docs/MODEL_SPEC_REVIEW.md`, orchestrator decisions in `docs/MODEL_SPEC_DECISIONS.md`) are marked **[rev]**.

**Architecture**
- **R-ARCH — Hall 2010 vs modular fluxes.** Modular Hall-type engine; Hall 2010/2011 are oracles, not code. *Each flux
  has a better-specified owner dossier; the oracles guard the integrated behaviour.*
- **R-ORACLE — ±5 % rule and BWP.** Oracle A: for macronutrient-neutral, no-RT scenarios the engine's weight is within
  ±1.5 kg of Hall 2011 BWP (01 §4.12 reference implementation) at 6 months and ±3 kg at plateau (01 §7.11); negative
  control: BWP must *not* reproduce Longland PRO vs CON while the engine reproduces the direction (01 §7.12). Oracle B:
  steady-state 24-h CHO/fat oxidation and ΔG within ±5 % of 04 §4.11's daily form. *INTEGRATION "Hourly fluxes must
  integrate to Hall's daily fluxes within ±5 %".*
- **R-STEP — timestep.** 1 h, no sub-stepping; closed forms per §0.1 (overrules 01/03/04/05/07 sub-step advice).
  *Orchestrator ruling; closed forms keep the error below 2 % (tested).*
- **R-HALLEQ — Hall 2010 printed Eq. 12/37 errors.** The BWP oracle uses 01's corrected forms. *01 verified them.*
- **R-ALT — where rejected alternatives go. [rev M20]** A rejected value becomes a ParamDef `low`/`high` only when it is a
  plausible value of the same quantity (sampled in ensembles); alternatives from another convention, structure or model
  form go to `note` and are never drawn; convention constants (ρF, ηF, ρL, ηL, ρG, f_prot) are `draw: 'fixed'` (§0.4).
  *Drawing ρL = 1 000 (hydrated DXA lean) would break f_prot = 0.385 and the fasting protein energy per draw.*

**Energy**
- **R-AT — adaptive thermogenesis (INTEGRATION hazard 2; newest item 1).** 02 §4.8 only: AT* = β·(EI − EI0), β 0.14
  [0.05, 0.40] in deficit, β⁺ **0.12** [0, 0.35] in surplus (11 §4.6 β_OF value, applied through 02's ODE, 40 % resting /
  60 % NEAT, τ 7/14 d on, 14 d off, σ 0.6). Hall 2010 λ₁/T (01 §4.1.4) and 11's separate β_OF term are not implemented.
  *02's ODE is the only one fitted to both CALERIE and Martins data; 11's surplus number is its own best fit, so it
  becomes β⁺ — implementing both would double count. Leibel 1995 stays a documented known-miss; its high-adaptation
  scenario is the registry high 0.40.*
- **R-FAST-AT — AT at zero intake. [rev M6, M19]** While the fasting overlay is active (or |fastRmrMult − 1| > 0.001)
  AT_R is held and 20's `fastRmrMult` applies; energy also holds P_eff (kP term) and compKcalD; AT_N continues.
  *INTEGRATION "replaced, not added" (20 §4.0); 20's multiplier is fitted to measured REE, which already contains the
  protein-turnover fall.*
- **R-COMP — exercise compensation (10 vs 02).** Metabolic part = 10 §4.3 c_met 0.15 + 0.010·clamp(BMI − 25, −5, 8)
  [0, 0.28], τ 14 d, cap −5 % RMR, in energy; 02's constrained-TEE term (27.7 %, τ ≈ 60 d, grade C) not implemented;
  appetite part → hunger only (appetite D_ex, §1.12). *10 is the exercise owner and its number is grade B; one term.*
- **R-EA — energy availability net vs gross.** EEE = session EE net of resting (17 §2.1, Loucks); single `ea7` for 17 and
  19. *Thresholds 30/45 were derived with net EEE.*
- **R-ALC — alcohol TEF.** 0.10 [0.05, 0.22] (15 §4.10/§5.1; 02's 0.20 = inside high). *FAO NME/ME 6.3/7.0 = 10 %;
  Suter's 0.20 is a single small study.*
- **R-CAFF — caffeine EE.** 0.10 kcal/mg × (mg − 150)·(1 − 0.5·Tol) [0.05, 0.25] (15 §4.11/§5.1; 02's 0.25 = high).
  *Pooled chamber slope 0.105 kcal/mg; habitual intake already inside TDEE equations.*
- **R-FIBRE — fibre energy (hazard 5).** Label credit 2 kcal/g (02 E_fib) + 15 §4.2 dME_fibre correction + 02's fibre
  TEF 0.30 of fibre energy as the only fibre thermic term (15's +2.3 kcal/g RMR add-on off). *15 §5.1 recommendation.*
- **R-DNL — DNL cost (newest item 2: 16.5 / 20 / 24.5 / 28 %).** Stoichiometric: 3.2 g glucose per g fat (yield 0.3125
  [0.28, 0.36]) → 28 % of carbohydrate energy lost, booked by fuel as `dnlHeatKcalH`; 01's ε_d 0.835, 02's 0.2·(DNL − DNL0)
  and 11's 24.5 % are not added. *04 owns DNL; the others are approximations of the same stoichiometry; conservative
  (largest) cost at negligible DNL volumes.*
- **R-GNG — GNG cost. [rev M5]** Default **0** (`energy.gngCost` 0 [0, 0.2]); 02 §4.11's 0.2·(GNG − GNG0) is the registry
  high (sensitivity only). *It double counts protein TEF (FAO NME/ME already contains ureagenesis/GNG ATP) and 20's
  fitted fasting REE; with it, protein thermogenesis reached ≈ 51 % of protein energy and 02 V10 failed.*
- **R-HGO — surplus hepatic glucose supply. [rev M21]** `GNG = max(0, HGO − J_L,out − lactate)` capped by
  0.57·protOx + 0.10·fatOx; surplus J_L,out + lactate is oxidised (CHOox rises), never stored (§1.6 step 6). *Keeps G_L on
  04's fitted τ_L curve and 05's ketogenesis calibration intact.*
- **R-BRAY — Bray 5 %-protein REE (newest item 3).** Target ≈ 0 (02 §4.5, 03, 01 §7.7d) ± 60 kcal/d; 11's −86 kcal/d and
  its TEE "+176/+2 186/+1 898 kJ/d" are excluded as targets; the 5 % arm's lean loss stays a known-miss. *Three dossiers
  agree; 11's TEE figures are implausible.*
- **R-RMRMASS — RMR mass coefficients. [rev M20]** 02 §4.2 γ_L 22 / γ_SM 13 / γ_F 3.2 kcal/kg/d; 20's γ_P 19 / γ_F 4.5 are
  recorded in the parameters' `note` only (a different RMR form, used by no formula; not drawn). *One RMR equation; 20
  only needs the multiplier.*
- **R-TEFTIME — TEF timing.** TEF follows absorbed energy hour by hour: `TEF_h = α_day·eAbsKcalH`, α_day = the day's macro
  TEF fraction (integral = 02's daily TEF up to spill-over across midnight). *Hourly consistency without per-macro
  appearance reads (CONTRACT_REQUESTS, energy).*
- **R-AGE-RMR — 16 V7 linear ageRmrMult.** Not applied (Mifflin and Müller already contain age; 02 f_age for > 63 y is
  identical and also not applied on top). *Avoids double counting; 16 editors flagged the 0.81 vs 0.74 slip.*
- **R-LEVINE — Levine NEAT range (newest item 6).** Not a validation target (02 marks it UNVERIFIED). *Grade.*

**Fuel, glycogen, water**
- **R-FUEL — substrate oxidation.** 04 §4.10 hourly disposal rules; fat oxidation = residual. *INTEGRATION.*
- **R-GLYW — glycogen water (numeric list; newest item 4).** 3.0 g/g [2, 4] (04 §4.1 owner); 13's "4 × ΔG" = (1 + 3)·ΔG
  is the same number; 01/11's 2.7 used only inside the BWP oracle. *04 owns glycogen.*
- **R-RHOG — glycogen energy density (newest item 4).** 4.207 kcal/g (17.6 MJ/kg); 01 §4.7's "4.18" is an arithmetic slip.
- **R-GLYTAU — glycogen time constant (Hall ≈ 1 d vs calorimetry 3-5 d).** No global τ: glycogen dynamics emerge from
  04's liver/muscle compartments; validated against Jebb 5-d CHO-oxidation convergence and Schrauwen days 1-3 fat balance
  (§1.6). *11 asked 04 to calibrate; 04's compartments reproduce both scales.*
- **R-ABS — absorption owners.** CHO 04 gamma kernel; protein 03 MM; fat via 07 gastric-emptying energy flux × meal fat
  share; fed state 07 (≥ 30 kcal/h). *Each dossier owns its macro.*
- **R-INS — insulin.** 04 §4.17 curve × 05 §4.17 basal-decline factor on Ins_f. *04 has no fasting decline; 05's
  factor reproduces Klein 1993 −50 % by 72 h.*
- **R-CIRC — circadian glucose multiplier.** 04's M_circ 1.0/1.15 replaced by 07 §4.7 mClock when 07's clock is wired
  (same owner of timing: 07). *Avoid two circadian terms.*
- **R-HFAST — hours-since-meal clock.** 08 §4.10 reset rule (protein ≥ 10 g or net CHO ≥ 15 g), owned by intake;
  used by cellular, hormones (IGF-1), muscle. `fast_h` (17: > 50 kcal) is separate. *Different questions, both needed.*
- **R-WATER — water terms (hazard 4).** One implementation each (§1.10): E_cna (13, A_nat = 0), S_na (13 + h_Na 0.5,
  τ_Na 1.5 d → κ_eff 0.0054 kg per mmol/d; resolves 15's κ 0.006 vs 0.0054), M_gut (13), oedema (20), cycle (16),
  creatine (15). *15 §5.1 merge recommendation.*
- **R-TURNOVER — 15 §8.16 vs §4.8 water-turnover means.** 15 §4.8 equation is used; the prose range is not a target.

**Composition and muscle**
- **R-RHO — lean-tissue energy density (numeric list; newest item 4).** Hall convention ρL 1 816 kcal/kg (incl. 1.6 g
  water/g protein), η_L 229; 03's 1 000 is recorded in `note` only (it is the hydrated-DXA-lean convention, not an uncertainty of
  Hall's; ρF, ηF, ρL, ηL, ρG and f_prot are `draw: 'fixed'`, review M20). ρF 9 441 (03's 9 400 inside
  rounding), η_F 179. *01, 02, 11 and the BWP oracle use Hall's constants; lean is booked as protein tissue (R-FPROT).*
- **R-FPROT — protein content.** f_prot = 1/(1 + h_P) = 0.385 (h_P 1.6 per 20 §4.6.2); 03's c_P 0.206 applies to DXA lean.
- **R-PART — partition.** Deficit 03 `leanFractionOfLoss` (RT-stripped) → energy share; surplus 11 r_L (with (1 − s_RT));
  fasting 20; non-fasting very-low intake 03 §4.13. *One owner per regime (§1.8).*
- **R-PART-HOUR — regime selection. [rev M7]** The composition branch is chosen **per hour** (fasting branch iff
  `fastActive` this hour, else the fraction branch with the day's p_E); a planned FastEvent activates the fasting overlay
  only for spans ≥ 24 h — shorter planned fasts use the 24-h intake criteria. *A per-day switch booked no lean change after
  a mid-day refeed, and a 16-h FastEvent got 20's peak N loss while the same 16:8 window via meals did not (exploitable
  by the planner).*
- **R-FATFLOOR — fat-mass floor. [rev M9]** No hard clamp: when S′ < 0 the fat share is scaled by
  `clamp((FM − 0.02·BW0)/1 kg, 0, 1)` and the remainder is taken from lean tissue at ρL + ηL; composition writes
  `fatFloorActive`, safety raises `W-01-FATFLOOR`. *A 0.5-kg clamp dropped energy (O-4 failed) and stalled scale weight in
  lean users' long fasts (8 % BF man reaches it near day 28, inside O-6).*
- **R-LT0 — absolute lean tissue. [rev m6]** `LT0 = FFM0 − (1 + h)·G0/1000` (`core/resolveProfile.leanTissue0Kg`).
  *`leanTissue` is shown in absolute kg; LT excludes glycogen and its water by the Hall convention.*
- **R-BURNIN — maintenance closure. [rev B3]** Burn-in = the habitual week (sessions included, `core/compileSchedule.
  habitualWeek`) cycled for `burnInDays` (default 14); energy calibrates NEAT0 over the last min(7, burnInDays) burn-in days
  so mean model TEE = EI_hab; composition resets FM/LT/SM and water re-anchors its references in `endBurnIn`; invariant
  O-12. *TDEE0's analytic EAT0 misses post-RT REE, EPOC and the "net of own RMR" session cost (−1.8 to −3.6 kg/yr for a
  3×/wk lifter "at maintenance"), and burn-in drift was hidden by water offsets.*
- **R-EXCARB — carbohydrate eaten during exercise. [rev M8]** The compiler adds it to the day's carbohydrate and energy
  totals (`DayInput.exerciseCarbG`, note `carbsDuringExerciseAdded`; dropped inside planned fasts); intake absorbs
  `HourInput.exCarbG` as glucose (t_p 0.5 h); fuel reads only `raGlcGH`. *480 kcal of a 2-h ride at 60 g/h were missing
  from the energy ledger.*
- **R-NPSHARE — carbohydrate share of non-protein energy. [rev m8]** `MacroSpec.carbShareNonProtein` (0..1) resolves carbs
  and fat from E − 4·P − 2·fibre − 7·alcohol (18 §4.4.2's `carbShareNonProtein`). *The reviewer's `pctNonProteinEnergy`
  unit, expressed as an additive field so existing consumers of `MacroAmount` (UI) stay valid.*
- **R-RT — training effect on lean (hazard 1).** 09 only (A_r, R_RT, D_r); 03 E_dist on A_r only; 09 f_age. **Revised
  2026-09-30 (WP-M8):** protein inside A_r is 09's f_P per kg body mass on 03's 7-day quality-weighted intake (03's per-kg-FFM
  f_Pgain lifted older/obese users to q 1.5-1.7 and missed Morton, Villareal, Sardeli; decision table §1.9: 13 of 14 A/B
  targets vs 11 for reference-FFM or per-kg-FFM, 9 before); f_EP uses the 7-day mean e; accretion is the excess over the
  habitual-week reference rate (habitual-training equilibrium, §1.9). *INTEGRATION hazard 1 and 7.*
- **R-PROT2 — protein in both 03's partition and 09's accretion. [rev M13]** Keep both (different mechanisms); calibration
  item: re-verify the Murphy zero-crossing (≈ 500 kcal/d deficit cancels RT lean gain), Longland and Garthe with the real
  partition; if the zero-crossing falls below ≈ 400 kcal/d set ρ_max to its low 0.5. *09 fitted d0/ρ_max on a protein-free
  Forbes partition.* **Applied 2026-09-30 (WP-M8, full engine; coordinator):** the crossing was above the band (810 kcal/d in
  the WP-V scenario at 1.6 g/kg), so ρ_max = 0.5 (registry low): 660 kcal/d there, 604 kcal/d at 1.3 g/kg on Murphy's
  fat-based deficit axis; Longland and Garthe directions hold (Longland magnitude K).
- **R-AEROBIC — 03's activity index. [rev M14]** `aerobicIdx = clamp(7-d mean net cardio session EE / 300 kcal·d⁻¹, 0, 1)`
  (activity); steps stay in NEAT. *10 §4.13's ActivityHealthIndex is a health index, not 03's M_act input.*
- **R-VATEX — exercise-induced VAT loss without weight loss (10 V22).** No owner in v1 (14 M7 allocates VAT from fat-mass
  change only); tracked known-miss K. *No quantified weight-independent redistribution rule in 10/14.*
- **R-TS — training-status speed (09 +2.2 vs 14 +1.0 FFMI/yr; 14 M9).** 09 owns TS dynamics and TS0; 14's prior only
  informs the initial body-fat estimate. *09's kinetics are calibrated to RCT gains.*
- **R-MEM — muscle memory.** κ_mem 1.0 default [1.0, 1.3]. *Conflicting human data → conservative option.*
  **Superseded 2026-10-01 by R-REGAIN** (§1.9): κ_mem 1.3 default (09's retraining pace "faster than the first time").
- **R-STR — strength overshoot (newest item 10).** N_max slope refit 0.20 → 0.125 [0.10, 0.20] so the 12-week novice check
  gives +23 % (data 19-27 %). *Must-pass target.*
- **R-FORBES — lean loss in lean adults (Templeman).** Documented known-miss of 03's baseline partition; carried in the
  ensemble band (±0.1-0.15 SD of ΔFFM/ΔW, 03 §4.4). *No better-evidenced alternative.*
- **R-OVERSHOOT — post-diet fat overshoot.** 11 §4.12 Jacquet rule with threshold ramp, 26-wk expiry. *Only quantified form.*
- **R-AGE-HYP — 16 §4.8.5 ×1.3 / ×0.85 age-hypertrophy multipliers and its V10 mismatch.** Not implemented (09 f_age owns).
- **R-DIST — meal distribution.** 03 §4.8 daily E_dist (0.83-1.0) on RT accretion only; no effect on the catabolic
  partition. *INTEGRATION "meal timing effects on muscle are small".*
- **R-CREATINE.** 15 §4.12 kinetics; accretion ×(1 + 0.05·x) [0, 0.10] (21's 15 % = high, PROPOSED); water 0.9 kg·x.
- **R-ALPERT — deficit cap 0.75 × 69 kcal/kg FM/d (13).** Engine warning `W-13-ALPERT` (caution) when the 7-day deficit
  exceeds 51.75 kcal per kg FM per day; planner soft penalty (17 remains the hard-constraint authority).

**Ketones and fasting**
- **R-KET — 05 retune after coupling.** G50 = 0.55·G_L,max; retune kP and G50 only (05 §4.4) to V1-V6, then check 20's
  BHB_ref beyond day 5; fails V8/V14/V15/V11-fed are tracked known-misses. *05's own instruction; 20 owns zero-intake.*
- **R-KETNUM — ketone integrator.** Linearised exponential step, 4 × 15-min sub-steps inside the hour (§1.7 step 5).
  *Replaces 5-min Euler; one 60-min linearisation fails O-10 by 40-90 % on fast decays (review B4).*
- **R-FATADAPT — fat adaptation.** 05 A_f is the only keto/fat-adaptation state (13 §4.9 F_ad not implemented); 04's
  A_keto reads it. *Same phenomenon, 05 has the calibrated time constants.*
- **R-FAST — zero-intake owner (INTEGRATION "added after …").** 20 supersedes 03/07 fasting N-loss, replaces AT_R, supplies
  k_Mf and oedema, and is the BHB calibration target beyond day 5. 07's day-5+ BHB values are not used.
- **R-KETOFLU.** 13 §4.10 Φ_ind only (19 KI and 05 keto-flu index not implemented).
- **R-PROTKET — protein brake on ketosis.** k_prot 0.15 [0, 0.69]. *Diet data fit a weak effect (05 §4.2).*

**Hormones, appetite, sleep**
- **R-SLEEP — sleep reference and double counting (hazard 3).** One reference h_ref = 7.0 h (`draw: 'fixed'`; 16's 7.5 h
  in `note` — a convention choice, not a plausible spread; [rev M20]); 16's debt states
  (dF, dS) are the single sleep driver: siSleepMult replaces 04 F_sleep, testoSleepMult replaces 12 F_sleep, D_sleep /
  ghrelin / cortisol sleep terms read dF (12's coefficients per hour of debt), partition shift from dS. 16's hunger-VAS
  and leptin/ghrelin sleep multipliers are not added. *12's calibrations used 7 h; the lower reference is conservative
  (fewer users accrue debt).*
- **R-LEPTIN — leptin form and sex (hazard 7; newest item 8).** 12 §4.1 form with sex-specific L0; 13 §4.11's form and 16's
  ×1.5/kg-fat multiplier not implemented. *12 is the hormone owner and fits the largest data set.*
- **R-T3 — T3 carbohydrate dependence (newest item 8).** Carbohydrate knee 50 g/d (`DC_T3 = 1 − carb/50`, `draw: 'fixed'`;
  12 §4.3's 130 g in `note` — the rejected model form, not a plausible value [rev M20]);
  cortisol keeps 12's 130-g DC_T. *Spaulding: ≥ 50 g/d → no T3 change; 13 agrees.*
- **R-IGF — IGF-1 (hazard 6; newest item 7).** 08 §4.12 ODE (lag 30 h, τ 44 h down / 173 h up) only; 12 §4.7's 3 d / 10 d
  and protein elasticity not implemented (08's protein factor TP(P7) covers protein). Obesity modifier = tracked
  known-miss. *08 reproduces Hartman "unchanged at 56 h" and the 72-h value; 12 mispredicts it.*
- **R-MENS — menstrual risk.** 19 §4.9 P_LPD (validated V8) in hormones; 12 §4.6 R_MD registered alternative.
- **R-EC50 — 08 §4.4 EC50_I misfit (newest item 9).** Keep 5 [3, 15], calibrate with B0 to the ASI anchors; inconsistency
  recorded. *The anchor table is the primary target; the single data point implies an out-of-range value.*
- **R-INTAKE — user intake authoritative.** Appetite outputs only; 12 §4.10c free-living drift = future work.
- **R-TC — carbohydrate tolerance.** 04 §4.19 structure, τ_slow 28 d [10, 42] (13 §4.8), 13's separate states dropped.
- **R-PRES — biomarker presentation.** deltaFromBaseline for blood markers and hormones (06/17); absolute only with labs.

**Finisher rulings (orchestrator, 2026-09-30 evening; implemented by the engine finisher)**
- **R-MORNING — the entered weight is a morning weight.** People weigh themselves on waking, post-void and fasted. The
  t = 0 state is anchored so that the **day-0 weigh-in scale weight equals the entered weight** (composition §1.8, water
  §1.10: tissue masses and labile references take the habitual overnight change from the burn-in night of day 0's
  weekday); the daily `scaleWeight`, `leanMass` and `bodyFatPct` values are the weigh-in values (state at ⌈sleepWakeH⌉,
  `core/math.wakeRecordHour`), their `initial` is day 0's weigh-in value, the hourly series are unchanged. O-5 is checked at
  that hour. *Before: anchored at midnight, so the day-0 morning read 0.1-0.45 kg below the entered weight.*
- **R-FASTHUNGER — hunger in multi-day fasts.** 07 §4.10's Hfast time course scales appetite's acute-deficit drive beyond
  its 30-h peak (§1.12 decision f); PROPOSED, grade C. *20 §4.10: multi-day fasts reduce hunger after day 2-3.*
- **R-SIFAST — no fasting insulin resistance in the insulin-sensitivity index.** Carbohydrate tolerance carries it (§1.14).
- **R-EFAST — fasting natriuresis scales with body size.** 20 §4.5.2's `E_fast* = −1.3 L·(0.2·BW0/17 L)` is E_cna's
  fasting target (§1.10). *13's fixed −0.9 L under-predicted the obese woman's day-1/3 losses by 0.5 kg (20 Table A3).*
- **R-RMRDEV — person-level RMR deviation.** `energy.rmrIndividualFrac` δ (0 [−0.2, 0.2], 02 §4.1 Mifflin RMSE ≈ 8 %,
  16 §4.11 adjusted RMR SD 8-10 %) is drawn in ensembles; the core runs the draw's person with RMR0·(1 + δ) and a true
  habitual maintenance TDEE0 + δ·RMR0 while prescriptions stay compiled from the equation estimate (§8.1). *Without it the
  Δfat band of a 25 % deficit was ±7 % and the RMR band ±1 % against 16's ±35 % / ±13 % (§8.3).*

**Design rulings implied by the evidence (INTEGRATION "Design rulings")**
- **R-NOINS — no insulin-driven fat-storage term.** Fat balance is energy residual; test: isocaloric, isoprotein carb↔fat
  swap changes 14-day fat mass by < 20 g/d-equivalent (0 ± 20 g/d, 04) and TEE by < 50 kcal/d per 10 %E (02).
- **R-SEQ — no sequencing bonus.** Test: permutations of the same weekly energy and protein blocks change 12-week fat mass by
  less than the intra-week glycogen/water transient (< 0.2 kg), 13 §4.17. Diet breaks only lower hunger/fatigue.
- **R-ASI — autophagy is relative, caveated, compound-proof** (08).
- **R-BANDS — UI fallback bands (16):** fat ±35 %, lean ±50 %, hypertrophy ±64 %, RMR ±13 %, TEE ±26 % of the change
  (80 % bands); surplus fat gain ±36 % (11 §4.6). Used when draws are off (§8).
- **R-METRICS — metric master list.** 55 metrics (§6) drawn from 19 §6 (56 candidates, core 30), 05 §6, 06 §6, 08 §6.

**Slips and minors (newest items 5, 6, 11; editors' lists)**
- 04 §4.14 lipolysis window: emergent from the insulin curve (no 1.7-h constant used). 04 §4.9 persistence 34/20/46 %:
  target replaced by "supercompensated muscle glycogen stays elevated ≤ 5 d, decaying ~5 %/d" (event `supercompensation`).
  04 §4.22 brain glucose: formula value 46.5 g is used. 01 Hall 2015 deficit: −810 kcal/d (§7.5 value). 01 §7.1 Minnesota
  citation: Keys 1950 via Hall 2006. 12 §4.1 Keim −54 % (target value). Davoodi n, MATADOR arm order: documentation only.
  Resting HR "53 → 27 bpm": not a target. 08 §4.15 "6-10 h": 6-12 h. 15 §4.10 MPS "floor": cap on the reduction. 16/15
  protein-bone study count: irrelevant (no coefficient depends on it). 19 k_h: register value 0.20 used. 17 W-F04 copy:
  grade ≥ 3 adverse events, SAE 0.26 % (20).
- **R-BODY — body module interface.** `Sex` is exported once (`body/types`, re-exported by `types/profile`); untouched
  sliders are `undefined`; RMR/PAL in the body module are defaults only (energy owns RMR); `allocateRegional` is called
  once per day after FM/SM change.
- **R-LEVERS — 21 levers.** Creatine (R-CREATINE), caffeine (performance +, sleep −, no fat-loss credit), viscous fibre
  and omega-3 (lipids/BP via 06), post-meal walk (glycaemia only: steps within 1 h after a meal lower that meal's glucose
  excursion per 21 §4 value, via intake), sauna (SBP −4 mmHg, PROPOSED), post-exercise cold-water immersion (f_CWI 0.8 on
  A_r for sessions followed by CWI, PROPOSED), behavioural levers → adherence hazard only. Extra simulator inputs X1-X19
  are future schedule fields; the planner blocks L1-L19 map to the lever registry (§10).

---

## 3. Evaluation order

### 3.1 Module order (`core/moduleRegistry.MODULES`)
`moderators → activity → intake → fasting → energy → fuel → ketones → composition → muscle → water → cellular →
hormones → appetite → cardiometabolic → wellbeing → safety`. The same order applies to every hook. Rationale, pairwise:
- moderators first: its outputs are day-level multipliers every other module reads the same day.
- activity before intake/energy/fuel: exercise EE, intensity and active muscle mass drive insulin (×(1 − 0.3x)), EE and
  glycogen use of the same hour.
- intake before fasting: the fasting criteria read the 24-h intake rings updated this hour.
- fasting before energy and fuel: `fastRmrMult`, `fastProtOxGH`, `fastActive` change this hour's RMR, protein oxidation
  and muscle glycogenolysis.
- energy before fuel: fuel partitions this hour's `teePreKcalH`.
- fuel before ketones: ketogenesis reads this hour's liver glycogen (05 §4.4 coupling).
- ketones before composition: composition subtracts this hour's urinary ketone loss.
- composition before muscle and water: water needs this hour's tissue mass for scale weight; muscle's hourly MPS layer
  needs FFM_act.
- cellular after muscle and ketones (reads `mpsStimWb`, `bhbEndoMmolL`).
- hormones → appetite → cardiometabolic → wellbeing → safety: daily chain (leptin → hunger; S_hep/S_mus; EA → strength
  multiplier; safety reads everything).

### 3.2 Within an hour
1. `loadHour` copies the precomputed hour row (meals, sets, exercise minutes, steps, asleep fraction, fast flags) into
   the reusable `HourInput`.
2. `stepHour` for each module in order (unrolled dispatch, `core/dispatch.ts`).
3. `recordHour` for each module (only enabled series), then `recorder.commitHour(day, hour, isWakeHour)`; the wake
   hour is `core/math.wakeRecordHour(day.sleepWakeH)` = ⌈sleepWakeH⌉ − 1, whose end-of-hour state is the state at the
   weigh-in clock time ⌈sleepWakeH⌉ (R-MORNING); on day 0 it also sets the `initial` value of the 'wake' series.
Same-hour reads are allowed only from modules earlier in the order; every other bus read sees the value written in the
previous hour (or previous day for daily signals). The timing column of §4 (h / h−1 / d / d−1) is normative and
enforced by `checkWiring()` (tested). Previous-hour reads by design: energy ← fuel (`dnlHeatKcalH`, `gngGH`) and
composition (`depositionCostKcalH`, masses); fuel ← ketones (`ketoAdaptFast`, `brainKetoneShare`); activity ← fuel
(`muscleGlycogenRel`), ← energy (`rmrKcalH`), ← muscle (`trainingStatus`, daily); intake ← fuel (`liverGlycogenG` for the basal-insulin factor)
and ← cardiometabolic (`sHep`, `sMus`, `carbTolerance`, daily); fasting ← ketones (`bhbMmolL`, `bhbEndoMmolL`); moderators ← composition
(`energyBalanceFrac`, daily); muscle ← wellbeing (`strengthEaMult`, daily). All of these act through time constants of
≥ 1 h, so the one-step lag is below the numerical tolerance (§0.1). **Recording reads same-hour values of all modules**
(recordHour runs after every stepHour), so e.g. `tdee` includes this hour's deposition cost and DNL heat.

### 3.3 Day boundaries
Before hour 0 of day d: (a) runtime energy references resolved (`'current'`: today's `maintenanceKcalD`, `tissueMassKg`,
`ffmActKg` from the bus; `'blockStart'`: the values latched at the first day of the block; `'baseline'`: compile time,
TDEE0 and initial weight/FFM); (b) `expandDayToHours` fills the 24-row table (previous evening's bedtime carried for the
asleep fraction); (c) `startDay` for every module. After hour 23: `endOfDay` for every module (daily states: 12's
hormones, 09's accretion, 19's bone, 02's AT, 10's VO2max, 15's creatine/fibre, 16's debt), then `recordDay`,
`commitDay`, conservation checks (when enabled), abort test (planner). Daily outputs therefore act on the next day.

### 3.4 Initialisation and burn-in
**Snapshot (integration 2026-09-30, contract §10.1):** `captureInitialSnapshot(profile, compiled, options)` (or
`RunOptions.captureSnapshot` on any run) returns the post-`endBurnIn` `EngineSnapshot` (every module state, the bus, the
carried sleep timing, the O-5 residual); `RunOptions.initialSnapshot` restores it instead of init + burn-in — `prepare`
still runs, `init` builds the state objects and the snapshot values are copied into them (keeps V8's hidden classes; a
`structuredClone`d state was ≈ 15 % slower). Valid for the same profile, parameter vector, module list, start date, horizon,
mode, series mask and burn-in length (a key; mismatch throws). Exact: `core/__tests__/loop.test.ts` compares every daily,
hourly and safety value bit for bit on the 16 real modules (with intake's trajectory caches, which currently live in its K,
folded into its state — contract request to A2; the as-is registry case is an `it.fails` until then).

(Ruling R-BURNIN, review B3.) `resolveProfile` (body estimate, RMR0 by 02 §4.1, TDEE0, EAT0 = `eat0Kcal`, habitual
macros) → each module's `prepare` (constants, draws, calibrations such as ASI B0) → `init` → **burn-in on the habitual
week**: `core/compileSchedule.habitualWeek(profile)` = 7 DayInputs (weekday 0 = Monday) at the habitual intake (TDEE0 kcal,
habitual macros, meals, steps, sleep) with `habits.sessionsPerWeek` (rounded, 0-7) 60-min sessions at 18:00 on weekdays
⌊7i/N⌋ (alternating where possible), a `lifingCardioMix` share of them cardio ('other' at the §5.3 default intensity 0.625
VO2max — what the Simulator's default cardio session compiles to; integration 2026-09-30, formerly 5.0 MET, which gave fit
people no training dose; energy's NEAT0 calibration absorbs the difference to the 5-MET EAT0 prior) and the rest resistance
(09 'moderate' weekly volume, 11 effective sets per region per week split over the RT sessions) and the habitual alcohol
(`habitualAlcoholDrinksPerWeek`/7 drinks with the last meal, inside TDEE0; integration 2026-09-30). Burn-in day b (clock.day
= b − burnInDays < 0) uses the week's day for its weekday, so the week is cycled `burnInDays/7` times (default 14 days =
twice) and days −7…−1 are one complete habitual week; events off, no recording. → **`endBurnIn`** (optional module hook,
`types/module.ts`; called once in module order after day −1's endOfDay, also when burnInDays = 0; `ctx.burnInDays`
tells how many burn-in days ran): energy calibrates NEAT0 so that the mean model TEE of the last min(7, burnInDays) days
equals EI_hab and resets FM0/FFM_act0 references, AT and compensation; composition resets FM, LT (absolute LT0, R-LT0), SM
and depots to the profile values; water re-anchors every labile-water reference (deviations 0) and writes scale =
tissue mass; other modules may reset slow memories (e.g. activity keeps its VO2max, muscle its training state) and latch
their baselines as means over the habitual week (wellbeing's bone/endurance/M_EA references and habitual EA/EEE,
integration 2026-09-30) so that a habitual exerciser's training/rest-day pattern averages to the index baselines.
→ `captureInitial`. **Morning anchor (R-MORNING):** composition and water anchor the tissue masses and labile references
to the habitual overnight change (burn-in night of day 0's weekday), so the day-0 weigh-in scale weight equals the entered
weight; the core measures it at that hour (`meta.checks.t0WeightErrKg`, O-5, tolerance 0.05 kg; the midnight value is
`meta.checks.t0ScaleKg`) — it holds by the anchoring above, not by a water offset (water carries no tissue offset). It is
exact for a day 0 that continues the habitual night; a plan that changes the first night (a fast overlay from 00:00, food or
exercise before waking) moves the day-0 morning by its own physiology (≈ −0.3 kg for a fast from 00:00). **Person-level
RMR deviation (R-RMRDEV, §8.1):** before `prepare`, the core replaces the resolved profile by the draw's person when
`energy.rmrIndividualFrac` ≠ 0 (RMR0·(1 + δ), true habitual maintenance TDEE0 + δ·RMR0 with the habitual macro grams
scaled; body composition unchanged); every module's `ctx.profile` and the burn-in week use it, the compiled schedule does
not.
Invariant **O-12** (§9.1): a weight-stable person at 100 % of baseline maintenance with habitual training stays stable.

---

## 4. Signal bus (normative contract; `src/engine/types/signals.ts` is the code form)

Timing tags: `h` = same hour (writer earlier in the order), `h−1` = previous hour, `d` = written at `startDay`/`endOfDay`
and read the same day, `d−1` = yesterday's value. 121 signals (111 in v1, +3 by the review's B5, +4 after it, +3 by the fuel/ketone integration: `muscleGlycogenExDefFrac`,
`liverGlycogenMaxG`, `insulinRefRel` — §11.0; this table is generated from `types/signals.ts` and equals it),
all numbers (no objects), one writer each. The bus is created with fast properties (`Object.fromEntries`, one hidden
class per run and across runs — regression-tested); modules must never add or delete bus properties. `checkWiring()`
reports hard `issues` (foreign or undeclared writes, undeclared reads, reads missing from this readers column) and
`pending` entries (a listed writer/reader has not adopted the signal yet — allowed during parallel implementation).

| Signal | Unit | Writer | Cadence | Readers (timing) | Init | Meaning |
|---|---|---|---|---|---|---|
| `sleepDebtFastH` | h | moderators | day | appetite (d), hormones (d) | 0 | Fast sleep-debt state dF (16 §4.1.1) |
| `sleepDebtSlowH` | h | moderators | day | wellbeing (d) | 0 | Slow sleep-debt state dS (16 §4.1.1) |
| `siSleepMult` | 1 | moderators | day | cardiometabolic (d) | 1 | Insulin-sensitivity multiplier from sleep debt (16 §4.0.1) |
| `mpsSleepMult` | 1 | moderators | day | muscle (d) | 1 | MPS / RT-accretion multiplier from sleep debt (16 §4.0.1; = 09 f_sleep) |
| `testoSleepMult` | 1 | moderators | day | hormones (d) | 1 | Testosterone multiplier from sleep debt, men (16 §4.0.1) |
| `partitionSleepShift` | 1 | moderators | day | composition (d) | 0 | Added protein-energy share (P-ratio; added to p_E, not pCat) of loss from sleep debt in deficit (16 §4.0.1) |
| `lutealWeight` | 0..1 | moderators | day | energy (d), appetite (d), water (d) | 0 | Luteal-phase weight s(d) incl. 2-d ramps (02 §4.3, 16 §4.5) |
| `cycleDay` | d | moderators | day | water (d) | -1 | Menstrual cycle day, 1-based (1 = first day of menses); −1 when not tracked / hormonal contraception / post-menopause |
| `stressLevel` | 0..2 | moderators | day | — | 0 | Stress 0 low / 1 moderate / 2 high |
| `ageYears` | y | moderators | day | energy (d), muscle (d), composition (d), wellbeing (d) | 30 | Age, advanced daily |
| `exEEKcalH` | kcal/h | activity | hour | energy (h), appetite (h), safety (h) | 0 | Net exercise EE this hour incl. EPOC / post-RT REE (10 §4.1-4.2, 09 §4.13) |
| `exSessionNetKcalH` | kcal/h | activity | hour | safety (h) | 0 | Session net EE only (gross − RMR), the EEE of energy availability |
| `exSessionNetKcalD` | kcal/d | activity | day | wellbeing (d) | 0 | Yesterday's total session net EE (Σ exSessionNetKcalH over the day), written in activity's endOfDay; daily consumers read it instead of accumulating the hourly signal (review m10) |
| `stepsExtraKcalH` | kcal/h | activity | hour | energy (h) | 0 | Step energy above the habitual-steps baseline (10 §4.1, §4.14) |
| `exIntensityFrac` | frac VO2max | activity | hour | intake (h), fuel (h), ketones (h), cellular (h) | 0 | Mean exercise intensity this hour (0 at rest) |
| `exMinutesH` | min | activity | hour | fuel (h), ketones (h), cellular (h) | 0 | Exercise minutes in this hour |
| `exActiveMuscleKg` | kg | activity | hour | fuel (h) | 0 | Active skeletal-muscle mass of the current cardio bout |
| `exHardSession` | 0/1 | activity | hour | water (h), safety (h) | 0 | A hard (≥85 % VO2max interval or to-failure RT) bout occurred this hour |
| `vo2maxMlKgMin` | mL/kg/min | activity | day | fuel (d), cardiometabolic (d), wellbeing (d) | 40 | Current VO2max (10 §4.8) |
| `mitoRel` | rel | activity | day | — | 1 | Mitochondrial oxidative capacity relative to baseline (10 §4.9) |
| `exPlannedKcalD` | kcal/d | activity | day | energy (d) | 0 | Today's planned exercise EE (exEEKcalH estimate summed over DayInput.sessions), written in startDay |
| `aerobicIdx` | 0..1 | activity | day | composition (d) | 0 | Aerobic-activity index for 03's M_act (review M14): clamp(7-day trailing mean of net cardio session EE (exSessionNet, cardio sessions only) / 300 kcal/d, 0, 1); steps excluded (NEAT only); written in startDay (MODEL_SPEC §1.2 step 6) |
| `raGlcGH` | g/h | intake | hour | fuel (h) | 0 | Glucose(-equivalent) appearance from the gut |
| `raFruGalGH` | g/h | intake | hour | fuel (h) | 0 | Fructose + galactose appearance (liver first pass in fuel) |
| `raProtGH` | g/h | intake | hour | fuel (h), ketones (h), composition (h) | 0 | Absorbed protein, unweighted |
| `raAaQGH` | g/h | intake | hour | muscle (h), cellular (h) | 0 | Lagged quality-weighted AA appearance A_lag (03 §4.7A) |
| `raFatGH` | g/h | intake | hour | — | 0 | Absorbed fat (long + medium chain) |
| `raMctGH` | g/h | intake | hour | ketones (h) | 0 | Absorbed MCT |
| `alcOxGH` | g/h | intake | hour | fuel (h), energy (h) | 0 | Ethanol oxidised this hour (zero-order queue, 15 §4.10) |
| `etohPoolG` | g | intake | hour | ketones (h), muscle (h), safety (h) | 0 | Ethanol not yet oxidised |
| `exoKetoneMmolH` | mmol/h | intake | hour | ketones (h) | 0 | Exogenous ketone appearance (D-BHB) |
| `eAbsKcalH` | kcal/h | intake | hour | composition (h), energy (h), fuel (h) | 0 | Metabolisable energy appearing this hour (all macros, fibre/nut ME corrections) |
| `absFluxKcalH` | kcal/h | intake | hour | — | 0 | Total absorptive energy flux used for the fed/fasted state (07 §4.1) |
| `insulinUuMl` | µU/mL | intake | hour | fuel (h), cellular (h), cardiometabolic (h) | 7 | Plasma insulin, hour mean (04 §4.17 + 05 basal term) |
| `insulinBasalUuMl` | µU/mL | intake | hour | cellular (h) | 7 | Basal (fasting) insulin Ins_f·(05 basal-decline factor) this hour, without meal excursions (04 §4.17; for 08 dI = insulinUuMl − insulinBasalUuMl) |
| `insulinRel` | rel | intake | hour | hormones (h) | 1 | Insulin relative to the person's own overnight trough (lowest hourly insulin of the last burn-in day, dinner tail included; latched at the end of burn-in), so the overnight value is ≈ 1 at baseline (hormones' SHBG proxy). 05's ketone proxy I is `insulinRefRel` |
| `insulinRefRel` | rel | intake | hour | ketones (h) | 1 | 05's insulin proxy I (05 §4.4, §4.17) on intake's absorption rates: IR·(I_b + 0.12·Ra_C + 0.04·Ra_P)·(1 − 0.3·x), I_b = the basal-decline factor (05 liver factor / 07 §4.4.3 time course), IR = S_hep^−0.9 — the calibration domain of 05's lipolysis/ketogenesis (ruling R-KET) — integrator A2 |
| `glucoseMmolL` | mmol/L | intake | hour | cardiometabolic (h) | 5 | Plasma glucose, hour mean (04 §4.16) |
| `fedState` | 0/1 | intake | hour | safety (h) | 0 | Absorptive state (07 §4.1: flux ≥ 30 kcal/h) |
| `hoursPostAbsorptiveH` | h | intake | hour | cardiometabolic (h) | 12 | tPA: hours since the absorptive state ended (07 §4.2) |
| `hoursSinceMealH` | h | intake | hour | cellular (h), hormones (h) | 12 | hFast: reset by protein ≥10 g or net carb ≥15 g (08 §4.10) |
| `hoursSinceIntakeH` | h | intake | hour | safety (h), appetite (h) | 12 | fast_h: hours since last intake > 50 kcal (17 §2.1) |
| `carbAbs24G` | g | intake | hour | water (h), ketones (h), cardiometabolic (h), fasting (h) | 250 | Net carbohydrate eaten in the last 24 h |
| `kcalEaten24` | kcal | intake | hour | ketones (h), fasting (h) | 2000 | Energy eaten in the last 24 h |
| `caffeineLoadMg` | mg | intake | hour | moderators (h−1), energy (h) | 0 | Caffeine body load (15 §4.11) |
| `creatineSatFrac` | 0..1 | intake | day | water (d), muscle (d) | 0 | Creatine saturation x/x_max (15 §4.12) |
| `fibreEffG` | g/d | intake | day | water (d), appetite (d) | 16 | Gut-lagged fibre exposure F_eff (15 §4.2) |
| `fastActive` | 0/1 | fasting | hour | energy (h), fuel (h), composition (h), water (h), safety (h), wellbeing (h) | 0 | Water-only / modified-fast overlay active (20 §4.1, §4B.1) |
| `fastHoursH` | h | fasting | hour | safety (h) | 0 | tFast: hours since the fast overlay started |
| `fastRmrMult` | 1 | fasting | hour | energy (h) | 1 | (1 + A_SNS)·(1 − φ_AT·s_AT) applied to RMR; replaces AT_R while active or \|mult − 1\| > 0.001 (20 §4.2) |
| `fastProtOxGH` | g/h | fasting | hour | composition (h), fuel (h) | 0 | Protein oxidised while fasting (20 §4.4 N model × 6.25) |
| `fastRepletionGH` | g/h | fasting | hour | composition (h) | 0 | Labile-protein repletion after refeeding (20 §4.4) |
| `fastOedemaL` | L | fasting | hour | water (h) | 0 | Refeeding oedema after fasts > 3 d (20 §4.5.2) |
| `teePreKcalH` | kcal/h | energy | hour | fuel (h), composition (h) | 90 | TEE excluding tissue-deposition costs and DNL heat |
| `rmrKcalH` | kcal/h | energy | hour | activity (h−1) | 70 | Resting metabolic rate incl. AT_R, k_P, C_comp, modifiers |
| `atKcalD` | kcal/d | energy | day | safety (d) | 0 | Adaptive thermogenesis AT_R + AT_N (≤ 0 in deficit) |
| `maintenanceKcalD` | kcal/d | energy | day | composition (d), cellular (d), safety (d), fasting (d−1) | 2200 | Instantaneous maintenance EI_inst at habitual activity (02 §4.13) |
| `tdeeEstKcalD` | kcal/d | energy | day | composition (d), hormones (d), appetite (d), ketones (d), safety (d), fasting (d) | 2200 | Today's TDEE estimate (yesterday's TDEE with today's planned exercise) |
| `liverGlycogenG` | g | fuel | hour | intake (h−1), ketones (h), cellular (h), water (h) | 80 | Liver glycogen G_L |
| `muscleGlycogenG` | g | fuel | hour | water (h), wellbeing (h) | 400 | Whole-body muscle glycogen G_M |
| `muscleGlycogenRel` | rel | fuel | hour | cellular (h), muscle (h) | 1 | G_M relative to the fed reference |
| `muscleGlycogenExDefFrac` | 0..1 | fuel | hour | ketones (h) | 0 | Exercise-driven muscle-glycogen deficit: glycogen removed by exercise/RT bouts and not yet resynthesised, as a fraction of the fed reference (05 §4.3 δ_M restricted to exercise-driven depletion; resting and fasting glycogenolysis excluded) — integrator A2, ketone runaway fix |
| `liverGlycogenMaxG` | g | fuel | day | ketones (d) | 117.45 | Liver-glycogen capacity G_L,max = c_L,max·V_liv·0.162 g/mmol (04 §4.1), written in init/startDay; ketones sets its partition half-point G50 = g50Frac·G_L,max (05 §4.4 coupling note) — integrator A2 |
| `choOxGH` | g/h | fuel | hour | — | 8 | Net carbohydrate oxidation |
| `fatOxGH` | g/h | fuel | hour | — | 3 | Net fat oxidation (residual) |
| `protOxGH` | g/h | fuel | hour | — | 3 | Protein oxidised (absorbed − deposited) |
| `dnlFatGH` | g/h | fuel | hour | — | 0 | Whole-body net DNL, g fat/h |
| `dnlHeatKcalH` | kcal/h | fuel | hour | composition (h), energy (h−1) | 0 | Heat of net DNL (28 % of carbohydrate energy, 04 §4.13) |
| `gngGH` | g/h | fuel | hour | energy (h−1) | 5 | Gluconeogenesis (amino acids + glycerol), g glucose/h |
| `glycogenChangeKcalH` | kcal/h | fuel | hour | composition (h) | 0 | ρG·ΔG this hour (energy moved into glycogen) |
| `rqHour` | 1 | fuel | hour | — | 0.85 | Respiratory quotient this hour |
| `tkbMmolL` | mmol/L | ketones | hour | — | 0.25 | Total ketone bodies |
| `bhbMmolL` | mmol/L | ketones | hour | appetite (h), safety (h), cardiometabolic (h), fasting (h−1) | 0.1 | Blood BHB as read by a meter |
| `bhbEndoMmolL` | mmol/L | ketones | hour | cellular (h), composition (h), fasting (h−1) | 0.1 | Endogenous BHB (exogenous ketones excluded; 08 rule) |
| `ffaMmolL` | mmol/L | ketones | hour | — | 0.5 | Plasma FFA |
| `ketoAdaptFast` | 0..1 | ketones | hour | fuel (h−1), wellbeing (h) | 0 | A_f fast keto/fat adaptation (05 §4.11) |
| `ketoAdaptSlow` | 0..1 | ketones | hour | — | 0 | A_s slow ketone-kinetics adaptation |
| `ketoneLossKcalH` | kcal/h | ketones | hour | composition (h) | 0 | Urinary ketone energy loss |
| `brainKetoneShare` | 0..1 | ketones | hour | fuel (h−1) | 0.03 | Share of brain energy from ketones |
| `fatMassKg` | kg | composition | hour | energy (h−1), hormones (h), cardiometabolic (h), wellbeing (h), safety (h), water (h), fasting (h−1) | 20 | Fat mass FM |
| `leanTissueKg` | kg | composition | hour | energy (h−1), water (h) | 45 | Lean tissue LT (Hall convention, excludes glycogen and labile water) |
| `ffmActKg` | kg | composition | hour | energy (h−1), muscle (h), ketones (h−1), wellbeing (h), hormones (h), cellular (h), fasting (h−1), safety (h) | 60 | Metabolically active FFM (FFM0 + ΔLT) |
| `tissueMassKg` | kg | composition | hour | water (h), safety (h), energy (h−1), appetite (h), activity (h−1), intake (h−1), muscle (h), ketones (h−1), cardiometabolic (h) | 80 | FM + FFM_act (weight without glycogen/labile-water deviations) |
| `skeletalMuscleKg` | kg | composition | day | fuel (d−1), muscle (d), wellbeing (d) | 30 | Skeletal muscle mass |
| `tissueEnergyKcalH` | kcal/h | composition | hour | safety (h) | 0 | Energy stored in tissues this hour, S_h |
| `depositionCostKcalH` | kcal/h | composition | hour | energy (h−1) | 0 | η_F·dFM + η_L·dLT this hour |
| `leanRateKgD` | kg/d | composition | day | fuel (d−1) | 0 | Planned lean-tissue change for today (protein deposition for protein oxidation) |
| `energyBalanceFrac` | 1 | composition | day | muscle (d), moderators (d−1), cellular (d), cardiometabolic (d) | 0 | u = (EI − TEE_est)/TEE_est for today, clamped to [−1, 1] |
| `energyBalance7KcalD` | kcal/d | composition | day | cardiometabolic (d), water (d) | 0 | EB7: trailing 7-day mean (boxcar) of the planned balance EI − TEE_est incl. today (11 §4.15; MODEL_SPEC §1.8 step 1) |
| `vatKg` | kg | composition | day | — | 1.5 | Visceral adipose tissue |
| `rtAccretionKgD` | kg/d | muscle | day | composition (d−1) | 0 | Σ A_r − Σ D_r for tomorrow (09 §4.9-4.10) |
| `rtRetentionFrac` | 0..1 | muscle | day | composition (d−1) | 0 | R_RT: share of non-RT lean loss prevented (09 §4.8) |
| `rtDoseFrac` | 0..1 | muscle | day | composition (d−1) | 0 | min(1, V_wb/V_R(age)): RT dose relative to the retention dose (09 §4.8; RT index for 03 ΔL_age and the M_RT-free partition) — composition reads it instead of copying V_R |
| `smRtKg` | kg | muscle | day | energy (d−1) | 0 | Training-attributable skeletal muscle gained since t = 0, 0.7·Σ(M_acc − M_acc,0) (SM_RT for 02 γ_SM) |
| `fatFloorActive` | 0..1 | composition | hour | safety (h) | 0 | Smooth fat-mass floor engaged (review M9): 1 − clamp((FM − FM_min)/1 kg, 0, 1), FM_min = 0.02·BW0; > 0 means part of the fat share of a negative balance is taken from lean tissue (MODEL_SPEC §1.8 step 4b) |
| `rtVolumeWb` | sets/wk | muscle | day | composition (d−1) | 0 | V_wb: muscle-mass-weighted weekly effective sets (s_RT = min(1, V_wb/12) for 11 §4.7; RT for 03 ΔL_age) |
| `mpsStimWb` | 0..1.6 | muscle | hour | cellular (h) | 0 | Whole-body post-exercise MPS elevation S_mps (09 §4.4) |
| `trainingStatus` | 0..1 | muscle | day | activity (d−1) | 0 | Whole-body training status TS |
| `labileWaterKg` | kg | water | hour | safety (h), wellbeing (h) | 0 | All labile mass deviations: (1 + h)·ΔG (glycogen and its water) + ECF + gut + oedema + PV + cycle + creatine − H_def; scale = tissueMass + labileWater |
| `scaleWeightKg` | kg | water | hour | safety (h), activity (h−1) | 80 | Displayed scale weight (13 §4.1) |
| `hydrationDeficitKg` | kg | water | hour | safety (h) | 0 | Acute hydration deficit H_def (15 §4.8) |
| `asiIdx` | 0..100 | cellular | hour | — | 20 | Autophagy Signal Index (08 §4.10) |
| `leptinRel` | rel | hormones | day | — | 1 | Leptin relative to baseline |
| `leptinSuffFM` | 0..1 | hormones | day | appetite (d) | 0.9 | S_L(L_FM) leptin sufficiency of fat-mass leptin |
| `leptinSuff0` | 0..1 | hormones | day | appetite (d) | 0.9 | S_L(L0) at baseline |
| `t3Rel` | rel | hormones | day | — | 1 | Total T3 relative |
| `testosteroneRel` | rel | hormones | day | — | 1 | Total testosterone relative (men) |
| `reproRiskFemale` | 0..1 | hormones | day | — | 0 | Probability of menstrual disturbance per cycle (women) |
| `igf1Rel` | rel | hormones | day | — | 1 | IGF-1 relative (08 §4.12) |
| `hungerIdx` | 0..100 | appetite | day | safety (d) | 6 | Hunger Pressure Index HPI |
| `dietFatigue` | 0..1 | appetite | day | — | 0 | Diet-fatigue state F |
| `sHep` | rel | cardiometabolic | day | intake (d−1) | 1 | Hepatic insulin sensitivity |
| `sMus` | rel | cardiometabolic | day | intake (d−1), fuel (d−1) | 1 | Peripheral (muscle) insulin sensitivity |
| `carbTolerance` | 0..1 | cardiometabolic | day | intake (d−1), fuel (d−1) | 1 | T_C carbohydrate-tolerance state (04 §4.19) |
| `insulinResistanceIdx` | 0..1 | cardiometabolic | day | energy (d−1) | 0 | IR index for 02 m_IR and 05 IR scaling |
| `liverFatPct` | % | cardiometabolic | day | — | 5 | Intrahepatic triglyceride |
| `eaKcalKgFfm` | kcal/kg FFM/d | wellbeing | day | safety (d) | 45 | Energy availability, smoothed EA_s (19 §4.1) |
| `ea7KcalKgFfm` | kcal/kg FFM/d | wellbeing | day | safety (d) | 45 | Energy availability 7-day mean (17 EA_7) |
| `ketoInduction` | 0..1 | wellbeing | day | appetite (d−1), safety (d) | 0 | Keto-induction symptom load Φ_ind (13 §4.10) |
| `strengthEaMult` | 1 | wellbeing | day | muscle (d−1) | 1 | Strength-capacity multiplier M_EA from low energy availability (19 §4.3) |
| `safetyAbort` | 0/1 | safety | day | — | 0 | Set when a planner abortOn bound is crossed (planner mode only) |

---

## 5. Inputs (code: `types/profile.ts`, `types/schedule.ts`, `types/inputs.ts`, `core/defaults.ts`, `core/compileSchedule.ts`)

### 5.1 PersonProfile → ResolvedProfile
`PersonProfile {schemaVersion 1, body: BodyInputs (14; sliders undefined when untouched), sexUnspecified?, habits?,
cycle?, menopause?, labs?, safety? {mode M0/R1/R2/H, flags}, startDate?}`. `resolveProfile` returns the immutable
`ResolvedProfile`: body estimate (14 `estimateInitialState`), RMR0 (02 §4.1 selection rule), TDEE0 (02 §4.13 steps
form, plus the activity intake's non-step terms when `habits.activity` is given, §5.5), habitual macros, FFM0/FM0,
completed habits (`typicalSteps` = the intake's S_hab), `activity` (maintenance drivers and band, §5.5). Unspecified sex averages the male/female forms (02 §4.1) and
disables sex-gated outputs. Age < 18 and pregnancy/lactation are blocked by the app gate (17 HC-P1/P2) before the engine.

### 5.2 Schedule (the only way inputs enter)
`Schedule {schemaVersion 1, startDate, horizonDays, programs: DayTemplate[], days: ScheduleDay[] (dense, one per day:
program index + optional partial override), blocks?, events?: FastEvent[], defaults? {energyReference}}`.
It is the engine-side form of dossier 18 §4.4.2's `Plan` and of the design's painted timeline: one DayTemplate per
18 day-type (and per UI "program"), the week pattern and recurring overlays expanded into `days`, 18 `EventInstance`s
of family `zeroIntake` → `FastEvent`s, phases → `blocks`. No diet names exist anywhere in the engine (orchestrator
ruling); templates are numbers.

`DayTemplate` fields and units:
- **energy**: `{kind:'pctMaintenance', pct, reference?, activity?}` | `{kind:'kcal', kcal}` | `{kind:'zero'}`; reference
  `'baseline'` (default: TDEE0), `'current'` (today's EI_inst, resolved at run time), `'blockStart'` (EI_inst latched at the
  block's first day = 18's `phaseStart`; 18's `checkIn` = 4-week blocks with `blockStart`).
  **Maintenance reference (ruling R-MAINT, QA 2026-09-30; `core/activityReference.ts`).** "100 % of maintenance" means
  weight-stable *for the activity the schedule prescribes*: reference = habitual maintenance − habitual exercise energy +
  the schedule's planned exercise energy, for every reference mode. Activity energy = what the activity module books into
  TDEE (§1.2 steps 2-3, 6: sessions net of own RMR − displaced baseline + EPOC + post-RT REE, and steps above the habitual
  steps), estimated per day with the nominal registry at the t = 0 body and at the VO2max the activity module will reach
  that day (10 §4.8 two-pool response to the planned aerobic dose replayed at compile time), by the module's own
  `sessionsBookedKcal`; the habitual term is the same estimate on the burn-in week (cyclic), so keeping the habitual
  training gives exactly 0. Δ_d = mean over the day's window (the `blocks` phase containing the day; else its 7-day week
  counted from the schedule start, the last partial week = the last 7 days) − habitual mean. Static days ('baseline',
  'kcal', 'zero'): `activityAdjKcal` = (Δ + comp)/(1 − α0 − β) with comp = −min(c_met(BMI0)·max(0, Δ), 0.05·RMR0) (energy's
  compensation equilibrium), α0 the habitual TEF share and β = β_AT⁺ (β_AT) for more (less) intake — the steady state of
  the engine's own compensation, TEF and AT rules, so a person at 100 % is weight-stable after transients. Runtime days
  ('current', 'blockStart'): `activityAdjKcal` = Δ/(1 − α0) added to energy's instantaneous maintenance at habitual activity
  (which carries the current compensation and AT states; the feedback converges to the same steady state).
  `maintenanceKcal` = TDEE0 (static) or EI_inst (runtime) + `activityAdjKcal`; `plannedBalanceKcal` = `energyKcal −
  maintenanceKcal` (deficit < 0 < surplus) on every day; `activityDeltaKcal` = Δ. `activity: 'habitual'` (additive, default
  'planned') opts a day out (adjustment 0 = % of the habitual intake; used by study fixtures whose protocol cut intake from
  baseline intake while adding exercise). Diet-composition effects are not in the reference (a 1.6 g/kg diet at 100 % runs
  ≈ −30 kcal/d through protein TEF and turnover; the `maintenance` metric shows them). Carbohydrate eaten during exercise
  (R-EXCARB) stays on top of the energy target (it shows as a planned surplus).
- **macros**: protein, carbs (net), fat each as `{unit:'g'|'gPerKgBw'|'gPerKgFfm'|'pctEnergy'|'remainder', value}`
  (orchestrator ruling: g, g/kg BW, g/kg FFM, % energy); fibre (g, g/1000 kcal); viscous share; fat types (SFA/MUFA/PUFA
  shares, omega-3 g, MCT g); sugars share, fructose share of sugars; protein source (quality table 03 §4.10).
  Resolution order: energy → fibre → alcohol → explicit macros → one `remainder`; inconsistent totals keep the grams and
  emit compile note `macrosExceedEnergy` (the energy total becomes the sum; intake is never silently changed).
  BW/FFM for g/kg units use the same reference as energy (baseline: entered weight/FFM0; current/blockStart: tissue mass
  and FFM_act at run time).
  **Carbohydrate share of non-protein energy (R-NPSHARE, review m8; 18 §4.4.2 `carbShareNonProtein`):** optional
  `MacroSpec.carbShareNonProtein` ∈ [0, 1]; when set, carbs = share·E_np/4 and fat = (1 − share)·E_np/9 with
  E_np = E − 4·protein − 2·fibre − 7·alcohol, and `carbs`/`fat` are ignored (protein must be explicit; compile note
  `nonProteinShareNeedsProtein` otherwise). This is the reviewer's `pctNonProteinEnergy` expressed as a field, so the
  `MacroAmount` union (enumerated by UI code) is unchanged.
- **food**: GI, UPF share, energy density, nuts, liquid kcal, food quality 1-3 (12 §4.9.2, 15 §4.2, 04 §4.16).
- **meals**: count + window shorthand, split (even / biggerLast / biggerFirst) or explicit meals (clock hour, share or grams,
  source) — max 8 (`MAX_MEALS`).
- **exercise** (≤ 6 sessions/day): resistance (start, duration, sets by 9 regions or volume preset (09 §4.1 presets), RIR,
  %1RM, rest, to failure, style, and the additive `met?` (2026-10-01): a gross MET that replaces the style MET for the
  session's energy cost — catalogue items such as mudgar, gada or kettlebell swings, PLANNER_V2_SPEC §8.3; absent or not
  positive → the style MET, bit-identical to before) and cardio (modality, start, duration, one of %VO2max / MET / speed / power / RPE, carbs
  during). **Carbohydrate during exercise (R-EXCARB, review M8)** is intake: the compiler adds Σ carbDuringGPerH·duration
  to the day's `carbG`, `glucoseEqG` and `energyKcal` **on top of** the template's energy target (field
  `DayInput.exerciseCarbG`, compile note `carbsDuringExerciseAdded`); meals never contain it; it is dropped (note
  `carbsDuringExerciseDropped`) when the session overlaps a planned fast or a zero-intake day.
  **"Training as usual" (ruling R-DETRAIN part 2, release check 2026-10-01; additive).** `habitualTraining?: boolean`
  (default false = no implicit sessions, backward compatible): when true the day's sessions are the profile's habitual
  sessions for the day's weekday — exactly the burn-in habitual week's (`habitualWeekPrograms(profile)[weekday]`:
  `round(habits.sessionsPerWeek)` 60-min sessions at 18:00 on weekdays ⌊7i/N⌋, a `lifingCardioMix` share cardio at the §5.3
  default intensity, the rest resistance at the 'moderate' weekly volume, 11 effective sets/region/wk) — followed by the
  template's own `exercise` entries as extras (≤ 6 in all). A per-day override may switch it off ("no training that day":
  `{habitualTraining: false}`, no `exercise`). Compiled: the sessions (habitual first) and the marker
  `DayInput.habitualTraining?` (true). `habitualSessionsFor(profile, weekday)` (exported from `core/compileSchedule` and
  `src/engine`) returns the same sessions for display or for materialising them into `exercise`. Because they are the burn-in
  sessions, R-MAINT's activity adjustment is 0 for a full habitual week and the schedule continues the steady state: a
  schedule of `habitualTraining` days at 100 % on the habitual diet is weight- and lean-stable (12 weeks: |ΔFM|, |ΔLT| < 0.15
  kg, |Δscale| < 0.3 kg, training-attributable lean flat) for sedentary, lifting, running and mixed profiles
  (`core/__tests__/habitualTraining.test.ts`); on a 1.6 g/kg, 45 % carbohydrate program the scale drifts ≤ 0.6 kg by the
  protein's TEF (diet-composition terms are not in the reference, above), lean tissue does not fall. The UI defaults programs
  and the starter scenario to `habitualTraining: true` with an explicit "no training" choice (UI's WP).
- **steps**, **sleep** (bed/wake or hours, quality, shift work), **substances** (caffeine doses, alcohol drinks, creatine g
  with loading flag, exogenous ketones), **hydration** (sodium, potassium, magnesium, fluid, sweat rate, electrolytes),
  **modifiers** (stress, illness, travel, hot climate).
- **FastEvent** `{startDay, startH, durationH, electrolytes?, refeed? 'none'|'auto', refeedFactors?}` — **`durationH` is meal
  to meal** (ruling 2026-09-30 18:10): `startDay·24 + startH` (fractional allowed) is the last intake before the fast,
  `+ durationH` the first intake after it; intake exactly at either boundary is allowed, never strictly between. The
  zero-intake mask is the whole hours strictly between the hour holding the last intake and the hour holding the first
  (`durationH − 1` hours for whole-hour boundaries: a 24-h fast after a 19:00 dinner masks 20:00-18:59 and the intake clocks
  see exactly 24 h). Meals strictly inside the window are **dropped** (A2 request, 2026-09-30; never relocated as a bolus):
  their grams leave the day's totals (`DayInput.mealDropMask`, compile note `mealDroppedInFast`), the remaining meals keep
  their planned size, and runtime re-resolution re-applies the same drops. `refeed:'auto'` applies 17 HC-F3 ramps by meal-to-meal length: 48-72 h [0.5, 0.9]
  of the day's energy; > 72 h 0.5, 0.5, 0.75 … for max(4, ⌈½·fast days⌉) days (all macros scaled); ≤ 48 h none.
  `refeedFactors` (per-fast refeed descriptor, fractions of each following day's planned energy from the day the fast ends)
  replaces the tier default and implies a refeed. Compiled: `DayInput.refeedFactor`, and every `fastSpans[i]` carries
  `mealToMealH` (measured between the actual intake times around the span; horizon edges count as intake — the quantity
  tiers and the ≥ 24 h fasting regime use), `refeed` and `refeedDays`.
- **Additive inputs of the integration pass (2026-09-30; all optional with defaults)**: `food.cholesterolMg` (mg/d; absent =
  habitual, no effect) and `food.dashFraction` (0..1; absent = from `foodQuality`) → `DayInput.cholesterolMg`/`dashFraction`
  (NaN = not given); `modifiers.saunaSessionsPerWeek` (21 X7; default 0) → `DayInput.saunaSessionsPerWeek`;
  `ResistanceSession.coldWaterImmersion` (post-session cold-water immersion, 21; default false) →
  `SessionResolved.coldWaterImmersion`; `Schedule.adherence {selfMonitoring, mealReplacement, preMealWater,
  flexibleRestraint}` (21 §4G levers; default none) → `CompiledSchedule.adherence` (appetite's hazard multiplier only);
  `HabitProfile.smoker` (16 §4.2.1 caffeine ×0.56; default false), `habitualLiquidKcal`, `habitualEnergyDensityKcalPerG`
  (12 §4.9.2 satiety references; NaN = population reference). MCT counts at 8.3 kcal/g in every compiled energy total
  (05 §4.17; a remainder fat fills the energy target with MCT at its own density). Casual path: a template with only
  energy %, a macro split, an eating window and a session gets a complete DayInput (defaults below; tested).

### 5.3 Defaults (`core/defaults.ts`; each with its dossier)
| Input | Default | Source |
|---|---|---|
| Energy reference | baseline (TDEE0) | orchestrator ruling; 02 §4.13 |
| Protein | 1.6 g/kg BW when a template omits it | 03 §4.2 plateau; 09 §4.8 |
| Habitual protein / carbohydrate | 15.6 %E; 45.4 %E (M) / 46.3 %E (F) | NHANES via 06 §2.4 |
| Fat-type shares | SFA 0.32, MUFA 0.34, PUFA 0.23 of fat | 06 §2.4 (DERIVED) |
| Sugars | 121 g (M) / 94 g (F) habitual; fructose share 0.5 of sugars (ENGINEERING DEFAULT, UNVERIFIED) | 06 §2.4; sucrose stoichiometry |
| Omega-3 | 0.11 g (M) / 0.08 g (F) | 06 §2.4 |
| Fibre | 8 g/1000 kcal; viscous share 0.15 | 15 §4.2 (population preset) |
| GI, UPF share, food quality | 55; 0.55; 2 | 04 §4.16; 12/15 population presets |
| Sodium, potassium, magnesium | 3.0 g habitual sodium, 2.8 g, 300 mg; a day without an explicit sodium carries the habitual sodium density (habitual × E/TDEE0, so over- and underfeeding bring their sodium; integration 2026-09-30), a water-only day the habitual level (electrolyte plan) | 15 §4.7 (I_0 130 mmol), NHANES |
| Caffeine | 150 mg at 12:00 | 15 §4.11 (mg_hab 150) |
| Meals | 3 in 08:00-20:00, even | 03 §4.7 reference day; 07 |
| Sleep | 23:00-07:00 (8 h) | 16 (≥ 7 h = no debt) |
| Steps | 7 000/d | 10 §4.14 selector midpoint |
| Activity intake answers (when asked but skipped) | work unknown (population mixture), 5 × 8 h, passive commute, steps unknown, day off "a bit of both", "some" time on feet at home, no recreation | R1 §3.5 (`DEFAULTS.activity`; §5.5) |
| RT set defaults | RIR 2, 70 %1RM, 120 s rest, 2.5 min/set | 09 §4.1, §4.13 |
| Cardio intensity when omitted | walk 0.475, run 0.775, cycle/swim/row/other 0.625, HIIT 0.875 of VO2max | 10 §4.8 MEM band midpoints (DERIVED) |
| Alcohol | 14 g per drink | 15 §4.10 |
| Fast electrolytes | on | 17 §4.3.3; 20 §4.12 |
| Menopause status (women, not entered) | < 50 y pre; 50-53 y peri; ≥ 54 y post | 16 §4.7 (SWAN FMP 52.2 y) |
| Habitual alcohol | `habitualAlcoholDrinksPerWeek`/7 drinks daily with the last meal in the burn-in template (inside TDEE0) | 15 §4.10 |
| Adherence levers, sauna, CWI, smoker | none / 0 / false / false | 21 §4G, X7; 16 §4.2.1 |

### 5.4 Compiled forms
`CompiledSchedule {nDays, startDate, startWeekday, days: DayInput[], fastSpans, notes}` (numbers only, day-resolved
grams incl. `exerciseCarbG`, meals, sessions, zero-intake mask; per day the R-MAINT reference `maintenanceKcal`,
`activityAdjKcal`, `activityDeltaKcal`, `plannedBalanceKcal`; `habitualTraining` when the day trains "as usual").
`compileSchedule(schedule, profile, {activityReference?})`
(default true; the habitual week is compiled without it). `HourInput` (per hour: meal macros as ingested,
caffeine, ketones, exercise minutes/intensity/modality/MET, `exCarbG` = carbohydrate eaten during exercise this hour — not
included in the meal fields `kcal/carbG/glucoseEqG/mealStart`; total energy ingested this hour = `kcal + 4·exCarbG` —
RT sets by region, steps, asleep fraction, planned-fast flag). The habitual week for burn-in is
`habitualWeek(profile)` (§3.4). The compiler is
pure and deterministic; runtime ('current'/'blockStart') days are re-resolved by the loop each run (§3.3).


### 5.5 Activity intake (`src/engine/intake/activity`; research R1 = plan/01-after-launch/research/R1-activity-intake.md)
**Input.** `HabitProfile.activity?: ActivityIntake` — R1's eight questions as concrete time budgets and counts, every one
skippable: `work` (desk / mixed / onFeet / manualModerate / manualHeavy / notWorking / unknown), `workDaysPerWeek` (0-7,
default 5; 0 when not working), `workHoursPerDay` (2-14, default 8), `commute {mode none/passive/walk/cycle/mixed,
activeMinPerWorkday}`, `steps {source wrist/phone/estimate/unknown, workday?, offDay?, weeklyMean?, daysOfHistory?,
phoneCarried?}`, `offDay` (mostlyHome / mixed / outAndAbout), `onFeetAtHome` (little / some / aLot), `recreation[]
{label, intensity light/moderate/vigorous, minPerWeek}` (sport that is NOT planned training). Sleep is not asked here: TEE
is unchanged by sleep duration (dossier 16 §4); bed/wake stay the habits' timing inputs. Absent intake = the pre-intake
engine bit for bit.

**Mapping (R1 §3.1; `resolveProfile` once per profile, closed form, no engine run).**
```
S_hab  = (d_w·S_w + (7 − d_w)·S_o)/7      device/rough number > the old steps tick > derived: S_w = S_class(work) + 105·walk_min,
                                           S_o = S_off(offDay); work unknown → S_w = 7 000 (skip-all S_hab = 7 000)
E_occ  = BW·h_work·e_occ·d_w/7            e_occ kcal·kg⁻¹·h⁻¹: desk 0, mixed 0.40, onFeet 0.5, manual moderate 1.0, heavy 2.0;
                                           unknown = prior mixture (shares .45/.25/.20/.08/.02 → mean 0.32, SD 0.41)
E_home = BW·{0.5, 1.5, 3 h}·0.5;  E_cyc = BW·(6.8 − 1)·cyc_min/60·d_w/7;  E_rec = BW·Σ(MET − 1)·min/60/7, MET 3.5/5/8
TDEE0  = (RMR0·1.15 + 0.44/1000·BW·S_hab + EAT0 + E_occ + E_home + E_cyc + E_rec)/(1 − α0)   (α0 by the macro fixed point)
PAL0   = TDEE0/RMR0: palFlag 'high' above 2.4 (FAO); the non-step terms are scaled down (not below 0) so that they never
         push PAL0 above 2.5 (NASEM top), palFlag 'capped'; sessions (EAT0) and steps are never capped
```
`habits.typicalSteps` := S_hab (the activity module's `habSteps`, the compiler's default day steps, the planner's step
baseline). E_occ, E_home, E_cyc, E_rec live in energy's NEAT0 = TDEE0 − RMR0 − TEF0 − EAT0 (§1.5 init; the §3.4 burn-in
calibration re-anchors NEAT0 on the realised habitual intake, so they stay), scale with BW/BW0 and adapt through AT_N.
R-MAINT (§5.2) books only sessions and steps above S_hab, so a plan that does not schedule work, chores, commute or
hobbies assumes the person keeps living their life; the habitual week books exactly zero. Activity (§1.2): with an intake
the Jackson PA-R comes from the 10 §4.14 selector row nearest to PAL0 instead of the steps row.

**Band (R1 §3.4).** σ² = (cv_RMR·1.15·RMR0)² + (kStep·BW·S_hab)²(cv_steps² + 0.10²) + (BW·h_work·d_w/7·sd_occ)² +
(0.6·E_home)² + (0.5·E_rec)² + (0.3·E_cyc)² + (0.2·EAT0)²; cv_RMR 0.10 (0.05 measured); cv_steps wrist 0.10, phone 0.25
(0.35 not carried), rough or derived 0.40; sd_occ = (high − low)/3.92 of the class coefficient. σ_TDEE0 = max(√σ²/(1 − α0),
floor·TDEE0), floor = min(route cv0 of 02 §4.12 — 0.12 equation / 0.10 BF measured / 0.08 RMR measured, intake 0.10 answered
/ 0.12 skipped); p10/p90 = TDEE0 ∓ 1.2816σ. "Answered" = a work class or a step number given.

**Output (`ResolvedProfile.activity: ResolvedActivity`, additive).** `steps`, workday/off-day steps, step source and cv;
resolved answers; `stepsKcal`, `occupationalKcal`, `homeKcal`, `commuteKcal` (cycling + a derived walking commute's step
energy), `recreationKcal`, `nonStepKcal`, `metHoursPerDay` = (steps + non-step energy)/BW; `neatKcal` (= NEAT0 before
calibration), `pal0`, `neatLevel` (NASEM category: < 1.53 inactive, < 1.68 low active, < 1.85 active, else very active),
`palFlag`; `tdee0Kcal`; `uncertainty {sigmaKcal, relSigma, p10, p90, floor, floorApplied, largest}`; `drivers[]` in R1 §6
order (rmr, dailyLiving, steps, work, home, commute, recreation, training, digestion; kcal and σ each, Σ kcal = TDEE0);
`base` (BW, RMR0, EAT0, α0, RMR route, steps tick) so the UI's live what-if is `resolveActivity(changedIntake, base)`
(α0 held; < 0.1 % from a full re-resolve). Every coefficient is a ParamDef `activityIntake.*` (value, range, grade,
source, R1 §, status) in `intake/activity/params.ts`; they are profile-time constants outside the ensemble registry.

**Validation (§9.2 rows `R1-*`, `validation/scenarios/activityIntake.ts`).** V1 FAO/WHO lifestyle PAL bands (R1 §3.3
archetypes, both reference people), V2 NASEM 2023 category equations ± 1 SE, V3 skip-all PAL of 20 synthetic adults
1.50-1.65, V4 IAEA DLW 95 % PI (200 cases) and the skip-all bias (Q), V5 standing, V6 step cost, V7 Cambridge index
spacing, V8 occupational trend, V9 postal workers, V10 PAL warn/cap, V11 zero R-MAINT adjustment and O-12 no-drift with any
answers, V12 band floors and Δσ from wrist steps, V13 sleep neutrality, and the end-to-end desk vs manual steady state
(engine TEE difference 0.5-1.0 × RMR0 heavy, 0.3-0.6 trades; weight-stable). Registered misses (owner `activityIntake`):
desk-little and on-feet archetypes and the lightest skip-all adult sit 0.01-0.02 PAL below their bands because R1's
arithmetic used α0 = 0.10 where the engine's habitual TEF is ≈ 0.087 (cause dossier); the mixed job used to miss 1.6-1.7
(R1 1.58, engine 1.556 at e_occ 0.25); I1 raised e_occ mixed to 0.40 (proposed fit inside R1's C-grade 0.10-0.45 range;
0.33 reached only 1.58), which closes that miss; it stays an open calibration (no DLW study by occupation class).

**Open (R1 open questions).** Weekday profile of NEAT (weekly mean now); occupation coefficients are C/D composites (no
DLW study by class); prior job shares are US-flavoured; recreation that a wrist device also counts as steps is not
de-duplicated (R1 is silent; the band carries it); recreational minutes do not yet feed the VO2max dose (adding them to
`memHabWk` alone would detrain them in every plan, because plans do not schedule recreation); users without an intake keep
7 000 steps until they answer (silent migration is a product decision, R1 open question 7).

---

## 6. Metric catalogue (code: `types/metrics.ts` `SERIES`; 55 metrics + 25 detail + 13 input series; the table below is generated from `SERIES`)

Columns: resolution/daily aggregation (h = hourly series aggregated to daily; d = daily), direction of good, goal
eligibility (18 §4.5 kinds; "none" with reason), grade, band method (§8; `draws` / fallback), presentation (orchestrator
ruling: blood markers and hormones as change from the user's baseline), reference lines, caveat (ASI = 08 mandatory
statement; marker = "model trends for an average person, not lab predictions"; index = "relative model index"),
source. `leanMass` (DXA-equivalent: includes glycogen, water, gut contents; owner water) and `leanTissue` (protein-based
tissue; owner composition; the goal-eligible one) are distinct metrics (INTEGRATION "DXA-lean vs protein tissue").

| # | id | Label | Unit | Category | Owner | Res/agg | Dir | Goal | Grade | Band | Presentation | Ref lines | Caveat | Source |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `scaleWeight` | Scale weight | kg | body | water | h/wake | target | target | A | draws / fixChange:35 | absolute |  |  | 13 §4.1, 01 §4.2 |
| 2 | `fatMass` | Fat mass | kg | body | composition | d/end | down | target | A | draws / fixChange:35 | absolute |  |  | 01 §4.1-4.3, 03 §4.4, 11 §4.15 |
| 3 | `leanMass` | Lean mass (DXA-equivalent) | kg | body | water | h/wake | up | none (includes glycogen, water and gut contents; use leanTissue as the goal) | A | draws / fixChange:50 | absolute |  |  | 20 §4.5.3, 13 §4.1, 14 M5 |
| 4 | `leanTissue` | Lean tissue (protein-based) | kg | body | composition | d/end | up | maximise (muscle/organ tissue without glycogen and water swings) | B | draws / fixChange:50 | absolute |  |  | 01 §4.2, 03 §4.4/4.19, 09 §4.8-4.10, 20 §4.4 |
| 5 | `skeletalMuscle` | Skeletal muscle | kg | body | composition | d/end | up | maximise | C | draws / fixChange:64 | absolute |  |  | 03 §4.19 step 7, 09 §4.9 |
| 6 | `bodyFatPct` | Body fat | % | body | water | h/wake | down | target | A | draws / fixChange:35 | absolute |  |  | 14 M1, 01 |
| 7 | `waist` | Waist | cm | body | composition | d/end | down | target | B | draws / fixChange:35 | absolute |  |  | 14 M7-M8 |
| 8 | `visceralFat` | Visceral fat | kg | body | composition | d/end | down | minimise | B | draws / fixChange:50 | absolute |  |  | 14 M6-M7, 06 §4.10 |
| 9 | `glycogenTotal` | Glycogen (total) | g | fuel | fuel | h/end | context | target (performance goals only) | B | draws / fixValue:30 | absolute |  |  | 04 §4.1-4.10 |
| 10 | `liverGlycogen` | Liver glycogen | g | fuel | fuel | h/end | context | none (display; drives ketosis) | B | draws / fixValue:30 | absolute |  |  | 04 §4.2, §4.8 |
| 11 | `muscleGlycogen` | Muscle glycogen | g | fuel | fuel | h/end | context | maximise (performance goals only) | B | draws / fixValue:30 | absolute |  |  | 04 §4.4-4.7 |
| 12 | `bhb` | Blood ketones (BHB) | mmol/L | fuel | ketones | h/mean | target | target | B | draws / fixValue:30 | absolute | 0.5, 3 |  | 05 §4.1-4.5, §4.17 |
| 13 | `ketosisState` | Ketosis state | state | fuel | ketones | h/max | context | none (use hoursInKetosis as the goal) | A | none | state |  |  | 05 §6 (0 none <0.2, 1 light, 2 nutritional 0.5-3, 3 fasting, 4 warning) |
| 14 | `hoursInKetosis` | Hours in ketosis | h/d | fuel | ketones | d/end | target | maximise | B | draws / fixValue:30 | absolute |  |  | 05 §6 |
| 15 | `ketoAdaptation` | Keto-adaptation index | % | fuel | ketones | d/end | context | maximise | C | draws | index |  |  | 05 §4.11 combined index 50·(A_f + A_s), equal weights PROPOSED (release check 2026-10-01; was 100·A_f); components `ketoAdaptFast`, `ketoAdaptSlow` |
| 16 | `fatOxidation` | Fat oxidation | g/d | fuel | fuel | d/end | context | none (fat balance, not oxidation, sets fat loss (04 §4.15)) | B | draws | absolute |  |  | 04 §4.10-4.12 |
| 17 | `glucose` | Blood glucose | mmol/L | fuel | intake | h/mean | down | minimise | C | draws | deltaFromBaseline |  | marker | 04 §4.16 |
| 18 | `tdee` | Energy expenditure (TDEE) | kcal/d | energy | energy | h/sum | context | maximise (preserve expenditure) | A | draws / fixValue:26 | absolute |  |  | 02 §4.13 |
| 19 | `rmr` | Resting metabolic rate | kcal/d | energy | energy | h/sum | up | maximise | A | draws / fixValue:13 | absolute |  |  | 02 §4.1-4.3 |
| 20 | `neat` | Non-exercise movement | kcal/d | energy | energy | h/sum | up | none (follows steps and adaptation) | B | draws | absolute |  |  | 02 §4.6, 10 §4.13 |
| 21 | `metabolicAdaptation` | Metabolic adaptation | kcal/d | energy | energy | d/end | up | maximise (closer to 0 is better) | B | draws | absolute |  |  | 02 §4.8 (AT_R + AT_N) |
| 22 | `energyBalance` | Energy balance | kcal/d | energy | energy | h/sum | target | none (an input consequence) | A | draws | absolute |  |  | 01, 02 |
| 23 | `maintenance` | Maintenance energy | kcal/d | energy | energy | d/end | context | none (reference line) | B | draws / fixValue:26 | absolute |  |  | 02 §4.13 EI_inst |
| 24 | `autophagyIdx` | Autophagy signal | index | cellular | cellular | h/mean | context | maximise (never traded against grade A/B goals (08 §4.15)) | D | draws | index |  | ASI | 08 §4.10 |
| 25 | `mtorIdx` | mTOR activity | index | cellular | cellular | h/mean | context | none (advanced signalling view) | C | draws | index |  | index | 08 §4.11 |
| 26 | `ampkIdx` | AMPK activity | index | cellular | cellular | h/mean | context | none (advanced signalling view) | C | draws | index |  | index | 08 §4.6 |
| 27 | `mps` | Muscle protein synthesis | % of reference | cellular | muscle | h/mean | up | none (acute MPS does not predict growth (09 §4.4)) | C | draws | index |  | index | 03 §4.7, 09 §4.4 |
| 28 | `igf1` | IGF-1 | rel | cellular | hormones | d/end | target | target (U-shaped; user-chosen direction (08 §4.16)) | B | draws | deltaFromBaseline |  | marker | 08 §4.12 |
| 29 | `hunger` | Hunger pressure | index | hormones | appetite | d/end | down | minimise | C | draws | index |  | index | 12 §4.9 |
| 30 | `leptin` | Leptin | rel | hormones | hormones | d/end | up | none (constraint/guard only) | B | draws | deltaFromBaseline |  | marker | 12 §4.1 |
| 31 | `t3` | Thyroid (T3) | rel | hormones | hormones | d/end | up | none (guard only) | B | draws | deltaFromBaseline |  | marker | 12 §4.3 |
| 32 | `cortisol` | Cortisol | rel | hormones | hormones | d/end | down | none | C | draws | deltaFromBaseline |  | marker | 12 §4.4 |
| 33 | `testosterone` | Testosterone [male] | rel | hormones | hormones | d/end | up | none (guard only) | B | draws | deltaFromBaseline |  | marker | 12 §4.5 |
| 34 | `menstrualRisk` | Menstrual disturbance risk [female] | %/cycle | hormones | hormones | d/end | down | none (constraint for women (19 §4.9)) | B | draws | absolute |  |  | 19 §4.9 P_LPD (12 §4.6 R_MD = registered alternative, MODEL_SPEC R-MENS) |
| 35 | `adherence` | Plan adherence probability | % | hormones | appetite | d/end | up | maximise (planner ranks outcome × P_surv) | D | draws | absolute |  | index | 12 §4.10 |
| 36 | `insulinSensitivity` | Insulin sensitivity | rel | cardio | cardiometabolic | d/end | up | maximise | B | draws | deltaFromBaseline |  | marker | 04 §4.18 (S_I = S_hep^0.4·S_mus^0.6) |
| 37 | `ldl` | LDL cholesterol | mmol/L | cardio | cardiometabolic | d/end | down | minimise | A | draws | deltaFromBaseline |  | marker | 06 §4.2-4.4, §4.7 |
| 38 | `apoB` | ApoB | g/L | cardio | cardiometabolic | d/end | down | minimise | A | draws | deltaFromBaseline |  | marker | 06 §4.2 |
| 39 | `hdl` | HDL cholesterol | mmol/L | cardio | cardiometabolic | d/end | context | none (weak causal target (06 §4.6)) | A | draws | deltaFromBaseline |  | marker | 06 §4.6-4.7 |
| 40 | `triglycerides` | Triglycerides | mmol/L | cardio | cardiometabolic | d/end | down | minimise | A | draws | deltaFromBaseline |  | marker | 06 §4.5 |
| 41 | `sbp` | Blood pressure (systolic) | mmHg | cardio | cardiometabolic | d/end | down | minimise | A | draws | deltaFromBaseline |  | marker | 06 §4.8 |
| 42 | `liverFat` | Liver fat | % | cardio | cardiometabolic | d/end | down | minimise | B | draws | deltaFromBaseline |  | marker | 06 §4.9, 11 §4.9 |
| 43 | `fastingGlucose` | Fasting glucose | mmol/L | cardio | cardiometabolic | d/end | down | minimise | B | draws | deltaFromBaseline |  | marker | 04 §4.16, 06 §4.11 |
| 44 | `crp` | hs-CRP | rel | cardio | cardiometabolic | d/end | down | minimise | B | draws | deltaFromBaseline |  | marker | 06 §4.12 |
| 45 | `vo2max` | VO₂max | mL/kg/min | performance | activity | d/end | up | maximise | A | draws | absolute |  |  | 10 §4.8 |
| 46 | `strength` | Strength index | % of baseline | performance | muscle | d/end | up | maximise | B | draws | index |  |  | 09 §4.14 × 19 §4.3 M_EA |
| 47 | `trainingStatus` | Training status | % of potential | performance | muscle | d/end | up | none | C | draws | index |  |  | 09 §4.6 |
| 48 | `enduranceCapacity` | Endurance capacity | % of baseline | performance | wellbeing | d/end | up | maximise | B | draws | index |  |  | 19 §4.4 |
| 49 | `rtMuscleGain` | Training-attributable lean | kg | performance | muscle | d/end | up | maximise | C | draws / fixChange:64 | absolute |  |  | 09 §4.9 (Σ M_acc,r) |
| 50 | `sleepQuality` | Sleep quality | index | recovery | moderators | d/end | up | none | C | draws | index |  | index | 16 §4.2, 19 §4.10 |
| 51 | `moodTier` | Mood & energy | tier | recovery | wellbeing | d/end | down | none (guard only; never a cognition score) | C | none | state |  |  | 19 §4.5 (0 green, 1 amber, 2 red) |
| 52 | `energyAvailability` | Energy availability | kcal/kg FFM/d | recovery | wellbeing | d/end | up | none (hard floor 30 (17 HC-E4)) | B | draws | absolute | 30, 45 |  | 19 §4.1, 17 §2.1 |
| 53 | `hipBmdChange` | Hip bone density change | % | recovery | wellbeing | d/end | up | none (constraint (≥ −1 %)) | B | draws | absolute |  |  | 19 §4.2 |
| 54 | `ketoInduction` | Keto-induction symptoms | 0–1 | recovery | wellbeing | d/end | down | minimise | C | draws | index |  |  | 13 §4.10 |
| 55 | `micronutrientScore` | Micronutrient completeness | score | recovery | wellbeing | d/end | up | maximise | D | none | index |  | other | 15 §4.9 |

Detail series added at integration (2026-09-30, requested by the results view; all `kind: 'detail'`): `atResting`, `atNonResting`
(energy, daily AT_R / AT_N), `fatTrunk`, `fatArms`, `fatLegs` and `muscleArms`, `muscleLegs`, `muscleTrunk` (composition's
regional depots — regional skeletal-muscle mass is the closest modelled quantity to "muscle thickness"; recording any of
them turns the daily `allocateRegional` on), and two **signal mirrors** recorded by the core from the owner's published
bus signal (`types/metrics.SIGNAL_MIRRORS`: `totalKetones` ← ketones' `tkbMmolL`, hourly mean; `dietFatigue` ← appetite's
`dietFatigue`, daily). A 24-h respiratory quotient needs VO2/VCO2 sums fuel does not publish (open request to A2).
Keto-adaptation components (release check 2026-10-01; recorded by ketones, daily, % index, `kind: 'detail'`):
`ketoAdaptFast` "Fat-oxidation adaptation (fast)" = 100·A_f (05 §4.11.1, B) and `ketoAdaptSlow` "Ketone-kinetics
adaptation (slow)" = 100·A_s (05 §4.11.2, C); the metric `ketoAdaptation` is their mean.
Detail series (charts' decomposition layers, not goal-eligible): `tef`, `exerciseEE`, `insulin`, `glycogenWater`,
`ecfShift`, `gutContent`, `choOxidation`, `dnl`, `nitrogenBalance`, `uricAcid`, `waterWeight`, `fastProteinCost`,
`hoursFasted`. Input echo series (owner core, `core/loop.recordInputs`): `inEnergy`, `inEnergyPctMaint` (vs the day's
R-MAINT reference), `inMaintRef` (the reference, kcal/d; added final round), `inBalancePlanned` (energy − reference,
kcal/d; added final round), `inProtein`, `inCarbs`, `inFat`, `inFibre`, `inAlcohol`, `inSteps`, `inRtSets`, `inCardioMin`,
`inSleep`.
Sex-gated metrics (`testosterone` male, `menstrualRisk` female) are NaN for the other sex and for unspecified sex.
Recording: hourly series are stored hourly only with `record:'full'`; the daily value follows `agg`; `RunOptions.series`
restricts recording (planner: goal + constraint series only).

---

## 7. Events and warnings

### 7.1 Events (`types/events.ts`; emitted through `ctx.events.emit(type, hourIndex, value)`, preallocated buffer)
| Event | Condition | Emitter |
|---|---|---|
| ketosisEntered / ketosisExited | BHB ↑ through 0.5 / ↓ below 0.4 after ≥ 0.5 | ketones |
| deepKetosis | BHB ≥ 3.0 with no intake in 24 h | ketones |
| ketoneAlert | BHB > 3.0 while eating or > 6.0 | ketones |
| ketoAdapted | A_f crosses 0.9 upward | ketones |
| glycogenLow / glycogenFull | total glycogen < 30 % / ≥ 95 % of capacity | fuel |
| liverGlycogenLow | G_L < 20 g (04 §4.2) | fuel |
| metabolicSwitch | 07 §4.3 `Sw = 1/(1 + (G_L/30 g)^4)` crosses 0.5 | fuel |
| fastStart / fastEnd | planned zero-intake span starts / ends | fasting |
| waterRebound | scale +≥ 0.5 kg within 3 d while fat mass falls | water |
| weightPlateau | 7-d mean scale weight moves < 0.1 kg over 14 d while EB7 < −200 kcal/d | water |
| detrainingOnset | 09 λ > 0 for the largest trained region | muscle |
| supercompensation | muscle glycogen > 1.3 × fed reference (stays ≤ 5 d, ≈ −5 %/d) | fuel |
| safetyFlag | first day of a caution/danger warning run | safety |

### 7.2 Warning rules (17 §3, evaluated by `safety` on the modelled trajectory; messages verbatim from 17 §3)
Quantities: `EI7, deficitPct7, ea7, rate14KgPerWk/PctPerWk, cumLossPct, bmi, bodyFatPct, fastHMax, fastH7,
proteinGPerKgRw, fatPctEnergy` (SafetyTrace), day inputs, profile flags. "BFfloor" = 10 % M / 18 % F; "cap" / "cap_pct" per
17 §2.3. Severity per 17. Rules marked † in 17 are PROPOSED thresholds.
**Day attribution of a warning run (coordinator ruling, blocker round 2026-10-01).** A run's reported days are the days whose
own inputs/state triggered it, not the day the rule was evaluated. Rolling-window rules (W-E01, W-E03/W-E04, W-13-ALPERT,
W-M01…W-M06, W-M18, W-S03 on the 7-day means; W-E05/W-E06 and W-S01 on the 14-day — 28-day near a fast — tissue trend): when
the rule fires on day d, every day of the window (day ≥ 0) whose own value is on the triggering side is hit (own intake below
the floor, own deficit/surplus, own protein or fat beyond the limit, own alcohol, own daily tissue loss above the day's
cap), with the window's value (worst kept); trend rules fall back to day d when no single day exceeds. The means themselves
are unchanged — they include the habitual burn-in days before day 0, which is literally "averaged over the last 7 days" and
keeps the Planner's margins (same trace) at least as strict as the Simulator (R-PLAN-SAFETY) — so a block from day 0 is
reported from day 0 once the mean crosses, and a block ends on its own last day (a 14-day 45 %E protein block read days
5-15, now 0-13; a deficit from day 0 read from day 4-6). Pairs are exclusive per day after attribution (W-E04 over W-E03,
W-E06 over W-E05). Fast-related rules cover the fast's own days from its first zero-intake hour (was: the day the counter
passed 20 h), plus the stated aftermath: tiers W-F01…W-F05 and spacing W-F07 over the episode, W-F11/W-F10/W-20-FAST-LEAN
over every day of a fast whose meal-to-meal length is ≥ T3, W-F06 over every day of a fast ≥ 48 h with planned hours
without electrolytes, W-F08 on the day the fast ends; a 120-h fast on days 7-12 with its refeed now reports W-E05 on days
8-14 (was 18-28). Golden tests: `model/safety/warningDays.test.ts`.
| IDs | Engine condition (per day) |
|---|---|
| W-E01 / W-E02 | 800 ≤ EI7 < floor (1200 F / 1500 M) / EI7 < 800 for ≥ 3 days and no fast ≥ T1 active |
| W-E03 / W-E04 | cap < deficitPct7 ≤ 40 / deficitPct7 > 40 — on days that are themselves in deficit (EI_day < 0.95·TDEE_est; final round: a 100 % day after deficit days carried the 7-day mean); text "Averaged over the last 7 days, …" and "(training included)" (R-MAINT) |
| W-E05 / W-E06 | cap_pct < rate14PctPerWk and rate14KgPerWk ≤ 1.5 / rate14KgPerWk > 1.5 |
| W-E07 / W-E08 / W-E09 / W-E20 | 30 ≤ ea7 < 35 for > 14 d / ea7 < 30 / 35 ≤ ea7 < 45 / ea7 < 30 for > 14 d — every EA rule (also the EA legs of W-E18/W-E19) needs session exercise in the trailing 7 d (HC-E4) **and** a deficit (deficitPct7 > 5 %; `safety.eaNeedsDeficit`, integration 2026-09-30: at balance EA is the habitual level, 30-45 in recreational exercisers) |
| W-E10 / W-E19 | deficitPct7 ≥ 15 for > 84 consecutive days / ≥ 15 for > 182 d or ea7 < 45 for > 84 d |
| W-E11 / W-E12 | cumLossPct > 20 / > 24 |
| W-E13 / W-E14 | 18.5 ≤ bmi < 20 and tissue loss > 1 % of the start weight ("this plan takes your BMI to …") / bmi < 18.5; bmi = projected BMI from tissue mass |
| W-E15 / W-E16 | bodyFatPct < 12 M / 20 F / < 8 M / 15 F |
| W-E17 / W-E18 | rate14PctPerWk ≥ 0.75 for ≥ 56 d / female and (ea7 < 45 for ≥ 28 d or bodyFatPct < 20) |
| W-M01 … W-M05 | protein vs RW / %E / g/kg FFM / CKD flag per 17 thresholds (proteinGPerKgRw, day input) |
| W-M06 / W-M07 | fat < 15 %E or < 30 g with EI ≥ 800 / fat < 10 g for ≥ 7 d |
| W-M08 / W-M09 / W-M10 / W-M24 | net carbs < 50 g (info) / for ≥ 28 d / plus contraindication flag / plus stone flag or fluid < 2.5 L |
| W-M11 … W-M17 | fibre < 14 g/1000 kcal > 28 d **while in a deficit or with an entered habitual fibre** ("low fibre with low intake"); sodium < 1.5 g while fasting or < 50 g carbs; sodium > 2.3 g > 28 d **when entered or raised above the habitual level** (the population default alone is quiet); fluid < 1.5 or > 4 L or > 1 L/h; supplemental K > 1 g; Mg > 350 mg |
| W-M18 … W-M23 | alcohol > 14 units/wk; alcohol on fast ≥ T2 / < 800-kcal day / within 24 h of T3+; > 2 drinks per occasion; caffeine > 400 mg/d or > 200 mg/dose; ≥ 100 mg within 6 h of bed; creatine > 5 g or loading > 7 d |
| W-F01 … W-F05 | fast length in tier T1 (20-24 h) / T2 (24-48) / T3 (48-72) / T4 (72-168) / T5 (> 168); length and peak value = the planned span's **meal-to-meal** duration (`fastSpans[i].mealToMealH`, the unit of `FastEvent.durationH`) when the zero-intake episode holds a planned span, else the `fast_h` counter (release check 2026-10-01: the counter is whole zero-intake hours, one less for whole-hour meals — a "72 h" fast read "a 71 h fast" and missed W-F08; also the episode length of the fast log, W-F07/W-F13, W-F08, W-F10, W-F11) |
| W-F06 / W-F08 | fast ≥ 48 h without electrolytes / fast ≥ 72 h with `refeed:'none'` |
| W-F07 / W-F13 | HC-F2 spacing violated / ≥ 3 fasts ≥ T2 that **started** in the trailing 14 d (final round: counting by end put three weekly 36-h fasts in one window) or **fastH7Cap** > 108 — R-T4CAP: the cumulative cap counts fasts of tiers T1-T3; a single T4 fast (72-168 h) is governed by its own tier rule (W-F04, W-F07 spacing ≥ 28 d, ≤ 1 per 12 wk, W-F08 refeed); `SafetyTrace.fastH7Cap` |
| W-F09 / W-F10 / W-F11 | session with intensity ≥ 0.85 or RT to failure during a fast ≥ 24 h / fast ≥ T3 and bmi < 25 / fast ≥ T3 |
| W-F12 / W-F14 | ≥ 3 consecutive days EI < 800 with protein ≥ 30 %E / eating window < 4 h or one meal |
| W-X01 … W-X05 | exercise progression and flags per 17 (weekly run distance, RT sets, rest days, hot climate, PAR-Q) |
| W-S01 / W-S02 / W-S03 | gain rate > 0.5 %BW/wk (−rate14) / EI > 1.2·TDEE for > 84 d / waist or WHtR threshold with deficitPct7 < −5 % — with a fast-event day in the trailing 28 d the W-S02/W-S03 surplus must also hold over 28 days (`SafetyTrace.deficitPct28` < −5 %; final round: eating at maintenance after a fast read as a 7-day "surplus" against the post-fast TDEE) |
| W-P01 … W-P07 | profile flags (pregnancy, R1, diabetes medication, organ, gout/stone/gallstone, medication) × regime conditions |
| W-U01 … W-U05 | day-0 header notes: always / out-of-range **entered** inputs (BMI > 45, age > 70) or EI < 500 for > 7 d / slider body fat (only when sliders were used) / marker shown / ASI shown |
| W-13-ALPERT | 7-d deficit > 0.75·69 kcal per kg FM per day (13; caution; engine-specific), on deficit days as W-E03; text "Averaged over the last 7 days …" |
| W-05-KETO-FED | BHB > 3.0 with food intake (05 §9; danger) — only absorptive hours outside the fasting regime count (`fedState` = 1, `fastActive` = 0; final round: fasting and zero-intake hours are never "eating", also above 6 mM); in the refeed meals of the 24 h after a fast > T0 only BHB > 6.0 counts |
| W-20-FAST-LEAN | fast ≥ T3 and bodyFatPct < BFfloor + 6 (20 §9: lean users lose 1.5-2.5× more protein; caution) |
| W-01-FATFLOOR | `fatFloorActive` > 0 on any hour of the day (composition's smooth fat floor, R-FATFLOOR; danger) |
**Fast-event days (orchestrator ruling 2026-09-30 18:10; PROPOSED, grade D; `safety.fastDayMinHours` 12 h,
`safety.fastRuleWindowD` 28 d).** A calendar day with ≥ 12 h inside a planned zero-intake span longer than T0 (meal to meal,
`fastSpans[i].mealToMealH`), and each graded-refeed day of such a fast, is a *fast-event day*; it is governed by the
fasting-tier rules (W-F01…W-F13: tier, spacing, refeed, cumulative fasting) — the fast shows its tier warning instead of
W-E04. W-E01…W-E04, W-13-ALPERT and the 7-day protein/fat/fibre rules use the **non-fast** days of their 7-day window and are
not evaluated on fast-event days (the deficit-block counters pause). With a fast-event day in the trailing 28 d, the HC-E1
kcal floors also apply to the 28-day mean intake (W-E01/W-E02 on min(EI_7 non-fast, EI_28)) and the loss rate (W-E05/E06,
W-E17, W-S01) is the OLS slope of **tissue mass** over 28 d. Other rules are unchanged: W-F08 (≥ 72 h fast without a
refeed ramp) never fires for a planned refeed (`refeed` on the span) and otherwise checks the first eating day's intake;
W-M19 covers alcohol in the 24 h after **or before** a planned T3+ fast; W-05-KETO-FED ignores the refeed meals of the first
24 h after a fast longer than T0 (05 §9: starvation ketosis) unless BHB > 6.
**Energy availability `ea7` with a fast in the window (ruling R-FAST-GATE item 1, 2026-10-01; `safety.eaSampleMin` −5 /
`safety.eaSampleMax` 70 kcal/kg FFM/d, grade C).** When a fast-event day lies in the trailing 7 d, `ea7` (HC-E4, W-E07 /
W-E08 / W-E09 / W-E20, the EA legs of W-E18 / W-E19 and the planner's EA floor) is the mean daily EA = (EI − EEE)/FFM of the
**last seven non-fast days, searched back through the 28-day window** (each daily sample clipped to [`eaSampleMin`,
`eaSampleMax`]); on a fast-event day it is not evaluated (NaN), and the EA persistence counters (W-E07/W-E20 > 14 d,
W-E18/W-E19) pause on fast days instead of restarting. Weeks without a fast keep wellbeing's trailing 7-day EA_7 bit for bit.
The HC-E1 kcal floor is unchanged (min(EI_7 non-fast, EI_28)), so a fast cannot dodge the energy floor, and a fast never hides
low EA on the eating days. Deviation from PLANNER_V2_SPEC §3.2 (N7 when the week has ≥ 4 non-fast days, else N28), recorded by
E2: seven non-fast days keep the week's training/rest mix; after a 72-h fast and its refeed the calendar week holds 3-4
mostly-training eating days, which biased EA low.
Warnings are merged into day ranges (gap ≤ 1 day closes a run), with `peakValue` = worst driving value. A run of W-E03, W-E05 or W-13-ALPERT whose worst value renders equal to its printed limit ("734 kcal/day … above about 734 kcal/day") is within rounding of the limit and is dropped (final round; the rules compare unrounded values). One `safetyFlag`
event is emitted per first day of caution/danger runs (value 2 if any run starting that day is danger, else 1). A `danger`
warning requires acknowledgement before results render (17 §3; UI concern).

### 7.3 Hard constraints (17 §2.2) — who evaluates what
Profile-window constraints (HC-P*, HC-X4, HC-M10) are applied by the app gate and the planner's lever tiers; input-space
constraints (HC-E2, HC-M1…M12, HC-F1…F5, HC-X1…X3, HC-X5) by the planner `repair` on the decoded Schedule (logged as
repair entries); **state-space constraints evaluated on the simulated trajectory** (HC-E1 on `ei7` for runtime days,
HC-E3 `deficitPct7`, HC-E4 `ea7`, HC-E5 `rate14`, HC-E6 `cumLossPct`, HC-E7 block length, HC-E8 surplus/gain, HC-P4
projected BMI, HC-P5 projected BF%) become normalised margins `m = (bound − value)/scale` (≥ 0 satisfied; scale = the
bound's natural unit: 100 kcal, 5 %, 5 kcal/kg FFM, 0.25 %BW/wk, 5 %, 1 BMI unit, 2 % BF) — minimum over days for each
constraint. HC-F2's cumulative leg uses `fastH7Cap` (R-T4CAP). HC-G1/G2 are planner logic.
**Warning margins (R-PLAN-SAFETY, final round):** with `RunOptions.constraints` the result also carries `warningMargins`
(`safety.computeWarningMargins`): one per caution/danger warning evaluated on the trajectory, at least as strict as the
rule (m ≥ 0 on every day ⇒ the warning does not fire): W-E01 (EI_floor − floor)/100 [W-E01, W-E02]; W-E03 (cap −
deficitPct7)/5 on every day [W-E03, W-E04]; W-E05 min((cap_pct − rate)/0.25, (1.5 kg − rate_kg)/0.25) [W-E05, W-E06];
W-E07 (EA7 − 35)/5 where EA applies (exercise + deficit) [W-E07, W-E08, W-E20] — the floor with its margin above 30;
W-E10 (84 − run of deficit ≥ 15 %)/7 [W-E10]; W-E11 (20 − cumLoss)/5 [W-E11, W-E12]; W-E13 (BMI − 20 after a > 1 % tissue
loss, else − 18.5) [W-E13, W-E14]; W-E15 (BF − 12 M / 20 F)/2 [W-E15, W-E16]; W-E18 women min((28 − run EA < 45)/7,
(BF − 20)/2); W-M01 (protein/RW − 0.8)/0.1; W-M06 min((fat %E − 15)/5, (fat g − 30)/10); W-S01 (0.5 + rate)/0.25; W-S03
high waist only (deficitPct7 + 5)/5; W-13-ALPERT (0.75·69·FM − deficit kcal)/100 on every day; W-20-FAST-LEAN on days with
a fast > 48 h (BF − floor − 6)/2; W-F13 (108 − fastH7Cap)/24. Not covered (input/profile side, the planner's repair and
tiers): other W-M*, fast tiers and spacing W-F01…W-F12/W-F14, W-X*, W-P*, W-U*; W-05-KETO-FED (BHB not in the trace);
W-01-FATFLOOR (guarded by W-E15). Fasting tiers (orchestrator ruling; 17 §4.3): ≤ 24 h `default`; 24-72 h
`optIn`; 3-7 d `optIn` with expert-mode attestation; > 7 d `never` for the planner — encoded as lever-registry data (§10.3).

---

## 8. Uncertainty

### 8.1 Parameter draws (the only source of randomness)
- Every `ParamDef` with `low < high` is a random input: triangular(low, value, high), or triangular in log space when
  `draw: 'logTri'` (multiplicative quantities spanning > ×3: 08 h50, 09 individual response `muscle.uIndividual`
  (1, [0.33, 3.0]: a symmetric log-triangular with the SD of 09 §4.16's LogNormal σ 0.45, P10-P90 ≈ 0.54-1.84 vs 09's 0.56-1.78), 06 heavy-tail response multipliers, 05 kP); `draw: 'uniform'`
  for latent quantiles a module maps itself; `draw: 'fixed'` for definitional constants.
- Sampling: Latin hypercube over all variable parameters (`core/paramsRegistry.sampleParams`, deterministic in seed),
  parameters independent. The only correlated block is 06 §4.17's biomarker residual matrix: cardiometabolic draws its
  10 z-scores from `N(0, C)` with a Cholesky factor computed in `prepare`, using 10 dedicated `draw: 'uniform'`
  parameters `cardiometabolic.u*` on [0, 1] (nominal 0.5 → z = 0) mapped through the inverse normal CDF, so the draw stays
  a pure function of the parameter vector.
- Person-level heterogeneity is a parameter like any other (09 u, 11 β⁺ individual spread inside its range, 06 z, 16
  salt sensitivity inside h_Na's range, 15 creatine non-responder = range, not a draw). **R-RMRDEV (2026-09-30):**
  `energy.rmrIndividualFrac` δ, triangular(−0.2, 0, 0.2) (SD 8.2 %, P10-P90 ±11 %; 02 §4.1 Mifflin RMSE ≈ 8 %, 16 §4.11
  adjusted RMR SD 8-10 %), is the individual's deviation from the RMR prediction equation. The core runs each draw with the
  person RMR0·(1 + δ) whose true habitual maintenance is TDEE0 + δ·RMR0 (burn-in and every module's `ctx.profile`), while
  the compiled schedule keeps the prescriptions made from the equation estimate — the ensemble therefore contains the
  spread that the maintenance-estimate error causes (the dominant real-world source of variation in fat loss at a
  prescribed intake). Nominal runs (δ = 0) are unchanged.
- Simulator: `simulateEnsemble(profile, schedule, options, {draws, seed})` → nominal + P10/P50/P90 per recorded series per
  day. Series presented as change from baseline (`presentation: 'deltaFromBaseline'`: blood markers, hormones) are banded on
  each member's change from its own t = 0 value, re-based on the nominal t = 0 value (integration fix: a pinned LDL showed
  −1.22…+0.90 mmol/L because the draws' different baselines were banded, not the change). Defaults: 32 draws desktop, 16 on phones (≤ 33 × 10 ms ≈ 0.35 s desktop in a worker), seed 1 (same inputs → same
  bands). Hourly bands are not produced (daily only).
- Planner: ensemble size M = 16 / 32 / 32 (tiers S/M/L, optim README); the coordinator draws the quantile LHS once per
  request (`latinHypercube(M, P, rng.fork('ensemble'))`, P = `variableParamCount(defs)`); the evaluator maps row m with
  `quantilesToParams(defs, U[m])` (cached per m) and passes it as `RunOptions.paramOverrides`; draw −1 = nominal.

### 8.2 Fallback bands (16 §4.11; R-BANDS)
When draws are off (quick preview, very slow devices) each metric uses its `bandFallback`: `fixChange:NN` = ±NN % of the
predicted change from t = 0 (fat 35, lean 50, hypertrophy 64, scale weight 35, waist 35, VAT 50), `fixValue:NN` = ±NN % of
the value (RMR 13, TDEE and maintenance 26, glycogen and BHB 30). Surplus fat gain uses ±36 % (11 §4.6) when the predicted
fat change is positive. `BandedResult.method` reports which method produced each band.

### 8.3 Band calibration and scope
Acceptance: for the reference scenarios of §9.3 (CALERIE-like 25 % CR, 12-wk RT novice, Bouchard overfeeding) the
ensemble P10-P90 half-width of Δfat, Δlean-tissue and ΔRMR must lie within 0.5×-1.5× of the 16 fallback percentages;
outside that range the owning module's `low/high` values are revisited (not the band). Bands do **not** include model-
structure error, adherence (reported separately by `adherence`), scale noise (UI may add ±0.35 %·BW, 13 §4.1), or
measurement error of inputs (17 W-U03 text).
**Finisher check (2026-09-30, 32 draws, seed 1, MAN, 12 weeks; `docs/VALIDATION_REPORT.md`).** Before R-RMRDEV the bands
collapsed (Δfat ±7 %, RMR ±3 %); with the person-level RMR deviation: 25 % deficit + RT — Δfat ±18 %, RMR ±9.4 %, TEE
±5.6 %, Δlean ≈ 0 (±0.57 kg absolute); 15 % surplus + RT — Δlean ±53 %, skeletal muscle ±54 %, RMR ±8.8 %; VLC + 72-h fast
— BHB ±33 %, RMR ±10.9 %. All three within 0.5×-1.5× of 16's fallbacks (fat ±35 → 17.5-52.5 %, lean ±50 → 25-75 %, RMR
±13 → 6.5-19.5 %); Δfat sits at the lower edge because adherence is not in the band. No `low/high` changed.

---

## 9. Validation suite

Location: `src/engine/validation/` (harness + scenario fixtures, WP-V). Levels: **U** = module unit test with the
module's inputs driven directly; **I** = full-engine scenario; **O** = oracle comparison. Gate: **M** = must pass in CI;
**K** = tracked known-miss (reported with its current error, listed in `validation/KNOWN_MISSES.md`; run as `it.fails`, so a
K row that enters its band turns the suite red until it is promoted to M). M rows that currently miss are registered in
`validation/knownMisses.ts` (owning module or 'scenario', class K = accepted or open = calibration item, cause — structure,
ruling, dossier conflict, calibration, mapping — measured value, target, reason; regenerated with `KNOWN_MISSES.md` from
the full run) and also run as `it.fails`; tolerances are never loosened; scenario inputs are corrected only from the study
report or the dossier, never to reach a target (the corrections of the finisher pass are listed in `docs/VALIDATION_REPORT.md`);
**Q** = qualitative/direction. Tolerances are the dossiers' own unless stated.

### 9.1 Oracles and invariants (all M)
| ID | Check | Tolerance |
|---|---|---|
| O-1 | Hall 2011 BWP port (01 §4.12) vs engine, macronutrient-neutral no-RT scenarios (sedentary man/woman, −25 %, −500 kcal, +20 %, 1 y) | ±1.5 kg at 6 mo; ±3 kg at plateau |
| O-2 | Negative control (01 §7.12): Longland CON vs PRO — BWP gives no difference; engine gives PRO > CON lean | direction |
| O-3 | ±5 % rule: 7-d steady-state CHO ox, fat ox, ΔG vs 04 §4.11 daily form at 30/50/70 %E carbohydrate | ±5 % |
| O-4 | Energy conservation, checked by the core against module **states** (`RunOptions.checks`): hourly S_h = (ρF + ηF)·ΔFM + (ρL + ηL)·ΔLT from the published masses, signed deposition cost = ηF·ΔFM + ηL·ΔLT, glycogen flux = ρG·Δ(G_L + G_M); daily EI − TEE (incl. signed deposition cost and DNL heat) − ρG·ΔG − ketone loss = ρF·ΔFM + ρL·ΔLT | 1e-6 kcal / 1 kcal |
| O-5 | Mass identity: scale = FM + FFM_act + labile water (labile water includes glycogen mass + bound water, §1.10); **day-0 weigh-in** scale = entered weight (R-MORNING; `meta.checks.t0WeightErrKg`, measured by the core at day 0's wake hour; gates every scenario arm whose day 0 continues the habitual night — arms that start a fast at 00:00 or eat/exercise before waking are listed, not gated) | 1e-9 kg / 0.05 kg |
| O-6 | Water-only fast 21 d and 28 d at zero intake: no NaN/negative pools, monotone FM, finite BHB (orchestrator ruling) | exact |
| O-7 | Determinism: same inputs → bit-identical results; draws reproducible from seed; ensemble draws identical whatever the worker count, chunking and order (the Simulator's worker chunks, the planner's pool); snapshot restore bit-identical to init + burn-in (`core/__tests__/loop.test.ts`, 16 real modules) | exact |
| O-8 | R-NOINS: isocaloric isoprotein carb↔fat swap, 14 d | fat balance 0 ± 20 g/d; TEE < 50 kcal/d per 10 %E |
| O-9 | R-SEQ: permutations of identical weekly energy/protein blocks, 12 wk | Δfat < 0.2 kg |
| O-10 | Hourly closed forms vs 5-min Euler references (05 §4.17, 03 §4.7, 04 §4.10) | 2 % state / 0.05 mM |
| O-11 | Performance: 180-day run, all modules, production bundle in Node (`harness/bundledBench.ts`): planner mode (`record:'daily'`, goal series) and simulate mode `none` / `daily` / `full`; skipped (not passed) when the machine's 1-min load exceeds half its cores | planner ≤ 10 ms desktop (best of 15), ≤ 50 ms phone profile; simulate modes ≤ 15 ms |
| O-12 **[rev B3]** | Maintenance no-drift: MAN, WOMAN, LEAN_MAN with habitual training (MAN/LEAN_MAN 3 sessions/wk) at 100 % of baseline maintenance (the habitual week repeated), 90 d, default 14-d burn-in. Integration matrix (`model/composition/steadyState.test.ts`, 78 cells, all passing incl. habitual lifters): both sexes × ages 22/45/70 × BMI 20/27/38 × sedentary / RT 3×/wk / cardio 4×/wk × carbohydrate 20/45/65 %E × 2/3 meals × 8/12-h window | \|ΔFM\| < 0.15 kg; \|Δscale(wake)\| < 0.3 kg (day-90 weigh-in vs the t = 0 value = day-0 weigh-in = entered weight, R-MORNING); matrix also \|ΔLT\| ≤ 0.15 kg, wake-to-wake 12-wk drift ≤ 0.3 kg, day-0 weigh-in error ≤ 0.05 kg |

### 9.2 Dossier targets
| Dossier | Targets (IDs per dossier §7) | Level | Gate |
|---|---|---|---|
| 01 | 7.1 Minnesota (via Hall 2006; BW ±2 kg, FM ±1 kg); 7.2 Jebb 12 d (BW ±0.5 kg, CHO ox ±15 %); 7.3 CALERIE-1 6 mo (±1.5 kg); 7.4 CALERIE-2 2 y from measured intake (±1 kg); 7.5 Hall 2015 RC vs RF (fat ±60 g/6 d; RQ ±0.01; deficit −810 kcal/d); 7.6 Hall 2016 KD not faster fat loss; 7.7 overfeeding set (±1.5 kg); 7.8 Friedlander (Q) | I | M (7.8 Q) |
| 02 | V1 Levine (ΔTEE ±150); V2 Bray REE ≈0/+160/+227 ±60 (R-BRAY); V3 Hall 2016 ΔTEE −30…+100; V4 CALERIE-1 AT; V5 Martins W9/W13; V6 Biggest Loser; V7 MATADOR/ICECAP (Q); V9 Ohkawara ±15 %; V10 Mikkelsen +80-120; RMR fixtures §4.1; worked example §4.13 | U/I | M; K **[rev]**: V8 Leibel; V3 Hall 2016 (consequence of R-GNG = 0), V4 CALERIE-1 AT, V6 Biggest Loser (−5 % RMR cap on compensation) and V10 Mikkelsen, as reported by WP-M3 with the real module — re-evaluated in the integration calibration pass |
| 03 | §4.4.2 model table (non-RT arms ±0.02 pCat); §4.13 fasting cross-check; V-list (Trommelen appearance ±7 points; Mettler/Pasiakos directions); Longland PRO magnitude and Templeman lean adults | U/I | M; Longland PRO +1.2 kg and Templeman K |
| 04 | Taylor/Magnusson liver (±20 %), Bussau (±15 mmol/kg), Acheson 1982/1988, Schrauwen days 1-3 (±0.4 MJ), Jebb CHO convergence, glucose/insulin excursion checks §4.16-4.17, insulin-sensitivity factors §4.18 | U/I | M |
| 05 | V1-V7, V9, V10, V11 fasted, V12, V13 | U/I | M (after R-KET retune) |
| 05 | V8 (24-h rows), V11 fed Cmax, V15, Neudorf lean 48 h, chronic MCT (V14 Johnstone promoted to M by the finisher: inside its band with the study's measured ad-libitum intake) | I | K |
| 06 | §7 targets (coefficient checks, DASH-sodium BP, KD LDL mean and heavy tail inside ensemble band, liver fat with weight loss, HbA1c τ) | U/I | M (LMHR heavy tail Q) |
| 07 | 1 Rothman/Roden liver glycogen (±15 %) & GNG share (±8 pts); 2 Klein 72 h (±15 %); 3 Browning by sex (BHB ±40 %); 4 Hartman/Ho GH & IGF-1; 5 Chan 72-h panel (±15 pts; leptin K); 6 Webber/Zauner REE (±5 %), RER (±0.02); 7 Laurens 10-d modified fast (weight ±0.8, FM ±0.6 kg); 8 Buchinger cohort (±1 kg); 9 Templeman ADF | I | M (Chan leptin, Templeman fat K) |
| 08 | ASI anchor table (±5 pts), IGF-1 72 h and refeed, V9 CR-only arm within 4 pts | U | M |
| 09 | #1-14 (§1.9) incl. strength 19-27 % (+3) after R-STR | U/I | M (Longland/Garthe magnitudes K) |
| 10 | V1-V5 (EE, EPOC), V6-V9 (compensation: totals ±1 kg; c_met 0.28 sensitivity reproduces Careau), V10-V11 (substrate, glycogen), V12-V13 (no fasted/HIIT fat-loss bonus), V14-V17 (VO2max), V18 (insulin) | U/I | M (V19-V21 Q; V22 VAT without weight loss K — no owner in v1, R-VATEX) |
| 11 | §4.15 prototype table (ΔBW ±25 %), Levine β⁺ sensitivity, Horton storage 74 % vs 89 % (±8 pts), Jacquet overshoot examples | I | M; Bray 5 % arm K |
| 12 | Appendix A regression values; leptin/T3/cortisol/testosterone fit lists (±12-15 pts); HPI scale anchors; P_surv attrition calibration | U | M (Chan 72-h leptin K) |
| 13 | V1 Hall KD −1.6 kg (±0.4), V2 Yang (±15 %), V3 Pietzner (with 20), V4 Laurens, V5 Burke, V6 Jansen slope, V7 Peos diet break (DXA +0.7 ±0.4), V8 MATADOR, V9 Vink, V10 Templeman, V11 Wilson, V12 Kerndt (±0.2 kg/d), V13 Sciarrillo, V14 gallstone ordering (Q), V15 Schrauwen | I | M (V10 fat K) |
| 14 | body module suite (already passing, `src/engine/body/*.test.ts`); V3 CALERIE-2 regional, V5 VAT slope 1.29-1.34, V12 sensitivity table (ΔFM ±0.5 kg with the engine partition) | U/I | M |
| 15 | V1-V20 (fibre/nut ME, sodium steps, alcohol fat-ox, caffeine residual, creatine x and water) | U | M |
| 16 | V1 Nedeltcheva (lean share ↑ in short sleep), V2 Wang, V4-V5 (Si, T, MPS), V11 caffeine residual 34/40 mg, V12 luteal; V3 and V6 intake effects are outputs only (HPI direction) | U/I | M (V9 sex FFM share Q) |
| 17 | golden tests: each HC/W rule fires on its canonical trajectory and not on its neighbour; message length ≤ 200 | U | M |
| 19 | V1, V3, V5-V10 (tolerances in §1.15), V2 gap ≈ 8 pp (±3), V4/V11-V13 | U/I | M (V4, V11, V12 Q) |
| 20 | V1-V10 and every §4B.3 schedule behaviour (§1.4) | I | M |
| 21 | lever checks: creatine W_Cr and saturation, post-meal walk glycaemic factor, sauna/CWI multipliers as PROPOSED values | U | M |

**Status (blocker round, 2026-10-01):** 169 scenarios, 545 expectations (09 #12 `lifter3`/`lifter20` added, R-DETRAIN);
M 341 of 437 met, 96 registered; K 13 of 13 missing; Q 57 of 95. Only 19-V10's registered strength miss and two Q rows
(02-V7, 19-V10) moved with R-DETRAIN.
**Status (finisher pass, 2026-09-30; `docs/VALIDATION_REPORT.md`, `validation/KNOWN_MISSES.md`):** 169 scenarios, 543
expectations; M 338 of 435 met, 97 registered (82 K, 15 open; by cause: dossier conflict 27, structure 25, ruling 21,
calibration 13, mapping 11); 13 K rows all missing; Q 57 of 95 in direction; every §9.1 oracle and invariant row passes
except O-3's three glycogen/fat-oxidation rows (consequence of the fuel ruling of 2026-09-30 18:10, registered).

### 9.3 Reference scenarios (fixtures shared by validation, bands and benchmarks)
`MAN` (35 y, 180 cm, 90 kg, 25 % BF, 7 000 steps), `WOMAN` (42 y, 165 cm, 72 kg, 36 % BF), `LEAN_MAN` (25 y, 178 cm,
75 kg, 12 % BF, RT 3 y) in `core/__tests__/fixtures.ts` (extended by WP-V); programmes: maintenance, −25 % steady,
−25 % with 3×/wk moderate RT and 1.6 g/kg protein, MATADOR 2:2, 5 %E-carbohydrate isocaloric, weekly 24-h fast, 72-h fast,
7-d water fast + 3-d refeed, 21-d water fast, +15 % surplus with high-volume RT.

---

## 10. Planner integration contract (consistent with `src/engine/planner/optim/README.md`)

### 10.1 Types
```ts
// src/engine/planner/domain (WP-P) — the "integrating layer"
type Sched = Schedule;                                   // engine input; compiled inside simulate (cached per object)
type Sim = SimulationResult;                             // record 'daily', series = goal ∪ constraint ∪ descriptor needs
interface EnginePlanModel extends PlanModel<SkeletonStructure, Sched, Sim> {}
interface SkeletonStructure extends PlanStructure {         // one skeleton of 18 §4.4.3 (segments, day-type roles, events)
  readonly skeleton: PlanSkeleton;                       // discrete choices; genome genes map to lever ParamSpecs
}
```
- **decode(structure, x)**: genome x ∈ [0,1]ⁿ → 18 `Plan` (phases, day-types, week pattern, overlays, events) →
  `Schedule` (one DayTemplate per day-type × check-in block, dense `days` from week patterns and overlays, FastEvents from
  `zeroIntake` event instances, `blocks` = phases/check-in blocks, `energyReference: 'blockStart'`; 18's `checkIn`
  re-anchoring every 4 weeks = 4-week blocks). Pure, deterministic, no engine calls.
- **repair(structure, schedule)**: input-space safety and user hard constraints (17 HC-E2, HC-M1…M12, HC-F1…F5,
  HC-X1…X3/X5, lever tiers, consent), each clip logged as a `RepairEntry` (feeds complexity penalty and "binding
  constraint" explanations). Never touches runtime-resolved energy (that is a state-space margin).
- **simulate(schedule, draw)**: `runEngine(resolvedProfile, compileScheduleCached(schedule, resolvedProfile),
  {mode:'planner', record:'daily', series: plannerSeries, paramOverrides: draw < 0 ? undefined : ensembleParams[draw],
  abortOn: stateBounds, burnInDays: 14})`. The resolved profile and the burn-in end state can be computed once per request
  and draw: `captureInitialSnapshot(rp, compiled, {mode:'planner', series, paramOverrides})` → `RunOptions.initialSnapshot`
  (core, §3.4; skips init + burn-in, ≈ 5 % of a run). `abortOn` bounds may name a series or a SafetyTrace quantity
  (`StateBound.series: SeriesId | keyof SafetyTrace`); the core checks both after each day and hands them to the modules as
  `ModuleContext.abortOn` (safety may raise `safetyAbort`). `RunOptions.constraints: true` returns
  `SimulationResult.constraints` = safety's `computeConstraintMargins(result.safety, person)` (the same pure function the
  domain layer may call on any result, including aborted ones).
- **goals(sim)**: 18 §4.5 functionals from `optim/goals.ts` (`endMean`, `delta`, `windowMean`, `timeInRange`, `softMin`,
  `aucAbove`, `timeToTarget`) over `sim.daily[seriesId]`, in metric units; goal eligibility and direction from `SERIES`.
- **constraints(sim, schedule, log)**: the state-space HC margins of §7.3 from `sim.safety`, plus `hungerCapMargin` over
  `hunger`; aborted runs report the violated bound (`EvalOutput.aborted`).
- **descriptors(schedule, sim)**: 18 §4.12 b₁…b₄ ∈ [0,1] computed from the Schedule (e.g. carbohydrate share, fasting
  hours per week, training volume, energy periodisation amplitude) — no engine state needed.
- **regulariser**: `λ_H·hungerPenalty(sim.daily.hunger) + λ_C·complexityPenalty(levers) + λ_T·R_term`.
- **features**: Gower φ over the decoded Schedule (18 §4.12). **cost**: 1 EU per horizon simulation (aborted runs < 1).
- `evaluatePlan(model, structures, req)` (optim) turns an `EvalRequest {structure, x, draw}` into `EvalOutput`.

### 10.2 Worker binding and budget
Evaluator workers (`src/workers/planner.evaluator.worker.ts`, WP-P) each hold an `EnginePlanModel` (resolved profile, goal
list, structure list, ensemble quantiles → parameter vectors) and answer `WorkerCall` batches; the coordinator calls
`createPooledEvaluator(workerCalls, chunkSize)`. Calibration: one nominal simulation per worker measures msPerEU for
`budgetForDevice`. Early abort (`abortOn`) implements 18 §4.1's state-bound pruning. Adherence: `P_surv` from the
`adherence` series multiplies outcome desirability (12 §4.10a, 18 §4.9).

### 10.3 Lever registry data (18 §4.4.1) — engine-relevant fields
Each `LeverDef.expand` writes only Schedule fields of §5.2 (`engineInputs` checked at registration against the
DayTemplate/FastEvent field list). Fasting tiers (orchestrator ruling, 17 §4.3) as data on the `zeroIntake` family:
`waterFast.tier(person, {durationH})` = `default` for ≤ 24 h, `optIn` for 24-72 h, `optIn` + expert-mode attestation flag
for 72-168 h, `never` for > 168 h; plus 17 HC-F2 spacing as `LeverConstraint`s (`minGapDays`, `maxPerWindow`,
`maxHoursPerWindow` 108 h/7 d) and HC-F3 refeed as `recovery` spans (`refeed:'auto'`). Person gates (R1, age ≥ 65,
diabetes medication…) enter through `tier(person, p)`. The Simulator may run `never` levers with warnings (§7.2).

### 10.4 Engine guarantees the planner relies on
Deterministic output per (profile, schedule, parameter vector); monotone cost (1 EU/run); no allocation growth across
runs in one worker (every run allocates its own buffers in prepare/init; nothing is retained after the result); results independent of worker
count; `quantilesToParams` stable across builds for the same registry hash (the planner stores `registryHash` in
provenance and refuses to compare results across hashes).

---

## 11. Status, open items, risks, build plan

### 11.0 Contract changes after review (2026-09-30)
Source: `docs/MODEL_SPEC_REVIEW.md` (fixes marked APPLIED there were made by the reviewer), `docs/MODEL_SPEC_DECISIONS.md`
(orchestrator accepted every recommendation) and `docs/CONTRACT_REQUESTS.md`. All code changes are **additive**; nothing
was renamed or removed. Module engineers: check the items that name your module.

**Code (`src/engine/types/**`, `src/engine/core/**`):**
1. `createSignalBus()` now builds the bus with `Object.fromEntries` → fast properties, one hidden class across runs
   (regression test `core/__tests__/bus.test.ts`). Contract overhead back to ≈ 1.5 / 2.9 / 3.8 ms per 180 d; full engine
   (partially real modules) ≈ 25 ms (was ≈ 48 ms). **All modules:** never add/delete bus properties.
2. New signals (types/signals.ts, 114 → 118): `fatFloorActive` (composition → safety, hour), `exSessionNetKcalD`
   (activity → wellbeing, day), `insulinBasalUuMl` (intake → cellular, hour), `rtDoseFrac` (muscle → composition, day).
   New reader: `water` on `energyBalance7KcalD`. Descriptions updated: `aerobicIdx` (R-AEROBIC), `cycleDay` (1-based).
   Review B5 (already applied): `exPlannedKcalD`, `aerobicIdx`, `rtVolumeWb` + reads of `rmrKcalH`, `tdeeEstKcalD`,
   `bhbEndoMmolL`, `fedState`, `muscleGlycogenRel`.
3. `checkWiring()` returns `{issues, pending, timing}`: listed-but-unadopted writes/reads are `pending` (allowed), not
   issues — declare only the reads you use; WP-C syncs the readers column at integration. Reading a signal whose readers
   column omits you is still an issue → send a contract request.
4. `EngineModule.endBurnIn?(s, k, bus, ctx)` (optional hook; `defineModule` accepts it) and `ModuleContext.burnInDays?`
   (always set by the loop). Called once after day −1's endOfDay (also with burnInDays = 0), before t = 0 capture.
5. Burn-in runs `core/compileSchedule.habitualWeek(profile)` (7 DayInputs, weekday-indexed, with the habitual sessions)
   instead of the single `habitualDay` (kept for test kits). Exports `HABIT_SESSION_START_H` (18), `HABIT_SESSION_MIN`
   (60); `resolveProfile` exports `HABIT_RT_MET`, `HABIT_CARDIO_MET`, `leanTissue0Kg(profile, h)`.
6. `ResolvedProfile.eat0Kcal` (habitual exercise energy inside TDEE0).
7. `DayInput.exerciseCarbG` (included in `carbG`, `glucoseEqG`, `energyKcal`); `HourInput.exCarbG` (NOT in the meal fields);
   compile notes `carbsDuringExerciseAdded`, `carbsDuringExerciseDropped`, `nonProteinShareNeedsProtein`.
8. `MacroSpec.carbShareNonProtein?` (0..1) — the m8 "% of non-protein energy" (field, not a new `MacroAmount` unit, so UI
   code enumerating units stays valid).
9. `DrawKind` gains `'uniform'`; `ParamDef.low/high/note` docs state the R-ALT rule; `quantilesToParams` handles it.
10. `SimulationMeta.checks.t0WeightErrKg?` (O-5 at t = 0). Core tests now run on placeholder-physics stubs
    (`core/__tests__/stubModules.ts`) so they do not depend on module progress; the full-engine bench is reported, not gating.

**What each module engineer must do differently (spec sections updated accordingly):**
- **activity (§1.2):** implement `aerobicIdx` = clamp(7-d mean net cardio session EE / 300, 0, 1) (R-AEROBIC); write
  `exSessionNetKcalD` in endOfDay; burn-in now contains habitual sessions (VO2max/MEM see them).
- **intake (§1.3):** absorb `hour.exCarbG` as a glucose slot (t_p 0.5 h, GI 100) and add it to kcal24/carb24 and the
  intake clocks (R-EXCARB); write `insulinBasalUuMl`.
- **fasting (§1.4):** planned spans activate the overlay only if ≥ 24 h (use `ctx.schedule.fastSpans`); shorter planned
  fasts use the 24-h criteria (R-PART-HOUR).
- **energy (§1.5):** `gngCost` default 0 [0, 0.2] (R-GNG); hold P_eff and compKcalD while `fastActive` (R-FAST-AT); TEF_h =
  α_day·eAbsKcalH (R-TEFTIME); NEAT0 calibration + reference reset in `endBurnIn` (R-BURNIN); EAT0 from
  `profile.eat0Kcal`; `a_lut` from `moderators.lutealAmp` (fallback 0 only without moderators).
- **fuel (§1.6):** GNG fills the HGO gap `max(0, HGO − J_L,out − lactate)` capped by 0.57·protOx + 0.10·fatOx; surplus
  supply is oxidised (R-HGO).
- **composition (§1.8):** regime per hour (R-PART-HOUR); smooth fat floor + write `fatFloorActive`, stop emitting
  `safetyFlag` (R-FATFLOOR); absolute LT0 (R-LT0); reset FM/LT/SM/depots in `endBurnIn` so t = 0 tissue mass = entered
  weight (R-BURNIN); read `rtDoseFrac` instead of copying V_R.
- **muscle (§1.9):** write `rtDoseFrac`; with WP-M7 re-verify the Murphy zero-crossing, set ρ_max 0.5 if < 400 kcal/d
  (R-PROT2); validation fixtures at e = 0 (m21).
- **water (§1.10):** re-anchor every reference in `endBurnIn` and write scale = tissue mass (no tissue offset); declare the
  `energyBalance7KcalD` read for `weightPlateau`; `fastZeroCarb` switch documented.
- **cellular (§1.13):** `dL = raAaQGH/(0.10·FFM)`, h50 56 h, `dI` against `insulinBasalUuMl` (documents your
  implementation); drop unused reads freely (pending, not issues).
- **wellbeing (§1.15):** may read `exSessionNetKcalD`; prune unused reads freely.
- **safety (§1.16, §7.2):** rule `W-01-FATFLOOR` on `fatFloorActive`; read it.
- **all modules (R-ALT):** a rejected alternative from another convention/model form goes to `note`, not to low/high
  (e.g. `rhoL`, `t3CarbKnee` 130 g, sleep reference 7.5 h, 20's γ values); convention constants `draw: 'fixed'`.
- **validation (§9):** new invariant O-12 (maintenance no-drift, 90 d, MAN/WOMAN/LEAN_MAN with habitual training);
  O-5 via `meta.checks.t0WeightErrKg`; 02 V3/V4/V6/V10 and 10 V22 are K items.
- **planner domain (§10):** `carbShareNonProtein` expresses 18's `carbShareNonProtein` directly; decode energy with
  `blockStart`; exercise carbohydrate adds to intake.

**Integration pass A1 (2026-09-30, energy/mass backbone, core, validation):**
1. `RunOptions.initialSnapshot` / `captureSnapshot`, `captureInitialSnapshot()`, `EngineSnapshot` (§3.4, §10.1); `RunOptions.constraints`
   → `SimulationResult.constraints`; `StateBound.series` may name a SafetyTrace key; `ModuleContext.abortOn`.
2. `meta.checks` evaluated against module states (O-4, §9.1) with components `storageMaxAbsKcal`, `depositionMaxAbsKcal`,
   `glycogenMaxAbsKcal` and run totals; record hooks called only for modules owning a requested series (§0.3).
3. `endBurnIn` adopted by energy (NEAT0 calibration without the mass-dependent TEE), composition (re-anchoring) and water
   (references, scale = tissue mass): t = 0 weight error 0.000 kg in every tested profile.
4. Composition: EB7 = weekly boxcar (`composition.eb7WindowD` replaces `eb7TauD`), m20 p_E blend (`composition.partBlendKcalD`
   100 kcal/d), deficit size d from EB7, writes `fatFloorActive`, emits no events, regional detail series. Water reads
   `energyBalance7KcalD` (weightPlateau as specified).
5. Signals: 25 unused `wellbeing` and 2 unused `cellular` reader entries pruned (§4 table synced); `reproRiskFemale` init 0.
6. Metrics: detail series `atResting`, `atNonResting`, `fatTrunk`, `fatArms`, `fatLegs`, `muscleArms`, `muscleLegs`,
   `muscleTrunk`, `totalKetones`, `dietFatigue` (the last two recorded by the core as `SIGNAL_MIRRORS`).
7. `simulateEnsemble`: bands of change-from-baseline series are bands of the change (§8.1).
8. Validation: `knownMisses.ts` register + `it.fails` encoding for K and registered M rows; O-11 on a production bundle;
   O-12 matrix test; scenario-mapping fixes (fasts from t = 0, CALERIE-2 persona, habitual-week fixture).

**Engine finisher pass (2026-09-30, late; changelog at the top):** all contract changes additive — `SafetyTrace.eee7?`,
`fastDay?`, `ei28?`; `SimulationMeta.checks.t0ScaleKg?`; `SeriesDef.description?` (scale weight, lean mass, body fat,
insulin sensitivity); `bodyFatPct` hourly with daily 'wake' aggregation; `core/math.wakeRecordHour`,
`core/loop.withRmrDeviation`, `core/compileSchedule.habitualWeekPrograms`; registry parameter `energy.rmrIndividualFrac`
(R-RMRDEV); new reads `appetite ← hoursSinceIntakeH`, `cardiometabolic ← tissueMassKg`, `composition ← rtDoseFrac`;
37 stale reader entries pruned (`checkWiring`: no issues, nothing pending). Validation-internal (not a UI contract): the
`KnownMiss` register type now names the owning module (`ModuleId | 'scenario'`), class K/open, cause and target.
Whole-repo type-check clean; no UI fallout.

### 11.1 Status
All 21 dossiers are final and incorporated; no section of this spec is provisional. Parameters keep the dossiers'
status flags (`proposed-fit`, `unverified`) in the registry; they are calibration items, not open design questions.
Calibration steps that are part of the module work (each has a must-pass target in §9): R-KET (kP, G50 after the 04
coupling; then 20's BHB_ref), ASI B0 and EC50_I (08 anchors), 09 N_max slope (R-STR), 12 HPI scale anchors, band
calibration (§8.3), 07 mClock replacing 04 M_circ (R-CIRC), 21 post-meal-walk glycaemic factor (21 §4 value), the
Murphy zero-crossing / ρ_max check (R-PROT2), and the NEAT0 burn-in calibration (R-BURNIN, O-12). Known calibration
tension (orchestrator, 2026-09-30): with kP ≈ 0.008-0.009 the 48-h/72-h fasting BHB targets are reachable but 24 h sits
at ≈ 0.5 mM instead of 20's 0.3 mM (05 reports 0.56 ± 0.28 mM at 24 h in lean men) — accepted within ±0.15 mM or as K;
the O-1 BWP margin is tight (≈ 1.2 of 1.5 kg; if needed run O-1 with protein at constant %E, review m19).
Deferred features (explicitly out of v1): ad-libitum intake drift (12 §4.10c; appetite outputs only), 13 §4.1 scale
noise simulation, 21 extra inputs X1-X19 beyond those in §5.2. (`RunOptions.initialSnapshot` is implemented by the core.)
**Resolved (R-MORNING, orchestrator 2026-09-30; implemented by the finisher):** the entered weight is the day-0 weigh-in
weight. Water and composition latch the burn-in night's overnight deltas and re-anchor so that the day-0 wake-hour scale
weight equals the entered weight (O-5 now checks the wake hour, worst error 3 g); the t = 0 (midnight) state sits above it
by the overnight fall and is reported as `checks.t0ScaleKg`; daily `scaleWeight`, `leanMass` and `bodyFatPct` are
weigh-in-hour values, hourly series unchanged (§1.8, §1.10, §3.4, §6).

### 11.2 Risks (ranked)
1. **Ketone retune** (05 × 04 × 20): one (kP, G50) pair may not satisfy 05 V1-V6 and 20's BHB_ref beyond day 5 at
   once. Mitigation: k_prot and A_s gain (aHs) are the second-line knobs; any residual becomes a K item with its error.
2. **Lean users and fasting**: 20's N model plus 03's partition are least certain for lean adults (Templeman known-miss;
   protein loss 1.5-2.5× that of obese). Mitigation: W-20-FAST-LEAN, conservative (higher) lean loss, wide lean bands.
3. **Performance budget**: measured 6.6 ms per 180 d in planner mode and 8.1-9.9 ms in simulate mode on the bundled
   engine (finisher, §0.3) — 3.4 ms of headroom to the 10-ms planner bound, none measured yet on a phone. Intake (meal ring,
   kernels), fuel (3 muscle groups), ketones (exp/linearisation) dominate. Mitigation: per-module budget in the bench
   (§11.3 acceptance), precomputed kernel tables by t_p class, skipping empty slots, no `Math.pow` with constant integer
   exponents in hot paths; `record:'daily'` and series masks in planner mode.
4. **Hourly downscaling of 04** (O-3) is unproven until fuel exists; 04's rules were written for sub-hour steps.
5. **Recomposition under-prediction** (03/09: Longland PRO, Garthe) — conservative lean gains in deficit with high
   protein + RT; documented K items.
6. **Grade C/D parameters dominate some bands** (09 k_g, 03 partition, 12 HPI, 08 ASI): bands and caveats must stay on.
7. **Leibel-type adaptation** under-predicted by β 0.14 → optimistic maintenance after loss; the high draw covers it.
8. **Parallel-implementation double counting**: guarded by `checkWiring` (writers, readers, timing), O-4/O-5 conservation
   checks and the ownership table (§2.1); any new signal goes through the core owner.
9. **Bus performance outside V8**: the fast-properties fix is V8-specific; JavaScriptCore (Safari/iOS) may still treat a
   118-property object as a dictionary. If the phone budget (≤ 50 ms) fails on iOS, the fallback is a `Float64Array`-backed
   bus behind the same property interface (generated accessor class) — a contract-preserving change owned by WP-C.
10. **Low-carbohydrate glycogen (fuel ruling 2026-09-30 18:10)**: outside fasts and exercise muscle glycogen stays at its
   fed reference, so the first-week water loss of a ketogenic switch, Hall 2015's carbohydrate-restriction fat balance and
   the O-3 glycogen rows are under-predicted (registered, `KNOWN_MISSES.md`). Revisit with the fuel owner before relying
   on early low-carbohydrate scale predictions.
11. **Dossier conflicts in lipids and blood pressure** (06): per-kg weight slopes for LDL, TG and SBP fit DIETFITS or
   Magkos/Neter, not both; the engine keeps the dossier values and registers the conflicting rows.

### 11.3 Work packages (parallel; disjoint owned paths)
Every WP: implement per its spec section, declare every constant as a `ParamDef` (value, low, high, grade, source, §,
status), keep the stub's exported State interface (extend fields freely), add signals only via the core owner (WP-C),
unit tests under the module folder, and meet its per-module time budget in `core/__tests__/loop.test.ts`'s bench
(≤ 0.5 ms per 180 d unless stated).

| WP | Owned paths | Spec | Depends on | Acceptance (CI) |
|---|---|---|---|---|
| WP-C core & contracts | `src/engine/core/**`, `src/engine/types/**`, `docs/MODEL_SPEC.md` | §0, §3-§8 | — | tsc/eslint clean; loop tests; checkWiring empty; O-4…O-7, O-11 harness |
| WP-M1 moderators + activity | `src/engine/model/moderators/**`, `src/engine/model/activity/**` | §1.1, §1.2 | WP-C | 16 V1-V2, V4-V5, V11-V12 (unit); 10 V1-V5, V14-V17 |
| WP-M2 intake | `src/engine/model/intake/**` | §1.3 | WP-C | 07 §4.1 t95; 03 V6; 04 §4.16-4.17 checks; 15 V1-V3, V9-V15; ≤ 1.0 ms |
| WP-M3 energy | `src/engine/model/energy/**` | §1.5 | M1, M2 signals | 02 RMR fixtures, §4.13 worked example, V1-V10 (energy parts) |
| WP-M4 fuel | `src/engine/model/fuel/**` | §1.6 | M2, M3 | 04 §7; O-3 (±5 %); ≤ 1.0 ms |
| WP-M5 ketones | `src/engine/model/ketones/**` | §1.7 | M4 | 05 must-pass list; O-10; 20 BHB_ref |
| WP-M6 fasting | `src/engine/model/fasting/**` | §1.4 | M3, M5, M7, M9 | 20 V1-V10, §4B.3; O-6 |
| WP-M7 composition | `src/engine/model/composition/**` | §1.8 | M3, M4, M8 | 03 §4.4.2 table; 11 §4.15 table; O-1, O-2, O-4 |
| WP-M8 muscle | `src/engine/model/muscle/**` | §1.9 | WP-C | 09 #1-14 (R-STR) |
| WP-M9 water | `src/engine/model/water/**` | §1.10 | M4, M7 | 13 V1, V7, V12; O-5 |
| WP-M10 hormones + appetite | `src/engine/model/hormones/**`, `src/engine/model/appetite/**` | §1.11-1.12 | M1, M7 | 12 Appendix A; 19 V8; 08 IGF-1 targets |
| WP-M11 cellular | `src/engine/model/cellular/**` | §1.13 | M2, M5, M8 | 08 ASI anchors ±5 |
| WP-M12 cardiometabolic | `src/engine/model/cardiometabolic/**` | §1.14 | M1, M7 | 06 §7; 04 §4.18-4.19 targets; 13 V6 |
| WP-M13 wellbeing | `src/engine/model/wellbeing/**` | §1.15 | M1, M4, M5, M7 | 19 V1-V12; 13 §4.10 |
| WP-S safety | `src/engine/model/safety/**` | §1.16, §7 | all signals | 17 golden tests; message length |
| WP-V validation | `src/engine/validation/**` | §9 | WP-C now (BWP port, fixtures); modules for I-level | O-1…O-11 harness; §9.2 table wired; KNOWN_MISSES.md |
| WP-P planner domain + workers | `src/engine/planner/domain/**`, `src/workers/planner*.ts` | §10 | WP-C now; engine for real runs | optim README "remaining" tests (7.1 decoder properties, 7.4 safety fuzzing, 7.5 performance) |

Phasing: phase 1 (in parallel now, against stubs): WP-M1, M2, M8, M11-M13 skeletons, WP-S, WP-V (oracle port, fixtures),
WP-P (decoder, lever registry, repair). Phase 2: WP-M3, M4, M7, M9, M10. Phase 3: WP-M5, M6, calibration pass (§11.1),
band calibration, full §9 suite. Contract changes after phase 1 require a spec edit by WP-C first.
