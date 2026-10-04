# R13b: Glycaemic and urate markers (fasting glucose, HbA1c, fasting insulin and HOMA-IR, uric acid)

Date: 2026-10-02 · Plan 02 item 9 · Job R13b · Index and decisions: `plan/02-next/research-blood-markers.md` (cited as [S64]) · Machine-readable rows: `plan/02-next/research/R13-glycaemic-urate.json` (the tables below are generated from the same data).

**Grades** follow the index and R5: A means several RCTs or meta-analyses agree; B means some RCTs or strong cohorts; C means small, indirect or inconsistent evidence; D means mechanism or expert opinion only. A row marked "mechanistic expectation" has no measured human effect in the sources opened for this job.

**How sources were read.** Many PubMed pages showed only a cookie wall, so abstracts were read through the NCBI E-utilities and Europe PMC records for the same PMIDs. Where only an abstract was read, the magnitudes come from that abstract. Engine coefficients that come from `research/06` are cited as [S65]; their primary papers were not re-opened in this job, and each such row says so.

**Populations.** Most effect sizes for glucose and HbA1c come from people with type 2 diabetes or prediabetes. In people with normal glucose the same levers move these markers much less; psyllium shows this directly [S23]. The engine should scale effects by baseline (larger when glucose is higher) and not apply T2D magnitudes to people with normal values.

## Where this dossier differs from the index

| # | Index says | This dossier says | Why |
|---|---|---|---|
| 1 | Prediabetes FPG 100–125 mg/dL (ADA) | Use the ADA range for rules, and show RSSDI's 110–125 mg/dL as the Indian alternative on reports that print it | RSSDI 2022 uses 110 mg/dL for impaired fasting glucose, chosen on Indian cost-effectiveness grounds [S3] |
| 2 | HbA1c is unreliable with anaemia (ADA: iron deficiency *raises* HbA1c) | The direction is contested. An Indian study found HbA1c *lower* in iron-deficiency anaemia, rising 4.63 → 5.82 % after treatment [S9]. Rule W-L-HBA1C-3 warns in both directions and does not assume one | ADA's sentence on iron deficiency sits in the gestational-diabetes text [S1]. One Indian study (n=141) points the other way |
| 3 | Asian Indian HOMA-IR cut-off ≈ 2.5 (Singh 2013), grade B/C | Grade C. The 2.5 cut-off comes from **adolescents** aged 10–17 [S5]. A South Indian adult study proposed 1.23 [S6]. Insulin assays disagree by > 15 % [S7]. HOMA only ranks levers; it never caps one | Population and assay indirectness |
| 4 | Engine insulin conversion 1 µU/mL = 6.945 pmol/L (research/06) | Use **6.00** pmol/L per µU/mL | Knopp 2019: 6.945 is an artefact of the 1959 standard and under-reports insulin by about 15 % [S8]. E20 must convert pmol/L entries with 6.00 |
| 5 | HbA1c ≥ 6.5 or FPG ≥ 126 without a diagnosis: BLOCK_PLANNER until re-answered (W-L06) | Same trigger, expressed as a **re-ask** (`kind: "reask"`). Fasts > 24 h and VLC wait for the answer; the rest of the plan runs | The product rule says nothing is banned outright. A re-ask that holds two levers keeps that rule and the index's intent (EX-E path) |
| 6 | Urate: fasting raises it ≈ +46 % | Consistent: 338 → 495 µmol/L over 4–21-day fasts [S47]. For fasts of 36–48 h there is no measured value, so those rows are D (mechanistic expectation) | Data gap |
| 7 | Clinician threshold "HbA1c ≥ 9" | Kept, graded D as an app threshold. No guideline opened in this job names 9 % | It comes from index decision 5, not a guideline |
| 8 | "Average blood glucose" derived from HbA1c is display-only | Agreed. eAG (mg/dL) = 28.7 × A1c − 46.7 [S10] can be recomputed as a cross-check in the parser | — |

---

## 1. Fasting plasma glucose (FPG)

### Physiology and what it reflects
After an overnight fast (≥ 8 h without calories [S1]), plasma glucose is set mainly by how much glucose the liver releases (glycogen breakdown, then gluconeogenesis), held in check by fasting insulin. FPG therefore reports **hepatic** insulin sensitivity and beta-cell function, not muscle insulin sensitivity. Liver fat is a main driver: when liver fat falls quickly on a severe energy deficit, FPG in type 2 diabetes normalises within a week (9.2 → 5.9 mmol/L) [S32]. FPG reacts within days. It is noisy from one day to the next and is moved for hours to days by a recent long fast [S21, S22], a short night [S34] or caffeine [S28].

### Units and conversions
| From | To | Factor | Note |
|---|---|---|---|
| mmol/L | mg/dL | × 18.016 | Molar mass of glucose, 180.16 g/mol. ADA pairs: 100 mg/dL = 5.6, 126 = 7.0 mmol/L [S1] |
| mg/dL | mmol/L | ÷ 18.016 | Indian labs report mg/dL ("Glucose – Fasting (FBS)", "Plasma glucose fasting") |

### Reference ranges and targets
| Source | Normal | Prediabetes (IFG) | Diabetes | Note |
|---|---|---|---|---|
| ADA SoC 2026 [S1] | < 100 mg/dL | 100–125 mg/dL | ≥ 126 mg/dL | Repeat to confirm unless classic symptoms. Results near a threshold: repeat in 3–6 months |
| RSSDI 2022 [S3] | < 110 mg/dL | **110–125 mg/dL** | ≥ 126 mg/dL | Indian cut-off for IFG is higher than ADA's |
| ICMR | — | — | — | No ICMR document with different FPG cut-offs was opened; ICMR-INDIAB uses the standard criteria for prevalence [S4] |
| LAI 2020/2023 | — | — | — | Lipid guideline; it counts diabetes as a risk category but sets no glucose cut-offs (not re-opened here) |

### How each lever moves it
| Lever | Direction | Effect size (units, population) | Time course | Mechanism | Grade | Sources |
|---|---|---|---|---|---|---|
| Very-low-carb / keto (< 50 g/d) | down | −0.73 mmol/L (≈ −13 mg/dL; 95 % CI −1.19 to −0.27) vs control at 6 months; +0.06 mmol/L (NS) at 12 months (adults with T2D, 14 RCTs) | ~2 wk | Less dietary glucose and lower hepatic glucose output; the advantage fades by 12 months as adherence falls. In lean normoglycaemic people a small FPG rise from 'physiological insulin resistance' is possible (mechanistic expectation, not measured in the sources opened) | B | [S12], [S13] |
| Moderate low-carb (26–45 %E) | down | Small; no separate FPG estimate for 26–45 %E opened. Isocaloric swap of 5 %E carbohydrate for SFA: +0.02 mmol/L (null) (feeding trials, mixed adults) | ~4 wk | Lower glycaemic load; benefit depends on what replaces the carbohydrate (unsaturated fat better than SFA) | C | [S25] |
| High protein (≥ 1.6 g/kg) | none | −0.13 mmol/L (−0.46 to 0.19), NS (adults with T2D, 13 RCTs) | ~8 wk | Protein stimulates both insulin and glucagon; net FPG effect near zero | B | [S14] |
| Fasting 16:8 | down | −2.65 mg/dL (−3.92 to −1.39) without calorie restriction; −0.44 mmol/L (≈ −8 mg/dL) in T2D (non-diabetic adults (11 RCTs, n=653); T2D meta-analysis) | ~8 wk | Longer overnight post-absorptive period, modest weight loss, better hepatic insulin sensitivity | B | [S16], [S18], [S15] |
| Fasting 24 h | none | No difference from daily calorie restriction at equal weight loss (6 and 12 months) (metabolically healthy adults with obesity; 11 RCTs of intermittent vs continuous restriction) | ~12 wk | Effect runs through weight loss, not through the fast itself. Acutely, the morning after a 24 h fast insulin sensitivity is lower (see insulin row) | B | [S20], [S19] |
| Fasting 36–48 h | mixed | FPG falls during the fast; insulin sensitivity falls (insulin sensitivity index 5.7 → 2.6 after a 24 h fast), so a test in the 1–3 days after is not representative (healthy adults) | hours to days | Glucose sparing: high free fatty acids reduce muscle glucose uptake (Randle cycle); glycogen depletion | C | [S21], [S22] |
| Extended fast > 48 h | mixed | Peripheral insulin-mediated glucose uptake −46 % after 60 h; FPG low during the fast, transiently higher glucose response after refeeding (healthy lean adults) | hours to days | Same glucose-sparing adaptation, stronger with time | C | [S22] |
| Saturated fat | none | +0.02 mmol/L (−0.01 to +0.04) per 5 %E carbohydrate → SFA (102 feeding trials, n=4220) | ~4 wk | SFA does not acutely change FPG; it worsens insulin sensitivity relative to PUFA | B | [S25] |
| Dietary cholesterol / eggs | none | One small study: FPG −4.4 % with eggs; no meta-analysis opened (adults with pre-diabetes or T2D, single study) | ~12 wk | No direct pathway from dietary cholesterol to hepatic glucose output; eggs displace refined carbohydrate | D | [S26] |
| Fibre | down | −0.56 mmol/L (≈ −10 mg/dL; −0.73 to −0.38); psyllium in T2D −37 mg/dL, no effect in euglycaemic adults (adults with diabetes (34 trials); psyllium 35 RCTs) | ~8 wk | Viscous fibre slows glucose absorption; colonic fermentation to short-chain fatty acids | A | [S24], [S23] |
| Unsaturated fats | down | Direction shown when PUFA replaces SFA or carbohydrate; FPG magnitude not given in the abstract (102 feeding trials) | ~4 wk | PUFA/MUFA improve insulin sensitivity and secretion relative to SFA and carbohydrate | B | [S25] |
| Alcohol | none | Fasting glucose unchanged (14 intervention studies, adults) | ~4 wk | Ethanol inhibits gluconeogenesis acutely (hypoglycaemia risk on glucose-lowering drugs; mechanistic, not quantified here) | B | [S27] |
| Caffeine | mixed | Acute caffeine lowers insulin sensitivity (SMD −2.06); long-term coffee effect not opened (healthy adults, 7 RCTs) | hours to days | Adenosine-receptor block and adrenaline release reduce muscle glucose uptake for hours | C | [S28] |
| Creatine | none | No FPG data opened; HbA1c fell in one T2D trial (see HbA1c) (—) | ~12 wk | Mechanistic expectation: creatine with exercise raises muscle GLUT4; FPG effect in non-diabetics unknown | D | [S29] |
| Whey / protein supplements | down | −1.83 mg/dL (−3.28 to −0.38) (36 RCTs of milk protein, n=1851) | ~8 wk | Insulinotropic amino acids and incretin release; small fasting effect | B | [S30] |
| Large deficit (> 25 %) | down | FPG 9.2 → 5.9 mmol/L within 1 week on 600 kcal/d; diabetes remission 46 % vs 4 % at 12 months (adults with T2D) | ~1 wk | Rapid fall in liver fat restores hepatic insulin sensitivity within days | A | [S32], [S31] |
| Moderate deficit | down | Via weight loss: about −0.7 mg/dL per kg lost near FPG 100 mg/dL (engine coefficient) (adults with overweight (engine fit)) | ~12 wk | Lower liver and visceral fat, better hepatic insulin sensitivity | B | [S65], [S36] |
| Surplus | up | Not quantified in sources opened; liver fat rises within 3 weeks of overfeeding (engine research) (overfed adults) | ~4 wk | Ectopic liver fat and hepatic insulin resistance | C | [S65] |
| Resistance training load | down | FPG not reported; HbA1c −0.57 % in T2D (see HbA1c) (adults with T2D) | ~12 wk | More muscle mass and GLUT4; post-exercise glucose uptake | C | [S33] |
| Aerobic training load | down | FPG not reported; HbA1c −0.73 % in T2D (see HbA1c) (adults with T2D) | ~12 wk | Contraction-mediated glucose uptake; better insulin sensitivity | C | [S33] |
| Sleep debt | up | One night of partial sleep loss: glucose disposal 40.7 → 32.5 µmol/kg lean mass/min (−20 %); endogenous glucose production 3.6 → 4.4 (healthy adults) | hours to days | Sympathetic activation and cortisol raise hepatic glucose output and reduce muscle uptake | B | [S34], [S35] |
| Weight loss itself | down | Lifestyle programme with ~7 % weight loss cut diabetes incidence by 58 % (48–66 %); engine slope −0.7 mg/dL per kg (up to −3 mg/dL per kg in T2D) (adults with prediabetes (DPP)) | ~24 wk | Lower liver and visceral fat | A | [S36], [S65] |
| Supplement: `psyllium` | down | T2D −37 mg/dL; prediabetes modest; euglycaemic none (35 RCTs) | ~8 wk | Viscous gel slows glucose absorption; effect proportional to how high glucose is | A | [S23] |
| Supplement: `magnesium` | mixed | No overall FPG effect; trials ≥ 4 months improved FPG and HOMA-IR (RCT meta-analysis) | ~16 wk | Magnesium is a cofactor in insulin signalling; benefit likely only if depleted | C | [S39] |
| Supplement: `vitamin_d3` | none | Diabetes HR 0.88 (0.75–1.04), NS, with 4000 IU/d (adults with prediabetes (D2d)) | ~130 wk | Vitamin D receptor on beta cells; no clinical effect shown in replete people | A | [S38] |
| Supplement: `omega3_epa_dha` | none | HbA1c −0.02 % (−0.07 to 0.04); diabetes RR 1.00 (RCT meta-analysis) | ~26 wk | No glycaemic pathway of note | A | [S37] |
| Supplement: `green_tea_extract` | down | −0.09 mmol/L (−0.15 to −0.03) (17 RCTs (tea and extract)) | ~8 wk | Catechins may slow carbohydrate absorption; small effect | B | [S40] |
| Supplement: `ashwagandha` | down | −3.09 mg/dL (−5.61 to −0.58), very low certainty (11 RCTs, n=667) | ~8 wk | Unclear; possibly via cortisol and stress | C | [S41] |
| Supplement: `melatonin` | none | No significant FPG change (27 studies) (31 RCTs, 1–10 mg/d) | ~8 wk | Melatonin acutely reduces insulin secretion at night; daytime FPG unchanged | B | [S42] |
| Supplement: `exogenous_ketones` | down | Acute small fall in blood glucose (Hedges g 0.12) for hours after a dose (30 studies, n=408) | hours to days | Ketones lower hepatic glucose output acutely | C | [S43] |

### What it constrains in the plan
| Id | When | Kind | Acts on | Value | Message (plain words) | Grade | Sources |
|---|---|---|---|---|---|---|---|
| W-L-FPG-1 | ≥ 126 mg/dL | Re-ask | `diabetes_question` |  | Because your fasting glucose was {value} mg/dL on {date}, please answer the diabetes question again. Fasts over 24 h and very-low-carb wait for your answer. | A | [S1], [S3], [S64] |
| W-L-FPG-2 | ≥ 100 mg/dL | Preference (ranking) | `fibre` |  | Because your fasting glucose was {value} mg/dL on {date} (prediabetes range), the plan ranks fibre, weight loss and training higher. | A | [S1], [S24], [S36], [S33] |
| W-L-FPG-3 | test taken ≤ 3 days after a fast > 24 h | Retest prompt | `fasting_glucose` |  | Your glucose test on {date} was taken within 3 days of a long fast. Glucose and insulin read high or low then; retest after 2 weeks of normal eating. | C | [S21], [S22] |
| W-L-FPG-4 | ≥ 100 mg/dL | Retest prompt | `fasting_glucose` | 12 | Because your fasting glucose was {value} mg/dL on {date}, retest it with HbA1c about 12 weeks after your plan starts. | B | [S1], [S2] |

No rule bans a lever. Severity: re-ask and cap are plan-changing; warning and clinician note are shown before the plan; preference changes only the ranking; retest adds a task.

### Clinician-only thresholds
- FPG ≥ 126 mg/dL newly found: "please confirm with a doctor; one result is not a diagnosis" [S1]. The plan keeps running, and W-L-FPG-1 holds fasts > 24 h and VLC until the diabetes question is answered.
- Known diabetes on glucose-lowering drugs: the existing W-M10/W-P04/EX-E rules apply (the index). No new rule here.
- A low FPG (< 70 mg/dL) outside a fast is not given a rule in this dossier: no source opened in this job states the threshold, so E20 should take it from the safety research (research/17) if it is added.

### Retest interval
12 weeks after a plan change, together with HbA1c (FPG itself settles in 1–2 weeks, but a single value is noisy). Never within 3 days after a fast > 24 h (W-L-FPG-3). For prediabetes outside a plan, ADA advises yearly testing [S1].

### Indian-population notes
- ICMR-INDIAB-17 (n = 113,043): diabetes 11.4 % (10.2–12.5) and prediabetes 15.3 % (13.9–16.6) nationally [S4]. Undiagnosed diabetes is common, which is why the lab-triggered re-ask matters.
- ADA screens Asian-ancestry adults from BMI ≥ 23 kg/m² [S1]. RSSDI calls BMI 23–24.9 overweight and ≥ 25 obese, and treats waist ≥ 90 cm in men as abdominal obesity [S3].
- Camp profiles often omit fasting glucose and print HbA1c with a derived "average blood glucose" instead [S64]. The UI should say "not in your report", not "missing".

---

## 2. HbA1c (glycated haemoglobin)

### Physiology and what it reflects
Glucose binds haemoglobin without enzymes, at a rate set by the glucose level, over the life of the red cell. HbA1c is therefore a weighted average of about the last 3 months of glucose. Recent weeks count most: the half-time of the fall after glucose normalises is about 35 days [S65], and the ADAG mapping is eAG (mg/dL) = 28.7 × A1c − 46.7 [S10]. Anything that changes red-cell age changes HbA1c without any change in glucose: iron deficiency and its treatment, haemolysis, recent blood loss or transfusion, haemoglobin variants, pregnancy, G6PD deficiency [S1, S9]. ADA: in these conditions "plasma glucose criteria should be used to diagnose diabetes" [S1].

### Units and conversions
| From | To | Formula | Source |
|---|---|---|---|
| % (NGSP/DCCT) | mmol/mol (IFCC) | IFCC = 10.93 × NGSP − 23.50 | [S11] |
| mmol/mol | % | NGSP = 0.09148 × IFCC + 2.152 | [S11] |
| Check values | | 5.7 % = 39, 6.4 % = 47, 6.5 % = 48, 7 % = 53 mmol/mol | [S1, S2] |
Indian reports almost always give %, sometimes with mmol/mol beside it, plus "Estimated average glucose (eAG)" in mg/dL. The method is usually HPLC [S64].

### Reference ranges and targets
| Source | Normal | Prediabetes | Diabetes | Treatment goal |
|---|---|---|---|---|
| ADA SoC 2026 [S1, S2] | < 5.7 % | 5.7–6.4 % (39–47 mmol/mol) | ≥ 6.5 % (≥ 48), NGSP-certified method, repeat to confirm | < 7 % (< 53) for many non-pregnant adults; assess at least twice a year, every 3 months if not at goal |
| RSSDI 2022 [S3] | < 5.7 % | 5.7–6.4 % | ≥ 6.5 % | < 7.0 %. "Anemia must be excluded before a proper diagnosis based on HbA1c"; use fructosamine if there is a haemoglobinopathy |
Indian reports print the ADA bands plus a "known diabetic control" scale. The app never states a personal treatment target; the clinician sets it (index open question 4).

### How each lever moves it
| Lever | Direction | Effect size (units, population) | Time course | Mechanism | Grade | Sources |
|---|---|---|---|---|---|---|
| Very-low-carb / keto (< 50 g/d) | down | −0.47 % (−0.60 to −0.34) at 6 months; −0.23 % (−0.46 to 0) at 12 months; remission 57 % vs 31 % at 6 months (adults with T2D, 17 RCTs (n=747)) | ~12 wk | Lower mean glucose; HbA1c follows with a ~35 d half-life | B | [S12], [S13] |
| Moderate low-carb (26–45 %E) | down | Replacing 5 %E carbohydrate with MUFA −0.09 % (−0.12 to −0.05), with PUFA −0.11 % (−0.17 to −0.05) (102 feeding trials, n=4220) | ~12 wk | Lower glycaemic load plus better insulin sensitivity from unsaturated fat | B | [S25] |
| High protein (≥ 1.6 g/kg) | none | −0.05 % (−0.18 to 0.08), NS (adults with T2D, 13 RCTs) | ~12 wk | Neutral on mean glucose | B | [S14] |
| Fasting 16:8 | down | SMD −0.31 (−0.56 to −0.05) in trials > 6 months; −0.32 % (−0.47 to −0.18) in T2D (23 RCTs (n=1280); T2D meta-analysis) | ~24 wk | Mostly via weight loss and lower mean glucose | B | [S15], [S18] |
| Fasting 24 h | none | No independent effect beyond the weight lost (alternate-day vs daily restriction) (adults with obesity) | ~24 wk | Mean glucose changes only through weight loss | C | [S20], [S19] |
| Fasting 36–48 h | none | Too short to move HbA1c measurably; one 2-day dip in glucose is diluted over ~100 days of red-cell age (mechanism) | ~12 wk | HbA1c integrates glucose over red-cell life (half-time ≈ 35 d) | C | [S10], [S65] |
| Extended fast > 48 h | down | Not quantified; expected small fall if repeated, via mean glucose and weight (mechanistic expectation) | ~12 wk | Same integration; weight loss | D | [S65] |
| Saturated fat | up | Relative to PUFA: replacing SFA with PUFA lowered HbA1c (no magnitude in abstract); vs carbohydrate roughly neutral (feeding trials) | ~12 wk | SFA impairs insulin sensitivity relative to PUFA | C | [S25] |
| Dietary cholesterol / eggs | none | No HbA1c data opened (—) | ~12 wk | No direct pathway | D | [S26] |
| Fibre | down | −2.00 mmol/mol (≈ −0.18 %; −3.30 to −0.71); psyllium in T2D −0.97 % (adults with diabetes (33 trials); psyllium RCTs) | ~12 wk | Slower glucose absorption lowers mean glucose | A | [S24], [S23] |
| Unsaturated fats | down | −0.09 to −0.11 % per 5 %E replacing carbohydrate (102 feeding trials) | ~12 wk | Better insulin sensitivity and secretion | B | [S25] |
| Alcohol | down | SMD −0.62 (−1.01 to −0.23) in intervention studies; not a reason to drink (14 intervention studies) | ~12 wk | Unclear; ethanol suppresses gluconeogenesis. Hypoglycaemia risk on glucose-lowering drugs | C | [S27] |
| Caffeine | none | No HbA1c data opened (—) | ~12 wk | Acute insulin-sensitivity drop does not obviously carry into mean glucose | D | [S28] |
| Creatine | down | −1.1 % (−1.9 to −0.4) vs placebo, with exercise training (adults with T2D, one RCT) | ~12 wk | Creatine plus exercise raises muscle GLUT4 translocation | C | [S29] |
| Whey / protein supplements | none | +0.01 % (−0.14 to 0.16) (36 RCTs of milk protein) | ~12 wk | Lowers post-meal peaks only slightly overall | B | [S30] |
| Large deficit (> 25 %) | down | Diabetes remission (HbA1c < 6.5 % off drugs) 46 % vs 4 % at 12 months with total diet replacement (adults with T2D (DiRECT)) | ~12 wk | Loss of liver and pancreatic fat restores beta-cell function | A | [S31], [S32] |
| Moderate deficit | down | About −0.02 % per kg in non-diabetic adults, −0.08 % per kg in T2D (engine coefficients) (engine fit from trials) | ~12 wk | Weight loss lowers mean glucose | B | [S65] |
| Surplus | up | Not quantified in sources opened (mechanistic expectation) | ~12 wk | Weight gain and liver fat raise mean glucose | D | [S65] |
| Resistance training load | down | −0.57 % (−1.14 to −0.01) (adults with T2D, structured training) | ~12 wk | More muscle glucose disposal | A | [S33] |
| Aerobic training load | down | −0.73 % (−1.06 to −0.40); > 150 min/week −0.89 %, ≤ 150 min/week −0.36 % (adults with T2D, 47 RCTs) | ~12 wk | Contraction-mediated glucose uptake and insulin sensitivity | A | [S33] |
| Sleep debt | up | No HbA1c data opened; acute insulin resistance −20 % per short night (mechanistic expectation) | ~12 wk | Repeated short nights raise mean glucose | D | [S34], [S35] |
| Weight loss itself | down | −0.02 %/kg non-diabetic, −0.08 %/kg T2D; DPP 58 % fewer new diabetes cases (engine coefficients; DPP) | ~12 wk | Lower liver/visceral fat | A | [S65], [S36] |
| Supplement: `psyllium` | down | −0.97 % in T2D (psyllium RCTs in T2D) | ~12 wk | Viscous fibre | B | [S23] |
| Supplement: `omega3_epa_dha` | none | −0.02 % (−0.07 to 0.04) (RCT meta-analysis) | ~12 wk | No glycaemic pathway | A | [S37] |
| Supplement: `magnesium` | none | No overall HbA1c effect; longer trials better (RCT meta-analysis) | ~16 wk | Cofactor in insulin signalling | C | [S39] |
| Supplement: `green_tea_extract` | down | −0.30 % (−0.37 to −0.22) (17 RCTs) | ~12 wk | Catechins; estimate looks large for the FPG change and is graded down | C | [S40] |
| Supplement: `ashwagandha` | none | −0.05 % (−0.47 to 0.36), 3 trials, very low certainty (RCTs) | ~12 wk | Unclear | C | [S41] |
| Supplement: `melatonin` | down | Improved (magnitude not in abstract) (9 RCTs reporting HbA1c) | ~12 wk | Unclear | C | [S42] |
| Supplement: `iron` | up | Measurement effect: HbA1c 4.63 % → 5.82 % after treating iron-deficiency anaemia (non-diabetic adults); ADA says iron deficiency raises HbA1c, so direction is contested (141 non-diabetic adults with IDA, Central India) | ~12 wk | Red-cell age and iron status change HbA1c without any change in glucose | C | [S9], [S1] |

### What it constrains in the plan
| Id | When | Kind | Acts on | Value | Message (plain words) | Grade | Sources |
|---|---|---|---|---|---|---|---|
| W-L-HBA1C-1 | ≥ 6.5 % | Re-ask | `diabetes_question` |  | Because your HbA1c was {value} % on {date}, please answer the diabetes question again. Fasts over 24 h and very-low-carb wait for your answer. | A | [S1], [S3] |
| W-L-HBA1C-2 | ≥ 5.7 % | Preference (ranking) | `fibre` |  | Because your HbA1c was {value} % on {date} (prediabetes range), the plan ranks fibre, weight loss, unsaturated fats and training higher. | A | [S1], [S24], [S25], [S33], [S36] |
| W-L-HBA1C-3 | flag: anaemia_or_haemoglobinopathy flag | Warning | `hba1c` |  | Your report shows low haemoglobin or a haemoglobin variant, so your HbA1c of {value} % on {date} may be off. The plan leans on fasting glucose instead. | A | [S1], [S3], [S9] |
| W-L-HBA1C-4 | any entered value | Retest prompt | `hba1c` | 12 | HbA1c shows about 3 months of glucose. Retest no sooner than 12 weeks after your plan started; an earlier test shows only part of the change. | A | [S2], [S10], [S65] |
| W-L-HBA1C-5 | ≥ 6.5 % | Clinician note | `fast48plus` |  | Because your HbA1c was {value} % on {date}: if you take diabetes medicine, fasting or very-low-carb can drop your sugar too low. Agree any fast with your doctor first. | C | [S1], [S2], [S27] |

No rule bans a lever. Severity: re-ask and cap are plan-changing; warning and clinician note are shown before the plan; preference changes only the ranking; retest adds a task.

### Clinician-only thresholds
- HbA1c ≥ 6.5 % newly found: confirm with a doctor; it needs a repeat test and can read wrong with anaemia [S1, S3].
- HbA1c ≥ 9 %: see a doctor before fasting or a large diet change (index decision 5; D as an app threshold) [S64].
- Diabetes with glucose-lowering drugs plus VLC or fasting > 24 h: the clinician agrees the fast first (W-L-HBA1C-5, existing W-M10/W-P04).

### Retest interval
12 weeks at the earliest after a plan change. A 4-week test shows only about 55 % of the eventual change [S65]. ADA asks for testing every 3 months when not at goal and twice a year when stable [S2]. Prediabetes outside a plan: yearly [S1].

### Indian-population notes
- Anaemia is very common (NFHS-5: 57 % of women, 25 % of men, per the index [S64]). Thalassaemia trait and HbE are also common in parts of India. Together these make HbA1c-only diagnosis risky. W-L-HBA1C-3 asks the parser to read Hb (and Mentzer/RDWI notes, where printed) from the same report.
- In one Central-India study, HbA1c rose by about 1.2 points after iron-deficiency anaemia was treated in non-diabetic adults [S9]. If a user starts iron during a plan, an HbA1c rise may be a measurement effect, not worse glucose. The Coach should say so.
- The prevalence figures above come from ICMR-INDIAB-17 [S4].

---

## 3. Fasting insulin and HOMA-IR

### Physiology and what it reflects
Fasting insulin is the beta-cell output needed to hold FPG steady overnight, so it rises with insulin resistance (mainly in the liver) long before glucose does. HOMA-IR = FPG (mmol/L) × insulin (µU/mL) / 22.5, which equals FPG (mg/dL) × insulin / 405 [S5]. It is a ratio of two noisy fasting values. It reports **hepatic** more than muscle insulin resistance, so exercise without weight loss barely moves it even though muscle glucose uptake improves [S65]. Insulin falls within days of an energy deficit or carbohydrate restriction, well before weight changes [S32, S65]. A recent long fast creates temporary "physiological" insulin resistance: after a 24 h fast the insulin sensitivity index fell from 5.7 to 2.6 [S21], and peripheral glucose uptake fell 46 % after 60 h [S22].

### Units and conversions
| From | To | Factor | Note |
|---|---|---|---|
| µU/mL (= µIU/mL, mU/L) | pmol/L | × 6.00 | Correct factor (WHO 1986 standard, 6 nmol per IU) [S8] |
| µU/mL | pmol/L | × 6.945 | Older factor still used by some labs, calculators and research/06; reads ~15 % low [S8]. Store the unit as entered; convert pmol/L to µU/mL with 6.00 |
| — | HOMA-IR | FPG(mmol/L) × insulin(µU/mL) / 22.5 | [S5] |
Indian labs report "Insulin – Fasting" in µIU/mL (CLIA/CMIA). It is usually not part of camp profiles [S64].

### Reference ranges and targets
| Source | Value | Population | Note |
|---|---|---|---|
| Singh 2013 [S5] | HOMA-IR ≥ 2.5 | urban Indian adolescents, 10–17 y, n = 691 | Best cut-off for metabolic syndrome in both sexes |
| Jog 2023 [S6] | HOMA-IR 1.23 | South Indian adults, n = 192 | Proposed cut-off; one study |
| Miller 2009 [S7] | — | 10 commercial assays | 7 of 10 methods were > 15.5 % off the reference in 36–100 % of samples. There is no harmonised reference range |
No ADA, RSSDI, ICMR or LAI document sets a fasting-insulin or HOMA-IR cut-off. Use the lab's printed range for display, and HOMA ≥ 2.5 only to rank levers (grade C).

### How each lever moves it
| Lever | Direction | Effect size (units, population) | Time course | Mechanism | Grade | Sources |
|---|---|---|---|---|---|---|
| Very-low-carb / keto (< 50 g/d) | down | HOMA-IR −0.14 (−0.51 to 0.23) at 6 months, very low certainty (T2D); keto HOMA SMD −0.29 in diabetic subgroup (adults with T2D; adults with obesity) | ~4 wk | Less carbohydrate means less insulin secretion; liver fat falls | B | [S12], [S13] |
| Moderate low-carb (26–45 %E) | down | HOMA-IR −2.4 % (−4.6 to −0.3) per 5 %E carbohydrate → MUFA (feeding trials) | ~4 wk | Lower insulin demand; MUFA improves sensitivity | B | [S25] |
| High protein (≥ 1.6 g/kg) | down | HOMA-IR −0.27 (−0.47 to −0.06) (adults with T2D, 13 RCTs) | ~8 wk | Weight-loss and satiety effects; amino acids also stimulate insulin acutely | B | [S14] |
| Fasting 16:8 | down | Fasting insulin −2.00 µU/mL (−3.02 to −0.97); HOMA-IR −0.58 (−0.81 to −0.35) (non-diabetic adults, TRE without calorie restriction) | ~8 wk | Longer daily low-insulin window; small weight loss | B | [S16], [S15], [S17] |
| Fasting 24 h | mixed | Long-term: fasting insulin −0.89 µU/mL (−1.56 to −0.22) vs continuous restriction. Acute: after a 24 h fast insulin sensitivity index 5.7 → 2.6 (×10⁻⁴ min⁻¹ per mU/L) (11 RCTs (8–24 weeks); healthy adults (acute)) | hours to days | Low insulin during the fast; high free fatty acids cause transient insulin resistance afterwards | B | [S19], [S21] |
| Fasting 36–48 h | mixed | Insulin falls during the fast; peripheral insulin resistance develops (see 60 h data). A fasting insulin drawn in the 1–3 days after is not a baseline (healthy adults) | hours to days | Glucose sparing via fatty-acid oxidation | B | [S21], [S22] |
| Extended fast > 48 h | mixed | Insulin-mediated glucose uptake −46 % after 60 h (healthy lean adults) | hours to days | Glucose sparing; ~ninefold free fatty acids | B | [S22] |
| Saturated fat | none | Fasting insulin −1.1 pmol/L (−1.7 to −0.5) per 5 %E carbohydrate → SFA (≈ −0.2 µU/mL, negligible); worse than PUFA (feeding trials) | ~4 wk | SFA impairs insulin sensitivity relative to PUFA | B | [S25] |
| Dietary cholesterol / eggs | none | One small study: HOMA-IR lower with eggs (pre-diabetes/T2D, single study) | ~12 wk | Displacement of refined carbohydrate | D | [S26] |
| Fibre | down | HOMA-IR −1.24 (−1.72 to −0.76); insulin SMD −2.03 (adults with diabetes (9 trials)) | ~8 wk | Lower post-meal insulin demand; SCFA effects | A | [S24] |
| Unsaturated fats | down | Fasting insulin −1.6 pmol/L (−2.8 to −0.4) per 5 %E carbohydrate → PUFA (feeding trials) | ~4 wk | Better insulin sensitivity | B | [S25] |
| Alcohol | down | Fasting insulin SMD −0.19 (−0.35 to −0.02); in women −0.23, none in men (14 intervention studies) | ~4 wk | Unclear; not a lever to recommend | C | [S27] |
| Caffeine | up | Acute insulin sensitivity SMD −2.06; a coffee before the blood draw can raise fasting insulin (healthy adults, 7 RCTs) | hours to days | Adrenaline release and adenosine block | C | [S28] |
| Creatine | none | No data opened (—) | ~12 wk | Mechanistic expectation only (muscle GLUT4) | D | [S29] |
| Whey / protein supplements | down | Fasting insulin −1.06 µU/mL (−1.76 to −0.36); HOMA-IR −0.27 (−0.40 to −0.14) (36 RCTs of milk protein) | ~8 wk | Satiety and weight effects; fasting state | B | [S30] |
| Large deficit (> 25 %) | down | Fasting glucose normalised within 1 week on 600 kcal/d with falling liver fat; insulin falls within days (engine τ ≈ 5 d) (adults with T2D) | ~1 wk | Liver fat falls fast; hepatic insulin sensitivity returns | A | [S32], [S65] |
| Moderate deficit | down | ln insulin −0.030 per % weight lost (engine) (engine fit) | ~8 wk | Weight loss | B | [S65], [S19] |
| Surplus | up | Not quantified in sources opened (mechanistic expectation) | ~4 wk | Liver fat and adipose expansion raise insulin resistance | C | [S65] |
| Resistance training load | down | No fasting-insulin data opened; HbA1c falls in T2D (mechanistic expectation) | ~12 wk | More muscle mass for glucose disposal | D | [S33] |
| Aerobic training load | none | HOMA-IR unchanged after 4 weeks of training without weight change (engine research) (adults with obesity) | ~4 wk | Benefit is in muscle insulin sensitivity, which fasting insulin captures poorly | C | [S65] |
| Sleep debt | up | Insulin sensitivity −20 % after one short night (healthy adults) | hours to days | Hepatic and peripheral insulin resistance | B | [S34] |
| Weight loss itself | down | ln insulin −0.030 per % weight lost (engine); muscle insulin sensitivity improves after ~7 % loss (engine fit) | ~8 wk | Less ectopic fat | B | [S65], [S36] |
| Supplement: `magnesium` | down | HOMA-IR −0.67 (−1.20 to −0.14) (RCT meta-analysis) | ~16 wk | Insulin-signalling cofactor | C | [S39] |
| Supplement: `green_tea_extract` | down | Fasting insulin −1.16 µU/mL (−1.91 to −0.40), high-quality studies only (RCTs) | ~8 wk | Catechins | C | [S40] |
| Supplement: `melatonin` | down | Fasting insulin and HOMA-IR improved (magnitude not in abstract) (7 and 4 RCTs) | ~8 wk | Unclear | C | [S42] |
| Supplement: `exogenous_ketones` | none | No significant insulin change in obesity/prediabetes (30 studies) | hours to days | Ketones do not raise insulin load | C | [S43] |

### What it constrains in the plan
| Id | When | Kind | Acts on | Value | Message (plain words) | Grade | Sources |
|---|---|---|---|---|---|---|---|
| W-L-INS-1 | ≥ 2.5 HOMA-IR | Preference (ranking) | `fast16_8` |  | Because your HOMA-IR was {value} on {date} (from your glucose and insulin), the plan ranks weight loss, fibre, 16:8 eating and training higher. | C | [S5], [S16], [S24], [S36] |
| W-L-INS-2 | any entered value | Retest prompt | `fasting_insulin` | 12 | Insulin tests differ between labs by 15 % or more. Retest at the same lab after about 12 weeks to compare. | B | [S7] |
| W-L-INS-3 | test taken ≤ 3 days after a fast > 36 h, or same morning as coffee | Retest prompt | `fasting_insulin` |  | Your insulin test on {date} came soon after a long fast or after coffee, which changes insulin for a while. Retest after 2 weeks of normal eating, water only that morning. | B | [S21], [S22], [S28] |

No rule bans a lever. Severity: re-ask and cap are plan-changing; warning and clinician note are shown before the plan; preference changes only the ranking; retest adds a task.

### Clinician-only thresholds
None. HOMA-IR and fasting insulin are not diagnostic, and no guideline gives a clinician threshold. A very high fasting insulin with *low* glucose is outside what the app should interpret. It should be shown with "discuss with a doctor" (D, no source).

### Retest interval
12 weeks, at the same lab, with FPG drawn at the same time. Not within 3 days of a fast > 36 h, and not on a morning with coffee (W-L-INS-3).

### Indian-population notes
- The engine's NHANES-based HOMA prior (research/06) is not Indian. South Asians are often said to have higher insulin resistance at the same BMI, but no source for this was opened in this job (D). E20 should rely on entered values rather than adjust the prior.
- Because the adult cut-offs disagree (1.23 vs 2.5) and assays differ, the plain-language text should say "higher than typical" against the lab's own range, not "insulin resistant".

---

## 4. Uric acid (serum urate)

### Physiology and what it reflects
Urate is the end product of purine breakdown in humans. Two thirds is cleared by the kidney, where it is reabsorbed and secreted in the proximal tubule; the rest goes through the gut. Production rises with purine intake (meat, seafood), with fructose (phosphorylation uses up ATP) and with alcohol (faster ATP turnover; beer also adds guanosine) [S53, S58]. Excretion falls with insulin resistance, with dehydration and with **ketone bodies**, which compete with urate for tubular secretion. Infused β-hydroxybutyrate and acetoacetate caused renal urate retention [S49]. So urate rises during fasts and in early ketosis: from 338 to 495 µmol/L over 4–21-day fasts, more with higher ketonuria [S47, S48]. It falls with weight loss and with milk proteins [S55, S60]. Above about 6.8 mg/dL serum is supersaturated and crystals can form [S44].

### Units and conversions
| From | To | Factor | Note |
|---|---|---|---|
| mg/dL | µmol/L | × 59.48 | Molar mass of uric acid, 168.11 g/mol. EULAR pairs: 6 mg/dL = 360 µmol/L, 5 = 300 [S45] |
| mmol/L | mg/dL | × 16.81 | Some papers use mmol/L (0.36 mmol/L = 6 mg/dL) |
Indian labs report "URIC ACID" in mg/dL, method usually uricase (photometry) [S64].

### Reference ranges and targets
| Source | Value | Meaning |
|---|---|---|
| ACR 2020 [S44] | > 6.8 mg/dL | Asymptomatic hyperuricaemia, if there have been no flares or tophi. ACR advises *against* starting urate-lowering drugs in this group (conditional) |
| ACR 2020 [S44] | < 6 mg/dL | Strongly recommended target for people with gout on urate-lowering therapy |
| EULAR 2016 [S45] | < 6 mg/dL (< 5 in severe gout) | Same treat-to-target idea |
| Indian chain labs [S64] | ≈ 3.5–7.2 mg/dL men, 2.6–6.0 women | Printed lab ranges, which vary by lab; the upper male limit sits above the saturation point |
No LAI, ICMR or RSSDI target for urate was found. No Indian Rheumatology Association gout document was located in this job.

### How each lever moves it
Specific supplements: the catalogue has no vitamin C item. Vitamin C 500 mg/d lowers urate by 0.35 mg/dL (−0.66 to −0.03) in RCTs (Juraschek 2011, [S66]), but ACR advises against adding it for gout [S44]. It is noted here and gets no rule.
| Lever | Direction | Effect size (units, population) | Time course | Mechanism | Grade | Sources |
|---|---|---|---|---|---|---|
| Very-low-carb / keto (< 50 g/d) | mixed | Pooled ketogenic RCTs +0.26 mg/dL (−0.47 to 0.98), I² high; one cohort 5.7 → 8.4 mg/dL at week 6; a VLCKD trial −1.23 mg/dL (10 RCTs; women with PCOS; postmenopausal women with obesity) | ~6 wk | Ketones compete with urate for renal tubular secretion (rise in weeks 1–6); weight loss lowers it later | C | [S50], [S51], [S52], [S49] |
| Moderate low-carb (26–45 %E) | down | Weight-loss diet with 40 % carbohydrate, 30 % protein, 30 % fat: 0.57 → 0.47 mmol/L (≈ 9.6 → 7.9 mg/dL) over 16 weeks (13 men with gout) | ~16 wk | Weight loss and better insulin sensitivity increase renal urate excretion; no sustained ketosis | C | [S61] |
| High protein (≥ 1.6 g/kg) | mixed | Total protein not linked to gout; meat RR +41 %, seafood +51 %, dairy −44 % (top vs bottom quintile) (47,150 men, 12 years) | ~12 wk | Purine load from meat and fish raises urate; dairy proteins are uricosuric | B | [S54] |
| Fasting 16:8 | none | No data opened; no sustained ketosis expected in a 16 h window (mechanistic expectation) | ~4 wk | Overnight ketones stay low (< 0.5 mmol/L) | D | [S49] |
| Fasting 24 h | up | Not measured in sources opened; small transient rise expected (mechanistic expectation) | hours to days | Early ketosis begins competing for tubular secretion | D | [S49], [S65] |
| Fasting 36–48 h | up | Not measured in sources opened; rise expected as ketones climb (engine: +0.6 mg/dL per mmol/L BHB, proposed) (mechanistic expectation) | hours to days | Ketone–urate competition; rise scales with ketonaemia | D | [S49], [S65], [S48] |
| Extended fast > 48 h | up | 338 → 495 µmol/L (≈ 5.7 → 8.3 mg/dL, +46 %) over 4–21 days; larger rise with higher ketonuria; 1 gout flare in 1422 (a man already treated for gout) (1422 adults, Buchinger fasting 200–250 kcal/d) | ~1 wk | Ketone–urate competition for renal secretion; some tissue catabolism | B | [S47], [S48], [S49] |
| Saturated fat | none | No data opened (—) | ~4 wk | No known direct pathway | D | [S64] |
| Dietary cholesterol / eggs | none | No data opened; eggs are low in purines (mechanistic expectation) | ~4 wk | No purine load | D | [S54] |
| Fibre | down | DASH pattern (high fibre, fruit, vegetables, low-fat dairy) −0.25 mg/dL (−0.4 to −0.1); fibre alone not isolated (RCTs of DASH) | ~8 wk | Pattern effect; attribution to fibre uncertain | C | [S50] |
| Unsaturated fats | none | No data opened (—) | ~4 wk | No known direct pathway | D | [S64] |
| Alcohol | up | Gout RR 1.32 at 10–14.9 g/d to 2.53 at ≥ 50 g/d; beer RR 1.49 per daily serving, spirits 1.15, wine 1.04 (NS) (47,150 men, 12 years) | ~1 wk | Ethanol speeds ATP breakdown to urate and lactate reduces urate excretion; beer adds guanosine | B | [S53], [S44] |
| Caffeine | none | Caffeine and tea not associated with urate; coffee ≥ 6 cups/d −0.43 mg/dL (cross-sectional); coffee meta-analysis: no significant urate difference, gout RR 0.43 (NHANES III n=14,758; meta-analysis) | ~12 wk | The coffee effect is not from caffeine (possibly chlorogenic acids, insulin sensitivity) | C | [S56], [S57] |
| Creatine | none | No data found (mechanistic expectation) | ~4 wk | Creatine is cleared as creatinine, not via purines | D | [S64] |
| Whey / protein supplements | down | Skim-milk protein (80 g) lowered urate ~10 % over 3 h; soy protein raised it ~10 % (16 healthy men, crossover) | hours to days | Milk proteins increase renal urate excretion | C | [S55], [S54] |
| Large deficit (> 25 %) | mixed | Bariatric surgery: transient urate rise and more flares early; later falls (10 longitudinal studies) | ~8 wk | Ketosis and tissue breakdown early; weight loss later | C | [S60] |
| Moderate deficit | down | −7.7 kg over 16 weeks: urate −1.7 mg/dL; flares 2.1 → 0.6 per month (13 men with gout) | ~16 wk | Insulin sensitivity raises renal urate excretion | C | [S61], [S60] |
| Surplus | up | Fructose: gout RR 1.62 (highest vs lowest intake); sugar-sweetened drinks RR 2.08 (prospective cohorts, n=125,299 and 154,289) | ~12 wk | Fructose phosphorylation depletes ATP and raises urate production; weight gain lowers excretion | B | [S58], [S59] |
| Resistance training load | none | No data opened (—) | ~1 wk | Hard sessions break down some ATP; effect expected small and transient | D | [S63] |
| Aerobic training load | mixed | Marathon: transient rise in xanthine oxidoreductase activity and urate, resolved by 24 h; chronic effect not shown in sources opened (23 young men) | hours to days | ATP breakdown to hypoxanthine during very long efforts; dehydration | C | [S63] |
| Sleep debt | up | Sleep apnoea: gout RR 1.29 (1.11–1.48); CPAP lowered urate (Hedges g −0.49). Plain sleep debt: no data opened (17 studies of sleep apnoea) | ~8 wk | Night-time hypoxia raises purine turnover; generalising to sleep debt is a guess | D | [S62] |
| Weight loss itself | down | Weight loss 3–34 kg: urate change −168 to +30 µmol/L; ~75 % of studies showed fewer flares (people with gout, 10 studies) | ~16 wk | Better insulin sensitivity increases renal urate excretion | C | [S60], [S61], [S44] |
| Supplement: `casein_presleep` | down | Milk-protein effect as for whey (~10 % acute fall) (16 healthy men) | hours to days | Dairy protein is uricosuric | C | [S55] |
| Supplement: `plant_protein` | up | Soy protein (80 g) raised urate ~10 % over 3 h; purine-rich vegetables not linked to gout (16 healthy men; 47,150 men) | hours to days | Soy contains purines | C | [S55], [S54] |
| Supplement: `exogenous_ketones` | up | Not measured; expected rise with ketonaemia (mechanistic expectation) | hours to days | Ketone–urate competition | D | [S49] |

### What it constrains in the plan
| Id | When | Kind | Acts on | Value | Message (plain words) | Grade | Sources |
|---|---|---|---|---|---|---|---|
| W-L-URIC-1 | ≥ 6.8 mg/dL | Warning | `fast36_48` |  | Because your uric acid was {value} mg/dL on {date}, fasts over 24 h and very-low-carb can raise it further for a few weeks. Drink at least 2.5 L a day. | B | [S47], [S48], [S49], [S50], [S44] |
| W-L-URIC-2 | ≥ 6.8 mg/dL | Cap | `fast48plus` | 72 | Because your uric acid was {value} mg/dL on {date}, fasts are capped at 72 h unless you choose longer after reading the warning. | C | [S47], [S49] |
| W-L-URIC-3 | ≥ 6.0 mg/dL + gout | Cap | `fast36_48` | 24 | Because you have gout and your uric acid was {value} mg/dL on {date}, fasts are capped at 24 h. Ask your doctor before anything longer. | C | [S44], [S45], [S47], [S60] |
| W-L-URIC-4 | ≥ 6.8 mg/dL | Warning | `alcohol` |  | Because your uric acid was {value} mg/dL on {date}, the plan counts alcohol against you, beer most and wine least. | B | [S53], [S44] |
| W-L-URIC-5 | ≥ 6.8 mg/dL | Preference (ranking) | `wheyprotein` |  | Because your uric acid was {value} mg/dL on {date}, the plan prefers dairy protein (curd, paneer, milk, whey) and limits sugary drinks. | C | [S54], [S55], [S59] |
| W-L-URIC-6 | ≥ 6.8 mg/dL | Warning | `deficit_large` |  | Because your uric acid was {value} mg/dL on {date}: very fast weight loss can raise it for a few weeks before it falls. A moderate pace is gentler. | C | [S60], [S61] |
| W-L-URIC-7 | ≥ 6.8 mg/dL | Retest prompt | `uric_acid` | 8 | Because your uric acid was {value} mg/dL on {date}, retest it about 8 weeks after starting very-low-carb or any fast over 72 h. | C | [S47], [S50], [S51] |

No rule bans a lever. Severity: re-ask and cap are plan-changing; warning and clinician note are shown before the plan; preference changes only the ranking; retest adds a task.

### Clinician-only thresholds
- Urate ≥ 6.8 mg/dL with joint pain or swelling, or known gout: "see a doctor before long fasts" [S44]. High urate without symptoms is usually not treated with drugs (ACR conditional against) [S44], so the app does **not** send everyone ≥ 6.8 to a clinician. It warns and caps instead (W-L-URIC-1..3).
- Known gout plus a planned fast > 24 h: clinician card (W-L-URIC-3). Gout flares during fasts are rare but documented. In the Buchinger cohort the only flare (1 in 1422) was in a man already treated for gout [S47].

### Retest interval
8 weeks after starting VLC or after any fast > 72 h, if the baseline is ≥ 6.8 mg/dL. The keto rise shows by week 6 [S51], and a fasting rise reverses after refeeding (the speed of reversal is not measured in the sources opened; D). Otherwise retest with the next routine panel. Before a planned fast > 72 h in someone gout-prone, test first (index decision 8).

### Indian-population notes
- In 29,391 adults at Indian screening programmes, 25.8 % had hyperuricaemia; the figure was 33.6 % in people with diabetes and 35.1 % with hypertension [S46]. This is a screening population, not a national sample.
- Indian vegetarian diets lean on dairy, which helps (dairy RR 0.56 for gout; milk protein lowers urate acutely) [S54, S55]. Soy protein raised urate acutely [S55], and purine-rich vegetables and dals were not linked to gout [S54]. The planner's protein top-ups for a high-urate user should prefer curd, paneer, milk and whey over soy isolate and organ meat. This is a preference, not a ban.
- Beer and sugar-sweetened drinks are the strongest dietary raisers [S53, S59].

---

## Sources
Only sources opened in this job (abstract or full text, by the job or its research sub-agents) are listed. Internal documents are marked.

- **[S1]** American Diabetes Association Professional Practice Committee. 2. Diagnosis and Classification of Diabetes: Standards of Care in Diabetes—2026. Diabetes Care 2026;49(Suppl 1):S27–S49. DOI 10.2337/dc26-S002 · PMID 41358893 · https://pmc.ncbi.nlm.nih.gov/articles/PMC12690183/ (full text read from a mirror PDF, https://sentucuman.com.ar/docs/standards-of-care-2026.pdf, because diabetesjournals.org returned 403)
- **[S2]** ADA Professional Practice Committee. 6. Glycemic Goals and Hypoglycemia: Standards of Care in Diabetes—2026. DOI 10.2337/dc26-S006 · PMID 41358894 (same mirror PDF)
- **[S3]** RSSDI Clinical Practice Recommendations for the Management of Type 2 Diabetes Mellitus 2022, summary document for training. https://www.rssdi.in/newwebsite/RSSDI-Clinical-Practice-Recommendations-2022%20(1).pdf
- **[S4]** Anjana RM et al. Metabolic non-communicable disease health report of India: the ICMR-INDIAB national cross-sectional study (ICMR-INDIAB-17). Lancet Diabetes Endocrinol 2023;11(7):474–489. DOI 10.1016/S2213-8587(23)00119-5 · PMID 37301218
- **[S5]** Singh Y, Garg MK, Tandon N, Marwaha RK. A study of insulin resistance by HOMA-IR and its cut-off value to identify metabolic syndrome in urban Indian adolescents. J Clin Res Pediatr Endocrinol 2013;5(4):245–251. DOI 10.4274/Jcrpe.1127 · PMID 24379034 · https://pmc.ncbi.nlm.nih.gov/articles/PMC3890224/
- **[S6]** Jog KS et al. Comparison of novel biomarkers of insulin resistance with HOMA-IR in a South Indian population. Cureus 2023. DOI 10.7759/cureus.33653 · PMID 36788883
- **[S7]** Miller WG et al. Toward standardization of insulin immunoassays. Clin Chem 2009;55(5):1011–1018. DOI 10.1373/clinchem.2008.118380 · PMID 19325009 · https://academic.oup.com/clinchem/article-abstract/55/5/1011/5629277
- **[S8]** Knopp JL, Holder-Pearson L, Chase JG. Insulin units and conversion factors: a story of truth, boots, and faster half-truths. J Diabetes Sci Technol 2019;13(3):597–600. DOI 10.1177/1932296818805074 · PMID 30318910 · https://pmc.ncbi.nlm.nih.gov/articles/PMC6501531/
- **[S9]** Patel A et al. Association between glycated hemoglobin (HbA1c) levels in patients with iron deficiency anemia in a tertiary care hospital in Central India. Cureus 2024. DOI 10.7759/cureus.66121 · PMID 39229395
- **[S10]** Nathan DM et al. Translating the A1C assay into estimated average glucose values. Diabetes Care 2008;31(8):1473–1478. DOI 10.2337/dc08-0545 · PMID 18540046
- **[S11]** NGSP. IFCC Standardization of HbA1c (IFCC–NGSP master equation). https://ngsp.org/ifccngsp.asp
- **[S12]** Goldenberg JZ et al. Efficacy and safety of low and very low carbohydrate diets for type 2 diabetes remission: systematic review and meta-analysis. BMJ 2021;372:m4743. DOI 10.1136/bmj.m4743 · PMID 33441384 · https://pmc.ncbi.nlm.nih.gov/articles/PMC7804828/
- **[S13]** Choi YJ, Jeon SM, Shin S. Impact of a ketogenic diet on metabolic parameters in patients with obesity or overweight and with or without type 2 diabetes: a meta-analysis of randomized controlled trials. Nutrients 2020;12(7):2005. DOI 10.3390/nu12072005 · PMID 32640608
- **[S14]** Yu Z et al. Effects of high-protein diet on glycemic control, insulin resistance and blood pressure in type 2 diabetes: a systematic review and meta-analysis of randomized controlled trials. Clin Nutr 2020;39:1724–1734. DOI 10.1016/j.clnu.2019.08.008 · PMID 31466731
- **[S15]** 16:8 time-restricted eating and cardiometabolic outcomes: meta-analysis of 23 RCTs (n = 1280). Nutr Rev 2026. DOI 10.1093/nutrit/nuaf206 · PMID 41351878
- **[S16]** Time-restricted eating without calorie restriction in non-diabetic adults: meta-analysis of 11 RCTs (n = 653). Front Nutr 2025. DOI 10.3389/fnut.2025.1631477 · PMID 41346676
- **[S17]** Sutton EF et al. Early time-restricted feeding improves insulin sensitivity, blood pressure, and oxidative stress even without weight loss in men with prediabetes. Cell Metab 2018;27:1212–1221. DOI 10.1016/j.cmet.2018.04.010 · PMID 29754952
- **[S18]** Time-restricted eating in type 2 diabetes: meta-analysis. Diabetol Metab Syndr 2026. DOI 10.1186/s13098-026-02138-8 · PMID 41803962
- **[S19]** Cioffi I et al. Intermittent versus continuous energy restriction on weight loss and cardiometabolic outcomes: a systematic review and meta-analysis of randomized controlled trials. J Transl Med 2018;16:371. DOI 10.1186/s12967-018-1748-4 · PMID 30583725
- **[S20]** Trepanowski JF et al. Effect of alternate-day fasting on weight loss, weight maintenance, and cardioprotection among metabolically healthy obese adults. JAMA Intern Med 2017;177(7):930–938. DOI 10.1001/jamainternmed.2017.0936 · PMID 28459931
- **[S21]** Salgin B et al. Effects of prolonged fasting and sustained lipolysis on insulin secretion and insulin sensitivity in normal subjects. Am J Physiol Endocrinol Metab 2009;296:E454–E461. DOI 10.1152/ajpendo.90613.2008 · PMID 19106250
- **[S22]** Soeters MR et al. Muscle adaptation to short-term fasting in healthy lean humans. J Clin Endocrinol Metab 2008. DOI 10.1210/jc.2006-2491 · PMID 18056775
- **[S23]** Gibb RD et al. Psyllium fiber improves glycemic control proportional to loss of glycemic control: a meta-analysis of data in euglycemic subjects, patients at risk of type 2 diabetes mellitus, and patients being treated for type 2 diabetes mellitus. Am J Clin Nutr 2015;102:1604–1614. DOI 10.3945/ajcn.115.106989 · PMID 26561625
- **[S24]** Reynolds AN, Akerman AP, Mann J. Dietary fibre and whole grains in diabetes management: systematic review and meta-analyses. PLoS Med 2020;17(3):e1003053. DOI 10.1371/journal.pmed.1003053 · PMID 32142510
- **[S25]** Imamura F et al. Effects of saturated fat, polyunsaturated fat, monounsaturated fat, and carbohydrate on glucose-insulin homeostasis: a systematic review and meta-analysis of randomised controlled feeding trials. PLoS Med 2016;13(7):e1002087. DOI 10.1371/journal.pmed.1002087 · PMID 27434027
- **[S26]** Pourafshar S et al. Egg consumption may improve factors associated with glycemic control and insulin sensitivity in adults with pre- and type II diabetes. Food Funct 2018. PMID 30073224 (single intervention study; abstract only)
- **[S27]** Schrieks IC et al. The effect of alcohol consumption on insulin sensitivity and glycemic status: a systematic review and meta-analysis of intervention studies. Diabetes Care 2015;38(4):723–732. DOI 10.2337/dc14-1556 · PMID 25805864
- **[S28]** Shi X et al. Acute caffeine ingestion reduces insulin sensitivity in healthy subjects: a systematic review and meta-analysis. Nutr J 2016;15:103. DOI 10.1186/s12937-016-0220-7 · PMID 28031026
- **[S29]** Gualano B et al. Creatine in type 2 diabetes: a randomized, double-blind, placebo-controlled trial. Med Sci Sports Exerc 2011;43(5):770–778. DOI 10.1249/MSS.0b013e3181fcee7d · PMID 20881878
- **[S30]** Mohammadi S et al. Effects of supplementation with milk protein on glycemic parameters: a GRADE-assessed systematic review and dose-response meta-analysis. Nutr J 2023;22:49. DOI 10.1186/s12937-023-00878-1 · PMID 37798798
- **[S31]** Lean MEJ et al. Primary care-led weight management for remission of type 2 diabetes (DiRECT): an open-label, cluster-randomised trial. Lancet 2018;391:541–551. DOI 10.1016/S0140-6736(17)33102-1 · PMID 29221645
- **[S32]** Lim EL et al. Reversal of type 2 diabetes: normalisation of beta cell function in association with decreased pancreas and liver triacylglycerol. Diabetologia 2011;54:2506–2514. DOI 10.1007/s00125-011-2204-7 · PMID 21656330
- **[S33]** Umpierre D et al. Physical activity advice only or structured exercise training and association with HbA1c levels in type 2 diabetes: a systematic review and meta-analysis. JAMA 2011;305(17):1790–1799. DOI 10.1001/jama.2011.576 · PMID 21540423
- **[S34]** Donga E et al. A single night of partial sleep deprivation induces insulin resistance in multiple metabolic pathways in healthy subjects. J Clin Endocrinol Metab 2010;95(6):2963–2968. DOI 10.1210/jc.2009-2430 · PMID 20371664
- **[S35]** Spiegel K, Leproult R, Van Cauter E. Impact of sleep debt on metabolic and endocrine function. Lancet 1999;354:1435–1439. DOI 10.1016/S0140-6736(99)01376-8 · PMID 10543671
- **[S36]** Knowler WC et al. Reduction in the incidence of type 2 diabetes with lifestyle intervention or metformin (DPP). N Engl J Med 2002;346:393–403. DOI 10.1056/NEJMoa012512 · PMID 11832527
- **[S37]** Brown TJ et al. Omega-3, omega-6, and total dietary polyunsaturated fat for prevention and treatment of type 2 diabetes mellitus: systematic review and meta-analysis of randomised controlled trials. BMJ 2019;366:l4697. DOI 10.1136/bmj.l4697 · PMID 31434641
- **[S38]** Pittas AG et al. Vitamin D supplementation and prevention of type 2 diabetes (D2d). N Engl J Med 2019;381:520–530. DOI 10.1056/NEJMoa1900906 · PMID 31173679
- **[S39]** Magnesium supplementation and glucose/insulin-sensitivity parameters: meta-analysis of RCTs. Pharmacol Res 2016. DOI 10.1016/j.phrs.2016.06.019 · PMID 27329332
- **[S40]** Liu K et al. Effect of green tea on glucose control and insulin sensitivity: a meta-analysis of 17 randomized controlled trials. Am J Clin Nutr 2013;98(2):340–348. DOI 10.3945/ajcn.112.052746 · PMID 23803878
- **[S41]** Farrin N et al. The effects of Ashwagandha (Withania somnifera) supplementation on fasting blood glucose and HbA1c: a systematic review and dose-response meta-analysis of randomized controlled trials. Diabetes Res Clin Pract 2026;241:113529. DOI 10.1016/j.diabres.2026.113529 · PMID 42641800
- **[S42]** Dias GZT et al. Melatonin supplementation improves insulin resistance markers but not fasting glucose: a systematic review and meta-analysis of randomized controlled trials. Diabetes Res Clin Pract 2026;237:113290. DOI 10.1016/j.diabres.2026.113290 · PMID 42070664
- **[S43]** Yu Q et al. Effects of ketone supplements on blood β-hydroxybutyrate, glucose and insulin: a systematic review and three-level meta-analysis. Complement Ther Clin Pract 2023;52:101774. DOI 10.1016/j.ctcp.2023.101774 · PMID 37327753
- **[S44]** FitzGerald JD et al. 2020 American College of Rheumatology Guideline for the Management of Gout. Arthritis Care Res 2020;72(6):744–760. DOI 10.1002/acr.24180 · PMID 32391934 · https://pmc.ncbi.nlm.nih.gov/articles/PMC10563586/
- **[S45]** Nuki G, Doherty M, Richette P. Current management of gout: practical messages from 2016 EULAR guidelines. Pol Arch Intern Med 2017;127(4):267–277. DOI 10.20452/pamw.4001 · PMID 28430170
- **[S46]** Billa G et al. Prevalence of hyperuricemia in Indian subjects attending hyperuricemia screening programs: a retrospective study. J Assoc Physicians India 2018;66(4):43–46. PMID 30347952
- **[S47]** Wilhelmi de Toledo F, Grundler F et al. Safety, health improvement and well-being during a 4 to 21-day fasting period in an observational study including 1422 subjects. PLoS One 2019;14(1):e0209353. DOI 10.1371/journal.pone.0209353 · PMID 30601864 · https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0209353
- **[S48]** Grundler F et al. Long-term fasting-induced ketosis in 1610 subjects: metabolic regulation and safety. Nutrients 2024;16(12):1849. DOI 10.3390/nu16121849 · PMID 38931204
- **[S49]** Goldfinger S, Klinenberg JR, Seegmiller JE. Renal retention of uric acid induced by infusion of beta-hydroxybutyrate and acetoacetate. N Engl J Med 1965;272:351–355. DOI 10.1056/NEJM196502182720705 · PMID 14239117 (bibliographic record only; no abstract available)
- **[S50]** Ketogenic and DASH diets and serum uric acid: meta-analysis of RCTs. Sci Rep 2023;13. DOI 10.1038/s41598-023-37672-2 · PMID 37380733
- **[S51]** Ketogenic diet in PCOS: serum uric acid course over 12 weeks (cohort). Reprod Biomed Online 2022. PMID 35732547 (abstract truncated)
- **[S52]** Very-low-calorie ketogenic diet in hypertensive obese postmenopausal women. Nutrients 2026. DOI 10.3390/nu18121912 · PMID 42356298
- **[S53]** Choi HK et al. Alcohol intake and risk of incident gout in men: a prospective study. Lancet 2004;363:1277–1281. DOI 10.1016/S0140-6736(04)16000-5 · PMID 15094272
- **[S54]** Choi HK et al. Purine-rich foods, dairy and protein intake, and the risk of gout in men. N Engl J Med 2004;350:1093–1103. DOI 10.1056/NEJMoa035700 · PMID 15014182
- **[S55]** Dalbeth N et al. Acute effect of milk on serum urate concentrations: a randomised controlled crossover trial. Ann Rheum Dis 2010;69:1677–1682. DOI 10.1136/ard.2009.124230 · PMID 20472590
- **[S56]** Choi HK, Curhan G. Coffee, tea, and caffeine consumption and serum uric acid level: the Third National Health and Nutrition Examination Survey. Arthritis Rheum 2007;57(5):816–821. DOI 10.1002/art.22762 · PMID 17530681
- **[S57]** Zhang Y et al. Is coffee consumption associated with a lower risk of hyperuricaemia or gout? A systematic review and meta-analysis. BMJ Open 2016;6:e009809. DOI 10.1136/bmjopen-2015-009809 · PMID 27401353
- **[S58]** Jamnik J et al. Fructose intake and risk of gout and hyperuricemia: a systematic review and meta-analysis of prospective cohort studies. BMJ Open 2016;6:e013191. DOI 10.1136/bmjopen-2016-013191 · PMID 27697882
- **[S59]** Ayoub-Charette S et al. Important food sources of fructose-containing sugars and incident gout: a systematic review and meta-analysis of prospective cohort studies. BMJ Open 2019;9:e024171. DOI 10.1136/bmjopen-2018-024171 · PMID 31061018
- **[S60]** Nielsen SM et al. Weight loss for overweight and obese individuals with gout: a systematic review of longitudinal studies. Ann Rheum Dis 2017;76:1870–1882. DOI 10.1136/annrheumdis-2017-211472 · PMID 28866649
- **[S61]** Dessein PH et al. Beneficial effects of weight loss associated with moderate calorie/carbohydrate restriction, and increased proportional intake of protein and unsaturated fat on serum urate and lipoprotein levels in gout: a pilot study. Ann Rheum Dis 2000;59:539–543. DOI 10.1136/ard.59.7.539 · PMID 10873964
- **[S62]** Sleep apnoea, gout and serum urate: meta-analysis of 17 studies (CPAP effect on urate). Sleep Med 2026. DOI 10.1016/j.sleep.2026.109171 · PMID 42526100
- **[S63]** Kosaki K et al. Xanthine oxidoreductase activity in marathon runners: potential implications for marathon-induced acute kidney injury. J Appl Physiol 2022;133(1):1–10. DOI 10.1152/japplphysiol.00669.2021 · PMID 35608201
- **[S64]** Vitals internal: plan/02-next/research-blood-markers.md (index and decisions, 2026-10-02), including the structure-only read of an Indian chain-lab report (units, reference-range formats).
- **[S65]** Vitals internal: research/06-lipids-cardiometabolic-biomarkers.md §4.11 (glycaemic coefficients) and §4.13 (urate model). Used only for model coefficients already in the engine; its primary sources were not re-opened in this job unless listed above.
- **[S66]** Juraschek SP, Miller ER, Gelber AC. Effect of oral vitamin C supplementation on serum uric acid: a meta-analysis of randomized controlled trials. Arthritis Care Res 2011;63(9):1295–1306. DOI 10.1002/acr.20519 · PMID 21671418

## Open and unverified
- **Moderate low-carb (26–45 %E) has no separate glycaemic estimate.** Goldenberg 2021 pools low-carb diets [S12]. The moderate row relies on Imamura's isocaloric substitution data [S25] (C/B).
- **Fasting 24–48 h and urate have no measured values** in the sources opened; those rows are D, with the engine's proposed slope of +0.6 mg/dL per mmol/L BHB [S65].
- **No sources opened** for: creatine and urate; resistance or chronic aerobic training and urate; sleep debt (as opposed to sleep apnoea) and urate; eggs and HbA1c. These rows are D.
- **2025–2026 meta-analyses** [S15, S16, S18, S41, S42, S52, S62] were read as PubMed abstracts only. Their final publication status was not checked.
- **The ADA 2026 full text** was read from a third-party mirror PDF. diabetesjournals.org returned 403.
- **The green tea HbA1c effect** (−0.30 %) [S40] looks large next to its FPG effect (−0.09 mmol/L) and is graded C.
- **The clinician thresholds** "HbA1c ≥ 9 %" (index) and a low-FPG threshold were not found in a guideline opened in this job.
- **Engine conversion bug:** research/06 uses 6.945 for insulin. E20 should switch to 6.00 [S8], or flag the difference in the tests.
