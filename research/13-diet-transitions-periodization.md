# 13 — Diet transitions, periodisation, PSMF/VLCD, refeeds & diet breaks, intermittent/periodic fasting, scale-weight transients

Dossier owner: research agent 13 · Compiled 2026-09-30 · Protocol: `research/RESEARCH_PROTOCOL.md`
Cross-references: 01 body-weight models, 02 energy expenditure/adaptation, 03 protein/MPS, 04 glycogen/insulin,
05 ketosis/fat oxidation, 06 lipids, 07 meal timing/fasting schedules, 08 autophagy, 09 resistance training,
10 cardio, 11 surplus, 12 hormones/appetite, 14 body-composition estimation, 15 fibre/sodium/water, 16 sex/menstrual,
17 safety, 18 planner, 19 performance, 20 fasting physiology (in-depth; this dossier covers only the sequencing,
transition and periodisation-verdict side of fasting).

> Naming rule honoured: named diets appear only as literature search terms. Every regime below is defined by
> energy (% of maintenance = TDEE), grams per kg (body weight BW, lean body mass LBM, or ideal body weight IBW —
> always stated), macronutrient % energy, timing and duration.

---

## 1. Scope

1. What the body does in the days-to-weeks after a **change** of macronutrient pattern, energy level or fasting state
   (very-low-carbohydrate ⇄ high-carbohydrate, ⇄ very-low-fat, ⇄ protein-only very-low-energy, ⇄ zero-energy fasts),
   expressed as implementable transient dynamics (magnitude, onset, time-constant, reversal).
2. A **scale-weight decomposition** so the simulator can show "scale weight" separately from fat mass: glycogen-bound
   water, carbohydrate/insulin-sensitive sodium-water, dietary-sodium steps, gut-content mass, exercise plasma-volume,
   menstrual and weekly rhythms, measurement noise.
3. The net evidence for **deliberately sequencing** patterns (periodisation): PSMF/VLCD blocks, fast vs slow loss,
   refeeds, diet breaks, calorie/carb cycling, 5:2/ADF, periodic water-only fasts, cyclical very-low-carb,
   train-low/sleep-low, physique gain→cut→recover cycles, reverse dieting, "metabolic flexibility" training.
4. A catalogue of **regime building blocks** with safety limits that the planner (18) may combine, and validation targets.

### Headline conclusions (for the orchestrator)
- **No periodisation strategy has shown a fat-loss or lean-mass advantage over a linear regime at equal weekly energy
  and protein** that survives replication. Best-case effects are small (RMR ≈ tens of kcal/d; lean mass ≈ ±0.5–0.9 kg)
  and inconsistent in sign (Roman 2019 [84] vs Campbell 2020 [80]); appetite/adherence benefits of diet breaks are
  the most consistent real effect (ICECAP [78], Siedler [82]).
- **Every macro switch has a price** in transients: 1–3 kg scale swings within 1–5 days, ~2–5 days of induction
  symptoms on entering very-low-carb, loss of fat-adaptation in ~5–6 days, glucose-intolerance on carbohydrate
  re-entry lasting days (short restriction) to ≥5–9 weeks (months of restriction; Jansen 2022 [12]).
- "Week-1 loss" on very-low-carb is mostly water: an 800-kcal ketogenic diet lost 467 g/d vs 278 g/d on an isocaloric
  mixed diet, yet **fat loss was identical (≈163 vs 165 g/d)** (Yang & Van Itallie 1976 [1], derived).
- PSMF (≈1.2–1.5 g protein/kg IBW, <20–50 g carbohydrate, no added fat, ≈600–900 kcal) is effective, supervised
  clinical therapy for BMI ≥30 (or ≥27 + comorbidity), 1–3 kg/wk; it is **not** a validated tool in lean trained people.
- Rate of loss does not change long-term regain (Purcell [64], Vink [65]); faster loss costs slightly more FFM/RMR.
- Water-only fasts: the lean-tissue loss is mostly water/glycogen and returns within ~3 days of refeeding; fat loss
  equal to the energy deficit is kept (Pietzner 2024 [130]); fasting per se confers no extra fat loss at equal energy
  (Templeman 2021 [93]).

---

## 2. State variables

Variables owned by other dossiers are listed only if this module reads them (marked "read").

| Name | Unit | Typical range | Represents | Initial-value rule |
|---|---|---|---|---|
| `G_liv`, `G_mus` (read, 04) | g | liver 0–150; muscle 150–900 | Glycogen pools | From 04 steady state for habitual carbohydrate intake |
| `W_gw` | kg | 0.3–3.0 | Water bound to glycogen = h·(G_liv+G_mus)/1000 | Computed |
| `E_cna` | L (≈kg) | −1.0 … +0.2 | Carbohydrate/insulin-sensitive extracellular water (natriuresis of low insulin/fasting; antinatriuresis on carbohydrate) | 0 if habitual carbohydrate ≥100 g/d; else −E_max·(1−C/100) |
| `S_na` | mmol | −150 … +300 | Sodium retained after a change of sodium intake (renal escape lag) | 0 |
| `Na_hab` | mmol/d | 40–300 | Habitual sodium set-point the kidney has adapted to | = current sodium intake |
| `M_gut` | kg | 0.1–1.0 | Gut content mass at a morning, post-void weigh-in | Steady state from fibre & transit (§4.5) |
| `P_ex` | L | 0–0.5 | Exercise-induced plasma-volume expansion + damage oedema | 0 |
| `W_mc` | kg | 0–0.5 | Menstrual-cycle water term (women; default small) | From cycle day |
| `A_f`, `A_s` | 0–1 | — | Carbohydrate-tolerance adaptation, fast and slow components (1 = fully carbohydrate-adapted) | A*(habitual carbohydrate) |
| `F_ad` | 0–1 | — | Exercise fat-adaptation index (0 = high-carbohydrate adapted, 1 = fully adapted to <50 g/d, ≥65 %E fat) | F*(habitual diet) |
| `Φ_ind` | 0–1 | — | Induction ("keto-flu") symptom intensity | 0 |
| `U_food` | g/d | 800–2500 | Habitual food mass the gut has adapted to (ad-lib appetite carry-over, §4.13) | Current food mass |
| `B_cum` | kcal | −10 000 … +5 000 | Exponentially weighted cumulative energy balance (τ ≈ 3 d) used by leptin/T3 hooks (12) | 0 |
| `D_def` | days | 0–365 | Consecutive days in energy deficit ≥10 % (diet-break logic, 02/12) | 0 |
| `H_fast` | h | 0–240 | Hours since last energy intake >~50 kcal | From schedule |
| `N_lowintake` | days | 0–30 | Consecutive days with intake <~10 kcal/kg (refeeding-risk counter, §9) | 0 |
| `T_block` | days | 0–… | Days since the current regime block started | 0 |
| `GB_risk` | relative hazard | 1–10 | Gallstone risk multiplier (§4.14) | 1 |
| `W_scale` | kg | — | Displayed scale weight = true tissue + labile compartments + noise | Measured BW |
| `W_true` | kg | — | FM + FFM_core (protein, mineral, hydration water at 0.73 L/kg FFM_core) from 01/03 | From 14 |

---

## 3. Inputs that drive it

| Input | Unit | How it enters |
|---|---|---|
| Energy intake | kcal/d and fraction of TDEE | Sets energy balance (01); deficit severity for FFM fraction (§4.15–4.16); `B_cum`; fasting flags |
| Net carbohydrate | g/d, g/kg BW | Glycogen (04) → `W_gw`; `E_cna` target; `A*`; `F*`; T3 hook; ketosis (05) |
| Sugars share of carbohydrate | % | TG response on very-low-fat/high-carbohydrate (§4.12, 06) |
| Fat | g/d, %E, **max single-meal fat (g)** | `F*`; gallbladder emptying threshold 10 g/meal (§4.14) |
| Protein | g/kg BW, g/kg IBW | Nitrogen balance in VLCD/PSMF (§4.15); lean retention (03) |
| Fibre (non-starch polysaccharide) | g/d | Stool mass → `M_gut` (§4.5); gut adaptation (15) |
| Food wet mass | g/d | `U_food` (ad-lib mode only) |
| Sodium | mmol/d (1 g Na = 43.5 mmol) | `S_na`, `Na_hab` (§4.4) |
| Fasting hours / eating window | h | `H_fast`; entry/exit dynamics (§4.18; physiology in 20/07) |
| Exercise: glycogen-depleting, high-intensity, eccentric sessions | flags + dose | `P_ex`; glycogen (04); speed of fat-oxidation matching (§4.9) |
| Training status, BF %, BMI, sex, age, menstrual day, diabetes/medications | — | Moderators; safety gates (§9, 17) |

---

## 4. Mechanisms & equations

### 4.1 Scale-weight decomposition (core of every transition)

**Mechanism.** After any diet switch the scale moves first through fast, labile compartments (glycogen + its water,
sodium-linked extracellular water, gut contents, plasma volume) and only slowly through fat and protein. The UI must
plot `W_scale` and `FM` separately, and DXA/BIA "lean" validation targets must include the labile terms (DXA lean
contains glycogen and water; see Peos 2021 [79]: +0.7 kg "FFM" in a 1-week diet break with no fat change).

```
W_scale(t) = W_true(t)                         # FM + FFM_core from 01/03
           + G(t)/1000 · (1 + h)               # glycogen mass + bound water, G = G_liv + G_mus (g)
           + E_cna(t) + S_na(t)/140            # carbohydrate-sensitive ECF + dietary-sodium ECF (L ≈ kg)
           + (M_gut(t) − M_gut,ref)            # gut contents relative to reference used when W_true was initialised
           + P_ex(t) + W_mc(t)                 # plasma volume / oedema, menstrual term
           + R_week(dow) · W_true              # optional weekly rhythm (free-living mode only)
           + ε(t),  ε ~ N(0, (σ·W_true)²)
```
Isosmotic rule: 140 mmol Na retained ≈ 1 L extracellular water ≈ 1 kg (consistent with Heyman 2020 [28]:
~70 mEq/d extra Na reabsorption ≈ 0.5 L/d water retention after a 24-h fast).

| Symbol | Value | Unit | Uncertainty | Source |
|---|---|---|---|---|
| h | 3.0 | g water / g glycogen | 2.7–4.0 | Fernández-Elías 2015 [6] (≥3:1 when water restricted); Kreitzman 1992 [2] (3–4); Shiose 2016 [7] (2.7–4); classic body-water/glycogen link: Olsson & Saltin 1970 [8] |
| σ (day-to-day noise SD) | 0.35 % of BW | — | 0.25–0.6 % | PROPOSED; Lipsitz 1985 [125] CV 0.6 % over 2–4 wk includes true change |
| R_week amplitude | 0.35 % peak-to-trough, max Sun/Mon, min Fri | — | — | Turicchi 2020 [123] (n=1,421); Orsama 2014 [124] |
| Holiday (Christmas) step | +1.35 % not fully reversed | — | — | Turicchi 2020 [123] |

**Evidence grade:** B for glycogen-water and weekly rhythm; C for the additive decomposition as a whole (each term
validated separately, never jointly).

### 4.2 Glycogen-bound water on switches (dynamics of G owned by 04)

**Mechanism.** Glycogen is stored hydrated (≈3 g water/g) with potassium (0.45 mmol K/g) [2]. Dropping carbohydrate
empties liver glycogen within ~1–2 days (in a fast, net hepatic glycogenolysis supplies 36 % of glucose output over the
first 22 h, 18 % over the next 14 h and ~4 % thereafter — Rothman 1991 [11]) and muscle glycogen over days; adding
carbohydrate refills muscle to maximum within 24 h at ~10 g/kg/d when inactive (Bussau 2002 [9]).

Data points for implementation (conversion 1 mmol glucosyl = 0.162 g):
- Bussau [9]: muscle 95 → 180 mmol/kg wet muscle (15.4 → 29.2 g/kg) after 1 day at 10 g CHO/kg/d; no further gain on days 2–3.
- Sherman 1981 [10] (with a 5-day depletion-taper exercise sequence): 3 d at 15 % CHO then 3 d at 70 % → 207 mmol/kg
  ww; 3 d at 50 % then 3 d at 70 % → 203; 6 d at 50 % → 159. The high-carbohydrate days, not the preceding
  low-carbohydrate phase, drive supercompensation (≈ +30 % over a moderate diet); performance in a 20.9-km run was not
  improved.
- Shiose 2016 [7]: 72 h at 12 g/kg/d after depletion: 72.7 → 169.4 mmol/kg ww; total body water (D₂O) 39.3 → 40.2 kg.
- Kojima 2025 [145]: 6 → 10 g/kg/d for 72 h without exercise: glycogen +23 %, body mass/FFM/water increased.
- Whole-body check: muscle glycogen capacity ≈ 0.029 kg/kg muscle × skeletal-muscle mass (14) → ~0.85 kg for 30 kg
  muscle at saturation; typical mixed-diet store ≈ 0.45–0.5 kg (derived from [9]).

Transition rule: ΔW_gw = h·ΔG; total labile mass change from glycogen = (1+h)·ΔG ≈ 4·ΔG.
**Validation (Hall 2016 [3]):** switching a 50 %-CHO diet to a 5 %-CHO isocaloric diet was "followed by a rapid
additional 1.6 ± 0.2 kg" loss (early KD period), attributed mainly to body water; body-fat loss in days 1–15 of the ketogenic diet was only
0.2 ± 0.1 kg (vs 0.5 ± 0.1 kg over the last 15 days of the baseline diet). With ΔG ≈ −300 g, (1+h)ΔG ≈ −1.2 kg; the
remainder (~0.4 kg) is `E_cna` (§4.3).

**Grade:** A/B (multiple controlled human studies for h and refill kinetics).

### 4.3 Carbohydrate/insulin-sensitive natriuresis and antinatriuresis (`E_cna`)

**Mechanism.** Low insulin, low filtered glucose (less SGLT-coupled Na reabsorption), glucagon and obligatory cation
excretion with ketoacid anions cause natriuresis during fasting and carbohydrate restriction; carbohydrate refeeding
reverses it immediately (Heyman 2020 review [28]). Early fasting weight loss "averaging 0.9 kg per day during the
first week" is "primarily due to negative sodium balance" (Kerndt 1982 [29]). A fasting patient showed peak natriuresis
68 mEq/d with −0.9 L fluid and −0.9 kg; moving from a 24-h fast to meals adds ~70 mEq/d Na uptake ≈ +0.5 L/d [28].

**Equation (PROPOSED FIT):**
```
E*_cna = −E_max · max(0, 1 − C/C_ref) · (1 + k_fast · I[EI < 0.1·TDEE])
dE_cna/dt = (E*_cna − E_cna)/τ,  τ = τ_down if E* < E_cna else τ_up
```
| Symbol | Value | Unit | Uncertainty | Basis |
|---|---|---|---|---|
| C_ref | 100 | g/d | 50–150 | PROPOSED; natriuresis evident on ketogenic/fasting states, absent on mixed diets [1,3,29] |
| E_max | 0.6 | L | 0.3–1.0 | Fitted: Hall 2016 residual ≈0.4 L [3]; Yang: KD water loss exceeded mixed-diet water loss by ≈1.8 kg/10 d, of which ≈1.2–1.4 kg glycogen-linked [1] |
| k_fast | 0.5 | — | 0–1 | Fasting adds natriuresis beyond carbohydrate restriction [28,29] |
| τ_down | 1.5 | d | 1–3 | Peak natriuresis within the first days of fasting [28,29] |
| τ_up | 0.7 | d | 0.3–1.5 | "Abrupt reversal following glucose"; +0.5 L/d on refeeding [28] |

Data points used: Yang & Van Itallie [1] 800-kcal ketogenic vs mixed: water 61.2 % of 466.6 g/d (=286 g/d) vs 37.1 %
of 277.9 g/d (=103 g/d) over 10 days; Hall 2016 [3] 1.6 kg rapid loss; Heyman [28] 0.5 L/d reversal; Kerndt [29].
**Grade:** C (mechanism well established; the lumped E_max/τ are fitted to few human data points).

### 4.4 Dietary-sodium steps (`S_na`)

**Mechanism.** A step up in salt intake is excreted with a lag, retaining sodium + water transiently; at a new steady
state total body water is not measurably raised (Heer 2000 [119]: NaCl 50 → 550 mmol/d raised plasma volume by
315 mL but not TBW or body mass). Sodium excretion also shows a ~7-day infradian rhythm at constant intake (Birukov 2016 [120]).

```
dS_na/dt   = (Na_in − Na_hab) − S_na/τ_Na        # mmol/d
dNa_hab/dt = (Na_in − Na_hab)/τ_hab
water_salt = S_na/140  (L)
```
| Symbol | Value | Unit | Uncertainty | Basis |
|---|---|---|---|---|
| τ_Na | 1.0 | d | 0.5–2 | PROPOSED (renal escape within days) |
| τ_hab | 5 | d | 3–10 | PROPOSED; forces TBW back to baseline at steady state, consistent with [119] |

Magnitude produced: a +100 mmol/d step (≈ +2.3 g Na, ≈ +5.8 g salt) gives a peak ≈ +50–70 mmol → +0.4–0.5 kg at
days 1–3, gone by ~2 weeks. **Grade:** C/D (direction B; parameters PROPOSED).

### 4.5 Gut-content mass (`M_gut`)

**Mechanism.** Unabsorbed residue (fibre + bacterial mass + water) occupies the colon for the transit time. Food mass
and fibre can differ by >1 kg/d and ~58 g/d between patterns (Sciarrillo 2024 [5]), so switching from a zero-fibre to
a high-fibre pattern (or starting a fast) moves the scale independently of tissue.

```
M_gut*(t) = (S_0 + 5 · NSP_g) · T_tr / 1000        # kg, morning post-void weigh-in
dM_gut/dt = (M_gut* − M_gut) / τ_gut,  τ_gut = T_tr/2 when filling, τ_empty = 1.5 d when EI ≈ 0
```
| Symbol | Value | Unit | Uncertainty | Source |
|---|---|---|---|---|
| S_0 (stool on low-fibre white-bread diet) | men 162, women 83 | g/d | SE ±11 | Stephen 1986 [117] |
| slope | 5 | g stool per g NSP | — | Stephen 1986 [117] |
| T_tr | 2.0 (men), 3.0 (women) | d | 1.5–3.5 | Stephen 1986 [117]: 48.6 h non-methane vs 84.6 h methane producers; sex difference explained by transit |
| Colon volume (fasted) | ≈0.56 | L | wide | Pritchard 2014 [118] (AC 203, TC 198, DC 160 mL) |

Example (woman): 0 g NSP → 0.25 kg; 40 g NSP → (83+200)·3/1000 ≈ 0.85 kg (fibre also shortens transit, so ≈0.6–0.8 kg).
**PROPOSED FIT, grade C.** Coordinate fibre dose-tolerance and SCFA with 15.

### 4.6 Other labile water terms

- **Exercise plasma-volume expansion** (`P_ex`): a single intense interval session (8 × 4 min at 85 % VO₂max) expanded
  plasma volume by 4.5 ± 0.7 mL/kg (10 %) at 24 h (Gillen 1991 [121]); training-induced PV expansion occurs
  "immediately", red-cell expansion over weeks (Sawka 2000 [148]; Convertino 2007 [122]). Implement ΔP_ex = +4.5 mL/kg per hard
  session, decay τ = 2 d (PROPOSED). Eccentric-damage limb swelling peaks at 48–72 h (e.g. thigh circumference
  +6.6 mm day 3 [146]); whole-body mass effect not quantified — optional 0.1–0.3 kg, grade D.
- **Menstrual term** (`W_mc`, coordinate 16): self-reported fluid retention peaks on day 1 of menses and rises over the
  ~11 days around ovulation (White 2011 [126], 765 cycles), but objective studies found **no significant change in body
  weight or total body water** across phases (Takano 2026 [127]; Bisson 1992 [128], no luteal renal Na retention);
  ovarian hormones shift osmoregulation with only minor TBW effect (Stachenfeld 2008 [129]). Default amplitude
  0.2 kg (range 0–0.5; **UNVERIFIED**), peak day 1 of flow, grade D.
- **Weekly & holiday rhythms**: §4.1 table. These are real intake patterns, applied only when the user schedules
  identical days but selects "free-living realism".
- **Cortisol/"whoosh" water retention during prolonged dieting**: widely claimed, no quantitative human data located —
  do not model (grade D).

### 4.7 Apparent vs real fat loss in the first weeks (energy density of weight change)

**Mechanism.** Early weight loss is water/glycogen-rich, so its energy content is low and rises over ~4–6 weeks (01).
- Yang & Van Itallie 1976 [1] (6 obese adults, three 10-day periods): ketogenic 800 kcal: 466.6 ± 51.3 g/d, composition
  water 61.2 %, fat 35.0 %, protein 3.8 %; mixed 800 kcal: 277.9 ± 32.1 g/d, water 37.1 %, fat 59.5 %, protein 3.4 %.
  Derived fat loss: **163 vs 165 g/d (identical)**; protein 17.7 vs 9.4 g/d; water 286 vs 103 g/d.
- Heymsfield 2012 [75]: energy content of weight lost 4,858 ± 388 kcal/kg at week 4 → 6,041 ± 376 at week 6, stable
  thereafter; women 6,804 vs men 6,119 kcal/kg (Kiel cohort).
- Hall 2008 [76]: energy per kg lost depends on initial fat and magnitude of loss (Forbes-type partition; 01).

**Rule:** fat change must always come from the energy-balance/partition model (01); this module only adds labile terms.
UI: show "of the 2.4 kg lost this week, ~0.5 kg is fat". **Grade:** A/B.

### 4.8 Carbohydrate-tolerance adaptation (OGTT readiness, postprandial glucose on re-entry)

**Mechanism.** Carbohydrate restriction lowers muscle glucose uptake/oxidation capacity (↑PDK4, ↓GLUT4, ↓AMPK —
Hengist 2024 [19]; ↓PDH activity [23]) and first-phase insulin secretion (Numao 2012 [13]); tissues favour fat
("physiological/glucose-sparing insulin resistance"). On carbohydrate re-entry glucose excursions are exaggerated
until the machinery re-adapts. Two time scales are evident:
- **Fast (days):** 3 days of ~69 %-fat eucaloric diet raised OGTT glucose iAUC and lowered first-phase insulin in
  healthy young men (Numao 2012 [13]; replicated [30,147]). 5 days of 69 %-fat diet raised 30-min OGTT glucose in
  cyclists, persisting at days 10 and 15 (Goedecke 1999 [17]). Isocaloric 4-wk ketogenic diet raised glucose AUC to
  both mixed and ketogenic test meals (Rosenbaum 2019 [18]).
- **Slow (weeks):** after 14–15 weeks of a very-low-carbohydrate diet (+15 % weight loss), 2-h OGTT glucose was
  8.1–8.7 mmol/L (abnormal ≥7.8 in 17/25 later switched to 57 % carbohydrate). On the high-carbohydrate diets, 2-h
  glucose kept falling after week 1 (−0.07 to −0.10 mmol/L per week, weeks 2–9; change-point ≈5 weeks) and abnormal
  OGTTs fell from 17 to 9 of 25; the group staying very-low-carbohydrate stayed 10/16 abnormal (Jansen 2022 [12]).
- The classic "≥150 g carbohydrate/day for 3 days before an OGTT" (historical basis: OGTTs after various carbohydrate
  intakes, Wilkerson 1960 [16]; Crowe 2000 [14]: no effect of
  the preparatory diet in pregnant women on usual diets; Hughes 1975 [15]: 150 vs 300 g/d equivalent) holds for people
  on ordinary diets but **not** after months of very-low-carbohydrate intake (Jansen [12]).
- Some ketogenic-diet changes seen at week 4 (fasting glucose, ApoB, CRP) were no longer apparent at week 12 despite
  sustained ketosis (Hengist 2024 [19]) — adaptation continues for months.

**Equation (PROPOSED FIT):**
```
A*(C)   = min(1, [C/(C + K_A)] / [C_ref/(C_ref + K_A)])       # C = mean carbohydrate g/d over the last 24 h
dA_f/dt = (A* − A_f)/τ_f
dA_s/dt = (A* − A_s)/τ_s
ΔG_2h   = a_f·(1 − A_f) + a_s·(1 − A_s)                        # mmol/L added to the person's carbohydrate-adapted 2-h OGTT value
ΔiAUC_meal_rel = b_f·(1 − A_f) + b_s·(1 − A_s)                # relative increase in postprandial glucose iAUC for a carbohydrate meal
```
| Symbol | Value | Unit | Uncertainty | Basis |
|---|---|---|---|---|
| K_A | 100 | g/d | 50–150 | PROPOSED (impairment already at ~30 %E carbohydrate [13,17]) |
| C_ref | 250 | g/d | — | reference mixed diet |
| τ_f | 2 | d | 1–3 | Numao 3 d [13]; Goedecke 5 d [17]; Burke washout 5–6 d [20] |
| τ_s | 28 | d | 21–42 | Jansen change-point ≈5 wk, continued decline to wk 9 [12] |
| a_f | 1.0 | mmol/L | **UNVERIFIED** (iAUC data only) | [13,17] |
| a_s | 1.0 | mmol/L | 0.6–1.2 | Jansen: ≈0.7–0.8 mmol/L decline weeks 2–9 [12] |
| b_f, b_s | 0.3, 0.3 | — | UNVERIFIED | PROPOSED |

Moderators: exercise on the day does not normalise the OGTT (Numao 2013 [30]); weight loss/energy balance (04).
UI flag "OGTT/CGM not representative" while (1−A_f) > 0.1 or (1−A_s) > 0.2.
**Grade:** B for direction and time scales; C for magnitudes; slow-component symmetry (does 2 weeks of restriction
already load the slow term?) is the weakest assumption.

### 4.9 Fat-adaptation gain and washout; resting fat-oxidation matching

**Mechanism.** Very-low-carbohydrate, high-fat intake up-regulates fat oxidation (CPT/CAT, HSL) and down-regulates
PDH/glycogenolysis within ~5 days; reversal takes a similar time and is not achieved by 24 h of carbohydrate.
- Burke 2021 [20] (13 world-class race walkers): 5–6 d LCHF (<50 g/d CHO, 2.2 g/kg protein, 80 %E fat) raised exercise
  fat oxidation >200 % to ~1.43 g/min — similar to 3–4 wk or >12 mo adaptation; O₂ cost +8 % (50-km pace) and +5 %
  (20-km pace). After 24 h high-CHO + 2 g/kg pre-race CHO, CHO oxidation reached only 61 % and 78 % of prior values;
  6/7 LCHF athletes were slower (2.2 ± 3.4 %) vs all HCHO improving 5.7 ± 5.6 %. **Substrate use returned to baseline
  after 5–6 days of high-CHO diet.**
- Burke 2020 [21]: 25 d LCHF: fat oxidation 0.6 → 1.3 g/min; 10-km race −2.3 % vs +4.8 % (HCHO 8.6 g/kg/d);
  2.5 weeks of HCHO restoration gave **no "rebound" benefit**; this replicated the economy/performance impairment first
  reported by Burke 2017 [22].
- Stellingwerff 2006 [23]: 5 d high-fat (4.6 g/kg fat, 67 %E) + 1 d CHO restoration (glycogen equalised 873 vs 868
  mmol/kg dw): fat oxidation +45 %, CHO oxidation −30 %, PDH activity 1.69 vs 2.39 mmol/kg ww/min; persistence
  despite restored glycogen also in Burke 2002 [24].
- Phinney 1983 [25]: 4 wk <20 g CHO eucaloric: endurance at 62–64 % VO₂max preserved (147 → 151 min), RQ 0.83 → 0.72,
  muscle glycogen use ↓ 4-fold.
- Resting whole-body fat-oxidation matching after an isocaloric switch to high fat: positive fat balance 1.06, 0.75,
  0.55 MJ/d on days 1–3, balance reached by day 7 (Schrauwen 1997 [37]); glycogen-lowering exercise gives immediate
  matching (Schrauwen 1997b [38]); higher activity accelerates it (Smith 2000 [39]).

**Equations (PROPOSED FIT):**
```
F*_carb = clamp((5.0 − C_kg)/(5.0 − 0.7), 0, 1)      # C_kg = carbohydrate g/kg BW/d
F*_fat  = clamp((fat%E − 30)/(65 − 30), 0, 1)
F*      = min(F*_carb, F*_fat)
dF_ad/dt = (F* − F_ad)/τ,  τ_on = 1.7 d, τ_off = 2.0 d
FatOx_ex   = FatOx_ex,0 · (1 + k_fo·F_ad)            # k_fo = 1.2 (range 1.2–2.0) [20,21]
CHOox_max  = CHOox_max,0 · (1 − 0.3·F_ad)            # [20,23]
O2cost_race= O2cost_0 · (1 + 0.065·F_ad)             # 5–8 % [20]
```
Check: after 24 h carbohydrate restoration F_ad = e^(−1/2) ≈ 0.61 → CHO-oxidation capacity ≈ 82 % (observed 61–78 %,
acceptable); after 5–6 d F_ad ≈ 0.06 (observed "back to baseline").
Resting fat-oxidation lag: fit of [37] gives imbalance I(t) ≈ 1.47·e^(−t/3.0) MJ/d for the low-fat → high-fat switch studied (exact fat %E not in the
abstract; scale proportionally);
in a Flatt/Hall oxidative-hierarchy model (01/04) this lag should **emerge** from the glycogen decline — use it as a
validation target rather than a separate state.
**Grade:** B (elite male athletes dominate the data; women and untrained people under-represented).

### 4.10 Induction symptoms ("keto-flu") and the performance dip on entering very-low-carbohydrate

**Data.** Forum analysis of 300 users: symptoms (flu-like, headache, fatigue, nausea, dizziness, brain fog, GI
discomfort, palpitations) peaked in the first week and dwindled after 4 weeks; resolution reported between days 3 and
30, **median 4.5 d (IQR 3–15)** (Bostock 2020 [27]). Ketogenic VLED increased hunger at day 3 and at 5 % weight loss
(~day 12) before appetite settled (Nymo 2017 [34]). PSMF side-effects: headache, fatigue, orthostatic hypotension,
cramps, cold intolerance, constipation, diarrhoea, halitosis, menstrual changes, hair thinning; "most transient and
may be alleviated by adjusting fluid, salt and supplement intake" (Chang & Kashyap 2014 [54]).

**Equation (PROPOSED):**
```
Φ_ind(t) = Φ_max · (Δt/τ_p) · exp(1 − Δt/τ_p)          # Δt = days since carbohydrate fell below 50 g/d
Φ_max    = clamp((C_prev − C_new)/C_prev, 0, 1) · (1 − 0.3·I[Na ≥ 2 g/d])   # sodium mitigation: grade D
τ_p = 2.5 d; heavy tail: 25 % of simulated users follow τ_p = 6 d (IQR upper bound 15 d [27])
```
Re-entry after a carbohydrate refeed re-triggers Φ with Φ_max scaled by the refeed depth (grade D; no data).
Performance: submaximal endurance preserved after ~4 weeks [25]; high-intensity endurance impaired while F_ad is high
(§4.9); strength performance in lifters not different after 3 months ad-lib ketogenic diet despite −2.26 kg lean mass
and −3.26 kg body mass vs usual diet (Greene 2018 [103]). Coordinate with 19.
**Grade:** C (self-report; clinical descriptions).

### 4.11 Hormonal transients at diet switches (hooks for dossier 12)

- **T3.** Total fasting 7–18 d: T3 −53 %, rT3 +58 %; 800-kcal zero-carbohydrate diet 2 weeks: T3 −47 % (rT3 unchanged);
  isocaloric diets with **≥50 g carbohydrate: no T3 change** (Spaulding 1976 [138]). 28-d VLCD: T3 −34.6 % low-carb vs
  −17.9 % high-carb; **T3 and rT3 returned to baseline within 1 week** on a 1,000-kcal mixed diet (Mathieson 1986 [139]).
  Carbohydrate-for-fat substitution raises T3 at weight maintenance (Danforth 1979 [140]).
  Hook: T3_rel* = 1 − 0.5·(1 − min(1, C/50))·s_def − (deficit term from 12), τ_T3 ≈ 4 d (PROPOSED).
- **Leptin.** 52-h fast: −64 % (normal weight) and −72 % (obese); prevented by clamping glucose at basal (Boden 1996
  [142]). Three days at 70 % vs 130 % of TEE: leptin 88 % vs 135 % of baseline after a eucaloric washout day, restored
  only after the complementary period restored **cumulative** energy balance (Chin-Chance 2000 [143]). 3-day
  carbohydrate overfeeding: leptin +28 %, 24-h EE +7 %; fat overfeeding: no change (Dirlewanger 2000 [141]). A single
  day of 8 %-carbohydrate diet lowered leptin vs a low-sugar diet (Hengist 2023 [144]).
  Hook: leptin_rel = f(FM)·exp(k_L·B_cum_CHO), where B_cum_CHO is the ~3-day exponentially weighted balance with
  carbohydrate surplus weighted 1 and fat surplus weighted ≈0.2 (PROPOSED from [141,143]).
  **Implication for refeeds:** a 1–2-day carbohydrate refeed raises leptin transiently (~+20–30 %) and it decays within
  ~3 days; no durable effect should be modelled.
- **Post-diet hormonal recovery** after extreme leanness: 3–5 months (§4.20).
**Grade:** B (controlled human studies), hooks PROPOSED.

### 4.12 Lipid transients at switches (hooks for dossier 06)

- **Very-low-carbohydrate, high-fat entry:** 3 weeks <20 g/d carbohydrate in normal-weight young adults: LDL-C 2.2 →
  3.1 mmol/L, **+44 % vs control, individual range 5–107 %**, ApoB ↑, TG unchanged (Retterstøl 2018 [31]). Isocaloric
  4-wk ketogenic diet: total & LDL-C ↑, TG ↓, CRP ↑ (Rosenbaum 2019 [18]). LDL-C rises detectably within 24 h of an
  8 %-carbohydrate diet (Hengist 2023 [144]). Lean, low-TG/high-HDL people are the largest responders ("lean mass
  hyper-responder"; mean LDL-C 272 mg/dL after mean 4.7 y, Budoff 2024 [32]).
  Hook: ΔLDL* per 06 with τ_LDL ≈ 7–10 d (reaches plateau by ~3 wk) — PROPOSED; reversal on carbohydrate re-entry
  assumed symmetric (**UNVERIFIED**).
- **Very-low-fat, high-carbohydrate entry:** eucaloric 10 %-fat/75 %-carbohydrate (sugar-rich) diets raise hepatic
  de novo lipogenesis to 37–43 % of VLDL-TG fatty acids vs 6–12 % on 30 % fat, and raise fasting and 24-h TG in
  proportion to DNL; VLDL enrichment evident by day 10 (Hudgins 1996 [40], 2000 [41]). Rapid carbohydrate
  reintroduction after a 10-week ketogenic diet raised TG within 1 week (Wilson 2020 [26]). Whether
  carbohydrate-induced hypertriglyceridaemia is transient is unresolved (Parks & Hellerstein 2000 [42]).
  Hook: ΔTG* ∝ max(0, CHO%E − 55)·(sugar share), τ_TG ≈ 5–7 d; magnitude from 06 (**UNVERIFIED here**).
**Grade:** B.

### 4.13 Appetite, gut adaptation carry-over and the microbiome

- Ad-lib, inpatient, 2 wk each (crossover, no washout): very-low-fat (10 %E fat, 75 %E carbohydrate, ~1 kcal/g) led to
  **689 ± 73 kcal/d lower intake** than very-low-carbohydrate (75.8 %E fat, 10 %E carbohydrate, ~2 kcal/g) (Hall 2021 [4]).
- Diet-order effect (Sciarrillo 2024 [5]): LC→LF lost 2.9 ± 1.1 kg more weight and 1.5 ± 0.6 kg more fat than LF→LC
  over 28 d; intake differed by −1,610 ± 312 kcal/d only in the last 2 weeks; first-2-week food mass differed by
  1,296 ± 215 g/d and fibre by 58 ± 6 g/d; people who ate more mass/fibre in weeks 1–2 ate more in weeks 3–4 →
  proposed gut-capacity adaptation. LC→LF first 2 weeks: −2.2 ± 0.7 kg, of which FFM −1.9 ± 0.5 kg, FM −0.2 ± 0.4 kg.
- Ketogenic VLED: hunger ↑ days 1–~12, then not increased while ketotic up to 17 % loss; hunger and acylated ghrelin
  rise after refeeding (Nymo 2017 [34]; Sumithran 2013 [35]: BHB 0.48 → 0.19 mmol/L after 2 weeks of food
  reintroduction, ghrelin/appetite ↑). Meta-analysis: small but significant hunger reduction in ketosis (Gibson 2015 [36]).
- 36-h fast (~12 MJ deficit): next-day ad-lib intake 12.2 vs 10.2 MJ — only ≈17 % compensation (Johnstone 2002 [135]).
- Microbiome: 5-day animal-only vs plant-only diets shifted community structure **within 1 day** of the diet reaching
  the gut and reverted **2 days** after the animal diet ended (David 2014 [115]); composition changed within 24 h but
  enterotype stayed stable over 10 days (Wu 2011 [116]).

**Model hook (ad-lib mode only, PROPOSED):** `dU_food/dt = (FoodMass − U_food)/7 d`; ad-lib energy intake on a new
pattern = U_food × energy density of the new pattern × appetite factor from 12. Microbiome composition index with
τ ≈ 1 d (display only; functional effects → 15). Fibre ramp: limit fermentable-fibre increases to ≈+5–10 g/d per week
(expert opinion, grade D; see 15).
**Grade:** B (inpatient RCTs), carry-over mechanism C.

### 4.14 Gallbladder stasis during very-low-fat and rapid loss

**Mechanism.** Rapid loss raises bile cholesterol saturation; meals with <~10 g fat fail to empty the gallbladder
(threshold 10 g fat; Festi 2000 [43]).
- Gebhard 1996 [44]: 520 kcal with <2 g fat/d vs 900 kcal with 30 g fat/d (one 10-g-fat meal); both lost 22 %;
  emptying 35 % vs maximal (66 %); **gallstones 4/6 vs 0/7** (trial stopped).
- Erlinger 2000 [45]: new gallstones in 10–12 % after 8–16 weeks of low-calorie diet; risk factors: loss >24 % of
  initial weight, rate >1.5 kg/week, VLCD with no fat, long overnight fast, high TG; ursodeoxycholic acid protective.
- Johansson 2014 [46] (n=3,320 matched pairs): VLCD 500 kcal vs LCD 1,200–1,500 kcal for 3 months: symptomatic
  gallstones 152 vs 44 per 10,000 person-years, HR 3.4 (1.8–6.3), NNH 92; 1-y weight −11.1 vs −8.1 kg.
- Cleveland PSMF: fat from protein foods (45–70 g/d) is considered enough for contraction [54].

**Hazard (PROPOSED):** `GB_risk = 1 · (1 + 1.5·I[rate > 1.5 kg/wk, after week 2]) · (1 + 1.5·I[max meal fat < 10 g]) ·
(1 + 1.0·I[cumulative loss > 20 %])`, capped at 6; baseline absolute risk from 17. **Grade:** B for risk factors, C for form.

### 4.15 PSMF / VLCD / total diet replacement: definitions, lean retention, RMR, regain, supervision

**Mechanistic definition (for the regime builder):**
- PSMF: protein **1.2–1.5 g/kg IBW** of high biological value; carbohydrate **<20 g/d** (Cleveland) or <20–50 g/d;
  no added fat (fat only from protein foods, ≈45–70 g/d); typical total ≈600–900 kcal/d; ketonuria within 24–72 h
  (Bistrian 1976 [47]; Chang & Kashyap 2014 [54]).
- VLCD/TDR: formula ≤800–850 kcal/d with mixed macronutrients (DiRECT 825–853 kcal/d for 12–20 weeks + 2–8 weeks
  stepped food reintroduction [59,60]; DROPLET 810 kcal/d for 8 weeks + 4 weeks reintroduction [61,62]).

**Nitrogen balance / lean retention.**
- Bistrian 1976 [47]: N balance maintained chronically at 1.3 g protein/kg IBW (3 obese T2D patients); insulin
  withdrawn after 0–19 d (mean 6.5 d).
- Bistrian 1977 [48]: egg-white PSMF 1.5 g/kg IBW: N balance improved weekly over 3 weeks; a subsequent 1-week total
  fast was significantly negative; resuming meat PSMF gave **positive** N balance (re-anabolism after a lean deficit).
- Hoffer 1984 [49,50] (500 kcal; 5–8 wk; 17 obese women): 1.5 g protein/kg IBW → **N balance 0 after 3 weeks**;
  0.8 g/kg + 0.7 g carbohydrate/kg IBW → **−2 g N/d**; 3-methylhistidine fell 25–30 % after week 1 in both.
- Vazquez 1995 [51] (600 kcal/d, 28 d, 48 women): carbohydrate 76–86 g vs 10 g/d cut cumulative N loss from
  3,611 to 1,869 mmol (≈51 → 26 g N); 50 vs 70 g protein/d: 3,171 vs 2,326 mmol (ns) → carbohydrate and protein are
  independent, additive protein-sparers. Vazquez & Adibi 1992 [52] (600 kcal, 8 g N/d, 4 wk): N balance −50.4 g
  (ketogenic) vs −18.8 g (non-ketogenic).

**N-balance equation (PROPOSED FIT; coordinate with 03):**
```
p = clamp((P_IBW − 0.8)/0.7, 0, 1);  q = clamp(C/75, 0, 1)
N_bal(t) [g N/d] = min(0, −2.0 + 2.0·p + 1.0·q·(1 − p)) − 1.0·exp(−t/10 d)   # during energy intake ≤ ~50 % of TDEE
lean tissue change [kg/d] ≈ N_bal · 6.25 / 1000 / 0.22                         # 1 g N ≈ 6.25 g protein ≈ 28 g wet lean tissue
```
Fit check against the data points: Hoffer 1.5 g/kg IBW, ~0 g carbohydrate (p=1) → 0 g N/d after ~3 weeks (observed 0);
Hoffer 0.8 g/kg + 0.7 g/kg carbohydrate (p=0, q≈0.56) → −1.4 (observed −2.0); Vazquez & Adibi 50 g protein, ketogenic
(p≈0.05, q≈0.1) → ≈−59 g N/28 d (observed −50.4); non-ketogenic (q=1) → ≈−36 (observed −18.8). The fit
over-predicts losses at low protein + carbohydrate — acceptable as a conservative planner model; calibrate against 03.

**Weight-loss outcomes.**
- Cleveland PSMF [54]: 1–3 kg/week in the intensive phase (more in weeks 1–2), total 8–40 kg; plateau within 6 months;
  refeeding 6–8 weeks (month 1 ≤45 g carbohydrate, month 2 ≤90 g); partial regain at 1 y; return to baseline at 5 y.
- Palgi 1985 [53] (668 outpatients, 71 % above ideal weight): PSMF 17 ± 12 weeks: −21 ± 13 kg at nadir, −19 ± 13 kg
  after 9 ± 17 weeks maintenance; BP and TG fell; uric acid +0.4 mg/dL, gout <1 %.
- Pfoh 2020 [55] (Cleveland Clinic, 1,403 patients, 879 started PSMF): +3 % more weight loss averaged over 5 years
  (adjusted), but no difference by year 4 (1.6 vs 1.3 %); ≥5 % loss at 1 y 55 % vs 20 %, at 5 y 34 % vs 29 % (ns).
- Tsai & Wadden 2006 meta [58]: VLCD vs LCD short-term 16.1 ± 1.6 % vs 9.7 ± 2.4 %; long-term (≥1 y) 6.3 ± 3.2 % vs
  5.0 ± 4.0 % (ns).
- DiRECT [59,60]: 12 mo −10.0 kg vs −1.0 kg; T2D remission 46 % vs 4 %; 24 mo remission 36 % vs 3 %, weight difference
  −5.4 kg. DROPLET [61,62]: 12 mo −10.7 vs −3.1 kg (≥10 % loss 45 % vs 15 %); 3 y −6.2 vs −2.7 kg with regain from
  6 mo to 3 y +8.9 vs +1.2 kg.
- FFM share: grows with degree of caloric restriction (r² = 0.31) and is reduced by exercise (Chaston 2007 [63]).

**RMR.** 28-d VLCD with thrice-weekly exercise: RMR −12.4 % (low-carb) and −20.8 % (high-carb), significant from week 3
(Mathieson 1986 [139]); 10-d near-total fast: BMR −12 % (Laurens 2021 [131]). Adaptive thermogenesis → 02.

**Supervision & supplements (Cleveland protocol [54]):** baseline history, examination and **ECG**; dietitian every
2 weeks for the first month then monthly; physician every 6–8 weeks; metabolic panel + uric acid at baseline, every
2 weeks in month 1, monthly thereafter. Daily: multivitamin/mineral; **K 16–20 mEq; Ca 1,000–1,200 mg; Mg 400–500 mg;
Na 1,500–2,000 mg; ≥64 oz (≈1.9 L) fluid**; K and Mg supplements stopped after week 2 (per that protocol).
Contraindications: BMI <27; recent MI, angina, significant arrhythmia, decompensated heart failure, cerebrovascular
insufficiency/recent stroke, end-stage renal disease, liver failure, malignancy, major psychiatric illness, pregnancy
or lactation, wasting disorders; age <16 or >65; type 1 diabetes generally not advised; relative: gallstones, gout.
**History:** 17 sudden arrhythmic deaths after a **median 5 months** of ~300–400 kcal/d largely-protein regimens
(Sours 1981 [56]; Isner 1979 [57], QT prolongation), independent of supervision type, potassium dose and protein
quality; common factors were marked obesity, prolonged extreme restriction and rapid large loss.

**Lean, trained people ("rapid fat loss" short cycles).** No controlled trial of a true PSMF (<~900 kcal, <20 g
carbohydrate) in lean trained people was found. Closest evidence:
- Walberg 1988 [72]: 1 wk at 18 kcal/kg BW in weight lifters: 1.6 g/kg protein → N balance +4.13 g/d vs −3.19 g/d with
  0.8 g/kg + high carbohydrate; quadriceps endurance fell in the lower-carbohydrate group.
- Mettler 2010 [70]: 2 wk at 60 % of habitual energy: 2.3 vs 1.0 g protein/kg: lean mass −0.3 vs −1.6 kg; total
  −1.5 vs −3.0 kg; performance unchanged; fatigue ratings higher in high-protein.
- Longland 2016 [71]: 4 wk ~40 % deficit (33 kcal/kg LBM), RT + HIIT 6 d/wk: 2.4 vs 1.2 g/kg: LBM +1.2 vs +0.1 kg, FM
  −4.8 vs −3.5 kg.
- Huovinen 2015 [69]: 4 wk, 750 vs 300 kcal/d deficit (carbohydrate −130 g/d, high protein) in jumpers/sprinters:
  −2.2 kg BM, −1.7 kg FM, FFM preserved; CMJ +2.6 cm; athletes **≥10 % body fat preserved FFM**.
- Garthe 2011 [68]: 0.7 %/wk vs 1.4 %/wk BW loss (−19 vs −30 % energy): LBM +2.1 % vs −0.2 %; FM −31 vs −21 %.
**Grade:** B (obese clinical populations); C/D (lean trained extrapolation).

### 4.16 Rate of loss (fast vs slow at equal total) and maximal sustainable deficit

- Purcell 2014 [64] (n=200, aim 15 % loss): 12-wk rapid vs 36-wk gradual; 81 % vs 50 % reached ≥12.5 %; regain at
  144 weeks **70.5 % vs 71.2 %** (completers; ITT 76.3 % both); one cholecystitis in rapid.
- Vink 2016 [65]: VLCD 500 kcal × 5 wk vs LCD 1,250 kcal × 12 wk: −9.0 vs −8.2 kg; FFM loss 8.8 % vs 1.3 % (paper's
  %FFML); regain at 9 mo 4.5 vs 4.2 kg; %FFML correlated with regain (r = 0.325).
- Ashtary-Larky 2017 [66]: 5 % loss in 5 vs 15 weeks: rapid lost more TBW, LBM, FFM and RMR; slow lost more fat.
- Ashtary-Larky 2020 meta [67]: at equal loss, gradual → FM −1.0 kg (−1.70, −0.29) and body-fat % −0.83 more; RMR
  better preserved by ≈407 kJ/d (≈97 kcal/d; the published CI is internally inconsistent — treat magnitude as
  uncertain); FFM difference ns.
- Maximal fat-energy transfer (Alpert 2005 [73]): **290 ± 25 kJ/kg FM/d (≈69 ± 6 kcal/kg FM/d)**; deficits beyond
  this draw directly on FFM (derived from under-fed, moderately active subjects; grade C).

**Maximal sustainable deficit (PROPOSED planner cap):**
```
D_max = min( 0.75 · 69 · FM_kg ,  r_max · W · 7700/7 )    # kcal/d; 7700 kcal/kg is a planning constant only
r_max = 1.0 %BW/wk if (men BF ≤ 15 % or women BF ≤ 25 %), 1.5 %BW/wk otherwise (after week 2); never > 1.5 kg/wk (gallstones)
```
| Example | FM (kg) | Alpert limit (kcal/d) | 0.75 × limit |
|---|---|---|---|
| 80 kg man, 10 % BF | 8 | 552 | 414 |
| 80 kg man, 15 % BF | 12 | 828 | 621 |
| 80 kg man, 25 % BF | 20 | 1,380 | 1,035 |
| 65 kg woman, 22 % BF | 14.3 | 987 | 740 |
| 110 kg man, 35 % BF | 38.5 | 2,657 | 1,993 |

Cross-check: Huovinen's 4-week 750 kcal/d deficit preserved FFM in athletes with ≥10 % BF although the Alpert limit
at 10 % BF of ~75 kg is only ≈500–550 kcal/d — so over 2–4 weeks with high protein the limit looks conservative (or
reported deficits overstate true deficits); athletes <10 % BF did not reliably preserve FFM. Garthe's 30 % deficit
halted LBM gain. **Grade:** C (cap is a PROPOSED synthesis).

### 4.17 Non-linear intake at equal weekly energy/protein: diet breaks, refeeds, calorie/carb cycling

| Study | Design | Result |
|---|---|---|
| MATADOR, Byrne 2018 [77] | 51 obese men; 16 wk ER at 67 % of maintenance, continuous vs 8 × 2-wk ER alternating with 7 × 2-wk energy balance (30 wk) | INT −14.1 ± 5.6 vs −9.1 ± 2.9 kg; FM −12.3 vs −8.0 kg; FFM −1.8 vs −1.2 (ns); weight change in balance blocks 0.0 ± 0.3 kg; adjusted REE fall −360 vs −749 kJ/d |
| ICECAP, Peos 2021 [78] | 61 resistance-trained adults (32 women); 4 × 3-wk ER + 3 × 1-wk balance vs 12 wk continuous | No difference in FM (15.3 vs 18.0 kg, p=0.32), FFM, strength, REE, leptin, T3, testosterone; **lower hunger** (p=0.002), higher satisfaction, PYY |
| ICECAP diet-break analysis [79] | 1-wk break (carbohydrate ↑ to maintenance) after 12 wk | BW +0.6 kg, "FFM" +0.7 kg, FM 0; REE 7,000 → 7,200 kJ/d; leg muscle endurance ↑; hunger/irritability ↓ |
| Siedler 2023 [82] | 38 resistance-trained women; 6 wk continuous 25 % ER vs 1 wk balance after every 2 wk ER (8 wk); protein 1.8 g/kg | No difference in body composition or RMR; disinhibition ↑ in continuous, ↓ in breaks |
| Campbell 2020 [80] | 27 RT adults; 7 wk ~25 % ER; 2 consecutive high-carbohydrate days/week vs continuous | FFM −0.4 vs −1.3 kg; RMR −38 vs −78 kcal/d; **re-analysis: only dry FFM differed** (Peos 2020 comment [81]) |
| Poon 2025 meta [83] | 12 RCTs, 881 participants, diet breaks vs continuous | No difference in body mass, FM, FFM; **smaller RMR reduction with breaks** (more in overweight than trained) |
| Roman 2019 meta [84] | 9 RCTs, n=782 | Regular intermittent (restriction interspersed with maintenance days) → **lean mass −0.86 kg (−1.62, −0.10) worse** than continuous; other outcomes ns |
| Coutinho 2018 [88] | 35 obese adults, 33 % overall ER for 12 wk, intermittent (short spells of restriction interspersed with habitual intake) vs continuous; ≈12.5 % loss both | Same body composition; RMR fell and exercise efficiency rose in both; **no difference in compensatory responses** |
| Wing & Jeffery 2003 [87] | Prescribed 2-wk or 6-wk breaks in a behavioural programme | Breaks did not reduce overall 5- or 11-month loss |
| Davoodi 2014 [86] | 74 overweight; 11 d restriction + 3 d self-selected, × 3 | Small, low-quality trial; better adherence reported |
| Seimon 2015 review [85] | Intermittent vs continuous | No consistent physiological benefit |

**Net evidence and model rule.** At equal weekly energy and protein, non-linear intake does **not** change fat or lean
trajectories beyond noise (pooled FFM effects of opposite sign, magnitude <1 kg). Implement: (i) the same fat/protein
balance as linear intake; (ii) glycogen/water/sodium oscillation in `W_scale`; (iii) adaptive thermogenesis relaxes
during ≥1-week maintenance blocks per 02 (MATADOR/Poon support a smaller RMR fall — do not add a separate bonus);
(iv) appetite/adherence benefit as a planner "adherence score" (+) for 1–2-week breaks (ICECAP, Siedler), not a
physiological term. **Grade:** A/B for "no body-composition advantage"; B for appetite.

### 4.18 Water-only and near-zero-energy fasts: entry, during, refeed, what is kept (sequencing side; physiology → 20)

**Entry from a high-carbohydrate vs a very-low-carbohydrate state (mechanistic; grade C).**
- From high carbohydrate: liver glycogen is largely exhausted by ~40–50 h (gluconeogenesis supplies 64 % of glucose
  output in the first 22 h, 82 % over the next 14 h, 96 % over the next 18 h — Rothman 1991 [11]); muscle glycogen
  falls more slowly; natriuresis (§4.3) and gut emptying (§4.5) add to the first-days drop. Expected day-1–2 scale loss
  ≈1.5–2.5 kg (sum of §4.2–4.5), of which fat ≈0.15–0.25 kg/d (energy balance, 01).
- From very-low-carbohydrate: glycogen already low, `E_cna` already negative, gut contents often lower → a smaller
  first-days drop (≈0.5–1.0 kg, PROPOSED) and earlier high ketone levels (05/20); induction symptoms already resolved.
  Fat loss per fasting day is essentially the same (set by energy expenditure).
- BHB reached 1.8 ± 0.4 mmol/L after 52 h (Boden 1996 [142]); leptin fell 64–72 % [142].

**During.** Early weight loss ≈0.9 kg/d in week 1, slowing to ≈0.3 kg/d by week 3, early loss "primarily negative
sodium balance" (Kerndt 1982 [29]). 7-day water-only fast (12 adults, BMI 25.4 ± 4.1): −5.7 ± 0.8 kg, **lean mass
−3.6 ± 0.49 kg, fat mass −1.6 ± 1.3 kg**; systemic proteome changes only after ~3 days (Pietzner 2024 [130]).
10-day fast with 200–250 kcal/d and up to 3 h/d light activity (16 men, BMI 26.2): −5.9 ± 0.2 kg (−7 %); FM −2.3 kg
(40 %), lean soft tissue −3.53 kg (60 %), the lean loss being 44 % extracellular water, 14 % glycogen + water and 42 %
metabolically active tissue; protein oxidation −41 % by day 5 then stable; BMR −12 %; strength maintained or improved
(Laurens 2021 [131]). T3 −53 %, rT3 +58 % after 7–18 d total fasting (Spaulding 1976 [138]). Obese people break down
less muscle protein during a 72-h fast than lean people (Bak 2016 [134]).

**Refeed (what comes back, what is kept).**
- After 3 days of ad-lib refeeding post 7-d fast: lean-mass deficit fell from −3.6 to **−0.69 ± 0.49 kg** while fat
  loss persisted (**−1.85 ± 0.34 kg**) (Pietzner 2024 [130]). Buchinger protocol refeeding: 800 → 1,600 kcal/d over
  3 days; weight loss maintained through refeeding; at 3 months body weight still below baseline (Laurens 2021 [131]).
- Carbohydrate-rich refeeding: glycogen refills within ~24–48 h (§4.2), antinatriuresis ≈+70 mEq Na/d ≈ +0.5 L/d
  (Heyman 2020 [28]), gut refills over ~2–3 days → expected rebound **+1.5–3 kg within 3–5 days** after a 3–7-day fast
  (sum of labile terms; consistent with Pietzner lean-mass recovery).
- Low-carbohydrate / protein-first refeeding (mechanistic, grade C/D): smaller and slower water/glycogen rebound, ketosis
  partly maintained, but carbohydrate is independently protein-sparing (Vazquez 1995 [51]) and PSMF after a fast
  restores positive N balance (Bistrian 1977 [48]). No trial has compared refeed compositions for body composition.
- Appetite after a 36-h fast compensates only ≈17 % the next day (Johnstone 2002 [135]).
- Energy-matched comparisons: in lean adults, 3 weeks of alternate-day 24-h fasts with 150 % intake on feed days
  (0:150) lost −1.60 kg BM but only −0.74 kg FM vs −1.91 kg BM / −1.75 kg FM with daily 75 % intake; fasting without net
  restriction (0:200) lost no fat (Templeman 2021 [93]). → **fasting per se adds no fat loss; ADF shifts more of the
  loss into lean/labile mass in lean people.**
- Periodic multi-day low-energy blocks: fasting-mimicking diet (≈4,600 kJ ≈ 1,100 kcal day 1; ≈3,000 kJ ≈ 720 kcal
  days 2–5; 9–11 %E protein), 5 d/month × 3: −2.6 ± 2.5 kg vs −0.1 ± 2.1 kg; total and trunk fat ↓, absolute lean mass
  slightly ↓; benefits persisted 5–7 d after return to normal diet (Wei 2017 [133]). Supervised 4–21-day fasts at
  200–250 kcal/d in 1,422 people: adverse effects <1 %, 93.2 % reported no hunger (Wilhelmi de Toledo 2019 [132]).
- Refeeding syndrome: NICE criteria (as reproduced in Mehanna 2008 [136]) — high risk if **one** of BMI <16,
  unintentional loss >15 % in 3–6 months, little or no intake for **>10 days**, low K/PO₄/Mg before feeding; or **two**
  of BMI <18.5, loss >10 %, little or no intake for **>5 days**, alcohol misuse or drugs (insulin, chemotherapy,
  antacids, diuretics). High-risk refeeding starts at ≤10 kcal/kg/d (≤5 kcal/kg/d if BMI ≤14 or negligible intake
  ≥2 weeks). ASPEN 2020 [137]: refeeding syndrome = 10–30 %+ falls in phosphate, potassium or magnesium (or organ
  dysfunction) within 5 days of reintroducing energy.

**Grade:** B for body-composition trajectories (small but controlled cohorts); C for entry/refeed composition effects.

### 4.19 Cyclical very-low-carbohydrate, "targeted" carbohydrate, and train-low / sleep-low

- **Ketosis re-entry cost:** after 7 days of a ketogenic diet, one 72-g carbohydrate breakfast dropped fasting breath
  acetone (8.2 → 5.7 ppm) and **stable ketosis took 5 days to re-establish** (2 days in low-fasting-insulin, 5 days in
  medium, not re-established in high-insulin participants) (Kempf 2024 [33]). A weekly 2-day carbohydrate load
  therefore leaves most of the 5 "low" days in transition; each cycle adds 1–3 kg of scale oscillation.
- **Cyclical ketogenic reduction diet** (Kysel 2020 [102], 25 trained young men, 8 wk, both −500 kcal/d): 5 days
  ≤30 g carbohydrate + 1.6 g/kg protein, then 2 days 8–10 g carbohydrate/kg fat-free tissue (70 %E): BM −4.6 kg, FM
  −1.9 kg, lean body mass −1.8 kg (significant), body water −2.2 kg; strength and VO₂peak **not** improved, whereas the
  balanced reduction diet lost FM −4.0 kg, kept lean mass and improved lat pull-down, leg press and VO₂peak
  (BIA measurements; timing relative to the load days is a confounder).
- **"Targeted" carbohydrate around training within a very-low-carbohydrate diet:** no controlled human trial located
  (grade D). Mechanistically it partially preserves CHO oxidation during the session while lowering ketones for hours (05).
- **Train-low / sleep-low (same daily carbohydrate, re-timed):** 3 wk, 6 g/kg/d, evening high-intensity session with
  carbohydrate, overnight carbohydrate withheld, next-morning low-intensity fasted session: delta efficiency +11 % vs
  +1.4 %, 10-km run −2.9 % vs −0.1 %, supramaximal time +12.5 % vs +1.6 % (p=0.06), fat mass −8.5 % vs −2.6 %,
  lean mass unchanged (Marquet 2016 MSSE [98]); 1-week version: 20-km time-trial +3.2 % (Marquet 2016 Nutrients [99]).
  Elite athletes, 4 wk, 3 d/wk manipulation: **no superior adaptations** (Gejl 2017 [100]); periodised CHO in elite
  walkers: +2.2 % (p=0.09) vs +4.8 % high-CHO (Burke 2020 [21]). Review: train-low augments signalling in ~75 % of
  studies but improves performance in only 37 % of 11 studies (Impey 2018 [101]).
**Grade:** B (endurance performance, sub-elite); C (body composition claims).

### 4.20 Physique periodisation: gain → cut → recover, mini-cuts, reverse dieting

- **Gaining phase:** +10–20 % energy, +0.25–0.5 % BW/wk for novice/intermediate (less for advanced), protein
  1.6–2.2 g/kg, fat 0.5–1.5 g/kg, carbohydrate ≥3–5 g/kg (Iraki 2019 [111]). 4 wk at 67.5 vs 50.1 kcal/kg/d in
  bodybuilders: muscle +2.7 vs +1.1 %, **fat +7.4 vs +0.8 %** (Ribeiro 2019 [112]) → surplus beyond ~+15–20 % adds
  mainly fat (coordinate 11).
- **Cutting phase:** 0.5–1 %BW/wk; protein 2.3–3.1 g/kg LBM; fat 15–30 %E (Helms 2014 [74]); 0.7 %/wk beats 1.4 %/wk
  for LBM/strength (Garthe 2011 [68]).
- **Contest-preparation case data (timelines for validation):**

| Case | Duration | Body composition | Hormones / RMR / performance | Recovery |
|---|---|---|---|---|
| Rossow 2013 [104], male | 6 mo prep, 6 mo recovery | BF 14.8 → 4.5 % | Testosterone 9.22 → 2.27 ng/mL; RHR 53 → 27 bpm; mood disturbance 6 → 43; strength ↓ | T 9.91 ng/mL after; BF back to 14.6 %; RHR 46 within 1 mo; strength not fully recovered at 6 mo |
| Kistler 2014 [105], male | 26 wk, 2 elevated-carbohydrate days/wk | 88.6 → 73.3 kg (linear, R² = 0.99); BF 17.5 → 7.4 % | RHR 71 → 44; relative VO₂ ↑ | — |
| Pardue 2017 [106], male | 8 mo prep + 5 mo recovery | −9.1 kg; DXA BF 13.8 → 5.1 → 13.8 % (M13) | Energy intake 3,860 → 1,724 kcal/d; T 623 → 173 ng/dL; T3 123 → 40 ng/dL; RMR 107 → 81 % predicted; peak power 753 → 537 W | Largely, not entirely, reversed by M13 |
| Hulmi 2016 [108], 27 women vs 23 controls | ~4 mo diet, 3–4 mo recovery | BW −12 %, FM −35–50 % | Leptin, T3, testosterone, estradiol ↓; menstrual irregularity ↑ | Weight and most hormones recovered in 3–4 mo, **except T3 and testosterone** |
| Tinsley 2019 [109], woman | 8 mo, 2 contests | BF 20.3 → 12.2 → 11.6 %; FFM +2.1 → +4.6 % | 965–1,610 kcal/d; RMR 1,345 → 1,119 → 1,435 kcal/d; RFD −57 %, still −39 % at end | RMR recovered; neuromuscular performance not |
| Chappell 2018 [107], 51 competitors | 22 ± 9 wk prep | — | Placed men started with more carbohydrate (5.1 vs 3.7 g/kg) | — |

- **Mini-cuts** (2–6-week aggressive deficits inside a gaining phase): no controlled trial (grade D); model as block B3
  (§4C) with its transients.
- **Reverse dieting** (slow weekly calorie increases after a diet): preliminary RCT in 49 resistance-trained adults after
  5 % loss: 15-week relative regain 3.68 ± 2.75 % (reverse, +8.5 %/wk men, +11.7 %/wk women) vs 2.73 ± 3.14 % (immediate
  estimated maintenance) vs 1.30 ± 2.3 % (ad libitum), p = 0.053; not superior (Rodriguez Da Silva 2025 [113]).
  Metabolic adaptation reviewed in Trexler 2014 [110]. Hormonal recovery in the cases above tracked restoration of
  energy intake and body fat over 3–5 months. **Verdict: unnecessary; model as immediate return to maintenance with
  02's adaptive-thermogenesis decay.** Grade C.

### 4.21 "Metabolic flexibility" and macro-variation per se

Metabolic flexibility = capacity to switch fuel oxidation with availability/demand; impaired in obesity/T2D, improved
by exercise and weight loss (Goodpaster & Sparks 2017 [114]). Evidence located on **alternating** substrates:
- Substrate oxidation re-adapts in ~5–7 days in either direction (Schrauwen [37], Goedecke [17], Burke 2021 [20]) — the
  adaptation is to the *current* diet, with no residual "training" effect reported after reversal.
- While on very-low-carbohydrate, carbohydrate handling is *reduced* (↑PDK4, ↓GLUT4, ↓glucose tolerance, Hengist 2024
  [19]; Jansen [12]); a prior fat-adaptation block did not improve later high-carbohydrate performance (Burke 2020 [21]).
- No human trial comparing variable vs constant macronutrient ratios at equal averages on insulin sensitivity,
  body composition or metabolic flexibility was found.
**Model rule:** no bonus term for variation per se; every switch incurs the transients of §4A. **Grade:** D (absence of
evidence) for any benefit; B for the transients.

---

## 4A. Deliverable (a) — Transient phenomena table (encode as state dynamics)

Sign convention: + = increase. "τ" = first-order time-constant unless stated. VLC = <50 g/d carbohydrate; HC = ≥5 g/kg
or ≥55 %E carbohydrate; VLF = ≤15 %E fat; PSMF = §4.15; EB = energy balance.

| # | Phenomenon | Trigger | Magnitude | Onset | Time-constant / course | Reversal | Grade | Refs |
|---|---|---|---|---|---|---|---|---|
| T1 | Glycogen + bound water loss | Carbohydrate ↓ (VLC, PSMF, fast) | −0.3 to −0.5 kg glycogen → −1.2 to −2.0 kg (×(1+h), h≈3) | Hours | Liver ~1–2 d; muscle 2–5 d (04) | Refill ≤24 h at ~10 g/kg/d; 2–4 d at moderate intake | A/B | [2,3,9,11] |
| T2 | Natriuresis (carbohydrate/insulin-sensitive ECF) | Carbohydrate <~100 g/d; fasting | −0.3 to −1.0 L | 12–24 h | τ ≈ 1.5 d | Antinatriuresis on carbohydrate: +~0.5 L/d, τ ≈ 0.7 d | C | [3,28,29] |
| T3 | Week-1 VLC scale drop (T1+T2+gut) | HC → VLC at equal energy | −1.6 ± 0.2 kg rapid extra loss after the switch (ward); fat only −0.2 kg in 15 d | Days 1–7 | Complete by ~1 wk | See T4 | A/B | [1,3] |
| T4 | Scale rebound VLC → HC | Carbohydrate reintroduced | +1 to +3 kg (DXA "lean" +4.8 % in 1 wk after 10-wk KD; diet break +0.6 kg BW/+0.7 kg FFM) | Hours | 1–5 d | — | B | [7,26,79] |
| T5 | Glycogen supercompensation | Depletion/taper then 8–12 g/kg (prior low-CHO phase optional) | Muscle 95 → 180 mmol/kg ww in 24 h; 203–207 vs 159 mmol/kg with vs without 3 high-CHO days; TBW +0.9 kg | 24 h | Plateau by 24–72 h | Returns to habitual level over days on normal diet | B | [7,9,10] |
| T6 | Glucose intolerance on carbohydrate re-entry — fast component | ≥3–5 d at ≤~30 %E carbohydrate | ↑OGTT/meal glucose iAUC, ↓first-phase insulin; ≈+1 mmol/L 2-h (UNVERIFIED) | Within 3 d of restriction | τ_f ≈ 2 d | Normalises in ~3–7 d of ≥150–250 g/d | B/C | [13,17,18] |
| T7 | Glucose intolerance — slow component | Months of VLC | 2-h OGTT 8.1–8.7 mmol/L (17/25 abnormal) | Weeks | τ_s ≈ 4 wk | −0.07 to −0.10 mmol/L/wk over wk 2–9 on 57 %E carbohydrate; ~half normalised at 10 wk | B | [12] |
| T8 | Ketone fall after carbohydrate | ≥~70 g carbohydrate meal in ketosis | Breath acetone 8.2 → 5.7 ppm; BHB 0.48 → 0.19 mmol/L after 2-wk refeed | Hours | — | Re-entry to stable ketosis 2–5 d (not in high-insulin) | B | [33,35] (05) |
| T9 | Fat-adaptation gain | VLC + ≥65 %E fat | Exercise fat oxidation ×2–3 (to ~1.3–1.5 g/min); O₂ cost +5–8 % | Days | τ_on ≈ 1.7 d (plateau 5–6 d) | — | B | [20,21,23] |
| T10 | Fat-adaptation loss | Return to HC | CHO oxidation only 61–78 % after 24 h HC | Day 1 | τ_off ≈ 2 d | Baseline after 5–6 d | B | [20,23,24] |
| T11 | Resting fat-oxidation lag after ↑fat | Isocaloric switch to high fat | Positive fat balance 1.06/0.75/0.55 MJ/d days 1–3 | Day 1 | τ ≈ 3 d; balanced by day 7 | Immediate if glycogen lowered by exercise | B | [37,38,39] |
| T12 | Induction symptoms | Carbohydrate <50 g/d from habitual HC | Reported by 101/300 forum users (not a prevalence); mild–severe | Day 1–3 | Median resolution 4.5 d (IQR 3–15) | Dwindles by 4 wk; may recur on re-entry (D) | C | [27,54] |
| T13 | High-intensity performance impairment | Fat-adapted state | −2 to −7 % race performance vs HC; submaximal endurance preserved | Days | Tracks F_ad | 2.5 wk HC: no rebound benefit | B | [20,21,22,25] |
| T14 | T3 fall | Carbohydrate <50 g/d + deficit; fasting | −35 to −53 % (fast/zero-carb VLCD); ≥50 g carbohydrate prevents at 800 kcal | Days | ~1–2 wk to nadir | Baseline within 1 wk of mixed diet | B | [138,139] |
| T15 | Leptin fall/rise | Fast / cumulative deficit / carbohydrate surplus | −64 to −72 % at 52 h fast; +28 % after 3 d carbohydrate overfeeding; ±12–35 % after 3-d ±30 % energy | Hours–days | Integrates ~3-d cumulative balance | Only when cumulative balance restored | B | [141,142,143] |
| T16 | LDL-C rise | VLC-high-fat | +44 % (5–107 %) at 3 wk; larger in lean | Within 24 h detectable | τ ≈ 1–1.5 wk (PROPOSED) | Assumed symmetric (UNVERIFIED) | B | [18,31,32,144] |
| T17 | TG rise (DNL) | VLF-HC, sugar-rich | DNL 37–43 % vs 6–12 % of VLDL-TG FA; TG ↑ | Days | ~1–2 wk | Unresolved whether transient | B | [26,40,41,42] |
| T18 | Ad-lib intake shift | VLF-HC (low energy density) vs VLC | −689 kcal/d on VLF over 2 wk; order carry-over −1,610 kcal/d | Days | Gut adaptation ~1–2 wk | — | B | [4,5] |
| T19 | Appetite in ketosis / after exit | Ketogenic VLED | Hunger ↑ days 1–12, then suppressed; ↑ after refeed | Day 3 | — | Rises on refeed | B | [34,35,36] |
| T20 | Microbiome composition shift | Animal-only ↔ plant-only | Community restructured | 1 d after diet reaches gut | τ ≈ 1 d | Reverts in ~2 d | B | [115,116] |
| T21 | Gut-content mass | Fibre/food mass change; fasting | ±0.2–0.7 kg | 1–2 d | τ ≈ transit/2 (≈1–1.5 d) | Symmetric | C | [5,117,118] |
| T22 | Gallbladder stasis / stones | <10 g fat per meal + rapid loss | Stones 4/6 vs 0/7 (8–16 wk); HR 3.4 VLCD vs LCD | Weeks | Accrues with loss rate & % | Risk falls after weight stabilises | B | [44,45,46] |
| T23 | Fasting weight loss | Zero energy | 0.9 kg/d wk 1 → 0.3 kg/d wk 3; 7 d: −5.7 kg (LM −3.6, FM −1.6) | Day 1 | — | See T24 | B | [29,130,131] |
| T24 | Post-fast rebound | Refeeding after 3–10-d fast | Lean deficit −3.6 → −0.69 kg in 3 d; fat loss kept (−1.85 kg) | Hours | 1–3 d | — | B | [130] |
| T25 | Protein loss early in VLCD/fast | Energy ≤50 % TDEE | N balance ≈ −1 to −3 g N/d early; → 0 at 1.5 g/kg IBW after ~3 wk | Day 1 | τ ≈ 10 d | Positive N balance on refeed/PSMF after deficit | B | [48,49,51,52,131] |
| T26 | RMR fall on VLCD/fast | ≤800 kcal or fast | −12 to −21 % (4 wk VLCD); −12 % (10-d fast) | Days | Significant by wk 3 | See 02 | B | [131,139] |
| T27 | Post-contest hormonal recovery | Return to maintenance after extreme leanness | T, T3, leptin, estradiol depressed | — | 3–5 months (T3, testosterone may lag) | — | C | [104,106,108,109] |
| T28 | Exercise plasma-volume expansion | Hard interval session | +4.5 mL/kg (+10 % PV) at 24 h | Hours | τ ≈ 2 d (PROPOSED) | — | B | [121,122] |
| T29 | Sodium step | ±100 mmol/d Na | ≈±0.4–0.5 kg peak | Day 1 | τ_Na ≈ 1 d; habituation ≈5 d | No TBW change at steady state | C | [119,120] |
| T30 | Weekly/holiday rhythm | Weekend/holiday intake | ±0.35 % BW within week; +1.35 % Christmas | — | 7-d cycle | Partial | B | [123,124] |
| T31 | Menstrual water | Cycle | Self-reported peak day 1 of flow; objective BW/TBW change ns | — | ~28-d cycle | — | C/D | [126,127,128] |
| T32 | Energy density of weight lost | Start of any deficit | ~4,860 kcal/kg at wk 4 → ~6,040 at wk 6 | — | ~4–6 wk | — | B | [75,76] |

## 4B. Deliverable (b) — Periodisation strategy verdicts

Verdict key: **Benefit** = real mechanistic benefit supported by controlled human data for that goal; **Neutral** = no
difference vs a linear regime at equal weekly energy/protein (may still be used for preference/adherence);
**Harmful** = worse on that goal; **Unknown** = no adequate data. The planner must never award a physiological
bonus to a strategy rated Neutral/Unknown.

| Strategy (mechanistic) | Key quantitative evidence | Fat loss | Lean mass | Performance | Metabolic markers | Adherence/appetite | Grade | Planner rule |
|---|---|---|---|---|---|---|---|---|
| Alternating VLC-high-fat ⇄ HC-VLF blocks (1–4 wk) at equal energy | Fat loss set by energy balance [1,3]; each switch costs T1–T19; order effects only via ad-lib intake [5] | Neutral | Neutral/Harmful (repeated early N loss on VLC entry [51,52]) | Harmful (fat-adaptation/de-adaptation, 5–6 d each way [20]) | Harmful-to-neutral (glucose intolerance on re-entry [12,13]; LDL swings [31]; TG on VLF [40]) | Unknown | B | Allow only if user-chosen; display transition costs; never justify by "metabolic flexibility" |
| PSMF/VLCD block, BMI ≥30 (or ≥27 + comorbidity) | 1–3 kg/wk; −21 kg over 17 wk [53]; T2D remission 46 % at 1 y [59]; long-term loss ≈ LCD [58,55] | Benefit (speed) | Neutral-to-harmful (higher FFM share with deeper deficit [63,65]) | n/a | Benefit (glycaemia, BP, TG, liver) [53,59] | Benefit short-term (ketosis appetite [36,34]); regain later [62] | A/B | Allowed only with "medical supervision required" flag, ECG, electrolytes, ≤26 wk, gallbladder rule |
| PSMF/aggressive block in lean trained people ("rapid fat loss", 1–4 wk) | No true-PSMF RCT; 40 % deficits with 2.3–2.4 g/kg protein preserve LBM over 2–4 wk [70,71]; 1.4 %/wk worse than 0.7 %/wk [68] | Benefit (speed) | Harmful if protein <2 g/kg or BF below ~10 % men [69]; neutral with 2.3–2.4 g/kg + RT | Harmful (endurance, power at low CHO [72]) | Unknown | Unknown | C | Cap by §4.16; ≤14 d if carbohydrate <50 g/d; require RT and ≥2.3 g/kg BW protein |
| Fast vs slow loss (equal total) | Regain 70.5 vs 71.2 % at 144 wk [64]; 4.5 vs 4.2 kg [65]; slow: FM −1 kg more, RMR ~97 kcal/d better [67] | Slight benefit for slow | Slight benefit for slow | Benefit for slow in athletes [68] | Rapid slightly better short-term glycaemia [66] | Rapid: more reach target [64] | A/B | Default 0.5–1 %BW/wk; rapid allowed for obesity goals |
| Diet breaks (1–2 wk at maintenance every 2–12 wk) | MATADOR +5 kg loss per same ER weeks [77]; ICECAP no difference [78]; Siedler no difference [82]; meta: smaller RMR fall [83] | Neutral per ER-week; slower per calendar week | Neutral | Small benefit (leg endurance [79]) | Neutral | Benefit (hunger ↓, disinhibition ↓) | B | Offer as adherence tool; model only glycogen/water rebound + 02 adaptation relaxation |
| Refeeds (1–2 d high-carbohydrate/week) | FFM −0.4 vs −1.3 kg, re-analysed: only dry FFM differs [80,81]; leptin transient [141] | Neutral | Neutral (weak signal) | Plausible benefit for glycogen-dependent sessions | Neutral | Unknown | C | Allowed ≤2 d/wk; no durable hormonal credit; breaks ketosis 2–5 d [33] |
| Calorie cycling / zig-zag (daily variation, equal weekly energy) | Regular intermittent → lean −0.86 kg [84]; small calorie-shifting trial [86] | Neutral | Neutral-to-harmful | Unknown | Neutral | Unknown | B | Neutral; allow for preference |
| Carbohydrate cycling to training ("fuel for the work required") | Mechanistic framework, mixed performance data [101] | Neutral | Neutral | Possible benefit (quality of hard sessions) | Neutral | Unknown | C | Allow; energy/protein accounting unchanged |
| 5:2 (2 non-consecutive days at ~25 % TDEE) | −6.4 vs −5.6 kg at 6 mo [89]; 2 d <40 g carbohydrate: FM −3.7 vs −2.0 kg at 3 mo [90]; long-term ≈ CER [94,95,96] | Neutral (short-term possible benefit) | Neutral/uncertain [84] | Unknown | Neutral (insulin slightly better [89,90]) | Individual | A/B | Neutral; allowed |
| ADF (0–25 % / 125–150 %) | −6.0 vs −5.3 % at 12 mo, dropout 38 vs 29 %, LDL +11.5 mg/dL [91]; zero-kcal ADF ≈ CR [92]; lean: FM −0.74 vs −1.75 kg [93]; NMA −1.29 kg vs CER short-term [97] | Neutral (lean: harmful per kg lost) | Harmful in lean [93] | Unknown | Neutral | Mixed (higher dropout) | A/B | Neutral for obese; discourage in lean muscle-gain goals |
| Weekly 24-h water-only fast | Fat loss = energy deficit; next-day compensation ≈17 % [135]; ADF data above | Neutral (via deficit) | Neutral/slightly harmful (lean ADF) | Harmful on fast day for training | Neutral | Individual | B/C | Allowed ≤1–2/wk in eligible adults (§9) |
| Monthly 48–72 h fast or 5-d low-energy block (~720–1,100 kcal) | FMD −2.6 kg over 3 cycles [133]; proteome changes only after ~3 d fasting [130] | Neutral (via deficit) | Transient loss mostly regained [130] | Harmful during/after block | Uncertain (08/20) | Individual | B/C | 72 h allowed with warnings; ≤ monthly |
| ~7-day water-only fast | −5.7 kg, 63 % lean during fast, lean largely back after 3-d refeed, fat −1.85 kg kept [130]; 10-d fast safe under supervision [131,132] | Neutral (≈1.6–2.3 kg fat) | Transient | Harmful during | Uncertain | — | B | **Simulate only; not planner-prescribable**; medical supervision; refeeding rules |
| Cyclical VLC (5 d VLC + 2 d carbohydrate load) | FM −1.9 vs −4.0 kg; LBM −1.8 kg; no strength/VO₂ gains [102]; ketosis re-entry 2–5 d [33] | Harmful vs balanced (1 trial) | Harmful (1 trial, BIA) | Harmful | Unknown | Unknown | C | Allowed only if chosen; flag costs |
| "Targeted" carbohydrate within VLC | No controlled trials | Unknown | Unknown | Unknown | Unknown | Unknown | D | Neutral; ketone dip modelled by 05 |
| Keto-adapt then carbohydrate-restore before a race | Performance −2.2 % despite restored glycogen [20]; no rebound after 2.5 wk [21] | n/a | n/a | Harmful (high-intensity) | n/a | n/a | B | Never prescribe for performance goals |
| Train-low / sleep-low (same daily CHO, re-timed) | 10-km −2.9 % vs −0.1 % [98]; +3.2 % TT [99]; elite: no effect [100] | Neutral | Neutral | Benefit (sub-elite endurance), neutral elite | Unknown | Unknown | B | Allowed for endurance goals; no fat-loss credit |
| Carbohydrate loading before >90-min event | 1 d at 10 g/kg saturates muscle [9] | n/a | n/a | Benefit (04/19) | n/a | n/a | A/B | Allowed; show +1–2 kg scale |
| Gain → cut cycles (surplus 10–20 % then deficit 0.5–1 %/wk) | Larger surplus: muscle +2.7 vs +1.1 %, fat +7.4 vs +0.8 % [112]; slow cut preserves LBM [68] | Goal-dependent | Benefit for hypertrophy in trained (11, 09) | Neutral | Neutral | Individual | B/C | Allowed for muscle-gain goals; limit surplus ≤20 % |
| Mini-cuts (2–6 wk aggressive deficit within a gain phase) | No trials | Benefit (speed, if B3 rules) | Unknown | Harmful short-term | Unknown | Unknown | D | Model as B3 |
| Reverse dieting | Regain 3.68 vs 2.73 vs 1.30 %, ns [113] | Neutral | Neutral | Neutral | Neutral | Possibly worse (harder to adhere) | C | Neutral; default immediate return to maintenance |
| Maintenance/recovery phase after extreme leanness (≥3–4 mo) | Hormones recover in 3–5 mo; T3/testosterone may lag [104,106,108] | n/a | Benefit | Benefit | Benefit (hormonal) | — | C | Required after contest-level leanness |
| Protein-first / low-carbohydrate refeed after a fast or PSMF | Mechanistic only; carbohydrate itself spares protein [51] | Neutral | Unknown | Unknown | Smaller water rebound; slower glucose re-tolerance (T6) | Unknown | C/D | Allowed; show smaller rebound, flag OGTT caveat |
| Alternating macros to "train metabolic flexibility" | No trials; adaptation is to current diet [37,20,19] | Neutral | Neutral | Harmful (transitions) | Neutral/harmful | — | D | No bonus term |
| VLCD/TDR 8–20 wk + stepped food reintroduction (T2D, obesity) | DiRECT, DROPLET [59–62] | Benefit (1–3 y) | Neutral | n/a | Benefit (T2D remission) | Benefit (structured) | A | Allowed with supervision flag for eligible users |

---

## 4C. Deliverable (c) — Regime building blocks for the planner

All energy is % of the user's current modelled TDEE (02) unless stated as absolute kcal. Protein references: BW = body
weight, IBW = ideal body weight (use BMI-22 weight if the app lacks a specific IBW formula; flag), LBM from 14.
"Entry/exit" lists the transients from §4A to be generated automatically by the engine.

**B0 — Mixed maintenance (reference).** Energy 100 %; protein 1.2–2.2 g/kg BW; fat 0.6–1.5 g/kg; carbohydrate =
remainder (typically 3–6 g/kg); fibre 25–40 g/d. No duration limit. Grade A (reference).

**B1 — Moderate continuous deficit.** Energy 75–85 % (target 0.5–1.0 %BW/wk); protein 1.6–2.4 g/kg BW if training,
≥1.2 g/kg otherwise (03); fat ≥0.5 g/kg and **≥10 g in at least one meal/day**; carbohydrate remainder. Duration
unlimited, but offer a B8 diet break every 4–12 weeks (adherence). Prerequisite: none beyond §9 floors. Grade A/B.

**B2 — Very-low-carbohydrate, eucaloric or deficit.** Carbohydrate <20–50 g/d (net); protein 1.2–2.0 g/kg BW;
fat = remainder (≥65 %E at maintenance). Energy 75–100 %. Min duration if chosen for ketosis/appetite: **21 d**
(induction occupies days 1–7); no known upper limit, but LDL/ApoB monitoring after 3–6 weeks (06). Entry: T1–T3, T8
(ketosis 2–7 d, 05), T9, T11, T12, T14 (if deficit), T16. Exit to carbohydrate: T4, T6/T7, T10, T17. Exclusions: type 1
diabetes, SGLT2 inhibitor use (ketoacidosis; 17), pregnancy. Grade B.

**B3 — Aggressive short deficit, trained (mini-cut).** Energy 55–70 % (≈30–45 % deficit) bounded by D_max (§4.16);
protein **2.3–2.4 g/kg BW**; carbohydrate ≥2 g/kg on training days (Walberg: low carbohydrate impairs endurance);
fat 0.5–0.8 g/kg with ≥10 g in one meal; resistance training ≥3 sessions/wk mandatory. Duration 2–4 weeks (evidence
window [70,71,69]); ≥4 weeks at maintenance before repeating. Prerequisites: BF ≥10 % (men) / ≥18 % (women, PROPOSED);
age 18–65; no ED history. Grade B/C.

**B4 — PSMF (protein-sparing modified fast).** Energy ≈600–900 kcal/d (absolute); protein **1.2–1.5 g/kg IBW**
(high biological value, ≥1.5 preferred); carbohydrate <20 g/d (up to 50 g allowed; more carbohydrate spares protein
[51] but delays ketosis); no added fat except **≥10 g fat in one meal/day** (gallbladder; the Cleveland protocol relies
on 45–70 g/d fat from protein foods). Supplements: multivitamin/mineral, K 16–20 mEq, Ca 1,000–1,200 mg,
Mg 400–500 mg, Na 1,500–2,000 mg, fluid ≥1.9 L/d [54]. Duration: planner ≤12 weeks per block (clinical programmes up
to 6 months [54]); never >26 weeks (Sours deaths at median 5 months of 300–400 kcal [56]). Exit: **refeed block B19**
over 6–8 weeks. Prerequisites: BMI ≥30, or ≥27 with comorbidity; age 16–65; baseline ECG; labs every 2 weeks in month 1;
exclusions per §4.15. Lean users (BMI <27): simulate only, or B3. Grade B (obese); D (lean).

**B5 — VLCD / total diet replacement (mixed-macronutrient formula).** 800–850 kcal/d absolute (DiRECT 825–853,
DROPLET 810); protein per formula (≥0.8–1.0 g/kg IBW; prefer ≥1.2 — 03); ≥10 g fat in one meal. Duration 8–20 weeks,
then stepped food reintroduction 2–8 weeks. Prerequisites as B4 (BMI ≥27 with T2D or ≥30). Grade A.

**B6 — Very-low-fat, high-carbohydrate.** Fat ≤10–15 %E (≈0.3–0.5 g/kg), carbohydrate 65–75 %E, protein 1.0–1.6 g/kg;
fibre ramp (B20) if fibre rises >20 g/d; sugars ≤10 %E to limit DNL/TG (T17). If also in deficit >1 kg/wk: ≥10 g fat
in one meal (gallbladder). Duration: no limit known; TG monitoring (06). Entry from B2/B4: T4, T6/T7, T10.
Grade B.

**B7 — Protein-only very-low-energy ("protein-only VLC week" in the user's example)** = B4 with carbohydrate
<20 g/d and fat only ≥10 g/meal-once-daily; for users not meeting B4 prerequisites it is **simulate-only** (warn).

**B8 — Diet break.** Energy 100 % (increase mainly carbohydrate); protein unchanged; 7–14 days after 2–12 weeks of
deficit. Expected: +0.5–1.0 kg scale in 2–4 days (T4), FM ≈0 [79]; hunger ↓. Grade B.

**B9 — Refeed day(s).** Energy 100–120 %; carbohydrate 6–10 g/kg; fat ≤0.6 g/kg; protein unchanged; 1–2
consecutive days, ≤2 d/week. Expected: +0.5–1.5 kg scale, resolving over 2–4 days on return to deficit; ketosis
broken for 2–5 days if coming from B2. Grade C.

**B10 — Carbohydrate load (pre-endurance event).** 10 g/kg/d for 24–36 h with minimal training (Bussau [9]); fat low;
protein 1.2–1.6 g/kg. Expected +1–2 kg (glycogen + water). Not after B2 within 7 days if the event is high-intensity
(T10/T13). Grade A/B.

**B11 — 5:2 intermittent restriction.** 2 non-consecutive days/week at ~25 % TDEE (≈500–700 kcal; Harvie
≈2,500–2,700 kJ, optionally <40 g carbohydrate) with protein ≥1.0–1.2 g/kg on those days (PROPOSED); other 5 days
~95–100 %. Duration 3–12 months studied. Grade A/B.

**B12 — Alternate-day restriction.** Alternate days at 0–25 % and 125–150 % TDEE. Duration 3 weeks–12 months studied.
Flag lower fat fraction of loss in lean people [93] and higher dropout [91]. Grade A/B.

**B13 — 24-h water-only fast** (dinner-to-dinner, or ~36 h to next breakfast): water ad lib, sodium 1–2 g
(PROPOSED electrolyte support; 20/15), zero energy. ≤2 per week, non-consecutive. Entry: T1–T2 partial, T8 onset;
exit: T4 (≈0.5–1.5 kg). Prerequisites §9 fasting eligibility. Grade B/C.

**B14 — 48-h water-only fast.** As B13; ≤1 per 2 weeks (PROPOSED). Entry drop ≈1.5–2.5 kg from HC state; ketosis
established (05/20). Exit rebound ≈1–2 kg over 2–3 d. Grade C.

**B15 — 72-h water-only fast.** As B13; ≤1 per month (PROPOSED; FMD-style monthly cycles [133]); requires warning and
eligibility; refeed first day ≤~50–60 % of TDEE then normal (PROPOSED; Buchinger-style ramp [131]). Grade C.

**B16 — ~7-day water-only fast (or 200–250 kcal/d Buchinger-type).** **Simulation only; not planner-prescribable.**
Medical supervision; refeed ramp over ≥3 days (800 → 1,600 kcal/d [131]); refeeding-syndrome screen (NICE criteria,
§4.18) — BMI <18.5 + >5 days = high risk; any >10 days = high risk. Grade B (outcomes), safety A.

**B17 — Fasting-mimicking 5-day block.** Day 1 ≈1,100 kcal, days 2–5 ≈720 kcal, 9–11 %E protein, high unsaturated
fat, low sugar [133]; once per month × 3. Note protein ≈16–30 g/d is below lean-sparing levels (03). Grade B/C.

**B18 — Train-low / sleep-low microcycle (endurance).** Same daily carbohydrate (≈6 g/kg); evening high-intensity
session with carbohydrate; no carbohydrate overnight; next-morning low-intensity fasted session; then refuel; 3 cycles
per week for 1–3 weeks [98,99]. Grade B.

**B19 — Carbohydrate reintroduction (exit ramp from B2/B4/B7).** Month 1 ≤45 g/d carbohydrate, month 2 ≤90 g/d,
low-glycaemic high-fibre sources, protein reduced stepwise (Cleveland [54]); or DiRECT-style 2–8-week stepped food
reintroduction [59]. Engine shows T4 (+1–3 kg), T6/T7. If an OGTT is planned: ≥150 g/d for ≥3 days minimum; after
≥4 weeks of B2/B4, warn that 4–9 weeks may be needed [12]. Grade B.

**B20 — Fibre ramp.** Increase fermentable fibre by ≤5–10 g/d per week (grade D; 15); gut mass rises ≈5 g stool per
g NSP (T21).

**B21 — Surplus / gaining phase.** Energy 110–120 %; protein 1.6–2.2 g/kg; fat 0.5–1.5 g/kg; carbohydrate ≥3–5 g/kg;
target +0.25–0.5 %BW/wk novice/intermediate, less if advanced [111]. Grade B/C (11).

**B22 — Post-diet maintenance / recovery.** Energy 100 % (immediate, not reverse-ramped); protein 1.6–2.2 g/kg;
duration ≥3–4 months after contest-level leanness (men <8 %, women <15 % BF — thresholds PROPOSED) before a new cut
[104,106,108]. Grade C.

### Sequencing rules for the planner (composition constraints)
1. **No sequencing bonus:** fat and lean trajectories are computed only from energy/protein/training inputs through
   01/03/09; blocks change them only through their own energy/protein content and the transients above.
2. **Minimum block lengths:** B2 ≥21 d when chosen for ketosis/appetite; do not alternate B2 ⇄ B0/B6 more often than
   every 14 d unless the user forces it (then display: induction days, glucose-intolerance days, LDL swing, scale swings).
3. **Refeeds** (B9) ≤2 d/week; each break of ketosis costs 2–5 d of re-entry (T8).
4. **Exit ramps are mandatory:** B4/B5/B7 → B19; B15/B16 → ramped refeed; fasts ≥48 h may not be followed immediately
   by a ≥120 % day (PROPOSED).
5. **Gallbladder rule:** any block with expected loss >1.0 kg/wk must contain ≥10 g fat in one meal per day.
6. **Deficit cap:** D_max (§4.16) and the absolute floors in 17; cumulative loss >20–24 % of initial weight within
   6 months triggers a gallstone/medical-review warning.
7. **Performance goals:** no B2/B7 within 7 days before a high-intensity endurance target; B10 for events >90 min.
8. **Clinical tests:** schedule glucose testing only when (1−A_f) < 0.1 and (1−A_s) < 0.2.
9. **Diet breaks:** offer B8 after every 4–12 weeks of deficit as an adherence tool (appetite ↓), with visible scale rise.
10. **Recovery:** after contest-level leanness, enforce B22 for ≥12 weeks before another deficit.

### Worked example (user's example schedule) — expected transients
"2 wk very-low-carbohydrate high-fat (B2) → 2 wk high-carbohydrate very-low-fat (B6) → 1 wk protein-only
very-low-energy (B7)", all at stated energies:
- **Days 1–7 (B2):** scale −1.5 to −2.5 kg (T1–T3, + gut if fibre falls), fat per energy balance only; induction
  symptoms peak ~day 2–4; ketosis stable by ~day 3–7; LDL rising (T16); fat-adaptation ~95 % by day 6.
- **Days 15–19 (→ B6):** scale +1.5 to +3 kg within 3–5 d (glycogen, sodium, gut fill from high fibre) even in a deficit;
  postprandial glucose elevated for ~3–7 d (T6); fat-adaptation lost by ~day 20 (T10); TG rising (T17); if fat <10 g
  per meal and loss >1 kg/wk, gallbladder flag.
- **Days 29–35 (→ B7):** scale −1.5 to −3 kg in 3–4 d (T1, T2, gut emptying), induction symptoms re-appear,
  N balance −1 to −3 g N/d (T25), T3 ↓ (T14), leptin ↓ (T15); B7 exit to maintenance: +1.5 to +3 kg in 3–5 d.
- **Net fat change:** identical to the same total energy/protein delivered linearly; **no periodisation bonus**.

---

## 5. Interactions with other subsystems

| Dossier | This module needs | This module gives |
|---|---|---|
| 01 body-weight models | FM, FFM_core, energy-balance partition (Forbes/Hall), energy density of tissue | Labile compartments for `W_scale`; validation targets T3/T23/T32 (week-1 composition) |
| 02 energy expenditure | TDEE, RMR, adaptive thermogenesis with decay during maintenance blocks | Evidence that breaks reduce RMR fall modestly [77,83]; VLCD RMR −12 to −21 % [139] |
| 03 protein/MPS | Protein kinetics, N balance baseline | PSMF/VLCD N-balance fit (§4.15), carbohydrate protein-sparing [51,52] |
| 04 glycogen/insulin | G_liv, G_mus kinetics; insulin; glucose tolerance baseline | h (water), A_f/A_s carbohydrate-tolerance states, OGTT-readiness flag |
| 05 fat oxidation/ketosis | Ketone level, ketosis entry/exit | F_ad (exercise fat adaptation), ketosis re-entry cost after refeeds [33], keto-flu Φ |
| 06 lipids | LDL/ApoB/TG models | Transition triggers and time-scales (T16, T17) |
| 07 meal timing / 20 fasting | Fasting physiology hour-by-hour, eating windows | Entry/exit (HC vs VLC), refeed rebound, periodic-fast verdicts, refeeding-risk counter |
| 08 autophagy | Fasting-duration signals | No body-composition credit for fasting per se [93] |
| 09/10 training | Session type/dose (glycogen use, damage) | P_ex, F_ad effects on performance, sleep-low block B18 |
| 11 surplus | Partitioning in surplus | Gain-phase limits (B21) and verdicts |
| 12 hormones/appetite | Leptin, T3, ghrelin, appetite model | Carbohydrate/fast triggers (T14, T15, T19), B_cum, U_food carry-over, diet-break adherence score |
| 14 body composition | Muscle mass (glycogen capacity), IBW/LBM, BF % | DXA/BIA "lean" includes W_gw+E_cna → measurement-model correction |
| 15 fibre/sodium/water | Fibre fermentability, sodium, fluid | M_gut, S_na, sodium mitigation of induction symptoms (D) |
| 16 sex/menstrual | Cycle phase, sex differences | W_mc (small), female data gaps |
| 17 safety | Absolute floors, contraindications | PSMF/VLCD/fast eligibility, refeeding criteria, gallbladder rules |
| 18 planner | Search over blocks | Block catalogue §4C, sequencing rules, verdicts (no sequencing bonus) |
| 19 performance | Performance model | F_ad effects, keto-adapt/restore harm, sleep-low benefit |

---

## 6. Output metrics for the UI

| Metric | Unit | Good direction | Computation | Grade |
|---|---|---|---|---|
| Scale weight | kg | goal-dependent | `W_scale` (§4.1) | B |
| True tissue weight / fat mass | kg | ↓ fat for loss goals | `W_true`, FM from 01 | A/B |
| "Water & glycogen weight" | kg | — (explanatory) | (1+h)·G + E_cna + S_na/140 + P_ex + W_mc | B/C |
| Gut fill | kg | — | M_gut − M_gut,ref | C |
| Fat share of this week's scale change | % | — | ΔFM / ΔW_scale | B |
| Transition cost index | days | ↓ | Days in the last 28 with Φ_ind > 0.2, or (1−A_f) > 0.2, or F_ad in (0.2, 0.8) | C |
| Glucose-test readiness | yes/no + days to ready | ready | (1−A_f) < 0.1 and (1−A_s) < 0.2 | B/C |
| Carbohydrate tolerance (predicted 2-h OGTT shift) | mmol/L | ↓ | ΔG_2h (§4.8) | C |
| Fat-adaptation index | 0–1 | goal-dependent | F_ad | B |
| Induction symptom index | 0–1 | ↓ | Φ_ind | C |
| High-intensity performance modifier | % | ↑ | −(2–7 %)·F_ad (19) | B |
| Gallstone risk multiplier | × | ↓ | GB_risk | B/C |
| PSMF/fast safety status | flag | green | Eligibility + duration counters (§9) | A (rules) |
| Refeeding-risk flag | flag | green | NICE criteria with N_lowintake, BMI, loss % | A (rules) |
| Diet-adherence score (appetite relief) | 0–1 | ↑ | + for B8 breaks, − for ADF in some users (12) | C |
| Weeks since last maintenance phase | wk | — | from schedule | — |

---

## 7. Validation targets (deliverable d)

| # | Study (subjects) | Conditions in | Outcomes the engine must reproduce | Tolerance |
|---|---|---|---|---|
| V1 | Hall 2016 [3] (17 men, BMI 25–35, ward) | 4 wk 50 %E-CHO baseline → 4 wk isocaloric 5 %E-CHO, protein clamped | Rapid extra −1.6 ± 0.2 kg after the switch (≈first week); FM −0.2 ± 0.1 kg over KD days 1–15 vs −0.5 ± 0.1 kg over last 15 d of baseline; urinary N +1.5 g/d early KD | ±0.4 kg; FM ±0.2 kg |
| V2 | Yang & Van Itallie 1976 [1] (6 obese) | 10 d each: 800 kcal ketogenic vs 800 kcal mixed | 467 vs 278 g/d weight loss; water 61 % vs 37 %; fat 163 vs 165 g/d (equal) | ±20 % weight; fat within ±15 g/d |
| V3 | Pietzner 2024 [130] (12 adults, BMI 25.4) | 7-d water-only fast, then 3 d ad-lib | −5.7 ± 0.8 kg; LM −3.6, FM −1.6 kg; after refeed LM −0.69, FM −1.85 kg | ±1 kg weight; LM recovery ≥70 % in 3 d |
| V4 | Laurens 2021 [131] (16 men, BMI 26.2) | 10-d fast at 200–250 kcal/d + ≤3 h/d light activity; refeed 800 → 1,600 kcal over 3 d | −5.9 kg; FM −2.3 kg; lean soft tissue −3.5 kg (44 % ECW, 14 % glycogen+water, 42 % tissue); BMR −12 %; weight loss maintained through refeed | ±1 kg; BMR ±5 pts |
| V5 | Burke 2021 [20] (elite walkers) | 5–6 d <50 g/d CHO, 80 %E fat, then 24 h HCHO + 2 g/kg pre-race | Exercise fat ox ~1.4 g/min (>200 %); O₂ cost +5–8 %; CHO ox 61–78 % after 24 h; baseline after 5–6 d HCHO | F_ad-driven values within ±20 % |
| V6 | Jansen 2022 [12] (post-15 % loss, 14–15 wk VLC) | Switch to 57 %E-CHO (starch or sugar) vs stay VLC, 10 wk | 2-h OGTT ≈8.1–8.7 mmol/L at switch; decline −0.07 to −0.10 mmol/L/wk weeks 2–9; abnormal 17→9/25 vs VLC 10/16 unchanged | Slope ±0.05 mmol/L/wk |
| V7 | Peos 2021 [79] (26 RT athletes) | 1-wk diet break at maintenance (carbohydrate ↑) after 12 wk IER | BW +0.6 kg, DXA "FFM" +0.7 kg, FM ≈0, REE +200 kJ/d | ±0.3 kg |
| V8 | MATADOR [77] (obese men) | 16 wk at 67 % maintenance: continuous vs 2-wk on/off (30 wk) | −9.1 vs −14.1 kg; FM −8.0 vs −12.3 kg; weight change during balance blocks 0.0 ± 0.3 kg | Directional; balance blocks ±0.5 kg |
| V9 | Vink 2016 [65] (BMI 28–35) | 500 kcal × 5 wk vs 1,250 kcal × 12 wk, then 4 wk stable + 9 mo | −9.0 vs −8.2 kg; regain 4.5 vs 4.2 kg (no rate effect) | ±1.5 kg |
| V10 | Templeman 2021 [93] (lean adults, 3 wk) | 0:150 ADF vs 75:75 daily vs 0:200 | BM −1.60 vs −1.91 vs −0.52 kg; FM −0.74 vs −1.75 vs −0.12 kg | FM ±0.5 kg; ordering must match |
| V11 | Wilson 2020 [26] (RT men) | 10 wk isocaloric ketogenic + RT → 1 wk carbohydrate reintroduction | DXA LBM +4.8 % in the reintroduction week; TG ↑ | ±1.5 %-points |
| V12 | Kerndt 1982 [29] (review of fasting data) | Total fast | ≈0.9 kg/d week 1 → ≈0.3 kg/d week 3 | ±0.2 kg/d |
| V13 | Sciarrillo 2024 [5] (20 adults, ward, ad lib) | 2 wk VLC (≈10 %E CHO) → 2 wk VLF (≈10 %E fat) | Weeks 1–2: −2.2 ± 0.7 kg (FFM −1.9, FM −0.2); weeks 3–4 FM −1.2 ± 0.4 kg | ±0.6 kg |
| V14 | Gebhard 1996 [44] | 520 kcal <2 g fat/d vs 900 kcal with 30 g fat incl. one 10-g-fat meal, 22 % loss | Gallstones 4/6 vs 0/7 | GB_risk ordering |
| V15 | Schrauwen 1997 [37] (12 lean, chamber) | Isocaloric switch from low-fat to high-fat | Fat balance +1.06, +0.75, +0.55 MJ/d days 1–3; ≈0 by day 7 | ±0.3 MJ/d (emergent from 01/04) |

---

## 8. Myths / contested claims

| Claim | Evidence | Verdict |
|---|---|---|
| "The first week of very-low-carb burns lots of fat" | Water 61 % of loss; fat loss equal to a mixed diet at equal energy [1]; 1.6 kg rapid water loss [3] | False |
| "Weight regained after a refeed/diet break is fat" | +0.6 kg BW with +0.7 kg DXA FFM, FM 0 [79]; glycogen + water [2,7] | False |
| "Refeeds/carb-ups reset leptin and metabolism" | Leptin rises transiently with carbohydrate surplus [141], tracks cumulative balance [143]; RMR differences ≤~100 kcal/d, often null [78,80,82,83] | Mostly false (transient) |
| "Rapid weight loss is regained faster" | Equal regain [64,65]; long-term VLCD ≈ LCD [58] | False |
| "Rapid loss is harmless for muscle" | FFM share rises with deficit severity [63,65]; slower better in athletes [68] | False (small cost) |
| "Reverse dieting prevents fat regain" | No advantage in a randomised trial [113] | Unsupported |
| "Keto-adapt, then carb-load = best of both fuels" | Performance and economy impaired despite restored glycogen [20,21,23] | False for high-intensity events |
| "3 days of ≥150 g carbohydrate always normalises an OGTT" | True on ordinary diets [14,15]; not after months of VLC (weeks needed) [12] | Conditionally false |
| "Alternating diets trains metabolic flexibility" | Adaptation follows the current diet within ~5–7 d; no residual benefit found [19,20,37] | Unsupported |
| "Fasting burns fat faster than the same deficit spread out" | 0:150 ADF lost less fat than daily 75 % [93]; 0:200 lost none | False |
| "A week-long fast destroys muscle" | Lean loss is mostly water/glycogen and largely returns within 3 d [130,131] | Overstated (some real protein loss) |
| "PSMF preserves all muscle" | N balance ≈0 only after ~3 wk at 1.5 g/kg IBW [49]; early N losses; more FFM loss at deeper deficits [63] | Partly false |
| "Salt makes you retain water permanently" | Steady-state high salt did not raise TBW [119] | False (transient only) |
| "Women carry 1–2 kg of cyclical water before menses" | Self-reported bloating peaks day 1 [126]; objective BW/TBW change ns [127,128] | Unsupported as a general rule |
| "Cyclical keto keeps you in ketosis while allowing carb days" | Re-entry takes 2–5 d after one carbohydrate meal [33]; inferior outcomes in one RCT [102] | False |

---

## 9. Safety bounds (feed into 17)

- **PSMF/VLCD (B4, B5, B7):** planner-prescribable only for BMI ≥30 (or ≥27 with comorbidity), age 16–65, no
  contraindication (§4.15), with "medical supervision required": baseline ECG; electrolytes/uric acid at baseline,
  every 2 weeks in month 1, monthly after; supplements (multivitamin, K 16–20 mEq, Ca 1,000–1,200 mg, Mg 400–500 mg,
  Na 1.5–2 g, fluid ≥1.9 L) [54]. Hard stop at 26 weeks; planner default ≤12 weeks per block; **never <~1.2 g/kg IBW
  protein or <~600 kcal/d**; historic sudden deaths at ~300–400 kcal/d largely-protein regimens after a median of
  5 months [56,57]. Insulin/sulfonylurea users: medication adjustment by clinician before carbohydrate restriction
  (insulin was withdrawn within 0–19 d in [47]).
- **Gallstones:** loss >1.5 kg/wk (after week 2), >20–24 % cumulative loss, or <10 g fat per meal → warning; require
  ≥10 g fat in one meal/day during any B3–B7 block [44,45,46].
- **Fasting eligibility (B13–B16):** exclude pregnancy/lactation, age <18, BMI <18.5, eating-disorder history, type 1
  diabetes or insulin/sulfonylurea/SGLT2-inhibitor use (euglycaemic ketoacidosis risk; 17), gout, advanced kidney
  disease, arrhythmia/QT prolongation (fasting complications include gout, urate stones, postural hypotension and
  arrhythmias [29,57]; 17). 24 h ≤2/week; 48 h ≤ every 2 weeks; 72 h ≤ monthly with warning; >72 h simulation-only.
- **Refeeding syndrome:** apply NICE criteria each day with `N_lowintake` (little/no intake >5 days + BMI <18.5 → high
  risk; >10 days → high risk regardless) [136]; high-risk refeeding starts ≤10 kcal/kg/d (≤5 kcal/kg/d if BMI ≤14 or
  ≥2 weeks negligible intake); watch P/K/Mg in the first 5 days [137].
- **Deficit cap:** D_max (§4.16); lean athletes ≤1 %BW/wk; contest-level leanness triggers hormonal-suppression and
  menstrual-irregularity warnings [106,108] and a ≥12-week recovery (B22).
- **Clinical testing caveat:** show "OGTT/CGM may over-read dysglycaemia" for weeks after VLC [12].
- **Performance safety:** no VLC/PSMF in the 7 days before high-intensity competition; induction-phase orthostatic
  hypotension warning (salt/fluids) [54].
- **Lipids:** VLC-high-fat blocks >3 weeks in lean people → LDL/ApoB check prompt (06) [31,32].

---

## 10. Open questions / weakest assumptions

1. **Slow carbohydrate-tolerance component (τ_s ≈ 4 wk, a_s ≈ 1 mmol/L)** is fitted to one trial (Jansen [12]) in
   weight-reduced adults after 14–15 weeks; whether 1–2 weeks of restriction already loads it is unknown. The fast
   component's magnitude (a_f) is UNVERIFIED (only iAUC data [13,17]).
2. **Natriuresis/antinatriuresis parameters** (E_max, τ) rest on few quantitative human data (Heyman, Kerndt, residual
   from Hall 2016); sex/age moderators unknown.
3. **Gut-content model** uses stool-mass data from one wheat-fibre study [117]; morning gut mass after meat-only vs
   plant-heavy patterns has not been measured directly.
4. **Menstrual water**: subjective vs objective discordance; default kept small (UNVERIFIED).
5. **PSMF in lean trained people** — no controlled data; B3/B7 rules are extrapolations from 2–4-week 40 % deficits.
6. **Refeed composition after fasts/PSMF** (carbohydrate vs protein-first) never compared for body composition.
7. **Repeated alternation**: whether repeated VLC⇄HC cycling has cumulative harms (e.g., glucose tolerance, LDL
   exposure) or habituation of induction symptoms is unstudied.
8. **Diet breaks**: MATADOR (obese men, 2-wk blocks) vs ICECAP/Siedler (trained, 1-wk breaks) disagree on efficiency;
   the effect may depend on deficit size and adiposity; female data limited.
9. **Alpert's fat-transfer limit** derives from starvation-era data; its use as a planner cap is a synthesis (grade C).
10. **Laurens 2021 3-month follow-up**: full text suggests fat mass returned toward baseline in the 12 subjects
    re-measured while body weight stayed lower — needs verification before being used as a target (UNVERIFIED).
11. Much of the athlete evidence is male (race walkers, cyclists, lifters); women's transition kinetics are
    under-studied (16).

---

## 11. References
1. Yang MU, Van Itallie TB. Composition of weight lost during short-term weight reduction. Metabolic responses of obese subjects to starvation and low-calorie ketogenic and nonketogenic diets. J Clin Invest. 1976;58(3):722-30. PMID 956398; doi:10.1172/JCI108519; PMC333231. https://pubmed.ncbi.nlm.nih.gov/956398/
2. Kreitzman SN, Coxon AY, Szaz KF. Glycogen storage: illusions of easy weight loss, excessive weight regain, and distortions in estimates of body composition. Am J Clin Nutr. 1992;56(1 Suppl):292S-293S. PMID 1615908; doi:10.1093/ajcn/56.1.292S. https://pubmed.ncbi.nlm.nih.gov/1615908/
3. Hall KD, Chen KY, Guo J, et al. Energy expenditure and body composition changes after an isocaloric ketogenic diet in overweight and obese men. Am J Clin Nutr. 2016;104(2):324-33. PMID 27385608; doi:10.3945/ajcn.116.133561; PMC4962163. https://pubmed.ncbi.nlm.nih.gov/27385608/
4. Hall KD, Guo J, Courville AB, et al. Effect of a plant-based, low-fat diet versus an animal-based, ketogenic diet on ad libitum energy intake. Nat Med. 2021;27(2):344-353. PMID 33479499; doi:10.1038/s41591-020-01209-1. https://pubmed.ncbi.nlm.nih.gov/33479499/
5. Sciarrillo CM, Guo J, Hengist A, et al. Diet order significantly affects energy balance for diets varying in macronutrients but not ultraprocessing in crossover studies without a washout period. Am J Clin Nutr. 2024;120(4):953-963. PMID 39163976; doi:10.1016/j.ajcnut.2024.08.013; PMC11473439. https://pubmed.ncbi.nlm.nih.gov/39163976/
6. Fernández-Elías VE, Ortega JF, Nelson RK, et al. Relationship between muscle water and glycogen recovery after prolonged exercise in the heat in humans. Eur J Appl Physiol. 2015;115(9):1919-26. PMID 25911631; doi:10.1007/s00421-015-3175-z. https://pubmed.ncbi.nlm.nih.gov/25911631/
7. Shiose K, Yamada Y, Motonaga K, et al. Segmental extracellular and intracellular water distribution and muscle glycogen after 72-h carbohydrate loading using spectroscopic techniques. J Appl Physiol (1985). 2016;121(1):205-11. PMID 27231310; doi:10.1152/japplphysiol.00126.2016. https://pubmed.ncbi.nlm.nih.gov/27231310/
8. Olsson KE, Saltin B. Variation in total body water with muscle glycogen changes in man. Acta Physiol Scand. 1970;80(1):11-8. PMID 5475323; doi:10.1111/j.1748-1716.1970.tb04764.x. https://pubmed.ncbi.nlm.nih.gov/5475323/
9. Bussau VA, Fairchild TJ, Rao A, et al. Carbohydrate loading in human muscle: an improved 1 day protocol. Eur J Appl Physiol. 2002;87(3):290-5. PMID 12111292; doi:10.1007/s00421-002-0621-5. https://pubmed.ncbi.nlm.nih.gov/12111292/
10. Sherman WM, Costill DL, Fink WJ, et al. Effect of exercise-diet manipulation on muscle glycogen and its subsequent utilization during performance. Int J Sports Med. 1981;2(2):114-8. PMID 7333741; doi:10.1055/s-2008-1034594. https://pubmed.ncbi.nlm.nih.gov/7333741/
11. Rothman DL, Magnusson I, Katz LD, et al. Quantitation of hepatic glycogenolysis and gluconeogenesis in fasting humans with 13C NMR. Science. 1991;254(5031):573-6. PMID 1948033; doi:10.1126/science.1948033. https://pubmed.ncbi.nlm.nih.gov/1948033/
12. Jansen LT, Yang N, Wong JMW, et al. Prolonged Glycemic Adaptation Following Transition From a Low- to High-Carbohydrate Diet: A Randomized Controlled Feeding Trial. Diabetes Care. 2022;45(3):576-584. PMID 35108378; doi:10.2337/dc21-1970; PMC8918196. https://pubmed.ncbi.nlm.nih.gov/35108378/
13. Numao S, Kawano H, Endo N, et al. Short-term low carbohydrate/high-fat diet intake increases postprandial plasma glucose and glucagon-like peptide-1 levels during an oral glucose tolerance test in healthy men. Eur J Clin Nutr. 2012;66(8):926-31. PMID 22669333; doi:10.1038/ejcn.2012.58. https://pubmed.ncbi.nlm.nih.gov/22669333/
14. Crowe SM, Mastrobattista JM, Monga M. Oral glucose tolerance test and the preparatory diet. Am J Obstet Gynecol. 2000;182(5):1052-4. PMID 10819825; doi:10.1067/mob.2000.105391. https://pubmed.ncbi.nlm.nih.gov/10819825/
15. Hughes RO. Reduced carbohydrate intake in the preparatory diet and the reliability of the oral glucose tolerance test. Aviat Space Environ Med. 1975;46(5):725-8. PMID 1131138. https://pubmed.ncbi.nlm.nih.gov/1131138/
16. WILKERSON HL, HYMAN H, KAUFMAN M, et al. Diagnostic evaluation of oral glucose tolerance tests in nondiabetic subjects after various levels of carbohydrate intake. N Engl J Med. 1960;262:1047-53. PMID 13844739; doi:10.1056/NEJM196005262622101. https://pubmed.ncbi.nlm.nih.gov/13844739/
17. Goedecke JH, Christie C, Wilson G, et al. Metabolic adaptations to a high-fat diet in endurance cyclists. Metabolism. 1999;48(12):1509-17. PMID 10599981; doi:10.1016/s0026-0495(99)90238-x. https://pubmed.ncbi.nlm.nih.gov/10599981/
18. Rosenbaum M, Hall KD, Guo J, et al. Glucose and Lipid Homeostasis and Inflammation in Humans Following an Isocaloric Ketogenic Diet. Obesity (Silver Spring). 2019;27(6):971-981. PMID 31067015; doi:10.1002/oby.22468; PMC6922028. https://pubmed.ncbi.nlm.nih.gov/31067015/
19. Hengist A, Davies RG, Walhin JP, et al. Ketogenic diet but not free-sugar restriction alters glucose tolerance, lipid metabolism, peripheral tissue phenotype, and gut microbiome: RCT. Cell Rep Med. 2024;5(8):101667. PMID 39106867; doi:10.1016/j.xcrm.2024.101667; PMC11384946. https://pubmed.ncbi.nlm.nih.gov/39106867/
20. Burke LM, Whitfield J, Heikura IA, et al. Adaptation to a low carbohydrate high fat diet is rapid but impairs endurance exercise metabolism and performance despite enhanced glycogen availability. J Physiol. 2021;599(3):771-790. PMID 32697366; doi:10.1113/JP280221; PMC7891450. https://pubmed.ncbi.nlm.nih.gov/32697366/
21. Burke LM, Sharma AP, Heikura IA, et al. Crisis of confidence averted: Impairment of exercise economy and performance in elite race walkers by ketogenic low carbohydrate, high fat (LCHF) diet is reproducible. PLoS One. 2020;15(6):e0234027. PMID 32497061; doi:10.1371/journal.pone.0234027; PMC7272074. https://pubmed.ncbi.nlm.nih.gov/32497061/
22. Burke LM, Ross ML, Garvican-Lewis LA, et al. Low carbohydrate, high fat diet impairs exercise economy and negates the performance benefit from intensified training in elite race walkers. J Physiol. 2017;595(9):2785-2807. PMID 28012184; doi:10.1113/JP273230; PMC5407976. https://pubmed.ncbi.nlm.nih.gov/28012184/
23. Stellingwerff T, Spriet LL, Watt MJ, et al. Decreased PDH activation and glycogenolysis during exercise following fat adaptation with carbohydrate restoration. Am J Physiol Endocrinol Metab. 2006;290(2):E380-8. PMID 16188909; doi:10.1152/ajpendo.00268.2005. https://pubmed.ncbi.nlm.nih.gov/16188909/
24. Burke LM, Hawley JA, Angus DJ, et al. Adaptations to short-term high-fat diet persist during exercise despite high carbohydrate availability. Med Sci Sports Exerc. 2002;34(1):83-91. PMID 11782652; doi:10.1097/00005768-200201000-00014. https://pubmed.ncbi.nlm.nih.gov/11782652/
25. Phinney SD, Bistrian BR, Evans WJ, et al. The human metabolic response to chronic ketosis without caloric restriction: preservation of submaximal exercise capability with reduced carbohydrate oxidation. Metabolism. 1983;32(8):769-76. PMID 6865776; doi:10.1016/0026-0495(83)90106-3. https://pubmed.ncbi.nlm.nih.gov/6865776/
26. Wilson JM, Lowery RP, Roberts MD, et al. Effects of Ketogenic Dieting on Body Composition, Strength, Power, and Hormonal Profiles in Resistance Training Men. J Strength Cond Res. 2020;34(12):3463-3474. PMID 28399015; doi:10.1519/JSC.0000000000001935. https://pubmed.ncbi.nlm.nih.gov/28399015/
27. Bostock ECS, Kirkby KC, Taylor BV, et al. Consumer Reports of "Keto Flu" Associated With the Ketogenic Diet. Front Nutr. 2020;7:20. PMID 32232045; doi:10.3389/fnut.2020.00020; PMC7082414. https://pubmed.ncbi.nlm.nih.gov/32232045/
28. Heyman SN, Bursztyn M, Szalat A, et al. Fasting-Induced Natriuresis and SGLT: A New Hypothesis for an Old Enigma. Front Endocrinol (Lausanne). 2020;11:217. PMID 32457696; doi:10.3389/fendo.2020.00217; PMC7221140. https://pubmed.ncbi.nlm.nih.gov/32457696/
29. Kerndt PR, Naughton JL, Driscoll CE, et al. Fasting: the history, pathophysiology and complications. West J Med. 1982;137(5):379-99. PMID 6758355; PMC1274154. https://pubmed.ncbi.nlm.nih.gov/6758355/
30. Numao S, Kawano H, Endo N, et al. Effects of a single bout of aerobic exercise on short-term low-carbohydrate/high-fat intake-induced postprandial glucose metabolism during an oral glucose tolerance test. Metabolism. 2013;62(10):1406-15. PMID 23764436; doi:10.1016/j.metabol.2013.05.005. https://pubmed.ncbi.nlm.nih.gov/23764436/
31. Retterstøl K, Svendsen M, Narverud I, et al. Effect of low carbohydrate high fat diet on LDL cholesterol and gene expression in normal-weight, young adults: A randomized controlled study. Atherosclerosis. 2018;279:52-61. PMID 30408717; doi:10.1016/j.atherosclerosis.2018.10.013. https://pubmed.ncbi.nlm.nih.gov/30408717/
32. Budoff M, Manubolu VS, Kinninger A, et al. Carbohydrate Restriction-Induced Elevations in LDL-Cholesterol and Atherosclerosis: The KETO Trial. JACC Adv. 2024;3(8):101109. PMID 39372369; doi:10.1016/j.jacadv.2024.101109; PMC11450898. https://pubmed.ncbi.nlm.nih.gov/39372369/
33. Kempf K, Martin S. Effects of a Carbohydrate Meal on Lipolysis. Nutrients. 2024;16(20):3531. PMID 39458525; doi:10.3390/nu16203531; PMC11510632. https://pubmed.ncbi.nlm.nih.gov/39458525/
34. Nymo S, Coutinho SR, Jørgensen J, et al. Timeline of changes in appetite during weight loss with a ketogenic diet. Int J Obes (Lond). 2017;41(8):1224-1231. PMID 28439092; doi:10.1038/ijo.2017.96; PMC5550564. https://pubmed.ncbi.nlm.nih.gov/28439092/
35. Sumithran P, Prendergast LA, Delbridge E, et al. Ketosis and appetite-mediating nutrients and hormones after weight loss. Eur J Clin Nutr. 2013;67(7):759-64. PMID 23632752; doi:10.1038/ejcn.2013.90. https://pubmed.ncbi.nlm.nih.gov/23632752/
36. Gibson AA, Seimon RV, Lee CM, et al. Do ketogenic diets really suppress appetite? A systematic review and meta-analysis. Obes Rev. 2015;16(1):64-76. PMID 25402637; doi:10.1111/obr.12230. https://pubmed.ncbi.nlm.nih.gov/25402637/
37. Schrauwen P, van Marken Lichtenbelt WD, Saris WH, et al. Changes in fat oxidation in response to a high-fat diet. Am J Clin Nutr. 1997;66(2):276-82. PMID 9250105; doi:10.1093/ajcn/66.2.276. https://pubmed.ncbi.nlm.nih.gov/9250105/
38. Schrauwen P, van Marken Lichtenbelt WD, Saris WH, et al. Role of glycogen-lowering exercise in the change of fat oxidation in response to a high-fat diet. Am J Physiol. 1997;273(3 Pt 1):E623-9. PMID 9316454; doi:10.1152/ajpendo.1997.273.3.E623. https://pubmed.ncbi.nlm.nih.gov/9316454/
39. Smith SR, de Jonge L, Zachwieja JJ, et al. Concurrent physical activity increases fat oxidation during the shift to a high-fat diet. Am J Clin Nutr. 2000;72(1):131-8. PMID 10871571; doi:10.1093/ajcn/72.1.131. https://pubmed.ncbi.nlm.nih.gov/10871571/
40. Hudgins LC, Hellerstein M, Seidman C, et al. Human fatty acid synthesis is stimulated by a eucaloric low fat, high carbohydrate diet. J Clin Invest. 1996;97(9):2081-91. PMID 8621798; doi:10.1172/JCI118645; PMC507283. https://pubmed.ncbi.nlm.nih.gov/8621798/
41. Hudgins LC, Hellerstein MK, Seidman CE, et al. Relationship between carbohydrate-induced hypertriglyceridemia and fatty acid synthesis in lean and obese subjects. J Lipid Res. 2000;41(4):595-604. PMID 10744780. https://pubmed.ncbi.nlm.nih.gov/10744780/
42. Parks EJ, Hellerstein MK. Carbohydrate-induced hypertriacylglycerolemia: historical perspective and review of biological mechanisms. Am J Clin Nutr. 2000;71(2):412-33. PMID 10648253; doi:10.1093/ajcn/71.2.412. https://pubmed.ncbi.nlm.nih.gov/10648253/
43. Festi D, Colecchia A, Larocca A, et al. Review: low caloric intake and gall-bladder motor function. Aliment Pharmacol Ther. 2000;14 Suppl 2:51-3. PMID 10903004; doi:10.1046/j.1365-2036.2000.014s2051.x. https://pubmed.ncbi.nlm.nih.gov/10903004/
44. Gebhard RL, Prigge WF, Ansel HJ, et al. The role of gallbladder emptying in gallstone formation during diet-induced rapid weight loss. Hepatology. 1996;24(3):544-8. PMID 8781321; doi:10.1002/hep.510240313. https://pubmed.ncbi.nlm.nih.gov/8781321/
45. Erlinger S. Gallstones in obesity and weight loss. Eur J Gastroenterol Hepatol. 2000;12(12):1347-52. PMID 11192327; doi:10.1097/00042737-200012120-00015. https://pubmed.ncbi.nlm.nih.gov/11192327/
46. Johansson K, Sundström J, Marcus C, et al. Risk of symptomatic gallstones and cholecystectomy after a very-low-calorie diet or low-calorie diet in a commercial weight loss program: 1-year matched cohort study. Int J Obes (Lond). 2014;38(2):279-84. PMID 23736359; doi:10.1038/ijo.2013.83; PMC3921672. https://pubmed.ncbi.nlm.nih.gov/23736359/
47. Bistrian BR, Blackburn GL, Flatt JP, et al. Nitrogen metabolism and insulin requirements in obese diabetic adults on a protein-sparing modified fast. Diabetes. 1976;25(6):494-504. PMID 1278601; doi:10.2337/diab.25.6.494. https://pubmed.ncbi.nlm.nih.gov/1278601/
48. Bistrian DR, Winterer J, Blackburn GL, et al. Effect of a protein-sparing diet and brief fast on nitrogen metabolism in mildly obese subjects. J Lab Clin Med. 1977;89(5):1030-5. PMID 858966. https://pubmed.ncbi.nlm.nih.gov/858966/
49. Hoffer LJ, Bistrian BR, Young VR, et al. Metabolic effects of very low calorie weight reduction diets. J Clin Invest. 1984;73(3):750-8. PMID 6707202; doi:10.1172/JCI111268; PMC425077. https://pubmed.ncbi.nlm.nih.gov/6707202/
50. Hoffer LJ, Bistrian BR, Young VR, et al. Metabolic effects of carbohydrate in low-calorie diets. Metabolism. 1984;33(9):820-5. PMID 6472116; doi:10.1016/0026-0495(84)90108-2. https://pubmed.ncbi.nlm.nih.gov/6472116/
51. Vazquez JA, Kazi U, Madani N. Protein metabolism during weight reduction with very-low-energy diets: evaluation of the independent effects of protein and carbohydrate on protein sparing. Am J Clin Nutr. 1995;62(1):93-103. PMID 7598072; doi:10.1093/ajcn/62.1.93. https://pubmed.ncbi.nlm.nih.gov/7598072/
52. Vazquez JA, Adibi SA. Protein sparing during treatment of obesity: ketogenic versus nonketogenic very low calorie diet. Metabolism. 1992;41(4):406-14. PMID 1556948; doi:10.1016/0026-0495(92)90076-m. https://pubmed.ncbi.nlm.nih.gov/1556948/
53. Palgi A, Read JL, Greenberg I, et al. Multidisciplinary treatment of obesity with a protein-sparing modified fast: results in 668 outpatients. Am J Public Health. 1985;75(10):1190-4. PMID 4037162; doi:10.2105/ajph.75.10.1190; PMC1646394. https://pubmed.ncbi.nlm.nih.gov/4037162/
54. Chang J, Kashyap SR. The protein-sparing modified fast for obese patients with type 2 diabetes: what to expect. Cleve Clin J Med. 2014;81(9):557-65. PMID 25183847; doi:10.3949/ccjm.81a.13128. https://pubmed.ncbi.nlm.nih.gov/25183847/
55. Pfoh ER, Lowenthal G, Jeffers L, et al. The Effect of Starting the Protein-Sparing Modified Fast on Weight Change over 5 years. J Gen Intern Med. 2020;35(3):704-710. PMID 31916212; doi:10.1007/s11606-019-05535-0; PMC7080885. https://pubmed.ncbi.nlm.nih.gov/31916212/
56. Sours HE, Frattali VP, Brand CD, et al. Sudden death associated with very low calorie weight reduction regimens. Am J Clin Nutr. 1981;34(4):453-61. PMID 7223697; doi:10.1093/ajcn/34.4.453. https://pubmed.ncbi.nlm.nih.gov/7223697/
57. Isner JM, Sours HE, Paris AL, et al. Sudden, unexpected death in avid dieters using the liquid-protein-modified-fast diet. Observations in 17 patients and the role of the prolonged QT interval. Circulation. 1979;60(6):1401-12. PMID 498466; doi:10.1161/01.cir.60.6.1401. https://pubmed.ncbi.nlm.nih.gov/498466/
58. Tsai AG, Wadden TA. The evolution of very-low-calorie diets: an update and meta-analysis. Obesity (Silver Spring). 2006;14(8):1283-93. PMID 16988070; doi:10.1038/oby.2006.146. https://pubmed.ncbi.nlm.nih.gov/16988070/
59. Lean ME, Leslie WS, Barnes AC, et al. Primary care-led weight management for remission of type 2 diabetes (DiRECT): an open-label, cluster-randomised trial. Lancet. 2018;391(10120):541-551. PMID 29221645; doi:10.1016/S0140-6736(17)33102-1. https://pubmed.ncbi.nlm.nih.gov/29221645/
60. Lean MEJ, Leslie WS, Barnes AC, et al. Durability of a primary care-led weight-management intervention for remission of type 2 diabetes: 2-year results of the DiRECT open-label, cluster-randomised trial. Lancet Diabetes Endocrinol. 2019;7(5):344-355. PMID 30852132; doi:10.1016/S2213-8587(19)30068-3. https://pubmed.ncbi.nlm.nih.gov/30852132/
61. Astbury NM, Aveyard P, Nickless A, et al. Doctor Referral of Overweight People to Low Energy total diet replacement Treatment (DROPLET): pragmatic randomised controlled trial. BMJ. 2018;362:k3760. PMID 30257983; doi:10.1136/bmj.k3760; PMC6156558. https://pubmed.ncbi.nlm.nih.gov/30257983/
62. Astbury NM, Edwards RM, Ghebretinsea F, et al. Extended follow-up of a short total diet replacement programme: results of the Doctor Referral of Overweight People to Low Energy total diet replacement Treatment (DROPLET) randomised controlled trial at 3 years. Int J Obes (Lond). 2021;45(11):2432-2438. PMID 34302120; doi:10.1038/s41366-021-00915-1; PMC8528708. https://pubmed.ncbi.nlm.nih.gov/34302120/
63. Chaston TB, Dixon JB, O'Brien PE. Changes in fat-free mass during significant weight loss: a systematic review. Int J Obes (Lond). 2007;31(5):743-50. PMID 17075583; doi:10.1038/sj.ijo.0803483. https://pubmed.ncbi.nlm.nih.gov/17075583/
64. Purcell K, Sumithran P, Prendergast LA, et al. The effect of rate of weight loss on long-term weight management: a randomised controlled trial. Lancet Diabetes Endocrinol. 2014;2(12):954-62. PMID 25459211; doi:10.1016/S2213-8587(14)70200-1. https://pubmed.ncbi.nlm.nih.gov/25459211/
65. Vink RG, Roumans NJ, Arkenbosch LA, et al. The effect of rate of weight loss on long-term weight regain in adults with overweight and obesity. Obesity (Silver Spring). 2016;24(2):321-7. PMID 26813524; doi:10.1002/oby.21346. https://pubmed.ncbi.nlm.nih.gov/26813524/
66. Ashtary-Larky D, Ghanavati M, Lamuchi-Deli N, et al. Rapid Weight Loss vs. Slow Weight Loss: Which is More Effective on Body Composition and Metabolic Risk Factors? Int J Endocrinol Metab. 2017;15(3):e13249. PMID 29201070; doi:10.5812/ijem.13249; PMC5702468. https://pubmed.ncbi.nlm.nih.gov/29201070/
67. Ashtary-Larky D, Bagheri R, Abbasnezhad A, et al. Effects of gradual weight loss v. rapid weight loss on body composition and RMR: a systematic review and meta-analysis. Br J Nutr. 2020;124(11):1121-1132. PMID 32576318; doi:10.1017/S000711452000224X. https://pubmed.ncbi.nlm.nih.gov/32576318/
68. Garthe I, Raastad T, Refsnes PE, et al. Effect of two different weight-loss rates on body composition and strength and power-related performance in elite athletes. Int J Sport Nutr Exerc Metab. 2011;21(2):97-104. PMID 21558571; doi:10.1123/ijsnem.21.2.97. https://pubmed.ncbi.nlm.nih.gov/21558571/
69. Huovinen HT, Hulmi JJ, Isolehto J, et al. Body composition and power performance improved after weight reduction in male athletes without hampering hormonal balance. J Strength Cond Res. 2015;29(1):29-36. PMID 25028999; doi:10.1519/JSC.0000000000000619. https://pubmed.ncbi.nlm.nih.gov/25028999/
70. Mettler S, Mitchell N, Tipton KD. Increased protein intake reduces lean body mass loss during weight loss in athletes. Med Sci Sports Exerc. 2010;42(2):326-37. PMID 19927027; doi:10.1249/MSS.0b013e3181b2ef8e. https://pubmed.ncbi.nlm.nih.gov/19927027/
71. Longland TM, Oikawa SY, Mitchell CJ, et al. Higher compared with lower dietary protein during an energy deficit combined with intense exercise promotes greater lean mass gain and fat mass loss: a randomized trial. Am J Clin Nutr. 2016;103(3):738-46. PMID 26817506; doi:10.3945/ajcn.115.119339. https://pubmed.ncbi.nlm.nih.gov/26817506/
72. Walberg JL, Leidy MK, Sturgill DJ, et al. Macronutrient content of a hypoenergy diet affects nitrogen retention and muscle function in weight lifters. Int J Sports Med. 1988;9(4):261-6. PMID 3182156; doi:10.1055/s-2007-1025018. https://pubmed.ncbi.nlm.nih.gov/3182156/
73. Alpert SS. A limit on the energy transfer rate from the human fat store in hypophagia. J Theor Biol. 2005;233(1):1-13. PMID 15615615; doi:10.1016/j.jtbi.2004.08.029. https://pubmed.ncbi.nlm.nih.gov/15615615/
74. Helms ER, Aragon AA, Fitschen PJ. Evidence-based recommendations for natural bodybuilding contest preparation: nutrition and supplementation. J Int Soc Sports Nutr. 2014;11:20. PMID 24864135; doi:10.1186/1550-2783-11-20; PMC4033492. https://pubmed.ncbi.nlm.nih.gov/24864135/
75. Heymsfield SB, Thomas D, Martin CK, et al. Energy content of weight loss: kinetic features during voluntary caloric restriction. Metabolism. 2012;61(7):937-43. PMID 22257646; doi:10.1016/j.metabol.2011.11.012; PMC3810417. https://pubmed.ncbi.nlm.nih.gov/22257646/
76. Hall KD. What is the required energy deficit per unit weight loss? Int J Obes (Lond). 2008;32(3):573-6. PMID 17848938; doi:10.1038/sj.ijo.0803720; PMC2376744. https://pubmed.ncbi.nlm.nih.gov/17848938/
77. Byrne NM, Sainsbury A, King NA, et al. Intermittent energy restriction improves weight loss efficiency in obese men: the MATADOR study. Int J Obes (Lond). 2018;42(2):129-138. PMID 28925405; doi:10.1038/ijo.2017.206; PMC5803575. https://pubmed.ncbi.nlm.nih.gov/28925405/
78. Peos JJ, Helms ER, Fournier PA, et al. Continuous versus Intermittent Dieting for Fat Loss and Fat-Free Mass Retention in Resistance-trained Adults: The ICECAP Trial. Med Sci Sports Exerc. 2021;53(8):1685-1698. PMID 33587549; doi:10.1249/MSS.0000000000002636. https://pubmed.ncbi.nlm.nih.gov/33587549/
79. Peos JJ, Helms ER, Fournier PA, et al. A 1-week diet break improves muscle endurance during an intermittent dieting regime in adult athletes: A pre-specified secondary analysis of the ICECAP trial. PLoS One. 2021;16(2):e0247292. PMID 33630880; doi:10.1371/journal.pone.0247292; PMC7906362. https://pubmed.ncbi.nlm.nih.gov/33630880/
80. Campbell BI, Aguilar D, Colenso-Semple LM, et al. Intermittent Energy Restriction Attenuates the Loss of Fat Free Mass in Resistance Trained Individuals. A Randomized Controlled Trial. J Funct Morphol Kinesiol. 2020;5(1):19. PMID 33467235; doi:10.3390/jfmk5010019; PMC7739314. https://pubmed.ncbi.nlm.nih.gov/33467235/
81. Peos J, Brown AW, Vorland CJ, et al. Contrary to the Conclusions Stated in the Paper, Only Dry Fat-Free Mass Was Different between Groups upon Reanalysis. Comment on: "Intermittent Energy Restriction Attenuates the Loss of Fat-Free Mass in Resistance Trained Individuals. A Randomized Controlled Trial". J Funct Morphol Kinesiol. 2020;5(4):85. PMID 33467300; doi:10.3390/jfmk5040085; PMC7739336. https://pubmed.ncbi.nlm.nih.gov/33467300/
82. Siedler MR, Lewis MH, Trexler ET, et al. The Effects of Intermittent Diet Breaks during 25% Energy Restriction on Body Composition and Resting Metabolic Rate in Resistance-Trained Females: A Randomized Controlled Trial. J Hum Kinet. 2023;86:117-132. PMID 37181269; doi:10.5114/jhk/159960; PMC10170537. https://pubmed.ncbi.nlm.nih.gov/37181269/
83. Poon ET, Tsang JH, Sun F, et al. Effects of intermittent dieting with break periods on body composition and metabolic adaptation: a systematic review and meta-analysis. Nutr Rev. 2025;83(1):59-71. PMID 38193357; doi:10.1093/nutrit/nuad168. https://pubmed.ncbi.nlm.nih.gov/38193357/
84. Roman YM, Dominguez MC, Easow TM, et al. Effects of intermittent versus continuous dieting on weight and body composition in obese and overweight people: a systematic review and meta-analysis of randomized controlled trials. Int J Obes (Lond). 2019;43(10):2017-2027. PMID 30206335; doi:10.1038/s41366-018-0204-0. https://pubmed.ncbi.nlm.nih.gov/30206335/
85. Seimon RV, Roekenes JA, Zibellini J, et al. Do intermittent diets provide physiological benefits over continuous diets for weight loss? A systematic review of clinical trials. Mol Cell Endocrinol. 2015;418 Pt 2:153-72. PMID 26384657; doi:10.1016/j.mce.2015.09.014. https://pubmed.ncbi.nlm.nih.gov/26384657/
86. Davoodi SH, Ajami M, Ayatollahi SA, et al. Calorie shifting diet versus calorie restriction diet: a comparative clinical trial study. Int J Prev Med. 2014;5(4):447-56. PMID 24829732; PMC4018593. https://pubmed.ncbi.nlm.nih.gov/24829732/
87. Wing RR, Jeffery RW. Prescribed "breaks" as a means to disrupt weight control efforts. Obes Res. 2003;11(2):287-91. PMID 12582226; doi:10.1038/oby.2003.43. https://pubmed.ncbi.nlm.nih.gov/12582226/
88. Coutinho SR, Halset EH, Gåsbakk S, et al. Compensatory mechanisms activated with intermittent energy restriction: A randomized control trial. Clin Nutr. 2018;37(3):815-823. PMID 28446382; doi:10.1016/j.clnu.2017.04.002. https://pubmed.ncbi.nlm.nih.gov/28446382/
89. Harvie MN, Pegington M, Mattson MP, et al. The effects of intermittent or continuous energy restriction on weight loss and metabolic disease risk markers: a randomized trial in young overweight women. Int J Obes (Lond). 2011;35(5):714-27. PMID 20921964; doi:10.1038/ijo.2010.171; PMC3017674. https://pubmed.ncbi.nlm.nih.gov/20921964/
90. Harvie M, Wright C, Pegington M, et al. The effect of intermittent energy and carbohydrate restriction v. daily energy restriction on weight loss and metabolic disease risk markers in overweight women. Br J Nutr. 2013;110(8):1534-47. PMID 23591120; doi:10.1017/S0007114513000792; PMC5857384. https://pubmed.ncbi.nlm.nih.gov/23591120/
91. Trepanowski JF, Kroeger CM, Barnosky A, et al. Effect of Alternate-Day Fasting on Weight Loss, Weight Maintenance, and Cardioprotection Among Metabolically Healthy Obese Adults: A Randomized Clinical Trial. JAMA Intern Med. 2017;177(7):930-938. PMID 28459931; doi:10.1001/jamainternmed.2017.0936; PMC5680777. https://pubmed.ncbi.nlm.nih.gov/28459931/
92. Catenacci VA, Pan Z, Ostendorf D, et al. A randomized pilot study comparing zero-calorie alternate-day fasting to daily caloric restriction in adults with obesity. Obesity (Silver Spring). 2016;24(9):1874-83. PMID 27569118; doi:10.1002/oby.21581; PMC5042570. https://pubmed.ncbi.nlm.nih.gov/27569118/
93. Templeman I, Smith HA, Chowdhury E, et al. A randomized controlled trial to isolate the effects of fasting and energy restriction on weight loss and metabolic health in lean adults. Sci Transl Med. 2021;13(598):eabd8034. PMID 34135111; doi:10.1126/scitranslmed.abd8034. https://pubmed.ncbi.nlm.nih.gov/34135111/
94. Headland M, Clifton PM, Carter S, et al. Weight-Loss Outcomes: A Systematic Review and Meta-Analysis of Intermittent Energy Restriction Trials Lasting a Minimum of 6 Months. Nutrients. 2016;8(6):354. PMID 27338458; doi:10.3390/nu8060354; PMC4924195. https://pubmed.ncbi.nlm.nih.gov/27338458/
95. Headland ML, Clifton PM, Keogh JB. Impact of intermittent vs. continuous energy restriction on weight and cardiometabolic factors: a 12-month follow-up. Int J Obes (Lond). 2020;44(6):1236-1242. PMID 31937907; doi:10.1038/s41366-020-0525-7. https://pubmed.ncbi.nlm.nih.gov/31937907/
96. Elortegui Pascual P, Rolands MR, Eldridge AL, et al. A meta-analysis comparing the effectiveness of alternate day fasting, the 5:2 diet, and time-restricted eating for weight loss. Obesity (Silver Spring). 2023;31 Suppl 1(Suppl 1):9-21. PMID 36349432; doi:10.1002/oby.23568; PMC10098946. https://pubmed.ncbi.nlm.nih.gov/36349432/
97. Semnani-Azad Z, Khan TA, Chiavaroli L, et al. Intermittent fasting strategies and their effects on body weight and other cardiometabolic risk factors: systematic review and network meta-analysis of randomised clinical trials. BMJ. 2025;389:e082007. PMID 40533200; doi:10.1136/bmj-2024-082007; PMC12175170. https://pubmed.ncbi.nlm.nih.gov/40533200/
98. Marquet LA, Brisswalter J, Louis J, et al. Enhanced Endurance Performance by Periodization of Carbohydrate Intake: "Sleep Low" Strategy. Med Sci Sports Exerc. 2016;48(4):663-72. PMID 26741119; doi:10.1249/MSS.0000000000000823. https://pubmed.ncbi.nlm.nih.gov/26741119/
99. Marquet LA, Hausswirth C, Molle O, et al. Periodization of Carbohydrate Intake: Short-Term Effect on Performance. Nutrients. 2016;8(12):755. PMID 27897989; doi:10.3390/nu8120755; PMC5188410. https://pubmed.ncbi.nlm.nih.gov/27897989/
100. Gejl KD, Thams LB, Hansen M, et al. No Superior Adaptations to Carbohydrate Periodization in Elite Endurance Athletes. Med Sci Sports Exerc. 2017;49(12):2486-2497. PMID 28723843; doi:10.1249/MSS.0000000000001377. https://pubmed.ncbi.nlm.nih.gov/28723843/
101. Impey SG, Hearris MA, Hammond KM, et al. Fuel for the Work Required: A Theoretical Framework for Carbohydrate Periodization and the Glycogen Threshold Hypothesis. Sports Med. 2018;48(5):1031-1048. PMID 29453741; doi:10.1007/s40279-018-0867-7; PMC5889771. https://pubmed.ncbi.nlm.nih.gov/29453741/
102. Kysel P, Haluzíková D, Doležalová RP, et al. The Influence of Cyclical Ketogenic Reduction Diet vs. Nutritionally Balanced Reduction Diet on Body Composition, Strength, and Endurance Performance in Healthy Young Males: A Randomized Controlled Trial. Nutrients. 2020;12(9):2832. PMID 32947920; doi:10.3390/nu12092832; PMC7551961. https://pubmed.ncbi.nlm.nih.gov/32947920/
103. Greene DA, Varley BJ, Hartwig TB, et al. A Low-Carbohydrate Ketogenic Diet Reduces Body Mass Without Compromising Performance in Powerlifting and Olympic Weightlifting Athletes. J Strength Cond Res. 2018;32(12):3373-3382. PMID 30335720; doi:10.1519/JSC.0000000000002904. https://pubmed.ncbi.nlm.nih.gov/30335720/
104. Rossow LM, Fukuda DH, Fahs CA, et al. Natural bodybuilding competition preparation and recovery: a 12-month case study. Int J Sports Physiol Perform. 2013;8(5):582-92. PMID 23412685; doi:10.1123/ijspp.8.5.582. https://pubmed.ncbi.nlm.nih.gov/23412685/
105. Kistler BM, Fitschen PJ, Ranadive SM, et al. Case study: Natural bodybuilding contest preparation. Int J Sport Nutr Exerc Metab. 2014;24(6):694-700. PMID 24901578; doi:10.1123/ijsnem.2014-0016. https://pubmed.ncbi.nlm.nih.gov/24901578/
106. Pardue A, Trexler ET, Sprod LK. Case Study: Unfavorable But Transient Physiological Changes During Contest Preparation in a Drug-Free Male Bodybuilder. Int J Sport Nutr Exerc Metab. 2017;27(6):550-559. PMID 28770669; doi:10.1123/ijsnem.2017-0064. https://pubmed.ncbi.nlm.nih.gov/28770669/
107. Chappell AJ, Simper T, Barker ME. Nutritional strategies of high level natural bodybuilders during competition preparation. J Int Soc Sports Nutr. 2018;15:4. PMID 29371857; doi:10.1186/s12970-018-0209-z; PMC5769537. https://pubmed.ncbi.nlm.nih.gov/29371857/
108. Hulmi JJ, Isola V, Suonpää M, et al. The Effects of Intensive Weight Reduction on Body Composition and Serum Hormones in Female Fitness Competitors. Front Physiol. 2016;7:689. PMID 28119632; doi:10.3389/fphys.2016.00689; PMC5222856. https://pubmed.ncbi.nlm.nih.gov/28119632/
109. Tinsley GM, Trexler ET, Smith-Ryan AE, et al. Changes in Body Composition and Neuromuscular Performance Through Preparation, 2 Competitions, and a Recovery Period in an Experienced Female Physique Athlete. J Strength Cond Res. 2019;33(7):1823-1839. PMID 30036283; doi:10.1519/JSC.0000000000002758. https://pubmed.ncbi.nlm.nih.gov/30036283/
110. Trexler ET, Smith-Ryan AE, Norton LE. Metabolic adaptation to weight loss: implications for the athlete. J Int Soc Sports Nutr. 2014;11(1):7. PMID 24571926; doi:10.1186/1550-2783-11-7; PMC3943438. https://pubmed.ncbi.nlm.nih.gov/24571926/
111. Iraki J, Fitschen P, Espinar S, et al. Nutrition Recommendations for Bodybuilders in the Off-Season: A Narrative Review. Sports (Basel). 2019;7(7):154. PMID 31247944; doi:10.3390/sports7070154; PMC6680710. https://pubmed.ncbi.nlm.nih.gov/31247944/
112. Ribeiro AS, Nunes JP, Schoenfeld BJ, et al. Effects of Different Dietary Energy Intake Following Resistance Training on Muscle Mass and Body Fat in Bodybuilders: A Pilot Study. J Hum Kinet. 2019;70:125-134. PMID 31915482; doi:10.2478/hukin-2019-0038; PMC6942464. https://pubmed.ncbi.nlm.nih.gov/31915482/
113. Rodriguez Da Silva V, Muniz M, Shelton G, et al. The effects of reverse dieting on mitigating weight regain after a caloric deficit: a preliminary analysis. J Int Soc Sports Nutr. 2025;22(Suppl 2):2550185 (conference-supplement abstract; PubMed ID not located). https://pmc.ncbi.nlm.nih.gov/articles/PMC12381988/
114. Goodpaster BH, Sparks LM. Metabolic Flexibility in Health and Disease. Cell Metab. 2017;25(5):1027-1036. PMID 28467922; doi:10.1016/j.cmet.2017.04.015; PMC5513193. https://pubmed.ncbi.nlm.nih.gov/28467922/
115. David LA, Maurice CF, Carmody RN, et al. Diet rapidly and reproducibly alters the human gut microbiome. Nature. 2014;505(7484):559-63. PMID 24336217; doi:10.1038/nature12820; PMC3957428. https://pubmed.ncbi.nlm.nih.gov/24336217/
116. Wu GD, Chen J, Hoffmann C, et al. Linking long-term dietary patterns with gut microbial enterotypes. Science. 2011;334(6052):105-8. PMID 21885731; doi:10.1126/science.1208344; PMC3368382. https://pubmed.ncbi.nlm.nih.gov/21885731/
117. Stephen AM, Wiggins HS, Englyst HN, et al. The effect of age, sex and level of intake of dietary fibre from wheat on large-bowel function in thirty healthy subjects. Br J Nutr. 1986;56(2):349-61. PMID 2823871; doi:10.1079/bjn19860116. https://pubmed.ncbi.nlm.nih.gov/2823871/
118. Pritchard SE, Marciani L, Garsed KC, et al. Fasting and postprandial volumes of the undisturbed colon: normal values and changes in diarrhea-predominant irritable bowel syndrome measured using serial MRI. Neurogastroenterol Motil. 2014;26(1):124-30. PMID 24131490; doi:10.1111/nmo.12243; PMC3995006. https://pubmed.ncbi.nlm.nih.gov/24131490/
119. Heer M, Baisch F, Kropp J, et al. High dietary sodium chloride consumption may not induce body fluid retention in humans. Am J Physiol Renal Physiol. 2000;278(4):F585-95. PMID 10751219; doi:10.1152/ajprenal.2000.278.4.F585. https://pubmed.ncbi.nlm.nih.gov/10751219/
120. Birukov A, Rakova N, Lerchl K, et al. Ultra-long-term human salt balance studies reveal interrelations between sodium, potassium, and chloride intake and excretion. Am J Clin Nutr. 2016;104(1):49-57. PMID 27225435; doi:10.3945/ajcn.116.132951; PMC4919532. https://pubmed.ncbi.nlm.nih.gov/27225435/
121. Gillen CM, Lee R, Mack GW, et al. Plasma volume expansion in humans after a single intense exercise protocol. J Appl Physiol (1985). 1991;71(5):1914-20. PMID 1761491; doi:10.1152/jappl.1991.71.5.1914. https://pubmed.ncbi.nlm.nih.gov/1761491/
122. Convertino VA. Blood volume response to physical activity and inactivity. Am J Med Sci. 2007;334(1):72-9. PMID 17630597; doi:10.1097/MAJ.0b013e318063c6e4. https://pubmed.ncbi.nlm.nih.gov/17630597/
123. Turicchi J, O'Driscoll R, Horgan G, et al. Weekly, seasonal and holiday body weight fluctuation patterns among individuals engaged in a European multi-centre behavioural weight loss maintenance intervention. PLoS One. 2020;15(4):e0232152. PMID 32353079; doi:10.1371/journal.pone.0232152; PMC7192384. https://pubmed.ncbi.nlm.nih.gov/32353079/
124. Orsama AL, Mattila E, Ermes M, et al. Weight rhythms: weight increases during weekends and decreases during weekdays. Obes Facts. 2014;7(1):36-47. PMID 24504358; doi:10.1159/000356147; PMC5644907. https://pubmed.ncbi.nlm.nih.gov/24504358/
125. Lipsitz LA, Storch HA, Minaker KL, et al. Intra-individual variability in postural blood pressure in the elderly. Clin Sci (Lond). 1985;69(3):337-41. PMID 4064574; doi:10.1042/cs0690337. https://pubmed.ncbi.nlm.nih.gov/4064574/
126. White CP, Hitchcock CL, Vigna YM, et al. Fluid Retention over the Menstrual Cycle: 1-Year Data from the Prospective Ovulation Cohort. Obstet Gynecol Int. 2011;2011:138451. PMID 21845193; doi:10.1155/2011/138451; PMC3154522. https://pubmed.ncbi.nlm.nih.gov/21845193/
127. Takano Y, Shirai T, Tanaka Y, et al. The difference between subjective symptoms and objective symptom of edema during the menstrual cycle. Sci Rep. 2026;16(1):25009. PMID 42225881; doi:10.1038/s41598-026-55554-1; PMC13462954. https://pubmed.ncbi.nlm.nih.gov/42225881/
128. Bisson DL, Dunster GD, O'Hare JP, et al. Renal sodium retention does not occur during the luteal phase of the menstrual cycle in normal women. Br J Obstet Gynaecol. 1992;99(3):247-52. PMID 1534995; doi:10.1111/j.1471-0528.1992.tb14507.x. https://pubmed.ncbi.nlm.nih.gov/1534995/
129. Stachenfeld NS. Sex hormone effects on body fluid regulation. Exerc Sport Sci Rev. 2008;36(3):152-9. PMID 18580296; doi:10.1097/JES.0b013e31817be928; PMC2849969. https://pubmed.ncbi.nlm.nih.gov/18580296/
130. Pietzner M, Uluvar B, Kolnes KJ, et al. Systemic proteome adaptions to 7-day complete caloric restriction in humans. Nat Metab. 2024;6(4):764-777. PMID 38429390; doi:10.1038/s42255-024-01008-9; PMC7617311. https://pubmed.ncbi.nlm.nih.gov/38429390/
131. Laurens C, Grundler F, Damiot A, et al. Is muscle and protein loss relevant in long-term fasting in healthy men? A prospective trial on physiological adaptations. J Cachexia Sarcopenia Muscle. 2021;12(6):1690-1703. PMID 34668663; doi:10.1002/jcsm.12766; PMC8718030. https://pubmed.ncbi.nlm.nih.gov/34668663/
132. Wilhelmi de Toledo F, Grundler F, Bergouignan A, et al. Safety, health improvement and well-being during a 4 to 21-day fasting period in an observational study including 1422 subjects. PLoS One. 2019;14(1):e0209353. PMID 30601864; doi:10.1371/journal.pone.0209353; PMC6314618. https://pubmed.ncbi.nlm.nih.gov/30601864/
133. Wei M, Brandhorst S, Shelehchi M, et al. Fasting-mimicking diet and markers/risk factors for aging, diabetes, cancer, and cardiovascular disease. Sci Transl Med. 2017;9(377):eaai8700. PMID 28202779; doi:10.1126/scitranslmed.aai8700; PMC6816332. https://pubmed.ncbi.nlm.nih.gov/28202779/
134. Bak AM, Møller AB, Vendelbo MH, et al. Differential regulation of lipid and protein metabolism in obese vs. lean subjects before and after a 72-h fast. Am J Physiol Endocrinol Metab. 2016;311(1):E224-35. PMID 27245338; doi:10.1152/ajpendo.00464.2015. https://pubmed.ncbi.nlm.nih.gov/27245338/
135. Johnstone AM, Faber P, Gibney ER, et al. Effect of an acute fast on energy compensation and feeding behaviour in lean men and women. Int J Obes Relat Metab Disord. 2002;26(12):1623-8. PMID 12461679; doi:10.1038/sj.ijo.0802151. https://pubmed.ncbi.nlm.nih.gov/12461679/
136. Mehanna HM, Moledina J, Travis J. Refeeding syndrome: what it is, and how to prevent and treat it. BMJ. 2008;336(7659):1495-8. PMID 18583681; doi:10.1136/bmj.a301; PMC2440847. https://pubmed.ncbi.nlm.nih.gov/18583681/
137. da Silva JSV, Seres DS, Sabino K, et al. ASPEN Consensus Recommendations for Refeeding Syndrome. Nutr Clin Pract. 2020;35(2):178-195. PMID 32115791; doi:10.1002/ncp.10474. https://pubmed.ncbi.nlm.nih.gov/32115791/
138. Spaulding SW, Chopra IJ, Sherwin RS, et al. Effect of caloric restriction and dietary composition of serum T3 and reverse T3 in man. J Clin Endocrinol Metab. 1976;42(1):197-200. PMID 1249190; doi:10.1210/jcem-42-1-197. https://pubmed.ncbi.nlm.nih.gov/1249190/
139. Mathieson RA, Walberg JL, Gwazdauskas FC, et al. The effect of varying carbohydrate content of a very-low-caloric diet on resting metabolic rate and thyroid hormones. Metabolism. 1986;35(5):394-8. PMID 3702673; doi:10.1016/0026-0495(86)90126-5. https://pubmed.ncbi.nlm.nih.gov/3702673/
140. Danforth E, Horton ES, O'Connell M, et al. Dietary-induced alterations in thyroid hormone metabolism during overnutrition. J Clin Invest. 1979;64(5):1336-47. PMID 500814; doi:10.1172/JCI109590; PMC371281. https://pubmed.ncbi.nlm.nih.gov/500814/
141. Dirlewanger M, di Vetta V, Guenat E, et al. Effects of short-term carbohydrate or fat overfeeding on energy expenditure and plasma leptin concentrations in healthy female subjects. Int J Obes Relat Metab Disord. 2000;24(11):1413-8. PMID 11126336; doi:10.1038/sj.ijo.0801395. https://pubmed.ncbi.nlm.nih.gov/11126336/
142. Boden G, Chen X, Mozzoli M, et al. Effect of fasting on serum leptin in normal human subjects. J Clin Endocrinol Metab. 1996;81(9):3419-23. PMID 8784108; doi:10.1210/jcem.81.9.8784108. https://pubmed.ncbi.nlm.nih.gov/8784108/
143. Chin-Chance C, Polonsky KS, Schoeller DA. Twenty-four-hour leptin levels respond to cumulative short-term energy imbalance and predict subsequent intake. J Clin Endocrinol Metab. 2000;85(8):2685-91. PMID 10946866; doi:10.1210/jcem.85.8.6755. https://pubmed.ncbi.nlm.nih.gov/10946866/
144. Hengist A, Davies RG, Rogers PJ, et al. Restricting sugar or carbohydrate intake does not impact physical activity level or energy intake over 24 h despite changes in substrate use: a randomised crossover study in healthy men and women. Eur J Nutr. 2023;62(2):921-940. PMID 36326863; doi:10.1007/s00394-022-03048-x; PMC9941259. https://pubmed.ncbi.nlm.nih.gov/36326863/
145. Kojima C, Namma-Motonaga K, Kamei A, et al. Dynamics of muscle glycogen increase in brachial and thigh muscles with carbohydrate loading. Eur J Appl Physiol. 2025;125(8):2257-2265. PMID 40285856; doi:10.1007/s00421-025-05777-3. https://pubmed.ncbi.nlm.nih.gov/40285856/
146. Lin SD, Chen TC, Wang HH. Cryocompression Therapy for Recovery from Eccentric Exercise-Induced Muscle Damage in Healthy Young Men. Sports (Basel). 2025;13(9):290. PMID 41003596; doi:10.3390/sports13090290; PMC12473699. https://pubmed.ncbi.nlm.nih.gov/41003596/
147. Numao S, Kawano H, Endo N, et al. Short-term high-fat diet alters postprandial glucose metabolism and circulating vascular cell adhesion molecule-1 in healthy males. Appl Physiol Nutr Metab. 2016;41(8):895-902. PMID 27454856; doi:10.1139/apnm-2015-0702. https://pubmed.ncbi.nlm.nih.gov/27454856/
148. Sawka MN, Convertino VA, Eichner ER, et al. Blood volume: importance and adaptations to exercise training, environmental stresses, and trauma/sickness. Med Sci Sports Exerc. 2000;32(2):332-48. PMID 10694114; doi:10.1097/00005768-200002000-00012. https://pubmed.ncbi.nlm.nih.gov/10694114/
