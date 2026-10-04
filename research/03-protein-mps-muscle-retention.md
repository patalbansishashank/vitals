# 03 — Dietary protein → muscle protein synthesis/breakdown → lean-mass change

> Dossier for the Vitals mechanistic engine. Evidence grades: A = meta-analysis / validated model /
> multiple controlled human trials; B = few human RCTs or consistent human mechanistic data; C = limited or
> indirect human data (incl. our own PROPOSED FITs); D = animal / in-vitro / expert opinion.
> `PROPOSED FIT` = equation built by this dossier from the listed data points (not published as such).
> `UNVERIFIED` = number we could not confirm from a primary source during this review.
> Citations are numbered [n] and resolved in §11 (PMID / DOI / URL).

---

## 1. Scope

This dossier covers the *nutrition side* of skeletal-muscle and lean-tissue dynamics: how daily and per-meal
protein (amount, quality, timing, distribution, eating window), energy status (deficit / maintenance / surplus),
fasting and ketones change muscle protein synthesis (MPS) and breakdown (MPB), and how these integrate into
lean-mass change. It delivers (a) an hourly "net muscle protein balance" sub-model driven by meals, energy status
and training state, (b) daily-resolution fallback formulas including `leanFractionOfLoss(...)`, and (c) validation
targets. The resistance-training (RT) dose-response itself (sets, load, hypertrophy potential `G_RT` by training
status) is owned by dossier 09; whole-body energy partition models (Forbes/Hall) by 01; overfeeding partition by
11; ketosis by 05; glycogen/water by 04; PSMF/transition details by 13.

---

## 2. State variables

| Name | Unit | Typical range | What it represents | Initial-value rule |
|---|---|---|---|---|
| `FFM` | kg | 35–90 | Fat-free mass (all non-fat tissue incl. water, bone, glycogen) | From dossier 14 (body-composition estimate); else BW × (1 − BF) |
| `SM` | kg | 15–45 | Skeletal-muscle tissue mass | From 14; fallback: men 0.384 × BW, women 0.306 × BW (MRI means, [110]) |
| `L_tis` | kg | = FFM − glycogen-bound water − ECW excess | Protein-containing lean tissue (what this dossier moves); glycogen & its water are owned by 04 | L_tis0 = FFM0 (deviations tracked as ΔL_tis) |
| `P_musc` | kg protein | 3–9 | Protein mass in skeletal muscle | 0.206 × SM (metabolically active tissue contains ≈33 g N/kg ⇒ 206 g protein/kg [80]) |
| `G_i` | g | 0–150 | Undigested protein remaining in gut from meal *i* (hourly layer) | 0 |
| `A_lag` | g·h⁻¹ | 0–15 | Lagged, quality-weighted systemic amino-acid appearance (protein-equivalent) | 0 |
| `R` | 0–1 | 0–0.8 | "Muscle-full" refractory state of MPS | 0 |
| `X_RT` | 0–~1 | 0–1 | Resistance-exercise-induced sensitisation of MPS (decays over 12–48 h) | 0 |
| `Ins` | mU·L⁻¹ | 3–80 | Plasma insulin (received from dossier 04; a proxy is given in §4.7) | fasting value from 04 |
| `t_fast` | h | 0–240 | Hours since last protein-containing meal | 0 at start of simulation if fed |
| `Pox_fast` | g protein·kg FFM⁻¹·d⁻¹ | 0.5–1.0 | Obligatory protein oxidation during zero-protein fasting (adapts over days) | 0.9 at fast onset (§4.13) |
| `AR` | 0–1 multiplier | 0.4–1 | Anabolic-resistance multiplier on fed MPS (age/inactivity/obesity) | computed from age, BMI, steps (§4.14) |
| `NB` | g N·d⁻¹ | −15…+5 | Nitrogen balance (output/diagnostic) | 0 |
| `AI_day` | %·(24 h)⁻¹ | 0–0.6 | Anabolic index = integral of feeding-stimulated MPS above basal (hourly layer) | computed daily |
| `E_dist` | 0.8–1.05 | 1 | Distribution/timing efficiency derived from AI_day vs a reference pattern | 1 |

Notes: the engine should expose ΔSM and ΔL_tis separately from ΔFFM (ΔFFM also contains glycogen water from 04
and fluid shifts from 13/15). DXA "lean mass" in the validation studies includes glycogen and water, so short
(<3–4 wk) studies overstate tissue loss (see §7).

---

## 3. Inputs that drive it

| Input | Unit | How it enters |
|---|---|---|
| Protein per meal `P_i` and clock time `t_i` | g, h | Gut digestion → AA appearance → MPS stimulus (hourly); daily total `P_day` (daily layer) |
| Protein source per meal (quality) | DIAAS (adult pattern), leucine % of protein, digestion-speed class | Quality multiplier `Q_i` on AA signal and on daily effective protein (§4.10) |
| Daily protein relative to body | g·kg BM⁻¹·d⁻¹ **and** g·kg FFM⁻¹·d⁻¹ | Engine uses `q = P_eff / FFM`; UI shows both (§4.1) |
| Energy balance | kcal·d⁻¹ and deficit fraction `d` = (TEE − EI)/TEE | Lean/fat partition (`p_cat`), MPS suppression `f_E` (from 01/02) |
| Resistance-training sessions | time, stimulus 0–1, training status | `X_RT(t)` (hourly), `RT` (0–1, weekly) and `G_RT` (kg·wk⁻¹ potential) from 09 |
| Steps / inactivity / bed rest / immobilisation | steps·d⁻¹, flags | Anabolic resistance, disuse catabolism (§4.14) |
| Carbohydrate & insulin | g, mU·L⁻¹ | Insulin suppresses MPB (max ≈50% at ≥30 mU/L) (from 04) |
| Blood β-hydroxybutyrate | mM | Protein sparing in fasting (reduces MPB/N loss) (from 05) |
| Eating window, hours fasted | h | `t_fast`; extra catabolism for fasts > ~16 h; fasting N-loss model |
| Age, sex, BF%, BMI | y, –, %, kg·m⁻² | Per-meal breakpoint, anabolic resistance, Forbes partition, leanness |
| Supplements: free EAA/BCAA/leucine, collagen | g | Treated via quality vector (§4.11) |

---

## 4. Mechanisms & equations

### 4.1 Units: per kg body mass vs per kg fat-free mass

Mechanism: amino-acid demand scales with metabolically active lean tissue, not adipose tissue. Studies report
g·kg BM⁻¹ (Morton [1], Nunes [2], most RCTs) or g·kg FFM⁻¹ (Helms [6]); per-meal breakpoints were reported both
ways (Moore [28]). In obesity per-kg-BM targets become very large and unnecessary.

Conversion (exact algebra):

```
q_FFM  = q_BM / (1 − BF)                   # g/kg FFM/d  from g/kg BM/d
q_BM   = q_FFM × (1 − BF)
```

Reference conversions used to translate literature cut-points into the engine's FFM basis (assumed BF of the
study populations; young non-obese RT samples ≈ 15–20 % BF — assumption, UNVERIFIED per study):

| Literature value | Basis | Engine value (g·kg FFM⁻¹) | Source |
|---|---|---|---|
| RDA 0.83 g·kg⁻¹·d⁻¹ (EAR 0.65) | BM, N-balance | ≈1.0 (EAR ≈0.8) | Rand 2003 [105] |
| IAAO EAR 0.93 / RDA 1.2 g·kg⁻¹·d⁻¹ (young men) | BM | ≈1.1 / 1.4 | Humayun 2007 [106] |
| Plateau of RT-induced FFM gain 1.62 (95 % CI 1.03–2.20) g·kg⁻¹·d⁻¹ | BM | ≈1.95 (CI 1.25–2.65) | Morton 2018 [1] |
| Deficit + lean + RT: 2.3–3.1 g·kg FFM⁻¹·d⁻¹ | FFM | 2.3–3.1 | Helms 2014 [6] |
| Per-meal plateau young 0.24 ± 0.06 g·kg BM⁻¹ (0.25 ± 0.13 g·kg LBM⁻¹) | BM/LBM | ≈0.28 | Moore 2015 [28] |
| Per-meal plateau older 0.40 ± 0.19 g·kg BM⁻¹ (0.60 ± 0.29 g·kg LBM⁻¹) | BM/LBM | ≈0.50–0.60 | Moore 2015 [28] |

Recommendation for the engine: all internal protein dose-responses are written in g·kg FFM⁻¹ (per day) or
g·kg FFM⁻¹ (per meal). For users without an FFM estimate, 14 must supply one; fall back to BF from BMI equations.
Evidence grade: B (physiological rationale; the two bases are interchangeable in non-obese samples, which is where
the dose-response data come from).

### 4.2 Daily protein dose-response for RT-induced lean-mass gain (energy balance or surplus)

Mechanism: RT creates the anabolic "demand"; dietary protein is permissive/supportive. Extra protein adds a
modest increment on top of RT, saturating around 1.6 g·kg BM⁻¹·d⁻¹.

Evidence (all energy-balanced/surplus studies):

- Morton 2018 [1] (49 RCTs, n = 1863, RT ≥ 6 wk): protein supplementation increased FFM by **+0.30 kg (95 % CI
  0.09–0.52)**, 1RM +2.49 kg (0.64–4.33), fibre CSA +310 µm² (51–570). Effect smaller with age (−0.01 kg per
  year, 95 % CI −0.02 to −0.00) and larger in resistance-trained (+0.75 kg, 0.09–1.40). Segmental regression of
  ΔFFM on total intake (42 arms, 723 people, intakes 0.9–2.4 g·kg⁻¹·d⁻¹): **breakpoint 1.62 (1.03–2.20)
  g·kg⁻¹·d⁻¹**, slope below breakpoint 1.75 (kg ΔFFM per g·kg⁻¹·d⁻¹), R² = 0.19, p = 0.079 (not significant). Mean
  supplement 36 ± 30 g·d⁻¹; protein-group intake rose 1.4 → 1.8 g·kg⁻¹·d⁻¹. Authors: "~2.2 g protein/kg/d" to be
  safe given the CI. Studies were at/above energy requirement (weight-loss studies excluded).
- Nunes 2022 [2] (74 RCTs, three-level MA): more protein during RT increased LBM, **SMD 0.22 (0.14–0.30)**, 62
  studies (moderate certainty). Significant in ≥65 y at 1.2–1.59 g·kg⁻¹·d⁻¹ and in <65 y at ≥1.6 g·kg⁻¹·d⁻¹;
  lower-body strength SMD 0.40 at ≥1.6 g·kg⁻¹·d⁻¹ (low certainty).
- Tagawa 2021 [3] (105 articles, 5402 participants, any RCT on protein and LBM, with and without RT): spline
  model: each +0.1 g·kg⁻¹·d⁻¹ was associated with **+0.39 kg LBM (0.36–0.41) below 1.3 g·kg⁻¹·d⁻¹ and +0.12 kg
  (0.11–0.14) above 1.3**, across 0.5–3.5 g·kg⁻¹·d⁻¹. (These per-0.1 g slopes are much larger than implied by
  Morton; they pool heterogeneous durations/populations — we do not calibrate magnitudes to Tagawa, only the
  shape: a knee near 1.3 with continuing but shallower benefit above.)
- Schoenfeld, Aragon & Krieger 2013 [4] (protein-timing MA, 23 studies, 525 subjects): after adjustment, total
  protein intake was the strongest predictor of hypertrophy ES: **≈ +0.2 ES per +0.5 g·kg⁻¹·d⁻¹** (estimate
  0.39 ± 0.15 per unit).
- Hudson 2020 [15] (18 RCTs ≥ 6 wk): >RDA vs RDA increased lean mass during RT by +0.77 kg (0.23–1.31, n = 3
  comparisons) but not in non-stressed states (+0.08 kg, −0.59 to 0.75).
- IAAO whole-body anabolism on a training day in trained men: breakpoint **2.00 (1.62–2.38) g·kg⁻¹·d⁻¹**
  (Mazzulla 2020 [108]); bodybuilders non-training day EAR 1.7, RDA 2.2 g·kg⁻¹·d⁻¹ (Bandegan 2017 [107]).

Equation — protein efficacy on RT-driven accretion (PROPOSED FIT, grade B for shape, C for exact parameters):

```
f_Pgain(q) = clamp( 1 − exp( −(q − q0) / λ ), 0, 1 )        # q = effective protein, g/kg FFM/d
q0 = 0.49 g/kg FFM/d   (= 0.40 g/kg BM at 18 % BF)
λ  = 0.61 g/kg FFM/d   (= 0.50 g/kg BM)
```

Resulting curve (BM basis, 18 % BF): f(0.6) = 0.33, f(0.8) = 0.55, f(1.0) = 0.70, f(1.2) = 0.80, f(1.4) = 0.86,
f(1.62) = 0.91, f(2.0) = 0.96, f(2.2) = 0.97, f(3.0) = 0.99.

Data points used: (i) Morton plateau at 1.62 (CI upper 2.2) → f ≥ 0.9 at 1.6 and ≈1 at 2.2; (ii) typical RCT
control arms at 1.2–1.4 g·kg⁻¹ gain ~75–85 % of the supplemented arms' FFM gain (+0.30 kg on RT-alone gains of
~1–2 kg; Morton); (iii) IAAO requirement ≈0.93 g·kg⁻¹ (below which gains are strongly limited); (iv) at ≤0.4
g·kg⁻¹ accretion ≈ 0 (below N-balance EAR 0.65).

Moderators (multiply `G_RT × f_Pgain`):
- Age: Morton's −0.01 kg per year in the supplementation effect; anabolic resistance (§4.14) —
  `AR_age = 1 − 0.25 × clamp((age − 30)/40, 0, 1)` (PROPOSED, grade C).
- Training status: trained individuals benefit more from extra protein (+0.75 kg) [1] — treat by using the
  upper end of the λ range (λ = 0.75 g·kg FFM⁻¹) for "trained", i.e., saturation shifted right (grade C).
- Sex: no apparent sex difference in [1] (fewer data in women) — no sex term (grade C).
- Energy status: see §4.4–4.5 (`f_E`).

Time dynamics: this is a rate multiplier applied daily; the "effective q" used should be a 7-day rolling mean of
quality-weighted protein (RT adaptation integrates over days; PROPOSED).

Evidence grade: **A** (existence and plateau ~1.6 g·kg BM⁻¹), **C** (exact exponential parameters).

### 4.3 Protein requirement, nitrogen balance and protein-limited accretion

Mechanism: below a requirement, whole-body protein balance is negative irrespective of energy; above it, extra
protein is oxidised unless an anabolic stimulus (RT, growth, surplus) or catabolic stress (deficit) exists.

Key numbers:
- N-balance meta-analysis (19 studies, 235 subjects): EAR **105 mg N·kg⁻¹·d⁻¹ = 0.65 g protein·kg⁻¹·d⁻¹**, RDA
  **132 mg N = 0.83 g·kg⁻¹·d⁻¹**; individual requirements log-normal (Rand 2003 [105]).
- IAAO (young men): EAR **0.93**, RDA **1.2 g·kg⁻¹·d⁻¹** (Humayun 2007 [106]).
- Older people: ≥1.0–1.2 g·kg⁻¹·d⁻¹; ≥1.2 if active/ill; 1.2–1.5 with chronic disease (PROT-AGE, Bauer 2013
  [109], expert consensus).
- Overfeeding (metabolic ward, 8 wk, +954 kcal·d⁻¹ ≈ +40 %, no RT; Bray 2012 [92]): protein 5 % / 15 % / 25 % of
  energy (≈47 / 140 / 228 g·d⁻¹ ≈ 0.7 / 1.8 / 3.0 g·kg⁻¹·d⁻¹) → lean body mass **−0.70 kg (−1.50 to 0.10) /
  +2.87 kg (2.11–3.62) / +3.18 kg (2.37–3.98)**; fat gain equal in all (+3.51 kg, 3.06–3.96); REE +160 and +227
  kcal·d⁻¹ in normal/high protein, no change with low protein. ⇒ protein, not energy, limits lean accretion in a
  surplus; energy (not protein) determines fat gain.

Equations (PROPOSED FIT, grade B/C):

```
P_eff      = Σ_meals  P_i × Q_i                         # g/d, quality-weighted (§4.10)
P_need     = 1.1 g/kg FFM/d × FFM                       # ≈ IAAO EAR 0.93 g/kg BM at ~15 % BF [106]
η          = 0.30                                       # fraction of protein above/below need retained/lost
c_P        = 0.206 kg protein per kg lean tissue        # 33 g N/kg [80]
ΔL_cap     = η × (P_eff − P_need) / (1000 × c_P)        # kg lean tissue/d, protein-limited ceiling
```

- In **surplus**: `ΔL_tis = min( ΔL_partition_surplus , ΔL_cap ) + A_RT` (partition from 01/11).
- At **maintenance**: `ΔL_tis = min(0, ΔL_cap) + A_RT` (i.e., only a shortfall causes loss).
- In **deficit**: use §4.4 (`p_cat`), which already contains the protein effect.

Derivation of η = 0.30: on a 500-kcal VLED (Hoffer 1984 [84]) raising protein from 0.8 to 1.5 g·kg IBW⁻¹
(≈ +42 g·d⁻¹) moved N balance from −2 g N·d⁻¹ to 0 ⇒ 2 g N (12.5 g protein) retained per 42 g extra ≈ 0.30.
Check against Bray low-protein arm: FFM ≈53 kg → P_need ≈58 g; intake 47 g → ΔL_cap = 0.3 × (−11)/206 = −16 g
lean·d⁻¹ → **−0.9 kg in 8 wk (observed −0.70, CI −1.50 to 0.10)**.

Evidence grade: A (requirement values), B (Bray/Hoffer anchors), C (single-η linear form).

### 4.4 Lean-mass retention in an energy deficit — `leanFractionOfLoss`

Mechanism: when energy intake < expenditure, the body oxidises fat and protein. The share of weight lost as lean
tissue falls with more initial body fat (Forbes), rises with larger deficits and in the first days (glycogen/water,
labile protein), and is reduced by higher protein intake and by RT (which can even produce net lean gain =
"recomposition"). A high-protein intake needs to be scaled to leanness and deficit (Helms [6]).

#### 4.4.1 Evidence table (data points)

| Study | Population | Deficit / duration | Protein | RT | Result (weight / lean / fat) |
|---|---|---|---|---|---|
| Mettler 2010 [9] | 20 young RT-trained athletes | 60 % of habitual EI (≈40 % deficit), 2 wk | ≈1.0 vs ≈2.3 g·kg⁻¹ (15 vs 35 % E) | usual RT | BW −3.0 ± 0.4 vs −1.5 ± 0.3 kg; **LBM −1.6 ± 0.3 vs −0.3 ± 0.3 kg** (fractions 0.53 vs 0.20; DXA) |
| Pasiakos 2013 [8] | 39 adults | 10 d maintenance → 21 d, 40 % deficit (30 % diet + 10 % exercise) | 0.8 / 1.6 / 2.4 g·kg⁻¹ | no RT | BW −3.2 ± 0.2 kg in all; proportion lost as FFM lower and fat loss higher with 1.6 and 2.4 than 0.8; 2.4 ≈ 1.6. Exact kg values UNVERIFIED (full text not accessible) |
| Longland 2016 [7] | 40 young men | ≈40 % deficit, 33 ± 1 kcal·kg LBM⁻¹, 4 wk, all food provided | 1.2 vs 2.4 g·kg⁻¹ | RT + HIIT 6 d·wk⁻¹ | **LBM +0.1 ± 1.0 vs +1.2 ± 1.0 kg; FM −3.5 ± 1.4 vs −4.8 ± 1.6 kg** (4-compartment model) |
| Helms 2014 [6] | SR of 6 studies (13 groups), RT-trained lean (men ≤23 % BF, women ≤35 %) | varied | varied | yes | FFM −0.3 to −2.7 kg in 9/13 groups; groups without loss were fatter, in smaller deficits, or had novel training; the one lean, large-deficit group without loss ate 2.5–2.6 g·kg⁻¹ ⇒ **2.3–3.1 g·kg FFM⁻¹**, scaled up with deficit and leanness |
| Hector & Phillips 2018 [10] | review, athletes | — | — | — | recommends **1.6–2.4 g·kg⁻¹·d⁻¹** during weight loss; upper end with larger deficit / harder training |
| Garthe 2011 [21] | 24 elite athletes | EI −19 % (0.7 % BW·wk⁻¹, 8.5 wk) vs −30 % (1.4 %·wk⁻¹ planned, 5.3 wk) | not stated in abstract | 4 RT·wk⁻¹ | BW −5.6 vs −5.5 %; **LBM +2.1 ± 0.4 % vs −0.2 ± 0.7 %**; FM −31 vs −21 % |
| Murphy CH 2015 [11] | 20 OW/obese older men (66 y, BMI 31) | 2 wk ER then 2 wk ER + RT; 1.3 g·kg⁻¹ | balanced (25 %×4) vs skewed | 2nd half | Fed MyoPS lower in ER in both; RT restored it only with balanced distribution. Body comp (pooled, from full text via web extraction; moderate confidence): ER phase BW −2.5 kg, lean −1.1 kg; ER + RT phase BW −1.4 kg, lean −0.2 kg |
| Krieger 2006 [12] | meta-regression, 87 studies, 165 groups, ≥4 wk | ≥1000 kcal·d⁻¹ diets | >1.05 vs ≤1.05 g·kg⁻¹ | mixed | **+0.60 kg FFM retained** with >1.05 g·kg⁻¹ (+1.21 kg in studies >12 wk); no effect on total or fat mass loss |
| Wycherley 2012 [13] | MA, 24 RCTs, n = 1063, 12.1 ± 9.3 wk | isocaloric ER | high vs standard protein (low fat) | mixed | BW −0.79 kg (−1.50, −0.08), FM −0.87 (−1.26, −0.48), **FFM +0.43 kg (0.09, 0.78) retained**, REE +595.5 kJ·d⁻¹ (67–1124) |
| Kim JE 2016 [14] | MA, 20 RCTs, adults > 50 y, no RT | ER | ≥25 % E or ≥1.0 g·kg⁻¹ (mean 1.31) vs lower (0.79) | no | **Lean +0.45 kg (0.20–0.71)** (%E definition) or **+0.83 kg (0.47–1.19)** (g·kg⁻¹ definition); FM −0.57 kg (−0.98, −0.15) |
| Hudson 2020 [15] | MA, 18 RCTs ≥ 6 wk | ER subgroup | >RDA vs RDA | ± | ER: **+0.36 kg (0.06–0.67)** lean, n = 14 comparisons |
| Chaston 2007 [17] | SR, 26 diet cohorts losing >10 kg | varied | — | ± | %FFM of loss correlates with degree of caloric restriction (r² = 0.31); men 27 ± 7 % vs women 20 ± 7 %; in three −1000 kcal·d⁻¹ RCTs, ΔFFM/ΔW **0.27 ± 0.06 (sedentary) vs 0.13 ± 0.04 (aerobic) vs 0.17 ± 0.14 (RT)** (as summarised in [18]) |
| Weinheimer 2010 [16] | SR, 52 studies, middle-aged/older OW | ER vs ER + EX | — | mainly aerobic | **81 % of ER groups vs 39 % of ER + EX groups lost ≥15 % of BW as FFM** |
| Murphy C & Koehler 2022 [20] | MA/meta-regression, RT ≥ 3 wk in deficit | — | — | yes | LM gain impaired in deficit vs control (ES −0.57, p = 0.02), strength not (ES −0.31, ns); **a deficit of ~500 kcal·d⁻¹ prevented LM gains** |
| Vink 2016 [22] | 57 adults BMI 28–35 | VLCD 500 kcal (5 wk) vs LCD 1250 kcal (12 wk), same total loss (−9.0 vs −8.2 kg) | — | no | %FFM loss 8.8 % vs 1.3 % (BodPod; authors' %FFML metric — exact definition UNVERIFIED) |
| Carbone 2019 [23] | review | — | — | — | protein > RDA protective at deficits ≤ ~40 %; a plateau "may exist" above ~40 %; 2.0 vs 1.0 g·kg⁻¹ did not protect FFM at a ~70 % deficit at altitude (Berryman) |
| Forbes & Drenick 1979 [76] | analysis of fasting N data | total fasting | 0 | no | N loss biexponential; **N loss per kg weight lost ≈20 g N·kg⁻¹ (non-obese) vs ≈10 g N·kg⁻¹ with ≥50 kg fat** ⇒ lean-tissue fraction ≈0.61 vs ≈0.30 (at 33 g N·kg⁻¹ lean tissue [80]) |
| Laurens 2021 [80] | 16 men, 44 y, BMI 26 | 10-d fast, 200–250 kcal·d⁻¹, ≤3 h light activity | ≈0 | no | BW −5.9 kg; **FM −2.34 kg (40 %), lean soft tissue −3.53 kg (60 %) = ECW −1.6 kg (44 %), glycogen + water −0.50 kg (14 %), metabolically active tissue −1.5 kg (25 % of weight loss)**; N excretion fell 41 % by day 5 then plateaued |
| Heymsfield 2014 [18] (Grande 1961) | men, diet restriction | — | — | — | fat : water : protein of weight loss **25 : 70 : 5 at day 3 (FFM 75 %) vs 85 : 0 : 15 at days 21–24 (FFM 15 %)**; early-phase half-life < 1 wk, late phase 100 d (lean) to 300 d (obese) |
| Heymsfield 2014 [18] (Rangers) | 50 normal-weight men (15 % fat) | extreme deficit + exercise, 8 wk, −10 kg | — | — | **ΔFFM/ΔW 0.40**; ΔFFM/ΔW correlated with baseline %fat (n = 105, R² = 0.42), leaner lose more lean |
| Templeman 2021 [49] | 36 lean healthy adults | 3 wk: 75 % EI daily vs alternate-day 0 %/150 % | habitual composition | no | 75:75 BW −1.91 ± 0.99, **FM −1.75 ± 0.79 (non-fat ≈ −0.16)**; 0:150 BW −1.60 ± 1.06, **FM −0.74 ± 1.32 (non-fat ≈ −0.86)** |
| Lowe 2020 (TREAT) [48] | 116 OW/obese, 16:8 TRE vs 3 meals, 12 wk | ad lib | not measured | no | In-person TRE arm: BW −1.70 kg, **lean −1.10 kg (≈65 % of loss)**, FM −0.51 kg; appendicular lean −0.64 kg; ALMI between-group −0.16 kg·m⁻² (−0.27, −0.05) |
| Schroor 2024 [50] | MA, 28 RCTs IER (TRE/ADF/5:2) vs CER | 2–52 wk | — | — | BW −0.42 (ns), FM −0.31 (ns), **FFM −0.20 kg (−0.39, −0.01) more with IER** |

#### 4.4.2 The function (PROPOSED FIT, grade C; built on grade-A/B components)

Structure: a *catabolic partition* (Forbes-type share of the energy deficit covered by lean tissue, modulated by
protein, deficit size, RT, age) **minus** an *anabolic RT credit* (RT-driven accretion, reduced by energy
deficit, increased by protein). This lets the fraction become negative (recomposition), as in Longland/Garthe.

```ts
// All masses kg, protein g/d, deficit d = (TEE − EI)/TEE in [0, 1]; RT in [0, 1] (weekly stimulus from 09)
function leanFractionOfLoss(
  proteinGPerKgBM: number, deficitPct: number, bodyfatPct: number,
  RT: number, sex: 'M'|'F', age: number,
  BW: number, TEE: number, G_RT_kgPerWk: number,   // G_RT from dossier 09 (training status)
  Q = 1.0,                                         // protein quality multiplier (§4.10)
  activity = 0                                     // 0..1 habitual aerobic/steps index (from 10)
): { leanFrac: number; dLean_kgPerWk: number; dBW_kgPerWk: number } {
  const bf = bodyfatPct / 100, d = deficitPct / 100;
  const FM = BW * bf, FFM = BW - FM;
  const q = proteinGPerKgBM * BW * Q / FFM;                 // g/kg FFM/d
  // leanness index L: 1 at ≤10 % BF (men) / ≤20 % (women); 0 at ≥30 % / ≥40 %
  const bfMaleEq = sex === 'M' ? bf : bf - 0.10;
  const L = clamp((0.30 - bfMaleEq) / 0.20, 0, 1);
  // 1) Forbes baseline partition (dossier 01 owns the exact form)
  const p0 = 10.4 / (10.4 + FM);
  // 2) Protein modifier
  const qSat = 1.2 + Math.min(d, 0.45) * (2.0 + 3.0 * L);    // g/kg FFM giving maximal protection (Helms 2.3–3.1)
  const xP = clamp((q - 0.8) / Math.max(qSat - 0.8, 0.3), 0, 1);
  const Mmin = (0.60 - 0.25 * RT) * (1 - 0.5 * clamp((d - 0.25) / 0.5, 0, 1));
  const dCrit = 0.45 + 0.35 * (1 - L);                        // protein efficacy fades above this deficit
  const effD = clamp(1 - (d - dCrit) / 0.30, 0, 1);
  const M_P = 1 - (1 - Mmin) * effD * xP;
  // 3) Deficit-size modifier (1.0 at 25 % deficit)
  const M_D = clamp(1 + 0.65 * (d - 0.25), 0.85, 1.5);
  // 4) Exercise modifiers
  const M_RT = 1 - 0.30 * RT;
  const M_act = 1 - 0.30 * activity;                          // Chaston: aerobic 0.13 vs sedentary 0.27
  // 5) Age modifier
  const M_age = clamp(1 + 0.01 * Math.max(0, age - 40), 1, 1.4);
  const pCat = clamp(p0 * M_P * M_D * M_RT * M_act * M_age, 0, 0.9);
  // Energy partition of the deficit (ρL, ρF: kcal/kg; coordinate with 01)
  const rhoL = 1000, rhoF = 9400;
  const Edef = d * TEE;                                       // kcal/d
  const wlCat = Edef / (pCat * rhoL + (1 - pCat) * rhoF) * 7; // kg/wk
  const leanCat = pCat * wlCat;
  // 6) Anabolic RT credit (kg/wk), reduced by deficit, increased by protein
  const fP = clamp(1 - Math.exp(-(q - 0.49) / 0.61), 0, 1);
  const fE = d > 0 ? clamp(1 - d / (0.30 + 0.40 * xP), 0, 1) : 1;
  const AR = 1 - 0.25 * clamp((age - 30) / 40, 0, 1);
  const credit = G_RT_kgPerWk * RT * fP * fE * AR;           // × E_dist (§4.8) if meal data exist
  const fatLoss = (1 - pCat) * wlCat + credit * rhoL / rhoF;  // energy for accretion comes from fat
  const dLean = -(leanCat - credit);
  const dBW = dLean - fatLoss;
  return { leanFrac: dLean / dBW, dLean_kgPerWk: dLean, dBW_kgPerWk: dBW }; // >0 = lean lost; <0 = recomposition
}
```

Parameter table:

| Symbol | Value | Unit | Uncertainty | Source / derivation |
|---|---|---|---|---|
| p0 | 10.4/(10.4 + FM) | – | ±0.10 absolute between studies | Forbes curve dFFM/dW = 10.4/(10.4 + FM) [18]; Hall 2007/2008 [19,115] |
| q_sat | 1.2 + min(d,0.45)(2.0 + 3.0 L) | g·kg FFM⁻¹·d⁻¹ | ±0.4 | Helms 2.3–3.1 g·kg FFM⁻¹ for lean, large deficit [6]; Hector 1.6–2.4 g·kg⁻¹ [10]; obese: ≈1.7–2.1 |
| lower protein knee | 0.8 | g·kg FFM⁻¹·d⁻¹ | ±0.2 | ≈ N-balance EAR [105] |
| M_min | (0.60 − 0.25 RT)·(1 − 0.5·clamp((d−0.25)/0.5)) | – | ±0.15 | calibrated: obese HP vs NP retention 0.4–0.8 kg [12–14]; Mettler ratio 0.20/0.53 [9]; Hoffer VLED [84] |
| d_crit | 0.45 + 0.35(1 − L) | fraction | ±0.1 | Carbone plateau >40 % in lean young men [23]; protein still spares N at ~78 % deficit in obese (Hoffer) [84] |
| M_D slope | 0.65 per unit deficit | – | ±0.3 | Chaston r² 0.31 [17]; fasting anchors Forbes–Drenick [76]; Vink [22]; Garthe [21] |
| M_RT | 1 − 0.30 RT | – | 0.2–0.5 | Chaston RT 0.17 vs 0.27 [17]; Weinheimer 39 % vs 81 % [16] |
| M_act | 1 − 0.30 activity | – | ±0.2 | Chaston aerobic 0.13 vs 0.27 [17] |
| M_age | 1 + 0.01·(age − 40), ≤1.4 | – | ±0.01/y | Morton age coefficient [1]; Weinheimer [16]; Heymsfield ageing [18] — PROPOSED |
| f_E | 1 − d/(0.30 + 0.40 x_P) | – | ±0.2 | Murphy & Koehler ~500 kcal·d⁻¹ zero-gain point [20]; Longland [7]; Garthe [21]; Areta (RT rescues MPS) [25] |
| ρL | 1000 (4.2 MJ·kg⁻¹) | kcal·kg⁻¹ lean tissue | 1000–1816 | Bray 2012 used 1000 kcal·kg⁻¹ [92]; Heymsfield 1020 kcal·kg⁻¹ [18]; Hall uses 7.6 MJ·kg⁻¹ (1816 kcal) assuming 1.6 g water per g protein [19] — dossier 01 decides |
| ρF | 9400 | kcal·kg⁻¹ | 9300–9500 | Hall 39.5 MJ·kg⁻¹ [19]; Bray 9300 [92] |

Model output vs published data (computed with the code above; tissue lean only — DXA values in short studies
also include glycogen water, hence observed > model for 2–3 wk studies):

| Study arm | q (g·kg FFM⁻¹) | p_cat | Model net lean fraction | Model lean Δ / BW Δ (kg) | Observed |
|---|---|---|---|---|---|
| Mettler CP (80 kg, 15 % BF, 40 % deficit, 2 wk) | 1.18 | 0.341 | +0.34 | −0.94 / −2.7 | LBM −1.6 of −3.0 (0.53, DXA) |
| Mettler HP | 2.71 | 0.155 | +0.13 | −0.27 / −2.1 | LBM −0.3 of −1.5 (0.20) |
| Pasiakos RDA (78 kg, 20 % BF, 40 %, 3 wk) | 1.00 | 0.415 | +0.42 | −1.77 / −4.3 | highest FFM share (exact UNVERIFIED) |
| Pasiakos 2× RDA | 2.00 | 0.296 | +0.30 | −1.08 / −3.6 | lower than RDA |
| Pasiakos 3× RDA | 3.00 | 0.224 | +0.22 | −0.75 / −3.4 | ≈ 2× RDA |
| Longland CON (100 kg, 25 % BF, 40 %, G_RT = 0.35 kg·wk⁻¹, 4 wk) | 1.60 | 0.141 | +0.09 | −0.41 / −4.5 | LBM +0.1, FM −3.5 |
| Longland PRO | 3.20 | 0.067 | −0.08 | +0.30 / −3.9 | LBM +1.2, FM −4.8 |
| Garthe slow (73 kg, 14 % BF, 19 %, 8.5 wk, G_RT 0.20) | 2.09 | 0.119 | −0.18 | +0.62 / −3.4 | LBM +2.1 % (≈ +1.3 kg) |
| Garthe fast (30 %, 5.3 wk) | 2.09 | 0.182 | +0.08 | −0.35 / −4.2 | LBM −0.2 % (≈ −0.1 kg) |
| Obese woman, normal protein 0.65 g·kg⁻¹, 30 % deficit, 12 wk | 1.12 | 0.193 | +0.19 | −1.44 / −7.5 | women ΔFFM/ΔW 0.20 ± 0.07 [17] |
| Obese woman, high protein 1.25 g·kg⁻¹ | 2.16 | 0.128 | +0.13 | −0.89 / −7.0 | HP retains +0.43…0.83 kg [13,14] (model +0.55) |
| Obese man, sedentary, −1000 kcal·d⁻¹, 16 wk | 1.23 | 0.195 | +0.19 | −2.86 / −14.6 | 0.27 ± 0.06 [17] |
| Obese man, + RT, same | 1.23 | 0.122 | +0.11 | −1.51 / −13.4 | 0.17 ± 0.14 [17] |
| Obese woman VLED 500 kcal, 1.5 g·kg IBW⁻¹ (5 wk) | 1.96 | 0.103 | +0.10 | −0.76 / −7.4 | N balance ≈ 0 by wk 3 [84] |
| Same, 0.8 g·kg IBW⁻¹ | 1.05 | 0.238 | +0.24 | −2.02 / −8.5 | N balance −2 g·d⁻¹ (≈ −2 kg lean more over 5 wk than HP) |
| Total fast, non-obese (FM 13 kg) | 0 | 0.673 | +0.67 | — | ≈0.61 [76] |
| Total fast, obese (FM 52 kg) | 0 | 0.248 | +0.25 | — | ≈0.30 [76] |

Inputs not reported in the abstracts were assumed for these runs (BW, BF %, TEE, and G_RT shown in the row labels; Garthe protein assumed 1.8 g·kg⁻¹; Longland BW 100 kg / 25 % BF; Pasiakos 78 kg / 20 % BF; Mettler 80 kg / 15 % BF) — the comparison is therefore semi-quantitative.

Illustrative grid (80 kg man, 20 % BF, 30 y, TEE 2600 kcal, G_RT = 0.10 kg·wk⁻¹, activity 0):

| Protein g·kg BM⁻¹ (g·kg FFM⁻¹) | Deficit | RT | Lean fraction of loss | BW kg·wk⁻¹ | Lean kg·wk⁻¹ |
|---|---|---|---|---|---|
| 0.8 (1.00) | 10 % | 0 / 1 | +0.32 / +0.03 | −0.27 / −0.20 | −0.086 / −0.006 |
| 0.8 (1.00) | 25 % | 0 / 1 | +0.37 / +0.23 | −0.72 / −0.61 | −0.267 / −0.136 |
| 0.8 (1.00) | 40 % | 0 / 1 | +0.41 / +0.28 | −1.22 / −1.03 | −0.499 / −0.288 |
| 1.2 (1.50) | 10 % | 0 / 1 | +0.22 / −0.32 | −0.24 / −0.15 | −0.054 / +0.048 |
| 1.2 (1.50) | 25 % | 0 / 1 | +0.31 / +0.11 | −0.67 / −0.54 | −0.205 / −0.060 |
| 1.2 (1.50) | 40 % | 0 / 1 | +0.35 / +0.21 | −1.13 / −0.96 | −0.394 / −0.202 |
| 1.6 (2.00) | 10 % | 0 / 1 | +0.21 / −0.43 | −0.24 / −0.14 | −0.051 / +0.060 |
| 1.6 (2.00) | 25 % | 0 / 1 | +0.25 / 0.00 | −0.62 / −0.48 | −0.152 / 0.000 |
| 1.6 (2.00) | 40 % | 0 / 1 | +0.29 / +0.13 | −1.05 / −0.88 | −0.305 / −0.119 |
| 2.2 (2.75) | 25 % | 0 / 1 | +0.24 / −0.02 | −0.61 / −0.47 | −0.145 / +0.012 |
| 2.2 (2.75) | 40 % | 0 / 1 | +0.22 / +0.04 | −0.96 / −0.80 | −0.213 / −0.034 |
| 2.8 (3.50) | 40 % | 0 / 1 | +0.22 / +0.04 | −0.96 / −0.80 | −0.213 / −0.033 |

Obese woman (100 kg, 45 % BF, 50 y, TEE 2300, G_RT 0.05): at 0.6 g·kg⁻¹ BM and 25/50/75 % deficit, no RT →
+0.18/+0.21/+0.23; at 1.2 g·kg⁻¹ BM (2.18 g·kg FFM⁻¹) → +0.12/+0.11/+0.08; with RT at 1.2 → −0.01/+0.03/+0.03.

Time dynamics:
- The function returns the *tissue* partition for the slow phase. Superimpose the early phase: Grande's day-3
  composition (FFM 75 % of loss, mostly water) and Heymsfield's early half-life < 1 wk [18] are generated by
  dossier 04 (glycogen: ~3 g water per g) and 13 (sodium/water), not here.
- In fasting (d ≈ 1) add the labile-protein early phase (§4.13).
- Apply the RT credit with a 1–2 wk onset lag for novices (early MyoPS is directed to damage repair, not growth;
  Damas 2016 [73]) — implement as `credit × (1 − exp(−t_RT/10 d))` (PROPOSED, grade C).

Moderators summary: body fat (strong, A), deficit size (B), protein (A for direction; B/C for magnitude), RT (A),
aerobic activity (B), age (C), sex (mostly via FM; C). Inter-individual SD of ΔFFM/ΔW ≈ 0.07 in obese cohorts
[17]; larger (≈0.1–0.15) in lean subjects measured by DXA (hydration artefacts) — carry as ±1 SD band.

Evidence grade: **B** for components (Forbes, protein and RT effects), **C** for the combined parameterisation.
Known misses: Templeman 75:75 (model ≈0.4 lean share vs observed ≈0.08 in lean adults over 3 wk) — the lean-adult
baseline partition is the least certain element; Longland PRO under-predicted (+0.3 vs +1.2 kg).

### 4.5 Suppression of MPS by energy deficit and its rescue by protein + RT

Mechanism: energy deficit lowers postabsorptive and postprandial MPS (reduced Akt/mTORC1 signalling); MPB is
largely unchanged, so reduced MPS is the main driver of early lean loss. RT and higher/better protein restore MPS.

| Study | Condition | Result |
|---|---|---|
| Pasiakos 2010 [24] | 12 active adults, 10 d at ~80 % of energy needs, 1.5 g·kg⁻¹ | mixed-muscle FSR **0.074 → 0.060 %·h⁻¹ (−19 %)** |
| Areta 2014 [25] | 15 young men/women, 5 d at 30 vs 45 kcal·kg FFM⁻¹ (≈ −33 %) | postabsorptive MyoPS **−27 %**; RE restored MPS to rested energy-balance values; RE + 15 g / 30 g whey → **+16 % / +34 % above rested energy balance** |
| Hector 2015 [26] | 40 OW/obese adults 35–65 y, 14 d at −750 kcal·d⁻¹ | postprandial MPS fell **−9 ± 1 % with whey (1.3 g·kg⁻¹·d⁻¹)** vs −28 ± 5 % soy and −31 ± 5 % carbohydrate control (0.7 g·kg⁻¹·d⁻¹) |
| Hector 2018 [27] | 24 young OW men, 10 d at −40 %, unilateral RE | postabsorptive MPS 2.4 g·kg⁻¹: 0.059 → 0.051; 1.2 g·kg⁻¹: 0.061 → 0.045 %·h⁻¹; exercised leg 0.067 / 0.061; **MPB unchanged (≈0.080 %·h⁻¹)** |
| Murphy CH 2015 [11] | older OW men, 1.3 g·kg⁻¹, balanced vs skewed | fed MyoPS lower in ER in both; ER + RT restored MyoPS to energy-balance level only with balanced (4 × 25 %) distribution |
| Pasiakos 2013 [8] | 40 % deficit | anabolic response to a protein-rich meal preserved at 1.6 and 2.4 g·kg⁻¹ but reduced at 0.8 g·kg⁻¹ |

Equation (PROPOSED FIT, grade B/C):

```
f_E,MPS(d, x_P) = max(0.5, 1 − 0.9 · d · (1 − 0.5 · x_P))     # multiplies basal and fed MPS (hourly layer)
RT rescue: the X_RT terms of §4.7 add back MPS; Areta [25] shows one RE bout returns MPS to energy-balance level
```

(`x_P` = protein adequacy 0–1 from §4.4.) Model vs anchors:

| Anchor | d | x_P (est.) | Model change | Observed |
|---|---|---|---|---|
| Pasiakos 2010, 1.5 g·kg⁻¹ | 0.20 | ≈0.85 | −10 % | −19 % |
| Areta 2014 (diet protein not in abstract; assume x_P 0.8) | 0.33 | 0.8 | −18 % | −27 % |
| Hector 2018, 1.2 g·kg⁻¹ | 0.40 | ≈0.56 | −26 % | −26 % |
| Hector 2018, 2.4 g·kg⁻¹ | 0.40 | 1.0 | −18 % | −14 % |
| Hector 2015, whey 1.3 g·kg⁻¹ (postprandial) | ≈0.30 | 1.0 | −14 % | −9 % |
| Hector 2015, carbohydrate control 0.7 g·kg⁻¹ | ≈0.30 | ≈0.4 | −22 % | −31 % |

Mean absolute error ≈ 7 percentage points. MPB: no deficit term (Hector 2018 [27]).
Time course: evident by day 5–10 of deficit; assume first-order onset τ = 2 d and offset τ = 2 d after return to
energy balance (UNVERIFIED time-constants; no human data found on offset).

Evidence grade: **B** (several tracer RCTs, consistent direction; magnitudes vary 9–31 %).

### 4.6 Per-meal MPS dose-response, leucine, "muscle-full", duration, and the 100-g question

Key data:

- **Breakpoints (Moore 2015 [28])**, retrospective pooled tracer studies, isolated high-quality protein: MyoPS
  plateaus at **0.24 ± 0.06 g·kg BM⁻¹ (young, ~22 y)** vs **0.40 ± 0.19 g·kg BM⁻¹ (older, ~71 y)** (p = 0.055);
  per LBM **0.25 ± 0.13 vs 0.60 ± 0.29 g·kg LBM⁻¹** (p < 0.01); basal MPS did not differ; first-segment slope lower
  in older men.
- **Witard 2014 [29]** (48 RT-trained men ~80 kg, after unilateral leg RE): MyoPS 0 g whey 0.041 ± 0.015 %·h⁻¹;
  **+49 % (20 g), +56 % (40 g)**; 10 g no significant effect; 40 g increased phenylalanine oxidation and urea
  production.
- **Macnaughton 2016 [30]** (whole-body RE, trained men): MyoPS 20 g 0.048–0.051 vs 40 g 0.059 %·h⁻¹ (≈ +20 %);
  LBM (≤65 vs ≥70 kg) did not modify the response.
- **Trommelen 2023 [31]** (36 young men, whole-body RE, intrinsically labelled milk protein 0, 25, 100 g, 12 h):
  MyoPS 100 > 25 > 0 over 12 h; **≈ +20 % (0–4 h) and ≈ +40 % (4–12 h)** for 100 vs 25 g. Exogenous AA appearing
  in plasma: 25 g → 51/62/66 % of ingested at 4/8/12 h (16 ± 1 g); 100 g → 26/44/53 % (53 ± 7 g), not
  plateaued at 12 h. Ingested protein incorporated into muscle: 25 g → 12/15/18 % at 4/8/12 h; 100 g → 13 g
  (13 %), rising linearly. Into plasma proteins: 2 g vs 4 g. AA oxidation < 15 % of the incremental intake;
  whole-body protein breakdown barely changed; net balance rose with dose. Muscle anabolic signalling returned
  to baseline within < 4 h while MPS stayed elevated (dissociation). Exogenous AA contributed 9 % (25 g) vs 27 %
  (100 g) of amino acids incorporated into muscle protein.
- **Kim IY 2016 [37]** (whole-body, mixed meal): 70 g vs 40 g protein → greater net balance, mostly via greater
  suppression of whole-body protein breakdown.
- **Holwerda 2019 [36]** (48 older men, 66 y, after RE; 0/15/30/45 g milk protein): whole-body net balance
  0.015/0.108/0.162/0.215 µmol Phe·kg⁻¹·min⁻¹ (linear); MyoPS 0.0746 (0 g), 0.0951 (30 g), 0.0970 (45 g) %·h⁻¹.
- **Muscle-full / latency (Bohé 2001 [33])**: square-wave AA infusion (~1.7× plasma AA): no rise in the first
  0.5 h, peak ≈ **2.8× basal at 2 h**, then return to basal despite continued hyperaminoacidaemia (basal mixed
  MPS 0.076 %·h⁻¹). **Atherton 2010 [32]**: 48 g whey → MyoPS 0.03 → 0.10 %·h⁻¹ at 45–90 min, back to baseline
  thereafter although plasma EAA still +130 % (120 min) and +80 % (180 min); mTORC1 signalling stayed elevated
  (discordance).
- **Leucine**: 25 g whey (3.0 g leucine) vs 6.25 g whey + leucine: with 5.0 g total leucine the low-protein drink
  ≈ 25 g whey at 1.5–4.5 h (≈ +220 % vs +267 %); with 3.0 g total leucine less effective (Churchward-Venne 2014
  [35]). With 6.25 g whey + leucine or + EAA, early MPS matched 25 g whey but only whey sustained it at 3–5 h
  post-exercise (184 % vs 55 % and 35 %) (Churchward-Venne 2012 [34]). 20–25 g whey supplies ≈2.2–2.7 g leucine
  (Pinckaers 2021 [58]).

Interpretation for the model (grade B): (1) per-meal MPS rises roughly linearly to ≈0.24 g·kg BM⁻¹ (young) /
0.40 g·kg⁻¹ (older) of high-quality protein, then flattens but does not hard-cap; (2) larger meals mainly extend
the *duration* of the anabolic response (Trommelen), especially for slowly digested proteins; (3) oxidation of
large doses is minor (< 15 % of the increment); (4) whole-body net balance keeps rising with dose (breakdown
suppression), so "protein above 20–30 g is wasted" is false as a general statement; (5) the leucine signal is
necessary but not sufficient — total EAA supply sustains the response.

Implications for meal counts (derived from the hourly model below; chronic evidence in §4.8): 1 meal vs 2 vs 3 vs
4+ differ acutely in the 24-h MPS integral by ≤ ~35 % at 1.6–2.2 g·kg⁻¹·d⁻¹, but chronic lean-mass differences are
small or undetectable when total protein is adequate.

### 4.7 Hourly "net muscle protein balance" sub-model (deliverable a)

Purpose: produce plausible within-day curves of MPS, MPB and net balance driven by meals (protein g, quality,
digestion speed), energy status and RT state, and derive two indices used by the daily layer: the anabolic index
`AI_day` and the distribution efficiency `E_dist`. **Chronic mass change is taken from the daily layer (§4.19);
the hourly layer is re-normalised each simulated day so that its 24-h integrated net balance equals the daily
layer's ΔP_musc.** Reason: acute tracer MPS differences are not quantitatively predictive of chronic
hypertrophy (MyoPS correlates with hypertrophy only after the first ~3 wk of training, Damas 2016 [73]), and an
un-normalised hourly model would convert every extra gram of protein into muscle.

Time step: 0.05–0.25 h internally (Euler is adequate), output hourly.

**A. Digestion and absorption (PROPOSED FIT to Trommelen 2023 [31], grade B/C)**

For each meal i (protein `P_i` g, quality `Q_i`, speed factor `s_i`):

```
dG_i/dt   = − V_i,           V_i = Vmax · s_i · G_i / (Km + G_i),     G_i(t_i) = P_i
Ra_i      = F_sys · V_i                                  # g/h protein-equivalent AA reaching the circulation
Ra_q      = Σ_i Q_i · Ra_i                               # quality-weighted
dA_lag/dt = (Ra_q − A_lag) / τ_lag                       # 0.5-h latency (Bohé [33])
```

| Parameter | Value | Unit | Notes / fit |
|---|---|---|---|
| Vmax | 11 | g·h⁻¹ | least-squares fit: 25 g milk protein → predicted 48/63/66 % of ingested protein appearing at 4/8/12 h (observed 51/62/66 %); 100 g → 23/44/58 % (observed 26/44/53 %). (The MPS grid fit below used 12 g·h⁻¹ / 25 g / 0.70 — practically identical.) |
| Km | 20 | g | same fit |
| F_sys | 0.66 | – | fraction escaping splanchnic first-pass retention (observed plateau 66 % at 12 h for 25 g) |
| s (speed) | whey 1.6; milk/most mixed meals 1.0; casein, fibre/fat-rich whole-food meals 0.8; free EAA 2.0 | – | whey/casein relative rates are assumptions (UNVERIFIED magnitudes) |
| τ_lag | 0.5 | h | latency of MPS response [33] |

Absorption range check: 100 g ⇒ ≈4–7 g·h⁻¹ systemic for >12 h, within the 1.3–10 g·h⁻¹ intestinal absorption
range cited by Bilsborough & Mann [102].

**B. MPS**

```
x(t)    = A_lag / FFM                                          # g·kg FFM⁻¹·h⁻¹
K_age   = K · (1 + 0.67 · clamp((age − 30)/40, 0, 1))          # 0.24 → 0.40 g/kg shift (Moore [28])
S(t)    = x^n / (K_age^n + x^n)                                # feeding stimulus 0..1
dR/dt   = k_R · S^m · (1 − R) − R / τ_R                        # muscle-full refractoriness
X_RT(t) = Σ_bouts I_b · [exp(−Δt/τ_X) − exp(−Δt/τ_on)] / 0.95  # exercise sensitisation, Δt = t − t_bout ≥ 0
MPS(t)  = s0 · f_E,MPS · AR_basal · (1 + a_X · X_RT)
        + s0 · f_E,MPS · AR_fed · A · S · (1 − R) · (1 + b_X · X_RT)          # %·h⁻¹
```

**C. MPB** (breakdown is less dynamic than synthesis and is mainly modulated by insulin, amino acids and
exercise [114]; muscle is the body's principal amino-acid reservoir in fasting [116])

```
supp_ins(t) = 0.5 · clamp((Ins − 5)/25, 0, 1)                   # halved at ≥30 mU/L, no further (Greenhaff [112])
MPB(t) = b0 · (1 − supp_ins − 0.10·S) · (1 + c_X · X_RT,b) · F_fast(t_fast) · (1 − 0.25·min(BHB,3)/3)
F_fast = 1 + 0.5 · clamp((t_fast − 16)/44, 0, 1)                # prolonged postabsorptive state (Pozefsky/Vendelbo)
NET(t) = MPS(t) − MPB(t)                                        # %·h⁻¹ of P_musc
dP_musc/dt = P_musc · NET / 100    (then renormalised to the daily layer, see above)
```

Insulin proxy when dossier 04 is absent: `dIns/dt = (5 + 6·Ra_total + k_CHO·Ra_CHO − Ins)/0.5 h`
(k_CHO from 04; PROPOSED).

Parameters (hourly layer):

| Symbol | Value | Unit | Source / fit | Grade |
|---|---|---|---|---|
| s0 (basal MPS) | 0.045 | %·h⁻¹ | basal FSR 0.036–0.045 (Phillips 1999 [68]); 0.041 (Witard [29]) | B |
| b0 (basal MPB) | ≈0.080 (solve at init) | %·h⁻¹ | chosen so the reference day (1.0 g·kg⁻¹ BM, 3 even meals at 08/13/19 h, energy balance, no RT) has net 0; solution 0.080 matches measured FBR 0.076 (Phillips 1999) and 0.080 (Hector 2018 [27]) | B |
| K | 0.07 | g·kg FFM⁻¹·h⁻¹ | grid fit (see below) | C |
| n | 4 | – | grid fit | C |
| A | 2.0 | – (× basal) | peak fed MPS ≈3× basal (Atherton 0.03 → 0.10; Bohé 2.8×) | B |
| k_R, m, τ_R | 2.0 h⁻¹, 4, 4.5 h | – | grid fit to muscle-full data | C |
| a_X | 1.1 | – | fasted MPS +112 % at 3 h after RE (Phillips 1997 [67]) | B |
| b_X | 1.5 | – | fed MyoPS increment 0.016 → ≈0.04 %·h⁻¹ 24 h after RE to failure (Burd 2011 [72]) | B |
| τ_on | 1 | h | rapid onset | C |
| τ_X | 36 h untrained; 12 h trained | h | +65 % at 24 h, +34 % at 48 h (untrained, [67]); MacDougall +109 % at 24 h, ~+14 % (ns) at 36 h [69]; trained leg back to rest by 28 h (Tang 2008 [70]) | B |
| c_X, τ_X,b | 0.3, 24 h untrained; 0 trained | – | FBR +31 % at 3 h, +18 % at 24 h, baseline 48 h (untrained [67]); no FBR rise in trained [68] | B |
| I_b | 0–1 | – | bout stimulus from 09; 3 sets > 1 set (fed MPS 3.1× vs 2.3× at 5 h; 2.3× vs baseline at 29 h, Burd 2010 [71]) | B |
| AR_fed, AR_basal | see §4.14 | – | anabolic resistance | B/C |

Grid-fit targets and model result (young, whey 1.6 speed unless noted):

| Target (source) | Observed | Model |
|---|---|---|
| 10 g whey / 0 g, 0–4 h post-RE (Witard) | ≈1.1 (ns) | 1.09 |
| 20 g / 0 g | 1.49 | 1.54 |
| 40 g / 0 g | 1.56 | 1.63 |
| 100 g / 25 g milk, 0–4 h (Trommelen) | ≈1.20 | 1.23 |
| 100 g / 25 g milk, 4–12 h | ≈1.40 | 1.41 |
| 48 g whey at rest, MPS at 3–4 h vs basal (Atherton) | ≈1 (returned to baseline) | 1.28 |
| Areta: 4×20 g / 8×10 g (12 h) | 1.31 | 0.93 (miss) |
| Areta: 4×20 g / 2×40 g | 1.48 | 1.18 |
| Mamerow EVEN / SKEW 24-h MPS | 1.25 | ≈1.08 |

The model reproduces dose-response, the prolonged response to large slow meals and part of the bolus
refractoriness, but not the "pulse" penalty of Areta (frequent 10 g doses) nor the full Mamerow effect. This is
acceptable because chronic outcome studies show much smaller distribution effects (§4.8).

Qualitative outputs of the (un-normalised) hourly model: a 24-h total fast gives NET ≈ −0.85 %·d⁻¹ of P_musc
(≈ −50 g muscle protein·d⁻¹ for 6 kg P_musc; ≈ −0.53 %·d⁻¹ with BHB 2 mM). The reference day balances by
construction.

Anabolic index and distribution efficiency (hourly layer):

```
AI_day      = ∫_0^24 s0 · f_E,MPS · AR_fed · A · S · (1 − R) · (1 + b_X·X_RT) dt      # %·d⁻¹
AI_ref      = AI_day for the same P_day split into 3 equal meals 5–6 h apart (same RT times)
E_dist,hourly = clamp( (AI_day / AI_ref)^γ , 0.85, 1.05 ),   γ = 0.3   # shrink acute → chronic (PROPOSED)
```

Evidence grade for the whole hourly layer: **C** (structure grounded in B-grade tracer physiology; parameters are
our fits).

### 4.8 Protein distribution, meal frequency and compressed eating windows

Evidence:

| Study | Design | Result |
|---|---|---|
| Areta 2013 [38] | 24 trained men, 80 g whey over 12 h after RE: 8×10 g /1.5 h, 4×20 g /3 h, 2×40 g /6 h | all ↑ MyoPS 88–148 % vs rest; mean FSR 0.060 / **0.079** / 0.053 %·h⁻¹ (INT 31–48 % higher) |
| Mamerow 2014 [39] | 8 adults, 7-d crossover, 90 g·d⁻¹: EVEN 31.5/29.9/32.7 g vs SKEW 10.7/16.0/63.4 g | 24-h mixed FSR **0.075 vs 0.056 %·h⁻¹ (+25 %)**, persisted on day 7 (0.077 vs 0.056) |
| Kim IY 2015 [40] | 20 adults 52–75 y, 0.8 vs 1.5 g·kg⁻¹, uneven 15/20/65 % vs even 33/33/33 % | net balance 94.8 vs 58.9 g protein/750 min (dose effect); **no distribution effect** on whole-body or muscle FSR |
| Kim IY 2018 [41] | 14 older adults, 8 wk, 1.1 g·kg⁻¹, even vs uneven | **no difference** in LBM, strength, function, 20-h protein kinetics or MPS |
| Yasuda 2020 [42] | 26 young men, 12 wk RT, 1.30 g·kg⁻¹·d⁻¹; breakfast 0.33 vs 0.12 g·kg⁻¹ | LTM **+2.5 ± 0.3 vs +1.8 ± 0.3 kg** (p = 0.06, d = 0.80) favouring the more even pattern |
| Murphy CH 2015 [11] | older OW men, ER ± RT | balanced > skewed for fed MyoPS during ER; only balanced restored with RT |
| Hudson 2020 review [43] | observational + RCT | evidence "limited and inconsistent"; at 0.8–1.3 g·kg⁻¹ having ≥1 meal reaching the per-meal threshold matters more than evenness |
| Moro 2016 [44] | 34 RT-trained men, 8 wk, 16/8 TRF (meals 13:00, 16:00, 20:00), ≈1.9 g·kg⁻¹, iso-energetic | FFM **+0.64 vs +0.48 kg** (ns), FM −1.62 vs −0.30 kg, strength maintained |
| Tinsley 2019 [46] | 40 RT-trained women, 8 wk, TRF 12:00–20:00 (~7.5 h) vs ~13 h, 1.6 g·kg⁻¹ | FFM +2–3 % in all groups, no difference |
| Tinsley 2017 [45] | young men, 8 wk RT, 20:4 on 4 d·wk⁻¹ (≈ −650 kcal on TRF days) | no significant body-composition difference; effect size suggested lean gain in control (+2.3 kg, d = 0.25) not in TRF |
| Stote 2007 [47] | 1 meal/d (17:00–21:00) vs 3 meals, iso-energetic, 8-wk crossover, 14.5 % protein | BW −1.4 kg; FM 14.2 vs 16.3 kg; FFM 50.9 vs 49.4 kg (BIA, ns) |
| Lowe 2020 [48] | 16:8 TRE ad lib, 12 wk, protein not measured | lean −1.10 kg (≈65 % of −1.70 kg) in the in-person TRE subgroup |
| Templeman 2021 [49] | ADF 0 %/150 % vs 75 % daily, 3 wk, lean adults | non-fat mass loss ≈0.86 vs ≈0.16 kg |
| Schroor 2024 [50] | MA 28 RCTs IER vs CER | FFM **−0.20 kg (−0.39, −0.01)** more with IER; TRE reduced FFM more than CER |

Conclusion (grade B): **total daily protein dominates distribution.** With total ≥1.6 g·kg BM⁻¹ and ≥2 meals each
≥ the per-meal breakpoint, chronic distribution penalties are ≤ ~5 % of RT-driven accretion (not detectable in
8–12-wk RCTs). Penalties become plausible when (i) total protein is marginal (0.8–1.3 g·kg⁻¹) and no meal reaches
the breakpoint, (ii) fasting periods are long (ADF/extended fasts: IER −0.2 kg FFM vs CER; ADF lean loss larger),
(iii) in older adults (higher breakpoint).

Default distribution penalty for the daily layer (PROPOSED FIT, grade C):

```
n_eff  = number of meals with Q-weighted protein ≥ max(0.28 g/kg FFM × (1 + 0.8·clamp((age−30)/40,0,1)) × FFM, 15 g)
         spaced ≥ 3 h from the previous qualifying meal; cap at 3
W      = eating-window length (h, first to last protein-containing meal + 1 h)
E_dist = 1 − 0.06 · (3 − n_eff) − 0.05 · clamp((8 − W)/4, 0, 1)        # range 0.83–1.0
         (optionally replace by E_dist,hourly from §4.7)
```

E_dist multiplies the RT credit (anabolic term) only; it does not change the catabolic partition. Uncertainty:
0 to 2× the default penalty. Reference values from the hourly layer (E_dist,hourly; γ = 0.3):

| Pattern | 80 g·d⁻¹ (1.0 g·kg⁻¹, 80 kg) | 128 g (1.6) | 176 g (2.2) |
|---|---|---|---|
| 1 meal (OMAD) | 0.94 | 0.88 | 0.86 |
| 2 meals 6 h apart | 1.00 | 0.94 | 0.95 |
| 2 meals in a 4-h window | 0.94 | 0.88 | 0.89 |
| 3 even, 5–6 h apart (reference) | 1.00 | 1.00 | 1.00 |
| 3 skewed 12/18/70 % | 0.92 | 0.95 | 1.02 |
| 3 meals in a 6-h window | 0.96 | 0.88 | 0.90 |
| 3 meals in an 8-h window | 1.01 | 0.93 | 0.94 |
| 4 even, 3.5 h apart | 1.02 | 0.96 | 0.96 |
| 6 meals, 2.5 h apart | 1.02 | 0.98 | 0.95 |

(At low total intake OMAD is not worse than 3 small sub-threshold meals — consistent with Hudson's "at least one
adequate meal" conclusion [43]. The hourly model penalises very compressed windows through the refractory
parameters, which are weakly constrained; the formula above is the default.)

Extra catabolism of long daily fasts (daily layer, PROPOSED, grade C):

```
ΔL_fastExtra (kg/d) = − k_f · max(0, t_fast,max − 16 h) · (p0/0.4) · (1 − 0.6·x_P) · M_RT
k_f = 1.0 g lean tissue per h beyond 16 h (range 0–3)
```

Anchors: Schroor IER −0.20 kg FFM vs CER over typical 8–12-wk trials; Templeman ADF extra ≈0.7 kg non-fat mass
in 3 wk (upper bound; includes glycogen/gut content). Whole-day fasts are already handled by the energy deficit
(d = 1 on that day) in §4.4; k_f applies to TRE/OMAD schedules at unchanged daily energy.

### 4.9 Timing: peri-workout "anabolic window" and pre-sleep protein

- Schoenfeld, Aragon & Krieger 2013 [4] (23 studies, 525 subjects for hypertrophy): unadjusted hypertrophy ES
  difference **0.24 ± 0.10 (95 % CI 0.04–0.44)** favouring timed protein; after adjustment for covariates
  **0.16 ± 0.11 (−0.07, 0.38), ns**; reduced model 0.14 ± 0.11, ns; FFM only 0.08 ± 0.07, ns; strength ns. Total
  protein intake explained the apparent timing effect.
- Schoenfeld 2017 [5]: 25 g protein immediately pre- vs post-RT, 21 trained men, 10 wk → no difference in any
  outcome.
- Pre-sleep: 40 g casein 30 min before sleep after evening RE (young men) increased overnight whole-body protein
  synthesis (311 ± 8 vs 246 ± 9 µmol·kg⁻¹ per 7.5 h), net balance (61 ± 5 vs −11 ± 6 µmol·kg⁻¹ per 7.5 h) and
  mixed MPS ≈ +22 % (0.059 vs 0.048 %·h⁻¹, p = 0.05) (Res 2012 [51]). In older men 40 g (not 20 g, nor 20 g +
  1.5 g leucine) raised overnight MyoPS (0.044 vs 0.033 %·h⁻¹) (Kouw 2017 [52]). 12-wk RT with 27.5 g pre-sleep
  protein: strength +164 vs +130 kg, quadriceps CSA +8.4 vs +4.8 cm² (Snijders 2015 [53]) — but total daily
  protein was higher in the protein group; Reis 2021 SR [54] concludes chronic benefits are confounded by
  unequal total protein.

Model rule (grade B): **no explicit timing bonus in the daily layer** beyond what total protein and E_dist
provide. In the hourly layer, timing matters naturally through X_RT (24–48-h sensitisation) and overnight
fed state. A pre-sleep dose that increases total protein is credited through total protein. If the user moves
existing protein to pre-sleep (total unchanged), treat as neutral (E_dist capped at 1.05).

### 4.10 Protein quality: DIAAS/PDCAAS, leucine, plant vs animal

Mechanism: MPS needs a leucine signal and a complete EAA supply; digestibility and the most-limiting indispensable
amino acid (IAA) set how much of a protein is usable. DIAAS (FAO-recommended) uses ileal digestibility of each
IAA; PDCAAS (faecal crude-protein digestibility, truncated at 1.0) overestimates some plant proteins (Mathai 2017
[56]: PDCAAS-like > DIAAS for skim milk powder, pea, soy, wheat).

DIAAS by source (pig SID data compiled by Herreman 2020 [55]; 0.5–3-y reference pattern, the values published
there). Adult-pattern values are **derived by us** by rescaling each IAA ratio by (child pattern ÷ adult pattern)
using FAO 2013 scoring patterns (child 0.5–3 y: His 20, Ile 32, Leu 66, Lys 57, SAA 27, AAA 52, Thr 31, Trp 8.5,
Val 43 mg·g⁻¹; older child/adolescent/adult: His 16, Ile 30, Leu 61, Lys 48, SAA 23, AAA 41, Thr 25, Trp 6.6,
Val 40 mg·g⁻¹ — pattern constants quoted from memory of the FAO 2013 report, UNVERIFIED in this review).
Leucine as % of protein from Pinckaers 2021 [58] / Gorissen 2018 [57].

| Protein | DIAAS 0.5–3 y [55] (limiting AA) | DIAAS adult (derived) | Leucine % of protein | Q_daily = min(1, DIAAS_adult) | Q_meal (PROPOSED) |
|---|---|---|---|---|---|
| Whey | 85 (His) | ≈106 | 11.0 | 1.00 | 1.15 |
| Milk protein / casein | casein 117 | ≈137 | milk 9.0 / casein 8.0 | 1.00 | 1.06 / 1.00 |
| Egg | 101 | ≈111 | 7.0 | 1.00 | 0.94 |
| Pork (meat) | 117 | ≈126 | muscle 7.6 | 1.00 | 0.97 |
| Soy | 91 (SAA) | ≈102 | 6.9 | 1.00 | 0.93 |
| Potato | 100 | ≈125 | 8.3 | 1.00 | 1.02 |
| Pea | 70 (SAA) | ≈82 | 7.2 | 0.82 | 0.86 |
| Oat | 57 (Lys) | ≈68 | 5.9 | 0.68 | 0.71 |
| Wheat | 48 (Lys) | ≈57 | 6.1 | 0.57 | 0.66 |
| Rice | 47 (Lys) | ≈56 | 7.4 | 0.56 | 0.72 |
| Corn | 36 (Lys) | ≈43 | 13.5 | 0.43 | 0.75 |
| Pea/rice blend (59:41) | max 84 (child pattern) [55] | ≈95 (UNVERIFIED) | ≈7.3 | 0.95 | 0.93 |
| Collagen/gelatin | ≈2 (Trp-free) [55] | ≈0 | ≈3 (UNVERIFIED) | 0.3 (N only; PROPOSED) | 0.25 (PROPOSED) |
| Typical omnivore mixed diet | – | – | – | 1.00 | 1.00 |
| Mixed whole-food vegan diet | – | – | – | 0.90 (PROPOSED) | 0.85 (PROPOSED) |

```
Q_meal = sqrt(min(1, DIAAS_adult)) · min(1.15, sqrt(Leu% / 8.0))          # PROPOSED FIT (leucine factor capped)
P_eff  = Σ P_i · Q_daily,i         (daily layer: requirement and f_Pgain use P_eff)
hourly layer uses Q_meal,i as the per-meal multiplier on Ra
```

Leucine arithmetic (Pinckaers [58]): 2.7 g leucine requires ≈ 20 g corn, 25 g whey, ≈33 g potato, ≈37 g brown
rice, ≈38 g pea, ≈40 g soy, ≈45 g wheat, ≈71 g quinoa protein. Plant proteins are lower in EAA (oat 21 %, lupin
21 %, wheat 22 % vs whey 43 %, milk 39 %, casein 34 %, egg 32 %, muscle 38 % of protein), methionine (1.0 ± 0.3 %
vs 2.5 ± 0.1 %) and lysine (3.6 ± 0.6 % vs 7.0 ± 0.6 %) (Gorissen [57]). 60 g vs 35 g wheat hydrolysate increased
MPS in older men (per [58]).

Chronic outcomes:
- Messina 2018 [59] (9 RCTs, n = 266, RT ≥ 6 wk): soy vs whey/animal protein supplementation — no difference in
  LBM (χ² = 0.00–0.06, p ≥ 0.80) or strength.
- Lim 2021 [60] (16 RCTs in MA): no difference in absolute lean mass or strength overall; favouring animal
  protein for % lean mass, and in <50 y: **+0.41 kg (0.08–0.74)** lean mass.
- Hevia-Larraín 2021 [61]: habitual vegans (soy-supplemented) vs omnivores (whey), 12 wk RT at 1.6 g·kg⁻¹·d⁻¹:
  leg lean mass **+1.2 ± 1.0 vs +1.2 ± 0.8 kg**, no between-group differences.
- In energy restriction, whey preserved postprandial MPS better than soy (−9 % vs −28 %) (Hector 2015 [26]).

Model consequence (grade B): quality matters acutely and at marginal intakes; at ≥1.6 g·kg⁻¹·d⁻¹ with mixed
sources it is largely absorbed by the plateau of f_Pgain. With the Q_daily scheme a vegan diet at 1.0 g·kg⁻¹
yields ≈9 % less RT accretion than omnivore; at 1.6 g·kg⁻¹ ≈2 % (consistent with Lim/Messina/Hevia-Larraín).

### 4.11 Collagen, essential amino acids (EAA), branched-chain amino acids (BCAA)

- BCAA alone: 5.6 g BCAA after RE increased MyoPS by **22 %** (0.110 vs 0.090 %·h⁻¹) vs placebo (Jackman 2017
  [62]) — roughly half of the ~50 % response to 20–25 g whey [29]; BCAA cannot sustain MPS without the other EAA,
  and in the postabsorptive state their effect is limited by EAA availability (Wolfe 2017 review [63]).
- Free leucine added to a small protein dose reproduces the early but not the sustained MPS response
  (Churchward-Venne 2012/2014 [34,35]); in older men 20 g casein + 1.5 g leucine did not match 40 g casein
  overnight (Kouw 2017 [52]).
- Collagen: lactalbumin increased MyoPS 13 ± 5 % more than isonitrogenous collagen during intensified training
  (Oikawa 2020 [65]); whey vs collagen (2 × 30 g·d⁻¹, total 1.6 g·kg⁻¹) did not differ in protecting leg lean mass
  during energy restriction + step reduction in older adults, but only whey restored LLM and MPS on recovery
  (Oikawa 2018 [64]); 15 g·d⁻¹ collagen peptides + RT in 53 sarcopenic men (72 y): FFM **+4.2 ± 2.3 vs +2.9 ± 1.8
  kg** vs placebo (Zdzieblik 2015 [66]; the silica placebo group received no supplemental protein, so total
  protein differed — confounded). Muscle connective-protein synthesis rose after 25 and 100 g milk protein without
  any rise in plasma glycine (Trommelen [31]), so glycine-rich collagen is not required for connective-tissue
  remodelling.
- EAA: free-form EAA are absorbed fast (speed factor 2.0 in §4.7) and contain no non-essential AA. For the
  per-meal signal count 1 g of free EAA as ≈2 g of high-quality intact protein (Q_meal ≈ 2.0; derived from EAA
  content — whey is 43 % EAA [57]); for daily N adequacy count 1 g EAA as 1 g protein (PROPOSED, grade C).

Model rule: BCAA contribute leucine signal but Q_daily ≈ 0.4 for N (PROPOSED); collagen Q_daily 0.3, Q_meal 0.25;
EAA as above. Evidence grade: B (acute), C (chronic).

### 4.12 Resistance-exercise effects on muscle protein turnover (nutrition interface)

(Hypertrophy dose-response is in dossier 09; here only the turnover kinetics used by §4.7.)

- Untrained, fasted: FSR +112 % (3 h), +65 % (24 h), +34 % (48 h); FBR +31 % (3 h), +18 % (24 h), baseline by
  48 h; net balance improved but remained negative without food (rest −0.0573, 3 h −0.0298, 24 h −0.0413, 48 h
  −0.0440 %·h⁻¹) (Phillips 1997 [67]).
- MPS +50 % at 4 h, +109 % at 24 h, back within 14 % of control by ~36 h (elbow flexors, MacDougall 1995 [69]).
- Trained state shortens the response: after 8 wk training, FSR +162 % at 4 h but at resting level by 28 h in
  the trained leg, whereas the untrained leg was still +70 % at 28 h (Tang 2008 [70]). Trained subjects show a
  smaller FSR rise (0.045 → 0.067 vs 0.036 → 0.080 %·h⁻¹) and no FBR increase (Phillips 1999 [68]).
- Volume: 3 sets > 1 set: fed MPS 3.1× vs 2.3× at 5 h, 2.3× vs baseline at 29 h (Burd 2010 [71]).
- RE to failure sensitises MyoPS to 15 g whey 24 h later (fed increment 0.016 → 0.038–0.041 %·h⁻¹) (Burd 2011
  [72]).
- Early training MyoPS is directed at damage repair; correlation with hypertrophy (r ≈ 0.9) only at weeks 3 and
  10 (Damas 2016 [73]).
- Energy deficit: a single RE bout restores MPS to energy-balance values (Areta 2014 [25]).

Evidence grade: B.

### 4.13 Fasting, muscle protein breakdown, nitrogen losses and protein sparing

Mechanism: in the first days of fasting, falling insulin and rising glucagon/cortisol increase release of
glucogenic amino acids (alanine, glutamine) from muscle to support gluconeogenesis; as ketones rise (days 3–17)
brain glucose demand falls, alanine falls, and protein oxidation declines to an obligatory minimum. Ketones
themselves are anticatabolic. Dietary protein (and early on, carbohydrate) spares body protein.

Data:
- 60-h fast (15 postabsorptive vs 7 fasted non-obese): forearm muscle AA release **+69 %**, alanine **+59 %**;
  insulin 11.3 → 7.5 µU·mL⁻¹ (Pozefsky 1976 [75]).
- 72-h fast (8 men): increased forearm net phenylalanine release; mTOR phosphorylation −50 %; LC3B-II +30 %;
  MAFbx/MuRF1 unchanged; insulin-stimulated mTOR signalling blunted (Vendelbo 2014 [74]).
- Prolonged fasting (obese, 5–6 wk): glucose production ≈86 g·d⁻¹ (half hepatic, half renal) (Owen 1969 [78]);
  alanine falls most in week 1, reducing gluconeogenic substrate and protein catabolism (Felig 1969 [79]).
- 21-d fast in 5 obese subjects: FFM and fat lost in parallel; late aminogenic oxidation ≈7 % of energy; minimal
  obligatory AA oxidation **0.27 ± 0.08 g·kg BW⁻¹·d⁻¹ = 0.52 ± 0.10 g·kg FFM⁻¹·d⁻¹** (Owen 1998 [77]).
- Total-body N loss during fasting is biexponential (fast component t½ of a few days, slow component t½ of many
  months); N lost per kg weight lost ≈20 g (non-obese) vs ≈10 g (fat ≥ 50 kg) (Forbes & Drenick 1979 [76]).
- 10-d modified fast (200–250 kcal·d⁻¹): total N excretion fell **41 ± 7 % by day 5** then stable; plasma
  3-methylhistidine rose to day 4 then returned to baseline; metabolically active tissue loss 1.5 kg (25 % of
  weight loss) (Laurens 2021 [80]).
- Ketones: Na-β-hydroxybutyrate infusion (1.1–1.2 mM) lowered alanine 21 % (3 h) and 37 % (6 h); in subjects
  fasted 5–10 wk, 12-h infusions on 2 days reduced urinary N by **30 %** (Sherwin 1975 [81]). β-OHB reduced leucine
  oxidation by 30 % (18–41 %) and increased muscle protein synthesis by 10 % (5–17 %) (Nair 1988 [82]). During
  LPS inflammation, 3-OHB at 3.5 mM cut net forearm phenylalanine release by >70 % (Thomsen 2018 [83]).
- VLED protein: 500-kcal diets for 5–8 wk in obese women: 1.5 g·kg IBW⁻¹ → **N balance 0 after 3 wk**; 0.8 g·kg
  IBW⁻¹ + 0.7 g·kg IBW⁻¹ carbohydrate → **−2 g N·d⁻¹** (Hoffer 1984 [84]).
- Ketogenic vs non-ketogenic VLCD (600 kcal, 8 g N·d⁻¹ ≈ 50 g protein, 4 wk, ward, morbidly obese women):
  cumulative N balance **−50.4 ± 4.4 vs −18.8 ± 5.7 g N** (ketogenic worse); leucine oxidation higher on the
  ketogenic diet; proteolysis (leucine flux, 3-MH) similar (Vazquez 1992 [85]) ⇒ early carbohydrate spares
  protein more than early ketosis does.

Fasting-branch equations (use when EI < 30 % of TEE **and** protein < 0.3 g·kg FFM⁻¹·d⁻¹; PROPOSED FIT, grade B/C):

```
t_f   = days since start of fast (continuous; resets after ≥24 h of normal feeding)
Pox_min = 0.52 · (1 + 0.5·L)                                   # g·kg FFM⁻¹·d⁻¹; Owen [77] (obese); leaner higher (PROPOSED)
Pox_0   = 0.90                                                  # g·kg FFM⁻¹·d⁻¹ at fast onset (range 0.7–1.2; UNVERIFIED)
Pox(t)  = Pox_min + (Pox_0 − Pox_min) · exp(−t_f / τ_N),  τ_N = 3 d       # 41 % fall by day 5 [80]
ketone modifier (if 05 supplies BHB): τ_N,eff = τ_N · 2 / (1 + clamp(BHB/2 mM, 0, 1))   # faster sparing with higher BHB
carbohydrate sparing: Pox ×= (1 − 0.3 · clamp(CHO_g / 100, 0, 1)) for t_f < 7 d        # direction from Vazquez [85]
ΔL_tis (kg/d)  = − (Pox · FFM − 0.3 · P_eff_diet) / (1000 · c_P)
N loss (g/d)   = Pox · FFM / 6.25
```

Cross-checks: 70-kg non-obese man, FFM 57 kg, L = 0.6: day-1 N loss ≈ 8.2 g, day-10 ≈ 6.2 g N·d⁻¹; lean tissue
loss ≈0.25 → 0.19 kg·d⁻¹. Forbes–Drenick (≈20 g N per kg weight lost) implies ≈6–8 g N·d⁻¹ at 0.3–0.4 kg·d⁻¹ of
tissue weight loss — consistent. Hourly-layer view: 24-h fast NET ≈ −0.85 %·d⁻¹ of P_musc (≈ −50 g muscle
protein·d⁻¹ for 6 kg P_musc), i.e., muscle supplies roughly the whole early protein oxidation — probably an
overestimate because splanchnic/visceral protein also contributes early (Forbes' fast component). Allocate 60 %
muscle / 40 % non-muscle lean tissue in the first 3 days, 80 / 20 thereafter (PROPOSED, grade D — no direct human
partition data found).

Link to PSMF (details in 13): 1.5 g·kg IBW⁻¹ protein on 500 kcal restores N balance within ~3 wk [84]; carry-over:
during the first week of any VLED, expect N balance −2 to −4 g·d⁻¹ regardless.

Evidence grade: B (fasting physiology, ketone sparing, VLED protein), C (parameterisation).

### 4.14 Anabolic resistance: ageing, inactivity, obesity

| Factor | Data | Model multiplier (PROPOSED unless stated) |
|---|---|---|
| Age | Per-meal breakpoint 0.24 → 0.40 g·kg BM⁻¹ (young vs ~71 y), lower first-segment slope, basal MPS unchanged [28]; 40 g (not 20 g) casein pre-sleep raises overnight MyoPS in 72-y men [52]; ≥30 g post-RE needed in 66-y men [36]; protein-supplement effect on FFM −0.01 kg·y⁻¹ [1]; PROT-AGE ≥1.0–1.2 g·kg⁻¹·d⁻¹ [109] | K_age = K·(1 + 0.67·clamp((age−30)/40,0,1)); per-meal threshold (daily layer) 0.28 → 0.50 g·kg FFM⁻¹; AR_age (RT credit) = 1 − 0.25·clamp((age−30)/40,0,1) |
| Step reduction | 10 older adults (72 y), 14 d at 1413 ± 110 steps·d⁻¹ (−76 %): leg FFM −3.9 %, postprandial MPS −26 %, postabsorptive unchanged, insulin sensitivity −43 % (Breen 2013 [86]) | AR_fed = 0.74 while steps < 1500·d⁻¹ (older); onset τ = 5 d, recovery τ = 7 d (UNVERIFIED time-constants); disuse loss 0.28 %·d⁻¹ of leg lean mass |
| Limb immobilisation | 5 d cast: quadriceps CSA −3.5 ± 0.5 %, 14 d −8.4 ± 2.8 %, strength −9 % / −23 % (Wall 2014 [87]); 5 d: postabsorptive MyoPS −41 % (0.015 vs 0.032 %·h⁻¹), postprandial −53 % (0.020 vs 0.044 %·h⁻¹) (Wall 2016 [88]) | AR_basal = 0.59, AR_fed = 0.47 for immobilised muscle; mass loss ≈0.6–0.7 %·d⁻¹ of that muscle for the first 2 wk |
| Bed rest (older) | 10 d bed rest in 11 healthy 67-y adults eating RDA protein: knee-extensor strength −13.2 ± 4.1 %, VO₂max −12 % (Kortebein 2008 [118]); lean-leg-mass and MPS results of the companion JAMA letter (≈ −1 kg leg lean, MPS ≈ −30 %) UNVERIFIED [91] | treat whole-body SM as step-reduction × 2 (PROPOSED) |
| Obesity | 36 g pork protein: MyoPS 0–300 min 1.6-fold greater in healthy-weight than OW/OB (Beals 2016 [89]); after RE + 36 g protein, ΔMyoPS 0.10 (normal weight) vs 0.06 %·h⁻¹ (obese) in the exercised leg (Beals 2018 [90]) | AR_fed,obesity = 0.63 at BMI ≥ 30, linear from 1.0 at BMI 25 (grade B/C); exercise synergy b_X × 0.6 |
| Insulin resistance/T2D | insulin reduces MPB (WMD −15.5) and permits MPS only when AA rise; in diabetes with maintained AA, insulin lowered MPS (WMD −6.7) (Abdulla 2016 [113]) | handled via 04's insulin and the ×0.63 obesity term (grade C) |

Age-related background loss of FFM at weight stability ≈1.5 kg per decade (Forbes, via Heymsfield [18]);
skeletal muscle mass declines noticeably after the fifth decade (Janssen [110]). Daily layer: `ΔL_age = −0.4 g
lean·d⁻¹ × clamp((age − 45)/20, 0, 1.5) × (1 − 0.8·RT)` (PROPOSED; RT offsets most of it).

Evidence grade: B (acute anabolic resistance), C (multipliers and time-constants).

### 4.15 Surplus: protein and lean gain when overfeeding

- Bray 2012 [92] (see §4.3): with +40 % energy and no RT, lean mass gain requires ≥15 % protein; 25 % adds little
  beyond 15 % (+3.18 vs +2.87 kg); 5 % protein → lean loss despite surplus; fat gain independent of protein.
- Antonio 2014 [93]: 4.4 g·kg⁻¹·d⁻¹ (307 ± 69 g·d⁻¹; more total energy) for 8 wk in trained people with
  unchanged training → **no change** in BW, FM or FFM (Bod Pod).
- Antonio 2015 [94]: 3.4 vs 2.3 g·kg⁻¹·d⁻¹ + periodised heavy RT, 8 wk: BW −0.1 vs +1.3 kg; FM −1.7 vs −0.3 kg;
  FFM +1.5 vs +1.5 kg (same) despite higher energy intake in the high-protein group.
- Antonio 2016 [95]: 1-yr crossover 2.51 vs 3.32 g·kg⁻¹·d⁻¹ (34.4 vs 29.9 kcal·kg⁻¹·d⁻¹): no FM gain, no adverse
  lipid, liver or kidney markers.

Model rule (grade B): in surplus, lean accretion = min(Forbes/11 partition, protein cap §4.3) + RT credit (f_E = 1);
protein above ~2.0–2.2 g·kg BM⁻¹·d⁻¹ does not add lean mass; excess protein energy is largely dissipated
(TEF, dossier 02) and in free-living trials did not raise fat mass (Antonio) — dossier 11 should treat surplus
protein energy as less fattening than surplus carbohydrate/fat (grade C; Bray found identical fat gain at 15 vs
25 %).

### 4.16 Other effects of protein (interfaces)

| Effect | Quantitative data | Hand-off |
|---|---|---|
| Satiety / ad-lib intake | 15 → 30 % protein (carbohydrate constant): ad-lib intake **−441 ± 63 kcal·d⁻¹**, BW −4.9 ± 0.5 kg, FM −3.7 ± 0.4 kg over 12 wk (Weigle 2005 [96]) | dossier 12 |
| Protein leverage | 15 → 10 % protein: energy intake **+12 ± 4.5 %** over 4 d, mostly savoury snacks between meals; 15 → 25 %: no change (Gosby 2011 [97]) | dossier 12 |
| TEF | DIT 20–30 % of protein energy vs 5–10 % carbohydrate, 0–3 % fat (Westerterp 2004 [98]) | dossier 02 |
| GNG cost | 30 % protein / 0 % carbohydrate diet: fractional GNG 0.95 vs 0.64, absolute GNG 171 vs 145 g·d⁻¹ (p = 0.06), RMR 8.46 vs 8.12 MJ·d⁻¹; energy cost of GNG ≈33 % of glucose energy (Veldhorst 2009 [99]) | 02, 05 |
| Kidney (healthy) | MA 28 trials, n = 1358, HP (≥1.5 g·kg⁻¹ or ≥20 % E or ≥100 g·d⁻¹): change in GFR SMD 0.11 (−0.05, 0.27), ns (Devries 2018 [100]) | 17 (CKD is a contraindication, not covered here) |
| Bone | higher protein: lumbar spine BMD +0.52 % (0.06–0.97); no adverse effect at any site (Shams-White 2017 [101]) | 19 |
| Upper tolerable intake | intestinal AA absorption 1.3–10 g·h⁻¹; suggested maximum ≈25 % of energy (≈2–2.5 g·kg⁻¹·d⁻¹) for long-term, theoretical safe maximum 285–365 g·d⁻¹ for 80 kg (hepatic urea synthesis), risk of hyperammonaemia / "rabbit starvation" when protein > 35 % of energy with inadequate fat/carbohydrate (Bilsborough & Mann 2006 [102]); tolerated 3.3–4.4 g·kg⁻¹·d⁻¹ for 8 wk–1 yr in trained young adults [93–95] | 17 |

### 4.17 Protein and ketosis: does gluconeogenesis from protein impair ketosis?

- Only ≈4 g of glucose was derived from 23 g egg protein over 8 h after an overnight fast (total EGP 50.4 g);
  18 % of the dietary AA were deaminated (Fromentin 2013 [103]).
- A 30 % protein, 4 % carbohydrate ad-lib diet produced plasma β-OHB 1.52 mM (urine 2.99 mM) over 4 wk in obese
  men (Johnstone 2008 [104]).
- A carbohydrate-free 30 % protein diet raised fractional GNG to 0.95 but absolute GNG only +26 g·d⁻¹ (ns) vs a
  normal diet (Veldhorst 2009 [99]).

Model rule (grade B): protein intake does not prevent ketosis at typical high-protein intakes (≤ ~2 g·kg⁻¹·d⁻¹,
≤ 30 % E) when net carbohydrate is low; dossier 05 may apply a small ketone-suppression term per gram of protein
(glucose yield ≈0.17 g per g protein over 8 h from Fromentin; insulin response to protein), but protein is
**not** equivalent to carbohydrate gram-for-gram.

### 4.18 Whole-body protein turnover, nitrogen balance, tissue composition and energy density

| Quantity | Value | Source | Grade |
|---|---|---|---|
| Skeletal muscle mass | men 33.0 kg (38.4 % BM), women 21.0 kg (30.6 % BM) (MRI, n = 468) | Janssen 2000 [110] | A |
| SM as fraction of FFM | ≈0.45–0.50 (derived: 38.4 % BM ÷ ~80 % FFM/BM in men) | derived | C |
| Hydration of FFM | ≈0.73 (water/FFM) | Wang 1999 [111] | A |
| Protein content of metabolically active lean tissue | 33 g N·kg⁻¹ ⇒ ≈0.206 kg protein·kg⁻¹ | Laurens 2021 [80] | B |
| Energy density of lean tissue change | 1000–1020 kcal·kg⁻¹ (hydrated tissue, Bray/Heymsfield) or 7.6 MJ·kg⁻¹ = 1816 kcal·kg⁻¹ (Hall; assumes 1.6 g water per g protein) | [92], [18], [19] | B — resolve in 01 |
| Energy density of fat | 39.5 MJ·kg⁻¹ (9440 kcal·kg⁻¹) | Hall 2008 [19] | A |
| Energy content of weight change (Heymsfield) | 1020·f + 9500·(1 − f) kcal·kg⁻¹, f = ΔFFM/ΔW | [18] | B |
| Basal mixed-muscle FSR | 0.036–0.045 %·h⁻¹ (≈0.9–1.1 %·d⁻¹); fed MyoPS 0.06–0.10 %·h⁻¹ | [68], [29], [32] | B |
| Basal mixed-muscle FBR | 0.076–0.080 %·h⁻¹ | [68], [27] | B |
| Insulin effect on muscle breakdown | leg protein breakdown halved at 30 mU·L⁻¹, no further suppression at 72–167 mU·L⁻¹; AA tripling at basal insulin doubled MPS without changing breakdown (Greenhaff 2008 [112]); MA: insulin reduced MPB (WMD −15.5, CI −19.7 to −11.2) and did not change MPS unless AA availability increased (Abdulla 2016 [113]) | B/A |
| Whole-body protein turnover | ≈250–350 g·d⁻¹ (≈4 g·kg⁻¹·d⁻¹) in adults — textbook magnitude (Waterlow review [117]); exact figure UNVERIFIED here | D/UNVERIFIED |
| N ↔ protein | 1 g N = 6.25 g protein | convention | A |

Lean tissue composition for the engine (lean tissue *excluding* glycogen-bound water, which 04 handles): ≈73 %
water, ≈20.6 % protein, remainder minerals/other (PROPOSED composite of [111] and [80]). Skeletal-muscle share of
ΔL_tis: 0.5 in energy-deficit loss (non-muscle organs also shrink; Heymsfield/Ross example: 1.7 kg SM of 7.8 kg
weight loss in diet-only men [18]), 0.8–0.9 of RT-driven gain (PROPOSED, grade C).

### 4.19 Daily-resolution fallback (deliverable b) — complete update per simulated day

```
inputs:  BW, FM, FFM, SM, age, sex, EI, TEE (→ d or surplus), P_day and meals (g, time, source), RT (0..1) and
         G_RT (kg·wk⁻¹, from 09), activity (0..1), steps, BHB (05), insulin (04)
1. Quality:          P_eff = Σ P_i·Q_daily,i ;  q = P_eff / FFM          (g·kg FFM⁻¹·d⁻¹)
2. Distribution:     E_dist from §4.8 (formula or hourly)
3. Fasting-branch?   if EI < 0.3·TEE and q < 0.3 → §4.13 Pox model for ΔL_tis; fat from energy balance; skip 4–6
4. Deficit (d > 0):  p_cat and credit from §4.4 (credit × E_dist × onset lag) → ΔL_tis, Δfat
5. Balance/surplus:  ΔL_tis = min(partition_surplus (01/11), ΔL_cap) + credit·E_dist (f_E = 1)   [ΔL_cap §4.3]
6. Add:              ΔL_fastExtra (§4.8) + ΔL_age (§4.14) + disuse terms (§4.14)
7. Split:            ΔSM = s_SM·ΔL_tis with s_SM = 0.5 (loss) / 0.85 (RT gain);  ΔP_musc = 0.206·ΔSM
8. Diagnostics:      NB (g N·d⁻¹) = ΔL_tis·1000·0.206/6.25 ;  MPS/MPB indices from the hourly layer (renormalised)
```

Evidence grade of the assembled fallback: C (components A/B).

---

## 5. Interactions with other subsystems

| Needs from | What | Used in |
|---|---|---|
| 01 body-weight models | Forbes/Hall partition p0, ρL/ρF conventions, energy balance integration | §4.4, §4.18 |
| 02 energy expenditure | TEE (to convert % deficit ↔ kcal); receives protein TEF (20–30 %) and GNG cost | §4.4, §4.16 |
| 04 carbohydrate/glycogen/insulin | insulin time course (MPB suppression), glycogen & bound water (DXA-lean artefacts), carbohydrate protein-sparing in early fasting | §4.7, §4.13 |
| 05 ketosis | blood BHB (protein sparing, τ_N), receives "protein does not block ketosis" rule and optional small suppression | §4.13, §4.17 |
| 07 meal timing | meal clock times, eating window, fasting hours | §4.7, §4.8 |
| 09 resistance training | RT (0–1), bout times and stimulus I_b, training status (τ_X, G_RT kg·wk⁻¹ by status), onset lag | §4.4, §4.7, §4.12 |
| 10 cardio/activity | activity index (M_act), steps (anabolic resistance) | §4.4, §4.14 |
| 11 surplus partitioning | lean share of surplus weight gain; receives protein cap ΔL_cap | §4.3, §4.15 |
| 12 appetite | receives protein satiety/leverage effects (Weigle, Gosby) | §4.16 |
| 13 transitions/PSMF | receives fasting N-loss branch, VLED protein rules | §4.13 |
| 14 anthropometrics | FFM, SM, BF % initial values; receives ΔSM/ΔFFM | §2 |
| 16 modifiers | sex, menopause, sleep/stress (cortisol) modifiers — none quantified here | – |
| 17 safety | protein ceilings, CKD contraindication, lean-loss alarms | §9 |
| 19 outcomes | strength (09/19), bone (protein small + effect), function | §4.16 |

Gives to others: ΔL_tis, ΔSM, ΔP_musc, N balance, hourly MPS/MPB/NET curves, AI_day, E_dist, protein-quality
effective intake, protein-derived glucose (≈0.17 g glucose per g protein, Fromentin [103]).

---

## 6. Output metrics for the UI

| Metric | Unit | Direction of good | Computation | Grade |
|---|---|---|---|---|
| Lean (fat-free) tissue mass | kg | ↑ / preserve | L_tis state (+ glycogen water from 04 for "DXA-like FFM") | B |
| Skeletal muscle mass | kg | ↑ | SM state | C |
| Lean fraction of weight lost | % | ↓ (negative = recomposition) | ΔL_tis / ΔBW over a user-selected window | C |
| Daily protein (per kg BM and per kg FFM) | g·kg⁻¹·d⁻¹ | target band (e.g., 1.6–2.2 BM, or q_sat in deficit) | input | A |
| Protein adequacy index x_P | 0–1 | ↑ | §4.4 | C |
| Per-meal protein vs threshold | g and % of threshold | ≥100 % for ≥2 meals | §4.8 | B |
| Effective anabolic meals n_eff | count | 2–4 | §4.8 | C |
| Distribution efficiency E_dist | 0.83–1.05 | ↑ | §4.8 | C |
| Hourly MPS, MPB, net muscle protein balance | %·h⁻¹ | net > 0 after meals | §4.7 | C |
| Nitrogen balance | g N·d⁻¹ | ≥ 0 | §4.19 step 8 | B/C |
| Fasting protein oxidation | g·d⁻¹ | ↓ | §4.13 | B/C |
| Anabolic-resistance status | multiplier | ↑ toward 1 | §4.14 | C |
| Protein-quality score of the day | DIAAS-weighted | ↑ | Σ P_i·Q_daily,i / Σ P_i | B |
| Estimated muscle protein synthesis vs baseline | % | ↑ | AI_day / AI_ref | C |

Planner goals that can use these: "preserve muscle while losing fat" (minimise lean fraction), "gain muscle"
(maximise ΔSM), "maximise autophagy" (conflicts with protein/mTOR — coordinate with 08: fasting windows raise
fasting catabolism here).

---

## 7. Validation targets

The engine (daily layer unless stated) should reproduce these within the stated tolerance.

1. **Longland 2016 [7]** — 40 young men, ~40 % energy deficit (33 kcal·kg LBM⁻¹), 4 wk, RT + HIIT 6 d·wk⁻¹, 1.2 vs
   2.4 g·kg⁻¹·d⁻¹. Observed: LBM +0.1 ± 1.0 vs +1.2 ± 1.0 kg; FM −3.5 ± 1.4 vs −4.8 ± 1.6 kg. Target: correct
   sign (PRO ≥ CON), between-group lean difference ≥ 0.4 kg (observed 1.1), FM difference ≥ 0.5 kg. Current
   fallback: lean −0.41 vs +0.30 kg (difference 0.71).
2. **Mettler 2010 [9]** — 20 RT-trained athletes, 60 % of habitual energy, 2 wk, 15 % (≈1.0 g·kg⁻¹) vs 35 %
   (≈2.3 g·kg⁻¹) protein. Observed: BW −3.0 vs −1.5 kg; LBM −1.6 vs −0.3 kg. Target (tissue + glycogen water from
   04): LBM loss ratio HP/CP ≤ 0.5; absolute DXA-like LBM loss within ±0.6 kg.
3. **Bray 2012 [92]** — 25 adults, 8 wk metabolic ward, +954 kcal·d⁻¹, 5/15/25 % protein. Observed LBM −0.70 /
   +2.87 / +3.18 kg; FM +3.66 / +3.45 / +3.44 kg (no difference). Target: each arm within ±0.8 kg lean; fat gain
   independent of protein (±0.5 kg).
4. **Morton 2018 [1]** (meta-level) — for young adults doing 12-wk RT at energy balance, raising protein from 1.2
   to ≥1.6 g·kg⁻¹·d⁻¹ adds +0.30 kg (0.09–0.52) FFM; no further gain from 1.6 to 2.4 g·kg⁻¹·d⁻¹. Target: added FFM
   0.1–0.5 kg; additional gain from 1.6 → 2.4 < 0.15 kg.
5. **Pasiakos 2013 [8] + Hector 2018 [27] + Areta 2014 [25] (hourly/MPS layer)** — at 30–40 % deficit,
   postabsorptive MPS falls 19–27 % at ~1–1.5 g·kg⁻¹ and ~13 % at 2.4 g·kg⁻¹; one RE bout restores MPS to energy-balance
   values; MPB unchanged. Target: f_E,MPS within ±10 percentage points; RE-day MPS ≥ energy-balance rest value.
6. **Trommelen 2023 [31] (hourly layer)** — after whole-body RE, 100 vs 25 g milk protein: MyoPS ≈ +20 % (0–4 h)
   and ≈ +40 % (4–12 h); plasma appearance of dietary AA 26/44/53 % (100 g) and 51/62/66 % (25 g) at 4/8/12 h.
   Target: ratios within ±0.15; appearance within ±7 percentage points.
7. **Hoffer 1984 [84] (fasting/VLED branch)** — 500-kcal diets, obese women: 1.5 g·kg IBW⁻¹ → N balance ≈ 0 by wk 3;
   0.8 g·kg IBW⁻¹ (+carbohydrate) → −2 g N·d⁻¹. Target: N balance within ±1 g N·d⁻¹; difference ≈ 2 g N·d⁻¹.
8. **Wycherley 2012 / Krieger 2006 / Kim 2016 [12–14]** — isocaloric energy restriction (≈12 wk), high vs
   standard protein: FFM retained +0.43 (0.09–0.78) / +0.60 / +0.45–0.83 kg; fat mass −0.87 (−1.26, −0.48) kg.
   Target: simulated HP − SP FFM difference 0.3–0.9 kg for an 8–10 kg loss.

Additional qualitative checks: Forbes–Drenick fasting N/weight ratios (≈20 vs ≈10 g N·kg⁻¹, non-obese vs FM ≥ 50
kg) [76]; Chaston sedentary vs RT vs aerobic (0.27 / 0.17 / 0.13) [17]; Garthe slow vs fast loss [21]; Schroor
IER − CER FFM −0.20 kg [50]; Moro/Tinsley TRF with ≥1.6 g·kg⁻¹ + RT → no FFM penalty [44,46].

---

## 8. Myths / contested claims

| Claim | Evidence | Verdict |
|---|---|---|
| "The body can only use 20–30 g of protein per meal; the rest is oxidised or wasted" | 100 g vs 25 g: greater and longer (>12 h) MyoPS; oxidation < 15 % of the increment; whole-body net balance keeps rising (Trommelen [31]); 70 vs 40 g improved whole-body net balance via lower breakdown (Kim 2016 [37]). The 20–25 g figure applies to fast isolated protein measured over ≤ 4–6 h (Witard [29], Moore [28]) | **False as a general rule**; per-meal *peak* MPS saturates near 0.24–0.40 g·kg⁻¹, *duration* does not |
| "You must eat protein within 30–60 min after training (anabolic window)" | After adjustment for total protein, timing effect on hypertrophy ES 0.16 (ns) [4]; pre vs post 25 g identical [5]; MPS remains elevated/sensitised 24–48 h [67,72] | **Largely false**; total protein dominates |
| "Eat every 2–3 h or you go catabolic" | TRF 16/8 with adequate protein preserved FFM (Moro [44], Tinsley 2019 [46]); OMAD did not lower FFM (Stote [47]); distribution RCTs mostly null (Kim 2018 [41]) | **False** when total protein is adequate; small penalties plausible with marginal intake or long fasts |
| "More than ~1.6 g·kg⁻¹ is always wasted" | Plateau 1.62 but CI to 2.2 (Morton [1]); in energy deficit, needs rise to 1.6–2.4 g·kg⁻¹ (athletes) or 2.3–3.1 g·kg FFM⁻¹ (lean, large deficits) [6,10]; IAAO in trained men ≈2.0 g·kg⁻¹ [108] | **Context-dependent**: true for surplus/maintenance, false in aggressive deficits |
| "High protein damages healthy kidneys" | No change in GFR vs lower protein (SMD 0.11, ns) [100]; 1-yr 2.5–3.3 g·kg⁻¹ without adverse markers [95] | **False for healthy kidneys**; CKD is a separate case |
| "High protein is bad for bone" | Higher protein: +0.52 % lumbar spine BMD, no harm [101] | **False** |
| "Excess protein turns into sugar and kicks you out of ketosis" | 23 g protein → ≈4 g glucose over 8 h [103]; 30 % protein ketogenic diet → β-OHB 1.5 mM [104] | **Mostly false** at typical intakes |
| "Plant protein cannot build muscle" | Soy = whey/animal for LBM & strength [59]; vegan 1.6 g·kg⁻¹ = omnivore [61]; small animal advantage in <50 y (+0.41 kg) [60] | **False** at adequate intake; quality matters at marginal intake |
| "BCAA supplements build muscle" | 5.6 g BCAA → +22 % MyoPS acutely vs placebo, ~half of whey's effect; not sustainable without other EAA [62,63] | **Weak**; count BCAA only as a partial signal |
| "Collagen is a complete protein" | DIAAS ≈0 (tryptophan-free) [55]; lactalbumin > collagen for MyoPS [65] | **False** for MPS; some chronic data positive (confounded) [66] |
| "Fasting protects muscle because growth hormone rises" | ADF lost more non-fat mass than matched daily restriction (≈0.86 vs 0.16 kg) [49]; IER −0.20 kg FFM vs CER [50]; 10-d fast: 25 % of weight loss as metabolically active tissue [80]; protein sparing does develop with ketosis [80,81] | **False**; fasting costs some lean tissue, attenuated over days |
| "Weight lost is always 75 % fat / 25 % lean" | Fraction varies with initial fat (Forbes), deficit, protein, exercise, time; early losses mostly water (Heymsfield [18]) | **Oversimplification** |
| "Protein in a surplus is stored as fat just like other calories" | Fat gain identical at 15 vs 25 % protein, protein raised lean mass and REE (Bray [92]); 3.4–4.4 g·kg⁻¹ without fat gain in trained people (Antonio [93–95]) | **Partly false** — protein surplus goes preferentially to lean tissue and heat |
| "Pre-sleep casein is uniquely anabolic" | Raises overnight MPS acutely [51,52]; chronic benefit confounded by extra total protein [53,54] | **Unproven beyond total protein** |

---

## 9. Safety bounds

1. **Minimum protein in the planner**: never prescribe < 0.8 g·kg BM⁻¹·d⁻¹ (adults) or < 1.0 g·kg⁻¹·d⁻¹ (≥ 65 y)
   [105,109]; in any energy deficit ≥ 20 %, require q ≥ 1.2 g·kg FFM⁻¹·d⁻¹; in VLED/PSMF (EI ≤ 800 kcal) require
   ≥ 1.2–1.5 g·kg IBW⁻¹·d⁻¹ [84] (13 owns PSMF details).
2. **Maximum protein**: planner cap 2.5 g·kg BM⁻¹·d⁻¹ **and** ≤ 35 % of energy intake long-term (risk of
   hyperammonaemia/"rabbit starvation" above ~35 % E with inadequate fat and carbohydrate) [102]. Simulator may
   run up to 4.4 g·kg⁻¹·d⁻¹ (tested for 8 wk [93]) with a warning above 3.5.
3. **Kidney disease**: the healthy-kidney safety data [100] do not apply to CKD; PROT-AGE makes an exception for
   severe CKD (eGFR < 30 mL·min⁻¹·1.73 m⁻², not on dialysis) [109] — the app must ask about kidney disease and
   refuse high-protein plans if present (17).
4. **Lean-loss alarm**: warn if simulated ΔL_tis loss exceeds ~0.5 %·wk⁻¹ of FFM for > 2 wk, or if lean fraction
   of loss > 0.35 for > 4 wk (PROPOSED thresholds; e.g., Mettler CP group lost 2 % of LBM in 2 wk).
5. **Low body fat + large deficit**: at male BF < 10 % / female < 18 % with deficit > 25 %, flag high lean-loss
   risk (Rangers ΔFFM/ΔW 0.40 at 15 % fat [18]; leaner lose more [18,76]).
6. **Prolonged fasting**: > 72 h water-only fasts: warn about protein loss (early N loss ≈ 8–12 g N·d⁻¹ modelled),
   orthostatic/electrolyte issues (15/17); planner should not prescribe fasts > 72 h; older adults and sarcopenia:
   avoid fasts > 24 h and deficits > 25 % without RT and ≥ 1.2 g·kg⁻¹.
7. **Inactivity**: immobilisation/bed rest scenarios should warn that 5 d can cost ~3–4 % of quadriceps CSA [87].

---

## 10. Open questions / weakest assumptions

1. **Baseline partition in lean adults**: Forbes p0 predicts ≈0.4 lean share for lean adults at moderate
   deficits, but some well-controlled 3-wk data (Templeman 75:75) show ≈0.08. Needs a better sex/age/fitness-specific
   baseline (Thomas NHANES models, owned by 01).
2. **Pasiakos 2013 exact FFM kg values** were not accessible (abstract only) — the protein effect size at 40 %
   deficit without RT is therefore under-constrained.
3. **Chronic value of distribution/timing**: acute MPS differences (Mamerow +25 %, Areta +31–48 %) vs mostly null
   8–12-wk trials. The γ = 0.3 shrinkage and the E_dist formula are judgement.
4. **Muscle-full vs no-ceiling**: the hourly model reproduces Trommelen and Witard but not Areta's pulse penalty;
   refractory time-constants (k_R, τ_R) are poorly identified; compressed-window penalties are model-dependent.
5. **Energy density of lean tissue** (1000 vs 1816 kcal·kg⁻¹) changes predicted weight-loss speed when lean share
   is large; must be harmonised with 01.
6. **Fasting protein oxidation**: early-fast magnitude (Pox_0) and the lean/obese scaling of Pox_min are weakly
   sourced; the muscle vs visceral split of early N loss has no direct human data (grade D).
7. **Recomposition credit G_RT and f_E**: depend on dossier 09 values; Longland's large lean gain in a 40 % deficit
   is under-predicted — highly trained novelty, 4C-model water, or a stronger protein × RT synergy?
8. **Women and older adults** are under-represented in the protein dose-response and deficit studies (Morton notes
   far fewer data in women). No sex term beyond fat mass is included.
9. **Protein quality multipliers** (Q_meal) and adult-pattern DIAAS values are derived (pattern constants
   unverified here); whole-food matrix effects are ignored.
10. **Anabolic-resistance time-constants** (onset/recovery after step reduction or bed rest) are UNVERIFIED.
11. **Ketone effects** come from infusion studies (supraphysiological or inflammatory contexts); the size of
    protein sparing from nutritional ketosis per se is uncertain and early ketosis did *not* spare protein vs
    carbohydrate on a VLCD (Vazquez).
12. **Whole-body protein turnover** magnitude (≈4 g·kg⁻¹·d⁻¹) is quoted, not verified here.

---

## 11. References

1. Morton RW, Murphy KT, McKellar SR, et al. A systematic review, meta-analysis and meta-regression of the effect of protein supplementation on resistance training-induced gains in muscle mass and strength in healthy adults. Br J Sports Med. 2018;52(6):376-384. PMID 28698222. doi:10.1136/bjsports-2017-097608. https://pubmed.ncbi.nlm.nih.gov/28698222/
2. Nunes EA, Colenso-Semple L, McKellar SR, et al. Systematic review and meta-analysis of protein intake to support muscle mass and function in healthy adults. J Cachexia Sarcopenia Muscle. 2022;13(2):795-810. PMID 35187864. doi:10.1002/jcsm.12922. https://pubmed.ncbi.nlm.nih.gov/35187864/
3. Tagawa R, Watanabe D, Ito K, et al. Dose-response relationship between protein intake and muscle mass increase: a systematic review and meta-analysis of randomized controlled trials. Nutr Rev. 2021;79(1):66-75 (online 2020). PMID 33300582. doi:10.1093/nutrit/nuaa104. https://pubmed.ncbi.nlm.nih.gov/33300582/
4. Schoenfeld BJ, Aragon AA, Krieger JW. The effect of protein timing on muscle strength and hypertrophy: a meta-analysis. J Int Soc Sports Nutr. 2013;10(1):53. PMID 24299050. doi:10.1186/1550-2783-10-53. https://pubmed.ncbi.nlm.nih.gov/24299050/
5. Schoenfeld BJ, Aragon A, Wilborn C, Urbina SL, Hayward SE, Krieger J. Pre- versus post-exercise protein intake has similar effects on muscular adaptations. PeerJ. 2017;5:e2825. PMID 28070459. doi:10.7717/peerj.2825. https://pubmed.ncbi.nlm.nih.gov/28070459/
6. Helms ER, Zinn C, Rowlands DS, Brown SR. A systematic review of dietary protein during caloric restriction in resistance trained lean athletes: a case for higher intakes. Int J Sport Nutr Exerc Metab. 2014;24(2):127-138. PMID 24092765. doi:10.1123/ijsnem.2013-0054. https://pubmed.ncbi.nlm.nih.gov/24092765/
7. Longland TM, Oikawa SY, Mitchell CJ, Devries MC, Phillips SM. Higher compared with lower dietary protein during an energy deficit combined with intense exercise promotes greater lean mass gain and fat mass loss: a randomized trial. Am J Clin Nutr. 2016;103(3):738-746. PMID 26817506. doi:10.3945/ajcn.115.119339. https://pubmed.ncbi.nlm.nih.gov/26817506/
8. Pasiakos SM, Cao JJ, Margolis LM, et al. Effects of high-protein diets on fat-free mass and muscle protein synthesis following weight loss: a randomized controlled trial. FASEB J. 2013;27(9):3837-3847. PMID 23739654. doi:10.1096/fj.13-230227. https://pubmed.ncbi.nlm.nih.gov/23739654/
9. Mettler S, Mitchell N, Tipton KD. Increased protein intake reduces lean body mass loss during weight loss in athletes. Med Sci Sports Exerc. 2010;42(2):326-337. PMID 19927027. doi:10.1249/MSS.0b013e3181b2ef8e. https://pubmed.ncbi.nlm.nih.gov/19927027/
10. Hector AJ, Phillips SM. Protein recommendations for weight loss in elite athletes: a focus on body composition and performance. Int J Sport Nutr Exerc Metab. 2018;28(2):170-177. PMID 29182451. doi:10.1123/ijsnem.2017-0273. https://pubmed.ncbi.nlm.nih.gov/29182451/
11. Murphy CH, Churchward-Venne TA, Mitchell CJ, et al. Hypoenergetic diet-induced reductions in myofibrillar protein synthesis are restored with resistance training and balanced daily protein ingestion in older men. Am J Physiol Endocrinol Metab. 2015;308(9):E734-E743. PMID 25738784. doi:10.1152/ajpendo.00550.2014. https://pubmed.ncbi.nlm.nih.gov/25738784/
12. Krieger JW, Sitren HS, Daniels MJ, Langkamp-Henken B. Effects of variation in protein and carbohydrate intake on body mass and composition during energy restriction: a meta-regression. Am J Clin Nutr. 2006;83(2):260-274. PMID 16469983. doi:10.1093/ajcn/83.2.260. https://pubmed.ncbi.nlm.nih.gov/16469983/
13. Wycherley TP, Moran LJ, Clifton PM, Noakes M, Brinkworth GD. Effects of energy-restricted high-protein, low-fat compared with standard-protein, low-fat diets: a meta-analysis of randomized controlled trials. Am J Clin Nutr. 2012;96(6):1281-1298. PMID 23097268. doi:10.3945/ajcn.112.044321. https://pubmed.ncbi.nlm.nih.gov/23097268/
14. Kim JE, O'Connor LE, Sands LP, Slebodnik MB, Campbell WW. Effects of dietary protein intake on body composition changes after weight loss in older adults: a systematic review and meta-analysis. Nutr Rev. 2016;74(3):210-224. PMID 26883880. doi:10.1093/nutrit/nuv065. https://pubmed.ncbi.nlm.nih.gov/26883880/
15. Hudson JL, Wang Y, Bergia RE III, Campbell WW. Protein intake greater than the RDA differentially influences whole-body lean mass responses to purposeful catabolic and anabolic stressors: a systematic review and meta-analysis. Adv Nutr. 2020;11(3):548-558. PMID 31794597. doi:10.1093/advances/nmz106. https://pubmed.ncbi.nlm.nih.gov/31794597/
16. Weinheimer EM, Sands LP, Campbell WW. A systematic review of the separate and combined effects of energy restriction and exercise on fat-free mass in middle-aged and older adults: implications for sarcopenic obesity. Nutr Rev. 2010;68(7):375-388. PMID 20591106. doi:10.1111/j.1753-4887.2010.00298.x. https://pubmed.ncbi.nlm.nih.gov/20591106/
17. Chaston TB, Dixon JB, O'Brien PE. Changes in fat-free mass during significant weight loss: a systematic review. Int J Obes (Lond). 2007;31(5):743-750. PMID 17075583. doi:10.1038/sj.ijo.0803483. https://pubmed.ncbi.nlm.nih.gov/17075583/
18. Heymsfield SB, Gonzalez MC, Shen W, Redman L, Thomas D. Weight loss composition is one-fourth fat-free mass: a critical review and critique of this widely cited rule. Obes Rev. 2014;15(4):310-321. PMID 24447775. doi:10.1111/obr.12143. https://pubmed.ncbi.nlm.nih.gov/24447775/
19. Hall KD. What is the required energy deficit per unit weight loss? Int J Obes (Lond). 2008;32(3):573-576. PMID 17848938. doi:10.1038/sj.ijo.0803720. https://pubmed.ncbi.nlm.nih.gov/17848938/
20. Murphy C, Koehler K. Energy deficiency impairs resistance training gains in lean mass but not strength: a meta-analysis and meta-regression. Scand J Med Sci Sports. 2022;32(1):125-137. PMID 34623696. doi:10.1111/sms.14075. https://pubmed.ncbi.nlm.nih.gov/34623696/
21. Garthe I, Raastad T, Refsnes PE, Koivisto A, Sundgot-Borgen J. Effect of two different weight-loss rates on body composition and strength and power-related performance in elite athletes. Int J Sport Nutr Exerc Metab. 2011;21(2):97-104. PMID 21558571. doi:10.1123/ijsnem.21.2.97. https://pubmed.ncbi.nlm.nih.gov/21558571/
22. Vink RG, Roumans NJ, Arkenbosch LA, Mariman EC, van Baak MA. The effect of rate of weight loss on long-term weight regain in adults with overweight and obesity. Obesity (Silver Spring). 2016;24(2):321-327. PMID 26813524. doi:10.1002/oby.21346. https://pubmed.ncbi.nlm.nih.gov/26813524/
23. Carbone JW, McClung JP, Pasiakos SM. Recent advances in the characterization of skeletal muscle and whole-body protein responses to dietary protein and exercise during negative energy balance. Adv Nutr. 2019;10(1):70-79. PMID 30596808. doi:10.1093/advances/nmy087. https://pubmed.ncbi.nlm.nih.gov/30596808/
24. Pasiakos SM, Vislocky LM, Carbone JW, et al. Acute energy deprivation affects skeletal muscle protein synthesis and associated intracellular signaling proteins in physically active adults. J Nutr. 2010;140(4):745-751. PMID 20164371. doi:10.3945/jn.109.118372. https://pubmed.ncbi.nlm.nih.gov/20164371/
25. Areta JL, Burke LM, Camera DM, et al. Reduced resting skeletal muscle protein synthesis is rescued by resistance exercise and protein ingestion following short-term energy deficit. Am J Physiol Endocrinol Metab. 2014;306(8):E989-E997. PMID 24595305. doi:10.1152/ajpendo.00590.2013. https://pubmed.ncbi.nlm.nih.gov/24595305/
26. Hector AJ, Marcotte GR, Churchward-Venne TA, et al. Whey protein supplementation preserves postprandial myofibrillar protein synthesis during short-term energy restriction in overweight and obese adults. J Nutr. 2015;145(2):246-252. PMID 25644344. doi:10.3945/jn.114.200832. https://pubmed.ncbi.nlm.nih.gov/25644344/
27. Hector AJ, McGlory C, Damas F, Mazara N, Baker SK, Phillips SM. Pronounced energy restriction with elevated protein intake results in no change in proteolysis and reductions in skeletal muscle protein synthesis that are mitigated by resistance exercise. FASEB J. 2018;32(1):265-275. PMID 28899879. doi:10.1096/fj.201700158RR. https://pubmed.ncbi.nlm.nih.gov/28899879/
28. Moore DR, Churchward-Venne TA, Witard O, et al. Protein ingestion to stimulate myofibrillar protein synthesis requires greater relative protein intakes in healthy older versus younger men. J Gerontol A Biol Sci Med Sci. 2015;70(1):57-62. PMID 25056502. doi:10.1093/gerona/glu103. https://pubmed.ncbi.nlm.nih.gov/25056502/
29. Witard OC, Jackman SR, Breen L, Smith K, Selby A, Tipton KD. Myofibrillar muscle protein synthesis rates subsequent to a meal in response to increasing doses of whey protein at rest and after resistance exercise. Am J Clin Nutr. 2014;99(1):86-95. PMID 24257722. doi:10.3945/ajcn.112.055517. https://pubmed.ncbi.nlm.nih.gov/24257722/
30. Macnaughton LS, Wardle SL, Witard OC, et al. The response of muscle protein synthesis following whole-body resistance exercise is greater following 40 g than 20 g of ingested whey protein. Physiol Rep. 2016;4(15):e12893. PMID 27511985. doi:10.14814/phy2.12893. https://pubmed.ncbi.nlm.nih.gov/27511985/
31. Trommelen J, van Lieshout GAA, Nyakayiru J, et al. The anabolic response to protein ingestion during recovery from exercise has no upper limit in magnitude and duration in vivo in humans. Cell Rep Med. 2023;4(12):101324. PMID 38118410. doi:10.1016/j.xcrm.2023.101324. https://pubmed.ncbi.nlm.nih.gov/38118410/
32. Atherton PJ, Etheridge T, Watt PW, et al. Muscle full effect after oral protein: time-dependent concordance and discordance between human muscle protein synthesis and mTORC1 signaling. Am J Clin Nutr. 2010;92(5):1080-1088. PMID 20844073. doi:10.3945/ajcn.2010.29819. https://pubmed.ncbi.nlm.nih.gov/20844073/
33. Bohé J, Low JF, Wolfe RR, Rennie MJ. Latency and duration of stimulation of human muscle protein synthesis during continuous infusion of amino acids. J Physiol. 2001;532(Pt 2):575-579. PMID 11306673. doi:10.1111/j.1469-7793.2001.0575f.x. https://pubmed.ncbi.nlm.nih.gov/11306673/
34. Churchward-Venne TA, Burd NA, Mitchell CJ, et al. Supplementation of a suboptimal protein dose with leucine or essential amino acids: effects on myofibrillar protein synthesis at rest and following resistance exercise in men. J Physiol. 2012;590(11):2751-2765. PMID 22451437. doi:10.1113/jphysiol.2012.228833. https://pubmed.ncbi.nlm.nih.gov/22451437/
35. Churchward-Venne TA, Breen L, Di Donato DM, et al. Leucine supplementation of a low-protein mixed macronutrient beverage enhances myofibrillar protein synthesis in young men: a double-blind, randomized trial. Am J Clin Nutr. 2014;99(2):276-286. PMID 24284442. doi:10.3945/ajcn.113.068775. https://pubmed.ncbi.nlm.nih.gov/24284442/
36. Holwerda AM, Paulussen KJM, Overkamp M, et al. Dose-dependent increases in whole-body net protein balance and dietary protein-derived amino acid incorporation into myofibrillar protein during recovery from resistance exercise in older men. J Nutr. 2019;149(2):221-230. PMID 30722014. doi:10.1093/jn/nxy263. https://pubmed.ncbi.nlm.nih.gov/30722014/
37. Kim IY, Schutzler S, Schrader A, et al. The anabolic response to a meal containing different amounts of protein is not limited by the maximal stimulation of protein synthesis in healthy young adults. Am J Physiol Endocrinol Metab. 2016;310(1):E73-E80. PMID 26530155. doi:10.1152/ajpendo.00365.2015. https://pubmed.ncbi.nlm.nih.gov/26530155/
38. Areta JL, Burke LM, Ross ML, et al. Timing and distribution of protein ingestion during prolonged recovery from resistance exercise alters myofibrillar protein synthesis. J Physiol. 2013;591(9):2319-2331. PMID 23459753. doi:10.1113/jphysiol.2012.244897. https://pubmed.ncbi.nlm.nih.gov/23459753/
39. Mamerow MM, Mettler JA, English KL, et al. Dietary protein distribution positively influences 24-h muscle protein synthesis in healthy adults. J Nutr. 2014;144(6):876-880. PMID 24477298. doi:10.3945/jn.113.185280. https://pubmed.ncbi.nlm.nih.gov/24477298/
40. Kim IY, Schutzler S, Schrader A, et al. Quantity of dietary protein intake, but not pattern of intake, affects net protein balance primarily through differences in protein synthesis in older adults. Am J Physiol Endocrinol Metab. 2015;308(1):E21-E28. PMID 25352437. doi:10.1152/ajpendo.00382.2014. https://pubmed.ncbi.nlm.nih.gov/25352437/
41. Kim IY, Schutzler S, Schrader AM, et al. Protein intake distribution pattern does not affect anabolic response, lean body mass, muscle strength or function over 8 weeks in older adults: a randomized-controlled trial. Clin Nutr. 2018;37(2):488-493. PMID 28318687. doi:10.1016/j.clnu.2017.02.020. https://pubmed.ncbi.nlm.nih.gov/28318687/
42. Yasuda J, Tomita T, Arimitsu T, Fujita S. Evenly distributed protein intake over 3 meals augments resistance exercise-induced muscle hypertrophy in healthy young men. J Nutr. 2020;150(7):1845-1851. PMID 32321161. doi:10.1093/jn/nxaa101. https://pubmed.ncbi.nlm.nih.gov/32321161/
43. Hudson JL, Bergia RE III, Campbell WW. Protein distribution and muscle-related outcomes: does the evidence support the concept? Nutrients. 2020;12(5):1441. PMID 32429355. doi:10.3390/nu12051441. https://pubmed.ncbi.nlm.nih.gov/32429355/
44. Moro T, Tinsley G, Bianco A, et al. Effects of eight weeks of time-restricted feeding (16/8) on basal metabolism, maximal strength, body composition, inflammation, and cardiovascular risk factors in resistance-trained males. J Transl Med. 2016;14(1):290. PMID 27737674. doi:10.1186/s12967-016-1044-0. https://pubmed.ncbi.nlm.nih.gov/27737674/
45. Tinsley GM, Forsse JS, Butler NK, et al. Time-restricted feeding in young men performing resistance training: a randomized controlled trial. Eur J Sport Sci. 2017;17(2):200-207. PMID 27550719. doi:10.1080/17461391.2016.1223173. https://pubmed.ncbi.nlm.nih.gov/27550719/
46. Tinsley GM, Moore ML, Graybeal AJ, et al. Time-restricted feeding plus resistance training in active females: a randomized trial. Am J Clin Nutr. 2019;110(3):628-640. PMID 31268131. doi:10.1093/ajcn/nqz126. https://pubmed.ncbi.nlm.nih.gov/31268131/
47. Stote KS, Baer DJ, Spears K, et al. A controlled trial of reduced meal frequency without caloric restriction in healthy, normal-weight, middle-aged adults. Am J Clin Nutr. 2007;85(4):981-988. PMID 17413096. doi:10.1093/ajcn/85.4.981. https://pubmed.ncbi.nlm.nih.gov/17413096/
48. Lowe DA, Wu N, Rohdin-Bibby L, et al. Effects of time-restricted eating on weight loss and other metabolic parameters in women and men with overweight and obesity: the TREAT randomized clinical trial. JAMA Intern Med. 2020;180(11):1491-1499. PMID 32986097. doi:10.1001/jamainternmed.2020.4153. https://pubmed.ncbi.nlm.nih.gov/32986097/
49. Templeman I, Smith HA, Chowdhury E, et al. A randomized controlled trial to isolate the effects of fasting and energy restriction on weight loss and metabolic health in lean adults. Sci Transl Med. 2021;13(598):eabd8034. PMID 34135111. doi:10.1126/scitranslmed.abd8034. https://pubmed.ncbi.nlm.nih.gov/34135111/
50. Schroor MM, Joris PJ, Plat J, Mensink RP. Effects of intermittent energy restriction compared with those of continuous energy restriction on body composition and cardiometabolic risk markers — a systematic review and meta-analysis of randomized controlled trials in adults. Adv Nutr. 2024;15(1):100130. PMID 37827491. doi:10.1016/j.advnut.2023.10.003. https://pubmed.ncbi.nlm.nih.gov/37827491/
51. Res PT, Groen B, Pennings B, et al. Protein ingestion before sleep improves postexercise overnight recovery. Med Sci Sports Exerc. 2012;44(8):1560-1569. PMID 22330017. doi:10.1249/MSS.0b013e31824cc363. https://pubmed.ncbi.nlm.nih.gov/22330017/
52. Kouw IW, Holwerda AM, Trommelen J, et al. Protein ingestion before sleep increases overnight muscle protein synthesis rates in healthy older men: a randomized controlled trial. J Nutr. 2017;147(12):2252-2261. PMID 28855419. doi:10.3945/jn.117.254532. https://pubmed.ncbi.nlm.nih.gov/28855419/
53. Snijders T, Res PT, Smeets JS, et al. Protein ingestion before sleep increases muscle mass and strength gains during prolonged resistance-type exercise training in healthy young men. J Nutr. 2015;145(6):1178-1184. PMID 25926415. doi:10.3945/jn.114.208371. https://pubmed.ncbi.nlm.nih.gov/25926415/
54. Reis CEG, Loureiro LMR, Roschel H, da Costa THM. Effects of pre-sleep protein consumption on muscle-related outcomes — a systematic review. J Sci Med Sport. 2021;24(2):177-182. PMID 32811763. doi:10.1016/j.jsams.2020.07.016. https://pubmed.ncbi.nlm.nih.gov/32811763/
55. Herreman L, Nommensen P, Pennings B, Laus MC. Comprehensive overview of the quality of plant- and animal-sourced proteins based on the digestible indispensable amino acid score. Food Sci Nutr. 2020;8(10):5379-5391. PMID 33133540. doi:10.1002/fsn3.1809. https://pubmed.ncbi.nlm.nih.gov/33133540/
56. Mathai JK, Liu Y, Stein HH. Values for digestible indispensable amino acid scores (DIAAS) for some dairy and plant proteins may better describe protein quality than values calculated using the concept for protein digestibility-corrected amino acid scores (PDCAAS). Br J Nutr. 2017;117(4):490-499. PMID 28382889. doi:10.1017/S0007114517000125. https://pubmed.ncbi.nlm.nih.gov/28382889/
57. Gorissen SHM, Crombag JJR, Senden JMG, et al. Protein content and amino acid composition of commercially available plant-based protein isolates. Amino Acids. 2018;50(12):1685-1695. PMID 30167963. doi:10.1007/s00726-018-2640-5. https://pubmed.ncbi.nlm.nih.gov/30167963/
58. Pinckaers PJM, Trommelen J, Snijders T, van Loon LJC. The anabolic response to plant-based protein ingestion. Sports Med. 2021;51(Suppl 1):59-74. PMID 34515966. doi:10.1007/s40279-021-01540-8. https://pubmed.ncbi.nlm.nih.gov/34515966/
59. Messina M, Lynch H, Dickinson JM, Reed KE. No difference between the effects of supplementing with soy protein versus animal protein on gains in muscle mass and strength in response to resistance exercise. Int J Sport Nutr Exerc Metab. 2018;28(6):674-685. PMID 29722584. doi:10.1123/ijsnem.2018-0071. https://pubmed.ncbi.nlm.nih.gov/29722584/
60. Lim MT, Pan BJ, Toh DWK, Sutanto CN, Kim JE. Animal protein versus plant protein in supporting lean mass and muscle strength: a systematic review and meta-analysis of randomized controlled trials. Nutrients. 2021;13(2):661. PMID 33670701. doi:10.3390/nu13020661. https://pubmed.ncbi.nlm.nih.gov/33670701/
61. Hevia-Larraín V, Gualano B, Longobardi I, et al. High-protein plant-based diet versus a protein-matched omnivorous diet to support resistance training adaptations: a comparison between habitual vegans and omnivores. Sports Med. 2021;51(6):1317-1330. PMID 33599941. doi:10.1007/s40279-021-01434-9. https://pubmed.ncbi.nlm.nih.gov/33599941/
62. Jackman SR, Witard OC, Philp A, Wallis GA, Baar K, Tipton KD. Branched-chain amino acid ingestion stimulates muscle myofibrillar protein synthesis following resistance exercise in humans. Front Physiol. 2017;8:390. PMID 28638350. doi:10.3389/fphys.2017.00390. https://pubmed.ncbi.nlm.nih.gov/28638350/
63. Wolfe RR. Branched-chain amino acids and muscle protein synthesis in humans: myth or reality? J Int Soc Sports Nutr. 2017;14:30. PMID 28852372. doi:10.1186/s12970-017-0184-9. https://pubmed.ncbi.nlm.nih.gov/28852372/
64. Oikawa SY, McGlory C, D'Souza LK, et al. A randomized controlled trial of the impact of protein supplementation on leg lean mass and integrated muscle protein synthesis during inactivity and energy restriction in older persons. Am J Clin Nutr. 2018;108(5):1060-1068. PMID 30289425. doi:10.1093/ajcn/nqy193. https://pubmed.ncbi.nlm.nih.gov/30289425/
65. Oikawa SY, Macinnis MJ, Tripp TR, McGlory C, Baker SK, Phillips SM. Lactalbumin, not collagen, augments muscle protein synthesis with aerobic exercise. Med Sci Sports Exerc. 2020;52(6):1394-1403. PMID 31895298. doi:10.1249/MSS.0000000000002253. https://pubmed.ncbi.nlm.nih.gov/31895298/
66. Zdzieblik D, Oesser S, Baumstark MW, Gollhofer A, König D. Collagen peptide supplementation in combination with resistance training improves body composition and increases muscle strength in elderly sarcopenic men: a randomised controlled trial. Br J Nutr. 2015;114(8):1237-1245. PMID 26353786. doi:10.1017/S0007114515002810. https://pubmed.ncbi.nlm.nih.gov/26353786/
67. Phillips SM, Tipton KD, Aarsland A, Wolf SE, Wolfe RR. Mixed muscle protein synthesis and breakdown after resistance exercise in humans. Am J Physiol. 1997;273(1 Pt 1):E99-E107. PMID 9252485. doi:10.1152/ajpendo.1997.273.1.E99. https://pubmed.ncbi.nlm.nih.gov/9252485/
68. Phillips SM, Tipton KD, Ferrando AA, Wolfe RR. Resistance training reduces the acute exercise-induced increase in muscle protein turnover. Am J Physiol. 1999;276(1):E118-E124. PMID 9886957. doi:10.1152/ajpendo.1999.276.1.E118. https://pubmed.ncbi.nlm.nih.gov/9886957/
69. MacDougall JD, Gibala MJ, Tarnopolsky MA, MacDonald JR, Interisano SA, Yarasheski KE. The time course for elevated muscle protein synthesis following heavy resistance exercise. Can J Appl Physiol. 1995;20(4):480-486. PMID 8563679. doi:10.1139/h95-038. https://pubmed.ncbi.nlm.nih.gov/8563679/
70. Tang JE, Perco JG, Moore DR, Wilkinson SB, Phillips SM. Resistance training alters the response of fed state mixed muscle protein synthesis in young men. Am J Physiol Regul Integr Comp Physiol. 2008;294(1):R172-R178. PMID 18032468. doi:10.1152/ajpregu.00636.2007. https://pubmed.ncbi.nlm.nih.gov/18032468/
71. Burd NA, Holwerda AM, Selby KC, et al. Resistance exercise volume affects myofibrillar protein synthesis and anabolic signalling molecule phosphorylation in young men. J Physiol. 2010;588(Pt 16):3119-3130. PMID 20581041. doi:10.1113/jphysiol.2010.192856. https://pubmed.ncbi.nlm.nih.gov/20581041/
72. Burd NA, West DW, Moore DR, et al. Enhanced amino acid sensitivity of myofibrillar protein synthesis persists for up to 24 h after resistance exercise in young men. J Nutr. 2011;141(4):568-573. PMID 21289204. doi:10.3945/jn.110.135038. https://pubmed.ncbi.nlm.nih.gov/21289204/
73. Damas F, Phillips SM, Libardi CA, et al. Resistance training-induced changes in integrated myofibrillar protein synthesis are related to hypertrophy only after attenuation of muscle damage. J Physiol. 2016;594(18):5209-5222. PMID 27219125. doi:10.1113/JP272472. https://pubmed.ncbi.nlm.nih.gov/27219125/
74. Vendelbo MH, Møller AB, Christensen B, et al. Fasting increases human skeletal muscle net phenylalanine release and this is associated with decreased mTOR signaling. PLoS One. 2014;9(7):e102031. PMID 25020061. doi:10.1371/journal.pone.0102031. https://pubmed.ncbi.nlm.nih.gov/25020061/
75. Pozefsky T, Tancredi RG, Moxley RT, Dupre J, Tobin JD. Effects of brief starvation on muscle amino acid metabolism in nonobese man. J Clin Invest. 1976;57(2):444-449. PMID 1254728. doi:10.1172/JCI108295. https://pubmed.ncbi.nlm.nih.gov/1254728/
76. Forbes GB, Drenick EJ. Loss of body nitrogen on fasting. Am J Clin Nutr. 1979;32(8):1570-1574. PMID 463798. doi:10.1093/ajcn/32.8.1570. https://pubmed.ncbi.nlm.nih.gov/463798/
77. Owen OE, Smalley KJ, D'Alessio DA, Mozzoli MA, Dawson EK. Protein, fat, and carbohydrate requirements during starvation: anaplerosis and cataplerosis. Am J Clin Nutr. 1998;68(1):12-34. PMID 9665093. doi:10.1093/ajcn/68.1.12. https://pubmed.ncbi.nlm.nih.gov/9665093/
78. Owen OE, Felig P, Morgan AP, Wahren J, Cahill GF Jr. Liver and kidney metabolism during prolonged starvation. J Clin Invest. 1969;48(3):574-583. PMID 5773093. doi:10.1172/JCI106016. https://pubmed.ncbi.nlm.nih.gov/5773093/
79. Felig P, Owen OE, Wahren J, Cahill GF Jr. Amino acid metabolism during prolonged starvation. J Clin Invest. 1969;48(3):584-594. PMID 5773094. doi:10.1172/JCI106017. https://pubmed.ncbi.nlm.nih.gov/5773094/
80. Laurens C, Grundler F, Damiot A, et al. Is muscle and protein loss relevant in long-term fasting in healthy men? A prospective trial on physiological adaptations. J Cachexia Sarcopenia Muscle. 2021;12(6):1690-1703. PMID 34668663. doi:10.1002/jcsm.12766. https://pubmed.ncbi.nlm.nih.gov/34668663/
81. Sherwin RS, Hendler RG, Felig P. Effect of ketone infusions on amino acid and nitrogen metabolism in man. J Clin Invest. 1975;55(6):1382-1390. PMID 1133179. doi:10.1172/JCI108057. https://pubmed.ncbi.nlm.nih.gov/1133179/
82. Nair KS, Welle SL, Halliday D, Campbell RG. Effect of beta-hydroxybutyrate on whole-body leucine kinetics and fractional mixed skeletal muscle protein synthesis in humans. J Clin Invest. 1988;82(1):198-205. PMID 3392207. doi:10.1172/JCI113570. https://pubmed.ncbi.nlm.nih.gov/3392207/
83. Thomsen HH, Rittig N, Johannsen M, et al. Effects of 3-hydroxybutyrate and free fatty acids on muscle protein kinetics and signaling during LPS-induced inflammation in humans: anticatabolic impact of ketone bodies. Am J Clin Nutr. 2018;108(4):857-867. PMID 30239561. doi:10.1093/ajcn/nqy170. https://pubmed.ncbi.nlm.nih.gov/30239561/
84. Hoffer LJ, Bistrian BR, Young VR, Blackburn GL, Matthews DE. Metabolic effects of very low calorie weight reduction diets. J Clin Invest. 1984;73(3):750-758. PMID 6707202. doi:10.1172/JCI111268. https://pubmed.ncbi.nlm.nih.gov/6707202/
85. Vazquez JA, Adibi SA. Protein sparing during treatment of obesity: ketogenic versus nonketogenic very low calorie diet. Metabolism. 1992;41(4):406-414. PMID 1556948. doi:10.1016/0026-0495(92)90076-m. https://pubmed.ncbi.nlm.nih.gov/1556948/
86. Breen L, Stokes KA, Churchward-Venne TA, et al. Two weeks of reduced activity decreases leg lean mass and induces "anabolic resistance" of myofibrillar protein synthesis in healthy elderly. J Clin Endocrinol Metab. 2013;98(6):2604-2612. PMID 23589526. doi:10.1210/jc.2013-1502. https://pubmed.ncbi.nlm.nih.gov/23589526/
87. Wall BT, Dirks ML, Snijders T, Senden JM, Dolmans J, van Loon LJ. Substantial skeletal muscle loss occurs during only 5 days of disuse. Acta Physiol (Oxf). 2014;210(3):600-611. PMID 24168489. doi:10.1111/apha.12190. https://pubmed.ncbi.nlm.nih.gov/24168489/
88. Wall BT, Dirks ML, Snijders T, et al. Short-term muscle disuse lowers myofibrillar protein synthesis rates and induces anabolic resistance to protein ingestion. Am J Physiol Endocrinol Metab. 2016;310(2):E137-E147. PMID 26578714. doi:10.1152/ajpendo.00227.2015. https://pubmed.ncbi.nlm.nih.gov/26578714/
89. Beals JW, Sukiennik RA, Nallabelli J, et al. Anabolic sensitivity of postprandial muscle protein synthesis to the ingestion of a protein-dense food is reduced in overweight and obese young adults. Am J Clin Nutr. 2016;104(4):1014-1022. PMID 27604771. doi:10.3945/ajcn.116.130385. https://pubmed.ncbi.nlm.nih.gov/27604771/
90. Beals JW, Skinner SK, McKenna CF, et al. Altered anabolic signalling and reduced stimulation of myofibrillar protein synthesis after feeding and resistance exercise in people with obesity. J Physiol. 2018;596(21):5119-5133. PMID 30113718. doi:10.1113/JP276210. https://pubmed.ncbi.nlm.nih.gov/30113718/
91. Kortebein P, Ferrando A, Lombeida J, Wolfe R, Evans WJ. Effect of 10 days of bed rest on skeletal muscle in healthy older adults. JAMA. 2007;297(16):1772-1774. PMID 17456818. doi:10.1001/jama.297.16.1772-b. https://pubmed.ncbi.nlm.nih.gov/17456818/ (research letter; numerical results not verified in this review)
92. Bray GA, Smith SR, de Jonge L, et al. Effect of dietary protein content on weight gain, energy expenditure, and body composition during overeating: a randomized controlled trial. JAMA. 2012;307(1):47-55. PMID 22215165. doi:10.1001/jama.2011.1918. https://pubmed.ncbi.nlm.nih.gov/22215165/
93. Antonio J, Peacock CA, Ellerbroek A, Fromhoff B, Silver T. The effects of consuming a high protein diet (4.4 g/kg/d) on body composition in resistance-trained individuals. J Int Soc Sports Nutr. 2014;11:19. PMID 24834017. doi:10.1186/1550-2783-11-19. https://pubmed.ncbi.nlm.nih.gov/24834017/
94. Antonio J, Ellerbroek A, Silver T, et al. A high protein diet (3.4 g/kg/d) combined with a heavy resistance training program improves body composition in healthy trained men and women — a follow-up investigation. J Int Soc Sports Nutr. 2015;12:39. PMID 26500462. doi:10.1186/s12970-015-0100-0. https://pubmed.ncbi.nlm.nih.gov/26500462/
95. Antonio J, Ellerbroek A, Silver T, et al. A high protein diet has no harmful effects: a one-year crossover study in resistance-trained males. J Nutr Metab. 2016;2016:9104792. PMID 27807480. doi:10.1155/2016/9104792. https://pubmed.ncbi.nlm.nih.gov/27807480/
96. Weigle DS, Breen PA, Matthys CC, et al. A high-protein diet induces sustained reductions in appetite, ad libitum caloric intake, and body weight despite compensatory changes in diurnal plasma leptin and ghrelin concentrations. Am J Clin Nutr. 2005;82(1):41-48. PMID 16002798. doi:10.1093/ajcn.82.1.41. https://pubmed.ncbi.nlm.nih.gov/16002798/
97. Gosby AK, Conigrave AD, Lau NS, et al. Testing protein leverage in lean humans: a randomised controlled experimental study. PLoS One. 2011;6(10):e25929. PMID 22022472. doi:10.1371/journal.pone.0025929. https://pubmed.ncbi.nlm.nih.gov/22022472/
98. Westerterp KR. Diet induced thermogenesis. Nutr Metab (Lond). 2004;1(1):5. PMID 15507147. doi:10.1186/1743-7075-1-5. https://pubmed.ncbi.nlm.nih.gov/15507147/
99. Veldhorst MA, Westerterp-Plantenga MS, Westerterp KR. Gluconeogenesis and energy expenditure after a high-protein, carbohydrate-free diet. Am J Clin Nutr. 2009;90(3):519-526. PMID 19640952. doi:10.3945/ajcn.2009.27834. https://pubmed.ncbi.nlm.nih.gov/19640952/
100. Devries MC, Sithamparapillai A, Brimble KS, Banfield L, Morton RW, Phillips SM. Changes in kidney function do not differ between healthy adults consuming higher- compared with lower- or normal-protein diets: a systematic review and meta-analysis. J Nutr. 2018;148(11):1760-1775. PMID 30383278. doi:10.1093/jn/nxy197. https://pubmed.ncbi.nlm.nih.gov/30383278/
101. Shams-White MM, Chung M, Du M, et al. Dietary protein and bone health: a systematic review and meta-analysis from the National Osteoporosis Foundation. Am J Clin Nutr. 2017;105(6):1528-1543. PMID 28404575. doi:10.3945/ajcn.116.145110. https://pubmed.ncbi.nlm.nih.gov/28404575/
102. Bilsborough S, Mann N. A review of issues of dietary protein intake in humans. Int J Sport Nutr Exerc Metab. 2006;16(2):129-152. PMID 16779921. doi:10.1123/ijsnem.16.2.129. https://pubmed.ncbi.nlm.nih.gov/16779921/
103. Fromentin C, Tomé D, Nau F, et al. Dietary proteins contribute little to glucose production, even under optimal gluconeogenic conditions in healthy humans. Diabetes. 2013;62(5):1435-1442. PMID 23274906. doi:10.2337/db12-1208. https://pubmed.ncbi.nlm.nih.gov/23274906/
104. Johnstone AM, Horgan GW, Murison SD, Bremner DM, Lobley GE. Effects of a high-protein ketogenic diet on hunger, appetite, and weight loss in obese men feeding ad libitum. Am J Clin Nutr. 2008;87(1):44-55. PMID 18175736. doi:10.1093/ajcn/87.1.44. https://pubmed.ncbi.nlm.nih.gov/18175736/
105. Rand WM, Pellett PL, Young VR. Meta-analysis of nitrogen balance studies for estimating protein requirements in healthy adults. Am J Clin Nutr. 2003;77(1):109-127. PMID 12499330. doi:10.1093/ajcn/77.1.109. https://pubmed.ncbi.nlm.nih.gov/12499330/
106. Humayun MA, Elango R, Ball RO, Pencharz PB. Reevaluation of the protein requirement in young men with the indicator amino acid oxidation technique. Am J Clin Nutr. 2007;86(4):995-1002. PMID 17921376. doi:10.1093/ajcn/86.4.995. https://pubmed.ncbi.nlm.nih.gov/17921376/
107. Bandegan A, Courtney-Martin G, Rafii M, Pencharz PB, Lemon PW. Indicator amino acid-derived estimate of dietary protein requirement for male bodybuilders on a nontraining day is several-fold greater than the current Recommended Dietary Allowance. J Nutr. 2017;147(5):850-857. PMID 28179492. doi:10.3945/jn.116.236331. https://pubmed.ncbi.nlm.nih.gov/28179492/
108. Mazzulla M, Abou Sawan S, Williamson E, et al. Protein intake to maximize whole-body anabolism during postexercise recovery in resistance-trained men with high habitual intakes is severalfold greater than the current Recommended Dietary Allowance. J Nutr. 2020;150(3):505-511. PMID 31618421. doi:10.1093/jn/nxz249. https://pubmed.ncbi.nlm.nih.gov/31618421/
109. Bauer J, Biolo G, Cederholm T, et al. Evidence-based recommendations for optimal dietary protein intake in older people: a position paper from the PROT-AGE Study Group. J Am Med Dir Assoc. 2013;14(8):542-559. PMID 23867520. doi:10.1016/j.jamda.2013.05.021. https://pubmed.ncbi.nlm.nih.gov/23867520/
110. Janssen I, Heymsfield SB, Wang ZM, Ross R. Skeletal muscle mass and distribution in 468 men and women aged 18-88 yr. J Appl Physiol. 2000;89(1):81-88. PMID 10904038. doi:10.1152/jappl.2000.89.1.81. https://pubmed.ncbi.nlm.nih.gov/10904038/
111. Wang Z, Deurenberg P, Wang W, Pietrobelli A, Baumgartner RN, Heymsfield SB. Hydration of fat-free body mass: review and critique of a classic body-composition constant. Am J Clin Nutr. 1999;69(5):833-841. PMID 10232621. doi:10.1093/ajcn/69.5.833. https://pubmed.ncbi.nlm.nih.gov/10232621/
112. Greenhaff PL, Karagounis LG, Peirce N, et al. Disassociation between the effects of amino acids and insulin on signaling, ubiquitin ligases, and protein turnover in human muscle. Am J Physiol Endocrinol Metab. 2008;295(3):E595-E604. PMID 18577697. doi:10.1152/ajpendo.90411.2008. https://pubmed.ncbi.nlm.nih.gov/18577697/
113. Abdulla H, Smith K, Atherton PJ, Idris I. Role of insulin in the regulation of human skeletal muscle protein synthesis and breakdown: a systematic review and meta-analysis. Diabetologia. 2016;59(1):44-55. PMID 26404065. doi:10.1007/s00125-015-3751-0. https://pubmed.ncbi.nlm.nih.gov/26404065/
114. Tipton KD, Hamilton DL, Gallagher IJ. Assessing the role of muscle protein breakdown in response to nutrition and exercise in humans. Sports Med. 2018;48(Suppl 1):53-64. PMID 29368185. doi:10.1007/s40279-017-0845-5. https://pubmed.ncbi.nlm.nih.gov/29368185/
115. Hall KD. Body fat and fat-free mass inter-relationships: Forbes's theory revisited. Br J Nutr. 2007;97(6):1059-1063. PMID 17367567. doi:10.1017/S0007114507691946. https://pubmed.ncbi.nlm.nih.gov/17367567/ (cited for the Forbes framework; formula taken from [18,19])
116. Wolfe RR. The underappreciated role of muscle in health and disease. Am J Clin Nutr. 2006;84(3):475-482. PMID 16960159. doi:10.1093/ajcn/84.3.475. https://pubmed.ncbi.nlm.nih.gov/16960159/
117. Waterlow JC. Whole-body protein turnover in humans — past, present, and future. Annu Rev Nutr. 1995;15:57-92. PMID 8527232. doi:10.1146/annurev.nu.15.070195.000421. https://pubmed.ncbi.nlm.nih.gov/8527232/
118. Kortebein P, Symons TB, Ferrando A, et al. Functional impact of 10 days of bed rest in healthy older adults. J Gerontol A Biol Sci Med Sci. 2008;63(10):1076-1081. PMID 18948558. doi:10.1093/gerona/63.10.1076. https://pubmed.ncbi.nlm.nih.gov/18948558/
