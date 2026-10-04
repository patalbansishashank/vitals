> **Maintainers' version.** This file keeps the internal research-file numbers, section signs, ruling ids and spec names of the
> validation run. The report users read at `/evidence/validation` is the plain-language rewrite in `docs/VALIDATION_REPORT.md`
> (bundled into the app by `src/features/evidence/validationReport.ts`); it carries the same numbers and scenarios. When the
> validation run changes, update both: the numbers here, then the same numbers there in plain words.

# Vitals engine — validation report

*Engine version as of 1 October 2026 (engine finisher pass; updated by the final-round engine pass: R-MAINT, R-KETEX, cMMax 180, and by the blocker round: R-DETRAIN, keto-adaptation index, meal-to-meal fast warnings — see "Blocker-round changes" and "Final-round changes" below). Reproduce with `pnpm vitest run src/engine/validation`
(the scenario table and the Markdown of every miss are printed by the last test); the machine-readable register is
`src/engine/validation/knownMisses.ts`, its table form `src/engine/validation/KNOWN_MISSES.md`. The model itself is
specified in `docs/MODEL_SPEC.md`; every target below comes from the research dossiers in `research/`.*

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
3. **Uncertainty bands**: the ensemble of parameter draws is compared with the published between-person variability.

A must-pass row that misses is never loosened. It is either fixed or recorded in the register with its owner (the model
module whose equations or parameters produce the miss), the measured value, the target, and a reason; the test then
runs as an expected failure, so a row that starts to pass turns the suite red until the register is updated.

## Results at a glance

| check | result |
|---|---|
| Study scenarios | 177 scenarios, 601 expectations |
| Must-pass rows (M) | **391 of 491 met**; 100 registered known misses (87 accepted, 13 open calibration items), none unexplained |
| Tracked known-miss rows (K) | 13, all still outside their band as the dossiers predict (one former K row, Johnstone 2008, now passes and was promoted to M) |
| Qualitative rows (Q) | 58 of 97 in the stated direction (non-gating) |
| Oracles (§9.1 O-1 to O-3) | Body Weight Planner: 24 of 24 within tolerance; negative control 3 of 3; daily carbohydrate balance 6 of 9 (3 registered, ruling 18:10) |
| Invariants (O-4 to O-9, O-12) | all pass: hourly energy residual ≤ 1e-6 kcal, scale identity ≤ 1e-9 kg in every scenario arm; day-0 wake-hour weight = entered weight (worst 3 g); bit-identical reruns, snapshot restores and ensembles across worker counts; no drift at maintenance in 78 persona × habitual-schedule cells (worst ΔFM −0.04 kg over 30 d) |
| Performance (O-11, bundled engine, 180 days, best of 15, load 0.1 per core) | planner 6.6 ms (bound 10), simulate `none` 8.1 ms, `daily` 9.6 ms, `full` 9.9 ms (bound 15) |
| Uncertainty bands (32 draws) | fat-change ±18 %, RMR ±9-11 %, lean-gain ±53 % (dossier 16: ±35 %, ±13 %, ±50 %) |

Registered misses by cause: dossier conflicts 31, model structure 26, consequences of rulings 21, open calibration
11, scenario mapping 11. By owning module: fuel 20, energy 18, cardiometabolic 17, composition 13, water 5, muscle 4,
hormones 5, ketones 4, fasting 3, scenario 3, intake 2, activity 1, wellbeing 1, activityIntake 4. The row-level list with the measured
value, the target and the reason for each is `src/engine/validation/KNOWN_MISSES.md`.

## Results by dossier

M = must-pass, K = tracked known miss, Q = qualitative. "Known misses" are registered M rows.

| dossier / oracle | targets | must-pass met | must-pass known misses | tracked K rows (all missing) | qualitative in direction |
|---|---|---|---|---|---|
| O-1 | 24 | 24 / 24 | 0 | 0 | 0 / 0 |
| O-2 | 3 | 3 / 3 | 0 | 0 | 0 / 0 |
| O-3 | 9 | 6 / 9 | 3 | 0 | 0 / 0 |
| 01 | 54 | 16 / 24 | 8 | 1 | 19 / 29 |
| 03 | 24 | 10 / 19 | 9 | 1 | 3 / 4 |
| 02 | 18 | 5 / 7 | 2 | 2 | 5 / 9 |
| 10 | 15 | 10 / 14 | 4 | 0 | 0 / 1 |
| 11 | 30 | 20 / 29 | 9 | 0 | 1 / 1 |
| 09 | 34 | 19 / 23 | 4 | 1 | 6 / 10 |
| 16 | 11 | 8 / 8 | 0 | 0 | 3 / 3 |
| 04 | 26 | 10 / 22 | 12 | 0 | 2 / 4 |
| 05 | 36 | 29 / 31 | 2 | 4 | 1 / 1 |
| 20 | 102 | 82 / 91 | 9 | 3 | 5 / 8 |
| 07 | 22 | 14 / 19 | 5 | 1 | 1 / 2 |
| 13 | 25 | 14 / 20 | 6 | 0 | 4 / 5 |
| 06 | 48 | 23 / 36 | 13 | 0 | 4 / 12 |
| 08 | 14 | 14 / 14 | 0 | 0 | 0 / 0 |
| 12 | 21 | 13 / 17 | 4 | 0 | 2 / 4 |
| 14 | 8 | 7 / 8 | 1 | 0 | 0 / 0 |
| 15 | 9 | 6 / 9 | 3 | 0 | 0 / 0 |
| 19 | 12 | 8 / 10 | 2 | 0 | 1 / 2 |
| R1 | 56 | 50 / 54 | 4 | 0 | 1 / 2 |
| **all** | **601** | **391 / 491** | **100** | **13** | **58 / 97** |

## Headline comparisons

Each table lists the target with the dossier's tolerance, the engine value and the verdict. "Known miss" names the cause
and the owning module; the reason is in `KNOWN_MISSES.md`.

### Hall Body Weight Planner (oracle O-1)

The engine and the re-implemented Hall 2011 planner are fed the same person and intake for one year; the rows are the
engine minus the planner.

| cohort | body weight, 6 mo | body weight, 1 y | fat mass, 6 mo | fat mass, 1 y |
|---|---|---|---|---|
| sedentary man, −25 % | +0.38 kg | -0.12 kg | -0.56 kg | -1.57 kg |
| sedentary man, −500 kcal/d | +0.41 kg | -0.05 kg | -0.54 kg | -1.53 kg |
| sedentary man, +20 % | -0.12 kg | +0.07 kg | -0.10 kg | -0.19 kg |
| sedentary woman, −25 % | +0.50 kg | +0.39 kg | -0.33 kg | -0.93 kg |
| sedentary woman, −500 kcal/d | +0.50 kg | +0.39 kg | -0.33 kg | -0.92 kg |
| sedentary woman, +20 % | -0.17 kg | -0.21 kg | -0.13 kg | -0.29 kg |

Tolerance ±1.5 kg at 6 months and ±3 kg at 1 year; all 24 within. At one year in the deficit cohorts the engine's fat
mass is 0.9-1.6 kg below the planner's at almost the same body weight: it loses more fat and less lean than the
planner's Forbes partition, through 03's protein and activity terms.

### Minnesota semistarvation (01 §7.1)

| study / quantity | target | engine | verdict |
|---|---|---|---|
| Minnesota semistarvation — body weight at 24 wk (76 % of 69.4 kg) | 52.74 ± 2 kg | 39.9 | known miss (structure, energy) |
| Minnesota semistarvation — fat mass at 24 wk (34 % of 9 kg) | 3.06 ± 1 kg | 2.04 | known miss (structure, energy) |
| Minnesota semistarvation — weight lost (16-17 kg) | [14.7, 18.7] kg | 29.5 | direction not met |

The engine agrees with the planner fed the same intake (−18.8 vs −18.7 kg at 13 weeks); Hall reproduced Minnesota only
by imposing the observed fall in voluntary activity, which this scenario does not impose. Activity adaptation beyond
02's AT term is not modelled.

### CALERIE (01 §7.3-7.4, 02 V4, 14 V3, 19 V5)

| study / quantity | target | engine | verdict |
|---|---|---|---|
| CALERIE-1 — control: weight change at 6 mo (−1.0 %) | -0.757 ± 1.5 kg | -0.00 | met |
| CALERIE-1 — CR 25 %: weight change at 6 mo (−10.4 %) | -7.873 ± 1.5 kg | -8.04 | met |
| CALERIE-1 — CR + EX: weight change at 6 mo (−10.0 %) | -7.57 ± 1.5 kg | -8.45 | met |
| CALERIE-1 — VLCD: weight change at 6 mo (−13.9 %) | -10.52 ± 1.5 kg | -9.75 | direction met |
| CALERIE-1 — CR: TDEE change at month 3 vs baseline (−454 ± 76 kcal/d) | -454 ± 76 kcal/d | -181 | direction not met |
| CALERIE-2 — weight change at 12 mo (−10.4 %) | -7.124 ± 1 kg | -8.12 | met |
| CALERIE-2 — weight change at 24 mo (−10.4 % maintained) | -7.124 ± 1 kg | -8.51 | known miss (calibration, energy) |
| CALERIE-1 — AT_R + AT_N at month 6 (−100 … −350 kcal/d) | [-350, -100] kcal/d | -72.6 | known miss (dossier, energy) |
| CALERIE-2 regional — waist change per kg of fat mass lost, 2 y (1.13 cm/kg) | 1.13 ± 0.28 cm/kg | 1.11 | met |
| CALERIE-2 bone — hip BMD change after 2 y (−1.75 %) | -1.75 ± 0.7 % | -2.43 | met |

### Hall 2015 and Hall 2016 (01 §7.5-7.6, 04 V7, 13 V1, 05 V5)

| study / quantity | target | engine | verdict |
|---|---|---|---|
| Hall 2015 reduced-carbohydrate — RC: cumulative fat loss over 6 d (245 ± 21 g) | 0.245 ± 0.06 kg | 0.41 | known miss (ruling, fuel) |
| Hall 2015 reduced-carbohydrate — RF: cumulative fat loss over 6 d (463 ± 37 g) | 0.463 ± 0.06 kg | 0.46 | met |
| Hall 2015 reduced-carbohydrate — RF loses more fat than RC (key finding) | > 0 kg | 0.04 | met |
| Hall 2015 reduced-carbohydrate — realised energy deficit vs baseline (−810 kcal/d) | -810 ± 25 kcal/d | -810 | met |
| Hall 2015 — cumulative fat loss RF − RC (218 g; must be ≥ 109 g) | > 0.109 kg | 0.04 | known miss (ruling, fuel) |
| Hall 2016 isocaloric ketogenic diet — fat loss on KD (days 29-56) minus fat loss on BD (days 1-28) | < 0.1 kg | -0.23 | met |
| Hall 2016 isocaloric ketogenic diet — EE difference KD (days 43-56) − BD (days 15-28) | [0, 160] kcal/d | -57.4 | known miss (ruling, energy) |
| Hall 2016 isocaloric ketogenic diet — RQ change KD − BD (−0.111), non-protein approximation | -0.111 ± 0.03 RQ | -0.12 | direction met |
| Hall 2016 — extra weight loss in the first KD week vs the last baseline week (−1.6 kg) | -1.6 ± 0.4 kg | -0.65 | known miss (ruling, fuel) |
| Hall 2016 / Rosenbaum 2019 — fasting BHB in weeks 3-4 of the KD (0.77 mM) | 0.77 ± 0.231 mmol/L | 0.70 | met |

The Hall 2015 carbohydrate-restriction misses share one cause: under the fuel ruling of 30 September (18:10), muscle
glycogen stays at its fed reference outside fasts and exercise, so at 140 g/d of carbohydrate only the liver empties and
fat covers the rest of the deficit. The direction (RF loses more fat than RC) holds; the magnitude does not.

### Overfeeding: Bouchard, Diaz, Bray 2012 and the dossier 11 prototypes

| study / quantity | target | engine | verdict |
|---|---|---|---|
| Bouchard 1990 / Tremblay 1992 overfeeding — weight change after 100 d (+8.1 kg) | 8.1 ± 1.5 kg | 8.20 | met |
| Bouchard 1990 / Tremblay 1992 overfeeding — fat-mass change after 100 d (measured +5.4 kg: 6.9 → 12.3) | 5.4 ± 1.5 kg | 4.92 | direction met |
| Bouchard 1990 / Tremblay 1992 overfeeding — share of the surplus stored (Tremblay: 222 of 353 MJ = 63 %) | 63 ± 12 % | 62.5 | direction met |
| Bouchard 1990 — ΔFFM incl. glycogen and water (2.7 kg) | 2.7 ± 1 kg | 3.28 | met |
| Diaz 1992 overfeeding +50 % for 42 d — weight change after 42 d (+7.6 ± 1.6 kg) | 7.6 ± 1.5 kg | 7.57 | met |
| Bray 2012 low/normal/high-protein … — 5 % protein: weight change (+3.16 kg) | 3.16 ± 1.5 kg | 5.32 | known miss (K) |
| Bray 2012 low/normal/high-protein … — 15 % protein: weight change (+6.05 kg) | 6.05 ± 1.5 kg | 6.04 | met |
| Bray 2012 low/normal/high-protein … — 25 % protein: weight change (+6.51 kg) | 6.51 ± 1.5 kg | 5.51 | met |
| Bray 2012 low/normal/high-protein … — 15 % protein: REE change (+160 kcal/d) | 160 ± 60 kcal/d | 120 | met |
| Bray 2012 low/normal/high-protein … — 25 % protein: REE change (+227 kcal/d) | 227 ± 60 kcal/d | 167 | known miss (dossier, energy) |
| Bray 2012 — 15 % protein: lean change (+2.87 kg) | 2.87 ± 0.8 kg | 2.42 | met |
| Bray 2012 — 25 % protein: lean change (+3.18 kg) | 3.18 ± 0.8 kg | 2.27 | known miss (calibration, composition) |
| Bray 2012 — fat gain independent of protein: 25 % minus 5 % arm (0 ± 0.5 kg) | 0 ± 0.5 kg | -1.23 | known miss (dossier, energy) |
| Ravussin 1985 — ΔBW after 9 d (3.2 kg) | 3.2 ± 0.8 kg | 3.30 | met |
| Roberts 1990 — ΔBW after 21 d (2.5 kg) | 2.5 ± 0.625 kg | 2.84 | met |
| Boden 2015 — ΔBW after 7 d (3.5 kg) | 3.5 ± 0.875 kg | 5.94 | known miss (calibration, water) |
| Müller 2015 — ΔBW after 7 d (1.8 kg) | 1.8 ± 0.45 kg | 1.68 | met |
| Sagayama 2014 — ΔBW after 3 d (0.7 kg) | 0.7 ± 0.175 kg | 1.49 | known miss (mapping, water) |

Weight gain over 6-14 weeks is on target. Short (3-7 day) surpluses overshoot because the default sodium follows food
energy, so extra food brings extracellular water that the studies did not report (Sagayama, Boden).

### Water-only fasting: 7 days and the dossier 20 schedule (20 V1-V2, §4B.3, 13 V12)

| study / quantity | target | engine | verdict |
|---|---|---|---|
| Kolnes 2025 — body weight change after 7 d (−5.8 ± 0.3 kg) | -5.8 ± 0.8 kg | -5.62 | met |
| Kolnes 2025 — fat mass change after 7 d (−1.4 ± 0.1 kg) | -1.4 ± 0.5 kg | -1.19 | met |
| Kolnes 2025 — DXA-lean change after 7 d (−4.6 ± 0.3 kg) | -4.6 ± 1 kg | -4.43 | met |
| Kolnes 2025 — urinary N over 7 d (83.9 ± 6.7 g) | 83.9 ± 15 g N | 89.2 | met |
| Pietzner 2024 — weight change at the end of the fast (−5.7 ± 0.8 kg) | -5.7 ± 1 kg | -5.41 | met |
| Pietzner 2024 — fat change at the end of the fast (−1.6 ± 1.3 kg) | -1.6 ± 1.3 kg | -1.15 | direction met |
| Pietzner 2024 — weight change 3 d after refeeding (−3.1 ± 0.6 kg) | -3.1 ± 0.8 kg | -3.66 | met |
| Pietzner 2024 — lean change 3 d after refeeding (−0.69 ± 0.49 kg) | -0.69 ± 0.6 kg | -2.24 | known miss (mapping, fasting) |
| dossier 20 §4B.3 model — 168 h: weight change (-5.7 kg) | -5.7 ± 0.855 kg | -5.86 | met |
| dossier 20 §4B.3 model — 168 h: fat change (-1.3 kg) | -1.3 ± 0.325 kg | -1.21 | met |
| dossier 20 §4B.3 model — 7 d: DXA-lean change (−4.4 kg) | -4.4 ± 1 kg | -4.65 | met |
| dossier 20 §4B.3 model — 3 d after the 7-d fast: weight change vs baseline (−2.6 kg) | -2.6 ± 0.8 kg | -2.94 | met |
| dossier 20 §4B.3 model — 24 h: weight change (-1.6 kg) | -1.6 ± 0.24 kg | -1.64 | met |
| dossier 20 §4B.3 model — 48 h: weight change (-2.7 kg) | -2.7 ± 0.405 kg | -2.77 | met |
| dossier 20 §4B.3 model — 72 h: weight change (-3.5 kg) | -3.5 ± 0.525 kg | -3.60 | met |
| dossier 20 §4B.3 model — 504 h: weight change (-11 kg) | -11 ± 1.65 kg | -10.9 | met |
| Kerndt 1982 — week-1 weight-loss rate (0.9 kg/d) | 0.9 ± 0.2 kg/d | 0.76 | met |
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
| Owen & Reichard 1971 / Balasse 1979 — BHB at 24 d (5.29 mM) | 5.29 ± 1.587 mmol/L | 5.70 | met |
| dossier 20 §4B.3 model — 168 h: BHB at the end (3.7-4.3 mM) | [2.59, 5.59] mmol/L | 4.21 | met |
| dossier 20 §4B.3 model — 504 h: BHB at the end (5.4-6 mM) | [3.78, 7.8] mmol/L | 6.03 | met |

The same engine, with each fast starting after a normal day that ends with a 20:00 dinner (hours counted from that meal):

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
| Benito 2020 — untrained: lean-tissue change after 10.4 wk (+1.54 kg) | 1.54 ± 0.4 kg | 1.51 | met |
| Benito 2020 — trained (TS₀ 0.45): lean-tissue change after 10.4 wk (+0.98 kg) | 0.98 ± 0.4 kg | 0.84 | met |
| Morton 2018 — FFM gain ratio, supplemented / control (1.27) | 1.27 ± 0.15 ratio | 1.16 | met |
| Peterson 2011 — lean-tissue change after 20.5 wk (+1.1 kg) | 1.1 ± 0.4 kg | 0.95 | met |
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
| Murphy & Koehler 2022 — deficit at which the 12-wk lean change crosses zero (500-700 kcal/d) | [500, 700] kcal/d | 681 | met |
| Villareal 2017 — RT arm: DXA lean-mass change after 6 mo (−1.0 kg) | -1 ± 0.8 kg | -0.45 | met |
| Villareal 2017 — aerobic arm: DXA lean-mass change after 6 mo (−2.7 kg) | -2.7 ± 0.8 kg | -1.55 | known miss (structure, composition) |
| Villareal 2017 — RT loses less lean than aerobic (direction) | > 0 kg | 1.09 | met |
| Ballor & Poehlman 1994 — diet only: FFM share of the loss (24-28 %) | [24, 28] % | 11.6 | known miss (structure, composition) |
| Ballor & Poehlman 1994 — diet + RT: FFM share of the loss (11-13 %) | [11, 13] % | 2.97 | known miss (dossier, muscle) |
| Ballor & Poehlman 1994 — FFM share with exercise is 0.25-0.5 of the diet-only share | [0.25, 0.5] ratio | 0.26 | met |
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
this: R-PROT2 set the protein ceiling ρ_max to its registry low so that the Murphy zero-crossing is met, and R-RT gives
the training effect on lean to 09 alone.

### Liver fat (06)

| study / quantity | target | engine | verdict |
|---|---|---|---|
| Browning 2011 — hypocaloric mixed diet: liver-fat change after 14 d (−28 %) | -28 ± 10 % | -15.0 | known miss (mapping, cardiometabolic) |
| Browning 2011 — low-carbohydrate: liver-fat change after 14 d (−55 %) | -55 ± 10 % | -30.2 | known miss (mapping, cardiometabolic) |
| Mardinoglu 2018 — liver-fat change after 14 d (−43.8 %) | -43.8 ± 10 % | -3.96 | known miss (structure, cardiometabolic) |
| Lim 2011 — IHTG at 8 weeks (2.9 %) | 2.9 ± 0.58 % | 2.60 | met |
| Luukkonen 2018 — SFA overfeeding: liver-fat change (+55 %) | 55 ± 15 % | 44.3 | met |
| Luukkonen 2018 — unsaturated overfeeding: liver-fat change (+15 %) | 15 ± 15 % | 12.9 | met |
| Luukkonen 2018 — sugar overfeeding: liver-fat change (+33 %) | 33 ± 15 % | 22.9 | met |
| Magkos 2016 — IHTG at −5.1 % weight (7.4 %) | 7.4 ± 1.11 % | 6.11 | known miss (dossier, cardiometabolic) |
| Magkos 2016 — IHTG at −10.8 % weight (4.1 %) | 4.1 ± 0.615 % | 4.06 | met |
| Magkos 2016 — IHTG at −16.4 % weight (3.0 %) | 3 ± 0.45 % | 2.66 | met |

### Lipids and blood pressure (06, 20 V10)

| study / quantity | target | engine | verdict |
|---|---|---|---|
| Mensink 2016 — SFA → PUFA: LDL change (−0.55 mmol/L) | -0.55 ± 0.1375 mmol/L | -0.60 | met |
| Mensink 2016 — carbohydrate → SFA: LDL change (+0.36 mmol/L) | 0.36 ± 0.09 mmol/L | 0.37 | met |
| Mensink 2016 — carbohydrate → SFA: HDL change (+0.11 mmol/L) | 0.11 ± 0.0275 mmol/L | 0.11 | met |
| Mensink 2016 — carbohydrate → SFA: TG change (−0.12 mmol/L) | -0.12 ± 0.03 mmol/L | -0.12 | met |
| Skulas-Ray 2011 — 3.4 g/d: TG change after 8 wk (−27 %) | -27 ± 8 % | -27.5 | met |
| Buren 2021 / Retterstøl 2018 vs … — lean woman: LDL change after 4 wk (+1.81 mmol/L; sign and order) | [0.9, 3.6] mmol/L | 1.26 | met |
| Buren 2021 / Retterstøl 2018 vs … — normal-weight adult: LDL change after 3 wk (+0.9 mmol/L; sign and order) | [0.45, 1.8] mmol/L | 0.91 | met |
| Buren 2021 / Retterstøl 2018 vs … — BMI 39 with ≈ 10 % loss: LDL change (−0.26 mmol/L; sign and order) | [-0.52, -0.13] mmol/L | 0.06 | known miss (dossier, cardiometabolic) |
| DIETFITS — low-fat: LDL change (−2.1 mg/dL) | -2.1 ± 4 mg/dL | -6.77 | known miss (dossier, cardiometabolic) |
| DIETFITS — low-carbohydrate: LDL change (+3.6 mg/dL) | 3.6 ± 4 mg/dL | -4.61 | known miss (dossier, cardiometabolic) |
| DIETFITS — low-fat: TG change (−10 mg/dL) | -10 ± 4 mg/dL | -6.79 | met |
| Sävendahl 1999 — 7-d fast: LDL change (+66 %) | 66 ± 19.8 % | 26.3 | known miss (structure, cardiometabolic) |
| Sacks 2001 — SBP change after 4 weeks (−6.7 mmHg) | -6.7 ± 1.5 mmHg | -3.22 | known miss (dossier, cardiometabolic) |

Most lipid misses are dossier conflicts: the per-kilogram weight-loss slopes for LDL, triglycerides and blood pressure
that fit one trial (DIETFITS) do not fit another (Magkos, the ketogenic LDL series, Neter's meta-analysis).

### Leptin, T3 and testosterone (12, 07)

| study / quantity | target | engine | verdict |
|---|---|---|---|
| Weigle 1997 — leptin change at 72 h (−62 %; engine −50 … −75 %) | [-75, -50] % | -65.6 | met |
| Chan 2003 — leptin change (−90 %) | -90 ± 15 % | -51.9 | known miss (K) |
| Dubuc 1998 — men: leptin change (−36 %) | -36 ± 15 % | -45.2 | met |
| Dubuc 1998 — women: leptin change (−61 %) | -61 ± 15 % | -64.6 | met |
| Müller 2015 — leptin change at the end of restriction (−44 %; engine −35 … −55 %) | [-55, -35] % | -53.3 | met |
| Müller 2015 — T3 change (−39 %; engine −20 … −40 %) | [-40, -20] % | -25.0 | met |
| Müller 2015 — testosterone change (−11 %; engine 0 … −20 %) | [-20, 0] % | -6.33 | met |
| Chan 2003 — T3 change (−30 %) | -30 ± 15 % | -33.7 | met |
| Chan 2003 — testosterone change (−40 %) | -40 ± 15 % | -34.6 | met |
| Friedl 2000 / Henning 2014 — testosterone change at day 56 (−70 %; engine −55 … −80 %) | [-80, -55] % | -10.8 | known miss (structure, hormones) |
| Pardue 2017 / Rossow 2013 — testosterone change at the end of preparation (−60 … −80 %) | [-80, -60] % | -73.2 | met |
| Pardue 2017 / Rossow 2013 — T3 change at the end of preparation (≥ −45 %; observed 123 → 40 ng/dL) | [-45, 0] % | -45.4 | known miss (dossier, hormones) |
| Ebbeling 2012 — leptin, very-low-carbohydrate / low-fat (≤ 0.8) | < 0.8 ratio | 0.79 | met |
| Ebbeling 2012 — T3, very-low-carbohydrate / low-fat (≤ 0.9) | < 0.9 ratio | 1.00 | known miss (ruling, hormones) |

## Uncertainty bands against dossier 16

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

O-11 is measured on the production bundle (Vite build of the benchmark entry) in the test process: one 180-day run of the
reference man on a training week, best of 15 after warm-up, all 16 modules.

| mode | best | median | bound |
|---|---|---|---|
| planner (goal series only) | 6.6 ms | 7.7 ms | 10 ms |
| simulate, record `none` | 8.1 ms | 10.0 ms | 15 ms |
| simulate, record `daily` | 9.6 ms | 10.9 ms | 15 ms |
| simulate, record `full` (hourly arrays, warnings, events) | 9.9 ms | 11.5 ms | 15 ms |

Under the Vitest transform (not gating) the same run takes 14.6 ms. The test records the machine load and skips, rather
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

**Model structure (26).** Mechanisms that v1 does not have or simplifies: indirect-pathway liver glycogen synthesis
after a meal, glucose-first oxidation above the muscle reference during carbohydrate loading, the 60 g/h absorption cap,
a fasting-specific LDL rise, age and insulin-resistance terms in ketogenesis, protein deposition that should not occur
from a fat-only surplus, age-related waist drift, the leptin-threshold route to hypogonadism outside contest leanness.

The four newest rows are the R1 activity-intake archetypes against the FAO/WHO lifestyle PAL table (R1-V1, owner activityIntake): PAL0 = TDEE0/RMR0 is 1.39 for man and woman desk-little-moving (target 1.4-1.5) and 1.682 / 1.681 for man and woman on feet (retail) (target 1.7-1.9). R1 computed its archetype table with a TEF fraction alpha0 = 0.10; the engine solves alpha0 from the NHANES habitual macro split (02 §4.4, about 0.087), so every PAL0 is about 1.4 % below R1's (1.41 and 1.71). The walking-delivery on-feet archetype passes (1.77). Register: `knownMisses.ts`, keys `R1-V1-fao-lifestyle-pal/*`.

**Scenario mapping (11).** The study cannot be expressed exactly: a resting calorimeter day (Acheson), unreported
sodium intake in short overfeeding studies, ad-libitum refeeding with unreported intake (Pietzner), the combined
stressors of military courses (Nindl), a performance index that is not a race time (Burke 2017).

**Open calibration items (11).** A parameter change inside its registry range would close the row but breaks another
target. Examples: fuel's liver capacity cLMax 420 would fix Rothman's post-meal liver glycogen but moves 05 V3 Deru's
exercise-arm time to ketosis out of its band (tested in the final round; not applied — cMMax 180 was applied and closes
Bussau's supercompensation row); the fasting labile-protein repletion that would fix Templeman breaks the weekly-fast
protein row; r_S 0.50 fixes Bray's high-protein lean gain but breaks Levine.

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

- **Individual predictions.** The bands describe uncertainty in physiology for an average person with the stated
  body; they do not include adherence, measurement error or day-to-day scale noise. Individual outcomes vary more.
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
- **Performance indices** as race-time predictions; the endurance index is a glycogen-limited capacity.
- **Long-term weight regain and maintenance behaviour.** Intake is an input: ad-libitum compensation, the fall in
  voluntary activity during semistarvation and appetite-driven regain are not simulated.
