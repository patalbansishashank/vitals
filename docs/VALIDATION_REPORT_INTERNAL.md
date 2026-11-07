> **Maintainers' version.** This file keeps the internal research-file numbers, section signs, ruling ids and spec names of the
> validation run. The report users read at `/evidence/validation` is the plain-language rewrite in `docs/VALIDATION_REPORT.md`
> (bundled into the app by `src/features/evidence/validationReport.ts`); it carries the same numbers and scenarios. When the
> validation run changes, update both: the numbers here, then the same numbers there in plain words.

# Vitals engine — validation report

*Engine 1.5.0-reaudit, provenance re-audit of 19 October 2026: the 1 October engine (finisher pass, final-round pass R-MAINT, R-KETEX, cMMax 180, blocker round R-DETRAIN) plus waves 0-2 of the 18 October algorithm review — see "Review release" below. Every number in the study tables, the dossier table, the counts and the evidence-class section comes from one run of `pnpm vitest run src/engine/validation`; the scenario table, `KNOWN_MISSES.md`, the release ledger `docs/validation/review-release-ledger.json` and the evidence-class section are printed by `scenarios.test.ts` (capture recipe in `KNOWN_MISSES.md`), and the suite fails when the committed ledger no longer matches the run. Sections marked "1 October run" (parameter sensitivity ranges, two auxiliary ketone tables) were not re-run for this release. The register is `src/engine/validation/knownMisses.ts`, the evidence ledger `src/engine/validation/ledger.ts`; the model is specified in `docs/MODEL_SPEC.md`; every target comes from the research dossiers in `research/`.*

The October 2026 software-gate accounting is maintained separately in `docs/VALIDATION_ACCOUNTING.md` and the exact
`docs/validation/test-dispositions.json` registry. This report retains its scientific snapshot date; rerunning software
checks does not refresh unrun empirical or timing measurements. Headline counts are checked against the ledger by
`scripts/validation/report-consistency.test.mjs`.

## What was tested and how

The engine is an hourly, deterministic model of one person: energy expenditure and adaptation, glycogen and substrate
oxidation, ketones, fat and lean tissue, muscle growth from resistance training, body water and the scale, hormones,
appetite, blood markers, bone and performance, and safety rules. It is validated in three ways.

1. **Oracles and invariants** (spec §9.1): the engine is compared with two independent reference models (the published
   Hall 2011 Body Weight Planner, re-implemented from dossier 01, and dossier 04's daily carbohydrate balance), and it must
   satisfy physical identities — energy and mass are conserved every hour, a weight-stable person at maintenance does not
   drift, identical inputs give bit-identical outputs.
2. **Study scenarios** (spec §9.2): each dossier's validation list is encoded as a scenario — the study's participants
   as a person profile, the protocol as a schedule in the same input format the app uses — and every published outcome
   becomes an expectation with the dossier's own tolerance. Must-pass rows (M) gate the build; rows the dossier itself marks
   as known misses (K) are tracked; qualitative rows (Q) check a direction only.
3. **Parameter sensitivity ranges** ("uncertainty bands"): the ensemble of parameter draws is compared with the published
   between-person variability. These ranges are parameter-sensitivity ranges with unvalidated coverage (review D8-02):
   quantiles come from the stochastic members only, the nominal run is reported separately, and no range is a calibrated
   predictive interval.

The checked provenance sidecar classifies every outcome separately (review D8-03, A2-030; `provenance.ts`): verification
(identities, definition anchors), conditional dynamics (shared-input comparisons with an independent model: the Hall
planner port, dossier 04's daily carbohydrate law, a dossier's own model table), development fit (a study the model was
built, calibrated or checked against) and independent empirical validation (a study held out under a frozen model). The
split unit is the study, never an arm or a row. Historical scenarios are development unless provenance establishes
independence, so **this release reports no independent empirical validation**; the passes below show internal
consistency and fit to the development studies, not out-of-sample accuracy. Conservation and oracle agreement are
necessary, not proof that a trajectory is right.

A must-pass row that misses is never loosened. It is either fixed or recorded in the register with its owner (the model
module whose equations or parameters produce the miss), the measured value, the target, and a reason; the test then
runs as an expected failure, so a row that starts to pass turns the suite red until the register is updated.

## Results at a glance

| check | result |
|---|---|
| Study scenarios | 178 scenarios, 606 expectations |
| Must-pass rows (M) | **383 of 492 met**; 109 registered known misses (97 accepted, 12 open calibration items), none unexplained |
| Tracked known-miss rows (K) | 12, all still outside their band as the dossiers predict |
| Qualitative rows (Q) | 62 of 102 in the stated direction (non-gating) |
| Evidence classes (D8-03) | verification 11 scenarios; conditional dynamics 19 (5 model references); development fit 153 (94 resolved cohorts); independent empirical validation 0 |
| Oracles (§9.1 O-1 to O-3; conditional dynamics) | Body Weight Planner: 24 of 24 within tolerance; negative control 3 of 3; daily carbohydrate balance 6 of 9 (3 registered, ruling 18:10) |
| Invariants (O-4 to O-9, O-12; verification) | all pass: hourly energy residual ≤ 1e-6 kcal, scale identity ≤ 1e-9 kg in every one of 306 scenario arms; 0 day-0 wake-hour weight violations; bit-identical reruns, snapshot restores and ensembles across worker counts; no drift at maintenance; review-release invariants (model-limit termination, nitrogen boundary, correction ledger, ingestion audit, recording masks, signal hooks) pass |
| Performance (O-11, bundled engine, 180 days, best of 15, load 0.16 per core) | planner 6.5 ms (bound 10), simulate `none` 8.2 ms, `daily` 9.6 ms, `full` 9.7 ms (bound 15) |
| Parameter sensitivity ranges (32 draws; 1 October run; coverage unvalidated) | fat-change ±18 %, RMR ±9-11 %, lean-gain ±53 % (dossier 16 between-person spread: ±35 %, ±13 %, ±50 %) |

Registered misses by cause: dossier conflicts 31, model structure 24, consequences of rulings 21, scenario mapping 13,
consequences of review decisions 10 (D2-01 3, D6-08 2, D7-07 2, D1-07 1, D3-08 1, D7-08 1), open calibration 10. By owning
module: cardiometabolic 20, fuel 20, energy 17, composition 13, fasting 5, hormones 5, scenario 5, water 5, activityIntake 4,
intake 4, ketones 4, muscle 4, activity 2, wellbeing 1. The row-level list with the measured value, the target and the
reason for each is `src/engine/validation/KNOWN_MISSES.md`.

## Results by dossier

M = must-pass, K = tracked known miss, Q = qualitative. "Known misses" are registered M rows.

| dossier / oracle | targets | must-pass met | must-pass known misses | tracked K rows (all missing) | qualitative in direction |
|---|---|---|---|---|---|
| O-1 | 24 | 24 / 24 | 0 | 0 | 0 / 0 |
| O-2 | 3 | 3 / 3 | 0 | 0 | 0 / 0 |
| O-3 | 9 | 6 / 9 | 3 | 0 | 0 / 0 |
| 01 | 59 | 15 / 24 | 9 | 1 | 21 / 34 |
| 03 | 24 | 10 / 19 | 9 | 1 | 3 / 4 |
| 02 | 18 | 5 / 7 | 2 | 2 | 5 / 9 |
| 10 | 15 | 10 / 14 | 4 | 0 | 1 / 1 |
| 11 | 30 | 20 / 29 | 9 | 0 | 1 / 1 |
| 09 | 34 | 18 / 23 | 5 | 1 | 6 / 10 |
| 16 | 11 | 8 / 8 | 0 | 0 | 3 / 3 |
| 04 | 26 | 10 / 22 | 12 | 0 | 2 / 4 |
| 05 | 36 | 29 / 31 | 2 | 4 | 1 / 1 |
| 20 | 102 | 81 / 92 | 11 | 2 | 5 / 8 |
| 07 | 22 | 14 / 19 | 5 | 1 | 1 / 2 |
| 13 | 25 | 14 / 20 | 6 | 0 | 4 / 5 |
| 06 | 48 | 20 / 36 | 16 | 0 | 4 / 12 |
| 08 | 14 | 14 / 14 | 0 | 0 | 0 / 0 |
| 12 | 21 | 13 / 17 | 4 | 0 | 2 / 4 |
| 14 | 8 | 7 / 8 | 1 | 0 | 0 / 0 |
| 15 | 9 | 4 / 9 | 5 | 0 | 0 / 0 |
| 19 | 12 | 8 / 10 | 2 | 0 | 2 / 2 |
| R1 | 56 | 50 / 54 | 4 | 0 | 1 / 2 |
| **all** | **606** | **383 / 492** | **109** | **12** | **62 / 102** |

## Evidence classes (review D8-03)

Engine 1.5.0-reaudit, parameter set df2c3303, contracts 6522a15ccfa5a177; freeze hash 780fb0ce. 178 scenarios, 606 expectations.

| evidence class | scenarios | independent studies | rows | met (M) | registered misses | unregistered misses | K still missing | K now passing | Q in direction | no data | errors |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Verification (identities, anchors, invariances) | 11 | 0 | 58 | 50 | 4 | 0 | 0 | 0 | 2 / 4 | 0 | 0 |
| Conditional dynamics (shared-input model comparisons) | 19 | 5 | 76 | 67 | 7 | 0 | 0 | 0 | 1 / 2 | 0 | 0 |
| Development fit (studies the model was built or tuned against) | 153 | 94 | 472 | 266 | 98 | 0 | 12 | 0 | 59 / 96 | 0 | 0 |
| Independent empirical validation (untouched, frozen-model holdouts) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 / 0 | 0 | 0 |

Dataset roles of the study scenarios: estimation 66 scenarios (64 studies whose numbers are cited by a parameter), calibration 36 (31 studies visible while the model was tuned; development by default because no provenance establishes independence), external evaluation 0 (0 studies).

Runs: 306 arms, 0 aborted on a state bound, 0 ended at a model limit, 0 scenarios failed to run; conservation (O-4/O-5) violations 0; day-0 morning-weight violations 0 gating, 0 in arms whose plan changes the first night. Rows with no data: 0; errors: 0; registered rows now passing: 0.

Provenance schema 2: 606 detailed arm/outcome entries; 256 unresolved rows, excluded from goal-specific empirical coverage. Unknown study-population scope and derived thresholds without a matching goal estimand also supply no goal coverage. Pure imputation/software rows count as verification per outcome. Scenario counts may overlap classes in mixed scenarios.

Populations (scenarios / expectations): men, < 60 y 136 / 468; men, ≥ 60 y 2 / 4; mixed, < 60 y 12 / 59; women, < 60 y 27 / 71; women, ≥ 60 y 1 / 4.

Bias and mean absolute error of point targets, per evidence class and unit (engine − target; not pooled across units, tolerance types or classes):

| evidence class | unit | rows | bias | MAE |
|---|---|---|---|---|
| conditionalDynamics | % | 5 | -0.0836 | 1.47 |
| conditionalDynamics | % diff | 6 | 2.25 | 4.77 |
| conditionalDynamics | % of G_ref | 3 | -1.65 | 8.91 |
| conditionalDynamics | g | 1 | -36.3 | 36.3 |
| conditionalDynamics | g N | 1 | -5.32 | 5.32 |
| conditionalDynamics | g N/d | 2 | -4.23 | 4.23 |
| conditionalDynamics | kg | 44 | -0.34 | 0.542 |
| conditionalDynamics | mmol/L | 2 | 0.193 | 0.193 |
| conditionalDynamics | ratio | 2 | -0.378 | 0.378 |
| developmentFit | % | 67 | -0.784 | 9.15 |
| developmentFit | % points | 1 | 53.3 | 53.3 |
| developmentFit | cm | 1 | -1.37 | 1.37 |
| developmentFit | cm/% | 2 | 0.0214 | 0.0214 |
| developmentFit | cm/kg | 1 | -0.0244 | 0.0244 |
| developmentFit | fraction | 3 | 0.0209 | 0.0275 |
| developmentFit | g | 9 | -42 | 66.2 |
| developmentFit | g N | 2 | 5.18 | 5.86 |
| developmentFit | g N/d | 7 | -0.497 | 0.966 |
| developmentFit | g N/kg | 1 | -1.54 | 1.54 |
| developmentFit | g/d | 12 | -21.8 | 28 |
| developmentFit | g/h | 1 | -1.81 | 1.81 |
| developmentFit | h | 3 | 1.03 | 1.9 |
| developmentFit | kcal | 3 | -0.542 | 2.81 |
| developmentFit | kcal/d | 22 | -6.21 | 87.7 |
| developmentFit | kg | 105 | -0.359 | 1.05 |
| developmentFit | kg/d | 2 | -0.086 | 0.086 |
| developmentFit | mg/dL | 9 | 4.56 | 7.77 |
| developmentFit | MJ/d | 5 | -0.0554 | 0.259 |
| developmentFit | mmHg | 4 | 0.376 | 6.46 |
| developmentFit | mmHg/kg | 1 | 0.0127 | 0.0127 |
| developmentFit | mmol/L | 60 | 2.64 | 2.86 |
| developmentFit | mmol·h/L | 2 | -5.85 | 5.85 |
| developmentFit | prob | 4 | -0.0233 | 0.0369 |
| developmentFit | ratio | 15 | -0.15 | 0.201 |
| developmentFit | RQ | 3 | -0.0161 | 0.0168 |
| verification | % | 3 | -1.99 | 1.99 |
| verification | flag | 2 | 0 | 0 |
| verification | kcal/d | 14 | -39.6 | 63.7 |
| verification | kg | 8 | 9.00e-4 | 0.0025 |
| verification | PAL | 1 | 0 | 0 |

Sign and order checks in the stated direction: verification 5 of 5; conditionalDynamics 3 of 3; developmentFit 48 of 62. Interval coverage: not reported (tolerances are dossier design bands, not predictive intervals; interval coverage needs calibrated intervals and untouched outcomes).

Validity matrix (D4-08): study evidence behind each endpoint the planner can optimise, by population; code checks, conservation and shared-input model comparisons are not counted here. "Independent" counts studies held out under a frozen model.

| endpoint operator | planner goals | studies | populations | rows | met | known misses | independent studies |
|---|---|---|---|---|---|---|---|
| absolute intrahepatic triglyceride percentage at day 56, not percentage change [%; day 56 (8 weeks)] | liverFat | 1 | Fixture: adult men, 50 y, BMI 34 | 1 | 0 | 1 | 0 |
| absolute value after elapsed days (expression defines contrasts); fastingGlucose [mmol/L; Expression arguments are elapsed days unless hour/day-series or window indices are explicitly used; fixture horizons: main=57 d] | fastingGlucose | 1 | Fixture: adult men, 50 y, BMI 34 | 1 | 0 | 1 | 0 |
| absolute value after elapsed days (expression defines contrasts); triglycerides [mmol/L; Expression arguments are elapsed days unless hour/day-series or window indices are explicitly used; fixture horizons: main=57 d] | triglycerides | 1 | Fixture: adult men, 50 y, BMI 34 | 1 | 1 | 0 | 0 |
| change from initial value (expression defines signs and contrasts); ldl [mmol/L; day 21 (3 weeks)] | ldl | 1 | Fixture: adult men and women, 25-45 y, BMI 21-39 | 1 | 0 | 1 | 0 |
| change from initial value (expression defines signs and contrasts); ldl [mmol/L; day 28 (4 weeks)] | ldl | 1 | Fixture: adult men and women, 25-45 y, BMI 21-39 | 1 | 0 | 1 | 0 |
| change from initial value (expression defines signs and contrasts); ldl [mmol/L; day 84 (12 weeks)] | ldl | 1 | Fixture: adult men and women, 25-45 y, BMI 21-39 | 1 | 0 | 1 | 0 |
| change from initial value (expression defines signs and contrasts); scaleWeight [kg; Expression arguments are elapsed days unless hour/day-series or window indices are explicitly used; fixture horizons: main=57 d] | scaleWeight | 1 | Fixture: adult men, 50 y, BMI 34 | 1 | 1 | 0 | 0 |

## Headline comparisons

Each table lists the target with the dossier's tolerance, the engine value and the verdict. "Known miss" names the cause
and the owning module; the reason is in `KNOWN_MISSES.md`.

### Hall Body Weight Planner (oracle O-1)

The engine and the re-implemented Hall 2011 planner are fed the same person and intake for one year; the rows are the
engine minus the planner.

| cohort | body weight, 6 mo | body weight, 1 y | fat mass, 6 mo | fat mass, 1 y |
|---|---|---|---|---|
| sedentary man, −25 % | +0.38 kg | -0.12 kg | -0.56 kg | -1.56 kg |
| sedentary man, −500 kcal/d | +0.41 kg | -0.04 kg | -0.54 kg | -1.53 kg |
| sedentary man, +20 % | -0.12 kg | +0.07 kg | -0.11 kg | -0.19 kg |
| sedentary woman, −25 % | +0.51 kg | +0.39 kg | -0.33 kg | -0.93 kg |
| sedentary woman, −500 kcal/d | +0.51 kg | +0.39 kg | -0.33 kg | -0.91 kg |
| sedentary woman, +20 % | -0.17 kg | -0.21 kg | -0.13 kg | -0.29 kg |

Tolerance ±1.5 kg at 6 months and ±3 kg at 1 year; all 24 within. At one year in the deficit cohorts the engine's fat
mass is 0.9-1.6 kg below the planner's at almost the same body weight: it loses more fat and less lean than the
planner's Forbes partition, through 03's protein and activity terms.

### Minnesota semistarvation (01 §7.1)

| study / quantity | target | engine | verdict |
|---|---|---|---|
| Minnesota semistarvation — body weight at 24 wk (76 % of 69.4 kg) | 52.74 ± 2 kg | 40.0 | known miss (mapping, scenario) |
| Minnesota semistarvation — fat mass at 24 wk (34 % of 9 kg) | 3.06 ± 1 kg | 2.04 | known miss (mapping, scenario) |
| Minnesota semistarvation — weight lost (16-17 kg) | [14.7, 18.7] kg | 29.4 | direction not met |

Review D1-08: this fixture is a **mismatched-protocol challenge**, kept with its original targets: intake is a relative cut
(43.7 %) of a maintenance the engine reaches only at 2 625 instead of 3 630 kcal/d, and activity is a constant 15 000 steps
instead of the observed fall in voluntary activity (δ 26 → 9 kcal/kg/d) that Hall 2006 imposed. It is not evidence about
severe restriction in general, and no starvation coefficient is fitted to it. The protocol-matched replay (01 §7.1b, non-gating)
gives the engine and the Hall 2011 port identical inputs — the historical absolute intakes, a baseline matched to
3 630 kcal/d and the activity fall — with the unavoidable imputations recorded in the ledger (one representative man; the
walking requirement as 7 × 60-min walks; the fall's time course, linear over 24 weeks; the engine's own adaptive NEAT acting
on top of the imposed fall):

| study / quantity | target | engine | verdict |
|---|---|---|---|
| Minnesota semistarvation, matched-input replay (absolute intake, observed activity fall) — matched baseline: engine maintenance − 3 630 kcal/d (imputation check) | 0 ± 25 kcal/d | 0.008 | direction met |
| Minnesota semistarvation, matched-input replay (absolute intake, observed activity fall) — matched inputs: body weight at 24 wk (76 % of 69.4 kg) | 52.74 ± 2 kg | 43.0 | direction not met |
| Minnesota semistarvation, matched-input replay (absolute intake, observed activity fall) — matched inputs: fat mass at 24 wk (34 % of 9 kg) | 3.06 ± 1 kg | 1.95 | direction not met |
| Minnesota semistarvation, matched-input replay (absolute intake, observed activity fall) — Hall 2011 port, same inputs: body weight at 24 wk | 52.74 ± 2 kg | 45.9 | direction not met |
| Minnesota semistarvation, matched-input replay (absolute intake, observed activity fall) — engine − Hall 2011 port, same inputs: body weight at 24 wk | 0 ± 3 kg | -2.97 | direction met |

Matching the protocol closes about a quarter of the gap (40.0 → 43.0 kg). The Hall port fed the same inputs also ends well
below the target (45.9 kg), so the remaining gap is shared by both energy-balance models under this imputed time course of
the activity fall; it is reported, not tuned. The engine stays within 3 kg of the port (conditional dynamics).

### CALERIE (01 §7.3-7.4, 02 V4, 14 V3, 19 V5)

| study / quantity | target | engine | verdict |
|---|---|---|---|
| CALERIE-1 — control: weight change at 6 mo (−1.0 %) | -0.757 ± 1.5 kg | -0.00 | met |
| CALERIE-1 — CR 25 %: weight change at 6 mo (−10.4 %) | -7.873 ± 1.5 kg | -8.04 | met |
| CALERIE-1 — CR + EX: weight change at 6 mo (−10.0 %) | -7.57 ± 1.5 kg | -9.21 | known miss (review decision, energy) |
| CALERIE-1 — VLCD: weight change at 6 mo (−13.9 %) | -10.52 ± 1.5 kg | -9.75 | direction met |
| CALERIE-1 — CR: TDEE change at month 3 vs baseline (−454 ± 76 kcal/d) | -454 ± 76 kcal/d | -181 | direction not met |
| CALERIE-2 — weight change at 12 mo (−10.4 %) | -7.124 ± 1 kg | -8.12 | met |
| CALERIE-2 — weight change at 24 mo (−10.4 % maintained) | -7.124 ± 1 kg | -8.50 | known miss (calibration, energy) |
| CALERIE-1 — AT_R + AT_N at month 6 (−100 … −350 kcal/d) | [-350, -100] kcal/d | -72.6 | known miss (dossier, energy) |
| CALERIE-2 regional — waist change per kg of fat mass lost, 2 y (1.13 cm/kg) | 1.13 ± 0.28 cm/kg | 1.11 | met |
| CALERIE-2 bone — hip BMD change after 2 y (−1.75 %) | -1.75 ± 0.7 % | -2.39 | met |

Review D1-07 made the RMR response to added exercise a structural scenario that is nominally zero (no BMI slope): the
CR + EX arm now loses 9.21 kg (legacy RMR-response scenario: 8.51 kg, inside 7.57 ± 1.5). CALERIE's compensation is mostly
intake- and activity-mediated, which neither scenario models.

### Hall 2015 and Hall 2016 (01 §7.5-7.6, 04 V7, 13 V1, 05 V5)

| study / quantity | target | engine | verdict |
|---|---|---|---|
| Hall 2015 reduced-carbohydrate — RC: cumulative fat loss over 6 d (245 ± 21 g) | 0.245 ± 0.06 kg | 0.41 | known miss (ruling, fuel) |
| Hall 2015 reduced-carbohydrate — RF: cumulative fat loss over 6 d (463 ± 37 g) | 0.463 ± 0.06 kg | 0.45 | met |
| Hall 2015 reduced-carbohydrate — RF loses more fat than RC (key finding) | > 0 kg | 0.04 | met |
| Hall 2015 reduced-carbohydrate — realised energy deficit vs baseline (−810 kcal/d) | -810 ± 25 kcal/d | -810 | met |
| Hall 2015 — cumulative fat loss RF − RC (218 g; must be ≥ 109 g) | > 0.109 kg | 0.04 | known miss (ruling, fuel) |
| Hall 2016 isocaloric ketogenic diet — fat loss on KD (days 29-56) minus fat loss on BD (days 1-28) | < 0.1 kg | -0.23 | met |
| Hall 2016 isocaloric ketogenic diet — EE difference KD (days 43-56) − BD (days 15-28) | [0, 160] kcal/d | -58.2 | known miss (ruling, energy) |
| Hall 2016 isocaloric ketogenic diet — RQ change KD − BD (−0.111), non-protein approximation | -0.111 ± 0.03 RQ | -0.12 | direction met |
| Hall 2016 — extra weight loss in the first KD week vs the last baseline week (−1.6 kg) | -1.6 ± 0.4 kg | -0.65 | known miss (ruling, fuel) |
| Hall 2016 / Rosenbaum 2019 — fasting BHB in weeks 3-4 of the KD (0.77 mM) | 0.77 ± 0.231 mmol/L | 0.65 | met |

The Hall 2015 carbohydrate-restriction misses share one cause: under the fuel ruling of 30 September (18:10), muscle
glycogen stays at its fed reference outside fasts and exercise, so at 140 g/d of carbohydrate only the liver empties and
fat covers the rest of the deficit. The direction (RF loses more fat than RC) holds; the magnitude does not.

### Overfeeding: Bouchard, Diaz, Bray 2012 and the dossier 11 prototypes

| study / quantity | target | engine | verdict |
|---|---|---|---|
| Bouchard 1990 / Tremblay 1992 overfeeding — weight change after 100 d (+8.1 kg) | 8.1 ± 1.5 kg | 8.20 | met |
| Bouchard 1990 / Tremblay 1992 overfeeding — fat-mass change after 100 d (measured +5.4 kg: 6.9 → 12.3) | 5.4 ± 1.5 kg | 4.93 | direction met |
| Bouchard 1990 / Tremblay 1992 overfeeding — share of the surplus stored (Tremblay: 222 of 353 MJ = 63 %) | 63 ± 12 % | 62.5 | direction met |
| Bouchard 1990 — ΔFFM incl. glycogen and water (2.7 kg) | 2.7 ± 1 kg | 3.28 | met |
| Diaz 1992 overfeeding +50 % for 42 d — weight change after 42 d (+7.6 ± 1.6 kg) | 7.6 ± 1.5 kg | 7.56 | met |
| Bray 2012 low/normal/high-protein … — 5 % protein: weight change (+3.16 kg) | 3.16 ± 1.5 kg | 5.31 | known miss (K) |
| Bray 2012 low/normal/high-protein … — 15 % protein: weight change (+6.05 kg) | 6.05 ± 1.5 kg | 6.03 | met |
| Bray 2012 low/normal/high-protein … — 25 % protein: weight change (+6.51 kg) | 6.51 ± 1.5 kg | 5.51 | met |
| Bray 2012 low/normal/high-protein … — 15 % protein: REE change (+160 kcal/d) | 160 ± 60 kcal/d | 120 | met |
| Bray 2012 low/normal/high-protein … — 25 % protein: REE change (+227 kcal/d) | 227 ± 60 kcal/d | 167 | known miss (dossier, energy) |
| Bray 2012 — 15 % protein: lean change (+2.87 kg) | 2.87 ± 0.8 kg | 2.42 | met |
| Bray 2012 — 25 % protein: lean change (+3.18 kg) | 3.18 ± 0.8 kg | 2.26 | known miss (calibration, composition) |
| Bray 2012 — fat gain independent of protein: 25 % minus 5 % arm (0 ± 0.5 kg) | 0 ± 0.5 kg | -1.23 | known miss (dossier, energy) |
| Ravussin 1985 — ΔBW after 9 d (3.2 kg) | 3.2 ± 0.8 kg | 3.28 | met |
| Roberts 1990 — ΔBW after 21 d (2.5 kg) | 2.5 ± 0.625 kg | 2.84 | met |
| Boden 2015 — ΔBW after 7 d (3.5 kg) | 3.5 ± 0.875 kg | 5.59 | known miss (calibration, water) |
| Müller 2015 — ΔBW after 7 d (1.8 kg) | 1.8 ± 0.45 kg | 1.67 | met |
| Sagayama 2014 — ΔBW after 3 d (0.7 kg) | 0.7 ± 0.175 kg | 1.49 | known miss (mapping, water) |

Weight gain over 6-14 weeks is on target. Short (3-7 day) surpluses overshoot because the default sodium follows food
energy, so extra food brings extracellular water that the studies did not report (Sagayama, Boden).

### Water-only fasting: 7 days and the dossier 20 schedule (20 V1-V2, §4B.3, 13 V12)

| study / quantity | target | engine | verdict |
|---|---|---|---|
| Kolnes 2025 — body weight change after 7 d (−5.8 ± 0.3 kg) | -5.8 ± 0.8 kg | -5.52 | met |
| Kolnes 2025 — fat mass change after 7 d (−1.4 ± 0.1 kg) | -1.4 ± 0.5 kg | -1.21 | met |
| Kolnes 2025 — DXA-lean change after 7 d (−4.6 ± 0.3 kg) | -4.6 ± 1 kg | -4.31 | met |
| Kolnes 2025 — urinary N over 7 d (83.9 ± 6.7 g) | 83.9 ± 15 g N | 83.2 | met |
| Pietzner 2024 — weight change at the end of the fast (−5.7 ± 0.8 kg) | -5.7 ± 1 kg | -5.31 | met |
| Pietzner 2024 — fat change at the end of the fast (−1.6 ± 1.3 kg) | -1.6 ± 1.3 kg | -1.17 | direction met |
| Pietzner 2024 — weight change 3 d after refeeding (−3.1 ± 0.6 kg) | -3.1 ± 0.8 kg | -3.59 | met |
| Pietzner 2024 — lean change 3 d after refeeding (−0.69 ± 0.49 kg) | -0.69 ± 0.6 kg | -2.15 | known miss (mapping, fasting) |
| dossier 20 §4B.3 model — 168 h: weight change (-5.7 kg) | -5.7 ± 0.855 kg | -5.78 | met |
| dossier 20 §4B.3 model — 168 h: fat change (-1.3 kg) | -1.3 ± 0.325 kg | -1.23 | met |
| dossier 20 §4B.3 model — 7 d: DXA-lean change (−4.4 kg) | -4.4 ± 1 kg | -4.55 | met |
| dossier 20 §4B.3 model — 3 d after the 7-d fast: weight change vs baseline (−2.6 kg) | -2.6 ± 0.8 kg | -2.89 | met |
| dossier 20 §4B.3 model — 24 h: weight change (-1.6 kg) | -1.6 ± 0.24 kg | -0.86 | known miss (review decision, fasting) |
| dossier 20 §4B.3 model — 48 h: weight change (-2.7 kg) | -2.7 ± 0.405 kg | -2.32 | met |
| dossier 20 §4B.3 model — 72 h: weight change (-3.5 kg) | -3.5 ± 0.525 kg | -3.32 | met |
| dossier 20 §4B.3 model — 504 h: weight change (-11 kg) | -11 ± 1.65 kg | -10.9 | met |
| Kerndt 1982 — week-1 weight-loss rate (0.9 kg/d) | 0.9 ± 0.2 kg/d | 0.75 | met |
| Kerndt 1982 — week-3 weight-loss rate (0.3 kg/d) | 0.3 ± 0.2 kg/d | 0.28 | met |

### Fasting ketones (20 V8, 05 V1/V4, 20 §4B.3)

| study / quantity | target | engine | verdict |
|---|---|---|---|
| Browning 2012 / McDougal 2018 / Klein 1993 — men: BHB at 24 h (0.41 mM) | 0.41 ± 0.123 mmol/L | 0.50 | met |
| Browning 2012 / McDougal 2018 / Klein 1993 — men: BHB at 48 h (1.94 mM) | 1.94 ± 0.582 mmol/L | 1.71 | met |
| Browning 2012 / McDougal 2018 / Klein 1993 — men: BHB at 72 h (2.3 mM) | 2.3 ± 0.69 mmol/L | 2.44 | met |
| Browning 2012 / McDougal 2018 / Klein 1993 — women: BHB at 24 h (0.33 mM) | 0.33 ± 0.099 mmol/L | 0.66 | known miss (dossier, ketones) |
| Browning 2012 / McDougal 2018 / Klein 1993 — women: BHB at 48 h (1.22 mM) | 1.22 ± 0.366 mmol/L | 1.82 | known miss (dossier, ketones) |
| Browning 2012 / McDougal 2018 / Klein 1993 — women: BHB at 72 h (2.3 mM) | 2.3 ± 0.69 mmol/L | 2.47 | met |
| McDougal 2018 — BHB at 12 h (0.1 mM) | 0.1 ± 0.15 mmol/L | 0.11 | met |
| McDougal 2018 — BHB at 72 h (2.3 mM) | 2.3 ± 0.69 mmol/L | 2.44 | met |
| Owen & Reichard 1971 / Balasse 1979 — BHB at 3 d (2.23 mM) | 2.23 ± 0.669 mmol/L | 1.59 | met |
| Owen & Reichard 1971 / Balasse 1979 — BHB at 24 d (5.29 mM) | 5.29 ± 1.587 mmol/L | 5.30 | met |
| dossier 20 §4B.3 model — 168 h: BHB at the end (3.7-4.3 mM) | [2.59, 5.59] mmol/L | 4.21 | met |
| dossier 20 §4B.3 model — 504 h: BHB at the end (5.4-6 mM) | [3.78, 7.8] mmol/L | 6.03 | met |

The same engine, with each fast starting after a normal day that ends with a 20:00 dinner (hours counted from that meal; the lean-man row equals the §4B.3 rows above, the obese-woman row and the nutritional-ketosis table below are from the 1 October run):

| person | 24 h | 48 h | 72 h | day 7 | day 21 |
|---|---|---|---|---|---|
| lean man (Table A1) | 0.50 | 1.71 | 2.44 | 4.21 | 6.03 |
| obese woman (Table A3) | 0.35 | 1.12 | 1.53 | 2.96 | 5.50 |

Nutritional ketosis (lean man, 4 weeks, BHB in mmol/L):

| carbohydrate | energy | first morning ≥ 0.5 mM | week-4 07:00 | week-4 24-h mean |
|---|---|---|---|---|
| 20 g/d | maintenance | day 3 | 0.69 | 0.54 |
| 30 g/d | maintenance | day 4 | 0.64 | 0.49 |
| 50 g/d | maintenance | day 6 | 0.55 | 0.40 |
| 20 g/d | 75 % | day 2 | 1.16 | 0.90 |
| 30 g/d | 75 % | day 2 | 1.04 | 0.79 |
| 50 g/d | 75 % | day 3 | 0.84 | 0.61 |

The women's 24- and 48-hour values miss because two dossier sources disagree on the sign of the sex difference (Haymond:
women higher; Browning: women lower); no shared parameter set satisfies both.

### Novice hypertrophy (09)

| study / quantity | target | engine | verdict |
|---|---|---|---|
| Benito 2020 — untrained: lean-tissue change after 10.4 wk (+1.54 kg) | 1.54 ± 0.4 kg | 1.52 | met |
| Benito 2020 — trained (TS₀ 0.45): lean-tissue change after 10.4 wk (+0.98 kg) | 0.98 ± 0.4 kg | 0.85 | met |
| Morton 2018 — FFM gain ratio, supplemented / control (1.27) | 1.27 ± 0.15 ratio | 1.16 | met |
| Peterson 2011 — lean-tissue change after 20.5 wk (+1.1 kg) | 1.1 ± 0.4 kg | 0.96 | met |
| Novice strength gain after 12 weeks of RT — strength index change after 12 wk (19-27 %, ±3) | [16, 30] % | 16.9 | met |
| McDonald / Aragon-Helms heuristics — year 1 gain (9-11 kg) | [9, 11] kg | 9.27 | met |
| McDonald / Aragon-Helms heuristics — year 2 gain (4.5-5.5 kg) | [4.5, 5.5] kg | 3.80 | known miss (structure, muscle) |
| Helms 2023 — training-attributable muscle gain at +15 % minus at maintenance (≈ 0) | [-0.201, 0.201] kg | 0.01 | met |
| Ogasawara / Psilander (09 #12), novice — gain remaining 20 weeks after 10 wk of RT (0.18) | 0.18 ± 0.2 (Q) | 0.20 | in direction |
| 09 #12 re-expressed (R-DETRAIN), long-term lifter — share of the losable trained gains lost in 3 weeks off (≤ 3 %) | [-0.01, 0.03] | 0.006 | met |
| 09 #12 re-expressed (R-DETRAIN), long-term lifter — share of the losable trained gains lost after 20 weeks off (0.82) | 0.82 ± 0.1 | 0.81 | met |

### Lean retention in a deficit: training and protein (03, 09)

| study / quantity | target | engine | verdict |
|---|---|---|---|
| Murphy & Koehler 2022 — deficit at which the 12-wk lean change crosses zero (500-700 kcal/d) | [500, 700] kcal/d | 727 | known miss (review decision, activity) |
| Villareal 2017 — RT arm: DXA lean-mass change after 6 mo (−1.0 kg) | -1 ± 0.8 kg | -0.41 | met |
| Villareal 2017 — aerobic arm: DXA lean-mass change after 6 mo (−2.7 kg) | -2.7 ± 0.8 kg | -1.56 | known miss (structure, composition) |
| Villareal 2017 — RT loses less lean than aerobic (direction) | > 0 kg | 1.16 | met |
| Ballor & Poehlman 1994 — diet only: FFM share of the loss (24-28 %) | [24, 28] % | 11.6 | known miss (structure, composition) |
| Ballor & Poehlman 1994 — diet + RT: FFM share of the loss (11-13 %) | [11, 13] % | 2.89 | known miss (dossier, muscle) |
| Ballor & Poehlman 1994 — FFM share with exercise is 0.25-0.5 of the diet-only share | [0.25, 0.5] ratio | 0.25 | met |
| Longland 2016 deficit + RT/HIIT — CON: lean-mass change (+0.1 ± 1.0 kg) | 0.1 ± 1 kg | -0.56 | met |
| Longland 2016 deficit + RT/HIIT — PRO: lean-mass change (+1.2 ± 1.0 kg) | 1.2 ± 1 kg | -0.35 | known miss (K) |
| Longland 2016 deficit + RT/HIIT — between-group lean difference PRO − CON (observed 1.1 kg, target ≥ 0.4 kg) | > 0.4 kg | 0.21 | known miss (ruling, composition) |
| Mettler 2010 — LBM loss ratio, high protein / control (≤ 0.5) | < 0.5 ratio | 1.00 | known miss (ruling, muscle) |
| Wycherley 2012 / Krieger 2006 / Kim 2016 — FFM retained by high protein (HP − SP lean-tissue change, 0.3-0.9 kg) | [0.3, 0.9] kg | -0.02 | known miss (structure, energy) |
| Pasiakos 2013 — lean share of the loss: 0.8 g/kg > 1.6 g/kg (share difference, > 0) | > 0 fraction | 0.08 | met |
| Morton 2018 — FFM added by raising protein 1.2 → 1.6 g/kg (0.1-0.5 kg) | [0.1, 0.5] kg | 0.49 | met |
| Garthe 2011 — slow loss gains more lean than fast loss (percentage points, > 0) | > 0 % points | 0.18 | met |

Resistance training protects lean mass in the right direction and by roughly the right amount in obese and older
adults; the added benefit of high protein in a deficit is too small (Longland, Mettler, Wycherley). Two rulings decide
this: R-PROT2 set the protein ceiling ρ_max to its registry low (it met the Murphy zero-crossing until the review release),
and R-RT gives the training effect on lean to 09 alone. Review D3-08 books one finite recovery budget per resistance bout
instead of a 72-hour post-exercise REE rectangle, so each session costs less and Murphy's zero crossing moves to 727 kcal/d
(the research rectangle gives 669, inside 500-700): a registered review-decision miss.

### Liver fat (06)

| study / quantity | target | engine | verdict |
|---|---|---|---|
| Browning 2011 — hypocaloric mixed diet: liver-fat change after 14 d (−28 %) | -28 ± 10 % | -15.0 | known miss (mapping, cardiometabolic) |
| Browning 2011 — low-carbohydrate: liver-fat change after 14 d (−55 %) | -55 ± 10 % | -14.4 | known miss (mapping, cardiometabolic) |
| Mardinoglu 2018 — liver-fat change after 14 d (−43.8 %) | -43.8 ± 10 % | 0.79 | known miss (structure, cardiometabolic) |
| Lim 2011 — IHTG at 8 weeks (2.9 %) | 2.9 ± 0.58 % | 3.87 | known miss (review decision, cardiometabolic) |
| Luukkonen 2018 — SFA overfeeding: liver-fat change (+55 %) | 55 ± 15 % | 45.7 | met |
| Luukkonen 2018 — unsaturated overfeeding: liver-fat change (+15 %) | 15 ± 15 % | 12.5 | met |
| Luukkonen 2018 — sugar overfeeding: liver-fat change (+33 %) | 33 ± 15 % | 22.7 | met |
| Magkos 2016 — IHTG at −5.1 % weight (7.4 %) | 7.4 ± 1.11 % | 6.11 | known miss (dossier, cardiometabolic) |
| Magkos 2016 — IHTG at −10.8 % weight (4.1 %) | 4.1 ± 0.615 % | 4.06 | met |
| Magkos 2016 — IHTG at −16.4 % weight (3.0 %) | 3 ± 0.45 % | 2.66 | met |

Review D7-08 switched off the permanent independent −0.4·Δketosis term of the sustained liver-fat target (uncertain-response
status from the first ketogenic day, not a claim of zero biology): Lim's VLCD arm now ends at 3.87 % (the labelled
early-composition scenario gives 2.60 %, inside 2.9 ± 0.58 %), Browning's low-carbohydrate arm equals its weight-loss-only
response and Mardinoglu's isocaloric arm no longer loses liver fat. Early and sustained effects are separate targets in the
module's validation tests (Kirk 2009 48 h vs about 11 weeks); a simulated liver-fat fall never clears a fibrosis flag.

### Lipids and blood pressure (06, 20 V10)

| study / quantity | target | engine | verdict |
|---|---|---|---|
| Mensink 2016 — SFA → PUFA: LDL change (−0.55 mmol/L) | -0.55 ± 0.1375 mmol/L | -0.60 | met |
| Mensink 2016 — carbohydrate → SFA: LDL change (+0.36 mmol/L) | 0.36 ± 0.09 mmol/L | 0.37 | met |
| Mensink 2016 — carbohydrate → SFA: HDL change (+0.11 mmol/L) | 0.11 ± 0.0275 mmol/L | 0.11 | met |
| Mensink 2016 — carbohydrate → SFA: TG change (−0.12 mmol/L) | -0.12 ± 0.03 mmol/L | -0.12 | met |
| Skulas-Ray 2011 — 3.4 g/d: TG change after 8 wk (−27 %) | -27 ± 8 % | -27.5 | met |
| Buren 2021 / Retterstøl 2018 vs … — lean woman: LDL change after 4 wk (+1.81 mmol/L; sign and order) | [0.9, 3.6] mmol/L | 0.05 | known miss (review decision, cardiometabolic) |
| Buren 2021 / Retterstøl 2018 vs … — normal-weight adult: LDL change after 3 wk (+0.9 mmol/L; sign and order) | [0.45, 1.8] mmol/L | 0.07 | known miss (review decision, cardiometabolic) |
| Buren 2021 / Retterstøl 2018 vs … — BMI 39 with ≈ 10 % loss: LDL change (−0.26 mmol/L; sign and order) | [-0.52, -0.13] mmol/L | 0.06 | known miss (dossier, cardiometabolic) |
| DIETFITS — low-fat: LDL change (−2.1 mg/dL) | -2.1 ± 4 mg/dL | -6.77 | known miss (dossier, cardiometabolic) |
| DIETFITS — low-carbohydrate: LDL change (+3.6 mg/dL) | 3.6 ± 4 mg/dL | -4.61 | known miss (dossier, cardiometabolic) |
| DIETFITS — low-fat: TG change (−10 mg/dL) | -10 ± 4 mg/dL | -6.78 | met |
| Sävendahl 1999 — 7-d fast: LDL change (+66 %) | 66 ± 19.8 % | -0.1 | known miss (structure, cardiometabolic) |
| Sacks 2001 — SBP change after 4 weeks (−6.7 mmHg) | -6.7 ± 1.5 mmHg | -3.22 | known miss (dossier, cardiometabolic) |

Most lipid misses are dossier conflicts: the per-kilogram weight-loss slopes for LDL, triglycerides and blood pressure
that fit one trial (DIETFITS) do not fit another (Magkos, the ketogenic LDL series, Neter's meta-analysis). Review D7-07
turned the lean-responder LDL rise (LEM) into an exploratory adverse-response scenario, off by default: a ketogenic LDL
response is now marked uncertain (not zero) from the first ketogenic day, the lean and normal-weight Buren/Retterstøl rows
miss (with LEM on they meet +1.26 and +0.91 mmol/L), and the 7-day fasting LDL and ApoB rows lose the rise LEM gave them.

### Leptin, T3 and testosterone (12, 07)

| study / quantity | target | engine | verdict |
|---|---|---|---|
| Weigle 1997 — leptin change at 72 h (−62 %; engine −50 … −75 %) | [-75, -50] % | -65.6 | met |
| Chan 2003 — leptin change (−90 %) | -90 ± 15 % | -52.0 | known miss (K) |
| Dubuc 1998 — men: leptin change (−36 %) | -36 ± 15 % | -45.1 | met |
| Dubuc 1998 — women: leptin change (−61 %) | -61 ± 15 % | -64.6 | met |
| Müller 2015 — leptin change at the end of restriction (−44 %; engine −35 … −55 %) | [-55, -35] % | -53.2 | met |
| Müller 2015 — T3 change (−39 %; engine −20 … −40 %) | [-40, -20] % | -24.9 | met |
| Müller 2015 — testosterone change (−11 %; engine 0 … −20 %) | [-20, 0] % | -6.30 | met |
| Chan 2003 — T3 change (−30 %) | -30 ± 15 % | -33.7 | met |
| Chan 2003 — testosterone change (−40 %) | -40 ± 15 % | -34.7 | met |
| Friedl 2000 / Henning 2014 — testosterone change at day 56 (−70 %; engine −55 … −80 %) | [-80, -55] % | -10.7 | known miss (structure, hormones) |
| Pardue 2017 / Rossow 2013 — testosterone change at the end of preparation (−60 … −80 %) | [-80, -60] % | -74.1 | met |
| Pardue 2017 / Rossow 2013 — T3 change at the end of preparation (≥ −45 %; observed 123 → 40 ng/dL) | [-45, 0] % | -48.6 | known miss (dossier, hormones) |
| Ebbeling 2012 — leptin, very-low-carbohydrate / low-fat (≤ 0.8) | < 0.8 ratio | 0.79 | met |
| Ebbeling 2012 — T3, very-low-carbohydrate / low-fat (≤ 0.9) | < 0.9 ratio | 1.00 | known miss (ruling, hormones) |

## Parameter sensitivity ranges against dossier 16 (1 October run)

Review D8-02: these ranges are **parameter-sensitivity ranges with unvalidated coverage**, not predictive intervals. Quantiles
come from the stochastic members only (the nominal run is reported separately), the keto heavy-tail selector is a uniform
latent quantile (its 25 % branch is a design mixture, not a population incidence), and the draw/correlation contract is in
the registry hash. True predictive intervals would need justified input-error, discrepancy and response distributions and
untouched outcomes; none is claimed. The numbers below are from the 1 October run and were not regenerated for this release.

The ensemble draws every registry parameter with a range (Latin hypercube, 32 draws, seed 1) plus a person-level RMR
deviation from the prediction equation (`energy.rmrIndividualFrac`, ±20 %, 02 §4.1 / 16 §4.11), added in this pass
because without it the RMR and fat bands were far narrower than the between-person spread (fat ±7 %). Half-width of the
P10-P90 band at the end of each scenario, as a percentage of the nominal change (or value for RMR and TEE):

| scenario (MAN, 12 weeks unless stated) | fat change | lean change | skeletal muscle | RMR (value) | TEE (value) | other |
|---|---|---|---|---|---|---|
| 25 % deficit, 3 RT sessions/wk, 1.6 g/kg protein | ±18 % (−7.0 kg) | ±0.57 kg (Δ −0.13 kg) | ±0.39 kg | ±9.4 % | ±5.6 % | scale ±23 %; RT muscle gain ±99 % |
| 15 % surplus, 3 RT sessions/wk, 1.8 g/kg | ±1.2 kg (Δ −0.23 kg) | ±53 % (+2.0 kg) | ±54 % | ±8.8 % | ±4.8 % | RT muscle gain ±53 % |
| very low carbohydrate at maintenance, 72-h fast on day 21 (day 24) | ±0.37 kg | ±16 % (DXA lean) | ±27 % | ±10.9 % | ±7.4 % | BHB ±33 %; hunger P10-P90 14-70 |

Against dossier 16's between-person spread (fat change ±35 %, lean change ±50 %, RMR ±13 %): lean and RMR are of the
same size; fat change is about half as wide. That is expected: the ensemble carries physiological parameter
uncertainty only, while dossier 16's spread also contains adherence and measurement error, which the engine does not
simulate. Where a nominal change is near zero (lean in the deficit arm, fat in the surplus arm), the relative width is
meaningless and the absolute band is shown. The hunger band after a fast is wide because the fasting-hunger width
parameter is drawn over 12-36 h. Triglycerides after the fast have a wide, left-skewed change band (−1.10 to −0.25 mmol/L
from a 1.0 mmol/L nominal baseline); rebuilt as a value band (nominal baseline + change quantile) its lower edge would
fall below zero, so this series should be shown as a change only, as the catalogue already specifies
(`deltaFromBaseline`).

## Performance and determinism

Timings below are from the review-release run (19 October 2026, machine load 0.16 per core). O-11 is measured on the production bundle (Vite build of the benchmark entry) in the test process: one 180-day run of the
reference man on a training week, best of 15 after warm-up, all 16 modules.

| mode | best | median | bound |
|---|---|---|---|
| planner (goal series only) | 6.5 ms | 6.9 ms | 10 ms |
| simulate, record `none` | 8.2 ms | 9.4 ms | 15 ms |
| simulate, record `daily` | 9.6 ms | 10.4 ms | 15 ms |
| simulate, record `full` (hourly arrays, warnings, events) | 9.7 ms | 10.5 ms | 15 ms |

Under the Vitest transform (not gating) the same run takes 13.2 ms. The test records the machine load and skips, rather
than fails, when the host is saturated (more than 0.5 runnable tasks per core after a retry), so a busy CI machine cannot
produce a false regression; on an idle machine the bounds gate.

Determinism: identical inputs give bit-identical results for three personas; restoring the post-burn-in snapshot is
bit-identical to running the burn-in (all 16 modules, two schedules; also planner snapshots per draw); ensemble draws are
identical whatever the worker count, chunking and order (1 × 8, 3 + 3 + 2 reversed, 8 × 1 interleaved).

## Invariants

| invariant | what is checked | result |
|---|---|---|
| O-4 conservation | hourly energy identity ≤ 1e-6 kcal, daily ≤ 1 kcal, scale = fat + lean + labile water ≤ 1e-9 kg, in every arm of every scenario and three personas on mixed schedules | pass |
| O-5 morning anchor | the day-0 wake-hour scale weight equals the entered weight (± 0.05 kg; worst 3 g) in every arm whose first night is the habitual one | pass |
| O-6 zero intake | 21- and 28-day water-only fasts: finite series, no negative pools, monotone fat mass, finite BHB | pass |
| O-7 determinism | as above | pass |
| O-8 R-NOINS | isocaloric carbohydrate → fat swaps (10-30 %E) and 1 vs 3 meals/d do not change expenditure or fat balance | pass |
| O-9 R-SEQ | permuting the same weekly blocks moves 12-week fat by < 0.2 kg | pass |
| O-12 steady state | 78 persona × habitual-schedule cells at maintenance for 30 d: \|ΔFM\| < 0.15 kg, \|Δscale\| < 0.3 kg (worst ΔFM −0.04 kg) | pass |
| flux agreement | every daily series equals the catalogue aggregation of its hourly series | pass |
| D1-08 model limit | a 120-day water fast of a very lean man ends at a numerical tissue floor: the energy and mass identities hold up to the last committed hour, no value after it is recorded, fat mass carries the model-limit status | pass |
| D2-05 nitrogen boundary | 4-day water fast: body-N change = −urinary-N prior within 2 % on full fast days (no second fecal subtraction); lean tissue, protein and scale move by different amounts | pass |
| D5-03 correction ledger | a zero correction reproduces the uncorrected run bit for bit; the intake echo keeps the logged intake; zero-energy days are skipped with a reason; conservation holds | pass |
| D6-02 / D6-08 ingestion audit | every submitted kcal is registered and appears or stays in the gut (imbalance ≤ 1e-6 kcal); no generic fibre/nut ME correction; no drift on a high-fibre maintenance diet | pass |
| D8-01 recording masks | bone alone = bone + micronutrient score (postmenopausal woman, 180-d deficit); singleton, pair and random masks change no shared output, safety trace or final value; capture/continue under one mask = uninterrupted run, another mask rejected | pass |
| D8-07 signal hooks | every hook declaration matches the signal registry and module order; SIGNAL_META writer/reader hooks and lags agree with the modules that declare hooks (activity and muscle do not declare theirs yet: checked against the module order only) | pass |

## Known misses, grouped by cause

**Consequences of rulings (21).** The largest group is the fuel ruling of 30 September (18:10): meal glucose refills
muscle glycogen before it is oxidised, and only glycogen above the fed reference is mobilised. It removes an unphysical
drift but means muscle glycogen barely falls on low-carbohydrate diets, so the first-week weight loss of a ketogenic
switch (Hall 2016, Yang), the water share of that loss, Hall 2015's carbohydrate-restriction fat balance and Schrauwen's
fat-balance lag are all too small. The others: gluconeogenesis cost set to zero (M5), alcohol TEF 0.10 (R-ALC), the
protein ceiling ρ_max 0.5 (R-PROT2), the training effect on lean given to 09 only (R-RT), Bray's 5 %-protein arm (R-BRAY)
and the T3 carbohydrate knee at 50 g/d (R-T3).

**Dossier conflicts (31).** Two sources give targets that no parameter set inside the registry can meet together:
per-kilogram lipid and blood-pressure slopes (DIETFITS against Magkos, Neter and the ketogenic LDL series), the sex
difference in fasting ketosis (Haymond against Browning), uric acid during fasting (dossier 06's form against dossier
20's observations), Bray's REE against its fat-gain row, and conventions that differ between dossiers (03's lean on a
hydrated-DXA basis against Hall's lean tissue in the nitrogen rows; dossier 07's tighter tolerance against dossier 20's
own model for Laurens).

**Consequences of review decisions (10).** The 18 October review switched mechanisms without validated personal magnitude to
labelled scenarios that are off in the standard projection, or removed a future-dependent routing: D2-01 (the planned-span
fasting switch read the fast's future length: 24-h fast weight and nitrogen, weekly-fast peak N), D1-07 (zero nominal RMR
response to exercise: CALERIE CR + EX), D3-08 (no 72-hour post-RT REE rectangle: Murphy's zero crossing), D6-08 (no generic
fibre/nut ME correction: Karl, Novotny), D7-07 (LEM off: two ketogenic LDL rows), D7-08 (no sustained keto liver-fat term:
Lim). Each row names its decision and the legacy scenario under which it met its target; the suite re-runs that scenario.
Meeting a target under a scenario fitted to the same study is a development fit, so these rows are not lost validation.
Several older registered rows moved for the same reasons (Sävendahl LDL/ApoB, Browning, Mardinoglu, Donnelly); their
register notes say so.

**Model structure (24).** Mechanisms that v1 does not have or simplifies: indirect-pathway liver glycogen synthesis
after a meal, glucose-first oxidation above the muscle reference during carbohydrate loading, the 60 g/h absorption cap,
a fasting-specific LDL rise, age and insulin-resistance terms in ketogenesis, protein deposition that should not occur
from a fat-only surplus, age-related waist drift, the leptin-threshold route to hypogonadism outside contest leanness.

The four newest rows are the R1 activity-intake archetypes against the FAO/WHO lifestyle PAL table (R1-V1, owner activityIntake): PAL0 = TDEE0/RMR0 is 1.39 for man and woman desk-little-moving (target 1.4-1.5) and 1.682 / 1.681 for man and woman on feet (retail) (target 1.7-1.9). R1 computed its archetype table with a TEF fraction alpha0 = 0.10; the engine solves alpha0 from the NHANES habitual macro split (02 §4.4, about 0.087), so every PAL0 is about 1.4 % below R1's (1.41 and 1.71). The walking-delivery on-feet archetype passes (1.77). Register: `knownMisses.ts`, keys `R1-V1-fao-lifestyle-pal/*`.

**Scenario mapping (13).** Minnesota is now a mapping row (D1-08 mismatched-protocol challenge; see its section). The study cannot be expressed exactly: a resting calorimeter day (Acheson), unreported
sodium intake in short overfeeding studies, ad-libitum refeeding with unreported intake (Pietzner), the combined
stressors of military courses (Nindl), a performance index that is not a race time (Burke 2017).

**Open calibration items (10; 12 rows have class open).** A parameter change inside its registry range would close the row but breaks another
target. Examples: fuel's liver capacity cLMax 420 would fix Rothman's post-meal liver glycogen but moves 05 V3 Deru's
exercise-arm time to ketosis out of its band (tested in the final round; not applied — cMMax 180 was applied and closes
Bussau's supercompensation row); the fasting labile-protein repletion that would fix Templeman breaks the weekly-fast
protein row; r_S 0.50 fixes Bray's high-protein lean gain but breaks Levine.

## Review release (18-19 October 2026)

Waves 0-2 of the algorithm review changed the engine (contracts C1-C7: realised history, exposure ledger, measurement
operators, safety certificates, goal capability, uncertainty labels, versions). Validation consequences:

- **Evidence ledger (D8-03).** Every scenario carries study/cohort ids, arms, outcomes, evidence class, dataset role, the
  parameters whose cited source names the study, observed/protocol/imputed inputs, population, endpoint operator, tolerance
  type and source, and protocol fidelity. The registry check fails on a missing role, tolerance type, study id or input
  record and on study-level split leakage; a frozen-model external evaluation stays valid for the version it evaluated after
  it is read, and a later revision tuned on it is development for that revision. This release has no independent holdout,
  so every study row is development (estimation 101 scenarios, calibration 56) and none is presented as external validation.
- **Seven must-pass rows became review-decision misses** (D1-07, D3-08, D6-08 ×2, D7-07 ×2, D7-08; plus the three D2-01 rows
  of 18 October). Tolerances are unchanged; each passes under its named legacy scenario.
- **Minnesota (D1-08)** is labelled a mismatched-protocol challenge and gets a non-gating matched-input replay in the engine
  and the Hall port (above). The Hall port gained an optional activity-coefficient time course (`deltaScale`) for it.
- **Uncertainty (D8-02).** Bands are parameter-sensitivity ranges with unvalidated coverage everywhere they are reported.
- **Activity-intake snapshot regenerated (wave 3).** `src/content/evidence/validation/activityIntake.snapshot.json` was
  stale against the wave-2 engine and was regenerated with its documented flag; no tolerance was widened. Every row still
  passes its band. The NASEM "very active" rows moved from −27.1 to +62.6 kcal/d (men, band 0 ± 342) and from +32.9 to
  +97.2 kcal/d (women, band 0 ± 250); the likely cause is the wave-1/2 change to exercise energy accounting (C7), not
  confirmed row by row.
- **New invariants** (table above): model-limit termination, nitrogen boundary, correction ledger, ingestion audit,
  recording-mask and snapshot equivalence, signal-hook metadata.
- **Carbohydrate currency (D2-04, deferred).** The production substrate solver is not replaced; diagnostic tests pin the
  declared bases (glycogen glucosyl 0.162 g/mmol vs free glucose 0.180 g/mmol; 4/4.207 is an energy conversion, not
  carbon stoichiometry), and the fuel rows stay development checks with their known misses.
- **Planner (D4-08, D4-09).** The planner benchmark compares the frozen v1 comparator with the shipped route under the
  versioned production comparison policy, against the versioned reference set `review-policy-v1` (historical references
  read-only); the coverage audit reports search misses as "no plan found within the search budget", never as proof that no
  safe plan exists, and counts the generic endurance index and the micronutrient score among the goals the planner refuses.
- **Planner release checks, recorded as run (nothing tuned).** Benchmark, tier S, train split first (development; run
  6hd2sz) and held-out split once for the release decision (run 1sqatkt): the shipped route under comparison policy 2 is
  **not shown non-inferior** to the frozen v1 comparator on full requests (held-out lex-success −1.7 points, one-sided
  lower bound −4.4 against the 2-point margin; train −5.3, bound −9.3), while its ladder hypervolume is better (0.657 vs
  0.473) and no returned plan broke a safety limit. Coverage audit at integration: the level matrix passes. Requests b
  and fuzz0 still find a weaker Hard in the exhaustive search than in the standard one (goal-1 share 0.150 vs 0.165 and
  −0.001 vs 0.812, both below the least worthwhile change); the standard search's Medium and Easy are no longer dropped
  silently but stated as carried-rung failures under that Hard (§12.1). By design only a stopped search weighs the earlier
  Hard, so the weaker exhaustive Hard itself is unchanged. Two more rules are flagged for review and two levers (diet
  break, refeed day) are no longer used or explained. The release decision on these planner results belongs to the
  planner owner; see docs/PLANNER_BENCHMARK.md and docs/PLANNER_COVERAGE.md.

## Blocker-round changes (release check, 1 October 2026)

- **R-DETRAIN** (muscle, MODEL_SPEC §1.9) — detraining (09 §4.10: no loss for about 3 weeks after the last session, then
  τ 70 d) now decays towards a retained floor. The untrained, FFMI-derived set-point is never detrained (a habitual lifter's
  trained gains are what the body carries above the untrained FFMI reference, at least dossier 14's training offset for
  the stated years), and a long-term lifter keeps `detrainFloorFrac` = 0.5 (grade C, PROPOSED; range 0.3-0.7) of them.
  Gains made inside a run detrain fully (Psilander), so the novice #12 rows keep their literal target; two must-pass rows
  re-express #12 for a long-term lifter (0.6 % of the losable gains lost in 3 weeks; 81 % after 20 weeks, target 82 ± 10).
  The QA reproduction (man, 34 y, 88 kg, 1-3 training years, 3 lifts/week, a schedule without lifts at 100 %): lean mass
  −3.97 → −1.05 kg at 8 weeks, −8.62 → −2.23 kg at 20 weeks; fat +0.84 → +0.13 kg at 8 weeks. Changed rows: 19-V10 Nindl
  (registered strength miss −4.1 → −2.6 %, FFM Q −5.6 → −4.4 kg, body mass Q −8.5 → −7.7 kg) and 02-V7 ICECAP (Q); no row
  changed status.
- **R-REGAIN** (muscle, §1.9; coordinator ruling after the blocker report) — lost muscle below the previous peak is
  regained at dossier 09's full retraining rate (training-status gap, habituation, memory boost κ_mem now 1.3 by default),
  capped at the peak; above it the habitual-equilibrium form is unchanged. The QA lifter, 12 weeks off (−1.60 kg) and then
  back on the habitual programme: 76 % regained after 16 weeks (was 10 %), 100 % after 26 weeks (was 19 %). Only 09 #13
  Bickel moved (old, 1/9 dose: 0.30 → 0.35 of the gain kept, still < 0.9); no registered row moved.
- **"Training as usual"** (`DayTemplate.habitualTraining`, MODEL_SPEC §5.2): the profile's habitual sessions by weekday;
  12 weeks at 100 % on the habitual diet are weight- and lean-stable for sedentary, lifting, running and mixed profiles.
- **Keto-adaptation index** (ketones, §1.7/§6): the displayed metric is 50·(A_f + A_s) — fast (days) and slow (weeks)
  adaptation counted half each — about 50 at day 7 of a ketogenic diet and 55-65 after 3-4 weeks (was 94-96 by day 7);
  both components are detail series. No validation row reads the metric.
- **Fast warnings** (safety, §7.2): the tier rules and their reported length use the planned meal-to-meal duration; a
  "72 h" fast now reads 72 h (was 71 h) and a 72-h fast without a refeed plan gets W-F08 (it was missed).
- **VLC → high-carbohydrate switch** (QA: fat −0.8, lean −4.3 kg in 8 weeks, 88-kg man, 3 lifts/week): the detraining
  bug (no lifts were painted), not a partition problem — with the lifts painted lean tissue is −0.05 kg after the 4 VLC
  weeks and −0.09 kg after 8 weeks, fat −1.97 kg (the VLC lean-mass dip of −1.9 kg is glycogen and water); without lifts
  lean tissue −1.34, fat −1.48 kg now.

## Final-round changes (engine pass after end-to-end QA, 30 September 2026)

- **R-MAINT** — "% of maintenance" now means weight-stable at the activity the schedule plans (MODEL_SPEC §5.2). Study
  scenarios whose protocols set intake relative to the baseline intake while adding or removing exercise keep that meaning
  with `activity: 'habitual'` (CALERIE-1 CR + EX, MET-2's unchanged intake, Deru 2021's standardised meal, Veldhorst's
  glycogen-lowering ride, Pasiakos's −30 % diet + 10 % exercise); 10 V16's detraining arm uses 100 % instead of 92 %.
  Studies fed "at energy balance" with training (Garthe, Helms, Benito, Peterson, the McDonald heuristics, Burke 2017) now
  get the training's energy: McDonald year 1 passes (9.27 kg), Pardue's T3 (−46.9 %) and Burke 2017's index gap move
  within their registered misses. 10 V22 (VAT without weight loss) is now a registered miss: its arm had been losing
  ≈ 1.5 kg of fat because the reference ignored the training; truly weight-stable, VAT follows fat mass only (dossier 06
  §4.10's exercise term is not implemented).
- **R-RTSWITCH** (composition) — surplus lean gain is non-decreasing in resistance-training volume (a trained lifter at
  +10 % gained less lean at 8-12 than at 4 sets/week); no gated row changed status.
- **R-KETEX** (ketones) — exercise effects on ketone turnover wane at high ketonaemia; no 05/20 row moved beyond 0.3 %.
  The ketone fit table (fasting 24 h/48 h/72 h/d 7/d 21 lean man 0.50/1.71/2.44/4.21/6.03 mM; first morning ≥ 0.5 mM at
  20/30/50 g/d on day 3/4/6, in a 25 % deficit day 2/2/3) is unchanged.
- **fuel.cMMax 200 → 180** (registry low): 04 V4 Bussau's 72-h ratio passes (2.60 vs 2.33 ± 0.35); Boden and the other
  Bussau rows move within their registered misses.
- **Maintenance TH_C reference**: carbohydrate-overfeeding thermogenesis starts above the day's maintenance at the planned
  activity (Mikkelsen's 24-h EE difference 94 → 118 kcal/d, target 80-120, still met; Martin 2019 moves within its band).
- **Performance (O-11)**: bundled engine, best of 15 at host load ≈ 0.4 per core (other sessions running): planner 7.1-7.7 ms,
  simulate none/daily/full 8.5-8.8 / 9.4-10.3 / 9.9-11.0 ms; the pre-pass tree measured side by side under the same load
  gave planner 8.2-8.5 ms — no regression (the 6.6 ms above was measured at load 0.1).

## Fixture corrections made in this pass

A study that is entered wrongly can make a correct model look wrong, or a wrong model look right. The following
scenario inputs were corrected from the study reports or the dossiers; no tolerance was changed.

- **Fasting clocks.** Browning's BHB (20 V8) and the dossier 20 §4B.3 BHB rows are read at the stated hours after the
  last meal (they were read 4 h later, on the steepest part of the curve). Gipson's shake is drunk at 08:00 after the
  overnight fast, as in the paper (it followed a whole day without food, so "24 h" was 48 h); this turned one row that
  had passed by accident (lc12) into a registered miss. Veldhorst's glycogen-lowering exercise follows the last meal and
  BHB is read the next morning.
- **Refeeding.** The §4B.3 "+3 days after" rows refeed at pre-fast maintenance, as dossier 20 §4.5.2's model check does.
- **Intake as reported.** Laurens: protein virtually zero and steps +60 % during the fast (both from the paper). Dai:
  the cohort's measured baseline REE (≈ 1 513 kcal/d, derived from the reported day-15 value) is entered as a measured
  RMR. Johnstone: the measured ad-libitum intake (7.25 MJ/d). Diaz and Ravussin: the studies' absolute surpluses
  (+6.2 MJ/d, +8.0 MJ/d) instead of percentages of this persona's maintenance. Burke 2021: fed at the engine's own TEE on
  the training schedule (energy balance, as in the study). Suter: ethanol added to unchanged food grams.
- **Protocol and measurement.** Deru: 1 h at 65 % VO2max after dinner absorption, once (dossier 05's own model check).
  Vandenberghe: the second MCT dose taken fasted, total ketones compared. Novotny: absorbed energy compared, with the
  almonds' fibre added. Bussau/Shiose: body water excludes the glycogen mass itself.
- Earlier in this pass (contract requests): the oracle O-3 uses the engine's mean TEE and 4.0 kcal/g protein; Acheson's
  chamber day uses 1 000 steps; Rothman's meal follows a normal day; several protein and hypertrophy studies are fed at
  the model's own TEE on their training schedule.

Of the rows whose status changed with these corrections, 15 moved from miss to pass (one of them the former K row,
Johnstone) and 2 from pass to miss (Gipson lc12 and Suter ee); Laurens' weight stayed a miss but now overshoots dossier
07's ±0.8 kg while matching dossier 20's own model.

## What the engine should not be trusted for

- **Out-of-sample accuracy.** Every study row of this release is a development check (D8-03); no study was held out under
  a frozen model, so the pass rates measure fit to the development studies and internal consistency, not accuracy on new
  people or new protocols. Conservation and oracle agreement are necessary, not proof that a trajectory is right.
- **Populations the studies did not cover.** The scenario people are mostly men under 60 (136 of 178 scenarios); women,
  older adults, children, pregnancy, eating disorders, chronic kidney disease, diabetes on glucose-lowering medication and
  other clinical states are thinly covered or absent. The safety rules are separate and do not rely on these rows.
- **Individual predictions.** The bands are parameter-sensitivity ranges for an average person with the stated body,
  coverage unvalidated; they do not include adherence, measurement error or day-to-day scale noise. Individual outcomes
  vary more.
- **The first week of a low-carbohydrate or ketogenic diet.** Muscle glycogen and its water hardly fall, so the early
  scale drop is under-predicted by about 1 kg (fat loss is unaffected).
- **Short overfeeding (days).** Scale gain over 3-7 days is over-predicted when sodium rises with food; tissue gain is
  reasonable.
- **Liver glycogen timing after a meal, carbohydrate loading and supercompensation.** Hourly liver synthesis stops
  with absorption, loading spreads over days, and the modelled water with loaded glycogen is larger than measured.
- **Blood lipids and blood pressure beyond direction.** Most 06 misses are dossier conflicts; treat magnitudes as
  indicative, especially LDL on ketogenic diets, fasting LDL and uric acid, and the blood-pressure effect of weight
  loss.
- **The added benefit of high protein in a deficit**, which is smaller than in the trials, and lean change in older
  adults doing aerobic exercise.
- **Sex differences in fasting ketosis**, where the sources disagree.
- **Hormones under extreme conditions** (military semistarvation, contest preparation), and leptin in fasts longer
  than 48 h.
- **Performance indices** as race-time predictions; the endurance index is a task-scoped research index (glycogen-limited
  cycling near 75 % VO2max), not a goal the planner accepts (D8-09).
- **Long-term weight regain and maintenance behaviour.** Intake is an input: ad-libitum compensation, the fall in
  voluntary activity during semistarvation and appetite-driven regain are not simulated.
