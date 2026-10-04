# Vitals model: validation report

*Model version of 1 October 2026.*

This report describes how the Vitals model compares with published studies. It is information, not medical advice.

The Vitals model projects what happens in the body as you follow a plan for eating, fasting and training. This report
shows how its projections compare with what was measured in published human studies: 177 study scenarios with 601
expectations, two independent reference models, and a set of physical consistency checks. Every target below comes
from the published studies behind the Evidence library. Where the model misses, the miss is shown with its cause.

## What was tested and how

The Vitals model simulates one person hour by hour. It is deterministic: the same inputs always give exactly the same
outputs. It covers energy expenditure and how it adapts, glycogen and the mix of fuels burned, ketones, fat and lean
tissue, muscle growth from resistance training, body water and the scale, hormones, appetite, blood markers, bone and
performance, and safety rules. It is checked in three ways.

1. **Reference models and physical consistency checks.** The model is compared with two independent reference models:
   the published Hall 2011 Body Weight Planner, re-implemented as described in the Body-weight models topic of the
   Evidence library, and the daily carbohydrate balance described in the Carbohydrate, glycogen and insulin topic. A
   negative control checks that the Vitals model differs from the Hall planner where it should: the planner ignores
   protein, so it gives the same result for the higher-protein and control groups of Longland 2016, while the Vitals
   model should give the higher-protein group more lean mass. The model must also obey physical identities: energy and
   mass are conserved every hour, a weight-stable person eating at maintenance does not drift, and identical inputs give
   bit-identical outputs.
2. **Study scenarios.** For each topic in the Evidence library, the studies chosen for validation are entered as
   scenarios: the study's participants become a person profile, and the protocol becomes a schedule in the same input
   format the app uses. Every published outcome becomes an expectation, with the tolerance set by the research for that
   topic.
3. **Uncertainty bands.** The model is run many times with its uncertain parameters drawn across their plausible ranges
   (an ensemble), and the spread of the results is compared with the published between-person variability.

Each expectation is one of three kinds:

- **Must-pass checks.** The model is expected to meet them. A must-pass check that misses is never loosened: it is
  either fixed or recorded openly as a known miss, with the measured value, the target, the reason, and the area of the
  model whose equations or parameters produce the miss. A known miss keeps running as an expected failure, so if it
  starts to pass, the tests flag it until the record is updated.
- **Tracked misses.** Results that the research for the topic already expects this kind of model to miss. They are
  kept so we notice if they start to pass.
- **Direction-only checks.** Only the direction of the effect is checked (for example, that one group loses more than
  another). They are reported, but a miss does not fail the tests.

All of these tests are rerun automatically on every change to the model.

## Results at a glance

| check | result |
|---|---|
| Study scenarios | 177 scenarios, 601 expectations |
| Must-pass checks | **391 of 491 met**; 100 known misses, each recorded with its cause (87 accepted, 13 open calibration items), none unexplained |
| Tracked misses | 13, all still outside their band, as the research predicts (one former tracked miss, Johnstone 2008, now passes and became a must-pass check) |
| Direction-only checks | 58 of 97 in the stated direction (reported, not pass/fail) |
| Reference models | Hall Body Weight Planner: 24 of 24 within tolerance; negative control 3 of 3; daily carbohydrate balance 6 of 9 (3 known misses, all from the modelling decision on muscle glycogen explained under "Hall 2015 and Hall 2016") |
| Physical consistency checks | all pass: the hourly energy balance closes to within 1e-6 kcal (a millionth of a kilocalorie) and scale weight equals fat + lean + fast-changing water to within 1e-9 kg, in every arm (study group) of every scenario; the day-0 wake-up weight equals the entered weight (worst 3 g); reruns, restored snapshots and uncertainty ensembles are bit-identical whatever the number of parallel workers; no drift at maintenance in 78 combinations of example person and usual schedule (worst fat-mass change −0.04 kg over 30 d) |
| Speed (the compiled model the app ships, 180 days, best of 15 runs, machine load 0.1 per processor core) | goal planner 6.6 ms (limit 10), simulation with no series recorded 8.1 ms, with daily series 9.6 ms, with everything recorded 9.9 ms (limit 15) |
| Uncertainty bands (32 draws) | fat change ±18 %, resting metabolic rate ±9-11 %, lean gain ±53 % (published between-person spread: ±35 %, ±13 %, ±50 %) |

The known misses by cause: conflicting sources 31, model structure 26, consequences of modelling decisions 21, open
calibration 11, study set-up 11. By area of the model: fuel 20, energy 18, cardiometabolic 17, composition 13, water 5,
muscle 4, hormones 5, ketones 4, fasting 3, scenario set-up 3, intake 2, activity 1, wellbeing 1, activity-level conversion 4. Each known miss is
recorded with the measured value, the target and the reason; the main ones are explained below.

## Results by topic

"Must-pass known misses" are must-pass checks that miss, each recorded with its cause. The first three rows are the
comparisons with the reference models.

| topic | targets | must-pass met | must-pass known misses | tracked misses (all still missing) | direction-only checks in the stated direction |
|---|---|---|---|---|---|
| Hall body-weight planner (reference model) | 24 | 24 / 24 | 0 | 0 | 0 / 0 |
| negative control | 3 | 3 / 3 | 0 | 0 | 0 / 0 |
| daily carbohydrate balance (reference model) | 9 | 6 / 9 | 3 | 0 | 0 / 0 |
| Body-weight models | 54 | 16 / 24 | 8 | 1 | 19 / 29 |
| Protein and muscle | 24 | 10 / 19 | 9 | 1 | 3 / 4 |
| Energy expenditure | 18 | 5 / 7 | 2 | 2 | 5 / 9 |
| Cardio and activity | 15 | 10 / 14 | 4 | 0 | 0 / 1 |
| Energy surplus | 30 | 20 / 29 | 9 | 0 | 1 / 1 |
| Resistance training | 34 | 19 / 23 | 4 | 1 | 6 / 10 |
| Sleep, sex and age | 11 | 8 / 8 | 0 | 0 | 3 / 3 |
| Carbohydrate, glycogen and insulin | 26 | 10 / 22 | 12 | 0 | 2 / 4 |
| Fat oxidation and ketosis | 36 | 29 / 31 | 2 | 4 | 1 / 1 |
| Extended water fasting | 102 | 82 / 91 | 9 | 3 | 5 / 8 |
| Fasting and meal timing | 22 | 14 / 19 | 5 | 1 | 1 / 2 |
| Diet transitions | 25 | 14 / 20 | 6 | 0 | 4 / 5 |
| Blood fats and markers | 48 | 23 / 36 | 13 | 0 | 4 / 12 |
| Autophagy | 14 | 14 / 14 | 0 | 0 | 0 / 0 |
| Hormones and appetite | 21 | 13 / 17 | 4 | 0 | 2 / 4 |
| Body composition | 8 | 7 / 8 | 1 | 0 | 0 / 0 |
| Fibre, hydration and substances | 9 | 6 / 9 | 3 | 0 | 0 / 0 |
| Performance and wellbeing | 12 | 8 / 10 | 2 | 0 | 1 / 2 |
| Activity levels at the start of a plan | 56 | 50 / 54 | 4 | 0 | 1 / 2 |
| **all** | **601** | **391 / 491** | **100** | **13** | **58 / 97** |

## Headline comparisons

Each table lists the published target with its tolerance, the model's value and the verdict. A known-miss verdict names
its cause and the area of the model involved; the causes (conflicting sources, model structure, a modelling decision,
calibration, study set-up) are explained under "Known misses, grouped by cause".

Abbreviations used in the tables:

- **BHB**: beta-hydroxybutyrate, the main ketone in blood (mM = mmol/L).
- **EE, TEE, TDEE**: energy expenditure, total energy expenditure, total daily energy expenditure.
- **REE, RMR**: resting energy expenditure, resting metabolic rate.
- **FFM, LBM**: fat-free mass, lean body mass. **DXA**: a body-composition scan (dual-energy X-ray absorptiometry).
- **RQ**: respiratory quotient, which shows the mix of carbohydrate and fat being burned.
- **CR, EX, VLCD**: calorie restriction, exercise, very-low-calorie diet.
- **KD, BD**: ketogenic diet, baseline diet. **RC, RF**: reduced-carbohydrate diet, reduced-fat diet.
- **RT, HIIT**: resistance training, high-intensity interval training. **PRO, CON**: higher-protein group, control group.
  **HP, SP**: high-protein diet, standard-protein diet.
- **IHTG**: liver fat content (intrahepatic triglyceride).
- **SFA, PUFA**: saturated fat, polyunsaturated fat. **LDL, HDL**: low- and high-density lipoprotein cholesterol.
  **TG**: triglycerides. **SBP**: systolic blood pressure.
- **BMD**: bone mineral density. **T3**: the active thyroid hormone.

### Hall Body Weight Planner comparison

The Vitals model and the re-implemented Hall 2011 planner are given the same person and intake for one year; each cell
is the Vitals model's value minus the planner's.

| group | body weight, 6 mo | body weight, 1 y | fat mass, 6 mo | fat mass, 1 y |
|---|---|---|---|---|
| sedentary man, −25 % | +0.38 kg | -0.12 kg | -0.56 kg | -1.57 kg |
| sedentary man, −500 kcal/d | +0.41 kg | -0.05 kg | -0.54 kg | -1.53 kg |
| sedentary man, +20 % | -0.12 kg | +0.07 kg | -0.10 kg | -0.19 kg |
| sedentary woman, −25 % | +0.50 kg | +0.39 kg | -0.33 kg | -0.93 kg |
| sedentary woman, −500 kcal/d | +0.50 kg | +0.39 kg | -0.33 kg | -0.92 kg |
| sedentary woman, +20 % | -0.17 kg | -0.21 kg | -0.13 kg | -0.29 kg |

Tolerance ±1.5 kg at 6 months and ±3 kg at 1 year; all 24 within. At one year in the deficit groups the Vitals model's
fat mass is 0.9-1.6 kg below the planner's at almost the same body weight: it loses more fat and less lean than the
planner's split of weight change between fat and lean (Forbes' rule), because of the protein and activity effects
described in the Protein and muscle topic.

### Minnesota semistarvation

| study / quantity | target | model | verdict |
|---|---|---|---|
| Minnesota semistarvation — body weight at 24 wk (76 % of 69.4 kg) | 52.74 ± 2 kg | 39.9 | known miss (model structure, energy) |
| Minnesota semistarvation — fat mass at 24 wk (34 % of 9 kg) | 3.06 ± 1 kg | 2.04 | known miss (model structure, energy) |
| Minnesota semistarvation — weight lost (16-17 kg) | [14.7, 18.7] kg | 29.5 | direction not met |

The Vitals model agrees with the Hall planner given the same intake (−18.8 vs −18.7 kg at 13 weeks). Hall reproduced the
Minnesota result only by imposing the observed fall in voluntary activity, which this scenario does not impose. Any
adaptation of activity beyond the adaptive-thermogenesis term of the Energy expenditure topic (the body's reduction in
energy use during a deficit) is not modelled.

### CALERIE

| study / quantity | target | model | verdict |
|---|---|---|---|
| CALERIE-1 — control: weight change at 6 mo (−1.0 %) | -0.757 ± 1.5 kg | -0.00 | met |
| CALERIE-1 — CR 25 %: weight change at 6 mo (−10.4 %) | -7.873 ± 1.5 kg | -8.04 | met |
| CALERIE-1 — CR + EX: weight change at 6 mo (−10.0 %) | -7.57 ± 1.5 kg | -8.45 | met |
| CALERIE-1 — VLCD: weight change at 6 mo (−13.9 %) | -10.52 ± 1.5 kg | -9.75 | direction met |
| CALERIE-1 — CR: TDEE change at month 3 vs baseline (−454 ± 76 kcal/d) | -454 ± 76 kcal/d | -181 | direction not met |
| CALERIE-2 — weight change at 12 mo (−10.4 %) | -7.124 ± 1 kg | -8.12 | met |
| CALERIE-2 — weight change at 24 mo (−10.4 % maintained) | -7.124 ± 1 kg | -8.51 | known miss (calibration, energy) |
| CALERIE-1 — adaptive thermogenesis, resting plus non-exercise activity, at month 6 (−100 … −350 kcal/d) | [-350, -100] kcal/d | -72.6 | known miss (conflicting sources, energy) |
| CALERIE-2 regional — waist change per kg of fat mass lost, 2 y (1.13 cm/kg) | 1.13 ± 0.28 cm/kg | 1.11 | met |
| CALERIE-2 bone — hip BMD change after 2 y (−1.75 %) | -1.75 ± 0.7 % | -2.43 | met |

### Hall 2015 and Hall 2016

| study / quantity | target | model | verdict |
|---|---|---|---|
| Hall 2015 reduced-carbohydrate — RC: cumulative fat loss over 6 d (245 ± 21 g) | 0.245 ± 0.06 kg | 0.41 | known miss (modelling decision, fuel) |
| Hall 2015 reduced-carbohydrate — RF: cumulative fat loss over 6 d (463 ± 37 g) | 0.463 ± 0.06 kg | 0.46 | met |
| Hall 2015 reduced-carbohydrate — RF loses more fat than RC (key finding) | > 0 kg | 0.04 | met |
| Hall 2015 reduced-carbohydrate — realised energy deficit vs baseline (−810 kcal/d) | -810 ± 25 kcal/d | -810 | met |
| Hall 2015 — cumulative fat loss RF − RC (218 g; must be ≥ 109 g) | > 0.109 kg | 0.04 | known miss (modelling decision, fuel) |
| Hall 2016 isocaloric ketogenic diet — fat loss on KD (days 29-56) minus fat loss on BD (days 1-28) | < 0.1 kg | -0.23 | met |
| Hall 2016 isocaloric ketogenic diet — EE difference KD (days 43-56) − BD (days 15-28) | [0, 160] kcal/d | -57.4 | known miss (modelling decision, energy) |
| Hall 2016 isocaloric ketogenic diet — RQ change KD − BD (−0.111), non-protein approximation | -0.111 ± 0.03 RQ | -0.12 | direction met |
| Hall 2016 — extra weight loss in the first KD week vs the last baseline week (−1.6 kg) | -1.6 ± 0.4 kg | -0.65 | known miss (modelling decision, fuel) |
| Hall 2016 / Rosenbaum 2019 — fasting BHB in weeks 3-4 of the KD (0.77 mM) | 0.77 ± 0.231 mmol/L | 0.70 | met |

The Hall 2015 carbohydrate-restriction misses share one cause, a modelling decision about fuel: muscle glycogen stays at
its fed level outside fasts and exercise, so at 140 g/d of carbohydrate only the liver's glycogen empties and fat covers
the rest of the deficit. The direction (RF loses more fat than RC) holds; the size of the difference does not.

### Overfeeding

Bouchard, Diaz and Bray 2012, and the short overfeeding studies used as examples in the Energy surplus topic.

| study / quantity | target | model | verdict |
|---|---|---|---|
| Bouchard 1990 / Tremblay 1992 overfeeding — weight change after 100 d (+8.1 kg) | 8.1 ± 1.5 kg | 8.20 | met |
| Bouchard 1990 / Tremblay 1992 overfeeding — fat-mass change after 100 d (measured +5.4 kg: 6.9 → 12.3) | 5.4 ± 1.5 kg | 4.92 | direction met |
| Bouchard 1990 / Tremblay 1992 overfeeding — share of the surplus stored (Tremblay: 222 of 353 MJ = 63 %) | 63 ± 12 % | 62.5 | direction met |
| Bouchard 1990 — fat-free mass change incl. glycogen and water (2.7 kg) | 2.7 ± 1 kg | 3.28 | met |
| Diaz 1992 overfeeding +50 % for 42 d — weight change after 42 d (+7.6 ± 1.6 kg) | 7.6 ± 1.5 kg | 7.57 | met |
| Bray 2012 low/normal/high-protein … — 5 % protein: weight change (+3.16 kg) | 3.16 ± 1.5 kg | 5.32 | tracked miss |
| Bray 2012 low/normal/high-protein … — 15 % protein: weight change (+6.05 kg) | 6.05 ± 1.5 kg | 6.04 | met |
| Bray 2012 low/normal/high-protein … — 25 % protein: weight change (+6.51 kg) | 6.51 ± 1.5 kg | 5.51 | met |
| Bray 2012 low/normal/high-protein … — 15 % protein: REE change (+160 kcal/d) | 160 ± 60 kcal/d | 120 | met |
| Bray 2012 low/normal/high-protein … — 25 % protein: REE change (+227 kcal/d) | 227 ± 60 kcal/d | 167 | known miss (conflicting sources, energy) |
| Bray 2012 — 15 % protein: lean change (+2.87 kg) | 2.87 ± 0.8 kg | 2.42 | met |
| Bray 2012 — 25 % protein: lean change (+3.18 kg) | 3.18 ± 0.8 kg | 2.27 | known miss (calibration, composition) |
| Bray 2012 — fat gain independent of protein: 25 % minus 5 % arm (0 ± 0.5 kg) | 0 ± 0.5 kg | -1.23 | known miss (conflicting sources, energy) |
| Ravussin 1985 — body-weight change after 9 d (3.2 kg) | 3.2 ± 0.8 kg | 3.30 | met |
| Roberts 1990 — body-weight change after 21 d (2.5 kg) | 2.5 ± 0.625 kg | 2.84 | met |
| Boden 2015 — body-weight change after 7 d (3.5 kg) | 3.5 ± 0.875 kg | 5.94 | known miss (calibration, water) |
| Müller 2015 — body-weight change after 7 d (1.8 kg) | 1.8 ± 0.45 kg | 1.68 | met |
| Sagayama 2014 — body-weight change after 3 d (0.7 kg) | 0.7 ± 0.175 kg | 1.49 | known miss (study set-up, water) |

Weight gain over 6-14 weeks is on target. Short (3-7 day) surpluses overshoot because the model's default sodium intake
rises with food energy, so extra food brings extra water outside the cells that the studies did not report (Sagayama,
Boden).

### Water-only fasting: 7 days and the reference model

Kolnes 2025, Pietzner 2024 and Kerndt 1982, and the reference model of a water-only fast set out in the Extended water
fasting topic of the Evidence library (rows marked "water-fasting reference model").

| study / quantity | target | model | verdict |
|---|---|---|---|
| Kolnes 2025 — body weight change after 7 d (−5.8 ± 0.3 kg) | -5.8 ± 0.8 kg | -5.62 | met |
| Kolnes 2025 — fat mass change after 7 d (−1.4 ± 0.1 kg) | -1.4 ± 0.5 kg | -1.19 | met |
| Kolnes 2025 — DXA-lean change after 7 d (−4.6 ± 0.3 kg) | -4.6 ± 1 kg | -4.43 | met |
| Kolnes 2025 — urinary nitrogen over 7 d (83.9 ± 6.7 g) | 83.9 ± 15 g N | 89.2 | met |
| Pietzner 2024 — weight change at the end of the fast (−5.7 ± 0.8 kg) | -5.7 ± 1 kg | -5.41 | met |
| Pietzner 2024 — fat change at the end of the fast (−1.6 ± 1.3 kg) | -1.6 ± 1.3 kg | -1.15 | direction met |
| Pietzner 2024 — weight change 3 d after refeeding (−3.1 ± 0.6 kg) | -3.1 ± 0.8 kg | -3.66 | met |
| Pietzner 2024 — lean change 3 d after refeeding (−0.69 ± 0.49 kg) | -0.69 ± 0.6 kg | -2.24 | known miss (study set-up, fasting) |
| water-fasting reference model — 168 h: weight change (-5.7 kg) | -5.7 ± 0.855 kg | -5.86 | met |
| water-fasting reference model — 168 h: fat change (-1.3 kg) | -1.3 ± 0.325 kg | -1.21 | met |
| water-fasting reference model — 7 d: DXA-lean change (−4.4 kg) | -4.4 ± 1 kg | -4.65 | met |
| water-fasting reference model — 3 d after the 7-d fast: weight change vs baseline (−2.6 kg) | -2.6 ± 0.8 kg | -2.94 | met |
| water-fasting reference model — 24 h: weight change (-1.6 kg) | -1.6 ± 0.24 kg | -1.64 | met |
| water-fasting reference model — 48 h: weight change (-2.7 kg) | -2.7 ± 0.405 kg | -2.77 | met |
| water-fasting reference model — 72 h: weight change (-3.5 kg) | -3.5 ± 0.525 kg | -3.60 | met |
| water-fasting reference model — 504 h: weight change (-11 kg) | -11 ± 1.65 kg | -10.9 | met |
| Kerndt 1982 — week-1 weight-loss rate (0.9 kg/d) | 0.9 ± 0.2 kg/d | 0.76 | met |
| Kerndt 1982 — week-3 weight-loss rate (0.3 kg/d) | 0.3 ± 0.2 kg/d | 0.28 | met |

### Fasting ketones

| study / quantity | target | model | verdict |
|---|---|---|---|
| Browning 2012 / McDougal 2018 / Klein 1993 — men: BHB at 24 h (0.41 mM) | 0.41 ± 0.123 mmol/L | 0.50 | met |
| Browning 2012 / McDougal 2018 / Klein 1993 — men: BHB at 48 h (1.94 mM) | 1.94 ± 0.582 mmol/L | 1.71 | met |
| Browning 2012 / McDougal 2018 / Klein 1993 — men: BHB at 72 h (2.3 mM) | 2.3 ± 0.69 mmol/L | 2.44 | met |
| Browning 2012 / McDougal 2018 / Klein 1993 — women: BHB at 24 h (0.33 mM) | 0.33 ± 0.099 mmol/L | 0.66 | known miss (conflicting sources, ketones) |
| Browning 2012 / McDougal 2018 / Klein 1993 — women: BHB at 48 h (1.22 mM) | 1.22 ± 0.366 mmol/L | 1.82 | known miss (conflicting sources, ketones) |
| Browning 2012 / McDougal 2018 / Klein 1993 — women: BHB at 72 h (2.3 mM) | 2.3 ± 0.69 mmol/L | 2.47 | met |
| McDougal 2018 — BHB at 12 h (0.1 mM) | 0.1 ± 0.15 mmol/L | 0.11 | met |
| McDougal 2018 — BHB at 72 h (2.3 mM) | 2.3 ± 0.69 mmol/L | 2.44 | met |
| Owen & Reichard 1971 / Balasse 1979 — BHB at 3 d (2.23 mM) | 2.23 ± 0.669 mmol/L | 1.59 | met |
| Owen & Reichard 1971 / Balasse 1979 — BHB at 24 d (5.29 mM) | 5.29 ± 1.587 mmol/L | 5.70 | met |
| water-fasting reference model — 168 h: BHB at the end (3.7-4.3 mM) | [2.59, 5.59] mmol/L | 4.21 | met |
| water-fasting reference model — 504 h: BHB at the end (5.4-6 mM) | [3.78, 7.8] mmol/L | 6.03 | met |

The same model, with each fast starting after a normal day that ends with a 20:00 dinner (hours counted from that
meal), blood BHB in mmol/L:

| person | 24 h | 48 h | 72 h | day 7 | day 21 |
|---|---|---|---|---|---|
| lean man | 0.50 | 1.71 | 2.44 | 4.21 | 6.03 |
| obese woman | 0.35 | 1.12 | 1.53 | 2.96 | 5.50 |

Nutritional ketosis (lean man, 4 weeks, BHB in mmol/L):

| carbohydrate | energy | first morning ≥ 0.5 mM | week-4 07:00 | week-4 24-h mean |
|---|---|---|---|---|
| 20 g/d | maintenance | day 3 | 0.69 | 0.54 |
| 30 g/d | maintenance | day 4 | 0.64 | 0.49 |
| 50 g/d | maintenance | day 6 | 0.55 | 0.40 |
| 20 g/d | 75 % | day 2 | 1.16 | 0.90 |
| 30 g/d | 75 % | day 2 | 1.04 | 0.79 |
| 50 g/d | 75 % | day 3 | 0.84 | 0.61 |

The women's 24- and 48-hour values miss because two published sources disagree on the direction of the sex difference
(Haymond: women higher; Browning: women lower); no single set of parameter values satisfies both.

### Novice muscle growth

| study / quantity | target | model | verdict |
|---|---|---|---|
| Benito 2020 — untrained: lean-tissue change after 10.4 wk (+1.54 kg) | 1.54 ± 0.4 kg | 1.51 | met |
| Benito 2020 — trained (starting training status 0.45): lean-tissue change after 10.4 wk (+0.98 kg) | 0.98 ± 0.4 kg | 0.84 | met |
| Morton 2018 — FFM gain ratio, supplemented / control (1.27) | 1.27 ± 0.15 ratio | 1.16 | met |
| Peterson 2011 — lean-tissue change after 20.5 wk (+1.1 kg) | 1.1 ± 0.4 kg | 0.95 | met |
| Novice strength gain after 12 weeks of RT — strength index change after 12 wk (19-27 %, ±3) | [16, 30] % | 16.9 | met |
| McDonald / Aragon-Helms heuristics — year 1 gain (9-11 kg) | [9, 11] kg | 9.27 | met |
| McDonald / Aragon-Helms heuristics — year 2 gain (4.5-5.5 kg) | [4.5, 5.5] kg | 3.80 | known miss (model structure, muscle) |
| Helms 2023 — training-attributable muscle gain at +15 % minus at maintenance (≈ 0) | [-0.201, 0.201] kg | 0.01 | met |
| Ogasawara / Psilander, novice — gain remaining 20 weeks after 10 wk of RT (0.18) | 0.18 ± 0.2 (direction only) | 0.20 | in direction |
| Same detraining finding, restated for a long-term lifter — share of the losable trained gains lost in 3 weeks off (≤ 3 %) | [-0.01, 0.03] | 0.006 | met |
| Same detraining finding, restated for a long-term lifter — share of the losable trained gains lost after 20 weeks off (0.82) | 0.82 ± 0.1 | 0.81 | met |

### Lean mass in a deficit: training and protein

| study / quantity | target | model | verdict |
|---|---|---|---|
| Murphy & Koehler 2022 — deficit at which the 12-wk lean change crosses zero (500-700 kcal/d) | [500, 700] kcal/d | 681 | met |
| Villareal 2017 — RT arm: DXA lean-mass change after 6 mo (−1.0 kg) | -1 ± 0.8 kg | -0.45 | met |
| Villareal 2017 — aerobic arm: DXA lean-mass change after 6 mo (−2.7 kg) | -2.7 ± 0.8 kg | -1.55 | known miss (model structure, composition) |
| Villareal 2017 — RT loses less lean than aerobic (direction) | > 0 kg | 1.09 | met |
| Ballor & Poehlman 1994 — diet only: FFM share of the loss (24-28 %) | [24, 28] % | 11.6 | known miss (model structure, composition) |
| Ballor & Poehlman 1994 — diet + RT: FFM share of the loss (11-13 %) | [11, 13] % | 2.97 | known miss (conflicting sources, muscle) |
| Ballor & Poehlman 1994 — FFM share with exercise is 0.25-0.5 of the diet-only share | [0.25, 0.5] ratio | 0.26 | met |
| Longland 2016 deficit + RT/HIIT — CON: lean-mass change (+0.1 ± 1.0 kg) | 0.1 ± 1 kg | -0.56 | met |
| Longland 2016 deficit + RT/HIIT — PRO: lean-mass change (+1.2 ± 1.0 kg) | 1.2 ± 1 kg | -0.35 | tracked miss |
| Longland 2016 deficit + RT/HIIT — between-group lean difference PRO − CON (observed 1.1 kg, target ≥ 0.4 kg) | > 0.4 kg | 0.21 | known miss (modelling decision, composition) |
| Mettler 2010 — LBM loss ratio, high protein / control (≤ 0.5) | < 0.5 ratio | 1.00 | known miss (modelling decision, muscle) |
| Wycherley 2012 / Krieger 2006 / Kim 2016 — FFM retained by high protein (HP − SP lean-tissue change, 0.3-0.9 kg) | [0.3, 0.9] kg | -0.02 | known miss (model structure, energy) |
| Pasiakos 2013 — lean share of the loss: 0.8 g/kg > 1.6 g/kg (share difference, > 0) | > 0 fraction | 0.08 | met |
| Morton 2018 — FFM added by raising protein 1.2 → 1.6 g/kg (0.1-0.5 kg) | [0.1, 0.5] kg | 0.49 | met |
| Garthe 2011 — slow loss gains more lean than fast loss (percentage points, > 0) | > 0 % points | 0.18 | met |

Resistance training protects lean mass in the right direction and by roughly the right amount in obese and older
adults; the added benefit of high protein in a deficit is too small (Longland, Mettler, Wycherley). Two modelling
decisions shape this: the most that high protein can rescue training-driven muscle gain in a deficit was set to the low
end of its range, so that the Murphy zero-crossing is met; and the effect of training on lean mass is taken only from
the Resistance training topic.

### Liver fat

| study / quantity | target | model | verdict |
|---|---|---|---|
| Browning 2011 — hypocaloric mixed diet: liver-fat change after 14 d (−28 %) | -28 ± 10 % | -15.0 | known miss (study set-up, cardiometabolic) |
| Browning 2011 — low-carbohydrate: liver-fat change after 14 d (−55 %) | -55 ± 10 % | -30.2 | known miss (study set-up, cardiometabolic) |
| Mardinoglu 2018 — liver-fat change after 14 d (−43.8 %) | -43.8 ± 10 % | -3.96 | known miss (model structure, cardiometabolic) |
| Lim 2011 — IHTG at 8 weeks (2.9 %) | 2.9 ± 0.58 % | 2.60 | met |
| Luukkonen 2018 — SFA overfeeding: liver-fat change (+55 %) | 55 ± 15 % | 44.3 | met |
| Luukkonen 2018 — unsaturated overfeeding: liver-fat change (+15 %) | 15 ± 15 % | 12.9 | met |
| Luukkonen 2018 — sugar overfeeding: liver-fat change (+33 %) | 33 ± 15 % | 22.9 | met |
| Magkos 2016 — IHTG at −5.1 % weight (7.4 %) | 7.4 ± 1.11 % | 6.11 | known miss (conflicting sources, cardiometabolic) |
| Magkos 2016 — IHTG at −10.8 % weight (4.1 %) | 4.1 ± 0.615 % | 4.06 | met |
| Magkos 2016 — IHTG at −16.4 % weight (3.0 %) | 3 ± 0.45 % | 2.66 | met |

### Blood lipids and blood pressure

| study / quantity | target | model | verdict |
|---|---|---|---|
| Mensink 2016 — SFA → PUFA: LDL change (−0.55 mmol/L) | -0.55 ± 0.1375 mmol/L | -0.60 | met |
| Mensink 2016 — carbohydrate → SFA: LDL change (+0.36 mmol/L) | 0.36 ± 0.09 mmol/L | 0.37 | met |
| Mensink 2016 — carbohydrate → SFA: HDL change (+0.11 mmol/L) | 0.11 ± 0.0275 mmol/L | 0.11 | met |
| Mensink 2016 — carbohydrate → SFA: TG change (−0.12 mmol/L) | -0.12 ± 0.03 mmol/L | -0.12 | met |
| Skulas-Ray 2011 — 3.4 g/d: TG change after 8 wk (−27 %) | -27 ± 8 % | -27.5 | met |
| Buren 2021 / Retterstøl 2018 vs … — lean woman: LDL change after 4 wk (+1.81 mmol/L; sign and order) | [0.9, 3.6] mmol/L | 1.26 | met |
| Buren 2021 / Retterstøl 2018 vs … — normal-weight adult: LDL change after 3 wk (+0.9 mmol/L; sign and order) | [0.45, 1.8] mmol/L | 0.91 | met |
| Buren 2021 / Retterstøl 2018 vs … — BMI 39 with ≈ 10 % loss: LDL change (−0.26 mmol/L; sign and order) | [-0.52, -0.13] mmol/L | 0.06 | known miss (conflicting sources, cardiometabolic) |
| DIETFITS — low-fat: LDL change (−2.1 mg/dL) | -2.1 ± 4 mg/dL | -6.77 | known miss (conflicting sources, cardiometabolic) |
| DIETFITS — low-carbohydrate: LDL change (+3.6 mg/dL) | 3.6 ± 4 mg/dL | -4.61 | known miss (conflicting sources, cardiometabolic) |
| DIETFITS — low-fat: TG change (−10 mg/dL) | -10 ± 4 mg/dL | -6.79 | met |
| Sävendahl 1999 — 7-d fast: LDL change (+66 %) | 66 ± 19.8 % | 26.3 | known miss (model structure, cardiometabolic) |
| Sacks 2001 — SBP change after 4 weeks (−6.7 mmHg) | -6.7 ± 1.5 mmHg | -3.22 | known miss (conflicting sources, cardiometabolic) |

Most lipid misses come from conflicting sources: the per-kilogram weight-loss slopes for LDL, triglycerides and blood
pressure that fit one trial (DIETFITS) do not fit others (Magkos, the ketogenic LDL series, Neter's meta-analysis).

### Leptin, T3 and testosterone

| study / quantity | target | model | verdict |
|---|---|---|---|
| Weigle 1997 — leptin change at 72 h (−62 %; accepted model range −50 … −75 %) | [-75, -50] % | -65.6 | met |
| Chan 2003 — leptin change (−90 %) | -90 ± 15 % | -51.9 | tracked miss |
| Dubuc 1998 — men: leptin change (−36 %) | -36 ± 15 % | -45.2 | met |
| Dubuc 1998 — women: leptin change (−61 %) | -61 ± 15 % | -64.6 | met |
| Müller 2015 — leptin change at the end of restriction (−44 %; accepted model range −35 … −55 %) | [-55, -35] % | -53.3 | met |
| Müller 2015 — T3 change (−39 %; accepted model range −20 … −40 %) | [-40, -20] % | -25.0 | met |
| Müller 2015 — testosterone change (−11 %; accepted model range 0 … −20 %) | [-20, 0] % | -6.33 | met |
| Chan 2003 — T3 change (−30 %) | -30 ± 15 % | -33.7 | met |
| Chan 2003 — testosterone change (−40 %) | -40 ± 15 % | -34.6 | met |
| Friedl 2000 / Henning 2014 — testosterone change at day 56 (−70 %; accepted model range −55 … −80 %) | [-80, -55] % | -10.8 | known miss (model structure, hormones) |
| Pardue 2017 / Rossow 2013 — testosterone change at the end of preparation (−60 … −80 %) | [-80, -60] % | -73.2 | met |
| Pardue 2017 / Rossow 2013 — T3 change at the end of preparation (≥ −45 %; observed 123 → 40 ng/dL) | [-45, 0] % | -45.4 | known miss (conflicting sources, hormones) |
| Ebbeling 2012 — leptin, very-low-carbohydrate / low-fat (≤ 0.8) | < 0.8 ratio | 0.79 | met |
| Ebbeling 2012 — T3, very-low-carbohydrate / low-fat (≤ 0.9) | < 0.9 ratio | 1.00 | known miss (modelling decision, hormones) |

## Uncertainty bands

The ensemble draws every model parameter that has a documented plausible range (Latin hypercube sampling, a way of
spreading the draws evenly across those ranges; 32 draws, with a fixed random seed of 1 so the bands are repeatable), plus a person-level deviation of resting metabolic rate
from the prediction equation (±20 %, from the Energy expenditure and Sleep, sex and age topics). That person-level term
was added because without it the RMR and fat bands were far narrower than the between-person spread (fat ±7 %). The
table gives half the width of the band between the 10th and 90th percentiles (P10-P90) at the end of each scenario, as a
percentage of the nominal change (or of the value, for RMR and TEE):

| scenario (reference man, 12 weeks unless stated) | fat change | lean change | skeletal muscle | RMR (value) | TEE (value) | other |
|---|---|---|---|---|---|---|
| 25 % deficit, 3 RT sessions/wk, 1.6 g/kg protein | ±18 % (−7.0 kg) | ±0.57 kg (nominal −0.13 kg) | ±0.39 kg | ±9.4 % | ±5.6 % | scale ±23 %; muscle gain from RT ±99 % |
| 15 % surplus, 3 RT sessions/wk, 1.8 g/kg | ±1.2 kg (nominal −0.23 kg) | ±53 % (+2.0 kg) | ±54 % | ±8.8 % | ±4.8 % | muscle gain from RT ±53 % |
| very low carbohydrate at maintenance, 72-h fast on day 21 (day 24) | ±0.37 kg | ±16 % (DXA lean) | ±27 % | ±10.9 % | ±7.4 % | BHB ±33 %; hunger P10-P90 14-70 |

Compared with the between-person spread reported in the Sleep, sex and age topic of the Evidence library (fat change
±35 %, lean change ±50 %, RMR ±13 %), the lean and RMR bands are of the same size and the fat-change band is about half
as wide. That is expected: the ensemble carries only uncertainty in physiology, while the published spread also
contains differences in how closely people followed the plan, and measurement error, which the model does not
simulate. Where a nominal change is near zero (lean in the deficit scenario, fat in the surplus scenario), a relative
width is meaningless and the absolute band is shown. The hunger band after a fast is wide because the parameter for the
width of fasting hunger is drawn over 12-36 h. Triglycerides after the fast have a wide, left-skewed change band (−1.10
to −0.25 mmol/L from a 1.0 mmol/L nominal baseline); turned into a band of values (nominal baseline plus each change
percentile) its lower edge would fall below zero, so this series should be shown only as a change from baseline, which
is how the app's list of outputs already defines it.

## Speed and repeatability

Speed is measured inside the automated tests on the same compiled model the app ships: one 180-day run of the reference
man on a training week, the best of 15 runs after a warm-up, with all 16 parts of the model active.

| mode | best | median | limit |
|---|---|---|---|
| goal planner (goal series only) | 6.6 ms | 7.7 ms | 10 ms |
| simulation, no series recorded | 8.1 ms | 10.0 ms | 15 ms |
| simulation, daily series recorded | 9.6 ms | 10.9 ms | 15 ms |
| simulation, everything recorded (hourly series, warnings, events) | 9.9 ms | 11.5 ms | 15 ms |

Run inside the test tool without the app's build step (for information only), the same run takes 14.6 ms. The speed
test records how busy the machine is, and is skipped rather than failed when the machine is saturated (more than 0.5
runnable tasks per processor core, after a retry), so a busy test machine cannot report a slowdown that is not real; on
an idle machine the limits are enforced.

Repeatability: identical inputs give bit-identical results for three example people. Restoring a snapshot saved after
the model's settling-in period ("burn-in") gives bit-identical results to running that period again (all 16 parts of
the model, two schedules; also the planner's snapshots for each uncertainty draw). Uncertainty draws give identical
results whatever the number of parallel workers, how the draws are split and in what order (tested as 1 × 8, as
3 + 3 + 2 in reverse order, and as 8 × 1 interleaved).

## Physical consistency checks

| check | what is checked | result |
|---|---|---|
| Conservation | hourly energy balance within 1e-6 kcal, daily within 1 kcal; scale weight = fat + lean + labile (fast-changing) water within 1e-9 kg; in every arm of every scenario and for three example people on mixed schedules | pass |
| Morning anchor | the day-0 wake-up scale weight equals the entered weight (± 0.05 kg; worst 3 g) in every arm whose first night is the person's usual one | pass |
| Zero intake | 21- and 28-day water-only fasts: every series stays finite, no store goes negative, fat mass never rises, BHB stays finite | pass |
| Repeatability | as described under "Speed and repeatability" | pass |
| Equal calories, equal fat balance | swapping carbohydrate for fat at equal calories (10-30 % of energy) and eating 1 vs 3 meals/d do not change expenditure or fat balance | pass |
| Order of weeks | rearranging the same weekly blocks moves 12-week fat by < 0.2 kg | pass |
| Steady state | 78 combinations of example person and usual schedule at maintenance for 30 d: fat-mass change under 0.15 kg either way, scale change under 0.3 kg either way (worst fat-mass change −0.04 kg) | pass |
| Daily totals match hourly values | every daily series equals its hourly series combined in the way the app defines for that output | pass |

## Known misses, grouped by cause

**Consequences of modelling decisions (21).** The largest group comes from one decision about fuel: glucose from a meal
refills muscle glycogen before it is burned, and only glycogen above the fed level is drawn on. This removes a drift
that is not physically possible, but it means muscle glycogen barely falls on low-carbohydrate diets, so the first-week
weight loss of a switch to a ketogenic diet (Hall 2016, Yang), the water share of that loss, the fat balance under
carbohydrate restriction in Hall 2015 and the delay in fat balance seen by Schrauwen are all too small. The other
decisions: the energy cost of making new glucose (gluconeogenesis) is set to zero; the thermic effect of alcohol (the
energy spent processing it) is set to 0.10; the most that high protein can rescue training-driven muscle gain in a
deficit is set to 0.5; the effect of training on lean mass is taken only from the Resistance training topic; Bray's
5 %-protein arm is checked against a change in resting expenditure of about zero, on which most sources agree; and T3
responds to carbohydrate only below 50 g/d.

**Conflicting sources (31).** Two sources give targets that no set of parameter values within their documented ranges
can meet together: the per-kilogram slopes for blood lipids and blood pressure (DIETFITS against Magkos, Neter and the
ketogenic LDL series), the sex difference in fasting ketosis (Haymond against Browning), uric acid during fasting (the
equation in the Blood fats and markers topic against the observations in the Extended water fasting topic), Bray's REE
against its fat-gain row, and conventions that differ between topics (lean mass on a hydrated DXA basis in the Protein
and muscle topic against Hall's lean tissue in the nitrogen-balance rows; the tighter tolerance in the Fasting and meal
timing topic against the Extended water fasting topic's own model for Laurens).
The four newest misses are in the Activity levels at the start of a plan topic: the ratio of a day's energy use to resting energy use
(the physical activity level) for a desk-bound and an on-your-feet job, man and woman, against the ranges in the FAO/WHO
lifestyle table. The model gives 1.39 for the desk-bound archetypes against 1.4-1.5 and 1.68 for the on-your-feet ones against
1.7-1.9, about 1 % below the bottom of each range. The model works out the share of energy spent digesting food (about
0.087) from the usual mix of carbohydrate, fat and protein, while the table the archetypes were first computed with assumed 0.10,
which gives values about 1.4 % higher. The on-your-feet job in the same set that involves walking all day does pass (1.77).

**Model structure (26).** Mechanisms that version 1 of the model does not have, or simplifies: liver glycogen
made by the indirect route after a meal, burning glucose first when muscle glycogen is above its normal level during
carbohydrate loading, the 60 g/h cap on carbohydrate absorption, a fasting-specific LDL rise, age and insulin-resistance
effects on ketone production, protein deposition that should not occur from a fat-only surplus, age-related waist
drift, and the leptin-threshold route to hypogonadism (reduced sex-hormone production) outside contest leanness.

**Study set-up (11).** The study cannot be entered exactly: a resting day in a calorimeter chamber (Acheson), unreported
sodium intake in short overfeeding studies, refeeding at will with unreported intake (Pietzner), the combined stressors
of military courses (Nindl), a performance index that is not a race time (Burke 2017).

**Open calibration (11).** Changing one parameter within its documented range would close the row but break another
target. Examples: setting the liver's glycogen capacity to 420 mmol per litre of liver would fix Rothman's post-meal
liver glycogen but moves Deru's time to ketosis in the exercise arm out of its band (tested, not applied; lowering the
muscle-glycogen capacity to 180 mmol per kg of muscle was applied and closes Bussau's supercompensation row); the
refilling of the readily used protein store after a fast that would fix Templeman breaks the weekly-fast protein row;
setting the protein-related lean gain per kg of fat gained in a surplus to 0.50 fixes Bray's high-protein lean gain but
breaks Levine.

## What changed in the latest model update

These changes were made on 30 September and 1 October 2026. Where a result is given as "a → b", a is the value before
the change and b the value after it.

- **Detraining now stops at a retained floor** (muscle). After the last training session there is no muscle loss for
  about 3 weeks; trained muscle then decays with a time constant of 70 days, as described in the Resistance training
  topic, but now towards a retained floor. The untrained level, derived from the fat-free mass index (FFMI), is never
  lost to detraining: a regular lifter's trained gains are what the body carries above the untrained FFMI reference, at
  least the training offset given in the Body composition topic for the stated years of training. A long-term lifter
  keeps 0.5 of those gains (evidence grade C, a proposed value; plausible range 0.3-0.7). Gains made during a simulation
  are lost fully when training stops (Psilander), so the novice detraining check keeps its original target; two must-pass
  checks restate that finding for a long-term lifter (0.6 % of the losable gains lost in 3 weeks; 81 % after 20 weeks,
  target 82 ± 10). In a test case (a man, 34 y, 88 kg, 1-3 years of training, 3 lifting sessions a week, then a
  schedule without lifting at 100 % of maintenance): lean mass −3.97 → −1.05 kg at 8 weeks, −8.62 → −2.23 kg at 20
  weeks; fat +0.84 → +0.13 kg at 8 weeks. Checks that changed: Nindl (the strength known miss −4.1 → −2.6 %, the
  fat-free mass direction-only check −5.6 → −4.4 kg, the body-mass direction-only check −8.5 → −7.7 kg) and ICECAP (a
  direction-only check); no check changed status.
- **Regaining lost muscle** (muscle). Muscle lost below a previous peak is now regained at the full retraining rate
  described in the Resistance training topic (which accounts for the gap in training status, habituation and a "muscle
  memory" boost, now 1.3 by default), up to the previous peak; above the peak the usual long-term balance is unchanged.
  The same test lifter, after 12 weeks off (−1.60 kg) and then back on the usual programme, regained 76 % after 16 weeks
  (was 10 %) and 100 % after 26 weeks (was 19 %). Only one Bickel check moved (older adults, 1/9 of the training dose: 0.30 → 0.35
  of the gain kept, still < 0.9); no known miss moved.
- **"Training as usual."** A day can now follow the profile's usual training sessions for its weekday; 12 weeks at
  100 % on the usual diet are stable in weight and lean mass for sedentary, lifting, running and mixed profiles.
- **Keto-adaptation index** (ketones). The displayed index is 50 × (fast adaptation + slow adaptation): a fast part
  (days) and a slow part (weeks), each counted half. It is about 50 at day 7 of a ketogenic diet and 55-65 after 3-4
  weeks (it was 94-96 by day 7). Both parts are available as detailed series. No validation check reads the index.
- **Fast warnings** (safety). The safety tiers for fasts, and the fast length they report, now use the planned time from
  the last meal to the next. A "72 h" fast now reads 72 h (it read 71 h), and a 72-hour fast without a refeeding plan
  now gets the warning to restart food gradually (it was missed).
- **Switching from very low carbohydrate to high carbohydrate.** A test case (88-kg man, 3 lifting sessions a week) had
  shown fat −0.8 kg and lean −4.3 kg in 8 weeks. The cause was detraining (the lifting sessions had not been put on the
  schedule), not the split of weight change between fat and lean. With the lifting sessions on the schedule, lean
  tissue is −0.05 kg after the 4 very-low-carbohydrate weeks and −0.09 kg after 8 weeks, fat −1.97 kg (the lean-mass dip
  of −1.9 kg during the very-low-carbohydrate weeks is glycogen and water); without lifting, lean tissue is now −1.34 kg
  and fat −1.48 kg.
- **What "% of maintenance" means.** It now means the intake that keeps weight stable at the activity the schedule plans.
  Study scenarios whose protocols set intake relative to the usual (baseline) intake while adding or removing exercise
  keep that meaning by measuring maintenance at the person's usual activity (CALERIE-1 CR + EX, MET-2's unchanged
  intake, Deru 2021's standardised meal, Veldhorst's glycogen-lowering ride, Pasiakos's −30 % diet + 10 % exercise); the
  detraining arm of one cardio study uses 100 % instead of 92 %. Studies fed "at energy balance" with training (Garthe,
  Helms, Benito, Peterson, the McDonald heuristics, Burke 2017) now get the energy for that training: McDonald year 1
  passes (9.27 kg), and Pardue's T3 (−46.9 %) and Burke 2017's index gap move within their existing known misses. One
  cardio check, visceral fat without weight loss, is now a known miss: its arm had been losing ≈ 1.5 kg of fat because
  the maintenance reference ignored the training; when truly weight-stable, visceral fat follows fat mass only (the exercise effect
  on visceral fat described in the Blood fats and markers topic is not modelled).
- **More training volume never means less lean gain** (composition). In a surplus, lean gain no longer falls as
  resistance-training volume rises (a trained lifter at +10 % had gained less lean at 8-12 than at 4 sets/week); no
  must-pass check changed status.
- **Exercise and ketones** (ketones). The effects of exercise on ketone production and use now fade when blood ketones
  are already high; no check in the Fat oxidation and ketosis or Extended water fasting topics moved by more than 0.3 %.
  The ketone results above (fasting 24 h/48 h/72 h/day 7/day 21 for the lean man: 0.50/1.71/2.44/4.21/6.03 mM; first
  morning ≥ 0.5 mM at 20/30/50 g/d on day 3/4/6, and in a 25 % deficit on day 2/2/3) are unchanged.
- **Muscle-glycogen capacity lowered from 200 to 180 mmol per kg of muscle** (fuel; the low end of its documented range).
  Bussau's 72-hour ratio now passes (2.60 vs 2.33 ± 0.35); Boden and the other Bussau rows move within their existing
  known misses.
- **Starting point for heat from carbohydrate overfeeding.** The extra heat produced when overeating carbohydrate now
  starts above the day's maintenance at the planned activity (Mikkelsen's 24-hour energy expenditure difference 94 →
  118 kcal/d, target 80-120, still met; Martin 2019 moves within its band).
- **Speed after the update.** The compiled model, best of 15 runs at a machine load of ≈ 0.4 per core (other work
  running): goal planner 7.1-7.7 ms; simulation with no series / daily series / everything recorded 8.5-8.8 / 9.4-10.3
  / 9.9-11.0 ms. The previous version, measured side by side under the same load, gave 8.2-8.5 ms for the planner, so
  the update did not slow the model down (the 6.6 ms above was measured at load 0.1).

## Corrections to how studies were entered

A study that is entered wrongly can make a correct model look wrong, or a wrong model look right. The following
scenario inputs were corrected from the study reports or from the research summaries in the Evidence library; no
tolerance was changed.

- **Fasting clocks.** Browning's BHB and the water-fasting reference model's BHB rows are read at the stated hours after
  the last meal (they had been read 4 h later, on the steepest part of the curve). Gipson's shake is drunk at 08:00
  after the overnight fast, as in the paper (it had followed a whole day without food, so "24 h" was 48 h); this turned
  one check that had passed by accident into a known miss. Veldhorst's glycogen-lowering exercise follows the last meal
  and BHB is read the next morning.
- **Refeeding.** The water-fasting reference model's "+3 days after" rows refeed at the pre-fast maintenance intake, as
  the model check in the Extended water fasting topic does.
- **Intake as reported.** Laurens: protein virtually zero and steps +60 % during the fast (both from the paper). Dai:
  the group's measured baseline REE (≈ 1 513 kcal/d, derived from the reported day-15 value) is entered as a measured
  RMR. Johnstone: the measured intake when eating at will (7.25 MJ/d). Diaz and Ravussin: the studies' absolute
  surpluses (+6.2 MJ/d, +8.0 MJ/d) instead of percentages of the example person's maintenance. Burke 2021: fed at the
  model's own total energy expenditure on the training schedule (energy balance, as in the study). Suter: alcohol added
  to unchanged food amounts.
- **Protocol and measurement.** Deru: 1 h at 65 % VO2max after dinner has been absorbed, once (as in the model check in
  the Fat oxidation and ketosis topic). Vandenberghe: the second dose of MCT (medium-chain triglycerides) taken fasted,
  with total ketones compared. Novotny: absorbed energy compared, with the almonds' fibre added. Bussau and Shiose: body
  water excludes the mass of the glycogen itself.
- **Other corrections.** The daily carbohydrate balance reference model uses the Vitals model's mean total energy
  expenditure and 4.0 kcal/g for protein; Acheson's calorimeter-chamber day uses 1 000 steps; Rothman's meal follows a
  normal day; several protein and muscle-growth studies are fed at the model's own total energy expenditure on their
  training schedule.

Of the checks whose status changed with these corrections, 15 moved from miss to pass (one of them Johnstone, formerly
a tracked miss) and 2 from pass to miss (Gipson and Suter); Laurens' weight stayed a miss but now overshoots the ±0.8 kg
tolerance of the Fasting and meal timing topic while matching the Extended water fasting topic's own model.

## What the model should not be trusted for

- **Individual predictions.** The bands describe uncertainty in physiology for an average person with the stated body;
  they do not include how closely a plan is followed, measurement error or day-to-day scale noise. Individual outcomes
  vary more.
- **The first week of a low-carbohydrate or ketogenic diet.** Muscle glycogen and its water hardly fall, so the early
  scale drop is under-predicted by about 1 kg (fat loss is unaffected).
- **Short overfeeding (days).** Scale gain over 3-7 days is over-predicted when sodium rises with food; tissue gain is
  reasonable.
- **Liver glycogen timing after a meal, carbohydrate loading and supercompensation.** Hourly liver glycogen synthesis
  stops with absorption, loading spreads over days, and the modelled water stored with loaded glycogen is larger than
  measured.
- **Blood lipids and blood pressure beyond direction.** Most misses for blood fats and markers come from conflicting
  sources; treat magnitudes as indicative, especially LDL on ketogenic diets, LDL and uric acid during fasting, and the
  blood-pressure effect of weight loss.
- **The added benefit of high protein in a deficit**, which is smaller than in the trials, and lean change in older
  adults doing aerobic exercise.
- **Sex differences in fasting ketosis**, where the sources disagree.
- **Hormones under extreme conditions** (military semistarvation, contest preparation), and leptin in fasts longer than
  48 h.
- **Performance indices** as race-time predictions; the endurance index is a glycogen-limited capacity.
- **Long-term weight regain and maintenance behaviour.** Intake is an input: eating at will and compensating, the fall
  in voluntary activity during semistarvation, and appetite-driven regain are not simulated.
