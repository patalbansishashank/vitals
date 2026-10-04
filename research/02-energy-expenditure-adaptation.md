# 02 — Energy Expenditure: RMR, TEF, NEAT, Exercise Compensation & Adaptive Thermogenesis

Dossier owner: research agent 02. Status: complete draft (2026-09-30).
Units: kcal/d unless stated (1 MJ = 239.0 kcal; 1 kcal = 4.184 kJ). Mass in kg, height in cm (unless stated),
age in years, time in days. "PROPOSED FIT" = equation/parameter fitted by this dossier to the cited data points;
"UNVERIFIED" = number seen only in secondary sources or not re-checked against the primary text.

---

## 1. Scope

- How to compute a person's **baseline maintenance energy** (TDEE0) from sex/age/height/weight and, when available,
  body composition, with an honest individual-level error band.
- How each TDEE component — **RMR, TEF, NEAT/spontaneous activity, exercise (EAT)** — responds day-by-day to
  body-composition change, energy intake level, macronutrient composition (incl. protein, alcohol, fibre),
  activity level (incl. constrained-TEE compensation), and time.
- A state-variable model of **adaptive thermogenesis (AT)** in deficit and surplus with onset/offset time-constants,
  plus the energy **cost of depositing/mobilising tissue**.
- Out of scope (cross-referenced): energy cost of specific exercise modes/EPOC (dossier 10), body-composition
  partitioning / Forbes curve (01), glycogen & water (04), ketosis/GNG fluxes (05), hormones & appetite (12),
  sleep/menstrual/ageing moderators beyond EE (16), clinical limits (17).

---

## 2. State variables

| Name | Unit | Typical range | Represents | Initial-value rule |
|---|---|---|---|---|
| `FM` | kg | 3–80 | Fat mass (owned by dossier 01) | From dossier 14 estimate |
| `FFM` | kg | 30–100 | Fat-free mass (owned by 01) | `BW − FM` |
| `FFM_act` | kg | ≈FFM | Metabolically active FFM = FFM minus *deviations* of glycogen + glycogen-bound water + ECF from baseline (dossier 04). Water/glycogen swings do not change RMR. | `FFM0` |
| `SM_RT` | kg | 0–10 | Cumulative skeletal-muscle accretion attributed to training (dossier 09); lets RMR use muscle-specific rate | 0 |
| `RMR0` | kcal/d | 1100–2600 | Baseline RMR (constant, from §4.1 selection rule) | §4.1 |
| `EI0` | kcal/d | 1500–4000 | Baseline (weight-stable) metabolizable energy intake = TDEE0 | §4.13 |
| `AT_R` | kcal/d | −300…+150 | Adaptive thermogenesis expressed in resting EE | 0 |
| `AT_N` | kcal/d | −600…+400 | Adaptive change of non-resting EE (NEAT amount + muscular efficiency) | 0 |
| `P_eff` | g/d | 30–300 | Lagged (first-order) protein intake driving protein-turnover cost | habitual protein `P0` |
| `Abar` | kcal/d | 0–2000 | Exponentially-weighted mean of *extra* activity energy above baseline (drives constrained-TEE compensation) | 0 |
| `C_comp` | kcal/d | 0–700 | Constrained-TEE compensation (reduction of basal EE) | 0 |
| `TEF` | kcal/d | 100–450 | Thermic effect of food (algebraic, same day) | computed |
| `NEAT0`, `EAT0`, `TEF0` | kcal/d | — | Baseline component values | §4.13 |
| `σ_TDEE` | kcal/d | 150–450 | 1-SD individual uncertainty of TDEE (for UI band) | §4.12 |

---

## 3. Inputs that drive it

| Input | Unit | How it enters |
|---|---|---|
| Sex, age, height, weight | — | Baseline RMR/TDEE equations (§4.1, §4.12) |
| Body-fat % (optional, method) | % | Selects FFM-based RMR equation (§4.1) |
| Measured RMR (optional) | kcal/d | Overrides predicted RMR0; shrinks uncertainty |
| Lifestyle PAL category or steps/day | — / steps | Baseline NEAT (§4.6) |
| Energy intake EI(t) | kcal/d (ME) | ΔEI drives AT (§4.8); TEF (§4.4) |
| Protein, available carbohydrate, fat (incl. MCT fraction), fibre, alcohol | g/d | TEF coefficients (§4.4); protein-turnover term (§4.5); carbohydrate share → GNG/DNL costs (§4.10–4.11) |
| Food processing share (optional) | fraction | TEF multiplier, low-confidence (§4.4) |
| Steps(t) | steps/d | NEAT (§4.6) |
| Exercise sessions | kcal net (from dossier 10) | EAT; drives constrained compensation (§4.7) |
| Menstrual phase, core temperature deviation, caffeine | flag / °C / mg | RMR modifiers (§4.3) |
| FM, FFM_act, SM_RT, BW trajectories | kg | RMR mass terms; NEAT ∝ BW (§4.2, §4.6) |
| GNG and DNL fluxes (dossiers 04/05) | kcal/d | Biochemical inefficiency costs (§4.10–4.11) |

---

## 4. Mechanisms & equations

### 4.1 Baseline resting metabolic rate (RMR0) — prediction equations

**Mechanism.** RMR (≈ BMR measured rested/fasted/thermoneutral) is dominated by fat-free mass (FFM), with a small
independent contribution of fat mass (FM) and age. In 150 adults, 63% of between-subject BMR variance was explained by
FFM, 6% by FM, 2% by age, 26% unexplained; within-subject (day-to-day + analytic) variability was only 2% of total
variance [14]. Weight/height equations work because weight/height/sex/age proxy FFM.

**Equations (kcal/d; W kg, H cm, A y, S = 1 male / 0 female).**

```
Mifflin–St Jeor (1990) [1]      men:   10·W + 6.25·H − 5·A + 5
                                 women: 10·W + 6.25·H − 5·A − 161
   (unified form 9.99·W + 6.25·H − 4.92·A + 166·S − 161; R² = 0.71; n = 498, 19–78 y, 234 obese)
   FFM-only variant: 19.7·FFM + 413 (R² = 0.64)

Harris–Benedict revised (Roza & Shizgal 1984) [2, 12]
                                 men:   88.362 + 13.397·W + 4.799·H − 5.677·A
                                 women: 447.593 + 9.247·W + 3.098·H − 4.330·A
   Original 1919 HB (as printed in [12]): men 66.47 + 13.75·W + 5.0·H − 6.76·A;
                                          women 655.1 + 9.56·W + 1.85·H − 4.68·A
   (1919 HB over-estimated measured REE by ~5% in Mifflin's sample [1]; HB precision ≈ ±14% [2])

Katch–McArdle ≡ Cunningham (1991) [4]:  370 + 21.6·FFM        (explains 65–90% of REE variance)
Cunningham (1980) [3]:                   500 + 22·LBM
ten Haaf & Weijs (2014, athletes) [11]:  REE(kJ) = 95.272·FFM + 2026.161  →  22.77·FFM + 484.3 kcal
                                          weight-based: REE(kJ) = 49.940·W + 2459.053·H(m) − 34.014·A + 799.257·S + 122.502

Müller et al. (2004) [5, 12]  (MJ/d; ×239.0 for kcal)
   weight-based: 0.047·W + 1.009·S − 0.01452·A + 3.21
        (constant 3.21 per several secondary sources; Frings-Meuthen 2021 [12] prints 3.31 — UNVERIFIED which is
         correct; primary PDF not accessed. Difference = 24 kcal/d.)
   FFM/FM-based: 0.05192·FFM + 0.04036·FM + 0.869·S − 0.01181·A + 2.992
   (n = 2528, 5–91 y, 7 German centres; ≤75% variance explained; WHO equations over-predict low and
    under-predict high REE)

Oxford / Henry (2005) [6] (coefficients as reproduced by secondary source [112] — UNVERIFIED transcription; H in cm)
   men    18–30: 14.4·W + 3.13·H + 113      30–60: 11.4·W + 5.41·H − 137     ≥60: 11.4·W + 5.41·H − 256
   women  18–30: 10.4·W + 6.15·H − 282      30–60: 8.18·W + 5.02·H − 11.6    ≥60: 8.52·W + 4.21·H + 10.7
   (n = 10,552, excluded Italian subjects, 4018 tropical; gives lower BMR than FAO/WHO/UNU-Schofield for men
    18–60 and all women >18)

Nelson et al. (1992) [13] (kJ/d): 1114 + 90.4·FFM + 13.2·FM   (R² = 0.743)  → 266 + 21.6·FFM + 3.2·FM kcal

Organ-tissue model (Elia 1992, evaluated by Wang 2010) [7, 8]:
   RMR = Σ K_i · T_i  with K_i (kcal·kg⁻¹·d⁻¹): liver 200, brain 240, heart 440, kidneys 440,
         skeletal muscle 13, adipose tissue 4.5, residual 12.
   Age-adjusted K_i for >50 y: liver 194, brain 233, heart & kidneys 426, muscle 12.6, adipose 4.4, residual 11.6
   (Elia's values ≈3% too high in >50 y).
```

Worked check (male, 35 y, 180 cm, 90 kg, 25% fat → FFM 67.5, FM 22.5): Mifflin 1855; revised HB 1959;
Katch–McArdle 1828; Cunningham-1980 1985; Müller-weight 1898; Müller-FFM 1879; Oxford 1863 kcal/d.
Female, 30 y, 165 cm, 65 kg, 30% fat: Mifflin 1370; revised HB 1430; Katch–McArdle 1353; Müller-FFM 1383; Oxford 1348.

**Accuracy by population (individual level).**

| Equation | Population | % within ±10% of measured | Bias / RMSE | Source |
|---|---|---|---|---|
| Mifflin | US adults 18–65, BMI 25–40 (n = 338) | 79% | bias −1.0%, RMSE 136 kcal/d | [10] |
| FAO/WHO/UNU weight | Dutch overweight | 68% | bias −2.5%, RMSE 178 | [10] |
| Lazzer | Dutch obese | 69% | bias −3.0%, RMSE 215 | [10] |
| Mifflin vs HB, Owen, WHO | Systematic review, non-obese & obese | Mifflin highest % within 10% and narrowest error range (exact % commonly quoted as ~82% non-obese / ~70–75% obese: UNVERIFIED) | — | [9] |
| Cunningham; new FFM & weight eqs | Recreational athletes 18–35 y (n = 90) | Cunningham ≈ new eqs (best); HB, WHO, Schofield, Mifflin, Owen all < 50% | — | [11] |
| HB / WHO / Müller / Müller-FFM / Cunningham / De Lorenzo | Master athletes 35–84 y (79 M / 34 F) | M: 48/63/66/66/68/72%; F: 47/41/47/46/64/62% | men: Cunningham over-predicted by ~77 kcal/d (4%); HB under-predicted by ~175 kcal/d (12%) | [12] |

Biological/measurement floor: intra-individual CV of repeated measured REE 5.0–5.6% (FFM 1.3–1.6%); inter-individual
CV of FFM-adjusted REE 10.4–13.6%; total error ≈ 8% [15]. After adjusting for body-cell mass (total body K), residual SD of
RMR = 89 kcal/d (5.5%) [16]. Organ mass explains part of residual: adding high-metabolic-rate-organ (HMRO) + brain mass
raised explained variance from 70% to 75% and removed the age, sex and race effects [110]; smaller HMRO mass
(3.1 vs 3.4 kg) explained >50% of the lower FFM-adjusted REE of African-American vs white adults [111].

**Selection rule (RECOMMENDED).**
1. Measured RMR (indirect calorimetry, standard protocol) → `RMR0 = measured`, `cv_RMR = 0.06`.
2. Body-fat % known (DXA/BodPod/validated BIA): general population → **Müller-FFM**; resistance-/endurance-trained or
   FFMI ≥ 20 (men) / ≥ 17 (women; threshold is a PROPOSED heuristic) → **Cunningham-1980** (or ten Haaf FFM) [3, 11, 12].
   Katch–McArdle is acceptable (identical to Cunningham-1991). `cv_RMR = 0.08`.
3. Body fat unknown (or only visually estimated) → **Mifflin–St Jeor** (default) [1, 9, 10]. `cv_RMR = 0.10`.
   Oxford/Henry is an alternative for non-Western/tropical populations [6].
4. Do not use original 1919 HB (systematic +5%) [1].

**Evidence grade: A** (FFM as main determinant; Mifflin as best weight-based equation — multiple validation studies,
systematic review). Coefficients of individual equations B.

---

### 4.2 Tissue-specific metabolic cost and the dynamic RMR update

**Mechanism.** RMR is the sum of organ/tissue rates (§4.1 Elia/Wang). Per kg, heart/kidney (440) ≫ brain (240) ≫ liver (200)
≫ skeletal muscle (13) ≈ residual (12) > adipose tissue (4.5) [7]. During weight change the marginal RMR cost of a kg of
FFM depends on *which* FFM changes: organs shrink proportionally more than muscle during CR (3 wk at −50%: skeletal muscle
−5%, liver −13%, kidneys −8%) [65], and glycogen/water shifts change FFM with ~zero metabolic cost.

**Marginal coefficients (kcal·kg⁻¹·d⁻¹).**

| Symbol | Value | Uncertainty | Meaning | Source |
|---|---|---|---|---|
| `γ_L` | 22 (92 kJ) | 19.7–22.8 | Marginal RMR per kg FFM (regression, whole FFM) | Hall 2011 appendix [17] from Nelson [13]; Mifflin FFM 19.7 [1]; Cunningham 21.6–22 [3,4] |
| `γ_F` | 3.2 (13 kJ) | 3.1–4.5 | Marginal RMR per kg FM | [13, 17]; Elia adipose tissue 4.5 [7]; Hall 2006 used 4.5 [18] |
| `γ_SM` | 13 | 12.6–13 | Skeletal muscle (for training-induced hypertrophy) | [7] |
| `γ_H2O,glyc` | 0 | — | Glycogen + bound water, ECF | modelling choice (water has no metabolic rate) |
| Müller-FFM implied | FFM 12.4, FM 9.6 | — | Partial coefficients *with* sex and age terms — not for marginal updates | [5] |
| Frings-Meuthen model 3 | FFM 20.5, FM 4.6 | — | Master athletes | [12] |

**Equation (daily).**
```
RMR_mass(t) = RMR0 + γ_L·[(FFM_act(t) − SM_RT(t)) − FFM_act0] + γ_SM·SM_RT(t) + γ_F·(FM(t) − FM0)
```
Dynamics: algebraic (instantaneous with composition). Moderators: none beyond composition. Note that FFM *composition*
changes can masquerade as AT: after 21 d CR in 32 young men, FFM-only-adjusted AT was −116 ± 127 kcal/d but −83 to −122
after adjusting for organ/molecular FFM composition; with 14 d overfeeding FFM-adjusted AT was +27 ± 115 (NS) but
+86–87 after composition adjustment [66]. The engine's AT parameters (§4.8) were fitted against FFM-adjusted data, so use
`γ_L` for non-muscle FFM consistently.

**Evidence grade: B** (organ K_i validated against MRI + calorimetry [7]; regression coefficients consistent across studies;
the glycogen/water exclusion is a mechanistic modelling choice, grade C).

---

### 4.3 Non-dietary RMR modifiers: age, sex, menstrual cycle, body temperature, caffeine, cold

**Age.** DLW database (n = 6,421; 8 d–95 y): FFM- and FM-adjusted TEE is stable from 20 to 60 y (even in pregnancy);
segmented regression break at 63.0 y (95% CI 60.1–65.9), then adjusted TEE falls −0.7 ± 0.1 %/y; adjusted basal EE falls at a
similar rate with an earlier, imprecise break (46.5 y, 40.6–52.4); in the 90s adjusted TEE is ~26% below mid-life [52].
Organ K_i ~3% lower in >50 y [7].
```
f_age(A) = 1                          for A ≤ 63
f_age(A) = 1 − 0.007·(A − 63)         for A > 63        (apply to FFM/FM-based predictions that lack an age term;
                                                        Mifflin/Müller already contain age: −5 and −2.8 kcal/d per year)
```
For simulations < 1 y the age term is negligible; for multi-year runs update age daily via the chosen equation's age slope.
Grade A (very large DLW dataset) for shape; B for applying to RMR.

**Sex.** After FFM/FM adjustment, sex had no effect on TEE in the DLW life-course data [52] and no significant effect on BMR in
[14]; but in 235 chamber studies adjusted sedentary 24EE was 124 ± 38 kcal/d lower in women (≈5–10%) [104]. Müller-FFM
carries +0.869 MJ (+208 kcal) for men [5]. Recommendation: rely on the chosen equation's sex term; do not add extra sex
offsets. Grade B (conflicting).

**Menstrual cycle.** Meta-analysis (26 studies, 318 women): RMR higher in luteal phase, ES 0.33 (95% CI 0.17–0.49); in studies
since 2000 ES 0.23 (−0.00 to 0.47, NS) [101]. Adjusted 24EE +106 ± 39 kcal/d in luteal vs follicular women [104]; 24-h EE
+9% (8/10 women +8–16%) in luteal phase by direct calorimetry [102]; sleeping MR +6.1 (SD 2.7)% late-luteal vs late-follicular,
24-h EE change NS [103].
```
PROPOSED FIT: ΔRMR_cycle(d) = a_lut · RMR · s(d),  a_lut = 0.05 (range 0.02–0.09)
   s(d) = 1 during luteal days (≈ day 15–28 of a 28-d cycle), 0 in follicular phase; smooth with 2-day ramps.
   Data points: +6.1% SMR [103]; +~5% (106/~2100 kcal) 24EE [104]; +9% 24EE [102]; ES 0.23–0.33 [101].
   Off when hormonal contraception / postmenopausal (Webb: one subject's 14% luteal rise disappeared on OC [102]).
```
Grade B.

**Body temperature (fever/hypothermia).** Each 1 °C rise in core temperature raises O2 consumption by ~10–13% (secondary
source citing classic data) [107]. `ΔRMR_temp = 0.11·RMR·ΔT_core(°C)`, valid for |ΔT| ≤ 2 °C. CR lowers core temperature
(CALERIE, direction only) [69]. Grade C.

**Caffeine.** 100 mg → RMR +3–4% for 150 min; 100 mg every 2 h for 12 h (600 mg/d) → daytime EE +8–11%, no effect on night
EE, net +150 kcal/d (lean) and +79 kcal/d (post-obese) [105]. Thermogenesis is dose-dependent over 100–400 mg [106].
```
PROPOSED FIT: ΔEE_caff = k_caff · min(caffeine_mg, 600),  k_caff = 0.25 kcal/mg (lean; 0.13 post-obese/obese)
   Data points: 150 kcal / 600 mg; 79 kcal / 600 mg [105]. Habituation not modelled (unknown).
```
Grade C (small, acute studies).

**Cold.** 48 h at 16 °C vs 22 °C raised daytime EE in lean but not obese subjects; EE change was related to (reduced)
physical activity; obese subjects mostly increased insulation [108]. Not modelled quantitatively (grade C); expose only as a
note.

---

### 4.4 Thermic effect of food (TEF / diet-induced thermogenesis)

**Mechanism.** ATP cost of digestion, absorption, first metabolic steps and storage, plus a sympathetically mediated
"facultative" part (β-blockade reduces glucose TEF) [23]. Ranking: alcohol ≥ protein > carbohydrate > fat [22].

**Per-macronutrient coefficients (fraction of the nutrient's metabolizable energy).**

| Nutrient | Default α | Range | Evidence | Source |
|---|---|---|---|---|
| Protein | **0.25** | 0.20–0.30 | Reviews; Hall 2006 model; FAO NME/ME = 3.2/4.0 → ≥0.20 obligatory | [18, 22, 23, 36] |
| Available carbohydrate | **0.075** | 0.05–0.10 | Reviews; Hall 2006 | [18, 22, 23] |
| Fat (LCT) | **0.025** | 0–0.03 | Reviews; Hall 2006 | [18, 22, 23] |
| MCT (share of fat) | **0.09** | 0.05–0.10 | PROPOSED from Clegg (in [24]): MCT meal 29.4 vs LCT 21.9 kJ/h over 6 h (≈+45 kJ ≈ +11 kcal extra on 20 g MCT ≈ 160–180 kcal → +0.06–0.07) | [24] |
| Alcohol | **0.20** | 0.10–0.30 | 95.6 g/d with meals: 24-h EE +5.5 ± 1.2%, EIT 22.5 ± 4.7%; fasting 17.1 ± 2.2% [26]; 10–30% [22]; Weststrate found no systematic inefficiency [27]; FAO NME/ME 6.3/7.0 | [22, 26, 27, 36] |
| Dietary fibre (counted at ME 2.0 kcal/g) | **0.30** | 0–0.30 | FAO NME 1.4 vs ME 2.0 kcal/g (fermentation heat + SCFA thermogenesis) → PROPOSED. **Set 0 if dossier 15 already counts fibre at 1.4 kcal/g.** | [36] |

**Daily TEF formula (RECOMMENDED).**
```
E_P = 4.0·P_g ;  E_C = 4.0·C_avail_g ;  E_F = 9.0·F_g ;  E_alc = 7.0·alc_g ;  E_fib = 2.0·fibre_g   (energy factors per dossier 01/15)
TEF = m_IR · m_proc · [ 0.25·E_P + 0.075·E_C + E_F·(0.025 + 0.065·f_MCT) + 0.20·E_alc + 0.30·E_fib ]
   m_IR   = 1 − 0.25·IR        (IR ∈ [0,1] insulin-resistance index from dossier 06; PROPOSED, range 0.7–1.0)
   m_proc = 1 − 0.45·f_UPF·u   (f_UPF = energy share from ultra-processed food; u = 0 by default (OFF), 1 in sensitivity run)
Typical mixed diet: TEF ≈ 9–10% of EI (e.g. 20/45/35 %E P/C/F → 9.2%).
```
- **Magnitude check:** a mixed diet at energy balance yields DIT ≈ 10% of intake; reported range 5–15% of daily EE,
  higher with more protein/alcohol, lower with more fat [22]. 24-h chamber, lean women: 29/61/10 %E P/C/F → DIT 14.6 ± 2.9% vs
  9/30/61 → 10.5 ± 3.8% [37] (formula gives 12.1% vs 6.0%: a 6.1-point vs measured 4.1-point difference; absolute chamber values are higher because chamber DIT is computed above sleeping MR rather than BMR [22]).
- **Meal size:** DIT rises ~linearly with meal energy: +1.1 kJ/h (adjusted 1.2) per +100 kJ eaten [24] → proportional form above.
- **Meal frequency:** single bolus > the same food as 4–6 small meals acutely (meta p = 0.02; 2–3 meals no difference) [24], but
  24-h EE is unchanged: 3 vs 6 meals 8.7 vs 8.6 MJ/d [34]; 3 vs 14 meals TEE 12.3 vs 12.1 MJ/d (NS), DIT 1.3 vs 1.0 MJ/d (p = 0.094) [33];
  whole-body calorimetry/DLW studies find no nibbling-vs-gorging difference [32]. **Model: no meal-frequency term** (grade A for
  null at 24 h). Optional sensitivity: +0.3 MJ/d DIT for ≤3 vs ≥14 meals [33].
- **Food processing:** one crossover (n = 17): whole-food sandwich meal DIT 137 ± 14 kcal (19.9% of meal) vs processed
  73 ± 10 kcal (10.7%) [30] → m_proc ≈ 0.55 for a fully processed meal (single study; default OFF). Whole-grain vs refined
  diet (6 wk, +19 g fibre/d): RMR +43 ± 25 kcal/d and stool energy +57 kcal/d → net energy loss +92 kcal/d (95% CI 28–156) [31].
- **Obesity / insulin resistance:** of 29 well-matched lean-vs-obese studies, 22 found significantly lower TEF in obesity, linked
  to insulin resistance [28]; methodological heterogeneity is large [29]; TEF reduced in obese insulin-resistant patients [23];
  acute protein-DIT benefit was significant in normal-weight but not overweight subgroups [25]. Magnitude not pooled → m_IR PROPOSED.
- **Age / activity:** may modify TEF; not quantified [35].
- **Protein meta-analysis:** acute higher- vs lower-protein meals DIT SMD 0.45 (0.26–0.65); chronic (4 d–1 y) TDEE SMD 0.29
  (0.10–0.48), REE SMD 0.18 (0.01–0.35), DIT SMD 0.10 (NS); protein type no effect [25].

**Time dynamics.** Post-meal response lasts > 6 h (especially in obesity) [22]; at daily resolution TEF is algebraic on the
same day's intake. For intra-day curves (dossier 07) distribute each meal's TEF over ~6 h (PROPOSED).

**Evidence grade:** ordering & ~10% total **A**; protein/carb/fat coefficients **B**; alcohol B; fibre/MCT/processing/IR
multipliers **C**.

---

### 4.5 Protein intake level and TEE beyond TEF (protein-turnover cost)

**Mechanism.** Higher protein intake raises whole-body protein synthesis/breakdown and urea synthesis. Protein turnover is
~20% of RMR [16]. Biochemical costs: synthesis 0.86 kcal/g (4 ATP per peptide bond + 1 ATP transport), degradation 0.17 kcal/g,
at 19 kcal of oxidation per mol ATP [18] → ≈1.0 kcal per g of protein turned over.

**Evidence.**
- Overfeeding +954 kcal/d for 8 wk (n = 25) at 5/15/25 %E protein: weight +3.16 / +6.05 / +6.51 kg; body fat gain similar in all;
  REE +0 / +160 (102–218) / +227 (165–289) kcal/d; lean mass +2.87 / +3.18 kg (normal/high) [92]. In a chamber, excess energy as
  fat did not raise 24EE on day 1; excess with protein raised 24EE and sleeping EE acutely in relation to protein intake [93].
- Isoenergetic, energy balance, 4 d: 30 vs 10 %E protein → sleeping MR 6.40 vs 6.12 MJ/d (+67 kcal), DIT 0.91 vs 0.69 MJ/d [95].
- Replacing carbohydrate with 17–18 %E pork protein → 24-h EE +3.9% (+492 kJ ≈ 118 kcal) [94].
- During 4.2 MJ/d restriction, 36 %E protein attenuated the fall in 24-h EE and SMR vs 15% [96]; ~34 mo after weight loss, 25 vs
  15 %E protein abolished REE-below-predicted (AT) and produced negative energy balance [97].

```
PROPOSED FIT:   dP_eff/dt = (P(t) − P_eff)/τ_P ,  τ_P = 2 d
                ΔRMR_prot = k_P · (P_eff − P0)
                k_P = 0.6 kcal per (g/d)   (range 0.3–1.1)
Data points used (residual after removing TEF (§4.4) and lean-mass effect (γ_L = 22)):
   Lejeune [95]: +67 kcal SMR / ≈+107 g protein            → 0.63
   Bray 2012 normal vs low [92]: (160 − 63) / ≈84 g          → 1.15
   Bray 2012 high vs low [92]:   (227 − 70) / ≈167 g         → 0.94
   Mikkelsen [94]: (118 − 82 TEF) / ≈117 g                  → 0.31
   Mechanistic ceiling: ≈1.0 kcal/g turned over [18]
Clamp: apply only for P_eff within 0.4–3.5 g·kg⁻¹·d⁻¹.
```
Onset: within 1 day [93] (hence τ_P = 2 d). Moderators unknown. **Grade C** (few, heterogeneous controlled studies; direction B).

---

### 4.6 NEAT, spontaneous physical activity, PAL and steps

**Magnitude.** In 332 adults (5 populations, DLW + accelerometry), size-adjusted activity EE was ~600 kcal/d (~27% of TEE) even at
0 accelerometer counts [41]. Obese sedentary adults sat ~2 h/d longer than lean; posture allocation did not change with weight
loss/gain; adopting lean-type NEAT would add ~350 kcal/d [39]. NEAT spans occupation, posture, fidgeting and is biologically
modulated [40].

**Overfeeding (Levine 1999).** +1000 kcal/d (4.2 MJ) for 8 wk, 16 non-obese: weight +4.7 ± 1.8 kg; ΔBMR +0.33 ± 0.53 MJ/d
(+79 kcal), ΔDIT +0.58 ± 0.35 MJ/d (+139 kcal), **ΔNEAT +1.38 ± 1.08 MJ/d (+330 ± 258 kcal)** — two-thirds of the TEE rise;
NEAT change predicted resistance to fat gain (r = 0.77); fat gain varied ~10-fold [38, 80]. Individual NEAT change range
−98 to +692 kcal/d and fat gain 0.36–4.23 kg (range values from secondary summaries; primary text not accessed — UNVERIFIED).

**Deficit.** CALERIE (6 mo, 25% CR): free-living PAL fell at month 3 in CR and 890-kcal LCD groups (not in CR + exercise);
chamber SPA did not fall [70]; body-composition-adjusted TDEE was −431 ± 51 (M3) and −240 ± 83 kcal/d (M6), and TDEE adjusted
for sleeping MR (activity) fell at both time points [71]. Systematic review (36 studies, 1561 participants): NEAT/NEPA
compensation in 63% of diet-only, 27% of diet+exercise and 23% of exercise-only arms; weight loss was ~2× larger in those who
compensated [47]. Biosphere-2 (2 y low-energy diet): adjusted 24-h EE −6% and SPA −45% vs controls; both still lower 6 months
after exit despite weight regain [73]. Minnesota semi-starvation (−56% energy for 24 wk, lean men): Hall's model required the
activity coefficient to fall from δ_b = 26 to δ_s = 9 kcal·kg⁻¹·d⁻¹ (−65%) [18]. At reduced weight, skeletal-muscle work
efficiency rose +26.5 ± 26.7% (ergometry), accounting for ~35% of the fall in non-resting EE; at +10% weight efficiency fell
−17.8 ± 20.5% [56].

**Steps.** In a calorimeter, moving from 8,973 to 29,588 steps/d (moderate walking) raised 24-h EE 2228 → 2816 kcal
(PAL 1.42 → 1.82) in 64.5-kg men → **0.0285 kcal/step ≈ 0.00044 kcal·kg⁻¹·step⁻¹** (derived); in 41 free-living adults PAL
(1.73 ± 0.15) was *not* correlated with step count (10,022 ± 2,605) [48]. <5000 steps/d = step-defined sedentary index [109].

**PAL multipliers.** FAO/WHO/UNU 2004: sedentary/light 1.40–1.69, active/moderately active 1.70–1.99, vigorous 2.00–2.40;
PAL > 2.40 is difficult to maintain long-term [49]. NASEM 2023 (adults ≥19 y): inactive 1.00–1.53, low active 1.53–1.68,
active 1.68–1.85, very active 1.85–2.50 [50]. Limitations: self-reported category misclassification; wide category width
(one category step ≈ 200–300 kcal/d); steps poorly track PAL [48]; TEE plateaus at high activity [41]; PAL implicitly scales
activity with RMR although activity cost scales with body weight [17].

**Equations (RECOMMENDED).**
```
Baseline:  NEAT0 = PAL0·RMR0 − RMR0 − TEF0 − EAT0            (floor 0.10·RMR0)
Daily:     NEAT(t) = NEAT0·(BW(t)/BW0) + k_step·BW(t)·(steps(t) − steps0) + AT_N(t)
           k_step = 0.00044 kcal·kg⁻¹·step⁻¹  (derived [48]; defer to dossier 10 if it provides a speed-specific value)
AT_N(t) = adaptive NEAT/efficiency change, §4.8 (state variable)
```
Individual variation (for UI): SD of NEAT response to overfeeding ≈ 0.26 × ΔEI [38, 80].

**Evidence grade:** NEAT magnitude/variance **B**; deficit-induced NEAT fall **B** (direction), magnitude C; step cost **B**.

---

### 4.7 Exercise energy and the constrained-TEE model

**Evidence for constraint.** TEE rose with activity only up to ~230 counts·min⁻¹·d⁻¹ (upper 4 deciles plateau; above
219 CPM each +100 CPM → < 50 kcal/d TEE) [41]. In 1,754 adults (IAEA DLW database), the TEE–BEE slope was 0.723 ± 0.049
(95% CI 0.626–0.820) → **energy compensation 27.7% (≈18–37%)**, occurring through reduced BEE, not different by sex or age;
compensation rises with adiposity: **29.7% at the 10th vs 45.7% at the 90th BMI percentile** [42]. Hall reinterprets the persistent
"Biggest Loser" RMR suppression as compensation for large sustained increases in activity [60]; at 6 y, weight-loss maintainers had
increased PA by 160 ± 23% vs 34 ± 25% in regainers [61].

**Evidence against / nuance.** 10-month aerobic training (400 or 600 kcal/session, 5 d/wk): no compensatory fall in non-exercise
EE or activity [44]. E-MECHANIC (24 wk, 8 or 20 kcal·kg⁻¹·wk⁻¹): compensation 1.5 and 2.7 kg was explained by increased energy
intake (+91 and +124 kcal/d); RMR and non-exercise activity did not change [45]. In a 24-wk RCT, 48% of exercisers showed
compensation (−308 ± 158 kcal/d) without metabolic adaptation in 24-h, sleep or resting EE [43]. Across 23 training studies the
initial imbalance (~2 MJ/d) decays exponentially to ~0 by ~1 y, most likely via intake [46].

```
PROPOSED (grade C):
  A_extra(t) = max(0, NEAT(t) + EAT(t) − NEAT0 − EAT0)            (extra activity energy)
  dAbar/dt   = (A_extra − Abar)/τ_c ,     τ_c = 60 d (range 30–180; no direct data)
  C_comp     = c(BMI)·Abar
  c(BMI)     = clamp(0.30 + (0.46 − 0.30)·(BMI − 20)/15, 0.30, 0.46)
               (anchors 29.7% / 45.7% at 10th/90th BMI percentile [42]; mapping those percentiles to BMI 20 and 35 is UNVERIFIED)
  C_comp is subtracted from RMR (Careau: compensation via BEE).
  Sensitivity for planner: c ∈ [0, 0.46]; default 0.28 when BMI unknown.
```
Because the app *fixes* intake by schedule, the intake-compensation channel (E-MECHANIC, Westerterp) is not modelled here
(dossier 12 appetite). EAT itself (MET-based net costs, EPOC) comes from dossier 10.

**Evidence grade: B** for existence of partial compensation (large DLW datasets), **C** for within-person time course and magnitude
in prospective trials (conflicting RCTs).

---

### 4.8 Adaptive thermogenesis (metabolic adaptation) in energy deficit

**Definition.** Change in EE beyond that predicted from changes in FM/FFM (and TEF), in response to altered intake/energy
stores. Components: (i) resting (AT_R: SNS, thyroid, insulin, organ-composition artefact [65, 66]) and (ii) non-resting (AT_N:
less NEAT, higher muscular efficiency [56]). Its quantitative size is intrinsically hard to measure because it is a residual of several error-prone measurements [68].

**Key quantitative data.**

| Study | Population / protocol | Adaptation (beyond body composition) | Timing |
|---|---|---|---|
| Leibel 1995 [53] | 18 obese + 23 never-obese; maintained −10–20% weight (liquid formula, ward) | TEE −6 ± 3 (never-obese) / −8 ± 5 (obese) kcal·kg FFM⁻¹·d⁻¹; REE and NREE each −3 to −4; not related to adiposity or sex | weight-stable after loss |
| Rosenbaum & Leibel 2010 [55] | review | 24-h EE −20–25%, i.e. 10–15% below composition-predicted (~300–400 kcal/d) | persists |
| Rosenbaum 2008 [54] | 7 matched trios, ≥10% loss maintained >1 y vs 5–8 wk | TEE, NREE, (less) REE lower; similar after recent and sustained loss | > 1 y |
| Heilbronn 2006 (CALERIE) [69] | overweight, 6 mo; 25% CR / CR+Ex / 890-kcal LCD | sedentary 24-h EE −135 ± 42 / −117 ± 52 / −125 ± 35 kcal/d (mean ± SEM; ~6%) | 6 mo |
| Redman 2009 [71] | same trial, DLW | adjusted TDEE −431 ± 51 (M3), −240 ± 83 (M6) kcal/d (CR+LCD; ± as reported, likely SEM) | 3–6 mo |
| Redman 2018 (CALERIE 2) [72] | non-obese, ~15% CR, 2 y, −8.7 kg | 24-h & sleeping EE 80–120 kcal/d below expected | sustained 2 y |
| Müller 2015 [65] | 32 non-obese young men; 1 wk +50% → 3 wk −50% → 2 wk +50% | REE −266 kcal/d; AT 108 kcal/d (48% of fall), 72 after FFM-composition; significant at ≤3 d; related to insulin fall (r = 0.92) | ≤ 3 d onset |
| Heinitz 2020 [74] | 11 obese inpatients, 6 wk −50% | 24hEE AT −178 ± 137 kcal/d at wk 1, stable to wk 6, intra-individually consistent; each −100 kcal/d AT → 8195 kcal less deficit and 2.0 kg less loss | ≤ 1 wk |
| Nymo 2018 [64] | 31 obese, 8-wk VLED | RMR first falls at 5% WL (day 12, SEM 8); AT_RMR transient at 10% WL (day 32, SEM 8): −460 (SEM 690) kJ/d (−110 kcal/d) | transient |
| Martins 2020 [62] | 71 obese, 1000 kcal/d × 8 wk (−14 kg) → 4 wk stabilisation → 9 mo | AT_RMR −92 ± 110 (W9), −38 ± 124 (W13; halved), −7 ± 129 (1 y, NS) kcal/d; not related to regain | EB-dependent |
| Martins 2022 [63] | 65 women, 800 kcal/d to BMI ≤ 25 (−16%) | AT −46 ± 113 kcal/d; predicts longer time to goal | end of loss |
| Johannsen 2012 / Fothergill 2016 [58, 57] | "Biggest Loser", vigorous exercise + CR | RMR AT −244 ± 231 (wk 6), −504 ± 171 (wk 30); **−499 ± 207 at 6 y** despite 41 kg regain; greater concurrent slowing in those maintaining more loss (r = 0.59) | persistent |
| Knuth 2014 [59] | BL vs RYGB, matched | AT in both; correlated with energy imbalance (r = 0.55) and leptin fall (r = 0.47) | — |
| Weyer 2000 [73] | Biosphere 2, 2 y restriction | adjusted 24-h EE −6%; persisted 6 mo after weight regain | > 6 mo |
| Dulloo & Jacquet 1998 [67] | Minnesota reanalysis | AT related to fat-mass depletion (not FFM depletion), during loss and recovery (r = 0.5); residual predicted by initial %fat | refeeding |
| Byrne 2018 MATADOR [75] | 51 obese men; 67% of needs; 16 wk continuous vs 8×2 wk ER alternating with 2-wk balance | adjusted REE −749 ± 498 (CON) vs −360 ± 502 kJ/d (INT) (−179 vs −86 kcal/d); weight loss 9.1 vs 14.1 kg; FFM loss equal; 0.0 ± 0.3 kg change in balance blocks | diet breaks |
| Peos 2021 ICECAP [76] | 61 resistance-trained, 12 wk (4×3 wk ER + 3×1 wk balance) vs continuous | no difference in FM, FFM, REE, leptin, T3; less hunger with breaks | failed replication |
| Siedler 2023 [77] | 38 trained women; 25% ER; 1 wk balance after every 2 wk | no difference in body composition or RMR | failed replication |
| Campbell 2020 [78] | 27 trained; 2-day carb refeed/wk × 7 wk | RMR −38 vs −78 kcal/d; FFM better kept (small n) | refeeds |
| Wing & Jeffery 2003 [79] | 142, behavioural program with 2- or 6-wk breaks | breaks slowed loss; overall weight loss equal | breaks harmless |

**Model (RECOMMENDED; Hall-type, grade B).** Hall 2011 represents AT as a first-order process proportional to the change of
energy intake from its (weight-stable) baseline: `dAT/dt = (β_AT·ΔEI − AT)/τ_AT` with **β_AT = 0.14** (from a steady-state
analysis of 8 longitudinal weight-loss studies, 157 subjects [19]) and **τ_AT = 14 d**; TEF is separately 0.1·ΔEI [17]. Hall
2006 (fitted to Minnesota) used τ = 7 d and allocated 60% of AT to physical-activity EE (σ = 0.6) and 40% to RMR [18]. We keep
β_AT and σ, and make onset faster for the resting part (data: significant AT ≤3 d [65], full at 1 wk [74]).

```
ΔEI(t)  = EI(t) − EI0                                 (kcal/d; EI0 = weight-stable baseline intake)
AT*(t)  = β_AT·ΔEI(t)            β_AT = 0.14 (both signs; see §4.9)
AT_R*   = (1 − σ)·AT*            σ = 0.6
AT_N*   = σ·AT*
Update (exact exponential step, Δt = 1 d):
   AT_R ← AT_R + (AT_R* − AT_R)·(1 − exp(−Δt/τ_R)),   τ_R = 7 d  if |AT_R*| > |AT_R| (building), else τ_off = 14 d
   AT_N ← AT_N + (AT_N* − AT_N)·(1 − exp(−Δt/τ_N)),   τ_N = 14 d building, τ_off = 14 d
```

| Param | Value | Uncertainty / sensitivity | Source |
|---|---|---|---|
| β_AT | 0.14 | 0.05–0.40 (upper bound approaches MATADOR/CALERIE-M3-type data; Leibel-type inpatient data exceed even this; lower bound ICECAP/Martins-1y) | [17, 19] |
| σ | 0.6 | 0.4–0.8 | [18] |
| τ_R (onset) | 7 d | 3–14 | [18, 65, 74] |
| τ_N (onset) | 14 d | 7–30 (PAL fell by month 3 [70]) | [17, 70] |
| τ_off | 14 d | 14–42 (PROPOSED: Martins halving within 4 wk [62]; MATADOR 2-wk balance blocks roughly halved adjusted-REE fall [75]) | [17, 62, 75] |
| Inter-individual SD of AT | 0.11·abs(ΔEI) (≈100–140 kcal/d at 1000–1500 kcal deficits) | PROPOSED from SDs ±110 [62], ±137 [74], ±127 [66] | — |

Behaviour of the recommended model:
- **Onset lag / time-constant:** 63% of the resting target within 7 d, NEAT part within 14 d.
- **Dependence on deficit size:** linear in ΔEI (Knuth r = 0.55 with imbalance [59]).
- **Persistence after weight stabilises:** at a new, lower weight the maintenance intake is still < EI0, so AT persists at
  β_AT·(EI_maint − EI0) — consistent with persistence at >1 y [54], 2 y [72] and the partial decline when intake is raised to the new
  maintenance [62]. It returns to zero only when intake returns to EI0 (e.g. after regain) — consistent with Martins 1 y [62].
- **Refeeding/diet breaks:** raising EI toward EI0 relaxes AT with τ_off. Model-predicted benefit of 1–2-wk breaks on *fat loss per
  week of dieting* is small; this matches ICECAP and Siedler better than MATADOR (graded: MATADOR single trial, grade C).
- **Leanness:** not in the default model (Leibel found no adiposity dependence [53]; Dulloo & Jacquet found fat-depletion
  dependence [67]). Optional structural extension below.
- **Very large exercise volumes:** apparent extra RMR suppression is produced by §4.7 compensation, not by AT (Hall 2022 [60]).

**Optional extension (grade D, default OFF): fat-depletion ("lipostatic") component.**
```
D_F = max(0, 1 − FM/FM_ref) ;   FM_ref relaxes toward FM with τ_ref = 365 d (settling point; speculative)
AT_F* = −κ_F·RMR0·D_F ,  κ_F ∈ [0, 0.3] (sensitivity only; no validated value)
AT_F follows AT_F* with τ = 28 d.  Motivated by [67] (AT ∝ fat depletion), [59] (∝ leptin fall), [73] (persists after regain).
```

**Evidence grade: B** — existence and 50–150 kcal/d typical resting magnitude replicated in controlled trials; the β_AT/τ values
come from a validated model [17, 19]; persistence/reversal kinetics and diet-break effects are contested (C).

---

### 4.9 Adaptive changes in surplus ("luxuskonsumption")

**Evidence.**
- Maintaining +10% weight: TEE +9 ± 7 (never-obese) / +8 ± 4 (obese) kcal·kg FFM⁻¹·d⁻¹; TEF +1–2 and NREE +8–9 kcal·kg FFM⁻¹·d⁻¹ [53].
- Of 16 selected overfeeding studies, 5 claimed adaptive thermogenesis; 11 found EE rises explained by larger body size and larger
  intake (TEF); if present, AT is too small to measure reliably [80].
- 9 d at 1.6× maintenance (+8.0 MJ/d): BMR +622 kJ/d = one-third of 24-h EE rise (+2038 kJ/d), rest TEF and cost of carrying extra
  weight; ~25% of excess dissipated, 75% stored; "no evidence for luxuskonsumption" [81].
- 42 d at +50% (+6.2 MJ/d): +7.6 kg (58% fat); BMR +0.9 MJ/d, calorimetric EE +1.8 MJ/d, DLW TEE +1.4 ± 2.0 MJ/d; all consistent with
  theoretical costs; no active dissipation [82].
- 12 MZ twin pairs, +1000 kcal/d × 84 d: weight +8.1 kg (range 4.3–13.3); ~3× more variance between than within pairs [83].
- NEAT is the most variable channel: +330 ± 258 kcal/d at +1000 kcal/d [38].
- 14 d OF after CR: FFM-adjusted AT +27 ± 115 (NS), +86 after FFM-composition adjustment [66].
- Fat overfeeding stores 90–95% of excess energy vs 75–85% for carbohydrate overfeeding [98].

**Model.** Same ODE as §4.8 (β_AT applies to positive ΔEI; Hall 2011 is symmetric [17]); the surplus-side inter-individual SD is
large: `SD(AT_N) ≈ 0.26·ΔEI` [38]. Planner sensitivity: β_AT⁺ ∈ [0, 0.35]. **Grade C** (inconsistent; mean effect small, variance large).

---

### 4.10 Macronutrient composition (carbohydrate ↔ fat at equal energy and protein)

**Evidence.**
- Metabolic ward, 17 men: 4 wk baseline (50/35/15 %E C/F/P) → 4 wk isocaloric ketogenic (5/80/15): chamber EE +57 ± 13 kcal/d,
  sleeping EE +89 ± 14, DLW +151 ± 63 kcal/d; body-fat loss *slowed* on KD [84]. Re-analysis: chamber ΔEE +24 ± 30 (NS), energy-
  balance ΔEE −141 ± 118 (NS); DLW +209 ± 83 unadjusted, +139 ± 89 with diet-specific RQ, +46 ± 65 after RQ adjustment and
  removal of 2 outliers — DLW differences were artefacts of RQ assumptions [85].
- 6-d ward crossover: carbohydrate restriction → fat loss 53 ± 6 g/d vs fat restriction 89 ± 6 g/d (isocaloric) [90].
- Meta-analysis of 32 controlled feeding studies: EE 26 kcal/d higher (and fat loss 16 g/d greater) with *lower-fat* diets [88].
- Weight-loss maintenance RCT (n = 164, 20 wk, DLW): TEE +52 kcal/d (23–82) per 10 %E less carbohydrate; LC vs HC +209 (91–326)
  ITT, +278 (144–411) per protocol; +308/+478 in highest insulin-secretion tertile [86]. Re-analysis by the pre-registered plan:
  TEE fell 240 ± 64 / 322 ± 66 / 356 ± 67 kcal/d (low/moderate/high carb) vs pre-weight-loss, p = 0.43 (no diet effect) [87].
  Earlier 3-way crossover (4 wk each, n = 21): TEE fall −423 (low-fat) / −297 (low-GI) / −97 (very-low-carb) kcal/d [91].
- Updated meta-analysis (29 trials, 617 participants, median 4 d): short trials (<2.5 wk) −50.0 kcal/d (−77.4 to −22.6) on lower-carb;
  6 longer trials +135.4 kcal/d (72.0–198.7); per 10 %E less carbohydrate −14.5 (short) and +50.4 kcal/d (long) [89].

**Mechanistic decomposition used by the engine (grade B for signs).**
```
ΔTEF (automatic from §4.4): shifting 10 %E from fat to carbohydrate at 2500 kcal/d → +12.5 kcal/d
     (reproduces the ~26 kcal/d lower-fat advantage of [88] for typical 20–30 %E swaps)
ΔEE_GNG = (1 − ε_g)·ΔGNG_kcal ,  ε_g = 0.8  [18]    (GNG fluxes from dossiers 04/05)
     e.g. if dossier 05 predicts ΔGNG ≈ 60–80 g/d glucose on a ketogenic diet (illustrative figure, UNVERIFIED here)
     → +48–64 kcal/d (PROPOSED; offsets the KD ~−56 kcal/d TEF loss,
     net ≈ 0 vs measured chamber +24 to +57 kcal/d [84, 85])
Long-term "CIM" term (default 0):
     ΔEE_CIM = κ_CHO·max(0, (C%E0 − C%E(t))/10)·g(t),  κ_CHO = 0 kcal/d default; sensitivity +50 [89]
     g(t) = 1 − exp(−t_since_change/17 d)   (onset ≈2.5 wk per [89]; PROPOSED)
```
**Best estimate:** at equal energy and protein, carbohydrate:fat ratio changes TEE by **≈0 ± 50 kcal/d per 10 %E** beyond TEF/GNG
effects (95% plausible range −15 to +50 kcal/d per 10 %E: short-term meta estimate to long-term meta estimate). Show as
"contested" in UI. **Grade B** (multiple ward studies) for "small (<~100 kcal/d)"; C for any sustained low-carbohydrate advantage.

---

### 4.11 Energy cost of tissue deposition and mobilisation

**Energy content and synthesis cost (Hall).**

| Quantity | Value | Source |
|---|---|---|
| Energy density of body fat change ρ_F | 39.5 MJ/kg = **9,440 kcal/kg** | [17, 21] |
| Energy density of lean-tissue change ρ_L | 7.6 MJ/kg = **1,816 kcal/kg** | [17, 21] |
| Energy density of glycogen ρ_G | 17.6 MJ/kg = 4,206 kcal/kg; stored with ~2.7 g water/g | [17] |
| Fat deposition cost η_F | 750 kJ/kg = **180 kcal per kg fat** (≈1.9% of stored energy) | [17, 20] |
| Lean deposition cost η_L | 960 kJ/kg = **230 kcal per kg lean** | [17, 20] |
| Stoichiometric costs | TG synthesis 0.18 kcal/g (8 ATP/TG); glycogen 0.21 kcal/g (2 ATP/glycosyl); protein synthesis 0.86 kcal/g; protein degradation 0.17 kcal/g; 19 kcal oxidised per mol ATP | [18] |
| DNL efficiency ε_d | 0.8 (20% of carbohydrate energy lost converting to fat) | [18] |
| GNG efficiency ε_g | 0.8 | [18] |
| Empirical (rat) costs | 2.25 kJ ME per kJ protein deposited; 1.36 kJ ME per kJ fat deposited (≈53 kJ ME/g for both) | [100] (animal, grade D) |

**Derived totals (per kg deposited).**
- Adipose fat from **dietary fat**: 9,440 + 180 ≈ **9,620 kcal/kg** (≈98% efficiency).
- Fat from **carbohydrate via DNL**: 9,440 / 0.8 + 180 ≈ **11,980 kcal/kg** (≈79% efficiency). Validation: during massive
  carbohydrate overfeeding with saturated glycogen, ~475 g CHO/d produced ~150 g lipid/d [99] → (150 × 9.4)/(475 × 4.0) ≈ 74%.
  Glycogen capacity ≈15 g/kg body weight, ~500 g can be gained before net lipogenesis [99].
- Whole-diet overfeeding: fat overfeeding stored 90–95% of excess energy vs carbohydrate 75–85% (14 d, lean and obese men) [98].
- Protein/lean tissue: 1,816 + 230 ≈ **2,050 kcal per kg lean** (Hall); rat-derived upper estimate for muscle (≈20% protein):
  200 g × 5.65 kcal/g × 2.25 ≈ **2,540 kcal per kg** (derived, grade D).
- Mobilisation yields ρ_F / ρ_L; the η terms enter EE with the sign of dF/dt, dL/dt (Hall formulation: EE includes
  η_F·dF/dt + η_L·dL/dt) [17]. Note: 7,700 kcal/kg (3,500 kcal/lb) rule only holds for people with > ~30 kg initial fat; leaner
  people need a smaller deficit per kg lost because more of it is lean tissue [21].

**Engine usage.** Dossier 01 owns partitioning; this dossier supplies η_F, η_L, ε_d, ε_g for the EE equation:
```
EE_dep = η_F·dFM/dt + η_L·dFFM_protein/dt + (1 − ε_d)·DNL_kcal + (1 − ε_g)·(GNG_kcal − GNG0_kcal)
```
(DNL cost only for DNL above baseline to avoid double counting with α_C.) **Grade B** (biochemical stoichiometry + model
validation; DNL efficiency supported by human overfeeding balance data).

---

### 4.12 Measurement uncertainty and the confidence band for predicted TDEE

**Evidence.**
- NASEM 2023 DLW-based TEE equations (≥19 y) [50]:
  ```
  Men   inactive:     753.07 − 10.83·A + 6.50·H + 14.10·W
        low active:   581.47 − 10.83·A + 8.30·H + 14.94·W
        active:      1004.82 − 10.83·A + 6.52·H + 15.91·W
        very active: −517.88 − 10.83·A + 15.61·H + 19.11·W      R² 0.73; RMSE 339 kcal/d; MAPE 9.4%; MAE 266
  Women inactive:     584.90 − 7.01·A + 5.72·H + 11.71·W
        low active:   575.77 − 7.01·A + 6.60·H + 12.14·W
        active:       710.25 − 7.01·A + 6.54·H + 12.34·W
        very active:  511.83 − 7.01·A + 9.07·H + 12.56·W        R² 0.71; RMSE 246 kcal/d; MAPE 8.7%; MAE 191
  SE of a predicted individual value (men ≥19 y) = 342 kcal/d → 95% PI ≈ ±670 kcal/d
  ```
- IAEA DLW equation (6,497 measures, 4–96 y) [51] (TEE in MJ/d; sex −1 male, +1 female; elevation m (use 158.5 if unknown);
  ethnicity dummies A_fr (African), AA (African living outside Africa), AS, W, H_isp (Hispanic), NA (not available); 0/1):
  ```
  ln TEE = −0.2172 + 0.4167·ln BW + 0.006565·H − 0.02054·A + 0.0003308·A² − 0.000001852·A³ + 0.09126·ln Elev
           − 0.04092·Sex + 0.01940·A_fr − 0.03899·AA + 0.006238·AS + 0.02626·W + (−0.0155)·H_isp + 0.003589·NA
           − 0.0006759·H·ln Elev + 0.002018·A·ln Elev − 0.00002262·A²·ln Elev − 0.006947·Sex·ln Elev
  95% PI: lower = 0.7466·pTEE − 1.5405 ;  upper = 1.3395·pTEE + 2.7668   (MJ/d)
  ```
  Validation: 94.6% of 598 held-out measures inside the PI; under-predicts athletes and pregnant/lactating women [51].
  Example (90 kg, 180 cm, 35-y white man): pTEE 13.63 MJ = 3,258 kcal/d; 95% PI 2,064–5,025 kcal/d.
- RMR equations: 21–32% of individuals outside ±10% even with the best equation [10]; biological CV_intra of REE ≈5% [15].
- Metabolic adaptation individual SD ≈110–140 kcal/d [62, 66, 74]; NEAT response SD 258 kcal/d at +1000 kcal/d [38].

**Recommended UI band (PROPOSED).**
```
σ_TDEE0 = TDEE0 · cv0,  cv0 = 0.12 (no body comp, PAL self-report; ≈ NASEM RMSE/mean),
                          0.10 (BF% known), 0.08 (RMR measured), 0.05 (calibrated: ≥28 d of intake log + weight trend)
σ_TDEE(t) = sqrt( σ_TDEE0² + (0.11·ΔEI)² + (0.26·max(0,ΔEI))²·w_surplus + (0.28·Abar·0.5)² )
            (w_surplus = 1 when ΔEI > 0; last term = uncertainty of compensation fraction)
Show TDEE ± 1.0·σ (≈68%) as band and ± 1.96·σ as faint band.
```
Calibration (strongly recommended): if the user logs intake and weight, back-calculate TDEE_obs = EI − ρ·dW/dt (ρ from dossier 01,
using ≥ 2–4 weeks to average out water) and Bayesian-update RMR0/NEAT0 scale factor; shrink cv0 accordingly. **Grade A** for the
size of equation error; band formula PROPOSED.

---

### 4.13 Recommended integrated algorithm (daily step)

```
TDEE(t) = RMR(t) + TEF(t) + NEAT(t) + EAT(t) + EE_dep(t)

RMR(t)  = RMR0
        + γ_L·[(FFM_act − SM_RT) − FFM_act0] + γ_SM·SM_RT + γ_F·(FM − FM0)          §4.2
        + AT_R(t)                                                                     §4.8
        + k_P·(P_eff − P0)                                                            §4.5
        − C_comp(t)                                                                   §4.7
        + a_lut·RMR·s(d) + 0.11·RMR·ΔT_core + k_caff·caffeine_mg                      §4.3
        [+ ΔEE_CIM (default 0)]                                                       §4.10
        (× f_age for multi-year runs if the RMR0 equation lacks an age term)

TEF(t)  = m_IR·m_proc·[0.25·E_P + 0.075·E_C + E_F·(0.025 + 0.065·f_MCT) + 0.20·E_alc + 0.30·E_fib]   §4.4
NEAT(t) = NEAT0·BW/BW0 + k_step·BW·(steps − steps0) + AT_N(t)                        §4.6
EAT(t)  = Σ net exercise cost (dossier 10)
EE_dep  = η_F·dFM/dt + η_L·dFFM_prot/dt + 0.2·max(0, DNL − DNL0) + 0.2·(GNG − GNG0)  §4.11 (fluxes from 01/04/05)
```

**Initialisation (t = 0).**
1. `RMR0` by the §4.1 selection rule (measured > FFM-based > Mifflin).
2. `TDEE0`: if the user gives PAL category, `TDEE0 = PAL0·RMR0` (use mid-category: FAO sedentary 1.55, active 1.85, vigorous 2.2
   [49]). Cross-check with NASEM 2023 [50]; if they disagree by > 15%, average them and widen cv0 to 0.15 (PROPOSED).
   If steps and exercise are given: `TDEE0 = (RMR0 + NEAT_nonstep + k_step·BW·steps0 + EAT0)/(1 − α_mix0)`, with
   `NEAT_nonstep = 0.15·RMR0` (PROPOSED default for non-locomotor NEAT; calibrate to PAL 1.4 at 5,000 steps/d).
3. `EI0 = TDEE0` (weight-stable assumption; if the user reports a weight trend, `EI0 = TDEE0 + ρ·dW/dt`).
4. `P0` = habitual protein (default 15–18 %E if unknown); `TEF0` from §4.4 at EI0; `NEAT0 = TDEE0 − RMR0 − TEF0 − EAT0`.
5. `AT_R = AT_N = Abar = C_comp = 0`; `P_eff = P0`; `FM0, FFM_act0, BW0` from dossier 14.

**Daily update (pseudo-TypeScript).**
```ts
const step = (x: number, target: number, tau: number, dt = 1) => x + (target - x) * (1 - Math.exp(-dt / tau));

function eeStep(s: EEState, inp: DayInput, p = EE_PARAMS): EEOutput {
  const dEI   = inp.EI - s.EI0;
  const ATstar = p.betaAT * dEI;                                 // 0.14
  const ATRstar = (1 - p.sigma) * ATstar, ATNstar = p.sigma * ATstar; // sigma 0.6
  s.AT_R = step(s.AT_R, ATRstar, Math.abs(ATRstar) > Math.abs(s.AT_R) ? p.tauR_on : p.tau_off); // 7 / 14 d
  s.AT_N = step(s.AT_N, ATNstar, Math.abs(ATNstar) > Math.abs(s.AT_N) ? p.tauN_on : p.tau_off); // 14 / 14 d
  s.P_eff = step(s.P_eff, inp.protein_g, p.tauP);                // 2 d
  const neat = s.NEAT0 * inp.BW / s.BW0 + p.kStep * inp.BW * (inp.steps - s.steps0) + s.AT_N;
  const extra = Math.max(0, neat + inp.EAT - s.NEAT0 - s.EAT0);
  s.Abar = step(s.Abar, extra, p.tauC);                           // 60 d
  const Ccomp = cOfBMI(inp.BW / (inp.H_m ** 2)) * s.Abar;         // 0.30–0.46
  let rmr = s.RMR0
    + p.gL * ((inp.FFM_act - inp.SM_RT) - s.FFM_act0) + p.gSM * inp.SM_RT + p.gF * (inp.FM - s.FM0)
    + s.AT_R + p.kP * (s.P_eff - s.P0) - Ccomp;
  rmr += p.aLut * rmr * inp.lutealWeight + 0.11 * rmr * inp.dTcore + p.kCaff * Math.min(inp.caffeine_mg, 600);
  const tef = teF(inp.macros, inp.IR, inp.fUPF, p);              // §4.4
  const dep = p.etaF * inp.dFM + p.etaL * inp.dFFMprot + 0.2 * Math.max(0, inp.DNL - s.DNL0) + 0.2 * (inp.GNG - s.GNG0);
  const tdee = rmr + tef + neat + inp.EAT + dep;
  return { tdee, rmr, tef, neat, eat: inp.EAT, AT_total: s.AT_R + s.AT_N, Ccomp,
           sigma: sigmaTDEE(s, dEI) };
}
```
**Maintenance calories shown to the user.**
```
Instantaneous maintenance (intake that would give zero energy balance today, AT frozen):
   EI_inst = (RMR + NEAT + EAT + EE_dep_other)/(1 − α_mix)          α_mix = TEF/EI for the planned macro mix
Settled maintenance at the current body composition (AT allowed to relax to its new target):
   EI_m = (B − β_AT·EI0)/(1 − α_mix − β_AT),  B = RMR + NEAT + EAT with AT_R = AT_N = 0
```
**Worked example (male 35 y, 180 cm, 90 kg, 25% fat; Müller-FFM RMR0 = 1879; PAL 1.60).** TDEE0 = 3006; habitual 20/45/35 %E
→ P0 = 150 g, TEF0 = 278, NEAT0 = 849 kcal/d. Switch to 25% deficit (EI 2255, 30/40/30 %E): TEF 254; ΔEI −752 → AT* −105
(AT_R* −42, AT_N* −63); day-1 TDEE 2976. At week 12, assuming −5 kg FM and −1.5 kg active FFM (BW 83 kg): RMR mass term −49,
NEAT 783, AT at target, protein term +11 → TDEE ≈ 2773, i.e. the real deficit has shrunk from 752 to ≈518 kcal/d.
Instantaneous maintenance 2839; settled maintenance 2948 kcal/d (higher-protein diet raises α_mix to 11.3%).

---

## 5. Interactions with other subsystems

| Module | This dossier needs | This dossier provides |
|---|---|---|
| 01 Body-weight models | FM, FFM, BW trajectories; energy-balance solver; ρ_F, ρ_L | TDEE(t) and components; η_F, η_L, ε_d, ε_g; AT ODE parameters (consistent with Hall 2011) |
| 03 Protein / MPS | protein g/d, per-meal distribution | k_P protein-turnover EE term; TEF of protein |
| 04 Carbohydrate / glycogen | glycogen + bound water (to exclude from FFM_act), DNL flux | TEF_C; DNL cost 20% |
| 05 Fat oxidation / ketosis | GNG flux, ketosis state | GNG cost 20%; composition-EE term (default 0) |
| 06 Biomarkers | insulin-resistance index | TEF multiplier m_IR |
| 07 Meal timing | meal list | per-meal TEF distribution (~6 h); confirms no 24-h meal-frequency effect |
| 09 Resistance training | SM_RT (muscle accretion) | γ_SM = 13 kcal/kg for muscle-specific RMR change |
| 10 Cardio / activity | EAT per session, EPOC, speed-specific walking cost | constrained-TEE compensation C_comp; k_step fallback |
| 11 Overfeeding | partitioning in surplus | AT in surplus (β_AT⁺), NEAT variance |
| 12 Hormones / appetite | leptin, T3 (optional drivers), appetite (intake compensation) | AT state (proxy for "metabolic adaptation" output), energy deficit signal |
| 13 Transitions / periodisation | diet-break / refeed schedules | τ_off, AT relaxation, evidence on diet breaks |
| 14 Anthropometrics | FM0, FFM0, BF% method, organ-mass proxies (optional) | RMR0 selection; cv0 by input quality |
| 15 Fibre / alcohol / caffeine | fibre energy factor (ME 2.0 vs NME 1.4), alcohol g, caffeine mg | TEF_alc 0.20, TEF_fibre 0.30 (if ME), k_caff |
| 16 Sleep / menstrual / ageing | cycle phase, age, core temperature | a_lut, f_age, temperature coefficient |
| 17 Safety | — | flags in §9 |
| 18 Planner | — | parameter sensitivity ranges (β_AT, c, κ_CHO, k_P) for robust planning |

---

## 6. Output metrics for the UI

| Metric | Unit | Direction of good | Computation | Grade |
|---|---|---|---|---|
| TDEE (with band) | kcal/d | context | §4.13, σ from §4.12 | A (level) / B (dynamics) |
| RMR | kcal/d | context (higher preserves maintenance) | §4.13 RMR(t) | A/B |
| TEF | kcal/d, % of EI | context | §4.4 | B |
| NEAT (non-exercise activity EE) | kcal/d | higher | §4.6 | B/C |
| Exercise EE (net, after compensation) | kcal/d | context | EAT − C_comp | C |
| Metabolic adaptation (total) | kcal/d and % of TDEE | closer to 0 | AT_R + AT_N (+ C_comp shown separately) | B |
| Metabolic adaptation — resting | kcal/d | closer to 0 | AT_R | B |
| Current energy balance | kcal/d | goal-dependent | EI − TDEE | A |
| Instantaneous maintenance calories | kcal/d | — | EI_inst (§4.13) | B |
| Settled maintenance calories | kcal/d | — | EI_m (§4.13) | B |
| Real vs planned deficit | kcal/d | — | (EI0 − EI) vs (TDEE − EI) | B |
| Protein-turnover EE bonus | kcal/d | — | k_P·(P_eff − P0) | C |
| "Composition-effect uncertainty" flag | text | — | show when carb %E changes > 20 points: ±50 kcal/d per 10 %E contested | B/C |

---

## 7. Validation targets (engine should reproduce within tolerance)

1. **Levine 1999 overfeeding [38, 80].** 16 non-obese adults, +1000 kcal/d (20/40/40 %E P/F/C) × 56 d. Observed: ΔBMR +79 ± 127,
   ΔDIT +139 ± 84, ΔNEAT +330 ± 258 kcal/d; weight +4.7 ± 1.8 kg. Engine (average person) should give ΔTEE +350–550 kcal/d;
   tolerance: TEE ±150 kcal/d; weight ±1.5 kg. (Default model ≈ +390 kcal/d; Levine's cohort is a high-NEAT-responder sample.)
2. **Bray 2012 protein overfeeding [92].** 25 adults, +954 kcal/d (≈40%) × 56 d at 5/15/25 %E protein. Observed REE change
   ≈0 / +160 / +227 kcal/d; weight +3.16 / +6.05 / +6.51 kg; lean +≈0 / +2.87 / +3.18 kg; fat gain similar (~3.5 kg). Model check
   with §4.5: ≈ +21 / +149 / +205 kcal/d. Tolerance REE ±60 kcal/d.
3. **Hall 2016 isocaloric ketogenic ward study [84, 85].** 17 overweight men, 4 wk 50/35/15 → 4 wk 5/80/15 %E C/F/P, same energy.
   Observed chamber EE +57 ± 13 (re-analysed +24 ± 30), SEE +89 ± 14 kcal/d; body-fat loss slowed. Engine: ΔTEE between −30 and
   +100 kcal/d with default κ_CHO = 0.
4. **Heilbronn 2006 / Redman 2009 CALERIE-1 [69, 71].** Overweight adults, 25% CR × 6 mo: weight −10.4 ± 0.9%; sedentary 24-h EE
   beyond composition −135 ± 42 kcal/d; composition-adjusted TDEE −240 ± 83 kcal/d at M6. Engine: AT_R + ΔTEF within −60 to −200;
   AT_R + AT_N within −100 to −350 kcal/d.
5. **Martins 2020 [62].** 71 obese, 1000 kcal/d × 8 wk (−14 kg), 4 wk stabilisation. RMR-AT −92 ± 110 (W9) → −38 ± 124 (W13).
   Engine AT_R: −60 to −120 at W9 and ≥40% smaller at W13 once intake is raised to maintenance.
6. **Biggest Loser (Johannsen 2012; Fothergill 2016) [57, 58].** Severe obesity (BMI 49), vigorous exercise + CR, −38% weight at
   30 wk (17% of loss FFM); RMR adaptation −504 ± 171 kcal/d at wk 30, −499 ± 207 at 6 y. Engine: AT_R + C_comp (high-BMI c ≈ 0.46,
   activity +6–10 kcal·kg⁻¹·d⁻¹) within −300 to −650 kcal/d. Without C_comp the model must under-predict (documents Hall 2022 [60]).
7. **Byrne 2018 MATADOR vs Peos 2021 ICECAP [75, 76].** Continuous vs 2-wk-on/2-wk-off (67% of needs, 16 wk ER): observed weight loss
   9.1 vs 14.1 kg, adjusted REE −179 vs −86 kcal/d. Engine should predict the *direction* (smaller AT in intermittent) but a modest
   difference in fat loss per ER week (≤1–2 kg); ICECAP (3 wk ER / 1 wk balance) should show ≈ no difference. Treat MATADOR as
   out-of-tolerance-allowed.
8. **Leibel 1995 [53].** Maintaining −10% weight: TEE −6 to −8 kcal·kg FFM⁻¹·d⁻¹ (≈10–15% below composition-predicted [55]);
   +10%: +8 to +9. **Known discrepancy:** with default β_AT the engine gives only ≈ −1 kcal·kg FFM⁻¹·d⁻¹ beyond composition at
   weight-reduced maintenance (ΔEI ≈ −350 kcal/d), and ≈ −2.5 even at β_AT = 0.40. Do not tune the default to this dataset
   (inpatient liquid-formula protocol; conflicts with [62, 76, 77]); expose it as the "high-adaptation" scenario (β_AT = 0.40 plus
   the §4.8 fat-depletion extension with κ_F ≈ 0.3).
9. **Ohkawara 2011 [48].** 64.5-kg men, +20,615 steps/d → 24-h EE +588 kcal/d (±15%).
10. **Mikkelsen 2000 [94].** 4-d isoenergetic, replacing carbohydrate with 17–18 %E pork protein → 24-h EE +118 kcal/d (+3.9%);
    engine: +80–120 kcal/d (TEF + k_P).

---

## 8. Myths / contested claims

| Claim | Evidence |
|---|---|
| "A kg of muscle burns ~100 kcal/d (1 lb burns 50)" | Skeletal muscle ≈ 13 kcal·kg⁻¹·d⁻¹ (≈6 kcal/lb) [7]. Gaining 2 kg muscle adds ~26 kcal/d RMR. |
| "Metabolism declines steadily from your 20s" | FFM/FM-adjusted TEE is flat 20–60 y; decline ~0.7%/y begins ~60–63 y [52]. |
| "Starvation mode stops fat loss" | AT is typically 50–150 kcal/d resting and ≤10–15% of TEE even in extreme cases [53, 62, 65, 69]; it slows but does not stop loss at a real deficit. |
| "Metabolic damage is permanent" | RMR-AT halved within 4 wk of energy balance and was ~0 at 1 y after partial regain [62]; very large persistent values (Biggest Loser) are plausibly compensation for high activity [60, 61]. Some persistence at reduced weight is real [54, 72]. |
| "Eating 6 small meals stokes metabolism" | 24-h EE identical for 3 vs 6 or 14 meals [32–34]. |
| "Low-carb gives a 300–400 kcal/d metabolic advantage" | Ward studies: ~0–60 kcal/d chamber difference [84, 85, 90]; meta-analyses conflict (−50 short-term vs +135 long-term) [88, 89]; the large BMJ effect is not robust to the pre-registered analysis [86, 87]. |
| "Diet breaks reset metabolism and accelerate fat loss" | One positive RCT (MATADOR) [75]; two RCTs in trained people found no body-composition or RMR benefit [76, 77]; breaks do not harm overall loss [79] and may reduce hunger [76]. |
| "Every exercise calorie adds to your deficit 1:1" | Cross-sectional compensation ~28% (up to ~46% with high adiposity) [42]; trials show compensation mainly via intake [45, 46]. |
| "Alcohol calories don't count" | TEF ≈ 17–22% of ethanol energy [26]; ~80% is usable; another study found no inefficiency [27]. |
| "Caffeine/green-tea 'fat burners' raise metabolism a lot" | 600 mg/d caffeine ≈ +79–150 kcal/d in short studies [105]; habituation untested. |
| "Protein's only extra calorie cost is TEF" | Higher protein also raises sleeping/resting EE (turnover) ~0.3–1.1 kcal per extra g/d [92, 93, 95]. |
| "Women burn more in the luteal phase so should eat much more" | Effect ≈ +2–9% (≈+50–150 kcal/d), small and inconsistent in modern studies [101–104]. |
| "3,500 kcal = 1 lb (7,700 kcal = 1 kg) always" | Energy density of loss depends on initial body fat; lean people need less deficit per kg [21]. |

---

## 9. Safety bounds relevant to this topic

- **Implausible activity:** PAL > 2.40 sustained is difficult to maintain [49]; cap PAL input at 2.5 and warn above 2.4.
- **Intake below predicted RMR** for more than a few days, or very-low-energy intakes: route to dossier 17 thresholds (medical
  supervision, protein floors); the simulator should label AT and lean-loss projections as low-confidence in this regime (data
  mostly from obese inpatients or the Minnesota experiment).
- **Model-validity guards:** clamp |AT_R + AT_N| ≤ 0.25·TDEE0 and C_comp ≤ 0.46·Abar; flag if RMR(t) < 0.6·RMR0 or TDEE(t) < 1.1·RMR(t)
  (PROPOSED numerical guards).
- **Extreme leanness** (e.g. competition-level body fat): adaptation and NEAT drops may exceed model values (Minnesota [18, 67]); warn
  and widen uncertainty.
- **Caffeine:** k_caff applies only up to 600 mg/d (studied range [105]); safe-dose limits belong to dossier 15/17.
- **Fever/hypothermia:** temperature term valid only for |ΔT| ≤ 2 °C; outside that, do not simulate.
- **Planner:** must not exploit contested terms (κ_CHO, diet-break AT benefit, processing multiplier) to generate plans; run planner
  with default (conservative) values and report sensitivity.

---

## 10. Open questions / weakest assumptions

1. **β_AT = 0.14 and σ = 0.6** come from two Hall models fitted to different datasets (weight-loss maintenance studies; Minnesota).
   Several controlled studies (Leibel, MATADOR, CALERIE M3) imply larger AT; others (Martins 1 y, ICECAP) smaller. True value is
   probably heterogeneous by leanness, deficit severity and activity.
2. **Reversal kinetics (τ_off) and hysteresis** are poorly measured; diet-break evidence is inconsistent.
3. **Driver of AT:** intake change (Hall), energy imbalance (Martins, Knuth) or fat depletion/leptin (Dulloo, Rosenbaum) — these
   predict different behaviour at weight-reduced maintenance. The default uses ΔEI; the fat-depletion extension is unvalidated.
4. **Constrained-TEE within-person dynamics:** cross-sectional 28% vs RCTs showing little EE compensation over 6–10 months; τ_c and the
   BMI mapping of c are guesses.
5. **Protein-turnover term k_P** rests on 4–5 small studies with different designs.
6. **TEF modifiers** (insulin resistance, processing, fibre, MCT) lack pooled human estimates.
7. **Müller 2004 weight-equation constant** (3.21 vs 3.31) and **Oxford coefficients** were taken from secondary sources.
8. **FFM composition:** marginal RMR per kg FFM lost may differ from 22 kcal/kg when organs shrink disproportionately [65, 66]; the
   engine does not track organ masses.
9. **Individual calibration:** without user feedback, TDEE uncertainty (±12%, ±300–400 kcal/d 1-SD) dominates all dynamic effects
   discussed here; the app's weight-trend calibration is the single largest accuracy gain.
10. **Menstrual, caffeine and temperature terms** are small and may be dropped from the MVP.

---
## 11. References

All PubMed records are at `https://pubmed.ncbi.nlm.nih.gov/<PMID>/`. Abstracts of every PubMed-indexed item below were retrieved
and read via NCBI E-utilities for this dossier; full texts (Europe PMC / PMC) were read where noted "(FT)".

1. Mifflin MD, St Jeor ST, Hill LA, Scott BJ, Daugherty SA, Koh YO. A new predictive equation for resting energy expenditure in healthy individuals. Am J Clin Nutr 1990;51:241-7. PMID 2305711. doi:10.1093/ajcn/51.2.241
2. Roza AM, Shizgal HM. The Harris Benedict equation reevaluated: resting energy requirements and the body cell mass. Am J Clin Nutr 1984;40:168-82. PMID 6741850. doi:10.1093/ajcn/40.1.168 (revised coefficients cross-checked in [12] and https://en.wikipedia.org/wiki/Harris%E2%80%93Benedict_equation)
3. Cunningham JJ. A reanalysis of the factors influencing basal metabolic rate in normal adults. Am J Clin Nutr 1980;33:2372-4. PMID 7435418. doi:10.1093/ajcn/33.11.2372
4. Cunningham JJ. Body composition as a determinant of energy expenditure: a synthetic review and a proposed general prediction equation. Am J Clin Nutr 1991;54:963-9. PMID 1957828. doi:10.1093/ajcn/54.6.963
5. Müller MJ, Bosy-Westphal A, Klaus S, et al. World Health Organization equations have shortcomings for predicting resting energy expenditure in persons from a modern, affluent population: generation of a new reference standard from a retrospective analysis of a German database of resting energy expenditure. Am J Clin Nutr 2004;80:1379-90. PMID 15531690. doi:10.1093/ajcn/80.5.1379 (equations transcribed from [12])
6. Henry CJ. Basal metabolic rate studies in humans: measurement and development of new equations. Public Health Nutr 2005;8(7A):1133-52. PMID 16277825. doi:10.1079/phn2005801 (coefficients transcribed from [112])
7. Wang Z, Ying Z, Bosy-Westphal A, et al. Specific metabolic rates of major organs and tissues across adulthood: evaluation by mechanistic model of resting energy expenditure. Am J Clin Nutr 2010;92:1369-77. PMID 20962155. doi:10.3945/ajcn.2010.29885 (reports Elia 1992 K_i values)
8. Gallagher D, Belmonte D, Deurenberg P, et al. Organ-tissue mass measurement allows modeling of REE and metabolically active tissue mass. Am J Physiol 1998;275:E249-58. PMID 9688626. doi:10.1152/ajpendo.1998.275.2.E249
9. Frankenfield D, Roth-Yousey L, Compher C. Comparison of predictive equations for resting metabolic rate in healthy nonobese and obese adults: a systematic review. J Am Diet Assoc 2005;105:775-89. PMID 15883556. doi:10.1016/j.jada.2005.02.005
10. Weijs PJ. Validity of predictive equations for resting energy expenditure in US and Dutch overweight and obese class I and II adults aged 18-65 y. Am J Clin Nutr 2008;88:959-70. PMID 18842782. doi:10.1093/ajcn/88.4.959
11. ten Haaf T, Weijs PJ. Resting energy expenditure prediction in recreational athletes of 18-35 years: confirmation of Cunningham equation and an improved weight-based alternative. PLoS One 2014;9:e108460. PMID 25275434. doi:10.1371/journal.pone.0108460
12. Frings-Meuthen P, Henkel S, Boschmann M, et al. Resting energy expenditure of master athletes: accuracy of predictive equations and primary determinants. Front Physiol 2021;12:641455. PMID 33828487. doi:10.3389/fphys.2021.641455 (FT)
13. Nelson KM, Weinsier RL, Long CL, Schutz Y. Prediction of resting energy expenditure from fat-free mass and fat mass. Am J Clin Nutr 1992;56:848-56. PMID 1415003. doi:10.1093/ajcn/56.5.848
14. Johnstone AM, Murison SD, Duncan JS, Rance KA, Speakman JR. Factors influencing variation in basal metabolic rate include fat-free mass, fat mass, age, and circulating thyroxine but not sex, circulating leptin, or triiodothyronine. Am J Clin Nutr 2005;82:941-8. PMID 16280423. doi:10.1093/ajcn/82.5.941
15. Bader N, Bosy-Westphal A, Dilba B, Müller MJ. Intra- and interindividual variability of resting energy expenditure in healthy male subjects — biological and methodological variability of resting energy expenditure. Br J Nutr 2005;94:843-9. PMID 16277790. doi:10.1079/bjn20051551
16. Welle S, Nair KS. Relationship of resting metabolic rate to body composition and protein turnover. Am J Physiol 1990;258:E990-8. PMID 2360629. doi:10.1152/ajpendo.1990.258.6.E990
17. Hall KD, Sacks G, Chandramohan D, et al. Quantification of the effect of energy imbalance on bodyweight. Lancet 2011;378:826-37 (+ supplementary web appendix; text read, equation images unavailable — parameter values taken from the text). PMID 21872751. PMCID PMC3880593. doi:10.1016/S0140-6736(11)60812-X
18. Hall KD. Computational model of in vivo human energy metabolism during semistarvation and refeeding. Am J Physiol Endocrinol Metab 2006;291:E23-37. PMID 16449298. PMCID PMC2377067. doi:10.1152/ajpendo.00523.2005 (FT)
19. Hall KD, Jordan PN. Modeling weight-loss maintenance to help prevent body weight regain. Am J Clin Nutr 2008;88:1495-503. PMID 19064508. doi:10.3945/ajcn.2008.26333
20. Hall KD. Mathematical modelling of energy expenditure during tissue deposition. Br J Nutr 2010;104:4-7. PMID 20132585. doi:10.1017/S0007114510000206
21. Hall KD. What is the required energy deficit per unit weight loss? Int J Obes 2008;32:573-6. PMID 17848938. doi:10.1038/sj.ijo.0803720
22. Westerterp KR. Diet induced thermogenesis. Nutr Metab (Lond) 2004;1:5. PMID 15507147. doi:10.1186/1743-7075-1-5 (FT)
23. Tappy L. Thermic effect of food and sympathetic nervous system activity in humans. Reprod Nutr Dev 1996;36:391-7. PMID 8878356. doi:10.1051/rnd:19960405
24. Quatela A, Callister R, Patterson A, MacDonald-Wicks L. The energy content and composition of meals consumed after an overnight fast and their effects on diet induced thermogenesis: a systematic review, meta-analyses and meta-regressions. Nutrients 2016;8:670. PMID 27792142. doi:10.3390/nu8110670 (FT)
25. Guarneiri LL, Adams CG, Garcia-Jackson B, Koecher K, Wilcox ML, Maki KC. Effects of varying protein amounts and types on diet-induced thermogenesis: a systematic review and meta-analysis. Adv Nutr 2024;15:100332. PMID 39486625. doi:10.1016/j.advnut.2024.100332 (FT)
26. Suter PM, Jéquier E, Schutz Y. Effect of ethanol on energy expenditure. Am J Physiol 1994;266:R1204-12. PMID 8184963. doi:10.1152/ajpregu.1994.266.4.R1204
27. Weststrate JA, Wunnink I, Deurenberg P, Hautvast JG. Alcohol and its acute effects on resting metabolic rate and diet-induced thermogenesis. Br J Nutr 1990;64:413-25. PMID 2121268. doi:10.1079/bjn19900042
28. de Jonge L, Bray GA. The thermic effect of food and obesity: a critical review. Obes Res 1997;5:622-31. PMID 9449148. doi:10.1002/j.1550-8528.1997.tb00584.x
29. Granata GP, Brandon LJ. The thermic effect of food and obesity: discrepant results and methodological variations. Nutr Rev 2002;60:223-33. PMID 12199298. doi:10.1301/002966402320289359
30. Barr SB, Wright JC. Postprandial energy expenditure in whole-food and processed-food meals: implications for daily energy expenditure. Food Nutr Res 2010;54. PMID 20613890. doi:10.3402/fnr.v54i0.5144
31. Karl JP, Meydani M, Barnett JB, et al. Substituting whole grains for refined grains in a 6-wk randomized trial favorably affects energy-balance metrics in healthy men and postmenopausal women. Am J Clin Nutr 2017;105:589-99. PMID 28179223. doi:10.3945/ajcn.116.139683
32. Bellisle F, McDevitt R, Prentice AM. Meal frequency and energy balance. Br J Nutr 1997;77 Suppl 1:S57-70. PMID 9155494. doi:10.1079/bjn19970104
33. Munsters MJ, Saris WH. Effects of meal frequency on metabolic profiles and substrate partitioning in lean healthy males. PLoS One 2012;7:e38632. PMID 22719910. doi:10.1371/journal.pone.0038632 (FT)
34. Ohkawara K, Cornier MA, Kohrt WM, Melanson EL. Effects of increased meal frequency on fat oxidation and perceived hunger. Obesity 2013;21:336-43. PMID 23404961. doi:10.1002/oby.20032
35. Calcagno M, Kahleova H, Alwarith J, et al. The thermic effect of food: a review. J Am Coll Nutr 2019;38:547-51. PMID 31021710. doi:10.1080/07315724.2018.1552544
36. FAO. Food energy — methods of analysis and conversion factors. FAO Food and Nutrition Paper 77, Rome 2003; ch. 3. https://www.fao.org/4/y5022e/y5022e04.htm
37. Westerterp-Plantenga MS, Rolland V, Wilson SA, Westerterp KR. Satiety related to 24 h diet-induced thermogenesis during high protein/carbohydrate vs high fat diets measured in a respiration chamber. Eur J Clin Nutr 1999;53:495-502. PMID 10403587. doi:10.1038/sj.ejcn.1600782
38. Levine JA, Eberhardt NL, Jensen MD. Role of nonexercise activity thermogenesis in resistance to fat gain in humans. Science 1999;283:212-4. PMID 9880251. doi:10.1126/science.283.5399.212 (component values from the tabulation in [80])
39. Levine JA, Lanningham-Foster LM, McCrady SK, et al. Interindividual variation in posture allocation: possible role in human obesity. Science 2005;307:584-6. PMID 15681386. doi:10.1126/science.1106561
40. Levine JA. Nonexercise activity thermogenesis (NEAT): environment and biology. Am J Physiol Endocrinol Metab 2004;286:E675-85. PMID 15102614. doi:10.1152/ajpendo.00562.2003
41. Pontzer H, Durazo-Arvizu R, Dugas LR, et al. Constrained total energy expenditure and metabolic adaptation to physical activity in adult humans. Curr Biol 2016;26:410-7. PMID 26832439. doi:10.1016/j.cub.2015.12.046 (FT)
42. Careau V, Halsey LG, Pontzer H, et al.; IAEA DLW database group. Energy compensation and adiposity in humans. Curr Biol 2021;31:4659-66. PMID 34453886. doi:10.1016/j.cub.2021.08.016 (FT)
43. Flanagan EW, Sanchez-Delgado G, Martin CK, Ravussin E, Pontzer H, Redman LM. No evidence for metabolic adaptation during exercise-related energy compensation. iScience 2024;27:109842. PMID 38947494. doi:10.1016/j.isci.2024.109842
44. Willis EA, Herrmann SD, Honas JJ, Lee J, Donnelly JE, Washburn RA. Nonexercise energy expenditure and physical activity in the Midwest Exercise Trial 2. Med Sci Sports Exerc 2014;46:2286-94. PMID 24694746. doi:10.1249/MSS.0000000000000354
45. Martin CK, Johnson WD, Myers CA, et al. Effect of different doses of supervised exercise on food intake, metabolism, and non-exercise physical activity: the E-MECHANIC randomized controlled trial. Am J Clin Nutr 2019;110:583-92. PMID 31172175. doi:10.1093/ajcn/nqz054
46. Westerterp KR. Exercise, energy balance and body composition. Eur J Clin Nutr 2018;72:1246-50. PMID 30185845. doi:10.1038/s41430-018-0180-4
47. Silva AM, Júdice PB, Carraça EV, King N, Teixeira PJ, Sardinha LB. What is the effect of diet and/or exercise interventions on behavioural compensation in non-exercise physical activity and related energy expenditure of free-living adults? A systematic review. Br J Nutr 2018;119:1327-45. PMID 29845903. doi:10.1017/S000711451800096X
48. Ohkawara K, Ishikawa-Takata K, Park JH, Tabata I, Tanaka S. How much locomotive activity is needed for an active physical activity level: analysis of total step counts. BMC Res Notes 2011;4:512. PMID 22114990. doi:10.1186/1756-0500-4-512 (FT)
49. FAO/WHO/UNU. Human energy requirements. Report of a Joint FAO/WHO/UNU Expert Consultation, Rome 2001 (Food and Nutrition Technical Report Series 1, 2004); chapter "Energy requirements of adults". https://www.fao.org/4/y5686e/y5686e07.htm
50. National Academies of Sciences, Engineering, and Medicine. Dietary Reference Intakes for Energy. Washington DC: National Academies Press; 2023. PMID 36693139 (NBK588659). doi:10.17226/26818. Chapter 5 equations: https://www.nationalacademies.org/read/26818/chapter/7
51. Bajunaid R, Niu C, Hambly C, et al. Predictive equation derived from 6,497 doubly labelled water measurements enables the detection of erroneous self-reported energy intake. Nat Food 2025;6:58-71 (erratum 2025;6:523-4). PMID 39806218. doi:10.1038/s43016-024-01089-5 (FT)
52. Pontzer H, Yamada Y, Sagayama H, et al.; IAEA DLW Database Consortium. Daily energy expenditure through the human life course. Science 2021;373:808-12. PMID 34385400. doi:10.1126/science.abe5017 (FT)
53. Leibel RL, Rosenbaum M, Hirsch J. Changes in energy expenditure resulting from altered body weight. N Engl J Med 1995;332:621-8. PMID 7632212. doi:10.1056/NEJM199503093321001
54. Rosenbaum M, Hirsch J, Gallagher DA, Leibel RL. Long-term persistence of adaptive thermogenesis in subjects who have maintained a reduced body weight. Am J Clin Nutr 2008;88:906-12. PMID 18842775. doi:10.1093/ajcn/88.4.906
55. Rosenbaum M, Leibel RL. Adaptive thermogenesis in humans. Int J Obes 2010;34 Suppl 1:S47-55. PMID 20935667. doi:10.1038/ijo.2010.184 (FT)
56. Rosenbaum M, Vandenborne K, Goldsmith R, et al. Effects of experimental weight perturbation on skeletal muscle work efficiency in human subjects. Am J Physiol Regul Integr Comp Physiol 2003;285:R183-92. PMID 12609816. doi:10.1152/ajpregu.00474.2002
57. Fothergill E, Guo J, Howard L, et al. Persistent metabolic adaptation 6 years after "The Biggest Loser" competition. Obesity 2016;24:1612-9. PMID 27136388. doi:10.1002/oby.21538
58. Johannsen DL, Knuth ND, Huizenga R, Rood JC, Ravussin E, Hall KD. Metabolic slowing with massive weight loss despite preservation of fat-free mass. J Clin Endocrinol Metab 2012;97:2489-96. PMID 22535969. doi:10.1210/jc.2012-1444
59. Knuth ND, Johannsen DL, Tamboli RA, et al. Metabolic adaptation following massive weight loss is related to the degree of energy imbalance and changes in circulating leptin. Obesity 2014;22:2563-9. PMID 25236175. doi:10.1002/oby.20900
60. Hall KD. Energy compensation and metabolic adaptation: "The Biggest Loser" study reinterpreted. Obesity 2022;30:11-3. PMID 34816627. doi:10.1002/oby.23308
61. Kerns JC, Guo J, Fothergill E, et al. Increased physical activity associated with less weight regain six years after "The Biggest Loser" competition. Obesity 2017;25:1838-43. PMID 29086499. doi:10.1002/oby.21986
62. Martins C, Roekenes J, Salamati S, Gower BA, Hunter GR. Metabolic adaptation is an illusion, only present when participants are in negative energy balance. Am J Clin Nutr 2020;112:1212-8. PMID 32844188. doi:10.1093/ajcn/nqaa220
63. Martins C, Gower BA, Hunter GR. Metabolic adaptation delays time to reach weight loss goals. Obesity 2022;30:400-6. PMID 35088553. doi:10.1002/oby.23333
64. Nymo S, Coutinho SR, Torgersen LH, et al. Timeline of changes in adaptive physiological responses, at the level of energy expenditure, with progressive weight loss. Br J Nutr 2018;120:141-9. PMID 29733003. doi:10.1017/S0007114518000922
65. Müller MJ, Enderle J, Pourhassan M, et al. Metabolic adaptation to caloric restriction and subsequent refeeding: the Minnesota Starvation Experiment revisited. Am J Clin Nutr 2015;102:807-19. PMID 26399868. doi:10.3945/ajcn.115.109173
66. Müller MJ, Heymsfield SB, Bosy-Westphal A. Are metabolic adaptations to weight changes an artefact? Am J Clin Nutr 2021;114:1386-95. PMID 34134143. doi:10.1093/ajcn/nqab184
67. Dulloo AG, Jacquet J. Adaptive reduction in basal metabolic rate in response to food deprivation in humans: a role for feedback signals from fat stores. Am J Clin Nutr 1998;68:599-606. PMID 9734736. doi:10.1093/ajcn/68.3.599
68. Dulloo AG, Jacquet J, Montani JP, Schutz Y. Adaptive thermogenesis in human body weight regulation: more of a concept than a measurable entity? Obes Rev 2012;13 Suppl 2:105-21. PMID 23107264. doi:10.1111/j.1467-789X.2012.01041.x
69. Heilbronn LK, de Jonge L, Frisard MI, et al. Effect of 6-month calorie restriction on biomarkers of longevity, metabolic adaptation, and oxidative stress in overweight individuals: a randomized controlled trial. JAMA 2006;295:1539-48. PMID 16595757. doi:10.1001/jama.295.13.1539
70. Martin CK, Heilbronn LK, de Jonge L, et al. Effect of calorie restriction on resting metabolic rate and spontaneous physical activity. Obesity 2007;15:2964-73. PMID 18198305. doi:10.1038/oby.2007.354
71. Redman LM, Heilbronn LK, Martin CK, et al. Metabolic and behavioral compensations in response to caloric restriction: implications for the maintenance of weight loss. PLoS One 2009;4:e4377. PMID 19198647. doi:10.1371/journal.pone.0004377
72. Redman LM, Smith SR, Burton JH, Martin CK, Il'yasova D, Ravussin E. Metabolic slowing and reduced oxidative damage with sustained caloric restriction support the rate of living and oxidative damage theories of aging. Cell Metab 2018;27:805-15. PMID 29576535. doi:10.1016/j.cmet.2018.02.019
73. Weyer C, Walford RL, Harper IT, et al. Energy metabolism after 2 y of energy restriction: the Biosphere 2 experiment. Am J Clin Nutr 2000;72:946-53. PMID 11010936. doi:10.1093/ajcn/72.4.946
74. Heinitz S, Hollstein T, Ando T, et al. Early adaptive thermogenesis is a determinant of weight loss after six weeks of caloric restriction in overweight subjects. Metabolism 2020;110:154303. PMID 32599082. doi:10.1016/j.metabol.2020.154303
75. Byrne NM, Sainsbury A, King NA, Hills AP, Wood RE. Intermittent energy restriction improves weight loss efficiency in obese men: the MATADOR study. Int J Obes 2018;42:129-38. PMID 28925405. doi:10.1038/ijo.2017.206
76. Peos JJ, Helms ER, Fournier PA, et al. Continuous versus intermittent dieting for fat loss and fat-free mass retention in resistance-trained adults: the ICECAP trial. Med Sci Sports Exerc 2021;53:1685-98. PMID 33587549. doi:10.1249/MSS.0000000000002636
77. Siedler MR, Lewis MH, Trexler ET, et al. The effects of intermittent diet breaks during 25% energy restriction on body composition and resting metabolic rate in resistance-trained females: a randomized controlled trial. J Hum Kinet 2023;86:117-32. PMID 37181269. doi:10.5114/jhk/159960
78. Campbell BI, Aguilar D, Colenso-Semple LM, et al. Intermittent energy restriction attenuates the loss of fat free mass in resistance trained individuals. A randomized controlled trial. J Funct Morphol Kinesiol 2020;5:19. PMID 33467235. doi:10.3390/jfmk5010019
79. Wing RR, Jeffery RW. Prescribed "breaks" as a means to disrupt weight control efforts. Obes Res 2003;11:287-91. PMID 12582226. doi:10.1038/oby.2003.43
80. Joosen AM, Westerterp KR. Energy expenditure during overfeeding. Nutr Metab (Lond) 2006;3:25. PMID 16836744. doi:10.1186/1743-7075-3-25 (FT)
81. Ravussin E, Schutz Y, Acheson KJ, Dusmet M, Bourquin L, Jéquier E. Short-term, mixed-diet overfeeding in man: no evidence for "luxuskonsumption". Am J Physiol 1985;249:E470-7. PMID 4061637. doi:10.1152/ajpendo.1985.249.5.E470
82. Diaz EO, Prentice AM, Goldberg GR, Murgatroyd PR, Coward WA. Metabolic response to experimental overfeeding in lean and overweight healthy volunteers. Am J Clin Nutr 1992;56:641-55. PMID 1414963. doi:10.1093/ajcn/56.4.641
83. Bouchard C, Tremblay A, Després JP, et al. The response to long-term overfeeding in identical twins. N Engl J Med 1990;322:1477-82. PMID 2336074. doi:10.1056/NEJM199005243222101
84. Hall KD, Chen KY, Guo J, et al. Energy expenditure and body composition changes after an isocaloric ketogenic diet in overweight and obese men. Am J Clin Nutr 2016;104:324-33. PMID 27385608. doi:10.3945/ajcn.116.133561
85. Hall KD, Guo J, Chen KY, et al. Methodologic considerations for measuring energy expenditure differences between diets varying in carbohydrate using the doubly labeled water method. Am J Clin Nutr 2019;109:1328-34. PMID 31028699. doi:10.1093/ajcn/nqy390
86. Ebbeling CB, Feldman HA, Klein GL, et al. Effects of a low carbohydrate diet on energy expenditure during weight loss maintenance: randomized trial. BMJ 2018;363:k4583. PMID 30429127. doi:10.1136/bmj.k4583
87. Hall KD, Guo J, Speakman JR. Do low-carbohydrate diets increase energy expenditure? Int J Obes 2019;43:2350-4. PMID 31548574. doi:10.1038/s41366-019-0456-3 (FT)
88. Hall KD, Guo J. Obesity energetics: body weight regulation and the effects of diet composition. Gastroenterology 2017;152:1718-27. PMID 28193517. doi:10.1053/j.gastro.2017.01.052
89. Ludwig DS, Dickinson SL, Henschel B, Ebbeling CB, Allison DB. Do lower-carbohydrate diets increase total energy expenditure? An updated and reanalyzed meta-analysis of 29 controlled-feeding studies. J Nutr 2021;151:482-90. PMID 33274750. doi:10.1093/jn/nxaa350
90. Hall KD, Bemis T, Brychta R, et al. Calorie for calorie, dietary fat restriction results in more body fat loss than carbohydrate restriction in people with obesity. Cell Metab 2015;22:427-36. PMID 26278052. doi:10.1016/j.cmet.2015.07.021
91. Ebbeling CB, Swain JF, Feldman HA, et al. Effects of dietary composition on energy expenditure during weight-loss maintenance. JAMA 2012;307:2627-34. PMID 22735432. doi:10.1001/jama.2012.6607
92. Bray GA, Smith SR, de Jonge L, et al. Effect of dietary protein content on weight gain, energy expenditure, and body composition during overeating: a randomized controlled trial. JAMA 2012;307:47-55. PMID 22215165. doi:10.1001/jama.2011.1918 (FT)
93. Bray GA, Redman LM, de Jonge L, et al. Effect of protein overfeeding on energy expenditure measured in a metabolic chamber. Am J Clin Nutr 2015;101:496-505. PMID 25733634. doi:10.3945/ajcn.114.091769
94. Mikkelsen PB, Toubro S, Astrup A. Effect of fat-reduced diets on 24-h energy expenditure: comparisons between animal protein, vegetable protein, and carbohydrate. Am J Clin Nutr 2000;72:1135-41. PMID 11063440. doi:10.1093/ajcn/72.5.1135
95. Lejeune MP, Westerterp KR, Adam TC, Luscombe-Marsh ND, Westerterp-Plantenga MS. Ghrelin and glucagon-like peptide 1 concentrations, 24-h satiety, and energy and substrate metabolism during a high-protein diet and measured in a respiration chamber. Am J Clin Nutr 2006;83:89-94. PMID 16400055. doi:10.1093/ajcn/83.1.89
96. Whitehead JM, McNeill G, Smith JS. The effect of protein intake on 24-h energy expenditure during energy restriction. Int J Obes Relat Metab Disord 1996;20:727-32. PMID 8856395.
97. Drummen M, Tischmann L, Gatta-Cherifi B, et al. High compared with moderate protein intake reduces adaptive thermogenesis and induces a negative energy balance during long-term weight-loss maintenance in participants with prediabetes in the postobese state: a PREVIEW study. J Nutr 2020;150:458-63. PMID 31754687. doi:10.1093/jn/nxz281
98. Horton TJ, Drougas H, Brachey A, Reed GW, Peters JC, Hill JO. Fat and carbohydrate overfeeding in humans: different effects on energy storage. Am J Clin Nutr 1995;62:19-29. PMID 7598063. doi:10.1093/ajcn/62.1.19
99. Acheson KJ, Schutz Y, Bessard T, Anantharaman K, Flatt JP, Jéquier E. Glycogen storage capacity and de novo lipogenesis during massive carbohydrate overfeeding in man. Am J Clin Nutr 1988;48:240-7. PMID 3165600. doi:10.1093/ajcn/48.2.240
100. Pullar JD, Webster AJ. The energy cost of fat and protein deposition in the rat. Br J Nutr 1977;37:355-63. PMID 861188. doi:10.1079/bjn19770039
101. Benton MJ, Hutchins AM, Dawes JJ. Effect of menstrual cycle on resting metabolism: a systematic review and meta-analysis. PLoS One 2020;15:e0236025. PMID 32658929. doi:10.1371/journal.pone.0236025
102. Webb P. 24-hour energy expenditure and the menstrual cycle. Am J Clin Nutr 1986;44:614-9. PMID 3766447. doi:10.1093/ajcn/44.5.614
103. Bisdee JT, James WP, Shaw MA. Changes in energy expenditure during the menstrual cycle. Br J Nutr 1989;61:187-99. PMID 2706224. doi:10.1079/bjn19890108
104. Ferraro R, Lillioja S, Fontvieille AM, Rising R, Bogardus C, Ravussin E. Lower sedentary metabolic rate in women compared with men. J Clin Invest 1992;90:780-4. PMID 1522233. doi:10.1172/JCI115951
105. Dulloo AG, Geissler CA, Horton T, Collins A, Miller DS. Normal caffeine consumption: influence on thermogenesis and daily energy expenditure in lean and postobese human volunteers. Am J Clin Nutr 1989;49:44-50. PMID 2912010. doi:10.1093/ajcn/49.1.44
106. Astrup A, Toubro S, Cannon S, Hein P, Breum L, Madsen J. Caffeine: a double-blind, placebo-controlled study of its thermogenic, metabolic, and cardiovascular effects in healthy volunteers. Am J Clin Nutr 1990;51:759-67. PMID 2333832. doi:10.1093/ajcn/51.5.759
107. Landsberg L, Young JB, Leonard WR, Linsenmeier RA, Turek FW. Do the obese have lower body temperatures? A new look at a forgotten variable in energy balance. Trans Am Clin Climatol Assoc 2009;120:287-95. PMID 19768183. PMCID PMC2744512 (FT)
108. Wijers SL, Saris WH, van Marken Lichtenbelt WD. Cold-induced adaptive thermogenesis in lean and obese. Obesity 2010;18:1092-9. PMID 20360754. doi:10.1038/oby.2010.74
109. Tudor-Locke C, Craig CL, Thyfault JP, Spence JC. A step-defined sedentary lifestyle index: <5000 steps/day. Appl Physiol Nutr Metab 2013;38:100-14. PMID 23438219. doi:10.1139/apnm-2012-0235
110. Javed F, He Q, Davidson LE, et al. Brain and high metabolic rate organ mass: contributions to resting energy expenditure beyond fat-free mass. Am J Clin Nutr 2010;91:907-12. PMID 20164308. doi:10.3945/ajcn.2009.28512
111. Gallagher D, Albu J, He Q, et al. Small organs with a high metabolic rate explain lower resting energy expenditure in African American than in white adults. Am J Clin Nutr 2006;83:1062-7. PMID 16685047. doi:10.1093/ajcn/83.5.1062
112. MacroFactor. "What are the best BMR equations?" https://macrofactor.com/best-bmr-equations/ (secondary source; used only to transcribe the Oxford/Henry 2005 coefficients — verify against the primary Table before release: UNVERIFIED transcription)
