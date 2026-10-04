# 14 — Anthropometrics, body-composition estimation, fat distribution and avatar parameters

Author: research agent 14. Date of literature work: 2026-09-30. Conventions: `sexF = 1` for female, `0` for male
(CUN-BAE, RFM); Deurenberg/Gallagher/Kagawa/Navy print male = 1 and are re-expressed below with `M/F` branches.
Body-fat percentage (BF%) always means **DXA-equivalent fat mass / body mass** (NHANES/Hologic frame) unless stated.
Anything not traced to a source I actually opened is tagged `UNVERIFIED`; my own fits are tagged `PROPOSED FIT`
with the data points used. Numbers in square brackets are reference numbers (section 11).

Method note (honest disclosure): PubMed/Europe PMC abstracts, OA full texts (PMC/Frontiers/PLoS/Sci Rep) and the
Kelly-2009 supplementary LMS tables were read directly. ScienceDirect/OUP/Nature/APS full texts were blocked; where
a number below comes from a secondary source, it is tagged. A shared web-search budget was exhausted mid-task, so
a few textbook conventions (essential-fat percentages, Drillis-Contini landmark proportions) are `UNVERIFIED`.

---------------------------------------------------------------------------------------------------------

## 1. Scope

1. Turn the user's cheap inputs (sex, age, height, weight, optionally waist, training history, 2 body-shape sliders
   for adiposity and muscularity, a belly-vs-hips slider, regional extras) into the engine's *initial state*: fat mass,
   fat-free mass, skeletal muscle, fat depots (arms, legs, trunk subcutaneous, visceral, head), bone, water,
   glycogen, energy expenditure, training status, plus an **uncertainty** (sigma of BF%).
2. Provide regional **allocation rules** for fat loss and gain (VAT vs SAT, trunk vs limbs, sex, spot-reduction).
3. Turn simulated state back into **circumferences** (waist cm as a UI output) and **avatar parameters**
   (SVG silhouette front + side), with a licence-clean rendering recommendation.
4. Provide reference distributions/anchors (NHANES DXA, MRI VAT), validation targets and golden test values.

Out of scope (see other dossiers): RMR/TEF/adaptation (02), muscle protein turnover and hypertrophy rates (03, 09),
glycogen kinetics (04), hormones/menopause dynamics (12, 16), safety limits (17).

---------------------------------------------------------------------------------------------------------

## 2. State variables

| Name | Unit | Typical range (adult) | Meaning | Initial-value rule |
|---|---|---|---|---|
| `BF` | % | M 6-45, F 14-55 | whole-body fat fraction (DXA frame) | M3 fusion posterior mean; `BF_sd` = posterior sigma |
| `FM` | kg | 5-60 | fat mass | `W*BF/100` |
| `FFM` | kg | 35-90 | fat-free mass (incl. bone mineral, as in DXA "lean incl. BMC") | `W - FM` |
| `FMI`, `FFMI` | kg/m2 | FMI M 2-14, F 4-20; FFMI M 16-27, F 13-22 | height-scaled indices | `FM/h^2`, `FFM/h^2` |
| `depot.head` | kg | 0.4-2 | head/neck fat | `0.045*FM` (UNVERIFIED share) |
| `depot.arms` | kg | 1-6 | arm fat (both) | `limbFat*armShare` (M .22, F .19; UNVERIFIED) |
| `depot.legs` | kg | 3-25 | gluteofemoral+leg fat | `limbFat - arms` |
| `depot.sat` | kg | 2-25 | trunk subcutaneous fat (abdominal+chest+back+flank) | `trunkFat - VAT` |
| `depot.vat` | kg | 0.2-8 | visceral adipose tissue (fat mass basis) | M6 |
| `R` | ratio | M 0.5-1.9, F 0.4-1.6 | trunk : limb fat-mass ratio (android/gynoid index) | M6 (slider or waist) |
| `SM` | kg | M 20-55, F 12-35 | total skeletal muscle | M5 |
| `SM.arms/legs/trunk` | kg | | regional muscle | shares .115/.56/.325 (M), .105/.58/.315 (F) (UNVERIFIED) |
| `BMC` | kg | M 2.4-3.5, F 1.7-2.7 | bone mineral content | M5 |
| `TBW`, `ECW` | L | | body water; extracellular water | `0.73*FFM`; `0.38*TBW` |
| `glycogen.muscle/liver` | g | 250-700; 60-100 | stores | M5 |
| `TDEE0`, `intake0` | kcal/d | | maintenance; habitual intake = TDEE0 | M5 |
| `fPot`, `trainingClass` | 0-1 | | fraction of natural muscularity ceiling reached | M9 |
| `frame` | z | -2..2 | skeletal frame factor (default 0) | M5 |
| `circ.{neck,shoulder,chest,waist,hip,thigh,calf,arm}` | cm | | derived outputs | M8 |

## 3. Inputs

| Input | Unit | Role |
|---|---|---|
| sex, age, height, weight | -, y, cm, kg | all equations; weight is the **hard constraint** `FM + FFM = W` |
| waist circumference (optional) | cm | RFM estimator; solves trunk fat and `R` through the waist geometry (M8) |
| neck, hip (optional) | cm | US-Navy estimator (optional 3rd estimator) |
| known BF% + source (optional) | %, {DXA,BIA,skinfold,Navy} | overrides visual estimates (sigma 2.5/3.5/4/4) |
| fat slider s_f in [0,1] | - | visual adiposity, anchor table T2 |
| muscle slider s_m in [0,1] | - | visual muscularity, anchor table T3 |
| belly-vs-hips slider s_b in [-1,1] | - | z-score of trunk:limb fat ratio (`z = 2*s_b`) |
| chest / arms / face extras in [-1,1] | - | avatar-only re-allocation of trunk SAT / limb fat / head fat (M10) |
| regional muscularity (arms, legs, torso) in [-1,1] | - | shifts regional SM shares +-20 % (M5) |
| resistance-training years + quality | y | prior shift of FFMI (M3/M9) |
| ethnicity (optional) | - | offset on population estimators (M1) |
| menopause status, PAL, habitual carbohydrate | - | VAT age term, TDEE, glycogen |

---------------------------------------------------------------------------------------------------------

## 4. Mechanisms & equations

### M1. Population body-fat estimators from simple inputs

**Mechanism.** Fat-free mass scales with height and (weakly) with fat mass; so BF% is predictable from BMI, age and sex
to about +-4-5 %BF (1 SD), and from waist/height slightly better in general populations. The residual is dominated by
muscularity (BMI cannot see it), body build/ethnicity, and DXA-vs-4C reference-method differences.

**Equations** (BMI = kg/m2; h, waist in cm unless stated; `sexF` 1 = female):

| Estimator | Equation | Source / fit statistics |
|---|---|---|
| Deurenberg 1991 (adult) | `BF = 1.20*BMI + 0.23*age - 10.8*sexM - 5.4` (sexM = 1 male) | n=1229 (7-83 y, BMI 13.9-40.9), densitometry, R2 .79, SEE 4.1; slight over-estimate in obese [1] |
| Deurenberg 1991 (child <=15 y) | `BF = 1.51*BMI - 0.70*age - 3.6*sexM + 1.4` | R2 .38, SEE 4.4 [1] |
| Deurenberg (form printed in [8]; probably the 1998 meta-analysis equation, not confirmed) | `BF = 1.294*BMI + 0.20*age - 11.4*sexM - 8` | printed in Woolcott 2018 Table 2 footnote [8] |
| Gallagher 2000 (as quoted by [8]) | `BF = 64.5 - 848/BMI + 0.079*age - 16.4*sexM + 0.05*sexM*age + 39.0*sexM/BMI` | 1626 adults BMI<=35, 3 ethnic groups, 4C/DXA; R .74-.92, SEE 2.8-5.4 [5]; ethnic terms not reproduced in [8] |
| **CUN-BAE** (Gomez-Ambrosi 2012) | `BF = -44.988 + 0.503*age + 10.689*sexF + 3.172*BMI - 0.026*BMI^2 + 0.181*BMI*sexF - 0.02*BMI*age - 0.005*BMI^2*sexF + 0.00021*BMI^2*age` | n=6510 white Spanish adults, air-displacement plethysmography, mean BF 39.9%, SEE 4.66, r .89 [6]. Vs DXA (Hordaland): r .77 (M) .82 (W); bias +1.52 (M) -0.24 (W); over-estimates lean, under-estimates highest BF decile by 5.8 [7] |
| **RFM** (Woolcott & Bergman 2018) | `BF = 64 - 20*(height/waist) + 12*sexF` (height, waist same units) | NHANES 1999-2004 derivation n=12,581; 2005-06 validation n=3,456 vs DXA: R2 .69 (W) .75 (M); bias +0.9 (W) +0.5 (M); "precision" (IQR of error) 4.9 (W) 4.2 (M); age and ethnicity did not improve R2; ability declines with age; better for trunk than total fat [8] |
| Kagawa (as quoted by [8]) | `BF = -8.339 + 92.701*(waist/height) - 0.078*age - 11.062*sexM` | [8] |
| **US Navy circumference** (Hodgdon & Beckett 1984; DoDI 1308.3) | M: `86.010*log10(abd-neck) - 70.041*log10(ht) + 36.76`; F: `163.205*log10(waist+hip-neck) - 97.684*log10(ht) - 78.387` (inches). Metric (cm): M `495/(1.0324 - 0.19077*log10(waist-neck) + 0.15456*log10(ht)) - 450`; F `495/(1.29579 - 0.35004*log10(waist+hip-neck) + 0.22100*log10(ht)) - 450` | women: n=202, R .856, SEE 3.61 (secondary summary of DoDI); site definitions: neck below larynx, male waist at navel, female waist at narrowest point, hip at maximum [10]. Vs DXA in 609 fit Marines: men -2.6+-3.7 / -2.5+-3.7 (<=30 / >30 y), women +2.3+-4.3 / +1.3+-4.8; lean people over-estimated, high-BF under-estimated [11] |
| Jackson-Pollock 3-site skinfolds | M (chest, abdomen, thigh): `BD = 1.10938 - 0.0008267*S + 0.0000016*S^2 - 0.0002574*age`; F (triceps, suprailiac, thigh): `BD = 1.0994921 - 0.0009929*S + 0.0000023*S^2 - 0.0001392*age`; `BF = 495/BD - 450` (Siri) | SEE 0.0055-0.0060 g/mL (about 2.5-2.8 %BF) vs underwater weighing [12,13,14]; needs calipers -> **not an app input**, listed for validation only |

Provenance of coefficients: Deurenberg-1991 (publisher abstract); CUN-BAE (Vinknes 2017 full text and Woolcott 2018 footnote agree); RFM (Woolcott abstract and
full text); Navy (Potter 2022 full text, a DoD-formula secondary page and a DoDI summary agree; the female formula is `waist + hip - neck`); Gallagher, Kagawa and the
"Deurenberg" 1.294 form only as printed in Woolcott's Table 2 footnotes; JP from a secondary page (`topendsports`) and abstract-level SEE.

**Head-to-head in NHANES 2005-06 vs DXA (Woolcott Table 2 [8]; bias / "precision"=IQR of error; SD ~ IQR/1.349):**

| | Women bias / IQR / SD~ | Men bias / IQR / SD~ |
|---|---|---|
| raw BMI value read as %BF (naive) | -10.9 / 5.8 / 4.3 | +0.7 / 5.1 / 3.8 |
| RFM | +0.9 / 4.9 / 3.6 | +0.5 / 4.2 / 3.1 |
| CUN-BAE | -0.2 / 6.0 / 4.4 | -0.1 / 5.7 / 4.2 |
| Gallagher | -2.8 / 5.2 / 3.9 | -3.7 / 5.0 / 3.7 |
| Deurenberg (the 1.294 form printed in [8]) | -2.3 / 7.5 / 5.6 | -1.9 / 6.2 / 4.6 |
| Kagawa | +1.9 / 7.3 / 5.4 | +2.3 / 5.0 / 3.7 |

These are in-population (RFM was fitted on the same survey); independent data are worse: CUN-BAE SEE 4.66 in Spain [6];
Navy 3.7-4.8 in fit Marines [11]; RFM in 61 young Mexican adults R2 .84 vs DXA but intercepts of -10 to -14 %BF against
ADP/BIA/4C because DXA read far higher in that sample [9].

**Frame-of-reference problem (important).** DXA %fat in NHANES (Hologic) reads higher than the densitometry/4C-based
equations in young adults. Evaluating CUN-BAE at NHANES median BMI reproduces Kelly medians only from about age 40-45:
under-prediction of DXA median %fat is 2.8 (M) / 3.8 (W) points at age 20 and 1.5 / 2.2 at 30 (`PROPOSED FIT`, own
calculation from Kelly LMS medians [29] and CUN-BAE [6]). The engine therefore adds an age-dependent
**DXA-frame offset** to CUN-BAE:

| age | 20 | 30 | 40 | 50 | 60+ |
|---|---|---|---|---|---|
| offset M (% points) | +2.8 | +1.5 | +0.3 | 0 | 0 |
| offset F | +3.8 | +2.2 | +1.2 | +0.7 | +0.4 |

(linear interpolation, clamp outside 20-60). Known-method disagreements of +-3 %BF remain (DXA reads lower than 4C in
lean men and higher in obese women, per [8]); the UI should say "DXA-equivalent".

**Biases by population (use as priors, each an additive %BF offset on the population estimator):**

| Group | Evidence | Rule |
|---|---|---|
| Muscular / athletic | BMI >= 25 flags overfat wrongly: optimal BMI cut for 20 %BF is 27.9 (male athletes), 34.1 (linemen) vs 26.5 (male non-athletes); female 27.7 vs 24.0 [16]. BMI>=30 has sensitivity 36 % (M) / 49 % (W) for BF-defined obesity in the general population [15]. Male bodybuilders: FFMI 25.1+-1.8 [36]. | subtract `100*dFFMI_train*h^2/W` (M3); inflate sigma x1.4 |
| Lean end (BF < 15 M, < 24 F predicted) | all regression estimators compress towards the mean: CUN-BAE over-estimates lean [7]; Navy over-estimates lean [11]; RFM assigns 24-26 %BF to a lean woman with WHtR 0.40 (own calc, T2) | inflate sigma x1.3; visual/known BF gets more weight automatically |
| East/South-East Asian | same BMI -> 3-5 %BF higher; same BF% -> BMI 3-4 lower [3]; Caucasian equation under-predicts Chinese/Malay/Indian by 2.7-5.6 %BF [4]; BMI lower for same BF%: Chinese -1.9, Thai -2.9, Indonesian -3.2 vs Caucasian [2] | offset +3.5 (East Asian), +4.0 (SE Asian), +5.0 (South Asian) |
| Black adults | Direction depends on method: DXA in NHANES 2005-06: CUN-BAE over-estimates by +2.0 (W: 1.6 vs -0.4; M: 2.0 vs -0.24) [8]; 4C/D2O meta-analysis: Black Americans have 1.3 BMI units lower BMI at same BF% [2] (opposite sign) | DXA frame: -2.0; **flag as low-confidence** (sigma x1.2) |
| Mexican-American | CUN-BAE bias -0.4 (W) / -0.9 (M) vs white -0.4 / -0.24 [8] | +0.7 (M), 0 (W); ignore for simplicity |
| Obese (BF > ~40 %) | CUN-BAE under-estimates the highest BF decile by 5.8 [7]; Deurenberg-1991 slightly over-estimates in obese [1]; RFM misclassifies obesity less than BMI (total misclassification 12.7 vs 56.5 % in women, 9.4 vs 13.0 % in men) [8] | none; sigma x1.2 above E1 = 40 (PROPOSED) |
| Older adults | RFM ability declines with age [8]; Navy/BIA behave similarly in >30 y Marines [11] | none; sigma unchanged |

**Which combination is best from {sex, age, height, weight, waist}?** Evidence-weighted: RFM (needs waist) has the smallest
NHANES error (SD~3.1-3.6) but degrades in athletes, the lean and older adults; CUN-BAE (BMI+age+sex) is the best
weight-only estimator (SD~4.2-4.7) and is unbiased vs DXA when the DXA-frame offset above is applied. Averaging
the two with residual correlation rho = 0.6 (sigma 4.7 and 4.0) gives SD~3.8 for typical adults. Skinfold (2.5-2.8; equations derived in adults 18-61 y (M) / 18-55 y (F), population-specific, `UNVERIFIED` outside that range) and Navy (3.7-4.8)
need extra measurements. **Grade: A** for population-level accuracy of equations (large DXA/ADP cohorts, several
independent validations); **B** for individual-level use (SD 4-5 %BF; heavy tails in athletes/lean/ethnic groups).
**Time dynamics:** none (static estimate at t = 0). **Moderators:** sex, age, ethnicity, muscularity, leanness (bias table above).

### M2. Visual body-fat and muscularity self-rating: what is known, and the 2-axis anchors

**Mechanism.** People match a picture to themselves. Precision (repeatability) is fair, accuracy is limited by (i)
one-dimensional stimuli that fix muscularity, (ii) contraction/regression bias (low BMI over-estimated, high BMI
under-estimated), (iii) serial-dependence/adaptation, (iv) body-image distortion.

Evidence (all cited in section 11):
* Stunkard figure-rating scale: silhouette number correlates with measured BMI r = 0.76 (men) / 0.80 (women), R2 .55 / .64
  (SOS reference cohort, n = 1128, BMI 17.6-45.4) [19]; norms for 16,728 women / 11,366 men [20]. Against DXA %BF the
  Kakeshita scale (15 silhouettes, Brazil, n = 514) explains <5 % (women) and ~22 % (men) of the variability in
  perceived-minus-real BMI; 58.6 % / 74.3 % of men and 82.6 % / 86.8 % of women over-estimated their size / were dissatisfied because of excess weight, and
  32.6 % (W) / 30.8 % (M) of those dissatisfied had no excess adiposity [21].
* Muscularity confound: whole-body MRI shows skeletal muscle exceeds adipose tissue at every BMI in men and below BMI ~26 (White) / ~28 (Black) in women [17]; men with the same BMI but different composition differ by 5-7 BMI units in self-estimates;
  stimulus muscle mass/tone alone shifts estimates by up to 2.5 BMI units; contraction bias present (lower BMI over-estimate,
  higher under-estimate) [22].
* Somatomorphic matrix (independent fat x muscle axes): test-retest r = .64 (current fat) and .78 (current muscularity) [26];
  perceived vs measured composition showed wide variability and was judged incomparable to measured values, with further development recommended before multi-ethnic use [26]; the matrix
  has less leg-size variance than upper-body variance [26].
* Calibrated 2-axis avatars: Maalin 2021 built CG bodies from 397 3dMD scans (176 M, 221 F) + Tanita BIA fat mass and
  skeletal muscle mass; PCA of 79,995-dimensional torso/limb shapes with linear regressions on (FM, SMM); leave-one-out
  torso error 1.71 cm (M) / 1.59 cm (F) vs 1.83 / 1.71 cm for a BMI-only model (d = .44 / .35) [24]; Groves 2023: 258 men
  chose current/ideal bodies from an independent fat x muscle matrix (a retest subset checked stability), ideal body anchored on the perceived
  current body [23]. Bodyline judgements: SD <6 % of scale; biased towards the previously seen body [25]. A scoping review
  found 177 studies and 80 subjective female fat-distribution tools; validation of regional-fat tools is sparse [28].
* Ceiling for shape -> composition: even full 3D surface scans predict DXA fat mass only to RMSE 2.4 kg (R2 .95), FFM 2.2 kg,
  VAT R2 .75 [27]. So a human matching one avatar to their body cannot beat ~3 %BF; realistic **sigma_vis = 5.5 %BF**.
* No peer-reviewed validation of popular "body-fat % photo charts" was located, and no peer-reviewed source for the "Body Volume Index" 3D-scan index turned up in the
  literature databases searched (both searched, none found) -> visual descriptors below are expert convention, grade D.

**Grade: C** (several human studies, consistent on limited accuracy and biases; no validated %BF mapping for avatars).
**Time dynamics:** judgements drift with recent exposure (serial dependence [25]); a re-rating after a simulated change is a new noisy observation, not a change measurement. **Moderators:** sex (male stimuli need muscle variance), BMI (contraction bias), body concerns (ideal body anchored on perceived current body [23]).

**Design decision.** The two sliders are stored as coordinates in the (FMI, FFMI) plane, labelled with BF% anchors, so the
avatar shape model (M10) and the estimator share one parameterisation.

**T2. Adiposity anchors** (`FAT_ANCH`, 8 stops equally spaced on slider 0..1, piecewise-linear):

| stop | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| men BF% | 6 | 10 | 15 | 20 | 25 | 30 | 35 | 42 |
| women BF% | 14 | 18 | 22 | 27 | 32 | 38 | 45 | 52 |
| typical look, men (D, convention) | contest-lean: striations, vascularity legs/abdomen | abs sharp, vascular arms/shoulders | abs outlined, waist taper obvious | no ab lines, soft waist | rounded abdomen, no taper | belly protrudes, fold when seated | large belly, chest/face fullness | overhanging abdomen |
| typical look, women | contest-lean: visible abs, glute striations | athletic: abs visible, leg separation | flat stomach, outline when tensed | smooth, soft waist | pear curve clear, belly soft | belly roll, arm fullness | large hips/belly, fold | very large |

Population context for each stop (NHANES DXA, White, age 30; percentile of %fat from Kelly LMS [29], own calc):
men 20 % = P16, 25 % = P46, 30 % = P74, 35 % = P91, 42 % = P99; women 27 % = P8, 32 % = P24, 38 % = P55, 45 % = P86,
52 % = P98; men <15 % and women <22 % are below P2 (clinically "lean" ranges are rare in the US frame).
Anchor table with **typical FFMI at that fatness** (FFMI expected from the FM-FFM relation, slopes .40 (M) / .21 (W)
kg/m2 per FMI unit derived from r(FM,SM) = .45 / .38 [24] and Kelly SDs; `PROPOSED FIT`), and an "athletic" column
(+1.5 SD of the residual, SD_res = 2.2 M / 2.0 F); reference heights M 1.77 m, F 1.63 m; waist from the M8 waist model:

| BF% | FMI | FFMI typ | BMI typ | wt kg | WC cm | WHtR | RFM(WC) | CUN-BAE(BMI) | FFMI ath | BMI ath | WC ath |
|---|---|---|---|---|---|---|---|---|---|---|---|
| M 6 | 1.1 | 17.3 | 18.4 | 58 | 69 | .39 | 12.4 | 12.3 | 20.7 | 22.0 | 72 |
| M 10 | 2.0 | 17.7 | 19.6 | 62 | 73 | .41 | 15.4 | 14.5 | 21.1 | 23.5 | 77 |
| M 15 | 3.2 | 18.2 | 21.4 | 67 | 79 | .44 | 18.9 | 17.6 | 21.7 | 25.6 | 83 |
| M 20 | 4.7 | 18.8 | 23.5 | 73 | 85 | .48 | 22.3 | 21.1 | 22.4 | 28.0 | 91 |
| M 25 | 6.5 | 19.5 | 26.0 | 81 | 92 | .52 | 25.5 | 25.1 | 23.3 | 31.1 | 98 |
| M 30 | 8.7 | 20.4 | 29.1 | 91 | 100 | .57 | 28.6 | 29.8 | 24.4 | 34.8 | 108 |
| M 35 | 11.6 | 21.5 | 33.1 | 104 | 110 | .62 | 31.7 | 35.2 | 25.7 | 39.6 | 118 |
| M 42 | 17.2 | 23.8 | 41.0 | 128 | 126 | .71 | 35.9 | 43.9 | 28.4 | 49.0 | 136 |
| F 14 | 2.4 | 14.6 | 16.9 | 45 | 62 | .38 | 23.6 | 22.5 | 17.7 | 20.5 | 66 |
| F 18 | 3.2 | 14.7 | 18.0 | 48 | 66 | .40 | 26.4 | 24.5 | 17.9 | 21.8 | 70 |
| F 22 | 4.2 | 15.0 | 19.2 | 51 | 69 | .43 | 29.0 | 26.7 | 18.1 | 23.3 | 74 |
| F 27 | 5.6 | 15.3 | 20.9 | 56 | 74 | .46 | 32.2 | 29.7 | 18.5 | 25.3 | 80 |
| F 32 | 7.3 | 15.6 | 23.0 | 61 | 80 | .49 | 35.3 | 33.2 | 18.9 | 27.9 | 86 |
| F 38 | 9.9 | 16.1 | 26.0 | 69 | 88 | .54 | 38.9 | 37.9 | 19.6 | 31.6 | 95 |
| F 45 | 13.9 | 17.0 | 30.9 | 82 | 99 | .61 | 43.0 | 44.5 | 20.6 | 37.5 | 107 |
| F 52 | 19.7 | 18.2 | 37.9 | 101 | 113 | .69 | 47.1 | 51.9 | 22.1 | 46.0 | 123 |

**Reading of the table (important for validation):** for people with population-typical FFMI at that fatness, RFM and
CUN-BAE over-estimate BF% by about 3-6 points in men below 15 %BF and by 5-10 points in women below 25 %BF (compare the
RFM / CUN-BAE columns with the BF label). For athletic FFMI the BMI-based error is much larger: CUN-BAE evaluated at the
"BMI ath" values gives 18.7/21.1/24.5/28.2/32.5 for men labelled 6/10/15/20/25 %BF and 29.1/31.3 for women labelled
14/18 %BF (over-estimates of 7.5-15 points; own calculation). Therefore lean or muscular users' sliders/known-BF must
dominate; the fusion does this through the sigma inflation and the training-offset in M3.

**T3. Muscularity anchors** (`FFMI_ANCH`, 8 stops, FFMI = DXA lean incl. BMC / h2; NHANES percentiles are for White adults
aged 30 [29]; own calc):

| stop | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| men FFMI | 16.5 (P8) | 18.0 (P25) | 19.5 (P48) | 21.0 (P70) | 22.5 (P84) | 24.0 (P92) | 25.0 (P95; Kouri natural limit) | 27.0 (P98) |
| women FFMI | 13.5 (P8) | 14.5 (P22) | 16.0 (P49) | 17.3 (P70) | 18.5 (P83) | 19.5 (P90) | 20.5 (P94) | 22.0 (P97) |
| meaning | slight | below average | average untrained | athletic | muscular | very muscular | bodybuilder-class | enhanced range |

Sources for the top stops: natural-athlete limit 25.0 and Mr America 25.4 [35]; competitive bodybuilders 4C FFMI 25.1+-1.8 (M),
18.3+-1.4 (F) [36]; active/competing women 18.4 (DXA lean + bone / h2, from Hulmi Table 3: 47.6 + 2.56 kg at 1.653 m) [37].
The NHANES FFMI distribution includes heavy people whose FFM rises with FM, so "P95" at FFMI 25 is not a lean-athlete
statement; lean athletes at FFMI 25 are far rarer (Kouri: the limit for non-users was 25.0 in 74 athletes) [35].

**Coupling with weight.** The fat and muscle slider positions imply a weight `W_vis = h2*(FMI_vis + FFMI_vis)`. Show
`W - W_vis` in the UI. The estimator (M3) treats mismatch statistically instead of forcing agreement.

### M3. Fusion: `estimateBF` (constrained generalised least squares)

**Mechanism.** BF% is the single latent variable (weight fixes `FM + FFM`). Each input yields an unbiased-ish observation
`y_k = BF + e_k` with sigma_k; combine with correlated errors.

**Observations**

| k | Observation | sigma (%BF) | Notes |
|---|---|---|---|
| eq | `E1 = CUN-BAE(sexF, age, BMI) + offsetDXA(age,sex) + offsetEth - dF` | 4.7 (x1.4 if athlete flag; x1.3 if E1 < 15 (M) / 24 (F)) | SEE 4.66 [6]; NHANES IQR-SD 4.2-4.4 [8] |
| rfm | `E2 = RFM - 0.5*dF` (only if waist) | 4.0 (same inflations) | NHANES IQR-SD 3.1-3.6 [8], inflated for external populations |
| navy (optional) | US-Navy formula from M1 if neck (and hip for women) is supplied | 4.5 (x inflations) | not implemented in the prototype behind the golden tests; if added use rho(navy, rfm) = .5, rho(navy, eq) = .3 (`PROPOSED`) |
| fat | `slider_to(FAT_ANCH, s_f)` | 5.5 | M2 |
| mus | `100*(1 - slider_to(FFMI_ANCH, s_m)*h^2/W)` | `100*1.6*h^2/W` (about 6-7 %BF) | slider->FFMI sigma 1.6 kg/m2 (about 0.65 SD of FFMI, i.e. r ~ .75 with truth; PROPOSED) |
| known | user BF% | 2.5 DXA, 3.5 BIA (Marines BIA-DXA SD 3.1-3.5 [11]), 4.0 skinfold/Navy | overrides |

Athlete flag = `rtYears_eff >= 2` or muscle slider FFMI >= 21.6 (M) / 17.8 (F) (about P75-P80).
`dF = 100*dFFMI_train*h^2/W`, `dFFMI_train = dmax*(1 - exp(-T_eff/3))`, `dmax = 3.6 (M), 2.5 (F)` kg/m2,
`T_eff = years * {casual 0.4, regular 1.0, serious 1.5}` (`PROPOSED FIT`: data points: first-year novice FFM gain about 3 kg
= +1.0 FFMI; Kouri limit 25 and bodybuilders 25.1 imply +5.4 at the extreme [35,36]; college male athletes' overfat BMI cut +1.4
vs non-athletes [16]).

**Error covariance** (`Sigma_ij = rho_ij*sigma_i*sigma_j`): rho(eq,rfm) = .6; rho(fat,mus) = .3; rho(anthropometric, visual) = .2;
known: 0.

**Posterior:** `BF_hat = (1' S^-1 y)/(1' S^-1 1)`, `sd = (1' S^-1 1)^-0.5`, then clamp BF to [3, 60] (M), [8, 60] (F);
`FM = W*BF/100`. If `knownBF` is supplied, keep it in the vector (sigma above) - do not overwrite.

Worked (golden) results of this exact algorithm, section 7. Behaviour: typical adult with visual + waist: sd 3.3-3.8;
BMI-only: sd 4.7; muscular lean man with training history + waist: sd 4.3 and BF 11.5 (assumed true value 10-12); same man with
no training info and no waist: BF 15.4 (sd 4.2) - i.e. the algorithm asks for training history and waist because these are
the two inputs that repair the muscular/lean failure mode of population equations.

**Evidence grade: C.** Components are A/B individually; the combination weights, visual sigma, training offsets and correlations
are `PROPOSED` and must be revisited with real user-vs-DXA data when available. **Time dynamics:** none (t = 0). **Moderators:** athlete flag, lean flag, ethnicity, training years, which optional inputs exist.

**Weight/height reporting error.** Self-reported height is over-reported and weight under-reported on average, with large
individual SD, BMI distribution narrower than measured [59]. Use `sigma_W = 2 kg`, `sigma_h = 1.5 cm` (`PROPOSED`); the
fusion above treats W as exact; for sensitivity, add `100*sigma_W/W` in quadrature to the muscle-slider term.

### M4. Reference distributions (NHANES DXA, MRI) - percentiles, indices, ranges

**Mechanism/data.** Kelly, Wilson & Heymsfield (2009) fitted LMS curves to the NCHS whole-body DXA dataset (NHANES 1999-2004;
15 US counties; lean mass **includes** BMC) for Non-Hispanic White, Black and Mexican-American adults [29]. Supplementary
Tables S1-S8 (PLoS ONE 4:e7038, `journal.pone.0007038.s021-.s028`) hold (median M, sigma, skewness L) per age. Reading of
sigma: it is the SD in the variable's own units, so `S = sigma/M`. **Validated:** with `x(z) = M*(1 + L*S*z)^(1/L)` the White
male median %fat at 25 y (24.6 %) lies at P25.0 at age 45 and P9.9 at age 69, exactly the authors' text ("only 25 % of 45-year-old
... falls to less than 10 % by 69") [29]. Percentile of an observed value: `z = ((x/M)^L - 1)/(L*S)`, `P = Phi(z)`.

`(M / sigma / L)` for **White** adults (ages between tabulated values: linear interpolation of M, sigma, L; clamp 20-85):

| age | %fat M | %fat F | FMI M | FMI F | FFMI M (lean+BMC) | FFMI F |
|---|---|---|---|---|---|---|
| 20 | 23.4/6.68/.221 | 35.1/7.22/.361 | 5.95/2.59/-.144 | 8.48/3.80/-.310 | 18.98/2.50/-1.115 | 15.60/2.01/-1.404 |
| 30 | 25.7/6.25/.428 | 37.0/7.21/.785 | 6.78/2.77/-.084 | 9.35/3.98/-.188 | 19.60/2.54/-.929 | 16.03/2.18/-1.352 |
| 40 | 27.5/5.68/.631 | 38.9/6.96/1.207 | 7.57/2.89/-.024 | 10.27/4.13/-.064 | 20.04/2.56/-.740 | 16.30/2.32/-1.299 |
| 50 | 29.0/5.30/.831 | 40.8/6.46/1.626 | 8.21/2.91/.037 | 11.20/4.25/.059 | 20.15/2.53/-.546 | 16.35/2.36/-1.244 |
| 60 | 30.5/5.19/1.028 | 42.5/5.86/2.041 | 8.71/2.86/.097 | 12.03/4.28/.183 | 19.91/2.44/-.348 | 16.21/2.30/-1.188 |
| 70 | 31.4/5.11/1.223 | 43.0/5.37/2.453 | 8.82/2.66/.157 | 12.02/3.99/.308 | 19.36/2.26/-.148 | 15.92/2.16/-1.132 |
| 80 | 31.6/4.88/1.418 | 42.5/5.14/2.866 | 8.46/2.32/.217 | 11.27/3.47/.433 | 18.58/2.03/.053 | 15.53/1.98/-1.076 |

| age | ALMI M | ALMI F | trunk:limb fat ratio M | ratio F | BMC g M | BMC g F |
|---|---|---|---|---|---|---|
| 20 | 8.87/1.34/-.708 | 6.81/1.04/-.818 | .926/.156/.057 | .745/.192/.183 | 2705/431/-.284 | 2124/286/.138 |
| 30 | 9.02/1.31/-.524 | 6.90/1.11/-.817 | 1.063/.203/.185 | .841/.220/.183 | 2755/427/-.132 | 2177/294/.204 |
| 40 | 9.12/1.29/-.341 | 6.95/1.17/-.816 | 1.183/.241/.312 | .897/.235/.183 | 2768/411/.021 | 2198/306/.271 |
| 50 | 9.05/1.25/-.157 | 6.90/1.18/-.813 | 1.281/.261/.439 | .947/.245/.183 | 2739/402/.174 | 2150/309/.342 |
| 60 | 8.81/1.18/.027 | 6.76/1.14/-.810 | 1.351/.267/.565 | .998/.255/.183 | 2673/411/.327 | 2034/314/.417 |
| 70 | 8.44/1.09/.210 | 6.57/1.06/-.808 | 1.361/.267/.692 | 1.011/.256/.183 | 2583/415/.479 | 1879/316/.495 |
| 80 | 7.97/0.97/.394 | 6.33/0.96/-.808 | 1.306/.257/.819 | .976/.247/.183 | 2459/412/.632 | 1703/306/.574 |

Percentile cheat-sheet computed from the tables (White, DXA frame; P5 / P25 / P50 / P75 / P95):

| | age | %fat | FMI | FFMI |
|---|---|---|---|---|
| Men | 20 | 14.3/19.2/23.4/28.3/36.6 | 3.0/4.5/6.0/8.0/12.7 | 15.6/17.4/19.0/20.8/24.3 |
| Men | 30 | 16.6/21.7/25.7/30.1/37.2 | 3.5/5.2/6.8/9.0/13.5 | 16.1/18.0/19.6/21.5/24.9 |
| Men | 50 | 20.5/25.5/29.0/32.6/37.9 | 4.6/6.5/8.2/10.4/14.6 | 16.6/18.5/20.1/22.0/25.1 |
| Men | 70 | 22.7/27.9/31.4/34.8/39.6 | 5.3/7.2/8.8/10.8/14.2 | 16.0/17.9/19.4/21.0/23.5 |
| Women | 20 | 24.5/30.4/35.1/40.2/48.3 | 4.4/6.4/8.5/11.6/19.6 | 13.0/14.4/15.6/17.1/20.1 |
| Women | 30 | 25.6/32.2/37.0/41.9/49.2 | 4.8/7.1/9.3/12.6/19.8 | 13.2/14.7/16.0/17.7/20.9 |
| Women | 50 | 29.1/36.3/40.8/45.0/50.7 | 5.9/8.7/11.2/14.4/20.7 | 13.3/14.9/16.4/18.1/21.7 |
| Women | 70 | 32.3/39.1/43.0/46.4/50.8 | 6.6/9.5/12.0/14.9/19.9 | 13.0/14.6/15.9/17.5/20.6 |

Ethnic medians at age 30 (White / Black / Mexican-American): %fat M 25.7/23.1/27.2, F 37.0/39.2/40.0; FMI M 6.78/6.17/7.45,
F 9.35/11.59/11.07; FFMI M 19.6/20.3/19.8, F 16.0/17.9/16.6; trunk:limb M 1.06/0.90/1.19, F 0.84/0.82/0.98; BMC M 2755/3005/2474 g,
F 2177/2390/2065 g (Kelly S1-S8; full ethnic LMS in the supplement) [29].

**FMI classification** (prevalence-matched to WHO BMI cut-offs at age 25; ethnic thresholds similar) [29]:

| | severe deficit | moderate | mild | normal | excess | obese I | obese II | obese III |
|---|---|---|---|---|---|---|---|---|
| men FMI | <2 | 2-<2.3 | 2.3-<3 | 3-6 | >6-9 | >9-12 | >12-15 | >15 |
| women FMI | <3.5 | 3.5-<4 | 4-<5 | 5-9 | >9-13 | >13-17 | >17-21 | >21 |

Other distribution data used: Swiss BIA (n = 5,635 Caucasians 24-98 y; leaner than NHANES): median FFMI 18.9 (M) / 15.4 (F)
in 18-34 y, FMI 4.0 / 5.5; FMI rises 55 % (M) / 62 % (F) from young to elderly vs BMI +9 / +19 % [30]. MRI skeletal muscle
(n = 468, 18-88 y): 33.0 kg M vs 21.0 kg F; 38.4 % vs 30.6 % of body mass; relative SM declines from the 3rd decade, absolute
from the end of the 5th, mostly lower body [31]. NHANES 2015-18 anthropometry (secular trend): mean waist M 102.9 / F 98.4 cm; BMI
M 29.4 / F 29.8; MUAC M 34.7 / F 32.3 cm [41]. The DXA reference (1999-2004) is therefore about 1.5-2 BMI units leaner than the current
population (M 20-29: median BMI 26.5 in 2015-18 vs 24.9 implied by Kelly medians); percentiles are "vs 2000s adults".

**Ranges** (all in DXA frame unless noted):

| Range | Men | Women | Basis |
|---|---|---|---|
| Essential fat (textbook convention) | 2-5 % | 10-13 % | `UNVERIFIED` (ACSM/McArdle convention; not re-checked) |
| Health-based "healthy" (BMI 18.5-25 mapped through Gallagher eq. [8]) | age 20: 7.0-18.3; 40: 9.5-20.9; 60: 12.1-23.5 | age 20: 20.2-32.2; 40: 21.8-33.7; 60: 23.4-35.3 | own calculation from the equation as printed in [8]; original table in [5] not accessible |
| Kelly FMI "normal" (young-adult prevalence match) | FMI 3-6 (about 14-24 %BF at FFMI 19) | FMI 5-9 (about 24-36 %BF at FFMI 16) | [29] |
| Natural male bodybuilder, contest | 4.5 % (case study 14.8 -> 4.5 -> 14.6 %) | - | [38] |
| Female fitness competitors, DXA | - | 22.7 -> 12.6 % (FM 14.6 -> 7.1 kg; 6/27 <10 %); post-recovery 15-20 % common | [37] |
| Bodybuilders, 4C | 11.8 +- 4.4 % (n=17), FFMI 25.1 +- 1.8 | 19.7 +- 4.9 % (n=10), FFMI 18.3 +- 1.4 | [36] |
| Minimum for health | no accepted optimum for athletes (IOC review) | 12-14 % suggested as a practical floor (cited in [37]) | [40] |

**Grade: A** for the NHANES-based distributions (n > 12,000, LMS-fitted, internally validated above); **B** for ethnic-neutral use; **C** for
extrapolating 1999-2004 percentiles to 2026. **Time dynamics:** cross-sectional age curves, used only for initial expectations; secular drift ~ +1.5-2 BMI units since 2000. **Moderators:** sex, age, ethnicity.

### M5. Lean-compartment partition and other initial state variables

**Mechanism.** FFM = skeletal muscle + bone mineral + organs/other + water in these. Between-person variation in FFM at a
given height is mostly muscle; organ mass is nearly constant; adiposity raises FFM modestly.

Equations:

* **Skeletal muscle.** `SM = FFM - Rn*h^2 - 0.1*(FFM - FFMI0*h^2)`, `Rn` = 9.4 (M) / 8.4 (F) kg/m2, `FFMI0` = 19.6 / 16.0
  (`PROPOSED FIT`: at the age-30 median, SMI0 = 1.19*ALMI - 1.65/h^2 = 10.2 (M, h 1.77) and 7.6 (F, h 1.63) from Kelly ALMI medians
  [29] and the Kim equation [32]; 0.1 = 90 % of FFM excess above the median is muscle). Alternative route: `SM = 1.19*ALM - 1.65`
  (R2 .96, SEE 1.63 kg vs whole-body MRI; adults at Tanner 5, n=321) [32], `ALM = ALMI*h^2`, ALMI/FFMI = .46 (M) / .43 (F) at 30 y, .44 / .42 at 60 y.
  Checks: median man (1.77 m): ALM 28.3, SM 32.0 kg = 52 % of FFM, 39 % of body mass; median woman (1.63 m): ALM 18.3, SM 20.1 kg
  = 47 % of FFM, 31 % of body mass vs MRI 38.4 / 30.6 % [31].
  Anthropometric alternative if circumferences+skinfolds are ever collected: Lee 2000 `SM = Ht_m*(0.00744*CAG^2 + 0.00088*CTG^2 + 0.00441*CCG^2) + 2.4*sexM - 0.048*age + race + 7.8`
  (race: Asian -2.0, African American +1.1; R2 .91, SEE 2.2 kg; CAG/CTG/CCG = skinfold-corrected arm/thigh/calf girths, cm) [33];
  mid-arm: `AMA = (MAC - pi*TSF)^2/(4*pi) - 10 (M) or - 6.5 (F)` and `SM(kg) = height_cm*(0.0264 + 0.0029*AMA)` [34] (typed as printed).
* **Regional muscle shares** (arms/legs/trunk): M .115/.56/.325, F .105/.58/.315 (`UNVERIFIED`, from typical DXA/MRI proportions; only the
  arm value is constrained by the MUAC calibration in M8). Regional muscularity sliders multiply the share by `1 + 0.2*s_reg` and renormalise.
* **Bone mineral.** `BMC = f_bmc*FFM`, `f_bmc = 0.045*(1 - 0.001*max(0, age-40))` (M), `0.051*(1 - 0.0025*max(0, age-45))` (F)
  (own calc from Kelly medians: 2755 g / 61.4 kg = 4.5 %, 2177 g / 42.6 kg = 5.1 % at 30 y; BMC falls 2198 -> 1703 g in women 40 -> 80 y) [29];
  women's BMC/FFM is higher than men's in fit adults [11]. Frame factor `z_frame` (default 0) scales `BMC` by `1 + z_frame*0.15 (M) / 0.13 (F)` (Kelly SD/median);
  skeletal widths scale by `1 + 0.03*z_frame` (`PROPOSED`). Traditional frame-size charts (elbow breadth vs height) were not validated here; keep `z_frame = 0` unless a measured breadth is available.
* **Height normalisation.** Weight, FM, FFM and BMC scale to height with age-adjusted powers of about 2 (1.85-2.48 across sex-race groups, "frequently round to 2") [18];
  use `h^2`. For muscularity comparison across heights use Kouri's `FFMI_norm = FFMI + 6.3*(1.80 - h)` [35] (the paper's constant is **6.3**, not 6.1).
* **Water.** `TBW = 0.73*FFM` (FFM hydration "remarkably stable at approximately 0.73" [56]); cross-check with Watson: M `2.447 - 0.09516*age + 0.1074*ht_cm + 0.3362*W`,
  F `-2.097 + 0.1069*ht_cm + 0.2466*W` (secondary sources; one prints 0.09156, likely a typo) [56]; individual TBW error 3.3-5.0 L (RMSE, n=1,695) [56].
  `ECW = 0.38*TBW` (BIA medians 0.373 / 0.378 / 0.390 in men aged 20-39 / 40-64 / >=65 and 0.384 / 0.385 / 0.394 in women; isotope-dilution values are higher, `UNVERIFIED`) [56].
* **Glycogen.** Muscle: vastus lateralis at rest in males with normal CHO availability and VO2max 53: 462 +- 132 mmol/kg dry mass; high CHO (>=6 g/kg/d for >=3 d)
  +102; low CHO/depleted -253; +67 per +10 mL/kg/min VO2max; small increases in women [55]. Conversion 462 mmol/kg DM x 0.180 g/mmol = 83 g/kg DM; with muscle dry fraction ~0.23
  (`UNVERIFIED`) = 19 g/kg wet vastus; whole-muscle discount 0.85 -> **16 g/kg SM** normal (`PROPOSED FIT`), x0.45 when habitual CHO < 0.75 g/kg/d (about 55 g/d in an 80 kg
  person), x1.22 when >= 5.5 g/kg/d. Liver 90 g (fed; `UNVERIFIED`, dossier 04 owns kinetics). Capacity ~15 g/kg body weight; about 500 g can be added before net de-novo lipogenesis
  contributes (Acheson 1988, 3 men) [55]. Median man: 32 kg x 16 + 90 = about 600 g; median woman 20 kg x 16 + 90 = about 410 g.
* **Energy.** `RMR = 370 + 21.6*FFM` kcal/d (Cunningham 1991: 65-90 % of variance; FM adds nothing in non-obese) [57]; athletes: `RMR_kJ = 95.272*FFM + 2026.161`
  (ten Haaf 2014; confirms Cunningham) [57]. `TDEE0 = PAL*RMR`, default PAL 1.5 (dossier 02 owns PAL and its equation-selection rule, e.g. Cunningham-1980 `500 + 22*FFM` for FFMI >= 20 (M) / 17 (F); Katch-McArdle = Cunningham-1991 otherwise); `intake0 = TDEE0` (weight-stable assumption; sets initial energy balance = 0).

**Time dynamics.** Static initial values; these become ODE states in other dossiers. **Moderators:** sex, age (FFMI peaks ~50 y then declines [29]),
training (SM share of FFM rises), ethnicity (Black FFMI +0.7 M / +1.9 F at 30 y [29]). **Grade: B** (SM from DXA/MRI equations, A/B; glycogen and regional shares C/D).

### M6. Fat-depot partition, android/gynoid pattern and visceral fat

**Mechanism.** Women store proportionally more fat gluteofemorally, men more centrally; central share and VAT rise with age in both sexes,
faster in men and (after ~48 y) in women, largely as an ageing effect [47]. VAT grows allometrically with total fat (exponent ~1.3) [48].

**Partition.**
```
head  = 0.045*FM                                    // UNVERIFIED share
R     = LMS_trunkLimb(sex, age, z)  ; z = 2*s_b     // Kelly Table S4 (White); s_b in [-1,1]
trunk = (FM - head) * R/(1+R) ; limbs = FM - head - trunk
arms  = limbs*armShare ; legs = limbs - arms         // armShare: M .22, F .19 (UNVERIFIED)
VAT   = trunk * vFrac ; SAT_trunk = trunk - VAT
vFrac = clamp( v0 * (FM/FMref)^0.3 * ageTerm * (R/Rref(sex,age))^0.5 , 0.04, 0.60 )
  men:   v0 = 0.24, FMref = 20.5 kg, ageTerm = exp(0.018*(age-42))
  women: v0 = 0.13, FMref = 28.0 kg, ageTerm = exp(0.010*(min(age,48)-48) + 0.030*max(0, age-48))
  Rref = LMS median (z=0) of the trunk:limb ratio at that age/sex
```
`(FM/FMref)^0.3` makes `VAT ~ FM^1.3` (Hallgreen-Hall) [48]. `R` from an unknown waist: see M8 (`trunkFromWaist`) then `z = LMS_z(R)`.

**Data points behind the VAT constants (`PROPOSED FIT`):**

| Source | Population | VAT | Model check |
|---|---|---|---|
| Shen 2004, MRI [42] | 121 M (41.9 y, BMI 26.0) / 198 F (48.1 y, BMI 27.0) | 2.7 +- 1.8 L / 1.7 +- 1.2 L (mean) -> 2.5 / 1.6 kg at 0.92 kg/L | constants fitted to means (M FM 20.5 kg, F FM 28.1 kg from CUN-BAE) |
| Scafoglieri 2022, whole-body MRI n=419 [43] | F 24.5 BMI (43 y) / M 25.1 (37 y) | median 985 g of 21.9 kg AT (4.5 %); 1679 g of 17.1 kg (9.8 %); VAT/SAT 4.8 % / 11.1 % | model 0.89 kg / 1.44 kg (-10 % / -14 %) |
| UK Biobank, MRI n=6021, age ~63 [44] | M BMI 26.8 / F 25.4 | VAT 4.62 L (IQR 3.25-6.38) / 2.33 L (1.46-3.51); abdominal SAT 5.50 / 7.50 L (VAT/ASAT .84 / .31) | model 4.1 kg = 4.5 L (M); 2.6 kg = 2.8 L (F) |
| Framingham CT slab volumes, age 52 [45] | 1,737 M / 1,611 F | VAT 2,243 +- 1,023 / 1,365 +- 832 cm3; SAT 2,640 / 3,148 cm3 | ratio M/F 1.6 (model 1.7-2.0 at equal FM) |
| Lemieux 1993 [47] | 89 M / 75 F | at equal total fat, men have more VAT, and VAT rises more steeply with FM in men | encoded by v0_M / v0_F = 1.85 |
| Kotani 1994, whole-body CT, BMI > 25 [47] | 66 M / 96 F | relative VAT up, leg fat down with age; VAT rise with age 2.6x larger in men than premenopausal women; postmenopausal women = men | age terms |
| Ambikairajah 2019, meta-analysis [47] | 201 cross-sectional studies, n ~ 1.05 M; 11 longitudinal, n = 2,472 | post- vs pre-menopause: BMI +1.14, BF% +2.88, WC +4.63 cm, hip +2.01 cm, WHR +0.04, VAT +26.9 cm2 (CI 13-41), trunk fat% +5.49, leg fat% -3.19; "predominantly age, no additional influence of menopause" | age term; women slope 0.03/y after 48 |
| Lovejoy 2008, 4-y longitudinal DXA/CT [47] | 156 initially premenopausal | only women who became postmenopausal gained VAT significantly; SAT rose in all; 24-h EE and sleeping EE fell more (-7.9 vs -5.3 %) | supports steeper VAT slope in menopause window (conflicts with the meta-analysis on attribution) |

**Belly-vs-hips slider effect at fixed fat mass** (own calculation; z = 2*s_b):

| Man 40 y, 176 cm, 86 kg, FM 22.8 kg | z -2 | -1 | 0 | +1 | +2 |
|---|---|---|---|---|---|
| trunk:limb ratio R | 0.77 | 0.96 | 1.18 | 1.44 | 1.74 |
| trunk fat, kg (share of FM) | 9.4 (41 %) | 10.7 (47 %) | 11.8 (52 %) | 12.8 (56 %) | 13.8 (61 %) |
| VAT, kg (VAT/trunk SAT) | 1.81 (.24) | 2.29 (.27) | 2.82 (.31) | 3.39 (.36) | 4.00 (.41) |
| waist / hip, cm | 91 / 106 | 94 / 105 | 96 / 104 | 99 / 102 | 101 / 101 |
| WHR | .86 | .89 | .93 | .96 | .99 |

| Woman 40 y, 164 cm, 70 kg, FM 26.1 kg | z -2 | -1 | 0 | +1 | +2 |
|---|---|---|---|---|---|
| R | 0.52 | 0.69 | 0.90 | 1.16 | 1.48 |
| trunk fat, kg (share) | 8.5 (33 %) | 10.2 (39 %) | 11.8 (45 %) | 13.4 (51 %) | 14.9 (57 %) |
| VAT, kg (VAT/trunk SAT) | 0.76 (.10) | 1.04 (.11) | 1.39 (.13) | 1.79 (.15) | 2.25 (.18) |
| waist / hip, cm | 81 / 107 | 85 / 105 | 89 / 103 | 92 / 101 | 96 / 99 |
| WHR | .75 | .81 | .86 | .91 | .96 |

Sanity: z = +-2 spans the Kelly 2.3rd-97.7th percentile of trunk:limb ratio; WHR range 0.75-0.99 (women) / 0.86-0.99 (men) is realistic
(median WHR .78 F / .87 M in MRI cohort [43]).

**Ethnic differences (brief).** At the same BMI East Asians accumulate the most VAT and the least deep subcutaneous fat; liver fat did not
differ [46]; White adults have more VAT than African-American adults at higher BMI/WC [46]; DXA trunk:limb at 30 y: Black M 0.90 / F 0.82, White 1.06 / 0.84,
Mexican-American 1.19 / 0.98 [29]. Optional multipliers on `vFrac` (`UNVERIFIED`, direction supported): East/South Asian x1.25, Black x0.85, others x1.
WC-for-VAT thresholds differ by ethnicity (Japan 85 M / 90 F cm for VAT area 100 cm2) [63].

**Published anthropometric VAT equations (cross-checks; the engine uses the partition above because it also has to run forward in time):**

| Equation | Population | Fit |
|---|---|---|
| Samouda 2013 [64], women: `VAT = 2.15*WC - 3.63*thigh_C + 1.46*age + 6.22*BMI - 92.713` | 253 adults 18-78 y, BMI 16.3-52.9, CT (Marseille) | R2 .836; validation R2 .76; unit = CT VAT area (cm2; `UNVERIFIED` from abstract context) |
| Samouda 2013 [64], men: `VAT = 6*WC - 4.41*thigh_C + 1.19*age - 213.65` | same | R2 .803; validation .70; "proximal thigh circumference" subtracts the subcutaneous/gluteofemoral component |
| So 2017 [64], Japanese men with WC > 85 cm: MRI VAT volume (cm3) `= 47.03*age + 117.79*BMI + 74.18*WC - 8792.7` | 200 derivation + 60 validation, 30-59 y | validation r = .74 |
| Song 2022 [64]: DXA-VAT mass from age, sex, BMI, TG, HDL, steatosis grade | 515 adults | R2 .70-.74, validation r .87 |

Worked check of Samouda: man, WC 96, thigh 58, age 40 -> VAT area 154 cm2; woman, WC 86, thigh 57, age 40, BMI 26 -> 105 cm2 (plausible L4-L5 VAT areas). A future
UI could ask for thigh circumference to use these as a fourth estimator of VAT. They are population-specific; adopt none as primary.

**Grade: C** (cross-sectional imaging cohorts; v0/age slopes fitted to a handful of means; menopause attribution contested).

### M7. Regional fat loss and gain: "first on, last off" and spot reduction

**Mechanism.** Depots differ in adrenergic lipolytic sensitivity, blood flow and adipocyte dynamics: abdominal adipocytes have ~2x beta-adrenoceptor
density and 4-5x greater noradrenaline-induced lipolysis than gluteal adipocytes; gluteal cells carry an antilipolytic alpha-2 receptor sensitivity ~40x higher than
abdominal cells in women [53]. Lower-body fat expands by adipocyte hyperplasia during overfeeding (upper-body/abdominal by hypertrophy: r = .74 between adipocyte
size and relative upper-body gain) [52]; adult adipocyte number is set in childhood/adolescence and does not fall after marked weight loss, ~10 %/y of cells turn over [52].
Consequences: (i) VAT and trunk lose proportionally more than limbs in energy deficit, with the effect attenuated at larger losses; (ii) fat gain is relatively
lower-body-weighted; (iii) net regional change is a modest tilt on top of proportional change, not "all from one place".

**Equation (allocation, integrate per simulated day with the current depot values):**
```
for each day with total fat change dFM (kg):
  K = dFM<0 ? K_LOSS : K_GAIN
  w_i = F_i * K_i ;   dF_i = dFM * w_i / sum_j(w_j) ;   F_i = max(F_i + dF_i, 0)     // i in {head, arms, legs, SAT_trunk, VAT}
  K_LOSS = { head 1.00, arms 0.84, legs 0.84, sat 1.10, vat 1.30 }
  K_GAIN = { head 1.00, arms 1.00, legs 1.15, sat 0.95, vat 1.30 }   // sat = trunk subcutaneous
  optional local-training bias: w_i *= (1 + lambda*trainedShare_i), lambda default 0, max 0.10
```
**Fit status:** `K_LOSS` (`PROPOSED FIT`): VAT 1.3 = Hallgreen-Hall allometry `dVAT/VAT = k*dFM/FM`, k = 1.3 +- 0.1, R2 .73, 37 studies / 1,407 men and women / all
methods incl. bariatric surgery, sex-independent [48]; trunk-vs-limb relative susceptibility ~1.3 from CALERIE-2 (below); limb exponent 0.84 solved so that
`sum(F_i*K_i) = FM` at the reference partition. `K_GAIN` fitted to Tchoukalova 2010 (upper-body +1.9 kg vs lower-body +1.6 kg, 28 young lean adults, 8 wk overfeeding,
upper share 54 %) [52]; VAT 1.3 for gain is `UNVERIFIED` (assumed symmetric).

**Evidence table (regional change):**

| Study | Design | Result | Model check |
|---|---|---|---|
| CALERIE-2, Das 2017 [49] | 218 non-obese adults (BMI 21.9-28), 25 % CR (achieved 11.9 %) for 2 y; DXA | weight -7.6 kg, WC -6.2 cm, FM -5.4 kg, FFM -2.0 kg; trunk fat -3.24 (M) / -2.81 (W) kg; appendicular fat -2.4 / -2.5 kg; FFM 34 % (M) vs 23 % (W) of weight lost; men lost more trunk fat (p = .03) | trunk share of (trunk+limb) loss: data 57 % M / 53 % W, model 58 % / 51 % |
| Benito 2017 [50] | 180 overweight/obese adults, 22-wk diet+exercise, DXA | trunk loses most fat, then legs, then arms (per total fat lost); men lose the highest % from the trunk; arms/legs lose most in obese; BMI x region and sex x region interactions | qualitative |
| Ross 1996 [51] | 33 obese men, ~10 % weight loss, whole-body MRI | VAT -35 %, SAT -25 % (VAT > SAT in all groups); abdominal SAT -27 % vs gluteal-femoral -20 % with exercise | model (FM 33 -> 25 kg): VAT -28..-32 %, trunk SAT -24..-28 %, legs -19..-22 % |
| Chaston & Dixon 2008 [48] | 61 studies, 98 cohort points | only % weight loss predicted %dVAT/%dSAT (r = -.29): preferential VAT loss with modest loss, attenuated with more; VLCD early preferential VAT loss | encoded by allometry |
| Hall & Hallgreen 2008 [48] | model | ln(%dVAT/%dSAT) starts ~0.3 and falls ~0.01 per kg FM lost | allometry k=1.3 gives similar |
| Hulmi 2016 [37] | 27 women, 4-month contest diet (-11.9 % weight, FM -50 %), DXA | android fat -68 % (0.92 -> 0.25 kg) for total FM -50 % (allometric exponent ~1.6); lean mass unchanged | model: trunk fat -57 %, VAT -62 % (**model under-predicts extreme-leanness android loss**) |
| Tchoukalova 2010 [52] | 28 adults (15 M), 8 wk overfeeding | upper +1.9 kg, lower +1.6 kg | model: upper 60 % (M) / 53 % (F) vs 54 % observed |

**Time dynamics.** VAT depletes faster than SAT at the start of a large deficit (VLCD, first weeks) and the preference fades with cumulative loss
(-0.01 ln-units per kg FM). Regain after weight loss returns fat to the same cells (number fixed) [52]; no evidence of a separate "regain redistribution" model
was found here (open question).

**Moderators.** Sex acts through baseline shares (Kelly R) and the trunk susceptibility (men lose more trunk fat); age raises baseline R and VAT share;
BMI interacts with region (limbs lose more in obesity) [50]; menopause: attributable mainly to ageing [47].

**Spot reduction (evidence-graded).**

| Study | n / design | Finding |
|---|---|---|
| Vispute 2011 [54] | 24, 6 wk abdominal exercise, isocaloric | no effect on abdominal circumference, skinfolds, android fat |
| Ramirez-Campillo 2013 [54] | 11, 12 wk one-leg high-volume training | fat fell in arms (-10.2 %) and trunk (-6.9 %) but not in the trained leg |
| Kostek 2007 [54] | 104 (45 M), 12 wk unilateral arm resistance training, MRI + skinfolds | skinfold suggested local loss in men; MRI showed generalised loss -> no spot reduction |
| Stallknecht 2007 [54] | 10 men, one-leg knee extension | femoral SCAT blood flow (6.6 vs 3.9 ml/100 g/min at 25 % Wmax) and lipolysis (102 vs 55 nmol/100 g/min) higher next to the contracting muscle ("spot lipolysis") but not net regional loss |
| Scotto di Palumbo 2017 [54] | 16 women, 8 wk | upper-body-resistance group: upper-limb fat -12.1 % vs lower limb -4.0 %; lower-body group -2.3 % vs -11.5 % (supports local effect) |
| Paoli 2021 [54] | 14, 8 wk circuit | abdominal subcutaneous thickness fell more than RT (BIA/skinfold/ultrasound) |
| Brobakken 2023 [54] | 16 overweight men (43 y), 10 wk; abdominal exercise + running vs running only | trunk fat -1,170 g (7 %) vs no change, total fat -6 % vs -5 % (paper concludes spot reduction exists). Weaknesses: n = 16 (8/arm), DXA trunk-region noise of the order of the effect (SD ~1.1 kg), control lost more body weight, no replication |

**Assessment.** The larger and better-measured trials (MRI, n = 104; isocaloric controls) are null; small DXA/skinfold trials show 3-8 percentage-point
local tilts that are within measurement noise or unreplicated. Local blood-flow/lipolysis increase is real but fatty acids re-enter the circulation
and are oxidised or re-esterified systemically. **Rule:** default `lambda = 0`; allow up to 0.10 as an "exploratory local-training bias" toggled off by
default, labelled grade C-D. **Grade for regional loss/gain allocation: B (VAT allometry, A-level meta-regression) / C (limb-trunk exponents and gain
allocation: 2-3 studies each) / B for "no meaningful spot reduction" / D for the exact K values.**

### M8. Circumferences from state (and state from waist): the cross-section model

**Mechanism.** A body section is a lean core (bone, muscle, organs) wrapped in fat. For a circular section `A = C^2/(4*pi)`; adding fat area
`dA_fat` thickens the shell by `dt = dA_fat/C` and raises the circumference by `dC = 2*pi*dt`. Regional fat mass becomes area through the fat volume per kg and
an **effective length** `L` over which that depot is spread at the measured level; muscle likewise. This gives a physically consistent map
state -> circumference that also reproduces the population relations below.

**Equations.**
```
C_j = sqrt( 4*pi * (A_core_j + A_fat_j) )               [cm; A in cm2]
A_fat_j = F_j * KV * 1000 / L_j                          KV = 1.28 L adipose tissue per kg DXA fat (AT = FM/0.85, 0.92 kg/L; PROPOSED)
waist : F = SAT_trunk + VAT ; L = 38 cm ; A_core = a_w * ( FFMI0*h^2 + kappa*(FFM - FFMI0*h^2) ) / h ; a_w = 9.7 (M) / 8.65 (F) cm2*m/kg ; kappa = 0.5
hip   : F = 0.55*legFat ; L = 30 cm ; A_core = a_h * (same lean term)/h ; a_h = 19.1 (M) / 22.5 (F)
arm   : F = armFat/2 ; L = 48 (M) / 46 (F) cm ; A_core = a_a * SM_arm_one/(0.2*h) ; a_a = 11.5 (M) / 11.25 (F) ; SM_arm_one = armShare*SM/2
FFMI0 = 19.6 (M) / 16.0 (F), h in m, masses in kg
inverse: trunkFromWaist(WC) = max( (WC^2/(4*pi) - A_core_waist) * L_w / (KV*1000), 0 ), then bound to [0.30, 0.75] * 0.955*FM
loss hysteresis (waist only): dC_loss = psi * dC_geometric,  psi = 0.83 (PROPOSED FIT to CALERIE-2)
muscle-driven change in a region: dA = dSM_j*1000/(1.06*L_m,j) ; dC = 2*pi*dA/C ; L_m: arm 29 cm (implied by a_a), thigh 38, calf 28 (UNVERIFIED)
```
Linearised sensitivities (cm per kg of regional fat, waist `dC/dF = 2*pi*KV*1000/(L*C) = 211.6/C`): 2.65 (C = 80), 2.23 (95), 1.92 (110), 1.63 (130); with
`psi` on loss 2.2 / 1.85 / 1.6 / 1.35. Equivalent per kg of *body weight* in CALERIE-like loss: 0.8-1.0 cm.

**Calibration data and validation (all against sources I opened):**

| Check | Data | Result |
|---|---|---|
| Population waist vs BMI (fit, age 40, heights 1.76 / 1.63 m, BMI 20-42) | NHANES 2015-18 equipercentile regressions, pooled over decades: `WC_M = 24.81 + 2.612*BMI + 0.179*(age-40)`, `WC_F = 30.46 + 2.235*BMI + 0.113*(age-40)` (rmse 1.4 / 1.6 cm from 9 percentiles x 6 decades) [41] | model rmse 1.4 (M) / 1.1 (F) cm, max 3.5 / 3.0 cm |
| **Independent age check** (not fitted): waist at fixed BMI 27, ages 25-65 | M: pop 92.6 -> 99.8; F: 89.1 -> 93.6 | model M 93.5 -> 99.3; F 89.1 -> 94.2 (within 1 cm) |
| Within-person change, CALERIE-2 [49] | dFM -5.4 kg, dFFM -2.0 kg, trunk fat -3.2 (M) / -2.8 (W) kg; WC -6.2 cm (pooled), i.e. 2.1 cm per kg trunk fat and 0.82 cm per kg weight | geometric model -7.6 (M) / -7.4 (F) cm -> `psi` 0.83 |
| Cross-sectional slope | NHANES: 2.6 (M) / 2.2 (F) cm per BMI unit = 0.84 / 0.90 cm per kg for a 1.76 / 1.63 m person | equals longitudinal 0.82 cm/kg (CALERIE) - one number for both |
| Lean-muscular sanity (no data fitted) | M 1.76 m, 80 kg, 11.5 % BF, z_belly -0.5 -> 79.9 cm; M 1.80 m, 95 kg, 9 % -> 82.3 cm; F 1.65 m, 62 kg, 16 % -> 69.7 cm | plausible contest-lean values (`UNVERIFIED` targets) |
| MUAC vs BMI (fit) | NHANES 2015-18: `MUAC_M = 12.53 + 0.762*BMI - 0.040*(age-40)`, `MUAC_F = 11.25 + 0.712*BMI - 0.014*(age-40)`, rmse 0.45 cm [41] | model rmse 0.45 (M) / 0.37 (F); implied arm-muscle length 29 cm matches mid-arm AMA ~ 60 cm2 |
| Hip vs BMI (anchor only) | MRI cohort WHR .87 M / .78 F with WC 87.6 / 78.0 -> hip ~100.7 / 100 cm at BMI 25.1 / 24.5 [43] | model slope 1.7 cm per BMI unit; Ambikairajah post- vs pre-menopause hip +2.0 cm for BMI +1.14 (age-confounded) [47] |
| Geometric law `dC = 2*pi*dt` | HIFEM+RF device [65]: lateral-thigh fat layer -18 +- 5.5 mm (MRI), thigh circumference -2.3 cm mean (-3.5 at 10 cm below fold); fat loss confined to ~1/4-1/3 of the perimeter -> 6.3 x 1.8 cm x 0.25 = 2.8 cm | consistent (device study, not exercise) |

Other regions (chest/bust, neck, thigh, calf, bideltoid) have **no verified population regression** in this work. Defaults (`UNVERIFIED`, height-proportional
at reference composition BMI 24 M / 22 F): neck .222 H (M) / .192 H (F); chest .555 H (M) / bust .525 H (F); proximal thigh .31 H / .34 H; calf .207 H / .21 H;
bideltoid breadth .259 H (Drillis-Contini as tabulated in Winter, `UNVERIFIED`). Changes from the same law: `dC = 2*pi*(dA_fat + dA_muscle)/C` with
`L_fat`: chest 25, thigh 38, calf 28, neck 10 cm (`UNVERIFIED`) and fat shares: chest fat = trunk SAT x (.15 M / .25 F), thigh = .6 x leg fat, calf = .15 x leg fat.
**Recommendation:** fit these constants offline on the ANSUR II CSVs (public, 4,082 M + 1,986 F, 93 measures) joined to predicted composition; not done here (dataset
download outside the permission scope of this task).

**Time dynamics.** Circumferences follow tissue mass without lag except: (i) water/glycogen shifts change scale weight in days with negligible circumference effect;
(ii) skin/abdominal-wall laxity makes waist reduction about 17 % smaller than geometry (psi); (iii) whether VAT loss reduces waist less than the same SAT loss is not modelled separately
(open question).

**Moderators.** Sex/age through `a` and depot shares; muscularity through `kappa`; ethnic body build not modelled (frame factor).
**Grade: B** for waist and MUAC (calibrated on nationally representative data with independent age and CALERIE checks); **C** for hip; **D** for chest/thigh/calf/neck.

### M9. Training status and muscle-gain potential from FFMI + self-reported training years

**Mechanism.** Observed FFMI relative to (a) what an untrained person of this height/fatness/age would have and (b) the natural ceiling indicates how much
hypertrophy potential is used.

**Equations.**
```
FFMI_norm = FFMI + 6.3*(1.80 - h)                                  // Kouri normalisation [35]
FFMI_exp  = BMI * (1 - (CUNBAE + offsetDXA + offsetEth)/100)       // untrained expectation for this BMI/age/sex
FFMI_lim  = 25.0 (M)  |  20.6 (F)                                  // M: Kouri limit [35]; F: PROPOSED (same z, +2.13 SD above the age-30 NHANES median: 16.03 + 2.13*2.18)
fPot      = clamp( (FFMI_norm - FFMI_exp) / (FFMI_lim - FFMI_exp), 0, 1 )
expected  fPot(T)  = dFFMI_train(T_eff) / (FFMI_lim - FFMI_exp) ,  dFFMI_train = dmax*(1 - exp(-T_eff/3)),  dmax = 3.6 (M) / 2.5 (F)
remaining potential  dFFM_rem = (FFMI_lim - FFMI_norm) * h^2                     [kg of fat-free mass]
class: fPot <.15 untrained/novice; .15-.40 novice-trained; .40-.70 intermediate; .70-.90 advanced; >.90 near ceiling
consistency flag: fPot_obs > fPot_expected(T) + 0.30  -> "possible genetic outlier, prior training or over-estimated muscularity" (show, do not change)
```
Data behind ceilings/anchors: non-users of anabolic steroids reached but did not exceed normalised FFMI 25.0 (74 athletes; pre-steroid-era Mr America mean 25.4) while
users exceeded 25 and some 30 [35]; competitive bodybuilders 25.1 +- 1.8 (M, n 17) and 18.3 +- 1.4 (F, n 10) by 4C (drug status not stated) [36]; women fitness competitors
before dieting 18.4 (DXA lean + bone) [37]; NHANES P95 of FFMI age 30 = 24.9 (M) / 20.9 (F) [29]. Ceiling is a sample edge, not a physical law (Kouri's authors
call the result preliminary); women's ceiling has no dedicated natural-athlete study located.

Interaction with rates (dossier 09 owns numbers): `fPot` is the state variable to modulate hypertrophy rate (`rate ~ (1 - fPot)^gamma`), and first-year novice gain used
in the prior is about +1 FFMI unit (about 3 kg) for men (PROPOSED, D).

**Reconciliation with dossier 09 (integrator note).** Dossier 09 sec. 4.6 defines the dynamic training-status state `TS = M_acc/G_pot`, `G_pot = dFFMI_pot*h^2` with
`dFFMI_pot` = 6.0 (M) / 4.3 (F) kg/m2 and initialises `TS0 = max(1 - exp(-0.47*Y_eff), clamp((FFMI_user - FFMI_untrained_ref)/dFFMI_pot, 0, 0.95))`
(also uses the +6.3(1.80 - h) normalisation and cites counter-data to a hard limit of 25, e.g. 26.4 % of 235 NCAA football players above 25 - quoted from that dossier, not
re-checked here). Use 09's `TS` for hypertrophy dynamics; this dossier supplies its inputs (`FFMI`, `FFMI_norm`, `FFMI_exp` = untrained reference from the population equation, sex, years).
The two are consistent in span (untrained-to-ceiling 5.1-5.4 FFMI units here for men vs 6.0 there) but **not in speed**: 09 implies +2.2 FFMI units after one year
(0.37 x 6.0) whereas the BF-prior above uses +1.0. Keep this dossier's smaller `dFFMI_train` **only** as the prior shift inside `estimateBF` (a conservative shift; using 09's speed would
over-correct BF% for beginners) and flag the discrepancy for the integrator. `fPot` here equals `TS` at t = 0 if 09's initialisation is used.

**Grade: D** for the mapping (two ceilings from small athlete samples, expected-gain curve fitted to three anchor points); **C** for the ceiling of 25 in lean men.

### M10. Avatar: `stateToAvatarParams` and body-model options

**Rendering recommendation (static web app, no backend, licence-clean).** Build a **parametric SVG silhouette (front + side)** whose control widths
derive from the M8 circumferences. It is ~5-20 kB of code, animates by interpolating parameters, needs no assets, has no licence exposure and matches the app's
resolution of information (the state predicts circumferences at about +-1-2 cm at best; a detailed mesh would over-claim). Keep a glTF/three.js path as an
optional v2.

| Option | Licence (verified, [60]) | Fit for this app | Verdict |
|---|---|---|---|
| Own parametric SVG | own code | tiny; front+side; driven directly by state | **v1** |
| MakeHuman assets / targets / exports | code AGPL; assets and exports CC0 | glTF with morph targets (weight/muscle/proportion modifiers exist in MakeHuman; exact names `UNVERIFIED`), multi-MB | v2 candidate (bake targets offline, ship glTF) |
| Anny 2025 (NAVER LABS Europe, arXiv 2511.03589) | code + model Apache-2.0; MakeHuman assets via MPFB2 CC0; SOMA topology Apache-2.0; **SMPL-X topology non-commercial - avoid the `[smpl]` extra** | PyTorch package (47.7 MB wheel); phenotype parameters in [0,1] (gender, age, height, weight, ...; muscle/fat semantics not verified); needs offline export to glTF morphs | v2/3 candidate after checking parameter semantics |
| SMPL / SMPL-X / STAR | non-commercial research only; no redistribution; commercial via Meshcapade | shape PCA from ~14,000 scans (STAR) | **do not use** without a commercial licence |
| BodyVisualizer (MPI) | bodyvisualizer.com now redirects to me.meshcapade.com (commercial) | - | avoid |
| ANSUR II | public CSV (4,082 M, 1,986 F, 93 measures); hosting page states no licence (US Army work, described elsewhere as public domain: confirm) | offline calibration of breadth/depth ratios | use offline; do not ship raw |
| CAESAR | proprietary (`UNVERIFIED`) | - | do not use |
| Open scan + DXA sets | none found; Maalin's OSF data are simulated | - | gap for learned shape models |

**Landmarks and section geometry** (`y/H` from the floor; Drillis-Contini proportions, `UNVERIFIED` here): head top 1.000; chin .870; neck .855; acromion .818;
chest (nipple) .720; waist .610; hip (max gluteal) .520; crotch .470; mid-thigh .380; knee .285; calf .200; ankle .039; elbow .630; wrist .485.

Circumference -> ellipse (Ramanujan; error < 0.001 % for depth/width 0.5-1.0, checked numerically against the exact integral):
```
k(rho) = 3*(1+rho) - sqrt( (3+rho)*(1+3*rho) )
a = C / (pi*k(rho))          // lateral half-width  -> front silhouette width = 2a
b = rho*a                    // AP half-depth       -> side silhouette depth  = 2b
side view: front edge = +phi*2b, back edge = -(1-phi)*2b from the plumb line
```
Depth/width ratio `rho` and front fraction `phi` by level (`PROPOSED`, anchors noted):

| level | rho | phi | anchor |
|---|---|---|---|
| neck, thigh, calf, upper arm | 0.95 | 0.5 | near-circular (`UNVERIFIED`) |
| chest | 0.70 (M) / 0.72 (F) | 0.55 | `UNVERIFIED` |
| waist | `clamp(0.66 + 0.005*(C_w - 82) + 0.35*(vFrac - vRef), 0.60, 0.92)`, `vRef` .20 M / .10 F | `0.58 + 0.10*(vFrac - vRef)` | 0.65-0.69 at BMI 23: caliper transverse 30.7 cm and sagittal 20.1 (F) / 21.3 (M) cm in 288 Chinese T2D patients [61] (ellipse formula gives C = 81-83 cm); slope and VAT term `UNVERIFIED` |
| hip | 0.70 | 0.35 (glutes behind) | `UNVERIFIED` |

Resulting example half-widths (front width = 2a): waist C 80, rho .68 -> a 15.0 (depth 20.4 cm); C 96, rho .75 -> 17.4 (26.1); C 120, rho .85 -> 20.6 (35.0);
female waist C 86, rho .72 -> 15.8 (22.8); female hip C 106, rho .72 -> 19.5 (28.1); male chest C 100, rho .70 -> 18.6 (26.0).
Shoulders: `bideltoid = 0.259*H + 0.29*(MUAC - MUAC_ref)` cm (`PROPOSED`: deltoid thickness grows with arm radius).

**Outline construction.** For y-levels above the crotch: points `(cx +- a_j, y_j)` interpolated with monotone cubic Hermite (Fritsch-Carlson) so that no
overshoot creates fake bumps; legs below the crotch: two mirrored tubes centred at `+-0.5*a_hip*0.9` with widths from thigh/knee/calf/ankle;
arms hang at 8-12 degrees with width `MUAC/pi` (upper arm), `0.80*MUAC/pi` (forearm). Front-view tone layers: abdominal definition, pectoral/deltoid/quadriceps
shading, vascularity; side-view: belly, chest, gluteal offsets.

**Fat/muscle appearance drivers (D-grade conventions):**
```
fatCover_trunk   = smoothstep(BFeff, lo, hi) with (lo,hi) = (10,17) M | (17,25) F   // abdominal-definition visibility fades as trunk SAT thickens
vascularity      = smoothstep(BFeff, 11,15)(M) | (17,22)(F)
muscleDefinition = clamp((SMI - SMI_ref)/(SMI_ref*0.5)) * (1 - fatCover)
faceFullness     = clamp((BF - BF_lean)/(BF_obese - BF_lean)),  BF_lean/BF_obese = 12/35 (M), 20/45 (F)
trunk SAT partition for the extras: abdominal .55, chest .15 (M) / .25 (F incl. breast), back-flank .30; sliders scale a share by 1 + 0.4*s and renormalise
```
`BFeff` = BF adjusted by the local depot: `BF + 6*(z_belly)` for the abdomen, so an "apple" avatar loses ab definition earlier (`PROPOSED`).

**`stateToAvatarParams(state)` returns:** `{ circ: {neck, bideltoid, chest, waist, hip, thigh, calf, arm}, rho, phi, levels[], armAngle, definition:
{abs, pecs, delts, quads, vascularity}, faceFullness, outputs: {BF, FMI, FFMI, WHR, WHtR, waistCm, VATkg} }`; morphing to the projected body = linear interpolation of
`circ`, `definition` and `faceFullness` between start and end states (same landmark count so paths interpolate vertex-wise); show start silhouette as a ghost and print
`delta circumference` callouts.

**Grade: D** (design). Ellipse maths verified; ratios and landmarks flagged; the calibrated part is M8.

### M11. Uncertainty of the initial state and its propagation

**Sources (1 SD, %BF unless stated):**

| Source | SD | Basis |
|---|---|---|
| BMI+age+sex equation | 4.2-4.7 | [6,8] |
| + waist (RFM) | 3.1-3.6 in NHANES; use 4.0 externally | [8,9] |
| Visual slider | 5.5 (repeatability better: bodyline SD < 6 % of scale [25]; systematic biases up to 5-7 BMI units in men [22]) | M2 |
| 3D scan ceiling | 2.4 kg FM (about 3 %BF) | [27] |
| Reference-method frame (DXA vs ADP/4C) | +-2-3 | [8,9] |
| Fusion output | 3.3-3.8 with visual + waist; 4.2-4.7 otherwise; 4.3 for muscular with history | M3 |
| **Realistic total incl. model misspecification** | **+-4-6 (1 SD); athletes/lean/Asian without adjustment: +-6-10** | |

Other state errors: `FFM` (from `W - FM`) inherits `sigma_BF/100*W` kg, i.e. +-3.3 kg per 4 %BF at 82 kg; `SM` +-2-3 kg; VAT +-30-40 % (model 10-14 % low
vs medians; population SD is 46-70 % of the mean in [42,45]); waist not supplied: `WC` SD about 5.5 (M) / 6.5 (F) cm (`UNVERIFIED`: assumes r about 0.9 with BMI and NHANES SDs 12-15 cm);
supplied waist: 0.5-1 cm.

**Propagation through a deficit (own calculation with the Forbes partition `p = 10.4/(10.4 + FM)` for dFFM/dBW and energy densities 9,400 (fat) / 1,800 (FFM) kcal/kg - the partition law is confirmed in dossier 01 (`dFFM/dBW = 10.4/(10.4 + FM)`, fat 9.44 kcal/g), the lean energy density 1.8 kcal/g is the value implied there (`C = 2.0 kg`); dossier 01 owns them -
Cunningham RMR, PAL 1.55, intake = 75 % of the initial TDEE, 84 days; TDEE recalculated from FFM as it changes) [57,58]:**

| Person | initial BF (same weight) | TDEE0 kcal | dFM kg | dFFM kg | dBW kg | FFM share of loss | dFM % of initial FM |
|---|---|---|---|---|---|---|---|
| Man 90 kg, 1.78 m | 20 % | 2,984 | -5.4 | -3.7 | -9.1 | 41 % | -30 % |
| | 25 % | 2,833 | -5.4 | -2.8 | -8.2 | 35 % | -24 % |
| | 30 % | 2,683 | -5.2 | -2.2 | -7.5 | 30 % | -19 % |
| Woman 68 kg, 1.65 m | 28 % | 2,213 | -4.1 | -2.5 | -6.6 | 38 % | -21 % |
| | 33 % | 2,099 | -4.0 | -2.0 | -6.0 | 34 % | -18 % |
| | 38 % | 1,985 | -3.9 | -1.7 | -5.5 | 30 % | -15 % |
| Man 90 kg, +10 % surplus, sedentary partition | 20 / 25 / 30 % | | +2.24 / +2.20 / +2.13 | +1.22 / +0.97 / +0.79 | | | |

**Sensitivity rules:** an error of +-5 %BF (about +-1.5 SD of the residual) changes (i) absolute fat loss by only ~0.2 kg over 12 weeks (robust), (ii) fat-free-mass loss by
+-0.75 kg (27 % relative), (iii) weight loss by +-0.8 kg, (iv) **maintenance intake by about +-150 kcal/d (+-5 %)**, and (v) any percent-of-fat metric by +-5 percentage points
(dFM % -19 vs -30). Therefore: report absolute kg outcomes with narrow bands, FFM/FFMI/percent-fat outcomes with wide bands; for the planner use robust (worst-of-three: mean and +-1 SD BF)
evaluation of any FFM-dependent objective. Monte Carlo: draw BF ~ N(BF_hat, sd) truncated, run 16-32 Latin-hypercube samples per candidate plan, plot 10-90 % bands.
**Grade: B** for the sensitivity magnitudes (deterministic consequence of published partition rules); the input SDs are C.

### M12. Reference implementation spec (TypeScript-flavoured; every constant is defined above)

Tables to ship as static JSON: Kelly LMS (White; other ethnic groups from the PLoS supplement) for `PCTFAT, FMI, LMI, ALMI, TRUNK_LIMB, BMC`; the anchors `FAT_ANCH`,
`FFMI_ANCH`; the DXA-offset and ethnic-offset tables. Golden test values in section 7.

```ts
type Sex = 'M' | 'F';
interface Inputs {
  sex: Sex; age: number; heightCm: number; weightKg: number;
  waistCm?: number; neckCm?: number; hipCm?: number;
  knownBf?: { pct: number; source: 'dxa'|'bia'|'skinfold'|'navy' };
  sliders?: { fat?: number; muscle?: number; belly?: number /* -1..1 */; chest?: number; arms?: number; face?: number;
              muscArms?: number; muscLegs?: number; muscTorso?: number };
  rtYears?: number; rtQuality?: 'casual'|'regular'|'serious'; ethnicity?: keyof typeof ETH_OFFSET;
  PAL?: number; carbGPerKg?: number; menopause?: 'pre'|'peri'|'post'|'unknown'; zFrame?: number;
}

// ---- LMS helpers (Kelly): S = sigma/M ; value(z) = M*(1+L*S*z)^(1/L) ; z(x) = ((x/M)^L - 1)/(L*S) ----
lmsValue(table, sex, eth, age, z);  lmsZ(table, sex, eth, age, x);          // linear interpolation of (M,sigma,L) between tabulated ages

// ---- M3: BF fusion ----
function estimateBF(i: Inputs) {
  const f = i.sex === 'F' ? 1 : 0, h = i.heightCm / 100, W = i.weightKg, bmi = W / (h*h);
  const Teff = (i.rtYears ?? 0) * ({casual:.4, regular:1, serious:1.5}[i.rtQuality ?? 'regular']);
  const dFFMI = (i.sex==='M' ? 3.6 : 2.5) * (1 - Math.exp(-Teff/3));
  const dF = 100 * dFFMI * h*h / W;                                          // %BF equivalent of a training-induced FFMI offset
  const athlete = Teff >= 2 || (i.sliders?.muscle != null && sliderTo(FFMI_ANCH[i.sex], i.sliders.muscle) >= (i.sex==='M' ? 21.6 : 17.8));
  const e1 = cunbae(f, i.age, bmi) + dxaOffset(i.sex, i.age) + ETH_OFFSET[i.ethnicity ?? 'white'] - dF;
  const infl = (athlete ? 1.4 : 1) * (e1 < (i.sex==='M' ? 15 : 24) ? 1.3 : 1);
  const obs: {name:string; y:number; sd:number}[] = [{name:'eq', y:e1, sd:4.7*infl}];
  if (i.waistCm) obs.push({name:'rfm', y: rfm(f, i.heightCm, i.waistCm) - 0.5*dF, sd:4.0*infl});
  // optional: if (i.neckCm) obs.push({name:'navy', y: navyBF(...), sd:4.5*infl});   // not part of the golden tests
  if (i.sliders?.fat != null) obs.push({name:'fat', y: sliderTo(FAT_ANCH[i.sex], i.sliders.fat), sd:5.5});
  if (i.sliders?.muscle != null) obs.push({name:'mus', y: 100*(1 - sliderTo(FFMI_ANCH[i.sex], i.sliders.muscle)*h*h/W), sd: 100*1.6*h*h/W});
  if (i.knownBf) obs.push({name:'known', y:i.knownBf.pct, sd:{dxa:2.5, bia:3.5, skinfold:4, navy:4}[i.knownBf.source]});
  const rho = (a:string,b:string) => (a==='eq'&&b==='rfm')||(a==='rfm'&&b==='eq') ? .6 : (a==='fat'&&b==='mus')||(a==='mus'&&b==='fat') ? .3
             : (['eq','rfm'].includes(a) && ['fat','mus'].includes(b)) || (['eq','rfm'].includes(b) && ['fat','mus'].includes(a)) ? .2 : 0;
  const S = obs.map((p,r)=>obs.map((q,c)=> r===c ? p.sd*p.sd : rho(p.name,q.name)*p.sd*q.sd));
  const Si = inv(S), one = obs.map(()=>1);
  const v = 1 / quad(one, Si, one);                                          // variance
  const bf = clamp(v * quad(one, Si, obs.map(o=>o.y)), i.sex==='M' ? 3 : 8, 60);
  return { bf, sd: Math.sqrt(v), obs };
}
// cunbae(f,age,bmi) = -44.988+0.503*age+10.689*f+3.172*bmi-0.026*bmi^2+0.181*bmi*f-0.02*bmi*age-0.005*bmi^2*f+0.00021*bmi^2*age
// rfm(f,hcm,wc)     = 64 - 20*hcm/wc + 12*f          sliderTo: piecewise-linear over the 8 stops at x = s*7

// ---- state ----
function estimateInitialState(i: Inputs): State {
  const { bf, sd } = estimateBF(i);
  const h = i.heightCm/100, W = i.weightKg, FM = W*bf/100, FFM = W - FM;
  // fat distribution
  let trunk: number, R: number, z: number;
  if (i.waistCm) {                                                            // waist known -> solve trunk fat, then R and z
    trunk = clamp(trunkFromWaist(i.waistCm, FFM, h, i.sex), .30*.955*FM, .75*.955*FM);
    R = trunk / (.955*FM - trunk);  z = clamp(lmsZ('TRUNK_LIMB', i.sex, 'W', i.age, R), -3, 3);
  } else { z = 2*(i.sliders?.belly ?? 0);  R = lmsValue('TRUNK_LIMB', i.sex, 'W', i.age, z);  trunk = .955*FM*R/(1+R); }
  const head = .045*FM, limbs = FM - head - trunk, arms = limbs*(i.sex==='M'?.22:.19), legs = limbs - arms;
  const Rref = lmsValue('TRUNK_LIMB', i.sex, 'W', i.age, 0);
  const vFrac = clamp(vatCoef(i.sex, FM, i.age) * Math.pow(R/Rref, .5), .04, .60);   // vatCoef = v0*(FM/FMref)^0.3*ageTerm (M6)
  const vat = trunk*vFrac, sat = trunk - vat;
  // lean compartment
  const FFMI0 = i.sex==='M' ? 19.6 : 16.0, Rn = i.sex==='M' ? 9.4 : 8.4;
  const SM = FFM - Rn*h*h - 0.1*(FFM - FFMI0*h*h);
  const BMC = (i.sex==='M' ? .045*(1-.001*Math.max(0,i.age-40)) : .051*(1-.0025*Math.max(0,i.age-45))) * FFM * (1 + (i.zFrame??0)*(i.sex==='M'?.15:.13));
  const TBW = .73*FFM, ECW = .38*TBW;
  const carb = i.carbGPerKg, gMus = SM * 16 * (carb==null ? 1 : carb<.75 ? .45 : carb>=5.5 ? 1.22 : 1), gLiv = 90;
  const RMR = 370 + 21.6*FFM, TDEE = (i.PAL ?? 1.5)*RMR;
  // training status (M9)
  const ffmiN = FFM/h/h + 6.3*(1.8 - h), ffmiExp = (W/h/h)*(1 - (cunbae(i.sex==='F'?1:0, i.age, W/h/h)+dxaOffset(i.sex,i.age)+ETH_OFFSET[i.ethnicity??'white'])/100);
  const lim = i.sex==='M' ? 25 : 20.6, fPot = clamp((ffmiN - ffmiExp)/(lim - ffmiExp), 0, 1);
  return { bf, bfSd: sd, FM, FFM, depots:{head, arms, legs, sat, vat}, R, zBelly:z, SM, BMC, TBW, ECW,
           glycogen:{muscle:gMus, liver:gLiv}, RMR, TDEE, intake0:TDEE, fPot,
           circ: { waist: waistFrom(FFM,h,i.sex,sat+vat), hip: hipFrom(FFM,h,i.sex,legs), arm: muacFrom(FFM,h,i.sex,arms,SM) } };
}
// waistFrom = sqrt(4*pi*(a*(FFMI0*h*h + .5*(FFM-FFMI0*h*h))/h + trunkFat*1.28*1000/38)) ; a = 9.7 (M) / 8.65 (F)
// trunkFromWaist inverts it.  hipFrom / muacFrom as in M8.

// ---- fat allocation each simulated day (M7): dFM total, weights F_i*K_i, K tables in M7; also update FFM/SM elsewhere (dossiers 01/03/09) ----

// ---- M8/M10: state -> avatar ----
function stateToAvatarParams(s: State, sex: Sex, hM: number): AvatarParams {
  // 1 circumferences: waist = waistFrom(...) [apply psi=0.83 to the change since baseline when dFat<0]; hip, arm by M8; other regions by reference proportions + dC = 2*pi*(dA_fat + dA_musc)/C
  // 2 ellipse semi-axes per level: k(rho)=3(1+rho)-sqrt((3+rho)(1+3rho)); a=C/(pi*k); b=rho*a; front fraction phi (M10 table)
  // 3 definition: fatCover/vascularity/muscleDefinition/faceFullness (M10); 4 outputs: BF, FMI, FFMI, WHR, WHtR, waist, VAT
}
```
**`stateToAvatarParams` in more detail (same conventions; called at t = 0 and at any simulated day; `base` = the initial state and its baseline circumferences):**
```ts
const PSI_LOSS = 0.83;
function circumferences(s: State, base: State, sex: Sex, h: number, userCirc?: Partial<Circ>): Circ {
  const geo0 = geoCirc(base, sex, h), geo = geoCirc(s, sex, h);          // waistFrom / hipFrom / muacFrom (+ reference-proportion regions)
  const anchor = { waist: userCirc?.waist ?? geo0.waist, hip: userCirc?.hip ?? geo0.hip, arm: userCirc?.arm ?? geo0.arm, /* others: reference proportions */ };
  const d = (k: keyof Circ) => geo[k] - geo0[k];
  return { waist: anchor.waist + (d('waist') < 0 ? PSI_LOSS : 1) * d('waist'), hip: anchor.hip + d('hip'), arm: anchor.arm + d('arm'), /* ... */ };
}
function levelsFor(c: Circ, s: State, sex: Sex, H: number) {
  const v = s.depots.vat / Math.max(s.depots.sat + s.depots.vat, 1e-6), vRef = sex === 'M' ? .20 : .10;
  const rhoW = clamp(.66 + .005*(c.waist - 82) + .35*(v - vRef), .60, .92);
  return [ // y as fraction of height, circumference (cm), depth/width, front fraction
    { n:'neck',  y:.855, C:c.neck,  rho:.95, phi:.50 }, { n:'chest', y:.720, C:c.chest, rho: sex==='M'?.70:.72, phi:.55 },
    { n:'waist', y:.610, C:c.waist, rho:rhoW, phi:.58 + .10*(v - vRef) }, { n:'hip', y:.520, C:c.hip, rho:.70, phi:.35 },
    { n:'thigh', y:.380, C:c.thigh, rho:.95, phi:.50 }, { n:'calf', y:.200, C:c.calf, rho:.95, phi:.50 } ].map(l => {
      const k = 3*(1+l.rho) - Math.sqrt((3+l.rho)*(1+3*l.rho)), a = l.C/(Math.PI*k);
      return { ...l, a, b: l.rho*a, yCm: l.y*H };                         // front half-width a, AP half-depth b
    });
}
// SVG: pixel x = cx +- a*scale at y = (1 - y)*H*scale ; monotone-cubic (Fritsch-Carlson) through the level points, mirrored; side view uses +phi*2b / -(1-phi)*2b
// morph: params(t) = lerp(params(start), params(end), t) for C, rho, phi, definition, faceFullness ; render a faint start-outline ghost ; show delta-C labels
```

---------------------------------------------------------------------------------------------------------

## 5. Interactions with other subsystems

| Module | Receives from this dossier | Gives to this dossier |
|---|---|---|
| 01 body-weight models | initial `FM`, `FFM`, `TBW`, `ECW`, glycogen, `TDEE0`; partition rule constant `C = 10.4 kg` (Forbes) used only for sensitivity here; per-depot fat split | FM/FFM trajectories each day (drives M7 allocation and M8 circumferences) |
| 02 energy expenditure | `FFM` (RMR = 370 + 21.6 FFM default), PAL default 1.5, `intake0 = TDEE0` | dynamic RMR/adaptive thermogenesis |
| 03 / 09 protein, hypertrophy | `SM`, regional SM shares, `fPot`, training class, expected first-year FFMI gain | daily SM change (feeds M8 muscle term) |
| 04 carbohydrate/glycogen | `glycogen.muscle/liver` initial from SM and habitual CHO; TBW/ECW | glycogen/water time courses |
| 06 lipids/insulin/liver | `VAT` (kg), `VAT/SAT`, `R`, age/sex - main adiposity covariate | VAT/insulin-sensitivity interactions if modelled |
| 12 / 16 hormones, menopause, ageing | menopause status modulates VAT age term (0.03/y after 48 y) | hormone-driven redistribution rules |
| 15 hydration | `TBW`, `ECW` | acute water shifts (kept out of circumferences) |
| 17 safety | BF/BMI/FFMI floors, uncertainty | floors trigger warnings |
| 18 planner | `bfSd` for robust objectives; circumference/waist outputs as goals | goal ranking |
| 19 outcomes | waist, WHtR, WHR, VAT | - |
| UI/avatar | `stateToAvatarParams`, slider anchors T2/T3, "implied weight" mismatch | user inputs |

## 6. Output metrics for the UI

| Metric | Unit | Good direction | Computation | Grade |
|---|---|---|---|---|
| Body fat % | % | down, with a soft warning below 8 % (M) / 16 % (F) and a hard stop below 5 % / 12 % (section 9) | `FM/W` | B (+- 4-6) |
| Fat mass, absolute change | kg | down (goal-dependent) | state | B (change), C (level) |
| FFM, FFMI (and normalised) | kg, kg/m2 | up/maintain | `FFM`, `FFM/h^2`, Kouri | B |
| Skeletal muscle mass / SMI | kg, kg/m2 | up | M5 | B-C |
| Waist circumference | cm | down (health thresholds by sex/ethnicity; see [63]) | M8 (`psi` on loss) | B |
| Waist-to-height ratio | ratio | down (< 0.5 common target; not re-verified) | `WC/H` | C |
| Hip, WHR | cm, ratio | context-dependent (WHR down) | M8 | C |
| VAT mass, VAT/SAT | kg, ratio | down | M6/M7 | C |
| Trunk:limb fat ratio (android/gynoid) | ratio | down | `R` | C |
| Fat-mass-index class | class | normal | Kelly FMI thresholds | B |
| Percentile of BF%, FMI, FFMI vs NHANES | P | context | LMS | B (2000s reference) |
| Muscle potential used `fPot`, remaining FFM potential | 0-1, kg | up until ~0.9 | M9 | D |
| Arm/thigh/chest circumference | cm | up (muscle goals) | M8 | C-D |
| Avatar silhouette | - | - | M10 | D |
| Confidence band on all body-composition outputs | % / kg | narrow | M11 | B |

## 7. Validation targets

Golden function values (must match to the printed decimals):
* `cunbae(M,30,BMI 25) = 22.09`; `cunbae(F,30,25) = 34.18`; `cunbae(M,60,30) = 32.29`; `cunbae(F,60,30) = 43.91`.
* `rfm(M,175 cm,waist 90) = 25.11`; `rfm(F,165 cm,80) = 34.75`; `deurenberg91(M,30,BMI 25) = 20.70`, `(F) = 31.50`.
* Navy inches / metric: M 178 cm waist 90 neck 38 -> 20.27 / 20.15; F 165 cm waist 75 hip 100 neck 33 -> 29.74 / 29.43.
* Gallagher (eq. as printed in [8]) at BMI 18.5-25, age 30: M 8.2-19.6, F 21.0-33.0.
* LMS: White M, age 30, %fat 25.7 -> z = 0.000; %fat 20 -> P16.4; FMI 4.9 -> P21.0; FFMI 22.5 -> P84.1; F age 45, z = +1.645 -> %fat 50.3; M age 40 trunk:limb ratio z = +2 -> 1.74, z = -2 -> 0.77.
* Kelly text check: median White M 25-y %fat 24.6 evaluated at age 45 -> P25.0; at age 69 -> P9.9.

Golden end-to-end results (`estimateInitialState`, PAL 1.5, White, sliders given as stated; BF anchors: slider = `toSlider(anchors, value)`):

| # | Inputs | BF (sd) | FM / FFM kg | FMI / FFMI | SM / SMI | depots kg (head/arms/legs/SAT/VAT) | R / z | WC / hip / MUAC | fPot | TDEE |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | M 35 y, 178 cm, 88 kg, waist 96, fat 27 %, muscle FFMI 19.8, RT 0 | 27.4 (3.3) | 24.1 / 63.9 | 7.6 / 20.2 | 33.9 / 10.7 | 1.08 / 2.52 / 8.93 / 9.14 / 2.44 | 1.01 / -0.52 | 96.0 / 105.5 / 34.8 | .05 | 2,625 |
| 2 | M 30 y, 176 cm, 80 kg, waist 76, fat 12 %, muscle FFMI 23.0, RT 8 y regular | 11.5 (4.3) | 9.2 / 70.8 | 3.0 / 22.9 | 40.7 / 13.1 | 0.41 / 1.30 / 4.61 / 2.59 / 0.30 | 0.49 / -3.0 (bound) | 76.0 / 101.6 / 34.3 | .66 | 2,849 |
| 3 | as #2 but no waist, no RT history | 15.4 (4.2) | 12.3 / 67.7 | 4.0 / 21.9 | 37.9 / 12.2 | 0.55 / 1.25 / 4.44 / 5.05 / 1.00 | 1.06 / 0 | 83.7 / 100.3 / 33.2 | .48 | 2,748 |
| 4 | F 42 y, 165 cm, 72 kg, waist 86, fat 36 %, muscle FFMI 15.8 | 37.9 (3.3) | 27.3 / 44.7 | 10.0 / 16.4 | 21.7 / 8.0 | 1.23 / 2.94 / 12.52 / 9.48 / 1.12 | 0.69 / -1.04 | 86.0 / 106.1 / 31.7 | .27 | 2,004 |
| 5 | F 28 y, 168 cm, 60 kg, no waist, fat 24 %, muscle FFMI 17.5, belly -0.5, RT 3 y | 22.4 (4.7) | 13.4 / 46.6 | 4.8 / 16.5 | 22.7 / 8.0 | 0.60 / 1.50 / 6.37 / 4.59 / 0.37 | 0.63 / -1.0 | 71.2 / 98.0 / 27.6 | .42 | 2,064 |
| 6 | M 45 y, 180 cm, 95 kg, nothing else | 30.2 (4.7) | 28.7 / 66.3 | 8.9 / 20.5 | 35.6 / 11.0 | 1.29 / 2.69 / 9.55 / 10.90 / 4.24 | 1.24 / 0 | 103.9 / 107.1 / 35.7 | 0 | 2,704 |

(BMC for #1 and #4: 2.88 and 2.28 kg. Values computed by the Python prototype of these formulas in the task scratchpad; treat the last digit as +-1 after re-implementation in TS.)

Published results the engine should reproduce (tolerance in brackets):

| # | Study (subjects; intervention; result) | Engine test | Tolerance |
|---|---|---|---|
| V1 | Kelly 2009 [29]: NHANES DXA White adults; medians by age (e.g. M 30 y: %fat 25.7, FMI 6.78, FFMI 19.6; F 30 y: 37.0, 9.35, 16.03) | `lmsValue(..., z=0)` and percentile round-trip; estimator applied to BMI at those medians returns %fat within +-2 (with DXA offsets) | +-0.1 (LMS); +-2 %BF |
| V2 | Woolcott 2018 [8]: NHANES 2005-06 n=3,456, DXA: RFM bias +0.9 (W) / +0.5 (M); CUN-BAE -0.2 / -0.1; IQR 4.9/4.2 and 6.0/5.7 | unit tests of RFM/CUN-BAE; assumed sigmas 4.0/4.7 stay >= NHANES-derived SD (3.1-4.4) | exact equations |
| V3 | CALERIE-2 [49]: 2-y 11.9 % CR; dWeight -7.6 kg, dFM -5.4, dFFM -2.0, dWC -6.2 cm; trunk fat -3.24 (M) / -2.81 (W); limb fat -2.4 / -2.5 | with dFM -5.4 (M FM 22, F FM 24.5): trunk share of loss 57/53 %; dWC with psi = 0.83: -6.3 / -6.1 cm | +-5 pp; +-1.5 cm |
| V4 | Ross 1996 [51]: 33 obese men, ~10 % weight loss: VAT -35 %, SAT -25 %, abdominal SAT -27 % vs gluteal-femoral -20 % | M 100 kg, 33 % BF, dFM -7.5..-8.5: VAT -28..-32 %, trunk SAT -24..-28 %, legs -19..-22 % | +-8 pp |
| V5 | Hallgreen-Hall 2008 [48]: `dVAT/VAT = 1.3*dFM/FM` (+-0.1; R2 .73; 37 studies) | log-log slope of VAT vs FM over a loss run = 1.29-1.34 | k in 1.2-1.4 |
| V6 | Tchoukalova 2010 [52]: 8-wk overfeeding, n = 28: upper +1.9 kg, lower +1.6 kg | gain of 3.5 kg in young lean adults: upper share 50-58 % | +-6 pp |
| V7 | Hulmi 2016 [37]: 27 women, FM -50 %, android -68 %, lean mass +1 % | trunk fat -57 % (model) | must be within -50..-75 %; known under-prediction |
| V8 | NHANES 2015-18 [41]: WC by BMI/age (M `24.81 + 2.612 BMI + 0.179 (age-40)`; F `30.46 + 2.235 BMI + 0.113 (age-40)`) | modelled waist for CUN-BAE composition at BMI 20-42, age 25-65 | +-2 cm (max 3.5) |
| V9 | MRI/CT VAT [42-44]: M (BMI 26, 42 y) 2.5 kg; F (BMI 27, 48 y) 1.6 kg; UKB M 4.6 L / F 2.3 L at ~63 y | VAT model | +-30 % |
| V10 | Ambikairajah 2019 [47]: post- vs pre-menopause WC +4.63 cm with BMI +1.14 (about +2.1 cm at fixed BMI) | model waist at BMI 27 age 45 -> 57 (F): +2.0 cm | +-1 cm |
| V11 | Han 1997 [62]: 110 women (BMI >= 25) 6-month diet; `%weight loss = 0.85*waist reduction (cm) - 2.09` (r = .79); mean loss 6.2 kg at 6 months; reverse-regression slope `r^2/0.85 = 0.73` cm per 1 % weight loss (about 0.8 cm/kg at 85-95 kg) | woman 90 kg, 165 cm, BF 45 %: model gives 0.67-0.68 cm per 1 % (0.75 cm/kg); man 100 kg, BF 33 %: 0.79 | +-20 % |
| V12 | Sensitivity table (M11) | reproduce the 12-week deficit table with the engine's own partition (dossier 01) | dFM +-0.5 kg |

## 8. Myths / contested claims

| Claim | Evidence |
|---|---|
| "Spot reduction works if you train the area" | Null in the largest MRI trial (n = 104) and in isocaloric trials (n = 11-24); local lipolysis is real but not net local loss; three small DXA/skinfold trials (n = 14-16) report local effects, one in 2023 (n = 16) [54] -> unproven, at most a few percentage points |
| "First on, last off" | Partly true, modestly: VAT and trunk lose relatively more (VAT k = 1.3; trunk:limb susceptibility x1.3), gain goes slightly more to legs (K_GAIN 1.15 vs loss 0.84); it is a tilt of about 10-20 %, not an order [48-52] |
| "BMI tells you body fat" | Sensitivity of BMI >= 30 for BF-defined obesity 36 % (M) / 49 % (W) in NHANES III; athletes' BMI cut-offs 1.4-7.6 units higher; RFM/CUN-BAE over-estimate lean and muscular people by about 3-15 points (M2 table) [7,15,16] |
| "Menopause itself causes belly fat" | Meta-analysis of 201 cross-sectional + 11 longitudinal studies: changes attributable mainly to age, no additional menopause effect; but longitudinal DXA/CT (n = 156) sees VAT gain only in women who became postmenopausal [47] -> contested; model uses an age slope that steepens after 48 y |
| "Visual body-fat charts/silhouettes are accurate" | r about .76-.80 with BMI, <5 % (women) to 22 % (men) of perception error explained by anthropometry/DXA, muscularity confound 5-7 BMI units, poor test-retest for the somatomorphic matrix [19,21,22,26] |
| "Natural FFMI limit is exactly 25" | Edge of a 1995 sample of 74 non-user athletes (preliminary); population 95th percentile of NHANES FFMI at 30 y is 24.9 but includes heavier people [29,35]; dossier 09 cites NCAA data with 26.4 % of 235 football players above 25 (not re-checked here) |
| "You cannot change fat-cell number" | Adipocyte number is stable in adults across weight change; ~10 %/y are replaced [52]; lower-body hyperplasia with overfeeding was observed over 8 wk in 28 adults [52] |
| "Waist scales the same for gain and loss" | Cross-sectional slope (0.84-0.9 cm/kg) equals longitudinal loss slope only after applying a laxity factor psi 0.83 to the geometric prediction |

## 9. Safety bounds

* **State floors for projections:** soft warning below BF 8 % (M) / 16 % (F) (contest-lean territory); hard stop below 5 % (M) / 12 % (F) or `FFMI` below 16.0 (M) / 13.0 (F) (about NHANES P5):
  show a "not sustainable/unsafe" warning and stop projecting fat loss; the planner must never target them (thresholds `PROPOSED`, dossier 17 owns final values). Contest-lean bodies (M 4.5 %, F 12.6 % DXA) were transient and accompanied by testosterone 9.2 -> 2.3 ng/mL [38], falling T3, testosterone, estradiol, leptin and
  menstrual irregularity in women [37]; sports bodies have no accepted minimum [40]; contest-preparation guidance keeps weight loss to about 0.5-1 % of body weight per week to protect muscle [39].
* **Avatar/visual self-rating** can stress people with body-image disorders (body-size over-estimation is a hallmark of AN/BN [24]); make sliders optional, never show
  "ideal body" prompts, show numbers as estimates with ranges, and offer "enter measured BF%" first.
* **Adults only (>= 18 y).** Child equations (Deurenberg child, RFMp) are not implemented; exclude pregnancy/lactation, age > 80 without caveat (RFM degrades with age).
* Do not present VAT or android/gynoid outputs as diagnoses; label as "modelled".
* Do not allow conflicting inputs to crash the estimator: clamp BF to [3, 60] (M) / [8, 60] (F), require `W/h^2` in [13, 60], waist 50-200 cm, warn when `|W - W_vis|` > 8 kg.

## 10. Open questions / weakest assumptions

1. Visual-slider sigma (5.5 %BF), slider -> FFMI sigma (1.6) and the correlations (.6, .3, .2) are `PROPOSED`; no dataset of avatar picks vs DXA exists - collect one (opt-in) to refit.
2. Training-offset curve (`dmax` 3.6/2.5, tau 3 y) and the women's natural ceiling (FFMI 20.6) are grade D; evidence: one 1995 male sample, two athlete cohorts.
3. DXA-vs-ADP/4C frame: NHANES DXA %fat medians exceed densitometry equations by 3-4 points in the young; the offsets are an empirical patch. Black-adult offset has opposite signs in DXA vs D2O/4C literature.
4. VAT model: fitted to about six means/medians from populations of different ages; no age-specific VAT distribution was available (Framingham supplement not opened); menopause attribution unresolved.
5. Depot shares (head 4.5 %, arms 22/19 % of limb fat, regional SM shares, leg share of hip fat 55 %) and all chest/thigh/calf/neck constants are `UNVERIFIED`; a one-time offline calibration on ANSUR II + a DXA-labelled scan set would replace them.
6. Loss/gain asymmetry (K tables), VAT exponent during gain, and possible regional redistribution after weight regain are weakly supported; Hulmi's android data (-68 % at -50 % FM) exceed the model.
7. Waist model uses the NHANES iliac-crest protocol; navel-level waist (Navy, many home measurements) can differ by several cm in obesity (`UNVERIFIED`).
8. Ethnic-specific composition (South Asian phenotype, Black adults), sarcopenic obesity and older adults (> 65 y) are handled only through offsets and Kelly medians.
9. The NHANES 1999-2004 reference is a generation old; present-day FMI is higher; percentile labels should be dated.
10. Full 3-D avatar (glTF) would require joint scan-and-composition data that are not openly available; SVG v1 avoids this.
11. Not opened (blocked): Gallagher 2000 tables (ethnic terms), Janssen 2000 regional-muscle table, Hodgdon & Beckett original SEE for men, Framingham age percentile supplement, ScienceDirect/OUP full texts.

## 11. References

Numbers in brackets in the text. PMID/DOI given where I saw them; "read" = abstract or full text opened this session.

1. Deurenberg P, Weststrate JA, Seidell JC. Body mass index as a measure of body fatness: age- and sex-specific prediction formulas. Br J Nutr 1991;65:105-14. PMID 2043597; doi 10.1079/bjn19910073 (abstract read).
2. Deurenberg P, Yap M, van Staveren WA. Body mass index and percent body fat: a meta-analysis among different ethnic groups. Int J Obes 1998;22:1164-71. PMID 9877251; doi 10.1038/sj.ijo.0800741 (abstract read).
3. Deurenberg P, Deurenberg-Yap M, Guricci S. Asians are different from Caucasians and from each other in their BMI/body fat per cent relationship. Obes Rev 2002;3:141-6. PMID 12164465 (abstract read).
4. Deurenberg-Yap M, Schmidt G, van Staveren WA, Deurenberg P. The paradox of low BMI and high body fat percentage among Chinese, Malays and Indians in Singapore. Int J Obes 2000;24:1011-7. PMID 10951540 (abstract read).
5. Gallagher D, Heymsfield SB, Heo M, et al. Healthy percentage body fat ranges: an approach for developing guidelines based on BMI. Am J Clin Nutr 2000;72:694-701. PMID 10966886; doi 10.1093/ajcn/72.3.694 (abstract read; tables not accessible).
6. Gomez-Ambrosi J, Silva C, Catalan V, et al. Clinical usefulness of a new equation for estimating body fat (CUN-BAE). Diabetes Care 2012;35:383-8. PMID 22179957; PMC3263863; doi 10.2337/dc11-1334.
7. Vinknes KJ, Nurk E, Tell GS, et al. The relation of CUN-BAE index and BMI with body fat, cardiovascular events and diabetes during a 6-year follow-up: the Hordaland Health Study. Clin Epidemiol 2017;9:555-66. PMID 29184445; PMC5685095; doi 10.2147/CLEP.S145130.
8. Woolcott OO, Bergman RN. Relative fat mass (RFM) as a new estimator of whole-body fat percentage - a cross-sectional study in American adult individuals. Sci Rep 2018;8:10980. PMID 30030479; PMC6054651; doi 10.1038/s41598-018-29362-1 (full text read, incl. Table 2 and equation footnotes for CUN-BAE, Gallagher, Deurenberg, Kagawa).
9. Guzman-Leon AE, Velarde AG, Vidal-Salas M, et al. External validation of the relative fat mass (RFM) index in adults from north-west Mexico. PLoS One 2019;14:e0226767. PMID 31891616; PMC6938316 (abstract read).
10. Hodgdon JA, Beckett MB. Prediction of percent body fat for U.S. Navy men/women from body circumferences and height. Naval Health Research Center reports, 1984 (DTIC ADA143890 / ADA146456; PDFs blocked); equations as reproduced in DoDI 1308.3 (2002) via secondary pages (topendsports.com/testing/bodyfat-girths.htm; women n=202 R .856 SEE 3.61 from a secondary summary).
11. Potter AW, Tharion WJ, Holden LD, et al. Circumference-based predictions of body fat revisited: preliminary results from a US Marine Corps body composition survey. Front Physiol 2022;13:868627. PMID 35432005; PMC9008774 (abstract read).
12. Jackson AS, Pollock ML. Generalized equations for predicting body density of men. Br J Nutr 1978;40:497-504. PMID 718832; doi 10.1079/bjn19780152.
13. Jackson AS, Pollock ML, Ward A. Generalized equations for predicting body density of women. Med Sci Sports Exerc 1980;12:175-81. PMID 7402053.
14. Siri WE. Body composition from fluid spaces and density: analysis of methods. Nutrition 1993;9:480-91 (reprint of 1961). PMID 8286893.
15. Romero-Corral A, Somers VK, Sierra-Johnson J, et al. Accuracy of body mass index in diagnosing obesity in the adult general population. Int J Obes 2008;32:959-66. PMID 18283284 (abstract read).
16. Ode JJ, Pivarnik JM, Reeves MJ, Knous JL. Body mass index as a predictor of percent fat in college athletes and nonathletes. Med Sci Sports Exerc 2007;39:403-9. PMID 17473765 (abstract read).
17. Heymsfield SB, Scherzer R, Pietrobelli A, Lewis CE, Grunfeld C. Body mass index as a phenotypic expression of adiposity: quantitative contribution of muscularity. Int J Obes 2009;33:1363-73. PMID 19773739; PMC3156622 (abstract read).
18. Heymsfield SB, Heo M, Thomas D, Pietrobelli A. Scaling of body composition to height: relevance to height-normalized indexes. Am J Clin Nutr 2011;93:736-40. PMID 21248190 (abstract read).
19. Parzer V, Sjoholm K, Brix JM, et al. Development of a BMI-assigned Stunkard scale ... SOS reference study. Obes Facts 2021;14:397-404. PMID 34284407; doi 10.1159/000516991 (abstract read).
20. Bulik CM, Wade TD, Heath AC, Martin NG, Stunkard AJ, Eaves LJ. Relating body mass index to figural stimuli: population-based normative data for Caucasians. Int J Obes 2001;25:1517-24. PMID 11673775; doi 10.1038/sj.ijo.0801742 (abstract via search).
21. Cabral MC, Coelho GMO, Oliveira N, et al. Association of body image perception and (dis)satisfaction with adiposity in adults: the Pro-Saude study. PLoS One 2024;19:e0304987. PMID 38857269; PMC11164337 (abstract read).
22. Groves V, Cornelissen P, McCarty K, et al. How does variation in the body composition of both stimuli and participant modulate self-estimates of men's body size? Front Psychiatry 2019;10:720. PMID 31649565; PMC6794946 (full text read).
23. Groves V, Ridley BJ, Cornelissen PL, et al. Men's perception of current and ideal body composition and the influence of media internalization on body judgments. Front Psychol 2023;14:1116686. PMID 37205060; PMC10185840 (abstract read).
24. Maalin N, Mohamed S, Kramer RSS, Cornelissen PL, Martin D, Tovee MJ. Beyond BMI for self-estimates of body size and shape: a new method for developing stimuli correctly calibrated for body composition. Behav Res Methods 2021;53:1308-21. PMID 33051818; PMC8219570 (full text read).
25. Alexi J, Cleary D, Dommisse K, et al. Past visual experiences weigh in on body size estimation. Sci Rep 2018;8:215. PMID 29317693; PMC5760712 (abstract read).
26. Cafri G, Roehrig M, Thompson JK. Reliability assessment of the somatomorphic matrix. Int J Eat Disord 2004;35:597-600. PMID 15101075 (abstract read); Kagawa M, Kerr D, Dhaliwal S, Hills AP, Binns CW. Applicability of the Somatomorphic Matrix computer program in Japanese and Australian Caucasian males in relation to measured body composition. Body Image 2006;3:385-94. PMID 18089242 (abstract read); Ralph-Nearman C, Filik R. New body scales reveal body dissatisfaction, thin-ideal, and muscularity-ideal in males. Am J Mens Health 2018;12:740-50. PMID 29557236; PMC6131474 (full text read; Table 5 quotes Cafri 2004 test-retest correlations).
27. Ng BK, Hinton BJ, Fan B, Kanaya AM, Shepherd JA. Clinical anthropometrics and body composition from 3D whole-body surface scans. Eur J Clin Nutr 2016;70:1265-70. PMID 27329614; PMC5466169. Heymsfield SB et al. Digital anthropometry: a critical review. Eur J Clin Nutr 2018;72:680-7. PMID 29748657. Tinsley GM et al. Digital anthropometry via 3D optical scanning: evaluation of four commercial systems. Eur J Clin Nutr 2020;74:1054-64. PMID 31685968.
28. Lennie SC, Hall A, Nguyen G, et al. Subjective evaluation of female adult body fat distribution: a scoping review. Obes Rev 2026;e70068. PMID 41401969; PMC13070896; doi 10.1111/obr.70068 (abstract via search).
29. Kelly TL, Wilson KE, Heymsfield SB. Dual energy X-ray absorptiometry body composition reference values from NHANES. PLoS One 2009;4:e7038. PMID 19753111; PMC2737140; doi 10.1371/journal.pone.0007038 (full text + supplementary Tables S1-S8 read).
30. Schutz Y, Kyle UU, Pichard C. Fat-free mass index and fat mass index percentiles in Caucasians aged 18-98 y. Int J Obes 2002;26:953-60. PMID 12080449; doi 10.1038/sj.ijo.0802037 (abstract read).
31. Janssen I, Heymsfield SB, Wang ZM, Ross R. Skeletal muscle mass and distribution in 468 men and women aged 18-88 yr. J Appl Physiol 2000;89:81-8. PMID 10904038; doi 10.1152/jappl.2000.89.1.81 (abstract read).
32. Kim J, Wang Z, Heymsfield SB, Baumgartner RN, Gallagher D. Total-body skeletal muscle mass: estimation by a new DXA method. Am J Clin Nutr 2002;76:378-83. PMID 12145010 (abstract read; equation `SM = 1.19*ALST - 1.65` via a secondary summary of the paper).
33. Lee RC, Wang Z, Heo M, Ross R, Janssen I, Heymsfield SB. Total-body skeletal muscle mass: development and cross-validation of anthropometric prediction models. Am J Clin Nutr 2000;72:796-803. PMID 10966902 (equation via search summary).
34. Heymsfield SB, McManus C, Smith J, Stevens V, Nixon DW. Anthropometric measurement of muscle mass: revised equations for calculating bone-free arm muscle area. Am J Clin Nutr 1982;36:680-90. PMID 7124671 (abstract read).
35. Kouri EM, Pope HG Jr, Katz DL, Oliva P. Fat-free mass index in users and nonusers of anabolic-androgenic steroids. Clin J Sport Med 1995;5:223-8. PMID 7496846 (abstract read).
36. Graybeal AJ, Moore ML, Cruz MR, Tinsley GM. Body composition assessment in male and female bodybuilders: a 4-compartment model comparison of DXA and impedance-based devices. J Strength Cond Res 2020;34:1676-89. PMID 30161092 (abstract read).
37. Hulmi JJ, Isola V, Suonpaa M, et al. The effects of intensive weight reduction on body composition and serum hormones in female fitness competitors. Front Physiol 2016;7:689. PMID 28119632; PMC5222856 (full text read).
38. Rossow LM, Fukuda DH, Fahs CA, Loenneke JP, Stout JR. Natural bodybuilding competition preparation and recovery: a 12-month case study. Int J Sports Physiol Perform 2013;8:582-92. PMID 23412685 (abstract read).
39. Helms ER, Aragon AA, Fitschen PJ. Evidence-based recommendations for natural bodybuilding contest preparation: nutrition and supplementation. J Int Soc Sports Nutr 2014;11:20. PMID 24864135; PMC4033492 (abstract read).
40. Sundgot-Borgen J, Meyer NL, Lohman TG, et al. How to minimise the health risks to athletes who compete in weight-sensitive sports: review and position statement on behalf of the IOC Medical Commission. Br J Sports Med 2013;47:1012-22. PMID 24115480; Meyer NL et al. Body composition for health and performance: a survey of body composition assessment practice... Br J Sports Med 2013;47:1044-53. PMID 24065075 (abstracts read).
41. Fryar CD, Carroll MD, Gu Q, Afful J, Ogden CL. Anthropometric reference data for children and adults: United States, 2015-2018. Vital Health Stat 3(46), 2021. PMID 33541517 (report PDF read; adult Tables 3, 5, 9, 11, 14, 15, 19, 20, 22, 23).
42. Shen W, Punyanitya M, Wang Z, et al. Visceral adipose tissue: relations between single-slice areas and total volume. Am J Clin Nutr 2004;80:271-8. PMID 15277145; PMC2040041 (abstract read).
43. Scafoglieri A, Van den Broeck J, Cattrysse E, Bautmans I, Heymsfield SB. Non-linear associations between visceral adipose tissue distribution and anthropometry-based estimates of visceral adiposity. Front Nutr 2022;9:825630. PMID 35399665; PMC8987197 (full text read; Table 1).
44. Linge J, Borga M, West J, et al. Body composition profiling in the UK Biobank Imaging Study. Obesity 2018;26:1785-95. PMID 29785727; PMC6220857 (full text read; Table 1).
45. Pou KM, Massaro JM, Hoffmann U, et al. Patterns of abdominal fat distribution: the Framingham Heart Study. Diabetes Care 2009;32:481-5. PMID 19074995; PMC2646033 (full text read). Fox CS et al. Circulation 2007;116:39-48. PMID 17576866 (abstract read).
46. Kuk JL, Lee S, Heymsfield SB, Ross R. Waist circumference and abdominal adipose tissue distribution: influence of age and sex. Am J Clin Nutr 2005;81:1330-4. PMID 15941883; Kuk JL, Saunders TJ, Davidson LE, Ross R. Age-related changes in total and regional fat distribution. Ageing Res Rev 2009;8:339-48. PMID 19576300; Camhi SM et al. Obesity 2011;19:402-8. PMID 20948514; Nazare JA et al. Ethnic influences on the relations between abdominal subcutaneous and visceral adiposity, liver fat, and cardiometabolic risk profile: INSPIRE ME IAA. Am J Clin Nutr 2012;96:714-26. PMID 22932278 (abstracts read).
47. Lemieux S et al. Sex differences in the relation of visceral adipose tissue accumulation to total body fatness. Am J Clin Nutr 1993;58:463-7. PMID 8379501; Kotani K et al. Sexual dimorphism of age-related changes in whole-body fat distribution in the obese. Int J Obes Relat Metab Disord 1994;18:207-(end page not confirmed). PMID 8044194; Lovejoy JC et al. Increased visceral fat and decreased energy expenditure during the menopausal transition. Int J Obes 2008;32:949-58. PMID 18332882; Ambikairajah A et al. Fat mass changes during menopause: a metaanalysis. Am J Obstet Gynecol 2019;221:393-409.e50. PMID 31034807 (abstracts read).
48. Hallgreen CE, Hall KD. Allometric relationship between changes of visceral fat and total fat mass. Int J Obes 2008;32:845-52. PMID 18087265; PMC2398723 (abstract + summary read). Hall KD, Hallgreen CE. Increasing weight loss attenuates the preferential loss of visceral compared with subcutaneous fat: a predicted result of an allometric model. Int J Obes 2008;32:722. PMID 18301391; PMC2614356 (read). Chaston TB, Dixon JB. Factors associated with percent change in visceral versus subcutaneous abdominal fat during weight loss: findings from a systematic review. Int J Obes 2008;32:619-28. PMID 18180786.
49. Das SK, Roberts SB, Bhapkar MV, et al. Body-composition changes in the CALERIE-2 study: a 2-y randomized controlled trial of 25 % calorie restriction in nonobese humans. Am J Clin Nutr 2017;105:913-27. PMC5366044; doi 10.3945/ajcn.116.137232 (PMC page read).
50. Benito PJ, Cupeiro R, Peinado AB, et al. Influence of previous body mass index and sex on regional fat changes in a weight loss intervention. Phys Sportsmed 2017;45:450-7. PMID 28914104; doi 10.1080/00913847.2017.1380500 (abstract read).
51. Ross R, Rissanen J, Pedwell H, Clifford J, Shragge P. Influence of diet and exercise on skeletal muscle and visceral adipose tissue in men. J Appl Physiol 1996;81:2445-55. PMID 9018491. Ross R et al. Reduction in obesity and related comorbid conditions after diet-induced weight loss or exercise-induced weight loss in men. Ann Intern Med 2000;133:92-103. PMID 10896648. Ross R et al. Ann Intern Med 2015;162:325-34. PMID 25732273 (abstracts read).
52. Tchoukalova YD, Votruba SB, Tchkonia T, et al. Regional differences in cellular mechanisms of adipose tissue gain with overfeeding. PNAS 2010;107:18226-31. PMID 20921416; PMC2964201. Spalding KL et al. Dynamics of fat cell turnover in humans. Nature 2008;453:783-7. PMID 18454136 (abstracts read).
53. Wahrenberg H, Lonnqvist F, Arner P. Mechanisms underlying regional differences in lipolysis in human adipose tissue. J Clin Invest 1989;84:458-67. PMID 2503539; PMC548904. Karpe F, Pinnick KE. Biology of upper-body and lower-body adipose tissue. Nat Rev Endocrinol 2015;11:90-100. PMID 25365922. Manolopoulos KN, Karpe F, Frayn KN. Gluteofemoral body fat as a determinant of metabolic health. Int J Obes 2010;34:949-59. PMID 20065965. Karastergiou K et al. Sex differences in human adipose tissues - the biology of pear shape. Biol Sex Differ 2012;3:13. PMID 22651247; PMC3411490 (abstracts read).
54. Vispute SS et al. The effect of abdominal exercise on abdominal fat. J Strength Cond Res 2011;25:2559-64. PMID 21804427. Ramirez-Campillo R et al. Regional fat changes induced by localized muscle endurance resistance training. J Strength Cond Res 2013;27:2219-24. PMID 23222084. Kostek MA et al. Subcutaneous fat alterations resulting from an upper-body resistance training program. Med Sci Sports Exerc 2007;39:1177-85. PMID 17596787. Stallknecht B, Dela F, Helge JW. Are blood flow and lipolysis in subcutaneous adipose tissue influenced by contractions in adjacent muscles in humans? Am J Physiol Endocrinol Metab 2007;292:E394-9. PMID 16985258. Scotto di Palumbo A et al. Effect of combined resistance and endurance exercise training on regional fat loss. J Sports Med Phys Fitness 2017;57:794-801. PMID 28497942. Paoli A et al. Effect of an endurance and strength mixed circuit training on regional fat thickness: the quest for the "spot reduction". Int J Environ Res Public Health 2021;18:3845. PMID 33917584; PMC8038840. Brobakken MF et al. Abdominal aerobic endurance exercise reveals spot reduction exists: a randomized controlled trial. Physiol Rep 2023;11:e15853. PMID 38010201; PMC10680576 (abstracts read).
55. Areta JL, Hopkins WG. Skeletal muscle glycogen content at rest and during endurance exercise in humans: a meta-analysis. Sports Med 2018;48:2091-102. PMID 29923148. Acheson KJ, Schutz Y, Bessard T, et al. Glycogen storage capacity and de novo lipogenesis during massive carbohydrate overfeeding in man. Am J Clin Nutr 1988;48:240-7. PMID 3165600 (abstracts read).
56. Watson PE, Watson ID, Batt RD. Total body water volumes for adult males and females estimated from simple anthropometric measurements. Am J Clin Nutr 1980;33:27-39. PMID 6986753 (equations via secondary sources: Churchill & Patri, Indian J Nephrol 2021, PMC8240937; Nenova et al., Cureus 2024, PMC11568871). Wang Z, Deurenberg P, Wang W, et al. Hydration of fat-free body mass: new physiological modeling approach. Am J Physiol 1999;276:E995-1003. PMID 10362610. Chumlea WC et al. Total body water reference values and prediction equations for adults. Kidney Int 2001;59:2250-8. PMID 11380828. Hioka A, Akazawa N, Okawa N, Nagahiro S. Sex differences in age-related changes in the extracellular water-to-total body water ratio among community-dwelling individuals. JMA J 2026;9:495-501. PMID 41958617; PMC13058710; doi 10.31662/jmaj.2025-0368 (full text read).
57. Cunningham JJ. Body composition as a determinant of energy expenditure: a synthetic review and a proposed general prediction equation. Am J Clin Nutr 1991;54:963-9. PMID 1957828. ten Haaf T, Weijs PJ. Resting energy expenditure prediction in recreational athletes of 18-35 years. PLoS One 2014;9:e108460. PMID 25275434; PMC4183531 (abstracts read).
58. Hall KD, Sacks G, Chandramohan D, et al. Quantification of the effect of energy imbalance on bodyweight. Lancet 2011;378:826-37. PMID 21872751; PMC3880593. Thomas DM et al. A simple model predicting individual weight change in humans. J Biol Dyn 2011;5:579-99. PMID 24707319. Forbes GB. Lean body mass-body fat interrelationships in humans. Nutr Rev 1987;45:225-31. PMID 3306482 (abstracts read; the partition `dFFM/dBW = 10.4/(10.4 + FM)` and energy densities of about 9,440 (fat) / 1,815 (lean) kcal/kg are confirmed in this repository's dossier 01, which owns them).
59. Connor Gorber S, Tremblay M, Moher D, Gorber B. A comparison of direct vs. self-report measures for assessing height, weight and BMI: a systematic review. Obes Rev 2007;8:307-26. PMID 17578381. Flegal KM et al. Comparisons of self-reported and measured height and weight, BMI, and obesity prevalence from national surveys: 1999-2016. Obesity 2019;27:1711-9. PMID 31544344 (abstracts read).
60. Licences: SMPL-X model licence https://smpl-x.is.tue.mpg.de/modellicense.html (read); STAR (Osman et al., ECCV 2020, arXiv 2008.08535; PS Licence 1.0, non-commercial; via search); Meshcapade (commercial SMPL licensing; me.meshcapade.com); Anny: NAVER LABS Europe, arXiv 2511.03589 and PyPI `anny` 0.6.1 licence statements (read); MakeHuman licensing statements (AGPL code, CC0 assets/exports; via search of makehumancommunity/opensource.org discussion); ANSUR II: https://www.openlab.psu.edu/ansur2/ (read).
61. Li C, Zeng L, Li M, et al. New sagittal abdominal diameter and transverse abdominal diameter based equations to estimate visceral fat area in type 2 diabetes patients. BMC Public Health 2024;24:1364. PMID 38773444; PMC11106903; doi 10.1186/s12889-024-18659-8 (full text read; Table 1: n = 288, BMI 23.0-23.4, SAD 20.1 (F) / 21.3 (M) cm, TAD 30.7 cm).
62. Han TS, Richmond P, Avenell A, Lean ME. Waist circumference reduction and cardiovascular benefits during weight loss in women. Int J Obes 1997;21:127-34. PMID 9043967 (abstract read).
63. Ross R, Neeland IJ, Yamashita S, et al. Waist circumference as a vital sign in clinical practice: a Consensus Statement from the IAS and ICCR Working Group on Visceral Obesity. Nat Rev Endocrinol 2020;16:177-89. PMID 32020062; PMC7027970 (full text read).
64. Samouda H, Dutour A, Chaumoitre K, et al. VAT = TAAT - SAAT: innovative anthropometric model to predict visceral adipose tissue without resort to CT-scan or DXA. Obesity 2013;21:E41-50. PMID 23404678; PMC3618381 (abstract read). So R, Matsuo T, Saotome K, Tanaka K. Equation to estimate visceral adipose tissue volume based on anthropometry for workplace health checkup in Japanese abdominally obese men. Ind Health 2017;55:416-22. PMID 28701657; PMC5633357 (read). Song X, Wu H, Zhang W, Wang B, Sun H. Equations for predicting DXA-measured visceral adipose tissue mass based on BMI or weight in adults. Lipids Health Dis 2022;21:45. PMID 35578238; PMC9109344 (abstract read). Kaul S et al. Dual-energy X-ray absorptiometry for quantification of visceral fat. Obesity 2012;20:1313-8. PMID 22282048 (DXA vs CT VAT r2 .96).
65. Palm MD, Halaas Y, Kinney BM, Goldfarb R. Spot reduction of localized fat deposits on the lateral thighs by simultaneous emission of synchronized radiofrequency and high-intensity focused electromagnetic energy. Dermatol Surg 2023. PMID 36533796 (abstract read; device study, used only for the geometric consistency check).
