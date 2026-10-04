# 20 — Extended water-only fasting (24 h → 3 weeks, single and repeated): time course, body-composition accounting, refeeding, repeat-fast protocols, safety

Dossier owner: research agent 20. Status: complete draft (2026-09-30).
Regime definition used throughout: **water-only fast** = water (plain, mineral or with electrolytes/essential micronutrients),
**0 kcal and 0 g protein**; black coffee/tea allowed as a flagged modifier (§4.12). Dry fasting is excluded (§4.13).
"Modified fasts" (Buchinger ≈ 200–250 kcal/d with 25–60 g carbohydrate; fasting-mimicking diets) are *not* water-only
and are flagged every time they are used as evidence. Conventions as in 01: kcal, g, kg, days (d) or hours (h).
"[n]" = reference in §11. "PROPOSED FIT" = our equation fitted to the cited points. "MODEL" = output of the reference
implementation in §4B (Python, scratch run 2026-09-30). "UNVERIFIED" = not confirmed from a primary source here.
"DERIVED" = arithmetic on published numbers.

Cross-references (read with): 01 (Hall 2010 core), 02 (EE/adaptive thermogenesis), 03 (protein/MPS; has a
fasting branch that this dossier **supersedes for water-only fasts**, see §4.4.6), 04 (glycogen), 05 (ketone kinetics —
owner of BHB), 07 (hour-by-hour 0–72 h, reference functions), 08 (autophagy index, IGF-1), 12 (hormones/appetite),
13 (transitions, water transients, periodisation verdicts), 15 (sodium/fluids), 17 (safety tiers T1–T5), 19
(performance), 21 (intervention catalogue).

---

## 1. Scope

- The physiology of **zero-energy, zero-protein** fasts from 24 h to 21 d (and the rules to extrapolate to ~6 wk):
  energy expenditure, fuel mix, ketosis, **protein/nitrogen economy and its fat-mass-dependent sparing**, water and sodium,
  hormones and blood markers, function, refeeding and what is kept, with day-by-day numbers by sex and adiposity.
- The **engine overlay** needed so that an hourly Hall-2010-based engine (01) behaves correctly at zero intake for many
  consecutive days, and after refeeding, including **repeated fasts with carry-over** (§4B).
- Evidence-graded **verdicts for repeated/periodic fasting** vs an isocaloric continuous deficit (§4C) and safety notes
  per duration tier (§9; rule engine owned by 17).
- Out of lane: hourly 0–72 h reference functions (07), ketone kinetic model (05), glycogen kinetics (04), PSMF/VLCD
  (13), rule thresholds and UI copy (17).

### Headline conclusions (for the orchestrator)

1. **Weight loss** of water-only fasting in normal-weight adults: ≈1.0–1.2 kg/d for days 1–3, ≈0.5 kg/d days 4–10,
   ≈0.3 kg/d in week 3; 7 d ≈ −5.7 to −5.8 kg (two Norwegian cohorts, n = 12 and 13) [3,4]; 10 d ≈ −7.3 kg (men) [8];
   21 d ≈ −10 kg (−15 %) [9]. MODEL reproduces these within ≈ ±1.3 kg (it under-predicts the two Chinese cohorts).
2. **Composition**: fat ≈ 190 g/d in a 75-kg lean man (≈ 150 g/d in a 60-kg woman), essentially constant, so fat is only
   **10 % of the loss on day 1, ≈ 23 % by day 7 and ≈ 35–40 % by day 21**. DXA "lean" losses of 3.6–4.6 kg at 7 d [3,4] are
   ≈ 35 % protein tissue, ≈ 25 % glycogen + water, ≈ 40 % extracellular water + gut contents (MODEL, consistent with
   urinary N 83.9 ± 6.7 g N/7 d [4]).
3. **Refeeding**: 3 days of ad-libitum eating after a 7-d fast restored DXA-lean from −3.6 to −0.69 kg while fat loss
   (−1.85 kg) persisted [3]. That rebound is glycogen + water + sodium, **not** protein re-synthesis: ≈ 0.4–0.55 kg protein
   (≈ 1.0–1.4 kg hydrated tissue) is still missing after 3 d (N-balance arithmetic, §4.6). Net fat retained ≈ 100 % of
   the fat oxidised, provided refeeding is not hyperphagic.
4. **RMR**: small rise days 1–3 (pooled ≈ +4 %; range −8 to +14 % across 7 studies [20–22,24,25,8,9]), back to baseline by
   day 4–5 [4,9], then −7.5 % (d9), −13.7 % (d15), −20.3 % (d20) [9]; −31 % by day 30 in a lean man [19]. The adaptive part
   (beyond tissue loss) scales with leanness (≈ −19 % lean, ≈ −7 % obese) (PROPOSED).
5. **Urinary N** peaks days 2–4 at ≈ 0.23–0.25 g N/kg FFM/d (≈ 14–15 g N/d in normal-weight men [33,4]) and then falls
   with a ≈ 8-d time-constant towards a floor set by **adiposity**: late protein ≈ 16–19 % of energy in lean people
   (Levanzin ≈ 7.7 g N/d at 60 kg [19]; constant P-ratio [36]) but only 5–7 % in obesity (≈ 3 g N/d in obese women
   in week 4 [33]; 0.27 g protein/kg/d [31]). **Protein sparing is weak in lean and strong in obese people** [34,35,36].
   Dossier 03's fasting branch (0.9 g/kg FFM/d at onset, τ 3 d) and 07's N floor (3.5 g/d for a 70-kg non-obese man)
   under-predict lean-person N loss by ≈ 1.5–2.5× — superseded by §4.4.
6. **BHB** (water-only): 0.3 mM at 24 h, ≈ 1.4–1.9 at 48 h, 2.3–2.7 at 72 h, ≈ 4 at day 6–8 (lab plasma [4,10]),
   ≈ 4.7–5.4 at days 5–15 and ≈ 6.0–6.6 at day 21 (capillary [9]); obesity halves early ketonaemia (48 h: 1.9 vs 3.7 mM [88]);
   Buchinger-type modified fasts plateau lower (≈ 4 mM at day 12 [17]). 07's week-2–3 values (4.0–4.6) are ≈ 1 mM low for
   true water-only fasts.
7. **Glucose** nadir 3.3–3.5 mM at day 3–4 then a slight rise to 3.7–3.9 [8,9]; CGM time < 3.9 mM rises to 66 % of the
   day by day 5 without symptoms [5]. **Uric acid** doubles (≈ 0.38 → 0.85–0.89 mmol/L by day 7–8 and plateaus) [9,10];
   **LDL-C rises** 23–66 % during 7–10-d water fasts [8,59] and reverses on refeeding [15]; **hsCRP +129 %** [15].
8. **Function**: maximal isometric/isokinetic leg strength unchanged after 6 d [4]; VO2peak −13 % (−7 % per kg) and
   high-intensity capacity down [4]; 24-h fast shortens high-intensity endurance [63]; isokinetic arm strength −10 % at
   3.5 d [61].
9. **Repeated fasts** give **no fat-loss or health advantage at equal weekly energy**, and in lean people cost more lean
   (ADF 0:150 vs 75 % daily: fat −0.74 vs −1.75 kg at similar weight loss, −1.60 vs −1.91 kg [65]); in obesity outcomes are ≈ equal [66,69].
   Multi-day fasts produce transient biomarker changes that are gone 3–4 months later [11]. Planner: fasts are *delivery
   patterns* of an energy deficit with a protein-cost penalty per fast start; no metabolic bonus.
10. **Safety**: supervised water-only stays (n = 768 visits, median 7 d): 72 % had only grade ≤ 2 AEs; cumulative
    incidence of any grade ≥ 3 AE 20 % by day 5 and 32 % by day 15 (largest category: hypertension in patients admitted
    for hypertension); 2 SAEs (0.26 %: dehydration day 3, hyponatraemia day 9, men aged 73 and 70)
    [13]. Tier rules in 17 are adopted.

---

## 2. State variables

Superset needed by the fasting overlay (§4B). States marked (01)/(04)/(05) are owned elsewhere and only *read* here.

| Name | Unit | Typical range | What it represents | Initial-value rule |
|---|---|---|---|---|
| `tFast` | h | 0–1000 | Hours since the last intake event > 50 kcal *or* > 5 g protein *or* > 5 g digestible carbohydrate (17 uses ≤ 50 kcal) | From schedule; burn-in (01) |
| `fastFlag` | bool | – | `tFast ≥ 12 h` **and** rolling 24-h intake < 10 % of maintenance → water-only branch active | derived |
| `S_N` | 0–1 | 0–1 | **Protein-sparing adaptation** (ketone-driven brain fuel switch + reduced gluconeogenic demand) | 0; persists across refeeds with τ_off (§4.4) |
| `A_SNS` | fraction | −0.08…+0.14 | Early sympathetic (noradrenaline) thermogenesis, days 1–4 | 0 |
| `s_AT` | 0–1 | 0–1 | Fasting-specific resting adaptive-thermogenesis progress (T3 fall, SNS withdrawal) | 0; relaxes on refeeding τ 4 d |
| `P_tis` | kg | −6…0 | Hydrated protein tissue lost since baseline (protein × (1 + h_P)) — maps onto 01's `P` | 0 |
| `D_lab` | g protein | 0–60 | **Labile protein deficit** repletable within days of refeeding (Forbes fast component) | 0 |
| `E_fast` | L (≈ kg) | −2.0…+2.0 | Fasting natriuresis + refeeding oedema term of extracellular fluid (adds to 01's ECF and 13's `E_cna`, see §4.5) | 0 |
| `M_gut` | kg | −0.6…0 | Gut-content deficit (fasting empties colon/small bowel) — scale weight and DXA-lean only | 0 |
| `G_L`, `G_M` (04) | g | 0–150; 100–700 | Liver / muscle glycogen | 04 |
| `BHB` (05) | mmol/L | 0.05–7 | Plasma β-hydroxybutyrate | 05 |
| `F`, `P`, `ECF` (01) | kg, kg, L | – | Fat, protein, extracellular fluid | 01 |
| `Na_p` (optional) | mmol/L | 128–145 | Plasma sodium drift index for hyponatraemia warnings (§4.5.4) | 140 |

Derived: urinary N (g/d), protein oxidised (g/d), fat oxidised (g/d), RQ, 'DXA-lean' change, fasting-day energy deficit.

---

## 3. Inputs that drive it

| Input | Unit | How it enters |
|---|---|---|
| Energy, protein and digestible carbohydrate intake (hourly) | kcal, g | Defines the fast; carbohydrate ≤ 100 g/d scales N loss (§4.4.4), ketonaemia (05) and natriuresis (§4.5); protein ends the zero-protein branch (03 takes over) |
| Sex, age, height, BW, %BF → FM, FFM | – | RMR0 (02), N-peak scaling by FFM, sparing floor by %BF, adaptive-thermogenesis magnitude by %BF, glucose offsets |
| Physical activity during the fast (steps, sessions) | kcal/d, type | TEE; exercise raises early ketonaemia (05) and lowers the protein share of oxidation (Hall S_A, 01); high-intensity work limited (§4.8) |
| Sodium, potassium, magnesium supplements; fluid volume | g/d, L/d | Natriuresis size, plasma-Na drift, orthostatic-symptom risk (§4.5, §4.12; limits in 17/15) |
| Caffeine / black coffee, tea, non-nutritive sweeteners | mg, servings | Small EE and ketone effects; do not break the fast (§4.12) |
| Exogenous ketones (ester/salt), MCT | g | Adds to BHB (05); N-sparing modifier (§4.4.4) — note ester/salt energy (≈ 4–6 kcal/g) technically ends a "zero-energy" fast |
| Refeeding composition (carbohydrate, sodium, protein, energy vs maintenance) | g, kcal | Rebound of glycogen, ECF (oedema), labile protein; refeeding-syndrome screen (17) |
| History: prior fasts (S_N, D_lab carry-over), prior very-low-carbohydrate diet (05's A_f) | – | Faster ketosis/sparing entry; smaller first-day water drop (13) |

---
## 4. Mechanisms & equations

### 4.0 Architecture: what the fasting overlay changes in the Hall-2010 core (read first)

Hall 2010 (01 §4.1) is validated for semistarvation and moderate restriction and, per 01, against 30-d fasts in obese
adults [1,2]. Run literally at zero intake it has three problems for fasts that start in normal-weight people:

| Hall 2010 term at CI = FI = PI = 0 | What it does | What the fasting data show | Overlay (this dossier) |
|---|---|---|---|
| Adaptive thermogenesis `T` (τ_T 7 d, λ1 0.74) | T* = −0.74 → FFM-linked RMR × (1 − 0.48·0.74) = **−35 %** and NEAT −38 % of their components; RMR ≈ −12 % already at day 5 (DERIVED) | RMR **+3 to +14 %** on days 2–3 [20,22,25,8], unchanged at day 5 [4], −7.5 % at day 9, −20 % at day 20 [9] | Replace resting AT during fasts with `A_SNS` (early rise) × (1 − φ_AT·s_AT) with a 2-d lag (§4.2); keep 02's NEAT term |
| Amino-acid gluconeogenesis `GNG_P = 300·[P/P_Keys + 0.39]` + ProtOx | ≈ 90 g protein/d (14 g N) **constant** — no sparing except slow P decline (DERIVED) | N peaks days 2–4 then falls 30–70 % depending on adiposity [19,33,31,4] | Override protein oxidation with the N model of §4.4 (`S_N`, FFM- and %BF-scaled) |
| ECF: `−(ξ_CI/ξ_Na)(1 − CI/CI_b)` = −1.33 L, τ 1.07 d | Carbohydrate-only natriuresis | Fasting natriuresis is larger than carbohydrate withdrawal alone (ketoacid anion excretion [45], insulin fall [80]); refeeding produces transient oedema | Use 13's `E_cna` with k_fast, **or** (if 13 not active) the `E_fast` term of §4.5 — never both on top of Hall's CI term (double counting) |
| Ketogenesis `KTG` (flux only) | Up to 0.8 × lipolysis; no concentration | BHB concentration and its plateau (≈ 17 d) | 05 owns concentration; §4.3.4 gives water-only targets |

Everything else in Hall 2010 (fat balance by energy closure, glycogen fluxes via 04, TEF = 0 at zero intake, synthesis
costs) is used unchanged. The overlay is active while `fastFlag` is true and hands back to 01/03 through relaxation
states (`S_N`, `s_AT`, `D_lab`, `E_fast`) so that repeated fasts and refeeds carry memory.

### 4.1 Definitions and the fasting clock

- A fast starts at the end of the absorptive period of the last meal (07 owns absorption; 4–6 h after a mixed meal).
  Studies count "day 1" from the last evening meal; reference tables here count days from the start of zero intake.
- Water-only branch criteria (PROPOSED): rolling 24-h intake < 10 % of maintenance **and** protein < 5 g/24 h **and**
  digestible carbohydrate < 10 g/24 h. Buchinger-type modified fasts (200–250 kcal, 25–60 g carbohydrate
  [7,12,17]) run the same branch with the carbohydrate modifiers of §4.4.4/§4.3.4 and 05; PSMF (protein ≥ 1.2 g/kg IBW)
  leaves the branch (03/13).
- Phase labels for the UI (not model switches): **post-absorptive** (4–24 h; liver glycogen supplies 36 % of glucose
  output in the first 22 h, 04), **gluconeogenic/early ketogenic** (24–72 h; highest N loss, RMR bump), **ketoadapting**
  (day 4–17; ketones plateau after ~17 d in obese subjects [30]), **protein-conserving** (≥ day 17; obese only reach the
  low-N floor). Fat-depletion "phase 3" (rising N when fat is exhausted, ≈ 10 % body fat per Laurens' summary of
  older work [7]) is a safety boundary, not a normal phase (§9).

### 4.2 Energy expenditure during total fasting

**Mechanism.** TEF disappears (≈ 10 % of intake). In the first 2–4 days falling glucose/insulin raise sympathetic
drive: noradrenaline doubles by day 4 [20], heart rate +6–7 bpm at 36–72 h [21], and RMR rises a few percent. From
day ~4 T3 falls (−30 % at 72 h [53]; −53 % with rT3 +58 % at 7–18 d [58]), leptin collapses (to ~10 % at 72 h [53]),
tissue mass falls and RMR declines progressively, more so in lean people. Spontaneous activity tends to fall
(fatigue is the commonest AE, 48 % [13]) but is behaviour-dependent.

**Data — early phase (days 1–5).**

| Study | Subjects | Time | RMR change vs fed/overnight | Notes |
|---|---|---|---|---|
| Zauner 2000 [20] | 11 lean | 84 h | 3.97 → 4.53 kJ/min day 1 → 3 (**+14 %**) | NA 1716 → 3728 pmol/L d1 → d4; glucose 4.9 → 3.5 mM |
| Webber & Macdonald 1994 [21] | 17 F, 12 M | 12/36/72 h | 4.60 → 4.88 kJ/min at 36 h (**+6 %**), 4.72 at 72 h (+2.6 %, NS) | RER 0.80 → 0.76 → 0.72; NA/adrenaline ↑ only at 72 h; same pattern in both sexes |
| Mansell 1990 [22] | 11 normal weight | 48 h | **+3.6 %** | Enhanced thermogenic response to adrenaline |
| Browning 2012 [25] | 9 F, 9 M | day 1 → 2 | VO2 202 → 222 mL/min (**+10 %**) | Sex difference disappears per kg lean mass |
| Dai 2022 [8] | 13 M, BMI 24.6 | day 3 | **+8.2 %** (+138 kcal/d, CI wide) | then −5.3 % at day 9 (NS) |
| Nair 1987 [24] | 6 young men | 3 d | **−8 %** | leucine oxidation +46 % |
| Dai 2024 [9] | 8 M, 5 F, BMI 24.5 | day 3 | NS | |
| Kolnes 2025 [4] | 7 M, 6 F, BMI 25.0 | day 5 | **no change** | RER 0.86 → 0.76 |
| Hollstein 2021 [71] | 77 (63 M), whole-room chamber | 24-h fast | 24-h EE −177 kcal/d vs energy balance (median) | ≈ loss of TEF; the "thrifty" half fell more |

Pooled early bump (unweighted mean of the 7 day-2–3 estimates) ≈ **+4 %**, SD ≈ 7 %; direction contested (grade C).

**Data — weeks 1–4.**

| Study | Subjects | Result |
|---|---|---|
| Dai 2024 [9] | 21-d water-only, 13 adults, 66 kg | REE vs baseline: d3 NS, **d9 −7.5 %, d15 −13.7 %, d20 −20.3 %** (max individual −53.9 %); ≈ 1306 kcal/d at d15; back to baseline 3 d after full refeeding |
| Laurens 2021 [7] | 10-d Buchinger (200–250 kcal), 16 men | BMR **−12 %** at d10, still significant after adjustment for lean soft tissue; BMR during refeeding and at 3 months lower but NS |
| Benedict 1915 (Levanzin) [19] | 31-d water-only, 1 lean man, 60.6 kg | Morning resting heat production 1,615 kcal/d (d1) → 1,109 (d30) (**−31 %**); night 24-h basis 1,441 → 1,025; fall to ~day 21–23, then constant; per kg 1.13 → 0.93 kcal/kg/h (−18 %) |
| Owen 1998 [31] | 5 obese, 21 d | Resting energy per kg body mass **constant** (i.e. RMR fell only in proportion to mass) |
| Speakman & Westerterp 2013 [46] (review) | – | "Owen et al. reported only −8 % (NS) after 18 d; Yang & Van Itallie no significant decrease after 10 d" (obese) |

**Equations (PROPOSED FIT; hourly, t = tFast/24 in days).**
```
RMR(t)   = [RMR0 + γ_P·ΔP_tis + γ_F·ΔF] · (1 + A_SNS(t)) · (1 − φ_AT · s_AT(t))
A_SNS(t) = a_SNS · (t / t_p) · exp(1 − t / t_p)                          // peak a_SNS at t_p, gone by ~day 7
ds_AT/dt = (1 − s_AT)/τ_AT    if fastFlag and t > t_lag                 // on: after 2-d lag
         = (0 − s_AT)/τ_AT,off otherwise                                 // off: refeeding
φ_AT     = clamp(0.25 − 0.004 · BF%, 0.05, 0.22)                         // leaner → larger adaptation
TEE      = RMR + PAE_user + AT_N(02) ;  TEF = 0 while intake = 0
```
| Symbol | Value | Unit | Range | Source / fit |
|---|---|---|---|---|
| RMR0 | from 02 (Mifflin default) | kcal/d | – | 02 |
| γ_P | 19 | kcal/kg hydrated protein tissue/d | 13–30 | Hall 2010 γ^_FFM [1]; early visceral losses would justify more (UNVERIFIED) |
| γ_F | 4.5 | kcal/kg/d | – | [1] |
| a_SNS | 0.05 | – | −0.08 … +0.14 | pooled early data above |
| t_p | 2.0 | d | 1.5–3 | peak at 36–72 h [20,21,25,8] |
| t_lag | 2 | d | 1–4 | no decline before day 4–5 [4,9] |
| τ_AT | 9 | d | 6–14 | fit to Dai 2024 d9/d15/d20 [9] |
| τ_AT,off | 4 | d | 3–7 | REE back to baseline ≈ 3 d after full refeed [9]; T3/rT3 normal within 1 wk of a mixed diet (13 [85]) |
| φ_AT | 0.19 (BF 15 %), 0.15 (25 %), 0.07 (45 %) | – | ±0.07 | Levanzin −31 % at d30 [19]; Dai 2024 −20 % at d20 [9]; Owen obese per-kg constant [31] |

Fit check (MODEL): lean man −9 % (d7), −13 % (d10), −21 % (d21); Dai-2024-like cohort d3 +2 %, d9 −10 %, d15 −15 %, d20
−17 % (obs NS/−7.5/−13.7/−20.3); Kolnes-like d5 −3 % (obs 0, NS); Levanzin-like d30 −24 % (obs −31 %).
**Relation to 02:** 02's resting AT (β_AT = 0.14 × ΔEI, 40 % resting, τ 7 d) gives ≈ −8 % of RMR at zero intake and has no
early rise. During `fastFlag` use **this** resting term *instead of* 02's AT_R (not in addition); keep 02's AT_N (NEAT
part, τ 14 d) because activity during fasts is user-specified and supervised fasters are usually sedentary.
**Evidence grade: C** (direction of early rise contested; ≤ 30 subjects per time point; late decline B for direction).

### 4.3 Fuel mix: glycogen, gluconeogenesis, lipolysis, ketones, brain fuel, RQ

#### 4.3.1 Glycogen (kinetics owned by 04)
- Liver: GNG supplies 64 ± 5 % of glucose output over the first 22 h, 82 ± 5 % over the next 14 h, 96 ± 1 % thereafter;
  04's first-order model (τ_L = 24 h, floor 5 g) gives ≈ 60–65 % depletion at 24 h and 85–90 % at 48 h (04 §4.2).
  "Liver glycogen is completely depleted after 24–36 h without food" (Kolnes' introduction [4]) is the round-number
  version.
- Muscle: overnight/24-h fasting barely touches resting muscle glycogen (04 §4.6; 24-h fast "no effect on resting
  muscle glycogen" in cyclists [63]); 20–30 % lower after 2–3 d (studies cited in [4]); **halved after 7 d**
  (408 ± 34 → 191 ± 13 mmol/kg protein, vastus lateralis, n = 13) with higher glycogen-synthase fractional activity [4].
- Fasting-specific muscle rate (PROPOSED FIT, replaces 04's fed-state k_Mr = 0.0035 h⁻¹ while `fastFlag`):
  `dG_M/dt = −k_Mf·(G_M − 0.35·G_M0)`, **k_Mf = 0.008 h⁻¹** → −29 % at 3 d, −48 % at 7 d, −64 % at 21 d (MODEL; data:
  −20–30 % at 2–3 d, −53 % at 7 d [4]). Carbon released goes to lactate → hepatic GNG (Cori), i.e. it is carbohydrate
  energy but appears as glucose output, not muscle CHO oxidation. Laurens assumed −90 % liver and −40 % muscle at 10 d [7].
- Glycogen water: 3 g/g (13) (Hall uses 2.7 [1]); potassium 0.45 mmol/g (04/13).
- Whole-body glycogen energy over a fast ≈ 1,300–1,900 kcal (75-kg man: 85 g liver + ≈ 280 g muscle by day 21; MODEL),
  i.e. **< 1 day of expenditure** — the reason fasting weight loss on day 1–2 is mostly not fat.
**Evidence grade: A−** for liver (13C-MRS, 04); **B** for the fasting muscle rate (one 7-d biopsy study + older 2–3-d data).

#### 4.3.2 Glucose production and gluconeogenic substrates
| Time | Glucose production | Composition | Source |
|---|---|---|---|
| 12 → 72 h | 11.0 → 8.3 µmol/kg/min (−25 %); glucose 5.58 → 4.14 mM | 70 % of the insulin fall within 24 h | Klein 1993 [27] |
| 60 h | 11.8 → 8.2 µmol/kg/min (≈ 150 g/d at 70 kg, DERIVED); glucose oxidation −85 % | lipolysis ×2.5; fat oxidation ≈ 75 % of REE; proteolysis and protein oxidation +50 % | Carlson 1994 [26] |
| 5–6 wk (obese) | ≈ **86 g/d**, half hepatic, half renal | all lactate, pyruvate, glycerol and amino-acid carbon taken up by liver/kidney → glucose | Owen 1969 [30] |
| 21 d (obese) | – | glycerol contributes as much to GNG as all amino acids combined; minimal glucose need 0.34 g/kg BW/d | Owen 1998 [31] |
Sex: glucose Ra identical in matched-adiposity women and men at 14 and 22 h [28]; whole-body and hepatic glucose/oxidative
responses identical at 48 h [25]. Grade **B** (tracer studies, small n).

#### 4.3.3 Lipolysis, FFA and fat oxidation
- Glycerol Ra 2.08 → 4.36 and palmitate Ra 1.63 → 3.26 µmol/kg/min from 12 to 72 h; **60 % of the rise occurs between
  12 and 24 h**, largest between 18 and 24 h [27]. FFA 0.43 → 1.55 mM (day 1 → 5) [51]; NEFA rise linearly for 10 d in a
  modified fast [7]. Women have higher post-absorptive glycerol Ra (2.1 vs 1.5 µmol/kg/min) but a blunted rise (+40 vs
  +80 %), equal by 22 h [28]; women's FFA 0.94 vs men 0.71 mM at 48 h [25].
- Lipolysis far exceeds net fat oxidation (re-esterification ×2.5 [26]); it is never rate-limiting for water-only fasts
  in the populations studied (01 §4.6 Alpert discussion).
- Fat oxidation in g/d is obtained by energy closure (§4B step 6): **≈ 180–195 g/d (lean man 75 kg), 145–157 g/d (lean
  woman 60 kg), ≈ 195 g/d (obese woman 100 kg), 225–240 g/d (obese man 115 kg)** (MODEL, Tables A1–A4). Direct checks:
  Kolnes: 1.4 ± 0.1 kg DXA fat in 7 d "≈ 1,800 kcal/d, nearly sufficient to supply the measured RMR" [4];
  maximal exercise fat oxidation doubled (≈ 0.4 → ≈ 0.8 g/min) at day 6 [4].
- RQ/RER: 0.80 (12 h) → 0.76 (36 h) → 0.72 (72 h) [21]; 0.86 → 0.76 at day 5 [4]; → ≈ 0.70 by day 9 and stable to day 21
  (some values < 0.70 attributed to gluconeogenesis/ketone retention) [9]. Carbohydrate oxidation ≈ 1/3 of pre-fast by
  day 3 and ≈ 10 % by day 9; lipid oxidation ≈ ×1.8 by day 3 [9].
**Evidence grade: B** (tracer and calorimetry studies, n = 6–18 per study; fat oxidation by closure is as good as the TEE
estimate).

#### 4.3.4 Ketones (concentration owned by 05) — water-only reference trajectory
| Time | BHB (mM) | Population / assay | Source |
|---|---|---|---|
| 24 h | 0.33 (F) / 0.41 (M) | 18 young adults, plasma | Browning 2012 [25] |
| 30 h | 0.9 (M) / 1.7 (F) | 20 adults | Haymond 1982 [87] (via 05) |
| 48 h | 1.22 (F) / 1.94 (M); lean 3.7 vs obese 1.9 (capillary) | plasma; capillary | [25]; Neudorf 2025 [88] |
| 52 h | 1.8 ± 0.4 | normal subjects | Boden 1996 [79] (via 13) |
| 72 h | 2.3 ± 0.5 (6 men); 2.23 (8 obese) | plasma; whole blood | McDougal 2018 [86]; Owen & Reichard 1971 [89] |
| day 1 → day 8 (strip) | 1.31 → peak 5.6 (day 8; plateau from day 5) | 13 men, capillary | Dai 2022 [8] |
| day 6 | 4.01 ± 0.30 (pre-exercise) → 2.90 after VO2peak test | 13 adults, plasma | Kolnes 2025 [4] |
| day 8 | 4.77 ± 0.70 | 12 men, plasma | Ogłodek 2021 [10] |
| days 5–9 / 10–15 / 15–21 / day 21 | 4.74 / 5.36 / 6.03 / 6.61 ± 1.25 | 13 adults, capillary | Dai 2024 [9] |
| day 24 (obese) | BHB 5.29, AcAc 1.52 (TKB 6.8) | whole blood | [89] (via 05) |
| Buchinger, day 12 | ≈ 4 | 32 subjects, capillary; 25–60 g/d carbohydrate | Grundler 2024 [17] |

PROPOSED reference curve (target for 05's kinetic model; t in hours since start of zero intake):
```
BHB_ref(t) = 0.08 + B1/(1 + exp(−(t − 44)/9)) + B2·(1 − exp(−max(0, t − 48)/τ2))
B1 = 2.2·(1 − 0.4·ob),  B2 = 3.7,  τ2 = 170 h·(1 + 0.5·ob),  ob = clamp((BF% − 25)/20, 0, 1)
× (1 − 0.4·clamp(CHO_g_per_day/60, 0, 1))          // modified fasts (Grundler: soup-only vs juice + honey [17])
```
Values (lean): 0.30 (24 h), 0.72 (36 h), 1.42 (48 h), 2.67 (72 h), 3.56 (d5), 4.15 (d7), 4.78 (d10), 5.30 (d14), 5.73
(d21); obese woman: 0.21, 0.46, 0.88, 1.68, 2.31, 2.79, 3.36, 3.90, 4.48. Sex: data conflict (women higher at 30 h [87],
lower at 48 h [25]) → no sex term here; 05's mechanistic handling (smaller glycogen capacity per brain demand in women)
governs. Exercise at the start of a fast brings ketosis forward (0.5 mM at 17.5 vs 21.1 h [90]) and more exercise
during a modified fast raised ketonaemia faster [17]; acute maximal exercise **lowers** BHB (4.0 → 2.9 mM) [4].
**Difference vs 07:** 07 (§4.4.1) lists 3.6 mM at 7 d, 4.0 at 10 d and 4.4–4.6 at 2–3 wk, anchored on modified fasts; for
true water-only fasts these are ≈ 0.5–1.3 mM low. **Difference vs 05:** 05's model gives 2.45 mM at 72 h (lean) and 4.99
at 24 d (obese) — consistent with this curve within its ±30 % tolerance.
Grade **B** to 72 h; **B/C** beyond (small cohorts, strip meters read high vs lab).

#### 4.3.5 Brain fuel switch
Catheter studies in 3 obese patients after 5–6 wk of fasting showed BHB and AcAc "replaced glucose as the predominant
fuel for brain metabolism" [29] (the widely quoted ≈ 60 % ketone share is from the full text — UNVERIFIED here);
whole-body glucose production then ≈ 86 g/d [30]. After 3.5 d, BHB influx into the brain rose > 10-fold with arterial
BHB, i.e. uptake is concentration-driven [64]. Cahill: this switch lets a 70-kg man survive 2–3 months rather than
weeks [32]. PROPOSED (grade C/D, only needed for display): brain ketone share = 0.8·BHB^1.5/(BHB^1.5 + 3^1.5) →
13 % at 1 mM, 40 % at 3 mM, 62 % at 6.7 mM.

### 4.4 Protein and nitrogen economy (core of lean-mass prediction)

**Mechanism.** With no dietary protein, all amino acids for gluconeogenesis, acute-phase and repair proteins come from
body protein. Early in a fast the brain still needs ≈ 100 g/d of glucose that glycerol (≈ 15–20 g/d) cannot supply,
so amino-acid gluconeogenesis and urinary N peak on days 1–4 (glucagon rises over the same days [33]). As ketones rise
the brain's glucose need falls (§4.3.5), ketones themselves restrain muscle alanine release and N loss [41], plasma
alanine falls [30], urea synthesis falls and ammonium (which accompanies ketoacid excretion, spares bicarbonate) becomes
a larger share of urinary N [43,44]. How far N falls depends on the size of the fat store: the obese reach a low floor
(protein ≈ 5–7 % of energy), the lean do not (protein stays ≈ 15–20 % of energy for weeks) [33,34,35,36].

#### 4.4.1 Data: urinary nitrogen during water-only fasts
| Study | Subjects | Urinary N (g/d) by day | Notes |
|---|---|---|---|
| Benedict 1915, Levanzin [19] | 1 lean man, 60.6 kg | d1 7.1, d2 8.4, d3 11.3, **d4 11.9** (max), d5–14 ≈ 10.2 (9.8–10.7), d15–19 8.5–9.6, d20–31 ≈ 7.7 (6.9–8.2); mean first 10 d > 10 g | 13.25 kg lost in 31 d: water 7.33, fat 3.65, protein 1.66, carbohydrate 0.20 kg; P-ratio ≈ constant [36] |
| Kolnes 2025 [4] | 7 M, 6 F, 79.6 kg, 23 % fat | ≈ 15 (d1) → ≈ 10 (d7); **cumulative 83.9 ± 6.7 g N/7 d** (= 524 ± 42 g protein) | N correlated with baseline lean mass (r = 0.85) |
| Göschke 1975 [33] | 12 M + 12 F ideal weight (6 d); 20 M + 28 F obese (6–28 d) | Rise day 1 → 3 then steady fall; **14.5 g/d** early in normal and obese men; **3.0 g/d** obese women in week 4 | Men > women at equal weight; protein 15 % of energy (normal men, 6 d) vs 5 % (obese women, week 4); early N rise coincides with glucagon rise |
| Ogłodek 2021 [10] | 12 men, 79 kg, 50 y | urinary urea 485 → 323 mmol/24 h (d8) ≈ 13.6 → 9.0 g urea-N (DERIVED) | serum urea unchanged |
| Owen 1998 [31] | 5 obese, 21 d | late aminogenic oxidation **7 % of energy**; minimal 0.27 ± 0.08 g AA/kg BW/d = 0.52 ± 0.10 g/kg FFM/d | fat and FFM lost in parallel |
| Forbes & Drenick 1979 [34] | pooled fasts | N loss / weight loss ≈ **20 g N/kg** (non-obese) vs ≈ **10 g N/kg** (FM ≥ 50 kg); body N falls bi-exponentially (fast component t½ a few days) | the fast component is the "labile protein" used in §4.9 |
| Elia 1999 [35] | review, lean vs obese | protein loss and % energy from protein **2–3× lower in obese** in prolonged starvation; % urinary N as urea 2× lower in obese; early hyperketonaemia 2× greater in lean | |
| Henry 1988 [36] | reanalysis of classic fasts in normal subjects | P-ratio (protein share of energy) **unchanged** during prolonged starvation; falling urinary N follows falling metabolic rate, not "specific sparing" | contests the Cahill sparing model for lean people |
| Laurens 2021 [7] | 16 men, Buchinger 200–250 kcal | total N −41 ± 7 % by day 5 then stable; plasma urea −41 %; plasma 3-methylhistidine ↑ to day 4–5 then back to baseline | modified fast (carbohydrate-sparing) |
| Bak 2016 [37] | 9 lean vs 9 obese, 72 h | obese: higher lipolysis, lower urea production and forearm muscle protein breakdown, persisting at 72 h | |
| Fisler 1982 [39] | 38 obese men, 60 d | cumulative N deficit on 400–500-kcal protein diets **60 % lower** than total fasting | |

#### 4.4.2 Equation (PROPOSED FIT) — urinary N during a water-only fast
```
t      = tFast/24 (d);  FFM = FFM0 + ΔP_tis (hydrated protein tissue lost);  BF% = current
rise   = 0.8 + 0.2·min(1, t/2.5)                                    // N rises from day 1 to day 3 [33,19]
n_pk   = 0.25 − 0.06·clamp((FM − 10)/40, 0, 1)                      // g N per kg FFM per d at the early peak
N_early = n_pk · FFM
pr_late = 0.04 + 0.22·exp(−BF%/15)                                  // protein share of TEE after adaptation [36,31,33]
N_late  = pr_late · TEE / 29.4                                      // 29.4 kcal per g N (4.7 kcal/g protein × 6.25)
S*      = clamp((BHB − 0.5)/3.5, 0, 1)                              // sparing drive from ketosis (05 supplies BHB)
dS_N/dt = (S* − S_N)/τ_N           τ_N = 8 d (on) ; τ_N,off = 3 d when S* < S_N (refeeding, PROPOSED)
N(t)    = [N_early·(1 − S_N) + N_late·S_N] · rise · C_carb · K_ket · K_ex
protein oxidised (g/d) = 6.25·N ;  ΔP_tis += −6.25·N·(1 + h_P)/1000 per day,  h_P = 1.6 (Hall [1])
```
| Symbol | Value | Unit | Uncertainty | Fitted to |
|---|---|---|---|---|
| n_pk | 0.25 (lean) → 0.19 (FM ≥ 50 kg) | g N/kg FFM/d | ±0.03 | 14.5 g/d normal & obese men [33]; 11.9 g/d Levanzin (FFM ≈ 52 kg) [19]; ≈ 15 g/d Kolnes day 1 (FFM ≈ 61 kg) [4] |
| pr_late | 0.19 (BF 8 %), 0.13 (15 %), 0.08 (25 %), 0.05 (45 %) | fraction of TEE | ±0.04 | Levanzin late ≈ 0.18–0.2 [19,36]; normal men 0.15 at 6 d [33]; obese women 0.05 wk 4 [33]; obese 0.07 at 21 d [31] |
| τ_N | 8 | d | 6–14 | Levanzin plateau to d14 then fall [19]; Kolnes 15 → 10 g/d over 7 d [4]; obese 14.5 → 3 g/d by wk 4 [33] |
| h_P | 1.6 | g water/g protein | 1.1–3.0 | Hall 2010 [1]; a whole-tissue value (≈ 4 g/g, 20 % protein) is used by Kolnes [4] — see §4.6.2 for why 1.6 fits refeeding DXA better |
Fit (MODEL): Kolnes-like cohort 90 g N/7 d (obs 83.9 ± 6.7), day-7 11.5 g/d (obs ≈ 10); Levanzin-like 289 g N/31 d
(obs 277; d4 12.2 vs 11.9, d10 9.7 vs 10.1, d20 8.1 vs 7.7, d30 8.1 vs 7.8); obese woman day 28 ≈ 3.8 g/d (obs 3.0 [33]); lean man
N/weight lost over 21 d = 23 g N/kg (Forbes: ≈ 20 [34]). Grade **B** for magnitudes and the lean/obese contrast, **C**
for the functional form (single lean subject for the late phase; one n = 13 cohort for day-by-day).

#### 4.4.3 Worked numbers (MODEL, protein oxidised g/d; urinary N in brackets)
| Day | Lean man 75 kg/15 % | Lean woman 60 kg/25 % | Obese woman 100 kg/45 % | Obese man 115 kg/35 % |
|---|---|---|---|---|
| 1 | 86 (13.8) | 60 (9.5) | 59 (9.5) | 84 (13.4) |
| 2 | 94 (15.0) | 65 (10.3) | 65 (10.3) | 91 (14.5) |
| 3 | 96 (15.3) | 65 (10.5) | 66 (10.6) | 92 (14.8) |
| 5 | 89 (14.3) | 59 (9.5) | 62 (9.9) | 85 (13.6) |
| 7 | 82 (13.1) | 53 (8.4) | 57 (9.2) | 76 (12.2) |
| 14 | 66 (10.6) | 38 (6.1) | 40 (6.4) | 51 (8.1) |
| 21 | 61 (9.7) | 32 (5.2) | 29 (4.6) | 39 (6.3) |
| 21-d total protein | 1.57 kg | 0.97 kg | 1.01 kg | 1.34 kg |
| Protein share of energy, day 21 | 16 % | 10 % | 7 % | 8 % |

#### 4.4.4 Moderators of N loss
- **Adiposity** (built in): lean people lose proportionally more protein [34,35,36]; obese reach a lower floor. Obesity
  also blunts muscle proteolytic signalling at 72 h (MuRF1 mRNA ↑ only in lean) [37].
- **Sex**: explained by FFM and %BF at equal weight ("greater N losses in men than women" [33]; N ∝ lean mass r = 0.85 [4]);
  no separate term (grade C).
- **Carbohydrate** (modified fasts, 7.5–100 g/d): `C_carb = 1 − 0.45·clamp(CHO/100, 0, 1)` (PROPOSED). Anchors: Hall's
  Γ_C = 0.39 (N −4 g/d on carbohydrate removal) [1]; at 600 kcal, 76–86 g/d vs 10 g/d carbohydrate halved cumulative
  N loss (≈ 51 → 26 g N/28 d) [81]; 7.5–15 g/d reduced urinary ammonium and ketoacid but **not urea** N [43]. Grade C.
  The classic statement that 100 g/d glucose halves fasting N loss (Gamble, life-raft studies) is UNVERIFIED here.
  Why it works: exogenous glucose covers part of the brain's ≈ 100 g/d glucose need that would otherwise come from
  amino-acid gluconeogenesis (glycerol supplies only ≈ 15–20 g/d), and the small insulin rise restrains proteolysis;
  the cost is lower ketonaemia (§4.3.4) and hence slower ketone-driven sparing — net N is still lower at 50–100 g/d [81].
- **Pre-fast carbohydrate loading** (full liver/muscle glycogen, higher insulin): delays the ketone rise by several hours
  (05: low-carbohydrate pre-fast meal advances ketosis ≈ 12 h in older adults) and slightly lowers day-1 amino-acid
  gluconeogenesis; in the model it acts only through 04/05 states (no separate term; grade D).
- **Protein** (any ≥ 5 g/d): leaves this branch; PSMF data (1.5 g/kg IBW → N balance ≈ 0 by week 3) are in 13/03.
  Protein-supplemented VLCDs cut N deficit by 60 % vs fasting [39], but 0.8 g/kg protein + 0.7 g/kg carbohydrate still
  gave −3.3 g N/d for 3 weeks [76].
- **Exogenous ketones**: BHB infusions in subjects fasted 5–10 wk lowered urinary N by 30 % [41]; leucine infusion
  reduced negative N balance by 25–30 % after 3 d and 4 wk of fasting [42]. `K_ket = 1 − 0.3·clamp(BHB_exo/1.5 mM, 0, 1)`
  (PROPOSED, grade C; note ketone esters/salts carry energy).
- **Exercise**: Hall 2010 lowers the protein share of oxidation with activity (S_A term) [1]; strength was maintained
  and leg strength rose in a 10-d modified fast with 3 h/d walking [7] and was preserved in a 12-d modified fast in
  older adults [18]. No human trial measured N or lean tissue with vs without **resistance training during a multi-day
  water fast** (searched Europe PMC 2026-09-30; none found). `K_ex = 1` (default); allowed range 0.9–1.0 for daily
  light activity (grade D).
- **Prior diet**: habitual very-low-carbohydrate eating (05's A_f ≈ 1) starts `S*` earlier (higher BHB on day 1–2) and
  shrinks the day-1–2 N peak in the model automatically; no direct human test found (grade D). A high-protein diet
  before the fast raises day-1 urinary N (urea-pool wash-out: Levanzin 17 g N/d on a beef diet before fasting [19]) but
  this is not tissue loss — the model excludes it by starting `rise` at 0.8.
- **Age**: no fasting-specific N data; older adults have less FFM (lower absolute N) and slower re-gain (03's anabolic
  resistance applies to refeeding). Grade D.
- **3-methylhistidine** (myofibrillar breakdown index): plasma 3-MH rose to day 4–5 then returned to baseline during a
  10-d modified fast [7]; urinary 3-MH did not change with leucine infusion in fasted subjects [42] — use only as a
  display cue for "early catabolic phase" (grade C).

#### 4.4.5 Where the lost protein comes from
72-h fasting doubles net forearm phenylalanine release and cuts muscle mTOR phosphorylation 40–50 % (08, Vendelbo 2014);
extremity lean mass fell 1.7 ± 0.5 kg (6 %) of a 4.6-kg DXA-lean loss at 7 d [4]; calf muscle volume −5.4 % at 12 d,
"closely aligned with expected losses of glycogen (1–2 %) and bound water (3–4 %)" [18]. Early losses include splanchnic
and labile protein (Forbes' fast component [34]). Allocation to use (PROPOSED, grade D, consistent with 03 §4.13):
60 % muscle / 40 % other lean tissue for days 0–3, 80 / 20 thereafter.

#### 4.4.6 Differences from dossiers 03 and 07 (explicit)
- **03 §4.13** fasting branch: Pox_0 = 0.9 g protein/kg FFM/d (≈ 8.2 g N/d at FFM 57 kg) with τ_N = 3 d and
  Pox_min = 0.52(1 + 0.5L) g/kg FFM/d. Water-only data show **12–15 g N/d (1.3–1.6 g protein/kg FFM/d) on days 2–4 in
  normal-weight adults** [33,4,19] and a slower decline (τ ≈ 8 d). 03's branch reproduces the 10-d *modified* fast
  (Laurens) but under-predicts water-only N loss by ≈ 1.5–1.8× in week 1. **Use §4.4.2 for water-only and modified
  fasts; keep 03 for PSMF/VLED.**
- **07 §4.4.3** `UrinaryN_gd`: peak 0.20 g N/kg FFM/d, decay τ 6 d to a floor of **3.5 g/d** applied to a 70-kg non-obese
  man (4.9 → 3.9 g/d in weeks 2–3). The 3.5-g floor is the obese-women week-4 value [33]; for lean/normal-weight people
  the floor is ≈ 7–10 g/d (Levanzin 7.7 g/d; P-ratio constant [36]). 07's weeks 2–3 N are ≈ 2× too low for lean users.
- **13 T25** (N balance −1 to −3 g/d early in VLCD/fast) refers to protein-fed VLCD, not water-only fasting.
- **07's hand-off request** (07 §4.5 asks 20 to adopt `UrinaryN(d)`, `ecwLoss(d)` and `REERel(τ)`): `REERel` is
  compatible with §4.2 (both give ≈ +4 % at 36–48 h and ≈ −12 to −13 % at day 10) and may be used for t < 72 h;
  `ecwLoss` (1.6 kg·BM/80, τ 3 d) is replaced by `E_fast` + `M_gut` (≈ 1.6–1.8 kg for 75–80 kg, τ 1–1.5 d) — same
  magnitude, faster onset matching the 1.1–1.2 kg/d day-1–3 losses [8,9]; `UrinaryN` is **not** adopted for water-only
  fasts because its 3.5-g/d floor and 0.20 g/kg FFM peak are obese/modified-fast anchors (its ×0.6 modified-fast
  multiplier remains a reasonable cross-check for Laurens). Recommendation to 07: replace `Nlate = 3.5 g/d` by §4.4.2's
  energy-fraction floor. 07's hunger offset (`Hfast`, peak ≈ 30 h, ≈ 0 by day 5) is adopted unchanged.

### 4.5 Water, sodium, gut contents: natriuresis of fasting and refeeding rebound

**Mechanism.** Low insulin, glucagon and obligatory cation excretion with ketoacid anions (sodium first, ammonium later)
cause a natriuresis in the first days of fasting [45,80]; glycogen releases its water; gut contents empty. On refeeding,
carbohydrate/insulin abruptly reverses sodium excretion [45,80], glycogen refills with water (muscle glycogen-synthase
activity is primed after fasting [4]) and oedema can overshoot after long fasts. Plasma Na drifts down when plain or
distilled water is drunk without solute (hyponatraemia SAE on day 9 [13]).

#### 4.5.1 Data
| Observation | Value | Source |
|---|---|---|
| Early weight loss | 0.9 kg/d in week 1 → 0.3 kg/d by week 3; "primarily negative sodium balance" | Kerndt 1982 [47] |
| Rate, days 1–3 / days 11–21 | 1.12–1.20 kg/d / 0.31 ± 0.07 kg/d | Dai 2022/2024 [8,9] |
| Natriuresis mechanism | 3-h increases in urinary Na⁺ + NH₄⁺ + K⁺ matched organic-acid anions + H₂PO₄⁻ (r = 0.89); NH₄⁺ progressively replaces Na⁺; Na loss ≫ Cl loss; glucose refeeding promptly cut Na excretion | Sigler 1975 [45] |
| Renal ketone conservation | BHB reabsorption 154 → 419–436 µmol/min from day 3 to days 10–24; conserves 450–500 mmol ketones/d, preventing large cation losses | Sapir & Owen 1975 [44] |
| Urinary electrolytes day 8 (mineral water ad lib) | Na 190 → 42.5 mmol/24 h; K 111 → 34 mmol/24 h; urine volume 2.35 → 1.38 L/d; uric-acid clearance 4.9 → 1.3 mL/min | Ogłodek 2021 [10] |
| Serum Na | 139.3 → 133.8 mmol/L at day 8 [10]; −2.5 % day 5, −4.5 % day 21 [9]; below 137 mmol/L by day 9 [8] | |
| Extracellular water loss, 10-d modified fast | −1.6 kg incl. enema-emptied faeces (44 % of lean-soft-tissue loss) | Laurens 2021 [7] |
| Total body water | −2.86 kg (BIA) at day 8 [10]; −11.4 % at day 6 (DXA-derived, TBW % unchanged) [8] | |
| Refeeding, 24-h fast → meals | ≈ +70 mEq Na/d retention ≈ +0.5 L/d | Heyman 2020 [80] (via 13) |
| Weight rebound after refeeding | +2.6 kg in 3 d ad lib after 7 d [3]; +3.8 kg in ≈ 8 d (4 d stepped + 4 d full diet) after 10 d [8]; +5.5 kg in 9 d after 21 d (1.28 kg/d at the switch to full diet, then 0.6 kg/d) [9]; only +1.3 kg over ≈ 6 d with salt-free whole-plant refeeding after 14 d [14]; +0.5 kg over ≈ 5 d after ≈ 10 d with the same protocol [15] | |
| Refeeding "lean" rebound | DXA-lean −3.6 → −0.69 kg in 3 d [3]; FFM −6.7 → −4.2 kg (end of refeed) → −2.1 kg (6 wk) [14]; LM ≈ −3 % of baseline 3 d into full refeeding after 21 d [9] | |

#### 4.5.2 Equations (PROPOSED FIT)
Use **one** natriuresis implementation. If 13's `E_cna` is active, set `k_fast = 0.5–1.0` there and skip `E_fast*`
below; otherwise:
```
During fastFlag:  E_fast* = −1.3 L · (ECF0 / 17 L)                   // ≈ Hall's zero-carbohydrate value [1]; ECF0 from 14/01
                  dE/dt = (E_fast* − E)/τ_down,  τ_down = 1.5 d
Gut:              dM_gut/dt = (−0.45 kg·(BW0/75)^0.5 − M_gut)/1 d    // colon ≈ 0.56 L when fasted (13); stool/food residue
On refeeding (digestible CHO ≥ 100 g/d and Na ≥ 1.5 g/d):
                  E → 0 with τ_up = 0.7 d  (13; +0.5 L/d antinatriuresis [80]);  M_gut → 0 with τ = 1 d
Refeeding oedema overshoot (after fasts > 3 d):
                  E_oed(t_r) = A_oed·(1 − e^(−t_r/2 d))·e^(−t_r/10 d),  A_oed = min(2.0 L, 0.08 L·(fast days − 3))
Salt-free or < 50 g CHO refeeding: τ_up × 3 and A_oed × 0.3 (PROPOSED, from [14,15] vs [3,9])
```
MODEL check (refeeding at pre-fast maintenance energy, ≈ 50 % carbohydrate): end-of-fast ECF + gut ≈ −1.3 to −2.2 kg
(Tables A); rebound +3.0 kg by day 3 after a 7-d fast (obs +2.6 ± 0.6 [3]); +3.2 kg by day 8 after 10 d (obs +3.8 [8]);
+3.5 kg by day 9 after 21 d (obs **+5.5** [9]). After ≥ 2-wk fasts ad-libitum refeeding therefore regains ≈ 2 kg more than
the labile compartments explain — most plausibly hyperphagia (fat, glycogen supercompensation, gut) plus larger oedema;
the engine should take refeed intake from the schedule/appetite module (12) rather than assume maintenance. Grade **C**
(mechanism A; magnitudes from few cohorts with different refeed diets).

#### 4.5.3 What 'DXA lean' measures during a fast
DXA/BIA "lean" = protein tissue + glycogen + its water + ECF + gut contents. In fasting this compartment shrinks for
reasons that reverse in days, so **DXA-lean falls ≈ 2–3× faster than protein tissue** and DXA-fat change is under-estimated
while hydration is abnormal (fat appears to keep falling during refeeding: −1.6 → −1.85 kg [3]; FM −2.0 kg at the end
of a 14-d fast but a further −1.3 kg during 6 d of refeeding and −1.8 kg by 6 wk [14]; FM −10.7 % at day 6 → −17.2 % 5 d
after refeeding [8]). The engine must output fat by energy closure and report a separate "DXA-lean-equivalent" =
ΔP_tis + Δ(glycogen + water) + E + M_gut for validation.

#### 4.5.4 Plasma sodium drift (warning index only)
`dNa_p/dt = −0.7 mmol/L/d · (1 − clamp(Na_suppl_g/2.0, 0, 1)) · I[fluid > 2.5 L/d ? 1.3 : 1]` for days 1–10, then −0.15
mmol/L/d (PROPOSED fit to −5.4 mmol/L at day 8 [10] and −4.5 % at day 21 [9]; supplementation effect UNVERIFIED).
Warn below 133 mmol/L, hard-warn below 130 (thresholds: 17/15).

### 4.6 Composition of weight lost by fast length, and what is kept after refeeding

#### 4.6.1 Observed data
| Study (fast) | n, population | Δ body weight | Fat | "Lean" (method) | After refeeding |
|---|---|---|---|---|---|
| Hollstein 2021 [71] (24 h, chamber) | 77 | – | – | – | 24-h EE −177 kcal/d |
| Templeman 2021 [65] (24-h fasts on alternate days, 3 wk, 150 % on fed days = −25 % net) | 12 lean | −1.60 ± 1.06 kg | −0.74 ± 1.32 kg (DXA) | ≈ −0.86 kg non-fat (DERIVED) | vs daily 75 %: −1.91 kg, fat −1.75 kg |
| Pietzner 2024 [3] (7 d water) | 12 (5 F), 77.5 kg, BMI 25.4 | −5.7 ± 0.8 kg (SEM) | −1.6 ± 1.3 kg (DXA); subcutaneous −0.21, visceral −0.07 (NS) | −3.6 ± 0.49 kg (DXA lean) | +3 d ad lib: weight −3.1 ± 0.6, **lean −0.69 ± 0.49, fat −1.85 ± 0.34 kg** |
| Kolnes 2025 [4] (7 d water) | 13 (6 F), 79.6 kg, 23 % fat | −5.8 ± 0.3 kg (−7.5 %) | −1.4 ± 0.1 kg (−8.4 %) | −4.6 ± 0.3 kg (−8.0 %) (DXA); urinary N ≡ 524 g protein ≈ 2.6 kg tissue at 20 % protein | – |
| Ogłodek 2021 [10] (8 d water) | 12 men, 79.4 kg, 50 y | −5.96 kg | −2.06 kg (BIA) | FFM −4.04 kg; TBW −2.86 kg | – |
| Dai 2022 [8] (10 d water) | 13 men, 72.1 kg, BMI 24.6 | −7.28 ± 1.46 kg (−9.8 %) | −10.7 % (day 6), −17.2 % 5 d after refeeding (DXA) | −9.2 % (day 6); back to baseline 5 d after refeeding | −3.45 kg ≈ 8 d after end |
| Laurens 2021 [7] (10 d Buchinger 200–250 kcal) | 16 men, BMI 26.2 | −5.9 ± 0.2 kg (−7 %) | −2.3 kg (40 %) | −3.53 kg lean soft tissue = ECW 1.6 (44 %), glycogen + water 0.50 (14 %), active tissue 1.5 (42 %) | 3 months: body mass and lean soft tissue lower, **fat mass not** |
| Commissati 2025 [15] (9.8 ± 3.1 d water) | 20 (11 F), 86.6 kg, 52 y | women −6.3 ± 1.7, men −6.9 ± 2.2 kg (−7.6/−7.8 %) | – | – | after 5.3 d plant refeed: −6.1 kg |
| Gabriel 2025 [14] (median 14 d water) | 29 (23 F), 62 y, BMI 31 | −8.8 kg | −2.0 kg (DXA) | FFM −6.7 kg (**74.5 % of loss**) | end of refeed (≈ 6 d): BW −7.5, FFM −4.2, FM −3.3; 6 wk: BW −7.2, **FFM −2.1, FM −5.1 kg (67 % of loss)** |
| Dai 2024 [9] (21 d water) | 13 (5 F), 66.3 kg, BMI 24.5 | −10.0 ± 1.66 kg (−15.0 %) | −15.9 % (DXA; % fat unchanged) | proportional to fat | 9 d after end: −4.53 kg; FM still −15.9 %, LM −3.1 % |
| Benedict 1915 [19] (31 d water) | 1 lean man, 60.6 kg | −13.25 kg | 3.65 kg fat | water 7.33, protein 1.66, carbohydrate 0.20 kg (balance method) | – |
| Wilhelmi de Toledo 2019 [12] (Buchinger, 5.4 / 8.6 / 14.1 / 20.1 d) | 1422 | −3.2 kg (5 d) … −8.6 ± 0.3 kg (20 d) | – | – | – |
| Ezpeleta 2024 review [11] (5–20 d) | 11 trials | −2 % to −10 % | "≈ 1/3" | "≈ 2/3" | benefits gone 3–4 months later even when weight maintained |

**What Ezpeleta's "two-thirds lean" means [11]:** it is derived from only two water-only studies with body composition —
Ogłodek (BIA: 6 kg lost, 2 kg fat, 4 kg lean) and Dai 2022 (DXA: 7 kg, 3 kg, 4 kg) — both measured at the end of the fast,
when "lean" contains glycogen, glycogen water, extracellular water and gut contents. It is **not** a statement about
muscle or protein: by N balance only ≈ 25–35 % of the DXA-lean loss at 7–10 d is hydrated protein tissue (MODEL; Laurens'
own partition gives 42 % [7]), and most of the rest returns within days of refeeding [3,14].

#### 4.6.2 Accounting reconciliation (why h_P = 1.6 and a separate labile protein pool)
- Kolnes 7 d: N-protein 0.524 kg. With h_P = 1.6 the hydrated protein tissue is 1.36 kg; glycogen + water ≈ 1.1 kg; ECF +
  gut ≈ 1.7 kg → DXA-lean ≈ 4.2 kg (obs 4.6 ± 0.3). With a whole-tissue ratio (≈ 5 g/g) protein tissue would be 2.6 kg and
  DXA-lean 5.4 kg (over-predicts).
- Pietzner +3 d refeed: glycogen, ECF and gut return (+2.8 kg), protein does not re-synthesise within 3 d except a
  labile fraction. MODEL with h_P = 1.6 and a 0.75 g/kg FFM labile pool: DXA-lean −1.0 kg (7 M/5 F mix; obs −0.69 ±
  0.49); with h_P = 3–4: −2 kg (too negative). Hence: **use h_P = 1.6 for protein tissue and treat the extra early water
  loss as ECF/labile water** (Benedict's 7.33 kg water in 31 d includes ≈ 1.4 kg that was re-retained after day 11 [19]).
- Energy closure for Pietzner: fat 1.6–1.85 kg × 9.44 + protein ≈ 0.5 kg × 4.7 + glycogen ≈ 0.35 kg × 4.18 ≈ 19–21 Mcal /
  7 d ≈ 2,700–3,000 kcal/d (DERIVED) — plausible for free-living young adults; consistent with MODEL TEE 2,300–2,600.

#### 4.6.3 MODEL composition by fast length and after refeeding
Refeeding assumption: pre-fast maintenance energy from the day after the fast (≈ 50 % carbohydrate, ≥ 1.2 g/kg protein,
normal salt), labile protein pool 0.75 g/kg FFM repleted with τ 2 d, glycogen supercompensation +10 % (UNVERIFIED), oedema
term as §4.5.2. "Fat share" = fat / total weight lost at the end of the fast.

**Lean man**

| Fast length | ΔBW end of fast kg | fat | protein tissue | glycogen + water | ECF + gut | fat share of loss | protein lost g | ΔBW +3 d refeed | fat +3 d | 'DXA-lean' +3 d | ΔBW +7 d | ΔBW +14 d |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 d | -1.6 | -0.17 | -0.22 | -0.40 | -0.85 | 10 % | 83 | -0.2 | -0.26 | 0.0 | -0.2 | -0.2 |
| 2 d | -2.7 | -0.35 | -0.45 | -0.64 | -1.24 | 13 % | 173 | -0.7 | -0.47 | -0.2 | -0.6 | -0.6 |
| 3 d | -3.5 | -0.54 | -0.70 | -0.80 | -1.43 | 16 % | 269 | -1.1 | -0.66 | -0.5 | -1.1 | -1.0 |
| 5 d | -4.7 | -0.93 | -1.18 | -1.01 | -1.56 | 20 % | 454 | -1.9 | -1.04 | -0.9 | -1.8 | -1.8 |
| 7 d | -5.7 | -1.31 | -1.63 | -1.15 | -1.59 | 23 % | 625 | -2.6 | -1.41 | -1.2 | -2.5 | -2.6 |
| 10 d | -7.0 | -1.87 | -2.23 | -1.28 | -1.60 | 27 % | 858 | -3.7 | -1.96 | -1.7 | -3.6 | -3.6 |
| 14 d | -8.5 | -2.60 | -2.95 | -1.37 | -1.60 | 31 % | 1135 | -4.9 | -2.67 | -2.3 | -4.8 | -4.9 |
| 21 d | -11.0 | -3.84 | -4.09 | -1.42 | -1.60 | 35 % | 1573 | -7.0 | -3.89 | -3.1 | -6.9 | -7.1 |

**Lean woman**

| Fast length | ΔBW end of fast kg | fat | protein tissue | glycogen + water | ECF + gut | fat share of loss | protein lost g | ΔBW +3 d refeed | fat +3 d | 'DXA-lean' +3 d | ΔBW +7 d | ΔBW +14 d |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 d | -1.3 | -0.14 | -0.15 | -0.27 | -0.71 | 11 % | 57 | -0.2 | -0.20 | 0.0 | -0.2 | -0.2 |
| 2 d | -2.1 | -0.28 | -0.31 | -0.43 | -1.03 | 14 % | 119 | -0.5 | -0.36 | -0.2 | -0.5 | -0.5 |
| 3 d | -2.6 | -0.44 | -0.48 | -0.53 | -1.18 | 17 % | 185 | -0.9 | -0.51 | -0.3 | -0.8 | -0.8 |
| 5 d | -3.5 | -0.75 | -0.81 | -0.66 | -1.29 | 21 % | 310 | -1.4 | -0.82 | -0.6 | -1.3 | -1.3 |
| 7 d | -4.2 | -1.06 | -1.10 | -0.75 | -1.31 | 25 % | 422 | -1.9 | -1.13 | -0.8 | -1.8 | -1.9 |
| 10 d | -5.1 | -1.53 | -1.47 | -0.82 | -1.32 | 30 % | 567 | -2.6 | -1.58 | -1.0 | -2.5 | -2.6 |
| 14 d | -6.2 | -2.14 | -1.90 | -0.88 | -1.32 | 34 % | 732 | -3.5 | -2.18 | -1.3 | -3.4 | -3.5 |
| 21 d | -8.0 | -3.18 | -2.53 | -0.91 | -1.32 | 40 % | 974 | -4.8 | -3.21 | -1.6 | -4.8 | -5.0 |

**Obese woman**

| Fast length | ΔBW end of fast kg | fat | protein tissue | glycogen + water | ECF + gut | fat share of loss | protein lost g | ΔBW +3 d refeed | fat +3 d | 'DXA-lean' +3 d | ΔBW +7 d | ΔBW +14 d |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 d | -1.7 | -0.18 | -0.15 | -0.29 | -1.05 | 11 % | 57 | -0.2 | -0.25 | 0.0 | -0.2 | -0.2 |
| 2 d | -2.7 | -0.37 | -0.31 | -0.45 | -1.53 | 14 % | 119 | -0.6 | -0.45 | -0.1 | -0.6 | -0.5 |
| 3 d | -3.4 | -0.56 | -0.48 | -0.55 | -1.76 | 17 % | 185 | -1.0 | -0.65 | -0.3 | -0.9 | -0.9 |
| 5 d | -4.4 | -0.95 | -0.82 | -0.69 | -1.92 | 22 % | 314 | -1.6 | -1.04 | -0.6 | -1.5 | -1.5 |
| 7 d | -5.2 | -1.34 | -1.13 | -0.78 | -1.96 | 26 % | 433 | -2.2 | -1.42 | -0.8 | -2.1 | -2.2 |
| 10 d | -6.3 | -1.93 | -1.54 | -0.86 | -1.97 | 31 % | 593 | -3.1 | -2.00 | -1.1 | -3.0 | -3.1 |
| 14 d | -7.6 | -2.72 | -2.01 | -0.92 | -1.97 | 36 % | 771 | -4.1 | -2.77 | -1.4 | -4.1 | -4.2 |
| 21 d | -9.6 | -4.09 | -2.62 | -0.95 | -1.97 | 42 % | 1006 | -5.8 | -4.13 | -1.7 | -5.8 | -6.0 |

Reading the table: a **24-h fast** removes ≈ 1.3–1.7 kg of which only ≈ 0.15–0.18 kg is fat; within 3 days of normal eating
the scale is back to ≈ −0.2 kg (the fat) and DXA-lean is back to ≈ 0. A **7-day fast** removes ≈ 4.2–5.7 kg; ≈ 45 %
returns within 3 days; the kept loss ≈ fat (1.1–1.4 kg) + unrecovered protein tissue (≈ 0.8–1.2 kg). Retained fat ≈
100 % of fat oxidised if refeeding is at maintenance; hyperphagic refeeding (+10–20 % for a few days, [78]) erodes
≈ 0.1–0.3 kg of it. Evidence grade **B** (end-of-fast totals and 3-d refeed partition from controlled cohorts), **C**
(day-by-day split and post-fast weeks).

#### 4.6.4 Longer-term regain after fasting
- 7.3-y follow-up of 121 morbidly obese patients treated by 1–2+ months of fasting: loss maintained 12–18 months, then
  regain "irrespective of length of fast"; 50 % back to original weight within 2–3 years; only 7 stayed reduced [48].
- Laurens: fat mass no longer lower than baseline at 3 months (BIA), body mass and lean soft tissue still lower [7].
- TrueNorth (whole-plant refeeding, education): 6 weeks after, BW −7.2 kg, FM −5.1 kg (fat loss continued) [14].
- Ezpeleta: metabolic benefits (BP, lipids, glycaemia) gone 3–4 months after, even with weight maintained [11].
- 382-d supervised fast (27-y man, supplements): "has subsequently maintained his normal weight" [49] (weights
  207 → 82 kg quoted in secondary sources are UNVERIFIED here).
→ Model rule: post-fast trajectory is determined by subsequent intake (01 + 12 appetite), with **no** persistent
"fasting-specific" metabolic effect after τ_AT,off; grade B.

### 4.7 Hormones and blood markers across the fast and after refeeding

Owners: insulin/glucose 04; IGF-1 08; leptin/T3/testosterone/cortisol/GH 12; lipids/BP 06; hour-level functions 07. This
table consolidates water-only data by day for validation and gives hooks where no owner has one.

| Marker | 24 h | 48–72 h | Day 5–7 | Day 10–21 | Refeeding | Sources |
|---|---|---|---|---|---|---|
| Insulin | 70 % of the 12→72-h fall done [27] | −50 % (64.6 → 30.1 pmol/L at 72 h) [27]; > −70 % [53]; 18.6 pmol/L nadir day 3 then flat [8] | flat | −59 % (modified) [7] | rises with first carbohydrate | [27,53,8,7] |
| Glucagon | ↑ | peak days 1–3 (coincides with N peak) | returning | – | ↓ | [33] (magnitude UNVERIFIED) |
| Glucose (mM) | 4.5–5.0 | 4.0–4.4 (48 h); 3.6–4.1 (72 h) [27,86] | nadir 3.3–3.5 at day 3–5 [8,9,20,51]; CGM mean 3.7 (67 mg/dL) day 5; 66 % of time < 3.9 mM, min 2.8 mM, asymptomatic [5] | 3.7–3.9 [9]; ≈ 1.7 mM (30 mg/dL) throughout the last 8 months of a 382-d supervised fast, ambulant [49] | back to baseline within 1–3 d; 7-d fast → delayed insulin secretion and post-load hyperglycaemia on OGTT [6] | |
| GH | ↑ | 24-h production ×5 on day 2 (78 → 371 µg/Lv) [52] | integrated ×3.1, pulses 5.8 → 9.9/24 h at day 5 [51] | – | ↓ | blunted absolute rise in obesity (ΔGH % similar) [38] |
| IGF-1 | unchanged (56 h) [52] | −50 % total, −75 % free at 72 h [53] | 1.31 → 0.77 U/mL (d1 → d5) [51]; 246 → 87 µg/L at day 7 (−65 %) [59] | −75 % at 10 d (obese, 08) | recovery τ ≈ 7 d (08) | **obesity: no fall at 72 h (ΔIGF-1 lean −66 vs obese +27 µg/L) [38] — not in 08's model** |
| T3 / rT3 | − | T3 −30 % at 72 h [53]; ↓ at 3 d [24] | – | T3 −53 %, rT3 +58 % (7–18 d) [58] | normal within 1 wk of mixed diet (13) | 12 |
| Leptin | ↓ | −64 % (normal) / −72 % (obese) at 52 h (via 13 [79]); to ≈ 10 % at 72 h [53] | low | low; still low 3 months later (modified fast) [7] | ↑ with carbohydrate | 12 |
| Cortisol (24-h mean) | ↑ | 4.84 → 7.84 µg/dL at 72 h [53]; 7.2 → 11.6 (young) and 7.7 → 12.6 µg/dL (older men) at 3.5 d [54]; 8.0 → 12.8 µg/dL women midluteal 2.5 d [55] | – | – | – | 12 |
| Noradrenaline | unchanged at 36 h [21] | ↑ at 72 h [21]; ×2.2 by day 4 [20] | – | – | – | |
| Testosterone (men) | – | −40 % at 72 h (prevented by leptin replacement) [53]; ↓ at 3 d [24] | – | – | – | women: no LH/oestradiol change in a 3-d luteal-phase fast (07) |
| Ghrelin / hunger | meal-time ghrelin peaks persist in a 24-h fast [57]; hunger peaks late day 1–day 2 | 24-h mean ghrelin falls slightly over 84 h [56] | hunger absent in 93 % of 1,422 modified fasters; hunger and other symptoms "mainly in the first days" [12]; unchanged or transiently reduced [7] | – | returns to baseline [7]; ghrelin ↑ at 3 months [7] | ADF: hunger on fast days does **not** habituate over 3 wk [67] |
| BHB | 0.3 | 1.4–2.7 | 3.5–4.8 | 4.8–6.6 | halves within 1 h of ≈ 110 g carbohydrate; baseline by 3–4 d [8,9] | §4.3.4, 05 |
| Uric acid | ↑ | ↑ | **0.38 → 0.85 mmol/L** (day 8) [10]; plateau from day 7 | 385 → 866–889 µmol/L, max 1188 [9]; ↑ in all Buchinger groups [12] | drops sharply, baseline in ≈ 4 d [9] | clearance 4.9 → 1.3 mL/min [10] (ketoacid competition) |
| LDL-C / apoB | ↑ already in ≤ 3-d fasts (meta-analysis subgroup) [16] | ↑ | **+23 % (d3), +45 % (d6), +44 % (d9); apoB +42 % (d9); Lp(a) ×2** [8]; +66 % LDL, +65 % apoB at day 7 [59] | +21 % (NS), non-HDL +25 %, HDL −16 % at ≈ 10 d [15]; meta-analysis: LDL g = 0.49, rising to ≈ 10 d then attenuating; HDL ↓ only > 3 d [16] | LDL back below baseline after 5-d refeed (96.7 vs 108 mg/dL) [15] | modified (Buchinger) fasts: LDL ↓ [12,17] |
| Triglycerides | ↓ (≤ 3 d) [16] | – | ↑ in > 3-d fasts [16] | +22 % (NS) [15] | +32 % after refeed [15] | 06 |
| Blood pressure | – | no change to 72 h [21] | SBP −6.4 % d7 [8]; 117 → 98 mmHg d8 [9] | lowest 86 mmHg at refeed day 3 after 21 d [9]; large falls in hypertensives [13,14] | back by ≈ day 3–5 of full diet [8]; gone at 3–4 months [11] | orthostatic symptoms §4.8 |
| Heart rate | – | +6–7 bpm at 36–72 h [21] | +35–36 % by day 8 (≈ 96 bpm) [8,9] | elevated | back by refeed day 5 [9] | |
| Na / K / Mg | – | – | Na −5 mmol/L d8, K 3.89 → 4.18, Mg 0.85 → 0.80 mmol/L [10] | Na −4.5 % d21; K falls late and to 3.5 mmol/L on refeed day 4 [9] | watch K, P, Mg in first 5 d (17) | §4.12 |
| Liver enzymes | – | liver TG accumulates in men (48 h) [25] | ALT/AST ↑ [7] | within normal range [9] | normalise [7]; 3 of 13 had ALT/AST/GGT rises at full-refeed day 5 [9] | |
| CRP / inflammation | – | – | – | **hsCRP +129 %** (≈ 10-d water fast) [15]; 2.8 → 4.3 mg/L (1,422 modified fasters) [15] | most proteomic changes reversed within 5 d [15] | platelet degranulation ↑ [15] |
| Insulin sensitivity | 24-h fast transiently lowers clamp insulin sensitivity [69] | 48 h: glucose disposal 39.8 → 24.1 µmol/kg/min, oxidation −82 % [23]; 72 h: larger meal glucose/insulin excursions [60] | – | – | "starvation diabetes" resolves over 1–3 d of carbohydrate (07 §4.7.2; > 3-d fasts UNVERIFIED) | |

Hooks (PROPOSED, only where no owner exists; grade C):
```
UricAcid_rel(t)  = 1 + 1.25·(1 − exp(−t/2.5 d))                  // ×2.2 plateau from ≈ day 7 [9,10]; refeed: back to 1 with τ 1.5 d
LDL_rel(t)       = 1 + 0.45·(1 − exp(−t/3 d))·(1 − 0.4·clamp((t − 10)/10, 0, 1))   // [8,59,16]; ×0.5 if CHO ≥ 25 g/d [12,17]
HDL_rel(t)       = 1 − 0.15·clamp((t − 3)/7, 0, 1)                // [15,16]
CRP_rel(t)       = 1 + 1.3·clamp((t − 3)/7, 0, 1)                 // [15]; refeed τ 5 d
HR_delta(t)      = +7 bpm·clamp(t/2, 0, 1) + 20 bpm·clamp((t − 3)/5, 0, 1)   // [21,8,9]
SBP_delta(t)     = −(8 + 0.15·(SBP0 − 120))·clamp((t − 2)/6, 0, 1) mmHg      // [8,9,13,14]
```

### 4.8 Function during the fast: strength, endurance, cognition, mood, sleep, orthostasis

| Domain | Data | Model rule (PROPOSED) | Grade |
|---|---|---|---|
| Maximal strength | 3.5 d: isometric strength and anaerobic capacity unchanged, isokinetic elbow flexion −10 % [61]; 6 d: leg isometric/isokinetic peak torque and power **unchanged** [4]; 10-d modified fast with walking: grip unchanged, leg strength ↑ [7]; 12-d modified fast (half > 50 y): MVC preserved, both sexes [18] | Strength index −0 to −10 % during fasts ≤ 7 d; no strength gain credit (practice effect) | B |
| Aerobic capacity | 6 d: VO2peak **−13 %** absolute (3.77 → 3.27 L/min), −7 % per kg; peak power −16 %; exercise RER 1.12 → 0.93; PDK4 ×13 [4]; 12-d modified fast: VO2peak unchanged [18] | VO2peak −2 %/d from day 2 to −13 % at day 6 (water-only) | B |
| Endurance | 24-h fast: time to fatigue at 79–86 % VO2max cut (e.g. 115 → 42 min at 86 %) [63]; 3.5 d: time to exhaustion at 45 % VO2max unchanged [61,62] | high-intensity endurance −30–60 % from 24 h; low-intensity unchanged ≤ 3.5 d | B |
| Glycaemia during exercise | glucose rises during exercise after 6 d (3.8 → 5.6 mM at VO2peak); BHB falls 4.0 → 2.9 mM [4] | – | B |
| Cognition / mood | Levanzin: no loss of argumentative power or lucidity over 31 d [19]; well-being ↑ (physical and emotional) in modified fasts [12]; perceived stress ↓ after 8 d [10]; 21 d water "almost no complaints and negative emotions" [9] | no cognitive decrement modelled ≤ 21 d; mood term 0 | C |
| Symptoms | fatigue 48 %, insomnia 34 %, nausea 32 %, headache 30 %, presyncope 28 %, dyspepsia 26 %, back pain 26 % of supervised water-fast visits [13]; sleep disturbance 15 %, muscle cramp 0.35 % (modified) [12]; headaches, weakness, insomnia, dry mouth, orthostatic hypotension (6 of 20 switched to broth/juice) [15] | symptom-probability outputs for UI (17 wording) | B |
| Orthostasis | presyncope 28 % [13]; HR +35 % and SBP −16 % by day 8 [9] | orthostatic-risk index = f(ECF deficit, SBP_delta, Na intake) | C |
| Bone (request from 19) | 24 h at 25 % of needs: CTX, P1NP, PTH unchanged at rest and on refeeding [91]; 7-d water fast: DXA bone mass unchanged (+0.008 ± 0.014 kg) [3] and unchanged in [4]; BMC unchanged over a 14-d fast + 6 wk [14]; negative Ca balance −5.8 to −9.2 g over 40 d of fasting [40]; plasma PTH ↓ ×2.1 at ≈ 10 d [15] | no bone-mass change for fasts ≤ 21 d; flag cumulative Ca-balance concern only for repeated long fasts (grade D) | B (short), C (long) |
| Immune (request from 19) | 21-d fast: WBC −24 %, neutrophils −36 % at day 15, still low after refeeding; monocyte % +36 % at day 21 [9]; hsCRP +129 %, platelet degranulation and complement ↑ at ≈ 10 d, mostly reversed after 5-d refeed [15] | display-only markers; no infection-risk model (grade C) | C |

**Can/should people train during 72-h or 7-day fasts?** Data say strength sessions are *possible* (strength preserved to
day 6 [4]) but high-intensity and long endurance work is impaired from 24 h [63,4] and exercise does not buy protein
sparing that has been measured. No trial shows a lean-mass benefit of resistance training *during* a multi-day water fast.
Recommendation for the engine: allow light activity (walking ≤ 60 min, 17's tier limits), do not credit resistance
training with MPS during zero-protein days (MPS response needs amino acids; 03/09), and move hard sessions to refeeding
days. Grade C.

### 4.9 Refeeding: protocols, refeeding-syndrome risk, rebound, hyperphagia, lean recovery

**Protocols actually used in the evidence base.**
| Setting | Refeed |
|---|---|
| Buchinger (4–21 d modified fasts) | stepwise over ≈ 4 d, ovo-lacto-vegetarian, 800 → 1,600 kcal/d [7,12,17] |
| TrueNorth (2–41 d water-only) | refeed for **≥ ½ the fast length**; 5 phases (one per 7–10 fasting days): juices/broths → whole plant foods without added salt, oil or sugar; clinician checks twice daily [13,14] |
| Norwegian 7-d cohorts | OGTT at the end, then ad libitum for 3 d [3,4,6] |
| Dai (10 and 21 d) | 4–5 d graded calorie-restricted refeed, then 5 d normal diet [8,9] |
| NICE / ASPEN (clinical, via 17) | little/no intake > 5 d → ≤ 50 % of requirements for the first 2 d; high risk: ≤ 10 kcal/kg/d (≤ 5 if BMI < 14 or negligible intake > 15 d), thiamine 200–300 mg/d + B-complex + multivitamin for 10 d; refeeding syndrome = 10–30 %+ falls in P, K or Mg within 5 d (13 §4.18, 17 §4.3.3) |

**Model rules for the engine (PROPOSED; ramps owned by 17's HC-F3).**
```
After any fast ≥ 48 h, while refeeding:
  glycogen refill (04 kinetics; allow +10 % muscle supercompensation for 3 d after fasts ≥ 3 d — UNVERIFIED)
  E_fast → 0 (τ_up 0.7 d) + oedema overshoot (§4.5.2);  M_gut → 0 (τ 1 d)
  labile protein:   D_lab = min(cumulative fast protein loss, L_max = 0.75 g/kg FFM)
                    repleted at D_lab/τ_rep·e^(−t/τ_rep), τ_rep = 2 d, only if energy ≥ 90 % maintenance and protein ≥ 1.0 g/kg/d
                    remainder: normal 03/09 protein-balance dynamics (no special credit)
  s_AT → 0 with τ 4 d;  S_N → 0 with τ 3 d (carbohydrate ≥ 50 g/d) or 7 d (carbohydrate < 50 g/d)  (PROPOSED)
  insulin-sensitivity penalty on first carbohydrate meals: 07 §4.7.2 (fast-length scaling for > 3 d UNVERIFIED)
```
- **Labile-pool calibration** (grade D): L_max = 0.75 g/kg FFM makes 24–36-h fasts cost ≈ 35–45 g protein net each
  (≈ 0.1 kg hydrated tissue), reproducing the ≈ 0.7 kg extra non-fat loss of ADF-with-compensation vs daily restriction
  over ≈ 10 fasts [65]; the 7-d-fast DXA-lean at +3 d then comes out at −1.0 kg (obs −0.69 ± 0.49 [3]).
- **Rebound speed**: glycogen + ECF + gut return mostly within 2–3 d (MODEL +3.0 kg by day 3 after 7 d; obs +2.6 [3]);
  salt-free, low-glycaemic whole-plant refeeding gives a much smaller early rebound (+0.5 to +1.3 kg over 5–6 d
  [14,15]).
- **Hyperphagia**: a 36-h fast was followed by only ≈ 17 % energy compensation next day in lean adults (13 [78]); after
  24 h at 25 % of energy needs, next-day ad-lib intake was 12.62 vs 11.91 MJ (+6 %) [91]; after a 21-d fast, weight rose 1.28 kg/d at the switch to full diet and 0.6 kg/d thereafter, prompting the
  authors to advise strict control of refeeding [9]. No study measured fat regain in the first weeks after a multi-day fast
  directly; FM kept falling on a structured refeed [14].
- **Lean recovery**: DXA-lean mostly recovers in 3–6 d (water/glycogen) [3,8,14]; true protein tissue recovers over weeks
  and requires protein and energy (FFM −6.7 → −4.2 → −2.1 kg at fast end → refeed end → 6 wk [14], partly also an FFM
  loss appropriate to the lower body weight). 08: IGF-1 recovery is ≈ 4× slower than its fall (τ_up 173 h).
**Evidence grade:** protocols and refeeding-syndrome criteria **B** (clinical guidance via 17); rebound magnitudes **B/C**;
labile-pool and oedema parameters **D** (calibrations).

### 4.10 Repeated and periodic fasting: human data and what the engine must reproduce

| Protocol | Human data | Result vs comparator | Source |
|---|---|---|---|
| 24-h fasts on alternate days, 150 % on fed days (3 wk, lean) | n = 12 per arm, isoenergetic net −25 % vs 75 % every day; 0:200 arm tests fasting without deficit | weight equal (−1.60 vs −1.91 kg) but **fat −0.74 vs −1.75 kg**; 0:200 lost no fat (−0.12 kg); no postprandial metabolic, gut-hormone or adipose-gene advantage | Templeman 2021 [65] |
| Zero-calorie ADF vs −400 kcal/d CR (8 wk, obese) | n = 14 vs 12 | ADF deficit 376 kcal/d larger, but weight (−8.2 vs −7.1 kg), composition, lipids, insulin sensitivity **not different**; at 24-wk follow-up regain similar, % fat and lean mass changes "more favorable" in ADF | Catenacci 2016 [66] |
| ADF (25 %/125 %) vs CR, 12 months (obese) | n = 100 (3 arms incl. control; 86 women) | weight −6.8 vs −6.8 % at 6 mo, −6.0 vs −5.3 % at 12 mo, dropout 38 vs 29 %, LDL +11.5 mg/dL at 12 mo (ADF) | Trepanowski 2017 (13 [82]) |
| ADF 36-h fasts, 22 d (non-obese) | n = 16 | −2.5 % weight, −4 % fat; RMR unchanged; **hunger did not habituate**; fasting insulin −57 %; women's meal glucose response slightly worse | Heilbronn 2005 [67,68] |
| ADF 36:12, 4 wk (healthy non-obese) | RCT (n not extracted from abstract) | −37 % energy; fat (trunk) ↓, fat:lean ratio improved; T3 and LDL ↓; no AEs > 6 mo | Stekovic 2019 [70] |
| 3 × 24-h fasts/wk at 70 % vs 100 % energy vs daily 70 % (8 wk, women BMI 32) | n = 88 | IF70 lost more weight and fat than DR70 (and better TC/LDL); IF100 (no net deficit) lost some weight but raised fasting insulin; clamp insulin sensitivity equal; a 24-h fast transiently lowered insulin sensitivity | Hutchison 2019 [69] |
| Intermittent vs continuous (meta-analysis, 9 RCTs) | n = 782 | lean mass **−0.86 kg (−1.62, −0.10) worse** with intermittent; other outcomes NS | Roman 2019 (13 [83]) |
| FMD 5 d/month × 3 (≈ 1,100 then 720 kcal/d, 9–11 % protein) | n = 100 | −2.6 kg; trunk and total fat ↓; absolute lean ↓ (p = 0.004); IGF-1 ≈ −13 % measured 5–7 d after cycle 3 | Wei 2017 (13 [84], 08) |
| Monthly 48–72-h or quarterly 5–7-d water fasts | **no RCT found** (Europe PMC search 2026-09-30) | – | – |
| Annual/repeated Buchinger stays | observational only [12,17] | – | – |

**What the engine must do mechanistically (no "fasting bonus" terms):**
1. Energy: fast days contribute zero intake, TEF 0, A_SNS bump (small), and the weekly energy balance is what it is;
   fat loss follows energy closure. Templeman shows fat loss per unit deficit is *lower* (not higher) with ADF in lean
   adults; the model gets this from (2).
2. Protein: every fast start re-enters the high-N early phase because `S_N` decays (τ_off 3 d) between fasts shorter than
   ≈ 1 week apart; only the labile part (≤ 0.75 g/kg FFM) is repleted on refeeding. Therefore **per kg of fat lost,
   repeated 24–72-h fasts cost more protein than a continuous deficit with ≥ 1.2–1.6 g/kg/d protein** (03's CER model
   must yield ≤ the fasting-protocol lean loss at equal weekly deficit — validation target V9).
3. Water/glycogen: each fast produces a 1–3-kg scale dip and rebound; weekly weigh-ins depend on the weekday (13 T1/T2).
4. Hormones: IGF-1 and T3 dips recover with their own τ (08, 12); `s_AT` relaxes between fasts, so monthly 72-h fasts leave
   no lasting RMR suppression (grade C); weekly 36–48-h fasts leave partial carry-over only through 02's NEAT term.
5. Appetite/adherence is outside physiology: ADF dropout higher [82], hunger on fast days does not habituate [67];
   multi-day fasts reduce hunger after day 2–3 [12,19]. Planner adherence scores: 12/18.
**Evidence grade:** A/B for "no fat-loss advantage at equal energy" (RCTs + meta-analysis); B for the lean-mass penalty in
lean adults; D for any repeated multi-day water-fast protocol (no RCT).

### 4.11 Who responds differently

| Moderator | Effect | Evidence | Engine handling |
|---|---|---|---|
| **Adiposity** (strongest) | Lean: larger early ketonaemia (≈ 2×), larger protein share of energy (2–3× in prolonged fasts), larger adaptive RMR fall, larger glucose fall, IGF-1 falls; obese: lower N floor, blunted ketosis early (48-h BHB 1.9 vs 3.7 mM), IGF-1 may not fall by 72 h | [34,35,36,37,38,88,33,31] | built into n_pk, pr_late, φ_AT, B1/τ2, glucose offset; IGF-1 obesity modifier → 08 |
| **Sex** | Women: less FFM → lower absolute N and energy (explains most "sex" effects [4,33]); higher post-absorptive lipolysis, blunted rise [28]; similar glucose kinetics [25,28]; lower glucose (−0.3 to −0.45 mM at 30–48 h [87]; CGM 77 vs 83 mg/dL, p = 0.065 [5]); ketones: conflicting (higher at 30 h [87], lower at 48 h [25]); weight loss in 10-d fast 7.6 vs 7.8 % [15]; women regained weight more slowly in refeeding than men [9]; menstrual cycle phase effects on fasting responses sparse (luteal: preserved sex steroids, cortisol ↑ [55]) | [4,5,9,15,25,28,33,55,87] | via composition; glucose −0.3 mM (women, after 24 h); no separate N/EE term |
| **Age** | Older men: cortisol response to a 3.5-d fast equal to young [54]; 12-d modified fast preserved MVC and VO2peak with half > 50 y [18]; both SAEs in a 768-visit series occurred in men aged 70 and 73 [13]; older overweight adults reach lower BHB at 24 h (05) | [13,18,54] | no physiology term beyond composition; safety gating (17 HC-P8) |
| **Training status** | Trained vs untrained muscle autophagy markers differ during 36-h fasts (08); VO2peak loss similar in moderately fit adults (47.9 mL/kg/min) [4]; no data on lean-mass loss by training status in multi-day fasts | 08, [4] | none (grade D) |
| **Prior diet** | Low-carbohydrate pre-fast meal advances ketosis ≈ 12 h (05); keto-adapted people have smaller day-1 water/glycogen drop (13) | 05, 13 | via 04/05 states |

### 4.12 Electrolytes, micronutrients and non-caloric beverages

**What water-only fasters actually got in the studies:** TrueNorth: distilled water only (≥ 1.2 L/d), no electrolytes
[13,14]; Dai: a bottled mineral water with Na ≥ 0.8 mg/L, K ≥ 0.35 mg/L, Mg ≥ 0.5 mg/L, Ca ≥ 4 mg/L (i.e. **< 5 mg sodium
per 2 L**, DERIVED) for 21 d [9]; Norwegian cohorts: water only [3,4]; Buchinger: juice + vegetable broth + honey (≈ 25–60 g
carbohydrate, some sodium/potassium) [12,17]. Serum Na still fell only 4–6 mmol/L over 8–21 d in healthy adults [9,10], but
one 70-year-old developed grade-4 hyponatraemia on day 9 [13] and orthostatic symptoms were common [13,15].

| Nutrient | Loss / behaviour during water-only fasting | Suggested supply (engine defaults; tier rules in 17 §4.3.3) | Grade |
|---|---|---|---|
| Sodium | natriuresis largest days 1–4 (17 cites 100–150 mEq/d ≈ 2.3–3.4 g), then conserved (42.5 mmol/d at day 8 on mineral water [10]); NH₄⁺ replaces Na⁺ [45] | 1.5–2.5 g/d from day 2 for ≥ 36-h fasts; 2–3 g/d for ≥ 48 h (17); never salt-load; plain water > 3 L/d without solute → hyponatraemia warning (15) | B/C |
| Potassium | urinary K 111 → 34 mmol/d by day 8 [10]; serum K rose slightly (3.89 → 4.18) [10]; falls late and on refeeding (3.5 mmol/L refeed day 4) [9]; K supplements in fasting increased urinary Ca and faecal Mg losses [40] | none routinely ≤ 72 h; ≤ 1–2 g/d only in supervised > 3-d fasts without K/renal flags (17) | C |
| Magnesium | serum 0.85 → 0.80 mmol/L at day 8 [10]; balance −1.4 g over 40 d of fasting [40]; low plasma Mg from month 1 in a 382-d fast [49] | 100–300 mg/d optional for ≥ 72 h (17) | C |
| Phosphate | balance −5.4 g over 40 d [40]; the key refeeding-syndrome ion | no supplement during fast; monitor/ramp on refeeding after > 5 d (17) | B (refeeding) |
| Calcium | negative balance in all fasting groups (−5.8 to −9.2 g over 40 d) [40]; PTH ↓ ×2.1 on plasma proteomics (≈ 10 d) [15] | none; bone effect not modelled (19) | C |
| Thiamine | acute Wernicke's encephalopathy reported during prolonged therapeutic starvation [50]; NICE refeeding thiamine 200–300 mg/d (17) | thiamine + multivitamin for fasts > 5 d and on refeeding (17) | B (clinical) |
| Water-soluble vitamins | no marked changes over 10 d [8] | – | C |
| Fat-soluble vitamins | vitamin A +87 %, E +18 %, D3 ↑ from day 3 (mobilised from adipose) [8] | none | C |
| Uric acid | ↑ ×2.2 (above) | fluids ≥ 2 L/d; gout flag excludes ≥ T2 (17) | B |

**Non-caloric beverages (modifiers, do not end the fast):**
- Black coffee / caffeine: 2.5 and 5 mg/kg caffeine raised plasma ketones +88 % and +116 % acutely and raised FFA [72]
  (fed-state study); caffeine thermogenesis per 15/02. Coffee/tea were allowed in the leukocyte-autophagy 4-d fast study
  (08). Engine: BHB × (1 + 0.2·clamp(caffeine_mg_per_kg/5, 0, 1)) for 4 h (PROPOSED, grade C); ≈ 2–5 kcal per cup ignored.
- Herbal/black tea: allowed in Buchinger and other supervised protocols [7,12]; no metabolic term.
- Non-nutritive sweeteners (aspartame, stevia, monk fruit): no glucose/insulin excursion vs sucrose when taken alone;
  later compensation at meals [73] → no term on fasting days; flag sweetened products with maltodextrin/dextrose
  (energy + carbohydrate).
- Bone broth / juice / honey: **not water-only**; carbohydrate modifiers apply (§4.4.4, §4.3.4) and protein ≥ 5 g/d ends
  the branch.

### 4.13 Why dry fasting is excluded
Dry fasting adds water deprivation to energy deprivation: obligatory urinary solute excretion and insensible losses
continue, so body water falls by ≈ 1–2+ L/d (UNVERIFIED magnitude), with rising plasma osmolality and sodium, reduced
renal urate and ketone clearance (already impaired in water fasting: uric-acid clearance −74 % at day 8 [10]), and
risks of acute kidney injury, orthostatic collapse and arrhythmia. Religious dry fasts (e.g. daytime Ramadan) are ≤ 16 h
with nightly rehydration and belong to 07. There is no supervised human evidence base for multi-day dry fasting that
would allow evidence-graded simulation, and principle 5 of the brief forbids prescribing it; the simulator should refuse
fluid inputs < 1.0 L/d during fasts and show the danger message from 17.

---

## 4A. Deliverable (a) — Day-by-day reference tables, 0–21 days (MODEL, water-only, sedentary-light activity)

Generated with the reference implementation of §4B (hourly Euler, start of zero intake at t = 0, pre-fast mixed diet,
glycogen full, activity energy = 0.40 × RMR0 for lean and 0.35 × RMR0 for obese adults at the start, minus 02's NEAT
adaptation). RMR0 = Mifflin–St Jeor. "Protein tissue" = hydrated protein (1 + h_P = 2.6 g/g). "DXA-lean" = protein tissue
+ glycogen + water + ECF + gut (what DXA/BIA would report). Validation of these outputs: §7. Uncertainty bands to show in
the UI (PROPOSED, from inter-individual SDs in [3,4,9]): ΔBW ±15 %, fat ±25 %, protein ±25 %, BHB ±30 %, RMR ±6 points.

**Table A1 — Lean man (35 y, 178 cm, 75 kg, 15 % body fat; FM 11.3 kg, FFM 63.8 kg; habitual PAL ≈ 1.55).** Baseline: RMR 1692 kcal/d (Mifflin), maintenance TEE 2633 kcal/d, liver glycogen 85 g, muscle glycogen 431 g.

| Day (end of) | RMR kcal/d (Δ%) | TEE kcal/d | Fat oxidised g/d | Protein oxidised g/d (urinary N g/d) | BHB mM | Glucose mM | ΔBW kg | ΔFat kg | ΔProtein tissue kg | ΔGlycogen + water kg | ΔECF + gut kg | Δ'DXA-lean' kg | Muscle glycogen % |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 1692 (0) | 2633 | – | – | 0.1 | 4.9 | 0 | 0 | 0 | 0 | 0 | 0 | 100 |
| 1 | 1756 (+4%) | 2418 | 180 | 86 (13.8) | 0.3 | 4.5 | -1.6 | -0.17 | -0.22 | -0.40 | -0.85 | -1.5 | 89 |
| 2 | 1767 (+4%) | 2414 | 188 | 94 (15.0) | 1.4 | 4.0 | -2.7 | -0.35 | -0.45 | -0.64 | -1.24 | -2.3 | 79 |
| 3 | 1720 (+2%) | 2354 | 192 | 96 (15.3) | 2.6 | 3.7 | -3.5 | -0.54 | -0.70 | -0.80 | -1.43 | -2.9 | 71 |
| 4 | 1669 (-1%) | 2291 | 193 | 93 (14.8) | 3.2 | 3.6 | -4.1 | -0.74 | -0.94 | -0.92 | -1.51 | -3.4 | 65 |
| 5 | 1622 (-4%) | 2232 | 193 | 89 (14.3) | 3.5 | 3.6 | -4.7 | -0.93 | -1.18 | -1.01 | -1.56 | -3.7 | 60 |
| 6 | 1580 (-7%) | 2180 | 191 | 86 (13.7) | 3.9 | 3.6 | -5.2 | -1.12 | -1.41 | -1.09 | -1.58 | -4.1 | 55 |
| 7 | 1545 (-9%) | 2135 | 189 | 82 (13.1) | 4.1 | 3.6 | -5.7 | -1.31 | -1.63 | -1.15 | -1.59 | -4.4 | 52 |
| 8 | 1514 (-11%) | 2095 | 188 | 79 (12.6) | 4.4 | 3.6 | -6.1 | -1.50 | -1.84 | -1.20 | -1.59 | -4.6 | 49 |
| 10 | 1466 (-13%) | 2030 | 185 | 73 (11.7) | 4.8 | 3.6 | -7.0 | -1.87 | -2.23 | -1.28 | -1.60 | -5.1 | 44 |
| 12 | 1428 (-16%) | 1978 | 183 | 69 (11.1) | 5.1 | 3.7 | -7.8 | -2.24 | -2.60 | -1.33 | -1.60 | -5.5 | 41 |
| 14 | 1399 (-17%) | 1936 | 181 | 66 (10.6) | 5.3 | 3.7 | -8.5 | -2.60 | -2.95 | -1.37 | -1.60 | -5.9 | 39 |
| 17 | 1365 (-19%) | 1886 | 178 | 63 (10.0) | 5.5 | 3.7 | -9.6 | -3.14 | -3.45 | -1.40 | -1.60 | -6.4 | 37 |
| 21 | 1331 (-21%) | 1836 | 174 | 61 (9.7) | 5.7 | 3.7 | -11.0 | -3.84 | -4.09 | -1.42 | -1.60 | -7.1 | 36 |

**Table A2 — Lean woman (35 y, 165 cm, 60 kg, 25 % body fat; FM 15.0 kg, FFM 45.0 kg; habitual PAL ≈ 1.55).** Baseline: RMR 1295 kcal/d (Mifflin), maintenance TEE 2015 kcal/d, liver glycogen 65 g, muscle glycogen 263 g.

| Day (end of) | RMR kcal/d (Δ%) | TEE kcal/d | Fat oxidised g/d | Protein oxidised g/d (urinary N g/d) | BHB mM | Glucose mM | ΔBW kg | ΔFat kg | ΔProtein tissue kg | ΔGlycogen + water kg | ΔECF + gut kg | Δ'DXA-lean' kg | Muscle glycogen % |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 1295 (0) | 2015 | – | – | 0.1 | 4.9 | 0 | 0 | 0 | 0 | 0 | 0 | 100 |
| 1 | 1344 (+4%) | 1850 | 144 | 60 (9.5) | 0.3 | 4.5 | -1.3 | -0.14 | -0.15 | -0.27 | -0.71 | -1.1 | 89 |
| 2 | 1353 (+4%) | 1848 | 150 | 65 (10.3) | 1.4 | 3.7 | -2.1 | -0.28 | -0.31 | -0.43 | -1.03 | -1.8 | 79 |
| 3 | 1323 (+2%) | 1808 | 155 | 65 (10.5) | 2.6 | 3.4 | -2.6 | -0.44 | -0.48 | -0.53 | -1.18 | -2.2 | 71 |
| 4 | 1289 (-0%) | 1765 | 157 | 62 (10.0) | 3.2 | 3.3 | -3.1 | -0.59 | -0.65 | -0.60 | -1.25 | -2.5 | 65 |
| 5 | 1258 (-3%) | 1725 | 157 | 59 (9.5) | 3.5 | 3.3 | -3.5 | -0.75 | -0.81 | -0.66 | -1.29 | -2.8 | 60 |
| 6 | 1230 (-5%) | 1689 | 156 | 56 (9.0) | 3.9 | 3.3 | -3.9 | -0.91 | -0.96 | -0.71 | -1.30 | -3.0 | 55 |
| 7 | 1206 (-7%) | 1658 | 156 | 53 (8.4) | 4.1 | 3.3 | -4.2 | -1.06 | -1.10 | -0.75 | -1.31 | -3.2 | 52 |
| 8 | 1186 (-8%) | 1631 | 155 | 50 (8.0) | 4.4 | 3.3 | -4.5 | -1.22 | -1.23 | -0.78 | -1.32 | -3.3 | 49 |
| 10 | 1155 (-11%) | 1586 | 154 | 45 (7.2) | 4.8 | 3.3 | -5.1 | -1.53 | -1.47 | -0.82 | -1.32 | -3.6 | 44 |
| 12 | 1131 (-13%) | 1552 | 153 | 41 (6.6) | 5.1 | 3.4 | -5.7 | -1.83 | -1.70 | -0.86 | -1.32 | -3.9 | 41 |
| 14 | 1113 (-14%) | 1524 | 151 | 38 (6.1) | 5.3 | 3.4 | -6.2 | -2.14 | -1.90 | -0.88 | -1.32 | -4.1 | 39 |
| 17 | 1091 (-16%) | 1490 | 150 | 35 (5.6) | 5.5 | 3.4 | -7.0 | -2.59 | -2.19 | -0.90 | -1.32 | -4.4 | 37 |
| 21 | 1070 (-17%) | 1457 | 148 | 32 (5.2) | 5.7 | 3.4 | -8.0 | -3.18 | -2.53 | -0.91 | -1.32 | -4.8 | 36 |

**Table A3 — Obese adult (woman, 45 y, 165 cm, 100 kg, 45 % body fat; FM 45 kg, FFM 55 kg; habitual PAL ≈ 1.5).** Baseline: RMR 1645 kcal/d (Mifflin), maintenance TEE 2468 kcal/d, liver glycogen 68 g, muscle glycogen 273 g.

| Day (end of) | RMR kcal/d (Δ%) | TEE kcal/d | Fat oxidised g/d | Protein oxidised g/d (urinary N g/d) | BHB mM | Glucose mM | ΔBW kg | ΔFat kg | ΔProtein tissue kg | ΔGlycogen + water kg | ΔECF + gut kg | Δ'DXA-lean' kg | Muscle glycogen % |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 1645 (0) | 2468 | – | – | 0.1 | 4.9 | 0 | 0 | 0 | 0 | 0 | 0 | 100 |
| 1 | 1708 (+4%) | 2270 | 188 | 59 (9.5) | 0.2 | 4.5 | -1.7 | -0.18 | -0.15 | -0.29 | -1.05 | -1.5 | 89 |
| 2 | 1720 (+5%) | 2268 | 194 | 65 (10.3) | 0.8 | 4.0 | -2.7 | -0.37 | -0.31 | -0.45 | -1.53 | -2.3 | 79 |
| 3 | 1696 (+3%) | 2232 | 194 | 66 (10.6) | 1.7 | 3.7 | -3.4 | -0.56 | -0.48 | -0.55 | -1.76 | -2.8 | 71 |
| 4 | 1667 (+1%) | 2191 | 195 | 64 (10.3) | 2.0 | 3.6 | -3.9 | -0.76 | -0.65 | -0.63 | -1.87 | -3.1 | 65 |
| 5 | 1639 (-0%) | 2152 | 195 | 62 (9.9) | 2.3 | 3.6 | -4.4 | -0.95 | -0.82 | -0.69 | -1.92 | -3.4 | 60 |
| 6 | 1614 (-2%) | 2117 | 195 | 60 (9.5) | 2.6 | 3.6 | -4.8 | -1.15 | -0.97 | -0.74 | -1.95 | -3.7 | 55 |
| 7 | 1593 (-3%) | 2087 | 195 | 57 (9.2) | 2.8 | 3.6 | -5.2 | -1.34 | -1.13 | -0.78 | -1.96 | -3.9 | 52 |
| 8 | 1575 (-4%) | 2061 | 195 | 55 (8.7) | 3.0 | 3.6 | -5.6 | -1.54 | -1.27 | -0.81 | -1.97 | -4.0 | 49 |
| 10 | 1549 (-6%) | 2018 | 196 | 50 (7.9) | 3.4 | 3.6 | -6.3 | -1.93 | -1.54 | -0.86 | -1.97 | -4.4 | 44 |
| 12 | 1529 (-7%) | 1986 | 197 | 45 (7.1) | 3.7 | 3.7 | -7.0 | -2.32 | -1.79 | -0.89 | -1.97 | -4.7 | 41 |
| 14 | 1514 (-8%) | 1959 | 197 | 40 (6.4) | 3.9 | 3.7 | -7.6 | -2.72 | -2.01 | -0.92 | -1.97 | -4.9 | 39 |
| 17 | 1497 (-9%) | 1927 | 197 | 34 (5.4) | 4.2 | 3.7 | -8.5 | -3.31 | -2.29 | -0.94 | -1.97 | -5.2 | 37 |
| 21 | 1480 (-10%) | 1895 | 196 | 29 (4.6) | 4.5 | 3.7 | -9.6 | -4.09 | -2.62 | -0.95 | -1.97 | -5.5 | 36 |

**Table A4 — Obese man (supplementary; 45 y, 178 cm, 115 kg, 35 % body fat; FM 40.3 kg, FFM 74.8 kg).** Baseline: RMR 2042 kcal/d (Mifflin), maintenance TEE 3064 kcal/d, liver glycogen 89 g, muscle glycogen 430 g.

| Day (end of) | RMR kcal/d (Δ%) | TEE kcal/d | Fat oxidised g/d | Protein oxidised g/d (urinary N g/d) | BHB mM | Glucose mM | ΔBW kg | ΔFat kg | ΔProtein tissue kg | ΔGlycogen + water kg | ΔECF + gut kg | Δ'DXA-lean' kg | Muscle glycogen % |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 2042 (0) | 3064 | – | – | 0.1 | 4.9 | 0 | 0 | 0 | 0 | 0 | 0 | 100 |
| 1 | 2120 (+4%) | 2817 | 223 | 84 (13.4) | 0.2 | 4.5 | -2.0 | -0.21 | -0.21 | -0.41 | -1.18 | -1.8 | 89 |
| 2 | 2134 (+4%) | 2815 | 232 | 91 (14.5) | 1.1 | 4.3 | -3.2 | -0.44 | -0.44 | -0.65 | -1.72 | -2.8 | 79 |
| 3 | 2096 (+3%) | 2761 | 234 | 92 (14.8) | 2.1 | 4.0 | -4.1 | -0.67 | -0.68 | -0.81 | -1.98 | -3.5 | 71 |
| 4 | 2051 (+0%) | 2702 | 236 | 89 (14.2) | 2.6 | 3.9 | -4.9 | -0.91 | -0.91 | -0.93 | -2.11 | -4.0 | 65 |
| 5 | 2009 (-2%) | 2646 | 236 | 85 (13.6) | 2.9 | 3.9 | -5.5 | -1.14 | -1.14 | -1.03 | -2.17 | -4.3 | 60 |
| 6 | 1972 (-3%) | 2597 | 236 | 81 (12.9) | 3.2 | 3.9 | -6.0 | -1.38 | -1.35 | -1.10 | -2.20 | -4.7 | 55 |
| 7 | 1940 (-5%) | 2554 | 236 | 76 (12.2) | 3.4 | 3.9 | -6.5 | -1.61 | -1.56 | -1.16 | -2.21 | -4.9 | 52 |
| 8 | 1914 (-6%) | 2516 | 236 | 72 (11.5) | 3.7 | 3.9 | -7.0 | -1.85 | -1.75 | -1.21 | -2.22 | -5.2 | 49 |
| 10 | 1872 (-8%) | 2456 | 235 | 64 (10.2) | 4.0 | 3.9 | -7.9 | -2.32 | -2.10 | -1.29 | -2.23 | -5.6 | 44 |
| 12 | 1842 (-10%) | 2409 | 235 | 56 (9.0) | 4.3 | 4.0 | -8.8 | -2.79 | -2.41 | -1.34 | -2.23 | -6.0 | 41 |
| 14 | 1819 (-11%) | 2371 | 234 | 51 (8.1) | 4.6 | 4.0 | -9.6 | -3.26 | -2.69 | -1.38 | -2.23 | -6.3 | 39 |
| 17 | 1792 (-12%) | 2326 | 233 | 44 (7.1) | 4.9 | 4.0 | -10.7 | -3.96 | -3.06 | -1.41 | -2.23 | -6.7 | 37 |
| 21 | 1766 (-14%) | 2280 | 232 | 39 (6.3) | 5.1 | 4.0 | -12.0 | -4.89 | -3.49 | -1.43 | -2.23 | -7.2 | 36 |

Checks against data (observed in brackets): 7-d ΔBW, Kolnes-like cohort −5.7 (−5.8 ± 0.3 [4]); 7 M/5 F Pietzner-like mix −5.3
(−5.7 ± 0.8 [3]); 8-d, Ogłodek-like men −6.0 (−5.96 [10]); 10-d, Dai-2022-like men −6.3 (−7.28 ± 1.46 [8]); 21-d,
Dai-2024-like mix −8.7 (−10.0 ± 1.66 [9]); obese women 14 d −7.6 (older, BMI 31: −8.8 [14]). Rate days 1–3 ≈ 1.0–1.2 kg/d
(1.12–1.20 [8,9]); days 11–21 ≈ 0.27–0.33 kg/d (0.31 [9]; 0.3 kg/d in week 3 [47]). The model tends to under-predict the
two Chinese cohorts by ≈ 1 kg (measurement after defecation, possibly higher activity) — acceptable within ±15 %.

Hourly detail for the first 72 h (glucose, insulin, GNG share, lipolysis, BHB) is owned by 07 §4.4 (use its functions for
t < 72 h, with the BHB and N differences noted in §4.3.4 and §4.4.6).

---

## 4B. Deliverable (b) — Implementation spec for the hourly engine (zero intake, refeeding, repeats)

### 4B.1 Hourly step (inside the 01 core loop; dt = 1 h; all "per day" rates divided by 24)
```ts
// Preconditions: 04 has updated G_L (liver), 05 has updated BHB, 02 supplies RMR0 and AT_N, user schedule supplies activity.
function fastingOverlayStep(s: FastState, bus: SignalBus, inp: HourInput, p: FastParams) {
  const fasting = inp.kcal24 < 0.10 * bus.maintenanceKcal && inp.protein24 < 5 && inp.cho24 < 10;   // water-only branch
  const modified = !fasting && inp.kcal24 < 0.15 * bus.maintenanceKcal && inp.protein24 < 5;       // Buchinger-type
  const active = fasting || modified;
  s.tFast = active ? s.tFast + 1 : 0;
  const t = s.tFast / 24;                                   // days
  const cho = inp.cho24;                                    // g/d (0 for water-only)

  // (1) Energy expenditure — replaces 02's AT_R and Hall's T while active
  const aSNS = active ? p.a_SNS * (t / p.t_p) * Math.exp(1 - t / p.t_p) : 0;
  const onAT = active && t > p.t_lag;
  s.s_AT += ((onAT ? 1 : 0) - s.s_AT) / ((onAT ? p.tau_AT : p.tau_AT_off) * 24);
  const phi = clamp(0.25 - 0.004 * bus.BFpct, 0.05, 0.22);
  const rmr = (bus.RMR0 + p.gammaP * s.P_tis + p.gammaF * bus.dF) * (1 + aSNS) * (1 - phi * s.s_AT);
  const tee = rmr + inp.activityKcal + bus.AT_N + (active ? 0 : bus.TEF);        // kcal/d

  // (2) Glycogen: 04 liver kinetics; muscle uses fasting rate while active
  const kM = active ? p.kMf : bus.kMr_04;                   // 0.008 vs 0.0035 h^-1
  const dGM = -kM * (bus.G_M - 0.35 * bus.G_M0);            // g/h (release → Cori → hepatic glucose)

  // (3) Protein / N
  const Sstar = clamp((bus.BHB - 0.5) / 3.5, 0, 1);
  const tauS = Sstar >= s.S_N ? p.tauN : (cho >= 50 ? p.tauN_off : p.tauN_off_lowcarb);
  s.S_N += (Sstar - s.S_N) / (tauS * 24);
  let N = 0;                                                // g N/d
  if (active) {
    const FFM = bus.FFM0 + s.P_tis;
    const npk = 0.25 - 0.06 * clamp((bus.F - 10) / 40, 0, 1);
    const prLate = 0.04 + 0.22 * Math.exp(-bus.BFpct / 15);
    const rise = 0.8 + 0.2 * Math.min(1, t / 2.5);
    const Cc = 1 - 0.45 * clamp(cho / 100, 0, 1);
    const Kk = 1 - 0.3 * clamp(bus.BHB_exogenous / 1.5, 0, 1);
    N = (FFM * npk * (1 - s.S_N) + (prLate * tee / 29.4) * s.S_N) * rise * Cc * Kk * p.K_ex;
    s.D_lab = Math.min(s.D_lab + 6.25 * N / 24, p.Lmax * bus.FFM0);             // labile pool (g protein)
  }
  const protOx_h = 6.25 * N / 24;                                               // g protein/h
  s.P_tis -= protOx_h * (1 + p.hP) / 1000;                                      // kg hydrated tissue
  // Refeeding repletion of the labile pool (only when energy ≥ 90 % maintenance and protein ≥ 1.0 g/kg/d)
  if (!active && inp.kcal24 >= 0.9 * bus.maintenanceKcal && inp.protein24 >= 1.0 * bus.BW) {
    const rep_h = s.D_lab / (p.tauRep * 24); s.D_lab -= rep_h; s.P_tis += rep_h * (1 + p.hP) / 1000;
    bus.proteinUsedForRepletion_h = rep_h;                  // 03 must not double-count this protein
  }

  // (4) Water: natriuresis, gut, refeeding oedema (skip E_fast if 13's E_cna handles fasting)
  const Etarget = active ? -1.3 * bus.ECF0 / 17 : 0;
  const tauE = active ? p.tauE_down : (cho >= 100 && inp.naG24 >= 1.5 ? p.tauE_up : 3 * p.tauE_up);
  s.E_fast += (Etarget - s.E_fast) / (tauE * 24);
  s.M_gut += ((active ? -0.45 * Math.sqrt(bus.BW0 / 75) : 0) - s.M_gut) / 24;
  // oedema overshoot after fasts > 3 d: tracked as s.E_oed with amplitude min(2, 0.08*(lastFastDays-3)) (see §4.5.2)

  // (5) Energy closure → fat (Hall's fat balance with overridden protein flux)
  const glyc_h = -(bus.dGL_h + dGM);                        // g/h glycogen used
  const ketLossFat_h = 10 * clamp((bus.BHB - 1.5) / 2, 0, 1) / 24;   // urinary ketones ≈ 10 g/d fat-equivalent
  const fatOx_h = (tee / 24 - 4.18 * glyc_h - 4.7 * protOx_h - 4.0 * cho / 24 - (inp.kcal24 - 4 * cho) / 24) / 9.44
                  + ketLossFat_h;
  bus.dF_h = -fatOx_h;                                      // g/h, to 01
  bus.urinaryN = N; bus.protOx = 6.25 * N; bus.RMR = rmr; bus.TEE = tee;
}
```
Notes: (i) while `active`, **01's GNG_P and ProtOx are replaced** by `protOx_h` and Hall's `T` by `s_AT/A_SNS` (§4.0);
(ii) 05 computes BHB from its own kinetics — calibrate it to `BHB_ref` (§4.3.4) for water-only fasts (V3 of §7);
(iii) outputs `DXA_lean = P_tis + (ΔG_L + ΔG_M)(1 + h_G)/1000 + E_fast + E_oed + M_gut` are for validation/display.

### 4B.2 Parameter table (single source for ModelParams)
| Symbol | Value | Low | High | Unit | Grade | Source |
|---|---|---|---|---|---|---|
| a_SNS | 0.05 | −0.08 | 0.14 | – | C | [20–22,24,25,8,4,9] |
| t_p | 2.0 | 1.5 | 3.0 | d | C | [20,21,25] |
| t_lag | 2 | 1 | 4 | d | C | [4,9] |
| τ_AT / τ_AT,off | 9 / 4 | 6 / 3 | 14 / 7 | d | C | [9,7,19]; 13 [85] |
| φ_AT | 0.25 − 0.004·BF% (0.05–0.22) | −0.07 | +0.07 | – | C | [19,9,31,46] |
| γ_P, γ_F | 19, 4.5 | 13, 3 | 30, 6 | kcal/kg/d | B | [1] |
| k_Mf | 0.008 | 0.005 | 0.012 | h⁻¹ | B/C | [4] |
| n_pk | 0.25 → 0.19 | 0.21 | 0.28 | g N/kg FFM/d | B | [33,19,4] |
| pr_late | 0.04 + 0.22·e^(−BF%/15) | ×0.75 | ×1.25 | – | B/C | [19,36,33,31] |
| τ_N / τ_N,off / τ_N,off(low-carb) | 8 / 3 / 7 | 6 / 2 / 4 | 14 / 5 / 14 | d | C / D / D | [19,4,33] |
| h_P | 1.6 | 1.1 | 3.0 | g/g | B | [1]; §4.6.2 |
| C_carb slope | 0.45 per 100 g | 0.3 | 0.6 | – | C | [1,81,43] |
| K_ket slope | 0.3 per 1.5 mM exogenous | 0.2 | 0.4 | – | C | [41,42] |
| K_ex | 1.0 | 0.9 | 1.0 | – | D | [1,7,18] |
| L_max, τ_rep | 0.75 g/kg FFM, 2 d | 0.3, 1 | 1.5, 4 | – | D | [34,65,3] |
| E_fast*, τ_down, τ_up | −1.3 L·ECF0/17, 1.5 d, 0.7 d | −0.8, 1, 0.3 | −1.8, 3, 1.5 | L, d | C | [1,47,80,7] |
| A_oed per fast day > 3 d, cap | 0.08 L, 2.0 L | 0.03 | 0.15 | L | D | [9,14] |
| Gut deficit | −0.45·(BW0/75)^0.5 kg, τ 1 d | −0.2 | −0.7 | kg | C | 13 T21 |
| BHB_ref: B1, B2, τ2 | 2.2 mM, 3.7 mM, 170 h | ±30 % | | | B/C | §4.3.4 |
| Urinary ketone loss | 10 g/d fat-equivalent at BHB ≥ 3.5 mM | 5 | 20 | g/d | C | [1] KU_max 20 g/d; [44] |

### 4B.3 Behaviour required for schedules the owner asked for (acceptance tests for the implementation)
| Schedule | Required behaviour (MODEL values for the lean man of Table A1) |
|---|---|
| Single 24-h fast (dinner → dinner) | ΔBW −1.6 kg at 24 h; fat −0.17 kg; N 13–14 g; BHB ≈ 0.3–0.5 mM at the end; −0.2 kg by 3 d after |
| 48-h fast | ΔBW −2.7 kg; fat −0.35 kg; BHB ≈ 1.4–1.9; RMR +4 %; glucose ≈ 4.0 mM |
| 72-h fast | ΔBW −3.5 kg; fat −0.55 kg; protein ≈ 270 g; BHB ≈ 2.3–2.7; glucose 3.6–3.8; IGF-1 ≈ −50 % (08); +3 d after: −1.1 kg |
| 7-d fast | ΔBW −5.7 kg; fat −1.3; DXA-lean −4.4; N 13 g/d on day 7; BHB ≈ 4; RMR −9 %; +3 d after: −2.6 kg, DXA-lean −1.2 |
| 21-d fast | ΔBW −11.0 kg; fat −3.8; protein 1.57 kg; BHB ≈ 5.7; RMR −21 %; uric acid ×2.2; 17 danger banner from day 8 |
| Weekly 24-h fast × 12 wk | each fast re-enters peak N (BHB < 0.5 mM so S_N stays ≈ 0); cumulative fat ≈ 12 × (0.17 + refeed-day effect); net protein ≈ 12 × 35–45 g |
| Monthly 72-h fast × 6 | s_AT returns to < 0.05 before the next fast; IGF-1 recovers between fasts (08, τ_up 173 h ≈ 7 d → 97 % recovered after 25 d) |
| Fast broken by a 110-g carbohydrate meal on day 3 | BHB halves in 1 h (05 V7); S_N decays with τ 3 d; natriuresis reverses with τ 0.7 d (+0.5 L/d) |

---

## 4C. Deliverable (c) — Repeated-fast verdict table for the planner

Comparator for every row: **isocaloric continuous deficit** (same weekly energy, same weekly protein with ≥ 1.2–1.6 g/kg/d
on eating days, same training). "=" no difference expected; "−" worse; "+" better; "±" transient only. Allowed/tier:
17's HC-F1/F2 (T1 ≤ 24 h default-allowed; T2 24–48 h opt-in; T3 48–72 h opt-in + eligibility; T4 3–7 d expert mode;
T5 > 7 d never prescribed). ASI = 08's autophagy signal index (grade C/D).

| Protocol | Fat loss | Lean retention | RMR | Glycaemia / insulin sensitivity | LDL / lipids | BP | IGF-1 / ASI (08) | Hunger / adherence | Verdict for planner | Evidence grade |
|---|---|---|---|---|---|---|---|---|---|---|
| Weekly 24-h water fast (≈ 1 of 7 days) | = (fat ∝ deficit; 24EE −177 kcal on fast day [71]) | − small (≈ 35–45 g protein net per fast in model; lean ADF −0.86 kg vs −0.16 kg [65]) | = | ± (24-h fast transiently lowers insulin sensitivity [69]) | = | = | IGF-1 unchanged at 24 h [52]; ASI +2–4 weekly mean (08) | individual; fast-day hunger does not habituate [67]; 17 % next-day compensation [78] | **Allowed (T1)** as a *delivery pattern* of a small deficit; no metabolic credit; keep protein ≥ 1.6 g/kg on eating days; avoid if goal = muscle gain | B (ADF data), C (weekly) |
| 2 × 24 h per week, non-consecutive (zero-kcal "5:2") | = to slightly − in lean [65]; = or + in overweight women (IF70 > DR70 [69]) | − in lean [65]; meta-analysis −0.86 kg lean for intermittent [83] | = | = (clamp) [69] | = / + (IF70 lowered TC/LDL more [69]) | = | small | ADF dropout 38 vs 29 % [82] | **Allowed (T1/T2)**; flag lean-mass cost in lean users (BF < 15 % M / 25 % F); no fat-loss bonus | A/B |
| Alternate-day 36-h fasts | = or − (lean) [65,67,70] | − (lean) | = [67] | women: meal glucose slightly worse after 3 wk [68] | LDL ↓ over 4 wk in non-obese [70] | improved CV markers [70] | ASI + (08) | hunger stays high [67] | Allowed ≤ 2–3 × /wk only for weight-loss goals in overweight users (17 HC-F2); not for muscle-gain goals | B |
| Weekly 36–48-h fast | = | − (repeated early-N peak; S_N never builds) | = (s_AT relaxes) | ± | ± (LDL rises only > 3 d) | = | IGF-1 dip begins after ≈ 30 h (08); ASI + | 1–2 kg scale swing weekly | Allowed (T2) with lean-mass warning; no advantage vs CER | C (no RCT) |
| Monthly 72-h fast | = (≈ 0.55 kg fat per fast in lean man) | − (≈ 270 g protein per fast, ≈ 50 g repleted) | ± (recovers < 3 wk) | ± (post-fast glucose intolerance 1–3 d) | ± (LDL ↑ during, reverses) | ± | IGF-1 −50 % transient [53]; ASI large transient (08) | hunger falls after day 2 [12] | Allowed as opt-in T3 ≤ 2 per 30 d (17), only if the user ranks autophagy/IGF-1 goals and accepts lean cost; never for muscle-gain | C (no RCT of the protocol; physiology B) |
| Quarterly 5–7-d fast | = (≈ 1.0–1.3 kg fat per fast) | − (≈ 0.45–0.63 kg protein per fast; ≈ 1–1.6 kg hydrated) | ± | ± | ± (LDL +45–66 % during [8,59]) | ± (↓ during) | IGF-1 −65 % at day 7 [59] | adherence fine in supervised settings [12,13] | **Simulate only; not planner-prescribable** (T4 expert mode, 17); if chosen: refeed ramp, electrolyte plan | B (physiology) / D (as a repeated protocol) |
| 10–21-d supervised fast (annual) | = | − (1–1.6 kg protein) | ± (−13 to −21 % during) | ± | ± | ± (large ↓ in hypertensives, gone by 3–4 mo [11]) | large | – | **Never prescribed (T5)**; simulator with persistent banner | B (physiology) |
| 5-d FMD monthly × 3 (≈ 720–1,100 kcal, 9–11 % protein) | = (−2.6 kg over 3 cycles [84]) | − (absolute lean ↓ [84]) | ? | = (↓ only in at-risk subgroup) | = | ↓ small | IGF-1 ≈ −13 % after cycle 3 [84] | dropout 25 vs 10 % [84] | Allowed as a VLED-like block only under 17's V rules; no advantage vs CER for weight | B/C |

**Answer to the owner's question** ("is there any fat-loss, lean-retention or health-marker advantage of taking the weekly
deficit as a fast?"): **No for fat loss** (grade A/B: Templeman lean RCT, Catenacci, Trepanowski, Roman meta-analysis;
Hutchison is the one RCT favouring 24-h fasts in overweight women, plausibly through better adherence to the prescribed
deficit), **no — slightly worse — for lean retention** (grade B), **no durable advantage for lipids, BP or glycaemia**
beyond what the weight loss gives (grade B; benefits of multi-day fasts vanish by 3–4 months [11]). The only outputs that
genuinely differ are transient: IGF-1 dips, ketone exposure, ASI (08, grade C/D), and the scale-weight pattern. The planner
should therefore choose fasting protocols only when the user ranks one of those transient markers, schedule preference or
adherence above lean mass, and should display the lean cost.

---

## 5. Interactions with other subsystems

| Module | This dossier needs | This dossier gives |
|---|---|---|
| 01 core | F, P, ECF, energy closure, RMR tissue terms, TEF | overrides while fasting: protein flux (GNG_P + ProtOx → §4.4), resting AT (Hall T → A_SNS, s_AT), fasting ECF term; validation of 30-d-fast validity range |
| 02 EE | RMR0, AT_N (NEAT), caffeine | fasting resting AT replaces 02's AT_R while fasting (not additive); τ_off 4 d after refeed |
| 03 protein | refeed protein balance, MPS/MPB | supersedes 03 §4.13 for water-only and modified fasts; labile-pool repletion (≤ 0.75 g/kg FFM, τ 2 d) that 03 must not double-count; muscle vs non-muscle allocation 60/40 → 80/20 |
| 04 glycogen/insulin | liver glycogen kinetics, insulin proxy, refeed glycogen synthesis | fasting muscle glycogen rate k_Mf = 0.008 h⁻¹; supercompensation flag after ≥ 3-d fasts |
| 05 ketones | BHB (owner) | water-only BHB reference trajectory for calibration; BHB drives `S_N`; carbohydrate/exercise/caffeine modifiers |
| 07 timing | hourly 0–72 h functions, fed/absorptive state | corrections for BHB after day 5 and for lean-person urinary N (§4.3.4, §4.4.6) |
| 08 autophagy/IGF-1 | ASI, igf1Rel | obesity modifier needed: no IGF-1 fall at 72 h in obese men [38]; 7-d water fast 246 → 87 µg/L (−65 %) [59] as validation |
| 12 hormones/appetite | leptin, T3, cortisol, testosterone, hunger model, ad-lib refeed intake | day-by-day validation values (§4.7); hunger falls after day 2–3 in multi-day fasts, not in ADF |
| 13 transitions | E_cna, gut, glycogen water, periodisation verdicts | fasting natriuresis magnitude/oedema; the "lean is back after 3 d" nuance (water, not protein) |
| 15 hydration/electrolytes | sodium/fluid inputs, hyponatraemia logic | fasting electrolyte losses (§4.12), plasma-Na drift index |
| 17 safety | tiers T1–T5, eligibility, refeeding ramps, stop rules | physiology-based per-tier notes (§9); correction of the "serious events ~20 % by day 5" copy (they are grade ≥ 3 AEs, SAEs 0.26 %) |
| 18 planner | objective functions | verdict table §4C; "no fasting bonus" rule; lean-cost penalty per fast start |
| 19 performance | VO2peak, strength outputs | §4.8 time courses (strength ≈ preserved to day 6; VO2peak −13 % at day 6) |

---

## 6. Output metrics for the UI

| Metric | Unit | Direction of good | Computation | Grade |
|---|---|---|---|---|
| Fasting hours / fasting day | h, d | informational | `tFast` | A |
| Fasting phase label | category | informational | §4.1 labels from tFast and BHB | C |
| Fat oxidised today | g/d | goal-dependent | energy closure (§4B step 5) | B |
| Protein (lean tissue) cost of this fast | g protein; kg hydrated tissue | ↓ | Σ 6.25·N; minus labile repletion after refeed | B/C |
| Urinary nitrogen | g/d | informational | §4.4.2 | B |
| Weight-loss decomposition | kg (fat / protein tissue / glycogen + water / ECF + gut) | informational | stacked chart from states | B |
| "Kept after refeeding" projection | kg | goal-dependent | fat + unrepleted protein tissue | B/C |
| DXA-lean-equivalent | kg | informational | §4.5.3 | B |
| RMR change during fast | % | informational | §4.2 | C |
| BHB / ketosis state | mM, category | goal-dependent | 05 (calibrated to §4.3.4); "fasting ketosis" 3–6 mM | B |
| Glucose, hypoglycaemia exposure | mM, % time < 3.9 | informational (warn) | §4.7; CGM anchor [5] | B |
| Uric acid relative | × baseline | ↓ (warn > 2) | §4.7 hook | B |
| LDL-C relative during fast | × baseline | ↓ (info) | §4.7 hook | B/C |
| Plasma-Na drift index | mmol/L | stay > 133 | §4.5.4 | C |
| Rebound on refeeding | kg | informational | §4.5.2 | C |
| Refeeding-risk flag | category | – | 17 (NICE/ASPEN criteria, fast length, BMI) | B |

---

## 7. Validation targets (unit tests; tolerances PROPOSED)

| # | Study | Conditions in | Outcome out (observed) | Tolerance / current MODEL |
|---|---|---|---|---|
| V1 | Kolnes 2025 [4] | 13 adults (7 M), 29.7 y, 79.6 kg, 23.4 % fat; 7-d water-only, usual routines | ΔBW −5.8 ± 0.3 kg; DXA fat −1.4 ± 0.1, lean −4.6 ± 0.3 kg; urinary N 83.9 ± 6.7 g/7 d (≈ 15 → 10 g/d); muscle glycogen −53 %; RMR day 5 unchanged; resting RER 0.86 → 0.76; VO2peak −13 %; strength unchanged | ΔBW ±0.8 kg (MODEL −5.7); fat ±0.5 (−1.5); DXA-lean ±1.0 (−4.2); N ±15 g (90); glycogen ±15 points (−48 %); RMR ±6 % (−3 %) |
| V2 | Pietzner 2024 [3] | 12 (5 F), 77.5 kg, BMI 25.4; 7-d water-only then 3 d ad lib | end: −5.7 ± 0.8 kg, lean −3.6 ± 0.49, fat −1.6 ± 1.3; +3 d: weight −3.1 ± 0.6, lean −0.69 ± 0.49, fat −1.85 ± 0.34 | end ±1 kg (−5.3); +3 d weight ±0.8 (−2.4), lean ±0.6 (−1.0), fat ±0.5 (−1.4) |
| V3 | Dai 2024 [9] | 13 (5 F), 40.5 y, 66.3 kg, BMI 24.5; 21-d water-only (mineral water), light activity | ΔBW −10.0 ± 1.66 kg (−15 %); 1.12 kg/d days 1–3, 0.31 kg/d days 11–21; BHB 4.74 (d5–9), 5.36 (d10–15), 6.03 (d15–21), 6.61 (d21); glucose nadir 3.27 (d4), mean 3.86 (d5–21); REE NS/−7.5/−13.7/−20.3 % (d3/9/15/20); uric acid 385 → 866 µmol/L | ΔBW ±1.5 kg (−8.7); glucose ±0.4; REE ±6 points (+2/−10/−15/−17); MODEL BHB 3.4/4.5/5.3/5.6 |
| V4 | Laurens 2021 [7] (modified fast) | 16 men, 44 y, BMI 26.2; 10 d at 200–250 kcal (≈ 40–50 g CHO) + ≤ 3 h/d light activity; refeed 800 → 1,600 kcal over 3–4 d | ΔBW −5.9 ± 0.2 kg; fat −2.3; lean soft tissue −3.53 (ECW 1.6, glycogen + water 0.5, active tissue 1.5 kg); BMR −12 %; N −41 % by day 5 | ΔBW ±1.0 (MODEL −6.5 to −6.8, CHO 45 g/d, activity 0.45–0.6 × RMR0); fat ±0.6 (−1.9 to −2.2); hydrated protein tissue ±0.5 (−1.65); BMR ±5 points (−10.5 %); N fall is relative to the fed pre-fast excretion (not modelled) |
| V5 | Benedict 1915, Levanzin [19] | 1 man, 60.6 kg, lean; 31-d water-only, laboratory life | −13.25 kg (fat 3.65, protein 1.66, water 7.33); urinary N d4 11.9, d10 10.1, d20–31 ≈ 7.7 g/d; resting heat 1,615 → 1,109 kcal/d (−31 %) | ΔBW ±2 kg (MODEL −11.7); cumulative N ±15 % (289 vs 277 g); late N ±1.5 g/d (8.1); RMR at d30 ±8 points (−24 %) |
| V6 | Göschke 1975 [33]; Owen 1998 [31]; Forbes & Drenick 1979 [34] | normal-weight vs obese total fasts | peak N 14.5 g/d (normal and obese men, days 1–3); obese women week 4 3.0 g/d; late obese protein 7 % of energy (0.27 g/kg BW/d); N lost per kg weight ≈ 20 (non-obese) vs ≈ 10 g/kg (FM ≥ 50 kg) | peak ±2 g/d; obese week-4 N ±1.5 g/d (MODEL 3.8); lean 21-d N/weight 23 g/kg (±5); obese late protein share 5–9 % |
| V7 | Ogłodek 2021 [10] | 12 men, 50 y, 79.4 kg, 18.7 % fat; 8-d water-only | ΔBW −5.96 kg; BIA fat −2.06, FFM −4.04; BHB 0.30 → 4.77 mM; glucose 4.84 → 3.66; Na 139.3 → 133.8; uric acid 0.38 → 0.85 mmol/L | ΔBW ±1.0 (−6.1); BHB ±30 % (4.4); glucose ±0.4 (3.6); Na-drift index −5 ± 2 mmol/L; uric acid ×2.2 ± 0.4 |
| V8 | Browning 2012 [25]; McDougal 2018 [86]; Klein 1993 [27] | 24–72-h fasts, young adults | BHB 24 h 0.33 F / 0.41 M; 48 h 1.22 F / 1.94 M; 72 h 2.3 ± 0.5; glucose 72 h 4.14 mM; glycerol Ra ×2.1 by 72 h | BHB ±30 % (0.30, 1.42, 2.67); glucose ±0.4 (3.7) |
| V9 | Templeman 2021 [65] | lean adults, 3 wk: 24-h fasts on alternate days with 150 % on fed days vs 75 % daily vs 0:200 | ΔBW −1.60 vs −1.91 vs −0.52 kg; fat −0.74 vs −1.75 vs −0.12 kg | engine (01 + 03 + this overlay) must give fat loss 0:150 < 75:75 by ≥ 0.5 kg and non-fat loss 0:150 > 75:75; 0:200 fat ≈ 0 ± 0.3 kg |
| V10 | Sävendahl & Underwood 1999 [59]; Chan 2003 [53] | 7-d water fast (10 non-obese); 72-h fast (lean men) | LDL +66 %, apoB +65 %, TG and HDL unchanged, IGF-1 246 → 87 µg/L; 72 h: leptin → 10 %, testosterone −40 %, T3 −30 %, IGF-1 −50 %, cortisol 4.84 → 7.84 µg/dL | hooks/08/12 within ±30 % of relative change |

---

## 8. Myths / contested claims

- **"Fasting burns muscle, not fat" / "two-thirds of fasting weight loss is lean".** At the end of a 7–14-d fast DXA/BIA
  show 60–75 % "lean" [3,4,10,11,14], but that compartment is mostly glycogen, water, sodium-linked ECF and gut contents that
  return within days [3,14]. Fat oxidation is ≈ 150–240 g/d every day (≈ 75 % of resting energy by 60 h [26]). True
  protein loss is real and larger than in a protein-fed diet (≈ 0.45–0.6 kg protein in 7 d in normal-weight adults
  [4,19]) — so "mostly water" is also wrong for protein. Grade B.
- **"The lean mass fully comes back after refeeding."** DXA-lean does (≈ 80 % within 3 d [3]); protein tissue does not
  within days (N arithmetic, §4.6.2). Grade B/C.
- **"Metabolism rises during fasting / fasting boosts metabolism."** A small (≈ +4 %) and inconsistent rise on days 2–3
  [20–22,24,25,8]; by days 9–30 RMR is 7–31 % lower [9,19]. The 24-h EE on a fast day is ≈ 180 kcal *lower* (no TEF) [71]. Grade B/C.
- **"Starvation mode: after 3 days your body stops burning fat."** Fat oxidation stays near-constant for weeks; RMR falls
  gradually; weight loss slows mainly because early water/glycogen losses are over [9,47]. Grade B.
- **"Fasting protects muscle via growth hormone."** GH production rises ×3–5 [51,52] but IGF-1 falls 50–75 % [53,59],
  testosterone −40 % [53], and N loss peaks in the same days. Grade B.
- **"Protein sparing kicks in after 3 days for everyone."** Strong only with large fat stores; lean people keep losing
  protein at ≈ 15–20 % of energy for weeks [19,33,35,36]. Grade B.
- **"Ketones reach 7–8 mM in any long fast."** 6–7 mM plateaus are reached after 2–3 weeks in obese subjects [89 via 05]
  and ≈ 6 mM by day 21 in normal-weight adults [9]; modified fasts with 25–60 g carbohydrate plateau ≈ 4 mM [17]. Grade B.
- **"A weekly 24-h fast has special fat-burning or metabolic benefits beyond the calorie deficit."** Not supported at
  equal energy [65,66,82,83]; ketosis is barely reached by 24 h (0.3–0.5 mM) [25,90]. Grade A/B.
- **"Prolonged fasting is anti-inflammatory."** hsCRP rose 129 % during ≈ 10-d water fasts, with platelet activation
  and complement changes that mostly reversed after refeeding [15]. Contested; grade C.
- **"Fasting lowers cholesterol."** During multi-day water fasts LDL-C and apoB *rise* (23–66 %) [8,59,16]; values fall back
  on refeeding [15]; modified fasts with activity show falls [12,17]. Grade B.
- **"Fat loss continues after you stop fasting."** Partly a DXA artefact of rehydration [3,8,14] plus structured
  hypocaloric refeeds; with maintenance intake, fat is ≈ unchanged after refeeding (MODEL). Grade C.

---

## 9. Safety bounds (per duration tier; the rule engine and UI copy are 17's)

Physiology-based notes that 17's tiers should display; numbers are from the supervised evidence base.

| Tier (17) | Length | Expected physiology | Specific risks and triggers | Engine warnings |
|---|---|---|---|---|
| T1 | ≤ 24 h | −1.3 to −2.0 kg scale (≈ 10 % fat); BHB ≤ 0.5 mM; glucose ≥ 4.5 mM | hypoglycaemia with insulin/sulfonylureas (17 HC-P6); high-intensity performance ↓ [63] | none for eligible users; medication gate |
| T2 | 24–48 h | BHB 1–2 mM; natriuresis begins; RMR ≈ +4 %; N peak starts | lightheadedness/headache; orthostasis; gout flare in gout history; ketoacidosis with SGLT2 inhibitors (17) | sodium 1.5–2.5 g/d from day 2 (17); light exercise only |
| T3 | 48–72 h | BHB 2–3 mM; glucose 3.6–4.1 mM; uric acid rising; IGF-1 −50 %; testosterone −40 % (men); leptin ≈ 10 % | presyncope (28 % of supervised visits [13]); glucose < 3.9 mM for a large part of the day, usually asymptomatic [5]; insulin resistance on first meals [60] | refeed day 1 ≈ 50 % of maintenance (17); expect +1–2 kg rebound; not within 7 d of hard competition |
| T4 | 3–7 d | BHB 3.5–4.5; glucose nadir 3.3–3.5 (day 3–5); N 12–15 g/d (normal weight); uric acid ×2; LDL +45–66 %; HR +20–35 %; SBP −6 to −16 %; VO2peak −13 % | any grade ≥ 3 AE 20 % by day 5 in a clinical population [13]; hyponatraemia (serum Na −5 mmol/L by day 8 [10]); gout/urate stones; arrhythmia risk with electrolyte shifts; refeeding syndrome if BMI < 18.5 and > 5 d (NICE via 17) | expert mode only (17); daily Na-drift index; stop rules (17); thiamine + multivitamin on refeed; ramp ≥ max(4 d, ½ fast length) |
| T5 | > 7 d | BHB 4.5–6.6; RMR −10 to −30 %; protein 1–2 kg lost by 3 wk (lean); plasma Na −4 to −6 %; HR up to ≈ 96 bpm; SBP to ≈ 86–98 mmHg | grade ≥ 3 AEs 28 % by day 10, 32 % by day 15 [13]; SAE hyponatraemia day 9 (70-y man, distilled water) [13]; Wernicke's encephalopathy in historical prolonged fasts [50]; fat-depletion phase (rising N) when body fat approaches ≈ 10 % of body weight [7] — hard stop earlier for lean users; death near BMI 12–13 (01 [46]) | simulator only, persistent danger banner; hard stop if predicted body-fat % < 8 % (men) / 15 % (women) or BMI < 17.5 (PROPOSED thresholds for 17) |

Additional physiology-based rules (PROPOSED for 17): (1) lean users (BF < 12 % M / 20 % F) get the T4 lean-cost warning
already from 48 h because their protein share of energy stays ≈ 15–20 %; (2) any fast ≥ 48 h followed by a ≥ 120 %-energy
day triggers a refeeding caution (13 rule 4); (3) repeated fasts: warn when cumulative protein cost (model) exceeds
3 % of baseline body protein within 30 d; (4) older adults (≥ 65): T1 only (17 HC-P8), because both SAEs of the largest
supervised series were in men ≥ 70 [13].

---

## 10. Open questions / weakest assumptions

1. **Day-by-day N in lean people** rests on one 1912 subject (Levanzin) for weeks 2–4 and two modern 7-d cohorts; the
   P-ratio (pr_late) parameterisation is a fit across very different datasets (grade C).
2. **Early RMR rise** is contested (−8 to +14 % at day 2–3); we use +5 % peak. It matters little for weight (≈ 50–100 kcal/d
   for 3–4 days).
3. **Adaptive RMR fall's dependence on adiposity** (φ_AT) is inferred from 3 datasets (lean man, normal-weight cohort,
   obese per-kg constancy); no study compared lean vs obese RMR trajectories in the same protocol.
4. **Labile protein pool** (L_max 0.75 g/kg FFM, τ 2 d) is a grade-D calibration to Templeman and Pietzner; direct N-balance
   studies of refeeding after short fasts were not found.
5. **h_P = 1.6** vs whole-tissue hydration (≈ 4 g/g): choice made to match post-refeed DXA; inconsistent with Benedict's
   water accounting unless extra labile water is assumed.
6. **Natriuresis magnitudes** (≈ −1.3 L) and the refeeding oedema term are fitted to end-points, not to sodium balance
   studies (Veverbrants & Arky 1969 and Sigler 1975 full texts not accessed).
7. **Resistance training during multi-day fasts** has no human lean-mass outcome data; the engine gives no credit.
8. **Sex differences** in ketosis and glucose during 24–72 h conflict between studies [25,87]; no multi-day fast was
   powered for sex.
9. **Women's menstrual-cycle phase** and **older adults** (> 65) are nearly absent from water-only data.
10. **Repeated monthly/quarterly multi-day water fasts** have no RCT; verdicts rely on physiology plus ADF/FMD trials.
11. **Hyperphagic refeeding** after ≥ 2-wk fasts (Dai 2024: +5.5 kg in 9 d) is not captured by labile compartments; the
    appetite module (12) must supply refeed intake.
12. **DXA during fasting** misallocates fat vs lean (hydration); validation should prefer energy/N balance where available.
13. Full texts of Owen 1967/1969, Cahill 1966, Drenick 1964, Yang & Van Itallie 1976 (starvation arm) and Stewart &
    Fleming 1973 were not accessible (scanned PDFs behind bot checks); their numbers are used only as quoted in abstracts
    or other dossiers.

---

## 11. References

1. Hall KD. Predicting metabolic adaptation, body weight change, and energy intake in humans. Am J Physiol Endocrinol Metab. 2010;298(3):E449-E466. PMID 19934407. DOI 10.1152/ajpendo.00559.2009. PMC2838532. https://pmc.ncbi.nlm.nih.gov/articles/PMC2838532/ (equations via dossier 01)
2. Hall KD, Sacks G, Chandramohan D, et al. Quantification of the effect of energy imbalance on bodyweight. Lancet. 2011;378(9793):826-837. PMID 21872751. DOI 10.1016/S0140-6736(11)60812-X. PMC3880593. (via dossier 01)
3. Pietzner M, Uluvar B, Kolnes KJ, et al. Systemic proteome adaptions to 7-day complete caloric restriction in humans. Nat Metab. 2024;6(4):764-777. PMID 38429390. DOI 10.1038/s42255-024-01008-9. PMC7617311. https://pmc.ncbi.nlm.nih.gov/articles/PMC7617311/
4. Kolnes KJ, Nilsen ETF, Brufladt S, et al. Effects of seven days' fasting on physical performance and metabolic adaptation during exercise in humans. Nat Commun. 2025;16:122. PMID 39747857. DOI 10.1038/s41467-024-55418-0. PMC11695724. https://pmc.ncbi.nlm.nih.gov/articles/PMC11695724/
5. Kolnes KJ, Turner LV, Brufladt S, et al. Marked increases in continuous glucose monitor-detected hypoglycemia during a seven-day water-only fast in healthy men and women. J Diabetes Sci Technol. 2026;20(3):659-663. PMID 41724658. DOI 10.1177/19322968261421956. PMC12929083. https://pmc.ncbi.nlm.nih.gov/articles/PMC12929083/
6. Uluvar B, Williamson A, Kolnes KJ, et al. Tissue origins of the plasma proteomic response to glucose ingestion in humans. Diabetologia. 2026. PMID 42467085. DOI 10.1007/s00125-026-06800-8. (abstract: delayed insulin secretion and post-load hyperglycaemia after 7 d fasting)
7. Laurens C, Grundler F, Damiot A, et al. Is muscle and protein loss relevant in long-term fasting in healthy men? A prospective trial on physiological adaptations. J Cachexia Sarcopenia Muscle. 2021;12(6):1690-1703. PMID 34668663. DOI 10.1002/jcsm.12766. PMC8718030. https://pmc.ncbi.nlm.nih.gov/articles/PMC8718030/
8. Dai Z, Zhang H, Wu F, et al. Effects of 10-day complete fasting on physiological homeostasis, nutrition and health markers in male adults. Nutrients. 2022;14(18):3860. PMID 36145236. DOI 10.3390/nu14183860. PMC9503095. https://pmc.ncbi.nlm.nih.gov/articles/PMC9503095/
9. Dai Z, Zhang H, Sui X, et al. Analysis of physiological and biochemical changes and metabolic shifts during 21-day fasting hypometabolism. Sci Rep. 2024;14:28550. PMID 39557965. DOI 10.1038/s41598-024-80049-2. PMC11574170. https://pmc.ncbi.nlm.nih.gov/articles/PMC11574170/
10. Ogłodek E, Pilis W. Is water-only fasting safe? Glob Adv Health Med. 2021;10:21649561211031178. PMID 34414015. DOI 10.1177/21649561211031178. PMC8369953. https://pmc.ncbi.nlm.nih.gov/articles/PMC8369953/
11. Ezpeleta M, Cienfuegos S, Lin S, Pavlou V, Gabel K, Varady KA. Efficacy and safety of prolonged water fasting: a narrative review of human trials. Nutr Rev. 2024;82(5):664-675. PMID 37377031. DOI 10.1093/nutrit/nuad081. PMC11494232. https://pmc.ncbi.nlm.nih.gov/articles/PMC11494232/
12. Wilhelmi de Toledo F, Grundler F, Bergouignan A, Drinda S, Michalsen A. Safety, health improvement and well-being during a 4 to 21-day fasting period in an observational study including 1422 subjects. PLoS One. 2019;14(1):e0209353. PMID 30601864. DOI 10.1371/journal.pone.0209353. PMC6314618. https://pmc.ncbi.nlm.nih.gov/articles/PMC6314618/
13. Finnell JS, Saul BC, Goldhamer AC, Myers TR. Is fasting safe? A chart review of adverse events during medically supervised, water-only fasting. BMC Complement Altern Med. 2018;18(1):67. PMID 29458369. DOI 10.1186/s12906-018-2136-6. PMC5819235. https://pmc.ncbi.nlm.nih.gov/articles/PMC5819235/
14. Gabriel S, Ncube M, Goldman DM, Scharf E, Goldhamer AC, Myers TR. Prolonged water-only fasting followed by a whole-plant-food diet promotes fat-free mass recovery and continued fat mass loss in adults with overweight or obesity. Obes Sci Pract. 2025;11(4):e70086. PMID 40765844. DOI 10.1002/osp4.70086. PMC12322586. https://pmc.ncbi.nlm.nih.gov/articles/PMC12322586/
15. Commissati S, Cagigas ML, Masedunskas A, et al. Prolonged fasting promotes systemic inflammation and platelet activation in humans: a medically supervised, water-only fasting and refeeding study. Mol Metab. 2025;96:102152. PMID 40268190. DOI 10.1016/j.molmet.2025.102152. PMC12088818. https://pmc.ncbi.nlm.nih.gov/articles/PMC12088818/
16. Çamli A, Ülker İ, Terzi M, et al. Duration-dependent effects of water-only fasting on blood lipids: a systematic review, meta-analysis, and threshold meta-regression. Front Nutr. 2026;13:1772246. PMID 41994097. DOI 10.3389/fnut.2026.1772246. PMC13079636. https://pmc.ncbi.nlm.nih.gov/articles/PMC13079636/
17. Grundler F, Mesnage R, Ruppert PMM, Kouretas D, Wilhelmi de Toledo F. Long-term fasting-induced ketosis in 1610 subjects: metabolic regulation and safety. Nutrients. 2024;16(12):1849. PMID 38931204. DOI 10.3390/nu16121849. PMC11206495. https://pmc.ncbi.nlm.nih.gov/articles/PMC11206495/
18. Naëgel A, Viallon M, Ratiney H, et al. Impact of long-term fasting on skeletal muscle: structure, energy metabolism and function using 31P/1H MRS and MRI. J Cachexia Sarcopenia Muscle. 2025;16(2):e13773. PMID 40211897. DOI 10.1002/jcsm.13773. PMC11986369. https://pmc.ncbi.nlm.nih.gov/articles/PMC11986369/
19. Benedict FG. A Study of Prolonged Fasting. Washington, DC: Carnegie Institution of Washington, Publication No. 203; 1915. Public-domain OCR text: https://archive.org/details/studyofprolonged00beneuoft (Table 27 urinary N; body-substance loss summary p. 364; heat production pp. 390–391)
20. Zauner C, Schneeweiss B, Kranz A, et al. Resting energy expenditure in short-term starvation is increased as a result of an increase in serum norepinephrine. Am J Clin Nutr. 2000;71(6):1511-1515. PMID 10837292. DOI 10.1093/ajcn/71.6.1511.
21. Webber J, Macdonald IA. The cardiovascular, metabolic and hormonal changes accompanying acute starvation in men and women. Br J Nutr. 1994;71(3):437-447. PMID 8172872. DOI 10.1079/bjn19940150.
22. Mansell PI, Fellows IW, Macdonald IA. Enhanced thermogenic response to epinephrine after 48-h starvation in humans. Am J Physiol. 1990;258(1 Pt 2):R87-R93. PMID 2405717. DOI 10.1152/ajpregu.1990.258.1.R87.
23. Mansell PI, Macdonald IA. The effect of starvation on insulin-induced glucose disposal and thermogenesis in humans. Metabolism. 1990;39(5):502-510. PMID 2186256. DOI 10.1016/0026-0495(90)90009-2.
24. Nair KS, Woolf PD, Welle SL, Matthews DE. Leucine, glucose, and energy metabolism after 3 days of fasting in healthy human subjects. Am J Clin Nutr. 1987;46(4):557-562. PMID 3661473. DOI 10.1093/ajcn/46.4.557.
25. Browning JD, Baxter J, Satapati S, Burgess SC. The effect of short-term fasting on liver and skeletal muscle lipid, glucose, and energy metabolism in healthy women and men. J Lipid Res. 2012;53(3):577-586. PMID 22140269. DOI 10.1194/jlr.P020867. PMC3276482. https://pmc.ncbi.nlm.nih.gov/articles/PMC3276482/
26. Carlson MG, Snead WL, Campbell PJ. Fuel and energy metabolism in fasting humans. Am J Clin Nutr. 1994;60(1):29-36. PMID 8017334. DOI 10.1093/ajcn/60.1.29.
27. Klein S, Sakurai Y, Romijn JA, Carroll RM. Progressive alterations in lipid and glucose metabolism during short-term fasting in young adult men. Am J Physiol. 1993;265(5 Pt 1):E801-E806. PMID 8238506. DOI 10.1152/ajpendo.1993.265.5.E801.
28. Mittendorfer B, Horowitz JF, Klein S. Gender differences in lipid and glucose kinetics during short-term fasting. Am J Physiol Endocrinol Metab. 2001;281(6):E1333-E1339. PMID 11701450. DOI 10.1152/ajpendo.2001.281.6.E1333.
29. Owen OE, Morgan AP, Kemp HG, Sullivan JM, Herrera MG, Cahill GF Jr. Brain metabolism during fasting. J Clin Invest. 1967;46(10):1589-1595. PMID 6061736. DOI 10.1172/JCI105650. PMC292907. (abstract only accessed)
30. Owen OE, Felig P, Morgan AP, Wahren J, Cahill GF Jr. Liver and kidney metabolism during prolonged starvation. J Clin Invest. 1969;48(3):574-583. PMID 5773093. DOI 10.1172/JCI106016. PMC535723. (abstract only accessed)
31. Owen OE, Smalley KJ, D'Alessio DA, Mozzoli MA, Dawson EK. Protein, fat, and carbohydrate requirements during starvation: anaplerosis and cataplerosis. Am J Clin Nutr. 1998;68(1):12-34. PMID 9665093. DOI 10.1093/ajcn/68.1.12. (abstract only accessed)
32. Cahill GF Jr, Veech RL. Ketoacids? Good medicine? Trans Am Clin Climatol Assoc. 2003;114:149-161. PMID 12813917. PMC2194504.
33. Göschke H, Stahl M, Thölen H. Nitrogen loss in normal and obese subjects during total fast. Klin Wochenschr. 1975;53(13):605-610. PMID 1177405. DOI 10.1007/BF01469679. (abstract)
34. Forbes GB, Drenick EJ. Loss of body nitrogen on fasting. Am J Clin Nutr. 1979;32(8):1570-1574. PMID 463798. DOI 10.1093/ajcn/32.8.1570. (abstract)
35. Elia M, Stubbs RJ, Henry CJ. Differences in fat, carbohydrate, and protein metabolism between lean and obese subjects undergoing total starvation. Obes Res. 1999;7(6):597-604. PMID 10574520. DOI 10.1002/j.1550-8528.1999.tb00720.x. (abstract)
36. Henry CJ, Rivers JP, Payne PR. Protein and energy metabolism in starvation reconsidered. Eur J Clin Nutr. 1988;42(7):543-549. PMID 3066619. (abstract)
37. Bak AM, Møller AB, Vendelbo MH, et al. Differential regulation of lipid and protein metabolism in obese vs. lean subjects before and after a 72-h fast. Am J Physiol Endocrinol Metab. 2016;311(1):E224-E235. PMID 27245338. DOI 10.1152/ajpendo.00464.2015.
38. Høgild ML, Bak AM, Pedersen SB, Rungby J, Frystyk J, Møller N. Growth hormone signaling and action in obese versus lean human subjects. Am J Physiol Endocrinol Metab. 2019;316(2):E333-E344. PMID 30576246. DOI 10.1152/ajpendo.00431.2018.
39. Fisler JS, Drenick EJ, Blumfield DE, Swendseid ME. Nitrogen economy during very low calorie reducing diets: quality and quantity of dietary protein. Am J Clin Nutr. 1982;35(3):471-486. PMID 7064898. DOI 10.1093/ajcn/35.3.471.
40. Fisler JS, Drenick EJ. Calcium, magnesium, and phosphate balances during very low calorie diets of soy or collagen protein in obese men: comparison to total fasting. Am J Clin Nutr. 1984;40(1):14-25. PMID 6540047. DOI 10.1093/ajcn/40.1.14.
41. Sherwin RS. The effect of ketone bodies and dietary carbohydrate intake on protein metabolism. Acta Chir Scand Suppl. 1981;507:30-40. PMID 6947662. (summarises Sherwin 1975 JCI infusion data; see also dossier 03 [81])
42. Sherwin RS. Effect of starvation on the turnover and metabolic response to leucine. J Clin Invest. 1978;61(6):1471-1481. PMID 659610. DOI 10.1172/JCI109067. PMC372673.
43. Sapir DG, Owen OE, Cheng JT, Ginsberg R, Boden G, Walker WG. The effect of carbohydrates on ammonium and ketoacid excretion during starvation. J Clin Invest. 1972;51(8):2093-2102. PMID 5054466. DOI 10.1172/JCI107016. PMC292366.
44. Sapir DG, Owen OE. Renal conservation of ketone bodies during starvation. Metabolism. 1975;24(1):23-33. PMID 234169. DOI 10.1016/0026-0495(75)90004-9.
45. Sigler MH. The mechanism of the natriuresis of fasting. J Clin Invest. 1975;55(2):377-387. PMID 236328. DOI 10.1172/JCI107941. PMC301756.
46. Speakman JR, Westerterp KR. A mathematical model of weight loss under total starvation: evidence against the thrifty-gene hypothesis. Dis Model Mech. 2013;6(1):236-251. PMID 22864023. DOI 10.1242/dmm.010009. PMC3529354. https://pmc.ncbi.nlm.nih.gov/articles/PMC3529354/
47. Kerndt PR, Naughton JL, Driscoll CE, Loxterkamp DA. Fasting: the history, pathophysiology and complications. West J Med. 1982;137(5):379-399. PMID 6758355. PMC1274154. (abstract)
48. Johnson D, Drenick EJ. Therapeutic fasting in morbid obesity. Arch Intern Med. 1977;137(10):1381-1382. PMID 921419.
49. Stewart WK, Fleming LW. Features of a successful therapeutic fast of 382 days' duration. Postgrad Med J. 1973;49(569):203-209. PMID 4803438. DOI 10.1136/pgmj.49.569.203. PMC2495396. (abstract)
50. Drenick EJ, Joven CB, Swendseid ME. Occurrence of acute Wernicke's encephalopathy during prolonged starvation for the treatment of obesity. N Engl J Med. 1966;274(17):937-939. PMID 5908887. DOI 10.1056/NEJM196604282741705. (title/abstract record only)
51. Ho KY, Veldhuis JD, Johnson ML, et al. Fasting enhances growth hormone secretion and amplifies the complex rhythms of growth hormone secretion in man. J Clin Invest. 1988;81(4):968-975. PMID 3127426. DOI 10.1172/JCI113450. PMC329619.
52. Hartman ML, Veldhuis JD, Johnson ML, et al. Augmented growth hormone (GH) secretory burst frequency and amplitude mediate enhanced GH secretion during a two-day fast in normal men. J Clin Endocrinol Metab. 1992;74(4):757-765. PMID 1548337. DOI 10.1210/jcem.74.4.1548337.
53. Chan JL, Heist K, DePaoli AM, Veldhuis JD, Mantzoros CS. The role of falling leptin levels in the neuroendocrine and metabolic adaptation to short-term starvation in healthy men. J Clin Invest. 2003;111(9):1409-1421. PMID 12727933. DOI 10.1172/JCI17490. PMC154448. https://pmc.ncbi.nlm.nih.gov/articles/PMC154448/
54. Bergendahl M, Iranmanesh A, Mulligan T, Veldhuis JD. Impact of age on cortisol secretory dynamics basally and as driven by nutrient-withdrawal stress. J Clin Endocrinol Metab. 2000;85(6):2203-2214. PMID 10852453. DOI 10.1210/jcem.85.6.6628.
55. Bergendahl M, Iranmanesh A, Pastor C, Evans WS, Veldhuis JD. Homeostatic joint amplification of pulsatile and 24-hour rhythmic cortisol secretion by fasting stress in midluteal phase women. J Clin Endocrinol Metab. 2000;85(11):4028-4035. PMID 11095428. DOI 10.1210/jcem.85.11.6945.
56. Espelund U, Hansen TK, Højlund K, et al. Fasting unmasks a strong inverse association between ghrelin and cortisol in serum: studies in obese and normal-weight subjects. J Clin Endocrinol Metab. 2005;90(2):741-746. PMID 15522942. DOI 10.1210/jc.2004-0604.
57. Natalucci G, Riedl S, Gleiss A, Zidek T, Frisch H. Spontaneous 24-h ghrelin secretion pattern in fasting subjects: maintenance of a meal-related pattern. Eur J Endocrinol. 2005;152(6):845-850. PMID 15941923. DOI 10.1530/eje.1.01919.
58. Spaulding SW, Chopra IJ, Sherwin RS, Lyall SS. Effect of caloric restriction and dietary composition on serum T3 and reverse T3 in man. J Clin Endocrinol Metab. 1976;42(1):197-200. PMID 1249190. DOI 10.1210/jcem-42-1-197.
59. Sävendahl L, Underwood LE. Fasting increases serum total cholesterol, LDL cholesterol and apolipoprotein B in healthy, nonobese humans. J Nutr. 1999;129(11):2005-2008. PMID 10539776. DOI 10.1093/jn/129.11.2005.
60. Horton TJ, Hill JO. Prolonged fasting significantly changes nutrient oxidation and glucose tolerance after a normal mixed meal. J Appl Physiol. 2001;90(1):155-163. PMID 11133906. DOI 10.1152/jappl.2001.90.1.155.
61. Knapik JJ, Jones BH, Meredith C, Evans WJ. Influence of a 3.5 day fast on physical performance. Eur J Appl Physiol Occup Physiol. 1987;56(4):428-432. PMID 3622486. DOI 10.1007/BF00417770.
62. Knapik JJ, Meredith CN, Jones BH, Suek L, Young VR, Evans WJ. Influence of fasting on carbohydrate and fat metabolism during rest and exercise in men. J Appl Physiol. 1988;64(5):1923-1929. PMID 3292504. DOI 10.1152/jappl.1988.64.5.1923.
63. Loy SF, Conlee RK, Winder WW, Nelson AG, Arnall DA, Fisher AG. Effects of 24-hour fast on cycling endurance time at two different intensities. J Appl Physiol. 1986;61(2):654-659. PMID 3745057. DOI 10.1152/jappl.1986.61.2.654.
64. Hasselbalch SG, Knudsen GM, Jakobsen J, et al. Blood-brain barrier permeability of glucose and ketone bodies during short-term starvation in humans. Am J Physiol. 1995;268(6 Pt 1):E1161-E1166. PMID 7611392. DOI 10.1152/ajpendo.1995.268.6.E1161.
65. Templeman I, Smith HA, Chowdhury E, et al. A randomized controlled trial to isolate the effects of fasting and energy restriction on weight loss and metabolic health in lean adults. Sci Transl Med. 2021;13(598):eabd8034. PMID 34135111. DOI 10.1126/scitranslmed.abd8034.
66. Catenacci VA, Pan Z, Ostendorf D, et al. A randomized pilot study comparing zero-calorie alternate-day fasting to daily caloric restriction in adults with obesity. Obesity (Silver Spring). 2016;24(9):1874-1883. PMID 27569118. DOI 10.1002/oby.21581. PMC5042570.
67. Heilbronn LK, Smith SR, Martin CK, Anton SD, Ravussin E. Alternate-day fasting in nonobese subjects: effects on body weight, body composition, and energy metabolism. Am J Clin Nutr. 2005;81(1):69-73. PMID 15640462. DOI 10.1093/ajcn/81.1.69.
68. Heilbronn LK, Civitarese AE, Bogacka I, Smith SR, Hulver M, Ravussin E. Glucose tolerance and skeletal muscle gene expression in response to alternate day fasting. Obes Res. 2005;13(3):574-581. PMID 15833943. DOI 10.1038/oby.2005.61.
69. Hutchison AT, Liu B, Wood RE, et al. Effects of intermittent versus continuous energy intakes on insulin sensitivity and metabolic risk in women with overweight. Obesity (Silver Spring). 2019;27(1):50-58. PMID 30569640. DOI 10.1002/oby.22345.
70. Stekovic S, Hofer SJ, Tripolt N, et al. Alternate day fasting improves physiological and molecular markers of aging in healthy, non-obese humans. Cell Metab. 2019;30(3):462-476.e6. PMID 31471173. DOI 10.1016/j.cmet.2019.07.016.
71. Hollstein T, Basolo A, Ando T, Krakoff J, Piaggi P. Reduced adaptive thermogenesis during acute protein-imbalanced overfeeding is a metabolic hallmark of the human thrifty phenotype. Am J Clin Nutr. 2021;114(4):1396-1407. PMID 34225360. DOI 10.1093/ajcn/nqab209. PMC8488870. (24-h fasting vs energy-balance 24EE, median −177 kcal/d)
72. Vandenberghe C, St-Pierre V, Courchesne-Loyer A, Hennebelle M, Castellano CA, Cunnane SC. Caffeine intake increases plasma ketones: an acute metabolic study in humans. Can J Physiol Pharmacol. 2017;95(4):455-458. PMID 28177691. DOI 10.1139/cjpp-2016-0338.
73. Tey SL, Salleh NB, Henry J, Forde CG. Effects of aspartame-, monk fruit-, stevia- and sucrose-sweetened beverages on postprandial glucose, insulin and energy intake. Int J Obes (Lond). 2017;41(3):450-457. PMID 27956737. DOI 10.1038/ijo.2016.225.
74. Merimee TJ, Tyson JE. Stabilization of plasma glucose during fasting: normal variations in two separate studies. N Engl J Med. 1974;291(24):1275-1278. PMID 4431434. DOI 10.1056/NEJM197412122912404. (no abstract; cited for the sex difference only through [75] and 05)
75. Merimee TJ, Tyson JE. Hypoglycemia in man: pathologic and physiologic variants. Diabetes. 1977;26(3):161-165. PMID 190073. DOI 10.2337/diab.26.3.161. (72-h fasts in 60 women, 20 men, 16 obese; obese never < 55 mg/dL)
76. Bistrian BR, Sherman M, Young V. The mechanisms of nitrogen sparing in fasting supplemented by protein and carbohydrate. J Clin Endocrinol Metab. 1981;53(4):874-878. PMID 7287871. DOI 10.1210/jcem-53-4-874.
77. Yang MU, Van Itallie TB. Composition of weight lost during short-term weight reduction: metabolic responses of obese subjects to starvation and low-calorie ketogenic and nonketogenic diets. J Clin Invest. 1976;58(3):722-730. PMID 956398. DOI 10.1172/JCI108519. PMC333231. (starvation-arm numbers UNVERIFIED; abstract truncated)
78. Johnstone AM, Faber P, Gibney ER, et al. Effect of an acute fast on energy compensation and feeding behaviour in lean men and women. Int J Obes Relat Metab Disord. 2002;26(12):1623-1628. PMID 12461679. DOI 10.1038/sj.ijo.0802151. (via dossier 13)
79. Boden G, Chen X, Mozzoli M, Ryan I. Effect of fasting on serum leptin in normal human subjects. J Clin Endocrinol Metab. 1996;81(9):3419-3423. PMID 8784108. DOI 10.1210/jcem.81.9.8784108. (via dossier 13)
80. Heyman SN, Bursztyn M, Szalat A, et al. Fasting-induced natriuresis and SGLT: a new hypothesis for an old enigma. Front Endocrinol (Lausanne). 2020;11:217. PMID 32457696. DOI 10.3389/fendo.2020.00217. PMC7221140. (via dossier 13)
81. Vazquez JA, Kazi U, Madani N. Protein metabolism during weight reduction with very-low-energy diets: evaluation of the independent effects of protein and carbohydrate on protein sparing. Am J Clin Nutr. 1995;62(1):93-103. PMID 7598072. DOI 10.1093/ajcn/62.1.93. (via dossier 13)
82. Trepanowski JF, Kroeger CM, Barnosky A, et al. Effect of alternate-day fasting on weight loss, weight maintenance, and cardioprotection among metabolically healthy obese adults: a randomized clinical trial. JAMA Intern Med. 2017;177(7):930-938. PMID 28459931. DOI 10.1001/jamainternmed.2017.0936. PMC5680777.
83. Roman YM, Dominguez MC, Easow TM, et al. Effects of intermittent versus continuous dieting on weight and body composition in obese and overweight people: a systematic review and meta-analysis of randomized controlled trials. Int J Obes (Lond). 2019;43(10):2017-2027. PMID 30206335. DOI 10.1038/s41366-018-0204-0. (via dossier 13)
84. Wei M, Brandhorst S, Shelehchi M, et al. Fasting-mimicking diet and markers/risk factors for aging, diabetes, cancer, and cardiovascular disease. Sci Transl Med. 2017;9(377):eaai8700. PMID 28202779. DOI 10.1126/scitranslmed.aai8700. PMC6816332. (via dossiers 08, 13)
85. Mathieson RA, Walberg JL, Gwazdauskas FC, et al. The effect of varying carbohydrate content of a very-low-caloric diet on resting metabolic rate and thyroid hormones. Metabolism. 1986;35(5):394-398. PMID 3702673. DOI 10.1016/0026-0495(86)90126-5. (via dossier 13)
86. McDougal DH, Darpolor MM, DuVall MA, et al. Glial acetate metabolism is increased following a 72-h fast in metabolically healthy men and correlates with susceptibility to hypoglycemia. Acta Diabetol. 2018;55:1029-1036. PMID 29931424. DOI 10.1007/s00592-018-1180-5. PMC6153507. (via dossier 05)
87. Haymond MW, Karl IE, Clarke WL, Pagliara AS, Santiago JV. Differences in circulating gluconeogenic substrates during short-term fasting in men, women, and children. Metabolism. 1982;31:33-42. PMID 7043160. (via dossier 05)
88. Neudorf H, Sandilands RE, Ursel S, et al. Altered immunometabolic response to fasting in humans living with obesity. iScience. 2025;28:112872. PMID 40662191. DOI 10.1016/j.isci.2025.112872. PMC12256293. (via dossier 05)
89. Owen OE, Reichard GA Jr. Human forearm metabolism during progressive starvation. J Clin Invest. 1971;50:1536-1545. PMID 5090067. DOI 10.1172/JCI106639. PMC292094. (via dossier 05)
90. Deru LS, Bikman BT, Davidson LE, et al. The effects of exercise on β-hydroxybutyrate concentrations over a 36-h fast: a randomized crossover study. Med Sci Sports Exerc. 2021;53:1987-1998. PMID 33731648. DOI 10.1249/MSS.0000000000002655. (via dossier 05)
91. Clayton DJ, James LJ, Sale C, Templeman I, Betts JA, Varley I. Severely restricting energy intake for 24 h does not affect markers of bone metabolism at rest or in response to re-feeding. Eur J Nutr. 2020;59(8):3527-3535. PMID 32016644. DOI 10.1007/s00394-020-02186-4. PMC7669762.

Internal cross-references: dossiers 01, 02, 03, 04, 05, 07, 08, 12, 13, 15, 17, 18, 19, 21 (this repository, `research/`).
Reference implementation used for all MODEL numbers: hourly Python script (fastsim.py / refeed.py) implementing §4B.1 with
the parameters of §4B.2; kept in the session scratchpad, not in the repository.
