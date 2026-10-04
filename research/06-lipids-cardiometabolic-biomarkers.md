# 06 — Lipids & cardiometabolic biomarkers (diet composition, energy balance, weight change, exercise)

Author: research agent 06 · compiled 2026-09-30 · Status: complete first draft for merge into the engine.
All numbers below were read from the cited abstracts / full texts during this session unless tagged `UNVERIFIED`.
Numeric baselines in section 2 were **computed by us from public NHANES microdata** (method in section 2.3, reference R60).
Cross-references: #01 body-weight model, #02 energy expenditure, #04 carbohydrate/insulin, #05 ketosis, #09/#10 exercise, #14 fat distribution, #15 sodium/potassium/fibre/alcohol, #16 modifiers, #17 safety.

Conventions used throughout
- Units: cholesterol mg/dL (mmol/L x 38.67); triglyceride mg/dL (mmol/L x 88.57); glucose mg/dL (mmol/L x 18.02); insulin uU/mL (x 6.945 = pmol/L); uric acid mg/dL (x 59.48 = umol/L). ApoB mg/dL.
- Evidence grade A/B/C/D as in `RESEARCH_PROTOCOL.md`. `PROPOSED FIT` = our equation fitted to cited data points (points listed). `UNVERIFIED` = number recalled or derived but not confirmed in a source we opened.
- "Steady-state target" X*(t) is what the biomarker converges to if the current drivers were held constant; the biomarker then lags it with a first-order time constant tau (section 4.1). Outputs shown to the user should be **relative change vs the user's own baseline** (X/X0 - 1); absolute values only use the NHANES generator in section 2.

---------------------------------------------------------------------------------------------------

## 1. Scope

This module turns the physically eaten diet (fatty-acid classes, cholesterol, fibre, sterols, sugars, alcohol, sodium, potassium, omega-3), the energy balance / weight trajectory (from #01), ketosis state (from #05) and exercise (from #09/#10) into *simulated blood biomarkers*: LDL-C, ApoB, non-HDL-C, HDL-C, triglycerides, systolic/diastolic BP, fasting glucose, HbA1c, fasting insulin/HOMA-IR, hs-CRP, intrahepatic triglyceride (IHTG), ALT, uric acid, and visceral adipose tissue (VAT; the subcutaneous/visceral partition itself is owned by #14, we provide the coefficients).
Every biomarker is given as: drivers -> coefficients -> steady-state target -> first-order lag -> baseline by sex/age/BMI -> inter-individual SD -> evidence grade.
It does not model diseases or events; it does not model named diets (only nutrient inputs).

---------------------------------------------------------------------------------------------------

## 2. State variables

### 2.1 Table of states

| State | Unit | Typical adult range (NHANES P5-P95, section 2.3) | Represents | Initial-value rule |
|---|---|---|---|---|
| LDL_C | mg/dL | 64-177 (M), 63-170 (F) | LDL cholesterol (Martin-Hopkins) | B0 from generator (2.3) x individual z-score `z_LDL` (persistent random effect) |
| APOB | mg/dL | ~50-130 (mean 90, SD 25; NHANES 2013-14) | ApoB particle number proxy | derive: APOB0 = 11.1 + 0.587 x nonHDL0 (resid SD 8.4) [R60] |
| HDL_C | mg/dL | 32-71 (M), 37-89 (F) | HDL cholesterol | generator |
| TG | mg/dL | 38-270 (M), 33-197 (F); log-normal | fasting triglyceride | generator (ln scale) |
| NONHDL | mg/dL | TC - HDL | atherogenic cholesterol | derived: LDL + TG/5 approx (Friedewald-like) or TC-HDL |
| SBP / DBP | mmHg | 104-147 / 59-93 (M, untreated) | seated resting BP | generator (excludes BP-med users) |
| FPG | mg/dL | 86-123 | fasting plasma glucose | generator |
| INS | uU/mL | 3-32; log-normal | fasting insulin | generator (ln scale) |
| HOMA_IR | - | GM 2.3 (GSD 2.1) | FPG x INS / 405 | derived |
| HBA1C | % | 4.8-6.2 | glycated Hb (slow state) | generator; must be initialised consistent with FPG (eAG = 28.7 A1c - 46.7 [R48]) |
| CRP | mg/L | 0.3-10 (M), 0.3-13 (F); log-normal | hs-CRP | generator (ln scale) |
| IHTG | % liver fat (MRI-PDFF/MRS) | lean ~2-3 %; steatosis >5.56 % [R57] | intrahepatic triglyceride | from the BMI rule in 4.9 (Grade C) |
| ALT | U/L | 11-58 (M), 8-40 (F); log-normal | liver enzyme | generator (ln scale) |
| URIC | mg/dL | 4.1-8.2 (M), 2.9-7.0 (F) | serum urate | generator |
| VAT | cm3 (DXA) or L (MRI) | DXA mean 320-760 cm3 (M, by BMI class) | visceral adipose tissue | generator in 2.4; partition owned by #14 |
| BP_Na_state, LEM_state, HEP_state | internal | 0..1 or delta units | slow "lag" states used by the ODEs below | 0 at t=0 |

### 2.2 What the user must supply vs what we generate
The user does not know their labs. Use the NHANES generator (2.3) for the *absolute* level, draw one persistent standard-normal z per marker (or use z=0 = "average person"), and always chart **relative change**. Provide an optional "I know my labs" override for LDL, HDL, TG, SBP, HbA1c, CRP.

### 2.3 Typical baselines: NHANES 2017-March 2020 pre-pandemic cycle (computed by us)

Method: public NHANES XPT files (DEMO, BMX, TCHOL, HDL, TRIGLY, GHB, GLU, INS, HSCRP, BIOPRO, BPXO, DIQ, BPQ; CDC NCHS, https://wwwn.cdc.gov/Nchs/Nhanes/) for adults 20-79, non-pregnant, weighted with MEC weights (WTMECPRP; fasting-subsample weight WTSAFPRP for LDL, TG, glucose, insulin). Lipid cohort excludes diagnosed diabetes and users of cholesterol medication (BPQ100D); BP cohort excludes antihypertensive users (BPQ050A); glycaemic cohort excludes diagnosed diabetes (fasting glucose/HbA1c retain undiagnosed diabetes, hence the heavy right tail of the FPG SD). BP = mean of oscillometric readings 2-3 (BPXO; oscillometric devices read slightly differently from auscultation). LDL = Martin-Hopkins (LBDLDLM). Regression: weighted least squares of y (or ln y) on (age-45)/10 and (BMI-27), fitted separately by sex. n: lipids 5287 (fasting subset 2460 for LDL/TG), BP 5036, HbA1c 6267, FPG 2936, insulin 2875, CRP 7174, ALT/urate 7185.

#### Table B1. Mean (SD) [geometric mean (GSD) for log-normal markers marked *] by sex and age decade

| Marker | Sex | 20-29 | 30-39 | 40-49 | 50-59 | 60-69 | 70-79 |
|---|---|---|---|---|---|---|---|
| TC (mg/dL) | M | 172 (38) | 188 (36) | 202 (39) | 199 (38) | 196 (33) | 188 (39) |
| TC (mg/dL) | F | 168 (32) | 181 (31) | 193 (33) | 208 (37) | 217 (39) | 217 (44) |
| LDL-C, Martin-Hopkins (mg/dL) | M | 99 (33) | 115 (32) | 129 (32) | 124 (32) | 126 (28) | 107 (29) |
| LDL-C, Martin-Hopkins (mg/dL) | F | 94 (27) | 105 (30) | 114 (28) | 126 (33) | 127 (32) | 133 (46) |
| HDL-C (mg/dL) | M | 48 (12) | 47 (12) | 48 (13) | 50 (13) | 50 (13) | 54 (15) |
| HDL-C (mg/dL) | F | 56 (14) | 58 (16) | 59 (17) | 61 (16) | 64 (19) | 62 (16) |
| TG (mg/dL)* | M | 77 (x/ 1.86) | 99 (x/ 1.84) | 107 (x/ 1.88) | 106 (x/ 1.80) | 92 (x/ 1.58) | 83 (x/ 1.53) |
| TG (mg/dL)* | F | 67 (x/ 1.67) | 75 (x/ 1.83) | 80 (x/ 1.67) | 88 (x/ 1.65) | 92 (x/ 1.60) | 101 (x/ 1.66) |
| SBP (mmHg) | M | 118 (11) | 120 (11) | 122 (13) | 126 (14) | 127 (17) | 129 (16) |
| SBP (mmHg) | F | 107 (10) | 109 (12) | 114 (14) | 123 (18) | 125 (18) | 133 (19) |
| DBP (mmHg) | M | 71 (10) | 76 (10) | 78 (10) | 78 (10) | 74 (10) | 69 (10) |
| DBP (mmHg) | F | 69 (9) | 72 (10) | 73 (10) | 76 (11) | 72 (10) | 71 (10) |
| HbA1c (%) | M | 5.2 (0.4) | 5.4 (0.6) | 5.5 (0.6) | 5.6 (0.5) | 5.6 (0.5) | 5.7 (0.4) |
| HbA1c (%) | F | 5.2 (0.3) | 5.3 (0.5) | 5.4 (0.5) | 5.7 (0.7) | 5.7 (0.5) | 5.7 (0.4) |
| Fasting glucose (mg/dL) | M | 99 (10) | 102 (21) | 106 (18) | 107 (20) | 110 (20) | 110 (12) |
| Fasting glucose (mg/dL) | F | 96 (9) | 101 (23) | 101 (14) | 102 (15) | 107 (19) | 106 (13) |
| Fasting insulin (uU/mL)* | M | 8 (x/ 2.31) | 10 (x/ 2.06) | 9 (x/ 2.06) | 9 (x/ 1.93) | 11 (x/ 1.95) | 10 (x/ 1.97) |
| Fasting insulin (uU/mL)* | F | 11 (x/ 2.11) | 9 (x/ 1.98) | 8 (x/ 2.02) | 9 (x/ 1.88) | 10 (x/ 1.99) | 9 (x/ 1.66) |
| hs-CRP (mg/L)* | M | 1.3 (x/ 2.93) | 1.6 (x/ 2.95) | 1.8 (x/ 2.81) | 1.9 (x/ 2.90) | 1.9 (x/ 3.16) | 1.7 (x/ 3.00) |
| hs-CRP (mg/L)* | F | 1.8 (x/ 3.48) | 1.9 (x/ 3.40) | 2.4 (x/ 3.18) | 2.3 (x/ 3.25) | 2.2 (x/ 3.07) | 2.1 (x/ 2.69) |
| ALT (U/L)* | M | 23 (x/ 1.88) | 25 (x/ 1.72) | 26 (x/ 1.63) | 25 (x/ 1.58) | 21 (x/ 1.61) | 19 (x/ 1.57) |
| ALT (U/L)* | F | 15 (x/ 1.68) | 15 (x/ 1.63) | 15 (x/ 1.66) | 19 (x/ 1.59) | 18 (x/ 1.55) | 16 (x/ 1.49) |
| Uric acid (mg/dL) | M | 6.0 (1.2) | 6.0 (1.3) | 6.0 (1.4) | 5.9 (1.3) | 6.0 (1.3) | 6.0 (1.3) |
| Uric acid (mg/dL) | F | 4.5 (1.2) | 4.5 (1.1) | 4.5 (1.1) | 4.8 (1.2) | 5.1 (1.4) | 5.2 (1.4) |

#### Table B2. Mean (SD) [GM (GSD)*] by sex and BMI class

| Marker | Sex | BMI <25 | BMI 25-29.9 | BMI >=30 |
|---|---|---|---|---|
| TC (mg/dL) | M | 175.4 (37.6) | 192.6 (37.9) | 195.6 (37.9) |
| TC (mg/dL) | F | 188.5 (40.5) | 197.8 (39.4) | 191.0 (37.0) |
| LDL-C, Martin-Hopkins (mg/dL) | M | 102.4 (35.4) | 119.0 (31.3) | 123.5 (31.5) |
| LDL-C, Martin-Hopkins (mg/dL) | F | 105.1 (36.0) | 119.4 (31.5) | 113.9 (32.5) |
| HDL-C (mg/dL) | M | 55.6 (13.4) | 48.7 (12.6) | 44.4 (10.7) |
| HDL-C (mg/dL) | F | 66.6 (16.6) | 59.9 (16.4) | 52.5 (13.4) |
| TG (mg/dL)* | M | 71.1 (x/ 1.68) | 96.5 (x/ 1.87) | 112.8 (x/ 1.77) |
| TG (mg/dL)* | F | 62.1 (x/ 1.62) | 80.9 (x/ 1.64) | 97.0 (x/ 1.71) |
| SBP (mmHg) | M | 121.2 (14.0) | 122.1 (13.7) | 123.1 (12.6) |
| SBP (mmHg) | F | 112.6 (15.8) | 116.9 (16.5) | 117.0 (16.9) |
| DBP (mmHg) | M | 71.1 (10.6) | 74.7 (9.9) | 77.4 (10.0) |
| DBP (mmHg) | F | 68.0 (9.5) | 71.8 (9.5) | 76.1 (10.2) |
| HbA1c (%) | M | 5.32 (0.46) | 5.46 (0.60) | 5.52 (0.51) |
| HbA1c (%) | F | 5.32 (0.40) | 5.43 (0.48) | 5.63 (0.65) |
| Fasting glucose (mg/dL) | M | 100.1 (17.7) | 104.8 (19.2) | 108.0 (15.9) |
| Fasting glucose (mg/dL) | F | 96.8 (10.5) | 100.5 (12.3) | 105.9 (22.0) |
| Fasting insulin (uU/mL)* | M | 5.3 (x/ 1.82) | 8.1 (x/ 1.75) | 15.7 (x/ 1.89) |
| Fasting insulin (uU/mL)* | F | 5.7 (x/ 1.65) | 8.3 (x/ 1.65) | 14.8 (x/ 1.83) |
| hs-CRP (mg/L)* | M | 1.0 (x/ 3.14) | 1.4 (x/ 2.82) | 2.5 (x/ 2.59) |
| hs-CRP (mg/L)* | F | 1.0 (x/ 2.90) | 1.8 (x/ 2.69) | 3.9 (x/ 2.67) |
| ALT (U/L)* | M | 18.4 (x/ 1.64) | 22.6 (x/ 1.63) | 27.9 (x/ 1.67) |
| ALT (U/L)* | F | 14.2 (x/ 1.54) | 15.9 (x/ 1.61) | 18.2 (x/ 1.64) |
| Uric acid (mg/dL) | M | 5.4 (1.1) | 6.0 (1.2) | 6.3 (1.4) |
| Uric acid (mg/dL) | F | 4.1 (1.0) | 4.6 (1.1) | 5.2 (1.3) |

#### Table B3. Weighted least-squares baseline generators: y = a + b_age*(age-45)/10 + b_bmi*(BMI-27), residual SD s (ln-scale for * markers)

| Marker | Sex | a | b_age | b_bmi | resid SD s |
|---|---|---|---|---|---|
| TC (mg/dL) | M | 189.370 | 5.732 | 0.811 | 37.439 |
| TC (mg/dL) | F | 193.871 | 11.664 | -0.241 | 34.706 |
| LDL-C, Martin-Hopkins (mg/dL) | M | 115.876 | 5.327 | 1.104 | 32.011 |
| LDL-C, Martin-Hopkins (mg/dL) | F | 112.964 | 8.630 | 0.168 | 31.210 |
| HDL-C (mg/dL) | M | 50.618 | 0.878 | -0.702 | 12.056 |
| HDL-C (mg/dL) | F | 61.179 | 1.818 | -0.703 | 15.209 |
| TG (mg/dL) (ln) | M | 4.508 | 0.046 | 0.028 | 0.579 |
| TG (mg/dL) (ln) | F | 4.335 | 0.088 | 0.019 | 0.500 |
| SBP (mmHg) | M | 122.491 | 2.409 | 0.156 | 12.878 |
| SBP (mmHg) | F | 115.729 | 5.333 | 0.153 | 14.327 |
| DBP (mmHg) | M | 73.997 | 0.656 | 0.477 | 9.952 |
| DBP (mmHg) | F | 71.362 | 1.134 | 0.386 | 9.728 |
| HbA1c (%) | M | 5.427 | 0.099 | 0.012 | 0.511 |
| HbA1c (%) | F | 5.413 | 0.111 | 0.016 | 0.504 |
| Fasting glucose (mg/dL) | M | 104.080 | 2.293 | 0.448 | 17.356 |
| Fasting glucose (mg/dL) | F | 99.426 | 2.196 | 0.627 | 15.839 |
| Fasting insulin (uU/mL) (ln) | M | 2.080 | 0.019 | 0.078 | 0.574 |
| Fasting insulin (uU/mL) (ln) | F | 2.093 | -0.020 | 0.051 | 0.535 |
| hs-CRP (mg/L) (ln) | M | 0.319 | 0.065 | 0.069 | 0.998 |
| hs-CRP (mg/L) (ln) | F | 0.500 | 0.017 | 0.076 | 0.988 |
| ALT (U/L) (ln) | M | 3.098 | -0.036 | 0.026 | 0.500 |
| ALT (U/L) (ln) | F | 2.748 | 0.031 | 0.012 | 0.470 |
| Uric acid (mg/dL) | M | 5.827 | -0.015 | 0.059 | 1.247 |
| Uric acid (mg/dL) | F | 4.502 | 0.138 | 0.061 | 1.132 |

Notes on the tables: SDs are *between-person* SDs in the population (they include measurement error and unmeasured lifestyle). For log-normal markers ("*") the GSD column is the multiplicative SD (x/ factor). Use `y = a + b_age*(age-45)/10 + b_bmi*(BMI-27) + s*z` (Table B3), exponentiate for * markers. Reading example: 40-year-old woman, BMI 24 -> LDL = 112.96 + 8.63*(-0.5) + 0.168*(-3) = 108 mg/dL (population SD 31).
Sex/age/BMI structure worth knowing: LDL-C and TC rise with age (women more steeply after 50: +8.6 mg/dL LDL per decade vs +5.3 in men) and plateau/decline in men after ~60; HDL is 10 mg/dL higher in women and falls ~0.7 mg/dL per BMI unit in both sexes; TG rises with BMI (about +2-3 %/BMI unit) and with age in women; SBP rises with age much faster in women (+5.3 vs +2.4 mmHg/decade) and crosses the male value at ~60; insulin/HOMA-IR/CRP/ALT/urate are dominated by BMI (insulin +5-8 %/BMI unit; CRP +7-8 %/BMI unit; urate +0.06 mg/dL/BMI unit).

### 2.4 Additional baseline generators (computed by us)

| Marker | Value | Source/method |
|---|---|---|
| HOMA-IR (fasting, non-diagnosed-diabetic adults 20-79) | M: ln = 0.712 + 0.040*(age-45)/10 + 0.082*(BMI-27), resid SD 0.615; F: ln = 0.683 + 0.000*(age-45)/10 + 0.056*(BMI-27), resid SD 0.582. GM by BMI <25 / 25-29.9 / >=30: M 1.31 / 2.07 / 4.16; F 1.36 / 2.04 / 3.81 (GSD 1.7-2.0) | NHANES P_GLU x P_INS, HOMA = FPG x INS/405; n=2875 |
| ApoB | mean 90 mg/dL (M 91.7, F 88.3), SD 25 in adults 20-79; ApoB = 11.09 + 0.587 x nonHDL-C (r=0.94, resid SD 8.4); ApoB = 19.65 + 0.627 x LDL-C (Friedewald) (r=0.89, resid SD 11.7) | NHANES 2013-14 (APOB_H, TRIGLY_H, HDL_H, TCHOL_H), n=2347 fasting adults [R60] |
| VAT and SAT by DXA (adults 20-59 only; NHANES 2017-18 DXXAG_J) | VAT volume mean (SD) cm3: M BMI<25 320 (134), 25-29.9 535 (219), >=30 758 (309); F 244 (132), 469 (175), 736 (296). SAT: M 674/1265/2152; F 1228/1957/3011. VAT/(VAT+SAT): M 0.34/0.30/0.26; F 0.16/0.19/0.20. ln(VAT) = 6.118 + 0.215*(age-40)/10 + 0.055*(BMI-27) (M, resid SD 0.30); 5.866 + 0.167*(age-40)/10 + 0.060*(BMI-27) (F, resid SD 0.43) | NHANES DXA VAT is an algorithmic *estimate*; it is systematically smaller than MRI VAT (MRI in the Magkos cohort, BMI ~40, was ~1650 cm3 [R30]). Use only for relative change; #14 owns absolute VAT. |
| Liver fat (IHTG) | Upper limit of normal 5.56 % (95th percentile of non-obese, non-diabetic, low-alcohol subjects); steatosis prevalence 33.6 % in Dallas County (n=2349, MRS) [R57]. Weight-matched non-diabetic controls in Lim 2011 had 8.5 % [R56]. | Dallas Heart Study |
| Habitual diet (defaults for the "pre-simulation" diet; needed because Mensink-type coefficients are *changes* in %energy) | NHANES 2017-2020 day-1 recall, adults 20-79, kcal>=500: SFA 11.6 (M) / 12.0 (F) %E; MUFA 12.4/12.6; PUFA 8.4/8.8; total fat 36.1/37.1; carbohydrate 45.4/46.3; protein 15.6/15.5; 12:0 0.38/0.46 %E; 14:0 0.97/1.04; 16:0 6.42/6.51; 18:0 2.80/2.81; cholesterol 365/276 mg/d; sodium 4.08/3.00 g/d (recall, excludes discretionary salt); potassium 2.93/2.34 g/d; alcohol 15.3/6.9 g/d (mean incl. abstainers); fibre 18.3/15.5 g/d; total sugars 121/94 g/d; linoleic acid 21.0/16.3 g/d; alpha-linolenic 2.17/1.75 g/d; EPA+DHA 0.11/0.08 g/d (median 0.02). Trans fat is not in the NHANES total-nutrient file (assume 0.5-1 %E UNVERIFIED). Cogswell 2012 (NHANES 2003-08): 99.4 % of US adults exceed 1.5 g Na/d, 90.7 % exceed 2.3 g/d [R58]. | our computation from P_DR1TOT, WTDRD1PP [R60] |

---------------------------------------------------------------------------------------------------

## 3. Inputs that drive it

| Input (per day, from schedule) | Unit | How it enters |
|---|---|---|
| Fatty-acid classes: SFA (optionally 12:0, 14:0, 16:0, 18:0), cis-MUFA, cis-PUFA (LA, ALA), trans | %E (change vs habitual diet) | Mensink regression coefficients (4.2) -> LDL, HDL, TG, TC, ApoB targets |
| Dietary cholesterol | mg/d (per 1000 kcal) | square-root law (4.2.5) |
| Protein (amount; plant fraction) | %E | protein-for-carbohydrate coefficients (4.2.6), soy (4.4) |
| Net carbohydrate / carbohydrate restriction state; ketone level (BHB from #05) | g/d, mM | LEM term for LDL (4.3), TG, IHTG, uric acid, insulin |
| Viscous soluble fibre, phytosterols, nuts, soy protein | g/d | portfolio components (4.4) |
| Free sugars / fructose; energy balance flag | %E; kcal vs maintenance | TG, IHTG, VAT, urate (4.5, 4.9) |
| Alcohol | g/d | TG, HDL, BP, urate (4.5, 4.6, 4.8, 4.13) |
| EPA+DHA | g/d | TG, HDL, CRP (4.5, 4.12, 4.14) |
| Sodium, potassium | g/d | BP (4.8) |
| Diet-quality composite (DASH-like) | 0..1 | BP, urate (4.8, 4.13) |
| Energy balance (% of maintenance) and body weight / fat-mass trajectory | %, kg | weight coefficients (4.7); active vs weight-stable flag |
| Aerobic exercise (kcal/wk or METs-h/wk; session length), resistance training (sets/wk), isometric work | units per week | HDL, TG, BP, IHTG, VAT, CRP (4.5-4.12) |
| BMI, sex, age, baseline sex-specific values | - | moderators; LEM term, BP-status dependent slopes |
| Ketosis state s_keto in [0,1], BHB (mM) | from #05 | LEM term, IHTG factor, urate |

---------------------------------------------------------------------------------------------------

## 4. Mechanisms & equations

### 4.1 Generic dynamics (applies to every biomarker)

```
X*(t)   = steady-state target given today's drivers (built additively for LDL/HDL/BP/FPG/urate, multiplicatively for TG/INS/CRP/ALT/IHTG)
dX/dt   = (X*(t) - X(t)) / tau_X        -> daily update: X(t+1) = X(t) + (X*(t) - X(t)) * (1 - exp(-1/tau_X))
```
Where a biomarker has several mechanisms with different speeds (e.g. TG: acute carbohydrate/energy effect vs slow fat-mass effect; BP: DASH vs sodium vs weight vs exercise) keep **one state per mechanism** (each with its own tau) and sum the states, so that reversal of one driver reverses only its own component. Hysteresis is not documented for these markers except where stated (CRP threshold, liver-fat asymmetry).
Individual variability: draw one persistent z_i per marker (SD in section 4.16) and apply `X0_i = X0(sex, age, BMI) + s*z_i`; apply a *response multiplier* m_i ~ lognormal for the heavy-tailed responses (LDL on carbohydrate restriction, BP on sodium).

### 4.2 Fatty-acid composition -> LDL-C, HDL-C, TG, TC, ApoB

**Mechanism.** Saturated fatty acids down-regulate hepatic LDL-receptor activity and raise LDL-C; cis-unsaturated fatty acids (PUFA > MUFA) up-regulate it; among SFAs the 12:0-16:0 acids raise LDL and HDL, stearic acid is neutral to LDL; industrial trans-MUFA raises LDL and ApoB and has ~zero net effect on HDL in the 2003 data set (an HDL-lowering effect from earlier single trials is UNVERIFIED here); replacing carbohydrate by any fatty acid class raises HDL and lowers fasting TG (carbohydrate-induced VLDL production). LDL-apoB residence time is short (LDL apoB FCR 0.50 +/- 0.10 pools/day in controls -> ~2 days [R51]); the multi-week time to steady state reflects hepatic regulatory adaptation, not lipoprotein turnover.

#### 4.2.1 Primary coefficient set — Mensink 2016 WHO meta-regression (R1)
Data: 74 well-controlled feeding trials, 177 diets, 2172 volunteers (65 % men; mean age 39, mean BMI 24.3; 38 male-only studies), feeding 13-91 days, trans <2 %E in all diets, mean intakes: fat 34 %E, SFA 9.8, MUFA 13.6, PUFA 8.4 %E. Model: multiple regression of the within-study change on isocaloric % energy exchanges, carbohydrate as reference (study-specific intercept as a dummy variable).

**Table 4.2-A. Change in serum lipid per 1 % of energy that replaces carbohydrate (isocaloric), mmol/L (95 % CI); mg/dL in brackets**

| Outcome | Carb -> SFA | Carb -> cis-MUFA | Carb -> cis-PUFA |
|---|---|---|---|
| Total cholesterol | +0.045 (0.038, 0.051) [+1.74] | -0.004 (-0.010, 0.001) [-0.15] | -0.022 (-0.028, -0.016) [-0.85] |
| **LDL-C** | **+0.036 (0.030, 0.043) [+1.39]** | **-0.009 (-0.014, -0.003) [-0.35]** | **-0.022 (-0.028, -0.015) [-0.85]** |
| **HDL-C** | **+0.011 (0.010, 0.013) [+0.43]** | **+0.008 (0.007, 0.010) [+0.31]** | **+0.006 (0.004, 0.008) [+0.23]** |
| **Triglyceride** | **-0.012 (-0.015, -0.008) [-1.06]** | **-0.015 (-0.018, -0.011) [-1.33]** | **-0.021 (-0.025, -0.017) [-1.86]** |
| Total:HDL ratio | -0.002 (-0.009, 0.005) | -0.029 (-0.035, -0.023) | -0.036 (-0.043, -0.029) |
| n diets/studies/subjects | 165/69/2026 (LDL) | same | same |

**Table 4.2-B. Same model, SFA as reference (change per 1 %E of SFA replaced isocalorically), mmol/L**

| Outcome | SFA -> Carb | SFA -> MUFA | SFA -> PUFA |
|---|---|---|---|
| Total cholesterol | -0.041 | -0.046 | -0.064 |
| LDL-C | -0.033 (-0.039, -0.027) | -0.042 (-0.047, -0.037) | -0.055 (-0.061, -0.050) |
| HDL-C | -0.010 | -0.002 (-0.004, 0.000) | -0.005 (-0.006, -0.003) |
| TG | +0.011 | -0.004 | -0.010 |
| Total:HDL | +0.001 | -0.027 | -0.034 |

Worked example (built into R1): replacing 5 %E SFA by PUFA lowers LDL by 5 x 0.055 = 0.275 mmol/L (10.6 mg/dL, ~9 % of 115 mg/dL). The cholesterol-*raising* effect of a mixture of SFA is about twice the cholesterol-*lowering* effect of PUFA; MUFA is equivalent to carbohydrate for TC but lowers LDL slightly.

**Table 4.2-C. Specific fatty acids (Mensink 2016 Table 3), per 1 %E replacing carbohydrate, mmol/L (91 diets, 37 studies)**

| Outcome | SFA (subset) | Oleic acid | Linoleic acid (LA) | alpha-Linolenic (ALA) |
|---|---|---|---|---|
| TC | +0.039 | -0.013 | -0.028 | -0.049 |
| LDL-C | +0.036 | -0.014 | -0.023 | -0.039 (-0.063, -0.014) |
| HDL-C | +0.010 | +0.009 | +0.005 | 0.000 (-0.006, 0.006) |
| TG | -0.012 | -0.015 | -0.021 | -0.023 |

(The third column is printed "SFA -> PUFA" in the source but is linoleic acid, as the report text states. ALA is only ~10 % of PUFA in these diets; its CI overlaps LA.)

**Baseline dependence (R1 Annex 4).** Effects are larger with higher baseline lipids: carb->SFA LDL +0.029 (below-median baseline) vs +0.041 mmol/L per %E (above median); carb->PUFA LDL -0.018 vs -0.024; TC +0.035 vs +0.050. Median baseline of the standardised fat-free diet: TC 4.45, LDL 2.89, HDL 0.97, TG 1.48 mmol/L. Implementation: scale LDL SFA/PUFA coefficients by `1 + 0.35*(LDL0 - 112)/40` clipped to [0.7, 1.4] (PROPOSED FIT to the two-subgroup data: 0.029 vs 0.041 around a mean 0.036 at LDL~ 3.4 mmol/L).

#### 4.2.2 Individual saturated fatty acids and trans fat — Mensink 2003 (R2)
Data: 60 controlled trials, 159 diets, 1672 volunteers. Coefficients are per 1 %E replacing carbohydrate; mmol/L except ApoB/ApoA-I (mg/L). Minus signs were lost in the PDF text extraction; signs below were restored from the reported confidence intervals (each CI is symmetric about its coefficient) and the paper's discussion.

| Fatty acid | LDL-C | HDL-C | TG | Total:HDL | ApoB (mg/L, 95 % CI) |
|---|---|---|---|---|---|
| Lauric 12:0 | +0.052 (0.026, 0.078) | +0.027 (0.021, 0.033) | -0.019 (-0.028, -0.011) | -0.037 (-0.057, -0.017) | +5.6 (-2.6, 13.8) NS |
| Myristic 14:0 | +0.048 (0.027, 0.069) | +0.018 (0.013, 0.023) | -0.017 (-0.027, -0.006) | -0.003 NS | +1.9 (-4.6, 8.5) NS |
| Palmitic 16:0 | +0.039 (0.027, 0.051) | +0.010 (0.007, 0.013) | -0.017 (-0.023, -0.011) | +0.005 NS | +4.2 (-0.5, 8.9) |
| Stearic 18:0 | -0.004 (-0.019, 0.011) | +0.002 (-0.001, 0.006) | -0.017 (-0.024, -0.010) | -0.013 (-0.030, 0.003) NS | -3.8 (-9.2, 1.5) NS |
| trans-MUFA | +0.040 (0.020, 0.060) | 0.000 (-0.007, 0.006) | 0.000 (-0.012, 0.012) | +0.022 (0.005, 0.038) | +5.4 (2.3, 8.5) |
| all SFA (2003 set) | +0.032 | +0.010 | -0.021 | +0.003 NS | +2.6 (-1.4, 6.5) NS |
| cis-MUFA | -0.009 | +0.008 | -0.019 | -0.026 | -4.8 (-8.1, -1.5) |
| cis-PUFA | -0.019 | +0.006 | -0.026 | -0.032 | -7.7 (-11.3, -4.2) |

(P-value row for HDL in the 2003 paper is misaligned in the source (0.841/0.418/0.390); rely on the CIs.) Note the older Mensink & Katan 1992 equation (27 trials): dLDL(mmol/L) = 0.033 carb->sat - 0.006 carb->mono - 0.014 carb->poly; dHDL = 0.012, 0.009, 0.007; dTG = -0.025, -0.022, -0.028 (R3) — the 1992, 2003 and 2016 sets agree within ~30 %.
Implementation with NHANES-like intakes: the mean-weighted SFA-class LDL coefficient (0.38 %E 12:0, 0.97 14:0, 6.4 16:0, 2.8 18:0) is 0.029 mmol/L per %E, close to the total-SFA 0.036; use per-acid coefficients only when the user specifies per-acid intake (dairy vs palm vs coconut vs beef-tallow contexts). SFA of chain length <12 (medium-chain 8:0-10:0) has no coefficient in these data: set 0 (UNVERIFIED, consistent with MCT not being LDL-raising in most trials).

**Food-matrix modifiers of SFA (Grade B).** Cheese-SFA vs butter-SFA at equal SFA (12.4-12.6 %E, 4 weeks, n=92 abdominally obese): LDL after cheese 3.3 % lower than butter; vs carbohydrate diet LDL +2.6 % (cheese) and +6.1-16.2 % (butter vs carb/MUFA/PUFA diets); the butter-cheese gap appeared only at high baseline LDL (R37b). Coconut oil (lauric-rich) raised LDL by 10.5 mg/dL (95 % CI 3.0, 17.9) and HDL by 4.0 mg/dL vs non-tropical vegetable oils (16 trials) (R37a). Implementation: multiply the SFA coefficient by 0.75 for SFA from cheese/fermented dairy (PROPOSED, from -3.3 % LDL and lower slope vs butter) — optional, low confidence.

#### 4.2.3 Cross-check: Keys / Hegsted equations (historical, do not implement as primary)
- Keys 1965 (Minnesota metabolic-ward data), as reproduced in R7: `dChol(mg/dL) = 1.2 (2 dS - dP) + 1.5 dZ`, S,P in %E, Z = sqrt(dietary cholesterol mg/1000 kcal). The cholesterol term is confirmed by the original abstract: `dChol = 1.5 (Z2 - Z1)`, r=0.95 across 19 comparisons; "250 mg/1000 kcal to zero cholesterol -> average fall ~24 mg/dL; a 50 % cut -> ~7 mg/dL" [R7]. Implied SFA slope 2.4 mg/dL TC per %E = 0.062 mmol/L per %E (Mensink 2016 total-cholesterol slope for carb->SFA is 0.045 and SFA->PUFA -0.064; Keys' SFA->PUFA swap would be -3.6 mg/dL = -0.093 mmol/L per %E, i.e. ~45 % larger). A later Keys (1984) variant for Boston data is `2.16 dS - 1.65 dP + 6.77 dC - 0.5` (C in mg/day) [R7, secondary source].
- Hegsted (1965; 1993 update): SFA raises and PUFA lowers TC, MUFA has no independent effect, dietary cholesterol raises TC (R8). The commonly quoted Hegsted form `dChol = 2.16 dS - 1.65 dP + 0.097 dC` UNVERIFIED (could not open the 1965 full text); Hegsted 1986 verified statement: over 0-400 mg/1000 kcal the response is ~linear, ~0.1 mg/dL TC per 1 mg/1000 kcal, i.e. ~4 mg/dL per 100 mg/d at 2500 kcal (R8).
- Verdict: Mensink 2016 supersedes (larger, controlled-feeding data set, LDL/HDL/TG separately, MUFA handled correctly). Keys/Hegsted overestimate PUFA/SFA effects by ~30-50 % and cannot predict HDL/TG.

#### 4.2.4 Time to new steady state
- Feeding periods in the source trials 13-91 days; Clarke 1997 metabolic-ward meta-analysis: median dietary experiment duration 1 month (R4). Mensink states no dependence on duration within the range, i.e. response is complete within the shortest trials (2-4 weeks). Individual-trial examples: Retterstoel 3-week LCHF LDL +44 % (R12), Burén 4-week (R11), Chiu 3-week SFA-vs-LSF (R37c).
- Model: tau_LDL(composition) = 7 days (95 % complete by 3 weeks, 99 % by 5 weeks) — PROPOSED, consistent with all trial durations and with the ~2-day LDL residence time [R51]; tau_HDL = 10 days; tau_TG(composition) = 4 days (TG responds faster, see 4.5); ApoB same as LDL.
- Reversal is symmetric (same tau) — LDL returned to baseline within weeks in case series after carbohydrate re-introduction (R10, case series) UNVERIFIED for exact time.

#### 4.2.5 Dietary cholesterol
- Clarke 1997 (395 metabolic-ward experiments, median 1 month): avoiding 200 mg/day dietary cholesterol lowers TC by 0.13 (SE 0.02) and LDL-C by 0.10 (0.02) mmol/L (R4). Weggemans 2001 (17 trials, 556 subjects, >=14 d): +100 mg/d raises TC by 0.056 mmol/L (2.2 mg/dL) (95 % CI 0.046-0.065), HDL by 0.008 mmol/L, TC:HDL ratio by 0.020 (R5). Berger 2015 (19 trials, 632 subjects): net TC +11.2 mg/dL (6.4-15.9), LDL +6.7 mg/dL (1.7-11.7), HDL +3.2 mg/dL; LDL response no longer significant above 900 mg/d; TG/VLDL unchanged (R6).
- Implementation (saturating, `PROPOSED FIT` to Keys' square-root law + the three meta-analytic points): `dTC(mg/dL) = 1.5*(sqrt(chol_new*1000/kcal_new) - sqrt(chol_base*1000/kcal_base))`, `dLDL = 0.77*dTC`, `dHDL = 0.14*dTC` (Clarke LDL/TC = 0.10/0.13; Weggemans HDL/TC = 0.008/0.056). Check: 300 -> 500 mg/d at 2000 kcal gives dTC = +5.3 mg/dL = 0.14 mmol/L, vs Clarke 0.13 per 200 mg and Weggemans 0.11. Cap the effect above 900 mg/d.
- Heterogeneity ("hyper-/hypo-responders"): SD of response to a 500 mg/d change over 3 weeks was 0.35-0.42 mmol/L (14-16 mg/dL) around a mean fall of 0.16-0.31 mmol/L (6-12 mg/dL) in 34 healthy adults; individual responses ranged -1.0 to +0.5 mmol/L; response correlation between two trials 6 years apart r = 0.32 (P<0.05) i.e. part is a stable trait; hypo-responders had higher BMI and lower HDL2; responsiveness negatively correlated with habitual cholesterol intake (r=-0.62) and BMI (r=-0.50) (R9). Model: individual response multiplier m_chol_i ~ lognormal(mean 1, CV 1.0) truncated [0, 3] (UNVERIFIED shape; SD taken from the SD/mean of R9, reduced by the reproducibility r=0.32).

#### 4.2.6 Protein and other macronutrient exchanges (OmniHeart)
OmniHeart (R59; 164 adults with prehypertension/stage-1 hypertension, 3 x 6-week feeding periods, weight constant, all diets low in SFA ~6 %E): vs the carbohydrate diet, the protein-rich diet (protein 15 -> 25 %E, half plant) changed LDL -3.3 mg/dL (-0.09 mmol/L), HDL -1.3 mg/dL, TG -15.7 mg/dL, SBP -1.4 mmHg (-3.5 in hypertensives); the unsaturated-fat (mainly MUFA) diet (carbohydrate -10 %E) changed LDL 0 (NS), HDL +1.1, TG -9.6, SBP -1.3 (-2.9 in hypertensives). Per 1 %E (protein replacing carbohydrate): LDL -0.0085, HDL -0.0034, TG -0.0177 mmol/L, SBP -0.14 mmHg. Use as the protein coefficients; plant-vs-animal protein effects are otherwise unquantified here (see soy, 4.4). Grade B (single large trial; consistent with Mensink for MUFA).

#### 4.2.7 ApoB
Mensink 2003 gave direct ApoB coefficients only for the 2003 data set (table above; SFA +2.6 mg/L NS, cis-MUFA -4.8, cis-PUFA -7.7 per %E i.e. ~ +0.26, -0.48, -0.77 mg/dL) — small and imprecise. SFA raises LDL-C (larger, cholesterol-enriched LDL) more than ApoB; Chiu 2017 (n=53, LDL phenotype B, 3 weeks, SFA 8 -> 18 %E, carbohydrate 55 -> 39 %E): LDL-C +16.7 % vs -8.7 % (low-SFA arm), ApoB +9.5 % vs -6.8 %, small LDL particles +6.1 % vs -20.8 % (R37c). Implementation: `dApoB = 0.587*dNonHDL` with `dNonHDL = dLDL + dTG/5` (NHANES relation, R60), then optionally shrink SFA-driven ApoB by 0.6 (PROPOSED from Chiu: +9.5 % ApoB for +16.7 % LDL-C; ratio 0.57). Grade B.

#### 4.2.8 Parameter summary (composition -> lipids)
| Symbol | Value | Unit | Uncertainty | Source |
|---|---|---|---|---|
| c_S,LDL / c_M,LDL / c_P,LDL | +0.036 / -0.009 / -0.022 | mmol/L per %E vs carbohydrate | CI in 4.2-A | R1 |
| c_S,HDL / c_M,HDL / c_P,HDL | +0.011 / +0.008 / +0.006 | mmol/L per %E | CI in 4.2-A | R1 |
| c_S,TG / c_M,TG / c_P,TG | -0.012 / -0.015 / -0.021 | mmol/L per %E | CI in 4.2-A | R1 |
| 12:0, 14:0, 16:0, 18:0 LDL | +0.052, +0.048, +0.039, -0.004 | mmol/L per %E | CIs 4.2.2 | R2 |
| trans LDL, HDL, TG | +0.040, 0.000, 0.000 | mmol/L per %E | CIs 4.2.2 | R2 |
| ALA LDL | -0.039 | mmol/L per %E | CI -0.063..-0.014 | R1 Table 3 |
| cholesterol | 1.5*(sqrt z2 - sqrt z1) mg/dL TC | z = mg/1000 kcal | SD of response 14-16 mg/dL | R4,R5,R7,R9 |
| protein (vs carb) LDL, HDL, TG, SBP | -0.0085, -0.0034 mmol/L, -0.0177 mmol/L, -0.14 mmHg per %E | - | single trial | R59 |
| tau_LDL, tau_HDL, tau_TG(comp) | 7, 10, 4 | days | PROPOSED | see 4.2.4 |

**Moderators.** Baseline lipid level (Annex 4); habitual cholesterol intake and BMI for cholesterol response; sex/age: mean age 39, 65 % men (few older women) — extrapolation to post-menopausal women is uncertain (the LDL-raising effect of SFA is not known to differ by sex in this dataset UNVERIFIED); ApoE genotype modifies responses (E4 higher) UNVERIFIED.
**Evidence grade: A** for LDL, HDL, TG effects of SFA/MUFA/PUFA/carbohydrate exchange (meta-regression of 74 controlled-feeding trials, 177 diets, three generations of the analysis concordant); **A/B** for individual SFAs and trans; **B** for ApoB; **B/C** for protein and food-matrix modifiers.


### 4.3 Very-low-carbohydrate / high-fat diets and LDL-C: the mean effect, the heavy tail, and the "lean mass hyper-responder" (LMHR)

**Mechanism (what is established vs hypothesis).**
Established: (i) carbohydrate restriction with high fat intake raises LDL-C *on average* by a small amount in trials dominated by people with obesity who are simultaneously losing weight; (ii) the between-person spread is very large; (iii) in *lean*, insulin-sensitive people a few weeks of ketogenic eating can raise LDL-C by 50-250 mg/dL, with high HDL-C and low TG; (iv) response is inversely related to BMI.
Hypothesis (not proven in controlled trials): the "Lipid Energy Model" (LEM) — in lean people with little adipose to draw on, hepatic VLDL/LDL secretion carries more of the fat that is being oxidised as fuel, so LDL-C rises while TG falls; overfeeding on the same diet is predicted to *lower* LDL-C (R13). Saturated-fat intake alone does not explain the LMHR magnitude (Mensink predicts ~+0.5 mmol/L (about +18 mg/dL) for a switch from 12 to 25 %E SFA before MUFA/PUFA offsets, vs observed +35 to +170 mg/dL).

**Data (all verified).**
| Study | Population | Diet / duration | LDL-C result |
|---|---|---|---|
| Bueno 2013, 13 RCTs, n=1255 for LDL (R15) | mostly obese adults | VLCKD (<=50 g carb) vs low-fat, >=12 months | LDL-C +0.12 mmol/L (95 % CI 0.04, 0.20) (+4.6 mg/dL) vs low-fat; TG -0.18; HDL +0.09; DBP -1.4 |
| Mansoor 2016, 11 RCTs, 1369 pts (R16) | previously healthy, >=20 per arm | carb <20 %E vs low-fat, >=6 months | LDL-C +0.16 mmol/L (0.003, 0.33) (+6 mg/dL); HDL +0.14; TG -0.26; weight -2.2 kg |
| Hu 2012, 23 RCTs, 2788 pts (R17) | | carb <=45 %E vs fat <=30 %E | LDL-C: low-carb reduced LDL 3.7 mg/dL *less* than low-fat (95 % CI 1.0-6.4); HDL +3.3 mg/dL; TG -14.0 mg/dL |
| Chawla 2020, 38 RCTs, 6499 pts (R18) | | 6-12 months | LDL +0.07 mmol/L (0.02, 0.12) vs low-fat; TG -0.10; HDL +0.05; weight -1.3 kg |
| Ge 2020 network MA, 121 RCTs, 21,942 pts (R19) | overweight/obese | 6 months | LDL change vs usual diet: low-carb -1.0 mg/dL (low certainty), low-fat -7.1, moderate -5.2; HDL +2.3 vs -1.9 (low-fat) |
| Retterstoel 2018 (R12) | 30 normal-weight young adults, parallel RCT | <20 g carb/d LCHF, 3 weeks | LDL-C 2.2 +/- 0.4 -> 3.1 +/- 0.8 mmol/L (+44 % vs control), ApoB, TC, HDL, uric acid up; individual increase 5 to 107 %; no change in weight/BP/CRP |
| Buren 2021 (R11) | 17 healthy normal-weight young women, crossover feeding | ketogenic 4 % carb / 77 % fat / 19 % protein vs 44/33/19, 4 weeks | LDL-C treatment effect +1.82 mmol/L (+70 mg/dL), increased in every participant; ApoB, small-dense and large-buoyant LDL all up; weight -3 kg (LCHF) vs -1 kg |
| Norwitz 2022 (R10) | web survey n=548 on carbohydrate-restricted diets (mean 27 g carb/d, BMI 24.1 +/- 4.0, mean interval between lipid tests 724 d; strongly self-selected) | - | LDL-C 145 +/- 59 -> 236 +/- 107 mg/dL; change mean +91, SD 103, median +72, P5 -29, P95 +302; dHDL +13, dTG -26. LMHR (LDL>=200, HDL>=80, TG<=70; n=100, 18 %): BMI 22.0 vs 24.6, LDL 320 +/- 115, dLDL median +146 vs +61; prior LDL identical (148 vs 145). Regression: BMI beta = -5.9 mg/dL per BMI unit (model 3: dLDL = 242.5 - 4.5*(prior TG/HDL) - 5.9*BMI); low prior TG/HDL predicts larger rise |
| Budoff 2024 KETO-CTA (R14) | 80 LMHR-like adults, mean 4.7 y on keto, mean LDL 272 (max 591) | - | coronary plaque burden not different from matched controls with LDL 123 (no LDL-plaque correlation) — *not* evidence of safety (cross-sectional, self-selected, low power, no hard events) |
| Petersen 2026 (R24) | 42 adults, BMI 38.9, prediabetes + steatosis, all food provided, ~10.5 % weight loss (-11.4 to -11.9 kg) | very-low-carbohydrate ketogenic (23 %E SFA) vs Mediterranean vs very-low-fat, weight-stable measurement | LDL-C -10 / -22 / -8 mg/dL; ApoB -6 / -15 / -9; no difference among diets (P=0.44 LDL) — i.e. **no LDL rise on a keto diet in BMI 39 during matched weight loss** |
| Feldman 2022 (R13) | n=1 x2 plus case series of 24 | 5-day ketogenic diets at 1135, 2278, 4116 kcal/d | LDL-C and ApoB rose with caloric restriction and fell with overfeeding despite more SFA (LEM prediction); Grade D |
| Krauss 2006 (R65) | 178 overweight men (BMI 29.2) | carb 54/39/26 %E; weight loss 5.1 kg | carbohydrate restriction improves atherogenic dyslipidaemia (TG, ApoB, small LDL) but benefits vanish after weight loss; LDL-C fell less with 15 %E SFA due to large-LDL rise |

**Equation (PROPOSED FIT).** LDL target = Mensink composition term (4.2) + weight term (4.7) + LEM term:
```
LEM_term (mg/dL) = s_keto * m_i * max(0, A_LEM - b_LEM*(BMI - 22)) * E_mod
   A_LEM = 45 mg/dL at BMI 22        b_LEM = 4.5 mg/dL per BMI unit  (=> zero at BMI 32.2)
   s_keto in [0,1] = ketosis state from #05 (BHB >= ~0.5 mM saturating to 1 at >= 1.5 mM)  (PROPOSED)
   m_i  ~ lognormal(mu=0, sigma=0.6) (individual multiplier; P(m>2)=12 %)
   E_mod = clip(1 - 2*(EI/EE - 1), 0, 1.5)   -> deficits raise, surpluses lower LDL (LEM prediction; grade D, optional switch)
```
Fit points: Burén BMI ~22: total +70 mg/dL, of which Mensink composition ~+25 (assuming SFA 12 -> ~30 %E; the SFA share of that diet is UNVERIFIED) => LEM ~45; Norwitz mean +91 at BMI 24.1 with beta_BMI = -4.5..-5.9; Retterstoel +35 mg/dL mean in normal-weight adults (LEM ~10-15, smaller); trials in obese populations +5 mg/dL vs low-fat at >=6 months (R15-R18); Petersen BMI 39: -10. The A_LEM=45 is the middle of these (range 10-65). Population mean over a BMI 18-40 mix is +5 to +20 mg/dL as in the meta-analyses; the tail is what the LEM term adds.
Also show the user the Norwitz regression as a cross-check: `dLDL ~ 242 - 4.5*(TG/HDL_prior) - 5.9*BMI` (mg/dL; only for people already choosing carbohydrate restriction; strongly selected sample; extrapolates to ~0 near BMI 38).
- Time: LDL rises within 1-3 weeks (Retterstoel 3 wk; Buren 4 wk; LEM case data within 5 days) -> tau_LEM = 10 days (PROPOSED); falls after carbohydrate re-introduction over weeks (case series, R10) UNVERIFIED.
- Moderators: BMI (strong, inverse), TG/HDL ratio (low = larger rise), sex (LMHR more often female in the survey, 61 % male among non-LMHR vs 45 % LMHR), habitual leanness/high training volume (endurance athletes on 10 %E carbohydrate had LDL 161 vs 88 mg/dL on 57 %E in a cross-sectional comparison of 20 runners, as cited in R10), SFA intake (additive Mensink term), energy balance (LEM; unproven).
- **Evidence grade.** Mean effect in mixed/obese populations: **A** (5 meta-analyses concordant, +0.07 to +0.16 mmol/L vs low-fat). Existence of large LDL-C rises in lean people on carbohydrate restriction: **B** (two small controlled feeding/randomised trials, R11 and R12, plus large observational data). Magnitude vs BMI equation and LEM mechanism: **C/D** (self-selected survey; n=1 experiment). Clinical significance of LMHR LDL (atherogenicity, ApoB-mediated): **unresolved**; the ApoB mendelian-randomisation evidence (R43b: risk proportional to ApoB) argues that particle number matters more than the diet that produced it, while KETO-CTA (R14) is reassuring only at low power.

### 4.4 Portfolio components: viscous fibre, plant sterols, soy protein, nuts

Mechanism: viscous fibres bind bile acids (raise bile-acid synthesis, deplete hepatic cholesterol, up-regulate LDL-R); sterols/stanols block intestinal cholesterol absorption (micellar displacement); nuts/soy replace SFA and add fibre/sterols. Effects are on LDL-C and non-HDL/ApoB, not on HDL or TG (except nuts/soy small TG effects).

**Table 4.4-A. Verified dose-responses**
| Component | Dose | LDL-C effect (95 % CI) | Duration / population | Ref |
|---|---|---|---|---|
| Soluble fibre (pectin, oat bran, guar, psyllium; 67 trials) | 2-10 g/d | -0.057 mmol/L per g (-0.070, -0.044) [-2.2 mg/dL per g]; TC -0.045 mmol/L per g; TG, HDL unchanged; independent of design/duration/baseline fat | mixed | R27 |
| Oat beta-glucan (28 RCTs) | >=3 g/d (3.0-12.4 g/d) | LDL -0.25 mmol/L (-0.30, -0.20); TC -0.30; **no dose dependence** across 3-12 g/d, duration 2-12 wk; greater at higher baseline LDL; greater in diabetes | | R28 |
| Barley beta-glucan (14 RCTs, n=615) | median 6.5 g/d, 4 weeks | LDL -0.25 mmol/L (-0.30, -0.20); non-HDL -0.31; ApoB no change | | R28b |
| Psyllium (28 RCTs, n=1924) | median ~10.2 g/d (>=3 wk) | LDL -0.33 mmol/L (-0.38, -0.27); non-HDL -0.39; ApoB -0.05 g/L (5 mg/dL) | with or without hypercholesterolaemia | R29 |
| Psyllium (8 RCTs, hypercholesterolaemic on low-fat diet) | 10.2 g/d, >=8 wk | TC -4 %, LDL -7 %, ApoB/ApoA-I -6 %; HDL, TG unchanged | | R27b |
| Viscous vs cereal (non-viscous) fibre (89 trials, n=4755) | - | LDL -0.26 mmol/L (-0.30, -0.22); non-HDL -0.33; ApoB -0.04 g/L | | R29b |
| Konjac glucomannan (12 studies, n=370) | ~3 g/d | LDL -0.35 mmol/L (-0.46, -0.25) (~-10 %); non-HDL -0.32; ApoB none | | R29c |
| Plant sterols/stanols (124 studies, 201 strata) | 0.6 / 1.1 / 1.7 / 2.1 / 2.6 / 3.3 g/d | -5.7 / -6.4 / -7.6 / -8.4 / -10.3 / -12.4 % (all with 95 % CI excluding 0); sterols and stanols equal; effect plateaus ~3 g/d (avg 12 %) | | R31 |
| Plant sterols, continuous fit (84 trials) | mean 2.15 g/d | -0.34 mmol/L (-8.8 %); saturating (2-parameter) curve; larger absolute drop at higher baseline LDL | | R31b |
| Soy protein (38 controlled trials) | ~47 g/d | TC -23.2 mg/dL (9.3 %), LDL -21.7 mg/dL (12.9 %), TG -13.3 mg/dL; HDL +2.4 % NS; effect proportional to baseline cholesterol (older, hypercholesterolaemic populations) | | R32b |
| Soya products (35 studies, 4 wk-1 y) | typical intakes | LDL -4.8 mg/dL (-7.3, -2.3); TG -4.9; HDL +1.4; whole-soy foods -11.1 mg/dL vs extracts -3.2 mg/dL; hypercholesterolaemic -7.5 vs healthy -3.0 mg/dL; isoflavone supplements no effect | | R32 |
| Tree nuts (61 trials, n=2582, 3-26 wk) | per 28.4 g serving/d | LDL -4.8 mg/dL (-5.5, -4.2); TC -4.7; ApoB -3.7 (-5.2, -2.3); TG -2.2; **non-linear, stronger >=60 g/d**; nut type irrelevant | | R33 |
| Nuts (25 trials, individual data, n=583) | 67 g/d | TC -10.9 mg/dL (5.1 %), LDL -10.2 mg/dL (7.4 %); TG -20.6 mg/dL only if baseline TG >=150; larger with high LDL, **low BMI**, Western diet | | R33b |
| Portfolio pattern (7 trials, 439 pts; on NCEP Step II background) | sterols 1.0 g/1000 kcal, soy 21.4 g/1000 kcal, viscous fibre 9.8 g/1000 kcal, almonds 14 g/1000 kcal | LDL -0.73 mmol/L (-0.89, -0.56) ~ **-17 %**; also lowered non-HDL-C, ApoB, TC, TG, SBP/DBP, CRP and estimated 10-y CHD risk; no effect on HDL-C or body weight | >=3 weeks | R34 |
| Portfolio RCT (outpatient, 1 month, n=46, hyperlipidaemic, mean age 59, BMI 27.6) | same components | LDL -28.6 % (vs -8.0 % control; -30.9 % lovastatin 20 mg); CRP -28.2 % (statin -33.3 %); no difference dietary portfolio vs statin | 4 weeks | R34b |

**Implementation (PROPOSED FIT, saturating, relative to baseline LDL, applied on top of the composition term).**
```
viscous fibre:  dLDL_vf (mmol/L) = -Emax_f * d/(d + D50_f),  d = extra viscous-fibre g/d
      data (LDL mmol/L): 3 g oat BG -0.25; 6.5 g barley BG -0.25; 10.2 g psyllium -0.33; 3 g glucomannan -0.35; soluble fibre linear -0.057/g at 2-10 g (R27)
      choose Emax_f = 0.45 mmol/L, D50_f = 2.5 g/d  ->  d=3: -0.245 ; 6.5: -0.325 ; 10.2: -0.36     (inside the CIs of the oat, psyllium and glucomannan points and 0.025 mmol/L beyond the barley CI; it overestimates the linear low-dose slope of Brown 1999 below ~2 g/d (-0.11 vs -0.20 mmol/L at 2 g); do not extrapolate past ~15 g/d)
      scale by (LDL0/115)^1 (Whitehead, Demonty: larger absolute effect at higher baseline)
phytosterol:    dLDL_ps (%) = -Emax_s * d/(d + D50_s), Emax_s = 20 %, D50_s = 2.5 g/d -> 0.6: -3.9 ; 1.1: -6.1 ; 1.7: -8.1 ; 2.1: -9.1 ; 2.6: -10.2 ; 3.3: -11.4 %   (vs observed -5.7, -6.4, -7.6, -8.4, -10.3, -12.4; max error 1.8 points at 0.6 g/d)
nuts:           dLDL_nut (mg/dL) = -4.8*n for n = servings (28.4 g)/d, n<=2; for 2<n<=3 use -5.5 per serving (non-linear, stronger >=60 g/d); cap at 3 servings; scale by (LDL0/115)
soy protein:    dLDL_soy (mg/dL) = -0.10*(g soy protein/d) capped at -8 mg/dL for healthy normolipidaemic people (Tokede whole-soy -11; healthy -3.0; Anderson 47 g -21.7 in hypercholesterolaemic 1995 data -> shrink) (PROPOSED, grade B/C)
combination:    sub-additive: total_nonComposition = 1 - prod(1 - f_i) with fractions f_i = |d_i|/LDL0; portfolio benchmark: all four together ~ -17 % on NCEP background (R34), up to -28.6 % in the small 1-month trial (R34b).
```
- Time: LDL responses appear within 2-4 weeks (trials 2-12 wk; Whitehead found no duration dependence across 2-12 wk): tau = 10 days (fibre, sterols, nuts) — PROPOSED.
- Moderators: baseline LDL (positive), BMI (nut effect larger at low BMI, R33b), diabetes (larger beta-glucan and ApoB effects), background SFA (portfolio tested on low-SFA background: Step II).
- Inter-individual: SD not reported in abstracts; between-study I2 high (Tokede 92-99 %). Assume response SD = 40 % of mean (UNVERIFIED).
- **Evidence grade: A** for viscous fibre, phytosterols, nuts (multiple large dose-response meta-analyses); **B** for soy (small effect, heterogeneous) and for the portfolio combination (7 trials + 1 well-known 1-month RCT).

### 4.5 Triglycerides

**Mechanism.** Fasting TG = hepatic VLDL-TG secretion (driven by DNL from carbohydrate, FFA flux from adipose, alcohol) minus lipoprotein-lipase clearance (insulin-sensitive; ApoC-III inhibits). Carbohydrate-for-fat exchange raises TG through DNL/VLDL; alcohol raises hepatic VLDL output; fructose in energy excess drives DNL; n-3 (EPA+DHA) reduces VLDL secretion and increases clearance; weight loss lowers hepatic fat and VLDL output; exercise raises lipoprotein lipase; extreme carbohydrate restriction abolishes DNL within days.

**Components (each with own state, log-additive on TG):**
1. *Fatty-acid-for-carbohydrate exchange (isocaloric)*: relative coefficient = Mensink 2016 TG coefficient / 1.2 mmol/L (mean TG in the data): SFA -1.0 %, MUFA -1.25 %, PUFA -1.75 % per 1 %E vs carbohydrate (ALA -1.9 %). Effect only slightly larger at higher baseline (R1 Annex 4: SFA -0.011 vs -0.013; PUFA -0.020 vs -0.022 mmol/L per %E, below/above median). `ln TG* += c_rel * dE`. Range of validity: fat 4.5-53 %E.
2. *Protein for carbohydrate*: -0.0177 mmol/L per %E (~ -1.7 %/%E at TG 106) (R59).
3. *Free sugar / fructose (energy-dependent)*: isocaloric substitution of fructose for other carbohydrate: no effect on TG in 51 trials (n=943) (R35b); hypercaloric fructose supplementation (+21-35 %E, 8 trials, n=125): TG +0.26 mmol/L (0.11, 0.41) (+23 mg/dL), ApoB +0.18 mmol/L (R35b); higher vs lower free-sugar diets (37 trials): TG +0.11 mmol/L (0.07, 0.15), LDL +0.12, TC +0.16, HDL +0.02 — largest in energy-balanced studies without weight change (R35); fructose (25 %E for 10 weeks, overfeeding, overweight/obese) raised DNL, post-prandial TG AUC, fasting ApoB and LDL, decreased insulin sensitivity, and increased VAT; glucose-sweetened arm raised fasting TG ~10 % but not ApoB/LDL (R35c); 1 L/d sucrose-sweetened cola for 6 months raised TG +32 %, TC +11 %, liver fat +132-143 % vs milk/diet cola/water (R35d). **Equation (PROPOSED):** `dTG_sugar (mmol/L) = 0.26 * min(1, fructose_or_sugar_excess_%E/28) * 1[energy surplus]  +  0.006 * max(0, free_sugars_%E - 10) * 1[energy-balanced]`, decayed with tau_TG(comp); the second term is a compromise (Te Morenga 0.11 mmol/L for a typical high-vs-low difference of ~15-20 %E; Chiavaroli isocaloric-fructose null) and is Grade C.
4. *Alcohol*: 30 g ethanol/d raised TG by 5.7 mg/dL (2.5-8.9) and HDL by 4.0 mg/dL (3.3-4.7) in 42 experimental studies (1-9 weeks; up to 100 g/d) (R36). `dTG (mg/dL) = 0.19*g_alcohol` up to 60 g/d; above that hepatic VLDL overproduction escalates non-linearly (UNVERIFIED; clinical experience/AHA statements).
5. *Omega-3 (EPA+DHA), g/d*: dose-response meta-regression of 90 RCTs (72,598 participants; median 13 weeks; spline): TG **-19.2 (95 % CI -32.0 to -6.4) mg/dL at 1 g/d, -42.6 (-53.4 to -31.8) at 2 g/d, -68.9 (-98.4 to -39.4) at 3 g/d**; approximately linear above 2 g/d, steeper in hyperlipidaemia (-23/-50/-81 mg/dL) and overweight/obesity, plateau ~-40 mg/dL in people without hyperlipidaemia; EPA and DHA equally effective; HDL +3.5 mg/dL at ~1.75 g/d, LDL-C +2.9 mg/dL J-shaped (peak ~1.75 g/d) (R38e). Other anchors: 0.85 g/d no effect vs 3.4 g/d -27 % (TG 237 -> 173 mg/dL, n=26, 8 weeks; R38b); 47 studies, 3.25 g/d: TG -0.34 mmol/L (-30 mg/dL), reduction correlated with dose and baseline TG, LDL +0.06 mmol/L (R38d); 21 trials fish oil: TG -27 mg/dL (-33, -20), HDL +1.6, LDL +6 (R38c); AHA 2019: >=30 % TG reduction with 4 g/d in TG >=500 mg/dL, LDL rises with EPA+DHA in very high TG but not with EPA-only (R38). **Equation (PROPOSED FIT):** `dTG% = -0.09 * max(0, d - 0.5) * (TG0/200)^0.4`, capped at -40 %, d = EPA+DHA g/d (d=3.4 -> -26 % at TG0 200; d=2 -> -13.5 %; d=4 -> -31 %); fit points: Skulas-Ray 0.85 g ~ 0 (-3 % predicted), 3.4 g -27 %, AHA 4 g >= -30 %; Wang 2023 spline (-43 mg/dL at 2 g for mean TG ~200, i.e. -21 %) is ~50 % steeper than this fit at 2 g/d — choose 0.09 (conservative) or 0.12/g (Wang-like) via a "high estimate" toggle. Also EPA+DHA changes: HDL +1.5 mg/dL per 2 g/d; LDL +3 mg/dL per 2 g/d (small).
6. *Weight change (fat mass)*: see 4.7: `d ln TG = -0.015 per kg lost` (BMI 25-30), -0.020 per kg (BMI >=30), PROPOSED from Magkos (TG 153 -> 130 -> 110 -> 97 mg/dL at -5/-11/-16 % weight, i.e. -15/-28/-37 % ≈ -2.1 %/kg in BMI 40 subjects; R30), Zomer (-0.13 mmol/L over 6-12 months, R40), Look AHEAD (median -12 mg/dL for -4.8 kg, R42).
7. *Acute carbohydrate / energy restriction (days)*: TG halved within week 1 of a 600 kcal/day diet (2.4 -> 1.2 mmol/L; -3.9 kg in week 1; R56); isocaloric <30 g carbohydrate (3115 kcal/d) reduced plasma TG by 48 % and VLDL-TG by 57 % over 14 days (DNL -80 %) (R53c); at matched 10.5 % weight loss fasting TG -45 % (keto) vs -24 % (Mediterranean) vs -14 % (very-low-fat), 24-h TG -23/-23/-17 % (R24). Model this as an extra multiplier for the very-low-carbohydrate (ketotic) state, `exp(-0.35 * s_keto)` on TG, with tau = 4 days (PROPOSED FIT: exp(-0.35) = 0.70 combined with the weight-loss term reproduces -45 % keto vs -14 to -24 % non-keto at equal 10.5 % weight loss, and the isocaloric -48 % result of Mardinoglu). Grade B.
8. *Exercise*: aerobic training -0.08 mmol/L (-7 mg/dL) TG (0.02-0.14), LDL -0.10, HDL +0.05 mmol/L (31 trials, >=4 weeks) (R44b); progressive resistance training TG -8.1 mg/dL (-14.5, -1.8), LDL -6.1, non-HDL -8.7, HDL +0.7 NS (29 trials, n=1329) (R44c); diet alone/diet+exercise beat exercise alone for LDL; exercise alone reduced TG only (R44d). Acute post-exercise lowering (hours-days) is real but not simulated (see 4.6 for STRRIDE detraining: 15 days of inactivity raised LDL, small-LDL; moderate-intensity training sustained VLDL-TG lowering for 15 days; R44e). Model: `d ln TG_ex = -0.06 * min(1, METs-h_week/15)` (PROPOSED; 6 % ~ 7 mg/dL at TG 110), tau = 21 days.
9. *Sodium (very low)*: Cochrane 2017: reducing sodium from 201 to 66 mmol/d raised TG +7.0 mg/dL (+6.3 %) and cholesterol +5.6 mg/dL (2.9 %) (R45c); He 2013 found no significant change in lipids (TC +0.05 mmol/L NS; R45b) — contested; **omit by default**, optional toggle.

**Time dynamics.** tau_TG(composition, carbohydrate/energy/alcohol/sugar) = 4 days (TG halves within 1 week of VLCD, changes significant within days of carbohydrate restriction; PROPOSED); tau_TG(weight/fat-mass) = 30-45 days; tau_TG(omega-3) = 14 days (UNVERIFIED — trial durations 4-26 weeks; TG effect generally established by 2-4 weeks); tau_TG(exercise) = 21 days. Reverts on refeeding with the same taus (carbohydrate-induced hypertriglyceridaemia builds within days).
**Moderators.** Baseline TG (proportional n-3 and weight effects; log scale), BMI/insulin resistance (n-3 effect stronger in higher BMI), sex (women lower TG; no dose-response difference documented), alcohol status, PNPLA3 genotype (carbohydrate-overfeeding DNL in II vs MM carriers, R54d).
**Evidence grade.** Fat-for-carbohydrate exchange: A. n-3 dose-response: A (mean) / B (shape below 1 g/d and in normolipidaemia). Sugar/fructose: A for "no effect isocaloric; effect only when hypercaloric" (R35b), B/C for compromise coefficients. Alcohol: A for +5.7 mg/dL per 30 g/d (moderate range), C beyond. Weight loss per kg: B. Exercise: B. Acute keto TG multiplier: B/C.

### 4.6 HDL-C: responses, and why it is a weak causal target

**Responses (per unit driver; steady state):**
| Driver | dHDL-C | Source |
|---|---|---|
| 1 %E carbohydrate -> SFA / MUFA / PUFA | +0.43 / +0.31 / +0.23 mg/dL (+0.011 / +0.008 / +0.006 mmol/L) | R1 |
| 1 %E carbohydrate -> 12:0 / 14:0 / 16:0 / 18:0 / trans | +1.04 / +0.70 / +0.39 / +0.08 (NS) / 0.0 mg/dL | R2 |
| Protein for carbohydrate | -0.13 mg/dL per %E (-1.3 mg/dL for 10 %E) | R59 |
| Alcohol 30 g/d | +3.99 mg/dL (3.25, 4.73); ApoA-I +8.8 mg/dL | R36 |
| Aerobic training (>=4 wk) | +0.05 mmol/L (+1.9 mg/dL) [Halbert]; +2.53 mg/dL (P<0.001) [Kodama, 25 trials]; minimal volume ~900 kcal/wk (120 min/wk); +1.4 mg/dL per +10 min per session; larger if BMI <28 and TC >=220 (extra +2.1 mg/dL); intensity/frequency not significant | R44, R44b |
| Resistance training | +0.7 mg/dL NS | R44c |
| Weight loss | -0.007 mmol/L (-0.27 mg/dL) per kg while *actively* losing; **+0.009 mmol/L (+0.35 mg/dL) per kg lost once weight-stable** (70 studies) | R39 |
| EPA+DHA | +1.6 mg/dL (fish oil, 21 trials); +3.5 mg/dL at ~1.75 g/d (spline) | R38c, R38e |
| Low-carbohydrate vs low-fat (>=6-12 months) | +3.3 mg/dL (Hu); +0.09 mmol/L (Bueno); +0.14 mmol/L (Mansoor); +0.05 mmol/L (Chawla); DIETFITS +2.6 vs +0.4 mg/dL; keto weight-loss arm +2 vs -2/-4 mg/dL (Petersen) | R15-R18, R20, R24 |
| Dietary cholesterol +100 mg/d | +0.008 mmol/L (+0.3 mg/dL) | R5 |
| Soy | +1.4 mg/dL | R32 |
| Inactivity (15 days no training in trained subjects) | LDL, LDL particle number and small-dense LDL up; HDL gains of the high-volume group persisted 15 days | R44e |
Baseline effect of BMI: HDL falls 0.70 mg/dL per BMI unit cross-sectionally (Table B3), consistent with +0.35 mg/dL/kg (=+1.1 mg/dL per BMI unit) reported after stable weight loss in trials.
- Time: tau_HDL = 10 days (diet), 30 days (exercise), weight-stable component builds over ~4-8 weeks after stabilisation (PROPOSED; Dattilo separates active vs stable, no kinetics).
- **Why HDL-C is a weak causal target.** Mendelian randomisation: the endothelial-lipase LIPG Asn396Ser variant raised HDL-C by 0.14 mmol/L (predicted MI OR 0.87) yet was not associated with MI (OR 0.99, 0.88-1.11); a 14-SNP HDL-only genetic score raising HDL-C by 1 SD was not associated with MI (OR 0.93, 0.68-1.26) whereas the LDL-C score gave OR 2.13 (1.69-2.69) per SD, concordant with observational epidemiology (R43). ApoB-MR (654,783 subjects): risk per 10 mg/dL lower ApoB-containing lipoproteins is the same whether via LPL (TG-lowering) or LDLR (LDL-lowering) variants (OR 0.77 both); after adjusting for ApoB, TG and LDL-C lose association (R43b). The observational HDL-C association therefore appears to be at least partly non-causal (plausibly confounded by insulin sensitivity, TG, BMI and alcohol). Implementation consequence: **do not offer "raise HDL" as a planner goal**; show HDL-C and TC:HDL as descriptive metrics with low weight; give the planner/UI "ApoB" and "non-HDL-C" as the lipid goal metrics.
- **Evidence grade.** Responses: A (Mensink, Rimm, Kodama, Dattilo); causality argument: B (mendelian randomisation, two independent instruments; concordance with HDL-raising drug trials is UNVERIFIED and not cited here).


### 4.7 Weight-loss (and weight-gain) coefficients for every biomarker, active loss vs weight-stable

**Mechanism.** Loss of adipose mass (and especially ectopic fat: liver, visceral) improves insulin sensitivity, lowers hepatic VLDL output, lowers inflammatory drive and BP (lower sympathetic tone, natriuresis, less renal compression). During *active* negative energy balance additional acute effects operate that do not need any weight change (fasting insulin, glucose, TG and liver fat fall within days; HDL-C dips; urate may rise; LDL-C may rise on high-fat diets, see 4.3).

**Table 4.7-A. Verified meta-analytic / trial anchors**
| Anchor | Result |
|---|---|
| Neter 2003 (25 RCTs, 4874 pts; energy restriction and/or exercise) | -5.1 kg (95 % CI -6.03, -4.25) -> SBP -4.44 (-5.93, -2.95), DBP -3.57 (-4.88, -2.25) mmHg; **per kg: SBP -1.05 (-1.43, -0.66), DBP -0.92 (-1.28, -0.55)**; >5 kg loss: -6.63/-5.12; <=5 kg: -2.70/-2.01; DBP effect larger in treated hypertensives (-5.31 vs -2.91) (R41) |
| Zomer 2016 (83 RCTs, any weight-loss intervention, 6-12 months) | SBP -2.68 (-3.37, -2.11); DBP -1.34; LDL-C -0.20 mmol/L (-0.29, -0.10) [-7.7 mg/dL]; TG -0.13 mmol/L (-0.22, -0.03) [-11.5 mg/dL]; FPG -0.32 mmol/L [-5.8 mg/dL]; HbA1c -0.40 % (-0.52, -0.28); mostly persistent at 2 years. Mean weight loss not visible in the abstract (UNVERIFIED) (R40) |
| Dattilo & Kris-Etherton 1992 (70 studies) | weight loss correlated with TC (r=0.32), LDL-C (0.29), VLDL-C (0.38), TG (0.32); **HDL-C: +0.009 mmol/L per kg lost when weight is stabilised, but -0.007 mmol/L per kg while actively losing** (R39) |
| Poobalan 2004 (13 long-term studies, BMI >=28, >2 y follow-up) | TC falls 0.23 mmol/L per 10 kg lost (r=0.89 across studies) (R39b) |
| Look AHEAD (n=5145, T2D; 1 year) (R42) | weight -4.77 kg: SBP -4.8, DBP -2.4 mmHg, FPG -14.3 mg/dL, HbA1c -0.39 %, HDL +2.4, LDL -5.5 (no association with weight loss; statins), TG median -12 mg/dL; weight -3.5 / -7.25 / -12.1 / -21.3 kg categories showed graded improvements; 5-<10 % loss OR 3.5 for >=0.5 % HbA1c drop, 2.2 for >=40 mg/dL TG drop |
| Magkos 2016 (RCT; obese, insulin-resistant, BMI ~40; weight-stable measurements) (R30) | at -5.1 / -10.8 / -16.4 % weight (9-completer means): fat mass 50.3 -> 45.4 -> 41.1 -> 36.9 kg; intra-abdominal adipose tissue (MRI) 1656 -> 1501 -> 1277 -> 1154 cm3; IHTG 8.5 -> 7.4 -> 4.1 -> 3.0 %; insulin 18.3 -> 15.5 -> 12.6 -> 9.5 uU/mL; TG 153 -> 130 -> 110 -> 97 mg/dL; ALT 18 -> 15 -> 11 -> 11 U/L; CRP 4.69 -> 4.74 -> 5.47 -> 3.14 mg/L (only the 16 % step significant); LDL 115 -> 98 -> 101 -> 91 mg/dL and HDL 43 -> 41 -> 42 -> 44 (NS); FPG 92.7 -> 89.4 -> 89.3 -> 88.6 (NS); leptin 43 -> 18.6; adiponectin rose only at 16 % |
| Petersen 2026 (R24) | ~10.5 % weight loss (-11.4 to -11.9 kg), BMI 38.9: fasting insulin 27.7 -> 13.1 (keto) vs 27.1 -> 17.0 and 28.2 -> 17.9 (other diets); HOMA-IR 6.7 -> 2.8 vs 6.8 -> 4.1, 6.8 -> 4.0; HbA1c 5.6 -> 5.0 vs 5.4 -> 5.3, 5.7 -> 5.3; SBP -5 to -11 mmHg; LDL -8 to -22 mg/dL |
| Selvin 2007 (33 studies) (R62) | each 1 kg weight loss: CRP -0.13 mg/L (all interventions incl. surgery, r=0.85); lifestyle-only studies: slope 0.06 mg/L per kg (r=0.30) |
| DIETFITS 12 months (R20) | -5.3 / -6.0 kg: FPG -3.7 / -2.1 mg/dL; insulin -2.6 / -2.3 uU/mL; SBP -3.2 / -3.7; DBP -1.9 / -2.6; LDL -2.1 / +3.6; TG -10 / -28; HDL +0.4 / +2.6 (low-fat / low-carb) |

**Table 4.7-B. Working per-unit coefficients for the engine (weight-stable, steady state; `dW` = kg lost, `%WL` = % of initial weight lost)**
| Marker | Coefficient | Basis | Grade |
|---|---|---|---|
| SBP / DBP | -1.05 / -0.92 mmHg per kg (DBP response larger in populations on antihypertensives: -5.3 vs -2.9 mmHg per study) | Neter | A |
| LDL-C | -0.6 mg/dL per kg (range 0 to -1.3); zero if the user is a keto-LEM responder (4.3) | Poobalan (TC -0.9 mg/dL/kg), Zomer, Look AHEAD (zero), DIETFITS, Petersen | B/C |
| HDL-C | +0.35 mg/dL per kg once weight-stable; -0.27 mg/dL per kg while rate of loss > 0.25 %/week (active) | Dattilo | A |
| TG | ln TG: -0.015 per kg (BMI 25-30), -0.020 per kg (BMI >=30) | Magkos, Zomer, Look AHEAD | B |
| Fasting glucose | -0.7 mg/dL per kg if FPG0 ~100; scale linearly to -3.0 mg/dL per kg at FPG0 ~150 (`b = 0.7 + 2.3*(FPG0-100)/53`, clip 0.5-3.5) | DIETFITS (-3.7/-5.3 kg), Magkos, Look AHEAD (-14.3/-4.77 kg) | B |
| HbA1c | via eAG (4.11); empirical -0.08 % per kg in T2D, ~-0.02 % per kg in non-diabetic adults | Look AHEAD, Zomer, Petersen | B |
| Fasting insulin | ln INS: -0.030 per 1 % WL (-15/-31/-48 % at 5/11/16 % loss) | Magkos; DIETFITS -15 % at -6 % | B |
| hs-CRP | ln CRP: -0.07 per BMI unit lost (= -0.023 per kg at 1.75 m), *with threshold behaviour*: apply the full slope only to the part of weight loss beyond ~8 % of initial weight, 30 % of the slope below that (Magkos: no change at 5 and 11 %, -33 % at 16 %) | NHANES cross-section slope 0.069-0.076/BMI; Selvin -0.13 mg/L per kg; Magkos | B/C |
| IHTG | ln IHTG: -0.075 per 1 % WL (proposed fit, 4.9) | Magkos, Browning, Kirk, Lim | B |
| ALT | ln ALT: elasticity 0.5 w.r.t. IHTG (4.9) | Magkos | C |
| VAT | %dVAT = k_v x %dFM, k_v ~1.2 (4.10) | Magkos, Chaston, Merlotti | B |
| Uric acid | -0.06 mg/dL per kg (range -0.02 to -0.22); rapid loss/ketosis can transiently *raise* it (4.13) | Dessein (-0.10 mmol/L per 7.7 kg in gout = -0.22/kg), Nielsen, NHANES slope | C |

**Active loss vs weight-stable (transient effects).** (a) HDL: dips during active loss (-0.27 mg/dL/kg) then rises above baseline after stabilisation (+0.35 mg/dL/kg) (R39). (b) TG, FPG, insulin, IHTG and hepatic insulin sensitivity respond within days to energy deficit, before much weight is lost: 600 kcal/day (VLCD) for 1 week normalised FPG in T2D (9.2 -> 5.9 mmol/L), halved TG (2.4 -> 1.2 mmol/L) and cut liver TG by 30 % with -3.9 kg (61 % fat) (R56); 48-hour energy restriction reduces IHTG 9-30 % (R53). (c) LDL-C: no consistent transient; keto diets can raise it in lean people despite weight loss (4.3). (d) BP falls with weight loss even while losing (Neter includes active phases). (e) CRP shows a threshold (only after large loss). (f) Urate: temporary rise after bariatric surgery/very rapid loss (Nielsen, "at short term, temporary increased sUA and gout attacks tended to occur") and with ketosis (4.13). (g) Weight regain reverses each component with the same time constants; there is no evidence for hysteresis except that HDL-C and liver-fat benefits are lost within weeks of overfeeding.
**Implementation.** Split each weight-related effect into an *energy-deficit acute state* (tau 3-7 d, amplitude proportional to deficit fraction D = 1 - EI/EE, active only when D > 0.2) and a *fat-mass state* (tau = time constant of the fat-mass lag from #01, or 30-45 d if not available). Acute amplitudes (PROPOSED): ln TG -0.6*(D-0.2)^+, FPG (T2D only) -0.3*(FPG0-100) *(D-0.2)^+/0.5 mg/dL, ln INS -0.8*(D-0.2)^+, ln IHTG -0.9*(D-0.2)^+ (from Lim 2011: -30 % in week 1 at D~0.75), all Grade C; after the first month the fat-mass state dominates.

### 4.8 Blood pressure: sodium, potassium, DASH pattern, alcohol, exercise, weight

**Sodium (dose-response; Grade A).** Filippini 2021 (85 trials, sodium 0.4-7.6 g/d, >=4 weeks, 24-h urinary Na; 1-stage cubic-spline): approximately *linear* relation with no flattening across the entire range; per 100 mmol/d (2.3 g Na, 5.8 g salt) **lower** sodium: SBP -5.56 (95 % CI -4.52, -6.59) and DBP -2.33 (-1.66, -3.00) mmHg overall; normotensive SBP -2.30 (-1.33, -3.27), DBP -0.80; hypertensive SBP -6.50 (-5.22, -7.79), DBP -3.00; dietary-modification trials steeper than sodium-supplementation trials (supplementation: -4.47/-1.90); women steeper than men; at 6 g/d vs 2 g/d: SBP +3.99 (0.80, 7.18) mmHg normotensive, +10.31 (7.86, 12.75) hypertensive; little BP effect in normotensives below 2 g/d (R45). He 2013 (34 trials, 3230 participants, >=4 weeks): -75 mmol/24 h -> SBP -4.18, DBP -2.06; per 100 mmol -5.8 mmHg SBP (2.5, 9.2); hypertensive -5.39/-2.82; normotensive -2.42/-1.00; small rises in renin (+0.26 ng/mL/h), aldosterone (+73 pmol/L), noradrenaline, no significant lipid change (R45b). Cochrane 2017 (185 studies): reduction from 201 to 66 mmol/d -> SBP/DBP -1.1/0 (white normotensives), -5.5/-2.9 (white hypertensives), Black hypertensives -6.6/-2.9, Asian hypertensives -7.8/-2.7; renin +55 %, aldosterone +127 %, cholesterol +2.9 %, TG +6.3 % (contested lipid signal) (R45c).
Per gram of sodium: **-2.4 mmHg SBP/g overall, -1.0 (normotensive), -2.8 (hypertensive); DBP -1.0, -0.35, -1.3.**
**Salt sensitivity.** Individual responses are heterogeneous (Weinberger: sodium-sensitive individuals older, lower renin, higher baseline BP; response to sodium restriction correlated with baseline pressure r=0.61 and initial sodium excretion r=0.27; hypertensives more often sodium-sensitive, P<0.001) (R52). Prevalence of "sensitive" (~25 % normotensive, ~50 % hypertensive) is commonly quoted but UNVERIFIED here (AHA statement R52b abstract not retrievable). Model: multiplier m_Na ~ lognormal(0, 0.6) (UNVERIFIED sigma; heterogeneity I2 = 68-75 % in R45/R45b), mean-one.
**Time course (Grade B).** DASH-Sodium time-course analysis (412 adults, 4-week periods, weekly BP): on a typical-American (control) diet SBP/DBP did not change on high sodium (-0.04/+0.06 mmHg/week) but fell progressively on low sodium (-0.94/-0.70 mmHg/week) **without plateau at 4 weeks**; on DASH, low sodium slope -0.42/-0.54; DASH itself lowered SBP/DBP by -4.36/-1.07 mmHg by week 1 (most of the full effect), with no further weekly change (R46c). Filippini found no BP-effect difference between trials of 4-11 vs >=12 weeks -> full effect within ~4-12 weeks. Model tau_Na = 21 days (PROPOSED; bracketed by "no plateau at 4 weeks" and "no difference 4-11 vs >=12 weeks").

**DASH / dietary pattern (Grade A).** DASH (459 adults, 8 weeks, weight and sodium constant): combination diet -5.5/-3.0 mmHg vs control (hypertensives -11.4/-5.5; normotensives -3.5/-2.1); fruit-and-vegetable diet -2.8/-1.1 (R46b). DASH-Sodium (412 adults, 30-day periods): control diet high -> intermediate sodium -2.1 mmHg, intermediate -> low -4.6 (total -6.7); DASH diet -1.3 and -1.7 (total -3.0); DASH low-sodium vs control high-sodium: -7.1 (normotensive) and -11.5 mmHg (hypertensive) (R46). => DASH roughly **halves the sodium slope** (3.0/6.7 = 0.45). OmniHeart: protein-rich and MUFA-rich DASH-like diets lowered SBP a further 1.4 and 1.3 mmHg (3.5 and 2.9 in hypertensives) relative to a carbohydrate-rich DASH-like diet (R59).
**Potassium (Grade B).** Aburto 2013 (22 RCTs, 1606 pts): higher potassium intake SBP -3.49 (-5.15, -1.82), DBP -1.96 mmHg — in hypertensives but not normotensives; largest at 90-120 mmol/d without dose-response (R47). Filippini 2020 (32 RCTs): U-shaped dose-response; BP falls with supplementation up to ~30 mmol/d net increase in urinary K, weakens above, rises above ~80 mmol/d net; pooled forest SBP -3.9 (-5.2, -2.6), DBP -2.4 (-3.8, -1.1); effect stronger with hypertension and with higher sodium intake (<3 g/d Na: much weaker) (R47b).
**Alcohol (Grade A for high intakes).** 36 trials, 2865 participants: no BP effect of reducing alcohol in people drinking <=2 drinks/day; in people drinking >2/day reduction lowers BP dose-dependently — largest in >=6 drinks/day who cut intake ~50 %: SBP -5.50 (-6.70, -4.30), DBP -3.97 (-4.70, -3.25) mmHg (R49).
**Exercise (Grade A).** Cornelissen 2013 (93 trials, 5223 pts, >=4 weeks): endurance SBP -3.5 (-4.6, -2.3), DBP -2.5; dynamic resistance -1.8 (-3.7, -0.01) / -3.2 (-4.5, -2.0); isometric -10.9 (-14.5, -7.4) / -6.2 (5 groups, small studies); combined SBP NS, DBP -2.2. Endurance by baseline: hypertensive -8.3/-5.2, prehypertensive -2.1/-1.7, normotensive -0.75/-1.1; resistance largest in prehypertensive (-4.0/-3.8) (R50). MacDonald 2016 (64 studies): dynamic RT -3.0/-2.1 overall; ~6/5 hypertensives, ~3/3 prehypertensives, ~0/1 normal (R50b). Acute post-exercise hypotension -4.8/-3.2 mmHg for hours (up to ~22 h) (R50c, R50d). Detraining: lipid gains lost within 7 weeks (R50e); BP detraining kinetics UNVERIFIED.
**Sugar.** Higher vs lower free-sugar intake raised BP by SBP 6.9/DBP 5.6 mmHg in trials >=8 weeks (large heterogeneity) (R35) — Grade C; optional term only.

**Equation set (PROPOSED FIT to the above).**
```
beta_Na,SBP = 1.0 + 1.8 * sigmoid((SBP0 - 135)/8)        [mmHg per g Na; 1.3 at SBP0=122; 2.4 at 145]
beta_Na,DBP = 0.42 * beta_Na,SBP
Na_eff      = max(Na, 2.0)  if SBP0 < 130 else Na          (no measurable effect <2 g/d in normotensives)
dSBP_Na*    = m_Na * beta_Na,SBP * (Na_eff - Na_base) * (1 - 0.55*DASH_fraction)
dSBP_K*     = -0.08 * min(dK_mmol, 40) * hyper_factor(SBP0) * (Na_base >= 3 g/d ? 1 : 0.4)     [hyper_factor 1.0 for SBP0>=140 to 0.4 for normotensives]  (U-shape: 0 beyond +80 mmol/d)
dSBP_DASH*  = -(3.5 + 8.0*sigmoid((SBP0-135)/8)) * DASH_fraction ; dDBP_DASH* = -(2.1 + 3.4*sigmoid((SBP0-135)/8))*DASH_fraction
dSBP_wt*    = -1.05 * kg_lost ; dDBP_wt* = -0.92 * kg_lost
dSBP_alc*   = +0.15 * (alcohol_g - alcohol_g_base)  for the part above 24 g/d      [from -5.5 mmHg for a 36 g/d cut from 72 g/d]
dSBP_ex*    = -(0.75 + 7.5*sigmoid((SBP0-135)/8)) * min(1, aerobic_min_per_week/150)  (endurance) ; RT: -(0.5 + 5.5*sigmoid(...))*min(1, sets/wk / 12) ; isometric: optional -5 (UNVERIFIED shrinkage of -10.9)
dSBP_prot*  = -0.14 * (protein_%E - base)   [carbohydrate-replacing; OmniHeart]      ; dSBP_MUFA* = -0.13 per %E
DBP analogues from the DBP coefficients above.
```
Time constants (each component lagged separately): DASH SBP 4 d, DASH DBP 14 d (DBP reached only 36 % by week 1 in R46c: tau = 7/-ln(1-0.36) = 16 d), sodium 21 d, potassium 21 d (UNVERIFIED), weight 21 d (UNVERIFIED), alcohol 10 d (UNVERIFIED), exercise 30 d (onset over 4-12 weeks; Cornelissen trials >=4 weeks), exercise detraining 21 d (UNVERIFIED).
Baseline SBP/DBP and SDs: Tables B1-B3 (SBP resid SD 12.9 M / 14.3 F; DBP 10.0/9.7); hypertension defined SBP >=130 or DBP >=80 in the 2025 AHA/ACC guideline family (R66; thresholds UNVERIFIED here).
**Evidence grade.** Sodium A; DASH A; exercise A; weight A; alcohol A (>2 drinks/day) ; potassium B; salt-sensitivity fraction C; component time constants B/C; sugar C.

### 4.9 Liver fat (IHTG) and ALT

**Mechanism.** IHTG = FFA flux from adipose lipolysis (~60 % of liver fat in NAFLD, Donnelly cited in R53c) + hepatic DNL (from carbohydrate; ~25 %) + dietary fat, minus oxidation and VLDL export. It responds extremely fast to energy restriction and carbohydrate restriction because DNL falls within a day and ketogenesis/oxidation rises; and rises within 3 weeks on overfeeding, with **saturated fat >> carbohydrate > unsaturated fat**.

**Table 4.9-A. Verified data**
| Study | Intervention | IHTG result |
|---|---|---|
| Kirk 2009 (22 obese, BMI 36.5) (R53) | hypocaloric high-carb (>180 g/d) vs low-carb (<50 g/d) | 48 h: -8.9 % (HC) vs **-29.6 % (LC)**; at ~11 weeks (-7 % weight): -44.5 % (HC) vs -38.0 % (LC) — equal; basal glucose production -23 % (LC) vs -7 % (HC) at 48 h |
| Browning 2011 (18 NAFLD, BMI 35) (R53b) | 2 weeks: 1200-1500 kcal vs <20 g carbohydrate/d | weight -4.0 vs -4.6 kg; liver TG **-28 % vs -55 %** (P=0.008); related to ketones (r=0.755) and RQ (r=-0.797) |
| Mardinoglu 2018 (10 obese NAFLD, IHTG 16.0 %) (R53c) | **isocaloric** (3115 kcal/d) <30 g carbohydrate, higher protein, 14 days | liver fat **-43.8 %** (significant at day 1, p=0.027); weight -1.8 % (mostly fat+water); plasma TG -48.4 %, VLDL-TG -56.7 %, DNL -79.8 %, beta-hydroxybutyrate 4.9x; liver fat returned toward baseline (11.3 vs 13.8 %) 1-3 months after resuming usual diet; folate/microbiota changes |
| Lim 2011 (11 T2D, BMI 33.6) (R56) | 600 kcal/day, 8 weeks | -15.3 kg; liver TG **-30 % in week 1**, 12.8 -> 2.9 % (-70 %) at 8 weeks (normal range); TG halved week 1; pancreas TG 8.0 -> 6.2 %; liver fat stayed 2.9 -> 3.0 % 12 weeks after (weight +3.1 kg) |
| Petersen 2005 (8 T2D) (R55) | ~8 kg loss, very-low-fat | IHL -81 +/- 4 % (12.2 %); FPG 8.8 -> 6.4 mmol/L |
| Magkos 2016 (R30) | see 4.7 | -40 +/- 21 % at 5 % WL (mean of individual %), median 8.5 -> 7.4 -> 4.1 -> 3.0 % at 5/11/16 % |
| Petersen 2026 (R24) | ~10.5 % weight loss, prediabetes + steatosis (n=42) | IHTG 19.4 -> 6.2 (**-68 %**, keto) vs 18.1 -> 10.3 (-43 %, Mediterranean) vs 17.7 -> 9.6 (-46 %, very-low-fat); difference P=0.011 |
| Qadri 2026 (R25) | short-term hypocaloric ketogenic vs non-ketogenic, crossover, equal energy deficit and fat loss | IHTG **-29 % vs -20 %** (45 % greater), hepatic insulin sensitivity +59 % vs +21 %, serum insulin -54 % (KD only); mitochondrial redox/TCA changes (possible trade-off) |
| Vilar-Gomez 2015 (n=293 NASH) (R55b) | 52 weeks lifestyle | weight loss >=10 %: 90 % NASH resolution, 45 % fibrosis regression; >=5 %: 58 % resolution |
| Sevastianova 2012 (16 overweight, BMI 30.6) (R54d) | 3 weeks >1000 kcal/d simple carbohydrate overfeeding, then 6 months hypocaloric | weight +1.8 kg (+2 %), liver fat **+27 %** (9.2 -> 11.7 %; >10x the relative weight change), DNL up in proportion; after -3.2 kg (4 %) liver fat -25 % (11.7 -> 8.8 %) |
| Luukkonen 2018 (38 overweight, BMI 31, liver fat 4.7 %) (R54) | +1000 kcal/d of saturated fat, unsaturated fat or simple sugars, 3 weeks | IHTG **+55 % (SFA), +15 % (UNSAT), +33 % (CARB, DNL +98 %)**; SFA raised lipolysis, insulin resistance, endotoxaemia, ceramides |
| Rosqvist 2014 (39 young normal-weight) (R54b) | 7 weeks muffins high in palm oil (SFA) vs sunflower oil (n-6 PUFA), equal weight gain | SFA markedly increased liver fat, **twofold larger VAT** increase, less lean-tissue gain (PUFA ~3x more lean tissue) |
| Rosqvist 2019 (LIPOGAIN-2, 61 overweight/obese) (R54c) | 8 weeks overfeeding SFA vs PUFA (+2.3 vs +2.0 kg), then 4 weeks calorie restriction | SFA liver fat **+50 % relative**, liver enzymes and ceramides up; PUFA no rise in liver fat/enzymes; reversed by calorie restriction |
| Maersk 2012 (47 overweight, 6 months, 1 L/d) (R35d) | sucrose cola vs isocaloric milk vs diet cola vs water | liver fat +132-143 % relative difference, VAT +24-31 %, TG +32 %, SAT not different |
| Chiu 2014 meta (13 feeding trials, 260 healthy) (R35e) | fructose | isocaloric exchange: no effect; hypercaloric (+21-35 %E, +104-220 g/d): IHCL SMD +0.45 (0.18, 0.72), ALT +4.9 U/L (0.03, 9.85) |
| Johnson 2009 (19 obese, 4 weeks cycling, no weight change) (R55c) | aerobic exercise | **liver TG -21 %, VAT -12 %**, FFA -14 %; HOMA-IR unchanged |
| Keating 2015 (48 inactive overweight, 8 weeks) (R55d) | 3-4 sessions/week, various dose/intensity vs placebo | liver fat -2.38, -2.62, -0.84 percentage points vs placebo +1.10; VAT -258, -387, -213 cm3 vs +93; **no significant dose/intensity difference** |
| Hashida 2017 (23 studies) (R55e) | aerobic vs resistance | effective protocols ~40-45 min, 3x/week, 12 weeks; resistance achieves it at lower intensity/energy cost (6470 vs 11,064 kcal) |
Reference distribution: upper limit of normal 5.56 %, prevalence of steatosis 33.6 % (Dallas Heart Study, n=2349, MRS) (R57).

**Equations (PROPOSED FIT; state variable `lnL = ln IHTG`).**
```
L0        = 2.0 * exp(0.11*(BMI-22)) * exp(0.9*z_L)          [%; BMI 27 -> 3.5 %, 32 -> 6.0 %, 38 -> 11.6 %; sigma_ln=0.9-1.1]   (Grade C: shape from Dallas ULN 5.56 %, Magkos BMI 40 median 8.5 %, Lim controls 8.5 % at BMI ~34)
lnL*_slow = lnL0 + ln f_wl + ln f_cr + ln f_ex - ln(over)            (target with lag tau_L,down = 12 days when target < current, tau_L,up = 21 days when target > current)
f_wl      = exp(-0.075 * %WL)                                  (weight LOSS; for weight gain use the overfeeding state D instead)
f_cr      = exp(-0.40 * s_keto)                                (carbohydrate-restriction / ketotic hepatic effect)
f_ex      = exp(-0.25 * min(1, METs_h_per_week/10))   (aerobic, no weight change; resistance counts 1.5x per METs-h)
D state   : dD/dt = g_type * S/1000 - D/120     [S = daily energy surplus kcal, clipped to 0-1500; g_SFA=0.015/d, g_CARB(sugar)=0.014/d, g_UNSAT=0.0067/d, g_n6PUFA=0.0/d per 1000 kcal surplus; tau_D=120 d]    ;   lnL_total = lnL_slow + D
acute deficit term (days): -0.9*(D_def-0.2)^+ added to lnL* (from Lim: -30 % in week 1 at D_def~0.75)
ALT       : ln ALT* = ln ALT0 + 0.5*(lnL_total - lnL0), floor 11 U/L (M) / 8 U/L (F) [population P5], tau_ALT = 21 d; hypercaloric fructose adds +4.9 U/L
```
Calibration check of f_wl: -4.3 % weight (Browning calorie restriction, 14 d): exp(-0.32)=0.72 -> -28 % (obs -28 %) ; -7 % weight (Kirk, 11 wk): 0.59 -> -41 % (obs -38 to -44.5 %); -10.8 % (Magkos): 0.44 -> -56 % (obs 8.5 -> 4.1 = -52 %); -16.4 %: 0.29 (obs 0.35); -15 % (Lim): 0.32 (obs 0.23); -8 kg ~ -8 % (Petersen 2005): 0.55 (obs 0.19 — under-predicts T2D very-low-fat loss). Calibration of f_cr: Browning -55 % vs -28 % at equal weight loss (ratio 0.63, ln -0.46); Mardinoglu isocaloric -44 % at -1.8 % weight (f_wl 0.87 -> residual 0.65, ln -0.43); Kirk 48 h 0.77 (ln -0.26); Qadri 0.71 (ln -0.34); Petersen 2026 0.57 (ln -0.56). Mean ln about -0.42; use -0.40; the benefit vs non-ketogenic diets is real at 10 % weight loss (Petersen) but absent at 11 weeks in Kirk — treat the sustained magnitude as uncertain. Calibration of D: Luukkonen 3 weeks (SFA +55 % = 0.44 ln; CARB 0.29; UNSAT 0.14; g x 21 d x 1000/1000 with tau_D=120 -> SFA 0.015*21*0.92 = 0.29 (under by 35 %), CARB 0.014*21*0.92=0.27 (0.29 obs), UNSAT 0.0067 -> 0.13 (obs 0.14)); Sevastianova +27 % (0.24 ln) vs predicted 0.27; Maersk 6 months at ~424 kcal/day of liquid sugar: 0.014*0.424*120*(1-exp(-182/120)) = 0.55 (obs 0.87 ln); Rosqvist 2019 (SFA +50 % at 8 weeks): predicted 0.015*0.75*120*(1-exp(-56/120)) = 0.50 (obs 0.41) assuming ~+750 kcal/d surplus (UNVERIFIED). Sugar-sweetened beverages appear to have a larger long-term effect than the fit; use g_CARB = 0.020 for liquid sugars (PROPOSED).
Time dynamics summary: fall on carbohydrate/energy restriction begins within 24 h (significant at day 1 in Mardinoglu), tau ~ 12 d (30 % in week 1 of VLCD; 55 % in 14 d with <20 g carbohydrate); rises within 3 weeks on overfeeding; hysteresis: benefit lost within 1-3 months of resuming the usual diet (Mardinoglu follow-up); weight loss maintenance retains it (Lim: stayed at 3 % 12 weeks after with +3.1 kg regain).
Moderators: PNPLA3 148M genotype (DNL response to carbohydrate overfeeding was seen in 148II but not 148MM; R54d), baseline IHTG (proportional), insulin resistance, sex, age.
**Evidence grade.** Rapid fall with energy/carbohydrate restriction: **A** (multiple controlled human trials with MRS, concordant); relative size of carbohydrate-restriction advantage: B (varies by duration); SFA > carbohydrate > unsaturated fat overfeeding hierarchy: **B** (two independent trial groups, n=38 and 61, plus n=39); sugar-sweetened beverage effect: B; exercise independent of weight loss: **B** (Johnson, Keating, Hashida; small RCTs); ALT/liver-enzyme elasticity: C.

### 4.10 Visceral adipose tissue (VAT) coefficients (partition owned by #14)

- **Preferential VAT loss early in weight loss (Grade A/B).** Systematic review of 61 studies/98 cohorts: %-weight loss was the only factor associated with %dVAT/%dSAT (r=-0.29, P=0.005): modest weight loss produces preferential VAT loss, attenuated at larger loss; very-low-calorie diets give exceptional short-term (<4 weeks) preferential VAT loss that is gone by 12-14 weeks; method of weight loss otherwise irrelevant (R61c). Meta-analysis of 89 studies: *absolute* SAT loss exceeds absolute VAT loss (VAT depot is smaller) but **%VAT loss always exceeded %SAT loss**, with no strategy (diet+exercise, drugs, bariatric surgery) preferentially targeting VAT (R61d). Magkos 2016: intra-abdominal fat -9 %/-23 %/-30 % (MRI; 1656 -> 1501 -> 1277 -> 1154 cm3) at -5/-11/-16 % weight vs total fat mass -10/-18/-27 % (ratio %VAT/%FM = 1.0, 1.3, 1.1) (R30).
- **Exercise independent of weight loss (Grade A).** Meta-analysis of 117 studies (n=4815): without weight loss exercise reduces VAT by 6.1 % whereas diet shows ~1.1 %; diet causes more weight loss, exercise tends (P=0.08) to reduce VAT more; weight-VAT correlation R2=0.74 after diet but 0.45 after exercise (R61). Exercise alone (15 studies, 852 subjects): SMD -0.50 (-0.66, -0.34); >30 cm2 (women) and >40 cm2 (men) VAT reduction on CT after 12 weeks, best with moderate/high-intensity aerobic training (R61b). Dose: >=10 METs-h/week needed; VAT reduction related to energy expenditure (r=-0.75, excluding metabolically compromised) (R61e). Short RCTs: 4 weeks cycling -12 % (R55c); 8 weeks -213 to -387 cm3 (R55d).
- **Diet composition and VAT.** DIETFITS (DXA-estimated VAT, n=449): healthy low-carbohydrate diet reduced VAT more than healthy low-fat: 10.6 cm2 (5.0, 16.2) at 6 months and 6.3 cm2 (0.6, 12.0) at 12 months; larger in men; insulin resistance did not modify (R22). SFA overfeeding doubled the VAT gain vs n-6 PUFA at equal weight gain (R54b). Fructose-sweetened (25 %E, 10 weeks) increased VAT vs glucose-sweetened despite equal weight gain (R35c); 1 L/d sucrose cola raised VAT +24-31 % vs milk/diet cola/water (R35d). Alcohol: no controlled human VAT data located (UNVERIFIED).
- **Equations (PROPOSED FIT).**
```
%dVAT_wl   = k_v(%WL) * %dFM            k_v = 1.3 for %WL <= 5, 1.1 at 10-15 %, +0.5 during the first 28 days of VLCD (D_def > 0.5), capped so VAT >= 0
exercise   : d ln VAT/dweek = -0.005 * min(1, METs_h_per_week/10), floor -0.10 total (Verheggen -6.1 % over typical 12-16 wk; Johnson -12 % in 4 wk is an upper bound)
diet       : low-carbohydrate (s_keto>0.5) extra -0.05 ln at 6 months (DIETFITS 6-11 cm2 of ~ 150-200 cm2 DXA VAT)  [Grade C]
gain       : share of gained fat going to VAT is composition-dependent: SFA-rich surplus 2x the PUFA-rich surplus (R54b) -> pass SFA fraction to #14
```
- Baseline VAT from Table 2.4; tau_VAT = the fat-mass time constant of #01 (weeks to months), not a separate fast process.
- Interface note: #14 keeps VAT as `depot.vat` in kg of fat mass; the coefficients above are *relative* (percent) changes and can be applied directly to that state; the DXA cm3 baselines in 2.4 are only for display/cross-checks (DXA and MRI VAT differ by a large factor).
- **Evidence grade:** B (weight-loss partition), A (exercise effect direction), B/C (magnitudes above), C (diet-composition effects).


### 4.11 Glycaemic markers: fasting glucose, fasting insulin/HOMA-IR, HbA1c (coordinate with #04)

**Fasting glucose and insulin.**
- Weight: FPG -0.7 mg/dL per kg lost near FPG0 = 100, up to -3.0 mg/dL per kg in T2D (4.7-B). Insulin ln -0.030 per %WL.
- Acute carbohydrate/energy restriction: FPG normalised within 1 week on 600 kcal/day in T2D (R56); at matched 10.5 % weight loss (prediabetes, BMI 39) FPG -12 (keto) vs -6, -6 mg/dL; fasting insulin -53 % (keto) vs -37 % vs -37 %; HOMA-IR -58 % vs -40 % vs -41 %; 24-h glucose AUC -20 % vs -8 % vs -8 %; 24-h insulin -74 % vs -44 % vs -27 % (R24). Hepatic insulin sensitivity 2-3x larger gain with keto; muscle insulin sensitivity +50 % in all groups (R24). Kirk 2009: hepatic effects at 48 h, muscle insulin-mediated glucose uptake only after 7 % weight loss (+48 %) (R53).
- Equation (PROPOSED FIT): `ln INS* = ln INS0 - 0.030*%WL - 0.30*s_keto*[weight-stable or deficit] + acute -0.8*(D_def-0.2)^+`; tau_INS,acute = 5 d, tau_INS,weight = 30 d; `HOMA_IR = FPG*INS/405`. Exercise training without weight change: HOMA-IR unchanged in Johnson 2009 (4 weeks) (R55c) -> no direct exercise term (glucose uptake/muscle insulin sensitivity belongs to #10).
- Fibre: umbrella review of 52 MAs: higher dietary fibre lowers FPG (ES -0.55), insulin (-1.22), HOMA-IR (-0.43), HbA1c (-0.38) but effect sizes are standardised and not per gram (R62g) — Grade B, magnitude not implementable here (defer to #04/#15).
- Baselines: Tables B1-B3, 2.4. Inter-individual: FPG SD 16-18 mg/dL (includes undiagnosed diabetes; SD of the normoglycaemic ~9-10 at ages 20-29), insulin GSD 1.7-2.3, HOMA GSD 1.7-2.2.

**HbA1c kinetics (Grade A for mechanism; B for constants).**
Mechanism: HbA1c is the fraction of haemoglobin glycated over the life of the red cell; the mean age of circulating RBC is 38-60 days (heterogeneous between people: 39-56 d in diabetes, 38-60 d in non-diabetic controls) and HbA1c synthesis is linear with RBC age (R48c), so recent glucose counts more than old glucose.
Data: after abrupt glycaemic normalisation in newly diagnosed T2D (n=9) the fasting glucose half-time was 6.3 +/- 2.4 days; **HbA1c fell linearly over the first 2 months with half-time 34.6 +/- 10.1 days** and more slowly thereafter; glycated albumin 17.1 d, fructosamine 12.2 d; the weight function of past glucose on HbA1c extends back ~100 days (R48b). Mean glucose mapping (ADAG, 507 subjects incl. 80 non-diabetic; 3 months): `eAG(mg/dL) = 28.7 x A1c - 46.7` (R2 = 0.84) (R48).
Implementation: tau_HbA1c = 34.6/ln2 = **50 days** (daily update `A1c(t+1) = A1c(t) + (A1c*(t) - A1c(t))/50`), with target `A1c*(t) = (eAG*(t) + 46.7)/28.7` where eAG* = current mean-glucose target = baseline eAG + 1.3 x dFPG (factor 1.3 because 24-h mean glucose fell 1.8x FPG on keto and 1.3x on other diets in R24; PROPOSED). Equivalent distributed-lag view: ~50 % of the current HbA1c reflects the last ~35 days, ~90 % the last ~115 days. Check vs Petersen 2026: dFPG -12 -> dA1c -0.54 (obs -0.6 keto); -6 -> -0.27 (obs -0.1 Mediterranean, -0.4 very-low-fat). Individual "glycation gap" from RBC lifespan heterogeneity: ~+/-10 days mean RBC age -> +/-20 % of the non-diabetic HbA1c-above-baseline; do not model except as a persistent offset z_A1c (resid SD 0.5 % in NHANES incl. glycaemic status).
Time-scale note: FPG/insulin (days) lead HbA1c (weeks): a 4-week intervention shows only ~55 % of its eventual HbA1c change.
**Evidence grade:** HbA1c kinetics A/B (one physiology study, n=9, consistent with RBC biology); weight/insulin coefficients B; acute keto effects B.

### 4.12 Inflammation: hs-CRP

**Mechanism.** CRP is hepatic (IL-6-driven) and its plasma half-life is ~19 h in all conditions, so circulating CRP simply tracks the current synthesis rate (R62f); the slow variable is the inflammatory drive (adipose mass, visceral fat, infection, sleep debt, smoking) — model CRP as an *instantaneous* function of a slow "inflammatory drive" state.
**Coefficients.**
- Weight/adiposity: 4.7-B (ln CRP -0.07 per BMI unit; threshold behaviour). Selvin: -0.13 mg/L per kg (all), 0.06 (lifestyle) (R62). Magkos: 4.69 -> 3.14 mg/L only at -16 % weight; unchanged at -5 and -11 % (R30). Petersen 2026: after -10.5 % weight loss, PAI-1 and TNF-alpha fell in the keto arm (R24).
- Exercise: 83 trials, 143 effects (n=3769): mean ES 0.26 SD decrease (0.18, 0.34); with BMI decrease ES 0.38, **without weight loss ES 0.19 (0.10, 0.28)**; independent contributions of BMI and %fat change (R62b). Diet-plus-exercise tends to beat diet alone (R62h). Model: `ln CRP += -0.10 * min(1, aerobic_min_per_week/150)` (PROPOSED shrinkage of ES to the log scale), tau 60 d.
- Diet pattern: Mediterranean pattern, 17 trials (>=12 weeks, n=2300): hs-CRP -0.98 mg/L (-1.48, -0.49), IL-6 -0.42 pg/mL, flow-mediated dilation +1.86 %, heterogeneity I2=91 % (R62d). Portfolio: CRP -28 % in a 1-month RCT (R34b) and lower in the 7-trial meta (R34). Low-carbohydrate diets: -0.18 mg/L on average but fragile (non-significant after removing one study: -0.14 (-0.28, 0.00)); larger with baseline CRP >4.5 mg/L (-0.70), BMI >35 (-1.21), age <=50 (R62e); in Ge 2020 network meta-analysis no named diet improved CRP at 6 months (R19). Very-low-carbohydrate in lean people: CRP unchanged (Retterstoel; R12).
- Omega-3: EPA -0.56 mg/L (-1.13, 0.00), DHA -0.5 mg/L (-1.0, -0.03) especially in dyslipidaemia and high baseline CRP (R62c); but 3.4 g/d EPA+DHA for 8 weeks had no effect on hs-CRP or cytokines in moderately hypertriglyceridaemic men (R38b). Model: `ln CRP += -0.10` only if CRP0 > 3 mg/L and EPA+DHA >= 2 g/d (PROPOSED, Grade C).
- Fibre: umbrella review of 52 meta-analyses: CRP ES -0.14 (-0.33, 0.05) NS while TNF-alpha improved (R62g) -> **no fibre term for CRP**.
- Omega-6/LA: 15 RCTs in healthy people: no effect on CRP, fibrinogen, PAI-1, cytokines, adhesion molecules (R64e) -> no term.
- Time: CRP follows the drive with tau ~ 30-60 days (weight-driven); in trials with 5-11 % weight loss (3-7 months) it did not move; acute infection/injury spikes and hard-training spikes are out of scope (half-life 19 h; peak ~48 h; R62f). Baseline CRP is "stable and characteristic for each individual" in the general population (R62f) -> use a persistent z_CRP, not day-to-day noise.
- Baselines: median-ish GM 1.0 (BMI<25) to 2.5-3.9 mg/L (BMI >=30); between-person GSD 2.6-3.5 (ln resid SD ~1.0) — the widest of any marker here; in NHANES 2017-2020 adults 20-79, 68.6 % have hs-CRP >1, 34.8 % >3 and 7.1 % >10 mg/L (our computation, MEC-weighted; the >10 group is largely acute inflammation and should be excluded from 'baseline' draws).
**Evidence grade.** Weight-loss effect: A (dose-response direction), B for threshold shape (one trial); exercise: A; Mediterranean: A (heterogeneous); low-carb: C; omega-3: C (mixed).

### 4.13 Uric acid

**Mechanism.** Serum urate = production (purine catabolism, fructose-driven ATP depletion, ethanol-driven adenine-nucleotide turnover, purine intake) minus renal + gut excretion. Ketone bodies (beta-hydroxybutyrate, acetoacetate) compete with urate for renal tubular secretion (infusion of BHB/acetoacetate caused renal urate retention; Goldfinger 1965, R63l); insulin resistance lowers excretion; weight loss/insulin sensitisation raises excretion.
**Magnitudes (verified).**
- **Fasting/ketosis:** 1610 people fasting 4-21 days (Buchinger Wilhelmi programme, 75-250 kcal/d): serum uric acid rose by **+100 +/- 4.5 umol/L (low-ketonuria group) to +200 +/- 4.9 umol/L (high-ketonuria group)** (1.7-3.4 mg/dL), correlating with ketonuria and even more with ketonaemia; one gout attack among 1422 fasters (R63k). LCHF 3 weeks (<20 g carbohydrate): uric acid rose vs control (Retterstoel, magnitude not in abstract) (R12). Meta-analysis of 6 ketogenic-diet RCTs (n=267): pooled +0.26 mg/dL (-0.47, 0.98), I2=95 %; very-low-calorie ketogenic subgroup -0.04 (-0.29, 0.22) (R63g). => consistent with a dose-response to circulating ketones: `dUA (mg/dL) = +0.6 * BHB_mM` (fasting BHB 3-6 mM -> +1.8-3.6; nutritional ketosis BHB 0.5-1.5 mM -> +0.3-0.9) (PROPOSED FIT, Grade C; cap +4).
- **Fructose/sugar:** isocaloric fructose exchange: MD +0.56 umol/L (NS) (21 trials, n=425); hypercaloric +35 %E fructose (213-219 g/d): +31 umol/L (15.4, 46.5) = +0.52 mg/dL (R63b). Fructose-containing sugars in energy-matched substitution: +0.16 mg/dL (0.06, 0.27), driven by sugar-sweetened beverages (high certainty) and sweets; 100 % fruit juice *lowers* uric acid in addition trials (R63) (47 trials, n=2763).
- **Alcohol:** 1.8 g ethanol/kg/day x 8 days in 6 gout patients raised serum urate 8.4 -> 10.1 mg/dL, with 1.7x daily uric acid turnover (increased adenine nucleotide turnover; lactate 1.3 -> 3.1 mM) (R63j). Cohort: gout RR 1.32/1.49/1.96/2.53 for 10-14.9/15-29.9/30-49.9/>=50 g alcohol/day vs none; beer RR 1.49 per 12-oz serving/day, spirits 1.15 per drink, wine 1.04 (n.s.) (R63h). Model: `dUA = +0.013 mg/dL per g ethanol/d` (UNVERIFIED for non-gout adults; scale by beverage: beer 1.0, spirits 0.35, wine 0.10 from ln RR ratios).
- **Purines/meat/dairy:** meat and seafood raise gout risk (top vs bottom quintile RR 1.41, 1.51); dairy lowers (RR 0.56); purine-rich vegetables and total protein do not (R63i). RCT magnitudes on serum urate not extracted -> qualitative only.
- **DASH / diet pattern:** DASH -0.25 mg/dL (-0.43, -0.08) vs control (8 weeks; baseline 5.7); effect grows with baseline urate (-0.08 at <5, -0.42 at 6-6.9, -0.73 at >=8 mg/dL) (R63f); pooled 4 DASH RCTs: -0.25 mg/dL (-0.4, -0.1) (R63g); protein-rich (half plant) DASH-style diet -0.16 mg/dL from baseline (-0.12 vs carbohydrate or unsaturated-fat diet) (R63e).
- **Weight loss:** Dessein 2000 (13 men with gout, BMI 30.5, 1600 kcal 40:30:30, 16 weeks): weight -7.7 kg, serum urate 0.57 -> 0.47 mmol/L (-100 umol/L = -1.7 mg/dL, -0.22 mg/dL per kg), gout attacks 2.1 -> 0.6/month (R63d). Nielsen 2017 (10 longitudinal studies): weight loss 3-34 kg -> change in sUA from -168 to +30 umol/L; dose-response in two studies; short-term temporary sUA rise and gout attacks after bariatric surgery (R63c). NHANES cross-section: +0.06 mg/dL per BMI unit (Table B3).
**Equation (PROPOSED).**
```
UA*  = UA0 + 0.6*BHB(t) [cap 4] + 0.013*alcohol_g*bev_mult + 0.52*min(1, fructose_excess_%E/35)*1[energy surplus] + 0.16*(SSB_substitution_fraction) - 0.06*kg_lost - DASH_effect - 0.12*(protein_rich_plant_fraction)
DASH_effect = 0.25 * DASH_fraction * clip((UA0-5)/2.5, 0.3, 2.5)          (0.08 at UA0<5 to 0.73 at >=8)
tau_UA(up, ketosis) = 5 d ; tau_UA(down after ketone drop) = 7 d (UNVERIFIED) ; weight/DASH components tau = 30 d
```
Baselines: M 6.0 +/- 1.3, F 4.7 +/- 1.3 mg/dL (F rises after 50: 4.5 -> 5.2); +0.06 mg/dL per BMI unit; between-person SD 1.1-1.25 (Tables B1-B3). Hyperuricaemia thresholds (>6.8-7 mg/dL) and gout warnings in section 9.
**Evidence grade.** Ketone/fasting effect: B (large observational fasting cohort + mechanistic infusion study + RCT meta-analysis); fructose/SSB: A; alcohol: B for direction, C for dose; DASH: A; weight loss: C (heterogeneous, mostly observational, gout populations).

### 4.14 Omega-3 and omega-6 beyond triglycerides; is the n-6:n-3 ratio mechanistically meaningful?

**Omega-3 (EPA+DHA) — beyond TG.** LDL-C: small rise (+6 mg/dL at ~3 g/d, R38c; J-shaped, +2.9 mg/dL peak near 1.75 g/d, R38e; DHA more than EPA-only; AHA: EPA+DHA raises LDL-C in very high TG but not EPA-only or in combination with statins, R38); HDL-C +1.6 to +3.5 mg/dL; BP: EPA -2.6 mmHg SBP (-4.6, -0.5), DHA -3.1 mmHg DBP in dyslipidaemia (20 RCTs) (R62c); CRP: -0.5 mg/L in high-CRP/dyslipidaemic subjects only (R62c) but nil at 3.4 g/d in moderate hyper-TG (R38b); glucose/HbA1c: small non-significant increases (27 trials) (R38c); non-HDL-C decrease ~-4 to -8 mg/dL at 2-3 g/d and ApoB modest decrease at 4 g/d (R38e, R38). These are small compared with the TG effect; omit all except TG, HDL, BP (optional -1 mmHg per g EPA+DHA up to 3 g in dyslipidaemic hypertensives, PROPOSED, Grade C).
**Omega-6 (linoleic acid).** Cochrane 2018 (19 RCTs, 6461 pts, 1-8 years): increased omega-6 makes little or no difference to all-cause mortality (RR 1.00, 0.88-1.12) or CVD events (0.97, 0.81-1.15), may reduce MI (RR 0.88, 0.76-1.02), lowers total cholesterol -0.33 mmol/L (-0.50, -0.16) in the long term, no effect on TG (-0.01) or HDL or adiposity (BMI -0.20 kg/m2) (R64d). The Sydney Diet Heart recovered data (safflower oil/margarine replaced SFA in 221 men with recent CHD): higher all-cause (HR 1.62), CVD and CHD mortality; updated meta-analysis showed no benefit (R64c) — confounding by trans fat in the margarine is often argued but UNVERIFIED here. 30-cohort consortium (68,659 people, 15,198 events): higher circulating/adipose LA -> lower total CVD (HR 0.93 per interquintile range, 0.88-0.99), CVD mortality 0.78, ischaemic stroke 0.88; arachidonic acid not associated with higher risk (R64b).
**LA -> AA -> inflammation.** In adults on Western diets, raising dietary LA up to 6-fold or lowering it by up to 90 % did not change arachidonic acid in plasma/erythrocyte phospholipids (P=0.72 and 0.39) (R64f); 15 RCTs in healthy people found no effect of higher LA intake on CRP, fibrinogen, PAI-1, cytokines, sVCAM/sICAM or TNF-alpha (R64e).
**The ratio.** The n-6:n-3 ratio "has both theoretical and practical difficulties"; Harris (2018) argues the primary deficiency in Western diets is EPA+DHA and proposes the Omega-3 Index (RBC EPA+DHA) instead (R64). NHANES intakes (2017-2020): LA 16-21 g/d, ALA 1.8-2.2 g/d, EPA+DHA 0.08-0.11 g/d (median 0.02) -> the ratio (~9-10:1) is dominated by the *absence* of marine n-3 rather than by excess LA. **Recommendation for the engine:** do **not** use an n-6:n-3 ratio as a state or goal. Model (a) LA/cis-PUFA as an LDL/TC-lowering lipid class (Mensink), (b) ALA with its own LDL coefficient, (c) EPA+DHA g/d for TG/HDL/BP. A "poor omega-3 status" indicator can be derived as EPA+DHA g/d relative to 0.25-0.5 g/d (UNVERIFIED thresholds).
**Evidence grade:** n-3 lipid effects A; absence of LA -> AA/inflammatory effect B (systematic reviews of RCTs but small/short); mechanistic irrelevance of ratio: B/C (expert appraisal + null RCT data; no RCT tests the ratio per se).

### 4.15 Does low-fat vs low-carbohydrate matter for cardiometabolic risk at equal weight loss?

**Table 4.15-A. Verified head-to-head evidence**
| Source | Design | Weight | LDL-C | HDL-C | TG | BP | Glycaemia/insulin | Liver/VAT/other |
|---|---|---|---|---|---|---|---|---|
| DIETFITS (R20), n=609, BMI 33, 12 months, healthy low-fat vs healthy low-carb (48/29/21 vs 30/45/23 %E carb/fat/protein) | RCT | -5.3 vs -6.0 kg (diff 0.7, -0.2 to 1.6) | -2.1 vs +3.6 mg/dL (**diff -5.7 favouring LF**, -9.4 to -2.1) | +0.4 vs +2.6 (**diff -2.2 favouring LC**) | -10 vs -28 (**diff +18 favouring LC**) | SBP -3.2/-3.7; DBP -1.9/-2.6 (NS) | FPG -3.7/-2.1; insulin -2.6/-2.3 (NS) | RER -0.008 vs -0.027; DXA VAT LC greater by 10.6 cm2 (6 mo) / 6.3 cm2 (12 mo) (R22); GL reduction explained most weight loss (R21) |
| POUNDS LOST (R23), n=811, 2 years, four diets (fat 20-40 %, protein 15-25 %, carbohydrate 35-65 %) | RCT | ~6 kg at 6 months for all; 2-year loss 2.9 (65 % carbohydrate) vs 3.4 kg (35 %) (NS); regain after 12 months | diets improved lipid-related risk factors and fasting insulin (per-diet values not in abstract) | | | | | attendance, not diet, predicted loss |
| Meta-analyses (R15-R19) | pooled RCTs | LC -0.9 to -2.2 kg extra at >=6-12 months (Ge: equal at 6 months; effects vanish at 12 months) | LC +4.6 mg/dL (Bueno), +3.7 (Hu), +6 (Mansoor), +2.7 (Chawla, +0.07 mmol/L); Ge: LC -1.0 vs LF -7.1 vs usual | LC +3.3 mg/dL (Hu), +3.5 (Bueno), +5.4 (Mansoor), +1.9 (Chawla) | LC -14 mg/dL (Hu), -23 (Mansoor), -9 (Chawla), -16 (Bueno) | Bueno DBP -1.4 (LC); Ge SBP -5.1 vs -5.1 | | CRP: no named diet improved at 6 months (Ge) |
| Petersen 2026 (R24), n=42, BMI 39, prediabetes + steatosis, **matched ~10.5 % weight loss**, all food provided | RCT | equal | -10 keto vs -22 Mediterranean vs -8 very-low-fat (NS) | +2 / -2 / -4 (P=0.005 for diet) | fasting TG -45 % / -24 % / -14 % | SBP -5/-11/-8 (NS) | HbA1c -0.6 / -0.1 / -0.4; HOMA-IR -58/-40/-41 %; hepatic insulin sensitivity 2-3x greater with keto | **IHTG -68 vs -43/-46 %**; ApoB -6/-15/-9 (NS) |
| Qadri 2026 (R25), crossover, equal deficit | RCT | equal fat loss | - | - | - | - | serum insulin -54 % (KD) | IHTG -29 vs -20 %; hepatic mitochondrial redox +51 %, TCA cycle oxidation -34 % (possible liver-injury-relevant trade-off) |
| Hall 2015 (R26), 19 adults with obesity, metabolic ward, 6 days isocaloric restriction | crossover | body-fat loss 89 +/- 6 g/d (fat restriction) vs 53 +/- 6 g/d (carbohydrate restriction) | - | - | - | - | - | model predicts convergence with prolonged feeding |
| Krauss 2006 (R65), 178 overweight men, weight loss 5.1 kg | RCT | - | LDL fell less on 26 % carbohydrate diet after weight loss | - | TG, ApoB, small LDL improved by carbohydrate restriction, benefits not additive with weight loss | - | - | "equivalent but nonadditive" |
**Synthesis (for the engine).** At equal weight loss and in mixed/obese populations: (1) weight, BP, glucose, insulin and CRP do not differ; (2) LDL-C is ~3-6 mg/dL higher on low-carbohydrate arms (less LDL reduction), HDL +2-3 mg/dL, TG -14 to -28 mg/dL (i.e. the well-known composition effects, already captured by 4.2 + 4.3 + 4.5); (3) hepatic outcomes (IHTG, hepatic insulin sensitivity, HbA1c in prediabetes) favour very-low-carbohydrate at 10 % loss (-68 % vs -43/-46 %) but this advantage is a *composition/ketosis* effect (f_cr), not a weight effect; (4) VAT favours low-carbohydrate modestly (6-11 cm2 DXA); (5) ApoB (the causal lipid) did not differ at ~10 % loss in obesity; in lean individuals the low-carbohydrate arm can raise ApoB substantially (Buren; LEM). Therefore the engine should **not** hard-wire a winner: composition enters through the mechanistic terms, and the summary "risk" metric should be ApoB/non-HDL-C, TG/HDL, HOMA-IR and IHTG together (section 6).
**Evidence grade:** A (weight, BP, lipids at 6-12 months), B (hepatic/VAT differences), C (long-term >12 months, lean populations).

### 4.16 Master table: state, drivers, time constant, baseline, SD, grade

| Marker | Main drivers (coefficient source) | tau (days) | Baseline generator | Between-person SD (population) | Response variability | Grade |
|---|---|---|---|---|---|---|
| LDL-C | SFA/MUFA/PUFA/trans/cholesterol (R1,R2,R5); LEM (lean + carbohydrate restriction, 4.3); fibre/sterol/nut/soy (4.4); weight -0.6 mg/dL/kg | 7 (comp.), 10 (LEM, portfolio) | B3: M 115.9 + 5.3*age10 + 1.1*BMI'; F 113.0 + 8.6*age10 + 0.2*BMI' | 32 (M), 31 (F) mg/dL | cholesterol response SD 14-16 mg/dL per 500 mg/d; LCHF: dLDL SD 103 mg/dL (survey), range +5..+107 % (Retterstoel); LMHR 18 % of self-selected LCHF | A (mean); B-D for the tail |
| ApoB | 0.587 x d(nonHDL) [+ SFA shrink 0.6] | as LDL/TG | 11.1 + 0.587 x nonHDL0 | 25 mg/dL (resid 8.4 given nonHDL) | as LDL | A/B |
| HDL-C | fat classes, weight (+0.35/kg stable; -0.27/kg active), aerobic (+2.5 mg/dL), alcohol (+4 per 30 g), n-3 | 10 (diet), 30 (exercise, weight) | M 50.6 + 0.9*age10 - 0.7*BMI'; F 61.2 + 1.8*age10 - 0.7*BMI' | 12 (M), 15 (F) | - | A |
| TG | carbohydrate<->fat exchange, sugar+surplus, alcohol, n-3, weight, keto multiplier, exercise | 4 (comp./keto), 14 (n-3), 30-45 (weight), 21 (exercise) | ln: M 4.51 + 0.05*age10 + 0.03*BMI'; F 4.34 + 0.09*age10 + 0.02*BMI' | ln SD 0.58 (M), 0.50 (F) (GSD 1.6-1.9) | n-3 effect ~ baseline-proportional | A/B |
| SBP/DBP | sodium 2.4/1.0 mmHg per g, DASH, K, weight 1.05/0.92 per kg, alcohol, exercise | 4-30 by component | B3: SBP M 122.5 + 2.4*age10, F 115.7 + 5.3*age10; DBP M 74.0 + 0.7*age10 + 0.48*BMI', F 71.4 + 1.1*age10 + 0.39*BMI' | SBP 13 (M) / 14 (F); DBP 10 | salt sensitivity heterogeneous (I2 68-75 %); higher in older/hypertensive/lower-renin | A |
| Fasting glucose | weight, energy deficit, ketosis (small), hepatic fat | 5 (acute), 30 (weight) | M 104.1 + 2.3*age10 + 0.45*BMI' ; F 99.4 + 2.2*age10 + 0.63*BMI' (includes undiagnosed DM) | 17-18 (fat right tail) | - | B |
| Fasting insulin / HOMA-IR | %WL -0.030 ln/%; ketosis -0.30; energy deficit acute | 5 (acute), 30 (weight) | ln INS M 2.08 + 0.02*age10 + 0.078*BMI'; F 2.09 - 0.02*age10 + 0.051*BMI' | ln SD 0.57 / 0.54 (GSD ~1.75) | - | B |
| HbA1c | eAG = 28.7*A1c - 46.7 lag | **50** (half-time 34.6) | M 5.43 + 0.10*age10 + 0.012*BMI'; F 5.41 + 0.11*age10 + 0.016*BMI' | 0.5 % | RBC lifespan 38-60 d heterogeneity | A/B |
| hs-CRP | adiposity (-0.07 ln/BMI unit; threshold), exercise, Mediterranean, n-3 (conditional) | 30-60 (driver); assay half-life 0.8 d | ln: M 0.32 + 0.07*age10 + 0.07*BMI'; F 0.50 + 0.02*age10 + 0.076*BMI' | ln SD ~1.0 (GSD 2.7-3.5) | stable within person | B |
| IHTG | %WL -0.075 ln/%; keto -0.40 ln; overfeeding by type; exercise -0.25 ln | 12 (down), 21 (up), D state 120 | 2.0*exp(0.11*(BMI-22)) % (Grade C) | ln SD 0.9-1.4 | PNPLA3, insulin resistance | A (direction), C (baseline) |
| ALT | 0.5 x d ln IHTG | 21 | ln: M 3.10 - 0.04*age10 + 0.026*BMI'; F 2.75 + 0.03*age10 + 0.012*BMI' | ln SD 0.5 / 0.47 | - | C |
| Uric acid | BHB (+0.6/mM), fructose/SSB, alcohol, weight (-0.06/kg), DASH | 5-7 (ketone), 30 (weight) | M 5.83 - 0.02*age10 + 0.059*BMI'; F 4.50 + 0.14*age10 + 0.061*BMI' | 1.25 (M), 1.13 (F) mg/dL | high in gout/CKD | B/C |
| VAT | %VAT = k_v x %FM (1.0-1.3); exercise -6..-12 %; SFA/fructose gain | fat-mass tau (#01) | Table 2.4 (DXA) | ln SD 0.30 (M), 0.43 (F) | - | B |
(`BMI' = BMI - 27`, `age10 = (age-45)/10`; VAT uses age-40.)


### 4.17 Correlated individual draws (so that a simulated "person" is internally consistent)

Residual correlation matrix of the baseline markers after adjusting for age and BMI within sex (NHANES 2017-2020, complete-case fasting adults without diabetes/lipid/BP medication, n=1888; sex-specific matrices averaged; our computation, R60). Draw z-vector ~ N(0, C), then `X0_i = X0(sex, age, BMI) + s * z_i` (ln scale for TG, INS, CRP, ALT).

|        | LDL | HDL | lnTG | SBP | FPG | lnINS | A1c | lnCRP | lnALT | UA |
|---|---|---|---|---|---|---|---|---|---|---|
| LDL    | 1.00 | -0.10 | 0.38 | 0.00 | 0.04 | 0.08 | 0.06 | 0.11 | 0.10 | 0.10 |
| HDL    | -0.10 | 1.00 | -0.43 | 0.06 | -0.10 | -0.32 | -0.13 | -0.17 | -0.05 | 0.01 |
| lnTG   | 0.38 | -0.43 | 1.00 | 0.04 | 0.11 | 0.29 | 0.12 | 0.14 | 0.15 | 0.16 |
| SBP    | 0.00 | 0.06 | 0.04 | 1.00 | 0.07 | 0.08 | 0.05 | 0.05 | 0.06 | 0.05 |
| FPG    | 0.04 | -0.10 | 0.11 | 0.07 | 1.00 | 0.18 | 0.75 | 0.05 | 0.07 | -0.04 |
| lnINS  | 0.08 | -0.32 | 0.29 | 0.08 | 0.18 | 1.00 | 0.13 | 0.09 | 0.21 | 0.06 |
| A1c    | 0.06 | -0.13 | 0.12 | 0.05 | 0.75 | 0.13 | 1.00 | 0.12 | 0.04 | -0.04 |
| lnCRP  | 0.11 | -0.17 | 0.14 | 0.05 | 0.05 | 0.09 | 0.12 | 1.00 | 0.02 | 0.09 |
| lnALT  | 0.10 | -0.05 | 0.15 | 0.06 | 0.07 | 0.21 | 0.04 | 0.02 | 1.00 | 0.09 |
| UA     | 0.10 | 0.01 | 0.16 | 0.05 | -0.04 | 0.06 | -0.04 | 0.09 | 0.09 | 1.00 |

Key structure: TG-HDL -0.43, TG-LDL +0.38, insulin-HDL -0.32, insulin-TG +0.29, FPG-HbA1c +0.75 (partly undiagnosed diabetes). The lean-mass-hyper-responder profile (very high LDL, high HDL, low TG) is the *opposite* of the usual metabolic cluster; the response term `m_i` for the LEM (4.3) should therefore be drawn **independently of the baseline LDL residual** (Norwitz: LMHR and non-LMHR had identical pre-diet LDL, 148 vs 145 mg/dL) and **positively** correlated with baseline HDL residual and **negatively** with baseline TG and BMI residuals (Norwitz: prior HDL beta +0.6, prior TG beta -0.17 mg/dL per mg/dL).

### 4.18 Implementation recipe (one simulated day)

1. Read from the schedule/other modules: %E of SFA (or 12:0/14:0/16:0/18:0), cis-MUFA, cis-PUFA (LA, ALA), trans, protein, carbohydrate, free sugars, cholesterol mg and kcal, viscous fibre g, sterol g, nut servings, soy protein g, EPA+DHA g, alcohol g (and beverage), sodium g, potassium g, DASH fraction, energy intake vs expenditure (D_def, S), body weight/fat mass (#01), s_keto and BHB (#05), aerobic METs-h/wk, RT sets/wk (#09/#10).
2. Compute deltas versus the user's *habitual* diet (section 2.4 defaults if not supplied) — all Mensink-type coefficients act on changes.
3. Compute each marker's steady-state target from its terms (sections 4.2-4.15) **per mechanism**, apply the individual multipliers/z-scores (4.1, 4.17).
4. Update each mechanism state with its own tau (section 4.16 / per-section time constants).
5. Sum mechanism states to the marker; derive ApoB, non-HDL-C, TC/HDL, HOMA-IR, MAP.
6. Output relative change vs day-0 value and the absolute value from the NHANES generator; attach the evidence grade and, where relevant, the uncertainty band (section 4.16 SD columns; +/- CI of the coefficients).
7. Raise safety flags (section 9) from the *state values*, not from the inputs.
Default toggles: LEM term on (grade C/D, label it), omega-3 dose-response "conservative" (0.09), sodium-lipid effect off, sugar compromise term on, CRP threshold rule on.

---------------------------------------------------------------------------------------------------

## 5. Interactions with other subsystems

| Module | Needs from it | Gives to it |
|---|---|---|
| #01 body-weight model | daily weight, fat mass, %WL, rate of loss (active vs stable flag), energy intake vs expenditure (deficit fraction D_def, surplus S) | none (biomarkers are read-outs); optional feedback: none (no evidence that these markers change energy balance except through #12 appetite) |
| #02 energy expenditure | maintenance EE for D_def = 1 - EI/EE | - |
| #04 carbohydrate/glycogen/insulin | glucose and insulin dynamics (24-h), glycaemic load, DNL flux, fibre-vs-net-carb definitions, sugars split | FPG, HbA1c, fasting insulin, HOMA-IR, IHTG (as slow state); TG (DNL) — avoid double counting: if #04 simulates hepatic DNL, drive f_cr/f_sugar terms from its DNL instead of from s_keto/sugar %E |
| #05 ketosis | s_keto in [0,1], BHB (mM) | LEM/LDL, TG multiplier, IHTG f_cr, uric-acid term consume it; receive nothing back |
| #09 resistance training, #10 cardio | weekly aerobic METs-h, RT sets, isometric work, detraining time | HDL, TG, BP, IHTG, VAT, CRP terms |
| #11 overfeeding | energy surplus S and macro composition of the surplus (SFA/UNSAT/sugar shares) | IHTG D-state, VAT partition flag, TG (sugar) |
| #12 hormones/appetite | - | (optional) leptin correlates with weight loss; no direct interaction here |
| #13 transitions | timing of diet switches | this module supplies the transient time-constants (section 4.16) so that a switch from very-low-carbohydrate to high-carbohydrate shows: LDL falling over ~3 weeks (tau ~10 d), TG rising within days (tau 4 d), IHTG rebounding over weeks (up tau 21 d), urate falling within a week |
| #14 anthropometrics/fat distribution | fat mass, VAT/SAT partition, BMI | supplies k_v, exercise VAT term, composition flags (SFA fraction of surplus) for its partition |
| #15 micronutrients/fibre/sodium/alcohol | daily sodium, potassium, viscous-fibre g, sterols, alcohol g, hydration | BP, LDL (fibre), TG/HDL/urate (alcohol) terms; **water/sodium weight effects belong to #15**, BP effect here |
| #16 sleep/stress/sex/age | menopause status, sleep debt, stress | modifies baselines (women +LDL after 50: 8.6 mg/dL/decade already in generator) and CRP/BP; no coefficients located in this dossier for sleep/stress effects on these markers (gap) |
| #17 safety | thresholds in section 9 | warnings |
| #18 planner | goal metrics (section 6) and per-marker feasible ranges | forward model calls |

---------------------------------------------------------------------------------------------------

## 6. Output metrics for the UI

| Metric | Unit | Good direction | Computation | Grade |
|---|---|---|---|---|
| ApoB | mg/dL | down (primary lipid goal) | 11.1 + 0.587*(LDL + TG/5 + Lp(a)-independent) ; or 0.587 x nonHDL + 11.1 | A (as marker of atherogenic particle number, R43b); B (simulated change) |
| non-HDL-C | mg/dL | down | TC - HDL = LDL + VLDL-C (TG/5) | A/B |
| LDL-C | mg/dL | down | state | A (composition), B-D (LEM tail) |
| HDL-C | mg/dL | descriptive (no planner weight) | state | A (response), causal value weak (R43) |
| Triglycerides | mg/dL | down | state | A/B |
| TG/HDL ratio | - | down | TG/HDL; marker of insulin resistance and of low-carbohydrate response (also a *predictor* of LMHR) | B |
| TC/HDL | - | down | (LDL+HDL+TG/5)/HDL | A (Mensink ratio) |
| SBP, DBP, MAP | mmHg | down | states; MAP = DBP + (SBP-DBP)/3 | A |
| Fasting glucose | mg/dL | down toward 70-99 | state | B |
| HbA1c | % | down toward <5.7 | state (tau 50 d) | B |
| Fasting insulin / HOMA-IR | uU/mL / - | down | state; HOMA = FPG*INS/405 | B |
| hs-CRP | mg/L | down | state | B |
| IHTG (liver fat) | % | down (<5.56 %) | state | A (direction), C (absolute) |
| ALT | U/L | down | state | C |
| Uric acid | mg/dL | down (warn if rising >0.7 x baseline SD or above 7) | state | B/C |
| VAT | cm3 (relative %) | down | #14 partition + coefficients here | B |
| "Atherogenic exposure" | ApoB (mg/dL) x days above target | down | integral of ApoB(t) over the schedule; per-10-mg/dL ApoB risk scaling is a *lifetime genetic* estimate (OR 0.77 per -10 mg/dL) and must not be applied to short diet interventions | B/C |
Planner goal compatibility notes: (i) "Lower ApoB" and "maximise ketone level/ketosis" are *compatible on average* but *conflict for lean, insulin-sensitive users* (LEM tail) -> the planner should evaluate with the user's BMI; (ii) "Lower liver fat fast" is *compatible* with ketosis and with calorie deficit (both act within days) and with resistance/aerobic training; (iii) "Lower BP" is compatible with all body-composition goals except heavy sodium/alcohol; (iv) "Raise HDL" should not be offered as an independent goal (weak causal target); (v) "Lower HbA1c in <4 weeks" is infeasible because of the 50-day time constant (only ~55 % of the steady-state change is visible in 4 weeks).

---------------------------------------------------------------------------------------------------

## 7. Validation targets (reproduce within tolerance)

| # | Study (ref) | Conditions in | Outcome out | Tolerance |
|---|---|---|---|---|
| V1 | Mensink 2016 (R1) | 10 %E SFA replaced isocalorically by cis-PUFA (adult, ~4-8 wk feeding); 10 %E carbohydrate replaced by SFA | LDL -0.55 mmol/L (-21 mg/dL); TC -0.64, HDL -0.05, TG -0.10. Carb->SFA: LDL +0.36, HDL +0.11, TG -0.12 mmol/L | +/-25 % |
| V2 | Clarke 1997, Weggemans 2001 (R4,R5) | +200 mg/day dietary cholesterol for ~1 month | TC +0.11-0.13 mmol/L, LDL +0.10 mmol/L | +/-30 % |
| V3 | Skulas-Ray 2011 (R38b) | 0.85 vs 3.4 g/d EPA+DHA, 8 weeks, men with TG 150-500 (baseline ~237 mg/dL) | TG 237 -> 173 mg/dL (-27 %) at 3.4 g/d; no effect at 0.85 g/d; LDL, HDL, CRP unchanged | TG +/-8 percentage points |
| V4 | Browning 2011 (R53b) | NAFLD BMI 35; 2 weeks 1200-1500 kcal vs <20 g carbohydrate/d | weight -4.0 vs -4.6 kg; IHTG -28 % vs -55 % | +/-10 points |
| V5 | Mardinoglu 2018 (R53c) | 10 obese NAFLD adults, IHTG 16.0 %, isocaloric 3115 kcal/d, <30 g carbohydrate, 14 days | IHTG -43.8 % (significant at day 1), weight -1.8 %, plasma TG -48 %, DNL -80 %; return toward baseline 1-3 months after resuming the usual diet | IHTG +/-10 points |
| V6 | Lim 2011 (R56) | 11 T2D, BMI 33.6, 600 kcal/day x 8 weeks | FPG 9.2 -> 5.9 mmol/L by week 1; TG 2.4 -> 1.2 mmol/L in week 1; IHTG 12.8 -> 2.9 % (-30 % in week 1); weight -15.3 kg | +/-20 % |
| V7 | Luukkonen 2018 (R54); Rosqvist 2014/2019 (R54b,R54c) | +1000 kcal/d for 3 weeks (SFA / UNSAT / simple sugar); 7-8 weeks SFA vs n-6 PUFA overfeeding | IHTG +55 % / +15 % / +33 % (3 wk); 8 wk: SFA +50 % vs PUFA ~0 at equal +2.0-2.3 kg; VAT gain 2x greater with SFA | +/-15 points |
| V8 | Magkos 2016 (R30) | obese, weight-stable after 5.1 / 10.8 / 16.4 % weight loss | IHTG 8.5 -> 7.4 / 4.1 / 3.0 %; insulin 18.3 -> 15.5 / 12.6 / 9.5; TG 153 -> 130 / 110 / 97; ALT 18 -> 15 / 11 / 11; CRP 4.7 -> 4.7 / 5.5 / 3.1 (threshold); LDL, HDL, FPG ~unchanged | +/-15 % (CRP: correct sign only at 16 %) |
| V9 | Appel 1997; Juraschek 2017; Sacks 2001 (R46b, R46c, R46) | DASH for 8 weeks (typical sodium); DASH vs control; sodium 150 -> 50 mmol/d on control diet | DASH SBP/DBP -5.5/-3.0 (hypertensives -11.4/-5.5); by week 1 already -4.4/-1.1; sodium 150 -> 50 (control diet) SBP -6.7 with no plateau at 4 wk (-0.94/-0.70 mmHg/week) | +/-1.5 mmHg |
| V10 | Tahara 1995 (R48b) | abrupt normalisation of glycaemia | HbA1c falls linearly over 2 months, half-time 34.6 d (SD 10.1) | half-time +/-10 d |
| V11 | Buren 2021 (R11), Retterstoel 2018 (R12) vs Petersen 2026 (R24) | (a) lean young women, keto 4 weeks; (b) normal-weight adults <20 g carbohydrate 3 weeks; (c) BMI 39 adults, keto with ~10.5 % weight loss | (a) LDL +70 mg/dL, 17/17 increased; (b) LDL +0.9 mmol/L (+35 mg/dL, +44 %), individual +5..+107 %; (c) LDL -10 mg/dL (-9 %), ApoB -6 mg/dL — the engine must flip sign with BMI | sign and order of magnitude |
| V12 | DIETFITS (R20) | 12 months, ~-5.3 vs -6.0 kg (low-fat vs low-carbohydrate, healthy) | LDL -2.1 vs +3.6 mg/dL; TG -10 vs -28; HDL +0.4 vs +2.6; SBP -3.2/-3.7; FPG -3.7/-2.1; insulin -2.6/-2.3 | +/-4 mg/dL (lipids), +/-1 mmHg |
| V13 | Grundler 2024 (R63k) | fasting 4-21 days | uric acid +100 (low ketonuria) to +200 umol/L (high ketonuria) | +/-40 % |
| V14 | Neter 2003 (R41); Dattilo 1992 (R39) | weight loss per kg | SBP -1.05, DBP -0.92 mmHg per kg; HDL +0.35 mg/dL per kg (stable) vs -0.27 (active) | +/-30 % |

---------------------------------------------------------------------------------------------------

## 8. Myths / contested claims

1. **"Dietary cholesterol/eggs don't matter" vs "eggs are dangerous".** Controlled trials show a small, saturable, highly individual effect: +0.056 mmol/L TC per 100 mg/d (R5), LDL +6.7 mg/dL on average (R6); response SD 14-16 mg/dL per 500 mg/d, part of it a stable trait (R9). No conclusion about CVD outcomes can be drawn from these lipid data (R6 explicitly).
2. **"Saturated fat does not raise LDL."** In controlled feeding SFA raises LDL-C dose-dependently vs carbohydrate (+0.036 mmol/L per %E) and even more vs PUFA (0.055) (R1); but the effect depends on chain length (12:0-16:0 raise; 18:0 does not, R2), the food matrix (cheese < butter; R37b) and the baseline LDL. "SFA is the only driver of LDL on ketogenic diets" is also false: LMHR magnitudes cannot be explained by SFA (4.3).
3. **"Keto raises LDL" / "keto lowers LDL".** Neither is generally true: mean +5 to +6 mg/dL vs low-fat in mixed RCT populations (R15-R18), -10 mg/dL in BMI 39 during matched weight loss (R24), but +35 to +250 mg/dL in lean people (R10-R12).
4. **"High LDL in the lean-hyper-responder phenotype is benign."** Unproven either way. KETO-CTA (R14) found no plaque difference vs matched controls (n=80 per group, 4.7 y, LDL 272 vs 123) but no LDL-plaque correlation and no outcomes; mendelian randomisation says ApoB particle number, not the origin of LDL, predicts risk (R43b). The engine should show ApoB and flag it.
5. **"Raise your HDL."** Genetic HDL elevation does not lower MI risk (R43). Exercise, weight loss and alcohol raise HDL, but do not add planner value on their own.
6. **"Fructose is uniquely toxic."** Isocaloric fructose exchange has no effect on TG, ApoB, LDL, IHTG or urate (R35b, R35e, R63b); harm arises from *excess energy* (+21-35 %E) and from sugar-sweetened beverages (R35b-d, R63).
7. **"Carbohydrate always raises TG."** Only relative to fat/protein at the margin (-0.012 to -0.021 mmol/L per %E for fat vs carbohydrate, R1) and with energy excess/alcohol; TG falls with any weight loss.
8. **"The n-6:n-3 ratio drives inflammation."** Randomised trials of LA show no change in AA or inflammatory markers (R64e, R64f); LA biomarkers are *inversely* related to CVD (R64b); the ratio is a poor metric (R64). What is truly low in the Western diet is EPA+DHA (median 0.02 g/d).
9. **"Salt only matters in hypertension."** The linear dose-response exists in normotensives too (-1.0 mmHg SBP per g Na, R45), though ~2.8x smaller than in hypertensives; benefits below 2 g/d in normotensives are unproven (R45).
10. **"Low-carb has a metabolic advantage for fat loss."** DIETFITS (R20) and pooled analyses (R19) show equal weight/fat loss at 6-12 months; the short-term ward study actually favoured fat restriction (R26). The *hepatic* advantage of very-low-carbohydrate (IHTG, HbA1c in prediabetes) at equal weight loss is real (R24, R25) but is a separate mechanism.
11. **"Weight loss lowers LDL a lot."** LDL falls only modestly (~0.6 mg/dL per kg; none in Look AHEAD) while TG, glucose, insulin, BP, liver fat respond far more (R42, R30, R41).
12. **"Liver fat takes months to fix."** It falls 30-55 % within 1-2 weeks of energy or carbohydrate restriction (R53-R56) and re-accumulates on overfeeding within 3 weeks (R54, R54d).
13. **"HbA1c is the average of the last 3 months."** It is exponentially weighted to recent weeks (half-time ~35 d) (R48b); a 4-week intervention shows only ~55 % of its final HbA1c change.
14. **"Exercise without weight loss does nothing."** VAT -6 % (R61), IHTG -21 % (R55c), BP -3.5/-2.5 mmHg (R50), HDL +2.5 mg/dL (R44), CRP ES 0.19 (R62b), TG -7 mg/dL (R44b).
15. **"Fasting/keto is uniformly protective; gout is a myth for fasters."** Ketosis raises urate by 1.7-3.4 mg/dL within days-weeks (R63k, R63l).
16. **"Any weight loss lowers CRP."** In BMI-40 insulin-resistant adults CRP did not change at 5 % and 11 % loss (R30), although across studies the slope is -0.13 mg/L per kg (R62).

---------------------------------------------------------------------------------------------------

## 9. Safety bounds relevant to this topic (inputs for #17; the planner must not prescribe beyond them, the simulator may simulate with a warning)

- **Triglycerides:** AHA categories: hypertriglyceridaemia 200-499 mg/dL, very high >=500 mg/dL (R38). Warn when predicted TG >= 500 mg/dL (pancreatitis risk in the clinical literature, UNVERIFIED here); the planner must not combine high alcohol, high sugar surplus and carbohydrate overfeeding when baseline TG is >= 200 mg/dL.
- **LDL-C:** warn when predicted LDL-C >= 190 mg/dL (2018 AHA/ACC severe-hypercholesterolaemia/FH-evaluation threshold; UNVERIFIED here, KETO-CTA used it as inclusion, R14) or when LDL-C rises >50 % from baseline within 8 weeks on a carbohydrate-restricted diet in a lean user (LEM tail). Recommend a measured lipid panel with ApoB; planner should not select regimens whose only projected benefit requires a large LEM-type LDL rise.
- **Blood pressure:** hypertension categories per the 2025 AHA/ACC guideline (R66; not opened; thresholds UNVERIFIED); warn on predicted SBP >= 180 or < 90 mmHg; sodium < 1.5 g/d and potassium supplementation > ~2.5-3 g/d (net +65-80 mmol/d) only with medical supervision — the potassium dose-response is U-shaped with BP *rising* above ~80 mmol/d net excess, particularly in people on antihypertensive drugs (R47b); very low sodium raises renin/aldosterone/noradrenaline (R45b, R45c).
- **Glycaemia:** HbA1c >= 6.5 % / FPG >= 126 mg/dL: outside the "average adult" generator; if the user reports diabetes medication (insulin, sulfonylureas, SGLT2 inhibitors) energy/carbohydrate restriction requires medical supervision (hypoglycaemia/ketoacidosis) — defer to #17. SGLT2 inhibitors raise LDL and ketones (mechanism cited in R10, secondary UNVERIFIED).
- **Uric acid / gout / kidney stones:** fasting or ketosis raises urate 1.7-3.4 mg/dL (R63k); warn when baseline urate >= 7 mg/dL (M) / 6 mg/dL (F), history of gout/uric-acid stones, CKD, or when planned fasts >= 4 days or BHB > 3 mM are combined with alcohol/fructose loading.
- **Liver:** rapid weight loss >1.5 kg/week and very low energy intake reduce liver fat quickly but carry gallstone/transaminase-flare risks (UNVERIFIED here; #17).
- **Omega-3:** EPA+DHA > 3 g/d is a "pharmacological" dose (AHA, R38); simulate up to 4 g/d with a warning at >= 3 g/d (atrial fibrillation/bleeding concerns are clinical-literature, UNVERIFIED here).
- **Alcohol:** > 2 drinks/day raises BP, TG, urate and liver fat; the model is valid only to ~100 g/d (R36 upper range); beyond that show a non-simulated warning.
- **Validity domain:** adults 20-79, non-pregnant, no lipid-lowering, antihypertensive or glucose-lowering drugs, no familial hypercholesterolaemia (LDL response differs), no renal or advanced liver disease; sex-specific baselines; extrapolation to BMI < 18.5 and > 45 is unsupported by the coefficients.

---------------------------------------------------------------------------------------------------

## 10. Open questions / weakest assumptions

1. **LEM/LMHR term (A_LEM = 45 mg/dL at BMI 22, slope -4.5/BMI unit, tau 10 d, lognormal sigma 0.6).** Based on one self-selected survey (n=548), two small feeding trials in lean adults (n=17, n=15 per arm), a n=1 experiment and RCT means in obese cohorts. The energy-balance modifier (deficit raises LDL, surplus lowers it) is grade D (n=1 plus 24-person case series). BMI is a proxy: fat mass/adipose "buffer", training status, sex and baseline TG/HDL are all confounded.
2. **Additivity of LDL terms** (Mensink composition + LEM + weight + portfolio components) and the DASH x sodium interaction are assumed; sub-additivity is only known qualitatively (portfolio: -17 % pooled vs -28.6 % in the 1-month trial).
3. **Time constants** for LDL (7-10 d), TG (4-45 d by mechanism), BP sodium (21 d), liver fat (12/21 d, D state 120 d), CRP (30-60 d), urate (5-7 d) are inferred from trial durations, single time-course studies (Juraschek, Lim, Mardinoglu, Grundler) or mechanism, not from dense time-series in each case.
4. **Per-kg weight coefficients for LDL, TG and urate** are derived from mixed studies (Zomer's mean weight loss was not visible in the abstract; Look AHEAD is T2D on statins; Dessein is 13 gout patients). Threshold behaviour of CRP rests on one RCT (n=9 completers at the 16 % step).
5. **Omega-3 TG dose-response** below 1 g/d and in normolipidaemia (spline plateau ~-40 mg/dL) and the conflict between meta-analyses (Wang: -43 mg/dL at 2 g/d vs Balk/Eslick: -27 to -30 mg/dL at ~3.25 g/d) — two toggles are provided.
6. **Sustained hepatic advantage of ketosis** at equal weight loss (Kirk: gone at 11 weeks; Petersen: present at ~10 % loss) and the mitochondrial-redox trade-off signal (Qadri) are unresolved.
7. **Sex/age moderators of Mensink coefficients:** 65 % men, mean age 39; menopausal change in LDL-lowering response, and ethnic differences, are not modelled.
8. **Baselines are US-population cross-sectional** (NHANES 2017-2020; ApoB 2013-14; DXA VAT 2017-18 ages 20-59 only). DXA VAT is an algorithmic estimate; ethnicity, medication use beyond lipid/BP/diabetes, and secular trends not included; FPG SD is inflated by undiagnosed diabetes.
9. **Hegsted equation coefficients (2.16, -1.65, 0.097)** could not be verified in a primary source; the 2003 Mensink HDL P-value row is misaligned in the source PDF; minus signs in the extracted 2003 tables were restored by CI arithmetic (checked internally consistent).
10. **Uric acid ketone slope (0.6 mg/dL per mM BHB)** and alcohol slope (0.013 mg/dL per g) are single-cohort/patient-derived; time constants unknown.
11. **n-3 effects on BP/CRP** are small and heterogeneous; included only as optional terms.
12. **Effects of sleep, stress, smoking, medications** on these markers are outside the sources retrieved here (gap for #16).

---------------------------------------------------------------------------------------------------

## 11. References

(Numbering is stable; letter suffixes group closely related items. Where a PMC/DOI is given the abstract and/or full text was read in this session. URLs are PubMed unless noted.)

**Fatty acids, cholesterol, lipids**
- R1. Mensink RP. Effects of saturated fatty acids on serum lipids and lipoproteins: a systematic review and regression analysis. Geneva: WHO; 2016 (ISBN 978-92-4-156534-9). Tables read from "Updated systematic review examining the effect of fatty acids on serum lipids", Maastricht University 2016, FSANZ Supporting Document 1: https://www.foodstandards.gov.au/sites/default/files/publications/Documents/Supporting%20Document%201_Mensink_compiled%2018_July_RM.pdf
- R2. Mensink RP, Zock PL, Kester AD, Katan MB. Effects of dietary fatty acids and carbohydrates on the ratio of serum total to HDL cholesterol and on serum lipids and apolipoproteins: a meta-analysis of 60 controlled trials. Am J Clin Nutr 2003;77:1146-55. PMID 12716665. DOI 10.1093/ajcn/77.5.1146.
- R3. Mensink RP, Katan MB. Effect of dietary fatty acids on serum lipids and lipoproteins. A meta-analysis of 27 trials. Arterioscler Thromb 1992;12:911. PMID 1386252. DOI 10.1161/01.atv.12.8.911.
- R4. Clarke R, Frost C, Collins R, Appleby P, Peto R. Dietary lipids and blood cholesterol: quantitative meta-analysis of metabolic ward studies. BMJ 1997;314:112-7. PMID 9006469. DOI 10.1136/bmj.314.7074.112.
- R5. Weggemans RM, Zock PL, Katan MB. Dietary cholesterol from eggs increases the ratio of total cholesterol to HDL cholesterol in humans: a meta-analysis. Am J Clin Nutr 2001;73:885-91. PMID 11333841. DOI 10.1093/ajcn/73.5.885.
- R6. Berger S, Raman G, Vishwanathan R, Jacques PF, Johnson EJ. Dietary cholesterol and cardiovascular disease: a systematic review and meta-analysis. Am J Clin Nutr 2015;102:276-94. PMID 26109578. DOI 10.3945/ajcn.114.100305.
- R7. Keys A, Anderson JT, Grande F. Serum cholesterol response to changes in the diet. II. The effect of cholesterol in the diet. Metabolism 1965;14:759-65. PMID 25286460. DOI 10.1016/0026-0495(65)90002-8. R7b (secondary source for the SFA/PUFA form of the Keys equation; advocacy-leaning review, used only for the equation text): Newport MT, Dayrit FM. Nutrients 2024;16(10):1447. PMC11123895. DOI 10.3390/nu16101447.
- R8. Hegsted DM, McGandy RB, Myers ML, Stare FJ. Quantitative effects of dietary fat on serum cholesterol in man. Am J Clin Nutr 1965;17:281-95. PMID 5846902 (R8a; abstract only). Hegsted DM. Serum-cholesterol response to dietary cholesterol: a re-evaluation. Am J Clin Nutr 1986;44:299-305. PMID 3524188 (R8b). Hegsted DM, Ausman LM, Johnson JA, Dallal GE. Dietary fat and serum lipids: an evaluation of the experimental data. Am J Clin Nutr 1993;57:875-83. PMID 8503356 (R8c).
- R9. Katan MB, Beynen AC. Characteristics of human hypo- and hyperresponders to dietary cholesterol. Am J Epidemiol 1987. PMID 3544818 (R9a). Beynen AC, Katan MB. Reproducibility of the variations between humans in the response of serum cholesterol to cessation of egg consumption. Atherosclerosis 1985. PMID 3907645 (R9b).
- R10. Norwitz NG, Feldman D, Soto-Mota A, Kalayjian T, Ludwig DS. Elevated LDL cholesterol with a carbohydrate-restricted diet: evidence for a "lean mass hyper-responder" phenotype. Curr Dev Nutr 2022;6:nzab144. PMID 35106434. PMC8796252. DOI 10.1093/cdn/nzab144.
- R11. Burén J, Ericsson M, Damasceno NRT, Sjödin A. A ketogenic low-carbohydrate high-fat diet increases LDL cholesterol in healthy, young, normal-weight women: a randomized controlled feeding trial. Nutrients 2021;13:814. PMID 33801247. DOI 10.3390/nu13030814.
- R12. Retterstøl K, et al. Effect of low carbohydrate high fat diet on LDL cholesterol and gene expression in normal-weight, young adults: a randomized controlled study. Atherosclerosis 2018;279:52-61. PMID 30408717. DOI 10.1016/j.atherosclerosis.2018.10.013.
- R13. Feldman D et al. Short-term hyper-caloric high-fat feeding on a ketogenic diet can lower LDL cholesterol: the cholesterol drop experiment. Curr Opin Endocrinol Diabetes Obes 2022. PMID 35938774. DOI 10.1097/MED.0000000000000762 (R13a). Norwitz NG et al. Case report: hypercholesterolemia "lean mass hyper-responder" phenotype presents in the context of a low saturated fat carbohydrate-restricted diet. Front Endocrinol 2022. PMID 35498420. DOI 10.3389/fendo.2022.830325 (R13b).
- R14. Budoff M, Manubolu VS, Kinninger A, et al. Carbohydrate restriction-induced elevations in LDL-cholesterol and atherosclerosis: the KETO trial. JACC Adv 2024;3:101109. PMID 39372369. DOI 10.1016/j.jacadv.2024.101109.
- R15. Bueno NB, de Melo IS, de Oliveira SL, da Rocha Ataide T. Very-low-carbohydrate ketogenic diet v. low-fat diet for long-term weight loss: a meta-analysis of randomised controlled trials. Br J Nutr 2013;110:1178-87. PMID 23651522. DOI 10.1017/S0007114513000548.
- R16. Mansoor N, Vinknes KJ, Veierød MB, Retterstøl K. Effects of low-carbohydrate diets v. low-fat diets on body weight and cardiovascular risk factors: a meta-analysis of randomised controlled trials. Br J Nutr 2016;115:466-79. PMID 26768850. DOI 10.1017/S0007114515004699.
- R17. Hu T, Mills KT, Yao L, et al. Effects of low-carbohydrate diets versus low-fat diets on metabolic risk factors: a meta-analysis of randomized controlled clinical trials. Am J Epidemiol 2012;176(Suppl 7):S44-54. PMID 23035144. DOI 10.1093/aje/kws264.
- R18. Chawla S, Tessarolo Silva F, Amaral Medeiros S, Mekary RA, Radenkovic D. The effect of low-fat and low-carbohydrate diets on weight loss and lipid levels: a systematic review and meta-analysis. Nutrients 2020;12:3774. PMID 33317019. DOI 10.3390/nu12123774.
- R19. Ge L, Sadeghirad B, Ball GDC, et al. Comparison of dietary macronutrient patterns of 14 popular named dietary programmes for weight and cardiovascular risk factor reduction in adults: systematic review and network meta-analysis of randomised trials. BMJ 2020;369:m696. PMID 32238384. DOI 10.1136/bmj.m696.
- R20. Gardner CD, et al. Effect of low-fat vs low-carbohydrate diet on 12-month weight loss in overweight adults and the association with genotype pattern or insulin secretion: the DIETFITS randomized clinical trial. JAMA 2018. PMID 29466592. PMC5839290. DOI 10.1001/jama.2018.0245.
- R21. Soto-Mota A et al. Evidence for the carbohydrate-insulin model in a reanalysis of the DIETFITS trial. Am J Clin Nutr 2023. PMID 36811468. DOI 10.1016/j.ajcnut.2022.12.014.
- R22. Follis S et al. Effect of low-carbohydrate vs low-fat diet intervention on visceral fat estimated from DXA in a 12-month randomized controlled trial. Int J Obes 2026. PMID 41436888. DOI 10.1038/s41366-025-01989-x.
- R23. Sacks FM, et al. Comparison of weight-loss diets with different compositions of fat, protein, and carbohydrates. N Engl J Med 2009. PMID 19246357. DOI 10.1056/NEJMoa0804748.
- R24. Petersen MC et al. Effect of diet macronutrient content on the cardiometabolic response to weight loss: a randomized clinical trial. Cell Metab 2026. PMID 42660124. PMC13551625. DOI 10.1016/j.cmet.2026.07.020. (Very recent; abstract and full text read.)
- R25. Qadri SF et al. Distinct effects of ketogenic and non-ketogenic weight-loss diets on hepatic steatosis and mitochondrial metabolism in MASLD. J Hepatol 2026. PMID 41655910. DOI 10.1016/j.jhep.2026.02.001.
- R26. Hall KD, et al. Calorie for calorie, dietary fat restriction results in more body fat loss than carbohydrate restriction in people with obesity. Cell Metab 2015. PMID 26278052. DOI 10.1016/j.cmet.2015.07.021.
- R27. Brown L, et al. Cholesterol-lowering effects of dietary fiber: a meta-analysis. Am J Clin Nutr 1999;69:30-42. PMID 9925120. DOI 10.1093/ajcn/69.1.30. R27b: Anderson JW, et al. Psyllium adjunctive to diet therapy in hypercholesterolemia: meta-analysis of 8 controlled trials. Am J Clin Nutr 2000;71:472-9. PMID 10648260.
- R28. Whitehead A, et al. Cholesterol-lowering effects of oat beta-glucan: a meta-analysis of randomized controlled trials. Am J Clin Nutr 2014. PMID 25411276. DOI 10.3945/ajcn.114.086108. R28b: Ho HV, et al. Barley beta-glucan on LDL-C, non-HDL-C and apoB. Eur J Clin Nutr 2016. PMID 27273067. DOI 10.1038/ejcn.2016.89.
- R29. Jovanovski E, et al. Effect of psyllium fiber on LDL cholesterol and alternative lipid targets, non-HDL cholesterol and apolipoprotein B: a systematic review and meta-analysis of RCTs. Am J Clin Nutr 2018. PMID 30239559. DOI 10.1093/ajcn/nqy115. R29b: Jovanovski E et al. Are all fibres created equal with respect to lipid lowering? Br J Nutr 2023. PMID 35929339. DOI 10.1017/S0007114522002355. R29c: Ho HVT, et al. Konjac glucomannan on LDL-C, non-HDL-C and apoB. Am J Clin Nutr 2017. PMID 28356275. DOI 10.3945/ajcn.116.142158.
- R30. Magkos F, et al. Effects of moderate and subsequent progressive weight loss on metabolic function and adipose tissue biology in humans with obesity. Cell Metab 2016. PMID 26916363. PMC4833627. DOI 10.1016/j.cmet.2016.02.005.
- R31. Ras RT, et al. LDL-cholesterol-lowering effect of plant sterols and stanols across different dose ranges: a meta-analysis of randomised controlled studies. Br J Nutr 2014. PMID 24780090. PMC4071994. DOI 10.1017/S0007114514000750. R31b: Demonty I, et al. Continuous dose-response relationship of the LDL-cholesterol-lowering effect of phytosterol intake. J Nutr 2009. PMID 19091798. DOI 10.3945/jn.108.095125.
- R32. Tokede OA, et al. Soya products and serum lipids: a meta-analysis of randomised controlled trials. Br J Nutr 2015. PMID 26268987. DOI 10.1017/S0007114515002603. R32b: Anderson JW, et al. Meta-analysis of the effects of soy protein intake on serum lipids. N Engl J Med 1995. PMID 7596371. DOI 10.1056/NEJM199508033330502.
- R33. Del Gobbo LC, et al. Effects of tree nuts on blood lipids, apolipoproteins, and blood pressure: systematic review, meta-analysis, and dose-response of 61 controlled intervention trials. Am J Clin Nutr 2015. PMID 26561616. PMC4658458. DOI 10.3945/ajcn.115.110965. R33b: Sabaté J, et al. Nut consumption and blood lipid levels: a pooled analysis of 25 intervention trials. Arch Intern Med 2010. PMID 20458092. DOI 10.1001/archinternmed.2010.79.
- R34. Chiavaroli L, et al. Portfolio dietary pattern and cardiovascular disease: a systematic review and meta-analysis of controlled trials. Prog Cardiovasc Dis 2018. PMID 29807048. DOI 10.1016/j.pcad.2018.05.004. R34b: Jenkins DJ, et al. Effects of a dietary portfolio of cholesterol-lowering foods vs lovastatin on serum lipids and C-reactive protein. JAMA 2003. PMID 12876093. DOI 10.1001/jama.290.4.502.
- R35. Te Morenga LA, et al. Dietary sugars and cardiometabolic risk: systematic review and meta-analyses of randomized controlled trials of the effects on blood pressure and lipids. Am J Clin Nutr 2014. PMID 24808490. DOI 10.3945/ajcn.113.081521. R35b: Chiavaroli L, et al. Effect of fructose on established lipid targets: a systematic review and meta-analysis of controlled feeding trials. J Am Heart Assoc 2015. PMID 26358358. DOI 10.1161/JAHA.114.001700. R35c: Stanhope KL, et al. Consuming fructose-sweetened, not glucose-sweetened, beverages increases visceral adiposity and lipids and decreases insulin sensitivity in overweight/obese humans. J Clin Invest 2009. PMID 19381015. DOI 10.1172/JCI37385. R35d: Maersk M, et al. Sucrose-sweetened beverages increase fat storage in the liver, muscle, and visceral fat depot: a 6-mo randomized intervention study. Am J Clin Nutr 2012. PMID 22205311. DOI 10.3945/ajcn.111.022533. R35e: Chiu S, et al. Effect of fructose on markers of NAFLD: a systematic review and meta-analysis of controlled feeding trials. Eur J Clin Nutr 2014. PMID 24569542. DOI 10.1038/ejcn.2014.8.
- R36. Rimm EB, et al. Moderate alcohol intake and lower risk of coronary heart disease: meta-analysis of effects on lipids and haemostatic factors. BMJ 1999. PMID 10591709. DOI 10.1136/bmj.319.7224.1523.
- R37. R37a: Neelakantan N, et al. The effect of coconut oil consumption on cardiovascular risk factors: a systematic review and meta-analysis of clinical trials. Circulation 2020. PMID 31928080. DOI 10.1161/CIRCULATIONAHA.119.043052. R37b: Brassard D, et al. Comparison of the impact of SFAs from cheese and butter on cardiometabolic risk factors: a randomized controlled trial. Am J Clin Nutr 2017. PMID 28251937. DOI 10.3945/ajcn.116.150300. R37c: Chiu S, Williams PT, Krauss RM. Effects of a very high saturated fat diet on LDL particles in adults with atherogenic dyslipidemia: a randomized controlled trial. PLoS One 2017. PMID 28166253. PMC5293238. DOI 10.1371/journal.pone.0170664.
- R38. Skulas-Ray AC, et al. Omega-3 fatty acids for the management of hypertriglyceridemia: a science advisory from the American Heart Association. Circulation 2019. PMID 31422671. DOI 10.1161/CIR.0000000000000709. R38b: Skulas-Ray AC, et al. Dose-response effects of omega-3 fatty acids on triglycerides, inflammation, and endothelial function in healthy persons with moderate hypertriglyceridemia. Am J Clin Nutr 2011. PMID 21159789. PMC3138218. DOI 10.3945/ajcn.110.003871. R38c: Balk EM, et al. Effects of omega-3 fatty acids on serum markers of cardiovascular disease risk: a systematic review. Atherosclerosis 2006. PMID 16530201. DOI 10.1016/j.atherosclerosis.2006.02.012. R38d: Eslick GD, et al. Benefits of fish oil supplementation in hyperlipidemia: a systematic review and meta-analysis. Int J Cardiol 2009. PMID 18774613. DOI 10.1016/j.ijcard.2008.03.092. R38e: Wang T et al. Association between omega-3 fatty acid intake and dyslipidemia: a continuous dose-response meta-analysis of randomized controlled trials. J Am Heart Assoc 2023. PMID 37264945. PMC10381976. DOI 10.1161/JAHA.123.029512.
- R39. Dattilo AM, Kris-Etherton PM. Effects of weight reduction on blood lipids and lipoproteins: a meta-analysis. Am J Clin Nutr 1992;56:320-8. PMID 1386186. DOI 10.1093/ajcn/56.2.320. R39b: Poobalan A, et al. Effects of weight loss in overweight/obese individuals and long-term lipid outcomes: a systematic review. Obes Rev 2004. PMID 14969506. DOI 10.1111/j.1467-789x.2004.00127.x.
- R40. Zomer E, et al. Interventions that cause weight loss and the impact on cardiovascular risk factors: a systematic review and meta-analysis. Obes Rev 2016. PMID 27324830. DOI 10.1111/obr.12433.
- R41. Neter JE, Stam BE, Kok FJ, Grobbee DE, Geleijnse JM. Influence of weight reduction on blood pressure: a meta-analysis of randomized controlled trials. Hypertension 2003. PMID 12975389. DOI 10.1161/01.HYP.0000094221.86888.AE.
- R42. Wing RR, et al. Benefits of modest weight loss in improving cardiovascular risk factors in overweight and obese individuals with type 2 diabetes. Diabetes Care 2011. PMID 21593294. PMC3120182. DOI 10.2337/dc10-2415. R42b: Ryan DH, Yockey SR. Weight loss and improvement in comorbidity: differences at 5%, 10%, 15%, and over. Curr Obes Rep 2017. PMID 28455679. DOI 10.1007/s13679-017-0262-y.
- R43. Voight BF, et al. Plasma HDL cholesterol and risk of myocardial infarction: a mendelian randomisation study. Lancet 2012. PMID 22607825. DOI 10.1016/S0140-6736(12)60312-2. R43b: Ference BA, et al. Association of triglyceride-lowering LPL variants and LDL-C-lowering LDLR variants with risk of coronary heart disease. JAMA 2019. PMID 30694319. DOI 10.1001/jama.2018.20045.
- R44. Kodama S, et al. Effect of aerobic exercise training on serum levels of high-density lipoprotein cholesterol: a meta-analysis. Arch Intern Med 2007. PMID 17533202. DOI 10.1001/archinte.167.10.999. R44b: Halbert JA, et al. Exercise training and blood lipids in hyperlipidemic and normolipidemic adults: a meta-analysis of randomized, controlled trials. Eur J Clin Nutr 1999. PMID 10452405. R44c: Kelley GA, et al. Impact of progressive resistance training on lipids and lipoproteins in adults: a meta-analysis of randomized controlled trials. Prev Med 2009. PMID 19013187. DOI 10.1016/j.ypmed.2008.10.010. R44d: Kelley GA, et al. Comparison of aerobic exercise, diet or both on lipids and lipoproteins in adults: a meta-analysis of RCTs. Clin Nutr 2012. PMID 22154987. DOI 10.1016/j.clnu.2011.11.011. R44e: Slentz CA, et al. Inactivity, exercise training and detraining, and plasma lipoproteins. STRRIDE. J Appl Physiol 2007. PMID 17395756. DOI 10.1152/japplphysiol.01314.2006.
- R45. Filippini T, et al. Blood pressure effects of sodium reduction: dose-response meta-analysis of experimental studies. Circulation 2021. PMID 33586450. PMC8055199. DOI 10.1161/CIRCULATIONAHA.120.050371. R45b: He FJ, Li J, MacGregor GA. Effect of longer term modest salt reduction on blood pressure: Cochrane systematic review and meta-analysis of randomised trials. BMJ 2013. PMID 23558162. DOI 10.1136/bmj.f1325. R45c: Graudal NA, et al. Effects of low sodium diet versus high sodium diet on blood pressure, renin, aldosterone, catecholamines, cholesterol, and triglyceride. Cochrane Database Syst Rev 2017. PMID 28391629. DOI 10.1002/14651858.CD004022.pub4.
- R46. Sacks FM, et al. Effects on blood pressure of reduced dietary sodium and the DASH diet. N Engl J Med 2001. PMID 11136953. DOI 10.1056/NEJM200101043440101. R46b: Appel LJ, et al. A clinical trial of the effects of dietary patterns on blood pressure. N Engl J Med 1997. PMID 9099655. DOI 10.1056/NEJM199704173361601. R46c: Juraschek SP, et al. Time course of change in blood pressure from sodium reduction and the DASH diet. Hypertension 2017. PMID 28993451. PMC5659740. DOI 10.1161/HYPERTENSIONAHA.117.10017.
- R47. Aburto NJ, et al. Effect of increased potassium intake on cardiovascular risk factors and disease: systematic review and meta-analyses. BMJ 2013. PMID 23558164. DOI 10.1136/bmj.f1378. R47b: Filippini T, et al. Potassium intake and blood pressure: a dose-response meta-analysis of randomized controlled trials. J Am Heart Assoc 2020. PMID 32500831. PMC7429027. DOI 10.1161/JAHA.119.015719.
- R48. Nathan DM, et al. Translating the A1C assay into estimated average glucose values. Diabetes Care 2008. PMID 18540046. DOI 10.2337/dc08-0545. R48b: Tahara Y, et al. Kinetics of HbA1c, glycated albumin, and fructosamine and analysis of their weight functions against preceding plasma glucose level. Diabetes Care 1995;18:440-7. PMID 7497851. DOI 10.2337/diacare.18.4.440. R48c: Cohen RM, et al. Red cell life span heterogeneity in hematologically normal people is sufficient to alter HbA1c. Blood 2008. PMID 18694998. DOI 10.1182/blood-2008-04-154112.
- R49. Roerecke M, et al. The effect of a reduction in alcohol consumption on blood pressure: a systematic review and meta-analysis. Lancet Public Health 2017. PMID 29253389. DOI 10.1016/S2468-2667(17)30003-8.
- R50. Cornelissen VA, et al. Exercise training for blood pressure: a systematic review and meta-analysis. J Am Heart Assoc 2013. PMID 23525435. PMC3603230. DOI 10.1161/JAHA.112.004473. R50b: MacDonald HV, et al. Dynamic resistance training as stand-alone antihypertensive lifestyle therapy: a meta-analysis. J Am Heart Assoc 2016. PMID 27680663. DOI 10.1161/JAHA.116.003231. R50c: Pescatello LS, et al. ACSM position stand. Exercise and hypertension. Med Sci Sports Exerc 2004. PMID 15076798. DOI 10.1249/01.mss.0000115224.88514.3a. R50d: Carpio-Rivera E et al. Acute effects of exercise on blood pressure: a meta-analytic investigation. Arq Bras Cardiol 2016. PMID 27168471. DOI 10.5935/abc.20160064. R50e: Avila-Gandia V et al. Training, detraining and retraining effects of moderate vs high intensity exercise training programme on cardiovascular risk factors. J Hypertens 2023. PMID 36728639. DOI 10.1097/HJH.0000000000003346.
- R51. Millar JS, et al. Complete deficiency of the low-density lipoprotein receptor is associated with increased apolipoprotein B-100 production. Arterioscler Thromb Vasc Biol 2005. PMID 15637307. DOI 10.1161/01.ATV.0000155323.18856.a2.
- R52. Weinberger MH, et al. Definitions and characteristics of sodium sensitivity and blood pressure resistance. Hypertension 1986. PMID 3522418. DOI 10.1161/01.hyp.8.6_pt_2.ii127. R52b: Elijovich F, et al. Salt sensitivity of blood pressure: a scientific statement from the American Heart Association. Hypertension 2016. PMID 27443572. DOI 10.1161/HYP.0000000000000047 (abstract not retrievable; not used numerically).
- R53. Kirk E, et al. Dietary fat and carbohydrates differentially alter insulin sensitivity during caloric restriction. Gastroenterology 2009. PMID 19208352. PMC2677125. DOI 10.1053/j.gastro.2009.01.048. R53b: Browning JD, et al. Short-term weight loss and hepatic triglyceride reduction: evidence of a metabolic advantage with dietary carbohydrate restriction. Am J Clin Nutr 2011. PMID 21367948. PMC3076656. DOI 10.3945/ajcn.110.007674. R53c: Mardinoglu A, et al. An integrated understanding of the rapid metabolic benefits of a carbohydrate-restricted diet on hepatic steatosis in humans. Cell Metab 2018. PMID 29456073. PMC6706084. DOI 10.1016/j.cmet.2018.01.005.
- R54. Luukkonen PK, et al. Saturated fat is more metabolically harmful for the human liver than unsaturated fat or simple sugars. Diabetes Care 2018. PMID 29844096. PMC7082640. DOI 10.2337/dc18-0071. R54b: Rosqvist F, et al. Overfeeding polyunsaturated and saturated fat causes distinct effects on liver and visceral fat accumulation in humans. Diabetes 2014. PMID 24550191. DOI 10.2337/db13-1622. R54c: Rosqvist F, et al. Overeating saturated fat promotes fatty liver and ceramides compared with polyunsaturated fat: a randomized trial. J Clin Endocrinol Metab 2019. PMID 31369090. DOI 10.1210/jc.2019-00160. R54d: Sevastianova K, et al. Effect of short-term carbohydrate overfeeding and long-term weight loss on liver fat in overweight humans. Am J Clin Nutr 2012. PMID 22952180. DOI 10.3945/ajcn.112.038695.
- R55. Petersen KF, et al. Reversal of nonalcoholic hepatic steatosis, hepatic insulin resistance, and hyperglycemia by moderate weight reduction in patients with type 2 diabetes. Diabetes 2005. PMID 15734833. DOI 10.2337/diabetes.54.3.603. R55b: Vilar-Gomez E, et al. Weight loss through lifestyle modification significantly reduces features of nonalcoholic steatohepatitis. Gastroenterology 2015. PMID 25865049. DOI 10.1053/j.gastro.2015.04.005. R55c: Johnson NA, et al. Aerobic exercise training reduces hepatic and visceral lipids in obese individuals without weight loss. Hepatology 2009. PMID 19637289. DOI 10.1002/hep.23129. R55d: Keating SE, et al. Effect of aerobic exercise training dose on liver fat and visceral adiposity. J Hepatol 2015. PMID 25863524. DOI 10.1016/j.jhep.2015.02.022. R55e: Hashida R, et al. Aerobic vs. resistance exercise in non-alcoholic fatty liver disease: a systematic review. J Hepatol 2017. PMID 27639843. DOI 10.1016/j.jhep.2016.08.023.
- R56. Lim EL, et al. Reversal of type 2 diabetes: normalisation of beta cell function in association with decreased pancreas and liver triacylglycerol. Diabetologia 2011. PMID 21656330. PMC3168743. DOI 10.1007/s00125-011-2204-7.
- R57. Szczepaniak LS, et al. Magnetic resonance spectroscopy to measure hepatic triglyceride content: prevalence of hepatic steatosis in the general population. Am J Physiol Endocrinol Metab 2005. PMID 15339742. DOI 10.1152/ajpendo.00064.2004.
- R58. Cogswell ME, et al. Sodium and potassium intakes among US adults: NHANES 2003-2008. Am J Clin Nutr 2012. PMID 22854410. PMC3417219. DOI 10.3945/ajcn.112.034413.
- R59. Appel LJ, et al. Effects of protein, monounsaturated fat, and carbohydrate intake on blood pressure and serum lipids: results of the OmniHeart randomized trial. JAMA 2005. PMID 16287956. DOI 10.1001/jama.294.19.2455.
- R60. CDC National Center for Health Statistics. NHANES 2017-March 2020 pre-pandemic public-use files (DEMO, BMX, TCHOL, HDL, TRIGLY, GHB, GLU, INS, HSCRP, BIOPRO, BPXO, DIQ, BPQ, DR1TOT): https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2017/DataFiles/ ; NHANES 2013-14 (APOB_H, TRIGLY_H, HDL_H, TCHOL_H, DEMO_H, BMX_H) and NHANES 2017-18 DXA (DXXAG_J, DXX_J, DEMO_J, BMX_J): same host, folders 2013 and 2017. Statistics computed by the research agent (weighted means, SDs, weighted least squares, correlations); scripts and outputs are reproducible from these files.
- R61. Verheggen RJ, et al. A systematic review and meta-analysis on the effects of exercise training versus hypocaloric diet: distinct effects on body weight and visceral adipose tissue. Obes Rev 2016. PMID 27213481. DOI 10.1111/obr.12406. R61b: Vissers D, et al. The effect of exercise on visceral adipose tissue in overweight adults: a systematic review and meta-analysis. PLoS One 2013. PMID 23409182. DOI 10.1371/journal.pone.0056415. R61c: Chaston TB, et al. Factors associated with percent change in visceral versus subcutaneous abdominal fat during weight loss: findings from a systematic review. Int J Obes 2008. PMID 18180786. DOI 10.1038/sj.ijo.0803761. R61d: Merlotti C, et al. Subcutaneous fat loss is greater than visceral fat loss with diet and exercise, weight-loss promoting drugs and bariatric surgery: a critical review and meta-analysis. Int J Obes 2017. PMID 28148928. DOI 10.1038/ijo.2017.31. R61e: Ohkawara K, et al. A dose-response relation between aerobic exercise and visceral fat reduction: systematic review of clinical trials. Int J Obes 2007. PMID 17637702. DOI 10.1038/sj.ijo.0803683.
- R62. Selvin E, et al. The effect of weight loss on C-reactive protein: a systematic review. Arch Intern Med 2007. PMID 17210875. DOI 10.1001/archinte.167.1.31. R62b: Fedewa MV, et al. Effect of exercise training on C reactive protein: a systematic review and meta-analysis of randomised and non-randomised controlled trials. Br J Sports Med 2017. PMID 27445361. DOI 10.1136/bjsports-2016-095999. R62c: Guo XF, et al. Effects of EPA and DHA on blood pressure and inflammatory factors: a meta-analysis of RCTs. Crit Rev Food Sci Nutr 2019. PMID 29993265. DOI 10.1080/10408398.2018.1492901. R62d: Schwingshackl L, et al. Mediterranean dietary pattern, inflammation and endothelial function: a systematic review and meta-analysis of intervention trials. Nutr Metab Cardiovasc Dis 2014. PMID 24787907. DOI 10.1016/j.numecd.2014.03.003. R62e: Khodarahmi M et al. Effect of low-carbohydrate diets on C-reactive protein level in adults: a systematic review and meta-analysis of RCTs. Food Sci Nutr 2025. PMID 40688603. PMC12274166. DOI 10.1002/fsn3.70566. R62f: Pepys MB, Hirschfield GM. C-reactive protein: a critical update. J Clin Invest 2003. PMID 12813013. PMC161431. DOI 10.1172/JCI18921. R62g: Fu L, et al. Associations between dietary fiber intake and cardiovascular risk factors: an umbrella review of meta-analyses of randomized controlled trials. Front Nutr 2022. PMID 36172520. PMC9511151. DOI 10.3389/fnut.2022.972399. R62h: Khalafi M, et al. The impact of exercise training versus caloric restriction on inflammation markers: a systemic review and meta-analysis. Crit Rev Food Sci Nutr 2022. PMID 33506692. DOI 10.1080/10408398.2021.1873732.
- R63. Ayoub-Charette S, et al. Different food sources of fructose-containing sugars and fasting blood uric acid levels: a systematic review and meta-analysis of controlled feeding trials. J Nutr 2021. PMID 34087940. PMC8349131. DOI 10.1093/jn/nxab144. R63b: Wang DD, et al. The effects of fructose intake on serum uric acid vary among controlled dietary trials. J Nutr 2012. PMID 22457397. DOI 10.3945/jn.111.151951. R63c: Nielsen SM, et al. Weight loss for overweight and obese individuals with gout: a systematic review of longitudinal studies. Ann Rheum Dis 2017. PMID 28866649. DOI 10.1136/annrheumdis-2017-211472. R63d: Dessein PH, et al. Beneficial effects of weight loss associated with moderate calorie/carbohydrate restriction, and increased proportional intake of protein and unsaturated fat on serum urate and lipoprotein levels in gout: a pilot study. Ann Rheum Dis 2000. PMID 10873964. DOI 10.1136/ard.59.7.539. R63e: Belanger MJ, et al. Effects of dietary macronutrients on serum urate: results from the OmniHeart trial. Am J Clin Nutr 2021. PMID 33668058. DOI 10.1093/ajcn/nqaa424. R63f: Juraschek SP, et al. Effects of dietary patterns on serum urate: results from a randomized trial of the effects of diet on hypertension. Arthritis Rheumatol 2021. PMID 33615722. DOI 10.1002/art.41614. R63g: Gohari S et al. The effect of DASH and ketogenic diets on serum uric acid concentration: a systematic review and meta-analysis of RCTs. Sci Rep 2023. PMID 37380733. DOI 10.1038/s41598-023-37672-2. R63h: Choi HK, et al. Alcohol intake and risk of incident gout in men: a prospective study. Lancet 2004. PMID 15094272. DOI 10.1016/S0140-6736(04)16000-5. R63i: Choi HK, et al. Purine-rich foods, dairy and protein intake, and the risk of gout in men. N Engl J Med 2004. PMID 15014182. DOI 10.1056/NEJMoa035700. R63j: Faller J, et al. Ethanol-induced hyperuricemia: evidence for increased urate production by activation of adenine nucleotide turnover. N Engl J Med 1982. PMID 7144847. DOI 10.1056/NEJM198212233072602. R63k: Grundler F, et al. Long-term fasting-induced ketosis in 1610 subjects: metabolic regulation and safety. Nutrients 2024. PMID 38931204. PMC11206495. R63l: Goldfinger S, et al. Renal retention of uric acid induced by infusion of beta-hydroxybutyrate and acetoacetate. N Engl J Med 1965;272:351-5. PMID 14239117. DOI 10.1056/NEJM196502182720705.
- R64. Harris WS. The omega-6:omega-3 ratio: a critical appraisal and possible successor. Prostaglandins Leukot Essent Fatty Acids 2018. PMID 29599053. DOI 10.1016/j.plefa.2018.03.003. R64b: Marklund M, et al. Biomarkers of dietary omega-6 fatty acids and incident cardiovascular disease and mortality. Circulation 2019. PMID 30971107. PMC6582360. DOI 10.1161/CIRCULATIONAHA.118.038908. R64c: Ramsden CE, et al. Use of dietary linoleic acid for secondary prevention of coronary heart disease and death: evaluation of recovered data from the Sydney Diet Heart Study and updated meta-analysis. BMJ 2013. PMID 23386268. DOI 10.1136/bmj.e8707. R64d: Hooper L, et al. Omega-6 fats for the primary and secondary prevention of cardiovascular disease. Cochrane Database Syst Rev 2018. PMID 30488422. DOI 10.1002/14651858.CD011094.pub4. R64e: Johnson GH, et al. Effect of dietary linoleic acid on markers of inflammation in healthy persons: a systematic review of randomized controlled trials. J Acad Nutr Diet 2012. PMID 22889633. DOI 10.1016/j.jand.2012.03.029. R64f: Rett BS, et al. Increasing dietary linoleic acid does not increase tissue arachidonic acid content in adults consuming Western-type diets: a systematic review. Nutr Metab (Lond) 2011. PMID 21663641. PMC3132704. DOI 10.1186/1743-7075-8-36.
- R65. Krauss RM, et al. Separate effects of reduced carbohydrate intake and weight loss on atherogenic dyslipidemia. Am J Clin Nutr 2006. PMID 16685042. DOI 10.1093/ajcn/83.5.1025.
- R66. Jones DW, et al. 2025 AHA/ACC/AANP/AAPA/ABC/ACCP/ACPM/AGS/AMA/ASPC/NMA/PCNA/SGIM guideline for the prevention, detection, evaluation and management of high blood pressure in adults. J Am Coll Cardiol 2025. PMID 40815242. DOI 10.1016/j.jacc.2025.05.007 (cited for context; thresholds not verified).
